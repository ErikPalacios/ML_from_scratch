/* =============================================================================
   Ronda de Diseño ML — js/content/m08-optimizacion.js
   Módulo 08: optimización de modelos para inferencia. Cuándo vale la pena, el
   mapa de técnicas, ONNX y ONNX Runtime, TensorRT, cuantización (PTQ/QAT,
   calibración), pruning y destilación, torch.compile, inferencia en CPU y cómo
   validar una optimización antes de lanzarla.
   Contrato: docs/SPEC.md §5. Números del caso 1 idénticos a c01-clasificacion.js
   y reference/c01 (export_onnx.py, parity_check.py, build_engine.sh, config.pbtxt).
   Verificado (sept. 2026) contra la documentación de TensorRT 10.x/11.x (release
   notes 11.0, engine compatibility, trtexec; en oct. 2026, las release notes 8.6 y
   10.9: ampere+ y version compatibility son de la 8.6, kSAME_COMPUTE_CAPABILITY de
   la 10.9, y el Triton 24.08 del c01 trae TensorRT 10.3), ONNX Runtime 1.30 (execution
   providers, quantization, graph optimizations, TensorRT EP), PyTorch 2.14
   (torch.onnx, torch.compile, AOTInductor), NVIDIA Model Optimizer y OpenVINO.
   Mediciones propias: Mac con Apple M4 (10 núcleos), torch 2.14, ONNX Runtime 1.30,
   ResNet-50 con 500 clases y pesos aleatorios (sirven para tiempos, no para accuracy).
   Los snippets de Python corrieron en ese entorno; los de trtexec no (no hay GPU
   NVIDIA aquí): sus flags salen de la documentación de TensorRT 10.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';
  // Etiqueta corta para lo medido en la Mac; el aviso completo va una sola vez, en el callout de la sección 2.
  const MAC = 'laptop M4';

  // ------------------------------------------------------------ diagrama
  // Pipeline de optimización del c01. Carril offline (y 0–31) con dos filas: build y gates
  // (y 6–14) de izquierda a derecha, y la vuelta por perf → registry (y 20–28) de derecha a
  // izquierda. Carril online (y 33–50): canary → métricas → decisión → estable, de derecha a
  // izquierda. Columnas x = 2, 24, 46, 68, 90 (w 16, huecos de 6 para las etiquetas).
  // La rama de CPU sale por debajo de "Export" (x = 32) y vuelve a "Paridad" por y = 17.
  const PIPELINE = {
    width: 108, height: 50,
    lanes: [
      { id: 'ci', label: 'CI: se construye y se valida en la GPU de destino', x: 0, y: 0, w: 108, h: 31, kind: 'offline' },
      { id: 'prod', label: 'Producción', x: 0, y: 33, w: 108, h: 17, kind: 'online' },
    ],
    nodes: [
      { id: 'ckpt', label: 'Checkpoint FP32', sub: 'el que evaluaste', x: 2, y: 6, w: 16, h: 8, kind: 'store',
        note: 'El <code>state_dict</code> de PyTorch que pasó la evaluación offline. Es la <b>referencia</b>: todo lo que viene después (ONNX, engine, INT8) se compara contra él, sobre las mismas imágenes y con el mismo preproceso. Si lo pierdes, ya no puedes probar que el artefacto optimizado se comporta igual.' },
      { id: 'onnx', label: 'Export a ONNX', sub: 'opset 17 · batch 1–32', x: 24, y: 6, w: 16, h: 8, kind: 'job',
        note: 'En el c01, <code>export_onnx.py</code> exporta en <code>eval()</code> con el exportador TorchScript (<code>dynamo=False</code>), opset 17, eje de batch dinámico y los nombres <code>input</code>/<code>logits</code> del contrato con Triton. Antes de seguir, corre el ONNX en ONNX Runtime con batch 1 y 32 y lo compara con PyTorch (<a href="#m08.onnx">sección 3</a>).' },
      { id: 'engine', label: 'Build del engine', sub: 'trtexec FP16 en una T4', x: 46, y: 6, w: 16, h: 8, kind: 'job',
        note: 'TensorRT compila el ONNX para UNA arquitectura de GPU y UNA versión de TensorRT. Por eso el c01 lo construye en CI sobre una T4 (sm_75), dentro del contenedor <code>tensorrt:24.08</code>, la misma release que el Triton que lo sirve (<a href="#m08.tensorrt">sección 4</a>).' },
      { id: 'parity', label: 'Gate de paridad', sub: 'top-1 ≥ 99.5 %', x: 68, y: 6, w: 16, h: 8, kind: 'job',
        note: 'Pregunta numérica: ¿el artefacto optimizado predice lo mismo que PyTorch FP32? En el c01, ≈ 10k imágenes del golden set: acuerdo top-1 ≥ 99.5 %, solapamiento del top-5 y la diferencia máxima de logits. No dice si el modelo es bueno; dice si es el mismo modelo.' },
      { id: 'quality', label: 'Gate de calidad', sub: 'golden set por slices', x: 90, y: 6, w: 16, h: 8, kind: 'job',
        note: 'Pregunta de producto: ¿cuánta calidad perdiste y dónde? Top-1/top-5 con test pareado (≥ −0.3 pp contra el champion en el c01), recall por clase head vs long tail, slices (móvil/web, poca luz, imágenes chicas) y calibración (ECE ≤ 0.05). Aquí es donde INT8 suele fallar, no en el promedio.' },
      { id: 'ort', label: 'ONNX Runtime', sub: 'CPU · INT8 estático', x: 46, y: 20, w: 16, h: 8, kind: 'model',
        note: 'La rama alternativa: el mismo ONNX, cuantizado a INT8 con calibración y servido con ONNX Runtime en CPU. Es el experimento de la semana 1 que deja abierto el c01: si cumple ≈ 15 ms por imagen por vCPU sin perder más de 0.5 pp en el golden set, se elimina el tier de GPU (<a href="#m08.cpu-inferencia">sección 8</a>).' },
      { id: 'registry', label: 'Model registry', sub: 'challenger + huellas', x: 68, y: 20, w: 16, h: 8, kind: 'store',
        note: 'Se registra como challenger el paquete completo: ONNX, engine, <code>labels.json</code>, versión del preproceso, métricas de los gates y las huellas del build (sha256 del ONNX y del plan, GPU y release de NGC). Sin esas huellas no sabes qué engine corre dónde cuando algo falla.' },
      { id: 'perf', label: 'Gate de latencia', sub: 'perf_analyzer a 250 req/s', x: 90, y: 20, w: 16, h: 8, kind: 'job',
        note: 'perf_analyzer contra Triton con el engine nuevo, en la GPU de destino y con la configuración real (dynamic batching, 2 instancias), al pico de diseño por GPU (250 req/s) y en failover (500 req/s). En el c01 el p99 no puede empeorar más de 10 % contra el champion. trtexec solo mide el engine; perf_analyzer mide lo que ve el gateway.' },
      { id: 'canary', label: 'Canary', sub: '5 % → 25 % → 100 %', x: 68, y: 38, w: 16, h: 8, kind: 'gpu',
        note: 'Una release nueva (gateway + Triton) recibe un porcentaje del tráfico real. Lo precede un shadow de 1–2 días. Es la primera vez que el modelo optimizado ve la distribución de producción completa, con fotos que el golden set no tiene.' },
      { id: 'metrics', label: 'Métricas online', sub: 'p99, 5xx, baja confianza', x: 46, y: 38, w: 16, h: 8, kind: 'monitor',
        note: 'Se comparan contra la release estable en la misma ventana: 5xx, p99, tasa de baja confianza (top-1 &lt; 0.3) y PSI de las categorías predichas. Una cuantización que desplazó los scores se ve aquí como más requests de baja confianza, aunque el accuracy no haya cambiado.' },
      { id: 'decide', label: 'Decide el rollout', sub: 'umbrales automáticos', x: 24, y: 38, w: 16, h: 8, kind: 'service',
        note: 'Rollback automático si cruza un umbral (en el c01: 5xx &gt; 0.5 %, p99 &gt; 200 ms o &gt; 1.2× el estable, baja confianza &gt; 1.5× el estable). Si no, avanza de etapa. Nadie decide a ojo a las 3 a. m.' },
      { id: 'stable', label: 'Triton estable', sub: 'champion (95 %)', x: 2, y: 38, w: 16, h: 8, kind: 'gpu',
        note: 'La release que sirve al resto del tráfico mientras dura el canary. Sigue viva 24–48 h después de promover la nueva, para volver con un cambio de ruteo si aparece un problema tarde (<a href="#c01.evaluacion">c01, evaluación</a>).' },
    ],
    edges: [
      { from: 'ckpt', to: 'onnx', kind: 'offline', label: 'pesos' },
      { from: 'onnx', to: 'engine', kind: 'offline', label: '.onnx' },
      { from: 'engine', to: 'parity', kind: 'offline', label: '.plan' },
      { from: 'parity', to: 'quality', kind: 'offline', label: 'pasa' },
      { from: 'quality', to: 'perf', kind: 'offline', fromSide: 'b', toSide: 't' },
      { from: 'perf', to: 'registry', kind: 'offline', fromSide: 'l', toSide: 'r', label: 'pasa' },
      { from: 'onnx', to: 'ort', kind: 'offline', dashed: true, fromSide: 'b', toSide: 'l', via: [[32, 24]] },
      { from: 'ort', to: 'parity', kind: 'offline', dashed: true, fromSide: 't', toSide: 'b', via: [[54, 17], [76, 17]] },
      { from: 'registry', to: 'canary', kind: 'neutral', fromSide: 'b', toSide: 't', label: 'despliega' },
      { from: 'canary', to: 'metrics', kind: 'monitor', fromSide: 'l', toSide: 'r', label: 'compara' },
      { from: 'metrics', to: 'decide', kind: 'monitor', fromSide: 'l', toSide: 'r', label: 'umbrales' },
      { from: 'decide', to: 'stable', kind: 'online', fromSide: 'l', toSide: 'r', label: 'promueve' },
    ],
    flows: [
      { id: 'gpu-c01', label: 'El engine FP16 del caso 1', steps: [
        { nodes: ['ckpt', 'onnx'], edges: ['ckpt>onnx'], text: 'El checkpoint FP32 se exporta en <code>eval()</code> a ONNX opset 17 con batch dinámico 1–32. El script verifica el opset real del archivo y corre el ONNX en ONNX Runtime con batch 1 y 32 contra PyTorch: FP32 contra FP32 da diferencias de ≈ 1e-4.' },
        { nodes: ['onnx', 'engine'], edges: ['onnx>engine'], text: 'En un runner de CI con T4, <code>trtexec --fp16</code> construye el engine con el perfil min 1 / opt 16 / max 32, dentro del contenedor de TensorRT de la misma release de NGC que Triton (24.08).' },
        { nodes: ['engine', 'parity'], edges: ['engine>parity'], text: 'Gate de paridad: ≈ 10k imágenes del golden set por el engine servido en Triton y por PyTorch FP32, con el mismo preproceso. Acuerdo top-1 ≥ 99.5 %; FP16 da diferencias de logits del orden de 1e-2.' },
        { nodes: ['parity', 'quality'], edges: ['parity>quality'], text: 'Gate de calidad sobre el golden set de 50k: top-1/top-5 no inferiores (≥ −0.3 pp, test pareado), recall por clase, slices y ECE. Con FP16 casi nunca cambia nada; con INT8, aquí se decide.' },
        { nodes: ['quality', 'perf', 'registry'], edges: ['quality>perf', 'perf>registry'], text: 'perf_analyzer a 250 y 500 req/s por GPU: p99 ≤ champion + 10 %. Si pasa, se registra como challenger con el ONNX, el plan y sus huellas.' },
        { nodes: ['registry', 'canary'], edges: ['registry>canary'], text: 'Shadow de 1–2 días y luego canary 5 % → 25 % → 100 %, cada etapa cubriendo al menos un pico diurno.' },
        { nodes: ['canary', 'metrics', 'decide', 'stable'], edges: ['canary>metrics', 'metrics>decide', 'decide>stable'], text: 'Las métricas del canary se comparan contra el estable en la misma ventana. Si nada cruza un umbral, se promueve; la release anterior queda viva un par de días.' },
      ] },
      { id: 'cpu-int8', label: 'ResNet-50 INT8 en CPU', steps: [
        { nodes: ['onnx', 'ort'], edges: ['onnx>ort'], text: 'El mismo ONNX se cuantiza a INT8 estático (Q/DQ, escalas por canal) con ≈ 500–1,000 imágenes del tráfico real pasadas por el preproceso del gateway. El archivo baja de 98 MB a ≈ 25 MB.' },
        { nodes: ['ort', 'parity'], edges: ['ort>parity'], text: 'El acuerdo top-1 de INT8 contra FP32 va a ser menor que el de FP16. Su umbral se fija con datos; lo que decide es el gate siguiente.' },
        { nodes: ['parity', 'quality'], edges: ['parity>quality'], text: 'El criterio del c01 para migrar a CPU: no perder más de 0.5 pp en el golden set, y mirar el long tail y los slices por separado.' },
        { nodes: ['quality', 'perf'], edges: ['quality>perf'], text: 'La latencia se mide en el tipo de instancia de producción (c6i con VNNI o c7i con AMX), en ms por imagen por vCPU, no en tu laptop. Objetivo del c01: ≈ 15 ms.' },
        { nodes: ['perf', 'registry', 'canary'], edges: ['perf>registry', 'registry>canary'], text: 'Si pasa, entra por el mismo canary que cualquier modelo. El tier de GPU se retira solo cuando la versión CPU lleva días estable.' },
      ] },
      { id: 'falla', label: 'Cuando un gate falla', steps: [
        { nodes: ['parity'], edges: [], text: 'Paridad de 97 % en FP16: no es redondeo, es un bug. Preproceso distinto, opset mal convertido u orden de labels. Vuelve al ONNX FP32 en ONNX Runtime: si ahí ya falla, el problema está en el export.' },
        { nodes: ['quality'], edges: [], text: 'INT8 cae en un slice: prueba escalas por canal, calibración por percentil, dejar en FP16 las capas sensibles o QAT. O no lances INT8: si no quita máquinas, no compra nada.' },
        { nodes: ['perf'], edges: [], text: 'El p99 empeora: revisa que el perfil del engine esté afinado para los batches reales (≈ 1–3 online, no 16) y el número de instancias; compara contra un engine con opt 4.' },
        { nodes: ['metrics', 'decide'], edges: ['metrics>decide'], text: 'El canary cruza un umbral: rollback automático en segundos (el peso vuelve al estable). Después, el postmortem: ¿qué no vio el golden set?' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código (snippets)
  // Extracto de reference/c01/model/export_onnx.py (la llamada real, sin el resto del script).
  const EXPORT_EXCERPT = `# Basado en model/export_onnx.py (c01): la misma llamada, con los comentarios resumidos
model = build_model(checkpoint)          # termina en model.eval(): BatchNorm y Dropout en modo inferencia
example = torch.randn(2, 3, 224, 224)    # batch 2, no 1: con 1 algunos tracers fijan el eje como constante
torch.onnx.export(
    model, (example,), "classifier.onnx",
    dynamo=False,                        # torch >= 2.9 usa el exportador dynamo por defecto: hay que pedir el TorchScript
    opset_version=17,                    # opset fijo: el ONNX es un contrato con el parser de TensorRT
    input_names=["input"], output_names=["logits"],                    # contrato con config.pbtxt y el gateway
    dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},   # eje 0 variable: Triton arma batches de 1 a 32
    do_constant_folding=True,            # precalcula lo constante: grafo más simple para TensorRT
)`;

  const PARITY_SNIPPET = `import numpy as np
import onnxruntime as ort
import torch


def paridad(model: torch.nn.Module, onnx_path: str, x: np.ndarray) -> dict:
    """x: imágenes REALES del golden set, ya pasadas por el preproceso del gateway."""
    model.eval()  # BatchNorm con sus running stats y Dropout apagado, como al exportar
    with torch.inference_mode():
        ref = model(torch.from_numpy(x)).numpy()  # la referencia: PyTorch FP32, lo que evaluaste
    sesion = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    got = sesion.run(["logits"], {"input": x})[0]  # nombres = contrato con Triton y el gateway
    top5_ref, top5_got = np.argsort(-ref, 1)[:, :5], np.argsort(-got, 1)[:, :5]
    return {
        "top1_agreement": float((ref.argmax(1) == got.argmax(1)).mean()),  # ¿cambia la 1.ª sugerencia?
        "top5_overlap": float(np.mean([len(set(a) & set(b)) / 5 for a, b in zip(top5_ref, top5_got)])),
        "max_abs_diff": float(np.abs(ref - got).max()),  # un salto grande = bug de export, no redondeo
    }`;

  const TRTEXEC_SNIPPET = `# TensorRT 10 (NGC 24.08, la release del c01), dentro del contenedor de TensorRT, en una T4.
# 1) Construir: perfil de batch dinámico 1–32 afinado para 16 (igual que model/build_engine.sh)
trtexec --onnx=classifier.onnx --saveEngine=model.plan --fp16 \\
  --minShapes=input:1x3x224x224 --optShapes=input:16x3x224x224 --maxShapes=input:32x3x224x224 \\
  --timingCacheFile=t4.cache    # guarda las mediciones de tácticas: el próximo build tarda menos

# 2) Medir el engine ya construido con el batch que ves online (1–3), no solo con el de opt
trtexec --loadEngine=model.plan --shapes=input:2x3x224x224 --noDataTransfers   # sin copias H2D/D2H: solo cómputo

# 3) ¿Qué capa se come el tiempo? Perfil por capa en una corrida aparte del benchmark
trtexec --loadEngine=model.plan --shapes=input:16x3x224x224 --dumpProfile --separateProfileRun

# Flota con L4, A10G y A100 (Ampere o más nueva): un solo engine, algo más lento. NO cubre la T4 (Turing).
trtexec --onnx=classifier.onnx --saveEngine=model_ampere_plus.plan --fp16 --hardwareCompatibilityLevel=ampere+ \\
  --minShapes=input:1x3x224x224 --optShapes=input:16x3x224x224 --maxShapes=input:32x3x224x224

# En TensorRT 11 (NGC 26.06+) --fp16 ya no existe: el ONNX se convierte a FP16 antes, con ModelOpt AutoCast
# python -m modelopt.onnx.autocast --onnx_path classifier.onnx`;

  const QUANT_SNIPPET = `from pathlib import Path

from onnxruntime.quantization import (CalibrationDataReader, CalibrationMethod,
                                      QuantFormat, QuantType, quantize_static)
from onnxruntime.quantization.shape_inference import quant_pre_process

from app.preprocess import preprocess  # el MISMO preproceso que el gateway (c01)


class LectorCalibracion(CalibrationDataReader):
    """Entrega una imagen preprocesada por llamada; ORT registra los rangos de activación."""

    def __init__(self, carpeta: str, n: int = 1000):
        # Una muestra del tráfico real, estratificada por slice (móvil/web, poca luz, long tail)
        self._archivos = iter(sorted(Path(carpeta).glob("*.jpg"))[:n])

    def get_next(self):
        f = next(self._archivos, None)
        if f is None:
            return None  # None = no hay más datos: termina la calibración
        return {"input": preprocess(f.read_bytes())[None]}  # [1, 3, 224, 224] float32


quant_pre_process("classifier.onnx", "classifier_pre.onnx")  # shape inference + limpieza del grafo
# ¿Para TensorRT? Agrega extra_options={"ActivationSymmetric": True} (zero point 0, lo que TensorRT exige) o usa ModelOpt
quantize_static(
    "classifier_pre.onnx", "classifier_int8.onnx", LectorCalibracion("calib/"),
    quant_format=QuantFormat.QDQ,     # pares QuantizeLinear/DequantizeLinear para ORT en CPU
    activation_type=QuantType.QInt8,  # S8S8: el default que recomienda ORT
    weight_type=QuantType.QInt8,
    per_channel=True,                 # una escala por canal de salida en los pesos de cada conv
    calibrate_method=CalibrationMethod.Percentile,  # recorta outliers (el default es MinMax)
)`;

  const COMPILE_SNIPPET = `import torch

from export_onnx import build_model  # model/export_onnx.py del c01

model = build_model("resnet50_500.pt")  # el ResNet-50 del c01 (500 clases); ya devuelve eval()
# dynamic=True: el batch arranca simbólico, pero igual salen 3 grafos (batch 1 especializado,
# 2–15 y ≥ 16 por una guarda de conv): el warmup de abajo los compila todos.
# En GPU, compara también mode="reduce-overhead" (CUDA graphs): menos overhead a batch chico.
compilado = torch.compile(model, dynamic=True)

with torch.inference_mode():
    for bs in (1, 2, 4, 8, 16, 32):  # warmup ANTES de que pase la readiness probe:
        compilado(torch.randn(bs, 3, 224, 224))  # la compilación se paga aquí, no en un request real`;

  const AOTI_SNIPPET = `import torch

from export_onnx import build_model  # model/export_onnx.py del c01

model = build_model("resnet50_500.pt")  # el ResNet-50 del c01 (500 clases); ya devuelve eval()
batch = torch.export.Dim("batch", min=1, max=32)  # el mismo rango que max_batch_size de Triton
with torch.inference_mode():
    # 1) En CI: capturar el grafo completo (falla si hay algo que no puede exportar)
    programa = torch.export.export(model, (torch.randn(2, 3, 224, 224),),
                                   dynamic_shapes={"x": {0: batch}})  # "x" = argumento de forward
    # 2) En CI: compilar con Inductor y empaquetar el resultado en un .pt2 versionable
    ruta = torch._inductor.aoti_compile_and_package(programa, package_path="classifier.pt2")

# 3) Al arrancar el servidor: cargar sin compilar nada (Python aquí; también existe un loader C++)
modelo_aot = torch._inductor.aoti_load_package("classifier.pt2")
with torch.inference_mode():
    logits = modelo_aot(torch.randn(4, 3, 224, 224))`;

  const ORT_CPU_SNIPPET = `import os

import onnxruntime as ort

# vCPUs del pod, inyectadas con la Downward API (resourceFieldRef: limits.cpu). Sin esto,
# ORT dimensiona su pool con los cores que ve en el nodo, no con los que te da tu límite.
vcpus = int(os.environ.get("CPU_LIMIT", "4"))

opciones = ort.SessionOptions()
opciones.intra_op_num_threads = vcpus  # hilos dentro de cada operador (un conv, un matmul)
opciones.inter_op_num_threads = 1  # el grafo corre en orden: no hace falta un segundo pool
sesion = ort.InferenceSession("classifier_int8.onnx", opciones, providers=["CPUExecutionProvider"])`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm08',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que-optimizar',
        title: 'Por qué y cuándo optimizar',
        titleEn: 'Why and when to optimize the model',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Empieza por un número del <a href="#c01">caso 1</a>: el cómputo en la GPU, que es "el modelo", son ${E('8–15 ms')} de un p99 pesimista de ${E('≈ 150 ms')}. Entre 5 % y 10 %. El resto se va en leer el body, decodificar y redimensionar la foto en CPU, el salto de red a Triton y el overhead de Python (<a href="#m03.presupuesto">M3, presupuesto</a>). Si mañana hicieras el modelo el doble de rápido, el p99 bajaría ${E('≈ 3–5 %')}. Si en cambio activas el draft mode de JPEG, una foto de 12 MP pasa de ≈ 40 a ≈ 18 ms de decode (medido en laptop con un JPEG baseline de ≈ 2.5 MB; según el archivo, la ganancia va de ${E('≈ 1.3×')} a ${E('≈ 2×')}): ahorras ${E('≈ 10–20 ms')} en esa foto, tanto como todo el cómputo de la GPU o más.` },
          { t: 'p', html: `Esa es la primera lección del módulo, y la que el entrevistador busca: <b>optimizar el modelo es una herramienta, no un reflejo</b>. Antes de hablar de TensorRT o INT8, di dónde se va el tiempo y qué problema resuelve la optimización.` },
          { t: 'h3', text: 'Mide primero: dónde se va el tiempo' },
          { t: 'p', html: `El c01 exporta dos histogramas separados en el gateway (<code>classifier_preprocess_seconds</code> y <code>classifier_inference_seconds</code>), y Triton separa tiempo en cola y tiempo de cómputo por modelo. Con esas cuatro series sabes si el problema es CPU, red, cola o GPU. Sin ellas, optimizar el modelo es apostar.` },
          { t: 'table', caption: 'El síntoma te dice qué optimizar', head: ['Lo que ves', 'Dónde está el tiempo', 'Qué haces primero', 'Optimizar el modelo ayuda'], rows: [
            ['p99 alto, cómputo de Triton estable', 'Preproceso de fotos grandes, GC, event loop bloqueado', 'Draft mode, threadpool, reducir en el cliente (<a href="#c01.serving">c01</a>)', 'No'],
            ['Tiempo en cola de Triton sube con la carga', 'La GPU está cerca de saturarse', 'Batching y réplicas (<a href="#m03.batching">M3</a>, <a href="#m06.hpa">M6</a>); después, un modelo más barato', 'Sí: sube la capacidad por GPU'],
            ['Cómputo alto a batch 1, GPU ociosa', 'Overhead de lanzar kernels, capas sin fusionar', 'Un runtime compilado (TensorRT, torch.compile con CUDA graphs)', 'Sí, en latencia'],
            ['No cabe en la VRAM', 'Pesos, activaciones o KV cache (<a href="#m04.vram">M4</a>)', 'Menos bytes: FP16, INT8, INT4 weight-only', 'Sí: es la única salida sin cambiar de GPU'],
            ['Costo: GPUs ociosas por N+1', 'La redundancia, no el throughput', 'Compartir la GPU, Savings Plans (<a href="#c01.costo">c01</a>)', 'Solo si elimina el tier (CPU INT8, destilación)'],
          ] },
          { t: 'h3', text: 'Qué compra una optimización' },
          { t: 'list', items: [
            `<b>Menos GPUs.</b> Solo si cambia el número de máquinas. En el c01, las 2 T4 están ahí por N+1 al ${E('≈ 5 %')} de carga promedio: aunque INT8 duplique la capacidad, siguen siendo 2. A 10× el tráfico, sí mueve la cuenta (calc abajo). Costo por predicción: <a href="#m04.costo-por-prediccion">M4</a>.`,
            `<b>Menos latencia.</b> Solo en la fracción del presupuesto que es cómputo. En CV online con modelos medianos, esa fracción es chica; en un ranker con SLO de 20 ms o en un LLM, es casi todo.`,
            `<b>Que quepa.</b> Un LLM de 70B en BF16 no entra en 80 GB; en INT4, sí (<a href="#m04.bytes-dtype">M4</a>). Aquí la optimización no es opcional.`,
            `<b>Un tier menos.</b> Un modelo que corre en CPU elimina las GPUs, el engine atado a una arquitectura y el cold start de nodos GPU (<a href="#m06.cold-starts">M6</a>). Es la palanca más grande del c01.`,
            `<b>Que corra en el borde.</b> En un Jetson Orin Nano con 8 GB compartidos y un modo de 15 W, FP16/INT8 y un modelo más chico deciden si el proyecto existe (<a href="#m04.edge-jetson">M4</a>).`,
          ] },
          { t: 'calc', title: '¿Qué compra hacer el modelo 2× más rápido en el c01?', rows: [
            { label: 'Cómputo GPU en el p99', expr: 'tabla de presupuesto del c01', value: E('8–15 ms de ≈ 150 ms') },
            { label: 'p99 si el cómputo baja a la mitad', expr: '150 − (4 a 7.5)', value: E('≈ 142–146 ms'), note: '≈ 3–5 % menos: nadie lo nota' },
            { label: 'GPUs hoy (FP16, 600 img/s planeadas)', expr: 'ceil(500 / 600) = 1, más N+1', value: '2 T4' },
            { label: 'GPUs con INT8 (≈ 1.5–2× → 900–1,200 planeadas)', expr: 'ceil(500 / 900) = 1, más N+1', value: '2 T4: ahorro US$0' },
            { label: 'A 10× (5,000 req/s), FP16', expr: 'ceil(5,000 / 600) + 1', value: '10 T4 (<a href="#m04.costo-por-prediccion">M4</a>)' },
            { label: 'A 10×, INT8', expr: 'ceil(5,000 / 900) + 1 = 7 · ceil(5,000 / 1,200) + 1 = 6', value: '6–7 T4' },
            { label: 'Ahorro a 10×', expr: '(3 a 4) × 0.526 × 730 h', value: E('≈ US$1,150–1,540/mes'), note: 'y queda debajo de pasar a 5 L4 en FP16 (≈ US$2,938/mes), si la accuracy aguanta' },
          ], result: 'Hoy, INT8 no compra nada en el c01: ni latencia que se note ni una GPU menos. A 10× paga tres o cuatro GPUs. <b>Optimizas el modelo cuando cambia el número de máquinas, elimina un tier o hace que algo quepa.</b>' },
          { t: 'h3', text: 'El orden de retorno' },
          { t: 'p', html: `Cuando sí toca optimizar, el orden importa porque cada paso tiene un riesgo de calidad y un costo de ingeniería distintos. De más barato y seguro a más caro:` },
          { t: 'steps', items: [
            { title: 'No llamar al modelo, o llamarlo con menos', meta: 'sistema', html: `<p>Caché por hash del input y cascadas (<a href="#m02.hibridos">M2</a>), o menos píxeles: los FLOPs de una CNN escalan con la resolución, 224 → 160 px = (160/224)² ≈ 0.51×; en detección, 1280 → 640 px = 0.25×. La caché no toca la calidad si la key incluye <code>model_version</code> (en el c01 no ahorra GPUs: están por N+1). La cascada y la resolución sí la tocan (objetos chicos, detalle fino) y cuestan como el último paso, entrenar y validar, pero se evalúan primero porque pueden quitar más cómputo que todo lo demás.</p>` },
            { title: 'Batching y hardware correcto', meta: 'sin tocar el modelo', html: `<p>Dynamic batching, instancias por GPU y la GPU más chica que cumple (<a href="#m03.batching">M3</a>, <a href="#m04.gpus-nvidia">M4</a>). Cero riesgo de calidad; suele dar el salto más grande de throughput.</p>` },
            { title: 'Un runtime más barato', meta: 'misma precisión', html: `<p>ONNX Runtime, TensorRT o torch.compile: fusionan capas y eligen kernels. El modelo es el mismo; el riesgo es un bug de export, que atrapa el parity test.</p>` },
            { title: 'Menos precisión', meta: 'FP16 → INT8 / FP8', html: `<p>FP16 en una CNN casi nunca cambia la calidad. INT8 sí puede, sobre todo en el long tail: necesita calibración y un gate por slices.</p>` },
            { title: 'Un modelo más chico', meta: 'destilación, pruning estructurado', html: `<p>La ganancia más grande y el costo más alto: entrenar de nuevo, con datos y con un equipo de modelado que lo mantenga. En el c01 es una recomendación al equipo de modelado, no algo que decides en el serving.</p>` },
          ] },
          { t: 'callout', kind: 'trap', title: 'Optimizar el modelo antes que el sistema', html: `<p>"Usaría TensorRT con INT8 para bajar la latencia" en un sistema donde el modelo es el 10 % del p99 y las GPUs están al 5 %. El entrevistador anota dos cosas: no mediste y agregaste riesgo de calidad sin beneficio. Primero el presupuesto de latencia y el conteo de máquinas; después, la técnica que mueve el número que importa.</p>` },
          { t: 'callout', kind: 'why', title: 'Por qué igual usas TensorRT FP16 en el c01', html: `<p>No es contradictorio. TensorRT FP16 es casi gratis en calidad (el parity test lo confirma) y da ${E('varias veces')} el throughput de PyTorch eager FP32 en la T4. Eso te da margen para spikes y failover sin escalar. INT8, en cambio, cuesta calibración y riesgo en el long tail para ganar capacidad que hoy no usas.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El presupuesto por tramo está en <a href="#m03.presupuesto">M3</a>; cuántas GPUs y por qué N+1, en <a href="#m03.cuantas-gpus">M3</a>; bytes por dtype y VRAM, en <a href="#m04.bytes-dtype">M4</a>. Qué model server corre el artefacto optimizado: <a href="#m07">M7</a>. Las mismas técnicas para LLMs (FP8, INT4, speculative decoding): <a href="#m14">M14</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Before touching the model, I'd check where the latency actually goes. Here GPU compute is roughly 10 milliseconds of a 150-millisecond p99, and the GPU count is set by redundancy, not throughput. So model optimization doesn't buy us much yet. It starts paying off when it removes machines or a whole tier."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'mapa-tecnicas',
        title: 'El mapa de técnicas',
        titleEn: 'The optimization toolbox',
        priority: 'core',
        dims: ['tradeoffs'],
        blocks: [
          { t: 'p', html: `En la entrevista no te piden implementar ninguna de estas técnicas. Te piden tres cosas por cada una: <b>cuánto gana, qué cuesta en calidad y cómo lo validas</b>. Esta tabla es el resumen; las secciones siguientes explican cada fila. Todas las ganancias son rangos típicos con sus condiciones: en tu modelo, se miden.` },
          { t: 'callout', kind: 'note', title: 'Las mediciones de este módulo', html: `<p>Lo marcado "(laptop M4)" se midió en una Mac con Apple M4 (10 núcleos), torch 2.14 y ONNX Runtime 1.30, con pesos aleatorios. Sirve para comparar variantes que corren por el mismo camino (estudiante vs maestro, eager vs compilado) y para ver órdenes de magnitud, no para dimensionar: hasta la razón INT8/FP32 cambia de una CPU a otra (<a href="#m08.cpu-inferencia">sección 8</a>). Para dimensionar, mides en el tipo de instancia de producción.</p>` },
          { t: 'table', caption: 'Técnicas de optimización para inferencia (ganancias: estimaciones con condiciones, no benchmarks)', head: ['Técnica', 'Ganancia típica', 'Riesgo de calidad', 'Esfuerzo', 'Hardware / runtime', 'Cuándo'], rows: [
            ['<b>Menos trabajo por request</b>: caché, cascada, menor resolución', 'Caché y cascada: la fracción que no llega al modelo grande. Resolución: ≈ (r₂/r₁)² en FLOPs (224 → 160 ≈ 0.51×); la latencia baja algo menos', 'Caché: ninguno. Cascada: los errores del modelo chico. Resolución: objetos chicos y detalle fino', 'Bajo (caché) a alto (resolución, cascada)', 'Cualquiera', 'Antes de comprimir el modelo; en detección y video, es lo primero que se mira'],
            ['<b>Compilador de grafos</b> (TensorRT, ONNX Runtime, torch.compile) en la misma precisión', `${E('≈ 1–2×')} sobre PyTorch eager; más a batch chico en GPU, donde manda el overhead. En CPU medí entre ≈ 0.5× y ≈ 1.2× según runtime y batch (<a href="#m08.cpu-inferencia">sección 8</a>)`, 'Casi nulo: diferencias de ≈ 1e-4 en los logits (FP32). El riesgo real es un bug de export', 'Bajo a medio: exportar, fijar versiones', 'Cualquiera', 'Siempre que sirvas en producción'],
            ['<b>FP16 / BF16</b> con tensor cores', `${E('≈ 2–4×')} sobre FP32 en la misma GPU, a batch moderado. El c01 cita ${E('varias veces')} el throughput de eager FP32 en la T4`, 'Muy bajo en CNNs. FP16 puede desbordar en transformers (usa BF16)', 'Bajo', 'FP16: T4 en adelante. BF16: Ampere en adelante (no T4)', 'El default en GPU'],
            ['<b>INT8 post-training (PTQ)</b>', `${E('≈ 1.5–2×')} sobre FP16 en GPU (c01); 4× menos bytes que FP32. En la laptop M4 medí ≈ 1–2× sobre FP32 según hilos y métrica (su FP32 usa una unidad de matrices, <a href="#m08.cpu-inferencia">sección 8</a>); el c01 supone ${E('≈ 3–5×')} en x86 con VNNI/AMX: mídelo`, 'Bajo a medio: pierde más en el long tail y en objetos chicos', 'Medio: datos de calibración y un gate por slices', 'Tensor cores INT8 (T4+); CPU con VNNI, AMX o dot-product (Arm)', 'Cuando la capacidad por máquina cambia el costo'],
            ['<b>INT8 con QAT</b>', 'La misma velocidad que PTQ', 'Menor que PTQ: el modelo aprende a tolerar el redondeo', 'Alto: reentrenar con cuantización simulada', 'La misma que PTQ', 'Cuando PTQ pierde demasiado'],
            ['<b>FP8</b>', `${E('≈ 1.3–2×')} sobre FP16 en transformers grandes; mídelo`, 'Bajo si se calibra', 'Medio', 'Ada (L4, L40S), Hopper (H100) y Blackwell; no T4, A10G ni A100', 'LLMs y transformers en GPUs recientes (<a href="#m14">M14</a>)'],
            ['<b>INT4 weight-only</b>', `En el decode de un LLM, hasta ≈ 4× menos bytes por token que BF16 (el techo de la L4 sube de ≈ 19 a ≈ 52 tokens/s, <a href="#m04.roofline">M4</a>)`, 'Medio: depende del método (AWQ, GPTQ)', 'Medio', 'Kernels de vLLM, TensorRT-LLM y similares', 'LLMs memory-bound (<a href="#m14">M14</a>); casi nunca en CNNs'],
            ['<b>Pruning estructurado</b> (canales, heads)', `Aproximadamente proporcional a los FLOPs que quitas: ${E('≈ 1.2–2×')} quitando 30–50 % de los canales`, 'Medio: necesita fine-tuning', 'Alto', 'Cualquiera: el resultado es un modelo denso más chico', 'Cuando no puedes cambiar de arquitectura'],
            ['<b>Pruning no estructurado</b>', '≈ 1× en kernels densos (medí 50 % de ceros: la misma latencia)', 'Bajo a medio', 'Medio', 'Solo rinde con kernels sparse especializados', 'Casi nunca para latencia; sí para comprimir el archivo'],
            ['<b>Sparsity 2:4</b>', `2× en la unidad de matrices; de punta a punta, ${E('≈ 1.1–1.5×')} según cuánto tiempo va a esas capas`, 'Medio: fine-tuning con la máscara', 'Alto', 'Sparse tensor cores: Ampere en adelante (no T4); TensorRT <code>--sparsity=enable</code>', 'Raro fuera de NVIDIA y de modelos grandes'],
            ['<b>Destilación</b>', `La razón entre maestro y estudiante: ResNet-50 → MobileNetV3 medí ≈ 4× en CPU`, 'El estudiante pierde algo de calidad: se mide', 'Alto: entrenar, datos, mantenerlo', 'Cualquiera', 'Cuando necesitas un salto grande (CPU, edge)'],
            ['<b>Preproceso en GPU</b> (DALI, nvJPEG)', 'Libera CPU del decode y el resize; baja el p99 de fotos grandes', 'Riesgo de skew si el decoder difiere del de entrenamiento', 'Medio', 'Decoders JPEG por hardware en A100, H100 y L4 (verifica en la hoja de datos de tu GPU); en la T4, nvJPEG usa los núcleos CUDA', 'Cuando el cuello es la CPU del preproceso (el c01 a 10×)'],
          ], note: 'Las ganancias no se multiplican entre sí sin más: una vez que el cómputo es chico, lo que queda (preproceso, red, cola) no baja. Las secciones 3 a 8 dicen de dónde sale cada rango y cómo medirlo.' },
          { t: 'callout', kind: 'why', title: 'Por qué las ganancias no se multiplican', html: `<p>Si el cómputo es el 12.5 % de la latencia (5 ms de 40 ms de p50) y lo haces 2× más rápido, la latencia total queda en 1 − 0.125 + 0.0625 = 0.94: un 6 % menos. Es la ley de Amdahl, y es la razón por la que "TensorRT + INT8 + pruning" en un servicio dominado por el preproceso da un número decepcionante.</p>` },
          { t: 'h3', text: 'El pipeline típico: de PyTorch a producción' },
          { t: 'p', html: `Todas las técnicas terminan en el mismo camino: un artefacto optimizado que se construye en CI, pasa gates contra la referencia FP32 y entra por un canary. El diagrama muestra el del c01 y la rama de CPU que deja abierta. Recorre los tres flujos.` },
          { t: 'diagram', id: 'pipeline-optimizacion', title: 'De PyTorch a producción: construir, validar, lanzar', caption: 'Arriba, lo que corre en CI sobre la GPU de destino; abajo, el lanzamiento. La rama punteada es el experimento de CPU INT8 del c01. Toca cada caja para ver por qué está ahí.', spec: PIPELINE },
          { t: 'callout', kind: 'senior', html: `<p>Nombra el pipeline completo, no solo la técnica: "export a ONNX, engine FP16 construido en CI en la misma GPU, parity test contra FP32, gate por slices, perf_analyzer a la carga de diseño y canary". Un candidato junior dice "lo optimizo con TensorRT"; uno senior dice cómo sabe que el artefacto optimizado sigue siendo el modelo que se evaluó.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"My default path is PyTorch to ONNX to a TensorRT engine in FP16, gated by a parity test against the FP32 model. INT8, pruning or distillation come later, and only if they remove GPUs or a whole tier."</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'onnx',
        title: 'ONNX y ONNX Runtime',
        titleEn: 'ONNX and ONNX Runtime',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `El ONNX del c01 pesa 98 MB: 24.5 M parámetros en FP32 (el ResNet-50 con una capa final de 500 clases) × 4 bytes, más la descripción del grafo. Ese archivo es el punto de entrega entre el entrenamiento y el serving: contiene el <b>grafo</b> (nodos que son operadores: Conv, Relu, GlobalAveragePool, Gemm), los <b>pesos</b> y la firma de entradas y salidas con nombre, dtype y shape (<code>input</code> [batch, 3, 224, 224] FP32 → <code>logits</code> [batch, 500]).` },
          { t: 'p', html: `Cada operador tiene una definición versionada: el <b>opset</b>. "Opset 17" significa "estos operadores con la semántica que tenían en la versión 17 del estándar". El runtime que lo lee (el parser de TensorRT, ONNX Runtime, OpenVINO) tiene que conocer ese opset. Por eso el opset es parte del contrato, no un detalle.` },
          { t: 'callout', kind: 'why', title: 'Por qué ONNX en medio', html: `<ul><li><b>TensorRT no lee checkpoints de PyTorch.</b> Su parser lee ONNX (el camino dentro de PyTorch, Torch-TensorRT, está en la <a href="#m08.tensorrt">sección 4</a>).</li><li><b>Desacopla</b> el framework de entrenamiento del runtime: el mismo archivo corre en ONNX Runtime en CPU, en TensorRT en GPU y en OpenVINO en Intel.</li><li><b>Es un artefacto versionable</b> que va al registry con su hash, y que puedes ejecutar en cualquier máquina para el gate de paridad, sin GPU.</li></ul>` },
          { t: 'h3', text: 'Los dos exportadores de PyTorch' },
          { t: 'table', caption: 'torch.onnx.export en torch 2.14', head: ['', 'TorchScript (legacy)', 'dynamo (torch.export)'], rows: [
            ['Cómo captura el grafo', 'Ejecuta el modelo con el input de ejemplo y registra las operaciones que ocurrieron (tracing)', 'Captura el programa completo con shapes simbólicas vía <code>torch.export</code>'],
            ['Default', 'No desde torch 2.9: lo pides con <code>dynamo=False</code> y emite un DeprecationWarning', 'Sí, desde torch 2.9'],
            ['Control de flujo que depende de los datos', 'Congela la rama que tomó el ejemplo sin fallar: a lo sumo un <code>TracerWarning</code> que se pierde en el log de CI', 'Falla con un error explícito (o lo expresas con <code>torch.cond</code>)'],
            ['Batch dinámico', '<code>dynamic_axes={"input": {0: "batch"}}</code>', '<code>dynamic_shapes={"x": {0: Dim("batch", min=1, max=32)}}</code>'],
            ['Opset', 'El que pidas: el c01 usa 17', 'Uno reciente por defecto (20 en una prueba mínima con torch 2.14). Si pides uno más viejo, intenta convertir "hacia abajo": en el c01 esa conversión falla con ReduceMean y el archivo queda en 18'],
            ['Dependencias', '<code>onnx</code>', '<code>onnx</code> y <code>onnxscript</code>'],
            ['Cuándo', 'Lo que usa el c01 hoy: opset 17 limpio y <code>dynamic_axes</code> tal cual, con torch fijado', 'Modelos nuevos: es el camino que PyTorch mantiene. El c01 planea migrar con opset 18'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>Qué exportador es el default en cada versión de torch, sus dependencias y cómo convierte opsets son detalles de implementación: no se preguntan. Quédate con tres ideas: el tracing congela sin fallar las ramas que dependen de los datos (torch.export falla explícito), el eje de batch se declara dinámico y el opset se fija y se verifica en CI.</p>` },
          { t: 'code', title: 'La llamada real del c01', caption: 'El script completo, con la verificación en ONNX Runtime a batch 1 y 32, está en los <a href="#c01.archivos">archivos del caso 1</a>.', files: [
            { name: 'export (extracto).py', lang: 'python', code: EXPORT_EXCERPT },
          ] },
          { t: 'h3', text: 'Por qué falla un export (y por qué a veces no falla)' },
          { t: 'table', head: ['Síntoma', 'Causa típica', 'Qué haces'], rows: [
            ['Error de export: operador no soportado', 'Una op sin equivalente en ese opset o una op propia de tu librería (en detección: NMS o deformable conv)', 'Subir el opset, reescribir con ops estándar, registrar un custom op/plugin, o dejar esa parte fuera del grafo y hacerla en el servidor'],
            ['Funciona en batch 2 y falla o da basura en batch 7', 'El eje no se declaró dinámico y quedó constante', 'Declarar el batch dinámico y probar batch 1 y máximo en CI (el <code>verify()</code> del c01)'],
            ['Predicciones distintas, sin ningún error', 'Un <code>if</code> sobre los datos que el tracer congeló, o un modelo en modo train capturado con <code>torch.export</code>/AOTInductor', '<code>model.eval()</code> antes de exportar; parity test; el exportador dynamo falla explícito en vez de congelar'],
            ['Pierde accuracy solo en producción', 'El preproceso del servicio no es el del entrenamiento (RGB/BGR, normalización dentro o fuera del grafo)', 'Un solo <code>preprocess.py</code> compartido y parity test end-to-end por el gateway (<a href="#c01.evaluacion">c01</a>)'],
            ['El archivo dice otro opset', 'Conversión de opset que falló a medias', 'Leer el opset real del archivo en CI y fallar si no coincide (el c01 lo hace)'],
            ['Aparece un <code>.onnx.data</code> aparte', 'El exportador dynamo (default en torch 2.14) guarda los pesos como datos externos por defecto (<code>external_data=True</code>), sin importar el tamaño: el ResNet-50 sale como un .onnx de 0.3 MB y un .onnx.data de 98 MB. Con el exportador TorchScript solo pasa por encima de 2 GB, el límite de protobuf', 'Si el modelo pesa menos de 2 GB, pasa <code>external_data=False</code> (el c01 lo hace en su rama dynamo); si no, trata el par de archivos como un solo artefacto en el registry y en la imagen'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Olvidar model.eval() fuera de torch.onnx.export', html: `<p>En modo train, BatchNorm normaliza con las estadísticas del batch en vez de sus running stats, y Dropout apaga neuronas al azar. En torch 2.14, <code>torch.onnx.export</code> te protege: el exportador TorchScript usa <code>training=TrainingMode.EVAL</code> por defecto (pone el modelo en eval durante el export) y el dynamo solo emite un <code>UserWarning</code> y aun así produce un grafo de inferencia. Lo probé con el ResNet-50 en modo train: con los dos exportadores, el ONNX dio 100 % de acuerdo top-1 con el modelo en eval (${MAC}). Donde el modo train sí rompe en silencio es en lo que captura el modelo tal cual: <code>torch.export.export</code> (y por lo tanto AOTInductor, <a href="#m08.torch-compile">sección 7</a>) y <code>torch.compile</code> conservan el BatchNorm con las estadísticas del batch: <b>0 %</b> de acuerdo en la misma prueba. La referencia PyTorch del parity test también tiene que estar en eval. Por eso el <code>build_model()</code> del c01 devuelve <code>model.eval()</code>: es un hábito barato que cubre todos los caminos.</p>` },
          { t: 'h3', text: 'ONNX Runtime: un runtime, varios backends' },
          { t: 'p', html: `ONNX Runtime (ORT) carga el grafo, lo optimiza y lo reparte entre <b>execution providers</b>: bibliotecas que ejecutan nodos en un hardware concreto. Le pasas una lista en orden de prioridad (<code>["CUDAExecutionProvider", "CPUExecutionProvider"]</code>) y cada nodo va al primero que lo soporta. Lo que ninguno acelera cae a la CPU.` },
          { t: 'table', caption: 'Execution providers que vas a nombrar (documentación de ONNX Runtime, sept. 2026)', head: ['Provider', 'Hardware', 'Cuándo'], rows: [
            ['CPU (default)', 'Cualquier CPU x86 o Arm', 'Serving en CPU, el gate de paridad en CI, desarrollo'],
            ['CUDA', 'GPU NVIDIA', 'GPU sin compilar un engine: arranca rápido y suele rendir menos que TensorRT'],
            ['TensorRT', 'GPU NVIDIA', 'Construye engines de TensorRT por debajo. Sin caché, los construye al crear la sesión'],
            ['OpenVINO', 'CPU, GPU y NPU de Intel', 'Inferencia en hardware Intel (<a href="#m08.cpu-inferencia">sección 8</a>)'],
            ['CoreML (preview), DirectML, QNN, XNNPACK', 'Apple, GPUs en Windows, Qualcomm, CPUs Arm de celulares', 'Clientes y edge; rara vez en una entrevista de backend'],
            ['ROCm · MIGraphX', 'GPU AMD', 'ROCm está deprecado en ORT; el camino de AMD es MIGraphX'],
          ] },
          { t: 'callout', kind: 'trap', title: 'El fallback silencioso a CPU', html: `<p>Si un nodo no lo soporta el provider de GPU, ORT lo corre en CPU y copia los tensores de ida y vuelta. No hay error: solo un modelo más lento de lo esperado. Revisa en qué provider cayó cada nodo (logs con verbosidad alta o el profiler de ORT) antes de concluir que "la GPU no ayuda".</p>` },
          { t: 'p', html: `Al crear la sesión, ORT optimiza el grafo (por defecto, todos los niveles: <code>ORT_ENABLE_ALL</code>): constant folding, quitar nodos como Dropout, fusionar Conv + BatchNorm o Conv + activación, y un layout propio en CPU. Lo hace en cada arranque; puedes guardar el grafo optimizado (<code>optimized_model_filepath</code>), pero con las optimizaciones de layout ese archivo solo sirve en hardware compatible con el que lo generó.` },
          { t: 'h3', text: 'El gate de paridad' },
          { t: 'p', html: `Evaluaste un modelo PyTorch FP32; vas a servir otro artefacto. El parity test prueba que es el mismo modelo, con métricas que importan al producto y no solo diferencias numéricas. El <code>parity_check.py</code> del c01 compara tres cosas: <b>acuerdo top-1</b> (¿cambia la sugerencia principal?), <b>solapamiento del top-5</b> (lo que ve el vendedor) y <b>diferencia absoluta máxima de logits</b> (un salto grande indica un bug de export, no redondeo).` },
          { t: 'code', title: 'El núcleo del parity test', caption: 'Versión reducida de <code>model/parity_check.py</code> del c01. Corrió en el venv de este módulo con 40 JPEG sintéticos pasados por el <code>preprocess.py</code> del gateway: acuerdo top-1 100 %, top-5 100 %, max|Δlogit| ≈ 6.5e-5.', files: [
            { name: 'paridad.py', lang: 'python', code: PARITY_SNIPPET },
          ] },
          { t: 'p', html: `Qué esperar: FP32 contra FP32 (ONNX Runtime contra PyTorch) da diferencias de logits de ≈ 1e-4 y acuerdo top-1 de 100 % (medí 1.4e-4 con logits de hasta ≈ 85; ${MAC}). TensorRT FP16 da diferencias del orden de 1e-2, según el c01; ajusta el tope con tus datos (el suyo, 0.5, está para atrapar exports rotos). Si un engine FP16 da 97 % de acuerdo, no es redondeo: es un bug.` },
          { t: 'callout', kind: 'senior', html: `<p>Separa las dos preguntas en voz alta: "la paridad me dice si el artefacto es el mismo modelo; el golden set por slices me dice si el modelo es bueno. Una cuantización puede pasar la primera con 99 % de acuerdo y aun así romper el long tail". Y agrega el tercer nivel: el parity test <b>end-to-end</b> por el gateway real atrapa el skew de preprocesamiento, que ningún test del modelo aislado ve.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"ONNX is the handoff artifact. I export in eval mode with a dynamic batch axis, check the opset actually written to the file, and run a parity test in ONNX Runtime against the FP32 model before anything touches a GPU."</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'tensorrt',
        title: 'TensorRT',
        titleEn: 'TensorRT engines',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `TensorRT es un compilador: recibe el ONNX y produce un <b>engine</b> (un archivo <code>.plan</code>, ${E('≈ 50–150 MB')} para el ResNet-50 del c01) optimizado para una GPU concreta. Triton lo carga con el backend <code>tensorrt_plan</code>. Entender qué hace el builder explica sus dos reglas: rinde mucho y no es portable.` },
          { t: 'h3', text: 'Qué hace el builder' },
          { t: 'steps', items: [
            { title: 'Parsea y simplifica el grafo', meta: 'constant folding', html: `<p>Lee el ONNX, precalcula lo constante y elimina lo que no aporta en inferencia (un BatchNorm se pliega dentro de la convolución anterior: sus escalas pasan a los pesos).</p>` },
            { title: 'Fusiona capas', meta: 'layer fusion', html: `<p>Convolución + bias + ReLU se vuelven un solo kernel: la activación intermedia no se escribe en la VRAM para leerla de nuevo. Menos lecturas de memoria y menos lanzamientos de kernels, que es justo lo que limita a batch chico (<a href="#m04.roofline">M4, roofline</a>).</p>` },
            { title: 'Elige la precisión de cada capa', meta: 'FP32, FP16, INT8…', html: `<p>En TensorRT 10, con <code>--fp16</code> le permites usar FP16 y él decide capa por capa (deja en FP32 lo que no convenga). En TensorRT 11 la precisión la fijan los tipos del propio ONNX (más abajo).</p>` },
            { title: 'Mide kernels en tu GPU', meta: 'tactics', html: `<p>Para cada capa prueba varias implementaciones (<b>tácticas</b>: distintos algoritmos, tamaños de bloque, layouts) y las <b>cronometra en la GPU donde corre el build</b>. Se queda con la más rápida. Por eso el build tarda y por eso el resultado es de esa GPU.</p>` },
            { title: 'Planifica la memoria y serializa', meta: '.plan', html: `<p>Reutiliza buffers de activaciones entre capas y escribe el engine en un formato atado a esa versión de TensorRT.</p>` },
          ] },
          { t: 'h3', text: 'Optimization profiles: el batch dinámico' },
          { t: 'p', html: `Un engine con entradas dinámicas necesita al menos un <b>optimization profile</b>: shapes mínima, óptima y máxima. El c01 usa 1 / 16 / 32: el engine acepta batches de 1 a 32 (máximo = <code>max_batch_size</code> de Triton) y TensorRT elige las tácticas para 16. Fuera del rango, falla. El detalle que suma: online, con ≈ 250 req/s por GPU y una ventana de 2 ms, los batches reales son de ${E('≈ 1–3')} (<a href="#m03.batching">M3</a>), así que "opt 16" es un punto de partida. El <code>build_engine.sh</code> del c01 lo deja escrito: compara con perf_analyzer contra un engine con opt 4 y quédate con el de mejor p99 a 250–500 req/s. Si los tamaños varían mucho (secuencias, resoluciones), usas varios perfiles, uno por bucket.` },
          { t: 'h3', text: 'Precisiones' },
          { t: 'table', head: ['Precisión', 'GPU', 'Cómo se pide', 'Riesgo'], rows: [
            ['FP32 / TF32', 'Todas (TF32 desde Ampere)', 'Default', 'Ninguno'],
            ['FP16', 'T4 en adelante', '<code>--fp16</code> (TensorRT 10) o el ONNX ya convertido a FP16 con ModelOpt AutoCast (TensorRT 11)', 'Muy bajo en CNNs; overflow posible en transformers'],
            ['BF16', 'Ampere en adelante (no T4)', '<code>--bf16</code> (TensorRT 10) o los tipos del ONNX (TensorRT 11)', 'Bajo'],
            ['INT8', 'T4 en adelante', 'Nodos Q/DQ en el ONNX (el calibrador implícito está deprecado en TensorRT 10 y ya no existe en 11)', 'Medio: long tail y objetos chicos'],
            ['FP8', 'Ada y Hopper en adelante (L4, H100)', 'Nodos Q/DQ FP8 (ModelOpt)', 'Bajo si se calibra; sobre todo LLMs'],
            ['INT4 · FP4', 'INT4 weight-only; FP4 en Blackwell', 'ModelOpt / TensorRT-LLM', 'LLMs (<a href="#m14">M14</a>)'],
          ], note: 'Q/DQ: pares de nodos QuantizeLinear/DequantizeLinear en el ONNX que dicen dónde y con qué escala cuantizar. Los genera NVIDIA Model Optimizer (ModelOpt). El cuantizador de ONNX Runtime sirve para TensorRT solo con <code>ActivationSymmetric=True</code>, porque TensorRT exige zero point 0 (<a href="#m08.cuantizacion">sección 5</a>).' },
          { t: 'callout', kind: 'note', title: 'TensorRT 10 vs 11 (2026)', html: `<p>El c01 fija NGC 24.08 (TensorRT 10.3), donde <code>trtexec --fp16</code> es el camino estándar. TensorRT 11.0 (en los contenedores de NGC desde 26.06) hizo obligatorias las redes <b>strongly typed</b>: eliminó las flags de precisión del builder (<code>--fp16</code>, <code>--int8</code> y sus equivalentes en la API) y la calibración implícita de INT8. La precisión ahora vive en el ONNX: FP16 con ModelOpt AutoCast; INT8 y FP8 con nodos Q/DQ. La regla de portabilidad no cambió. En una entrevista basta con saber que existió el cambio y por qué: el engine hace lo que dice el grafo, sin adivinar.</p>` },
          { t: 'h3', text: 'Por qué un engine no es portable' },
          { t: 'p', html: `Las tácticas se eligieron cronometrando en una GPU concreta, los kernels se compilaron para su arquitectura (la T4 es sm_75; la L4, sm_89) y el archivo se serializó en el formato de una versión de TensorRT. La documentación lo dice sin rodeos: por defecto, un engine solo es compatible con el tipo de dispositivo y la versión de TensorRT con que se construyó (y tampoco entre sistemas operativos). Si Triton intenta cargar un engine de otra GPU u otra versión, falla al cargar; en el c01, con <code>--exit-on-error=true</code>, el pod queda en CrashLoopBackOff.` },
          { t: 'table', caption: 'Las salidas que existen (documentación actual de TensorRT). <code>ampere+</code> y version compatibility llegaron en la 8.6; misma compute capability, recién en la 10.9', head: ['Opción', 'Qué permite', 'Precio', 'Para el c01'], rows: [
            ['Construir en la GPU de destino (default)', 'Mejor rendimiento', 'Un runner de CI por tipo de GPU; un engine por tipo', '<b>Elegido</b>: T4 en CI, NGC 24.08'],
            ['Hardware compatibility <code>ampere+</code>', 'Un engine para Ampere y todo lo posterior', 'Excluye tácticas específicas: algo más lento. <b>No cubre Turing</b>', 'No sirve: la T4 es Turing'],
            ['Misma compute capability', 'Otras GPUs con la misma arquitectura exacta', 'Pequeña pérdida; puede fallar si la otra GPU tiene menos memoria', 'Solo si hubiera otra GPU sm_75, y pide TensorRT ≥ 10.9: NGC 24.08 trae la 10.3'],
            ['Version compatibility', 'Correr con runtimes más nuevos de TensorRT (<code>--versionCompatible</code>)', 'Puede ser más lento; el runtime lean va dentro del plan', 'Útil si Triton se actualiza más seguido que el modelo'],
          ] },
          { t: 'p', html: `La práctica del c01, en <code>model/build_engine.sh</code>: una guardia que aborta si la GPU del runner no es una T4, el contenedor <code>tensorrt:24.08</code> (mismo YY.MM que la imagen de Triton) y las huellas al final (GPU, release, sha256 del ONNX y del plan) para el registry. Si la flota tiene T4 y L4, son <b>dos engines</b>, dos tags de imagen y un <code>nodeSelector</code> por node pool (<a href="#m06.nodos">M6</a>) para que un pod con el engine de T4 nunca caiga en una L4.` },
          { t: 'h3', text: 'trtexec: construir y medir' },
          { t: 'code', title: 'Los comandos que usas', caption: 'Flags de la documentación de TensorRT 10 (no se ejecutaron aquí: no hay GPU NVIDIA en este entorno). La versión comentada línea por línea del build está en <a href="#c01.archivos">c01, archivos</a>.', files: [
            { name: 'trtexec.sh', lang: 'bash', code: TRTEXEC_SNIPPET },
          ] },
          { t: 'p', html: `trtexec reporta throughput, latencia por percentiles, tiempo de cómputo en GPU y las copias host → device y device → host por separado. Sirve para comparar engines entre sí y para ver qué capa pesa. <b>No</b> mide lo que ve tu usuario: no hay cola de dynamic batching, ni red, ni el gateway. El número que decide capacidad y SLO sale de perf_analyzer contra Triton (<a href="#m03.load-testing">M3</a>).` },
          { t: 'h3', text: 'Build time y cold start' },
          { t: 'p', html: `Medir tácticas lleva tiempo: el build de un ResNet-50 toma ${E('del orden de minutos')}, más con varios perfiles o con <code>--builderOptimizationLevel</code> alto (default 3, rango 0–5). La documentación de ONNX Runtime muestra el efecto con un modelo suyo usando el provider de TensorRT: 384 s para inicializar sin cachés, 42 s con caché de tácticas, 9 s con caché de engines y 1.9 s con el engine embebido. Traducido a diseño: <b>el engine se construye en CI y viaja en la imagen o en el registry; nunca se compila al arrancar un pod</b>. Un pod que compila su engine al arrancar convierte un scale-out de minutos en uno de más minutos, justo cuando más falta hace (<a href="#m06.cold-starts">M6, cold starts</a>; <a href="#m05.pesos-modelo">M5, pesos en la imagen</a>).` },
          { t: 'callout', kind: 'trap', title: 'El provider de TensorRT sin caché', html: `<p>Pasar de ORT con CUDA a ORT con el provider de TensorRT "para ganar velocidad" y no activar <code>trt_engine_cache_enable</code>: cada proceso nuevo construye su engine al crear la sesión. Funciona en tu máquina (lo esperas una vez) y en producción cada réplica nueva tarda minutos en pasar la readiness. Si usas ese provider, cachea el engine en un volumen o, mejor, constrúyelo en CI.</p>` },
          { t: 'h3', text: 'Torch-TensorRT: TensorRT sin salir de PyTorch' },
          { t: 'p', html: `Torch-TensorRT compila partes de un modelo de PyTorch con TensorRT: <code>torch.compile(model, backend="torch_tensorrt")</code> en modo JIT, o <code>torch_tensorrt.compile(model, ir="dynamo", inputs=…)</code> para un artefacto ahead of time. Lo que TensorRT no soporta sigue en PyTorch, así que sirve para modelos difíciles de exportar a ONNX. El precio: sirves desde Python con PyTorch y TensorRT en la imagen, y los engines embebidos tienen la misma regla de portabilidad. Sus paquetes 2.13 usan TensorRT 11 por defecto.` },
          { t: 'callout', kind: 'skip', html: `<p>Plugins propios de TensorRT, la API de C++ del builder, el formato interno del plan y el ajuste fino de tácticas son trabajo de un performance engineer. En la entrevista basta con: qué hace el builder, optimization profiles, precisiones por GPU, por qué no es portable y dónde se construye.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Para LLMs, NVIDIA tiene <b>TensorRT-LLM</b> (in-flight batching, KV cache paginado, FP8 e INT4): se compara con vLLM y SGLang en <a href="#m07.llm-servers">M7</a> y se usa en <a href="#m14">M14</a>. Cómo Triton carga el <code>.plan</code>, instancias y dynamic batching: <a href="#m07.triton">M7</a>.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"A TensorRT engine is compiled for one GPU architecture and one TensorRT version, so I build it in CI on the same GPU type and container release we serve with, record the hashes in the registry, and never build it at pod startup."</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'cuantizacion',
        title: 'Cuantización: FP16, INT8, FP8 e INT4',
        titleEn: 'Quantization: FP16, INT8, FP8 and INT4',
        priority: 'core',
        dims: ['tradeoffs', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Número primero. ResNet-50 (25.6 M parámetros, con la capa final de 1,000 clases): en FP32 son 25.6 M × 4 B ≈ <b>102 MB</b>; en FP16, ≈ <b>51 MB</b>; en INT8, ≈ <b>26 MB</b> más unas escalas. El ResNet-50 del c01 (24.5 M, con 500 clases) pasó de 98 MB en ONNX FP32 a 25.1 MB en INT8 al cuantizarlo con ONNX Runtime. Cuatro veces menos bytes. La latencia no bajó cuatro veces:` },
          { t: 'table', caption: 'ResNet-50 (500 clases) en ONNX Runtime CPU, 4 hilos (' + MAC + ')', head: ['Variante', 'Archivo', 'Batch 1', 'Batch 8', 'vs FP32'], rows: [
            ['FP32', '98 MB', E('≈ 15–18 ms'), E('≈ 217–247 ms'), '1×'],
            ['INT8 dinámico (pesos INT8, escalas de activación al vuelo)', '24.6 MB', E('≈ 15.5 ms'), E('≈ 139 ms'), '≈ 1× en batch 1 · ≈ 1.7× en batch 8'],
            ['INT8 estático (Q/DQ, escalas por canal, calibrado)', '25.1 MB', E('≈ 7.7–8 ms'), E('≈ 61–70 ms'), '≈ 2× en batch 1 · ≈ 3.5× en batch 8'],
          ], note: 'Corridas de 20 iteraciones. En corridas sostenidas de 10 s la laptop dio 21–23 ms en FP32 y 11–14 ms en INT8 estático: los absolutos se movieron ±30 % entre corridas; la razón (≈ 1.6–2× en batch 1, con 4 hilos) se mantuvo. Por eso se mide en la máquina de producción, sin nada más corriendo y con muchas iteraciones.' },
          { t: 'p', html: `Por qué 4× menos bytes no da 4× de velocidad:` },
          { t: 'list', items: [
            `<b>En una CNN manda el cómputo, no los bytes de los pesos.</b> El techo lo pone cuántas operaciones INT8 por segundo tiene el hardware frente a las de FP16: en la T4, 130 TOPS INT8 contra 65 TFLOPS FP16, es decir 2× como máximo (<a href="#m04.roofline">M4</a>).`,
            `<b>No todo se cuantiza.</b> Softmax, algunas normalizaciones y a menudo la primera y la última capa quedan en más precisión, y cada frontera entre INT8 y FP agrega una conversión.`,
            `<b>A batch 1 pesa el overhead</b> (lanzar kernels, copiar), que no depende del dtype.`,
            `<b>El resto del sistema no se cuantiza.</b> El preproceso, la red y la cola siguen igual: Amdahl otra vez.`,
          ] },
          { t: 'p', html: `En LLMs es distinto: el decode es memory-bound, así que menos bytes por peso se traducen casi directo en más tokens por segundo. Por eso allí se usa <b>weight-only</b> (pesos en INT8 o INT4, activaciones en BF16) y en CNNs se usa <b>pesos y activaciones</b> en INT8 (W8A8): los tensor cores INT8 necesitan los dos operandos en INT8 para dar su cómputo. Weight-only quantization (GPTQ, AWQ) se desarrolla en <a href="#m14">M14</a>.` },
          { t: 'h3', text: 'La idea en un ejemplo' },
          { t: 'p', html: `Cuantizar es guardar cada número como un entero de 8 bits más una escala compartida: <code>valor ≈ escala × entero</code>. Si los pesos de una capa están entre −2.5 y 2.5, la escala simétrica es 2.5 / 127 ≈ 0.0197. El peso 0.1 se guarda como round(0.1 / 0.0197) = round(5.08) = 5, y vuelve como 5 × 0.0197 ≈ 0.0984: error de 1.6 %. Ahora agrega a la capa un solo peso atípico de 25: la escala pasa a 25 / 127 ≈ 0.197, el mismo 0.1 se guarda como round(0.508) = 1 y vuelve como 0.197. Error de 97 %, por un valor extremo. Casi todo lo que sigue es cómo elegir escalas que no desperdicien la resolución de 8 bits.` },
          { t: 'table', head: ['Decisión', 'Opción A', 'Opción B', 'Qué se usa'], rows: [
            ['Una escala para…', '<b>Per-tensor</b>: todo el tensor', '<b>Per-channel</b>: cada canal de salida de una conv', 'Pesos: per-channel (los canales tienen rangos muy distintos; en depthwise, más). Activaciones: per-tensor'],
            ['El cero', '<b>Simétrica</b>: rango [−m, m], zero point 0', '<b>Asimétrica</b>: rango [min, max] con un zero point', 'Simétrica para pesos. TensorRT exige simétrica también en las activaciones (zero point 0). En CPU con ORT, la asimétrica (el default de <code>quantize_static</code>) ayuda en activaciones de un solo signo: tras ReLU en [0, 6], la escala asimétrica es 6 / 255 ≈ 0.024 y la simétrica 6 / 127 ≈ 0.047, el doble de gruesa, porque desperdicias la mitad negativa'],
            ['Las escalas de activación', '<b>Estáticas</b>: medidas antes, con calibración', '<b>Dinámicas</b>: calculadas en cada inferencia', 'ORT recomienda estática para CNNs y dinámica para transformers y RNNs; en mi medición, la dinámica no ganó nada en batch 1'],
            ['El rango de calibración', 'MinMax: el mínimo y el máximo vistos', 'Percentil o entropía: recortan outliers', 'Percentil o entropía cuando hay valores extremos (el ejemplo de arriba)'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>La matemática del zero point, la derivación de la calibración por entropía (KL) y los detalles de SmoothQuant no se preguntan en una ronda de MLE. Basta con la intuición: una escala compartida, per-channel para pesos, y calibración que recorta outliers.</p>` },
          { t: 'h3', text: 'PTQ vs QAT' },
          { t: 'table', head: ['', 'Post-training quantization (PTQ)', 'Quantization-aware training (QAT)'], rows: [
            ['Qué es', 'Cuantizas el modelo ya entrenado; las escalas salen de pasar datos de calibración', 'Reentrenas (o haces fine-tuning) con la cuantización simulada en el forward: el modelo aprende a tolerar el redondeo'],
            ['Datos', 'Unos cientos a ≈ 1,000 ejemplos sin labels', 'El dataset de entrenamiento (o una parte) con labels'],
            ['Costo', 'Minutos a horas de un job en CI', 'Días: un pipeline de entrenamiento más que mantener'],
            ['Calidad', 'Casi siempre cerca del FP32 en CNNs grandes; pierde más en modelos compactos (depthwise) y en el long tail', 'La mejor en INT8; recupera lo que PTQ pierde'],
            ['Cuándo', 'Primero, siempre', 'Cuando PTQ no pasa el gate y el INT8 sí compra algo'],
          ] },
          { t: 'p', html: `Como referencia publicada: Wu et al. (NVIDIA, 2020, <i>Integer Quantization for Deep Learning Inference</i>) reportan un flujo de INT8 que queda a menos de 1 % del baseline en todas las redes que estudiaron, incluidas las difíciles como MobileNets y BERT-large; donde la calibración no alcanzaba, su flujo deja capas sensibles sin cuantizar o pasa a QAT. "Menos de 1 % del global" es exactamente lo que no alcanza para decidir, como verás abajo.` },
          { t: 'h3', text: 'Datos de calibración' },
          { t: 'list', items: [
            `<b>Cuántos.</b> Unos cientos a ≈ 1,000 ejemplos. La guía de NVIDIA Model Optimizer recomienda al menos 500 imágenes para CNNs y ViTs. Más datos rara vez cambian las escalas; mejores datos, sí.`,
            `<b>De dónde.</b> Del tráfico de producción reciente (en el c01, las referencias del prediction log), no del set de entrenamiento con augmentations ni de ruido aleatorio. Las escalas se ajustan a la distribución que ven.`,
            `<b>Estratificados por slice.</b> Móvil y web, poca luz, categorías del long tail. Si calibras solo con las categorías grandes, las activaciones raras quedan fuera de rango y se saturan.`,
            `<b>Con el preproceso del gateway.</b> El mismo <code>preprocess.py</code>: calibrar con otra normalización es calibrar otro modelo.`,
            `<b>Separados del golden set</b> y versionados con el modelo, para evaluar sobre datos que no se usaron para fijar las escalas y poder repetir el build.`,
          ] },
          { t: 'code', title: 'INT8 estático con ONNX Runtime', caption: 'Corrió en el venv de este módulo (con JPEG sintéticos: sirve para probar el pipeline y medir tiempos, no la accuracy). Para TensorRT el camino equivalente es <code>python -m modelopt.onnx.quantization --quantize_mode=int8</code> con un <code>.npy</code> de calibración, que produce un ONNX con Q/DQ.', files: [
            { name: 'cuantizar_int8.py', lang: 'python', code: QUANT_SNIPPET },
          ] },
          { t: 'callout', kind: 'trap', title: '"trtexec --int8 funcionó y va 1.8× más rápido"', html: `<p><code>--int8</code> sin datos de calibración usa escalas de relleno: el engine corre y sirve para medir velocidad, pero sus predicciones no valen nada. Lo mismo al calibrar con ruido aleatorio. La velocidad de INT8 se mide así; su calidad, no.</p>` },
          { t: 'h3', text: 'Dónde se rompe la calidad' },
          { t: 'table', head: ['Dónde', 'Por qué', 'Cómo lo ves'], rows: [
            ['Clases del long tail', 'Menos ejemplos y márgenes chicos entre el primer y el segundo logit: un redondeo invierte el top-1', 'Recall por clase, head vs tail'],
            ['Objetos chicos en detección', 'Pocas posiciones del mapa de features los representan y la regresión de cajas necesita precisión fina; un score que baja de 0.5 a 0.45 cruza el umbral y la detección desaparece', 'mAP por tamaño de objeto (small/medium/large), recall al umbral de producción'],
            ['Fotos con poca luz o bajo contraste', 'Activaciones en un rango estrecho que la escala global resuelve mal', 'El slice de poca luz del golden set'],
            ['Modelos compactos (MobileNet, EfficientNet)', 'Convoluciones depthwise con rangos muy distintos por canal', 'Pérdida mayor en PTQ; QAT la recupera'],
            ['Scores y umbrales', 'Los scores se corren aunque el top-1 no cambie: la calibración de probabilidades (ECE) se mueve', 'ECE y la tasa de baja confianza (en el c01, top-1 &lt; 0.3 va a etiquetado)'],
          ] },
          { t: 'calc', title: 'Por qué el global engaña (ejemplo ilustrativo, no una medición)', rows: [
            { label: 'Head: 80 % de las imágenes', expr: 'pierde 0.1 pp', value: '0.8 × 0.1 = 0.08 pp' },
            { label: 'Long tail: 20 % de las imágenes', expr: 'pierde 1.1 pp', value: '0.2 × 1.1 = 0.22 pp' },
            { label: 'Global', expr: '0.08 + 0.22', value: '−0.30 pp' },
            { label: 'Una categoría chica del tail', expr: 'con ≈ 60 ejemplos en el golden set', value: 'puede perder 5 pp sin mover el global' },
          ], result: 'El global dice −0.3 pp: justo en el borde del gate de no inferioridad del c01. El tail perdió 11× más que el head. Por eso el gate de INT8 mira recall por clase y slices, no el promedio.' },
          { t: 'callout', kind: 'trap', title: 'Juzgar INT8 solo por el accuracy global', html: `<p>"Perdió 0.3 %, es aceptable" es la respuesta que el entrenador de un modelo da y la que un entrevistador de MLE penaliza. Los usuarios del long tail son justamente los que más necesitan la sugerencia (categorías raras, difíciles de encontrar en el selector manual). Di qué slices mirarías y con qué umbral, como hace el gate del c01.</p>` },
          { t: 'h3', text: 'FP8 e INT4, en una línea cada uno' },
          { t: 'p', html: `<b>FP8</b> (E4M3/E5M2, <a href="#m04.bytes-dtype">M4</a>) conserva un exponente, así que tolera mejor los outliers que INT8; existe en Ada, Hopper y Blackwell, y se usa sobre todo en LLMs y transformers grandes. <b>INT4</b> casi siempre es weight-only con escalas por grupo, para LLMs. Para una CNN de 25 M parámetros en una T4, ninguno de los dos entra en la conversación.` },
          { t: 'table', caption: 'Herramientas por destino', head: ['Destino', 'Herramienta', 'Nota'], rows: [
            ['TensorRT', 'NVIDIA Model Optimizer (ModelOpt): PTQ a INT8/FP8 sobre ONNX o PyTorch, con Q/DQ', 'En TensorRT 11 es el camino; el calibrador implícito ya no existe'],
            ['ONNX Runtime', '<code>quantize_static</code> / <code>quantize_dynamic</code> (formato QDQ)', 'S8S8 con QDQ es el default recomendado'],
            ['OpenVINO', 'NNCF (PTQ y compresión de pesos)', 'Hardware Intel'],
            ['PyTorch nativo', 'torchao (<code>quantize_</code> y PT2E)', '<code>torch.ao.quantization</code> está deprecado; no construyas sobre él'],
            ['LLMs', 'AWQ, GPTQ, FP8 vía ModelOpt o el propio servidor', '<a href="#m14">M14</a>'],
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"INT8 would roughly halve compute again, but I'd only ship it with calibration data sampled from production traffic and a gate on per-class recall and slices. A 0.3-point drop overall can hide a much larger drop on the long tail."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'pruning-destilacion',
        title: 'Pruning y destilación',
        titleEn: 'Pruning and distillation',
        priority: 'extra',
        dims: ['tradeoffs'],
        blocks: [
          { t: 'p', html: `Las dos técnicas buscan un modelo más chico. Una quita pesos al modelo que tienes; la otra entrena uno nuevo que imita al original. En la práctica, para servir, la segunda es la que más seguido cumple lo que promete.` },
          { t: 'h3', text: 'Pruning no estructurado: ceros que no aceleran' },
          { t: 'p', html: `Poner en cero los pesos de menor magnitud (50 %, 80 %, 90 % de ellos) y hacer fine-tuning para recuperar la accuracy. El modelo queda "sparse", pero sigue siendo una matriz densa llena de ceros: los kernels densos de la GPU (y de la CPU) multiplican esos ceros igual que cualquier otro número. Lo probé con <code>torch.nn.utils.prune</code> sobre el ResNet-50 (${MAC}):` },
          { t: 'kv', items: [
            ['Latencia densa, batch 1 / batch 8', E('≈ 15.8 ms / ≈ 104 ms'), 'PyTorch eager FP32'],
            ['Con 50 % de los pesos en cero', E('≈ 16.0 ms / ≈ 104.8 ms'), 'La misma, dentro del ruido'],
            ['Tamaño del checkpoint', '98.4 MB', 'Tampoco cambia: los ceros ocupan 4 bytes como cualquier FP32. Solo baja si lo comprimes o lo guardas en un formato sparse'],
          ] },
          { t: 'p', html: `Para que acelere hacen falta kernels sparse, y en GPU solo compensan con sparsity muy alta y patrones que el hardware aproveche. Por eso "podé 80 % del modelo" es una frase que suena bien y casi nunca mueve el p99.` },
          { t: 'h3', text: 'Pruning estructurado: un modelo denso más chico' },
          { t: 'p', html: `Quitar canales enteros de una convolución, filtros o heads de atención. El resultado es un modelo <b>denso</b> más angosto, que corre más rápido en cualquier hardware. Los FLOPs de una convolución escalan con canales de entrada × canales de salida, y al quitar canales de una capa también se achica la entrada de la siguiente: quitar 30 % de los canales en todas las capas deja ≈ 0.7 × 0.7 ≈ 49 % de los FLOPs; quitar 50 %, ≈ 25 %. La latencia baja menos que los FLOPs (capas memory-bound, overhead, anchos que dejan de ser múltiplos de 8 para los tensor cores): ${E('≈ 1.2–2×')} es un rango razonable a verificar.` },
          { t: 'p', html: `El costo: cada poda necesita fine-tuning para recuperar accuracy, y en arquitecturas con conexiones residuales (ResNet) los canales de varios bloques están atados entre sí, así que no se podan de forma independiente. Hay librerías que manejan esas dependencias (Torch-Pruning, el módulo de pruning de ModelOpt), pero sigue siendo un proyecto de modelado.` },
          { t: 'h3', text: 'Sparsity 2:4' },
          { t: 'p', html: `El punto medio que NVIDIA pone en el hardware: en cada grupo de 4 pesos consecutivos, 2 son cero. Los sparse tensor cores (desde Ampere) saltan esos ceros y hacen el doble de operaciones de matrices por ciclo: de ahí los TFLOPS "with sparsity" de las hojas de datos, que duplican los densos (<a href="#m04.gpus-nvidia">M4</a>). Necesitas: una GPU Ampere o posterior (la T4 no tiene), fine-tuning con la máscara 2:4 para recuperar accuracy, y construir el engine con <code>--sparsity=enable</code>. De punta a punta, solo las capas elegibles se aceleran: espera ${E('≈ 1.1–1.5×')}, no 2×, y mídelo.` },
          { t: 'callout', kind: 'skip', html: `<p>Lottery ticket hypothesis, movement pruning, pruning por gradientes, NAS y los criterios para elegir qué canal podar son temas de investigación. En una ronda de MLE basta con: el no estructurado no acelera en kernels densos, el estructurado sí pero pide fine-tuning, y 2:4 existe en GPUs Ampere+ con ganancia moderada.</p>` },
          { t: 'h3', text: 'Destilación: un estudiante para servir' },
          { t: 'p', html: `Un modelo grande y preciso (el <b>maestro</b>, aquí el ResNet-50) etiqueta datos con sus probabilidades completas, no solo con la clase ganadora, y un modelo chico (el <b>estudiante</b>) aprende a imitarlas junto con las labels reales (Hinton, Vinyals y Dean, <i>Distilling the Knowledge in a Neural Network</i>, 2015). Las probabilidades del maestro dicen más que la label: "90 % smartphone, 6 % funda para celular" le enseña al estudiante qué categorías se parecen.` },
          { t: 'list', items: [
            `<b>Por qué es la vía más confiable a un modelo más rápido:</b> eliges la arquitectura del estudiante por su latencia en tu hardware (un MobileNet para CPU, algo más chico para un Jetson), en vez de esperar que una poda se traduzca en velocidad.`,
            `<b>La ventaja escondida en el c01:</b> el maestro puede etiquetar imágenes sin labels humanas. Hay 10 M fotos por día; el cuello de datos del estudiante desaparece.`,
            `<b>El costo:</b> entrenamientos completos, experimentos para elegir la arquitectura y un segundo modelo que reentrenar cada vez que cambia el maestro.`,
            `<b>Un ejemplo publicado:</b> DistilBERT (Sanh et al., 2019) reporta un modelo 40 % más chico y 60 % más rápido que BERT, que conserva 97 % de su capacidad en sus benchmarks.`,
          ] },
          { t: 'table', caption: 'Candidatos a estudiante, 500 clases, batch 1, 4 hilos (' + MAC + ')', head: ['Modelo', 'Parámetros', 'ONNX FP32', 'ONNX Runtime', 'PyTorch eager'], rows: [
            ['ResNet-50 (maestro)', '24.5 M', '98 MB', E('≈ 15.7 ms'), E('≈ 16.4 ms')],
            ['ResNet-18', '11.4 M', '45.7 MB', E('≈ 9.9 ms'), E('≈ 8.1 ms')],
            ['EfficientNet-B0', '4.6 M', '18.5 MB', E('≈ 6.1 ms'), E('≈ 90 ms')],
            ['MobileNetV3-Large', '4.8 M', '19.3 MB', E('≈ 3.6 ms'), E('≈ 43 ms')],
          ], note: 'Dos lecciones en la misma tabla. (1) Un estudiante de la clase EfficientNet/MobileNet fue ≈ 2.6–4.4× más rápido que el maestro en CPU. (2) El runtime importa tanto como la arquitectura: en PyTorch eager, en esta CPU, los modelos con convoluciones depthwise fueron más lentos que el ResNet-50; en ONNX Runtime, los más rápidos. En GPU, esos modelos ganan menos de lo que sugieren sus FLOPs, porque las convoluciones depthwise son memory-bound: mídelo en la T4.' },
          { t: 'calc', title: 'El c01 en CPU con un estudiante (cadena de estimaciones: cada eslabón se verifica)', rows: [
            { label: 'ResNet-50 FP32 en CPU de servidor', expr: 'estimación del c01', value: E('≈ 40–80 ms por imagen por vCPU') },
            { label: 'Estudiante vs maestro', expr: 'razón medida en la Mac: 15.7 / 6.1 a 15.7 / 3.6', value: E('≈ 2.6–4.4× más rápido'), note: '<b>Supuesto:</b> que la razón se mantenga en x86 de servidor' },
            { label: 'Estudiante FP32 por vCPU', expr: '40 / 4.4 a 80 / 2.6', value: E('≈ 9–31 ms') },
            { label: 'vCPU a provisionar en el pico (HPA al 60 %, <a href="#m06.hpa">M6</a>)', expr: '500 × (0.009 a 0.031) ÷ 0.6', value: E('≈ 8–26 vCPU'), note: '≈ 5–16 ocupados, sin el margen del HPA' },
            { label: 'Contra ResNet-50 INT8 (c01), misma base', expr: '500 × (0.008 a 0.025) ÷ 0.6', value: E('≈ 7–21 vCPU') },
          ], result: 'Un estudiante en FP32 cae en el mismo rango que el ResNet-50 en INT8, sin el riesgo de la cuantización pero con su propia pérdida de calidad. Estudiante + INT8 bajaría más. Es exactamente la frase del c01: "si el modelo se destila a algo que corre en CPU, vuelve a ser una opción seria".' },
          { t: 'table', caption: 'Las tres formas de achicar, lado a lado', head: ['', 'Cuantización', 'Pruning estructurado', 'Destilación'], rows: [
            ['Qué cambia', 'Los bytes por número', 'El ancho del mismo modelo', 'La arquitectura entera'],
            ['Ganancia típica', E('≈ 1.5–2×') + ' (INT8)', E('≈ 1.2–2×'), 'La razón maestro/estudiante: ' + E('2–5×') + ' o más'],
            ['Requiere entrenar', 'No (PTQ) · sí (QAT)', 'Sí (fine-tuning)', 'Sí (entrenamiento completo)'],
            ['Quién lo hace', 'MLE en el pipeline de deploy', 'Equipo de modelado', 'Equipo de modelado'],
            ['Se combinan', 'Con las otras dos', 'Con cuantización', 'Con cuantización (el estudiante también se cuantiza)'],
          ] },
          { t: 'callout', kind: 'senior', html: `<p>En el c01 no te toca rediseñar el modelo, pero sí proponerlo con números: "si el benchmark de ResNet-50 INT8 en CPU no cumple, le pediría al equipo de modelado un estudiante del tamaño de un MobileNet destilado del ResNet-50 con fotos sin etiquetar del tráfico. Si el estudiante es ≈ 3–4× más barato, como en mi medición en CPU, CPU-only necesita ≈ 8–26 vCPU a provisionar en el pico en FP32 (≈ 5–16 ocupados) y menos en INT8: lo confirmo con el benchmark y, si cumple, nos ahorramos las dos T4". Es una recomendación con costo, beneficio y dueño.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Unstructured pruning makes the model sparse, not faster: dense GPU kernels still multiply the zeros. If we need a much cheaper model, I'd rather distill into a smaller architecture that we pick for its latency on our hardware."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'torch-compile',
        title: 'torch.compile en serving',
        titleEn: 'torch.compile for serving',
        priority: 'extra',
        dims: ['tradeoffs', 'arquitectura'],
        blocks: [
          { t: 'p', html: `torch.compile es la forma de acelerar un modelo sin salir de PyTorch. Número primero, medido en CPU con el ResNet-50 del c01 (${MAC}): la primera llamada tardó <b>≈ 17 s</b> (compilando); las siguientes, ${E('≈ 15 ms')} contra ${E('≈ 16–19 ms')} de eager. La ganancia en régimen fue modesta; el costo de arranque, enorme. Ese par de números es todo el tema de esta sección.` },
          { t: 'h3', text: 'Qué hace' },
          { t: 'list', items: [
            `<b>Captura el grafo.</b> TorchDynamo intercepta la ejecución de Python y arma grafos con las operaciones de tensores. Lo que no puede capturar (una llamada a una librería externa, cierto código dinámico) produce un <b>graph break</b>: el grafo se parte y ese tramo corre en eager.`,
            `<b>Genera kernels fusionados.</b> Inductor, el backend por defecto, fusiona operaciones y genera código: kernels de Triton en GPU y C++ con OpenMP en CPU (por eso, en CPU, la imagen necesita un compilador de C++).`,
            `<b>Pone guardas.</b> El código compilado vale para ciertas condiciones (shapes, dtypes). Si cambian, <b>recompila</b>. Después de 8 recompilaciones de la misma función (<code>recompile_limit</code>), vuelve a eager.`,
          ] },
          { t: 'table', caption: 'Modos de torch.compile (torch 2.14)', head: ['Modo', 'Qué agrega', 'Cuándo', 'Precio'], rows: [
            ['<code>default</code>', 'Fusión de operaciones', 'Punto de partida', 'Compilación de segundos a decenas de segundos'],
            ['<code>reduce-overhead</code>', 'CUDA graphs: graba la secuencia de kernels y la relanza de una vez', 'Batch chico en GPU, donde manda el overhead de lanzar kernels', 'Más memoria; un grafo grabado por shape'],
            ['<code>max-autotune</code>', 'Prueba varias implementaciones de GEMM y convoluciones, más CUDA graphs', 'Exprimir más rendimiento en GPU cuando el tiempo de compilación no importa', 'Compilación mucho más larga (minutos)'],
            ['<code>max-autotune-no-cudagraphs</code>', 'Lo mismo sin CUDA graphs', 'Cuando CUDA graphs choca con tu código o tu memoria', 'Compilación larga'],
          ] },
          { t: 'h3', text: 'Formas nuevas: recompilación' },
          { t: 'p', html: `En serving, los batches cambian de tamaño todo el tiempo. Con el default (<code>dynamic=None</code>), la primera shape se compila especializada; cuando llega otra, torch.compile recompila con una dimensión dinámica. Lo que medí, con <code>TORCH_LOGS=recompiles</code>:` },
          { t: 'table', caption: 'ResNet-50, CPU, torch 2.14 (' + MAC + ')', head: ['Evento', 'Tiempo'], rows: [
            ['Primera llamada, batch 1, sin caché en disco', '≈ 17 s'],
            ['Primer batch 8: recompila con batch dinámico', '≈ 6 s sin caché · ≈ 0.7 s con caché'],
            ['Primer batch 4 después', 'Sin recompilar: ya cubría ese rango'],
            ['Primer batch 16', 'Recompiló otra vez: la guarda del grafo dinámico decía 2 ≤ batch ≤ 15'],
            ['Proceso nuevo con el caché de disco caliente, batch 1', '≈ 1.1–1.4 s'],
            ['En régimen: batch 1 / batch 8', E('≈ 15 ms / ≈ 93–96 ms') + ' (eager: ' + E('≈ 16–19 / ≈ 104–114 ms') + '), ≈ 1.1–1.2×'],
          ], note: 'En GPU la ganancia en régimen suele ser mayor que en CPU (fusión de operaciones elemento a elemento y, con reduce-overhead, CUDA graphs), pero depende del modelo y del batch. No tengo un número confiable para ResNet-50 en una T4: se mide.' },
          { t: 'callout', kind: 'trap', title: 'El primer request paga la compilación', html: `<p>Un pod con torch.compile que pasa la readiness antes de compilar: el primer usuario espera la compilación (17 s en mi medición en CPU), el primero con un batch de otro tamaño espera otra, y el p99 de ese pod explota mientras sigan llegando shapes nuevas. Tres defensas: <b>warmup</b> con todas las shapes que vas a ver antes de marcar el pod como listo (el <code>model_warmup</code> de Triton en el c01 hace lo mismo con el engine), <b>caché de compilación</b> que viaja con la imagen (<code>torch.compiler.save_cache_artifacts()</code> / <code>load_cache_artifacts()</code>) y, si puedes, <b>compilar antes</b> con AOTInductor. Todo eso suma al cold start de <a href="#m06.cold-starts">M6</a>.</p>` },
          { t: 'code', title: 'torch.compile listo para servir, y la versión ahead of time', caption: 'Los dos corrieron en el venv de este módulo con torch 2.14 en CPU. En la Mac, el warmup completo tardó ≈ 21 s; el <code>.pt2</code> tardó ≈ 7.6 s en compilarse (con caché caliente), ≈ 1 s en cargar, y sus logits difirieron de eager en ≈ 5e-5.', files: [
            { name: 'compile_warmup.py', lang: 'python', code: COMPILE_SNIPPET },
            { name: 'aot_inductor.py', lang: 'python', code: AOTI_SNIPPET, note: 'AOTInductor empaqueta el resultado de Inductor en un <code>.pt2</code> que se carga desde Python o C++ sin recompilar. Los tutoriales de PyTorch lo marcan como beta: pruébalo con tu modelo antes de apostar el serving a él.' },
          ] },
          { t: 'h3', text: 'Cuándo es el camino correcto' },
          { t: 'table', head: ['', 'torch.compile', 'TensorRT', 'ONNX Runtime'], rows: [
            ['Te quedas en PyTorch', 'Sí: una línea', 'No (salvo Torch-TensorRT)', 'No: exportas'],
            ['Modelos difíciles de exportar', 'Sí: lo que no captura corre en eager', 'Difícil: plugins o Torch-TensorRT', 'Difícil: custom ops'],
            ['Máximo throughput en GPU NVIDIA con INT8/FP8', 'Menos maduro', '<b>Sí</b>', 'Vía su provider de TensorRT'],
            ['CPU, edge, varios fabricantes', 'CPU sí; edge limitado', 'Solo NVIDIA', '<b>Sí</b>: CPU, OpenVINO, CoreML, Arm'],
            ['Servir sin Python', 'Con AOTInductor (C++)', 'Sí (Triton)', 'Sí (C++, C#, Java…)'],
            ['Costo de arranque', 'Compila en el proceso: warmup y caché obligatorios', 'Build en CI; cargar el plan toma segundos', 'Optimiza el grafo al crear la sesión: segundos'],
            ['Encaja con', 'FastAPI + PyTorch en el mismo proceso (el MVP del c01)', 'Triton (el c01)', 'Triton, un gateway en CPU, el cliente'],
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"torch.compile is the low-friction option when we want to stay in PyTorch, but it compiles on the first call and recompiles on new shapes. So I warm it up with every batch size before the pod reports ready, ship the compile cache with the image, or package the model ahead of time with AOTInductor."</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'cpu-inferencia',
        title: 'Inferencia en CPU: ONNX Runtime y OpenVINO',
        titleEn: 'CPU inference: ONNX Runtime and OpenVINO',
        priority: 'extra',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `El c01 ya hizo la cuenta (<a href="#c01.estimaciones">estimaciones</a>, <a href="#m04.cpu-gpu-tpu">M4</a>): ResNet-50 FP32 en CPU serían ${E('≈ 20–40 vCPU')} ocupados en el pico (${E('≈ 33–67')} a provisionar con el HPA al 60 %); en INT8, a ${E('≈ 8–25 ms')} por imagen por vCPU, ${E('≈ 4–12.5')} ocupados y ${E('≈ 7–21')} a provisionar en el pico, y ${E('≈ 4–8 vCPU')} facturados en promedio con el HPA siguiendo la curva diaria: ${E('≈ US$125–250/mes')} contra ${E('≈ US$768')} de las dos T4. Ese 8–25 implica que INT8 rinde ${E('≈ 3–5×')} sobre los 40–80 ms de FP32, lo que se espera en x86 con VNNI (c6i) o AMX (c7i), pero para este stack no está medido. En la laptop M4 medí bastante menos (≈ 1–2×, más abajo), aunque ese número no viaja: ahí el FP32 corre en una unidad de matrices. Si en la instancia real la ganancia fuera ${E('≈ 1.5–2×')}, serían ${E('≈ 20–53 ms')} por imagen y ${E('≈ 17–44 vCPU')} a provisionar en el pico, más cerca de FP32 que del INT8 del c01, y el ahorro contra las dos T4 deja de ser claro. Esa diferencia es lo que decide el benchmark de la semana 1. Esta sección es el cómo: con qué runtime, qué hardware y qué configuración conviertes esa estimación en una medición.` },
          { t: 'h3', text: 'Cuándo la CPU es la respuesta' },
          { t: 'list', items: [
            `<b>Modelos chicos o QPS bajo:</b> tabular, CNNs chicas, un estudiante destilado.`,
            `<b>GPUs que estarían ociosas:</b> la CPU escala con la carga; dos GPUs por N+1 al 5 %, no.`,
            `<b>Operación más simple:</b> sin engine atado a una arquitectura, sin imágenes de CUDA de varios GB, sin cold start de nodos GPU (<a href="#m06.cold-starts">M6</a>).`,
          ] },
          { t: 'h3', text: 'Los runtimes' },
          { t: 'table', head: ['Runtime', 'Fuerte en', 'INT8', 'Nota'], rows: [
            ['ONNX Runtime (CPU)', 'Cualquier CPU x86 o Arm; el mismo ONNX que usas para TensorRT', '<code>quantize_static</code> / <code>quantize_dynamic</code>', 'Es el default razonable; también se usa como backend de Triton'],
            ['OpenVINO (Intel, releases 2026.x)', 'CPUs, GPUs integradas y NPUs de Intel', 'NNCF: PTQ y compresión de pesos', 'Lee ONNX directo; corre también en Arm64, pero donde más rinde es en Intel. Existe como provider de ORT y como backend de Triton'],
            ['PyTorch en CPU', 'Cero export', 'torchao', 'Sirve para un MVP; en mi medición, eager fue muy lento con convoluciones depthwise (<a href="#m08.pruning-destilacion">sección 6</a>)'],
          ] },
          { t: 'callout', kind: 'note', html: `<p>No medí OpenVINO en este entorno (Arm, sin CPUs Intel). Si tu flota es Intel, compáralo contra ONNX Runtime con el mismo ONNX y los mismos datos de calibración: el que gane en ms por imagen por vCPU en tu instancia, con la misma calidad, es el que va.</p>` },
          { t: 'h3', text: 'INT8 en CPU necesita las instrucciones correctas' },
          { t: 'p', html: `La documentación de ONNX Runtime lo dice directo: las ganancias de INT8 llegan en x86-64 con <b>VNNI</b>, en GPUs con tensor cores INT8 y en Arm con instrucciones de <b>producto punto</b>; en hardware más viejo, INT8 puede ser más lento que FP32. En AWS: VNNI desde Cascade Lake (las c6i lo tienen), <b>AMX</b> (unidades de matrices INT8/BF16) desde Sapphire Rapids (c7i), y producto punto en los Graviton (Arm). Graviton suele costar menos por vCPU; no tengo un benchmark de ResNet-50 INT8 en Graviton que pueda citar: mide c6i, c7i y Graviton con el mismo ONNX antes de elegir. Detalle en <a href="#m04.cpu-gpu-tpu">M4</a>.` },
          { t: 'h3', text: 'Hilos vs procesos' },
          { t: 'p', html: `Dos formas de usar 4 cores: un proceso con 4 hilos por operador (<code>intra_op_num_threads</code>), o 4 procesos con un hilo cada uno. Lo medí con ONNX Runtime (${MAC}):` },
          { t: 'table', caption: 'ResNet-50 en ONNX Runtime, batch 1, 4 cores, corridas sostenidas de 8 s', head: ['Configuración', 'FP32: throughput', 'FP32: latencia por request', 'INT8 estático: throughput', 'INT8 estático: latencia'], rows: [
            ['1 proceso × 4 hilos', E('≈ 61 img/s'), E('≈ 16.5 ms'), E('≈ 79 img/s'), E('≈ 12.6 ms')],
            ['2 procesos × 2 hilos', E('≈ 72 img/s'), E('≈ 28 ms'), E('≈ 89 img/s'), E('≈ 22.5 ms')],
            ['4 procesos × 1 hilo', E('≈ 86 img/s'), E('≈ 46 ms'), E('≈ 102 img/s'), E('≈ 39 ms')],
          ], note: 'Más procesos: más throughput total, pero cada request tarda más. Más hilos por proceso: menos latencia por request, con rendimientos decrecientes. Ojo con esta Mac: en FP32 casi no escala con hilos (1 hilo ≈ 20 ms, 4 hilos ≈ 16–18 ms) porque ONNX Runtime 1.30 corre sus GEMM FP32 en la unidad de matrices SME de la M4 vía KleidiAI, compartida por el clúster de núcleos de rendimiento. Con <code>mlas.disable_kleidiai=1</code> (NEON por núcleo, más parecido a un x86), FP32 pasa de ≈ 88 ms con 1 hilo a ≈ 32 ms con 4; el INT8 estático, que no usa esa unidad, pasa de ≈ 21 a ≈ 8 ms. Eliges según el SLO: con margen en el presupuesto de latencia, más procesos (throughput); con el presupuesto justo, más hilos por request. En los dos casos, mide el p99 con la configuración elegida.' },
          { t: 'callout', kind: 'trap', title: 'Los hilos que no te dieron', html: `<p>En Kubernetes, un pod con un límite de 4 vCPU en un nodo de 64 cores: ONNX Runtime y PyTorch dimensionan sus pools por los cores que ven en el nodo, no por tu límite. Resultado: decenas de hilos peleando por 4 vCPU de cuota, CPU throttling y un p99 que empeora al subir la carga (<a href="#m03.presupuesto">M3</a>). Peor si PyTorch, ORT y NumPy crean cada uno su pool en el mismo proceso. Fija los hilos explícitamente con el límite del pod.</p>` },
          { t: 'code', title: 'Una sesión de ONNX Runtime para un pod de CPU', caption: 'Corrió en el venv de este módulo con el INT8 de la sección 5.', files: [
            { name: 'sesion_cpu.py', lang: 'python', code: ORT_CPU_SNIPPET },
          ] },
          { t: 'h3', text: 'Batching en CPU' },
          { t: 'p', html: `En <a href="#m03.batching">M3</a> quedó escrito que el batching rinde menos en CPU. Mis mediciones lo confirman y agregan una advertencia: en PyTorch eager, batch 8 dio ${E('≈ 13–14 ms')} por imagen contra ${E('≈ 16–19 ms')} en batch 1 (poca ganancia); en ONNX Runtime FP32, batch 8 fue <b>más lento</b> por imagen (${E('≈ 27–31 ms')}) que batch 1; y en PyTorch eager, batch 16 saltó a ${E('≈ 1.5 s')}, un acantilado de rendimiento del backend en esta máquina. En CPU, mide batch 1 con varios procesos antes de asumir que el batching ayuda.` },
          { t: 'callout', kind: 'trap', title: 'Dimensionar con tu laptop', html: `<p>Con un solo hilo y la máquina ociosa, la M4 corrió ResNet-50 FP32 en ≈ 20 ms; el c01 estima ${E('40–80 ms')} por vCPU en servidores x86. No se contradicen, y no porque el núcleo de la laptop sea "más rápido". Esos 20 ms salen de la unidad de matrices SME de la M4, que ONNX Runtime usa en FP32 vía KleidiAI; sin ella (<code>mlas.disable_kleidiai=1</code>) el mismo núcleo tarda ≈ 88 ms. Un vCPU de c6i (medio core físico, sin unidad de matrices para FP32) no se parece a eso. Además, la latencia de un hilo con la máquina ociosa no dimensiona: con 4 procesos de un hilo (tabla de arriba), cada imagen costó 4 ÷ 86 img/s ≈ 46 ms de núcleo en FP32 y 4 ÷ 102 ≈ 39 ms en INT8 estático. Lo que dimensiona es núcleos ÷ throughput a saturación, medido en el tipo de instancia de producción con el límite de CPU del pod. Y la razón INT8/FP32 tampoco viaja: aquí el FP32 tiene unidad de matrices y el INT8 no; en una c7i es al revés (AMX acelera INT8 y BF16, no FP32).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"On CPU I size the thread pool to the pod's CPU limit, not the node's cores. For throughput I'd rather run a few single-threaded workers than one process with many threads, as long as per-request latency still fits the budget. And I benchmark on the production instance type, not on my laptop."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'validar',
        title: 'Cómo validar una optimización',
        titleEn: 'How to validate an optimization',
        priority: 'core',
        dims: ['monitoreo', 'comunicacion'],
        blocks: [
          { t: 'p', html: `Toda optimización produce un artefacto distinto del que evaluaste. La pregunta del entrevistador es siempre la misma: "¿cómo sabes que sigue funcionando?". La respuesta es un gate en orden, donde cada paso atrapa algo que el anterior no ve, y que corre en CI antes de que el artefacto llegue al registry.` },
          { t: 'steps', items: [
            { title: 'Paridad numérica', meta: 'CI, minutos', html: `<p>El artefacto contra PyTorch FP32 sobre ≈ 10k imágenes del golden set, con el preproceso del gateway: acuerdo top-1 ≥ 99.5 %, top-5 ≥ 99 % y max|Δlogit| reportado (c01). Para INT8 el acuerdo es menor: su umbral se fija con datos y decide el paso 2. Atrapa: bugs de export, precisión rota, opset.</p>` },
            { title: 'Calidad en el golden set, por slices', meta: 'CI, minutos', html: `<p>Top-1/top-5 no inferiores con test pareado (≥ −0.3 pp contra el champion), recall por clase head vs long tail, slices (móvil, web, poca luz, imágenes chicas) dentro de su intervalo, ECE ≤ 0.05. Atrapa: lo que la cuantización rompe en subpoblaciones.</p>` },
            { title: 'Latencia y throughput medidos', meta: 'CI en la GPU de destino', html: `<p>perf_analyzer contra Triton con la configuración real, al pico de diseño por GPU (250 req/s) y en failover (500 req/s): p99 ≤ champion + 10 % y el throughput máximo. También la memoria (<code>nv_gpu_memory_used_bytes</code>) y el tiempo de carga del modelo. En CPU: ms por imagen por vCPU en el tipo de instancia de producción. Atrapa: una "optimización" que no optimiza con tus batches reales.</p>` },
            { title: 'Paridad end-to-end', meta: 'staging', html: `<p>Imágenes de referencia por el gateway real contra las predicciones del pipeline de evaluación. Atrapa: skew de preprocesamiento, labels en otro orden, un gateway que manda otro dtype.</p>` },
            { title: 'Shadow y canary con métricas online', meta: 'producción, horas a días', html: `<p>Shadow 1–2 días; canary 5 % → 25 % → 100 % con rollback automático por 5xx, p99, tasa de baja confianza y PSI contra el estable (<a href="#c01.evaluacion">c01, evaluación</a>). Si la optimización cambió algo visible, A/B sobre la tasa de aceptación. Atrapa: la distribución real que el golden set no tiene. Despliegue seguro en detalle: <a href="#m11">M11</a>.</p>` },
          ] },
          { t: 'h3', text: 'Qué comparas' },
          { t: 'checklist', id: 'comparar-optimizacion', items: [
            { id: 'top1', html: 'Acuerdo top-1 y solapamiento top-5 contra PyTorch FP32, sobre imágenes reales con el preproceso del gateway.' },
            { id: 'logits', html: 'Diferencia máxima de logits: ≈ 1e-4 en FP32, ≈ 1e-2 en FP16; un salto de órdenes de magnitud es un bug.' },
            { id: 'global', html: 'Top-1 y top-5 en el golden set con test pareado contra el champion, no contra un número histórico.' },
            { id: 'por-clase', html: 'Recall por clase, head vs long tail, con un test por categoría para no perseguir ruido.' },
            { id: 'slices', html: 'Cada slice (móvil, web, poca luz, imágenes chicas; en detección, objetos chicos) dentro de su intervalo.' },
            { id: 'calibracion', html: 'ECE y la distribución de scores: la tasa de baja confianza depende de un umbral que la cuantización puede mover.' },
            { id: 'p99', html: 'p99 y throughput con perf_analyzer a la carga de diseño y de failover, en la GPU de destino, contra el champion.' },
            { id: 'memoria', html: 'VRAM (o RAM) usada y tiempo de carga del artefacto: lo que cuesta un cold start.' },
            { id: 'huellas', html: 'Huellas del build en el registry: hash del ONNX y del engine, GPU, versión de TensorRT o del runtime, datos de calibración.' },
            { id: 'online', html: 'En el canary: 5xx, p99, tasa de baja confianza y PSI contra el estable en la misma ventana.' },
          ] },
          { t: 'callout', kind: 'trap', title: 'Medir la optimización en el lugar equivocado', html: `<p>Tres versiones del mismo error: medir con trtexec en batch 32 cuando online llegan batches de 1–3; medir en tu laptop y dimensionar una c6i; medir el accuracy en el set de validación del entrenamiento en vez del golden set congelado. Cada número tiene que venir del hardware, la carga y los datos de producción, o no decide nada.</p>` },
          { t: 'followups', items: [
            { q: 'INT8 bajó 0.3 % el accuracy global. ¿Lo lanzas?',
              junior: 'Sí: 0.3 % es poco y la latencia baja casi a la mitad.',
              senior: 'Primero, ¿qué compra? En el c01 hoy nada: las dos T4 están por N+1 al ≈ 5 %, y la latencia del modelo es ≈ 10 % del p99. Solo lo consideraría a 10× el tráfico (10 → 6–7 T4) o para mover el modelo a CPU. Segundo, −0.3 pp está en el borde del gate de no inferioridad, y el global esconde el long tail: miro recall por clase head vs tail, slices y el cambio en ECE y en la tasa de baja confianza. Si el tail cae más que su intervalo, pruebo escalas por canal, calibración por percentil, capas sensibles en FP16 o QAT; si pasa, canary con rollback.',
              why: 'Convierte la pregunta de calidad en una de beneficio, y no acepta el promedio como evidencia.' },
            { q: 'Tu engine funciona en la T4 y falla al cargar en la L4 nueva. ¿Por qué?',
              junior: 'Seguramente es un problema de drivers o de CUDA en el nodo nuevo.',
              senior: 'Un engine de TensorRT se construye para una arquitectura (T4 es sm_75, L4 sm_89) y una versión de TensorRT: no es portable. Construyo un segundo engine en CI sobre una L4 con la misma release de NGC, lo publico con su propio tag de imagen y uso nodeSelector por node pool para que cada pod caiga en su GPU. El modo de hardware compatibility ampere+ serviría para L4, A10G y A100 con algo de pérdida de rendimiento, pero no cubre la T4. Y agrego la GPU a las huellas del registry.',
              why: 'Explica el mecanismo (tácticas y kernels por arquitectura) y lo convierte en proceso de CI y de scheduling.' },
            { q: '¿torch.compile o TensorRT?',
              junior: 'TensorRT: es el más rápido en GPUs NVIDIA; torch.compile es para experimentar.',
              senior: 'Depende de dónde vive el serving. Si ya tengo Triton en GPU NVIDIA y quiero máximo throughput, INT8 o FP8, TensorRT con el engine construido en CI. Si el servicio es FastAPI con PyTorch en el mismo proceso, o el modelo no exporta bien a ONNX, torch.compile con warmup de todas las shapes y el caché de compilación en la imagen, o Torch-TensorRT como punto medio. En los dos casos, el mismo gate: paridad, slices y perf_analyzer.',
              why: 'Decide por arquitectura del serving y costo operativo, no por un benchmark genérico.' },
            { q: 'El parity test del engine FP16 da 97 % de acuerdo top-1. ¿Qué pasó?',
              junior: 'FP16 pierde precisión; bajaría el umbral a 97 %.',
              senior: 'FP16 en una CNN normalmente pasa el 99.5 % con holgura: 97 % es un bug. Primero pruebo el ONNX FP32 en ONNX Runtime: si ahí ya da 97 %, el problema está en el export (preproceso distinto, opset mal convertido, orden de labels). Si FP32 pasa y el engine no, busco la capa que diverge comparando salidas intermedias (Polygraphy puede marcarlas todas) y la dejo en FP32; puede ser un overflow de FP16. Nunca bajo el umbral para que pase.',
              why: 'Sabe qué diferencia es esperable en cada precisión y aísla el problema por etapas.' },
            { q: 'Hiciste el modelo 2× más rápido y el p99 no se movió. ¿Por qué?',
              junior: 'Habrá que optimizar más el modelo, quizás con INT8.',
              senior: 'Porque el modelo no era el p99. En el c01 el cómputo es ≈ 8–15 ms de ≈ 150 ms: la cola la ponen las fotos web grandes en el decode, las pausas de GC y la red. Lo confirmo con los histogramas por tramo del gateway y el tiempo en cola vs cómputo de Triton. También reviso que el benchmark que dio 2× se haya hecho con los batches reales de 1–3, no con 32.',
              why: 'Aplica Amdahl con los números del caso y sabe dónde mirar.' },
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"The optimized artifact isn't the one we evaluated, so it has to earn its way in: numerical parity against the FP32 model, quality by slice on the golden set, latency at design load on the target GPU, and then a canary with automatic rollback."</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['tradeoffs', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, relee la sección de la explicación antes de volver al <a href="#c01.serving">serving del caso 1</a>.` },
          { t: 'quiz', items: [
            { q: 'En el c01, el cómputo GPU es ≈ 8–15 ms de un p99 pesimista de ≈ 150 ms. Haces el modelo 2× más rápido. ¿Qué le pasa al p99?', options: ['Baja a la mitad', 'Baja ≈ 3–5 %', 'No cambia nada', 'Sube por la cuantización'], answer: 1,
              explain: 'Solo se acelera la parte de cómputo: ahorras 4–7.5 ms de 150. Ley de Amdahl. Por eso el c01 ataca primero el preproceso (draft mode) y no el modelo.' },
            { q: '¿Cuánto pesan los pesos de ResNet-50 (25.6 M parámetros) en INT8?', options: ['≈ 6 MB', '≈ 26 MB', '≈ 51 MB', '≈ 102 MB'], answer: 1,
              explain: '25.6 M × 1 byte ≈ 26 MB, más unas escalas. 51 MB es FP16 y 102 MB, FP32. El c01 (500 clases) pasó de 98 MB a 25.1 MB.' },
            { q: 'Pones en cero el 50 % de los pesos (pruning no estructurado) y sirves con los mismos kernels. ¿Qué pasa con la latencia?', options: ['Baja ≈ 50 %', 'Baja ≈ 25 %', 'Prácticamente no cambia', 'Sube por el overhead de la máscara'], answer: 2,
              explain: 'Los kernels densos multiplican los ceros igual que cualquier número: medí 15.8 ms densos contra 16.0 ms con 50 % de ceros. Para acelerar hace falta pruning estructurado (un modelo más angosto) o kernels sparse, como 2:4 en Ampere+.' },
            { q: 'Tu flota agrega L4 y quieres un solo engine para todo. ¿Qué es cierto?', options: ['Con --hardwareCompatibilityLevel=ampere+ el engine corre también en las T4', 'Un engine construido en T4 corre en L4 si la versión de TensorRT es la misma', 'Ampere+ cubre L4, A10G y A100 con algo de pérdida, pero no la T4: sigues necesitando un engine para Turing', 'Basta con reconstruir el ONNX'], answer: 2,
              explain: 'Los engines dependen de la arquitectura y de la versión de TensorRT. El modo ampere+ empieza en compute capability 8.0: la T4 (7.5) queda fuera. Dos engines, dos tags de imagen, nodeSelector por node pool.' },
            { q: '¿Qué datos usas para calibrar INT8?', options: ['Ruido gaussiano con la forma del input', 'El set de entrenamiento con sus augmentations', '≈ 500–1,000 imágenes del tráfico real, con el preproceso del gateway y estratificadas por slice', 'El golden set completo'], answer: 2,
              explain: 'Las escalas se ajustan a la distribución que ven. El golden set se reserva para evaluar sin sesgo; el ruido produce escalas inútiles.' },
            { q: 'ResNet-50 en CPU: ¿cuantización estática o dinámica?', options: ['Dinámica: no necesita calibración y rinde igual', 'Estática: las escalas de activación se fijan antes con calibración, sin costo por request; la dinámica las calcula en cada inferencia y en convoluciones gana poco', 'Ninguna: INT8 no acelera en CPU', 'Dinámica, porque es la que ORT recomienda para CNNs'], answer: 1,
              explain: 'ORT recomienda estática para CNNs y dinámica para transformers y RNNs. En la laptop M4, batch 1 con 4 hilos: dinámica ≈ 1× y estática ≈ 2× sobre FP32. INT8 sí acelera en CPU si el hardware tiene las instrucciones (VNNI, AMX o producto punto en Arm).' },
            { q: 'Un pod con torch.compile pasa la readiness y el primer usuario espera 17 s. ¿Cuál es la corrección?', options: ['Usar mode="max-autotune"', 'Warmup con todas las shapes antes de la readiness, caché de compilación en la imagen o AOTInductor', 'Subir el timeout del caller a 20 s', 'Desactivar el dynamic batching'], answer: 1,
              explain: 'La compilación ocurre en la primera llamada y con cada shape nueva. Se paga en el warmup (o en CI, con AOTInductor), nunca en un request. max-autotune compila todavía más.' },
            { q: 'El parity test del engine TensorRT FP16 da 97 % de acuerdo top-1. ¿Qué es lo más probable?', options: ['Es el error normal de FP16', 'Un bug: preproceso distinto, opset mal convertido u orden de labels', 'El golden set está mal etiquetado', 'La T4 está throttling'], answer: 1,
              explain: 'FP16 en una CNN normalmente pasa el 99.5 % de acuerdo con holgura. Prueba primero el ONNX FP32 en ONNX Runtime para saber si el problema está en el export o en el engine.' },
            { q: 'Pod con límite de 4 vCPU en un nodo de 64 cores; no fijas los hilos de ONNX Runtime. ¿Qué pasa?', options: ['Nada: ORT lee el límite del cgroup', 'ORT dimensiona su pool por los cores del nodo: demasiados hilos para 4 vCPU, throttling y p99 peor', 'ORT usa un solo hilo', 'El pod no arranca'], answer: 1,
              explain: 'Fija intra_op_num_threads con el límite del pod (por ejemplo, con la Downward API) y evita que varios frameworks creen pools en el mismo proceso.' },
          ] },
          { t: 'checklist', id: 'antes-de-optimizar', items: [
            { id: 'tramos', html: 'Sé en qué tramo está el tiempo (preproceso, red, cola, cómputo) por los histogramas, antes de tocar el modelo.' },
            { id: 'que-compra', html: 'Digo qué compra la optimización: menos máquinas, menos latencia, que quepa, un tier menos o que corra en el borde.' },
            { id: 'orden', html: 'Sigo el orden de retorno: menos trabajo por request (caché, cascada, resolución), batching y hardware, runtime, precisión, modelo más chico.' },
            { id: 'referencia', html: 'Tengo congelada la referencia: checkpoint FP32, preproceso y golden set.' },
            { id: 'export', html: 'Exporto en eval(), con los nombres y el eje de batch del contrato, y verifico el opset real del archivo.' },
            { id: 'paridad', html: 'Corro el parity test (top-1 ≥ 99.5 %, top-5, max|Δlogit|) con imágenes reales y el preproceso del gateway.' },
            { id: 'calibracion', html: 'Calibro INT8 con ≈ 500–1,000 imágenes del tráfico real, estratificadas por slice y versionadas con el modelo.' },
            { id: 'slices', html: 'Evalúo la versión optimizada por clase y por slice, y miro el ECE, no solo el global.' },
            { id: 'gpu-destino', html: 'Construyo el engine en CI sobre la GPU de destino con la misma versión de TensorRT que sirve, y guardo las huellas.' },
            { id: 'perf', html: 'Mido p99 y throughput con perf_analyzer a la carga de diseño y de failover, con los batches reales.' },
            { id: 'arranque', html: 'Sé cuánto tarda en cargar o compilar el artefacto y lo pago en CI o en el warmup, nunca en un request.' },
            { id: 'canary', html: 'Lanzo con shadow y canary, con rollback automático, y la release anterior sigue viva.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm08-01', kind: 'concepto', q: '¿Por qué optimizar el modelo casi no compra nada en el c01 hoy?',
        a: 'El cómputo GPU es ≈ 8–15 ms de un p99 pesimista de ≈ 150 ms (2× más rápido = −3–5 % de p99), y las 2 T4 están ahí por N+1 al ≈ 5 % de carga: aunque INT8 duplique la capacidad, siguen siendo 2. Paga a 10× el tráfico (10 → 6–7 T4) o si elimina el tier de GPU.' },
      { id: 'm08-02', kind: 'numero', q: 'Pesos de ResNet-50 (25.6 M parámetros) en FP32, FP16 e INT8.',
        a: '≈ 102 MB · ≈ 51 MB · ≈ 26 MB. El c01 (500 clases, 24.5 M): ONNX FP32 de 98 MB → INT8 de ≈ 25 MB. La latencia baja mucho menos que 4×.' },
      { id: 'm08-03', kind: 'concepto', q: 'Orden de retorno de las optimizaciones.',
        a: '(0) No llamar al modelo o llamarlo con menos (caché, cascada, resolución), (1) batching y hardware correcto, (2) un runtime compilado en la misma precisión (TensorRT, ORT, torch.compile), (3) menos precisión (FP16 → INT8/FP8), (4) un modelo más chico (destilación, pruning estructurado). De menos a más riesgo de calidad y costo de ingeniería.' },
      { id: 'm08-04', kind: 'concepto', q: '¿Qué es ONNX y qué es el opset?',
        a: 'Un formato de archivo con el grafo del modelo (operadores), sus pesos y la firma de entradas/salidas. El opset es la versión de la definición de los operadores; el runtime que lo lee (TensorRT, ORT, OpenVINO) tiene que conocerlo. El c01 usa opset 17.' },
      { id: 'm08-05', kind: 'trampa', q: '¿Qué pasa si exportas o compilas sin model.eval()?',
        a: 'Con torch.onnx.export (torch 2.14), nada: TorchScript exporta en eval por defecto y dynamo avisa pero también da un grafo de inferencia (medido: 100 % de acuerdo). Rompe en silencio con torch.export/AOTInductor y torch.compile, que capturan el BatchNorm en modo train (0 % de acuerdo medido), y si la referencia del parity test está en train. Llama a eval() siempre.' },
      { id: 'm08-06', kind: 'numero', q: 'Umbrales del parity test del c01 y diferencias esperables.',
        a: 'Acuerdo top-1 ≥ 99.5 % y top-5 ≥ 99 % sobre ≈ 10k imágenes del golden set con el preproceso del gateway. max|Δlogit|: ≈ 1e-4 FP32 vs FP32, ≈ 1e-2 con TensorRT FP16; el tope de 0.5 atrapa exports rotos.' },
      { id: 'm08-07', kind: 'concepto', q: '¿Qué hace el builder de TensorRT?',
        a: 'Simplifica el grafo (constant folding, pliega BatchNorm), fusiona capas (conv + bias + ReLU), elige la precisión por capa, cronometra tácticas (kernels candidatos) en la GPU del build y se queda con las más rápidas, planifica la memoria y serializa un .plan atado a esa versión.' },
      { id: 'm08-08', kind: 'trampa', q: '¿Por qué un engine construido en una T4 no carga en una L4? ¿Sirve ampere+?',
        a: 'Tácticas medidas y kernels compilados para sm_75, y un formato atado a la versión de TensorRT. Se construye uno por tipo de GPU en CI, con la misma release que sirve. ampere+ cubre L4/A10G/A100 con algo de pérdida, pero no la T4 (Turing).' },
      { id: 'm08-09', kind: 'concepto', q: '¿Qué es un optimization profile y cuál usa el c01?',
        a: 'Shapes mínima, óptima y máxima de una entrada dinámica: el engine acepta ese rango y se afina para la óptima. c01: batch 1 / 16 / 32 (máximo = max_batch_size de Triton). Online los batches son ≈ 1–3: conviene comparar contra opt 4.' },
      { id: 'm08-10', kind: 'concepto', q: '¿Qué son los nodos Q/DQ y por qué la calibración es un paso del pipeline?',
        a: 'Pares QuantizeLinear/DequantizeLinear en el ONNX que dicen dónde y con qué escala cuantizar; los escribe ModelOpt (o el cuantizador de ORT, con ActivationSymmetric=True si el destino es TensorRT) con los datos de calibración. El engine hace lo que dice el grafo (en TensorRT 11 es el único camino a INT8), así que las escalas se generan, versionan y validan antes del build, con el mismo gate por slices.' },
      { id: 'm08-11', kind: 'tradeoff', q: 'PTQ vs QAT.',
        a: 'PTQ: cuantizas el modelo entrenado con ≈ 500–1,000 ejemplos de calibración; minutos, sin labels; pierde más en modelos compactos y el long tail. QAT: reentrenas con cuantización simulada; días; recupera esa pérdida. PTQ primero; QAT si PTQ no pasa el gate y INT8 compra algo.' },
      { id: 'm08-12', kind: 'concepto', q: '¿Con qué datos calibras INT8?',
        a: '≈ 500–1,000 imágenes del tráfico reciente, con el preproceso del gateway, estratificadas por slice (móvil/web, poca luz, long tail), sin augmentations, separadas del golden set y versionadas con el modelo. Ruido o datos de otra distribución dan escalas inútiles.' },
      { id: 'm08-13', kind: 'concepto', q: 'Per-channel vs per-tensor; simétrica vs asimétrica.',
        a: 'Pesos: una escala por canal de salida (los canales tienen rangos distintos) y simétrica (zero point 0). Activaciones: per-tensor; en CPU la asimétrica aprovecha mejor valores de un solo signo (post-ReLU), pero TensorRT exige simétrica en pesos y activaciones.' },
      { id: 'm08-14', kind: 'trampa', q: '"INT8 perdió 0.3 pp de accuracy global, es aceptable". ¿Qué falta?',
        a: 'El global esconde el long tail: 80 % head con −0.1 pp y 20 % tail con −1.1 pp dan −0.3 pp global. Mira recall por clase head vs tail, slices, ECE y la tasa de baja confianza. Y pregunta qué compra INT8: en el c01 hoy, nada.' },
      { id: 'm08-15', kind: 'concepto', q: 'Weight-only vs pesos + activaciones (W8A8).',
        a: 'Weight-only (INT8/INT4 en pesos, activaciones en BF16) reduce bytes: acelera el decode memory-bound de un LLM. W8A8 cuantiza ambos operandos para usar los tensor cores INT8: es lo que acelera una CNN compute-bound.' },
      { id: 'm08-16', kind: 'numero', q: '¿Por qué INT8 no da 4× de velocidad si pesa 4× menos?',
        a: 'Una CNN es compute-bound: el techo es TOPS INT8 vs TFLOPS FP16 (T4: 130 vs 65, 2×). Además no todo se cuantiza, hay conversiones Q/DQ y overhead a batch chico. Medí ≈ 2× en la laptop M4 con 4 hilos (≈ 1× con 1 hilo, porque ahí el FP32 corre en la unidad SME); en x86 con VNNI, mídelo. El c01 estima ≈ 1.5–2× sobre FP16 en GPU.' },
      { id: 'm08-17', kind: 'trampa', q: '¿Pruning no estructurado de 50 % acelera la inferencia en GPU?',
        a: 'No: los kernels densos multiplican los ceros igual. Medí 15.8 ms densos contra 16.0 ms con 50 % de ceros, y el checkpoint siguió pesando 98 MB. Acelera el pruning estructurado (modelo más angosto) o 2:4 en GPUs Ampere+.' },
      { id: 'm08-18', kind: 'concepto', q: '¿Qué es la sparsity 2:4 y cuánto gana?',
        a: '2 de cada 4 pesos consecutivos en cero; los sparse tensor cores (Ampere en adelante, no T4) hacen 2× las operaciones de matrices. Pide fine-tuning con la máscara y --sparsity=enable en TensorRT. De punta a punta, ≈ 1.1–1.5× (est.).' },
      { id: 'm08-19', kind: 'tradeoff', q: 'Destilación: qué gana, qué cuesta y por qué encaja en el c01.',
        a: 'Un estudiante chico imita las probabilidades del maestro: ganancia = razón de arquitecturas (MobileNetV3 ≈ 4× más rápido que ResNet-50 en CPU, medido). Cuesta entrenamientos y un segundo modelo que mantener. En el c01, el maestro etiqueta fotos sin labels y el estudiante puede hacer viable CPU-only.' },
      { id: 'm08-20', kind: 'concepto', q: 'torch.compile: modos y el riesgo en serving.',
        a: 'default (fusión), reduce-overhead (CUDA graphs, para batch chico en GPU), max-autotune (prueba kernels; compila mucho más). Compila en la primera llamada (≈ 17 s medido en CPU) y recompila con shapes nuevas: warmup con todas las shapes antes de la readiness, caché en la imagen o AOTInductor.' },
      { id: 'm08-21', kind: 'tradeoff', q: 'torch.compile vs TensorRT vs ONNX Runtime.',
        a: 'torch.compile: quedarte en PyTorch, modelos difíciles de exportar, FastAPI + PyTorch. TensorRT: máximo throughput en GPU NVIDIA con FP16/INT8/FP8 detrás de Triton. ORT: CPU, varios fabricantes, el mismo ONNX en todas partes. Los tres pasan el mismo gate.' },
      { id: 'm08-22', kind: 'concepto', q: 'Inferencia en CPU: qué necesita INT8 y cómo repartes hilos.',
        a: 'INT8 rinde con VNNI (c6i), AMX (c7i) o producto punto en Arm (Graviton); sin eso puede ser más lento que FP32. Hilos = límite de CPU del pod, no cores del nodo. Más procesos de un hilo dan más throughput; más hilos por proceso, menos latencia por request.' },
      { id: 'm08-23', kind: 'concepto', q: 'Los pasos del gate de una optimización.',
        a: '(1) Paridad numérica contra FP32, (2) calidad en el golden set por clase y slice (+ ECE), (3) p99 y throughput con perf_analyzer en la GPU de destino a la carga de diseño, (4) paridad end-to-end por el gateway, (5) shadow y canary con rollback automático.' },
      { id: 'm08-24', kind: 'frase', q: '¿Cómo dices en inglés cuándo vale la pena optimizar el modelo?',
        a: '"GPU compute is only about ten milliseconds of our p99, and the GPU count is set by redundancy, so optimizing the model doesn\'t buy us much yet. It pays off when it removes machines or a whole tier."' },
      { id: 'm08-25', kind: 'frase', q: '¿Cómo defiendes en inglés el gate de INT8?',
        a: '"I\'d only ship INT8 with calibration data sampled from production and a gate on per-class recall and slices, because a small drop overall can hide a much larger drop on the long tail."' },
      { id: 'm08-26', kind: 'frase', q: '¿Cómo explicas en inglés dónde se construye el engine?',
        a: '"A TensorRT engine is tied to one GPU architecture and one TensorRT version, so we build it in CI on the same GPU type and container release we serve with, and never at pod startup."' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'ONNX', es: 'ONNX (formato de intercambio de modelos)', def: 'Open Neural Network Exchange: formato de archivo con el grafo de un modelo (operadores), sus pesos y la firma de entradas y salidas. Lo leen TensorRT, ONNX Runtime y OpenVINO.', say: 'We export the PyTorch model to ONNX and build the TensorRT engine from that file.' },
      { en: 'opset', es: 'versión de operadores de ONNX', def: 'Versión de la definición de los operadores de ONNX que usa un archivo. El runtime que lo lee tiene que conocerla; el c01 fija opset 17.', say: 'We pin opset 17 because that\'s what our TensorRT parser supports well.' },
      { en: 'ONNX Runtime', es: 'ONNX Runtime (ORT)', def: 'Runtime de Microsoft que ejecuta modelos ONNX, optimiza el grafo al crear la sesión y reparte los nodos entre execution providers (CPU, CUDA, TensorRT, OpenVINO…).', say: 'The parity gate runs the ONNX file in ONNX Runtime on CPU, so it doesn\'t need a GPU.' },
      { en: 'execution provider', es: 'proveedor de ejecución (ORT)', def: 'Biblioteca que ejecuta nodos de un grafo de ONNX Runtime en un hardware concreto. Se listan por prioridad; lo que ninguno soporta cae a la CPU.', say: 'I check which execution provider each node landed on, because silent CPU fallbacks kill latency.' },
      { en: 'dynamic axes', es: 'ejes dinámicos', def: 'Dimensiones de un input exportado que pueden variar en inferencia, típicamente el batch. Si no se declaran, quedan fijas al tamaño del ejemplo usado al exportar.', say: 'The batch axis is dynamic from 1 to 32, so Triton can form batches of any size in that range.' },
      { en: 'torch.export', es: 'torch.export', def: 'API de PyTorch que captura un programa completo con shapes simbólicas. Es la base del exportador ONNX por defecto desde torch 2.9 y de AOTInductor.', say: 'The dynamo exporter uses torch.export, so data-dependent control flow fails loudly instead of being traced silently.' },
      { en: 'torch.compile', es: 'torch.compile', def: 'Compilador JIT de PyTorch: TorchDynamo captura grafos desde Python e Inductor genera kernels fusionados. Compila en la primera llamada y recompila cuando cambian las shapes.', say: 'With torch.compile, the pod warms up every batch size before it reports ready.' },
      { en: 'graph break', es: 'corte del grafo', def: 'Punto donde torch.compile no puede capturar el código (una llamada externa, Python dinámico): el grafo se parte y ese tramo corre en eager, con menos optimización.', say: 'A graph break in the postprocessing means that part runs in eager mode, so I check for breaks before counting on the speedup.' },
      { en: 'CUDA graphs', es: 'grafos de CUDA', def: 'Mecanismo de CUDA que graba una secuencia de kernels y la relanza de una vez, eliminando el overhead de lanzarlos uno por uno. Lo usan el modo reduce-overhead de torch.compile y TensorRT.', say: 'At batch size one the GPU is launch-bound, so CUDA graphs help more than faster kernels.' },
      { en: 'AOTInductor', es: 'compilación ahead of time de Inductor', def: 'Camino de PyTorch que compila un programa de torch.export con Inductor y lo empaqueta en un .pt2 que se carga desde Python o C++ sin recompilar.', say: 'We compile the model ahead of time with AOTInductor in CI, so the server only loads a package at startup.' },
      { en: 'TensorRT engine', es: 'engine de TensorRT (plan)', def: 'Archivo serializado (.plan) que produce el builder de TensorRT: kernels elegidos para una arquitectura de GPU y una versión de TensorRT. Por defecto no es portable a otra GPU u otra versión.', say: 'The engine is built for the T4 and TensorRT 10.3, so an L4 node needs its own engine.' },
      { en: 'layer fusion', es: 'fusión de capas', def: 'Combinar varias operaciones (convolución, bias, activación) en un solo kernel para no escribir y releer activaciones intermedias en la memoria de la GPU.', say: 'Layer fusion cuts memory traffic, which matters most at small batch sizes.' },
      { en: 'kernel auto-tuning', es: 'selección de kernels por medición', def: 'El builder de TensorRT prueba varias implementaciones (tácticas) de cada capa, las cronometra en la GPU del build y elige la más rápida. Es la razón por la que el engine queda atado a esa GPU.', say: 'Because TensorRT times its tactics on the build GPU, we build on the same GPU type we serve on.' },
      { en: 'optimization profile', es: 'perfil de optimización', def: 'Rango de shapes (mínima, óptima, máxima) que acepta un engine de TensorRT con entradas dinámicas; las tácticas se afinan para la óptima.', say: 'Our profile covers batch 1 to 32, tuned for 16, but I\'d compare it against one tuned for our real batch of two or three.' },
      { en: 'trtexec', es: 'trtexec (herramienta de TensorRT)', def: 'Línea de comandos de TensorRT para construir engines desde ONNX y medirlos: throughput, percentiles de latencia, cómputo en GPU y copias. No incluye cola ni red.', say: 'trtexec compares engines, but capacity planning comes from perf_analyzer against Triton.' },
      { en: 'Torch-TensorRT', es: 'Torch-TensorRT', def: 'Integración que compila partes de un modelo de PyTorch con TensorRT (backend de torch.compile o compilación ahead of time); lo no soportado sigue en PyTorch.', say: 'If the model doesn\'t export cleanly to ONNX, Torch-TensorRT lets us keep the unsupported parts in PyTorch.' },
      { en: 'strongly typed network', es: 'red con tipos estrictos', def: 'Modo de TensorRT (obligatorio desde la versión 11) en que la precisión de cada tensor la fija el grafo (tipos y nodos Q/DQ) en vez de que el builder la elija.', say: 'In TensorRT 11 networks are strongly typed, so we convert the ONNX to FP16 before building the engine.' },
      { en: 'post-training quantization (PTQ)', es: 'cuantización post-entrenamiento', def: 'Cuantizar un modelo ya entrenado usando datos de calibración para fijar las escalas, sin reentrenar. Rápida y barata; pierde más en modelos compactos y en el long tail.', say: 'I\'d start with post-training quantization and only move to QAT if a slice regresses.' },
      { en: 'quantization-aware training (QAT)', es: 'entrenamiento consciente de la cuantización', def: 'Entrenar o afinar el modelo con la cuantización simulada en el forward, para que aprenda a tolerar el redondeo. Recupera lo que PTQ pierde, a cambio de un pipeline de entrenamiento.', say: 'If post-training quantization hurts long-tail recall, quantization-aware training is how we would recover it.' },
      { en: 'INT8 calibration', es: 'calibración de INT8', def: 'Pasar datos representativos por el modelo para medir los rangos de activación y fijar las escalas de cuantización. Se hace con unos cientos a ≈ 1,000 ejemplos de la distribución de producción.', say: 'We calibrate INT8 on about a thousand production images, stratified by slice.' },
      { en: 'per-channel quantization', es: 'cuantización por canal', def: 'Una escala (y zero point) por canal de salida de una capa, en vez de una para todo el tensor. Es el estándar para pesos de convoluciones, cuyos canales tienen rangos muy distintos.', say: 'I\'d use per-channel scales for the weights, because convolution channels have very different ranges.' },
      { en: 'Q/DQ nodes', es: 'nodos de cuantización y descuantización', def: 'Pares QuantizeLinear/DequantizeLinear insertados en un grafo ONNX que marcan dónde y con qué escala cuantizar. Es el formato explícito que leen TensorRT y ONNX Runtime; TensorRT solo acepta zero point 0 (simétrica).', say: 'ModelOpt writes Q/DQ nodes into the ONNX, and TensorRT builds the INT8 engine from them.' },
      { en: 'dynamic quantization', es: 'cuantización dinámica', def: 'Pesos cuantizados de antemano y escalas de activación calculadas en cada inferencia, sin calibración. Útil en transformers y RNNs; en CNNs suele rendir menos que la estática.', say: 'For a CNN on CPU I\'d use static quantization; dynamic quantization barely helps convolutions at batch size one.' },
      { en: 'unstructured pruning', es: 'pruning no estructurado', def: 'Poner en cero pesos individuales (por magnitud). El modelo queda sparse, pero los kernels densos no se aceleran: rara vez baja la latencia.', say: 'Unstructured pruning makes the weights sparse, but with dense kernels the latency doesn\'t move.' },
      { en: 'structured pruning', es: 'pruning estructurado', def: 'Quitar canales, filtros o heads completos para obtener un modelo denso más angosto que corre más rápido en cualquier hardware. Necesita fine-tuning.', say: 'Structured pruning of thirty percent of the channels roughly halves the FLOPs, but it needs fine-tuning.' },
      { en: 'knowledge distillation', es: 'destilación de conocimiento', def: 'Entrenar un modelo chico (estudiante) para imitar las probabilidades de uno grande (maestro), además de las labels. La vía más confiable a un modelo más rápido para servir.', say: 'We could distill the ResNet-50 into a MobileNet-sized student and serve it on CPU.' },
      { en: 'OpenVINO', es: 'OpenVINO', def: 'Toolkit de Intel para inferencia en sus CPUs, GPUs y NPUs: lee ONNX, cuantiza con NNCF y existe como provider de ONNX Runtime y backend de Triton.', say: 'On an Intel fleet I\'d benchmark OpenVINO against ONNX Runtime with the same INT8 model.' },
      { en: 'intra-op threads', es: 'hilos dentro de cada operador', def: 'Hilos que un runtime usa para paralelizar una operación (una convolución). En contenedores hay que fijarlos al límite de CPU del pod, no a los cores del nodo.', say: 'We set intra-op threads to the pod\'s CPU limit to avoid oversubscription and throttling.' },
      { en: 'top-1 agreement', es: 'acuerdo top-1', def: 'Fracción de ejemplos en que el modelo optimizado y la referencia FP32 predicen la misma clase principal. Métrica central del parity test (c01: ≥ 99.5 %).', say: 'The gate requires at least 99.5 percent top-1 agreement between the FP16 engine and the PyTorch model.' },
      { en: 'NVIDIA Model Optimizer (ModelOpt)', es: 'NVIDIA Model Optimizer', def: 'Librería de NVIDIA para cuantizar (INT8, FP8, INT4), podar y destilar modelos para TensorRT, TensorRT-LLM y vLLM; incluye AutoCast para convertir un ONNX a FP16.', say: 'With TensorRT 11 we quantize with ModelOpt and build the engine from the Q/DQ model.' },
      { en: 'slice', es: 'segmento (de evaluación)', def: 'Subconjunto de datos que se evalúa por separado.', say: 'The INT8 model holds overall accuracy but regresses on the low-light slice.' },
      { en: 'parity test', es: 'prueba de paridad', def: 'Comparación del artefacto servido contra la referencia evaluada.', say: 'The parity test runs ten thousand golden images through both the engine and the PyTorch model.' },
      { en: "Amdahl's law", es: 'ley de Amdahl', def: 'Si una parte ocupa la fracción p del tiempo y la aceleras s veces, el total queda en (1 − p) + p/s: con el cómputo en 12.5 % del p50 y 2× más rápido, 0.94 (un 6 % menos).', say: "By Amdahl's law, making a model that's ten percent of the latency twice as fast saves about five percent." },
      { en: 'VNNI / AMX', es: 'instrucciones INT8 de CPUs x86', def: 'VNNI (desde Cascade Lake; c6i) hace productos punto INT8 en una instrucción; AMX (desde Sapphire Rapids; c7i) agrega unidades de matrices INT8/BF16. Sin ellas, INT8 en CPU puede ser más lento que FP32.', say: 'On x86, INT8 only pays off if the instance has VNNI or AMX, so I benchmark c6i against c7i with the same model.' },
      { en: 'long tail', es: 'cola larga (clases poco frecuentes)', def: 'Las muchas clases con pocos ejemplos cada una: pesan poco en el accuracy global y son lo primero que pierde una cuantización o un estudiante, así que se evalúan por separado.', say: 'If overall accuracy drops 0.3 points, I still check per-class recall on the long tail before shipping.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
