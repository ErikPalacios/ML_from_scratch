/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/llm-decoder.js
   Diagramas del decoder tipo Llama (SPEC §7.2, ids de §18.1), config canónica llama3-8b (modelo `llm`):
     llm-decoder-overview  tokens → embedding → L bloques idénticos → RMSNorm final → LM head → logits → muestrear;
                           el token muestreado vuelve a la entrada (arista de control: el tiempo, t → t+1).
       llm-block           un bloque pre-norm: RMSNorm → atención GQA → ⊕ → RMSNorm → FFN SwiGLU → ⊕ (residuales
                           discontinuas por fuera).
         llm-gqa           W_Q (ancha) y W_K, W_V (angostas: G·d_h) → dividir en cabezas (los G grupos: cada K,V sirve a
                           h/G queries) → RoPE en q y k → QKᵀ → ÷√d_h → softmax con la máscara causal (control) → A·V →
                           concatenar → W_O. Orden de HF: dividir ANTES de RoPE.
         llm-swiglu        W_gate y W_up en paralelo → SiLU(gate) ⊙ up → W_down.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas las pone el motor desde ATLAS.Arch.run; aquí
   solo se nombran tensores. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'llama3-8b';
  const q = (k) => '{{' + C + '.' + k + '}}';
  // configs densas: con Mixtral la FFN es MoE (diagrama moe-block), así que estas vistas no aplican (el motor avisa)
  const PAGE = { page: 'llm-decoder', section: 'diagrama', configs: ['llama3-8b', 'llama3-70b', 'llama2-7b'],
    configsNote: 'su FFN es MoE: ver el diagrama moe-block' };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'llm-decoder-overview', model: 'llm', config: C, kind: 'arch', title: 'Decoder tipo Llama — vista general',
    caption: 'Un LLM decoder-only (Llama 3 8B): los ids de los tokens se convierten en vectores con una tabla (sin posiciones: la posición entra con RoPE dentro de cada atención), pasan por L bloques idénticos pre-norm (RMSNorm → atención GQA causal → ⊕ → RMSNorm → FFN SwiGLU → ⊕), una RMSNorm final y el LM head (D → V, sin atar con el embedding) da un logit por palabra del vocabulario. Se muestrea el siguiente token de la última fila y vuelve a la entrada (arista punteada: el tiempo). Toca un bloque para ver su costo; ábrelo para ver su interior.',
    grid: { w: 70, h: 104 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['embed', 'blocks', 'final-norm'],
    groups: [
      { id: 'blocks', label: 'Bloques decoder', x: 9, y: 26, w: 50, h: 17, repeat: { sym: 'L', from: 'L', totalOf: 'block' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'tokens', op: 'io', modality: 'txt', label: 'Tokens (ids)', sub: 'T enteros en [0, V)', x: 22, y: 1, w: 24, h: 6,
        note: 'El prompt ya tokenizado (BPE de 128K entradas en Llama 3): T números enteros, uno por token. En la generación, cada token muestreado se agrega al final.' },
      { id: 'embed', op: 'embed', label: 'Embedding de tokens', sub: 'tabla V × D, sin posición', subNum: 'tabla {{cfg.V}} × {{cfg.D}}', x: 19, y: 13, w: 30, h: 6,
        tex: 'x_0 = E[\\mathrm{ids}] \\in \\mathbb{R}^{T\\times D}', note: 'Una tabla aprendida: cada id elige una fila de D números. No se suma ninguna tabla de posiciones (como en ViT o GPT-2): la posición entra con RoPE, rotando q y k dentro de cada atención.' },
      { id: 'block', op: 'attn', style: 'block', badgeTotal: true, label: 'Bloque decoder (pre-norm)', x: 13, y: 31, w: 42, h: 9, expand: 'llm-block',
        mini: { items: [{ label: 'RMSNorm', op: 'norm' }, { label: 'GQA', op: 'attn' }, { sym: 'add' }, { label: 'RMSNorm', op: 'norm' }, { label: 'SwiGLU', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] },
        tex: "\\begin{aligned} r &= x + \\mathrm{Attn}(\\mathrm{RMSNorm}(x)) \\\\ y &= r + \\mathrm{FFN}(\\mathrm{RMSNorm}(r)) \\end{aligned}",
        note: 'Un bloque pre-norm: la norma va ANTES de cada sub-bloque y la residual lo rodea. La forma T×D no cambia, por eso se apilan L bloques idénticos (con pesos distintos). Ábrelo para ver la atención GQA y la FFN SwiGLU.' },
      { id: 'final-norm', op: 'norm', label: 'RMSNorm final', x: 22, y: 50, w: 24, h: 5,
        tex: '\\mathrm{RMSNorm}(x) = \\gamma \\odot \\frac{x}{\\sqrt{\\tfrac{1}{D}\\sum_i x_i^2 + \\epsilon}}', note: 'Una última RMSNorm sobre la salida del último bloque (sin ella, la escala de los logits dependería de cuánto creció la residual).' },
      { id: 'lm-head', op: 'head', label: 'LM head', sub: 'Linear D → V, sin atar', x: 19, y: 62, w: 30, h: 6,
        tex: '\\text{logits} = x\\,W_{\\text{head}},\\; W_{\\text{head}} \\in \\mathbb{R}^{D\\times V}', note: 'Una capa lineal de D al tamaño del vocabulario, sin sesgo. En Llama 3 NO comparte pesos con el embedding (otros modelos sí: "tied embeddings"). Con un vocabulario de 128K es una de las matrices más grandes del modelo. Al generar solo hace falta la última fila.' },
      { id: 'logits', op: 'io', label: 'Logits', sub: 'uno por token del vocabulario', x: 21, y: 77, w: 26, h: 6,
        note: 'Un número por token del vocabulario y por posición: la fila t predice el token t+1 (en el entrenamiento se usan todas las filas; al generar, solo la última).' },
      { id: 'sample', op: 'tensorop', shape: 'pill', symbol: 'pick', label: 'Muestrear el siguiente', sub: 'argmax · temperatura · top-p', x: 17, y: 91, w: 34, h: 6,
        tex: 'p = \\mathrm{softmax}(\\text{logits}_{T} / \\tau),\\quad \\text{token}_{T+1} \\sim p', note: 'De la última fila: softmax (con temperatura τ) y se elige un token: el más probable (greedy) o uno al azar entre los más probables (top-k, top-p). Sin parámetros. El token elegido se agrega a la entrada y se repite todo: eso es generar de forma autorregresiva (y por eso existe el KV cache, en la página de inferencia).' },
    ],
    tensors: [
      { id: 'ids', at: { edge: 'tokens>embed' }, show: 'both' },
      { id: 'x0', at: { edge: 'embed>block' }, show: 'both' },
      { id: 'logits', at: { edge: 'lm-head>logits' }, show: 'both' },
    ],
    edges: [
      { from: 'tokens', to: 'embed', kind: 'data', tensor: 'ids' },
      { from: 'embed', to: 'block', kind: 'data', tensor: 'x0', labelT: 0.3 },
      { from: 'block', to: 'final-norm', kind: 'data', tensor: 'x-out', labelT: 0.72 },
      { from: 'final-norm', to: 'lm-head', kind: 'data', tensor: 'x-norm' },
      { from: 'lm-head', to: 'logits', kind: 'data', tensor: 'logits' },
      { from: 'logits', to: 'sample', kind: 'data', tensor: 'logits', label: false },
      // autorregresivo: el token muestreado vuelve a la entrada (control: el tiempo, sin tensor)
      { from: 'sample', to: 'tokens', kind: 'control', fromSide: 'right', toSide: 'right', via: [[64, 94], [64, 4]], tag: 't → t+1: se agrega', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (Llama 3 8B, prefill de T tokens)', steps: [
        { nodes: ['tokens', 'embed'], edges: ['tokens>embed', 'embed>block'], tensors: ['ids', 'x0'],
          text: 'Entran T = ' + q('cfg.T') + ' ids (<b>' + q('tensor.ids.shape') + '</b>). La tabla de embedding (' + q('cfg.V') + ' × ' + q('cfg.D') + ' = ' + q('node.embed.params') + ' parámetros) da <b>' + q('tensor.x0.shape') + '</b>. Sin posiciones: entran después, con RoPE.' },
        { expand: 'llm-block', nodes: ['norm1'], edges: ['in>norm1', 'norm1>attn'], tensors: ['x0', 'h-norm1'],
          text: 'Dentro del bloque 1: RMSNorm por token (solo γ: ' + q('op.norm1.params') + ' parámetros; sin restar la media ni β). La forma no cambia: <b>' + q('tensor.h-norm1.shape') + '</b>.' },
        { expand: 'llm-gqa', nodes: ['q-proj', 'k-proj', 'v-proj'], edges: ['in>q-proj', 'in>k-proj', 'in>v-proj', 'q-proj>split', 'k-proj>split', 'v-proj>split'], tensors: ['q', 'k', 'v'],
          text: 'Tres proyecciones sin sesgo. W_Q es ancha: <b>' + q('tensor.q.shape') + '</b> (' + q('op.q-proj.paramArith') + '). W_K y W_V son angostas, solo G·d_h = ' + q('cfg.G') + '·' + q('cfg.dh') + ' = ' + q('cfg.Dkv') + ' columnas: <b>' + q('tensor.k.shape') + '</b> (' + q('op.k-proj.paramArith') + ' cada una).' },
        { expand: 'llm-gqa', nodes: ['split'], edges: ['split>rope', 'split>weighted-sum'], tensors: ['q-heads', 'k-heads', 'v-heads'],
          text: 'Se dividen en cabezas: h = ' + q('cfg.h') + ' de query (<b>' + q('tensor.q-heads.shape') + '</b>) pero solo G = ' + q('cfg.G') + ' de K y de V (<b>' + q('tensor.k-heads.shape') + '</b>). Cada cabeza K,V la comparten ' + q('cfg.groupSize') + ' queries: eso es GQA (con G = h sería MHA; con G = 1, MQA).' },
        { expand: 'llm-gqa', nodes: ['rope'], edges: ['split>rope', 'rope>scores'], tensors: ['q-rope', 'k-rope'],
          text: 'RoPE rota cada par de componentes de q y de k según su posición (base θ = ' + q('cfg.ropeTheta') + '). No tiene parámetros y no toca v. La k rotada (<b>' + q('tensor.k-rope.shape') + '</b>) es lo que se guarda en el KV cache.' },
        { expand: 'llm-gqa', nodes: ['scores', 'scale', 'mask', 'softmax'], edges: ['rope>scores', 'scores>scale', 'scale>softmax', 'mask>softmax'], tensors: ['scores', 'attn'],
          text: 'QKᵀ por cabeza de query (cada una contra la K de su grupo): <b>' + q('tensor.scores.shape') + '</b>, ' + q('op.scores.macArith') + ' MACs. Se divide entre √d_h y la máscara causal pone −∞ donde la key es posterior a la query; softmax por fila: <b>' + q('tensor.attn.shape') + '</b>.' },
        { expand: 'llm-gqa', nodes: ['weighted-sum', 'merge', 'o-proj'], edges: ['softmax>weighted-sum', 'split>weighted-sum', 'weighted-sum>merge', 'merge>o-proj', 'o-proj>out'], tensors: ['z-heads', 'z', 'o'],
          text: 'A·V con la V del grupo: <b>' + q('tensor.z-heads.shape') + '</b>. Se concatenan las ' + q('cfg.h') + ' cabezas (<b>' + q('tensor.z.shape') + '</b>) y W_O vuelve a D: <b>' + q('tensor.o.shape') + '</b>. La atención entera: ' + q('node.attn.params') + ' parámetros en las ' + q('cfg.L') + ' capas.' },
        { expand: 'llm-block', nodes: ['res1', 'norm2'], edges: ['attn>res1', 'in>res1', 'res1>norm2', 'norm2>ffn'], tensors: ['r1', 'h-norm2'],
          text: 'Residual 1 (<b>' + q('tensor.r1.shape') + '</b>) y la segunda RMSNorm antes de la FFN.' },
        { expand: 'llm-swiglu', nodes: ['gate-proj', 'up-proj', 'silu', 'mul', 'down-proj'], edges: ['in>gate-proj', 'gate-proj>silu', 'silu>mul', 'up-proj>mul', 'mul>down-proj', 'down-proj>out'], tensors: ['gate', 'up', 'act', 'prod', 'f'],
          text: 'SwiGLU: dos proyecciones en paralelo a D_mlp = ' + q('cfg.Dmlp') + ' (<b>' + q('tensor.gate.shape') + '</b>), SiLU sobre una y producto elemento a elemento con la otra, y W_down vuelve a D: <b>' + q('tensor.f.shape') + '</b>. Tres matrices de ' + q('op.gate-proj.paramArith') + ': ' + q('node.ffn.params') + ' parámetros en el modelo, la mayor parte.' },
        { expand: 'llm-block', nodes: ['res2', 'out'], edges: ['ffn>res2', 'res1>res2', 'res2>out'], tensors: ['f', 'x-out'],
          text: 'Residual 2 cierra el bloque: <b>' + q('tensor.x-out.shape') + '</b>, la misma forma que entró.' },
        { nodes: ['block'], edges: ['embed>block', 'block>final-norm'], tensors: ['x0', 'x-out'],
          text: 'Se repite L = ' + q('cfg.L') + ' veces. Los bloques suman ' + q('node.blocks.params') + ' parámetros; el prefill de T = ' + q('cfg.T') + ' tokens cuesta ' + q('metrics.prefillMacs') + ' en todo el modelo.' },
        { nodes: ['final-norm', 'lm-head', 'logits'], edges: ['block>final-norm', 'final-norm>lm-head', 'lm-head>logits'], tensors: ['x-norm', 'logits'],
          text: 'RMSNorm final y LM head (' + q('node.lm-head.params') + ' parámetros, sin atar con el embedding): <b>' + q('tensor.logits.shape') + '</b> logits. Total del modelo: ' + q('params.total') + ' parámetros.' },
        { nodes: ['sample', 'tokens'], edges: ['logits>sample', 'sample>tokens'], tensors: ['logits'],
          text: 'De la última fila se muestrea el token siguiente y se agrega a la entrada (arista punteada). Recalcularlo todo en cada paso sería carísimo: el KV cache guarda la K y la V de los tokens ya vistos (página de inferencia).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) un bloque decoder
  ATLAS.registerDiagram(Object.assign({
    id: 'llm-block', model: 'llm', config: C, kind: 'arch', title: 'Bloque decoder (pre-norm)',
    parent: 'llm-decoder-overview', parentNode: 'block',
    caption: 'Pre-norm, como en ViT pero con RMSNorm: la norma va antes de cada sub-bloque y cada residual (línea discontinua, por fuera) rodea uno. La atención es GQA con RoPE y máscara causal; la FFN es SwiGLU. Entra y sale la misma forma T×D, por eso se apila L veces.',
    grid: { w: 62, h: 86 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Bloque ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 6, w: 48, h: 68, repeat: { sym: 'L', from: 'L' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada x_{ℓ−1}', x: 22, y: 1, w: 18, h: 4, note: 'La salida del bloque anterior (en el primero, el embedding de los tokens).' },
      { id: 'norm1', op: 'norm', label: 'RMSNorm 1', x: 19, y: 14, w: 24, h: 4,
        tex: '\\mathrm{RMSNorm}(x) = \\gamma \\odot \\frac{x}{\\sqrt{\\tfrac{1}{D}\\sum_i x_i^2 + \\epsilon}}', note: 'Como LayerNorm pero sin restar la media y sin β: divide cada token por su raíz cuadrática media y escala con γ (D parámetros). Más barata y, en la práctica, igual de estable.' },
      { id: 'attn', op: 'attn', label: 'Atención causal', sub: 'RoPE · h queries, G grupos K,V', heads: 'h', costOf: 'attn', x: 15, y: 24, w: 32, h: 7, expand: 'llm-gqa',
        tex: '\\mathrm{Attn}(X) = \\mathrm{concat}_i\\big(\\mathrm{softmax}(\\tfrac{q_i k_{g(i)}^\\top}{\\sqrt{d_h}} + M)\\, v_{g(i)}\\big)\\, W_O', note: 'Atención causal con h cabezas de query pero solo G cabezas de K y V (cada grupo de h/G queries comparte una): menos parámetros en W_K, W_V y, sobre todo, un KV cache h/G veces más chico. La posición entra con RoPE. Ábrela para ver cada paso.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 29, y: 36, w: 4, h: 4,
        tex: 'r = x + \\mathrm{Attn}(\\mathrm{RMSNorm}(x))', note: 'Suma la entrada del bloque a la salida de la atención.' },
      { id: 'norm2', op: 'norm', label: 'RMSNorm 2', x: 19, y: 46, w: 24, h: 4, tex: '\\mathrm{RMSNorm}(r)', note: 'Segunda RMSNorm, antes de la FFN (otros D parámetros).' },
      { id: 'ffn', op: 'mlp', label: 'FFN SwiGLU', sub: 'D → D_mlp → D · 3 matrices', costOf: 'ffn', x: 17, y: 55, w: 28, h: 6, expand: 'llm-swiglu',
        tex: '\\mathrm{FFN}(x) = W_{\\text{down}}\\big(\\mathrm{SiLU}(x W_{\\text{gate}}) \\odot x W_{\\text{up}}\\big)', note: 'Una FFN con compuerta (Shazeer 2020): tres matrices en vez de dos. Con un ancho oculto de 8D/3 costaría lo mismo que una FFN de 4D, pero Llama 3 lo multiplica por 1.3 (ffn_dim_multiplier) y lo redondea a un múltiplo de 1024: ' + q('cfg.Dmlp') + ' = 3.5·D en Llama 3 8B, ≈ 31 % más parámetros que una FFN de 4D (10.5·D² por capa, no 8·D²). Ahí está el ' + q('metrics.ffnParamsShare') + ' de los parámetros del modelo.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 29, y: 66, w: 4, h: 4,
        tex: 'y = r + \\mathrm{FFN}(\\mathrm{RMSNorm}(r))', note: 'Segunda residual: cierra el bloque.' },
      { id: 'out', op: 'io', label: 'Salida x_ℓ', x: 22, y: 81, w: 18, h: 4, note: 'Misma forma que la entrada. Va al bloque siguiente; tras el último, a la RMSNorm final.' },
    ],
    edges: [
      { from: 'in', to: 'norm1', kind: 'data', tensor: 'x0', labelT: 0.66 },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[31, 7.5], [12, 7.5], [12, 38]], dot: true },
      { from: 'norm1', to: 'attn', kind: 'data', tensor: 'h-norm1', labelT: 0.3 },
      { from: 'attn', to: 'res1', kind: 'data', tensor: 'o' },
      { from: 'res1', to: 'norm2', kind: 'data', tensor: 'r1' },
      { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[31, 42], [12, 42], [12, 68]], dot: true },
      { from: 'norm2', to: 'ffn', kind: 'data', tensor: 'h-norm2' },
      { from: 'ffn', to: 'res2', kind: 'data', tensor: 'f' },
      { from: 'res2', to: 'out', kind: 'data', tensor: 'x-out', labelT: 0.74 },
    ],
    tensors: [
      { id: 'x0', at: { edge: 'in>norm1' }, show: 'both' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) atención GQA
  ATLAS.registerDiagram(Object.assign({
    id: 'llm-gqa', model: 'llm', config: C, kind: 'arch', title: 'Atención GQA con RoPE (causal)',
    parent: 'llm-block', parentNode: 'attn',
    caption: 'GQA: W_Q da h cabezas de query, pero W_K y W_V son angostas y dan solo G cabezas; en el bloque "Dividir" se ve cada grupo: h/G cartas de query que bajan a UNA barra K,V compartida. Después (orden de HF) RoPE rota q y k según la posición. Cada cabeza de query calcula QKᵀ contra la K de su grupo, se escala, la máscara causal (arista punteada: no lleva un tensor) borra las keys futuras, softmax y A·V con la V de su grupo; se concatenan las h cabezas y W_O mezcla. Sin sesgos.',
    grid: { w: 96, h: 133 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'heads', label: 'Las h cabezas de query, en paralelo', labelPos: 'bottom-right', heads: 'h', x: 4, y: 51, w: 72, h: 51 },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada (tras RMSNorm 1)', x: 32, y: 1, w: 30, h: 4, note: 'Los tokens normalizados por la RMSNorm 1.' },
      { id: 'q-proj', op: 'embed', label: 'W_Q', sub: 'D → h·d_h', x: 6, y: 10, w: 30, h: 6,
        tex: 'Q = X W_Q,\\; W_Q \\in \\mathbb{R}^{D\\times h d_h}', note: 'La proyección de las queries: ancha (h·d_h = D). Sin sesgo.' },
      { id: 'k-proj', op: 'embed', label: 'W_K', sub: 'D → G·d_h', x: 44, y: 10, w: 18, h: 6,
        tex: 'K = X W_K,\\; W_K \\in \\mathbb{R}^{D\\times G d_h}', note: 'La proyección de las keys: angosta, solo G·d_h columnas (G cabezas KV). Por eso W_K y W_V tienen h/G veces menos parámetros que en MHA.' },
      { id: 'v-proj', op: 'embed', label: 'W_V', sub: 'D → G·d_h', x: 72, y: 10, w: 18, h: 6,
        tex: 'V = X W_V,\\; W_V \\in \\mathbb{R}^{D\\times G d_h}', note: 'La de los values: igual de angosta que W_K.' },
      { id: 'split', op: 'tensorop', shape: 'rect', label: 'Dividir en cabezas', sub: 'Q: h cabezas · K, V: G cabezas', kvGroups: { q: 'h', kv: 'G' }, x: 6, y: 22, w: 84, h: 12,
        tex: 'Q \\to h\\times T\\times d_h,\\quad K, V \\to G\\times T\\times d_h', note: 'Un reshape (sin parámetros): Q en h cabezas de d_h y K, V en G cabezas. Las cartas de cada grupo son las queries que comparten UNA cabeza K,V: en la atención, la cabeza de query i usa la K y la V del grupo g(i) = ⌊i·G/h⌋ (HF lo hace con repeat_kv, repitiendo cada K,V h/G veces). Con G = h es MHA (grupos de 1); con G = 1, MQA.' },
      { id: 'rope', op: 'tensorop', shape: 'pill', symbol: 'roll', label: 'RoPE: rota q y k (v no)', x: 6, y: 38, w: 56, h: 5,
        tex: '\\begin{pmatrix} x_{2i}\\\\ x_{2i+1}\\end{pmatrix} \\leftarrow R(m\\,\\theta_i) \\begin{pmatrix} x_{2i}\\\\ x_{2i+1}\\end{pmatrix},\\; \\theta_i = \\theta^{-2i/d_h}', note: 'Rotary position embedding: cada par de componentes de q y de k (en cada cabeza) se rota un ángulo m·θ<sub>i</sub>, con m la posición del token. Sin parámetros. Como q·k de dos vectores rotados depende solo de la diferencia de ángulos, la atención ve la distancia relativa m − n. La k rotada es la que se guarda en el KV cache.' },
      { id: 'scores', op: 'attn', label: 'Q · Kᵀ', sub: 'cada query contra la K de su grupo', x: 10, y: 55, w: 52, h: 6,
        tex: 'S_i = q_i\\, k_{g(i)}^\\top \\in \\mathbb{R}^{T\\times T}', note: 'Por cabeza de query, el producto punto con cada key de su grupo: h matrices T×T. El costo es el de MHA (h·T²·d_h): GQA no ahorra cómputo aquí, ahorra memoria (K y V más chicas).' },
      { id: 'scale', op: 'attn', label: '÷ √d_h', shape: 'pill', x: 24, y: 69.5, w: 24, h: 4.5,
        tex: 'S / \\sqrt{d_h}', note: 'Escala para que la softmax no se sature.' },
      { id: 'mask', op: 'tensorop', shape: 'pill', symbol: 'mask', label: 'Máscara causal', sub: '−∞ si j > i', x: 55, y: 78, w: 19, h: 6,
        tex: 'M_{ij} = \\begin{cases} 0 & j \\le i \\\\ -\\infty & j > i \\end{cases}', note: 'El token i solo puede mirar a los tokens 0…i: se suma −∞ arriba de la diagonal (peso 0 tras la softmax). Es lo que hace al modelo autorregresivo. No tiene parámetros: es un patrón fijo (arista punteada de control), y no ahorra MACs sin kernels especiales (FlashAttention con causal=True sí salta esos bloques).' },
      { id: 'softmax', op: 'attn', label: 'softmax', sub: 'por fila', x: 24, y: 78, w: 24, h: 6,
        tex: 'A = \\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_h}} + M\\right)', note: 'Cada fila (una query) se vuelve una distribución sobre las keys anteriores o iguales.' },
      { id: 'weighted-sum', op: 'attn', label: 'A · V', sub: 'con la V de su grupo', x: 10, y: 91, w: 52, h: 6,
        tex: '\\mathrm{head}_i = A_i\\, v_{g(i)} \\in \\mathbb{R}^{T\\times d_h}', note: 'Cada query mezcla los values de su grupo con sus pesos de atención. Mismo costo que QKᵀ.' },
      { id: 'merge', op: 'tensorop', shape: 'concat', label: 'Concatenar cabezas', labelPos: 'right', x: 34, y: 106, w: 4, h: 4,
        tex: 'h\\times T\\times d_h \\to T\\times h d_h', note: 'Pone las h salidas una al lado de otra (h·d_h = D). Sin parámetros.' },
      { id: 'o-proj', op: 'embed', label: 'W_O', sub: 'h·d_h → D', x: 21, y: 115, w: 30, h: 5,
        tex: 'O = \\mathrm{concat}(\\mathrm{head}_1, \\dots, \\mathrm{head}_h)\\, W_O', note: 'Mezcla las cabezas. D·D parámetros, sin sesgo.' },
      { id: 'out', op: 'io', label: 'Hacia la residual 1', x: 24, y: 127, w: 24, h: 4, note: 'Vuelve al bloque, donde se suma con la entrada (residual 1).' },
    ],
    tensors: [
      { id: 'scores', at: { edge: 'scores>scale' }, show: 'both' },
    ],
    edges: [
      { from: 'in', to: 'q-proj', kind: 'data', tensor: 'h-norm1', fromSide: 'bottom', toSide: 'top', fromAt: 0.2, midY: 7.5, label: false },
      { from: 'in', to: 'k-proj', kind: 'data', tensor: 'h-norm1', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, midY: 7.5, label: false },
      { from: 'in', to: 'v-proj', kind: 'data', tensor: 'h-norm1', fromSide: 'bottom', toSide: 'top', fromAt: 0.8, midY: 7.5, labelSeg: 1, labelSide: 'above', labelT: 0.6 },
      { from: 'q-proj', to: 'split', kind: 'data', tensor: 'q', toAt: 0.1786, labelT: 0.5 },
      { from: 'k-proj', to: 'split', kind: 'data', tensor: 'k', toAt: 0.5595, labelT: 0.5 },
      { from: 'v-proj', to: 'split', kind: 'data', tensor: 'v', toAt: 0.8929, labelT: 0.5 },
      { from: 'split', to: 'rope', kind: 'data', tensor: 'q-heads', fromAt: 0.1786, toAt: 0.2679, labelSide: 'left', tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.5, label: false },
      { from: 'split', to: 'rope', kind: 'data', tensor: 'k-heads', fromAt: 0.5595, toAt: 0.8393, tag: 'K', tagStyle: 'plain', tagSide: 'on', tagT: 0.5, label: false },
      { from: 'rope', to: 'scores', kind: 'data', tensor: 'q-rope', fromAt: 0.2679, toAt: 0.2115, labelSide: 'left', labelT: 0.85, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.15 },
      { from: 'rope', to: 'scores', kind: 'data', tensor: 'k-rope', fromAt: 0.8393, toAt: 0.8269, labelT: 0.85, tag: 'K', tagStyle: 'plain', tagSide: 'on', tagT: 0.15 },
      { from: 'split', to: 'weighted-sum', kind: 'data', tensor: 'v-heads', fromAt: 0.8929, toSide: 'right', via: [[81, 94]], labelT: 0.45, tag: 'V', tagStyle: 'plain', tagSide: 'on', tagT: 0.12 },
      { from: 'scores', to: 'scale', kind: 'data', tensor: 'scores' },
      { from: 'scale', to: 'softmax', kind: 'data', tensor: 'scores-scaled', label: false },
      { from: 'mask', to: 'softmax', kind: 'control', fromSide: 'left', toSide: 'right' },
      { from: 'softmax', to: 'weighted-sum', kind: 'data', tensor: 'attn', labelT: 0.45 },
      { from: 'weighted-sum', to: 'merge', kind: 'data', tensor: 'z-heads', labelT: 0.78 },
      { from: 'merge', to: 'o-proj', kind: 'data', tensor: 'z' },
      { from: 'o-proj', to: 'out', kind: 'data', tensor: 'o' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) FFN SwiGLU
  ATLAS.registerDiagram(Object.assign({
    id: 'llm-swiglu', model: 'llm', config: C, kind: 'arch', title: 'FFN SwiGLU',
    parent: 'llm-block', parentNode: 'ffn',
    caption: 'Por token: dos proyecciones en paralelo a D_mlp (gate y up), SiLU sobre la compuerta, producto elemento a elemento (⊙) y W_down vuelve a D. Tres matrices en vez de las dos de un MLP clásico; fíjate en la profundidad de los tensores del medio.',
    grid: { w: 70, h: 67 }, direction: 'tb', maxCrossings: 0,
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada (tras RMSNorm 2)', x: 22, y: 1, w: 26, h: 4, note: 'Los tokens normalizados por la RMSNorm 2.' },
      { id: 'gate-proj', op: 'mlp', label: 'W_gate', sub: 'D → D_mlp', x: 4, y: 12, w: 26, h: 6,
        tex: 'G = X W_{\\text{gate}}', note: 'La rama de la compuerta: después pasa por SiLU. Sin sesgo.' },
      { id: 'up-proj', op: 'mlp', label: 'W_up', sub: 'D → D_mlp', x: 40, y: 12, w: 26, h: 6,
        tex: 'U = X W_{\\text{up}}', note: 'La rama lineal: se multiplica por la compuerta.' },
      { id: 'silu', op: 'mlp', label: 'SiLU', shape: 'pill', x: 6, y: 27.5, w: 22, h: 4.5,
        tex: '\\mathrm{SiLU}(g) = g\\,\\sigma(g)', note: 'También llamada Swish: suave, sin parámetros, elemento a elemento.' },
      { id: 'mul', op: 'tensorop', shape: 'mul', label: 'Producto ⊙', labelPos: 'above', x: 33, y: 37, w: 4, h: 4,
        tex: 'P = \\mathrm{SiLU}(G) \\odot U', note: 'Producto elemento a elemento: la compuerta decide cuánto de cada componente de U pasa. Sin parámetros.' },
      { id: 'down-proj', op: 'mlp', label: 'W_down', sub: 'D_mlp → D', x: 22, y: 47, w: 26, h: 6,
        tex: 'F = P\\, W_{\\text{down}}', note: 'Vuelve a D para poder sumar con la residual.' },
      { id: 'out', op: 'io', label: 'Hacia la residual 2', x: 24, y: 61, w: 22, h: 4, note: 'Vuelve al bloque, donde se suma con r (residual 2).' },
    ],
    tensors: [
      { id: 'gate', at: { edge: 'gate-proj>silu' }, show: 'both' },
      { id: 'f', at: { edge: 'down-proj>out' }, show: 'both' },
    ],
    edges: [
      { from: 'in', to: 'gate-proj', kind: 'data', tensor: 'h-norm2', fromSide: 'bottom', toSide: 'top', fromAt: 0.25, midY: 8.5, label: false },
      { from: 'in', to: 'up-proj', kind: 'data', tensor: 'h-norm2', fromSide: 'bottom', toSide: 'top', fromAt: 0.75, midY: 8.5, labelSeg: -1, labelSide: 'right', labelT: 0.4 },
      { from: 'gate-proj', to: 'silu', kind: 'data', tensor: 'gate', fromAt: 0.5, toAt: 0.5 },
      { from: 'silu', to: 'mul', kind: 'data', tensor: 'act', fromSide: 'bottom', toSide: 'left', labelSide: 'left', labelSeg: 0, labelT: 0.5 },
      { from: 'up-proj', to: 'mul', kind: 'data', tensor: 'up', fromSide: 'bottom', toSide: 'right', labelSeg: 0, labelT: 0.45 },
      { from: 'mul', to: 'down-proj', kind: 'data', tensor: 'prod' },
      { from: 'down-proj', to: 'out', kind: 'data', tensor: 'f' },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
