/* =============================================================================
   Ronda de Diseño ML — js/content/ref-comandos.js
   Parte 4 · Hoja de referencia "Docker y kubectl": comandos, flags clave y cuándo
   usarlos con un servicio de modelos; síntomas de pods → comandos → causa típica.
   El porqué (imágenes, CUDA, HPA, KEDA, nodos, cold starts) vive en M5 y M6: aquí
   solo se enlaza. Ejemplos con los archivos reales de reference/c01 (namespace
   classifier, deploy/triton, deploy/gateway, svc/triton).
   Verificado (sept. 2026): flags contra kubectl 1.34 --help, Docker CLI 29 y
   Compose v5; defaults y mensajes de eventos contra la documentación y el código
   de Kubernetes (probes, backoff, progressDeadlineSeconds, event-ttl, scheduler,
   kubelet), KEDA 2.22 y NVIDIA Container Toolkit.
   Contrato: docs/SPEC.md §5 y §7.4. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagrama
  // Ciclo de vida de un pod. Fila superior (y 6–14): el camino normal; fila inferior
  // (y 30–38): dónde se atasca cada fase. Columnas de 18 con huecos de 9 (x = 4, 31, 58, 85)
  // para las etiquetas de las aristas; la primera columna empieza en x = 4 para que la
  // arista vertical (x = 13) no cruce la etiqueta corta del segundo carril.
  const POD = {
    width: 108, height: 44,
    lanes: [
      { id: 'normal', label: 'Camino normal de un pod', x: 0, y: 0, w: 108, h: 22, kind: 'online' },
      { id: 'atasco', label: 'Síntoma', x: 0, y: 24, w: 108, h: 20, kind: 'monitor' },
    ],
    nodes: [
      { id: 'pending', label: 'Pending', sub: 'espera nodo o GPU', x: 4, y: 6, w: 18, h: 8, kind: 'queue',
        note: 'El pod existe, pero ningún nodo lo aceptó todavía. En un Deployment de GPU es normal durante un scale-up: el pod espera a que el autoscaler de nodos (Karpenter o Cluster Autoscaler) agregue una máquina con GPU libre. Lo ves en <code>kubectl get pods</code> (STATUS Pending); el porqué, en los eventos de <code>kubectl describe pod</code>.' },
      { id: 'creating', label: 'ContainerCreating', sub: 'pull y volúmenes', x: 31, y: 6, w: 18, h: 8, kind: 'service',
        note: 'Ya tiene nodo: el kubelet baja la imagen, monta volúmenes (Secrets, ConfigMaps, <code>/dev/shm</code>) y crea el contenedor. Con una imagen de Triton de varios GB, el pull domina esta fase; el evento <code>Pulled</code> dice cuánto tardó. Si la imagen ya está en el nodo, se salta. Por qué pesa tanto una imagen de GPU: <a href="#m05.tamano">M5</a>.' },
      { id: 'starting', label: 'Running, no Ready', sub: 'startup / readiness', x: 58, y: 6, w: 18, h: 8, kind: 'service',
        note: 'El proceso corre, pero el pod todavía no recibe tráfico: Triton carga el engine y hace el warmup. En el c01 el <code>startupProbe</code> le da hasta 5 min (60 × 5 s); mientras no pasa, el kubelet no evalúa liveness y el pod no entra al Service.' },
      { id: 'ready', label: 'Ready', sub: 'en el Service', x: 85, y: 6, w: 18, h: 8, kind: 'service',
        note: 'La readiness pasa: el pod entra a los endpoints del Service y recibe requests. Desde aquí, liveness vigila que el proceso no se cuelgue y readiness lo saca del balanceo si deja de estar listo.' },
      { id: 'fsched', label: 'FailedScheduling', sub: 'GPU, taint, selector', x: 4, y: 30, w: 18, h: 8, kind: 'monitor',
        note: 'El scheduler no encontró nodo: <code>Insufficient nvidia.com/gpu</code>, un taint sin toleration o un nodeSelector que ningún nodo cumple. Si además ningún node group puede crecer (tope, cuota de GPU, sin capacidad en la AZ), el pod se queda aquí indefinidamente.' },
      { id: 'pull', label: 'ImagePullBackOff', sub: 'tag, permiso, amd64', x: 31, y: 30, w: 18, h: 8, kind: 'monitor',
        note: 'El kubelet no pudo bajar la imagen y reintenta con espera creciente: tag inexistente, sin permiso en el registry, rate limit o imagen sin variante <code>linux/amd64</code>. El motivo exacto está en el evento <code>Failed to pull image</code>.' },
      { id: 'crash', label: 'CrashLoopBackOff', sub: 'exit 1, OOM, probes', x: 58, y: 30, w: 18, h: 8, kind: 'monitor',
        note: 'El contenedor muere y el kubelet lo reinicia con espera creciente: 10 s, 20 s, 40 s… hasta 5 min. Causas típicas: error al arrancar (exit 1), OOMKilled (137), startupProbe o liveness fallidos. <code>kubectl logs --previous</code> muestra el intento que murió.' },
      { id: 'notready', label: 'Readiness falla', sub: 'sale del Service', x: 85, y: 30, w: 18, h: 8, kind: 'monitor',
        note: 'El pod sigue Running pero sale de los endpoints: la readiness falla (dependencia caída, proceso saturado). No se reinicia: deja de recibir tráfico. Si pasa en todas las réplicas a la vez, el Service se queda sin backends y el balanceador responde 503.' },
    ],
    edges: [
      { from: 'pending', to: 'creating', kind: 'online', label: 'nodo' },
      { from: 'creating', to: 'starting', kind: 'online', label: 'imagen' },
      { from: 'starting', to: 'ready', kind: 'online', label: 'probe OK' },
      { from: 'pending', to: 'fsched', kind: 'neutral', dashed: true, fromSide: 'b', toSide: 't' },
      { from: 'creating', to: 'pull', kind: 'neutral', dashed: true, fromSide: 'b', toSide: 't' },
      { from: 'starting', to: 'crash', kind: 'neutral', dashed: true, fromSide: 'b', toSide: 't', bidir: true },
      { from: 'ready', to: 'notready', kind: 'neutral', dashed: true, fromSide: 'b', toSide: 't', bidir: true },
    ],
    flows: [
      { id: 'cold-start', label: 'Triton nuevo en un nodo GPU nuevo', steps: [
        { nodes: ['pending', 'fsched'], edges: ['pending>fsched'], text: 'KEDA pide una tercera réplica de Triton y no hay GPU libre: evento <code>FailedScheduling</code> con <code>Insufficient nvidia.com/gpu</code>. Ese pod pendiente es lo que dispara al autoscaler de nodos, que crea un g4dn.xlarge: ' + E('minutos') + '.' },
        { nodes: ['pending', 'creating'], edges: ['pending>creating'], text: 'El nodo se une al cluster, el device plugin anuncia <code>nvidia.com/gpu: 1</code> y el scheduler asigna el pod.' },
        { nodes: ['creating', 'starting'], edges: ['creating>starting'], text: 'Pull de la imagen de Triton con el engine horneado (varios GB). El evento <code>Successfully pulled image … in …</code> te da la duración exacta.' },
        { nodes: ['starting', 'ready'], edges: ['starting>ready'], text: 'Triton carga el engine y hace el warmup; pasa el startupProbe, luego la readiness, y el pod entra al Service. Cada fase deja su timestamp: así mides el cold start (<a href="#ref-comandos.autoscaling-cmds">sección 7</a>).' },
      ] },
      { id: 'oom', label: 'OOMKilled al cargar el modelo', steps: [
        { nodes: ['starting'], edges: [], text: 'El contenedor arranca y el servidor lee los pesos a RAM antes de copiarlos a la GPU (con un modelo de varios GB, el pico es grande). Ese pico supera <code>limits.memory</code>.' },
        { nodes: ['starting', 'crash'], edges: ['starting>crash'], text: 'El kernel lo mata: <code>Last State: Terminated · Reason: OOMKilled · Exit Code: 137</code>. El kubelet lo reinicia y, tras varios fallos seguidos, el pod muestra CrashLoopBackOff.' },
        { nodes: ['crash'], edges: [], text: '<code>kubectl describe pod</code> confirma OOMKilled; <code>container_memory_working_set_bytes</code> en Prometheus muestra el pico (<code>kubectl top</code> solo ve el presente). Arreglo: un límite medido, no adivinado.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  const DOCKER_LOOP = `# Desde reference/c01. Tag = commit corto: sabes exactamente qué código corre
TAG=$(git rev-parse --short HEAD)

# 1. Construir. En un Mac con Apple Silicon, --platform es obligatorio:
#    sin él la imagen sale arm64 y los nodos x86 (g4dn, c6i) no la pueden ejecutar
docker build --platform linux/amd64 -t classifier-gateway:$TAG gateway/

# 2. Correr como en producción: puerto publicado y la config por variables de entorno
#    (en el Mac corre emulada: sirve para probar, no para medir latencia)
docker run --rm -d --name gw -p 8080:8080 \\
  -e MODEL_NAME=classifier -e INFER_TIMEOUT_S=0.15 \\
  classifier-gateway:$TAG

# 3. Sin Triton, el gateway vive pero no está listo: la degradación diseñada del c01
curl -i localhost:8080/healthz     # 200: el proceso responde
curl -i localhost:8080/readyz      # 503: en k8s saldría del balanceo

# 4. Logs y una shell adentro
docker logs -f --tail 50 gw      # Ctrl+C deja de seguir; el contenedor sigue
docker exec -it gw sh

# 5. ¿Cuánto pesa, por qué y para qué arquitectura?
docker image ls classifier-gateway
docker history classifier-gateway:$TAG
docker image inspect classifier-gateway:$TAG --format '{{.Os}}/{{.Architecture}}'
docker system df`;

  const DOCKER_CACHE = `# syntax=docker/dockerfile:1
FROM python:3.13-slim AS builder
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
# Cache mount de BuildKit: el cache de pip vive en el builder, no en la capa.
# La imagen no engorda y el próximo build no vuelve a descargar los wheels.
# Reemplaza a PIP_NO_CACHE_DIR=1 del Dockerfile del c01 (con esa variable, pip no usa cache).
RUN --mount=type=cache,target=/root/.cache/pip \\
    pip install --only-binary=:all: -r requirements.txt`;

  const GPU_CHECK = `# 1. ¿El host ve la GPU? Si falla aquí, el problema es el driver, no Docker
nvidia-smi

# 2. ¿Docker puede pasarla a un contenedor? (NVIDIA Container Toolkit + runtime)
#    Una imagen sin CUDA basta: el toolkit monta el driver y nvidia-smi del host
docker run --rm --gpus all ubuntu nvidia-smi

# 3. ¿Tu imagen la usa? Triton con la GPU y /dev/shm de 1 GB, como en el compose del c01
docker run -d --name triton --gpus all --shm-size=1g -p 8000:8000 -p 8002:8002 \\
  classifier-triton:2026-09-01-resnet50-fp16
# Triton abre sus puertos después de cargar los modelos: antes imprime 000 (connection refused; -s oculta el error), luego 200
curl -s localhost:8000/v2/health/ready -o /dev/null -w "%{http_code}\\n"

# Con una imagen de PyTorch: ¿ve la GPU y con qué CUDA se compiló?
docker run --rm --gpus all tu-imagen:tag \\
  python -c "import torch; print(torch.cuda.is_available(), torch.version.cuda)"`;

  const COMPOSE_GPU = `services:
  triton:
    build: ./triton
    # /dev/shm de 1 GB: el default de Docker (64 MB) se queda corto para Triton
    shm_size: 1g
    deploy:
      resources:
        reservations:
          devices:
            # Equivale a docker run --gpus 1. capabilities es obligatorio.
            # Para fijar una GPU concreta: device_ids: ["0"] en lugar de count (nunca los dos)
            - driver: nvidia
              count: 1
              capabilities: [gpu]`;

  const COMPOSE_LOOP = `cd reference/c01
docker compose config -q            # valida el archivo (no necesita el daemon)
docker compose up -d --build        # construye y levanta gateway + Triton + Prometheus
docker compose ps                   # triton "health: starting" mientras carga el engine
docker compose logs -f triton       # tabla de modelos con classifier READY; Ctrl+C sale
curl -s -H "Content-Type: image/jpeg" --data-binary @foto.jpg \\
  "localhost:8080/v1/classify?top_k=5"
docker compose exec triton nvidia-smi
docker compose up -d --build gateway   # iterar solo sobre el gateway: Triton no recarga
docker compose down                    # sin -v: no borra volúmenes`;

  const PORT_FWD = `# Túnel: localhost:8000 y :8002 → los mismos puertos de UN pod detrás de svc/triton
kubectl port-forward -n classifier svc/triton 8000:8000 8002:8002

# En otra terminal
curl -s localhost:8000/v2/health/ready -o /dev/null -w "%{http_code}\\n"   # 200 = listo
curl -s localhost:8000/v2/models/classifier        # metadata: inputs, outputs, versiones
curl -s localhost:8002/metrics | grep nv_inference_queue_duration_us   # la señal de KEDA

# ¿Triton ve la GPU y cuánta memoria ocupa?
kubectl exec -n classifier -it deploy/triton -- nvidia-smi`;

  const ROLLOUT = `# 1. ¿Qué va a cambiar? Exit 0 = nada, 1 = hay diferencias
kubectl diff -f k8s/triton.yaml

# 2. Aplicar el tag nuevo (= modelo nuevo) y dejar el porqué en el historial
kubectl apply -f k8s/triton.yaml
kubectl annotate deploy/triton -n classifier --overwrite \\
  kubernetes.io/change-cause="classifier 2026-09-15-resnet50-fp16"

# 3. Esperar. Con maxSurge 1 y maxUnavailable 0, cada pod nuevo necesita una GPU libre
#    (quizá un nodo nuevo), bajar la imagen y cargar el engine, de a uno
kubectl rollout status deploy/triton -n classifier --timeout=25m

# 4. Si p99, 5xx o tiempo en cola empeoran: mitigar primero, investigar después
kubectl rollout undo deploy/triton -n classifier
kubectl rollout history deploy/triton -n classifier`;

  const COLD_START = `# Cada fase del arranque deja su hora: creación del pod, condiciones y arranque del contenedor
kubectl get pod POD -n classifier \\
  -o jsonpath='{"Created\\t"}{.metadata.creationTimestamp}{"\\n"}{range .status.conditions[*]}{.type}{"\\t"}{.lastTransitionTime}{"\\n"}{end}{"Started\\t"}{.status.containerStatuses[0].state.running.startedAt}{"\\n"}'

# Cuánto tardó el pull (mensaje del evento Pulled) y en qué nodo cayó (Scheduled).
# LAST SEEN es relativo ("4m"): las horas exactas salen del comando anterior
kubectl events -n classifier --for pod/POD | grep -E "Scheduled|Pulled"

# Cuándo se creó el nodo que lo aloja (lo agregó el autoscaler de nodos)
kubectl get node NODO -o jsonpath='{.metadata.creationTimestamp}{"\\n"}'`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'ref-comandos',
    kind: 'special',
    sections: [
      // ======================================================== 1
      {
        id: 'docker',
        title: 'Docker: construir, correr, depurar',
        titleEn: 'Docker: build, run, debug',
        priority: 'extra',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Hoja para consultar, no para memorizar. Cada fila: comando, qué hace, flags clave y cuándo lo usas con un servicio de modelos. El porqué de capas, tamaños y Dockerfiles está en <a href="#m05">M5</a>; los ejemplos usan los archivos reales del <a href="#c01.archivos">caso 1</a>.` },
          { t: 'table', caption: 'Los comandos del día a día', head: ['Comando', 'Qué hace', 'Flags clave', 'Cuándo lo usas'], rows: [
            ['<code>docker build -t IMG:TAG DIR</code>', 'Construye una imagen con el Dockerfile de <code>DIR</code> (el contexto)', '<code>-t</code> · <code>-f</code> · <code>--target</code> (una etapa) · <code>--platform linux/amd64</code> · <code>--no-cache</code> · <code>--progress=plain</code>', 'Tras cambiar código o dependencias. Tag = commit de git, nunca solo <code>:latest</code>'],
            ['<code>docker run</code>', 'Crea y arranca un contenedor', '<code>--rm</code> · <code>-d</code> · <code>--name</code> · <code>-p 8080:8080</code> (host:contenedor) · <code>-e K=V</code> · <code>--env-file</code> · <code>-v</code>', 'Probar la imagen como correrá: mismo CMD, config por variables'],
            ['<code>docker ps -a</code>', 'Contenedores, incluidos los que murieron', '<code>-a</code> · <code>--format</code>', 'Si un contenedor "desapareció", aquí está con su exit code'],
            ['<code>docker logs gw</code>', 'stdout y stderr del contenedor', '<code>-f</code> · <code>-n 100</code> · <code>--since 10m</code> · <code>-t</code>', 'El gateway escribe una línea JSON por request: lo que después recoge el agente de logs'],
            ['<code>docker exec -it gw sh</code>', 'Proceso nuevo dentro de un contenedor que corre', '<code>-it</code> · <code>-u</code> · <code>-e</code>', 'Ver qué quedó en la imagen (<code>env</code>, <code>pip list</code>). La imagen slim del gateway no trae curl: adentro usa <code>python -c "import urllib.request as u; print(u.urlopen(\'http://127.0.0.1:8080/healthz\').status)"</code>, o <code>curl</code> desde el host. Una imagen distroless no trae shell'],
            ['<code>docker history IMG</code>', 'Una fila por capa: instrucción y tamaño', '<code>--no-trunc</code>', 'Encontrar la capa que infló la imagen: un checkpoint copiado, el cache de pip (<a href="#m05.imagen-capas">M5 · capas</a>)'],
            ['<code>docker image inspect IMG</code>', 'Metadatos: arquitectura, CMD, ENV, usuario', `<code>--format '{{.Os}}/{{.Architecture}}'</code>`, 'Confirmar <code>linux/amd64</code> antes de subir'],
            ['<code>docker system df</code>', 'Espacio de imágenes, contenedores, volúmenes y cache de build', '<code>-v</code>', 'Las imágenes CUDA pesan varios GB: <code>docker image prune</code>, <code>docker builder prune</code>'],
            ['<code>docker tag</code> + <code>docker push</code>', 'Nombra la imagen con el registry y la sube', '—', 'Publicar en ECR. Login: <code>aws ecr get-login-password | docker login --username AWS --password-stdin REGISTRY</code> (<a href="#m05.registries">M5 · registries</a>)'],
          ] },
          { t: 'code', title: 'El ciclo diario con el gateway del caso 1', files: [
            { name: 'ciclo-docker.sh', lang: 'bash', code: DOCKER_LOOP },
            { name: 'Dockerfile (cache mount)', lang: 'dockerfile', code: DOCKER_CACHE, note: 'Los cache mounts son de BuildKit, el builder por defecto de Docker desde la versión 23. Con <code>--only-binary</code>, el build emulado para amd64 en un Mac instala wheels ya compilados en vez de compilar bajo emulación, que es lo que lo vuelve lentísimo.' },
          ] },
          { t: 'callout', kind: 'trap', title: 'Construir en un Mac con Apple Silicon', html: `<p>Sin <code>--platform linux/amd64</code>, la imagen sale <code>arm64</code> y en el cluster falla: <code>no match for platform in manifest</code> al bajarla (ErrImagePull) o <code>exec format error</code> en el log (CrashLoopBackOff). Compruébalo con <code>docker buildx imagetools inspect</code>. De fondo: la imagen de producción se construye en CI, no en tu laptop. Además, Docker Desktop en Mac no expone GPU a los contenedores: Triton con GPU necesita un host Linux con GPU NVIDIA (p. ej. una g4dn de desarrollo).</p>` },
          { t: 'callout', kind: 'skip', html: `<p>No memorices flags de <code>docker run</code>: <code>--help</code> existe. Sí debes poder explicar por qué la imagen pesa lo que pesa (y cómo lo compruebas), por qué el tag es un commit y por qué se construye para la arquitectura del nodo.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'docker-gpu',
        title: 'GPUs en Docker',
        titleEn: 'GPUs in Docker',
        priority: 'extra',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Tres eslabones, y cada uno falla distinto: el <b>driver</b> de NVIDIA en el host, el <b>NVIDIA Container Toolkit</b> (hace que el runtime de Docker monte driver y GPUs en el contenedor) y el flag <code>--gpus</code>. La imagen trae las librerías de CUDA; el driver viene del host. El porqué: <a href="#m05.gpu-en-contenedor">M5 · GPU en contenedor</a> y <a href="#m05.cuda">M5 · CUDA</a>.` },
          { t: 'table', caption: 'Comandos y flags de GPU', head: ['Comando o flag', 'Qué hace', 'Cuándo lo usas'], rows: [
            ['<code>nvidia-smi</code> (en el host)', 'Driver, GPUs, memoria y procesos', 'Primer paso: si falla aquí, no es Docker'],
            ['<code>sudo nvidia-ctk runtime configure --runtime=docker</code> y <code>sudo systemctl restart docker</code>', 'Registra el runtime de NVIDIA en <code>/etc/docker/daemon.json</code>', 'Una vez por máquina, tras instalar el toolkit'],
            ['<code>--gpus all</code> · <code>--gpus 1</code> · <code>--gpus device=0</code> · <code>--gpus \'"device=0,2"\'</code>', 'Qué GPUs ve el contenedor (también por UUID, de <code>nvidia-smi -L</code>)', 'Con varias GPUs, una por contenedor. Las comillas dobles internas son obligatorias si hay coma'],
            ['<code>docker exec -it triton nvidia-smi</code>', 'Lo mismo, dentro del contenedor', '¿Triton ve la GPU? ¿Cuánta memoria usa? En el c01, <span class="est">unos pocos GB</span> de 16 (<a href="#m04.vram">M4 · VRAM</a>)'],
            ['<code>--shm-size=1g</code> o <code>--ipc=host</code>', 'Tamaño de <code>/dev/shm</code> (64 MB por defecto) o el IPC del host', 'El DataLoader de PyTorch con <code>num_workers</code> &gt; 0 pasa tensores por <code>/dev/shm</code>; Triton también lo usa. <code>--ipc=host</code> aísla menos'],
            ['<code>--ulimit memlock=-1 --ulimit stack=67108864</code>', 'Sin límite de memoria bloqueada; pila de 64 MB', 'Lo recomienda el banner de las imágenes de NGC, junto con <code>--shm-size</code>'],
          ] },
          { t: 'code', title: 'Sanity check en tres pasos', files: [
            { name: 'gpu-check.sh', lang: 'bash', code: GPU_CHECK, note: 'Un comando después de la imagen (<code>nvidia-smi</code>, <code>python -c …</code>) reemplaza el CMD; el entrypoint de NGC igual imprime su banner, donde aparecen los avisos de driver y de <code>/dev/shm</code>.' },
          ] },
          { t: 'table', caption: 'Síntoma → causa → qué hacer', head: ['Síntoma (mensaje)', 'Causa típica', 'Qué hacer'], rows: [
            ['<code>could not select device driver "" with capabilities: [[gpu]]</code>', 'Toolkit no instalado, o Docker sin su runtime configurado', 'Instalar el toolkit, <code>nvidia-ctk runtime configure</code>, reiniciar Docker. En un Mac no hay arreglo: no hay GPU NVIDIA'],
            ['Banner de NGC: <code>WARNING: The NVIDIA Driver was not detected. GPU functionality will not be available.</code>', 'Contenedor sin <code>--gpus</code> (o compose sin la reserva de GPU)', 'Agregar <code>--gpus</code>; si no, Triton falla al cargar un modelo con <code>KIND_GPU</code>'],
            ['<code>nvidia-container-cli: requirement error: unsatisfied condition: cuda&gt;=12.x, please update your driver…</code>', 'La imagen pide una CUDA que el driver del host no soporta', 'Driver más nuevo o una release anterior de la imagen (<a href="#m05.cuda">M5 · CUDA</a>). Saltarte el chequeo con <code>NVIDIA_DISABLE_REQUIRE=true</code> no agrega compatibilidad: si el driver no alcanza, falla después, al inicializar CUDA'],
            ['<code>CUDA driver version is insufficient for CUDA runtime version</code> · PyTorch: <code>The NVIDIA driver on your system is too old</code>', 'El mismo desajuste, visto desde el proceso', 'Igual que la fila anterior'],
            ['<code>torch.cuda.is_available()</code> → <code>False</code>; <code>nvidia-smi: command not found</code> adentro', 'Sin <code>--gpus</code>, el toolkit no monta driver ni <code>nvidia-smi</code>', '<code>--gpus all</code>'],
            ['<code>ERROR: Unexpected bus error encountered in worker. This might be caused by insufficient shared memory (shm).</code>', 'Los workers del DataLoader llenaron los 64 MB de <code>/dev/shm</code>', '<code>--shm-size</code>; en Kubernetes, un <code>emptyDir</code> con <code>medium: Memory</code> como en <code>k8s/triton.yaml</code>'],
            ['Triton no carga el modelo: el engine es de otra versión de TensorRT o de otra GPU', 'Engine construido en otra GPU o con otra release de TensorRT', 'Reconstruirlo en la misma GPU y release de NGC que Triton (<a href="#c01.archivos">c01 · archivos</a>)'],
          ] },
          { t: 'p', html: `El "CUDA Version" de <code>nvidia-smi</code> es la versión máxima que soporta el driver, no la de tu imagen (esa la ves con <code>torch.version.cuda</code>): <a href="#m05.cuda">M5 · CUDA</a>.` },
          { t: 'callout', kind: 'connect', html: `<p>En Kubernetes no hay <code>--gpus</code>: pides <code>nvidia.com/gpu: 1</code> en <code>resources.limits</code> y el NVIDIA device plugin asigna la GPU (<a href="#m06.gpus-k8s">M6 · GPUs en Kubernetes</a>).</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'compose',
        title: 'docker compose',
        titleEn: 'docker compose',
        priority: 'extra',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Compose levanta varios contenedores en una red propia donde cada servicio es un nombre DNS: por eso el gateway del c01 usa <code>TRITON_URL=triton:8000</code>. Es para desarrollo y pruebas de integración en una máquina; producción corre en Kubernetes (<a href="#m05.compose-local">M5 · compose en local</a>).` },
          { t: 'table', caption: 'Comandos de compose', head: ['Comando', 'Qué hace', 'Flags clave', 'Cuándo lo usas'], rows: [
            ['<code>docker compose up -d --build</code>', 'Construye lo que tiene <code>build:</code> y levanta todo en segundo plano', '<code>-d</code> · <code>--build</code> · <code>--wait</code> (espera running/healthy) · <code>--force-recreate</code>', 'Primera vez o tras cambiar código'],
            ['<code>docker compose ps</code>', 'Servicios, estado y health', '<code>-a</code>', 'Triton en "starting": todavía carga el engine (<code>start_period: 60s</code> en el c01)'],
            ['<code>docker compose logs -f triton</code>', 'Logs de un servicio', '<code>-f</code> · <code>-n 100</code> · <code>--since</code> · <code>-t</code>', 'Ver la tabla de modelos de Triton con <code>classifier</code> en READY'],
            ['<code>docker compose exec triton bash</code>', 'Shell en el contenedor del servicio', '<code>-T</code> (sin TTY, para scripts)', '<code>curl localhost:8000/v2/health/ready</code>, <code>nvidia-smi</code>'],
            ['<code>docker compose up -d --build gateway</code>', 'Reconstruye y recrea un solo servicio', '—', 'Iterar sobre el gateway sin recargar Triton'],
            ['<code>docker compose down</code>', 'Para y borra contenedores y red', '<code>-v</code> · <code>--rmi local</code> · <code>--remove-orphans</code>', '<b>Ojo con <code>-v</code></b>: borra volúmenes nombrados y anónimos (una base local, modelos descargados)'],
            ['<code>docker compose config</code>', 'Valida y muestra el archivo final, con variables resueltas', '<code>-q</code> (solo valida) · <code>--services</code>', 'Antes de commitear y en CI. No necesita el daemon: así se validó el del c01'],
          ] },
          { t: 'code', title: 'Compose con GPU (mismo patrón que el c01)', files: [
            { name: 'compose-gpu.yml', lang: 'yaml', code: COMPOSE_GPU, note: 'Compose reciente también acepta <code>gpus: all</code> a nivel de servicio (verificado con <code>docker compose config</code> de Compose v5). El archivo completo, con healthcheck y <code>depends_on</code>, está en <a href="#c01.archivos">c01 · archivos</a>.' },
            { name: 'ciclo-compose.sh', lang: 'bash', code: COMPOSE_LOOP },
          ] },
          { t: 'callout', kind: 'trap', title: 'depends_on sin condición', html: `<p><code>depends_on: [triton]</code> espera a que arranque el <b>contenedor</b>, no a que cargue el modelo: el gateway responde 503 mientras Triton carga el engine. El c01 usa <code>condition: service_healthy</code> con un healthcheck contra <code>/v2/health/ready</code>: la misma idea que una readiness probe.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'kubectl-basicos',
        title: 'kubectl: mirar, entrar y conectar',
        titleEn: 'kubectl: inspect, exec and connect',
        priority: 'extra',
        dims: ['monitoreo'],
        blocks: [
          { t: 'callout', kind: 'trap', title: '¿En qué cluster estás?', html: `<p>Antes de cualquier comando que cambie algo: <code>kubectl config current-context</code>. Aplicar en producción lo que era para staging es un error clásico y caro; muchos equipos muestran el contexto en el prompt.</p>` },
          { t: 'table', caption: 'Contexto y namespace', head: ['Comando', 'Qué hace', 'Cuándo lo usas'], rows: [
            ['<code>kubectl config get-contexts</code>', 'Contextos del kubeconfig (cluster + usuario + namespace); <code>*</code> marca el actual', 'Ver a qué clusters tienes acceso'],
            ['<code>kubectl config use-context NOMBRE</code>', 'Cambia de cluster', 'De staging a producción, a propósito'],
            ['<code>kubectl config set-context --current --namespace=classifier</code>', 'Namespace por defecto del contexto', 'No repetir <code>-n classifier</code>'],
            ['<code>-n keda</code> · <code>-A</code>', 'Un namespace o todos', 'KEDA vive en <code>keda</code>; Prometheus, en <code>monitoring</code>'],
          ] },
          { t: 'table', caption: 'Mirar', head: ['Comando', 'Qué hace', 'Flags clave', 'Cuándo lo usas'], rows: [
            ['<code>kubectl get pods</code>', 'Estado, READY, RESTARTS, antigüedad', '<code>-o wide</code> (nodo, IP) · <code>-l app.kubernetes.io/name=triton</code> · <code>--show-labels</code> · <code>-L app.kubernetes.io/name</code> (la label como columna) · <code>-w</code> · <code>--field-selector status.phase=Pending</code>', '¿En qué nodo está cada Triton? ¿Cuántos reinicios lleva?'],
            ['<code>kubectl get deploy triton -o yaml</code>', 'El objeto completo, con defaults y <code>status</code>', "<code>-o yaml</code> · <code>-o jsonpath='{…}'</code>", 'Ver lo que el cluster tiene, no lo que crees que aplicaste'],
            ['<code>kubectl describe pod POD</code>', 'Spec, estado y <b>Events</b> al final', '—', 'Primera parada: Last State, Reason, Exit Code, Restart Count, QoS Class, eventos'],
            ['<code>kubectl logs POD</code>', 'stdout y stderr del contenedor', '<code>-f</code> · <code>--previous</code> · <code>-c triton</code> · <code>--since=10m</code> · <code>--tail=100</code> · <code>-l … --prefix</code>', '<code>--previous</code>: el contenedor que murió. Con <code>deploy/triton</code> elige un pod'],
            ['<code>kubectl events --for pod/POD</code>', 'Eventos ordenados por tiempo', '<code>--types=Warning</code> · <code>-w</code> · <code>-A</code>', 'Qué pasó y en qué orden. El clásico <code>get events --sort-by=.lastTimestamp</code> puede desordenar eventos sin ese campo (p. ej., los del scheduler)'],
            ['<code>kubectl top pods --containers</code> · <code>top nodes</code>', 'CPU y memoria de ahora', '<code>--sort-by=memory</code>', 'Necesita metrics-server (en EKS no siempre está). No muestra GPU: para eso, métricas <code>nv_*</code> de Triton o DCGM'],
            ['<code>kubectl explain deploy.spec.strategy</code>', 'Documentación de un campo, servida por el cluster', '<code>--recursive</code>', 'Confirmar un campo o su default'],
          ] },
          { t: 'callout', kind: 'note', title: 'Los eventos duran poco', html: `<p>El API server guarda los eventos 1 hora por defecto (<code>--event-ttl</code>), y borrar el pod se lleva el log de <code>--previous</code>. Guarda <code>describe</code> y <code>logs --previous</code> <b>antes</b> de borrar o reiniciar nada.</p>` },
          { t: 'table', caption: 'Entrar y conectar', head: ['Comando', 'Qué hace', 'Cuándo lo usas'], rows: [
            ['<code>kubectl exec -it deploy/triton -- bash</code>', 'Shell o comando en un contenedor que corre (<code>-c</code> elige cuál)', '<code>nvidia-smi</code>, <code>curl localhost:8000/v2/health/ready</code>'],
            ['<code>kubectl port-forward svc/triton 8000:8000</code>', 'Túnel de tu localhost a <b>un</b> pod, vía API server y kubelet', 'Pegarle a Triton sin exponerlo. Un solo pod: no sirve para load tests'],
            ['<code>kubectl debug -it POD --image=busybox --target=gateway</code>', 'Agrega un ephemeral container que ve los procesos del contenedor objetivo', 'Imágenes sin shell (distroless) o sin la herramienta que necesitas'],
          ] },
          { t: 'code', title: 'Pegarle al Triton del caso 1 desde tu laptop', files: [
            { name: 'port-forward.sh', lang: 'bash', code: PORT_FWD },
          ] },
          { t: 'callout', kind: 'senior', html: `<p>En producción, <code>exec</code> y <code>port-forward</code> suelen estar restringidos por RBAC y auditados: un senior depura primero con eventos, logs y métricas.</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'rollouts',
        title: 'Rollouts y escalado',
        titleEn: 'Rollouts and scaling',
        priority: 'core',
        dims: ['monitoreo'],
        blocks: [
          { t: 'table', caption: 'Desplegar, volver atrás y escalar', head: ['Comando', 'Qué hace', 'Flags clave', 'Cuándo lo usas'], rows: [
            ['<code>kubectl diff -f k8s/</code>', 'Qué cambiaría (dry-run en el servidor)', 'exit 0 sin cambios · 1 con cambios', 'Antes de aplicar; en CI'],
            ['<code>kubectl apply -f k8s/triton.yaml</code>', 'Crea o actualiza los objetos, declarativo', '<code>--dry-run=server</code> · <code>--server-side</code>', 'Aplicar lo que está en git. Con GitOps lo hace Argo CD o Flux, no tú'],
            ['<code>kubectl rollout status deploy/triton</code>', 'Espera el fin del rollout; exit ≠ 0 si falla o vence', '<code>--timeout=25m</code>', 'En el pipeline, tras el apply'],
            ['<code>kubectl rollout history deploy/triton</code>', 'Revisiones guardadas (ReplicaSets viejos)', '<code>--revision=3</code>', 'Saber a qué volver. <code>revisionHistoryLimit</code>: 10 por defecto, 5 en el c01'],
            ['<code>kubectl rollout undo deploy/triton</code>', 'Vuelve a la revisión anterior', '<code>--to-revision=N</code> · <code>--dry-run=server</code>', 'Mitigar: en el c01, el tag anterior de Triton es el modelo anterior'],
            ['<code>kubectl rollout restart deploy/gateway</code>', 'Recrea los pods con rolling update, misma imagen', '—', 'Releer un ConfigMap o Secret que se carga al arrancar. No arregla una causa que sigue ahí'],
            ['<code>kubectl set image deploy/triton triton=REPO:TAG</code>', 'Cambia la imagen y dispara un rollout', '<code>contenedor=imagen</code>', 'Hotfix imperativo; con GitOps, el tag se cambia en git'],
            ['<code>kubectl annotate deploy/triton kubernetes.io/change-cause="…"</code>', 'Texto de la columna CHANGE-CAUSE', '<code>--overwrite</code>', 'Reemplaza a <code>--record</code> (deprecado). Mejor: la anotación en el manifest, en el mismo commit'],
            ['<code>kubectl scale deploy/gateway --replicas=6</code>', 'Fija las réplicas', '<code>--current-replicas</code>', 'Solo sin autoscaler: con HPA o KEDA, el autoscaler vuelve a su propio número'],
          ] },
          { t: 'code', title: 'Desplegar un modelo nuevo en Triton y volver atrás (c01)', files: [
            { name: 'rollout-triton.sh', lang: 'bash', code: ROLLOUT, note: `El <code>--timeout=25m</code> es una ${E('estimación')}: dos pods, de a uno, cada uno con nodo nuevo (${E('≈ 4–11 min')} por pod según <a href="#m05.tamano">M5</a>: nodo 2–5 + pull 2–5 + engine y readiness ≈ 1), ${E('≈ 8–22 min')} en total. Mide tu cold start y ajústalo.` },
          ] },
          { t: 'callout', kind: 'trap', title: 'Rollouts de GPU y progressDeadlineSeconds', html: `<p>Si un Deployment no progresa en <code>progressDeadlineSeconds</code> (600 s por defecto), queda en <code>Progressing=False</code> con <code>ProgressDeadlineExceeded</code> y <code>rollout status</code> falla. Un pod de GPU con nodo nuevo suma ${E('≈ 4–11 min')} entre nodo, imagen y engine (<a href="#m05.tamano">M5</a>): el extremo pesimista pasa los 10 min, así que sube el plazo (el c01 usa 900 s) o reduce el cold start (<a href="#m06.cold-starts">M6 · cold starts</a>). Y con <code>maxUnavailable: 0</code>, <code>rollout undo</code> también necesita una GPU libre: el rollback no es instantáneo.</p>` },
          { t: 'callout', kind: 'trap', title: 'kubectl edit en producción', html: `<p><code>edit</code>, <code>set image</code> y <code>scale</code> cambian el cluster, no git: nadie revisó el cambio, git ya no describe lo que corre (configuration drift) y el próximo sync lo pisa; con auto-sync y self-heal, Argo CD lo revierte solo. Con GitOps, el rollback es un revert en git (<a href="#m10">M10</a>).</p>` },
          { t: 'callout', kind: 'trap', title: 'kubectl scale contra el autoscaler', html: `<p>El gateway tiene un HPA (3–12) y Triton un ScaledObject de KEDA (2–4): un <code>kubectl scale</code> dura poco. Si bajaste réplicas, el autoscaler las repone en su siguiente ciclo (15 s por defecto); si subiste, las quita al ritmo de su política de scaleDown. Para cambiar capacidad, cambia <code>minReplicas</code> o <code>minReplicaCount</code> en git. En un incidente, la anotación <code>autoscaling.keda.sh/paused-replicas: "3"</code> fija 3 réplicas y congela KEDA hasta que la quites.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Rolling update, <code>maxSurge</code>/<code>maxUnavailable</code> y PodDisruptionBudget: <a href="#m06.alta-disponibilidad">M6 · alta disponibilidad</a>. Canary, blue/green y rollback automático: <a href="#m11">M11</a>.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'depurar',
        title: 'Depurar pods: síntoma → comandos → causa típica',
        titleEn: 'Debugging pods: symptom → commands → likely cause',
        priority: 'core',
        dims: ['monitoreo'],
        blocks: [
          { t: 'p', html: `Casi todo problema de un pod se resuelve con el mismo recorrido, en este orden: cada comando te dice cuál mirar después.` },
          { t: 'steps', items: [
            { title: 'kubectl get pods -o wide', meta: 'qué fase', html: 'STATUS, READY, RESTARTS y nodo: dónde se atascó (Pending, ContainerCreating, CrashLoopBackOff, Running sin Ready).' },
            { title: 'kubectl describe pod POD', meta: 'por qué', html: '<code>Last State</code>, <code>Reason</code>, <code>Exit Code</code> y los <b>Events</b> del final. Casi siempre la respuesta está aquí.' },
            { title: 'kubectl logs POD --previous', meta: 'qué dijo al morir', html: 'El log del contenedor que falló; el actual todavía no falló.' },
            { title: 'kubectl events --for pod/POD', meta: 'contexto', html: 'Scheduler, autoscaler de nodos, pulls y probes en orden. Con <code>-A --types=Warning</code> ves si el problema es del cluster.' },
            { title: 'kubectl top pod POD --containers · kubectl describe node NODO', meta: 'recursos', html: 'Memoria contra el límite, presión del nodo y GPUs asignadas (<code>Allocated resources</code>).' },
          ] },
          { t: 'diagram', id: 'ciclo-pod', title: 'Dónde se atasca un pod', caption: 'Arriba, el camino normal; abajo, el síntoma que ves cuando cada fase falla. Toca cada caja; los recorridos muestran un cold start de Triton y un OOMKilled.', spec: POD },
          { t: 'table', caption: 'Síntoma → confírmalo → causa típica → arreglo', head: ['Síntoma', 'Confírmalo con', 'Causa típica en un servicio de ML', 'Arreglo'], rows: [
            ['<b>CrashLoopBackOff</b>: RESTARTS sube; espera 10 s, 20 s, 40 s… hasta 5 min', '<code>logs --previous</code> · <code>describe pod</code>', 'Sale al arrancar: variable faltante, modelo o labels no encontrados, Triton con <code>--exit-on-error</code> y un engine que no carga, <code>exec format error</code>', 'Arreglar la causa del log: el backoff solo espacia los intentos'],
            ['<b>OOMKilled</b>: <code>Reason: OOMKilled</code>, <code>Exit Code: 137</code>', '<code>describe pod</code> · <code>container_memory_working_set_bytes</code> contra el límite', 'RAM, no VRAM: pesos leídos a RAM antes de ir a la GPU, el modelo duplicado en varios procesos, decodes grandes en paralelo, <code>/dev/shm</code> en memoria (cuenta contra el límite)', 'Límite medido, no adivinado; acotar la concurrencia (como el gateway del c01)'],
            ['<b>ImagePullBackOff</b> / <b>ErrImagePull</b>', 'Evento <code>Failed to pull image …</code> con el motivo', 'Tag inexistente, nodo sin permiso en ECR o sin <code>imagePullSecrets</code>, rate limit de Docker Hub, imagen sin <code>linux/amd64</code>', 'Corregir tag, permisos o plataforma. Una imagen grande no falla: tarda (evento <code>Pulled … in …</code>)'],
            ['<b>Pending</b>: <code>Insufficient nvidia.com/gpu</code>', '<code>describe node</code> (Allocatable contra Allocated resources)', 'GPUs todas asignadas (un pod, una GPU entera), o el device plugin no corre en el nodo y este no anuncia <code>nvidia.com/gpu</code>', 'Esperar o destrabar al autoscaler de nodos; revisar el DaemonSet (<code>kubectl get ds -A | grep -i nvidia</code>)'],
            ['<b>Pending</b>: <code>node(s) had untolerated taint {nvidia.com/gpu: present}</code> (hasta 1.33; desde 1.34 solo <code>node(s) had untolerated taint(s)</code>, sin nombrar el taint) o <code>node(s) didn\'t match Pod\'s node affinity/selector</code>', '<code>get node NODO -o jsonpath=\'{.spec.taints}\'</code> · <code>get nodes -L workload</code>', 'Falta la toleration de <code>nvidia.com/gpu</code>, o ningún nodo tiene la label <code>workload=gpu-t4</code> del c01', 'Corregir toleration o label. Desde Kubernetes 1.35 el mensaje ya no nombra el taint: míralo en el nodo'],
            ['<b>Pending</b> y no llega ningún nodo', '<code>NotTriggerScaleUp</code> (Cluster Autoscaler) · <code>get nodepools,nodeclaims</code> (Karpenter)', 'Node group en su máximo, cuota de vCPU de instancias G, sin capacidad en la AZ, selector que ningún grupo cumple', 'Subir límites o cuota; más tipos de instancia o AZs (<a href="#m06.nodos">M6 · nodos</a>)'],
            ['<b>0/1 READY</b>: <code>Readiness probe failed</code> con <code>connection refused</code> o <code>HTTP probe failed with statuscode: …</code>', '<code>describe pod</code> · <code>logs -f</code>', 'El modelo sigue cargando (Triton abre sus puertos recién al terminar: connection refused); o falta una dependencia (sin Triton, el <code>/readyz</code> del gateway da 503 a propósito)', 'Carga lenta: <code>startupProbe</code> con <code>failureThreshold × periodSeconds</code> ≥ el peor caso (c01: 60 × 5 s = 5 min)'],
            ['<b>Reinicios bajo carga</b>: <code>Liveness probe failed: … context deadline exceeded</code>, <code>failed liveness probe, will be restarted</code>', '<code>describe pod</code> · p99 y CPU del pod', 'Liveness con <code>timeoutSeconds: 1</code> (el default) contra un proceso saturado, o una liveness que revisa dependencias', 'Liveness local y barata, timeout realista, dependencias solo en readiness. Reiniciar bajo carga quita capacidad cuando más falta'],
            ['<b>CreateContainerConfigError</b>', 'Eventos: <code>secret "…" not found</code>, <code>couldn\'t find key …</code>, <code>container has runAsNonRoot and image will run as root</code>', 'Secret o ConfigMap aún inexistente en el namespace; <code>runAsNonRoot</code> con una imagen que corre como root (NGC: por eso el c01 fija <code>runAsUser: 1000</code>)', 'Crear el objeto antes; usuario numérico. Un Secret montado como volumen da otro síntoma: <code>FailedMount</code>'],
            ['<b>Evicted</b>: <code>The node was low on resource: memory</code> (o <code>ephemeral-storage</code>)', '<code>describe node</code> (Conditions) · <code>get pods --field-selector=status.phase=Failed</code>', 'Disco del nodo lleno de imágenes CUDA y logs; pods que usan más memoria de la que pidieron (salen primero)', 'Memoria con límite = request; disco de nodo para imágenes grandes'],
            ['<b>CPU throttling</b>: Ready, sin eventos, pero el p99 sube', '<code>rate(container_cpu_cfs_throttled_periods_total[5m]) / rate(container_cpu_cfs_periods_total[5m])</code>', '<code>limits.cpu</code> bajo con ráfagas de preproceso: la cuota de CFS se agota a mitad de cada ventana de 100 ms', 'Request sin límite de CPU, como el gateway del c01 (<a href="#c01.archivos">c01 · archivos</a>)'],
          ] },
          { t: 'table', caption: 'Exit codes que vas a ver en Last State', head: ['Exit code', 'Qué significa', 'En un servicio de ML'], rows: [
            ['0', 'Terminó "bien"', 'En un Deployment igual se reinicia: tu CMD no se queda sirviendo'],
            ['1', 'Error de la aplicación', 'Excepción de Python, <code>CUDA out of memory</code>, Triton que no cargó un modelo'],
            ['126 / 127', 'Comando no ejecutable / no encontrado', 'Error en el CMD o el entrypoint'],
            ['137', '128 + 9: SIGKILL', 'Con <code>Reason: OOMKilled</code>, memoria. Si no: no terminó dentro de <code>terminationGracePeriodSeconds</code> (30 s por defecto) tras el SIGTERM'],
            ['139', '128 + 11: SIGSEGV', 'Segfault en código nativo: una librería de C o CUDA incompatible'],
            ['143', '128 + 15: SIGTERM', 'Apagado pedido (deploy, scale-down, drenado) y atendido a tiempo: normal'],
          ] },
          { t: 'callout', kind: 'trap', title: 'CUDA out of memory no es OOMKilled', html: `<p>OOMKilled es la <b>RAM</b> contra <code>limits.memory</code>: el kernel mata el proceso, exit 137, sin una línea en el log. <code>CUDA out of memory</code> es la <b>VRAM</b>: una excepción en el log. Subir <code>limits.memory</code> no arregla la segunda; la arreglan un batch o una resolución más chicos, menos instancias por GPU u otra GPU (<a href="#m04.vram">M4 · VRAM</a>).</p>` },
          { t: 'quiz', items: [
            { q: 'Un pod de Triton lleva 6 reinicios. <code>describe</code> muestra <code>Reason: Error</code>, <code>Exit Code: 1</code>. ¿Qué miras primero?', options: ['<code>kubectl top pod</code>', '<code>kubectl logs POD --previous</code>', 'Subir <code>limits.memory</code>', 'Borrar el pod para que se cree uno nuevo'], answer: 1,
              explain: 'Exit 1 es un error de la aplicación, no de memoria (eso sería OOMKilled, 137). El log del contenedor que murió dice cuál: por ejemplo, un engine que no carga. Borrar el pod destruye justo ese log.' },
            { q: 'Pods de Triton en Pending con <code>Insufficient nvidia.com/gpu</code>; el node group de GPU ya está en su máximo. ¿Qué logras subiendo <code>maxReplicaCount</code> del ScaledObject?', options: ['Más réplicas sirviendo en un minuto', 'Nada útil: más pods Pending; el tope real es el node group o la cuota', 'KEDA crea los nodos que faltan', 'El HPA baja el umbral de la métrica'], answer: 1,
              explain: 'KEDA y el HPA deciden cuántos pods; los nodos los pone el autoscaler de nodos, dentro de sus límites y de la cuota de la cuenta. El cuello está un eslabón más abajo.' },
            { q: 'El gateway reinicia bajo carga con <code>Liveness probe failed: … context deadline exceeded</code>. ¿Cuál de estas reacciones empeora el problema?', options: ['Subir <code>timeoutSeconds</code> y buscar qué bloquea el event loop', 'Hacer que la liveness también verifique que Triton responde', 'Revisar p99 y CPU throttling del pod', 'Leer <code>logs --previous</code>'], answer: 1,
              explain: 'Con la dependencia en la liveness, una caída o lentitud de Triton reinicia todos los gateways a la vez: menos capacidad justo cuando hay problemas. Las dependencias van en readiness.' },
          ] },
        ],
      },

      // ======================================================== 7
      {
        id: 'autoscaling-cmds',
        title: 'Autoscaling y capacidad',
        titleEn: 'Autoscaling and capacity',
        priority: 'extra',
        dims: ['monitoreo', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Cómo funcionan el HPA, KEDA y el autoscaler de nodos: <a href="#m06.hpa">M6 · HPA</a>, <a href="#m06.keda">M6 · KEDA</a> y <a href="#m06.nodos">M6 · nodos</a>. Aquí, cómo mirarlos cuando algo no escala.` },
          { t: 'table', caption: 'Comandos de autoscaling', head: ['Comando', 'Qué muestra', 'Cuándo lo usas'], rows: [
            ['<code>kubectl get hpa -n classifier -w</code>', 'Réplicas, min/max y TARGETS actual/objetivo (<code>cpu: 45%/60%</code>); <code>&lt;unknown&gt;</code> = no llega la métrica', 'Ver escalar al gateway durante un load test (<a href="#m03.load-testing">M3</a>)'],
            ['<code>kubectl describe hpa gateway</code>', 'Condiciones <code>AbleToScale</code>, <code>ScalingActive</code>, <code>ScalingLimited</code> y eventos', '<code>ScalingActive False</code> + <code>failed to get cpu utilization</code>: sin metrics-server o <code>missing request for cpu</code>. <code>ScalingLimited True</code>: topó con maxReplicas'],
            ['<code>kubectl get scaledobject -n classifier</code>', 'READY, ACTIVE, FALLBACK, PAUSED y el trigger', 'READY en False: KEDA no puede leer su métrica'],
            ['<code>kubectl describe scaledobject triton</code>', 'Condiciones y eventos (<code>KEDAScalerFailed</code>…)', 'La query vacía del c01 (<code>ignoreNullValues: "false"</code>) aparece aquí como error, no como un 0 silencioso'],
            ['<code>kubectl get hpa keda-hpa-triton</code>', 'El HPA que crea KEDA (<code>keda-hpa-</code> + nombre)', 'Tiempo en cola contra el umbral 10; puede verse en milis (<code>2500m</code> = 2.5)'],
            ['<code>kubectl logs -n keda deploy/keda-operator</code>', 'Logs del operador de KEDA', 'Errores de conexión o autenticación contra Prometheus'],
            ['<code>kubectl get apiservice v1beta1.metrics.k8s.io</code> · <code>v1beta1.external.metrics.k8s.io</code>', 'Si las APIs de métricas (metrics-server, KEDA) están <code>Available</code>', 'Si una no lo está, los HPA que dependen de ella no reciben métricas'],
            ['<code>kubectl get nodes -L node.kubernetes.io/instance-type,topology.kubernetes.io/zone,workload</code>', 'Nodos con tipo, AZ y la label del c01', '¿Una GPU por AZ? ¿Llegó el nodo nuevo?'],
            ['<code>kubectl get nodes -o \'custom-columns=NAME:.metadata.name,GPU:.status.allocatable.nvidia\\.com/gpu\'</code>', 'GPUs asignables por nodo', 'Nodo GPU con <code>&lt;none&gt;</code>: el device plugin no corre ahí. Las comillas simples son parte del comando: sin ellas, la shell se come la <code>\\</code> y todos los nodos salen <code>&lt;none&gt;</code>'],
            ['<code>kubectl describe node NODO</code>', 'Allocatable, Allocated resources (incluida <code>nvidia.com/gpu</code>), Conditions, Taints', 'Un pod no entra porque los <b>requests</b> llenaron el nodo, aunque el uso real sea bajo'],
            ['<code>kubectl debug node/NODO -it --image=ubuntu --profile=sysadmin</code>', 'Pod privilegiado en el nodo, con su filesystem en <code>/host</code>', '<code>chroot /host nvidia-smi</code> cuando el pod ni arranca. Luego borra el pod <code>node-debugger-…</code>'],
          ] },
          { t: 'steps', items: [
            { title: '¿Llega la métrica?', meta: 'HPA / KEDA', html: '<code>describe hpa</code> (<code>ScalingActive</code>) o <code>get scaledobject</code> (READY) (<a href="#m06.hpa">M6 · HPA</a>, <a href="#m06.keda">M6 · KEDA</a>).' },
            { title: '¿El autoscaler pide más réplicas?', meta: 'decisión', html: 'TARGETS contra el objetivo; <code>ScalingLimited</code> si topó. Bajar es lento a propósito: 300 s de estabilización por defecto, 600 s en el Triton del c01.' },
            { title: '¿Los pods nuevos se programan?', meta: 'scheduler', html: '<code>get pods --field-selector=status.phase=Pending</code> y <code>describe pod</code>.' },
            { title: '¿Llega un nodo?', meta: 'autoscaler de nodos', html: 'Cluster Autoscaler: <code>kubectl -n kube-system get configmap cluster-autoscaler-status -o yaml</code>. Karpenter: <code>get nodepools,nodeclaims</code> (<a href="#m06.nodos">M6 · nodos</a>).' },
            { title: '¿El pod llega a Ready?', meta: 'cold start', html: 'Pull y carga del modelo; mientras, el load shedding y el fallback protegen al usuario (<a href="#m06.cold-starts">M6 · cold starts</a>).' },
          ] },
          { t: 'code', title: 'Medir el cold start de un pod de Triton', files: [
            { name: 'cold-start.sh', lang: 'bash', code: COLD_START, note: '<code>Created</code> → <code>PodScheduled</code> = espera de nodo (la hora de creación del nodo dice cuánto de eso fue aprovisionar la máquina); <code>PodScheduled</code> → <code>Started</code> = pull y creación del contenedor (el evento <code>Pulled</code> da la duración exacta del pull); <code>Started</code> → <code>Ready</code> = carga del engine y warmup. Cada parte tiene otra palanca.' },
          ] },
          { t: 'callout', kind: 'trap', title: 'El porcentaje del HPA es sobre el request', html: `<p><code>averageUtilization: 60</code> es el 60 % del <b>request</b> de CPU, no del nodo: con el request de 1 CPU del gateway del c01, 0.6 cores por pod. Cambiar el request cambia cuándo escala sin tocar el HPA. <code>kubectl top</code> muestra cores absolutos: compáralos con el request.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'entrevista',
        title: 'Qué de esto sirve en la entrevista',
        titleEn: 'What of this matters in the interview',
        priority: 'core',
        dims: ['comunicacion', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Honestamente: casi nunca te piden un comando textual. Lo que se nota en los "¿qué haces si…?" es el <b>método</b>: mitigar antes de investigar, leer el exit code y los eventos antes de adivinar, distinguir RAM de VRAM y saber qué protege cada probe.` },
          { t: 'followups', items: [
            { q: 'Desplegaste un modelo nuevo y el p99 se duplicó. ¿Qué haces?',
              junior: 'Reviso los logs de los pods, encuentro el error y lo arreglo con un nuevo deploy.',
              senior: 'Primero mitigo: vuelvo al tag anterior (revert en git, o <code>rollout undo</code> si el sync no lo pisa) y confirmo que el p99 se recupera. Después investigo sin presión: engine más lento (perf_analyzer), preproceso distinto o cold start de los pods nuevos. Y ese chequeo pasa al canary.',
              why: 'Separa mitigar de diagnosticar: el rollback es barato y conocido; depurar con usuarios afectados no.' },
            { q: 'Tras un deploy, los pods nuevos de Triton están en CrashLoopBackOff.',
              junior: 'Miro los logs del pod y, si no veo nada, le subo la memoria y lo reinicio.',
              senior: 'Con <code>maxUnavailable: 0</code> los pods viejos siguen sirviendo: no hay caída, así que diagnostico antes de decidir. <code>describe</code> para el exit code: 137 con OOMKilled es memoria de arranque; exit 1 con un engine que no carga suele ser un engine de otra GPU u otro TensorRT, y <code>logs --previous</code> lo confirma. El arreglo va al pipeline que construye el engine, no al pod.',
              why: 'Mide la urgencia con la estrategia de rollout, lee el exit code antes de tocar recursos y arregla la causa donde nace.' },
            { q: 'El tráfico se triplicó, la latencia sube y Triton no escala.',
              junior: 'Subo <code>maxReplicas</code> del autoscaler.',
              senior: 'Recorro la cadena: ¿llega la métrica de cola a KEDA?, ¿el HPA pide más o ya topó?, ¿los pods nuevos quedan Pending sin GPU?, ¿el autoscaler de nodos topa con la cuota?, ¿cuánto dura el cold start? Mientras, el load shedding y el fallback manual protegen al vendedor: 503 rápidos y selector manual en vez de timeouts. A futuro: GPU de reserva o escalar antes.',
              why: 'Subir el máximo no sirve si el cuello está en la métrica, los nodos o la cuota; el senior sabe dónde mirar y qué protege al usuario mientras.' },
          ] },
          { t: 'callout', kind: 'interview', html: `<ul><li>"My first move is to mitigate: I roll back to the previous image tag, confirm the SLO recovers, and only then debug."</li><li>"For a pod in CrashLoopBackOff, I start with kubectl describe for the exit code and the events, then kubectl logs --previous, because the current container hasn't failed yet."</li><li>"Liveness only checks the process itself; dependencies go in readiness, and a startup probe covers the slow model load."</li><li>"If Triton doesn't scale, I walk the chain: the metric, the autoscaler's decision, pending pods, new GPU nodes, and the cold start."</li></ul>` },
          { t: 'callout', kind: 'skip', html: `<p>Memorizar flags, acrobacias con <code>-o jsonpath</code>, plugins de kubectl, internals de Docker (overlayfs, cgroups), modos de red o Swarm: sáltatelo. Ante un flag concreto, "lo busco en <code>--help</code>" es aceptable; no saber qué mirar primero, no.</p>` },
          { t: 'checklist', id: 'minimo-entrevista', items: [
            { id: 'metodo', html: 'Recorro <code>get</code> → <code>describe</code> → <code>logs --previous</code> → eventos → recursos.' },
            { id: 'mitigar', html: 'Digo "rollback primero, investigar después", y sé que con GitOps el rollback es un revert en git.' },
            { id: 'probes', html: 'Explico startup, readiness y liveness, y por qué las dependencias no van en liveness.' },
            { id: 'ram-vram', html: 'Distingo OOMKilled (RAM, exit 137) de <code>CUDA out of memory</code> (VRAM, en el log).' },
            { id: 'pending-gpu', html: 'Explico por qué un pod de GPU queda Pending y qué recorre hasta estar Ready.' },
            { id: 'scale', html: 'Sé por qué <code>kubectl scale</code> no sirve con HPA o KEDA y qué cambiar en su lugar.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    // Retiradas: ref-comandos-06 (defaults de probes, ya en m06-07) y ref-comandos-13 (copia de
    // m05-09). Sus ids son claves de progreso guardado: no reutilizarlos.
    flashcards: [
      { id: 'ref-comandos-01', kind: 'concepto', q: '¿Cuál es el recorrido de 5 comandos para depurar un pod?',
        a: '<code>kubectl get pods -o wide</code> (fase, reinicios, nodo) → <code>kubectl describe pod</code> (Last State, exit code, Events) → <code>kubectl logs --previous</code> (el contenedor que murió) → <code>kubectl events</code> (contexto del cluster) → <code>kubectl top</code> / <code>describe node</code> (recursos).' },
      { id: 'ref-comandos-02', kind: 'trampa', q: 'Exit code 137: ¿siempre es falta de memoria?',
        a: 'No. 137 = 128 + 9: el proceso murió por SIGKILL. Si <code>Reason</code> dice OOMKilled, fue el límite de memoria. Si no, suele ser que no terminó dentro de <code>terminationGracePeriodSeconds</code> (30 s por defecto) después del SIGTERM.' },
      { id: 'ref-comandos-03', kind: 'concepto', q: '¿Qué es CrashLoopBackOff y dónde está la causa?',
        a: 'Un síntoma: el contenedor muere una y otra vez y el kubelet espera 10 s, 20 s, 40 s… hasta 5 min entre reinicios. La causa está en <code>kubectl logs --previous</code> y en el exit code de <code>describe pod</code>.' },
      { id: 'ref-comandos-04', kind: 'trampa', q: 'Tu servicio responde <code>CUDA out of memory</code>. ¿Subes <code>limits.memory</code>?',
        a: 'No: eso es la VRAM, no la RAM del contenedor. OOMKilled (RAM) lo mata el kernel con exit 137; CUDA OOM es una excepción en el log. Se arregla con batch o resolución más chicos, menos instancias por GPU u otra GPU.' },
      { id: 'ref-comandos-05', kind: 'trampa', q: 'Triton tarda 3 min en cargar el engine y el pod reinicia en bucle antes de estar listo. ¿Qué falta?',
        a: 'Un <code>startupProbe</code> con <code>failureThreshold × periodSeconds</code> ≥ el peor tiempo de carga (c01: 60 × 5 s = 5 min). Mientras no pasa, liveness no se evalúa y el pod no recibe tráfico.' },
      { id: 'ref-comandos-07', kind: 'concepto', q: 'Pod Pending con <code>Insufficient nvidia.com/gpu</code>: ¿qué revisas?',
        a: 'Si hay GPUs libres (<code>describe node</code>: Allocatable contra Allocated), si el device plugin corre en los nodos GPU (sin él, el nodo no anuncia <code>nvidia.com/gpu</code>) y si el autoscaler de nodos puede agregar uno (tope del grupo, cuota de GPU, capacidad en la AZ).' },
      { id: 'ref-comandos-08', kind: 'trampa', q: 'El gateway tiene un HPA. ¿Qué pasa si haces <code>kubectl scale --replicas=10</code>?',
        a: 'Dura poco: el HPA vuelve a su propio cálculo y quita las réplicas de más al ritmo de su política de scaleDown (si hubieras bajado réplicas, las repondría en el siguiente ciclo, 15 s por defecto). Para cambiar capacidad cambias <code>minReplicas</code>/<code>maxReplicas</code> (o <code>minReplicaCount</code> del ScaledObject de KEDA), en git.' },
      { id: 'ref-comandos-09', kind: 'trampa', q: '¿Por qué <code>kubectl edit</code> en producción es una trampa con GitOps?',
        a: 'El cambio vive solo en el cluster: nadie lo revisó, git ya no describe lo que corre (drift) y el siguiente sync lo pisa o el self-heal lo revierte. El rollback con GitOps es un revert en git.' },
      { id: 'ref-comandos-10', kind: 'concepto', q: 'El p99 sube, el pod está Running y Ready y no hay eventos. ¿Qué sospechas y cómo lo confirmas?',
        a: 'CPU throttling por <code>limits.cpu</code>: la cuota de CFS se agota a mitad de cada ventana de 100 ms. No genera eventos: se ve con <code>container_cpu_cfs_throttled_periods_total / container_cpu_cfs_periods_total</code>. Arreglo: request sin límite de CPU.' },
      { id: 'ref-comandos-11', kind: 'trampa', q: 'Construiste la imagen en un Mac con Apple Silicon y en EKS falla. ¿Qué pasó?',
        a: 'Salió <code>arm64</code>. En los nodos x86 ves <code>no match for platform in manifest</code> al bajarla, o <code>exec format error</code> en el log. Construye con <code>--platform linux/amd64</code> (mejor: en CI) y compruébalo con <code>docker buildx imagetools inspect</code>.' },
      { id: 'ref-comandos-12', kind: 'concepto', q: '¿Para qué <code>--shm-size</code> o <code>--ipc=host</code> con PyTorch o Triton?',
        a: 'Docker da 64 MB de <code>/dev/shm</code> por defecto. Los workers del DataLoader pasan tensores por ahí (si no alcanza: "insufficient shared memory") y Triton también lo usa. En Kubernetes: un emptyDir con <code>medium: Memory</code>.' },
      { id: 'ref-comandos-14', kind: 'trampa', q: '¿Sirve <code>kubectl port-forward svc/triton</code> para hacer un load test?',
        a: 'No: elige un solo pod y pasa por el API server y el kubelet. Sirve para una prueba de humo (health, metadata del modelo, métricas); el load test va contra el Service o el balanceador real.' },
      { id: 'ref-comandos-15', kind: 'frase', q: '¿Cómo dices en inglés tu primera reacción ante un deploy que empeora el p99?',
        a: '"My first move is to mitigate: I roll back to the previous image tag, confirm the SLO recovers, and only then debug."' },
      { id: 'ref-comandos-16', kind: 'frase', q: '¿Cómo explicas en inglés cómo depuras un CrashLoopBackOff?',
        a: '"I start with kubectl describe for the exit code and the events, then kubectl logs --previous, because the current container hasn\'t failed yet."' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'CrashLoopBackOff', es: 'bucle de reinicios con espera', def: 'Estado de un contenedor que muere una y otra vez: el kubelet espera 10 s, 20 s, 40 s… (tope de 5 min) antes de cada reinicio. Es un síntoma; la causa está en <code>kubectl logs --previous</code> y en el exit code.', say: 'The pod is in CrashLoopBackOff, so I check the previous container\'s logs and its exit code.' },
      { en: 'exit code 137', es: 'código de salida 137', def: '128 + 9: el proceso murió por SIGKILL. Con <code>Reason: OOMKilled</code> fue la memoria; sin esa razón, casi siempre no terminó dentro del grace period tras el SIGTERM.', say: 'Exit code 137 means SIGKILL; the reason field tells me whether it was the OOM killer.' },
      { en: 'ImagePullBackOff', es: 'reintento de descarga de imagen con espera', def: 'El kubelet no pudo bajar la imagen (tag inexistente, sin permiso en el registry, rate limit, plataforma equivocada) y espera antes de reintentar. <code>ErrImagePull</code> es el primer fallo.', say: 'ImagePullBackOff here means the node role can\'t pull from ECR.' },
      { en: 'CreateContainerConfigError', es: 'error al armar la configuración del contenedor', def: 'El kubelet no puede crear el contenedor: falta un Secret o ConfigMap referenciado (o una clave), o <code>runAsNonRoot</code> choca con una imagen que corre como root.', say: 'CreateContainerConfigError usually means the Secret doesn\'t exist in that namespace yet.' },
      { en: 'FailedScheduling', es: 'fallo de programación del pod', def: 'Evento del scheduler cuando ningún nodo cumple lo que pide el pod (recursos como <code>nvidia.com/gpu</code>, taints, nodeSelector). El pod queda Pending con la condición <code>PodScheduled=False</code> (reason <code>Unschedulable</code>): esa condición, no el evento, es lo que mira el autoscaler de nodos.', say: 'The pod is Pending with Insufficient nvidia.com/gpu, so the question is why no GPU node was added.' },
      { en: 'node-pressure eviction', es: 'desalojo por presión del nodo', def: 'El kubelet termina pods (quedan Evicted) cuando al nodo le falta memoria o disco; primero los que usan más de lo que pidieron. Imágenes grandes y logs suelen llenar el disco.', say: 'Pods get evicted when image layers fill the node\'s disk, so GPU nodes need a larger root volume.' },
      { en: 'port-forward', es: 'reenvío de puertos', def: '<code>kubectl port-forward</code> abre un túnel desde tu máquina hasta un pod, vía API server y kubelet, sin exponer el servicio. Con <code>svc/</code> o <code>deploy/</code> elige un solo pod.', say: 'I port-forward to one Triton pod to check the model metadata without exposing it.' },
      { en: 'kubectl context', es: 'contexto de kubectl', def: 'Entrada del kubeconfig que combina cluster, usuario y namespace por defecto. Confirmarlo antes de cambiar algo evita aplicar en producción lo que era para staging.', say: 'Before any rollback, I confirm that my kubectl context points at the production cluster.' },
      { en: 'ephemeral container', es: 'contenedor efímero', def: 'Contenedor temporal que <code>kubectl debug</code> agrega a un pod en marcha para depurar con herramientas que la imagen no trae (útil con imágenes distroless). No tiene probes ni se reinicia.', say: 'The image has no shell, so I attach an ephemeral container with kubectl debug.' },
      { en: 'ProgressDeadlineExceeded', es: 'plazo de progreso vencido', def: 'Razón de la condición <code>Progressing=False</code> de un Deployment cuyo rollout no avanza en <code>progressDeadlineSeconds</code> (600 s por defecto). En GPU, esperar nodo, imagen y carga del modelo (' + E('≈ 4–11 min') + ') puede pasarlo.', say: 'GPU pods take minutes to become ready, so we raise progressDeadlineSeconds on that Deployment.' },
      { en: 'configuration drift', es: 'deriva de configuración', def: 'Diferencia entre lo que describe git y lo que corre en el cluster, típica de cambios manuales (<code>kubectl edit</code>, <code>scale</code>, <code>set image</code>). Una herramienta de GitOps la detecta y puede revertirla.', say: 'Editing the Deployment by hand creates drift, and the next sync overwrites it.' },
      { en: 'exec format error', es: 'error de formato de ejecutable', def: 'Error del kernel al ejecutar un binario de otra arquitectura: por ejemplo, una imagen arm64 construida en un Mac con Apple Silicon en un nodo x86.', say: 'An exec format error means the image was built for arm64, so I rebuild it for linux/amd64.' },
      { en: 'shared memory (/dev/shm)', es: 'memoria compartida', def: 'tmpfs que los procesos usan para intercambiar datos sin copiarlos. Docker da 64 MB por defecto: poco para los workers del DataLoader de PyTorch o para Triton.', say: 'We give the Triton container a 1 GB /dev/shm, because the 64 MB default is too small.' },
      { en: 'metrics-server', es: 'servidor de métricas de recursos', def: 'Componente que recoge CPU y memoria de los kubelets y las expone en la Metrics API. Lo usan <code>kubectl top</code> y el HPA por CPU o memoria; no viene en todos los clusters.', say: 'kubectl top returns nothing because metrics-server isn\'t installed on this cluster.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
