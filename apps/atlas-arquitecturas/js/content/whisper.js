/* =============================================================================
   Atlas de Arquitecturas — js/content/whisper.js
   Página de modelo: Whisper (Radford et al., ICML 2023, arXiv:2212.04356), canónica whisper-small, y
   Distil-Whisper (Gandhi et al., arXiv:2311.00430). Plantilla fija de 11 secciones (SPEC §5.3, §24.2).
   Tesis de la fase (SPEC §24): el tercer sabor de transformer. Un encoder lee la entrada entera una vez;
   un decoder causal genera token a token mirándola por cross-attention. Whisper lo muestra con audio y
   deja a la vista la asimetría de costo: el encoder corre una vez por ventana de 30 s, el decoder una vez
   por token, y las K, V de la cross-attention se calculan una sola vez por ventana.
   Regla: ningún número de la arquitectura se escribe a mano: formas, parámetros, MACs y bytes salen del
   calculador (js/arch/encdec.js: bloques op/trace/params/flops/scaling/compare y {{config.ruta}}, SPEC §6.6).
   Resultados de papers citan sección o tabla; hardware con su hoja de datos; estimaciones con est().
   Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';
  // Tokens especiales en prosa: <code>&lt;|x|&gt;</code> (el validador no admite "<" sin escapar).
  const tk = (s) => '<code>&lt;|' + s + '|&gt;</code>';

  // Configuraciones del calculador (js/arch/encdec.js, SPEC §24.2).
  const C = 'whisper-small';
  const TI = 'whisper-tiny';
  const BA = 'whisper-base';
  const ME = 'whisper-medium';
  const LG = 'whisper-large-v3';
  const DI = 'distil-whisper-large-v3';

  // Claves de metrics() del calculador: un solo lugar para adaptarlas.
  const MK = {
    encMacs: 'encoderMacs', decTok: 'decoderMacsPerToken', crossKvMacs: 'crossKvMacs',
    crossKv: 'crossKvBytes', selfKv: 'selfKvCacheBytes', gen: 'totalGenerationMacs', encShare: 'encoderShare',
    crossShare: 'crossKvShare', decShare: 'decoderShare', genDec: 'generationDecoderMacs',
    rtf: 'realtimeFactor', speed: 'speedVsRealtime', genMs: 'generationMs', encMs: 'encoderMs', decMs: 'decoderMs', stepMs: 'decoderStepMs',
    encP: 'encoderParams', decP: 'decoderParams', embP: 'sharedEmbedParams', posP: 'decoderPosParams',
    crossP: 'crossAttnParams', crossPL: 'crossAttnParamsLayer', convP: 'frontendParams', frames: 'melFrames', pos: 'encoderPositions',
    pad: 'paddingShare', wasted: 'wastedEncoderMacs', hf: 'paramsHF', vsTok: 'encoderVsToken', lm: 'lmHeadMacsPerToken',
    encL: 'encoderLayerParams', decL: 'decoderLayerParams', crossTok: 'decoderCrossMacsPerToken',
  };
  // Claves de la config (cfg.<k>).
  const CK = { L: 'L', Ld: 'Ld', D: 'D', h: 'h', dh: 'dh', Dmlp: 'Dmlp', V: 'V', mels: 'nMels', posDec: 'Tmax', Tout: 'Tout', sec: 'seconds', B: 'B', prompt: 'promptTokens' };
  // Ids de tensores del calculador (contrato con el diagrama whisper-overview y el trace).
  const T = {
    audio: 'audio', a30: 'audio-30s', mel: 'mel', c1: 'conv1-out', conv: 'conv2-act', x0: 'e-x0', ex: 'e-x-out', enc: 'enc-out',
    prompt: 'dec-ids', dx0: 'd-x0', dx: 'd-x-out', dec: 'dec-out', logits: 'logits', ck: 'c-k', cv: 'c-v', cs: 'c-scores',
  };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const cf = (k, cfg) => qn('cfg.' + (CK[k] || k), cfg);
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const sh = (id, cfg) => qn('tensor.' + (T[id] || id) + '.shape', cfg);
  const sy = (id, cfg) => qn('tensor.' + (T[id] || id) + '.sym', cfg);

  const PAPER = 'Radford, Kim, Xu, Brockman, McLeavey y Sutskever, <i>Robust Speech Recognition via Large-Scale Weak Supervision</i>, ICML 2023, arXiv:2212.04356';
  const DISTIL = 'Gandhi, von Platen y Rush, <i>Distil-Whisper: Robust Knowledge Distillation via Large-Scale Pseudo Labelling</i>, arXiv:2311.00430 (2023)';
  const SPECD = 'Leviathan, Kalman y Matias, <i>Fast Inference from Transformers via Speculative Decoding</i>, ICML 2023, arXiv:2211.17192';
  const WX = 'Bain, Huh, Han y Zisserman, <i>WhisperX: Time-Accurate Speech Transcription of Long-Form Audio</i>, Interspeech 2023, arXiv:2303.00747';
  const WS = 'Macháček, Dabre y Bojar, <i>Turning Whisper into Real-Time Transcription System</i>, IJCNLP-AACL 2023 (demo), arXiv:2307.14743';
  const CARELESS = 'Koenecke, Choi, Mei, Schellmann y Sloane, <i>Careless Whisper: Speech-to-Text Hallucination Harms</i>, ACM FAccT 2024, arXiv:2402.08021';
  const V3CARD = 'model card de <code>openai/whisper-large-v3</code> (Hugging Face)';
  const TURBO = 'model card de <code>openai/whisper-large-v3-turbo</code> y el anuncio en GitHub (openai/whisper, discusión #2363)';
  const DV3CARD = 'model card de <code>distil-whisper/distil-large-v3</code> (Hugging Face)';
  const H100 = 'hoja de datos de NVIDIA H100 SXM: 989 TFLOPS densos en bf16 y 3.35 TB/s de HBM3';

  ATLAS.register({
    id: 'whisper',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> Whisper recibe hasta 30 segundos de audio (mono, 16 kHz), lo convierte en un espectrograma log-Mel y devuelve <b>texto</b>: la transcripción en el idioma hablado, o su traducción al inglés, opcionalmente con marcas de tiempo por segmento. El mismo modelo además detecta el idioma y decide si hay voz. Todo eso lo elige una secuencia de tokens especiales al principio del decoder, no cabezas distintas.` },
          { t: 'p', html: R`Es un <b>encoder-decoder</b> como el Transformer original: el encoder lee la ventana entera de audio una vez, en paralelo; el decoder es un modelo de lenguaje causal que genera los tokens del texto uno por uno y, en cada capa, mira al audio con cross-attention. La canónica del Atlas es Whisper small (${cf('L')} + ${cf('L')} capas, D = ${cf('D')}, ${qn('params.total')} parámetros en el calculador). La idea del paper (${PAPER}) no es arquitectónica: es de datos. 680,000 horas de audio con transcripciones de internet, sin limpiar a mano (<b>supervisión débil</b>), y evaluación <b>zero-shot</b> en datasets que el modelo nunca vio.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Whisper?', 'Por qué'], rows: [
            ['Transcribir archivos (reuniones, llamadas, podcasts, videos) en lote', 'Sí', 'Robusto a ruido, acentos y micrófonos sin ajustar nada; se paraleliza por ventanas de 30 s.'],
            ['Subtítulos con tiempos por frase', 'Sí', R`Predice tokens de tiempo cada 20 ms (${tk('0.00')} … ${tk('30.00')}) al inicio y al final de cada segmento.`],
            ['Audio en español u otro de sus 99 idiomas', 'Sí, midiendo', 'La calidad cae con las horas de entrenamiento por idioma: en idiomas con poco audio el WER sube mucho (§3.4 y Fig. 3 del paper).'],
            ['Traducir audio de otro idioma al inglés', 'Sí', R`Tarea ${tk('translate')}. Solo hacia el inglés; para otro destino, transcribe y traduce con un LLM o un modelo de traducción.`],
            ['Agente de voz con respuesta en menos de 300 ms', 'Con cuidado', 'No es un modelo streaming: procesa ventanas de 30 s con relleno. Se fuerza con re-decodificación sobre un buffer (Whisper-Streaming reporta ≈ 3.3 s de latencia) o se usa un modelo streaming (CTC / transducer).'],
            ['Quién habló cuándo (diarización)', 'No', 'No modela hablantes. Se combina con un modelo de diarización (p. ej. pyannote) y se alinean los tiempos.'],
            ['Tiempos exactos por palabra', 'Con ayuda', 'Los tiempos nativos son por segmento. Por palabra: DTW sobre los pesos de cross-attention de algunas cabezas, o alineación forzada con un modelo de fonemas (WhisperX).'],
            ['Audio con mucho silencio, música o ruido', 'Con VAD antes', 'Es la condición donde más alucina: genera texto fluido que nadie dijo. Corta con un detector de voz (VAD) antes de transcribir.'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Whisper is an encoder-decoder transformer for speech. The audio is resampled to sixteen kilohertz, padded to thirty seconds and turned into an eighty-bin log-Mel spectrogram with a ten-millisecond hop, so three thousand frames. Two 1-D convolutions, the second with stride two, give fifteen hundred encoder positions. The decoder is a causal language model over a byte-level BPE vocabulary that cross-attends to the encoder output, and special tokens at the start choose the language, transcription versus translation, and whether to predict timestamps. What made it work is data, not architecture: six hundred eighty thousand hours of weakly supervised audio-transcript pairs, evaluated zero-shot."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como T5, pero la entrada es audio; como ViT, pero los "patches" son tiras de tiempo.</b> Ya tienes casi todo. Del <a href="#repaso-atencion.tres-sabores">repaso de atención</a>: los tres sabores de transformer, y Whisper es el tercero (encoder bidireccional + decoder causal con cross-attention). De <a href="#vit">ViT</a>: una convolución que convierte una señal densa en una secuencia de vectores de ancho D, más posiciones, más L bloques pre-LN. Del <a href="#llm-decoder">decoder de un LLM</a>: la mitad de abajo de Whisper <i>es</i> un modelo de lenguaje con KV cache, tokenizador BPE de GPT-2 y logits sobre el vocabulario. Lo único que agrega cada capa del decoder es una cross-attention al audio, como las queries de <a href="#detr">DETR</a> miran el mapa de features de la imagen.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de Whisper', head: ['Concepto', 'Donde ya lo viste', 'En Whisper', '¿Nuevo?'], rows: [
            ['Señal → tokens', 'ViT: conv 16×16 con stride 16 → 196 vectores', R`Espectrograma de ${sh('mel')} (frames × bins de Mel) → 2 conv1d (la segunda con stride 2) → ${sh('x0')}`, 'Equivale (en 1-D)'],
            ['Posiciones del encoder', 'ViT: tabla aprendida', 'Sinusoidales fijas (como el Transformer original); no se entrenan', 'Distinto'],
            ['Bloque', 'ViT, GPT-2: pre-LN, GELU, LN final', 'Igual en encoder y decoder', 'Igual'],
            ['Decoder de texto', 'LLM: causal, KV cache, BPE, pesos atados', R`Igual, con posiciones aprendidas hasta ${cf('posDec')} tokens y vocabulario de ${cf('V')}`, 'Igual'],
            ['Cross-attention', 'DETR: queries que miran la imagen; SD: la imagen que mira al texto', 'Cada capa del decoder: Q del texto, K y V de la salida del encoder', 'Igual que en T5'],
            ['Tarea elegida por tokens', 'LLM: el prompt', R`${tk('startoftranscript')} ${tk('es')} ${tk('transcribe')} ${tk('notimestamps')}: el "prompt" es un formato fijo`, '<b>Nuevo</b>'],
            ['Datos', 'ImageNet: etiquetas limpias', '680,000 h de pares audio-texto de internet, filtrados con heurísticas', '<b>Nuevo</b> (la tesis del paper)'],
          ] },
          { t: 'callout', kind: 'trap', title: '"El espectrograma es una imagen y Whisper usa una CNN 2-D"', html: R`<p>No. El log-Mel es una matriz de ${sh('mel')} (frames × bins) y se puede dibujar como imagen, pero Whisper lo trata como una señal 1-D de ${cf('mels')} <b>canales</b> a lo largo del tiempo: las dos convoluciones son <code>Conv1d</code> con kernel 3 sobre el eje temporal y cada bin de Mel es un canal de entrada. No hay invariancia a traslación en frecuencia (subir el tono no "mueve" un patrón). Al revés que ViT, el stride total es solo 2: cada posición del encoder cubre 20 ms de audio.</p>` },
          { t: 'h3', text: 'Encoder-decoder vs decoder-only para audio' },
          { t: 'p', html: R`¿Por qué no un LLM decoder-only con el audio como prefijo? Se puede (es lo que hacen los LLM multimodales con audio), pero el encoder-decoder tiene una ventaja de costo concreta: el audio se procesa <b>una vez</b> con atención bidireccional y después cada token de texto solo paga su capa de decoder más una cross-attention contra K, V ya calculadas. En un decoder-only, los ${met('pos')} vectores de audio serían parte del contexto de cada capa del modelo grande, con su KV cache. La contracara: un encoder-decoder no reutiliza el conocimiento de un LLM preentrenado gigante.` },
          { t: 'callout', kind: 'connect', html: R`<p>La cross-attention, con números, está en el <a href="#repaso-atencion.tres-sabores">repaso de atención</a>; el mismo encoder-decoder sobre texto es <a href="#t5">T5</a>. El KV cache y la decodificación especulativa, en general, en <a href="#llm-inferencia.inferencia">inferencia de LLMs</a>: aquí se ve qué cambia cuando una parte del contexto (el audio) es fija.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`A la izquierda, el encoder: audio → log-Mel → dos convoluciones → posiciones sinusoidales → ${cf('L')} bloques → la salida del encoder, que se calcula una vez por ventana. A la derecha, el decoder: los tokens de tarea (el "prompt"), ${cf('L')} bloques con self-attention causal y cross-attention a la salida del encoder, y la cabeza que da logits sobre el vocabulario. La flecha que cruza es la única conexión: K y V de cada capa del decoder salen de la misma ${sh('enc')}. Abajo, el costo de una ventana en MACs y en tiempo: el encoder se lleva casi todos los MACs y el decoder casi todo el tiempo. "Recorrido" sigue una ventana de 30 s con números.` },
          { t: 'archdiagram', diagram: 'whisper-overview', walk: 'forward', wide: true, caption: R`Whisper small: ${cf('L')} + ${cf('L')} capas, D = ${cf('D')}, ${cf('h')} cabezas, D<sub>mlp</sub> = ${cf('Dmlp')}, ${cf('mels')} bins de Mel, vocabulario de ${cf('V')}. Formas del calculador para una ventana de 30 s.` },
          { t: 'p', html: R`<b>De la onda a las posiciones del encoder</b> (nodos <a href="#whisper.diagrama~mel">log-Mel</a> y <a href="#whisper.diagrama~conv">front end</a>). 30 s a 16 kHz son ${sh('a30')} muestras. La STFT usa ventanas de 25 ms (400 muestras) cada 10 ms (160 muestras): ${met('frames')} frames. Cada frame se resume en ${cf('mels')} energías en bandas de Mel (más finas en graves, más gruesas en agudos, como el oído) en escala logarítmica. La segunda convolución, con stride 2, deja ${met('pos')} posiciones: una cada 20 ms.` },
          { t: 'viz', kind: 'mel-spectrogram', params: { config: C, seconds: 3 }, caption: 'El audio es sintético (sílabas con armónicos, fricativas y pausas; no es una grabación); el procesamiento es el de Whisper (STFT de 400 con salto de 160, filtros de Mel, log10, recorte y escala). Cambia la duración: 3 s también se rellenan a 30 s y dan las mismas posiciones del encoder.' },
          { t: 'h3', text: 'El formato multitarea' },
          { t: 'p', html: R`El decoder no recibe una instrucción en lenguaje natural: recibe un <b>formato fijo</b> de tokens especiales, y lo que predice después depende de ese formato.` },
          { t: 'archdiagram', diagram: 'whisper-tokens', caption: R`La secuencia del decoder (§2.3 del paper): ${tk('startoftranscript')}, idioma, tarea, ${tk('notimestamps')} o tiempos, texto y ${tk('endoftext')}. Opcionalmente, el texto de la ventana anterior va antes, detrás de ${tk('startofprev')}, y no lleva pérdida.` },
          { t: 'table', caption: 'Tokens especiales (vocabulario multilingüe de whisper-small; ids de su generation_config)', head: ['Token', 'Id', 'Qué hace'], rows: [
            [tk('endoftext'), '50257', 'Fin de la transcripción (también se usa como padding).'],
            [tk('startoftranscript'), '50258', 'Inicio: el decoder siempre arranca aquí.'],
            [R`${tk('en')}, ${tk('es')}, …`, '50259, 50262, …', '99 idiomas (100 en large-v3, que agrega cantonés). Si no se fija, el modelo lo predice: es la detección de idioma.'],
            [R`${tk('translate')} / ${tk('transcribe')}`, '50358 / 50359', 'Traducir al inglés o transcribir en el idioma hablado.'],
            [tk('startofprev'), '50361', 'Marca el texto previo (contexto de la ventana anterior o un prompt de vocabulario).'],
            [tk('nospeech'), '50362', 'Si el modelo lo predice con probabilidad alta, la ventana no tiene voz.'],
            [tk('notimestamps'), '50363', 'Texto sin tiempos.'],
            [R`${tk('0.00')} … ${tk('30.00')}`, '50364 … 51864', '1,501 tokens de tiempo, cada 20 ms, relativos al inicio de la ventana.'],
          ], note: R`En large-v3 los ids desde ${tk('translate')} se corren en uno por el token de cantonés (vocabulario de ${cf('V', LG)}).` },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación. Una persona dice "hola, ¿cómo estás?" en 2 segundos. Whisper rellena con ceros hasta 30 s, calcula ${met('frames')} frames de ${cf('mels')} números, los pasa por dos convoluciones que dejan ${met('pos')} vectores de ${cf('D')}, les suma una posición fija y los mezcla en ${cf('L')} capas: sale ${sh('enc')}, una "memoria" del audio. El decoder arranca con 4 tokens (${tk('startoftranscript')} ${tk('es')} ${tk('transcribe')} ${tk('notimestamps')}), predice "Hola", lo agrega, predice ",", y así hasta ${tk('endoftext')}. En cada paso, cada capa del <a href="#whisper.diagrama~decoder">decoder</a> mira a sus tokens anteriores (causal) y a los ${met('pos')} vectores del audio (cross-attention). La capa es la misma que la del decoder de <a href="#t5">T5</a>, con LayerNorm en vez de RMSNorm y sin sesgo de posición relativa.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Whisper small'], rows: [
            ['F', 'frames del log-Mel (30 s / 10 ms)', met('frames')],
            ['n<sub>mel</sub>', 'bins de Mel (canales de entrada)', cf('mels')],
            ['N', 'posiciones del encoder (F / 2)', met('pos')],
            ['D, h, d<sub>h</sub>', 'ancho, cabezas, ancho por cabeza', R`${cf('D')}, ${cf('h')}, ${cf('dh')}`],
            ['D<sub>mlp</sub>', 'ancho de la FFN (4D)', cf('Dmlp')],
            ['L', 'capas del encoder = capas del decoder (salvo Distil-Whisper y turbo)', cf('L')],
            ['T', 'tokens del decoder (prompt + texto generado); máximo P<sub>dec</sub>', R`T ≤ ${cf('posDec')}`],
            ['V', 'vocabulario (BPE de bytes + especiales + tiempos)', cf('V')],
          ] },

          { t: 'h3', text: 'Front end: log-Mel' },
          { t: 'op', block: 'mel', model: 'whisper', diagram: 'whisper-overview', title: 'Espectrograma log-Mel con relleno a 30 s',
            tex: R`S = |\mathrm{STFT}_{400,\,160}(\mathrm{pad}_{30\,\mathrm{s}}(x))|^2,\quad M = \log_{10}\!\big(\max(W_\text{mel} S,\ 10^{-10})\big),\quad \tilde M = \frac{\max(M,\ \max M - 8) + 4}{4}`,
            in: [T.audio], out: [T.mel], params: true, flops: true,
            what: R`${sh('a30')} muestras (ya rellenadas a 30 s) → ${sh('mel')} (frames × bins). W<sub>mel</sub> es un banco fijo de ${cf('mels')} filtros triangulares: no hay parámetros. El recorte a "máximo − 8" (80 dB de rango) y el (· + 4)/4 dejan los valores en ≈ [−1, 1], como dice el §2.2.`,
            why: R`La escala de Mel comprime los agudos como el oído; el logaritmo convierte ganancias del micrófono en desplazamientos y comprime el rango dinámico. El relleno a 30 s existe porque el modelo se entrenó <b>siempre</b> con ventanas de 30 s: el encoder de HF rechaza otra longitud (pide exactamente ${met('frames')} frames).` },
          { t: 'callout', kind: 'trap', title: '"Con un clip de 3 s, el encoder hace 1/10 del trabajo"', html: R`<p>No: el clip se rellena con silencio hasta 30 s y el encoder procesa los mismos ${met('pos')} vectores. Un comando de voz de 3 s paga ${met('encMacs')} de encoder igual que 30 s de habla continua (el ${met('pad')} de ese cómputo es relleno con s = 3; muévelo en el explorador de <a href="#whisper.costo">costo</a>). Recortar el encoder a la longitud real se puede, pero con el modelo original degrada la transcripción: las posiciones sinusoidales y la atención aprendieron siempre una ventana de 30 s.</p>` },

          { t: 'h3', text: 'Convoluciones de entrada y posiciones' },
          { t: 'op', block: 'conv', model: 'whisper', diagram: 'whisper-overview', title: 'Dos conv1d con GELU; la segunda con stride 2',
            tex: R`H_1 = \mathrm{GELU}\big(\mathrm{Conv1d}_{k=3,\,s=1}(\tilde M)\big),\quad H_2 = \mathrm{GELU}\big(\mathrm{Conv1d}_{k=3,\,s=2}(H_1)\big),\quad X_0 = H_2^\top + P_\text{sin}`,
            in: [T.mel], out: [T.x0], params: true, flops: true,
            what: R`${sh('mel')} → ${sh('c1')} (n<sub>mel</sub> → D, misma longitud) → ${sh('conv')} (stride 2, padding 1: ⌊(3000 + 2 − 3)/2⌋ + 1 = ${met('pos')}). Después, la tabla sinusoidal de ${met('pos')} × ${cf('D')}, fija, se suma.`,
            why: R`La primera conv mezcla bins vecinos en el tiempo y sube a D canales; la segunda reduce a la mitad la longitud, y con ella el costo de la atención (N² baja ×4). Las posiciones sinusoidales no se aprenden: en HF el <code>embed_positions</code> del encoder es un parámetro congelado (<code>requires_grad = False</code>), así que <code>model.parameters()</code> lo cuenta aunque no se entrene; el calculador sigue la regla del Atlas y no lo cuenta.` },

          { t: 'h3', text: 'Bloque del encoder (pre-LN)' },
          { t: 'op', block: 'encoder', model: 'whisper', diagram: 'whisper-overview', title: 'Self-attention bidireccional + FFN, LayerNorm antes de cada sub-bloque',
            tex: R`\begin{aligned} H &= X + \mathrm{MHSA}\big(\mathrm{LN}(X)\big) \\ X' &= H + W_2\,\mathrm{GELU}\big(W_1\,\mathrm{LN}(H) + b_1\big) + b_2 \end{aligned}`,
            in: [T.x0], out: [T.ex], params: true, flops: true,
            what: R`Una capa ${sh('x0')} → ${sh('ex')}, repetida ${cf('L')} veces; después, una LayerNorm final: ${sh('enc')}. Sin máscara: cada posición ve los 30 s completos.`,
            why: R`Bidireccional porque el audio está completo: para reconocer una sílaba ayuda lo que viene después. Pre-LN, como GPT-2 y ViT, con LN final. Un detalle de implementación: la proyección K no tiene bias (en HF, <code>k_proj</code> con <code>bias=False</code>) y Q, V y la salida sí; un bias en K sumaría la misma constante a todos los scores de una query y el softmax lo cancela.` },

          { t: 'h3', text: 'Bloque del decoder: causal + cross-attention' },
          { t: 'op', block: 'decoder', model: 'whisper', diagram: 'whisper-overview', title: 'Self-attention causal, cross-attention al audio y FFN',
            tex: R`\begin{aligned} Y_0 &= E_\text{tok}[\text{ids}] + P_\text{dec}[0{:}T] \\ H &= Y + \mathrm{MHSA}_\text{causal}\big(\mathrm{LN}(Y)\big) \\ G &= H + \mathrm{softmax}\!\Big(\tfrac{(\mathrm{LN}(H)W_Q)(Z W_K)^\top}{\sqrt{d_h}}\Big)(Z W_V)\,W_O \\ Y' &= G + \mathrm{FFN}\big(\mathrm{LN}(G)\big) \end{aligned}`,
            in: [T.dx0, T.enc], out: [T.dx], params: true, flops: true,
            what: R`Z = ${sh('enc')} es la salida del encoder. Las queries vienen del texto (${sh('dx0')} con T<sub>out</sub> = ${cf('Tout')}) y las keys y values del audio (${met('pos')} × D): la matriz de scores por cabeza es T × ${met('pos')}, rectangular y sin máscara. Por capa, Z W<sub>K</sub> y Z W<sub>V</sub> dan ${sh('ck')} cada una.`,
            why: R`Z no cambia mientras se genera: <b>K y V de la cross-attention se calculan una vez por ventana</b> (${met('crossKvMacs')} en total) y se guardan (${met('crossKv')} en fp16 por ventana). Cada token nuevo solo calcula su Q, su fila de scores contra ${met('pos')} posiciones y su parte de la self-attention con KV cache. Posiciones aprendidas, con un tope de ${cf('posDec')} tokens por ventana.` },
          { t: 'op', block: 'lm-head', model: 'whisper', diagram: 'whisper-overview', title: 'Cabeza de lenguaje atada a los embeddings',
            tex: R`\mathbf{z}_t = \mathrm{LN}(\mathbf{y}_t)\,E_\text{tok}^{\top}\in\mathbb{R}^{V},\qquad p(y_{t+1}\mid y_{\le t}, X) = \mathrm{softmax}(\mathbf{z}_t)`,
            in: [T.dec], out: [T.logits], params: true, flops: true,
            what: R`${sh('dec')} → ${sh('logits')}. La matriz de salida es la tabla de embeddings transpuesta (pesos atados, §2.2: "tied input-output token representations"), sin bias.`,
            why: R`Atar ahorra ${cf('V')} × ${cf('D')} parámetros. El costo en MACs no se ahorra: cada token paga D × V en la cabeza, y en los modelos chicos eso es una parte grande del decoder por token.` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de la canónica: una ventana de 30 s y T<sub>out</sub> = ${cf('Tout')} tokens (${cf('prompt')} del prompt + el texto; un valor ilustrativo: 30 s de habla son ≈ 75–100 palabras, y el tope es ${cf('posDec')}). Toca una fila para resaltarla en el diagrama.` },
          { t: 'trace', model: 'whisper' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Whisper small tiene ${qn('params.total')} parámetros en el calculador (el paper, Tabla 1, dice 244M). Hugging Face reporta ${qn('paramsHF')} porque registra la tabla sinusoidal del encoder (${met('pos')} × ${cf('D')}) como un <code>nn.Embedding</code> congelado y <code>parameters()</code> la cuenta; en el código de OpenAI es un buffer, y el Atlas no cuenta buffers. Lo que sorprende: el <b>decoder tiene más parámetros que el encoder</b> (${met('decP')} contra ${met('encP')} con las convoluciones), aun sin contar la tabla de tokens de ${cf('V')} × ${cf('D')} = ${met('embP')}, que comparte con la cabeza. La diferencia es casi exactamente la cross-attention (${met('crossP')} en las ${cf('L')} capas). Y aun así, en una ventana típica, el encoder hace la mayor parte de los MACs.` },
          { t: 'params', model: 'whisper', group: 'block' },
          { t: 'calc', title: 'De dónde salen los parámetros de Whisper small (calculador)', rows: [
            { label: 'Convoluciones', expr: R`3·n<sub>mel</sub>·D + D + 3·D·D + D`, value: met('convP') },
            { label: 'Encoder (convoluciones + L capas + LN final)', expr: R`por capa ≈ 12·D² (atención 4D², FFN 8D²): ${met('encL')}`, value: met('encP') },
            { label: 'Tabla de tokens (atada a la cabeza)', expr: R`V·D = ${cf('V')}·${cf('D')}`, value: met('embP') },
            { label: 'Cross-attention (todas las capas)', expr: R`por capa 4D² + 3D (K sin bias) + 2D de su LayerNorm = ${qn('crossAttnParamsLayer')}`, value: met('crossP') },
            { label: 'Decoder sin la tabla de tokens', expr: R`posiciones P<sub>dec</sub>·D = ${cf('posDec')}·${cf('D')} + L × (self 4D² + cross 4D² + FFN 8D² + 3 LN) + LN final`, value: met('decP') },
          ], result: R`Total = encoder + tabla + decoder = ${qn('params.total')}. Una capa del decoder (${met('decL')}) ≈ 16D² contra ≈ 12D² de una del encoder (${met('encL')}): la cross-attention es un tercio más de pesos por capa.` },
          { t: 'p', html: R`Los MACs, por bloque, para una ventana de 30 s y T<sub>out</sub> = ${cf('Tout')} tokens. La tabla es el forward con <b>teacher forcing</b> (las ${cf('Tout')} posiciones del decoder en paralelo, como en entrenamiento): ${qn('macs.totalG')} MACs. Generar token a token suma casi lo mismo (${met('gen')}: el encoder y las K, V cruzadas una vez, y cada paso con su KV cache), y de eso el encoder se lleva ${met('encShare')}, las K, V cruzadas ${met('crossShare')} y los ${cf('Tout')} pasos del decoder ${met('decShare')}.` },
          { t: 'flops', model: 'whisper' },
          { t: 'h3', text: 'La asimetría: una vez por ventana contra una vez por token' },
          { t: 'kv', items: [
            ['Encoder, una vez por ventana', met('encMacs'), R`Fijo: no depende de cuánto se habló ni de cuántos tokens salen.`],
            ['K, V de la cross-attention, una vez por ventana', met('crossKvMacs'), R`2·L·N·D², calculadas al primer paso del decoder y guardadas: ${met('crossKv')} en fp16.`],
            ['Decoder, por token', met('decTok'), R`En la posición T<sub>out</sub>: self-attention con KV cache + Q de la cross-attention + fila de scores contra N + FFN + cabeza D·V (${met('lm')} de los ${met('decTok')}).`],
            ['Total de la ventana', met('gen'), R`encoder + K, V cruzadas + T<sub>out</sub> × decoder por token.`],
          ] },
          { t: 'viz', kind: 'encdec-cost', params: { model: 'whisper', config: C, Tout: 128, seconds: 30, unit: 'macs' }, caption: 'Del calculador: costo acumulado de generar t tokens. El encoder y las K, V cruzadas son un escalón al inicio (una vez por ventana); cada token suma un paso del decoder. La línea punteada es lo que costaría recalcular las K, V cruzadas en cada token. Cambia a tiempo (cota en una H100) para ver cómo se da vuelta el reparto.' },
          { t: 'scaling', model: 'whisper', knobs: [{ key: 'Tout', values: [16, 64, 128, 256, 448] }, { key: 'seconds', values: [5, 10, 20, 30] }], show: ['encoderMacs', 'decoderMacsPerToken', 'totalGenerationMacs', 'encoderShare', 'paddingShare', 'generationMs'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> los segundos de audio <b>no cambian nada</b> mientras quepan en la ventana (todo se rellena a 30 s); solo cambia qué fracción del cómputo es relleno. ×2 T<sub>out</sub> → ×2 los MACs del decoder (y un poco más por la self-attention que crece con el contexto); el encoder y las K, V cruzadas no se mueven. ×2 D → ≈ ×4 todo lo lineal. El encoder de small equivale a ${met('vsTok')} pasos del decoder: más del doble del tope de ${cf('posDec')} tokens por ventana. En <b>MACs</b> manda el encoder. En <b>latencia</b>, no (ver <a href="#whisper.inferencia">inferencia</a>).` },
          { t: 'compare', models: [TI, BA, C, ME, LG, DI], rows: ['params', 'L', 'Ld', 'D', 'h', 'Dmlp', 'nMels', 'encoderParams', 'decoderParams', 'encoderMacs', 'decoderMacsPerToken', 'crossKvBytes', 'speedVsRealtime'], caption: R`Tamaños de la Tabla 1 del paper (tiny, base, small, medium, large) más large-v3 y Distil-Whisper large-v3 (${cf('Ld', DI)} capas de decoder). Parámetros del calculador (encoder con las convoluciones; decoder sin la tabla de tokens compartida); el paper redondea a 39M, 74M, 244M, 769M y 1,550M. Decoder por token en T<sub>out</sub> = ${cf('Tout')} (incluye la cabeza); K, V cruzadas por ventana en bf16; velocidad sobre el tiempo real como cota de roofline en una H100, sin overheads.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota: "Whisper small is about two hundred forty million parameters, and the decoder holds more of them than the encoder because of the embedding table and the cross-attention. But per thirty-second window the encoder is about a hundred seventy billion multiply-accumulates, paid once, while the decoder is under two hundred million per token. So compute is encoder-heavy, latency is decoder-heavy, and the cross-attention keys and values are computed once per window and reused for every token."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Una sola pérdida: entropía cruzada del siguiente token del texto, con teacher forcing, sobre todas las tareas mezcladas. El texto previo (detrás de ${tk('startofprev')}) entra como contexto pero no lleva pérdida (§2.3).` },
          { t: 'math', display: true, tex: R`\mathcal{L} = -\sum_{t\,\in\,\text{objetivo}} \log p_\theta\big(y_t \mid y_{\lt t},\ \text{prev},\ \text{tarea},\ X_\text{mel}\big)`, caption: 'Los tokens del objetivo incluyen el idioma, la tarea, los tiempos, el texto y el fin; los del texto previo quedan fuera de la suma.' },
          { t: 'h3', text: 'Datos: la tesis del paper' },
          { t: 'table', caption: 'Los datos de Whisper (§1, §2.1)', head: ['Qué', 'Valor', 'Dónde'], rows: [
            ['Total', '680,000 horas de audio con transcripción', '§1'],
            ['Por tarea', '117,000 h de reconocimiento en 96 idiomas distintos del inglés; 125,000 h de traducción X → inglés; el resto (≈ 438,000 h) inglés', '§1'],
            ['Supervisión débil', 'Transcripciones que acompañan al audio en internet, sin verificar a mano', '§2.1'],
            ['Filtro: transcripciones de máquina', 'Heurísticas para descartar texto que parece salida de otro ASR (todo en mayúsculas o minúsculas, sin puntuación)', '§2.1'],
            ['Filtro: idioma', 'Detector de idioma del audio (entrenado sobre VoxLingua107) contra el idioma del texto (CLD2); si el audio no es inglés y el texto sí, el par se usa como traducción', '§2.1'],
            ['Filtro: alineación y duplicados', 'Revisión de fuentes con mucho error (transcripciones parciales o desalineadas), deduplicación difusa del texto y contra TED-LIUM 3 para no contaminar la evaluación', '§2.1'],
            ['Segmentos', 'Ventanas de 30 s con el texto que cae en cada una; también segmentos sin voz, con la etiqueta de no-voz', '§2.1'],
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué supervisión débil y no auto-supervisión', html: R`<p>El paper discute contra el patrón de wav2vec 2.0: preentrenar un encoder sin etiquetas y ajustarlo por dataset da modelos que superan a humanos en LibriSpeech y fallan en otros datasets. La apuesta de Whisper es entrenar el modelo completo (encoder + decoder) con etiquetas ruidosas pero muy variadas y evaluarlo <b>zero-shot</b>. Reportan robustez efectiva: contra modelos supervisados en LibriSpeech con el mismo WER en LibriSpeech, Whisper reduce el error un 55.2 % relativo en promedio en otros datasets (§3.3, Tabla 2).</p>` },
          { t: 'h3', text: 'Receta' },
          { t: 'table', caption: 'Entrenamiento (§2.4, App. F)', head: ['Qué', 'Valor', 'Dónde'], rows: [
            ['Optimizador', 'AdamW, clipping de la norma del gradiente, warmup lineal de 2,048 pasos y decaimiento lineal a 0', '§2.4'],
            ['Batch y pasos', '256 segmentos por paso; 2<sup>20</sup> ≈ 1M pasos, entre 2 y 3 pasadas por el dataset', '§2.4'],
            ['Precisión y paralelismo', 'fp16 con loss scaling dinámico, activation checkpointing, data parallel', '§2.4'],
            ['Regularización', 'Ninguna augmentation en los modelos originales: confían en la diversidad de los datos', '§2.4'],
            ['Large-v2', '2.5× más épocas, con SpecAugment, stochastic depth y BPE dropout', '§2.4, nota 3'],
            ['Tokenizador', 'BPE de bytes de GPT-2 para los modelos solo-inglés (<code>.en</code>); los multilingües re-ajustan el vocabulario (mismo tamaño) para no fragmentar los otros idiomas', '§2.2'],
            ['Large-v3', R`128 bins de Mel, un token de idioma más (cantonés); ≈ 1M h con etiquetas débiles + 4M h con pseudo-etiquetas de large-v2, 2 épocas; 10–20 % menos errores que large-v2 (${V3CARD})`, 'Model card'],
          ] },
          { t: 'h3', text: 'Distil-Whisper: destilar el decoder' },
          { t: 'p', html: R`${DISTIL}: copian el encoder del maestro y lo <b>congelan</b>; el decoder del alumno tiene 2 capas, inicializadas con capas del maestro espaciadas al máximo (la primera y la última). Entrenan con ≈ 22,000 h de 9 datasets públicos pseudo-etiquetados por el maestro (decodificación greedy) y descartan los ejemplos cuya pseudo-etiqueta difiere de la transcripción original en más de 10 % de WER (§9.1). Pérdida: 0.8·KL contra el maestro (temperatura 2) + 1.0·entropía cruzada con la pseudo-etiqueta (§4.1, App. B.1). Resultado para distil-large-v2: 5.8× más rápido, 51 % menos parámetros, y a ≈ 1 punto de WER del maestro fuera de distribución (10.1 contra 9.1 en audio corto; 11.6 contra 11.7 en largo, Tabla 5).` },
          { t: 'callout', kind: 'why', title: 'Por qué se destila el decoder y no el encoder', html: R`<p>Por la asimetría de la sección anterior: el encoder corre una vez por ventana y en paralelo; el decoder corre una vez por token y en serie. Bajar el decoder de ${cf('Ld', LG)} a ${cf('Ld', DI)} capas ataca justo el paso que se repite, y quitar capas del encoder ahorraría poco tiempo y costaría robustez acústica. En el calculador: Distil-Whisper large-v3 tiene ${qn('params.total', DI)} parámetros contra ${qn('params.total', LG)} y su decoder por token cuesta ${met('decTok', DI)} contra ${met('decTok', LG)}.</p>` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los filtros de datos uno por uno y la receta de large-v3. Lo que no te puedes saltar: 680,000 h de supervisión débil con evaluación zero-shot, el formato multitarea con una sola pérdida, y que Distil-Whisper congela el encoder y deja 2 capas de decoder.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Preparar el audio', html: '<p>Mono, re-muestreado a 16 kHz. Rellenar o cortar a 30 s. log-Mel en CPU o GPU (en servicios de alto volumen, el front end en CPU puede ser el cuello: mídelo).</p>' },
            { title: 'Encoder, una vez', html: R`<p>${met('encMacs')} por ventana, en paralelo sobre las ${met('pos')} posiciones: compute-bound, se beneficia de batch.</p>` },
            { title: 'K, V cruzadas, una vez', html: R`<p>Al primer paso del decoder (la flecha <a href="#whisper.diagrama~enc-out">H → decoder</a> del diagrama): ${met('crossKvMacs')} y ${met('crossKv')} de memoria por ventana (fp16), que se leen en cada token.</p>` },
            { title: 'Prompt', html: R`<p>${tk('startoftranscript')} + idioma + tarea + ${tk('notimestamps')} (o tiempos). Si el idioma no se fija, un paso del decoder después de ${tk('startoftranscript')} da la distribución sobre los tokens de idioma: es la detección de idioma.</p>` },
            { title: 'Decodificar', html: R`<p>Greedy o beam search (5 en el paper) con KV cache, hasta ${tk('endoftext')} o ${cf('posDec')} tokens. Cada token: ${met('decTok')}, y una lectura de todos los pesos del decoder + las K, V cruzadas + el KV cache: <b>memory-bound</b> a batch chico.</p>` },
            { title: 'Audio largo', html: '<p>Ventana tras ventana (secuencial) o por trozos en paralelo (chunked): abajo.</p>' },
          ] },
          { t: 'h3', text: 'Qué domina la latencia' },
          { t: 'p', html: R`En MACs, el encoder (${met('encShare')} con T<sub>out</sub> = ${cf('Tout')}). En tiempo, a batch 1, el decoder: el encoder es <b>un</b> forward grande que satura la GPU; el decoder son ${cf('Tout')} forwards chicos <b>en serie</b>, cada uno limitado por leer pesos y K, V de memoria. Las cotas de roofline del calculador (${H100}; cada fase = máx(FLOPs ÷ pico, bytes ÷ ancho de banda), sin overheads, batch 1, bf16):` },
          { t: 'kv', items: [
            ['Encoder, una vez', R`${est(met('encMs') + ' ms')}`, R`Limitado por cómputo: ${met('encMacs')}.`],
            ['Decoder, los ' + cf('Tout') + ' pasos', R`${est(met('decMs') + ' ms')}`, R`Limitado por memoria: cada paso (${est(met('stepMs') + ' ms')}) lee los pesos del decoder, la cabeza y ${met('crossKv')} de K, V cruzadas.`],
            ['Ventana completa', R`${est(met('genMs') + ' ms')}`, R`RTF = tiempo ÷ duración del audio = ${est(met('rtf'))}, o ${est(met('speed') + '×')} más rápido que el tiempo real como cota ideal.`],
            ['Whisper large-v3', R`encoder ${est(met('encMs', LG) + ' ms')}, decoder ${est(met('decMs', LG) + ' ms')}`, R`El decoder es casi todo el tiempo. Distil-Whisper large-v3, con 2 capas de decoder: ${est(met('genMs', DI) + ' ms')} por ventana contra ${est(met('genMs', LG) + ' ms')}.`],
          ] },
          { t: 'callout', kind: 'estimate', html: R`<p>Son <b>cotas</b>, no mediciones. En PyTorch eager a batch 1, cada paso del decoder lanza decenas de kernels por capa y el overhead domina: ${est('varios ms por token')} en vez de una décima. <code>torch.compile</code> con cache estática o CUDA graphs lo bajan (el ${V3CARD} reporta hasta 4.5×), y runtimes como CTranslate2 o TensorRT-LLM más. Mide tu RTF con tu audio, tu GPU, tu batch y tu runtime, y repórtalo siempre con los cuatro.</p>` },
          { t: 'callout', kind: 'trap', title: '"El encoder es el 90 % de los FLOPs, así que optimizo el encoder"', html: R`<p>Optimizas lo que no domina el reloj. A batch chico el tiempo se va en el bucle del decoder, que es serie y está limitado por memoria y overhead. Por eso las variantes rápidas recortan el <b>decoder</b>: Distil-Whisper (2 capas), large-v3-turbo (4 capas, ${TURBO}), y la decodificación especulativa. Con batch grande (muchas ventanas a la vez) el balance cambia y el encoder vuelve a pesar: mide los dos regímenes.</p>` },
          { t: 'h3', text: 'Audio largo: secuencial vs por trozos' },
          { t: 'table', caption: 'Dos algoritmos de transcripción larga', head: ['', 'Secuencial (el del paper)', 'Por trozos (chunked)'], rows: [
            ['Cómo avanza', 'Ventana de 30 s; se desplaza hasta el último token de tiempo predicho (§3.8) y se condiciona con el texto anterior', 'Trozos con solapamiento, independientes; se unen en el solapamiento por la secuencia común más larga'],
            ['Paralelismo', 'Ninguno dentro de un archivo: cada ventana depende de la anterior', 'Todos los trozos en un batch'],
            ['Velocidad', 'Base', R`9.9× más rápido para large-v2 (${DISTIL}, Tabla 7)`],
            ['Calidad', R`Algo mejor: hasta 0.5 % de WER según el ${V3CARD}`, 'Algo peor en las uniones'],
            ['Cuándo', 'Archivos largos en lote, máxima calidad', 'Un archivo largo con latencia mínima'],
          ], note: R`Chunk recomendado: 30 s para large-v3 (${V3CARD}), 25 s para distil-large-v3 (${DV3CARD}).` },
          { t: 'p', html: R`<b>Las heurísticas del algoritmo secuencial</b> (§4.5, Tabla 7), que es lo que se pregunta: beam search de 5; <b>temperature fallback</b>, que re-decodifica a temperatura 0.2, 0.4, … 1.0 cuando el log-prob promedio cae debajo de −1 o la razón de compresión gzip del texto pasa 2.4 (un texto que se repite comprime demasiado); condicionar con el texto anterior solo si la temperatura es menor que 0.5; marcar una ventana como silencio si P(${tk('nospeech')}) &gt; 0.6 y el log-prob promedio &lt; −1; y forzar el primer token de tiempo entre 0 y 1 s. Juntas bajan el WER promedio en 7 datasets largos de 11.0 a 10.0.` },
          { t: 'h3', text: 'Decodificación especulativa con Distil-Whisper' },
          { t: 'p', html: R`La técnica general (${SPECD}; detalle en <a href="#llm-inferencia.inferencia">inferencia de LLMs</a>): un modelo chico propone varios tokens y el grande los verifica en <b>un</b> forward. En Whisper calza especialmente bien porque el borrador (Distil-Whisper) tiene <b>el mismo encoder</b> que el maestro: la salida del encoder se calcula una vez y se comparte, y el borrador solo agrega su decoder de 2 capas (+8 % de parámetros, 1,669M contra 1,550M para large-v2). Resultado: 2.0× más rápido que large-v2 solo, con <b>la misma salida</b> que el modelo grande (${DISTIL}, §8.5, Tabla 9).` },
          { t: 'callout', kind: 'why', title: 'Por qué 2× y no 6×', html: R`<p>Distil-Whisper solo es 5.8× más rápido, pero como asistente cada ronda paga γ pasos del borrador más un forward del maestro para verificar, y no todos los tokens se aceptan. La ganancia depende de la tasa de aceptación α (alta en ASR: el texto está muy determinado por el audio) y del costo relativo del borrador. Y es una técnica de batch chico: a batch grande, el maestro ya no está ocioso y verificar deja de ser gratis.</p>` },
          { t: 'table', caption: 'Trucos de servicio y qué ganan', head: ['Truco', 'Qué hace', 'Cuándo'], rows: [
            ['VAD antes del modelo', 'Detecta voz (Silero, pyannote) y corta silencios: menos ventanas y menos alucinaciones', 'Siempre en audio real (llamadas, reuniones)'],
            [R`Agrupar segmentos de VAD (${WX})`, 'Junta segmentos hasta ≈ 30 s y los transcribe en batch; con alineación forzada da tiempos por palabra. Reportan 12× de velocidad', 'Lote y archivos largos'],
            ['Batch de ventanas', 'Encoder compute-bound: el batch lo amortiza; el decoder gana throughput', R`Servicios con cola. Límite: ${met('crossKv')} de K, V cruzadas por ventana`],
            ['Runtimes optimizados', 'CTranslate2 (faster-whisper) con int8/fp16, whisper.cpp en CPU, TensorRT-LLM', 'Costo y CPU/edge'],
            ['Decoder más chico', 'distil-large-v3 (2 capas) o large-v3-turbo (4 capas)', 'Latencia; turbo no sirve para traducir'],
            ['Especulativa', 'Distil como borrador del grande; misma salida', 'Batch chico, latencia'],
            ['Fijar idioma y tarea', 'Evita el paso de detección y errores de idioma en clips cortos', 'Cuando el idioma se conoce'],
          ] },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Alucinaciones.</b> El decoder es un modelo de lenguaje: ante silencio, música o ruido puede generar texto fluido que nadie dijo ("gracias por ver el video"). El paper lo nombra en sus limitaciones (§6: "complete hallucination"). ${CARELESS} encontró frases o frases completas inventadas en ≈ 1 % de las transcripciones, 38 % de ellas con contenido dañino, y más en hablantes con afasia (más pausas largas). Mitigación: VAD, umbral de ${tk('nospeech')}, descartar segmentos con log-prob bajo, y medir la tasa de inserciones.`,
            R`<b>Bucles de repetición.</b> El decoder queda repitiendo la misma frase hasta el tope de ${cf('posDec')} tokens (§6: "getting stuck in repeat loops"). Las defensas del algoritmo largo: beam search, temperature fallback con la razón de compresión &gt; 2.4, y no condicionar con texto previo a temperatura alta (el error se propaga de ventana en ventana).`,
            R`<b>Bordes y tiempos.</b> Omite las primeras o últimas palabras de una ventana (§6) y, en audio largo, los tiempos pueden derivar. Por eso el primer token de tiempo se fuerza a ≤ 1 s, y para tiempos por palabra se usa alineación forzada (WhisperX).`,
            R`<b>Idioma.</b> En clips cortos o con code-switching, la detección de idioma se equivoca y entonces transcribe en el idioma equivocado o traduce sin pedírselo. En Fleurs, la identificación de idioma da 64.5 % (Tabla 5; 20 de los 102 idiomas no están en sus datos). Fija el idioma cuando lo sabes.`,
            R`<b>Dominio.</b> Nombres propios, jerga médica o legal, números y siglas: el modelo escribe la palabra frecuente que suena parecido. Mitigación: un prompt de vocabulario detrás de ${tk('startofprev')} (sesga, no garantiza), o fine-tuning.`,
          ] },
          { t: 'table', caption: 'Whisper frente a sus alternativas (filas = criterios)', head: ['Criterio', 'Whisper small', 'Whisper large-v3', 'distil-large-v3 / turbo', 'CTC o transducer (wav2vec 2.0, Conformer)'], rows: [
            ['Parámetros', qn('params.total'), qn('params.total', LG), R`${qn('params.total', DI)} / ≈ 809M`, 'De ≈ 100M a ≈ 1B'],
            ['Salida', 'Autoregresiva: puntuación, mayúsculas, números', 'Igual', 'Igual', 'Un símbolo por frame (CTC) o por paso del transducer; texto más crudo según el entrenamiento'],
            ['Alucinación de texto fluido', 'Sí', 'Sí', 'Menos (Distil: 1.3× menos 5-gramas repetidos, inserciones 2.1 % contra 3.3 %, Tabla 8)', 'Rara: la salida está atada a los frames'],
            ['Streaming', 'No nativo (ventanas de 30 s)', 'No nativo', 'No nativo', 'Sí (transducer y CTC con contexto limitado)'],
            ['Robustez sin ajustar', 'Buena', 'La mejor de la familia', 'Cerca de large', 'Depende del dataset de ajuste'],
            ['Cuándo', 'Edge, costo bajo, inglés/español con buen audio', 'Calidad máxima, muchos idiomas', 'Calidad de large con latencia de modelo chico', 'Tiempo real, latencia de cientos de ms, dominio fijo'],
          ], note: R`Parámetros de Whisper del calculador; turbo del config de HF (${TURBO}); Distil del ${DV3CARD} y ${DISTIL}. La columna CTC/transducer es cualitativa.` },
          { t: 'callout', kind: 'senior', html: R`<p>Cómo decidir en una entrevista de diseño: "for batch transcription of recorded calls I'd use Whisper large-v3 or distil-large-v3 behind a VAD, batched on GPUs with a fast runtime, and measure WER on our own normalized test set. For a voice agent that must react in a few hundred milliseconds I would not force Whisper into streaming; I'd use a streaming transducer or CTC model for partial results and endpointing, and possibly re-transcribe the final utterance with Whisper for quality."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Cuándo lo mencionas'], rows: [
            ['tiny … large (Tabla 1)', R`Misma arquitectura, de ${cf('L', TI)} a 32 capas por lado y de D = ${cf('D', TI)} a 1,280.`, 'Tamaño vs calidad'],
            ['Modelos <code>.en</code>', 'Solo inglés, con el tokenizador de GPT-2; algo mejores en inglés al mismo tamaño (App. D).', 'Producto solo en inglés'],
            ['large-v2', '2.5× más épocas con SpecAugment, stochastic depth y BPE dropout (§2.4).', 'Maestro de Distil-Whisper'],
            ['large-v3', R`128 bins de Mel, cantonés, 1M h débiles + 4M h pseudo-etiquetadas; 10–20 % menos error que v2 (${V3CARD}).`, 'El grande actual'],
            ['large-v3-turbo', R`large-v3 podado a 4 capas de decoder y re-entrenado 2 épocas solo con transcripción: rápido, pero no para traducir (${TURBO}).`, 'Latencia sin destilar'],
            [R`Distil-Whisper (${DISTIL})`, 'Encoder congelado del maestro + 2 capas de decoder, destilado con 22K h pseudo-etiquetadas; también borrador para decodificación especulativa.', 'Destilación, latencia'],
            [R`WhisperX (${WX})`, 'VAD + agrupación en batch + alineación forzada con un modelo de fonemas: tiempos por palabra y 12× de velocidad.', 'Tiempos por palabra, archivos largos'],
            [R`Whisper-Streaming (${WS})`, 'Re-transcribe un buffer creciente y confirma el prefijo en que coinciden dos pasadas (local agreement): ≈ 3.3 s de latencia.', 'Streaming con Whisper'],
            ['faster-whisper / whisper.cpp', 'Implementaciones: CTranslate2 (int8/fp16, GPU y CPU) y C/C++ con cuantización para CPU y móviles. Misma arquitectura.', 'Costo y edge'],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Whisper aparece en entrevistas de ML/AI Engineer de dos maneras: como arquitectura ("explica el encoder-decoder y el front end de audio") y, sobre todo, como <b>diseño de sistema</b>: servir ASR a escala, presupuesto de latencia, evaluación con WER, alucinaciones y fine-tuning. Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Walk me through Whisper from raw waveform to text tokens, with shapes.',
              junior: 'El audio entra al transformer y sale texto.',
              senior: R`Audio mono a 16 kHz, relleno o cortado a 30 s: 480,000 muestras. STFT de 25 ms con salto de 10 ms → 3,000 frames; ${cf('mels')} filtros de Mel, log<sub>10</sub>, recorte a 80 dB y escala a ≈ [−1, 1]: ${sh('mel')}. Dos <code>Conv1d</code> de kernel 3 con GELU, la segunda con stride 2: ${sh('conv')}. Más posiciones sinusoidales fijas, ${cf('L')} bloques pre-LN y una LN final: ${sh('enc')}. El decoder recibe el prompt de tarea, suma posiciones aprendidas (máximo ${cf('posDec')}), y en cada una de sus ${cf('L')} capas hace self-attention causal, cross-attention a la salida del encoder y FFN; la cabeza, atada a los embeddings, da ${cf('V')} logits por token.`,
              say: 'Sixteen-kilohertz audio padded to thirty seconds becomes three thousand log-Mel frames with eighty bins. Two 1-D convolutions, the second with stride two, give fifteen hundred positions with sinusoidal embeddings, then a pre-norm transformer encoder. The decoder is a causal transformer with learned positions that cross-attends to the encoder output in every layer, and a tied output projection gives logits over the BPE vocabulary.',
              why: 'La de entrada. Se anota 30 s, 3,000 → 1,500, conv1d (no 2-D), sinusoidal vs aprendidas y la cross-attention en cada capa.' },
            { q: 'A user sends a 3-second voice command. How much encoder compute does Whisper spend, and what would you do about it?',
              junior: 'Un décimo del de 30 s.',
              senior: R`Lo mismo que para 30 s: el audio se rellena y el encoder procesa ${met('pos')} posiciones, ${met('encMacs')}. El 90 % de ese cómputo es relleno. Opciones: (1) aceptarlo, porque en latencia igual manda el decoder y el encoder es un forward paralelo; (2) <b>juntar</b> varios comandos en un batch de ventanas para amortizar; (3) un modelo que no rellene (CTC/transducer, o un ASR con entrada de longitud variable) si el volumen de clips cortos es enorme; (4) recortar el encoder a la longitud real solo con un modelo ajustado para eso, porque el original degrada. Lo que no hago: asumir que el costo escala con la duración.`,
              say: 'The same as for thirty seconds, because the input is always padded to a thirty-second window, so about ninety percent of that encoder pass is padding. I would batch short clips, accept it if latency is decoder-bound anyway, or move to a model with variable-length input if short commands dominate the traffic.',
              why: 'Trampa: proporcional a la duración. Se anota el relleno a 30 s y las opciones con sus costos.', trap: true },
            { q: 'Encoder or decoder: which dominates Whisper\'s cost? Answer for FLOPs and for latency.',
              junior: 'El encoder, porque es el que procesa el audio.',
              senior: R`Depende de qué mido. En MACs, con T<sub>out</sub> = ${cf('Tout')}, el encoder es ${met('encShare')} del total: ${met('encMacs')} una vez, contra ${met('decTok')} por token. En latencia a batch chico, el decoder: ${cf('Tout')} pasos en serie, cada uno memory-bound (lee los pesos del decoder, ${met('crossKv')} de K, V cruzadas y el KV cache) y con overhead de kernels. Por eso Distil-Whisper y turbo recortan capas del <b>decoder</b>, y por eso la especulativa ayuda. A batch grande el decoder se vuelve más eficiente y el encoder pesa más: perfilo los dos regímenes.`,
              say: 'In FLOPs the encoder dominates, roughly a hundred seventy billion multiply-accumulates once per window versus under two hundred million per decoded token. In latency the decoder dominates at small batch, because it runs sequentially, one memory-bound step per token. That is why distilled variants shrink the decoder.',
              why: 'Trampa: confundir FLOPs con latencia. Se anota la cuenta por ventana vs por token y el régimen memory-bound.', trap: true },
            { q: 'Why are the cross-attention keys and values computed only once, and what does that cost in memory?',
              junior: 'Por eficiencia.',
              senior: R`Porque dependen solo de la salida del encoder, que no cambia mientras se genera: K = Z W<sub>K</sub> y V = Z W<sub>V</sub> por capa. Se calculan al primer paso (${met('crossKvMacs')}) y se guardan junto al KV cache. Memoria: 2 · L · N · D · 2 bytes = ${met('crossKv')} por ventana en fp16 para small y ${met('crossKv', LG)} para large-v3, independiente de cuántos tokens salgan, mientras que el KV cache propio del decoder crece con T y es chico (${cf('posDec')} tokens como máximo). Con batch de B ventanas, son B copias: es lo que limita cuántas ventanas decodificas a la vez en una GPU, y lo que hay que leer de memoria en cada paso.`,
              say: 'They depend only on the encoder output, which is fixed during decoding, so each decoder layer projects it once and caches it. That cache is two times layers times fifteen hundred positions times width times two bytes, fixed per window, and with batching it is multiplied by the batch size, so it bounds concurrency and is read at every decoding step.',
              why: 'Se anota la fórmula 2·L·N·D·bytes, que no crece con T y que se multiplica por el batch.' },
            { q: 'Design an ASR service for 10,000 hours of call-center audio per day. Walk me through the pipeline and GPU sizing.',
              junior: 'Pongo Whisper large en un servidor y le mando los audios.',
              senior: R`Pipeline: ingesta (cola, normalizar a 16 kHz mono, separar canales agente/cliente si vienen en estéreo, que de paso resuelve la diarización) → <b>VAD</b> (quita silencios: en llamadas, ${est('≈ 30–50 %')} del audio; mídelo) → agrupar segmentos hasta ≈ 30 s → <b>batch</b> de ventanas en GPU con un runtime rápido (faster-whisper o TensorRT, fp16/int8) y un decoder chico (distil-large-v3 o turbo, si el WER en mi set lo permite) → post-proceso (normalización, puntuación, PII redaction) → almacenamiento e índice. Dimensionado: 10,000 h/día ≈ 417 h de audio por hora de reloj; si mido un RTF de 0.01 con batch en una A100 (${est('≈ 100× tiempo real')}, a verificar), necesito ${est('≈ 4–5 GPUs')} sostenidas, más margen para picos y reintentos. Como es lote, optimizo throughput (batch grande) y no latencia; la cola absorbe picos. Monitoreo: WER en una muestra etiquetada por semana, tasa de inserciones (proxy de alucinación), RTF y costo por hora de audio.`,
              say: 'Ingest and resample, split stereo channels, run voice activity detection to drop silence, pack speech into thirty-second windows, and batch them on GPUs with an optimized runtime and a distilled decoder if our own WER allows it. Ten thousand hours a day is about four hundred hours of audio per wall-clock hour, so with a measured real-time factor I size the fleet with headroom, optimize for throughput, and monitor WER on a labeled sample, insertion rate and cost per audio hour.',
              why: 'Se anota VAD, batch, el cálculo de flota con RTF medido, throughput vs latencia y el monitoreo con WER e inserciones.' },
            { q: 'You are building a voice agent. Give me a latency budget and tell me where Whisper fits.',
              junior: 'Whisper es rápido, lo pongo y listo.',
              senior: R`Presupuesto típico de turno ${est('≈ 800 ms–1 s')} hasta que empieza el audio de respuesta: endpointing (detectar que el usuario terminó: ${est('200–500 ms')} de silencio con VAD), ASR del último enunciado, LLM hasta el primer token, TTS hasta el primer audio, red. Whisper no da parciales nativos: procesa ventanas de 30 s. Opciones: (1) Whisper sobre el enunciado completo después del endpoint, con un modelo chico o turbo, idioma fijo y GPU dedicada: suma el tiempo de un encoder + unos pocos tokens; (2) streaming con re-decodificación sobre buffer (Whisper-Streaming, ≈ 3.3 s de latencia: demasiado para conversación); (3) un ASR streaming (transducer/CTC) para parciales y endpointing, y Whisper opcional para re-transcribir el final. Elijo según el p95 medido de extremo a extremo, no la latencia del modelo aislado.`,
              say: 'Endpointing, recognition, the language model\'s first token, text-to-speech\'s first audio and the network all share a budget of roughly a second. Whisper has no native partial results, so I would either run a small Whisper on the completed utterance after the endpoint, or use a streaming transducer for partials and endpointing and keep Whisper for a higher-quality final pass, deciding on measured end-to-end p95.',
              why: 'Se anota el presupuesto por etapa, el endpointing, que Whisper no es streaming y la alternativa transducer.' },
            { q: 'How do you evaluate an ASR system correctly? What is WER and what goes wrong with it?',
              junior: 'Cuento las palabras que están mal.',
              senior: R`WER = (S + D + I) / N: sustituciones, borrados e inserciones del alineamiento de edición mínimo entre hipótesis y referencia, dividido por las palabras de la referencia (puede pasar de 100 %). Errores típicos: (1) <b>no normalizar</b>: mayúsculas, puntuación, "5" vs "cinco", "Sr." vs "señor" inflan el WER; el paper publica su normalizador (§3.2, App. C) y lo aplica a referencia e hipótesis; (2) comparar sistemas con normalizadores distintos; (3) promediar WER por archivo en vez de sumar errores y palabras del corpus; (4) un solo número: separo S, D e I (las inserciones delatan alucinaciones; los borrados, VAD agresivo), y reporto por segmento (acento, ruido, canal) con intervalos de confianza por bootstrap; (5) CER para idiomas sin espacios. Y siempre un set propio etiquetado del dominio: LibriSpeech no dice nada de mis llamadas.`,
              say: 'Word error rate is substitutions plus deletions plus insertions over reference words, from a minimum-edit alignment. The main pitfall is normalization: casing, punctuation and number formats must be normalized identically for reference and hypothesis. I report it per slice with confidence intervals, track insertions separately as a hallucination signal, and evaluate on our own labeled domain data.',
              why: 'Se anota la fórmula, la normalización, corpus vs promedio por archivo, S/D/I por separado y el set propio.' },
            { q: 'Whisper hallucinates on silent parts of your recordings. How do you detect and reduce it?',
              junior: 'Uso un modelo más grande.',
              senior: R`Causa: el decoder es un LM que, sin señal, completa con texto probable de sus datos (créditos, "gracias por ver"). Reducir: (1) <b>VAD</b> antes, para no mandarle silencio; (2) umbrales del propio Whisper: P(${tk('nospeech')}) &gt; 0.6 con log-prob promedio &lt; −1 → descartar la ventana; (3) temperature fallback con la razón de compresión para cortar bucles; (4) no condicionar con el texto previo cuando la ventana anterior fue dudosa; (5) un modelo con menos alucinación (Distil-Whisper: inserciones 2.1 % contra 3.3 % de large-v2, Tabla 8) o un CTC como segunda opinión. Detectar: tasa de inserciones en el set etiquetado, frases que se repiten entre archivos distintos (las alucinaciones son frases "favoritas"), segmentos con texto pero sin energía de voz según el VAD, y log-prob bajo. Es un riesgo real: ${CARELESS} encontró ≈ 1 % de transcripciones con frases inventadas.`,
              say: 'The decoder is a language model, so on silence it can produce fluent text that was never spoken. I put a voice activity detector in front, use the no-speech probability and average log-probability thresholds, compression-ratio fallback against loops, and monitor insertion rate and recurring phrases across unrelated files.',
              why: 'Trampa: "más grande lo arregla". Se anota la causa, VAD, los umbrales, y cómo medirlo.', trap: true },
            { q: 'How would you fine-tune Whisper for Spanish medical dictation?',
              junior: 'Entreno con mis audios unas épocas.',
              senior: R`(1) <b>Medir primero</b>: WER normalizado de small, large-v3 y turbo en un set de dictados reales, separado por hablante (que no se filtre un médico entre train y test). (2) Datos: decenas de horas transcritas con el formato que quiero en la salida (puntuación, abreviaturas, dosis); si hay más audio sin transcribir, pseudo-etiquetarlo con el modelo grande y filtrar por WER contra lo que haya, como Distil-Whisper. (3) Entrenamiento: <code>Seq2SeqTrainer</code> con el prompt ${tk('startoftranscript')} ${tk('es')} ${tk('transcribe')} fijo, LR bajo (${est('≈ 1e-5')}), pocas épocas; encoder congelado si hay pocos datos (el acústico ya es robusto; lo que falta es vocabulario), o LoRA en las proyecciones de atención para servir varias especialidades. Conservar timestamps en parte de los datos si los uso, o se pierden. (4) Evaluar también en audio general en español para medir el olvido. (5) Barato antes de entrenar: un prompt de vocabulario con ${tk('startofprev')} con los términos frecuentes.`,
              say: 'I would first measure normalized WER of several sizes on a speaker-disjoint test set, then fine-tune with the Spanish transcribe prompt fixed, a low learning rate and few epochs, freezing the encoder or using LoRA when data is small, possibly pseudo-labeling extra audio with a larger model. I would check forgetting on general Spanish audio and try a vocabulary prompt first because it is free.',
              why: 'Se anota medir antes, split por hablante, el prompt fijo, congelar encoder o LoRA, olvido, y el prompt de vocabulario.' },
            { q: 'How does speculative decoding with Distil-Whisper work, and why are the outputs identical?',
              junior: 'Usa el modelo chico en vez del grande.',
              senior: R`El borrador (Distil-Whisper, mismo encoder congelado, 2 capas de decoder) propone γ tokens; el grande los verifica en un solo forward de su decoder sobre los γ tokens y acepta el prefijo más largo que coincide con lo que él mismo habría elegido (en greedy, comparar argmax; en muestreo, la regla de aceptación min(1, p/q) que preserva la distribución de p). Al primer rechazo usa el token del grande. Por eso la salida es exactamente la del grande. El encoder compartido hace que el borrador cueste solo su decoder. Ganancia medida: 2.0× para large-v2 (Tabla 9). Funciona porque en ASR la tasa de aceptación es alta y el decoder grande está ocioso a batch chico.`,
              say: 'The distilled model shares the teacher\'s encoder, so its two-layer decoder drafts a few tokens cheaply, and the large decoder verifies them in one forward pass, keeping the longest prefix it agrees with. The output equals the large model\'s, and the paper reports about a two-times speedup at small batch.',
              why: 'Se anota el encoder compartido, la verificación en un forward, por qué la salida es idéntica y que es de batch chico.' },
            { q: 'How do you transcribe a two-hour recording with Whisper?',
              junior: 'Le paso el archivo entero.',
              senior: R`No entra: la ventana es de 30 s y el decoder tiene ${cf('posDec')} posiciones. Dos algoritmos: <b>secuencial</b> (el del paper): ventana de 30 s, se predicen tiempos, se avanza hasta el último tiempo predicho, se condiciona con el texto anterior; con beam 5, temperature fallback y umbrales de no-voz (§4.5). Más exacto, pero cada ventana espera a la anterior. <b>Por trozos</b>: trozos con solapamiento, en batch, unidos por la secuencia común más larga: 9.9× más rápido para large-v2, algo peor en las uniones. Antes de cualquiera: VAD para saltar silencios (WhisperX agrupa los segmentos de voz hasta 30 s y los manda en batch). Riesgos: propagación de errores por el texto previo, deriva de tiempos, bucles.`,
              say: 'The window is thirty seconds, so long audio is either transcribed sequentially, shifting the window to the last predicted timestamp and conditioning on previous text with temperature fallback, or chunked with overlap and decoded in parallel, then stitched. Sequential is a bit more accurate, chunked is several times faster, and a VAD in front removes silence and hallucinations.',
              why: 'Se anota 30 s y 448, secuencial vs chunked con su trade-off, y el VAD.' },
            { q: 'How does Whisper produce word-level timestamps if it only predicts segment timestamps?',
              junior: 'Cada palabra tiene su token de tiempo.',
              senior: R`No: los tokens de tiempo marcan inicio y fin de <b>segmentos</b>, cada 20 ms. Para palabras hay dos caminos: (1) DTW sobre los pesos de cross-attention de un subconjunto de cabezas que se alinean bien con el audio (las "alignment heads" que trae la generation_config): la matriz token × posición del encoder (20 ms por posición) se alinea monótonamente; (2) alineación forzada con un modelo de fonemas CTC (wav2vec 2.0), como WhisperX, más preciso. Ojo: con el relleno, las posiciones después del final del audio no deben recibir palabras.`,
              say: 'Native timestamp tokens are per segment. Word timestamps come either from dynamic time warping over cross-attention weights of a few alignment heads, since each encoder position is twenty milliseconds, or from forced alignment with a phoneme CTC model, as WhisperX does.',
              why: 'Trampa: "un token por palabra". Se anota DTW sobre cross-attention y la alineación forzada.', trap: true },
            { q: 'Why does Whisper use special tokens for the task instead of separate heads, and what can go wrong?',
              junior: 'Es más simple.',
              senior: R`Un solo decoder y una sola pérdida aprenden todas las tareas (transcribir, traducir, identificar idioma, detectar no-voz, tiempos) compartiendo todo; la tarea es un prefijo, como un prompt fijo. Ventajas: un modelo que se sirve, transferencia entre tareas e idiomas, y control en inferencia forzando tokens. Problemas: si no fijas el idioma, un error de detección cambia toda la salida (transcribe en otro idioma o traduce); si mezclas formatos (tiempos vs sin tiempos) en el fine-tuning, puedes romper el que no entrenaste; y como el control es "suave", el modelo a veces ignora el prompt (traduce cuando se pide transcribir en audio mezclado).`,
              say: 'Special tokens turn every task into conditional language modeling with one decoder and one loss, so tasks and languages share everything and you control behavior by forcing the prefix. The risk is that a wrong language token or an inconsistent format during fine-tuning changes the whole output.',
              why: 'Se anota el formato como prompt, la transferencia, y los modos de falla por idioma y formato.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuántas ventanas de Whisper small caben en una GPU de 24 GB, solo por las K, V cruzadas?',
              a: R`Cada ventana guarda ${met('crossKv')} (fp16). Con ${est('≈ 20 GB')} libres después de los pesos (${met('weightBytes')} en bf16) y activaciones, caben ${est('del orden de 300')} ventanas; con large-v3 (${met('crossKv', LG)} por ventana) ${est('del orden de 70')}. Es la cuenta que fija el batch máximo del decoder.` },
            { q: 'Tu WER salta de 8 % a 25 % al cambiar de librería, con el mismo modelo. ¿Qué revisas?',
              a: 'La normalización (una de las dos no normaliza o usa otra), la frecuencia de muestreo (audio a 8 kHz sin re-muestrear), el idioma forzado vs detectado, el algoritmo de audio largo (secuencial vs chunked y el tamaño del chunk), los parámetros de decodificación (beam, temperatura, umbrales) y si una de las dos usa VAD.' },
            { q: 'Con T_out = 448 (el tope), ¿el decoder supera al encoder en MACs en Whisper small?',
              a: R`Compruébalo en el explorador de <a href="#whisper.costo">costo</a> con T<sub>out</sub> = 448: el decoder sigue por debajo del encoder más las K, V cruzadas. Lo que cambia es la latencia: 448 pasos en serie.` },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (los calcula el calculador) y al final el ejercicio de cuentas, verificado contra Hugging Face.` },
          { t: 'h3', text: 'Diagrama en blanco' },
          { t: 'blankdiagram', diagram: 'whisper-overview', slots: [
            { node: 'mel', ask: 'label', hint: 'audio → bins de Mel por frame' },
            { node: 'mel', tensor: T.mel, ask: 'shape' },
            { node: 'conv', ask: 'label', hint: 'dos conv1d, la segunda con stride 2' },
            { node: 'conv', tensor: T.conv, ask: 'shape' },
            { node: 'enc-out', tensor: T.enc, ask: 'shape' },
            { node: 'decoder', ask: 'label', hint: 'causal + cross-attention al audio' },
            { node: 'lm-head', tensor: T.logits, ask: 'shape' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'whisper', pool: 'all', configs: [C, TI, LG] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: 'El audio dura 10 s en vez de 30 s. ¿Cuánto cambian los MACs del encoder?', change: { seconds: 10 }, ask: 'encoderMacs',
              explain: 'Nada: se rellena a 30 s. Solo crece la fracción de relleno.' },
            { q: R`Pasas de T<sub>out</sub> = ${cf('Tout')} al tope de 448 tokens. ¿Qué pasa con los MACs del decoder por token?`, change: { Tout: 448 }, ask: 'decoderMacsPerToken',
              explain: 'Casi nada: el costo por token depende del contexto solo por la self-attention (crece poco); lo que crece es el total, × T_out.' },
            { q: 'Mismo cambio, T_out = 448. ¿Y los bytes de las K, V cruzadas?', change: { Tout: 448 }, ask: 'crossKvBytes',
              explain: 'No cambian: dependen de L, N = 1,500 y D, no del texto generado.' },
            { q: 'T_out = 448. ¿Qué fracción de los MACs de la ventana es el encoder?', change: { Tout: 448 }, ask: 'encoderShare',
              explain: 'Baja, pero sigue siendo grande: el encoder es un costo fijo por ventana.' },
            { q: 'Pasas de 1 a 8 ventanas por batch (B = 8). ¿Cuántos bytes de K, V cruzadas guardas?', change: { B: 8 }, ask: 'crossKvBytes',
              explain: '×8: cada ventana tiene su propia memoria del audio. Es el límite de concurrencia del decoder.' },
          ] },

          { t: 'h3', text: 'Ejercicio: frames, parámetros y K, V cruzadas, contra Hugging Face' },
          { t: 'p', html: R`Sin mirar, a mano: (1) cuántos frames y cuántas posiciones del encoder da una ventana de 30 s con salto de 10 ms y la conv de stride 2 (kernel 3, padding 1); (2) los parámetros de una cross-attention de Whisper small (4 matrices D × D, bias en Q, V y salida, sin bias en K) y del modelo partido en encoder y decoder; (3) los bytes de las K, V cruzadas en fp16. Después corre el script: construye el modelo desde el <code>config.json</code> de <code>openai/whisper-small</code> sin pesos (device meta para contar; uno aleatorio en CPU para las formas). Verificado en el venv del Atlas (PyTorch 2.14, transformers 5.19): 10 s y 30 s dan los mismos 80 × 3,000 frames; el encoder rechaza 1,000 frames; el módulo <code>encoder_attn</code> de una capa tiene 2,361,600 parámetros (el calculador agrega su LayerNorm: ${qn('crossAttnParamsLayer')}); la caché cruzada guarda 27,648,000 valores, ${qn('crossKvBytes')} bytes en fp16, con forma (1, 12, 1500, 64) por capa para K y para V. La cuenta de HF da ${qn('paramsHF')} parámetros porque incluye la tabla sinusoidal congelada del encoder (1,500 × 768), que el Atlas no cuenta (${qn('params.total')}).` },
          { t: 'code', title: 'Verificación (PyTorch + transformers, sin descargar pesos)', files: [
            { name: 'whisper_cuentas.py', lang: 'python', code: [
              'import json, numpy as np, torch',
              'from transformers import WhisperConfig, WhisperForConditionalGeneration, WhisperFeatureExtractor',
              '',
              '# 1) Frames: 30 s · 16 kHz = 480,000 muestras; salto de 160 → 3,000 frames; conv stride 2 → 1,500',
              'fe = WhisperFeatureExtractor()                          # 80 bins, n_fft 400, hop 160, 30 s',
              'for s in (10, 30):',
              '    x = np.random.randn(16000 * s).astype(np.float32) * 0.1',
              '    print(s, fe(x, sampling_rate=16000, return_tensors="pt").input_features.shape)   # (1, 80, 3000) ambos',
              'pos = (3000 + 2 * 1 - 3) // 2 + 1                       # Conv1d k=3, s=2, p=1',
              'print("posiciones", pos)                                # 1500',
              '',
              '# 2) Parámetros (config.json de openai/whisper-small, bajado como texto; sin pesos)',
              'cfg = WhisperConfig(**json.load(open("whisper-small-config.json")))',
              'with torch.device("meta"):',
              '    m = WhisperForConditionalGeneration(cfg)',
              'n = lambda mod: sum(p.numel() for p in mod.parameters())',
              'sinus = m.model.encoder.embed_positions.weight           # congelada: requires_grad = False',
              'print("total HF", n(m), "sin la tabla sinusoidal", n(m) - sinus.numel())',
              'print("encoder", n(m.model.encoder), "decoder", n(m.model.decoder))   # 88,154,112 / 153,580,800',
              'x = m.model.decoder.layers[0].encoder_attn',
              'print("cross-attn por capa", n(x), "k_proj.bias", x.k_proj.bias)       # 2,361,600 · None',
              'print("cabeza atada", m.proj_out.weight is m.model.decoder.embed_tokens.weight)   # True',
              '',
              '# 3) K, V cruzadas: 2 · L · N · D valores, calculados una vez por ventana',
              'torch.manual_seed(0)',
              'mm = WhisperForConditionalGeneration(cfg).eval()',
              'with torch.no_grad():',
              '    z = mm.model.encoder(torch.randn(1, 80, 3000)).last_hidden_state    # (1, 1500, 768)',
              '    out = mm(encoder_outputs=(z,), decoder_input_ids=torch.tensor([[50258, 50262, 50359, 50363]]))',
              'cross = out.past_key_values.cross_attention_cache',
              'vals = sum(l.keys.numel() + l.values.numel() for l in cross.layers)',
              'print("K,V cruzadas", vals, "valores =", vals * 2, "bytes fp16", tuple(cross.layers[0].keys.shape))',
              '# 27,648,000 valores = 55,296,000 bytes; (1, 12, 1500, 64) por capa',
              'try:',
              '    mm.model.encoder(torch.randn(1, 80, 1000))',
              'except ValueError as e:',
              '    print("el encoder pide 3000 frames:", str(e)[:60])',
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Lo que este ejercicio atrapa', html: R`<p>(1) Pensar que 10 s dan 1,000 frames: el extractor rellena a 30 s. (2) Olvidar el padding de la conv: sin padding, (3000 − 3)/2 + 1 no es entero redondo y saldrían 1,499 posiciones. (3) Contar 4D² + 4D en la cross-attention: K no tiene bias. (4) Sumar la cabeza de lenguaje como D·V parámetros extra: está atada. (5) Comparar con el "244M" del paper sin saber qué cuenta cada uno: la tabla sinusoidal congelada entra en <code>parameters()</code> de HF.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. El mismo encoder-decoder sobre texto, con span corruption y relative position bias, es <a href="#t5">T5</a>.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'whisper-01', kind: 'concepto', q: '¿Qué es Whisper en una línea?', a: 'Un transformer encoder-decoder que lee 30 s de audio como log-Mel y genera texto token a token, entrenado con 680,000 h de supervisión débil y evaluado zero-shot.' },
      { id: 'whisper-02', kind: 'forma', q: 'De 30 s de audio a posiciones del encoder.', a: '480,000 muestras a 16 kHz → 3,000 frames (salto de 10 ms) × 80 bins de Mel (128 en large-v3) → conv1d stride 1 → conv1d stride 2 → 1,500 posiciones (una cada 20 ms).' },
      { id: 'whisper-03', kind: 'trampa', q: '"Un clip de 3 s cuesta un décimo de encoder que uno de 30 s."', a: 'No: todo se rellena a 30 s y el encoder procesa siempre 1,500 posiciones. El 90 % de ese cómputo es relleno.' },
      { id: 'whisper-04', kind: 'trampa', q: '"Whisper trata el espectrograma como una imagen con convoluciones 2-D."', a: 'No: dos Conv1d sobre el tiempo, con los bins de Mel como canales de entrada.' },
      { id: 'whisper-05', kind: 'concepto', q: 'Posiciones en el encoder y en el decoder de Whisper.', a: 'Encoder: sinusoidales fijas (1,500). Decoder: aprendidas, 448 como máximo por ventana.' },
      { id: 'whisper-06', kind: 'concepto', q: R`El prompt del decoder para transcribir español sin tiempos.`, a: R`${tk('startoftranscript')} ${tk('es')} ${tk('transcribe')} ${tk('notimestamps')}, y después el texto hasta ${tk('endoftext')}.` },
      { id: 'whisper-07', kind: 'concepto', q: R`¿Cómo detecta Whisper el idioma?`, a: R`Un paso del decoder después de ${tk('startoftranscript')}: la distribución sobre los tokens de idioma (99; 100 en large-v3).` },
      { id: 'whisper-08', kind: 'concepto', q: R`Tokens de tiempo de Whisper.`, a: R`1,501 tokens ${tk('0.00')} … ${tk('30.00')} cada 20 ms, relativos a la ventana; marcan inicio y fin de segmentos, no de palabras.` },
      { id: 'whisper-09', kind: 'conteo', q: 'Datos de entrenamiento de Whisper.', a: '680,000 h: ≈ 438,000 h de inglés, 117,000 h en 96 otros idiomas y 125,000 h de traducción X → inglés.' },
      { id: 'whisper-10', kind: 'concepto', q: 'Supervisión débil en Whisper.', a: 'Transcripciones de internet sin verificar, filtradas con heurísticas (texto de otros ASR, idioma, desalineación, duplicados).' },
      { id: 'whisper-11', kind: 'conteo', q: 'Parámetros de Whisper small y su reparto.', a: R`${qn('params.total')} en el calculador (244M en la Tabla 1): encoder ${met('encP')}, decoder ${met('decP')}. El decoder pesa más por la tabla de embeddings y la cross-attention.` },
      { id: 'whisper-12', kind: 'formula', q: 'Bytes de las K, V cruzadas por ventana.', a: R`2 · L · N · D · bytes; small en fp16: ${met('crossKv')}. No crece con los tokens generados; sí con el batch.` },
      { id: 'whisper-13', kind: 'conteo', q: 'K, V de la cross-attention de Whisper small: cuánto cuestan y cuántas veces se calculan.', a: R`${met('crossKvMacs')} (2·L·N·D²), una sola vez por ventana de 30 s, aunque salgan cientos de tokens: con T<sub>out</sub> = ${cf('Tout')} son ${met('crossShare')} de los MACs de la ventana.` },
      { id: 'whisper-14', kind: 'tradeoff', q: 'Encoder vs decoder: FLOPs y latencia.', a: R`FLOPs: domina el encoder (${met('encMacs')} por ventana contra ${met('decTok')} por token). Latencia a batch chico: domina el decoder (pasos en serie, memory-bound).` },
      { id: 'whisper-15', kind: 'concepto', q: 'Distil-Whisper en una línea.', a: 'Encoder del maestro copiado y congelado + 2 capas de decoder, destilado con ≈ 22K h pseudo-etiquetadas (KL + pseudo-etiqueta); 5.8× más rápido, a ≈ 1 punto de WER.' },
      { id: 'whisper-16', kind: 'concepto', q: '¿Por qué Distil-Whisper recorta el decoder y no el encoder?', a: 'El decoder corre una vez por token y en serie; el encoder una vez por ventana y en paralelo. Además el encoder da la robustez acústica.' },
      { id: 'whisper-17', kind: 'concepto', q: 'Decodificación especulativa con Distil-Whisper.', a: 'Distil propone tokens con su decoder de 2 capas sobre el mismo encoder; el grande verifica en un forward. Misma salida que el grande, ≈ 2× más rápido (Tabla 9).' },
      { id: 'whisper-18', kind: 'concepto', q: 'large-v3-turbo.', a: 'large-v3 con el decoder podado de 32 a 4 capas y re-entrenado solo con transcripción: rápido, pero no sirve para traducir.' },
      { id: 'whisper-19', kind: 'concepto', q: 'Qué cambió en large-v3.', a: '128 bins de Mel, token de cantonés, 1M h débiles + 4M h pseudo-etiquetadas por large-v2; 10–20 % menos error.' },
      { id: 'whisper-20', kind: 'concepto', q: R`Las heurísticas del algoritmo largo del paper.`, a: R`Beam 5; temperature fallback (0 → 1.0 de a 0.2) si log-prob &lt; −1 o compresión gzip &gt; 2.4; texto previo solo con T &lt; 0.5; no-voz si P(nospeech) &gt; 0.6 y log-prob &lt; −1; primer tiempo ≤ 1 s.` },
      { id: 'whisper-21', kind: 'tradeoff', q: 'Transcripción larga: secuencial vs por trozos.', a: 'Secuencial: avanza por el último tiempo predicho y usa el texto previo; más exacto, sin paralelismo. Por trozos: solapados y en batch; 9.9× más rápido (large-v2), algo peor en las uniones.' },
      { id: 'whisper-22', kind: 'concepto', q: 'Tres modos de falla de Whisper.', a: 'Alucinación sobre silencio o ruido, bucles de repetición, y omitir palabras al inicio o fin de la ventana (más deriva de tiempos en audio largo).' },
      { id: 'whisper-23', kind: 'formula', q: 'Word error rate.', a: 'WER = (S + D + I) / N, del alineamiento de edición mínimo, con referencia e hipótesis normalizadas igual. Puede pasar de 100 %.' },
      { id: 'whisper-24', kind: 'trampa', q: '"Comparo el WER de dos sistemas tal como lo reporta cada librería."', a: 'Sin el mismo normalizador (mayúsculas, puntuación, números) los WER no son comparables. Normaliza igual las dos salidas y la referencia.' },
      { id: 'whisper-25', kind: 'concepto', q: '¿Para qué un VAD delante de Whisper?', a: 'Quita silencios: menos ventanas que pagar y menos alucinaciones; además permite agrupar segmentos de voz en batch (WhisperX).' },
      { id: 'whisper-26', kind: 'concepto', q: 'Tiempos por palabra con Whisper.', a: 'DTW sobre la cross-attention de unas cabezas de alineación (20 ms por posición) o alineación forzada con un modelo de fonemas CTC (WhisperX).' },
      { id: 'whisper-27', kind: 'trampa', q: '"Whisper sirve tal cual para un agente de voz en streaming."', a: 'No es streaming: ventanas de 30 s sin parciales. Re-decodificar un buffer (Whisper-Streaming) da ≈ 3.3 s; para cientos de ms, un transducer/CTC streaming.' },
      { id: 'whisper-28', kind: 'concepto', q: 'Detalle del bloque de Whisper que delata a quien leyó el código.', a: 'La proyección K de la atención no tiene bias (Q, V y la salida sí): un bias en K se cancela en el softmax.' },
      { id: 'whisper-29', kind: 'concepto', q: 'Fine-tuning de Whisper para un dominio con pocos datos.', a: 'Prompt de idioma y tarea fijo, LR bajo, pocas épocas; congelar el encoder o LoRA; test separado por hablante; medir el olvido en audio general. Antes, probar un prompt de vocabulario.' },
      { id: 'whisper-30', kind: 'formula', q: 'Factor de tiempo real (RTF).', a: 'Tiempo de cómputo ÷ duración del audio. RTF = 0.01 es 100× más rápido que tiempo real; siempre con el hardware y el batch explícitos.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'log-Mel spectrogram', es: 'espectrograma log-Mel', def: 'Energía del audio por frame en bandas de la escala de Mel, en escala logarítmica: la entrada de Whisper.', say: 'Whisper takes an eighty-bin log-Mel spectrogram.' },
      { en: 'weak supervision', es: 'supervisión débil', def: 'Entrenar con etiquetas ruidosas obtenidas sin anotación manual (transcripciones de internet), a cambio de escala y variedad.', say: 'Whisper is trained with large-scale weak supervision.' },
      { en: 'word error rate (WER)', es: 'tasa de error por palabra', def: '(sustituciones + borrados + inserciones) / palabras de la referencia, tras normalizar el texto.', say: 'We report normalized word error rate per slice.' },
      { en: 'voice activity detection (VAD)', es: 'detección de actividad de voz', def: 'Modelo que marca dónde hay voz en el audio; se usa para cortar silencios y para detectar el fin de un turno.', say: 'We run voice activity detection before transcription.' },
      { en: 'real-time factor (RTF)', es: 'factor de tiempo real', def: 'Tiempo de procesamiento dividido por la duración del audio; menor que 1 es más rápido que tiempo real.', say: 'Our real-time factor is point zero one on an A100 with batching.' },
      { en: 'timestamp tokens', es: 'tokens de tiempo', def: 'Tokens especiales de Whisper cada 20 ms dentro de la ventana de 30 s que marcan inicio y fin de segmentos.', say: 'Timestamp tokens give segment-level times.' },
      { en: 'temperature fallback', es: 'reintento con temperatura', def: 'Re-decodificar con temperatura creciente cuando la salida parece mala (log-prob bajo o texto muy repetitivo).', say: 'Temperature fallback breaks repetition loops.' },
      { en: 'long-form transcription', es: 'transcripción de audio largo', def: 'Transcribir audio de más de 30 s con Whisper, de forma secuencial (por tiempos predichos) o por trozos en paralelo.', say: 'Chunked long-form transcription is faster than sequential.' },
      { en: 'endpointing', es: 'detección de fin de turno', def: 'Decidir que el usuario terminó de hablar, en un agente de voz; suele usar un VAD y un umbral de silencio.', say: 'Endpointing takes a large share of the voice-agent latency budget.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
