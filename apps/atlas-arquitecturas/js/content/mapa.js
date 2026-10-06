/* =============================================================================
   Atlas de Arquitecturas — js/content/mapa.js
   Página especial `mapa` (SPEC §5.5): el diagrama de familias y relaciones (mapa-overview,
   spec en js/content/diagrams/mapa.js), la tabla "¿qué familia uso para…?", los tres sabores de
   transformer y una tarjeta por familia y por modelo. Las tarjetas las arma el shell desde el
   catálogo (bloque `card`); este archivo solo decide el orden y el texto alrededor. Sin DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const cat = (ATLAS.catalog && ATLAS.catalog()) || { items: {}, families: [] };
  const items = Object.values(cat.items || {});
  const byOrder = (a, b) => ((a.block || 0) - (b.block || 0)) || ((a.num || 0) - (b.num || 0));
  const modelsOf = (block) => items.filter((it) => it.kind === 'model' && it.block === block).sort(byOrder);
  const cards = (list) => list.map((it) => ({ t: 'card', model: it.id }));
  const level1 = items.filter((it) => it.kind === 'card').sort((a, b) => (b.anchor ? 1 : 0) - (a.anchor ? 1 : 0));

  ATLAS.register({
    id: 'mapa',
    kind: 'special',
    sections: [
      // ======================================================== 1
      {
        id: 'mapa', title: 'El mapa', titleEn: 'The map', priority: 'core',
        blocks: [
          { t: 'p', html: `Cada región es una familia y cada nodo un modelo. Las aristas dicen cómo se relacionan: <b>hereda</b> (desciende de), <b>usa</b> (lo lleva adentro como componente o consume su salida: LLaVA usa el encoder de CLIP; el ranking ordena los candidatos de two-tower), <b>contrasta</b> (es la alternativa: DETR contra YOLO) y <b>reemplaza</b> (lo desplazó). En gris, lo que ya sabes: ResNet y YOLO. Toca un nodo para ver su tarjeta; los modelos listos abren su página.` },
          { t: 'archdiagram', diagram: 'mapa-overview', wide: true, caption: 'Familias del atlas y sus relaciones. Gris: lo que ya conoces. Los modelos con página de nivel 2 lista se abren al tocarlos; los demás muestran su tarjeta.' },
          { t: 'callout', kind: 'connect', html: `<p>El camino más corto hacia los VLMs y los VLA pasa por tres nodos: <a href="#repaso-atencion">el repaso de atención</a> → <a href="#vit">ViT</a> → CLIP. Casi todo lo que está a la derecha del mapa es "un encoder de visión de esa línea + un projector + un decoder LLM".</p>` },
        ],
      },
      // ======================================================== 2
      {
        id: 'que-familia', title: '¿Qué familia uso para…?', titleEn: 'Which family for which task', priority: 'core',
        blocks: [
          { t: 'p', html: `La pregunta de diseño de toda entrevista, en una tabla. La columna "por qué" es lo que el entrevistador anota: la familia sale de la tarea y de las restricciones (datos, latencia, vocabulario), no de la moda.` },
          { t: 'table', caption: 'Tarea → familia → por qué',
            head: ['Si necesitas…', 'Familia', 'Por qué'],
            rows: [
              ['Clasificar imágenes con mucho preentrenamiento disponible', '<a href="#vit">ViT</a> / <a href="#swin">Swin</a>', 'con checkpoints grandes (CLIP, DINOv2, MAE) transfiere muy bien y entrega tokens listos para un modelo multimodal; ojo: una CNN moderna (ConvNeXt) con la misma receta rinde parecido'],
              ['Clasificar en edge o con latencia muy baja (o entrenar desde cero con pocos datos)', '<a href="#mapa.resnet">CNN</a>', 'las convoluciones están muy optimizadas en hardware chico y cuantizan bien; si entrenas desde cero, el sesgo inductivo (localidad, pesos compartidos) rinde con pocos datos. Con un checkpoint preentrenado, la arquitectura importa menos que el checkpoint'],
              ['Detectar clases fijas en tiempo real', '<a href="#mapa.yolo">YOLO</a>', 'una sola pasada, export maduro (ONNX/TensorRT) y muy optimizado para edge; sabes exactamente cómo falla (YOLOv10 incluso quita el NMS con asignación uno a uno)'],
              ['Detección end-to-end, sin anchors ni NMS', '<a href="#detr">DETR</a>', 'set prediction con matching húngaro: cada objeto lo predice una sola query'],
              ['Detectar clases que llegan como texto', '<a href="#grounding-dino">Grounding DINO</a> / <a href="#yolo-world">YOLO-World</a>', 'el texto entra al detector; Grounding DINO es más preciso, YOLO-World corre en tiempo real'],
              ['Segmentar el objeto que el usuario señala', '<a href="#sam">SAM</a> (video: <a href="#sam2">SAM 2</a>)', 'encoder pesado una vez por imagen, decoder liviano por cada prompt'],
              ['Clasificación zero-shot o búsqueda imagen ↔ texto', '<a href="#clip">CLIP</a>', 'imagen y texto en el mismo espacio: las clases son frases'],
              ['Preguntas sobre una imagen, OCR, describir', '<a href="#llava">LLaVA</a> / <a href="#qwen2-vl">Qwen2-VL</a>', 'el LLM razona sobre tokens visuales; Qwen2-VL conserva la resolución (documentos)'],
              ['Generar texto, chat, código, agentes', '<a href="#llm-decoder">LLM decoder-only</a>', 'next-token prediction preentrena con cualquier texto y genera con la misma pila'],
              ['Embeddings de texto para búsqueda o RAG', '<a href="#retrieval">bi-encoder</a> + <a href="#ann">ANN</a>', 'los documentos se codifican una vez y se indexan; la query cuesta una pasada'],
              ['Reordenar los mejores candidatos con precisión', '<a href="#retrieval">cross-encoder</a>', 'query y documento juntos: más preciso, demasiado caro para todo el corpus'],
              ['Traducir, resumir, transcribir audio', '<a href="#t5">T5</a> / <a href="#whisper">Whisper</a>', 'encoder-decoder: la entrada se procesa una vez, la salida se genera con cross-attention'],
              ['Generar o editar imágenes', '<a href="#stable-diffusion">Stable Diffusion</a> / <a href="#dit">DiT</a>', 'difusión latente: calidad y diversidad, a costa de varios pasos de denoising'],
              ['Que un robot siga instrucciones en lenguaje natural', '<a href="#openvla">OpenVLA</a> / <a href="#pi0">π0</a>', 'un VLM preentrenado aporta semántica; la salida son acciones (tokens o continuas)'],
              ['Aprender una política de demostraciones', '<a href="#imitation">imitation learning</a>', 'behavior cloning, ACT o Diffusion Policy con decenas de demostraciones'],
              ['Datos tabulares (fraude, riesgo, pricing)', '<a href="#gbdt">GBDT</a>', 'gana a las redes en tabulares de tamaño medio, entrena rápido y se interpreta mejor'],
              ['Recomendar entre millones de ítems', '<a href="#two-tower">two-tower</a> → <a href="#dlrm">ranking</a>', 'el embudo: recuperar barato con embeddings, ordenar caro unos cientos'],
              ['Nubes de puntos (LiDAR, cámaras de profundidad)', '<a href="#pointnet">PointNet</a>', 'función invariante al orden de los puntos; no hay grilla para convolucionar'],
              ['Seguir objetos a lo largo de un video', '<a href="#bytetrack">ByteTrack</a>', 'tracking por detección: Kalman + matching húngaro sobre IoU'],
            ] },
          { t: 'callout', kind: 'interview', html: `<p>Empieza por el baseline más simple que cumple la restricción más dura y nómbrala: "con 2,000 imágenes etiquetadas y un Jetson: fine-tuning de un backbone preentrenado (con 2,000 imágenes manda el checkpoint, no la arquitectura) y, para el Jetson, una CNN o un ViT chico en TensorRT, según lo que midas"; "si las clases cambian cada semana, un detector de vocabulario abierto antes que reentrenar YOLO".</p>` },
        ],
      },
      // ======================================================== 3
      {
        id: 'tres-sabores', title: 'Los tres sabores de transformer', titleEn: 'Encoder-only, decoder-only, encoder-decoder', priority: 'core',
        blocks: [
          { t: 'table', caption: 'Mismo bloque, distinta máscara y distinto objetivo',
            head: ['Sabor', 'Máscara', 'Objetivo', 'Ejemplos en el atlas'],
            rows: [
              ['Encoder-only', 'bidireccional: todos ven a todos', 'MLM, clasificación, contrastivo', '<a href="#vit">ViT</a>, <a href="#bert">BERT</a>, encoder de imagen de <a href="#clip">CLIP</a>, <a href="#sam">SAM</a> (encoder)'],
              ['Decoder-only', 'causal: i ve solo j ≤ i', 'next-token prediction', '<a href="#llm-decoder">Llama</a>; <a href="#llava">LLaVA</a> y <a href="#openvla">OpenVLA</a> (el LLM; el encoder de imagen va aparte)'],
              ['Encoder-decoder', 'bidireccional + causal, unidos por cross-attention', 'seq2seq', '<a href="#t5">T5</a>, <a href="#whisper">Whisper</a>; <a href="#detr">DETR</a> con queries aprendidas en vez de tokens y <b>sin</b> máscara causal (decodifica todas las queries en paralelo)'],
            ] },
          { t: 'p', html: `La explicación con números (las tres máscaras lado a lado, la forma de los scores y qué cuesta cada una) está en el <a href="#repaso-atencion.mascaras">repaso de atención</a>.` },
        ],
      },
      // ======================================================== 4
      {
        id: 'familias', title: 'Las familias', titleEn: 'Families', priority: 'core',
        blocks: [
          { t: 'p', html: `Una tarjeta por región del mapa, con sus modelos. Los que tienen página de nivel 2 lista son enlaces; los demás llegan en su fase (<a href="#inicio">hoja de ruta</a>).` },
          ...(cat.families || []).map((f) => ({ t: 'card', family: f.id })),
        ],
      },
      // ======================================================== 5
      {
        id: 'bloque-1', title: 'Bloque 1 — Visión + atención', titleEn: 'Block 1 — Vision + attention', priority: 'core',
        blocks: [
          { t: 'p', html: `Nivel 1 de cada modelo del bloque prioritario: entradas → salidas, la idea en una línea, dónde se usa y su tamaño canónico.` },
          ...cards(modelsOf(1)),
        ],
      },
      // ======================================================== 6
      {
        id: 'bloque-2', title: 'Bloque 2 — LLMs, retrieval y ML de industria', titleEn: 'Block 2 — LLMs, retrieval, industry ML', priority: 'extra',
        blocks: [
          { t: 'p', html: `Alineación, embeddings y retrieval, encoder-decoder, recomendación y árboles: lo que completa una entrevista de ML/AI Engineer fuera de visión.` },
          ...cards(modelsOf(2)),
        ],
      },
      // ======================================================== 7
      {
        id: 'bloque-3', title: 'Bloque 3 — Robótica', titleEn: 'Block 3 — Robotics', priority: 'extra',
        blocks: [
          { t: 'p', html: `Percepción y control para cuando el atlas llegue a robótica (opcional).` },
          ...cards(modelsOf(3)),
        ],
      },
      // ======================================================== 8
      {
        id: 'nivel-1', title: 'Solo nivel 1: lo que ya sabes y lo que basta reconocer', titleEn: 'Level-1 cards', priority: 'extra',
        blocks: [
          { t: 'p', html: `ResNet y YOLO son tus anclas: cada página del atlas se compara con ellas. Las demás tarjetas son familias que conviene saber ubicar y describir en dos frases; no tienen página de nivel 2 (sus tarjetas completas llegan en la fase 12 y la 14).` },
          ...cards(level1),
          { t: 'callout', kind: 'skip', html: `<p>Si tu objetivo inmediato son entrevistas de visión + LLMs, no inviertas tiempo aquí más allá de poder decir qué entra, qué sale y por qué existe cada una.</p>` },
        ],
      },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
