/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/stable-diffusion.js
   Diagramas de Stable Diffusion 1.5 (SPEC §7.2, ids de §20.1), modelo `stable-diffusion` (js/arch/diffusion.js):
     sd-overview            (sección diagrama, config sd15-unet) el muestreo de UNA imagen: prompt → encoder de texto (1 vez,
                            2 pasadas con CFG) ; ruido z_T → U-Net ⇄ scheduler dentro del BUCLE de muestreo (× pasos; la U-Net
                            corre 2 veces por paso con CFG: ε_u y ε_c) → decoder del VAE (1 vez) → imagen. Abajo, la barra del
                            costo por imagen (MACs del calculador): la U-Net × pasos se lleva casi todo.
       sd-unet              la U: 4 niveles de bajada (64 → 32 → 16 → 8), el bloque medio y 4 de subida, con las skips cruzando,
                            el embedding del tiempo llegando a cada nivel (tronco central) y el texto (K, V) a cada nivel con
                            bloques transformer (bus por fuera)
         sd-transformer-block   (desde Down 1) el bloque transformer d1-attn1: GN → conv 1×1 → tokens → self-attn → cross-attn
                                (K, V del texto) → FF GEGLU → conv 1×1 → + x
         sd-resblock            (desde Down 2) el bloque ResNet d2-res1 (320 → 640, con atajo conv 1×1) con el tiempo sumado
     sd-training            (sección entrenamiento, config sd15-train) un paso: imagen → encoder del VAE (congelado) → z₀ →
                            agregar ruido en un t al azar → U-Net(z_t, t, texto) → MSE contra ε
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'sd15-unet', CT = 'sd15-train';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const qt = (k) => '{{' + CT + '.' + k + '}}';
  const PAGE = { page: 'stable-diffusion', section: 'diagrama' };
  // Subíndices estilo TeX en el html de notas y pasos ("z_t", "z_{t−1}", "ε_u") → <sub>; no toca <code> ni las claves {{…}}
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9θ]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };

  // ------------------------------------------------------------------ (a) vista general: el muestreo
  register(Object.assign({
    id: 'sd-overview', model: 'stable-diffusion', config: C, configs: [C], configsNote: 'el muestreo completo; el paso de entrenamiento está en su propia vista',
    kind: 'arch', title: 'Stable Diffusion 1.5 — muestreo de una imagen',
    caption: 'Generar = quitar ruido de a poco. El texto se codifica una vez (CLIP; con CFG también el prompt vacío ""). Se parte de ruido puro en el espacio latente del VAE (' + q('cfg.f') + ' veces más chico por lado) y, dentro del bucle, la U-Net predice el ruido y el scheduler da un paso hacia la imagen; con guía libre de clasificador (CFG) la U-Net corre dos veces por paso, con y sin texto, en UNA pasada con un lote de 2 (por eso entran el prompt y ""), y el scheduler le devuelve el latente y el paso t siguientes. Al final, el decoder del VAE lleva el latente a píxeles una sola vez. La barra de abajo es el costo de una imagen: casi todo es la U-Net repetida.',
    grid: { w: 160, h: 66 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['unet', 'scheduler'],
    edgeLegend: { control: 'Bucle: el latente nuevo y el paso t siguiente vuelven a la U-Net' },
    groups: [
      { id: 'loop', style: 'lane', tone: 'accent', label: 'Bucle de muestreo: × {{cfg.steps}} pasos', labelPos: 'top-right', legend: 'Marco azul: corre en cada paso del muestreo', x: 27, y: 17, w: 81, h: 31, hideInBlank: true },
    ],
    nodes: [
      { id: 'prompt', op: 'io', modality: 'txt', label: 'Prompt', sub: 'texto → ids', x: 1, y: 3, w: 18, h: 9,
        note: 'El texto del usuario, tokenizado por CLIP y rellenado o cortado a ' + q('cfg.T') + ' ids (77 posiciones del encoder de texto). Con CFG se codifica además el prompt vacío "" (o un prompt negativo): es la condición "sin texto".' },
      { id: 'text-encoder', op: 'attn', modality: 'txt', label: 'Encoder de texto (CLIP)', sub: 'ViT-L/14 · transformer', subNum: '{{cfg.Lt}} capas · D_t = {{cfg.Dtxt}}', runs: '× {{metrics.textPasses}}', runsTone: 'once', x: 30, y: 2, w: 34, h: 11,
        costNote: 'Por pasada; corre {{' + C + '.metrics.textPasses}} veces por imagen (el prompt y el vacío), no una por paso.',
        tex: 'c = \\mathrm{CLIP}_{\\text{texto}}(\\text{ids}) \\in \\mathbb{R}^{T\\times D_t}',
        note: 'El encoder de texto de CLIP ViT-L/14 (congelado): un transformer de ' + q('cfg.Lt') + ' capas con máscara causal. SD usa la salida de TODOS los tokens (tras la LayerNorm final), no un solo vector: ' + q('tensor.text-emb.shape') + ' que la U-Net lee por cross-attention. Corre ' + q('metrics.textPasses') + ' veces por imagen (prompt y prompt vacío), fuera del bucle: su costo es despreciable.' },
      { id: 'noise', op: 'io', modality: 'lat', label: 'Ruido z_T', sub: '~ N(0, I)', x: 1, y: 21, w: 17, h: 14,
        note: 'El punto de partida: ruido gaussiano con la forma del latente, ' + q('tensor.z-t.shape') + ' (la imagen de ' + q('cfg.H') + '×' + q('cfg.W') + ' dividida por ' + q('cfg.f') + ' por lado, 4 canales): ' + q('metrics.compressionFactor') + ' veces menos números que los píxeles. La semilla fija este ruido: misma semilla y mismo prompt, misma imagen.' },
      { id: 'unet', op: 'conv', label: 'U-Net', sub: 'predice el ruido ε̂(z_t, t, c)\nlote de 2: con y sin texto', subNum: 'predice el ruido ε̂(z_t, t, c)\nlote de {{metrics.nfePerStep}}: con y sin texto', expand: 'sd-unet', runs: '× {{metrics.nfe}} pasadas', x: 30, y: 21, w: 34, h: 14,
        costNote: 'Por pasada (1 NFE, una muestra del lote); × {{' + C + '.metrics.nfe}} pasadas por imagen = {{' + C + '.metrics.denoiserSamplingMacs}}.',
        tex: '\\hat\\varepsilon = \\varepsilon_\\theta(z_t,\\, t,\\, c)',
        note: 'La red que se entrena: recibe el latente ruidoso z_t, el paso t y el texto, y predice el ruido ε que tiene z_t (misma forma que z_t). Es una U convolucional con bloques transformer (self- y cross-attention) en los niveles de más resolución. Corre en cada paso, y con CFG dos veces (con y sin texto, en un lote de 2): ' + q('metrics.nfe') + ' pasadas por imagen de ' + q('metrics.unetMacs') + ' cada una. Ábrela.' },
      { id: 'scheduler', op: 'tensorop', shape: 'rect', label: 'Scheduler', sub: 'CFG + paso DDIM', x: 79, y: 23, w: 26, h: 10,
        tex: '\\begin{aligned} \\tilde\\varepsilon &= \\varepsilon_u + w(\\varepsilon_c - \\varepsilon_u) \\\\ z_{t-1} &= \\sqrt{\\bar\\alpha_{t-1}}\\,\\hat z_0 + \\sqrt{1-\\bar\\alpha_{t-1}}\\,\\tilde\\varepsilon \\end{aligned}',
        note: 'Sin parámetros: combina las dos predicciones con la guía (w = ' + q('cfgScale') + ': ε̃ = ε_u + w·(ε_c − ε_u), la convención de diffusers; en el paper de Ho y Salimans es (1 + w)·ε_c − w·ε_u, así que ese w vale uno menos) y da un paso del sampler. DDIM estima la imagen limpia ẑ₀ = (z_t − √(1−ᾱ_t)·ε̃)/√ᾱ_t y la vuelve a ruidear al nivel del paso siguiente. Los ' + q('cfg.steps') + ' pasos son un subconjunto de los ' + q('cfg.trainSteps') + ' del entrenamiento.' },
      { id: 'vae-decoder', op: 'conv', label: 'Decoder del VAE', sub: 'latente → píxeles', subNum: '× {{cfg.f}} por lado · conv', runs: '× 1', runsTone: 'once', x: 120, y: 23, w: 23, h: 10,
        costNote: 'Corre una sola vez (× 1): este es también su costo por imagen.',
        tex: 'x = D(z_0 / s),\\; s = 0.18215',
        note: 'El decoder del autoencoder (congelado): divide por el factor de escala y sube de ' + q('tensor.z-t.shape') + ' a ' + q('tensor.image.shape') + ' con convoluciones (ResNet + upsample). Corre UNA vez por imagen, pero es caro por pasada (' + q('metrics.vaeDecoderMacs') + ': trabaja a resolución completa).' },
      { id: 'image', op: 'io', image: true, imageGrid: 0, label: 'Imagen', x: 146, y: 20, w: 13, h: 16, note: 'La imagen generada, ' + q('tensor.image.shape') + '.' },
      { id: 'cost', op: 'io', label: 'Costo por imagen (MACs)', hideInBlank: true, x: 1, y: 51, w: 158, h: 14,
        costSplit: {
          segs: [
            { tone: 'once', n: 'metrics.textEncoderMacs', times: 'metrics.textPasses', label: 'Encoder de texto × {{metrics.textPasses}}' },
            { tone: 'loop', n: 'metrics.denoiserSamplingMacs', label: 'U-Net × {{metrics.nfe}} pasadas ({{cfg.steps}} pasos × {{metrics.nfePerStep}} por CFG)' },
            { tone: 'once2', n: 'metrics.vaeDecoderMacs', label: 'Decoder del VAE × 1' },
          ],
          caption: 'total {{metrics.samplingMacs}} por imagen · ≈ {{metrics.msPerImage}} ms en una H100 (cota del calculador)',
        },
        note: 'De dónde sale el costo de generar una imagen (MACs de matmuls y convs, del calculador). La U-Net no es la red más cara por pasada (el decoder del VAE cuesta más), pero corre ' + q('metrics.nfe') + ' veces: ' + q('metrics.denoiserSamplingShare') + ' del total. Menos pasos o sin CFG es donde se ahorra; el tiempo (≈ ' + q('metrics.msPerImage') + ' ms en una H100) es una cota de roofline, no una medición.' },
    ],
    tensors: [
      { id: 'z-t', at: { edge: 'noise>unet' }, show: 'both' },
      { id: 'image', at: { edge: 'vae-decoder>image' }, show: 'label' },
    ],
    edges: [
      { from: 'prompt', to: 'text-encoder', kind: 'data', tensor: 'prompt-ids', labelSide: 'below' },
      { from: 'text-encoder', to: 'unet', kind: 'cross', tensor: 'text-emb', labelSide: 'right', labelT: 0.2, tag: 'K,V: prompt y ""', tagT: 0.25 },
      { from: 'noise', to: 'unet', kind: 'data', tensor: 'z-t', fromAt: 0.4, toAt: 0.4, labelSide: 'above' },
      { from: 'unet', to: 'scheduler', kind: 'data', tensor: 'eps-uncond', fromAt: 0.3, toAt: 0.22, tag: 'ε_u sin texto', tagStyle: 'plain', tagSide: 'on', tagT: 0.5, label: false },
      { from: 'unet', to: 'scheduler', kind: 'data', tensor: 'eps-hat', fromAt: 0.72, toAt: 0.808, tag: 'ε_c con texto', tagStyle: 'plain', tagSide: 'on', tagT: 0.5, label: false },
      { from: 'scheduler', to: 'unet', kind: 'control', tensor: 'z-prev', shapeLabel: true, fromSide: 'bottom', toSide: 'bottom', via: [[92, 45], [47, 45]], tag: 'z_{t−1} y el paso t · × {{cfg.steps}} pasos', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5, loop: true, labelSide: 'right', labelSeg: 0, labelT: 0.45 },
      { from: 'scheduler', to: 'vae-decoder', kind: 'data', tensor: 'z-prev', tag: 'z_0, al final', tagStyle: 'plain', tagSide: 'below', tagT: 0.5, labelSide: 'above', labelT: 0.6 },
      { from: 'vae-decoder', to: 'image', kind: 'data', tensor: 'image', fromAt: 0.388, toAt: 0.43, label: false },
    ],
    walks: [
      { id: 'sampling', label: 'Recorrido: generar una imagen (SD 1.5, 512×512, CFG)', steps: [
        { nodes: ['prompt', 'text-encoder'], edges: ['prompt>text-encoder', 'text-encoder>unet'], tensors: ['prompt-ids', 'text-emb'],
          text: 'El prompt se tokeniza a <b>' + q('tensor.prompt-ids.shape') + '</b> ids y el encoder de texto de CLIP lo vuelve <b>' + q('tensor.text-emb.shape') + '</b>: un vector por token, que la U-Net leerá por cross-attention. Con CFG también se codifica el prompt vacío: ' + q('metrics.textPasses') + ' pasadas de ' + q('metrics.textEncoderMacs') + ', una sola vez por imagen.' },
        { nodes: ['noise'], edges: ['noise>unet'], tensors: ['z-t'],
          text: 'Se parte de ruido puro con la forma del latente: <b>' + q('tensor.z-t.shape') + '</b> (' + q('cfg.H') + '/' + q('cfg.f') + ' por lado, 4 canales; ' + q('metrics.compressionFactor') + ' veces menos números que la imagen). Todo el bucle trabaja en este espacio chico: esa es la idea de la difusión latente.' },
        { nodes: ['unet'], edges: ['noise>unet', 'text-encoder>unet', 'unet>scheduler'], tensors: ['z-t', 'eps-hat', 'eps-uncond'],
          text: 'La U-Net recibe z_t, el paso t y el texto, y predice el ruido: <b>' + q('tensor.eps-hat.shape') + '</b>. Con CFG corre dos veces en UNA llamada con un lote de 2: el mismo z_t con el texto (ε_c) y con el prompt vacío (ε_u). Cada pasada (cada muestra del lote) cuesta ' + q('metrics.unetMacs') + '.' },
        { expand: 'sd-unet', nodes: ['down-1', 'down-2', 'down-3', 'down-4', 'mid', 'up-1', 'up-2', 'up-3', 'up-4'], edges: ['down-1>up-4', 'down-2>up-3', 'down-3>up-2', 'down-4>up-1'], tensors: ['h-in', 'd1-down-out', 'd2-down-out', 'd3-down-out'],
          text: 'Por dentro, la U baja a la mitad de resolución y dobla los canales por nivel (' + q('tensor.h-in.shape') + ' → ' + q('tensor.d3-down-out.shape') + '), pasa por el bloque medio y vuelve a subir; las skips (raya-punto) le devuelven a cada nivel de subida el detalle del mismo nivel de bajada. El tiempo llega a cada bloque ResNet y el texto a cada bloque transformer.' },
        { nodes: ['scheduler'], edges: ['unet>scheduler', 'scheduler>unet'], tensors: ['eps-hat', 'eps-uncond', 'z-prev'],
          text: 'El scheduler combina las dos predicciones con la guía, ε̃ = ε_u + ' + q('cfgScale') + '·(ε_c − ε_u), y da un paso DDIM: z_t → z_{t−1}, un poco menos ruidoso. El nuevo latente (' + q('tensor.z-prev.shape') + ') vuelve a la U-Net con el paso t siguiente de la grilla del sampler: el bucle se repite ' + q('cfg.steps') + ' veces (' + q('metrics.nfe') + ' pasadas de la U-Net, de a 2 en un lote).' },
        { nodes: ['vae-decoder', 'image'], edges: ['scheduler>vae-decoder', 'vae-decoder>image'], tensors: ['z-prev', 'image'],
          text: 'Tras el último paso, el latente limpio z₀ (<b>' + q('tensor.z-prev.shape') + '</b>) pasa UNA vez por el decoder del VAE: <b>' + q('tensor.image.shape') + '</b>. Es la red más cara por pasada (' + q('metrics.vaeDecoderMacs') + '), pero corre una sola vez.' },
        { nodes: ['cost', 'unet'], edges: [], tensors: [],
          text: 'Costo de la imagen: ' + q('metrics.samplingMacs') + ', y ' + q('metrics.denoiserSamplingShare') + ' es la U-Net repetida. Sin CFG sería ' + q('metrics.samplingMacsNoCfg') + '. En una H100, ≈ ' + q('metrics.msPerImage') + ' ms como cota (roofline del calculador, no una medición).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) la U-Net
  const LV = [22, 38, 54, 70];               // y de los 4 niveles (u): 64, 32, 16, 8
  const LX = 18, RX = 98, CW = 34, NH = 10, TX = 75;
  const RES = { label: 'Res', op: 'conv' }, TR = { label: 'Tr', op: 'attn' }, DOWN = { label: '↓', op: 'conv' }, UP = { label: '↑', op: 'conv' };
  const UNET_CFGS = [C, CT];
  // k = nivel por resolución (0 = el más fino); las formas, del calculador
  const levelNote = (k, down) => {
    const sh = q('tensor.' + ['d1-attn2-out', 'd2-attn2-out', 'd3-attn2-out', 'd4-res2-out'][k] + '.shape');
    return down
      ? 'Nivel ' + (k + 1) + ' de bajada (' + sh + '). ' + (k < 3 ? '2 pares (bloque ResNet + bloque transformer) y al final una conv 3×3 con stride 2 que baja la resolución a la mitad.' : '2 bloques ResNet, sin transformer ni downsample: es el nivel más chico.') + ' De aquí salen 3 skips hacia el nivel de subida de la misma resolución: la entrada del nivel y la salida de cada ' + (k < 3 ? 'par' : 'bloque') + '.' + (k === 1 || k === 2 ? ' Ojo: la entrada del nivel (' + q('tensor.' + ['h-in', 'd1-down-out', 'd2-down-out'][k] + '.shape') + ', la salida del downsample anterior) tiene la mitad de canales que las otras dos.' : '')
      : 'Nivel de subida a la resolución del nivel ' + (k + 1) + ' de bajada. Cada uno de sus 3 bloques ResNet concatena (por canales) una de las 3 skips de ese nivel: por eso sus ResNet reciben más canales y su atajo es una conv 1×1. ' + (k === 1 || k === 2 ? 'Las 3 skips no son iguales: el último ResNet recibe la de la entrada del nivel de bajada (' + q('tensor.' + ['h-in', 'd1-down-out', 'd2-down-out'][k] + '.shape') + '), con la mitad de canales. ' : '') + (k === 3 ? 'Sin bloques transformer. ' : 'Cada ResNet va seguido de un bloque transformer. ') + (k > 0 ? 'Al final, un upsample (vecino ×2 + conv 3×3).' : 'Sin upsample: sigue <code>conv_out</code>.');
  };
  const unetNodes = [
    { id: 'zt', op: 'io', modality: 'lat', label: 'z_t', sub: 'latente', x: 1, y: 2, w: 14, h: 9, note: 'El latente ruidoso del paso t: ' + q('tensor.z-t.shape') + '.' },
    { id: 'conv-in', op: 'conv', label: 'conv_in', sub: 'conv 3×3 · 4 → C', subNum: 'conv 3×3 · 4 → {{cfg.C}}', x: LX, y: 3, w: CW, h: 7,
      tex: 'h = W_{in} * z_t', note: 'Una conv 3×3 lleva los 4 canales del latente a C = ' + q('cfg.C') + '. Su salida es también la primera skip.' },
    { id: 'timestep', op: 'io', label: 'Paso t', sub: 'un número', x: 61, y: 1, w: 28, h: 6, note: 'El índice del paso de ruido (0…' + q('cfg.trainSteps') + ' − 1 en el entrenamiento; los del sampler al generar).' },
    { id: 'time-embed', op: 'embed', label: 'Embedding del tiempo', sub: 'seno/coseno C → MLP 4C', subNum: 'sinusoidal {{cfg.C}} → MLP → {{tensor.temb.shape}}', x: 59, y: 9.5, w: 32, h: 8,
      tex: 'e_t = W_2\\,\\mathrm{SiLU}(W_1\\,\\mathrm{PE}(t) + b_1) + b_2', note: 'Como la codificación de posición del Transformer, pero sobre t: cosenos y senos de ' + q('quantities.freqCount') + ' frecuencias (' + q('cfg.C') + ' valores), y un MLP de 2 capas que lo lleva a 4C. Ese vector e_t llega a TODOS los bloques ResNet (línea punteada), que lo proyectan y lo suman por canal: así cada bloque sabe cuánto ruido hay.' },
    { id: 'conv-out', op: 'conv', label: 'conv_out', sub: 'GN → SiLU → conv 3×3 · C → 4', subNum: 'GN → SiLU → conv 3×3 · {{cfg.C}} → 4', x: RX, y: 3, w: CW, h: 7,
      tex: '\\hat\\varepsilon = W_{out} * \\mathrm{SiLU}(\\mathrm{GN}(h))', note: 'Vuelve de C canales a los 4 del latente: la predicción del ruido tiene la misma forma que z_t.' },
    { id: 'eps', op: 'io', modality: 'lat', label: 'ε̂', sub: 'predicho', x: 135, y: 2, w: 14, h: 9, note: 'La predicción del ruido, ' + q('tensor.eps-hat.shape') + '.' },
    { id: 'mid', op: 'conv', style: 'block', label: 'Mid', sub: 'H/64 · 4C · Res, Tr, Res', subNum: '{{tensor.mid-res2-out.shape}} · Res, Tr, Res', mini: { items: [RES, TR, RES] }, x: 58, y: 86, w: 34, h: NH,
      note: 'El fondo de la U (' + q('tensor.mid-res2-out.shape') + '): ResNet, bloque transformer (self- y cross-attention con el texto, sobre ' + q('tensor.mid-attn-x-out.shape') + ' tokens) y ResNet.' },
    { id: 'text', op: 'io', modality: 'txt', label: 'Texto c', sub: 'K, V', x: 1, y: 94, w: 15, h: 9, note: 'El texto codificado por CLIP, ' + q('tensor.text-emb.shape') + ': llega a cada bloque transformer por cross-attention (doble línea): K y V salen del texto, Q de la imagen.' },
  ];
  const DOWN_MINI = [[RES, TR, RES, TR, DOWN], [RES, TR, RES, TR, DOWN], [RES, TR, RES, TR, DOWN], [RES, RES]];
  const UP_MINI = [[RES, RES, RES, UP], [RES, TR, RES, TR, RES, TR, UP], [RES, TR, RES, TR, RES, TR, UP], [RES, TR, RES, TR, RES, TR]];
  // tensor de salida de cada nivel (para el sub numérico) y su forma simbólica
  const LVT = ['d1-attn2-out', 'd2-attn2-out', 'd3-attn2-out', 'd4-res2-out'], LVS = ['H/8 · C', 'H/16 · 2C', 'H/32 · 4C', 'H/64 · 4C'];
  const UPT = ['u4-attn3-out', 'u3-attn3-out', 'u2-attn3-out', 'u1-res3-out'];
  for (let k = 0; k < 4; k++) {
    unetNodes.push({ id: 'down-' + (k + 1), op: 'conv', style: 'block', label: 'Down ' + (k + 1), sub: LVS[k] + (k < 3 ? ' · 2 × (Res + Tr), ↓' : ' · 2 × Res'), subNum: '{{tensor.' + LVT[k] + '.shape}}' + (k < 3 ? ' · 2 × (Res + Tr), ↓' : ' · 2 × Res'), mini: { items: DOWN_MINI[k] },
      expand: k === 0 ? 'sd-transformer-block' : k === 1 ? 'sd-resblock' : undefined, x: LX, y: LV[k], w: CW, h: NH, note: levelNote(k, true) + (k === 0 ? ' Ábrelo para ver su primer bloque transformer.' : k === 1 ? ' Ábrelo para ver su primer bloque ResNet (el que dobla los canales).' : '') });
    unetNodes.push({ id: 'up-' + (4 - k), op: 'conv', style: 'block', label: 'Up ' + (4 - k), sub: LVS[k] + (k < 3 ? ' · 3 × (Res + Tr)' + (k > 0 ? ', ↑' : '') : ' · 3 × Res, ↑'), subNum: '{{tensor.' + UPT[k] + '.shape}}' + (k < 3 ? ' · 3 × (Res + Tr)' + (k > 0 ? ', ↑' : '') : ' · 3 × Res, ↑'), mini: { items: UP_MINI[3 - k] },
      x: RX, y: LV[k], w: CW, h: NH, note: levelNote(k, false) });
  }
  const DOWN_OUT = ['d1-down-out', 'd2-down-out', 'd3-down-out'];
  const UP_OUT = ['u1-up-out', 'u2-up-out', 'u3-up-out'];
  const SKIP = ['d1-attn2-out', 'd2-attn2-out', 'd3-attn2-out', 'd4-res2-out'];
  const unetEdges = [
    { from: 'zt', to: 'conv-in', kind: 'data', tensor: 'z-t', label: false },
    { from: 'conv-in', to: 'down-1', kind: 'data', tensor: 'h-in', labelSide: 'right' },
    { from: 'down-1', to: 'down-2', kind: 'data', tensor: DOWN_OUT[0], labelSide: 'right' },
    { from: 'down-2', to: 'down-3', kind: 'data', tensor: DOWN_OUT[1], labelSide: 'right' },
    { from: 'down-3', to: 'down-4', kind: 'data', tensor: DOWN_OUT[2], labelSide: 'right' },
    { from: 'down-4', to: 'mid', kind: 'data', tensor: 'd4-res2-out', fromSide: 'bottom', toSide: 'left', labelSide: 'below', labelSeg: 1 },
    { from: 'mid', to: 'up-1', kind: 'data', tensor: 'mid-res2-out', fromSide: 'right', toSide: 'bottom', labelSide: 'below', labelSeg: 0 },
    { from: 'up-1', to: 'up-2', kind: 'data', tensor: UP_OUT[0], labelSide: 'left' },
    { from: 'up-2', to: 'up-3', kind: 'data', tensor: UP_OUT[1], labelSide: 'left' },
    { from: 'up-3', to: 'up-4', kind: 'data', tensor: UP_OUT[2], labelSide: 'left' },
    { from: 'up-4', to: 'conv-out', kind: 'data', tensor: 'u4-attn3-out', labelSide: 'left' },
    { from: 'conv-out', to: 'eps', kind: 'data', tensor: 'eps-hat', label: false },
    { from: 'timestep', to: 'time-embed', kind: 'control' },
  ];
  for (let k = 0; k < 4; k++) {
    unetEdges.push({ from: 'down-' + (k + 1), to: 'up-' + (4 - k), kind: 'skip', tensor: SKIP[k], fromSide: 'right', toSide: 'left', fromAt: 0.3, toAt: 0.3, labelSide: 'above', labelT: 0.25, tag: ['3 skips de C', '3 skips: 2C, 2C y C', '3 skips: 4C, 4C y 2C', '3 skips de 4C'][k], tagStyle: 'plain', tagSide: 'on', tagT: 0.78 });
    unetEdges.push({ from: 'time-embed', to: 'down-' + (k + 1), kind: 'control', fromSide: 'bottom', toSide: 'right', toAt: 0.78, via: [[TX, LV[k] + 7.8]] });
    unetEdges.push({ from: 'time-embed', to: 'up-' + (4 - k), kind: 'control', fromSide: 'bottom', toSide: 'left', toAt: 0.78, via: [[TX, LV[k] + 7.8]] });
  }
  unetEdges.push({ from: 'time-embed', to: 'mid', kind: 'control', fromSide: 'bottom', toSide: 'top' });
  for (let k = 0; k < 3; k++) {
    unetEdges.push({ from: 'text', to: 'down-' + (k + 1), kind: 'cross', tensor: 'text-emb', fromSide: 'top', toSide: 'left', fromAt: 0.47, toAt: 0.7, via: [[8, LV[k] + 7]], label: k === 2 ? undefined : false, labelSide: 'right', labelSeg: 0, labelT: 0.62, tag: k === 2 ? 'K,V' : false, tagT: 0.86, tagSeg: 0 });
    unetEdges.push({ from: 'text', to: 'up-' + (k + 2), kind: 'cross', tensor: 'text-emb', fromSide: 'bottom', toSide: 'right', fromAt: 0.6, toAt: 0.7, via: [[10, 105.5], [144, 105.5], [144, LV[2 - k] + 7]], label: false, tag: false });
  }
  unetEdges.push({ from: 'text', to: 'mid', kind: 'cross', tensor: 'text-emb', fromSide: 'right', toSide: 'bottom', fromAt: 0.5, via: [[75, 98.5]], label: false, tag: false });
  register(Object.assign({
    id: 'sd-unet', model: 'stable-diffusion', config: C, configs: UNET_CFGS, kind: 'arch', title: 'U-Net de SD 1.5',
    parent: 'sd-overview', parentNode: 'unet',
    caption: 'La U: a la izquierda baja de ' + q('tensor.h-in.shape') + ' a ' + q('tensor.d4-res2-out.shape') + ' (resolución a la mitad y canales al doble por nivel); abajo, el bloque medio; a la derecha sube de vuelta. Las skips (raya-punto) cruzan la U: cada nivel de subida concatena 3 tensores del nivel de bajada de su misma resolución (en los niveles 2 y 3, uno de ellos con la mitad de canales: la etiqueta lo dice). El paso t (punteado, por el centro) llega a todos los niveles; el texto (doble línea, por fuera) solo a los que tienen bloques transformer (Res = ResNet, Tr = transformer).',
    grid: { w: 150, h: 107 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['zt', 'conv-in', 'down-1', 'down-2'],   // a 375 px: la bajada legible (se arrastra para ver la subida)
    edgeLegend: { control: 'Tiempo e_t: llega a cada bloque ResNet' },
    nodes: unetNodes, edges: unetEdges,
    tensors: [
      { id: 'd3-down-out', at: { edge: 'down-3>down-4' }, show: 'both' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b2) bloque transformer (d1-attn1, 64×64)
  const TB = 'd1-attn1';
  const tb = (n, extra) => Object.assign({ scope: TB }, extra, { id: n });
  register(Object.assign({
    id: 'sd-transformer-block', model: 'stable-diffusion', config: C, configs: UNET_CFGS, kind: 'arch', title: 'Bloque transformer (Down 1, el primero)',
    parent: 'sd-unet', parentNode: 'down-1',
    caption: 'El bloque transformer de la U-Net, en el primer nivel (' + q('tensor.d1-res1-out.shape') + '): la rejilla se vuelve una secuencia de ' + q('metrics.selfAttnTokens') + ' tokens y pasa por tres sub-bloques pre-LN con residual: self-attention (los parches entre sí), cross-attention (Q de la imagen, K y V del texto: así entra el prompt) y una FF GEGLU. Una residual externa rodea todo el bloque.',
    grid: { w: 72, h: 152 }, direction: 'tb', maxCrossings: 0,
    nodes: [
      tb('in', { op: 'io', modality: 'lat', label: 'Entrada x', sub: 'rejilla H×W×C', x: 22, y: 1, w: 26, h: 7, note: 'La salida del bloque ResNet anterior: ' + q('tensor.d1-res1-out.shape') + '.' }),
      tb('gn', { op: 'norm', label: 'GroupNorm', sub: '32 grupos', costOf: 'gn', x: 23, y: 12, w: 24, h: 6, note: 'Normaliza por grupos de canales (32), como en el resto de la U-Net.' }),
      tb('proj-in', { op: 'conv', label: 'proj_in + a tokens', sub: 'conv 1×1 · H×W → N tokens', costOf: 'proj-in', x: 20, y: 22, w: 30, h: 7, tex: 'X = \\mathrm{flatten}(W_{in} * \\mathrm{GN}(x)) \\in \\mathbb{R}^{N\\times C}', note: 'Una conv 1×1 (una matriz C × C por posición) y la rejilla se aplana: cada posición del latente es un token. En este nivel son ' + q('metrics.selfAttnTokens') + ' tokens.' }),
      tb('norm1', { op: 'norm', label: 'LayerNorm 1', costOf: 'norm1', x: 23, y: 34, w: 24, h: 5, note: 'Pre-LN del primer sub-bloque.' }),
      tb('self-attn', { op: 'attn', label: 'Self-attention', sub: 'h cabezas · los tokens entre sí', heads: 'h', costOf: 'self-attn', x: 18, y: 43, w: 34, h: 8,
        tex: '\\mathrm{softmax}\\!\\big(QK^\\top/\\sqrt{d_h}\\big)V,\\; Q, K, V = XW_{Q,K,V}', note: 'Atención entre las ' + q('metrics.selfAttnTokens') + ' posiciones de la imagen (sin sesgo en Q, K, V). Es la parte cara del bloque: la matriz de scores tiene N² entradas por cabeza (' + q('metrics.selfAttnScoreBytes') + ' a 16 bits si se materializa; FlashAttention la evita) y crece con la cuarta potencia del lado de la imagen.' }),
      tb('res1', { op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', costOf: 'res1', x: 33, y: 55, w: 4, h: 4, note: 'Suma la entrada del sub-bloque.' }),
      tb('norm2', { op: 'norm', label: 'LayerNorm 2', costOf: 'norm2', x: 23, y: 63, w: 24, h: 5, note: 'Pre-LN de la cross-attention.' }),
      tb('cross-attn', { op: 'fuse', label: 'Cross-attention', sub: 'Q: imagen · K, V: texto', heads: 'h', costOf: 'cross-attn', x: 18, y: 72, w: 34, h: 8,
        tex: '\\begin{aligned} &\\mathrm{softmax}\\!\\big(Q K_c^\\top/\\sqrt{d_h}\\big)V_c \\\\ &Q = XW_Q,\\; K_c = cW_K,\\; V_c = cW_V \\end{aligned}', note: 'Cada posición de la imagen (query) mira los ' + q('cfg.T') + ' tokens del texto (keys y values, proyectados de ' + q('cfg.Dtxt') + ' a C). Así entra el prompt; con el prompt vacío, esta misma capa da la predicción incondicional de CFG. La matriz es N × T: mucho más barata que la self-attention.' }),
      tb('res2', { op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', costOf: 'res2', x: 33, y: 84, w: 4, h: 4, note: 'Suma la entrada de la cross-attention.' }),
      tb('norm3', { op: 'norm', label: 'LayerNorm 3', costOf: 'norm3', x: 23, y: 92, w: 24, h: 5, note: 'Pre-LN de la FF.' }),
      tb('ff-geglu', { op: 'mlp', label: 'FF GEGLU', sub: 'C → 8C (valor y compuerta) → 4C → C', costOf: 'ff-geglu', x: 16, y: 101, w: 38, h: 8,
        tex: '\\mathrm{FF}(x) = \\big(xW_h \\odot \\mathrm{GELU}(xW_g)\\big)W_2', note: 'Una FF con compuerta: la primera matriz da 2·4C (valor y compuerta), se multiplican tras GELU y la segunda vuelve a C. Como SwiGLU pero con GELU.' }),
      tb('res3', { op: 'tensorop', shape: 'add', label: 'Residual 3', labelPos: 'right', costOf: 'res3', x: 33, y: 113, w: 4, h: 4, note: 'Suma la entrada de la FF.' }),
      tb('proj-out', { op: 'conv', label: 'a rejilla + proj_out', sub: 'N tokens → H×W · conv 1×1', costOf: 'proj-out', x: 20, y: 121, w: 30, h: 7, note: 'Los tokens vuelven a la rejilla y una conv 1×1 cierra el bloque.' }),
      tb('res-out', { op: 'tensorop', shape: 'add', label: 'Residual externa', labelPos: 'right', costOf: 'res', x: 33, y: 133, w: 4, h: 4, note: 'Suma la entrada del bloque entero (antes de la GroupNorm): el bloque transformer es un residual más dentro de la U.' }),
      tb('out', { op: 'io', modality: 'lat', label: 'Salida', sub: 'misma forma', x: 22, y: 143, w: 26, h: 7, note: 'Misma forma que la entrada: ' + q('tensor.d1-attn1-out.shape') + '.' }),
      { id: 'text', op: 'io', modality: 'txt', label: 'Texto c', sub: 'T × D_t', x: 57, y: 60, w: 14, h: 8, note: 'El texto de CLIP, ' + q('tensor.text-emb.shape') + '. El mismo para todos los bloques transformer de la U-Net (y para todos los pasos).' },
    ],
    edges: [
      { from: 'in', to: 'gn', kind: 'data', tensor: TB + '-h-gn', label: false },
      { from: 'in', to: 'res-out', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[35, 10], [4, 10], [4, 135]], dot: true },
      { from: 'gn', to: 'proj-in', kind: 'data', tensor: TB + '-h-gn', labelSide: 'right' },
      { from: 'proj-in', to: 'norm1', kind: 'data', tensor: TB + '-x0', labelSide: 'right' },
      { from: 'proj-in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[35, 31.5], [10, 31.5], [10, 57]], dot: true },
      { from: 'norm1', to: 'self-attn', kind: 'data', tensor: TB + '-h-n1', label: false },
      { from: 'self-attn', to: 'res1', kind: 'data', tensor: TB + '-sa-o', label: false },
      { from: 'res1', to: 'norm2', kind: 'data', tensor: TB + '-r1', label: false },
      { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[35, 61], [10, 61], [10, 86]], dot: true },
      { from: 'norm2', to: 'cross-attn', kind: 'data', tensor: TB + '-h-n2', label: false },
      { from: 'text', to: 'cross-attn', kind: 'cross', tensor: 'text-emb', fromSide: 'bottom', toSide: 'right', via: [[64, 76]], labelSide: 'right', labelSeg: 0, tagT: 0.5, tagSeg: 1 },
      { from: 'cross-attn', to: 'res2', kind: 'data', tensor: TB + '-ca-o', label: false },
      { from: 'res2', to: 'norm3', kind: 'data', tensor: TB + '-r2', label: false },
      { from: 'res2', to: 'res3', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[35, 90], [10, 90], [10, 115]], dot: true },
      { from: 'norm3', to: 'ff-geglu', kind: 'data', tensor: TB + '-h-n3', label: false },
      { from: 'ff-geglu', to: 'res3', kind: 'data', tensor: TB + '-ff-o', label: false },
      { from: 'res3', to: 'proj-out', kind: 'data', tensor: TB + '-x-out', labelSide: 'right' },
      { from: 'proj-out', to: 'res-out', kind: 'data', tensor: TB + '-h-out', labelSide: 'right' },
      { from: 'res-out', to: 'out', kind: 'data', tensor: TB + '-out', labelSide: 'right' },
    ],
    tensors: [
      { id: TB + '-x0', at: { edge: 'proj-in>norm1' }, show: 'both' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b3) bloque ResNet (d2-res1: 320 → 640, con atajo conv 1×1)
  const RB = 'd2-res1';
  const rb = (n, extra) => Object.assign({ scope: RB, costOf: n }, extra, { id: n });
  register(Object.assign({
    id: 'sd-resblock', model: 'stable-diffusion', config: C, configs: UNET_CFGS, kind: 'arch', title: 'Bloque ResNet con tiempo (Down 2, el primero)',
    parent: 'sd-unet', parentNode: 'down-2',
    caption: 'El bloque ResNet de la U-Net: GroupNorm → SiLU → conv 3×3, se suma el tiempo (e_t proyectado a C_out canales, el mismo valor en todas las posiciones), GroupNorm → SiLU → conv 3×3, y la residual. Este es el primero de Down 2: pasa de C a 2C canales, así que el atajo es una conv 1×1.',
    grid: { w: 66, h: 110 }, direction: 'tb', maxCrossings: 0,
    edgeLegend: { control: 'Tiempo e_t (vector de 4C): el mismo para todos los ResNet' },
    nodes: [
      rb('in', { op: 'io', modality: 'lat', label: 'Entrada x', sub: 'H×W×C_in', x: 17, y: 1, w: 26, h: 7, note: 'La salida del downsample de Down 1: ' + q('tensor.d1-down-out.shape') + '.' }),
      rb('gn1', { op: 'norm', label: 'GroupNorm 1', sub: '32 grupos', x: 18, y: 12, w: 24, h: 6, note: 'Normaliza por grupos de 32 canales: no depende del lote (BatchNorm sí), lo que importa con lotes chicos de imágenes grandes.' }),
      rb('silu1', { op: 'mlp', shape: 'pill', label: 'SiLU', x: 22, y: 22, w: 16, h: 5, note: 'x·σ(x).' }),
      rb('conv1', { op: 'conv', label: 'Conv 3×3 (1)', sub: 'C_in → C_out', x: 18, y: 31, w: 24, h: 7, tex: 'h_1 = W_1 * \\mathrm{SiLU}(\\mathrm{GN}(x))', note: 'La primera conv cambia los canales (aquí de ' + q('cfg.C') + ' a 2C).' }),
      { id: 'time-add', op: 'tensorop', shape: 'add', label: '+ tiempo', labelPos: 'left', ops: [RB + '-time-add'], opsExact: true, x: 28, y: 43, w: 4, h: 4, note: 'Suma el tiempo proyectado (un vector de C_out) en cada una de las H·W posiciones (broadcast).' },
      { id: 'temb', op: 'io', label: 'e_t', sub: 'del embedding', x: 46, y: 30, w: 18, h: 7, note: 'El embedding del tiempo, ' + q('tensor.temb.shape') + ': el mismo para todos los bloques ResNet de la U-Net.' },
      rb('time-proj', { op: 'embed', label: 'Proy. del tiempo', sub: 'SiLU → Linear 4C → C_out', ops: [RB + '-temb-act', RB + '-time-proj'], opsExact: true, x: 42, y: 41.5, w: 23, h: 7, tex: 'W_t\\,\\mathrm{SiLU}(e_t) + b_t', note: 'Cada bloque ResNet tiene su propia proyección del tiempo: SiLU y una Linear de 4C a sus C_out canales.' }),
      rb('gn2', { op: 'norm', label: 'GroupNorm 2', x: 18, y: 52, w: 24, h: 6, note: 'Segunda GroupNorm.' }),
      rb('silu2', { op: 'mlp', shape: 'pill', label: 'SiLU', x: 22, y: 62, w: 16, h: 5, note: 'x·σ(x).' }),
      rb('conv2', { op: 'conv', label: 'Conv 3×3 (2)', sub: 'C_out → C_out', x: 18, y: 71, w: 24, h: 7, note: 'La segunda conv mantiene los canales.' }),
      rb('skip', { op: 'conv', label: 'Atajo', sub: 'conv 1×1', x: 1, y: 52, w: 13, h: 7, tex: 'W_s * x', note: 'Como cambian los canales (C_in ≠ C_out), el atajo no puede ser la identidad: una conv 1×1 los iguala. Cuando no cambian, es la identidad.' }),
      rb('res', { op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'right', x: 28, y: 84, w: 4, h: 4, tex: 'y = W_s * x + h_2', note: 'Atajo + rama.' }),
      rb('out', { op: 'io', modality: 'lat', label: 'Salida', sub: 'H×W×C_out', x: 17, y: 95, w: 26, h: 7, note: 'Va al bloque transformer del mismo par: ' + q('tensor.d2-res1-out.shape') + '.' }),
    ],
    edges: [
      { from: 'in', to: 'gn1', kind: 'data', tensor: 'd1-down-out', labelSide: 'right', labelT: 0.6 },
      { from: 'in', to: 'skip', kind: 'data', tensor: 'd1-down-out', fromSide: 'left', toSide: 'top', toAt: 0.85, label: false },
      { from: 'gn1', to: 'silu1', kind: 'data', tensor: RB + '-h-gn1', label: false },
      { from: 'silu1', to: 'conv1', kind: 'data', tensor: RB + '-h-act1', label: false },
      { from: 'conv1', to: 'time-add', kind: 'data', tensor: RB + '-h-conv1', labelSide: 'left' },
      { from: 'temb', to: 'time-proj', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.565 },
      { from: 'time-proj', to: 'time-add', kind: 'data', tensor: RB + '-e-proj', labelSide: 'below', labelT: 0.45 },
      { from: 'time-add', to: 'gn2', kind: 'data', tensor: RB + '-h-time', label: false },
      { from: 'gn2', to: 'silu2', kind: 'data', tensor: RB + '-h-gn2', label: false },
      { from: 'silu2', to: 'conv2', kind: 'data', tensor: RB + '-h-act2', label: false },
      { from: 'conv2', to: 'res', kind: 'data', tensor: RB + '-h-conv2', label: false },
      { from: 'skip', to: 'res', kind: 'data', tensor: RB + '-skip', fromSide: 'bottom', toSide: 'left', labelSide: 'left', labelSeg: 0 },
      { from: 'res', to: 'out', kind: 'data', tensor: RB + '-out', labelSide: 'right' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ entrenamiento: un paso
  register({
    id: 'sd-training', model: 'stable-diffusion', config: CT, configs: [CT], configsNote: 'un paso de entrenamiento', kind: 'arch', title: 'Stable Diffusion — un paso de entrenamiento',
    page: 'stable-diffusion', section: 'entrenamiento',
    caption: 'Entrenar es regresión: la imagen pasa una vez por el encoder del VAE (congelado) → z₀; se elige un t al azar y se ruidea de un salto con ε; la U-Net (lo único que entrena) recibe z_t, t y el texto, y su predicción ε̂ se compara con el ε verdadero (MSE). Sin bucle: un paso de ruido por ejemplo.',
    grid: { w: 160, h: 54 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['unet', 'loss'],
    edgeLegend: { control: 'Control: el paso t (un número)' },
    nodes: [
      { id: 'image', op: 'io', image: true, imageGrid: 0, label: 'Imagen', x: 1, y: 1, w: 13, h: 15, note: 'Una imagen del dataset (LAION en SD), ' + qt('tensor.image.shape') + '.' },
      { id: 'vae-encoder', op: 'conv', train: 'frozen', label: 'Encoder del VAE', sub: 'píxeles → latente', x: 22, y: 4, w: 25, h: 10,
        tex: 'z_0 = s\\cdot(\\mu + \\sigma\\odot\\epsilon),\\; s = 0.18215', note: 'El encoder del autoencoder, ya entrenado y congelado: baja ' + qt('cfg.f') + '× por lado, da media y varianza por posición, se muestrea y se escala para que los latentes tengan varianza ≈ 1. En la práctica los latentes del dataset se pueden precalcular.' },
      { id: 'add-noise', op: 'tensorop', shape: 'rect', label: 'Agregar ruido', sub: 'en un t al azar', ops: ['add-noise'], opsExact: true, x: 58, y: 4, w: 26, h: 10,
        tex: 'z_t = \\sqrt{\\bar\\alpha_t}\\,z_0 + \\sqrt{1-\\bar\\alpha_t}\\,\\varepsilon', note: 'Se salta directo al paso t (no hace falta recorrer los anteriores): con ᾱ_t de la agenda de ' + qt('cfg.trainSteps') + ' pasos. t se elige uniforme para cada ejemplo.' },
      { id: 'unet', op: 'conv', train: 'trained', label: 'U-Net', sub: 'ε̂(z_t, t, c)', x: 96, y: 3, w: 30, h: 12,
        note: 'La misma U-Net del muestreo, y la única que recibe gradiente. Una pasada hacia adelante: ' + qt('metrics.unetMacs') + '.' },
      { id: 'loss', op: 'head', label: 'Pérdida', sub: 'MSE(ε̂, ε)', ops: ['loss'], opsExact: true, x: 138, y: 4, w: 21, h: 10,
        tex: '\\mathcal{L} = \\lVert \\varepsilon - \\varepsilon_\\theta(z_t, t, c) \\rVert^2', note: 'El "L_simple" de DDPM: error cuadrático entre el ruido verdadero y el predicho, promediado sobre los ' + qt('metrics.latentValues') + ' valores del latente.' },
      { id: 'eps', op: 'io', modality: 'lat', label: 'Ruido ε', sub: '~ N(0, I)', x: 56, y: 23, w: 16, h: 8, note: 'Ruido nuevo para cada ejemplo, con la forma del latente. Es a la vez la entrada (para ruidear) y el objetivo de la regresión.' },
      { id: 'timestep', op: 'io', label: 't al azar', sub: 'U{0, …, T−1}', x: 75, y: 23, w: 16, h: 8, note: 'El paso de ruido, uniforme entre 0 y ' + qt('cfg.trainSteps') + ' − 1: la misma red aprende a quitar poco y mucho ruido.' },
      { id: 'prompt', op: 'io', modality: 'txt', label: 'Descripción', sub: '10 % vacía', x: 76, y: 38, w: 17, h: 8, note: 'El texto que acompaña a la imagen. Una fracción de las veces (≈ 10 % en SD) se cambia por el vacío: así la misma U-Net aprende también la predicción incondicional que usa CFG.' },
      { id: 'text-encoder', op: 'attn', modality: 'txt', train: 'frozen', label: 'Encoder de texto', sub: 'CLIP', x: 98, y: 37, w: 26, h: 10, note: 'El encoder de texto de CLIP ViT-L/14, congelado en SD 1.x.' },
    ],
    tensors: [
      { id: 'z0', at: { edge: 'vae-encoder>add-noise' }, show: 'both' },
    ],
    edges: [
      { from: 'image', to: 'vae-encoder', kind: 'data', tensor: 'image', fromAt: 0.53, toAt: 0.5, label: false },
      { from: 'vae-encoder', to: 'add-noise', kind: 'data', tensor: 'z0', labelSide: 'below' },
      { from: 'add-noise', to: 'unet', kind: 'data', tensor: 'z-t', fromAt: 0.5, toAt: 0.5, labelSide: 'above' },
      { from: 'unet', to: 'loss', kind: 'data', tensor: 'eps-hat', toAt: 0.5, fromAt: 0.5, labelSide: 'above' },
      { from: 'eps', to: 'add-noise', kind: 'data', tensor: 'eps', fromSide: 'top', toSide: 'bottom', fromAt: 0.5, toAt: 0.231, label: false },
      { from: 'eps', to: 'loss', kind: 'data', tensor: 'eps', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[64, 51], [148.5, 51]], tag: 'objetivo', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.62, labelSide: 'above', labelSeg: 1, labelT: 0.3 },
      { from: 'timestep', to: 'add-noise', kind: 'control', fromSide: 'top', toSide: 'bottom', fromAt: 0.5, toAt: 0.77 },
      { from: 'timestep', to: 'unet', kind: 'control', fromSide: 'right', toSide: 'bottom', fromAt: 0.4, toAt: 0.2 },
      { from: 'prompt', to: 'text-encoder', kind: 'data', tensor: 'prompt-ids', label: false },
      { from: 'text-encoder', to: 'unet', kind: 'cross', tensor: 'text-emb', fromSide: 'top', toSide: 'bottom', fromAt: 0.65, toAt: 0.63, labelSide: 'right', tagT: 0.5 },
    ],
    walks: [
      { id: 'training', label: 'Recorrido: un paso de entrenamiento', steps: [
        { nodes: ['image', 'vae-encoder'], edges: ['image>vae-encoder', 'vae-encoder>add-noise'], tensors: ['z0'],
          text: 'La imagen (' + qt('tensor.image.shape') + ') pasa por el encoder del VAE, congelado: <b>' + qt('tensor.z0.shape') + '</b>. Cuesta ' + qt('metrics.vaeEncoderMacs') + ', y como no cambia, los latentes se pueden precalcular una vez para todo el dataset.' },
        { nodes: ['eps', 'timestep', 'add-noise'], edges: ['eps>add-noise', 'timestep>add-noise', 'add-noise>unet'], tensors: ['eps', 'z-t'],
          text: 'Se sortean un t uniforme y un ruido ε de la forma del latente, y se ruidea de un salto: z_t = √ᾱ_t·z₀ + √(1−ᾱ_t)·ε (<b>' + qt('tensor.z-t.shape') + '</b>). No hay bucle: un paso de ruido por ejemplo.' },
        { nodes: ['prompt', 'text-encoder'], edges: ['prompt>text-encoder', 'text-encoder>unet'], tensors: ['text-emb'],
          text: 'La descripción de la imagen pasa por el encoder de texto (congelado): <b>' + qt('tensor.text-emb.shape') + '</b>. Una fracción de las veces se usa la descripción vacía, para que la red aprenda también sin condición (lo que después pide CFG).' },
        { nodes: ['unet'], edges: ['add-noise>unet', 'timestep>unet', 'text-encoder>unet', 'unet>loss'], tensors: ['z-t', 'eps-hat'],
          text: 'La U-Net, lo único que entrena, predice el ruido: <b>' + qt('tensor.eps-hat.shape') + '</b>, en una pasada de ' + qt('metrics.unetMacs') + '.' },
        { nodes: ['loss', 'eps'], edges: ['unet>loss', 'eps>loss'], tensors: ['eps-hat', 'eps'],
          text: 'La pérdida es un MSE entre ε̂ y el ε que se usó: regresión pura. El gradiente vuelve solo a la U-Net. Un paso cuesta ≈ ' + qt('metrics.trainStepMacsApprox') + ' (adelante + atrás ≈ 3× la U-Net, más el encoder del VAE y el de texto: estimación del calculador).' },
      ] },
    ],
    legend: 'auto',
  });

})(typeof window !== 'undefined' ? window : globalThis);
