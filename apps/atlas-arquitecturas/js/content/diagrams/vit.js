/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/vit.js
   Diagramas de ViT (SPEC §7.2, ids de §13.1): vista general + bloques expandibles.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas de las aristas
   las pone el motor desde ATLAS.Arch.run('vit-b16-224'); aquí solo se nombran tensores.
   No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'vit-b16-224';
  const q = (k) => '{{' + C + '.' + k + '}}';     // cantidad del calculador en el texto del recorrido

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram({
    id: 'vit-overview', model: 'vit', config: C, kind: 'arch',
    title: 'ViT — vista general', page: 'vit', section: 'diagrama',
    caption: 'Imagen → parches → tokens (+ [CLS] + posición) → L capas pre-LN idénticas → LN → [CLS] → clasificador. Toca un bloque para ver su fórmula, sus formas y su costo; ábrelo para ver su interior.',
    grid: { w: 62, h: 120 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'encoder', label: 'Transformer encoder', x: 12, y: 57, w: 44, h: 16, repeat: { sym: 'L', from: 'L' }, modality: 'img' },
    ],
    nodes: [
      { id: 'input', op: 'io', label: 'Imagen', image: true, x: 26, y: 1, w: 16, h: 14,
        note: 'La imagen de entrada, en formato H×W×C (canales al final en el texto; PyTorch usa C×H×W). La cuadrícula dibujada es la de los parches P×P.' },
      { id: 'patch-embed', op: 'conv', label: 'Patch embedding', sub: 'conv P×P, stride P + flatten', x: 20, y: 22, w: 28, h: 6, expand: 'vit-patch-embed',
        tex: 'X_p = \\mathrm{flatten}(\\mathrm{Conv}_{P\\times P,\\,s=P}(x)) \\in \\mathbb{R}^{N\\times D}',
        note: 'Una convolución con kernel P×P y stride P: cada parche de la imagen se proyecta a un vector de D dimensiones, sin solaparse. Es exactamente "cortar parches, aplanarlos y aplicar una Linear(P²C → D)", escrito como conv. Después se aplana la rejilla (H/P)×(W/P) en una secuencia de N tokens.' },
      { id: 'cls', op: 'embed', label: 'Anteponer [CLS]', sub: 'x_class: 1×D aprendido', x: 22, y: 35, w: 24, h: 5,
        tex: '[\\,x_{\\text{class}};\\; X_p\\,] \\in \\mathbb{R}^{(N+1)\\times D}',
        note: 'Un vector aprendido (el token de clase) se pone delante de los N tokens de parche. Al final solo se lee su salida: tiene que "recoger" la información de toda la imagen vía atención. Es como el GAP de ResNet, pero aprendido.' },
      { id: 'pos-embed', op: 'embed', label: 'Position embedding', sub: 'E_pos aprendida', x: 2, y: 45, w: 18, h: 6,
        tex: 'E_{pos} \\in \\mathbb{R}^{(N+1)\\times D}',
        note: 'Una tabla aprendida con un vector por posición (1-D, incluida la del [CLS]). Sin ella la atención es invariante a permutaciones: no sabría qué parche está dónde. Si cambias la resolución, N cambia y hay que interpolar esta tabla.' },
      { id: 'add-pos', op: 'tensorop', shape: 'add', label: 'Sumar', labelPos: 'none', x: 32, y: 46, w: 4, h: 4,
        tex: 'z_0 = [\\,x_{\\text{class}};\\, X_p\\,] + E_{pos}',
        note: 'Suma elemento a elemento: cada token recibe el vector de su posición. No agrega parámetros.' },
      { id: 'enc-layer', op: 'attn', label: 'Capa del encoder (pre-LN)', x: 18, y: 61, w: 32, h: 9, expand: 'vit-enc-layer',
        mini: { items: [{ label: 'LN', op: 'norm' }, { label: 'MHSA', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] },
        tex: "z'_\\ell = \\mathrm{MSA}(\\mathrm{LN}(z_{\\ell-1})) + z_{\\ell-1},\\quad z_\\ell = \\mathrm{MLP}(\\mathrm{LN}(z'_\\ell)) + z'_\\ell",
        note: 'Una capa del encoder del Transformer, en variante pre-LN: la LayerNorm va antes de cada sub-bloque y la residual rodea cada uno. La forma (N+1)×D no cambia, por eso se apilan L capas idénticas (con pesos distintos).' },
      { id: 'final-ln', op: 'norm', label: 'LayerNorm final', x: 22, y: 79, w: 24, h: 5,
        tex: '\\mathrm{LN}(z_L)', note: 'Una última LayerNorm sobre todos los tokens (como timm). El paper la escribe solo sobre el [CLS]; como LN es por token, da lo mismo.' },
      { id: 'pool-cls', op: 'tensorop', shape: 'pool', label: 'Tomar [CLS]', labelPos: 'left', x: 32, y: 90, w: 4, h: 4,
        tex: 'y = \\mathrm{LN}(z_L)^{0}', note: 'Se queda solo con el token 0 (el [CLS]); los N tokens de parche se descartan para clasificar.' },
      { id: 'head', op: 'head', label: 'Clasificador', sub: 'Linear D → K', x: 22, y: 101, w: 24, h: 5,
        tex: '\\text{logits} = W_{head}\\, y + b,\\; W_{head}\\in\\mathbb{R}^{K\\times D}',
        note: 'Una capa lineal de D a K clases (timm, fine-tuning). En el pre-entrenamiento del paper había una capa oculta extra (MLP con tanh) que se quita al hacer fine-tuning.' },
      { id: 'output', op: 'io', label: 'Logits → clase', sub: 'argmax / softmax', x: 25, y: 113, w: 18, h: 5,
        note: 'Un logit por clase. Softmax para probabilidades; argmax para la predicción.' },
    ],
    tensors: [
      { id: 'x-img', at: { edge: 'input>patch-embed' }, show: 'both' },
      { id: 'x-patches', at: { edge: 'patch-embed>cls' }, show: 'both' },
      { id: 'x0', at: { edge: 'add-pos>enc-layer' }, show: 'both', mark: 'first' },
      { id: 'cls-out', at: { edge: 'pool-cls>head' }, show: 'both' },
      { id: 'logits', at: { edge: 'head>output' }, show: 'both' },
    ],
    edges: [
      { from: 'input', to: 'patch-embed', kind: 'data', tensor: 'x-img' },
      { from: 'patch-embed', to: 'cls', kind: 'data', tensor: 'x-patches' },
      { from: 'cls', to: 'add-pos', kind: 'data', tensor: 'x-cls-cat' },
      { from: 'pos-embed', to: 'add-pos', kind: 'data', tensor: 'e-pos', fromSide: 'right', toSide: 'left', labelSide: 'above' },
      { from: 'add-pos', to: 'enc-layer', kind: 'data', tensor: 'x0', labelT: 0.42 },
      { from: 'enc-layer', to: 'final-ln', kind: 'data', tensor: 'x-out', labelT: 0.72 },
      { from: 'final-ln', to: 'pool-cls', kind: 'data', tensor: 'x-ln' },
      { from: 'pool-cls', to: 'head', kind: 'data', tensor: 'cls-out' },
      { from: 'head', to: 'output', kind: 'data', tensor: 'logits' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (ViT-B/16 @ 224)', steps: [
        { nodes: ['input'], edges: ['input>patch-embed'], tensors: ['x-img'],
          text: 'Entra una imagen RGB de <b>' + q('tensor.x-img.shape') + '</b> (H×W×C). Sin batch: con batch sería B×' + q('tensor.x-img.shape') + '.' },
        { expand: 'vit-patch-embed', nodes: ['conv'], edges: ['in>conv', 'conv>flatten'], tensors: ['x-img', 'x-patch-grid'],
          text: 'Una conv de kernel ' + q('cfg.P') + '×' + q('cfg.P') + ' y stride ' + q('cfg.P') + ' corta ' + q('grid') + '×' + q('grid') + ' parches sin solaparse y proyecta cada uno (' + q('patchDim') + ' = P²·C números) a D = ' + q('cfg.D') + ': <b>' + q('tensor.x-patch-grid.shape') + '</b>. Parámetros: ' + q('op.patch-embed.paramArith') + '.' },
        { expand: 'vit-patch-embed', nodes: ['flatten'], edges: ['conv>flatten', 'flatten>out'], tensors: ['x-patch-grid', 'x-patches'],
          text: 'Se aplana la rejilla en una secuencia: N = (H/P)·(W/P) = ' + q('patches') + ' tokens de ' + q('cfg.D') + ' → <b>' + q('tensor.x-patches.shape') + '</b>. Sin parámetros.' },
        { nodes: ['cls'], edges: ['patch-embed>cls', 'cls>add-pos'], tensors: ['x-patches', 'x-cls-cat'],
          text: 'Se antepone el token [CLS] aprendido (' + q('clsParams') + ' parámetros): ' + q('patches') + ' + 1 = ' + q('tokens') + ' tokens → <b>' + q('tensor.x-cls-cat.shape') + '</b>.' },
        { nodes: ['pos-embed', 'add-pos'], edges: ['pos-embed>add-pos', 'cls>add-pos', 'add-pos>enc-layer'], tensors: ['e-pos', 'x0'],
          text: 'Se suma la tabla de posiciones aprendida E_pos de <b>' + q('tensor.e-pos.shape') + '</b> (' + q('posParams') + ' parámetros). Resultado z₀: <b>' + q('tensor.x0.shape') + '</b>, la entrada del encoder.' },
        { expand: 'vit-enc-layer', nodes: ['ln1'], edges: ['in>ln1', 'ln1>mhsa'], tensors: ['x0', 'h-ln1'],
          text: 'Dentro de la capa 1: LayerNorm por token (2·D = ' + q('op.ln1.params') + ' parámetros). La forma no cambia: <b>' + q('tensor.h-ln1.shape') + '</b>.' },
        { expand: 'vit-mhsa', nodes: ['qkv'], edges: ['in>qkv', 'qkv>split'], tensors: ['h-ln1', 'qkv'],
          text: 'Una sola matmul calcula Q, K y V juntos: D → 3D, <b>' + q('tensor.qkv.shape') + '</b>. Parámetros ' + q('op.qkv.paramArith') + '; MACs ' + q('op.qkv.macArith') + '.' },
        { expand: 'vit-mhsa', nodes: ['split'], edges: ['qkv>split', 'split>scores', 'split>weighted-sum'], tensors: ['q', 'k', 'v'],
          text: 'Se separa en Q, K, V y cada uno en h = ' + q('cfg.h') + ' cabezas de d_h = D/h = ' + q('dh') + ': tres tensores de <b>' + q('tensor.q.shape') + '</b>. Es un reshape, sin parámetros.' },
        { expand: 'vit-mhsa', nodes: ['scores'], edges: ['split>scores', 'scores>scale'], tensors: ['scores'],
          text: 'Por cabeza, QKᵀ compara cada token con todos: <b>' + q('tensor.scores.shape') + '</b> = ' + q('scoreEntries') + ' puntuaciones por capa. MACs ' + q('op.scores.macArith') + '. Esta es la parte que crece con N².' },
        { expand: 'vit-mhsa', nodes: ['scale', 'softmax'], edges: ['scores>scale', 'scale>softmax', 'softmax>weighted-sum'], tensors: ['scores-scaled', 'attn'],
          text: 'Se divide entre √d_h = √' + q('dh') + ' (para que la softmax no se sature) y softmax por fila: cada fila de <b>' + q('tensor.attn.shape') + '</b> suma 1.' },
        { expand: 'vit-mhsa', nodes: ['weighted-sum'], edges: ['softmax>weighted-sum', 'split>weighted-sum', 'weighted-sum>merge'], tensors: ['attn', 'v', 'z-heads'],
          text: 'A·V mezcla los values con esos pesos: <b>' + q('tensor.z-heads.shape') + '</b>. MACs ' + q('op.weighted-sum.macArith') + '.' },
        { expand: 'vit-mhsa', nodes: ['merge', 'proj'], edges: ['weighted-sum>merge', 'merge>proj', 'proj>out'], tensors: ['z', 'o'],
          text: 'Se concatenan las ' + q('cfg.h') + ' cabezas (' + q('cfg.h') + '·' + q('dh') + ' = ' + q('cfg.D') + ') → <b>' + q('tensor.z.shape') + '</b> y W_O mezcla entre cabezas: <b>' + q('tensor.o.shape') + '</b>. Parámetros ' + q('op.proj.paramArith') + '.' },
        { expand: 'vit-enc-layer', nodes: ['res1'], edges: ['mhsa>res1', 'in>res1', 'res1>ln2'], tensors: ['o', 'r1'],
          text: 'Residual 1: se suma la entrada de la capa a la salida de la atención → <b>' + q('tensor.r1.shape') + '</b>.' },
        { expand: 'vit-mlp', nodes: ['fc1', 'gelu', 'fc2'], edges: ['in>fc1', 'fc1>gelu', 'gelu>fc2', 'fc2>out'], tensors: ['h-ln2', 'u', 'g', 'f'],
          text: 'Tras la LN 2, el MLP expande a D_mlp = ' + q('cfg.Dmlp') + ' (<b>' + q('tensor.u.shape') + '</b>), aplica GELU y vuelve a D (<b>' + q('tensor.f.shape') + '</b>). Es el bloque más caro de la capa: ' + q('mlpParamsLayer') + ' parámetros.' },
        { expand: 'vit-enc-layer', nodes: ['res2', 'out'], edges: ['mlp>res2', 'res1>res2', 'res2>out'], tensors: ['f', 'x-out'],
          text: 'Residual 2 cierra la capa: <b>' + q('tensor.x-out.shape') + '</b>, la misma forma que entró. Una capa = ' + q('layerParams') + ' parámetros.' },
        { nodes: ['enc-layer'], edges: ['add-pos>enc-layer', 'enc-layer>final-ln'], tensors: ['x0', 'x-out'],
          text: 'Se repite L = ' + q('cfg.L') + ' veces con pesos distintos. El encoder completo suma ' + q('encoderParams') + ' parámetros y ' + q('encoderMacs') + ' MACs; sale z_L: <b>' + q('tensor.x-out.shape') + '</b>.' },
        { nodes: ['final-ln', 'pool-cls'], edges: ['enc-layer>final-ln', 'final-ln>pool-cls', 'pool-cls>head'], tensors: ['x-ln', 'cls-out'],
          text: 'LayerNorm final y se toma solo el token [CLS]: <b>' + q('tensor.cls-out.shape') + '</b> números resumen toda la imagen.' },
        { nodes: ['head', 'output'], edges: ['pool-cls>head', 'head>output'], tensors: ['logits'],
          text: 'El clasificador lineal D → K da <b>' + q('tensor.logits.shape') + '</b> logits (' + q('headParams') + ' parámetros). Total del modelo: ' + q('params.total') + ' parámetros, ' + q('macs.totalG') + ' MACs.' },
      ] },
    ],
    legend: 'auto',
  });

  // ------------------------------------------------------------------ (b) patch embedding
  ATLAS.registerDiagram({
    id: 'vit-patch-embed', model: 'vit', config: C, kind: 'arch',
    title: 'Patch embedding', page: 'vit', section: 'diagrama',
    parent: 'vit-overview', parentNode: 'patch-embed',
    caption: 'La conv P×P con stride P es "cortar parches + aplanar + Linear(P²C → D)". Mira cómo cambian las proporciones: una cara grande y poco profunda (la imagen) se vuelve una rejilla pequeña y muy profunda, y luego una secuencia larga.',
    grid: { w: 108, h: 29 }, direction: 'lr', maxCrossings: 0,
    groups: [
      { id: 'pe', label: 'Patch embedding', label2: '≡ parches P×P×C aplanados → Linear(P²·C → D)', x: 30, y: 3, w: 51, h: 23 },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Imagen', image: true, x: 1, y: 10, w: 15, h: 14, note: 'Imagen de entrada H×W×C con la cuadrícula de parches P×P superpuesta.' },
      { id: 'conv', op: 'conv', label: 'Conv2d P×P', sub: 'stride P · C → D', x: 35, y: 14, w: 17, h: 6, ops: ['patch-embed'],
        tex: '\\mathrm{Conv2d}(C\\!\\to\\! D,\\ k{=}P,\\ s{=}P)',
        note: 'Cada uno de los D filtros tiene P×P×C pesos + 1 bias. Con stride igual al kernel, cada salida mira exactamente un parche: es una proyección lineal por parche.' },
      { id: 'flatten', op: 'tensorop', shape: 'flatten', label: 'Aplanar', labelPos: 'below', x: 62, y: 15, w: 4, h: 4, ops: ['patch-flatten'],
        tex: '(H/P)\\times(W/P)\\times D \\to N\\times D', note: 'Reordena la rejilla en una secuencia fila por fila (raster). No tiene parámetros ni MACs.' },
      { id: 'out', op: 'io', label: 'Hacia [CLS] + posición', x: 85, y: 14.5, w: 21, h: 5, note: 'La secuencia de N tokens sigue a la vista general: se antepone [CLS] y se suma la tabla de posiciones.' },
    ],
    tensors: [
      { id: 'x-img', at: { edge: 'in>conv' }, show: 'both' },
      { id: 'x-patch-grid', at: { edge: 'conv>flatten' }, show: 'both' },
      { id: 'x-patches', at: { edge: 'flatten>out' }, show: 'both' },
    ],
    edges: [
      { from: 'in', to: 'conv', kind: 'data', tensor: 'x-img' },
      { from: 'conv', to: 'flatten', kind: 'data', tensor: 'x-patch-grid' },
      { from: 'flatten', to: 'out', kind: 'data', tensor: 'x-patches' },
    ],
    legend: 'auto',
  });

  // ------------------------------------------------------------------ (b) capa del encoder
  ATLAS.registerDiagram({
    id: 'vit-enc-layer', model: 'vit', config: C, kind: 'arch',
    title: 'Capa del encoder (pre-LN)', page: 'vit', section: 'diagrama',
    parent: 'vit-overview', parentNode: 'enc-layer',
    caption: 'Pre-LN: la LayerNorm va antes de cada sub-bloque y cada residual (línea discontinua) rodea un sub-bloque. Entra y sale la misma forma, por eso se apila L veces.',
    grid: { w: 60, h: 86 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 8, w: 46, h: 66, repeat: { sym: 'L', from: 'L' }, modality: 'img' },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada z_ℓ−1', x: 22, y: 1, w: 16, h: 4, note: 'La salida de la capa anterior (en la capa 1, z₀ = parches + [CLS] + posición).' },
      { id: 'ln1', op: 'norm', label: 'LayerNorm 1', x: 19, y: 14, w: 22, h: 4,
        tex: '\\mathrm{LN}(x) = \\gamma \\odot \\frac{x-\\mu}{\\sqrt{\\sigma^2+\\epsilon}} + \\beta', note: 'Normaliza cada token por separado (media y varianza sobre sus D componentes) y aplica γ, β aprendidos: 2·D parámetros.' },
      { id: 'mhsa', op: 'attn', label: 'Multi-head self-attention', sub: 'Q, K, V del mismo flujo', heads: 'h', x: 17, y: 25, w: 26, h: 6, expand: 'vit-mhsa',
        tex: '\\mathrm{MSA}(X) = [\\,\\mathrm{head}_1;\\dots;\\mathrm{head}_h\\,]\\,W_O', note: 'Cada token pregunta (Q) a todos los demás (K) y mezcla sus valores (V), en h cabezas en paralelo. Ábrela para ver cada paso con su forma.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 28, y: 36, w: 4, h: 4,
        tex: "z'_\\ell = \\mathrm{MSA}(\\mathrm{LN}(z_{\\ell-1})) + z_{\\ell-1}", note: 'Suma la entrada de la capa a la salida de la atención. Permite apilar muchas capas sin que el gradiente se pierda (como en ResNet).' },
      { id: 'ln2', op: 'norm', label: 'LayerNorm 2', x: 19, y: 46, w: 22, h: 4, tex: '\\mathrm{LN}(z\'_\\ell)', note: 'Segunda LayerNorm, antes del MLP. Otros 2·D parámetros.' },
      { id: 'mlp', op: 'mlp', label: 'MLP', sub: 'D → D_mlp → D · GELU', x: 19, y: 55, w: 22, h: 6, expand: 'vit-mlp',
        tex: '\\mathrm{MLP}(x) = W_2\\,\\mathrm{GELU}(W_1 x + b_1) + b_2', note: 'Dos capas lineales por token con GELU en medio; la oculta es 4× más ancha (D_mlp = 4D). Es donde están dos tercios de los parámetros de la capa.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 28, y: 66, w: 4, h: 4,
        tex: "z_\\ell = \\mathrm{MLP}(\\mathrm{LN}(z'_\\ell)) + z'_\\ell", note: 'Segunda residual: cierra la capa.' },
      { id: 'out', op: 'io', label: 'Salida z_ℓ', x: 22, y: 81, w: 16, h: 4, note: 'Misma forma que la entrada. Va a la capa siguiente; tras la última, a la LayerNorm final.' },
    ],
    edges: [
      { from: 'in', to: 'ln1', kind: 'data', tensor: 'x0', labelT: 0.66 },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[30, 6.5], [12, 6.5], [12, 38]], dot: true },
      { from: 'ln1', to: 'mhsa', kind: 'data', tensor: 'h-ln1', labelT: 0.28 },
      { from: 'mhsa', to: 'res1', kind: 'data', tensor: 'o' },
      { from: 'res1', to: 'ln2', kind: 'data', tensor: 'r1' },
      { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[30, 42], [12, 42], [12, 68]], dot: true },
      { from: 'ln2', to: 'mlp', kind: 'data', tensor: 'h-ln2' },
      { from: 'mlp', to: 'res2', kind: 'data', tensor: 'f' },
      { from: 'res2', to: 'out', kind: 'data', tensor: 'x-out', labelT: 0.74 },
    ],
    legend: 'auto',
  });

  // ------------------------------------------------------------------ (b) MHSA
  ATLAS.registerDiagram({
    id: 'vit-mhsa', model: 'vit', config: C, kind: 'arch',
    title: 'Multi-head self-attention', page: 'vit', section: 'diagrama',
    parent: 'vit-enc-layer', parentNode: 'mhsa',
    caption: 'Una matmul da Q, K y V; se dividen en h cabezas (la pila de cartas); cada cabeza calcula QKᵀ/√d_h, softmax por fila y A·V; se concatenan las cabezas y W_O las mezcla.',
    grid: { w: 72, h: 101 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'heads', label: 'Una cabeza (las h corren en paralelo)', labelPos: 'bottom-right', heads: 'h', x: 8, y: 31, w: 58, h: 39 },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada (tras LN 1)', x: 21, y: 1, w: 18, h: 4, note: 'Los tokens normalizados por la LayerNorm 1.' },
      { id: 'qkv', op: 'embed', label: 'Proyección Q, K, V', sub: 'Linear D → 3D', x: 16, y: 9, w: 28, h: 5,
        tex: '[\\,Q\\;K\\;V\\,] = X\\,W_{QKV} + b,\\; W_{QKV}\\in\\mathbb{R}^{D\\times 3D}',
        note: 'Las tres proyecciones W_Q, W_K, W_V (cada una D×D) se calculan en una sola matmul fusionada de D a 3D, con bias (como timm).' },
      { id: 'split', op: 'tensorop', shape: 'pill', symbol: 'split', label: 'Dividir: Q, K, V · h cabezas', x: 14, y: 19, w: 32, h: 4,
        tex: '(N{+}1)\\times 3D \\to 3\\times h\\times (N{+}1)\\times d_h', note: 'Reshape + permute: separa Q, K y V y corta D en h trozos de d_h = D/h. No hay parámetros ni MACs.' },
      { id: 'scores', op: 'attn', label: 'Q · Kᵀ', sub: 'producto punto entre todos los pares', x: 12, y: 35, w: 36, h: 5,
        tex: 'S = Q K^\\top \\in \\mathbb{R}^{h\\times (N+1)\\times (N+1)}', note: 'Para cada cabeza, el producto punto de cada query con cada key: una matriz (N+1)×(N+1). Su costo es (N+1)²·d_h por cabeza: crece con el cuadrado de los tokens.' },
      { id: 'scale', op: 'attn', label: '÷ √d_h', shape: 'pill', x: 20, y: 44, w: 20, h: 4,
        tex: 'S / \\sqrt{d_h}', note: 'Escala para que la varianza de los productos punto no crezca con d_h y la softmax no se sature (gradientes casi cero).' },
      { id: 'softmax', op: 'attn', label: 'softmax', sub: 'por fila', x: 20, y: 52, w: 20, h: 5,
        tex: 'A = \\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_h}}\\right)', note: 'Cada fila (una query) se vuelve una distribución sobre las N+1 keys: pesos ≥ 0 que suman 1.' },
      { id: 'weighted-sum', op: 'attn', label: 'A · V', sub: 'promedio ponderado de los values', x: 12, y: 62, w: 36, h: 5,
        tex: '\\mathrm{head}_i = A_i V_i \\in \\mathbb{R}^{(N+1)\\times d_h}', note: 'Cada token se reemplaza por una mezcla de los values de todos los tokens, con los pesos de atención. Mismo costo que QKᵀ.' },
      { id: 'merge', op: 'tensorop', shape: 'concat', label: 'Concatenar cabezas', labelPos: 'right', x: 28, y: 76, w: 4, h: 4,
        tex: 'h\\times (N{+}1)\\times d_h \\to (N{+}1)\\times D', note: 'Pone las h salidas una al lado de otra: h·d_h = D. Es un reshape, sin parámetros.' },
      { id: 'proj', op: 'embed', label: 'Proyección de salida W_O', sub: 'Linear D → D', x: 16, y: 85, w: 28, h: 5,
        tex: 'O = [\\,\\mathrm{head}_1;\\dots;\\mathrm{head}_h\\,]\\,W_O + b', note: 'Mezcla la información de las distintas cabezas. D·D + D parámetros.' },
      { id: 'out', op: 'io', label: 'Hacia la residual 1', x: 21, y: 96, w: 18, h: 4, note: 'Vuelve a la capa del encoder, donde se suma con la entrada (residual 1).' },
    ],
    edges: [
      { from: 'in', to: 'qkv', kind: 'data', tensor: 'h-ln1' },
      { from: 'qkv', to: 'split', kind: 'data', tensor: 'qkv' },
      { from: 'split', to: 'scores', kind: 'data', tensor: 'q', fromSide: 'bottom', fromAt: 0.0625, toSide: 'top', toAt: 0.1111, labelSide: 'left', labelT: 0.3 },
      { from: 'split', to: 'scores', kind: 'data', tensor: 'k', fromSide: 'bottom', toSide: 'top', labelT: 0.3 },
      { from: 'split', to: 'weighted-sum', kind: 'data', tensor: 'v', fromSide: 'right', toSide: 'right', via: [[54, 21], [54, 64.5]], labelT: 0.45 },
      { from: 'scores', to: 'scale', kind: 'data', tensor: 'scores' },
      { from: 'scale', to: 'softmax', kind: 'data', tensor: 'scores-scaled' },
      { from: 'softmax', to: 'weighted-sum', kind: 'data', tensor: 'attn' },
      { from: 'weighted-sum', to: 'merge', kind: 'data', tensor: 'z-heads', labelT: 0.62 },
      { from: 'merge', to: 'proj', kind: 'data', tensor: 'z' },
      { from: 'proj', to: 'out', kind: 'data', tensor: 'o' },
    ],
    legend: 'auto',
  });

  // ------------------------------------------------------------------ (b) MLP
  ATLAS.registerDiagram({
    id: 'vit-mlp', model: 'vit', config: C, kind: 'arch',
    title: 'MLP (feed-forward)', page: 'vit', section: 'diagrama',
    parent: 'vit-enc-layer', parentNode: 'mlp',
    caption: 'Por token: expandir a D_mlp = 4D, GELU, volver a D. Fíjate en la profundidad del tensor del medio.',
    grid: { w: 58, h: 60 }, direction: 'tb', maxCrossings: 0,
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada (tras LN 2)', x: 15, y: 1, w: 18, h: 4, note: 'Los tokens normalizados por la LayerNorm 2.' },
      { id: 'fc1', op: 'mlp', label: 'Linear 1', sub: 'D → D_mlp', x: 12, y: 12, w: 24, h: 5,
        tex: 'U = X W_1 + b_1,\\; W_1 \\in \\mathbb{R}^{D\\times D_{mlp}}', note: 'Expande cada token de D a D_mlp = 4D. Se aplica igual a cada token (por eso a veces se llama "position-wise").' },
      { id: 'gelu', op: 'mlp', label: 'GELU', shape: 'pill', x: 16, y: 26, w: 16, h: 4,
        tex: '\\mathrm{GELU}(u) = u\\,\\Phi(u)', note: 'No linealidad suave (como una ReLU redondeada). Elemento a elemento, sin parámetros.' },
      { id: 'fc2', op: 'mlp', label: 'Linear 2', sub: 'D_mlp → D', x: 12, y: 38, w: 24, h: 5,
        tex: 'F = G W_2 + b_2,\\; W_2 \\in \\mathbb{R}^{D_{mlp}\\times D}', note: 'Vuelve a D para poder sumar con la residual.' },
      { id: 'out', op: 'io', label: 'Hacia la residual 2', x: 15, y: 53, w: 18, h: 4, note: 'Vuelve a la capa del encoder, donde se suma con z\'ℓ (residual 2).' },
    ],
    tensors: [
      { id: 'h-ln2', at: { edge: 'in>fc1' }, show: 'both' },
      { id: 'u', at: { edge: 'fc1>gelu' }, show: 'both' },
      { id: 'g', at: { edge: 'gelu>fc2' }, show: 'both' },
      { id: 'f', at: { edge: 'fc2>out' }, show: 'both' },
    ],
    edges: [
      { from: 'in', to: 'fc1', kind: 'data', tensor: 'h-ln2' },
      { from: 'fc1', to: 'gelu', kind: 'data', tensor: 'u' },
      { from: 'gelu', to: 'fc2', kind: 'data', tensor: 'g' },
      { from: 'fc2', to: 'out', kind: 'data', tensor: 'f' },
    ],
    legend: 'auto',
  });
})(typeof window !== 'undefined' ? window : globalThis);
