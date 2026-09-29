/* =============================================================================
   Ronda de Diseño ML — js/content/m10-mlops.js
   Módulo 10: MLOps. El camino de un modelo a producción, experiment tracking,
   model registry (aliases en vez de stages), reproducibilidad, CI/CD para modelos,
   el validation gate, pipelines de entrenamiento orquestados, políticas de
   reentrenamiento y niveles de madurez.
   Contrato: docs/SPEC.md §5. Los números de los casos son los de c01, c02 y c03
   (gate, cadencia mensual, disparadores, costos de entrenamiento y etiquetado):
   si cambian allá, se cambian aquí.
   Verificado (sept. 2026) contra la documentación oficial: MLflow 3.16 (stages
   deprecados desde 2.9, aún documentados; aliases y copy_model_version), W&B
   Registry (reemplazó al Model Registry legado), KFP 2.17 (caché activa por
   defecto), SageMaker Pipelines (caché opcional con vencimiento), Vertex AI
   Pipelines (caché activa por defecto, como KFP; su documentación aparece bajo
   Gemini Enterprise Agent Platform), Airflow 3 (versionado de DAGs, assets),
   niveles 0/1/2 de Google Cloud, nota de reproducibilidad de PyTorch 2.14. Las
   noticias de proveedores (Neptune, CoreWeave) quedan en una línea, no en tarjetas.
   Snippets: el de MLflow corrió con mlflow 3.16.1 y SQLite (incluida la prueba de
   que el commit se registra aunque el árbol tenga cambios sin commit); el de KFP
   compiló con kfp 2.17.0 (gate que lanza excepción, sin dsl.If); el de seeds y el test de comportamiento corrieron con
   torch 2.14 en CPU (el test, con un modelo de juguete). Los números del test
   pareado y de la cadencia salen de un script con scipy.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // El camino de un modelo. Columnas x = 2, 30, 60, 88 (w 18) con huecos de 10–12 para
  // las etiquetas. Carril offline arriba (y 0–31: fila principal y 5; debajo, el snapshot
  // bajo la validación y el tracking bajo el entrenamiento), release al medio (y 33–47),
  // abajo monitoreo (x 0–49) y producción (x 52–108). El reentrenamiento sube por x = 11
  // hasta el snapshot, y el snapshot sube a la validación, sin cruzar nodos.
  const CAMINO = {
    width: 108, height: 64,
    lanes: [
      { id: 'offline', label: 'Offline · datos, entrenamiento y validación', x: 0, y: 0, w: 108, h: 31, kind: 'offline' },
      { id: 'release', label: 'Release', x: 0, y: 33, w: 108, h: 14, kind: 'neutral' },
      { id: 'monitor', label: 'Monitoreo', x: 0, y: 49, w: 50, h: 15, kind: 'monitor' },
      { id: 'online', label: 'Producción', x: 52, y: 49, w: 56, h: 15, kind: 'online' },
    ],
    nodes: [
      { id: 'dval', label: 'Validar datos', sub: 'schema · volumen · M9', x: 2, y: 5, w: 18, h: 8, kind: 'job',
        note: 'Chequeos automáticos del snapshot antes de gastar GPU: schema, labels dentro de las 500 categorías, conteos por categoría y por fuente, sin duplicados con el golden set. Si falla un chequeo bloqueante, no se entrena y el champion sigue sirviendo. Detalle en <a href="#m09.validacion-datos">M9</a>.' },
      { id: 'snap', label: 'Snapshot de datos', sub: 'ds-2026-10-01 · inmutable', x: 2, y: 20, w: 18, h: 8, kind: 'store',
        note: 'Un id inmutable con su manifest (hash de cada imagen, label, fuente del label). Todo lo que viene después apunta a este id: si el snapshot se pudiera sobrescribir, ningún modelo sería reproducible. Cómo se construye y se valida es <a href="#m09.versionado">M9</a>.' },
      { id: 'train', label: 'Entrenamiento', sub: 'job GPU · imagen por digest', x: 30, y: 5, w: 18, h: 8, kind: 'job',
        note: 'Un job con la imagen de entrenamiento fijada por digest, el commit del código, la config y la seed. En c01: fine-tune desde el champion, unas horas de 1 GPU on-demand (' + E('≈ US$10–50') + ' al mes).' },
      { id: 'track', label: 'Tracking', sub: 'params · métricas · artefactos', x: 30, y: 20, w: 18, h: 8, kind: 'store',
        note: 'Cada corrida deja sus parámetros, sus métricas por época, sus artefactos y sus punteros (snapshot, commit, digest). Es la memoria del equipo: también de las corridas que fallaron el gate. MLflow en c01.' },
      { id: 'gate', label: 'Gate de validación', sub: 'challenger vs champion', x: 60, y: 5, w: 18, h: 8, kind: 'job',
        note: 'Criterios escritos y automáticos: métricas en el golden set contra el champion con un margen, slices, calibración, latencia. Si no pasa, el pipeline se detiene. Es la <a href="#m10.gate">sección 6</a>.' },
      { id: 'ci', label: 'CI del artefacto', sub: 'engine en T4 · parity · perf', x: 88, y: 5, w: 18, h: 8, kind: 'job',
        note: 'Lo que se sirve no es lo que se evaluó: export a ONNX, engine de TensorRT construido en el hardware de producción, parity test contra PyTorch y regresión de latencia. Ver <a href="#m10.ci-cd">sección 5</a>.' },
      { id: 'reg', label: 'Model registry', sub: 'vN · alias challenger', x: 88, y: 37, w: 18, h: 8, kind: 'store',
        note: 'La versión nueva queda registrada con sus artefactos y su linaje, y recibe el alias <code>challenger</code>. El alias <code>champion</code> sigue apuntando a lo que sirve producción hasta que termine el rollout.' },
      { id: 'deploy', label: 'Deploy seguro', sub: 'shadow → canary', x: 60, y: 37, w: 18, h: 8, kind: 'job',
        note: 'CD construye la imagen de serving con el modelo horneado y la lleva a producción por etapas: shadow, canary 5 → 25 → 100 % con rollback automático. Es <a href="#m11">M11</a>.' },
      { id: 'prod', label: 'Producción', sub: 'model_version en cada log', x: 60, y: 53, w: 18, h: 8, kind: 'service',
        note: 'El servicio responde con su <code>model_version</code> y loguea cada predicción. Al terminar el rollout, el alias <code>champion</code> se mueve a la versión nueva; la anterior queda lista para el rollback.' },
      { id: 'mon', label: 'Monitoreo', sub: 'drift · aceptación · SLO', x: 28, y: 53, w: 18, h: 8, kind: 'monitor',
        note: 'Métricas de sistema y de modelo, drift de entradas y de predicciones, labels demorados. Detecta que el modelo se degrada aunque nadie haya desplegado nada. Es <a href="#m12">M12</a>.' },
      { id: 'trig', label: 'Disparador', sub: 'calendario o métrica', x: 2, y: 53, w: 18, h: 8, kind: 'human',
        note: 'Calendario mensual o una señal (PSI sostenido, caída de aceptación, categoría nueva). Abre un ticket y arranca el pipeline; no promueve nada solo. Es la <a href="#m10.reentrenamiento">sección 8</a>.' },
    ],
    edges: [
      { from: 'snap', to: 'dval', kind: 'offline', fromSide: 't', toSide: 'b', label: 'manifest' },
      { from: 'dval', to: 'train', kind: 'offline', label: 'ds-id' },
      { from: 'train', to: 'track', kind: 'offline', fromSide: 'b', toSide: 't', label: 'métricas' },
      { from: 'train', to: 'gate', kind: 'offline', label: 'candidato' },
      { from: 'gate', to: 'ci', kind: 'offline', label: 'pasa' },
      { from: 'ci', to: 'reg', kind: 'offline', fromSide: 'b', toSide: 't', label: 'challenger' },
      { from: 'reg', to: 'deploy', kind: 'offline', label: 'vN' },
      { from: 'deploy', to: 'prod', kind: 'online', fromSide: 'b', toSide: 't', label: 'canary' },
      { from: 'prod', to: 'mon', kind: 'monitor', label: 'logs' },
      { from: 'mon', to: 'trig', kind: 'monitor', dashed: true },
      { from: 'trig', to: 'snap', kind: 'offline', fromSide: 't', toSide: 'b', label: 'reentrena' },
    ],
    flows: [
      { id: 'nuevo', label: 'Un modelo nuevo de c01 llega a producción', steps: [
        { nodes: ['snap', 'dval', 'train'], edges: ['snap>dval', 'dval>train'], text: 'Fin de mes: el snapshot <code>ds-2026-10-01</code> junta los ≈ 5k labels humanos del mes y los labels débiles filtrados. Pasa la validación de datos (si fallara, no se entrena y el champion sigue sirviendo) y el pipeline lanza el fine-tune con ese id como parámetro, no con "los datos más recientes".' },
        { nodes: ['train', 'track'], edges: ['train>track'], text: 'La corrida registra lr, épocas, seed, snapshot, commit y digest de la imagen, y la curva de <code>val_top1</code> por época. Si el resultado sorprende, cualquiera puede ver con qué se entrenó.' },
        { nodes: ['train', 'gate'], edges: ['train>gate'], text: 'El gate compara contra el champion en el golden set de 50k imágenes: top-1 no inferior (margen −0.3 pp, test pareado), recall de las 100 categorías grandes, ECE ≤ 0.05, slices móvil/web.' },
        { nodes: ['gate', 'ci'], edges: ['gate>ci'], text: 'Pasó. CI exporta a ONNX, construye el engine FP16 en un runner con T4 y la misma release de NGC que Triton, corre el parity test (top-1 agreement ≥ 99.5 %) y perf_analyzer (p99 ≤ champion + 10 %).' },
        { nodes: ['ci', 'reg'], edges: ['ci>reg'], text: 'La versión nueva entra al registry con engine, <code>labels.json</code> con su hash, métricas y linaje, y recibe el alias <code>challenger</code>.' },
        { nodes: ['reg', 'deploy', 'prod'], edges: ['reg>deploy', 'deploy>prod'], text: 'CD hornea el engine en una imagen nueva de Triton: shadow 1–2 días, canary 5 → 25 → 100 %. Al terminar, <code>champion</code> apunta a la versión nueva; la imagen anterior sigue en el registry de contenedores para el rollback.' },
      ] },
      { id: 'ciclo', label: 'El ciclo se cierra sin que nadie despliegue', steps: [
        { nodes: ['prod', 'mon'], edges: ['prod>mon'], text: 'Nadie tocó el código. Llega la temporada de regreso a clases y los vendedores suben mochilas y útiles: el mismo modelo ve otra distribución.' },
        { nodes: ['mon', 'trig'], edges: ['mon>trig'], text: 'El job diario ve PSI &gt; 0.2 sostenido 3 días en las categorías predichas. Abre un ticket, no un page: una persona revisa si el cambio es real.' },
        { nodes: ['trig', 'snap'], edges: ['trig>snap'], text: 'Es real. Se prioriza etiquetar lo nuevo y se adelanta el pipeline. El candidato pasa por el mismo gate y el mismo canary que cualquier otro: el disparador arranca el camino, no lo acorta.' },
      ] },
    ],
  };

  // Pipeline mensual de c01 como DAG (snapshot → validar → ...). Fila 1 (y 6) de izquierda a derecha, fila 2 (y 26)
  // de derecha a izquierda; la evaluación baja al gate por x = 89. Columnas x = 2, 28, 54, 80.
  const DAG = {
    width: 100, height: 38,
    lanes: [
      { id: 'dag', label: 'Pipeline mensual de c01 · cada caja es un contenedor', x: 0, y: 0, w: 100, h: 38, kind: 'offline' },
    ],
    nodes: [
      { id: 'val', label: 'Validar datos', sub: 'schema · conteos · M9', x: 28, y: 6, w: 18, h: 8, kind: 'job',
        note: 'Chequeos del snapshot recién armado, antes de gastar GPU: labels dentro de las 500 categorías, sin duplicados entre train y golden set (por hash), conteos por categoría y por fuente dentro de rangos. Detalle en <a href="#m09.validacion-datos">M9</a>.' },
      { id: 'snap', label: 'Snapshot', sub: 'manifest por id', x: 2, y: 6, w: 18, h: 8, kind: 'store',
        note: 'Arma el manifest del id que recibió como parámetro (<a href="#m09.versionado">M9</a>). Como el id es una entrada, la caché del orquestador solo reutiliza el paso si el id es el mismo.' },
      { id: 'train', label: 'Fine-tune', sub: '1 GPU · checkpoint 15 min', x: 54, y: 6, w: 18, h: 8, kind: 'gpu',
        note: 'El único paso caro. Guarda un checkpoint cada 15 minutos (pesos + optimizador ≈ 307 MB para ResNet-50 con Adam) y, si se reintenta, reanuda desde el último en vez de empezar de cero.' },
      { id: 'eval', label: 'Evaluar', sub: 'golden set · slices', x: 80, y: 6, w: 18, h: 8, kind: 'gpu',
        note: 'Corre el candidato y el champion <b>v14, recibido como parámetro</b>, sobre el mismo golden set y guarda predicciones por imagen: el gate necesita los pares para el test pareado, no solo dos promedios. Si leyera <code>@champion</code> por su cuenta, la caché no vería que el champion cambió.' },
      { id: 'gate', label: 'Gate', sub: 'vs champion', x: 80, y: 26, w: 18, h: 8, kind: 'job',
        note: 'Aplica los criterios escritos a los pares. Si no pasa, deja el motivo en el tracking y lanza una excepción: la corrida termina en rojo y la alerta de "pipeline fallido" avisa. Un gate que solo devuelve <code>false</code> deja la corrida en verde con el resto saltado, y nadie se entera.' },
      { id: 'engine', label: 'Build engine', sub: 'trtexec en una T4', x: 54, y: 26, w: 18, h: 8, kind: 'gpu',
        note: 'ONNX opset 17 con batch dinámico 1–32 y <code>trtexec --fp16</code> en un runner con T4 y la misma release de NGC que Triton. El engine no es portable entre GPUs ni entre versiones de TensorRT (<a href="#m08.tensorrt">M8</a>).' },
      { id: 'par', label: 'Parity + perf', sub: '≥ 99.5 % · p99', x: 28, y: 26, w: 18, h: 8, kind: 'job',
        note: '<code>parity_check.py</code> contra PyTorch FP32 (top-1 agreement ≥ 99.5 %) y perf_analyzer a tasa fija (p99 ≤ champion + 10 %). Ver <a href="#c01.evaluacion">evaluación de c01</a>.' },
      { id: 'reg', label: 'Registrar', sub: 'alias challenger', x: 2, y: 26, w: 18, h: 8, kind: 'store',
        note: 'Crea la versión en el registry con todos sus artefactos y punteros y le pone el alias <code>challenger</code>. Desde aquí sigue CD (<a href="#m11">M11</a>).' },
    ],
    edges: [
      { from: 'snap', to: 'val', kind: 'offline' },
      { from: 'val', to: 'train', kind: 'offline' },
      { from: 'train', to: 'eval', kind: 'offline' },
      { from: 'eval', to: 'gate', kind: 'offline', fromSide: 'b', toSide: 't', label: 'pares' },
      { from: 'gate', to: 'engine', kind: 'offline', label: 'pasa' },
      { from: 'engine', to: 'par', kind: 'offline' },
      { from: 'par', to: 'reg', kind: 'offline' },
    ],
    flows: [
      { id: 'normal', label: 'La corrida del mes', steps: [
        { nodes: ['snap', 'val'], edges: ['snap>val'], text: 'El scheduler resuelve <code>@champion</code> una vez y dispara el pipeline con <code>dataset_id=ds-2026-10-01</code> y <code>champion_version=14</code>. Se arma el snapshot y la validación de datos pasa.' },
        { nodes: ['train', 'eval'], edges: ['val>train', 'train>eval'], text: 'Fine-tune de ' + E('≈ 3–4 h') + ' en una GPU; después, evaluación del candidato y del champion sobre el golden set.' },
        { nodes: ['gate', 'engine', 'par', 'reg'], edges: ['eval>gate', 'gate>engine', 'engine>par', 'par>reg'], text: 'Gate verde, engine construido en la T4, parity y perf verdes: la versión queda como <code>challenger</code>. Todo el recorrido quedó en el historial del orquestador, con los artefactos de cada paso.' },
      ] },
      { id: 'reintento', label: 'Se pierde el nodo GPU a la hora 2', steps: [
        { nodes: ['train'], edges: [], text: 'El nodo desaparece (una instancia spot recuperada o una falla de hardware). El paso falla; los anteriores ya terminaron y sus salidas están guardadas.' },
        { nodes: ['train'], edges: [], text: 'El orquestador reintenta solo ese paso (hasta 3 veces, con espera). El paso nuevo encuentra el checkpoint de hace menos de 15 minutos y reanuda: se pierden minutos, no la corrida.' },
        { nodes: ['eval', 'gate'], edges: ['train>eval', 'eval>gate'], text: 'El resto sigue como si nada. Sin orquestador, alguien habría visto el error por la mañana y relanzado todo desde la validación.' },
      ] },
      { id: 'cache', label: 'Arreglas un bug del parity test', steps: [
        { nodes: ['par'], edges: [], text: 'El parity test falló por un bug del script (no del modelo). Lo arreglas y vuelves a correr el pipeline con los mismos parámetros.' },
        { nodes: ['snap', 'val', 'train', 'eval'], edges: [], text: 'Caché: snapshot, validación, fine-tune y evaluación tienen las mismas entradas (incluida la versión del champion) y la misma definición, así que el orquestador reutiliza sus salidas. No pagas otras 4 horas de GPU. Si el champion hubiera cambiado desde la corrida anterior, la evaluación y el gate se recalcularían solos.' },
        { nodes: ['gate', 'engine', 'par', 'reg'], edges: ['gate>engine', 'engine>par', 'par>reg'], text: 'El gate y el build del engine también salen de caché: mismas entradas. Corren el parity corregido (cambió su definición) y el registro que depende de él.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  // Corrió con mlflow 3.16.1 y MLFLOW_TRACKING_URI=sqlite:///mlflow.db dentro de un repo git.
  const TRACK = `import mlflow

mlflow.set_experiment("c01-classifier")
with mlflow.start_run(run_name="ft-2026-10") as run:
    mlflow.log_params({"lr": 3e-4, "epochs": 8, "seed": 17,
                       "dataset": "ds-2026-10-01"})          # el id del snapshot, no una ruta "latest"
    mlflow.set_tags({"image_digest": "sha256:9f2c…",         # entorno exacto del entrenamiento
                     "preprocess": "1.4.0"})                 # la misma versión que usa el gateway
    for epoch, top1 in enumerate(val_top1_per_epoch):
        mlflow.log_metric("val_top1", top1, step=epoch)      # la curva, no solo el número final
    mlflow.log_artifact("labels.json", artifact_path="model")  # el orden de los 500 labels es parte del modelo
# El commit lo agrega MLflow solo (tag mlflow.source.git.commit) si corres desde un repo git`;

  // Misma corrida: registro, tag del gate y alias. Probado: get_model_version_by_alias devuelve la versión.
  const REGISTRY = `from mlflow import MlflowClient

client = MlflowClient()
# client.create_registered_model("classifier")              # una sola vez, al crear el problema
mv = client.create_model_version("classifier", source=f"{run.info.artifact_uri}/model",
                                 run_id=run.info.run_id)     # la versión apunta a su corrida: linaje
client.set_model_version_tag("classifier", mv.version, "gate", "passed")
client.set_registered_model_alias("classifier", "challenger", mv.version)

# CD resuelve el alias UNA vez, al construir la imagen del canary; los pods no leen el alias al arrancar
v = client.get_model_version_by_alias("classifier", "challenger").version   # → "15": tag de la imagen

# Al terminar el canary (lo hace CD, no una persona con la consola):
client.set_registered_model_alias("classifier", "champion", mv.version)`;

  // Corrió con torch 2.14 en CPU: dos DataLoaders con la misma seed dan los mismos batches.
  const SEEDS = `import os, random
import numpy as np
import torch
from torch.utils.data import DataLoader

def seed_everything(seed: int, deterministic: bool = False) -> torch.Generator:
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed)   # CPU y todas las GPUs
    if deterministic:          # para depurar una diferencia, no siempre: puede ser más lento
        os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"  # antes del primer uso de cuBLAS
        torch.use_deterministic_algorithms(True)          # error si una op no tiene versión determinista
        torch.backends.cudnn.benchmark = False            # no elegir otro algoritmo en cada corrida
    g = torch.Generator()
    g.manual_seed(seed)
    return g

def seed_worker(worker_id: int):          # cada worker del DataLoader deriva su propia seed
    s = torch.initial_seed() % 2**32
    np.random.seed(s); random.seed(s)     # augmentations con numpy/random también quedan fijas

g = seed_everything(17)
loader = DataLoader(train_ds, batch_size=64, shuffle=True, num_workers=8,
                    worker_init_fn=seed_worker, generator=g)   # mismo orden y mismas augmentations`;

  // Corrió con pytest 9.1 y un modelo de juguete en el conftest; en c01, el fixture
  // `predict` llama al engine candidato y `sample_images` son 2,000 imágenes del golden set.
  const BEHAVIOR = `import io
import pytest
from PIL import Image, ImageOps

def recompress(jpeg: bytes, quality: int = 70) -> bytes:
    buf = io.BytesIO()
    Image.open(io.BytesIO(jpeg)).convert("RGB").save(buf, "JPEG", quality=quality)
    return buf.getvalue()

def mirror(jpeg: bytes) -> bytes:
    buf = io.BytesIO()
    ImageOps.mirror(Image.open(io.BytesIO(jpeg)).convert("RGB")).save(buf, "JPEG", quality=95)
    return buf.getvalue()

@pytest.mark.parametrize("transform", [recompress, mirror])
def test_invariance_top1(predict, sample_images, transform):
    # INV: recomprimir o reflejar una foto no cambia la categoría del producto
    same = sum(predict(b)[0] == predict(transform(b))[0] for b in sample_images)
    assert same / len(sample_images) >= 0.97        # umbral agregado, nunca por imagen

def test_minimum_functionality(predict, canonical_cases):
    # MFT: fotos canónicas revisadas a mano; la correcta tiene que estar en el top-5
    misses = [c.case_id for c in canonical_cases if c.label not in predict(c.jpeg)]
    assert not misses, f"fuera del top-5: {misses}"`;

  // Compiló con kfp 2.17.0 (Compiler().compile → YAML). Los cuerpos de los componentes se omiten.
  const KFP = `from kfp import compiler, dsl

IMG = "registry.example.com/c01-train@sha256:9f2c…"   # la misma imagen, por digest, en cada paso

@dsl.component(base_image=IMG)
def snapshot(dataset_id: str, manifest: dsl.Output[dsl.Dataset]): ...

@dsl.component(base_image=IMG)
def finetune(manifest: dsl.Input[dsl.Dataset], seed: int, ckpt_uri: str,
             model: dsl.Output[dsl.Model]): ...       # reanuda desde ckpt_uri si hay checkpoint

@dsl.component(base_image=IMG)
def gate(model: dsl.Input[dsl.Model], golden_set: str,
         champion_version: str): ...      # lanza una excepción si no pasa: la corrida queda en rojo

@dsl.component(base_image=IMG)
def build_and_register(model: dsl.Input[dsl.Model]): ...   # engine en T4, parity, registry

@dsl.pipeline(name="c01-monthly")
def c01_monthly(dataset_id: str, champion_version: str,   # el scheduler resuelve @champion una vez
                seed: int = 17, golden_set: str = "golden-v3"):
    snap = snapshot(dataset_id=dataset_id)   # el id es una entrada: la caché no puede confundir meses
    ft = finetune(manifest=snap.outputs["manifest"], seed=seed,
                  ckpt_uri=f"s3://ml-ckpt/c01/{dataset_id}/")
    ft.set_accelerator_type("nvidia.com/gpu").set_accelerator_limit(1)
    ft.set_retry(num_retries=3, backoff_duration="120s")   # un nodo perdido no tira la corrida
    ok = gate(model=ft.outputs["model"], golden_set=golden_set,
              champion_version=champion_version)   # si el champion cambió, la caché no reusa el veredicto
    build_and_register(model=ft.outputs["model"]).after(ok)   # solo corre si el gate no falló

compiler.Compiler().compile(c01_monthly, "c01_monthly.yaml")`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm10',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'que-es-mlops',
        title: 'Qué es MLOps: el camino de un modelo a producción',
        titleEn: 'What MLOps is: a model\'s path to production',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `En la entrevista llega así: "ok, ya tienes un modelo mejor. ¿Cómo llega a producción?". La respuesta junior es "lo entreno, subo los pesos a S3 y reinicio el servicio". Funciona una vez. El entrevistador busca otra cosa: un <b>camino</b> por el que cualquier modelo (este y el del mes que viene) pasa con los mismos controles, donde cada paso deja registro y ninguno depende de que alguien se acuerde de hacerlo.` },
          { t: 'p', html: `Eso es MLOps: las prácticas y herramientas que hacen que entrenar, validar, desplegar, monitorear y reentrenar sea <b>repetible, auditable y seguro</b>. No es una herramienta ni un puesto. Si tu notebook de ResNet produce un buen modelo, MLOps es todo lo que hace falta para que el siguiente modelo, entrenado por otra persona en seis meses, llegue igual de bien y se pueda deshacer en minutos si sale mal.` },
          { t: 'h3', text: 'Qué hereda de DevOps y qué es propio de ML' },
          { t: 'table', caption: 'DevOps vs MLOps: lo que cambia cuando el artefacto aprende de datos', head: ['Aspecto', 'Software (DevOps)', 'ML (lo que se agrega)'], rows: [
            ['Qué cambia el comportamiento', 'El código', 'El código, <b>los datos y el modelo</b>. Un modelo entrenado con el mes nuevo se comporta distinto con el mismo commit'],
            ['Qué se versiona', 'Código, config, imagen', 'Además: snapshot de datos, pesos, preprocesamiento, métricas y el linaje que los une'],
            ['Cómo falla', 'Excepciones, 5xx, latencia', 'También en silencio: 200 OK, rápido y equivocado. Solo lo ven las métricas de modelo (<a href="#m12">M12</a>)'],
            ['Tests', 'Unitarios, integración, e2e', 'Además: tests de datos, tests de modelo con umbrales estadísticos, parity entre el modelo evaluado y el servido'],
            ['Qué dispara un release', 'Un commit', 'Un commit, <b>datos nuevos</b> o una métrica que se degrada: continuous training (CT)'],
            ['El artefacto', 'Binario o imagen', 'Imagen + modelo; a veces un engine atado a una GPU y a una versión de TensorRT (<a href="#m08.tensorrt">M8</a>)'],
            ['Rollback', 'Volver a la versión anterior', 'Igual, pero la versión anterior tiene que seguir siendo compatible con el contrato y con las features de hoy (<a href="#m11.compatibilidad">M11</a>)'],
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué no basta con el CI/CD que ya tiene la empresa', html: `<p>El CI/CD de software asume que si el código no cambió, el sistema no cambió. En ML eso es falso en las dos direcciones. <b>Sin tocar el código</b>, el modelo se degrada: en c01 llega la temporada de regreso a clases, en c02 cambia la luz del atardecer, en c03 se ensucia un lente. Y <b>sin tocar el código</b>, un reentrenamiento cambia el comportamiento: el mismo <code>train.py</code> con el snapshot de octubre produce otro modelo que puede romper una categoría. Sculley et al. (<i>Hidden Technical Debt in Machine Learning Systems</i>, NeurIPS 2015) lo resumen en una figura: el código del modelo es una caja chica rodeada de datos, configuración, monitoreo y serving.</p>` },
          { t: 'diagram', id: 'camino-a-produccion', title: 'El camino de un modelo a producción (c01)', caption: 'Arriba, lo que pasa offline hasta tener un candidato validado; al medio, el release; abajo, producción y monitoreo, que cierran el ciclo. Toca cada caja y recorre los dos flujos.', spec: CAMINO },
          { t: 'table', caption: 'Cada flecha: quién la dispara y qué deja registrado', head: ['Paso', 'Lo dispara', 'Deja registrado', 'Dónde se ve'], rows: [
            ['Snapshot', 'El pipeline, con un id como parámetro', 'Manifest inmutable', '<a href="#m09.versionado">M9</a>'],
            ['Validación de datos', 'Automática al armar el snapshot', 'Reporte de chequeos; si falla, no se entrena', '<a href="#m09.validacion-datos">M9</a>'],
            ['Entrenamiento', 'El pipeline (calendario o disparador)', 'Corrida: params, métricas, commit, digest, snapshot', '<a href="#m10.experiment-tracking">sección 2</a>'],
            ['Gate', 'Automático al terminar la evaluación', 'Veredicto y métricas contra el champion', '<a href="#m10.gate">sección 6</a>'],
            ['CI del artefacto', 'Automático si el gate pasa', 'Engine, parity, latencia', '<a href="#m10.ci-cd">sección 5</a>'],
            ['Registro', 'Automático', 'Versión, alias challenger, linaje', '<a href="#m10.model-registry">sección 3</a>'],
            ['Deploy', 'CD, con aprobación humana si el equipo la exige', 'Etapas del rollout, métricas de cada etapa', '<a href="#m11">M11</a>'],
            ['Promoción', 'CD al terminar el canary', 'Movimiento del alias champion: quién, cuándo, por qué', '<a href="#m10.model-registry">sección 3</a>'],
            ['Reentrenar', 'Calendario o una señal de monitoreo', 'Ticket con el motivo', '<a href="#m10.reentrenamiento">sección 8</a>'],
          ] },
          { t: 'callout', kind: 'trap', title: 'MLOps = comprar una plataforma', html: `<p>"Usaría Kubeflow para MLOps" no responde nada: nombra una herramienta sin decir qué problema resuelve. El entrevistador anota el camino (snapshot, validación de datos, tracking, gate, registry, deploy seguro, monitoreo, disparadores) y quién decide en cada paso. Las herramientas vienen después y se justifican por el tamaño del equipo (<a href="#m10.madurez">sección 9</a>). Un CronJob que corre un script por etapas con un gate escrito le gana a un Kubeflow sin gate.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Every model goes through the same path: a training job on an immutable data snapshot that has passed data validation, tracked with its params, commit and image digest; an evaluation gate against the current champion on a frozen golden set; the serving artifact built and parity-tested in CI; then it's registered as the challenger and rolled out through shadow and canary. Monitoring closes the loop, and a drift signal restarts the pipeline, not the deploy."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El ciclo de vida completo ya apareció en <a href="#m01.ciclo-de-vida">M1</a>. Este módulo cubre lo que está entre "tengo datos" y "está en producción": los datos mismos son <a href="#m09">M9</a>, el rollout seguro es <a href="#m11">M11</a> y el monitoreo que dispara el reentrenamiento es <a href="#m12">M12</a>. La imagen inmutable que viaja por el camino es <a href="#m05">M5</a>.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'experiment-tracking',
        title: 'Experiment tracking: qué registrar y con qué',
        titleEn: 'Experiment tracking: what to log and with what',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Tu experiencia con notebooks: 30 variantes entrenadas, y la mejor se llama <code>resnet_final_v3_bueno.pt</code>. Tres semanas después alguien pregunta con qué learning rate, con qué split y con qué versión del preprocesamiento. Nadie sabe. Experiment tracking es registrar cada corrida de forma automática, en un lugar compartido, para que esa pregunta tenga respuesta en un clic.` },
          { t: 'table', caption: 'Qué registrar en cada corrida', head: ['Qué', 'Ejemplo en c01', 'Por qué'], rows: [
            ['Parámetros', 'lr 3e-4, 8 épocas, batch 64, augmentations, seed 17', 'Sin ellos no puedes repetir ni comparar'],
            ['Métricas por época y finales', '<code>val_top1</code> por época; top-1/top-5, recall por clase y ECE finales', 'La curva muestra overfitting o un lr roto; el número final solo, no'],
            ['Artefactos', 'Checkpoint, ONNX, <code>labels.json</code>, matriz de confusión, reporte por slice', 'Lo que se registra en el registry sale de aquí'],
            ['Versión de datos', '<code>ds-2026-10-01</code> y el hash del manifest', '"¿Con qué datos?" es la primera pregunta de cualquier incidente'],
            ['Código', 'Commit (y si el árbol estaba limpio)', 'El mismo nombre de script cambia de un día a otro'],
            ['Entorno', 'Digest de la imagen, versiones de torch/CUDA/cuDNN, tipo de GPU', 'Dos entornos distintos dan números distintos (<a href="#m10.reproducibilidad">sección 4</a>)'],
            ['Contexto', 'Dueño, objetivo, ticket, versión del golden set', 'Dentro de un año, "ft-2026-10" no le dice nada a nadie'],
          ] },
          { t: 'code', title: 'Lo mínimo con MLflow', caption: 'Corrió con MLflow 3.16.1 y SQLite como backend, dentro de un repo git. <code>val_top1_per_epoch</code> sale de tu loop de entrenamiento.', files: [
            { name: 'train.py (fragmento)', lang: 'python', code: TRACK },
          ] },
          { t: 'callout', kind: 'trap', title: 'El commit no dice si había cambios sin commit', html: `<p>MLflow guarda <code>mlflow.source.git.commit</code> solo, y eso da una falsa tranquilidad. Lo probamos: con el script modificado y sin commit, la corrida registró el mismo commit que la anterior y ningún tag que avise del cambio. El código que produjo ese modelo no existe en git. La solución es de proceso: los modelos candidatos se entrenan desde el pipeline, que parte de un commit limpio (o falla si <code>git status --porcelain</code> no está vacío). Las corridas desde laptops sirven para explorar, nunca para producción.</p>` },
          { t: 'callout', kind: 'trap', title: 'El notebook que nadie registró', html: `<p>El caso clásico: el mejor modelo salió de un notebook con celdas ejecutadas fuera de orden, un <code>df = df[df.label != 17]</code> olvidado en la celda 40 y datos leídos de una carpeta local. Se ve mejor en el golden set y nadie puede reproducirlo. Regla: el notebook explora; lo que va a producción sale de un script versionado corrido por el pipeline, con tracking desde la primera línea.</p>` },
          { t: 'h3', text: 'MLflow, Weights & Biases y el resto' },
          { t: 'table', caption: 'Cuándo cada uno (verifica precios y condiciones: cambian)', head: ['', 'MLflow', 'Weights & Biases', 'MLflow administrado en tu nube', 'Carpeta en S3 + tabla'], rows: [
            ['Qué es', 'Open source (Apache 2.0): tracking, registry, formato de modelo, evaluación', 'SaaS comercial (también hay opción dedicada o self-managed)', 'El mismo MLflow operado por Databricks, SageMaker AI o Azure ML (su workspace habla la API de MLflow)', 'Un JSON por corrida y artefactos en un prefijo'],
            ['Fuerte en', 'Registry con aliases, integración con el resto de tu stack, sin licencias', 'Interfaz, comparación de corridas, dashboards y reportes para el equipo, sweeps', 'No operar el servidor; IAM y red de tu nube', 'Cero dependencias'],
            ['Registry', 'Model Registry con aliases y tags', 'W&B Registry con aliases (reemplazó al Model Registry legado)', 'El de MLflow, o el registry propio de la nube', 'Tú lo construyes'],
            ['Quién lo opera', 'Tú: servidor, base de datos (Postgres) y artifact store (S3)', 'El proveedor', 'La nube', 'Tú, y casi no hay nada que operar'],
            ['Cuándo', 'Default razonable si nadie eligió todavía, o si los datos no pueden salir de tu nube', 'Investigación con muchos experimentos y un equipo que vive en la interfaz', 'Ya estás en esa nube y no quieres operar otro servicio', 'Un modelo, una persona, las primeras semanas'],
          ], note: 'Hay más (Comet, ClearML, Aim y los de cada nube). En la entrevista no se evalúa cuál conoces, sino que sepas qué registrar y por qué.' },
          { t: 'p', html: `Trata el tracking como datos tuyos: exporta métricas finales, punteros y artefactos de lo que llegó a producción; un SaaS puede cambiar de dueño o cerrar (le pasó a Neptune.ai en 2026).` },
          { t: 'callout', kind: 'skip', html: `<p>No memorices APIs de W&B ni los parámetros de <code>mlflow.autolog()</code>. En la entrevista basta con la tabla de qué registrar, la trampa del notebook y una frase sobre dónde vive (MLflow con Postgres y S3, o el administrado de tu nube). Tampoco las noticias de proveedores (a sept. de 2026: W&B es de CoreWeave desde 2025 y la documentación de Vertex AI aparece bajo Gemini Enterprise Agent Platform): no se preguntan.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Every training run logs its params, per-epoch metrics, artifacts, the dataset snapshot id, the git commit and the image digest. Candidates only come from the pipeline, starting from a clean commit, so any model in production can be traced back to exactly what produced it."</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'model-registry',
        title: 'Model registry: versiones, aliases y linaje',
        titleEn: 'Model registry: versions, aliases and lineage',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Un bucket con pesos no es un registry. Un registry responde tres preguntas sin buscar en Slack: <b>¿qué versión sirve producción ahora?</b>, <b>¿de dónde salió?</b> y <b>¿a cuál vuelvo si falla?</b>. Para eso tiene cuatro piezas.` },
          { t: 'kv', items: [
            ['Registered model', 'classifier', 'Un nombre por problema, no por experimento.'],
            ['Versión', 'v15 (inmutable)', 'Artefactos + corrida que la produjo. Nunca se edita: un cambio es otra versión.'],
            ['Alias', 'champion → v14 · challenger → v15', 'Puntero con nombre que se mueve. Promover o volver atrás es mover un alias.'],
            ['Tags', 'gate=passed · approved_by=…', 'Estado y metadata de cada versión: resultado del gate, quién aprobó, ticket.'],
          ] },
          { t: 'h3', text: 'Stages vs aliases: el cambio que conviene conocer' },
          { t: 'p', html: `Mucha gente (y muchos tutoriales) todavía habla de mover un modelo de <i>Staging</i> a <i>Production</i>. En MLflow eso eran los <b>stages</b>: un estado fijo por versión. Están <b>deprecados desde MLflow 2.9</b>, y en la 3.x siguen documentados como deprecados, con la eliminación anunciada para una versión mayor futura. Los reemplazan los <b>aliases</b> (nombres libres, como <code>champion</code> y <code>challenger</code>) y los <b>tags</b> (para estados como el resultado del gate). Para separar entornos, la documentación propone un registered model por entorno y copiar la versión validada con <code>copy_model_version</code>.` },
          { t: 'table', caption: 'Por qué aliases', head: ['', 'Stages (deprecados)', 'Aliases + tags'], rows: [
            ['Vocabulario', 'Fijo: None, Staging, Production, Archived', 'El tuyo: champion, challenger, shadow, rollback'],
            ['Dos candidatos a la vez', 'Incómodo: los dos quedan en "Staging"', 'challenger y challenger-b, cada uno con su puntero'],
            ['Cargar desde código', '<code>models:/classifier/Production</code>', '<code>models:/classifier@champion</code>'],
            ['Estado del gate o de la aprobación', 'Mezclado con el stage', 'Tags separados: gate=passed, approved_by'],
          ] },
          { t: 'callout', kind: 'interview', html: `<p>Si el entrevistador dice "you promote it to Production", no lo corrijas: responde en su idioma y muestra que sabes el mecanismo. "Right, promotion is just moving the champion alias to the new version once the canary passes, and rollback is moving it back."</p>` },
          { t: 'code', title: 'Registro, gate y promoción con aliases', caption: 'Continúa el fragmento de la sección anterior. Corrió con MLflow 3.16.1: el alias devuelve la versión registrada.', files: [
            { name: 'register.py', lang: 'python', code: REGISTRY },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los pods de serving leen @champion al arrancar', html: `<p>Parece elegante: el servicio carga <code>models:/classifier@champion</code> en cada arranque y promover es solo mover el alias. El problema: durante un scale-up, un reinicio o un rollout, los pods nuevos cargan otra versión que los viejos. Tienes dos modelos detrás del mismo servicio sin haber desplegado nada, sin canary y con un <code>model_version</code> en los logs que depende de cuándo arrancó cada pod. En c01 el modelo va <b>horneado en la imagen</b> (<a href="#m05.pesos-modelo">M5</a>): CD resuelve el alias <code>challenger</code> (o la versión explícita) una vez, al construir la imagen del canary, y el tag de la imagen es la versión; <code>champion</code> se mueve al terminar el rollout. El alias describe producción; no la controla a escondidas.</p>` },
          { t: 'h3', text: 'Qué hay dentro de una versión de c01' },
          { t: 'list', items: [
            '<b>ONNX</b> y el <b>engine</b> de TensorRT, con la GPU (T4, sm_75) y la release de NGC para la que se construyó escritas como tags: el engine solo corre ahí.',
            '<code>labels.json</code> <b>con su hash</b>: el orden de los 500 labels es parte del modelo. Si cambia sin que cambie el modelo, las predicciones salen con nombres equivocados y ningún test de servicio lo nota.',
            '<b>Versión del preprocesamiento</b> (el paquete que comparten entrenamiento y gateway) y la <b>firma</b> de entrada y salida (<code>input</code> FP32 [3, 224, 224], <code>logits</code> FP32 [500]).',
            '<b>Métricas del gate</b> y del parity test, y la <b>corrida</b> que la produjo: snapshot, commit, digest de la imagen de entrenamiento.',
          ] },
          { t: 'h3', text: 'Linaje: la pregunta que siempre llega' },
          { t: 'p', html: `"Un usuario pidió borrar sus fotos: ¿en qué modelos están?" o "este modelo empezó a fallar en celulares: ¿qué cambió respecto al anterior?". Con linaje, la respuesta es mecánica: versión → corrida → snapshot → manifest (hash de cada imagen) y, del otro lado, commit y digest. Sin linaje, es una semana de arqueología. Por eso cada versión guarda <b>punteros</b>, no copias: el snapshot vive en su almacenamiento inmutable (<a href="#m09.versionado">M9</a>) y la imagen en el registry de contenedores (<a href="#m05.registries">M5</a>).` },
          { t: 'table', caption: 'El mismo concepto en cada plataforma', head: ['Plataforma', 'Cómo marca lo que sirve producción', 'Detalle que conviene saber'], rows: [
            ['MLflow', 'Alias (<code>@champion</code>) + tags', 'Stages deprecados desde 2.9; un registered model por entorno + <code>copy_model_version</code> para promover entre entornos'],
            ['W&B Registry', 'Aliases sobre versiones de un artefacto', 'Reemplazó al Model Registry legado (que quedó de solo lectura tras la migración); tiene aliases protegidos'],
            ['SageMaker Model Registry', 'Model package group con versiones y un estado de aprobación: <code>PendingManualApproval</code>, <code>Approved</code>, <code>Rejected</code>', 'La aprobación es explícita y queda registrada; el pipeline de despliegue puede reaccionar al cambio de estado'],
            ['Vertex AI Model Registry', 'Aliases de versión; exactamente una versión lleva siempre el alias <code>default</code>', 'Si referencias el modelo sin versión, se usa la que lleva <code>default</code>'],
          ] },
          { t: 'h3', text: 'Model card: el registro para humanos' },
          { t: 'p', html: `Una <b>model card</b> (Mitchell et al., <i>Model Cards for Model Reporting</i>, FAT* 2019) es un documento corto por versión: para qué sirve, para qué <b>no</b>, con qué datos se entrenó, métricas por slice, limitaciones conocidas y dueño. En c01, una línea importante: "sugiere categorías; no está validado para moderar publicaciones sin revisión humana". Es lo que evita que otro equipo use tu modelo para algo que nunca evaluaste. El gate puede exigir que exista antes de registrar.` },
          { t: 'callout', kind: 'senior', html: `<p>El registry es también un <b>log de auditoría</b>: quién movió el alias <code>champion</code>, cuándo y con qué justificación. Con permisos: el pipeline de CD puede mover <code>champion</code>; una persona, solo con aprobación registrada. En c03, donde un escape le cuesta miles de dólares a la armadora, "¿qué modelo decidía en la línea 2 el martes a las 14:00?" tiene que responderse en minutos (<a href="#c03.datos">trazabilidad de c03</a>).</p>` },
          { t: 'callout', kind: 'connect', html: `<p>En c01 (<a href="#c01.datos">datos de c01</a>) el registry es MLflow con aliases champion/challenger, y el artefacto registrado incluye engine, labels con su hash, preprocesamiento, métricas, snapshot y commit. En c02, lo que <b>no</b> va en el modelo (polígonos de zona, horarios) tiene su propio repo versionado (<a href="#c02.datos">datos de c02</a>).</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'reproducibilidad',
        title: 'Reproducibilidad: los cinco ingredientes',
        titleEn: 'Reproducibility: the five ingredients',
        priority: 'core',
        dims: ['arquitectura'],
        blocks: [
          { t: 'p', html: `Entrenas dos veces con la misma config y el golden set dice 85.3 % y 85.1 % de top-1. ¿El segundo modelo es peor, o es ruido? Si no puedes reproducir un entrenamiento, no puedes responder eso, ni depurar una regresión, ni saber si una mejora de 0.2 pp es real. Reproducir exige fijar cinco cosas; si falta una, el resto no sirve.` },
          { t: 'table', caption: 'Los cinco ingredientes', head: ['Ingrediente', 'Qué fijas', 'Cómo, en c01', 'Si falta'], rows: [
            ['Código', 'Commit exacto, árbol limpio', 'El pipeline parte de un commit; MLflow lo registra', 'El script "de siempre" ya no es el mismo'],
            ['Datos', 'Snapshot inmutable con id', '<code>ds-2026-10-01</code> + manifest (<a href="#m09.versionado">M9</a>)', 'Alguien agregó 3,000 imágenes a la carpeta y nadie lo sabe'],
            ['Config', 'Hiperparámetros y parámetros del preprocesamiento en un archivo versionado', 'YAML en el repo + params en el tracking', 'Un valor por defecto cambió entre versiones de una librería'],
            ['Entorno', 'Imagen por digest: Python, torch, CUDA, cuDNN, Pillow; tipo de GPU', 'Imagen de entrenamiento por digest (<a href="#m05.dockerfile-ml">M5</a>); tipo de GPU como tag', 'Otra versión de Pillow redimensiona distinto: skew silencioso'],
            ['Aleatoriedad', 'Seeds de Python, NumPy y torch; seed por worker del DataLoader', 'Snippet de abajo', 'Otro orden de batches, otras augmentations, otro modelo'],
          ] },
          { t: 'code', title: 'Seeds y determinismo en PyTorch', caption: 'Corrió con torch 2.14 en CPU: dos DataLoaders con la misma seed y 2 workers producen los mismos batches. <code>train_ds</code> es tu dataset.', files: [
            { name: 'seeds.py', lang: 'python', code: SEEDS },
          ] },
          { t: 'h3', text: 'Por qué en GPU "misma seed" no alcanza' },
          { t: 'list', items: [
            '<b>cuDNN elige algoritmos.</b> Con <code>cudnn.benchmark = True</code> prueba varios al arrancar y se queda con el más rápido, que puede variar entre corridas; algunos no son deterministas.',
            '<b>Operaciones con sumas atómicas.</b> Varias ops en CUDA acumulan en paralelo y el orden de la suma cambia; en punto flotante, (a + b) + c no siempre es a + (b + c). <code>use_deterministic_algorithms(True)</code> usa la versión determinista si existe y falla si no.',
            '<b>Otra GPU u otra versión.</b> La documentación de PyTorch es explícita: no se garantizan resultados reproducibles entre releases, commits ni plataformas, ni entre CPU y GPU, aun con las mismas seeds.',
            '<b>Precisión mixta, TF32 y varias GPUs.</b> Cambian la aritmética y el orden de las reducciones.',
          ] },
          { t: 'table', caption: 'Qué tan reproducible es razonable', head: ['Nivel', 'Qué garantiza', 'Qué cuesta', 'Cuándo'], rows: [
            ['Bit a bit', 'Los mismos pesos exactos', 'Modo determinista (puede ser más lento: mídelo), misma GPU, misma imagen', 'Depurar una diferencia puntual; auditorías que lo exigen'],
            ['<b>Dentro de tolerancia</b>', 'Las mismas métricas dentro del ruido medido entre seeds', 'Los cinco ingredientes fijados; medir la dispersión una vez', '<b>El objetivo normal</b>: el de c01'],
            ['Estadístico', 'La misma distribución de métricas sobre N seeds', 'N entrenamientos', 'Comparar recetas de entrenamiento, no modelos concretos'],
          ] },
          { t: 'calc', title: 'Cuánto ruido mete la seed (números ilustrativos)', rows: [
            { label: 'Top-1 en el golden set, 5 seeds, misma receta', expr: '85.21 · 85.34 · 85.12 · 85.29 · 85.18', value: E('media 85.23 %') },
            { label: 'Dispersión entre seeds', expr: 'desviación estándar de las 5', value: E('≈ 0.09 pp') + ' (rango 0.22 pp)' },
            { label: 'Ruido de muestreo del golden set (c01)', expr: '1.96 × √(0.85 × 0.15 / 50,000)', value: '≈ ±0.3 pp' },
          ], result: 'Una diferencia de 0.2 pp entre dos corridas no dice nada sobre la receta. Mide la dispersión entre seeds una vez por receta y úsala para fijar la tolerancia de "reproducible". Para comparar dos modelos concretos sobre el mismo golden set está el test pareado de la <a href="#m10.gate">sección 6</a>.' },
          { t: 'callout', kind: 'trap', title: '"Fijé la seed, así que es reproducible"', html: `<p>Frase que un entrevistador con experiencia desarma en una pregunta: "¿y cuDNN?". La respuesta senior: "Pin the five ingredients and aim for reproducible within tolerance; full determinism is a debugging mode, not the default, because it can cost speed and still doesn't hold across GPU types." Fija seeds siempre; activa el modo determinista cuando investigas una diferencia.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Hay dos ruidos distintos y los candidatos los mezclan: el del <b>entrenamiento</b> (seed, orden de datos, no determinismo de la GPU), que dice si la receta es estable, y el de la <b>evaluación</b> (un golden set finito), que dice si la diferencia entre dos modelos concretos es real. El primero se mide con varias seeds; el segundo, con intervalos y tests pareados.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>La imagen por digest y las dependencias fijadas son <a href="#m05">M5</a>; los snapshots inmutables, <a href="#m09.versionado">M9</a>. En c01, reproducible significa "mismo resultado dentro del ruido", dicho explícitamente en <a href="#c01.datos">su pipeline</a>.</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'ci-cd',
        title: 'CI/CD para modelos: la pirámide de tests',
        titleEn: 'CI/CD for models: the test pyramid',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `En software, CI corre los tests en cada commit y CD lleva lo aprobado a producción. En ML cambian tres cosas (código, datos y modelo), y cada una necesita sus tests. La pregunta de la entrevista suele ser "¿qué testearías antes de desplegar?", y la respuesta junior es "que la accuracy sea buena".` },
          { t: 'table', caption: 'La pirámide de tests de c01', head: ['Nivel', 'Qué prueba', 'Ejemplo en c01', 'Cuándo corre', 'Costo'], rows: [
            ['Unitarios de preprocesamiento', 'Que el código que prepara la entrada haga siempre lo mismo', 'Tensores de referencia para 20 imágenes guardados en el repo; orientación EXIF; PNG con paleta', 'Cada commit', 'Segundos, CPU'],
            ['Smoke test del entrenamiento', 'Que el código de entrenamiento aprenda', 'Sobreajustar un batch de 32 imágenes: la loss tiene que bajar a casi cero', 'Cada commit al código de training', 'Un minuto, CPU o GPU chica'],
            ['Datos', 'Que el snapshot sea el que crees', 'Labels dentro de las 500 categorías, sin duplicados entre train y golden set por hash, conteos por fuente (<a href="#m09.validacion-datos">M9</a>)', 'Cada snapshot', 'Minutos'],
            ['Modelo: métricas y slices', 'Que el candidato no retroceda', 'El gate (<a href="#m10.gate">sección 6</a>)', 'Cada candidato', 'Minutos de GPU'],
            ['Modelo: comportamiento', 'Capacidades concretas, no promedios', 'Invariancia a recompresión y reflejo; fotos canónicas por categoría', 'Cada candidato', 'Minutos'],
            ['Parity', 'Que el artefacto servido se comporte como el evaluado', '<code>parity_check.py</code>: engine FP16 vs PyTorch FP32, top-1 agreement ≥ 99.5 % (<a href="#c01.archivos">archivos de c01</a>)', 'Cada engine', 'Minutos en una T4'],
            ['Servicio: contrato', 'Que la API no cambie para los callers', '<code>test_api.py</code>: esquema de respuesta, 400/413/415, <code>model_version</code>', 'Cada commit al gateway', 'Segundos'],
            ['Servicio: rendimiento', 'Que el modelo nuevo quepa en el SLO', 'perf_analyzer a 250 y 500 req/s: p99 ≤ champion + 10 % (<a href="#m03.load-testing">M3</a>)', 'Cada engine', 'Minutos en una T4'],
          ], note: 'Abajo, muchos tests baratos que corren siempre; arriba, pocos tests caros que corren solo cuando hay un candidato. Un fallo arriba que un test de abajo pudo atrapar es un test que falta abajo.' },
          { t: 'h3', text: 'Tests de comportamiento' },
          { t: 'p', html: `La idea viene de CheckList (Ribeiro et al., ACL 2020), escrita para NLP y aplicable a visión. Tres tipos: <b>funcionalidad mínima</b> (casos simples que cualquier modelo aceptable resuelve: una foto de estudio de una bicicleta tiene que tener "bicicletas" en el top-5), <b>invariancia</b> (una transformación que no cambia la respuesta correcta no debe cambiar la predicción: recomprimir el JPEG, reflejar la foto) y <b>expectativa direccional</b> (una transformación debe mover el score en un sentido conocido: más desenfoque, menos confianza).` },
          { t: 'code', title: 'Invariancia y funcionalidad mínima con pytest', caption: 'Corrió con pytest 9.1 usando un modelo de juguete en el <code>conftest.py</code>. En c01, el fixture <code>predict</code> llama al engine candidato y devuelve los ids del top-5; <code>sample_images</code> son ≈ 2,000 imágenes del golden set.', files: [
            { name: 'tests/test_behavior.py', lang: 'python', code: BEHAVIOR },
          ] },
          { t: 'callout', kind: 'trap', title: 'Un assert por imagen', html: `<p>Un test de modelo que exige que <b>cada</b> imagen conserve su top-1 después de recomprimirla falla todas las noches: siempre hay imágenes en la frontera entre dos categorías. Los tests de comportamiento son <b>estadísticos</b>: un umbral sobre una muestra fija (≥ 97 % de acuerdo) y seeds fijas. Solo los casos de funcionalidad mínima, elegidos a mano porque son inequívocos, van uno por uno. Un test flaky enseña al equipo a ignorar el CI.</p>` },
          { t: 'h3', text: 'CI, CD y CT' },
          { t: 'table', head: ['', 'Lo dispara', 'Produce', 'En c01'], rows: [
            ['CI (continuous integration)', 'Un commit', 'Código probado e imágenes construidas', 'Tests unitarios, smoke test, contrato del gateway, build de imágenes'],
            ['CD (continuous delivery)', 'Un artefacto aprobado', 'Un release en producción, por etapas', 'Imagen de Triton con el engine horneado → shadow → canary (<a href="#m11">M11</a>)'],
            ['CT (continuous training)', 'Calendario, datos nuevos o una métrica', 'Un modelo candidato validado', 'Pipeline mensual o adelantado por drift (<a href="#m10.reentrenamiento">sección 8</a>)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Reentrenar el modelo en cada commit', html: `<p>Poner el entrenamiento completo dentro del CI de cada PR suena riguroso: horas de GPU por cambio de una línea, colas de PRs esperando y resultados que varían por la seed. Separa: el CI de código corre en minutos (unitarios, smoke test con un subconjunto chico, contrato); el pipeline de CT produce modelos, con su propio disparador. Lo que sí va al CI: que el pipeline de CT compile y que sus componentes pasen sus tests.</p>` },
          { t: 'h3', text: 'El engine se construye en el hardware de destino' },
          { t: 'p', html: `En c01, el engine de TensorRT se construye en CI sobre un runner con <b>T4</b> y la <b>misma release de NGC</b> que el Triton de producción, porque un engine no es portable entre GPUs ni entre versiones de TensorRT (<a href="#m08.tensorrt">M8</a>). En c03 pasa lo mismo con otra forma: el engine se construye en un Orin NX con el <b>mismo JetPack</b> que las líneas, en un Jetson de CI o en el propio dispositivo de noche (<a href="#c03.datos">datos de c03</a>). Eso implica runners con GPU: una g4dn que se prende solo mientras corre el job (${E('≈ US$0.53/h')} on-demand) y se apaga, no una GPU prendida para el CI.` },
          { t: 'callout', kind: 'trap', title: 'El engine construido en la laptop', html: `<p>"Construí el engine en mi máquina con una RTX y lo subí": el engine no carga en la T4, o carga en una versión distinta de TensorRT y se comporta distinto. El artefacto que se sirve se construye en CI, en el hardware de producción, y lo que se registra es ese build, con el parity test que lo acompaña.</p>` },
          { t: 'h3', text: 'GitOps para el despliegue' },
          { t: 'p', html: `Una forma común de hacer la parte de CD en Kubernetes: los manifests de producción viven en un repo y una herramienta como Argo CD o Flux sincroniza el cluster con ese repo (<a href="#m06">M6</a>). Desplegar la versión nueva es un PR que cambia el digest de la imagen de Triton; el rollback es un revert. La ventaja para ML: el historial de git dice qué modelo servía producción en cada momento, con quién lo aprobó. Ojo: Argo CD sincroniza un estado deseado, pero no tiene un concepto propio de "promover de staging a producción"; eso lo hace tu pipeline (o herramientas como Kargo), y el canary con análisis automático lo hacen Argo Rollouts o Flagger (<a href="#m11.canary">M11</a>).` },
          { t: 'callout', kind: 'interview', html: `<p>"I test at three levels. Cheap tests on every commit: preprocessing against reference tensors, a smoke test that overfits one batch, and the API contract. On every candidate: the evaluation gate, behavioral tests like invariance to JPEG recompression, and parity between the TensorRT engine and the PyTorch model. And a load test at the design QPS, because a more accurate model that doubles latency is a regression."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Una lista de verificación clásica para esto es <i>The ML Test Score</i> (Breck et al., IEEE Big Data 2017): tests de datos, de modelo, de infraestructura y de monitoreo, con puntos por cada uno. Los tests de datos en detalle, en <a href="#m09.validacion-datos">M9</a>; cómo validar un modelo optimizado contra el original, en <a href="#m08.validar">M8</a>.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'gate',
        title: 'El validation gate: cuándo un modelo puede reemplazar al actual',
        titleEn: 'The validation gate: when a new model may replace the current one',
        priority: 'core',
        dims: ['monitoreo', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `El gate es la respuesta escrita a "¿este modelo puede reemplazar al que está en producción?". Escrita <b>antes</b> de ver los resultados, automática y con umbrales que tienen en cuenta el ruido. Sin gate, decide "se ve mejor", que en la práctica significa que el promedio subió y nadie miró el resto.` },
          { t: 'table', caption: 'Qué revisa un gate completo', head: ['Criterio', 'Qué exige', 'Por qué'], rows: [
            ['Métrica principal vs champion', 'No inferioridad con un margen, en un test pareado sobre el mismo golden set', 'Exigir "≥ champion" exacto es decidir con ruido'],
            ['Slices', 'Ningún slice importante cae más que su intervalo', 'Un promedio que sube puede esconder un slice roto'],
            ['Clases o tipos críticos', 'Recall por clase con test y corrección por comparaciones múltiples', 'Con 100 categorías, un umbral fijo sin test da falsas alarmas cada mes'],
            ['Calibración', 'ECE bajo un tope', 'Si el score se muestra o se umbraliza, tiene que significar algo'],
            ['Parity', 'El artefacto servido coincide con el evaluado', 'Export y cuantización cambian la aritmética (<a href="#m08.validar">M8</a>)'],
            ['Recursos', 'Latencia, throughput y VRAM contra el champion', 'Un modelo mejor que no cabe en el SLO no sirve'],
            ['Equidad', 'Métricas por grupo sensible, donde aplica', 'Obligatorio si el modelo decide sobre personas (crédito, contratación, identidad); en c01 no aplica; en c03 (EPP) manda la privacidad: métricas por zona y turno, nunca por persona'],
            ['Higiene', 'Snapshot aprobado; golden set sin solapamiento con el entrenamiento; model card', 'Un gate sobre datos filtrados mide memoria, no calidad (<a href="#m09.leakage">M9</a>)'],
          ] },
          { t: 'h3', text: 'El gate de c01, resumido' },
          { t: 'table', head: ['Chequeo', 'Umbral'], rows: [
            ['Top-1 y top-5 en el golden set (50k)', 'Diferencia pareada ≥ −0.3 pp contra el champion; también contra el champion de hace 3 meses'],
            ['Recall de las 100 categorías con más tráfico', 'Ninguna cae &gt; 5 pp con caída significativa (McNemar por categoría, Holm sobre 100); el macro-recall del long tail no empeora'],
            ['Calibración', 'ECE ≤ 0.05 después de temperature scaling'],
            ['Slices', 'Móvil, web, poca luz, imágenes chicas: ninguno cae más que su intervalo (≈ 1–2 pp)'],
            ['Parity TensorRT FP16 vs PyTorch', 'Top-1 agreement ≥ 99.5 %'],
            ['Latencia', 'p99 a 250 y 500 req/s por GPU ≤ champion + 10 %'],
          ], note: 'Los umbrales completos, con el porqué de cada número, están en los <a href="#c01.datos">datos de c01</a>.' },
          { t: 'h3', text: 'Por qué un test pareado' },
          { t: 'p', html: `Los dos modelos se evalúan sobre <b>las mismas</b> 50,000 imágenes. En la mayoría aciertan o fallan los dos; la información está en las imágenes donde discrepan. Con números:` },
          { t: 'calc', title: 'Challenger vs champion en el golden set de c01 (números ilustrativos)', rows: [
            { label: 'Solo el challenger acierta', expr: 'b', value: '1,100 imágenes' },
            { label: 'Solo el champion acierta', expr: 'c', value: '900 imágenes' },
            { label: 'Diferencia de top-1', expr: '(b − c) / n = 200 / 50,000', value: '+0.4 pp' },
            { label: 'Test pareado (McNemar)', expr: '(b − c)² / (b + c) = 200² / 2,000', value: 'χ² = 20 → p ≈ 8 × 10⁻⁶' },
            { label: 'Intervalo al 95 % de la diferencia pareada', expr: '0.4 ± 1.96 × 0.089 pp', value: '[+0.22, +0.58] pp' },
            { label: 'Si comparas dos accuracies como si fueran muestras independientes', expr: '0.4 / √(2 × 0.85 × 0.15 / 50,000) = 0.4 / 0.226', value: 'z ≈ 1.8 → p ≈ 0.08' },
          ], result: 'La misma diferencia de 0.4 pp es clarísima en el test pareado y "no significativa" si ignoras que son las mismas imágenes. Con el margen de c01, el gate pide que el límite inferior no quede por debajo de −0.3 pp: aquí es +0.22, pasa con holgura.' },
          { t: 'callout', kind: 'skip', html: `<p>La fórmula de McNemar y el error estándar pareado casi nunca se piden en una ronda de MLE. Lo que sí: "comparo los dos modelos con un test pareado sobre el mismo golden set, con un margen de no inferioridad, y los slices con su propio intervalo". Si el entrevistador tira del hilo, tienes el cálculo de arriba. El tamaño de muestra de un A/B (que sí se pregunta) es de <a href="#m11.ab-testing">M11</a> y está en <a href="#ref-numeros.formulas">las fórmulas</a>.</p>` },
          { t: 'h3', text: '¿No inferior o mejor?' },
          { t: 'p', html: `Un reentrenamiento mensual no busca ganarle al champion: busca que el modelo no se quede atrás mientras el catálogo cambia. Si el gate exigiera una mejora significativa, bloquearía casi todos los refrescos y el modelo envejecería. Por eso c01 usa <b>no inferioridad</b> con un margen de −0.3 pp. El riesgo del margen es la erosión: −0.2 pp cada mes durante un año son −2.4 pp. De ahí el segundo chequeo de c01, contra el champion de hace 3 meses. Un cambio grande (arquitectura nueva, categorías nuevas) sí tiene que demostrar mejora, offline y después en un A/B.` },
          { t: 'h3', text: 'Quién puede saltarse el gate' },
          { t: 'table', head: ['Situación', 'Quién decide', 'Qué queda registrado'], rows: [
            ['El gate pasa', 'El pipeline, solo', 'Métricas y veredicto como tags de la versión'],
            ['Falla un criterio no crítico (p. ej. un slice chico cae 1.5 pp con intervalo de 2 pp) y el cambio lo justifica', 'Dos personas: el dueño del modelo y alguien de producto o de otro equipo', 'Tag de override con autor, motivo y ticket; revisión en la reunión mensual'],
            ['Falla un criterio de seguridad (recall por tipo &lt; 99.5 % en c03, recall de noche en c02)', 'Nadie: no tiene override', 'El intento y su resultado, en el tracking'],
            ['Emergencia: el champion está roto en producción', 'On-call, con rollback a la versión anterior, no con un modelo sin validar', 'El incidente y el movimiento del alias'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Mover los umbrales después de ver el resultado', html: `<p>"El slice de poca luz cayó 2 pp, pero el umbral de 1.5 era muy estricto, lo subo a 2.5". Si los umbrales se ajustan mirando al candidato, el gate deja de medir y pasa a justificar. Los umbrales cambian en un PR propio, con motivo, antes de la corrida siguiente.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>El gate offline es la primera mitad. La segunda son los criterios del canary y del A/B, también escritos antes: 5xx, p99, tasa de baja confianza y la métrica de producto (<a href="#m11.canary">M11</a>). Decirlo junto marca la diferencia: "the offline gate decides whether it's safe to try; the canary and the A/B decide whether it stays". Y en c03 el gate es por tipo de defecto, con recall a un FP fijo: la métrica del gate es la del negocio, no la del paper (<a href="#c03.evaluacion">evaluación de c03</a>).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"The gate is written down before training and runs automatically. The challenger must be non-inferior to the champion on the frozen golden set, with a paired test and a 0.3-point margin, no top category or slice can drop beyond its confidence interval, calibration stays under 0.05 ECE, and the TensorRT engine must match PyTorch and fit the latency budget. Overrides need two people and leave a trace, and safety metrics have no override."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'pipelines-entrenamiento',
        title: 'Pipelines de entrenamiento orquestados',
        titleEn: 'Orchestrated training pipelines',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs', 'estimaciones'],
        blocks: [
          { t: 'p', html: `El pipeline mensual de c01 tiene ocho pasos, dos de ellos en GPU. Con un script de bash en una VM, si el paso 6 falla a las 3 a. m. alguien lo relanza entero por la mañana y nadie sabe qué salidas de qué corrida usó cada paso. Un orquestador convierte el script en un <b>DAG</b> de pasos, cada uno en su contenedor, y te da lo que te falta.` },
          { t: 'table', caption: 'Lo que ganas al orquestar', head: ['Qué', 'Qué significa', 'En c01'], rows: [
            ['Reintentos por paso', 'Si un paso falla, se reintenta ese paso, no todo', 'Se pierde el nodo GPU: reintenta el fine-tune y reanuda del checkpoint'],
            ['Caché', 'Si un paso tiene las mismas entradas y la misma definición, se reutiliza su salida', 'Arreglas el parity test y no pagas otras 4 h de GPU'],
            ['Linaje y metadata', 'Qué artefacto produjo cada paso y cuál consumió el siguiente', 'Del engine al snapshot, sin buscar a mano'],
            ['Parámetros', 'La misma definición con otras entradas', '<code>dataset_id</code>, seed, versión del golden set'],
            ['Disparadores', 'Calendario, evento (datos nuevos) o API', 'Mensual; adelantado por un ticket de drift'],
            ['Historial', 'Cada corrida con sus logs, tiempos y estado', 'Cuánto tardó el fine-tune en cada mes'],
          ] },
          { t: 'diagram', id: 'dag-entrenamiento', title: 'El pipeline mensual de c01 como DAG', caption: 'Arriba de izquierda a derecha, abajo de derecha a izquierda. Recorre la corrida normal, un nodo GPU perdido y una segunda corrida que aprovecha la caché.', spec: DAG },
          { t: 'code', title: 'El mismo pipeline en Kubeflow Pipelines (KFP v2)', caption: 'Compiló con kfp 2.17.0 a su YAML. Los cuerpos de los componentes se omiten; lo que importa son las entradas, la GPU, los reintentos y la caché.', files: [
            { name: 'pipeline.py', lang: 'python', code: KFP },
          ] },
          { t: 'callout', kind: 'trap', title: 'La caché y la carpeta "latest"', html: `<p>En Kubeflow Pipelines (y en Vertex AI Pipelines, que ejecuta los mismos pipelines) la caché está <b>activa por defecto</b>: un paso con la misma definición y las mismas entradas devuelve la salida anterior. Si tu paso lee <code>s3://…/datasets/latest/</code> y no recibe el id como parámetro, sus entradas no cambian entre meses: la corrida de noviembre reutiliza el snapshot de octubre y nadie se entera. Dos reglas: toda entrada que cambia el resultado entra como parámetro o artefacto (el id del snapshot, la versión del golden set), y los pasos que comparan contra algo externo que cambia (el champion actual) reciben su versión como parámetro; si no puedes, no los caches. En SageMaker Pipelines es al revés: la caché es opcional y exige un tiempo de vencimiento.</p>` },
          { t: 'h3', text: 'Qué orquestador' },
          { t: 'table', caption: 'Hedged: son herramientas vivas, verifica la versión que vas a usar', head: ['', 'Dónde corre', 'Cómo se define', 'Caché y linaje', 'Cuándo lo eliges'], rows: [
            ['Kubeflow Pipelines', 'Tu cluster de Kubernetes (lo operas tú)', 'SDK de Python (KFP v2) que compila a YAML; cada paso, un contenedor', 'Caché activa por defecto; artefactos y metadata por corrida', 'Ya tienes Kubernetes y un equipo que lo opera; quieres portabilidad entre nubes'],
            ['SageMaker Pipelines', 'AWS, administrado', 'SDK de SageMaker; el decorador <code>@step</code> convierte funciones de Python en pasos', 'Caché opcional con vencimiento; integra con su Model Registry (aprobación)', 'Estás en AWS y no quieres operar el orquestador'],
            ['Vertex AI Pipelines', 'Google Cloud, serverless', 'Pipelines de KFP o TFX, compilados', 'Caché activa por defecto (la misma de KFP; se apaga por tarea o con <code>enable_caching=False</code>); linaje en su metadata store', 'Estás en GCP; ya escribes KFP'],
            ['Airflow', 'Donde lo despliegues o administrado (MWAA, Cloud Composer, Astronomer)', 'DAGs en Python; operadores que lanzan jobs', 'Sin caché de salidas por paso: tus tareas deben ser idempotentes; Airflow 3 agregó versionado de DAGs y backfills desde el scheduler (los Datasets de la 2.4 pasaron a llamarse assets)', 'La empresa ya lo usa para sus pipelines de datos y el entrenamiento es un paso más'],
            ['Dagster', 'Donde lo despliegues o su nube', 'Assets (datos que se producen) en Python', 'Versiones de código y de datos por asset; marca los que quedaron desactualizados', 'Pipeline de datos y de ML pensados como assets con dependencias'],
          ], note: 'Argo Workflows (el motor que KFP usa por defecto en Kubernetes) y un CronJob que lanza un script por etapas también son respuestas válidas para un equipo chico. La del <a href="#c01.datos">caso 1</a> incluye el CronJob como alternativa más simple.' },
          { t: 'callout', kind: 'senior', html: `<p>La pregunta que decide no es cuál es mejor, sino quién lo opera. Kubeflow en un cluster propio es un sistema más con upgrades, permisos y almacenamiento de artefactos; si no hay un equipo de plataforma, el administrado de tu nube o el Airflow que la empresa ya tiene ganan. Con un solo modelo mensual, un CronJob con un script por etapas, un gate escrito y MLflow cubre casi todo lo de la tabla de arriba, menos la caché y la UI.</p>` },
          { t: 'h3', text: 'Costo: GPU de entrenamiento, spot y checkpoints' },
          { t: 'calc', title: '¿Cuánto cuesta un checkpoint de c01?', rows: [
            { label: 'Pesos de ResNet-50 en FP32', expr: '25.6 M × 4 B', value: '≈ 102 MB' },
            { label: 'Estado del optimizador (Adam: 2 momentos)', expr: '2 × 102 MB', value: '≈ 205 MB' },
            { label: 'Checkpoint completo', expr: '102 + 205', value: '≈ 307 MB' },
            { label: 'Escribirlo en S3', expr: E('≈ 100–200 MB/s'), value: E('≈ 2–3 s') },
            { label: 'Cada 15 min durante un fine-tune de 4 h', expr: '16 checkpoints × 3 s', value: E('≈ 1 min en total') },
          ], result: 'Un checkpoint cada 15 minutos cuesta menos de 1 % del tiempo de entrenamiento y limita lo que pierdes en una interrupción a 15 minutos. Guarda también la época, el paso, el estado del scheduler de learning rate, el del GradScaler de AMP y el de los generadores aleatorios: sin ellos, reanudar no es seguir.' },
          { t: 'p', html: `Con checkpoints, el entrenamiento tolera interrupciones y puede correr en <b>spot</b> (<a href="#m06.nodos">M6</a>): el descuento varía por tipo, zona y momento, así que verifícalo. Pero haz la cuenta antes de venderlo como gran ahorro: c01 parte on-demand (${E('≈ US$10–50')} al mes, <a href="#c01.costo">costo de c01</a>) y lista spot como palanca desde el día 1. Con checkpoints cada 15 minutos el riesgo es chico, pero el ahorro son decenas de dólares al mes, así que la razón para hacerlo es el hábito (lo mismo sirve para el backfill de 200 M imágenes), no esta factura. c02 sí entrena en spot con checkpoints (<a href="#c02.datos">datos de c02</a>), y con entrenamientos de días en varias GPUs la cuenta cambia por completo (<a href="#m13">M13</a>).` },
          { t: 'callout', kind: 'interview', html: `<p>"The monthly retrain is a DAG: validate the data, snapshot, fine-tune, evaluate, gate, build the engine on a T4, parity-test and register. Each step is a container with explicit inputs, so it retries on its own and caches safely; the fine-tune checkpoints every fifteen minutes. For one model a month I'd pick whatever orchestrator the company already runs; I wouldn't stand up Kubeflow just for this."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Los pipelines de datos que alimentan el snapshot (ingesta, joins, validación) son <a href="#m09.pipelines">M9</a>. Cada paso es un contenedor con su imagen por digest: <a href="#m05">M5</a>. Los jobs con GPU en Kubernetes y los nodos spot: <a href="#m06.gpus-k8s">M6</a>.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'reentrenamiento',
        title: 'Reentrenamiento: programado, disparado o continuo',
        titleEn: 'Retraining: scheduled, triggered or continuous',
        priority: 'core',
        dims: ['monitoreo', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Todo modelo en producción envejece: el mundo que ve deja de parecerse al de su snapshot. La pregunta no es si reentrenar, sino <b>cuándo</b> y <b>con qué controles</b>. Hay tres políticas, y los sistemas reales combinan las dos primeras.` },
          { t: 'table', head: ['Política', 'Qué la dispara', 'Encaja cuando', 'Riesgo'], rows: [
            ['Programada', 'Calendario: cada semana, mes o trimestre', 'El cambio es gradual y los labels llegan a un ritmo conocido', 'Llega tarde a un cambio brusco; reentrena aunque nada haya cambiado'],
            ['Disparada', 'Una señal: drift, caída de una métrica, datos nuevos, una clase nueva', 'Hay cambios bruscos o estacionales que se pueden detectar', 'Señales ruidosas disparan reentrenamientos inútiles; una señal que falla en silencio no dispara nada'],
            ['Continua (online learning)', 'Cada evento o cada pocos minutos, con actualizaciones incrementales', 'Recomendación y anuncios: el label (clic, reproducción) llega en segundos o minutos y el valor está en la frescura', 'Un bug de datos entra al modelo en minutos; difícil de validar y de revertir. En fraude el label real (contracargo) tarda semanas: la frescura se gana con features de streaming y reentrenamientos frecuentes con labels rápidos parciales, no con online learning sobre el label final'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>El aprendizaje continuo casi no aparece en casos de visión: los labels de c01, c02 y c03 llegan en días y cuestan dinero. Nómbralo y descártalo con esa razón. Se discute de verdad en ranking y anuncios (<a href="#c08">c08</a>); en fraude (<a href="#c09">c09</a>) lo fresco son las features, no los labels.</p>` },
          { t: 'h3', text: 'Los tres casos' },
          { t: 'table', head: ['Caso', 'Calendario', 'Disparadores', 'Lo que no se arregla reentrenando'], rows: [
            ['<a href="#c01.monitoreo">c01</a> marketplace', 'Mensual: el catálogo cambia por temporadas y ≈ 5k labels/mes es la unidad natural de datos nuevos', 'PSI &gt; 0.2 sostenido 3 días; caída de aceptación &gt; 3 pp semana contra semana; categorías nuevas en el árbol', 'Una versión nueva de la app que deja de reducir las fotos a ≤ 1024 px (o ignora la orientación EXIF): es un cambio del cliente, se arregla en la app o en el preprocesamiento, no reentrenando'],
            ['<a href="#c02.monitoreo">c02</a> video', 'Mensual', 'Descartes del SOC por "error del modelo" altos en un sitio una semana; cambio de estación u horario; sitio nuevo tras 2 semanas en shadow; walk tests fallidos', 'Telarañas frente al IR, zonas mal dibujadas, rondas de guardia en el horario: escoba o config del sitio'],
            ['<a href="#c03.monitoreo">c03</a> inspección', 'Mensual', 'Variante de pieza nueva (antes de producirla); "otro" acumulado en la tablet (tipo de defecto nuevo, que mientras tanto cubre la anomalía); drift del score sin causa física; escape reportado', 'Un lente sucio o una lámpara que se degrada: lo atrapa la pieza patrón, no el modelo'],
          ] },
          { t: 'p', html: `El patrón de los tres: <b>un disparador abre un ticket y adelanta el pipeline; no promueve nada</b>. El candidato pasa por el mismo gate, el mismo shadow y el mismo canary (en c02, por olas de sitios; en c03, un turno completo en shadow en una línea) que cualquier otro. Reentrenar sola está bien; llegar sola a producción, no.` },
          { t: 'h3', text: 'Riesgos que pesan más que la frecuencia' },
          { t: 'list', items: [
            '<b>Feedback loops.</b> En c01, entrenar con "la categoría que eligió el vendedor" enseña al modelo a imitar sus propias sugerencias; en c03, los defectos etiquetados son solo los que el modelo ya desvió. Mitigación: labels que no dependan del modelo (golden set humano, holdout de ≈ 1 % sin sugerencias en c01, casi-rechazos y escapes en c03).',
            '<b>Reentrenar con datos malos.</b> Un bug de etiquetado o un upstream roto entra al snapshot y el modelo aprende el bug. Por eso la validación de datos corre antes de gastar GPU (<a href="#m09.validacion-datos">M9</a>) y los labels son eventos que se pueden corregir por lote.',
            '<b>Olvidar lo raro.</b> Un snapshot del último mes tiene pocas muestras de las categorías de temporada pasada. El gate por clase lo atrapa; el snapshot mezcla datos nuevos con históricos.',
            '<b>Costo humano.</b> Cada ciclo es una revisión del gate, un shadow y un canary que alguien vigila. Reentrenar cada semana multiplica eso por cuatro.',
          ] },
          { t: 'h3', text: 'Cómo decidir la cadencia con números' },
          { t: 'p', html: `Primero mide cuánto envejece el modelo: un <b>backtest</b> entrena con datos hasta el mes M y evalúa en muestras etiquetadas de M+1, M+2 y M+3. Supón que en c01 da ${E('≈ 0.4 pp de top-5 por mes')}. Si reentrenas cada T meses y entre el corte de datos y producción pasan L meses (pipeline + shadow + canary), la pérdida promedio contra un modelo recién entrenado es ≈ d × (T/2 + L).` },
          { t: 'calc', title: 'Pérdida promedio según la cadencia (d ≈ 0.4 pp/mes, L = 1 semana)', rows: [
            { label: 'Semanal', expr: '0.4 × (0.125 + 0.25)', value: E('≈ 0.15 pp') + ' · 4 ciclos al mes' },
            { label: 'Mensual (c01)', expr: '0.4 × (0.5 + 0.25)', value: E('≈ 0.30 pp') + ' · 1 ciclo' },
            { label: 'Trimestral', expr: '0.4 × (1.5 + 0.25)', value: E('≈ 0.70 pp') },
            { label: 'Mensual, pero con 3 semanas de corte a producción', expr: '0.4 × (0.5 + 0.75)', value: E('≈ 0.50 pp') },
            { label: 'Costo de un ciclo', expr: 'GPU + revisión del gate + shadow y canary', value: E('US$10–50') + ' + ' + E('≈ 0.5–1 día de una persona') },
          ], result: 'Pasar de mensual a semanal gana ≈ 0.15 pp por 4× el trabajo humano, y con ≈ 1,250 labels por semana. Acortar el tiempo de corte a producción de 3 semanas a 1 gana 0.2 pp sin reentrenar más seguido: muchas veces la palanca es la latencia del pipeline, no la cadencia.' },
          { t: 'callout', kind: 'trap', title: 'Medir el envejecimiento con muestras chicas', html: `<p>Con ≈ 1,250 imágenes aleatorias etiquetadas al mes (el 20–30 % aleatorio de los 5k de c01), el intervalo al 95 % del top-5 es ≈ ±1.1 pp. Una caída de 0.4 pp por mes no se ve de un mes al siguiente: se ve como tendencia de varios meses, o con señales diarias más ruidosas y sesgadas como la aceptación. Si dices "medí que se degrada 0.4 pp al mes", el entrevistador puede preguntar con cuántas muestras.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Separa tres cosas que los candidatos juntan: el <b>disparador</b> (arranca el pipeline), la <b>validación</b> (el gate, igual para todos) y la <b>promoción</b> (shadow, canary, A/B si hace falta). Y antes de reentrenar, diagnostica: la mitad de las "degradaciones del modelo" son un cliente que cambió, un lente sucio o un preprocesamiento roto, y reentrenar sobre eso empeora las cosas.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"We retrain monthly, because that's the pace of the catalog and of our labeling budget, and a drift signal or a new category pulls the next run forward. A trigger only starts the pipeline: the candidate still goes through the same gate, shadow and canary. Before adding cadence I'd shorten the time from data cutoff to production, which buys more for less."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Qué señales de drift se miden, con qué ventanas y a quién alertan es <a href="#m12">M12</a>. El etiquetado que alimenta cada ciclo y el active learning, <a href="#m09.etiquetado">M9</a>. Por qué la métrica offline y la online pueden no moverse juntas, <a href="#m11.offline-online">M11</a>.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'madurez',
        title: 'Niveles de madurez: qué es razonable para cada equipo',
        titleEn: 'MLOps maturity levels: what\'s reasonable for each team',
        priority: 'extra',
        dims: ['tradeoffs', 'comunicacion'],
        blocks: [
          { t: 'p', html: `La referencia más citada es el documento de Google Cloud <i>MLOps: Continuous delivery and automation pipelines in machine learning</i>, con tres niveles. Sirve para decir dónde estás y qué sigue, no para recitarlo.` },
          { t: 'table', caption: 'Los niveles de Google Cloud', head: ['Nivel', 'Qué es', 'Qué se despliega', 'Qué le falta'], rows: [
            ['0 · Proceso manual', 'Cada paso a mano: notebooks, entrenamiento y validación interactivos; el data scientist le entrega el modelo a ingeniería', 'Un modelo', 'Reentrenamiento frecuente, monitoreo activo, reproducibilidad'],
            ['1 · Automatización del pipeline de ML', 'El pipeline de entrenamiento está automatizado y corre solo: continuous training con validación automática de datos y de modelo, metadata y disparadores', '<b>Un pipeline</b>, que produce y entrega modelos de forma recurrente', 'Cambiar el pipeline mismo sigue siendo manual'],
            ['2 · CI/CD del pipeline', 'Encima del nivel 1, CI/CD para el código del pipeline: tests, build y despliegue automático de pipelines nuevos', 'El pipeline, por CI/CD', 'Es el objetivo para equipos que prueban muchas ideas por semana'],
          ], note: 'Para el nivel 1, Google lista disparadores: bajo demanda, calendario, datos nuevos, degradación del modelo y cambios significativos en la distribución. Microsoft publica otro modelo de madurez con cinco niveles (0 a 4): si alguien dice "nivel 2", pregunta de cuál.' },
          { t: 'callout', kind: 'senior', html: `<p>El salto del 0 al 1 es el que el entrevistador busca sin nombrarlo: en el nivel 0 despliegas un modelo; en el 1 despliegas <b>el pipeline que produce modelos</b>. c01 está en el nivel 1: el pipeline mensual corre solo, con gate y disparadores, y la promoción pasa por un canary con rollback automático. El pipeline se cambia con PRs y CI, sin despliegue automático de pipelines nuevos: todavía no es un 2 completo, y no hace falta.</p>` },
          { t: 'table', caption: 'Qué es razonable según el equipo', head: ['Equipo', 'Tracking y registry', 'Pipeline', 'CI/CD', 'No hagas esto'], rows: [
            ['3 personas, 1–3 modelos (c01 al empezar)', 'MLflow con Postgres y S3, o el administrado de tu nube', 'Un CronJob o el orquestador que la empresa ya tenga; gate escrito en código', 'CI de código y contrato; CD con canary simple', 'Montar Kubeflow y un feature store para un modelo mensual'],
            ['Equipo de producto con 5–15 modelos', 'Un registry compartido con aliases y dueños', 'Orquestador administrado o compartido; componentes reutilizables (evaluación, build del engine)', 'Pipelines versionados y probados en CI; canary automático', 'Un pipeline copiado y pegado por modelo, cada uno con su gate distinto'],
            ['Equipo de plataforma, 50+ modelos', 'Registry central con permisos, aprobaciones y auditoría', 'Plantillas de pipeline, caché, cuotas de GPU por equipo', 'Nivel 2: pipelines nuevos por CI/CD; políticas comunes de gate y rollout', 'Obligar a todos a la misma herramienta sin resolver sus casos reales'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>No memorices los componentes de cada nivel ni qué herramienta cubre cuál. Lo que puntúa es decir en qué nivel está el sistema que diseñas, qué pieza agregarías después y por qué no antes.</p>` },
          { t: 'followups', items: [
            { q: '¿Cómo llega un modelo nuevo a producción en tu diseño?',
              junior: 'Lo entreno, veo que la accuracy es mejor, subo los pesos a S3 y reinicio el servicio.',
              senior: `Por un camino fijo. El pipeline valida un snapshot inmutable (si falla, no entrena), entrena sobre él y registra params, métricas, commit y digest. Un gate escrito lo compara contra el champion en el golden set congelado: no inferioridad con test pareado, slices, calibración y latencia. CI construye el engine en una T4 y corre el parity test. Se registra como challenger, CD lo lleva por shadow y canary con rollback automático, y al final el alias champion se mueve. Un rollback es volver a la imagen anterior, que sigue en el registry.`,
              why: 'Cada paso tiene un control y un registro, y el rollback está pensado antes de desplegar.' },
            { q: 'El modelo nuevo mejora 0.4 pp en el golden set. ¿Lo despliegas?',
              junior: 'Sí, es mejor.',
              senior: `Depende de tres cosas. ¿Es real? Con un test pareado sobre las mismas 50k imágenes, 0.4 pp con 1,100 contra 900 discrepancias es claro; comparando dos promedios como independientes no lo sería. ¿Algo empeoró? Recall de las 100 categorías grandes, slices, calibración. ¿Cabe? Parity del engine y p99 a 500 req/s. Si pasa, va a shadow y canary; si es un cambio grande, además un A/B sobre la aceptación.`,
              why: 'Separa ruido de señal, mira más allá del promedio y recuerda que el gate offline no reemplaza al online.' },
            { q: 'No puedes reproducir un modelo de hace seis meses. ¿Qué faltó?',
              junior: 'Guardar la seed.',
              senior: `Uno de los cinco ingredientes: commit exacto con árbol limpio, snapshot inmutable, config versionada, imagen por digest y seeds. Lo más común es el snapshot: se entrenó con "la carpeta de datos" y la carpeta cambió. Aun con todo fijado, apunto a reproducir dentro de la tolerancia medida entre seeds, no bit a bit: cuDNN y otra GPU cambian los números.`,
              why: 'Sabe que la seed es el ingrediente más barato y el menos importante, y fija la expectativa correcta.' },
            { q: '¿Reentrenarías automáticamente cuando detectes drift?',
              junior: 'Sí: si hay drift, reentreno y despliego solo, así el modelo siempre está al día.',
              senior: `El drift arranca el pipeline, no el despliegue. Primero, alguien confirma que el cambio es real y no un cliente roto o un lente sucio: reentrenar sobre un bug lo aprende. Después, el candidato pasa por el mismo gate, shadow y canary. En c01, PSI &gt; 0.2 sostenido 3 días abre un ticket y adelanta el pipeline mensual.`,
              why: 'Separa disparador, validación y promoción, y diagnostica antes de reentrenar.' },
            { q: 'Tienes tres personas y un modelo. ¿Montas Kubeflow?',
              junior: 'Sí, es el estándar de MLOps en Kubernetes.',
              senior: `No al principio. MLflow administrado (o con Postgres y S3), un pipeline como CronJob o en el orquestador que la empresa ya opere, un gate en código y CD con canary. Eso es el nivel 1 de Google para un modelo. Kubeflow tiene sentido cuando hay varios modelos, un equipo que opera el cluster y valor real en la caché y los componentes compartidos.`,
              why: 'Elige por quién opera la herramienta y cuántos modelos hay, no por moda.' },
            { q: 'Producto quiere desplegar hoy un modelo que falló el gate en un slice. ¿Qué haces?',
              junior: 'Lo despliego si producto lo pide; ellos deciden.',
              senior: `Depende del criterio. Si es de seguridad (recall por tipo en c03, noche en c02), no hay override. Si es un slice chico y el cambio lo justifica, override con dos firmas (dueño del modelo y producto), registrado como tag con motivo y ticket, y el canary vigila ese slice en particular. Lo que no hago es subir el umbral para que pase.`,
              why: 'Tiene un proceso de excepción auditable y límites que no se negocian.' },
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"This design sits at Google's level 1: the training pipeline itself is what we deploy, it runs on a schedule or a trigger, and validation is automated. I'd stop there for one model and a small team, and invest in CI/CD for pipelines once several models share components."</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['monitoreo'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, vuelve a la sección correspondiente y explica en voz alta, en inglés, el camino de un modelo nuevo en el <a href="#c01.datos">caso 1</a>.` },
          { t: 'quiz', items: [
            { q: 'En MLflow 3.x, ¿cómo marcas qué versión sirve producción?', options: ['Con un alias como <code>champion</code>, y tags para el estado del gate', 'Con el stage Production', 'Con el nombre del archivo de pesos', 'Con una variable de entorno en el servicio'], answer: 0,
              explain: 'Los stages están deprecados desde MLflow 2.9 (siguen documentados, con eliminación anunciada). Los aliases son punteros con nombre que se mueven; los tags guardan estados como gate=passed.' },
            { q: 'El servicio carga <code>models:/classifier@champion</code> en cada arranque. ¿Qué problema tiene?', options: ['Ninguno: promover es solo mover el alias', 'Durante un scale-up o un reinicio, pods nuevos cargan otra versión que los viejos, sin canary ni deploy', 'MLflow no permite cargar por alias', 'Es más lento que cargar por versión'], answer: 1,
              explain: 'El alias se mueve fuera del proceso de despliegue. En c01, CD resuelve el alias <code>challenger</code> una vez, al construir la imagen del canary, y el tag de la imagen es la versión; <code>champion</code> se mueve al terminar el rollout.' },
            { q: 'MLflow registró el commit <code>c3f2fc2</code> en una corrida. ¿Qué garantiza?', options: ['Que el código de la corrida es exactamente ese commit', 'Que la corrida es reproducible', 'Nada sobre cambios sin commit: se registra el mismo commit aunque el árbol tenga modificaciones', 'Que la imagen es la misma'], answer: 2,
              explain: 'Lo probamos con MLflow 3.16. Por eso los candidatos salen del pipeline, desde un commit limpio.' },
            { q: 'Fijaste todas las seeds y entrenas dos veces en la misma GPU. El top-1 difiere en 0.1 pp. ¿Qué es lo más probable?', options: ['Un bug en tu código', 'El golden set cambió', 'Las seeds no funcionan en GPU', 'No determinismo de la GPU (algoritmos de cuDNN, sumas atómicas): normal si no activaste el modo determinista'], answer: 3,
              explain: 'El objetivo razonable es reproducible dentro de la tolerancia medida entre seeds. El modo determinista es para depurar.' },
            { q: 'Challenger y champion discrepan en 2,000 de 50,000 imágenes: 1,100 a favor del challenger, 900 del champion. ¿Qué test usas?', options: ['Un test pareado (McNemar) sobre las discrepancias', 'Comparar dos intervalos independientes de accuracy', 'Un A/B test', 'Ninguno: +0.4 pp es suficiente'], answer: 0,
              explain: 'Los dos modelos se evalúan sobre las mismas imágenes: el pareado da p ≈ 8 × 10⁻⁶; tratarlos como independientes daría p ≈ 0.08 para la misma diferencia.' },
            { q: 'Tu paso de snapshot en Kubeflow Pipelines lee <code>s3://…/datasets/latest/</code> sin recibir el id. ¿Qué puede pasar en noviembre?', options: ['Nada', 'Kubeflow falla por no tener parámetros', 'La caché (activa por defecto) reutiliza la salida de octubre porque las entradas del paso no cambiaron', 'Se duplica el dataset'], answer: 2,
              explain: 'Todo lo que cambia el resultado entra como parámetro o artefacto. En SageMaker Pipelines la caché es opcional y tiene vencimiento.' },
            { q: 'El PSI de c01 supera 0.2 tres días seguidos. ¿Qué hace el sistema?', options: ['Reentrena y despliega el modelo nuevo automáticamente', 'Hace rollback al modelo anterior', 'Manda un page al on-call', 'Abre un ticket y adelanta el pipeline; el candidato pasa por el gate, shadow y canary como cualquier otro'], answer: 3,
              explain: 'El disparador arranca el pipeline; no acorta el camino. La calidad del modelo es ticket, no page.' },
            { q: 'Con d ≈ 0.4 pp/mes, pasar de reentrenamiento mensual a semanal gana ≈ 0.15 pp. ¿Qué suele rendir más?', options: ['Acortar el tiempo entre el corte de datos y producción', 'Reentrenar cada día', 'Cambiar de orquestador', 'Duplicar la GPU de entrenamiento'], answer: 0,
              explain: 'Con L de 3 semanas a 1, la pérdida mensual baja de ≈ 0.5 a ≈ 0.3 pp sin más ciclos ni más trabajo humano.' },
            { q: 'En el nivel 1 de Google, ¿qué se despliega?', options: ['Un modelo entrenado en un notebook', 'Un pipeline de entrenamiento que produce modelos de forma recurrente (continuous training)', 'Solo el código del servicio', 'Un feature store'], answer: 1,
              explain: 'En el nivel 0 se despliega un modelo; en el 1, el pipeline. El nivel 2 agrega CI/CD para el propio pipeline.' },
          ] },
          { t: 'checklist', id: 'antes-de-automatizar', items: [
            { id: 'camino', html: 'Describo el camino completo de un modelo: snapshot, validación de datos, entrenamiento con tracking, gate, CI del artefacto, registry, deploy seguro, monitoreo y disparadores.' },
            { id: 'snapshot', html: 'El entrenamiento recibe el id de un snapshot inmutable como parámetro, nunca "la carpeta latest".' },
            { id: 'tracking', html: 'Cada corrida registra params, métricas por época, artefactos, snapshot, commit y digest de la imagen; los candidatos salen de un commit limpio.' },
            { id: 'registry', html: 'El registry marca producción con aliases (champion/challenger) y tags; el alias challenger se resuelve al construir la imagen, no al arrancar los pods, y champion se mueve al promover.' },
            { id: 'linaje', html: 'Puedo ir de una versión en producción a su corrida, su snapshot, su commit y su imagen, y responder qué datos usó.' },
            { id: 'reproducible', html: 'Fijo los cinco ingredientes y defino "reproducible" como dentro de la tolerancia medida entre seeds.' },
            { id: 'tests', html: 'Tengo tests en cada nivel: preprocesamiento, smoke test de entrenamiento, datos, comportamiento, parity, contrato y rendimiento.' },
            { id: 'gate', html: 'El gate está escrito antes de entrenar: no inferioridad con test pareado, slices, calibración, parity y latencia; los umbrales cambian solo por PR.' },
            { id: 'override', html: 'Sé quién puede saltarse el gate, cómo queda registrado y qué criterios no tienen override.' },
            { id: 'hardware', html: 'El engine se construye en CI sobre el hardware y la versión de producción, con su parity test.' },
            { id: 'cadencia', html: 'Justifico la cadencia con números (envejecimiento, costo por ciclo, labels disponibles) y separo disparador, validación y promoción.' },
            { id: 'madurez', html: 'Digo en qué nivel de madurez está mi diseño y por qué no necesito más herramientas todavía.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm10-01', kind: 'concepto', q: '¿Qué agrega MLOps a DevOps?',
        a: 'Que los datos y el modelo cambian el comportamiento sin cambiar el código. Se versionan además snapshots, pesos, preprocesamiento y linaje; se prueban datos y modelos con umbrales estadísticos; falla en silencio; y los releases también los disparan datos nuevos o métricas (CT).' },
      { id: 'm10-02', kind: 'concepto', q: 'El camino de un modelo a producción, en orden.',
        a: 'Snapshot inmutable → validación de datos → entrenamiento con tracking → gate contra el champion → CI del artefacto (engine, parity, perf) → registry como challenger → shadow y canary → promoción (alias champion) → monitoreo → disparador de reentrenamiento.' },
      { id: 'm10-03', kind: 'concepto', q: '¿Qué registras en cada corrida de entrenamiento?',
        a: 'Parámetros, métricas por época y finales, artefactos (checkpoint, ONNX, labels, reportes), id del snapshot de datos, commit, digest de la imagen y versiones de librerías, y contexto (dueño, ticket, versión del golden set).' },
      { id: 'm10-04', kind: 'trampa', q: 'MLflow registró el commit de la corrida. ¿Ya sabes qué código la produjo?',
        a: 'No: MLflow registra el mismo commit aunque el árbol tenga cambios sin commit (probado con 3.16), sin ningún aviso. Los candidatos se entrenan desde el pipeline, que parte de un commit limpio.' },
      { id: 'm10-05', kind: 'tradeoff', q: 'MLflow vs Weights & Biases.',
        a: 'MLflow: open source, lo operas tú (Postgres + S3) o lo usas administrado (Databricks, SageMaker AI, Azure ML); registry con aliases. W&B: SaaS comercial, muy fuerte en interfaz, comparación y reportes; W&B Registry con aliases. Elige por quién opera y dónde pueden vivir los datos.' },
      { id: 'm10-06', kind: 'concepto', q: 'Usas un tracking SaaS. ¿Qué no puede depender de él?',
        a: 'El registro de lo que sirve producción y sus punteros: exporta periódicamente métricas, linaje y artefactos a tu almacenamiento.' },
      { id: 'm10-07', kind: 'concepto', q: 'Las cuatro piezas de un model registry.',
        a: 'Registered model (un nombre por problema), versión inmutable (artefactos + corrida), alias (puntero con nombre que se mueve: champion, challenger) y tags (estado del gate, aprobación, ticket).' },
      { id: 'm10-08', kind: 'concepto', q: 'Stages vs aliases en MLflow.',
        a: 'Stages (None/Staging/Production/Archived) deprecados desde 2.9; en 3.x siguen documentados, con eliminación anunciada. Aliases: nombres libres (<code>models:/classifier@champion</code>); tags para estados; un registered model por entorno y <code>copy_model_version</code> para promover entre entornos.' },
      { id: 'm10-09', kind: 'trampa', q: 'El servicio carga <code>@champion</code> del registry al arrancar. ¿Qué pasa?',
        a: 'Pods nuevos (scale-up, reinicio) cargan otra versión que los viejos cuando el alias se mueve: dos modelos detrás del mismo servicio sin deploy ni canary. En c01, CD resuelve el alias challenger una vez, al construir la imagen del canary, y el modelo va horneado; champion se mueve al terminar el rollout.' },
      { id: 'm10-10', kind: 'concepto', q: '¿Qué hay dentro de una versión registrada de c01?',
        a: 'ONNX y engine TensorRT (con GPU y release de NGC como tags), labels.json con su hash, versión del preprocesamiento y firma de entrada/salida, métricas del gate y del parity, y la corrida: snapshot, commit, digest.' },
      { id: 'm10-11', kind: 'concepto', q: 'Los cinco ingredientes de la reproducibilidad.',
        a: 'Código (commit limpio), datos (snapshot inmutable), config (archivo versionado), entorno (imagen por digest, tipo de GPU) y aleatoriedad (seeds de Python, NumPy, torch y de cada worker del DataLoader).' },
      { id: 'm10-12', kind: 'trampa', q: '"Fijé la seed, así que el entrenamiento es reproducible."',
        a: 'No en GPU: cuDNN puede elegir algoritmos distintos (benchmark) y hay ops con sumas atómicas no deterministas; otra GPU u otra versión cambian los números. Objetivo: reproducible dentro de la tolerancia medida entre seeds; el modo determinista es para depurar.' },
      { id: 'm10-13', kind: 'numero', q: '5 seeds dan top-1 entre 85.12 y 85.34 %. ¿Qué te dice y qué no?',
        a: 'Dispersión de la receta ≈ 0.09 pp (rango 0.22): una diferencia de 0.2 pp entre dos corridas es ruido de entrenamiento. No te dice si dos modelos concretos difieren: eso lo decide el test pareado sobre el golden set (ruido de muestreo ≈ ±0.3 pp en c01).' },
      { id: 'm10-14', kind: 'concepto', q: 'La pirámide de tests para ML.',
        a: 'Abajo, baratos y siempre: preprocesamiento contra tensores de referencia, smoke test (sobreajustar un batch), contrato de la API. Por snapshot: tests de datos. Por candidato: gate, tests de comportamiento, parity, rendimiento (perf_analyzer).' },
      { id: 'm10-15', kind: 'concepto', q: 'Tres tipos de tests de comportamiento (CheckList).',
        a: 'Funcionalidad mínima (casos inequívocos que cualquier modelo aceptable resuelve), invariancia (recomprimir o reflejar no cambia la categoría) y expectativa direccional (más desenfoque, menos confianza). Umbrales agregados, no por imagen.' },
      { id: 'm10-16', kind: 'tradeoff', q: 'CI vs CD vs CT.',
        a: 'CI: un commit → código probado e imágenes. CD: un artefacto aprobado → release por etapas. CT: calendario, datos o métrica → un modelo candidato validado. No metas el entrenamiento completo en el CI de cada PR.' },
      { id: 'm10-17', kind: 'trampa', q: '"Construí el engine en mi laptop y lo subí al registry."',
        a: 'Un engine de TensorRT no es portable entre GPUs ni versiones de TensorRT. Se construye en CI sobre el hardware de producción (T4 + misma release de NGC en c01; Orin NX + mismo JetPack en c03) y se registra con su parity test.' },
      { id: 'm10-18', kind: 'concepto', q: 'Qué revisa un validation gate completo.',
        a: 'Métrica principal con no inferioridad y test pareado, slices, clases críticas con corrección por comparaciones múltiples, calibración, parity, latencia/VRAM, equidad donde aplica e higiene (snapshot aprobado, golden set sin solapamiento, model card).' },
      { id: 'm10-19', kind: 'numero', q: '50k imágenes; discrepancias 1,100 a favor del challenger y 900 del champion. ¿Resultado?',
        a: '+0.4 pp. McNemar: χ² = 200²/2,000 = 20, p ≈ 8 × 10⁻⁶; IC 95 % [+0.22, +0.58] pp. Tratado como dos muestras independientes, z ≈ 1.8 y p ≈ 0.08: el pareado es mucho más sensible.' },
      { id: 'm10-20', kind: 'tradeoff', q: '¿No inferioridad o mejora significativa en el gate?',
        a: 'Reentrenamientos rutinarios: no inferioridad con margen (−0.3 pp en c01), para no bloquear refrescos; más un chequeo contra el champion de hace 3 meses contra la erosión. Cambios grandes: mejora demostrada offline y en A/B.' },
      { id: 'm10-21', kind: 'trampa', q: 'La caché de Kubeflow Pipelines y la carpeta "latest".',
        a: 'La caché está activa por defecto (también en Vertex AI Pipelines): si el paso lee "latest" sin recibir el id, sus entradas no cambian y reutiliza el snapshot del mes pasado. Toda entrada que cambia el resultado va como parámetro, incluida la versión del champion contra la que compara la evaluación.' },
      { id: 'm10-22', kind: 'tradeoff', q: 'Kubeflow vs SageMaker Pipelines vs Vertex AI Pipelines vs Airflow.',
        a: 'Kubeflow: en tu Kubernetes, portable, lo operas tú. SageMaker Pipelines: AWS administrado, caché opcional, integra aprobación del registry. Vertex: GCP serverless con KFP o TFX. Airflow: si la empresa ya lo usa; sin caché de salidas, tareas idempotentes. Decide quién lo opera.' },
      { id: 'm10-23', kind: 'numero', q: '¿Cuánto pesa un checkpoint de ResNet-50 con Adam y cuánto cuesta guardarlo cada 15 min?',
        a: '102 MB de pesos + 205 MB de momentos ≈ 307 MB; ≈ 2–3 s a S3; ≈ 1 min en un fine-tune de 4 h. Menos de 1 % del tiempo, y limita la pérdida por interrupción a 15 min.' },
      { id: 'm10-24', kind: 'concepto', q: 'Programado vs disparado vs continuo.',
        a: 'Programado: cambio gradual, labels a ritmo conocido (c01, c02, c03 mensual). Disparado: drift, caída de métrica, clase nueva. Continuo: labels en minutos (ranking, anuncios); no en fraude, donde el label (contracargo) tarda semanas; raro en visión. El disparador abre ticket y arranca el pipeline; no promueve.' },
      { id: 'm10-25', kind: 'numero', q: 'Pérdida promedio por envejecimiento con d = 0.4 pp/mes: semanal, mensual, trimestral (L = 1 semana).',
        a: '≈ d × (T/2 + L): semanal ≈ 0.15 pp, mensual ≈ 0.30, trimestral ≈ 0.70. Mensual con L de 3 semanas ≈ 0.50: acortar L suele rendir más que subir la cadencia.' },
      { id: 'm10-26', kind: 'concepto', q: 'Niveles 0, 1 y 2 de MLOps de Google Cloud.',
        a: '0: todo manual, se despliega un modelo. 1: pipeline de entrenamiento automatizado (CT) con validación, metadata y disparadores; se despliega el pipeline. 2: CI/CD del propio pipeline. c01 está en el 1.' },
      { id: 'm10-27', kind: 'frase', q: '¿Cómo dices en inglés el camino de un modelo a producción?',
        a: '"Every model goes through the same path: training on an immutable, validated snapshot, tracked with its commit and image digest; an evaluation gate against the champion; the engine built and parity-tested in CI; registered as the challenger; then shadow and canary. A drift signal restarts the pipeline, not the deploy."' },
      { id: 'm10-28', kind: 'frase', q: '¿Cómo defiendes en inglés un gate de no inferioridad?',
        a: '"A routine retrain only has to be non-inferior: a paired test on the frozen golden set with a 0.3-point margin, no slice dropping beyond its interval. I also compare against the champion from three months ago, so small losses can\'t add up."' },
    ],

    // ---------------------------------------------------------- glosario
    // Términos nuevos de este módulo. model registry, champion / challenger, evaluation gate,
    // GitOps, parity test, golden set, feedback loop, ML lifecycle, checkpoint / resume, spot
    // instance, image digest, rollback, shadow deployment y canary release ya están definidos:
    // no se repiten.
    glossary: [
      { en: 'MLOps', es: 'operación de ML', def: 'Prácticas y herramientas para que entrenar, validar, desplegar, monitorear y reentrenar modelos sea repetible, auditable y seguro. Hereda de DevOps y agrega datos y modelos como fuentes de cambio.', say: 'For us MLOps means every model goes through the same gated, traceable path to production.' },
      { en: 'experiment tracking', es: 'registro de experimentos', def: 'Registrar automáticamente cada corrida de entrenamiento (parámetros, métricas, artefactos, versión de datos, commit, entorno) en un lugar compartido y consultable.', say: 'Experiment tracking lets anyone see exactly which data and commit produced the model in production.' },
      { en: 'MLflow', es: 'MLflow', def: 'Plataforma open source (Apache 2.0) de tracking de experimentos, model registry con aliases, formato de modelo y evaluación. Se opera con una base de datos y un artifact store, o administrada por Databricks, SageMaker AI o Azure ML.', say: 'We run MLflow with Postgres and S3, and the registry aliases drive our deployments.' },
      { en: 'Weights & Biases (W&B)', es: 'Weights & Biases', def: 'Plataforma comercial de tracking de experimentos con dashboards, reportes, sweeps y un registry con aliases (W&B Registry).', say: 'The research team compares hundreds of runs in Weights & Biases.' },
      { en: 'model alias', es: 'alias de modelo', def: 'Nombre que apunta a una versión concreta de un modelo en el registry (champion, challenger) y se puede mover. Reemplaza a los stages de MLflow, deprecados desde la versión 2.9.', say: 'Promotion is just moving the champion alias to version fifteen.' },
      { en: 'model lineage', es: 'linaje del modelo', def: 'La cadena de punteros que une una versión de modelo con su corrida, su snapshot de datos, su commit y su imagen de entrenamiento.', say: 'Lineage tells us in one query which models were trained on the photos a user asked us to delete.' },
      { en: 'model card', es: 'ficha del modelo', def: 'Documento corto por versión (Mitchell et al., 2019) con uso previsto y no previsto, datos, métricas por slice, limitaciones y dueño.', say: 'The model card says it is not validated for automatic moderation.' },
      { en: 'continuous training (CT)', es: 'entrenamiento continuo', def: 'Reentrenar y validar modelos de forma automática con un pipeline que se dispara por calendario, datos nuevos o una métrica. Es lo que define el nivel 1 de madurez de Google.', say: 'Continuous training means we deploy the pipeline, and the pipeline produces the models.' },
      { en: 'behavioral testing', es: 'tests de comportamiento', def: 'Tests de capacidades concretas del modelo en vez de una métrica promedio: funcionalidad mínima, invariancia y expectativa direccional (CheckList, Ribeiro et al., 2020).', say: 'Behavioral tests catch that the new model flips its answer when a JPEG is recompressed.' },
      { en: 'invariance test', es: 'test de invariancia', def: 'Test de comportamiento que aplica una transformación que no debería cambiar la respuesta (recomprimir, reflejar) y exige que la predicción se mantenga en un porcentaje alto de una muestra.', say: 'The invariance test requires ninety-seven percent top-1 agreement after mirroring.' },
      { en: 'minimum functionality test', es: 'test de funcionalidad mínima', def: 'Test de comportamiento con casos simples e inequívocos, elegidos a mano, que cualquier modelo aceptable debe resolver.', say: 'A studio photo of a bike must have bikes in the top five, or the build fails.' },
      { en: 'non-inferiority margin', es: 'margen de no inferioridad', def: 'Pérdida máxima tolerada frente al modelo actual para aceptar al nuevo: el límite inferior del intervalo de la diferencia no puede quedar por debajo del margen.', say: 'A routine retrain passes if it is non-inferior within a 0.3-point margin.' },
      { en: 'McNemar\'s test', es: 'test de McNemar', def: 'Test pareado para comparar dos clasificadores sobre las mismas muestras usando solo las discrepancias: (b − c)² / (b + c).', say: 'We compare champion and challenger with McNemar\'s test on the same golden set.' },
      { en: 'deterministic algorithms', es: 'algoritmos deterministas', def: 'Modo de PyTorch (<code>torch.use_deterministic_algorithms(True)</code>) que usa versiones deterministas de las operaciones y falla si una no tiene. Puede ser más lento y no garantiza lo mismo entre GPUs o versiones.', say: 'We only turn on deterministic algorithms when we are chasing a difference between two runs.' },
      // m09 define 'workflow orchestrator' (el general, para datos); este es el de pipelines de ML.
      { en: 'ML pipeline orchestrator', es: 'orquestador de pipelines de ML', def: 'Orquestador de workflows aplicado a pipelines de ML: ejecuta DAGs de pasos en contenedores con dependencias, reintentos, caché de pasos, historial, linaje de artefactos y disparadores. Para entrenamiento: Kubeflow Pipelines, SageMaker Pipelines, Vertex AI Pipelines, Airflow, Dagster.', say: 'The orchestrator retries only the failed step and caches the ones whose inputs didn\'t change.' },
      { en: 'step caching', es: 'caché de pasos', def: 'Reutilizar la salida de un paso del pipeline cuando su definición y sus entradas son las mismas que en una corrida anterior. Activa por defecto en Kubeflow Pipelines y en Vertex AI Pipelines; opcional y con vencimiento en SageMaker Pipelines.', say: 'Step caching saved us four GPU hours when we only fixed the parity script.' },
      { en: 'Kubeflow Pipelines (KFP)', es: 'Kubeflow Pipelines', def: 'Orquestador de pipelines de ML sobre Kubernetes: SDK de Python que compila a YAML, cada paso un contenedor, caché y metadata de artefactos. Vertex AI Pipelines ejecuta pipelines escritos con su SDK.', say: 'We define the retraining DAG with the KFP SDK and run it on our own cluster.' },
      { en: 'SageMaker Pipelines', es: 'SageMaker Pipelines', def: 'Orquestador administrado de AWS para pipelines de ML, integrado con su Model Registry (estados de aprobación); el decorador <code>@step</code> convierte funciones de Python en pasos.', say: 'On AWS I would use SageMaker Pipelines and gate deployment on the registry approval status.' },
      { en: 'Vertex AI Pipelines', es: 'Vertex AI Pipelines', def: 'Servicio serverless de Google Cloud que ejecuta pipelines de KFP o TFX, con caché (activa por defecto) y linaje.', say: 'On GCP the same KFP pipeline runs on Vertex AI Pipelines without a cluster to operate.' },
      { en: 'MLOps maturity level', es: 'nivel de madurez de MLOps', def: 'Escala para describir cuánto está automatizado el ciclo de vida. La de Google Cloud: 0 manual, 1 pipeline automatizado (CT), 2 CI/CD del pipeline. Microsoft usa otra de cinco niveles (0–4).', say: 'This design sits at level one: we deploy the pipeline, not a model.' },
      { en: 'retraining trigger', es: 'disparador de reentrenamiento', def: 'Condición que arranca el pipeline de entrenamiento fuera del calendario: drift sostenido, caída de una métrica, datos o clases nuevas. Arranca el camino; no se salta el gate ni el rollout.', say: 'A retraining trigger opens a ticket and starts the pipeline early; it never deploys on its own.' },
      { en: 'model promotion', es: 'promoción del modelo', def: 'Pasar un candidato validado a servir producción, en el registry moviendo el alias champion después del rollout. Queda registrado quién lo hizo, cuándo y por qué.', say: 'Promotion happens after the canary, and CD moves the alias, not a person in the UI.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
