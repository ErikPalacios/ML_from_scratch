/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/grounding-dino.js
   Diagramas de Grounding DINO (SPEC §7.2, ids de §16.1), config canónica grounding-dino-t:
     grounding-dino-overview  dos flujos: imagen a la izquierda (franja --mod-img: Swin-T → C3, C4, C5 →
                              proyección a D en 4 niveles → N tokens) y texto a la derecha (franja --mod-txt:
                              BERT → Linear 768 → D); los dos entran al feature enhancer ×6 (fusión en las dos
                              direcciones); la query selection elige los top-Q tokens de imagen por similitud
                              con el texto; el decoder ×6 consulta al texto (cross-attn) y a la imagen
                              (deformable); cabeza contrastiva (Q×T: queries × tokens de texto) + cabeza de
                              cajas; carril "solo entrenamiento" (consultas con ruido, matching, pérdida).
       gdino-enhancer-layer   la capa del enhancer: fusión imagen → texto y texto → imagen (aristas cruzadas,
                              los mismos scores transpuestos), self-attn del texto con la máscara de
                              sub-oraciones, self-attn deformable de la imagen, FFNs (post-LN)
       gdino-decoder-layer    self-attn → cross-attn al texto → cross-attn deformable a la imagen → FFN
                              (post-LN) y el refinamiento de cajas con los pesos de la cabeza
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas de las aristas las pone el motor desde
   ATLAS.Arch.run(config); aquí solo se nombran tensores. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'grounding-dino-t';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const PAGE = { page: 'grounding-dino', section: 'diagrama' };
  // Los ids de nodo se repiten entre ramas del calculador (ln1, ffn, add-qpos…): scope limita el costo de cada
  // nodo a su rama (enhancer / decoder).
  const scoped = (scope, nodes) => nodes.map((n) => (n.op === 'io' ? n : Object.assign({ scope }, n)));

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'grounding-dino-overview', model: 'grounding-dino', config: C, kind: 'arch', title: 'Grounding DINO — vista general',
    caption: 'Detección de vocabulario abierto: la imagen (izquierda) y el prompt (derecha, "cat . dog .") se codifican por separado y se fusionan en las dos direcciones en el feature enhancer. El texto elige qué tokens de imagen arrancan como queries y el decoder los consulta a los dos. La cabeza de clase ya no tiene K clases fijas: cada query se compara con cada token del texto (Q×T), y la frase de la caja son los tokens con logit alto.',
    grid: { w: 120, h: 180 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['img-input', 'img-backbone', 'img-proj'],   // a 375 px, la columna de la imagen legible (se arrastra para ver el texto)
    groups: [
      { id: 'enhancer-stack', label: 'Feature enhancer', x: 2, y: 52, w: 116, h: 18, repeat: { sym: 'L_e', from: 'Lenc', totalOf: 'enhancer' } },
      { id: 'decoder-stack', label: 'Decoder', x: 2, y: 95, w: 58, h: 18, repeat: { sym: 'L_d', from: 'Ldec', totalOf: 'decoder' }, modality: 'qry' },
      { id: 'train', style: 'train', label: 'Solo entrenamiento', labelPos: 'bottom-right', x: 2, y: 161, w: 116, h: 18 },
    ],
    nodes: [
      { id: 'img-input', op: 'io', label: 'Imagen', image: true, imageGrid: 0, x: 19, y: 1, w: 14, h: 12,
        note: 'La imagen de entrada, H×W×3. Aquí 896×1344: cada stage de Swin-T queda en un múltiplo exacto de la ventana de 7×7, sin relleno (el entrenamiento estilo DINO usa lado corto 800 y Swin rellena).' },
      { id: 'txt-input', op: 'io', modality: 'txt', label: 'Prompt de texto', sub: '"cat . dog ." → T ids', subNum: '"cat . dog ." → {{cfg.T}} ids', x: 79, y: 3, w: 30, h: 8,
        note: 'El texto con las categorías separadas por puntos ("cat . dog ."), tokenizado con WordPiece de BERT entre [CLS] y [SEP] y rellenado hasta T. Junto a los ids sale la máscara de sub-oraciones: cada categoría solo se atiende a sí misma (y las posiciones reinician en cada una), así "cat" no se mezcla con "dog".' },
      { id: 'img-backbone', op: 'attn', modality: 'img', label: 'Backbone Swin-T', sub: 'stages 2–4: strides 8, 16, 32', x: 4, y: 19, w: 44, h: 8,
        tex: 'C_3, C_4, C_5 = \\mathrm{SwinT}(x)',
        note: 'El Swin-T de la página de Swin, sin clasificador: se toman las salidas de los stages 2, 3 y 4 (C3, C4, C5, cada una con su LayerNorm). Es una pirámide como la de una CNN: mucha resolución con pocos canales arriba, poca resolución con muchos canales abajo.' },
      { id: 'txt-backbone', op: 'attn', modality: 'txt', label: 'BERT-base', sub: 'L_t capas · 768 · post-LN', subNum: '{{cfg.Lt}} capas · {{cfg.Dtxt}} · post-LN', x: 72, y: 19, w: 44, h: 8,
        tex: 'h_{txt} = \\mathrm{BERT}(t) \\in \\mathbb{R}^{T\\times 768}',
        note: 'Un BERT-base (12 capas post-LN de 768, 12 cabezas) con la máscara de sub-oraciones en la atención. Corre en CADA imagen: el prompt forma parte del forward. Ábrelo en la página de Grounding DINO para ver su costo.' },
      { id: 'img-proj', op: 'embed', badgePos: 'right', label: 'Proyección multiescala', sub: 'conv + GN → D · 4 niveles', subNum: 'conv + GN → {{cfg.D}} · {{cfg.levels}} niveles', x: 4, y: 40, w: 44, h: 6,
        tex: 'z^{(l)} = \\mathrm{GN}(\\mathrm{Conv}(C_{l+2})) \\in \\mathbb{R}^{H_l\\times W_l\\times D}',
        note: 'Cada nivel pasa a D canales con una conv 1×1 + GroupNorm (el 4.º nivel, stride 64, con una conv 3×3 de stride 2 sobre C5). Los 4 mapas se aplanan y se concatenan en una sola secuencia de N tokens, cada uno con su posición seno y un embedding de nivel aprendido.' },
      { id: 'txt-proj', op: 'embed', label: 'Proyección del texto', sub: 'Linear 768 → D', subNum: 'Linear {{cfg.Dtxt}} → {{cfg.D}}', x: 72, y: 40, w: 44, h: 6,
        tex: 't = h_{txt} W_t + b_t,\\; W_t \\in \\mathbb{R}^{768\\times D}', note: 'Lleva cada token de texto al ancho D del transformer, el mismo que los tokens de imagen.' },
      { id: 'enhancer', op: 'fuse', style: 'block', label: 'Capa del feature enhancer', x: 8, y: 57.5, w: 104, h: 11, expand: 'gdino-enhancer-layer',
        mini: { items: [{ label: 'imagen → texto', op: 'fuse' }, { label: 'texto → imagen', op: 'fuse' }, { label: 'self (texto)', op: 'attn' }, { label: 'FFN', op: 'mlp' }, { label: 'self deformable (imagen)', op: 'attn' }, { label: 'FFN', op: 'mlp' }] },
        tex: "\\begin{aligned} x', t' &= \\mathrm{Fusión}(x, t)\\;\\;(x \\leftarrow t,\\; t \\leftarrow x) \\\\ t'' &= \\mathrm{FFN}(\\mathrm{SA}(t')) \\\\ x'' &= \\mathrm{FFN}(\\mathrm{DeformSA}(x')) \\end{aligned}",
        note: 'Cada capa cruza los dos flujos en las dos direcciones: los tokens de imagen consultan al texto y los de texto a la imagen (con los MISMOS scores, transpuestos). Después cada flujo hace lo suyo: el texto, self-attention con la máscara de sub-oraciones; la imagen, self-attention deformable (como Deformable DETR). Ábrela para ver cada paso.' },
      { id: 'query-select', op: 'fuse', label: 'Selección de queries', sub: 'top-Q por similitud con el texto', subNum: 'top-{{cfg.Q}} por similitud con el texto', x: 16, y: 82, w: 32, h: 7,
        tex: '\\mathrm{idx} = \\mathrm{TopK}_{Q}\\big(\\max_{t}\\, X_I X_T^{\\top}\\big)',
        note: 'Language-guided query selection: cada token de imagen se compara con cada token de texto (N×T productos punto); su puntaje es el máximo sobre el texto, y los Q mejores se vuelven queries. La caja predicha en esos tokens da la parte POSICIONAL de cada query; la parte de CONTENIDO es aprendida (como en DINO).' },
      { id: 'decoder', op: 'attn', style: 'block', label: 'Capa del decoder', x: 6, y: 100.5, w: 50, h: 10.5, expand: 'gdino-decoder-layer',
        mini: { items: [{ label: 'self', op: 'attn' }, { label: '× texto', op: 'fuse' }, { label: '× imagen (def.)', op: 'attn' }, { label: 'FFN', op: 'mlp' }] },
        tex: "\\begin{aligned} q' &= \\mathrm{SA}(q) \\\\ q'' &= \\mathrm{CA}(q', t_{mem}) \\\\ q''' &= \\mathrm{DeformCA}(q'', x_{mem}) \\end{aligned}",
        note: 'Cross-modality decoder: las Q queries se miran entre ellas, consultan a los tokens de texto (cross-attention densa, Q×T) y a la imagen (cross-attention deformable alrededor de su caja), cada paso con su residual y su LayerNorm (post-LN). Al final de cada capa la caja se refina.' },
      { id: 'dec-norm', op: 'norm', label: 'LayerNorm final', x: 10, y: 119, w: 42, h: 5, tex: 'h = \\mathrm{LN}(q^{(L_d)})', note: 'Una LayerNorm sobre la salida de la última capa (también sobre las intermedias para las pérdidas auxiliares).' },
      { id: 'box-head', op: 'head', label: 'Cabeza de caja', sub: 'MLP 3 capas', x: 6, y: 130, w: 20, h: 7,
        tex: '\\hat b = \\sigma\\big(\\mathrm{MLP}(h) + \\sigma^{-1}(b_{ref})\\big)', note: 'Un MLP (D → D → D → 4) predice un ajuste de la caja de referencia, en logit, y una sigmoide la deja en [0, 1]. Es el mismo MLP que refina las cajas en cada capa del decoder (pesos compartidos).' },
      { id: 'contrastive-head', op: 'head', label: 'Cabeza contrastiva', sub: 'query · token de texto', x: 30, y: 130, w: 26, h: 7,
        tex: '\\text{logits} = h\\, t_{mem}^{\\top} \\in \\mathbb{R}^{Q\\times T}',
        note: 'En vez de una capa lineal a K clases fijas, cada query se compara (producto punto) con cada token del texto: Q×T logits. Las clases son lo que diga el prompt; no hay pesos de clase (0 parámetros). HF rellena hasta 256 columnas con −∞.' },
      { id: 'output', op: 'io', label: 'Cajas + frases', sub: 'cada caja → sus tokens con logit alto', x: 8, y: 146, w: 48, h: 8,
        note: 'Cada query da una caja y Q×T → una fila de T logits. Se quedan las cajas cuyo máximo pasa un umbral, y su frase son los tokens de texto con logit alto (con "cat . dog .": "cat" o "dog"). Como DETR: sin NMS en el modelo.' },
      { id: 'denoise', op: 'io', label: 'Consultas con ruido', sub: 'DINO: CDN', x: 6, y: 165, w: 20, h: 7,
        note: 'Contrastive denoising de DINO: en el entrenamiento se agregan queries hechas con las cajas reales con ruido (positivas, a reconstruir) y con más ruido (negativas, a rechazar). Estabilizan el matching y aceleran la convergencia. No existen en la inferencia (el calculador no las cuenta).' },
      { id: 'gt', op: 'io', label: 'G objetos anotados', sub: '(caja, frase)', subNum: 'G = {{cfg.G}} (caja, frase)', x: 30, y: 165, w: 24, h: 7,
        note: 'Las cajas anotadas con su frase (los tokens del prompt que la nombran). Solo en el entrenamiento.' },
      { id: 'matching', op: 'head', label: 'Matching húngaro', sub: 'costo Q×G → 1 a 1', x: 62, y: 165, w: 24, h: 7,
        tex: '\\hat\\sigma = \\arg\\min_{\\sigma} \\sum_i \\mathcal{C}(y_i, \\hat y_{\\sigma(i)})',
        note: 'Como en DETR: matriz de costos Q×G (clase con la forma de la focal sobre los tokens de la frase, L1 y GIoU de la caja) y el algoritmo húngaro elige la asignación 1 a 1 de menor costo. Sin gradiente.' },
      { id: 'loss', op: 'head', label: 'Pérdida', sub: 'focal + L1 + GIoU', x: 92, y: 165, w: 24, h: 7,
        tex: '\\mathcal{L} = \\mathcal{L}_{focal}(\\text{logits}) + \\lambda_{L1}\\mathcal{L}_{L1} + \\lambda_{giou}\\mathcal{L}_{giou}',
        note: 'Focal loss sobre los logits por token (contrastivos: el objetivo de una query emparejada son los tokens de su frase) + L1 y GIoU de la caja, también en cada capa del decoder (pérdidas auxiliares).' },
    ],
    tensors: [
      { id: 'logits', at: { edge: 'contrastive-head>output' }, show: 'both', glyph: 'matrix', diag: false, axes: { rows: 'qry', cols: 'txt' } },
    ],
    notes: [
      { x: 60, y: 31.6, text: 'flujos', anchor: 'middle' },
      { x: 60, y: 33.4, text: 'independientes', anchor: 'middle' },
      { x: 60, y: 50.6, text: 'se cruzan aquí ↓', cls: 'ink', anchor: 'middle' },
      { x: 66, y: 139.6, text: 'filas: queries', swatch: 'qry' },
      { x: 66, y: 141.4, text: 'columnas: tokens del texto', swatch: 'txt' },
      { x: 66, y: 143.2, text: '(no K clases fijas)' },
    ],
    edges: [
      { from: 'img-input', to: 'img-backbone', kind: 'data', tensor: 'i-img' },
      { from: 'txt-input', to: 'txt-backbone', kind: 'data', tensor: 't-ids', fromAt: 0.4, toAt: 0.4091 },
      { from: 'txt-input', to: 'txt-backbone', kind: 'control', fromSide: 'right', toSide: 'right', via: [[112, 7], [112, 22]], tag: 'máscara', tagStyle: 'plain', tagSeg: 1, tagT: 0.5, tagSide: 'on' },
      // la pirámide: tres salidas del backbone (strides 8, 16, 32) hacia la proyección
      { from: 'img-backbone', to: 'img-proj', kind: 'data', tensor: 'i-c3', fromAt: 0.04, toAt: 0.04 },
      { from: 'img-backbone', to: 'img-proj', kind: 'data', tensor: 'i-c4', fromAt: 0.37, toAt: 0.37 },
      { from: 'img-backbone', to: 'img-proj', kind: 'data', tensor: 'i-c5', fromAt: 0.7, toAt: 0.7 },
      { from: 'txt-backbone', to: 'txt-proj', kind: 'data', tensor: 't-bert-out', fromAt: 0.4091, toAt: 0.4091 },
      { from: 'img-proj', to: 'enhancer', kind: 'data', tensor: 'i-mem-in', fromAt: 0.5, toAt: 0.1731, labelT: 0.2 },
      { from: 'txt-proj', to: 'enhancer', kind: 'data', tensor: 't-feat', fromAt: 0.4091, toAt: 0.7404 },
      // salidas del enhancer: imagen a la selección (y al decoder, por la izquierda); texto a la selección,
      // al decoder y a la cabeza contrastiva (por la derecha)
      { from: 'enhancer', to: 'query-select', kind: 'data', tensor: 'i-memory', fromAt: 0.2308, toAt: 0.5, labelT: 0.4 },
      { from: 'enhancer', to: 'decoder', kind: 'cross', tensor: 'i-memory', fromAt: 0.0654, toAt: 0.176, label: false, tag: 'imagen (deformable)', tagSide: 'on', tagT: 0.78 },
      { from: 'enhancer', to: 'query-select', kind: 'data', tensor: 't-memory', fromAt: 0.7692, toSide: 'right', labelSeg: 0, labelT: 0.45 },
      { from: 'enhancer', to: 'decoder', kind: 'cross', tensor: 't-memory', fromAt: 0.8846, toSide: 'right', toAt: 0.5238, label: false, tag: 'K,V: texto', tagSeg: 1, tagT: 0.5, tagSide: 'on' },
      { from: 'enhancer', to: 'contrastive-head', kind: 'data', tensor: 't-memory', fromAt: 0.9808, toSide: 'right', label: false, tag: 'texto', tagStyle: 'plain', tagSeg: 1, tagT: 0.3, tagSide: 'on' },
      { from: 'query-select', to: 'decoder', kind: 'data', tensor: 'q-ref0', fromAt: 0.25, toAt: 0.36, labelT: 0.22 },
      { from: 'query-select', to: 'decoder', kind: 'query', tensor: 'q-tgt0', fromAt: 0.75, toAt: 0.68, labelT: 0.22 },
      { from: 'decoder', to: 'dec-norm', kind: 'data', tensor: 'q-out', fromAt: 0.5, toAt: 0.5, labelT: 0.6 },
      { from: 'dec-norm', to: 'box-head', kind: 'data', tensor: 'hs', fromAt: 0.2, toAt: 0.62, label: false },
      { from: 'dec-norm', to: 'contrastive-head', kind: 'data', tensor: 'hs', fromAt: 0.8, toAt: 0.5231 },
      { from: 'box-head', to: 'output', kind: 'data', tensor: 'boxes', fromAt: 0.5, toAt: 0.1667, labelSide: 'left' },
      { from: 'contrastive-head', to: 'output', kind: 'data', tensor: 'logits', fromAt: 0.5, toAt: 0.7292, labelSide: 'right' },
      // entrenamiento
      { from: 'denoise', to: 'decoder', kind: 'control', fromSide: 'left', toSide: 'left', toAt: 0.75, via: [[3.5, 168.5], [3.5, 107.4]], tag: 'CDN', tagStyle: 'plain', tagSeg: 1, tagT: 0.45, tagSide: 'on' },
      { from: 'output', to: 'matching', kind: 'control', fromSide: 'right', toSide: 'top', toAt: 0.5, tag: 'predicciones', tagStyle: 'plain', tagSeg: 0, tagT: 0.5 },
      { from: 'gt', to: 'matching', kind: 'data', tensor: 'gt-boxes', fromSide: 'right', toSide: 'left', labelSide: 'below' },
      { from: 'matching', to: 'loss', kind: 'data', tensor: 'assignment', labelSide: 'below' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (Grounding DINO-T @ 896×1344, prompt "cat . dog .")', steps: [
        { nodes: ['img-input', 'txt-input'], edges: ['img-input>img-backbone', 'txt-input>txt-backbone'], tensors: ['i-img', 't-ids'],
          text: 'Entran dos cosas: una imagen de <b>' + q('tensor.i-img.shape') + '</b> y el prompt <b>"cat . dog ."</b>, que BERT tokeniza como [CLS] cat . dog . [SEP] y se rellena a T = ' + q('cfg.T') + ' ids (<b>' + q('tensor.t-ids.shape') + '</b>). Con el texto viene la máscara de sub-oraciones: "cat" y "dog" no se miran.' },
        { nodes: ['img-backbone'], edges: ['img-backbone>img-proj'], tensors: ['i-c3', 'i-c4', 'i-c5'],
          text: 'Swin-T (' + q('node.img-backbone.params') + ' parámetros, ' + q('node.img-backbone.macsPct') + ' de los MACs) da una pirámide: <b>' + q('tensor.i-c3.shape') + '</b>, <b>' + q('tensor.i-c4.shape') + '</b> y <b>' + q('tensor.i-c5.shape') + '</b> (strides 8, 16 y 32).' },
        { nodes: ['img-proj'], edges: ['img-backbone>img-proj', 'img-proj>enhancer'], tensors: ['i-mem-in'],
          text: 'Cada nivel pasa a D = ' + q('cfg.D') + ' canales y se agrega un 4.º nivel de stride 64. Aplanados y concatenados: N = ' + q('tokens') + ' tokens de imagen → <b>' + q('tensor.i-mem-in.shape') + '</b>.' },
        { nodes: ['txt-backbone', 'txt-proj'], edges: ['txt-backbone>txt-proj', 'txt-proj>enhancer'], tensors: ['t-bert-out', 't-feat'],
          text: 'BERT-base (' + q('node.txt-backbone.params') + ' parámetros, la mayoría en la tabla de vocabulario) da <b>' + q('tensor.t-bert-out.shape') + '</b> y una Linear lo lleva a <b>' + q('tensor.t-feat.shape') + '</b>. Corre en cada imagen: ' + q('node.txt-backbone.macsG') + ' MACs (' + q('node.txt-backbone.macsPct') + ' del total).' },
        { expand: 'gdino-enhancer-layer', nodes: ['i2t', 't2i'], edges: ['fus-ln-img>i2t', 'fus-ln-txt>i2t', 'fus-ln-txt>t2i', 'fus-ln-img>t2i'], tensors: ['i-enh-fus-scores', 'i-enh-i2t-g', 't-enh-t2i-g'],
          text: 'En cada capa del enhancer, primero la <b>fusión</b>: una sola matriz de scores imagen × texto, <b>' + q('tensor.i-enh-fus-scores.shape') + '</b>. Con softmax sobre T, cada token de imagen recoge información del texto; con la misma matriz transpuesta y softmax sobre N, cada token de texto recoge información de la imagen.' },
        { expand: 'gdino-enhancer-layer', nodes: ['txt-self', 'img-self', 'txt-ffn', 'img-ffn'], edges: ['fus-res-txt>txt-self', 'mask>txt-self', 'fus-res-img>img-self', 'txt-ln2>out-txt', 'img-ln2>out-img'], tensors: ['t-memory', 'i-memory'],
          text: 'Después, cada flujo por su lado: el texto, self-attention con la máscara (' + q('tensor.t-enh-self-masked.shape') + '); la imagen, self-attention <b>deformable</b>: cada token lee solo ' + q('cfg.samples') + ' puntos, no los N. Tras ' + q('cfg.Lenc') + ' capas (' + q('node.enhancer.params') + ' parámetros, ' + q('node.enhancer.macsPct') + ' de los MACs): <b>' + q('tensor.i-memory.shape') + '</b> y <b>' + q('tensor.t-memory.shape') + '</b>.' },
        { nodes: ['query-select'], edges: ['enhancer>query-select', 'query-select>decoder'], tensors: ['i-memory', 't-memory', 'q-ref0', 'q-tgt0'],
          text: 'Selección guiada por el texto: <b>' + q('tensor.q-enc-logits.shape') + '</b> similitudes; el máximo por fila puntúa cada token y se quedan los Q = ' + q('cfg.Q') + ' mejores (de ' + q('tokens') + '). Sus cajas son la parte posicional (<b>' + q('tensor.q-ref0.shape') + '</b>); el contenido es aprendido (<b>' + q('tensor.q-tgt0.shape') + '</b>).' },
        { expand: 'gdino-decoder-layer', nodes: ['self-attn', 'txt-cross'], edges: ['add-qpos>self-attn', 'memory-t>txt-cross', 'qpos-2>txt-cross'], tensors: ['q-self-scores', 'q-txt-scores'],
          text: 'En cada capa del decoder, las queries se miran entre ellas (<b>' + q('tensor.q-self-scores.shape') + '</b>) y consultan al texto con una cross-attention densa (<b>' + q('tensor.q-txt-scores.shape') + '</b>): así cada query sabe qué frase está buscando.' },
        { expand: 'gdino-decoder-layer', nodes: ['img-cross', 'ffn', 'box-refine'], edges: ['memory-i>img-cross', 'qpos-3>img-cross', 'ln4>box-refine', 'box-refine>ref-out'], tensors: ['q-ref'],
          text: 'Después leen la imagen con atención deformable alrededor de su caja (<b>' + q('tensor.q-img-sampled.shape') + '</b> muestras), FFN, y la caja se refina con el MLP de la cabeza (<b>' + q('tensor.q-ref.shape') + '</b>) para la capa siguiente. ' + q('cfg.Ldec') + ' capas: ' + q('node.decoder.params') + ' parámetros.' },
        { nodes: ['dec-norm', 'contrastive-head', 'box-head'], edges: ['decoder>dec-norm', 'dec-norm>contrastive-head', 'dec-norm>box-head', 'enhancer>contrastive-head'], tensors: ['hs', 'logits', 'boxes'],
          text: 'LayerNorm final: <b>' + q('tensor.hs.shape') + '</b>. La cabeza contrastiva multiplica por los tokens del texto: <b>' + q('tensor.logits.shape') + '</b> logits (0 parámetros: las "clases" son el prompt). La cabeza de caja da <b>' + q('tensor.boxes.shape') + '</b>.' },
        { nodes: ['output'], edges: ['contrastive-head>output', 'box-head>output'], tensors: ['logits', 'boxes'],
          text: 'Sigue a una query que cayó sobre el gato: su fila de ' + q('cfg.T') + ' logits es alta en el token "cat" y baja en "dog": la caja sale etiquetada <b>"cat"</b>. Otra, sobre el perro, sale <b>"dog"</b>. Las queries con todos los logits bajos se descartan con un umbral; no hay NMS.' },
        { nodes: ['denoise', 'gt', 'matching', 'loss'], edges: ['denoise>decoder', 'output>matching', 'gt>matching', 'matching>loss'], tensors: ['gt-boxes', 'assignment'],
          text: 'Solo en el entrenamiento: matching húngaro Q×G (<b>' + q('tensor.assignment.shape') + '</b> parejas), focal loss sobre los logits por token + L1 + GIoU, y las consultas con ruido de DINO (CDN) que entran al decoder y se descartan en la inferencia.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) capa del feature enhancer
  // Imagen a la izquierda, texto a la derecha. Primero la fusión (aristas "cross" que se cruzan: cada flujo
  // aporta K y V al otro), después cada flujo por su lado (post-LN). Residuales por fuera de cada columna.
  ATLAS.registerDiagram(Object.assign({
    id: 'gdino-enhancer-layer', model: 'grounding-dino', config: C, kind: 'arch', title: 'Capa del feature enhancer',
    parent: 'grounding-dino-overview', parentNode: 'enhancer',
    caption: 'Fusión en las dos direcciones: los tokens de imagen consultan al texto (imagen → texto) y los de texto a la imagen (texto → imagen); las dos usan la MISMA matriz de scores (h/2)×N×T, una con softmax sobre T y la otra, transpuesta, con softmax sobre N. Después, el texto hace self-attention con la máscara de sub-oraciones y la imagen self-attention deformable; cada paso con residual y LayerNorm (post-LN).',
    grid: { w: 108, h: 109 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 1, y: 5.5, w: 106, h: 93, repeat: { sym: 'L_e', from: 'Lenc', crumb: false } },
    ],
    nodes: scoped('enhancer', [
      { id: 'in-img', op: 'io', modality: 'img', label: 'Tokens de imagen x', x: 8, y: 0.5, w: 30, h: 4.5, note: 'Los N tokens de imagen de los 4 niveles (en la capa 1, la salida de la proyección; después, la de la capa anterior).' },
      { id: 'in-txt', op: 'io', modality: 'txt', label: 'Tokens de texto t', x: 66, y: 0.5, w: 30, h: 4.5, note: 'Los T tokens de texto (en la capa 1, la salida de BERT proyectada a D).' },
      { id: 'fus-ln-img', op: 'norm', label: 'LayerNorm', x: 10, y: 10, w: 26, h: 4, tex: '\\hat x = \\mathrm{LN}(x)', note: 'La fusión normaliza cada flujo antes (pre-LN dentro del bloque de fusión).' },
      { id: 'fus-ln-txt', op: 'norm', label: 'LayerNorm', x: 68, y: 10, w: 26, h: 4, tex: '\\hat t = \\mathrm{LN}(t)', note: 'Igual para el texto.' },
      { id: 'i2t', op: 'fuse', label: 'Imagen → texto', sub: 'Q: imagen · K, V: texto', heads: 'hFusion', headsSym: 'h/2', x: 6, y: 22, w: 34, h: 7,
        tex: '\\Delta x = \\mathrm{softmax}_{T}\\!\\big(Q_x K_t^{\\top}/\\sqrt{d}\\big)\\, V_t',
        note: 'Cross-attention: cada token de imagen (Q, proyectado a E = ' + q('cfg.Efusion') + ' con h/2 = ' + q('cfg.hFusion') + ' cabezas) reparte su atención entre los T tokens de texto (K, V). La matriz de scores (h/2)×N×T se calcula UNA vez y la reusa la dirección contraria. El resultado se escala con γ (layer scale) y se suma.' },
      { id: 't2i', op: 'fuse', label: 'Texto → imagen', sub: 'mismos scores, transpuestos', heads: 'hFusion', headsSym: 'h/2', x: 66, y: 22, w: 30, h: 7,
        tex: '\\Delta t = \\mathrm{softmax}_{N}\\!\\big((Q_x K_t^{\\top})^{\\top}/\\sqrt{d}\\big)\\, V_x',
        note: 'La otra dirección: cada token de texto reparte su atención entre los N tokens de imagen. No hay otra Q·Kᵀ: se transponen los mismos scores y la softmax va sobre N. Solo hace falta otra proyección de V (de la imagen).' },
      { id: 'fus-res-img', op: 'tensorop', shape: 'add', label: '+ γ·Δx', labelPos: 'right', x: 21, y: 34, w: 4, h: 4, tex: "x' = \\hat x + \\gamma_x \\odot \\Delta x", note: 'Residual (sobre la entrada normalizada) con el layer scale γ.' },
      { id: 'fus-res-txt', op: 'tensorop', shape: 'add', label: '+ γ·Δt', labelPos: 'left', x: 79, y: 34, w: 4, h: 4, tex: "t' = \\hat t + \\gamma_t \\odot \\Delta t", note: 'Igual para el texto.' },
      { id: 'img-self', op: 'attn', label: 'Self-attn deformable', sub: 'L niveles × K puntos', subNum: '{{cfg.levels}} niveles × {{cfg.points}} puntos', heads: 'h', x: 6, y: 45, w: 34, h: 7,
        tex: '\\mathrm{DeformAttn}(x\' + p,\\; \\text{ref},\\; x\')', note: 'La self-attention de la imagen es deformable (como el encoder de Deformable DETR): cada token, con su posición sumada, predice offsets y pesos y lee h·L·K = ' + q('cfg.samples') + ' puntos de los 4 niveles en vez de los N tokens. Sin matriz N×N.' },
      { id: 'mask', op: 'io', modality: 'txt', label: 'Máscara T×T', sub: 'sub-oraciones', x: 46, y: 46, w: 14, h: 6, note: 'La máscara de sub-oraciones: cada token solo atiende a los de su misma categoría (y a los especiales), así las categorías del prompt no se mezclan.' },
      { id: 'txt-self', op: 'attn', label: 'Self-attention (texto)', sub: 'con la máscara · h/2 cabezas', heads: 'hFusion', headsSym: 'h/2', x: 66, y: 45, w: 30, h: 7,
        tex: '\\mathrm{softmax}\\big(QK^{\\top}/\\sqrt{d_h} + M\\big)\\, V', note: 'Self-attention entre los T tokens del texto (con la posición seno sumada a Q y K) y la máscara de sub-oraciones (−∞ entre categorías distintas).' },
      { id: 'img-res1', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'right', x: 21, y: 56, w: 4, h: 4, tex: "x' + \\mathrm{DeformAttn}", note: 'Residual.' },
      { id: 'txt-res1', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'none', x: 79, y: 56, w: 4, h: 4, tex: "t' + \\mathrm{SA}", note: 'Residual.' },
      { id: 'img-ln1', op: 'norm', label: 'LayerNorm', x: 12, y: 64, w: 22, h: 4, tex: '\\mathrm{LN}(\\cdot)', note: 'Post-LN: después de la suma.' },
      { id: 'txt-ln1', op: 'norm', label: 'LayerNorm', x: 70, y: 64, w: 22, h: 4, tex: '\\mathrm{LN}(\\cdot)', note: 'Post-LN.' },
      { id: 'img-ffn', op: 'mlp', label: 'FFN', sub: 'D → D_mlp → D · ReLU', subNum: '{{cfg.D}} → {{cfg.Dmlp}} → {{cfg.D}} · ReLU', x: 8, y: 73, w: 30, h: 6, tex: '\\mathrm{FFN}(x) = W_2\\,\\mathrm{ReLU}(W_1 x)', note: 'La FFN de la imagen, ancho oculto 2048.' },
      { id: 'txt-ffn', op: 'mlp', label: 'FFN', sub: 'D → D_mlp/2 → D · ReLU', subNum: '{{cfg.D}} → 1024 → {{cfg.D}} · ReLU', x: 66, y: 73, w: 30, h: 6, tex: '\\mathrm{FFN}(t) = W_2\\,\\mathrm{ReLU}(W_1 t)', note: 'La FFN del texto, más angosta (ancho oculto D_mlp/2).' },
      { id: 'img-res2', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'right', x: 21, y: 83, w: 4, h: 4, tex: "+\\,\\mathrm{FFN}", note: 'Residual desde la salida de la LayerNorm.' },
      { id: 'txt-res2', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'none', x: 79, y: 83, w: 4, h: 4, tex: "+\\,\\mathrm{FFN}", note: 'Residual desde la salida de la LayerNorm.' },
      { id: 'img-ln2', op: 'norm', label: 'LayerNorm', x: 12, y: 91, w: 22, h: 4, tex: '\\mathrm{LN}(\\cdot)', note: 'Cierra la capa (imagen).' },
      { id: 'txt-ln2', op: 'norm', label: 'LayerNorm', x: 70, y: 91, w: 22, h: 4, tex: '\\mathrm{LN}(\\cdot)', note: 'Cierra la capa (texto).' },
      { id: 'out-img', op: 'io', modality: 'img', label: 'Imagen → capa siguiente', x: 7, y: 103, w: 32, h: 4.5, note: 'N×D. Tras la capa 6 es la memoria de imagen (la usan la selección de queries y el decoder).' },
      { id: 'out-txt', op: 'io', modality: 'txt', label: 'Texto → capa siguiente', x: 65, y: 103, w: 32, h: 4.5, note: 'T×D. Tras la capa 6 es la memoria de texto (la usan la selección, el decoder y la cabeza contrastiva).' },
    ]),
    tensors: [
      { id: 'i-enh-fus-scores', at: { x: 54, y: 88 }, show: 'both', labelSide: 'below', glyph: 'amat', axes: { rows: 'img', cols: 'txt' }, note: 'scores (una vez)' },
    ],
    edges: [
      { from: 'in-img', to: 'fus-ln-img', kind: 'data', tensor: 'i-mem-in', labelSide: 'right' },
      { from: 'in-txt', to: 'fus-ln-txt', kind: 'data', tensor: 't-feat', labelSide: 'right' },
      { from: 'fus-ln-img', to: 'i2t', kind: 'data', tensor: 'i-enh-fus-ln', labelSide: 'right', labelT: 0.5 },
      { from: 'fus-ln-txt', to: 't2i', kind: 'data', tensor: 't-enh-fus-ln', labelSide: 'left', labelT: 0.5 },
      // el intercambio: cada flujo es K y V del otro (las dos aristas dobles se cruzan una vez)
      { from: 'fus-ln-txt', to: 'i2t', kind: 'cross', tensor: 't-enh-fus-ln', fromSide: 'left', toSide: 'right', toAt: 0.2857, midX: 56, label: false, tag: 'K,V: texto', tagSeg: 1, tagT: 0.22, tagSide: 'on' },
      { from: 'fus-ln-img', to: 't2i', kind: 'cross', tensor: 'i-enh-fus-ln', fromSide: 'right', toSide: 'left', toAt: 0.7857, midX: 48, label: false, tag: 'K,V: imagen', tagSeg: 1, tagT: 0.4, tagSide: 'on' },
      { from: 'fus-ln-img', to: 'fus-res-img', kind: 'residual', fromPt: [23, 15.5], toSide: 'left', via: [[3.5, 15.5], [3.5, 36]], dot: true },
      { from: 'fus-ln-txt', to: 'fus-res-txt', kind: 'residual', fromPt: [81, 15.5], toSide: 'right', via: [[104.5, 15.5], [104.5, 36]], dot: true },
      { from: 'i2t', to: 'fus-res-img', kind: 'data', tensor: 'i-enh-i2t-g', labelSide: 'left' },
      { from: 't2i', to: 'fus-res-txt', kind: 'data', tensor: 't-enh-t2i-g', labelSide: 'left' },
      { from: 'fus-res-img', to: 'img-self', kind: 'data', tensor: 'i-enh-fused', label: false },
      { from: 'fus-res-txt', to: 'txt-self', kind: 'data', tensor: 't-enh-fused', label: false },
      { from: 'mask', to: 'txt-self', kind: 'control', fromSide: 'right', toSide: 'left' },
      { from: 'fus-res-img', to: 'img-res1', kind: 'residual', fromPt: [23, 39], toSide: 'left', via: [[3.5, 39], [3.5, 58]], dot: true },
      { from: 'fus-res-txt', to: 'txt-res1', kind: 'residual', fromPt: [81, 39], toSide: 'right', via: [[104.5, 39], [104.5, 58]], dot: true },
      { from: 'img-self', to: 'img-res1', kind: 'data', tensor: 'i-enh-o', labelSide: 'left' },
      { from: 'txt-self', to: 'txt-res1', kind: 'data', tensor: 't-enh-self-o', labelSide: 'left' },
      { from: 'img-res1', to: 'img-ln1', kind: 'data', tensor: 'i-enh-r1', label: false },
      { from: 'txt-res1', to: 'txt-ln1', kind: 'data', tensor: 't-enh-r1', label: false },
      { from: 'img-ln1', to: 'img-ffn', kind: 'data', tensor: 'i-enh-ln1', label: false },
      { from: 'txt-ln1', to: 'txt-ffn', kind: 'data', tensor: 't-enh-ln1', label: false },
      { from: 'img-ln1', to: 'img-res2', kind: 'residual', fromPt: [23, 70], toSide: 'left', via: [[3.5, 70], [3.5, 85]], dot: true },
      { from: 'txt-ln1', to: 'txt-res2', kind: 'residual', fromPt: [81, 70], toSide: 'right', via: [[104.5, 70], [104.5, 85]], dot: true },
      { from: 'img-ffn', to: 'img-res2', kind: 'data', tensor: 'i-enh-f', labelSide: 'left' },
      { from: 'txt-ffn', to: 'txt-res2', kind: 'data', tensor: 't-enh-f', labelSide: 'left' },
      { from: 'img-res2', to: 'img-ln2', kind: 'data', tensor: 'i-enh-r2', label: false },
      { from: 'txt-res2', to: 'txt-ln2', kind: 'data', tensor: 't-enh-r2', label: false },
      { from: 'img-ln2', to: 'out-img', kind: 'data', tensor: 'i-memory', labelSide: 'left', labelT: 0.75 },
      { from: 'txt-ln2', to: 'out-txt', kind: 'data', tensor: 't-memory', labelSide: 'left', labelT: 0.75 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) capa del decoder
  // Columna principal (post-LN); a la derecha, q_pos (sumada a Q en cada atención) y las dos memorias (aristas
  // cross desde el costado); abajo a la derecha, el refinamiento de la caja.
  ATLAS.registerDiagram(Object.assign({
    id: 'gdino-decoder-layer', model: 'grounding-dino', config: C, kind: 'arch', title: 'Capa del decoder (cross-modality)',
    parent: 'grounding-dino-overview', parentNode: 'decoder',
    caption: 'Cuatro sub-bloques post-LN: las Q queries se miran entre ellas, consultan al texto (cross-attention densa, Q×T) y a la imagen (cross-attention deformable alrededor de su caja), y pasan por la FFN. q_pos (que sale de la caja de referencia) se suma a Q en cada atención. Al final, el MLP de la cabeza de cajas refina la caja para la capa siguiente.',
    grid: { w: 100, h: 140 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 6, y: 5.5, w: 56, h: 124, repeat: { sym: 'L_d', from: 'Ldec', crumb: false }, modality: 'qry' },
    ],
    nodes: scoped('decoder', [
      { id: 'in', op: 'io', modality: 'qry', label: 'Contenido q', sub: '(capa 1: aprendido)', x: 21, y: 0.5, w: 22, h: 5, note: 'El contenido de las Q queries: en la capa 1, la tabla aprendida (Q×D); después, la salida de la capa anterior.' },
      { id: 'qpos', op: 'io', modality: 'qry', label: 'q_{pos}', sub: 'de la caja', x: 66, y: 7, w: 12, h: 5.5, note: 'La parte posicional: un MLP sobre la codificación seno de la caja de referencia (cx, cy, w, h).' },
      { id: 'add-qpos', op: 'tensorop', shape: 'add', label: 'q + q_pos', labelPos: 'none', ops: ['d-add-qpos'], opsExact: true, x: 44, y: 7.75, w: 4, h: 4, tex: 'Q = K = q + q_{pos},\\; V = q', note: 'q_pos se suma a Q y K de la self-attention (V = q).' },
      { id: 'self-attn', op: 'attn', label: 'Self-attention', sub: 'entre las Q queries', heads: 'h', x: 16, y: 19, w: 32, h: 7,
        tex: '\\mathrm{SA}:\\; Q\\times Q \\text{ por cabeza}', note: 'Cada query mira a las demás: así se reparten los objetos y no duplican cajas.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'right', x: 30, y: 30, w: 4, h: 4, tex: 'q + \\mathrm{SA}', note: 'Residual.' },
      { id: 'ln1', op: 'norm', label: 'LayerNorm', x: 21, y: 37, w: 22, h: 4, tex: "q' = \\mathrm{LN}(q + \\mathrm{SA})", note: 'Post-LN.' },
      { id: 'qpos-2', op: 'io', modality: 'qry', label: 'q_{pos}', x: 66, y: 45, w: 10, h: 5, note: 'La misma q_pos: se suma a la Q de la cross-attention al texto.' },
      { id: 'txt-cross', op: 'fuse', label: 'Cross-attn al texto', sub: 'Q: queries · K, V: texto', heads: 'h', x: 14, y: 46, w: 36, h: 8,
        tex: '\\mathrm{softmax}\\big((q\'+q_{pos})W_Q\\,(t_{mem} W_K)^{\\top}/\\sqrt{d_h}\\big)\\, t_{mem} W_V',
        note: 'Cada query consulta a los T tokens del texto: matriz Q×T por cabeza (barata: T es chico). Es lo que le dice a cada query qué frase busca.' },
      { id: 'memory-t', op: 'io', modality: 'txt', label: 'Memoria de texto', x: 78, y: 49, w: 20, h: 6, note: 'La salida del enhancer para el texto (T×D), la misma para las L_d capas.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'right', x: 30, y: 59, w: 4, h: 4, tex: "q' + \\mathrm{CA}_{txt}", note: 'Residual.' },
      { id: 'ln2', op: 'norm', label: 'LayerNorm', x: 21, y: 66, w: 22, h: 4, tex: "q'' = \\mathrm{LN}(\\cdot)", note: 'Post-LN.' },
      { id: 'qpos-3', op: 'io', modality: 'qry', label: 'q_{pos}', x: 66, y: 74, w: 10, h: 5, note: 'Otra vez q_pos, ahora para la query de la atención deformable.' },
      { id: 'img-cross', op: 'attn', label: 'Cross-attn deformable', sub: 'muestras alrededor de la caja', heads: 'h', x: 14, y: 75, w: 36, h: 8,
        tex: '\\sum_{l,k} A_{mlk}\\, v_l\\big(\\phi_l(b_{ref}) + \\Delta p_{mlk}\\big)',
        note: 'Atención deformable sobre la memoria de imagen: cada query predice offsets y pesos y lee h·L·K = ' + q('cfg.samples') + ' valores alrededor de su caja de referencia, en los 4 niveles. Lineal en el número de queries; sin matriz Q×N.' },
      { id: 'memory-i', op: 'io', modality: 'img', label: 'Memoria de imagen', x: 78, y: 78, w: 20, h: 6, note: 'La salida del enhancer para la imagen (N×D): se proyecta a valores dentro de cada capa.' },
      { id: 'res3', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'right', x: 30, y: 88, w: 4, h: 4, tex: "q'' + \\mathrm{CA}_{img}", note: 'Residual.' },
      { id: 'ln3', op: 'norm', label: 'LayerNorm', x: 21, y: 95, w: 22, h: 4, tex: "q''' = \\mathrm{LN}(\\cdot)", note: 'Post-LN.' },
      { id: 'ffn', op: 'mlp', label: 'FFN', sub: 'D → D_mlp → D · ReLU', subNum: '{{cfg.D}} → {{cfg.Dmlp}} → {{cfg.D}} · ReLU', x: 19, y: 103, w: 26, h: 6, tex: '\\mathrm{FFN}(q) = W_2\\,\\mathrm{ReLU}(W_1 q)', note: 'Dos lineales por query.' },
      { id: 'res4', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'right', x: 30, y: 113, w: 4, h: 4, tex: "+\\,\\mathrm{FFN}", note: 'Residual.' },
      { id: 'ln4', op: 'norm', label: 'LayerNorm', x: 21, y: 120, w: 22, h: 4, tex: '\\mathrm{LN}(\\cdot)', note: 'Cierra la capa.' },
      { id: 'box-refine', op: 'head', label: 'Refinar la caja', sub: 'MLP de la cabeza (compartido)', x: 66, y: 119, w: 30, h: 6,
        tex: 'b^{(\\ell)} = \\sigma\\big(\\mathrm{MLP}(q) + \\sigma^{-1}(b^{(\\ell-1)})\\big)', note: 'El mismo MLP de la cabeza de cajas (0 parámetros propios) ajusta la caja de referencia; la nueva caja da la q_pos y el centro de muestreo de la capa siguiente.' },
      { id: 'out', op: 'io', modality: 'qry', label: 'Salida (capa siguiente)', x: 21, y: 134.5, w: 22, h: 4.5, note: 'Q×D. Tras la última capa, LayerNorm final y las cabezas.' },
      { id: 'ref-out', op: 'io', label: 'Caja (capa siguiente)', x: 68, y: 134.5, w: 26, h: 4.5, note: 'Q×4: la caja de referencia de la capa siguiente.' },
    ]),
    tensors: [
      { id: 'q-self-scores', at: { x: 87, y: 26 }, show: 'both', labelSide: 'below', glyph: 'amat', axes: { rows: 'qry', cols: 'qry' }, note: 'self: Q×Q' },
      { id: 'q-txt-scores', at: { x: 88, y: 43.5 }, show: 'glyph', glyph: 'amat', axes: { rows: 'qry', cols: 'txt' }, note: 'texto: Q×T' },
    ],
    edges: [
      { from: 'in', to: 'self-attn', kind: 'data', tensor: 'q-tgt0', fromAt: 0.2727, toAt: 0.3438, labelSide: 'left', labelT: 0.3, tag: 'V', tagStyle: 'plain', tagSide: 'on', tagT: 0.62 },
      { from: 'in', to: 'add-qpos', kind: 'data', tensor: 'q-tgt0', fromSide: 'right', toSide: 'top', label: false },
      { from: 'qpos', to: 'add-qpos', kind: 'query', tensor: 'q-pos', fromSide: 'left', toSide: 'right', labelSide: 'below', labelT: 0.5 },
      { from: 'add-qpos', to: 'self-attn', kind: 'data', tensor: 'q-qk-in', toAt: 0.9375, label: false, tag: 'Q, K', tagStyle: 'plain', tagSide: 'on', tagT: 0.35 },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'left', toSide: 'left', via: [[10, 3], [10, 32]] },
      { from: 'self-attn', to: 'res1', kind: 'data', tensor: 'q-self-o', labelSide: 'left' },
      { from: 'res1', to: 'ln1', kind: 'data', tensor: 'q-r1', label: false },
      { from: 'ln1', to: 'txt-cross', kind: 'data', tensor: 'q-ln1', label: false, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.3 },
      { from: 'qpos-2', to: 'txt-cross', kind: 'query', tensor: 'q-pos', fromSide: 'left', toSide: 'right', toAt: 0.1875, label: false, tag: '+ a Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'memory-t', to: 'txt-cross', kind: 'cross', tensor: 't-memory', fromSide: 'left', toSide: 'right', toAt: 0.75, labelSide: 'below', labelT: 0.3, tag: 'K,V', tagT: 0.12, tagSide: 'on' },
      { from: 'ln1', to: 'res2', kind: 'residual', fromPt: [32, 43.5], toSide: 'left', via: [[10, 43.5], [10, 61]], dot: true },
      { from: 'txt-cross', to: 'res2', kind: 'data', tensor: 'q-txt-o', labelSide: 'left' },
      { from: 'res2', to: 'ln2', kind: 'data', tensor: 'q-r2', label: false },
      { from: 'ln2', to: 'img-cross', kind: 'data', tensor: 'q-ln2', label: false, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.3 },
      { from: 'qpos-3', to: 'img-cross', kind: 'query', tensor: 'q-pos', fromSide: 'left', toSide: 'right', toAt: 0.1875, label: false, tag: '+ a Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'memory-i', to: 'img-cross', kind: 'cross', tensor: 'i-memory', fromSide: 'left', toSide: 'right', toAt: 0.75, labelSide: 'below', labelT: 0.3, tag: 'valores', tagT: 0.12, tagSide: 'on' },
      { from: 'ln2', to: 'res3', kind: 'residual', fromPt: [32, 72.5], toSide: 'left', via: [[10, 72.5], [10, 90]], dot: true },
      { from: 'img-cross', to: 'res3', kind: 'data', tensor: 'q-img-o', labelSide: 'left' },
      { from: 'res3', to: 'ln3', kind: 'data', tensor: 'q-r3', label: false },
      { from: 'ln3', to: 'ffn', kind: 'data', tensor: 'q-ln3', label: false },
      { from: 'ln3', to: 'res4', kind: 'residual', fromPt: [32, 101], toSide: 'left', via: [[10, 101], [10, 115]], dot: true },
      { from: 'ffn', to: 'res4', kind: 'data', tensor: 'q-f', labelSide: 'left' },
      { from: 'res4', to: 'ln4', kind: 'data', tensor: 'q-r4', label: false },
      { from: 'ln4', to: 'out', kind: 'data', tensor: 'q-out', labelSide: 'left', labelT: 0.78 },
      { from: 'ln4', to: 'box-refine', kind: 'data', tensor: 'q-out', fromSide: 'right', toSide: 'left', label: false },
      { from: 'box-refine', to: 'ref-out', kind: 'data', tensor: 'q-ref', labelSide: 'right', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
