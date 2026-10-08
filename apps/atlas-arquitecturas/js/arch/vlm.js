/* =============================================================================
   Atlas de Arquitecturas — js/arch/vlm.js
   Modelos `llava` y `qwen2-vl` (páginas `llava` y `qwen2-vl`; contrato SPEC §19). Tesis: un VLM = encoder de visión +
   proyector + el decoder de la fase 6. El decoder NO se reescribe: se construye con el build() del modelo `llm`
   (js/arch/llm.js) y se importa con A.importGraph (mismas ops, ids, etiquetas y números); la torre de visión usa
   A.preLnLayer (el mismo bloque de ViT / CLIP). Cargar DESPUÉS de llm.js.
   - LLaVA: Liu et al., Visual Instruction Tuning, NeurIPS 2023, arXiv:2304.08485; LLaVA-1.5: Liu et al., Improved
     Baselines with Visual Instruction Tuning, CVPR 2024, arXiv:2310.03744. Dimensiones = config.json de
     llava-hf/llava-1.5-{7b,13b}-hf.
   - Qwen2-VL: Wang et al., Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution,
     arXiv:2409.12191 (2024). Dimensiones = config.json de Qwen/Qwen2-VL-{2B,7B,72B}-Instruct y el código de HF
     (transformers 5.19, models/qwen2_vl/modeling_qwen2_vl.py).
   Cross-check: crosscheck/vlm.py (HF LlavaForConditionalGeneration / Qwen2VLForConditionalGeneration construidos en código en
   el dispositivo META, FlopCounterMode con todas las capas): parámetros y FLOPs exactos (diferencia 0).

   ---------------------------------------------------------------- convenciones y símbolos
   Formas sin batch. Del LLM (los de la fase 6): D, L, h, G (cabezas KV), d_h, D_mlp, V. Del prompt: T = tokens de TEXTO
   (sin los visuales; en Qwen2-VL incluye <|vision_start|> y <|vision_end|>), N = tokens VISUALES del prompt, N + T = largo
   de la secuencia del LLM. De la torre de visión (símbolos propios para no chocar con los del LLM): D_v (ancho), h_v
   (cabezas), d_v = D_v/h_v, 4D_v (MLP), L_v (capas, solo como repetición), N_p (parches de UNA imagen o recorte), P (patch).
   Qwen2-VL además: F (frames; una imagen se duplica a 2), F/2 (parches temporales), H/P·W/P (parches de un par de frames).
   Config (campos que usan {{…}} y la práctica): H, W, C, P, D, L, h, G, dh, Dmlp, V, T, N (visuales), Np, S = N + T
   (= tokens), Dv, Lv, hv, dv, Dmlpv; LLaVA images; Qwen2-VL frames (F), t = parches temporales, merge = 2, kt = 2.
   Práctica (orquestador): los hechos de la tarjeta deben sumar D_v, h_v, d_v, L_v, N_p y F (Qwen2-VL) a los genéricos.

   ---------------------------------------------------------------- LLaVA (modelo `llava`)
   Configs: llava15-7b (canónica; Vicuna-7B v1.5 = arquitectura de Llama 2 7B), llava15-13b (Vicuna-13B v1.5).
   Visión: CLIP ViT-L/14 @ 336 (24 capas, D_v 1024, 16 cabezas, MLP 4096, QuickGELU; conv sin sesgo, CLS, posición
   aprendida 577×1024, ln_pre, ln_post). Features de la PENÚLTIMA capa (vision_feature_layer = −2) sin el CLS → 576×1024.
   HF (y el código original de LLaVA) corren las 24 capas con output_hidden_states = True y descartan la última: el grafo
   cuenta la capa 24 (op v-last-layer, nodo last-layer) y ln_post sobre su CLS (sus parámetros existen), pero sus salidas no
   van a ningún lado; metrics().visionMacsUsed / visionMacsDiscarded separan lo útil de lo descartado (vLLM la omite).
   Proyector: MLP de 2 capas con GELU, 1024 → 4096 → 4096, con sesgos (mlp2x_gelu). Vocabulario 32,064 = los 32,000 de Vicuna
   + el token <image> (32000), <pad> (32001) y relleno a múltiplo de 64 que agrega llava-hf (el checkpoint original
   liuhaotian/llava-v1.5-7b tiene 32,000: 2·64·D = 524,288 parámetros menos en 7B). Knobs: T (tokens de texto), images
   (imágenes en el prompt: la torre de visión y el proyector corren `images` veces — op.repeat × images —, las formas de la
   torre son POR IMAGEN). Sin config AnyRes (LLaVA-NeXT): metrics().anyresTokensAt da el conteo con la regla de HF.
   Ops (path) — vista `llava-overview`:
     image (tensor pixels H×W×C)
     vis-patch-embed   vision-encoder › patch-embed › conv      pixels → v-patch-grid (H/P×W/P×D_v)
     vis-patch-flatten vision-encoder › patch-embed › flatten   → v-patches (N_p×D_v)
     vis-cls           vision-encoder › cls                     → v-cls-cat ((N_p+1)×D_v)
     vis-pos-embed     vision-encoder › pos-embed               → v-e-pos
     vis-add-pos       vision-encoder › add-pos                 → v-x0
     vis-ln-pre        vision-encoder › ln-pre                  → v-ln-pre
     capa (repeat (L_v − 1)·images): vis-ln1 · vis-qkv · vis-split · vis-scores · vis-scale · vis-softmax · vis-weighted-sum ·
       vis-merge · vis-proj · vis-res1 · vis-ln2 · vis-fc1 · vis-gelu · vis-fc2 · vis-res2 con paths vision-encoder › enc-layer › {ln1, mhsa › {qkv,
       split, scores, scale, softmax, weighted-sum, merge, proj}, res1, ln2, mlp › {fc1, gelu, fc2}, res2}; tensores v-h-ln1
       v-qkv v-q v-k v-v v-scores v-scores-scaled v-attn v-z-heads v-z v-o v-r1 v-h-ln2 v-u v-g v-f v-x-out (= salida de la
       capa 23 = hidden_states[−2])
     vis-last-layer    vision-encoder › last-layer              v-x-out → v-x-last (capa 24: HF la corre y la descarta)
     vis-pool-cls      vision-encoder › ln-post                 v-x-last → v-cls (descartado)
     vis-ln-post       vision-encoder › ln-post                 → v-cls-ln (descartado)
     select-layer    select-layer                             v-x-out → vis-feats (N_p×D_v: penúltima capa, sin CLS)
     proj-fc1        projector › fc1                          → proj-h (N_p×D)
     proj-gelu       projector › gelu                         → proj-act
     proj-fc2        projector › fc2                          → vis-tokens (N_p×D)
     text (tensor text-ids T)
     embed           embed                                    text-ids → text-emb (T×D)
     splice          merge                                    text-emb, vis-tokens → prompt ((N+T)×D)
     LLM (importado de llm.js; repeat L): ids y tensores de SPEC §18.1 (norm1, q-proj, k-proj, v-proj, split, rope-q,
       rope-k, scores, scale, mask, softmax, weighted-sum, merge, o-proj, res1, norm2, gate-proj, up-proj, silu, mul,
       down-proj, res2) con path llm › block › … (el de F6 es blocks › block › …); final-norm (llm › final-norm),
       lm-head (lm-head) → logits ((N+T)×V), sample (answer) → next-token. Tensores del LLM: los de F6 (h-norm1 q k v
       q-heads k-heads v-heads q-rope k-rope scores scores-scaled masked attn z-heads z o r1 h-norm2 gate up act prod f
       x-out x-norm logits next-token) con T → N+T.
   ---------------------------------------------------------------- Qwen2-VL (modelo `qwen2-vl`)
   Configs: qwen2-vl-7b (canónica), qwen2-vl-2b (embeddings atados), qwen2-vl-72b. Imagen por defecto 812×812 (29·29 = 841
   tokens), T = 64. Visión (≈ 675 M con el merger): Conv3d 2×14×14 sin sesgo (una imagen se repite a 2 frames), 32 capas
   pre-LN (LayerNorm ε 1e-6, D_v 1280, 16 cabezas, d_v 80, MLP 5120 QuickGELU, qkv y proj con sesgo), RoPE 2-D en cada
   atención (θ 10,000; la mitad de las frecuencias para la fila y la mitad para la columna; sin posición absoluta).
   Merger: LayerNorm por parche (ln_q, 1280) → agrupar 2×2 vecinos (4·1280 = 5120) → Linear 5120→5120 → GELU → Linear
   5120→D. LLM Qwen2: como Llama pero con SESGO en W_Q, W_K, W_V (no en W_O), RMSNorm ε 1e-6, RoPE θ 1e6 → M-RoPE
   (mrope_section [16, 24, 24] de las 64 frecuencias). Knobs: H, W (múltiplos de 28 = P·merge, dentro de
   [min_pixels, max_pixels] = [3,136, 12,845,056] del preprocessor_config.json), frames (1 = imagen; par = video: F frames
   → F/2 parches temporales; la atención del ViT es POR par de frames, cu_seqlens), T.
   Ops (path) — vista `qwen2vl-overview`:
     image (tensor pixels H×W×C; video F×H×W×C)
     vis-repeat        patchify › repeat                        pixels → v-frames (2×H×W×C; solo imagen)
     vis-patch-embed   patchify › conv3d                        → v-patch-grid (H/P×W/P×D_v; video F/2×H/P×W/P×D_v)
     vis-patch-flatten patchify › flatten                       → v-patches (N_p×D_v)
     [video] vis-segment vision-encoder › segment              → v-x-seg (F/2 × H/P·W/P × D_v)
     capa (repeat L_v = 32): como LLaVA (ops vis-…, tensores v-…) y, entre split y scores, vis-rope2d-q / vis-rope2d-k
       (vision-encoder › enc-layer › mhsa › rope2d) → v-q-rope, v-k-rope; salida vis-feats (imagen) o v-x-out (video)
     [video] vis-unsegment vision-encoder › segment            v-x-out → vis-feats (N_p×D_v)
     merger-ln       merger › ln                              vis-feats → v-merge-ln (N_p×D_v)
     merger-group    merger › group2x2                        → v-grouped (N×4D_v, N = N_p/4)
     merger-fc1      merger › fc1                             → merger-h (N×4D_v)
     merger-gelu     merger › gelu                            → merger-act
     merger-fc2      merger › fc2                             → vis-tokens (N×D)
     embed / splice  como LLaVA (text-ids → text-emb; prompt ((N+T)×D))
     mrope-ids       mrope                                    → pos-ids (3×(N+T): ids t, h, w de cada token)
     LLM importado como en LLaVA, con q-proj/k-proj/v-proj CON sesgo y rope-q/rope-k = M-RoPE (prim mrope; entradas
       q-heads|k-heads y pos-ids).

   ---------------------------------------------------------------- desviaciones respecto de SPEC §19 (nada renombrado)
   - Ids de op de la torre de visión con prefijo vis- (tensores con v-): v-proj ya es la op W_V del LLM de F6.
   - Ids de op que chocan entre partes: la inserción en el prompt es la op `splice` (path merge) porque `merge` es la op
     de F6 que concatena cabezas; las ops del proyector / merger son proj-fc1… / merger-fc1… (paths projector › fc1 /
     merger › fc1). Los nodos fc1, gelu, fc2, merge existen también dentro de la torre de visión (mhsa › merge, mlp › fc1…):
     en los diagramas, los nodos del proyector / merger necesitan `scope: 'projector'` / `'merger'` (o `ops` + `opsExact`),
     y el nodo `merge` del overview `ops: ['splice']`, `opsExact: true`.
   - Merger de Qwen2-VL: HF aplica la LayerNorm a cada parche (1280) ANTES de agrupar 2×2; la SPEC lista group2x2, ln.
     El grafo sigue a HF: ln → group2x2 → fc1 → gelu → fc2. El MLP es 5120 → 5120 → D (no 5120 → D → D).
   - LLaVA: nodo extra `last-layer` (la capa 24 que HF corre y descarta) y `ln-post`; nodo `select-layer` = la op que toma
     hidden_states[−2] sin el CLS. Sin config llava-next-7b (opcional): AnyRes solo en metrics().anyresTokensAt.
   - Tensores añadidos: text-ids, v-* de la torre, proj-h, proj-act (LLaVA), v-frames, v-patch-grid, v-patches, v-merge-ln,
     v-grouped, merger-h, merger-act, pos-ids (Qwen2-VL), y los del LLM de F6. vis-feats en Qwen2-VL = salida del ViT
     (N_p×D_v, antes del merger).
   - Final norm del LLM bajo el nodo `llm` (path llm › final-norm); sample bajo `answer`.
   - Sin configs de decode: metrics() trae el paso de decode (decodeMacsPerToken con ctx = N + T + 1, la imagen ya en la KV
     cache) construyendo el decoder de llm.js con decode = 1.

   ---------------------------------------------------------------- metrics() (unidades en metrics.units)
   visualTokens, visualTokensPerImage, textTokens, promptTokens (count); visualShare (pct del prompt); visionParams,
   projectorParams, llmParams, totalParams, visualModuleParams (HF `visual` de Qwen2-VL = ViT + merger) (params);
   visionParamsShare (pct); visionMacs (lo que corre HF; LLaVA incluye la capa descartada), visionMacsUsed,
   visionMacsDiscarded, projectorMacs, llmPrefillMacs (bloques + norma + LM head sobre N + T filas), llmMacsFromImage (LLM con
   N + T menos con T), llmMacsTextOnly, prefillMacs (= total), imageMacs (visión + proyector + llmMacsFromImage) (macs);
   prefillShareFromImage, visionMacsShare (pct); kvBytesPerToken (bf16, todas las capas), kvBytesPerImage (tokens de UNA
   imagen × kvBytesPerToken), kvBytesPrompt (bytes); weightBytes (bf16) (bytes); ttftMs, ttftTextOnlyMs (≈ cota roofline en
   ms con el hardware dado, count), ttftBound ('cómputo' | 'memoria'), decodeMacsPerToken (macs), decodeTokPerSecUpperBound
   (count), bandwidth, peakFlops (count), hardwareSource; crossoverN (count). Listas: LLaVA imagesScaling, textScaling,
   anyresTokensAt; Qwen2-VL tokensAt, framesScaling, textScaling. ATLAS.Arch.vlm = {smartResize, qwenTokens,
   llavaNextTokens} para la viz (tamaño arbitrario → tokens).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('vlm.js necesita js/arch/primitives.js antes.');
  if (!A.hasConfig || !A.hasConfig('llama2-7b')) throw new Error('vlm.js necesita js/arch/llm.js antes (compone su decoder).');
  const LLMDEF = A.model('llm');
  const HW = LLMDEF.hardware;   // H100 SXM (≈, entradas explícitas), mismas convenciones que llm.js
  const fint = (n) => A.fmt.int(n);
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);

  // ------------------------------------------------------------------ el decoder de llm.js
  // Config del modelo `llm` con las dimensiones del LLM del VLM y S = N + T filas (no se registra: se arma y se resuelve
  // con su propio resolve()). Memo local: los grafos del LLM se reconstruyen solo si cambia algo.
  const llmMemo = {};
  function llmData(c, S, extra) {
    const b = Object.assign({}, LLMDEF.configs['llama2-7b'], {
      label: c.llmLabel, family: c.llmFamily, D: c.D, L: c.L, h: c.h, G: c.G, dh: c.dh, Dmlp: c.Dmlp, V: c.V, ctxMax: c.ctxMax,
      ropeTheta: c.ropeTheta, eps: c.eps, tied: !!c.tied, T: S, ctx: S, B: 1, bits: 16, kvBits: 16, decode: 0, canonical: false, hf: c.hf,
    }, extra || {});
    delete b.decodeOf;
    const key = ['D', 'L', 'h', 'G', 'dh', 'Dmlp', 'V', 'ropeTheta', 'tied', 'T', 'ctx', 'decode'].map((k) => b[k]).join('|');
    if (!llmMemo[key]) {
      const cf = LLMDEF.resolve(b);
      llmMemo[key] = { cfg: cf, data: LLMDEF.build(cf, A)._data() };
    }
    return llmMemo[key];
  }
  const sumMacs = (ops, f) => ops.filter(f || (() => true)).reduce((s, o) => s + o.macs * o.repeat, 0);
  // MACs del LLM (sin la tabla de embedding) con S filas; decode = un paso con ctx filas en la caché.
  const llmMacs = (c, S) => sumMacs(llmData(c, S).data.ops, (o) => o.id !== 'embed');
  const llmDecodeMacs = (c, ctx) => sumMacs(llmData(c, 1, { decode: 1, ctx }).data.ops, (o) => o.id !== 'embed');

  // T → N+T en las fórmulas TeX del decoder importado (símbolo aislado; nunca dentro de \top, \textstyle…).
  const texT = (s) => (typeof s === 'string' ? s.replace(/(^|[^A-Za-z\\{_])T(?![A-Za-z_])/g, '$1(N{+}T)') : s);

  // Importa el decoder (todo menos su embedding) leyendo `prompt`. replace: cambios por op (Qwen2: sesgos, M-RoPE).
  function importLLM(g, c, replace) {
    const W = 'LLM (' + c.llmLabel + ')';
    A.importGraph(g, llmData(c, c.S).data, {
      skip: ['embed'], inputs: { x0: 'prompt' }, sym: { T: 'N+T' }, tex: texT,
      path: (p) => (p[0] === 'blocks' ? ['llm'].concat(p.slice(1)) : p[0] === 'final-norm' ? ['llm', 'final-norm'] : p[0] === 'sample' ? ['answer'] : p),
      where: (w) => [W].concat(w),
      label: (l) => 'LLM · ' + l,
      replace,
    });
  }

  // Embedding del texto + inserción de los tokens visuales (común a los dos modelos).
  function textAndSplice(g, c, visTokens, copies) {
    const ids = g.input('text-ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Texto · ids de los T tokens de texto del prompt (sin los visuales)', tex: 't_{1..T}' });
    const te = g.op('embed', A.embedding_lookup(ids, { V: c.V, D: c.D }), {
      path: ['embed'], out: 'text-emb', where: ['Embedding de tokens del LLM'], label: 'Embedding de tokens (tabla V×D: ' + fint(c.V) + ' × ' + c.D + ')', type: 'embed', group: 'embed',
      outMeta: { label: 'Texto · embeddings de los tokens de texto', tex: 'E[t]' },
    });
    return g.op('splice', A.splice_tokens(te, visTokens, { copies, sym: 'N+T' }), {
      path: ['merge'], out: 'prompt', where: ['Prompt del LLM'], label: 'Insertar los ' + fint(c.N) + ' tokens visuales en el marcador <image>', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Prompt del LLM: N tokens visuales + T de texto (N = ' + fint(c.N) + ')', tex: '[\\,\\ldots;\\,V_{\\mathrm{img}};\\,\\ldots\\,]' },
    });
  }

  // ------------------------------------------------------------------ LLaVA
  const LLAVA_SRC = 'Liu et al. 2024 (LLaVA-1.5, Improved Baselines with Visual Instruction Tuning, CVPR 2024, arXiv:2310.03744), §3–4 y Tabla 1; config.json de HF ';
  const CLIP336 = { H: 336, W: 336, C: 3, P: 14, Dv: 1024, Lv: 24, hv: 16, Dmlpv: 4096, featureLayer: -2, visionLabel: 'CLIP ViT-L/14 @ 336' };
  const LLAVA_BASE = Object.assign({}, CLIP336, { T: 64, images: 1, eps: 1e-5, ropeTheta: 10000, ctxMax: 4096, tied: false, projBias: true, causal: false });
  const LLAVA = {
    'llava15-7b': Object.assign({}, LLAVA_BASE, { label: 'LLaVA-1.5 7B', canonical: true, llmLabel: 'Vicuna-7B v1.5', llmFamily: 'Llama 2',
      D: 4096, L: 32, h: 32, G: 32, dh: 128, Dmlp: 11008, V: 32064, hf: 'llava-hf/llava-1.5-7b-hf',
      source: LLAVA_SRC + 'llava-hf/llava-1.5-7b-hf (visión CLIP ViT-L/14 @ 336: 24 capas, 1024, 16 cabezas, MLP 4096, patch 14; vision_feature_layer −2, estrategia "default" = sin CLS; proyector GELU 1024 → 4096 → 4096 con sesgo; texto lmsys/vicuna-7b-v1.5 = Llama 2 7B: 32 capas, 4096, 32 cabezas MHA, FFN 11,008, contexto 4,096; vocab 32,064 = 32,000 + <image> + <pad> + relleno a múltiplo de 64; sin atar).' }),
    'llava15-13b': Object.assign({}, LLAVA_BASE, { label: 'LLaVA-1.5 13B', llmLabel: 'Vicuna-13B v1.5', llmFamily: 'Llama 2',
      D: 5120, L: 40, h: 40, G: 40, dh: 128, Dmlp: 13824, V: 32064, hf: 'llava-hf/llava-1.5-13b-hf',
      source: LLAVA_SRC + 'llava-hf/llava-1.5-13b-hf (misma torre CLIP ViT-L/14 @ 336 y proyector 1024 → 5120 → 5120; texto Vicuna-13B v1.5 = Llama 2 13B: 40 capas, 5120, 40 cabezas MHA, FFN 13,824; vocab 32,064).' }),
  };

  function llavaApply(c, ov) {
    const notes = [];
    ['T', 'images'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    if (c.images > 1) {
      notes.push(c.images + ' imágenes: la torre de visión y el proyector corren ' + c.images + ' veces (op.repeat × ' + c.images + '; formas por imagen) y el prompt lleva ' + fint(c.images * 576) + ' tokens visuales. LLaVA-1.5 se entrenó con una imagen por conversación.');
      c.label += ' · ' + c.images + ' imágenes';
    }
    const S = c.images * (c.H / c.P) * (c.W / c.P) + c.T;
    if (S > c.ctxMax) notes.push('N + T = ' + fint(S) + ' supera el contexto de ' + c.llmLabel + ' (' + fint(c.ctxMax) + '): el conteo es válido, el modelo no.');
    c._notes = notes;
    return c;
  }
  function llavaResolve(c) {
    if (c.H % c.P !== 0 || c.W % c.P !== 0) throw new Error('LLaVA: la imagen ' + c.H + '×' + c.W + ' no es divisible por el patch ' + c.P + '.');
    c.res = c.H;
    c.Np = (c.H / c.P) * (c.W / c.P);
    c.N = c.images * c.Np;
    c.S = c.N + c.T;
    c.tokens = c.S;
    c.dv = c.Dv / c.hv;
    c.visualPerImage = c.Np;
    return c;
  }

  function llavaBuild(c, A) {
    const g = A.graph(c);
    const I = c.images, VE = ['vision-encoder'], WV = ['Encoder de visión (' + c.visionLabel + ')'], TV = 'Visión · ';
    const vop = (id, res, path, extra) => g.op(id, res, Object.assign({ path: VE.concat(path), repeat: I, where: WV }, extra));
    const pi = I > 1 ? ' (por imagen)' : '';
    const img = g.input('pixels', shp(['H', 'W', 'C'], [c.H, c.W, c.C], 'img', 'grid'), { label: 'Imagen de entrada (redimensionada a ' + c.H + '×' + c.W + ')' + pi, tex: 'x' });
    const grid = vop('vis-patch-embed', A.conv2d(img, { k: c.P, s: c.P, cout: c.Dv, coutSym: 'D_v', kSym: 'P', outSym: ['H/P', 'W/P'], bias: false, macTex: 'N_p\\cdot D_v\\cdot P^2\\cdot C' }), ['patch-embed', 'conv'], {
      out: 'v-patch-grid', label: 'Patch embedding (conv P×P, stride P, sin sesgo)', type: 'conv', group: 'embed',
      outMeta: { label: TV + 'rejilla de parches embebidos' + pi, tex: 'X_{\\mathrm{grid}}' } });
    const xp = vop('vis-patch-flatten', A.flatten(grid, { sym: ['N_p', 'D_v'] }), ['patch-embed', 'flatten'], {
      out: 'v-patches', label: 'Aplanar la rejilla', type: 'tensorop', group: 'embed', outMeta: { label: TV + 'parches embebidos' + pi, tex: 'X_p E' } });
    const xc = vop('vis-cls', A.cls_token(xp, { outSym: 'N_p+1' }), ['cls'], {
      out: 'v-cls-cat', label: 'Token CLS (class embedding)', type: 'embed', group: 'embed', outMeta: { label: TV + 'CLS + parches' + pi, tex: '[x_{\\mathrm{cls}};\\,X_p E]' } });
    const ep = vop('vis-pos-embed', A.pos_embed_learned({ rows: c.Np + 1, rowsSym: 'N_p+1', D: c.Dv, Dsym: 'D_v', mod: 'img' }), ['pos-embed'], {
      out: 'v-e-pos', label: 'Position embeddings aprendidos (' + fint(c.Np + 1) + ' × ' + c.Dv + ')', type: 'embed', group: 'embed', outMeta: { label: TV + 'tabla de posición', tex: 'E_{\\mathrm{pos}}' } });
    const x0 = vop('vis-add-pos', A.add(xc, ep), ['add-pos'], { out: 'v-x0', label: 'Suma de posición', type: 'tensorop', group: 'embed', outMeta: { label: TV + 'tokens con posición' + pi, tex: 'x_0' } });
    const xpre = vop('vis-ln-pre', A.layernorm(x0), ['ln-pre'], { out: 'v-ln-pre', label: 'LayerNorm previo (pre_layrnorm de HF)', type: 'norm', group: 'norm',
      outMeta: { label: TV + 'entrada al encoder (tras ln_pre)' + pi, tex: '\\mathrm{LN}_{\\mathrm{pre}}(x_0)' } });
    const Lu = c.Lv - 1;
    const xs = A.preLnLayer(g, xpre, {
      prefix: VE.concat(['enc-layer']), L: Lu * I, h: c.hv, Dmlp: c.Dmlpv, tid: 'v-', oid: 'vis-', where: WV, labelPrefix: TV,
      actLabel: 'QuickGELU', actTex: 'U\\,\\sigma(1.702\\,U)', hSym: 'h_v', dhSym: 'd_v', DmlpSym: '4D_v',
      outMeta: { label: 'salida de la capa ' + Lu + ' (la penúltima: hidden states [−2])' + pi, tex: 'x_{L_v-1}', perLayer: false, note: 'Las features de LLaVA salen de aquí (vision_feature_layer = −2).' },
    });
    // capa 24: HF y el código original la corren (output_hidden_states = True) y la descartan
    const last = A.transformer_block(xs, { h: c.hv, Dmlp: c.Dmlpv, DmlpSym: '4D_v' });
    const xl = vop('vis-last-layer', last, ['last-layer'], {
      out: 'v-x-last', label: 'Capa ' + c.Lv + ' (última): HF la calcula y la descarta', type: 'attn', group: 'attn',
      paramTex: '12D_v^2 + 13D_v', macTex: '(N_p{+}1)\\cdot 12D_v^2 + 2\\,(N_p{+}1)^2 D_v',
      outMeta: { label: TV + 'salida de la última capa (no se usa)' + pi, tex: 'x_{L_v}' } });
    const vc = vop('vis-pool-cls', A.pool_cls(xl), ['ln-post'], { out: 'v-cls', label: 'CLS de la última capa (pooler de HF; no se usa)', type: 'tensorop', group: 'head',
      outMeta: { label: TV + 'CLS de la última capa (no se usa)', tex: 'x_{L_v}^{\\mathrm{cls}}' } });
    vop('vis-ln-post', A.layernorm(vc), ['ln-post'], { out: 'v-cls-ln', label: 'LayerNorm posterior (post_layernorm; no se usa)', type: 'norm', group: 'norm',
      outMeta: { label: TV + 'CLS normalizado (pooler_output; no se usa)', tex: '\\mathrm{LN}_{\\mathrm{post}}' } });
    // penúltima capa sin el CLS
    const vf = g.op('select-layer', A.take_rows(xs, { start: 1, count: c.Np, sym: 'N_p' }), {
      path: ['select-layer'], repeat: I, out: 'vis-feats', where: ['Selección de features'], label: 'Penúltima capa, sin el CLS (' + fint(c.Np) + ' parches)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Features visuales (' + fint(c.Np) + ' × ' + c.Dv + ', penúltima capa sin CLS)' + pi, tex: 'Z_v' } });
    // proyector MLP de 2 capas
    const WP = ['Proyector (MLP de 2 capas, GELU)'], TP = 'Proyector · ';
    const pop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: ['projector', node], repeat: I, where: WP }, extra));
    const ph = pop('proj-fc1', A.linear(vf, { dout: c.D, doutSym: 'D', bias: c.projBias }), 'fc1', { out: 'proj-h', label: 'Proyector: capa 1 (D_v → D)', type: 'mlp', group: 'mlp',
      outMeta: { label: TP + 'capa oculta (D = ' + c.D + ')' + pi, tex: 'Z_vW_1 + b_1' } });
    const pa = pop('proj-gelu', A.gelu(ph), 'gelu', { out: 'proj-act', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: { label: TP + 'activación GELU' + pi, tex: '\\mathrm{GELU}(\\cdot)' } });
    const vt = pop('proj-fc2', A.linear(pa, { dout: c.D, doutSym: 'D', bias: c.projBias }), 'fc2', { out: 'vis-tokens', label: 'Proyector: capa 2 (D → D)', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Tokens visuales en el espacio del LLM (' + fint(c.Np) + ' × ' + c.D + ')' + pi, tex: 'H_v = \\mathrm{MLP}(Z_v)' } });
    textAndSplice(g, c, vt, I);
    importLLM(g, c, null);
    return g;
  }

  // ------------------------------------------------------------------ Qwen2-VL
  const QWEN_SRC = 'Wang et al. 2024 (Qwen2-VL, arXiv:2409.12191), §2.1 y Tabla 1 (ViT de 675M en los tres tamaños); config.json de HF ';
  const QVIT = { P: 14, kt: 2, merge: 2, C: 3, Dv: 1280, Lv: 32, hv: 16, Dmlpv: 5120, visionTheta: 10000, minPixels: 3136, maxPixels: 12845056,
    visionLabel: 'ViT de Qwen2-VL (675M, RoPE 2-D)', mropeSection: [16, 24, 24] };
  const QWEN_BASE = Object.assign({}, QVIT, { H: 812, W: 812, frames: 1, T: 64, eps: 1e-6, ropeTheta: 1000000, ctxMax: 32768, qkvBias: true, causal: false });
  const QWEN = {
    'qwen2-vl-7b': Object.assign({}, QWEN_BASE, { label: 'Qwen2-VL 7B', canonical: true, llmLabel: 'Qwen2-7B', llmFamily: 'Qwen2',
      D: 3584, L: 28, h: 28, G: 4, dh: 128, Dmlp: 18944, V: 152064, tied: false, hf: 'Qwen/Qwen2-VL-7B-Instruct',
      source: QWEN_SRC + 'Qwen/Qwen2-VL-7B-Instruct (texto: hidden 3584, 28 capas, 28 cabezas, 4 KV, FFN 18,944, vocab 152,064, rope_theta 1e6, rms_norm_eps 1e-6, mrope_section [16, 24, 24], sin atar; visión: depth 32, embed_dim 1280, 16 cabezas, mlp_ratio 4, patch 14, temporal_patch_size 2, spatial_merge_size 2, hidden_size 3584) y preprocessor_config.json (min_pixels 3,136, max_pixels 12,845,056). Imagen por defecto 812×812 → 29·29 = 841 tokens visuales.' }),
    'qwen2-vl-2b': Object.assign({}, QWEN_BASE, { label: 'Qwen2-VL 2B', llmLabel: 'Qwen2-1.5B', llmFamily: 'Qwen2',
      D: 1536, L: 28, h: 12, G: 2, dh: 128, Dmlp: 8960, V: 151936, tied: true, hf: 'Qwen/Qwen2-VL-2B-Instruct',
      source: QWEN_SRC + 'Qwen/Qwen2-VL-2B-Instruct (texto: hidden 1536, 28 capas, 12 cabezas, 2 KV, FFN 8,960, vocab 151,936, embeddings ATADOS (tie_word_embeddings true); misma torre de visión con merger → 1536).' }),
    'qwen2-vl-72b': Object.assign({}, QWEN_BASE, { label: 'Qwen2-VL 72B', llmLabel: 'Qwen2-72B', llmFamily: 'Qwen2',
      D: 8192, L: 80, h: 64, G: 8, dh: 128, Dmlp: 29568, V: 152064, tied: false, hf: 'Qwen/Qwen2-VL-72B-Instruct',
      source: QWEN_SRC + 'Qwen/Qwen2-VL-72B-Instruct (texto: hidden 8192, 80 capas, 64 cabezas, 8 KV, FFN 29,568, vocab 152,064, sin atar; misma torre de visión con merger → 8192).' }),
  };

  // Redondeo de Python (round: mitad al par), como smart_resize del procesador de Qwen2-VL.
  function pyRound(x) {
    const f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  }
  // smart_resize de Qwen2VLImageProcessor: lados múltiplos de factor (28), área en [minPixels, maxPixels], aspecto ≈.
  function smartResize(height, width, o) {
    o = o || {};
    const factor = o.factor || 28, minP = o.minPixels || QVIT.minPixels, maxP = o.maxPixels || QVIT.maxPixels;
    if (Math.max(height, width) / Math.min(height, width) > 200) throw new Error('smartResize: relación de aspecto > 200.');
    let h = pyRound(height / factor) * factor, w = pyRound(width / factor) * factor;
    if (h * w > maxP) {
      const beta = Math.sqrt((height * width) / maxP);
      h = Math.floor(height / beta / factor) * factor; w = Math.floor(width / beta / factor) * factor;
    } else if (h * w < minP) {
      const beta = Math.sqrt(minP / (height * width));
      h = Math.ceil(height * beta / factor) * factor; w = Math.ceil(width * beta / factor) * factor;
    }
    return { H: h, W: w };
  }
  // Tokens visuales de Qwen2-VL para una imagen (frames = 1) o un video de F frames ya redimensionado.
  function qwenTokens(H, W, frames) {
    const t = !frames || frames === 1 ? 1 : frames / 2;
    return { patches: t * (H / 14) * (W / 14), tokens: t * (H / 28) * (W / 28), t, gridH: H / 28, gridW: W / 28 };
  }

  function qwenApply(c, ov) {
    const notes = [];
    const H0 = c.H, W0 = c.W;
    ['H', 'W', 'frames', 'T'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    const f = c.P * c.merge;
    if (c.H % f !== 0 || c.W % f !== 0) {
      const r = smartResize(c.H, c.W);
      throw new Error('Qwen2-VL: H y W deben ser múltiplos de 28 (= patch 14 × merge 2); el procesador (smart_resize) llevaría ' + c.H + '×' + c.W + ' a ' + r.H + '×' + r.W + '.');
    }
    if (c.H * c.W < c.minPixels || c.H * c.W > c.maxPixels) throw new Error('Qwen2-VL: H·W = ' + fint(c.H * c.W) + ' fuera de [min_pixels, max_pixels] = [' + fint(c.minPixels) + ', ' + fint(c.maxPixels) + '].');
    if (c.frames !== 1 && c.frames % 2 !== 0) throw new Error('Qwen2-VL: frames debe ser 1 (imagen) o par (video: se agrupan de a 2; el procesador repite el último frame si sobra uno).');
    if (c.H !== H0 || c.W !== W0) c.label += ' · ' + c.H + '×' + c.W;
    if (c.frames > 1) {
      c.label += ' · video de ' + c.frames + ' frames';
      notes.push('Video de ' + c.frames + ' frames (el paper muestrea 2 fps): ' + c.frames / 2 + ' parches temporales; la atención del ViT es por par de frames (cu_seqlens de HF) y el LLM ve (F/2)·(H/28)·(W/28) tokens.');
    }
    const S = qwenTokens(c.H, c.W, c.frames).tokens + c.T;
    if (S > c.ctxMax) notes.push('N + T = ' + fint(S) + ' supera el contexto de ' + fint(c.ctxMax) + ' tokens.');
    c._notes = notes;
    return c;
  }
  function qwenResolve(c) {
    const q = qwenTokens(c.H, c.W, c.frames);
    c.res = c.H;
    c.F = c.frames === 1 ? c.kt : c.frames;   // frames que entran al Conv3d (una imagen se duplica)
    c.t = q.t;
    c.gridH = c.H / c.P; c.gridW = c.W / c.P;
    c.Np = q.patches;
    c.N = q.tokens;
    c.S = c.N + c.T;
    c.tokens = c.S;
    c.dv = c.Dv / c.hv;
    c.visualPerImage = c.frames === 1 ? c.N : c.N;   // una imagen o un video (todo el clip)
    // M-RoPE: la imagen ocupa max(t, H/28, W/28) posiciones (código original; HF 5.19 usa max(H/28, W/28))
    c.imagePosSpan = Math.max(c.t, c.H / 28, c.W / 28);
    c.posSpan = c.T + c.imagePosSpan;
    return c;
  }

  function qwenBuild(c, A) {
    const g = A.graph(c);
    const video = c.frames > 1;
    const VE = ['vision-encoder'], WV = ['Encoder de visión (' + c.visionLabel + ')'], TV = 'Visión · ';
    const WPz = ['Patchify (parches de 2×14×14)'];
    const px = video
      ? g.input('pixels', shp(['F', 'H', 'W', 'C'], [c.frames, c.H, c.W, c.C], 'img', 'grid'), { label: 'Video de entrada (' + c.frames + ' frames de ' + c.H + '×' + c.W + ')', tex: 'x' })
      : g.input('pixels', shp(['H', 'W', 'C'], [c.H, c.W, c.C], 'img', 'grid'), { label: 'Imagen de entrada (' + c.H + '×' + c.W + ', múltiplos de 28)', tex: 'x' });
    let fr = px;
    if (!video) {
      fr = g.op('vis-repeat', A.repeat_frames(px, { k: c.kt, sym: '2' }), {
        path: ['patchify', 'repeat'], out: 'v-frames', where: WPz, label: 'Duplicar la imagen en el tiempo (parche temporal de 2)', type: 'tensorop', group: 'embed',
        outMeta: { label: TV + 'la imagen como 2 frames iguales', tex: '[x;\\,x]' } });
    }
    const grid = g.op('vis-patch-embed', A.patch_embed_3d(fr, { kt: c.kt, k: c.P, cout: c.Dv, coutSym: 'D_v', kSym: 'P', outSym: ['F/2', 'H/P', 'W/P'], squeeze: !video }), {
      path: ['patchify', 'conv3d'], out: 'v-patch-grid', where: WPz, label: 'Patch embedding 3-D (Conv3d 2×14×14, sin sesgo)', type: 'conv', group: 'embed',
      outMeta: { label: TV + 'rejilla de parches embebidos' + (video ? ' (F/2 = ' + c.t + ' parches temporales)' : ''), tex: 'X_{\\mathrm{grid}}' } });
    let xp = g.op('vis-patch-flatten', A.flatten_nd(grid, { sym: ['N_p', 'D_v'] }), {
      path: ['patchify', 'flatten'], out: 'v-patches', where: WPz, label: 'Aplanar (orden por bloques 2×2, como lo deja el procesador)', type: 'tensorop', group: 'embed',
      outMeta: { label: TV + 'parches embebidos (N_p = ' + fint(c.Np) + ')', tex: 'X_p' } });
    if (video) {
      xp = g.op('vis-segment', A.segment_rows(xp, { k: c.t, sym: ['F/2', 'H/P·W/P'] }), {
        path: VE.concat(['segment']), out: 'v-x-seg', where: WV, label: 'Separar por par de frames (la atención no cruza de un par a otro)', type: 'tensorop', group: 'embed',
        outMeta: { label: TV + 'parches por par de frames', tex: 'X_p^{(t)}' } });
    }
    const T = (n) => 'v-' + n;
    const xs = A.preLnLayer(g, xp, {
      prefix: VE.concat(['enc-layer']), L: c.Lv, h: c.hv, Dmlp: c.Dmlpv, tid: 'v-', oid: 'vis-', where: WV, labelPrefix: TV,
      actLabel: 'QuickGELU', actTex: 'U\\,\\sigma(1.702\\,U)', hSym: 'h_v', dhSym: 'd_v', DmlpSym: '4D_v',
      outId: video ? 'v-x-out' : 'vis-feats',
      outMeta: { label: video ? 'salida del ViT por par de frames' : 'Features visuales (salida del ViT, ' + fint(c.Np) + ' × ' + c.Dv + ')', tex: 'Z_v', perLayer: false, note: 'Salida de la capa ' + c.Lv + ' (la última): Qwen2-VL usa todas.' },
      rope: (h, q, k) => [
        h.op('rope2d-q', A.rope_2d(q, { theta: c.visionTheta }), h.at.concat(['rope2d']), { out: T('q-rope'), label: 'RoPE 2-D sobre Q (fila y columna del parche)', type: 'attn', group: 'attn',
          outMeta: h.L({ label: 'Queries rotadas (RoPE 2-D)', tex: '\\mathrm{RoPE}_{2D}(Q)' }) }),
        h.op('rope2d-k', A.rope_2d(k, { theta: c.visionTheta }), h.at.concat(['rope2d']), { out: T('k-rope'), label: 'RoPE 2-D sobre K', type: 'attn', group: 'attn',
          outMeta: h.L({ label: 'Keys rotadas (RoPE 2-D)', tex: '\\mathrm{RoPE}_{2D}(K)' }) }),
      ],
    });
    let vf = xs;
    if (video) {
      vf = g.op('vis-unsegment', A.flatten_nd(xs, { sym: ['N_p', 'D_v'] }), {
        path: VE.concat(['segment']), out: 'vis-feats', where: WV, label: 'Juntar los pares de frames', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Features visuales (salida del ViT, ' + fint(c.Np) + ' × ' + c.Dv + ')', tex: 'Z_v' } });
    }
    // merger: LN por parche → 2×2 vecinos concatenados → MLP 4D_v → 4D_v → D
    const WM = ['Merger (2×2 parches → 1 token)'], TM = 'Merger · ';
    const mop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: ['merger', node], where: WM }, extra));
    const mln = mop('merger-ln', A.layernorm(vf), 'ln', { out: 'v-merge-ln', label: 'LayerNorm por parche (ln_q)', type: 'norm', group: 'norm', outMeta: { label: TM + 'parches normalizados', tex: '\\mathrm{LN}(Z_v)' } });
    const grp = mop('merger-group', A.group_tokens(mln, { k: c.merge * c.merge, sym: 'N', dSym: '4D_v' }), 'group2x2', { out: 'v-grouped', label: 'Agrupar 2×2 parches vecinos (concatenar: 4·D_v)', type: 'tensorop', group: 'embed',
      outMeta: { label: TM + 'bloques 2×2 concatenados (N = ' + fint(c.N) + ' tokens)', tex: '[z_{1};z_{2};z_{3};z_{4}]' } });
    const mh = mop('merger-fc1', A.linear(grp, { dout: c.Dmlpv, doutSym: '4D_v', bias: true }), 'fc1', { out: 'merger-h', label: 'Merger: capa 1 (4D_v → 4D_v)', type: 'mlp', group: 'mlp', outMeta: { label: TM + 'capa oculta', tex: 'ZW_1 + b_1' } });
    const ma = mop('merger-gelu', A.gelu(mh), 'gelu', { out: 'merger-act', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: { label: TM + 'activación GELU', tex: '\\mathrm{GELU}(\\cdot)' } });
    const vt = mop('merger-fc2', A.linear(ma, { dout: c.D, doutSym: 'D', bias: true }), 'fc2', { out: 'vis-tokens', label: 'Merger: capa 2 (4D_v → D)', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Tokens visuales en el espacio del LLM (' + fint(c.N) + ' × ' + c.D + ')', tex: 'H_v' } });
    textAndSplice(g, c, vt, 1);
    g.op('mrope-ids', A.mrope_ids({ S: c.S, sym: 'N+T', span: c.posSpan, note: 'texto: t = h = w; imagen: t, fila y columna en la rejilla ' + c.H / 28 + '×' + c.W / 28 }), {
      path: ['mrope'], out: 'pos-ids', where: ['M-RoPE'], label: 'Ids de posición (t, h, w) de cada token', type: 'embed', group: 'embed',
      outMeta: { label: 'Ids de posición M-RoPE (t, h, w) de los N + T tokens (ocupan ' + fint(c.posSpan) + ' posiciones)', tex: '(p_t, p_h, p_w)' } });
    const sec = c.mropeSection;
    importLLM(g, c, (op, ins) => {
      if (op.id === 'q-proj' || op.id === 'k-proj' || op.id === 'v-proj') {
        const res = A.linear(ins[0], { dout: op.detail.dout, doutSym: op.id === 'q-proj' ? 'D' : 'G·d_h', bias: true });
        return { res, label: op.label.replace(')', ', con sesgo)') };
      }
      if (op.id === 'rope-q' || op.id === 'rope-k') {
        return { res: A.mrope(ins[0], { theta: c.ropeTheta, sections: sec }), in: [ins[0].id, 'pos-ids'],
          label: 'M-RoPE sobre ' + (op.id === 'rope-q' ? 'Q' : 'K') + ' (secciones t/h/w = ' + sec.join('/') + ' de las ' + c.dh / 2 + ' frecuencias, θ = ' + fint(c.ropeTheta) + ')' };
      }
      return null;
    });
    return g;
  }

  // ------------------------------------------------------------------ cantidades y métricas (comunes)
  function parts(c, r) {
    const n = r.totals.byNode, t = r.totals;
    const z = { params: 0, macs: 0 };
    const nd = (id) => n[id] || z;
    const visionParams = nd('vision-encoder').params + nd('patchify').params + nd('select-layer').params;
    const visionMacs = nd('vision-encoder').macs + nd('patchify').macs + nd('select-layer').macs;
    const proj = r.model === 'llava' ? nd('projector') : nd('merger');
    const llmParams = t.params - visionParams - proj.params;
    const llmPrefillMacs = nd('llm').macs + nd('lm-head').macs;
    return { visionParams, visionMacs, projectorParams: proj.params, projectorMacs: proj.macs, llmParams, llmPrefillMacs,
      discardedMacs: nd('last-layer').macs, embedParams: nd('embed').params, lmHeadParams: nd('lm-head').params };
  }

  function quantities(c, r) {
    const p = parts(c, r), t = r.totals;
    const kvTok = 2 * c.L * c.G * c.dh * 2;   // bf16
    const textOnly = llmMacs(c, c.T);
    const fromImage = p.llmPrefillMacs - textOnly;
    const imageMacs = p.visionMacs + p.projectorMacs + fromImage;
    const q = {
      tokens: c.S, visualTokens: c.N, textTokens: c.T, promptTokens: c.S, patches: c.Np, visualTokensPerImage: c.visualPerImage,
      H: c.H, W: c.W, P: c.P, D: c.D, L: c.L, h: c.h, G: c.G, dh: c.dh, Dmlp: c.Dmlp, V: c.V, T: c.T, N: c.N, Np: c.Np, S: c.S,
      Dv: c.Dv, Lv: c.Lv, hv: c.hv, dv: c.dv, Dmlpv: c.Dmlpv, ctxMax: c.ctxMax,
      visualShare: c.N / c.S,
      visionParams: p.visionParams, projectorParams: p.projectorParams, llmParams: p.llmParams, totalParams: t.params,
      visionMacs: p.visionMacs, projectorMacs: p.projectorMacs, llmPrefillMacs: p.llmPrefillMacs, prefillMacs: t.macs,
      visionMacsDiscarded: p.discardedMacs, visionMacsUsed: p.visionMacs - p.discardedMacs,
      llmMacsTextOnly: textOnly, llmMacsFromImage: fromImage, imageMacs, prefillShareFromImage: imageMacs / t.macs,
      kvBytesPerToken: kvTok, kvBytesPerImage: c.visualPerImage * kvTok, kvBytesPrompt: c.S * kvTok,
      embedParams: p.embedParams, lmHeadParams: p.lmHeadParams,
      layerParamsVision: r.ops.filter((o) => o.path[0] === 'vision-encoder' && o.path[1] === 'enc-layer').reduce((s, o) => s + o.params, 0),
      layerParamsLLM: r.ops.filter((o) => o.path[0] === 'llm' && o.path[1] === 'block').reduce((s, o) => s + o.params, 0),
    };
    if (r.model === 'llava') Object.assign(q, { images: c.images, featureLayer: c.Lv - 1 });
    else Object.assign(q, { frames: c.frames, F: c.F, t: c.t, gridH: c.H / 28, gridW: c.W / 28, posSpan: c.posSpan, imagePosSpan: c.imagePosSpan,
      visualModuleParams: p.visionParams + p.projectorParams });
    return q;
  }

  // Roofline ≈ (convenciones de llm.js): TTFT = máx(FLOPs del prefill / pico, bytes / ancho de banda); bytes = todos los
  // pesos leídos una vez (salvo la tabla de embedding: solo sus filas) + filas de embedding + KV cache escrita. Sin overheads.
  function ttft(c, macs, params, embedParams, S, hw, kvTok) {
    const flops = 2 * macs, bytes = (params - embedParams) * 2 + S * c.D * 2 + S * kvTok;
    const tc = flops / hw.peakFlops, tm = bytes / hw.bandwidth;
    return { ms: 1000 * Math.max(tc, tm), bound: tc >= tm ? 'cómputo' : 'memoria', bytes };
  }

  function metrics(c, r, o) {
    const ov = o.overrides || {};
    const bw = ov.bandwidth !== undefined ? ov.bandwidth : HW.bandwidth;
    const peak = ov.peakFlops !== undefined ? ov.peakFlops : HW.peakFlops;
    [['bandwidth', bw], ['peakFlops', peak]].forEach(([k, v]) => { if (!(typeof v === 'number' && v > 0 && isFinite(v))) throw new Error(k + ' debe ser un número positivo.'); });
    const hw = { bandwidth: bw, peakFlops: peak };
    const q = r.quantities, t = r.totals;
    const kvTok = q.kvBytesPerToken;
    const arch = {};
    Object.keys(r.overrides || {}).forEach((k) => { if (k in (A.model(r.model).knobs || {})) arch[k] = r.overrides[k]; });
    const tt = ttft(c, t.macs, t.params, q.embedParams, c.S, hw, kvTok);
    const llmOnlyParams = q.llmParams;
    const tx = ttft(c, q.llmMacsTextOnly, llmOnlyParams, q.embedParams, c.T, hw, kvTok);
    // un paso de decode tras el prompt: la imagen ya está en la KV cache (ctx = N + T + 1)
    const ctx = c.S + 1;
    const dm = llmDecodeMacs(c, ctx);
    const decBytes = (llmOnlyParams - q.embedParams) * 2 + c.D * 2 + ctx * kvTok;
    const decTok = 1 / Math.max(2 * dm / peak, decBytes / bw);
    const out = {
      visualTokens: c.N, visualTokensPerImage: c.visualPerImage, textTokens: c.T, promptTokens: c.S, visualShare: c.N / c.S,
      visionParams: q.visionParams, projectorParams: q.projectorParams, llmParams: q.llmParams, totalParams: t.params,
      visionParamsShare: q.visionParams / t.params,
      visionMacs: q.visionMacs, visionMacsUsed: q.visionMacsUsed, visionMacsDiscarded: q.visionMacsDiscarded, projectorMacs: q.projectorMacs,
      llmPrefillMacs: q.llmPrefillMacs, llmMacsFromImage: q.llmMacsFromImage, llmMacsTextOnly: q.llmMacsTextOnly, prefillMacs: t.macs, imageMacs: q.imageMacs,
      prefillShareFromImage: q.prefillShareFromImage, visionMacsShare: q.visionMacs / t.macs,
      kvBytesPerToken: kvTok, kvBytesPerImage: q.kvBytesPerImage, kvBytesPrompt: q.kvBytesPrompt, weightBytes: 2 * t.params,
      ttftMs: tt.ms, ttftBound: tt.bound, ttftTextOnlyMs: tx.ms, prefillBytes: tt.bytes,
      decodeMacsPerToken: dm, decodeTokPerSecUpperBound: decTok,
      bandwidth: bw, peakFlops: peak, hardwareSource: HW.source,
      crossoverN: c.D + c.G * c.dh + 1.5 * c.Dmlp, scoreToLinear: c.S / (c.D + c.G * c.dh + 1.5 * c.Dmlp),
      units: VLM_UNITS,
    };
    const row = (rr) => {
      const qq = rr.quantities, m2 = ttft(rr.config, rr.totals.macs, rr.totals.params, qq.embedParams, rr.config.S, hw, kvTok);
      return { visualTokens: qq.visualTokens, promptTokens: qq.promptTokens, visualShare: qq.visualShare, visionMacs: qq.visionMacs, llmPrefillMacs: qq.llmPrefillMacs,
        prefillMacs: rr.totals.macs, prefillShareFromImage: qq.prefillShareFromImage, kvBytesPrompt: qq.kvBytesPrompt, ttftMs: m2.ms };
    };
    const at = (o2) => A.run(r.id, Object.assign({}, arch, o2));
    out.textScaling = [16, 64, 256, 1024].map((T) => Object.assign({ T }, row(at({ T }))));
    if (r.model === 'llava') {
      out.imagesScaling = [1, 2, 4, 8].map((images) => Object.assign({ images }, row(at({ images }))));
      out.anyresTokensAt = [[336, 336], [672, 672], [336, 672], [672, 336], [1008, 336], [336, 1008], [480, 640], [1024, 768]].map(([h, w]) => Object.assign({ H: h, W: w }, llavaNextTokens(h, w)));
      out.fixedTokensAt = [224, 336, 448, 672, 1024].map((s) => ({ H: s, W: s, visualTokens: c.Np, note: 'LLaVA-1.5 redimensiona (y rellena) a 336×336: siempre 576' }));
    } else {
      out.posSpan = c.posSpan;
      out.tokensAt = [[224, 224], [448, 448], [672, 672], [812, 812], [1008, 1008], [1344, 1344], [448, 812], [812, 448]].map(([H, W]) => {
        const rr = at({ H, W, frames: 1 });
        return Object.assign({ H, W, patches: rr.config.Np }, row(rr));
      });
      out.framesScaling = [1, 4, 8, 16].map((frames) => Object.assign({ frames }, row(at({ frames }))));
      out.visualModuleParams = q.visualModuleParams;
    }
    return out;
  }

  const VLM_UNITS = {
    visualTokens: 'count', visualTokensPerImage: 'count', textTokens: 'count', promptTokens: 'count', visualShare: 'pct',
    visionParams: 'params', projectorParams: 'params', llmParams: 'params', totalParams: 'params', visualModuleParams: 'params', visionParamsShare: 'pct',
    visionMacs: 'macs', visionMacsUsed: 'macs', visionMacsDiscarded: 'macs', projectorMacs: 'macs', llmPrefillMacs: 'macs', llmMacsFromImage: 'macs',
    llmMacsTextOnly: 'macs', prefillMacs: 'macs', imageMacs: 'macs', prefillShareFromImage: 'pct', visionMacsShare: 'pct',
    kvBytesPerToken: 'bytes', kvBytesPerImage: 'bytes', kvBytesPrompt: 'bytes', weightBytes: 'bytes', prefillBytes: 'bytes',
    ttftMs: 'count', ttftTextOnlyMs: 'count', decodeMacsPerToken: 'macs', decodeTokPerSecUpperBound: 'count', bandwidth: 'count', peakFlops: 'count',
    crossoverN: 'count', scoreToLinear: 'ratio', posSpan: 'count',
    attnMacs: 'macs', scoreMacs: 'macs', linearMacs: 'macs',   // genéricas de ATLAS.Arch.metrics
  };

  // LLaVA-NeXT (AnyRes) con la regla de HF (LlavaNextProcessor._get_number_of_features, rejilla de llava-v1.6):
  // mejor resolución de la rejilla, recortes de 336, tokens sin el relleno + 1 token de salto de línea por fila + 576 de la
  // imagen base reducida. tokensPaper = (recortes + 1)·576 (el conteo del blog/paper, sin quitar relleno ni saltos).
  const PINPOINTS = [[336, 672], [672, 336], [672, 672], [1008, 336], [336, 1008]];
  function llavaNextTokens(height, width) {
    let best = null, maxEff = 0, minWaste = Infinity;
    for (const [h, w] of PINPOINTS) {
      const scale = Math.min(w / width, h / height);
      const dw = Math.trunc(width * scale), dh = Math.trunc(height * scale);
      const eff = Math.min(dw * dh, width * height), waste = w * h - eff;
      if (eff > maxEff || (eff === maxEff && waste < minWaste)) { maxEff = eff; minWaste = waste; best = [h, w]; }
    }
    const ps = 24, sh = best[0] / 336, sw = best[1] / 336;
    let ch = ps * sh, cw = ps * sw;
    if (width / height > cw / ch) {
      const nh = Math.trunc(Number((height * (cw / width)).toFixed(7)));   // int(round(x, 7))
      ch -= 2 * Math.floor((ch - nh) / 2);
    } else {
      const nw = Math.trunc(Number((width * (ch / height)).toFixed(7)));
      cw -= 2 * Math.floor((cw - nw) / 2);
    }
    const crops = sh * sw;
    return { grid: best[0] + '×' + best[1], crops, tokens: ch * cw + ch + 576, tokensPaper: (crops + 1) * 576, unpadded: ch * cw, newlines: ch };
  }

  A.vlm = { smartResize, qwenTokens, llavaNextTokens, pyRound };

  A.defineModel({
    id: 'llava',
    label: 'LLaVA-1.5 (CLIP ViT-L/14 @ 336 + MLP + Vicuna)',
    paper: { title: 'Improved Baselines with Visual Instruction Tuning', authors: 'Liu, Li, Li, Lee', venue: 'CVPR 2024', year: 2024, arxiv: '2310.03744',
      note: 'LLaVA: Liu et al., Visual Instruction Tuning, NeurIPS 2023, arXiv:2304.08485. Torre de visión: CLIP (Radford et al. 2021, arXiv:2103.00020). LLM: Vicuna v1.5 (ajuste de Llama 2, arXiv:2307.09288).' },
    configs: LLAVA,
    knobs: { T: [16, 64, 256, 1024], images: [1, 2, 4] },
    hardware: Object.assign({}, HW),
    applyKnobs: llavaApply, resolve: llavaResolve, build: llavaBuild, quantities, metrics,
  });

  A.defineModel({
    id: 'qwen2-vl',
    label: 'Qwen2-VL (ViT con RoPE 2-D + merger 2×2 + Qwen2 con M-RoPE)',
    paper: { title: "Qwen2-VL: Enhancing Vision-Language Model's Perception of the World at Any Resolution", authors: 'Wang et al. (Qwen Team)', venue: 'arXiv', year: 2024, arxiv: '2409.12191',
      note: 'No confundir con Qwen-VL (Bai et al. 2023, arXiv:2308.12966: 448 fijo + un resampler a 256 tokens). LLM Qwen2: Yang et al. 2024, arXiv:2407.10671.' },
    configs: QWEN,
    knobs: { H: [224, 448, 812, 1344], W: [224, 448, 812, 1344], frames: [1, 4, 16], T: [16, 64, 256, 1024] },
    hardware: Object.assign({}, HW),
    applyKnobs: qwenApply, resolve: qwenResolve, build: qwenBuild, quantities, metrics,
  });
})(typeof window !== 'undefined' ? window : globalThis);
