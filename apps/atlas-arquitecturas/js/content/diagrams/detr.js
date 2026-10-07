/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/detr.js
   Diagramas de DETR (SPEC §7.2, ids de §15.1) y de la atención deformable (§15.2):
     detr-overview     dos columnas: a la izquierda la imagen (ResNet-50 → C5 → proyección 1×1 →
                       950 tokens) y el encoder ×6; a la derecha las Q object queries y el decoder ×6,
                       que recibe la memoria por una arista "cross" (K, V); en el medio la posición
                       seno (solo a Q y K). Abajo, las cabezas por query → el conjunto de Q
                       predicciones, y el carril "solo entrenamiento" (matching húngaro → pérdida,
                       también en cada capa del decoder).
       detr-enc-layer  post-LN: self-attn (Q = K = x + P, V = x) → ⊕ → LN → FFN → ⊕ → LN
         detr-enc-attn   proyecciones separadas W_Q, W_K (sobre x + P) y W_V (sobre x), 8×950×950
       detr-dec-layer  post-LN: self-attn entre queries → ⊕ → LN → cross-attn (Q = tgt + query_pos,
                       K = memoria + P, V = memoria) → ⊕ → LN → FFN → ⊕ → LN
         detr-cross-attn Q del decoder, K y V de la memoria (aristas "cross"), matriz 8×100×950
     deformable-attn   (modelo deformable-detr) query → offsets y pesos; muestreo en L niveles; Σ A·v
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas de las aristas las pone el
   motor desde ATLAS.Arch.run(config); aquí solo se nombran tensores. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'detr-r50-800x1216';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const PAGE = { page: 'detr', section: 'diagrama' };
  // Los ids de path del calculador se repiten entre encoder y decoder (self-attn, ln1, ffn, q-proj…): scope
  // limita el costo de cada nodo a su rama (encoder / decoder / cross-attn).
  const scoped = (scope, nodes) => nodes.map((n) => (n.op === 'io' ? n : Object.assign({ scope }, n)));

  ATLAS.registerDiagram(Object.assign({
    id: 'detr-overview', model: 'detr', config: C, kind: 'arch', title: 'DETR — vista general',
    caption: 'Detección como predicción de un conjunto: la imagen (izquierda) se vuelve una secuencia de tokens que el encoder convierte en la memoria; Q object queries aprendidas (derecha) la consultan en el decoder y cada una sale como una predicción (clase, caja) o ∅. Sin anclas y sin NMS: en el entrenamiento, el matching húngaro empareja 1 a 1 las predicciones con los objetos anotados.',
    grid: { w: 113, h: 139 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['input', 'backbone', 'input-proj', 'flatten', 'pos-enc'],   // pos-enc: ensancha el encuadre para que entre la forma de C5
    groups: [
      { id: 'encoder', label: 'Encoder (post-LN)', x: 2, y: 58, w: 40, h: 20, repeat: { sym: 'L_e', from: 'Lenc', totalOf: 'enc-layer' }, modality: 'img' },
      { id: 'decoder', label: 'Decoder (post-LN)', x: 70, y: 58, w: 40, h: 20, repeat: { sym: 'L_d', from: 'Ldec', totalOf: 'dec-layer' }, modality: 'qry' },
      { id: 'train', style: 'train', label: 'Solo entrenamiento', labelPos: 'bottom-right', x: 2, y: 121, w: 108, h: 17 },
    ],
    nodes: [
      { id: 'input', op: 'io', label: 'Imagen', image: true, imageGrid: 0, x: 15, y: 1, w: 14, h: 12,
        note: 'La imagen de entrada, H×W×3. DETR redimensiona el lado corto a 800 (el largo a lo sumo 1333); aquí 800×1216, para que el stride 32 divida exacto.' },
      { id: 'backbone', op: 'conv', label: 'Backbone ResNet-50', sub: 'hasta C5 · stride 32', x: 11, y: 19, w: 22, h: 7,
        tex: 'C_5 = \\mathrm{ResNet50}(x) \\in \\mathbb{R}^{H/32 \\times W/32 \\times 2048}',
        note: 'Una ResNet-50 sin su cabeza de clasificación: se toma el mapa C5 (stride 32, 2048 canales). Es una CNN normal: aporta el sesgo de localidad que el transformer no tiene.' },
      { id: 'input-proj', op: 'conv', label: 'Proyección de entrada', sub: 'conv 1×1: 2048 → D', subNum: 'conv 1×1: 2048 → {{cfg.D}}', x: 11, y: 37, w: 22, h: 6,
        tex: 'z_0 = C_5 * W_{proj},\\; W_{proj} \\in \\mathbb{R}^{2048 \\times D}',
        note: 'Una convolución 1×1 baja los canales de 2048 a D: cada posición del mapa queda como un vector de D, el ancho del transformer (en PyTorch el peso se guarda como D×2048, salida × entrada).' },
      { id: 'flatten', op: 'tensorop', shape: 'flatten', label: 'Aplanar', labelPos: 'left', x: 20, y: 47, w: 4, h: 4,
        tex: '\\tfrac{H}{32}\\times\\tfrac{W}{32}\\times D \\to N \\times D', note: 'La rejilla H/32 × W/32 se aplana en una secuencia de N tokens (uno por posición de C5). Sin parámetros.' },
      { id: 'pos-enc', op: 'embed', label: 'Posición 2-D', sub: 'seno, fija', x: 49, y: 64, w: 14, h: 6,
        tex: 'P \\in \\mathbb{R}^{N\\times D}\\;\\text{(seno 2-D: } y \\,\\|\\, x\\text{)}',
        note: 'Una codificación posicional fija (sin parámetros): la mitad de los D canales codifica la fila y la otra mitad la columna, con senos y cosenos de distintas frecuencias. Se suma a Q y a K en <b>cada</b> capa del encoder y a las K de <b>cada</b> cross-attention del decoder; nunca a V (la self-attention del decoder usa q_pos, no P).' },
      { id: 'enc-layer', op: 'attn', style: 'block', label: 'Capa del encoder', x: 5, y: 63, w: 34, h: 11, expand: 'detr-enc-layer',
        mini: { items: [{ label: 'self', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }, { label: 'LN', op: 'norm' }], res: [[0, 1], [3, 4]] },
        tex: "\\begin{aligned} x' &= \\mathrm{LN}(x + \\mathrm{SA}(q{=}k{=}x{+}P,\\ v{=}x)) \\\\ x'' &= \\mathrm{LN}(x' + \\mathrm{FFN}(x')) \\end{aligned}",
        note: 'Self-attention entre los N tokens de la imagen (con la posición sumada a Q y K) y una FFN, cada una con su residual y la LayerNorm <b>después</b> de la suma (post-LN, como el Transformer original y el código oficial). Entra y sale N×D.' },
      { id: 'queries', op: 'embed', modality: 'qry', label: 'Object queries q_{pos}', drillLabel: 'Object queries (tabla query_pos)', sub: 'Q×D, aprendidas', subNum: '{{cfg.Q}}×{{cfg.D}}, aprendidas', x: 81.6, y: 3, w: 24, h: 8,
        tex: '\\text{query\\_pos} \\in \\mathbb{R}^{Q\\times D}',
        note: 'Una tabla aprendida de Q vectores (un nn.Embedding): son las "ranuras" de salida. No dependen de la imagen; cada una aprende a mirar ciertas zonas y tamaños de caja. En cada capa del decoder se suman a Q y K de la self-attention y solo a Q de la cross-attention (ahí K lleva la posición P de la imagen).' },
      { id: 'tgt0', op: 'io', label: 'tgt₀ = 0', sub: 'ceros', x: 81, y: 40, w: 12, h: 7,
        note: 'El contenido con el que arranca el decoder es cero: toda la identidad de cada query entra por query_pos, que se suma en cada capa.' },
      { id: 'dec-layer', op: 'attn', style: 'block', label: 'Capa del decoder', x: 73, y: 63, w: 34, h: 11, expand: 'detr-dec-layer',
        mini: { items: [{ label: 'self', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'cross', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }, { label: 'LN', op: 'norm' }], res: [[0, 1], [3, 4], [6, 7]] },
        tex: "\\begin{aligned} t' &= \\mathrm{LN}(t + \\mathrm{SA}) \\\\ t'' &= \\mathrm{LN}(t' + \\mathrm{CA}(t', m)) \\\\ t''' &= \\mathrm{LN}(t'' + \\mathrm{FFN}(t'')) \\end{aligned}",
        note: 'Tres sub-bloques post-LN: self-attention entre las Q queries (así se coordinan y evitan duplicados), cross-attention de las queries a la memoria del encoder y FFN. Las Q queries se decodifican en paralelo, no una por una.' },
      { id: 'dec-norm', op: 'norm', label: 'LayerNorm final', sub: 'compartida (también aux)', x: 75, y: 84, w: 30, h: 5,
        tex: '\\mathrm{LN}(t^{(\\ell)}),\\; \\ell = 1,\\dots,L_d', note: 'Una LayerNorm al final del decoder. En el entrenamiento se aplica también a la salida de cada capa (con las mismas cabezas) para las pérdidas auxiliares.' },
      { id: 'class-head', op: 'head', label: 'Cabeza de clase', sub: 'Linear D → K+1', subNum: 'Linear {{cfg.D}} → {{cfg.classes}}+1', x: 72, y: 96, w: 18, h: 6,
        tex: '\\hat p = \\mathrm{softmax}(W_c\\, h),\\; W_c \\in \\mathbb{R}^{(K+1)\\times D}', note: 'Una capa lineal por query: K ids de clase + "no object" (∅). Los mismos pesos para las Q queries.' },
      { id: 'box-head', op: 'head', label: 'Cabeza de caja', sub: 'MLP 3 capas + σ', x: 92, y: 96, w: 17, h: 6,
        tex: '\\hat b = \\sigma(\\mathrm{MLP}(h)) = (c_x, c_y, w, h) \\in [0,1]^4', note: 'Un MLP de 3 capas (D → D → D → 4, ReLU) y una sigmoide: centro y tamaño de la caja, normalizados por el tamaño de la imagen. Sin anclas: la caja se predice directa.' },
      { id: 'output', op: 'io', label: 'Q predicciones = un conjunto', sub: '(clase, caja) o ∅ · sin NMS', x: 74, y: 108, w: 30, h: 7,
        note: 'Q pares (clase, caja), uno por query. Las que predicen ∅ se descartan; las demás son las detecciones. No hay NMS: el entrenamiento con matching 1 a 1 enseña a no duplicar.' },
      { id: 'gt', op: 'io', label: 'G objetos anotados', sub: '(clase, caja)', subNum: 'G = {{cfg.G}} (clase, caja)', x: 4, y: 126, w: 22, h: 7,
        note: 'Las cajas y clases anotadas de la imagen (G objetos, en COCO ≈ 7 en promedio). Solo existen en el entrenamiento.' },
      { id: 'matching', op: 'head', label: 'Matching húngaro', sub: 'costo Q×G → 1 a 1', x: 38, y: 126, w: 24, h: 7,
        tex: '\\hat\\sigma = \\arg\\min_{\\sigma} \\sum_{i} \\mathcal{C}(y_i, \\hat y_{\\sigma(i)})',
        note: 'Para cada imagen se arma la matriz de costos Q×G (clase, L1 y GIoU) y el algoritmo húngaro elige la asignación 1 a 1 de menor costo total. Sin gradiente. Las Q − G queries sin pareja reciben el objetivo ∅. Para las pérdidas auxiliares se repite con la salida de cada capa del decoder (cada una con su propio matching).' },
      { id: 'loss', op: 'head', label: 'Pérdida húngara', sub: 'CE + 5·L1 + 2·GIoU', x: 78, y: 126, w: 28, h: 7,
        tex: '\\mathcal{L} = \\sum_i \\big[-\\log \\hat p_{\\hat\\sigma(i)}(c_i) + \\mathbb{1}_{c_i\\ne\\varnothing}\\, \\mathcal{L}_{box}\\big]',
        note: 'Entropía cruzada de la clase (∅ con peso 0.1) para todas las queries y, para las emparejadas, L1 (×5) y GIoU (×2) de la caja. Se calcula también en cada capa del decoder (pérdidas auxiliares).' },
    ],
    tensors: [
      { id: 'c5', at: { edge: 'backbone>input-proj' }, show: 'both' },
      { id: 'memory-in', at: { edge: 'flatten>enc-layer' }, show: 'both' },
      { id: 'memory', at: { edge: 'enc-layer>dec-layer' }, show: 'both' },
      { id: 'query-pos', at: { edge: 'queries>dec-layer' }, show: 'both' },
      { id: 'pos', at: { x: 53, y: 76 }, show: 'both', note: 'P' },
    ],
    notes: [
      { x: 56, y: 61.6, text: 'se suma (nunca a V)', anchor: 'middle' },
      { x: 37.5, y: 85.4, text: 'memoria = salida de la ÚLTIMA', anchor: 'end', cls: 'ink' },
      { x: 37.5, y: 87.8, text: 'capa; K y V de cada capa', anchor: 'end' },
      { x: 37.5, y: 90.2, text: 'del decoder', anchor: 'end' },
      { x: 4, y: 106, text: 'Sin anclas, sin NMS:', cls: 'ink' },
      { x: 4, y: 108.4, text: 'Q ranuras → Q predicciones;' },
      { x: 4, y: 110.8, text: 'el matching 1 a 1 del' },
      { x: 4, y: 113.2, text: 'entrenamiento castiga duplicados' },
    ],
    edges: [
      { from: 'input', to: 'backbone', kind: 'data', tensor: 'x-img' },
      { from: 'backbone', to: 'input-proj', kind: 'data', tensor: 'c5' },
      { from: 'input-proj', to: 'flatten', kind: 'data', tensor: 'proj' },
      { from: 'flatten', to: 'enc-layer', kind: 'data', tensor: 'memory-in', labelT: 0.3 },
      { from: 'pos-enc', to: 'enc-layer', kind: 'data', tensor: 'pos', fromSide: 'left', toSide: 'right', toAt: 0.27, label: false, tag: 'Q, K', tagStyle: 'plain', tagT: 0.5 },
      { from: 'pos-enc', to: 'dec-layer', kind: 'data', tensor: 'pos', fromSide: 'right', toSide: 'left', toAt: 0.27, label: false, tag: 'K', tagStyle: 'plain', tagT: 0.5 },
      // la memoria sale del pie del grupo ×L_e (la salida de la ÚLTIMA capa, no de "la capa ℓ") y sube al
      // chip "cross" de la capa del decoder; corre entre la pila del decoder y la LayerNorm final
      { from: 'enc-layer', to: 'dec-layer', kind: 'cross', tensor: 'memory', fromPt: [22, 79.5], toSide: 'bottom', toAt: 0.42, via: [[22, 81.5], [87.28, 81.5]], labelSeg: 1, labelT: 0.33, labelSide: 'below', tagSeg: 2, tagT: 0.73, tagSide: 'left' },
      { from: 'queries', to: 'dec-layer', kind: 'query', tensor: 'query-pos', toAt: 0.6059 },
      { from: 'tgt0', to: 'dec-layer', kind: 'data', tensor: 'tgt0', toAt: 0.4118, labelSide: 'left', labelT: 0.3 },
      { from: 'dec-layer', to: 'dec-norm', kind: 'data', tensor: 'd-out', labelT: 0.75 },
      { from: 'dec-norm', to: 'class-head', kind: 'data', tensor: 'hs', fromSide: 'bottom', toSide: 'top', fromAt: 0.2 },
      { from: 'dec-norm', to: 'box-head', kind: 'data', tensor: 'hs', fromSide: 'bottom', toSide: 'top', fromAt: 0.85, label: false },
      { from: 'class-head', to: 'output', kind: 'data', tensor: 'logits', toAt: 0.2333 },
      { from: 'box-head', to: 'output', kind: 'data', tensor: 'boxes', toAt: 0.8833 },
      { from: 'output', to: 'matching', kind: 'control', fromSide: 'left', toSide: 'top', tag: 'predicciones', tagStyle: 'plain' },
      { from: 'gt', to: 'matching', kind: 'data', tensor: 'gt-boxes', fromSide: 'right', toSide: 'left' },
      { from: 'matching', to: 'loss', kind: 'data', tensor: 'assignment' },
      { from: 'output', to: 'loss', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.4, tag: 'Q pred. (∅: peso 0.1)', tagStyle: 'plain', tagT: 0.45 },
      // pérdidas auxiliares: la salida de cada capa pasa por la MISMA LayerNorm y las mismas cabezas y se
      // empareja con su propio matching húngaro (no va directo a la pérdida)
      { from: 'dec-norm', to: 'matching', kind: 'control', fromSide: 'left', toSide: 'top', toAt: 0.2, via: [[66, 86.5], [66, 104], [42.8, 104]], tag: 'aux: capas 1…L_d−1', tagStyle: 'plain', tagSeg: 2, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (DETR-R50 @ 800×1216)', steps: [
        { nodes: ['input'], edges: ['input>backbone'], tensors: ['x-img'],
          text: 'Entra una imagen de <b>' + q('tensor.x-img.shape') + '</b> (sin batch). DETR la redimensiona con el lado corto a 800; 1216 hace que el stride 32 divida exacto.' },
        { nodes: ['backbone'], edges: ['input>backbone', 'backbone>input-proj'], tensors: ['c5'],
          text: 'La ResNet-50 (' + q('node.backbone.params') + ' parámetros, BatchNorm congelada) baja la resolución 32 veces: el mapa C5 es <b>' + q('tensor.c5.shape') + '</b>, pocas posiciones pero muy profundas. Es ' + q('node.backbone.macsPct') + ' de los MACs del modelo.' },
        { nodes: ['input-proj', 'flatten'], edges: ['backbone>input-proj', 'input-proj>flatten', 'flatten>enc-layer'], tensors: ['proj', 'memory-in'],
          text: 'Una conv 1×1 baja los canales a D = ' + q('cfg.D') + ' (' + q('op.input-proj.paramArith') + ' parámetros): <b>' + q('tensor.proj.shape') + '</b>. Se aplana la rejilla: N = ' + q('cfg.gridH') + '·' + q('cfg.gridW') + ' = ' + q('tokens') + ' tokens → <b>' + q('tensor.memory-in.shape') + '</b>.' },
        { nodes: ['pos-enc'], edges: ['pos-enc>enc-layer', 'pos-enc>dec-layer'], tensors: ['pos'],
          text: 'La posición 2-D seno es fija (0 parámetros): <b>' + q('tensor.pos.shape') + '</b>, un vector por token. Se suma a Q y K en cada capa del encoder y a las K de cada cross-attention del decoder; nunca a V.' },
        { expand: 'detr-enc-layer', nodes: ['add-pos', 'self-attn'], edges: ['in>add-pos', 'pos>add-pos', 'add-pos>self-attn', 'in>self-attn'], tensors: ['e-qk-in', 'memory-in'],
          text: 'Dentro de una capa del encoder: Q y K salen de x + P (<b>' + q('tensor.e-qk-in.shape') + '</b>); V sale de x, sin posición.' },
        { expand: 'detr-enc-attn', nodes: ['scores', 'softmax'], edges: ['split>scores', 'scores>scale', 'scale>softmax', 'softmax>weighted-sum'], tensors: ['e-scores', 'e-attn'],
          text: 'Cada token contra todos: <b>' + q('tensor.e-scores.shape') + '</b> puntuaciones por capa (' + q('op.e-scores.macArith') + ' MACs solo en QKᵀ). Es N²: al duplicar el lado de la imagen, N se multiplica por 4 y esta matriz por 16.' },
        { expand: 'detr-enc-layer', nodes: ['res1', 'ln1', 'ffn', 'res2', 'ln2'], edges: ['self-attn>res1', 'res1>ln1', 'ln1>ffn', 'ffn>res2', 'res2>ln2', 'ln2>out'], tensors: ['e-r1', 'e-ln1', 'e-f', 'memory'],
          text: 'Post-LN: ⊕ y después LayerNorm, dos veces (atención y FFN de ' + q('cfg.D') + ' → ' + q('cfg.Dmlp') + ' → ' + q('cfg.D') + '). Una capa = ' + q('encLayerParams') + ' parámetros; sale <b>' + q('tensor.memory.shape') + '</b>, igual que entró.' },
        { nodes: ['enc-layer'], edges: ['flatten>enc-layer', 'enc-layer>dec-layer'], tensors: ['memory-in', 'memory'],
          text: q('cfg.Lenc') + ' capas (' + q('encoderParams') + ' parámetros, ' + q('node.encoder.macsPct') + ' de los MACs). La salida de la última es la <b>memoria</b>: <b>' + q('tensor.memory.shape') + '</b>, que entra como K y V a cada capa del decoder.' },
        { nodes: ['queries', 'tgt0'], edges: ['queries>dec-layer', 'tgt0>dec-layer'], tensors: ['query-pos', 'tgt0'],
          text: 'Del otro lado, Q = ' + q('cfg.Q') + ' object queries aprendidas: <b>' + q('tensor.query-pos.shape') + '</b> (' + q('queryParams') + ' parámetros). El contenido del decoder empieza en cero: <b>' + q('tensor.tgt0.shape') + '</b>. No hay anclas: solo Q ranuras.' },
        { expand: 'detr-dec-layer', nodes: ['add-qpos', 'self-attn'], edges: ['add-qpos>self-attn', 'in>self-attn', 'qpos>add-qpos'], tensors: ['d-qk-in', 'd-self-scores'],
          text: 'En cada capa del decoder, primero las queries se miran entre ellas: <b>' + q('tensor.d-self-scores.shape') + '</b>. Es barato, y es lo que les permite repartirse los objetos.' },
        { expand: 'detr-cross-attn', nodes: ['q-proj', 'k-proj', 'v-proj', 'scores'], edges: ['in-q>q-proj', 'mem-k>k-proj', 'mem-v>v-proj', 'split>scores'], tensors: ['d-cross-q-in', 'd-cross-k-in', 'd-cross-scores'],
          text: 'Cross-attention: Q de las queries (<b>' + q('tensor.d-cross-q-in.shape') + '</b>), K y V de la memoria (<b>' + q('tensor.d-cross-k-in.shape') + '</b>). Puntuaciones <b>' + q('tensor.d-cross-scores.shape') + '</b>: cada query elige en qué tokens de la imagen mirar.' },
        { nodes: ['dec-layer', 'dec-norm'], edges: ['dec-layer>dec-norm', 'dec-norm>class-head'], tensors: ['d-out', 'hs'],
          text: 'Tras ' + q('cfg.Ldec') + ' capas (' + q('decoderParams') + ' parámetros) y la LayerNorm final: <b>' + q('tensor.hs.shape') + '</b>, un vector por query.' },
        { nodes: ['class-head', 'box-head', 'output'], edges: ['dec-norm>class-head', 'dec-norm>box-head', 'class-head>output', 'box-head>output'], tensors: ['logits', 'boxes'],
          text: 'Sigue a una sola query: su vector de ' + q('cfg.D') + ' da ' + q('headOut') + ' logits (' + q('cfg.classes') + ' ids de clase + ∅) y una caja de 4 números (cx, cy, w, h en [0, 1]). Para todas: <b>' + q('tensor.logits.shape') + '</b> y <b>' + q('tensor.boxes.shape') + '</b>. Un conjunto de ' + q('cfg.Q') + ' predicciones, sin NMS.' },
        { nodes: ['gt', 'matching', 'loss'], edges: ['output>matching', 'gt>matching', 'matching>loss', 'output>loss', 'dec-norm>matching'], tensors: ['gt-boxes', 'assignment'],
          text: 'Solo en el entrenamiento: costo de ' + q('cfg.Q') + '×' + q('cfg.G') + ' = ' + q('costEntries') + ' pares (clase, L1, GIoU), el algoritmo húngaro elige ' + q('cfg.G') + ' parejas (<b>' + q('tensor.assignment.shape') + '</b>) y las otras ' + q('unmatched') + ' queries tienen objetivo ∅. La misma pérdida se aplica a la salida de cada capa del decoder: LayerNorm final y cabezas compartidas, y un matching propio por capa.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) capa del encoder (post-LN)
  // Residuales por la izquierda; la posición entra por la derecha (solo hacia Q y K).
  ATLAS.registerDiagram(Object.assign({
    id: 'detr-enc-layer', model: 'detr', config: C, kind: 'arch', title: 'Capa del encoder (post-LN)',
    parent: 'detr-overview', parentNode: 'enc-layer',
    caption: 'Post-LN: primero la suma residual y DESPUÉS la LayerNorm (en ViT es al revés). La posición P se suma solo a la entrada de Q y K; V usa x sin posición. Entra y sale N×D, por eso se apila L_e veces.',
    grid: { w: 80, h: 94 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 5.5, w: 52, h: 78.5, repeat: { sym: 'L_e', from: 'Lenc' }, modality: 'img' },
    ],
    nodes: scoped('encoder', [
      { id: 'in', op: 'io', label: 'Entrada x', x: 22, y: 0.5, w: 20, h: 4, note: 'Los N tokens: en la capa 1, la imagen proyectada y aplanada; después, la salida de la capa anterior.' },
      { id: 'pos', op: 'io', label: 'Posición P', sub: 'seno, fija', x: 63.5, y: 6.5, w: 15, h: 5.5, note: 'La misma codificación seno 2-D en todas las capas (un buffer, sin parámetros).' },
      { id: 'add-pos', op: 'tensorop', shape: 'add', label: 'x + P', labelPos: 'none', x: 43, y: 7.25, w: 4, h: 4,
        tex: 'q = k = x + P,\\quad v = x', note: 'La posición se suma a la entrada de Q y de K (dónde está cada token importa para decidir a quién mirar), pero no a V: lo que se mezcla es contenido.' },
      { id: 'self-attn', op: 'attn', label: 'Self-attention', drillLabel: 'Self-attention de una capa del encoder', sub: 'Q, K ← x + P · V ← x', heads: 'h', x: 18, y: 24, w: 34, h: 7, expand: 'detr-enc-attn',
        tex: '\\begin{aligned} &\\mathrm{softmax}\\big(QK^{\\top}/\\sqrt{d_h}\\big)\\,V \\\\ &Q, K \\leftarrow x{+}P,\\;\\; V \\leftarrow x \\end{aligned}',
        note: 'Atención entre los N tokens de la imagen, h cabezas. Es la parte cara del encoder: la matriz de puntuaciones es N×N por cabeza y crece con el cuadrado de la resolución. Ábrela para ver cada paso.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 33, y: 36, w: 4, h: 4, tex: 'x + \\mathrm{SA}(x)', note: 'Suma la entrada de la capa (sin posición) a la salida de la atención.' },
      { id: 'ln1', op: 'norm', label: 'LayerNorm 1', x: 24, y: 45, w: 22, h: 4, tex: "x' = \\mathrm{LN}(x + \\mathrm{SA}(x))", note: 'Post-LN: la LayerNorm va después de la suma y queda en el camino principal (no en una rama).' },
      { id: 'ffn', op: 'mlp', label: 'FFN', drillLabel: 'FFN de una capa del encoder', sub: 'D → D_mlp → D · ReLU', subNum: '{{cfg.D}} → {{cfg.Dmlp}} → {{cfg.D}} · ReLU', x: 22, y: 55, w: 26, h: 6,
        tex: '\\mathrm{FFN}(x) = W_2\\,\\mathrm{ReLU}(W_1 x + b_1) + b_2', note: 'Dos lineales por token con ReLU en medio (DETR usa ReLU, no GELU); ancho oculto D_mlp = 8D.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 33, y: 66, w: 4, h: 4, tex: "x' + \\mathrm{FFN}(x')", note: 'La residual sale de la salida de la LayerNorm 1 (post-LN).' },
      { id: 'ln2', op: 'norm', label: 'LayerNorm 2', x: 24, y: 75, w: 22, h: 4, tex: "x'' = \\mathrm{LN}(x' + \\mathrm{FFN}(x'))", note: 'Cierra la capa. El encoder de DETR no tiene LayerNorm final extra.' },
      { id: 'out', op: 'io', label: 'Salida (capa siguiente)', x: 24, y: 88.5, w: 22, h: 4, note: 'Misma forma que la entrada. Tras la última capa es la memoria que lee el decoder.' },
    ]),
    tensors: [
      { id: 'e-attn', at: { x: 70.5, y: 44 }, show: 'both', labelSide: 'below', glyph: 'amat', axes: { rows: 'img', cols: 'img' }, note: 'A (dentro de la self-attn)' },
    ],
    edges: [
      { from: 'in', to: 'self-attn', kind: 'data', tensor: 'memory-in', fromAt: 0.25, toAt: 0.2647, labelSide: 'left', labelT: 0.3, tag: 'V', tagStyle: 'plain', tagSide: 'on', tagT: 0.7 },
      { from: 'in', to: 'add-pos', kind: 'data', tensor: 'memory-in', fromSide: 'right', toSide: 'top', label: false },
      { from: 'pos', to: 'add-pos', kind: 'data', tensor: 'pos', fromSide: 'left', toSide: 'right', labelSide: 'below', labelT: 0.45 },
      { from: 'add-pos', to: 'self-attn', kind: 'data', tensor: 'e-qk-in', toAt: 0.7941, labelSide: 'left', labelT: 0.3, tag: 'Q, K', tagStyle: 'plain', tagSide: 'on', tagT: 0.7 },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'left', toSide: 'left', via: [[12, 2.5], [12, 38]] },
      { from: 'self-attn', to: 'res1', kind: 'data', tensor: 'e-o' },
      { from: 'res1', to: 'ln1', kind: 'data', tensor: 'e-r1' },
      { from: 'ln1', to: 'ffn', kind: 'data', tensor: 'e-ln1' },
      { from: 'ln1', to: 'res2', kind: 'residual', fromPt: [35, 52], toSide: 'left', via: [[12, 52], [12, 68]], dot: true },
      { from: 'ffn', to: 'res2', kind: 'data', tensor: 'e-f' },
      { from: 'res2', to: 'ln2', kind: 'data', tensor: 'e-r2' },
      { from: 'ln2', to: 'out', kind: 'data', tensor: 'memory', labelT: 0.8 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) capa del decoder (post-LN)
  // Residuales por la izquierda; q_pos, la posición y la memoria entran por la derecha.
  ATLAS.registerDiagram(Object.assign({
    id: 'detr-dec-layer', model: 'detr', config: C, kind: 'arch', title: 'Capa del decoder (post-LN)',
    parent: 'detr-overview', parentNode: 'dec-layer',
    caption: 'Tres sub-bloques post-LN. q_pos (las object queries) se suma a Q —y a K en la self-attention— en CADA atención; la memoria entra por el costado: K = memoria + P, V = memoria. El contenido t empieza en cero y se va llenando capa a capa.',
    grid: { w: 101, h: 129 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 5.5, w: 56, h: 115.5, repeat: { sym: 'L_d', from: 'Ldec' }, modality: 'qry' },
    ],
    nodes: scoped('decoder', [
      { id: 'in', op: 'io', label: 'Contenido t', sub: '(capa 1: ceros)', x: 27, y: 0.5, w: 20, h: 5, note: 'El contenido de las Q queries: ceros en la capa 1; después, la salida de la capa anterior.' },
      { id: 'qpos', op: 'io', modality: 'qry', label: 'q_{pos}', sub: 'queries', x: 67.5, y: 6.5, w: 12, h: 5.5, note: 'Las Q object queries aprendidas (la misma tabla en todas las capas).' },
      { id: 'add-qpos', op: 'tensorop', shape: 'add', label: 't + q_pos', labelPos: 'none', ops: ['d-add-qpos'], opsExact: true, x: 47, y: 7.25, w: 4, h: 4,
        tex: 'q = k = t + q_{pos},\\quad v = t', note: 'q_pos se suma a Q y K de la self-attention (V = t, sin posición).' },
      { id: 'self-attn', op: 'attn', label: 'Self-attention', drillLabel: 'Self-attention de una capa del decoder', sub: 'entre las Q queries', heads: 'h', x: 20, y: 24, w: 34, h: 7,
        tex: String.raw`\mathrm{SA}:\; Q\times Q \text{ por cabeza}`, note: 'Cada query mira a las demás: así se coordinan y dos queries no predicen el mismo objeto. Matriz Q×Q, barata (Q = ' + q('cfg.Q') + ').' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 35, y: 36, w: 4, h: 4, tex: 't + \\mathrm{SA}', note: 'Residual del contenido.' },
      { id: 'ln1', op: 'norm', label: 'LayerNorm 1', x: 26, y: 45, w: 22, h: 4, tex: "t' = \\mathrm{LN}(t + \\mathrm{SA})", note: 'Post-LN.' },
      { id: 'add-qpos-2', op: 'tensorop', shape: 'add', label: "t′ + q_{pos}", labelPos: 'left', ops: ['d-cross-add-qpos'], opsExact: true, x: 35, y: 53, w: 4, h: 4, tex: "q = t' + q_{pos}", note: 'La Q de la cross-attention lleva otra vez q_pos.' },
      { id: 'qpos-2', op: 'io', modality: 'qry', label: 'q_{pos}', x: 67.5, y: 52.5, w: 9, h: 5, note: 'La misma tabla de queries: se vuelve a sumar antes de la cross-attention.' },
      { id: 'pos', op: 'io', label: 'Posición P', sub: 'seno', x: 79, y: 51, w: 14, h: 5.5, note: 'La codificación seno de los N tokens de la memoria: se suma a K, no a V.' },
      { id: 'add-pos', op: 'tensorop', shape: 'add', label: 'm + P', labelPos: 'right', x: 84, y: 62.75, w: 4, h: 4, tex: 'k = m + P', note: 'Las keys de la cross-attention: memoria + posición.' },
      { id: 'memory', op: 'io', modality: 'img', label: 'Memoria m', sub: 'del encoder', x: 79, y: 73, w: 14, h: 6, note: 'La salida del encoder (N×D), la misma para las L_d capas del decoder.' },
      { id: 'cross-attn', op: 'attn', label: 'Cross-attention', drillLabel: 'Cross-attention de una capa del decoder', sub: 'Q: queries · K, V: memoria', heads: 'h', x: 18, y: 62, w: 38, h: 9, expand: 'detr-cross-attn',
        tex: '\\begin{aligned} &\\mathrm{softmax}\\big(QK^{\\top}/\\sqrt{d_h}\\big)\\,V \\\\ &Q \\leftarrow t{+}q_{pos} \\\\ &K \\leftarrow m{+}P,\\;\\; V \\leftarrow m \\end{aligned}',
        note: 'Cada una de las Q queries consulta los N tokens de la memoria: matriz Q×N por cabeza (lineal en N, a diferencia del encoder). Ábrela para ver cada paso.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 35, y: 77, w: 4, h: 4, tex: "t' + \\mathrm{CA}", note: 'Residual desde la salida de la LayerNorm 1.' },
      { id: 'ln2', op: 'norm', label: 'LayerNorm 2', x: 26, y: 85, w: 22, h: 4, tex: "t'' = \\mathrm{LN}(t' + \\mathrm{CA})", note: 'Post-LN.' },
      { id: 'ffn', op: 'mlp', label: 'FFN', drillLabel: 'FFN de una capa del decoder', sub: 'D → D_mlp → D · ReLU', subNum: '{{cfg.D}} → {{cfg.Dmlp}} → {{cfg.D}} · ReLU', x: 24, y: 94, w: 26, h: 6, tex: '\\mathrm{FFN}(t) = W_2\\,\\mathrm{ReLU}(W_1 t + b_1) + b_2', note: 'Igual que en el encoder.' },
      { id: 'res3', op: 'tensorop', shape: 'add', label: 'Residual 3', labelPos: 'right', x: 35, y: 104, w: 4, h: 4, tex: "t'' + \\mathrm{FFN}", note: 'Residual desde la salida de la LayerNorm 2.' },
      { id: 'ln3', op: 'norm', label: 'LayerNorm 3', x: 26, y: 112, w: 22, h: 4, tex: "t''' = \\mathrm{LN}(t'' + \\mathrm{FFN})", note: 'Cierra la capa.' },
      { id: 'out', op: 'io', label: 'Salida (capa siguiente)', x: 26, y: 124.5, w: 22, h: 4, note: 'Q×D. Tras la LayerNorm final compartida va a las cabezas (y, en el entrenamiento, también la de cada capa: pérdidas auxiliares).' },
    ]),
    tensors: [
      { id: 'd-self-scores', at: { x: 81, y: 35 }, show: 'both', labelSide: 'below', glyph: 'amat', axes: { rows: 'qry', cols: 'qry' }, note: 'self: Q×Q' },
      { id: 'd-cross-scores', at: { x: 83, y: 97 }, show: 'both', labelSide: 'below', glyph: 'amat', axes: { rows: 'qry', cols: 'img' }, note: 'cross: Q×N' },
    ],
    edges: [
      { from: 'in', to: 'self-attn', kind: 'data', tensor: 'tgt0', fromAt: 0.25, toAt: 0.3529, labelSide: 'left', labelT: 0.3, tag: 'V', tagStyle: 'plain', tagSide: 'on', tagT: 0.7 },
      { from: 'in', to: 'add-qpos', kind: 'data', tensor: 'tgt0', fromSide: 'right', toSide: 'top', label: false },
      { from: 'qpos', to: 'add-qpos', kind: 'query', tensor: 'query-pos', fromSide: 'left', toSide: 'right', labelSide: 'below', labelT: 0.45 },
      { from: 'add-qpos', to: 'self-attn', kind: 'data', tensor: 'd-qk-in', toAt: 0.8529, labelSide: 'left', labelT: 0.3, tag: 'Q, K', tagStyle: 'plain', tagSide: 'on', tagT: 0.7 },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'left', toSide: 'left', via: [[12, 3], [12, 38]] },
      { from: 'self-attn', to: 'res1', kind: 'data', tensor: 'd-self-o' },
      { from: 'res1', to: 'ln1', kind: 'data', tensor: 'd-r1' },
      { from: 'ln1', to: 'add-qpos-2', kind: 'data', tensor: 'd-ln1' },
      { from: 'qpos-2', to: 'add-qpos-2', kind: 'query', tensor: 'query-pos', fromSide: 'left', toSide: 'right', label: false },
      { from: 'add-qpos-2', to: 'cross-attn', kind: 'data', tensor: 'd-cross-q-in', label: false, tag: 'Q (Q×D)', tagStyle: 'plain', tagSide: 'on', tagT: 0.22 },
      { from: 'pos', to: 'add-pos', kind: 'data', tensor: 'pos', labelSide: 'left' },
      { from: 'memory', to: 'add-pos', kind: 'cross', tensor: 'memory', label: false, tag: 'K' },
      { from: 'add-pos', to: 'cross-attn', kind: 'cross', tensor: 'd-cross-k-in', fromSide: 'left', toSide: 'right', toAt: 0.3056, tag: 'K' },
      { from: 'memory', to: 'cross-attn', kind: 'cross', tensor: 'memory', fromSide: 'left', toSide: 'right', toAt: 0.75, midX: 70, labelSeg: 0, labelSide: 'below', tag: 'V', tagSeg: 2, tagT: 0.5 },
      { from: 'ln1', to: 'res2', kind: 'residual', fromPt: [37, 51], toSide: 'left', via: [[12, 51], [12, 79]], dot: true },
      { from: 'cross-attn', to: 'res2', kind: 'data', tensor: 'd-cross-o' },
      { from: 'res2', to: 'ln2', kind: 'data', tensor: 'd-r2' },
      { from: 'ln2', to: 'ffn', kind: 'data', tensor: 'd-ln2' },
      { from: 'ln2', to: 'res3', kind: 'residual', fromPt: [37, 91.5], toSide: 'left', via: [[12, 91.5], [12, 106]], dot: true },
      { from: 'ffn', to: 'res3', kind: 'data', tensor: 'd-f' },
      { from: 'res3', to: 'ln3', kind: 'data', tensor: 'd-r3' },
      { from: 'ln3', to: 'out', kind: 'data', tensor: 'd-out', labelT: 0.8 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) vistas de atención
  // Proyecciones separadas (nn.MultiheadAttention con q, k, v distintos): W_Q y W_K sobre la entrada con
  // posición, W_V sobre la entrada sin posición; un "Dividir" en h cabezas; la matriz de puntuaciones como
  // mazo de h matrices planas (glifo 'amat', filas = queries, columnas = keys).
  function attnSpec(kind) {
    const enc = kind === 'enc', P = enc ? 'e-' : 'd-cross-', scope = enc ? 'encoder' : 'cross-attn';
    const nodes = enc ? [
      { id: 'in-qk', op: 'io', label: 'x + P', sub: '(con la posición sumada)', x: 2, y: 0.5, w: 30, h: 5, note: 'Entrada de Q y K: los tokens con la posición sumada.' },
      { id: 'in-v', op: 'io', label: 'x', sub: '(sin posición)', x: 54, y: 0.5, w: 16, h: 5, note: 'Entrada de V: los tokens sin posición.' },
      { id: 'q-proj', op: 'embed', label: 'W_Q', drillLabel: 'W_Q de la self-attention del encoder (una capa)', sub: 'Linear D → D', x: 2, y: 10, w: 16, h: 5, tex: 'Q = (x+P)\\,W_Q + b_Q', note: 'Proyección de las queries.' },
      { id: 'k-proj', op: 'embed', label: 'W_K', drillLabel: 'W_K de la self-attention del encoder (una capa)', sub: 'Linear D → D', x: 20, y: 10, w: 16, h: 5, tex: 'K = (x+P)\\,W_K + b_K', note: 'Proyección de las keys.' },
      { id: 'v-proj', op: 'embed', label: 'W_V', drillLabel: 'W_V de la self-attention del encoder (una capa)', sub: 'Linear D → D', x: 54, y: 10, w: 16, h: 5, tex: 'V = x\\,W_V + b_V', note: 'Proyección de los values (sin posición).' },
    ] : [
      { id: 'in-q', op: 'io', modality: 'qry', label: "t′ + q_{pos}", sub: '(del decoder)', x: 2, y: 0.5, w: 22, h: 5, note: 'Entrada de Q: el contenido de las Q queries con query_pos sumada.' },
      { id: 'q-proj', op: 'embed', label: 'W_Q', drillLabel: 'W_Q de la cross-attention del decoder (una capa)', sub: 'Linear D → D', x: 5, y: 10, w: 16, h: 5, tex: "Q = (t'+q_{pos})\\,W_Q + b_Q", note: 'Proyección de las queries (Q filas).' },
      { id: 'mem-k', op: 'io', modality: 'img', label: 'memoria + P', x: 60, y: 8, w: 20, h: 5, note: 'Entrada de K: la memoria del encoder con la posición sumada.' },
      { id: 'k-proj', op: 'embed', label: 'W_K', drillLabel: 'W_K de la cross-attention del decoder (una capa)', sub: 'Linear D → D', x: 34, y: 8, w: 16, h: 5, tex: 'K = (m+P)\\,W_K + b_K', note: 'Proyección de las keys: N filas, una por token de la memoria.' },
      { id: 'mem-v', op: 'io', modality: 'img', label: 'memoria', x: 60, y: 16, w: 20, h: 5, note: 'Entrada de V: la memoria sin posición.' },
      { id: 'v-proj', op: 'embed', label: 'W_V', drillLabel: 'W_V de la cross-attention del decoder (una capa)', sub: 'Linear D → D', x: 34, y: 16, w: 16, h: 5, tex: 'V = m\\,W_V + b_V', note: 'Proyección de los values.' },
    ];
    const Y = enc ? 0 : 4;                                          // la vista cross baja todo 4 u
    const qx = enc ? 10 : 13;
    const E = enc ? 2 : 0;
    const Y2 = Y + 2;                                              // aire entre "Dividir" y el mazo de cabezas: las formas de Q y K caben encima                                         // la matriz N×N del encoder es más alta: más aire                                      // centro de W_Q (Q baja recto hasta Q·Kᵀ)
    nodes.push(
      { id: 'split', op: 'tensorop', shape: 'pill', symbol: 'split', label: 'Dividir Q, K, V en h cabezas', x: 6, y: 21 + Y, w: 58, h: 4.5, tex: 'n\\times d \\to h\\times n\\times d_h', note: 'Reshape: corta d en h trozos de d_h = d/h. Sin parámetros.' },
      { id: 'scores', op: 'attn', label: 'Q · Kᵀ', sub: enc ? 'cada token contra todos' : 'cada query contra cada token', x: 8, y: 36 + Y2, w: 36, h: 5, tex: enc ? 'S = QK^\\top \\in \\mathbb{R}^{h\\times N\\times N}' : 'S = QK^\\top \\in \\mathbb{R}^{h\\times Q\\times N}', note: enc ? 'N×N por cabeza: con N = ' + q('tokens') + ' tokens es la parte cuadrática del encoder.' : 'Q×N por cabeza: cada una de las Q queries contra los N tokens de la memoria. Lineal en N.' },
      { id: 'scale', op: 'attn', label: '÷ √d_h', shape: 'pill', x: 14, y: 50 + Y2 + E, w: 24, h: 4, tex: 'S/\\sqrt{d_h}', note: 'Escala estándar.' },
      { id: 'softmax', op: 'attn', label: 'softmax', sub: 'por fila', x: 14, y: 58 + Y2 + E, w: 24, h: 5, tex: 'A = \\mathrm{softmax}(S/\\sqrt{d_h})', note: enc ? 'Cada token reparte su atención entre los N tokens.' : 'Cada query reparte su atención entre los N tokens de la memoria.' },
      { id: 'weighted-sum', op: 'attn', label: 'A · V', sub: 'promedio ponderado', x: 8, y: 74 + Y2 + 2 * E, w: 36, h: 5, tex: '\\mathrm{head}_i = A_i V_i', note: 'Mezcla los values con los pesos de atención.' },
      { id: 'merge', op: 'tensorop', shape: 'concat', label: 'Concatenar cabezas', labelPos: 'right', x: 24, y: 88 + Y2 + 2 * E, w: 4, h: 4, tex: 'h\\times n\\times d_h \\to n\\times d', note: 'h·d_h = d.' },
      { id: 'proj', op: 'embed', label: 'W_O', drillLabel: enc ? 'W_O de la self-attention del encoder (una capa)' : 'W_O de la cross-attention del decoder (una capa)', sub: 'Linear D → D', x: 14, y: 97 + Y2 + 2 * E, w: 24, h: 5, tex: 'O = Z W_O + b_O', note: 'Mezcla las cabezas.' },
      { id: 'out', op: 'io', label: enc ? 'Hacia la residual 1' : 'Hacia la residual 2', x: 16, y: 107 + Y2 + 2 * E, w: 20, h: 4, note: 'Vuelve a la capa.' });
    const edges = (enc ? [
      { from: 'in-qk', to: 'q-proj', kind: 'data', tensor: 'e-qk-in', fromAt: 0.2667, label: false },
      { from: 'in-qk', to: 'k-proj', kind: 'data', tensor: 'e-qk-in', fromAt: 0.8667 },
      { from: 'in-v', to: 'v-proj', kind: 'data', tensor: 'memory-in' },
      { from: 'q-proj', to: 'split', kind: 'data', tensor: 'e-qp', toAt: 0.069, labelSide: 'left' },
      { from: 'k-proj', to: 'split', kind: 'data', tensor: 'e-kp', toAt: 0.3793 },
      { from: 'v-proj', to: 'split', kind: 'data', tensor: 'e-vp', toAt: 0.9655 },
    ] : [
      { from: 'in-q', to: 'q-proj', kind: 'data', tensor: 'd-cross-q-in' },
      { from: 'mem-k', to: 'k-proj', kind: 'cross', tensor: 'd-cross-k-in', fromSide: 'left', toSide: 'right', tag: 'K' },
      { from: 'mem-v', to: 'v-proj', kind: 'cross', tensor: 'memory', fromSide: 'left', toSide: 'right', tag: 'V' },
      { from: 'q-proj', to: 'split', kind: 'data', tensor: 'd-cross-qp', toAt: 0.1207, labelSide: 'left' },
      { from: 'k-proj', to: 'split', kind: 'data', tensor: 'd-cross-kp', fromSide: 'left', toSide: 'top', toAt: 0.3793, labelSeg: 1, labelSide: 'left' },
      { from: 'v-proj', to: 'split', kind: 'data', tensor: 'd-cross-vp', toAt: 0.6207 },
    ]).concat([
      { from: 'split', to: 'scores', kind: 'data', tensor: P + 'q', fromAt: (qx - 6) / 58, toAt: (qx - 8) / 36, labelSide: 'left', labelT: 0.22, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.85 },
      { from: 'split', to: 'scores', kind: 'data', tensor: P + 'k', fromAt: 34 / 58, toAt: 32 / 36, labelT: 0.22, tag: 'K', tagStyle: 'plain', tagSide: 'on', tagT: 0.85 },
      { from: 'split', to: 'weighted-sum', kind: 'data', tensor: P + 'v', fromSide: 'right', toSide: 'right', via: [[68, 23.25 + Y], [68, 76.5 + Y2 + 2 * E]], labelT: 0.6, tag: 'V', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.6 },
      { from: 'scores', to: 'scale', kind: 'data', tensor: P + 'scores' },
      { from: 'scale', to: 'softmax', kind: 'data', tensor: P + 'scores-scaled' },
      { from: 'softmax', to: 'weighted-sum', kind: 'data', tensor: P + 'attn' },
      { from: 'weighted-sum', to: 'merge', kind: 'data', tensor: P + 'z-heads', labelT: 0.62 },
      { from: 'merge', to: 'proj', kind: 'data', tensor: P + 'z' },
      { from: 'proj', to: 'out', kind: 'data', tensor: P + 'o' },
    ]);
    return Object.assign({
      id: enc ? 'detr-enc-attn' : 'detr-cross-attn', model: 'detr', config: C, kind: 'arch',
      title: enc ? 'Self-attention del encoder' : 'Cross-attention del decoder',
      parent: enc ? 'detr-enc-layer' : 'detr-dec-layer', parentNode: enc ? 'self-attn' : 'cross-attn',
      caption: enc
        ? 'Q y K se proyectan desde x + P; V desde x. Las h cabezas calculan cada una una matriz N×N (el mazo de matrices cuadradas): con N = ' + q('tokens') + ' tokens, es lo que domina el costo del encoder.'
        : 'Q viene del decoder (las Q queries); K y V vienen de la memoria del encoder (aristas dobles, desde el costado). La matriz de puntuaciones es Q×N por cabeza: ancha y baja, Q = ' + q('cfg.Q') + ' filas contra N = ' + q('tokens') + ' columnas.',
      grid: { w: 82, h: 112 + Y2 + 2 * E }, direction: 'tb', maxCrossings: 0,
      groups: [
        { id: 'heads', label: 'Las h cabezas, en paralelo', labelPos: 'bottom-right', heads: 'h', x: 4, y: 31.5 + Y2, w: 58, h: 51.5 + 2 * E },
      ],
      nodes: nodes.map((n) => (n.op === 'io' ? n : Object.assign({ scope }, n))),
      tensors: [
        { id: P + 'scores', at: { edge: 'scores>scale' }, show: 'both', glyph: 'amat', axes: { rows: enc ? 'img' : 'qry', cols: 'img' } },
        { id: P + 'attn', at: { edge: 'softmax>weighted-sum' }, show: 'both', glyph: 'amat', axes: { rows: enc ? 'img' : 'qry', cols: 'img' } },
      ],
      edges,
      legend: 'auto',
    }, PAGE);
  }
  ATLAS.registerDiagram(attnSpec('enc'));
  ATLAS.registerDiagram(attnSpec('cross'));

  // ------------------------------------------------------------------ Deformable DETR: atención deformable
  // La cross-attention deformable del decoder (scope cross-attn): la query predice dónde mirar (Δp) y cuánto
  // pesa cada muestra (A); los valores se leen con interpolación bilineal en h·L·K puntos. Sin Q·Kᵀ.
  const DD = 'deformable-detr-r50';
  ATLAS.registerDiagram({
    id: 'deformable-attn', model: 'deformable-detr', config: DD, kind: 'arch', title: 'Atención deformable multiescala',
    page: 'detr', section: 'variantes',
    caption: 'Cada query predice, con dos lineales, DÓNDE muestrear (offsets Δp alrededor de su punto de referencia, en cada uno de los L niveles) y CUÁNTO pesa cada muestra (softmax sobre los L·K puntos de cada cabeza). No hay Q·Kᵀ: el costo crece con el número de queries, no con N². El mismo módulo es la self-attention del encoder (query = cada token, referencia = su propia posición).',
    grid: { w: 112, h: 58 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['query', 'ref', 'memory', 'attn-weights', 'offsets', 'value-proj'],   // a 375 px, la mitad izquierda legible (se arrastra para ver el resto)
    nodes: scoped('cross-attn', [
      { id: 'query', op: 'io', modality: 'qry', label: 'Query z_q', sub: "t′ + q_pos", x: 1, y: 2, w: 15, h: 14, note: 'El vector de una query del decoder (con q_pos sumada). De él salen los offsets y los pesos.' },
      { id: 'ref', op: 'io', modality: 'qry', label: 'Referencia', sub: 'p̂ ∈ [0, 1]²', x: 1, y: 25.75, w: 16, h: 7, note: 'El punto de referencia normalizado de la query (en el decoder, una lineal + sigmoide de q_pos). Es el mismo punto relativo en los L niveles.' },
      { id: 'memory', op: 'io', modality: 'img', label: 'Memoria', sub: 'L niveles', subNum: '{{cfg.levels}} niveles', x: 1, y: 38, w: 18.5, h: 8, note: 'Los N tokens de los L mapas (strides 8, 16, 32 y 64), aplanados y concatenados en una sola secuencia.' },
      { id: 'attn-weights', op: 'embed', label: 'Pesos A (logits)', sub: 'Linear D → h·L·K', x: 30, y: 1.8, w: 22, h: 6,
        tex: 'A_{mlk} \\propto \\exp(z_q W_A)', note: 'Una lineal predice un peso por cabeza, nivel y punto: h·L·K = ' + '{{' + DD + '.samples}}' + ' números por query.' },
      { id: 'offsets', op: 'embed', label: 'Offsets Δp', sub: 'Linear D → h·L·K·2', x: 30, y: 10.2, w: 22, h: 6,
        tex: String.raw`\Delta p_{mlk} = z_q W_{\Delta}\;\in\mathbb{R}^2`, note: 'Otra lineal predice un desplazamiento (x, y) por cabeza, nivel y punto, en píxeles de cada nivel. Se inicializa en estrella: la cabeza m apunta en la dirección 2πm/h.' },
      { id: 'softmax', op: 'attn', label: 'softmax', sub: 'L·K por cabeza', x: 60, y: 2.3, w: 20, h: 5, tex: '\\textstyle\\sum_{l,k} A_{mlk} = 1', note: 'Normaliza los L·K pesos de cada cabeza (todos los niveles juntos).' },
      { id: 'value-proj', op: 'embed', label: 'W′ (valores)', drillLabel: 'W′ (proyección de valores de la atención deformable)', sub: 'Linear D → D', x: 30, y: 39, w: 22, h: 6, tex: 'v = x\\,W\'', note: 'Proyecta los N tokens de la memoria a valores (una sola vez por capa, compartida por todas las queries).' },
      { id: 'sample', op: 'attn', label: 'Muestrear', sub: 'bilineal en p̂ + Δp', x: 60, y: 24, w: 20, h: 8,
        tex: 'v_l\\big(\\phi_l(\\hat p) + \\Delta p_{mlk}\\big)', note: 'En cada nivel se lee el valor en la referencia + Δp con interpolación bilineal (4 vecinos): h·L·K muestras por query, en vez de comparar con los N tokens.' },
      { id: 'weighted-sum', op: 'attn', label: 'Σ A · v', sub: 'por cabeza', x: 92, y: 24, w: 14, h: 8, tex: '\\sum_{l,k} A_{mlk}\\, v_{mlk}', note: 'Suma ponderada de las L·K muestras de cada cabeza; las h cabezas se concatenan.' },
      { id: 'proj', op: 'embed', label: 'W_O', drillLabel: 'W_O de la atención deformable', sub: 'Linear D → D', x: 92, y: 38, w: 14, h: 6, tex: 'O = Z W_O', note: 'Mezcla las cabezas, como en la atención normal.' },
      { id: 'out', op: 'io', label: 'Salida', x: 92, y: 50, w: 14, h: 5, note: 'Q×D: va a la residual 2 de la capa del decoder.' },
    ]),
    notes: [
      { x: 20, y: 52, text: 'h = {{cfg.h}} cabezas · L = {{cfg.levels}} niveles · K = {{cfg.points}} puntos', cls: 'ink' },
      { x: 20, y: 54.4, text: '→ {{samples}} muestras por query (la atención densa: N = {{tokens}} keys)' },
    ],
    edges: [
      { from: 'query', to: 'attn-weights', kind: 'data', tensor: 'd-cross-q-in', fromAt: 0.2 },
      { from: 'query', to: 'offsets', kind: 'data', tensor: 'd-cross-q-in', fromAt: 0.8, label: false },
      { from: 'attn-weights', to: 'softmax', kind: 'data', tensor: 'd-cross-aw-logits' },
      { from: 'softmax', to: 'weighted-sum', kind: 'data', tensor: 'd-cross-aw', fromSide: 'right', toSide: 'top', labelSide: 'right' },
      { from: 'offsets', to: 'sample', kind: 'data', tensor: 'd-cross-offsets', fromSide: 'right', toSide: 'left', toAt: 0.25, via: [[56, 13.2]], labelSeg: 1, labelSide: 'right' },
      { from: 'ref', to: 'sample', kind: 'data', tensor: 'd-ref', toAt: 0.65 },
      { from: 'memory', to: 'value-proj', kind: 'data', tensor: 'memory' },
      { from: 'value-proj', to: 'sample', kind: 'data', tensor: 'd-cross-value', fromSide: 'right', toSide: 'bottom', labelSeg: 1, labelSide: 'right' },
      { from: 'sample', to: 'weighted-sum', kind: 'data', tensor: 'd-cross-sampled' },
      { from: 'weighted-sum', to: 'proj', kind: 'data', tensor: 'd-cross-z' },
      { from: 'proj', to: 'out', kind: 'data', tensor: 'd-cross-o' },
    ],
    legend: 'auto',
  });
})(typeof window !== 'undefined' ? window : globalThis);
