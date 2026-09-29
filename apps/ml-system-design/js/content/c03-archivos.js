/* =============================================================================
   Ronda de Diseño ML — js/content/c03-archivos.js
   Caso 03, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c03/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por capa, con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8c. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección de este caso y cualquier página o sección del curso.
  const C = (sec, txt) => '<a href="#c03.' + sec + '">' + txt + '</a>';
  const L = (hash, txt) => '<a href="#' + hash + '">' + txt + '</a>';
  const E = (txt) => '<span class="est">' + txt + '</span>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c03/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c03/' + path, note });

  MSD.addSection('c03', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos de <code>reference/c03/</code>, probados hasta donde se puede sin el hardware de la planta. Hay dos grupos: lo que corre en el Jetson de cada línea (el inspector y su contenedor) y dos herramientas que se usan antes de desplegar (elegir el umbral y construir el engine). Cada línea importante trae un comentario con el <b>porqué</b>. Son la versión concreta de lo que defiendes en ' + C('serving', 'serving') + ' y ' + C('fallas', 'fallas') + ': qué pasa en el milisegundo 349, quién desvía la pieza si el proceso muere y de dónde sale el 0.62 del umbral. La parte de EPP no tiene archivos propios: su pipeline de DeepStream es el mismo patrón del ' + L('c02.archivos', 'caso 2') + '.' },
      { t: 'callout', kind: 'skip',
        html: 'En la entrevista nadie te pide escribir este loop, y no hace falta memorizar flags de <code>trtexec</code> ni registros Modbus. Primera pasada: el mapa, los callouts de trampas y los tres archivos cortos (<code>decision.py</code>, <code>config.yaml</code>, <code>docker-compose.yml</code>). Lo que sí debes poder decir sin mirar: el deadline se mide desde el trigger, no desde que llega la foto; ante cualquier duda la pieza se desvía, y esa garantía la hace cumplir el PLC, no Python; los umbrales salen de un costo esperado con recall mínimo por tipo; el engine se construye en el dispositivo; y cada turno empieza con un golden check.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (macOS, sin Jetson ni GPU): los 46 tests del inspector y los 18 de la herramienta de umbrales, con pytest en Python 3.10.21 (el de JetPack 6) y en 3.13; <code>ModbusPLC</code> contra el servidor Modbus TCP real de pymodbus 3.15 (escribe y relee los dos registros; con el PLC caído, mudo o sin tiempo lanza <code>PLCError</code> en ≈ 20 ms); <code>app.py --simulate</code> como proceso (golden check, 20 piezas, <code>/metrics</code> con curl, SIGTERM → código 0 y un Engine colgado a propósito → el watchdog sale con código 3); <code>docker compose config</code>; que las 4 dependencias tengan wheel para aarch64 y Python 3.10; la configuración de la imagen <code>l4t-tensorrt:r10.3.0-runtime</code>, leída del registry de NGC (Ubuntu 22.04, Python 3.10, TensorRT 10.3.0.26 con <code>trtexec</code> y bindings de Python); los flags de <code>trtexec</code>, contra el código fuente de TensorRT 10.3; y <code>bash -n</code>.</li>' +
          '<li><b>No ejecutado</b>: no se construyó la imagen ni corrió nada en un Jetson (<code>trtexec</code>, <code>nvpmodel</code>, <code>jetson_clocks</code>); no hubo cámara ni PLC reales; y CUDA con usuario no root dentro del contenedor en JetPack 6 queda por probar (hay reportes de fallas). La cámara GigE Vision y el engine TensorRT quedan detrás de su interfaz: <code>build_hardware</code> documenta las llamadas, pero no se publica código de hardware sin probar. El <code>README.md</code> de <code>reference/c03</code> tiene la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>decision.py</code> <small>edge/inspector</small>', C('serving', '7 · Serving') + ', ' + C('evaluacion', '8 · Evaluación'), 'La regla PASS/REJECT sin I/O ni reloj; un NaN es un error, no un PASS; el mismo <code>&gt;=</code> que usa la herramienta de umbrales'],
          ['<code>app.py</code> <small>edge/inspector</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas') + ', ' + C('monitoreo', '9 · Monitoreo'), 'Deadline desde el trigger, cada camino a DIVERT (incluida la foto oscura), escritura al PLC solo si cabe, golden check, 6 métricas, una línea JSON por pieza, watchdog'],
          ['<code>config.yaml</code> <small>edge/inspector</small>', C('serving', '7 · Serving') + ', ' + C('evaluacion', '8 · Evaluación'), 'Tiempos en ms, umbrales por tipo de defecto, contrato con el PLC, piezas golden; el fail-safe no se puede configurar'],
          ['<code>test_inspector.py</code> <small>edge/inspector/tests</small>', C('fallas', '10 · Fallas'), 'Reloj falso: una inferencia de 400 ms sin esperar 400 ms; un PLC real por Modbus TCP en localhost'],
          ['<code>Dockerfile</code>, <code>requirements.txt</code> <small>edge</small>', C('serving', '7 · Serving') + ', ' + L('m04.edge-jetson', 'M4'), 'Base con el mismo TensorRT que JetPack 6.2.x, usuario no root, config y engine fuera de la imagen'],
          ['<code>docker-compose.yml</code> <small>edge</small>', C('arquitectura', '5 · Arquitectura') + ', ' + C('fallas', '10 · Fallas'), '<code>runtime: nvidia</code>, red del host por GigE Vision, solo lectura, healthcheck, rotación de logs'],
          ['<code>choose_threshold.py</code> y su test <small>tools</small>', C('evaluacion', '8 · Evaluación') + ', ' + C('costo', '12 · Costo'), 'Recall ≥ 99.5 % por tipo, capacidad de inspección manual, costo esperado por día y la cota estadística'],
          ['<code>build_engine_jetson.sh</code> <small>tools</small>', C('serving', '7 · Serving') + ', ' + L('m08.tensorrt', 'M8'), '<code>trtexec --fp16</code> en el dispositivo, con modo de energía fijo y huellas para el model registry'],
        ],
        note: 'Orden de lectura sugerido: <code>decision.py</code> → <code>app.py</code> → <code>test_inspector.py</code> → <code>config.yaml</code> → <code>choose_threshold.py</code> → <code>build_engine_jetson.sh</code> → <code>Dockerfile</code> → <code>docker-compose.yml</code>. Primero la regla, después el loop que la aplica a tiempo y al final cómo llega al dispositivo.' },

      // ------------------------------------------------------------------ inspector
      { t: 'h3', text: 'El inspector (corre en el Jetson de cada línea)' },
      { t: 'code', title: 'Loop de inspección, lógica de decisión y configuración',
        caption: 'Los tests corren sin hardware: <code>cd edge/inspector &amp;&amp; pip install -r requirements.txt pytest==9.1.1 &amp;&amp; pytest -q tests</code>.',
        files: [
          F('edge/inspector/decision.py', 'python', 'Léelo primero: unas 30 líneas deciden si una pieza llega a la armadora. <code>NaN &gt;= 0.62</code> es <code>False</code>: sin la validación explícita, un score NaN (un overflow en FP16, un wrapper de normalización roto) sería un PASS. Si falta el score de un tipo que la config declara, tampoco se asume 0: es un error y la pieza se desvía.'),
          F('edge/inspector/app.py', 'python', 'Lee <code>Inspector.inspect</code> y <code>_model_decision</code>. El presupuesto se mide contra <code>t_trigger + 350 ms</code>; la foto recibe lo que queda menos lo que necesitan el modelo y el PLC (160 ms en el caso nominal); una foto con brillo medio fuera de rango (el estrobo no disparó) es DIVERT antes de inferir, porque un clasificador puede no ver defectos en una imagen negra; si después de la foto no caben los 140 ms de preprocesamiento e inferencia, DIVERT sin gastar GPU; si quedan menos de 50 ms, no se escribe nada y el PLC desvía por default. <code>ModbusPLC</code> escribe <code>[part_id, código]</code> en una sola petición y con <code>retries=0</code>: un reintento llegaría tarde.'),
          F('edge/inspector/config.yaml', 'yaml', 'Los tiempos del caso y los umbrales (ilustrativos: salen de <code>choose_threshold.py</code>). <code>load_config</code> no arranca con una config incoherente: reserva menor a 2 timeouts del PLC, deadline que no alcanza para inferir, golden check sin una pieza mala, rango de brillo imposible o <code>fail_safe</code> distinto de <code>divert</code>.'),
          F('edge/inspector/tests/test_inspector.py', 'python', '46 tests. Un <code>FakeClock</code> que los dobles avanzan a mano prueba deadlines exactos (una foto de 200 ms, una inferencia de 400 ms, una escritura que termina a los 360 ms) en milisegundos de CPU. El PLC también se prueba contra un servidor Modbus TCP de verdad en localhost, y <code>main()</code> corre de punta a punta en modo simulado mientras el test lee <code>/metrics</code>.'),
          F('edge/inspector/requirements.txt', 'text', 'Cuatro dependencias fijadas y ninguna transitiva. NumPy 1.x, como los samples de TensorRT 10.3. TensorRT no va aquí: viene de apt en la imagen base, atado a JetPack.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: poner el fail-safe solo en el software',
        html: 'Si el proceso muere, se cuelga dentro de TensorRT o el Jetson se reinicia, nadie escribe DIVERT. Un fail-safe que depende de que el software funcione no es un fail-safe. El diseño correcto invierte el default: el PLC desvía toda pieza que no tenga un PASS válido para su <code>part_id</code> antes de llegar a la compuerta. El inspector solo puede <i>permitir</i> que una pieza pase; nunca es el que la detiene. Por eso en el registro del PLC el código 0, "sin decisión", equivale a desviar.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: medir el deadline desde que llega la foto',
        html: 'El reloj corre desde el photo-eye. Si mides desde que recibes el frame, una transferencia de 150 ms no aparece en tu latencia y la pieza llega a la compuerta sin decisión. En <code>app.py</code> todo se calcula contra <code>t_trigger</code> (deadline propagation, como en ' + L('m03.timeouts-reintentos', 'M3') + ') y el histograma <code>inspection_latency_seconds</code> tiene un bucket exactamente en 0.35 s. Un detalle más: la cámara dispara por hardware, así que cada pieza deja su frame aunque el software llegue tarde. <code>inspect</code> consume ese frame siempre (1 trigger = 1 frame); si no, la pieza siguiente se juzgaría con la foto de otra.' },
      { t: 'callout', kind: 'senior', title: 'Golden check con piezas físicas, no con imágenes guardadas',
        html: 'Las imágenes guardadas prueban el modelo; las piezas golden prueban la cadena completa: iluminación, lente, foco, cámara, modelo y umbrales. Además, la golden buena debe quedar 0.15 por debajo del umbral: si pasa raspando, algo se está moviendo antes de que aparezcan los falsos rechazos. Hasta que el check pase en ese proceso (arranque, reinicio o cambio de modelo), ninguna pieza recibe PASS y todo va a inspección manual; la aprobación vence a las 8 h (<code>golden.max_age_h</code>), así que cada turno corre el suyo. Cuesta unos minutos de inspección manual y un ingeniero de calidad lo entiende sin discusión.' },

      // ------------------------------------------------------------------ contenedor
      { t: 'h3', text: 'Contenedor en el Jetson' },
      { t: 'code', title: 'Imagen para JetPack 6 y el servicio de la línea',
        caption: 'Se construye en el Jetson (o con buildx para <code>linux/arm64</code>). Requiere Docker con el runtime nvidia y el engine en <code>/opt/inspector/models</code>.',
        files: [
          F('edge/Dockerfile', 'dockerfile', 'Base <code>l4t-tensorrt:r10.3.0-runtime</code> de NGC: Ubuntu 22.04, CUDA 12.6 y TensorRT 10.3 con bindings de Python 3.10, ≈ 1.6 GB comprimida contra ≈ 5.6 GB de <code>l4t-jetpack:r36.4.0</code>. Desde JetPack 5, <code>l4t-base</code> no monta CUDA ni TensorRT del host: los trae la imagen. NVIDIA no publica una etiqueta por cada 36.x (no hay r36.5.0): la regla es mismo JetPack mayor y mismo TensorRT que el dispositivo. Usuario no root en el grupo <code>video</code>, con una advertencia honesta: hay reportes de CUDA que falla como no root en contenedores de JetPack 6, así que se prueba en el dispositivo.'),
          F('edge/docker-compose.yml', 'yaml', '<code>runtime: nvidia</code> (en Jetson se usa esto, no el bloque <code>deploy.resources</code> del c01), <code>network_mode: host</code> por GigE Vision, filesystem de solo lectura con tmpfs para el heartbeat, config y engines montados de solo lectura, <code>restart: unless-stopped</code>, healthcheck y rotación de logs. Validado con <code>docker compose config</code>.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: una cámara GigE Vision detrás de la red bridge',
        html: 'La cámara se descubre con broadcast UDP (GVCP, puerto 3956) y las imágenes (GVSP) llegan a puertos UDP que se negocian en el momento. Con la red bridge de Docker, el broadcast no cruza el NAT y no sabes qué puertos mapear. Se usa la red del host y se paga en exposición: por eso <code>/metrics</code> se liga a la IP de la VLAN OT y no a todas las interfaces. Jumbo frames y buffers de recepción se configuran en el host, porque con red host el contenedor no puede cambiar <code>net.core.*</code>.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: creer que el healthcheck reinicia el contenedor',
        html: 'Docker sin Swarm no reinicia un contenedor <i>unhealthy</i>: el healthcheck solo cambia un estado que ves en <code>docker ps</code>. <code>restart: unless-stopped</code> actúa cuando el proceso <b>termina</b>. Si TensorRT se cuelga, el loop deja de avanzar y nadie lo reinicia; por eso <code>app.py</code> tiene un watchdog que llama a <code>os._exit(3)</code> tras 30 s sin avance (<code>sys.exit</code> desde un hilo solo termina ese hilo). Verificado con un Engine colgado a propósito: el proceso sale con código 3 y la restart policy lo levanta.' },
      { t: 'callout', kind: 'senior', title: 'Engine fuera de la imagen, al revés que en el c01',
        html: 'En el ' + L('c01.archivos', 'c01') + ' el modelo va horneado en la imagen de Triton: el registry está a un clic y el tag es la versión. Aquí la imagen pesa ≈ 1.6 GB y cruza una DMZ hacia 4 dispositivos que deben funcionar 72 h sin red, mientras el engine pesa ' + E('decenas de MB') + ' y depende del JetPack del dispositivo. Separarlos permite cambiar de modelo sin mover la imagen y dejar el engine anterior en disco: el rollback es editar <code>config.yaml</code> y reiniciar, sin red. Explicar por qué la misma decisión cambia de un caso a otro es una señal senior.' },

      // ------------------------------------------------------------------ herramientas
      { t: 'h3', text: 'Umbrales y engine (antes de desplegar)' },
      { t: 'code', title: 'Elegir el umbral por costo y construir el engine en el dispositivo',
        caption: '<code>choose_threshold.py</code> usa solo la biblioteca estándar: <code>python tools/choose_threshold.py val_scores.csv</code> con un CSV <code>score,is_defect,defect_type</code> del set de validación.',
        files: [
          F('tools/choose_threshold.py', 'python', 'Tres reglas en orden: recall ≥ 99.5 % en <b>cada</b> tipo (no en promedio: un tipo raro se esconde en el promedio); FP dentro de la capacidad de inspección manual ((3,840 − 576) ÷ 114,624 ≈ 2.85 % de las piezas buenas, que es el ≈ 2.8 % del caso medido sobre todas las piezas); y, entre los umbrales viables, el de menor costo esperado por día, con FN = US$2,000 y FP = US$0.10 por defecto. Imprime qué tipo limita el umbral. Sale con código 3 si ningún umbral cumple: sirve como gate de CI.'),
          F('tools/tests/test_choose_threshold.py', 'python', '18 tests con 12 filas calculables a mano. Uno importa <code>decision.py</code> y prueba que la herramienta y el runtime usan el mismo <code>&gt;=</code>: un score exactamente igual al umbral cuenta como atrapado en los dos.'),
          F('tools/build_engine_jetson.sh', 'bash', '<code>trtexec --fp16</code> dentro de la misma imagen base que el inspector (el TensorRT que compila es el que después carga), después de verificar L4T r36 y el modo de energía de producción y de fijar clocks con <code>jetson_clocks</code>. Guarda el sha256 del ONNX y del engine, la versión de TensorRT y el p99 para el model registry. Solo pasó <code>bash -n</code>; los flags se revisaron contra el código fuente de TensorRT 10.3.'),
        ] },
      { t: 'calc', title: 'Lo que advierte choose_threshold.py con los ≈ 300 defectos del arranque', rows: [
        { label: 'Defectos por tipo en validación', expr: '300 ÷ 4 tipos', value: '75' },
        { label: 'Cota superior al 95 % de la tasa de escapes con 0 fallas', expr: '1 − 0.05<sup>1/75</sup> (≈ 3 ÷ 75, la regla de 3)', value: '≈ 3.9 %' },
        { label: 'Defectos por tipo, sin fallas, para afirmar recall ≥ 99.5 %', expr: 'ln 0.05 ÷ ln 0.995 (la regla de 3 redondea: 3 ÷ 0.005 = 600)', value: '≈ 598' },
        { label: 'Costo por FN en el peor caso razonable (300 defectos, 0 fallas → cota 0.99 %)', expr: '576 defectos/día × 0.99 % × US$2,000', value: E('≈ US$11,400/día') },
      ], result: 'Con los datos del arranque, "recall 100 % en validación" es compatible con ≈ 4 % de escapes en un tipo. No demuestra 99.5 %: por eso el modelo nuevo corre primero en shadow mode junto a la inspección actual, y cada rechazo confirmado en planta agranda el set de defectos de validación.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: compilar el engine en tu laptop o en el servidor de entrenamiento',
        html: 'Es la misma regla del ' + L('c01.archivos', 'c01') + ' con más variantes: un engine de TensorRT queda atado a la GPU (Orin = Ampere, sm_87) y a la versión exacta de TensorRT. Se construye en un Jetson igual al de producción (mismo módulo, mismo JetPack) y dentro de la imagen del inspector. Mídelo en el modo de energía de producción y con la carcasa cerrada: la latencia cambia con <code>nvpmodel</code> y con la temperatura (' + L('m04.edge-jetson', 'M4') + '). Pasar a JetPack 7.2, que desde junio de 2026 también soporta Orin, cambia la imagen base y el TensorRT: se reconstruyen y revalidan los engines, primero en una línea.' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Tests del inspector (sin hardware)', meta: '≈ 1 min',
          html: '<code>cd reference/c03/edge/inspector</code>, crea un venv (Python 3.10 como en JetPack 6, o más nuevo), <code>pip install -r requirements.txt pytest==9.1.1</code> y <code>pytest -q tests</code>: 46 tests (PASS y REJECT, deadline, foto lenta, cámara que no responde o falla, foto oscura, error del modelo, NaN, PLC con error y escritura tardía, golden check, métricas, config inválida y un PLC Modbus TCP real en localhost).' },
        { title: 'Tests de la herramienta de umbrales', meta: '≈ 10 s',
          html: '<code>cd reference/c03/tools &amp;&amp; pytest -q tests</code>: 18 tests; solo necesita pytest.' },
        { title: 'Ver el loop funcionando (sin hardware)', meta: '≈ 15 s',
          html: 'Desde <code>edge/inspector</code>: <code>sed \'s/addr: 10.20.1.21/addr: 127.0.0.1/\' config.yaml &gt; /tmp/c03-local.yaml</code> (la config liga <code>/metrics</code> a una IP de la planta) y <code>python app.py --config /tmp/c03-local.yaml --simulate --max-parts 20</code>. Cámara, modelo y PLC simulados a 2 piezas/s: primero sale el golden check y luego una línea JSON por pieza. Mientras corre, <code>curl -s localhost:9310/metrics | grep inspection_</code> en otra terminal.' },
        { title: 'Tus umbrales', meta: 'con tu set de validación',
          html: 'Exporta un CSV <code>score,is_defect,defect_type</code> con los scores de validación (nunca los de entrenamiento) y corre <code>python tools/choose_threshold.py val_scores.csv</code>. Con <code>--json</code>, un pipeline puede escribir el umbral en <code>config.yaml</code>.' },
        { title: 'En el Jetson', meta: 'JetPack 6.2.x',
          html: 'Fija el modo de energía de producción, <code>EXPECTED_POWER_MODE=25W bash tools/build_engine_jetson.sh modelo.onnx &lt;versión&gt;</code>, y luego <code>docker compose up -d --build</code> en <code>edge/</code>. Antes de producir, el golden check desde el HMI. Cámara y engine reales se implementan detrás de sus interfaces (<code>build_hardware</code> documenta las llamadas de Aravis o harvesters y de TensorRT 10.3).' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“Each line has its own Jetson that decides locally, with a hard 350 ms deadline measured from the photo-eye trigger. If anything is late or fails, the part is diverted to manual inspection, and the PLC enforces that default: a part without a valid PASS for its ID is diverted. Thresholds come from an expected-cost analysis with a 99.5 % recall floor per defect type, and every shift starts with a golden-part check before the line gets automatic passes.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo aterriza un módulo: ' + L('m03.presupuesto', 'M3 Latencia') + ' (presupuesto y deadline), ' + L('m04.edge-jetson', 'M4 Hardware') + ' (JetPack, memoria unificada, <code>nvpmodel</code>), ' + L('m05.gpu-en-contenedor', 'M5 Contenedores') + ' (GPU dentro de un contenedor), ' + L('m08.tensorrt', 'M8 Optimización') + ' (engines de TensorRT), ' + L('m02.edge', 'M2 Patrones') + ' (operar una flota edge) y ' + L('m12', 'M12 Monitoreo') + ' (alertas sobre estas métricas). La detección de EPP reutiliza el pipeline de DeepStream del ' + L('c02.archivos', 'caso 2') + '.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
