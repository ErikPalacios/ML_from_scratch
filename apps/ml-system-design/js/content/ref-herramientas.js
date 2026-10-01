/* =============================================================================
   Ronda de Diseño ML — js/content/ref-herramientas.js
   Parte 4 · Hoja de referencia "Herramientas por categoría": qué herramienta
   resuelve qué problema, su equivalente gestionado en cada nube y cuándo vale la
   pena nombrarla en la entrevista (y cuándo es ruido).
   CONDENSA lo que ya enseñan M6, M7, M8, M9, M10, M11 y M12 y lo que eligen los
   casos c01–c06: aquí solo se enlaza. Si una elección cambia allá, se cambia aquí.
   La tabla de equivalencias AWS | GCP | Azure usa los mismos nombres que M13
   (m13-nube.js, sección 'equivalencias', leída el 1-oct-2026), que es la fuente.
   Estado de proyectos verificado (1-oct-2026) con la API de GitHub (archivado,
   licencia, último release) y anuncios oficiales: TorchServe archivado (7-ago-2025),
   TGI en modo mantenimiento (dic-2025) y archivado, BentoML comprado por Modular
   (feb-2026, sigue Apache 2.0), Ray en la PyTorch Foundation (oct-2025), KServe
   incubating en la CNCF (nov-2025), Tecton dentro de Databricks (2025), DVC bajo
   lakeFS (nov-2025), Neptune.ai cerró su SaaS (mar-2026), W&B de CoreWeave (may-2025),
   Prefect anunció la compra de Dagster Labs (jul-2026), Langfuse en ClickHouse
   (ene-2026), promptfoo en OpenAI (mar-2026), Dynatrace anunció la compra de Arize
   (ago-2026, pendiente), Microsoft Agent Framework 1.0 (abr-2026), compromiso de
   LiteLLM 1.82.7/1.82.8 en PyPI (24-mar-2026), Vertex AI dentro de Gemini Enterprise
   Agent Platform (abr-2026), Azure AI Foundry → Microsoft Foundry (ene-2026).
   Vector DBs contra su documentación: pgvector 0.8.6 (HNSW/IVFFlat, iterative scans,
   límites de dimensiones), Milvus 3.0 (HNSW, IVF_*, DiskANN, GPU_CAGRA), Qdrant 1.19
   (HNSW filtrable, payload indexes), Weaviate (hnsw, flat, dynamic, hfresh),
   OpenSearch k-NN (faiss por defecto desde 2.18; nmslib deprecado), S3 Vectors (GA
   dic-2025), Vertex AI Vector Search (ScaNN, restricts).
   Las cuentas de memoria se recalcularon con Python.
   Contrato: docs/SPEC.md §5 y §7.4. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagrama
  // Dónde vive cada categoría. Online arriba (y 0–26), offline abajo (y 28–46),
  // monitoreo en una columna a la derecha (x 86–108). Columnas A x 2, B x 24, C x 48–50.
  // El registry (x 69–83) sube a la parte de abajo del model server por x = 76 y y = 22,
  // entre el autoscaling (x 24–42) y el carril offline, sin cruzar nodos.
  const MAPA = {
    width: 108, height: 46,
    lanes: [
      { id: 'online', label: 'Online · el request', x: 0, y: 0, w: 84, h: 26, kind: 'online' },
      { id: 'offline', label: 'Offline · datos, entrenamiento, registro', x: 0, y: 28, w: 84, h: 18, kind: 'offline' },
      { id: 'monitor', label: 'Monitoreo', x: 86, y: 0, w: 22, h: 46, kind: 'monitor' },
    ],
    nodes: [
      { id: 'client', label: 'Cliente', sub: 'app · otros equipos', x: 2, y: 4, w: 16, h: 8, kind: 'client',
        note: 'Quien llama: la app del vendedor en <a href="#c01">c01</a>, la red social en <a href="#c06">c06</a>, el sistema de archivo del laboratorio en <a href="#c04">c04</a>. No es una herramienta: es el contrato (API, timeouts, qué pasa si fallas) que fija lo demás.' },
      { id: 'gateway', label: 'Gateway', sub: 'FastAPI · auth', x: 24, y: 4, w: 18, h: 8, kind: 'service',
        note: 'Tu servicio en CPU: auth, validación, preproceso, reglas de negocio y el log de cada predicción. Casi siempre es FastAPI (o el framework que la empresa ya usa). No sirve el modelo en GPU: eso es del model server (<a href="#m07.que-hace">M7</a>).' },
      { id: 'msrv', label: 'Model server', sub: 'Triton · vLLM · ORT', x: 50, y: 4, w: 18, h: 8, kind: 'model',
        note: 'Carga el modelo, arma batches y corre la inferencia: Triton para CNNs en GPU (<a href="#c01.serving">c01</a>, <a href="#c06.serving">c06</a>), vLLM o SGLang para LLMs, ONNX Runtime dentro de tu proceso en CPU. Elección completa en <a href="#ref-herramientas.model-servers">model servers</a>.' },
      { id: 'plat', label: 'Autoscaling', sub: 'HPA · KEDA · Karpenter', x: 24, y: 16, w: 18, h: 7, kind: 'service',
        note: 'Dos lazos: HPA o KEDA agregan pods (del gateway y del model server) en segundos; Karpenter o Cluster Autoscaler agregan nodos con GPU en minutos (<a href="#m06.keda">M6</a>, <a href="#m06.nodos">M6</a>). Con un endpoint gestionado, esto lo hace la nube.' },
      { id: 'datos', label: 'Datos y eventos', sub: 'S3 · Kafka · SQS', x: 2, y: 33, w: 16, h: 8, kind: 'store',
        note: 'Lo que entra al sistema y lo que el sistema registra: objetos en S3, eventos en Kafka o Kinesis, trabajos en SQS, y los logs de predicción que escribe el gateway. Elegir entre cola y log: <a href="#ref-herramientas.datos-features">datos y features</a>.' },
      { id: 'proc', label: 'Procesamiento', sub: 'Spark · Flink · dbt', x: 24, y: 33, w: 18, h: 8, kind: 'job',
        note: 'Transforma datos crudos en datasets y features: Spark o SQL (dbt) en batch, Flink en streaming. En los casos de visión casi no hay features tabulares: el preproceso es un paquete compartido (<a href="#m09.feature-store">M9</a>).' },
      { id: 'pipe', label: 'Entrenamiento', sub: 'Airflow · KFP', x: 48, y: 33, w: 16, h: 8, kind: 'job',
        note: 'El pipeline de entrenamiento: un orquestador (Airflow, Kubeflow Pipelines, SageMaker o Vertex AI Pipelines) corre datos → entrenamiento → evaluación → gate. Registra cada corrida en el tracking (<a href="#m10.pipelines-entrenamiento">M10</a>).' },
      { id: 'reg', label: 'Registry', sub: 'MLflow', x: 69, y: 33, w: 14, h: 8, kind: 'store',
        note: 'Guarda versiones de modelo con su linaje y un alias (<code>@champion</code>) que el despliegue lee. Promover es mover el alias; el rollout progresivo (Argo Rollouts, Flagger o el del endpoint gestionado) lo lleva a producción (<a href="#m10.model-registry">M10</a>, <a href="#m11.canary">M11</a>).' },
      { id: 'prom', label: 'Métricas', sub: 'Prometheus · Grafana', x: 88, y: 4, w: 18, h: 8, kind: 'monitor',
        note: 'Prometheus hace scrape de <code>/metrics</code> del gateway y del model server, Grafana lo grafica y Alertmanager decide a quién despertar (<a href="#m12.prometheus-grafana">M12</a>). En la nube: CloudWatch, Cloud Monitoring o Azure Monitor, todos con un Prometheus gestionado.' },
      { id: 'drift', label: 'Drift y calidad', sub: 'Evidently · job propio', x: 88, y: 33, w: 18, h: 8, kind: 'monitor',
        note: 'Un job batch compara los logs de predicción de hoy contra la referencia que se versiona con el modelo, y publica el resultado como métrica. Evidently o 50 líneas de numpy: lo que importa es qué variable, qué umbral y qué pasa al disparar (<a href="#m12.deteccion-drift">M12</a>).' },
    ],
    edges: [
      { from: 'client', to: 'gateway', kind: 'online' },
      { from: 'gateway', to: 'msrv', kind: 'online', label: 'tensor' },
      { from: 'plat', to: 'gateway', kind: 'neutral', dashed: true, fromSide: 't', toSide: 'b' },
      { from: 'msrv', to: 'prom', kind: 'monitor', label: '/metrics' },
      { from: 'datos', to: 'proc', kind: 'offline' },
      { from: 'proc', to: 'pipe', kind: 'offline' },
      { from: 'pipe', to: 'reg', kind: 'offline' },
      { from: 'reg', to: 'msrv', kind: 'offline', dashed: true, fromSide: 't', toSide: 'b', via: [[76, 22], [59, 22]], label: 'rollout' },
      { from: 'reg', to: 'drift', kind: 'monitor', dashed: true },
    ],
    flows: [
      { id: 'request', label: 'Un request', steps: [
        { nodes: ['client', 'gateway'], edges: ['client>gateway'], text: 'Llega la foto al gateway: auth, validación, decode y resize en CPU. Herramienta: tu servicio (FastAPI). Aquí no hay nada que nombrar más allá del framework.' },
        { nodes: ['gateway', 'msrv'], edges: ['gateway>msrv'], text: 'El gateway manda el tensor al model server. Lo que sí se nombra: <b>qué</b> model server y <b>por qué</b> (batching en GPU, varios modelos, protocolo).' },
        { nodes: ['msrv', 'prom'], edges: ['msrv>prom'], text: 'Cada pieza expone <code>/metrics</code>; Prometheus las junta y Alertmanager pagina si se rompe el SLO.' },
      ] },
      { id: 'modelo', label: 'Un modelo nuevo', steps: [
        { nodes: ['datos', 'proc'], edges: ['datos>proc'], text: 'Los logs y los labels nuevos se convierten en un dataset versionado (snapshot o tabla con time travel).' },
        { nodes: ['proc', 'pipe'], edges: ['proc>pipe'], text: 'El orquestador corre entrenamiento, evaluación y gate; cada corrida queda en el tracking.' },
        { nodes: ['pipe', 'reg'], edges: ['pipe>reg'], text: 'El candidato que pasa el gate entra al registry con su linaje.' },
        { nodes: ['reg', 'msrv', 'drift'], edges: ['reg>msrv', 'reg>drift'], text: 'Mover el alias dispara el rollout progresivo (shadow, canary). La referencia de drift se versiona con ese modelo.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'ref-herramientas',
    kind: 'special',
    sections: [
      // ======================================================== 1
      {
        id: 'mapa',
        title: 'El mapa: problema → categoría → herramienta',
        titleEn: 'The map: problem → category → tool',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Una herramienta se nombra para resolver un problema que ya dijiste en voz alta. Por eso esta hoja empieza por el problema. Cada fila da el default que defenderías hoy, la alternativa con su condición y el caso del curso donde aparece. El porqué largo está en los módulos enlazados; aquí solo está la tabla.` },
          { t: 'table', caption: 'Del problema a la herramienta (estado a octubre de 2026)', head: ['Problema', 'Categoría', 'Default', 'Alternativa y cuándo', 'En los casos'], rows: [
            ['Servir una CNN en GPU con QPS medio o alto', 'Model server', 'Triton detrás de un gateway', 'Endpoint gestionado si no hay plataforma; FastAPI + PyTorch para el MVP', '<a href="#c01.serving">c01</a>, <a href="#c06.serving">c06</a>'],
            ['Modelo chico en CPU, pocas req/s', 'Runtime en tu proceso', 'FastAPI + ONNX Runtime', 'OpenVINO en CPUs Intel', '<a href="#c05.serving">c05</a> (clasificador)'],
            ['Video de muchas cámaras', 'Pipeline de video', 'DeepStream (decode en NVDEC + TensorRT)', 'GStreamer o PyAV propio si son pocas cámaras', '<a href="#c02.serving">c02</a>, <a href="#c03.serving">c03</a>'],
            ['Inferencia en un Jetson o en la planta', 'Runtime optimizado', 'TensorRT (engine compilado en el dispositivo)', 'ONNX Runtime con el execution provider de TensorRT', '<a href="#c03.serving">c03</a>'],
            ['Generar texto con un LLM propio', 'Motor de LLM', 'vLLM', 'SGLang con prefijos compartidos; TensorRT-LLM a gran escala en NVIDIA', '<a href="#c10">c10</a> (próximamente)'],
            ['Escalar réplicas por cola o a cero', 'Autoscaler por eventos', 'KEDA', 'HPA si la señal es CPU o una métrica del pod', '<a href="#c04.serving">c04</a>, <a href="#c01.serving">c01</a>'],
            ['Agregar nodos con GPU', 'Autoscaler de nodos', 'Karpenter (EKS)', 'Cluster Autoscaler; el de GKE o AKS', '<a href="#c04.serving">c04</a>, <a href="#m06.nodos">M6</a>'],
            ['Desacoplar productor y consumidor', 'Cola', 'SQS', 'Pub/Sub o Service Bus en otra nube', '<a href="#c02.arquitectura">c02</a>, <a href="#c04.arquitectura">c04</a>'],
            ['Eventos que varios consumidores releen', 'Log de eventos', 'Kafka (MSK)', 'Kinesis Data Streams si todo es AWS', '<a href="#c06.arquitectura">c06</a>'],
            ['Un flujo de pasos por ítem, con reintentos y espera humana', 'Workflow engine', 'Step Functions', 'Temporal si quieres portabilidad y lo puedes operar', '<a href="#c05.arquitectura">c05</a>'],
            ['Jobs batch programados (ETL, reentrenamiento)', 'Orquestador', 'El que la empresa ya opera (Airflow casi siempre)', 'Kubeflow, SageMaker o Vertex AI Pipelines para ML', '<a href="#m09.pipelines">M9</a>, <a href="#m10.pipelines-entrenamiento">M10</a>'],
            ['Features de entidades compartidas online y offline', 'Feature store', 'Feast si lo operas tú; el de tu nube si ya vives ahí', 'Nada: en visión, un paquete de preproceso compartido', '<a href="#m09.feature-store">M9</a>; descartado en c01 y c03'],
            ['Saber con qué datos se entrenó', 'Versionado de datos', 'Snapshot inmutable con id (prefijo en S3 o tabla Iceberg/Delta)', 'DVC en un repo chico; lakeFS sobre un lake grande', '<a href="#m09.versionado">M9</a>, <a href="#c01.datos">c01</a>'],
            ['Etiquetar', 'Herramienta de anotación', 'Label Studio o CVAT', 'QuPath en patología; una UI propia si la revisión es el producto', '<a href="#c04.datos">c04</a>, <a href="#c05.datos">c05</a>'],
            ['Registrar corridas y versiones de modelo', 'Tracking + registry', 'MLflow', 'W&B si el equipo vive en su interfaz', '<a href="#m10.model-registry">M10</a>, <a href="#c01.datos">c01</a>'],
            ['Lanzar sin romper', 'Progressive delivery', 'Argo Rollouts en Kubernetes', 'Pesos en el ALB (c01); Flagger con una malla; el canary del endpoint gestionado', '<a href="#m11.canary">M11</a>, <a href="#c01.evaluacion">c01</a>'],
            ['Métricas y alertas', 'Monitoreo', 'Prometheus + Grafana + Alertmanager', 'CloudWatch o el monitoreo de tu nube', '<a href="#m12.prometheus-grafana">M12</a>, todos'],
            ['Drift de entradas y salidas', 'Monitoreo de modelo', 'Un job propio que publica PSI como métrica', 'Evidently como librería', '<a href="#m12.deteccion-drift">M12</a>, <a href="#c04.monitoreo">c04</a>'],
            ['Buscar por similitud', 'Vector DB', 'pgvector si ya tienes Postgres', 'Qdrant, Milvus u OpenSearch cuando no cabe o no alcanza', '<a href="#c07">c07</a> (próximamente)'],
          ] },
          { t: 'diagram', id: 'ref-herramientas-mapa', title: 'Dónde vive cada categoría', caption: 'Toca un nodo para ver qué herramientas van ahí y dónde se explican. Las categorías que no aparecen (colas, workflow engines, vector DBs) se enchufan en el camino online o en el offline según el patrón de <a href="#m02">M2</a>.', spec: MAPA },
          { t: 'callout', kind: 'why', title: 'Por qué empezar por el problema', html: `<p>El entrevistador no anota que conozcas Kafka: anota si sabías que necesitabas un log que varios consumidores releen, y por qué una cola no alcanzaba. Si dices el problema primero, la herramienta se vuelve un detalle verificable; si dices la herramienta primero, te van a preguntar "¿por qué?" y vas a tener que reconstruir el problema hacia atrás.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>No memorices versiones, licencias ni quién compró a quién: están en esta hoja para que no te sorprendan, no para recitarlas. Lo único de "estado" que vale la pena saber de memoria: TorchServe y TGI no se eligen para sistemas nuevos (archivados), y Vertex AI y Azure AI Foundry cambiaron de nombre (si lo dices con el nombre viejo, se entiende igual).</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'model-servers',
        title: 'Model servers, runtimes y compiladores',
        titleEn: 'Model servers, runtimes and compilers',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Cuatro capas que se confunden; cada una va dentro de la siguiente: Triton (servidor) corre un engine de TensorRT (compilador) o un modelo de ONNX Runtime (runtime), en pods que KServe (plataforma) crea. La tabla de elección con su porqué es <a href="#m07.tabla-eleccion">M7</a>.` },
          { t: 'table', caption: 'No los confundas', head: ['Capa', 'Qué hace', 'Ejemplos', 'Pregunta que responde'], rows: [
            ['Compilador / optimizador', 'Convierte el modelo en algo más rápido para un hardware', 'TensorRT, OpenVINO (también runtime), torch.compile', '¿Cuántos ms por batch en esta GPU o CPU?'],
            ['Runtime', 'Ejecuta el modelo dentro de un proceso', 'ONNX Runtime, PyTorch, TensorRT runtime', '¿Qué librería llama a los kernels?'],
            ['Model server', 'Proceso de red: cola, batching, versiones, métricas, varios modelos', 'Triton, BentoML, Ray Serve, vLLM, SGLang', '¿Cómo llegan los requests y cómo se agrupan?'],
            ['Plataforma de serving', 'Crea y escala servidores a partir de un recurso declarativo', 'KServe, endpoints gestionados (SageMaker AI, Vertex AI, Azure ML)', '¿Quién crea, escala y actualiza los servidores?'],
          ] },
          { t: 'table', caption: 'Servidores y plataformas', head: ['Herramienta', 'Qué es', 'Para qué sí', 'Cuándo NO', 'Gestionado', 'Dónde'], rows: [
            ['<b>FastAPI + PyTorch u ORT</b>', 'Tu servicio con el modelo en el proceso', 'MVP, CPU, pocas req/s, lógica pegada al modelo', 'GPU con QPS medio o alto: no hay batching ni métricas de cola', 'Cualquier contenedor en un endpoint', '<a href="#m07.fastapi">M7</a>'],
            ['<b>Triton</b> (Dynamo-Triton)', 'Servidor de NVIDIA, C++, multi-framework', 'GPU, dynamic batching, varios modelos por GPU, ensembles', 'Un modelo en CPU a pocas req/s; LLMs sin su backend de LLM', 'Contenedor de Triton en SageMaker AI, Vertex AI o Azure ML', '<a href="#m07.triton">M7</a>, <a href="#c01.serving">c01</a>'],
            ['<b>BentoML</b>', 'Framework de Python para empaquetar y servir; de Modular desde feb-2026, sigue Apache 2.0', 'Empaquetar servicio + modelo rápido; servicios compuestos', 'SLOs de pocos ms con máximo throughput por GPU', 'BentoCloud', '<a href="#m07.ray-bento">M7</a>'],
            ['<b>Ray Serve</b>', 'Serving sobre un cluster de Ray; Ray está en la PyTorch Foundation desde oct-2025', 'Pipelines de varios modelos con mucho Python; equipos que ya usan Ray', 'Un modelo simple; nadie que opere Ray', 'Anyscale (Nscale anunció su compra en jul-2026)', '<a href="#m07.ray-bento">M7</a>'],
            ['<b>KServe</b>', 'CRD <code>InferenceService</code> en Kubernetes; incubating en la CNCF desde nov-2025', 'Muchos modelos y equipos sobre un estándar', 'Sin Kubernetes, o un par de modelos', '— (es lo que montas tú)', '<a href="#m07.torchserve-kserve">M7</a>'],
            ['<b>TorchServe</b>', 'Servidor de PyTorch; repo archivado el 7-ago-2025, último release 0.12.0', 'Solo lo que ya existe', 'Cualquier sistema nuevo: sin parches de seguridad', '—', '<a href="#m07.torchserve-kserve">M7</a>'],
            ['<b>Endpoint gestionado</b>', 'SageMaker AI, Vertex AI (Agent Platform), Azure ML managed online endpoints', 'Equipo sin plataforma, pocos modelos', 'Muchos modelos, control fino de red y runtime, costo por instancia', 'Es el gestionado', '<a href="#m07.tabla-eleccion">M7</a>, <a href="#m06.serverless">M6</a>'],
          ] },
          { t: 'table', caption: 'Runtimes, compiladores y video', head: ['Herramienta', 'Qué es', 'Para qué sí', 'Cuándo NO', 'Dónde'], rows: [
            ['<b>ONNX Runtime</b>', 'Runtime de ONNX con execution providers (CPU, CUDA, TensorRT, OpenVINO)', 'CPU en tu proceso; un formato para varios hardware', 'Exprimir una GPU NVIDIA (ahí TensorRT)', '<a href="#m08.onnx">M8</a>'],
            ['<b>TensorRT</b>', 'Compilador + runtime de NVIDIA; el engine queda atado a GPU y versión', 'Latencia mínima en NVIDIA, FP16/INT8, Jetson', 'Hardware mixto; operadores raros sin soporte', '<a href="#m08.tensorrt">M8</a>, <a href="#c01.serving">c01</a>'],
            ['<b>OpenVINO</b>', 'Compilador + runtime de Intel (CPU, GPU integrada, NPU)', 'Inferencia en CPUs Intel, INT8 con VNNI/AMX', 'GPUs NVIDIA', '<a href="#m08.cpu-inferencia">M8</a>'],
            ['<b>DeepStream</b>', 'SDK de NVIDIA sobre GStreamer: decode NVDEC, batch de streams, TensorRT, tracker', 'Muchas cámaras en una GPU o un Jetson', 'Imágenes sueltas por HTTP (eso es Triton)', '<a href="#c02.serving">c02</a>, <a href="#c03.serving">c03</a>'],
          ] },
          { t: 'table', caption: 'Motores de LLM (detalle en la sección de stack de LLMs)', head: ['Herramienta', 'Estado a oct-2026', 'Cuándo'], rows: [
            ['<b>vLLM</b>', 'Activo (v0.30, sept-2026)', 'El default para pesos abiertos en GPU'],
            ['<b>SGLang</b>', 'Activo (v0.5.20, sept-2026)', 'Prefijos compartidos, agentes, salida estructurada: compáralo con vLLM midiendo'],
            ['<b>TGI</b> (Hugging Face)', 'Modo mantenimiento desde dic-2025; repo archivado', 'Solo lo que ya existe'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Lo sirvo con ONNX"', html: `<p>ONNX es un formato y ONNX Runtime una librería: ninguno de los dos recibe requests, arma batches ni expone métricas. "Exporto a ONNX y lo corro con ONNX Runtime dentro de mi servicio en CPU" o "lo compilo a TensorRT y lo sirvo con Triton" son frases completas; "lo sirvo con ONNX" le dice al entrevistador que mezclas capas.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"It's a CNN on a GPU at a 500 request-per-second design peak, so I compile it to TensorRT and serve it with Triton for dynamic batching, behind a FastAPI gateway that does auth and preprocessing. If the team had no platform, I'd run the same Triton container on a managed endpoint instead of building on Kubernetes."</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'orquestacion',
        title: 'Orquestación: contenedores, escalado, workflows y despliegue',
        titleEn: 'Orchestration: containers, scaling, workflows and delivery',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `"Orquestar" se usa para cuatro cosas distintas, y cada una tiene su herramienta. Si en la entrevista dices "lo orquesto con Kubernetes" para un pipeline de reentrenamiento mensual, dijiste la categoría equivocada.` },
          { t: 'table', caption: 'Cuatro sentidos de "orquestar"', head: ['Qué orquestas', 'Unidad', 'Herramientas', 'Pregunta clave'], rows: [
            ['Contenedores de larga vida (servicios)', 'Pod, Deployment', 'Kubernetes (EKS, GKE, AKS)', '¿Cuántas réplicas, en qué nodos, cómo se reemplazan?'],
            ['Jobs batch con dependencias (DAG por fecha)', 'Tarea, DAG, asset', 'Airflow, Dagster, Prefect, Argo Workflows, Kubeflow Pipelines', '¿Qué corre después de qué, y cómo reproceso un día?'],
            ['Un flujo por ítem, de minutos a días', 'Ejecución de workflow', 'Step Functions, Temporal', '¿Dónde está el documento 4,512 y qué espera?'],
            ['Cómo llega una versión nueva a producción', 'Rollout', 'Argo Rollouts, Flagger, Argo CD (GitOps)', '¿Qué % de tráfico, con qué métrica de guardia, cómo vuelvo?'],
          ] },
          { t: 'table', caption: 'Herramientas', head: ['Herramienta', 'Qué es', 'Para qué sí', 'Cuándo NO', 'Gestionado', 'Dónde'], rows: [
            ['<b>Kubernetes</b>', 'Orquestador de contenedores', 'Varios servicios y modelos, GPUs compartidas, equipo de plataforma', 'Un modelo, sin nadie que opere el cluster: un endpoint gestionado', 'EKS, GKE, AKS', '<a href="#m06.por-que-k8s">M6</a>'],
            ['<b>KEDA</b>', 'Autoscaler por eventos (colas, Kafka, Prometheus); permite escalar a cero', 'Workers que escalan con la profundidad de la cola', 'Escalar por CPU: el HPA basta', 'Add-on de AKS; en EKS y GKE lo instalas tú', '<a href="#m06.keda">M6</a>, <a href="#c04.serving">c04</a>'],
            ['<b>Karpenter</b>', 'Autoscaler de nodos que elige el tipo de instancia por pod pendiente', 'GPUs, spot, varios tamaños de instancia', '—', 'EKS; AKS lo usa como node auto-provisioning', '<a href="#m06.nodos">M6</a>'],
            ['<b>Cluster Autoscaler</b>', 'Autoscaler de nodos sobre grupos fijos', 'Clusters con node groups ya definidos', '—', 'Integrado en GKE y AKS', '<a href="#m06.nodos">M6</a>'],
            ['<b>Argo Rollouts</b>', 'Controlador de canary y blue/green con análisis por métricas', 'Canary con rollback automático en Kubernetes', 'Sin Kubernetes', '—', '<a href="#m11.canary">M11</a>'],
            ['<b>Flagger</b>', 'Progressive delivery sobre una malla o un ingress (ecosistema Flux)', 'Si ya usas Flux o una malla', 'Igual que Argo Rollouts', '—', '<a href="#m11.canary">M11</a>'],
            ['<b>Argo Workflows</b>', 'DAGs de contenedores en Kubernetes', 'Pasos pesados en contenedores (GPU) dentro del cluster', 'Si el equipo ya opera Airflow', '—', '<a href="#m09.pipelines">M9</a>'],
            ['<b>Airflow</b> (3.x)', 'Orquestador de DAGs en Python, el más extendido', 'ETL y reentrenamiento programados, backfills', 'Flujos por ítem en tiempo real', 'MWAA, Cloud Composer; en Azure, Apache Airflow job de Fabric', '<a href="#m09.pipelines">M9</a>'],
            ['<b>Dagster</b>', 'Orquestador centrado en assets (tablas, modelos) y particiones', 'Equipos de datos que piensan en tablas y linaje', 'Si ya hay Airflow funcionando', 'Dagster+', '<a href="#m09.pipelines">M9</a>'],
            ['<b>Prefect</b>', 'Orquestación de funciones de Python', 'Flujos dinámicos escritos como código normal', 'Igual que Dagster', 'Prefect Cloud', '—'],
            ['<b>Kubeflow Pipelines</b>', 'Pipelines de ML en Kubernetes, caché de pasos, artefactos', 'Varios modelos con un equipo que opera el cluster', 'Un modelo al mes: sobreingeniería', 'Agent Platform Pipelines (ex Vertex AI Pipelines) ejecuta el mismo formato', '<a href="#m10.pipelines-entrenamiento">M10</a>'],
            ['<b>Step Functions</b>', 'Máquina de estados gestionada de AWS', 'Flujos por ítem con reintentos, Catch y espera humana (<code>waitForTaskToken</code>)', 'Fuera de AWS', 'Es el gestionado', '<a href="#c05.arquitectura">c05</a>'],
            ['<b>Temporal</b>', 'Workflows durables escritos en código', 'Flujos largos y portables entre nubes', 'Si nadie va a operar otro cluster (o pagar Temporal Cloud)', 'Temporal Cloud', '<a href="#c05.tradeoffs">c05</a>'],
          ] },
          { t: 'callout', kind: 'note', title: 'Movimientos de 2025–2026', html: `<p>Airflow 3 salió en abril de 2025 (3.3 en julio de 2026). Prefect anunció en julio de 2026 la compra de Dagster Labs; los dos proyectos siguen con su nombre y su licencia. Azure dejó el Airflow de Data Factory (Workflow Orchestration Manager) solo para clientes existentes y empuja a Fabric. Nada de esto cambia una respuesta de entrevista: "el orquestador que la empresa ya opera" sigue siendo el default.</p>` },
          { t: 'callout', kind: 'trap', title: 'Airflow para cada documento', html: `<p>Airflow está hecho para DAGs por fecha: cada ejecución es "el día 2026-10-01", y el scheduler no está pensado para miles de ejecuciones chicas por minuto ni para esperar días a que una persona apruebe. Un flujo por documento con revisión humana es un workflow engine (Step Functions en <a href="#c05.arquitectura">c05</a>); el reentrenamiento mensual sí es Airflow.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>"Uso el orquestador que la empresa ya tiene" es una respuesta senior, no una evasiva, siempre que digas qué necesitas de él: reintentos por paso, backfill, historial y un gate. Montar Kubeflow para un modelo mensual es el ejemplo clásico de sobreingeniería (<a href="#m10.pipelines-entrenamiento">M10</a>).</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'datos-features',
        title: 'Datos, streaming, features, versionado y etiquetado',
        titleEn: 'Data, streaming, features, versioning and labeling',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'table', caption: 'Mover datos: cola vs log vs procesamiento', head: ['Herramienta', 'Qué es', 'Para qué sí', 'Cuándo NO', 'Gestionado', 'Dónde'], rows: [
            ['<b>SQS</b>', 'Cola: cada mensaje lo procesa un consumidor y se borra', 'Trabajo asíncrono, reintentos, DLQ, escalar workers por profundidad', 'Varios consumidores que releen la historia', 'Es el gestionado (Pub/Sub, Service Bus en otras nubes)', '<a href="#m02.asincrona-colas">M2</a>, <a href="#c04.arquitectura">c04</a>'],
            ['<b>Kafka</b>', 'Log particionado y retenido: cada consumer group lee a su ritmo y puede rebobinar', 'Muchos consumidores, replay, orden por clave, alto volumen', 'Una cola de trabajos simple: es más infraestructura', 'MSK, Managed Service for Apache Kafka (GCP), Event Hubs (API de Kafka), Confluent Cloud', '<a href="#m02.streaming">M2</a>, <a href="#c06.arquitectura">c06</a>'],
            ['<b>Kinesis Data Streams</b>', 'El log gestionado de AWS (shards)', 'Streaming dentro de AWS sin operar Kafka', 'Ecosistema de Kafka (conectores, multi-nube)', 'Es el gestionado', '<a href="#m02.streaming">M2</a>'],
            ['<b>Spark</b>', 'Procesamiento distribuido en batch (y micro-batch)', 'Joins y agregados sobre TB, backfills', 'Datos que caben en una máquina: pandas o Polars', 'EMR, Glue, Dataproc, Databricks', '<a href="#m09.pipelines">M9</a>'],
            ['<b>Flink</b>', 'Streaming con estado y event time', 'Features en ventanas de segundos (fraude)', 'Si una latencia de minutos alcanza: micro-batch', 'Amazon Managed Service for Apache Flink', '<a href="#m09.pipelines">M9</a>, <a href="#c09">c09</a>'],
            ['<b>Beam / Dataflow</b>', 'Un modelo de programación para batch y streaming; Dataflow lo ejecuta en GCP', 'GCP, mismo código en batch y streaming', 'Fuera de GCP casi no se usa Beam', 'Dataflow', '<a href="#m09.pipelines">M9</a>'],
            ['<b>dbt</b>', 'Transformaciones en SQL versionadas y testeadas sobre el warehouse', 'Tablas de features y de evaluación en SQL', 'Lógica que no es SQL', 'Plataforma gestionada de dbt Labs', '—'],
          ] },
          { t: 'table', caption: 'Features, versionado, validación y etiquetado', head: ['Herramienta', 'Qué es', 'Para qué sí', 'Cuándo NO', 'Dónde'], rows: [
            ['<b>Feast</b>', 'Feature store open source (LF AI &amp; Data): definiciones, PIT joins, materialización a un online store', 'Features de entidades compartidas, sin atarte a una nube', 'Visión sin features tabulares (c01, c03)', '<a href="#m09.feature-store">M9</a>'],
            ['<b>Tecton</b>', 'Feature store gestionado, fuerte en tiempo real; parte de Databricks desde 2025', 'Si ya vives en Databricks', 'Fuera de Databricks: pregunta por su hoja de ruta', '<a href="#m09.feature-store">M9</a>'],
            ['<b>Feature store de tu nube</b>', 'SageMaker Feature Store, Agent Platform Feature Store (ex Vertex AI), managed feature store de Azure ML', 'Ya estás en esa nube', 'Multi-nube', '<a href="#m09.feature-store">M9</a>'],
            ['<b>Delta Lake / Iceberg</b>', 'Formatos de tabla abiertos sobre Parquet: transacciones, time travel', 'Snapshots reproducibles de datasets tabulares', 'Millones de imágenes sueltas: versiona el manifiesto, no los píxeles', '<a href="#m09.versionado">M9</a>'],
            ['<b>DVC</b>', 'Versionado de datos con git (punteros a S3); bajo lakeFS desde nov-2025, sigue open source', 'Un repo, un equipo, datasets medianos', 'Un lake compartido de muchos TB', '<a href="#m09.versionado">M9</a>'],
            ['<b>lakeFS</b>', 'Ramas y commits sobre el object storage', 'Lakes grandes, write-audit-publish', 'Un dataset de un equipo', '<a href="#m09.versionado">M9</a>'],
            ['<b>Great Expectations</b> (GX Core 1.x)', 'Tests declarativos sobre datos', 'Contratos de datos en el pipeline', 'Si basta con 5 asserts', '<a href="#m09.validacion-datos">M9</a>'],
            ['<b>Pandera</b>', 'Esquemas de DataFrames en Python', 'Validar en el mismo código de pandas o Polars', 'Datos fuera de Python', '<a href="#m09.validacion-datos">M9</a>'],
            ['<b>Label Studio</b>', 'Anotación multimodal open source (HumanSignal)', 'Texto, documentos, imágenes en una sola herramienta', 'Video pesado o volúmenes enormes sin workforce', '<a href="#c05.datos">c05</a>, <a href="#m09.etiquetado">M9</a>'],
            ['<b>CVAT</b>', 'Anotación de visión open source (MIT)', 'Cajas, polígonos, video con tracking', 'Texto y documentos', '<a href="#m09.etiquetado">M9</a>'],
            ['<b>QuPath</b>', 'Visor y anotador de WSI', 'Patología digital', 'Fuera de patología', '<a href="#c04.datos">c04</a>'],
          ], note: 'Etiquetado gestionado: SageMaker Ground Truth en AWS y data labeling de Azure ML. El Data Labeling Service de Vertex AI se apagó el 3-oct-2024: Google remite a partners del Marketplace.' },
          { t: 'callout', kind: 'trap', title: 'Kafka porque "es lo que se usa"', html: `<p>Si el problema es "un worker procesa cada slide una vez, con reintentos", una cola resuelve todo y escala a cero (<a href="#c04.arquitectura">c04</a>). Kafka se justifica cuando varios consumidores necesitan el mismo evento o rebobinar la historia: en <a href="#c06.arquitectura">c06</a>, el deep scorer, enforcement y las métricas leen <code>mod-events</code> cada uno a su ritmo. Di cuál de las dos propiedades necesitas.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>Las diferencias finas entre Iceberg y Delta, entre Dagster y Prefect, o entre Great Expectations y Pandera casi nunca se preguntan en una ronda de diseño de ML. Basta con la categoría y una frase: "versiono el dataset como snapshot inmutable y guardo su id en la corrida".</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'experimentos-registro',
        title: 'Experimentos y registro de modelos',
        titleEn: 'Experiment tracking and model registry',
        priority: 'core',
        dims: ['monitoreo', 'tradeoffs'],
        blocks: [
          { t: 'table', caption: 'Estado a octubre de 2026 (verifica condiciones comerciales: cambian)', head: ['Herramienta', 'Qué es', 'Registry', 'Cuándo', 'Ojo con'], rows: [
            ['<b>MLflow</b> (3.x)', 'Open source (Apache 2.0): tracking, registry, evaluación, también de GenAI', 'Model Registry con <b>aliases</b> (<code>@champion</code>); los stages están deprecados desde 2.9', 'Default si nadie eligió, o si los datos no salen de tu nube', 'Lo operas tú: Postgres + S3; el commit que guarda no avisa de cambios sin commit (<a href="#m10.experiment-tracking">M10</a>)'],
            ['<b>Weights &amp; Biases</b>', 'SaaS (también dedicado o self-managed); de CoreWeave desde mayo de 2025', 'W&amp;B Registry con aliases', 'Investigación con muchas corridas y un equipo que vive en la interfaz', 'Datos en un tercero; licencias por usuario'],
            ['<b>Comet</b>', 'SaaS o self-hosted de tracking; su producto de LLMs es Opik (Apache 2.0)', 'Sí', 'Si ya lo usan', 'Menos común en entrevistas'],
            ['<b>Neptune.ai</b>', 'Lo compró OpenAI (dic-2025) y el SaaS cerró el 6-mar-2026 sin forma de exportar después', '—', 'Ya no es una opción', 'La lección: exporta lo que llegó a producción'],
            ['<b>MLflow gestionado</b>', 'MLflow operado por SageMaker AI, Databricks o Azure ML (el workspace habla la API de MLflow)', 'El de MLflow', 'Ya estás en esa nube', 'Versión y features dependen del proveedor'],
            ['<b>Registry de la nube</b>', 'Model Registry de SageMaker AI o de Agent Platform (Vertex AI), registries de Azure ML', 'Grupos y versiones, aprobación', 'Despliegas con el endpoint de esa nube', 'Te ata a su forma de desplegar'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Stages en vez de aliases', html: `<p>"Lo paso a Production en el registry" describe el modelo de stages de MLflow, deprecado desde la 2.9. Hoy se dice: el pipeline registra la versión, el gate la aprueba y promover es mover el alias <code>@champion</code>, que el despliegue lee (<a href="#m10.model-registry">M10</a>). El rollback es mover el alias de vuelta.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Every run logs params, metrics, the dataset snapshot id, the git commit and the image digest to MLflow. Promotion is just moving the champion alias after the gate passes, and the deployment reads the alias, so a rollback is one alias move."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'monitoreo',
        title: 'Monitoreo: sistema y modelo',
        titleEn: 'Monitoring: system and model',
        priority: 'core',
        dims: ['monitoreo'],
        blocks: [
          { t: 'p', html: `Dos capas con herramientas distintas: la del sistema (¿responde, rápido, sin errores?) es estándar y madura; la del modelo (¿sigue acertando?) es más joven, y ahí la herramienta pesa menos que tu definición de qué medir (<a href="#m12.sistema">M12</a>, <a href="#m12.modelo">M12</a>).` },
          { t: 'table', caption: 'Sistema', head: ['Herramienta', 'Qué es', 'Para qué sí', 'Gestionado', 'Dónde'], rows: [
            ['<b>Prometheus</b>', 'Métricas por pull, PromQL, reglas de grabación y de alerta', 'El estándar en Kubernetes: latencia, errores, cola, GPU', 'Amazon Managed Service for Prometheus, Managed Service for Prometheus (GCP), Azure Monitor managed Prometheus', '<a href="#m12.prometheus-grafana">M12</a>'],
            ['<b>Grafana</b>', 'Dashboards sobre Prometheus, Loki y otros', 'Un dashboard por audiencia', 'Amazon Managed Grafana, Azure Managed Grafana, Grafana Cloud', '<a href="#m12.prometheus-grafana">M12</a>'],
            ['<b>Alertmanager</b>', 'Ruteo de alertas: agrupa, deduplica, silencia', 'Page vs ticket según severidad', 'El Prometheus gestionado de AWS lo incluye; en GCP y Azure las alertas pasan por su propio sistema (verifica)', '<a href="#m12.prometheus-grafana">M12</a>'],
            ['<b>DCGM exporter</b>', 'Métricas de GPU de NVIDIA para Prometheus', 'Utilización, memoria, temperatura, XID', 'Lo instala el GPU Operator', '<a href="#m12.sistema">M12</a>'],
            ['<b>OpenTelemetry</b>', 'Estándar y SDKs de trazas, métricas y logs; el Collector los rutea', 'Trazas de punta a punta (gateway → model server)', 'CloudWatch/X-Ray, Cloud Trace y Application Insights reciben datos de OpenTelemetry (por OTLP o con su exporter)', '<a href="#m12.sistema">M12</a>'],
            ['<b>Loki / ELK / OpenSearch</b>', 'Almacenes de logs', 'Buscar el request 4f2a… cuando algo falla', 'CloudWatch Logs, Cloud Logging, Log Analytics', '<a href="#m12.logging-predicciones">M12</a>'],
            ['<b>Datadog, New Relic…</b>', 'Observabilidad comercial todo en uno', 'Si la empresa ya paga uno: úsalo', 'Son SaaS', '—'],
          ] },
          { t: 'table', caption: 'Modelo (coincide con la tabla de M12)', head: ['Herramienta', 'Qué es', 'Ojo con'], rows: [
            ['<b>Evidently</b>', 'Librería open source (Apache 2.0) de drift y calidad; también plataforma', 'API nueva desde 0.7 (abril de 2025): los ejemplos viejos no corren tal cual'],
            ['<b>NannyML</b>', 'Drift y estimación de desempeño sin labels (CBPE, DLE), tabular', 'Supone calibración y ausencia de concept drift; último release en julio de 2025'],
            ['<b>whylogs</b>', 'Perfiles estadísticos mergeables, sin guardar datos crudos', 'Apple compró WhyLabs en 2025 y el SaaS cerró; el repo no tiene cambios desde enero de 2025'],
            ['<b>Alibi Detect</b>', 'Detectores de drift y outliers (Seldon)', 'Business Source License desde enero de 2024: en producción, licencia comercial'],
            ['<b>Arize, Fiddler</b>', 'Plataformas comerciales de observabilidad de ML y LLMs', 'Dynatrace anunció la compra de Arize en agosto de 2026 (pendiente al escribir esto); Phoenix, su proyecto open source, sigue. Precios y alcance: verifica'],
            ['<b>Monitores de la nube</b>', 'SageMaker Model Monitor, Vertex AI Model Monitoring, Azure ML model monitoring', 'Pensados sobre todo para tabular; para imágenes, estadísticas o un contenedor propios'],
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Para drift, la respuesta senior casi nunca es una plataforma: es "un job diario que calcula el PSI del histograma de color por escáner contra la referencia del modelo y lo publica como métrica en Prometheus, con alerta por tamaño de efecto". Así el drift vive en la misma tubería de alertas que la latencia (<a href="#m12.deteccion-drift">M12</a>, <a href="#c04.monitoreo">c04</a>).</p>` },
          { t: 'callout', kind: 'trap', title: 'Un dashboard no es monitoreo', html: `<p>"Lo monitoreo con Grafana" no dice nada: Grafana pinta. Lo que se evalúa es qué métrica, qué umbral, quién recibe la alerta y qué hace (el runbook). Nombra Prometheus y Grafana en media frase y gasta el resto en eso (<a href="#m12.runbooks">M12</a>).</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'vector-dbs',
        title: 'Vector DBs y búsqueda por similitud',
        titleEn: 'Vector databases and similarity search',
        priority: 'core',
        dims: ['arquitectura', 'estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Primero el número: cuánto pesan los vectores. Eso decide si alcanza una librería en memoria, un Postgres o un sistema distribuido. El diseño completo (embeddings, ANN, re-ranking, frescura) es <a href="#c07">c07</a>; aquí está el mapa de herramientas.` },
          { t: 'calc', title: 'Memoria de los vectores', rows: [
            { label: '1 M vectores de 768 dims, FP32', expr: '1,000,000 × 768 × 4 B', value: '≈ 3.1 GB' },
            { label: '10 M, FP32', expr: '× 10', value: '≈ 31 GB' },
            { label: '100 M, FP32', expr: '× 100', value: '≈ 307 GB (igual que en <a href="#ref-numeros.bytes-tamanos">números</a>)' },
            { label: '100 M en FP16 / INT8 / binario', expr: '× 2 B · × 1 B · ÷ 8 bits', value: '≈ 154 GB · ≈ 77 GB · ≈ 9.6 GB' },
            { label: 'Tabla + índice HNSW en pgvector', expr: '(vector + vector y vecinos en el índice) × n', value: E('≈ 2× los vectores crudos'), note: 'El índice guarda su propia copia de cada vector más ≈ 2·m vecinos (m = 16 por defecto): ≈ 1.1× los vectores solo el índice. Otros motores no duplican el vector. Mídelo con <code>pg_relation_size</code> o la métrica del motor' },
          ], result: 'Con 1–10 M vectores, todo cabe en la RAM de una instancia (a 10 M, tabla + índice ≈ 60 GB: una instancia con memoria de sobra): pgvector o una librería alcanzan. Con 100 M en FP32 ya no cabe holgado en un nodo: cuantizar, DiskANN o un sistema que reparte el índice entre nodos.' },
          { t: 'table', caption: 'Herramientas (estado a octubre de 2026)', head: ['Herramienta', 'Qué es', 'Índices', 'Filtrado por metadata', 'Cuándo'], rows: [
            ['<b>FAISS</b>', 'Librería de Meta (MIT), no un servicio', 'Flat, IVF, IVF-PQ, HNSW; GPU', 'Limitado: restringir por ids (IDSelector); la metadata la manejas tú', 'Batch offline, prototipo, o dentro de tu servicio si el índice es estático'],
            ['<b>hnswlib</b>', 'Librería de HNSW (C++ con bindings de Python)', 'HNSW', 'Función de filtro en la consulta', 'Igual que FAISS: tú pones persistencia, réplicas y updates'],
            ['<b>pgvector</b> (0.8.x)', 'Extensión de Postgres', 'HNSW, IVFFlat; <code>halfvec</code>, <code>bit</code>, <code>sparsevec</code>', 'SQL normal (<code>WHERE</code>); desde 0.8, iterative index scans para no quedarse corto con filtros', 'Ya tienes Postgres, cabe en un nodo y quieres joins y transacciones con tus datos'],
            ['<b>Qdrant</b>', 'Vector DB open source (Apache 2.0), Rust', 'HNSW filtrable + cuantización escalar, PQ, binaria', 'Payload indexes; créalos antes de cargar', 'Filtros pesados y un servicio dedicado chico o mediano'],
            ['<b>Milvus</b> (3.0)', 'Vector DB distribuida open source (Apache 2.0); Zilliz Cloud es la gestionada', 'HNSW, IVF_FLAT/SQ8/PQ, DiskANN, GPU_CAGRA', 'Índices escalares', 'Cientos de millones o más, índice que no cabe en un nodo'],
            ['<b>Weaviate</b>', 'Vector DB open source con búsqueda híbrida', 'hnsw, flat, dynamic (de flat a hnsw), hfresh', 'Sí', 'Multi-tenant (flat por tenant) y búsqueda híbrida integrada'],
            ['<b>OpenSearch / Elasticsearch</b>', 'Buscadores de texto con k-NN', 'OpenSearch: faiss (default desde 2.18), lucene; nmslib deprecado', 'Sí, con la potencia de un buscador', 'Ya tienes el buscador y quieres híbrido BM25 + vectores'],
            ['<b>Pinecone</b>', 'Solo gestionado (serverless): pagas almacenamiento y unidades de lectura y escritura', 'Propios', 'Metadata filters, namespaces por tenant', 'No quieres operar nada y el costo por consulta te conviene'],
          ], note: 'Elasticsearch agregó la AGPL como opción de licencia en agosto de 2024, junto a SSPL y ELv2; OpenSearch es Apache 2.0. Chroma y LanceDB aparecen en prototipos de RAG.' },
          { t: 'table', caption: 'Gestionados por nube', head: ['Nube', 'Opciones'], rows: [
            ['AWS', 'OpenSearch Service (k-NN) y OpenSearch Serverless; pgvector en Aurora o RDS; S3 Vectors (GA dic-2025: hasta 2 mil millones de vectores por índice, ≈ 100 ms en consultas frecuentes y menos de 1 s en las infrecuentes, según AWS)'],
            ['GCP', 'Vertex AI Vector Search (ScaNN, filtros por restricts); pgvector en Cloud SQL o AlloyDB (que además tiene índice ScaNN); búsqueda vectorial de BigQuery'],
            ['Azure', 'Azure AI Search (HNSW o KNN exhaustivo, filtros); pgvector en Azure Database for PostgreSQL; Cosmos DB también tiene búsqueda vectorial'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Embeddings de 3,072 dimensiones en pgvector', html: `<p>pgvector indexa el tipo <code>vector</code> hasta 2,000 dimensiones. Un modelo de embeddings de 3,072 dims entra en la tabla, pero el índice HNSW no se crea: usa <code>halfvec</code> (indexa hasta 4,000) o reduce dimensiones si el modelo lo permite. Es el tipo de detalle que separa a quien lo usó de quien lo leyó.</p>` },
          { t: 'callout', kind: 'why', title: 'Cuándo Postgres alcanza', html: `<p>Cuando el índice cabe en la RAM de una instancia, el QPS de búsqueda es moderado y necesitas filtrar o unir con datos de negocio (precio, stock, permisos) que ya viven en Postgres: una sola base, un solo backup, transacciones. No tengo un benchmark confiable de QPS que valga para tu caso: con tus vectores, tus filtros y tu recall objetivo, mide p99 y recall@k contra una búsqueda exacta antes de decidir. Una vector DB dedicada se gana su lugar cuando no cabe, cuando el filtrado mata el recall o cuando la carga de búsqueda molesta a la base transaccional.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"A hundred million 768-dimensional vectors are about 300 GB in FP32, so they won't fit comfortably on one node. I'd either quantize to INT8, about 77 GB, which fits on one large node, or shard the index with a distributed vector database like Milvus. At ten million I'd just use pgvector next to the product data."</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'stack-llm',
        title: 'Stack de LLMs (cambia rápido)',
        titleEn: 'The LLM stack (fast-moving)',
        priority: 'extra',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'callout', kind: 'note', title: 'Fecha de vencimiento', html: `<p>Esta es la sección que más rápido envejece: en un año cambiaron de dueño Langfuse, promptfoo y Neptune, TGI quedó archivado y Microsoft unificó sus frameworks de agentes. Usa las categorías, que duran; los nombres, verifícalos antes de la entrevista. El diseño de sistemas con LLMs es <a href="#m14">M14</a>.</p>` },
          { t: 'table', caption: 'Por categoría (octubre de 2026)', head: ['Categoría', 'Qué resuelve', 'Opciones', 'Default razonable', 'Ojo con'], rows: [
            ['Motor de serving', 'Continuous batching, KV cache paginado, API compatible con OpenAI', 'vLLM, SGLang, TensorRT-LLM; TGI archivado', 'vLLM', 'Elegir sin medir con tu tráfico (<a href="#m07.llm-servers">M7</a>)'],
            ['Serving multi-nodo', 'Separar prefill y decode, ruteo por KV cache', 'NVIDIA Dynamo, llm-d', 'Ninguno hasta que un nodo no alcance', 'Complejidad que solo paga a gran escala'],
            ['Local o en el dispositivo', 'Correr un modelo cuantizado en una laptop o un edge', 'llama.cpp, Ollama', 'llama.cpp en edge; Ollama para desarrollo', 'No son servidores de producción multiusuario'],
            ['API gestionada', 'Modelos sin operar GPUs', 'Amazon Bedrock, Model Garden de Agent Platform (Vertex AI), Microsoft Foundry, APIs de cada proveedor', 'La nube donde ya están tus datos', 'Residencia de datos, cuotas, costo por token'],
            ['Gateway de LLMs', 'Una API para varios proveedores: llaves, presupuestos, rate limits, fallbacks, logs de costo', 'LiteLLM, Envoy AI Gateway (v1 en 2026); gateways comerciales', 'LiteLLM al empezar; Envoy si ya usas Envoy', 'Fija versiones: LiteLLM 1.82.7 y 1.82.8 salieron comprometidas en PyPI el 24-mar-2026'],
            ['Framework de agentes', 'Loop de herramientas, estado, reintentos', 'LangGraph, OpenAI Agents SDK, Google ADK, Microsoft Agent Framework (1.0 en abril de 2026, sucesor de AutoGen y Semantic Kernel), LlamaIndex, Pydantic AI', 'El más simple que resuelva el loop; a veces 100 líneas propias', 'Atarse a una abstracción que cambia cada trimestre'],
            ['Protocolos', 'Conectar herramientas y agentes', 'MCP (herramientas), A2A (agente a agente)', 'MCP para exponer herramientas', 'Cada servidor MCP es superficie de ataque (<a href="#m15">M15</a>)'],
            ['Evaluación', 'Datasets, métricas, LLM-as-judge, regresiones en CI', 'Ragas, DeepEval, promptfoo (de OpenAI desde mar-2026, sigue MIT), MLflow GenAI', 'Un golden set propio + una de estas para correrlo en CI', 'Juez sin calibrar contra humanos'],
            ['Trazas y observabilidad', 'Ver cada prompt, tool call, tokens y costo', 'Langfuse (de ClickHouse desde ene-2026), LangSmith, Arize Phoenix, Opik', 'Langfuse si quieres self-hosted', 'Loguear PII sin redacción'],
            ['Guardrails', 'Filtrar entradas y salidas: PII, jailbreaks, temas prohibidos', 'NeMo Guardrails, Llama Guard, Guardrails AI; gestionados: Bedrock Guardrails, Azure AI Content Safety, Model Armor (GCP)', 'El gestionado de tu nube + reglas propias', 'Creer que un clasificador resuelve el prompt injection'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>No compares frameworks de agentes en una ronda de diseño: nadie te va a pedir LangGraph contra ADK. Lo que se evalúa es el loop (qué herramientas, cuántos pasos, timeouts, qué pasa si una falla), la evaluación y el costo por tarea. El nombre del framework, en media frase.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For serving I'd start with vLLM behind an OpenAI-compatible API, with a gateway in front for keys, budgets and fallbacks. I'd pick the agent framework last; what matters is a golden set of tasks we run in CI and traces of every tool call in production."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'equivalencias-nube',
        title: 'Equivalencias AWS | GCP | Azure',
        titleEn: 'AWS | GCP | Azure equivalents',
        priority: 'extra',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Para traducir un diseño cuando la empresa usa otra nube. Las filas compartidas usan los mismos nombres que la tabla de <a href="#m13.equivalencias">M13</a>, que explica además qué cambia de verdad entre nubes (cuotas de GPU, precios, regiones). Equivalente no es idéntico: el modelo de precios, los límites y a veces la semántica cambian (Pub/Sub no es Kafka).` },
          { t: 'table', caption: 'Equivalencias de los servicios que usan los casos (octubre de 2026)', head: ['Categoría', 'AWS', 'Google Cloud', 'Azure'], rows: [
            ['Kubernetes gestionado', 'Amazon EKS', 'GKE', 'AKS'],
            ['Autoscaling de nodos', 'Karpenter o Cluster Autoscaler', 'Cluster autoscaler de GKE (con node auto-provisioning)', 'Cluster autoscaler o node auto-provisioning de AKS (basado en Karpenter)'],
            ['Contenedores serverless', 'AWS Fargate (con ECS o EKS; sin GPU); ECS Express Mode', 'Cloud Run (con GPU)', 'Azure Container Apps (con GPU)'],
            ['Plataforma de ML', 'Amazon SageMaker AI', 'Gemini Enterprise Agent Platform (ex Vertex AI)', 'Azure Machine Learning'],
            ['Endpoints de modelos', 'SageMaker AI: real-time, asynchronous, serverless, batch transform', 'Agent Platform: online inference endpoints, batch inference', 'Azure ML: managed online endpoints, batch endpoints'],
            ['Pipelines de ML', 'SageMaker Pipelines', 'Agent Platform Pipelines (KFP)', 'Azure ML pipelines'],
            ['Model registry', 'Model Registry de SageMaker AI', 'Model Registry de Agent Platform', 'Registries y workspaces de Azure ML (API de MLflow)'],
            ['MLflow gestionado', 'MLflow en SageMaker AI', '— (Agent Platform tiene su propio tracking de experimentos)', 'Workspace de Azure ML (API de MLflow)'],
            ['Feature store', 'SageMaker Feature Store', 'Agent Platform Feature Store', 'Managed feature store de Azure ML'],
            ['LLMs por API', 'Amazon Bedrock', 'Model Garden de Agent Platform', 'Microsoft Foundry (antes Azure AI Foundry)'],
            ['Object storage', 'Amazon S3', 'Cloud Storage', 'Azure Blob Storage'],
            ['Cola de mensajes', 'Amazon SQS', 'Pub/Sub (Cloud Tasks para tareas HTTP)', 'Azure Service Bus · Queue Storage'],
            ['Streaming de eventos', 'Kinesis Data Streams · Amazon MSK (Kafka)', 'Pub/Sub · Managed Service for Apache Kafka', 'Azure Event Hubs (habla el protocolo de Kafka)'],
            ['Orquestación de workflows', 'AWS Step Functions', 'Workflows', 'Logic Apps · Durable Functions'],
            ['Airflow gestionado', 'Amazon MWAA', 'Cloud Composer', 'Apache Airflow job en Microsoft Fabric'],
            ['Spark gestionado', 'Amazon EMR · AWS Glue', 'Dataproc', 'Azure Databricks · Microsoft Fabric'],
            ['Data warehouse', 'Amazon Redshift', 'BigQuery', 'Microsoft Fabric (Warehouse) · Azure Synapse Analytics'],
            ['Container registry', 'Amazon ECR', 'Artifact Registry', 'Azure Container Registry'],
            ['Monitoreo y logs', 'Amazon CloudWatch · Managed Service for Prometheus', 'Cloud Monitoring · Cloud Logging · Managed Service for Prometheus', 'Azure Monitor (Log Analytics, Application Insights, Prometheus gestionado)'],
            ['Secretos y llaves', 'Secrets Manager · AWS KMS', 'Secret Manager · Cloud KMS', 'Azure Key Vault'],
            ['Documentos (OCR)', 'Amazon Textract', 'Document AI', 'Azure AI Document Intelligence'],
            ['Búsqueda vectorial', 'OpenSearch Service · S3 Vectors · pgvector en Aurora o RDS', 'Vertex AI Vector Search (hoy en Agent Platform) · AlloyDB', 'Azure AI Search'],
          ], note: 'Renombres recientes (detalle en <a href="#m13.equivalencias">M13</a>): SageMaker → SageMaker AI (3-dic-2024); Vertex AI → Gemini Enterprise Agent Platform (abril de 2026); Azure AI Foundry → Microsoft Foundry (vigente desde enero de 2026); App Runner cerró a clientes nuevos (30-abr-2026). En la entrevista, los nombres de siempre se entienden.' },
          { t: 'callout', kind: 'skip', html: `<p>Si la empresa usa una nube que no conoces, no finjas: di "en AWS esto es SQS; aquí usaría la cola gestionada equivalente" y sigue. El entrevistador evalúa el patrón, no el catálogo. Memoriza solo la columna de la nube que usa la empresa a la que aplicas.</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        title: 'Cómo nombrar herramientas en la entrevista',
        titleEn: 'How to name tools in the interview',
        priority: 'core',
        dims: ['comunicacion', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `La regla: <b>categoría + default + porqué + alternativa con su condición</b>, en una o dos frases. "Necesito un log que varios consumidores relean (categoría), uso Kafka (default) porque el deep scorer, enforcement y las métricas leen el mismo evento, cada uno a su ritmo (porqué); si fuera un solo consumidor, una cola como SQS bastaba (alternativa)".` },
          { t: 'table', caption: 'Cuándo una herramienta suma y cuándo es ruido', head: ['Suma', 'Es ruido'], rows: [
            ['Responde a un requisito que ya dijiste ("dynamic batching para que una T4 cubra los 500 req/s; la segunda es N+1")', 'Aparece antes del problema ("usaría Kafka, Spark y Feast")'],
            ['Viene con lo que cuesta operarla ("Kubeflow es un sistema más que mantener")', 'Viene sola, como si fuera gratis'],
            ['Dices cuándo cambiarías de opinión', 'No hay alternativa: parece la única que conoces'],
            ['Un nombre por caja del diagrama', 'Tres nombres por caja "por si acaso"'],
            ['Admites lo que no conoces y das la categoría', 'Inventas una feature de un producto'],
          ] },
          { t: 'followups', items: [
            { q: '¿Qué usarías para orquestar esto?',
              junior: 'Kubernetes con Kubeflow y Airflow, que son el estándar de MLOps.',
              senior: 'Depende de qué orquesto. El servicio corre en el EKS que la empresa ya opera. El reentrenamiento mensual es un DAG de cuatro pasos en el Airflow que ya existe, con un gate escrito en código. No montaría Kubeflow para un modelo: sería un sistema más con upgrades y permisos para un job al mes.',
              why: 'Separa los sentidos de "orquestar", reutiliza lo que existe y descarta con un motivo.' },
            { q: '¿Por qué Triton y no TorchServe?',
              junior: 'Triton es más rápido.',
              senior: 'TorchServe está archivado desde agosto de 2025: no recibe parches de seguridad, así que no lo elegiría para nada nuevo. Entre lo vigente, Triton me da dynamic batching en C++, varias instancias por GPU y métricas de cola separadas del cómputo, que es lo que necesito a 500 req/s.',
              why: 'Sabe el estado del proyecto y conecta la elección con el requisito, no con una velocidad sin contexto.' },
            { q: '¿Qué vector DB usarías?',
              junior: 'Pinecone, porque es la más popular.',
              senior: 'Primero el tamaño: 10 M vectores de 768 dims son ≈ 31 GB en FP32. Caben en un nodo, y el catálogo con precio y stock ya vive en Postgres, así que empiezo con pgvector y HNSW para filtrar con SQL. Si crecemos a cientos de millones o el filtrado tira el recall, paso a una vector DB dedicada: Qdrant o Milvus self-hosted, o un gestionado.',
              why: 'El número decide la categoría; la herramienta sale de lo que ya existe, con el umbral para cambiar.' },
          ] },
          { t: 'callout', kind: 'interview', title: 'Frases listas', html: `<ul>
            <li>"I'll name tools as we go, but the requirement drives each one: here the requirement is dynamic batching on a GPU, so Triton."</li>
            <li>"I'd use whatever orchestrator the company already runs; what I need from it is per-step retries, backfills and a gate."</li>
            <li>"A queue is enough here: each job is processed once, with retries and a dead-letter queue. I'd only reach for Kafka if several consumers needed to replay the same events."</li>
            <li>"TorchServe is archived, so I wouldn't start anything new on it."</li>
            <li>"ONNX Runtime runs inside my service on CPU; it isn't a server, so batching and metrics are on me."</li>
            <li>"I don't need a feature store: the only input is the image, and a shared preprocessing package keeps training and serving consistent."</li>
            <li>"Promotion is moving the champion alias in MLflow; the rollout controller picks it up and runs the canary."</li>
            <li>"Drift is a daily job that publishes a PSI per scanner to Prometheus, so it goes through the same alerting as latency."</li>
            <li>"Ten million vectors fit on one node, so pgvector next to the product data is enough for now."</li>
            <li>"I haven't used that service myself; on AWS the equivalent is Step Functions, and the pattern is the same."</li>
          </ul>` },
          { t: 'callout', kind: 'trap', title: 'La lista de diez herramientas', html: `<p>"Kafka para ingestar, Spark para procesar, Feast para features, MLflow para tracking, Kubeflow para pipelines, KServe para servir, Evidently para drift…" en el minuto 5 es lo que un entrevistador anota como name-dropping: no hay requisito que justifique ninguna, y cada nombre te abre una pregunta de seguimiento que no preparaste. Dibuja las cajas con su función y nombra la herramienta de cada una cuando defiendas esa caja.</p>` },
          { t: 'checklist', id: 'herramientas-minimo', items: [
            { id: 'formula', html: 'Nombro cada herramienta con categoría, default, porqué y alternativa con su condición.' },
            { id: 'capas', html: 'Distingo compilador, runtime, model server y plataforma (TensorRT, ONNX Runtime, Triton, KServe).' },
            { id: 'orquestar', html: 'Separo los cuatro sentidos de "orquestar": contenedores, DAGs, workflows por ítem y rollouts.' },
            { id: 'cola-log', html: 'Explico cuándo una cola (SQS) basta y cuándo hace falta un log (Kafka).' },
            { id: 'estado', html: 'Sé que TorchServe y TGI están archivados y que MLflow usa aliases, no stages.' },
            { id: 'vector', html: 'Calculo el tamaño de los vectores antes de elegir entre pgvector y una vector DB.' },
            { id: 'nube', html: 'Traduzco un diseño de AWS a GCP o Azure con la tabla de equivalencias de mi nube objetivo.' },
          ] },
          { t: 'quiz', items: [
            { q: 'Un worker procesa cada slide una vez, con reintentos, y debe escalar a cero de noche. ¿Qué pieza de transporte eliges?', options: ['Kafka', 'Una cola como SQS, con KEDA', 'Un DAG de Airflow por slide', 'Flink'], answer: 1,
              explain: 'Un consumidor por mensaje, reintentos, DLQ y escala por profundidad: es una cola (c04). Kafka sirve cuando varios consumidores releen los eventos; Airflow no está hecho para una ejecución por ítem.' },
            { q: '¿Cuál de estas frases mezcla capas?', options: ['"Compilo a TensorRT y lo sirvo con Triton"', '"Corro ONNX Runtime dentro de mi servicio en CPU"', '"Lo sirvo con ONNX"', '"KServe crea los pods de Triton"'], answer: 2,
              explain: 'ONNX es un formato: no recibe requests ni arma batches. Las otras tres ubican bien compilador, runtime, servidor y plataforma.' },
            { q: 'Tu índice tendrá 3,072 dimensiones en pgvector. ¿Qué pasa?', options: ['Nada, el límite es 16,000', 'El tipo vector no se puede indexar con HNSW por encima de 2,000 dims: usa halfvec', 'pgvector no admite más de 1,024 dims', 'Hay que usar IVFFlat'], answer: 1,
              explain: 'pgvector indexa vector hasta 2,000 dims y halfvec hasta 4,000. La tabla acepta 3,072, pero el índice no se crea con vector.' },
            { q: 'Te piden un servidor para un LLM nuevo y alguien propone TGI. ¿Qué respondes?', options: ['Es el estándar de Hugging Face: bien', 'TGI está en modo mantenimiento desde dic-2025 y archivado: vLLM o SGLang', 'Mejor TorchServe', 'Triton con un Python backend que llama a generate()'], answer: 1,
              explain: 'Para algo nuevo, un motor activo: vLLM por defecto, SGLang si hay prefijos compartidos. TorchServe también está archivado, y un Python backend con generate() pierde el continuous batching.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'ref-herramientas-01', kind: 'concepto', q: '¿Cuál es la fórmula para nombrar una herramienta en una ronda de diseño?',
        a: 'Categoría + default + porqué + alternativa con su condición, en una o dos frases. Ej.: "necesito un log que varios consumidores relean; Kafka, porque tres servicios leen el mismo evento; con uno solo, SQS bastaba".' },
      { id: 'ref-herramientas-02', kind: 'concepto', q: 'Compilador, runtime, model server y plataforma de serving: ¿qué hace cada uno y un ejemplo?',
        a: 'Compilador: optimiza para un hardware (TensorRT, OpenVINO). Runtime: ejecuta el modelo en un proceso (ONNX Runtime). Model server: red, cola, batching, versiones, métricas (Triton, vLLM). Plataforma: crea y escala servidores (KServe, endpoints gestionados).' },
      { id: 'ref-herramientas-03', kind: 'trampa', q: '¿Qué estado tienen TorchServe y TGI en 2026?',
        a: 'TorchServe: repo archivado el 7-ago-2025, sin parches (último release 0.12.0). TGI: modo mantenimiento desde dic-2025 y repo archivado. Ninguno para sistemas nuevos: Triton o un endpoint para CNNs; vLLM o SGLang para LLMs.' },
      { id: 'ref-herramientas-04', kind: 'concepto', q: 'Los cuatro sentidos de "orquestar" y su herramienta típica.',
        a: 'Contenedores de larga vida: Kubernetes. DAGs batch por fecha: Airflow (o Dagster, Argo Workflows, Kubeflow). Un flujo por ítem con espera humana: Step Functions o Temporal. Rollouts: Argo Rollouts o Flagger.' },
      { id: 'ref-herramientas-05', kind: 'tradeoff', q: '¿Cuándo SQS y cuándo Kafka?',
        a: 'SQS: cada mensaje lo procesa un consumidor una vez, con reintentos y DLQ, y escalas workers por profundidad (c04). Kafka: varios consumer groups leen el mismo evento a su ritmo, con replay y orden por clave (c06).' },
      { id: 'ref-herramientas-06', kind: 'trampa', q: '¿Por qué no Airflow para procesar cada documento que llega?',
        a: 'Airflow piensa en DAGs por fecha; no está hecho para miles de ejecuciones chicas por minuto ni para esperar días a una persona. Eso es un workflow engine: Step Functions con <code>waitForTaskToken</code> (c05) o Temporal.' },
      { id: 'ref-herramientas-07', kind: 'trampa', q: 'Dices "lo paso a Production en el registry de MLflow". ¿Qué está mal?',
        a: 'Los stages están deprecados desde MLflow 2.9. Hoy se mueve un alias (<code>@champion</code>) que el despliegue lee; el rollback es mover el alias de vuelta.' },
      { id: 'ref-herramientas-08', kind: 'numero', q: '¿Cuánto pesan 10 M y 100 M embeddings de 768 dims, y qué decide eso?',
        a: '10 M ≈ 31 GB y 100 M ≈ 307 GB en FP32 (≈ 77 GB en INT8), más el índice. 10 M caben en un nodo: pgvector o una librería. 100 M en FP32 piden cuantizar, DiskANN o una vector DB distribuida (Milvus).' },
      { id: 'ref-herramientas-09', kind: 'trampa', q: 'Embeddings de 3,072 dims en pgvector: ¿cuál es el problema?',
        a: 'El tipo <code>vector</code> se indexa hasta 2,000 dims; <code>halfvec</code>, hasta 4,000. Con 3,072, usa halfvec (o reduce dimensiones) o el índice HNSW no se crea.' },
      { id: 'ref-herramientas-10', kind: 'concepto', q: '¿Cuándo alcanza pgvector y cuándo hace falta una vector DB dedicada?',
        a: 'pgvector: el índice cabe en la RAM de una instancia, QPS moderado y filtros o joins con datos que ya están en Postgres. Dedicada: no cabe, el filtrado tira el recall o la búsqueda molesta a la base transaccional. Decide midiendo p99 y recall@k.' },
      { id: 'ref-herramientas-11', kind: 'numero', q: 'SQS, Step Functions, Kinesis/MSK, SageMaker AI y Bedrock: ¿cómo se llaman en GCP y Azure?',
        a: 'Pub/Sub · Service Bus. Workflows · Logic Apps o Durable Functions. Pub/Sub o Managed Service for Apache Kafka · Event Hubs. Gemini Enterprise Agent Platform (ex Vertex AI) · Azure Machine Learning. Model Garden de Agent Platform · Microsoft Foundry.' },
      { id: 'ref-herramientas-12', kind: 'concepto', q: '¿Qué herramientas son la respuesta segura para monitoreo de sistema y cuál para drift?',
        a: 'Sistema: Prometheus + Grafana + Alertmanager, DCGM exporter para GPU y OpenTelemetry para trazas (o el monitoreo de tu nube). Drift: un job propio que publica PSI o distancias como métricas en Prometheus; Evidently como librería si ayuda.' },
      { id: 'ref-herramientas-13', kind: 'frase', q: '¿Cómo dices en inglés que no conoces el servicio de la nube del entrevistador?',
        a: '"I haven\'t used that service myself; on AWS the equivalent is Step Functions, and the pattern is the same: one execution per document, retries per step and a wait for the human review."' },
      { id: 'ref-herramientas-14', kind: 'frase', q: '¿Cómo justificas en inglés no usar un feature store en un caso de visión?',
        a: '"I don\'t need a feature store: the only input is the image, and a shared preprocessing package plus a parity test keeps training and serving consistent."' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'inference runtime', es: 'runtime de inferencia', def: 'Librería que ejecuta un modelo dentro de un proceso (ONNX Runtime, TensorRT runtime, PyTorch). No recibe requests ni arma batches: eso lo hace el model server o tu servicio.', say: 'ONNX Runtime is the inference runtime inside our CPU service; it isn\'t a server.' },
      { en: 'vector database', es: 'base de datos vectorial', def: 'Servicio que guarda embeddings con su metadata y responde búsquedas por similitud con un índice ANN, filtros, réplicas y updates. Una librería como FAISS da el índice, pero no el servicio.', say: 'We only need a dedicated vector database once the index stops fitting on one node.' },
      { en: 'approximate nearest neighbor (ANN) search', es: 'búsqueda aproximada de vecinos más cercanos', def: 'Búsqueda por similitud que cambia un poco de recall por mucha velocidad usando un índice (HNSW, IVF, DiskANN). Se valida midiendo recall@k contra la búsqueda exacta.', say: 'We tune the ANN index for a recall target, say 95 percent at k equals 10, and check it against exact search.' },
      { en: 'HNSW', es: 'HNSW (grafo jerárquico de mundo pequeño navegable)', def: 'Índice ANN basado en un grafo por capas: rápido y con buen recall, pero vive en memoria y pesa más que los vectores solos. Lo tienen pgvector, Qdrant, Milvus, Weaviate y OpenSearch.', say: 'HNSW keeps the graph in memory, so I size the nodes for vectors plus neighbor lists.' },
      { en: 'LLM gateway', es: 'gateway de LLMs', def: 'Proxy delante de uno o varios proveedores de LLMs que unifica la API y centraliza llaves, presupuestos, rate limits, fallbacks y logs de costo (LiteLLM, Envoy AI Gateway).', say: 'All model calls go through an LLM gateway, so budgets and fallbacks live in one place.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
