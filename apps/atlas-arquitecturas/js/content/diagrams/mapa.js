/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/mapa.js
   Diagrama del Mapa (SPEC §5.5, ids §13.3): familias como regiones, cada id del catálogo
   (recap, modelos y tarjetas) como nodo, y las relaciones tipadas hereda/usa/contrasta/reemplaza.
   Las aristas son exactamente catalog.relations (mismo from, to, kind y label); el validador
   compara ambas listas. El estado de cada nodo (listo / próximamente / tarjeta / ancla) lo pone
   el motor al dibujar, desde el catálogo. Solo datos; no toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // Rejilla de celdas de 21×11 u: cada nodo (16×4 u) ocupa una celda; una región es un rectángulo de
  // celdas con su nombre arriba. La posición de las regiones salió de una búsqueda (recocido simulado)
  // que minimiza cruces de relaciones y curvas que atraviesan nodos; luego se ajustó a mano.
  const CW = 21, CH = 11, NW = 16, NH = 4;
  const groups = [], nodes = [];
  const SHORT = {
    'repaso-atencion': 'Repaso de atención', 'llm-decoder': 'LLM decoder', 'llm-inferencia': 'Inferencia LLM',
    'grounding-dino': 'Grounding DINO', 'yolo-world': 'YOLO-World', 'stable-diffusion': 'Stable Diffusion',
    retrieval: 'Bi/cross-encoder', ann: 'ANN', 'two-tower': 'Two-tower', dlrm: 'DLRM', gbdt: 'GBDT',
    bytetrack: 'ByteTrack', depth: 'Depth (DPT)', 'rl-ppo': 'PPO', imitation: 'Imitation', 'nerf-3dgs': 'NeRF / 3DGS',
    'rnn-lstm': 'RNN / LSTM', mamba: 'Mamba / SSMs', gnn: 'GNNs', gan: 'GANs', lora: 'LoRA / QLoRA', 'rlhf-dpo': 'RLHF vs DPO',
    resnet: 'ResNet', yolo: 'YOLO', vit: 'ViT', swin: 'Swin', clip: 'CLIP', detr: 'DETR', sam: 'SAM', sam2: 'SAM 2',
    llava: 'LLaVA', 'qwen2-vl': 'Qwen2-VL', dit: 'DiT', rt2: 'RT-2', openvla: 'OpenVLA', pi0: 'π0', bert: 'BERT', t5: 'T5', whisper: 'Whisper', pointnet: 'PointNet',
  };
  function region(id, label, cx, cy, cols, rows, members) {
    const x = 1 + cx * CW, y = 1 + cy * CH;
    // id de región = 'fam-<familia>' (no choca con ids de nodo como 'vit'); family = id de catalog.families
    groups.push({ id: 'fam-' + id, family: id, label, region: true, x, y, w: cols * CW - 2, h: rows * CH - 2 });
    members.forEach((m, i) => {
      if (!m) return;
      const c = i % cols, r = Math.floor(i / cols);
      nodes.push({ id: m, label: SHORT[m] || m, x: x + c * CW + 2.5, y: y + r * CH + 5, w: NW, h: NH });
    });
  }

  region('llm', 'LLMs (decoder-only)', 1, 0, 1, 2, ['llm-inferencia', 'llm-decoder']);
  region('otros', 'Otras familias', 2, 0, 3, 1, ['mamba', 'rnn-lstm', 'gnn']);
  region('encdec', 'Encoder-decoder', 5, 0, 2, 1, ['t5', 'whisper']);
  region('align', 'Fine-tuning y alineación', 0, 1, 1, 2, ['lora', 'rlhf-dpo']);
  region('transformer', 'Transformer (la raíz)', 4, 1, 1, 1, ['repaso-atencion']);
  region('detect', 'Detección', 1, 2, 2, 2, ['yolo', 'yolo-world', 'detr', 'grounding-dino']);
  region('vlm', 'Visión-lenguaje', 3, 2, 2, 1, ['qwen2-vl', 'llava']);
  region('encoder', 'Encoder-only y retrieval', 6, 2, 1, 2, ['bert', 'retrieval']);
  region('contrastive', 'Contrastivo', 3, 3, 1, 1, ['clip']);
  region('search', 'Búsqueda vectorial', 5, 3, 1, 1, ['ann']);
  region('cnn', 'CNNs', 1, 4, 1, 1, ['resnet']);
  region('vit', 'Vision Transformers', 2, 4, 2, 1, ['swin', 'vit']);
  region('vla', 'Vision-Language-Action', 4, 4, 1, 3, ['rt2', 'openvla', 'pi0']);
  region('trees', 'Árboles', 5, 4, 1, 1, ['gbdt']);
  region('robot', 'Robótica', 0, 5, 3, 2, ['rl-ppo', 'pointnet', 'depth', 'bytetrack', 'nerf-3dgs', 'imitation']);
  region('recsys', 'Recomendación', 5, 5, 2, 1, ['dlrm', 'two-tower']);
  region('gen', 'Generativos de imagen', 1, 7, 3, 1, ['gan', 'stable-diffusion', 'dit']);
  region('seg', 'Segmentación', 5, 7, 2, 1, ['sam', 'sam2']);

  // Relaciones (= catalog.relations). Semántica from → to: hereda = "to desciende de from";
  // usa = "to usa a from como componente"; contrasta = "to es la alternativa a from"; reemplaza = "to reemplazó a from".
  const R = (from, to, kind, label, extra) => Object.assign({ from, to, kind, label }, extra || {});
  const edges = [
    R('repaso-atencion', 'vit', 'hereda', 'encoder sobre patches'),
    R('resnet', 'vit', 'contrasta', 'sin convolución'),
    R('vit', 'swin', 'hereda', 'ventanas + jerarquía'),
    R('vit', 'clip', 'usa', 'encoder de imagen'),
    R('yolo', 'detr', 'contrasta', 'sin anchors ni NMS'),
    R('resnet', 'detr', 'usa', 'backbone R50'),
    R('detr', 'grounding-dino', 'hereda', 'DETR + texto'),
    R('swin', 'grounding-dino', 'usa', 'backbone Swin-T'),
    R('yolo', 'yolo-world', 'hereda', 'vocabulario abierto'),
    R('clip', 'yolo-world', 'usa', 'text encoder'),
    R('vit', 'sam', 'usa', 'image encoder ViT-H'),
    R('sam', 'sam2', 'hereda', 'memoria para video'),
    R('repaso-atencion', 'llm-decoder', 'hereda', 'decoder causal'),
    R('llm-decoder', 'llm-inferencia', 'hereda', 'KV cache, MoE'),
    R('clip', 'llava', 'usa', 'ViT-L/14 como encoder'),
    R('llm-decoder', 'llava', 'usa', 'LLM (Vicuna)'),
    R('llava', 'qwen2-vl', 'contrasta', 'resolución dinámica'),
    R('clip', 'stable-diffusion', 'usa', 'text encoder'),
    R('gan', 'stable-diffusion', 'reemplaza', 'difusión desplazó a las GANs'),
    R('stable-diffusion', 'dit', 'reemplaza', 'U-Net → transformer'),
    R('vit', 'dit', 'hereda', 'ViT sobre el latente'),
    R('vit', 'rt2', 'usa', 'ViT dentro del VLM'),
    R('rt2', 'openvla', 'hereda', 'versión abierta'),
    R('llava', 'openvla', 'hereda', 'VLM tipo LLaVA'),
    R('openvla', 'pi0', 'contrasta', 'acciones continuas'),
    R('dit', 'pi0', 'usa', 'flow matching'),
    R('repaso-atencion', 'bert', 'hereda', 'encoder bidireccional'),
    R('bert', 'grounding-dino', 'usa', 'text encoder'),
    R('bert', 'retrieval', 'hereda', 'bi- / cross-encoder'),
    R('ann', 'retrieval', 'usa', 'índice de embeddings'),
    R('repaso-atencion', 't5', 'hereda', 'encoder-decoder'),
    R('t5', 'whisper', 'hereda', 'mismo esquema, audio'),
    R('llm-decoder', 'lora', 'usa', 'modelo base congelado'),
    R('llm-decoder', 'rlhf-dpo', 'usa', 'política = el LLM'),
    R('rl-ppo', 'rlhf-dpo', 'usa', 'PPO'),
    R('retrieval', 'two-tower', 'hereda', 'bi-encoder = two-tower'),
    R('two-tower', 'dlrm', 'contrasta', 'retrieval → ranking'),
    R('gbdt', 'dlrm', 'contrasta', 'tabular: árboles vs redes'),
    R('yolo', 'bytetrack', 'usa', 'detecciones por frame'),
    R('vit', 'depth', 'usa', 'encoder de DPT'),
    R('stable-diffusion', 'imitation', 'usa', 'Diffusion Policy'),
    R('imitation', 'pi0', 'hereda', 'action chunking'),
    R('rnn-lstm', 'repaso-atencion', 'reemplaza', 'la atención reemplazó la recurrencia'),
    R('llm-decoder', 'mamba', 'contrasta', 'costo lineal'),
    R('repaso-atencion', 'gnn', 'contrasta', 'atención = grafo completo'),
    R('resnet', 'pointnet', 'contrasta', 'puntos sin grilla'),
    R('depth', 'nerf-3dgs', 'contrasta', '3D por escena'),
  ];

  ATLAS.registerDiagram({
    id: 'mapa-overview', kind: 'map', title: 'Mapa de familias', page: 'mapa', section: 'familias',
    caption: 'Familias (regiones) y modelos (nodos). Pasa el cursor o enfoca un nodo para ver solo sus relaciones; tócalo para abrir su ficha.',
    grid: { w: 149, h: 90 }, direction: 'lr', edgeRoute: 'curve',
    // 47 relaciones curvas: quedan 2 cruces inevitables con esta distribución (al enfocar un nodo solo se ven las suyas)
    maxCrossings: 2,
    groups, nodes, edges,
    legend: 'auto',
  });
})(typeof window !== 'undefined' ? window : globalThis);
