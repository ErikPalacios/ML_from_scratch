/* Precarga del C01 con el estado real de ~/Documents/ProyectosPortafolio/Caso1 (leído el 2026-10-26, sin cambiar nada allá):
   PLAN.md (hitos 0–10), LAB_LOG.md (estado, mediciones y lo que se rompió), DESIGN.md (cálculos y arquitectura) y el git log
   (f3133a3 hito 0, 4bc61ef hito 1 paso 1.1). Los hitos quedan en la estación del mapa donde caen; su «hecho» es el del PLAN.
   Los criterios de cada estación son los del C01 completo del curso (con GPU y Kubernetes): marca los que apliquen a tu alcance. */
import { projectFromTemplate } from './factory.mjs';

const H = (id, text, status, done) => ({ id, text, status, done });
const R = (id, name, value, unit, date, note = '') => ({ id, name, value, unit, date, note });
const C = (id, code, note) => ({ id, code, note });
const F = (id, path, ref) => ({ id, path, ref });

const STEP = {
  datos: {
    hitos: [H('imagenette', 'Imagenette 320px como golden set (scripts/download_data.py)', 'pendiente', 'Se descarga a data/ (≈ 325 MB, pide permiso antes) y sus 10 clases quedan mapeadas a índices de ImageNet: sirve para el golden set (hito 9), la prueba de carga (hito 6) y las perturbaciones (hito 10).')],
    notes: 'Alcance mínimo (PLAN, «Base de datos sencilla»): dos piezas chicas. Imagenette para medir top-1 y top-5 reales, y SQLite con predicciones y feedback (hito 4, en Monitoreo). En producción las predicciones irían como log JSON → S3/Parquet.',
  },
  versionado: {
    status: 'no_aplica',
    reason: 'Alcance mínimo: pesos IMAGENET1K_V2 de torchvision e Imagenette, sin snapshots propios. MODEL_VERSION llega en el hito 9.',
  },
  entrenamiento: {
    status: 'no_aplica',
    reason: 'El modelo ya existe (ResNet-50 IMAGENET1K_V2 de torchvision); el caso no lo rediseña ni lo reentrena.',
  },
  gate: {
    hitos: [H('h9a', 'Hito 9 (parte 1) · eval_golden.py y gate de paridad', 'pendiente', 'eval_golden.py da top-1/top-5 sobre ≈ 500 fotos de Imagenette; parity_check.py exige top-1 de acuerdo ≥ 99.5 %: pasa con PyTorch vs ONNX y falla con ResNet-50 V2 vs V1 o vs ResNet-18.')],
    notes: 'Aprendido en el hito 1: V2 y V1 dan el mismo top-1 con confianzas muy distintas (0.27 vs 0.61). Un umbral sobre scores se recalibra por versión de modelo.',
  },
  export: {
    hitos: [H('h7b', 'Hito 7 (b) · ONNX Runtime en CPU', 'pendiente', 'Variante medida con el mismo loadtest.sh y comparada en la tabla antes/después.')],
    notes: 'Sin GPU NVIDIA en la Mac: TensorRT y Triton no aplican aquí; el export es PyTorch → ONNX → ONNX Runtime CPU. La paridad PyTorch vs ONNX es el gate del hito 9.',
  },
  serving: {
    status: 'en_curso',
    vuelta: { v1: 'en_curso', v2: 'pendiente' },
    hitos: [
      H('h1', 'Hito 1 · Esqueleto que camina', 'en_curso', 'El curl con la foto de un perro devuelve el JSON del contrato con un top-1 sensato; /readyz da 503 durante la carga; anotas la latencia del 1.er request contra los 10 siguientes (warm-up).'),
      H('h2', 'Hito 2 · Validación de entrada y errores', 'pendiente', 'pytest con un caso por error (400, 413 por bytes, 413 por MP, 415, top_k inválido) y un caso feliz con un modelo falso, todo en verde en menos de 5 s.'),
      H('h3', 'Hito 3 · Timeouts y fallback', 'pendiente', 'pytest con un modelo de 2 s → 504 en ≈ 150 ms; modelo caído → 503 con Retry-After; /healthz sigue en 200 en ambos casos.'),
      H('h8', 'Hito 8 · Gateway + servidor de modelo (opcional)', 'pendiente', 'Mismo contrato externo con dos servicios en docker-compose; mides cuánto agrega el salto de red al p50/p99.'),
    ],
    results: [
      R('r1', 'Forward ResNet-50 V2 (batch 1, 4 threads, macOS nativo), forwards 2–5', '≈ 25', 'ms', '2026-10-21', 'Dos corridas: 27.8/24.8/23.3/25.1 y 25.1/26.7/24.1/23.3 ms.'),
      R('r2', 'Forward 1 (warm-up)', '39.9', 'ms', '2026-10-21'),
      R('r3', 'Decode + preprocess en caliente', '≈ 3–7', 'ms', '2026-10-21', 'AVIF 414×311 ≈ 3 ms; PNG 1204×515 ≈ 7 ms.'),
      R('r4', 'Decode + preprocess en frío', '2180 / 72.6', 'ms', '2026-10-21', 'Primera vez en la máquina (decoder AVIF) / primera llamada de un proceso nuevo.'),
      R('r5', 'Carga real del modelo', '≈ 456–511', 'ms', '2026-10-21'),
      R('r6', 'Warm-up (3 pasadas por el camino completo)', '89–110', 'ms', '2026-10-21'),
      R('r7', 'Proceso importando torch, puerto cerrado', '≈ 3', 's', '2026-10-21', 'Con LOAD_DELAY_S=10: ≈ 10 s más con /readyz 503 y /healthz 200.'),
      R('r8', 'Top-1 del mismo perro, V2 vs V1', '0.269 vs 0.613', 'score', '2026-10-21', 'toy poodle en los dos; masa en clases de perro 0.546 vs 0.998.'),
    ],
    commands: [
      C('m1', 'uv run python scripts/predict_once.py data/perrito.jpg', 'Caso1 · top-5 de una foto y tiempos del forward (paso 1.1).'),
      C('m2', 'curl -i localhost:8080/readyz', 'Caso1 · 503 mientras carga, 200 con el modelo listo (paso 1.3).'),
    ],
    files: [
      F('f1', 'scripts/predict_once.py', 'sin commit (el commit 4bc61ef solo trae DESIGN.md y LAB_LOG.md)'),
      F('f2', 'app/main.py', 'sin commit · último cambio 2026-10-23'),
      F('f3', 'app/model.py', 'sin commit'),
      F('f4', 'app/preprocess.py', 'sin commit'),
    ],
    notes: [
      'Hito 1, vuelta 1: 1.1 ✓ predict_once.py con el top-5 y el forward medido · 1.2–1.3 ✓ lifespan que carga el modelo una vez, /healthz y /readyz 503→200 con warm-up · 1.4 → POST /v1/classify + curl.',
      '',
      'Lo que se rompió en el hito 1 (LAB_LOG):',
      '- Una foto fuera de distribución (un diagrama) igual devuelve top-5, con score bajo (0.24): hace falta un umbral de confianza y el selector manual.',
      '- El .jpg era AVIF y Pillow lo abrió: el servicio valida el formato real por los bytes, no por la extensión ni el Content-Type (hito 2).',
      '- Medir una vez en frío engaña (44 ms y 2180 ms): el warm-up antes de /readyz recorre todo el camino.',
      '- El center crop deja solo ≈ 41 % del ancho de una imagen panorámica.',
      '- El servidor viejo seguía corriendo y /readyz daba 404: Python lee el código una vez al arrancar.',
    ].join('\n'),
  },
  empaquetado: {
    vuelta: { v1: 'en_curso', v2: 'pendiente' },
    hitos: [
      H('h0', 'Hito 0 · Setup (uv, Python 3.13, dependencias fijadas)', 'hecho', '`rm -rf .venv && uv sync` reinstala exactamente las mismas versiones; git status limpio y sin .venv, data/ ni models/. Cerrado el 2026-10-12 (yo hice 0.1–0.5 y 0.12; lo terminó el mentor).'),
      H('h5', 'Hito 5 · Docker', 'pendiente', '`docker run -p 8080:8080` + curl devuelve el JSON del contrato; anotas el tamaño de la imagen y el tiempo hasta /readyz en 200.'),
    ],
    results: [
      R('r1', 'Paquetes en .venv', '41', 'paquetes', '2026-10-12', '6 directos + 2 de dev.'),
      R('r2', 'Tamaño de .venv (macOS)', '646', 'MB', '2026-10-12'),
      R('r3', 'Paquetes nvidia-* en el lock, antes / después del índice CPU', '15 (+ triton) / 0', 'paquetes', '2026-10-12'),
    ],
    commands: [
      C('m1', 'rm -rf .venv && uv sync --frozen && uv pip freeze', 'Caso1 · reproduce exactamente las mismas versiones.'),
      C('m2', 'uv lock --check', 'Caso1 · el lock está sincronizado con pyproject.toml (iría en CI).'),
      C('m3', "grep -c '^name = \"nvidia' uv.lock", 'Caso1 · 0 con el índice CPU de PyTorch.'),
    ],
    files: [F('f1', 'pyproject.toml, uv.lock, .python-version, .gitignore', 'f3133a3 · Hito 0')],
    notes: 'Aprendido: pegué una plantilla de pyproject.toml encima y el lock quedó desincronizado. El lock se deriva del pyproject, nunca al revés.',
  },
  cicd: {
    status: 'no_aplica',
    reason: 'Fuera del alcance mínimo del PLAN (hitos 0–10). El LAB_LOG anota que `uv lock --check` iría en CI.',
  },
  kubernetes: {
    status: 'no_aplica',
    reason: 'En la laptop corre 1 contenedor; las réplicas se calculan en papel (DESIGN.md, «Lo que cambia en la laptop»).',
  },
  rollout: {
    hitos: [H('h9b', 'Hito 9 (parte 2) · MODEL_VERSION visible y rollback', 'pendiente', 'MODEL_VERSION va en la respuesta y en los logs; el rollback vuelve al tag de imagen anterior en menos de 1 minuto.')],
  },
  request: {
    hitos: [
      H('h6', 'Hito 6 · Prueba de carga', 'pendiente', 'Tabla en LAB_LOG.md con concurrencia, throughput, p50, p99, % de errores y CPU; el punto donde el p99 pasa de 200 ms; Little\'s law (L = λ·W) verificada en cada fila.'),
      H('h7', 'Hito 7 · Mejorar con lo medido (a: threads vs workers, c: batching)', 'pendiente', 'Tabla antes/después con la mejor configuración y por qué ganó.'),
    ],
    results: [
      R('r1', 'Réplicas CPU para 500 req/s con el forward medido (25 ms)', '22 (88 cores)', 'réplicas', '2026-10-21', 'DESIGN.md: 40 img/s por réplica, 24 planificadas al 60 %, N+1. ≈ US$2,730/mes si fueran c6i.xlarge, contra ≈ US$768 con 2 GPUs.'),
      R('r2', 'Requests en vuelo a 500 req/s (Little: L = λ·W)', '≈ 25 en el p50 · ≈ 100 en el p99', 'requests', '2026-10-21', 'Cálculo de servilleta de DESIGN.md.'),
    ],
  },
  monitoreo: {
    hitos: [
      H('h4', 'Hito 4 · Observabilidad mínima + SQLite', 'pendiente', 'Después de 200 requests, quantiles.py imprime p50 y p99, y una consulta SQL devuelve la tasa de aceptación simulada.'),
      H('h10', 'Hito 10 · Romper el modelo, no el servicio', 'pendiente', 'Tabla con la caída de accuracy por perturbación y qué señal sin labels (confianza, entropía, PSI) la habría detectado en producción.'),
    ],
  },
};

const DECISIONS = [
  ['2026-10-12', 'empaquetado', 'Python 3.13 fijado en .python-version y en el Dockerfile', 'Python 3.14', 'Wheels maduras para torch y onnxruntime en arm64, y la misma versión menor que python:3.13-slim del curso. Después se vio que 3.14 también tenía todas.'],
  ['2026-10-12', 'empaquetado', 'uv + pyproject.toml + uv.lock', 'venv + requirements.txt con ==', 'El lock fija también las dependencias transitivas, para macOS y Linux en el mismo archivo, y uv sync es reproducible y rápido.'],
  ['2026-10-12', 'empaquetado', 'torch CPU-only en Linux (índice download.pytorch.org/whl/cpu)', 'torch de PyPI', 'En Linux el de PyPI trae CUDA: 15 paquetes nvidia-* más triton que un servicio en CPU nunca usa.'],
  ['2026-10-12', 'empaquetado', 'Pesos y datos fuera de git', 'Versionarlos en el repo', 'Son pesados y binarios; se versionan por tag o hash.'],
  ['2026-10-12', 'serving', 'ResNet-50, pesos IMAGENET1K_V2 de torchvision', 'ResNet-18', 'Es el modelo del caso (4.1 GMACs) y en CPU pone el SLO en tensión, así los hitos 6 y 7 tienen algo que arreglar. ResNet-18 cumple sobrado y no enseña nada.'],
  ['2026-10-12', 'serving', 'Un solo app/preprocess.py con weights.transforms() y decode con Pillow', 'Resize a mano en el handler', 'Fuente única de verdad, igual a la del entrenamiento: evita el training-serving skew.'],
  ['2026-10-12', 'serving', 'Handler def síncrono en el hito 1; run_in_threadpool + asyncio.wait_for en el hito 3', 'async def con el forward adentro', 'Un async def con el forward adentro bloquea el event loop.'],
  ['2026-10-12', 'serving', 'Un proceso uvicorn en el puerto 8080', 'uvicorn --workers N dentro del contenedor', 'Un proceso por contenedor; las réplicas las pone el orquestador. Se mide en el hito 7.'],
  ['2026-10-12', 'serving', 'Config por variables de entorno (MODEL_VERSION, INFER_TIMEOUT_S=0.15, MAX_BYTES, MAX_PIXELS, TORCH_THREADS…)', 'Constantes en el código', 'El mismo artefacto en todos los ambientes; solo cambia la config.'],
  ['2026-10-12', 'datos', 'Imagenette 320px + SQLite de predicciones y feedback', 'Un dataset propio; log JSON → S3/Parquet', 'Las 10 clases de Imagenette mapean a ImageNet: top-1 y top-5 reales en la Mac. SQLite es solo para tener las predicciones consultables en local.'],
  ['2026-10-21', 'request', 'Gateway → model server por HTTP con tensor binario (protocolo KServe v2 de Triton)', 'gRPC', 'Igual de eficiente en bytes, sin la trampa de balanceo de gRPC detrás de un balanceador L4, y se depura con curl. La API pública sigue en HTTP + JSON.'],
];

export function seedC01() {
  const p = projectFromTemplate({
    id: 'c01',
    name: 'C01 · API de clasificación (Caso1)',
    pattern: 'sincrono',
    repo: '~/Documents/ProyectosPortafolio/Caso1',
    goal: 'POST /v1/classify con ResNet-50 en CPU que funciona, se mide y se rompe a propósito: hitos 0–10 del PLAN, en dos vueltas.',
  });
  for (const s of p.steps) {
    const x = STEP[s.id];
    s.commands = s.commands.map((c) => ({ ...c, note: `Curso (C01 completo)${c.note ? ': ' + c.note : ''}` }));
    if (!x) continue;
    if (x.status) s.status = x.status;
    if (x.reason) s.reason = x.reason;
    if (x.vuelta) s.vuelta = { ...s.vuelta, ...x.vuelta };
    if (x.hitos) s.hitos = x.hitos;
    if (x.results) s.results = x.results;
    if (x.commands) s.commands = [...x.commands, ...s.commands];
    if (x.files) s.files = x.files;
    if (x.notes) s.notes = x.notes;
  }
  p.vueltaActual = 1;
  p.resume = {
    where: 'Hito 1 (Esqueleto que camina), vuelta 1. Pasos 1.1–1.3 hechos: predict_once.py con el top-5 y el forward medido (≈ 25 ms), lifespan que carga ResNet-50 una vez, /healthz y /readyz 503→200 con warm-up. Ojo: app/main.py, app/model.py, app/preprocess.py y scripts/predict_once.py no tienen commit (main.py cambió por última vez el 2026-10-23), y LAB_LOG.md y DESIGN.md tienen cambios sin commit.',
    next: 'Hito 1, paso 1.4: POST /v1/classify que lee el body crudo y devuelve el top-k con el contrato; probarlo con curl y la foto de un perro. Antes: un commit con lo que ya funciona de los pasos 1.1–1.3.',
    nextStepId: 'serving',
  };
  p.sessions = [
    {
      id: 's-2026-10-12', date: '2026-10-12', source: 'import', stepIds: ['empaquetado'],
      did: 'Hito 0: setup con uv, Python 3.13 y dependencias fijadas (yo hice 0.1–0.5 y 0.12; lo terminó el mentor). Escribí PLAN.md y LAB_LOG.md. Commit f3133a3.',
      measured: '.venv con 41 paquetes y 646 MB; paquetes nvidia-* en el lock: 15 → 0 con el índice CPU; `uv sync --frozen` reproduce exactamente lo mismo.',
      next: 'Hito 1, paso 1.1: cargar ResNet-50 en un script suelto y sacar el top-5 de una foto.',
    },
    {
      id: 's-2026-10-21', date: '2026-10-21', source: 'import', stepIds: ['serving', 'request'],
      did: 'Hito 1, paso 1.1: predict_once.py y primera medición del forward en CPU; DESIGN.md con los cálculos de servilleta (commit 4bc61ef). Pasos 1.2–1.3: lifespan, /healthz y /readyz 503→200 con warm-up.',
      measured: 'Forward ≈ 25 ms (batch 1, 4 threads); decode + preprocess en caliente ≈ 3–7 ms (en frío 44 y 2180 ms); carga del modelo ≈ 456–511 ms; warm-up 89–110 ms; con el forward medido harían falta 22 réplicas CPU para 500 req/s.',
      next: 'Hito 1, paso 1.4: POST /v1/classify + curl.',
    },
  ];
  p.decisions = DECISIONS.map(([date, stepId, what, against, why], i) => ({ id: `d${i + 1}`, date, stepId, what, against, why, status: 'vigente' }));
  // Última señal de trabajo en Caso1: app/main.py, modificado el 2026-10-23 19:36 (hora de la Mac, UTC−6).
  p.createdAt = '2026-10-12T23:04:54Z';
  p.lastActivity = '2026-10-24T01:36:00Z';
  p.updatedAt = p.lastActivity;
  for (const s of p.steps) s.updatedAt = STEP[s.id] ? p.lastActivity : p.createdAt;
  return p;
}
