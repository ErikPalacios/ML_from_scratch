// Generador de Dockerfile de la hoja de Docker: lógica pura, de las respuestas a tres textos (Dockerfile,
// .dockerignore y comandos de build y run). La MISMA fuente corre en tres lugares:
//   - node: generador.test.mjs (node --test) y gen-docker.mjs, que la importa;
//   - la página: gen-docker.mjs lee este archivo, le quita los `export` (toPageScript) y lo pega en el <script>;
//   - Chrome, en el build: los checks de presets y combinaciones otra vez, con la fuente que lleva la página.
// Reglas de esta fuente: sin import, sin APIs de node ni del DOM; cada `export` va al inicio de su línea.
//
//   1 · VERSIONES Y TAGS ........ fact-check aquí: cada tag con su fuente y la fecha en que se leyó
//   2 · PAQUETES DEL SISTEMA .... nombres de apt por distro (también para el fact-check)
//   3 · FRAGMENTOS .............. todo el texto que llega al Dockerfile, al .dockerignore y a los comandos
//   4 · PREGUNTAS ............... opciones de la interfaz, reglas de compatibilidad, valores por defecto, presets
//   5 · LÓGICA .................. normalize → derive → bloques → texto
//   6 · REVISOR, DIFF Y ESTADO .. las 16 reglas del revisor (mismo compilado que la página), diff por líneas, URL

// =====================================================================================================
// 1 · VERSIONES Y TAGS (leídos el 2026-10-28). Si cambias un tag, corre node --test generador.test.mjs.
// =====================================================================================================
export const VERSIONS = {
  checked: '2026-10-28',
  // Parser directive: la última 1.x estable del frontend de Dockerfile (docs.docker.com/reference/dockerfile).
  syntax: 'docker/dockerfile:1',
  // Imágenes oficiales de Python. El alias <minor>-slim apunta a Debian 13 (trixie); también existe -slim-bookworm.
  // Fuente: github.com/docker-library/official-images, library/python (líneas Tags:) y python.org/downloads
  // (3.12.16, 3.13.18 y 3.14.10 salieron el 2026-10-25). 3.15.2 ya existe y torch 2.15.0 ya publica cp315, pero no
  // todo el stack de ML: el generador llega a 3.14.
  python: {
    image: 'python',
    debian: 'trixie',
    debianVersion: '13',
    minors: ['3.12', '3.13', '3.14'],
    patch: { '3.12': '3.12.16', '3.13': '3.13.18', '3.14': '3.14.10' },
    // tamaño comprimido (amd64) de python:<minor>-slim; la misma cifra que la tabla de bolsillo de esta hoja
    slimMB: '43',
  },
  // Ubuntu de las bases de CUDA, PyTorch y NGC (todas 24.04 → Python 3.12 del sistema)
  ubuntu: '24.04',
  // uv: binario estático en una imagen sin sistema operativo. Fuente: docs.astral.sh/uv/guides/integration/docker
  // (la guía muestra 0.13.6) y pypi.org/project/uv (0.13.6, 2026-10-27).
  uv: { image: 'ghcr.io/astral-sh/uv', tag: '0.13.6' },
  // nvidia/cuda: Ubuntu 24.04 trae Python 3.12 (apt python3). 13.4.3 subió el 2026-10-17 en todas sus variantes
  // (base, runtime, devel, cudnn-runtime, cudnn-devel; también ubuntu22.04 y ubuntu26.04). cudnn-runtime trae cuDNN 9,
  // no TensorRT. Driver: la imagen fija NVIDIA_REQUIRE_CUDA=cuda>=13.4, o una de estas ramas solo en GPUs de datacenter
  // (cláusulas brand=tesla/nvidia/quadro/grid/rtx…, sin GeForce): R535, R570, R580, R590, R595 o R610. CUDA 13.4 va con
  // la rama R615 (notas de CUDA, tabla 2), así que GeForce pide R615+; CUDA 13.x corre con R580+ por compatibilidad de
  // versión menor (tabla 3), y en GeForce eso exige NVIDIA_DISABLE_REQUIRE=1.
  // Fuente: hub.docker.com/v2/repositories/nvidia/cuda/tags (y las capas de 13.4.3-cudnn-runtime-ubuntu24.04),
  // docs.nvidia.com/cuda/cuda-toolkit-release-notes y la guía del NVIDIA Container Toolkit (docker-specialized).
  cuda: {
    image: 'nvidia/cuda',
    version: '13.4.3',
    os: 'ubuntu24.04',
    python: '3.12',
    runtime: '13.4.3-cudnn-runtime-ubuntu24.04',
    devel: '13.4.3-cudnn-devel-ubuntu24.04',
    major: '13',
    requires: '13.4',
    driver: 'R615', // rama de CUDA 13.4: la que pide GeForce
    datacenter: ['R535', 'R570', 'R580', 'R590', 'R595', 'R610'], // ramas que acepta NVIDIA_REQUIRE_CUDA en datacenter
    minor: 'R580', // mínimo de CUDA 13.x por compatibilidad de versión menor
  },
  // pytorch/pytorch: torch 2.15.0+cu134 (del índice cu134; PyPI 2.15.0 salió el 2026-10-28) y cuDNN 9; Ubuntu 24.04,
  // Python 3.12 del sistema (torch en /usr/local/lib/python3.12), sin conda, sin USER (corre como root) y sin
  // NVIDIA_REQUIRE_CUDA: las librerías de CUDA 13 de los wheels corren con R580+ (compatibilidad de versión menor).
  // ≈ 3.3 GB comprimida (amd64). El torch 2.15.0 de PyPI fija CUDA 13.2 (cuda-toolkit==13.2.2, solo en Linux): un lock
  // compilado contra PyPI choca con el +cu134 de la base. También hay 2.15.0-cuda13.2-*.
  // Fuente: hub.docker.com/v2/repositories/pytorch/pytorch/tags y las capas de la imagen amd64 (2026-10-28); el
  // Dockerfile de release/2.15 en github.com/pytorch/pytorch; pypi.org/pypi/torch/2.15.0/json; download.pytorch.org/whl/cu134.
  pytorch: {
    image: 'pytorch/pytorch',
    torch: '2.15.0',
    wheel: '2.15.0+cu134',
    cuda: '13.4',
    pypiCuda: '13.2',
    driver: 'R580',
    runtime: '2.15.0-cuda13.4-cudnn9-runtime',
    python: '3.12',
    os: 'ubuntu24.04',
    sizeGB: '3.3',
  },
  // NGC PyTorch 26.09: Ubuntu 24.04, Python 3.12, CUDA 13.4.1, PyTorch 2.14.0a0+b2c75dd062; pip respeta
  // /etc/pip/constraint.txt. Fuente: docs.nvidia.com/deeplearning/frameworks/pytorch-release-notes/rel-26-09.html
  // y catalog.ngc.nvidia.com (nvidia/pytorch:26.09-py3).
  ngc: { image: 'nvcr.io/nvidia/pytorch', tag: '26.09-py3', python: '3.12', cuda: '13.4.1', torch: '2.14.0a0+b2c75dd062' },
  // Triton: 24.08 es la del C01 (reference/c01/triton/Dockerfile; Ubuntu 22.04, CUDA 12.6, TensorRT 10.3).
  // 26.09 es la última (Triton 2.73.0, CUDA 13.4.1, TensorRT 11.3, Ubuntu 24.04, Python 3.12).
  // Fuente: docs.nvidia.com/deeplearning/triton-inference-server/release-notes (rel-26-09) y catalog.ngc.nvidia.com.
  triton: {
    image: 'nvcr.io/nvidia/tritonserver',
    suffix: '-py3',
    releases: ['24.08', '26.09'],
    c01: '24.08',
    latest: '26.09',
    trt: { '24.08': '10.3', '26.09': '11.3' },
    // 24.08: Ubuntu 22.04 + CUDA 12.6 (módulo 5 del curso, notas de la release); 26.09: Ubuntu 24.04 + CUDA 13.4.1
    cuda: { '24.08': '12.6', '26.09': '13.4.1' },
    // usuario sin root que trae la imagen: triton-server, UID 1000 (guía de despliegue de Triton; build.py lo verifica)
    uid: 1000,
  },
  // distroless: solo Debian 13; Python 3.13.5 de Debian (/usr/bin/python y /usr/bin/python3 apuntan a python3.13;
  // el builder corre 3.13.18: misma versión menor y ABI); ENTRYPOINT ["/usr/bin/python3.13"]; tags móviles (latest,
  // nonroot, debug, debug-nonroot): se fija por digest. :nonroot corre como UID 65532 (con entrada en /etc/passwd,
  // HOME=/home/nonroot).
  // Fuente: github.com/GoogleContainerTools/distroless (README, python3/README.md y
  // examples/python3-requirements/Dockerfile, que arma el venv en python:3.13-slim-trixie).
  distroless: { image: 'gcr.io/distroless/python3-debian13', tag: 'nonroot', python: '3.13', pythonPatch: '3.13.5', entrypoint: '/usr/bin/python3.13', uid: 65532 },
};

// =====================================================================================================
// 2 · PAQUETES DEL SISTEMA (apt). Debian 13 (python slim) y Ubuntu 24.04 (CUDA, PyTorch, NGC) ya usan los
// nombres t64: libglib2.0-0 no existe en trixie (packages.debian.org); libglib2.0-0t64 sí, y también en noble.
// =====================================================================================================
export const PACKAGES = {
  // libGL y glib: lo que pide opencv-python (la variante -headless no los necesita)
  opencv: ['libgl1', 'libglib2.0-0t64'],
  ffmpeg: ['ffmpeg'],
  // compilar extensiones de C (solo en el builder)
  build: ['build-essential'],
  buildUbuntu: ['build-essential', 'python3-dev'],
  // Python del sistema en las bases de CUDA (Ubuntu 24.04 → 3.12); python3-venv para crear el venv con pip
  python: ['python3'],
  venv: ['python3-venv'],
  // PID 1 mínimo: /usr/bin/tini en Debian y en Ubuntu (universe)
  tini: ['tini'],
};

// =====================================================================================================
// 3 · FRAGMENTOS. Cada uno devuelve un bloque { i: instrucciones, b: comentario breve, d: detallado,
// k: comentario que se queda en todos los niveles (lo lee el revisor) }. Comentarios siempre en su línea.
// =====================================================================================================
const RULE = '# ' + '-'.repeat(64) + ' ';
const SVC_NAME = { api: 'API HTTP', worker: 'worker', train: 'entrenamiento', triton: 'Triton' };
// El driver lo pone el nodo, nunca la imagen; qué rama pide depende de la base (NVIDIA_REQUIRE_CUDA o los wheels).
const orList = (a) => a.join(', ').replace(/, ([^,]*)$/, ' o $1');
function driverLines(x) {
  const C = VERSIONS.cuda, P = VERSIONS.pytorch;
  if (x.base === 'cuda') return [
    `# El driver lo pone el nodo. Esta imagen exige CUDA ≥ ${C.requires} (NVIDIA_REQUIRE_CUDA): en GeForce, driver ${C.driver}+;`,
    `# en GPUs de datacenter también arranca con las ramas ${orList(C.datacenter)}`,
    '# (compatibilidad hacia adelante: cuda-compat viene en la imagen).',
  ];
  if (x.base === 'pytorch') return [`# El driver lo pone el nodo: las librerías de CUDA ${C.major} de los wheels corren con ${P.driver}+ (compatibilidad de versión menor).`];
  if (x.base === 'ngc') return [`# El driver lo pone el nodo. CUDA ${VERSIONS.ngc.cuda}: revisa la guía de compatibilidad de CUDA (en datacenter hay compatibilidad hacia adelante).`];
  if (x.base === 'slim' && x.gpu) return [
    `# GPU con python slim: el torch de PyPI trae su CUDA ${P.pypiCuda} en wheels (una sola copia, sin base de CUDA).`,
    `# El driver lo pone el nodo: ${P.driver}+ (compatibilidad de versión menor de CUDA ${C.major}), con el NVIDIA Container Toolkit.`,
  ];
  return [];
}
const jsonArr = (a) => '[' + a.map((s) => JSON.stringify(String(s))).join(', ') + ']';
// Lista exec en varias líneas: cada grupo en una línea, con \ y la sangría de la instrucción (como el C01).
function execLines(kw, groups) {
  const pad = ' '.repeat(kw.length + 2);
  const parts = groups.filter((g) => g.length).map((g) => g.map((s) => JSON.stringify(String(s))).join(', '));
  return parts.map((p, i) => (i === 0 ? `${kw} [` : pad) + p + (i === parts.length - 1 ? ']' : ', \\'));
}
// RUN con varios comandos unidos por &&, uno por línea
const runLines = (cmds, mounts = []) => {
  const head = mounts.length ? ['RUN ' + mounts[0], ...mounts.slice(1).map((m) => '    ' + m)] : [];
  const body = cmds.map((c, i) => (i === 0 && !head.length ? 'RUN ' : '    ') + c + (i < cmds.length - 1 ? ' && \\' : ''));
  return head.length ? [...head.map((l) => l + ' \\'), ...body] : body;
};
const envLines = (pairs) => pairs.map(([k, v], i) => (i === 0 ? 'ENV ' : '    ') + `${k}=${v}` + (i < pairs.length - 1 ? ' \\' : ''));
const aptRun = (pkgs) => runLines(['apt-get update', `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${pkgs.join(' ')}`, 'rm -rf /var/lib/apt/lists/*']);

export const FRAG = {
  syntax: () => `# syntax=${VERSIONS.syntax}`,

  header(x) {
    const hw = x.gpu ? 'GPU' : 'CPU';
    const b = [`# ${x.image}: ${SVC_NAME[x.svc]} en ${hw} · ${x.multi ? 'multi-stage (builder → runtime)' : 'una etapa'}`];
    if (x.svc === 'triton') {
      const d = x.weights === 'bake' ? [
        '# Imagen de Triton con el modelo HORNEADO: servidor + engine + config en una imagen',
        '# inmutable. El tag de la imagen ES la versión del modelo: desplegar, hacer canary o rollback es',
        '# cambiar un tag, y lo que probaste en staging es byte a byte lo que corre en producción.',
        '# Alternativa: --model-repository=s3://bucket/models (Triton lee S3 directo, credenciales vía IRSA).',
        '# Desacopla el modelo de la imagen (no reconstruyes para cambiarlo), a cambio de que el mismo tag',
        '# pueda servir contenidos distintos y de descargar el engine en cada arranque.',
      ] : x.weights === 'startup' ? [
        '# Imagen de Triton SIN el modelo: lee el model repository de S3 al arrancar (credenciales vía IRSA,',
        '# nunca en la imagen). Cambiar de modelo no pide otra imagen, pero el mismo tag puede servir',
        '# contenidos distintos: la versión del modelo tiene que quedar en los logs y en las métricas.',
      ] : [
        '# Imagen de Triton SIN el modelo: el model repository llega montado en /models (volumen o init',
        '# container). La imagen del servidor no cambia con cada modelo; el montaje es de solo lectura.',
      ];
      return { b, d };
    }
    const who = `# Imagen de ${x.image} (${SVC_NAME[x.svc]}, ${hw}).`;
    let d;
    if (x.base === 'distroless') d = [
      `${who} Multi-stage: la etapa "builder" arma un venv con pip y la final, distroless,`,
      '# recibe SOLO ese venv y el código: sin shell ni apt (pip solo queda dentro del venv). Menos CVEs y menos MB; para depurar,',
      '# kubectl debug con un contenedor efímero (o el tag :debug de la base).',
    ];
    else if (x.multi) d = [
      `${who} Multi-stage: la etapa "builder" instala dependencias en un venv y`,
      `# la final copia SOLO ese venv y el código. Resultado: sin ${x.pm === 'uv' ? 'uv ni su cache' : 'pip cache'}, sin compiladores ni headers,`,
      '# menos superficie de ataque y una imagen más chica que se descarga rápido al escalar.',
    ];
    else if (x.base === 'pytorch') d = [
      `${who} Una sola etapa sobre pytorch/pytorch: torch y sus librerías`,
      `# de CUDA ya vienen en la base (≈ ${VERSIONS.pytorch.sizeGB} GB comprimida, amd64); aquí solo se suma lo tuyo.`,
    ];
    else if (x.base === 'ngc') d = [
      `${who} Una sola etapa sobre el contenedor de PyTorch de NGC: CUDA,`,
      '# cuDNN, NCCL y torch probados juntos por NVIDIA; aquí solo se suma lo tuyo encima.',
    ];
    else if (x.base === 'cuda') d = [
      `${who} Una sola etapa sobre nvidia/cuda: CUDA y cuDNN de la base,`,
      `# Python del sistema (Ubuntu ${VERSIONS.ubuntu}) y un venv con tus dependencias.`,
    ];
    else d = [
      `${who} Una sola etapa: las dependencias son wheels y no hay nada`,
      '# que compilar, así que un builder no quitaría casi nada.',
    ];
    return { b, d };
  },

  stage: (n, name) => ({ b: [`${RULE}etapa ${n}: ${name}`], d: [`${RULE}etapa ${n}: ${name}`] }),

  // FROM de la etapa builder (multi-stage)
  fromBuilder(x) {
    const i = [`FROM ${x.builderRef} AS builder`];
    if (x.base === 'cuda') return {
      i,
      b: [x.compile ? '# Builder sobre CUDA devel (nvcc, headers): compila aquí y no viaja a la final' : `# Builder sobre la misma base que la final: CUDA ${VERSIONS.cuda.version} + cuDNN, Ubuntu 24.04`],
      d: x.compile ? [
        `# CUDA ${VERSIONS.cuda.version} devel: nvcc, headers y librerías estáticas para compilar extensiones. Solo vive`,
        '# en el builder: la final arranca de la variante runtime (varios GB menos) y recibe el venv ya armado.',
        ...driverLines(x),
      ] : [
        `# Misma base que la final (CUDA ${VERSIONS.cuda.version} + cuDNN, Ubuntu 24.04 con Python 3.12): el venv que se arma`,
        '# aquí apunta al mismo /usr/bin/python3 que tendrá la etapa final.',
        ...driverLines(x),
      ],
    };
    const pinD = x.pin === 'digest' ? [
      '# Base fijada por digest: el mismo commit da la misma imagen hoy y en seis meses.',
      '# Actualízalo con Renovate o Dependabot (abren un PR con el digest nuevo).',
    ] : x.pin === 'exact' ? [
      `# Versión exacta de Python y de Debian (${VERSIONS.python.debian}): el tag se vuelve a publicar con parches de Debian,`,
      '# así que en producción fija además el digest (@sha256:…) y actualízalo con Renovate o Dependabot.',
    ] : [`# Misma versión de Python que en los tests (${x.py}); en producción fija además el digest (@sha256:…)`];
    if (x.base === 'distroless') return {
      i,
      b: [`# Builder con el mismo Python que distroless (${x.py}, Debian ${VERSIONS.python.debianVersion}): el venv se copia tal cual`],
      d: [`# Mismo Python que la final distroless (${x.py}, Debian ${VERSIONS.python.debianVersion}): el venv se copia tal cual.`, ...pinD],
    };
    return {
      i,
      b: [`# Base: Python ${x.py} sobre Debian ${VERSIONS.python.debianVersion} (${VERSIONS.python.debian})${x.pin === 'digest' ? ', fijada por digest' : ''}${x.gpu ? '; la GPU, con el CUDA de los wheels de torch' : ''}`],
      d: [...pinD, ...driverLines(x)],
    };
  },

  // FROM de la etapa final (multi-stage) o de la única etapa
  fromFinal(x) {
    const as = x.multi ? ' AS runtime' : '';
    const i = [`FROM ${x.finalRef}${as}`];
    if (x.svc === 'triton') return {
      i,
      b: [`# Release ${x.tver} de NGC: el mismo YY.MM que el TensorRT que construyó el engine`],
      d: [
        '# Release de NGC: DEBE ser el mismo YY.MM que la imagen tensorrt usada para construir el engine',
        `# (misma versión de TensorRT${VERSIONS.triton.trt[x.tver] ? ', ' + VERSIONS.triton.trt[x.tver] : ''}). Un engine de otra versión no carga.`,
      ],
    };
    if (x.multi) {
      if (x.base === 'distroless') return {
        i,
        b: ['# distroless: Python y nada más; tags móviles, por eso va por digest'],
        d: [
          `# distroless de Debian ${VERSIONS.python.debianVersion}: Python en /usr/bin/python, sin shell ni gestor de paquetes. Solo publica tags`,
          '# móviles (latest, nonroot): el digest es lo que fija la versión.',
        ],
      };
      return { i }; // C01: la etapa final no lleva comentario propio
    }
    if (x.base === 'pytorch') return {
      i,
      b: [`# pytorch/pytorch: torch ${VERSIONS.pytorch.wheel} con CUDA y cuDNN, Python 3.12 del sistema (Ubuntu 24.04)`],
      d: [
        `# pytorch/pytorch:${VERSIONS.pytorch.runtime}: Ubuntu 24.04, Python 3.12 del sistema y torch ${VERSIONS.pytorch.torch}`,
        `# instalado (${VERSIONS.pytorch.wheel}) con sus librerías de CUDA ${VERSIONS.pytorch.cuda}. Tu requirements.txt no fija torch ni sus dependencias`,
        `# de CUDA de PyPI (cuda-toolkit, nvidia-*, triton): fijan CUDA ${VERSIONS.pytorch.pypiCuda} y pip bajaría otra copia de torch o fallaría por conflicto.`,
        '# Para fijar el resto contra la base: pip freeze dentro de ella → constraints.txt, y pip install -c constraints.txt.',
        ...driverLines(x),
      ],
    };
    if (x.base === 'ngc') return {
      i,
      b: [`# NGC ${VERSIONS.ngc.tag}: CUDA ${VERSIONS.ngc.cuda}, Python 3.12 y torch de NVIDIA ya instalados`],
      d: [
        `# ${VERSIONS.ngc.image}:${VERSIONS.ngc.tag}: Ubuntu 24.04, Python 3.12, CUDA ${VERSIONS.ngc.cuda} y torch ${VERSIONS.ngc.torch}.`,
        '# Es grande (trae compiladores y herramientas de entrenamiento): ideal para entrenar, pesada para servir.',
        ...driverLines(x),
      ],
    };
    if (x.base === 'cuda') return {
      i,
      b: [`# CUDA ${VERSIONS.cuda.version} + cuDNN (runtime) sobre Ubuntu 24.04; Python 3.12 del sistema`],
      d: [
        `# CUDA ${VERSIONS.cuda.version} + cuDNN 9, variante runtime: las librerías que piden onnxruntime-gpu o CuPy. TensorRT no viene`,
        '# aquí (wheel tensorrt o nvcr.io/nvidia/tensorrt). torch de PyPI trae sus propias librerías de CUDA: para torch,',
        '# la base de PyTorch o python slim evitan la copia doble.',
        ...driverLines(x),
      ],
    };
    const pinD = x.pin === 'digest' ? ['# Base fijada por digest: el mismo commit da la misma imagen hoy y en seis meses.']
      : x.pin === 'exact' ? [`# Versión exacta de Python y de Debian (${VERSIONS.python.debian}); en producción fija además el digest (@sha256:…)`]
        : [`# Python ${x.py} sobre Debian ${VERSIONS.python.debianVersion}; en producción fija además el digest (@sha256:…)`];
    return {
      i,
      b: [`# Base: Python ${x.py} sobre Debian ${VERSIONS.python.debianVersion} (${VERSIONS.python.debian})${x.gpu ? '; la GPU, con el CUDA de los wheels de torch' : ''}`],
      d: [...pinD, ...driverLines(x)],
    };
  },

  // apt en el builder: Python del sistema (CUDA) y/o herramientas para compilar
  aptBuilder(x, pkgs) {
    return {
      i: aptRun(pkgs),
      b: [x.compile ? '# Compiladores solo en el builder: no viajan a la imagen final' : `# Python ${VERSIONS.cuda.python} del sistema para crear el venv`],
      d: x.compile ? [
        '# Compiladores y headers SOLO en el builder: compilan lo que no tiene wheel y se quedan aquí.',
        '# Mismo RUN: update, install --no-install-recommends y borrar las listas de apt.',
      ] : [
        `# Python ${VERSIONS.cuda.python} de Ubuntu ${VERSIONS.ubuntu} y su módulo venv. Mismo RUN: update, install --no-install-recommends`,
        '# y borrar las listas de apt (en otro RUN no restaría un byte).',
      ],
    };
  },

  // apt en la etapa final: librerías de runtime, Python (CUDA) y tini
  aptFinal(x, pkgs) {
    const what = [];
    if (x.base === 'cuda') what.push(`Python ${VERSIONS.cuda.python} del sistema (el venv apunta a él)`);
    if (x.aptUser.length) what.push(x.apt === 'opencv' ? 'libGL y glib para OpenCV' : x.apt === 'ffmpeg' ? 'ffmpeg' : 'tus paquetes');
    if (x.init === 'tini') what.push('tini como PID 1');
    const d = [
      `# ${what.join(', ')}: --no-install-recommends y borrar las listas de apt`,
      '# en el MISMO RUN (en otro RUN no restaría un byte: las listas ya quedaron en esta capa).',
    ];
    if (x.apt === 'opencv') d.push('# libGL y glib son para opencv-python; con opencv-python-headless no hacen falta.');
    return { i: aptRun(pkgs), b: [`# ${what.join(', ')}`], d };
  },

  pipEnvBuilder(x) {
    if (x.cache) return {
      i: ['ENV PIP_DISABLE_PIP_VERSION_CHECK=1'],
      b: ['# El cache de pip vive en un cache mount de BuildKit, fuera de las capas'],
      d: ['# Sin PIP_NO_CACHE_DIR: el cache de pip vive en un cache mount de BuildKit, fuera de las capas'],
    };
    return {
      i: ['ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1'],
      b: ['# Sin cache de pip en las capas'],
      d: ['# PIP_NO_CACHE_DIR: el cache de pip no sirve dentro de una imagen, solo pesa'],
    };
  },

  venv(x, py, withPath = true) {
    const i = x.base === 'distroless'
      ? runLines(['ln -s /usr/local/bin/python /usr/bin/python', '/usr/bin/python -m venv /opt/venv'])
      : [`RUN ${py} -m venv /opt/venv`];
    return {
      i: [...i, ...(withPath ? ['ENV PATH="/opt/venv/bin:$PATH"'] : [])],
      b: [x.base === 'distroless' ? '# venv creado con /usr/bin/python: la ruta del Python de distroless' : '# venv en /opt/venv: se copia entero a la etapa final'],
      d: x.base === 'distroless' ? [
        '# El venv se crea con /usr/bin/python, la ruta del Python en distroless: sus enlaces siguen',
        '# siendo válidos cuando se copia a la etapa final (es lo que hace el ejemplo oficial de distroless).',
      ] : x.multi ? ['# venv en ruta fija: se copia entero a la etapa final y el PATH lo encuentra']
        : [`# venv en ruta fija: Ubuntu ${VERSIONS.ubuntu} marca su Python como externally-managed (PEP 668)`],
    };
  },

  depsCopy(x) {
    return {
      i: ['COPY requirements.txt .'],
      b: ['# Dependencias antes que el código: esta capa queda en cache'],
      d: [
        '# Primero SOLO requirements.txt: esta capa queda en cache mientras no cambien las dependencias,',
        '# así editar el código no reinstala las dependencias en cada build',
      ],
    };
  },

  pipInstall(x) {
    const flags = [x.hashes ? '--require-hashes' : '', x.wheels ? '--only-binary=:all:' : ''].filter(Boolean);
    const cmd = `${x.pipCmd} install ${flags.length ? flags.join(' ') + ' ' : ''}-r requirements.txt`;
    const i = x.cache ? runLines([cmd], [`--mount=type=cache,target=/root/.cache/pip`]) : [`RUN ${cmd}`];
    const b = [x.wheels ? '# Solo wheels: si falta una, el build falla aquí' : x.multi ? '# Lo que no tenga wheel se compila aquí, en el builder' : '# Lo que no tenga wheel se compila con el gcc que trae la base'];
    if (x.hashes) b.push('# --require-hashes: requirements.txt con --hash en cada línea (uv pip compile --generate-hashes)');
    const d = [];
    if (x.wheels) d.push(
      '# --only-binary: solo wheels precompilados; si falta uno, el build falla aquí en vez de intentar',
      '# compilar (y necesitar gcc) en silencio. Verifica que cada paquete tenga wheel para Linux x86_64',
      `# que sirva en ${x.cp} (${x.cp}, abi3 o py3-none-any).`,
    );
    else d.push(x.multi ? '# Sin --only-binary: lo que no tenga wheel se compila con el gcc del builder (la final no lo recibe).'
      : '# Sin --only-binary: lo que no tenga wheel se compila con el gcc que ya trae la base.');
    if (x.hashes) d.push('# --require-hashes: cada línea con su --hash (uv pip compile --generate-hashes): un paquete alterado no entra.');
    if (x.cache) d.push('# Cache mount: pip reusa lo que ya bajó en builds anteriores; el cache no queda en ninguna capa.');
    if (x.base === 'ngc') d.push('# pip respeta /etc/pip/constraint.txt de la base: no fijes otra versión de un paquete que ya trae.');
    if (x.base === 'pytorch') b.push('# torch ya está en la base: requirements.txt sin torch ni nvidia-*/cuda-toolkit/triton');
    if (x.cpuTorch) {
      d.push('# CPU y torch: el torch de PyPI en Linux trae CUDA (cuda-toolkit, cuDNN, NCCL: GB). En requirements.txt:',
        `# --extra-index-url https://download.pytorch.org/whl/cpu y torch==${VERSIONS.pytorch.torch}+cpu`);
      if (x.svc === 'train') b.push('# CPU: torch del índice whl/cpu (el de PyPI trae GB de CUDA)');
    }
    return { i, b, d };
  },

  uvCopy(x) {
    return {
      i: [`COPY --from=${x.uvRef} /uv /uvx /bin/`],
      b: [`# uv ${VERSIONS.uv.tag}, fijado: solo en el builder`],
      d: [`# uv ${VERSIONS.uv.tag} (binario estático): solo vive en el builder; la final recibe el venv, no uv.`],
    };
  },

  uvEnv(x) {
    const pairs = [['UV_COMPILE_BYTECODE', '1'], x.cache ? ['UV_LINK_MODE', 'copy'] : ['UV_NO_CACHE', '1'], ['UV_PYTHON_DOWNLOADS', '0'], ['UV_PROJECT_ENVIRONMENT', '/opt/venv']];
    return {
      i: envLines(pairs),
      b: ['# uv usa el Python de la base y escribe el venv en /opt/venv'],
      d: [
        '# UV_COMPILE_BYTECODE: compila los .pyc en el build (arranque más rápido; en runtime no se escribe nada)',
        x.cache ? '# UV_LINK_MODE=copy: el cache mount está en otro filesystem y uv no puede enlazar desde él (clone/hardlink): copiar evita el aviso'
          : '# UV_NO_CACHE: sin cache mount, el cache de uv no tiene por qué quedar en la capa',
        '# UV_PYTHON_DOWNLOADS=0: usa el Python de la base, nunca uno descargado',
        '# UV_PROJECT_ENVIRONMENT: el venv va a /opt/venv, como el de pip',
      ],
    };
  },

  uvSync(x) {
    const mounts = [];
    if (!x.multi) mounts.push(`--mount=from=${x.uvRef},source=/uv,target=/bin/uv`);
    if (x.cache) mounts.push('--mount=type=cache,target=/root/.cache/uv');
    mounts.push('--mount=type=bind,source=uv.lock,target=uv.lock', '--mount=type=bind,source=pyproject.toml,target=pyproject.toml');
    const cmd = `uv sync --locked --no-install-project --no-dev${x.wheels ? ' --no-build' : ''}`;
    const d = [
      '# Dependencias antes que el código: uv.lock y pyproject.toml entran como bind mounts (no quedan en la',
      '# imagen) y la capa se rehace solo si cambian. --locked: si uv.lock no coincide con pyproject.toml,',
      '# el build falla. --no-install-project: el código se copia aparte, como con pip.',
    ];
    if (x.wheels) d.push('# --no-build: solo wheels; un paquete sin wheel falla aquí en vez de compilarse en silencio.');
    if (!x.multi) d.push('# uv entra como mount desde su imagen: corre en este RUN y no queda en la imagen final.');
    const b = [`# uv.lock manda: --locked falla si no coincide con pyproject.toml${x.wheels ? '; --no-build, solo wheels' : ''}`];
    if (x.cpuTorch) {
      d.push('# CPU y torch: en pyproject.toml un índice pytorch-cpu (https://download.pytorch.org/whl/cpu,',
        '# explicit = true) y torch = [{ index = "pytorch-cpu" }] en [tool.uv.sources]');
      if (x.svc === 'train') b.push('# CPU: torch del índice whl/cpu (el de PyPI trae GB de CUDA)');
    }
    return { i: runLines([cmd], mounts), b, d };
  },

  downloadWeights(x) {
    const py = x.multi ? (x.pm === 'uv' ? '/opt/venv/bin/python' : 'python') : x.pyc;
    return {
      i: [
        'COPY download_weights.py .',
        ...runLines([`MODEL_DIR=/models ${py} download_weights.py`, `test -s ${x.modelCheck}`], ['--mount=type=secret,id=hf_token,env=HF_TOKEN,required=true', '--mount=type=cache,target=/root/.cache/huggingface']),
      ],
      b: ['# Pesos bajados en el build: el token entra como secreto, nunca como ARG; el cache de HF, fuera de la capa'],
      d: [
        '# Los pesos se bajan en el build con el token como SECRETO: existe solo durante este RUN, no queda en',
        '# ninguna capa ni en docker history (un ARG HF_TOKEN sí quedaría). required=true: sin el secreto, el build',
        '# falla aquí. Se pasa con docker buildx build --secret id=hf_token,env=HF_TOKEN.',
        '# download_weights.py: snapshot_download(repo, local_dir=MODEL_DIR); el token lo lee solo de HF_TOKEN.',
        '# No llames a login(): guarda el token en ~/.cache/huggingface/token. El cache mount deja fuera de la capa el',
        '# cache de HF: sin él, en una etapa los pesos quedarían dos veces (cache de HF + /models).',
      ],
    };
  },

  envFinal(x, pairs) {
    const d = [];
    if (pairs.some(([k]) => k === 'PYTHONDONTWRITEBYTECODE')) d.push('# PYTHONDONTWRITEBYTECODE: no escribe .pyc (el filesystem será read-only en k8s)');
    if (pairs.some(([k]) => k === 'PYTHONUNBUFFERED')) d.push('# PYTHONUNBUFFERED: cada línea de log sale al instante a stdout (si no, se pierde en un crash)');
    if (pairs.some(([k]) => k === 'PIP_NO_CACHE_DIR')) d.push('# PIP_NO_CACHE_DIR: el cache de pip no sirve dentro de una imagen, solo pesa');
    if (pairs.some(([k]) => k === 'PIP_BREAK_SYSTEM_PACKAGES')) d.push(
      '# PIP_BREAK_SYSTEM_PACKAGES: torch vive en el Python del sistema, que Ubuntu marca como externally-managed',
      '# (PEP 668); en una imagen de un solo proceso no hay paquetes del sistema que proteger.',
    );
    if (pairs.some(([k]) => k === 'UV_PROJECT_ENVIRONMENT')) d.push('# UV_*: uv usa el Python de la base, compila los .pyc en el build y deja el venv en /opt/venv');
    if (pairs.some(([k]) => k === 'MODEL_DIR')) d.push(x.weights === 'mount' ? '# MODEL_DIR: los pesos llegan montados aquí (solo lectura)'
      : x.weights === 'startup' ? '# MODEL_DIR: el proceso baja los pesos aquí al arrancar' : '# MODEL_DIR: dónde busca los pesos el proceso');
    const has = (k) => pairs.some(([n]) => n === k), parts = [];
    if (has('PYTHONUNBUFFERED') && has('PYTHONDONTWRITEBYTECODE')) parts.push('logs sin buffer y sin .pyc');
    else if (has('PYTHONUNBUFFERED')) parts.push('logs sin buffer');
    else if (has('PYTHONDONTWRITEBYTECODE')) parts.push('sin .pyc');
    if (has('PATH')) parts.push('el venv primero en el PATH');
    if (has('PIP_DISABLE_PIP_VERSION_CHECK')) parts.push(has('PIP_BREAK_SYSTEM_PACKAGES') ? 'pip sin cache, sobre el Python del sistema' : has('PIP_NO_CACHE_DIR') ? 'pip sin cache' : 'pip con cache mount');
    if (has('UV_PROJECT_ENVIRONMENT')) parts.push('uv con el Python de la base');
    if (has('MODEL_DIR')) parts.push('pesos en /models');
    const b = parts.length ? [`# ${parts.join('; ').replace(/^./, (ch) => ch.toUpperCase())}`] : [];
    return { i: envLines(pairs), b, d };
  },

  envExtra(x, pairs) {
    return {
      i: envLines(pairs),
      b: ['# Configuración no secreta (los secretos llegan en runtime: variables o Secrets)'],
      d: ['# Configuración no secreta. Nada de tokens ni contraseñas aquí: ENV queda en la config de la imagen.'],
    };
  },

  user(x) {
    const cmds = [`groupadd --system --gid ${x.uid} app`, `useradd --system --uid ${x.uid} --gid app ${x.home ? '--create-home' : '--no-create-home'} --shell /usr/sbin/nologin app`];
    if (x.weights === 'startup' && x.svc !== 'triton') cmds.push('mkdir -p /models && chown app:app /models');
    const d = [
      '# Usuario sin privilegios con UID numérico fijo: k8s puede verificar runAsNonRoot con un UID',
      '# (con un nombre de usuario no puede) y un escape del proceso no es root en el nodo',
    ];
    if (x.home) d.push('# --create-home: HOME=/home/app existe y es del usuario (cachés de Hugging Face, torch, triton);',
      '# con readOnlyRootFilesystem en k8s, móntale un emptyDir');
    if (x.weights === 'startup' && x.svc !== 'triton') d.push('# /models es del usuario: ahí escribe los pesos que baja al arrancar (en k8s, un emptyDir)');
    if (x.uid > 999) d.push(`# --system con ${x.uid}: useradd avisa que el UID pasa SYS_UID_MAX (999); es solo un aviso y el UID queda fijo.`);
    return { i: runLines(cmds), b: [`# Usuario sin privilegios con UID numérico (${x.uid})${x.home ? ' y HOME propio para los cachés' : ''}: runAsNonRoot lo puede verificar`], d };
  },

  workdir: (x) => ({ i: [`WORKDIR ${x.workdir}`] }),

  copyVenv: () => ({
    i: ['COPY --from=builder /opt/venv /opt/venv'],
    b: ['# Solo el venv: compiladores y caches se quedan en el builder'],
    d: ['# Solo el venv ya resuelto: compiladores, headers y caches de la etapa builder se quedan atrás'],
  }),

  copyCode(x) {
    const dirs = x.code.filter((p) => p.endsWith('/')), files = x.code.filter((p) => !p.endsWith('/'));
    const i = [...dirs.map((p) => `COPY ${p} ./${p}`), ...(files.length ? [`COPY ${files.join(' ')} ./`] : [])];
    return {
      i,
      b: ['# Código con dueño root: el proceso no puede modificarlo'],
      d: x.user !== 'uid' ? ['# El código va al final: un cambio de código solo rehace esta capa']
        : x.base === 'distroless' ? [`# El código queda con dueño root y solo lectura para el UID ${x.uid}: el proceso no puede modificarse`]
          : ['# El código queda con dueño root y solo lectura para "app": el proceso no puede modificarse'],
    };
  },

  modelBake(x) {
    if (x.svc === 'triton') return {
      i: [`COPY ${x.modelSrc} /models`],
      b: ['# El model repository completo, horneado'],
      d: [`# El model repository completo: ${x.modelPath.split('/')[0]}/config.pbtxt + ${x.modelPath}`],
    };
    if (x.base === 'distroless') return {
      i: ['COPY --from=builder /models /models'],
      b: ['# Los pesos, revisados en el builder (distroless no tiene shell para test)'],
      d: ['# Los pesos al final: una versión nueva del modelo cambia solo esta capa. Se revisaron en el builder.'],
    };
    return {
      i: [`COPY ${x.modelSrc} /models/`, `RUN test -s ${x.modelCheck}`],
      b: ['# Pesos en la última capa; el build falla si falta el archivo'],
      d: [
        '# Pesos HORNEADOS en la última capa: el tag de la imagen es la versión del modelo y una versión nueva',
        '# cambia solo esta capa. Falla el BUILD si falta el archivo: mejor aquí que un pod en CrashLoop.',
      ],
    };
  },

  modelCheck(x) {
    return {
      i: [`RUN test -f ${x.modelCheck}`],
      b: ['# El build falla si falta el engine'],
      d: ['# Falla el BUILD si falta el engine (no se versiona en git): mejor aquí que un pod en CrashLoop'],
    };
  },

  modelBakeBuilder(x) {
    return {
      i: [`COPY ${x.modelSrc} /models/`, `RUN test -s ${x.modelCheck}`],
      b: ['# Pesos revisados aquí: distroless no tiene shell para test'],
      d: ['# Los pesos pasan por el builder solo para revisarlos (distroless no tiene shell): falla el build si faltan'],
    };
  },

  copyModelsFromBuilder: () => ({
    i: ['COPY --from=builder /models /models'],
    b: ['# Los pesos bajados en el builder (el token se quedó allá)'],
    d: ['# Los pesos que bajó el builder. El secreto nunca estuvo en una capa de esta etapa.'],
  }),

  userNote(x) {
    return {
      k: [`# Sin USER: corre como root salvo que Kubernetes fije runAsUser: ${VERSIONS.triton.uid} (triton-server) y runAsNonRoot (securityContext)`],
      d: [
        '# Nota de seguridad: la imagen de NGC corre como root por defecto. En Kubernetes fija',
        `# runAsUser: ${VERSIONS.triton.uid} (triton-server, ya viene en la imagen) y runAsNonRoot en el securityContext si tu política lo exige.`,
      ],
    };
  },

  userRoot(x) {
    return {
      i: x.base === 'distroless' ? ['USER root'] : [],
      b: ['# Sin usuario propio: el proceso corre como root (el revisor lo marca)'],
      d: ['# Corre como root: si alguien toma el proceso, es root dentro del contenedor. El revisor lo marca.'],
    };
  },

  userSwitch(x) {
    if (x.triton) return {
      i: [`USER ${x.uid}`],
      b: [`# triton-server (UID ${x.uid}) ya viene en la imagen de Triton para correr sin root`],
      d: [`# triton-server (UID ${x.uid}) ya viene en la imagen de Triton para correr sin root: no hace falta crear otro.`],
    };
    if (x.base === 'distroless' && x.uid === VERSIONS.distroless.uid) return {
      i: [`USER ${x.uid}`],
      b: [`# nonroot de distroless (UID ${x.uid}): tiene entrada en /etc/passwd y HOME=/home/nonroot`],
      d: [`# nonroot de distroless (UID ${x.uid}): tiene entrada en /etc/passwd y HOME=/home/nonroot; otro UID quedaría sin HOME.`],
    };
    return { i: [`USER ${x.uid}`] };
  },

  expose(x) {
    const ports = x.ports.join(' ');
    const b = x.svc === 'triton' ? ['# 8000 HTTP · 8001 gRPC · 8002 métricas (no los publica)']
      : x.svc === 'worker' ? ['# Puerto de /metrics (lo lee Prometheus; no lo publica)']
        : x.svc === 'train' ? ['# Puerto del rank 0 con varios nodos (--master-port de torchrun; no lo publica)'] : ['# Documenta el puerto (no lo publica)'];
    const d = x.svc === 'triton' ? ['# 8000 HTTP/REST (KServe v2, lo usa el gateway) · 8001 gRPC · 8002 métricas Prometheus (nv_*)']
      : x.svc === 'worker' ? ['# Documenta el puerto de /metrics (no lo publica): lo lee el PodMonitor de Prometheus']
        : x.svc === 'train' ? [
          '# --master-port de torchrun (29500 por defecto, rendezvous estático): el rank 0 escucha aquí con varios nodos.',
          '# Es documentación: con rendezvous c10d el puerto por defecto es 29400, NCCL abre otros y el orquestador decide.',
        ]
          : ['# Documenta el puerto (no lo publica): el Service de k8s y compose apuntan aquí'];
    return { i: [`EXPOSE ${ports}`], b, d };
  },

  // Sin puerto (worker sin métricas, entrenamiento en un nodo): solo un comentario donde iría EXPOSE
  noPort(x) {
    return x.svc === 'worker' ? {
      b: ['# Sin EXPOSE: el worker no escucha ningún puerto'],
      d: ['# Sin EXPOSE: este worker no escucha ningún puerto (con métricas, sería el de /metrics).'],
    } : {
      b: ['# Sin EXPOSE: con un nodo, torchrun usa un rendezvous local'],
      d: ['# Sin EXPOSE: con un nodo, torchrun --standalone arma el rendezvous en local; el puerto aparece con varios nodos.'],
    };
  },

  healthHttp(x) {
    const opts = `--interval=10s --timeout=2s --start-period=${x.startPeriod}s --retries=3`;
    if (x.svc === 'triton') return {
      i: [`HEALTHCHECK ${opts} \\`, `    CMD ${jsonArr(['curl', '-fsS', 'http://127.0.0.1:8000/v2/health/ready'])}`],
      b: ['# Para docker run y compose; Kubernetes usa sus probes'],
      d: [
        '# HEALTHCHECK lo usan `docker run`/compose. Kubernetes lo IGNORA: allá mandan liveness/readiness',
        '# probes. ready = servidor arriba Y modelos cargados (con --strict-readiness). La imagen trae curl.',
      ],
    };
    const url = `http://127.0.0.1:${x.ports[0]}${x.hpath}`;
    return {
      i: [`HEALTHCHECK ${opts} \\`, `    CMD ${jsonArr([x.pyc, '-c', `import urllib.request; urllib.request.urlopen('${url}', timeout=1)`])}`],
      b: ['# Para docker run y compose; Kubernetes usa sus probes'],
      d: [
        '# HEALTHCHECK lo usan `docker run`/compose. Kubernetes lo IGNORA: allá mandan liveness/readiness',
        `# probes. ${x.base === 'distroless' ? 'Sin curl ni shell en distroless' : x.base === 'slim' ? 'Sin curl en la imagen slim' : 'Sin depender de curl'}, se usa Python (stdlib) para pegarle a ${x.hpath}.`,
      ],
    };
  },

  // NONE elegido en la interfaz, o puesto por el generador porque la base define un HEALTHCHECK que aquí no aplica
  healthNone(x, inherited) {
    if (inherited) return {
      i: ['HEALTHCHECK NONE'],
      b: ['# La base define un HEALTHCHECK que aquí no aplica: NONE lo apaga'],
      d: ['# La base define un HEALTHCHECK que este servicio no puede pasar (no sirve HTTP): NONE lo apaga.'],
    };
    return {
      i: ['HEALTHCHECK NONE'],
      b: ['# HEALTHCHECK NONE, elegido: apaga uno heredado y deja escrito que no hay chequeo'],
      d: [
        '# HEALTHCHECK NONE, elegido a propósito: apaga cualquier HEALTHCHECK que herede la base y deja escrito',
        '# que esta imagen no tiene chequeo de Docker (en Kubernetes mandan las probes).',
      ],
    };
  },

  healthOmit(x) {
    if (x.svc === 'triton') return {}; // como el C01: el chequeo va en compose o en las probes
    if (x.svc === 'worker') return {
      b: ['# Sin HEALTHCHECK: el worker no sirve HTTP; su salud la miden las métricas y las alertas'],
      d: ['# Sin HEALTHCHECK a propósito: el worker no sirve HTTP. Su salud la miden las métricas y las alertas (en k8s, las probes).'],
    };
    if (x.svc === 'train') return {
      b: ['# Sin HEALTHCHECK: un job de entrenamiento se mide por su estado y sus métricas'],
      d: ['# Sin HEALTHCHECK a propósito: un job de entrenamiento se mide por su estado (Completed o Failed) y sus métricas.'],
    };
    return {
      b: ['# Sin HEALTHCHECK: solo Kubernetes (usa sus probes); docker ps y compose no sabrán si responde'],
      d: ['# Sin HEALTHCHECK: solo para Kubernetes, que usa sus probes. docker ps y compose no sabrán si responde.'],
    };
  },

  labels(x) {
    const pairs = [['org.opencontainers.image.title', x.image], ...(x.source ? [['org.opencontainers.image.source', x.source]] : []), ['org.opencontainers.image.version', '$VERSION'], ['org.opencontainers.image.revision', '$GIT_SHA']];
    return {
      i: ['ARG VERSION=dev', 'ARG GIT_SHA=unknown', ...pairs.map(([k, v], n) => (n === 0 ? 'LABEL ' : '      ') + `${k}=${JSON.stringify(v)}` + (n < pairs.length - 1 ? ' \\' : ''))],
      b: ['# Etiquetas OCI: de qué repo y de qué commit sale la imagen'],
      d: [
        '# Etiquetas OCI: de qué repo y de qué commit sale la imagen (las leen el registry y los escáneres).',
        '# Los ARG van al final: un GIT_SHA nuevo no invalida el cache de las capas de arriba.',
      ],
    };
  },

  tini: () => ({
    i: [`ENTRYPOINT ${jsonArr(['tini', '--'])}`],
    b: ['# tini es el PID 1: reenvía SIGTERM al proceso y recoge zombis'],
    d: ['# tini como PID 1: reenvía el SIGTERM de docker stop o del kubelet al proceso y recoge zombis.'],
  }),

  cmd(x) {
    const kw = x.base === 'distroless' ? 'ENTRYPOINT' : 'CMD';
    if (x.svc === 'triton') {
      const repo = x.weights === 'startup' ? x.s3 : '/models';
      const args = [`--model-repository=${repo}`, '--model-control-mode=none', '--disable-auto-complete-config', '--exit-on-error=true', '--strict-readiness=true', '--http-port=8000', '--grpc-port=8001', '--metrics-port=8002', '--exit-timeout-secs=30', '--log-format=ISO8601'];
      return {
        i: execLines(kw, [['tritonserver'], ...args.map((a) => [a])]),
        b: ['# Un proceso en forma exec: tritonserver es el PID 1 y en SIGTERM espera hasta 30 s'],
        d: [
          `# Flags de tritonserver (según la documentación de la release ${x.tver}; confírmalos con`,
          '# `docker run --rm <imagen> tritonserver --help`):',
          '#   --model-control-mode=none         carga todo al arrancar y no cambia nada en caliente (imagen inmutable)',
          '#   --disable-auto-complete-config    usa config.pbtxt tal cual; nada de configuración inferida',
          '#   --exit-on-error=true              si el modelo no carga, el proceso muere → el pod reinicia y alerta',
          '#   --strict-readiness=true           /v2/health/ready solo da 200 si TODOS los modelos están listos',
          '#   --exit-timeout-secs=30            en SIGTERM espera hasta 30 s a que terminen las inferencias en curso',
          '#   --log-format=ISO8601              timestamps parseables por el agente de logs',
        ],
      };
    }
    const tiniD = x.init === 'tini' ? ['# Con tini adelante, este proceso es su hijo: tini le pasa el SIGTERM.'] : [];
    const distroD = kw === 'ENTRYPOINT' ? [`# ENTRYPOINT y no CMD: la base distroless trae ENTRYPOINT ["${VERSIONS.distroless.entrypoint}"] y un CMD solo se le sumaría como argumentos.`] : [];
    if (x.svc === 'api') {
      const base = ['uvicorn', x.app, '--host', '0.0.0.0', '--port', String(x.ports[0]), '--workers', String(x.workers)];
      const extra = [...(x.flags.keepalive ? ['--timeout-keep-alive', '75'] : []), ...(x.flags.noaccess ? ['--no-access-log'] : []), ...(x.flags.graceful ? ['--timeout-graceful-shutdown', '20'] : [])];
      const d = x.workers === 1 ? [
        '# 1 proceso por contenedor (--workers 1): en k8s escalas con réplicas (HPA), cada pod con su',
        '# request de CPU, su métrica de /metrics y su probe. Varios workers en un pod esconden fallas,',
        '# duplican memoria y rompen prometheus_client sin modo multiproceso.',
      ] : [
        `# --workers ${x.workers}: ${x.workers} procesos en un contenedor. En k8s suele ir mejor --workers 1 y más réplicas:`,
        '# varios workers en un pod esconden fallas, duplican memoria y rompen prometheus_client sin modo multiproceso.',
      ];
      if (x.gpu) d.push('# En GPU, cada proceso carga su copia del modelo en la VRAM.');
      if (x.flags.keepalive) d.push(
        '#   --timeout-keep-alive 75   mayor que el idle timeout del ALB (60 s): si el backend cierra primero,',
        '#                             el ALB reusa una conexión muerta y el cliente ve 502 esporádicos',
      );
      if (x.flags.noaccess) d.push('#   --no-access-log           la app ya escribe una línea JSON por request; el access log duplicaría');
      if (x.flags.graceful) d.push('#   --timeout-graceful-shutdown 20  en SIGTERM termina los requests en curso (< terminationGracePeriodSeconds)');
      return {
        i: execLines(kw, [base, extra]),
        b: [`# Un proceso en forma exec: uvicorn ${x.init === 'tini' ? 'corre bajo tini' : 'es el PID 1'} y recibe el SIGTERM`],
        d: [...distroD, ...d, ...tiniD],
      };
    }
    if (x.svc === 'worker') return {
      i: execLines(kw, [[x.pyc, '-m', x.app]]),
      b: [x.init === 'exec' ? '# Forma exec: python es el PID 1; el worker tiene que atrapar SIGTERM' : '# Forma exec: python recibe el SIGTERM y termina el mensaje en curso'],
      d: [...distroD,
        ...(x.init === 'exec' ? [
          '# Forma exec: python es el PID 1 y recibe el SIGTERM de docker stop o del kubelet. Al PID 1 el kernel',
          '# le descarta las señales sin handler: el worker tiene que atrapar SIGTERM (terminar el mensaje en',
          '# curso y salir) o usar tini / docker run --init.',
        ] : ['# Forma exec: python recibe el SIGTERM; que termine el mensaje en curso y salga antes del grace period.']),
        ...tiniD],
    };
    // train: con un nodo, --standalone (rendezvous local); con varios, el orquestador pasa nodos y rank 0
    const multi = x.nodes === 'multi', nproc = `--nproc-per-node=${x.gpu ? 'gpu' : '1'}`;
    return {
      i: execLines(kw, [['torchrun', ...(multi ? [] : ['--standalone']), nproc, x.app]]),
      b: [multi ? '# torchrun en varios nodos: el orquestador le pasa --nnodes, --node-rank y el rank 0'
        : x.gpu ? '# torchrun --standalone: un nodo, un proceso por GPU' : '# torchrun --standalone: un nodo, un proceso (CPU)'],
      d: [...distroD,
        ...(multi ? [
          `# torchrun lanza ${x.gpu ? 'un proceso por GPU (--nproc-per-node=gpu)' : 'un proceso'} en cada nodo. Con varios nodos, el orquestador (PyTorchJob,`,
          '# JobSet) le pasa --nnodes, --node-rank y la dirección del rank 0, como argumentos o como variables de entorno.',
        ] : [
          `# torchrun --standalone: un nodo y rendezvous local; lanza ${x.gpu ? 'un proceso por GPU (--nproc-per-node=gpu)' : 'un proceso'}.`,
        ]),
        '# En SIGTERM detiene a sus procesos: guarda checkpoints seguido.',
        ...tiniD],
    };
  },
};

// .dockerignore: grupos de patrones con su comentario (breve y detallado)
export const IGNORE = {
  head: {
    b: '# Fuera del contexto de build: builds más rápidos y nada de secretos ni basura en la imagen',
    d: '# Lo que NO entra al contexto de build: builds más rápidos y sin filtrar basura ni secretos a la imagen',
  },
  groups: [
    { id: 'vcs', b: '# Control de versiones, editores y el sistema', d: '# Control de versiones, editores y archivos del sistema (macOS)', p: ['.git/', '.gitignore', '.vscode/', '.idea/', '**/.DS_Store'] },
    { id: 'py', b: '# Artefactos locales de Python', d: '# Artefactos locales de Python en cualquier carpeta: se regeneran, y un venv de macOS no sirve en Linux', p: ['**/__pycache__/', '**/*.pyc', '**/.pytest_cache/', '.venv/', 'venv/'] },
    { id: 'tests', b: '# Tests: corren en CI antes del build', d: '# Tests y su config: no corren en producción (se corren en CI antes del build)', p: ['tests/', 'pytest.ini'] },
    { id: 'secrets', b: '# Secretos locales, en cualquier carpeta: jamás en una imagen', d: '# Secretos locales en cualquier carpeta (**/): jamás dentro de una imagen (se inyectan como env/Secret en runtime)', p: ['**/.env', '**/.env.*', '**/*.pem', '**/*.key'] },
    { id: 'nb', b: '# Notebooks', d: '# Notebooks y sus checkpoints: exploración, no producción', p: ['**/*.ipynb', '**/.ipynb_checkpoints/'] },
    { id: 'data', b: '# Datos y resultados de entrenamiento: llegan montados', d: '# Datos, checkpoints y logs de experimentos: llegan montados o de S3, nunca en la imagen', p: ['data/', 'datasets/', 'checkpoints/', 'outputs/', 'runs/', 'wandb/', 'mlruns/'] },
    { id: 'models', b: '# Modelos en cualquier carpeta', d: '# Pesos y engines en cualquier carpeta (**/): GB que no hacen falta en esta imagen', p: ['**/*.onnx', '**/*.plan', '**/*.pt', '**/*.pth', '**/*.ckpt', '**/*.safetensors'] },
  ],
  keep: { b: '# …salvo los pesos que sí van en la imagen', d: '# …salvo el directorio de pesos que esta imagen sí lleva (la última regla que coincide gana)' },
};

// Comandos de build y run (pestaña Build & run)
export const CMDS = {
  build: '# 1 · Build para los nodos (linux/amd64), con el commit como tag; en un Mac con Apple Silicon se emula',
  secret: '#     HF_TOKEN tiene que estar en tu entorno (de tu gestor de secretos); --secret no lo deja en la imagen',
  run: (x) => {
    if (!x.gpu) return '# 2 · Correr';
    const need = x.triton ? 'driver compatible con la release' : x.base === 'cuda' ? `la imagen pide CUDA ≥ ${VERSIONS.cuda.requires}: GeForce con ${VERSIONS.cuda.driver}+, datacenter con ${orList(VERSIONS.cuda.datacenter)}`
      : x.base === 'ngc' ? `driver compatible con CUDA ${VERSIONS.ngc.cuda} (guía de compatibilidad de CUDA)` : `driver ${VERSIONS.pytorch.driver}+`;
    return `# 2 · Correr en Linux con GPU NVIDIA y el NVIDIA Container Toolkit; ${need}`;
  },
  geforce: `#     GeForce con driver ${VERSIONS.cuda.minor}–${VERSIONS.cuda.datacenter[VERSIONS.cuda.datacenter.length - 1]}: -e NVIDIA_DISABLE_REQUIRE=1 (corre por compatibilidad de versión menor)`,
  shm: (x) => x.svc === 'train' ? '#     --shm-size: los DataLoader con num_workers > 0 usan /dev/shm (64 MB por defecto)' : '#     --shm-size: Triton usa /dev/shm; los 64 MB por defecto se quedan cortos',
  test: '# 3 · Probar (en otra terminal)',
  data: '#     Datos y checkpoints, montados (no en la imagen): -v "$PWD/data:/data:ro" -v "$PWD/checkpoints:/checkpoints"',
  digest: '# Digest de cada base: la línea Digest: es lo que va después de @',
  init: '#     --init: tini como PID 1 (en compose, init: true)',
  creds: '#     Credenciales de S3: -e NOMBRE sin =valor pasa la de tu shell sin escribirla; en k8s, IRSA. Nunca en la imagen',
  aws: ['-e AWS_ACCESS_KEY_ID', '-e AWS_SECRET_ACCESS_KEY', '-e AWS_SESSION_TOKEN', '-e AWS_DEFAULT_REGION'],
  lock: (x) => [`# 0 · Lock con hashes para el contenedor (Linux x86_64, Python ${x.py}), también desde un Mac`,
    `uv pip compile requirements.in --generate-hashes --python-version ${x.py} --python-platform linux -o requirements.txt`],
  cpuTorch: (x) => x.pm === 'uv' ? '#     CPU y torch: torch del índice pytorch-cpu en pyproject.toml ([tool.uv.sources]); el de PyPI trae GB de CUDA'
    : '#     CPU y torch: --extra-index-url https://download.pytorch.org/whl/cpu en requirements.txt; el de PyPI trae GB de CUDA',
};

// =====================================================================================================
// 4 · PREGUNTAS. Orden = orden de la interfaz y de normalize(): una opción solo depende de respuestas
// anteriores. why(c, v) devuelve la razón por la que v no aplica ('' si aplica).
// =====================================================================================================
const isPy = (c) => c.svc !== 'triton';
const noHttp = (c) => c.svc === 'worker' || c.svc === 'train';
// ¿La imagen base define un HEALTHCHECK? Revisado el 2026-10-28: ninguna. python:3.13-slim, nvidia/cuda:13.4.3-cudnn-runtime
// y pytorch/pytorch:2.15.0 (capas en Docker Hub), tritonserver (build.py de triton-inference-server/server), nvidia/pytorch
// (capas en el catálogo de NGC) y distroless (sin HEALTHCHECK documentado). Si alguna lo definiera, un worker o un
// entrenamiento recibiría HEALTHCHECK NONE para apagarlo (no sirven HTTP).
export const BASE_HEALTHCHECK = { slim: false, distroless: false, cuda: false, pytorch: false, ngc: false, triton: false };
const GPU_BASES = ['cuda', 'pytorch', 'ngc'];
const PY_FIXED = { distroless: VERSIONS.distroless.python, cuda: VERSIONS.cuda.python, pytorch: VERSIONS.pytorch.python, ngc: VERSIONS.ngc.python };

export const SCHEMA = [
  { id: 'servicio', label: 'Servicio', qs: [
    { k: 'svc', label: 'Tipo', type: 'seg', opts: [
      { v: 'api', l: 'API HTTP', h: 'FastAPI + uvicorn, un proceso por contenedor' },
      { v: 'worker', l: 'Worker / batch', h: 'Lee de una cola; expone /metrics' },
      { v: 'train', l: 'Entrenamiento', h: 'torchrun; termina al acabar' },
      { v: 'triton', l: 'Triton', h: 'Model server de NVIDIA, como el del C01' },
    ] },
  ] },
  { id: 'base', label: 'Base', qs: [
    { k: 'hw', label: 'Hardware', type: 'seg', opts: [
      { v: 'cpu', l: 'CPU', h: 'Sin CUDA en la imagen (torch: el índice whl/cpu)' },
      { v: 'gpu', l: 'GPU NVIDIA', h: 'Corre con --gpus; el driver lo pone el nodo' },
    ], why: (c, v) => (c.svc === 'triton' && v === 'cpu' ? 'Triton aquí sirve en GPU, como en el C01' : '') },
    { k: 'base', label: 'Imagen base', type: 'seg', opts: [
      { v: 'slim', l: 'python slim', h: (c) => (c.hw === 'gpu' ? `El torch de PyPI trae CUDA (una sola copia); driver ${VERSIONS.pytorch.driver}+`
        : `Debian ${VERSIONS.python.debianVersion} + Python oficial (≈ ${VERSIONS.python.slimMB} MB comprimida)`) },
      { v: 'distroless', l: 'distroless', h: `Sin shell ni apt; Python ${VERSIONS.distroless.python} de Debian` },
      { v: 'cuda', l: 'CUDA', h: `nvidia/cuda ${VERSIONS.cuda.version} + cuDNN; Python ${VERSIONS.cuda.python} de Ubuntu` },
      { v: 'pytorch', l: 'PyTorch', h: `pytorch/pytorch: torch ${VERSIONS.pytorch.torch} + CUDA listos` },
      { v: 'ngc', l: 'NGC PyTorch', h: `nvcr.io/nvidia/pytorch:${VERSIONS.ngc.tag}: el stack completo` },
      { v: 'triton', l: 'tritonserver', h: 'nvcr.io/nvidia/tritonserver (NGC)' },
    ], why: (c, v) => {
      if (c.svc === 'triton') return v === 'triton' ? '' : 'Triton fija la base';
      if (v === 'triton') return 'Solo para el servicio Triton';
      if (c.hw === 'gpu' && v === 'distroless') return 'GPU: usa python slim, CUDA, PyTorch o NGC';
      if (c.hw === 'cpu' && GPU_BASES.includes(v)) return 'CPU: estas bases cargan GB de CUDA que no usas';
      return '';
    } },
    { k: 'tver', label: 'Release de Triton', type: 'seg', show: (c) => c.svc === 'triton', opts: VERSIONS.triton.releases.map((r) => ({
      v: r, l: r === VERSIONS.triton.c01 ? `${r} · C01` : r === VERSIONS.triton.latest ? `${r} · última` : r,
      h: `TensorRT ${VERSIONS.triton.trt[r]}, CUDA ${VERSIONS.triton.cuda[r]}: el mismo YY.MM que el TensorRT del engine`,
    })) },
    { k: 'py', label: 'Python', type: 'seg', show: isPy, opts: VERSIONS.python.minors.map((v) => ({ v, l: v, h: '' })),
      why: (c, v) => (PY_FIXED[c.base] && v !== PY_FIXED[c.base] ? `La base trae ${PY_FIXED[c.base]}` : '') },
    { k: 'pin', label: 'Versión de la base', type: 'seg', opts: [
      { v: 'minor', l: 'tag de versión', h: 'python:3.13-slim: recibe parches solo' },
      { v: 'exact', l: 'tag exacto', h: `python:${VERSIONS.python.patch['3.13']}-slim-${VERSIONS.python.debian}` },
      { v: 'digest', l: '+ digest', h: '@sha256: la misma imagen byte a byte' },
    ], why: (c, v) => {
      if (c.base === 'distroless' && v !== 'digest') return 'distroless solo tiene tags móviles: fija el digest';
      if (v === 'minor' && c.base !== 'slim' && c.base !== 'distroless') return 'Esta base solo publica tags exactos';
      return '';
    } },
  ] },
  { id: 'deps', label: 'Dependencias', show: isPy, note: 'Triton ya trae todo: no hay dependencias de Python', qs: [
    { k: 'pm', label: 'Gestor', type: 'seg', opts: [
      { v: 'pip', l: 'pip + requirements.txt', h: 'Fijado con == (pip-compile o uv pip compile)' },
      { v: 'uv', l: 'uv + uv.lock', h: `uv ${VERSIONS.uv.tag}: sync --locked, el lock manda` },
    ], why: (c, v) => {
      if (v !== 'uv') return '';
      if (c.base === 'pytorch' || c.base === 'ngc') return 'torch vive en el Python del sistema de la base: usa pip';
      if (c.base === 'distroless') return 'distroless: el venv se arma con pip sobre /usr/bin/python';
      return '';
    } },
    { k: 'stages', label: 'Etapas', type: 'seg', opts: [
      { v: 'multi', l: 'multi-stage', h: 'builder → runtime: solo el venv cruza' },
      { v: 'single', l: 'una etapa', h: 'Todo en la imagen final' },
    ], why: (c, v) => {
      if (v === 'single' && c.base === 'distroless') return 'Sin shell en distroless: el venv se arma en un builder';
      if (v === 'multi' && (c.base === 'pytorch' || c.base === 'ngc')) return 'torch ya está en la base: un builder no quita nada';
      return '';
    } },
    { k: 'wheels', label: 'Compilación', type: 'seg', opts: [
      { v: 'yes', l: 'solo wheels', h: 'Si falta una wheel, el build falla' },
      { v: 'no', l: 'compilar si falta', h: 'gcc solo donde haga falta' },
    ], why: (c, v) => (v === 'no' && c.stages === 'single' && (c.base === 'slim' || c.base === 'cuda') ? 'En una etapa, gcc quedaría en la imagen final: usa multi-stage' : '') },
    { k: 'hashes', label: 'Hashes', type: 'seg', show: (c) => c.pm === 'pip', opts: [
      { v: 'no', l: '== sin hashes', h: 'Versiones fijas' },
      { v: 'yes', l: '--require-hashes', h: 'Cada línea con su --hash (uv pip compile --generate-hashes)' },
    ] },
    { k: 'cache', label: 'Cache de BuildKit', type: 'seg', opts: [
      { v: 'no', l: 'sin cache mount', h: 'Sin cache en las capas' },
      { v: 'yes', l: 'cache mount', h: 'Reusa descargas entre builds, fuera de las capas' },
    ] },
  ] },
  { id: 'sistema', label: 'Sistema', show: isPy, note: 'Triton: la imagen de NGC ya trae lo que usa', qs: [
    { k: 'apt', label: 'Paquetes apt', type: 'seg', opts: [
      { v: 'none', l: 'ninguno', h: 'Las wheels traen sus librerías' },
      { v: 'opencv', l: 'OpenCV', h: 'libgl1 + glib, para opencv-python' },
      { v: 'ffmpeg', l: 'ffmpeg', h: 'Video: decodificar o recortar' },
      { v: 'custom', l: 'lista', h: 'Tus paquetes, separados por espacios' },
    ], why: (c, v) => (v !== 'none' && c.base === 'distroless' ? 'distroless no tiene shell ni apt' : '') },
    { k: 'aptList', label: 'Paquetes', type: 'text', show: (c) => c.apt === 'custom', ph: 'libpq5 curl' },
  ] },
  { id: 'modelo', label: 'Modelo', qs: [
    { k: 'weights', label: 'Pesos', type: 'seg', opts: [
      { v: 'none', l: 'sin modelo', h: 'Llama a otro servicio, como el gateway del C01' },
      { v: 'bake', l: 'en la imagen', h: 'COPY desde el contexto: el tag es la versión del modelo' },
      { v: 'build', l: 'bajados en el build', h: 'El token como secreto: --mount=type=secret' },
      { v: 'startup', l: 'al arrancar', h: 'De S3 o Hugging Face; credenciales en runtime' },
      { v: 'mount', l: 'montados', h: 'Volumen o init container, solo lectura' },
    ], why: (c, v) => {
      if (c.svc === 'triton' && v === 'none') return 'Triton necesita un model repository';
      if (c.svc === 'triton' && v === 'build') return 'Triton: el engine se construye antes del build y entra con COPY';
      if (c.base === 'distroless' && v === 'startup') return 'distroless no puede preparar /models (sin shell): móntalos';
      return '';
    } },
    { k: 'modelPath', label: 'Archivo que tiene que existir', type: 'text', show: (c) => c.weights === 'bake' || c.weights === 'build', ph: (c) => defModelPath(c) },
    { k: 's3', label: 'Model repository en S3', type: 'text', show: (c) => c.svc === 'triton' && c.weights === 'startup', ph: 's3://mi-bucket/model_repository' },
  ] },
  { id: 'runtime', label: 'Runtime', qs: [
    { k: 'user', label: 'Usuario', type: 'seg', opts: [
      { v: 'uid', l: 'UID numérico', h: (c) => (c.svc === 'triton' ? `USER ${VERSIONS.triton.uid}: triton-server ya viene en la imagen` : 'USER con número: runAsNonRoot lo verifica') },
      { v: 'k8s', l: 'runAsUser en k8s', h: 'La imagen de NGC corre como root; k8s lo cambia' },
      { v: 'root', l: 'root', h: 'Corre como root: el revisor lo marca', flag: 'sin-user' },
    ], why: (c, v) => (v === 'k8s' && c.svc !== 'triton' ? 'Solo para Triton: tu imagen fija su USER' : '') },
    { k: 'uid', label: 'UID', type: 'num', show: (c) => c.user === 'uid' && c.svc !== 'triton', ph: (c) => String(defUid(c)) },
    { k: 'port', label: 'Puerto', type: 'num', show: (c) => c.svc === 'api', ph: '8080' },
    { k: 'metrics', label: 'Métricas', type: 'seg', show: (c) => c.svc === 'worker', opts: [
      { v: 'no', l: 'no', h: 'Sin puerto: no hay nada que exponer' },
      { v: 'yes', l: '/metrics en :9100', h: 'prometheus_client sirve /metrics; EXPOSE 9100 lo documenta' },
    ] },
    { k: 'nodes', label: 'Nodos', type: 'seg', show: (c) => c.svc === 'train', opts: [
      { v: 'single', l: 'un nodo', h: 'torchrun --standalone: rendezvous local, sin puerto' },
      { v: 'multi', l: 'varios nodos', h: 'El rank 0 escucha en 29500 (--master-port): EXPOSE 29500' },
    ] },
    { k: 'app', label: (c) => (c.svc === 'api' ? 'App ASGI' : c.svc === 'worker' ? 'Módulo (python -m)' : 'Script'), type: 'text', show: isPy, ph: (c) => defApp(c) },
    { k: 'code', label: 'Código a copiar', type: 'text', show: isPy, ph: (c) => defCode(c) },
    { k: 'workers', label: 'Workers de uvicorn', type: 'num', show: (c) => c.svc === 'api', ph: '1' },
    { k: 'flags', label: 'uvicorn', type: 'checks', show: (c) => c.svc === 'api', opts: [
      { v: 'keepalive', l: 'keep-alive 75 s', h: 'Detrás de un ALB (idle timeout de 60 s)' },
      { v: 'noaccess', l: 'sin access log', h: 'La app ya loguea cada request' },
      { v: 'graceful', l: 'graceful 20 s', h: 'Termina lo que está en curso en SIGTERM' },
    ] },
    { k: 'health', label: 'HEALTHCHECK', type: 'seg', opts: [
      { v: 'http', l: 'HTTP', h: 'Para docker run y compose; k8s usa probes' },
      { v: 'none', l: 'NONE', h: 'Explícito: deja escrito que no hay chequeo y apaga uno heredado' },
      { v: 'omit', l: 'omitir', h: (c) => (noHttp(c) ? 'Sin endpoint HTTP, no hace falta' : c.base === 'ngc' || c.base === 'triton' ? 'El chequeo va en compose o en las probes, como el C01' : 'Solo k8s; el revisor avisa'),
        flag: (c) => (c.svc === 'api' && c.base !== 'ngc' ? 'sin-healthcheck' : '') },
    ], why: (c, v) => (v === 'http' && noHttp(c) ? 'Solo para un servicio HTTP' : '') },
    { k: 'hpath', label: 'Ruta de salud', type: 'text', show: (c) => c.svc === 'api' && c.health === 'http', ph: '/healthz' },
    { k: 'init', label: 'PID 1', type: 'seg', opts: [
      { v: 'exec', l: 'el proceso', h: 'Forma exec: tu proceso maneja SIGTERM' },
      { v: 'tini', l: 'tini', h: 'PID 1 mínimo dentro de la imagen' },
      { v: 'docker', l: 'docker --init', h: 'tini lo pone Docker al correr (init: true en compose)' },
    ], why: (c, v) => {
      if (v !== 'tini') return '';
      if (c.base === 'distroless') return 'distroless no tiene apt: usa docker --init';
      if (c.base === 'cuda' || c.base === 'ngc' || c.base === 'triton') return 'La base ya tiene ENTRYPOINT (nvidia_entrypoint.sh): usa docker --init';
      return '';
    } },
    { k: 'env', label: 'Variables de Python', type: 'checks', show: isPy, opts: [
      { v: 'unbuf', l: 'PYTHONUNBUFFERED', h: 'Logs al instante' },
      { v: 'nopyc', l: 'PYTHONDONTWRITEBYTECODE', h: 'Sin .pyc en runtime' },
    ] },
    { k: 'envx', label: 'Otras ENV (CLAVE=valor)', type: 'area', ph: 'LOG_LEVEL=info' },
  ] },
  { id: 'meta', label: 'Metadata y salida', qs: [
    { k: 'image', label: 'Nombre de la imagen', type: 'text', ph: 'mi-servicio' },
    { k: 'labels', label: 'Etiquetas OCI', type: 'seg', opts: [
      { v: 'no', l: 'no', h: '' },
      { v: 'yes', l: 'sí', h: 'title, source, version y revision' },
    ] },
    { k: 'source', label: 'Repositorio', type: 'text', show: (c) => c.labels === 'yes', ph: 'https://github.com/mi-org/mi-servicio' },
    { k: 'comments', label: 'Comentarios', type: 'seg', opts: [
      { v: 'none', l: 'ninguno', h: '' },
      { v: 'brief', l: 'breves', h: 'Una línea por bloque' },
      { v: 'detailed', l: 'detallados', h: 'El porqué de cada línea, como el C01' },
    ] },
  ] },
];

export const DEFAULTS = {
  svc: 'api', hw: 'cpu', base: 'slim', tver: VERSIONS.triton.latest, py: '3.13', pin: 'minor',
  pm: 'pip', stages: 'multi', wheels: 'yes', hashes: 'no', cache: 'no',
  apt: 'none', aptList: '',
  weights: 'none', modelPath: '', s3: '',
  user: 'uid', uid: '', port: '', metrics: 'no', nodes: 'single', app: '', code: '', workers: '',
  flags: ['graceful'], health: 'http', hpath: '', init: 'exec', env: ['unbuf', 'nopyc'], envx: '',
  image: '', labels: 'no', source: '', comments: 'brief', digests: {},
};

export const PRESETS = [
  { id: 'c01-gateway', label: 'C01 · gateway (FastAPI, CPU)', cfg: {
    image: 'classifier-gateway', flags: ['keepalive', 'noaccess', 'graceful'],
  } },
  { id: 'c01-triton', label: 'C01 · Triton (GPU)', cfg: {
    svc: 'triton', hw: 'gpu', base: 'triton', tver: VERSIONS.triton.c01, pin: 'exact', weights: 'bake', user: 'k8s', health: 'omit', image: 'classifier-triton',
  } },
  { id: 'gpu-api', label: 'API de inferencia en GPU (PyTorch + CUDA)', cfg: {
    hw: 'gpu', base: 'pytorch', py: VERSIONS.pytorch.python, pin: 'exact', stages: 'single', weights: 'bake', image: 'gpu-inference',
    flags: ['graceful'],
  } },
  { id: 'worker-cpu', label: 'Worker batch (CPU)', cfg: {
    svc: 'worker', weights: 'startup', init: 'tini', metrics: 'yes', image: 'batch-worker',
  } },
  { id: 'blank', label: 'En blanco / por defecto', cfg: {} },
];

// valores por defecto que dependen del servicio (un campo vacío usa estos)
function defApp(c) { return c.svc === 'api' ? 'app.main:app' : c.svc === 'worker' ? 'worker' : 'train/main.py'; }
function defCode(c) { return c.svc === 'api' ? 'app/' : c.svc === 'worker' ? 'worker/' : 'train/'; }
function defUid(c) { return c.base === 'distroless' ? VERSIONS.distroless.uid : 10001; }
function defModelPath(c) { return c.svc === 'triton' ? 'classifier/1/model.plan' : c.weights === 'build' ? 'model.safetensors' : 'model.pt'; }

// =====================================================================================================
// 5 · LÓGICA
// =====================================================================================================
const SEG_KEYS = [];
const QUESTIONS = [];
SCHEMA.forEach((g) => g.qs.forEach((q) => { QUESTIONS.push({ ...q, group: g }); if (q.type === 'seg') SEG_KEYS.push(q.k); }));
export const QMAP = Object.fromEntries(QUESTIONS.map((q) => [q.k, q]));
const FALLBACK = {
  base: (c) => (c.svc === 'triton' ? 'triton' : c.hw === 'gpu' ? 'pytorch' : 'slim'),
  health: (c) => (noHttp(c) ? 'omit' : 'http'),
  pin: (c) => (c.base === 'distroless' ? 'digest' : 'exact'),
};

const RE = {
  asgi: /^[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*:[A-Za-z_]\w*$/,
  mod: /^[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*$/,
  script: /^[\w-]+(?:\/[\w.-]+)*\.py$/,
  path: /^[A-Za-z0-9_][\w.-]*(?:\/[\w.-]+)*\/?$/,
  file: /^[A-Za-z0-9_][\w.-]*(?:\/[\w.-]+)*$/,
  image: /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/,
  url: /^https:\/\/[^\s"'\\]+$/,
  hpath: /^\/[\w.\-/]*$/,
  s3: /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](?:\/[\w.\-/]*)?$/,
  digest: /^sha256:[a-f0-9]{64}$/,
  apt: /^[a-z0-9][a-z0-9+.-]+(?:=[\w.+~:-]+)?$/,
  envk: /^[A-Za-z_][A-Za-z0-9_]*$/,
};
const int = (s, lo, hi) => { const t = String(s ?? '').trim(); if (!/^\d+$/.test(t)) return null; const n = Number(t); return n >= lo && n <= hi ? n : null; };
const RESERVED_ENV = new Set(['PATH', 'PYTHONUNBUFFERED', 'PYTHONDONTWRITEBYTECODE', 'MODEL_DIR', 'PIP_NO_CACHE_DIR', 'PIP_DISABLE_PIP_VERSION_CHECK', 'PIP_BREAK_SYSTEM_PACKAGES', 'UV_COMPILE_BYTECODE', 'UV_LINK_MODE', 'UV_NO_CACHE', 'UV_PYTHON_DOWNLOADS', 'UV_PROJECT_ENVIRONMENT']);

// La regla del revisor que una opción dispara a propósito ('' si ninguna): root, sin HEALTHCHECK, sin puerto.
export function optionFlag(c, k, v) { const o = QMAP[k] && QMAP[k].opts && QMAP[k].opts.find((x) => x.v === v); return !o || !o.flag ? '' : typeof o.flag === 'function' ? o.flag(c) : o.flag; }
// El espacio de combinaciones: cada pregunta de opciones, en el orden de la interfaz, con las opciones que se ven y
// aplican; sin las que el revisor marca a propósito, salvo flagged = true. Una pregunta escondida no ramifica.
export function space(flagged = false) {
  const segs = QUESTIONS.filter((q) => q.type === 'seg' && q.k !== 'comments');
  const out = [];
  const rec = (i, c) => {
    if (i === segs.length) { out.push({ ...c }); return; }
    const q = segs[i];
    if (!isShown(c, q.k)) { rec(i + 1, c); return; }
    for (const o of q.opts) if (!optionReason(c, q.k, o.v) && (flagged || !optionFlag(c, q.k, o.v))) rec(i + 1, { ...c, [q.k]: o.v });
  };
  rec(0, { ...DEFAULTS, flags: DEFAULTS.flags.slice(), env: DEFAULTS.env.slice(), digests: {} });
  return out;
}
export function optionReason(c, k, v) { const q = QMAP[k]; return q && q.why ? q.why(c, v) || '' : ''; }
export function isShown(c, k) { const q = QMAP[k]; if (!q) return false; if (q.group.show && !q.group.show(c)) return false; return !q.show || q.show(c); }

// Lleva cualquier entrada (preset, URL, localStorage) a una configuración válida: valores conocidos, sin
// opciones que no aplican (cada pregunta, en orden, cae a su alternativa) y textos revisados (errs).
export function normalize(input) {
  const c = { ...DEFAULTS, ...(input || {}) };
  const errs = {};
  for (const k of SEG_KEYS) {
    const q = QMAP[k];
    if (!q.opts.some((o) => o.v === c[k])) c[k] = DEFAULTS[k];
    if (q.why && q.why(c, c[k])) {
      const pref = FALLBACK[k] ? FALLBACK[k](c) : null;
      const ok = q.opts.map((o) => o.v).filter((v) => !q.why(c, v));
      c[k] = ok.includes(pref) ? pref : ok.includes(DEFAULTS[k]) ? DEFAULTS[k] : ok[0];
    }
  }
  if (PY_FIXED[c.base]) c.py = PY_FIXED[c.base];
  for (const k of ['flags', 'env']) {
    const vals = QMAP[k].opts.map((o) => o.v);
    c[k] = Array.isArray(c[k]) ? vals.filter((v) => c[k].includes(v)) : DEFAULTS[k].slice();
  }
  const text = (k) => String(c[k] ?? '').trim();
  for (const k of ['aptList', 'modelPath', 's3', 'uid', 'port', 'app', 'code', 'workers', 'hpath', 'envx', 'image', 'source']) c[k] = String(c[k] ?? '').replace(/\r/g, '').slice(0, 2000);
  if (!c.digests || typeof c.digests !== 'object' || Array.isArray(c.digests)) c.digests = {};
  else c.digests = Object.fromEntries(Object.entries(c.digests).filter(([r, d]) => typeof r === 'string' && typeof d === 'string' && r.length < 200).map(([r, d]) => [r, d.trim().toLowerCase()]));
  // textos: si no sirven, se usa el valor por defecto y la interfaz muestra el error
  const v = {};
  v.uid = text('uid') === '' ? defUid(c) : int(c.uid, 1, 2147483647);
  if (v.uid === null) { errs.uid = int(c.uid, 0, 0) === 0 ? '0 es root: elige root arriba' : 'Un número entre 1 y 2147483647'; v.uid = defUid(c); }
  v.port = text('port') === '' ? 8080 : int(c.port, 1, 65535);
  if (v.port === null) { errs.port = 'Un puerto entre 1 y 65535'; v.port = 8080; }
  v.workers = text('workers') === '' ? 1 : int(c.workers, 1, 64);
  if (v.workers === null) { errs.workers = 'Entre 1 y 64'; v.workers = 1; }
  const appRe = c.svc === 'api' ? RE.asgi : c.svc === 'worker' ? RE.mod : RE.script;
  v.app = text('app') || defApp(c);
  if (!appRe.test(v.app)) { errs.app = c.svc === 'api' ? 'Formato módulo:objeto, como app.main:app' : c.svc === 'worker' ? 'Un módulo de Python, como worker' : 'Una ruta a un .py, como train/main.py'; v.app = defApp(c); }
  const codeToks = text('code') ? text('code').split(/\s+/) : defCode(c).split(/\s+/);
  const badCode = codeToks.filter((p) => !RE.path.test(p) || /(^|\/)\.\.?(\/|$)/.test(p));
  if (badCode.length) errs.code = `Rutas relativas al contexto, sin . ni ..: ${badCode.join(' ')}`;
  v.code = [...new Set(codeToks.filter((p) => !badCode.includes(p)))];
  if (!v.code.length) v.code = defCode(c).split(/\s+/);
  v.modelPath = text('modelPath') || defModelPath(c);
  if (!RE.file.test(v.modelPath) || /(^|\/)\.\.?(\/|$)/.test(v.modelPath)) { errs.modelPath = 'Una ruta relativa, como model.pt'; v.modelPath = defModelPath(c); }
  if (c.svc === 'triton' && !/^[\w.-]+\/\d+\/[\w.-]+$/.test(v.modelPath)) { errs.modelPath = 'modelo/versión/archivo, como classifier/1/model.plan'; v.modelPath = defModelPath(c); }
  v.s3 = text('s3') || 's3://mi-bucket/model_repository';
  if (!RE.s3.test(v.s3)) { errs.s3 = 'Una URL s3://bucket/ruta'; v.s3 = 's3://mi-bucket/model_repository'; }
  v.hpath = text('hpath') || '/healthz';
  if (!RE.hpath.test(v.hpath)) { errs.hpath = 'Una ruta que empieza con /'; v.hpath = '/healthz'; }
  v.image = text('image') || 'mi-servicio';
  if (!RE.image.test(v.image)) { errs.image = 'Minúsculas, números, . _ - y /; sin tag'; v.image = 'mi-servicio'; }
  v.source = text('source') || 'https://github.com/mi-org/mi-servicio';
  if (!RE.url.test(v.source)) { errs.source = 'Una URL https://'; v.source = 'https://github.com/mi-org/mi-servicio'; }
  const aptToks = text('aptList') ? text('aptList').split(/\s+/) : [];
  const badApt = aptToks.filter((p) => !RE.apt.test(p));
  if (badApt.length) errs.aptList = `No parecen paquetes de apt: ${badApt.join(' ')}`;
  v.aptList = [...new Set(aptToks.filter((p) => RE.apt.test(p)))];
  v.envx = [];
  const badEnv = [];
  String(c.envx || '').split('\n').forEach((line, n) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const m = t.match(/^([^=\s]+)=(.*)$/);
    if (!m || !RE.envk.test(m[1])) { badEnv.push(`línea ${n + 1}`); return; }
    if (RESERVED_ENV.has(m[1])) { badEnv.push(`${m[1]} ya lo maneja el generador`); return; }
    if (v.envx.some(([k]) => k === m[1])) return;
    const val = m[2].trim(), q = val.match(/^"(.*)"$|^'(.*)'$/); // unas comillas que rodean todo el valor son del usuario, no del valor
    v.envx.push([m[1], q ? (q[1] ?? q[2]) : val]);
  });
  if (badEnv.length) errs.envx = `Usa CLAVE=valor, una por línea (${badEnv.join(', ')})`;
  const badDigest = Object.entries(c.digests).filter(([, d]) => d && !RE.digest.test(d)).map(([r]) => r);
  if (badDigest.length) errs.digests = `sha256: y 64 caracteres hex (${badDigest.join(', ')})`;
  return { cfg: c, val: v, errs };
}

// Lo que el generador necesita, ya resuelto (imágenes, comandos, rutas).
export function derive(input) {
  const { cfg: c, val: v, errs } = normalize(input);
  const x = { cfg: c, errs, svc: c.svc, gpu: c.hw === 'gpu', base: c.base, py: c.py, tver: c.tver, pin: c.pin };
  x.cp = 'cp' + c.py.replace('.', '');
  x.triton = c.svc === 'triton';
  x.multi = !x.triton && c.stages === 'multi';
  x.pm = x.triton ? null : c.pm;
  x.wheels = c.wheels === 'yes';
  x.compile = !x.triton && !x.wheels;
  x.hashes = x.pm === 'pip' && c.hashes === 'yes';
  x.cache = c.cache === 'yes';
  x.venv = !x.triton && (x.pm === 'uv' || c.base === 'distroless' || c.base === 'cuda' || (c.base === 'slim' && x.multi));
  x.pyc = c.base === 'pytorch' || c.base === 'ngc' ? 'python3' : 'python';
  x.pipCmd = c.base === 'pytorch' || c.base === 'ngc' ? 'python3 -m pip' : 'pip';
  x.digests = c.digests;
  const P = VERSIONS.python;
  const slimRef = (exact) => (exact ? `python:${P.patch[c.py]}-slim-${P.debian}` : `python:${c.py}-slim`);
  const tags = [];
  const ref = (img) => { if (!tags.includes(img)) tags.push(img); return c.pin === 'digest' ? `${img}@${c.digests[img] && RE.digest.test(c.digests[img]) ? c.digests[img] : 'sha256:<digest>'}` : img; };
  if (x.triton) x.finalRef = ref(`${VERSIONS.triton.image}:${c.tver}${VERSIONS.triton.suffix}`);
  else if (c.base === 'slim') { x.builderRef = x.multi ? ref(slimRef(c.pin !== 'minor')) : null; x.finalRef = ref(slimRef(c.pin !== 'minor')); }
  else if (c.base === 'distroless') { x.builderRef = ref(slimRef(true)); x.finalRef = ref(`${VERSIONS.distroless.image}:${VERSIONS.distroless.tag}`); }
  else if (c.base === 'cuda') { x.builderRef = x.multi ? ref(`${VERSIONS.cuda.image}:${x.compile ? VERSIONS.cuda.devel : VERSIONS.cuda.runtime}`) : null; x.finalRef = ref(`${VERSIONS.cuda.image}:${VERSIONS.cuda.runtime}`); }
  else if (c.base === 'pytorch') x.finalRef = ref(`${VERSIONS.pytorch.image}:${VERSIONS.pytorch.runtime}`);
  else x.finalRef = ref(`${VERSIONS.ngc.image}:${VERSIONS.ngc.tag}`);
  if (x.pm === 'uv') x.uvRef = ref(`${VERSIONS.uv.image}:${VERSIONS.uv.tag}`);
  x.images = tags;
  x.digestsMissing = c.pin === 'digest' ? tags.filter((t) => !(c.digests[t] && RE.digest.test(c.digests[t]))) : [];
  x.ubuntu = c.base === 'cuda' || c.base === 'pytorch' || c.base === 'ngc' || x.triton;
  x.apt = c.apt;
  x.aptUser = x.triton || c.base === 'distroless' ? [] : c.apt === 'opencv' ? PACKAGES.opencv : c.apt === 'ffmpeg' ? PACKAGES.ffmpeg : c.apt === 'custom' ? v.aptList : [];
  x.init = c.init;
  x.weights = c.weights;
  x.modelPath = v.modelPath;
  x.modelSrc = x.triton ? 'model_repository' : 'model/';
  x.modelCheck = `/models/${v.modelPath}`;
  x.s3 = v.s3;
  x.user = c.user;
  x.uid = x.triton ? VERSIONS.triton.uid : v.uid;
  // HOME propio para los cachés (Hugging Face, torch, triton) en imágenes de ML; el gateway del C01 no lo necesita
  x.home = !x.triton && c.base !== 'distroless' && (c.base === 'cuda' || c.base === 'pytorch' || c.base === 'ngc' || c.svc === 'train' || c.weights !== 'none');
  // CPU con torch probable (entrenamiento o pesos en el proceso): el torch de PyPI trae GB de CUDA
  x.cpuTorch = !x.triton && !x.gpu && (c.svc === 'train' || c.weights !== 'none');
  x.nodes = c.nodes;
  x.ports = x.triton ? [8000, 8001, 8002] : c.svc === 'api' ? [v.port] : c.svc === 'worker' ? (c.metrics === 'yes' ? [9100] : []) : (c.nodes === 'multi' ? [29500] : []);
  x.app = v.app;
  x.code = v.code;
  x.workers = v.workers;
  x.flags = { keepalive: c.flags.includes('keepalive'), noaccess: c.flags.includes('noaccess'), graceful: c.flags.includes('graceful') };
  x.health = c.health;
  // un HEALTHCHECK heredado que no aplica (servicio sin HTTP) se apaga solo; ninguna base actual lo define
  x.healthInherited = c.health === 'omit' && !!BASE_HEALTHCHECK[c.base] && noHttp(c);
  x.hpath = v.hpath;
  x.startPeriod = x.triton || c.weights !== 'none' ? 60 : 10;
  x.envOn = { unbuf: c.env.includes('unbuf'), nopyc: c.env.includes('nopyc') };
  x.envx = v.envx;
  x.image = v.image;
  x.labels = c.labels === 'yes';
  x.source = v.source;
  x.comments = c.comments;
  x.workdir = '/srv';
  return x;
}

// Bloques del Dockerfile, en orden. gap: línea en blanco antes (entre etapas en multi-stage, entre grupos en una etapa).
function blocks(x) {
  const out = [];
  const add = (blk, gap) => { if (blk && (blk.i?.length || blk.b?.length || blk.d?.length || blk.k?.length)) out.push({ ...blk, gap: !!gap }); };
  const G = !x.multi; // en una etapa, cada grupo lleva una línea en blanco antes
  add(FRAG.header(x));
  if (x.triton) {
    add(FRAG.fromFinal(x), true);
    if (x.weights === 'bake') { add(FRAG.modelBake(x), true); add(FRAG.modelCheck(x), true); }
    add(FRAG.expose(x), true);
    if (x.user === 'k8s') add(FRAG.userNote(x), true);
    if (x.user === 'root') add(FRAG.userRoot(x), true);
    if (x.user === 'uid') add(FRAG.userSwitch(x), true);
    addHealth(x, add, true);
    if (x.labels) add(FRAG.labels(x), true);
    add(FRAG.cmd(x), true);
    return out;
  }
  if (x.multi) {
    add(FRAG.stage(1, 'builder'), true);
    add(FRAG.fromBuilder(x));
    const bApt = [];
    if (x.base === 'cuda') bApt.push(...PACKAGES.python, ...(x.pm === 'pip' ? PACKAGES.venv : []));
    if (x.compile) bApt.push(...(x.base === 'cuda' ? PACKAGES.buildUbuntu : PACKAGES.build));
    if (bApt.length) add(FRAG.aptBuilder(x, [...new Set(bApt)]));
    if (x.pm === 'pip') {
      add(FRAG.pipEnvBuilder(x));
      add(FRAG.venv(x, x.base === 'cuda' ? 'python3' : 'python'));
      add(FRAG.depsCopy(x));
      add(FRAG.pipInstall(x));
    } else {
      add(FRAG.uvCopy(x));
      add(FRAG.uvEnv(x));
      add({ i: ['WORKDIR /app'] });
      add(FRAG.uvSync(x));
    }
    if (x.weights === 'build') add(FRAG.downloadWeights(x));
    if (x.weights === 'bake' && x.base === 'distroless') add(FRAG.modelBakeBuilder(x));
    add(FRAG.stage(2, 'runtime'), true);
  }
  add(FRAG.fromFinal(x), G);
  const fApt = [];
  if (x.base === 'cuda') fApt.push(...PACKAGES.python, ...(!x.multi && x.pm === 'pip' ? PACKAGES.venv : []));
  fApt.push(...x.aptUser);
  if (x.init === 'tini') fApt.push(...PACKAGES.tini);
  if (fApt.length) add(FRAG.aptFinal(x, [...new Set(fApt)]), G);
  // ENV de la etapa final
  const env = [];
  if (x.envOn.nopyc) env.push(['PYTHONDONTWRITEBYTECODE', '1']);
  if (x.envOn.unbuf) env.push(['PYTHONUNBUFFERED', '1']);
  if (x.venv) env.push(['PATH', x.base === 'distroless' ? '"/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"' : '"/opt/venv/bin:$PATH"']);
  if (!x.multi && x.pm === 'pip') {
    if (!x.cache) env.push(['PIP_NO_CACHE_DIR', '1']);
    env.push(['PIP_DISABLE_PIP_VERSION_CHECK', '1']);
    if (x.base === 'pytorch' || x.base === 'ngc') env.push(['PIP_BREAK_SYSTEM_PACKAGES', '1']);
  }
  if (!x.multi && x.pm === 'uv') env.push(['UV_COMPILE_BYTECODE', '1'], x.cache ? ['UV_LINK_MODE', 'copy'] : ['UV_NO_CACHE', '1'], ['UV_PYTHON_DOWNLOADS', '0'], ['UV_PROJECT_ENVIRONMENT', '/opt/venv']);
  if (x.weights !== 'none') env.push(['MODEL_DIR', '/models']);
  if (env.length) add(FRAG.envFinal(x, env), G);
  if (x.envx.length) add(FRAG.envExtra(x, x.envx.map(([k, val]) => [k, quoteEnv(val)])));
  if (x.user === 'uid' && x.base !== 'distroless') add(FRAG.user(x), G);
  add(FRAG.workdir(x), G);
  if (x.multi) add(FRAG.copyVenv(x));
  else if (x.pm === 'pip') {
    if (x.base === 'cuda') add(FRAG.venv(x, 'python3', false), G);
    add(FRAG.depsCopy(x), G);
    add(FRAG.pipInstall(x));
  } else add(FRAG.uvSync(x), G);
  if (!x.multi && x.weights === 'build') add(FRAG.downloadWeights(x), G);
  add(FRAG.copyCode(x), G);
  if (x.weights === 'bake') add(FRAG.modelBake(x), G);
  if (x.multi && x.weights === 'build') add(FRAG.copyModelsFromBuilder(x), G);
  if (x.user === 'root') add(FRAG.userRoot(x), G);
  if (x.user === 'uid') add(FRAG.userSwitch(x), G);
  if (x.ports.length) add(FRAG.expose(x), G);
  else if (x.svc === 'worker' || x.svc === 'train') add(FRAG.noPort(x), G);
  addHealth(x, add, G);
  if (x.labels) add(FRAG.labels(x), G);
  if (x.init === 'tini') add(FRAG.tini(x), G);
  add(FRAG.cmd(x), G);
  return out;
}
function addHealth(x, add, gap) {
  if (x.health === 'http') add(FRAG.healthHttp(x), gap);
  else if (x.health === 'none') add(FRAG.healthNone(x, false), gap);
  else if (x.healthInherited) add(FRAG.healthNone(x, true), gap);
  else add(FRAG.healthOmit(x), gap);
}
// Valor de ENV: entre comillas si lleva espacios, comillas, # o \ (así el # nunca parece un comentario)
function quoteEnv(s) { return /^[\w./:@%+,?=&-]*$/.test(s) ? s : JSON.stringify(s); }

function render(bl, level) {
  const lines = [FRAG.syntax()];
  let gap = false; // un bloque sin texto en este nivel (el separador de etapa sin comentarios) pasa su hueco al siguiente
  bl.forEach((b, n) => {
    const cm = level === 'detailed' ? (b.d || b.b || b.k || []) : level === 'brief' ? (b.b || b.k || []) : (b.k || []);
    const body = [...cm, ...(b.i || [])];
    gap = gap || b.gap || n === 1;
    if (!body.length) return;
    if (gap && lines.length > 1 && lines[lines.length - 1] !== '') lines.push('');
    gap = false;
    lines.push(...body);
  });
  return lines.join('\n') + '\n';
}

// ¿Este patrón de .dockerignore deja fuera esta ruta (o una carpeta que la contiene)?
const IGN_RE = new Map();
export function ignoreMatches(pattern, path) {
  let re = IGN_RE.get(pattern);
  if (!re) { re = ignoreRegex(pattern); IGN_RE.set(pattern, re); }
  const parts = path.replace(/\/$/, '').split('/');
  for (let n = parts.length; n >= 1; n--) if (re.test(parts.slice(0, n).join('/'))) return true;
  return false;
}
function ignoreRegex(pattern) {
  const pat = pattern.replace(/^\//, '').replace(/\/$/, '');
  let rx = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '*' && pat[i + 1] === '*') { rx += '.*'; i++; if (pat[i + 1] === '/') { rx = rx.slice(0, -2) + '(?:.*/)?'; i++; } }
    else if (ch === '*') rx += '[^/]*';
    else if (ch === '?') rx += '[^/]';
    else rx += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + rx + '$');
}
// ¿Queda excluida la ruta después de todas las reglas (la última que coincide gana; ! vuelve a incluir)?
export function ignored(patterns, path) {
  let out = false;
  for (const p of patterns) { if (!p || p.startsWith('#')) continue; const neg = p.startsWith('!'); if (ignoreMatches(neg ? p.slice(1) : p, path)) out = !neg; }
  return out;
}
// Lo que el Dockerfile copia del contexto (para que el .dockerignore nunca lo deje fuera)
export function contextInputs(x) {
  if (x.triton) return x.weights === 'bake' ? [`model_repository/${x.modelPath}`] : [];
  const out = x.pm === 'uv' ? ['uv.lock', 'pyproject.toml'] : ['requirements.txt'];
  out.push(...x.code.map((p) => p.replace(/\/$/, '')));
  if (x.weights === 'bake') out.push(`model/${x.modelPath}`);
  if (x.weights === 'build') out.push('download_weights.py');
  return out;
}

function renderIgnore(x) {
  const lvl = x.comments, out = [];
  if (lvl !== 'none') out.push(IGNORE.head[lvl === 'detailed' ? 'd' : 'b']);
  const want = ['vcs', 'py', 'tests', 'secrets', 'nb'];
  if (x.svc === 'train') want.push('data');
  want.push('models');
  const inputs = contextInputs(x);
  for (const g of IGNORE.groups.filter((gr) => want.includes(gr.id))) {
    let pats = g.p.slice();
    if (g.id === 'tests' && x.pm === 'pip') pats.push('requirements-dev.txt');
    // un patrón que deja fuera algo que el Dockerfile copia se cae (salvo los modelos: se re-incluye su carpeta)
    if (g.id !== 'models') pats = pats.filter((p) => !inputs.some((f) => ignoreMatches(p, f)));
    if (!pats.length) continue;
    if (lvl !== 'none') out.push(g[lvl === 'detailed' ? 'd' : 'b']);
    out.push(...pats);
  }
  if (x.weights === 'bake') {
    if (lvl !== 'none') out.push(IGNORE.keep[lvl === 'detailed' ? 'd' : 'b']);
    out.push(x.triton ? '!model_repository/**' : '!model/**');
  }
  return out.join('\n') + '\n';
}

function renderCommands(x) {
  const L = [];
  const name = x.image.split('/').pop();
  if (x.hashes) L.push(...CMDS.lock(x), '');
  L.push(CMDS.build);
  if (x.cpuTorch) L.push(CMDS.cpuTorch(x));
  L.push('TAG=$(git rev-parse --short HEAD)');
  const b = ['docker buildx build --platform linux/amd64', `-t ${x.image}:$TAG`];
  if (x.weights === 'build') b.push('--secret id=hf_token,env=HF_TOKEN');
  if (x.labels) b.push('--build-arg VERSION=$TAG --build-arg GIT_SHA=$(git rev-parse HEAD)');
  b.push('--load .');
  if (x.weights === 'build') L.push(CMDS.secret);
  L.push(...b.map((s, i) => (i ? '  ' : '') + s + (i < b.length - 1 ? ' \\' : '')));
  L.push('', CMDS.run(x));
  const r = ['docker run --rm', `--name ${name}`];
  if (x.gpu) r.push('--gpus all');
  if (x.init === 'docker') r.push('--init');
  if (x.triton || x.svc === 'train') r.push(`--shm-size=${x.triton ? '1g' : '8g'}`);
  const pub = x.ports.filter((p) => x.svc !== 'train');
  pub.forEach((p) => r.push(`-p ${p}:${p}`));
  if (x.weights === 'mount') r.push(x.triton ? '-v "$PWD/model_repository:/models:ro"' : '-v "$PWD/model:/models:ro"');
  if (x.weights === 'startup') r.push(...CMDS.aws);
  if (x.weights === 'startup' && !x.triton) r.push('-e MODEL_URI=s3://mi-bucket/modelos/v1');
  r.push(`${x.image}:$TAG`);
  if (x.gpu && x.base === 'cuda') L.push(CMDS.geforce);
  if (x.init === 'docker') L.push(CMDS.init);
  if (x.weights === 'startup') L.push(CMDS.creds);
  if (x.triton || x.svc === 'train') L.push(CMDS.shm(x));
  if (x.svc === 'train') L.push(CMDS.data);
  L.push(...r.map((s, i) => (i ? '  ' : '') + s + (i < r.length - 1 ? ' \\' : '')));
  const probe = x.triton ? 'curl -fsS localhost:8000/v2/health/ready' : x.svc === 'api' ? `curl -fsS localhost:${x.ports[0]}${x.hpath}` : x.svc === 'worker' && x.ports.length ? 'curl -fsS localhost:9100/metrics | head' : '';
  const hc = x.health === 'http' ? `docker inspect --format '{{.State.Health.Status}}' ${name}` : '';
  if (probe || hc) L.push('', CMDS.test, ...[probe, hc].filter(Boolean));
  if (x.images.length && x.pin === 'digest') L.push('', CMDS.digest, ...x.images.map((i) => `docker buildx imagetools inspect ${i}`));
  return L.join('\n') + '\n';
}

export function generate(input) {
  const x = derive(input);
  const bl = blocks(x);
  return {
    dockerfile: render(bl, x.comments),
    dockerignore: renderIgnore(x),
    commands: renderCommands(x),
    meta: { images: x.images, digestsMissing: x.digestsMissing, errs: x.errs, stages: x.multi ? 2 : 1, cfg: x.cfg },
  };
}

// =====================================================================================================
// 6 · REVISOR, DIFF Y ESTADO
// =====================================================================================================
// Las reglas del revisor (content-w1.json → revisor), compiladas igual que siempre las compiló la hoja:
// flags de la regla y g si es "match". Lo que no compila se omite y se reporta.
export function compileRules(rules) {
  return rules.map((r) => {
    try { return { r, re: new RegExp(r.pattern, r.flags + (r.test === 'match' ? 'g' : '')) }; }
    catch (e) { return { r, err: String((e && e.message) || e) }; }
  });
}
const RANK = { error: 0, warn: 1, info: 2 };
export function lint(text, compiled) {
  const found = [], skipped = [];
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  compiled.forEach((c) => {
    if (!c.re) { skipped.push(c.r.id); return; }
    if (c.r.test === 'match') {
      c.re.lastIndex = 0;
      let m; const lines = [];
      while ((m = c.re.exec(text))) { lines.push(lineOf(m.index)); if (m[0] === '') c.re.lastIndex++; }
      if (lines.length) found.push({ r: c.r, lines });
    } else if (!c.re.test(text)) found.push({ r: c.r, lines: [] });
  });
  found.sort((a, b) => (RANK[a.r.severity] - RANK[b.r.severity]) || ((a.lines[0] || 1e9) - (b.lines[0] || 1e9)));
  return { found, skipped };
}

// El revisor de la hoja es genérico: no sabe qué servicio es. El generador sí, y estas reglas no aplican a un servicio
// sin HTTP: no cuentan como hallazgos y la interfaz las lista aparte ("no aplica a un worker").
export const NOT_APPLICABLE = {
  worker: {
    'sin-healthcheck': 'no aplica a un worker: no sirve HTTP; su salud la miden las métricas y las alertas',
    'sin-expose': 'no aplica a un worker: sin métricas no escucha ningún puerto',
  },
  train: {
    'sin-healthcheck': 'no aplica a un entrenamiento: un job se mide por su estado (Completed o Failed) y sus métricas',
    'sin-expose': 'no aplica a un entrenamiento: con un nodo no escucha ningún puerto',
  },
};
export function lintFor(cfg, text, compiled) {
  const res = lint(text, compiled), na = NOT_APPLICABLE[(cfg || {}).svc] || {};
  return {
    found: res.found.filter((f) => !na[f.r.id]),
    na: Object.keys(na).map((id) => ({ id, why: na[id], rule: (compiled.find((c) => c.r.id === id) || {}).r || null, fired: res.found.some((f) => f.r.id === id) })),
    skipped: res.skipped,
  };
}

// Qué líneas de b son nuevas o cambiaron respecto de a (LCS por líneas)
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n'), n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const changed = new Array(m).fill(true);
  let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { changed[j] = false; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return changed;
}

// Estado en la URL: #generador?svc=worker&… (solo lo que difiere de DEFAULTS)
const LIST_KEYS = ['flags', 'env'];
export function encodeState(cfg) {
  const p = [];
  for (const q of QUESTIONS) {
    const k = q.k, val = cfg[k];
    if (LIST_KEYS.includes(k)) { const s = (val || []).join(','); if (s !== DEFAULTS[k].join(',')) p.push([k, s]); }
    else if (val !== undefined && val !== DEFAULTS[k] && String(val) !== '') p.push([k, String(val)]);
  }
  const dg = Object.entries(cfg.digests || {}).filter(([, d]) => d).map(([r, d]) => `${r}|${d}`).join(';');
  if (dg) p.push(['dg', dg]);
  return p.map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');
}
export function decodeState(str) {
  const out = {};
  String(str || '').replace(/^[#?]/, '').split('&').forEach((pair) => {
    if (!pair) return;
    const i = pair.indexOf('=');
    let k, val;
    try { k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i)); val = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1)); } catch (e) { return; }
    if (k === 'dg') { out.digests = {}; val.split(';').forEach((s) => { const j = s.lastIndexOf('|'); if (j > 0) out.digests[s.slice(0, j)] = s.slice(j + 1); }); return; }
    if (!QMAP[k]) return;
    out[k] = LIST_KEYS.includes(k) ? (val ? val.split(',') : []) : val;
  });
  return out;
}

// La fuente de la página: este mismo archivo sin los export, envuelto en una función que devuelve lo exportado.
export function toPageScript(src) {
  const names = [];
  const body = String(src).replace(/^export (const|function|let) ([A-Za-z_$][\w$]*)/gm, (m, kw, name) => { names.push(name); return `${kw} ${name}`; });
  if (/^export\b/m.test(body) || /^import\b/m.test(body)) throw new Error('generador.mjs: export o import fuera de la forma `export const|function|let nombre` al inicio de la línea');
  if (/<\/script|<!-{2}/i.test(body)) throw new Error('generador.mjs: la fuente no puede contener el cierre de script ni un comentario HTML');
  return `(function () {\n'use strict';\n${body}\nreturn { ${names.join(', ')} };\n})()`;
}
