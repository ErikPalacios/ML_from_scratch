/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/qwen2-vl.js
   Diagramas de Qwen2-VL (SPEC §7.2, ids de §19.2), config canónica qwen2-vl-7b (modelo `qwen2-vl`, js/arch/vlm.js):
     qwen2vl-overview     tres bandas, como LLaVA, con lo que cambia:
                          1) imagen de cualquier tamaño (lados múltiplos de 28) → parches 2×14×14 (Conv3d; la imagen se
                             duplica a 2 frames) → ViT × 32 con RoPE 2-D (sin posición absoluta) → merger 2×2 + MLP
                          2) texto → embedding → empalme (la tira: (H/28)·(W/28) tokens de la imagen, no un número fijo) →
                             M-RoPE: un id (t, h, w) por token (ejemplo ilustrativo dentro del nodo)
                          3) el LLM (Qwen2, × L) → RMSNorm final → LM head → respuesta
       qwen2vl-vit-block  una capa del ViT: LN → atención (h_v cabezas) con RoPE 2-D → ⊕ → LN → MLP → ⊕
       qwen2vl-merger     LN por parche → agrupar 2×2 vecinos (4·D_v) → fc1 → GELU → fc2 (→ D). Orden de HF: la LayerNorm
                          va ANTES de agrupar (la SPEC listaba group2x2, ln; el calculador y este diagrama siguen a HF).
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas desde ATLAS.Arch.run; ids de nodos y tensores de §19.2
   y de vlm.js. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'qwen2-vl-7b', LV = 'llava15-7b';
  const q = (k) => '{{' + C + '.' + k + '}}';
  // todas las vistas valen para las tres configs (2B, 7B, 72B: el mismo ViT de 675M; cambia el LLM)
  const PAGE = { page: 'qwen2-vl', section: 'diagrama', configs: ['qwen2-vl-7b', 'qwen2-vl-2b', 'qwen2-vl-72b'] };
  const VS = 'vision-encoder';   // scope de los nodos de la capa del ViT (res1, res2… existen también en el LLM)
  const STRIP = {
    segs: [{ mod: 'txt', n: 'cfg.T', frac: 0.5, count: false, label: 'texto' }, { mod: 'img', n: 'metrics.visualTokens', label: 'tokens de la imagen' }, { mod: 'txt', n: 'cfg.T', frac: 0.5, count: false, label: 'texto' }],
    caption: 'imagen {{cfg.H}}×{{cfg.W}} → ({{cfg.H}}/28)·({{cfg.W}}/28) = {{metrics.visualTokens}} tokens + texto {{cfg.T}}: {{metrics.visualShare}} es imagen',
  };
  // M-RoPE: un prompt corto ILUSTRATIVO dentro del nodo (2 de texto, una imagen de 2×2 tokens, 2 de texto)
  const POS = { segs: [{ kind: 'txt', n: 2 }, { kind: 'img', gh: 2, gw: 2 }, { kind: 'txt', n: 2 }] };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'qwen2vl-overview', model: 'qwen2-vl', config: C, kind: 'arch', title: 'Qwen2-VL — vista general',
    caption: 'La misma receta que LLaVA (encoder de visión → proyector → LLM), con dos cambios. 1) Resolución dinámica: la imagen entra a su tamaño (lados múltiplos de 28), el ViT usa RoPE 2-D en vez de una tabla de posiciones fija y el merger une 2×2 parches vecinos en un token: una imagen da (H/28)·(W/28) tokens, no un número fijo (LLaVA-1.5: siempre {{llava15-7b.metrics.visualTokens}}). 2) M-RoPE: cada token del LLM recibe tres ids (t, h, w); el texto lleva el mismo en los tres y los tokens de la imagen comparten t y varían fila y columna (el ejemplo del nodo es ilustrativo).',
    grid: { w: 144, h: 86 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['merge', 'mrope'],
    groups: [
      { id: 'vision-encoder', label: 'ViT (RoPE 2-D)', labelPos: 'bottom', x: 48, y: 1, w: 36, h: 24, repeat: { sym: 'L_v', from: 'Lv', totalOf: 'vit-block' }, modality: 'img' },
      { id: 'llm', label: 'LLM decoder ({{cfg.llmLabel}})', labelPos: 'bottom', x: 3, y: 62, w: 62, h: 21, repeat: { sym: 'L', from: 'L', totalOf: 'block', totalLabel: '= {t} en los bloques' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'image', op: 'io', image: true, imageGrid: 0, label: 'Imagen', x: 3, y: 1, w: 11, h: 14,
        note: 'Una imagen de cualquier tamaño. El procesador (smart_resize) la lleva al múltiplo de 28 más cercano en cada lado, conservando la proporción, dentro de un mínimo y un máximo de píxeles; aquí ' + q('cfg.H') + '×' + q('cfg.W') + ' (alto × ancho). No se recorta ni se deforma a un cuadrado fijo.' },
      { id: 'repeat', op: 'tensorop', shape: 'pill', symbol: 'concat', ops: ['vis-repeat'], opsExact: true, label: '×2 en el tiempo', x: 0.5, y: 20, w: 16, h: 5,
        tex: '[x;\\,x] \\in \\mathbb{R}^{2\\times H\\times W\\times C}', note: 'Sin parámetros: la imagen se copia en 2 frames iguales para llenar el parche temporal de 2 de la Conv3d (el mismo patchify que el video, donde los 2 frames son distintos). Por eso el parche es 2×14×14.' },
      { id: 'patchify', op: 'conv', blankDesc: 'Cómo la imagen se corta en parches (y en el tiempo)', label: 'Parches 2×14×14', sub: 'Conv3d, sin sesgo', x: 21, y: 8, w: 18, h: 9,
        tex: 'X_p = \\mathrm{Conv3d}_{2\\times P\\times P}([x; x]) \\in \\mathbb{R}^{N_p\\times D_v}', note: 'Una Conv3d con kernel y stride 2×' + q('cfg.P') + '×' + q('cfg.P') + ' (tiempo × alto × ancho): una imagen se duplica a 2 frames para usar el mismo patchify que el video. Da N_p = (H/' + q('cfg.P') + ')·(W/' + q('cfg.P') + ') = ' + q('cfg.Np') + ' parches de ' + q('cfg.Dv') + '. Sin tabla de posiciones: la posición entra con RoPE 2-D en cada atención.' },
      { id: 'vit-block', op: 'attn', style: 'block', costOf: 'enc-layer', badgeTotal: true, label: 'Capa del ViT', sub: 'pre-LN · RoPE 2-D', x: 51, y: 7, w: 30, h: 11, expand: 'qwen2vl-vit-block',
        mini: { items: [{ label: 'LN', op: 'norm' }, { label: 'Atención', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] },
        tex: '\\begin{aligned} r &= x + \\mathrm{Attn}_{\\mathrm{RoPE2D}}(\\mathrm{LN}(x)) \\\\ y &= r + \\mathrm{MLP}(\\mathrm{LN}(r)) \\end{aligned}',
        note: 'Un bloque de ViT pre-LN (como el de la fase 1), con una diferencia: la posición. En vez de sumar una tabla de posiciones de tamaño fijo, cada atención rota q y k según la fila y la columna del parche (RoPE 2-D). Por eso acepta cualquier rejilla de parches sin interpolar nada. Ábrelo para verlo.' },
      { id: 'merger', op: 'embed', blankDesc: 'El bloque que une parches vecinos y los lleva al ancho del LLM', label: 'Merger 2×2 + MLP', sub: '4·D_v → D', x: 93, y: 8, w: 22, h: 9, expand: 'qwen2vl-merger',
        tex: 'V = \\mathrm{MLP}\\big(\\mathrm{concat}_{2\\times 2}(\\mathrm{LN}(Z))\\big)', note: 'Concatena cada bloque de 2×2 parches vecinos en un solo vector (4·' + q('cfg.Dv') + ' números: no se promedian) y un MLP entrenado lo comprime al ancho del LLM (4·' + q('cfg.Dv') + ' → ' + q('cfg.D') + '): 4 veces menos tokens que parches. Es el "proyector" de Qwen2-VL. Ábrelo para ver el orden de HF (LayerNorm antes de agrupar).' },
      { id: 'text', op: 'io', modality: 'txt', label: 'Texto (ids)', sub: 'con marcadores', x: 1, y: 37, w: 15, h: 8,
        note: 'El prompt tokenizado. La imagen va entre &lt;|vision_start|&gt; y &lt;|vision_end|&gt; (dos tokens de texto) y ocupa tantos marcadores &lt;|image_pad|&gt; como tokens visuales tenga: el número depende del tamaño de la imagen.' },
      { id: 'embed', op: 'embed', label: 'Embedding', sub: 'tabla V × D', subNum: 'tabla {{cfg.V}} × {{cfg.D}}', x: 20, y: 37, w: 19, h: 8,
        tex: 'E(t) \\in \\mathbb{R}^{T\\times D}', note: 'La tabla de embedding del LLM Qwen2 (vocabulario de ' + q('cfg.V') + ').' },
      { id: 'merge', op: 'fuse', blankDesc: 'Dónde entran los tokens visuales al prompt de texto', label: 'Empalmar la imagen', sub: 'sus tokens ocupan los marcadores', strip: STRIP, ops: ['splice'], opsExact: true, x: 49, y: 31, w: 64, h: 20,
        tex: 'X = [\\,E(t_{<k})\\;;\\; V \\;;\\; E(t_{>k})\\,] \\in \\mathbb{R}^{(N+T)\\times D}', note: 'Como en LLaVA: los N tokens visuales ocupan el lugar de los marcadores, sin parámetros. Lo distinto es N: (H/28)·(W/28) = ' + q('cfg.N') + ' para esta imagen (LLaVA-1.5: siempre ' + '{{llava15-7b.metrics.visualTokens}}' + '). Una imagen más grande da más tokens: más detalle y más costo.' },
      { id: 'mrope', op: 'tensorop', blankDesc: 'Qué posiciones (t, h, w) recibe cada token del LLM', shape: 'rect', label: 'M-RoPE: ids (t, h, w)', sub: 'ejemplo ilustrativo', posIds: POS, x: 120, y: 31, w: 23, h: 20,
        tex: '\\mathrm{pos}_i = (t_i, h_i, w_i);\\; \\text{texto: } t_i = h_i = w_i', note: 'Las posiciones que usa el RoPE del LLM: tres ids por token. El texto lleva el mismo id en los tres ejes (equivale a RoPE 1-D); los tokens de la imagen comparten t y varían h (fila) y w (columna) desde el id de inicio, y el texto siguiente sigue en el máximo + 1. En cada cabeza, unas frecuencias rotan con t, otras con h y otras con w (mrope_section de la config; la viz "mrope" muestra el reparto). Con esta imagen, los ' + q('cfg.S') + ' tokens ocupan solo ' + q('cfg.posSpan') + ' posiciones. El ejemplo del nodo es ilustrativo (2 + 2×2 + 2 tokens); la viz "mrope" lo deja explorar.' },
      { id: 'block', op: 'attn', style: 'block', badgeTotal: true, label: 'Bloque decoder (pre-norm)', x: 7, y: 67, w: 52, h: 10,
        mini: { items: [{ label: 'RMSNorm', op: 'norm' }, { label: 'GQA + M-RoPE', op: 'attn' }, { sym: 'add' }, { label: 'RMSNorm', op: 'norm' }, { label: 'SwiGLU', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] },
        xref: [{ href: '#llm-decoder.diagrama~llm-block.attn', label: 'Ver el bloque por dentro (fase 6: allí Llama 3 8B, sin sesgo en Q, K, V)' }],
        tex: '\\begin{aligned} r &= x + \\mathrm{Attn}(\\mathrm{RMSNorm}(x)) \\\\ y &= r + \\mathrm{FFN}(\\mathrm{RMSNorm}(r)) \\end{aligned}',
        note: 'El bloque de Qwen2: el de un decoder tipo Llama (GQA con ' + q('cfg.h') + ' cabezas de query y ' + q('cfg.G') + ' de K,V, FFN SwiGLU, RMSNorm) con sesgo en W_Q, W_K, W_V y RoPE → M-RoPE (las posiciones de abajo). Su interior está en la página del decoder.' },
      { id: 'final-norm', op: 'norm', label: 'RMSNorm final', x: 70, y: 68.5, w: 16, h: 7, note: 'La norma final del LLM.' },
      { id: 'lm-head', op: 'head', label: 'LM head', sub: 'D → V', subWhen: { tied: 'atado al embedding' }, x: 93, y: 68, w: 16, h: 8,
        tex: '\\text{logits} = x\\,W_{\\text{head}}', note: 'Un logit por token del vocabulario, como en cualquier LLM. En el 7B y el 72B tiene su propia matriz; en el 2B está atado al embedding (la misma matriz, sin parámetros propios: por eso no lleva insignia).' },
      { id: 'answer', op: 'io', modality: 'txt', label: 'Respuesta', sub: 'token a token', x: 120, y: 68, w: 18, h: 8,
        note: 'Generación autorregresiva. Cada token nuevo recibe el id siguiente en los tres ejes (la posición de decode lleva el desplazamiento que dejó la imagen).' },
    ],
    tensors: [
      { id: 'vis-tokens', at: { edge: 'merger>merge' }, show: 'both' },
    ],
    edges: [
      { from: 'image', to: 'repeat', kind: 'data', tensor: 'pixels', fromSide: 'bottom', toSide: 'top', labelSide: 'right' },
      { from: 'repeat', to: 'patchify', kind: 'data', tensor: 'v-frames', fromSide: 'right', toSide: 'bottom', toAt: 0.3, labelSide: 'below', labelSeg: 0 },
      { from: 'patchify', to: 'vit-block', kind: 'data', tensor: 'v-patches', labelSide: 'below', labelT: 0.33 },
      { from: 'vit-block', to: 'merger', kind: 'data', tensor: 'vis-feats', labelSide: 'below', labelT: 0.66 },
      { from: 'merger', to: 'merge', kind: 'data', tensor: 'vis-tokens', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.8594, labelSide: 'right', labelT: 0.45 },
      { from: 'text', to: 'embed', kind: 'data', tensor: 'text-ids', labelSide: 'below' },
      { from: 'embed', to: 'merge', kind: 'data', tensor: 'text-emb', toAt: 0.5, labelSide: 'below' },
      { from: 'merge', to: 'mrope', kind: 'control', toAt: 0.5, fromAt: 0.5, tag: 'rejilla', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'merge', to: 'block', kind: 'data', tensor: 'prompt', fromSide: 'bottom', toSide: 'top', fromAt: 0.1, toAt: 0.3, midY: 56.5, labelSeg: 1, labelSide: 'above' },
      { from: 'mrope', to: 'block', kind: 'data', tensor: 'pos-ids', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.66, midY: 59.5, labelSeg: 1, labelSide: 'below', labelT: 0.62, tag: 'posiciones', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 },
      { from: 'block', to: 'final-norm', kind: 'data', tensor: 'x-out', label: false },   // misma forma que el prompt; la etiqueta cruzaría el marco × L
      { from: 'final-norm', to: 'lm-head', kind: 'data', tensor: 'x-norm', label: false },
      { from: 'lm-head', to: 'answer', kind: 'data', tensor: 'logits', labelSide: 'below' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (Qwen2-VL 7B, una imagen y una pregunta corta)', steps: [
        { nodes: ['image', 'repeat', 'patchify'], edges: ['image>repeat', 'repeat>patchify', 'patchify>vit-block'], tensors: ['pixels', 'v-frames', 'v-patches'],
          text: 'La imagen entra a su tamaño (lados múltiplos de 28): <b>' + q('tensor.pixels.shape') + '</b>. Se duplica a 2 frames (<b>' + q('tensor.v-frames.shape') + '</b>) y una Conv3d 2×' + q('cfg.P') + '×' + q('cfg.P') + ' la corta en <b>' + q('tensor.v-patches.shape') + '</b>: un parche cada ' + q('cfg.P') + ' px, ' + q('cfg.Np') + ' en total.' },
        { expand: 'qwen2vl-vit-block', nodes: ['ln1', 'attn', 'rope2d'], edges: ['in>ln1', 'ln1>attn', 'rope2d>attn'], tensors: ['v-h-ln1'],
          text: 'En cada capa del ViT, la atención rota q y k según la fila y la columna de cada parche (RoPE 2-D, base ' + q('cfg.visionTheta') + '): no hay tabla de posiciones de tamaño fijo, así que cualquier rejilla funciona. ' + q('cfg.hv') + ' cabezas de ' + q('cfg.dv') + ' sobre los ' + q('cfg.Np') + ' parches.' },
        { nodes: ['vit-block'], edges: ['patchify>vit-block', 'vit-block>merger'], tensors: ['vis-feats'],
          text: '× ' + q('cfg.Lv') + ' capas (' + q('metrics.visionParams') + ' parámetros en el ViT): <b>' + q('tensor.vis-feats.shape') + '</b>. La atención es sobre todos los parches: cuadrática en N_p (por eso Qwen2-VL tiene un tope de píxeles).' },
        { expand: 'qwen2vl-merger', nodes: ['ln', 'group2x2', 'fc1', 'gelu', 'fc2'], edges: ['ln>group2x2', 'group2x2>fc1', 'fc1>gelu', 'gelu>fc2', 'fc2>out'], tensors: ['v-grouped', 'vis-tokens'],
          text: 'El merger: LayerNorm por parche, cada 2×2 vecinos se concatenan (<b>' + q('tensor.v-grouped.shape') + '</b>) y un MLP los lleva a D: <b>' + q('tensor.vis-tokens.shape') + '</b>. Un token cada 28×28 px: (H/28)·(W/28) = ' + q('cfg.N') + '.' },
        { nodes: ['text', 'embed', 'merge'], edges: ['text>embed', 'embed>merge', 'merger>merge', 'merge>block'], tensors: ['text-emb', 'prompt'],
          text: 'Empalme, como en LLaVA: <b>' + q('tensor.prompt.shape') + '</b>, ' + q('metrics.visualShare') + ' es imagen. La diferencia es que N depende del tamaño de la imagen: LLaVA-1.5 usa siempre {{llava15-7b.metrics.visualTokens}}.' },
        { nodes: ['mrope', 'block'], edges: ['merge>mrope', 'mrope>block'], tensors: ['pos-ids'],
          text: 'M-RoPE: tres ids por token, <b>' + q('tensor.pos-ids.shape') + '</b>. El texto lleva el mismo id en t, h y w; la imagen comparte t y varía fila y columna. Los ' + q('cfg.S') + ' tokens ocupan solo ' + q('cfg.posSpan') + ' posiciones (la imagen avanza ' + q('cfg.imagePosSpan') + ', no ' + q('cfg.N') + ').' },
        { nodes: ['block', 'final-norm', 'lm-head', 'answer'], edges: ['block>final-norm', 'final-norm>lm-head', 'lm-head>answer'], tensors: ['logits'],
          text: 'El LLM de siempre × ' + q('cfg.L') + ' → <b>' + q('tensor.logits.shape') + '</b>. Prefill: ' + q('metrics.prefillMacs') + ', ' + q('metrics.prefillShareFromImage') + ' por la imagen; KV cache de la imagen: ' + q('metrics.kvBytesPerImage') + ' (con GQA, ' + q('cfg.G') + ' cabezas K,V).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) una capa del ViT con RoPE 2-D
  ATLAS.registerDiagram(Object.assign({
    id: 'qwen2vl-vit-block', model: 'qwen2-vl', config: C, kind: 'arch', title: 'Capa del ViT de Qwen2-VL (RoPE 2-D)',
    parent: 'qwen2vl-overview', parentNode: 'vit-block',
    caption: 'Un bloque de ViT pre-LN (LayerNorm → atención → ⊕ → LayerNorm → MLP → ⊕, residuales discontinuas por fuera). La posición no se suma a la entrada: RoPE 2-D (arista punteada, sin tensor) rota q y k dentro de la atención, la mitad de las frecuencias con la fila del parche y la mitad con la columna.',
    grid: { w: 77, h: 82 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 6, w: 48, h: 64, repeat: { sym: 'L_v', from: 'Lv' }, modality: 'img' },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada (parches)', x: 21, y: 1, w: 18, h: 4, note: 'Los parches de la capa anterior (en la primera, los del patchify).' },
      { id: 'ln1', op: 'norm', scope: VS, label: 'LayerNorm 1', x: 18, y: 12, w: 24, h: 4, tex: '\\mathrm{LN}(x)', note: 'LayerNorm antes de la atención (pre-LN, como en ViT).' },
      { id: 'attn', op: 'attn', scope: VS, costOf: 'mhsa', label: 'Atención (h_v cabezas)', sub: 'q, k rotadas por (fila, col)', heads: 'hv', headsSym: 'h_v', x: 14, y: 24, w: 32, h: 7,
        tex: '\\mathrm{softmax}\\!\\left(\\frac{R_{p_i} q_i\\,(R_{p_j} k_j)^\\top}{\\sqrt{d_v}}\\right) v_j', note: 'Atención multi-cabeza sobre TODOS los parches de la imagen (sin ventanas en Qwen2-VL), con qkv y proyección con sesgo. q y k se rotan según la posición 2-D de cada parche antes del producto punto: q·k depende del desplazamiento (Δfila, Δcol) entre los dos parches.' },
      { id: 'rope2d', op: 'tensorop', shape: 'pill', symbol: 'roll', ops: ['vis-rope2d-q', 'vis-rope2d-k'], opsExact: true, label: 'RoPE 2-D', sub: 'fila y columna', x: 58.5, y: 24.5, w: 18, h: 6,
        tex: '\\theta_{h} = \\text{fila}\\cdot\\omega,\\; \\theta_{w} = \\text{col}\\cdot\\omega', note: 'Sin parámetros: la mitad de los pares de q y k gira con la fila del parche y la otra mitad con la columna (base ' + q('cfg.visionTheta') + '). Como RoPE 1-D, la atención ve la distancia relativa, ahora en 2-D, y no hay que interpolar una tabla al cambiar la resolución.' },
      { id: 'res1', op: 'tensorop', shape: 'add', scope: VS, label: 'Residual 1', labelPos: 'right', x: 28, y: 35, w: 4, h: 4, note: 'Suma la entrada de la capa a la salida de la atención.' },
      { id: 'ln2', op: 'norm', scope: VS, label: 'LayerNorm 2', x: 18, y: 44, w: 24, h: 4, tex: '\\mathrm{LN}(r)', note: 'Segunda LayerNorm, antes del MLP.' },
      { id: 'mlp', op: 'mlp', scope: VS, label: 'MLP', sub: 'D_v → 4·D_v → D_v', x: 18, y: 53, w: 24, h: 6,
        tex: '\\mathrm{MLP}(x) = W_2\\,\\mathrm{QuickGELU}(W_1 x + b_1) + b_2', note: 'El MLP de un ViT: dos capas con QuickGELU, ancho oculto 4·D_v.' },
      { id: 'res2', op: 'tensorop', shape: 'add', scope: VS, label: 'Residual 2', labelPos: 'right', x: 28, y: 63, w: 4, h: 4, note: 'Cierra la capa.' },
      { id: 'out', op: 'io', label: 'Salida', x: 21, y: 76, w: 18, h: 4, note: 'Misma forma que la entrada; tras la última capa, al merger.' },
    ],
    edges: [
      { from: 'in', to: 'ln1', kind: 'data', tensor: 'v-patches', labelT: 0.62 },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[30, 8], [11, 8], [11, 37]], dot: true },
      { from: 'ln1', to: 'attn', kind: 'data', tensor: 'v-h-ln1', labelT: 0.3 },
      { from: 'rope2d', to: 'attn', kind: 'control', fromSide: 'left', toSide: 'right' },
      { from: 'attn', to: 'res1', kind: 'data', tensor: 'v-o' },
      { from: 'res1', to: 'ln2', kind: 'data', tensor: 'v-r1' },
      { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[30, 41], [11, 41], [11, 65]], dot: true },
      { from: 'ln2', to: 'mlp', kind: 'data', tensor: 'v-h-ln2' },
      { from: 'mlp', to: 'res2', kind: 'data', tensor: 'v-f' },
      { from: 'res2', to: 'out', kind: 'data', tensor: 'vis-feats', labelT: 0.7 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) el merger
  ATLAS.registerDiagram(Object.assign({
    id: 'qwen2vl-merger', model: 'qwen2-vl', config: C, kind: 'arch', title: 'Merger 2×2 + MLP',
    parent: 'qwen2vl-overview', parentNode: 'merger',
    caption: 'Orden de HF: LayerNorm a cada parche, después se concatenan los 2×2 vecinos (4 veces menos filas, 4 veces más ancho: los glifos) y un MLP de 2 capas lleva cada grupo al ancho del LLM. La concatenación no tira nada; la compresión la hace el MLP, entrenado (4·D_v → D). Sale un token por cada 28×28 píxeles.',
    grid: { w: 164, h: 30 }, direction: 'lr', maxCrossings: 0,
    nodes: [
      { id: 'in', op: 'io', modality: 'img', label: 'Parches', sub: 'del ViT', x: 1, y: 16, w: 12, h: 8, note: 'La salida del ViT: un vector por parche de 14×14.' },
      { id: 'ln', op: 'norm', ops: ['merger-ln'], opsExact: true, label: 'LayerNorm', sub: 'por parche', x: 21, y: 16, w: 14, h: 8, tex: '\\mathrm{LN}(z)', note: 'Normaliza cada parche (ln_q, ancho D_v) antes de agrupar.' },
      { id: 'group2x2', op: 'tensorop', shape: 'rect', symbol: 'concat2x2', ops: ['merger-group'], opsExact: true, label: 'Agrupar 2×2', sub: 'concat 4·D_v', subNum: 'concat 4·{{cfg.Dv}}', x: 48, y: 15.5, w: 23, h: 9,
        tex: 'N_p\\times D_v \\to (N_p/4)\\times 4D_v', note: 'Un reshape sin parámetros: los 4 parches de cada bloque de 2×2 (vecinos en la imagen) se concatenan, uno al lado del otro (el pictograma: cada tono es un parche). No es un pooling: no se promedia ni se descarta nada; la compresión viene después, en el MLP.' },
      { id: 'fc1', op: 'embed', ops: ['merger-fc1'], opsExact: true, label: 'fc1', sub: '4D_v → 4D_v', x: 84, y: 16, w: 14, h: 8, tex: 'h = g W_1 + b_1', note: 'Primera capa del MLP, del mismo ancho (4·D_v).' },
      { id: 'gelu', op: 'mlp', shape: 'pill', ops: ['merger-gelu'], opsExact: true, label: 'GELU', x: 106, y: 17.5, w: 10, h: 5, tex: '\\mathrm{GELU}(h)', note: 'La no linealidad del MLP.' },
      { id: 'fc2', op: 'embed', ops: ['merger-fc2'], opsExact: true, label: 'fc2', sub: '4D_v → D', x: 124, y: 16, w: 14, h: 8, tex: 'V = \\mathrm{GELU}(h) W_2 + b_2', note: 'Al ancho del LLM: los tokens visuales. Aquí está la compresión de 4·D_v a D (aprendida): el merger no es sin pérdida, pero decide qué conservar en vez de promediar.' },
      { id: 'out', op: 'io', modality: 'img', label: 'Tokens', sub: '→ empalme', x: 148, y: 16, w: 14, h: 8, note: 'Van al empalme con el texto.' },
    ],
    tensors: [
      { id: 'v-merge-ln', at: { edge: 'ln>group2x2' }, show: 'both' },
      { id: 'v-grouped', at: { edge: 'group2x2>fc1' }, show: 'both' },
    ],
    edges: [
      { from: 'in', to: 'ln', kind: 'data', tensor: 'vis-feats', labelSide: 'above' },
      { from: 'ln', to: 'group2x2', kind: 'data', tensor: 'v-merge-ln', labelSide: 'above' },
      { from: 'group2x2', to: 'fc1', kind: 'data', tensor: 'v-grouped', labelSide: 'above' },
      { from: 'fc1', to: 'gelu', kind: 'data', tensor: 'merger-h', labelSide: 'above' },
      { from: 'gelu', to: 'fc2', kind: 'data', tensor: 'merger-act', labelSide: 'above' },
      { from: 'fc2', to: 'out', kind: 'data', tensor: 'vis-tokens', labelSide: 'above', labelT: 0.45 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
