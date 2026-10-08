/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/dit.js
   Diagramas de DiT y flow matching (SPEC §7.2, ids de §20.2), modelo `dit` (js/arch/diffusion.js):
     dit-overview      (sección diagrama, config dit-xl2-256) latente → patchify (p × p → N tokens) + posición 2-D fija →
                       bloques × L (expande dit-block) → capa final (adaLN + Linear) → unpatchify → ε̂ y Σ. Abajo, la condición:
                       paso t → embedding, clase → embedding (con clase nula), suma → c, que llega a CADA bloque como
                       condicionamiento (línea punteada, no es el flujo de datos)
       dit-block       adaLN-Zero: de c salen 6 vectores (β₁, γ₁, α₁, β₂, γ₂, α₂); LayerNorm sin parámetros → modulación →
                       atención → compuerta α (cero al inicio) → residual; lo mismo con el MLP
     flow-matching     (sección diagrama, config dit-xl2-256-fm) un paso de entrenamiento de flow matching: x₀ y ε → x_t =
                       (1−t)·x₀ + t·ε → modelo → v̂; objetivo v = ε − x₀; pérdida ‖v̂ − v‖²
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'dit-xl2-256', CF = 'dit-xl2-256-fm';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const qf = (k) => '{{' + CF + '.' + k + '}}';
  // las vistas del muestreo valen para las configs con ε y Σ (no la de flow matching, que predice v)
  const CONFIGS = ['dit-xl2-256', 'dit-xl2-512', 'dit-xl4-256', 'dit-xl8-256', 'dit-b2-256'];
  const PAGE = { page: 'dit', section: 'diagrama' };
  // Subíndices estilo TeX en el html de notas y pasos ("z_t", "z_{t−1}", "ε_u") → <sub>; no toca <code> ni las claves {{…}}
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9θ]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };
  const BLOCK_MINI = { items: [{ label: 'LN·mod', op: 'norm' }, { label: 'Atención', op: 'attn' }, { sym: 'add' }, { label: 'LN·mod', op: 'norm' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] };

  // ------------------------------------------------------------------ (a) vista general
  register(Object.assign({
    id: 'dit-overview', model: 'dit', config: C, configs: CONFIGS, configsNote: 'la de flow matching predice v y tiene su propia vista',
    kind: 'arch', title: 'DiT — vista general',
    caption: 'Un ViT sobre el latente: el latente ruidoso se corta en parches de p × p (cada uno, un token), suma una posición 2-D fija y pasa por L bloques transformer. La condición (el paso t y la clase) NO entra como tokens: se suma en un vector c que llega a cada bloque y le fija la escala y el desplazamiento de sus LayerNorm (adaLN-Zero, línea punteada). Al final, cada token vuelve a su parche: ruido predicho ε̂ y varianza Σ.',
    grid: { w: 182, h: 58 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['block', 'cond'],
    edgeLegend: { control: 'Condición c: llega a cada bloque (adaLN), no es el flujo de datos' },
    groups: [
      { id: 'blocks', label: 'Bloques DiT', labelPos: 'bottom', x: 66, y: 2, w: 46, h: 25, repeat: { sym: 'L', from: 'L', totalOf: 'block', totalLabel: '= {t} en los bloques', tagPos: 'bottom' }, modality: 'lat' },
    ],
    nodes: [
      { id: 'latent', op: 'io', modality: 'lat', label: 'Latente x_t', sub: 'ruidoso', x: 1, y: 6, w: 15, h: 11,
        note: 'El latente ruidoso del paso t: ' + q('tensor.x-t.shape') + ' (la imagen de ' + q('cfg.H') + '×' + q('cfg.W') + ' pasada por el encoder del VAE de SD, ' + q('cfg.f') + ' veces más chica por lado). DiT reemplaza la U-Net; el VAE es el mismo.' },
      { id: 'patchify', op: 'conv', label: 'Patchify', sub: 'conv p×p, stride p', subNum: 'conv {{cfg.P}}×{{cfg.P}}, stride {{cfg.P}} → D', x: 21, y: 6.5, w: 21, h: 10,
        tex: 'X = \\mathrm{flatten}(W_p * x_t) \\in \\mathbb{R}^{N\\times D},\\; N = (I/p)^2', note: 'Como el patch embedding de ViT: una conv p × p con stride p y una fila por parche. Con p = ' + q('cfg.P') + ' son ' + q('metrics.latentTokens') + ' tokens; el costo del modelo crece ≈ con N (y la atención con N²): p es la perilla de cómputo de DiT (DiT-XL/2, /4, /8).' },
      { id: 'pos-embed', op: 'tensorop', shape: 'add', label: '+ posición', sub: '2-D sin/cos, fija', labelPos: 'below', x: 53, y: 9, w: 5, h: 5,
        tex: 'H_0 = X + E_{pos}', note: 'Senos y cosenos de la fila y la columna de cada parche (como en MAE): una tabla fija, sin parámetros. Al cambiar la resolución se recalcula.' },
      { id: 'block', op: 'attn', style: 'block', badgeTotal: true, label: 'Bloque DiT (adaLN-Zero)', expand: 'dit-block', mini: BLOCK_MINI, x: 70, y: 6, w: 38, h: 12,
        tex: '\\begin{aligned} x &\\mathrel{+}= \\alpha_1 \\odot \\mathrm{Attn}(\\mathrm{LN}(x)(1+\\gamma_1)+\\beta_1) \\\\ x &\\mathrel{+}= \\alpha_2 \\odot \\mathrm{MLP}(\\mathrm{LN}(x)(1+\\gamma_2)+\\beta_2) \\end{aligned}',
        note: 'Un bloque ViT pre-LN (atención multi-cabeza + MLP ×4) cuya LayerNorm no tiene γ y β propios: los da la condición c, y cada rama se multiplica por una compuerta α antes del residual. Los 6 vectores salen de una Linear sobre c inicializada en cero (adaLN-Zero): al empezar a entrenar cada bloque es la identidad. Ábrelo.' },
      { id: 'final-layer', op: 'head', label: 'Capa final', sub: 'adaLN + Linear D → p²·2C', x: 117, y: 6.5, w: 25, h: 10,
        tex: 'Y = \\big(\\mathrm{LN}(x)(1+\\gamma) + \\beta\\big)\\,W + b', note: 'Una última LayerNorm modulada por c (2 vectores) y una Linear que da, por token, los valores de su parche: p × p × 2·' + q('cfg.latentC') + ' (ruido y varianza). También se inicializa en cero.' },
      { id: 'unpatchify', op: 'tensorop', shape: 'rect', label: 'Unpatchify', sub: 'tokens → rejilla', x: 152, y: 7, w: 14, h: 9,
        note: 'Cada token vuelve a su lugar como un parche de p × p: la inversa del patchify, sin parámetros.' },
      { id: 'out', op: 'io', modality: 'lat', label: 'ε̂ y Σ', sub: '2C canales', x: 169, y: 6, w: 12, h: 11,
        tex: '[\\hat\\varepsilon;\\, \\Sigma] \\in \\mathbb{R}^{I\\times I\\times 2C}', note: 'La mitad de los canales es el ruido predicho ε̂ (' + q('tensor.eps-hat.shape') + ') y la otra mitad, la varianza Σ del paso (learn sigma, como en Improved DDPM): DiT la aprende con una pérdida extra; el MSE va solo sobre ε̂.' },
      { id: 'timestep', op: 'io', label: 'Paso t', x: 70, y: 33, w: 13, h: 7, note: 'El paso de ruido (un número).' },
      { id: 't-embed', op: 'embed', label: 'Embedding de t', sub: 'sin/cos → MLP', subNum: 'sin/cos {{cfg.freqDim}} → MLP → D', x: 88, y: 33, w: 24, h: 7,
        tex: 'e_t = \\mathrm{MLP}(\\mathrm{PE}(t))', note: 'Senos y cosenos de t (' + q('cfg.freqDim') + ' frecuencias) y un MLP de 2 capas hasta D.' },
      { id: 'class', op: 'io', label: 'Clase y', sub: 'o ∅', x: 70, y: 45, w: 13, h: 7, note: 'Una de las ' + q('cfg.K') + ' clases de ImageNet, o la clase nula ∅ (un 10 % de las veces al entrenar), para poder usar guía libre de clasificador.' },
      { id: 'y-embed', op: 'embed', label: 'Embedding de clase', sub: 'tabla (K + 1) × D', x: 88, y: 45, w: 24, h: 7,
        tex: 'e_y = E[y],\\; E \\in \\mathbb{R}^{(K+1)\\times D}', note: 'Una fila por clase más la de ∅.' },
      { id: 'cond', op: 'tensorop', shape: 'add', label: 'c = e_t + e_y', labelPos: 'right', x: 122, y: 40.5, w: 5, h: 5,
        tex: 'c = e_t + e_y', note: 'La condición es UN vector de D: la suma de los dos embeddings. Es el mismo para todos los tokens y para todos los bloques; cada bloque lo transforma con su propia adaLN. (En SD3 y Flux el texto entra como tokens, MMDiT: no es este caso.)' },
    ],
    tensors: [
      { id: 'x-t', at: { edge: 'latent>patchify' }, show: 'glyph' },
      { id: 'x-patches', at: { edge: 'patchify>pos-embed' }, show: 'both' },
    ],
    edges: [
      { from: 'latent', to: 'patchify', kind: 'data', tensor: 'x-t', fromAt: 0.5, toAt: 0.5, labelSide: 'below' },
      { from: 'patchify', to: 'pos-embed', kind: 'data', tensor: 'x-patches', labelSide: 'above', labelT: 0.5 },
      { from: 'pos-embed', to: 'block', kind: 'data', tensor: 'h0', label: false },
      { from: 'block', to: 'final-layer', kind: 'data', tensor: 'x-out', labelSide: 'above', labelT: 0.5, label: false },
      { from: 'final-layer', to: 'unpatchify', kind: 'data', tensor: 'h-final', labelSide: 'below' },
      { from: 'unpatchify', to: 'out', kind: 'data', tensor: 'out', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'timestep', to: 't-embed', kind: 'control' },
      { from: 'class', to: 'y-embed', kind: 'control' },
      { from: 't-embed', to: 'cond', kind: 'control', tensor: 't-emb', fromSide: 'right', toSide: 'top' },
      { from: 'y-embed', to: 'cond', kind: 'control', tensor: 'y-emb', fromSide: 'right', toSide: 'bottom' },
      { from: 'cond', to: 'block', kind: 'control', tensor: 'c', shapeLabel: true, fromSide: 'top', toSide: 'bottom', toAt: 0.45, via: [[124.5, 30.5], [87.1, 30.5]], tag: 'a cada bloque', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.35, labelSide: 'right', labelSeg: 0, labelT: 0.5 },
      { from: 'cond', to: 'final-layer', kind: 'control', tensor: 'c', fromSide: 'top', toSide: 'bottom', via: [[124.5, 30.5], [129.5, 30.5]] },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (DiT-XL/2 @ 256, una pasada)', steps: [
        { nodes: ['latent', 'patchify'], edges: ['latent>patchify', 'patchify>pos-embed'], tensors: ['x-t', 'x-patches'],
          text: 'El latente ruidoso <b>' + q('tensor.x-t.shape') + '</b> se corta en parches de ' + q('cfg.P') + '×' + q('cfg.P') + ': <b>' + q('tensor.x-patches.shape') + '</b>, un token de ancho ' + q('cfg.D') + ' por parche.' },
        { nodes: ['pos-embed'], edges: ['pos-embed>block'], tensors: ['h0'],
          text: 'Se suma la posición 2-D fija (senos y cosenos, sin parámetros): <b>' + q('tensor.h0.shape') + '</b>.' },
        { nodes: ['timestep', 't-embed', 'class', 'y-embed', 'cond'], edges: ['timestep>t-embed', 'class>y-embed', 't-embed>cond', 'y-embed>cond'], tensors: ['t-emb', 'y-emb', 'c'],
          text: 'La condición: el paso t y la clase se vuelven vectores de ' + q('cfg.D') + ' y se suman: <b>c</b> (' + q('tensor.c.shape') + '). No se agrega como token: un solo vector para toda la imagen.' },
        { nodes: ['block', 'cond'], edges: ['pos-embed>block', 'cond>block', 'block>final-layer'], tensors: ['h0', 'c', 'x-out'],
          text: 'Los ' + q('cfg.L') + ' bloques adaLN-Zero (' + q('metrics.blockParams') + ' parámetros cada uno; un ' + q('metrics.adalnParamsShare') + ' del modelo está en las Linear de adaLN). c llega a cada bloque y fija la escala, el desplazamiento y la compuerta de sus dos ramas.' },
        { expand: 'dit-block', nodes: ['adaln', 'modulate1', 'gate1', 'modulate2', 'gate2'], edges: ['c>adaln'], tensors: ['c'],
          text: 'Dentro del bloque: adaLN saca 6 vectores de c (β₁, γ₁, α₁ para la atención; β₂, γ₂, α₂ para el MLP). La LayerNorm no tiene parámetros: la modulan γ y β; α multiplica la rama antes del residual. Con α = 0 al inicio, el bloque empieza siendo la identidad.' },
        { nodes: ['final-layer', 'unpatchify', 'out'], edges: ['block>final-layer', 'final-layer>unpatchify', 'unpatchify>out'], tensors: ['h-final', 'out'],
          text: 'Capa final (adaLN + Linear): <b>' + q('tensor.h-final.shape') + '</b>, los valores de cada parche; unpatchify los devuelve a la rejilla: <b>' + q('tensor.out.shape') + '</b> = ε̂ y Σ. Una pasada cuesta ' + q('metrics.ditMacs') + ' (la cifra que el paper llama "Gflops" son MACs).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) bloque DiT (adaLN-Zero)
  const BX = 18, BW = 26;   // columna del bloque
  const tagE = (to, y, tag, tensor) => ({ from: 'adaln', to, kind: 'control', tensor, fromSide: 'bottom', toSide: 'right', fromAt: 0.2966, via: [[60.6, y]], tag, tagStyle: 'plain', tagSide: 'on', tagSeg: -1, tagT: 0.45 });
  register(Object.assign({
    id: 'dit-block', model: 'dit', config: C, configs: CONFIGS.concat([CF]), kind: 'arch', title: 'Bloque DiT con adaLN-Zero',
    parent: 'dit-overview', parentNode: 'block',
    caption: 'Un bloque pre-LN de ViT con dos cambios: la LayerNorm no tiene parámetros y la modulan la escala γ y el desplazamiento β que salen de la condición c; y cada rama se multiplica por una compuerta α antes del residual. adaLN produce los 6 vectores con una Linear inicializada en cero: al empezar, α = 0 y el bloque es la identidad.',
    grid: { w: 82, h: 114 }, direction: 'tb', maxCrossings: 0,
    edgeLegend: { control: 'Vectores de la condición (β, γ, α): uno por canal, iguales para todos los tokens' },
    nodes: [
      { id: 'in', op: 'io', modality: 'lat', label: 'Entrada x', sub: 'N × D', x: 18, y: 1, w: 26, h: 6, note: 'Los tokens que salen del bloque anterior (en el primero, los parches + posición).' },
      { id: 'norm1', op: 'norm', label: 'LayerNorm 1', sub: 'sin γ ni β', x: BX, y: 11, w: BW, h: 6, note: 'Normaliza cada token, sin parámetros propios (<code>elementwise_affine = False</code>).' },
      { id: 'modulate1', op: 'tensorop', shape: 'rect', label: 'Modular', sub: '× (1 + γ₁) + β₁', x: BX, y: 21, w: BW, h: 6, tex: '\\hat x = \\mathrm{LN}(x)\\,(1 + \\gamma_1) + \\beta_1', note: 'La condición fija la escala y el desplazamiento por canal: el mismo para todos los tokens de la imagen.' },
      { id: 'attn', op: 'attn', label: 'Atención multi-cabeza', sub: 'h cabezas', heads: 'h', x: 14, y: 31, w: 34, h: 8, tex: '\\mathrm{MHSA}(\\hat x)', note: 'La self-attention de ViT sobre los ' + q('metrics.latentTokens') + ' tokens (con sesgo en Q, K, V).' },
      { id: 'gate1', op: 'tensorop', shape: 'rect', label: 'Compuerta', sub: '× α₁', x: BX, y: 43, w: BW, h: 6, tex: '\\alpha_1 \\odot \\mathrm{Attn}(\\hat x)', note: 'Escala la salida de la atención por canal antes de sumarla. Con α₁ = 0 (al inicio) la rama no aporta nada.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 29, y: 53, w: 4, h: 4, note: 'x + α₁ ⊙ Attn(…).' },
      { id: 'norm2', op: 'norm', label: 'LayerNorm 2', sub: 'sin γ ni β', x: BX, y: 61, w: BW, h: 6, note: 'Segunda LayerNorm sin parámetros.' },
      { id: 'modulate2', op: 'tensorop', shape: 'rect', label: 'Modular', sub: '× (1 + γ₂) + β₂', x: BX, y: 71, w: BW, h: 6, tex: '\\mathrm{LN}(x)\\,(1 + \\gamma_2) + \\beta_2', note: 'Lo mismo antes del MLP, con su propio par (γ₂, β₂).' },
      { id: 'mlp', op: 'mlp', label: 'MLP', sub: 'D → 4D → D · GELU', x: 16, y: 81, w: 30, h: 7, tex: 'W_2\\,\\mathrm{GELU}(W_1 x + b_1) + b_2', note: 'El MLP de ViT (ancho ' + q('quantities.Dmlp') + ').' },
      { id: 'gate2', op: 'tensorop', shape: 'rect', label: 'Compuerta', sub: '× α₂', x: BX, y: 92, w: BW, h: 6, tex: '\\alpha_2 \\odot \\mathrm{MLP}(\\cdot)', note: 'Compuerta de la rama del MLP.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 29, y: 102, w: 4, h: 4, note: 'Cierra el bloque.' },
      { id: 'out', op: 'io', modality: 'lat', label: 'Salida', x: 18, y: 108.5, w: 26, h: 5, note: 'Misma forma: N × D.' },
      { id: 'c', op: 'io', label: 'Condición c', sub: 'e_t + e_y', x: 54, y: 1, w: 26, h: 6, note: 'El vector de condición (' + q('tensor.c.shape') + '): el mismo para todos los bloques.' },
      { id: 'adaln', op: 'embed', scope: 'blocks', label: 'adaLN', sub: 'SiLU → Linear D → 6D (cero)', x: 52, y: 11, w: 29, h: 7,
        tex: '\\begin{aligned} &[\\beta_1, \\gamma_1, \\alpha_1, \\beta_2, \\gamma_2, \\alpha_2] \\\\ &\\quad = W\\,\\mathrm{SiLU}(c) + b,\\; W = 0 \\text{ al inicio} \\end{aligned}', note: 'Una Linear de D a 6D por bloque: ' + q('metrics.adalnParamsShare') + ' de los parámetros del modelo están aquí (≈ un tercio de cada bloque). Inicializada en ceros (adaLN-Zero): el paper la compara con adaLN sin ceros, cross-attention y tokens de condición, y es la mejor en FID.' },
    ],
    edges: [
      { from: 'in', to: 'norm1', kind: 'data', tensor: 'h0', labelSide: 'right', labelT: 0.5 },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[31, 9], [8, 9], [8, 55]], dot: true },
      { from: 'norm1', to: 'modulate1', kind: 'data', tensor: 'h-norm1', label: false },
      { from: 'modulate1', to: 'attn', kind: 'data', tensor: 'h-mod1', label: false },
      { from: 'attn', to: 'gate1', kind: 'data', tensor: 'o', label: false },
      { from: 'gate1', to: 'res1', kind: 'data', tensor: 'o-gated', label: false },
      { from: 'res1', to: 'norm2', kind: 'data', tensor: 'r1', labelSide: 'right' },
      { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[31, 59], [8, 59], [8, 104]], dot: true },
      { from: 'norm2', to: 'modulate2', kind: 'data', tensor: 'h-norm2', label: false },
      { from: 'modulate2', to: 'mlp', kind: 'data', tensor: 'h-mod2', label: false },
      { from: 'mlp', to: 'gate2', kind: 'data', tensor: 'f', label: false },
      { from: 'gate2', to: 'res2', kind: 'data', tensor: 'f-gated', label: false },
      { from: 'res2', to: 'out', kind: 'data', tensor: 'x-out', label: false },
      { from: 'c', to: 'adaln', kind: 'control', tensor: 'c', fromAt: 0.6, toAt: 0.6 },
      tagE('modulate1', 24, 'γ₁, β₁', 'gamma1'),
      tagE('gate1', 46, 'α₁', 'alpha1'),
      tagE('modulate2', 74, 'γ₂, β₂', 'gamma2'),
      tagE('gate2', 95, 'α₂', 'alpha2'),
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ flow matching: un paso de entrenamiento
  const MODEL_OPS = ['patchify', 'patch-flatten', 'pos-embed', 'add-pos', 'temb-freq', 'temb-fc1', 'temb-silu', 'temb-fc2', 'y-embed', 'cond', 'adaln', 'norm1', 'modulate1', 'qkv', 'split', 'scores', 'scale', 'softmax', 'weighted-sum', 'merge', 'proj', 'gate1', 'res1', 'norm2', 'modulate2', 'fc1', 'gelu', 'fc2', 'gate2', 'res2', 'final-adaln', 'final-norm', 'final-modulate', 'final-linear', 'unpatchify'];
  register(Object.assign({
    id: 'flow-matching', model: 'dit', config: CF, configs: [CF], configsNote: 'un paso de entrenamiento de flow matching (predice v)', kind: 'arch', title: 'Flow matching — un paso de entrenamiento',
    caption: 'Flow matching con el camino recto (flujo rectificado, la convención de SD3): se mezcla el dato x₀ con ruido ε en un t ∈ [0, 1] al azar, x_t = (1−t)·x₀ + t·ε, y la red predice la velocidad del camino, que es constante: v = ε − x₀. La pérdida es un MSE, como en la difusión; cambia el objetivo (v en vez de ε) y el camino (recto en vez de un arco). Para muestrear se integra de t = 1 a 0 con pasos de Euler.',
    grid: { w: 150, h: 48 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['interp', 'model', 'v-target'],
    edgeLegend: { control: 'Control: el tiempo t y la clase' },
    nodes: [
      { id: 'x0', op: 'io', modality: 'lat', label: 'Dato x₀', sub: 'latente', x: 1, y: 19, w: 16, h: 10, note: 'El latente de una imagen del dataset (por el encoder del VAE): ' + qf('tensor.x0.shape') + '.' },
      { id: 'interp', op: 'tensorop', shape: 'rect', label: 'Interpolar', sub: 'x_t = (1−t)·x₀ + t·ε', x: 26, y: 8, w: 32, h: 10, ops: ['interp'], opsExact: true,
        tex: 'x_t = (1-t)\\,x_0 + t\\,\\varepsilon,\\quad t \\sim \\mathcal{U}[0, 1]', note: 'Un punto de la recta entre el dato (t = 0) y el ruido (t = 1). En la práctica t se muestrea no uniforme (SD3 usa logit-normal, más peso a los t intermedios).' },
      { id: 'eps', op: 'io', modality: 'lat', label: 'Ruido ε', sub: '~ N(0, I)', x: 34, y: 21, w: 16, h: 7, note: 'Ruido nuevo para cada ejemplo, con la forma del latente.' },
      { id: 'v-target', op: 'tensorop', shape: 'rect', label: 'Objetivo v', sub: 'v = ε − x₀', x: 26, y: 37, w: 32, h: 8, ops: ['v-target'], opsExact: true,
        tex: 'v = \\frac{dx_t}{dt} = \\varepsilon - x_0', note: 'La derivada del camino recto respecto de t: no depende de t. Es lo que la red debe predecir.' },
      { id: 'timestep', op: 'io', label: 't ∈ [0, 1]', x: 62, y: 22, w: 17, h: 7, note: 'El tiempo del camino (al azar en cada ejemplo).' },
      { id: 'class', op: 'io', label: 'Clase y', x: 86, y: 22, w: 15, h: 7, note: 'La condición, como en DiT (o el texto, en SD3).' },
      { id: 'model', op: 'attn', style: 'block', label: 'Red v_θ (DiT)', sub: 'predice la velocidad', ops: MODEL_OPS, opsExact: true, x: 72, y: 6, w: 32, h: 14,
        tex: '\\hat v = v_\\theta(x_t,\\, t,\\, y)', note: 'La misma DiT de esta página, sin la salida de varianza: predice v̂ con la forma del latente. Cualquier red sirve (SD3 usa MMDiT; π0 usa flow matching para acciones).' },
      { id: 'loss', op: 'head', label: 'Pérdida', sub: '‖v̂ − v‖²', ops: ['loss'], opsExact: true, x: 120, y: 30, w: 28, h: 9,
        tex: '\\mathcal{L} = \\lVert v_\\theta(x_t, t, y) - (\\varepsilon - x_0) \\rVert^2', note: 'Un MSE, como el de la difusión: regresión. Al muestrear: x ← x − Δt·v̂, de t = 1 (ruido) a t = 0, en N pasos de Euler.' },
    ],
    tensors: [
      { id: 'x-t', at: { edge: 'interp>model' }, show: 'both' },
    ],
    edges: [
      { from: 'x0', to: 'interp', kind: 'data', tensor: 'x0', fromSide: 'top', toSide: 'left', labelSide: 'left', labelSeg: 0 },
      { from: 'x0', to: 'v-target', kind: 'data', tensor: 'x0', fromSide: 'bottom', toSide: 'left', label: false },
      { from: 'eps', to: 'interp', kind: 'data', tensor: 'eps', fromSide: 'top', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'eps', to: 'v-target', kind: 'data', tensor: 'eps', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.5, labelSide: 'right' },
      { from: 'timestep', to: 'interp', kind: 'control', fromSide: 'left', toSide: 'bottom', toAt: 0.85 },
      { from: 'timestep', to: 'model', kind: 'control', fromSide: 'top', toSide: 'bottom', fromAt: 0.7, toAt: 0.06 },
      { from: 'class', to: 'model', kind: 'control', fromSide: 'top', toSide: 'bottom', fromAt: 0.5, toAt: 0.6 },
      { from: 'interp', to: 'model', kind: 'data', tensor: 'x-t', labelSide: 'above' },
      { from: 'model', to: 'loss', kind: 'data', tensor: 'v-hat', fromSide: 'right', toSide: 'top', labelSide: 'right', labelSeg: 1 },
      { from: 'v-target', to: 'loss', kind: 'data', tensor: 'v-target', fromAt: 0.5, toAt: 0.8, labelSide: 'below' },
    ],
    walks: [
      { id: 'training', label: 'Recorrido: un paso de flow matching', steps: [
        { nodes: ['x0', 'eps', 'timestep', 'interp'], edges: ['x0>interp', 'eps>interp', 'timestep>interp'], tensors: ['x0', 'eps', 'x-t'],
          text: 'Un dato x₀ (<b>' + qf('tensor.x0.shape') + '</b>), un ruido ε de la misma forma y un t al azar: x_t = (1−t)·x₀ + t·ε, un punto de la recta que los une.' },
        { nodes: ['model'], edges: ['interp>model', 'timestep>model', 'class>model', 'model>loss'], tensors: ['x-t', 'v-hat'],
          text: 'La red recibe x_t, t y la clase y predice la velocidad: <b>' + qf('tensor.v-hat.shape') + '</b> (una pasada de DiT-XL/2: ' + qf('metrics.ditMacs') + ').' },
        { nodes: ['v-target', 'loss'], edges: ['x0>v-target', 'eps>v-target', 'v-target>loss', 'model>loss'], tensors: ['v-target', 'v-hat'],
          text: 'El objetivo es v = ε − x₀, la misma en toda la recta. MSE entre v̂ y v: regresión, como en la difusión. Al generar se recorre la recta al revés con pasos de Euler: con un camino recto, pocos pasos alcanzan.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
