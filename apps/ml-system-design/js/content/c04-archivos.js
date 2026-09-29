/* =============================================================================
   Ronda de Diseño ML — js/content/c04-archivos.js
   Caso 04, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c04/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por capa, con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8d. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección de este caso y cualquier página o sección del curso.
  const C = (sec, txt) => '<a href="#c04.' + sec + '">' + txt + '</a>';
  const L = (hash, txt) => '<a href="#' + hash + '">' + txt + '</a>';
  const E = (txt) => '<span class="est">' + txt + '</span>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c04/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c04/' + path, note });

  MSD.addSection('c04', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos de <code>reference/c04/</code>, probados hasta donde se puede sin una L4 y sin una cuenta de AWS. Hay cuatro grupos: el <code>seg-worker</code> (la matemática del slide y el loop que vacía la cola), su imagen y su despliegue con KEDA, la selección de regiones para gastar bien las 20 h de patólogo, y las alertas con sus tests. Cada línea importante trae un comentario con el <b>porqué</b>. Son la versión concreta de lo que defiendes en ' + C('serving', 'serving') + ', ' + C('fallas', 'fallas') + ' y ' + C('monitoreo', 'monitoreo') + ': cuándo se borra un mensaje, qué ve el patólogo si el mpp miente y por qué el mapa cosido no tiene costuras.' },
      { t: 'callout', kind: 'skip',
        html: 'En la entrevista nadie te pide escribir el loop ni recordar campos de KEDA. Primera pasada: el mapa, los callouts de trampas y la tabla "qué pasa con el mensaje" del <code>README.md</code>. Lo que sí debes poder decir sin mirar: el mensaje se borra <b>después</b> de escribir <code>summary.json</code>, que es el commit; la clave de idempotencia es sha256 + <code>model_version</code> + hash de preprocesamiento; un mpp dudoso bloquea el slide en vez de adivinar; los tiles llevan overlap y se cosen con pesos que suman 1; y el SLI de turnaround no ve lo que está atascado en la cola.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (macOS, sin GPU, sin AWS, sin daemon de Docker): 60 tests del worker, 13 de la selección y 6 del job de PSI, con pytest en venvs limpios con Python 3.12.14 (el de la imagen) y 3.13.15. Los adaptadores reales de boto3 (<code>SqsQueue</code>, <code>S3Storage</code>) contra moto 5.2.3, un emulador en memoria de SQS y S3 que también aplica la redrive policy a la DLQ; el lector real de OpenSlide 4.0.1 sobre un SVS sintético con estructura Aperio escrito con tifffile; el loop de punta a punta con esas tres piezas y un modelo falso. <code>promtool check rules</code> y <code>promtool test rules</code> de Prometheus 3.15.0: las 8 alertas disparan (o no) con series sintéticas, y los tests fallan si cambias los umbrales. <code>kubernetes-validate --strict</code> contra 1.34 y 1.36, y ScaledObject, TriggerAuthentication y PodMonitor contra los esquemas de los CRDs de KEDA 2.21.0 y prometheus-operator v0.94.1. La configuración de <code>tensorrt:26.08-py3</code> se leyó del registry de NGC, y se comprobó que los 14 paquetes tienen wheel para Linux y Python 3.12.</li>' +
          '<li><b>No ejecutado</b>: no se construyó la imagen ni corrió nada en una L4. El <code>Model</code> de TensorRT queda detrás de su interfaz: <code>load_model</code> documenta los pasos y lanza <code>NotImplementedError</code>, porque no se publica código de GPU sin probar. Tampoco se probó DICOM WSI (lab C): no había un archivo de prueba. Nada se aplicó a un cluster, y moto no es AWS. Todos los tiempos (300 tiles/s, 20 ms de CPU por tile, 5–10 s por GB) son las estimaciones del caso. El <code>README.md</code> de <code>reference/c04</code> trae la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>tiling.py</code> <small>worker</small>', C('serving', '7 · Serving') + ', ' + C('datos', '6 · Datos'), 'Nivel de lectura por mpp (1024 px del nivel 0 → 512), <code>check_mpp</code>, máscara de tejido, grilla con stride 448, <code>Stitcher</code> con rampas, mm² y % de tejido'],
          ['<code>worker.py</code> <small>worker</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas') + ', ' + C('monitoreo', '9 · Monitoreo'), '<code>Worker.handle</code>: cuándo se borra, se devuelve o se deja reaparecer el mensaje; idempotencia; heartbeat; SIGTERM; <code>summary.json</code> al final; 13 métricas'],
          ['<code>tests/</code> <small>worker</small>', C('fallas', '10 · Fallas'), 'Una cola falsa con semántica de SQS (visibilidad, conteo, DLQ), un WSI sintético "analítico" y la integración con boto3 + moto + OpenSlide'],
          ['<code>Dockerfile</code>, <code>requirements.txt</code> <small>worker</small>', C('serving', '7 · Serving') + ', ' + L('m05.dockerfile-ml', 'M5'), 'Base <code>tensorrt:26.08-py3</code>, engine horneado, OpenSlide como wheel, usuario no root'],
          ['<code>seg-worker.yaml</code> <small>k8s</small>', C('arquitectura', '5 · Arquitectura') + ', ' + C('costo', '12 · Costo') + ', ' + L('m06.keda', 'M6'), '0–4 réplicas con KEDA sobre SQS, 90 s de gracia, nodos g6.2xlarge, sin PDB a propósito, IRSA de mínimo privilegio'],
          ['<code>select_for_labeling.py</code> <small>loop</small>', C('datos', '6 · Datos') + ', ' + C('costo', '12 · Costo') + ', ' + L('m09.etiquetado', 'M9'), '15.5 h ÷ 1.5 min = 620 regiones: incertidumbre, todo lab C primero, estratos por escáner, tope por slide, golden set excluido'],
          ['<code>alerts.yml</code>, <code>alerts_test.yml</code> <small>monitoring</small>', C('monitoreo', '9 · Monitoreo') + ', ' + L('m12', 'M12'), 'Las 8 alertas, el burn rate multiventana del SLO de turnaround y sus tests con promtool'],
          ['<code>stain_psi.py</code> <small>monitoring</small>', C('monitoreo', '9 · Monitoreo') + ', ' + L('m12.deteccion-drift', 'M12'), 'PSI diario del color del tejido por lab y escáner contra training, empujado al Pushgateway'],
        ],
        note: 'Orden de lectura sugerido: <code>tiling.py</code> → <code>worker.py</code> → <code>test_worker.py</code> → <code>seg-worker.yaml</code> → <code>alerts.yml</code> → <code>select_for_labeling.py</code>. Primero la matemática que da el número del reporte, después el loop que la aplica sin perder ni duplicar slides, y al final cómo se opera.' },

      // ------------------------------------------------------------------ matemática del slide
      { t: 'h3', text: 'La matemática del slide (pura, sin I/O)' },
      { t: 'code', title: 'Nivel de lectura, máscara, grilla, stitching y números del reporte',
        caption: 'Solo depende de numpy. Los 35 tests corren en menos de 1 s: <code>cd worker &amp;&amp; pytest tests/test_tiling.py</code>.',
        files: [
          F('worker/tiling.py', 'python', 'Léelo primero. <code>choose_read_plan</code> elige el nivel más grueso que todavía es tan fino como 0.5 µm/px: en el SVS del caso (0.25 µm/px, pirámide 1/4/16) es el nivel 0, así que cada tile se lee como 1024 × 1024 y se reduce 2×. <code>check_mpp</code> devuelve flags <b>bloqueantes</b>: mpp faltante, fuera de rango, anisotrópico, más grueso que 20× o distinto (± 10 %) del mpp calibrado de ese escáner. <code>Stitcher</code> acumula Σ(peso × prob) y Σ(peso) en un mapa de 4 µm/px (≈ 37 MB por arreglo contra ≈ 2.4 GB a resolución completa) y divide al final. <code>summarize</code> cuenta tumor solo donde hay tejido y predicción, y reporta qué fracción del tejido quedó sin cubrir (los tiles con menos de 10 % de tejido no se infieren).'),
          F('worker/tests/test_tiling.py', 'python', 'Los tests que importan: el plan 1024 → 512 del caso; los 8 casos de <code>check_mpp</code> (incluido "el archivo dice 20× y el escáner es 40×"); 150 mm² → ≈ 2,990 tiles; la partición de la unidad de las rampas; y el de costuras, que compara el salto máximo entre pixeles vecinos sin overlap (0.2) contra con overlap y rampas (0.025).'),
        ] },
      { t: 'calc', title: 'Lo que cuesta leer a 20× desde un escaneo de 40×', rows: [
        { label: 'Región leída por tile', expr: '512 × 0.5 µm ÷ 0.25 µm', value: '1024 px' },
        { label: 'Pixeles a decodificar por tile', expr: '1024² ÷ 512²', value: '4×' },
        { label: 'Tiles por slide (1.5 cm² de tejido)', expr: '150 mm² ÷ (448 × 0.5 µm)²', value: E('≈ 2,990') },
        { label: 'Mapa cosido a resolución completa', expr: '150 mm² ÷ (0.5 µm)² × 4 B', value: '≈ 2.4 GB' },
        { label: 'Mapa cosido a 4 µm/px', expr: '150 mm² ÷ (4 µm)² × 4 B', value: '≈ 37 MB' },
      ], result: 'Por eso el worker necesita ≈ 4 núcleos ocupados leyendo por cada L4 (≈ 20 ms de CPU por tile × 200 tiles/s, estimado) y por eso el stitch se hace a 4 µm/px: el reporte (mm², %, polígonos para el visor) no necesita más, y el slide entero cabe en RAM.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: confiar en el mpp del archivo',
        html: 'El mpp es la única unidad física del sistema: define el nivel que lees, lo que ve el modelo y los mm² del reporte. Si un conversor de formato lo pierde o un firmware lo reporta mal, <i>nada falla</i>: un slide de 40× leído como 20× hace que el modelo vea el tejido 2× más grande y que el área salga 4× mayor. Por eso el worker compara el mpp del archivo con el mpp <b>calibrado</b> de ese escáner (ConfigMap), bloquea si no coinciden o si el escáner no está registrado, y escribe un <code>summary.json</code> con <code>qc_blocked</code> y sin números: el visor dice "sin resultado de IA" y el motivo. No es paranoia: OpenSlide 4.0.1 (junio de 2026) corrigió mpp X e Y invertidos al leer DICOM.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: tiles sin overlap (o con overlap sin pesos)',
        html: 'Un modelo convolucional ve peor en el borde de su tile: le falta contexto. Sin overlap, cada borde de tile es un escalón en el mapa (en el test, 0.2 de salto) y el patólogo ve una cuadrícula sobre el tumor. Con overlap y promedio simple, el escalón baja a la mitad pero sigue ahí. Con rampas lineales que suman 1 en el overlap (64 px = 8 px del mapa), la diferencia se reparte en 8 pasos de 0.025. Y hay que <b>dividir</b> entre la suma de pesos: sin eso, los bordes del slide quedan atenuados.' },

      // ------------------------------------------------------------------ el loop
      { t: 'h3', text: 'El loop: cola, idempotencia, heartbeat y SIGTERM' },
      { t: 'code', title: 'seg-worker y sus tests',
        caption: '<code>cd worker &amp;&amp; pip install -r requirements-dev.txt &amp;&amp; pytest</code>: 60 tests en ≈ 30 s, sin AWS ni GPU.',
        files: [
          F('worker/worker.py', 'python', 'Lee el docstring y <code>Worker.handle</code>: un solo lugar decide el destino del mensaje. <code>DeleteMessage</code> solo después de <code>summary.json</code> y del índice; ante un error, no se borra y la visibilidad pasa a 60 s × intento (backoff), y al 4.º receive SQS lo mueve a la DLQ (maxReceiveCount 3 vive en la cola, no en el código); ante SIGTERM, visibilidad 0 para que otro worker lo tome ya. Los artefactos van a <code>runs/&lt;sha&gt;-&lt;config&gt;/</code> y <code>summary.json</code> se escribe al final y apunta a ellos: un reescaneo nunca mezcla archivos de dos corridas. El worker pide <b>un</b> mensaje por receive (un slide ocupa la GPU ≈ 20–30 s: pedir 10 dejaría 9 invisibles mientras otro worker está ocioso), lee tiles en 6 hilos con una ventana acotada (OpenSlide suelta el GIL vía ctypes) y rechaza una salida del modelo con NaN (NaN ≥ 0.5 es False: se vería como "sin tumor").'),
          F('worker/tests/test_worker.py', 'python', 'Cada test es un modo de falla con nombre: redelivery después del commit (no toca la GPU), reescaneo con otro sha, error transitorio con backoff, mensaje venenoso que termina en la DLQ al tercer intento, sha distinto, NaN del modelo, falla al escribir <code>summary.json</code>, cada bloqueo de QC, SIGTERM a mitad del slide y durante el long polling, heartbeat, y un test que lee <code>alerts.yml</code> y exige que cada métrica <code>seg_*</code> exista en el worker. Los dos últimos usan boto3 contra moto y OpenSlide sobre un SVS sintético.'),
          F('worker/tests/conftest.py', 'python', '<code>FakeQueue</code> emula lo que importa de SQS con un reloj manual: visibilidad, <code>ApproximateReceiveCount</code>, receipt nuevo por entrega y redrive a la DLQ. <code>SyntheticSlide</code> calcula cada pixel de un WSI descrito por rectángulos (nunca guarda 200 MB), y el "archivo" descargado es su JSON: el sha256 y la descarga son reales.'),
          F('worker/requirements.txt', 'text', 'El lock completo (14 paquetes). OpenSlide llega como wheel (<code>openslide-bin</code>): nada de <code>apt-get install</code>. TensorRT no va aquí: viene en la imagen base, atado a su versión.'),
          F('worker/requirements-dev.txt', 'text', 'pytest, moto (S3 y SQS en memoria) y tifffile (para escribir el SVS de prueba). No entran a la imagen.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: borrar el mensaje antes de que el resultado esté escrito',
        html: 'Es el error más común en workers con colas: <code>receive → delete → procesar</code> "para que nadie más lo tome". Si el pod muere a mitad (spot, OOM, un deploy), el slide se perdió: no está en la cola ni tiene resultado, y nadie se entera hasta que un patólogo pregunta. El orden correcto es procesar → escribir el resultado (con <code>summary.json</code> al final) → índice → <code>delete</code>. El precio es que un slide puede procesarse dos veces (SQS estándar entrega "at least once" y el pod puede morir entre escribir y borrar). Por eso la idempotencia: si ya existe un <code>summary.json</code> ok con el mismo sha256 y el mismo hash de preprocesamiento, se borra el mensaje sin tocar la GPU.' },
      { t: 'callout', kind: 'senior', title: 'SIGTERM: devolver el slide, no terminarlo',
        html: 'Un slide son ≈ 20–30 s de GPU ' + E('(est.)') + '. Ante SIGTERM el worker no intenta terminarlo: aborta en el siguiente batch y lo devuelve con visibilidad 0, así que otro worker lo toma de inmediato en vez de esperar 5 min. Con eso, la gracia de 90 s solo tiene que cubrir el peor caso (un long poll de 20 s más la descarga de un WSI de 3 GB) y cabe en el aviso de 2 min de spot. Dos detalles que suman puntos: esa entrega igual cuenta para maxReceiveCount (un slide interrumpido 3 veces termina en la DLQ sin haber fallado), y por eso el Deployment no lleva PodDisruptionBudget, al revés que el verificador del ' + L('c02.archivos', 'c02') + ': sacar un worker cuesta 30 s de GPU, no un resultado.' },

      // ------------------------------------------------------------------ imagen y despliegue
      { t: 'h3', text: 'Imagen y despliegue en EKS' },
      { t: 'code', title: 'Dockerfile y manifest de Kubernetes con KEDA',
        caption: 'El engine se construye con <code>trtexec --fp16</code> en una L4, dentro de la misma imagen base, y se deja en <code>worker/model/model.plan</code> antes del <code>docker build</code>.',
        files: [
          F('worker/Dockerfile', 'dockerfile', 'Base <code>nvcr.io/nvidia/tensorrt:26.08-py3</code>: Ubuntu 24.04, CUDA 13.4.1, TensorRT 11.2.1.2 y Python 3.12, leído de la configuración de la imagen en el registry de NGC. El engine va horneado, como en el ' + L('c01.archivos', 'c01') + ': el digest de la imagen identifica código + TensorRT + modelo y queda en cada <code>summary.json</code>. Pesa ≈ 6.8 GB comprimida, y eso se paga en cada cold start desde 0 réplicas: el comentario deja anotada una alternativa más liviana, a medir.'),
          F('k8s/seg-worker.yaml', 'yaml', 'ServiceAccount con IRSA de mínimo privilegio (el archivo es de solo lectura; resultados sin <code>DeleteObject</code>), ConfigMap con el mpp calibrado de cada escáner, Deployment en <code>g6.2xlarge</code> con 1 GPU, sin límite de CPU (el throttling frenaría la lectura), <code>emptyDir</code> sobre el NVMe local y liveness por un archivo que el loop toca, PodMonitor, y el ScaledObject: 0–4 réplicas, <code>queueLength: "20"</code>, <code>scaleOnInFlight</code> para no apagar un worker con un slide en proceso y <code>cooldownPeriod</code> de 15 min antes de bajar a 0. Validado con <code>kubernetes-validate</code> y contra los CRDs de KEDA 2.21.0.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: construir el engine en otra máquina',
        html: 'Igual que en el ' + L('c01.archivos', 'c01') + ' y el ' + L('c03.archivos', 'c03') + ': un engine de TensorRT queda atado a la arquitectura de la GPU (L4 = Ada, sm_89) y a la versión exacta de TensorRT. Si alguien sube la base a <code>26.09-py3</code> (TensorRT 11.3) sin reconstruir el engine, el pod no carga el modelo. La regla operativa: el engine se construye en el pipeline, en un runner con L4, dentro de la misma imagen base; y cada cambio de base o de GPU pasa otra vez por la validación del ' + L('m10.gate', 'gate') + '.' },

      // ------------------------------------------------------------------ etiquetado
      { t: 'h3', text: 'Active learning con presupuesto de horas' },
      { t: 'code', title: 'Qué regiones etiqueta el patólogo este mes',
        caption: 'Solo biblioteca estándar: <code>python loop/select_for_labeling.py candidatos.csv --hours 15.5 --exclude-slides golden.txt -o lista.csv</code>.',
        files: [
          F('loop/select_for_labeling.py', 'python', 'Puntaje = incertidumbre de la región (entropía media por pixel, o 1 − 2 × margen al umbral). Todo lab C primero mientras esté en silent mode (<code>--priority-max-share</code> lo limita cuando ya esté validado: si no, un mes con miles de regiones de C se come las horas). El resto, en round-robin por (lab, escáner), para que un escáner con muchas regiones inciertas no acapare la lista. Como mucho 5 regiones por slide, y nunca un slide del golden set. Lee y valida el CSV con número de línea: un CSV roto no debe convertirse en una lista vacía.'),
          F('loop/tests/test_select.py', 'python', '13 tests: 20 h a 1.5 min son exactamente 800 regiones; todo C entra primero aunque A sea más incierto, o hasta su tope si lo hay; el tope por slide; los estratos quedan balanceados (± 1); el golden set nunca aparece; una región de 50 min no rompe el presupuesto.'),
        ] },
      { t: 'calc', title: 'Cuánto rinden las horas de patólogo para active learning', rows: [
        { label: 'Presupuesto del mes', expr: '20 h', value: E('≈ US$4k') },
        { label: 'Al azar, fuera de este script', expr: 'auditoría ≈ 2 h + set temporal ≈ 2.5 h', value: '≈ 4.5 h' },
        { label: 'Para active learning', expr: '(20 − 4.5) h × 60', value: '930 min' },
        { label: 'Regiones seleccionadas', expr: '930 ÷ 1.5 min', value: E('≈ 620') },
        { label: 'Lo mismo en slides anotados completos', expr: '930 ÷ (30–60 min)', value: E('≈ 15–31') },
      ], result: 'Con las mismas horas, elegir regiones da ≈ 620 ejemplos concentrados donde el modelo duda, contra 15–31 slides completos en los que casi todo el tejido repite lo que el modelo ya sabe. La auditoría y el set temporal se eligen al azar a propósito: la incertidumbre te lleva a los casos difíciles, pero solo una muestra aleatoria mide cómo le va al modelo en el slide típico. El costo por región sale de medir a los patólogos con la herramienta real, no de esta tabla.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: separar train y validación por tile',
        html: 'Los tiles vecinos comparten 64 px de overlap y, sobre todo, el mismo paciente, la misma tinción y la misma morfología. Si partes train/val por tile, el modelo "valida" sobre copias casi exactas de lo que entrenó y el Dice sale inflado. El split es por paciente (o por slide, como mínimo), y el golden set de 100 slides nunca aporta regiones al etiquetado: por eso <code>--exclude-slides</code>. Es la misma idea de ' + L('m09.leakage', 'leakage en M9') + ', con una forma que solo aparece en imágenes gigantes cortadas en pedazos.' },

      // ------------------------------------------------------------------ monitoreo
      { t: 'h3', text: 'Alertas, SLO y drift de tinción' },
      { t: 'code', title: 'Las 8 alertas, sus tests con promtool y el job de PSI',
        caption: '<code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code> (≈ 1.5 min: simula hasta 29 días de series).',
        files: [
          F('monitoring/alerts.yml', 'yaml', 'Sistema: <code>SlideQueueBacklog</code> (mensaje más viejo > 30 min durante 10 min), <code>SlideDLQNotEmpty</code>, <code>TurnaroundSLOBurn</code> (burn rate multiventana: 14.4× en 1 h y 5 min, 6× en 6 h y 30 min, con 5 % de presupuesto) y <code>SegWorkerErrors</code>. Datos: <code>StainDriftPerScanner</code> (PSI > 0.2 con ≥ 20 slides), <code>BlurryTilesSpike</code> (fracción de 2 h contra la de 7 días del mismo escáner) y <code>MissingMppMetadata</code>. Modelo: <code>MajorEditRateHigh</code> (28 días contra una baseline por lab; C no tiene baseline hasta validarlo). Las métricas de SQS salen de CloudWatch vía exportador y su nombre depende del exportador: el comentario trae la configuración para cloudwatch_exporter.'),
          F('monitoring/alerts_test.yml', 'yaml', 'Series sintéticas → ¿dispara y cuándo? Incluye los casos que "no deben" disparar: pocos slides lentos, un escáner que siempre fue borroso, lab C sin baseline. Y uno que demuestra una trampa: un counter que nace en 1 es invisible para <code>increase()</code>; por eso el worker crea sus series en 0 al arrancar.'),
          F('monitoring/stain_psi.py', 'python', 'Suma los histogramas de color del tejido de los <code>summary.json</code> del día por (lab, escáner), calcula el PSI por canal contra training y empuja <code>seg_stain_psi</code> al Pushgateway. El docstring trae el ejemplo numérico ([0.25, 0.25, 0.25, 0.25] contra [0.10, 0.20, 0.30, 0.40] ≈ 0.228). Detalles en ' + L('m12.deteccion-drift', 'M12') + '.'),
          F('monitoring/tests/test_stain_psi.py', 'python', 'La fórmula, la agregación (los <code>qc_blocked</code> no entran), el CLI y lo que se empuja: un <code>PUT</code> que reemplaza el grupo entero, para que no queden escáneres viejos.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: creer que el burn rate del SLO ve todo',
        html: 'El histograma de turnaround solo registra slides que <b>terminaron</b>. Si los workers están en crash-loop o KEDA no tiene permisos para leer la cola, no termina nada, el burn rate no tiene datos y se queda callado justo cuando más importa. Por eso existe <code>SlideQueueBacklog</code>, que mide la edad del mensaje más viejo desde SQS, sin pasar por el worker. La regla general: por cada métrica que mide lo que salió bien, una que mida lo que no salió.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: el Pushgateway no olvida',
        html: 'El Pushgateway guarda el último valor empujado para siempre. Si el job diario de PSI muere, <code>StainDriftPerScanner</code> sigue evaluando el PSI de hace una semana y nadie lo nota. Vigila la frescura con <code>push_time_seconds</code>, que el Pushgateway agrega a cada grupo, en una alerta aparte.' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Tests del worker (sin AWS ni GPU)', meta: '≈ 30 s',
          html: '<code>cd reference/c04/worker</code>, crea un venv (Python 3.12 como en la imagen, o 3.13), <code>pip install -r requirements-dev.txt</code> y <code>pytest</code>: 60 tests, incluida la integración con boto3 contra moto y OpenSlide real sobre un SVS sintético.' },
        { title: 'Selección para etiquetar y job de PSI', meta: '≈ 5 s',
          html: '<code>cd ../loop &amp;&amp; pytest -q tests</code> (13 tests, solo pytest) y <code>cd ../monitoring &amp;&amp; pytest -q tests</code> (6 tests).' },
        { title: 'Las alertas con promtool', meta: '≈ 2 min',
          html: 'Baja el release de Prometheus para tu sistema (trae <code>promtool</code>) y, en <code>monitoring/</code>: <code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code>. Cambia un umbral en <code>alerts.yml</code> y vuelve a correr: el test correspondiente falla.' },
        { title: 'Tu propia lista de etiquetado', meta: 'con tus candidatos',
          html: 'Arma un CSV <code>slide_id,lab,scanner,region_id,x,y,mean_entropy</code> (o <code>margin</code> con <code>--score margin</code>) y corre <code>python loop/select_for_labeling.py candidatos.csv --hours 15.5 --exclude-slides golden.txt -o lista.csv</code>. El resumen por lab sale en stderr.' },
        { title: 'En EKS', meta: 'con una L4',
          html: 'Construye el engine con <code>trtexec --fp16</code> dentro de <code>tensorrt:26.08-py3</code> en una L4, implementa el <code>Model</code> detrás de su interfaz y pruébalo contra el mismo set de validación, <code>docker build</code>, y <code>kubectl apply -f k8s/seg-worker.yaml</code> (requiere KEDA, el device plugin de NVIDIA, kube-prometheus-stack y la cola con su DLQ). Las reglas se cargan como PrometheusRule con el comando del <code>README.md</code>.' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“Each worker takes one slide from SQS, checks the file hash and the resolution metadata, tiles the tissue at 20× with overlap, and stitches the tile predictions with blending weights. It writes the artifacts first and summary.json last, as the commit marker, and only then deletes the message. The idempotency key is the file hash plus the model version plus the preprocessing config hash, so a redelivered message costs nothing. On SIGTERM the worker returns the slide to the queue, and after three failed attempts the message moves to a dead-letter queue that has its own alert.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo aterriza un módulo: ' + L('m02.asincrona-colas', 'M2 Patrones') + ' (colas, at-least-once, DLQ), ' + L('m06.keda', 'M6 Orquestación') + ' (KEDA y scale-to-zero), ' + L('m05.dockerfile-ml', 'M5 Contenedores') + ' (la imagen), ' + L('m08.tensorrt', 'M8 Optimización') + ' (el engine), ' + L('m09.etiquetado', 'M9 Datos') + ' (etiquetado con presupuesto), ' + L('m10.reentrenamiento', 'M10 MLOps') + ' (qué dispara un reentrenamiento) y ' + L('m12.prometheus-grafana', 'M12 Monitoreo') + ' (alertas, burn rate y drift). El patrón de worker con cola es el mismo del verificador del ' + L('c02.archivos', 'caso 2') + ', con otra política de interrupciones.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
