/* =============================================================================
   Atlas de Arquitecturas — js/arch/diffusion.js
   Modelos `stable-diffusion` (página `stable-diffusion`) y `dit` (página `dit`); contrato SPEC §20. Cargar DESPUÉS de clip.js
   (el encoder de texto de SD 1.5 es la torre de texto de clip-vit-l14, importada con A.importGraph) y de llm.js (hardware del
   roofline). Tesis: generar = deshacer ruido; la red (U-Net o DiT) se entrena con una regresión y se aplica muchas veces.
   - Stable Diffusion: Rombach et al., CVPR 2022, arXiv:2112.10752; SDXL: Podell et al., ICLR 2024, arXiv:2307.01952; DDPM: Ho et al.,
     NeurIPS 2020, arXiv:2006.11239; DDIM: Song et al., ICLR 2021, arXiv:2010.02502; CFG: Ho & Salimans, arXiv:2207.12598.
     Dimensiones = config.json de stable-diffusion-v1-5/stable-diffusion-v1-5 y stabilityai/stable-diffusion-xl-base-1.0.
   - DiT: Peebles & Xie, ICCV 2023, arXiv:2212.09748 (Tabla 1; código oficial facebookresearch/DiT, models.py). Flow matching: Lipman
     et al., ICLR 2023, arXiv:2210.02747; rectified flow: Liu et al., ICLR 2023, arXiv:2209.03003; SD3: Esser et al., ICML 2024, arXiv:2403.03206.
   Cross-check: crosscheck/diffusion.py (diffusers 0.41.0 UNet2DConditionModel / AutoencoderKL / DiTTransformer2DModel y transformers
   CLIPTextModel(WithProjection) construidos en código en el dispositivo META, FlopCounterMode, atención eager): parámetros y FLOPs
   EXACTOS (diferencia 0) en las 9 configs y sus override_checks. DiT: diffusers duplica el embedder de tiempo + clase en cada
   bloque; el JSON resta las copias (= arquitectura oficial; ver notes) — el calculador sigue al oficial.

   ---------------------------------------------------------------- convenciones
   Formas sin batch, rejillas H×W×C (channels-last). Grafo = UNA evaluación de cada componente (no el muestreo entero):
   - sd15-unet / sdxl-unet (inferencia): texto 1× (un prompt) + U-Net 1 NFE (una muestra) + [CFG] + paso del sampler + decoder del VAE
     1×. totals.params = el checkpoint entero (el encoder del VAE, que no corre al muestrear, va como op idle_params `vae-encoder-idle`);
     totals.macs = texto + 1 NFE + decoder (NO es el costo por imagen: ese es metrics().samplingMacs).
   - sd15-train (= knob train: 1): texto + encoder del VAE + ruido + U-Net + MSE; el decoder del VAE va como idle_params.
   - dit-*: solo la red (1 NFE); dit-xl2-256-fm (= knob train: 1): un paso de flow matching (x_t = (1 − t)x₀ + tε, objetivo v = ε − x₀,
     MSE) con la red bajo el nodo `model` y salida de 4 canales (sin Σ).
   - El costo de muestrear (pasos, CFG, lote) solo cambia metrics(): knobs steps, cfg, B no cambian las formas (cfg = 0 quita la op
     cfg-combine y la entrada eps-uncond).
   Símbolos. SD: H, W (imagen), latente H/8 × W/8 × 4 (f = 8, 4 canales: literal), C (= 320, canales base de la U-Net; niveles C, 2C, 4C,
   4C), h (= 8 cabezas fijas en SD 1.5; d_h por nivel = C/h, 2C/h, 4C/h), T (= 77 tokens), V, D_t (ancho del texto: 768 en SD 1.5;
   2,048 = 768 + 1280 en SDXL), h_t / d_t / 4D_t (cabezas, dim. y MLP del encoder de texto de SD 1.5), C_v (= 128, canales base del VAE:
   C_v, 2C_v, 4C_v), tokens de la atención = H/8·W/8 (nivel 1), H/16·W/16…; concatenación de skips 'a+b' (p. ej. 4C+2C).
   SDXL: d_h = 64 fija (cabezas 2C/d_h, 4C/d_h), textos D_1 = 768 / D_2 = 1280 con h_1, h_2, d_1, d_2, 4D_1, 4D_2; '6·256' (time ids).
   DiT: I = lado del latente (res/8), latente I × I × 4, P (patch), N = (I/P)² tokens, D, h, d_h, D_mlp = 4D, L, K (= 1000 clases;
   tabla K + 1 con la clase nula), salida P²·8 (ε y Σ) o P²·4 (flow), 256 (sinusoide del tiempo, literal).
   Práctica (orquestador): factPairs debe sumar C_v, D_t, h_t, d_t, L_t (SD 1.5); d_h, D_1, D_2, h_1, h_2, d_1, d_2 (SDXL); I (DiT).
   Config (campos útiles para {{cfg.*}}): H, W, res, C, h, T, V, Dtxt, Lt, ht, dt, Cv, latentH, latentW, latentC, f, tokens, steps,
   cfg, B, train, sampler, nfe, nfePerStep; DiT: I, P, N, D, L, h, dh, Dmlp, K, outC, learnSigma. OJO: cfg.scaling, cfg.betaStart y
   cfg.cfgScale son decimales y {{cfg.*}} los redondea: usar {{<config>.scaling}} (texto '0.18215'), {{…betaStart}}, {{…cfgScale}}.

   ---------------------------------------------------------------- Stable Diffusion: ids (SPEC §20.1)
   Vista sd-overview (config sd15-unet). Nodo → ops (path) / tensores:
     prompt        tensor prompt-ids (T)
     text-encoder  ops t-tok-embed, t-pos-embed, t-add-pos, capa ×12 (t-ln1, t-qkv, t-split, t-scores, t-scale, t-mask, t-softmax,
                   t-weighted-sum, t-merge, t-proj, t-res1, t-ln2, t-fc1, t-gelu, t-fc2, t-res2; path text-encoder › enc-layer › …),
                   t-ln-final (path text-encoder › ln-final) → text-emb (T × D_t). SDXL: te1-… y te2-… (path text-encoder › te1|te2 ›
                   {tok-embed, pos-embed, add-pos, enc-layer › … (L − 1 capas), last-layer, ln-final, pick-eot, text-proj}) + text-concat
                   (text-encoder › concat) → text-emb; te2-text-proj → text-pooled (1280).
     noise         tensor z-t (H/8 × W/8 × 4) [+ timestep (1)]
     unet          todo lo de path unet › … (abajo) → eps-hat (H/8 × W/8 × 4)
     scheduler     cfg-combine (scheduler › cfg; entradas eps-uncond, eps-hat → eps-guided; solo con cfg = 1), scheduler-step
                   (scheduler › step; z-t, eps-guided|eps-hat → z-prev). Arista de control scheduler → unet: tensor z-prev.
     vae-decoder   vd-unscale (÷0.18215) → vd-z, vd-post-quant → vd-pq, vd-conv-in → vd-h-in, vd-mid (vd-mid-res1, vd-mid-attn, vd-mid-res2),
                   vd-up-1..4 (vd-u{k}-res{1..3}, vd-u{k}-up › {upsample, conv} salvo el último), vd-conv-out › {gn, silu, conv} → image
     image         tensor image (H × W × 3)
     (vae-encoder  op vae-encoder-idle: solo parámetros)
   Vista sd-training (config sd15-train): image (entrada) → vae-encoder (ve-conv-in, ve-down-1..4 › ve-d{k}-res{1,2}, ve-d{k}-down,
     ve-mid, ve-conv-out › {gn, silu, conv} → ve-h-out, ve-quant → ve-moments (H/8 × W/8 × 8), ve-sample → ve-z, ve-scale → z0) →
     add-noise (op add-noise, path add-noise; entradas z0, eps, timestep) → z-t → unet → eps-hat → loss (op loss, path loss; entradas
     eps-hat, eps) → loss (1). vae-decoder: op vae-decoder-idle.
   Vista sd-unet: nodos (path[1]) conv-in, time-embed, down-1..4, mid, up-1..4, conv-out. Tensores de las aristas:
     z-t → conv-in → h-in (H/8×W/8×C) → down-1 → d1-down-out → down-2 → d2-down-out → down-3 → d3-down-out → down-4 → d4-res2-out →
     mid → mid-res2-out → up-1 → u1-up-out → up-2 → u2-up-out → up-3 → u3-up-out → up-4 → u4-attn3-out → conv-out → eps-hat.
     time-embed: temb-freq (t-freq, C), temb-fc1 (t-h, 4C), temb-silu (t-act), temb-fc2 → temb (4C) → cada ResNet (arista de control).
     Skips (cfg.skipMap = [{to, tensor, level}]: 3 por nivel de subida, del más profundo al más alto): up-1 ← d4-res2-out, d4-res1-out,
     d3-down-out; up-2 ← d3-attn2-out, d3-attn1-out, d2-down-out; up-3 ← d2-attn2-out, d2-attn1-out, d1-down-out; up-4 ← d1-attn2-out,
     d1-attn1-out, h-in. Para UNA arista skip por nivel: down-1→up-4 d1-attn2-out (64×64×320), down-2→up-3 d2-attn2-out,
     down-3→up-2 d3-attn2-out, down-4→up-1 d4-res2-out. El skip entra por la op uk-cat{i} (path unet › up-k › uk-res{i} › cat) → uk-cat{i}.
     Dentro de cada nivel (path[2] = bloque, ids ÚNICOS): dk-res{1,2}, dk-attn{1,2} (k ≤ 3 en SD 1.5; k ≥ 2 en SDXL), dk-down (k < nL);
     mid-res1, mid-attn, mid-res2; uk-res{1..3}, uk-attn{1..3}, uk-up › {upsample, conv} (ops uk-upsample, uk-up-conv). Salida de cada
     bloque: <bloque>-out (ResNet y transformer), dk-down-out, uk-up-out.
   Expansión sd-resblock (nodos = path[3]; cada nodo hoja existe en los 22 ResNet: usar `scope: '<bloque>'`, p. ej. 'd2-res1' — el
     primero con atajo 1×1 — o 'd1-res1'): gn1, silu1, conv1, time-proj (ops <b>-temb-act, <b>-time-proj, <b>-time-add), gn2, silu2,
     conv2, skip (conv 1×1 solo si cambian los canales), res (la suma). Tensores <b>-h-gn1, -h-act1, -h-conv1, -e-act, -e-proj (C_out),
     -h-time, -h-gn2, -h-act2, -h-conv2, -skip, -out.
   Expansión sd-transformer-block (scope p. ej. 'd1-attn1'): gn, proj-in (ops <b>-proj-in conv 1×1 y <b>-flatten; SDXL: flatten y
     Linear), norm1, self-attn › {q, k, v, split, scores, scale, softmax, weighted-sum, merge, out} (ops <b>-sa-q … <b>-sa-wsum,
     <b>-sa-merge, <b>-sa-out), res1, norm2, cross-attn › {mismos} (ops <b>-ca-…; K y V de text-emb), res2, norm3, ff-geglu › {proj,
     geglu, out} (ops <b>-ff-proj, <b>-ff-geglu, <b>-ff-out), res3, proj-out (ops <b>-to-grid, <b>-proj-out), res. Tensores <b>-h-gn,
     -h-in, -x0 (tokens H/8·W/8 × C), -h-n1, -sa-q/k/v, -sa-qh/kh/vh, -sa-scores (h × N × N), -sa-scaled, -sa-attn, -sa-zh, -sa-z,
     -sa-o, -r1, -h-n2, -ca-… (scores h × N × T), -r2, -h-n3, -ff-h (N × 8C), -ff-g (N × 4C), -ff-o, -x-out, -h-grid, -h-out, -out.
     SDXL: los bloques transformer de un Transformer2DModel son idénticos → op.repeat = 2 / 10 (badge ×depth).
   ---------------------------------------------------------------- DiT: ids (SPEC §20.2)
   Vista dit-overview: latent = tensor x-t (I × I × 4); patchify (ops patchify [conv], patch-flatten [flatten]) → x-patch-grid
     (I/P × I/P × D), x-patches (N × D); pos-embed (ops pos-embed [table] → e-pos, add-pos [add] → h0); blocks › block (×L) → x-out;
     final-layer (ops final-adaln [path final-layer › adaln-final] → final-beta, final-gamma; final-norm [norm] → h-final-norm;
     final-modulate [modulate] → h-final-mod; final-linear [linear] → h-final (N × P²·8)); unpatchify (op unpatchify) → out (I × I × 8);
     out (op split-out) → eps-hat, sigma (I × I × 4). Condición: timestep (tensor) → t-embed (temb-freq → t-freq (256), temb-fc1 → t-h,
     temb-silu → t-act, temb-fc2 → t-emb (D)); class (tensor) → y-embed (op y-embed, tabla (K+1)×D) → y-emb; cond (op cond) → c (D),
     que entra a cada bloque (op adaln) y a final-adaln (aristas de control).
   Expansión dit-block (path blocks › block › …, repeat L): adaln (op adaln → beta1, gamma1, alpha1, beta2, gamma2, alpha2: orden
     shift, scale, gate del código), norm1 (LN sin γ, β) → h-norm1, modulate1 → h-mod1, attn › {qkv, split, scores, scale, softmax,
     weighted-sum, merge, proj} → qkv, q, k, v, scores, scores-scaled, attn, z-heads, z, o; gate1 → o-gated; res1 → r1; norm2 → h-norm2;
     modulate2 → h-mod2; mlp › {fc1, gelu, fc2} → u, g, f; gate2 → f-gated; res2 → x-out. node.adaln = SOLO los L bloques (la capa
     final es node adaln-final).
   Vista flow-matching (config dit-xl2-256-fm): x0 (tensor), eps (tensor), interp (op interp; x0, eps, timestep → x-t), model (path
     model › … = toda la red; node.model = sus parámetros y MACs) → v-hat (I × I × 4), v-target (op v-target; x0, eps → v-target),
     loss (op loss; v-hat, v-target → loss).

   ---------------------------------------------------------------- desviaciones respecto de SPEC §20 (nada renombrado)
   - Configs añadidas: sd15-train (grafo de entrenamiento para sd-training) y dit-xl2-256-fm (flow matching, sin Σ), además de
     sdxl-unet (opcional en la SPEC). Knob extra train (1) en los dos modelos.
   - Knob cfg acepta 0 (def.zeroKnobs, nuevo en primitives.resolve); knobs de DiT: res, patch (→ cfg.P), steps, cfg, B, train.
   - Nodos extra: U-Net `res` (suma residual del ResNet y del transformer), gn, proj-in, proj-out, res1–res3 en el transformer;
     cat (concatenar el skip) en los ResNet de subida; time-embed › add-embed (SDXL); DiT pos-embed › {table, add}, final-layer ›
     {adaln-final, norm, modulate, linear}; vae-encoder / vae-decoder con nodos internos prefijados ve- / vd- (vd-mid, vd-up-k…) para no
     chocar con los de la U-Net en byNode.
   - Tensores añadidos (todos los de arriba); SD usa z (z-t, z0, z-prev) como el paper de LDM; DiT usa x (x-t, x0).
   - El grafo es UNA evaluación de cada componente (ver convenciones); el muestreo entero está en metrics().
   - DiT sigue al código oficial (un t_embedder / y_embedder; qkv fusionado); la posición sin/cos es buffer (el oficial la guarda como
     nn.Parameter congelado: metrics().officialParams = params + N·D = 675,129,632 para XL/2, los «675M» del paper).
   - Los 118.6 «Gflops» de la Tabla 4 del paper (DiT-XL/2 @ 256) son MACs: el calculador da 118.62 GMACs (quantities.macsVsPaper).

   ---------------------------------------------------------------- metrics() (unidades en metrics.units)
   Comunes: samplingMacs (MACs POR IMAGEN = pasos × (1 + cfg) × red + (1 + cfg) × texto + decoder del VAE; DiT sin texto), samplingMacsNoCfg,
   denoiserSamplingMacs, denoiserSamplingShare, vaeDecoderShare, textEncoderShare (pct), steps, nfePerStep, nfe, textPasses (count),
   cfgCostFactor (ratio), vaeDecoderMacs, vaeEncoderMacs, textEncoderMacs (macs), vaeParams, vaeEncoderParams, vaeDecoderParams,
   textEncoderParams, totalParams (params), latentShape (texto '64×64×4'), latentH, latentW, latentTokens, latentValues, pixelValues
   (count), compressionFactor (ratio: 48 = píxeles / valores del latente), spatialFactor (ratio: 8); roofline ≈ (hardware de llm.js,
   H100 SXM, entradas bandwidth / peakFlops): samplingMs, msPerImage, vaeDecodeMs (ms), imagesPerSecUpperBound (count), denoiserIntensity,
   ridgePoint (ratio), weightBytes (bytes), bandwidth, peakFlops (count), hardwareSource; listas stepsScaling, cfgScaling, resScaling.
   SD: unetMacs (macs, 1 NFE), unetParams, unetParamsShare, trainForwardMacs, trainStepMacsApprox (≈ texto + encoder + 3 × U-Net),
   attnMacsUnet, selfAttnScoreMacs, crossAttnScoreMacs, convMacs, transformerMacs, resnetMacs (macs), attnShareUnet, selfScoreShareUnet,
   convShare, transformerShare (pct), selfAttnTokens, selfAttnHeads (count: la self-attention más grande), selfAttnScoreBytes (bytes,
   bf16, un bloque), unetNfeMs, textEncoderMs (ms), unetNfeUs (count), unetBound; listas attnByLevel [{level, grid, tokens, channels, macs,
   attnMacs, selfScoreMacs, crossScoreMacs, hasAttention, attnShareOfLevel, shareOfUnet}], attnShareAt, resScaling (unetMacsVsBase…).
   DiT: ditMacs (macs), ditParams, officialParams, diffusersParams, embedderParams, blockParams, adalnParams (params), adalnParamsShare,
   adalnParamsShareBlock (pct), diffusersMacs, tEmbedMacs, scoreMacsDit (macs), scoreShareDit (pct), paperGflops, macsVsPaper (ratio;
   solo dit-xl2-256), ditNfeMs (ms), ditNfeUs (count), ditBound; listas patchScaling, resScaling, stepsScaling, cfgScaling.
   Revisión de la fase 8:
   - Unidad 'ms' (milisegundos, decimales): unetNfeMs, ditNfeMs, textEncoderMs, vaeDecodeMs, samplingMs, msPerImage. quantities.js
     escribe SOLO el número con 3 cifras significativas ('1.62', '2.54', '83.8', '121'); la prosa pone ' ms' detrás.
   - sequentialPasses (count) = steps: pasadas SECUENCIALES de la red por imagen. Con CFG las 2 evaluaciones de un paso van en UNA
     llamada de batch 2, así que nfe = steps × (1 + cfg) evaluaciones pero solo steps pasadas en serie (latencia ∝ steps).
   - freqCount (count; también en quantities) = frecuencias del embedding sinusoidal del paso: C/2 = 160 en SD 1.5 (320 canales =
     cos y sin), freqDim/2 = 128 en DiT (256 canales).
   - DiT, costo POR IMAGEN (para el pill / costNote del bloque): samplingMacs (red × nfe + decoder del VAE; XL/2 @ 256 con 250 pasos y
     CFG: 59.62 TMACs), denoiserSamplingMacs (solo la red × nfe: 59.31 TMACs), nfe (500), blockMacs (macs: UN bloque, una NFE: 4.24
     GMACs), blocksMacs (los L bloques, una NFE: 118.60 GMACs), blocksSamplingMacs (los L bloques × nfe: 59.30 TMACs).
   - blockParams / adalnParamsShareBlock también en dit-xl2-256-fm (path model › blocks › …): 23,905,152 y 33.3 %.
   ATLAS.Arch.diffusion = {betas, alphasCumprod(kind, T, β₀, β₁), schedule(configId) → {alphasCumprod, snr…}, ddimTimesteps(n),
   pndmNfe(n)} (verificados contra diffusers en el JSON de sd15-unet: schedule_checks).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('diffusion.js necesita js/arch/primitives.js antes.');
  if (!A.hasConfig || !A.hasConfig('clip-vit-l14')) throw new Error('diffusion.js necesita js/arch/clip.js antes (compone su encoder de texto).');
  if (!A.hasConfig('llama3-8b')) throw new Error('diffusion.js necesita js/arch/llm.js antes (hardware y convenciones del roofline).');
  const HW = A.model('llm').hardware;   // H100 SXM (≈, entradas explícitas), mismas convenciones que llm.js
  const fint = (n) => A.fmt.int(n);
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const msym = (m, base) => (m === 1 ? base : m + base);           // 2·C → '2C'

  // ================================================================== bloques comunes (U-Net y VAE)
  // Bloque ResNet (ResnetBlock2D de diffusers). o = {id, path, where, tag, cout, coutSym, temb (handle del embedding del
  // tiempo, o null en el VAE), mod}. Ops (id-…): gn1 silu1 conv1 [temb-act time-proj time-add] gn2 silu2 conv2 [skip] res;
  // nodos (path …, id, nodo): gn1 silu1 conv1 time-proj gn2 silu2 conv2 skip res. Salida: o.outId || id-out.
  function resnet(g, x, o) {
    const id = o.id, P = o.path, cin = x.num[2], cout = o.cout, cs = o.coutSym, tag = o.tag;
    const gs = [x.sym[0], x.sym[1]];
    const op = (sub, node, res, extra) => g.op(id + '-' + sub, res, Object.assign({ path: P.concat([node]), where: o.where }, extra));
    const M = (label, tex) => ({ label: tag + ' · ' + label, tex });
    const h1 = op('gn1', 'gn1', A.group_norm(x, { groups: 32 }), { out: id + '-h-gn1', label: 'GroupNorm 1 (32 grupos)', type: 'norm', group: 'norm', outMeta: M('tras GroupNorm 1', '\\mathrm{GN}(x)') });
    const a1 = op('silu1', 'silu1', A.silu(h1), { out: id + '-h-act1', label: 'SiLU', type: 'mlp', group: 'act', outMeta: M('tras SiLU 1', '\\mathrm{SiLU}(\\cdot)') });
    let h = op('conv1', 'conv1', A.conv2d(a1, { k: 3, s: 1, p: 1, cout, coutSym: cs, outSym: gs }), {
      out: id + '-h-conv1', label: 'Conv 3×3 (' + fint(cin) + ' → ' + fint(cout) + ')', type: 'conv', group: 'conv', outMeta: M('tras conv 1 (' + fint(cout) + ' canales)', 'h_1') });
    if (o.temb) {
      const ea = op('temb-act', 'time-proj', A.silu(o.temb), { out: id + '-e-act', label: 'SiLU del embedding del tiempo', type: 'mlp', group: 'act',
        outMeta: M('SiLU del embedding del tiempo', '\\mathrm{SiLU}(e_t)') });
      const ep = op('time-proj', 'time-proj', A.linear(ea, { dout: cout, doutSym: cs }), {
        out: id + '-e-proj', label: 'Proyección del tiempo (Linear ' + o.temb.sym[0] + ' → ' + cs + ')', type: 'embed', group: 'embed',
        outMeta: M('tiempo proyectado a ' + fint(cout) + ' canales', 'W_t\\,\\mathrm{SiLU}(e_t) + b_t') });
      h = op('time-add', 'time-proj', A.add_broadcast(h, ep), { out: id + '-h-time', label: 'Sumar el tiempo (por canal, en cada posición)', type: 'tensorop', group: 'resid',
        outMeta: M('features + tiempo', 'h_1 + W_t e_t') });
    }
    const h2 = op('gn2', 'gn2', A.group_norm(h, { groups: 32 }), { out: id + '-h-gn2', label: 'GroupNorm 2 (32 grupos)', type: 'norm', group: 'norm', outMeta: M('tras GroupNorm 2', '\\mathrm{GN}(h)') });
    const a2 = op('silu2', 'silu2', A.silu(h2), { out: id + '-h-act2', label: 'SiLU', type: 'mlp', group: 'act', outMeta: M('tras SiLU 2', '\\mathrm{SiLU}(\\cdot)') });
    const c2 = op('conv2', 'conv2', A.conv2d(a2, { k: 3, s: 1, p: 1, cout, coutSym: cs, outSym: gs }), {
      out: id + '-h-conv2', label: 'Conv 3×3 (' + fint(cout) + ' → ' + fint(cout) + ')', type: 'conv', group: 'conv', outMeta: M('tras conv 2', 'h_2') });
    let sk = x;
    if (cout !== cin) {
      sk = op('skip', 'skip', A.conv2d(x, { k: 1, cout, coutSym: cs, outSym: gs }), {
        out: id + '-skip', label: 'Atajo: conv 1×1 (' + fint(cin) + ' → ' + fint(cout) + ')', type: 'conv', group: 'conv', outMeta: M('atajo proyectado (conv 1×1)', 'W_s x') });
    }
    return op('res', 'res', A.residual_add(sk, c2), { out: o.outId || id + '-out', label: 'Suma residual (atajo + rama)', type: 'tensorop', group: 'resid',
      outMeta: M('salida del bloque ResNet', 'x + h_2') });
  }

  // Atención de diffusers (Attention con AttnProcessor): W_Q, W_K, W_V (sesgo según bias), W_O con sesgo. ids pre-…, nodos
  // node › {q, k, v, split, scores, scale, softmax, weighted-sum, merge, out}. o = {op, T (ids de tensor), C, cs, h, hSym,
  // dhSym, bias, tag, what, rep}
  function attention(xq, xkv, o) {
    const { op, T, C, cs, pre, node, tag, what } = o;
    const M = (label, tex) => ({ label: tag + ' · ' + what + ': ' + label, tex, perLayer: (o.rep || 1) > 1 });
    const cross = xkv !== xq;
    const lin = (x, b) => A.linear(x, { dout: C, doutSym: cs, bias: b });
    const q = op(pre + '-q', [node, 'q'], lin(xq, !!o.bias), { out: T(pre + '-q'), label: 'W_Q' + (o.bias ? '' : ' (sin sesgo)'), type: 'embed', group: 'attn', outMeta: M('queries', 'Q') });
    const k = op(pre + '-k', [node, 'k'], lin(xkv, !!o.bias), { out: T(pre + '-k'), label: 'W_K' + (o.bias ? '' : ' (sin sesgo)') + (cross ? ' sobre el texto' : ''), type: 'embed', group: 'attn',
      outMeta: M('keys' + (cross ? ' (del texto)' : ''), 'K') });
    const v = op(pre + '-v', [node, 'v'], lin(xkv, !!o.bias), { out: T(pre + '-v'), label: 'W_V' + (o.bias ? '' : ' (sin sesgo)') + (cross ? ' sobre el texto' : ''), type: 'embed', group: 'attn',
      outMeta: M('values' + (cross ? ' (del texto)' : ''), 'V') });
    const [qh, kh, vh] = op(pre + '-split', [node, 'split'], A.split_qkv_heads(q, k, v, { h: o.h, hSym: o.hSym, dhSym: o.dhSym }), {
      out: [T(pre + '-qh'), T(pre + '-kh'), T(pre + '-vh')], label: 'Separar en ' + o.h + (o.h === 1 ? ' cabeza' : ' cabezas'), type: 'tensorop', group: 'attn',
      outMeta: [M('queries por cabeza', 'Q_i'), M('keys por cabeza', 'K_i'), M('values por cabeza', 'V_i')] });
    const sc = op(pre + '-scores', [node, 'scores'], A.attention_scores(qh, kh), { out: T(pre + '-scores'), label: 'Producto QKᵀ' + (cross ? ' (imagen × texto)' : ''), type: 'attn', group: 'attn',
      outMeta: M('scores', 'QK^\\top') });
    const sl = op(pre + '-scale', [node, 'scale'], A.scale(sc), { out: T(pre + '-scaled'), label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: M('scores escalados', 'QK^\\top/\\sqrt{d_h}') });
    const sm = op(pre + '-softmax', [node, 'softmax'], A.softmax(sl), { out: T(pre + '-attn'), label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: M('pesos de atención', 'A') });
    const zh = op(pre + '-wsum', [node, 'weighted-sum'], A.attention_weighted_sum(sm, vh), { out: T(pre + '-zh'), label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: M('salida por cabeza', 'AV') });
    const z = op(pre + '-merge', [node, 'merge'], A.merge_heads(zh, { Dsym: cs }), { out: T(pre + '-z'), label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: M('cabezas concatenadas', 'Z') });
    return op(pre + '-out', [node, 'out'], A.linear(z, { dout: C, doutSym: cs }), { out: T(pre + '-o'), label: 'W_O (con sesgo)', type: 'embed', group: 'attn', outMeta: M('salida', 'ZW_O + b') });
  }

  // Bloque transformer de la U-Net (Transformer2DModel + BasicTransformerBlock ×depth). o = {id, path, where, tag, m (múltiplo
  // de C), h, hSym, dhSym, depth=1, linearProj=false, outId}. Ops (id-…): gn proj-in flatten | flatten proj-in, [×depth: norm1,
  // sa-{q,k,v,split,scores,scale,softmax,wsum,merge,out}, res1, norm2, ca-{…}, res2, norm3, ff-proj, ff-geglu, ff-out, res3],
  // to-grid proj-out | proj-out to-grid, res. Nodos: gn, proj-in, norm1, self-attn › …, res1, norm2, cross-attn › …, res2,
  // norm3, ff-geglu › {proj, geglu, out}, res3, proj-out, res.
  function xformer(g, x, text, o) {
    const [H, W, C] = x.num, cs = x.sym[2], ts = x.sym[0] + '·' + x.sym[1], gs = [x.sym[0], x.sym[1]];
    const id = o.id, P = o.path, tag = o.tag, rep = o.depth || 1;
    const T = (n) => id + '-' + n;
    const op = (sub, node, res, extra) => g.op(T(sub), res, Object.assign({ path: P.concat(Array.isArray(node) ? node : [node]), where: o.where }, extra));
    const bop = (sub, node, res, extra) => op(sub, node, res, Object.assign({ repeat: rep }, extra));
    const M = (label, tex, per) => ({ label: tag + ' · ' + label, tex, perLayer: !!per && rep > 1 });
    const gn = op('gn', 'gn', A.group_norm(x, { groups: 32, eps: 1e-6 }), { out: T('h-gn'), label: 'GroupNorm (32 grupos)', type: 'norm', group: 'norm', outMeta: M('tras GroupNorm', '\\mathrm{GN}(x)') });
    let seq;
    if (!o.linearProj) {
      const pin = op('proj-in', 'proj-in', A.conv2d(gn, { k: 1, cout: C, coutSym: cs, outSym: gs }), { out: T('h-in'), label: 'proj_in: conv 1×1 (' + fint(C) + ' → ' + fint(C) + ')', type: 'conv', group: 'conv',
        outMeta: M('tras proj_in (conv 1×1)', 'W_{in} * \\mathrm{GN}(x)') });
      seq = op('flatten', 'proj-in', A.flatten(pin, { sym: [ts, cs] }), { out: T('x0'), label: 'Rejilla → secuencia de tokens', type: 'tensorop', group: 'embed',
        outMeta: M('tokens (' + fint(H * W) + ' = ' + H + '×' + W + ' posiciones)', 'X') });
    } else {
      const fl = op('flatten', 'proj-in', A.flatten(gn, { sym: [ts, cs] }), { out: T('h-seq'), label: 'Rejilla → secuencia de tokens', type: 'tensorop', group: 'embed',
        outMeta: M('tokens normalizados (' + fint(H * W) + ' posiciones)', '\\mathrm{GN}(x)') });
      seq = op('proj-in', 'proj-in', A.linear(fl, { dout: C, doutSym: cs }), { out: T('x0'), label: 'proj_in: Linear (' + fint(C) + ' → ' + fint(C) + ')', type: 'embed', group: 'embed',
        outMeta: M('tokens tras proj_in', 'X') });
    }
    const att = (pre, node, xq, xkv, what) => attention(xq, xkv, { op: bop, T, C, cs, pre, node, tag, what, h: o.h, hSym: o.hSym, dhSym: o.dhSym, bias: false, rep });
    const n1 = bop('norm1', 'norm1', A.layernorm(seq), { out: T('h-n1'), label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: M('tras LayerNorm 1', '\\mathrm{LN}_1(X)', 1) });
    const sa = att('sa', 'self-attn', n1, n1, 'self-attention');
    const r1 = bop('res1', 'res1', A.residual_add(seq, sa), { out: T('r1'), label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: M('X + self-attention', "X'", 1) });
    const n2 = bop('norm2', 'norm2', A.layernorm(r1), { out: T('h-n2'), label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: M('tras LayerNorm 2', "\\mathrm{LN}_2(X')", 1) });
    const ca = att('ca', 'cross-attn', n2, text, 'cross-attention');
    const r2 = bop('res2', 'res2', A.residual_add(r1, ca), { out: T('r2'), label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: M('+ cross-attention', "X''", 1) });
    const n3 = bop('norm3', 'norm3', A.layernorm(r2), { out: T('h-n3'), label: 'LayerNorm 3', type: 'norm', group: 'norm', outMeta: M('tras LayerNorm 3', "\\mathrm{LN}_3(X'')", 1) });
    const m = o.m;
    const fp = bop('ff-proj', ['ff-geglu', 'proj'], A.linear(n3, { dout: 8 * C, doutSym: msym(8 * m, 'C') }), { out: T('ff-h'), label: 'FF GEGLU: Linear ' + cs + ' → ' + msym(8 * m, 'C') + ' (valor y compuerta)', type: 'mlp', group: 'mlp',
      outMeta: M('FF: valor y compuerta (2·' + fint(4 * C) + ')', '[H;\\,G] = XW_1 + b_1', 1) });
    const fg = bop('ff-geglu', ['ff-geglu', 'geglu'], A.geglu(fp, { outSym: msym(4 * m, 'C') }), { out: T('ff-g'), label: 'GEGLU: H ⊙ GELU(G)', type: 'mlp', group: 'mlp',
      outMeta: M('FF: tras GEGLU (' + fint(4 * C) + ')', 'H\\odot\\mathrm{GELU}(G)', 1) });
    const fo = bop('ff-out', ['ff-geglu', 'out'], A.linear(fg, { dout: C, doutSym: cs }), { out: T('ff-o'), label: 'FF: Linear ' + msym(4 * m, 'C') + ' → ' + cs, type: 'mlp', group: 'mlp',
      outMeta: M('salida del FF', 'F', 1) });
    const r3 = bop('res3', 'res3', A.residual_add(r2, fo), { out: T('x-out'), label: 'Residual 3', type: 'tensorop', group: 'resid',
      outMeta: M('salida del bloque transformer' + (rep > 1 ? ' (tras los ' + rep + ' bloques)' : ''), "X''' ") });
    let po;
    if (!o.linearProj) {
      const tg = op('to-grid', 'proj-out', A.to_grid(r3, { H, W, sym: gs }), { out: T('h-grid'), label: 'Secuencia → rejilla', type: 'tensorop', group: 'embed', outMeta: M('tokens como rejilla', '\\mathrm{grid}(X)') });
      po = op('proj-out', 'proj-out', A.conv2d(tg, { k: 1, cout: C, coutSym: cs, outSym: gs }), { out: T('h-out'), label: 'proj_out: conv 1×1', type: 'conv', group: 'conv', outMeta: M('tras proj_out (conv 1×1)', 'W_{out} * \\cdot') });
    } else {
      const pl = op('proj-out', 'proj-out', A.linear(r3, { dout: C, doutSym: cs }), { out: T('h-proj'), label: 'proj_out: Linear', type: 'embed', group: 'embed', outMeta: M('tras proj_out', 'XW_{out}') });
      po = op('to-grid', 'proj-out', A.to_grid(pl, { H, W, sym: gs }), { out: T('h-out'), label: 'Secuencia → rejilla', type: 'tensorop', group: 'embed', outMeta: M('salida como rejilla', '\\mathrm{grid}(\\cdot)') });
    }
    return op('res', 'res', A.residual_add(x, po), { out: o.outId || T('out'), label: 'Suma residual (x + transformer)', type: 'tensorop', group: 'resid', outMeta: M('salida del bloque', 'x + \\mathrm{Transformer}(x)') });
  }

  // Atención del VAE (bloque medio): GroupNorm + 1 cabeza sobre las h·w posiciones, Q, K, V y salida con sesgo, + x.
  function vaeAttn(g, x, o) {
    const [H, W, C] = x.num, cs = x.sym[2], ts = x.sym[0] + '·' + x.sym[1], gs = [x.sym[0], x.sym[1]];
    const id = o.id, P = o.path, tag = o.tag;
    const T = (n) => id + '-' + n;
    const op = (sub, node, res, extra) => g.op(T(sub), res, Object.assign({ path: P.concat(Array.isArray(node) ? node : [node]), where: o.where }, extra));
    const M = (label, tex) => ({ label: tag + ' · ' + label, tex });
    const gn = op('gn', 'gn', A.group_norm(x, { groups: 32, eps: 1e-6 }), { out: T('h-gn'), label: 'GroupNorm (32 grupos)', type: 'norm', group: 'norm', outMeta: M('tras GroupNorm', '\\mathrm{GN}(x)') });
    const seq = op('flatten', 'gn', A.flatten(gn, { sym: [ts, cs] }), { out: T('x0'), label: 'Rejilla → secuencia', type: 'tensorop', group: 'embed',
      outMeta: M('tokens (' + fint(H * W) + ' posiciones)', 'X') });
    const ao = attention(seq, seq, { op, T, C, cs, pre: 'sa', node: 'self-attn', tag, what: 'atención (1 cabeza)', h: 1, hSym: '1', dhSym: cs, bias: true });
    const tg = op('to-grid', 'res', A.to_grid(ao, { H, W, sym: gs }), { out: T('h-grid'), label: 'Secuencia → rejilla', type: 'tensorop', group: 'embed', outMeta: M('salida como rejilla', '\\mathrm{grid}(\\cdot)') });
    return op('res', 'res', A.residual_add(x, tg), { out: T('out'), label: 'Suma residual', type: 'tensorop', group: 'resid', outMeta: M('salida del bloque de atención', 'x + \\mathrm{Attn}(x)') });
  }

  // ================================================================== VAE (AutoencoderKL de SD)
  // Encoder: imagen H×W×3 → conv_in → 4 niveles (2 ResNet + downsample asimétrico salvo el último) → medio (ResNet,
  // atención, ResNet) → GN, SiLU, conv_out (4C_v → 8) → quant_conv 1×1 → momentos → z = μ + σε → ×0.18215.
  // Decoder: ÷0.18215 → post_quant_conv 1×1 → conv_in (4 → 4C_v) → medio → 4 niveles (3 ResNet + upsample salvo el último)
  // → GN, SiLU, conv_out (C_v → 3). Prefijos: ve- (encoder) y vd- (decoder) en ops, tensores y nodos.
  function vaeEncoder(g, img, c) {
    const R = ['vae-encoder'], WE = 'Encoder del VAE', vs = (m) => msym(m, 'C_v');
    const gsAt = (d) => (d === 1 ? ['H', 'W'] : ['H/' + d, 'W/' + d]);
    let h = g.op('ve-conv-in', A.conv2d(img, { k: 3, s: 1, p: 1, cout: c.Cv, coutSym: 'C_v', outSym: gsAt(1) }), {
      path: R.concat(['ve-conv-in']), where: [WE], out: 've-h-in', label: 'Conv de entrada 3×3 (3 → ' + c.Cv + ')', type: 'conv', group: 'conv',
      outMeta: { label: 'VAE (encoder) · features tras conv_in', tex: 'h_0' } });
    const lv = c.vaeMult;
    for (let k = 0; k < lv.length; k++) {
      const d = 2 ** k, name = 've-down-' + (k + 1), pre = 've-d' + (k + 1);
      for (let i = 1; i <= c.vaeLayers; i++) {
        h = resnet(g, h, { id: pre + '-res' + i, path: R.concat([name, pre + '-res' + i]), cout: lv[k] * c.Cv, coutSym: vs(lv[k]), temb: null,
          where: [WE, 'nivel ' + (k + 1), 'ResNet ' + i], tag: 'VAE (encoder) · nivel ' + (k + 1) + ' · ResNet ' + i });
      }
      if (k < lv.length - 1) {
        h = g.op(pre + '-down', A.downsample2d(h, { pad: 'asym', outSym: gsAt(2 * d) }), {
          path: R.concat([name, pre + '-down']), where: [WE, 'nivel ' + (k + 1)], out: pre + '-down-out', label: 'Downsample: conv 3×3 stride 2 (relleno 0,1,0,1)', type: 'conv', group: 'conv',
          outMeta: { label: 'VAE (encoder) · nivel ' + (k + 1) + ' · tras el downsample', tex: '\\downarrow 2' } });
      }
    }
    const top = lv[lv.length - 1];
    const MID = R.concat(['ve-mid']), WM = [WE, 'bloque medio'];
    h = resnet(g, h, { id: 've-mid-res1', path: MID.concat(['ve-mid-res1']), cout: top * c.Cv, coutSym: vs(top), temb: null, where: WM.concat(['ResNet 1']), tag: 'VAE (encoder) · medio · ResNet 1' });
    h = vaeAttn(g, h, { id: 've-mid-attn', path: MID.concat(['ve-mid-attn']), where: WM.concat(['atención']), tag: 'VAE (encoder) · medio · atención' });
    h = resnet(g, h, { id: 've-mid-res2', path: MID.concat(['ve-mid-res2']), cout: top * c.Cv, coutSym: vs(top), temb: null, where: WM.concat(['ResNet 2']), tag: 'VAE (encoder) · medio · ResNet 2' });
    const CO = R.concat(['ve-conv-out']);
    const gn = g.op('ve-out-gn', A.group_norm(h, { groups: 32 }), { path: CO.concat(['gn']), where: [WE], out: 've-h-gn', label: 'GroupNorm de salida', type: 'norm', group: 'norm', outMeta: { label: 'VAE (encoder) · tras la GroupNorm final', tex: '\\mathrm{GN}' } });
    const ac = g.op('ve-out-silu', A.silu(gn), { path: CO.concat(['silu']), where: [WE], out: 've-h-act', label: 'SiLU', type: 'mlp', group: 'act', outMeta: { label: 'VAE (encoder) · tras la SiLU final', tex: '\\mathrm{SiLU}' } });
    const mo = g.op('ve-conv-out', A.conv2d(ac, { k: 3, s: 1, p: 1, cout: 2 * c.latentC, coutSym: String(2 * c.latentC), outSym: gsAt(8) }), {
      path: CO.concat(['conv']), where: [WE], out: 've-h-out', label: 'Conv de salida 3×3 (' + top * c.Cv + ' → ' + 2 * c.latentC + ': media y log-varianza)', type: 'conv', group: 'conv',
      outMeta: { label: 'VAE (encoder) · salida de conv_out (2·4 canales)', tex: '[\\mu;\\,\\log\\sigma^2]' } });
    const qm = g.op('ve-quant', A.conv2d(mo, { k: 1, cout: 2 * c.latentC, coutSym: String(2 * c.latentC), outSym: gsAt(8) }), {
      path: R.concat(['ve-quant']), where: [WE], out: 've-moments', label: 'quant_conv: conv 1×1 (8 → 8)', type: 'conv', group: 'conv',
      outMeta: { label: 'VAE (encoder) · momentos (media y log-varianza de cada posición)', tex: '[\\mu;\\,\\log\\sigma^2]' } });
    const zs = g.op('ve-sample', A.latent_sample(qm, { sym: String(c.latentC), mod: 'lat' }), {
      path: R.concat(['ve-sample']), where: [WE], out: 've-z', label: 'Muestrear z = μ + σ·ε', type: 'tensorop', group: 'other',
      outMeta: { label: 'Latente del VAE sin escalar (H/8 × W/8 × 4)', tex: 'z = \\mu + \\sigma\\varepsilon' } });
    return g.op('ve-scale', A.latent_scale(zs, { factor: c.scaling }), {
      path: R.concat(['ve-scale']), where: [WE], out: 'z0', label: 'Escalar × ' + c.scaling + ' (varianza ≈ 1)', type: 'tensorop', group: 'other',
      outMeta: { label: 'Latente limpio z₀ = ' + c.scaling + '·z (H/8 × W/8 × 4)', tex: 'z_0' } });
  }

  function vaeDecoder(g, z, c) {
    const R = ['vae-decoder'], WD = 'Decoder del VAE', vs = (m) => msym(m, 'C_v');
    const gsAt = (d) => (d === 1 ? ['H', 'W'] : ['H/' + d, 'W/' + d]);
    const zu = g.op('vd-unscale', A.latent_scale(z, { factor: c.scaling, inverse: true }), {
      path: R.concat(['vd-unscale']), where: [WD], out: 'vd-z', label: 'Desescalar ÷ ' + c.scaling, type: 'tensorop', group: 'other',
      outMeta: { label: 'Latente desescalado z₀/' + c.scaling, tex: 'z_0/s' } });
    const pq = g.op('vd-post-quant', A.conv2d(zu, { k: 1, cout: c.latentC, coutSym: String(c.latentC), outSym: gsAt(8) }), {
      path: R.concat(['vd-post-quant']), where: [WD], out: 'vd-pq', label: 'post_quant_conv: conv 1×1 (4 → 4)', type: 'conv', group: 'conv',
      outMeta: { label: 'VAE (decoder) · tras post_quant_conv', tex: 'W_{pq} * z' } });
    const lv = c.vaeMult, top = lv[lv.length - 1];
    let h = g.op('vd-conv-in', A.conv2d(pq, { k: 3, s: 1, p: 1, cout: top * c.Cv, coutSym: vs(top), outSym: gsAt(8) }), {
      path: R.concat(['vd-conv-in']), where: [WD], out: 'vd-h-in', label: 'Conv de entrada 3×3 (4 → ' + top * c.Cv + ')', type: 'conv', group: 'conv',
      outMeta: { label: 'VAE (decoder) · features tras conv_in', tex: 'h_0' } });
    const MID = R.concat(['vd-mid']), WM = [WD, 'bloque medio'];
    h = resnet(g, h, { id: 'vd-mid-res1', path: MID.concat(['vd-mid-res1']), cout: top * c.Cv, coutSym: vs(top), temb: null, where: WM.concat(['ResNet 1']), tag: 'VAE (decoder) · medio · ResNet 1' });
    h = vaeAttn(g, h, { id: 'vd-mid-attn', path: MID.concat(['vd-mid-attn']), where: WM.concat(['atención']), tag: 'VAE (decoder) · medio · atención' });
    h = resnet(g, h, { id: 'vd-mid-res2', path: MID.concat(['vd-mid-res2']), cout: top * c.Cv, coutSym: vs(top), temb: null, where: WM.concat(['ResNet 2']), tag: 'VAE (decoder) · medio · ResNet 2' });
    const rv = lv.slice().reverse();
    for (let k = 0; k < rv.length; k++) {
      const d = 8 / 2 ** k, name = 'vd-up-' + (k + 1), pre = 'vd-u' + (k + 1);
      for (let i = 1; i <= c.vaeLayers + 1; i++) {
        h = resnet(g, h, { id: pre + '-res' + i, path: R.concat([name, pre + '-res' + i]), cout: rv[k] * c.Cv, coutSym: vs(rv[k]), temb: null,
          where: [WD, 'nivel ' + (k + 1), 'ResNet ' + i], tag: 'VAE (decoder) · nivel ' + (k + 1) + ' · ResNet ' + i });
      }
      if (k < rv.length - 1) {
        const up = g.op(pre + '-upsample', A.upsample_nearest(h, { s: 2, outSym: gsAt(d / 2) }), {
          path: R.concat([name, pre + '-up', 'upsample']), where: [WD, 'nivel ' + (k + 1)], out: pre + '-up-h', label: 'Upsample ×2 (vecino más cercano)', type: 'tensorop', group: 'other',
          outMeta: { label: 'VAE (decoder) · nivel ' + (k + 1) + ' · tras repetir ×2', tex: '\\uparrow 2' } });
        h = g.op(pre + '-up-conv', A.conv2d(up, { k: 3, s: 1, p: 1, cout: rv[k] * c.Cv, coutSym: vs(rv[k]), outSym: gsAt(d / 2) }), {
          path: R.concat([name, pre + '-up', 'conv']), where: [WD, 'nivel ' + (k + 1)], out: pre + '-up-out', label: 'Conv 3×3 tras el upsample', type: 'conv', group: 'conv',
          outMeta: { label: 'VAE (decoder) · nivel ' + (k + 1) + ' · tras el upsample', tex: '\\uparrow 2' } });
      }
    }
    const CO = R.concat(['vd-conv-out']);
    const gn = g.op('vd-out-gn', A.group_norm(h, { groups: 32 }), { path: CO.concat(['gn']), where: [WD], out: 'vd-h-gn', label: 'GroupNorm de salida', type: 'norm', group: 'norm', outMeta: { label: 'VAE (decoder) · tras la GroupNorm final', tex: '\\mathrm{GN}' } });
    const ac = g.op('vd-out-silu', A.silu(gn), { path: CO.concat(['silu']), where: [WD], out: 'vd-h-act', label: 'SiLU', type: 'mlp', group: 'act', outMeta: { label: 'VAE (decoder) · tras la SiLU final', tex: '\\mathrm{SiLU}' } });
    return g.op('vd-conv-out', A.conv2d(ac, { k: 3, s: 1, p: 1, cout: 3, coutSym: '3', outSym: gsAt(1), mod: 'img' }), {
      path: CO.concat(['conv']), where: [WD], out: 'image', label: 'Conv de salida 3×3 (' + c.Cv + ' → 3: RGB)', type: 'conv', group: 'conv',
      outMeta: { label: 'Imagen generada (H × W × 3)', tex: '\\hat x = D(z_0)' } });
  }

  // Parámetros y MACs del encoder / decoder del VAE a una resolución (grafo aparte, memoizado): para las métricas y para la
  // op idle_params del componente que el forward no usa.
  const vaeMemo = {};
  function vaeStats(c, res) {
    const key = [res, c.Cv, c.vaeMult.join('-'), c.vaeLayers, c.latentC, c.scaling].join('|');
    if (vaeMemo[key]) return vaeMemo[key];
    const sum = (gr) => gr._data().ops.reduce((s, op) => ({ params: s.params + op.params * A.paramRep(op), macs: s.macs + op.macs * op.repeat }), { params: 0, macs: 0 });
    const ge = A.graph(c);
    vaeEncoder(ge, ge.input('image', shp(['H', 'W', '3'], [res, res, 3], 'img', 'grid')), c);
    const gd = A.graph(c);
    vaeDecoder(gd, gd.input('z0', shp(['H/8', 'W/8', String(c.latentC)], [res / 8, res / 8, c.latentC], 'lat', 'grid')), c);
    const e = sum(ge), d = sum(gd);
    vaeMemo[key] = { encoderParams: e.params, encoderMacs: e.macs, decoderParams: d.params, decoderMacs: d.macs };
    return vaeMemo[key];
  }

  // ================================================================== encoder de texto (CLIP ViT-L/14, de clip.js)
  // Se importa la torre de texto de la config clip-vit-l14 (A.importGraph): mismas ops (t-…), etiquetas y números; sin la
  // proyección ni el EOT (SD usa los 77 vectores de la última capa, tras la LayerNorm final). Símbolos: D_t, h_t, d_t, 4D_t.
  const texText = (s) => (typeof s === 'string'
    ? s.replace(/D_\{\\mathrm\{mlp\}\}/g, '4D_t').replace(/d_h/g, 'd_t').replace(/(^|[^A-Za-z\\_{])h(?![A-Za-z_])/g, '$1h_t') : s);
  function textEncoder(g, c) {
    g.input('prompt-ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Prompt tokenizado (' + c.T + ' ids BPE con SOT, EOT y relleno)', tex: 't_{1..T}' });
    if (c.towers) return sdxlText(g, c);
    const src = A.run(c.textCfg);
    const keep = (op) => op.path[0] === 'txt-encoder' && op.id !== 't-pick-eot';
    const WT = 'Encoder de texto (CLIP ViT-L/14)';
    A.importGraph(g, src, {
      skip: src.ops.filter((op) => !keep(op)).map((op) => op.id),
      inputs: { 't-ids': 'prompt-ids' },
      tensorId: (id) => (id === 't-ln-final' ? 'text-emb' : id),
      sym: { h: 'h_t', d_h: 'd_t', D_mlp: '4D_t' },
      tex: texText,
      path: (p) => ['text-encoder'].concat(p.slice(1)),
      where: (w) => [WT].concat(w.filter((x) => x !== 'Torre de texto')),
      label: (l) => (l === 'Torre de texto · salida normalizada' ? 'Embeddings del texto (' + c.T + ' × ' + c.Dtxt + '): K y V de cada cross-attention'
        : l.replace('Torre de texto · ', 'Texto (CLIP) · ')),
    });
    return { text: g.tensor('text-emb'), pooled: null };
  }

  // SDXL: dos encoders de texto (CLIP ViT-L/14 y OpenCLIP ViT-bigG/14) construidos con A.preLnLayer (el bloque de CLIP / ViT,
  // con máscara causal como op), L − 1 capas + la última aparte (como la torre de visión de LLaVA): SDXL usa hidden_states[−2]
  // (la salida de la PENÚLTIMA capa, sin LayerNorm final) de los dos, concatenados (768 + 1280 = 2,048 por token); HF corre
  // igual la última capa y la LayerNorm final. Del segundo sale además el vector agrupado: EOT de la LN final → proyección
  // 1280 → 1280 sin sesgo (text_embeds). Ids te1-… / te2-…; nodos text-encoder › te1 | te2 › {tok-embed, pos-embed, add-pos,
  // enc-layer › …, last-layer, ln-final, pick-eot, text-proj}, text-encoder › concat.
  function sdxlTower(g, ids, c, k) {
    const tw = c.towers[k], pre = 'te' + (k + 1), n = k + 1, P = ['text-encoder', pre], W = [tw.label], tag = 'Texto ' + n + ' (' + tw.short + ') · ';
    const Ds = 'D_' + n;
    const op = (id, res, node, extra) => g.op(pre + '-' + id, res, Object.assign({ path: P.concat(Array.isArray(node) ? node : [node]), where: W }, extra));
    const tok = op('tok-embed', A.embedding_lookup(ids, { V: c.V, D: tw.D, Dsym: Ds }), 'tok-embed', { out: pre + '-tok', label: 'Token embedding (V × ' + Ds + ')', type: 'embed', group: 'embed',
      outMeta: { label: tag + 'embeddings de tokens', tex: 'E_{\\mathrm{tok}}[t]' } });
    const pos = op('pos-embed', A.pos_embed_learned({ rows: c.T, rowsSym: 'T', D: tw.D, Dsym: Ds, mod: 'txt' }), 'pos-embed', { out: pre + '-e-pos', label: 'Position embeddings aprendidos', type: 'embed', group: 'embed',
      outMeta: { label: tag + 'tabla de posición', tex: 'E_{\\mathrm{pos}}' } });
    const x0 = op('add-pos', A.add(tok, pos), 'add-pos', { out: pre + '-x0', label: 'Suma de posición', type: 'tensorop', group: 'embed', outMeta: { label: tag + 'entrada al encoder', tex: 'x_0' } });
    const xs = A.preLnLayer(g, x0, {
      prefix: P.concat(['enc-layer']), L: tw.L - 1, h: tw.h, Dmlp: 4 * tw.D, tid: pre + '-', oid: pre + '-', maskOp: true, where: W, labelPrefix: tag,
      actLabel: tw.act === 'gelu' ? 'GELU' : 'QuickGELU', actTex: tw.act === 'gelu' ? '\\mathrm{GELU}(U)' : 'U\\,\\sigma(1.702\\,U)', hSym: 'h_' + n, dhSym: 'd_' + n, DmlpSym: '4' + Ds,
      outId: pre + '-hidden', outMeta: { label: tag + 'salida de la capa ' + (tw.L - 1) + ' (penúltima: hidden_states[−2], la que usa SDXL)', tex: 'x_{L-1}', perLayer: false },
    });
    const last = op('last-layer', A.transformer_block(xs, { h: tw.h, Dmlp: 4 * tw.D, DmlpSym: '4' + Ds }), 'last-layer', { out: pre + '-x-last',
      label: 'Capa ' + tw.L + ' (última): HF la calcula' + (tw.proj ? '; solo sirve para el vector agrupado' : ' y SDXL no la usa'), type: 'attn', group: 'attn',
      paramTex: '12' + Ds + '^2 + 13' + Ds, macTex: 'T\\cdot 12' + Ds + '^2 + 2\\,T^2 ' + Ds, outMeta: { label: tag + 'salida de la última capa', tex: 'x_L' } });
    const ln = op('ln-final', A.layernorm(last), 'ln-final', { out: pre + '-ln-final', label: 'LayerNorm final', type: 'norm', group: 'norm', outMeta: { label: tag + 'salida normalizada (última capa)', tex: '\\mathrm{LN}(x_L)' } });
    let pooled = null;
    if (tw.proj) {
      const eot = op('pick-eot', A.pick_token(ln, { index: 'EOT' }), 'pick-eot', { out: pre + '-eot', label: 'Tomar el token EOT', type: 'tensorop', group: 'head', outMeta: { label: tag + 'vector del EOT', tex: 'x_L^{\\mathrm{eot}}' } });
      pooled = op('text-proj', A.linear(eot, { dout: tw.D, doutSym: Ds, bias: false }), 'text-proj', { out: 'text-pooled', label: 'text_projection ' + Ds + ' → ' + Ds + ' (sin sesgo)', type: 'embed', group: 'head',
        outMeta: { label: 'Texto agrupado (' + tw.D + ': EOT proyectado del encoder 2)', tex: 'p_{\\mathrm{txt}}' } });
    } else {
      void ln;
    }
    return { hidden: xs, pooled };
  }
  function sdxlText(g, c) {
    const ids = g.tensor('prompt-ids');
    const a = sdxlTower(g, ids, c, 0), b = sdxlTower(g, ids, c, 1);
    const emb = g.op('text-concat', A.concat_features([a.hidden, b.hidden], { sym: 'D_t' }), { path: ['text-encoder', 'concat'], where: ['Encoders de texto'], out: 'text-emb',
      label: 'Concatenar los dos textos (' + c.towers[0].D + ' + ' + c.towers[1].D + ' = ' + c.Dtxt + ' por token)', type: 'fuse', group: 'embed',
      outMeta: { label: 'Embeddings del texto (' + c.T + ' × ' + c.Dtxt + ' = ' + c.towers[0].D + ' + ' + c.towers[1].D + '): K y V de cada cross-attention', tex: '[H_1;\\,H_2]' } });
    return { text: emb, pooled: b.pooled };
  }

  // SDXL: "micro-condicionamiento". Los 6 time ids (tamaño original, recorte y tamaño objetivo) → sinusoides de 256 → 1,536,
  // + el texto agrupado (1,280) = 2,816 → Linear → SiLU → Linear → 1,280 que se SUMA al embedding del tiempo. Ops add-time-proj,
  // add-concat, add-fc1, add-silu, add-fc2, temb-add; nodos unet › time-embed › add-embed › {…}.
  function sdxlAddEmbed(g, te, c, TE, WT, pooled) {
    const AE = TE.concat(['add-embed']), W = WT.concat(['micro-condicionamiento']);
    const ids = g.input('time-ids', shp(['6'], [6], null, 'vec'), { label: 'Time ids: tamaño original (2), recorte (2) y tamaño objetivo (2)', tex: '(h_0, w_0, c_t, c_l, h, w)' });
    const tp = g.op('add-time-proj', A.timestep_embedding(ids, { dim: c.addTimeDim, sym: '6·' + c.addTimeDim, flip: true, shift: 0 }), { path: AE.concat(['time-proj']), where: W, out: 'time-ids-emb',
      label: 'Sinusoides de los 6 time ids (6 × ' + c.addTimeDim + ')', type: 'embed', group: 'embed', outMeta: { label: 'Time ids como sinusoides (6 × ' + c.addTimeDim + ' = ' + 6 * c.addTimeDim + ')', tex: '\\gamma(\\text{ids})' } });
    const cat = g.op('add-concat', A.concat_features([pooled, tp], { sym: 'D_2+6·' + c.addTimeDim }), { path: AE.concat(['concat']), where: W, out: 'add-in',
      label: 'Concatenar texto agrupado + time ids (' + c.towers[1].D + ' + ' + 6 * c.addTimeDim + ')', type: 'fuse', group: 'embed',
      outMeta: { label: 'Entrada del micro-condicionamiento (' + (c.towers[1].D + 6 * c.addTimeDim) + ')', tex: '[p_{\\mathrm{txt}};\\,\\gamma(\\text{ids})]' } });
    const a1 = g.op('add-fc1', A.linear(cat, { dout: 4 * c.C, doutSym: '4C' }), { path: AE.concat(['fc1']), where: W, out: 'add-h', label: 'Linear ' + (c.towers[1].D + 6 * c.addTimeDim) + ' → 4C', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Micro-condicionamiento: capa oculta', tex: 'W_1 a + b_1' } });
    const aa = g.op('add-silu', A.silu(a1), { path: AE.concat(['silu']), where: W, out: 'add-act', label: 'SiLU', type: 'mlp', group: 'act', outMeta: { label: 'Micro-condicionamiento: tras SiLU', tex: '\\mathrm{SiLU}' } });
    const a2 = g.op('add-fc2', A.linear(aa, { dout: 4 * c.C, doutSym: '4C' }), { path: AE.concat(['fc2']), where: W, out: 'add-emb', label: 'Linear 4C → 4C', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Embedding del micro-condicionamiento (' + 4 * c.C + ')', tex: 'e_{\\mathrm{add}}' } });
    return g.op('temb-add', A.add(te, a2), { path: AE.concat(['sum']), where: W, out: 'temb-total', label: 'Sumar al embedding del tiempo', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Embedding del tiempo + micro-condicionamiento (' + 4 * c.C + '; lo recibe cada bloque ResNet)', tex: 'e_t + e_{\\mathrm{add}}' } });
  }

  // ================================================================== U-Net (UNet2DConditionModel)
  // Niveles k = 1..nL con resolución H/(8·2^(k−1)) y C·m_k canales. Ops y nodos: conv-in; time-embed (temb-freq, temb-fc1,
  // temb-silu, temb-fc2); down-k › dk-res{i}, dk-attn{i}, dk-down; mid › mid-res1, mid-attn, mid-res2; up-k › uk-res{i} (con
  // la op uk-cat{i}: concatenar el skip), uk-attn{i}, uk-up (uk-upsample, uk-up-conv); conv-out (out-gn, out-silu, conv-out).
  function unet(g, z, t, text, c, pooled) {
    const U = ['unet'], WU = 'U-Net', cs = (m) => msym(m, 'C');
    const gsAt = (k) => { const d = 8 * 2 ** k; return ['H/' + d, 'W/' + d]; };
    const lv = c.levels, nL = lv.length;
    const hin = g.op('conv-in', A.conv2d(z, { k: 3, s: 1, p: 1, cout: c.C, coutSym: 'C', outSym: gsAt(0) }), {
      path: U.concat(['conv-in']), where: [WU], out: 'h-in', label: 'Conv de entrada 3×3 (4 → ' + c.C + ')', type: 'conv', group: 'conv',
      outMeta: { label: 'U-Net · features tras conv_in (' + c.C + ' canales; skip del último nivel)', tex: 'h_0' } });
    // tiempo: sinusoidal (C = 320) → Linear C → 4C → SiLU → Linear 4C → 4C
    const TE = U.concat(['time-embed']), WT = [WU, 'embedding del tiempo'];
    const tf = g.op('temb-freq', A.timestep_embedding(t, { dim: c.C, sym: 'C', flip: true, shift: 0 }), {
      path: TE.concat(['freq']), where: WT, out: 't-freq', label: 'Embedding sinusoidal de t (' + c.C + ' canales: cos y sin de ' + c.C / 2 + ' frecuencias)', type: 'embed', group: 'embed',
      outMeta: { label: 'Embedding sinusoidal del paso t', tex: '\\gamma(t)' } });
    const t1 = g.op('temb-fc1', A.linear(tf, { dout: 4 * c.C, doutSym: '4C' }), { path: TE.concat(['fc1']), where: WT, out: 't-h', label: 'Linear C → 4C', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Tiempo: capa oculta', tex: 'W_1\\gamma(t) + b_1' } });
    const ta = g.op('temb-silu', A.silu(t1), { path: TE.concat(['silu']), where: WT, out: 't-act', label: 'SiLU', type: 'mlp', group: 'act', outMeta: { label: 'Tiempo: tras SiLU', tex: '\\mathrm{SiLU}(\\cdot)' } });
    let te = g.op('temb-fc2', A.linear(ta, { dout: 4 * c.C, doutSym: '4C' }), { path: TE.concat(['fc2']), where: WT, out: 'temb', label: 'Linear 4C → 4C', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Embedding del tiempo e_t (' + 4 * c.C + '; lo recibe cada bloque ResNet)', tex: 'e_t' } });
    if (c.addEmbed) te = sdxlAddEmbed(g, te, c, TE, WT, pooled);
    const heads = (m) => (c.headDim ? { h: (m * c.C) / c.headDim, hSym: cs(m) + '/d_h', dhSym: 'd_h' } : { h: c.h, hSym: 'h', dhSym: cs(m) + '/h' });
    const skips = [hin];
    let h = hin;
    for (let k = 0; k < nL; k++) {
      const L = lv[k], name = 'down-' + (k + 1), pre = 'd' + (k + 1), Ck = L.m * c.C;
      for (let i = 1; i <= c.layers; i++) {
        h = resnet(g, h, { id: pre + '-res' + i, path: U.concat([name, pre + '-res' + i]), cout: Ck, coutSym: cs(L.m), temb: te,
          where: [WU, name, 'ResNet ' + i], tag: 'U-Net · ' + name + ' · ResNet ' + i });
        if (L.depth) {
          h = xformer(g, h, text, Object.assign({ id: pre + '-attn' + i, path: U.concat([name, pre + '-attn' + i]), m: L.m, depth: L.depth, linearProj: c.linearProj,
            where: [WU, name, 'transformer ' + i], tag: 'U-Net · ' + name + ' · transformer ' + i }, heads(L.m)));
        }
        skips.push(h);
      }
      if (k < nL - 1) {
        h = g.op(pre + '-down', A.downsample2d(h, { pad: 'sym', outSym: gsAt(k + 1) }), {
          path: U.concat([name, pre + '-down']), where: [WU, name], out: pre + '-down-out', label: 'Downsample: conv 3×3 stride 2', type: 'conv', group: 'conv',
          outMeta: { label: 'U-Net · ' + name + ' · tras el downsample (' + h.num[0] / 2 + '×' + h.num[1] / 2 + ')', tex: '\\downarrow 2' } });
        skips.push(h);
      }
    }
    const MID = U.concat(['mid']), top = lv[nL - 1], WM = [WU, 'bloque medio'];
    h = resnet(g, h, { id: 'mid-res1', path: MID.concat(['mid-res1']), cout: top.m * c.C, coutSym: cs(top.m), temb: te, where: WM.concat(['ResNet 1']), tag: 'U-Net · medio · ResNet 1' });
    h = xformer(g, h, text, Object.assign({ id: 'mid-attn', path: MID.concat(['mid-attn']), m: top.m, depth: c.midDepth, linearProj: c.linearProj,
      where: WM.concat(['transformer']), tag: 'U-Net · medio · transformer' }, heads(top.m)));
    h = resnet(g, h, { id: 'mid-res2', path: MID.concat(['mid-res2']), cout: top.m * c.C, coutSym: cs(top.m), temb: te, where: WM.concat(['ResNet 2']), tag: 'U-Net · medio · ResNet 2' });
    const used = [];
    for (let k = 0; k < nL; k++) {
      const li = nL - 1 - k, L = lv[li], name = 'up-' + (k + 1), pre = 'u' + (k + 1), Ck = L.m * c.C;
      for (let i = 1; i <= c.layers + 1; i++) {
        const s = skips.pop();
        used.push({ to: pre + '-res' + i, tensor: s.id, level: name });
        const cat = g.op(pre + '-cat' + i, A.concat_channels([h, s], { sym: h.sym[2] + '+' + s.sym[2] }), {
          path: U.concat([name, pre + '-res' + i, 'cat']), where: [WU, name, 'ResNet ' + i], out: pre + '-cat' + i, label: 'Concatenar el skip ' + s.id + ' (' + fint(h.num[2]) + ' + ' + fint(s.num[2]) + ' canales)',
          type: 'tensorop', group: 'other', outMeta: { label: 'U-Net · ' + name + ' · ResNet ' + i + ' · entrada: features + skip (' + fint(h.num[2]) + ' + ' + fint(s.num[2]) + ')', tex: '[h;\\,s]' } });
        h = resnet(g, cat, { id: pre + '-res' + i, path: U.concat([name, pre + '-res' + i]), cout: Ck, coutSym: cs(L.m), temb: te, where: [WU, name, 'ResNet ' + i], tag: 'U-Net · ' + name + ' · ResNet ' + i });
        if (L.depth) {
          h = xformer(g, h, text, Object.assign({ id: pre + '-attn' + i, path: U.concat([name, pre + '-attn' + i]), m: L.m, depth: L.depth, linearProj: c.linearProj,
            where: [WU, name, 'transformer ' + i], tag: 'U-Net · ' + name + ' · transformer ' + i }, heads(L.m)));
        }
      }
      if (k < nL - 1) {
        const up = g.op(pre + '-upsample', A.upsample_nearest(h, { s: 2, outSym: gsAt(li - 1) }), {
          path: U.concat([name, pre + '-up', 'upsample']), where: [WU, name], out: pre + '-up-h', label: 'Upsample ×2 (vecino más cercano)', type: 'tensorop', group: 'other',
          outMeta: { label: 'U-Net · ' + name + ' · tras repetir ×2 (' + h.num[0] * 2 + '×' + h.num[1] * 2 + ')', tex: '\\uparrow 2' } });
        h = g.op(pre + '-up-conv', A.conv2d(up, { k: 3, s: 1, p: 1, cout: Ck, coutSym: cs(L.m), outSym: gsAt(li - 1) }), {
          path: U.concat([name, pre + '-up', 'conv']), where: [WU, name], out: pre + '-up-out', label: 'Conv 3×3 tras el upsample', type: 'conv', group: 'conv',
          outMeta: { label: 'U-Net · ' + name + ' · salida del nivel (tras el upsample)', tex: '\\uparrow 2' } });
      }
    }
    if (skips.length) throw new Error('U-Net: quedaron ' + skips.length + ' skips sin usar.');
    c.skipMap = used;
    const CO = U.concat(['conv-out']);
    const gn = g.op('out-gn', A.group_norm(h, { groups: 32 }), { path: CO.concat(['gn']), where: [WU], out: 'h-out-gn', label: 'GroupNorm de salida', type: 'norm', group: 'norm', outMeta: { label: 'U-Net · tras la GroupNorm final', tex: '\\mathrm{GN}' } });
    const ac = g.op('out-silu', A.silu(gn), { path: CO.concat(['silu']), where: [WU], out: 'h-out-act', label: 'SiLU', type: 'mlp', group: 'act', outMeta: { label: 'U-Net · tras la SiLU final', tex: '\\mathrm{SiLU}' } });
    return g.op('conv-out', A.conv2d(ac, { k: 3, s: 1, p: 1, cout: c.latentC, coutSym: String(c.latentC), outSym: gsAt(0), mod: 'lat' }), {
      path: CO.concat(['conv']), where: [WU], out: 'eps-hat', label: 'Conv de salida 3×3 (' + c.C + ' → 4)', type: 'conv', group: 'conv',
      outMeta: { label: 'Ruido predicho ε̂ (H/8 × W/8 × 4)', tex: '\\hat\\varepsilon_\\theta(z_t, t, c)' } });
  }


  // ================================================================== Stable Diffusion: configs
  const SD_SRC = 'Rombach et al. 2022 (High-Resolution Image Synthesis with Latent Diffusion Models, CVPR 2022, arXiv:2112.10752); config.json de HF ';
  const SD_SCHED = { trainSteps: 1000, betaStart: 0.00085, betaEnd: 0.012, betaSchedule: 'scaled_linear' };
  const SD15 = Object.assign({
    label: 'Stable Diffusion 1.5 @ 512', H: 512, W: 512, C: 320, layers: 2, h: 8, headDim: null, midDepth: 1, linearProj: false,
    levels: [{ m: 1, depth: 1 }, { m: 2, depth: 1 }, { m: 4, depth: 1 }, { m: 4, depth: 0 }],
    T: 77, V: 49408, Dtxt: 768, Lt: 12, ht: 12, textCfg: 'clip-vit-l14', textLabel: 'CLIP ViT-L/14 (texto)',
    Cv: 128, vaeMult: [1, 2, 4, 4], vaeLayers: 2, latentC: 4, f: 8, scaling: 0.18215,
    steps: 50, cfg: 1, cfgScale: 7.5, B: 1, train: 0, sampler: 'ddim', native: 512, hf: 'stable-diffusion-v1-5/stable-diffusion-v1-5',
  }, SD_SCHED);
  const SAMPLER = { ddim: 'DDIM', euler: 'Euler', ddpm: 'DDPM' };
  const SDXL = Object.assign({}, SD15, {
    label: 'Stable Diffusion XL (base) @ 1024', H: 1024, W: 1024, native: 1024, h: null, dh: 64, headDim: 64, midDepth: 10, linearProj: true,
    levels: [{ m: 1, depth: 0 }, { m: 2, depth: 2 }, { m: 4, depth: 10 }],
    Dtxt: 2048, Lt: null, ht: null, textCfg: null, textLabel: 'CLIP ViT-L/14 + OpenCLIP ViT-bigG/14',
    towers: [{ label: 'Encoder de texto 1 (CLIP ViT-L/14)', short: 'CLIP ViT-L', D: 768, L: 12, h: 12, act: 'quick_gelu', proj: false },
      { label: 'Encoder de texto 2 (OpenCLIP ViT-bigG/14)', short: 'OpenCLIP bigG', D: 1280, L: 32, h: 20, act: 'gelu', proj: true }],
    addEmbed: true, addTimeDim: 256, scaling: 0.13025, cfgScale: 5, sampler: 'euler', hf: 'stabilityai/stable-diffusion-xl-base-1.0',
  });
  const SD_CONFIGS = {
    'sd15-unet': Object.assign({}, SD15, { canonical: true,
      source: SD_SRC + 'stable-diffusion-v1-5/stable-diffusion-v1-5: unet/config.json (block_out_channels [320, 640, 1280, 1280], layers_per_block 2, CrossAttnDownBlock2D ×3 + DownBlock2D, UNetMidBlock2DCrossAttn, UpBlock2D + CrossAttnUpBlock2D ×3, attention_head_dim 8 (= 8 CABEZAS: el nombre es histórico), cross_attention_dim 768, norm_num_groups 32, flip_sin_to_cos, freq_shift 0, downsample_padding 1); vae/config.json (block_out_channels [128, 256, 512, 512], layers_per_block 2, latent_channels 4, scaling_factor 0.18215); text_encoder/config.json (CLIP ViT-L/14: 12 capas, 768, 12 cabezas, 3072, vocab 49,408, 77 posiciones, quick_gelu); scheduler: 1,000 pasos, β scaled_linear 0.00085 → 0.012. Grafo: un paso de muestreo (texto 1×, U-Net 1 NFE, paso DDIM, decoder del VAE 1×); el costo por imagen está en metrics().' }),
    'sd15-train': Object.assign({}, SD15, { label: 'Stable Diffusion 1.5 @ 512 · un paso de entrenamiento', train: 1,
      source: SD_SRC + 'mismas configs que sd15-unet. Grafo de UN paso de entrenamiento: imagen → encoder del VAE → z₀; ε y t al azar → z_t = √ᾱ_t z₀ + √(1−ᾱ_t) ε → U-Net (con el texto) → ε̂ → MSE con ε (L_simple de DDPM). Encoder de texto y VAE congelados; solo la U-Net recibe gradiente.' }),
    'sdxl-unet': Object.assign({}, SDXL, {
      source: 'Podell et al. 2024 (SDXL: Improving Latent Diffusion Models for High-Resolution Image Synthesis, ICLR 2024, arXiv:2307.01952), Tabla 1; config.json de HF stabilityai/stable-diffusion-xl-base-1.0: unet/config.json (block_out_channels [320, 640, 1280], DownBlock2D + CrossAttnDownBlock2D ×2, transformer_layers_per_block [1, 2, 10], attention_head_dim [5, 10, 20] (= cabezas: d_h = 64), use_linear_projection, cross_attention_dim 2048, addition_embed_type text_time, addition_time_embed_dim 256, projection_class_embeddings_input_dim 2816, sample_size 128); text_encoder (CLIP ViT-L/14 texto) y text_encoder_2 (OpenCLIP ViT-bigG/14 texto: 32 capas, 1280, 20 cabezas, 5120, GELU, projection_dim 1280); vae (misma arquitectura que SD 1.x, scaling_factor 0.13025); scheduler Euler con los β de SD (scaled_linear 0.00085 → 0.012). Sin el refiner.' }),
  };

  function sdApply(c, ov) {
    const notes = [];
    if (ov.train !== undefined) { c.train = ov.train; if (c.train && !/entrenamiento/.test(c.label)) c.label += ' · un paso de entrenamiento'; }
    if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
    ['steps', 'cfg', 'B'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    if (c.cfg > 1) throw new Error('cfg debe ser 0 (sin classifier-free guidance) o 1 (con CFG: cada paso evalúa la red 2 veces).');
    if (c.train > 1) throw new Error('train debe ser 1 (paso de entrenamiento) u omitirse.');
    const div = 8 * 2 ** (c.levels.length - 1);
    if (c.H % div !== 0) throw new Error('Stable Diffusion: la resolución ' + c.H + ' debe ser múltiplo de ' + div + ' (VAE ×8 y ' + (c.levels.length - 1) + ' downsamples de la U-Net).');
    if (c.H !== c.native) {
      notes.push('Resolución ' + c.H + '×' + c.W + ' (latente ' + c.H / 8 + '×' + c.W / 8 + '): ' + c.label.split(' @')[0] + ' se entrenó a ' + c.native + '; la red corre igual (es convolucional y su atención no tiene posición), pero lejos de ' + c.native + ' la calidad cae.');
      c.label = c.label.replace('@ ' + c.native, '@ ' + c.H);
    }
    if (ov.cfg !== undefined && c.cfg === 0) notes.push('Sin classifier-free guidance: 1 evaluación de la U-Net por paso (con CFG son 2: sin texto y con texto).');
    c._notes = notes;
    return c;
  }
  function sdResolve(c) {
    c.res = c.H;
    c.latentH = c.H / c.f; c.latentW = c.W / c.f;
    c.tokens = c.latentH * c.latentW;
    if (c.ht) c.dt = c.Dtxt / c.ht;
    c.nfePerStep = c.cfg ? 2 : 1;
    c.nfe = c.steps * c.nfePerStep;
    return c;
  }

  function sdBuild(c, A) {
    const g = A.graph(c);
    const te = textEncoder(g, c), text = te.text;
    const t = g.input('timestep', shp(['1'], [1], null, 'vec'), { label: c.train ? 'Paso de ruido t (al azar en 1…' + fint(c.trainSteps) + ')' : 'Paso de ruido t del sampler', tex: 't' });
    const lat = (sym) => shp(['H/8', 'W/8', String(c.latentC)], [c.latentH, c.latentW, c.latentC], 'lat', 'grid');
    let zt;
    if (c.train) {
      const img = g.input('image', shp(['H', 'W', '3'], [c.H, c.W, 3], 'img', 'grid'), { label: 'Imagen de entrenamiento (H × W × 3)', tex: 'x' });
      const z0 = vaeEncoder(g, img, c);
      const eps = g.input('eps', lat(), { label: 'Ruido ε ~ N(0, I) (H/8 × W/8 × 4)', tex: '\\varepsilon' });
      zt = g.op('add-noise', A.add_noise(z0, eps, t, { kind: 'ddpm' }), { path: ['add-noise'], where: ['Proceso forward (DDPM)'], out: 'z-t', label: 'Agregar ruido: z_t = √ᾱ_t·z₀ + √(1 − ᾱ_t)·ε', type: 'tensorop', group: 'other',
        outMeta: { label: 'Latente con ruido z_t (H/8 × W/8 × 4)', tex: 'z_t' } });
      g.op('vae-decoder-idle', A.idle_params({ params: vaeStats(c, c.H).decoderParams, paramTex: '\\text{decoder del VAE}', what: 'el decoder del VAE (solo se usa al muestrear)' }), {
        path: ['vae-decoder'], out: [], in: [], where: ['Decoder del VAE'], label: 'Sin uso al entrenar: decoder del VAE', type: 'conv', group: 'conv' });
    } else {
      zt = g.input('z-t', lat(), { label: 'Latente con ruido z_t (H/8 × W/8 × 4; al empezar, z_T ~ N(0, I))', tex: 'z_t' });
    }
    const eps = unet(g, zt, t, text, c, te.pooled);
    if (c.train) {
      g.op('loss', A.mse_loss(eps, g.tensor('eps'), { target: 'ε' }), { path: ['loss'], where: ['Pérdida'], out: 'loss', label: 'MSE entre ε̂ y ε (L_simple)', type: 'head', group: 'head',
        outMeta: { label: 'Pérdida ‖ε̂ − ε‖²', tex: '\\lVert\\hat\\varepsilon - \\varepsilon\\rVert^2' } });
      return g;
    }
    let pred = eps;
    if (c.cfg) {
      const eu = g.input('eps-uncond', lat(), { label: 'ε̂ sin texto (la otra mitad del lote de CFG: el prompt vacío)', tex: '\\hat\\varepsilon_\\theta(z_t, t, \\varnothing)' });
      pred = g.op('cfg-combine', A.cfg_combine(eu, eps, { w: c.cfgScale }), { path: ['scheduler', 'cfg'], where: ['Sampler'], out: 'eps-guided', label: 'Classifier-free guidance (w = ' + c.cfgScale + ')', type: 'tensorop', group: 'other',
        outMeta: { label: 'ε̂ guiada = ε_u + w(ε_c − ε_u)', tex: '\\tilde\\varepsilon' } });
    }
    const zp = g.op('scheduler-step', A.scheduler_step(zt, pred, { kind: c.sampler, steps: c.steps }), { path: ['scheduler', 'step'], where: ['Sampler'], out: 'z-prev',
      label: 'Paso ' + SAMPLER[c.sampler] + ' (×' + c.steps + ' pasos)', type: 'tensorop', group: 'other',
      outMeta: { label: 'Latente del paso siguiente z_{t−1} (tras el último paso, z₀)', tex: 'z_{t-1}' } });
    vaeDecoder(g, zp, c);
    g.op('vae-encoder-idle', A.idle_params({ params: vaeStats(c, c.H).encoderParams, paramTex: '\\text{encoder del VAE}', what: 'el encoder del VAE (solo se usa al entrenar o en img2img)' }), {
      path: ['vae-encoder'], out: [], in: [], where: ['Encoder del VAE'], label: 'Sin uso al muestrear: encoder del VAE', type: 'conv', group: 'conv' });
    return g;
  }

  // ================================================================== métricas (comunes)
  const UNITS = {
    // por evaluación de la red (NFE) y por componente
    unetMacs: 'macs', ditMacs: 'macs', blockMacs: 'macs', blocksMacs: 'macs', blocksSamplingMacs: 'macs', textEncoderMacs: 'macs', vaeDecoderMacs: 'macs', vaeEncoderMacs: 'macs',
    unetParams: 'params', ditParams: 'params', textEncoderParams: 'params', vaeParams: 'params', vaeEncoderParams: 'params', vaeDecoderParams: 'params',
    totalParams: 'params', officialParams: 'params', diffusersParams: 'params', embedderParams: 'params', blockParams: 'params', adalnParams: 'params',
    adalnParamsShare: 'pct', adalnParamsShareBlock: 'pct', unetParamsShare: 'pct', diffusersMacs: 'macs', tEmbedMacs: 'macs',
    // por imagen
    nfePerStep: 'count', nfe: 'count', steps: 'count', textPasses: 'count', freqCount: 'count', samplingMacs: 'macs', samplingMacsNoCfg: 'macs', denoiserSamplingMacs: 'macs',
    denoiserSamplingShare: 'pct', vaeDecoderShare: 'pct', textEncoderShare: 'pct', cfgCostFactor: 'ratio',
    trainForwardMacs: 'macs', trainStepMacsApprox: 'macs',
    // latente
    latentTokens: 'count', latentValues: 'count', pixelValues: 'count', compressionFactor: 'ratio', spatialFactor: 'ratio', latentH: 'count', latentW: 'count',
    // atención
    attnMacsUnet: 'macs', selfAttnScoreMacs: 'macs', crossAttnScoreMacs: 'macs', convMacs: 'macs', transformerMacs: 'macs', resnetMacs: 'macs',
    attnShareUnet: 'pct', selfScoreShareUnet: 'pct', convShare: 'pct', transformerShare: 'pct', selfAttnTokens: 'count', selfAttnHeads: 'count', selfAttnScoreBytes: 'bytes',
    scoreMacsDit: 'macs', scoreShareDit: 'pct', paperGflops: 'ratio', macsVsPaper: 'ratio', unetMacsVsBase: 'ratio',
    // roofline (≈)
    // 'ms' (revisión de la fase 8): milisegundos con decimales (quantities.js: '1.62', '83.8'; la prosa añade ' ms')
    unetNfeMs: 'ms', ditNfeMs: 'ms', unetNfeUs: 'count', ditNfeUs: 'count', textEncoderMs: 'ms', vaeDecodeMs: 'ms', samplingMs: 'ms', msPerImage: 'ms', imagesPerSecUpperBound: 'count',
    sequentialPasses: 'count',
    denoiserIntensity: 'ratio', ridgePoint: 'ratio', weightBytes: 'bytes', bandwidth: 'count', peakFlops: 'count',
    attnMacs: 'macs', scoreMacs: 'macs', linearMacs: 'macs',   // genéricas de ATLAS.Arch.metrics
  };

  // Roofline ≈ (convenciones de llm.js): tiempo = máx(FLOPs / pico, bytes / ancho de banda); bytes = los pesos (bf16) leídos
  // una vez por evaluación; SIN tráfico de activaciones (en las convs de alta resolución pesa mucho: la cota es optimista).
  function roof(macs, rows, params, hw) {
    const tc = (2 * macs * rows) / hw.peakFlops, tm = (2 * params) / hw.bandwidth;
    return { ms: 1000 * Math.max(tc, tm), bound: tc >= tm ? 'cómputo' : 'memoria', intensity: (2 * macs * rows) / (2 * params) };
  }
  function hwOf(ov) {
    const bw = ov.bandwidth !== undefined ? ov.bandwidth : HW.bandwidth;
    const peak = ov.peakFlops !== undefined ? ov.peakFlops : HW.peakFlops;
    [['bandwidth', bw], ['peakFlops', peak]].forEach(([k, v]) => { if (!(typeof v === 'number' && v > 0 && isFinite(v))) throw new Error(k + ' debe ser un número positivo.'); });
    return { bandwidth: bw, peakFlops: peak };
  }
  const archOf = (r) => { const out = {}; const kn = A.model(r.model).knobs || {}; Object.keys(r.overrides || {}).forEach((k) => { if (k in kn && k !== 'B') out[k] = r.overrides[k]; }); return out; };
  const sumOps = (ops, f) => ops.filter(f).reduce((s, op) => s + op.macs * op.repeat, 0);
  const sumParams = (ops, f) => ops.filter(f).reduce((s, op) => s + op.params * A.paramRep(op), 0);
  const isScore = (op) => op.prim === 'attention_scores' || op.prim === 'attention_weighted_sum';

  // ---------------------------------------------------------------- Stable Diffusion
  function sdParts(c, r) {
    const n = r.totals.byNode, z = { params: 0, macs: 0 }, nd = (id) => n[id] || z;
    const vs = vaeStats(c, c.H);
    const U = r.ops.filter((op) => op.path[0] === 'unet');
    const inU = (f) => (op) => op.path[0] === 'unet' && f(op);
    const selfScore = sumOps(U, (op) => isScore(op) && op.path.indexOf('self-attn') >= 0);
    const crossScore = sumOps(U, (op) => isScore(op) && op.path.indexOf('cross-attn') >= 0);
    const attnMacs = sumOps(U, (op) => op.group === 'attn');
    const isXf = (op) => /-attn\d*$/.test(op.path[2] || '');
    const p = {
      unetParams: nd('unet').params, unetMacs: nd('unet').macs, textEncoderParams: nd('text-encoder').params, textEncoderMacs: nd('text-encoder').macs,
      vaeEncoderParams: vs.encoderParams, vaeDecoderParams: vs.decoderParams, vaeEncoderMacs: vs.encoderMacs, vaeDecoderMacs: vs.decoderMacs,
      selfAttnScoreMacs: selfScore, crossAttnScoreMacs: crossScore, attnMacsUnet: attnMacs,
      convMacs: sumOps(U, (op) => op.prim === 'conv2d' || op.prim === 'downsample2d'),
      transformerMacs: sumOps(U, isXf), resnetMacs: sumOps(U, (op) => /-res\d$/.test(op.path[2] || '')),
      transformerParamsL1: sumParams(r.ops, inU((op) => op.path[2] === 'd1-attn1')),
      nResnets: new Set(U.filter((op) => /-res\d$/.test(op.path[2] || '')).map((op) => op.path[2])).size,
      nTransformers: new Set(U.filter(isXf).map((op) => op.path[2])).size,
      nSkips: (c.skipMap || []).length,
    };
    // la self-attention más grande (el primer nivel con atención: 64×64 en SD 1.5 a 512 y en SDXL a 1024)
    const big = U.filter((op) => op.prim === 'attention_scores' && op.path.indexOf('self-attn') >= 0).map((op) => r.tensors[op.out[0]])
      .reduce((m, x) => (!m || x.elements > m.elements ? x : m), null);
    p.selfAttnTokens = big ? big.num[1] : 0;
    p.selfAttnHeads = big ? big.num[0] : 0;
    p.selfAttnScoreBytes = big ? big.elements * 2 : 0;
    p.vaeParams = p.vaeEncoderParams + p.vaeDecoderParams;
    p.textPasses = c.cfg ? 2 : 1;
    p.samplingMacs = c.nfe * p.unetMacs + p.textPasses * p.textEncoderMacs + p.vaeDecoderMacs;
    return p;
  }

  function sdQuantities(c, r) {
    const p = sdParts(c, r);
    return Object.assign({
      tokens: c.tokens, H: c.H, W: c.W, res: c.H, latentH: c.latentH, latentW: c.latentW, latentC: c.latentC, f: c.f,
      latentValues: c.latentH * c.latentW * c.latentC, pixelValues: c.H * c.W * 3, compressionFactor: (c.H * c.W * 3) / (c.latentH * c.latentW * c.latentC),
      C: c.C, C2: 2 * c.C, C4: 4 * c.C, T: c.T, V: c.V, Dtxt: c.Dtxt, Cv: c.Cv, freqCount: c.C / 2,   // e_t: C canales = cos y sin de C/2 frecuencias
      // decimales como texto (qty / cfg.* redondearían 0.18215 y 0.00085)
      scaling: String(c.scaling), betaStart: String(c.betaStart), betaEnd: String(c.betaEnd),
      steps: c.steps, cfg: c.cfg, cfgScale: c.cfgScale, nfe: c.nfe, nfePerStep: c.nfePerStep, trainSteps: c.trainSteps, totalParams: r.totals.params,
    }, c.h ? { h: c.h } : { dh: c.headDim }, c.ht ? { Lt: c.Lt, ht: c.ht, dt: c.dt } : {}, p);
  }

  function sdMetrics(c, r, o) {
    const ov = o.overrides || {}, hw = hwOf(ov), q = r.quantities, B = o.B;
    const nfeRows = B * c.nfePerStep;
    const un = roof(q.unetMacs, nfeRows, q.unetParams, hw), tx = roof(q.textEncoderMacs, B * q.textPasses, q.textEncoderParams, hw), vd = roof(q.vaeDecoderMacs, B, q.vaeDecoderParams, hw);
    const samplingMs = c.steps * un.ms + tx.ms + vd.ms;
    const arch = archOf(r);
    const at = (o2) => A.run(r.id, Object.assign({}, arch, o2));
    const levels = [];
    const names = [];
    c.levels.forEach((_, k) => names.push('down-' + (k + 1)));
    names.push('mid');
    c.levels.forEach((_, k) => names.push('up-' + (k + 1)));
    for (const name of names) {
      const ops = r.ops.filter((op) => op.path[0] === 'unet' && op.path[1] === name);
      const macs = sumOps(ops, () => true);
      const sc = ops.find((op) => op.prim === 'attention_scores' && op.path.indexOf('self-attn') >= 0);
      const conv = ops.find((op) => op.prim === 'conv2d');
      const grid = conv ? r.tensors[conv.out[0]] : null;
      levels.push({ level: name, grid: grid ? grid.num[0] + '×' + grid.num[1] : null, tokens: grid ? grid.num[0] * grid.num[1] : null, channels: grid ? grid.num[2] : null,
        macs, attnMacs: sumOps(ops, (op) => op.group === 'attn'), selfScoreMacs: sumOps(ops, (op) => isScore(op) && op.path.indexOf('self-attn') >= 0),
        crossScoreMacs: sumOps(ops, (op) => isScore(op) && op.path.indexOf('cross-attn') >= 0), hasAttention: !!sc,
        attnShareOfLevel: macs ? sumOps(ops, (op) => op.group === 'attn') / macs : 0, shareOfUnet: macs / q.unetMacs });
    }
    const out = {
      unetMacs: q.unetMacs, textEncoderMacs: q.textEncoderMacs, vaeDecoderMacs: q.vaeDecoderMacs, vaeEncoderMacs: q.vaeEncoderMacs,
      unetParams: q.unetParams, textEncoderParams: q.textEncoderParams, vaeParams: q.vaeParams, vaeEncoderParams: q.vaeEncoderParams, vaeDecoderParams: q.vaeDecoderParams,
      totalParams: r.totals.params, unetParamsShare: q.unetParams / r.totals.params,
      steps: c.steps, nfePerStep: c.nfePerStep, nfe: c.nfe, textPasses: q.textPasses, cfgCostFactor: c.nfePerStep, sequentialPasses: c.steps, freqCount: q.freqCount,
      samplingMacs: q.samplingMacs, samplingMacsNoCfg: c.steps * q.unetMacs + q.textEncoderMacs + q.vaeDecoderMacs,
      denoiserSamplingMacs: c.nfe * q.unetMacs, denoiserSamplingShare: (c.nfe * q.unetMacs) / q.samplingMacs,
      vaeDecoderShare: q.vaeDecoderMacs / q.samplingMacs, textEncoderShare: (q.textPasses * q.textEncoderMacs) / q.samplingMacs,
      trainForwardMacs: q.textEncoderMacs + q.vaeEncoderMacs + q.unetMacs, trainStepMacsApprox: q.textEncoderMacs + q.vaeEncoderMacs + 3 * q.unetMacs,
      latentShape: c.latentH + '×' + c.latentW + '×' + c.latentC, latentH: c.latentH, latentW: c.latentW, latentTokens: c.tokens,
      latentValues: q.latentValues, pixelValues: q.pixelValues, compressionFactor: q.compressionFactor, spatialFactor: c.f,
      attnMacsUnet: q.attnMacsUnet, selfAttnScoreMacs: q.selfAttnScoreMacs, crossAttnScoreMacs: q.crossAttnScoreMacs, convMacs: q.convMacs,
      transformerMacs: q.transformerMacs, resnetMacs: q.resnetMacs,
      attnShareUnet: q.attnMacsUnet / q.unetMacs, selfScoreShareUnet: q.selfAttnScoreMacs / q.unetMacs, convShare: q.convMacs / q.unetMacs, transformerShare: q.transformerMacs / q.unetMacs,
      selfAttnTokens: q.selfAttnTokens, selfAttnHeads: q.selfAttnHeads, selfAttnScoreBytes: q.selfAttnScoreBytes,
      attnByLevel: levels,
      unetNfeMs: un.ms, unetNfeUs: 1000 * un.ms, unetBound: un.bound, textEncoderMs: tx.ms, vaeDecodeMs: vd.ms, samplingMs, msPerImage: samplingMs / B, imagesPerSecUpperBound: (1000 * B) / samplingMs,
      denoiserIntensity: un.intensity, ridgePoint: hw.peakFlops / hw.bandwidth, weightBytes: 2 * r.totals.params,
      bandwidth: hw.bandwidth, peakFlops: hw.peakFlops, hardwareSource: HW.source,
      units: UNITS,
    };
    const row = (rr) => {
      const qq = rr.quantities, cc = rr.config;
      const u2 = roof(qq.unetMacs, B * cc.nfePerStep, qq.unetParams, hw), t2 = roof(qq.textEncoderMacs, B * qq.textPasses, qq.textEncoderParams, hw), v2 = roof(qq.vaeDecoderMacs, B, qq.vaeDecoderParams, hw);
      const ms = cc.steps * u2.ms + t2.ms + v2.ms;
      return { nfe: cc.nfe, unetMacs: qq.unetMacs, vaeDecoderMacs: qq.vaeDecoderMacs, samplingMacs: qq.samplingMacs, samplingMs: ms, msPerImage: ms / B,
        selfScoreShareUnet: qq.selfAttnScoreMacs / qq.unetMacs, attnShareUnet: qq.attnMacsUnet / qq.unetMacs };
    };
    out.stepsScaling = [10, 20, 25, 50, 100].map((steps) => Object.assign({ steps }, row(at({ steps }))));
    out.resScaling = [256, 512, 768, 1024].map((res) => {
      const rr = at({ res });
      return Object.assign({ res, latentShape: rr.config.latentH + '×' + rr.config.latentW + '×' + c.latentC, tokensL1: rr.config.tokens, unetMacsVsBase: rr.quantities.unetMacs / q.unetMacs }, row(rr));
    });
    out.attnShareAt = out.resScaling.map((x) => ({ res: x.res, tokensL1: x.tokensL1, unetMacs: x.unetMacs, selfScoreShareUnet: x.selfScoreShareUnet, attnShareUnet: x.attnShareUnet }));
    out.cfgScaling = [0, 1].map((cfg) => Object.assign({ cfg }, row(at({ cfg }))));
    return out;
  }

  // ================================================================== schedules (para las viz y el texto; cross-check con diffusers)
  // betas: 'scaled_linear' (SD: β_t = (√β₀ + (√β₁ − √β₀)·t/(T−1))²) o 'linear' (DDPM / DiT: β₀ + (β₁ − β₀)·t/(T−1)), t = 0…T−1.
  function betas(kind, T, b0, b1) {
    const out = new Array(T);
    for (let i = 0; i < T; i++) {
      const u = T === 1 ? 0 : i / (T - 1);
      out[i] = kind === 'scaled_linear' ? (Math.sqrt(b0) + (Math.sqrt(b1) - Math.sqrt(b0)) * u) ** 2 : b0 + (b1 - b0) * u;
    }
    return out;
  }
  // ᾱ_t = Π_{s ≤ t} (1 − β_s); SNR(t) = ᾱ_t / (1 − ᾱ_t).
  function alphasCumprod(kind, T, b0, b1) {
    let a = 1;
    return betas(kind, T, b0, b1).map((b) => (a *= 1 - b));
  }
  function schedule(cfgId) {
    const c = A.run(cfgId).config;
    const ab = alphasCumprod(c.betaSchedule, c.trainSteps, c.betaStart, c.betaEnd);
    return { kind: c.betaSchedule, T: c.trainSteps, betaStart: c.betaStart, betaEnd: c.betaEnd, alphasCumprod: ab, snr: ab.map((x) => x / (1 - x)) };
  }
  // Pasos de DDIM con espaciado 'leading' y steps_offset (config del scheduler de SD 1.5: steps_offset = 1): t = k·⌊T/n⌋ + 1,
  // de mayor a menor. PNDM (el sampler por defecto de SD 1.5, con skip_prk_steps) evalúa la U-Net n + 1 veces.
  function ddimTimesteps(steps, T, offset) {
    T = T || 1000; offset = offset === undefined ? 1 : offset;
    const r = Math.floor(T / steps), out = [];
    for (let k = steps - 1; k >= 0; k--) out.push(Math.round(k * r) + offset);
    return out;
  }
  A.diffusion = { betas, alphasCumprod, schedule, ddimTimesteps, pndmNfe: (steps) => steps + 1 };

  A.defineModel({
    id: 'stable-diffusion',
    label: 'Stable Diffusion (difusión latente: VAE + U-Net + CLIP)',
    paper: { title: 'High-Resolution Image Synthesis with Latent Diffusion Models', authors: 'Rombach, Blattmann, Lorenz, Esser, Ommer', venue: 'CVPR 2022', year: 2022, arxiv: '2112.10752',
      note: 'DDPM: Ho et al., NeurIPS 2020, arXiv:2006.11239. DDIM: Song et al., ICLR 2021, arXiv:2010.02502. Classifier-free guidance: Ho & Salimans, arXiv:2207.12598.' },
    configs: SD_CONFIGS,
    knobs: { res: [256, 512, 768, 1024], steps: [10, 20, 25, 50, 100], cfg: [0, 1], B: [1, 4, 16], train: [1] },
    zeroKnobs: ['cfg'],
    hardware: Object.assign({}, HW),
    applyKnobs: sdApply, resolve: sdResolve, build: sdBuild, quantities: sdQuantities, metrics: sdMetrics,
  });

  // ================================================================== DiT (Peebles & Xie 2023; código oficial facebookresearch/DiT)
  // Latente I×I×4 (I = res/8) → patchify (conv P×P, stride P, con sesgo) → N = (I/P)² tokens de D + posición sin/cos 2-D fija →
  // L bloques DiT (adaLN-Zero con c = e_t + e_y) → capa final (adaLN de 2 vectores, LN, Linear D → P²·2·4) → unpatchify →
  // I×I×8 = (ε̂, Σ) (learn_sigma). Ops y nodos: ver la cabecera.
  function ditNet(g, xt, t, y, c) {
    const D = c.D, P = c.P, oc = c.outC, rep = c.L;
    const WB = ['Bloques DiT'], TB = 'DiT · bloque · ';
    const grid = g.op('patchify', A.conv2d(xt, { k: P, s: P, cout: D, coutSym: 'D', kSym: 'P', outSym: ['I/P', 'I/P'], macTex: 'N\\cdot D\\cdot P^2\\cdot 4' }), {
      path: ['patchify', 'conv'], where: ['Patchify'], out: 'x-patch-grid', label: 'Patchify: conv P×P, stride P (4 → D)', type: 'conv', group: 'embed',
      outMeta: { label: 'Rejilla de parches embebidos (I/P × I/P × D)', tex: 'X_{\\mathrm{grid}}' } });
    const xp = g.op('patch-flatten', A.flatten(grid, { sym: ['N', 'D'] }), { path: ['patchify', 'flatten'], where: ['Patchify'], out: 'x-patches', label: 'Aplanar la rejilla', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Parches embebidos (N × D)', tex: 'X_p' } });
    const ep = g.op('pos-embed', A.sincos_pos_2d({ gh: c.gh, gw: c.gh, D, rowsSym: 'N', Dsym: 'D' }), { path: ['pos-embed', 'table'], where: ['Posición'], out: 'e-pos',
      label: 'Posición sin/cos 2-D (fija, ' + fint(c.N) + ' × ' + fint(D) + ')', type: 'embed', group: 'embed', outMeta: { label: 'Tabla de posición sin/cos (fija)', tex: 'E_{\\mathrm{pos}}' } });
    const h0 = g.op('add-pos', A.add(xp, ep), { path: ['pos-embed', 'add'], where: ['Posición'], out: 'h0', label: 'Suma de posición', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Tokens con posición (entrada al primer bloque)', tex: 'h_0' } });
    // condición: e_t (sinusoidal 256 → MLP) + e_y (tabla de K + 1)
    const TE = ['t-embed'], WT = ['Embedding del tiempo'];
    const tf = g.op('temb-freq', A.timestep_embedding(t, { dim: c.freqDim, sym: String(c.freqDim), flip: true, shift: 0 }), { path: TE.concat(['freq']), where: WT, out: 't-freq',
      label: 'Embedding sinusoidal de t (' + c.freqDim + ' canales: cos y sin de ' + c.freqDim / 2 + ' frecuencias)', type: 'embed', group: 'embed', outMeta: { label: 'Embedding sinusoidal del paso t (' + c.freqDim + ' valores, ' + c.freqDim / 2 + ' frecuencias)', tex: '\\gamma(t)' } });
    const t1 = g.op('temb-fc1', A.linear(tf, { dout: D, doutSym: 'D' }), { path: TE.concat(['fc1']), where: WT, out: 't-h', label: 'Linear ' + c.freqDim + ' → D', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Tiempo: capa oculta', tex: 'W_1\\gamma(t) + b_1' } });
    const ta = g.op('temb-silu', A.silu(t1), { path: TE.concat(['silu']), where: WT, out: 't-act', label: 'SiLU', type: 'mlp', group: 'act', outMeta: { label: 'Tiempo: tras SiLU', tex: '\\mathrm{SiLU}' } });
    const te = g.op('temb-fc2', A.linear(ta, { dout: D, doutSym: 'D' }), { path: TE.concat(['fc2']), where: WT, out: 't-emb', label: 'Linear D → D', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Embedding del tiempo e_t', tex: 'e_t' } });
    const ye = g.op('y-embed', A.label_embed(y, { K: c.K, D, Ksym: 'K', Dsym: 'D' }), { path: ['y-embed'], where: ['Embedding de la clase'], out: 'y-emb',
      label: 'Embedding de la clase (tabla (K + 1) × D: ' + fint(c.K + 1) + ' × ' + fint(D) + ', con la clase nula)', type: 'embed', group: 'embed', outMeta: { label: 'Embedding de la clase e_y', tex: 'e_y' } });
    const cc = g.op('cond', A.add(te, ye), { path: ['cond'], where: ['Condición'], out: 'c', label: 'Condición c = e_t + e_y', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Condición c = e_t + e_y (la recibe cada bloque y la capa final)', tex: 'c' } });
    // bloques (repeat L)
    const B = ['blocks', 'block'];
    const L = (meta) => Object.assign({ perLayer: true }, meta, { label: TB + meta.label });
    const op = (id, res, sub, extra) => g.op(id, res, Object.assign({ path: B.concat(sub), repeat: rep, where: WB }, extra));
    const [b1, g1, a1, b2, g2, a2] = op('adaln', A.adaln_zero(cc, { k: 6 }), ['adaln'], {
      out: ['beta1', 'gamma1', 'alpha1', 'beta2', 'gamma2', 'alpha2'], label: 'adaLN-Zero: SiLU → Linear D → 6D (β₁, γ₁, α₁, β₂, γ₂, α₂)', type: 'embed', group: 'embed',
      outMeta: [L({ label: 'β₁ (shift de la atención)', tex: '\\beta_1' }), L({ label: 'γ₁ (scale de la atención)', tex: '\\gamma_1' }), L({ label: 'α₁ (compuerta de la atención)', tex: '\\alpha_1' }),
        L({ label: 'β₂ (shift del MLP)', tex: '\\beta_2' }), L({ label: 'γ₂ (scale del MLP)', tex: '\\gamma_2' }), L({ label: 'α₂ (compuerta del MLP)', tex: '\\alpha_2' })] });
    const n1 = op('norm1', A.layernorm(h0, { affine: false, eps: 1e-6 }), ['norm1'], { out: 'h-norm1', label: 'LayerNorm 1 (sin γ, β)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: '\\mathrm{LN}(x)' }) });
    const m1 = op('modulate1', A.ada_modulate(n1, b1, g1), ['modulate1'], { out: 'h-mod1', label: 'Modular: LN(x)·(1 + γ₁) + β₁', type: 'tensorop', group: 'norm',
      outMeta: L({ label: 'entrada de la atención (modulada)', tex: '\\mathrm{LN}(x)(1+\\gamma_1)+\\beta_1' }) });
    const AT = ['attn'];
    const qkv = op('qkv', A.linear(m1, { dout: 3 * D, doutSym: '3D' }), AT.concat(['qkv']), { out: 'qkv', label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\;K\;V]' }) });
    const [q, k, v] = op('split', A.split_heads(qkv, { h: c.h, parts: 3 }), AT.concat(['split']), { out: ['q', 'k', 'v'], label: 'Separar en ' + c.h + ' cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'queries por cabeza', tex: 'Q' }), L({ label: 'keys por cabeza', tex: 'K' }), L({ label: 'values por cabeza', tex: 'V' })] });
    const sc = op('scores', A.attention_scores(q, k), AT.concat(['scores']), { out: 'scores', label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'scores', tex: 'QK^\\top' }) });
    const sl = op('scale', A.scale(sc), AT.concat(['scale']), { out: 'scores-scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const sm = op('softmax', A.softmax(sl), AT.concat(['softmax']), { out: 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(sm, v), AT.concat(['weighted-sum']), { out: 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: 'D' }), AT.concat(['merge']), { out: 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'cabezas concatenadas', tex: 'Z' }) });
    const ao = op('proj', A.linear(z, { dout: D, doutSym: 'D' }), AT.concat(['proj']), { out: 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'salida de la atención', tex: 'O = ZW_O' }) });
    const og = op('gate1', A.ada_gate(ao, a1), ['gate1'], { out: 'o-gated', label: 'Compuerta α₁ ⊙ atención', type: 'tensorop', group: 'resid', outMeta: L({ label: 'atención con compuerta', tex: '\\alpha_1\\odot O' }) });
    const r1 = op('res1', A.residual_add(h0, og), ['res1'], { out: 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + α₁ ⊙ atención', tex: "x'" }) });
    const n2 = op('norm2', A.layernorm(r1, { affine: false, eps: 1e-6 }), ['norm2'], { out: 'h-norm2', label: 'LayerNorm 2 (sin γ, β)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 2', tex: "\\mathrm{LN}(x')" }) });
    const m2 = op('modulate2', A.ada_modulate(n2, b2, g2), ['modulate2'], { out: 'h-mod2', label: 'Modular: LN(x)·(1 + γ₂) + β₂', type: 'tensorop', group: 'norm',
      outMeta: L({ label: 'entrada del MLP (modulada)', tex: "\\mathrm{LN}(x')(1+\\gamma_2)+\\beta_2" }) });
    const MLP = ['mlp'];
    const u = op('fc1', A.linear(m2, { dout: c.Dmlp, doutSym: 'D_mlp' }), MLP.concat(['fc1']), { out: 'u', label: 'MLP: capa 1 (D → 4D)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta del MLP', tex: 'U' }) });
    const gg = op('gelu', A.gelu(u), MLP.concat(['gelu']), { out: 'g', label: 'GELU (aprox. tanh)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación GELU', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', A.linear(gg, { dout: D, doutSym: 'D' }), MLP.concat(['fc2']), { out: 'f', label: 'MLP: capa 2 (4D → D)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida del MLP', tex: 'F' }) });
    const fg = op('gate2', A.ada_gate(f, a2), ['gate2'], { out: 'f-gated', label: 'Compuerta α₂ ⊙ MLP', type: 'tensorop', group: 'resid', outMeta: L({ label: 'MLP con compuerta', tex: '\\alpha_2\\odot F' }) });
    const xo = op('res2', A.residual_add(r1, fg), ['res2'], { out: 'x-out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: { label: 'Salida de los L bloques (x_L)', tex: 'x_L', perLayer: false, note: 'Salida de cada bloque x_ℓ; tras el bloque L es x_L.' } });
    // capa final: adaLN de 2 vectores (β, γ), LN sin parámetros, modular, Linear D → P²·2·4
    const FL = ['final-layer'], WF = ['Capa final'];
    const [fb, fgm] = g.op('final-adaln', A.adaln_zero(cc, { k: 2 }), { path: FL.concat(['adaln-final']), where: WF, out: ['final-beta', 'final-gamma'],
      label: 'adaLN final: SiLU → Linear D → 2D (β, γ)', type: 'embed', group: 'embed',
      outMeta: [{ label: 'Capa final · β (shift)', tex: '\\beta' }, { label: 'Capa final · γ (scale)', tex: '\\gamma' }] });
    const fn = g.op('final-norm', A.layernorm(xo, { affine: false, eps: 1e-6 }), { path: FL.concat(['norm']), where: WF, out: 'h-final-norm', label: 'LayerNorm final (sin γ, β)', type: 'norm', group: 'norm',
      outMeta: { label: 'Capa final · tras LayerNorm', tex: '\\mathrm{LN}(x_L)' } });
    const fm = g.op('final-modulate', A.ada_modulate(fn, fb, fgm), { path: FL.concat(['modulate']), where: WF, out: 'h-final-mod', label: 'Modular: LN·(1 + γ) + β', type: 'tensorop', group: 'norm',
      outMeta: { label: 'Capa final · tras modular', tex: '\\mathrm{LN}(x_L)(1+\\gamma)+\\beta' } });
    const osym = 'P²·' + oc;
    const fo = g.op('final-linear', A.linear(fm, { dout: P * P * oc, doutSym: osym }), { path: FL.concat(['linear']), where: WF, out: 'h-final',
      label: 'Linear D → P²·' + oc + ' (' + fint(P * P * oc) + ': un parche de ' + P + '×' + P + '×' + oc + ' por token)', type: 'head', group: 'head',
      outMeta: { label: 'Capa final · un parche P×P×' + oc + ' por token (' + fint(P * P * oc) + ' números)', tex: 'XW + b' } });
    const outId = c.learnSigma ? 'out' : 'v-hat';
    const un = g.op('unpatchify', A.unpatchify(fo, { gh: c.gh, gw: c.gh, P, outSym: ['I', 'I', String(oc)] }), { path: ['unpatchify'], where: ['Unpatchify'], out: outId,
      label: 'Unpatchify: cada token vuelve a ser su parche', type: 'tensorop', group: 'head', outMeta: c.learnSigma
        ? { label: 'Salida de la red (I × I × 8: ε̂ y Σ)', tex: '[\\hat\\varepsilon;\\,\\Sigma]' } : { label: 'Velocidad predicha v̂ (I × I × 4)', tex: '\\hat v_\\theta(x_t, t, y)' } });
    if (!c.learnSigma) return un;
    const [e] = g.op('split-out', A.split_channels(un, { parts: 2, sym: String(c.latentC) }), { path: ['out'], where: ['Salida'], out: ['eps-hat', 'sigma'],
      label: 'Separar ε̂ (4 canales) y Σ (4 canales: interpolación de la varianza)', type: 'tensorop', group: 'head',
      outMeta: [{ label: 'Ruido predicho ε̂ (I × I × 4)', tex: '\\hat\\varepsilon_\\theta(x_t, t, y)' }, { label: 'Σ predicha (I × I × 4: v de la varianza aprendida)', tex: '\\Sigma_\\theta' }] });
    return e;
  }

  const DIT_SRC = 'Peebles & Xie 2023 (Scalable Diffusion Models with Transformers, ICCV 2023, arXiv:2212.09748), Tabla 1 (S/B/L/XL: capas, ancho, cabezas) y código oficial facebookresearch/DiT (models.py: DiT_XL_2 …); ';
  const DIT_BASE = { latentC: 4, f: 8, learnSigma: true, K: 1000, freqDim: 256, steps: 250, cfg: 1, cfgScale: 1.5, B: 1, train: 0, sampler: 'ddpm',
    Cv: 128, vaeMult: [1, 2, 4, 4], vaeLayers: 2, scaling: 0.18215, trainSteps: 1000, betaStart: 0.0001, betaEnd: 0.02, betaSchedule: 'linear' };
  const XL = { D: 1152, L: 28, h: 16, size: 'XL' }, DB = { D: 768, L: 12, h: 12, size: 'B' };
  const ditCfg = (sz, P, res, o) => Object.assign({}, DIT_BASE, sz, { P, H: res, W: res, label: 'DiT-' + sz.size + '/' + P + ' @ ' + res }, o);
  const DIT_CONFIGS = {
    'dit-xl2-256': ditCfg(XL, 2, 256, { canonical: true, paperGflops: 118.6, hf: 'facebook/DiT-XL-2-256',
      source: DIT_SRC + 'facebook/DiT-XL-2-256 transformer/config.json (num_layers 28, num_attention_heads 16, attention_head_dim 72 → D = 1,152, patch_size 2, sample_size 32, in_channels 4, out_channels 8, num_embeds_ada_norm 1000, activation gelu-approximate, norm_type ada_norm_zero sin afín). 118.6 "Gflops" en la Tabla 4: son MACs (el calculador da 118.62 GMACs).' }),
    'dit-xl2-512': ditCfg(XL, 2, 512, { hf: 'facebook/DiT-XL-2-512', source: DIT_SRC + 'facebook/DiT-XL-2-512 (mismo modelo, sample_size 64: 1,024 tokens).' }),
    'dit-xl4-256': ditCfg(XL, 4, 256, { source: DIT_SRC + 'DiT-XL/4 (patch 4: 64 tokens).' }),
    'dit-xl8-256': ditCfg(XL, 8, 256, { source: DIT_SRC + 'DiT-XL/8 (patch 8: 16 tokens).' }),
    'dit-b2-256': ditCfg(DB, 2, 256, { source: DIT_SRC + 'DiT-B/2 (12 capas, 768, 12 cabezas).' }),
    'dit-xl2-256-fm': ditCfg(XL, 2, 256, { train: 1, learnSigma: false, sampler: 'euler', label: 'DiT-XL/2 @ 256 · un paso de flow matching',
      source: DIT_SRC + 'el mismo DiT-XL/2 entrenado con flow matching (rectified flow: x_t = (1 − t)x₀ + tε, objetivo v = ε − x₀; Lipman et al. 2023, arXiv:2210.02747; Liu et al. 2023, arXiv:2209.03003), sin Σ: la salida tiene 4 canales (v̂). El DiT original se entrena con DDPM (ε y Σ); SiT (Ma et al. 2024, arXiv:2401.08740) entrena la misma arquitectura con interpolantes.' }),
  };

  function ditApply(c, ov) {
    const notes = [];
    if (ov.train !== undefined) { c.train = ov.train; if (c.train) { c.learnSigma = false; c.sampler = 'euler'; } }
    if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
    if (ov.patch !== undefined) c.P = ov.patch;
    ['steps', 'cfg', 'B'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    if (c.cfg > 1) throw new Error('cfg debe ser 0 (sin classifier-free guidance) o 1 (con CFG: 2 evaluaciones por paso).');
    if (c.train > 1) throw new Error('train debe ser 1 (paso de flow matching) u omitirse.');
    if (c.H % 8 !== 0 || (c.H / 8) % c.P !== 0) throw new Error('DiT: el latente ' + c.H / 8 + '×' + c.W / 8 + ' (res/8) debe ser divisible por el patch P = ' + c.P + '.');
    if (ov.res !== undefined || ov.patch !== undefined) {
      c.label = (c.train ? 'DiT-' + c.size + '/' + c.P + ' @ ' + c.H + ' · un paso de flow matching' : 'DiT-' + c.size + '/' + c.P + ' @ ' + c.H);
      delete c.paperGflops;
    }
    if (ov.train && !/flow/.test(c.label)) c.label += ' · un paso de flow matching';
    c._notes = notes;
    return c;
  }
  function ditResolve(c) {
    c.res = c.H;
    c.I = c.H / c.f;
    c.gh = c.I / c.P;
    c.N = c.gh * c.gh;
    c.tokens = c.N;
    c.dh = c.D / c.h;
    c.Dmlp = 4 * c.D;
    c.outC = c.learnSigma ? 2 * c.latentC : c.latentC;
    c.nfePerStep = c.cfg ? 2 : 1;
    c.nfe = c.steps * c.nfePerStep;
    return c;
  }
  function ditBuild(c, A) {
    const g = A.graph(c);
    const lat = () => shp(['I', 'I', String(c.latentC)], [c.I, c.I, c.latentC], 'lat', 'grid');
    const t = g.input('timestep', shp(['1'], [1], null, 'vec'), { label: c.train ? 'Tiempo t ∈ [0, 1] (al azar)' : 'Paso de ruido t', tex: 't' });
    const y = g.input('class', shp(['1'], [1], null, 'vec'), { label: 'Clase y (id de ImageNet; la clase nula ∅ = ' + c.K + ' para CFG)', tex: 'y' });
    let xt, x0, eps;
    if (c.train) {
      x0 = g.input('x0', lat(), { label: 'Latente limpio x₀ (I × I × 4, del encoder del VAE)', tex: 'x_0' });
      eps = g.input('eps', lat(), { label: 'Ruido ε ~ N(0, I) (I × I × 4)', tex: '\\varepsilon' });
      xt = g.op('interp', A.add_noise(x0, eps, t, { kind: 'flow' }), { path: ['interp'], where: ['Flow matching'], out: 'x-t', label: 'Interpolar: x_t = (1 − t)·x₀ + t·ε', type: 'tensorop', group: 'other',
        outMeta: { label: 'Latente interpolado x_t (I × I × 4)', tex: 'x_t' } });
    } else {
      xt = g.input('x-t', lat(), { label: 'Latente con ruido x_t (I × I × 4)', tex: 'x_t' });
    }
    // flow matching (train): toda la red bajo el nodo `model` de la vista flow-matching (path model › …; ids iguales)
    const gm = c.train ? { op: (id, res, o) => g.op(id, res, Object.assign({}, o, { path: ['model'].concat(o.path) })) } : g;
    const out = ditNet(gm, xt, t, y, c);
    if (c.train) {
      const v = g.op('v-target', A.flow_target(x0, eps), { path: ['v-target'], where: ['Flow matching'], out: 'v-target', label: 'Velocidad objetivo v = ε − x₀', type: 'tensorop', group: 'other',
        outMeta: { label: 'Velocidad objetivo v = ε − x₀ (I × I × 4)', tex: 'v' } });
      g.op('loss', A.mse_loss(out, v, { target: 'v' }), { path: ['loss'], where: ['Pérdida'], out: 'loss', label: 'MSE entre v̂ y v', type: 'head', group: 'head',
        outMeta: { label: 'Pérdida ‖v̂ − v‖²', tex: '\\lVert\\hat v - v\\rVert^2' } });
    }
    return g;
  }

  function ditQuantities(c, r) {
    const n = r.totals.byNode, z = { params: 0, macs: 0 }, nd = (id) => n[id] || z;
    // path blocks › … (o model › blocks › … en el paso de flow matching, knob train: 1)
    const inBlocks = (op) => op.path[c.train ? 1 : 0] === 'blocks';
    const blockParams = r.ops.filter(inBlocks).reduce((s, op) => s + op.params, 0);
    const blockMacs = r.ops.filter(inBlocks).reduce((s, op) => s + op.macs, 0);           // UN bloque, una NFE
    const blocksMacs = sumOps(r.ops.filter(inBlocks), () => true);                        // los L bloques, una NFE
    const adalnBlock = (r.ops.find((op) => op.id === 'adaln') || {}).params || 0;
    const embedderParams = nd('t-embed').params + nd('y-embed').params;
    const tEmbedMacs = nd('t-embed').macs;
    const vs = vaeStats(c, c.H);
    const scoreMacs = sumOps(r.ops, isScore);
    return Object.assign({
      tokens: c.N, N: c.N, I: c.I, P: c.P, D: c.D, L: c.L, h: c.h, dh: c.dh, Dmlp: c.Dmlp, K: c.K, res: c.H, latentC: c.latentC, outC: c.outC, freqDim: c.freqDim, freqCount: c.freqDim / 2,
      latentValues: c.I * c.I * c.latentC, pixelValues: c.H * c.W * 3, compressionFactor: (c.H * c.W * 3) / (c.I * c.I * c.latentC), patchValues: c.P * c.P * c.latentC,
      ditParams: r.totals.params, ditMacs: r.totals.macs, blockParams, blockMacs, blocksMacs, blocksSamplingMacs: c.nfe * blocksMacs, adalnParamsBlock: adalnBlock,
      adalnParams: c.L * adalnBlock + nd('adaln-final').params,   // los L bloques + la capa final (node.adaln = solo los bloques)
      embedderParams, tEmbedParams: nd('t-embed').params, yEmbedParams: nd('y-embed').params, tEmbedMacs,
      posEmbedValues: c.N * c.D, officialParams: r.totals.params + c.N * c.D,
      diffusersParams: r.totals.params + (c.L - 1) * embedderParams, diffusersMacs: r.totals.macs + c.L * tEmbedMacs,
      scoreMacsDit: scoreMacs, scoreShareDit: scoreMacs / r.totals.macs,
      vaeDecoderParams: vs.decoderParams, vaeDecoderMacs: vs.decoderMacs, vaeEncoderParams: vs.encoderParams, vaeEncoderMacs: vs.encoderMacs,
      steps: c.steps, cfg: c.cfg, cfgScale: c.cfgScale, nfe: c.nfe, nfePerStep: c.nfePerStep,
      samplingMacs: c.nfe * r.totals.macs + vs.decoderMacs,
      scaling: String(c.scaling), betaStart: String(c.betaStart), betaEnd: String(c.betaEnd), trainSteps: c.trainSteps,
    }, c.paperGflops ? { paperGflops: c.paperGflops, macsVsPaper: r.totals.macs / (c.paperGflops * 1e9) } : {});
  }

  function ditMetrics(c, r, o) {
    const ov = o.overrides || {}, hw = hwOf(ov), q = r.quantities, B = o.B;
    const dn = roof(q.ditMacs, B * c.nfePerStep, q.ditParams, hw), vd = roof(q.vaeDecoderMacs, B, q.vaeDecoderParams, hw);
    const samplingMs = c.steps * dn.ms + vd.ms;
    const arch = archOf(r);
    const at = (o2) => A.run(r.id, Object.assign({}, arch, o2));
    const row = (rr) => {
      const qq = rr.quantities, cc = rr.config;
      const d2 = roof(qq.ditMacs, B * cc.nfePerStep, qq.ditParams, hw), v2 = roof(qq.vaeDecoderMacs, B, qq.vaeDecoderParams, hw);
      const ms = cc.steps * d2.ms + v2.ms;
      return { tokens: cc.N, ditMacs: qq.ditMacs, ditParams: qq.ditParams, scoreShareDit: qq.scoreShareDit, samplingMacs: qq.samplingMacs, samplingMs: ms, msPerImage: ms / B };
    };
    const out = {
      ditMacs: q.ditMacs, ditParams: q.ditParams, officialParams: q.officialParams, diffusersParams: q.diffusersParams, diffusersMacs: q.diffusersMacs,
      embedderParams: q.embedderParams, blockParams: q.blockParams, adalnParams: q.adalnParams, adalnParamsShare: q.adalnParams / q.ditParams, tEmbedMacs: q.tEmbedMacs,
      vaeDecoderMacs: q.vaeDecoderMacs, vaeEncoderMacs: q.vaeEncoderMacs, vaeDecoderParams: q.vaeDecoderParams, vaeEncoderParams: q.vaeEncoderParams,
      vaeParams: q.vaeDecoderParams + q.vaeEncoderParams, textEncoderMacs: 0, textEncoderParams: 0,
      steps: c.steps, nfePerStep: c.nfePerStep, nfe: c.nfe, cfgCostFactor: c.nfePerStep, sequentialPasses: c.steps, freqCount: q.freqCount,
      blockMacs: q.blockMacs, blocksMacs: q.blocksMacs, blocksSamplingMacs: q.blocksSamplingMacs,
      samplingMacs: q.samplingMacs, samplingMacsNoCfg: c.steps * q.ditMacs + q.vaeDecoderMacs,
      denoiserSamplingMacs: c.nfe * q.ditMacs, denoiserSamplingShare: (c.nfe * q.ditMacs) / q.samplingMacs, vaeDecoderShare: q.vaeDecoderMacs / q.samplingMacs,
      latentShape: c.I + '×' + c.I + '×' + c.latentC, latentH: c.I, latentW: c.I, latentTokens: c.N, latentValues: q.latentValues, pixelValues: q.pixelValues,
      compressionFactor: q.compressionFactor, spatialFactor: c.f,
      scoreMacsDit: q.scoreMacsDit, scoreShareDit: q.scoreShareDit,
      paperGflops: q.paperGflops != null ? q.paperGflops : null, macsVsPaper: q.macsVsPaper != null ? q.macsVsPaper : null,
      adalnParamsShareBlock: q.adalnParamsBlock / q.blockParams,
      ditNfeMs: dn.ms, ditNfeUs: 1000 * dn.ms, ditBound: dn.bound, vaeDecodeMs: vd.ms, samplingMs, msPerImage: samplingMs / B, imagesPerSecUpperBound: (1000 * B) / samplingMs,
      denoiserIntensity: dn.intensity, ridgePoint: hw.peakFlops / hw.bandwidth, weightBytes: 2 * q.ditParams,
      bandwidth: hw.bandwidth, peakFlops: hw.peakFlops, hardwareSource: HW.source,
      units: UNITS,
    };
    out.patchScaling = [2, 4, 8].filter((P) => (c.I % P === 0)).map((P) => Object.assign({ P }, row(at({ patch: P }))));
    out.resScaling = [256, 512, 1024].filter((res) => (res / 8) % c.P === 0).map((res) => Object.assign({ res, latentShape: res / 8 + '×' + res / 8 + '×' + c.latentC }, row(at({ res }))));
    out.stepsScaling = [10, 25, 50, 100, 250].map((steps) => Object.assign({ steps }, row(at({ steps }))));
    out.cfgScaling = [0, 1].map((cfg) => Object.assign({ cfg }, row(at({ cfg }))));
    return out;
  }

  A.defineModel({
    id: 'dit',
    label: 'DiT (Diffusion Transformer, adaLN-Zero)',
    paper: { title: 'Scalable Diffusion Models with Transformers', authors: 'Peebles, Xie', venue: 'ICCV 2023', year: 2023, arxiv: '2212.09748',
      note: 'Flow matching: Lipman et al., ICLR 2023, arXiv:2210.02747. Rectified flow: Liu et al., ICLR 2023, arXiv:2209.03003. SD3 / MMDiT: Esser et al., ICML 2024, arXiv:2403.03206.' },
    configs: DIT_CONFIGS,
    knobs: { res: [256, 512, 1024], patch: [2, 4, 8], steps: [10, 25, 50, 100, 250], cfg: [0, 1], B: [1, 4, 16], train: [1] },
    zeroKnobs: ['cfg'],
    hardware: Object.assign({}, HW),
    applyKnobs: ditApply, resolve: ditResolve, build: ditBuild, quantities: ditQuantities, metrics: ditMetrics,
  });
})(typeof window !== 'undefined' ? window : globalThis);
