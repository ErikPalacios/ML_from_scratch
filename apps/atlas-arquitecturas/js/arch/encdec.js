/* =============================================================================
   Atlas de Arquitecturas — js/arch/encdec.js
   Modelos `t5` (página `t5`) y `whisper` (página `whisper`); contrato SPEC §24. Tesis: el tercer sabor de transformer. Un
   encoder lee TODA la entrada una vez (bidireccional); un decoder causal genera token por token y mira la salida del encoder
   por cross-attention, cuyas K y V se calculan UNA vez por entrada. Cargar DESPUÉS de llm.js (usa su hardware H100 para las
   cotas ≈).
   Cross-check: crosscheck/encdec.py — HF T5ForConditionalGeneration / WhisperForConditionalGeneration construidos desde la config
   en el dispositivo META (sin pesos). Parámetros y FLOPs exactos (diferencia 0) en las 12 configs, formas por hooks, buckets de
   posición relativa contra HF y bytes de la KV cache medidos en la EncoderDecoderCache de HF.

   ---------------------------------------------------------------- configs (verificadas contra los config.json de HF)
   T5 (Raffel et al., JMLR 2020, arXiv:1910.10683; config.json de google-t5/t5-{small,base,large}): RMSNorm sin sesgo (T5LayerNorm:
   solo γ, ε 1e-6), pre-norm, NINGÚN Linear con sesgo, FFN ReLU, d_kv = 64, vocab 32,128 (32,000 piezas SentencePiece + 100
   centinelas <extra_id_i>, relleno a múltiplo de 128), 32 buckets de posición relativa con distancia máxima 128 (default de
   T5Config; una tabla por stack, en la capa 1), embedding COMPARTIDO por encoder, decoder y LM head (atado) con el reescalado
   d_model^−0.5 antes del LM head.
     t5-small 6 + 6 capas, 512, 8 cabezas, FFN 2,048 → 60,506,624 parámetros
     t5-base  12 + 12, 768, 12, 3,072 (canónica)     → 222,903,552
     t5-large 24 + 24, 1,024, 16, 4,096               → 737,668,096
     flan-t5-base (Chung et al. 2022, arXiv:2210.11416; T5 v1.1: config.json de google/flan-t5-base): FFN gated-GELU (wi_0, wi_1,
     d_ff 2,048, gelu_new), LM head NO atado y sin reescalado → 247,577,856. OJO: en transformers 5.x T5Config fuerza
     tie_word_embeddings = True y solo usa el valor del config para scale_decoder_outputs; al cargar el checkpoint real lm_head y
     shared vienen distintos y HF los desata: el cross-check desata lm_head a mano para reproducir el checkpoint.
   Whisper (Radford et al., ICML 2023, arXiv:2212.04356, Tabla 1; config.json de openai/whisper-*): log-Mel de 80 bandas (128 en
   large-v3) × 3,000 frames (30 s, hop 10 ms) → conv1d k 3 (80 → D) + GELU → conv1d k 3 stride 2 (D → D) + GELU → 1,500 posiciones
   + posición sinusoidal fija (BUFFER: el original de OpenAI la registra con register_buffer; HF la guarda como nn.Embedding
   congelado y la cuenta en parameters(): quantities.paramsHF la suma) → L capas pre-LN (LayerNorm con β, GELU, W_K SIN sesgo,
   W_Q / W_V / W_O / FFN con sesgo) → LayerNorm final. Decoder: embedding de tokens (atado al LM head, sin reescalado) + posición
   APRENDIDA de 448 × D, capas pre-LN con self-attention causal + cross-attention + FFN, LayerNorm final.
     whisper-tiny 4 + 4, 384, 6 cabezas, FFN 1,536 · base 6 + 6, 512, 8, 2,048 · small 12 + 12, 768, 12, 3,072 (canónica) ·
     medium 24 + 24, 1,024, 16, 4,096 · large-v3 32 + 32, 1,280, 20, 5,120, 128 mels, vocab 51,866 ·
     distil-whisper-large-v3 (Gandhi et al. 2023, arXiv:2311.00430; config.json de distil-whisper/distil-large-v3): el encoder de
     large-v3 entero y 2 capas de decoder. Vocab 51,865 salvo large-v3 / distil (51,866: un token de idioma más, cantonés).
     Parámetros (sin el buffer sinusoidal / HF): tiny 37,184,640 / 37,760,640 · base 71,825,920 / 72,593,920 · small 240,582,912 /
     241,734,912 · medium 762,321,920 / 763,857,920 · large-v3 1,541,570,560 / 1,543,490,560 · distil 754,485,760 / 756,405,760.

   ---------------------------------------------------------------- convenciones
   Formas sin batch. Símbolos: T_in (tokens de entrada del encoder; Whisper: 1,500 posiciones fijas), T_out (posiciones del decoder:
   prompt + texto), D, h, d_h (= d_kv de T5), D_mlp (= d_ff), V, L (capas del encoder), L_d (cfg.Ld, del decoder; = L salvo distil),
   n_mels, S (muestras de audio = seconds·16,000), ctx (decode: T_out filas en la caché propia). MACs = matmuls y convs (FLOPs =
   2·MACs = FlopCounterMode). Normas, softmax, activaciones, sesgos relativos, máscara, log-Mel: "otros" (≈).
   QKᵀ y A·V con la máscara causal cuentan las T² entradas (como la atención eager de HF y FlopCounterMode).
   T5 no escala QKᵀ por 1/√d_h (lo absorbe la inicialización): no hay op `scale`; Whisper multiplica q por d_h^−0.5 (HF) — aquí
   la op `scale` sobre los scores (mismo resultado, "otros").

   Grafo por defecto = el forward de HF con teacher forcing: el encoder sobre T_in una vez + el decoder sobre las T_out posiciones
   EN PARALELO (entrenamiento, o el prefill del prompt). decode = 1 (configs t5-base-decode / whisper-small-decode, cfg.decodeOf =
   la de prefill): UN paso de generación en la posición T_out: la self-attention lee ctx = T_out filas (T_out − 1 de la caché +
   la nueva) y la cross-attention lee las K y V del encoder YA guardadas (c-k-heads, c-v-heads son entradas). En ese grafo el
   encoder, el front end y W_K / W_V de la cross-attention no corren: van como ops idle_params (totals.params = el modelo entero).
   Knobs: t5 Tin, Tout, B, decode; whisper Tout (≤ 448), B, seconds (1 … 30: el audio se rellena a 30 s), decode.

   ---------------------------------------------------------------- nodos (op.path) y ops → tensores
   T5 vista `t5-overview`: input (glifo de ids), embed, encoder (×L) › enc-attn | enc-ffn, enc-out, decoder (×L_d; expande
   `t5-decoder-layer`) › self-attn | cross-attn | ffn, dec-norm, lm-head, output. Vista `span-corruption` (datos: quantities.span…).
   Whisper vista `whisper-overview`: audio, mel, conv › conv1 | gelu1 | conv2 | gelu2 | pos, encoder (×L) › enc-attn | enc-ffn,
   enc-out, prompt-tokens › tok-embed | pos-embed | add, decoder (×L_d) › self-attn | cross-attn | ffn, dec-norm, lm-head, text.
   Nodos internos de atención: norm, q-proj, k-proj, v-proj, split, kv-cache (decode), scores, rel-bias + add-bias (T5, solo
   self-attention) | scale (Whisper), mask (self del decoder, no en decode), softmax, weighted-sum, merge, o-proj, res.
   FFN: norm, fc1, gate + mul (flan-t5, gated-GELU), act, fc2, res.
     T5 embed:   enc-embed (ids → e-x0, T_in×D) · dec-embed (dec-ids → d-x0, T_out×D; misma tabla: paramRepeat 0)
     Whisper:    pad-audio (audio S → audio-30s 480000) · log-mel (→ mel 3000×n_mels) · conv1 (→ conv1-out 3000×D) · conv1-gelu
                 (→ conv1-act) · conv2 (stride 2 → conv2-out 1500×D) · conv2-gelu (→ conv2-act) · enc-pos (buffer → e-pos 1500×D)
                 · enc-add-pos (→ e-x0) ; dec-embed (dec-ids → d-tok) · dec-pos (dec-pos-ids → d-pos; tabla 448×D) · dec-add-pos
                 (→ d-x0)
     Encoder (repeat L): enc-norm1 → e-h1 · enc-q / enc-k / enc-v → e-q / e-k / e-v · enc-split → e-q-heads e-k-heads e-v-heads
                 (h×T_in×d_h) · enc-scores → e-scores (h×T_in×T_in) · T5: enc-rel-bias (repeat 1: capa 1) → e-bias, enc-add-bias
                 → e-scores-biased · Whisper: enc-scale → e-scores-scaled · enc-softmax → e-attn · enc-weighted-sum → e-z-heads ·
                 enc-merge → e-z · enc-o → e-o · enc-res1 → e-r1 · enc-norm2 → e-h2 · [enc-gate → e-gate] · enc-fc1 → e-u ·
                 enc-act → e-g · [enc-mul → e-prod] · enc-fc2 → e-f · enc-res2 → e-x-out
     enc-final-norm (path enc-out) → enc-out (T_in×D)
     Decoder (repeat L_d), self: dec-norm1 → d-h1 · dec-q / dec-k / dec-v → d-q / d-k / d-v · dec-split → d-q-heads d-k-heads
                 d-v-heads · [decode: entradas d-k-past / d-v-past (h×(ctx−1)×d_h); dec-kv-append-k / -v → d-k-ctx / d-v-ctx] ·
                 dec-scores → d-scores · T5: dec-rel-bias (repeat 1) → d-bias, dec-add-bias → d-scores-biased · Whisper:
                 dec-scale → d-scores-scaled · dec-mask → d-masked (no en decode) · dec-softmax → d-attn · dec-weighted-sum →
                 d-z-heads · dec-merge → d-z · dec-o → d-o · dec-res1 → d-r1
              cross: cross-norm → c-h · cross-q → c-q (T_out×D) · cross-k / cross-v (de enc-out) → c-k / c-v (T_in×D) ·
                 cross-split → c-q-heads (h×T_out×d_h), c-k-heads, c-v-heads (h×T_in×d_h) [decode: solo c-q-heads; c-k-heads y
                 c-v-heads son entradas (la cross KV cache)] · cross-scores → c-scores (h×T_out×T_in) · Whisper: cross-scale →
                 c-scores-scaled · cross-softmax → c-attn · cross-weighted-sum → c-z-heads · cross-merge → c-z · cross-o → c-o ·
                 cross-res → d-r2
              FFN: dec-norm3 → d-h3 · [dec-gate → d-gate] · dec-fc1 → d-u · dec-act → d-g · [dec-mul → d-prod] · dec-fc2 → d-f ·
                 dec-res3 → d-x-out
     dec-final-norm (path dec-norm) → dec-out · lm-rescale (T5 atado; path lm-head, × D^−0.5) → dec-out-scaled · lm-head (path
     lm-head) → logits (T_out×V; decode 1×V) · sample (path output | text) → next-token
     Decode: encoder-idle (path encoder), enc-out-idle (enc-out), frontend-idle (conv; Whisper), cross-kv-idle (decoder ›
     cross-attn › kv-proj, repeat L_d).

   ---------------------------------------------------------------- métricas (B = 1, bf16 por defecto; units en metrics.units)
   Ver quantities() / metrics(). Generación = encoder UNA vez + K/V de la cross-attention UNA vez (crossKvMacs = 2·L_d·T_in·D·h·d_h)
   + Σ_{t=1}^{T_out} paso(t), con paso(t) = lineales de un token (self Q K V O, cross Q O, FFN, LM head) + 2·L_d·h·d_h·(t + T_in)
   (scores y A·V de la self sobre t filas y de la cross sobre T_in). decoderMacsPerToken = paso(T_out) (= los MACs del grafo de
   decode; incluye el LM head; decoderLayerMacsPerToken = self + cross + FFN sin el LM head). Bytes: crossKvBytes = 2·L_d·T_in·h·d_h
   ·bytes·B (se escribe una vez y se LEE en cada paso), selfKvCacheBytes = 2·L_d·T_out·h·d_h·bytes·B. Tiempos ≈ (roofline H100 SXM,
   entradas bandwidth / peakFlops como en llm.js): cada fase = máx(FLOPs/pico, bytes/ancho de banda), sin overheads; el paso de
   decode lee los pesos del decoder (sin W_K / W_V de la cross) + el LM head + las dos cachés. realtimeFactor (Whisper) =
   generationMs / duración del audio (< 1: más rápido que el tiempo real).

   ---------------------------------------------------------------- desviaciones respecto de SPEC §24 (añadidos; nada renombrado)
   - Nodos añadidos: dec-norm (LayerNorm / RMSNorm final del decoder, entre decoder y lm-head) y los internos de arriba; la capa
     del encoder se llama enc-attn / enc-ffn (la del decoder self-attn / cross-attn / ffn, como pide la SPEC) para que byNode no
     mezcle las dos pilas.
   - decoderMacsPerToken incluye el LM head (es lo que cuesta un token); la suma self + cross + FFN de la SPEC es
     decoderLayerMacsPerToken.
   - Whisper: la posición sinusoidal del encoder es un buffer (no parámetro), como en el código de OpenAI; HF la cuenta
     (quantities.paramsHF). El paper redondea (Tabla 1: 39M / 74M / 244M / 769M / 1550M).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel || !A.conv1d || !A.t5_rel_bias) throw new Error('encdec.js necesita js/arch/primitives.js (fase 12) antes.');
  if (!A.hasConfig || !A.hasConfig('llama3-8b')) throw new Error('encdec.js necesita js/arch/llm.js antes (hardware H100 de las cotas ≈).');
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);

  // ------------------------------------------------------------------ hardware (≈, entradas de las cotas de roofline)
  const H100 = Object.assign({ id: 'h100', label: 'H100 SXM' }, A.model('llm').hardware);   // 3.35 TB/s, 989 TFLOPS bf16 denso

  // ------------------------------------------------------------------ span corruption (T5, §3.1.4 y Tabla 7 del paper)
  // random_spans_helper de google-research/text-to-text-transfer-transformer (t5/data/preprocessors.py): dado el largo de entrada
  // (512), busca el texto crudo más largo que, con 15 % de ruido en spans de media 3 (cada span → 1 centinela en la entrada y 1 en
  // el objetivo, + EOS), cabe en 512 tokens. round() de Python = redondeo bancario (half to even).
  const pyRound = (x) => { const f = Math.floor(x), d = x - f; if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1; };
  function spanLengths(tokens, density, meanSpan) {
    const noise = pyRound(tokens * density), spans = pyRound(noise / meanSpan);
    return { tokens, noise, nonNoise: tokens - noise, spans, inputs: tokens - noise + spans + 1, targets: noise + spans + 1 };
  }
  function spanCorruption(inputsLength, density, meanSpan) {
    density = density === undefined ? 0.15 : density; meanSpan = meanSpan === undefined ? 3 : meanSpan;
    let t = inputsLength - 1;
    while (spanLengths(t + 1, density, meanSpan).inputs <= inputsLength) t += 1;
    return Object.assign(spanLengths(t, density, meanSpan), { density, meanSpan, inputsLength });
  }

  // ------------------------------------------------------------------ configs
  const T5_SRC = 'Raffel et al., JMLR 2020, arXiv:1910.10683 (§3.1, Tabla 14); config.json de HF ';
  const T5_BASE = { kind: 't5', Tin: 512, Tout: 114, B: 1, decode: 0, norm: 'rmsnorm', eps: 1e-6, dh: 64, V: 32128, buckets: 32, maxDistance: 128,
    qBias: false, kBias: false, vBias: false, oBias: false, mlpBias: false, gated: false, act: 'relu', tied: true, rescale: true, TinTrain: 512 };
  const T5_LEN = ' T_in = 512 y T_out = 114: los largos del preentrenamiento con span corruption (512 tokens de entrada y 114 de objetivo, de 568 crudos: random_spans_helper del código de T5).';
  const WH_SRC = 'Radford et al., ICML 2023, arXiv:2212.04356 (§2.2, §2.3, Tabla 1); config.json de HF ';
  const WH_BASE = { kind: 'whisper', Tout: 128, B: 1, seconds: 30, decode: 0, norm: 'layernorm', eps: 1e-5, nMels: 80, V: 51865, Tmax: 448,
    encPos: 1500, melFrames: 3000, sr: 16000, hop: 160, nFft: 400, chunk: 30, qBias: true, kBias: false, vBias: true, oBias: true, mlpBias: true,
    gated: false, act: 'gelu', tied: true, rescale: false, promptTokens: 4 };
  const WH_LEN = ' T_out = 128 (ilustrativo, ≤ 448): 4 tokens del prompt (<|startoftranscript|><|en|><|transcribe|><|notimestamps|>) + 124 de texto; 30 s de habla son ≈ 75–100 palabras.';
  const CONFIGS = {
    't5-small': Object.assign({}, T5_BASE, { label: 'T5-Small', D: 512, L: 6, Ld: 6, h: 8, Dmlp: 2048, hf: 'google-t5/t5-small',
      source: T5_SRC + 'google-t5/t5-small (d_model 512, 6 + 6 capas, 8 cabezas, d_kv 64, d_ff 2,048, ReLU, vocab 32,128, 32 buckets). «60M» del paper.' + T5_LEN }),
    't5-base': Object.assign({}, T5_BASE, { label: 'T5-Base', D: 768, L: 12, Ld: 12, h: 12, Dmlp: 3072, canonical: true, hf: 'google-t5/t5-base',
      source: T5_SRC + 'google-t5/t5-base (d_model 768, 12 + 12 capas, 12 cabezas, d_kv 64, d_ff 3,072, ReLU, vocab 32,128, 32 buckets, distancia máxima 128 = default de T5Config, ε 1e-6, embeddings atados con reescalado d_model^−0.5). «220M» del paper.' + T5_LEN }),
    't5-large': Object.assign({}, T5_BASE, { label: 'T5-Large', D: 1024, L: 24, Ld: 24, h: 16, Dmlp: 4096, hf: 'google-t5/t5-large',
      source: T5_SRC + 'google-t5/t5-large (d_model 1,024, 24 + 24 capas, 16 cabezas, d_kv 64, d_ff 4,096). «770M» del paper.' + T5_LEN }),
    'flan-t5-base': Object.assign({}, T5_BASE, { label: 'Flan-T5-Base (T5 v1.1)', D: 768, L: 12, Ld: 12, h: 12, Dmlp: 2048, gated: true, act: 'gelu_new', tied: false, rescale: false,
      hf: 'google/flan-t5-base',
      source: 'Chung et al. 2022, Scaling Instruction-Finetuned Language Models, arXiv:2210.11416 (Flan-T5 = T5 v1.1 + instruction tuning); config.json de HF google/flan-t5-base (d_model 768, 12 + 12 capas, 12 cabezas, d_ff 2,048, feed_forward_proj gated-gelu → gelu_new, tie_word_embeddings false: LM head propio y sin reescalado). T5 v1.1: GEGLU, embedding y LM head sin atar, sin dropout en el preentrenamiento (README de T5 v1.1).' + T5_LEN }),
    'whisper-tiny': Object.assign({}, WH_BASE, { label: 'Whisper tiny', D: 384, L: 4, Ld: 4, h: 6, Dmlp: 1536, hf: 'openai/whisper-tiny',
      source: WH_SRC + 'openai/whisper-tiny (d_model 384, 4 + 4 capas, 6 cabezas, FFN 1,536, 80 mels, vocab 51,865). «39M» del paper.' + WH_LEN }),
    'whisper-base': Object.assign({}, WH_BASE, { label: 'Whisper base', D: 512, L: 6, Ld: 6, h: 8, Dmlp: 2048, hf: 'openai/whisper-base',
      source: WH_SRC + 'openai/whisper-base (d_model 512, 6 + 6 capas, 8 cabezas, FFN 2,048). «74M» del paper.' + WH_LEN }),
    'whisper-small': Object.assign({}, WH_BASE, { label: 'Whisper small', D: 768, L: 12, Ld: 12, h: 12, Dmlp: 3072, canonical: true, hf: 'openai/whisper-small',
      source: WH_SRC + 'openai/whisper-small (d_model 768, 12 + 12 capas, 12 cabezas, FFN 3,072, 80 mels, 1,500 posiciones del encoder, 448 del decoder, vocab 51,865). «244M» del paper.' + WH_LEN }),
    'whisper-medium': Object.assign({}, WH_BASE, { label: 'Whisper medium', D: 1024, L: 24, Ld: 24, h: 16, Dmlp: 4096, hf: 'openai/whisper-medium',
      source: WH_SRC + 'openai/whisper-medium (d_model 1,024, 24 + 24 capas, 16 cabezas, FFN 4,096). «769M» del paper.' + WH_LEN }),
    'whisper-large-v3': Object.assign({}, WH_BASE, { label: 'Whisper large-v3', D: 1280, L: 32, Ld: 32, h: 20, Dmlp: 5120, nMels: 128, V: 51866, hf: 'openai/whisper-large-v3',
      source: WH_SRC + 'openai/whisper-large-v3 (d_model 1,280, 32 + 32 capas, 20 cabezas, FFN 5,120, 128 mels, vocab 51,866). large-v3 no tiene paper propio (model card de OpenAI, nov. 2023): misma arquitectura que large («1550M»), 128 bandas mel y un token de idioma más.' + WH_LEN }),
    'distil-whisper-large-v3': Object.assign({}, WH_BASE, { label: 'Distil-Whisper large-v3', D: 1280, L: 32, Ld: 2, h: 20, Dmlp: 5120, nMels: 128, V: 51866, hf: 'distil-whisper/distil-large-v3',
      source: 'Gandhi, von Platen y Rush 2023, Distil-Whisper, arXiv:2311.00430 (§3: se copia el encoder entero y se congela; el decoder se reduce a 2 capas, inicializadas con la primera y la última del maestro); config.json de HF distil-whisper/distil-large-v3 (32 capas de encoder, 2 de decoder, 1,280, 20 cabezas, 128 mels).' + WH_LEN }),
  };
  // Configs de decode: un paso de generación en la posición T_out (decodeOf = la config de prefill).
  const DEC_SRC = ' Config de decode: UN paso de generación (1 token nuevo; la self-attention lee T_out filas de su caché y la cross-attention las K, V del encoder ya guardadas).';
  [['t5-base-decode', 't5-base'], ['whisper-small-decode', 'whisper-small']].forEach(([id, of]) => {
    const b = CONFIGS[of];
    CONFIGS[id] = Object.assign({}, b, { label: b.label + ' · decode', canonical: false, decode: 1, decodeOf: of, source: b.source + DEC_SRC });
  });
  const T5_IDS = ['t5-small', 't5-base', 't5-large', 'flan-t5-base', 't5-base-decode'];
  const WH_IDS = ['whisper-tiny', 'whisper-base', 'whisper-small', 'whisper-medium', 'whisper-large-v3', 'distil-whisper-large-v3', 'whisper-small-decode'];
  const pick = (ids) => { const o = {}; ids.forEach((id) => { o[id] = CONFIGS[id]; }); return o; };

  function applyKnobs(c, ov) {
    const notes = [];
    ['Tin', 'Tout', 'B', 'seconds', 'decode'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    if (c.decode !== 0 && c.decode !== 1) throw new Error(c.label + ': decode debe ser 1 (un paso de generación) u omitirse.');
    if (c.kind === 'whisper') {
      if (c.seconds > c.chunk) throw new Error(c.label + ': seconds = ' + c.seconds + '; Whisper procesa ventanas de ' + c.chunk + ' s (audio más largo se parte en ventanas: long-form).');
      if (c.Tout > c.Tmax) throw new Error(c.label + ': T_out = ' + c.Tout + ' supera las ' + c.Tmax + ' posiciones aprendidas del decoder.');
      if (c.seconds < c.chunk) notes.push(c.seconds + ' s de audio: se rellena con ceros hasta ' + c.chunk + ' s; el encoder procesa igual las 1,500 posiciones.');
    } else if (c.Tin > c.TinTrain) notes.push('T_in = ' + fint(c.Tin) + ' supera los ' + c.TinTrain + ' tokens del preentrenamiento: el conteo vale (la posición relativa no tiene tabla por posición), la calidad no está garantizada.');
    if (c.decode === 1 && c.Tout < 2) throw new Error(c.label + ': en decode T_out debe ser ≥ 2 (el token nuevo + al menos uno en la caché).');
    if (c.decode === 1) c.label += (c.decodeOf ? ' (paso ' : ' · decode (paso ') + fint(c.Tout) + ')';
    c._notes = notes;
    return c;
  }

  function resolve(c) {
    if (c.kind === 'whisper') {
      c.dh = c.D / c.h;
      c.Tin = c.encPos;                 // posiciones del encoder: siempre 1,500 (30 s)
      c.samples = c.seconds * c.sr;
    }
    if (!Number.isInteger(c.dh)) throw new Error(c.label + ': D = ' + c.D + ' no es divisible por h = ' + c.h + '.');
    c.inner = c.h * c.dh;
    c.innerSym = c.inner === c.D ? 'D' : 'h·d_h';
    c.Tq = c.decode === 1 ? 1 : c.Tout;      // filas de query del decoder en este forward
    c.ctx = c.Tout;                          // decode: filas que lee la self-attention
    c.past = c.decode === 1 ? c.Tout - 1 : 0;
    c.tokens = c.Tin;
    return c;
  }

  // ------------------------------------------------------------------ bloques
  const ID = {
    enc: { op: 'enc-', t: 'e-', norm: 'enc-norm1', h: 'e-h1', res: 'enc-res1', r: 'e-r1', P: ['encoder', 'enc-attn'] },
    self: { op: 'dec-', t: 'd-', norm: 'dec-norm1', h: 'd-h1', res: 'dec-res1', r: 'd-r1', P: ['decoder', 'self-attn'] },
    cross: { op: 'cross-', t: 'c-', norm: 'cross-norm', h: 'c-h', res: 'cross-res', r: 'd-r2', P: ['decoder', 'cross-attn'] },
  };
  const normOf = (c, x) => (c.norm === 'rmsnorm' ? A.rmsnorm(x, { eps: c.eps }) : A.layernorm(x, { eps: c.eps }));
  const normName = (c) => (c.norm === 'rmsnorm' ? 'RMSNorm (T5LayerNorm: solo γ)' : 'LayerNorm');

  // Atención (sub-capa pre-norm con su residual). o = {kind: 'enc'|'self'|'cross', x, mem (enc-out; cross), rep, W (where)}
  function attnBlock(g, c, o) {
    const I = ID[o.kind], dec = c.decode === 1, t5 = c.kind === 't5';
    const self = o.kind !== 'cross', causal = o.kind === 'self';
    const mod = o.kind === 'enc' ? o.x.mod : 'txt';
    const lab = { enc: 'encoder · self-attention · ', self: 'decoder · self-attention causal · ', cross: 'decoder · cross-attention · ' }[o.kind];
    const Lm = (m) => Object.assign({ perLayer: true }, m, { label: lab + m.label });
    const op = (id, res, node, extra) => g.op(I.op + id, res, Object.assign({ path: I.P.concat([node]), repeat: o.rep, where: o.W }, extra,
      extra && extra.outMeta ? { outMeta: Array.isArray(extra.outMeta) ? extra.outMeta.map(Lm) : Lm(extra.outMeta) } : {}));
    const T = (n) => I.t + n;
    const iS = c.innerSym;
    const h = g.op(I.norm, normOf(c, o.x), { path: I.P.concat(['norm']), repeat: o.rep, where: o.W, out: I.h, label: normName(c) + ' antes de la ' + (o.kind === 'cross' ? 'cross-attention' : 'self-attention'),
      type: 'norm', group: 'norm', outMeta: Lm({ label: 'entrada normalizada', tex: '\\mathrm{Norm}(x)' }) });
    const q = op('q', A.linear(h, { dout: c.inner, doutSym: iS, bias: c.qBias }), 'q-proj', { out: T('q'), label: 'Proyección W_Q' + (c.qBias ? '' : ' (sin sesgo)'), type: 'embed', group: 'attn',
      outMeta: { label: 'Q (del ' + (o.kind === 'enc' ? 'encoder' : 'decoder') + ')', tex: 'Q = xW_Q' } });
    let qh, kh, vh;
    if (o.kind === 'cross' && dec) {
      // decode: K y V de la cross-attention ya están en la caché (se calcularon una vez con enc-out)
      qh = op('split', A.split_heads(q, { h: c.h }), 'split', { out: T('q-heads'), label: 'Separar Q en ' + c.h + ' cabezas', type: 'tensorop', group: 'attn',
        outMeta: { label: 'queries por cabeza', tex: 'Q_i' } });
      const meta = (l, tex) => ({ label: 'decoder · cross-attention · ' + l + ' (cross KV cache: T_in = ' + fint(c.Tin) + ' filas, por capa; se calcularon una vez)', tex, perLayer: true });
      kh = g.input(T('k-heads'), shp(['h', 'T_in', 'd_h'], [c.h, c.Tin, c.dh], 'txt', 'heads'), meta('keys del encoder', 'K_{\\mathrm{enc}}'));
      vh = g.input(T('v-heads'), shp(['h', 'T_in', 'd_h'], [c.h, c.Tin, c.dh], 'txt', 'heads'), meta('values del encoder', 'V_{\\mathrm{enc}}'));
    } else {
      const src = o.kind === 'cross' ? o.mem : h;
      const from = o.kind === 'cross' ? ' (de enc-out: una vez por entrada)' : '';
      const k = op('k', A.linear(src, { dout: c.inner, doutSym: iS, bias: c.kBias }), 'k-proj', { out: T('k'), label: 'Proyección W_K' + (c.kBias ? '' : ' (sin sesgo)') + from, type: 'embed', group: 'attn',
        outMeta: { label: 'K' + (o.kind === 'cross' ? ' (del encoder)' : ''), tex: o.kind === 'cross' ? 'K = HW_K' : 'K = xW_K' } });
      const v = op('v', A.linear(src, { dout: c.inner, doutSym: iS, bias: c.vBias }), 'v-proj', { out: T('v'), label: 'Proyección W_V' + (c.vBias ? '' : ' (sin sesgo)') + from, type: 'embed', group: 'attn',
        outMeta: { label: 'V' + (o.kind === 'cross' ? ' (del encoder)' : ''), tex: o.kind === 'cross' ? 'V = HW_V' : 'V = xW_V' } });
      [qh, kh, vh] = op('split', A.split_qkv_heads(q, k, v, { h: c.h }), 'split', { out: [T('q-heads'), T('k-heads'), T('v-heads')], label: 'Separar en ' + c.h + ' cabezas', type: 'tensorop', group: 'attn',
        outMeta: [{ label: 'queries por cabeza', tex: 'Q_i' }, { label: 'keys por cabeza', tex: 'K_i' }, { label: 'values por cabeza', tex: 'V_i' }] });
    }
    let kAll = kh, vAll = vh;
    if (causal && dec) {
      const meta = (l, tex) => ({ label: 'decoder · self-attention · ' + l + ' (ctx − 1 = ' + fint(c.ctx - 1) + ' filas, por capa)', tex, perLayer: true });
      const kp = g.input(T('k-past'), shp(['h', 'ctx-1', 'd_h'], [c.h, c.ctx - 1, c.dh], 'txt', 'heads'), meta('keys guardadas', 'K_{\\mathrm{cache}}'));
      const vp = g.input(T('v-past'), shp(['h', 'ctx-1', 'd_h'], [c.h, c.ctx - 1, c.dh], 'txt', 'heads'), meta('values guardados', 'V_{\\mathrm{cache}}'));
      kAll = op('kv-append-k', A.kv_append(kp, kh, { sym: 'ctx' }), 'kv-cache', { out: T('k-ctx'), label: 'KV cache: agregar la key nueva', type: 'tensorop', group: 'attn',
        outMeta: { label: 'keys de todo el contexto (ctx = ' + fint(c.ctx) + ')', tex: '[K_{\\mathrm{cache}};\\,k_t]' } });
      vAll = op('kv-append-v', A.kv_append(vp, vh, { sym: 'ctx' }), 'kv-cache', { out: T('v-ctx'), label: 'KV cache: agregar el value nuevo', type: 'tensorop', group: 'attn',
        outMeta: { label: 'values de todo el contexto (ctx = ' + fint(c.ctx) + ')', tex: '[V_{\\mathrm{cache}};\\,v_t]' } });
    }
    let s = op('scores', A.attention_scores(qh, kAll), 'scores', { out: T('scores'), label: o.kind === 'cross' ? 'QKᵀ: cada token del decoder contra las T_in posiciones del encoder' : 'Producto QKᵀ', type: 'attn', group: 'attn',
      outMeta: { label: 'scores' + (t5 ? ' (T5: sin escalar)' : ' sin escalar'), tex: 'QK^\\top' } });
    if (t5 && self) {
      const Tq = dec ? 1 : (o.kind === 'enc' ? c.Tin : c.Tout), Tk = dec ? c.ctx : Tq;
      const qSym = dec ? '1' : (o.kind === 'enc' ? 'T_in' : 'T_out'), kSym = dec ? 'ctx' : qSym;
      const bi = o.kind === 'enc';
      const b = op('rel-bias', A.t5_rel_bias({ h: c.h, Tq, Tk, qSym, kSym, buckets: c.buckets, maxDistance: c.maxDistance, bidirectional: bi, pos0: dec ? c.ctx - 1 : 0 }), 'rel-bias', {
        repeat: 1, out: T('bias'), label: 'Sesgo de posición relativa (' + c.buckets + ' buckets × ' + c.h + ' cabezas, ' + (bi ? 'bidireccional' : 'solo el pasado') + '; se calcula en la capa 1 y lo reusan las ' + (bi ? c.L : c.Ld) + ')',
        type: 'attn', group: 'attn', outMeta: { label: 'sesgo relativo B (por cabeza)', tex: 'B_{qk} = b_{\\mathrm{bucket}(k-q)}' } });
      s = op('add-bias', A.add_rel_bias(s, b), 'add-bias', { out: T('scores-biased'), label: 'Sumar el sesgo relativo', type: 'attn', group: 'attn',
        outMeta: { label: 'scores + sesgo relativo', tex: 'QK^\\top + B' } });
    } else if (!t5) {
      s = op('scale', A.scale(s), 'scale', { out: T('scores-scaled'), label: 'Escala 1/√d_h', type: 'attn', group: 'attn',
        outMeta: { label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' } });
    }
    if (causal && !dec) {
      s = op('mask', A.causal_mask(s), 'mask', { out: T('masked'), label: 'Máscara causal (−∞ sobre el futuro)', type: 'attn', group: 'attn',
        outMeta: { label: 'scores enmascarados (causal)', tex: '\\cdot + M_{\\mathrm{causal}}' } });
    }
    const a = op('softmax', A.softmax(s), 'softmax', { out: T('attn'), label: 'Softmax por fila', type: 'attn', group: 'attn',
      outMeta: { label: o.kind === 'cross' ? 'pesos de cross-attention (a qué parte de la entrada mira cada token)' : 'pesos de atención', tex: 'A' } });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, vAll), 'weighted-sum', { out: T('z-heads'), label: 'Suma ponderada A·V', type: 'attn', group: 'attn',
      outMeta: { label: 'salida por cabeza', tex: 'AV' } });
    const z = op('merge', A.merge_heads(zh, { Dsym: iS }), 'merge', { out: T('z'), label: 'Concatenar las ' + c.h + ' cabezas', type: 'tensorop', group: 'attn',
      outMeta: { label: 'cabezas concatenadas', tex: 'Z' } });
    const ov = op('o', A.linear(z, { dout: c.D, doutSym: 'D', bias: c.oBias }), 'o-proj', { out: T('o'), label: 'Proyección de salida W_O' + (c.oBias ? '' : ' (sin sesgo)'), type: 'embed', group: 'attn',
      outMeta: { label: 'salida de la ' + (o.kind === 'cross' ? 'cross-attention' : 'atención'), tex: 'O = ZW_O' } });
    return g.op(I.res, A.residual_add(o.x, ov), { path: I.P.concat(['res']), repeat: o.rep, where: o.W, out: I.r, label: 'Residual', type: 'tensorop', group: 'resid',
      outMeta: Lm({ label: 'x + ' + (o.kind === 'cross' ? 'cross-attention' : 'atención'), tex: o.kind === 'cross' ? "x'' = x' + O" : "x' = x + O" }) });
  }

  // FFN (sub-capa pre-norm con su residual). o = {kind: 'enc'|'dec', x, rep, W}
  function ffnBlock(g, c, o) {
    const e = o.kind === 'enc';
    const p = e ? 'enc-' : 'dec-', t = e ? 'e-' : 'd-', P = e ? ['encoder', 'enc-ffn'] : ['decoder', 'ffn'];
    const lab = (e ? 'encoder' : 'decoder') + ' · FFN · ';
    const Lm = (m) => Object.assign({ perLayer: true }, m, { label: lab + m.label });
    const op = (id, res, node, extra) => g.op(id, res, Object.assign({ path: P.concat([node]), repeat: o.rep, where: o.W, type: 'mlp', group: 'mlp' }, extra, { outMeta: Lm(extra.outMeta) }));
    const actF = c.act === 'relu' ? A.relu : A.gelu;
    const actL = c.act === 'relu' ? 'ReLU' : (c.act === 'gelu_new' ? 'GELU (aprox. tanh, gelu_new)' : 'GELU');
    const hn = op(e ? 'enc-norm2' : 'dec-norm3', normOf(c, o.x), 'norm', { out: e ? 'e-h2' : 'd-h3', label: normName(c) + ' antes de la FFN', type: 'norm', group: 'norm',
      outMeta: { label: 'entrada normalizada', tex: '\\mathrm{Norm}(x)' } });
    let f;
    if (c.gated) {
      const gt = op(p + 'gate', A.linear(hn, { dout: c.Dmlp, doutSym: 'D_mlp', bias: c.mlpBias }), 'gate', { out: t + 'gate', label: 'wi_0: rama gate (D → D_mlp)', outMeta: { label: 'rama gate', tex: 'xW_0' } });
      const ac = op(p + 'act', actF(gt), 'act', { out: t + 'g', label: actL + ' sobre la rama gate', outMeta: { label: 'compuerta', tex: '\\mathrm{GELU}(xW_0)' } });
      const up = op(p + 'fc1', A.linear(hn, { dout: c.Dmlp, doutSym: 'D_mlp', bias: c.mlpBias }), 'fc1', { out: t + 'u', label: 'wi_1: rama lineal (D → D_mlp)', outMeta: { label: 'rama lineal', tex: 'xW_1' } });
      const pr = op(p + 'mul', A.mul(ac, up), 'mul', { out: t + 'prod', label: 'Producto GELU(xW_0) ⊙ xW_1 (GEGLU)', outMeta: { label: 'compuerta ⊙ lineal', tex: '\\mathrm{GELU}(xW_0)\\odot xW_1' } });
      f = op(p + 'fc2', A.linear(pr, { dout: c.D, doutSym: 'D', bias: c.mlpBias }), 'fc2', { out: t + 'f', label: 'wo (D_mlp → D)', outMeta: { label: 'salida de la FFN', tex: 'F' } });
    } else {
      const u = op(p + 'fc1', A.linear(hn, { dout: c.Dmlp, doutSym: 'D_mlp', bias: c.mlpBias }), 'fc1', { out: t + 'u', label: (c.kind === 't5' ? 'wi' : 'fc1') + ' (D → D_mlp)', outMeta: { label: 'capa oculta', tex: 'xW_1' } });
      const ac = op(p + 'act', actF(u), 'act', { out: t + 'g', label: actL, outMeta: { label: 'activación', tex: '\\mathrm{' + (c.act === 'relu' ? 'ReLU' : 'GELU') + '}(xW_1)' } });
      f = op(p + 'fc2', A.linear(ac, { dout: c.D, doutSym: 'D', bias: c.mlpBias }), 'fc2', { out: t + 'f', label: (c.kind === 't5' ? 'wo' : 'fc2') + ' (D_mlp → D)', outMeta: { label: 'salida de la FFN', tex: 'F' } });
    }
    return g.op(e ? 'enc-res2' : 'dec-res3', A.residual_add(o.x, f), { path: P.concat(['res']), repeat: o.rep, where: o.W, out: t + 'x-out', label: 'Residual', type: 'tensorop', group: 'resid',
      outMeta: { label: (e ? 'Salida de cada capa del encoder' : 'Salida de cada capa del decoder') + ' (x_ℓ; tras las ' + (e ? 'L' : 'L_d') + ' capas, x_' + (e ? 'L' : 'L_d') + ')', tex: e ? 'x_L' : 'y_{L_d}', perLayer: false,
        note: 'Salida de cada capa; tras la última es la del stack.' } });
  }

  // ------------------------------------------------------------------ parámetros analíticos (para las ops idle de decode)
  function layerParams(c, kind) {
    const D = c.D, I = c.inner, nb = c.norm === 'layernorm' ? 2 * D : D;
    const attn = 4 * D * I + (c.qBias ? I : 0) + (c.kBias ? I : 0) + (c.vBias ? I : 0) + (c.oBias ? D : 0) + nb;
    const ffn = (c.gated ? 3 : 2) * D * c.Dmlp + (c.mlpBias ? c.Dmlp + D : 0) + nb;
    return kind === 'enc' ? attn + ffn : 2 * attn + ffn;
  }
  const crossKvWeightParams = (c) => 2 * c.D * c.inner + (c.kBias ? c.inner : 0) + (c.vBias ? c.inner : 0);
  const finalNormParams = (c) => (c.norm === 'layernorm' ? 2 * c.D : c.D);
  const frontendParams = (c) => (c.kind === 'whisper' ? 3 * c.nMels * c.D + c.D + 3 * c.D * c.D + c.D : 0);

  // ------------------------------------------------------------------ grafo
  function build(c, A) {
    const g = A.graph(c);
    const dec = c.decode === 1, t5 = c.kind === 't5';
    const WE = ['Encoder (×' + c.L + ')'], WD = ['Decoder (×' + c.Ld + ')'];
    let mem = null;
    if (!dec) {
      let x0;
      if (t5) {
        const ids = g.input('ids', shp(['T_in'], [c.Tin], 'txt', 'vec'), { label: 'Entrada · ids de los T_in tokens (SentencePiece; p. ej. «translate English to German: …»)', tex: 'x_{1..T_{\\mathrm{in}}}' });
        x0 = g.op('enc-embed', A.embedding_lookup(ids, { V: c.V, D: c.D }), { path: ['embed'], out: 'e-x0', where: ['Embedding compartido'], label: 'Embedding compartido (V×D: ' + fint(c.V) + ' × ' + c.D + '; sin posición absoluta)', type: 'embed', group: 'embed',
          outMeta: { label: 'Embeddings de la entrada (sin posición: T5 la pone como sesgo relativo en la atención)', tex: 'e_0' } });
      } else {
        const au = g.input('audio', shp(['S'], [c.samples], 'aud', 'vec'), { label: 'Audio · ' + c.seconds + ' s a 16 kHz (S = ' + fint(c.samples) + ' muestras)', tex: 'a' });
        const a30 = g.op('pad-audio', A.pad_or_trim(au, { to: c.chunk * c.sr, sym: String(c.chunk * c.sr) }), { path: ['audio'], out: 'audio-30s', where: ['Audio'], label: 'Rellenar con ceros (o cortar) a 30 s', type: 'tensorop', group: 'embed',
          outMeta: { label: 'Audio de 30 s (480,000 muestras; relleno con ceros)', tex: 'a_{30\\,\\mathrm{s}}' } });
        const mel = g.op('log-mel', A.log_mel(a30, { nMels: c.nMels, nFft: c.nFft, hop: c.hop, sr: c.sr, framesSym: '3000', melSym: 'n_mels' }), { path: ['mel'], out: 'mel', where: ['Espectrograma log-Mel'],
          label: 'Espectrograma log-Mel (' + c.nMels + ' bandas; ventana 25 ms, hop 10 ms → 100 frames/s)', type: 'tensorop', group: 'embed', outMeta: { label: 'Espectrograma log-Mel (3,000 frames × ' + c.nMels + ' bandas)', tex: 'M' } });
        const WC = ['Front end convolucional'];
        const cop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: ['conv', node], where: WC }, extra));
        const c1 = cop('conv1', A.conv1d(mel, { k: 3, p: 1, cout: c.D, coutSym: 'D', outSym: '3000' }), 'conv1', { out: 'conv1-out', label: 'Conv1d k = 3 (n_mels → D)', type: 'embed', group: 'embed',
          outMeta: { label: 'conv 1 (3,000 × D)', tex: '\\mathrm{Conv}_1(M)' } });
        const g1 = cop('conv1-gelu', A.gelu(c1), 'gelu1', { out: 'conv1-act', label: 'GELU', type: 'act', group: 'embed', outMeta: { label: 'conv 1 + GELU', tex: '\\mathrm{GELU}(\\cdot)' } });
        const c2 = cop('conv2', A.conv1d(g1, { k: 3, s: 2, p: 1, cout: c.D, coutSym: 'D', outSym: '1500' }), 'conv2', { out: 'conv2-out', label: 'Conv1d k = 3, stride 2 (3,000 → 1,500 posiciones)', type: 'embed', group: 'embed',
          outMeta: { label: 'conv 2 (1,500 × D: una posición cada 20 ms)', tex: '\\mathrm{Conv}_2(\\cdot)' } });
        const g2 = cop('conv2-gelu', A.gelu(c2), 'gelu2', { out: 'conv2-act', label: 'GELU', type: 'act', group: 'embed', outMeta: { label: 'conv 2 + GELU', tex: '\\mathrm{GELU}(\\cdot)' } });
        const pe = cop('enc-pos', A.sine_pos_1d({ rows: c.encPos, rowsSym: '1500', D: c.D, mod: 'aud' }), 'pos', { out: 'e-pos', label: 'Posición sinusoidal fija (buffer, no se entrena)', type: 'embed', group: 'embed',
          outMeta: { label: 'Posiciones sinusoidales del encoder (1,500 × D)', tex: 'P_{\\sin}' } });
        x0 = cop('enc-add-pos', A.add(g2, pe), 'pos', { out: 'e-x0', label: 'Sumar la posición', type: 'tensorop', group: 'embed',
          outMeta: { label: 'Entrada de la capa 1 del encoder (1,500 × D)', tex: 'x_0' } });
      }
      const xa = attnBlock(g, c, { kind: 'enc', x: x0, rep: c.L, W: WE });
      const xe = ffnBlock(g, c, { kind: 'enc', x: xa, rep: c.L, W: WE });
      mem = g.op('enc-final-norm', normOf(c, xe), { path: ['enc-out'], out: 'enc-out', where: ['Salida del encoder'], label: normName(c) + ' final del encoder', type: 'norm', group: 'norm',
        outMeta: { label: 'Salida del encoder: un vector por posición de la entrada (K y V de la cross-attention salen de aquí)', tex: 'H' } });
    } else {
      // decode: el encoder ya corrió (una vez por entrada). Sus pesos cuentan en el modelo, sin tensores ni MACs en este paso.
      if (!t5) g.op('frontend-idle', A.idle_params({ params: frontendParams(c), paramTex: '\\text{convs del front end}', what: 'el front end (corrió una vez por audio)' }), { path: ['conv'], out: [], in: [], label: 'Front end convolucional (no corre en este paso)', type: 'embed', group: 'embed' });
      g.op('encoder-idle', A.idle_params({ params: c.L * layerParams(c, 'enc') + (t5 ? c.buckets * c.h : 0), paramTex: '\\text{las } L \\text{ capas del encoder}', what: 'el encoder (corrió una vez por entrada)' }), {
        path: ['encoder'], out: [], in: [], label: 'Encoder (no corre en este paso: su salida ya está en la cross KV cache)', type: 'attn', group: 'attn' });
      g.op('enc-out-idle', A.idle_params({ params: finalNormParams(c), paramTex: '\\text{norma final}', what: 'la norma final del encoder' }), { path: ['enc-out'], out: [], in: [], label: 'Norma final del encoder (no corre en este paso)', type: 'norm', group: 'norm' });
    }

    // Entrada del decoder
    const Ts = dec ? '1' : 'T_out', Tn = c.Tq;
    const dids = g.input('dec-ids', shp([Ts], [Tn], 'txt', 'vec'), {
      label: dec ? 'Decoder · el último token generado (entrada del paso)' : (t5 ? 'Decoder · ids del objetivo desplazados (<pad> + y_{<t}: teacher forcing)' : 'Decoder · tokens del prompt (<|startoftranscript|>, idioma, tarea, …) + texto'),
      tex: dec ? 'y_{t-1}' : 'y_{<t}' });
    let d0;
    if (t5) {
      d0 = g.op('dec-embed', A.embedding_lookup(dids, { V: c.V, D: c.D }), Object.assign({ path: ['embed'], out: 'd-x0', where: ['Embedding compartido'], label: 'Embedding compartido (la misma tabla que el encoder' + (c.tied ? ' y el LM head' : '') + ')', type: 'embed', group: 'embed',
        outMeta: { label: 'Embeddings del decoder', tex: 'd_0' } }, dec ? {} : { paramRepeat: 0 }));
    } else {
      const WP = ['Tokens del prompt'];
      const tok = g.op('dec-embed', A.embedding_lookup(dids, { V: c.V, D: c.D }), { path: ['prompt-tokens', 'tok-embed'], out: 'd-tok', where: WP, label: 'Embedding de tokens (V×D: ' + fint(c.V) + ' × ' + c.D + '; atado al LM head)', type: 'embed', group: 'embed',
        outMeta: { label: 'Embeddings de los tokens del decoder', tex: 'E[y]' } });
      const pids = g.input('dec-pos-ids', shp([Ts], [Tn], 'txt', 'vec'), { label: dec ? 'Decoder · posición del token nuevo (T_out − 1)' : 'Decoder · posiciones 0 … T_out − 1', tex: '\\mathrm{pos}' });
      const pos = g.op('dec-pos', A.embedding_lookup(pids, { V: c.Tmax, Vsym: String(c.Tmax), D: c.D }), { path: ['prompt-tokens', 'pos-embed'], out: 'd-pos', where: WP, label: 'Posición aprendida (tabla ' + c.Tmax + ' × D)', type: 'embed', group: 'embed',
        outMeta: { label: 'Posiciones aprendidas del decoder', tex: 'P[t]' } });
      d0 = g.op('dec-add-pos', A.add(tok, pos), { path: ['prompt-tokens', 'add'], out: 'd-x0', where: WP, label: 'Sumar la posición', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Entrada de la capa 1 del decoder', tex: 'y_0' } });
    }
    const r1 = attnBlock(g, c, { kind: 'self', x: d0, rep: c.Ld, W: WD });
    if (dec) {
      g.op('cross-kv-idle', A.idle_params({ params: crossKvWeightParams(c), paramTex: '2D\\cdot D' + (c.vBias ? ' + D' : ''), what: 'W_K y W_V de la cross-attention (se usaron una vez, sobre enc-out)' }), {
        path: ['decoder', 'cross-attn', 'kv-proj'], out: [], in: [], repeat: c.Ld, where: WD, label: 'W_K y W_V de la cross-attention (no corren en este paso: sus K, V están en la caché)', type: 'embed', group: 'attn' });
    }
    const r2 = attnBlock(g, c, { kind: 'cross', x: r1, mem, rep: c.Ld, W: WD });
    const y = ffnBlock(g, c, { kind: 'dec', x: r2, rep: c.Ld, W: WD });
    let yo = g.op('dec-final-norm', normOf(c, y), { path: ['dec-norm'], out: 'dec-out', where: ['Salida del decoder'], label: normName(c) + ' final del decoder', type: 'norm', group: 'norm',
      outMeta: { label: 'Salida normalizada del decoder', tex: '\\mathrm{Norm}(y_{L_d})' } });
    if (c.rescale) {
      yo = g.op('lm-rescale', A.scale(yo), { path: ['lm-head'], out: 'dec-out-scaled', where: ['LM head'], label: 'Reescalar por D^−0.5 (embeddings atados)', type: 'head', group: 'head',
        outMeta: { label: 'Salida reescalada (× D^−0.5)', tex: 'y\\,D^{-1/2}' } });
    }
    const lg = g.op('lm-head', A.lm_head(yo, { V: c.V, tied: c.tied }), { path: ['lm-head'], out: 'logits', where: ['LM head'], label: 'LM head (D → V' + (c.tied ? ', atado al embedding' : ', propio') + ')', type: 'head', group: 'head',
      outMeta: { label: dec ? 'Logits del token nuevo sobre el vocabulario' : 'Logits de cada posición del decoder', tex: 'z' } });
    g.op('sample', A.sample_token(lg, {}), { path: [t5 ? 'output' : 'text'], out: 'next-token', where: ['Salida'], label: 'Elegir el siguiente token (greedy / beam search)', type: 'head', group: 'head',
      outMeta: { label: 'Siguiente token (id elegido)', tex: 'y_t' } });
    return g;
  }

  // ------------------------------------------------------------------ cantidades y modelo de costo
  const isScore = (o) => o.prim === 'attention_scores' || o.prim === 'attention_weighted_sum';
  const ENC_NODES = { audio: 1, mel: 1, conv: 1, encoder: 1, 'enc-out': 1 };
  const isEncOp = (o) => !!ENC_NODES[o.path[0]] || o.id === 'enc-embed';
  const node = (r, id) => r.totals.byNode[id] || { params: 0, macs: 0, other: 0 };

  // Costo de generación a partir del grafo de PREFILL (T_q = T_out filas). Lineales del decoder por token = sus MACs / T_out
  // (las lineales escalan exacto con las filas), sin K/V de la cross (crossKvMacs, una vez) ni scores.
  function cost(c, pre) {
    const L = c.Ld, hd = c.h * c.dh;
    const sum = (f) => pre.ops.filter(f).reduce((s, o) => s + o.macs * o.repeat, 0);
    const encoderMacs = sum(isEncOp);
    const crossKvMacs = 2 * L * c.Tin * c.D * c.inner;
    const decLinear = sum((o) => !isEncOp(o) && !isScore(o) && o.id !== 'cross-k' && o.id !== 'cross-v') / c.Tout;
    const lmHead = c.D * c.V;
    const step = (t) => decLinear + 2 * L * hd * (t + c.Tin);
    const genDec = (T) => T * decLinear + 2 * L * hd * (T * (T + 1) / 2 + T * c.Tin);
    const selfLinear = L * (4 * c.D * c.inner);
    const crossLinear = L * (2 * c.D * c.inner);
    const ffnLinear = L * (c.gated ? 3 : 2) * c.D * c.Dmlp;
    return { encoderMacs, crossKvMacs, decLinear, lmHead, step, genDec, selfLinear, crossLinear, ffnLinear, hd };
  }

  function quantities(c, r) {
    const pre = c.decode === 1 ? A.run(c.decodeOf || r.id, prefillOverrides(r)) : r;
    const k = cost(c, pre), t = pre.totals;
    const P = (id) => node(pre, id).params;
    const encoderParams = P('conv') + P('encoder') + P('enc-out');
    const decoderParams = P('prompt-tokens') - (c.kind === 'whisper' ? c.V * c.D : 0) + P('decoder') + P('dec-norm');
    const sharedEmbedParams = c.kind === 't5' ? P('embed') : c.V * c.D;
    const q = {
      tokens: c.Tin, Tin: c.Tin, Tout: c.Tout, B: c.B, D: c.D, L: c.L, Ld: c.Ld, h: c.h, dh: c.dh, Dmlp: c.Dmlp, V: c.V, inner: c.inner,
      totalParams: t.params, sharedEmbedParams, encoderParams, decoderParams, lmHeadParams: P('lm-head'),
      crossAttnParams: P('cross-attn'), decoderSelfAttnParams: P('self-attn'), decoderFfnParams: P('ffn'),
      encoderLayerParams: P('encoder') / c.L - (c.kind === 't5' ? c.buckets * c.h / c.L : 0), decoderLayerParams: (P('decoder') - (c.kind === 't5' ? c.buckets * c.h : 0)) / c.Ld,
      crossAttnParamsLayer: P('cross-attn') / c.Ld,
      encoderMacs: k.encoderMacs, crossKvMacs: k.crossKvMacs, decoderMacsPerToken: k.step(c.Tout), decoderMacsPerTokenFirst: k.step(1),
      decoderLayerMacsPerToken: k.step(c.Tout) - k.lmHead, lmHeadMacsPerToken: k.lmHead,
      generationDecoderMacs: k.genDec(c.Tout), totalGenerationMacs: c.B * (k.encoderMacs + k.crossKvMacs + k.genDec(c.Tout)),
      teacherForcedMacs: t.macs,
      crossKvBytes: 2 * c.Ld * c.Tin * c.inner * 2 * c.B, selfKvCacheBytes: 2 * c.Ld * c.Tout * c.inner * 2 * c.B,
    };
    q.encoderShare = k.encoderMacs / (k.encoderMacs + k.crossKvMacs + k.genDec(c.Tout));
    if (c.kind === 't5') {
      const sc = spanCorruption(512);
      Object.assign(q, { relBiasParams: 2 * c.buckets * c.h, buckets: c.buckets, maxDistance: c.maxDistance,
        spanRawTokens: sc.tokens, spanInputTokens: sc.inputs, spanTargetTokens: sc.targets, spanNoiseTokens: sc.noise, spanNoiseSpans: sc.spans, spanNonNoiseTokens: sc.nonNoise });
    } else {
      Object.assign(q, { nMels: c.nMels, seconds: c.seconds, melFrames: c.melFrames, encoderPositions: c.encPos, usefulPositions: Math.min(c.encPos, Math.ceil(c.seconds * c.encPos / c.chunk)),
        frontendParams: P('conv'), decoderPosParams: c.Tmax * c.D, paramsHF: t.params + c.encPos * c.D, convMacs: node(pre, 'conv').macs, promptTokens: c.promptTokens });
    }
    return q;
  }
  // Overrides de arquitectura de una corrida, sin `decode` (prefill y decode con los mismos knobs).
  function prefillOverrides(r) {
    const o = {};
    ['Tin', 'Tout', 'seconds', 'B'].forEach((k) => { if (r.overrides[k] !== undefined) o[k] = r.overrides[k]; });
    return o;
  }

  // ------------------------------------------------------------------ métricas
  function metrics(c, r, o) {
    const ov = o.overrides || {};
    const B = o.B, by = o.by;
    const bw = ov.bandwidth !== undefined ? ov.bandwidth : H100.bandwidth;
    const peak = ov.peakFlops !== undefined ? ov.peakFlops : H100.peakFlops;
    [['bandwidth', bw], ['peakFlops', peak]].forEach(([kk, v]) => { if (!(typeof v === 'number' && v > 0 && isFinite(v))) throw new Error(kk + ' debe ser un número positivo.'); });
    const arch = prefillOverrides(r);
    const pre = c.decode === 1 ? A.run(c.decodeOf || r.id, arch) : r;
    const q = pre.quantities, k = cost(c, pre), t = pre.totals;
    const L = c.Ld, Tin = c.Tin, Tout = c.Tout;
    const params = t.params;
    // KV (a los bytes del dtype; por defecto bf16)
    const kvPerTokLayer = 2 * c.inner * by;                       // K y V de una posición en una capa
    const crossKvBytes = L * Tin * kvPerTokLayer * B;
    const selfKvBytesPerToken = L * kvPerTokLayer;
    const selfKvCacheBytes = selfKvBytesPerToken * Tout * B;
    // Pesos que lee un paso de decode: el decoder sin W_K / W_V de la cross (ni la tabla de posiciones: una fila) + LM head.
    const decStepParams = node(pre, 'decoder').params - L * crossKvWeightParams(c) + node(pre, 'dec-norm').params + c.V * c.D;
    const roof = (flops, bytes) => 1000 * Math.max(flops / peak, bytes / bw);
    const encoderMs = roof(2 * B * k.encoderMacs, q.encoderParams * by);
    const crossKvMs = roof(2 * B * k.crossKvMacs, L * crossKvWeightParams(c) * by + crossKvBytes);
    let decoderMs = 0;
    for (let s = 1; s <= Tout; s++) decoderMs += roof(2 * B * k.step(s), decStepParams * by + crossKvBytes + selfKvBytesPerToken * s * B);
    const stepBytesLast = decStepParams * by + crossKvBytes + selfKvBytesPerToken * Tout * B;
    const genDec = k.genDec(Tout);
    const totalOnce = k.encoderMacs + k.crossKvMacs + genDec;
    const out = {
      // parámetros
      totalParams: params, sharedEmbedParams: q.sharedEmbedParams, encoderParams: q.encoderParams, decoderParams: q.decoderParams, lmHeadParams: q.lmHeadParams,
      crossAttnParams: q.crossAttnParams, decoderSelfAttnParams: q.decoderSelfAttnParams, decoderFfnParams: q.decoderFfnParams,
      encoderLayerParams: q.encoderLayerParams, decoderLayerParams: q.decoderLayerParams,
      encoderParamsShare: q.encoderParams / params, decoderParamsShare: q.decoderParams / params, crossAttnParamsShare: q.crossAttnParams / params,
      sharedEmbedParamsShare: q.sharedEmbedParams / params,
      // cómputo (una entrada, B = 1 salvo totalGenerationMacs)
      encoderMacs: k.encoderMacs, encoderLayerMacs: node(pre, 'encoder').macs / c.L, crossKvMacs: k.crossKvMacs,
      decoderMacsPerToken: k.step(Tout), decoderMacsPerTokenFirst: k.step(1), decoderMacsPerTokenAvg: genDec / Tout,
      decoderLayerMacsPerToken: k.step(Tout) - k.lmHead, lmHeadMacsPerToken: k.lmHead,
      decoderSelfMacsPerToken: k.selfLinear + 2 * L * k.hd * Tout, decoderCrossMacsPerToken: k.crossLinear + 2 * L * k.hd * Tin, decoderFfnMacsPerToken: k.ffnLinear,
      generationDecoderMacs: genDec, totalGenerationMacs: B * totalOnce, teacherForcedMacs: t.macs,
      encoderShare: k.encoderMacs / totalOnce, crossKvShare: k.crossKvMacs / totalOnce, decoderShare: genDec / totalOnce,
      encoderVsToken: k.encoderMacs / k.step(Tout),
      // memoria
      crossKvBytes, crossKvBytesPerLayer: Tin * kvPerTokLayer * B, selfKvBytesPerToken, selfKvCacheBytes, kvTotalBytes: crossKvBytes + selfKvCacheBytes,
      weightBytes: params * by,
      // tiempos ≈ (roofline, sin overheads)
      encoderMs, crossKvMs, decoderMs, generationMs: encoderMs + crossKvMs + decoderMs, decoderStepMs: roof(2 * B * k.step(Tout), stepBytesLast),
      decoderStepBound: 2 * B * k.step(Tout) / peak > stepBytesLast / bw ? 'cómputo' : 'memoria',
      encoderBound: 2 * B * k.encoderMacs / peak > q.encoderParams * by / bw ? 'cómputo' : 'memoria',
      arithmeticIntensityDecode: 2 * B * k.step(Tout) / stepBytesLast, arithmeticIntensityEncoder: 2 * B * k.encoderMacs / (q.encoderParams * by),
      bandwidth: bw, peakFlops: peak, hardwareSource: H100.source, estimate: true,
      // largos
      Tin, Tout, generatedTokens: c.kind === 'whisper' ? Tout - c.promptTokens : Tout,
      units: UNITS,
    };
    if (c.kind === 't5') {
      Object.assign(out, { relBiasParams: q.relBiasParams, spanRawTokens: q.spanRawTokens, spanInputTokens: q.spanInputTokens, spanTargetTokens: q.spanTargetTokens,
        spanNoiseTokens: q.spanNoiseTokens, spanNoiseSpans: q.spanNoiseSpans, spanNonNoiseTokens: q.spanNonNoiseTokens, noiseDensity: 0.15, meanNoiseSpan: 3 });
    } else {
      const useful = q.usefulPositions;
      Object.assign(out, {
        frontendParams: q.frontendParams, decoderPosParams: q.decoderPosParams, paramsHF: q.paramsHF, convMacs: q.convMacs,
        encoderMacsPerWindow: k.encoderMacs, melFrames: c.melFrames, encoderPositions: c.encPos, usefulPositions: useful, seconds: c.seconds,
        paddingShare: 1 - useful / c.encPos, wastedEncoderMacs: k.encoderMacs * (1 - useful / c.encPos), promptTokens: c.promptTokens,
        realtimeFactor: (encoderMs + crossKvMs + decoderMs) / (1000 * c.seconds), speedVsRealtime: (1000 * c.seconds) / (encoderMs + crossKvMs + decoderMs),
      });
    }
    // Lista para la viz encdec-cost: costo de generar T_out tokens (encoder una vez + decoder por token).
    const touts = c.kind === 'whisper' ? [1, 16, 64, 128, 256, 448] : [1, 16, 64, 114, 256, 512];
    out.toutScaling = touts.map((T) => {
      const gd = k.genDec(T), tot = k.encoderMacs + k.crossKvMacs + gd;
      return { Tout: T, encoderMacs: k.encoderMacs, crossKvMacs: k.crossKvMacs, decoderMacs: gd, totalMacs: tot, encoderShare: k.encoderMacs / tot,
        decoderMacsPerToken: k.step(T), selfKvCacheBytes: selfKvBytesPerToken * T * B };
    });
    return out;
  }
  const UNITS = {
    totalParams: 'params', sharedEmbedParams: 'params', encoderParams: 'params', decoderParams: 'params', lmHeadParams: 'params', crossAttnParams: 'params',
    decoderSelfAttnParams: 'params', decoderFfnParams: 'params', encoderLayerParams: 'params', decoderLayerParams: 'params', relBiasParams: 'params',
    frontendParams: 'params', decoderPosParams: 'params', paramsHF: 'params',
    encoderParamsShare: 'pct', decoderParamsShare: 'pct', crossAttnParamsShare: 'pct', sharedEmbedParamsShare: 'pct',
    encoderMacs: 'macs', encoderLayerMacs: 'macs', crossKvMacs: 'macs', decoderMacsPerToken: 'macs', decoderMacsPerTokenFirst: 'macs', decoderMacsPerTokenAvg: 'macs',
    decoderLayerMacsPerToken: 'macs', lmHeadMacsPerToken: 'macs', decoderSelfMacsPerToken: 'macs', decoderCrossMacsPerToken: 'macs', decoderFfnMacsPerToken: 'macs',
    generationDecoderMacs: 'macs', totalGenerationMacs: 'macs', teacherForcedMacs: 'macs', convMacs: 'macs', encoderMacsPerWindow: 'macs', wastedEncoderMacs: 'macs',
    encoderShare: 'pct', crossKvShare: 'pct', decoderShare: 'pct', paddingShare: 'pct', encoderVsToken: 'ratio',
    crossKvBytes: 'bytes', crossKvBytesPerLayer: 'bytes', selfKvBytesPerToken: 'bytes', selfKvCacheBytes: 'bytes', kvTotalBytes: 'bytes', weightBytes: 'bytes',
    encoderMs: 'ms', crossKvMs: 'ms', decoderMs: 'ms', generationMs: 'ms', decoderStepMs: 'ms',
    arithmeticIntensityDecode: 'ratio', arithmeticIntensityEncoder: 'ratio', realtimeFactor: 'ratio', speedVsRealtime: 'ratio',
    bandwidth: 'count', peakFlops: 'count', Tin: 'count', Tout: 'count', generatedTokens: 'count', melFrames: 'count', encoderPositions: 'count',
    usefulPositions: 'count', seconds: 'count', promptTokens: 'count', spanRawTokens: 'count', spanInputTokens: 'count', spanTargetTokens: 'count',
    spanNoiseTokens: 'count', spanNoiseSpans: 'count', spanNonNoiseTokens: 'count', noiseDensity: 'pct', meanNoiseSpan: 'count',
  };

  A.defineModel({
    id: 't5',
    label: 'T5 (encoder-decoder texto a texto)',
    paper: { title: 'Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer', authors: 'Raffel, Shazeer, Roberts, Lee, Narang, Matena, Zhou, Li y Liu',
      venue: 'JMLR 21(140), 2020', year: 2020, arxiv: '1910.10683',
      note: 'Flan-T5: Chung et al. 2022, Scaling Instruction-Finetuned Language Models, arXiv:2210.11416. Posición relativa por buckets: Shaw et al. 2018 (arXiv:1803.02155) simplificada a un escalar por bucket y cabeza (§2.1 de T5).' },
    configs: pick(T5_IDS),
    knobs: { Tin: [64, 128, 512, 1024, 2048], Tout: [16, 64, 114, 256, 512], B: [1, 8, 32, 128], decode: [1] },
    hardware: Object.assign({}, H100),
    applyKnobs, resolve, build, quantities, metrics,
  });
  A.defineModel({
    id: 'whisper',
    label: 'Whisper (encoder-decoder de audio a texto)',
    paper: { title: 'Robust Speech Recognition via Large-Scale Weak Supervision', authors: 'Radford, Kim, Xu, Brockman, McLeavey y Sutskever', venue: 'ICML 2023', year: 2023, arxiv: '2212.04356',
      note: 'Distil-Whisper: Gandhi, von Platen y Rush 2023, arXiv:2311.00430. large-v3: model card de OpenAI (nov. 2023), 128 bandas mel.' },
    configs: pick(WH_IDS),
    knobs: { Tout: [16, 64, 128, 256, 448], B: [1, 8, 32], seconds: [5, 10, 20, 30], decode: [1] },
    hardware: Object.assign({}, H100),
    applyKnobs, resolve, build, quantities, metrics,
  });
  // Utilidades para vizs y pruebas (sin estado).
  A.encdec = { spanCorruption, spanLengths, relativeBucket: A.t5RelativeBucket };
})(typeof window !== 'undefined' ? window : globalThis);
