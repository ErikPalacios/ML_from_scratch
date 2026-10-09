/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/t5.js
   Diagramas de T5 (SPEC §7.2, ids de §24.1), modelo `t5` (js/arch/encdec.js), configs t5-base (canónica), t5-small, t5-large y
   flan-t5-base (T5 v1.1: FFN gated-GELU, LM head sin atar):
     t5-overview        dos columnas: a la izquierda la entrada y el encoder (× L, corre UNA vez), a la derecha los tokens ya
                        generados y el decoder (× L_d, corre UNA vez POR TOKEN); en el medio, arriba, el embedding compartido (una
                        sola tabla para encoder, decoder y LM head). La salida del encoder entra al decoder por una arista
                        "cross" (K, V). El token elegido vuelve a la entrada del decoder (control: el tiempo). Abajo, el costo de
                        generar T_out tokens (MACs y tiempo ≈), del calculador: la asimetría encoder una vez / decoder por token.
       t5-encoder-layer la capa del encoder: pre-norm con RMSNorm, self-attention BIDIRECCIONAL + sesgo de posición relativa
                        (calculado en la capa 1 y compartido), FFN ReLU (gated-GELU en v1.1).
       t5-decoder-layer la capa del decoder: self-attention CAUSAL (+ sesgo relativo unidireccional) → cross-attention (Q del decoder;
                        K y V de la salida del encoder, proyectadas UNA vez por entrada: W_K, W_V aparte, "× 1") → FFN.
       span-corruption  el pre-entrenamiento: la Figura 2 del paper (tramos → centinelas) y los largos reales (568 → 512 / 114, del
                        calculador), con teacher forcing y cross-entropy sobre el objetivo.
   Las formas de las aristas son las del grafo del calculador: el forward con teacher forcing (las T_out posiciones del decoder
   en paralelo, como en el entrenamiento). Al generar, cada paso procesa 1 token (la config t5-base-decode).
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 't5-base', CFGS = ['t5-base', 't5-small', 't5-large', 'flan-t5-base'];
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 't5', section: 'diagrama' };
  // ejemplo de la Figura 1 del paper (tarea con prefijo de texto); palabras como tokens (T5 usa SentencePiece)
  const tok = (ws, special) => ws.map((t) => Object.assign({ t }, special && special.indexOf(t) >= 0 ? { special: true } : {}));
  const IN_TOKS = tok(['translate', 'English', 'to', 'German:', 'That', 'is', 'good.', '</s>'], ['</s>']);
  const DEC_TOKS = tok(['<pad>', 'Das', 'ist'], ['<pad>']);
  const LT = {
    tokens: 'Tokens de ejemplo (Figura 1 del paper; palabras como tokens: T5 usa SentencePiece)',
    tie: 'Pesos atados: el LM head usa la MISMA tabla del embedding (se cuenta una vez)',
    runs: 'Veces que corre al generar T_out tokens (una por token)',
    runsOnce: 'Corre una sola vez por entrada',
    costSplit: 'Costo de generar: ancho proporcional (del calculador)',
  };
  const MINI_ENC = { items: [{ label: 'RMSNorm', op: 'norm' }, { label: 'self ↔', op: 'attn' }, { sym: 'add' }, { label: 'RMSNorm', op: 'norm' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] };
  const MINI_DEC = { items: [{ label: 'norm', op: 'norm' }, { label: 'self', op: 'attn' }, { sym: 'add' }, { label: 'norm', op: 'norm' }, { label: 'cross', op: 'fuse' }, { sym: 'add' }, { label: 'norm', op: 'norm' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5], [6, 8]] };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 't5-overview', model: 't5', config: C, configs: CFGS, kind: 'arch', title: 'T5 — vista general (encoder-decoder)',
    caption: 'El tercer sabor de transformer. El encoder (izquierda) lee TODA la entrada de una vez, sin máscara, y produce H: un vector por token de entrada. El decoder (derecha) genera la salida token por token con self-attention causal y, en cada capa, mira H por cross-attention (doble línea: K y V salen del encoder, Q del decoder). Una sola tabla de embedding sirve al encoder, al decoder y al LM head. El encoder corre una vez; el decoder, una vez por token (píldoras ↻): abajo, cuánto cuesta cada parte. Las formas de las aristas son las del entrenamiento (las T_out posiciones del decoder en paralelo, teacher forcing).',
    grid: { w: 112, h: 136 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['input', 'embed', 'encoder', 'decoder'],
    legendText: LT,
    groups: [
      { id: 'enc-group', label: 'Encoder (bidireccional)', x: 5, y: 29, w: 46, h: 19, repeat: { sym: 'L', from: 'L', totalOf: 'encoder' }, modality: 'txt' },
      { id: 'dec-group', label: 'Decoder (causal)', x: 63, y: 55, w: 40, h: 21, repeat: { sym: 'L_d', from: 'Ld', totalOf: 'decoder' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'input', op: 'io', modality: 'txt', label: 'Entrada (texto con prefijo)', x: 2, y: 1, w: 52, h: 10, tokens: { items: IN_TOKS }, expand: 'span-corruption',
        note: 'T5 convierte toda tarea en texto → texto: la tarea va como prefijo ("translate English to German:", "summarize:", "cola sentence:"). La entrada se tokeniza con SentencePiece (vocabulario de {{cfg.V}}, con 100 centinelas para el pre-entrenamiento) y termina en &lt;/s&gt;. La config usa T_in = {{cfg.Tin}} tokens.' },
      { id: 'dec-input', op: 'io', modality: 'txt', label: 'Tokens ya generados', x: 58, y: 1, w: 50, h: 10, tokens: { items: DEC_TOKS },
        note: 'Lo que el decoder lleva escrito, empezando por el token de inicio (en T5 es &lt;pad&gt;). En el entrenamiento es el objetivo desplazado una posición (teacher forcing: las T_out = {{cfg.Tout}} posiciones en paralelo); al generar, crece un token por paso.' },
      { id: 'embed', op: 'embed', label: 'Embedding compartido', sub: 'una tabla V × D: encoder, decoder y LM head', subNum: 'una tabla {{cfg.V}} × {{cfg.D}}: encoder, decoder y LM head',
        subWhen: { gated: 'una tabla V × D: encoder y decoder (LM head propio)' }, blankSub: 'una tabla V × D compartida', x: 14, y: 16, w: 84, h: 7,
        tex: 'x_0 = E[\\mathrm{ids}],\\quad E \\in \\mathbb{R}^{V\\times D}',
        note: 'Una sola tabla ("shared" en HF) para los ids del encoder y los del decoder; en T5 original también es el LM head (pesos atados, línea con puntos). Sin embeddings de posición absolutos: la posición entra como un sesgo relativo dentro de la self-attention de cada pila. Parámetros: {{metrics.sharedEmbedParams}} ({{metrics.sharedEmbedParamsShare}} del modelo).' },
      { id: 'encoder', op: 'attn', style: 'block', badgeTotal: true, label: 'Capa del encoder', x: 8, y: 35, w: 40, h: 10, expand: 't5-encoder-layer', mini: MINI_ENC,
        // revisión fase 12: sin el sesgo relativo (× 1, calculado en la capa 1) para que la insignia sea "por capa" como en Whisper / BERT
        costExclude: ['rel-bias'],
        runs: '× 1', runsTone: 'once',
        tex: "\\begin{aligned} r &= x + \\mathrm{SA}(\\mathrm{RMSNorm}(x)) \\\\ y &= r + \\mathrm{FFN}(\\mathrm{RMSNorm}(r)) \\end{aligned}",
        costNote: 'Corre UNA vez por entrada: este es también su costo por generación.',
        note: 'Pre-norm con RMSNorm (solo γ, sin sesgos en ningún Linear). La self-attention es BIDIRECCIONAL: cada token ve a todos, como en BERT. Corre una sola vez por entrada: {{metrics.encoderMacs}} para T_in = {{cfg.Tin}} tokens. Ábrela para ver el sesgo de posición relativa.' },
      { id: 'enc-out', op: 'norm', label: 'RMSNorm final → H', sub: 'salida del encoder', x: 11, y: 51, w: 34, h: 7, runs: '× 1', runsTone: 'once',
        tex: 'H = \\mathrm{RMSNorm}(x_L) \\in \\mathbb{R}^{T_{in}\\times D}',
        note: 'La salida del encoder, H: un vector de D por token de entrada. NO cambia mientras se genera: el decoder la lee en cada capa y en cada paso por cross-attention, así que sus K y V se calculan una sola vez y se guardan ({{metrics.crossKvBytes}} en bf16 para T_in = {{cfg.Tin}}).' },
      { id: 'decoder', op: 'attn', style: 'block', badgeTotal: true, label: 'Capa del decoder', x: 65, y: 61, w: 36, h: 11, expand: 't5-decoder-layer', mini: MINI_DEC,
        costExclude: ['rel-bias'],
        runs: '× {{cfg.Tout}} pasos',
        tex: "\\begin{aligned} a &= y + \\mathrm{SA}_{\\mathrm{causal}}(\\mathrm{N}(y)) \\\\ b &= a + \\mathrm{CA}(\\mathrm{N}(a), H) \\\\ y' &= b + \\mathrm{FFN}(\\mathrm{N}(b)) \\end{aligned}",
        costNote: 'Al generar corre una vez por token: {{metrics.decoderMacsPerToken}} por token (con el LM head), × T_out.',
        note: 'Tres sub-bloques pre-norm: self-attention CAUSAL entre los tokens generados (con su KV cache al generar), cross-attention a H y FFN. Al generar corre una vez por token: {{metrics.decoderLayerMacsPerToken}} por token en sus L_d capas (sin el LM head). Ábrela para ver de dónde salen Q, K y V.' },
      { id: 'dec-norm', op: 'norm', label: 'RMSNorm final', x: 68, y: 80, w: 30, h: 5, tex: '\\mathrm{RMSNorm}(y_{L_d})', note: 'Una última RMSNorm sobre la salida del decoder.' },
      { id: 'lm-head', op: 'head', label: 'LM head', sub: 'Linear D → V (propia)', subWhen: { tied: 'Eᵀ atada · × 1/√D' }, x: 66, y: 89, w: 34, h: 7, runs: '× {{cfg.Tout}}',
        tex: '\\mathrm{logits} = (D^{-1/2}\\, y)\\, E^{\\top}',
        note: 'Un logit por token del vocabulario. En T5 original es la tabla del embedding transpuesta (atada: 0 parámetros nuevos), con la salida escalada por D^−½ antes (lo hace HF cuando tie_word_embeddings). En T5 v1.1 / Flan-T5 el LM head es una matriz propia, sin reescalado. Corre una vez por token: {{metrics.lmHeadMacsPerToken}}.' },
      { id: 'output', op: 'io', label: 'Siguiente token', sub: 'argmax · beam search', x: 68, y: 101, w: 30, h: 7,
        note: 'Del último logit se elige el siguiente token (greedy o beam search: el paper usa beam de 4 en traducción y resumen) y se agrega a la entrada del decoder. Termina con &lt;/s&gt;.' },
      { id: 'cost', op: 'io', label: 'Costo de generar (MACs)', hideInBlank: true, x: 2, y: 113, w: 54, h: 14,
        costSplit: { segs: [
          { tone: 'once', n: 'metrics.encoderMacs', label: 'Encoder × 1' },
          { tone: 'once2', n: 'metrics.crossKvMacs', label: 'K, V de la cross-attention × 1' },
          { tone: 'loop', n: 'metrics.generationDecoderMacs', label: 'Decoder × {{cfg.Tout}} tokens' },
        ], caption: 'total {{metrics.totalGenerationMacs}} · T_in = {{cfg.Tin}}, T_out = {{cfg.Tout}}' },
        note: 'MACs de generar T_out tokens (del calculador): el encoder y las K, V de la cross-attention se pagan una vez; el decoder, una vez por token. Con entradas largas y salidas cortas (resumir, clasificar), el encoder domina los MACs.' },
      { id: 'cost-time', op: 'io', label: 'Tiempo ≈ en una H100 (cota)', hideInBlank: true, x: 58, y: 113, w: 52, h: 14,
        costSplit: { unit: 'ms', segs: [
          { tone: 'once', n: 'metrics.encoderMs', label: 'Encoder (cómputo)' },
          { tone: 'once2', n: 'metrics.crossKvMs', label: 'K, V de la cross' },
          { tone: 'loop', n: 'metrics.decoderMs', label: 'Decoder (memoria)' },
        ], caption: 'cota de roofline, no una medición: {{metrics.generationMs}} ms' },
        note: 'El mismo trabajo en tiempo (cota de roofline del calculador, sin overheads): el encoder es una matmul grande (limitado por cómputo) y corre una vez; cada paso del decoder procesa UN token y tiene que leer todos sus pesos (limitado por memoria). Por eso, aunque el encoder se lleve la mayoría de los MACs, el tiempo se va en el decoder.' },
    ],
    notes: [
      { x: 4, y: 64, text: 'El encoder corre UNA vez:', cls: 'ink' },
      { x: 4, y: 66.4, text: 'H no cambia mientras' },
      { x: 4, y: 68.8, text: 'el decoder genera.' },
      { x: 4, y: 74, text: 'El decoder corre una vez', cls: 'ink' },
      { x: 4, y: 76.4, text: 'POR TOKEN y relee H' },
      { x: 4, y: 78.8, text: 'en cada capa (cross-attention).' },
    ],
    tensors: [
      { id: 'ids', at: { edge: 'input>embed' }, show: 'both' },
      { id: 'e-x0', at: { edge: 'embed>encoder' }, show: 'both' },
      { id: 'enc-out', at: { edge: 'enc-out>decoder' }, show: 'both' },
      { id: 'logits', at: { edge: 'lm-head>output' }, show: 'label' },
    ],
    edges: [
      { from: 'input', to: 'embed', kind: 'data', tensor: 'ids', fromAt: 0.5, toAt: 0.16667, labelT: 0.5 },
      { from: 'dec-input', to: 'embed', kind: 'data', tensor: 'dec-ids', fromAt: 0.5, toAt: 0.82143, labelT: 0.5 },
      { from: 'embed', to: 'encoder', kind: 'data', tensor: 'e-x0', fromAt: 0.16667, labelT: 0.32 },
      { from: 'embed', to: 'decoder', kind: 'data', tensor: 'd-x0', fromAt: 0.82143, labelT: 0.3 },
      { from: 'encoder', to: 'enc-out', kind: 'data', tensor: 'e-x-out', labelT: 0.7 },
      { from: 'enc-out', to: 'decoder', kind: 'cross', tensor: 'enc-out', fromSide: 'right', toSide: 'left', midX: 55, labelSeg: 1, labelSide: 'left', labelT: 0.55, tag: 'K,V', tagSeg: 2, tagT: 0.5 },
      { from: 'decoder', to: 'dec-norm', kind: 'data', tensor: 'd-x-out', labelT: 0.7 },
      { from: 'dec-norm', to: 'lm-head', kind: 'data', tensor: 'dec-out', labelSide: 'right', labelT: 0.5 },
      { from: 'lm-head', to: 'output', kind: 'data', tensor: 'logits', labelSide: 'left' },
      // autorregresivo: el token elegido vuelve a la entrada del decoder (control: el tiempo)
      { from: 'output', to: 'dec-input', kind: 'control', fromSide: 'right', toSide: 'right', toAt: 0.5, via: [[110.5, 104.5], [110.5, 6]], tag: 't → t+1', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.22 },
      // pesos atados (t5-base / small / large): el LM head reusa la tabla del embedding; en Flan-T5 no
      { from: 'embed', to: 'lm-head', kind: 'control', tie: true, when: 'cfg.tied', fromSide: 'right', toSide: 'right', via: [[106, 19.5], [106, 92.5]], tag: 'E atada', tagBlank: 'pesos atados', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.3 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (T5-Base: traducir, entrada de T_in tokens)', steps: [
        { nodes: ['input', 'embed'], edges: ['input>embed', 'embed>encoder'], tensors: ['ids', 'e-x0'],
          text: 'La entrada (con el prefijo de la tarea) son <b>' + q('tensor.ids.shape') + '</b> ids. La tabla compartida (' + q('cfg.V') + ' × ' + q('cfg.D') + ' = ' + q('metrics.sharedEmbedParams') + ' parámetros) da <b>' + q('tensor.e-x0.shape') + '</b>. Sin posiciones absolutas.' },
        { expand: 't5-encoder-layer', nodes: ['enc-rel-bias', 'enc-self-attn'], edges: ['enc-rel-bias>enc-self-attn', 'enc-norm1>enc-self-attn'], tensors: ['e-bias', 'e-h1'],
          text: 'En la capa 1 se calcula UNA vez el sesgo de posición relativa: <b>' + q('tensor.e-bias.shape') + '</b>, un escalar por cabeza según el bucket de la distancia (' + q('cfg.buckets') + ' buckets × ' + q('cfg.h') + ' cabezas, hasta ' + q('cfg.maxDistance') + '; ' + q('metrics.relBiasParams') + ' parámetros entre las dos pilas, la mitad en esta). Se suma a QKᵀ en las ' + q('cfg.L') + ' capas. La atención es bidireccional y T5 no divide por √d_h.' },
        { expand: 't5-encoder-layer', nodes: ['enc-ffn', 'enc-res2'], edges: ['enc-norm2>enc-ffn', 'enc-ffn>enc-res2'], tensors: ['e-u', 'e-f'],
          text: 'FFN por token: D → D_mlp = ' + q('cfg.Dmlp') + ' (<b>' + q('tensor.e-u.shape') + '</b>) → ReLU → D. La capa entera: ' + q('metrics.encoderLayerParams') + ' parámetros.' },
        { nodes: ['encoder', 'enc-out'], edges: ['embed>encoder', 'encoder>enc-out'], tensors: ['e-x-out'],
          text: 'Las ' + q('cfg.L') + ' capas corren UNA vez: ' + q('metrics.encoderMacs') + '. Sale H = <b>' + q('tensor.enc-out.shape') + '</b>, que ya no cambia.' },
        { expand: 't5-decoder-layer', nodes: ['memory', 'cross-kv'], edges: ['memory>cross-kv'], tensors: ['enc-out'],
          text: 'Antes del primer token, cada capa del decoder proyecta H con su W_K y su W_V: <b>' + q('tensor.c-k.shape') + '</b> por capa. Son ' + q('metrics.crossKvMacs') + ' en las ' + q('cfg.Ld') + ' capas y ' + q('metrics.crossKvBytes') + ' guardados (la "cross KV cache"): no se recalculan en ningún paso.' },
        { expand: 't5-decoder-layer', nodes: ['self-attn', 'dec-rel-bias'], edges: ['dec-norm1>self-attn', 'dec-rel-bias>self-attn'], tensors: ['d-h1', 'd-bias'],
          text: 'Un paso del decoder: self-attention CAUSAL entre los tokens ya generados (el token nuevo mira a los anteriores, guardados en su KV cache: ' + q('metrics.selfKvBytesPerToken') + ' por token). En el entrenamiento son las T_out = ' + q('cfg.Tout') + ' posiciones a la vez: <b>' + q('tensor.d-scores.shape') + '</b> con la máscara causal.' },
        { expand: 't5-decoder-layer', nodes: ['cross-attn', 'cross-kv'], edges: ['cross-norm>cross-attn', 'cross-kv>cross-attn'], tensors: ['c-h', 'c-k-heads'],
          text: 'Cross-attention: Q sale del decoder (<b>' + q('tensor.c-q-heads.shape') + '</b>), K y V son las guardadas del encoder (<b>' + q('tensor.c-k-heads.shape') + '</b>). Cada token mira las T_in posiciones de la entrada: <b>' + q('tensor.c-scores.shape') + '</b>. Sin máscara: la entrada ya está completa.' },
        { expand: 't5-decoder-layer', nodes: ['ffn', 'res3'], edges: ['ffn-norm>ffn', 'ffn>res3'], tensors: ['d-f'],
          text: 'FFN y la tercera residual: <b>' + q('tensor.d-x-out.shape') + '</b>. Por token, las ' + q('cfg.Ld') + ' capas del decoder cuestan ' + q('metrics.decoderLayerMacsPerToken') + ' en total: self ' + q('metrics.decoderSelfMacsPerToken') + ', cross ' + q('metrics.decoderCrossMacsPerToken') + ' y FFN ' + q('metrics.decoderFfnMacsPerToken') + '.' },
        { nodes: ['dec-norm', 'lm-head', 'output', 'embed'], edges: ['decoder>dec-norm', 'dec-norm>lm-head', 'lm-head>output', 'embed>lm-head'], tensors: ['dec-out', 'logits'],
          text: 'RMSNorm final, reescalado por D<sup>−½</sup> y la tabla del embedding transpuesta (atada): <b>' + q('tensor.logits.shape') + '</b> logits. Total por token: ' + q('metrics.decoderMacsPerToken') + ' (el LM head, ' + q('metrics.lmHeadMacsPerToken') + ').' },
        { nodes: ['output', 'dec-input', 'decoder'], edges: ['output>dec-input', 'embed>decoder'], tensors: ['d-x0'],
          text: 'El token elegido se agrega a la entrada del decoder y se repite el paso: ' + q('cfg.Tout') + ' veces. El encoder NO vuelve a correr y las K, V de la cross-attention tampoco: un token del decoder cuesta ' + q('metrics.encoderVsToken') + ' veces menos que el encoder entero.' },
        { nodes: ['cost', 'cost-time'], edges: [], tensors: [],
          text: 'Generar ' + q('cfg.Tout') + ' tokens: ' + q('metrics.totalGenerationMacs') + ', el ' + q('metrics.encoderShare') + ' en el encoder. Pero en tiempo (cota en una H100) el encoder es ' + q('metrics.encoderMs') + ' ms y el decoder ' + q('metrics.decoderMs') + ' ms: cada paso lee los pesos del decoder para UN token (limitado por memoria).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) capa del encoder
  ATLAS.registerDiagram(Object.assign({
    id: 't5-encoder-layer', model: 't5', config: C, configs: CFGS, kind: 'arch', title: 'Capa del encoder de T5',
    parent: 't5-overview', parentNode: 'encoder',
    caption: 'Pre-norm con RMSNorm y sin sesgos en los Linear. La self-attention es bidireccional y la posición entra como un sesgo aprendido sobre QKᵀ según la distancia relativa (k − q) en buckets: se calcula en la capa 1 y lo reusan todas (flecha de la derecha). Entra y sale T_in × D.',
    grid: { w: 82, h: 88 }, direction: 'tb', maxCrossings: 0,
    legendText: LT,
    groups: [
      { id: 'enc-layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 6, w: 44, h: 70, repeat: { sym: 'L', from: 'L', tagPos: 'bottom' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'enc-in', op: 'io', label: 'Entrada x_{ℓ−1}', x: 20, y: 1, w: 18, h: 4, note: 'La salida de la capa anterior (en la capa 1, el embedding de los tokens).' },
      { id: 'enc-norm1', op: 'norm', label: 'RMSNorm 1', costOf: 'norm', scope: 'enc-attn', x: 17, y: 12, w: 24, h: 4,
        tex: '\\mathrm{RMSNorm}(x) = \\gamma \\odot \\frac{x}{\\sqrt{\\tfrac{1}{D}\\sum_i x_i^2 + \\epsilon}}', note: 'La "LayerNorm" de T5: sin restar la media y sin β (solo γ, D parámetros).' },
      { id: 'enc-self-attn', op: 'attn', label: 'Self-attention', sub: 'bidireccional · + sesgo relativo', heads: 'h', costOf: 'enc-attn', costExclude: ['norm', 'rel-bias'], x: 11, y: 22, w: 36, h: 7,
        xref: [{ href: '#vit.diagrama~vit-mhsa.scores', label: 'Ver la atención por dentro (ViT)' }],
        tex: '\\mathrm{softmax}\\big(Q K^\\top + B\\big)\\, V', note: 'Multi-head attention sin máscara: cada token ve a toda la entrada. Dos detalles de T5: se suma el sesgo relativo B a QKᵀ y NO se divide por √d_h (la inicialización de W_Q ya lo compensa). Sin sesgos en W_Q, W_K, W_V, W_O.' },
      { id: 'enc-rel-bias', op: 'embed', label: 'Sesgo relativo', sub: 'buckets × h · capa 1', subNum: '{{cfg.buckets}} buckets × {{cfg.h}} · capa 1', costOf: 'rel-bias', scope: 'encoder', x: 58, y: 13, w: 23, h: 7, runs: '× 1', runsTone: 'once',
        tex: 'B_{h,q,k} = T[\\,\\mathrm{bucket}(k - q),\\, h\\,]', note: 'Una tabla aprendida de {{cfg.buckets}} buckets × h cabezas: un escalar por (distancia relativa, cabeza). Las distancias chicas tienen bucket propio; las grandes se agrupan en escala logarítmica hasta {{cfg.maxDistance}} (más lejos, todas en el último). Bidireccional: la mitad de los buckets para cada lado. Se calcula en la capa 1 y la reusan las {{cfg.L}} capas: es TODA la información de posición del encoder.' },
      { id: 'enc-res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 27, y: 34, w: 4, h: 4, tex: 'r = x + \\mathrm{SA}(\\mathrm{RMSNorm}(x))', note: 'Suma la entrada de la capa.' },
      { id: 'enc-norm2', op: 'norm', label: 'RMSNorm 2', costOf: 'norm', scope: 'enc-ffn', x: 17, y: 43, w: 24, h: 4, tex: '\\mathrm{RMSNorm}(r)', note: 'Antes de la FFN.' },
      { id: 'enc-ffn', op: 'mlp', label: 'FFN', sub: 'D → D_mlp → D · ReLU', subWhen: { gated: 'gated-GELU · 3 matrices' }, costOf: 'enc-ffn', costExclude: ['norm'], x: 15, y: 52, w: 28, h: 6,
        tex: 'W_o\\,\\mathrm{ReLU}(W_i\\, x)', note: 'Dos Linear sin sesgo con ReLU (T5 original). En T5 v1.1 / Flan-T5: gated-GELU, GELU(x W_0) ⊙ (x W_1) y luego W_o (tres matrices).' },
      { id: 'enc-res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 27, y: 63, w: 4, h: 4, tex: 'y = r + \\mathrm{FFN}(\\mathrm{RMSNorm}(r))', note: 'Cierra la capa.' },
      { id: 'enc-layer-out', op: 'io', label: 'Salida x_ℓ', x: 20, y: 82, w: 18, h: 4, note: 'Misma forma que la entrada. Tras la última capa, la RMSNorm final da H.' },
    ],
    tensors: [
      { id: 'e-u', at: { x: 66, y: 56 }, show: 'both', labelSide: 'below', note: 'oculta de la FFN' },
    ],
    edges: [
      { from: 'enc-in', to: 'enc-norm1', kind: 'data', tensor: 'e-x0', labelT: 0.62 },
      { from: 'enc-in', to: 'enc-res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[29, 7.5], [11, 7.5], [11, 36]], dot: true },
      { from: 'enc-norm1', to: 'enc-self-attn', kind: 'data', tensor: 'e-h1', label: false },
      { from: 'enc-rel-bias', to: 'enc-self-attn', kind: 'data', tensor: 'e-bias', fromSide: 'bottom', toSide: 'right', fromAt: 0.5, toAt: 0.7, labelSide: 'right', labelSeg: 0, labelT: 0.5 },
      { from: 'enc-self-attn', to: 'enc-res1', kind: 'data', tensor: 'e-o', labelT: 0.4 },
      { from: 'enc-res1', to: 'enc-norm2', kind: 'data', tensor: 'e-r1', labelT: 0.5 },
      { from: 'enc-res1', to: 'enc-res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[29, 40.5], [11, 40.5], [11, 65]], dot: true },
      { from: 'enc-norm2', to: 'enc-ffn', kind: 'data', tensor: 'e-h2', labelT: 0.5 },
      { from: 'enc-ffn', to: 'enc-res2', kind: 'data', tensor: 'e-f', labelT: 0.4 },
      { from: 'enc-res2', to: 'enc-layer-out', kind: 'data', tensor: 'e-x-out', labelT: 0.75 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) capa del decoder
  ATLAS.registerDiagram(Object.assign({
    id: 't5-decoder-layer', model: 't5', config: C, configs: CFGS, kind: 'arch', title: 'Capa del decoder de T5',
    parent: 't5-overview', parentNode: 'decoder',
    caption: 'Tres sub-bloques pre-norm, cada uno con su residual (por la izquierda): self-attention CAUSAL entre los tokens generados (con sesgo relativo de un solo lado), cross-attention y FFN. En la cross-attention, Q sale del decoder y K, V de la salida del encoder H (doble línea): W_K y W_V se aplican a H UNA vez por entrada (píldora × 1) y se guardan; en cada token solo corren W_Q, QKᵀ, A·V y W_O (× T_out).',
    grid: { w: 104, h: 118 }, direction: 'tb', maxCrossings: 0,
    legendText: LT,
    groups: [
      { id: 'dec-layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 6, w: 50, h: 100, repeat: { sym: 'L_d', from: 'Ld', tagPos: 'bottom' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'dec-in', op: 'io', label: 'Entrada y_{ℓ−1}', x: 23, y: 1, w: 18, h: 4, note: 'La salida de la capa anterior (en la capa 1, el embedding de los tokens del decoder).' },
      { id: 'dec-norm1', op: 'norm', label: 'RMSNorm 1', costOf: 'norm', scope: 'self-attn', x: 20, y: 11, w: 24, h: 4, tex: '\\mathrm{RMSNorm}(y)', note: 'Antes de la self-attention (solo γ).' },
      { id: 'self-attn', op: 'attn', label: 'Self-attention causal', sub: 'máscara causal · KV cache al generar', heads: 'h', costOf: 'self-attn', scope: 'decoder', costExclude: ['norm', 'rel-bias'], x: 13, y: 20, w: 38, h: 7, runs: '× {{cfg.Tout}}',
        xref: [{ href: '#llm-decoder.diagrama~llm-gqa.mask', label: 'Ver la máscara causal (LLM)' }], xrefBelow: true,
        tex: '\\mathrm{softmax}\\big(Q K^\\top + B + M\\big)\\, V', note: 'Como en un LLM decoder-only: cada token solo ve a los anteriores (máscara M con −∞ arriba de la diagonal) y, al generar, sus K y V se guardan en la KV cache propia, que crece un token por paso ({{metrics.selfKvBytesPerToken}} por token en las {{cfg.Ld}} capas). Lleva su propio sesgo relativo (unidireccional) y tampoco divide por √d_h.' },
      { id: 'dec-rel-bias', op: 'embed', label: 'Sesgo relativo', sub: 'solo hacia atrás · capa 1', costOf: 'rel-bias', scope: 'decoder', x: 66, y: 11, w: 23, h: 7, runs: '× 1', runsTone: 'once',
        tex: 'B_{h,q,k} = T_d[\\,\\mathrm{bucket}(k - q),\\, h\\,],\\; k \\le q', note: 'Otra tabla de {{cfg.buckets}} × h, solo del decoder. Unidireccional: todos los buckets se usan para el pasado (lo futuro lo borra la máscara). Se calcula en la capa 1 del decoder y la reusan todas.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 30, y: 31, w: 4, h: 4, tex: 'a = y + \\mathrm{SA}(\\cdot)', note: 'Suma la entrada de la capa.' },
      { id: 'cross-norm', op: 'norm', label: 'RMSNorm 2', costOf: 'norm', scope: 'cross-attn', x: 20, y: 40, w: 24, h: 4, tex: '\\mathrm{RMSNorm}(a)', note: 'Normaliza solo el lado del decoder (las queries). H ya viene normalizada por la RMSNorm final del encoder.' },
      { id: 'cross-attn', op: 'fuse', label: 'Cross-attention', sub: 'Q: decoder · K, V: encoder', heads: 'h', costOf: 'cross-attn', costExclude: ['norm', 'k-proj', 'v-proj'], x: 13, y: 50, w: 38, h: 8, runs: '× {{cfg.Tout}}',
        xref: [{ href: '#detr.diagrama~detr-cross-attn.cross-scores', label: 'Ver otra cross-attention (DETR)' }], xrefBelow: true,
        tex: '\\mathrm{softmax}\\big(Q_{\\mathrm{dec}} K_{\\mathrm{enc}}^\\top\\big)\\, V_{\\mathrm{enc}},\\quad Q = \\mathrm{N}(a) W_Q', note: 'Cada token del decoder lanza una query contra las T_in posiciones de la entrada: la matriz es T_out × T_in por cabeza. Sin máscara (la entrada está completa) y sin sesgo de posición. Por token corren W_Q, QKᵀ, A·V y W_O; las K y V llegan ya proyectadas.' },
      { id: 'memory', op: 'io', label: 'H (salida del encoder)', sub: 'la misma en cada paso', x: 66, y: 34, w: 32, h: 7, note: 'La salida del encoder tras su RMSNorm final. No cambia mientras se genera.' },
      { id: 'cross-kv', op: 'embed', label: 'W_K, W_V de la capa ℓ', sub: 'sobre H · una vez por entrada\nse guardan', ops: ['cross-k', 'cross-v'], opsExact: true, x: 66, y: 47, w: 32, h: 8, runs: '× 1 (por capa)', runsTone: 'once',
        costNote: 'Corre una vez por entrada (no por token): K y V de esta capa, guardadas. Cada una de las L_d capas tiene sus propias W_K, W_V.',
        tex: 'K = H W_K,\\; V = H W_V \\in \\mathbb{R}^{T_{in}\\times D}', note: 'Las proyecciones de K y V de la cross-attention de esta capa. Como H no cambia, se calculan antes del primer token y se guardan: es la "cross-attention KV cache" ({{metrics.crossKvBytesPerLayer}} por capa, {{metrics.crossKvBytes}} en total). Sin esto, cada token pagaría otra vez {{metrics.crossKvMacs}}.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 30, y: 63, w: 4, h: 4, tex: 'b = a + \\mathrm{CA}(\\cdot)', note: 'Suma la salida de la cross-attention.' },
      { id: 'ffn-norm', op: 'norm', label: 'RMSNorm 3', costOf: 'norm', scope: 'ffn', x: 20, y: 72, w: 24, h: 4, tex: '\\mathrm{RMSNorm}(b)', note: 'Antes de la FFN.' },
      { id: 'ffn', op: 'mlp', label: 'FFN', sub: 'D → D_mlp → D · ReLU', subWhen: { gated: 'gated-GELU · 3 matrices' }, costOf: 'ffn', scope: 'decoder', costExclude: ['norm'], x: 18, y: 81, w: 28, h: 6, runs: '× {{cfg.Tout}}',
        tex: 'W_o\\,\\mathrm{ReLU}(W_i\\, x)', note: 'La misma FFN que en el encoder (pesos propios). Por token: {{metrics.decoderFfnMacsPerToken}} en las {{cfg.Ld}} capas.' },
      { id: 'res3', op: 'tensorop', shape: 'add', label: 'Residual 3', labelPos: 'right', x: 30, y: 93, w: 4, h: 4, tex: "y' = b + \\mathrm{FFN}(\\cdot)", note: 'Cierra la capa.' },
      { id: 'dec-layer-out', op: 'io', label: 'Salida y_ℓ', x: 23, y: 112, w: 18, h: 4, note: 'Misma forma que la entrada. Tras la última capa: RMSNorm final y LM head.' },
    ],
    tensors: [
      { id: 'c-k-heads', at: { x: 82, y: 63 }, show: 'both', labelSide: 'below', note: 'K (y V) por cabeza, guardadas' },
    ],
    edges: [
      { from: 'dec-in', to: 'dec-norm1', kind: 'data', tensor: 'd-x0', labelT: 0.6 },
      { from: 'dec-in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[32, 7.5], [11, 7.5], [11, 33]], dot: true },
      { from: 'dec-norm1', to: 'self-attn', kind: 'data', tensor: 'd-h1', label: false },
      { from: 'dec-rel-bias', to: 'self-attn', kind: 'data', tensor: 'd-bias', fromSide: 'bottom', toSide: 'right', fromAt: 0.5, toAt: 0.72, labelSide: 'right', labelSeg: 0, labelT: 0.45 },
      { from: 'self-attn', to: 'res1', kind: 'data', tensor: 'd-o', labelT: 0.4 },
      { from: 'res1', to: 'cross-norm', kind: 'data', tensor: 'd-r1', labelT: 0.5 },
      { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[32, 37.5], [11, 37.5], [11, 65]], dot: true },
      { from: 'cross-norm', to: 'cross-attn', kind: 'data', tensor: 'c-h', label: false, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.35 },
      { from: 'memory', to: 'cross-kv', kind: 'cross', tensor: 'enc-out', labelSide: 'right', labelT: 0.5, tag: false },
      { from: 'cross-kv', to: 'cross-attn', kind: 'cross', tensor: 'c-k-heads', fromSide: 'left', toSide: 'right', fromAt: 0.5, toAt: 0.72, midX: 61, label: false, tag: 'K,V', tagSeg: 0, tagT: 0.4 },
      { from: 'cross-attn', to: 'res2', kind: 'data', tensor: 'c-o', labelT: 0.4 },
      { from: 'res2', to: 'ffn-norm', kind: 'data', tensor: 'd-r2', labelT: 0.5 },
      { from: 'res2', to: 'res3', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[32, 69.5], [11, 69.5], [11, 95]], dot: true },
      { from: 'ffn-norm', to: 'ffn', kind: 'data', tensor: 'd-h3', labelT: 0.5 },
      { from: 'ffn', to: 'res3', kind: 'data', tensor: 'd-f', labelT: 0.4 },
      { from: 'res3', to: 'dec-layer-out', kind: 'data', tensor: 'd-x-out', labelT: 0.75 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) pre-entrenamiento: span corruption
  // Figura 2 del paper: "Thank you for inviting me to your party last week." → tramos "for inviting" y "last"
  const W = ['Thank', 'you', 'for', 'inviting', 'me', 'to', 'your', 'party', 'last', 'week', '.'];
  const DROP = { 2: 0, 3: 0, 8: 1 };
  const SC_TEXT = W.map((t, i) => (i in DROP ? { t, drop: true, k: DROP[i] } : { t }));
  const SC_IN = [{ t: 'Thank' }, { t: 'you' }, { t: '<X>', sent: true, k: 0 }, { t: 'me' }, { t: 'to' }, { t: 'your' }, { t: 'party' }, { t: '<Y>', sent: true, k: 1 }, { t: 'week' }, { t: '.' }, { t: '</s>', special: true }];
  const SC_OUT = [{ t: '<X>', sent: true, k: 0 }, { t: 'for', drop: true, k: 0 }, { t: 'inviting', drop: true, k: 0 }, { t: '<Y>', sent: true, k: 1 }, { t: 'last', drop: true, k: 1 }, { t: '<Z>', sent: true, k: 2 }, { t: '</s>', special: true }];
  ATLAS.registerDiagram(Object.assign({
    id: 'span-corruption', model: 't5', config: C, configs: ['t5-base'], configsNote: 'el pre-entrenamiento (T_in = 512, T_out = 114)', kind: 'arch', title: 'Pre-entrenamiento de T5: span corruption',
    parent: 't5-overview', parentNode: 'input',
    caption: 'El objetivo de pre-entrenamiento. El ejemplo es el de la Figura 2 del paper, que muestra el objetivo baseline (15 % de los tokens con ruido i.i.d.; los corrompidos seguidos forman un tramo); el T5 final usa el mismo formato con tramos de largo medio 3 (§3.3.4), y los largos de abajo (T_in, T_out) son los de ese objetivo. En la entrada, cada tramo se reemplaza por un centinela (&lt;X&gt;, &lt;Y&gt;: ids reservados del vocabulario) y el objetivo del decoder es la lista de tramos, cada uno tras su centinela (aquí con un centinela final, &lt;Z&gt;: el paper, §3.1.4, siempre lo pone; el código de T5 lo omite cuando la máscara termina en un tramo corrompido, como pasa siempre con sus máscaras al azar, y así salen los 114). El decoder genera solo lo que falta: un objetivo mucho más corto que la entrada. Con teacher forcing, las T_out posiciones del objetivo se entrenan en paralelo.',
    grid: { w: 104, h: 96 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['sc-text', 'sc-corrupt'], mobileFocusPad: 4,
    legendText: Object.assign({}, LT, { tokens: 'Tokens de ejemplo (Figura 2 del paper; palabras como tokens)', tokSent: 'Centinela: reemplaza un tramo (<X>, <Y>, <Z>; color = su tramo)', tokDrop: 'Token de un tramo corrompido: sale de la entrada y va al objetivo' }),
    nodes: [
      { id: 'sc-text', op: 'io', modality: 'txt', label: 'Texto original', sub: 'C4 · texto crudo', subNum: 'C4 · {{metrics.spanRawTokens}} tokens por ejemplo', x: 14, y: 1, w: 76, h: 12, tokens: { items: SC_TEXT },
        note: 'Un fragmento de C4 (texto web limpio). En el pre-entrenamiento se toman {{metrics.spanRawTokens}} tokens, para que tras corromper la entrada mida exactamente {{metrics.spanInputTokens}}. Los tramos con borde punteado son los que se corrompen.' },
      { id: 'sc-corrupt', op: 'tensorop', shape: 'rect', label: 'Corromper tramos', sub: '15 % de los tokens · largo medio 3', x: 30, y: 18, w: 44, h: 7,
        note: 'Se eligen {{metrics.spanNoiseTokens}} tokens ({{metrics.noiseDensity}} del texto) repartidos en {{metrics.spanNoiseSpans}} tramos (largo medio {{metrics.meanNoiseSpan}}), al azar. Cada tramo se reemplaza por UN centinela en la entrada; el objetivo lista los tramos, cada uno tras su centinela. Sin parámetros: es preparación de datos.' },
      { id: 'sc-input', op: 'io', modality: 'txt', label: 'Entrada del encoder', sub: 'T_in tokens', subNum: 'T_in = {{metrics.spanInputTokens}}', x: 1, y: 31, w: 56, h: 12, tokens: { items: SC_IN },
        note: '{{metrics.spanNonNoiseTokens}} tokens que quedaron + {{metrics.spanNoiseSpans}} centinelas + &lt;/s&gt; = {{metrics.spanInputTokens}}.' },
      { id: 'sc-target', op: 'io', modality: 'txt', label: 'Objetivo del decoder', sub: 'T_out tokens', subNum: 'T_out = {{metrics.spanTargetTokens}}', x: 62, y: 31, w: 40, h: 12, tokens: { items: SC_OUT },
        note: 'En el pre-entrenamiento: {{metrics.spanNoiseTokens}} tokens corrompidos + {{metrics.spanNoiseSpans}} centinelas + &lt;/s&gt; = {{metrics.spanTargetTokens}} (sin centinela final: en el código de T5 la máscara termina en un tramo corrompido y lo omite; el paper, §3.1.4, lo pone siempre, como el &lt;Z&gt; de la Figura 2): el objetivo mide ≈ 22 % de la entrada, así que el pre-entrenamiento es barato en el decoder.' },
      { id: 'sc-model', op: 'attn', style: 'block', label: 'T5: encoder + decoder', sub: 'el decoder recibe el objetivo desplazado (teacher forcing)', ops: [], opsExact: true, x: 14, y: 52, w: 76, h: 10,
        note: 'El modelo entero de la vista general ({{params.total}} parámetros). Teacher forcing: el decoder recibe el objetivo desplazado una posición (&lt;pad&gt; &lt;X&gt; for …) y predice todas las posiciones a la vez, con la máscara causal. Un paso así cuesta {{metrics.teacherForcedMacs}} por ejemplo.' },
      { id: 'sc-loss', op: 'head', label: 'Cross-entropy', sub: 'en las T_out posiciones del objetivo', ops: [], opsExact: true, x: 30, y: 72, w: 44, h: 8,
        tex: '\\mathcal{L} = -\\tfrac{1}{T_{out}}\\textstyle\\sum_{t} \\log p(y_t \\mid y_{<t}, x)', note: 'Todas las posiciones del objetivo aportan (a diferencia del MLM de BERT, donde solo cuentan las enmascaradas): centinelas, tokens de los tramos y &lt;/s&gt;.' },
      { id: 'sc-why', op: 'io', label: '¿Por qué tramos?', sub: 'objetivo corto · igual o mejor', hideInBlank: true, x: 30, y: 86, w: 44, h: 8,
        note: 'El paper (§3.3, Tablas 4 a 7) compara objetivos: prefijo de LM, estilo BERT (reconstruir todo) y corromper tokens o tramos. Corromper tramos rinde igual o un poco mejor y acorta el objetivo, lo que abarata el entrenamiento (§3.3.2: argumentado, no medido). La tasa importa poco entre 10 y 25 % (Tabla 6); eligen 15 % por esos resultados y por el precedente de BERT, y largo medio 3 (Tabla 7).' },
    ],
    edges: [
      { from: 'sc-text', to: 'sc-corrupt', kind: 'control', tag: 'texto crudo', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'sc-corrupt', to: 'sc-input', kind: 'data', tensor: 'ids', fromSide: 'bottom', toSide: 'top', fromAt: 0.25, toAt: 0.5, label: false, aria: 'Ids de la entrada corrompida (texto con centinelas y </s>)' },
      { from: 'sc-corrupt', to: 'sc-target', kind: 'data', tensor: 'dec-ids', fromSide: 'bottom', toSide: 'top', fromAt: 0.75, toAt: 0.5, label: false, aria: 'Ids del objetivo (centinelas, tramos corrompidos y </s>)' },
      { from: 'sc-input', to: 'sc-model', kind: 'data', tensor: 'ids', fromAt: 0.5, toAt: 0.2, labelSide: 'left', labelT: 0.5, aria: 'Ids de la entrada corrompida, al encoder' },
      { from: 'sc-target', to: 'sc-model', kind: 'data', tensor: 'dec-ids', fromAt: 0.5, toAt: 0.82, label: false, tag: 'desplazado', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'sc-model', to: 'sc-loss', kind: 'data', tensor: 'logits', labelSide: 'right', labelT: 0.5 },
      { from: 'sc-target', to: 'sc-loss', kind: 'control', fromSide: 'right', toSide: 'right', via: [[103, 37], [103, 76]], tag: 'etiquetas', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
