/* =============================================================================
   Atlas de Arquitecturas — js/arch/llm.js
   Modelo `llm` (páginas `llm-decoder` y `llm-inferencia`; contrato SPEC §18): decoders tipo Llama.
   - llama3-8b (canónica) y llama3-70b: Llama Team, AI @ Meta (Dubey / Grattafiori et al.), The Llama 3 Herd of Models, arXiv:2407.21783 (2024), Tabla 3;
     dimensiones = config.json de meta-llama/Meta-Llama-3-{8B,70B} en HF.
   - llama2-7b: Touvron et al., Llama 2: Open Foundation and Fine-Tuned Chat Models, arXiv:2307.09288 (2023) (MHA: el 7B
     no usa GQA; solo 34B/70B); config.json de meta-llama/Llama-2-7b-hf.
   - mixtral-8x7b: Jiang et al., Mixtral of Experts, arXiv:2401.04088 (2024), Tabla 1; config.json de
     mistralai/Mixtral-8x7B-v0.1.
   Cross-check: crosscheck/llm.py (HF LlamaForCausalLM / MixtralForCausalLM construidos en código en el dispositivo
   META: parámetros exactos sin pesos en memoria; FLOPs con FlopCounterMode sobre tensores meta con TODAS las capas,
   sin extrapolar). Parámetros y FLOPs exactos en las 4 configs (diferencia 0) y en las variantes decode / nKV / T.

   Convenciones. Formas sin batch: T = tokens del prompt (prefill), D = ancho del modelo, h = cabezas de query,
   G = cabezas KV (los "grupos" de GQA, notación de Ainslie et al. 2023; knob nKV; G = h es MHA, G = 1 es MQA),
   d_h = D/h, D_mlp = ancho oculto de la FFN SwiGLU, V = vocabulario, L = capas, E = expertos, k = expertos por token
   (cfg.topk), ctx = largo de la KV cache que lee un paso de decode (incluye el token nuevo). Sin sesgos en ningún Linear;
   RMSNorm solo con γ (D parámetros); embedding y LM head NO atados (2·V·D parámetros).

   MACs (FLOPs = 2·MACs, = FlopCounterMode):
   - QKᵀ y A·V con la máscara causal cuentan las T² entradas (h·T·T·d_h cada una), como la atención eager de HF y como
     FlopCounterMode cuenta sdpa: la máscara NO divide entre 2 el conteo. El trabajo útil (triángulo inferior con la
     diagonal) es h·d_h·T(T+1)/2 por producto: metrics().prefillScoreMacsCausal (lo que hace FlashAttention con causal=True).
   - LM head sobre las T filas (logits T×V, como el forward de HF sin logits_to_keep); al servir solo hace falta la
     última: metrics().prefillMacsLastLogits.
   - MoE (Mixtral): router (T·D·E) + SOLO los k expertos de cada token (3·k·T·D·D_mlp). FlopCounterMode ve exactamente
     eso: con la implementación eager de HF (bucle por experto sobre los tokens enrutados) y con 'batched_mm' (bmm sobre
     las k·T filas) el conteo es idéntico (verificado en un Mixtral diminuto con pesos reales, ver el JSON); 'grouped_mm'
     NO lo cuenta (aten._grouped_mm no está registrado). El combine ponderado y el top-k son elementwise ("otros").
   - RoPE, RMSNorm, SiLU, ⊙, softmax, máscara, residuales: "otros" (≈).

   Grafo. Por defecto: PREFILL de T tokens (T = 2048). Knob decode = 1: UN paso de decode (1 token nuevo, la atención lee
   ctx filas de K/V: ctx − 1 de la caché + la nueva). Ids iguales en los dos; decode añade k-past, v-past (entradas de la
   caché), kv-append-k / kv-append-v y k-ctx / v-ctx, y no tiene op `mask` (1 query ve todo el contexto).
   Knobs: T (tokens del prompt), ctx (contexto del decode y de la KV cache), B (batch: solo metrics), bits (16 | 8 | 4,
   y 32: pesos Y KV cache), nKV (what-if MHA / GQA / MQA: cambia G y los parámetros de W_K, W_V), decode (1).
   metrics() acepta además bandwidth (B/s, por defecto 3.35e12 = H100 SXM), peakFlops (FLOP/s, por defecto 989e12 =
   H100 SXM bf16 denso) y hbmBytes (por defecto 80e9 = H100 80 GB): ENTRADAS de hardware, no parte del modelo.

   ---------------------------------------------------------------- nodos (path) y ops
   Vista `llm-decoder-overview`: tokens (glifo del tensor ids), embed, blocks (grupo ×L) › block, final-norm, lm-head,
   logits (glifo), sample.
     op embed        path embed                         ids → x0                          (embedding_lookup, tabla V×D)
     Bloque (repeat L, path blocks › block › …):
       norm1         norm1                              x0 → h-norm1                      (rmsnorm)
       q-proj        attn › q-proj                      h-norm1 → q        (T×D)
       k-proj        attn › k-proj                      h-norm1 → k        (T×G·d_h)
       v-proj        attn › v-proj                      h-norm1 → v        (T×G·d_h)
       split         attn › split                       q, k, v → q-heads (h×T×d_h), k-heads, v-heads (G×T×d_h)
       rope-q        attn › rope                        q-heads → q-rope   (h×T×d_h)
       rope-k        attn › rope                        k-heads → k-rope   (G×T×d_h)      = lo que se escribe en la KV cache
       [decode] kv-append-k / kv-append-v  attn › kv-cache   k-past, k-rope → k-ctx; v-past, v-heads → v-ctx (G×ctx×d_h)
       scores        attn › scores                      q-rope, k-rope|k-ctx → scores (h×T×T; decode h×1×ctx)
       scale         attn › scale                       scores → scores-scaled
       mask          attn › mask                        scores-scaled → masked            (solo prefill)
       softmax       attn › softmax                     masked|scores-scaled → attn
       weighted-sum  attn › weighted-sum                attn, v-heads|v-ctx → z-heads (h×T×d_h)
       merge         attn › merge                       z-heads → z (T×D)
       o-proj        attn › o-proj                      z → o
       res1          res1                               x, o → r1
       norm2         norm2                              r1 → h-norm2
       FFN densa (path ffn › …): gate-proj (gate T×D_mlp) · up-proj (up) · silu (act = SiLU(gate)) · mul (prod = act ⊙ up)
         · down-proj (f T×D)
       FFN MoE (Mixtral, path ffn › router | topk | experts › … | combine): router (router-logits T×E) · topk (topk-weights,
         topk-ids T×k) · dispatch (ffn › experts › dispatch: x-routed kT×D) · gate-proj · up-proj · silu · mul (gate, up,
         act, prod: kT×D_mlp) · down-proj (expert-out kT×D) · combine (f T×D)
       res2          res2                               r1, f → x-out
     final-norm      final-norm                         x-out → x-norm
     lm-head         lm-head                            x-norm → logits (T×V; decode 1×V)
     sample          sample                             logits → next-token (1)
   Diagramas: `llm-block` usa norm1, attn, res1, norm2, ffn, res2; `llm-gqa` usa q-proj k-proj v-proj rope split scores
   mask scale softmax weighted-sum merge o-proj; `llm-swiglu` usa gate-proj up-proj silu mul down-proj; `moe-block` usa
   router, topk, experts, combine (Mixtral).

   Desviaciones respecto de SPEC §18 (añadidos; nada renombrado):
   - Orden de HF: split ANTES de rope (q_proj → view/transpose → RoPE). q-rope y k-rope son por cabeza (h×T×d_h y
     G×T×d_h) y entran directo a scores; tensores añadidos q-heads, k-heads, v-heads (salidas de split), scores-scaled
     (salida de scale) y masked (salida de mask; HF: escala y luego máscara). En el nodo `rope` hay dos ops (rope-q,
     rope-k).
   - Tensores añadidos next-token (salida de sample), y en Mixtral router-logits, topk-weights, topk-ids, x-routed,
     expert-out; en decode k-past, v-past, k-ctx, v-ctx. Nodos añadidos attn › kv-cache (decode) y ffn › experts ›
     dispatch (Mixtral).
   - En Mixtral gate, up, act y prod son kT×D_mlp (las filas enrutadas: cada token aparece k = 2 veces).
   - El símbolo de las cabezas KV es G (no n_kv); el knob se llama nKV como en la SPEC (cfg.nKV = cfg.G).

   ---------------------------------------------------------------- metrics() (B = 1, bits = 16 por defecto)
   Unidades en metrics.units (bytes | macs | params | pct | ratio | count). Bytes = decimales (fmt.bytes).
   - KV cache: kvBytesPerToken (2·L·G·d_h·bits/8, una secuencia), kvBytesPerTokenLayer, kvCacheBytes (× ctx × B; = kvCache),
     kvCacheBytesMHA / kvCacheBytesMQA (mismo ctx, B y bits con G = h / G = 1), kvBytesPerTokenMHA, kvSavingVsMHA (h/G),
     kvCacheVsWeights.
   - Pesos: weightBytes (params·bits/8), weightBytes16 / weightBytes8 / weightBytes4, activeWeightBytes.
   - Parámetros: totalParams (= params), activeParams (MoE: todo menos los E − k expertos que no usa un token),
     activeParamsShare, embedParams, lmHeadParams, attnParams, ffnParams, normParams, layerParams, attnParamsLayer,
     ffnParamsLayer y sus …Share (fracción de params); MoE: routerParams, expertParams (un experto de una capa),
     expertsParamsShare.
   - Cómputo: prefillMacs (T tokens), prefillMacsPerToken, prefillMacsLastLogits, prefillScoreMacs (contado),
     prefillScoreMacsCausal (útil), prefillScoreMacsShare, decodeMacsPerToken (un token con ctx), decodeScoreMacs,
     decodeLinearMacs, decodeScoreMacsShare, decodeFlopsPerParam (2·decodeMacs/activeParams ≈ 2: "2 FLOPs por parámetro").
   - Bytes movidos (definición): prefillBytes = pesos leídos UNA vez (todos menos la tabla de embedding; MoE: los
     expertos tocados ≈ todos) + filas de embedding leídas (B·T·D) + KV cache escrita (B·T·kvBytesPerToken).
     decodeBytesPerStep = pesos leídos una vez por paso (todos menos la tabla de embedding; MoE: router + atención + los
     expertos distintos que toca el lote, ≈ E·(1 − ((E−k)/E)^B) por capa con enrutamiento uniforme) + B filas de embedding
     + KV cache leída (B·ctx·kvBytesPerToken). Se ignoran activaciones y la escritura de la fila nueva (< 0.1 %).
     decodeWeightBytesRead, decodeKvBytesRead, decodeExpertsReadPerLayer (count).
   - Intensidad aritmética (FLOPs por byte movido, units 'ratio'): arithmeticIntensityPrefill = 2·B·prefillMacs /
     prefillBytes; arithmeticIntensityDecode = 2·B·decodeMacsPerToken / decodeBytesPerStep. ridgePoint = peakFlops /
     bandwidth (≈ 295 FLOP/B en H100 SXM): por debajo, la fase está limitada por memoria.
   - Cotas (≈ ESTIMACIONES de roofline, sin overheads de kernels, comunicación ni scheduling; hardware = entradas):
     decodeTokPerSecUpperBound = B / máx(FLOPs/peakFlops, bytes/bandwidth) (tokens/s del lote; con B = 1, ≈ bandwidth /
     bytes), decodeTokPerSecPerSeq (= pasos por segundo), prefillTokPerSecUpperBound (B·T / máx(…)), maxBatchInHbm
     (secuencias de ctx que caben en hbmBytes después de los pesos; 0 = los pesos no caben), bandwidth, peakFlops,
     hbmBytes (los valores usados).
   - crossoverN: T en que QKᵀ + A·V (2T²D por capa) iguala a las lineales (T·(2D² + 2D·G·d_h + 3D·D_mlp)) =
     D + G·d_h + 1.5·D_mlp (MoE: con k expertos y el router); crossoverNProj = D + G·d_h; scoreToLinear = T/crossoverN.
   - Listas (para viz): ctxScaling [{ctx, kvCacheBytes, decodeMacs, decodeBytes, intensity, tokPerSec}], batchScaling
     [{B, kvCacheBytes, decodeBytes, intensity, tokPerSec, tokPerSecPerSeq}], bitsScaling [{bits, weightBytes,
     kvCacheBytes, tokPerSec}], nkvScaling [{nKV, kind, kvBytesPerToken, kvCacheBytes, attnParamsLayer, params}].
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('llm.js necesita js/arch/primitives.js antes.');

  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);

  // Hardware por defecto de las cotas (≈, entradas explícitas de metrics()). NVIDIA H100 Tensor Core GPU datasheet,
  // variante SXM5 80 GB: 3.35 TB/s de HBM3 y 989 TFLOPS BF16 densos (1,979 con dispersidad 2:4).
  const H100 = { bandwidth: 3.35e12, peakFlops: 989e12, hbmBytes: 80e9,
    source: 'NVIDIA H100 Tensor Core GPU datasheet (H100 SXM 80 GB): 3.35 TB/s HBM3, 989 TFLOPS BF16 denso' };

  const BASE = { T: 2048, ctx: 4096, B: 1, bits: 16, decode: 0, eps: 1e-5, tied: false, bias: false, act: 'silu', norm: 'rmsnorm', causal: true };

  const LLAMA3_SRC = 'Llama Team, AI @ Meta 2024 (The Llama 3 Herd of Models, arXiv:2407.21783), Tabla 3; config.json de HF ';
  const CONFIGS = {
    'llama3-8b': Object.assign({}, BASE, { label: 'Llama 3 8B', family: 'Llama 3', D: 4096, L: 32, h: 32, G: 8, dh: 128, Dmlp: 14336, V: 128256,
      ctxMax: 8192, ropeTheta: 500000, canonical: true, hf: 'meta-llama/Meta-Llama-3-8B',
      source: LLAMA3_SRC + 'meta-llama/Meta-Llama-3-8B (hidden 4096, 32 capas, 32 cabezas, 8 KV, FFN 14,336, vocab 128,256, rope_theta 500,000, rms_norm_eps 1e-5, sin atar). El paper redondea el vocabulario a 128K; Llama 3.1 8B (mismos pesos en forma) llega a 128K de contexto con escalado de RoPE (rope_type llama3, factor 8).' }),
    'llama3-70b': Object.assign({}, BASE, { label: 'Llama 3 70B', family: 'Llama 3', D: 8192, L: 80, h: 64, G: 8, dh: 128, Dmlp: 28672, V: 128256,
      ctxMax: 8192, ropeTheta: 500000, hf: 'meta-llama/Meta-Llama-3-70B',
      source: LLAMA3_SRC + 'meta-llama/Meta-Llama-3-70B (hidden 8192, 80 capas, 64 cabezas, 8 KV, FFN 28,672, vocab 128,256, rope_theta 500,000).' }),
    'llama2-7b': Object.assign({}, BASE, { label: 'Llama 2 7B', family: 'Llama 2', D: 4096, L: 32, h: 32, G: 32, dh: 128, Dmlp: 11008, V: 32000,
      ctxMax: 4096, ropeTheta: 10000, hf: 'meta-llama/Llama-2-7b-hf',
      source: 'Touvron et al. 2023 (Llama 2, arXiv:2307.09288), Tabla 1: 7B con contexto 4k y sin GQA (MHA: 32 cabezas KV); config.json de HF meta-llama/Llama-2-7b-hf (hidden 4096, 32 capas, FFN 11,008, vocab 32,000, rope_theta 10,000).' }),
    'mixtral-8x7b': Object.assign({}, BASE, { label: 'Mixtral 8×7B', family: 'Mixtral', D: 4096, L: 32, h: 32, G: 8, dh: 128, Dmlp: 14336, V: 32000,
      ctxMax: 32768, ropeTheta: 1000000, E: 8, topk: 2, hf: 'mistralai/Mixtral-8x7B-v0.1',
      source: 'Jiang et al. 2024 (Mixtral of Experts, arXiv:2401.04088), Tabla 1: dim 4096, 32 capas, head_dim 128, hidden_dim 14,336, 32 cabezas, 8 KV, contexto 32,768, vocab 32,000, 8 expertos, top-2; config.json de HF mistralai/Mixtral-8x7B-v0.1 (rope_theta 1e6, sliding_window null, rms_norm_eps 1e-5).' }),
  };

  function applyKnobs(c, ov) {
    const notes = [];
    if (ov.nKV !== undefined) {
      if (c.h % ov.nKV !== 0) throw new Error(c.label + ': nKV = ' + ov.nKV + ' no divide a las h = ' + c.h + ' cabezas de query (valores válidos: divisores de ' + c.h + ').');
      if (ov.nKV !== c.G) {
        const kind = ov.nKV === c.h ? 'MHA' : (ov.nKV === 1 ? 'MQA' : 'GQA');
        notes.push('What-if: ' + ov.nKV + ' cabezas KV (' + kind + ') en vez de ' + c.G + '. Cambian W_K y W_V (D·G·d_h cada una) y la KV cache; un modelo entrenado con otro G necesita reentrenarse o "uptraining" (Ainslie et al. 2023, promediando cabezas).');
        c.label += ' · ' + kind + ' (n_kv = ' + ov.nKV + ')';
        c.nKVFrom = c.G;
      }
      c.G = ov.nKV;
    }
    ['T', 'ctx', 'B', 'bits', 'decode'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    if (c.bits !== 4 && c.bits !== 8 && c.bits !== 16 && c.bits !== 32) throw new Error(c.label + ': bits debe ser 4, 8, 16 o 32 (recibí ' + c.bits + ').');
    if (c.decode !== 0 && c.decode !== 1) throw new Error(c.label + ': decode debe ser 1 (un paso de decode) u omitirse (prefill).');
    if (c.decode === 1 && c.ctx < 2) throw new Error(c.label + ': en decode ctx debe ser ≥ 2 (el token nuevo + al menos uno en la caché).');
    if (c.T > c.ctxMax) notes.push('T = ' + fint(c.T) + ' supera el contexto de entrenamiento de ' + c.label.split(' · ')[0] + ' (' + fint(c.ctxMax) + ' tokens): el conteo es válido, la calidad no está garantizada.');
    if (c.ctx > c.ctxMax) notes.push('ctx = ' + fint(c.ctx) + ' supera el contexto de entrenamiento (' + fint(c.ctxMax) + ')' + (c.family === 'Llama 3' ? '; Llama 3.1 llega a 131,072 con escalado de RoPE (mismos parámetros).' : '.'));
    if (c.decode === 1) c.label += ' · decode (ctx = ' + fint(c.ctx) + ')';
    c._notes = notes;
    return c;
  }

  function resolve(c) {
    if (c.h % c.G !== 0) throw new Error(c.label + ': h = ' + c.h + ' no es divisible por G = ' + c.G + '.');
    c.nKV = c.G;
    c.groupSize = c.h / c.G;
    c.Dq = c.h * c.dh;
    c.Dkv = c.G * c.dh;
    c.attnKind = c.G === c.h ? 'MHA' : (c.G === 1 ? 'MQA' : 'GQA');
    c.moe = !!c.E;
    if (c.moe) { c.nExperts = c.E; c.topK = c.topk; }   // alias (cfg.E = cfg.nExperts, cfg.topk = cfg.topK)
    c.Tq = c.decode === 1 ? 1 : c.T;           // filas de query de este forward
    c.tokens = c.Tq;
    c.past = c.decode === 1 ? c.ctx - 1 : 0;  // filas que vienen de la caché
    c.bytesPerElem = c.bits / 8;
    return c;
  }

  // Un bloque decoder (repeat L). Devuelve x-out.
  function block(g, c, x) {
    const P = ['blocks', 'block'], rep = c.L, dec = c.decode === 1;
    const Ts = dec ? '1' : 'T';
    const WB = 'Bloque decoder (×' + c.L + ')';
    const Lm = (m, pre) => Object.assign({ perLayer: true }, m, { label: 'Bloque · ' + (pre || '') + m.label });
    const op = (id, res, path, where, extra) => g.op(id, res, Object.assign({ path: P.concat(path), repeat: rep, where: [WB].concat(where || []) }, extra));
    const WA = ['atención ' + c.attnKind + ' (' + c.h + ' cabezas de query, ' + c.G + ' KV)'], TA = 'atención · ';
    const WF = [c.moe ? 'FFN MoE (' + c.E + ' expertos, top-' + c.topk + ')' : 'FFN SwiGLU'], TF = c.moe ? 'FFN MoE · ' : 'FFN · ';
    const kvS = 'G·d_h';

    const hn1 = op('norm1', A.rmsnorm(x, { eps: c.eps }), ['norm1'], [], { out: 'h-norm1', label: 'RMSNorm 1 (antes de la atención)', type: 'norm', group: 'norm',
      outMeta: Lm({ label: 'entrada normalizada de la atención (RMSNorm 1)', tex: '\\mathrm{RMSNorm}_1(x)' }) });
    const q = op('q-proj', A.linear(hn1, { dout: c.Dq, doutSym: 'D', bias: false }), ['attn', 'q-proj'], WA, { out: 'q', label: 'Proyección W_Q (D → h·d_h = D)', type: 'embed', group: 'attn',
      outMeta: Lm({ label: 'Q proyectada (' + c.h + ' cabezas juntas)', tex: 'Q = xW_Q' }, TA) });
    const k = op('k-proj', A.linear(hn1, { dout: c.Dkv, doutSym: kvS, bias: false }), ['attn', 'k-proj'], WA, { out: 'k', label: 'Proyección W_K (D → G·d_h = ' + c.Dkv + ')', type: 'embed', group: 'attn',
      outMeta: Lm({ label: 'K proyectada (' + c.G + ' cabezas KV juntas)', tex: 'K = xW_K' }, TA) });
    const v = op('v-proj', A.linear(hn1, { dout: c.Dkv, doutSym: kvS, bias: false }), ['attn', 'v-proj'], WA, { out: 'v', label: 'Proyección W_V (D → G·d_h = ' + c.Dkv + ')', type: 'embed', group: 'attn',
      outMeta: Lm({ label: 'V proyectada (' + c.G + ' cabezas KV juntas)', tex: 'V = xW_V' }, TA) });
    const [qh, kh, vh] = op('split', A.split_gqa_heads(q, k, v, { h: c.h, G: c.G }), ['attn', 'split'], WA, {
      out: ['q-heads', 'k-heads', 'v-heads'], label: 'Separar en ' + c.h + ' cabezas de query y ' + c.G + ' cabezas KV (cada KV la comparten ' + c.groupSize + ')', type: 'tensorop', group: 'attn',
      outMeta: [Lm({ label: 'queries por cabeza (antes de RoPE)', tex: 'Q_i' }, TA), Lm({ label: 'keys por cabeza KV (antes de RoPE)', tex: 'K_g' }, TA), Lm({ label: 'values por cabeza KV', tex: 'V_g' }, TA)],
    });
    const pos0 = dec ? c.ctx - 1 : 0;
    const qr = op('rope-q', A.rope(qh, { theta: c.ropeTheta, pos0 }), ['attn', 'rope'], WA, { out: 'q-rope', label: 'RoPE sobre Q (θ = ' + fint(c.ropeTheta) + (dec ? ', posición ' + fint(pos0) : '') + ')', type: 'attn', group: 'attn',
      outMeta: Lm({ label: 'queries rotadas (RoPE)', tex: '\\mathrm{RoPE}(Q_i)' }, TA) });
    const kr = op('rope-k', A.rope(kh, { theta: c.ropeTheta, pos0 }), ['attn', 'rope'], WA, { out: 'k-rope', label: 'RoPE sobre K (lo que se guarda en la KV cache)', type: 'attn', group: 'attn',
      outMeta: Lm({ label: dec ? 'key rotada del token nuevo (se agrega a la KV cache)' : 'keys rotadas (RoPE; se escriben en la KV cache)', tex: '\\mathrm{RoPE}(K_g)' }, TA) });
    let kAll = kr, vAll = vh;
    if (dec) {
      const meta = (lab, tex) => ({ label: 'Bloque · KV cache · ' + lab + ' (ctx − 1 = ' + fint(c.ctx - 1) + ' filas, por capa)', tex, perLayer: true });
      const kp = g.input('k-past', shp(['G', 'ctx-1', 'd_h'], [c.G, c.ctx - 1, c.dh], 'txt', 'heads'), meta('keys guardadas', 'K_{\\mathrm{cache}}'));
      const vp = g.input('v-past', shp(['G', 'ctx-1', 'd_h'], [c.G, c.ctx - 1, c.dh], 'txt', 'heads'), meta('values guardados', 'V_{\\mathrm{cache}}'));
      kAll = op('kv-append-k', A.kv_append(kp, kr, { sym: 'ctx' }), ['attn', 'kv-cache'], WA, { out: 'k-ctx', label: 'KV cache: agregar la key nueva', type: 'tensorop', group: 'attn',
        outMeta: Lm({ label: 'keys de todo el contexto (ctx = ' + fint(c.ctx) + ')', tex: '[K_{\\mathrm{cache}};\\,k_t]' }, TA) });
      vAll = op('kv-append-v', A.kv_append(vp, vh, { sym: 'ctx' }), ['attn', 'kv-cache'], WA, { out: 'v-ctx', label: 'KV cache: agregar el value nuevo', type: 'tensorop', group: 'attn',
        outMeta: Lm({ label: 'values de todo el contexto (ctx = ' + fint(c.ctx) + ')', tex: '[V_{\\mathrm{cache}};\\,v_t]' }, TA) });
    }
    const sc = op('scores', A.attention_scores(qr, kAll), ['attn', 'scores'], WA, { out: 'scores', label: 'Producto QKᵀ (cada cabeza KV sirve a ' + c.groupSize + ' de query)', type: 'attn', group: 'attn',
      outMeta: Lm({ label: dec ? 'scores del token nuevo contra el contexto' : 'scores sin escalar', tex: 'QK^\\top' }, TA) });
    let pre = op('scale', A.scale(sc), ['attn', 'scale'], WA, { out: 'scores-scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn',
      outMeta: Lm({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }, TA) });
    if (!dec) {
      pre = op('mask', A.causal_mask(pre), ['attn', 'mask'], WA, { out: 'masked', label: 'Máscara causal (−∞ sobre el futuro)', type: 'attn', group: 'attn',
        outMeta: Lm({ label: 'scores enmascarados (causal)', tex: 'QK^\\top/\\sqrt{d_h} + M_{\\mathrm{causal}}' }, TA) });
    }
    const a = op('softmax', A.softmax(pre), ['attn', 'softmax'], WA, { out: 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn',
      outMeta: Lm({ label: 'pesos de atención', tex: 'A' }, TA) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, vAll), ['attn', 'weighted-sum'], WA, { out: 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn',
      outMeta: Lm({ label: 'salida por cabeza de query', tex: 'AV' }, TA) });
    const z = op('merge', A.merge_heads(zh, { Dsym: 'D' }), ['attn', 'merge'], WA, { out: 'z', label: 'Concatenar las ' + c.h + ' cabezas', type: 'tensorop', group: 'attn',
      outMeta: Lm({ label: 'cabezas concatenadas', tex: 'Z' }, TA) });
    const o = op('o-proj', A.linear(z, { dout: c.D, doutSym: 'D', bias: false }), ['attn', 'o-proj'], WA, { out: 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn',
      outMeta: Lm({ label: 'salida de la atención', tex: 'O = ZW_O' }, TA) });
    const r1 = op('res1', A.residual_add(x, o), ['res1'], [], { out: 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid',
      outMeta: Lm({ label: 'x + atención', tex: "x'" }) });
    const hn2 = op('norm2', A.rmsnorm(r1, { eps: c.eps }), ['norm2'], [], { out: 'h-norm2', label: 'RMSNorm 2 (antes de la FFN)', type: 'norm', group: 'norm',
      outMeta: Lm({ label: 'entrada normalizada de la FFN (RMSNorm 2)', tex: "\\mathrm{RMSNorm}_2(x')" }) });

    let f;
    if (!c.moe) {
      const gt = op('gate-proj', A.linear(hn2, { dout: c.Dmlp, doutSym: 'D_mlp', bias: false }), ['ffn', 'gate-proj'], WF, { out: 'gate', label: 'W_gate (D → D_mlp)', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'rama gate', tex: 'xW_{\\mathrm{gate}}' }, TF) });
      const up = op('up-proj', A.linear(hn2, { dout: c.Dmlp, doutSym: 'D_mlp', bias: false }), ['ffn', 'up-proj'], WF, { out: 'up', label: 'W_up (D → D_mlp)', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'rama up', tex: 'xW_{\\mathrm{up}}' }, TF) });
      const act = op('silu', A.silu(gt), ['ffn', 'silu'], WF, { out: 'act', label: 'SiLU sobre la rama gate', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'compuerta SiLU(gate)', tex: '\\mathrm{SiLU}(xW_{\\mathrm{gate}})' }, TF) });
      const pr = op('mul', A.mul(act, up), ['ffn', 'mul'], WF, { out: 'prod', label: 'Producto SiLU(gate) ⊙ up', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'compuerta ⊙ up', tex: '\\mathrm{SiLU}(xW_{\\mathrm{gate}})\\odot xW_{\\mathrm{up}}' }, TF) });
      f = op('down-proj', A.linear(pr, { dout: c.D, doutSym: 'D', bias: false }), ['ffn', 'down-proj'], WF, { out: 'f', label: 'W_down (D_mlp → D)', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'salida de la FFN', tex: 'F' }, TF) });
    } else {
      const k2 = c.topk, rs = dec ? String(k2) : k2 + 'T';
      const WX = WF.concat(['los ' + c.E + ' expertos SwiGLU']);
      const rl = op('router', A.moe_router(hn2, { E: c.E, Esym: String(c.E) }), ['ffn', 'router'], WF, { out: 'router-logits', label: 'Router: Linear D → ' + c.E + ' (un logit por experto)', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'logits del router (uno por cada uno de los ' + c.E + ' expertos)', tex: 'xW_r' }, TF) });
      const [tw] = op('topk', A.moe_topk(rl, { k: k2 }), ['ffn', 'topk'], WF, { out: ['topk-weights', 'topk-ids'], label: 'Softmax, top-' + k2 + ' y renormalizar', type: 'mlp', group: 'mlp',
        outMeta: [Lm({ label: 'pesos de los ' + k2 + ' expertos elegidos', tex: 'p_j' }, TF), Lm({ label: 'índices de los ' + k2 + ' expertos elegidos', tex: 'j' }, TF)] });
      const xr = op('dispatch', A.repeat_rows(hn2, { k: k2, sym: rs }), ['ffn', 'experts', 'dispatch'], WX, { out: 'x-routed', label: 'Enviar cada token a sus ' + k2 + ' expertos', type: 'tensorop', group: 'mlp',
        outMeta: Lm({ label: 'filas enrutadas (cada token ' + k2 + ' veces)', tex: 'x_{(t,j)}' }, TF) });
      const gt = op('gate-proj', A.expert_linear(xr, { E: c.E, Esym: String(c.E), dout: c.Dmlp, doutSym: 'D_mlp' }), ['ffn', 'experts', 'gate-proj'], WX, { out: 'gate', label: 'W_gate de cada experto (' + c.E + ' matrices D × D_mlp)', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'expertos · rama gate', tex: 'xW^{(j)}_{\\mathrm{gate}}' }, TF) });
      const up = op('up-proj', A.expert_linear(xr, { E: c.E, Esym: String(c.E), dout: c.Dmlp, doutSym: 'D_mlp' }), ['ffn', 'experts', 'up-proj'], WX, { out: 'up', label: 'W_up de cada experto', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'expertos · rama up', tex: 'xW^{(j)}_{\\mathrm{up}}' }, TF) });
      const act = op('silu', A.silu(gt), ['ffn', 'experts', 'silu'], WX, { out: 'act', label: 'SiLU sobre la rama gate', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'expertos · compuerta SiLU(gate)', tex: '\\mathrm{SiLU}(xW^{(j)}_{\\mathrm{gate}})' }, TF) });
      const pr = op('mul', A.mul(act, up), ['ffn', 'experts', 'mul'], WX, { out: 'prod', label: 'Producto SiLU(gate) ⊙ up', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'expertos · compuerta ⊙ up', tex: '\\mathrm{SiLU}(\\cdot)\\odot xW^{(j)}_{\\mathrm{up}}' }, TF) });
      const eo = op('down-proj', A.expert_linear(pr, { E: c.E, Esym: String(c.E), dout: c.D, doutSym: 'D' }), ['ffn', 'experts', 'down-proj'], WX, { out: 'expert-out', label: 'W_down de cada experto (D_mlp → D)', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'salida de cada experto elegido', tex: 'E_j(x)' }, TF) });
      f = op('combine', A.moe_combine(eo, tw), ['ffn', 'combine'], WF, { in: ['expert-out', 'topk-weights'], out: 'f', label: 'Combinar: Σ_j p_j · E_j(x)', type: 'mlp', group: 'mlp',
        outMeta: Lm({ label: 'salida de la FFN (suma ponderada de ' + k2 + ' expertos)', tex: 'F = \\textstyle\\sum_j p_j E_j(x)' }, TF) });
    }
    return op('res2', A.residual_add(r1, f), ['res2'], [], {
      out: 'x-out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: { label: 'Salida del bloque decoder (x_ℓ; tras las L capas, x_L)', tex: 'x_L', perLayer: false, note: 'Salida de cada capa x_ℓ; tras la capa L es x_L.' },
    });
  }

  function build(c, A) {
    const g = A.graph(c);
    const dec = c.decode === 1;
    const Ts = dec ? '1' : 'T', Tn = c.Tq;
    const ids = g.input('ids', shp([Ts], [Tn], 'txt', 'vec'), {
      label: dec ? 'Tokens · el último token generado (entrada del paso de decode)' : 'Tokens · ids de los T tokens del prompt', tex: dec ? 't_{\\mathrm{nuevo}}' : 't_{1..T}',
    });
    const x0 = g.op('embed', A.embedding_lookup(ids, { V: c.V, D: c.D }), {
      path: ['embed'], out: 'x0', where: ['Embedding de tokens'], label: 'Embedding de tokens (tabla V×D: ' + fint(c.V) + ' × ' + c.D + ')', type: 'embed', group: 'embed',
      outMeta: { label: 'Embeddings de entrada (sin posición: RoPE va dentro de la atención)', tex: 'x_0' },
    });
    const xL = block(g, c, x0);
    const xn = g.op('final-norm', A.rmsnorm(xL, { eps: c.eps }), {
      path: ['final-norm'], out: 'x-norm', where: ['Salida'], label: 'RMSNorm final', type: 'norm', group: 'norm',
      outMeta: { label: 'Salida normalizada (RMSNorm final)', tex: '\\mathrm{RMSNorm}(x_L)' },
    });
    const lg = g.op('lm-head', A.lm_head(xn, { V: c.V, tied: c.tied }), {
      path: ['lm-head'], out: 'logits', where: ['Salida'], label: 'LM head (D → V, sin sesgo, no atada)', type: 'head', group: 'head',
      outMeta: { label: dec ? 'Logits del token nuevo sobre el vocabulario' : 'Logits de cada posición sobre el vocabulario', tex: 'z = x_LW_{\\mathrm{head}}' },
    });
    g.op('sample', A.sample_token(lg, {}), {
      path: ['sample'], out: 'next-token', where: ['Salida'], label: 'Muestrear el siguiente token (última fila)', type: 'head', group: 'head',
      outMeta: { label: 'Siguiente token (id elegido)', tex: 't_{\\mathrm{sig}}' },
    });
    return g;
  }

  // ------------------------------------------------------------------ cantidades (para {{…}})
  function quantities(c, r) {
    const n = r.totals.byNode, t = r.totals;
    const L = c.L, D = c.D;
    const embedParams = n.embed.params, lmHeadParams = n['lm-head'].params;
    const attnParams = n.attn.params, ffnParams = n.ffn.params;
    const normParams = n.norm1.params + n.norm2.params + n['final-norm'].params;
    const expertParams = c.moe ? 3 * D * c.Dmlp : 0;
    const activeParams = c.moe ? t.params - (c.E - c.topk) * L * expertParams : t.params;
    const q = {
      tokens: c.Tq, T: c.T, ctx: c.ctx, B: c.B, bits: c.bits, D, L, h: c.h, G: c.G, nKV: c.G, dh: c.dh, Dmlp: c.Dmlp, V: c.V,
      Dkv: c.Dkv, groupSize: c.groupSize, ctxMax: c.ctxMax, ropeTheta: c.ropeTheta, attnKind: c.attnKind,
      E: c.moe ? c.E : 0, topk: c.moe ? c.topk : 0,
      layerParams: n.block.params / L, attnParamsLayer: attnParams / L, ffnParamsLayer: ffnParams / L, normParamsLayer: 2 * D,
      qProjParamsLayer: n['q-proj'].params / L, kProjParamsLayer: n['k-proj'].params / L, vProjParamsLayer: n['v-proj'].params / L, oProjParamsLayer: n['o-proj'].params / L,
      embedParams, lmHeadParams, attnParams, ffnParams, normParams, blocksParams: n.blocks.params,
      totalParams: t.params, activeParams, expertParams, expertsParams: c.moe ? c.E * L * expertParams : 0,
      routerParams: c.moe ? n.router.params : 0,
      kvBytesPerToken: 2 * L * c.G * c.dh * c.bits / 8,
      kvElemsPerTokenLayer: 2 * c.G * c.dh,
      layerMacs: n.block.macs / L, attnMacsLayer: n.attn.macs / L, ffnMacsLayer: n.ffn.macs / L,
      scoreMacsLayer: r.ops.filter((o) => o.prim === 'attention_scores' || o.prim === 'attention_weighted_sum').reduce((s, o) => s + o.macs, 0),
      lmHeadMacs: n['lm-head'].macs,
    };
    // Inferencia, también aquí para {{…}} y tablas compare (B, bits y ctx de la config; hardware por defecto = H100 SXM).
    // decodeLinearMacs: las lineales escalan con las filas, (MACs − scores)/T_q, exacto; decodeMacsPerToken le suma los
    // scores de un paso con ctx filas (2·L·h·ctx·d_h) = los MACs del grafo decode (lo verifica tests/arch.test.cjs).
    const score = r.ops.filter(isScore).reduce((s, o) => s + o.macs * o.repeat, 0);
    q.decodeLinearMacs = (t.macs - score) / c.Tq;
    q.prefillMacs = q.decodeLinearMacs * c.T + 2 * L * c.h * c.T * c.T * c.dh;
    const cm = costModel(c, q, H100);
    q.decodeMacsPerToken = cm.decodeMacsAt(c.ctx);
    q.kvCacheBytes = cm.kvTok * c.ctx * c.B;
    q.weightBytes = t.params * c.bits / 8;
    q.decodeBytesPerStep = cm.decodeBytesAt(c.ctx, c.B);
    q.prefillBytes = cm.prefillBytes(c.B);
    q.arithmeticIntensityDecode = 2 * c.B * q.decodeMacsPerToken / q.decodeBytesPerStep;
    q.arithmeticIntensityPrefill = 2 * c.B * q.prefillMacs / q.prefillBytes;
    q.decodeTokPerSecUpperBound = cm.decTok(c.ctx, c.B);
    return q;
  }

  const sumMacs = (r, f) => r.ops.filter(f).reduce((s, o) => s + o.macs * o.repeat, 0);
  const isScore = (o) => o.prim === 'attention_scores' || o.prim === 'attention_weighted_sum';

  // Modelo de costo de inferencia compartido por quantities() y metrics(). q = quantities (parámetros por tipo y
  // decodeLinearMacs); hw = {bandwidth, peakFlops}. Bytes: ver la cabecera (pesos leídos + filas de embedding + KV).
  function costModel(c, q, hw) {
    const L = c.L, D = c.D, wb = c.bits / 8;
    const kvTok = 2 * L * c.G * c.dh * wb;                 // bytes de K y V por token, todas las capas, una secuencia
    // Expertos distintos que lee un paso con n tokens (enrutamiento uniforme, ≈): E·(1 − ((E−k)/E)^n). Denso: 0.
    const expertsTouched = (n) => (c.moe ? c.E * (1 - Math.pow((c.E - c.topk) / c.E, n)) : 0);
    const nonExpert = q.totalParams - q.expertsParams;
    const readWeightBytes = (nTok) => (nonExpert - q.embedParams + expertsTouched(nTok) * L * q.expertParams) * wb;
    const decodeMacsAt = (ctx) => q.decodeLinearMacs + 2 * L * c.h * ctx * c.dh;
    const decodeBytesAt = (ctx, b) => readWeightBytes(b) + b * D * wb + b * ctx * kvTok;
    const prefillBytes = (b) => readWeightBytes(b * c.T) + b * c.T * D * wb + b * c.T * kvTok;
    const tokPerSec = (flops, bytes, toks) => toks / Math.max(flops / hw.peakFlops, bytes / hw.bandwidth);
    const decTok = (ctx, b) => tokPerSec(2 * b * decodeMacsAt(ctx), decodeBytesAt(ctx, b), b);
    return { kvTok, expertsTouched, readWeightBytes, decodeMacsAt, decodeBytesAt, prefillBytes, tokPerSec, decTok };
  }

  // ------------------------------------------------------------------ métricas
  function metrics(c, r, o) {
    const ov = o.overrides || {};
    const B = o.B;
    const bw = ov.bandwidth !== undefined ? ov.bandwidth : H100.bandwidth;
    const peak = ov.peakFlops !== undefined ? ov.peakFlops : H100.peakFlops;
    const hbm = ov.hbmBytes !== undefined ? ov.hbmBytes : H100.hbmBytes;
    [['bandwidth', bw], ['peakFlops', peak], ['hbmBytes', hbm]].forEach(([k, v]) => { if (!(typeof v === 'number' && v > 0 && isFinite(v))) throw new Error(k + ' debe ser un número positivo.'); });
    const wb = c.bits / 8;
    // Knobs de arquitectura de esta corrida, sin `decode`: prefill y decode con los mismos T, ctx, B, bits y nKV.
    const arch = {};
    ['T', 'ctx', 'B', 'bits', 'nKV'].forEach((k) => { if (r.overrides[k] !== undefined) arch[k] = r.overrides[k]; });
    const pre = c.decode === 1 ? A.run(r.id, arch) : r;
    const dec = c.decode === 1 ? r : A.run(r.id, Object.assign({}, arch, { decode: 1 }));
    const q = pre.quantities, L = c.L, D = c.D;
    const params = pre.totals.params;
    const cm = costModel(c, q, { bandwidth: bw, peakFlops: peak });
    const { kvTok, expertsTouched, readWeightBytes, decodeMacsAt, decodeBytesAt, tokPerSec, decTok } = cm;

    // KV cache y pesos
    const kvCache = kvTok * c.ctx * B;
    const kvMHA = 2 * L * c.h * c.dh * wb, kvMQA = 2 * L * 1 * c.dh * wb;
    const weightBytes = params * wb;

    // Cómputo (de los grafos prefill y decode)
    const prefillMacs = pre.totals.macs, decodeMacs = dec.totals.macs;
    const preScore = sumMacs(pre, isScore), decScore = sumMacs(dec, isScore);
    const decLinear = decodeMacs - decScore;

    // Bytes movidos
    const prefillBytes = cm.prefillBytes(B);
    const decodeWeightBytes = readWeightBytes(B) + B * D * wb;
    const decodeBytes = decodeBytesAt(c.ctx, B);

    const crossLin = D + c.Dkv + (c.moe ? (c.E / 2) + 1.5 * c.topk * c.Dmlp : 1.5 * c.Dmlp);
    const share = (x) => x / params;
    const out = {
      // KV cache
      kvBytesPerToken: kvTok, kvBytesPerTokenLayer: kvTok / L, kvCacheBytes: kvCache, kvCache,
      kvBytesPerTokenMHA: kvMHA, kvCacheBytesMHA: kvMHA * c.ctx * B, kvCacheBytesMQA: kvMQA * c.ctx * B, kvSavingVsMHA: c.h / c.G,
      kvCacheVsWeights: kvCache / weightBytes,
      // pesos
      weightBytes, weightBytes16: params * 2, weightBytes8: params, weightBytes4: params / 2,
      // parámetros
      totalParams: params, activeParams: q.activeParams, activeParamsShare: q.activeParams / params, activeWeightBytes: q.activeParams * wb,
      embedParams: q.embedParams, lmHeadParams: q.lmHeadParams, attnParams: q.attnParams, ffnParams: q.ffnParams, normParams: q.normParams,
      layerParams: q.layerParams, attnParamsLayer: q.attnParamsLayer, ffnParamsLayer: q.ffnParamsLayer,
      embedParamsShare: share(q.embedParams + q.lmHeadParams), attnParamsShare: share(q.attnParams), ffnParamsShare: share(q.ffnParams), normParamsShare: share(q.normParams),
      // cómputo
      prefillMacs, prefillMacsPerToken: prefillMacs / c.T, prefillMacsLastLogits: prefillMacs - (c.T - 1) * D * c.V,
      prefillScoreMacs: preScore, prefillScoreMacsCausal: L * c.h * c.dh * c.T * (c.T + 1), prefillScoreMacsShare: preScore / prefillMacs,
      decodeMacsPerToken: decodeMacs, decodeScoreMacs: decScore, decodeLinearMacs: decLinear, decodeScoreMacsShare: decScore / decodeMacs,
      decodeFlopsPerParam: 2 * decodeMacs / q.activeParams,
      // bytes e intensidad
      prefillBytes, decodeBytesPerStep: decodeBytes, decodeWeightBytesRead: decodeWeightBytes, decodeKvBytesRead: B * c.ctx * kvTok,
      arithmeticIntensityPrefill: 2 * B * prefillMacs / prefillBytes,
      arithmeticIntensityDecode: 2 * B * decodeMacs / decodeBytes,
      ridgePoint: peak / bw,
      // cotas (≈)
      decodeTokPerSecUpperBound: tokPerSec(2 * B * decodeMacs, decodeBytes, B),
      decodeTokPerSecPerSeq: tokPerSec(2 * B * decodeMacs, decodeBytes, 1),
      prefillTokPerSecUpperBound: tokPerSec(2 * B * prefillMacs, prefillBytes, B * c.T),
      decodeBound: 2 * B * decodeMacs / peak > decodeBytes / bw ? 'cómputo' : 'memoria',
      prefillBound: 2 * B * prefillMacs / peak > prefillBytes / bw ? 'cómputo' : 'memoria',
      maxBatchInHbm: Math.max(0, Math.floor((hbm - weightBytes) / (c.ctx * kvTok))),
      bandwidth: bw, peakFlops: peak, hbmBytes: hbm, hardwareSource: H100.source,
      // cruce scores vs lineales (por capa)
      crossoverN: crossLin, crossoverNProj: D + c.Dkv, scoreToLinear: c.T / crossLin,
      linearMacs: sumMacs(pre, (x) => x.prim === 'linear' || x.prim === 'expert_linear' || x.prim === 'moe_router'),
      units: LLM_UNITS,
    };
    if (c.moe) Object.assign(out, {
      routerParams: q.routerParams, expertParams: q.expertParams, expertsParamsShare: q.expertsParams / params,
      decodeExpertsReadPerLayer: expertsTouched(B), experts: c.E, topk: c.topk,
    });
    out.ctxScaling = [1024, 4096, 8192, 32768, 131072].map((ctx) => {
      const by = decodeBytesAt(ctx, B);
      return { ctx, kvCacheBytes: kvTok * ctx * B, decodeMacs: decodeMacsAt(ctx), decodeBytes: by, intensity: 2 * B * decodeMacsAt(ctx) / by, tokPerSec: decTok(ctx, B) };
    });
    out.batchScaling = [1, 8, 32, 64, 128, 256].map((b) => {
      const by = decodeBytesAt(c.ctx, b);
      return { B: b, kvCacheBytes: kvTok * c.ctx * b, decodeBytes: by, intensity: 2 * b * decodeMacsAt(c.ctx) / by, tokPerSec: decTok(c.ctx, b), tokPerSecPerSeq: decTok(c.ctx, b) / b };
    });
    out.bitsScaling = [16, 8, 4].map((bits) => {
      const s = bits / 8 / wb;   // reescala bytes
      const by = decodeBytes * s;
      return { bits, weightBytes: params * bits / 8, kvCacheBytes: kvCache * s, tokPerSec: tokPerSec(2 * B * decodeMacs, by, B) };
    });
    out.nkvScaling = Array.from(new Set([c.h, 8, 1].filter((x) => c.h % x === 0))).map((G) => {
      const attnLayer = D * c.Dq + 2 * D * G * c.dh + c.Dq * D;
      return { nKV: G, kind: G === c.h ? 'MHA' : (G === 1 ? 'MQA' : 'GQA'), kvBytesPerToken: 2 * L * G * c.dh * wb, kvCacheBytes: 2 * L * G * c.dh * wb * c.ctx * B,
        attnParamsLayer: attnLayer, params: params + L * (attnLayer - q.attnParamsLayer) };
    });
    return out;
  }

  // Unidades (las que la práctica sabe formatear: ratio | count | bytes | pct | macs | params). FLOPs por byte → 'ratio'.
  const LLM_UNITS = {
    kvBytesPerToken: 'bytes', kvBytesPerTokenLayer: 'bytes', kvCacheBytes: 'bytes', kvCache: 'bytes', kvBytesPerTokenMHA: 'bytes',
    kvCacheBytesMHA: 'bytes', kvCacheBytesMQA: 'bytes', kvSavingVsMHA: 'ratio', kvCacheVsWeights: 'ratio',
    weightBytes: 'bytes', weightBytes16: 'bytes', weightBytes8: 'bytes', weightBytes4: 'bytes', activeWeightBytes: 'bytes',
    totalParams: 'params', activeParams: 'params', activeParamsShare: 'pct', embedParams: 'params', lmHeadParams: 'params', attnParams: 'params',
    ffnParams: 'params', normParams: 'params', layerParams: 'params', attnParamsLayer: 'params', ffnParamsLayer: 'params',
    embedParamsShare: 'pct', attnParamsShare: 'pct', ffnParamsShare: 'pct', normParamsShare: 'pct',
    routerParams: 'params', expertParams: 'params', expertsParamsShare: 'pct',
    prefillMacs: 'macs', prefillMacsPerToken: 'macs', prefillMacsLastLogits: 'macs', prefillScoreMacs: 'macs', prefillScoreMacsCausal: 'macs',
    prefillScoreMacsShare: 'pct', decodeMacsPerToken: 'macs', decodeScoreMacs: 'macs', decodeLinearMacs: 'macs', decodeScoreMacsShare: 'pct',
    decodeFlopsPerParam: 'ratio', linearMacs: 'macs',
    prefillBytes: 'bytes', decodeBytesPerStep: 'bytes', decodeWeightBytesRead: 'bytes', decodeKvBytesRead: 'bytes',
    arithmeticIntensityPrefill: 'ratio', arithmeticIntensityDecode: 'ratio', ridgePoint: 'ratio',
    decodeTokPerSecUpperBound: 'count', decodeTokPerSecPerSeq: 'count', prefillTokPerSecUpperBound: 'count', maxBatchInHbm: 'count',
    bandwidth: 'count', peakFlops: 'count', hbmBytes: 'bytes', decodeExpertsReadPerLayer: 'ratio', experts: 'count', topk: 'count',
    crossoverN: 'count', crossoverNProj: 'count', scoreToLinear: 'ratio',
  };

  A.defineModel({
    id: 'llm',
    label: 'LLM decoder-only (Llama 3, Llama 2, Mixtral)',
    paper: { title: 'The Llama 3 Herd of Models', authors: 'Llama Team, AI @ Meta (arXiv v1: Dubey et al.; v3: Grattafiori et al.)', venue: 'arXiv', year: 2024, arxiv: '2407.21783',
      note: 'Llama 2: Touvron et al. 2023, arXiv:2307.09288. Mixtral: Jiang et al. 2024, arXiv:2401.04088. GQA: Ainslie et al., EMNLP 2023, arXiv:2305.13245. RoPE: Su et al., arXiv:2104.09864. SwiGLU: Shazeer 2020, arXiv:2002.05202.' },
    configs: CONFIGS,
    knobs: { T: [128, 512, 2048, 8192], ctx: [1024, 4096, 8192, 32768, 131072], B: [1, 8, 32, 128], bits: [16, 8, 4], nKV: [32, 8, 1], decode: [1] },
    hardware: Object.assign({}, H100),
    applyKnobs,
    resolve,
    build,
    quantities,
    metrics,
  });
})(typeof window !== 'undefined' ? window : globalThis);
