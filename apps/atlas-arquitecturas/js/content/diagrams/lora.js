/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/lora.js
   Diagramas de LoRA / QLoRA (SPEC §7.2, ids de §22.1), config canónica lora-llama3-8b-r16, modelo `lora` (js/arch/finetune.js):
     lora-overview     UNA lineal adaptada (W_Q de Llama 3 8B): x → W₀ congelada (grande, la matriz a escala) en paralelo con el
                       atajo de rango r: dropout → A (r × d_in, gaussiana) → B (d_out × r, ceros) → × α/r → suma → h. Las matrices
                       se dibujan a la MISMA escala (W cuadrada, A y B tiras de ancho r) y el glifo de A·x (T × r) se ve fino al
                       lado del de x (T × D): el cuello de botella. Abajo, los parámetros de W₀ frente a A + B (barras, del
                       calculador). W₀ se abre en lora-placement; "Memoria" se abre en qlora-memory.
       lora-placement  un bloque decoder con sus 7 lineales (ids de F6), todas congeladas (rayado); la píldora "+ B·A" se enciende
                       en las que la config adapta (targets 2 = W_Q, W_V · 4 = atención · 7 = todas), con sus parámetros por capa.
       qlora-memory    memoria de entrenamiento por método (FT completo / LoRA / QLoRA, mismos B, T y optimizador): base, adapters,
                       gradientes, optimizador y activaciones, con las líneas de 24 / 48 / 80 GB (todo de ATLAS.Arch.metrics).
   Notas, costNotes y captions con claves SIN prefijo de config ({{cfg.x}}, {{metrics.x}}, {{quantities.x}}): siguen la config dibujada;
   el recorrido usa la canónica (q(), lo dice su rótulo).
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'lora-llama3-8b-r16';
  const q = (k) => '{{' + C + '.' + k + '}}';
  // configs con adaptadores (el FT completo no tiene A ni B: la vista de la lineal y la del bloque no aplican)
  const LORA = ['lora-llama3-8b-r16', 'lora-llama3-8b-r16-qv', 'lora-llama3-8b-r64', 'qlora-llama3-8b-r16'];
  const PAGE = { page: 'lora', section: 'diagrama' };
  const GB = [{ v: 24e9, label: '24 GB' }, { v: 48e9, label: '48 GB' }, { v: 80e9, label: '80 GB' }];

  // ------------------------------------------------------------------ (a) una lineal con LoRA
  ATLAS.registerDiagram(Object.assign({
    id: 'lora-overview', model: 'lora', config: C, configs: LORA, kind: 'arch', title: 'LoRA — una lineal adaptada',
    caption: 'Una lineal de un LLM (aquí W_Q de Llama 3 8B) con LoRA. Arriba, el camino original: x pasa por W₀, congelada (rayado). Abajo, el atajo en paralelo que SÍ entrena: A baja x de d_in a r (la tira fina: el cuello de rango r), B la sube a d_out, se escala por α/r y se suma: h = W₀x + (α/r)·BAx. B empieza en cero, así que al principio h = W₀x. Las tres matrices están a la misma escala; las barras de abajo comparan sus parámetros. Abre W₀ para ver qué lineales del bloque se adaptan y "Memoria" para ver qué ocupa la GPU.',
    grid: { w: 124, h: 75 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['lora-a', 'lora-b'], mobileFocusPad: 2, blankCrop: true,
    legendText: { bars: 'Barras: parámetros por matriz, ancho proporcional (del calculador)', matrix: 'Matriz de pesos a escala (lineal, la misma en W₀, A y B): filas × columnas' },
    nodes: [
      { id: 'x', op: 'io', modality: 'txt', label: 'x', sub: 'entrada de W_Q', x: 1, y: 15, w: 13, h: 9,
        note: 'La entrada de la lineal: aquí, la salida de la RMSNorm de la atención (T × {{cfg.D}} por secuencia). La leen los DOS caminos.' },
      { id: 'w-frozen', op: 'embed', label: 'W₀ (congelada)', sub: 'd_out × d_in', subNum: '{{quantities.qDout}} × {{quantities.qDin}}', train: 'frozen', ops: ['q-proj'], opsExact: true,
        matrix: { rows: 'q.qDout', cols: 'q.qDin', ref: 'q.qDin', px: 64 }, expand: 'lora-placement', x: 28, y: 2, w: 40, h: 20,
        tex: 'W_0 x,\\quad W_0 \\in \\mathbb{R}^{d_{out}\\times d_{in}}',
        note: 'Los pesos preentrenados de W_Q ({{quantities.qDout}} × {{quantities.qDin}}), congelados: no reciben gradiente ni estado de optimizador (en QLoRA además se guardan en NF4 y se des-cuantizan a bf16 en cada matmul). El backward igual pasa POR ella (∂L/∂x = W₀ᵀg + …) para llegar a los adaptadores de las capas de abajo. Ábrela para ver qué lineales del bloque se adaptan.' },
      { id: 'dropout', op: 'tensorop', shape: 'pill', label: 'dropout', sub: 'p', subNum: 'p = {{cfg.p}}', ops: ['q-lora-dropout'], opsExact: true, x: 15, y: 44.5, w: 12, h: 7,
        note: 'El lora_dropout de PEFT: se aplica solo a la entrada del atajo (W₀ ve x sin dropout). Sin parámetros; en el entrenamiento guarda su copia y la máscara (memoria de activaciones).' },
      { id: 'lora-a', op: 'embed', label: 'A (baja a r)', sub: 'r × d_in · gaussiana', subNum: '{{cfg.r}} × {{quantities.qDin}} · gaussiana', train: 'trained', ops: ['q-lora-a'], opsExact: true,
        matrix: { rows: 'cfg.r', cols: 'q.qDin', ref: 'q.qDin', px: 64 }, x: 31, y: 40, w: 21, h: 16,
        tex: 'A x,\\quad A \\in \\mathbb{R}^{r\\times d_{in}}',
        note: 'La mitad de "bajada" del atajo: {{cfg.r}} × {{quantities.qDin}} ({{quantities.qAdapterParams}} parámetros entre A y B). Se inicializa al azar (PEFT: Kaiming uniforme; el paper dice gaussiana): si A y B empezaran en cero, ninguno recibiría gradiente.' },
      { id: 'lora-b', op: 'embed', label: 'B (sube)', sub: 'd_out × r · ceros', subNum: '{{quantities.qDout}} × {{cfg.r}} · ceros', train: 'trained', ops: ['q-lora-b'], opsExact: true,
        matrix: { rows: 'q.qDout', cols: 'cfg.r', ref: 'q.qDin', px: 64 }, x: 66, y: 40, w: 17, h: 16,
        tex: 'B (A x),\\quad B \\in \\mathbb{R}^{d_{out}\\times r},\\; B_0 = 0',
        note: 'La mitad de "subida": {{quantities.qDout}} × {{cfg.r}}. Empieza en CERO: BA = 0 y el modelo arranca exactamente igual que el preentrenado; en el primer paso solo se mueve B.' },
      { id: 'scale', op: 'tensorop', shape: 'mul', label: '× α/r', labelPos: 'below', sub: 'α/r', subNum: '{{cfg.alpha}}/{{cfg.r}} = {{cfg.scaling}}', ops: ['q-lora-scale'], opsExact: true, x: 90, y: 45.5, w: 5, h: 5,
        note: 'Una escala fija: α/r = {{cfg.alpha}}/{{cfg.r}}. Dividir por r deja la magnitud del delta parecida al cambiar r (con Adam, ≈ no re-ajustar el LR). Sin parámetros.' },
      { id: 'sum', op: 'tensorop', shape: 'add', label: 'Suma', labelPos: 'none', ops: ['q-lora-sum'], opsExact: true, x: 100, y: 10, w: 5, h: 5,
        tex: 'h = W_0 x + \\tfrac{\\alpha}{r} B A x',
        note: 'Los dos caminos se suman. En inferencia se FUSIONA: W′ = W₀ + (α/r)·BA es una sola matriz de la misma forma; el atajo desaparece y no cuesta latencia.' },
      { id: 'y', op: 'io', modality: 'txt', label: 'h', sub: 'Q (T × D)', x: 110, y: 8, w: 13, h: 9,
        note: 'La salida, con la forma de siempre: el resto del bloque no cambia.' },
      { id: 'params', op: 'io', label: 'W₀ frente a A + B', hideInBlank: true, x: 1, y: 60, w: 80, h: 14,
        bars: { unit: 'params', legend: false, labelW: 17, totalW: 9,
          rows: [
            { label: 'W₀ (congelada)', segs: [{ n: 'ops.q-proj.params', op: 'embed', frozen: true, label: 'W₀' }] },
            { label: 'A + B (entrenan)', segs: [{ n: ['ops.q-lora-a.params', 'ops.q-lora-b.params'], op: 'embed', label: 'A + B' }] },
          ],
          caption: 'r·(d_in + d_out) = {{quantities.qAdapterParams}} · todo el modelo: {{metrics.trainableParams}} entrenables ({{metrics.trainableShare}})' },
        note: 'Del calculador: W₀ tiene d_out·d_in = {{quantities.qDout}}·{{quantities.qDin}} parámetros y el atajo r·(d_in + d_out) = {{quantities.qAdapterParams}}. Con LoRA en {{quantities.targetsCount}} lineales por capa y {{cfg.L}} capas: {{metrics.trainableParams}} entrenables, {{metrics.trainableShare}} del total.' },
      { id: 'memory', op: 'io', label: 'Memoria del entrenamiento', sub: 'base · adapters · optimizador…', expand: 'qlora-memory', hideInBlank: true, x: 86, y: 63, w: 37, h: 9,
        note: 'Qué ocupa la GPU al entrenar con este método y con FT completo / QLoRA (mismos B, T y optimizador). Ábrelo.' },
    ],
    tensors: [
      { id: 'h-norm1', at: { edge: 'x>w-frozen' }, show: 'both' },
      { id: 'q-lora-a', at: { edge: 'lora-a>lora-b' }, show: 'both' },
    ],
    edges: [
      { from: 'x', to: 'w-frozen', kind: 'data', tensor: 'h-norm1', fromAt: 0.5, toAt: 0.875, labelSide: 'above', labelT: 0.5 },
      { from: 'x', to: 'dropout', kind: 'data', tensor: 'h-norm1', fromSide: 'bottom', toSide: 'left', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'dropout', to: 'lora-a', kind: 'data', tensor: 'q-drop', toAt: 0.5, label: false },
      { from: 'lora-a', to: 'lora-b', kind: 'data', tensor: 'q-lora-a', fromAt: 0.5, toAt: 0.5, labelSide: 'above', labelT: 0.5 },
      { from: 'lora-b', to: 'scale', kind: 'data', tensor: 'q-lora-b', fromAt: 0.5, label: false },
      { from: 'scale', to: 'sum', kind: 'data', tensor: 'q-lora-delta', fromSide: 'top', toSide: 'bottom', labelSide: 'right', labelSeg: 0, labelT: 0.6, blankHide: 'q-lora-b' },
      { from: 'w-frozen', to: 'sum', kind: 'data', tensor: 'q-base', fromAt: 0.525, labelSide: 'above', labelT: 0.5 },
      { from: 'sum', to: 'y', kind: 'data', tensor: 'q', toAt: 0.5, label: false },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (W_Q, LoRA r = 16)', steps: [
        { nodes: ['x', 'w-frozen'], edges: ['x>w-frozen', 'w-frozen>sum'], tensors: ['h-norm1', 'q-base'],
          text: 'x (<b>' + q('tensor.h-norm1.shape') + '</b>) pasa por W₀ (' + q('quantities.qDout') + ' × ' + q('quantities.qDin') + ', congelada) como siempre: <b>' + q('tensor.q-base.shape') + '</b>.' },
        { nodes: ['dropout', 'lora-a'], edges: ['x>dropout', 'dropout>lora-a', 'lora-a>lora-b'], tensors: ['q-drop', 'q-lora-a'],
          text: 'En paralelo, la misma x (con dropout p = ' + q('cfg.p') + ') baja por A a r = ' + q('cfg.r') + ': <b>' + q('tensor.q-lora-a.shape') + '</b>. Ese tensor fino es el cuello de botella.' },
        { nodes: ['lora-b', 'scale'], edges: ['lora-b>scale', 'scale>sum'], tensors: ['q-lora-b', 'q-lora-delta'],
          text: 'B la sube de vuelta: <b>' + q('tensor.q-lora-b.shape') + '</b>, y se escala por α/r = ' + q('cfg.alpha') + '/' + q('cfg.r') + '. Al principio B = 0: el delta vale cero.' },
        { nodes: ['sum', 'y'], edges: ['w-frozen>sum', 'scale>sum', 'sum>y'], tensors: ['q-base', 'q-lora-delta', 'q'],
          text: 'Se suman: h = W₀x + (α/r)·BAx, <b>' + q('tensor.q.shape') + '</b>, la misma forma que sin LoRA.' },
        { nodes: ['params'], edges: [], tensors: [],
          text: 'W₀ tiene ' + q('quantities.qDout') + '·' + q('quantities.qDin') + ' parámetros; A + B, ' + q('quantities.qAdapterParams') + '. En las 7 lineales de las ' + q('cfg.L') + ' capas: ' + q('metrics.trainableParams') + ' entrenables (' + q('metrics.trainableShare') + ').' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) dónde va LoRA en un bloque
  const LIN = (id, label, sub, subNum, x, y, extra) => Object.assign({ id, op: 'embed', label, sub, subNum, train: 'frozen', trainPill: false, ops: [id], opsExact: true,
    adapter: { ops: [id.replace('-proj', '') + '-lora-a', id.replace('-proj', '') + '-lora-b'] }, x, y, w: 21, h: 7 }, extra || {});
  ATLAS.registerDiagram(Object.assign({
    id: 'lora-placement', model: 'lora', config: C, configs: LORA, configsNote: 'el FT completo entrena todo: no hay adaptadores', kind: 'arch', title: 'Dónde va LoRA en un bloque decoder',
    parent: 'lora-overview', parentNode: 'w-frozen',
    caption: 'Un bloque de Llama 3 8B con sus 7 lineales, todas congeladas (rayado). La píldora "+ B·A" marca las que la config adapta, con los parámetros de su adaptador por capa: el paper de LoRA usó solo W_Q y W_V; las recetas de QLoRA y PEFT, las 7. Arriba la atención, abajo la FFN SwiGLU (se lee de derecha a izquierda); las normas, la atención y las sumas no tienen adaptador.',
    grid: { w: 114, h: 60 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['q-proj', 'v-proj', 'attn'], mobileFocusPad: 2,
    legendText: { adapterOn: 'Adaptador LoRA (B·A, entrenable) en esa lineal; el número: sus parámetros por capa', adapterOff: 'Sin adaptador con esta config: la lineal queda congelada tal cual' },
    nodes: [
      { id: 'in', op: 'io', modality: 'txt', label: 'x_{ℓ−1}', x: 1, y: 10, w: 10, h: 7, note: 'La entrada del bloque (la salida del bloque anterior).' },
      { id: 'norm1', op: 'norm', label: 'RMSNorm', ops: ['norm1'], opsExact: true, x: 15, y: 10, w: 11, h: 7, note: 'Sin adaptador (sus {{cfg.D}} pesos son un vector; LoRA va en matrices).' },
      LIN('q-proj', 'W_Q', 'D → D', '{{cfg.D}} → {{cfg.Dq}}', 31, 3, { note: 'Proyección de las queries. Con LoRA: + (α/r)·B_Q A_Q x.' }),
      LIN('k-proj', 'W_K', 'D → G·d_h', '{{cfg.D}} → {{cfg.Dkv}}', 31, 12, { note: 'Proyección de las keys: sale a G·d_h = {{cfg.Dkv}} (GQA), así que su adaptador es más chico.' }),
      LIN('v-proj', 'W_V', 'D → G·d_h', '{{cfg.D}} → {{cfg.Dkv}}', 31, 21, { note: 'Proyección de los values (G·d_h = {{cfg.Dkv}}).' }),
      { id: 'attn', op: 'attn', label: 'Atención', sub: 'RoPE · GQA', ops: ['rope-q', 'rope-k', 'scores', 'scale', 'mask', 'softmax', 'weighted-sum', 'merge'], opsExact: true, x: 58, y: 8, w: 17, h: 11,
        note: 'El núcleo de la atención (sin pesos): nada que adaptar.' },
      LIN('o-proj', 'W_O', 'D → D', '{{cfg.Dq}} → {{cfg.D}}', 79, 10, { w: 16, note: 'La proyección de salida de la atención.' }),
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'none', ops: ['res1'], opsExact: true, x: 99, y: 11, w: 5, h: 5, note: 'Residual de la atención.' },
      { id: 'norm2', op: 'norm', label: 'RMSNorm', ops: ['norm2'], opsExact: true, x: 90, y: 36, w: 13, h: 7, note: 'Sin adaptador.' },
      LIN('gate-proj', 'W_gate', 'D → D_mlp', '{{cfg.D}} → {{cfg.Dmlp}}', 64, 31, { note: 'La rama gate de la SwiGLU ({{cfg.Dmlp}} de ancho): sus adaptadores son de los más grandes.' }),
      LIN('up-proj', 'W_up', 'D → D_mlp', '{{cfg.D}} → {{cfg.Dmlp}}', 64, 41, { note: 'La rama up de la SwiGLU.' }),
      { id: 'mul', op: 'tensorop', shape: 'mul', label: 'SiLU ⊙ up', labelPos: 'below', ops: ['silu', 'mul'], opsExact: true, x: 54, y: 37.5, w: 5, h: 5, note: 'La compuerta de la SwiGLU, sin pesos.' },
      LIN('down-proj', 'W_down', 'D_mlp → D', '{{cfg.Dmlp}} → {{cfg.D}}', 28, 37, { note: 'La proyección de bajada de la FFN.' }),
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual', labelPos: 'none', ops: ['res2'], opsExact: true, x: 18, y: 38, w: 5, h: 5, note: 'Residual de la FFN.' },
      { id: 'out', op: 'io', modality: 'txt', label: 'x_ℓ', x: 2, y: 37, w: 10, h: 7, note: 'La salida del bloque: entra al siguiente.' },
    ],
    notes: [
      { x: 2, y: 55, text: 'con esta config: {{metrics.targetsName}} = {{quantities.targetsCount}} de 7 lineales · {{metrics.adapterParamsPerLayer}} parámetros de LoRA por capa · {{metrics.trainableParams}} en las {{cfg.L}} capas ({{metrics.trainableShare}})', cls: 'ink' },
    ],
    edges: [
      { from: 'in', to: 'norm1', kind: 'data', tensor: 'x0', label: false },
      { from: 'in', to: 'res1', kind: 'residual', fromSide: 'top', toSide: 'top', fromAt: 0.5, toAt: 0.5, via: [[6, 0.8], [101.5, 0.8]] },
      { from: 'norm1', to: 'q-proj', kind: 'data', tensor: 'h-norm1', toAt: 0.5, label: false },
      { from: 'norm1', to: 'k-proj', kind: 'data', tensor: 'h-norm1', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'norm1', to: 'v-proj', kind: 'data', tensor: 'h-norm1', toAt: 0.5, label: false },
      { from: 'q-proj', to: 'attn', kind: 'data', tensor: 'q', fromAt: 0.5, toAt: 0.2, label: false, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.3 },
      { from: 'k-proj', to: 'attn', kind: 'data', tensor: 'k', fromAt: 0.5, toAt: 0.5, label: false, tag: 'K', tagStyle: 'plain', tagSide: 'on', tagT: 0.3 },
      { from: 'v-proj', to: 'attn', kind: 'data', tensor: 'v', fromAt: 0.5, toAt: 0.8, label: false, tag: 'V', tagStyle: 'plain', tagSide: 'on', tagT: 0.3 },
      { from: 'attn', to: 'o-proj', kind: 'data', tensor: 'z', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'o-proj', to: 'res1', kind: 'data', tensor: 'o', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'res1', to: 'norm2', kind: 'data', tensor: 'r1', fromSide: 'bottom', toSide: 'top', toAt: 0.8846, labelSide: 'left', labelT: 0.5 },
      { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'right', toSide: 'bottom', via: [[110, 13.5], [110, 51], [20.5, 51]] },
      { from: 'norm2', to: 'gate-proj', kind: 'data', tensor: 'h-norm2', fromSide: 'left', toSide: 'right', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'norm2', to: 'up-proj', kind: 'data', tensor: 'h-norm2', fromSide: 'left', toSide: 'right', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'gate-proj', to: 'mul', kind: 'data', tensor: 'gate', fromSide: 'left', toSide: 'right', label: false },
      { from: 'up-proj', to: 'mul', kind: 'data', tensor: 'up', fromSide: 'left', toSide: 'right', label: false },
      { from: 'mul', to: 'down-proj', kind: 'data', tensor: 'prod', fromSide: 'left', toSide: 'right', toAt: 0.5, label: false },
      { from: 'down-proj', to: 'res2', kind: 'data', tensor: 'f', fromSide: 'left', toSide: 'right', fromAt: 0.5, label: false },
      { from: 'res2', to: 'out', kind: 'data', tensor: 'x-out', fromSide: 'left', toSide: 'right', label: false },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) memoria por método
  const MEM_SEGS = (frozenBase) => [
    { n: 'metrics.baseWeightBytes', op: 'norm', frozen: frozenBase, label: frozenBase ? 'Pesos de la base (rayado: congelados)' : 'Pesos (entrenan)' },
    { n: 'metrics.adapterBytes', op: 'mlp', label: 'Adaptadores' },
    { n: 'metrics.gradBytes', op: 'attn', label: 'Gradientes' },
    { n: 'metrics.optimizerBytes', op: 'conv', label: 'Optimizador (+ copia fp32)' },
    { n: 'metrics.activationBytes', mod: 'img', label: 'Activaciones + logits (≈)' },
  ];
  ATLAS.registerDiagram(Object.assign({
    id: 'qlora-memory', model: 'lora', config: C, configs: LORA.concat(['full-ft-llama3-8b']), kind: 'arch', title: 'Memoria del entrenamiento: FT completo, LoRA y QLoRA',
    parent: 'lora-overview', parentNode: 'memory',
    caption: 'Qué ocupa la GPU al entrenar Llama 3 8B, con los mismos B, T y optimizador en las tres filas. El FT completo paga gradientes y AdamW (≈ 16 bytes por parámetro); LoRA conserva la base en bf16 pero entrena ≈ 0.5 %; QLoRA guarda la base en NF4 (≈ 4.13 bits por parámetro). Con secuencias largas mandan las activaciones (≈, estimación del calculador). Líneas: GPU de 24, 48 y 80 GB.',
    grid: { w: 78, h: 25 }, direction: 'lr', maxCrossings: 0,
    legendText: { bars: 'Barras: memoria de entrenamiento por método, ancho proporcional a los bytes (del calculador); líneas rojas = GPU de 24 / 48 / 80 GB' },
    nodes: [
      { id: 'memory-bars', op: 'io', label: 'Memoria por paso', x: 1, y: 1, w: 76, h: 23,
        bars: { unit: 'bytes', labelW: 14, totalW: 20, fits: true, lines: GB,
          addCur: 'esta: {{metrics.targetsName}}, r = {{cfg.r}}',
          segs: MEM_SEGS(true),
          rows: [
            { label: 'FT completo', config: 'full-ft-llama3-8b', segs: MEM_SEGS(false) },
            { label: 'LoRA r = 16', config: 'lora-llama3-8b-r16' },
            { label: 'QLoRA r = 16', config: 'qlora-llama3-8b-r16' },
          ],
          caption: 'B = {{cfg.B}} · T = {{cfg.T}} · {{metrics.optimizerName}} · sin checkpointing (con él, activaciones: {{metrics.activationBytesCkpt}})' },
        note: 'Del calculador (ATLAS.Arch.metrics de cada config): la base a {{cfg.bits}} bits en esta config ({{metrics.baseWeightBytes}}), los adaptadores ({{metrics.adapterBytes}}), sus gradientes, el optimizador ({{metrics.optimizerBytes}}) y las activaciones (≈ {{metrics.activationBytes}}, incluye los logits). Total de esta config: {{metrics.totalTrainMemory}}. Sin el contexto de CUDA ni la fragmentación (≈ 0.5–1 GB más).' },
    ],
    edges: [],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
