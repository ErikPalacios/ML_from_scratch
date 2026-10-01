/* =============================================================================
   Ronda de Diseño ML — js/content/catalog.js
   Catálogo completo: los 15 módulos, los 13 casos (listos o no) y las páginas especiales,
   más la hoja de ruta por fases. Solo metadatos: el contenido de cada módulo/caso vive en
   su propio archivo (js/content/<id>-*.js) y se registra con MSD.register.
   Contrato: docs/SPEC.md §5.1–§5.2. Sin DOM (se carga también en Node).
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // freq = qué tan seguido aparece el tema en entrevistas de ML System Design para MLE
  // (estimación honesta, no un dato medido). minutes = tiempo de lectura estimado.

  // ------------------------------------------------------------------ Parte 1 — módulos
  const modules = [
    {
      id: 'm01', num: 1,
      title: 'El mapa: ciclo de vida de ML en producción y cómo se evalúa una entrevista',
      titleEn: 'The map: the production ML lifecycle and how the interview is scored',
      short: 'El mapa y la entrevista',
      summary: 'Qué le pasa a un modelo después del notebook y qué anota el entrevistador minuto a minuto. Sales con el framework de 7 pasos que vas a usar en cada caso de este curso.',
      topics: [
        'Ciclo de vida de ML en producción: datos → entrenamiento → despliegue → monitoreo → reentrenamiento',
        'Del notebook al servicio: qué cambia (latencia, fallas, versiones, costo, dueños)',
        'Camino online vs camino offline: la separación que ordena cualquier diagrama',
        'Qué evalúa una entrevista de ML System Design y en qué difiere de un system design clásico',
        'Señales junior vs senior que anota el entrevistador',
        'Framework de 7 pasos para 45 minutos, con tiempos por paso',
        'Cómo abrir la respuesta, fijar supuestos y chequear con el entrevistador',
        'Deuda técnica oculta en sistemas de ML (Sculley et al., NeurIPS 2015)',
      ],
      freq: 'alta', minutes: 65,
      connects: ['m02', 'm03', 'm09', 'm11', 'm12', 'c01'],
    },
    {
      id: 'm02', num: 2,
      title: 'Patrones de inferencia',
      titleEn: 'Inference patterns',
      short: 'Patrones de inferencia',
      summary: 'Online, asíncrono, batch, streaming o edge: es la primera decisión de arquitectura y la que más mueve latencia y costo. El entrevistador espera que la derives de los requisitos, no de la costumbre.',
      topics: [
        'Inferencia online síncrona (request/response) y su presupuesto de latencia',
        'Asíncrona con colas (SQS, Pub/Sub, Kafka): callbacks, polling y backpressure',
        'Batch inference programada y precomputar predicciones',
        'Streaming: eventos, ventanas de tiempo y features frescas',
        'Edge / on-device: cuándo el modelo debe ir al dispositivo',
        'Híbridos: precomputar + online, cascadas de modelos baratos y caros',
        'Tabla de decisión: latencia requerida, frescura, volumen y costo',
        'Idempotencia, reintentos y dead-letter queues',
      ],
      freq: 'alta', minutes: 65,
      connects: ['m01', 'm03', 'm06', 'm09', 'c02', 'c04', 'c09'],
    },
    {
      id: 'm03', num: 3,
      title: 'Latencia, throughput y capacidad',
      titleEn: 'Latency, throughput and capacity planning',
      short: 'Latencia y capacidad',
      summary: 'p99 en vez de promedio, Little\'s law y cuántas GPUs necesitas para el pico: aquí es donde más candidatos pierden puntos. Aprendes a hacer la cuenta en voz alta y a usarla para decidir.',
      topics: [
        'p50, p95, p99: por qué el promedio miente y qué es la tail latency',
        'Presupuesto de latencia end-to-end repartido por componente',
        'QPS promedio vs pico: factor diurno, spikes y margen',
        'Little\'s law: concurrencia = throughput × latencia',
        'Dynamic batching: throughput a cambio de latencia de cola',
        'Cuántas GPUs necesito: capacidad medida, headroom y N+1',
        'Utilización y colas: por qué no se planea al 100 %',
        'Load testing: perf_analyzer, Locust, k6',
      ],
      freq: 'alta', minutes: 55,
      connects: ['m02', 'm04', 'm06', 'm07', 'c01', 'c02', 'c10'],
    },
    {
      id: 'm04', num: 4,
      title: 'Hardware para inferencia',
      titleEn: 'Inference hardware',
      short: 'Hardware para inferencia',
      summary: 'La elección de hardware fija tu latencia y tu factura. Aprendes a calcular la VRAM y a justificar por qué una T4 y no una H100, o por qué un Jetson y no la nube.',
      topics: [
        'CPU vs GPU vs TPU vs aceleradores edge (Jetson, Coral)',
        'Cálculo de VRAM: pesos + activaciones + KV cache',
        'Bytes por dtype: FP32, FP16/BF16, FP8, INT8, INT4',
        'T4, L4, A10G, A100, H100: cuándo usar cada una',
        'Compute-bound vs memory-bound: la intuición del roofline',
        'Jetson Orin: memoria compartida, modos de energía y JetPack',
        'Compartir una GPU entre modelos: MIG, time-slicing, múltiples instancias',
        'Instancias GPU en la nube y costo por hora (órdenes de magnitud)',
      ],
      freq: 'media', minutes: 45,
      connects: ['m03', 'm08', 'm13', 'm14', 'c01', 'c03', 'c10'],
    },
    {
      id: 'm05', num: 5,
      title: 'Contenedores',
      titleEn: 'Containers',
      short: 'Contenedores',
      summary: 'Docker es la forma en que tu modelo viaja a producción. Rara vez te piden un Dockerfile en la entrevista, pero sí entender por qué una imagen CUDA pesa varios GB y cómo eso alarga los cold starts.',
      topics: [
        'Imagen, contenedor y capas: lo mínimo que debes saber',
        'Dockerfile multi-stage para un servicio de ML',
        'Imágenes base CUDA (runtime vs devel) y contenedores de NGC',
        'NVIDIA Container Toolkit: GPUs dentro del contenedor',
        'Reducir tamaño: dependencias, orden de capas, .dockerignore',
        'Pesos del modelo: dentro de la imagen vs descargados al arrancar',
        'Registries (ECR, Artifact Registry, ACR) y tags inmutables',
        'docker compose para desarrollo local',
      ],
      freq: 'baja', minutes: 50,
      connects: ['m06', 'm07', 'm10', 'c01'],
    },
    {
      id: 'm06', num: 6,
      title: 'Orquestación y escalado',
      titleEn: 'Orchestration and autoscaling',
      short: 'Orquestación y escalado',
      summary: 'Kubernetes, autoscaling y serverless deciden si aguantas el pico sin pagar GPUs ociosas de madrugada. La señal que buscan: saber por qué escalar por CPU no sirve para un servicio de GPU.',
      topics: [
        'Kubernetes para ML: Deployment, Service, probes, requests/limits',
        'GPUs en Kubernetes: device plugin, node pools, taints y tolerations',
        'HPA por CPU vs métricas custom (QPS, longitud de cola, uso de GPU)',
        'KEDA: escalar por eventos y hasta cero',
        'Cold starts: tamaño de imagen, carga de pesos y warm-up',
        'Serverless (Lambda, Cloud Run, endpoints serverless) y sus límites con GPU',
        'Aprovisionar nodos GPU: Cluster Autoscaler y Karpenter',
        'Alta disponibilidad: multi-AZ, PodDisruptionBudgets, N+1',
      ],
      freq: 'media', minutes: 55,
      connects: ['m03', 'm05', 'm07', 'm13', 'c01', 'c10', 'c13'],
    },
    {
      id: 'm07', num: 7,
      title: 'Servidores de modelos',
      titleEn: 'Model servers',
      short: 'Servidores de modelos',
      summary: 'FastAPI, TorchServe, Triton, BentoML, Ray Serve, vLLM y TGI resuelven problemas distintos. Sales con una tabla de cuándo elegir cada uno y el porqué en una frase.',
      topics: [
        'FastAPI + PyTorch: cuándo basta y dónde se rompe',
        'NVIDIA Triton: dynamic batching, ensembles, múltiples backends',
        'TorchServe: qué ofrece y su estado de mantenimiento actual',
        'BentoML: empaquetado y experiencia de desarrollo',
        'Ray Serve: composición de modelos y pipelines en Python',
        'vLLM, SGLang y TGI para LLMs: continuous batching y PagedAttention (TGI pasó a modo mantenimiento: por qué hoy se prefieren vLLM o SGLang)',
        'Protocolos: REST vs gRPC, KServe v2',
        'Separar preprocesamiento (CPU) de inferencia (GPU)',
        'Tabla de decisión: cuándo elegir cada servidor',
      ],
      freq: 'alta', minutes: 50,
      connects: ['m03', 'm06', 'm08', 'm14', 'c01', 'c10'],
    },
    {
      id: 'm08', num: 8,
      title: 'Optimización de modelos para inferencia',
      titleEn: 'Model optimization for inference',
      short: 'Optimización de modelos',
      summary: 'Antes de comprar más GPUs, abarata el modelo: ONNX, TensorRT, cuantización, destilación. Lo que cuenta en la entrevista es cuánto gana cada técnica, qué cuesta en calidad y cómo lo validas.',
      topics: [
        'Export a ONNX y paridad numérica con PyTorch',
        'TensorRT: engines, FP16/INT8 y por qué no son portables entre GPUs',
        'Cuantización: post-training vs quantization-aware training, calibración',
        'Pruning estructurado vs no estructurado (por qué el no estructurado rara vez acelera en GPU)',
        'Destilación: un modelo estudiante para serving',
        'torch.compile: cuándo ayuda en serving',
        'ONNX Runtime y OpenVINO para inferencia en CPU',
        'Validar la optimización: calidad por slices y latencia medida',
      ],
      freq: 'media', minutes: 60,
      connects: ['m04', 'm07', 'c01', 'c02', 'c03', 'c10'],
    },
    {
      id: 'm09', num: 9,
      title: 'Datos y features',
      titleEn: 'Data and features',
      short: 'Datos y features',
      summary: 'La mayoría de los incidentes de ML en producción son de datos, no de modelo. Pipelines, feature store, training-serving skew y etiquetado separan a quien entrenó un modelo de quien lo operó.',
      topics: [
        'Pipelines batch y streaming (Airflow, Spark, Kafka, Flink)',
        'Feature store: offline store, online store y point-in-time correctness',
        'Training-serving skew: causas típicas y cómo evitarlo',
        'Data leakage en features temporales',
        'Versionado de datos: DVC, lakeFS, snapshots inmutables',
        'Etiquetado: guías, calidad, acuerdo entre anotadores y costo',
        'Active learning y human in the loop',
        'Validación de datos: schemas y expectativas antes de entrenar',
      ],
      freq: 'alta', minutes: 50,
      connects: ['m02', 'm10', 'm12', 'c01', 'c02', 'c03', 'c04', 'c08', 'c09'],
    },
    {
      id: 'm10', num: 10,
      title: 'MLOps',
      titleEn: 'MLOps',
      short: 'MLOps',
      summary: 'Experiment tracking, model registry, CI/CD y reproducibilidad: lo que permite reentrenar y desplegar sin miedo. En la entrevista llega como “¿cómo llega un modelo nuevo a producción?”.',
      topics: [
        'Experiment tracking: MLflow, Weights & Biases',
        'Model registry: versiones, aliases (champion/challenger) y lineage',
        'Reproducibilidad: código + datos + config + entorno + seeds',
        'CI/CD para modelos: tests de datos, de modelo y de servicio',
        'Validation gate: cuándo un modelo nuevo puede reemplazar al actual',
        'Pipelines de entrenamiento orquestados (Kubeflow, SageMaker Pipelines, Vertex AI Pipelines)',
        'Reentrenamiento programado vs disparado por métricas',
        'Niveles de madurez de MLOps: qué es razonable para cada equipo',
      ],
      freq: 'media', minutes: 45,
      connects: ['m05', 'm09', 'm11', 'm12', 'c01', 'c02', 'c03', 'c04'],
    },
    {
      id: 'm11', num: 11,
      title: 'Despliegue seguro',
      titleEn: 'Safe deployment',
      short: 'Despliegue seguro',
      summary: 'Un modelo con mejor accuracy offline puede empeorar el negocio. Shadow, canary y A/B testing son cómo lo pruebas con tráfico real sin arriesgar a todos tus usuarios, y el rollback es tu plan B obligatorio.',
      topics: [
        'Shadow deployment: comparar sin afectar a los usuarios',
        'Canary: porcentaje de tráfico y criterios para avanzar',
        'Blue/green y rollback instantáneo',
        'A/B testing: métrica primaria, guardrails y tamaño de muestra',
        'Interleaving y bandits: cuándo valen la pena',
        'Feature flags y compatibilidad entre versiones de API y de modelo',
        'Criterios automáticos de rollback',
        'Offline–online gap: por qué las métricas no coinciden',
      ],
      freq: 'alta', minutes: 55,
      connects: ['m10', 'm12', 'c01', 'c02', 'c03', 'c08'],
    },
    {
      id: 'm12', num: 12,
      title: 'Monitoreo',
      titleEn: 'Monitoring',
      short: 'Monitoreo',
      summary: 'Un modelo falla en silencio: el servicio responde 200 mientras las predicciones empeoran. Separar métricas de sistema y de modelo, detectar drift y decidir cuándo reentrenar aparece en casi todas las entrevistas.',
      topics: [
        'Métricas de sistema: latencia, errores, saturación, uso de GPU',
        'Métricas de modelo: distribución de predicciones, confianza, métricas con labels retrasados',
        'Data drift vs concept drift vs label shift',
        'Detección de drift: PSI, test KS, distancias entre embeddings',
        'Prometheus + Grafana: métricas, alertas y SLOs',
        'Logging de predicciones para monitoreo y etiquetado',
        'Cuándo reentrenar: calendario vs disparadores',
        'Dashboards y runbooks: qué hace quien recibe la alerta',
      ],
      freq: 'alta', minutes: 58,
      connects: ['m09', 'm10', 'm11', 'c01', 'c04', 'c09'],
    },
    {
      id: 'm13', num: 13,
      title: 'Nube',
      titleEn: 'Cloud',
      short: 'Nube',
      summary: 'Nadie te va a preguntar en qué menú está un botón de SageMaker, pero sí qué servicio usarías y cuánto cuesta. Equivalencias AWS/GCP/Azure, órdenes de magnitud de precios y spot instances.',
      topics: [
        'Equivalencias AWS / GCP / Azure: cómputo, storage, colas, Kubernetes',
        'Plataformas gestionadas: SageMaker AI, Vertex AI (hoy Gemini Enterprise Agent Platform), Azure ML',
        'Managed vs self-hosted: cuándo conviene cada uno',
        'Instancias GPU y costo por hora (órdenes de magnitud)',
        'Spot / preemptible: para qué sí (entrenamiento, batch) y para qué no',
        'Costos ocultos: egress, NAT gateway, logs, almacenamiento',
        'Reserved instances, savings plans y compromisos de uso',
        'Cuotas y disponibilidad de GPUs por región',
      ],
      freq: 'baja', minutes: 46,
      connects: ['m04', 'm06', 'm10', 'c01', 'c10'],
    },
    {
      id: 'm14', num: 14,
      title: 'Sistemas con LLMs',
      titleEn: 'LLM systems',
      short: 'Sistemas con LLMs',
      summary: 'Hoy es raro un proceso de MLE sin al menos una pregunta de LLMs. Serving con KV cache y continuous batching, RAG, agentes, evaluación, guardrails y costo por token.',
      topics: [
        'Prefill vs decode: TTFT, tokens por segundo y por qué se comportan distinto',
        'KV cache: cálculo de memoria y PagedAttention',
        'Continuous batching, prefix caching y speculative decoding',
        'API de terceros vs modelo propio: costo, latencia, privacidad, control',
        'RAG: ingestion, chunking, embeddings, retrieval y reranking',
        'Agentes: tool calling, loops y límites',
        'Evaluación: sets dorados, LLM-as-judge, evaluación online',
        'Guardrails: prompt injection, PII, salidas estructuradas',
        'Costo por token y cómo bajarlo: routing, caching, modelos pequeños',
      ],
      freq: 'alta', minutes: 61,
      connects: ['m04', 'm07', 'm08', 'm15', 'c10', 'c11', 'c12'],
    },
    {
      id: 'm15', num: 15,
      title: 'Seguridad, privacidad y confiabilidad',
      titleEn: 'Security, privacy and reliability',
      short: 'Seguridad y confiabilidad',
      summary: 'Autenticación, datos personales, ataques al modelo y qué pasa cuando algo se cae. Rara vez es el centro de la entrevista, pero mencionarlo a tiempo y sin que te lo pidan es una señal senior.',
      topics: [
        'Autenticación y autorización del servicio: API keys, OAuth, mTLS',
        'Rate limiting y protección contra abuso',
        'PII: minimización, retención, anonimización y regulaciones (GDPR y leyes locales)',
        'Gestión de secretos y credenciales',
        'Ataques al modelo: adversarial, extracción, envenenamiento de datos, prompt injection',
        'SLOs, error budgets y disponibilidad',
        'Degradación con gracia: timeouts, retries, circuit breakers, fallbacks',
        'Multi-AZ, multi-región y recuperación ante desastres',
        'Supply chain: imágenes, dependencias y pesos de modelos verificados',
      ],
      freq: 'media', minutes: 62,
      connects: ['m06', 'm12', 'm14', 'c06', 'c09', 'c12'],
    },
  ];

  // ------------------------------------------------------------------ Parte 2 — casos
  // prompt: el enunciado tal como abre un entrevistador. Ambiguo a propósito: sin números,
  // sin escala ni latencia; el candidato debe preguntarlos.
  const cases = [
    {
      id: 'c01', num: 1,
      title: 'API de clasificación de imágenes',
      titleEn: 'Image classification API',
      short: 'API de clasificación',
      summary: 'El “hola mundo” de producción: tomar un ResNet que funciona en un notebook y convertirlo en un servicio con SLO, capacidad, monitoreo y costo. Todos los demás casos se construyen sobre este.',
      topics: [
        'Gateway en CPU + Triton en GPU: separar preprocesamiento de inferencia',
        'Presupuesto de latencia p99 por componente',
        'Dynamic batching y cuántas GPUs para el pico',
        'Export a ONNX → TensorRT FP16 y prueba de paridad',
        'Autoscaling y N+1 en dos zonas',
        'Logging de predicciones y muestreo para etiquetado',
        'Canary y rollback de una versión de modelo',
        'Costo mensual y palancas para reducirlo',
      ],
      freq: 'alta', minutes: 120, difficulty: 'intro',
      connects: ['m01', 'm03', 'm04', 'm06', 'm07', 'm08', 'm09', 'm10', 'm11', 'm12'],
      tests: [
        'Llevar un modelo de notebook a un servicio con API, SLO y fallback',
        'Estimar el QPS pico y traducirlo a número de GPUs con headroom',
        'Separar preprocesamiento (CPU) de inferencia (GPU) y justificar el model server',
        'Monitorear el modelo, no solo el servicio, y desplegar versiones sin riesgo',
      ],
      prompt: 'Tenemos un clasificador de imágenes entrenado en PyTorch que funciona bien en un notebook. Queremos exponerlo como un servicio para que la app y otros equipos lo usen. Diseña el sistema.',
      // Respuestas del entrevistador, agrupadas por temas neutros del banco de preguntas de M01.
      // Se muestran plegadas en la sesión de práctica (SPEC §5.2, §7.2). Texto = respuestas de
      // c01 · aclaración, literales: si cambian allá, actualízalas aquí.
      facts: [
        { topic: 'Usuarios y quién llama',
          a: 'El <b>backend de publicación</b> de la app (móvil y web) ya recibe las fotos porque las tiene que guardar para la publicación; ese backend llama a nuestro servicio <b>server-to-server</b>, en la misma región. Además, 2–3 equipos internos (moderación, búsqueda) llamarán la misma API, cada uno con su propia cuota. Síncrono: la sugerencia tiene que aparecer mientras el vendedor sigue llenando el formulario (unos segundos). La clasificación del catálogo existente es otra cosa: un <i>backfill</i> (clasificar de una vez las imágenes ya publicadas), que aparece más abajo en esta lista.' },
        { topic: 'Entrada y salida',
          a: 'Fotos de producto tomadas por vendedores. La app móvil reduce a ≤ 1024 px de lado largo antes de subir (≈ 150–250 KB en JPEG); la web puede mandar el archivo original (límite de 10 MB y 40 MP). Formatos: JPEG, PNG y WebP. El <b>top-5 de 500 categorías hoja</b> con su score. La UI las muestra como sugerencias ordenadas; el vendedor elige una o busca otra en el selector manual.' },
        { topic: 'Escala',
          a: '<b>10 M imágenes/día</b>: ≈ 2.5 M publicaciones nuevas al día con ≈ 3 fotos cada una, más las llamadas de otros equipos. Una imagen por request. El pico diurno es ≈ 3× el promedio. Sí: ≈ <b>200 M imágenes</b> de publicaciones existentes necesitan categoría sugerida (para búsqueda y moderación). Es un proceso batch, una vez y luego incremental.' },
        { topic: 'Latencia y disponibilidad',
          a: '<b>p99 ≤ 200 ms del lado del servidor</b>: desde que el load balancer recibe el request completo hasta que se envía la respuesta. p50 esperado ≈ 30–50 ms. El caller usa un timeout de 300 ms; si vence, la UI muestra el selector manual. <b>99.9 %</b> mensual. Si el servicio falla, el vendedor usa el selector manual de categorías: es un camino <b>no crítico</b> con fallback.' },
        { topic: 'Modelo actual',
          a: 'Sí: <b>ResNet-50</b> (25.6 M parámetros, ≈ 4.1 GMACs a 224×224), ≈ 85 % top-1 y ≈ 96 % top-5 en un split held-out. No es nuestro trabajo rediseñarlo.' },
        { topic: 'Datos y labels',
          a: 'Tres fuentes: la <b>categoría final</b> que elige el vendedor (abundante pero débil y sesgada), las <b>correcciones de moderadores</b> (más confiables, llegan en días) y un <b>golden set</b> etiquetado por humanos y congelado.' },
        { topic: 'Restricciones',
          a: '≈ <b>US$3,000/mes</b> de infraestructura para el servicio. Son fotos de producto, pero pueden incluir personas, casas o documentos, y el EXIF puede traer la ubicación GPS. No copiamos imágenes: logueamos hash y request_id; solo las ≈ 5k/mes que entran a etiquetado o al golden set se copian, sin EXIF, con retención limitada; los logs no llevan PII. Una región (us-east-1 en AWS), la misma del backend de publicación; dos zonas de disponibilidad. Usuarios en Latinoamérica, pero eso afecta al backend de la app, no a nuestra llamada server-to-server.' },
      ],
    },
    {
      id: 'c02', num: 2,
      title: 'Detección de objetos en video en tiempo real con múltiples cámaras',
      titleEn: 'Real-time multi-camera video object detection',
      short: 'Detección en video',
      summary: 'Muchos streams de video que hay que analizar con baja latencia: el ancho de banda y el costo de GPU te obligan a decidir qué corre en el edge y qué en la nube.',
      topics: [
        'Edge vs nube: ancho de banda, latencia, privacidad y costo',
        'Decodificación de video (NVDEC) y muestreo de frames',
        'DeepStream / GStreamer y batching de múltiples streams',
        'Tracking entre frames para reducir inferencias',
        'Capacidad: streams por GPU a partir de FPS y resolución',
        'Eventos, alertas y almacenamiento de clips',
        'Actualización de modelos en dispositivos (OTA) y rollback',
        'Monitoreo de cámaras caídas y drift por ubicación',
      ],
      freq: 'media', minutes: 130, difficulty: 'alta',
      connects: ['m02', 'm03', 'm04', 'm08', 'm09', 'm10', 'm11', 'm12', 'c03'],
      tests: [
        'Hacer la cuenta de streams × FPS × resolución antes de elegir arquitectura',
        'Justificar el reparto edge/nube con ancho de banda y costo',
        'Reducir cómputo con muestreo de frames, tracking y batching',
        'Operar una flota: despliegue de modelos, salud de cámaras y drift por ubicación',
      ],
      prompt: 'Tenemos cámaras instaladas en varias ubicaciones y queremos detectar ciertos objetos y eventos en el video en tiempo real para generar alertas. Diseña el sistema.',
    },
    {
      id: 'c03', num: 3,
      title: 'Inspección visual en línea de manufactura / detección de EPP en planta',
      titleEn: 'Manufacturing visual inspection / PPE detection on the plant floor',
      short: 'Inspección visual en planta',
      summary: 'El modelo corre junto a la línea, en un Jetson y sin depender de la red: latencia determinista, pocos ejemplos de defectos y falsos negativos caros. Poco común en big tech, frecuente en empresas industriales y de robótica.',
      topics: [
        'Edge en Jetson: TensorRT, JetPack y memoria compartida CPU/GPU',
        'Integración con la línea: trigger, PLC, cámara industrial e iluminación',
        'Latencia determinista y operación sin conexión',
        'Pocos defectos: desbalance, anomaly detection, datos sintéticos',
        'Costo de falsos negativos vs falsos positivos y elección de umbrales',
        'Human in the loop y re-etiquetado en planta',
        'Despliegue OTA a una flota de dispositivos y rollback',
        'Monitoreo en el edge y sincronización con la nube',
        'Privacidad de los trabajadores (detección de EPP)',
      ],
      freq: 'baja', minutes: 125, difficulty: 'media',
      connects: ['m02', 'm04', 'm08', 'm09', 'm10', 'm11', 'm12', 'c02'],
      tests: [
        'Diseñar para el edge: hardware, latencia determinista y operación sin red',
        'Elegir umbrales a partir del costo real de cada tipo de error',
        'Manejar datos escasos y desbalanceados con un loop de etiquetado en planta',
        'Actualizar y monitorear una flota de dispositivos de forma segura',
      ],
      prompt: 'Una planta de manufactura quiere usar cámaras para detectar automáticamente piezas defectuosas en la línea de producción y también si los operarios usan su equipo de protección. Diseña el sistema.',
    },
    {
      id: 'c04', num: 4,
      title: 'Segmentación de imágenes médicas o industriales',
      titleEn: 'Medical or industrial image segmentation',
      short: 'Segmentación de imágenes',
      summary: 'Imágenes enormes, nadie espera la respuesta en milisegundos y un experto revisa el resultado: un sistema batch con human in the loop donde el etiquetado caro y la trazabilidad pesan más que la latencia.',
      topics: [
        'Batch / asíncrono con colas y workers de GPU',
        'Imágenes grandes: tiling, formatos (DICOM, TIFF) y memoria',
        'Human in the loop: revisión, corrección y re-etiquetado',
        'Active learning: qué imágenes etiquetar primero',
        'Etiquetado experto: costo, guías y acuerdo entre anotadores',
        'Trazabilidad y auditoría: versión de modelo y de datos por resultado',
        'Métricas por slice (equipo, sitio, tipo de caso) y calibración',
        'Datos sensibles: privacidad, anonimización y regulaciones',
      ],
      freq: 'baja', minutes: 112, difficulty: 'media',
      connects: ['m02', 'm09', 'm10', 'm12', 'm15'],
      tests: [
        'Elegir batch/asíncrono cuando la latencia no es el requisito',
        'Diseñar el loop humano: revisión, corrección y reentrenamiento',
        'Priorizar etiquetado caro con active learning',
        'Trazabilidad y evaluación por slices en un dominio de alto riesgo',
      ],
      prompt: 'Un cliente genera todos los días imágenes en las que un especialista marca a mano ciertas regiones. Queremos un sistema que haga esa segmentación automáticamente y ayude a los especialistas. Diseña el sistema.',
    },
    {
      id: 'c05', num: 5,
      title: 'Procesamiento de documentos / OCR',
      titleEn: 'Document processing / OCR',
      short: 'Documentos y OCR',
      summary: 'Cada documento pasa por varios modelos en cadena: clasificación, OCR, extracción de campos y validación. El reto es orquestar el pipeline, propagar la confianza y mandar a revisión humana solo lo dudoso.',
      topics: [
        'Pipeline multi-modelo: clasificación, OCR, layout, extracción de campos',
        'OCR clásico vs modelos de documentos vs LLMs multimodales',
        'Orquestación asíncrona: colas, estados, reintentos e idempotencia',
        'Confianza por campo y routing a revisión humana',
        'Validaciones de negocio: formatos, sumas, cruces con otras fuentes',
        'Métricas: exactitud por campo y tasa de automatización (straight-through)',
        'Escaneos de baja calidad, PDFs variados y varios idiomas',
        'Costo por página y throughput',
      ],
      freq: 'media', minutes: 117, difficulty: 'media',
      connects: ['m02', 'm07', 'm09', 'm12', 'm14'],
      tests: [
        'Descomponer en un pipeline de modelos con contratos claros entre etapas',
        'Propagar incertidumbre y decidir cuándo interviene un humano',
        'Medir con métricas de negocio (automatización) además de métricas de modelo',
        'Procesamiento asíncrono robusto: reintentos, idempotencia y estados',
      ],
      prompt: 'Recibimos muchos documentos de clientes —facturas, formularios, identificaciones— y un equipo los captura a mano en nuestro sistema. Queremos automatizar ese proceso. Diseña el sistema.',
    },
    {
      id: 'c06', num: 6,
      title: 'Moderación de contenido a gran escala',
      titleEn: 'Content moderation at scale',
      short: 'Moderación de contenido',
      summary: 'Texto e imágenes, volumen enorme, políticas que cambian y adversarios que se adaptan. Pone a prueba cascadas de modelos, umbrales por política, revisión humana y métricas que importan (prevalencia, no accuracy).',
      topics: [
        'Cascada: reglas y hashes → modelo barato → modelo caro → humano',
        'Modelos de texto, imagen y multimodales; fusión de señales',
        'Umbrales por política y por severidad',
        'Moderación síncrona (antes de publicar) vs asíncrona (después)',
        'Colas de revisión humana y priorización',
        'Métricas: prevalencia, precision/recall por política, tiempo hasta la acción',
        'Adversarios: evasión, drift rápido y reentrenamiento frecuente',
        'Apelaciones, auditoría y sesgos',
      ],
      freq: 'alta', minutes: 115, difficulty: 'alta',
      connects: ['m02', 'm03', 'm09', 'm11', 'm12', 'm15'],
      tests: [
        'Diseñar una cascada que balancee costo, latencia y recall',
        'Elegir métricas correctas con clases muy desbalanceadas',
        'Integrar la revisión humana como parte del sistema y fuente de labels',
        'Responder a adversarios y a cambios de política sin reentrenar desde cero',
      ],
      prompt: 'Somos una red social y los usuarios publican texto e imágenes. Necesitamos detectar el contenido que viola nuestras políticas y actuar sobre él. Diseña el sistema.',
    },
    {
      id: 'c07', num: 7,
      title: 'Búsqueda semántica y multimodal con embeddings',
      titleEn: 'Semantic and multimodal search with embeddings',
      short: 'Búsqueda con embeddings',
      summary: 'Buscar por significado, con texto o con una foto: embeddings tipo CLIP, un índice vectorial y el problema de mantenerlo fresco. Aparece seguido como “visual search” o “búsqueda por imagen”.',
      topics: [
        'Embeddings de texto e imagen (CLIP) en un espacio común',
        'Vector DB y ANN: HNSW, IVF-PQ; recall vs latencia vs memoria',
        'Pipeline de indexación offline y actualizaciones incrementales',
        'Búsqueda híbrida: vectorial + keyword (BM25) + filtros',
        'Reranking en dos etapas',
        'Cambiar de modelo de embeddings obliga a reindexar el catálogo completo',
        'Evaluación: recall@k, NDCG, sets de consultas y A/B',
        'Memoria del índice y sharding',
      ],
      freq: 'alta', minutes: 108, difficulty: 'media',
      connects: ['m02', 'm04', 'm07', 'm09', 'm14', 'c08', 'c11'],
      tests: [
        'Separar indexación offline de consulta online, cada una con su presupuesto',
        'Elegir índice ANN y justificar el trade-off recall/latencia/memoria',
        'Estimar la memoria del índice a partir del número de vectores y su dimensión',
        'Evaluar la calidad de búsqueda offline y online',
      ],
      prompt: 'Tenemos un catálogo grande de productos con fotos y descripciones. Queremos que los usuarios puedan encontrar productos describiendo lo que buscan o subiendo una foto. Diseña el sistema.',
    },
    {
      id: 'c08', num: 8,
      title: 'Sistema de recomendación',
      titleEn: 'Recommendation system',
      short: 'Sistema de recomendación',
      summary: 'Una de las preguntas de ML System Design más frecuentes en empresas de producto (feeds, e-commerce, streaming): retrieval de candidatos, ranking, features en tiempo real y un A/B test que demuestre que funciona. Aquí el modelo importa menos que el embudo.',
      topics: [
        'Arquitectura en etapas: candidate generation → ranking → re-ranking',
        'Two-tower para retrieval y búsqueda ANN',
        'Ranking con features de usuario, ítem y contexto',
        'Feature store online y features en tiempo real',
        'Cold start de usuarios e ítems',
        'Feedback loops, sesgo de posición y exploración',
        'Métricas offline (recall@k, NDCG) vs online (CTR, retención)',
        'Precomputar vs calcular en línea',
      ],
      freq: 'alta', minutes: 105, difficulty: 'alta',
      connects: ['m02', 'm03', 'm09', 'm11', 'm12', 'c07'],
      tests: [
        'Diseñar un embudo en etapas con presupuesto de latencia por etapa',
        'Traducir el objetivo de negocio a una etiqueta entrenable',
        'Features online y offline sin training-serving skew',
        'Evaluar con A/B y reconocer feedback loops',
      ],
      prompt: 'Queremos que la pantalla de inicio de nuestra app le muestre a cada usuario una selección personalizada. Diseña el sistema de recomendación.',
    },
    {
      id: 'c09', num: 9,
      title: 'Detección de fraude en tiempo real',
      titleEn: 'Real-time fraud detection',
      short: 'Fraude en tiempo real',
      summary: 'Decidir en milisegundos si apruebas una transacción, con features agregadas en ventanas de tiempo y labels que llegan semanas después. Es el caso clásico de streaming features y de costo asimétrico entre errores.',
      topics: [
        'Features en streaming: conteos y agregados por ventana (Kafka, Flink)',
        'Feature store online de baja latencia',
        'Presupuesto de latencia dentro del flujo de pago',
        'Labels retrasados (chargebacks) y cómo evaluar con ellos',
        'Desbalance extremo y umbrales definidos por costo',
        'Reglas + modelo + revisión manual',
        'Adversarios y drift rápido',
        'Explicabilidad y auditoría de decisiones',
      ],
      freq: 'alta', minutes: 123, difficulty: 'alta',
      connects: ['m02', 'm03', 'm09', 'm12', 'm15'],
      tests: [
        'Diseñar features en streaming con point-in-time correctness',
        'Cumplir un presupuesto de latencia estricto en el camino crítico',
        'Manejar labels retrasados y desbalance en evaluación y monitoreo',
        'Elegir umbrales a partir del costo de negocio de cada error',
      ],
      prompt: 'Somos una plataforma de pagos y estamos perdiendo dinero por transacciones fraudulentas. Queremos detectarlas en el momento en que ocurren. Diseña el sistema.',
    },
    {
      id: 'c10', num: 10,
      title: 'Servir un LLM propio a escala',
      titleEn: 'Serving your own LLM at scale',
      short: 'Servir un LLM propio',
      summary: 'Hospedar un modelo open-weights para muchos usuarios: VRAM de pesos y KV cache, continuous batching, TTFT vs tokens por segundo y el costo por millón de tokens frente a una API de terceros.',
      topics: [
        '¿API de terceros o modelo propio? Costo, privacidad y control',
        'Cálculo de VRAM: pesos + KV cache por usuario concurrente',
        'vLLM / SGLang / TensorRT-LLM (y TGI, hoy en modo mantenimiento): continuous batching y PagedAttention',
        'Tensor parallelism y elección de GPU (L4, A100, H100)',
        'Métricas: TTFT, TPOT y throughput en tokens/s',
        'Cuantización (FP8, INT4) y su impacto en calidad',
        'Autoscaling con cold starts de modelos grandes',
        'Costo por millón de tokens',
      ],
      freq: 'alta', minutes: 105, difficulty: 'alta',
      connects: ['m03', 'm04', 'm06', 'm07', 'm08', 'm14'],
      tests: [
        'Calcular VRAM de pesos y KV cache y deducir GPUs y concurrencia',
        'Distinguir prefill de decode y sus métricas (TTFT, TPOT)',
        'Elegir motor de serving y técnica de batching con su porqué',
        'Comparar con números el costo propio contra el de una API',
      ],
      prompt: 'Queremos dejar de depender de un proveedor externo de LLMs y servir un modelo open-weights en nuestra propia infraestructura para varios productos internos. Diseña el sistema.',
    },
    {
      id: 'c11', num: 11,
      title: 'RAG empresarial',
      titleEn: 'Enterprise RAG',
      short: 'RAG empresarial',
      summary: 'Un asistente que responde con los documentos internos de la empresa y cita sus fuentes. Lo difícil no es el LLM: es la ingestion, el chunking, el retrieval híbrido, los permisos y demostrar que no alucina.',
      topics: [
        'Ingestion: conectores, parsing de PDFs y tablas, actualización incremental',
        'Chunking: tamaño, solapamiento y estructura del documento',
        'Embeddings y búsqueda híbrida (vectorial + BM25)',
        'Reranking con cross-encoder',
        'Permisos por documento (ACLs) aplicados en el retrieval',
        'Citas y grounding de la respuesta',
        'Evaluación: retrieval (recall@k) y respuesta (faithfulness) con sets dorados',
        'Latencia y costo por consulta; caching',
      ],
      freq: 'alta', minutes: 125, difficulty: 'media',
      connects: ['m09', 'm12', 'm14', 'm15', 'c07', 'c10'],
      tests: [
        'Diseñar el pipeline de ingestion, no solo la consulta',
        'Justificar chunking, búsqueda híbrida y reranking con evaluación',
        'Respetar los permisos de acceso a documentos en el retrieval',
        'Evaluar la calidad de las respuestas y detectar alucinaciones',
      ],
      prompt: 'Los empleados pierden mucho tiempo buscando información en documentos internos, wikis y tickets. Queremos un asistente que responda sus preguntas usando esa información. Diseña el sistema.',
    },
    {
      id: 'c12', num: 12,
      title: 'Agente con herramientas',
      titleEn: 'Tool-using agent',
      short: 'Agente con herramientas',
      summary: 'Un LLM que decide llamar APIs reales para completar tareas: el diseño gira en torno a orquestación, límites, timeouts, permisos, observabilidad de cada paso y un costo que crece con cada vuelta del loop.',
      topics: [
        'Loop del agente: planear, llamar herramientas, observar',
        'Definición de herramientas: esquemas y validación de argumentos',
        'Timeouts, reintentos, límite de pasos y presupuesto de tokens',
        'Guardrails: permisos mínimos y confirmación humana para acciones irreversibles',
        'Prompt injection a través de resultados de herramientas',
        'Observabilidad: trazas por paso, replay y costo por tarea',
        'Evaluación: tasa de éxito, trayectorias y regresiones',
        'Estado, memoria y reanudación de tareas largas',
      ],
      freq: 'media', minutes: 125, difficulty: 'alta',
      connects: ['m02', 'm12', 'm14', 'm15', 'c10', 'c11'],
      tests: [
        'Acotar el agente: qué hace solo y qué requiere aprobación',
        'Diseñar para fallas de herramientas: timeouts, reintentos e idempotencia',
        'Observar y evaluar un sistema no determinista',
        'Controlar costo y latencia de un loop con varias llamadas al LLM',
      ],
      prompt: 'Queremos un asistente de soporte que no solo responda preguntas, sino que resuelva los casos de los clientes usando nuestros sistemas internos. Diseña el sistema.',
    },
    {
      id: 'c13', num: 13,
      title: 'Speech-to-text en tiempo real',
      titleEn: 'Real-time speech-to-text',
      short: 'Speech-to-text en vivo',
      summary: 'Transcribir el audio mientras la persona habla: streaming bidireccional, fragmentos con contexto, latencia percibida y conexiones largas que complican el balanceo y el autoscaling.',
      topics: [
        'ASR streaming vs batch y latencia percibida (resultados parciales y finales)',
        'WebSockets / gRPC streaming y conexiones de larga duración',
        'Fragmentación del audio, VAD y contexto entre fragmentos',
        'Modelos streaming nativos vs modelos tipo Whisper adaptados',
        'Balanceo y autoscaling con sesiones con estado',
        'Capacidad: streams concurrentes por GPU',
        'Métricas: WER y latencia de finalización, por idioma y acento',
        'Privacidad del audio y retención',
      ],
      freq: 'baja', minutes: 112, difficulty: 'alta',
      connects: ['m02', 'm03', 'm04', 'm06', 'm08', 'c02'],
      tests: [
        'Diseñar serving de streaming con estado en lugar de request/response',
        'Estimar sesiones concurrentes por GPU',
        'Balancear latencia percibida contra precisión (parciales vs finales)',
        'Evaluar por slices (idioma, acento, ruido) y monitorear en producción',
      ],
      prompt: 'Queremos agregar subtítulos en vivo a las llamadas y reuniones de nuestra plataforma. Diseña el sistema de transcripción.',
    },
  ];

  // ------------------------------------------------------------------ páginas especiales
  // part 3 = Práctica, part 4 = Referencias. "inicio" va fuera de las cuatro partes (grupo
  // propio en el sidebar): part 0 / num 0.
  const specials = [
    {
      id: 'inicio', part: 0, num: 0,
      title: 'Inicio', titleEn: 'Home', short: 'Inicio',
      summary: 'Tu tablero: progreso del curso, qué sigue, tus últimas prácticas y las flashcards pendientes de hoy.',
    },
    {
      id: 'practica', part: 3, num: 1,
      title: 'Simulador de entrevista', titleEn: 'Interview simulator', short: 'Simulador',
      summary: 'Elige un caso y diséñalo en 45 minutos con el reloj y el framework de 7 pasos a la vista; después, autoevaluación con rúbrica y la solución.',
    },
    {
      id: 'historial', part: 3, num: 2,
      title: 'Historial de práctica', titleEn: 'Practice history', short: 'Historial',
      summary: 'Todos tus intentos con su puntaje por dimensión, para ver dónde mejoras y dónde sigues perdiendo puntos.',
    },
    {
      id: 'flashcards', part: 3, num: 3,
      title: 'Flashcards', titleEn: 'Flashcards', short: 'Flashcards',
      summary: 'Repaso espaciado (Leitner) de conceptos, números, trade-offs, trampas y frases para decir en inglés.',
    },
    {
      id: 'ref-numeros', part: 4, num: 1,
      title: 'Números que debes saber', titleEn: 'Numbers you should know', short: 'Números que debes saber',
      summary: 'La hoja de referencia para las estimaciones: latencias, specs de GPUs, bytes por dtype y órdenes de magnitud de precios en la nube.',
      topics: [
        'Latencias típicas: memoria, SSD, red dentro de una zona y entre regiones',
        'Specs de GPUs: T4, L4, A10G, A100, H100 (VRAM, ancho de banda, TFLOPS)',
        'Bytes por dtype: FP32, FP16/BF16, FP8, INT8, INT4',
        'Fórmulas de bolsillo: QPS pico, Little\'s law, VRAM de pesos, KV cache',
        'Tiempo y disponibilidad: segundos por día y por mes, 99.9 % ≈ 43 min/mes',
        'Órdenes de magnitud de precios: GPU y CPU por hora, storage, egress',
        'Tamaños típicos: imagen JPEG, embedding, token, segundo de audio',
        'Throughput de modelos comunes: qué medir y con qué herramienta, en vez de memorizar',
      ],
      connects: ['m03', 'm04', 'm13', 'm14'],
    },
    {
      id: 'ref-herramientas', part: 4, num: 2,
      title: 'Herramientas por categoría', titleEn: 'Tools by category', short: 'Herramientas por categoría',
      summary: 'Qué herramienta resuelve qué problema, agrupadas por categoría, con su equivalente gestionado en cada nube y cuándo vale la pena mencionarla.',
      topics: [
        'Model servers: Triton, TorchServe, BentoML, Ray Serve, KServe, vLLM, SGLang, TGI',
        'Orquestación y workflows: Kubernetes, Airflow, Kubeflow, Argo',
        'Datos y features: Spark, Kafka, Flink, Feast, DVC',
        'Experimentos y registro: MLflow, Weights & Biases',
        'Monitoreo: Prometheus, Grafana, OpenTelemetry, Evidently',
        'Vector DBs: FAISS, Milvus, Qdrant, pgvector, OpenSearch',
        'Stack de LLMs: motores de serving, frameworks de agentes y de evaluación',
        'Equivalencias gestionadas en AWS, GCP y Azure',
        'IaC, CI y supply chain: Terraform/OpenTofu, GitHub Actions con OIDC, cosign, secret managers',
      ],
      connects: ['m05', 'm06', 'm07', 'm09', 'm10', 'm12', 'm13', 'm14', 'm15'],
    },
    {
      id: 'ref-comandos', part: 4, num: 3,
      title: 'Docker y kubectl', titleEn: 'Docker and kubectl', short: 'Docker y kubectl',
      summary: 'Los comandos para levantar, depurar y desplegar un servicio de modelos, qué hace cada flag y los errores más comunes.',
      topics: [
        'docker build, run, logs, exec e inspección de capas',
        'GPUs en Docker: --gpus y NVIDIA Container Toolkit',
        'docker compose para levantar gateway + Triton en local',
        'kubectl get, describe, logs, exec, port-forward',
        'Rollouts: kubectl rollout status, undo; kubectl scale',
        'Depurar pods: CrashLoopBackOff, OOMKilled, probes que fallan',
        'Autoscaling: kubectl get hpa, kubectl top, eventos del cluster',
      ],
      connects: ['m05', 'm06', 'c01'],
    },
    {
      id: 'glosario', part: 4, num: 4,
      title: 'Glosario ES–EN', titleEn: 'Spanish–English glossary', short: 'Glosario ES–EN',
      summary: 'Los términos técnicos en inglés tal como se dicen en la entrevista, con su equivalente en español, una definición corta y una frase de ejemplo.',
    },
  ];

  // ------------------------------------------------------------------ hoja de ruta
  // Fases chicas a propósito: cada una debe caber en una sola sesión de trabajo (≈ 3 módulos, o
  // ≈ 2 casos, o combinaciones equivalentes; una hoja de referencia cuenta como medio módulo).
  // Orden: primero lo que se usa en todos los casos (estimar, servir), luego datos y operación,
  // luego LLMs; cada bloque de casos llega justo después de los módulos que ejercita.
  const roadmap = [
    {
      phase: 1, status: 'done',
      title: 'Fase 1 — Esqueleto, el mapa y el hola mundo',
      items: ['m01', 'c01'],
      note: 'La app completa (navegación, progreso, buscador), el módulo del mapa con el framework de 7 pasos y el caso de clasificación de imágenes resuelto de punta a punta con archivos de referencia. Incluye el simulador de entrevista con rúbrica, las flashcards y el glosario ES–EN; los demás enunciados ya se pueden practicar.',
    },
    {
      phase: 2, status: 'done',
      title: 'Fase 2 — El kit de estimaciones',
      items: ['m02', 'm03', 'm04'],
      note: 'Patrón de inferencia, latencia/capacidad y hardware son lo que usas en los primeros 15 minutos de cualquier caso: con esto dejas de estimar a ojo.',
    },
    {
      phase: 3, status: 'done',
      title: 'Fase 3 — Contenedores y orquestación',
      items: ['m05', 'm06', 'ref-comandos'],
      note: 'Docker y Kubernetes vistos desde lo que pregunta un entrevistador de MLE (imágenes CUDA, autoscaling por GPU, cold starts), con la hoja de comandos para no memorizar flags.',
    },
    {
      phase: 4, status: 'done',
      title: 'Fase 4 — Servidores de modelos y optimización',
      items: ['m07', 'm08', 'ref-numeros'],
      note: 'Cuándo elegir cada model server y cómo ganar latencia con ONNX, TensorRT y cuantización; cierra con la hoja de números que resume M3, M4 y M8.',
    },
    {
      phase: 5, status: 'done',
      title: 'Fase 5 — Visión en tiempo real: nube y edge',
      items: ['c02', 'c03'],
      note: 'Dos casos que aplican M2–M8 a tu terreno: video multicámara (nube vs edge) y una flota de Jetson en planta.',
    },
    {
      phase: 6, status: 'done',
      title: 'Fase 6 — Datos, features y MLOps',
      items: ['m09', 'm10', 'm11'],
      note: 'Lo que pasa antes y alrededor del serving: pipelines, feature store y skew, registry y CI/CD, y cómo desplegar sin romper nada (shadow, canary, A/B).',
    },
    {
      phase: 7, status: 'done',
      title: 'Fase 7 — Monitoreo y humano en el loop',
      items: ['m12', 'c04'],
      note: 'Drift, alertas y reentrenamiento, aplicados enseguida a un caso batch de segmentación con revisión humana.',
    },
    {
      phase: 8, status: 'done',
      title: 'Fase 8 — Pipelines multimodelo',
      items: ['c05', 'c06'],
      note: 'Documentos/OCR y moderación a gran escala: varios modelos encadenados, colas, costos por etapa y revisión humana donde el modelo duda.',
    },
    {
      phase: 9, status: 'done',
      title: 'Fase 9 — Nube y seguridad',
      items: ['m13', 'm15', 'ref-herramientas'],
      note: 'Equivalencias AWS/GCP/Azure, costos y spot, más seguridad, privacidad y confiabilidad; con la tabla de herramientas por categoría ya tienes el mapa completo.',
    },
    {
      phase: 10, status: 'done',
      title: 'Fase 10 — Búsqueda y recomendación',
      items: ['c07', 'c08'],
      note: 'Los clásicos de empresas grandes y van en secuencia: embeddings + ANN (c07) son la base del retrieval de recomendación (c08).',
    },
    {
      phase: 11, status: 'done',
      title: 'Fase 11 — Tiempo real con streaming',
      items: ['c09', 'c13'],
      note: 'Fraude con features en streaming y speech-to-text en vivo comparten el problema de fondo: decidir con datos que llegan continuamente y un presupuesto de latencia estricto.',
    },
    {
      phase: 12, status: 'done',
      title: 'Fase 12 — LLMs: el módulo y el serving',
      items: ['m14', 'c10'],
      note: 'KV cache, continuous batching, RAG, agentes, evaluación y costo por token; enseguida lo aplicas sirviendo un LLM propio a escala.',
    },
    {
      phase: 13, status: 'next',
      title: 'Fase 13 — RAG y agentes',
      items: ['c11', 'c12'],
      note: 'Sobre M14 y c10: darle al modelo tus documentos con citas (c11) y dejarlo actuar con herramientas, timeouts y guardrails (c12).',
    },
  ];

  // Respuestas del entrevistador para el simulador (salen de la sección 'aclaracion' de cada caso;
  // si cambian esas respuestas, actualiza también estas).
  const FACTS = {
    c02: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Un <b>centro de monitoreo (SOC)</b> central, 24/7, atiende las alertas en una consola web: mira las imágenes y el clip, llama al guardia del sitio o a las autoridades y cierra cada alerta como confirmada o descartada, con un motivo. De noche hay <b>≈ 4 operadores</b> para toda la flota: aguantan ≈ <b>50 alertas/hora</b> como máximo. Cada sitio ya tiene NVR que graban 24/7; no se reemplazan."
      },
      {
        "topic": "Entrada y salida",
        "a": "Cámaras IP con RTSP y H.264. Stream principal: 1080p a 15 fps, ≈ 4 Mb/s. Las cámaras permiten configurar un <b>segundo stream</b> (resolución y fps propios); hoy no se usa. Hay que detectar <b>personas y vehículos en zonas restringidas</b>: el perímetro fuera de horario, personas a pie en pasillos de montacargas y vehículos detenidos en carriles de bomberos. No se piden armas, peleas, caídas ni EPP. La alerta lleva evidencia: imágenes y un clip corto."
      },
      {
        "topic": "Escala",
        "a": "<b>25 centros de distribución × 40 cámaras = 1,000 cámaras</b>. Se espera crecer a ≈ 60 sitios en dos años, y algunos sitios van a sumar cámaras."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "La alerta debe estar en la pantalla del SOC en <b>p95 ≤ 5 s</b> desde que la persona entra a la zona, incluido el tiempo de permanencia que exijas para confirmarla. Cada sitio debe poder generar alertas el <b>99.5 %</b> del tiempo. Calidad: <b>recall ≥ 95 %</b> de intrusiones reales y <b>precisión ≥ 90 %</b> de las alertas que llegan al SOC."
      },
      {
        "topic": "Modelo actual",
        "a": "Hay un detector ligero tipo YOLO (≈ 10–30 M parámetros, entrada 640×640) ajustado con datos de un piloto. El equipo de modelos puede entrenar uno más pesado si hace falta. No es nuestro trabajo diseñar la arquitectura del modelo."
      },
      {
        "topic": "Datos y labels",
        "a": "No hay un dataset etiquetado de estas cámaras. Los operadores del SOC cierran cada alerta como confirmada o descartada, con un motivo (p. ej. sombra, animal, persona autorizada). El video de los NVR queda disponible para revisar si hace falta."
      },
      {
        "topic": "Restricciones",
        "a": "Subida de ≈ 20–50 Mb/s por sitio (internet de negocio, sin SLA), con cortes de minutos a horas algunas veces al año; se puede agregar LTE. Cada sitio tiene cuarto de IT con rack, UPS y LAN gigabit (1U de ≈ 300 W aceptable). Privacidad: nada de reconocimiento facial ni identificación, aviso a los trabajadores, clips 30 días con acceso restringido (en México, LFPDPPP). Capex ≈ US$10k por sitio (a 36 meses) y opex de nube ≈ US$1–2k/mes; menor costo a 3 años."
      }
    ],
    c03: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Una planta de autopartes en Nuevo León que estampa y maquina soportes metálicos (brackets) para una armadora. En cada línea, un PLC rastrea las piezas y acciona un desviador neumático hacia un contenedor de inspección manual; hay <b>1 inspector por línea</b> por turno. Las alertas de EPP son para el <b>supervisor del turno</b>, en una tablet; la dirección quiere KPIs agregados por zona y turno. En planta opera mantenimiento de línea (nadie sabe Kubernetes) y hay un equipo central de ML chico."
      },
      {
        "topic": "Entrada y salida",
        "a": "Inspección: una cámara por línea, disparada por una fotocelda, una imagen por pieza; la cámara, la óptica y la iluminación todavía no están elegidas (el piloto usó una cámara prestada). Por pieza se necesita saber si pasa o se desvía, y qué defecto tiene: <b>fisura, rebaba, barreno faltante o deformación</b> (las fisuras más finas que importan miden ≈ 0.2 mm). EPP: <b>12 cámaras IP de área 1080p</b> en zonas de riesgo (prensas, pasillos de montacargas); casco, chaleco y lentes; alerta si una persona sin el EPP requerido permanece <b>más de 5 s</b> en la zona."
      },
      {
        "topic": "Escala",
        "a": "<b>4 líneas</b>, cada una a <b>2 piezas/s</b> (120 por minuto), en <b>2 turnos de 8 h</b>; en la noche no se produce. La tasa de defectos es ≈ <b>0.5 %</b>, repartida de forma desigual entre los 4 tipos (no tienen el reparto exacto). Hoy es una planta; si funciona, se agregan dos más en el próximo año."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "La banda transportadora va a <b>0.6 m/s</b> y la cámara puede ir <b>0.3 m</b> antes del desviador. El equipo de controles necesita la decisión <b>150 ms</b> antes de que la pieza llegue a la compuerta (ciclo del PLC, válvula y actuador). La alerta de EPP debe llegar a la tablet en <b>≤ 10 s</b>. El enlace a internet de la planta se cae a veces por horas (una vez, 3 días): la línea tiene que seguir operando <b>≥ 72 h</b> sin nube."
      },
      {
        "topic": "Modelo actual",
        "a": "No hay modelo en producción. Hoy un operario revisa a ojo al final de la línea; a 2 piezas/s no alcanza a ver cada pieza con detalle y la armadora ha reportado escapes. Calidad pide <b>recall ≥ 99.5 % por tipo de defecto</b>. Un defecto que llega a la armadora puede disparar un incidente de ≈ <b>US$2,000–10,000</b> (contención, cargos, scorecard de PPM: piezas defectuosas por millón); una pieza buena desviada cuesta ≈ <b>US$0.05–0.10</b> de re-inspección. El inspector revisa ≈ 1 pieza cada 15 s."
      },
      {
        "topic": "Datos y labels",
        "a": "De un piloto con una cámara prestada hay ≈ <b>2,000 imágenes de piezas buenas</b> y ≈ <b>300 de defectos</b>, repartidas de forma desigual entre los 4 tipos. Los ingenieros de calidad pueden etiquetar unas horas por semana. El inspector ya revisa cada pieza desviada y decide si tiene un defecto (y de qué tipo) o si está buena."
      },
      {
        "topic": "Restricciones",
        "a": "La red de planta (OT) está aislada: solo una DMZ puede abrir conexiones salientes a la nube. El PLC de cada línea habla Modbus TCP y OPC UA. EPP: sin reconocimiento facial, sin seguimiento de identidad entre días, caras difuminadas en la evidencia, retención de <b>7 días</b> y KPIs solo agregados; hay que dar aviso a los trabajadores y acordarlo con sus representantes. Aplica la LFPDPPP (los detalles los define legal). Presupuesto: unos miles de dólares de hardware por estación y poco gasto de nube."
      }
    ],
    c04: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Un grupo hospitalario con <b>3 laboratorios de patología (A, B y C)</b>. El especialista es un <b>patólogo</b>: para el reporte estima a ojo el área de tumor y el % de tumor en el tejido (entre otras cosas, para decidir si la muestra alcanza para pruebas moleculares); las estimaciones varían entre patólogos. Quieren que, al abrir el caso, el visor web que ya usan muestre la región propuesta, que el patólogo <b>acepta o corrige antes de firmar</b>. La firma siempre es del patólogo: es apoyo a la decisión, no diagnóstico."
      },
      {
        "topic": "Entrada y salida",
        "a": "Biopsias y piezas quirúrgicas de <b>colon y recto teñidas con H&amp;E</b>, escaneadas como imágenes de lámina completa (WSI) de ≈ 1 GB (0.5–3 GB). A y B: proveedor X, SVS (TIFF piramidal, un archivo por lámina), 40× ≈ 0.25 µm/px. C: proveedor Y, <b>DICOM WSI</b> con otro perfil de color; cada lámina es una serie de varios archivos (niveles, etiqueta, macro). Salida esperada: la región de tumor, el área en mm² y el % del tejido. El visor dibuja polígonos que le entregue una API."
      },
      {
        "topic": "Escala",
        "a": "≈ <b>1,200 láminas al día</b> dentro del alcance, entre los 3 laboratorios. Los escáneres trabajan de ≈ <b>08:00 a 22:00</b> y se cargan por racks, así que llegan en ráfagas. El año que viene se suman <b>2 laboratorios más</b> (≈ 2,000 láminas al día)."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "El resultado tiene que estar antes de que el patólogo abra el caso: la mayoría se revisa al día siguiente y algunas el mismo día, horas después del escaneo. Los cortes congelados intraoperatorios están fuera de alcance. Si el sistema no está, los patólogos trabajan como hoy, pero un resultado nunca puede aparecer en la lámina equivocada ni con una versión de modelo desconocida."
      },
      {
        "topic": "Modelo actual",
        "a": "Existe un modelo de segmentación tipo <b>U-Net</b> (≈ 30 M parámetros, entrada 512×512 RGB a 20×, salida: probabilidad de tumor por píxel), entrenado en PyTorch con láminas de A y B. Dice offline ≈ <b>0.82</b> en un set separado de A y B. <b>Nunca se validó en el laboratorio C.</b> No es nuestro trabajo rediseñar el modelo."
      },
      {
        "topic": "Datos y labels",
        "a": "≈ <b>400 láminas de A y B con anotación parcial</b> (regiones marcadas, no la lámina completa). Hay <b>20 horas de patólogo al mes</b> para etiquetar, a ≈ <b>US$200/h</b>; los residentes pueden pre-anotar y un patólogo aprueba. Anotar una lámina completa toma 30–60 min; corregir una propuesta, 5–10 min; etiquetar una región elegida, 1–2 min."
      },
      {
        "topic": "Restricciones",
        "a": "Los escáneres ya suben cada lámina al <b>archivo digital del grupo en la nube</b> (tipo S3, en la región aprobada por legal), que emite un evento con la key y el sha256 de cada archivo (en C, uno por archivo); no es costo nuestro. Datos de salud: sensibles (LFPDPPP en México, HIPAA en EE. UU.). La WSI trae imagen de la etiqueta y macro con datos del paciente. La clasificación regulatoria la decide gobierno clínico y legal. Presupuesto: infraestructura ≤ <b>US$2k/mes</b> más las 20 h de patólogo."
      }
    ],
    c05: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Una <b>plataforma mexicana de créditos para PyMEs</b>. Los clientes suben sus documentos desde la app o la web durante el onboarding y en cada solicitud de crédito. Hoy <b>45 capturistas</b> teclean los campos en el sistema core de originación, ≈ <b>4 min por documento</b>. Los campos alimentan el expediente, el análisis de crédito y el desembolso. La autenticidad de la INE y la prueba de vida las hace un proveedor de KYC ya integrado: fuera de alcance."
      },
      {
        "topic": "Entrada y salida",
        "a": "Mezcla: facturas CFDI 35 % (≈ 1.5 págs; ≈ 60 % llegan como XML; el PDF trae un QR con UUID, RFCs y total), INE 25 % (frente y reverso), comprobantes de domicilio 15 %, estados de cuenta 10 % (≈ 8 págs), solicitudes 15 % (3 págs; ≈ 30 % con campos a mano). La mitad de INE y comprobantes son fotos de celular; estados de cuenta y facturas suelen ser PDF digitales con capa de texto (≈ 20 % de los estados de cuenta llegan escaneados). Salida: los campos de cada tipo (RFC, CURP, CLABE, montos, fechas, nombres) en el core."
      },
      {
        "topic": "Escala",
        "a": "≈ <b>5,000 documentos/día</b> en promedio (sobre 30 días, fines de semana incluidos), ≈ 2.4 páginas por documento. Los primeros días de cada mes llega ≈ <b>2×</b>. Las subidas ocurren de 08:00 a 22:00."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "Un documento que no necesita revisión debería estar en el core en <b>p95 ≤ 2 min</b> (el cliente sigue en la app); uno que necesita revisión, en <b>p90 ≤ 4 horas hábiles</b> (lunes a viernes, 09:00–19:00). La API de subida es de cara al cliente: <b>99.9 %</b>. Ningún documento se puede perder. Hoy el turnaround es de <b>24–48 h</b> y es el cuello de botella del embudo."
      },
      {
        "topic": "Modelo actual",
        "a": "No hay modelo: todo se captura a mano. Exactitud exigida en los campos que se acepten sin revisión: <b>≥ 99.5 %</b>, y <b>≥ 99.9 %</b> en CURP, RFC, CLABE y montos (una CLABE equivocada es un desembolso a otra cuenta). Meta del negocio: <b>≥ 60 %</b> de documentos sin intervención humana al lanzar y <b>80 %</b> en 12 meses. Nadie ha medido la exactitud de la captura manual."
      },
      {
        "topic": "Datos y labels",
        "a": "≈ 2 años de capturas: ≈ <b>1.2 M documentos</b> con sus imágenes y los valores tecleados por campo, <b>sin cajas</b> (nadie marcó dónde estaba cada valor en la página). Se estima ≈ 1–2 % de errores de tecleo, sin medir. Los capturistas pueden ayudar a etiquetar."
      },
      {
        "topic": "Restricciones",
        "a": "Todo corre en la cuenta de AWS del lender, en la región aprobada por legal; servicios gestionados del mismo proveedor sí, proveedores externos solo con contrato y aprobación. INE, CURP, domicilios y datos bancarios son datos personales (LFPDPPP, ley de 2025); retención según la política del lender. Capturista ≈ <b>US$800/mes</b> cargado (≈ US$36k/mes hoy). Sin tope de infraestructura: el caso de negocio se compara contra el costo de captura y el turnaround."
      }
    ],
    c06: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Una red social. <b>post-service</b> y <b>comment-service</b> llaman al chequeo de moderación antes de confirmar cada publicación. Un equipo de <b>≈ 600 moderadores</b> (proveedor externo + equipo propio, 3 turnos: ≈ 600 puestos cubiertos cada día) revisa en una herramienta interna; un equipo especializado aparte maneja CSAM y terrorismo. Un servicio de <b>enforcement</b> que ya existe aplica sanciones a las cuentas (strikes, suspensiones) con nuestras decisiones. Los usuarios reportan contenido y pueden apelar; la apelación la revisa otra persona."
      },
      {
        "topic": "Entrada y salida",
        "a": "<b>Posts</b> (texto y, opcionalmente, imágenes) y <b>comentarios</b> (texto). Video, transmisiones en vivo, mensajes directos y anuncios quedan fuera. <b>7 políticas en 4 severidades</b>: S0 CSAM y terrorismo; S1 amenazas creíbles y violencia gráfica, autolesiones; S2 odio y acoso, desnudez adulta; S3 spam y estafas (más lo borderline). Acciones: bloquear antes de publicar, quitar, bajar la distribución, advertencia o restricción por edad, mandar a revisión. Cada restricción lleva su explicación al usuario."
      },
      {
        "topic": "Escala",
        "a": "<b>30 M posts al día</b>, 40 % con imágenes (1.5 en promedio): <b>18 M imágenes/día</b>. <b>150 M comentarios al día</b>. El pico diurno es ≈ 3× el promedio; eventos grandes (una final, una elección) traen picos más cortos y concentrados en temas. Se estima que ≈ 0.5 % de los ítems viola alguna política, la mayoría spam."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "El chequeo previo puede sumar <b>p99 ≤ 150 ms</b> del lado del servidor a la creación de un post o comentario, con disponibilidad <b>99.95 %</b>: publicar no puede caerse por la moderación. El análisis profundo, <b>p95 ≤ 5 min</b> desde la publicación. Los reportes S1 se revisan <b>p90 ≤ 1 h</b>. Una coincidencia con contenido S0 conocido se actúa de inmediato."
      },
      {
        "topic": "Modelo actual",
        "a": "Hay un <b>clasificador de texto multilingüe destilado</b> (multi-label: un score por política, textos de hasta ≈ 128 tokens) y un <b>clasificador de imágenes ligero</b>. Hay listas de hashes de la industria para CSAM y terrorismo y una lista propia de contenido removido. No hay un modelo multimodal en producción. No es nuestro trabajo diseñar los modelos."
      },
      {
        "topic": "Datos y labels",
        "a": "Años de <b>decisiones de moderadores</b> (sobre lo que el sistema marcó o los usuarios reportaron) y de apelaciones. Las definiciones de las políticas las escribe el equipo de políticas, <b>cambian y tienen versión</b>. Español de varios países, inglés y portugués son ≈ 90 % del volumen; los moderadores cubren bien esos tres. Hay <b>adversarios</b> que se adaptan en días: homoglifos, espacios entre letras, texto dentro de imágenes, imágenes alteradas para cambiar el hash."
      },
      {
        "topic": "Restricciones",
        "a": "Capacidad humana: ≈ 600 puestos cubiertos cada día, ≈ 60 ítems/h por persona, ≈ 6 h productivas por turno → <b>≈ 216k revisiones/día</b>, a <b>≈ US$1,500/mes por puesto</b> (varía por país). Usuarios en América Latina, EE. UU. y la UE: aplica la Digital Services Act (explicación de cada decisión, apelaciones, transparencia) y el reporte obligatorio de CSAM en EE. UU.; los detalles los decide legal. El bienestar de los moderadores es obligatorio y el CSAM nunca entra a datos de entrenamiento."
      }
    ],
    c07: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Compradores del mismo marketplace de segunda mano donde ya se sugiere la categoría de las fotos. Buscan desde la app y la web, escribiendo o subiendo una foto; llama el front de búsqueda. Los vendedores crean, editan y marcan como vendidos sus listings en <b>listing-service</b>, que publica cada cambio en Kafka. La búsqueda de hoy la opera el equipo de búsqueda."
      },
      {
        "topic": "Entrada y salida",
        "a": "Entrada: texto libre (“chamarra de mezclilla vintage talla M”) <b>o</b> una foto (“algo como esto”; la app la reduce antes de subirla, la web puede mandar fotos grandes), más filtros: categoría, rango de precio, ciudad o “con envío”, y estado. Los filtros son <b>estrictos</b>. Salida: <b>48 resultados por página</b>, paginados; la mayoría de las sesiones no pasa de la página 2. En la primera versión, una búsqueda por foto no lleva texto."
      },
      {
        "topic": "Escala",
        "a": "≈ <b>100 M listings activos</b>, ≈ 4 fotos cada uno. Entran ≈ <b>2.5 M listings nuevos al día</b> y salen otros tantos (vendidos, vencidos, retirados); hay ≈ 5 M cambios de atributos al día (precio, estado). ≈ <b>50 M búsquedas al día</b>, con un pico de la tarde ≈ 3× el promedio; ≈ <b>5 %</b> son por foto."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "Del lado del servidor: texto <b>p99 ≤ 300 ms</b>; foto <b>p99 ≤ 600 ms</b>, incluido recibir y procesar la imagen. Un listing nuevo debe ser buscable en <b>p95 ≤ 5 min</b>; uno vendido o retirado debe dejar de aparecer en <b>≤ 1 min</b>. La búsqueda debe estar disponible el <b>99.9 %</b>; si la parte nueva falla, es aceptable volver a la búsqueda por palabras clave de hoy."
      },
      {
        "topic": "Modelo actual",
        "a": "Hoy: <b>BM25 en OpenSearch</b> con los mismos filtros. ≈ 8 % de las búsquedas no devuelve nada; fallan sinónimos (“chamarra” vs “campera”), descripciones vagas y errores de escritura; no hay búsqueda por foto. El equipo de modelos entrega un <b>dual encoder tipo CLIP</b> (texto e imagen en el mismo espacio) ajustado con datos del marketplace: <b>d = 512</b>, L2-normalizado, versionado. Diseñar el modelo no es nuestro trabajo."
      },
      {
        "topic": "Datos y labels",
        "a": "Por búsqueda se registran la consulta, los filtros, los resultados mostrados con su posición, los clics, los favoritos y los <b>contactos con el vendedor</b> (13 meses de logs). Las compras se ven solo en parte: muchas se cierran fuera de la plataforma. No hay juicios de relevancia hechos por personas. Cada listing tiene título, atributos y ≈ 4 fotos. Idiomas: español de México y otros países, con marcas y palabras en inglés."
      },
      {
        "topic": "Restricciones",
        "a": "Presupuesto ≈ <b>US$20k al mes</b> de infraestructura nueva; el clúster de OpenSearch actual ya está pagado. Las consultas pueden traer datos personales (teléfonos, nombres) y las fotos de consulta son de los usuarios: retención y privacidad las decide legal. La personalización por usuario queda fuera de este proyecto."
      }
    ],
    c08: [
      {
        "topic": "Usuarios y quién llama",
        "a": "La <b>app del celular</b> del mismo marketplace de segunda mano (el de categorías y búsqueda) pide el home al abrirse y al hacer scroll. Hoy el home muestra “recientes en tu ciudad” más lo popular, sin personalización. El negocio quiere más <b>contactos con vendedores</b> (abrir el chat o pedir el teléfono) por usuario activo, no más clicks, y sin quitarle contactos a la búsqueda."
      },
      {
        "topic": "Entrada y salida",
        "a": "Entrada: el usuario (id, ciudad, dispositivo) y la página del scroll. Salida: <b>50 publicaciones</b> por respuesta; la primera pantalla muestra ≈ 10. Nunca se puede mostrar algo vendido o borrado, ni algo sin envío fuera de la ciudad del usuario. Un usuario nuevo elige 3 o más categorías en el onboarding. Ningún vendedor nuevo debería quedar invisible."
      },
      {
        "topic": "Escala",
        "a": "<b>≈ 30 M de usuarios activos al día</b>, ≈ 3 requests de home por usuario contando las páginas del scroll: <b>≈ 90 M/día</b>, con pico diurno ≈ 3× el promedio. Catálogo: <b>≈ 100 M publicaciones activas</b>, ≈ 2.5 M nuevas al día y casi las mismas salen; casi todas son unidades únicas que viven unas semanas. Hay ciudades con millones de publicaciones y muchas con unos pocos miles."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "<b>p99 ≤ 200 ms</b> del lado del servidor. Si el servidor no responde a tiempo, la app muestra su caché o “recientes en tu ciudad”. Lo que el usuario acaba de ver debería contar en su siguiente home en ≈ 1 minuto. Una publicación vendida debe desaparecer en ≤ 1 min; una nueva, poder aparecer en ≤ 5 min."
      },
      {
        "topic": "Modelo actual",
        "a": "No hay modelo de recomendación: el home es una heurística. Del sistema de búsqueda ya existen un vector CLIP por publicación (foto + título) y un índice ANN; otro servicio sugiere la categoría de cada publicación. No es nuestro trabajo diseñar la arquitectura interna de los modelos."
      },
      {
        "topic": "Datos y labels",
        "a": "La app registra <b>impresiones</b> (qué quedó visible y en qué posición), clicks, guardados, contactos, búsquedas y vistas; llegan a Kafka en segundos. Los clicks ocurren en la sesión; un contacto puede llegar horas después y cuenta si llega <b>dentro de 24 h</b> de la impresión. La compra casi no se observa: se paga fuera de la app. Hay plataforma de A/B con asignación por usuario."
      },
      {
        "topic": "Restricciones",
        "a": "No hay un presupuesto fijo: hasta <b>≈ US$40k al mes</b> de infraestructura se acepta si el sistema mueve los contactos; más que eso hay que justificarlo. Una publicación sin envío solo se puede comprar en su ciudad. Se pueden correr varios experimentos a la vez."
      }
    ],
    c09: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Somos un <b>PSP</b> en Latinoamérica: procesamos pagos con tarjeta no presente (e-commerce y apps) para miles de comercios. El chequeo de fraude lo llama el <b>orquestador de pagos</b> dentro del flujo de autorización, antes de pedirla al emisor. Un equipo de <b>fraud ops</b> de ≈ 15 analistas escribe las reglas, revisa ≈ 1,500 casos al día de comercios con captura posterior e investiga ataques. Soporte a comercios y el equipo de disputas tienen que poder explicar cada decisión. El equipo de ML es de 2–3 personas."
      },
      {
        "topic": "Entrada y salida",
        "a": "Por pago llega: token de la tarjeta (nunca el número), BIN, monto y moneda, comercio y su giro (MCC), device fingerprint del SDK de checkout, IP, email y teléfono si el comercio los manda, y dirección de envío en bienes físicos. Se devuelve una decisión: <b>aprobar</b>, <b>rechazar</b>, <b>step-up</b> (3-D Secure u OTP) o <b>revisión manual</b> (solo comercios que capturan después). Del step-up, ≈ 10–20 % de los compradores legítimos abandona."
      },
      {
        "topic": "Escala",
        "a": "<b>≈ 10 M de transacciones al día</b>; el pico diario es ≈ 3× el promedio. Buen Fin, Hot Sale y las quincenas (días 15 y 30) llevan el pico a <b>≈ 2,000 por segundo</b>. Ticket promedio ≈ US$30: ≈ US$9 B al mes. Fraude: ≈ 0.12 % del valor (≈ US$11 M al mes en contracargos) y ≈ 0.08 % de las transacciones por conteo."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "La autorización completa tarda ≈ 1–2 s. El chequeo de fraude tiene <b>p99 ≤ 100 ms</b>, medido desde el orquestador de pagos, y una disponibilidad de <b>99.99 %</b>. Si se cae o no contesta a tiempo, los pagos no se pueden bloquear todos: hay que decidir con reglas de respaldo."
      },
      {
        "topic": "Modelo actual",
        "a": "No hay modelo. Hay un motor de <b>≈ 400 reglas</b> escritas a mano y una blocklist que se recalcula cada noche. Hoy las reglas rechazan ≈ 1.0 % de las transacciones y mandan ≈ 1.5 % a 3-D Secure. La meta es bajar las pérdidas por fraude ≈ 40 % <b>sin subir la tasa de rechazo de clientes buenos</b>."
      },
      {
        "topic": "Datos y labels",
        "a": "El label es el <b>contracargo por fraude</b>: las ventanas de disputa llegan a ≈ 120 días; ≈ 60 % llega en 30 días y ≈ 90 % en 60. Señales más tempranas: reportes de fraude del emisor, fraude confirmado por el comercio y resultados de la revisión manual. Un pago rechazado nunca recibe label. Hay ≈ 2 años de transacciones y contracargos en el data lake."
      },
      {
        "topic": "Restricciones",
        "a": "La tarjeta llega tokenizada: el sistema de fraude no ve el número (PCI DSS). Datos personales bajo la LFPDPPP en México (GDPR o leyes de EE. UU. donde aplique). Cada decisión debe guardar <b>reason codes</b>; al comprador no se le dice el motivo exacto. Costo de un error: un fraude aprobado ≈ monto + US$15; un pago bueno rechazado, ≈ US$5–10 (lo fija el negocio). Sin presupuesto fijo de infraestructura."
      }
    ],
    c10: [
      {
        "topic": "Usuarios y quién llama",
        "a": "El <b>marketplace del c01</b> (Latinoamérica). Tres productos internos llaman hoy a la API de un proveedor de LLMs: el <b>asistente de soporte</b> (chat con compradores y vendedores, en streaming), el <b>asistente de publicaciones</b> (redacta título y descripción a partir de los atributos de las fotos y las notas del vendedor, en streaming) y el <b>enriquecimiento del catálogo</b> (extrae atributos en JSON, batch nocturno). Más adelante se sumaría un asistente de empleados con documentos internos. Cada equipo de producto es dueño de sus prompts."
      },
      {
        "topic": "Entrada y salida",
        "a": "Formato de chat compatible con OpenAI. Interactivo: ≈ <b>2,000 tokens de entrada</b> de promedio (system prompt, políticas, historial y contexto), de los que ≈ <b>la mitad es un prefijo fijo por producto</b>, y ≈ <b>250 de salida</b>; el p99 de entrada es ≈ 5,000 y ningún prompt pasa de ≈ 6k. Batch: ≈ <b>800 de entrada y ≈ 150 de salida</b>, un <b>JSON con esquema</b> de atributos por categoría. Publicaciones devuelve un JSON chico (título y descripción)."
      },
      {
        "topic": "Escala",
        "a": "Interactivo: ≈ <b>1.5 M requests al día</b> (soporte ≈ 1.0 M, unas 200k conversaciones de ≈ 5 turnos; publicaciones ≈ 0.5 M), con el pico a media mañana en ≈ <b>3× el promedio</b>. Batch: ≈ <b>2 M ítems por noche</b> (publicaciones nuevas o editadas). El uso crece ≈ <b>10 % al mes</b>."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "Soporte y publicaciones muestran el texto mientras se genera: la primera palabra en <b>p95 ≤ 1.0 s</b> y después ≈ 20 tokens por segundo (<b>p95 ≤ 50 ms entre tokens</b>). La plataforma debe tener <b>99.9 %</b> de disponibilidad. El batch entra a las 22:00 y tiene que estar listo a las <b>06:00</b>."
      },
      {
        "topic": "Modelo actual",
        "a": "Un <b>modelo propietario de gama media</b> de un proveedor externo, a precio de lista de ≈ <b>US$2.50 por millón de tokens de entrada y US$10 por millón de salida</b>; el catálogo usa su API batch (−50 %). Factura ≈ <b>US$442k/mes</b>; nadie revisó si tiene descuento por prompt caching. Razones para cambiar: la factura, datos personales que salen y poco control (deprecaciones, rate limits, latencia variable). El modelo del proveedor es mejor en benchmarks generales; nadie sabe si uno abierto alcanza por producto. No se necesita fine-tuning."
      },
      {
        "topic": "Datos y labels",
        "a": "No hay golden sets todavía. Existen conversaciones de soporte históricas y publicaciones con sus atributos, y personas de soporte y del equipo de catálogo podrían calificar respuestas. Soporte lleva <b>datos personales</b> (nombres, direcciones, teléfonos, pedidos); publicaciones, poco; el catálogo es texto público. Legal pide que los datos de soporte <b>dejen de salir</b> de la empresa y que no se guarden prompts sin necesidad (México, LFPDPPP)."
      },
      {
        "topic": "Restricciones",
        "a": "AWS <b>us-east-1</b>, con el <b>EKS del c01</b> (tres zonas), Prometheus, Grafana y S3. No hay GPUs grandes: hay que pedir cuota de instancias P y no hay garantía de conseguir H100 on-demand. Sin presupuesto cerrado: finanzas quiere el costo mensual con las personas incluidas y nada de compromisos de 3 años al arrancar. Opera un equipo de plataforma de ≈ <b>3 personas</b> con guardia. Publicaciones puede seguir usando al proveedor con redacción de datos personales; soporte no."
      }
    ],
    c13: [
      {
        "topic": "Usuarios y quién llama",
        "a": "Una plataforma de videollamadas con usuarios en <b>Latinoamérica y EE. UU.</b> quiere <b>subtítulos en vivo</b> en llamadas y reuniones. Los ven todos los participantes mientras la gente habla, con el nombre de quien habla. El anfitrión puede activar “guardar transcripción”. Cada participante elige su idioma (por defecto, el de su organización). Traducción, resúmenes y diarización de audio mezclado quedan fuera del alcance."
      },
      {
        "topic": "Entrada y salida",
        "a": "El media server (<b>SFU</b>, WebRTC) recibe <b>una pista Opus por participante</b> (48 kHz, frames de 20 ms) y puede mandar una copia a un servicio interno. Salida: texto por hablante, <b>parcial</b> mientras habla y <b>final</b> con puntuación al terminar la frase, entregado por la <b>señalización WebSocket</b> que cada cliente ya tiene abierta. Dispositivos: laptops, celulares, salas de juntas; algunos participantes por teléfono (8 kHz)."
      },
      {
        "topic": "Escala",
        "a": "≈ <b>2 M de reuniones al día</b>, de <b>40 min</b> en promedio, con ≈ <b>4 participantes</b>; se espera que ≈ <b>30 %</b> active subtítulos. Casi todo pasa en horario laboral y el pico es ≈ <b>3× el promedio</b>. En cada momento hablan en promedio ≈ <b>1.2 personas por reunión</b>. Hay webinars de cientos de asistentes, casi todos en mute."
      },
      {
        "topic": "Latencia y disponibilidad",
        "a": "Parciales en <b>p95 ≤ 500 ms</b> desde que se dice la palabra hasta que se ve en pantalla; el <b>final en p95 ≤ 1.5 s</b> después de que la persona deja de hablar. Los subtítulos son un extra: si fallan, <b>la reunión no puede verse afectada</b>, y un aviso de “subtítulos no disponibles” es aceptable. Si se cae un componente, los subtítulos deberían volver solos en un par de segundos."
      },
      {
        "topic": "Modelo actual",
        "a": "Hoy <b>no hay nada</b>: el producto quiere saber si conviene una <b>API gestionada</b> de speech-to-text o algo propio. Hay reuniones que mezclan español e inglés, y organizaciones con nombres de productos y siglas propias que les gustaría que se reconocieran."
      },
      {
        "topic": "Datos y labels",
        "a": "El <b>audio no se guarda</b>, y no se puede entrenar con audio de clientes sin <b>consentimiento explícito</b>. No hay audio etiquetado propio. Legal aceptaría un programa de opt-in por organización y comprar corpus o grabaciones con consentimiento. Idiomas al lanzar: <b>español</b> (México y Latinoamérica), <b>inglés</b> (EE. UU.) y <b>portugués</b> (Brasil)."
      },
      {
        "topic": "Restricciones",
        "a": "Ya existen <b>Kubernetes en AWS con nodos GPU</b> (hay L4), Prometheus y Kafka. Todo corre en <b>una sola región de AWS (us-east-1, tres zonas)</b>, también los media servers, para todos los usuarios. Las transcripciones guardadas se retienen ≈ <b>30 días</b> (configurable por organización), y hay un indicador visible de “subtítulos activados”. Hay clientes en México (LFPDPPP), Brasil, EE. UU. y algunos en la Unión Europea. El presupuesto no tiene un número cerrado."
      }
    ],
  };
  cases.forEach((c) => { if (FACTS[c.id]) c.facts = FACTS[c.id]; });

  // ------------------------------------------------------------------ ensamblado
  const items = {};
  modules.forEach((m) => { items[m.id] = Object.assign({ kind: 'module', part: 1 }, m); });
  cases.forEach((c) => { items[c.id] = Object.assign({ kind: 'case', part: 2 }, c); });
  specials.forEach((s) => { items[s.id] = Object.assign({ kind: 'special' }, s); });

  MSD.defineCatalog({
    version: 1,
    items,
    roadmap,
    flashcards: [],   // cada página trae las suyas
    glossary: [],     // cada página trae los suyos
  });
})(typeof window !== 'undefined' ? window : globalThis);
