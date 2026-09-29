/* =============================================================================
   Ronda de Diseño ML — js/content/m07-servidores.js
   Módulo 07: servidores de modelos. Qué hace un model server y qué se queda en el
   gateway, FastAPI + PyTorch, Triton, Ray Serve y BentoML, TorchServe/KServe y
   endpoints administrados, servidores de LLMs (vLLM, SGLang, TGI, TensorRT-LLM,
   Dynamo), protocolos (REST, gRPC, KServe v2, OpenAI-compatible) y la tabla de
   cuándo elegir cada uno.
   Contrato: docs/SPEC.md §5. Los números y valores del caso 1 son los de
   c01-clasificacion.js y reference/c01: si cambian allá, se cambian aquí.
   Verificado (sept. 2026) contra los repos y la documentación oficial: Triton 2.72
   (NGC 26.08), vLLM 0.30, SGLang 0.5.20, TensorRT-LLM 1.2.1 (1.3 en rc), Dynamo 1.5, KServe 0.21,
   Ray 2.58, BentoML 1.4.39; estado de TorchServe y TGI con la API de GitHub.
   El snippet de FastAPI corrió con TestClient (FastAPI 0.141, torch 2.14, CPU); el de
   Ray Serve, con Ray 2.58 en local; los pbtxt se parsearon con el ModelConfig de
   tritonclient 2.72. Las mediciones de CPU son de una laptop (Apple M4): solo orden
   de magnitud.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // El corte de c01. Carril online (y 0–19) a la izquierda y monitoreo a la derecha;
  // carril offline abajo (y 22–40). Columnas x = 2, 26, 56, 87 con huecos de 8–9 unidades
  // para las etiquetas; el model repository queda justo debajo de Triton (arista vertical).
  const CORTE = {
    width: 108, height: 40,
    lanes: [
      { id: 'online', label: 'Online · cada request', x: 0, y: 0, w: 82, h: 19, kind: 'online' },
      { id: 'monitor', label: 'Monitoreo', x: 84, y: 0, w: 24, h: 19, kind: 'monitor' },
      { id: 'offline', label: 'Offline · cada versión del modelo', x: 0, y: 22, w: 108, h: 18, kind: 'offline' },
    ],
    nodes: [
      { id: 'caller', label: 'Callers', sub: 'backend y otros equipos', x: 2, y: 7, w: 16, h: 8, kind: 'client',
        note: 'El backend de publicación del marketplace y otros equipos internos. No saben qué servidor corre el modelo: solo conocen el contrato <code>POST /v1/classify</code>. Si no hay respuesta en 300 ms, la UI muestra el selector manual de categoría.' },
      { id: 'gw', label: 'Gateway FastAPI', sub: 'CPU: auth, decode, top-k', x: 26, y: 7, w: 22, h: 8, kind: 'service',
        note: 'Todo lo que sabe del producto y de quién llama: identidad y cuota del caller, validación de bytes no confiables (tipo, 10 MB, 40 MP), decode y preprocesamiento (el mismo paquete del entrenamiento), softmax y top-k con los labels, <code>model_version</code> en la respuesta, log de predicción y la decisión de devolver 503/504 para que el caller caiga al fallback. Escala por CPU con el HPA.' },
      { id: 'ms', label: 'Model server', sub: 'Triton · T4 · batching', x: 56, y: 7, w: 22, h: 8, kind: 'gpu',
        note: 'Convierte tensores en tensores lo más barato posible: tiene el engine cargado en la GPU, encola los requests por modelo, arma batches (ventana de 2 ms, hasta 32), reparte entre dos instancias y rechaza lo que pasó 100 ms en cola. No sabe qué es un vendedor ni una categoría. Escala por tiempo en cola con KEDA.' },
      { id: 'prom', label: 'Prometheus', sub: 'cola vs cómputo', x: 87, y: 7, w: 18, h: 8, kind: 'monitor',
        note: 'Lee las métricas de Triton en el puerto 8002 (tiempo en cola y de cómputo por modelo, uso de GPU) y las del gateway en <code>/metrics</code>. Separar cola de cómputo es lo que te dice si falta GPU o si el modelo se volvió lento.' },
      { id: 'reg', label: 'Registry', sub: 'champion / challenger', x: 2, y: 28, w: 16, h: 8, kind: 'store',
        note: 'El registry de modelos (MLflow en c01) guarda cada versión con su linaje y sus métricas offline. Un alias dice cuál es el champion que sirve producción. Se ve en <a href="#m10">M10</a>.' },
      { id: 'ci', label: 'Build en CI', sub: 'ONNX → engine en T4', x: 26, y: 28, w: 22, h: 8, kind: 'job',
        note: 'Exporta el checkpoint a ONNX, construye el engine de TensorRT en una T4 con la misma release de NGC que sirve y corre el parity test contra PyTorch. El engine no es portable entre GPUs ni entre versiones de TensorRT (<a href="#m08.tensorrt">M8</a>).' },
      { id: 'repo', label: 'Model repository', sub: 'engine + config.pbtxt', x: 56, y: 28, w: 22, h: 8, kind: 'store',
        note: 'La carpeta que lee Triton: una subcarpeta por modelo con su <code>config.pbtxt</code> y una por versión con el engine. En c01 va horneada dentro de la imagen de Triton, así que el tag de la imagen es la versión del modelo (<a href="#m05.pesos-modelo">M5</a>).' },
    ],
    edges: [
      { from: 'caller', to: 'gw', kind: 'online', label: 'HTTPS' },
      { from: 'gw', to: 'ms', kind: 'online', label: 'tensor' },
      { from: 'ms', to: 'prom', kind: 'monitor', label: 'scrape' },
      { from: 'reg', to: 'ci', kind: 'offline', label: 'versión' },
      { from: 'ci', to: 'repo', kind: 'offline', label: 'engine' },
      { from: 'repo', to: 'ms', kind: 'offline', fromSide: 't', toSide: 'b', label: 'al arrancar' },
    ],
    flows: [
      { id: 'request', label: 'Un request de c01', steps: [
        { nodes: ['caller', 'gw'], edges: ['caller>gw'], text: 'Llegan los bytes de la foto. El gateway ya sabe quién llama (JWT verificado en el ALB), aplica la cuota de ese caller y valida tipo y tamaño: un 400, 413 o 415 sale sin tocar la GPU.' },
        { nodes: ['gw'], edges: [], text: 'Decodifica, redimensiona y normaliza en su threadpool (' + E('≈ 6 ms') + ' de CPU en promedio), con el mismo paquete de preprocesamiento que usó el entrenamiento.' },
        { nodes: ['gw', 'ms'], edges: ['gw>ms'], text: 'Manda el tensor de 602 KB por HTTP (protocolo KServe v2 con la extensión binaria) con un timeout de 150 ms. Triton lo encola, lo junta con los requests que lleguen en 2 ms y lo corre en una de sus dos instancias.' },
        { nodes: ['gw'], edges: [], text: 'Vuelven 500 logits. El gateway calcula softmax y top-5, agrega <code>model_version</code> y escribe una línea de log. Si Triton no respondió a tiempo, devuelve 503 o 504 y el caller muestra el selector manual.' },
        { nodes: ['ms', 'prom'], edges: ['ms>prom'], text: 'Prometheus lee de Triton el tiempo en cola y el de cómputo del modelo. Con la cola escala KEDA; con las dos juntas distingues "falta GPU" de "el modelo se volvió lento".' },
      ] },
      { id: 'version', label: 'Sale un modelo nuevo', steps: [
        { nodes: ['reg', 'ci'], edges: ['reg>ci'], text: 'El registry marca un challenger. CI exporta a ONNX, construye el engine en una T4 y corre el parity test.' },
        { nodes: ['ci', 'repo'], edges: ['ci>repo'], text: 'El engine y su <code>config.pbtxt</code> forman el model repository, que en c01 se hornea en una imagen nueva de Triton.' },
        { nodes: ['repo', 'ms'], edges: ['repo>ms'], text: 'El pod nuevo carga el modelo al arrancar, hace el warmup y recién entonces pasa la readiness. El gateway no cambió: el contrato <code>/v1</code> sigue igual y solo cambia el <code>model_version</code> que devuelve la release nueva.' },
      ] },
    ],
  };

  // Dentro de un pod de Triton. Carril CPU (x 0–64) y carril GPU (x 66–100), ambos y 0–36;
  // abajo, el model repository (offline) y las métricas (monitor), y 38–50. La carga del
  // repository sube por x = 30 entre carriles (y 36.5) para no cruzar el nodo del gateway.
  const TRITON = {
    width: 100, height: 50,
    lanes: [
      { id: 'cpu', label: 'Proceso tritonserver (CPU del pod)', x: 0, y: 0, w: 64, h: 36, kind: 'neutral' },
      { id: 'gpu', label: 'GPU T4', x: 66, y: 0, w: 34, h: 36, kind: 'online' },
      { id: 'modelos', label: 'Modelos', x: 0, y: 38, w: 40, h: 12, kind: 'offline' },
      { id: 'metricas', label: 'Métricas', x: 42, y: 38, w: 58, h: 12, kind: 'monitor' },
    ],
    nodes: [
      { id: 'gw', label: 'Gateway', sub: 'cliente aio', x: 2, y: 15, w: 14, h: 8, kind: 'client',
        note: 'El gateway de c01 con <code>tritonclient.http.aio</code>: un cliente por proceso con un pool de conexiones keep-alive.' },
      { id: 'fe', label: 'Frontends', sub: ':8000 HTTP · :8001 gRPC', x: 22, y: 15, w: 16, h: 8, kind: 'service',
        note: 'Reciben el request por HTTP/REST o gRPC (los dos hablan el protocolo KServe v2), deserializan los tensores y los entregan al scheduler del modelo que se pidió. También sirven <code>/v2/health/live</code> y <code>/v2/health/ready</code>.' },
      { id: 'q1', label: 'Cola classifier', sub: '≤ 32 · espera 2 ms', x: 44, y: 6, w: 18, h: 8, kind: 'queue',
        note: 'Cada modelo tiene su propio scheduler. El del classifier es el dynamic batcher de c01: saca un batch cuando junta 32 requests o cuando el primero lleva 2 ms esperando, y rechaza lo que pasa 100 ms en cola.' },
      { id: 'q2', label: 'Cola detector', sub: 'su propio batcher', x: 44, y: 24, w: 18, h: 8, kind: 'queue',
        note: 'Un segundo modelo (por ejemplo, el detector de otro equipo en ONNX) con su cola, su ventana y su tamaño de batch. Nunca se mezcla en un batch con el classifier: comparten el proceso y la GPU, no la cola.' },
      { id: 'i1', label: 'Instancia 1', sub: 'engine TensorRT FP16', x: 70, y: 5, w: 26, h: 7, kind: 'gpu',
        note: 'Una instancia es un contexto de ejecución del modelo en la GPU, con su propia memoria de activaciones. <code>instance_group [ { count: 2, kind: KIND_GPU } ]</code> crea dos.' },
      { id: 'i2', label: 'Instancia 2', sub: 'engine TensorRT FP16', x: 70, y: 14, w: 26, h: 7, kind: 'gpu',
        note: 'La segunda instancia del mismo engine: mientras una calcula, la otra copia el siguiente batch o devuelve resultados. Más de dos rara vez ayuda en una T4 con un modelo; se decide midiendo con <code>model_analyzer</code>.' },
      { id: 'i3', label: 'Instancia detector', sub: 'ONNX Runtime (CUDA)', x: 70, y: 25, w: 26, h: 7, kind: 'gpu',
        note: 'Otro backend en la misma GPU. Triton no aísla el cómputo entre modelos: si el detector corre batches pesados, sube el tiempo de cómputo del classifier. Las palancas: el rate limiter de Triton (si lo activas, reparte la ejecución entre instancias con prioridades) o darle al vecino su propia GPU.' },
      { id: 'repo', label: 'Model repository', sub: '/models · versiones', x: 2, y: 42, w: 20, h: 7, kind: 'store',
        note: 'Directorio local, S3, GCS o Azure con una carpeta por modelo y una subcarpeta numerada por versión. El modo de control (none, poll o explicit) decide cuándo Triton lo vuelve a leer.' },
      { id: 'met', label: 'Métricas :8002', sub: 'cola, cómputo, GPU', x: 71, y: 42, w: 24, h: 7, kind: 'monitor',
        note: 'Por modelo: <code>nv_inference_queue_duration_us</code> (tiempo acumulado en cola), <code>nv_inference_compute_infer_duration_us</code> (en cómputo), <code>nv_inference_pending_request_count</code>, <code>nv_inference_count</code> y <code>nv_inference_exec_count</code>. Por GPU: utilización y memoria usada.' },
    ],
    edges: [
      { from: 'gw', to: 'fe', kind: 'online', label: 'HTTP' },
      { from: 'fe', to: 'q1', kind: 'online' },
      { from: 'fe', to: 'q2', kind: 'online' },
      { from: 'q1', to: 'i1', kind: 'online' },
      { from: 'q1', to: 'i2', kind: 'online' },
      { from: 'q2', to: 'i3', kind: 'online' },
      { from: 'repo', to: 'fe', kind: 'offline', fromSide: 't', toSide: 'b', via: [[12, 36.5], [30, 36.5]], label: 'carga' },
      { from: 'i3', to: 'met', kind: 'monitor', fromSide: 'b', toSide: 't', label: 'tiempos' },
    ],
    flows: [
      { id: 'c01', label: 'Un request de c01', steps: [
        { nodes: ['gw', 'fe'], edges: ['gw>fe'], text: 'El gateway manda un tensor <code>[1, 3, 224, 224]</code> en FP32 como bytes crudos detrás de un header JSON corto (extensión binaria). El frontend no parsea 150,528 números en texto.' },
        { nodes: ['fe', 'q1'], edges: ['fe>q1'], text: 'El request entra a la cola del classifier. Espera a lo sumo 2 ms a que lleguen compañeros; si en un pico pasara 100 ms en cola, Triton lo rechaza en vez de gastar GPU en una respuesta que nadie va a leer.' },
        { nodes: ['q1', 'i1', 'i2'], edges: ['q1>i1', 'q1>i2'], text: 'El batcher manda el batch más grande que pudo armar (a la carga de c01, ' + E('≈ 1–3') + ' requests) a la instancia libre.' },
        { nodes: ['met'], edges: [], text: 'Cada request deja su tiempo en cola y su tiempo de cómputo en las métricas del modelo. Con la cola escala KEDA (<a href="#m06.keda">M6</a>); con las dos diagnosticas un p99 alto.' },
      ] },
      { id: 'dos-modelos', label: 'Dos modelos en la misma GPU', steps: [
        { nodes: ['fe', 'q2'], edges: ['fe>q2'], text: 'Otro equipo agrega su detector en ONNX al mismo Triton, porque la T4 de c01 trabaja en promedio al ≈ 5 % de su capacidad. Tiene su propia cola y su propio batcher.' },
        { nodes: ['q2', 'i3'], edges: ['q2>i3'], text: 'Su instancia corre en la misma GPU. Las colas están separadas; el cómputo y la VRAM, no.' },
        { nodes: ['i3', 'met'], edges: ['i3>met'], text: 'Si el p99 del classifier sube sin que suba su tráfico y su tiempo de cómputo crece, busca al vecino. Palancas: el rate limiter de Triton, otra GPU, o MIG en las GPUs que lo tienen (la T4 no; <a href="#m04.compartir-gpu">M4</a>).' },
      ] },
      { id: 'carga', label: 'Cargar una versión nueva', steps: [
        { nodes: ['repo', 'fe'], edges: ['repo>fe'], text: 'En modo <code>none</code> (c01), Triton lee el repository solo al arrancar: una versión nueva es una imagen nueva y un rollout. En modo <code>explicit</code>, un controlador pide <code>load</code> y <code>unload</code> por la API del repository sin reiniciar el proceso.' },
        { nodes: ['q1', 'i1', 'i2'], edges: [], text: 'Con <code>version_policy</code> <code>specific</code> pueden quedar cargadas dos versiones del classifier. Cada una ocupa su VRAM y el cliente elige <code>/v2/models/classifier/versions/N/infer</code>.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  // Corrió con TestClient (torch 2.14, CPU): 200 con 5 predicciones.
  const FASTAPI_MIN = `import io, os
from contextlib import asynccontextmanager
import torch
from fastapi import FastAPI, Request
from PIL import Image
from starlette.concurrency import run_in_threadpool
from torchvision.models import resnet50
from torchvision.transforms import v2 as T

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
TF = T.Compose([T.ToImage(), T.Resize(256), T.CenterCrop(224), T.ToDtype(torch.float32, scale=True),
                T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])  # el MISMO del training

def predict(model, img):                        # bloqueante: corre en un thread del pool
    x = TF(img.convert("RGB")).unsqueeze(0).to(DEVICE)  # convert() decodifica el JPEG: CPU
    with torch.inference_mode():                # aquí adentro: el modo de autograd es por thread
        scores, ids = model(x).softmax(-1).topk(5)
    return [{"id": int(i), "score": round(float(s), 4)} for s, i in zip(scores[0], ids[0])]

@asynccontextmanager
async def lifespan(app: FastAPI):               # una vez por proceso, antes de recibir tráfico
    model = resnet50(num_classes=500)
    model.load_state_dict(torch.load(os.environ["WEIGHTS"], map_location="cpu", weights_only=True))
    app.state.model = model.eval().to(DEVICE)   # eval(): BatchNorm y Dropout en modo inferencia
    predict(app.state.model, Image.new("RGB", (256, 256)))  # warmup: el 1.er request no paga el arranque
    yield
app = FastAPI(lifespan=lifespan)

@app.post("/v1/classify")
async def classify(request: Request):
    body = await request.body()                 # I/O: await; el loop sigue atendiendo a otros requests
    img = Image.open(io.BytesIO(body))          # solo lee el header; validar tipo y tamaño: ver c01
    return {"predictions": await run_in_threadpool(predict, request.app.state.model, img)}`;

  const REPO_TREE = `/models
├── classifier/
│   ├── config.pbtxt       # nombre, backend, shapes, batching, instancias, versiones
│   ├── 1/model.plan       # versión 1: engine de TensorRT (atado a la GPU y a TensorRT)
│   └── 2/model.plan       # versión 2: se carga solo si version_policy la incluye
└── detector/
    ├── config.pbtxt       # otro modelo, otro backend (ONNX Runtime)
    └── 1/model.onnx`;

  const C01_CONFIG = `name: "classifier"
platform: "tensorrt_plan"
max_batch_size: 32
version_policy: { latest: { num_versions: 1 } }
input [ { name: "input", data_type: TYPE_FP32, dims: [ 3, 224, 224 ] } ]
output [ { name: "logits", data_type: TYPE_FP32, dims: [ 500 ] } ]
dynamic_batching {
  max_queue_delay_microseconds: 2000
  default_queue_policy { timeout_action: REJECT, default_timeout_microseconds: 100000 }
}
instance_group [ { count: 2, kind: KIND_GPU } ]
model_warmup [ { name: "warmup_max_batch", batch_size: 32, count: 3,
  inputs { key: "input", value: { data_type: TYPE_FP32, dims: [ 3, 224, 224 ], zero_data: true } } } ]`;

  const ENSEMBLE = `# /models/pipeline/config.pbtxt: el DAG completo como un solo modelo que llama el cliente
name: "pipeline"
platform: "ensemble"           # no ejecuta nada: encadena otros modelos del repository
max_batch_size: 32
input [ { name: "IMAGE", data_type: TYPE_UINT8, dims: [ -1 ] } ]  # bytes del JPEG, largo variable
output [ { name: "LOGITS", data_type: TYPE_FP32, dims: [ 500 ] } ]
ensemble_scheduling {
  step [
    {
      model_name: "preprocess"   # Python backend: decode + resize + normalize (CPU del nodo GPU)
      model_version: -1          # -1 = la versión más reciente cargada
      input_map { key: "RAW" value: "IMAGE" }           # key: tensor del paso; value: tensor del ensemble
      output_map { key: "TENSOR" value: "preprocessed" }
    },
    {
      model_name: "classifier"   # el engine de c01, con su propia cola y su dynamic batching
      model_version: -1
      input_map { key: "input" value: "preprocessed" }  # el tensor intermedio no sale de Triton
      output_map { key: "logits" value: "LOGITS" }
    }
  ]
}`;

  // Corrió con Ray 2.58 en local (modelos de juguete): los 5 crops llegaron al Classifier en un batch de 5.
  const RAY_PIPE = `import asyncio
from ray import serve
from ray.serve.handle import DeploymentHandle
from starlette.requests import Request

@serve.deployment(ray_actor_options={"num_gpus": 0.5},  # 2 réplicas por GPU: contabilidad, no aísla VRAM
                  max_ongoing_requests=48,              # ≥ max_batch_size: con el default (5), batches de 5
                  autoscaling_config={"min_replicas": 1, "max_replicas": 4, "target_ongoing_requests": 32})
class Classifier:
    def __init__(self):
        self.model = load_classifier()                  # una vez por réplica
    @serve.batch(max_batch_size=32, batch_wait_timeout_s=0.002)  # dynamic batching, en Python
    async def __call__(self, crops: list) -> list:      # recibe una lista y devuelve otra del mismo largo
        return await asyncio.to_thread(self.model, crops)  # GPU fuera del event loop de la réplica

@serve.deployment(ray_actor_options={"num_gpus": 0.5})
class Detector:
    def __init__(self, classifier: DeploymentHandle):
        self.model = load_detector()
        self.classifier = classifier                    # handle a otra deployment: la composición
    async def __call__(self, request: Request) -> dict:
        crops = await asyncio.to_thread(self.model, await request.body())
        labels = await asyncio.gather(*[self.classifier.remote(c) for c in crops])  # fan-out
        return {"objects": labels}                      # cada crop entró al batch del Classifier

app = Detector.bind(Classifier.bind())                  # el grafo; se despliega con: serve run pipeline:app`;

  const PERF_PROTO = `# El mismo modelo y los mismos datos en tres formatos: la diferencia se mide, no se supone
perf_analyzer -m classifier -u triton:8000 -i http \\
  --input-data tensores_reales.json --concurrency-range 8 --percentile=99   # HTTP + binario (default)
perf_analyzer -m classifier -u triton:8000 -i http --input-tensor-format json \\
  --input-data tensores_reales.json --concurrency-range 8 --percentile=99   # HTTP + JSON
perf_analyzer -m classifier -u triton:8001 -i grpc \\
  --input-data tensores_reales.json --concurrency-range 8 --percentile=99   # gRPC`;

  const SSE_REQ = `# Pedir la respuesta en streaming (-N: curl no bufferiza la salida)
curl -N http://llm.internal:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model": "mi-modelo", "stream": true, "max_tokens": 200,
       "messages": [{"role": "user", "content": "Resume esta publicación"}]}'`;

  const SSE_RESP = `Content-Type: text/event-stream

data: {"object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": "Celular"}}], ...}

data: {"object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": " usado"}}], ...}

data: [DONE]`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm07',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'que-hace',
        title: 'Qué hace un model server (y qué no)',
        titleEn: 'What a model server does, and what it doesn\'t',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `En el <a href="#c01">caso 1</a> hay dos procesos entre el balanceador y la GPU: un <b>gateway</b> en FastAPI, en nodos de CPU, y un <b>Triton</b> en la T4. El segundo es el model server: tiene el modelo cargado y convierte tensores de entrada en tensores de salida lo más barato posible. No sabe qué es un vendedor, una categoría ni un caller con cuota, a propósito. Dónde pones esa línea es lo primero que evalúa el entrevistador cuando dices "lo sirvo con Triton".` },
          { t: 'table', caption: 'Lo que resuelve un model server', head: ['Responsabilidad', 'Qué significa', 'En c01 (Triton)'], rows: [
            ['Cargar modelos y versiones', 'Leer artefactos de un repositorio, cargarlos en el dispositivo, tener una o varias versiones listas', 'Un engine de TensorRT horneado en la imagen; solo la versión más reciente'],
            ['Concurrencia y colas', 'Aceptar muchos requests, encolarlos por modelo y descartar los que ya no llegan a tiempo', 'Cola con timeout de 100 ms y rechazo (REJECT)'],
            ['Batching', 'Juntar requests de clientes distintos en un batch (dynamic batching, <a href="#m03.batching">M3</a>)', 'Ventana de 2 ms, hasta 32'],
            ['Ubicación en el hardware', 'Qué GPU, cuántas instancias del modelo por GPU, CPU o GPU', '2 instancias en la T4'],
            ['Protocolos', 'HTTP/REST y gRPC con un contrato estándar para tensores', 'KServe v2: HTTP en 8000 (el que usa el gateway), gRPC en 8001'],
            ['Salud y métricas', 'Liveness y readiness por servidor y por modelo; tiempos de cola y de cómputo', '<code>/v2/health/ready</code>; métricas en 8002'],
            ['Varios modelos', 'Varios modelos en el mismo proceso y la misma GPU, cada uno con su cola', 'Uno hoy; espacio para los de otros equipos (la GPU trabaja al ≈ 5 % en promedio)'],
          ] },
          { t: 'table', caption: 'Lo que se queda en tu gateway o en tu aplicación', head: ['Responsabilidad', 'Por qué no va en el model server', 'En c01 (gateway)'], rows: [
            ['Identidad, cuotas y prioridad por caller', 'No conoce identidades de negocio; exponerlo a los callers es superficie de ataque', 'JWT de servicio verificado en el ALB; token bucket por caller'],
            ['Reglas del producto', 'Umbrales, top-k, mapeo de id a categoría y filtros cambian con el producto, no con el modelo', 'Softmax, top-k y labels en el gateway'],
            ['Política de preprocesamiento', 'Es CPU y parsea bytes hostiles: mejor aislarlo de la GPU cara (y ver <a href="#m07.protocolos">sección 7</a>)', 'Pillow con límites de 10 MB y 40 MP; el mismo paquete que el entrenamiento'],
            ['Fallbacks y degradación', 'Qué pasa si el modelo no responde es una decisión de producto', '503 o 504 → la UI muestra el selector manual'],
            ['Contrato público y su versión', 'El contrato vive más que cualquier modelo', '<code>POST /v1/classify</code> con <code>model_version</code> en la respuesta'],
            ['Log de predicciones con contexto', 'Request_id, caller y brazo del A/B no existen en el model server', 'Una línea JSON por request'],
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué existe el corte', html: `<p><b>Escalan con recursos distintos</b>: el gateway se satura de CPU y escala con un HPA por CPU; Triton se satura de GPU y escala por tiempo en cola (<a href="#m06.hpa">M6</a>). En un solo proceso, más CPU obligaría a comprar más GPU. <b>Cambian a ritmos distintos</b>: la lógica del producto, cada semana; el engine, cada mes, con un build en GPU y un parity test. <b>Aislamiento</b>: un JPEG malicioso tumba un pod barato, no el que tiene la GPU. <b>Reemplazo</b>: cambiar Triton por otro servidor que hable el mismo protocolo no toca a ningún caller.</p>` },
          { t: 'diagram', id: 'gateway-y-model-server', title: 'El corte de c01: gateway en CPU, model server en GPU', caption: 'Arriba, el camino de cada request; abajo, cómo llega una versión nueva del modelo al servidor. Toca cada caja para ver qué hace y recorre los dos flujos.', spec: CORTE },
          { t: 'callout', kind: 'trap', title: 'Reglas de negocio dentro del model server', html: `<p>Poner el umbral de confianza o el mapeo a categorías dentro de un Python backend de Triton (o del handler de TorchServe) parece cómodo, hasta que cambiar un umbral exige una imagen nueva del servidor de GPU, con su cold start de minutos. La otra mitad de la trampa: exponer el model server a los callers. Triton y TorchServe tienen APIs para cargar y descargar modelos; en TorchServe, la de administración fue la puerta de ShellTorch (CVE-2023-43654, CVSS 9.8). El model server vive detrás del gateway, con una NetworkPolicy que solo deja entrar a los pods del gateway (<a href="#c01.serving">c01</a>).</p>` },
          { t: 'callout', kind: 'senior', html: `<p>El corte también cuesta, y decirlo es señal senior: un salto de red con 602 KB por request (≈ 2.4 Gb/s a 500 req/s, 3× el JPEG del celular), ruteo por zona obligatorio y un componente más que operar (<a href="#c01.estimaciones">estimaciones de c01</a>). Con un modelo en CPU a pocas decenas de req/s, un solo servicio basta. Con video o imágenes médicas, donde el tensor pesa mucho más que la entrada, se evalúa poner los dos en el mismo pod (<a href="#c01.tradeoffs">trade-offs de c01</a>).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"The model server only turns tensors into tensors: it loads the model versions, batches requests, places them on the GPU and exposes health and metrics. Anything that knows about callers or the product, like auth, quotas, top-k and fallbacks, stays in the gateway, and that split lets each tier scale on its own signal."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El model server ya apareció como una caja en el mapa de <a href="#m01">M1</a> y en el patrón síncrono de <a href="#m02.online-sincrona">M2</a>. Su batching y su capacidad se calculan en <a href="#m03.batching">M3</a>; cómo se empaqueta, en <a href="#m05">M5</a>; cómo escala cada tier, en <a href="#m06.hpa">M6</a>. Cómo se abarata el modelo que carga (ONNX, TensorRT, cuantización) es <a href="#m08">M8</a>.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'fastapi',
        title: 'FastAPI + PyTorch: el punto de partida',
        titleEn: 'FastAPI + PyTorch: the starting point',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Es lo que harías con tu notebook de ResNet: envuelves <code>model(x)</code> en un endpoint HTTP. Y muchas veces está bien. El MVP de c01 es exactamente eso (<a href="#c01.arquitectura">arquitectura de c01</a>): una VM g4dn, un proceso, PyTorch eager en batch 1, con un feature flag para el 10 % de los vendedores (${E('≈ 35 req/s')} en el pico). Responde en 2–3 semanas la pregunta que importa primero: si los vendedores aceptan las sugerencias.` },
          { t: 'table', caption: 'Cuándo FastAPI + PyTorch alcanza', head: ['Situación', 'Por qué alcanza'], rows: [
            ['MVP o validación de producto', 'Días de trabajo, un solo servicio que se entiende y se depura con un debugger'],
            ['QPS bajo con un modelo chico', 'Si un proceso con batch 1 cubre el pico con holgura, el batching no tiene material con qué trabajar'],
            ['Modelos en CPU (árboles, ONNX Runtime, INT8)', 'En CPU el batching rinde mucho menos que en GPU (<a href="#m03.batching">M3</a>): no hay un acelerador que llenar'],
            ['Prototipos, demos, herramientas internas', 'Nadie paga el costo de operar un servidor más'],
            ['Lógica en Python muy acoplada al modelo', 'Cambia seguido y vive junto al modelo: separarlo agrega una frontera sin beneficio'],
          ] },
          { t: 'h3', text: 'Un servicio mínimo que no tiene errores de principiante' },
          { t: 'code', title: 'FastAPI + PyTorch, versión mínima correcta', caption: 'Probado con FastAPI 0.141, Starlette 1.7 y torch 2.14 en CPU usando <code>TestClient</code>: responde 200 con 5 predicciones. La versión de producción (validación de bytes, límites, deadline, métricas, logs) es el gateway de c01, en <a href="#c01.archivos">sus archivos de referencia</a>.', files: [
            { name: 'app.py', lang: 'python', code: FASTAPI_MIN },
          ] },
          { t: 'list', items: [
            '<b>Carga en el <code>lifespan</code>, no por request.</b> Una vez por proceso, antes de aceptar tráfico; el warmup evita que la primera inferencia real pague la inicialización, y la readiness pasa recién después (<a href="#m06.objetos-basicos">M6</a>).',
            '<b><code>eval()</code> e <code>inference_mode()</code>.</b> Sin el primero, BatchNorm usa las estadísticas del batch; sin el segundo, autograd guarda activaciones para un backward que nunca llega.',
            '<b>El trabajo pesado va al threadpool.</b> Leer el body es I/O (<code>await</code>); decodificar e inferir va a <code>run_in_threadpool</code>, y el event loop sigue atendiendo requests y health checks. También sirve declarar el endpoint con <code>def</code>: FastAPI lo corre en su threadpool.',
          ] },
          { t: 'callout', kind: 'trap', title: 'inference_mode alrededor del await no hace nada', html: `<p>El modo de autograd de PyTorch es <b>por thread</b>. Con <code>with torch.inference_mode(): await run_in_threadpool(predict, …)</code>, el modo queda activo en el thread del event loop, no en el del pool donde corre el modelo. Lo medimos con este snippet: <code>torch.is_inference_mode_enabled()</code> da <code>True</code> en el loop y <code>False</code> en el thread del pool, y la salida sale con <code>requires_grad=True</code>. Funciona, pero guarda el grafo de cada inferencia. El <code>with</code> (o el decorador <code>@torch.inference_mode()</code>) va dentro de la función que corre en el thread.</p>` },
          { t: 'callout', kind: 'trap', title: 'async def con el modelo adentro', html: `<p>La trampa de <a href="#c01.serving">c01</a>: un <code>async def</code> que llama <code>model(x)</code> o decodifica un JPEG bloquea el event loop mientras dura ese trabajo; ningún otro request avanza, ni siquiera <code>/healthz</code>. Síntoma: un p99 que crece con la concurrencia sin que la CPU esté llena.</p>` },
          { t: 'h3', text: 'Dónde se rompe' },
          { t: 'table', head: ['Qué se rompe', 'Por qué', 'Cómo se ve'], rows: [
            ['Throughput en GPU', 'Cada request es un batch de 1. Varios threads no forman batches: por defecto sus kernels van al mismo stream de CUDA y se ejecutan en orden', `c01 estima ${E('del orden de 100 img/s')} por proceso con PyTorch eager en una T4, contra ${E('≈ 1,200 img/s')} de Triton con TensorRT FP16 y batching. El salto mezcla el engine (<a href="#m08">M8</a>) y el batching (<a href="#m03.batching">M3</a>)`],
            ['Una copia del modelo por worker', '<code>uvicorn --workers 4</code> son 4 procesos: 4 copias de los pesos y 4 contextos CUDA, sin batching entre ellos, turnándose la GPU', 'VRAM multiplicada (cálculo de abajo); con modelos grandes, ni siquiera caben dos'],
            ['El GIL en el código Python', 'Las ops de PyTorch sueltan el GIL, pero el pre y posprocesamiento en Python puro (loops sobre cajas, parseo, armar JSON grande) no: esa parte usa un core por proceso', 'CPU del proceso clavada en ≈ 100 % de un core con los demás libres'],
            ['Versiones y recarga', 'Cambiar de modelo es reiniciar el proceso; recargar en caliente lo escribes tú (lock, memoria para las dos versiones)', 'Cada deploy es un reinicio con cold start'],
            ['Observabilidad', 'Nada separa tiempo en cola de tiempo de cómputo si no lo instrumentas', 'Un p99 alto sin saber si falta GPU o el modelo es lento'],
          ], note: `En CPU, en cambio, varios threads sí escalan hasta llenar los cores, porque PyTorch suelta el GIL dentro de cada op. Medido con ResNet-50 FP32 en una laptop (Apple M4, 10 cores, 4 threads de PyTorch por llamada): 28 img/s con 1 thread, 77 con 8 y 82 con 16. Pasado el número de cores, más threads no suman. Solo orden de magnitud: mide en tu instancia.` },
          { t: 'calc', title: 'Copias del modelo con uvicorn --workers', rows: [
            { label: 'Pesos de ResNet-50 en FP32', expr: '25.6 M × 4 B', value: '≈ 102 MB' },
            { label: 'Contexto CUDA + librerías, por proceso', expr: 'estimación de <a href="#m04.vram">M4</a>', value: E('≈ 0.3–1 GB') },
            { label: '4 workers en una T4 de 16 GB', expr: '4 × (0.1 + 0.3 a 1 GB)', value: E('≈ 1.6–4.4 GB'), note: 'Cabe, pero son 4 procesos turnándose la GPU con batch 1' },
            { label: 'Pesos de Llama 3 8B en BF16', expr: '8.03 B × 2 B', value: '≈ 16.1 GB' },
            { label: '2 workers con ese modelo', expr: '2 × 16.06 GB', value: '≈ 32 GB', note: 'No entra en una L4 de 24 GB: ni dos copias de los pesos, sin contar KV cache' },
          ], result: 'Con un modelo de visión chico, los workers desperdician memoria pero caben; con un modelo grande, la única salida es un servidor que atienda la concurrencia con <b>una</b> copia del modelo y arme batches adentro.' },
          { t: 'h3', text: 'Construir tu propio dynamic batching' },
          { t: 'p', html: `Se puede: una <code>asyncio.Queue</code>, una tarea que espera hasta N requests o T milisegundos, un <code>torch.stack</code>, una llamada al modelo y un future por request. El esqueleto es corto; lo difícil son los bordes: un ítem corrupto no debe tumbar el batch de los demás, un cliente que ya canceló no debe ocupar lugar, la cola necesita un límite (backpressure), los shapes distintos no se apilan y sin métricas de cola y tamaño de batch no sabes si sirve. Ray Serve (<code>@serve.batch</code>) y BentoML (adaptive batching) son esto, ya escrito (<a href="#m07.ray-bento">sección 4</a>); Triton lo hace en C++, fuera del GIL.` },
          { t: 'table', caption: 'Qué tienes que construir tú', head: ['Capacidad', 'Con Triton', 'Con FastAPI + PyTorch'], rows: [
            ['Dynamic batching', 'Dos líneas de config', 'Cola, tarea, futures, timeouts, límites'],
            ['Varias instancias por GPU', '<code>instance_group</code>', 'Procesos (con su copia del modelo) o streams de CUDA a mano'],
            ['Versiones y recarga', '<code>version_policy</code> y modo de control', 'Redeploy, o recarga en caliente propia'],
            ['Cola vs cómputo', 'Métricas por modelo en el puerto 8002', 'Histogramas propios con <code>prometheus_client</code>'],
            ['Readiness por modelo', '<code>/v2/models/&lt;modelo&gt;/ready</code>', 'Un <code>/readyz</code> propio'],
            ['Timeout y prioridad en la cola', '<code>default_queue_policy</code>, <code>priority_levels</code>', 'Lo que escribas'],
            ['Protocolo estándar para tensores', 'KServe v2 por HTTP y gRPC', 'El JSON que diseñes'],
            ['Engine optimizado', 'Backends de TensorRT y ONNX Runtime', '<code>torch.compile</code> o TensorRT integrado a mano (<a href="#m08.torch-compile">M8</a>)'],
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Lo que puntúa no es "FastAPI no escala", sino decir cuándo alcanza, qué se rompe primero y qué haces entonces. En c01: se rompe primero por throughput (batch 1) y después por los deploys con reinicio; ahí la inferencia pasa a Triton y FastAPI se queda como gateway. No desaparece del diseño: cambia de trabajo.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For the MVP I'd serve the model straight from FastAPI and PyTorch: one process, the weights loaded once at startup, and inference in a thread pool so the event loop stays free. It breaks first on throughput, since every request runs at batch size one, and that's when I'd move inference to Triton and keep FastAPI as the gateway."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Un proceso por contenedor y por qué no <code>--workers</code> en Kubernetes: <a href="#c01.serving">serving de c01</a> y <a href="#m05">M5</a>. <code>torch.compile</code>, ONNX Runtime y la inferencia en CPU que a veces hace innecesario el model server: <a href="#m08.torch-compile">M8</a> y <a href="#m08.cpu-inferencia">su sección de CPU</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'triton',
        title: 'NVIDIA Triton Inference Server',
        titleEn: 'NVIDIA Triton Inference Server',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Triton es un servidor en C++ que carga modelos de un <b>model repository</b>, les da a cada uno su scheduler (cola y batching), los ejecuta con el <b>backend</b> que corresponde (TensorRT, ONNX Runtime, PyTorch, Python…) y expone todo por HTTP y gRPC con el protocolo KServe v2. c01 lo eligió por cuatro razones concretas: dynamic batching e instancias sin escribir concurrencia en Python, TensorRT como backend de primera clase, métricas de cola vs cómputo por modelo y espacio para alojar modelos de otros equipos en una GPU que trabaja al ≈ 5 % (<a href="#c01.serving">serving de c01</a>).` },
          { t: 'callout', kind: 'note', title: 'El nombre en 2026', html: `<p>Desde marzo de 2025 NVIDIA lo presenta como "NVIDIA Dynamo-Triton, formerly NVIDIA Triton Inference Server" y lo incluye con soporte comercial en NVIDIA AI Enterprise. El repositorio y el binario siguen siendo <code>tritonserver</code> (2.72 en la release 26.08), y en una entrevista todos dicen Triton. No lo confundas con <b>NVIDIA Dynamo</b>, una capa de orquestación distribuida para LLMs (<a href="#m07.llm-servers">sección 6</a>), ni con el lenguaje Triton de OpenAI para escribir kernels.</p>` },
          { t: 'kv', items: [
            ['Puertos', '8000 HTTP · 8001 gRPC · 8002 métricas', 'Los de c01; el gateway usa el 8000'],
            ['Salud', '/v2/health/live · /v2/health/ready', 'Por modelo: /v2/models/&lt;modelo&gt;/ready'],
            ['Versiones cargadas por defecto', 'latest, 1', 'Solo la versión con el número más alto'],
            ['Instancias por defecto (GPU)', '1 por GPU visible', 'c01 pide 2 en su única T4'],
            ['Modo de control por defecto', 'none', 'Carga todo al arrancar y no vuelve a mirar el repository'],
            ['Imagen de NGC', E('≈ 9.2 GB comprimida'), 'La de c01 (24.08); pesa en el cold start (<a href="#m05.tamano">M5</a>)'],
          ] },
          { t: 'diagram', id: 'dentro-de-triton', title: 'Dentro de un pod de Triton', caption: 'Cada modelo tiene su cola y su batcher; las instancias corren en la GPU compartida. Recorre los tres flujos: un request de c01, dos modelos en la misma GPU y la carga de una versión nueva.', spec: TRITON },
          { t: 'h3', text: 'Model repository y versiones' },
          { t: 'code', title: 'Un model repository con dos modelos', files: [
            { name: 'estructura', lang: 'text', code: REPO_TREE },
          ] },
          { t: 'table', caption: 'version_policy: qué versiones del directorio se cargan', head: ['Política', 'Qué carga', 'Cuándo la usas'], rows: [
            ['<code>latest { num_versions: 1 }</code> (default)', 'La versión con el número más alto', 'c01: una versión por imagen; el rollback es volver al tag anterior'],
            ['<code>latest { num_versions: 2 }</code>', 'Las dos más altas', 'Probar la nueva mientras la anterior sigue cargada'],
            ['<code>specific { versions: [3, 4] }</code>', 'Exactamente esas', 'Un A/B o un shadow dentro del mismo Triton: el cliente elige <code>/versions/N</code>'],
            ['<code>all</code>', 'Todas las del directorio', 'Casi nunca: cada versión ocupa VRAM'],
          ] },
          { t: 'table', caption: 'Modo de control: cuándo Triton lee el repository', head: ['Modo', 'Qué hace', 'Cuándo'], rows: [
            ['<code>none</code> (default)', 'Carga todo al arrancar; ignora cambios en el repository; la API de carga responde con error', 'Imagen inmutable con el modelo horneado (c01): lo que probaste es lo que corre'],
            ['<code>poll</code>', 'Revisa el repository cada <code>--repository-poll-secs</code> y carga o descarga lo que cambió', 'Desarrollo. La documentación de Triton lo desaconseja en producción: puede leer un cambio a medio copiar'],
            ['<code>explicit</code>', 'Carga lo que indiques con <code>--load-model</code> y después lo que pidas por la API (<code>POST /v2/repository/models/&lt;modelo&gt;/load</code> y <code>/unload</code>)', 'Muchos modelos que entran y salen, con un controlador que decide qué está cargado'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Modelo en S3 + modo poll = deploy sin control', html: `<p>"Subo el engine nuevo a S3 y Triton lo toma solo" suena elegante y es un deploy sin canary, sin rollback trazable y con riesgo de que Triton lea un archivo a medio subir. Si el modelo vive fuera de la imagen, usa <code>explicit</code> y que el pipeline de despliegue pida la carga, con el mismo shadow y canary que cualquier release (<a href="#m11">M11</a>).</p>` },
          { t: 'h3', text: 'Backends: quién ejecuta cada modelo' },
          { t: 'table', head: ['Backend', 'En el config', 'Qué ejecuta', 'Cuándo'], rows: [
            ['TensorRT', '<code>platform: "tensorrt_plan"</code>', 'Un engine compilado para una GPU y una versión de TensorRT', 'Máximo rendimiento en NVIDIA; c01'],
            ['ONNX Runtime', '<code>platform: "onnxruntime_onnx"</code>', 'Un <code>.onnx</code>, en CPU o GPU', 'Portabilidad; el mismo artefacto en CPU y GPU'],
            ['PyTorch', '<code>pytorch_libtorch</code> (TorchScript); <code>torch_aoti</code> (AOTInductor, desde 26.03)', 'TorchScript o un paquete <code>.pt2</code> de <code>torch.export</code>', 'Modelos que no exportan bien a ONNX'],
            ['Python', '<code>backend: "python"</code>', 'Un <code>model.py</code>; cada instancia es un proceso aparte (esquiva el GIL)', 'Pre y posprocesamiento, BLS, lógica'],
            ['OpenVINO, DALI, FIL', 'su <code>backend</code>', 'CPU Intel; pipelines de datos en GPU (decode de JPEG); árboles (XGBoost, LightGBM)', 'Casos específicos'],
            ['vLLM, TensorRT-LLM', 'su <code>backend</code>', 'Motores de LLM dentro de Triton', 'Si tu plataforma ya es Triton (<a href="#m07.llm-servers">sección 6</a>)'],
          ], note: 'El backend de TensorFlow dejó de venir en los contenedores desde la release 25.03 (el último fue 25.02); hay que compilarlo aparte. Cada backend tiene su matriz de plataformas: no todos corren en todas.' },
          { t: 'h3', text: 'La configuración de c01, campo por campo' },
          { t: 'code', title: 'config.pbtxt de c01, sin comentarios', caption: 'Parseado contra el <code>ModelConfig</code> de tritonclient 2.72. La versión con cada línea comentada está en <a href="#c01.archivos">los archivos de c01</a>.', files: [
            { name: 'classifier/config.pbtxt', lang: 'pbtxt', code: C01_CONFIG },
          ] },
          { t: 'table', head: ['Campo', 'Qué decide', 'Si lo cambias'], rows: [
            ['<code>platform: "tensorrt_plan"</code>', 'El backend; el engine está atado a la T4 (sm_75) y a TensorRT 10.3', 'Otra GPU u otra release de NGC = reconstruir el engine (<a href="#m08.tensorrt">M8</a>)'],
            ['<code>max_batch_size: 32</code>', 'Techo del batch; <code>dims</code> va sin el eje de batch porque Triton antepone <code>-1</code>', 'Debe ser ≤ el máximo del perfil del engine (c01 los fija iguales)'],
            ['<code>max_queue_delay_microseconds: 2000</code>', 'La ventana del batcher', 'Se ajusta contra el SLO con perf_analyzer (<a href="#m03.batching">M3</a>)'],
            ['<code>default_queue_policy</code> REJECT a 100 ms', 'Descarta lo que ya no llega al timeout de 150 ms del gateway', 'Sin esto, en una sobrecarga la GPU calcula respuestas que nadie espera'],
            ['<code>instance_group</code> 2 × KIND_GPU', 'Dos contextos del engine en la misma GPU', 'Más instancias = más VRAM; decidirlo con <code>model_analyzer</code>'],
            ['<code>model_warmup</code>', 'Tres ejecuciones con batch 32 antes de marcar el modelo como listo', 'Sin warmup, los primeros requests pagan la inicialización y la readiness miente'],
          ] },
          { t: 'h3', text: 'Pipelines: ensembles y BLS' },
          { t: 'p', html: `Un <b>ensemble</b> es un modelo de Triton (<code>platform: "ensemble"</code>) que no ejecuta nada: declara un DAG fijo de otros modelos y cómo se conectan sus tensores. El cliente lo llama una vez; los tensores intermedios pasan de un paso a otro dentro de Triton, sin red ni serialización, y cada modelo del DAG conserva su cola y su dynamic batching (el ensemble no lleva <code>instance_group</code>). <b>BLS</b> (Business Logic Scripting) es un modelo del Python backend que llama a otros modelos desde su <code>model.py</code> (<code>exec</code> o <code>async_exec</code>), con <code>if</code> y loops: por ejemplo, una cascada donde el modelo grande solo corre si el chico duda.` },
          { t: 'code', title: 'Un ensemble: preprocesamiento + classifier', caption: 'Parseado contra el <code>ModelConfig</code> de tritonclient 2.72. <code>preprocess</code> sería un modelo del Python backend con su propio <code>config.pbtxt</code> y <code>model.py</code>.', files: [
            { name: 'pipeline/config.pbtxt', lang: 'pbtxt', code: ENSEMBLE },
          ] },
          { t: 'table', caption: 'Ensemble vs BLS', head: ['', 'Ensemble', 'BLS'], rows: [
            ['Control de flujo', 'DAG fijo: siempre los mismos pasos', '<code>if</code>, loops, decisiones según los datos'],
            ['Dónde vive la lógica', 'En el <code>config.pbtxt</code>', 'En un <code>model.py</code>'],
            ['Costo propio', 'Casi nada: lo agenda el núcleo en C++', 'Un proceso de Python por instancia, con su GIL'],
            ['Ejemplo', 'Preprocesar → clasificar → posprocesar', 'Cascada: modelo chico, y el grande solo si la confianza es baja (moderación, <a href="#c06">caso 6</a>)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'El ensemble no hace gratis el preprocesamiento', html: `<p>Mover el decode de c01 a un ensemble con Python backend elimina la red entre tiers (viajaría el JPEG, no el tensor), pero ese decode corre en la CPU del nodo GPU. c01 necesita ${E('≈ 3 cores')} de decode en el pico de diseño; la g4dn.xlarge tiene 4 vCPU y el pod de Triton ya pide 2. No entra, y para conseguir más CPU tendrías que comprar más GPU. La comparación completa está en la <a href="#m07.protocolos">sección 7</a>.</p>` },
          { t: 'h3', text: 'Métricas y herramientas' },
          { t: 'table', head: ['Métrica (puerto 8002)', 'Qué mide', 'Para qué la usas'], rows: [
            ['<code>nv_inference_queue_duration_us</code>', 'Tiempo acumulado en cola, por modelo', 'Dividida por <code>nv_inference_request_success</code>: espera promedio. Es la señal de escalado de c01'],
            ['<code>nv_inference_compute_infer_duration_us</code>', 'Tiempo acumulado de cómputo', 'Si sube sin que suba la cola: el modelo, el batch o la GPU cambió'],
            ['<code>nv_inference_pending_request_count</code>', 'Requests esperando al backend', 'Alternativa para escalar por requests en espera (<a href="#m06.hpa">M6</a>)'],
            ['<code>nv_inference_count</code> / <code>nv_inference_exec_count</code>', 'Inferencias y ejecuciones de batch', 'Su cociente es el batch promedio real'],
            ['<code>nv_gpu_utilization</code>, <code>nv_gpu_memory_used_bytes</code>', 'Uso y memoria de la GPU', 'Dashboards y capacidad; no para escalar'],
          ] },
          { t: 'p', html: `Dos herramientas vienen con el ecosistema. <code>perf_analyzer</code> genera carga (por concurrencia o por tasa) y reporta throughput y latencias por percentil (<a href="#m03.load-testing">M3</a>). <code>model_analyzer</code> barre configuraciones (instancias, max batch size, dynamic batching) y te dice cuál da más throughput bajo una restricción de latencia. Para LLMs, NVIDIA está deprecando GenAI-Perf en favor de AIPerf.` },
          { t: 'h3', text: 'Lo que te cuesta' },
          { t: 'list', items: [
            '<b>Superficie de configuración</b>: pbtxt, backends, modos de control, políticas de cola; cada campo tiene un porqué y un modo de fallar.',
            '<b>Versiones alineadas</b>: la release de NGC de Triton tiene que coincidir con la de TensorRT del engine; subir una obliga a reconstruir el otro.',
            `<b>Imagen pesada</b>: ${E('≈ 9.2 GB')} comprimida la de c01, el tramo más largo del cold start después del nodo (<a href="#m06.cold-starts">M6</a>). Se puede armar una imagen solo con los backends que usas.`,
            '<b>Un salto de red y un componente más</b> que depurar, con logs de un servidor en C++.',
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Di cuándo <b>no</b> usarías Triton: un modelo en CPU a pocas decenas de req/s (ONNX Runtime dentro del servicio basta); un LLM generativo, donde el trabajo lo hace un motor como vLLM (que Triton puede alojar, no reemplazar); o un equipo sin nadie que entienda su configuración a las 3 a. m.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Triton gives me dynamic batching, two model instances per GPU and per-model queue and compute metrics out of the box. The price is a big image, a config surface to learn, and an engine that has to match the GPU and the TensorRT version, so the engine is built in CI on the same GPU type we serve on."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>La ventana de batching y cómo ajustarla: <a href="#m03.batching">M3</a>. Cuánta VRAM ocupan las instancias y por qué la de c01 sobra: <a href="#m04.vram">M4</a>. Probes de Triton y escalado por tiempo en cola: <a href="#m06.hpa">M6</a>. Cómo se construye el engine y cómo se valida contra PyTorch: <a href="#m08.tensorrt">M8</a> y <a href="#m08.validar">su sección de validación</a>.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'ray-bento',
        title: 'Ray Serve y BentoML',
        titleEn: 'Ray Serve and BentoML',
        priority: 'extra',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Los dos son Python primero: una clase con un decorador te da réplicas, batching, autoscaling y un endpoint HTTP. <b>Ray Serve</b> corre sobre un cluster de Ray y brilla cuando el servicio es un grafo de varios modelos con lógica en Python entre ellos. <b>BentoML</b> empaqueta servicio, modelos y dependencias en un artefacto (un Bento) que se vuelve una imagen de contenedor, y brilla en la experiencia de desarrollo.` },
          { t: 'h3', text: 'Ray Serve' },
          { t: 'list', items: [
            '<b>Deployment</b>: una clase de Python con N réplicas (actores de Ray). Cada réplica carga su modelo una vez.',
            '<b>Composición</b>: una deployment recibe un <code>DeploymentHandle</code> a otra y la llama con <code>.remote()</code>: el pipeline es Python normal y cada modelo escala por separado.',
            '<b>Autoscaling por requests en curso</b>: <code>target_ongoing_requests</code> por réplica (default 2), con <code>max_ongoing_requests</code> como tope de requests por réplica (default 5) y <code>min_replicas: 0</code> si quieres escalar a cero.',
            '<b>GPUs fraccionales</b>: <code>ray_actor_options={"num_gpus": 0.5}</code> pone dos réplicas en una GPU.',
            '<b>Batching</b>: <code>@serve.batch(max_batch_size, batch_wait_timeout_s)</code>, por defecto 10 ítems y 10 ms: el dynamic batching, en Python.',
            '<b>En Kubernetes</b>, con KubeRay (recurso RayService, con upgrades sin corte). Para LLMs, Ray Serve LLM monta vLLM o SGLang con API compatible con OpenAI.',
          ] },
          { t: 'code', title: 'Detector → clasificador por recorte, en Ray Serve', caption: 'Corrió con Ray 2.58 en local, con modelos de juguete en lugar de <code>load_detector()</code> y <code>load_classifier()</code>: los 5 recortes de una imagen llegaron al Classifier en un solo batch de 5.', files: [
            { name: 'pipeline.py', lang: 'python', code: RAY_PIPE },
          ] },
          { t: 'callout', kind: 'trap', title: 'max_ongoing_requests le pone techo al batch', html: `<p>Una réplica no recibe más requests a la vez que <code>max_ongoing_requests</code> (default 5), así que <code>@serve.batch(max_batch_size=32)</code> nunca arma batches de más de 5. Lo medimos con Ray 2.58 y 64 requests concurrentes: con el default, trece batches de 5 o menos; con <code>max_ongoing_requests=48</code>, batches de 32, 16 y 16. Súbelo por encima del batch que quieres, y el <code>target_ongoing_requests</code> del autoscaling por debajo de ese techo.</p>` },
          { t: 'callout', kind: 'trap', title: 'num_gpus: 0.5 no parte la GPU', html: `<p>Es contabilidad del scheduler de Ray, no aislamiento. La documentación de Ray lo dice explícitamente: es responsabilidad del usuario que cada tarea no use más memoria de la que le toca. Si una réplica se come 14 de los 16 GB, la otra falla con out of memory de CUDA. Limita la memoria desde el framework, mide el pico real (<a href="#m04.vram">M4</a>) o usa MIG en las GPUs que lo tienen (<a href="#m04.compartir-gpu">M4</a>).</p>` },
          { t: 'h3', text: 'BentoML' },
          { t: 'list', items: [
            '<b>Servicio</b>: una clase con <code>@bentoml.service</code> (recursos, timeouts) y métodos con <code>@bentoml.api</code>. Un servicio puede depender de otro para componer modelos.',
            '<b>Adaptive batching</b>: <code>@bentoml.api(batchable=True, max_batch_size=…, max_latency_ms=…)</code>. El algoritmo ajusta la espera según el tráfico y el tiempo de proceso recientes, dentro de esos dos límites.',
            '<b>Empaquetado</b>: <code>bentoml build</code> junta código, modelos, dependencias y configuración en un Bento; <code>bentoml containerize</code> lo convierte en imagen OCI que despliegas donde quieras.',
            '<b>BentoCloud</b>: la plataforma administrada (también en tu propia nube) si no quieres operar la infraestructura.',
            '<b>Estado</b>: en febrero de 2026 la empresa BentoML pasó a ser parte de Modular. El proyecto sigue abierto bajo Apache 2.0.',
          ] },
          { t: 'table', caption: 'Ray Serve vs BentoML', head: ['', 'Ray Serve', 'BentoML'], rows: [
            ['Unidad', 'Deployment (actor de Ray con réplicas)', 'Servicio empaquetado en un Bento'],
            ['Composición', 'Handles entre deployments; grafos con fan-out en Python', 'Servicios que dependen de otros'],
            ['Batching', '<code>@serve.batch</code> (tamaño y espera fijos)', 'Adaptive batching (la espera se ajusta sola)'],
            ['Autoscaling', 'Propio, por requests en curso por réplica; el autoscaler de Ray agrega workers (pods, con KubeRay)', 'El de tu plataforma (HPA, KEDA) o BentoCloud'],
            ['Dónde corre', 'Un cluster de Ray (KubeRay en Kubernetes, o Anyscale)', 'Cualquier lugar que corra un contenedor'],
            ['Costo operativo', 'Medio-alto: operar Ray, con un head node que es punto único de falla salvo que actives la tolerancia a fallas del GCS con un Redis externo', 'Bajo-medio: es un contenedor más'],
            ['Brilla con', 'Pipelines de varios modelos, GPUs compartidas, equipos que ya usan Ray para datos o training', 'Equipos Python que quieren empaquetar y desplegar rápido, con la lógica junto al modelo'],
            ['Cuándo no', 'Un modelo simple detrás de un endpoint; un equipo sin experiencia en Ray', 'Máximo throughput por GPU con SLOs de pocos ms; una plataforma que ya estandarizó KServe y Triton'],
          ] },
          { t: 'callout', kind: 'why', title: 'El costo de Python en el camino', html: `<p>En Triton, la cola, el batching y la ejecución viven en C++. En Ray Serve y BentoML, cada request pasa por código Python en la réplica (y, según la configuración, en el proxy), con su GIL. Con un modelo pesado en GPU, ese overhead se pierde en el cómputo; con un modelo chico a miles de req/s por réplica, puede ser lo que manda. No hay un número universal: mídelo con tu modelo y tu carga. Y no es excluyente: Ray Serve o BentoML pueden orquestar la lógica y llamar a un Triton o a un vLLM para la parte pesada.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"If the pipeline is several models glued together with Python logic, like a detector feeding a classifier for each crop, I'd use Ray Serve: each model scales on its own and the glue stays in Python. The heaviest model can still run in Triton behind it."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Pipelines de varios modelos aparecen en OCR (detector de texto + reconocedor, <a href="#c05">caso 5</a>) y en video con múltiples cámaras (<a href="#c02">caso 2</a>). Ray Serve escala por requests en curso, la misma familia de señales que KEDA sobre Triton (<a href="#m06.hpa">M6</a>).</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'torchserve-kserve',
        title: 'TorchServe, KServe y endpoints administrados',
        titleEn: 'TorchServe, KServe and managed endpoints',
        priority: 'extra',
        dims: ['tradeoffs', 'arquitectura'],
        blocks: [
          { t: 'h3', text: 'TorchServe: qué ofrecía y en qué estado está' },
          { t: 'p', html: `TorchServe fue el servidor oficial de PyTorch, desarrollado por AWS y Meta: modelos empaquetados en archivos <code>.mar</code> (con <code>torch-model-archiver</code>), handlers en Python para pre y posprocesamiento, una API de inferencia (puerto 8080), una de administración para registrar modelos y cambiar workers (8081), métricas (8082) y batching con <code>batch_size</code> y <code>max_batch_delay</code>. Todavía lo vas a encontrar en producción.` },
          { t: 'kv', items: [
            ['Última release', 'v0.12.0 · 30-sep-2024', ''],
            ['Aviso "Limited Maintenance"', '28-feb-2025', 'Sin actualizaciones, arreglos, features nuevas ni parches de seguridad'],
            ['Repositorio archivado', '7-ago-2025', 'Solo lectura'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Proponer TorchServe para un sistema nuevo', html: `<p>En 2026 es adoptar a propósito un servidor sin parches de seguridad. Y el riesgo no es teórico: ShellTorch (CVE-2023-43654, CVSS 9.8) permitía ejecutar código remoto a través de la API de administración; se corrigió en la 0.8.2 porque el proyecto estaba vivo. Una vulnerabilidad nueva hoy se queda abierta.</p>` },
          { t: 'callout', kind: 'senior', title: 'Si la empresa del entrevistador lo usa', html: `<p>No propongas tirarlo mañana. Primero contienes el riesgo: API de administración solo en la red interna, autorización por token activada (viene así por defecto en las últimas versiones), sin descargas de modelos desde URLs arbitrarias, imagen fija y escaneada, todo detrás del gateway. Después migras modelo por modelo, empezando por los de más tráfico o más expuestos: el handler se parte en preprocesamiento (gateway o Python backend) y modelo (Triton con TorchScript, AOTInductor, ONNX o TensorRT; vLLM si es un LLM), cada uno con parity test, shadow y canary.</p>` },
          { t: 'h3', text: 'KServe: una capa de Kubernetes, no un servidor' },
          { t: 'p', html: `KServe define un recurso de Kubernetes, <b>InferenceService</b>, que despliega un model server (un <i>runtime</i>: Triton, el de Hugging Face con vLLM, MLServer o tu contenedor) y le agrega autoscaling, canary, ruteo y el protocolo de inferencia estándar. Tiene dos modos. En modo <b>Knative</b> escala por concurrencia (requests en vuelo por pod) y puede bajar a cero, con un canary que reparte un porcentaje del tráfico por request. En modo <b>Standard</b> (antes llamado RawDeployment) usa un Deployment normal con HPA o KEDA, sin Knative (<a href="#m06.hpa">M6</a>). Es proyecto en incubación de la CNCF (v0.21 en septiembre de 2026).` },
          { t: 'list', items: [
            '<b>Transformer</b>: un componente del InferenceService para pre y posprocesamiento, desplegado aparte del predictor y escalado por separado. Es el corte gateway / model server de c01, en versión nativa de KServe.',
            '<b>InferenceGraph</b>: encadena InferenceServices (secuencias, switch por condición, ensembles, reparto de tráfico).',
            '<b>LLMInferenceService</b>: el recurso más nuevo para LLMs, integrado con llm-d (<a href="#m07.llm-servers">sección 6</a>).',
          ] },
          { t: 'callout', kind: 'trap', title: '"¿KServe o Triton?"', html: `<p>Es una falsa disyuntiva: KServe puede desplegar Triton como runtime. La pregunta real es si tu plataforma quiere un recurso estándar de Kubernetes para cientos de modelos de muchos equipos (KServe arriba, Triton o vLLM abajo) o si escribes tus propios Deployments, como c01. Con pocos modelos y un equipo que ya domina Kubernetes, lo segundo es menos piezas.</p>` },
          { t: 'callout', kind: 'note', title: 'Seldon Core y su licencia', html: `<p>Seldon Core (la v2 arma pipelines de modelos sobre Kafka, con MLServer o Triton como runtimes) cambió de licencia: desde el 22 de enero de 2024, las versiones nuevas de Core 1 y Core 2 salen con Business Source License 1.1, que exige licencia comercial para producción (salvo instituciones educativas sin fines de lucro); cada versión pasa a Apache 2.0 a los cuatro años. MLServer siguió en Apache 2.0. Si lo propones, menciona la licencia.</p>` },
          { t: 'h3', text: 'Endpoints administrados' },
          { t: 'p', html: `SageMaker AI (endpoints de inferencia en tiempo real), Vertex AI (en 2026 su documentación ya lo presenta como Gemini Enterprise Agent Platform) y Azure Machine Learning (managed online endpoints) corren tu modelo o tu contenedor (que puede llevar Triton o vLLM adentro) y se encargan de instancias, autoscaling, despliegues por etapas y métricas. Pagas un sobreprecio por instancia y pierdes control fino de la red y del runtime (<a href="#m06.por-que-k8s">M6</a>). La comparación entre nubes está en <a href="#m13">M13</a>.` },
          { t: 'callout', kind: 'interview', html: `<p>"TorchServe has been archived since August 2025, so it gets no security patches. If it's already in production, I'd lock it down behind the gateway and migrate model by model, with a parity test and a canary for each one."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Quién opera la plataforma decide entre Kubernetes y un endpoint administrado: <a href="#m06.por-que-k8s">M6</a>. Canary, shadow y rollback, sea con KServe o con tus propios Deployments: <a href="#m11">M11</a>.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'llm-servers',
        title: 'Servidores de LLMs: vLLM, SGLang, TGI, TensorRT-LLM',
        titleEn: 'LLM servers: vLLM, SGLang, TGI, TensorRT-LLM',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Empieza por un número. Ocho requests entran juntos a un batch estático y piden respuestas de largos distintos: el batch no termina hasta que termina la más larga, y los lugares de las que ya terminaron quedan vacíos.` },
          { t: 'calc', title: 'Batch estático con 8 respuestas de largo distinto (ilustrativo)', rows: [
            { label: 'Largos de respuesta, en tokens', expr: '50, 80, 120, 200, 250, 300, 400, 1,000', value: '2,400 tokens útiles' },
            { label: 'Pasos de decode del batch', expr: 'lo que tarda la más larga', value: '1,000 pasos' },
            { label: 'Lugares disponibles', expr: '8 secuencias × 1,000 pasos', value: '8,000' },
            { label: 'Fracción con trabajo útil', expr: '2,400 / 8,000', value: '30 %' },
          ], result: 'El 70 % de los lugares del batch se desperdicia esperando a la respuesta de 1,000 tokens, y los requests que llegaron mientras tanto esperan afuera. <b>Continuous batching</b> (la idea de Orca, Yu et al., OSDI 2022) decide el batch en cada paso de decode: cuando una secuencia termina, entra otra.' },
          { t: 'table', caption: 'Por qué un LLM no se sirve como una CNN', head: ['', 'CNN (c01)', 'LLM generativo'], rows: [
            ['Trabajo por request', 'Un forward de duración casi fija', 'Un prefill del prompt y después un paso de decode por cada token de salida'],
            ['Memoria', 'Pesos y activaciones; en c01 la VRAM sobra', 'El KV cache crece con cada token de cada secuencia viva y limita cuántas atiendes a la vez (<a href="#m04.vram">M4</a>)'],
            ['Batching', 'Dynamic: juntar requests completos', 'Continuous: las secuencias entran y salen del batch en cada paso'],
            ['Cuello de botella', 'Cómputo', 'El decode es memory-bound: cada token lee todos los pesos (<a href="#m04.roofline">M4</a>)'],
            ['Respuesta', 'Un JSON al final', 'Streaming de tokens; importan el tiempo al primer token y el tiempo entre tokens'],
            ['API', 'KServe v2 con tensores', 'Compatible con OpenAI: <code>/v1/chat/completions</code>'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>Cómo funciona por dentro el algoritmo de paginación, los kernels de atención, speculative decoding y los esquemas de paralelismo: es el tema de <a href="#m14">M14</a> y del <a href="#c10">caso 10</a>. Aquí basta con qué motor elegir y por qué.</p>` },
          { t: 'h3', text: 'vLLM: la opción por defecto' },
          { t: 'p', html: `Nació en UC Berkeley con <b>PagedAttention</b>: el KV cache se guarda en bloques de tamaño fijo, como las páginas de la memoria virtual, en lugar de reservar por secuencia un tramo contiguo del largo máximo. Casi no desperdicia memoria y los bloques se comparten entre secuencias con el mismo prefijo. Su paper (Kwon et al., SOSP 2023) reporta 2–4× más throughput a igual latencia que FasterTransformer y Orca, las referencias de ese momento. Suma continuous batching, chunked prefill, prefix caching (activado por defecto en la v0.30), cuantización, speculative decoding, salidas estructuradas, multi-LoRA, prefill y decode desagregados y un servidor compatible con OpenAI (<code>vllm serve</code>). Es el de mayor cobertura de modelos y hardware; va por la v0.30 (septiembre de 2026).` },
          { t: 'h3', text: 'SGLang: cuando se repiten los prefijos' },
          { t: 'p', html: `De LMSYS. Su idea central es <b>RadixAttention</b>: guarda el KV cache de los prefijos en un árbol radix y lo reutiliza entre requests. Rinde cuando muchos requests comparten comienzo: un system prompt largo, ejemplos few-shot, conversaciones de varios turnos, agentes que llaman al modelo con el mismo contexto. Suma un scheduler de muy bajo overhead, salidas estructuradas rápidas, prefill y decode desagregados y API compatible con OpenAI; va por la v0.5.20. vLLM también reutiliza prefijos: entre los dos, la diferencia depende de tu carga y se mide.` },
          { t: 'h3', text: 'TGI: en modo mantenimiento' },
          { t: 'p', html: `Text Generation Inference, de Hugging Face, fue uno de los servidores de LLMs más usados. Hoy: modo mantenimiento desde el 11 de diciembre de 2025 (solo arreglos menores y documentación), última release v3.3.7 (19 de diciembre de 2025) y repositorio archivado el 21 de marzo de 2026. Su propio README recomienda vLLM o SGLang (o llama.cpp y MLX en local). Se prefieren porque ahí llegan primero las arquitecturas nuevas y las optimizaciones: un servidor que ya no agrega modelos te deja fuera del siguiente lanzamiento.` },
          { t: 'h3', text: 'TensorRT-LLM: el máximo en NVIDIA, a cambio de complejidad' },
          { t: 'p', html: `La librería de NVIDIA: kernels propios, cuantización FP8 y FP4 en las GPUs que la soportan, in-flight batching (su nombre para continuous batching), KV cache paginado, speculative decoding y serving desagregado; <code>trtllm-serve</code> expone una API compatible con OpenAI. Su documentación actual la describe construida sobre PyTorch, y para muchos modelos ya no exige compilar un engine a mano. El precio: solo NVIDIA, más acoplamiento a versiones de GPU, driver y contenedor, y una curva más alta. Tiene sentido con pocos modelos a gran escala, cuando el costo por token paga al equipo que la opera.` },
          { t: 'callout', kind: 'estimate', title: 'Benchmarks entre motores', html: `<p>No hay un número confiable de "cuánto más rápido" es un motor que otro: depende de la GPU, el modelo, la cuantización, los largos de prompt y respuesta, la concurrencia y la versión, y cambia con cada release. Desconfía de quien lo dé sin condiciones. Si te lo preguntan: "I'd benchmark both engines on our GPU, with our prompt and output length distribution at our target concurrency, and compare throughput at our latency SLO."</p>` },
          { t: 'h3', text: 'Por encima del motor: NVIDIA Dynamo y llm-d' },
          { t: 'p', html: `<b>NVIDIA Dynamo</b> (open source desde marzo de 2025; v1.5 en septiembre de 2026) no es otro motor: orquesta motores (vLLM, SGLang o TensorRT-LLM) en muchas GPUs. Separa prefill y decode en pools distintos (serving desagregado), manda cada request al worker que ya tiene su prefijo en el KV cache y puede bajar el KV cache a memoria de CPU o a disco. <b>llm-d</b> (sandbox de la CNCF desde marzo de 2026, fundado por Red Hat, Google Cloud, IBM Research, CoreWeave y NVIDIA) hace algo parecido en Kubernetes sobre vLLM, y es lo que usa KServe para LLMs. Sirven con modelos grandes en varios nodos y mucha concurrencia, donde el prefill de un prompt largo frena el decode de los demás. Para un 8B en una GPU, sobran.` },
          { t: 'table', caption: 'Servidores de LLMs, septiembre de 2026', head: ['Servidor', 'Idea clave', 'Fuerte en', 'Estado', 'Cuándo no'], rows: [
            ['vLLM', 'PagedAttention + continuous batching', 'Cobertura de modelos y hardware; default razonable', 'Activo (v0.30)', 'Modelos que no son LLMs: CNNs, rankers, árboles (Triton u ONNX Runtime)'],
            ['SGLang', 'RadixAttention (reuso de prefijos)', 'Prompts con prefijo compartido, agentes, salidas estructuradas', 'Activo (v0.5.20)', 'Lo mismo que vLLM; entre los dos, decide midiendo'],
            ['TGI', 'Continuous batching (Hugging Face)', 'Lo que ya está desplegado', 'Mantenimiento desde dic. 2025; archivado en mar. 2026', 'Sistemas nuevos'],
            ['TensorRT-LLM', 'Kernels y cuantización de NVIDIA', 'Máximo throughput en NVIDIA a gran escala', 'Activo (estable 1.2; 1.3 en release candidates)', 'Equipos chicos, hardware mixto, modelos que cambian cada semana'],
            ['Triton + backend vLLM o TensorRT-LLM', 'El motor dentro de tu Triton', 'Plataformas que ya estandarizaron Triton; LLM junto a modelos de visión', 'Activo', 'Si solo sirves LLMs: el motor directo es menos piezas'],
            ['NVIDIA Dynamo, llm-d', 'Orquestar motores: prefill y decode separados, ruteo por KV cache', 'Modelos grandes, varios nodos, mucha concurrencia', 'Activos', 'Un modelo que cabe en una GPU'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Servir un LLM con un servidor genérico', html: `<p>FastAPI con un <code>model.generate()</code> por batch, o un Python backend de Triton que hace lo mismo: el batch es estático (el 30 % útil de arriba), cada secuencia ocupa su lugar y su KV cache hasta que termina la más larga, no hay paginación ni reuso de prefijos, y no hay streaming salvo que lo escribas. En la L4 de <a href="#m04.vram">M4</a>, donde el KV cache alcanza para ${E('≈ 3–4')} conversaciones de 8k tokens a la vez, dejar lugares vacíos es tirar buena parte de una GPU cara. Bajo carga, el tiempo al primer token se dispara: los requests nuevos esperan a que termine el batch entero.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For an open-weights LLM I'd start with vLLM: continuous batching and PagedAttention are what keep the GPU busy, because the KV cache, not compute, limits concurrency. I'd look at SGLang if most requests share a long prefix, and at TensorRT-LLM only if we're all-in on NVIDIA and need the last bit of throughput."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El cálculo del KV cache y la concurrencia por GPU: <a href="#m04.vram">M4</a>. La fila de continuous batching en la tabla de tipos de batching: <a href="#m03.batching">M3</a>. El diseño completo de un servicio de LLM (TTFT, tokens por segundo, costo por millón de tokens, autoscaling por KV cache): <a href="#m14">M14</a> y el <a href="#c10">caso 10</a>.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'protocolos',
        title: 'Protocolos: REST, gRPC, KServe v2 y OpenAI-compatible',
        titleEn: 'Protocols: REST, gRPC, KServe v2 and OpenAI-compatible APIs',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs', 'estimaciones'],
        blocks: [
          { t: 'p', html: `El tensor que el gateway de c01 manda a Triton tiene 3 × 224 × 224 = 150,528 valores FP32. Cuánto pesa en la red depende de cómo lo codifiques, y la diferencia no es un detalle:` },
          { t: 'calc', title: 'El tensor de c01 según cómo lo mandes', rows: [
            { label: 'Binario (extensión binaria de HTTP o gRPC)', expr: '150,528 × 4 B', value: '602,112 B ≈ 602 KB' },
            { label: 'Base64 dentro de un JSON', expr: '602,112 × 4 / 3', value: '≈ 803 KB' },
            { label: 'JSON con los floats como texto', expr: 'medido: ≈ 20.6 B por valor', value: '≈ 3.1 MB (≈ 5.1×)' },
            { label: 'JSON redondeado a 4 decimales', expr: 'medido: ≈ 8.4 B por valor', value: '≈ 1.26 MB', note: 'Y cambiaste la entrada del modelo: tendrías que repetir el parity test' },
            { label: 'Entrada UINT8, normalización dentro del grafo', expr: '150,528 × 1 B', value: '≈ 151 KB', note: 'La palanca que c01 deja para cuando crezca (<a href="#c01.estimaciones">estimaciones</a>)' },
            { label: 'Red a 500 req/s, binario', expr: '602 KB × 500 × 8', value: '≈ 2.4 Gb/s' },
            { label: 'Red a 500 req/s, JSON', expr: '3.09 MB × 500 × 8', value: '≈ 12.4 Gb/s' },
            { label: 'CPU para serializar el JSON en Python', expr: 'medido: ≈ 50 ms por request × 500 req/s', value: E('≈ 25 cores'), note: 'Medido con json.dumps en una laptop (Apple M4): solo orden de magnitud. Parsearlo tomó ≈ 23 ms más' },
          ], result: 'En JSON, el mismo tensor pesa 5× más: repartido entre los dos nodos de gateway de c01 son ≈ 6.2 Gb/s por nodo, 4× su baseline de red (≈ 1.56 Gb/s), y serializarlo quema ≈ 8× los ≈ 3 cores que c01 presupuesta para todo el preprocesamiento. Por eso el gateway usa la extensión binaria. JSON sirve para curl y para depurar, no para tensores.' },
          { t: 'table', caption: 'Tres formas de hablar con el model server', head: ['', 'HTTP/REST + JSON', 'HTTP/REST + extensión binaria (c01)', 'gRPC'], rows: [
            ['Formato del tensor', 'Números como texto', 'Header JSON corto + bytes crudos', 'Protobuf con bytes crudos'],
            ['Tamaño del tensor de c01', '≈ 3.1 MB', '≈ 602 KB', '≈ 602 KB'],
            ['Depurar', '<code>curl</code> y cualquier herramienta', '<code>curl</code> para el header; el cliente de Triton arma el cuerpo', '<code>grpcurl</code> o clientes generados'],
            ['Conexiones', 'HTTP/1.1: un request a la vez por conexión; el cliente usa un pool', 'Igual', 'HTTP/2: miles de requests multiplexados en una conexión de larga vida'],
            ['Balanceo en Kubernetes', 'Razonable con un pool que renueva conexiones', 'Igual', 'El Service balancea conexiones (L4): hace falta balanceo por request (L7) o del lado del cliente'],
            ['Streaming', 'SSE', 'SSE', 'Streams nativos, incluso bidireccionales'],
            ['Clientes web', 'Directo', 'Directo', 'Necesita gRPC-Web o un proxy'],
          ] },
          { t: 'callout', kind: 'trap', title: 'gRPC detrás de un Service de Kubernetes', html: `<p>Un Service balancea <b>conexiones</b>, no requests, y gRPC reutiliza una sola conexión HTTP/2 para todo: cada pod del gateway queda pegado a un pod de Triton, y el Triton que KEDA acaba de agregar no recibe tráfico hasta que las conexiones se reciclan. Soluciones: balanceo del lado del cliente con un headless service, un service mesh o proxy que balancee por request, o un tiempo de vida máximo de conexión en el servidor. Está desarrollado en el <a href="#c01.serving">serving de c01</a>.</p>` },
          { t: 'code', title: 'Medir la diferencia entre protocolos en tu caso', caption: 'Opciones verificadas en la documentación de perf_analyzer: <code>-i</code> elige el protocolo y <code>--input-tensor-format</code> (solo HTTP) elige binario o JSON. <code>tensores_reales.json</code> son fotos reales ya preprocesadas, como en <a href="#m03.load-testing">M3</a>.', files: [
            { name: 'protocolos.sh', lang: 'bash', code: PERF_PROTO },
          ] },
          { t: 'h3', text: 'KServe v2: un contrato común para tensores' },
          { t: 'p', html: `El protocolo KServe v2, también llamado Open Inference Protocol, define los mismos endpoints para cualquier servidor que lo implemente: Triton, los runtimes de KServe, MLServer de Seldon y OpenVINO Model Server, entre otros. Si tu gateway habla v2, cambiar de servidor no cambia el cliente.` },
          { t: 'table', head: ['Endpoint', 'Para qué'], rows: [
            ['<code>GET /v2/health/live</code>', 'El proceso está vivo (liveness)'],
            ['<code>GET /v2/health/ready</code>', 'El servidor puede atender (readiness)'],
            ['<code>GET /v2/models/&lt;modelo&gt;[/versions/&lt;v&gt;]/ready</code>', 'Ese modelo (o esa versión) está cargado'],
            ['<code>GET /v2/models/&lt;modelo&gt;</code>', 'Metadata: nombres, tipos y shapes de entradas y salidas'],
            ['<code>POST /v2/models/&lt;modelo&gt;[/versions/&lt;v&gt;]/infer</code>', 'Inferencia'],
          ], note: 'La extensión binaria no es parte del protocolo base: es una extensión de Triton (la anuncia como <code>binary_tensor_data</code> en la metadata del servidor; el header <code>Inference-Header-Content-Length</code> dice dónde termina el JSON). Si cambias de servidor, confirma que la soporte o pasa a gRPC.' },
          { t: 'h3', text: 'API compatible con OpenAI para LLMs' },
          { t: 'p', html: `Para LLMs, el contrato de facto es el de OpenAI: <code>POST /v1/chat/completions</code> con <code>messages</code>, <code>model</code>, <code>max_tokens</code> y <code>stream</code>, más <code>/v1/completions</code>, <code>/v1/embeddings</code> y <code>/v1/models</code>. Lo exponen vLLM, SGLang, <code>trtllm-serve</code>, Dynamo, Ray Serve LLM y el frontend OpenAI de Triton. La ventaja es la misma que con KServe v2: cambias de motor sin tocar a los clientes, y los SDKs de OpenAI funcionan apuntándolos a tu URL. Compatible no es idéntico: los parámetros extra y los campos que cada motor ignora cambian, así que prueba tu cliente contra el motor que vas a usar.` },
          { t: 'code', title: 'Streaming de tokens por SSE', caption: 'Ilustrativo: el formato de los eventos es el de la API de chat completions; <code>...</code> abrevia los campos que se omiten.', files: [
            { name: 'stream.sh', lang: 'bash', code: SSE_REQ },
            { name: 'respuesta (SSE)', lang: 'text', code: SSE_RESP, note: 'Un evento <code>data:</code> por fragmento, separados por una línea en blanco; <code>[DONE]</code> cierra el stream.' },
          ] },
          { t: 'table', caption: 'Streaming: SSE, gRPC o WebSocket', head: ['', 'SSE', 'Stream de gRPC', 'WebSocket'], rows: [
            ['Dirección', 'Servidor → cliente', 'Cualquiera, incluso bidireccional', 'Bidireccional'],
            ['Transporte', 'HTTP normal, <code>text/event-stream</code>', 'HTTP/2 de punta a punta', 'Upgrade de una conexión HTTP'],
            ['Uso típico', 'Tokens de un LLM hacia un navegador o un backend (es lo que usa la API de OpenAI)', 'Servicio a servicio; modelos "decoupled" de Triton', 'Voz y tiempo real, donde el cliente también manda datos continuamente (<a href="#c13">caso 13</a>)'],
            ['Cuidado con', 'Proxies que bufferizan y el idle timeout del balanceador (60 s por defecto en un ALB)', 'El balanceo L4 de arriba', 'Conexiones de larga vida en cada deploy'],
          ] },
          { t: 'h3', text: 'Dónde separar el preprocesamiento (CPU) de la inferencia (GPU)' },
          { t: 'tradeoffs', items: [
            { option: 'En el gateway, como tier aparte (c01)', verdict: 'elegido',
              pros: 'Escala por CPU con nodos baratos; aísla el parseo de bytes no confiables; se despliega sin tocar la GPU; usa el mismo paquete de preprocesamiento que el entrenamiento.',
              cons: 'El tensor viaja por la red: 602 KB, 3× el JPEG del celular; obliga a ruteo por zona.',
              why: 'Los dos trabajos se saturan con recursos distintos; la red se controla con ruteo por zona y, al crecer, entrada UINT8 (÷ 4).' },
            { option: 'Ensemble en Triton con Python backend', verdict: 'depende',
              pros: 'Un solo llamado; viaja el JPEG, no el tensor; preprocesamiento y modelo se versionan juntos.',
              cons: 'Usa la CPU del nodo GPU (4 vCPU en una g4dn.xlarge contra ≈ 3 cores de decode en el pico de c01); escala junto con la GPU.',
              why: 'Sirve si el nodo GPU tiene CPU de sobra o la red es el cuello medido. En c01 la CPU no alcanza.' },
            { option: 'Ensemble con DALI (decode en GPU)', verdict: 'depende',
              pros: 'Libera CPU: el JPEG se decodifica en la GPU; sirve a throughput muy alto.',
              cons: 'Otro camino de preprocesamiento distinto del entrenamiento (riesgo de training-serving skew); consume tiempo de GPU.',
              why: 'A 10× el tráfico o en el backfill, si el decode es el cuello medido y el entrenamiento usa el mismo pipeline.' },
            { option: 'En el mismo proceso que el modelo', verdict: 'depende',
              pros: 'Lo más simple; sin red ni serialización.',
              cons: 'CPU y GPU escalan juntas; el decode compite con el proceso que alimenta la GPU.',
              why: 'El MVP de c01, hasta que crece el tráfico o las fotos grandes mueven el p99.' },
            { option: 'Transformer de KServe', verdict: 'depende',
              pros: 'El mismo corte que el gateway, declarado en el InferenceService y escalado por separado.',
              cons: 'Solo si tu plataforma ya usa KServe.',
              why: 'Lo natural en una plataforma KServe; en c01, con Deployments propios, el gateway ya cumple ese papel.' },
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"Between the gateway and Triton I send the tensor as raw bytes with the binary extension of the KServe v2 protocol. As JSON, the same tensor is about five times bigger and takes tens of milliseconds just to serialize. For LLMs, I expose an OpenAI-compatible API and stream tokens over server-sent events."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Por dónde viaja el tensor dentro del nodo (red, PCIe, VRAM): el diagrama de <a href="#m04">M4</a>. El costo de red entre zonas y el ruteo por zona: <a href="#c01.estimaciones">estimaciones de c01</a> y <a href="#m06.alta-disponibilidad">M6</a>. Timeouts y deadlines por request: <a href="#m03.timeouts-reintentos">M3</a>.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'tabla-eleccion',
        title: 'Tabla: cuándo elegir cada uno',
        titleEn: 'When to choose each model server',
        priority: 'core',
        dims: ['tradeoffs', 'comunicacion', 'arquitectura'],
        blocks: [
          { t: 'p', html: `La tabla es para preparar, no para recitar: en la ronda se anota que cada elección venga con su porqué y con la condición en que cambiarías de opinión.` },
          { t: 'table', caption: 'Servidores de modelos: cuándo elegir cada uno (septiembre de 2026)', head: ['Servidor', 'Punto fuerte', 'Batching', 'Varios modelos', 'Backends / lenguaje', 'Costo operativo', 'Cuándo NO'], rows: [
            ['<b>FastAPI + PyTorch</b>', 'MVP, QPS bajo, modelos en CPU, lógica pegada al modelo', 'Ninguno, salvo que lo escribas', 'Los que cargues en el proceso, sin aislamiento', 'Python, cualquier librería', 'Bajo al inicio; lo demás lo construyes tú', 'GPU con QPS medio o alto; modelos grandes con varios workers; necesitas versiones y métricas de cola'],
            ['<b>Triton</b>', 'GPU con QPS medio o alto, varios modelos por GPU, separar cola de cómputo', 'Dynamic batching en C++, con prioridades y timeout de cola', 'Sí: cola e instancias por modelo; ensembles y BLS', 'TensorRT, ONNX Runtime, PyTorch, Python, OpenVINO, DALI, FIL, vLLM, TensorRT-LLM', 'Medio-alto: pbtxt, imagen de ≈ 9 GB, release de NGC alineada con el engine', 'Un modelo en CPU a pocas req/s; lógica de producto; LLM sin su backend de LLM'],
            ['<b>TorchServe</b>', 'Solo lo que ya existe', '<code>batch_size</code> + <code>max_batch_delay</code>', 'Sí, por API de administración', 'PyTorch, handlers en Python', 'Medio, más el riesgo de no tener parches', 'Cualquier sistema nuevo: archivado desde agosto de 2025'],
            ['<b>BentoML</b>', 'Empaquetar servicio + modelo y desplegar rápido, en Python', 'Adaptive batching', 'Sí, servicios compuestos', 'Python; cualquier framework adentro', 'Bajo-medio; BentoCloud si no quieres operar', 'Máximo throughput por GPU con SLOs de pocos ms; plataforma ya estandarizada'],
            ['<b>Ray Serve</b>', 'Pipelines de varios modelos con lógica en Python; equipos que ya usan Ray', '<code>@serve.batch</code>', 'Sí: deployments compuestos, GPU fraccional', 'Python; cualquier framework adentro', 'Medio-alto: operar un cluster de Ray', 'Un modelo simple; equipo sin Ray'],
            ['<b>KServe</b>', 'Un recurso estándar de Kubernetes para muchos modelos y equipos', 'El del runtime (Triton, vLLM…)', 'Sí: un InferenceService por modelo, InferenceGraph', 'Runtimes: Triton, Hugging Face (vLLM), MLServer, propios', 'Alto: Kubernetes + KServe (+ Knative)', 'Sin Kubernetes; un par de modelos'],
            ['<b>vLLM</b>', 'LLMs de pesos abiertos en GPU; el default', 'Continuous batching + PagedAttention', 'Un modelo base por servidor; multi-LoRA sobre ese base', 'Modelos de Hugging Face; GPUs NVIDIA, AMD y otros aceleradores', 'Medio', 'Modelos que no son LLMs (CNNs, rankers)'],
            ['<b>SGLang</b>', 'Prefijos compartidos, agentes, salidas estructuradas', 'Continuous batching + RadixAttention', 'Igual que vLLM', 'Igual que vLLM', 'Medio', 'Igual que vLLM: entre los dos, decide midiendo'],
            ['<b>TGI</b>', 'Solo lo que ya existe', 'Continuous batching', 'Un modelo por servidor', 'Modelos de Hugging Face', 'Medio, sin modelos nuevos', 'Sistemas nuevos: mantenimiento desde dic. 2025, archivado en mar. 2026'],
            ['<b>TensorRT-LLM</b>', 'Máximo throughput en NVIDIA a gran escala', 'In-flight batching, KV paginado', 'Un modelo por servidor', 'Solo NVIDIA', 'Alto: acoplado a GPU, driver y contenedor', 'Equipos chicos, hardware mixto, modelos que cambian seguido'],
            ['<b>Endpoints administrados</b>', 'Equipo sin plataforma y pocos modelos', 'El del contenedor que lleves', 'Según el producto', 'Tu contenedor (puede ser Triton o vLLM)', 'Bajo, con sobreprecio por instancia', 'Muchos modelos o control fino de red y runtime'],
          ] },
          { t: 'h3', text: 'Del enunciado a la elección' },
          { t: 'steps', items: [
            { title: '¿El modelo genera tokens?', meta: 'la pregunta que más divide', html: `<p>Sí: un motor de LLM, vLLM o SGLang; TensorRT-LLM si todo es NVIDIA y hay equipo para operarlo; Dynamo o llm-d cuando son varios nodos y el prefill frena al decode. No (CNN, ranker, encoder): sigue.</p>` },
            { title: '¿Quién lo va a operar?', meta: 'plataforma', html: `<p>Sin plataforma y con pocos modelos: endpoint administrado (con Triton o vLLM adentro si hace falta). Plataforma que ya estandarizó KServe: KServe arriba, el runtime abajo. Kubernetes y pocos modelos: Deployments propios, como c01 (<a href="#m06.por-que-k8s">M6</a>).</p>` },
            { title: '¿CPU o GPU, y cuántas req/s?', meta: 'hardware y carga', html: `<p>CPU a decenas de req/s: FastAPI con ONNX Runtime o PyTorch en el mismo proceso. GPU, o CPU a muchos cientos de req/s: un model server con batching. Haz la cuenta de <a href="#m03.cuantas-gpus">M3</a> antes de decidir.</p>` },
            { title: '¿Uno o varios modelos, y cómo se conectan?', meta: 'topología', html: `<p>Un modelo: Triton. Un DAG fijo: ensemble de Triton. Lógica con <code>if</code> y loops entre modelos: BLS si ya estás en Triton, Ray Serve si el pegamento es mucho Python, BentoML si el equipo prioriza empaquetar y desplegar rápido.</p>` },
            { title: 'Mídelo', meta: 'antes de firmar', html: `<p>Load test con tu modelo, tus datos y tu protocolo al QPS de diseño (perf_analyzer, k6 o Locust): el p99 tiene que caber en el presupuesto del tramo.</p>` },
          ] },
          { t: 'p', html: `Aplicado a c01: no genera tokens; la empresa ya opera EKS y no usa KServe; es GPU a 500 req/s de diseño; un modelo, con espacio para los de otros equipos. Resultado: <b>Triton detrás de un gateway FastAPI</b>, con Deployments propios. El MVP, antes, fue FastAPI + PyTorch solo.` },
          { t: 'callout', kind: 'trap', title: 'Name-dropping', html: `<p>"Lo sirvo con KServe sobre Triton, con Ray para el preprocesamiento y vLLM para lo que haga falta." Cuatro herramientas sin un porqué es lo que el entrevistador anota como sobreingeniería o como no saber qué hace cada una. Una herramienta por problema, con el problema dicho en voz alta.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I pick the model server from three questions: is the model generative, who operates the platform, and how the models connect. Here it's a CNN on a GPU, on a team that already runs EKS, with room for other teams' models, so it's Triton behind a FastAPI gateway."</p>` },
          { t: 'followups', items: [
            { q: '¿Por qué no solo FastAPI? Es más simple.',
              junior: 'Porque FastAPI no escala y Triton es más rápido.',
              senior: `Para el MVP sí: al 10 % de los vendedores son ≈ 35 req/s en el pico, y un proceso con PyTorch eager en batch 1 (del orden de 100 img/s en una T4) alcanza. Al 100 % son 350–500 req/s: con batch 1 serían varios procesos, cada uno con su copia del modelo y su contexto CUDA, turnándose la GPU sin batching. Triton me da dynamic batching, dos instancias por GPU, timeout de cola y métricas de cola vs cómputo sin escribirlas. FastAPI queda como gateway: auth, validación y top-k son su trabajo.`,
              why: 'Dice con números cuándo alcanza, qué se rompe primero y qué parte de FastAPI se queda. "No escala" no es un argumento.' },
            { q: '¿Triton o vLLM para servir un LLM de 8B?',
              junior: 'Triton, porque es el estándar de NVIDIA para producción.',
              senior: `Para generar texto, un motor de LLM: vLLM, o SGLang si casi todos los requests comparten un prefijo largo. Decide el KV cache: en una L4 de 24 GB, 8B en BF16 son ≈ 16 GB de pesos y quedan unos pocos GB de KV cache, ≈ 3–4 conversaciones de 8k tokens a la vez (<a href="#m04.vram">M4</a>). Sin paginación ni continuous batching, esos pocos lugares quedarían vacíos esperando a la respuesta más larga. Triton no queda descartado: tiene backends de vLLM y TensorRT-LLM, y lo usaría si la plataforma ya es Triton o si el LLM convive con modelos de visión. Lo que no haría es un Python backend que llame a <code>generate()</code>.`,
              why: 'Conecta la elección con la memoria y el batching, que es lo que diferencia a un LLM, y reconoce cuándo Triton sí tiene sentido.' },
            { q: '¿Cómo haces un A/B entre dos versiones del modelo en el servidor?',
              junior: 'Cargo las dos versiones en Triton y mando la mitad del tráfico a cada una.',
              senior: `Primero la unidad de aleatorización: en c01 el A/B es por vendedor (la métrica es la aceptación), no por request, así que el backend asigna el brazo con un hash del <code>seller_id</code> y lo manda en un header. Después, dónde viven las versiones. Opción 1: las dos en el mismo Triton (<code>version_policy</code> <code>specific</code>) y el gateway llama <code>/versions/N</code>: barato en GPUs, pero comparten cola y GPU (un brazo lento contamina al otro) y el gateway carga los labels de los dos. Opción 2, la de c01: dos releases completas (gateway y Triton por versión) y el ALB rutea por el header. Para un A/B de dos semanas prefiero la 2 por el aislamiento y un <code>model_version</code> limpio en los logs, pagando más GPUs mientras dura.`,
              why: 'Empieza por la unidad del experimento, compara las dos ubicaciones con su costo y conecta con cómo se analiza después (<a href="#c01.evaluacion">evaluación de c01</a>).' },
            { q: 'La empresa sirve 40 modelos con TorchServe. ¿Qué harías?',
              junior: 'Lo cambio todo a Triton este trimestre.',
              senior: `Primero contener el riesgo: está archivado desde agosto de 2025 y no recibe parches. API de administración solo interna, autorización por token, sin descargas de modelos desde URLs arbitrarias (ShellTorch fue eso), imágenes fijas y escaneadas, todo detrás del gateway. Después migrar por prioridad, primero los de más tráfico o más expuestos: el handler se parte en preprocesamiento y modelo, el modelo va a Triton (TorchScript, AOTInductor, ONNX o TensorRT) o a vLLM si es un LLM, y cada uno pasa por parity test, shadow y canary. Con 40 modelos, Triton en modo <code>explicit</code> o uno por equipo, para que el deploy de uno no reinicie a los demás.`,
              why: 'Separa riesgo inmediato de migración, da un orden y un método por modelo, y piensa en cómo se opera el destino.' },
            { q: 'El p99 subió de 60 a 180 ms. ¿Es el gateway o Triton?',
              junior: 'Agrego más GPUs.',
              senior: `Lo parto por tramos con lo que ya mido. En el gateway, el histograma de preprocesamiento y el del round trip a Triton. En Triton, por modelo, la espera promedio en cola (<code>rate(nv_inference_queue_duration_us)</code> dividido por <code>rate(nv_inference_request_success)</code>) y lo mismo con el cómputo. Cola arriba y cómputo estable: llega más de lo que la GPU da, escalo. Cómputo arriba: cambió el modelo o el batch, la GPU está bajando clocks o un vecino la comparte. Triton plano y round trip arriba: red o conexiones (gRPC pegado a un pod). Preprocesamiento arriba: cambió la entrada (fotos más grandes) o falta CPU en el gateway.`,
              why: 'Diagnostica por tramos con métricas concretas antes de gastar. Agregar GPUs arregla uno de los cuatro casos.' },
            { q: '¿Pondrías los modelos de otros tres equipos en tu Triton?',
              junior: 'Sí: la GPU está al 5 % y así ahorramos.',
              senior: `Sí, con condiciones: cada modelo con su cola y su timeout; VRAM medida con todos cargados más el margen de un deploy; alertas de tiempo de cómputo por modelo para ver al vecino ruidoso; un dueño claro para cada cambio de config y cada alerta. Lo que no comparto: modelos con SLO de milisegundos junto a cargas batch pesadas, ni releases acopladas. Si sus modelos van horneados en mi imagen, cada deploy suyo reinicia el mío; con modelos que cambian seguido, paso a modo <code>explicit</code> o a un Triton por equipo.`,
              why: 'Acepta el ahorro real y pone las condiciones que evitan el noisy neighbor y el acoplamiento de releases.' },
          ] },
        ],
      },

      // ======================================================== 9
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['tradeoffs'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, vuelve a la sección de la explicación y justifica en voz alta, en inglés, el servidor del <a href="#c01.serving">caso 1</a>.` },
          { t: 'quiz', items: [
            { q: 'Un endpoint <code>async def</code> llama <code>model(x)</code> directamente, sin threadpool. ¿Qué pasa con 20 requests concurrentes?', options: ['PyTorch los paraleliza solo', 'Se atienden de a uno: el event loop queda bloqueado durante cada inferencia, incluidos los health checks', 'FastAPI los manda a su threadpool automáticamente', 'Se forman batches de 20'], answer: 1,
              explain: 'FastAPI solo manda al threadpool los endpoints <code>def</code>. Un <code>async def</code> corre en el event loop: el trabajo bloqueante adentro lo congela. Usa <code>run_in_threadpool</code> o declara el endpoint con <code>def</code>.' },
            { q: 'Escribes <code>with torch.inference_mode(): await run_in_threadpool(predict, x)</code>. ¿Se aplica el modo dentro de <code>predict</code>?', options: ['Sí, los context managers se heredan', 'No: el modo de autograd es por thread y predict corre en otro', 'Solo en GPU', 'Solo si el modelo está en eval()'], answer: 1,
              explain: 'Medido: <code>is_inference_mode_enabled()</code> da True en el loop y False en el thread del pool. El <code>with</code> va dentro de la función que corre en el thread.' },
            { q: 'Quieres servir Llama 3 8B en BF16 con <code>uvicorn --workers 2</code> en una L4 de 24 GB. ¿Qué pasa?', options: ['Funciona y duplica el throughput', 'No caben: son ≈ 16.1 GB de pesos por proceso, ≈ 32 GB en total', 'Los workers comparten los pesos automáticamente', 'Funciona si bajas el batch'], answer: 1,
              explain: 'Cada worker es un proceso con su copia de los pesos y su contexto CUDA. Para modelos grandes, la concurrencia la atiende un servidor con una sola copia que arma batches adentro.' },
            { q: '¿Cuál es el modo de control de modelos por defecto de Triton y qué hace?', options: ['poll: recarga cuando cambia el repository', 'explicit: solo carga lo que pidas por API', 'none: carga todo al arrancar e ignora cambios', 'auto: decide según el backend'], answer: 2,
              explain: 'none es el default y el que usa c01 con el modelo horneado en la imagen. poll no se recomienda en producción; explicit sirve para muchos modelos que entran y salen.' },
            { q: 'Necesitas una cascada: un modelo chico y, solo si su confianza es baja, uno grande. ¿Qué usas en Triton?', options: ['Un ensemble', 'BLS: un modelo del Python backend que llama a los otros con lógica condicional', 'Dos instance_group', 'version_policy specific'], answer: 1,
              explain: 'Un ensemble es un DAG fijo: siempre corre todos los pasos. BLS permite if, loops y decisiones según los datos.' },
            { q: '¿En qué estado está TGI en septiembre de 2026?', options: ['Activo, es el default de Hugging Face', 'En modo mantenimiento desde diciembre de 2025 y archivado desde marzo de 2026; Hugging Face recomienda vLLM o SGLang', 'Fusionado con vLLM', 'Deprecado solo para GPUs AMD'], answer: 1,
              explain: 'Modo mantenimiento el 11-dic-2025, última release v3.3.7 y repositorio archivado el 21-mar-2026. Para sistemas nuevos: vLLM o SGLang.' },
            { q: 'El tensor de c01 (150,528 valores FP32) viaja como JSON en vez de binario. ¿Aproximadamente cuánto pesa?', options: ['≈ 602 KB, igual', '≈ 803 KB', '≈ 3.1 MB, unas 5× más', '≈ 150 KB'], answer: 2,
              explain: 'Medido: ≈ 20.6 bytes por valor como texto. 602 KB es el binario; 803 KB, base64; 151 KB, UINT8.' },
            { q: 'Cambias el gateway de HTTP a gRPC hacia Triton. KEDA agrega un tercer pod de Triton y no recibe tráfico. ¿Por qué?', options: ['gRPC no soporta autoscaling', 'El Service balancea conexiones (L4) y gRPC reutiliza una conexión HTTP/2 de larga vida: los gateways siguen pegados a los pods viejos', 'La readiness del pod nuevo falló', 'Triton necesita reiniciar el gateway'], answer: 1,
              explain: 'Hace falta balanceo por request (L7), balanceo del lado del cliente con un headless service o un tiempo máximo de vida de las conexiones.' },
            { q: 'Ocho respuestas de 50 a 1,000 tokens (2,400 en total) en un batch estático. ¿Qué fracción del batch hace trabajo útil?', options: ['100 %', '≈ 70 %', '30 %', '≈ 12 %'], answer: 2,
              explain: '2,400 / (8 × 1,000) = 30 %. Continuous batching mete una secuencia nueva en cuanto termina otra.' },
          ] },
          { t: 'checklist', id: 'antes-de-elegir-servidor', items: [
            { id: 'corte', html: 'Separo lo que hace el model server (cargar, encolar, batchear, salud y métricas) de lo que se queda en el gateway (auth, reglas, fallbacks, contrato).' },
            { id: 'generativo', html: 'Digo si el modelo genera tokens (LLM: KV cache, continuous batching, streaming) o es request/response (CNN, ranker).' },
            { id: 'carga', html: 'Tengo el QPS por GPU y sé si el batching tiene material: con pocos requests por ventana, forma batches de 1–3.' },
            { id: 'mvp', html: 'Propongo un MVP simple (FastAPI + PyTorch) y digo qué se rompe primero y cuándo paso a un model server.' },
            { id: 'modelos', html: 'Sé cuántos modelos comparten la GPU y cómo evito al vecino ruidoso (colas separadas, rate limiter, VRAM medida, alertas de cómputo por modelo).' },
            { id: 'pipeline', html: 'Si hay varios modelos, elijo cómo se conectan: ensemble, BLS o Ray Serve, con su porqué.' },
            { id: 'operador', html: 'Justifico la plataforma por quién la opera: Deployments propios, KServe o endpoint administrado.' },
            { id: 'protocolo', html: 'Elijo protocolo y formato con el tamaño del tensor en la mano (binario o gRPC, nunca floats en JSON) y resuelvo el balanceo si uso gRPC.' },
            { id: 'versiones', html: 'Explico cómo conviven dos versiones para un canary o un A/B y dónde se asigna el brazo.' },
            { id: 'estado', html: 'Verifico el estado del proyecto antes de proponerlo: TorchServe archivado, TGI en mantenimiento, licencia de Seldon Core.' },
            { id: 'cold-start', html: 'Cuento el cold start: tamaño de imagen, carga del modelo y warmup.' },
            { id: 'medir', html: 'Cierro con cómo lo mido (perf_analyzer o un load test al QPS de diseño) en vez de citar un benchmark ajeno.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm07-01', kind: 'concepto', q: '¿Qué hace un model server y qué se queda en el gateway?',
        a: 'Model server: cargar modelos y versiones, encolar, batchear, ubicar en la GPU (instancias), protocolos, salud y métricas, varios modelos por GPU. Gateway: identidad y cuotas del caller, reglas del producto (top-k, umbrales, labels), validación y decode de bytes no confiables, fallbacks, contrato público y logs con contexto.' },
      { id: 'm07-02', kind: 'tradeoff', q: '¿Por qué c01 separa gateway (CPU) y Triton (GPU), y qué cuesta?',
        a: 'Escalan con recursos distintos (HPA por CPU vs KEDA por cola), cambian a ritmos distintos, aíslan el parseo de bytes hostiles y el model server se vuelve reemplazable. Cuesta un salto de red con 602 KB por request (≈ 2.4 Gb/s a 500 req/s), ruteo por zona y un componente más.' },
      { id: 'm07-03', kind: 'trampa', q: '<code>with torch.inference_mode(): await run_in_threadpool(predict, x)</code>. ¿Qué está mal?',
        a: 'El modo de autograd es por thread: queda activo en el event loop, no en el thread del pool donde corre predict. Medido: True en el loop, False en el pool, y la salida con requires_grad=True. El with va dentro de la función que corre en el thread.' },
      { id: 'm07-04', kind: 'trampa', q: '<code>uvicorn --workers 4</code> con el modelo en GPU: ¿qué obtienes?',
        a: '4 procesos: 4 copias de los pesos y 4 contextos CUDA (≈ 0.3–1 GB cada uno), turnándose la GPU con batch 1 y sin batching entre ellos. ResNet-50 cabe (≈ 1.6–4.4 GB); un 8B en BF16 (16.1 GB) no cabe ni dos veces en una L4.' },
      { id: 'm07-05', kind: 'concepto', q: 'Lo que te falta en FastAPI + PyTorch frente a Triton.',
        a: 'Dynamic batching, varias instancias por GPU, versiones y recarga, métricas de cola vs cómputo, readiness por modelo, timeout y prioridad en la cola, un protocolo estándar para tensores y backends optimizados. Todo se puede escribir; ese es el costo.' },
      { id: 'm07-06', kind: 'numero', q: 'Puertos y defaults de Triton.',
        a: 'HTTP 8000, gRPC 8001, métricas 8002. Salud: /v2/health/live y /v2/health/ready (por modelo, /v2/models/&lt;m&gt;/ready). Por defecto: version_policy latest 1, una instancia por GPU, modo de control none.' },
      { id: 'm07-07', kind: 'concepto', q: 'Modos de control de modelos de Triton.',
        a: 'none (default): carga todo al arrancar, ignora cambios; c01 con imagen inmutable. poll: relee el repository periódicamente; desaconsejado en producción (puede ver cambios a medias). explicit: --load-model y luego la API load/unload; muchos modelos que entran y salen.' },
      { id: 'm07-08', kind: 'tradeoff', q: 'Ensemble vs BLS en Triton.',
        a: 'Ensemble: DAG fijo en el config, casi sin costo (C++), los tensores intermedios no salen de Triton, cada modelo conserva su cola y batching. BLS: model.py del Python backend que llama a otros modelos con if y loops (cascadas); cuesta un proceso Python por instancia.' },
      { id: 'm07-09', kind: 'concepto', q: 'Backends de Triton y cuál usa c01.',
        a: 'TensorRT (tensorrt_plan, c01), ONNX Runtime, PyTorch (pytorch_libtorch; torch_aoti desde 26.03), Python, OpenVINO, DALI, FIL, vLLM y TensorRT-LLM. TensorFlow dejó de venir en los contenedores desde la 25.03.' },
      { id: 'm07-10', kind: 'trampa', q: '"Subo el engine a S3 y Triton lo toma solo con poll."',
        a: 'Es un deploy sin canary ni rollback trazable, y Triton puede leer un archivo a medio subir; su documentación desaconseja poll en producción. Usa explicit y que el pipeline de despliegue pida la carga, o hornea el modelo en la imagen como c01.' },
      { id: 'm07-11', kind: 'concepto', q: 'Ray Serve en cuatro piezas.',
        a: 'Deployments (clases con réplicas), composición con DeploymentHandle (.remote()), autoscaling por requests en curso (target_ongoing_requests, default 2) y @serve.batch (default 10 ítems, 10 ms). Ojo: max_ongoing_requests (default 5) topa el tamaño del batch.' },
      { id: 'm07-12', kind: 'trampa', q: '¿num_gpus: 0.5 en Ray Serve divide la GPU en dos?',
        a: 'No: es contabilidad del scheduler. La documentación de Ray dice que es responsabilidad del usuario no pasarse de su parte de memoria. Una réplica que se come la VRAM tumba a la otra con out of memory.' },
      { id: 'm07-13', kind: 'tradeoff', q: 'Ray Serve vs BentoML.',
        a: 'Ray Serve: grafos de varios modelos en Python, GPU fraccional, autoscaling propio; cuesta operar un cluster de Ray. BentoML: empaquetado (Bento → imagen OCI), adaptive batching y buena experiencia de desarrollo; corre donde corra un contenedor. Los dos pagan overhead de Python frente al núcleo en C++ de Triton.' },
      { id: 'm07-14', kind: 'numero', q: 'Estado de TorchServe, con fechas.',
        a: 'Última release v0.12.0 (30-sep-2024); aviso de Limited Maintenance (28-feb-2025): sin arreglos ni parches de seguridad; repositorio archivado (7-ago-2025). Para sistemas nuevos, no; si existe, contener el riesgo y migrar modelo por modelo.' },
      { id: 'm07-15', kind: 'concepto', q: '¿KServe compite con Triton?',
        a: 'No: KServe es una capa de Kubernetes (InferenceService) que despliega un runtime (Triton, vLLM, MLServer o propio) y agrega autoscaling (Knative por concurrencia o Standard con HPA/KEDA), canary, transformer para preprocesamiento e InferenceGraph.' },
      { id: 'm07-16', kind: 'concepto', q: '¿Por qué un LLM no se sirve como una CNN?',
        a: 'Trabajo variable (prefill + un paso por token), KV cache que crece por token y limita la concurrencia, batching que debe decidirse en cada paso (continuous), decode memory-bound, streaming de tokens y API compatible con OpenAI.' },
      { id: 'm07-17', kind: 'numero', q: 'Batch estático con respuestas de 50, 80, 120, 200, 250, 300, 400 y 1,000 tokens: ¿cuánto trabajo útil?',
        a: '2,400 tokens útiles sobre 8 × 1,000 = 8,000 lugares: 30 %. El batch espera a la más larga. Continuous batching mete una secuencia nueva en cuanto termina otra.' },
      { id: 'm07-18', kind: 'concepto', q: 'PagedAttention en una frase, y qué reporta su paper.',
        a: 'Guarda el KV cache en bloques de tamaño fijo, como páginas de memoria virtual, en vez de reservar el largo máximo contiguo por secuencia: casi sin desperdicio y con bloques compartibles. Kwon et al., SOSP 2023: 2–4× throughput a igual latencia frente a FasterTransformer y Orca.' },
      { id: 'm07-19', kind: 'tradeoff', q: 'vLLM vs SGLang vs TensorRT-LLM.',
        a: 'vLLM: default, la mayor cobertura de modelos y hardware. SGLang: RadixAttention, rinde con prefijos compartidos, agentes y salidas estructuradas. TensorRT-LLM: máximo en NVIDIA, más complejidad y acoplamiento. Entre ellos se decide midiendo con tu carga.' },
      { id: 'm07-20', kind: 'numero', q: 'Estado de TGI, con fechas.',
        a: 'Modo mantenimiento desde el 11-dic-2025 (solo arreglos menores y documentación), última release v3.3.7 (19-dic-2025), repositorio archivado el 21-mar-2026. Hugging Face recomienda vLLM o SGLang (llama.cpp o MLX en local).' },
      { id: 'm07-21', kind: 'numero', q: 'El tensor de c01 en binario, base64, JSON y UINT8.',
        a: 'Binario 602 KB; base64 ≈ 803 KB; JSON ≈ 3.1 MB (≈ 20.6 B por valor, ≈ 5×); UINT8 ≈ 151 KB. A 500 req/s: 2.4 vs 12.4 Gb/s, y ≈ 50 ms de CPU por request solo para serializar el JSON en Python (medido en laptop).' },
      { id: 'm07-22', kind: 'concepto', q: 'Endpoints del protocolo KServe v2 (Open Inference Protocol).',
        a: 'GET /v2/health/live y /v2/health/ready; GET /v2/models/&lt;m&gt;[/versions/&lt;v&gt;]/ready; GET /v2/models/&lt;m&gt; (metadata); POST /v2/models/&lt;m&gt;[/versions/&lt;v&gt;]/infer. Lo implementan Triton, KServe, MLServer y OpenVINO Model Server. La extensión binaria es de Triton.' },
      { id: 'm07-23', kind: 'tradeoff', q: 'SSE vs stream de gRPC para mandar tokens.',
        a: 'SSE: HTTP normal, servidor → cliente, lo que usa la API de OpenAI; cuida el buffering de proxies y el idle timeout del balanceador. gRPC: HTTP/2 de punta a punta, tipado, bidireccional; necesita balanceo L7 y, en navegador, gRPC-Web.' },
      { id: 'm07-24', kind: 'tradeoff', q: '¿Dónde pones el preprocesamiento de c01 y por qué no en un ensemble?',
        a: 'En el gateway: escala por CPU barata y aísla bytes hostiles, a costa de mandar 602 KB por la red. En un ensemble con Python backend usaría la CPU del nodo GPU: ≈ 3 cores de decode en el pico contra 4 vCPU de una g4dn.xlarge, con Triton ya pidiendo 2.' },
      { id: 'm07-25', kind: 'frase', q: '¿Cómo justificas en inglés Triton para c01?',
        a: '"Triton gives me dynamic batching, two model instances per GPU and per-model queue and compute metrics out of the box. The price is a big image and an engine that has to match the GPU, so we build it in CI on the same GPU type."' },
      { id: 'm07-26', kind: 'frase', q: '¿Cómo respondes en inglés "why not just FastAPI"?',
        a: '"For the MVP, yes: one process, the weights loaded at startup and inference in a thread pool. It breaks first on throughput, because every request runs at batch size one, so at full traffic inference moves to Triton and FastAPI stays as the gateway."' },
      { id: 'm07-27', kind: 'frase', q: '¿Cómo eliges en inglés el servidor de un LLM?',
        a: '"I\'d start with vLLM: continuous batching and PagedAttention keep the GPU busy, because the KV cache, not compute, limits concurrency. SGLang if most requests share a long prefix; TensorRT-LLM only if we\'re all-in on NVIDIA."' },
    ],

    // ---------------------------------------------------------- glosario
    // Términos nuevos de este módulo. model server, Triton Inference Server, KServe, KServe v2
    // protocol, dynamic batching, instance group, perf_analyzer, model_analyzer, KV cache,
    // prefill and decode, event loop, L4 vs L7 load balancing y headless service ya los
    // definen módulos anteriores: no se repiten.
    glossary: [
      { en: 'model repository', es: 'repositorio de modelos', def: 'Directorio (local, S3, GCS o Azure) donde Triton busca los modelos: una carpeta por modelo con su <code>config.pbtxt</code> y una subcarpeta numerada por versión.', say: 'The model repository has one folder per model and one numbered subfolder per version.' },
      { en: 'version policy', es: 'política de versiones', def: 'Campo de la configuración de un modelo en Triton que decide qué versiones del repository se cargan: latest (por defecto, la más alta), specific o all.', say: 'With a specific version policy, versions three and four stay loaded side by side.' },
      { en: 'model control mode', es: 'modo de control de modelos', def: 'Cuándo Triton lee el repository: none (solo al arrancar, el default), poll (periódicamente; no recomendado en producción) o explicit (lo que se pida por la API de carga).', say: 'We run Triton in model control mode none, so the image fully defines what gets served.' },
      { en: 'Triton backend', es: 'backend de Triton', def: 'La librería que ejecuta un tipo de modelo dentro de Triton: TensorRT, ONNX Runtime, PyTorch, Python, OpenVINO, DALI, FIL, vLLM o TensorRT-LLM. Cada modelo declara el suyo.', say: 'Each model picks its backend, so a TensorRT engine and an ONNX model can share one Triton.' },
      { en: 'ensemble model', es: 'modelo ensemble (pipeline en Triton)', def: 'Modelo de Triton (<code>platform: "ensemble"</code>) que encadena otros modelos como un DAG fijo; los tensores intermedios no salen del servidor. No confundir con un ensemble de aprendizaje que promedia modelos.', say: 'An ensemble chains preprocessing and the classifier inside Triton, so the intermediate tensor never crosses the network.' },
      { en: 'Business Logic Scripting (BLS)', es: 'BLS (lógica de negocio en Triton)', def: 'Un modelo del Python backend de Triton que llama a otros modelos del mismo servidor con condicionales, loops y lógica propia.', say: 'We use BLS for the cascade: the small model runs first and the big one only when confidence is low.' },
      { en: 'TorchServe', es: 'TorchServe', def: 'Model server de PyTorch desarrollado por AWS y Meta, con handlers en Python y API de administración. En mantenimiento limitado desde febrero de 2025 y archivado desde agosto de 2025: sin parches de seguridad.', say: 'TorchServe has been archived since August 2025, so I wouldn\'t start anything new on it.' },
      { en: 'BentoML', es: 'BentoML', def: 'Framework de Python para construir y empaquetar servicios de inferencia: decoradores, adaptive batching y un artefacto (Bento) que se convierte en imagen OCI. Parte de Modular desde febrero de 2026; sigue en Apache 2.0.', say: 'BentoML packages the service, the model and its dependencies into one image we can deploy anywhere.' },
      { en: 'adaptive batching', es: 'batching adaptativo', def: 'Variante del dynamic batching (BentoML) que ajusta la espera según el tráfico y el tiempo de proceso recientes, dentro de un tamaño y una latencia máximos.', say: 'Adaptive batching waits longer under heavy traffic and barely waits when it\'s quiet.' },
      { en: 'Ray Serve', es: 'Ray Serve', def: 'Librería de serving sobre Ray: deployments con réplicas, composición de modelos en Python, autoscaling por requests en curso, GPUs fraccionales y batching con un decorador.', say: 'Ray Serve lets each model in the pipeline scale on its own while the glue code stays in Python.' },
      { en: 'model composition', es: 'composición de modelos', def: 'Servir un pipeline de varios modelos (detector → clasificador por recorte) como un solo servicio, con llamadas internas entre modelos que escalan por separado.', say: 'The detector fans out each crop to the classifier through model composition.' },
      { en: 'fractional GPU', es: 'GPU fraccional', def: 'Pedirle al scheduler una fracción de GPU (en Ray, <code>num_gpus: 0.5</code>) para poner varias réplicas en una. Es contabilidad: no aísla memoria ni cómputo.', say: 'Two replicas get half a GPU each, but nothing stops one of them from using all the memory.' },
      { en: 'InferenceService', es: 'InferenceService (KServe)', def: 'Recurso de Kubernetes de KServe que despliega un model server (runtime) con autoscaling, canary, un transformer opcional para pre y posprocesamiento y el protocolo de inferencia estándar.', say: 'Each model is one InferenceService, with Triton as the runtime underneath.' },
      { en: 'Knative', es: 'Knative', def: 'Plataforma serverless sobre Kubernetes que escala por concurrencia y puede bajar a cero, reteniendo requests mientras arranca un pod. KServe la usa en su modo Knative.', say: 'In Knative mode KServe scales on concurrency and can go to zero, which fits the internal tools but not our online path.' },
      { en: 'managed endpoint', es: 'endpoint administrado', def: 'Servicio de la nube (SageMaker AI, Vertex AI, Azure ML) que corre tu modelo o tu contenedor y se encarga de instancias, autoscaling, despliegues y métricas, con sobreprecio por instancia.', say: 'Without a platform team, I\'d start on a managed endpoint and revisit when we have many models.' },
      { en: 'vLLM', es: 'vLLM', def: 'Motor de serving de LLMs con PagedAttention, continuous batching, prefix caching y servidor compatible con OpenAI. La opción por defecto para modelos de pesos abiertos.', say: 'We serve the model with vLLM behind an OpenAI-compatible endpoint.' },
      { en: 'PagedAttention', es: 'PagedAttention', def: 'Técnica de vLLM que guarda el KV cache en bloques de tamaño fijo, como páginas de memoria virtual, en vez de reservar el largo máximo contiguo por secuencia: casi sin desperdicio y con bloques compartibles.', say: 'PagedAttention keeps KV cache waste low, so more sequences fit on the GPU at once.' },
      { en: 'continuous batching', es: 'batching continuo', def: 'Batching de LLMs que decide el batch en cada paso de decode: cuando una secuencia termina, otra entra. También se llama in-flight batching o batching a nivel de iteración.', say: 'With continuous batching, a short answer frees its slot right away instead of waiting for the longest one.' },
      { en: 'prefix caching', es: 'caché de prefijos', def: 'Reutilizar el KV cache ya calculado de un prefijo (system prompt, contexto compartido) entre requests, para no repetir su prefill.', say: 'Our system prompt is two thousand tokens, so prefix caching saves most of the prefill.' },
      { en: 'RadixAttention', es: 'RadixAttention', def: 'Técnica de SGLang que guarda los prefijos del KV cache en un árbol radix para reutilizarlos entre requests con el mismo comienzo.', say: 'RadixAttention pays off when agents call the model again and again with the same context.' },
      { en: 'SGLang', es: 'SGLang', def: 'Motor de serving de LLMs de LMSYS con RadixAttention, un scheduler de bajo overhead, salidas estructuradas rápidas y API compatible con OpenAI.', say: 'For the agent workload I\'d benchmark SGLang against vLLM, since most calls share a long prefix.' },
      { en: 'Text Generation Inference (TGI)', es: 'TGI', def: 'Servidor de LLMs de Hugging Face. En modo mantenimiento desde diciembre de 2025 y archivado desde marzo de 2026; Hugging Face recomienda vLLM o SGLang.', say: 'TGI is in maintenance mode, so new models land in vLLM and SGLang first.' },
      { en: 'TensorRT-LLM', es: 'TensorRT-LLM', def: 'Librería de NVIDIA para inferencia de LLMs: kernels propios, cuantización FP8/FP4, in-flight batching y serving desagregado. Máximo rendimiento en NVIDIA, más acoplamiento y complejidad.', say: 'TensorRT-LLM only makes sense if we\'re all-in on NVIDIA and have people to run it.' },
      { en: 'NVIDIA Dynamo', es: 'NVIDIA Dynamo', def: 'Capa de orquestación distribuida de NVIDIA sobre motores de LLM (vLLM, SGLang, TensorRT-LLM): prefill y decode en pools separados, ruteo según el KV cache y KV cache en CPU o disco. No es Dynamo-Triton.', say: 'Dynamo only pays off once prefill and decode are fighting over GPUs across several nodes.' },
      { en: 'disaggregated serving', es: 'serving desagregado', def: 'Correr el prefill y el decode de un LLM en grupos de GPUs distintos, para que los prompts largos no frenen la generación de los demás y cada fase escale por separado.', say: 'With disaggregated serving, long prompts stop hurting the token rate of everyone else.' },
      { en: 'OpenAI-compatible API', es: 'API compatible con OpenAI', def: 'Implementar los endpoints de OpenAI (<code>/v1/chat/completions</code>, <code>/v1/completions</code>, <code>/v1/embeddings</code>) para que cualquier cliente o SDK de OpenAI funcione contra tu servidor.', say: 'Because the engine exposes an OpenAI-compatible API, we can swap engines without touching the clients.' },
      { en: 'Server-Sent Events (SSE)', es: 'eventos enviados por el servidor', def: 'Streaming de servidor a cliente sobre HTTP normal (<code>text/event-stream</code>), un evento <code>data:</code> por fragmento. Es como se mandan los tokens en la API de OpenAI.', say: 'Tokens stream to the client over server-sent events, so the first words show up in a few hundred milliseconds.' },
      { en: 'gRPC', es: 'gRPC', def: 'Framework de RPC sobre HTTP/2 con mensajes protobuf: binario, tipado, con streams y multiplexación de muchos requests en una conexión, lo que exige balanceo por request (L7).', say: 'If we move to gRPC, we need per-request load balancing, or new Triton pods get no traffic.' },
      { en: 'binary tensor extension', es: 'extensión binaria de tensores', def: 'Extensión de Triton al protocolo KServe v2 por HTTP: un header JSON corto seguido de los bytes crudos del tensor, en lugar de los números como texto.', say: 'The gateway sends the tensor with the binary extension, which is five times smaller than JSON.' },
      { en: 'GIL (global interpreter lock)', es: 'candado global del intérprete', def: 'Candado del CPython estándar que deja correr bytecode de Python en un solo thread a la vez por proceso (existe un build opcional sin GIL). Las ops de PyTorch y NumPy lo sueltan; el código Python puro, no.', say: 'The GIL isn\'t the problem inside PyTorch ops, but our pure-Python postprocessing pins one core.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
