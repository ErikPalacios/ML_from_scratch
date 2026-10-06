/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/repaso.js
   Diagramas del repaso de atención (SPEC §13.2): un bloque pre-LN del juguete (N=5, D=8, h=2)
   y su MHSA expandida. Mismos ids de nodo y de tensor que la capa de ViT (vit-enc-layer /
   vit-mhsa), así el usuario compara formas 1:1. Solo datos; no toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'toy-n5-d8';
  const q = (k) => '{{' + C + '.' + k + '}}';

  // ------------------------------------------------------------------ (a) un bloque pre-LN
  ATLAS.registerDiagram({
    id: 'repaso-block', model: 'transformer', config: C, kind: 'arch',
    title: 'Bloque Transformer pre-LN (juguete)', page: 'repaso-atencion', section: 'atencion',
    caption: 'Un bloque pre-LN con el ejemplo de juguete (N = 5 tokens, D = 8, h = 2), como en el Laboratorio. Abre la MHSA para ver cada paso con su forma.',
    grid: { w: 60, h: 86 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Bloque pre-LN', labelPos: 'bottom', x: 8, y: 8, w: 46, h: 66 },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada X', x: 22, y: 1, w: 16, h: 4, note: 'N tokens de D dimensiones (en el juguete no hay embeddings: la entrada ya es X).' },
      { id: 'ln1', op: 'norm', label: 'LayerNorm 1', x: 19, y: 14, w: 22, h: 4,
        tex: '\\mathrm{LN}(x) = \\gamma \\odot \\frac{x-\\mu}{\\sqrt{\\sigma^2+\\epsilon}} + \\beta', note: 'Normaliza cada token sobre sus D componentes; γ y β aprendidos (2·D parámetros).' },
      { id: 'mhsa', op: 'attn', label: 'Multi-head self-attention', sub: 'Q, K, V del mismo X', heads: 'h', x: 17, y: 25, w: 26, h: 6, expand: 'repaso-mhsa',
        tex: '\\mathrm{MHA}(X) = [\\,\\mathrm{head}_1;\\dots;\\mathrm{head}_h\\,]\\,W_O', note: 'h cabezas de atención en paralelo, cada una de ancho d_h = D/h. Ábrela para ver los pasos.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 28, y: 36, w: 4, h: 4,
        tex: "X' = X + \\mathrm{MHA}(\\mathrm{LN}(X))", note: 'Suma la entrada a la salida de la atención.' },
      { id: 'ln2', op: 'norm', label: 'LayerNorm 2', x: 19, y: 46, w: 22, h: 4, tex: "\\mathrm{LN}(X')", note: 'Segunda LayerNorm, antes del MLP.' },
      { id: 'mlp', op: 'mlp', label: 'MLP', sub: 'D → D_mlp → D · GELU', x: 19, y: 55, w: 22, h: 6,
        tex: '\\mathrm{FFN}(x) = W_2\\,\\mathrm{GELU}(W_1 x + b_1) + b_2', note: 'Dos lineales por token con GELU en medio; D_mlp = 4D.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 28, y: 66, w: 4, h: 4,
        tex: "Y = X' + \\mathrm{FFN}(\\mathrm{LN}(X'))", note: 'Segunda residual: salida del bloque.' },
      { id: 'out', op: 'io', label: 'Salida Y', x: 22, y: 81, w: 16, h: 4, note: 'Misma forma que la entrada: por eso los bloques se apilan.' },
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
    walks: [
      { id: 'forward', label: 'Recorrido con el juguete', steps: [
        { nodes: ['in', 'ln1'], edges: ['in>ln1', 'ln1>mhsa'], tensors: ['x0', 'h-ln1'],
          text: 'Entran N = ' + q('N') + ' tokens de D = ' + q('D') + ': <b>' + q('tensor.x0.shape') + '</b>. La LayerNorm no cambia la forma.' },
        { expand: 'repaso-mhsa', nodes: ['qkv', 'split'], edges: ['in>qkv', 'qkv>split', 'split>scores', 'split>weighted-sum'], tensors: ['qkv', 'q', 'k', 'v'],
          text: 'Una matmul da Q, K, V juntos (<b>' + q('tensor.qkv.shape') + '</b>) y se cortan en h = ' + q('h') + ' cabezas de d_h = ' + q('dh') + ': <b>' + q('tensor.q.shape') + '</b> cada uno.' },
        { expand: 'repaso-mhsa', nodes: ['scores', 'scale', 'softmax'], edges: ['scores>scale', 'scale>softmax', 'softmax>weighted-sum'], tensors: ['scores', 'scores-scaled', 'attn'],
          text: 'QKᵀ/√d_h y softmax por fila: una matriz <b>' + q('tensor.attn.shape') + '</b> (h matrices N×N) cuyas filas suman 1.' },
        { expand: 'repaso-mhsa', nodes: ['weighted-sum', 'merge', 'proj'], edges: ['weighted-sum>merge', 'merge>proj', 'proj>out'], tensors: ['z-heads', 'z', 'o'],
          text: 'A·V da <b>' + q('tensor.z-heads.shape') + '</b>; se concatenan las cabezas (<b>' + q('tensor.z.shape') + '</b>) y W_O las mezcla.' },
        { nodes: ['res1', 'ln2', 'mlp'], edges: ['mhsa>res1', 'in>res1', 'res1>ln2', 'ln2>mlp', 'mlp>res2'], tensors: ['r1', 'h-ln2', 'f'],
          text: 'Residual 1, LayerNorm 2 y el MLP (D → ' + q('Dmlp') + ' → D) por token.' },
        { nodes: ['res2', 'out'], edges: ['mlp>res2', 'res1>res2', 'res2>out'], tensors: ['x-out'],
          text: 'Residual 2: sale <b>' + q('tensor.x-out.shape') + '</b>, la misma forma que entró. El bloque tiene ' + q('layerParams') + ' parámetros.' },
      ] },
    ],
    legend: 'auto',
  });

  // ------------------------------------------------------------------ (b) MHSA del juguete
  ATLAS.registerDiagram({
    id: 'repaso-mhsa', model: 'transformer', config: C, kind: 'arch',
    title: 'Multi-head attention (juguete)', page: 'repaso-atencion', section: 'atencion',
    parent: 'repaso-block', parentNode: 'mhsa',
    caption: 'Q, K, V → h cabezas → QKᵀ/√d_h → softmax → A·V → concatenar → W_O, con las formas del juguete.',
    grid: { w: 72, h: 101 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'heads', label: 'Una cabeza (las h corren en paralelo)', labelPos: 'bottom-right', heads: 'h', x: 8, y: 31, w: 58, h: 39 },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada (tras LN 1)', x: 21, y: 1, w: 18, h: 4, note: 'Los tokens normalizados.' },
      { id: 'qkv', op: 'embed', label: 'Proyección Q, K, V', sub: 'Linear D → 3D', x: 16, y: 9, w: 28, h: 5,
        tex: '[\\,Q\\;K\\;V\\,] = X\\,W_{QKV} + b', note: 'W_Q, W_K, W_V fusionadas en una matmul D → 3D.' },
      { id: 'split', op: 'tensorop', shape: 'pill', symbol: 'split', label: 'Dividir: Q, K, V · h cabezas', x: 14, y: 19, w: 32, h: 4,
        tex: 'N\\times 3D \\to 3\\times h\\times N\\times d_h', note: 'Reshape: separa Q, K, V y corta D en h trozos de d_h.' },
      { id: 'scores', op: 'attn', label: 'Q · Kᵀ', sub: 'producto punto entre todos los pares', x: 12, y: 35, w: 36, h: 5,
        tex: 'S = QK^\\top \\in \\mathbb{R}^{h\\times N\\times N}', note: 'Similitud de cada query con cada key.' },
      { id: 'scale', op: 'attn', label: '÷ √d_h', shape: 'pill', x: 20, y: 44, w: 20, h: 4, tex: 'S/\\sqrt{d_h}', note: 'Evita que la softmax se sature.' },
      { id: 'softmax', op: 'attn', label: 'softmax', sub: 'por fila (+ máscara)', x: 20, y: 52, w: 20, h: 5,
        tex: 'A = \\mathrm{softmax}(S/\\sqrt{d_h} + M)', note: 'Cada fila suma 1. Con máscara causal, M = −∞ sobre el futuro (mismos conteos, menos scores usados).' },
      { id: 'weighted-sum', op: 'attn', label: 'A · V', sub: 'promedio ponderado de los values', x: 12, y: 62, w: 36, h: 5,
        tex: '\\mathrm{head}_i = A_i V_i', note: 'Mezcla de values con los pesos de atención.' },
      { id: 'merge', op: 'tensorop', shape: 'concat', label: 'Concatenar cabezas', labelPos: 'right', x: 28, y: 76, w: 4, h: 4,
        tex: 'h\\times N\\times d_h \\to N\\times D', note: 'h·d_h = D.' },
      { id: 'proj', op: 'embed', label: 'Proyección de salida W_O', sub: 'Linear D → D', x: 16, y: 85, w: 28, h: 5,
        tex: 'O = [\\,\\mathrm{head}_1;\\dots;\\mathrm{head}_h\\,]W_O + b', note: 'Mezcla las cabezas.' },
      { id: 'out', op: 'io', label: 'Hacia la residual 1', x: 21, y: 96, w: 18, h: 4, note: 'Vuelve al bloque.' },
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
})(typeof window !== 'undefined' ? window : globalThis);
