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

  // Relaciones = catalog.relations, tal cual (mismo from, to, kind y label; el validador compara ambas
  // listas): se leen del catálogo para que el mapa no pueda desincronizarse. Semántica from → to:
  // hereda = "to desciende de from o toma de él su técnica central"; usa = "to usa a from como componente
  // o consume su salida (etapa anterior del embudo)"; contrasta = "alternativa, sin dirección";
  // reemplaza = "to reemplazó a from". La ruta de cada curva la calcula el motor (evita nodos y títulos);
  // ROUTE permite fijar lados o puntos de paso (via, en unidades) para una relación concreta.
  // Rutas fijadas (salen del enrutador automático; fijarlas evita recalcular al abrir el mapa).
  // Una relación nueva sin entrada aquí se enruta sola; el validador exige que no pase por detrás de
  // ningún nodo ni sobre un título (ATLAS.ArchDiagram.mapCheck).
  const ROUTE = {
    'repaso-atencion>vit': {fromSide: 'left', toSide: 'top', via: [[83.6, 22.5], [83.6, 46.5]]},
    'resnet>vit': {fromSide: 'right', toSide: 'left', off: 56},
    'swin>grounding-dino': {fromSide: 'left', toSide: 'left'},
    'clip>yolo-world': {fromSide: 'left', toSide: 'right'},
    'vit>sam': {fromSide: 'bottom', toSide: 'left'},
    'clip>llava': {fromSide: 'right', toSide: 'bottom'},
    'llm-decoder>llava': {fromSide: 'right', toSide: 'top', off: 56},
    'llava>qwen2-vl': {},
    'clip>stable-diffusion': {fromSide: 'bottom', toSide: 'right', via: [[65.4, 44.5], [65.4, 81.5]]},
    'vit>dit': {},
    'dit>pi0': {fromSide: 'right', toSide: 'bottom'},
    'bert>grounding-dino': {fromSide: 'bottom', toSide: 'top', via: [[127, 33.5], [62.6, 33.5]]},
    'repaso-atencion>t5': {fromSide: 'right', toSide: 'left'},
    'repaso-atencion>whisper': {fromSide: 'right', toSide: 'bottom', off: -56},
    'llm-decoder>rlhf-dpo': {fromSide: 'left', toSide: 'right'},
    'gbdt>dlrm': {fromSide: 'right', toSide: 'right'},
    'yolo>bytetrack': {fromSide: 'left', toSide: 'top', via: [[20.6, 33.5], [20.6, 68.5]]},
    'vit>depth': {fromSide: 'bottom', toSide: 'right'},
    'imitation>pi0': {},
    'rnn-lstm>repaso-atencion': {fromSide: 'right', toSide: 'left'},
    'repaso-atencion>gnn': {fromSide: 'right', toSide: 'right', bend: 0.7, off: -56},
    'llava>openvla': { fromSide: 'right', toSide: 'right', via: [[105.4, 36], [105.4, 58]] },
  };
  const cat = ATLAS.catalog ? ATLAS.catalog() : null;
  const edges = ((cat && cat.relations) || []).map((r) => Object.assign({ from: r.from, to: r.to, kind: r.kind, label: r.label }, ROUTE[r.from + '>' + r.to] ? Object.assign({ pin: true }, ROUTE[r.from + '>' + r.to]) : {}));

  ATLAS.registerDiagram({
    id: 'mapa-overview', kind: 'map', title: 'Mapa de familias', page: 'mapa', section: 'mapa',
    caption: 'Familias (regiones) y modelos (nodos). Pasa el cursor o enfoca un nodo para ver solo sus relaciones; tócalo para abrir su ficha.',
    grid: { w: 149, h: 90 }, direction: 'lr', edgeRoute: 'curve',
    // Las curvas rodean nodos y títulos (ATLAS.ArchDiagram.mapCheck); a cambio quedan 12 cruces entre
    // relaciones, medidos sobre la geometría del motor (al enfocar un nodo solo se ven las suyas).
    maxCrossings: 13,
    // En el teléfono el mapa abre con zoom sobre el núcleo (Transformer → ViT → CLIP → LLaVA); se recorre arrastrando.
    mobileFocus: ['repaso-atencion', 'llava', 'clip', 'vit'],
    groups, nodes, edges,
    legend: 'auto',
  });
})(typeof window !== 'undefined' ? window : globalThis);
