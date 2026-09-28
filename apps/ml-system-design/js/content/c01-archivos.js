/* =============================================================================
   Ronda de Diseño ML — js/content/c01-archivos.js
   Caso 01, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c01/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por capa, con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección del caso y módulo del curso.
  const C = (sec, txt) => '<a href="#c01.' + sec + '">' + txt + '</a>';
  const M = (n, txt) => '<a href="#m' + String(n).padStart(2, '0') + '">' + txt + '</a>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c01/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c01/' + path, note });

  MSD.addSection('c01', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos reales de <code>reference/c01/</code>, los que llevarías a un repo. Cada línea importante trae un comentario con el <b>porqué</b>, que es lo que un entrevistador quiere oír cuando pregunta “¿y cómo lo desplegarías?”. No los memorices: úsalos para que tu diseño aterrice en decisiones concretas (qué probe, qué timeout, qué métrica, qué alerta) cuando te lleven a un deep dive.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (macOS, Python 3.13, sin GPU): los 21 tests del gateway con pytest; el gateway real con uvicorn y el cliente real <code>tritonclient.http.aio</code> contra un servidor KServe v2 falso (200, 415, 413, 400, 503 y 504 a los ≈ 150 ms); el preprocesamiento contra torchvision (idéntico bit a bit sin draft mode); el export a ONNX y el gate de paridad con ONNX Runtime (512 imágenes: top-1 100 %, máx |Δlogit| 8e-5); el parseo de <code>config.pbtxt</code> con el protobuf <code>ModelConfig</code> de Triton; <code>docker compose config</code>; los manifests contra el esquema de Kubernetes 1.33 y 1.36; la sintaxis PromQL de las alertas.</li>' +
          '<li><b>No ejecutado</b>: no se construyeron imágenes ni se levantó un Triton real, <code>trtexec</code> no corrió (necesita la T4), las alertas no pasaron por <code>promtool</code>, el ScaledObject de KEDA no se validó contra su CRD y nada se aplicó a un cluster. El <code>README.md</code> de <code>reference/c01</code> tiene la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>main.py</code> <small>gateway/app</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas'), 'Validación en capas, decode en threadpool acotado, timeout → 504, Triton caído → 503, métricas y una línea de log por request'],
          ['<code>preprocess.py</code> <small>gateway/app</small>', C('datos', '6 · Datos') + ', ' + C('evaluacion', '8 · Evaluación'), 'Un solo preprocesamiento para training, eval y serving (anti-skew)'],
          ['<code>test_api.py</code> <small>gateway/tests</small>', C('fallas', '10 · Fallas'), 'Cada código de error probado sin GPU'],
          ['<code>Dockerfile</code>, <code>requirements.txt</code> <small>gateway</small>', C('serving', '7 · Serving') + ', ' + M(5, 'M5'), 'Multi-stage, no root, 1 proceso por contenedor, dependencias fijadas'],
          ['<code>export_onnx.py</code>, <code>parity_check.py</code> <small>model</small>', C('datos', '6 · Datos') + ', ' + C('evaluacion', '8 · Evaluación'), 'La paridad con PyTorch como gate de CI antes del registry'],
          ['<code>build_engine.sh</code> <small>model</small>', C('serving', '7 · Serving') + ', ' + M(8, 'M8'), 'Engine TensorRT atado a la GPU y a la versión de TensorRT'],
          ['<code>config.pbtxt</code>, <code>Dockerfile</code> <small>triton</small>', C('serving', '7 · Serving'), 'Dynamic batching, política de cola, warmup, imagen horneada'],
          ['<code>docker-compose.yml</code>, <code>prometheus.yml</code> <small>raíz, monitoring</small>', C('arquitectura', '5 · Arquitectura'), 'El sistema completo en una máquina con GPU'],
          ['<code>alerts.yml</code> <small>monitoring</small>', C('monitoreo', '9 · Monitoreo'), 'Las 6 alertas con su PromQL, severidad y runbook'],
          ['<code>triton.yaml</code>, <code>gateway.yaml</code>, <code>keda-triton.yaml</code> <small>k8s</small>', C('fallas', '10 · Fallas') + ', ' + C('costo', '12 · Costo') + ', ' + M(6, 'M6'), 'Probes, drenado, zonas, autoscaling por CPU (gateway) y por cola (Triton)'],
        ],
        note: 'Orden de lectura sugerido: <code>preprocess.py</code> → <code>main.py</code> → <code>test_api.py</code> → export, paridad y engine → Triton → compose y alertas → Kubernetes. Es el mismo orden en que el request y el modelo recorren el sistema.' },

      // ------------------------------------------------------------------ gateway
      { t: 'h3', text: 'Gateway (FastAPI, CPU)' },
      { t: 'code', title: 'Gateway: validación, preprocesamiento y llamada a Triton',
        caption: 'Los tests corren sin GPU: <code>cd gateway &amp;&amp; pip install -r requirements-dev.txt &amp;&amp; pytest</code>. También están <code>app/labels.json</code> (500 categorías), <code>requirements-dev.txt</code> y <code>pytest.ini</code>.',
        files: [
          F('gateway/app/main.py', 'python', 'Lee primero <code>_classify</code>: validación barata (415/413) → decode en threadpool acotado (400/413) → Triton con <code>asyncio.wait_for</code> (503/504). Hallazgo verificado: en <code>tritonclient</code> el parámetro <code>timeout</code> de <code>infer()</code> es un timeout de la cola de Triton en µs, no del cliente; por eso el presupuesto se impone con <code>wait_for</code>.'),
          F('gateway/app/preprocess.py', 'python', 'Si te llevas un solo archivo, que sea este: el mismo código en training, eval y serving. Se midió contra torchvision: idéntico sin draft mode; el draft mode agresivo cambiaba la entrada de forma medible y por eso el que queda es conservador.'),
          F('gateway/tests/test_api.py', 'python', 'El Triton falso respeta el contrato del cliente real (métodos async y sus excepciones), y el test revisa nombre, dtype y shape del tensor que viajaría a Triton: si alguien rompe el contrato con <code>config.pbtxt</code>, falla aquí y no en producción.'),
          F('gateway/requirements.txt', 'text', 'Cada paquete fijado con <code>==</code>, transitivas incluidas: el mismo commit produce la misma imagen. Pillow debe ser la misma versión que en training porque el resize depende de ella.'),
          F('gateway/Dockerfile', 'dockerfile', 'Multi-stage sin compiladores, usuario no root con UID numérico, <code>--workers 1</code> (escalas con réplicas) y <code>--timeout-keep-alive 75</code>, mayor que el idle timeout del ALB, para evitar 502 esporádicos.'),
          F('gateway/.dockerignore', 'text', 'Contexto de build chico y sin secretos: tests, venvs, imágenes y modelos quedan fuera.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: un async def que bloquea el event loop',
        html: 'FastAPI corre las rutas <code>async def</code> en el event loop. Si ahí decodificas un JPEG sin <code>run_in_threadpool</code>, cada decode frena a todos los requests del proceso, health checks incluidos: el p99 sube con la concurrencia aunque la CPU no esté llena. En <code>main.py</code> el I/O va con <code>await</code> y la CPU va al threadpool, con un semáforo que acota cuántos decodes corren a la vez (sin él, 40 hilos decodificando fotos grandes en un pod de 1 CPU terminan en OOMKilled).' },
      { t: 'callout', kind: 'trap', title: 'Trampa: confundir readiness con liveness',
        html: '<code>/healthz</code> (liveness) solo dice si el proceso responde y no mira a Triton; <code>/readyz</code> (readiness) da 200 solo si el modelo está listo en Triton. Si pones la dependencia en liveness, una caída de Triton hace que el kubelet reinicie en cascada gateways sanos, que no arreglan nada y hacen más lenta la recuperación. En Triton es igual: readiness en <code>/v2/health/ready</code>, liveness en <code>/v2/health/live</code> y un <code>startupProbe</code> para que la carga del engine no parezca un proceso colgado.' },

      // ------------------------------------------------------------------ modelo
      { t: 'h3', text: 'Modelo: export, paridad y engine' },
      { t: 'code', title: 'Del checkpoint de PyTorch al engine de TensorRT',
        caption: 'Flujo: <code>export_onnx.py</code> → <code>parity_check.py</code> (ORT, CPU) → <code>build_engine.sh</code> (en la T4) → <code>parity_check.py --backend triton</code> (FP16 contra FP32).',
        files: [
          F('model/export_onnx.py', 'python', 'Exporta en <code>eval()</code> con batch dinámico y no deja pasar el artefacto sin tres chequeos: <code>onnx.checker</code>, que el opset del archivo sea el pedido, y que ONNX Runtime coincida con PyTorch en batch 1 y 32 (medido: máx |Δlogit| ≈ 1e-4).'),
          F('model/parity_check.py', 'python', 'El gate de CI: compara top-1, top-5 y logits contra PyTorch FP32 usando el <b>mismo</b> preprocesamiento del gateway, y sale con código 1 si el acuerdo top-1 baja de 99.5 %. Con ONNX Runtime dio 100 % en 512 imágenes; contra un backend roto, 0 % y exit 1.'),
          F('model/build_engine.sh', 'bash', 'Corre <code>trtexec --fp16</code> dentro de <code>tensorrt:24.08</code>, el mismo TensorRT que trae <code>tritonserver:24.08</code>, y se niega a correr si la GPU no es una T4. Solo pasó <code>bash -n</code>: sin GPU no se ejecutó.'),
          F('model/requirements.txt', 'text', 'torch fijado a propósito: el exportador cambia entre versiones (ver la nota del opset).'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: un engine de TensorRT no es portable',
        html: 'El <code>.plan</code> queda atado a la arquitectura de la GPU (T4 = sm_75) y a la versión exacta de TensorRT. Compilarlo en tu laptop con otra GPU, o con una imagen de TensorRT distinta a la de Triton, produce un engine que no carga o que corre con kernels elegidos para otro hardware. Por eso <code>build_engine.sh</code> corre en la T4, con el mismo YY.MM de NGC que <code>triton/Dockerfile</code>, y registra los sha256 del ONNX y del engine para el model registry.' },
      { t: 'callout', kind: 'note', title: 'Verificado: la trampa del opset con el exportador nuevo',
        html: 'Desde PyTorch 2.9, <code>torch.onnx.export</code> usa por defecto el exportador basado en <code>torch.export</code> (<code>dynamo=True</code>). Con torch 2.14 y ResNet-50, pedirle opset 17 hace que exporte en 18, intente convertir hacia abajo, la conversión falle en <code>ReduceMean</code> y el archivo quede en <b>opset 18</b> sin que el export falle. <code>export_onnx.py</code> usa el exportador TorchScript (<code>dynamo=False</code>, opset 17 limpio) y su verificación compara el opset real del archivo: la trampa no pasa desapercibida. Plan de migración: <code>--dynamo --opset 18</code>, que también pasa la verificación.' },

      // ------------------------------------------------------------------ triton
      { t: 'h3', text: 'Triton' },
      { t: 'code', title: 'Configuración del modelo e imagen de Triton',
        caption: '<code>model.plan</code> no se versiona en git: lo genera <code>build_engine.sh</code> y el build de la imagen falla si falta.',
        files: [
          F('triton/model_repository/classifier/config.pbtxt', 'pbtxt', 'Contrato con el gateway (<code>input</code> FP32 [3,224,224] → <code>logits</code> [500]), dynamic batching de 2 ms sin <code>preferred_batch_size</code>, cola que rechaza a los 100 ms, 2 instancias por GPU y warmup antes de marcar READY. Validado parseándolo con el protobuf <code>ModelConfig</code>.'),
          F('triton/Dockerfile', 'dockerfile', 'Modelo horneado en la imagen: el tag es la versión del modelo y el rollback es cambiar un tag. Comentada la alternativa de leer el model repository desde S3.'),
        ] },
      { t: 'callout', kind: 'senior', title: 'Rechazar en la cola es una decisión de diseño',
        html: 'Con <code>default_queue_policy</code> en REJECT a los 100 ms, cuando la GPU se satura Triton descarta requests que ya no iban a cumplir (el gateway corta a los 150 ms) en vez de procesarlos para nadie. Bajo sobrecarga ves 503/504 rápidos y el fallback manual del formulario, no una cola que crece hasta que <b>todos</b> los requests superan el timeout. Explicarlo así suena a alguien que ya operó un sistema saturado.' },

      // ------------------------------------------------------------------ local
      { t: 'h3', text: 'Local: docker compose' },
      { t: 'code', title: 'Todo el sistema en una máquina con GPU',
        files: [
          F('docker-compose.yml', 'yaml', 'Gateway + Triton con reserva de GPU (<code>deploy.resources.reservations.devices</code>) + Prometheus. <code>depends_on</code> con <code>service_healthy</code> evita los 503 del arranque mientras Triton carga el engine. Validado con <code>docker compose config</code>; levantarlo requiere GPU NVIDIA y NVIDIA Container Toolkit.'),
          F('monitoring/prometheus.yml', 'yaml', 'Solo para local: en Kubernetes el scrape lo declaran ServiceMonitors del Prometheus Operator. Lo que se reutiliza tal cual es <code>alerts.yml</code>.'),
        ] },

      // ------------------------------------------------------------------ k8s
      { t: 'h3', text: 'Kubernetes (EKS)' },
      { t: 'code', title: 'Manifests de producción',
        caption: 'Orden: <code>kubectl create namespace classifier</code> y luego <code>kubectl apply -f k8s/triton.yaml -f k8s/keda-triton.yaml -f k8s/gateway.yaml</code>. Requiere NVIDIA device plugin, AWS Load Balancer Controller, KEDA y Prometheus con kube-state-metrics.',
        files: [
          F('k8s/triton.yaml', 'yaml', 'Nodos T4 por <code>nodeSelector</code> más la toleration del taint, una réplica por zona (<code>DoNotSchedule</code>), <code>startupProbe</code> para la carga del engine, <code>preStop</code> para drenar, PDB <code>minAvailable: 1</code> y sin <code>replicas</code> (las maneja KEDA).'),
          F('k8s/gateway.yaml', 'yaml', 'HPA por CPU al 60 % (3–12), request de CPU sin límite, <code>readOnlyRootFilesystem</code>, ALB con <code>target-type: ip</code>, drenado de 30 s y solo <code>/v1/classify</code> expuesto (ni <code>/metrics</code> ni los health checks salen del cluster).'),
          F('k8s/keda-triton.yaml', 'yaml', 'Escala Triton por el tiempo medio en cola (métrica de Triton, no CPU) con <code>metricType: Value</code> para que la respuesta sea proporcional; sube rápido y baja despacio. Validado solo como YAML: el CRD de KEDA no está en el esquema de Kubernetes.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: gRPC detrás de un Service de Kubernetes',
        html: 'Un Service ClusterIP balancea por <b>conexión</b> (L4). HTTP/1.1 con un pool de conexiones reparte razonablemente; gRPC abre una sola conexión HTTP/2 y multiplexa cada request por ella, así que cada gateway queda pegado a un solo pod de Triton y la otra GPU se queda ociosa. Si eliges gRPC por rendimiento, necesitas balanceo L7 (un service mesh como Linkerd o Istio) o balanceo del lado del cliente con un Service headless. La alerta GPUSaturated es por GPU, sin agregar, justamente para ver ese desbalance.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: límites de CPU que causan throttling',
        html: 'Con <code>limits.cpu</code>, el kernel (CFS) le da al contenedor una cuota por ventana de 100 ms. Una ráfaga de decodes gasta la cuota a mitad de la ventana y el pod queda congelado el resto: el p99 salta aunque el uso promedio esté en 40 %. Por eso el gateway pide CPU (<code>requests</code>, que además es la base del HPA) pero no la limita. La memoria sí se limita, igual al request: pasarse es un OOMKilled claro, no una lentitud misteriosa.' },

      // ------------------------------------------------------------------ alertas
      { t: 'h3', text: 'Alertas' },
      { t: 'code', title: 'Reglas de Prometheus',
        files: [
          F('monitoring/alerts.yml', 'yaml', 'Una regla de grabación (fracción de predicciones con top-1 &lt; 0.3) y las 6 alertas de la ' + C('monitoreo', 'sección 9') + ' con severidad page, warning o ticket y su runbook. Sintaxis PromQL revisada con un parser; no se corrió <code>promtool</code>. El drift de negocio (PSI de categorías, tasa de aceptación) sale de un job batch diario, no de Prometheus.'),
        ] },
      { t: 'callout', kind: 'senior', title: 'Di dónde está ciego tu monitoreo',
        html: 'Si Triton cae, todos los gateways quedan NotReady, el ALB se queda sin targets y responde 503 él mismo: esos errores nunca llegan a <code>classifier_requests_total</code> y la alerta de 5xx no se entera. Por eso existe una alerta directa sobre Triton (TritonNotReady) y conviene alertar también sobre <code>HTTPCode_ELB_5XX_Count</code> del ALB en CloudWatch. Señalar el punto ciego de tus propias métricas es una de las cosas que más distingue a un senior.' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Tests del gateway (sin GPU)', meta: '≈ 2 min',
          html: '<code>cd reference/c01/gateway</code>, crea un venv con Python 3.13, <code>pip install -r requirements-dev.txt</code> y corre <code>pytest</code>: 21 tests con un Triton falso (200 con <code>top_k</code>, 415, 413 por bytes y por píxeles, 400, 422, 503, 504, health checks y métricas).' },
        { title: 'Gateway suelto, sin Triton (sin GPU)', meta: '≈ 1 min',
          html: '<code>uvicorn app.main:app --port 8080</code> desde <code>gateway/</code>: <code>/healthz</code> responde 200 y <code>/readyz</code> y <code>/v1/classify</code> responden 503 con <code>Retry-After</code>. Es exactamente la degradación que diseñaste: el formulario cae al selector manual.' },
        { title: 'Export y gate de paridad (sin GPU)', meta: '≈ 2 min en CPU',
          html: '<code>pip install -r model/requirements.txt</code>, luego <code>python model/export_onnx.py --out model/classifier.onnx</code> (sin <code>--checkpoint</code> usa pesos aleatorios reproducibles) y <code>python model/parity_check.py --onnx model/classifier.onnx --n 512</code>. Con tu checkpoint real y <code>--images</code> apuntando a una muestra del set de eval, es el gate de CI.' },
        { title: 'Engine TensorRT (necesita una T4)', meta: 'g4dn.xlarge',
          html: 'En una instancia con T4, Docker y NVIDIA Container Toolkit: <code>bash model/build_engine.sh</code>. Deja <code>triton/model_repository/classifier/1/model.plan</code>. En otra GPU solo sirve para pruebas locales (<code>EXPECTED_GPU=…</code>); para producción se recompila en la T4.' },
        { title: 'Sistema completo con docker compose (necesita GPU NVIDIA)', meta: '≈ 5 min',
          html: '<code>docker compose up --build</code> desde <code>reference/c01</code> y luego <code>curl -H "Content-Type: image/jpeg" --data-binary @foto.jpg "localhost:8080/v1/classify?top_k=5"</code>. Prometheus en <code>localhost:9090/alerts</code> muestra las 6 alertas.' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“The gateway is a stateless FastAPI service, one process per container, scaled on CPU. Triton serves a TensorRT FP16 engine built on the same GPU type and TensorRT version we serve on, baked into an immutable image, so a rollback is just a tag change. A parity check against the PyTorch model gates every release, and we alert on p99 latency, 5xx rate, Triton queue time and a shift in prediction confidence.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo profundiza un módulo: ' + M(5, 'M5 Contenedores') + ' (Dockerfiles), ' + M(6, 'M6 Orquestación') + ' (probes, HPA, KEDA, GPUs en Kubernetes), ' + M(7, 'M7 Servidores de modelos') + ' (Triton), ' + M(8, 'M8 Optimización') + ' (ONNX, TensorRT, paridad), ' + M(9, 'M9 Datos') + ' (training-serving skew) y ' + M(12, 'M12 Monitoreo') + ' (alertas).' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
