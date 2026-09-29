/* =============================================================================
   Ronda de Diseño ML — js/content/m05-contenedores.js
   Módulo 05: contenedores. Imagen/contenedor/capas, Dockerfile de ML (el del
   gateway del c01), imágenes CUDA y la regla driver vs toolkit, NVIDIA Container
   Toolkit, tamaño y cold start, dónde viven los pesos, registries y tags
   inmutables, docker compose para desarrollo.
   Contrato: docs/SPEC.md §5. Ejemplos = archivos reales de reference/c01.
   Verificado (sept. 2026): tamaños comprimidos sumando las capas amd64 de los
   manifests (Docker Hub / nvcr.io), reglas de compatibilidad de CUDA (docs de
   NVIDIA, CUDA 13.4), notas de la release 24.08 de Triton, dependencias de
   torch 2.14 en PyPI, docs de Docker (CDI por defecto desde 28.3), Compose,
   ECR (cuotas, pull-through cache), GKE image streaming, Kubernetes 1.36.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // Qué trae la imagen (fila superior, y = 7–16) y qué pone el nodo (fila inferior,
  // y = 33–42). Columnas x = 2, 28, 54, 80 con huecos de 8 (6 entre driver y GPU,
  // sin etiqueta). La arista libs → driver baja recta por el centro de ambas cajas.
  const IMAGEN_HOST = {
    width: 100, height: 48,
    lanes: [
      { id: 'img', label: 'Contenedor: lo que trae tu imagen', x: 0, y: 0, w: 100, h: 22, kind: 'online' },
      { id: 'host', label: 'Host', x: 0, y: 26, w: 100, h: 22, kind: 'neutral' },
    ],
    nodes: [
      { id: 'app', label: 'Tu servidor', sub: 'Triton, FastAPI, tu código', x: 2, y: 7, w: 18, h: 9, kind: 'service',
        note: 'El proceso que corre en el contenedor: en el <a href="#c01">caso 1</a>, <code>tritonserver</code> en la imagen de GPU y uvicorn con FastAPI en la del gateway. Viaja en la imagen junto con su configuración (en el c01, el engine y <code>config.pbtxt</code> horneados).' },
      { id: 'fw', label: 'Framework', sub: 'TensorRT 10.3', x: 28, y: 7, w: 18, h: 9, kind: 'model',
        note: 'TensorRT, PyTorch, ONNX Runtime: binarios compilados contra una versión concreta de CUDA. La imagen <code>tritonserver:24.08-py3</code> trae TensorRT 10.3; un engine construido con otra versión de TensorRT no carga.' },
      { id: 'libs', label: 'Libs de CUDA', sub: 'cudart, cuBLAS, cuDNN', x: 54, y: 7, w: 20, h: 9, kind: 'store',
        note: 'El CUDA runtime y sus librerías (cuBLAS, cuDNN, NCCL…) viven en la imagen: en <code>tritonserver:24.08</code>, CUDA 12.6 y cuDNN 9.3. Son la mayor parte de los GB de una imagen de GPU. Pueden venir de la imagen base (<code>nvidia/cuda</code>, NGC) o como wheels de pip (torch).' },
      { id: 'os', label: 'Userland del SO', sub: 'Ubuntu 22.04, Python 3.10', x: 80, y: 7, w: 18, h: 9, kind: 'service',
        note: 'glibc, Python, OpenSSL, libjpeg: todo lo que no es kernel. Por eso la imagen corre igual en tu laptop y en el nodo… siempre que la arquitectura de CPU coincida (amd64 vs arm64).' },
      { id: 'tk', label: 'Container Toolkit', sub: 'inyecta driver y devices', x: 2, y: 33, w: 18, h: 9, kind: 'edge',
        note: 'NVIDIA Container Toolkit: al crear el contenedor, monta los device nodes (<code>/dev/nvidia0</code>, <code>/dev/nvidiactl</code>, <code>/dev/nvidia-uvm</code>), las librerías del driver (<code>libcuda.so</code>, NVML) y <code>nvidia-smi</code> del host. Por eso la imagen no trae driver: lo recibe al arrancar. Detalle en <a href="#m05.gpu-en-contenedor">sección 5</a>.' },
      { id: 'kernel', label: 'Kernel Linux', sub: 'uno para todos', x: 28, y: 33, w: 18, h: 9, kind: 'service',
        note: 'Un contenedor no es una VM: todos los contenedores del nodo comparten el kernel del host. Por eso el módulo del driver de NVIDIA (<code>nvidia.ko</code>) no puede ir en la imagen: se carga en el kernel del nodo.' },
      { id: 'drv', label: 'Driver NVIDIA', sub: 'nvidia.ko + libcuda.so', x: 54, y: 33, w: 20, h: 9, kind: 'service',
        note: 'El driver lo instala quien arma la imagen del nodo (la AMI del node group, el GPU Operator). Su versión fija el CUDA más nuevo que puede correr: el CUDA de tu imagen tiene que caber debajo, o valerse de las reglas de compatibilidad de la <a href="#m05.cuda">sección 4</a>.' },
      { id: 'gpu', label: 'GPU T4', sub: 'sm_75 · 16 GB', x: 80, y: 33, w: 18, h: 9, kind: 'gpu',
        note: 'La GPU física, con su arquitectura (T4 = sm_75, L4 = sm_89). El engine de TensorRT del c01 se compiló para sm_75: en otra GPU no carga, aunque la imagen sea idéntica. La imagen no garantiza el hardware.' },
    ],
    edges: [
      { from: 'app', to: 'fw', kind: 'online', label: 'llama' },
      { from: 'fw', to: 'libs', kind: 'online', label: 'enlaza' },
      { from: 'libs', to: 'drv', kind: 'online', fromSide: 'b', toSide: 't', label: 'exige driver ≥ N' },
      { from: 'kernel', to: 'drv', kind: 'neutral', label: 'carga' },
      { from: 'drv', to: 'gpu', kind: 'online' },
      { from: 'tk', to: 'app', kind: 'neutral', dashed: true, fromSide: 't', toSide: 'b', label: 'monta al arrancar' },
    ],
    flows: [
      { id: 'arranque', label: 'Arranca Triton con --gpus', steps: [
        { nodes: ['tk', 'app'], edges: ['tk>app'], text: '<code>docker run --gpus all</code> (o el kubelet, cuando el pod pide <code>nvidia.com/gpu</code>). Antes de arrancar el proceso, el runtime de NVIDIA monta en el contenedor los devices de la GPU asignada, <code>libcuda.so</code> y <code>nvidia-smi</code> del host.' },
        { nodes: ['app', 'fw', 'libs'], edges: ['app>fw', 'fw>libs'], text: 'Triton carga el engine con TensorRT 10.3, que usa cuDNN y cuBLAS de la imagen, todos compilados contra CUDA 12.6. Hasta aquí todo es de la imagen: idéntico en cualquier nodo.' },
        { nodes: ['libs', 'drv', 'kernel'], edges: ['libs>drv', 'kernel>drv'], text: 'El runtime de CUDA le pide al driver del host (libcuda más el módulo del kernel) que cree el contexto CUDA. Aquí se decide la compatibilidad: el driver tiene que soportar CUDA 12.6, o la imagen tiene que traer el paquete de forward compatibility (las de NGC lo traen).' },
        { nodes: ['drv', 'gpu'], edges: ['drv>gpu'], text: 'El driver habla con la T4 y corre el engine compilado para sm_75. Si el pod cayera en un nodo con L4 (sm_89), el mismo engine no cargaría: por eso el c01 fija el node group con <code>nodeSelector</code>.' },
      ] },
      { id: 'driver-viejo', label: 'El driver del nodo es viejo', steps: [
        { nodes: ['libs', 'drv'], edges: ['libs>drv'], text: 'Imagen con torch 2.14 de PyPI (CUDA 13.0 como wheels) en un nodo con driver R535. CUDA 13.x necesita un driver ≥ 580: PyTorch avisa "The NVIDIA driver on your system is too old" y <code>torch.cuda.is_available()</code> da <code>False</code>.' },
        { nodes: ['app'], edges: [], text: 'Si tu código no lo verifica al arrancar, el servicio sigue… en CPU, decenas de veces más lento y sin un solo error en los logs. Falla temprano: si esperabas GPU y no la hay, que el proceso muera y el pod no pase readiness.' },
        { nodes: ['drv', 'libs'], edges: ['libs>drv'], text: 'Arreglo: elegir una imagen cuyo CUDA quepa bajo el driver (el wheel <code>cu126</code> de torch) o actualizar el driver en la imagen del nodo. Lo que no arregla nada es instalar un driver dentro del contenedor.' },
      ] },
    ],
  };

  // Build una vez → registry → entornos. Tres carriles verticales; huecos de 6–11 unidades
  // entre columnas con etiqueta. La firma vuelve al registry por abajo (y = 28, x = 60).
  const PROMOCION = {
    width: 104, height: 38,
    lanes: [
      { id: 'ci', label: 'CI: se construye una vez', x: 0, y: 0, w: 46, h: 38, kind: 'offline' },
      { id: 'reg', label: 'Registry', x: 48, y: 0, w: 24, h: 38, kind: 'neutral' },
      { id: 'env', label: 'Entornos', x: 74, y: 0, w: 30, h: 38, kind: 'online' },
    ],
    nodes: [
      { id: 'git', label: 'Commit 3f9c2ab', sub: 'código + lockfile', x: 2, y: 6, w: 18, h: 8, kind: 'external',
        note: 'Un commit con el Dockerfile y las dependencias fijadas (<code>requirements.txt</code> con <code>==</code>, base por digest). El hash corto del commit será el tag de la imagen: de un pod en producción llegas al código exacto.' },
      { id: 'build', label: 'Build + tests', sub: 'buildx · linux/amd64', x: 26, y: 6, w: 18, h: 8, kind: 'job',
        note: 'CI construye la imagen UNA vez, para la arquitectura de los nodos, y corre los tests contra ESA imagen (no contra el código suelto). Nada de builds en laptops: una Mac con Apple Silicon produce arm64 por defecto.' },
      { id: 'scan', label: 'Escaneo y firma', sub: 'CVEs · cosign sign', x: 26, y: 24, w: 18, h: 8, kind: 'monitor',
        note: 'El escáner (del registry o en CI) busca CVEs conocidas en los paquetes de la imagen; una política decide si una crítica bloquea el release. La firma (cosign, de Sigstore) se hace sobre el digest y se guarda en el registry junto a la imagen.' },
      { id: 'repo', label: 'Repo en ECR', sub: 'tags inmutables', x: 51, y: 6, w: 18, h: 8, kind: 'store',
        note: 'El repositorio con tags inmutables: <code>classifier-gateway:3f9c2ab</code> apunta siempre al mismo digest. Una lifecycle policy borra lo viejo, pero conserva las últimas N releases: son tus destinos de rollback.' },
      { id: 'stg', label: 'Staging', sub: 'deploy por digest', x: 80, y: 6, w: 20, h: 8, kind: 'service',
        note: 'Staging despliega <code>…@sha256:…</code>, no un tag. Aquí corren el smoke test, el load test y la paridad contra el modelo de referencia (<a href="#m03.load-testing">M3</a>).' },
      { id: 'prod', label: 'Producción', sub: 'el mismo digest', x: 80, y: 24, w: 20, h: 8, kind: 'service',
        note: 'Promover no es reconstruir: es apuntar producción al MISMO digest que pasó staging. Lo que probaste es, byte a byte, lo que corre. El canary y el rollback automático están en <a href="#m11">M11</a>.' },
    ],
    edges: [
      { from: 'git', to: 'build', kind: 'offline' },
      { from: 'build', to: 'repo', kind: 'offline', label: 'push' },
      { from: 'build', to: 'scan', kind: 'offline', fromSide: 'b', toSide: 't', label: 'digest' },
      { from: 'scan', to: 'repo', kind: 'monitor', dashed: true, fromSide: 'r', toSide: 'b', via: [[60, 28]], label: 'firma' },
      { from: 'repo', to: 'stg', kind: 'online', label: 'pull @sha256' },
      { from: 'stg', to: 'prod', kind: 'online', dashed: true, fromSide: 'b', toSide: 't', label: 'promover' },
    ],
    flows: [
      { id: 'release', label: 'Una release del gateway', steps: [
        { nodes: ['git', 'build'], edges: ['git>build'], text: 'Merge a main. CI construye <code>classifier-gateway:3f9c2ab</code> para <code>linux/amd64</code> y corre los 24 tests del gateway contra esa imagen.' },
        { nodes: ['build', 'repo', 'scan'], edges: ['build>repo', 'build>scan'], text: 'Push al registry: el registry devuelve el digest (<code>sha256:…</code>). Desde aquí, todo se refiere a ese digest, no al tag.' },
        { nodes: ['scan', 'repo'], edges: ['scan>repo'], text: 'Escaneo de vulnerabilidades y firma del digest. Si hay una CVE crítica sin excepción aprobada, la release se detiene aquí.' },
        { nodes: ['repo', 'stg'], edges: ['repo>stg'], text: 'Staging despliega por digest. Smoke test, load test y paridad: si algo falla, no hay nada que "arreglar en producción" porque producción nunca vio esta imagen.' },
        { nodes: ['stg', 'prod'], edges: ['stg>prod'], text: 'Promoción: producción pasa a usar el mismo digest (canary primero). El rollback es volver al digest anterior, que sigue en el registry porque los tags son inmutables y la lifecycle policy conserva las últimas releases.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm05',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que-contenedores',
        title: 'Por qué contenedores (y qué preguntan de verdad)',
        titleEn: 'Why containers, and what interviewers actually ask',
        priority: 'core',
        dims: ['arquitectura', 'comunicacion'],
        blocks: [
          { t: 'p', html: `Empieza por algo que ya te pasó. Tu notebook corre en tu máquina con torch 2.x, el CUDA que vino en la wheel de pip, Pillow de la versión que había y el libjpeg del sistema. En otra máquina pasa una de tres cosas: <code>no kernel image is available for execution on the device</code> (la GPU es de otra arquitectura), "The NVIDIA driver on your system is too old" (el driver no alcanza para ese CUDA), o la peor: corre, pero otra versión de Pillow redimensiona distinto y el accuracy baja un par de puntos sin un solo error. Esa última es training-serving skew, y el <a href="#c01.archivos">c01</a> la evita fijando <code>pillow==12.3.0</code>, la misma versión que en training.` },
          { t: 'p', html: `Un contenedor empaqueta el <b>userland</b> completo (Python, wheels, librerías del sistema, librerías de CUDA, tu código y su configuración por defecto) en una <b>imagen</b> inmutable, identificada por un hash. Lo que probaste en CI es, byte a byte, lo que corre en producción. En ML esto importa más que en un servicio web típico, porque tu stack tiene más piezas nativas que pueden cambiar debajo de ti: CUDA, cuDNN, TensorRT, las wheels de PyTorch.` },
          { t: 'table', caption: 'Qué garantiza la imagen y qué no', head: ['Pieza', '¿Viaja en la imagen?', 'Consecuencia'], rows: [
            ['Python, wheels (numpy, Pillow, torch), librerías del sistema', 'Sí', 'Mismas versiones en todos lados, si las fijaste (<a href="#m05.dockerfile-ml">sección 3</a>)'],
            ['Librerías de CUDA (cudart, cuBLAS, cuDNN, TensorRT)', 'Sí', 'Son la mayor parte de los GB de una imagen de GPU (<a href="#m05.cuda">sección 4</a>)'],
            ['Tu código, configuración por defecto y, si lo decides, los pesos', 'Sí', 'Rollback = volver a la imagen anterior (<a href="#m05.pesos-modelo">sección 7</a>)'],
            ['Kernel de Linux', '<b>No</b>: lo comparten todos los contenedores del nodo', 'Un contenedor no es una VM: aísla procesos, red y filesystem, no el kernel'],
            ['Driver de NVIDIA', '<b>No</b>: el host carga su módulo y el NVIDIA Container Toolkit monta sus librerías al arrancar', 'El driver del nodo tiene que soportar el CUDA de tu imagen'],
            ['La GPU física y la arquitectura de CPU', '<b>No</b>', 'Un engine de TensorRT para T4 no carga en una L4; una imagen arm64 no corre en un nodo amd64'],
            ['Datos, secretos y pesos que bajas al arrancar', '<b>No</b>', 'Se inyectan en runtime: variables de entorno, Secrets, volúmenes, S3'],
          ] },
          { t: 'callout', kind: 'why', html: `<p>Todo lo que viene después opera sobre imágenes: Kubernetes (<a href="#m06">M6</a>) crea réplicas de una imagen, el canary (<a href="#m11">M11</a>) mezcla dos y el rollback vuelve a la anterior. Si la imagen no es reproducible e inmutable, nada de eso es confiable.</p>` },
          { t: 'h3', text: 'Qué se pregunta en la entrevista y qué no' },
          { t: 'p', html: `En una ronda de ML System Design nadie te pide escribir un Dockerfile. Los contenedores aparecen como <b>follow-up</b> del autoscaling, del despliegue o de la confiabilidad. Esto es lo que un entrevistador de MLE anota:` },
          { t: 'table', head: ['Tema', '¿Lo preguntan?', 'Qué esperan oír'], rows: [
            ['Por qué la imagen de GPU pesa varios GB y cómo alarga el cold start', 'Sí, casi siempre detrás de "¿cuánto tarda en escalar?"', 'Librerías de CUDA y del framework; minutos de pull; imágenes pre-descargadas o streaming (<a href="#m05.tamano">sección 6</a>)'],
            ['Dónde viven los pesos del modelo', 'Sí', 'Horneados en la imagen vs descargados al arrancar, decidido por tamaño y rollback (<a href="#m05.pesos-modelo">sección 7</a>)'],
            ['Reproducibilidad: qué versión corre y cómo vuelves atrás', 'Sí', 'Build una vez, tags inmutables, deploy por digest, rollback = digest anterior (<a href="#m05.registries">sección 8</a>)'],
            ['Driver vs toolkit de CUDA', 'A veces, sobre todo en equipos de plataforma o de GPU', 'El driver es del host y debe ser ≥ lo que pide el CUDA de la imagen; el engine va atado a la GPU (<a href="#m05.cuda">sección 4</a>)'],
            ['Escribir un Dockerfile', 'Casi nunca (en un take-home, sí)', 'Multi-stage, dependencias fijadas, usuario no root, un proceso por contenedor'],
            ['Seguridad de la cadena de suministro', 'A veces, en empresas reguladas', 'Escaneo al subir, firma del digest, política de admisión'],
            ['Flags de <code>docker run</code>, sintaxis de Compose, overlayfs, internals de BuildKit', 'No', 'Nada: para eso está la <a href="#ref-comandos">hoja de comandos</a>'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>No memorices flags ni la sintaxis completa del Dockerfile. Si tienes poco tiempo, lee las secciones 1, 2, 4, 6, 7 y 8 de este módulo y salta la 3, la 5 y la 9 (son útiles para un take-home o para operar el <a href="#c01.archivos">c01</a>, no para la ronda de diseño).</p>` },
          { t: 'callout', kind: 'connect', html: `<p>En el ciclo de vida de <a href="#m01.ciclo-de-vida">M1</a>, esta es la etapa de <b>packaging</b>: el artefacto que sale de training se convierte en algo desplegable. En el <a href="#c01">caso 1</a> hay dos imágenes: el gateway en CPU (${E('≈ 0.1 GB comprimida')}) y Triton con el engine horneado (≈ 9.2 GB comprimidos). Casi todo lo interesante de este módulo sale de esa diferencia de 100×.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Each tier ships as its own immutable image, tagged with the git commit and deployed by digest. The GPU image is the heavy one, about 9 GB compressed, mostly CUDA libraries, so it dominates our cold start. The NVIDIA driver comes from the node, so the node image has to carry a driver that supports the CUDA version inside the container."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'imagen-capas',
        title: 'Imagen, contenedor y capas',
        titleEn: 'Images, containers and layers',
        priority: 'core',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Si vienes de PyTorch, la analogía que sirve: la <b>imagen</b> es como un checkpoint más el código congelados en un archivo que nadie modifica; el <b>contenedor</b> es el proceso que corre a partir de ella. De una imagen salen muchas réplicas idénticas.` },
          { t: 'table', caption: 'Imagen vs contenedor', head: ['', 'Imagen', 'Contenedor'], rows: [
            ['Qué es', 'Plantilla inmutable: capas de solo lectura + configuración (CMD, ENV, USER, puertos)', 'Uno o más procesos corriendo sobre la imagen, con una capa escribible propia'],
            ['Estado', 'No cambia; se identifica por su digest', 'Efímero: lo que escribe se pierde al borrarlo'],
            ['Cuántos', 'Una por versión', 'Muchas réplicas de la misma imagen'],
            ['Dónde vive', 'En el registry y en la caché de cada nodo que la bajó', 'En un nodo, mientras corre'],
            ['Quién lo maneja', '<code>docker build</code>, <code>push</code>, <code>pull</code>; CI', '<code>docker run</code>; en Kubernetes, el kubelet'],
          ] },
          { t: 'h3', text: 'Capas: una pila de diffs' },
          { t: 'p', html: `Cada instrucción del Dockerfile que toca el filesystem (<code>RUN</code>, <code>COPY</code>, <code>ADD</code>) produce una <b>capa</b>: un diff con los archivos agregados, modificados o borrados respecto de la anterior. El runtime apila las capas (con overlayfs en Linux) y el contenedor ve un solo filesystem. En la imagen del gateway del c01, las capas grandes son la base <code>python:3.13-slim</code> (${E('≈ 43 MB comprimida')}) y el venv con las 37 dependencias (${E('≈ 44 MB comprimido, ≈ 160 MB en disco')}); la capa del código (<code>app/</code>) son ≈ 48 KB.` },
                    { t: 'list', items: [
            `<b>Las capas se comparten por digest.</b> Diez imágenes sobre la misma base guardan y descargan esa base una sola vez por nodo. Si solo cambió la capa del código, un nodo que ya tenía la versión anterior baja solo esos KB.`,
            `<b>Borrar en una capa posterior no achica la imagen.</b> El archivo sigue en la capa de abajo; la de arriba solo lo marca como borrado (un "whiteout"). Lo que no quieres en la imagen se limpia en el mismo <code>RUN</code> que lo creó, o no se crea.`,
          ] },
          { t: 'h3', text: 'La caché de build y por qué el orden importa' },
          { t: 'p', html: `Al construir, Docker reutiliza una capa si la instrucción y todo lo anterior no cambiaron (para <code>COPY</code> y <code>ADD</code>, compara el contenido de los archivos). En cuanto una instrucción cambia, <b>todas las siguientes se reconstruyen</b>. La regla que sale de ahí: lo que cambia poco va arriba (base, paquetes del sistema, dependencias) y lo que cambia en cada commit va abajo (código, y en el c01, el modelo).` },
          { t: 'calc', title: 'Editas main.py del gateway (c01): con y sin el orden correcto', rows: [
            { label: 'Build desde cero', expr: 'base + pip install de 37 wheels (≈ 44 MB) + COPY app/', value: E('≈ 30–60 s') },
            { label: 'Cambias main.py; requirements.txt se copia antes que el código', expr: 'capas de base y venv en caché; se rehace solo COPY app/', value: E('≈ 2–5 s') + ' y una capa nueva de ≈ 48 KB' },
            { label: 'Mismo cambio con COPY . . antes de pip install', expr: 'el cambio invalida la capa de pip: reinstala todo', value: E('≈ 30–60 s') + ' y una capa nueva de ≈ 160 MB en disco' },
            { label: 'Mismo error en una imagen con torch para GPU', expr: 'pip vuelve a bajar ≈ 3 GB de wheels (torch + CUDA)', value: E('minutos') + ' y GBs nuevos que cada nodo vuelve a bajar' },
          ], result: 'El orden de las capas no es estética: decide cuánto tarda cada build y, sobre todo, <b>cuántos bytes baja cada nodo en cada deploy</b>. Con el orden correcto, una release que solo cambia código cuesta KB de pull; con el incorrecto, GB.' },
          { t: 'callout', kind: 'trap', title: 'apt-get update en su propio RUN', html: `<p><code>RUN apt-get update</code> en una línea y <code>RUN apt-get install …</code> en otra: la primera queda en caché con la lista de paquetes de hace meses, y un día el install falla porque esas versiones ya no existen en el mirror. Van juntas en el mismo <code>RUN</code>, con <code>--no-install-recommends</code> y <code>rm -rf /var/lib/apt/lists/*</code> al final, en la misma línea lógica.</p>` },
          { t: 'h3', text: 'Tag vs digest' },
          { t: 'table', head: ['', 'Tag', 'Digest'], rows: [
            ['Ejemplo', '<code>classifier-gateway:3f9c2ab</code>', '<code>classifier-gateway@sha256:9b1c…</code>'],
            ['Qué es', 'Un nombre que apunta a una imagen; se puede mover a otra (salvo en repos con tags inmutables)', 'El hash SHA-256 del manifest: identifica el contenido'],
            ['Para qué', 'Humanos, CI, legibilidad', 'Despliegue reproducible, auditoría, rollback exacto'],
            ['Trampa', '<code>:latest</code> o un tag reusado: dos nodos pueden correr cosas distintas con el "mismo" nombre', 'En imágenes multi-arquitectura, el digest del índice no es el de cada plataforma: compara digests del mismo tipo'],
          ] },
          { t: 'code', title: 'Mirar qué pesa cada capa', files: [
            { name: 'capas.sh', lang: 'bash', code: `# Capas de una imagen local, la más reciente arriba: tamaño en disco y el comando que la creó
docker history --format "table {{.Size}}\\t{{.CreatedBy}}" classifier-gateway:3f9c2ab

# Tamaño total en disco (descomprimido) de las imágenes locales de ese repositorio
docker image ls classifier-gateway

# El digest con el que se subió: es lo que se despliega y se audita
docker image inspect --format "{{index .RepoDigests 0}}" classifier-gateway:3f9c2ab

# Tamaño COMPRIMIDO por capa sin descargar nada: lee el manifest en el registry
# (crane es de go-containerregistry; jq suma los tamaños)
crane manifest --platform linux/amd64 nvcr.io/nvidia/tritonserver:24.08-py3 | jq "[.layers[].size] | add"` },
          ], caption: 'La última línea es la cuenta que da ≈ 9.2 GB para la imagen de Triton del c01. Más comandos en la <a href="#ref-comandos.docker">hoja de Docker</a>.' },
          { t: 'callout', kind: 'skip', html: `<p>Overlayfs, el formato OCI de los manifests, herramientas como <code>dive</code> para explorar capas y los detalles de BuildKit no salen en la ronda de diseño. Quédate con tres ideas: capas como diffs que se comparten, caché que se rompe hacia abajo y digest como identidad.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'dockerfile-ml',
        title: 'Un Dockerfile de ML, decisión por decisión',
        titleEn: 'An ML Dockerfile, decision by decision',
        priority: 'extra',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `El Dockerfile del gateway del <a href="#c01.archivos">caso 1</a> tiene 52 líneas y cada una responde una pregunta que un revisor de código (o un entrevistador en un take-home) haría. Primero míralo completo; después, las decisiones una por una.` },
          { t: 'code', title: 'reference/c01/gateway/Dockerfile', files: [
            { name: 'gateway/Dockerfile', lang: 'dockerfile', src: 'c01/gateway/Dockerfile', note: 'Los comentarios van en su propia línea a propósito: en un Dockerfile, un <code>#</code> al final de una instrucción no es un comentario (ver la tabla de errores).' },
            { name: 'gateway/.dockerignore', lang: 'text', src: 'c01/gateway/.dockerignore', note: 'Lo que no entra al contexto de build: tests, venvs, <code>.git</code>, secretos locales, imágenes y modelos.' },
          ] },
          { t: 'steps', items: [
            { title: 'Multi-stage: builder y runtime', meta: 'FROM … AS builder', html: `<p>La etapa <code>builder</code> crea un venv en <code>/opt/venv</code> e instala las dependencias; la etapa final arranca de otra <code>python:3.13-slim</code> limpia y hace <code>COPY --from=builder /opt/venv /opt/venv</code>. Lo que la primera etapa necesitó y la final no, se queda atrás. En este gateway la ganancia es chica, porque todo son wheels precompiladas (<code>--only-binary=:all:</code> hace fallar el build si alguna falta, en vez de compilarla en silencio con gcc); el patrón paga de verdad cuando la etapa builder necesita compiladores, headers o una base CUDA <code>devel</code>.</p>` },
            { title: 'Versiones fijadas', meta: 'python:3.13-slim · ==', html: `<p>La base tiene versión (y el comentario pide fijar también el digest en producción) y <code>requirements.txt</code> fija las 37 dependencias con <code>==</code>, transitivas incluidas. Sin eso, reconstruir el mismo commit dentro de tres meses trae otras versiones: otra starlette, otro numpy, otro Pillow que redimensiona distinto.</p>` },
            { title: 'Dependencias antes que el código', meta: 'COPY requirements.txt', html: `<p><code>COPY requirements.txt .</code> y <code>RUN pip install</code> van antes de <code>COPY app/</code>. Editar <code>main.py</code> no invalida la capa de dependencias: es la cuenta de la <a href="#m05.imagen-capas">sección 2</a>.</p>` },
            { title: 'Usuario sin privilegios con UID numérico', meta: 'USER 10001', html: `<p>Si alguien explota una vulnerabilidad del proceso (el gateway parsea imágenes que no controlas), no es root dentro del contenedor. El UID es numérico porque Kubernetes, con <code>runAsNonRoot: true</code>, solo puede verificar un número: si la imagen declara un nombre de usuario y el pod no fija <code>runAsUser</code>, se niega a arrancar el contenedor. El <code>k8s/gateway.yaml</code> del c01 pide <code>runAsUser: 10001</code>, el mismo número.</p>` },
            { title: 'Variables de Python para contenedores', meta: 'PYTHONUNBUFFERED=1', html: `<p>Cuando stdout no es una terminal, Python lo bufferea: si el proceso muere, las últimas líneas de log se pierden, justo las que explicaban el crash. <code>PYTHONUNBUFFERED=1</code> las manda al instante. <code>PYTHONDONTWRITEBYTECODE=1</code> evita escribir <code>.pyc</code>, porque en Kubernetes el filesystem del gateway es de solo lectura.</p>` },
            { title: 'HEALTHCHECK solo para Docker', meta: 'Kubernetes lo ignora', html: `<p>El <code>HEALTHCHECK</code> lo usan <code>docker run</code> y Compose. Kubernetes no lo mira: allá mandan las liveness y readiness probes del manifest (<a href="#m06">M6</a>). Como la imagen slim no trae curl, el chequeo usa Python.</p>` },
            { title: 'Un proceso por contenedor, en forma exec', meta: 'CMD ["uvicorn", …, "--workers", "1"]', html: `<p>Un solo proceso uvicorn: el escalado lo hacen las réplicas (el HPA del c01 escala entre 3 y 12 pods por CPU). Varios workers dentro de un pod esconden el uso real de CPU por proceso, duplican la memoria, obligan a usar el modo multiproceso de <code>prometheus_client</code> y dejan pods "sanos" con un worker colgado. La forma exec (lista JSON) hace que uvicorn sea el PID 1 y reciba el SIGTERM del rolling update; con <code>--timeout-graceful-shutdown 20</code> termina los requests en curso antes de los 45 s de <code>terminationGracePeriodSeconds</code>.</p>` },
          ] },
          { t: 'h3', text: 'Los errores que más se ven' },
          { t: 'table', head: ['Error', 'Por qué duele', 'Arreglo'], rows: [
            ['Herramientas de build en la imagen final (gcc, headers, una base CUDA <code>devel</code>)', 'Cientos de MB a varios GB extra en cada pull y más paquetes con CVEs', 'Multi-stage: se compila en <code>builder</code> y se copia solo el resultado'],
            ['Secretos en capas: <code>ARG HF_TOKEN</code>, <code>COPY .env</code>', 'Los <code>ARG</code> usados en un <code>RUN</code> quedan visibles en <code>docker history</code>; un archivo copiado sigue en su capa aunque lo borres después', '<code>RUN --mount=type=secret</code> en el build; en runtime, Secrets o variables de entorno. Y <code>.env</code> en <code>.dockerignore</code>'],
            ['Correr como root', 'Quien tome el control del proceso es root dentro del contenedor: un paso menos para llegar al nodo', '<code>USER</code> con UID numérico + <code>runAsNonRoot</code> en el pod'],
            ['Dependencias sin fijar (<code>pip install torch</code>)', 'El mismo Dockerfile produce otra imagen cada semana. Hoy, torch 2.14 de PyPI trae CUDA 13 y exige un driver ≥ 580 en el nodo', '<code>==</code> en todo (idealmente con hashes), base por digest, lockfile generado'],
            ['<code>COPY . .</code> antes de instalar dependencias', 'Cada cambio de código reinstala todo, y datasets, checkpoints o <code>.git</code> del directorio entran a la imagen', 'Copiar primero el archivo de dependencias; <code>.dockerignore</code> estricto'],
            ['Comentario al final de una instrucción: <code>FROM python:3.13-slim # base</code>', 'En un Dockerfile, <code>#</code> solo es comentario al inicio de la línea; en otro lugar es un argumento más. <code>FROM</code>, <code>COPY</code> o <code>ENV</code> fallan o hacen otra cosa. En un <code>RUN</code> "funciona" porque lo interpreta el shell, lo que esconde el problema', 'Comentarios siempre en su propia línea'],
            ['<code>CMD</code> en forma shell, o un script propio como PID 1', 'En forma shell, el PID 1 es <code>/bin/sh</code> y no reenvía el SIGTERM a tu proceso. Y el kernel descarta las señales al PID 1 que no tienen handler: un script sin handler de SIGTERM ignora el aviso. En ambos casos el pod espera todo el grace period y muere con SIGKILL, cortando requests', 'Forma exec y un servidor que maneje SIGTERM (uvicorn, Triton), o un init mínimo como <code>tini</code>'],
            ['Construir en una Mac con Apple Silicon y subir a nodos x86', 'La imagen sale arm64: el contenedor muere con <code>exec format error</code>, o el pull falla con "no match for platform" si el registry guardó un índice sin amd64', 'Build en CI con <code>--platform linux/amd64</code> (o multi-arquitectura a propósito)'],
          ] },
          { t: 'code', title: 'Antipatrón: cada línea tiene un problema (no lo copies)', files: [
            { name: 'Dockerfile.malo', lang: 'dockerfile', code: `# Imagen completa (≈ 0.4 GB comprimida contra ≈ 43 MB de la slim); el tag se mueve con cada 3.13.x y no hay digest
FROM python:3.13
# El valor queda visible en docker history de la capa que lo usa
ARG HF_TOKEN
WORKDIR /app
# Entra todo el directorio (datasets, .git, .env) y cualquier cambio invalida lo que sigue
COPY . .
# Sin versiones: otro día, otras dependencias (y otro CUDA)
RUN pip install torch fastapi uvicorn pillow
# Descarga los pesos en el build con el token de arriba: el token queda en el historial
RUN python download_weights.py
# Corre como root; forma shell: /bin/sh es el PID 1 y uvicorn no recibe SIGTERM
CMD uvicorn app.main:app --host 0.0.0.0 --workers 4` },
          ], caption: 'Compáralo con el del c01: mismas funciones, ninguno de estos problemas.' },
          { t: 'callout', kind: 'senior', html: `<p>El Dockerfile es parte del contrato de reproducibilidad, igual que el dataset versionado. Lo que un revisor senior pregunta no es "¿funciona?" sino "¿qué imagen sale si lo construyo dentro de seis meses?". La respuesta correcta es "la misma", y se logra con base por digest, dependencias fijadas con hash, builds solo en CI y la imagen identificada por digest desde ahí en adelante.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>Cache mounts de BuildKit (<code>RUN --mount=type=cache</code>), heredocs, <code>COPY --link</code>, attestations de SBOM y provenance en el build: útiles para acelerar el CI o para auditoría, irrelevantes en la ronda de diseño.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'cuda',
        title: 'Imágenes CUDA: runtime vs devel, drivers y compatibilidad',
        titleEn: 'CUDA images: runtime vs devel, drivers and compatibility',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Empieza por la imagen del c01. <code>nvcr.io/nvidia/tritonserver:24.08-py3</code> pesa ≈ 9.2 GB comprimidos (sumando las capas amd64 de su manifest), y su capa más grande sola pesa ≈ 4.3 GB. Según las notas de esa release, adentro hay Ubuntu 22.04, Python 3.10, CUDA 12.6, cuBLAS, cuDNN 9.3, TensorRT 10.3, ONNX Runtime 1.18, OpenVINO y el resto de los backends de Triton. Lo que <b>no</b> hay es el driver de NVIDIA.` },
          { t: 'diagram', id: 'imagen-vs-host', title: 'Qué pone la imagen y qué pone el nodo', caption: 'Toca cada caja para ver de dónde sale. Los dos recorridos muestran un arranque normal y el error más común: un driver más viejo que el CUDA de la imagen.', spec: IMAGEN_HOST },
          { t: 'table', caption: 'Las piezas de la pila de GPU', head: ['Pieza', 'Dónde vive', 'Quién la elige', 'En el c01'], rows: [
            ['Módulo del driver (<code>nvidia.ko</code>) y <code>libcuda.so</code>', 'Host', 'Quien arma la imagen del nodo: la AMI del node group, el GPU Operator', 'El driver que traiga la AMI de los nodos g4dn'],
            ['CUDA runtime y librerías (cudart, cuBLAS, cuDNN, NCCL)', 'Imagen', 'Tú, al elegir la imagen base o la versión de torch', 'CUDA 12.6 de <code>tritonserver:24.08</code>'],
            ['Framework (TensorRT, PyTorch, ONNX Runtime)', 'Imagen', 'Tú', 'TensorRT 10.3'],
            ['Compilador <code>nvcc</code>, headers, librerías estáticas', 'Solo imágenes <code>devel</code>', 'Tú, y solo para compilar', 'No va en producción'],
            ['Arquitectura de la GPU', 'Hardware', 'El node group', 'T4, sm_75'],
          ] },
          { t: 'h3', text: 'La regla de compatibilidad' },
          { t: 'p', html: `Un driver nuevo corre aplicaciones compiladas con CUDA viejo (compatibilidad hacia atrás). Al revés, no por defecto. De ahí sale la regla que tienes que poder decir en una línea: <b>el driver del nodo tiene que ser al menos el que pide la versión de CUDA de la imagen</b>. Hay dos matices que NVIDIA documenta y que conviene nombrar con precisión:` },
          { t: 'table', head: ['Mecanismo', 'Qué permite', 'Límites'], rows: [
            ['<b>Minor version compatibility</b> (desde CUDA 11)', 'Una app compilada con cualquier 12.x corre con un driver ≥ 525; una 13.x, con un driver ≥ 580 (Linux x86_64)', 'Las funciones que necesitan un driver más nuevo devuelven error (<code>cudaErrorCallRequiresNewerDriver</code>); el código que depende de compilar PTX en runtime (JIT) no funciona con el driver más viejo'],
            ['<b>Forward compatibility</b> (paquete <code>cuda-compat</code>)', 'Correr un CUDA más nuevo, incluso de otra versión mayor, sobre ramas de driver más viejas que NVIDIA soporta', 'Solo GPUs de data center (más algunas RTX certificadas y Jetson), no GeForce; solo en las ramas de driver soportadas. Las imágenes de NGC lo traen'],
          ] },
          { t: 'table', caption: 'Ejemplos: ¿corre en un nodo T4 con driver R535?', head: ['Imagen', 'CUDA', 'Driver que pide', '¿Corre?'], rows: [
            ['<code>tritonserver:24.08-py3</code> (c01)', '12.6', '≥ 560; en GPUs de data center también R535 (≥ 535.86) y otras ramas LTS, según sus notas de release', 'Sí: la T4 es de data center y la imagen de NGC trae forward compatibility'],
            ['torch 2.14 de PyPI', '13.0 (wheels <code>nvidia-*</code>)', '≥ 580', 'No: "driver too old". Las wheels no traen el paquete de forward compatibility'],
            ['torch 2.14 del índice <code>cu126</code>', '12.6', '≥ 525 por minor version compatibility', 'Sí, con los límites de arriba'],
            ['<code>nvidia/cuda:13.4.1-runtime-ubuntu24.04</code>', '13.4', '≥ 580; su <code>NVIDIA_REQUIRE_CUDA</code> acepta además ramas como R535 y R570 en GPUs de data center (forward compatibility)', 'Sí en una T4. En una GeForce con R535, el contenedor ni arranca (ver la nota de abajo)'],
          ], note: 'Las versiones de driver salen de la documentación de compatibilidad de CUDA, de las notas de la release 24.08 de Triton y de la variable <code>NVIDIA_REQUIRE_CUDA</code> de la imagen. En tu cluster, la fuente de verdad es <code>nvidia-smi</code> en el nodo, y la prueba, arrancar la imagen en ese nodo.' },
          { t: 'callout', kind: 'trap', title: 'nvidia-smi dice "CUDA Version: 12.2"', html: `<p>La cabecera de <code>nvidia-smi</code> muestra la versión de CUDA <b>más nueva que soporta el driver</b>, no la que trae tu imagen. Dentro de un contenedor con CUDA 12.6 verás "12.2" si el driver del host es R535, y no es una contradicción. La versión de la imagen se mira con <code>torch.version.cuda</code>, con la variable <code>CUDA_VERSION</code> de las imágenes <code>nvidia/cuda</code> o en las notas de la release de NGC.</p>` },
          { t: 'callout', kind: 'note', title: 'Fallar temprano es una ventaja', html: `<p>Las imágenes <code>nvidia/cuda</code> declaran <code>NVIDIA_REQUIRE_CUDA</code>: la versión de CUDA que necesitan más las ramas de driver que aceptan por forward compatibility en GPUs de data center. Si el driver del host no cumple ninguna, el toolkit se niega a crear el contenedor con un "requirement error: unsatisfied condition: cuda&gt;=…". Molesta, pero es mejor que un servicio que arranca y cae a CPU en silencio.</p>` },
          { t: 'h3', text: 'Qué imagen base elegir' },
          { t: 'table', caption: 'Tamaños comprimidos (amd64), sumando las capas de cada manifest', head: ['Imagen', 'Tamaño comprimido', 'Qué trae', 'Cuándo'], rows: [
            ['<code>python:3.13-slim</code> + torch de pip', '≈ 43 MB + ≈ 3 GB de wheels (torch 2.14 con CUDA 13)', 'Python y las librerías de CUDA como paquetes <code>nvidia-*</code> de pip', 'Un servicio PyTorch: controlas cada versión y no duplicas CUDA'],
            ['<code>nvidia/cuda:…-base</code>', '≈ 0.1–0.2 GB', 'Lo mínimo de CUDA (cudart)', 'Traes todo lo demás tú'],
            ['<code>nvidia/cuda:…-runtime</code>', '≈ 1.5–1.9 GB', 'Librerías de CUDA de runtime (cuBLAS, cuFFT, cuSPARSE…)', 'Binarios que esperan CUDA instalado en el sistema'],
            ['<code>nvidia/cuda:…-cudnn-runtime</code>', '≈ 2.1–2.5 GB', 'Lo anterior + cuDNN', 'Lo mismo, con cuDNN'],
            ['<code>nvidia/cuda:…-devel</code>, <code>-cudnn-devel</code>', '≈ 4–5 GB', '+ <code>nvcc</code>, headers, librerías estáticas', 'Solo la etapa <code>builder</code>: compilar extensiones CUDA'],
            ['NGC <code>tensorrt:24.08-py3</code>', '≈ 5.5 GB', 'TensorRT y <code>trtexec</code>', 'Construir el engine (<code>build_engine.sh</code> del c01)'],
            ['NGC <code>tritonserver:24.08-py3</code>', '≈ 9.2 GB', 'Triton y sus backends estándar', 'Serving (c01)'],
            ['NGC <code>pytorch:24.08-py3</code>', '≈ 10.2 GB', 'PyTorch, CUDA, NCCL y herramientas de training', 'Training y experimentos; casi nunca serving'],
          ], note: 'Rangos de <code>nvidia/cuda</code> para CUDA 12.6 y 13.4 (Ubuntu 22.04 y 24.04). En disco, descomprimidas, ocupan bastante más: mídelo con <code>docker image ls</code>.' },
          { t: 'p', html: `Las imágenes de NGC pesan lo que pesan porque traen la pila completa, probada en conjunto cada mes (<code>YY.MM</code>): CUDA, cuDNN, TensorRT, NCCL, varios backends y herramientas. Ese es su valor: no tienes que descubrir qué combinación de versiones funciona. El precio: GB en cada pull y muchos paquetes que el escáner de vulnerabilidades va a reportar. Si solo usas el backend de TensorRT, Triton documenta un script (<code>compose.py</code>) para armar una imagen con solo los backends que necesitas; cuánto baja, mídelo.` },
          { t: 'callout', kind: 'why', title: 'Las wheels de PyTorch ya traen CUDA', html: `<p>Desde hace varias versiones, <code>pip install torch</code> en Linux instala las librerías de CUDA como dependencias de pip (en torch 2.14: <code>cuda-toolkit</code> 13.0, <code>nvidia-cudnn-cu13</code>, <code>nvidia-nccl-cu13</code>…). Solo necesitas el driver, que lo monta el toolkit. Por eso un servicio PyTorch puede partir de <code>python:3.13-slim</code>. No todas las librerías hacen lo mismo: <code>onnxruntime-gpu</code> solo trae CUDA por pip si pides sus extras (<code>[cuda,cudnn]</code>); si no, espera encontrarlo en el sistema. Lee la matriz de compatibilidad de cada una.</p>` },
          { t: 'code', title: 'Servicio PyTorch en GPU sin imagen base de CUDA', files: [
            { name: 'Dockerfile', lang: 'dockerfile', code: `# syntax=docker/dockerfile:1
# Sin base de CUDA: las librerías llegan como wheels de pip; el driver lo monta el NVIDIA Container Toolkit
FROM python:3.13-slim
ENV PIP_NO_CACHE_DIR=1 PYTHONUNBUFFERED=1
WORKDIR /srv
# Índice cu126: CUDA 12.6, corre con drivers ≥ 525 (minor version compatibility).
# El torch 2.14 de PyPI trae CUDA 13.0 y exige driver ≥ 580: elige según el driver de tus nodos
RUN pip install torch==2.14.0 --index-url https://download.pytorch.org/whl/cu126
# Resto de dependencias fijadas (fastapi, uvicorn, pillow…) antes que el código, por la caché
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app/ ./app/
# UID numérico sin crear el usuario: Docker lo acepta y Kubernetes puede verificar runAsNonRoot
USER 10001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]` },
          ], caption: 'Mismo patrón que el gateway del c01, con torch. Para un servicio en CPU usa el índice <code>cpu</code>: la wheel de torch 2.14 CPU pesa ≈ 196 MB, contra ≈ 3 GB con CUDA.' },
          { t: 'callout', kind: 'trap', title: 'CUDA dos veces', html: `<p>Partir de <code>nvidia/cuda:…-cudnn-runtime</code> (≈ 2.5 GB) y encima hacer <code>pip install torch</code> (que trae su propio CUDA): pagas las librerías dos veces, y el proceso puede cargar una u otra según el orden de búsqueda. Elige una fuente de CUDA: la de la imagen base o la de pip.</p>` },
          { t: 'callout', kind: 'trap', title: 'Una imagen devel en producción', html: `<p><code>-devel</code> trae <code>nvcc</code>, headers y librerías estáticas: ${E('≈ 2.5 GB')} más que <code>-runtime</code> en cada pull, en cada nodo nuevo, en cada cold start, y un compilador disponible para quien logre entrar al contenedor. Se usa en la etapa <code>builder</code> de un multi-stage; la final parte de <code>-runtime</code> o de una base mínima.</p>` },
          { t: 'callout', kind: 'trap', title: 'El engine de TensorRT no viaja entre versiones ni GPUs', html: `<p>La imagen hace que TensorRT sea el mismo en todos lados, pero el <code>.plan</code> queda atado a la versión de TensorRT con que se construyó y a la arquitectura de la GPU. El c01 lo construye con <code>nvcr.io/nvidia/tensorrt:24.08-py3</code> en una T4 porque Triton corre <code>tritonserver:24.08</code> en T4: misma release de NGC (TensorRT 10.3), misma sm_75. Subir Triton a 25.xx sin reconstruir el engine rompe la carga del modelo (<a href="#c01.archivos">c01 · archivos</a>, <a href="#m04.edge-jetson">M4 en Jetson</a>, optimización en <a href="#m08">M8</a>).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"The driver lives on the node and the CUDA runtime lives in the image, so the rule is that the node's driver must support the image's CUDA version. NGC images add forward compatibility on data center GPUs, which is why the 24.08 Triton image runs on T4 nodes with the R535 driver. The TensorRT engine is a separate constraint: I build it in CI with the same NGC release and on the same GPU type we serve on."</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'gpu-en-contenedor',
        title: 'GPUs dentro del contenedor: NVIDIA Container Toolkit',
        titleEn: 'GPUs inside containers: the NVIDIA Container Toolkit',
        priority: 'extra',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Por defecto, un contenedor no ve la GPU: no tiene los device nodes ni las librerías del driver. El <b>NVIDIA Container Toolkit</b> se instala en el host y se engancha al runtime de contenedores: cuando pides una GPU, antes de arrancar tu proceso monta en el contenedor los devices (<code>/dev/nvidia0</code>, <code>/dev/nvidiactl</code>, <code>/dev/nvidia-uvm</code>), las librerías del driver del host (<code>libcuda.so</code>, NVML) y <code>nvidia-smi</code>. Es la caja "Container Toolkit" del diagrama de la <a href="#m05.cuda">sección 4</a>.` },
          { t: 'table', caption: 'Formas de pedir la GPU', head: ['Dónde', 'Cómo', 'Nota'], rows: [
            ['<code>docker run</code>', '<code>--gpus all</code>, <code>--gpus 2</code> o <code>--gpus \'"device=0"\'</code>', 'Las comillas dobles internas son parte de la sintaxis cuando eliges devices'],
            ['CDI (Container Device Interface)', '<code>docker run --device nvidia.com/gpu=all</code>', 'Especificación abierta para describir devices ante cualquier runtime. Docker la trae activada desde Engine 28.3 y el toolkit (≥ 1.18) genera la especificación en <code>/var/run/cdi</code>. Podman lo usa desde 4.1'],
            ['Variable de entorno', '<code>NVIDIA_VISIBLE_DEVICES</code>: <code>all</code>, índices, UUIDs, <code>none</code> o <code>void</code>', 'Las imágenes <code>nvidia/cuda</code> traen <code>all</code>; <code>NVIDIA_DRIVER_CAPABILITIES</code> (por defecto <code>compute,utility</code>) reemplaza la lista, no la amplía'],
            ['Docker Compose', '<code>deploy.resources.reservations.devices</code> con <code>capabilities: [gpu]</code>', 'Es lo que usa el c01; las versiones recientes de Compose aceptan también <code>gpus: all</code>'],
            ['Kubernetes', '<code>resources.limits: {nvidia.com/gpu: 1}</code>', 'Lo anuncia el NVIDIA device plugin; el GPU Operator instala driver, toolkit, device plugin y exporter de métricas en los nodos (<a href="#m06.gpus-k8s">M6</a>)'],
          ] },
          { t: 'code', title: 'La GPU en Compose (extracto del c01) y las pruebas mínimas', files: [
            { name: 'docker-compose.yml (extracto)', lang: 'yaml', code: `services:
  triton:
    build: ./triton
    # /dev/shm de 64 MB (el default de Docker) no alcanza para Triton
    shm_size: 1g
    deploy:
      resources:
        reservations:
          devices:
            # Equivale a docker run --gpus 1; capabilities es obligatorio
            - driver: nvidia
              count: 1
              capabilities: [gpu]` },
            { name: 'probar-gpu.sh', lang: 'bash', code: `# En el nodo, fuera de Docker: ¿qué GPU hay y qué driver tiene?
nvidia-smi --query-gpu=name,driver_version --format=csv

# Prueba mínima: nvidia-smi dentro de una imagen chica de CUDA (lo monta el toolkit, no la imagen)
docker run --rm --gpus all nvidia/cuda:12.6.3-base-ubuntu22.04 nvidia-smi

# Solo la GPU 0, listada por nombre
docker run --rm --gpus '"device=0"' nvidia/cuda:12.6.3-base-ubuntu22.04 nvidia-smi -L

# Lo mismo con CDI (Docker Engine ≥ 28.3; el toolkit genera la especificación)
docker run --rm --device nvidia.com/gpu=all ubuntu:24.04 nvidia-smi -L

# Dentro de TU imagen: ¿PyTorch ve la GPU y con qué CUDA se compiló?
docker run --rm --gpus all mi-servicio:3f9c2ab \\
  python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda, torch.cuda.get_device_name(0))"` },
          ] },
          { t: 'callout', kind: 'trap', title: 'Olvidar pedir la GPU no da error', html: `<p>Sin <code>--gpus</code> (o sin <code>nvidia.com/gpu</code> en el pod), <code>torch.cuda.is_available()</code> devuelve <code>False</code> y un servicio escrito con <code>device = "cuda" if … else "cpu"</code> arranca feliz en CPU, decenas de veces más lento. Si el servicio necesita GPU, verifícalo al arrancar y termina el proceso si no está: un pod en CrashLoop se ve en un minuto; uno lento, en la factura. Triton con <code>KIND_GPU</code> ya lo hace: el modelo no carga sin GPU.</p>` },
          { t: 'callout', kind: 'trap', title: 'Instalar el driver dentro de la imagen', html: `<p>El driver no va en la imagen: el módulo del kernel es del host y el toolkit monta las librerías que corresponden a ese módulo. Si agregas paquetes del driver (<code>libnvidia-*</code>, utilidades) a la imagen, pueden tapar a las del host y no coincidir con el módulo cargado: errores del estilo "Driver/library version mismatch". Si un tutorial te dice que instales el driver en el Dockerfile, está resolviendo otro problema.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El <code>shm_size: 1g</code> de Compose tiene su equivalente en Kubernetes: un <code>emptyDir</code> con <code>medium: Memory</code> montado en <code>/dev/shm</code>, como en el <code>k8s/triton.yaml</code> del <a href="#c01.archivos">c01</a>. Cómo el scheduler reparte GPUs, taints y tolerations de los nodos GPU y DRA: <a href="#m06.gpus-k8s">M6</a>. Compartir una GPU entre contenedores (MIG, time-slicing, MPS): <a href="#m04.compartir-gpu">M4</a>.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>Los modos del runtime de NVIDIA (legacy, CDI, CSV), <code>nvidia-ctk</code>, los hooks y las capabilities gráficas no salen en entrevistas de MLE. Lo que sí: el driver es del host, el toolkit lo inyecta, y en Kubernetes la GPU es un recurso que se pide entero.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'tamano',
        title: 'Reducir tamaño (y por qué importa para el cold start)',
        titleEn: 'Shrinking images, and why it matters for cold starts',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Cuando el autoscaler agrega un pod en un nodo que no tiene la imagen, el nodo la descarga completa, descomprime cada capa y la escribe en disco antes de arrancar nada. Con el gateway eso es un segundo; con Triton, minutos. Hagamos la cuenta con las dos imágenes del c01.` },
          { t: 'calc', title: 'Cuánto tarda en llegar la imagen al nodo (c01)', rows: [
            { label: 'Gateway: base slim + venv', expr: '≈ 43 MB + ≈ 44 MB comprimidos', value: E('≈ 0.09 GB') },
            { label: 'Triton 24.08 con el engine', expr: 'suma de capas amd64 del manifest + engine', value: '≈ 9.2 GB' },
            { label: 'Ritmo efectivo de pull (bajar + descomprimir + escribir)', expr: 'containerd estándar, capas gzip, disco del nodo', value: E('≈ 0.08–0.15 GB/s'), note: 'Depende del registry, de la región, del disco y del tamaño de las capas. Mídelo en tus nodos' },
            { label: 'Pull del gateway', expr: '0.09 GB ÷ 0.08–0.15 GB/s', value: E('≈ 1 s') },
            { label: 'Pull de Triton', expr: '9.2 GB ÷ 0.08–0.15 GB/s', value: E('≈ 60–115 s') },
            { label: 'Referencia publicada por AWS (ago. 2025)', expr: 'imagen de ≈ 10 GB en m6i.8xlarge con EBS de 1,000 MiB/s', value: '≈ 113 s estándar · ≈ 45 s con SOCI', note: 'Benchmark del fabricante (SOCI parallel pull), en un disco más rápido que el default: ≈ 10 GB ÷ 113 s ≈ 0.09 GB/s efectivos sin paralelismo' },
            { label: 'Pod nuevo de Triton completo', expr: 'nodo GPU nuevo + pull + cargar engine y warmup + readiness', value: E('≈ 3–7 min'), note: 'El nodo (≈ 2–5 min) y el pull se llevan casi todo; el engine carga en segundos' },
          ], result: 'El gateway escala en segundos y Triton en minutos, y de esos minutos, ≈ 1–2 son el pull de la imagen. Por eso el c01 mantiene 2 réplicas calientes y absorbe los spikes con headroom, no con el autoscaler (<a href="#m03.cuantas-gpus">M3</a>).' },
          { t: 'p', html: `¿Por qué el ritmo efectivo es tan bajo si la red de la instancia da varios Gb/s? Tres razones que se suman. El runtime estándar descomprime cada capa gzip con un solo core, y la capa más grande de Triton pesa ≈ 4.3 GB sola. Descomprimida, la imagen ocupa más en disco que lo que viaja por la red. Y el disco raíz típico de un nodo en AWS es un volumen gp3 con 125 MiB/s de throughput base: escribir decenas de GB a ese ritmo toma minutos por sí solo, aunque la red sobre.` },
          { t: 'h3', text: 'Técnicas para achicar la imagen' },
          { t: 'table', head: ['Técnica', 'Cuánto ahorra', 'Costo o trampa'], rows: [
            ['Base slim en vez de la completa', '<code>python:3.13-slim</code> ≈ 43 MB contra ≈ 0.4 GB de <code>python:3.13</code> (comprimidas)', 'Si algo necesita compilarse, instala las herramientas en la etapa builder, no en la final'],
            ['<code>pip --no-cache-dir</code> (o <code>PIP_NO_CACHE_DIR=1</code>)', 'Una copia de todo lo que bajó pip: con torch son ≈ 3 GB', 'Ninguno: el cache de pip no sirve dentro de una imagen'],
            ['<code>.dockerignore</code> estricto', 'Checkpoints, datasets, <code>.git</code>, venvs: pueden ser GB', 'Un checkpoint de 2 GB en el directorio termina en la imagen con <code>COPY . .</code>'],
            ['Solo runtime, nunca devel', '≈ 2.5 GB entre <code>-devel</code> y <code>-runtime</code> (CUDA 13.4)', 'Compilar en builder con devel; la final con runtime'],
            ['Wheel de CPU para servicios sin GPU', '≈ 196 MB contra ≈ 3 GB (torch 2.14)', 'Índice <code>cpu</code> de PyTorch; en la imagen no queda nada de CUDA'],
            ['Solo los backends que usas (Triton <code>compose.py</code>)', 'Todo lo que no sea tu backend: mídelo', 'Una imagen propia que mantener y actualizar cada release'],
            ['Distroless', 'Sin shell ni gestor de paquetes: menos MB y menos CVEs', 'No eliges la versión de Python (la fija la distro) y depurar sin shell cuesta; hay tags <code>:debug</code>'],
            ['Alpine', 'La base más chica', 'Usa musl, no glibc: torch y buena parte de la pila de ML no publican wheels para musl. Para ML, evítala'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Optimizar la imagen equivocada', html: `<p>Pasar el gateway de 90 MB a 60 MB no cambia ningún cold start; la imagen de Triton pesa 100× más. Antes de optimizar, pon las dos en una tabla con su tamaño comprimido y el tiempo de pull medido en un nodo real. El trabajo va donde están los GB.</p>` },
          { t: 'h3', text: 'Las palancas grandes para imágenes de GPU' },
          { t: 'p', html: `Una imagen con CUDA no baja de un par de GB por mucho que la recortes. Lo que más mueve el cold start de un pod de GPU es no tener que descargarla en el momento, o descargarla mejor:` },
          { t: 'table', head: ['Palanca', 'Cómo funciona', 'Ojo con'], rows: [
            ['Imagen pre-descargada en la imagen del nodo', 'La AMI del node group GPU (o un disco secundario de arranque en GKE) ya trae la imagen de Triton: el pull es ≈ 0', 'Cada release de la imagen exige una AMI nueva; si solo cambia la capa del modelo, el nodo baja solo esa capa'],
            ['DaemonSet que pre-descarga', 'Un pod en cada nodo GPU hace el pull en cuanto el nodo se une al cluster, antes de que llegue la carga', 'El garbage collector de imágenes del kubelet puede borrar una imagen que ningún contenedor usa cuando el disco pasa su umbral (85 % por defecto)'],
            ['Pull en paralelo', 'SOCI parallel pull (AMIs de EKS con AL2023 y Bottlerocket): baja trozos de capa en paralelo y descomprime varias capas a la vez', 'Necesita un disco rápido: AWS lo midió con 1,000 MiB/s provisionados, no con el default'],
            ['Lazy loading (image streaming)', 'El contenedor arranca antes de tener toda la imagen y los archivos llegan cuando se leen: SOCI en AWS, Image streaming de GKE (Artifact Registry y Docker Hub; por defecto en Autopilot), Artifact Streaming de ACR (tier Premium)', 'Si el proceso lee casi toda la imagen al arrancar (librerías de CUDA, el engine), la espera solo se mueve de lugar. Mide el tiempo hasta readiness, no hasta "Running"'],
            ['Disco del nodo más rápido', 'gp3 con más throughput provisionado (hasta 2,000 MiB/s) o disco NVMe local para el almacenamiento de imágenes', 'Costo por nodo; revisa qué disco usa realmente containerd'],
            ['Registry en la misma región', 'Replicación del repo a cada región donde hay clusters', 'Un pull entre regiones es más lento y cobra transferencia'],
          ] },
          { t: 'callout', kind: 'note', title: 'El kubelet baja de a una imagen', html: `<p>La configuración por defecto del kubelet es <code>serializeImagePulls: true</code>: en un nodo recién creado, los pulls de los DaemonSets del sistema y el de tu imagen de 9 GB van en fila. Algunas AMIs lo cambian; revisa la tuya. Detalle en <a href="#m06.cold-starts">M6</a>.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El cold start completo (nodo, pull, carga de pesos, warmup, readiness) y cómo lo esconde el autoscaling: <a href="#m06.cold-starts">M6</a>. El headroom que absorbe un spike mientras llega la réplica nueva: <a href="#m03.cuantas-gpus">M3</a>. Por qué Triton pesa ≈ 9 GB y otras opciones de servidor: <a href="#m07">M7</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Our GPU image is about 9 GB compressed, so a cold pull takes one to two minutes on top of a two-to-five-minute GPU node boot. I don't rely on the autoscaler for spikes: we keep two warm replicas with headroom, pre-pull the image in the node AMI, and keep the model in the top layer, so a new model version pulls megabytes, not gigabytes."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'pesos-modelo',
        title: 'Pesos del modelo: ¿dentro de la imagen o al arrancar?',
        titleEn: 'Model weights: baked into the image or loaded at startup?',
        priority: 'core',
        dims: ['tradeoffs', 'arquitectura'],
        blocks: [
          { t: 'p', html: `El número decide. El engine FP16 del ResNet-50 del c01 pesa ${E('≈ 50–150 MB')} (<a href="#m04.vram">M4</a>). Un LLM de 8B en BF16 pesa ≈ 16 GB y uno de 70B, ≈ 141 GB (<a href="#m04.bytes-dtype">M4</a>). Con 100 MB, meter los pesos en la imagen es casi gratis; con 141 GB es imposible como una sola capa (ECR limita cada capa a 52,000 MiB, ≈ 54.5 GB) y absurdo en tiempo de pull.` },
          { t: 'calc', title: 'Cuánto tarda en llegar el modelo a cada réplica', rows: [
            { label: 'Ritmo de descarga desde S3 por nodo', expr: 'según la red de la instancia y el paralelismo (rangos de bytes, varios archivos)', value: E('≈ 0.2–1 GB/s') },
            { label: 'Engine del c01 (≈ 0.1 GB)', expr: '0.1 ÷ 0.2–1', value: E('≈ 0.1–0.5 s') },
            { label: 'Llama 3 8B en BF16 (≈ 16 GB)', expr: '16 ÷ 0.2–1', value: E('≈ 16–80 s') },
            { label: 'Llama 3 70B en BF16 (≈ 141 GB)', expr: '141 ÷ 0.2–1', value: E('≈ 2.4–12 min') },
            { label: 'Si esa descarga pasa por un NAT Gateway', expr: '141 GB × ' + E('≈ US$0.045/GB') + ' (procesamiento, us-east-1)', value: E('≈ US$6.3 por réplica que arranca'), note: 'Un VPC endpoint de tipo gateway para S3 no cobra por GB: úsalo' },
          ], result: 'Para una CNN, la ubicación de los pesos es una decisión de trazabilidad y rollback. Para un LLM grande es una decisión de <b>cold start y costo</b>: domina el tiempo de escalar y cada réplica nueva vuelve a pagar la descarga.' },
          { t: 'tradeoffs', items: [
            { option: 'Horneados en la imagen (c01)', verdict: 'elegido',
              pros: 'Un solo artefacto inmutable: el tag de la imagen <b>es</b> la versión del modelo. Rollback = digest anterior. Sin dependencia de S3 al arrancar. Si los pesos van en la última capa, una versión nueva del modelo baja solo esa capa en nodos que ya tienen la base.',
              cons: 'Una imagen por versión de modelo; builds y pushes más pesados; quien puede hacer pull de la imagen puede leer los pesos.',
              why: 'Con un modelo de ≈ 100 MB que cambia una vez al mes, la trazabilidad y el rollback trivial valen más que todo lo demás. Es la elección del <a href="#c01.tradeoffs">c01</a>.' },
            { option: 'Descargados de S3 por el propio servidor al arrancar', verdict: 'depende',
              pros: 'La imagen del servidor no cambia al cambiar el modelo; un mismo servidor sirve versiones distintas por configuración.',
              cons: 'El cold start suma la descarga; S3 pasa a ser dependencia de arranque; el mismo tag de imagen puede servir modelos distintos, así que la versión real del modelo tiene que quedar en logs y métricas.',
              why: 'Razonable con decenas de modelos o cambios diarios, si la ruta incluye la versión (<code>…/llama3-8b/2026-09-01/</code>, nunca un "latest") y el proceso verifica un hash al cargar. Triton lo trae de fábrica (<code>--model-repository=s3://…</code>); el <code>triton/Dockerfile</code> del c01 lo deja comentado como alternativa.' },
            { option: 'Init container que descarga a un volumen del pod', verdict: 'depende',
              pros: 'Separa "traer pesos" de "servir": la imagen del servidor no necesita credenciales de S3 ni CLI de AWS; el servidor arranca con los archivos ya en disco.',
              cons: 'Cada réplica vuelve a descargar; el <code>emptyDir</code> vive en el disco del nodo y se borra con el pod.',
              why: 'El patrón estándar para modelos de pocos GB cuando no quieres hornearlos. KServe lo hace así con su storage initializer.' },
            { option: 'Volumen compartido (EFS, Filestore, FSx for Lustre)', verdict: 'depende',
              pros: 'Los pesos se bajan una vez; muchos pods los montan en solo lectura.',
              cons: 'El throughput del file system compartido pasa a ser el cuello de botella cuando escalan varias réplicas a la vez, y es un punto de falla compartido.',
              why: 'Útil con modelos grandes y varias réplicas por nodo o muchos nodos. Mide el throughput agregado en un scale-out real.' },
            { option: 'Pesos como artifact OCI montados como volumen', verdict: 'depende',
              pros: 'Los pesos viven en el registry, versionados por digest como una imagen, pero separados del servidor. El nodo los descarga y los cachea como a cualquier imagen. Kubernetes lo soporta de forma estable desde 1.36 (<code>volumes[].image</code>).',
              cons: 'Requiere Kubernetes y un runtime de contenedores recientes; el límite de tamaño por capa del registry sigue aplicando; poca experiencia operativa acumulada todavía.',
              why: 'Junta lo mejor de los dos mundos (inmutable y separado). Menciónalo como opción moderna y di qué verificarías antes de adoptarlo.' },
          ] },
          { t: 'table', caption: 'Regla práctica por tamaño de pesos', head: ['Pesos', 'Ejemplo', 'Dónde los pondría', 'Por qué'], rows: [
            ['Hasta ≈ 1 GB', 'ResNet-50, YOLO, un BERT base', 'Horneados, en la última capa', 'Rollback trivial; el pull extra es de segundos'],
            ['≈ 1–20 GB', 'Un LLM de 7–8B, un modelo de difusión', 'Depende: horneados si cambian poco y la imagen está pre-descargada; si no, init container o volumen OCI', 'Empieza a pesar en el cold start; mide ambos caminos'],
            ['Decenas a cientos de GB', 'LLMs de 70B o más', 'Fuera de la imagen: S3 con descarga en paralelo, caché en el disco local del nodo, o un streamer que lee de S3 mientras carga la GPU (vLLM soporta Run:ai Model Streamer)', 'No cabe como capa y domina el cold start (<a href="#c10">c10</a>)'],
          ] },
          { t: 'code', title: 'Init container que baja los pesos a un volumen del pod', files: [
            { name: 'llm-server.yaml', lang: 'yaml', code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-server
spec:
  replicas: 1
  selector:
    matchLabels:
      app: llm-server
  template:
    metadata:
      labels:
        app: llm-server
    spec:
      # ServiceAccount con permiso de SOLO LECTURA al prefijo del modelo (IRSA o EKS Pod Identity)
      serviceAccountName: llm-server
      initContainers:
        - name: fetch-weights
          image: amazon/aws-cli:2.37.5
          # El prefijo incluye la versión del modelo: nada de "latest" en S3 tampoco
          args: ["s3", "sync", "s3://mi-bucket-modelos/llama3-8b/2026-09-01/", "/models/llama3-8b/"]
          volumeMounts:
            - name: models
              mountPath: /models
      containers:
        - name: server
          image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/llm-server:1.4.2
          args: ["--model", "/models/llama3-8b"]
          resources:
            limits:
              nvidia.com/gpu: 1
          volumeMounts:
            - name: models
              mountPath: /models
              # El servidor solo lee: no puede corromper los pesos
              readOnly: true
          # Probes, warmup y el resto del manifest: M6
      volumes:
        - name: models
          # Disco local del nodo: se borra con el pod y cada réplica nueva vuelve a descargar
          emptyDir:
            sizeLimit: 40Gi` },
            { name: 'volumen-oci.yaml', lang: 'yaml', code: `apiVersion: v1
kind: Pod
metadata:
  name: llm-server-oci
spec:
  containers:
    - name: server
      image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/llm-server:1.4.2
      args: ["--model", "/models"]
      volumeMounts:
        - name: models
          mountPath: /models
  volumes:
    - name: models
      # Kubernetes ≥ 1.36 (estable): los pesos son un artifact OCI en el registry, montado en solo lectura.
      # El nodo lo descarga y lo cachea como una imagen; en producción, referencia por digest
      image:
        reference: 123456789012.dkr.ecr.us-east-1.amazonaws.com/llama3-8b-weights:2026-09-01
        pullPolicy: IfNotPresent` },
          ], caption: 'Validados contra el esquema de Kubernetes 1.36. La imagen de <code>aws-cli</code> sale de Docker Hub: en producción, sírvela desde tu registry (<a href="#m05.registries">sección 8</a>).' },
          { t: 'callout', kind: 'senior', title: 'Los pesos son un activo con permisos', html: `<p>Horneados, cualquiera con permiso de pull sobre el repo de imágenes tiene tus pesos: el permiso del registry pasa a ser el permiso del modelo. En S3, puedes dar lectura solo al rol del servidor, cifrar con una llave propia y auditar cada acceso. Nombra esto cuando el modelo es propiedad intelectual de la empresa o se entrenó con datos sensibles (<a href="#m15">M15</a>). Y en cualquier camino, verifica un hash de los pesos al cargarlos: el <code>build_engine.sh</code> del c01 imprime el sha256 del engine para registrarlo.</p>` },
          { t: 'callout', kind: 'trap', title: 'Pesos cargados no es modelo listo', html: `<p>Terminar la descarga no significa poder servir con el SLO: falta cargar en la GPU, inicializar el runtime y hacer el warmup (los primeros requests con cada forma de batch son lentos). La readiness probe solo debe pasar después del warmup; el c01 lo hace con el warmup de <code>config.pbtxt</code> y <code>--strict-readiness</code> (<a href="#m03.load-testing">M3</a>).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For a 100 MB CNN engine I bake the weights into the top layer of the serving image, so the image tag is the model version and a rollback is just the previous digest. For a 70B model that doesn't work: 140 GB won't fit in a single registry layer, so I'd keep versioned weights in S3, download them in parallel to local NVMe, and treat load time as part of the cold start budget."</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'registries',
        title: 'Registries y tags inmutables',
        titleEn: 'Registries and immutable tags',
        priority: 'core',
        dims: ['monitoreo', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `El registry es el almacén de imágenes de donde los nodos hacen pull. En la entrevista no importa cuál uses; importa qué te da y qué política le pones: autenticación, escaneo, replicación, retención y, sobre todo, <b>tags que no se pueden mover</b>.` },
          { t: 'table', head: ['Registry', 'Dónde', 'Lo que te da', 'Detalle que conviene saber'], rows: [
            ['Amazon ECR', 'AWS', 'Auth por IAM, tags inmutables (con exclusiones opcionales), lifecycle policies, escaneo básico o mejorado (Amazon Inspector), replicación entre regiones y cuentas, pull-through cache', 'Capa máxima de 52,000 MiB. El pull-through cache no incluye NGC: las imágenes de NVIDIA se copian a tu repo'],
            ['Artifact Registry', 'Google Cloud', 'Auth por IAM, tags inmutables, cleanup policies, escaneo (Artifact Analysis), repositorios remotos que hacen de caché de Docker Hub y otros', 'Con tags inmutables no puedes borrar imágenes con tag: tus cleanup policies no las tocan'],
            ['Azure Container Registry', 'Azure', 'Auth por Entra ID, geo-replicación (tier Premium), bloqueo de imágenes contra escritura, caché de registries externos, escaneo con Defender for Containers', 'El bloqueo es por imagen o repositorio (<code>--write-enabled false</code>)'],
            ['GitHub Container Registry', 'GitHub', 'Imágenes junto al código y a GitHub Actions', 'Para producción en la nube, replica a un registry de tu nube en la misma región'],
            ['NGC (<code>nvcr.io</code>)', 'NVIDIA', 'Origen de las imágenes de CUDA, PyTorch, TensorRT y Triton, con release mensual <code>YY.MM</code>', 'Algunas imágenes piden una API key; en producción no hagas pull directo desde NGC'],
            ['Docker Hub', 'Público', 'Imágenes oficiales (python, ubuntu…)', 'Límites de pulls: sin autenticar, 100 cada 6 horas por IP. Un cluster detrás de un NAT comparte esa IP'],
          ] },
          { t: 'h3', text: 'Tags inmutables y deploy por digest' },
          { t: 'p', html: `Con tags inmutables, subir otra imagen con un tag que ya existe falla (en ECR, <code>ImageTagAlreadyExistsException</code>). El c01 etiqueta el gateway con el commit (<code>classifier-gateway:3f9c2ab</code>) y Triton con la versión del modelo (<code>classifier-triton:2026-09-01-resnet50-fp16</code>): cada tag nombra exactamente un contenido, para siempre. Un paso más: desplegar por <b>digest</b>, así el manifest de Kubernetes dice qué bytes corren aunque alguien cambie la configuración del repo.` },
          { t: 'diagram', id: 'build-promocion', title: 'Build una vez, promover el mismo digest', caption: 'Nada se reconstruye entre staging y producción: cambia qué digest usa cada entorno. Recorre la release para ver dónde se decide cada cosa.', spec: PROMOCION },
          { t: 'steps', items: [
            { title: 'Construir una vez, en CI', meta: 'build once', html: `<p>Una imagen por commit, para la arquitectura de los nodos, con los tests corriendo contra esa imagen. Reconstruir "lo mismo" para producción produce otra imagen (otra base si no fijaste el digest, otras transitivas, otros timestamps).</p>` },
            { title: 'Identificarla por digest', meta: 'sha256', html: `<p>El push devuelve el digest. Desde ahí, firma, escaneo, staging y producción hablan de ese digest.</p>` },
            { title: 'Escanear y firmar', meta: 'supply chain', html: `<p>Escaneo de CVEs al subir, con una política de qué bloquea. Firma del digest (por ejemplo, cosign de Sigstore, con la identidad OIDC del CI en vez de llaves de larga duración) y una política de admisión en el cluster que rechace imágenes sin firma. Lo básico en entrevista: "escaneo y firma en CI, verificación al admitir".</p>` },
            { title: 'Promover el mismo digest', meta: 'promote', html: `<p>Staging y producción apuntan al mismo digest; entre cuentas o registries se copia sin reconstruir (el digest no cambia al copiar el mismo manifest). Promover es cambiar qué digest usa producción, normalmente con canary (<a href="#m11">M11</a>).</p>` },
            { title: 'Retener lo necesario para volver', meta: 'rollback', html: `<p>Lifecycle policies que borran lo viejo sin tocar las últimas N releases ni lo que está desplegado: el rollback es volver al digest anterior, y tiene que seguir existiendo.</p>` },
          ] },
          { t: 'code', title: 'Build una vez, firmar y desplegar por digest', files: [
            { name: 'release.sh', lang: 'bash', code: `REG=123456789012.dkr.ecr.us-east-1.amazonaws.com
SHA=$(git rev-parse --short HEAD)

# 1) CI construye UNA vez, para la arquitectura de los nodos, con el commit como tag
docker buildx build --platform linux/amd64 -t $REG/classifier-gateway:$SHA --push gateway/

# 2) El digest es la identidad: se firma, se escanea y se despliega
DIGEST=$(crane digest $REG/classifier-gateway:$SHA)

# 3) Firma del digest (keyless con la identidad OIDC del CI)
cosign sign --yes $REG/classifier-gateway@$DIGEST

# 4) Staging y producción usan el MISMO digest (en GitOps, este valor va al repo de manifests)
kubectl -n classifier set image deployment/gateway gateway=$REG/classifier-gateway@$DIGEST

# Otra cuenta u otra región: copiar sin reconstruir conserva el digest
# crane copy $REG/classifier-gateway@$DIGEST $REG_PROD/classifier-gateway:$SHA` },
          ] },
          { t: 'callout', kind: 'trap', title: ':latest en producción', html: `<p>Tres problemas en uno. (1) No sabes qué versión corre: dos pods creados antes y después de un push corren imágenes distintas con el mismo nombre. (2) Kubernetes pone <code>imagePullPolicy: Always</code> por defecto cuando el tag es <code>:latest</code> o falta: cada arranque consulta el registry, y si el registry falla, el pod no arranca. (3) No hay rollback: <code>latest</code> ya apunta a la versión rota. El entrevistador anota "no piensa en operación".</p>` },
          { t: 'callout', kind: 'trap', title: 'La lifecycle policy borró tu rollback', html: `<p>"Borra imágenes de más de 30 días" suena a higiene hasta que la versión estable a la que necesitas volver tiene 31 días. Las reglas de retención cuentan releases (conserva las últimas N) y nunca tocan lo que está desplegado en algún entorno.</p>` },
          { t: 'callout', kind: 'note', title: 'Pull-through cache y mirrors', html: `<p>Un pull-through cache (ECR, repositorios remotos de Artifact Registry, caché de ACR) hace que tus nodos bajen imágenes públicas desde tu registry: menos dependencia de Docker Hub y sus límites, pulls desde la misma región y un lugar donde escanear. Para imágenes que el cache no soporta, como las de NGC en ECR, copia la imagen a tu repo en CI y fíjala por digest.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>Internals de Sigstore, SBOMs, provenance (SLSA), políticas de admisión y sintaxis de lifecycle policies: para un rol de plataforma o seguridad, sí; en la ronda de ML System Design basta la frase del paso 3.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>La imagen es la mitad de la reproducibilidad; la otra son el dataset y el modelo registrado (<a href="#m10">M10</a>). Canary y rollback automático: <a href="#m11">M11</a>. Rolling update y <code>kubectl rollout undo</code>: <a href="#m06">M6</a> y la <a href="#ref-comandos.rollouts">hoja de comandos</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"We build each image once in CI, tag it with the commit, and deploy it by digest. Tags are immutable in the registry, staging and production run the same digest, and a rollback means pointing back to the previous digest, which our retention policy always keeps."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'compose-local',
        title: 'docker compose para desarrollo local',
        titleEn: 'docker compose for local development',
        priority: 'extra',
        dims: ['arquitectura', 'comunicacion'],
        blocks: [
          { t: 'p', html: `El <code>docker-compose.yml</code> del c01 levanta el sistema completo en una máquina con GPU: gateway, Triton y Prometheus, con un solo <code>docker compose up --build</code>. Sirve para desarrollar, para pruebas de integración en CI y para reproducir un bug con las mismas imágenes que producción.` },
          { t: 'code', title: 'reference/c01/docker-compose.yml', files: [
            { name: 'docker-compose.yml', lang: 'yaml', src: 'c01/docker-compose.yml', note: 'Validado con <code>docker compose config</code>; levantarlo requiere GPU NVIDIA, driver y NVIDIA Container Toolkit, y el engine ya construido.' },
          ] },
          { t: 'list', items: [
            `<b>Nombres de servicio como DNS.</b> Compose crea una red donde cada servicio se resuelve por su nombre: el gateway llama a <code>TRITON_URL: "triton:8000"</code>. En Kubernetes, el mismo papel lo cumple el Service (<code>triton.classifier.svc.cluster.local:8000</code>). Las variables de entorno son las mismas; cambian los valores.`,
            `<b>El orden de arranque depende de la salud, no del inicio.</b> Triton tiene un healthcheck contra <code>/v2/health/ready</code> con <code>start_period: 60s</code> (cargar el engine tarda), y el gateway declara <code>depends_on</code> con <code>condition: service_healthy</code>: no arranca hasta que el modelo está listo, y así evitas los 503 del arranque.`,
          ] },
          { t: 'table', caption: 'Lo mismo en Compose y en Kubernetes', head: ['Necesidad', 'Compose (c01)', 'Kubernetes (c01)'], rows: [
            ['¿Está listo para recibir tráfico?', '<code>healthcheck</code> + <code>depends_on: condition: service_healthy</code>', '<code>readinessProbe</code> (y <code>startupProbe</code> mientras carga el engine)'],
            ['Reiniciar si muere', '<code>restart: unless-stopped</code>', 'El kubelet reinicia el contenedor; la <code>livenessProbe</code> detecta cuelgues'],
            ['GPU', '<code>deploy.resources.reservations.devices</code>', '<code>resources.limits: nvidia.com/gpu: 1</code> + nodos GPU con taint'],
            ['Encontrar a otro servicio', 'Nombre del servicio en la red de Compose', 'Service de Kubernetes (DNS del cluster)'],
            ['Memoria compartida', '<code>shm_size: 1g</code>', '<code>emptyDir</code> con <code>medium: Memory</code> en <code>/dev/shm</code>'],
            ['Varias réplicas y escalar', '<code>docker compose up --scale</code>, a mano y en un solo host', 'HPA / KEDA sobre muchos nodos (<a href="#m06">M6</a>)'],
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué no en producción', html: `<p>Compose corre en <b>un</b> host. Si ese host o su GPU se cae, se cae todo: no hay otro nodo al que mover los contenedores. No escala según la carga, no reparte réplicas entre zonas, no hace rolling updates esperando readiness, y el <code>restart</code> solo sirve mientras el host vive. Para un servicio con 99.9 % de disponibilidad y dos GPUs en dos zonas (el c01), necesitas un orquestador: <a href="#m06">M6</a>. Para un prototipo interno en una sola VM con GPU, Compose con <code>restart</code> es una respuesta honesta, siempre que digas qué pierdes.</p>` },
          { t: 'callout', kind: 'skip', html: `<p><code>profiles</code>, <code>develop.watch</code>, <code>extends</code>, overrides con varios archivos y Swarm: útiles en el día a día, nunca en la ronda de diseño.</p>` },
          { t: 'h3', text: 'Preguntas de seguimiento' },
          { t: 'followups', items: [
            { q: '¿Por qué tu imagen de serving pesa 9 GB y qué haces al respecto?',
              junior: 'Porque tiene CUDA. Usaría una imagen más chica, tipo Alpine.',
              senior: 'Son ≈ 9 GB comprimidos porque la imagen de Triton de NGC trae la pila completa de CUDA, cuDNN, TensorRT y todos los backends. Recortarla ayuda poco (lo mínimo con CUDA son un par de GB), y Alpine no sirve porque torch no publica wheels para musl. Así que ataco el tiempo, no solo el tamaño: la imagen viene pre-descargada en la AMI del node group GPU, el modelo va en la última capa para que una versión nueva baje MB, y mantengo 2 réplicas calientes con headroom porque un nodo GPU nuevo tarda minutos igual. Si hiciera falta, construiría una imagen solo con el backend de TensorRT y probaría pull en paralelo.',
              why: 'Explica de dónde salen los GB, descarta una idea mala con una razón concreta y ataca el síntoma real (el cold start) con palancas priorizadas.' },
            { q: '¿Dónde viven los pesos del modelo?',
              junior: 'En S3, y el servidor los descarga al arrancar.',
              senior: 'Depende del tamaño. El engine del caso 1 pesa ≈ 100 MB, así que va horneado en la última capa de la imagen de Triton: el tag es la versión del modelo y el rollback es el digest anterior. Si fuera un LLM de 70B (≈ 141 GB), no cabe como capa en el registry y domina el cold start: lo pondría versionado en S3, con descarga en paralelo a NVMe local o un streamer, verificación de hash al cargar, y el tiempo de carga dentro del presupuesto de cold start.',
              why: 'Decide con el número, muestra las dos puntas y nombra trazabilidad, rollback y seguridad en vez de dar una única respuesta fija.' },
            { q: '¿Cómo garantizas que producción corre exactamente lo que probaste?',
              junior: 'Usamos el mismo Dockerfile en staging y en producción.',
              senior: 'El mismo Dockerfile no garantiza la misma imagen: la base, las transitivas o la hora del build cambian. Construyo una vez en CI, con base fijada por digest y dependencias con <code>==</code> y hashes; los tests corren contra esa imagen; el registry tiene tags inmutables; staging y producción despliegan el mismo digest, firmado, y el cluster rechaza imágenes sin firma. Rollback = digest anterior, que la política de retención conserva.',
              why: 'Distingue "misma receta" de "mismo artefacto" y cierra el ciclo con deploy por digest, firma y retención.' },
            { q: 'Tu servicio de PyTorch pasa a Kubernetes y el p99 es 40× peor que en tu prueba local con GPU. ¿Qué revisas primero?',
              junior: 'Aumentaría las réplicas o pediría una GPU más grande.',
              senior: 'Primero, si de verdad usa la GPU: que el pod pida <code>nvidia.com/gpu</code> en sus límites, que <code>torch.cuda.is_available()</code> dé <code>True</code> dentro del contenedor y que el proceso aparezca en <code>nvidia-smi</code> del nodo. Sin GPU asignada, o con un CUDA más nuevo que el driver del nodo, el código con fallback corre en CPU sin un error. Después comparo <code>torch.version.cuda</code> con el driver, y recién entonces miro capacidad: colas, batching, CPU del preproceso. Y agrego un chequeo al arrancar para que esto sea un CrashLoop visible y no un p99 misterioso.',
              why: 'Sospecha del empaquetado antes que de la capacidad: es la falla silenciosa más común al mover un modelo a contenedores, y la convierte en una falla ruidosa.' },
            { q: '¿Correrías esto con docker compose en producción?',
              junior: 'Sí, compose ya levanta todo y reinicia los contenedores si se caen.',
              senior: 'Para el caso 1, no: pedimos 99.9 % con dos GPUs en dos zonas, y Compose vive en un solo host, sin failover, sin autoscaling y sin rolling updates que esperen readiness. Lo uso para desarrollo y para pruebas de integración en CI con las mismas imágenes. Para un prototipo interno en una sola VM con GPU sí lo aceptaría, diciendo explícitamente que una caída del host es una caída del servicio.',
              why: 'Responde con los requisitos del caso y reconoce cuándo la herramienta simple sí alcanza.' },
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, vuelve a las secciones 4, 6 y 7: son las que salen en entrevista.` },
          { t: 'quiz', items: [
            { q: 'Un contenedor con CUDA 12.6 corre en un nodo. ¿Qué parte de la pila de GPU NO viene en la imagen?',
              options: ['cuDNN', 'El runtime de CUDA (cudart)', 'El módulo del kernel del driver de NVIDIA y libcuda', 'TensorRT'], answer: 2,
              explain: 'El driver es del host: su módulo vive en el kernel del nodo y el NVIDIA Container Toolkit monta libcuda al arrancar. Todo lo demás viaja en la imagen.' },
            { q: 'Dentro del contenedor, <code>nvidia-smi</code> muestra "CUDA Version: 12.2" y tu imagen trae CUDA 12.6. ¿Qué significa?',
              options: ['El driver del host soporta hasta CUDA 12.2; la imagen puede correr por minor version compatibility, con límites', 'La imagen está rota', 'El toolkit reemplazó el CUDA de la imagen por 12.2', 'Hay que instalar el driver 12.6 dentro de la imagen'], answer: 0,
              explain: 'La cabecera de nvidia-smi informa lo que soporta el driver. Una app 12.x corre con un driver ≥ 525 por minor version compatibility (sin JIT de PTX ni funciones que pidan un driver nuevo). El driver nunca va dentro de la imagen.' },
            { q: 'Cambias solo <code>main.py</code> y el build reinstala todas las dependencias. ¿Causa más probable?',
              options: ['Falta --no-cache-dir', 'La base es slim', 'Usas multi-stage', '<code>COPY . .</code> está antes de <code>pip install</code>'], answer: 3,
              explain: 'La caché se rompe hacia abajo: cualquier cambio en lo copiado invalida el pip install que viene después. Se copia primero el archivo de dependencias y el código al final.' },
            { q: 'Tu Dockerfile tiene <code>RUN pip install -r requirements.txt</code> y en la línea siguiente <code>RUN rm -rf /root/.cache/pip</code>. ¿Se achica la imagen?',
              options: ['Sí, se borra el cache', 'Solo si usas BuildKit', 'No: el cache sigue en la capa anterior; la nueva solo lo marca como borrado', 'Solo en imágenes multi-stage'], answer: 2,
              explain: 'Las capas son diffs: borrar en una capa posterior agrega un whiteout y no quita bytes de abajo. Se limpia en el mismo RUN o se evita con PIP_NO_CACHE_DIR=1.' },
            { q: 'La imagen de Triton del c01 pesa ≈ 9.2 GB comprimidos y el nodo la baja a ≈ 0.1 GB/s efectivos. ¿Cuánto tarda el pull?',
              options: ['≈ 90 s', '≈ 9 s', '≈ 15 min', '≈ 1 s'], answer: 0,
              explain: '9.2 ÷ 0.1 ≈ 92 s: cerca de un minuto y medio, que se suma a los minutos del nodo GPU nuevo. Por eso mínimo caliente, headroom e imágenes pre-descargadas.' },
            { q: 'Llama 3 70B en BF16 (≈ 141 GB). ¿Hornear los pesos en la imagen y subirla a ECR?',
              options: ['Sí, es lo más reproducible', 'Sí, si usas tags inmutables', 'Sí, con compresión zstd entra', 'No como una sola capa: ECR limita cada capa a 52,000 MiB, y el pull dominaría el cold start'], answer: 3,
              explain: '141 GB supera el máximo por capa de ECR (≈ 54.5 GB), y aunque partieras en capas, cada réplica nueva bajaría 141 GB. Pesos versionados en S3, descarga en paralelo o streamer. Y los pesos casi no se comprimen.' },
            { q: '¿Qué hace Kubernetes por defecto con <code>image: mi-app:latest</code> sin <code>imagePullPolicy</code>?',
              options: ['IfNotPresent', 'Always', 'Never', 'Rechaza el manifest'], answer: 1,
              explain: 'Con :latest (o sin tag) el default es Always: cada arranque consulta el registry. Además no sabes qué versión corre ni puedes volver atrás.' },
            { q: 'Staging pasó todas las pruebas. ¿Cuál es la forma correcta de llevar el gateway a producción?',
              options: ['Reconstruir la imagen desde el mismo commit en el pipeline de producción', 'Subir la imagen con el tag latest', 'Apuntar producción al mismo digest que probó staging', 'Copiar el Dockerfile al cluster de producción'], answer: 2,
              explain: 'Build once, promote: reconstruir produce otra imagen (otra base, otras transitivas). El digest garantiza que corre lo que probaste.' },
            { q: 'Construiste la imagen en una Mac con Apple Silicon y en EKS (nodos x86) el contenedor muere con <code>exec format error</code>. ¿Qué pasó?',
              options: ['La imagen salió arm64: hay que construirla en CI con <code>--platform linux/amd64</code>', 'El pod se quedó sin memoria', 'El driver de NVIDIA del nodo es viejo', 'El tag de la imagen es mutable'], answer: 0,
              explain: 'El binario es de otra arquitectura de CPU. Se construye en CI para la plataforma de los nodos (o multi-arquitectura a propósito). Si el registry guardó un índice sin variante amd64, el síntoma es otro: el pull falla con "no match for platform".' },
          ] },
          { t: 'checklist', id: 'antes-de-empaquetar', items: [
            { id: 'multistage', html: 'La imagen final no tiene compiladores ni headers: multi-stage, base <code>slim</code> o <code>-runtime</code>, nunca <code>-devel</code>.' },
            { id: 'pinned', html: 'Base fijada por digest y dependencias con <code>==</code> (transitivas incluidas), generadas con un lockfile.' },
            { id: 'orden', html: 'Dependencias antes que el código; el modelo, si va horneado, en la última capa.' },
            { id: 'dockerignore', html: '<code>.dockerignore</code> deja fuera datasets, checkpoints, venvs, <code>.git</code> y <code>.env</code>.' },
            { id: 'secretos', html: 'Ningún secreto en <code>ARG</code>, <code>ENV</code> ni en capas: secretos de build con <code>--mount=type=secret</code>, de runtime por Secret.' },
            { id: 'nonroot', html: 'Usuario con UID numérico y <code>runAsNonRoot</code> en el pod.' },
            { id: 'proceso', html: 'Un proceso por contenedor, <code>CMD</code> en forma exec, y un servidor que termina los requests en curso al recibir SIGTERM.' },
            { id: 'driver', html: 'Sé qué CUDA trae la imagen y qué driver tienen los nodos, y el servicio falla al arrancar si no ve la GPU.' },
            { id: 'engine', html: 'El engine de TensorRT se construye con la misma release de NGC y en el mismo tipo de GPU que el serving.' },
            { id: 'pesos', html: 'Decidí dónde viven los pesos según su tamaño, con versión explícita y hash verificado al cargar.' },
            { id: 'tamano', html: 'Conozco el tamaño comprimido y el tiempo de pull medido de la imagen de GPU, y tengo una palanca para el cold start (pre-pull, streaming, mínimo caliente).' },
            { id: 'digest', html: 'Tags inmutables, deploy por digest, retención de las últimas releases para rollback; build en CI para <code>linux/amd64</code>.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm05-01', kind: 'concepto', q: '¿Qué garantiza una imagen de contenedor y qué no?',
        a: 'Garantiza el userland: Python, wheels, librerías del sistema y de CUDA, tu código y su configuración, identificados por digest. No garantiza el kernel (compartido con el host), el driver de NVIDIA (lo pone el host), la GPU física ni la arquitectura de CPU, ni los datos o pesos que bajes al arrancar.' },
      { id: 'm05-02', kind: 'concepto', q: 'Imagen vs contenedor.',
        a: 'Imagen: plantilla inmutable de capas de solo lectura más configuración, identificada por digest; vive en el registry y en la caché de cada nodo. Contenedor: proceso corriendo sobre una imagen con una capa escribible efímera; de una imagen salen muchas réplicas.' },
      { id: 'm05-03', kind: 'concepto', q: '¿Por qué importa el orden de las instrucciones de un Dockerfile?',
        a: 'La caché se rompe hacia abajo: si una instrucción cambia, todas las siguientes se reconstruyen. Lo que cambia poco va arriba (base, dependencias) y lo que cambia seguido abajo (código, modelo). Así un deploy de código mueve KB y no GB por nodo.' },
      { id: 'm05-04', kind: 'trampa', q: 'Borras el cache de pip en un RUN posterior al pip install. ¿Se achica la imagen?',
        a: 'No. Las capas son diffs: el cache sigue en la capa del pip install y la nueva solo lo marca como borrado (whiteout). Se limpia en el mismo RUN o se evita con PIP_NO_CACHE_DIR=1.' },
      { id: 'm05-05', kind: 'concepto', q: 'Tag vs digest.',
        a: 'El tag es un nombre que apunta a una imagen y puede moverse (salvo con tags inmutables). El digest es el SHA-256 del manifest: identifica el contenido y no puede cambiar. Se despliega por digest para saber exactamente qué bytes corren y poder volver atrás.' },
      { id: 'm05-06', kind: 'numero', q: 'Tamaños comprimidos (amd64): gateway del c01, nvidia/cuda runtime y devel, tritonserver 24.08, pytorch 24.08.',
        a: 'Gateway ≈ 0.09 GB (python:3.13-slim ≈ 43 MB + wheels ≈ 44 MB) · cuda runtime ≈ 1.5–1.9 GB · devel ≈ 4–5 GB · tritonserver:24.08-py3 ≈ 9.2 GB · pytorch:24.08-py3 ≈ 10.2 GB. En disco ocupan más.' },
      { id: 'm05-07', kind: 'concepto', q: 'La regla de compatibilidad entre driver y CUDA en contenedores.',
        a: 'El driver vive en el host y el CUDA runtime en la imagen: el driver del nodo debe soportar el CUDA de la imagen. Un driver nuevo corre CUDA viejo; al revés, solo con minor version compatibility (dentro de una versión mayor, con límites) o con el paquete de forward compatibility en GPUs de data center.' },
      { id: 'm05-08', kind: 'numero', q: 'Driver mínimo de minor version compatibility para CUDA 12.x y 13.x (Linux x86_64).',
        a: '12.x: ≥ 525. 13.x: ≥ 580. Límites: sin compilación de PTX en runtime y error en funciones que pidan un driver más nuevo.' },
      { id: 'm05-09', kind: 'trampa', q: 'nvidia-smi dentro del contenedor dice "CUDA Version: 12.2". ¿Es el CUDA de tu imagen?',
        a: 'No: es el CUDA más nuevo que soporta el driver del host. El de la imagen se ve con torch.version.cuda, la variable CUDA_VERSION de las imágenes nvidia/cuda o las notas de la release de NGC.' },
      { id: 'm05-10', kind: 'trampa', q: '¿Por qué no usar una imagen CUDA -devel en producción?',
        a: 'Trae nvcc, headers y librerías estáticas que no necesitas para servir: ≈ 2.5 GB más que -runtime en cada pull y cold start, más CVEs y un compilador disponible para un atacante. Se usa solo en la etapa builder.' },
      { id: 'm05-11', kind: 'trampa', q: 'pip install torch (2.14, de PyPI) en una imagen que corre en nodos T4 con driver R535. ¿Qué pasa?',
        a: 'Esa wheel trae CUDA 13.0, que pide driver ≥ 580: "driver too old" y torch.cuda.is_available() da False; si el código no lo verifica, corre en CPU. Usa el índice cu126 (CUDA 12.6, driver ≥ 525) o actualiza el driver del nodo.' },
      { id: 'm05-12', kind: 'concepto', q: '¿Qué hace el NVIDIA Container Toolkit?',
        a: 'Al crear el contenedor monta los device nodes de la GPU asignada, las librerías del driver del host (libcuda, NVML) y nvidia-smi. Por eso la imagen no trae driver. Se usa con --gpus, con CDI (--device nvidia.com/gpu=all) o, en Kubernetes, vía el device plugin.' },
      { id: 'm05-13', kind: 'trampa', q: 'Olvidaste --gpus (o el límite nvidia.com/gpu en el pod). ¿Qué ves?',
        a: 'Nada que avise: torch.cuda.is_available() da False y un servicio con fallback a CPU corre decenas de veces más lento. Verifica la GPU al arrancar y termina el proceso si falta.' },
      { id: 'm05-14', kind: 'numero', q: 'Tiempo de pull de la imagen de Triton del c01 y de un pod nuevo de Triton completo.',
        a: '≈ 9.2 GB a ≈ 0.08–0.15 GB/s efectivos ≈ 1–2 min. Pod completo con nodo GPU nuevo ≈ 3–7 min (nodo ≈ 2–5 min + pull + carga y warmup). Referencia de AWS: ≈ 10 GB en ≈ 1 min 53 s estándar, ≈ 45 s con SOCI parallel pull.' },
      { id: 'm05-15', kind: 'tradeoff', q: 'Palancas para bajar el cold start de una imagen de GPU, por impacto.',
        a: 'No descargarla en el momento (pre-descargada en la AMI o por un DaemonSet), descargarla mejor (pull en paralelo, lazy loading/streaming, disco más rápido, registry en la región), mover el modelo a la última capa, y recién después recortarla (runtime en vez de devel, solo los backends que usas). Y mínimo caliente con headroom.' },
      { id: 'm05-16', kind: 'tradeoff', q: 'Pesos horneados en la imagen vs descargados al arrancar.',
        a: 'Horneados: un artefacto inmutable, tag = versión del modelo, rollback = digest anterior, sin S3 en el arranque; pero una imagen por versión y quien hace pull lee los pesos. Descargados: imagen estable y modelos intercambiables, pero cold start más largo, S3 como dependencia y la versión real tiene que quedar registrada. Decide el tamaño.' },
      { id: 'm05-17', kind: 'numero', q: '¿Por qué no hornear Llama 3 70B en BF16 en una imagen de ECR?',
        a: '≈ 141 GB contra un máximo de 52,000 MiB (≈ 54.5 GB) por capa en ECR; y aunque partieras en capas, cada réplica nueva bajaría 141 GB. A ≈ 0.2–1 GB/s son ≈ 2.4–12 min por réplica.' },
      { id: 'm05-18', kind: 'concepto', q: '"Build once, promote": ¿qué significa?',
        a: 'La imagen se construye una sola vez en CI, se prueba, escanea y firma por su digest, y staging y producción despliegan ese mismo digest. Reconstruir para producción daría otra imagen (otra base, otras transitivas).' },
      { id: 'm05-19', kind: 'trampa', q: 'Tres problemas de usar :latest en producción.',
        a: 'No sabes qué versión corre (pods distintos con el mismo nombre); Kubernetes pone imagePullPolicy: Always por defecto, así que cada arranque depende del registry; y no hay rollback porque latest ya apunta a la versión rota.' },
      { id: 'm05-20', kind: 'trampa', q: 'Una lifecycle policy "borra imágenes de más de 30 días". ¿Qué puede salir mal?',
        a: 'Borrar la release estable a la que necesitas volver. La retención se define por releases (conserva las últimas N) y nunca toca lo que está desplegado.' },
      { id: 'm05-21', kind: 'concepto', q: '¿Por qué docker compose no alcanza para el caso 1 en producción?',
        a: 'Corre en un solo host: sin failover a otro nodo o zona, sin autoscaling, sin rolling updates que esperen readiness; restart solo sirve mientras el host vive. Con 99.9 % y dos GPUs en dos zonas necesitas un orquestador. Compose sirve para desarrollo e integración en CI.' },
      { id: 'm05-22', kind: 'trampa', q: '¿Qué pasa con FROM python:3.13-slim # base en un Dockerfile?',
        a: 'El # solo es comentario al inicio de la línea; en otro lugar es un argumento más, así que FROM (o COPY, ENV) falla o hace otra cosa. En un RUN "funciona" porque lo interpreta el shell. Los comentarios van en su propia línea.' },
      { id: 'm05-23', kind: 'frase', q: 'En inglés: ¿por qué tu imagen de GPU pesa 9 GB y cómo manejas el cold start?',
        a: '"It\'s about 9 GB compressed, mostly CUDA, cuDNN and TensorRT, so a cold pull takes one to two minutes on top of the GPU node boot. We pre-pull it in the node image, keep two warm replicas, and put the model in the top layer so a new version only pulls megabytes."' },
      { id: 'm05-24', kind: 'frase', q: 'En inglés: ¿dónde viven los pesos?',
        a: '"For a 100 MB engine, I bake the weights into the image, so the tag is the model version and a rollback is the previous digest. For a 140 GB model, I keep versioned weights in S3 and budget the download as part of the cold start."' },
      { id: 'm05-25', kind: 'frase', q: 'En inglés: ¿cómo garantizas que producción corre lo que probaste?',
        a: '"We build once in CI, tag with the commit, and deploy by digest. Tags are immutable, staging and production run the same signed digest, and rolling back means pointing to the previous digest."' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'container image', es: 'imagen de contenedor', def: 'Paquete inmutable con el filesystem (capas de solo lectura) y la configuración para arrancar un proceso: Python, librerías, CUDA, código. Se identifica por su digest.', say: 'Each tier ships as its own container image.' },
      { en: 'container', es: 'contenedor', def: 'Proceso aislado (procesos, red, filesystem) que corre sobre una imagen con una capa escribible efímera. Comparte el kernel del host: no es una VM.', say: 'The container shares the host kernel, so the NVIDIA driver has to come from the node.' },
      { en: 'image layer', es: 'capa de la imagen', def: 'Diff de filesystem que produce cada RUN, COPY o ADD. Las capas se apilan, se comparten por digest entre imágenes y borrar en una capa posterior no las achica.', say: 'The model sits in the top layer, so a new version only pulls a few megabytes.' },
      { en: 'build cache', es: 'caché de build', def: 'Reutilización de capas ya construidas mientras la instrucción y todo lo anterior no cambien. Cuando una instrucción cambia, se reconstruye todo lo que sigue.', say: 'Dependencies go before the code so the build cache survives a code change.' },
      { en: 'multi-stage build', es: 'build en varias etapas', def: 'Dockerfile con varias etapas FROM: una compila o instala con herramientas completas y la final copia solo el resultado. Deja fuera compiladores, headers y caches.', say: 'A multi-stage build keeps the compilers out of the runtime image.' },
      { en: 'base image', es: 'imagen base', def: 'La imagen del FROM sobre la que se construye la tuya (python:3.13-slim, nvidia/cuda, una de NGC). Fija el sistema operativo y, en GPU, casi siempre la versión de CUDA.', say: 'We pin the base image by digest.' },
      { en: 'image digest', es: 'digest de la imagen', def: 'Hash SHA-256 del manifest de una imagen: identifica su contenido y no puede apuntar a otra cosa. Se usa para desplegar, firmar y hacer rollback exacto.', say: 'Production runs the same image digest that passed staging.' },
      { en: 'image tag', es: 'tag de imagen', def: 'Nombre legible que apunta a una imagen (classifier-gateway:3f9c2ab). Por defecto se puede mover; latest no es especial salvo por convención y por el pull policy de Kubernetes.', say: 'We tag images with the git commit, never with latest.' },
      { en: 'container registry', es: 'registry de contenedores', def: 'Servicio que almacena y sirve imágenes (ECR, Artifact Registry, ACR, GHCR, NGC). Aporta autenticación, escaneo, replicación y retención.', say: 'The nodes pull from a registry in the same region.' },
      { en: 'tag immutability', es: 'tags inmutables', def: 'Configuración del repositorio que impide subir otra imagen con un tag existente: cada tag nombra un solo contenido para siempre.', say: 'With tag immutability, a tag can never point to a different build.' },
      { en: 'image promotion', es: 'promoción de imágenes', def: 'Llevar entre entornos (staging → producción) la misma imagen ya probada, por digest, sin reconstruirla.', say: 'We build once and promote the same digest from staging to production.' },
      { en: 'build context', es: 'contexto de build', def: 'Los archivos que se envían al builder al construir (normalmente el directorio actual). Lo que no excluyes puede terminar en la imagen.', say: 'The build context excludes datasets and checkpoints.' },
      { en: '.dockerignore', es: 'archivo .dockerignore', def: 'Lista de rutas que no entran al contexto de build: datasets, checkpoints, venvs, .git, secretos locales.', say: 'The .dockerignore keeps a two-gigabyte checkpoint out of the image.' },
      { en: 'distroless image', es: 'imagen distroless', def: 'Imagen base sin shell ni gestor de paquetes, solo con el runtime del lenguaje. Menos tamaño y CVEs, a cambio de depurar más difícil y no elegir la versión del runtime.', say: 'A distroless base cuts the CVE count, but debugging without a shell is harder.' },
      { en: 'NVIDIA driver', es: 'driver de NVIDIA', def: 'Módulo del kernel más librerías de usuario (libcuda, NVML) instalados en el host. Su versión fija el CUDA más nuevo que puede correr; no va dentro de la imagen.', say: 'The NVIDIA driver comes from the node image, not from the container.' },
      { en: 'CUDA toolkit', es: 'toolkit de CUDA', def: 'Compilador nvcc, headers y librerías de CUDA. Para servir basta con las librerías de runtime (cudart, cuBLAS, cuDNN), que viajan en la imagen.', say: 'The CUDA toolkit only belongs in the builder stage.' },
      { en: 'CUDA minor version compatibility', es: 'compatibilidad de versión menor de CUDA', def: 'Desde CUDA 11, una app compilada con cualquier versión menor de una mayor corre con el driver mínimo de esa mayor (≥ 525 para 12.x, ≥ 580 para 13.x), sin JIT de PTX ni funciones que pidan un driver más nuevo.', say: 'Thanks to minor version compatibility, a CUDA 12.6 image runs on a 525-series driver, with some limits.' },
      { en: 'CUDA forward compatibility', es: 'compatibilidad hacia adelante de CUDA', def: 'Paquete cuda-compat que permite correr un CUDA más nuevo sobre ramas de driver más viejas soportadas, solo en GPUs de data center (y algunas RTX y Jetson). Las imágenes de NGC lo incluyen.', say: 'On data center GPUs, forward compatibility lets the NGC image run on an older driver branch.' },
      { en: 'NVIDIA Container Toolkit', es: 'NVIDIA Container Toolkit', def: 'Componentes del host que, al crear un contenedor, montan los devices de la GPU, las librerías del driver y nvidia-smi. Habilita --gpus, CDI y el runtime de Kubernetes.', say: 'The NVIDIA Container Toolkit injects the driver libraries when the container starts.' },
      { en: 'Container Device Interface (CDI)', es: 'interfaz de dispositivos para contenedores', def: 'Especificación estándar para exponer dispositivos (GPUs) a los contenedores. Docker la trae activada desde Engine 28.3: docker run --device nvidia.com/gpu=all.', say: 'With CDI, requesting a GPU looks the same in Docker, Podman and containerd.' },
      { en: 'NGC', es: 'catálogo NGC de NVIDIA', def: 'Catálogo de NVIDIA (nvcr.io) con imágenes de CUDA, PyTorch, TensorRT y Triton, publicadas cada mes (YY.MM) con versiones probadas en conjunto. Pesan varios GB.', say: 'We pin the NGC release, and build the engine with the same one.' },
      { en: 'cuDNN', es: 'cuDNN', def: 'Librería de NVIDIA con primitivas de deep learning (convoluciones, normalizaciones) sobre CUDA. Viaja en la imagen o como wheel de pip.', say: 'The runtime image already includes cuDNN, so we don\'t install it again.' },
      { en: 'image pull', es: 'descarga de la imagen', def: 'Bajar del registry las capas que el nodo no tiene, descomprimirlas y escribirlas en disco antes de arrancar el contenedor. Con imágenes de GPU es parte importante del cold start.', say: 'The image pull adds one to two minutes to every cold start on a fresh node.' },
      { en: 'lazy image loading', es: 'carga diferida de imágenes', def: 'Arrancar el contenedor antes de tener toda la imagen y traer los archivos cuando se leen (image streaming): SOCI, GKE Image streaming, ACR Artifact Streaming.', say: 'Lazy loading helps only if the process doesn\'t read the whole image at startup.' },
      { en: 'pre-pulled image', es: 'imagen pre-descargada', def: 'Imagen que ya está en el disco del nodo antes de que llegue el pod: horneada en la imagen del nodo o descargada por un DaemonSet.', say: 'We ship the Triton image pre-pulled in the GPU node AMI.' },
      { en: 'pull-through cache', es: 'caché de registries externos', def: 'Función del registry que guarda copias de imágenes públicas (Docker Hub, GHCR, Quay) para que los nodos las bajen desde tu registry.', say: 'A pull-through cache keeps us off Docker Hub rate limits.' },
      { en: 'image signing', es: 'firma de imágenes', def: 'Firmar criptográficamente el digest de una imagen (cosign, de Sigstore) y verificar la firma al admitir pods en el cluster.', say: 'CI signs the digest and the cluster only admits signed images.' },
      { en: 'init container', es: 'contenedor de inicialización', def: 'Contenedor del pod que corre hasta terminar antes de los contenedores principales; por ejemplo, para bajar pesos de S3 a un volumen.', say: 'An init container downloads the weights before the server starts.' },
      { en: 'image volume', es: 'volumen desde una imagen OCI', def: 'Volumen de Kubernetes (estable desde 1.36) que monta en solo lectura el contenido de una imagen o artifact OCI del registry, por ejemplo los pesos del modelo.', say: 'An image volume lets us version the weights in the registry without baking them into the server image.' },
      { en: 'baked-in model', es: 'modelo horneado en la imagen', def: 'Pesos o engine copiados dentro de la imagen de serving: el tag de la imagen es la versión del modelo y el rollback es el digest anterior.', say: 'The model is baked into the image, so rolling back is just deploying the previous digest.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
