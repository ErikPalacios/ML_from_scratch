/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/llm-inferencia.js
   Diagramas de inferencia de LLMs (SPEC §7.2, §18.2), modelo `llm`:
     llm-inference-overview  (llama3-8b) dos carriles. Arriba, el PREFILL: los T tokens del prompt pasan juntos por
                             las L capas (limitado por cómputo) y escriben su K y su V en el KV cache. Abajo, el DECODE:
                             un token por paso (aristas con knob decode = 1: formas de 1 token), lee el caché entero,
                             agrega una fila por capa y emite el siguiente token (limitado por memoria). El caché es un
                             almacén (cilindro) que crece; los bytes y las intensidades salen de ATLAS.Arch.metrics.
     moe-block               (mixtral-8x7b) la FFN MoE de un bloque: router → top-k → los E expertos SwiGLU (k
                             encendidos) → combinación ponderada.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas las pone el motor desde ATLAS.Arch.run (las del
   carril de decode, desde ATLAS.Arch.run(config, {decode: 1}) vía edge.ov / node.ov). No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'llama3-8b', MX = 'mixtral-8x7b';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const m = (k) => '{{' + MX + '.' + k + '}}';
  const qd = (k) => '{{' + C + '-decode.' + k + '}}';   // la config de decode (1 token, ctx = 4096)
  const u = (k) => '{{' + k + '}}';                      // sin prefijo: la config con que se dibuja (opts.config)
  const DEC = { decode: 1 };

  // ------------------------------------------------------------------ prefill vs decode y el KV cache
  ATLAS.registerDiagram({
    id: 'llm-inference-overview', model: 'llm', config: C, kind: 'arch', title: 'Inferencia: prefill y decode',
    page: 'llm-inferencia', section: 'diagrama',
    caption: 'Generar texto tiene dos fases. Prefill (arriba): los T tokens del prompt pasan juntos por las L capas; cada peso leído de la memoria se usa en T tokens, así que manda el cómputo. De paso, cada capa escribe la K y la V de cada token en el KV cache (el cilindro). Decode (abajo): un token por paso; cada capa lee el caché entero, agrega una fila (la del token nuevo) y sale el token siguiente, que vuelve a entrar (arista punteada: el tiempo). Cada paso relee todos los pesos y el caché para un solo token: manda el ancho de banda de memoria. Las formas del carril de abajo son las de un paso (1 token) con un contexto de {{llama3-8b.cfg.ctx}} tokens (Llama 3 8B).',
    grid: { w: 132, h: 80 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['kv-cache', 'decode'], mobileFocusPad: 5,
    configs: ['llama3-8b', 'llama3-70b', 'llama2-7b', 'mixtral-8x7b'],
    edgeLegend: { cross: 'Lectura del KV cache (K, V de los tokens anteriores)' },
    groups: [
      { id: 'prefill-lane', style: 'lane', tone: 'accent', hideInBlank: true, label: 'Prefill: el prompt, en paralelo', legend: 'Marco azul: prefill (todos los tokens del prompt a la vez)',
        label2: 'limitado por cómputo: ' + u('metrics.arithmeticIntensityPrefill') + ' FLOPs por byte (codo de la H100 ≈ ' + u('metrics.ridgePoint') + ')', x: 1, y: 1, w: 130, h: 23 },
      { id: 'decode-lane', style: 'lane', tone: 'warn', hideInBlank: true, label: 'Decode: un token por paso', legend: 'Marco ámbar: decode (un token por paso, en bucle)',
        label2: 'limitado por memoria: ' + u('metrics.arithmeticIntensityDecode') + ' FLOPs por byte · ≤ ' + u('metrics.decodeTokPerSecUpperBound') + ' tokens/s (≈, H100, ctx ' + u('cfg.ctx') + ')', labelPos: 'bottom-left', x: 1, y: 47, w: 130, h: 31 },
    ],
    nodes: [
      { id: 'prompt', op: 'io', modality: 'txt', label: 'Prompt', sub: 'T tokens', subNum: 'T = {{cfg.T}} tokens', x: 5, y: 10, w: 18, h: 7,
        note: 'El prompt entero (instrucciones, historia del chat, documentos…), ya tokenizado.' },
      { id: 'prefill', op: 'attn', style: 'block', costOf: 'blocks', badgeTotal: true, flag: 'T a la vez', label: 'L capas, T tokens', x: 34, y: 8.5, w: 40, h: 10,
        mini: { items: [{ label: 'Atención', op: 'attn' }, { sym: 'add' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }] },
        tex: '\\begin{aligned} \\text{MACs} &\\approx P\\cdot T + \\text{atención} \\propto T^2 \\\\ P &= \\text{parámetros sin el embedding} \\end{aligned}', note: 'Los T tokens del prompt pasan juntos por las L capas: matrices grandes (T×D por D×D), la GPU trabaja a pleno. Cada peso leído de la HBM se usa T veces, así que la intensidad aritmética (FLOPs por byte) es alta: ' + q('metrics.arithmeticIntensityPrefill') + ' para T = ' + q('cfg.T') + ', por encima del codo de la GPU. Lo que marca la latencia hasta el primer token (TTFT). Costo: ' + q('metrics.prefillMacs') + '.' },
      { id: 'kv-cache', op: 'attn', style: 'store', label: 'KV cache', sub: 'K y V de cada token, en cada capa\n2·L·G·d_h·bytes por token',
        subNum: 'por token: {{metrics.kvBytesPerToken}}\n{{cfg.ctx}} tokens: {{metrics.kvCacheBytes}}', rows: { n: 6, add: 1, label: '+1 fila por token' }, x: 62, y: 29, w: 40, h: 14,
        tex: '\\text{bytes} = 2 \\cdot L \\cdot G \\cdot d_h \\cdot b \\cdot \\text{ctx} \\cdot B', note: 'Un almacén, no una operación: en cada capa, la K (ya rotada por RoPE) y la V de cada token visto, G cabezas de d<sub>h</sub>. El prefill escribe T filas por capa; cada paso de decode agrega una y lee todas. Crece lineal con el contexto y con el lote: ' + q('metrics.kvBytesPerToken') + ' por token en Llama 3 8B a 16 bits, ' + q('metrics.kvCacheBytes') + ' con ' + q('cfg.ctx') + ' tokens (con MHA serían ' + q('metrics.kvCacheBytesMHA') + '). Por eso GQA, la cuantización del caché y PagedAttention (bloques, sin reservar el contexto máximo).' },
      { id: 'token', op: 'io', modality: 'txt', label: 'Token t', sub: 'el último generado', x: 5, y: 54, w: 18, h: 7,
        note: 'El token más reciente: el primero sale del prefill; después, cada paso usa el que generó el anterior.' },
      { id: 'decode', op: 'attn', style: 'block', costOf: 'blocks', badgeTotal: true, ov: DEC, flag: '1 token', label: 'L capas, 1 token', x: 50, y: 52.5, w: 40, h: 10,
        mini: { items: [{ label: 'Atención', op: 'attn' }, { sym: 'add' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }] },
        tex: '\\begin{aligned} \\text{MACs} &\\approx P + 2\\,L\\,h\\,d_h\\,\\text{ctx} \\\\ P &= \\text{parámetros sin el embedding} \\end{aligned}', note: 'Un solo token por las L capas: cada matriz de pesos (D×D, D×D<sub>mlp</sub>…) se lee entera de la HBM para multiplicarla por UN vector, ≈ 2 FLOPs por parámetro. La intensidad es ≈ ' + q('metrics.arithmeticIntensityDecode') + ' FLOPs por byte: muy por debajo del codo, la GPU espera a la memoria. Por paso: ' + q('metrics.decodeMacsPerToken') + ' y ' + q('metrics.decodeBytesPerStep') + ' leídos (pesos + caché). Se mejora subiendo el lote B (continuous batching), con menos bytes (cuantización, GQA) o con decodificación especulativa.' },
      { id: 'next', op: 'io', modality: 'txt', label: 'Token t+1', sub: 'muestreado de 1×V logits', x: 104, y: 54, w: 22, h: 7,
        note: 'El token siguiente, muestreado de la única fila de logits del paso. Se agrega a la salida y vuelve a entrar como "token t" del paso siguiente.' },
    ],
    tensors: [
      { id: 'ids', at: { edge: 'prompt>prefill' }, show: 'both' },
    ],
    edges: [
      { from: 'prompt', to: 'prefill', kind: 'data', tensor: 'ids', toAt: 0.5 },
      // el prefill escribe T filas por capa; el primer token sale del prefill y arranca el decode
      { from: 'prefill', to: 'kv-cache', kind: 'data', tensor: 'k-rope', fromSide: 'bottom', toSide: 'top', fromAt: 0.85, toAt: 0.15, labelSide: 'right', labelT: 0.78, tag: 'escribe K,V', tagStyle: 'plain', tagSide: 'left', tagT: 0.78 },
      { from: 'prefill', to: 'token', kind: 'data', tensor: 'next-token', fromSide: 'bottom', toSide: 'top', fromAt: 0.1, via: [[38, 50], [14, 50]], labelSeg: 0, labelSide: 'left', labelT: 0.5, tag: '1.er token', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.25 },
      // decode: 1 token; lee todo el caché y le agrega una fila por capa
      { from: 'token', to: 'decode', kind: 'data', tensor: 'ids', ov: DEC, toAt: 0.5 },
      // lee las ctx − 1 filas guardadas (k-past del grafo de decode, ctx = 4096); con la nueva, la atención ve ctx
      { from: 'kv-cache', to: 'decode', kind: 'cross', tensor: 'k-past', ov: DEC, fromSide: 'bottom', toSide: 'top', fromAt: 0.45, toAt: 0.75, labelSide: 'right', labelT: 0.72, tag: 'K,V: lee todas las filas', tagSide: 'on', tagT: 0.25,
        crossNote: 'K y V de los tokens anteriores, leídas del KV cache' },
      { from: 'decode', to: 'next', kind: 'data', tensor: 'logits', ov: DEC, labelT: 0.45 },
      { from: 'decode', to: 'kv-cache', kind: 'data', tensor: 'k-rope', ov: DEC, fromSide: 'top', toSide: 'bottom', fromAt: 0.4, toAt: 0.1, labelSide: 'right', labelT: 0.28, tag: '+1 fila', tagStyle: 'plain', tagSide: 'on', tagT: 0.75 },
      // el tiempo: el token generado es la entrada del paso siguiente
      { from: 'next', to: 'token', kind: 'control', fromSide: 'bottom', toSide: 'bottom', via: [[115, 67], [14, 67]], tag: 't → t+1', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (Llama 3 8B en una H100)', steps: [
        { nodes: ['prompt', 'prefill'], edges: ['prompt>prefill'], tensors: ['ids'], tensorsOn: 'edges',
          text: '<b>Prefill.</b> Los T = ' + q('cfg.T') + ' tokens del prompt entran juntos (<b>' + q('tensor.ids.shape') + '</b>) y pasan por las ' + q('cfg.L') + ' capas: ' + q('metrics.prefillMacs') + '. Cada peso leído de la HBM se usa en ' + q('cfg.T') + ' tokens: ' + q('metrics.arithmeticIntensityPrefill') + ' FLOPs por byte, por encima del codo de la H100 (≈ ' + q('metrics.ridgePoint') + '): limitado por cómputo.' },
        { nodes: ['prefill', 'kv-cache'], edges: ['prefill>kv-cache'], tensors: ['k-rope'], tensorsOn: 'edges',
          text: 'De paso, cada capa escribe en el caché la K (rotada) y la V de los ' + q('cfg.T') + ' tokens: <b>' + q('tensor.k-rope.shape') + '</b> cada una, por capa. Son ' + q('metrics.kvBytesPerToken') + ' por token (2 · ' + q('cfg.L') + ' · ' + q('cfg.G') + ' · ' + q('cfg.dh') + ' · 2 bytes).' },
        { nodes: ['prefill', 'token'], edges: ['prefill>token'], tensors: ['next-token'],
          text: 'De la última fila de logits sale el primer token generado. El tiempo hasta acá es la latencia al primer token (TTFT): la domina el prefill.' },
        { nodes: ['token', 'decode'], edges: ['token>decode'], tensors: ['ids'], tensorsOn: 'edges',
          text: '<b>Decode.</b> Ahora entra UN token por paso: el mismo modelo, con formas de 1×' + q('cfg.D') + '. Por paso, ' + q('metrics.decodeMacsPerToken') + ' ≈ 2 FLOPs por parámetro (' + q('metrics.decodeFlopsPerParam') + ').' },
        { nodes: ['kv-cache', 'decode'], edges: ['kv-cache>decode', 'decode>kv-cache'], tensors: ['k-rope'], tensorsOn: 'edges',
          text: 'Cada capa lee del caché la K y la V de todas las filas guardadas: con ' + q('cfg.ctx') + ' tokens de contexto, <b>' + qd('tensor.k-past.shape') + '</b> cada una (' + q('metrics.decodeKvBytesRead') + ' en el modelo por paso). Le agrega la fila del token nuevo (<b>' + qd('tensor.k-rope.shape') + '</b> por capa) y la atención ve las ' + q('cfg.ctx') + ': <b>' + qd('tensor.k-ctx.shape') + '</b>. El caché crece una fila por paso (en el primer paso tenía las ' + q('cfg.T') + ' del prompt). Sin el caché, cada paso recalcularía K y V de todo el prefijo.' },
        { nodes: ['decode', 'next'], edges: ['decode>next', 'next>token'], tensors: ['logits'],
          text: 'Sale una sola fila de logits (V = ' + q('cfg.V') + ' valores) y el token siguiente, que vuelve a entrar (arista punteada). Cada paso lee ' + q('metrics.decodeBytesPerStep') + ' (pesos + caché) para un token: ' + q('metrics.arithmeticIntensityDecode') + ' FLOPs por byte. Limitado por memoria: a lo sumo ≈ ' + q('metrics.decodeTokPerSecUpperBound') + ' tokens/s con 3.35 TB/s (estimación de roofline).' },
        { nodes: ['decode', 'kv-cache'], edges: ['kv-cache>decode'], tensors: [],
          text: 'Para aprovechar la GPU se agrupan secuencias (lote B): los pesos se leen una vez por paso para las B, pero cada una trae su propio caché. Con ' + q('cfg.ctx') + ' tokens por secuencia caben ≈ ' + q('metrics.maxBatchInHbm') + ' secuencias en los 80 GB después de los pesos: la memoria del caché, no el cómputo, limita el lote.' },
      ] },
    ],
    legend: 'auto',
  });

  // ------------------------------------------------------------------ la FFN MoE de Mixtral
  ATLAS.registerDiagram({
    id: 'moe-block', model: 'llm', config: MX, kind: 'arch', title: 'FFN MoE de Mixtral (una capa)',
    configs: [MX], configsNote: 'no tiene FFN MoE',
    page: 'llm-inferencia', section: 'inferencia',
    caption: 'En Mixtral 8×7B la FFN de cada bloque es un MoE: un router (una matriz D × E) puntúa los E expertos para cada token, se quedan los k mejores (top-k; la arista punteada decide a dónde va cada token, no lleva un tensor), cada token pasa SOLO por sus k expertos SwiGLU y la salida es la suma de sus salidas pesada por el router renormalizado. Todos los expertos ocupan memoria; cada token paga el cómputo de k. Cuáles se encienden depende del token (aquí, un ejemplo).',
    grid: { w: 118, h: 42 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['experts'],
    nodes: [
      { id: 'in', op: 'io', modality: 'txt', label: 'Tokens', sub: 'tras RMSNorm 2', x: 1, y: 25, w: 16, h: 8,
        note: 'La entrada de la FFN del bloque: cada token, normalizado por la RMSNorm 2.' },
      { id: 'router', op: 'embed', badgeTotal: true, label: 'Router', sub: 'Linear D → E', x: 24, y: 3, w: 20, h: 7,
        tex: 'r = x\\, W_r,\\; W_r \\in \\mathbb{R}^{D\\times E}', note: 'Una sola matriz sin sesgo: un logit por experto y por token. Es diminuta (D·E parámetros por capa) y se entrena junto con todo.' },
      { id: 'topk', op: 'tensorop', shape: 'pill', symbol: 'pick', label: 'top-k + softmax', x: 54, y: 3.5, w: 22, h: 6,
        tex: 'w = \\mathrm{softmax}\\big(\\mathrm{TopK}(r, k)\\big)', note: 'Se quedan los k logits mayores de cada token y la softmax se hace solo sobre ellos: k pesos que suman 1. Sin parámetros. Los índices elegidos deciden a qué expertos va el token (arista punteada).' },
      { id: 'experts', op: 'mlp', label: 'E expertos SwiGLU', sub: 'cada uno D → D_mlp → D', experts: { n: 'E', k: 'topk', lit: [2, 5], caption: 'top-{k} de {n} · un token de ejemplo' },
        blankDesc: 'Nombre de las FFN entre las que el router reparte cada token', badgeTotal: true, x: 40, y: 21, w: 40, h: 16,
        tex: 'y_e = W^{e}_{\\text{down}}\\big(\\mathrm{SiLU}(x W^{e}_{\\text{gate}}) \\odot x W^{e}_{\\text{up}}\\big)', note: 'E FFN SwiGLU independientes, cada una del tamaño de la FFN densa de Mistral 7B. Cada token pasa solo por sus k: las filas enrutadas son k·T (cada token aparece k veces). Todos ocupan memoria (es "8×7B" ≈ 47B parámetros), pero el cómputo por token es el de k expertos (≈ 13B activos). Las cajas encendidas son un ejemplo: cuáles se usan cambia con cada token y en cada capa.' },
      { id: 'combine', op: 'tensorop', shape: 'add', label: 'Σ w·y_e', labelPos: 'below', x: 92, y: 27, w: 4, h: 4,
        tex: 'f = \\sum_{e \\in \\mathrm{TopK}} w_e\\, y_e', note: 'La salida de cada token es la suma de las salidas de sus k expertos, pesada por el router. Sin parámetros.' },
      { id: 'out', op: 'io', label: 'Salida', sub: '→ residual 2', x: 105, y: 25, w: 12, h: 8, note: 'Vuelve al bloque, donde se suma con la residual (igual que la FFN densa).' },
    ],
    edges: [
      { from: 'in', to: 'experts', kind: 'data', tensor: 'x-routed', toAt: 0.5, labelT: 0.5 },
      { from: 'in', to: 'router', kind: 'data', tensor: 'h-norm2', fromSide: 'top', toSide: 'left', fromAt: 0.5, labelSeg: 0, labelSide: 'right', labelT: 0.45 },
      { from: 'router', to: 'topk', kind: 'data', tensor: 'router-logits', labelSide: 'above' },
      { from: 'topk', to: 'experts', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.2727, toAt: 0.5, tag: 'a dónde va cada token', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'topk', to: 'combine', kind: 'data', tensor: 'topk-weights', fromSide: 'right', toSide: 'top', labelSeg: 0, labelSide: 'above', labelT: 0.55 },
      { from: 'experts', to: 'combine', kind: 'data', tensor: 'expert-out', fromAt: 0.5, labelSide: 'below', labelT: 0.5 },
      { from: 'combine', to: 'out', kind: 'data', tensor: 'f', labelSide: 'above' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (Mixtral 8×7B, T tokens)', steps: [
        { nodes: ['in', 'router'], edges: ['in>router', 'router>topk'], tensors: ['h-norm2', 'router-logits'],
          text: 'El router (' + m('op.router.params') + ' parámetros por capa) da ' + m('cfg.E') + ' logits por token: <b>' + m('tensor.router-logits.shape') + '</b>.' },
        { nodes: ['topk'], edges: ['router>topk', 'topk>experts', 'topk>combine'], tensors: ['topk-weights'],
          text: 'Top-' + m('cfg.topk') + ' y softmax sobre esos ' + m('cfg.topk') + ': pesos <b>' + m('tensor.topk-weights.shape') + '</b> (suman 1 por token) y los índices de los expertos elegidos.' },
        { nodes: ['experts'], edges: ['in>experts'], tensors: ['x-routed'],
          text: 'Cada token se copia a sus ' + m('cfg.topk') + ' expertos: <b>' + m('tensor.x-routed.shape') + '</b> filas en total. Los expertos de las ' + m('cfg.L') + ' capas suman ' + m('node.experts.params') + ' parámetros, pero cada token usa ' + m('cfg.topk') + ': ' + m('metrics.activeParams') + ' activos por token de ' + m('params.total') + ' en total (' + m('metrics.activeParamsShare') + ').' },
        { nodes: ['combine', 'out'], edges: ['experts>combine', 'topk>combine', 'combine>out'], tensors: ['expert-out', 'f'],
          text: 'Se suman las salidas de los ' + m('cfg.topk') + ' expertos de cada token, pesadas por el router: <b>' + m('tensor.f.shape') + '</b>, la misma forma que una FFN densa. Al servir, todos los expertos están en memoria (' + m('metrics.weightBytes') + ' a 16 bits) aunque cada token solo calcule con ' + m('cfg.topk') + '.' },
      ] },
    ],
    legend: 'auto',
  });
})(typeof window !== 'undefined' ? window : globalThis);
