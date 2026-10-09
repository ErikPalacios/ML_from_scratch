/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/whisper.js
   Diagramas de Whisper (SPEC §7.2, ids de §24.2), modelo `whisper` (js/arch/encdec.js), configs whisper-small (canónica),
   tiny, base, medium, large-v3 y distil-whisper-large-v3:
     whisper-overview  a la izquierda, el audio: onda a 16 kHz rellenada a 30 s → log-Mel (n_mels × 3,000 frames) → front end de
                       dos conv1d (la segunda con stride 2: 1,500 posiciones) + posición sinusoidal → encoder × L (corre UNA vez por
                       ventana de 30 s) → LayerNorm final = H. A la derecha, el texto: el prompt de tokens especiales + embedding
                       (tabla + posición aprendida de 448) → decoder × L_d (una vez POR TOKEN; cross-attention a H) → LayerNorm →
                       LM head atado → texto; el token elegido vuelve a la entrada. Abajo, el costo de una ventana (MACs y tiempo ≈):
                       el encoder se lleva casi todos los MACs, el decoder casi todo el tiempo.
     whisper-tokens    el formato multitarea del decoder (Figura 1 del paper): <|startofprev|> (opcional) → <|startoftranscript|> →
                       idioma → <|transcribe|> o <|translate|> → marcas de tiempo o <|notimestamps|> → texto → <|endoftext|>, con
                       cuatro secuencias de ejemplo.
   La capa del decoder es la de T5 con LayerNorm y sin sesgo relativo (ver #t5.diagrama~t5-decoder-layer). Solo datos: posiciones
   en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'whisper-small', CFGS = ['whisper-small', 'whisper-tiny', 'whisper-base', 'whisper-medium', 'whisper-large-v3', 'distil-whisper-large-v3'];
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 'whisper', section: 'diagrama' };
  const sp = (t) => ({ t, special: true });
  const PROMPT = [sp('<|startoftranscript|>'), sp('<|es|>'), sp('<|transcribe|>'), sp('<|notimestamps|>')];
  const LT = {
    tokens: 'Tokens de ejemplo (ilustrativo); borde punteado = token especial',
    tie: 'Pesos atados: el LM head usa la MISMA tabla de tokens (se cuenta una vez)',
    runs: 'Veces que corre al generar T_out tokens (una por token)',
    runsOnce: 'Corre una sola vez por ventana de 30 s',
    costSplit: 'Costo de una ventana de 30 s: ancho proporcional (del calculador)',
  };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'whisper-overview', model: 'whisper', config: C, configs: CFGS, kind: 'arch', title: 'Whisper — vista general',
    caption: 'Un encoder-decoder como T5, con un encoder de audio. Izquierda: el audio se rellena a 30 s, se convierte en un espectrograma log-Mel (un frame cada 10 ms), dos conv1d lo bajan a la mitad (una posición cada 20 ms) y el encoder lo lee entero, una vez por ventana. Derecha: el decoder genera el texto token por token a partir de un prompt de tokens especiales (idioma, tarea, marcas de tiempo) y mira la salida del encoder por cross-attention en cada capa (doble línea). Abajo: el encoder se lleva casi todos los MACs, pero el decoder casi todo el tiempo.',
    grid: { w: 112, h: 152 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['audio', 'mel', 'conv', 'prompt-tokens'],
    legendText: LT,
    groups: [
      { id: 'enc-group', label: 'Encoder (bidireccional)', x: 5, y: 51, w: 46, h: 19, repeat: { sym: 'L', from: 'L', totalOf: 'encoder' }, modality: 'aud' },
      { id: 'dec-group', label: 'Decoder (causal)', x: 63, y: 79, w: 40, h: 21, repeat: { sym: 'L_d', from: 'Ld', totalOf: 'decoder' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'audio', op: 'io', modality: 'aud', label: 'Audio · 16 kHz', x: 6, y: 1, w: 44, h: 11, wave: { pad: 0.6, seed: 31 },
        note: 'La onda a 16,000 muestras por segundo. Whisper SIEMPRE trabaja con ventanas de 30 s: si el audio es más corto se rellena con ceros (marco punteado) y si es más largo se corta en ventanas. Por eso la entrada al modelo tiene siempre {{cfg.samples}} muestras.' },
      { id: 'mel', op: 'tensorop', shape: 'rect', label: 'Log-Mel', sub: 'ventana 25 ms · salto 10 ms', subNum: '{{cfg.nMels}} bandas · salto de 10 ms', melGrid: { rows: 8, cols: 44, pad: 0.6, seed: 81 }, x: 6, y: 17, w: 44, h: 12,
        tex: 'M = \\log_{10} \\big( \\mathrm{Mel}\\, |\\mathrm{STFT}(x)|^2 \\big)', note: 'Preprocesamiento, sin parámetros: STFT con ventana de 25 ms cada 10 ms → potencia → {{cfg.nMels}} filtros mel (más finos en graves) → log10, recortado a 8 unidades del máximo y normalizado. Salen {{cfg.melFrames}} frames de 10 ms. No cuenta en los MACs del modelo.' },
      { id: 'conv', op: 'conv', style: 'block', label: 'Front end: 2 conv1d', x: 8, y: 35, w: 40, h: 10, runs: '× 1', runsTone: 'once',
        mini: { items: [{ label: 'conv k3', op: 'conv' }, { label: 'GELU', op: 'mlp' }, { label: 'conv k3 · s2', op: 'conv' }, { label: 'GELU', op: 'mlp' }, { sym: 'add' }, { label: 'seno', op: 'embed' }] },
        tex: '\\begin{aligned} h_1 &= \\mathrm{GELU}(\\mathrm{conv}_{k=3}(M)) \\\\ x_0 &= \\mathrm{GELU}(\\mathrm{conv}_{k=3,\\,s=2}(h_1)) + P_{\\sin} \\end{aligned}',
        note: 'Dos convoluciones 1-D sobre el tiempo con kernel 3: la primera pasa de {{cfg.nMels}} bandas a D canales; la segunda tiene stride 2 y deja la mitad de frames: {{cfg.encPos}} posiciones, una cada 20 ms. Después se suma una posición sinusoidal fija (un buffer, sin parámetros). Es lo único "de audio" de la arquitectura: el resto es un transformer estándar. Parámetros: {{metrics.frontendParams}}.' },
      { id: 'encoder', op: 'attn', style: 'block', badgeTotal: true, label: 'Capa del encoder', x: 8, y: 57, w: 40, h: 10, runs: '× 1', runsTone: 'once',
        mini: { items: [{ label: 'LN', op: 'norm' }, { label: 'self ↔', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] },
        tex: "\\begin{aligned} r &= x + \\mathrm{SA}(\\mathrm{LN}(x)) \\\\ y &= r + \\mathrm{MLP}(\\mathrm{LN}(r)) \\end{aligned}",
        costNote: 'Corre UNA vez por ventana de 30 s, aunque el audio dure menos.',
        note: 'Un bloque pre-LN estándar (como ViT): self-attention bidireccional entre las {{cfg.encPos}} posiciones y MLP con GELU. Corre una vez por ventana: {{metrics.encoderMacs}} con el front end, la misma cuenta con 3 s o con 30 s de voz (el relleno también se procesa).' },
      { id: 'enc-out', op: 'norm', label: 'LayerNorm final → H', sub: 'salida del encoder', x: 11, y: 75, w: 34, h: 7, runs: '× 1', runsTone: 'once',
        tex: 'H = \\mathrm{LN}(x_L) \\in \\mathbb{R}^{T_{in}\\times D}', note: 'H: un vector de D por cada 20 ms de audio. No cambia mientras se genera el texto: las K y V de la cross-attention de las {{cfg.Ld}} capas del decoder se calculan una vez ({{metrics.crossKvMacs}}) y se guardan ({{metrics.crossKvBytes}}).' },
      { id: 'prompt-tokens', op: 'embed', label: 'Prompt + embedding', sub: 'tabla V × D + posición aprendida', subNum: 'tabla {{cfg.V}} × {{cfg.D}} + posición {{cfg.Tmax}} × {{cfg.D}}', x: 58, y: 1, w: 46, h: 16,
        tokens: { items: PROMPT },
        xref: [{ href: '#whisper.diagrama~whisper-tokens.w-sot', label: 'Ver el formato de los tokens especiales' }],
        tex: 'y_0 = E[\\mathrm{ids}] + P_{\\mathrm{dec}}[0{:}T_{out}]', note: 'El decoder arranca con un prompt de tokens especiales que dice qué hacer: inicio, idioma, tarea (transcribir o traducir al inglés) y si poner marcas de tiempo. Embedding de tokens (atado al LM head) + posición APRENDIDA: como mucho {{cfg.Tmax}} posiciones en el decoder. El formato completo está en el diagrama de tokens.' },
      { id: 'decoder', op: 'attn', style: 'block', badgeTotal: true, label: 'Capa del decoder', x: 65, y: 85, w: 36, h: 11, runs: '× {{cfg.Tout}} pasos',
        mini: { items: [{ label: 'LN', op: 'norm' }, { label: 'self', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'cross', op: 'fuse' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5], [6, 8]] },
        xref: [{ href: '#t5.diagrama~t5-decoder-layer.cross-attn', label: 'Ver la capa por dentro (T5: misma estructura)' }],
        tex: "\\begin{aligned} a &= y + \\mathrm{SA}_{\\mathrm{causal}}(\\mathrm{LN}(y)) \\\\ b &= a + \\mathrm{CA}(\\mathrm{LN}(a), H) \\\\ y' &= b + \\mathrm{MLP}(\\mathrm{LN}(b)) \\end{aligned}",
        costNote: 'Al generar corre una vez por token: {{metrics.decoderMacsPerToken}} por token (con el LM head).',
        note: 'Igual que la capa del decoder de T5, con LayerNorm y sin sesgo relativo: self-attention causal entre los tokens de texto, cross-attention a H (Q del texto, K y V del audio) y MLP. Una vez por token: {{metrics.decoderLayerMacsPerToken}} en sus {{cfg.Ld}} capas.' },
      { id: 'dec-norm', op: 'norm', label: 'LayerNorm final', x: 68, y: 104, w: 30, h: 5, tex: '\\mathrm{LN}(y_{L_d})', note: 'Una última LayerNorm sobre la salida del decoder.' },
      { id: 'lm-head', op: 'head', label: 'LM head', sub: 'Eᵀ atada · sin reescalado', x: 66, y: 113, w: 34, h: 7, runs: '× {{cfg.Tout}}',
        tex: '\\mathrm{logits} = y\\, E^{\\top}', note: 'La tabla de tokens transpuesta (atada: 0 parámetros nuevos), sin el reescalado de T5. Un logit por token del vocabulario de {{cfg.V}} (texto BPE, idiomas, tareas y marcas de tiempo).' },
      { id: 'text', op: 'io', modality: 'txt', label: 'Texto (+ marcas)', sub: 'el token elegido vuelve', x: 68, y: 125, w: 30, h: 7,
        note: 'Del último logit se elige el siguiente token (greedy o beam de 5 en el paper, con fallback de temperatura). Puede ser texto, una marca de tiempo &lt;|t|&gt; o &lt;|endoftext|&gt;.' },
      { id: 'cost', op: 'io', label: 'Costo de una ventana (MACs)', hideInBlank: true, x: 2, y: 137, w: 54, h: 14,
        costSplit: { segs: [
          { tone: 'once', n: 'metrics.encoderMacs', label: 'Front end + encoder × 1' },
          { tone: 'once2', n: 'metrics.crossKvMacs', label: 'K, V de la cross-attention × 1' },
          { tone: 'loop', n: 'metrics.generationDecoderMacs', label: 'Decoder × {{cfg.Tout}} tokens' },
        ], caption: 'total {{metrics.totalGenerationMacs}} · 30 s de audio, T_out = {{cfg.Tout}}' },
        note: 'MACs de transcribir una ventana de 30 s con T_out tokens (del calculador). El encoder procesa {{cfg.encPos}} posiciones: es caro, pero corre una vez. Cada token del decoder es barato ({{metrics.decoderMacsPerToken}}).' },
      { id: 'cost-time', op: 'io', label: 'Tiempo ≈ en una H100 (cota)', hideInBlank: true, x: 58, y: 137, w: 52, h: 14,
        costSplit: { unit: 'ms', segs: [
          { tone: 'once', n: 'metrics.encoderMs', label: 'Encoder (cómputo)' },
          { tone: 'once2', n: 'metrics.crossKvMs', label: 'K, V de la cross' },
          { tone: 'loop', n: 'metrics.decoderMs', label: 'Decoder (memoria)' },
        ], caption: 'cota de roofline, no una medición: {{metrics.generationMs}} ms' },
        note: 'El mismo trabajo en tiempo (cota de roofline del calculador, sin overheads): el encoder es una matmul enorme (limitado por cómputo); cada paso del decoder procesa UN token y lee todos sus pesos (limitado por memoria). Por eso Distil-Whisper deja el encoder entero y recorta el decoder a 2 capas.' },
    ],
    notes: [
      { x: 4, y: 90, text: 'El encoder corre UNA vez por', cls: 'ink' },
      { x: 4, y: 92.4, text: 'ventana de 30 s (con relleno).' },
      { x: 4, y: 98, text: 'El decoder corre una vez', cls: 'ink' },
      { x: 4, y: 100.4, text: 'POR TOKEN y relee H en' },
      { x: 4, y: 102.8, text: 'cada capa (cross-attention).' },
      { x: 4, y: 108.4, text: '1 posición de H = 20 ms de audio', cls: 'ink' },
    ],
    tensors: [
      { id: 'mel', at: { edge: 'mel>conv' }, show: 'both' },
      { id: 'e-x0', at: { edge: 'conv>encoder' }, show: 'both' },
      { id: 'enc-out', at: { edge: 'enc-out>decoder' }, show: 'both' },
      { id: 'logits', at: { edge: 'lm-head>text' }, show: 'label' },
    ],
    edges: [
      { from: 'audio', to: 'mel', kind: 'data', tensor: 'audio-30s', labelSide: 'right', labelT: 0.5 },
      { from: 'mel', to: 'conv', kind: 'data', tensor: 'mel', labelT: 0.5 },
      { from: 'conv', to: 'encoder', kind: 'data', tensor: 'e-x0', labelT: 0.28 },
      { from: 'encoder', to: 'enc-out', kind: 'data', tensor: 'e-x-out', labelT: 0.7 },
      { from: 'enc-out', to: 'decoder', kind: 'cross', tensor: 'enc-out', fromSide: 'right', toSide: 'left', midX: 55, labelSeg: 1, labelSide: 'left', labelT: 0.55, tag: 'K,V', tagSeg: 2, tagT: 0.5 },
      { from: 'prompt-tokens', to: 'decoder', kind: 'data', tensor: 'd-x0', fromAt: 0.5435, labelT: 0.2 },
      { from: 'decoder', to: 'dec-norm', kind: 'data', tensor: 'd-x-out', labelT: 0.7 },
      { from: 'dec-norm', to: 'lm-head', kind: 'data', tensor: 'dec-out', labelSide: 'right', labelT: 0.5 },
      { from: 'lm-head', to: 'text', kind: 'data', tensor: 'logits', labelSide: 'left' },
      { from: 'text', to: 'prompt-tokens', kind: 'control', fromSide: 'right', toSide: 'right', toAt: 0.45, via: [[110.5, 128.5], [110.5, 8.2]], tag: 't → t+1', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.22 },
      { from: 'prompt-tokens', to: 'lm-head', kind: 'control', tie: true, fromSide: 'right', toSide: 'right', fromAt: 0.8, via: [[107, 13.8], [107, 116.5]], tag: 'E atada', tagBlank: 'pesos atados', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.35 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (Whisper small: una ventana de 30 s)', steps: [
        { nodes: ['audio', 'mel'], edges: ['audio>mel'], tensors: ['audio-30s'],
          text: 'El audio se rellena (o corta) a 30 s: <b>' + q('tensor.audio-30s.shape') + '</b> muestras a 16 kHz. El log-Mel (preprocesamiento, sin parámetros) da <b>' + q('tensor.mel.shape') + '</b>: ' + q('cfg.melFrames') + ' frames de 10 ms × ' + q('cfg.nMels') + ' bandas.' },
        { nodes: ['conv'], edges: ['mel>conv', 'conv>encoder'], tensors: ['mel', 'e-x0'],
          text: 'Conv1d k = 3: <b>' + q('tensor.conv1-out.shape') + '</b>; la segunda, con stride 2: <b>' + q('tensor.conv2-out.shape') + '</b>. Más la posición sinusoidal: x₀ = <b>' + q('tensor.e-x0.shape') + '</b>, una posición cada 20 ms. El front end: ' + q('metrics.frontendParams') + ' parámetros, ' + q('metrics.convMacs') + '.' },
        { nodes: ['encoder', 'enc-out'], edges: ['conv>encoder', 'encoder>enc-out'], tensors: ['e-x-out', 'enc-out'],
          text: 'Las ' + q('cfg.L') + ' capas del encoder (pre-LN, self-attention bidireccional: <b>' + q('tensor.e-scores.shape') + '</b> por capa) corren UNA vez por ventana: ' + q('metrics.encoderMacs') + ' con el front end. Sale H = <b>' + q('tensor.enc-out.shape') + '</b>.' },
        { nodes: ['enc-out', 'decoder'], edges: ['enc-out>decoder'], tensors: ['enc-out'],
          text: 'Antes del primer token, cada capa del decoder proyecta H a K y V (<b>' + q('tensor.c-k-heads.shape') + '</b> por capa): ' + q('metrics.crossKvMacs') + ' y ' + q('metrics.crossKvBytes') + ' guardados, una sola vez.' },
        { nodes: ['prompt-tokens'], edges: ['prompt-tokens>decoder'], tensors: ['d-x0'],
          text: 'El decoder arranca con el prompt de ' + q('cfg.promptTokens') + ' tokens especiales (inicio, idioma, tarea, sin marcas de tiempo). Embedding de tokens + posición aprendida: <b>' + q('tensor.d-x0.shape') + '</b> con las T_out = ' + q('cfg.Tout') + ' posiciones del entrenamiento en paralelo.' },
        { nodes: ['decoder'], edges: ['prompt-tokens>decoder', 'enc-out>decoder', 'decoder>dec-norm'], tensors: ['d-x0', 'enc-out', 'd-x-out'],
          text: 'Cada capa: self-attention causal entre los tokens (<b>' + q('tensor.d-scores.shape') + '</b>) y cross-attention al audio (<b>' + q('tensor.c-scores.shape') + '</b>: cada token mira las ' + q('cfg.encPos') + ' posiciones). Un token cuesta ' + q('metrics.decoderMacsPerToken') + ', ' + q('metrics.encoderVsToken') + ' veces menos que el encoder.' },
        { nodes: ['dec-norm', 'lm-head', 'text'], edges: ['decoder>dec-norm', 'dec-norm>lm-head', 'lm-head>text', 'text>prompt-tokens'], tensors: ['logits'],
          text: 'LayerNorm, LM head atado (<b>' + q('tensor.logits.shape') + '</b> logits) y se elige el token, que vuelve a la entrada. Se repite hasta &lt;|endoftext|&gt; o ' + q('cfg.Tmax') + ' posiciones.' },
        { nodes: ['cost', 'cost-time'], edges: [], tensors: [],
          text: 'Una ventana con ' + q('cfg.Tout') + ' tokens: ' + q('metrics.totalGenerationMacs') + ', ' + q('metrics.encoderShare') + ' en el encoder. En tiempo (cota en una H100): encoder ' + q('metrics.encoderMs') + ' ms, decoder ' + q('metrics.decoderMs') + ' ms. El decoder, limitado por memoria, es el cuello de botella: ≈ ' + q('metrics.speedVsRealtime') + ' veces más rápido que el tiempo real en esta cota.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (a') formato multitarea de los tokens
  const ex = (items) => ({ items });
  ATLAS.registerDiagram(Object.assign({
    id: 'whisper-tokens', model: 'whisper', config: C, configs: [C], configsNote: 'el formato de tokens es el mismo en todos los tamaños', kind: 'arch', title: 'Whisper — formato multitarea del decoder',
    caption: 'Una sola red hace varias tareas porque el decoder recibe la tarea como tokens especiales (Figura 1 del paper): inicio, idioma (o "sin voz"), transcribir o traducir al inglés, y marcas de tiempo o no. Todo lo que va antes del texto se puede forzar (el prompt) o dejar que el modelo lo prediga (por ejemplo, el idioma). Abajo, cuatro secuencias de ejemplo.',
    grid: { w: 104, h: 92 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['w-prev', 'w-sot', 'w-lang'],
    legendText: Object.assign({}, LT, { tokens: 'Tokens de ejemplo; borde punteado = token especial' }),
    nodes: [
      { id: 'w-prev', op: 'io', label: '<|startofprev|>', sub: 'texto previo (opcional)', x: 1, y: 3, w: 22, h: 8,
        note: 'Opcional: el texto de la ventana anterior, precedido por &lt;|startofprev|&gt;, como contexto (hasta la mitad del contexto del decoder). Ayuda a mantener nombres y estilo entre ventanas de 30 s; el modelo no lo predice, solo lo lee.' },
      { id: 'w-sot', op: 'io', label: '<|startoftranscript|>', sub: 'inicio', x: 26, y: 3, w: 24, h: 8,
        note: 'Empieza la transcripción. El siguiente token es el idioma, o &lt;|nospeech|&gt; si no hay voz en la ventana (en algunos tokenizers se llama &lt;|nocaptions|&gt;): su probabilidad se usa como detector de silencio.' },
      { id: 'w-lang', op: 'io', label: '<|es|>', sub: 'idioma: 99 (100 en v3)', x: 53, y: 3, w: 22, h: 8,
        note: 'Un token por idioma (99; large-v3 agrega cantonés). Si no se fuerza, el modelo lo predice: así es como Whisper detecta el idioma (una sola pasada del decoder con el prompt &lt;|startoftranscript|&gt;).' },
      { id: 'w-task', op: 'io', label: '<|transcribe|>', sub: 'o <|translate|> (→ inglés)', x: 78, y: 3, w: 25, h: 8,
        note: 'La tarea: transcribir en el mismo idioma o traducir al inglés (solo hacia el inglés: es lo que había en los datos).' },
      { id: 'w-ts', op: 'io', label: '<|0.00|>', sub: 'marcas cada 20 ms', x: 1, y: 19, w: 22, h: 8,
        note: 'Con marcas de tiempo, cada segmento de texto va entre dos tokens de tiempo, relativos al inicio de la ventana y cuantizados a 20 ms (una posición del encoder): &lt;|0.00|&gt; … &lt;|30.00|&gt;. Sin marcas, el prompt lleva &lt;|notimestamps|&gt; y el texto va directo.' },
      { id: 'w-text', op: 'io', modality: 'txt', label: 'Texto (BPE)', sub: '" Hoy vamos a ver"', x: 28, y: 19, w: 24, h: 8,
        note: 'Los tokens de texto: el BPE byte-level de GPT-2 (en los modelos multilingües, con el vocabulario re-ajustado al mismo tamaño). La pérdida del entrenamiento se calcula sobre estos tokens (y las marcas), no sobre el prompt.' },
      { id: 'w-ts-end', op: 'io', label: '<|1.50|>', sub: 'fin del segmento', x: 56, y: 19, w: 20, h: 8,
        note: 'La marca de fin del segmento. Después puede venir otro segmento (otra marca de inicio) o el fin.' },
      { id: 'w-eot', op: 'io', label: '<|endoftext|>', sub: 'fin', x: 80, y: 19, w: 23, h: 8, note: 'Termina la generación de esta ventana.' },
      { id: 'w-dec', op: 'embed', label: 'Embedding del decoder', sub: 'toda la secuencia: tokens + posición', costOf: 'prompt-tokens', x: 58, y: 33, w: 45, h: 8,
        note: 'Todos estos tokens (prompt, texto y marcas) son ids de la MISMA tabla del decoder ({{cfg.V}} entradas) más la posición aprendida: la secuencia entera no puede pasar de {{cfg.Tmax}} posiciones. Después, las capas del decoder de la vista general.' },
      { id: 'ex-asr', op: 'io', label: 'Transcribir (es) con marcas', x: 1, y: 45, w: 102, h: 9,
        tokens: ex([sp('<|startoftranscript|>'), sp('<|es|>'), sp('<|transcribe|>'), sp('<|0.00|>'), { t: ' Hoy' }, { t: ' vamos' }, { t: ' a' }, { t: ' ver' }, sp('<|1.50|>'), sp('<|endoftext|>')]),
        note: 'La forma más común: transcripción con segmentos marcados en el tiempo.' },
      { id: 'ex-translate', op: 'io', label: 'Traducir al inglés', x: 1, y: 56, w: 102, h: 9,
        tokens: ex([sp('<|startoftranscript|>'), sp('<|es|>'), sp('<|translate|>'), sp('<|notimestamps|>'), { t: ' Today' }, { t: ' we' }, { t: ' will' }, { t: ' see' }, sp('<|endoftext|>')]),
        note: 'El audio en español, el texto en inglés: el mismo modelo, otra tarea en el prompt.' },
      { id: 'ex-prev', op: 'io', label: 'Con la ventana anterior', x: 1, y: 67, w: 102, h: 9,
        tokens: ex([sp('<|startofprev|>'), { t: ' …y' }, { t: ' eso' }, { t: ' fue' }, { t: ' todo.' }, sp('<|startoftranscript|>'), sp('<|es|>'), sp('<|transcribe|>'), sp('<|notimestamps|>'), { t: ' Hoy' }, { t: ' …' }]),
        note: 'Para audios largos: cada ventana de 30 s recibe como prompt el texto de la anterior.' },
      { id: 'ex-nospeech', op: 'io', label: 'Ventana sin voz', x: 1, y: 78, w: 102, h: 9,
        tokens: ex([sp('<|startoftranscript|>'), sp('<|nospeech|>'), sp('<|endoftext|>')]),
        note: 'Si no hay voz, el modelo predice &lt;|nospeech|&gt; en lugar del idioma: en la práctica se mira esa probabilidad (con un umbral) para saltar ventanas de silencio.' },
    ],
    edges: [
      { from: 'w-prev', to: 'w-sot', kind: 'control' },
      { from: 'w-sot', to: 'w-lang', kind: 'control' },
      { from: 'w-lang', to: 'w-task', kind: 'control' },
      { from: 'w-task', to: 'w-ts', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.5, midY: 15 },
      { from: 'w-ts', to: 'w-text', kind: 'control' },
      { from: 'w-text', to: 'w-ts-end', kind: 'control' },
      { from: 'w-ts-end', to: 'w-eot', kind: 'control' },
      { from: 'w-eot', to: 'w-dec', kind: 'data', tensor: 'dec-ids', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.74444, labelSide: 'right', labelT: 0.5, tag: 'ids de toda la secuencia', tagStyle: 'plain', tagSide: 'left', tagT: 0.5 },
    ],
    notes: [
      { x: 1, y: 42.5, text: 'Ejemplos (los tokens especiales, con borde punteado):', cls: 'ink' },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
