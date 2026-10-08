/* =============================================================================
   Atlas de Arquitecturas — js/content/catalog.js
   Basado en apps/ml-system-design/js/content/catalog.js.
   Catálogo completo: el repaso, todos los modelos (listos o no), las tarjetas de nivel 1,
   las páginas especiales, las familias (regiones del Mapa), las relaciones tipadas entre
   modelos y la hoja de ruta por fases (espejo de docs/ROADMAP.md). Solo metadatos: el
   contenido de cada página vive en js/content/<id>.js y se registra con ATLAS.register.
   Contrato: docs/SPEC.md §5.2 y §13.3. Sin DOM (se carga también en Node).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // freq = qué tan seguido aparece el tema en entrevistas de ML/AI Engineer (estimación honesta,
  // no un dato medido). minutes = tiempo de lectura + práctica estimado de la página de nivel 2.
  // canonical = id de la config del calculador que usa la ficha técnica. Hoy solo existen
  // 'vit-b16-224' (y las demás de ViT) y las de juguete 'toy-n5-d8*'; las otras son el plan de su
  // fase (docs/ROADMAP.md) y se confirman contra el paper antes de escribir la página.
  // card = tarjeta de nivel 1 del Mapa (entradas → salidas, idea, dónde se usa, tamaño).

  // ------------------------------------------------------------------ familias (regiones del Mapa)
  const families = [
    { id: 'transformer', kind: 'family', block: 0, title: 'Transformer (la raíz)', titleEn: 'Transformer',
      summary: 'Self-attention + MLP con residuales y normalización. Todo lo que sigue en el atlas es este bloque con otra entrada, otra máscara u otra salida.' },
    { id: 'cnn', kind: 'family', block: 1, title: 'CNNs', titleEn: 'Convolutional networks',
      summary: 'Lo que ya dominas: convoluciones locales con pesos compartidos, stages con stride, BatchNorm y cabeza GAP. Aquí son el punto de comparación y el backbone de varios modelos.' },
    { id: 'vit', kind: 'family', block: 1, title: 'Vision Transformers', titleEn: 'Vision Transformers',
      summary: 'La imagen se corta en parches que se vuelven tokens y pasan por un encoder transformer. ViT es plano; Swin recupera la jerarquía de una CNN con ventanas.' },
    { id: 'contrastive', kind: 'family', block: 1, title: 'Aprendizaje contrastivo imagen-texto', titleEn: 'Contrastive vision-language',
      summary: 'Dos encoders (imagen y texto) que proyectan a un mismo espacio; la pérdida InfoNCE acerca los pares correctos. De aquí salen los encoders de visión de casi todos los VLMs.' },
    { id: 'detect', kind: 'family', block: 1, title: 'Detección', titleEn: 'Object detection',
      summary: 'De YOLO (grilla, NMS; anchors según la versión) a DETR (queries y matching húngaro, sin NMS) y a la detección de vocabulario abierto, donde las clases llegan como texto.' },
    { id: 'seg', kind: 'family', block: 1, title: 'Segmentación con prompts', titleEn: 'Promptable segmentation',
      summary: 'Un encoder de imagen pesado que corre una vez y un decoder liviano que convierte un prompt (punto, caja) en máscara; SAM 2 le agrega memoria para video.' },
    { id: 'llm', kind: 'family', block: 1, title: 'LLMs (decoder-only)', titleEn: 'Decoder-only LLMs',
      summary: 'El transformer con máscara causal que predice el siguiente token, con las piezas modernas (RMSNorm, RoPE, SwiGLU, GQA) y lo que domina su inferencia (KV cache, prefill vs decode).' },
    { id: 'vlm', kind: 'family', block: 1, title: 'Modelos visión-lenguaje', titleEn: 'Vision-language models',
      summary: 'Encoder de visión → projector → LLM: los parches se vuelven tokens dentro del prompt. Cambia cómo se generan esos tokens (resolución fija o dinámica).' },
    { id: 'gen', kind: 'family', block: 1, title: 'Modelos generativos de imagen', titleEn: 'Generative image models',
      summary: 'Difusión (U-Net latente o transformer DiT) y flow matching, más las GANs como referencia histórica. Las mismas ideas generan acciones en robótica.' },
    { id: 'vla', kind: 'family', block: 1, title: 'Vision-Language-Action', titleEn: 'Vision-language-action models',
      summary: 'Un VLM que, en vez de texto, emite acciones del robot: como tokens discretos (RT-2, OpenVLA) o como trayectorias continuas con flow matching (π0).' },
    { id: 'encoder', kind: 'family', block: 2, title: 'Encoder-only y retrieval', titleEn: 'Encoder-only & retrieval',
      summary: 'BERT y sus descendientes: atención bidireccional para entender texto, embeddings para buscar (bi-encoder) y rerankers (cross-encoder).' },
    { id: 'encdec', kind: 'family', block: 2, title: 'Encoder-decoder', titleEn: 'Encoder-decoder',
      summary: 'Un encoder bidireccional sobre la entrada y un decoder causal que la consulta con cross-attention: traducción, T5, Whisper.' },
    { id: 'align', kind: 'family', block: 2, title: 'Fine-tuning y alineación', titleEn: 'Fine-tuning & alignment',
      summary: 'Cómo se adapta un LLM preentrenado: adapters de bajo rango (LoRA/QLoRA), SFT y preferencias (RLHF con PPO, DPO).' },
    { id: 'search', kind: 'family', block: 2, title: 'Búsqueda vectorial', titleEn: 'Vector search',
      summary: 'Encontrar los vecinos más cercanos entre millones de embeddings sin compararlos todos: grafos (HNSW) y cuantización (IVF-PQ).' },
    { id: 'recsys', kind: 'family', block: 2, title: 'Recomendación', titleEn: 'Recommender systems',
      summary: 'El embudo de industria: two-tower para recuperar candidatos y, en la etapa siguiente, un modelo de ranking (DLRM, Wide & Deep) para ordenarlos.' },
    { id: 'trees', kind: 'family', block: 2, title: 'Árboles (GBDT)', titleEn: 'Gradient boosted trees',
      summary: 'XGBoost y LightGBM: siguen ganando en datos tabulares y aparecen en casi toda entrevista de ML de industria.' },
    { id: 'robot', kind: 'family', block: 3, title: 'Percepción y control para robótica', titleEn: 'Robotics perception & control',
      summary: 'Tracking, profundidad, nubes de puntos, escenas 3D y aprendizaje de políticas (RL e imitation learning).' },
    { id: 'otros', kind: 'family', block: 3, title: 'Otras familias (nivel 1)', titleEn: 'Other families',
      summary: 'Lo que conviene reconocer y ubicar en una entrevista sin necesitar el nivel 2: GNNs, modelos de espacio de estados (Mamba), RNN/LSTM.' },
  ];

  // ------------------------------------------------------------------ utilidades
  const A = 'alta', M = 'media', B = 'baja';
  // Página de modelo de nivel 2 (11 secciones, SPEC §5.3).
  const model = (o) => Object.assign({ kind: 'model', level: 2 }, o);
  // Tarjeta de nivel 1 (solo Mapa).
  const card = (o) => Object.assign({ kind: 'card', level: 1 }, o);

  const items = {};
  const add = (it) => { items[it.id] = it; };

  // ------------------------------------------------------------------ repaso (bloque 0)
  add({
    id: 'repaso-atencion', kind: 'recap', block: 0, num: 0, level: 2, phase: 1, family: 'transformer',
    title: 'Repaso de atención', titleEn: 'Attention recap',
    short: 'Repaso de atención',
    summary: 'La notación que usa todo el atlas, la atención con números de juguete, las tres máscaras, pre-LN vs post-LN y cuándo domina el término cuadrático. Lo demás lo tiene el Laboratorio.',
    topics: [
      'Notación Atlas ↔ Laboratorio (T↔N, d↔D, d_k↔d_h, d_ff↔D_mlp)',
      'Scaled dot-product attention con N = 5, D = 8, h = 2',
      'Por qué se divide entre √dₕ',
      'Multi-head como subespacios en paralelo (mismos parámetros que una sola cabeza)',
      'Las tres máscaras: bidireccional, causal y cross-attention',
      'Pre-LN vs post-LN',
      'Costo O(N²·D) vs O(N·D²) y el cruce en N = 6D',
      'Encoder-only, decoder-only y encoder-decoder',
    ],
    freq: A, minutes: 25,
    from: [], to: ['vit', 'llm-decoder', 'bert', 't5', 'whisper'],
    paper: { title: 'Attention Is All You Need', authors: 'Vaswani et al.', venue: 'NeurIPS 2017', arxiv: '1706.03762' },
    model: 'transformer', canonical: 'toy-n5-d8',
  });

  // ------------------------------------------------------------------ Bloque 1 — Visión + atención
  add(model({
    id: 'vit', block: 1, num: 1, phase: 1, family: 'vit',
    title: 'ViT — Vision Transformer', titleEn: 'Vision Transformer', short: 'ViT',
    summary: 'Corta la imagen en parches de 16×16, los trata como tokens y los pasa por un encoder transformer estándar. Es el encoder de visión que reutilizan CLIP, SAM y LLaVA, y DiT reusa su arquitectura como denoiser.',
    topics: [
      'Patch embedding: una conv P×P con stride P (patchify)',
      'Token CLS y position embeddings aprendidas',
      'Encoder pre-LN: MHSA + MLP con residuales, repetido L veces',
      'Conteo exacto de parámetros y MACs, con la aritmética',
      'Sesgo inductivo vs CNN: por qué ViT necesita mucho preentrenamiento',
      'Escalado con la resolución: tokens ×4 → matriz de atención ×16',
      'Fine-tuning a otra resolución: interpolar las position embeddings',
    ],
    freq: A, minutes: 100,
    from: ['repaso-atencion', 'resnet*'], to: ['swin', 'clip', 'sam', 'llava', 'dit', 'depth'],
    paper: { title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale', authors: 'Dosovitskiy et al.', venue: 'ICLR 2021', arxiv: '2010.11929' },
    model: 'vit', canonical: 'vit-b16-224',
    card: { in: 'imagen 224×224×3', out: 'logits de clase (o tokens para otro modelo)',
      idea: 'parches de 16×16 → tokens → encoder transformer; el token CLS resume la imagen',
      uso: 'clasificación y, sobre todo, encoder de visión de CLIP, SAM y LLaVA; DiT reusa su arquitectura como denoiser',
      tamano: 'ViT-B/16: {{vit-b16-224.params.totalM}} parámetros, {{vit-b16-224.tokens}} tokens' },
  }));
  add(model({
    id: 'swin', block: 1, num: 2, phase: 2, family: 'vit',
    title: 'Swin Transformer', titleEn: 'Swin Transformer: shifted windows', short: 'Swin',
    summary: 'Atención solo dentro de ventanas locales, desplazadas capa por medio, y patch merging entre stages: un ViT con la jerarquía de una CNN y costo lineal en el número de tokens.',
    topics: [
      'Window attention: costo lineal en tokens',
      'Shifted windows y la máscara del desplazamiento cíclico',
      'Patch merging ≈ stride 2 de una CNN: stages jerárquicos',
      'Relative position bias (tabla aprendida)',
      'Swin como backbone de detección y segmentación (FPN)',
    ],
    freq: M, minutes: 90,
    from: ['vit', 'resnet*'], to: ['grounding-dino'],
    paper: { title: 'Swin Transformer: Hierarchical Vision Transformer using Shifted Windows', authors: 'Liu et al.', venue: 'ICCV 2021', arxiv: '2103.14030' },
    model: 'swin', canonical: 'swin-t-224',
    card: { in: 'imagen 224×224×3', out: 'mapas de features en 4 escalas (o logits)',
      idea: 'atención en ventanas locales que se desplazan, y patch merging entre stages',
      uso: 'backbone de detección/segmentación (Grounding DINO usa Swin-T)', tamano: 'Swin-T @ 224 (C = 96, capas 2-2-6-2, M = 7)' },
  }));
  add(model({
    id: 'clip', block: 1, num: 3, phase: 2, family: 'contrastive',
    title: 'CLIP — contraste imagen-texto', titleEn: 'CLIP: Contrastive Language-Image Pre-training', short: 'CLIP',
    summary: 'Un encoder de imagen y uno de texto entrenados para que cada imagen quede cerca de su descripción. Da clasificación zero-shot y los encoders de visión de los VLMs.',
    topics: [
      'Dos encoders en paralelo y proyección a un espacio común',
      'Pérdida InfoNCE simétrica sobre la matriz de similitud del batch',
      'Temperatura aprendida',
      'Zero-shot: clases como prompts de texto',
      'Por qué importa el tamaño del batch en contrastivo',
    ],
    freq: A, minutes: 90,
    from: ['vit', 'repaso-atencion'], to: ['llava', 'yolo-world', 'stable-diffusion', 'retrieval'],
    paper: { title: 'Learning Transferable Visual Models From Natural Language Supervision', authors: 'Radford et al.', venue: 'ICML 2021', arxiv: '2103.00020' },
    model: 'clip', canonical: 'clip-vit-b16',
    card: { in: 'imagen + texto', out: 'dos embeddings en el mismo espacio (similitud coseno)',
      idea: 'InfoNCE: en un batch, cada imagen debe parecerse a su texto y a ningún otro',
      uso: 'zero-shot, búsqueda imagen-texto, encoder de visión de LLaVA, text encoder de Stable Diffusion',
      tamano: 'ViT-B/16 + text transformer (12 capas, ancho 512, contexto 77)' },
  }));
  add(model({
    id: 'detr', block: 1, num: 4, phase: 3, family: 'detect',
    title: 'DETR — detección como set prediction', titleEn: 'DETR: DEtection TRansformer', short: 'DETR (+ Deformable)',
    summary: 'Un CNN + transformer encoder-decoder con queries aprendidas que predicen directamente el conjunto de cajas. Sin anchors y sin NMS: el matching húngaro decide qué query responde por qué objeto.',
    topics: [
      'Object queries: el decoder con cross-attention a la imagen',
      'Matching húngaro y set prediction loss',
      'Por qué no hace falta NMS',
      'Convergencia lenta y Deformable DETR (atención deformable multi-escala)',
      'Contraste directo con YOLO: anchors, IoU, NMS',
    ],
    freq: M, minutes: 100,
    from: ['yolo*', 'resnet*', 'repaso-atencion'], to: ['grounding-dino'],
    paper: { title: 'End-to-End Object Detection with Transformers', authors: 'Carion et al.', venue: 'ECCV 2020', arxiv: '2005.12872' },
    model: 'detr', canonical: 'detr-r50-800x1216',
    card: { in: 'imagen', out: 'un conjunto fijo de Q predicciones (caja + clase o "nada")',
      idea: 'queries aprendidas + matching húngaro: cada objeto lo predice exactamente una query',
      uso: 'base de la familia DINO / Grounding DINO; detección sin postproceso a mano',
      tamano: 'DETR-R50 (6 + 6 capas, d = 256, 8 heads, 100 queries)' },
  }));
  add(model({
    id: 'grounding-dino', block: 1, num: 5, phase: 4, family: 'detect',
    title: 'Grounding DINO — detección con texto', titleEn: 'Grounding DINO: open-set detection', short: 'Grounding DINO',
    summary: 'Detector tipo DETR que recibe las clases como texto y las fusiona con la imagen en el encoder, en la selección de queries y en el decoder. Detecta "lo que le pidas" en lenguaje natural.',
    topics: [
      'Fusión texto-imagen en tres puntos (feature enhancer, query selection, cross-modality decoder)',
      'Backbone Swin + text encoder BERT',
      'Pérdida contrastiva región-palabra',
      'Grounded-SAM: cajas de Grounding DINO como prompts de SAM',
      'Precisión vs latencia frente a YOLO-World',
    ],
    freq: B, minutes: 90,
    from: ['detr', 'swin', 'bert'], to: ['sam'],
    paper: { title: 'Grounding DINO: Marrying DINO with Grounded Pre-Training for Open-Set Object Detection', authors: 'Liu et al.', venue: 'ECCV 2024', arxiv: '2303.05499' },
    model: 'grounding-dino', canonical: 'grounding-dino-t',
    card: { in: 'imagen + frase o lista de clases', out: 'cajas con la frase que las nombra',
      idea: 'DETR + texto fusionado en encoder, queries y decoder', uso: 'detección de vocabulario abierto, etiquetado automático, Grounded-SAM',
      tamano: 'Grounding DINO-T (Swin-T + BERT-base, 900 queries)' },
  }));
  add(model({
    id: 'yolo-world', block: 1, num: 6, phase: 4, family: 'detect',
    title: 'YOLO-World — vocabulario abierto en tiempo real', titleEn: 'YOLO-World: real-time open-vocabulary detection', short: 'YOLO-World',
    summary: 'Un YOLO cuyas clases son embeddings de texto de CLIP: cambias el vocabulario sin reentrenar y conservas la velocidad de un detector de una etapa.',
    topics: [
      'Text encoder de CLIP como cabeza de clasificación',
      'Fusión visión-texto en el neck (RepVL-PAN)',
      'Prompt-then-detect: precomputar el vocabulario',
      'Contraste con Grounding DINO: velocidad vs precisión',
    ],
    freq: B, minutes: 75,
    from: ['yolo*', 'clip'], to: [],
    paper: { title: 'YOLO-World: Real-Time Open-Vocabulary Object Detection', authors: 'Cheng et al.', venue: 'CVPR 2024', arxiv: '2401.17270' },
    model: 'yolo-world', canonical: 'yolo-world-l-640',
    card: { in: 'imagen + vocabulario de texto', out: 'cajas y clases del vocabulario dado',
      idea: 'las clases de YOLO pasan a ser embeddings de texto (CLIP)', uso: 'detección abierta en tiempo real, edge',
      tamano: 'YOLO-World-L @ 640' },
  }));
  add(model({
    id: 'sam', block: 1, num: 7, phase: 5, family: 'seg',
    title: 'SAM — Segment Anything', titleEn: 'Segment Anything Model', short: 'SAM',
    summary: 'Un ViT pesado que codifica la imagen una vez y un decoder liviano que convierte un punto o una caja en máscara en milisegundos. La segmentación pasa a ser una pregunta con prompt.',
    topics: [
      'Image encoder ViT (preentrenado con MAE) que corre una vez por imagen',
      'Prompt encoder: puntos, cajas, máscaras',
      'Mask decoder de dos capas y ambigüedad (3 máscaras + score de IoU)',
      'El data engine y el dataset SA-1B',
      'Grounded-SAM: texto → cajas → máscaras',
    ],
    freq: M, minutes: 90,
    from: ['vit', 'grounding-dino'], to: ['sam2'],
    paper: { title: 'Segment Anything', authors: 'Kirillov et al.', venue: 'ICCV 2023', arxiv: '2304.02643' },
    model: 'sam', canonical: 'sam-vit-h-1024',
    card: { in: 'imagen + prompt (punto, caja o máscara)', out: 'máscaras con su IoU estimado',
      idea: 'encoder pesado una vez, decoder liviano por prompt', uso: 'anotación, segmentación interactiva, Grounded-SAM',
      tamano: 'SAM ViT-H @ 1024 (embeddings 64×64×256)' },
  }));
  add(model({
    id: 'sam2', block: 1, num: 8, phase: 5, family: 'seg',
    title: 'SAM 2 — segmentación en video', titleEn: 'SAM 2: Segment Anything in images and videos', short: 'SAM 2',
    summary: 'SAM con un banco de memoria: las máscaras de frames anteriores condicionan el frame actual con atención, para seguir un objeto en video desde un solo clic.',
    topics: [
      'Encoder jerárquico Hiera en vez de ViT plano',
      'Memory attention y memory bank',
      'Propagación de máscaras y oclusiones',
      'Streaming: un frame a la vez',
    ],
    freq: B, minutes: 75,
    from: ['sam'], to: [],
    paper: { title: 'SAM 2: Segment Anything in Images and Videos', authors: 'Ravi et al.', venue: 'ICLR 2025', arxiv: '2408.00714' },
    model: 'sam2', canonical: 'sam2-hiera-l',   // tamaño a confirmar en F5 (ROADMAP)
    card: { in: 'video + prompt en un frame', out: 'la máscara del objeto en todos los frames',
      idea: 'SAM + memoria con atención sobre frames anteriores', uso: 'tracking de objetos por segmentación, anotación de video',
      tamano: 'Hiera (tamaño a confirmar)' },
  }));
  add(model({
    id: 'llm-decoder', block: 1, num: 9, phase: 6, family: 'llm',
    title: 'LLM decoder por dentro', titleEn: 'Decoder-only LLM internals', short: 'LLM decoder',
    summary: 'El bloque de un LLM moderno pieza por pieza: RMSNorm, RoPE, SwiGLU y GQA, con la cuenta exacta de parámetros de Llama 3 8B. Es el decoder que reutilizan LLaVA, Qwen2-VL y los VLA.',
    topics: [
      'Máscara causal y next-token prediction',
      'RMSNorm vs LayerNorm',
      'RoPE: posición como rotación de Q y K',
      'SwiGLU: por qué tres matrices en el MLP',
      'GQA / MQA: menos cabezas de K y V',
      'Conteo de parámetros por bloque',
    ],
    freq: A, minutes: 110,
    from: ['repaso-atencion'], to: ['llm-inferencia', 'llava', 'qwen2-vl', 'lora', 'rlhf-dpo', 'rt2'],
    paper: { title: 'The Llama 3 Herd of Models', authors: 'Dubey et al.', venue: 'arXiv 2024', arxiv: '2407.21783' },   // primer autor como en la v1 de arXiv (jul. 2024); versiones posteriores listan a Grattafiori primero
    model: 'llm', canonical: 'llama3-8b',
    card: { in: 'tokens de texto', out: 'distribución del siguiente token',
      idea: 'transformer con máscara causal + RMSNorm, RoPE, SwiGLU y GQA', uso: 'chat, código, agentes; el "cerebro" de los VLMs y VLAs',
      tamano: 'Llama 3 8B (32 capas, d = 4096, 32 heads de Q / 8 de KV)' },
  }));
  add(model({
    id: 'llm-inferencia', block: 1, num: 10, phase: 6, family: 'llm',
    title: 'Inferencia de LLMs: KV cache, MoE y cuantización', titleEn: 'LLM inference: KV cache, MoE, quantization', short: 'Inferencia de LLMs',
    summary: 'Por qué el prefill es compute-bound y el decode memory-bound, cuánto pesa el KV cache, cómo lo reduce GQA, y qué cambian MoE y la cuantización en memoria y latencia.',
    topics: [
      'Prefill vs decode',
      'KV cache: tamaño exacto por token y por request',
      'PagedAttention y continuous batching',
      'Mixture of Experts: parámetros totales vs activos',
      'Cuantización de pesos (INT8, INT4) y del KV cache',
      'Speculative decoding',
    ],
    freq: A, minutes: 90,
    from: ['llm-decoder'], to: ['llava'],
    paper: { title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention', authors: 'Kwon et al.', venue: 'SOSP 2023', arxiv: '2309.06180' },
    model: 'llm', canonical: 'llama3-8b',   // Mixtral 8×7B ('mixtral-8x7b') para la sección de MoE
    card: { in: 'prompt + tokens ya generados', out: 'un token por paso de decode',
      idea: 'el KV cache cambia cómputo por memoria; MoE activa solo una parte de los pesos', uso: 'serving de LLMs (vLLM, TGI), dimensionar GPUs',
      tamano: 'Llama 3 8B · Mixtral 8×7B para MoE' },
  }));
  add(model({
    id: 'llava', block: 1, num: 11, phase: 7, family: 'vlm',
    title: 'LLaVA — encoder + projector + LLM', titleEn: 'LLaVA: Large Language and Vision Assistant', short: 'LLaVA',
    summary: 'Los parches de un CLIP ViT-L/14 pasan por un MLP y entran al prompt de un LLM como si fueran palabras. La receta más simple de VLM y la que todo el mundo usa de base.',
    topics: [
      'Tokens visuales: de 336×336 a 576 tokens',
      'Projector MLP: del espacio de CLIP al del LLM',
      'Dos etapas: alinear el projector, luego visual instruction tuning',
      'Costo del prompt: los tokens visuales dominan el prefill',
    ],
    freq: M, minutes: 90,
    from: ['clip', 'llm-decoder'], to: ['qwen2-vl', 'openvla', 'rt2'],
    paper: { title: 'Improved Baselines with Visual Instruction Tuning', authors: 'Liu et al.', venue: 'CVPR 2024', arxiv: '2310.03744' },
    model: 'llava', canonical: 'llava15-7b',
    card: { in: 'imagen + texto', out: 'texto',
      idea: 'encoder de visión → MLP → tokens dentro del prompt del LLM', uso: 'VQA, descripción de imágenes; plantilla de VLMs como Prismatic, la base de OpenVLA',
      tamano: 'LLaVA-1.5-7B (CLIP ViT-L/14 @ 336 → MLP → Vicuna-7B)' },
  }));
  add(model({
    id: 'qwen2-vl', block: 1, num: 12, phase: 7, family: 'vlm',
    title: 'Qwen2-VL — resolución dinámica', titleEn: 'Qwen2-VL: dynamic resolution', short: 'Qwen2-VL',
    summary: 'El número de tokens visuales depende del tamaño de la imagen (no se redimensiona a un cuadrado fijo) y la posición se codifica en 2D/3D con M-RoPE. Mismo esquema que LLaVA, otra forma de producir los tokens.',
    topics: [
      'Resolución dinámica: tokens según el tamaño de la imagen',
      'M-RoPE: posición temporal, alto y ancho',
      'Merge de 2×2 tokens antes del LLM',
      'Video como secuencia de frames',
      'Trampa de fechas: Qwen-VL (2023) vs Qwen2-VL (2024)',
    ],
    freq: B, minutes: 75,
    from: ['llava', 'llm-decoder'], to: [],
    paper: { title: "Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution", authors: 'Wang et al.', venue: 'arXiv 2024', arxiv: '2409.12191' },
    model: 'qwen2-vl', canonical: 'qwen2-vl-7b',
    card: { in: 'imagen o video de cualquier tamaño + texto', out: 'texto',
      idea: 'tokens visuales proporcionales al tamaño de la imagen + M-RoPE', uso: 'documentos, OCR, video',
      tamano: 'Qwen2-VL-7B' },
  }));
  add(model({
    id: 'stable-diffusion', block: 1, num: 13, phase: 8, family: 'gen',
    title: 'Stable Diffusion — U-Net latente', titleEn: 'Latent diffusion (Stable Diffusion)', short: 'Stable Diffusion',
    summary: 'Difusión en el espacio latente de un autoencoder: una U-Net con cross-attention al texto quita ruido paso a paso. Se entiende como una regresión del ruido, no como magia.',
    topics: [
      'Proceso de forward (ruido) y reverse (denoising)',
      'Predecir el ruido ε: la pérdida MSE',
      'VAE: de 512×512×3 a un latente de 64×64×4',
      'U-Net con cross-attention al texto (CLIP)',
      'Classifier-free guidance',
    ],
    freq: M, minutes: 100,
    from: ['resnet*', 'clip'], to: ['dit', 'imitation'],
    paper: { title: 'High-Resolution Image Synthesis with Latent Diffusion Models', authors: 'Rombach et al.', venue: 'CVPR 2022', arxiv: '2112.10752' },
    model: 'stable-diffusion', canonical: 'sd15-unet',
    card: { in: 'texto (+ ruido)', out: 'imagen',
      idea: 'quitar ruido en un latente comprimido, condicionado por texto con cross-attention', uso: 'generación y edición de imágenes',
      tamano: 'U-Net de SD 1.5 (latente 64×64×4)' },
  }));
  add(model({
    id: 'dit', block: 1, num: 14, phase: 8, family: 'gen',
    title: 'DiT + flow matching', titleEn: 'Diffusion Transformers and flow matching', short: 'DiT + flow matching',
    summary: 'Reemplaza la U-Net por un ViT sobre parches del latente, condicionado con adaLN (el paper de DiT usa difusión tipo DDPM). Flow matching cambia la cadena de ruido por una línea recta entre ruido y dato: es la técnica que π0 toma para generar acciones.',
    topics: [
      'Patchify del latente y bloques DiT',
      'adaLN-Zero: condicionar con timestep y clase',
      'Escalado: más GFLOPs por imagen → mejor FID',
      'Flow matching: velocidad constante entre ruido y dato',
    ],
    freq: B, minutes: 90,
    from: ['vit', 'stable-diffusion'], to: ['pi0'],
    paper: { title: 'Scalable Diffusion Models with Transformers', authors: 'Peebles & Xie', venue: 'ICCV 2023', arxiv: '2212.09748' },
    model: 'dit', canonical: 'dit-xl2-256',
    card: { in: 'latente con ruido + timestep + condición', out: 'ruido (o velocidad) predicho',
      idea: 'un ViT sobre parches del latente, condicionado con adaLN', uso: 'generadores de imagen y video recientes; π0 toma de esta línea el flow matching (su action expert no es un DiT)',
      tamano: 'DiT-XL/2 @ 256 (latente 32×32×4)' },
  }));
  add(model({
    id: 'rt2', block: 1, num: 15, phase: 9, family: 'vla',
    title: 'RT-2 — acciones como tokens', titleEn: 'RT-2: Robotics Transformer 2', short: 'RT-2',
    summary: 'Un VLM grande fine-tuneado a la vez con datos web y trayectorias de robot, donde cada acción se discretiza en tokens de texto. Pesos cerrados: se marca qué es público.',
    topics: [
      'Discretizar acciones en 256 bins por dimensión',
      'Co-fine-tuning con datos web + robot',
      'Por qué transfiere conocimiento semántico al control',
      'Qué se sabe y qué no (pesos cerrados)',
    ],
    freq: B, minutes: 60,
    from: ['llm-decoder', 'llava'], to: ['openvla'],
    paper: { title: 'RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control', authors: 'Brohan et al.', venue: 'CoRL 2023', arxiv: '2307.15818' },
    model: 'rt2', canonical: null,   // pesos cerrados: nivel 2 parcial (ROADMAP F9)
    card: { in: 'imagen de cámara + instrucción', out: 'tokens de acción (posición, rotación, gripper)',
      idea: 'un VLM que "habla" acciones discretizadas', uso: 'manipulación con instrucciones en lenguaje natural',
      tamano: 'pesos cerrados' },
  }));
  add(model({
    id: 'openvla', block: 1, num: 16, phase: 9, family: 'vla',
    title: 'OpenVLA', titleEn: 'OpenVLA: open-source vision-language-action model', short: 'OpenVLA',
    summary: 'La versión abierta de la idea de RT-2: un VLM de 7B con dos encoders de visión y un Llama 2, entrenado con Open X-Embodiment, que predice acciones como tokens.',
    topics: [
      'Dos encoders de visión (SigLIP + DINOv2) concatenados',
      'Acciones como tokens del vocabulario del LLM',
      'Datos: Open X-Embodiment',
      'Fine-tuning con LoRA a un robot nuevo',
    ],
    freq: B, minutes: 60,
    from: ['rt2', 'llava'], to: ['pi0'],
    paper: { title: 'OpenVLA: An Open-Source Vision-Language-Action Model', authors: 'Kim et al.', venue: 'CoRL 2024', arxiv: '2406.09246' },
    model: 'openvla', canonical: 'openvla-7b',
    card: { in: 'imagen + instrucción', out: 'acción de 7 dimensiones como tokens',
      idea: 'LLaVA-like con dos encoders de visión, salida de acciones discretas', uso: 'manipulación, baseline abierto de VLA',
      tamano: 'OpenVLA-7B' },
  }));
  add(model({
    id: 'pi0', block: 1, num: 17, phase: 9, family: 'vla',
    title: 'π0 — action expert con flow matching', titleEn: 'π0: a vision-language-action flow model', short: 'π0',
    summary: 'Un VLM (PaliGemma) más un "action expert" que genera chunks de acciones continuas con flow matching. Acciones suaves a alta frecuencia en vez de tokens discretos.',
    topics: [
      'Action expert: pesos separados que atienden al VLM',
      'Flow matching para acciones continuas',
      'Action chunking: varias acciones por inferencia',
      'Contraste con OpenVLA: continuo vs discreto',
    ],
    freq: B, minutes: 60,
    from: ['openvla', 'dit', 'imitation'], to: [],
    paper: { title: 'π0: A Vision-Language-Action Flow Model for General Robot Control', authors: 'Black et al.', venue: 'RSS 2025', arxiv: '2410.24164' },   // verificar venue (arXiv 2024)
    model: 'pi0', canonical: 'pi0',
    card: { in: 'imágenes + instrucción + estado del robot', out: 'chunk de acciones continuas',
      idea: 'VLM + action expert que integra un campo de velocidad (flow matching)', uso: 'manipulación diestra, tareas largas',
      tamano: 'PaliGemma 3B + action expert, chunks de 50 acciones' },
  }));

  // ------------------------------------------------------------------ Bloque 2 — LLMs, retrieval y ML de industria
  add(model({
    id: 'lora', block: 2, num: 1, phase: 10, family: 'align',
    title: 'LoRA y QLoRA', titleEn: 'Low-Rank Adaptation (LoRA, QLoRA)', short: 'LoRA / QLoRA',
    summary: 'Congelas los pesos y aprendes una corrección de rango r: W + BA. Cuenta exacta de parámetros entrenables y por qué QLoRA cabe en una sola GPU.',
    topics: [
      'W + BA con rango r: parámetros entrenables',
      'Dónde se ponen los adapters (W_Q, W_V, todas las lineales)',
      'Merge de los adapters para inferencia',
      'QLoRA: base en 4 bits (NF4) + adapters en 16 bits',
    ],
    freq: A, minutes: 60,
    from: ['llm-decoder'], to: ['rlhf-dpo', 'openvla'],
    paper: { title: 'LoRA: Low-Rank Adaptation of Large Language Models', authors: 'Hu et al.', venue: 'ICLR 2022', arxiv: '2106.09685' },
    model: 'lora', canonical: null,
    card: { in: 'un modelo preentrenado congelado', out: 'el mismo modelo + un delta de bajo rango',
      idea: 'aprender BA (rango r) en vez de toda W', uso: 'fine-tuning barato de LLMs y VLAs' },
  }));
  add(model({
    id: 'rlhf-dpo', block: 2, num: 2, phase: 10, family: 'align',
    title: 'SFT, RLHF (PPO) y DPO', titleEn: 'SFT, RLHF with PPO, and DPO', short: 'RLHF vs DPO',
    summary: 'Cómo se pasa de un LLM que completa texto a uno que sigue instrucciones: SFT, reward model + PPO con penalización KL, y DPO, que optimiza las preferencias sin reward model explícito.',
    topics: [
      'SFT: imitación de demostraciones',
      'Reward model con pares de preferencias (Bradley-Terry)',
      'PPO con penalización KL contra el modelo de referencia',
      'DPO: la misma meta como una pérdida de clasificación',
      'Cuántos modelos en memoria necesita cada método',
    ],
    freq: A, minutes: 75,
    from: ['llm-decoder', 'lora', 'rl-ppo'], to: [],
    paper: { title: 'Training language models to follow instructions with human feedback', authors: 'Ouyang et al.', venue: 'NeurIPS 2022', arxiv: '2203.02155' },
    model: 'rlhf-dpo', canonical: null,
    card: { in: 'LLM preentrenado + demostraciones + preferencias', out: 'LLM alineado',
      idea: 'SFT → reward model → PPO, o DPO directo sobre pares', uso: 'asistentes conversacionales' },
  }));
  add(model({
    id: 'bert', block: 2, num: 3, phase: 11, family: 'encoder',
    title: 'BERT — encoder-only', titleEn: 'BERT: Bidirectional Encoder Representations from Transformers', short: 'BERT',
    summary: 'El transformer encoder con atención bidireccional, preentrenado con masked language modeling. La base de los embeddings de texto, los rerankers y el text encoder de Grounding DINO.',
    topics: [
      'Masked language modeling (15 % de tokens)',
      'Token [CLS], segment embeddings, WordPiece',
      'Por qué no genera texto (no hay máscara causal)',
      'Fine-tuning para clasificación, NER y QA',
    ],
    freq: A, minutes: 75,
    from: ['repaso-atencion'], to: ['retrieval', 'grounding-dino', 't5'],
    paper: { title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', authors: 'Devlin et al.', venue: 'NAACL 2019', arxiv: '1810.04805' },
    model: 'bert', canonical: 'bert-base',
    card: { in: 'texto', out: 'un embedding por token (+ CLS)',
      idea: 'encoder bidireccional preentrenado rellenando tokens enmascarados', uso: 'clasificación de texto, embeddings, rerankers',
      tamano: 'BERT-base (12 capas, d = 768, 12 heads)' },
  }));
  add(model({
    id: 'retrieval', block: 2, num: 4, phase: 11, family: 'encoder',
    title: 'Embeddings y retrieval: bi-encoder vs cross-encoder', titleEn: 'Dense retrieval: bi-encoders and cross-encoders', short: 'Bi- vs cross-encoder',
    summary: 'Bi-encoder: query y documento se codifican por separado y se comparan con un producto punto (rápido, indexable). Cross-encoder: se codifican juntos (preciso, caro). En producción se usan en cascada.',
    topics: [
      'Bi-encoder con pérdida contrastiva (InfoNCE, in-batch negatives)',
      'Cross-encoder como reranker',
      'Hard negatives',
      'Retrieve → rerank: el embudo de RAG y búsqueda',
    ],
    freq: A, minutes: 75,
    from: ['bert', 'clip'], to: ['ann', 'two-tower'],
    paper: { title: 'Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks', authors: 'Reimers & Gurevych', venue: 'EMNLP 2019', arxiv: '1908.10084' },
    model: 'retrieval', canonical: null,
    card: { in: 'query + corpus', out: 'documentos ordenados',
      idea: 'embeddings separados para recuperar, codificación conjunta para reordenar', uso: 'RAG, búsqueda semántica' },
  }));
  add(model({
    id: 'ann', block: 2, num: 5, phase: 11, family: 'search',
    title: 'Búsqueda ANN: HNSW e IVF-PQ', titleEn: 'Approximate nearest neighbor search', short: 'ANN (HNSW, IVF-PQ)',
    summary: 'Cómo encontrar los k vecinos más cercanos entre millones de vectores en milisegundos: grafos navegables (HNSW) o particiones + cuantización de producto (IVF-PQ). Recall vs latencia vs memoria.',
    topics: [
      'HNSW: grafo jerárquico y búsqueda voraz',
      'IVF: particionar con k-means y visitar nprobe celdas',
      'Product quantization: memoria por vector',
      'Recall@k vs latencia vs memoria',
    ],
    freq: M, minutes: 60,
    from: ['retrieval'], to: ['two-tower'],
    paper: { title: 'Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs', authors: 'Malkov & Yashunin', venue: 'IEEE TPAMI 2020', arxiv: '1603.09320' },   // verificar año: online 2018, vol. 42 (2020)
    model: 'ann', canonical: null,
    card: { in: 'vector de query + índice', out: 'k vecinos aproximados',
      idea: 'no comparar contra todos: grafo o particiones + cuantización', uso: 'bases vectoriales (FAISS, pgvector), RAG, recomendación' },
  }));
  add(model({
    id: 't5', block: 2, num: 6, phase: 12, family: 'encdec',
    title: 'T5 — encoder-decoder', titleEn: 'T5: Text-to-Text Transfer Transformer', short: 'T5',
    summary: 'Todas las tareas de texto como "texto de entrada → texto de salida" con un encoder bidireccional y un decoder causal unidos por cross-attention.',
    topics: [
      'Cross-attention: Q del decoder, K y V del encoder',
      'Span corruption como objetivo de preentrenamiento',
      'Relative position bias',
      'Encoder-decoder vs decoder-only: cuándo conviene cada uno',
    ],
    freq: M, minutes: 60,
    from: ['repaso-atencion', 'bert'], to: [],
    paper: { title: 'Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer', authors: 'Raffel et al.', venue: 'JMLR 2020', arxiv: '1910.10683' },
    model: 't5', canonical: null,
    card: { in: 'texto', out: 'texto',
      idea: 'encoder bidireccional + decoder causal con cross-attention', uso: 'traducción, resumen; text encoder de algunos modelos de difusión' },
  }));
  add(model({
    id: 'whisper', block: 2, num: 7, phase: 12, family: 'encdec',
    title: 'Whisper — audio a texto', titleEn: 'Whisper: robust speech recognition', short: 'Whisper',
    summary: 'Encoder-decoder sobre el espectrograma log-mel de 30 s de audio, entrenado con supervisión débil a gran escala. Usa el encoder-decoder del Transformer original: es hermano de T5, no su descendiente (ni span corruption ni relative position bias).',
    topics: [
      'Log-mel spectrogram y convoluciones de entrada',
      'Tokens especiales de tarea e idioma',
      'Ventanas de 30 s y transcripción larga',
      'Latencia: el decoder autoregresivo domina',
    ],
    freq: B, minutes: 60,
    from: ['repaso-atencion'], to: [],
    paper: { title: 'Robust Speech Recognition via Large-Scale Weak Supervision', authors: 'Radford et al.', venue: 'ICML 2023', arxiv: '2212.04356' },
    model: 'whisper', canonical: null,
    card: { in: 'audio (30 s)', out: 'texto (transcripción o traducción)',
      idea: 'encoder-decoder sobre el espectrograma', uso: 'ASR, subtítulos, voz en agentes' },
  }));
  add(model({
    id: 'two-tower', block: 2, num: 8, phase: 13, family: 'recsys',
    title: 'Two-tower para recomendación', titleEn: 'Two-tower retrieval models', short: 'Two-tower',
    summary: 'Una torre para el usuario y otra para el ítem, entrenadas para que el producto punto prediga interacción. Los ítems se precomputan y se indexan con ANN: es el mismo patrón bi-encoder que el retrieval de texto (DSSM, 2013, ya lo usaba en búsqueda).',
    topics: [
      'Torres de usuario e ítem, features categóricas como embeddings',
      'Softmax muestreado y corrección por sesgo de muestreo',
      'Indexar ítems con ANN',
      'Por qué no puede usar features cruzadas usuario × ítem',
    ],
    freq: M, minutes: 60,
    from: ['retrieval', 'ann'], to: ['dlrm'],
    paper: { title: 'Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations', authors: 'Yi et al.', venue: 'RecSys 2019' },   // verificar: sin arXiv conocido; añadir url (DOI ACM) en F13
    model: 'two-tower', canonical: null,
    card: { in: 'features de usuario y de ítem', out: 'score = producto punto de dos embeddings',
      idea: 'dos encoders separados para poder precomputar e indexar los ítems', uso: 'candidate generation en recomendación' },
  }));
  add(model({
    id: 'dlrm', block: 2, num: 9, phase: 13, family: 'recsys',
    title: 'Ranking: DLRM y Wide & Deep', titleEn: 'Ranking models: DLRM, Wide & Deep', short: 'DLRM / Wide & Deep',
    summary: 'La etapa siguiente del embudo, después de two-tower: el modelo que ordena los cientos de candidatos. Tablas de embeddings enormes para features categóricas, un MLP para las densas e interacciones explícitas entre ellas.',
    topics: [
      'Tablas de embeddings: donde están casi todos los parámetros',
      'Interacción de features (producto punto por pares)',
      'Wide & Deep: memorización + generalización',
      'Retrieval → ranking → re-ranking',
    ],
    freq: M, minutes: 60,
    from: ['two-tower', 'gbdt'], to: [],
    paper: { title: 'Deep Learning Recommendation Model for Personalization and Recommendation Systems', authors: 'Naumov et al.', venue: 'arXiv 2019', arxiv: '1906.00091' },
    model: 'dlrm', canonical: null,
    card: { in: 'features densas + categóricas de (usuario, ítem, contexto)', out: 'probabilidad de click/compra',
      idea: 'embeddings para categóricas + MLP + interacciones explícitas', uso: 'ranking de feeds, ads, e-commerce' },
  }));
  add(model({
    id: 'gbdt', block: 2, num: 10, phase: 13, family: 'trees',
    title: 'Gradient boosted trees: XGBoost y LightGBM', titleEn: 'Gradient boosted decision trees', short: 'GBDT (XGBoost/LightGBM)',
    summary: 'Árboles que se suman uno a uno corrigiendo el error del anterior, con splits por histograma. Siguen ganando en tabulares por qué y cuándo deberías empezar por aquí.',
    topics: [
      'Boosting: ajustar el gradiente de la pérdida con un árbol',
      'Splits por histograma y crecimiento por hoja (LightGBM)',
      'Regularización: profundidad, learning rate, subsampling',
      'Por qué ganan en tabulares frente a redes',
    ],
    freq: M, minutes: 60,
    from: [], to: ['dlrm'],
    paper: { title: 'XGBoost: A Scalable Tree Boosting System', authors: 'Chen & Guestrin', venue: 'KDD 2016', arxiv: '1603.02754' },
    model: 'gbdt', canonical: null,
    card: { in: 'tabla de features', out: 'predicción (suma de árboles)',
      idea: 'cada árbol nuevo corrige el residuo de los anteriores', uso: 'fraude, riesgo, ranking tabular, baselines fuertes' },
  }));

  // ------------------------------------------------------------------ Bloque 3 — Robótica
  add(model({
    id: 'bytetrack', block: 3, num: 1, phase: 14, family: 'robot',
    title: 'Tracking: SORT y ByteTrack', titleEn: 'Multi-object tracking: SORT, ByteTrack', short: 'SORT / ByteTrack',
    summary: 'Tracking por detección: un filtro de Kalman predice cada track, el matching húngaro con IoU lo asocia a las detecciones, y ByteTrack recupera las detecciones de baja confianza.',
    topics: [
      'Filtro de Kalman con velocidad constante',
      'Asociación con matching húngaro sobre IoU',
      'ByteTrack: segunda pasada con detecciones de baja confianza',
      'Métricas: MOTA, IDF1, HOTA',
    ],
    freq: B, minutes: 60,
    from: ['yolo*', 'detr'], to: [],
    paper: { title: 'ByteTrack: Multi-Object Tracking by Associating Every Detection Box', authors: 'Zhang et al.', venue: 'ECCV 2022', arxiv: '2110.06864' },
    model: 'bytetrack', canonical: null,
    card: { in: 'detecciones por frame', out: 'tracks con id persistente',
      idea: 'Kalman predice, el matching húngaro asocia', uso: 'video analítica, robots móviles, conteo' },
  }));
  add(model({
    id: 'depth', block: 3, num: 2, phase: 14, family: 'robot',
    title: 'Depth estimation: DPT y Depth Anything', titleEn: 'Monocular depth estimation', short: 'DPT / Depth Anything',
    summary: 'Un ViT como encoder y un decoder que reensambla tokens en mapas densos multi-escala para predecir profundidad por píxel desde una sola imagen.',
    topics: [
      'Reassemble: de tokens a mapas de features',
      'Profundidad relativa vs métrica',
      'Pérdidas invariantes a escala',
      'Depth Anything: datos sin etiquetar a gran escala',
    ],
    freq: B, minutes: 60,
    from: ['vit'], to: [],
    paper: { title: 'Vision Transformers for Dense Prediction', authors: 'Ranftl et al.', venue: 'ICCV 2021', arxiv: '2103.13413' },
    model: 'depth', canonical: null,
    card: { in: 'imagen', out: 'mapa de profundidad por píxel',
      idea: 'ViT + decoder denso que reensambla tokens en varias escalas', uso: 'navegación, manipulación, AR' },
  }));
  add(model({
    id: 'pointnet', block: 3, num: 3, phase: 14, family: 'robot',
    title: 'PointNet — nubes de puntos', titleEn: 'PointNet: deep learning on point sets', short: 'PointNet',
    summary: 'Un MLP compartido por punto y un max-pool global: una función invariante al orden de los puntos. La base para clasificar y segmentar nubes de LiDAR o de cámaras de profundidad.',
    topics: [
      'Invarianza a permutaciones con una función simétrica (max-pool)',
      'MLP compartido = conv 1×1',
      'T-Net: alinear la entrada',
      'PointNet++: agrupamiento local jerárquico',
    ],
    freq: B, minutes: 45,
    from: ['resnet*'], to: [],
    paper: { title: 'PointNet: Deep Learning on Point Sets for 3D Classification and Segmentation', authors: 'Qi et al.', venue: 'CVPR 2017', arxiv: '1612.00593' },
    model: 'pointnet', canonical: null,
    card: { in: 'N puntos (x, y, z)', out: 'clase de la nube o etiqueta por punto',
      idea: 'MLP por punto + max-pool: no importa el orden', uso: 'LiDAR, bin picking, segmentación 3D' },
  }));
  add(model({
    id: 'rl-ppo', block: 3, num: 4, phase: 15, family: 'robot',
    title: 'RL para robótica: policy gradient y PPO', titleEn: 'Policy gradients and PPO', short: 'Policy gradient y PPO',
    summary: 'De REINFORCE a PPO: la ventaja, el clipping que evita pasos de política demasiado grandes y por qué es el algoritmo por defecto en simulación (y en RLHF).',
    topics: [
      'Policy gradient y la ventaja',
      'GAE',
      'PPO-clip',
      'Sim-to-real y domain randomization',
    ],
    freq: B, minutes: 60,
    from: [], to: ['rlhf-dpo', 'imitation'],
    paper: { title: 'Proximal Policy Optimization Algorithms', authors: 'Schulman et al.', venue: 'arXiv 2017', arxiv: '1707.06347' },
    model: 'rl-ppo', canonical: null,
    card: { in: 'observaciones + recompensa', out: 'política (distribución de acciones)',
      idea: 'subir la probabilidad de las acciones con ventaja positiva, sin pasos grandes', uso: 'locomoción en simulación, RLHF' },
  }));
  add(model({
    id: 'imitation', block: 3, num: 5, phase: 15, family: 'robot',
    title: 'Imitation learning: BC, ACT, Diffusion Policy', titleEn: 'Imitation learning', short: 'Imitation learning',
    summary: 'Aprender una política de demostraciones: behavior cloning, action chunking con transformers (ACT) y Diffusion Policy, que modela acciones multimodales con difusión.',
    topics: [
      'Behavior cloning y covariate shift',
      'ACT: chunks de acciones con un CVAE transformer',
      'Diffusion Policy: difusión sobre trayectorias',
      'Cuántas demostraciones hacen falta',
    ],
    freq: B, minutes: 60,
    from: ['rl-ppo', 'stable-diffusion'], to: ['pi0'],
    paper: { title: 'Diffusion Policy: Visuomotor Policy Learning via Action Diffusion', authors: 'Chi et al.', venue: 'RSS 2023', arxiv: '2303.04137' },
    model: 'imitation', canonical: null,
    card: { in: 'observaciones + demostraciones', out: 'chunk de acciones',
      idea: 'regresión (o difusión) de las acciones del experto', uso: 'manipulación con pocas decenas de demostraciones' },
  }));

  // ------------------------------------------------------------------ tarjetas de nivel 1 (solo Mapa)
  add(card({
    id: 'resnet', anchor: true, family: 'cnn',
    title: 'ResNet', titleEn: 'Residual networks', short: 'ResNet (ya lo sabes)',
    summary: 'Lo que ya sabes: stages convolucionales con stride, bloques residuales, BatchNorm y cabeza GAP. Es el punto de comparación de cada página del atlas.',
    freq: A, from: [], to: ['vit', 'swin', 'detr', 'pointnet'],
    paper: { title: 'Deep Residual Learning for Image Recognition', authors: 'He et al.', venue: 'CVPR 2016', arxiv: '1512.03385' },
    card: { in: 'imagen H×W×3', out: 'logits (o mapas de features por stage)',
      idea: 'aprender un residuo F(x) y sumarlo a x: así se entrenan redes de 50+ capas', uso: 'clasificación, backbone de detección (DETR usa R50)' },
  }));
  add(card({
    id: 'yolo', anchor: true, family: 'detect',
    title: 'YOLO', titleEn: 'You Only Look Once', short: 'YOLO (ya lo sabes)',
    summary: 'Lo que ya sabes: detección en una etapa sobre una grilla (anchors en YOLOv2–v7; v1 y v8+ son anchor-free), IoU, NMS y mAP. DETR y YOLO-World se explican contra él.',
    freq: A, from: [], to: ['detr', 'yolo-world', 'bytetrack'],
    paper: { title: 'You Only Look Once: Unified, Real-Time Object Detection', authors: 'Redmon et al.', venue: 'CVPR 2016', arxiv: '1506.02640' },
    card: { in: 'imagen', out: 'cajas + clases + confianza (después de NMS)',
      idea: 'cada celda de la grilla (con o sin anchors, según la versión) predice cajas en una sola pasada; YOLOv10 ya no necesita NMS', uso: 'detección en tiempo real, edge' },
  }));
  add(card({
    id: 'gnn', phase: 12, family: 'otros',
    title: 'Graph Neural Networks', titleEn: 'Graph neural networks', short: 'GNNs',
    summary: 'Cada nodo actualiza su vector agregando mensajes de sus vecinos. La self-attention es un caso particular: un grafo completo cuyos pesos de arista se calculan desde el contenido (como en GAT).',
    freq: B, from: [], to: [],
    paper: { title: 'Semi-Supervised Classification with Graph Convolutional Networks', authors: 'Kipf & Welling', venue: 'ICLR 2017', arxiv: '1609.02907' },
    card: { in: 'grafo (nodos con features + aristas)', out: 'embedding por nodo o por grafo',
      idea: 'message passing: agregar los vecinos, transformar, repetir', uso: 'moléculas, redes sociales, fraude, recomendación' },
  }));
  add(card({
    id: 'mamba', phase: 12, family: 'otros',
    title: 'Mamba / modelos de espacio de estados', titleEn: 'State space models (Mamba)', short: 'Mamba / SSMs',
    summary: 'Una recurrencia lineal con parámetros que dependen de la entrada, calculada con un scan paralelo: costo lineal en la longitud de secuencia y estado de tamaño fijo en inferencia.',
    freq: B, from: [], to: [],
    paper: { title: 'Mamba: Linear-Time Sequence Modeling with Selective State Spaces', authors: 'Gu & Dao', venue: 'COLM 2024', arxiv: '2312.00752' },   // verificar venue
    card: { in: 'secuencia de tokens', out: 'secuencia de salidas (como un decoder)',
      idea: 'estado oculto de tamaño fijo con transiciones selectivas: sin matriz N×N ni KV cache que crezca', uso: 'secuencias muy largas, híbridos atención + SSM' },
  }));
  add(card({
    id: 'gan', phase: 12, family: 'gen',
    title: 'GANs', titleEn: 'Generative adversarial networks', short: 'GANs',
    summary: 'Un generador y un discriminador que compiten. Muestrean en una sola pasada, pero son inestables de entrenar; la difusión las desplazó en calidad y diversidad.',
    freq: B, from: [], to: ['stable-diffusion'],
    paper: { title: 'Generative Adversarial Nets', authors: 'Goodfellow et al.', venue: 'NeurIPS 2014', arxiv: '1406.2661' },
    card: { in: 'ruido z', out: 'imagen',
      idea: 'minimax: el generador engaña a un discriminador que aprende a la vez', uso: 'super-resolución, generación rápida, data augmentation' },
  }));
  add(card({
    id: 'rnn-lstm', phase: 12, family: 'otros',
    title: 'RNN / LSTM', titleEn: 'Recurrent networks (RNN, LSTM)', short: 'RNN / LSTM',
    summary: 'Procesan la secuencia token a token con un estado oculto. La LSTM agrega compuertas para no perder el gradiente; la atención las reemplazó porque se entrena en paralelo.',
    freq: M, from: [], to: ['repaso-atencion'],
    paper: { title: 'Long Short-Term Memory', authors: 'Hochreiter & Schmidhuber', venue: 'Neural Computation 1997' },   // verificar: sin arXiv (1997); añadir url en F12
    card: { in: 'secuencia', out: 'un estado por paso',
      idea: 'h_t = f(h_{t−1}, x_t): memoria recurrente con compuertas', uso: 'series de tiempo, modelos chicos en edge, historia de los transformers' },
  }));
  add(card({
    id: 'nerf-3dgs', phase: 14, family: 'robot',
    title: 'NeRF y Gaussian Splatting', titleEn: 'NeRF and 3D Gaussian Splatting', short: 'NeRF / 3DGS',
    summary: 'Representar una escena 3D a partir de fotos: NeRF con un MLP que da color y densidad por punto; Gaussian Splatting con millones de gaussianas que se rasterizan en tiempo real.',
    freq: B, from: [], to: [],
    paper: { title: 'NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis', authors: 'Mildenhall et al.', venue: 'ECCV 2020', arxiv: '2003.08934' },
    card: { in: 'fotos de una escena con poses de cámara', out: 'vistas nuevas (y geometría)',
      idea: 'NeRF: volume rendering de un MLP; 3DGS: gaussianas 3D rasterizadas', uso: 'reconstrucción de escenas, simulación para robots, digital twins' },
  }));

  // ------------------------------------------------------------------ páginas especiales
  const special = (o) => Object.assign({ kind: 'special' }, o);
  add(special({ id: 'inicio', title: 'Inicio', short: 'Inicio',
    summary: 'Qué es el atlas, tu progreso por familia, dónde te quedaste y la hoja de ruta.' }));
  add(special({ id: 'mapa', title: 'Mapa de arquitecturas', titleEn: 'Architecture map', short: 'Mapa',
    summary: 'Todas las familias y cómo se relacionan (hereda, usa, contrasta, reemplaza), con una tarjeta de nivel 1 por modelo y la tabla "¿qué familia uso para…?".' }));
  add(special({ id: 'practica', title: 'Ejercicios', titleEn: 'Practice', short: 'Ejercicios',
    summary: 'Diagramas en blanco, "¿qué forma tiene este tensor?" y "¿qué pasa si duplico…?", generados por el calculador para cada modelo listo.' }));
  add(special({ id: 'flashcards', title: 'Flashcards', titleEn: 'Flashcards', short: 'Flashcards',
    summary: 'Repetición espaciada (Leitner, 5 cajas) de formas, fórmulas, conteos, conceptos y trampas.' }));
  add(special({ id: 'ref-formas', title: 'Formas y fórmulas', titleEn: 'Shapes & formulas sheet', short: 'Formas y fórmulas',
    summary: 'Parámetros, MACs y forma de salida de cada primitiva; tabla comparativa de los modelos listos; convención MACs vs FLOPs y reglas prácticas (verificadas por el calculador, más la de entrenamiento: 6·params·tokens).' }));
  add(special({ id: 'glosario', title: 'Glosario ES–EN', titleEn: 'Glossary', short: 'Glosario',
    summary: 'Cada término como se dice en una entrevista en inglés, con su definición en español y una frase de ejemplo.' }));
  add(special({ id: 'buscar', title: 'Buscar', titleEn: 'Search', short: 'Buscar',
    summary: 'Busca en páginas, secciones, bloques de los diagramas, glosario y flashcards.' }));

  // ------------------------------------------------------------------ relaciones tipadas del Mapa
  // Semántica (from → to): hereda = "to desciende de from" (o toma de él su técnica central);
  // usa = "to usa a from como componente" (o consume su salida como etapa previa del embudo);
  // contrasta = "to es la alternativa a from" (la etiqueta dice en qué); reemplaza = "to reemplazó a from".
  // Debe coincidir arista por arista con js/content/diagrams/mapa.js (el validador lo comprueba).
  const relations = [
    { from: 'repaso-atencion', to: 'vit', kind: 'hereda', label: 'encoder sobre patches' },
    { from: 'resnet', to: 'vit', kind: 'contrasta', label: 'sin convoluciones en el cuerpo' },
    { from: 'vit', to: 'swin', kind: 'hereda', label: 'ventanas + jerarquía' },
    { from: 'vit', to: 'clip', kind: 'usa', label: 'encoder de imagen' },
    { from: 'yolo', to: 'detr', kind: 'contrasta', label: 'sin anchors ni NMS' },
    { from: 'resnet', to: 'detr', kind: 'usa', label: 'backbone R50' },
    { from: 'detr', to: 'grounding-dino', kind: 'hereda', label: 'DETR + texto' },
    { from: 'swin', to: 'grounding-dino', kind: 'usa', label: 'backbone Swin-T' },
    { from: 'yolo', to: 'yolo-world', kind: 'hereda', label: 'vocabulario abierto' },
    { from: 'clip', to: 'yolo-world', kind: 'usa', label: 'text encoder' },
    { from: 'vit', to: 'sam', kind: 'usa', label: 'image encoder ViT-H' },
    { from: 'sam', to: 'sam2', kind: 'hereda', label: 'memoria para video' },
    { from: 'repaso-atencion', to: 'llm-decoder', kind: 'hereda', label: 'decoder causal' },
    { from: 'llm-decoder', to: 'llm-inferencia', kind: 'hereda', label: 'KV cache, MoE' },
    { from: 'clip', to: 'llava', kind: 'usa', label: 'ViT-L/14 como encoder' },
    { from: 'llm-decoder', to: 'llava', kind: 'usa', label: 'LLM (Vicuna)' },
    { from: 'llava', to: 'qwen2-vl', kind: 'contrasta', label: 'resolución dinámica' },
    { from: 'clip', to: 'stable-diffusion', kind: 'usa', label: 'text encoder' },
    { from: 'gan', to: 'stable-diffusion', kind: 'reemplaza', label: 'difusión desplazó a las GANs' },
    { from: 'stable-diffusion', to: 'dit', kind: 'reemplaza', label: 'U-Net → transformer' },
    { from: 'vit', to: 'dit', kind: 'hereda', label: 'ViT sobre el latente' },
    { from: 'vit', to: 'rt2', kind: 'usa', label: 'ViT dentro del VLM' },
    { from: 'rt2', to: 'openvla', kind: 'hereda', label: 'versión abierta' },
    { from: 'llava', to: 'openvla', kind: 'hereda', label: 'VLM tipo LLaVA' },
    { from: 'openvla', to: 'pi0', kind: 'contrasta', label: 'acciones continuas' },
    { from: 'dit', to: 'pi0', kind: 'hereda', label: 'flow matching (la técnica)' },
    { from: 'repaso-atencion', to: 'bert', kind: 'hereda', label: 'encoder bidireccional' },
    { from: 'bert', to: 'grounding-dino', kind: 'usa', label: 'text encoder' },
    { from: 'bert', to: 'retrieval', kind: 'hereda', label: 'bi- / cross-encoder' },
    { from: 'ann', to: 'retrieval', kind: 'usa', label: 'índice de embeddings' },
    { from: 'repaso-atencion', to: 't5', kind: 'hereda', label: 'encoder-decoder' },
    { from: 'repaso-atencion', to: 'whisper', kind: 'hereda', label: 'encoder-decoder, entrada de audio' },
    { from: 'llm-decoder', to: 'lora', kind: 'usa', label: 'modelo base congelado' },
    { from: 'llm-decoder', to: 'rlhf-dpo', kind: 'usa', label: 'política = el LLM' },
    { from: 'rl-ppo', to: 'rlhf-dpo', kind: 'usa', label: 'PPO' },
    { from: 'retrieval', to: 'two-tower', kind: 'contrasta', label: 'mismo patrón bi-encoder, otro dominio' },
    { from: 'two-tower', to: 'dlrm', kind: 'usa', label: 'rankea sus candidatos' },
    { from: 'gbdt', to: 'dlrm', kind: 'contrasta', label: 'tabular: árboles vs redes' },
    { from: 'yolo', to: 'bytetrack', kind: 'usa', label: 'detecciones por frame' },
    { from: 'vit', to: 'depth', kind: 'usa', label: 'encoder de DPT' },
    { from: 'stable-diffusion', to: 'imitation', kind: 'hereda', label: 'difusión (DDPM) sobre acciones' },
    { from: 'imitation', to: 'pi0', kind: 'hereda', label: 'action chunking' },
    { from: 'rnn-lstm', to: 'repaso-atencion', kind: 'reemplaza', label: 'la atención reemplazó la recurrencia' },
    { from: 'llm-decoder', to: 'mamba', kind: 'contrasta', label: 'costo lineal' },
    { from: 'repaso-atencion', to: 'gnn', kind: 'contrasta', label: 'atención = grafo completo' },
    { from: 'resnet', to: 'pointnet', kind: 'contrasta', label: 'puntos sin grilla' },
    { from: 'depth', to: 'nerf-3dgs', kind: 'contrasta', label: '3D por escena' },
  ];

  // ------------------------------------------------------------------ hoja de ruta (espejo de docs/ROADMAP.md)
  const roadmap = [
    { phase: 1, block: 1, status: 'done', title: 'Fase 1 — El shell, los tres motores y ViT',
      items: ['repaso-atencion', 'vit', 'mapa', 'ref-formas', 'practica', 'flashcards', 'glosario'],
      note: 'La app completa (forkeada de la Ronda), el <b>motor de cálculo</b> (formas, parámetros, MACs) con tests y cross-check en PyTorch, el <b>motor de diagramas</b> (dos niveles de zoom, tensores proporcionales, recorrido, leyenda) y el de práctica. El Mapa con todas las familias, el repaso de atención enlazado al Laboratorio, <b>ViT-B/16</b> completo y la hoja de formas y fórmulas.' },
    { phase: 2, block: 1, status: 'done', title: 'Fase 2 — Swin y CLIP', items: ['swin', 'clip'],
      note: 'Swin contra la CNN jerárquica (stages, patch merging ≈ stride) y CLIP con sus dos encoders en paralelo e InfoNCE. Visualizaciones: ventanas desplazadas y matriz de similitud imagen-texto.' },
    { phase: 3, block: 1, status: 'done', title: 'Fase 3 — DETR', items: ['detr'],
      note: 'Contraste directo con YOLO: sin anchors, sin NMS, set prediction con matching húngaro (más Deformable DETR breve).' },
    { phase: 4, block: 1, status: 'done', title: 'Fase 4 — Detección de vocabulario abierto', items: ['grounding-dino', 'yolo-world'],
      note: 'Grounding DINO y YOLO-World: cómo entra el texto a un detector y qué cuesta en latencia.' },
    { phase: 5, block: 1, status: 'done', title: 'Fase 5 — SAM y SAM 2', items: ['sam', 'sam2'],
      note: 'Segmentación con prompts sobre el ViT de la fase 1, y memoria para video. Se usa junto con Grounding DINO (Grounded-SAM).' },
    { phase: 6, block: 1, status: 'next', title: 'Fase 6 — LLM decoder por dentro', items: ['llm-decoder', 'llm-inferencia'],
      note: 'RMSNorm, RoPE, SwiGLU, GQA/MQA, KV cache, prefill vs decode; MoE y cuantización en la página de inferencia. Va antes de los VLMs porque todos son "encoder de visión + el decoder que ya conoces".' },
    { phase: 7, block: 1, status: 'later', title: 'Fase 7 — VLMs: LLaVA y Qwen2-VL', items: ['llava', 'qwen2-vl'],
      note: 'De la imagen a tokens visuales dentro del prompt; resolución fija vs dinámica con M-RoPE.' },
    { phase: 8, block: 1, status: 'later', title: 'Fase 8 — Diffusion y flow matching', items: ['stable-diffusion', 'dit'],
      note: 'U-Net latente de Stable Diffusion y DiT; flow matching como línea recta entre ruido y dato (lo usa π0).' },
    { phase: 9, block: 1, status: 'later', title: 'Fase 9 — VLA: RT-2, OpenVLA, π0', items: ['rt2', 'openvla', 'pi0'],
      note: 'De imagen + instrucción a un chunk de acciones. Ligeras porque reutilizan las fases 6–8; RT-2 a nivel 2 parcial (pesos cerrados).' },
    { phase: 10, block: 2, status: 'later', title: 'Fase 10 — Fine-tuning y alineación', items: ['lora', 'rlhf-dpo'],
      note: 'LoRA/QLoRA, SFT, RLHF con PPO y DPO, con el conteo de parámetros entrenables.' },
    { phase: 11, block: 2, status: 'later', title: 'Fase 11 — BERT, embeddings y retrieval', items: ['bert', 'retrieval', 'ann'],
      note: 'BERT → bi-encoder → cross-encoder reranker, InfoNCE y búsqueda ANN (HNSW, IVF-PQ). Conecta con CLIP y con los casos de RAG de la Ronda.' },
    { phase: 12, block: 2, status: 'later', title: 'Fase 12 — Encoder-decoder y tarjetas de nivel 1', items: ['t5', 'whisper', 'gnn', 'mamba', 'gan', 'rnn-lstm'],
      note: 'T5 y Whisper (cross-attention), y las tarjetas completas de GNNs, Mamba/SSMs, GANs y RNN/LSTM. Fase ligera.' },
    { phase: 13, block: 2, status: 'later', title: 'Fase 13 — Recomendación y árboles', items: ['two-tower', 'dlrm', 'gbdt'],
      note: 'Two-tower + ranking (DLRM / Wide & Deep) y gradient boosted trees, y por qué siguen ganando en tabulares.' },
    { phase: 14, block: 3, status: 'later', title: 'Fase 14 — Percepción para robótica', items: ['bytetrack', 'depth', 'pointnet', 'nerf-3dgs'],
      note: 'Tracking (Kalman + matching húngaro), profundidad monocular, PointNet; NeRF y Gaussian Splatting a nivel 1. Opcional.' },
    { phase: 15, block: 3, status: 'later', title: 'Fase 15 — RL e imitation learning', items: ['rl-ppo', 'imitation'],
      note: 'Policy gradient, PPO, behavior cloning, ACT y Diffusion Policy; conecta con las fases 8 y 9. Opcional.' },
  ];

  ATLAS.defineCatalog({
    version: 1,
    families,
    items,
    relations,
    roadmap,
    flashcards: [],   // cada página trae las suyas
    glossary: [],     // cada página trae los suyos
  });
})(typeof window !== 'undefined' ? window : globalThis);
