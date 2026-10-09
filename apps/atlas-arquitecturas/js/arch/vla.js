/* =============================================================================
   Atlas de Arquitecturas — js/arch/vla.js
   Modelos `openvla` y `pi0` (páginas `openvla` y `pi0`; contrato SPEC §21) + ayudas de RT-2 (sin config: pesos cerrados).
   Tesis: un VLA = un VLM cuya salida son acciones; lo que cambia es CÓMO se representan (tokens discretos vs un chunk
   continuo), CÓMO se decodifican (autorregresivo vs flow matching) y cuánto cuesta en Hz. Cargar DESPUÉS de llm.js (compone
   su decoder con A.importGraph, como vlm.js) y de vlm.js / diffusion.js (solo por orden de carga).
   - OpenVLA: Kim et al., OpenVLA: An Open-Source Vision-Language-Action Model, CoRL 2024, arXiv:2406.09246; Prismatic VLMs:
     Karamcheti et al., ICML 2024, arXiv:2402.07865. Dimensiones = HF openvla/openvla-7b (rev. 47a0ec7): config.json
     (timm_model_ids vit_large_patch14_reg4_dinov2.lvd142m + vit_so400m_patch14_siglip_224, image_sizes 224, arch_specifier
     no-align+fused-gelu-mlp, text_config vocab 32,064 = 32,000 + <PAD> + relleno a múltiplo de 64, n_action_bins 256) y
     modeling_prismatic.py (PrismaticVisionBackbone, PrismaticProjector, OpenVLAForActionPrediction.predict_action). Total
     7,541,237,184 parámetros = model.safetensors.index.json (total_size 15,082,474,368 bytes en bf16 / 2): EXACTO.
   - π0: Black et al., π0: A Vision-Language-Action Flow Model for General Robot Control, arXiv:2410.24164 (RSS 2025); código
     oficial Physical-Intelligence/openpi (main @ 215abfb, 2026-08-24): src/openpi/models/{pi0.py, pi0_config.py, gemma.py,
     siglip.py} y el port de PyTorch models_pytorch/{pi0_pytorch.py, gemma_pytorch.py}.
   Cross-check: crosscheck/vla.py (timm 1.0.30 + HF Llama / PaliGemma / Gemma en el dispositivo META, FlopCounterMode).

   ---------------------------------------------------------------- convenciones y símbolos
   Formas sin batch. LLM (los de F6): D, L, h, G, d_h, D_mlp, V. Prompt: T = tokens de TEXTO (OpenVLA: con <BOS> y el token
   29871 que agrega predict_action; π0: el largo FIJO max_token_len = 48, relleno incluido), N = tokens visuales (todas las
   imágenes), N + T = prompt / prefijo. N_p = parches de UNA imagen (256 a 224 px con patch 14), P = patch, H × W × C = imagen.
   Torres de OpenVLA: DINOv2 → D_d, h_d, d_d, 4D_d, L_d; SigLIP → D_s, h_s, d_s, M_s (= 4,304: MLP de So400m, no 4D_s), L_s;
   D_v = D_d + D_s (= 2,176, features fusionadas), 4D_v (capa oculta del proyector). π0: SigLIP con D_s, h_s, d_s, M_s, L_s;
   experto de acción D_a (= 1,024), 4D_a (FFN), con las MISMAS h, G y d_h que Gemma (h·d_h = 2,048 ≠ D_a); d_a = dimensión de
   la acción (OpenVLA 7; π0 32 con relleno; también el estado), H_a = largo del chunk (50; knob `H`), 1 + H_a = sufijo
   (estado + acciones). OJO: en la config `H` es el ALTO de la imagen (224); el chunk es cfg.Ha (el knob se llama H por la SPEC).
   Config (para {{cfg.*}} y la práctica): H, W, C, P, Np, N, T, S (= N + T), D, L, h, G, dh, Dmlp, V, da; OpenVLA Dd, Ld, hd, dd,
   Dmlpd, Ds, Ls, hs, ds, Ms, Dv, Dproj (= 4D_v), bins, images, res; π0 cams, Ds, Ls, hs, ds, Ms, Da, Dmlpa, Ha, steps, suffix (= 1 + H_a),
   ctx (= N + T + 1 + H_a, filas de K/V que lee un paso de flow).

   ---------------------------------------------------------------- OpenVLA (modelo `openvla`, config `openvla-7b`)
   Knobs: T (tokens de texto, ≥ 2), res (lado de la imagen, múltiplo de 14: what-if; las tablas de posición se interpolan desde
   16×16 y sus parámetros pasan a N_p·D), images (vistas: torres y proyector × images con los mismos pesos, op.paramRepeat = 1),
   da (dimensiones de la acción = tokens por paso: 1 prefill + d_a − 1 decodes).
   Grafo = UNA acción: prefill (visión + proyector + Llama 2 sobre N + T filas, logits sobre todas, como el forward de HF) + los
   d_a − 1 = 6 pasos de decode que faltan (op ar-decode: la 1.ª acción sale del prefill) + detokenizar. totals.macs = MACs por
   acción (= metrics().macsPerAction); metrics().prefillMacs = sin el decode.
   Visión (timm 0.9.x, que exige el código de HF: get_intermediate_layers(n = {L − 2}) corre TODOS los bloques y devuelve la
   salida del penúltimo SIN tokens prefijo y sin norma final): DINOv2 ViT-L/14 con 4 registros (24 capas, 1024, 16 cabezas, MLP
   4096, LayerScale, posición solo para los parches: no_embed_class) y SigLIP So400m/14 (27 capas, 1152, 16 cabezas, MLP 4304,
   sin CLS). Ambas a 224 px → 256 parches. Lo que no se usa: la última capa de cada torre (se CALCULA y se descarta: ops
   dino-last-layer / sig-last-layer) y los parámetros de las normas finales y del attention pooling (MAP) de SigLIP (ops
   idle_params: existen en el checkpoint, 0 MACs). Proyector "fused-gelu-mlp": TRES lineales 2176 → 8704 → 4096 → 4096 con
   GELU entre medio (el paper dice "2-layer MLP"; el checkpoint y modeling_prismatic.py tienen fc1, fc2, fc3).
   Acciones: 7 tokens (Δpos 3, Δrot 3, pinza 1) = ids V_tok − bin, bin ∈ [1, 256] (np.digitize sobre 256 bordes en [−1, 1]):
   los ids 31,744–31,999 = los 256 últimos del tokenizer de Llama (32,000); detokenizar = centro del bin (255 centros: los bins
   255 y 256 caen en el mismo) y desnormalizar con q01 / q99 del dataset.
   Ops (path) — vista `openvla-overview`:
     image          tensor pixels (H×W×C)
     dinov2         dino-normalize (dinov2 › normalize) pixels → d-pixels; dino-patch-embed (› patch-embed) → d-patch-grid (H/P×W/P×D_d);
                    dino-patch-flatten (› patch-embed) → d-patches (N_p×D_d); dino-pos-embed (› pos-embed) → d-e-pos; dino-add-pos
                    (› add-pos) → d-x-pos; dino-prefix (› prefix-tokens: CLS + 4 registros) → d-x0 ((N_p+5)×D_d); capa
                    (repeat L_d − 1, path dinov2 › enc-layer › …): dino-ln1 · dino-qkv · dino-split · dino-scores · dino-scale ·
                    dino-softmax · dino-weighted-sum · dino-merge · dino-proj · dino-ls1 · dino-res1 · dino-ln2 · dino-fc1 · dino-gelu ·
                    dino-fc2 · dino-ls2 · dino-res2 (nodos ln1, mhsa › {qkv, split, scores, scale, softmax, weighted-sum, merge, proj},
                    ls1, res1, ln2, mlp › {fc1, gelu, fc2}, ls2, res2) con tensores d-h-ln1 d-qkv d-q d-k d-v d-scores
                    d-scores-scaled d-attn d-z-heads d-z d-o d-o-ls d-r1 d-h-ln2 d-u d-g d-f d-f-ls → d-x-out (salida de la capa 23
                    = la penúltima); dino-last-layer (› last-layer) → d-x-last (descartada); dino-take-patches (› select) → d-feats
                    (N_p×D_d, sin los 5 prefijos); dino-idle (› norm: la LayerNorm final, sin uso)
     siglip         sig-normalize → s-pixels; sig-patch-embed → s-patch-grid (H/P×W/P×D_s); sig-patch-flatten → s-patches;
                    sig-pos-embed → s-e-pos; sig-add-pos → s-x0 (N_p×D_s); capa (repeat L_s − 1): sig-ln1 … sig-res2 (como
                    preLnLayer: tensores s-h-ln1 s-qkv s-q s-k s-v s-scores s-scores-scaled s-attn s-z-heads s-z s-o s-r1 s-h-ln2 s-u
                    s-g s-f) → s-feats (N_p×D_s, salida de la capa 26); sig-last-layer → s-x-last (descartada); sig-idle (› head:
                    norma final + attention pooling MAP, sin uso)
     concat         concat (concat) d-feats, s-feats → vis-feats (N_p×D_v)
     projector      proj-fc1 (projector › fc1) → proj-h1 (N_p×4D_v); proj-gelu1 (› gelu1) → proj-a1; proj-fc2 (› fc2) → proj-h2
                    (N_p×D); proj-gelu2 (› gelu2) → proj-a2; proj-fc3 (› fc3) → vis-tokens (N_p×D)
     instruction    tensor text-ids (T)
     embed          embed (embed) text-ids → text-emb (T×D)
     merge          splice (merge) text-emb, vis-tokens → prompt ((N+T)×D; los parches van DESPUÉS de <BOS>)
     llm            decoder de llm.js importado (repeat L): norm1 q-proj k-proj v-proj split rope-q rope-k scores scale mask softmax
                    weighted-sum merge o-proj res1 norm2 gate-proj up-proj silu mul down-proj res2 (path llm › block › …),
                    final-norm (llm › final-norm); tensores de F6 (h-norm1 q k v q-heads … x-out x-norm) con T → N+T
     lm-head        lm-head → logits ((N+T)×V)
     action-tokens  sample (action-tokens) logits → next-token (1: el 1.er token de acción); ar-decode (action-tokens) next-token →
                    action-tokens (d_a: los 7 ids; 6 pasos de decode con la KV cache, ctx = N + T + 1 … N + T + 6)
     detokenize     detokenize (detokenize) action-tokens → action (d_a)
     action         tensor action (d_a: Δx, Δy, Δz, Δroll, Δpitch, Δyaw, pinza)

   ---------------------------------------------------------------- π0 (modelo `pi0`, configs `pi0` (3 cámaras), `pi0-1cam`)
   Grafo = UN chunk: prefijo una vez (SigLIP por cámara + proyector, embedding del texto, Gemma 2B sobre N + T filas, que deja la
   KV cache) + `steps` pasos de flow (sufijo de 1 + H_a tokens por el experto de acción, que lee la KV cache del prefijo) + Euler.
   totals.macs = prefixMacs + steps · flowStepMacs = macsPerChunk. VLM = PaliGemma 3B: SigLIP So400m/14 @ 224 (27 capas, pool
   "none", LayerNorm final encoder_norm) + "head" Dense 1152 → 2048 (= multi_modal_projector de HF) + Gemma 2B (18 capas, 2048,
   8 cabezas, 1 KV (MQA), d_h 256, FFN GeGLU 16,384, vocab 257,152 = PALIGEMMA_VOCAB_SIZE, embedding atado; el LM head NO corre).
   Experto (gemma_300m): 18 capas, ancho 1024, FFN 4096, 8 cabezas, 1 KV, d_h 256 (311,463,936 en las capas: el "311M" de
   gemma.py) + su norma final. Atención conjunta (mixture of transformers): cada grupo de tokens usa SUS pesos (Q, K, V, O, FFN,
   normas) y una sola atención sobre la concatenación con máscara por bloques (make_attn_mask, ar_mask): imágenes + texto se ven
   entre sí (bidireccional), el estado ve el prefijo y a sí mismo, las acciones ven todo. En inferencia (sample_actions) el
   prefijo corre UNA vez y su KV se reutiliza en los `steps` pasos (el experto no corre en el prefijo; Gemma no corre en el sufijo).
   Sufijo: state_proj (32 → 1024), action_in_proj (32 → 1024), tiempo posemb_sincos(τ, 1024, min 4e-3, max 4) repetido en las
   H_a filas, concat (2048) → action_time_mlp_in (2048 → 1024) → swish → action_time_mlp_out (1024 → 1024); salida: las últimas H_a
   filas → action_out_proj (1024 → 32) = v_t; Euler x ← x + dt·v_t con dt = −1/steps (openpi integra de τ = 1 (ruido) a 0).
   Ops (path) — vista `pi0-overview`:
     images         tensor pixels (H×W×C, POR cámara; las cams corren con los mismos pesos: repeat × cams, paramRepeat 1)
     siglip         sig-patch-embed (siglip › patch-embed) → s-patch-grid; sig-patch-flatten → s-patches (N_p×D_s); sig-pos-embed
                    (› pos-embed) → s-e-pos; sig-add-pos (› add-pos) → s-x0; capa (repeat cams·L_s, paramRepeat L_s): sig-ln1 … sig-res2
                    (tensores s-…) → s-x-out; sig-ln-post (› ln-post: encoder_norm) → s-feats (N_p×D_s); img-proj (› img-proj:
                    head Dense D_s → D, con sesgo) → img-tokens (N_p×D)
     language       tensor lang-ids (T); embed (language) → lang-emb (T×D; ×√D elementwise)
     gemma          prefix-concat (gemma › prefix-concat) lang-emb, img-tokens → prefix ((N+T)×D); Gemma 2B importado de llm.js
                    (repeat L, path gemma › block › …): norm1 q-proj k-proj v-proj split rope-q rope-k scores scale mask (máscara
                    del PREFIJO: bidireccional + relleno) softmax weighted-sum merge o-proj res1 norm2 gate-proj up-proj gelu (GELU
                    tanh: la op silu de F6 renombrada) mul down-proj res2; final-norm (gemma › final-norm, su salida no se usa).
                    Tensores de F6 con T → N+T; k-rope y v-heads (G×(N+T)×d_h) = la KV cache del prefijo (por capa).
     state          tensor state (1×d_a); state-proj (state) → state-tok (1×D_a)
     noisy-actions  tensor x-t (H_a×d_a: x_τ, ruido en τ = 1); action-in-proj (noisy-actions) → act-emb (H_a×D_a)
     t-embed        tensor tau (1); t-sincos (t-embed › sincos) → t-emb (D_a); t-broadcast (t-embed › broadcast) → t-tokens
                    (H_a×D_a); at-concat (t-embed › concat) act-emb, t-tokens → at-cat (H_a×2D_a); at-mlp-in (t-embed › mlp-in) →
                    at-h (H_a×D_a); at-swish (t-embed › swish) → at-act; at-mlp-out (t-embed › mlp-out) → act-tokens (H_a×D_a)
     action-expert  suffix-concat (action-expert › suffix-concat) state-tok, act-tokens → suffix ((1+H_a)×D_a); capa (repeat
                    steps·L, paramRepeat L; path action-expert › block › …): ae-norm1 (norm1) → a-h-norm1; ae-q-proj (attn › q-proj,
                    D_a → h·d_h) → a-q; ae-k-proj / ae-v-proj (D_a → G·d_h) → a-k / a-v; ae-split → a-q-heads (h×(1+H_a)×d_h),
                    a-k-heads, a-v-heads (G×(1+H_a)×d_h); ae-rope-q / ae-rope-k (attn › rope) → a-q-rope, a-k-rope; ae-kv-k /
                    ae-kv-v (attn › kv-cache: [K, V del prefijo de Gemma; las del sufijo]) k-rope + a-k-rope → a-k-all, v-heads +
                    a-v-heads → a-v-all (G×(N+T+1+H_a)×d_h); ae-scores → a-scores (h×(1+H_a)×(N+T+1+H_a)); ae-scale →
                    a-scores-scaled; ae-mask (attn › mask: por bloques) → a-masked; ae-softmax → a-attn; ae-weighted-sum → a-z-heads;
                    ae-merge → a-z ((1+H_a)×h·d_h); ae-o-proj (h·d_h → D_a) → a-o; ae-res1 → a-r1; ae-norm2 → a-h-norm2;
                    ae-gate-proj / ae-up-proj (ffn › …, D_a → 4D_a) → a-gate / a-up; ae-gelu → a-act; ae-mul → a-prod; ae-down-proj →
                    a-f; ae-res2 → a-x-out; ae-final-norm (action-expert › final-norm) → a-x-norm
     velocity       take-actions (velocity › take: las últimas H_a filas) → a-act-out (H_a×D_a); action-out-proj (velocity › proj)
                    → velocity (H_a×d_a)
     euler          euler-step (euler; repeat steps) x-t, velocity → action-chunk (H_a×d_a)
     action-chunk   tensor action-chunk (H_a×d_a: el chunk tras los `steps` pasos)

   ---------------------------------------------------------------- desviaciones respecto de SPEC §21 (nada renombrado)
   - OpenVLA: el proyector tiene TRES lineales (fc1 2176→8704, fc2 8704→4096, fc3 4096→4096; GELU tras fc1 y fc2), no 2 (la
     SPEC y el paper dicen "2-layer MLP"): manda el checkpoint. Nodos internos fc1, gelu1, fc2, gelu2, fc3 (scope 'projector').
   - OpenVLA: macsPerAction = prefill + 6 pasos de decode (no 7): la 1.ª acción sale del propio prefill (generate con
     max_new_tokens = 7 hace 1 prefill + 6 decodes). DINOv2 lleva 4 registros (reg4: 1 + 4 tokens prefijo, (N_p+5)×D_d dentro de
     la torre) y las dos torres corren su ÚLTIMA capa aunque se use la penúltima (timm 0.9). T por defecto = 22 (plantilla "In:
     What action should the robot take to put the eggplant in the pot?\nOut:" con el tokenizer del checkpoint: 21 + el 29871).
   - OpenVLA: nodos extra dentro de las torres (normalize, prefix-tokens, enc-layer, last-layer, select, norm, head); tensores
     extra pixels, d-*, s-*, vis-feats, proj-h1/a1/h2/a2, text-ids, next-token, action-tokens, action.
   - π0: el knob `H` (chunk) se guarda en cfg.Ha (cfg.H es el alto de la imagen); el símbolo del chunk es H_a. d_a = 32 (acción y
     estado con relleno). T = 48 = max_token_len de Pi0Config (el prompt se rellena hasta 48; el relleno se calcula y se enmascara).
   - π0: el proyector de imagen (head de SigLIP en openpi) es la op img-proj bajo `siglip` (siglip › img-proj); prefix-concat bajo `gemma`; la op
     GeGLU de Gemma se llama `gelu` (en F6 es `silu`); `mask` de Gemma = máscara del prefijo (bidireccional), no causal.
   - π0 'pi0-1cam': la misma red con 1 cámara (el config base de openpi tiene 3 ranuras; con menos cámaras las ranuras vacías se
     rellenan con ceros y se enmascaran, pero SE CALCULAN: el costo real de openpi con una cámara es el de `pi0`).
   - RT-2: sin config (pesos y arquitectura exacta cerrados). ATLAS.Arch.vla.rt2Tokens / discretize / binCenter / openvlaTokenize /
     openvlaDetokenize para la calculadora de tokens y la viz action-tokenizer; pi0Mask para la viz pi0-mask.
   - Primitivas de la fase 9 (en primitives.js desde la revisión; antes locales por la concurrencia de la fase 8): normalize_pixels,
     prefix_tokens, broadcast_rows, prefix_mask, block_causal_mask, ar_decode, detokenize_actions (ATLAS.Arch.vla.primitives()
     las lista). El resto reusa primitives.js (linear, conv2d, layernorm, rmsnorm, layer_scale, gelu, silu, mul, rope, split_gqa_heads,
     kv_append, attention_*, concat_features, concat_tokens, splice_tokens, take_rows, timestep_embedding, scheduler_step,
     idle_params, transformer_block, preLnLayer, importGraph).

   ---------------------------------------------------------------- metrics() (unidades en metrics.units)
   Hardware (≈ roofline: máx(FLOPs / pico, bytes / ancho de banda) por segmento; bytes = pesos leídos una vez (sin la tabla de
   embedding ni los parámetros sin uso) + filas de embedding + KV escrita/leída; sin activaciones ni overheads): H100 SXM (el de
   llm.js: 989 TFLOPS bf16 denso, 3.35 TB/s), RTX 4090 (NVIDIA Ada GPU Architecture whitepaper, Apéndice A: 165.2 TFLOPS BF16
   Tensor con acumulación FP32, densos; 1,008 GB/s), Jetson AGX Orin 64GB (Technical Brief v1.2, Tabla 1: 204.8 GB/s LPDDR5; GPU
   Ampere 2048 CUDA / 64 Tensor cores a 1.3 GHz; el datasheet da 85 TFLOPS FP16 CON sparsity → ≈ 42.5 TFLOPS FP16 densos = 85 / 2:
   DERIVADO, ≈). bandwidth / peakFlops en overrides = hardware propio (claves …Ms / hz sin sufijo).
   OpenVLA: visualTokens, textTokens, promptTokens, actionTokensPerStep (= d_a), actionBins, decodeSteps (count); dinoParams,
     siglipParams, visionParams, visionParamsUsed, idleParams, projectorParams, llmParams, embedParams, totalParams (params);
     dinoMacs, siglipMacs, visionMacs, visionMacsDiscarded, projectorMacs, llmPrefillMacs, prefillMacs, decodeMacsPerToken (1.er
     decode, ctx = N + T + 1), decodeMacsTotal, macsPerAction (macs); prefillShare, visionMacsShare (pct); kvBytesPerToken,
     kvBytesPrompt, weightBytes (todo el checkpoint), decodeWeightBytesRead (pesos del LLM sin la tabla de embedding que lee CADA
     paso de decode: 2·(llmParams − embedParams) ≈ 13.2 GB) (bytes); visionMs, prefillMs, decodeMs (un paso), actionMs (ms) y hz (ratio) + los mismos con
     sufijo H100 / Rtx4090 / Orin; actionBound ('cómputo' | 'memoria' del prefill); hardware (lista por GPU); paperHz (6, §3.5).
   π0: cams, visualTokens, visualTokensPerImage, textTokens, prefixTokens, suffixTokens, kvRows, chunk, steps, actionDim (count);
     siglipParams, imgProjParams, gemmaParams, paligemmaParams, expertParams, actionProjParams, totalParams (params); visionMacs,
     gemmaPrefixMacs, prefixMacs, flowStepMacs, expertStepMacs, flowMacs (steps × paso), macsPerChunk, macsPerAction (macs);
     prefixShare, flowShare (pct); kvBytesPerToken, prefixKvBytes, weightBytes (bytes); imageMs, prefixMs, flowStepMs, flowMs,
     chunkMs (ms), chunkHz (ratio: chunks/s si se encadenan), actionsPerSecond (ratio: H_a · chunkHz, cota), + sufijos por GPU;
     chunkRates (lista: control a 50 / 20 Hz ejecutando 25 / 16 acciones por chunk, del paper); stepsScaling, chunkScaling,
     camsScaling; paperLatency (Tabla I del paper: 14 / 32 / 27 / 73 ms en RTX 4090). Ver VLA_UNITS.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('vla.js necesita js/arch/primitives.js antes.');
  if (!A.hasConfig || !A.hasConfig('llama2-7b')) throw new Error('vla.js necesita js/arch/llm.js antes (compone su decoder).');
  const LLMDEF = A.model('llm');
  const fint = (n) => A.fmt.int(n);
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);

  // ------------------------------------------------------------------ hardware (≈, entradas del roofline)
  const H100 = Object.assign({ id: 'h100', label: 'H100 SXM' }, LLMDEF.hardware);
  const HARDWARE = [
    { id: 'h100', key: 'H100', label: 'H100 SXM', bandwidth: H100.bandwidth, peakFlops: H100.peakFlops, source: H100.source },
    { id: 'rtx4090', key: 'Rtx4090', label: 'RTX 4090', bandwidth: 1008e9, peakFlops: 165.2e12,
      source: 'NVIDIA Ada GPU Architecture whitepaper, Apéndice A (GeForce RTX 4090): 165.2 TFLOPS BF16 Tensor con acumulación FP32 (densos; 330.4 con dispersidad), 1,008 GB/s GDDR6X' },
    { id: 'orin', key: 'Orin', label: 'Jetson AGX Orin 64GB', bandwidth: 204.8e9, peakFlops: 42.5e12, estimate: true,
      source: 'NVIDIA Jetson AGX Orin Series Technical Brief v1.2, Tabla 1: 204.8 GB/s LPDDR5; GPU Ampere de 2048 CUDA cores y 64 Tensor cores a 1.3 GHz. Cómputo: 85 TFLOPS FP16 (con sparsity, datasheet) ÷ 2 ≈ 42.5 denso (≈)' },
  ];

  // ------------------------------------------------------------------ primitivas de la fase 9 (en primitives.js)
  // normalize_pixels, prefix_tokens, broadcast_rows, prefix_mask, block_causal_mask, ar_decode y detokenize_actions vivían aquí
  // (fase 8 en paralelo) y se movieron a primitives.js con el mismo contrato y los mismos números. A.vla.prims / A.vla.primitives()
  // siguen dando las 7 (compatibilidad).
  const VLA_PRIM_IDS = ['normalize_pixels', 'prefix_tokens', 'broadcast_rows', 'prefix_mask', 'block_causal_mask', 'ar_decode', 'detokenize_actions'];
  VLA_PRIM_IDS.forEach((id) => { if (typeof A[id] !== 'function') throw new Error('vla.js necesita la primitiva ' + id + ' de js/arch/primitives.js.'); });
  const P = Object.fromEntries(VLA_PRIM_IDS.map((id) => [id, A[id]]));

  // ------------------------------------------------------------------ el decoder de llm.js (como vlm.js)
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
  const llmDecodeMacs = (c, ctx) => sumMacs(llmData(c, 1, { decode: 1, ctx }).data.ops, (o) => o.id !== 'embed');
  const llmMacs = (c, S) => sumMacs(llmData(c, S).data.ops, (o) => o.id !== 'embed');
  const texT = (s) => (typeof s === 'string' ? s.replace(/(^|[^A-Za-z\\{_])T(?![A-Za-z_])/g, '$1(N{+}T)') : s);

  // Capa ViT pre-LN con LayerScale (DINOv2): mismos ids que preLnLayer + ls1 / ls2 (γ ⊙ salida de la atención y del MLP).
  function lsLayer(g, x, o) {
    const Pp = o.prefix, rep = o.L, prep = o.paramL || o.L;
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    const at = Pp.concat(['mhsa']), ml = Pp.concat(['mlp']);
    const T = (n) => o.tid + n;
    const Lm = (m) => Object.assign({ perLayer: true }, m, { label: o.labelPrefix + m.label });
    const op = (id, res, path, extra) => g.op(o.oid + id, res, Object.assign({ path, repeat: rep, paramRepeat: prep, where: o.where }, extra));
    const hln1 = op('ln1', A.layernorm(x, { eps: 1e-6 }), Pp.concat(['ln1']), { out: T('h-ln1'), label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: Lm({ label: 'Entrada normalizada (LN 1)', tex: '\\mathrm{LN}_1(x)' }) });
    const qkv = op('qkv', A.linear(hln1, { dout: 3 * D, doutSym: '3' + Ds, bias: true }), at.concat(['qkv']), { out: T('qkv'), label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: Lm({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }) });
    const [q, k, v] = op('split', A.split_heads(qkv, { h: o.h, parts: 3, hSym: o.hSym, dhSym: o.dhSym }), at.concat(['split']), {
      out: [T('q'), T('k'), T('v')], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [Lm({ label: 'Queries por cabeza', tex: 'Q' }), Lm({ label: 'Keys por cabeza', tex: 'K' }), Lm({ label: 'Values por cabeza', tex: 'V' })] });
    const sc = op('scores', A.attention_scores(q, k), at.concat(['scores']), { out: T('scores'), label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const ss = op('scale', A.scale(sc), at.concat(['scale']), { out: T('scores-scaled'), label: 'Escala 1/√d', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Scores escalados', tex: 'QK^\\top/\\sqrt{d}' }) });
    const a = op('softmax', A.softmax(ss), at.concat(['softmax']), { out: T('attn'), label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), at.concat(['weighted-sum']), { out: T('z-heads'), label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: Ds }), at.concat(['merge']), { out: T('z'), label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: Lm({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    const ov = op('proj', A.linear(z, { dout: D, doutSym: Ds, bias: true }), at.concat(['proj']), { out: T('o'), label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: Lm({ label: 'Salida de la atención', tex: 'O = ZW_O' }) });
    const ol = op('ls1', A.layer_scale(ov, { init: 1e-5 }), Pp.concat(['ls1']), { out: T('o-ls'), label: 'LayerScale 1 (γ₁ ⊙ atención)', type: 'tensorop', group: 'resid', outMeta: Lm({ label: 'Atención escalada (LayerScale)', tex: '\\gamma_1\\odot O' }) });
    const r1 = op('res1', A.residual_add(x, ol), Pp.concat(['res1']), { out: T('r1'), label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: Lm({ label: 'x + atención', tex: "x'" }) });
    const hln2 = op('ln2', A.layernorm(r1, { eps: 1e-6 }), Pp.concat(['ln2']), { out: T('h-ln2'), label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: Lm({ label: 'Entrada normalizada (LN 2)', tex: "\\mathrm{LN}_2(x')" }) });
    const u = op('fc1', A.linear(hln2, { dout: o.Dmlp, doutSym: o.DmlpSym, bias: true }), ml.concat(['fc1']), { out: T('u'), label: 'MLP: capa 1 (expansión)', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'Capa oculta del MLP', tex: 'U' }) });
    const gg = op('gelu', A.gelu(u), ml.concat(['gelu']), { out: T('g'), label: 'GELU', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'Activación', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', A.linear(gg, { dout: D, doutSym: Ds, bias: true }), ml.concat(['fc2']), { out: T('f'), label: 'MLP: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'Salida del MLP', tex: 'F' }) });
    const fl = op('ls2', A.layer_scale(f, { init: 1e-5 }), Pp.concat(['ls2']), { out: T('f-ls'), label: 'LayerScale 2 (γ₂ ⊙ MLP)', type: 'tensorop', group: 'resid', outMeta: Lm({ label: 'MLP escalado (LayerScale)', tex: '\\gamma_2\\odot F' }) });
    return op('res2', A.residual_add(r1, fl), Pp.concat(['res2']), { out: o.outId, label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: Object.assign({ perLayer: false }, o.outMeta, { label: o.labelPrefix + o.outMeta.label }) });
  }

  // Capa descartada (la última de cada torre: timm 0.9 la corre y get_intermediate_layers devuelve la penúltima).
  function lastLayer(x, o) {
    const tb = A.transformer_block(x, { h: o.h, Dmlp: o.Dmlp, DmlpSym: o.DmlpSym });
    if (o.layerScale) {
      const D = x.num[x.num.length - 1], base = tb.params;
      tb.params = base + 2 * D;
      tb.paramArith = fint(base) + ' + 2·' + D + ' = ' + fint(tb.params);
      tb.paramFormula = tb.paramFormula + ' + 2' + A.fmt.symTex(x.sym[1]);
    }
    return tb;
  }

  // ------------------------------------------------------------------ OpenVLA
  const OVLA_SRC = 'Kim et al. 2024 (OpenVLA, CoRL 2024, arXiv:2406.09246), §3.1–3.5; HF openvla/openvla-7b (rev. 47a0ec7): config.json y modeling_prismatic.py ';
  const OPENVLA = {
    'openvla-7b': {
      label: 'OpenVLA 7B', canonical: true, llmLabel: 'Llama 2 7B', llmFamily: 'Llama 2', hf: 'openvla/openvla-7b',
      H: 224, W: 224, C: 3, P: 14,
      Dd: 1024, Ld: 24, hd: 16, Dmlpd: 4096, reg: 4, Ds: 1152, Ls: 27, hs: 16, Ms: 4304, siglipIdle: 15238352 + 2 * 1152,
      D: 4096, L: 32, h: 32, G: 32, dh: 128, Dmlp: 11008, V: 32064, Vtok: 32000, ctxMax: 2048, ropeTheta: 10000, eps: 1e-5, tied: false,
      T: 22, da: 7, bins: 256, images: 1, causal: false,
      instruction: 'put the eggplant in the pot',
      source: OVLA_SRC + '(visión fusionada: timm vit_large_patch14_reg4_dinov2.lvd142m (24 capas, 1024, 16 cabezas, MLP 4096, LayerScale, 4 registros) + vit_so400m_patch14_siglip_224 (27 capas, 1152, 16 cabezas, MLP 4304), ambas a 224 px y con features de la penúltima capa sin prefijos → 256 × (1024 + 1152); proyector fused-gelu-mlp 2176 → 8704 → 4096 → 4096; LLM meta-llama/Llama-2-7b-hf con vocab 32,064 (pad 32000 + relleno a múltiplo de 64); n_action_bins 256 sobre los 256 últimos ids del tokenizer (32,000); llm_max_length 2048). Total = 7,541,237,184 = model.safetensors.index.json.',
    },
  };

  function ovlaApply(c, ov) {
    const notes = [];
    if (ov.T !== undefined) {
      if (ov.T < 2) throw new Error('OpenVLA: T debe ser ≥ 2 (<BOS> + al menos un token: los parches se insertan después de <BOS>).');
      c.T = ov.T;
      if (c.T !== 22) c.label += ' · T = ' + c.T;
    }
    if (ov.res !== undefined) {
      if (ov.res % c.P !== 0) throw new Error('OpenVLA: res = ' + ov.res + ' debe ser múltiplo del patch ' + c.P + '.');
      if (ov.res !== c.H) {
        notes.push('What-if res = ' + ov.res + ': (' + ov.res + '/14)² = ' + fint((ov.res / c.P) ** 2) + ' parches por imagen. Las tablas de posición de las dos torres se interpolan desde 16×16 (timm img_size): sus parámetros pasan a N_p·D_d y N_p·D_s. OpenVLA se entrenó a 224.');
        c.label += ' · ' + ov.res + ' px';
      }
      c.H = c.W = ov.res;
    }
    if (ov.images !== undefined) {
      if (ov.images > 1) {
        notes.push(ov.images + ' imágenes: las dos torres y el proyector corren ' + ov.images + ' veces con los mismos pesos (MACs × ' + ov.images + ', parámetros × 1; formas por imagen). OpenVLA usa UNA cámara (la de tercera persona); varias vistas son un what-if (OpenVLA-OFT las agrega).');
        c.label += ' · ' + ov.images + ' imágenes';
      }
      c.images = ov.images;
    }
    if (ov.da !== undefined) {
      if (ov.da !== c.da) {
        notes.push('What-if d_a = ' + ov.da + ': ' + ov.da + ' tokens de acción = 1 prefill + ' + (ov.da - 1) + ' pasos de decode. El checkpoint predice 7 (Δpos 3, Δrot 3, pinza).');
        c.label += ' · d_a = ' + ov.da;
      }
      c.da = ov.da;
    }
    const S = c.images * (c.H / c.P) * (c.W / c.P) + c.T;
    if (S + c.da > c.ctxMax) notes.push('N + T + d_a = ' + fint(S + c.da) + ' supera llm_max_length = ' + fint(c.ctxMax) + ': el conteo es válido, el modelo no.');
    c._notes = notes;
    return c;
  }
  function ovlaResolve(c) {
    c.res = c.H;
    c.Np = (c.H / c.P) * (c.W / c.P);
    c.N = c.images * c.Np;
    c.S = c.N + c.T;
    c.posInterpolatedFrom = c.Np !== 256 ? 256 : null;
    c.tokens = c.S;
    c.dd = c.Dd / c.hd; c.ds = c.Ds / c.hs;
    c.Dv = c.Dd + c.Ds;
    c.Dproj = 4 * c.Dv;
    c.prefixDino = 1 + c.reg;
    c.actionTokenFirst = c.Vtok - c.bins; c.actionTokenLast = c.Vtok - 1;
    c.decodeSteps = c.da - 1;
    return c;
  }

  function ovlaBuild(c, A) {
    const g = A.graph(c);
    const I = c.images, pi = I > 1 ? ' (por imagen)' : '', IR = { repeat: I, paramRepeat: 1 };
    const pix = g.input('pixels', shp(['H', 'W', 'C'], [c.H, c.W, c.C], 'img', 'grid'), { label: 'Imagen de la cámara (redimensionada a ' + c.H + '×' + c.W + ', resize-naive)' + pi, tex: 'x' });
    // ---- DINOv2 ViT-L/14 (reg4)
    const WD = ['DINOv2 ViT-L/14 (4 registros)'], TD = 'DINOv2 · ', PD = ['dinov2'];
    const dop = (id, res, path, extra) => g.op(id, res, Object.assign({ path: PD.concat(path), where: WD }, IR, extra));
    const dpx = dop('dino-normalize', P.normalize_pixels(pix, { stats: 'ImageNet (DINOv2)' }), ['normalize'], { out: 'd-pixels', label: 'Normalizar con las estadísticas de DINOv2', type: 'tensorop', group: 'embed',
      outMeta: { label: TD + 'imagen normalizada', tex: 'x_d' } });
    const dg = dop('dino-patch-embed', A.conv2d(dpx, { k: c.P, s: c.P, cout: c.Dd, coutSym: 'D_d', kSym: 'P', outSym: ['H/P', 'W/P'], bias: true, macTex: 'N_p\\cdot D_d\\cdot P^2\\cdot C' }), ['patch-embed'], {
      out: 'd-patch-grid', label: 'Patch embedding (conv P×P, stride P, con sesgo)', type: 'conv', group: 'embed', outMeta: { label: TD + 'rejilla de parches embebidos', tex: 'X_{\\mathrm{grid}}' } });
    const dp = dop('dino-patch-flatten', A.flatten(dg, { sym: ['N_p', 'D_d'] }), ['patch-embed'], { out: 'd-patches', label: 'Aplanar la rejilla', type: 'tensorop', group: 'embed', outMeta: { label: TD + 'parches embebidos', tex: 'X_pE' } });
    const de = dop('dino-pos-embed', A.pos_embed_learned({ rows: c.Np, rowsSym: 'N_p', D: c.Dd, Dsym: 'D_d', mod: 'img', interpolatedFrom: c.posInterpolatedFrom }), ['pos-embed'], { out: 'd-e-pos', label: 'Position embeddings aprendidos (solo los ' + c.Np + ' parches)', type: 'embed', group: 'embed',
      outMeta: { label: TD + 'tabla de posición', tex: 'E_{\\mathrm{pos}}' } });
    const dxp = dop('dino-add-pos', A.add(dp, de), ['add-pos'], { out: 'd-x-pos', label: 'Suma de posición', type: 'tensorop', group: 'embed', outMeta: { label: TD + 'parches con posición', tex: 'X_pE + E_{\\mathrm{pos}}' } });
    const dx0 = dop('dino-prefix', P.prefix_tokens(dxp, { k: c.prefixDino, sym: 'N_p+5' }), ['prefix-tokens'], { out: 'd-x0', label: 'CLS + 4 registros (sin posición)', type: 'embed', group: 'embed',
      outMeta: { label: TD + 'CLS + registros + parches', tex: '[x_{\\mathrm{cls}};\\,R;\\,X]' } });
    const dxs = lsLayer(g, dx0, { prefix: PD.concat(['enc-layer']), L: (c.Ld - 1) * I, paramL: c.Ld - 1, h: c.hd, Dmlp: c.Dmlpd, DmlpSym: '4D_d', hSym: 'h_d', dhSym: 'd_d', tid: 'd-', oid: 'dino-', where: WD, labelPrefix: TD,
      outId: 'd-x-out', outMeta: { label: 'salida de la capa ' + (c.Ld - 1) + ' (la penúltima)', tex: 'x_{L_d-1}', note: 'get_intermediate_layers(n = {L − 2}) devuelve esta salida.' } });
    const dl = lastLayer(dxs, { h: c.hd, Dmlp: c.Dmlpd, DmlpSym: '4D_d', layerScale: true });
    dop('dino-last-layer', dl, ['last-layer'], { out: 'd-x-last', label: 'Capa ' + c.Ld + ' (última): timm 0.9 la calcula y se descarta', type: 'attn', group: 'attn',
      paramTex: '12D_d^2 + 15D_d', macTex: '(N_p{+}5)\\cdot 12D_d^2 + 2\\,(N_p{+}5)^2 D_d', outMeta: { label: TD + 'salida de la última capa (no se usa)', tex: 'x_{L_d}' } });
    const df = dop('dino-take-patches', A.take_rows(dxs, { start: c.prefixDino, count: c.Np, sym: 'N_p' }), ['select'], { out: 'd-feats', label: 'Penúltima capa sin CLS ni registros (' + c.Np + ' parches)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Features de DINOv2 (' + c.Np + ' × ' + c.Dd + ')' + pi, tex: 'Z_d' } });
    dop('dino-idle', A.idle_params({ paramTerms: [[2, c.Dd]], paramTex: '2D_d', what: 'LayerNorm final de DINOv2 (get_intermediate_layers con norm = False)' }), ['norm'],
      { out: [], in: [], label: 'Sin uso: LayerNorm final de DINOv2', type: 'norm', group: 'norm', repeat: 1, paramRepeat: 1 });
    // ---- SigLIP So400m/14
    const WS = ['SigLIP So400m/14'], TS = 'SigLIP · ', PS = ['siglip'];
    const sop = (id, res, path, extra) => g.op(id, res, Object.assign({ path: PS.concat(path), where: WS }, IR, extra));
    const spx = sop('sig-normalize', P.normalize_pixels(pix, { stats: 'SigLIP (media y desviación 0.5)' }), ['normalize'], { out: 's-pixels', label: 'Normalizar con las estadísticas de SigLIP', type: 'tensorop', group: 'embed',
      outMeta: { label: TS + 'imagen normalizada', tex: 'x_s' } });
    const sx0 = sigEmbed(g, c, spx, sop, TS, { pi });
    const sxs = A.preLnLayer(g, sx0, {
      prefix: PS.concat(['enc-layer']), L: (c.Ls - 1) * I, paramL: c.Ls - 1, h: c.hs, Dmlp: c.Ms, tid: 's-', oid: 'sig-', where: WS, labelPrefix: TS,
      actLabel: 'GELU (tanh)', actTex: '\\mathrm{GELU}_{\\tanh}(U)', hSym: 'h_s', dhSym: 'd_s', DmlpSym: 'M_s', outId: 's-feats',
      outMeta: { label: 'Features de SigLIP (' + c.Np + ' × ' + c.Ds + ', penúltima capa)' + pi, tex: 'Z_s', perLayer: false, note: 'Salida de la capa ' + (c.Ls - 1) + ' (la penúltima).' },
    });
    sop('sig-last-layer', lastLayer(sxs, { h: c.hs, Dmlp: c.Ms, DmlpSym: 'M_s' }), ['last-layer'], { out: 's-x-last', label: 'Capa ' + c.Ls + ' (última): timm 0.9 la calcula y se descarta', type: 'attn', group: 'attn',
      paramTex: '4D_s^2 + 2D_sM_s + M_s + 9D_s', macTex: 'N_p\\cdot(4D_s^2 + 2D_sM_s) + 2N_p^2D_s', outMeta: { label: TS + 'salida de la última capa (no se usa)', tex: 'x_{L_s}' } });
    sop('sig-idle', A.idle_params({ params: c.siglipIdle, paramTex: '2D_s + \\mathrm{MAP}', what: 'LayerNorm final + attention pooling (MAP) de SigLIP: timm los crea (global_pool = map) y OpenVLA no los usa' }), ['head'],
      { out: [], in: [], label: 'Sin uso: norma final y attention pooling (MAP) de SigLIP', type: 'head', group: 'head', repeat: 1, paramRepeat: 1 });
    // ---- concatenación y proyector
    const vf = g.op('concat', A.concat_features([df, sxs], { sym: 'D_v' }), { path: ['concat'], repeat: I, paramRepeat: 1, out: 'vis-feats', where: ['Fusión de features'], label: 'Concatenar por canal (D_d + D_s = ' + c.Dv + ')', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Features visuales fusionadas (' + c.Np + ' × ' + c.Dv + ')' + pi, tex: '[Z_d\\,|\\,Z_s]' } });
    const WP = ['Proyector (fused-gelu-mlp: 3 lineales)'], TP = 'Proyector · ';
    const pop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: ['projector', node], where: WP }, IR, extra));
    const h1 = pop('proj-fc1', A.linear(vf, { dout: c.Dproj, doutSym: '4D_v', bias: true }), 'fc1', { out: 'proj-h1', label: 'Proyector: capa 1 (D_v → 4D_v)', type: 'mlp', group: 'mlp', outMeta: { label: TP + 'capa oculta 1 (4D_v = ' + c.Dproj + ')', tex: 'ZW_1 + b_1' } });
    const a1 = pop('proj-gelu1', A.gelu(h1), 'gelu1', { out: 'proj-a1', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: { label: TP + 'activación 1', tex: '\\mathrm{GELU}(\\cdot)' } });
    const h2 = pop('proj-fc2', A.linear(a1, { dout: c.D, doutSym: 'D', bias: true }), 'fc2', { out: 'proj-h2', label: 'Proyector: capa 2 (4D_v → D)', type: 'mlp', group: 'mlp', outMeta: { label: TP + 'capa oculta 2 (D = ' + c.D + ')', tex: 'HW_2 + b_2' } });
    const a2 = pop('proj-gelu2', A.gelu(h2), 'gelu2', { out: 'proj-a2', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: { label: TP + 'activación 2', tex: '\\mathrm{GELU}(\\cdot)' } });
    const vt = pop('proj-fc3', A.linear(a2, { dout: c.D, doutSym: 'D', bias: true }), 'fc3', { out: 'vis-tokens', label: 'Proyector: capa 3 (D → D)', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Tokens visuales en el espacio del LLM (' + c.Np + ' × ' + c.D + ')' + pi, tex: 'H_v' } });
    // ---- texto, inserción y LLM
    const ids = g.input('text-ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Instrucción · ids de los T tokens ("In: What action should the robot take to …?\\nOut:" con <BOS> y el 29871)', tex: 't_{1..T}' });
    const te = g.op('embed', A.embedding_lookup(ids, { V: c.V, D: c.D }), { path: ['embed'], out: 'text-emb', where: ['Embedding de tokens del LLM'], label: 'Embedding de tokens (tabla V×D: ' + fint(c.V) + ' × ' + c.D + ')', type: 'embed', group: 'embed',
      outMeta: { label: 'Instrucción · embeddings de los tokens de texto', tex: 'E[t]' } });
    g.op('splice', A.splice_tokens(te, vt, { copies: I, sym: 'N+T', at: 'después de <BOS> (Prismatic: [emb[:1], parches, emb[1:]])' }), {
      path: ['merge'], out: 'prompt', where: ['Prompt del LLM'], label: 'Insertar los ' + c.N + ' tokens visuales después de <BOS>', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Prompt del LLM: <BOS> + N tokens visuales + el resto del texto (N = ' + c.N + ')', tex: '[\\mathrm{BOS};\\,H_v;\\,E[t_{2..T}]]' } });
    const W = 'LLM (' + c.llmLabel + ')';
    A.importGraph(g, llmData(c, c.S).data, {
      skip: ['embed'], inputs: { x0: 'prompt' }, sym: { T: 'N+T' }, tex: texT,
      path: (p) => (p[0] === 'blocks' ? ['llm'].concat(p.slice(1)) : p[0] === 'final-norm' ? ['llm', 'final-norm'] : p[0] === 'sample' ? ['action-tokens'] : p),
      where: (w) => [W].concat(w),
      label: (l) => 'LLM · ' + l,
      replace: (op, ins) => (op.id === 'sample' ? { res: A.sample_token(ins[0], { strategy: 'greedy (argmax): el 1.er token de acción' }), label: 'Elegir el 1.er token de acción (argmax de la última fila)' } : null),
    });
    // ---- los 6 tokens de acción que faltan (decode con KV cache) y detokenizar
    const steps = [];
    for (let k = 1; k <= c.decodeSteps; k++) steps.push({ ctx: c.S + k, macs: llmDecodeMacs(c, c.S + k) });
    const at = g.op('ar-decode', P.ar_decode(g.tensor('next-token'), { steps, sym: 'd_a' }), { path: ['action-tokens'], out: 'action-tokens', where: ['Tokens de acción (decode autorregresivo)'],
      label: 'Generar los otros ' + c.decodeSteps + ' tokens (un paso de decode cada uno, KV cache)', type: 'head', group: 'head',
      outMeta: { label: 'Tokens de acción (' + c.da + ' ids entre ' + fint(c.actionTokenFirst) + ' y ' + fint(c.actionTokenLast) + ')', tex: 'a_{1..d_a}^{\\mathrm{tok}}' } });
    g.op('detokenize', P.detokenize_actions(at, { bins: c.bins, vocab: c.Vtok }), { path: ['detokenize'], out: 'action', where: ['Detokenizar'], label: 'Detokenizar: id → bin → centro → desnormalizar (q01, q99)', type: 'tensorop', group: 'head',
      outMeta: { label: 'Acción continua (Δx, Δy, Δz, Δroll, Δpitch, Δyaw, pinza)', tex: 'a \\in \\mathbb{R}^{d_a}' } });
    return g;
  }

  // Embedding de SigLIP (común): patch conv + flatten + posición. Devuelve s-x0 (N_p×D_s).
  function sigEmbed(g, c, px, sop, TS, extra) {
    const e = extra || {};
    const sg = sop('sig-patch-embed', A.conv2d(px, { k: c.P, s: c.P, cout: c.Ds, coutSym: 'D_s', kSym: 'P', outSym: ['H/P', 'W/P'], bias: true, macTex: 'N_p\\cdot D_s\\cdot P^2\\cdot C' }), ['patch-embed'], Object.assign({
      out: 's-patch-grid', label: 'Patch embedding (conv P×P, stride P, con sesgo)', type: 'conv', group: 'embed', outMeta: { label: TS + 'rejilla de parches embebidos' + (e.pi || ''), tex: 'X_{\\mathrm{grid}}' } }, e.op));
    const sp = sop('sig-patch-flatten', A.flatten(sg, { sym: ['N_p', 'D_s'] }), ['patch-embed'], Object.assign({ out: 's-patches', label: 'Aplanar la rejilla', type: 'tensorop', group: 'embed', outMeta: { label: TS + 'parches embebidos' + (e.pi || ''), tex: 'X_pE' } }, e.op));
    const se = sop('sig-pos-embed', A.pos_embed_learned({ rows: c.Np, rowsSym: 'N_p', D: c.Ds, Dsym: 'D_s', mod: 'img', interpolatedFrom: c.posInterpolatedFrom || null }), ['pos-embed'], Object.assign({ out: 's-e-pos', label: 'Position embeddings aprendidos (' + c.Np + ' × ' + c.Ds + ')', type: 'embed', group: 'embed',
      outMeta: { label: TS + 'tabla de posición', tex: 'E_{\\mathrm{pos}}' } }, e.op));
    return sop('sig-add-pos', A.add(sp, se), ['add-pos'], Object.assign({ out: 's-x0', label: 'Suma de posición (sin CLS)', type: 'tensorop', group: 'embed', outMeta: { label: TS + 'tokens con posición' + (e.pi || ''), tex: 'x_0' } }, e.op));
  }

  // ------------------------------------------------------------------ π0
  const PI0_SRC = 'Black et al. 2024 (π0, arXiv:2410.24164; RSS 2025), §IV y Apéndice; código oficial Physical-Intelligence/openpi (main @ 215abfb): models/pi0_config.py (paligemma_variant gemma_2b, action_expert_variant gemma_300m, action_dim 32, action_horizon 50, max_token_len 48), gemma.py (gemma_2b: 2048, 18 capas, FFN 16,384, 8 cabezas, 1 KV, d_h 256; gemma_300m: 1024, 18 capas, FFN 4096, 8 cabezas, 1 KV, d_h 256; PALIGEMMA_VOCAB_SIZE 257,152; un solo embedder, el de Gemma), siglip.py (So400m/14, pool_type none, head Dense → 2048), pi0.py (embed_prefix, embed_suffix, sample_actions con num_steps = 10 y KV cache del prefijo). ';
  const PI0_BASE = {
    llmLabel: 'Gemma 2B (PaliGemma)', llmFamily: 'Gemma', hf: 'Physical-Intelligence/openpi (pi0_base)',
    H: 224, W: 224, C: 3, P: 14, Ds: 1152, Ls: 27, hs: 16, Ms: 4304,
    D: 2048, L: 18, h: 8, G: 1, dh: 256, Dmlp: 16384, V: 257152, ctxMax: 8192, ropeTheta: 10000, eps: 1e-6, tied: true,
    Da: 1024, Dmlpa: 4096, T: 48, da: 32, Ha: 50, steps: 10, causal: false,
  };
  const PI0 = {
    pi0: Object.assign({}, PI0_BASE, { label: 'π0 (3 cámaras)', canonical: true, cams: 3,
      source: PI0_SRC + 'Config canónica: las 3 cámaras de Pi0Config.inputs_spec (base_0_rgb, left_wrist_0_rgb, right_wrist_0_rgb) a 224×224, T = 48, H = 50, 10 pasos. Latencia del paper (Tabla I, RTX 4090): 14 ms encoders de imagen + 32 ms forward del prefijo + 27 ms los 10 pasos de flow = 73 ms a bordo.' }),
    'pi0-1cam': Object.assign({}, PI0_BASE, { label: 'π0 (1 cámara)', cams: 1,
      source: PI0_SRC + 'Variante con UNA cámara (256 tokens visuales): mismos pesos. OJO: openpi rellena las ranuras vacías con ceros y las enmascara, pero las calcula; esta config cuenta solo la cámara real.' }),
  };

  function pi0Apply(c, ov) {
    const notes = [];
    if (ov.cams !== undefined) {
      if (ov.cams > 8) throw new Error('π0: cams debe estar entre 1 y 8 (el modelo base tiene 3 ranuras de cámara).');
      if (ov.cams !== c.cams) c.label = 'π0 (' + ov.cams + (ov.cams === 1 ? ' cámara)' : ' cámaras)');
      c.cams = ov.cams;
    }
    if (ov.H !== undefined) { c.Ha = ov.H; if (c.Ha !== 50) c.label += ' · H = ' + c.Ha; }
    if (ov.steps !== undefined) { c.steps = ov.steps; if (c.steps !== 10) c.label += ' · ' + c.steps + (c.steps === 1 ? ' paso' : ' pasos'); }
    if (ov.T !== undefined) { c.T = ov.T; if (c.T !== 48) c.label += ' · T = ' + c.T; }
    if (c.cams > 3) notes.push(c.cams + ' cámaras: el modelo base se entrenó con hasta 3 (el conteo es válido; π0 no).');
    if (c.Ha !== 50) notes.push('H = ' + c.Ha + ': π0 se entrenó con chunks de 50; cambiar H exige reentrenar (cambia la forma del sufijo).');
    c._notes = notes;
    return c;
  }
  function pi0Resolve(c) {
    c.res = c.H;
    c.Np = (c.H / c.P) * (c.W / c.P);
    c.N = c.cams * c.Np;
    c.S = c.N + c.T;
    c.tokens = c.S;
    c.ds = c.Ds / c.hs;
    c.suffix = 1 + c.Ha;
    c.ctx = c.S + c.suffix;
    c.Dq = c.h * c.dh;
    c.chunk = c.Ha;
    c.visualPerImage = c.Np;
    return c;
  }

  function pi0Build(c, A) {
    const g = A.graph(c);
    const I = c.cams, pi = I > 1 ? ' (por cámara)' : '';
    const px = g.input('pixels', shp(['H', 'W', 'C'], [c.H, c.W, c.C], 'img', 'grid'), { label: 'Imagen de una cámara (' + c.H + '×' + c.W + ')' + pi, tex: 'x' });
    // ---- SigLIP + proyector (por cámara, pesos compartidos)
    const WS = ['SigLIP So400m/14 (PaliGemma)'], TS = 'SigLIP · ', PS = ['siglip'];
    const sop = (id, res, path, extra) => g.op(id, res, Object.assign({ path: PS.concat(path), where: WS, repeat: I, paramRepeat: 1 }, extra));
    const sx0 = sigEmbed(g, c, px, sop, TS, { pi });
    const sxo = A.preLnLayer(g, sx0, {
      prefix: PS.concat(['enc-layer']), L: c.Ls * I, paramL: c.Ls, h: c.hs, Dmlp: c.Ms, tid: 's-', oid: 'sig-', where: WS, labelPrefix: TS,
      actLabel: 'GELU (tanh)', actTex: '\\mathrm{GELU}_{\\tanh}(U)', hSym: 'h_s', dhSym: 'd_s', DmlpSym: 'M_s',
      outMeta: { label: 'salida de la capa ' + c.Ls + pi, tex: 'x_{L_s}', perLayer: false, note: 'π0 usa la última capa (pool "none") y su LayerNorm final.' },
    });
    const sf = sop('sig-ln-post', A.layernorm(sxo, { eps: 1e-6 }), ['ln-post'], { out: 's-feats', label: 'LayerNorm final (encoder_norm)', type: 'norm', group: 'norm',
      outMeta: { label: 'Features de SigLIP (' + c.Np + ' × ' + c.Ds + ')' + pi, tex: 'Z_s' } });
    const it = sop('img-proj', A.linear(sf, { dout: c.D, doutSym: 'D', bias: true }), ['img-proj'], { out: 'img-tokens', label: 'Proyector lineal D_s → D (head de SigLIP en openpi)', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Tokens de imagen en el espacio de Gemma (' + c.Np + ' × ' + c.D + ')' + pi, tex: 'H_v' } });
    // ---- lenguaje y prefijo
    const ids = g.input('lang-ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Instrucción · ids de los T tokens (relleno hasta ' + c.T + ', el largo fijo de openpi)', tex: 't_{1..T}' });
    const le = g.op('embed', A.embedding_lookup(ids, { V: c.V, D: c.D }), { path: ['language'], out: 'lang-emb', where: ['Embedding de Gemma'], label: 'Embedding de tokens (tabla V×D: ' + fint(c.V) + ' × ' + c.D + ', × √D)', type: 'embed', group: 'embed',
      outMeta: { label: 'Instrucción · embeddings (× √D)', tex: '\\sqrt{D}\\,E[t]' } });
    g.op('prefix-concat', A.splice_tokens(le, it, { copies: I, sym: 'N+T', at: 'imágenes primero, luego el texto (embed_prefix)' }), {
      path: ['gemma', 'prefix-concat'], out: 'prefix', where: ['Prefijo (Gemma 2B)'], label: 'Concatenar ' + I + ' × ' + c.Np + ' tokens de imagen + T de texto', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Prefijo: N tokens de imagen + T de texto (N = ' + fint(c.N) + ')', tex: '[H_v^{(1..' + I + ')};\\,E[t]]' } });
    const W = 'Gemma 2B (prefijo)';
    const rn = (n) => (n === 'silu' ? 'gelu' : n);
    A.importGraph(g, llmData(c, c.S).data, {
      skip: ['embed', 'lm-head', 'sample'], inputs: { x0: 'prefix' }, sym: { T: 'N+T' }, tex: texT,
      opId: rn,
      path: (p) => (p[0] === 'blocks' ? ['gemma'].concat(p.slice(1).map(rn)) : p[0] === 'final-norm' ? ['gemma', 'final-norm'] : p),
      where: (w) => [W].concat(w.map((x) => x.replace('FFN SwiGLU', 'FFN GeGLU').replace('Bloque decoder', 'Bloque de Gemma'))),
      label: (l) => 'Gemma · ' + l.replace('compuerta SiLU(gate)', 'compuerta GELU(gate)').replace('SiLU(', 'GELU('),
      replace: (op, ins) => {
        if (op.id === 'mask') return { res: P.prefix_mask(ins[0]), label: 'Máscara del prefijo (bidireccional + relleno)' };
        if (op.id === 'silu') return { res: A.gelu(ins[0]), label: 'GELU (tanh) sobre la rama gate (GeGLU)' };
        if (op.id === 'mul') return { res: A.mul(ins[0], ins[1]), label: 'Producto GELU(gate) ⊙ up' };
        if (op.id === 'final-norm') return { res: A.rmsnorm(ins[0], { eps: c.eps }), label: 'RMSNorm final (su salida no se usa: π0 no decodifica texto)' };
        return null;
      },
    });
    // ---- sufijo: estado + acciones con ruido + tiempo (repeat = steps)
    const R = c.steps;
    const sfx = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: R, paramRepeat: 1 }, extra));
    const st = g.input('state', shp(['1', 'd_a'], [1, c.da], 'act', 'seq'), { label: 'Estado propioceptivo (articulaciones; ' + c.da + ' con relleno)', tex: 'q_t' });
    const stt = sfx('state-proj', A.linear(st, { dout: c.Da, doutSym: 'D_a', bias: true }), ['state'], { out: 'state-tok', where: ['Sufijo: estado'], label: 'state_proj (d_a → D_a)', type: 'embed', group: 'embed',
      outMeta: { label: 'Token de estado', tex: 'q_tW_s' } });
    const xt = g.input('x-t', shp(['H_a', 'd_a'], [c.Ha, c.da], 'act', 'seq'), { label: 'Acciones con ruido x_τ (chunk de H_a = ' + c.Ha + '; en τ = 1 es ruido puro)', tex: 'x_\\tau' });
    const ae = sfx('action-in-proj', A.linear(xt, { dout: c.Da, doutSym: 'D_a', bias: true }), ['noisy-actions'], { out: 'act-emb', where: ['Sufijo: acciones'], label: 'action_in_proj (d_a → D_a)', type: 'embed', group: 'embed',
      outMeta: { label: 'Acciones con ruido embebidas', tex: 'x_\\tau W_a' } });
    const tau = g.input('tau', shp(['1'], [1], null, 'vec'), { label: 'Tiempo de flow τ (1 = ruido → 0 = acción, convención de openpi)', tex: '\\tau' });
    const WT = ['Tiempo de flow (MLP acción + tiempo)'];
    const te = sfx('t-sincos', A.timestep_embedding(tau, { dim: c.Da, sym: 'D_a', maxPeriod: 4, flip: false, mod: 'act' }), ['t-embed', 'sincos'], { out: 't-emb', where: WT, label: 'posemb_sincos(τ, D_a; períodos 4e-3 … 4)', type: 'embed', group: 'embed',
      outMeta: { label: 'Embedding seno/coseno de τ', tex: '\\phi(\\tau)' } });
    const tt = sfx('t-broadcast', P.broadcast_rows(te, { rows: c.Ha, sym: 'H_a', mod: 'act' }), ['t-embed', 'broadcast'], { out: 't-tokens', where: WT, label: 'Repetir φ(τ) en las H_a filas', type: 'tensorop', group: 'embed',
      outMeta: { label: 'φ(τ) en cada fila de acción', tex: '\\mathbf{1}\\phi(\\tau)^\\top' } });
    const ac = sfx('at-concat', A.concat_features([ae, tt], { sym: '2D_a' }), ['t-embed', 'concat'], { out: 'at-cat', where: WT, label: 'Concatenar acción y tiempo (2D_a)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Acción ‖ tiempo', tex: '[x_\\tau W_a\\,|\\,\\phi(\\tau)]' } });
    const ah = sfx('at-mlp-in', A.linear(ac, { dout: c.Da, doutSym: 'D_a', bias: true }), ['t-embed', 'mlp-in'], { out: 'at-h', where: WT, label: 'action_time_mlp_in (2D_a → D_a)', type: 'mlp', group: 'mlp',
      outMeta: { label: 'MLP acción-tiempo: capa oculta', tex: 'W_1[\\cdot]' } });
    const aa = sfx('at-swish', A.silu(ah), ['t-embed', 'swish'], { out: 'at-act', where: WT, label: 'Swish (SiLU)', type: 'mlp', group: 'mlp', outMeta: { label: 'MLP acción-tiempo: activación swish', tex: '\\mathrm{swish}(\\cdot)' } });
    const at = sfx('at-mlp-out', A.linear(aa, { dout: c.Da, doutSym: 'D_a', bias: true }), ['t-embed', 'mlp-out'], { out: 'act-tokens', where: WT, label: 'action_time_mlp_out (D_a → D_a)', type: 'mlp', group: 'mlp',
      outMeta: { label: 'Tokens de acción (con t, convención de openpi)', tex: 'A_t' } });
    const WE = ['Experto de acción (gemma_300m, ×' + c.L + ')'];
    const sx = sfx('suffix-concat', A.concat_tokens(stt, at, { sym: '1+H_a', mod: 'act' }), ['action-expert', 'suffix-concat'], { out: 'suffix', where: WE, label: 'Sufijo: estado + H_a acciones', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Sufijo (1 + H_a = ' + c.suffix + ' tokens)', tex: '[q_tW_s;\\,A_\\tau]' } });
    const xo = expertBlock(g, c, sx);
    const xn = sfx('ae-final-norm', A.rmsnorm(xo, { eps: c.eps }), ['action-expert', 'final-norm'], { out: 'a-x-norm', where: WE, label: 'RMSNorm final del experto', type: 'norm', group: 'norm',
      outMeta: { label: 'Experto · salida normalizada', tex: '\\mathrm{RMSNorm}(y)' } });
    const ta = sfx('take-actions', A.take_rows(xn, { start: 1, count: c.Ha, sym: 'H_a' }), ['velocity', 'take'], { out: 'a-act-out', where: ['Velocidad'], label: 'Las últimas H_a filas (sin el token de estado)', type: 'tensorop', group: 'head',
      outMeta: { label: 'Salida del experto en las filas de acción', tex: 'y_{1..H_a}' } });
    const vel = sfx('action-out-proj', A.linear(ta, { dout: c.da, doutSym: 'd_a', bias: true, mod: 'act' }), ['velocity', 'proj'], { out: 'velocity', where: ['Velocidad'], label: 'action_out_proj (D_a → d_a)', type: 'head', group: 'head',
      outMeta: { label: 'Velocidad predicha v_θ (un vector por acción del chunk)', tex: 'v_\\theta(x_\\tau, o)' } });
    sfx('euler-step', A.scheduler_step(xt, vel, { kind: 'euler', steps: c.steps }), ['euler'], { out: 'action-chunk', where: ['Integración (Euler)'], label: 'Paso de Euler x ← x + δ·v (δ = −1/' + c.steps + ', ×' + c.steps + ' pasos)', type: 'tensorop', group: 'other',
      outMeta: { label: 'Chunk de acciones (tras los ' + c.steps + ' pasos: t = 0, convención de openpi)', tex: 'A_t = x_0' } });
    return g;
  }

  // Bloque del experto de acción (repeat steps·L, paramRepeat L): sus pesos, atención conjunta sobre [KV del prefijo; sufijo].
  function expertBlock(g, c, x) {
    const PB = ['action-expert', 'block'], rep = c.steps * c.L;
    const WB = ['Experto de acción (gemma_300m, ×' + c.L + ')'];
    const Lm = (m, pre) => Object.assign({ perLayer: true }, m, { label: 'Experto · ' + (pre || '') + m.label });
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path: PB.concat(path), repeat: rep, paramRepeat: c.L, where: WB.concat(extra.wsub || []) }, extra));
    const WA = ['atención conjunta (' + c.h + ' cabezas de query, ' + c.G + ' KV; K/V del prefijo + sufijo)'], TA = 'atención · ';
    const WF = ['FFN GeGLU'], TF = 'FFN · ';
    const hn1 = op('ae-norm1', A.rmsnorm(x, { eps: c.eps }), ['norm1'], { out: 'a-h-norm1', label: 'RMSNorm 1 (antes de la atención)', type: 'norm', group: 'norm', outMeta: Lm({ label: 'entrada normalizada (RMSNorm 1)', tex: '\\mathrm{RMSNorm}_1(s)' }) });
    const q = op('ae-q-proj', A.linear(hn1, { dout: c.Dq, doutSym: 'h·d_h', bias: false }), ['attn', 'q-proj'], { wsub: WA, out: 'a-q', label: 'W_Q del experto (D_a → h·d_h = ' + c.Dq + ')', type: 'embed', group: 'attn', outMeta: Lm({ label: 'Q del sufijo', tex: 'Q = sW_Q' }, TA) });
    const k = op('ae-k-proj', A.linear(hn1, { dout: c.G * c.dh, doutSym: 'G·d_h', bias: false }), ['attn', 'k-proj'], { wsub: WA, out: 'a-k', label: 'W_K del experto (D_a → G·d_h = ' + c.G * c.dh + ')', type: 'embed', group: 'attn', outMeta: Lm({ label: 'K del sufijo', tex: 'K = sW_K' }, TA) });
    const v = op('ae-v-proj', A.linear(hn1, { dout: c.G * c.dh, doutSym: 'G·d_h', bias: false }), ['attn', 'v-proj'], { wsub: WA, out: 'a-v', label: 'W_V del experto (D_a → G·d_h = ' + c.G * c.dh + ')', type: 'embed', group: 'attn', outMeta: Lm({ label: 'V del sufijo', tex: 'V = sW_V' }, TA) });
    const [qh, kh, vh] = op('ae-split', A.split_gqa_heads(q, k, v, { h: c.h, G: c.G }), ['attn', 'split'], { wsub: WA, out: ['a-q-heads', 'a-k-heads', 'a-v-heads'], label: 'Separar en ' + c.h + ' cabezas de query y ' + c.G + ' KV (MQA)', type: 'tensorop', group: 'attn',
      outMeta: [Lm({ label: 'queries del sufijo por cabeza', tex: 'Q_i' }, TA), Lm({ label: 'keys del sufijo (antes de RoPE)', tex: 'K_g' }, TA), Lm({ label: 'values del sufijo', tex: 'V_g' }, TA)] });
    const qr = op('ae-rope-q', A.rope(qh, { theta: c.ropeTheta, pos0: c.S }), ['attn', 'rope'], { wsub: WA, out: 'a-q-rope', label: 'RoPE sobre Q (posiciones N + T … N + T + H_a)', type: 'attn', group: 'attn', outMeta: Lm({ label: 'queries rotadas', tex: '\\mathrm{RoPE}(Q_i)' }, TA) });
    const kr = op('ae-rope-k', A.rope(kh, { theta: c.ropeTheta, pos0: c.S }), ['attn', 'rope'], { wsub: WA, out: 'a-k-rope', label: 'RoPE sobre K', type: 'attn', group: 'attn', outMeta: Lm({ label: 'keys del sufijo rotadas', tex: '\\mathrm{RoPE}(K_g)' }, TA) });
    const ka = op('ae-kv-k', A.kv_append(g.tensor('k-rope'), kr, { sym: 'N+T+1+H_a' }), ['attn', 'kv-cache'], { wsub: WA, out: 'a-k-all', label: 'K = [K del prefijo (KV cache de Gemma); K del sufijo]', type: 'tensorop', group: 'attn',
      outMeta: Lm({ label: 'keys de prefijo + sufijo (N + T + 1 + H_a = ' + fint(c.ctx) + ')', tex: '[K_{\\mathrm{pre}};\\,K_{\\mathrm{suf}}]' }, TA) });
    const va = op('ae-kv-v', A.kv_append(g.tensor('v-heads'), vh, { sym: 'N+T+1+H_a' }), ['attn', 'kv-cache'], { wsub: WA, out: 'a-v-all', label: 'V = [V del prefijo; V del sufijo]', type: 'tensorop', group: 'attn',
      outMeta: Lm({ label: 'values de prefijo + sufijo', tex: '[V_{\\mathrm{pre}};\\,V_{\\mathrm{suf}}]' }, TA) });
    const sc = op('ae-scores', A.attention_scores(qr, ka), ['attn', 'scores'], { wsub: WA, out: 'a-scores', label: 'QKᵀ: el sufijo contra prefijo + sufijo', type: 'attn', group: 'attn', outMeta: Lm({ label: 'scores sin escalar', tex: 'QK^\\top' }, TA) });
    const ss = op('ae-scale', A.scale(sc), ['attn', 'scale'], { wsub: WA, out: 'a-scores-scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: Lm({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }, TA) });
    const ms = op('ae-mask', P.block_causal_mask(ss), ['attn', 'mask'], { wsub: WA, out: 'a-masked', label: 'Máscara por bloques (estado → prefijo + estado; acciones → todo)', type: 'attn', group: 'attn', outMeta: Lm({ label: 'scores enmascarados (por bloques)', tex: 'QK^\\top/\\sqrt{d_h} + M_{\\mathrm{blk}}' }, TA) });
    const a = op('ae-softmax', A.softmax(ms), ['attn', 'softmax'], { wsub: WA, out: 'a-attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: Lm({ label: 'pesos de atención', tex: 'A' }, TA) });
    const zh = op('ae-weighted-sum', A.attention_weighted_sum(a, va), ['attn', 'weighted-sum'], { wsub: WA, out: 'a-z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: Lm({ label: 'salida por cabeza', tex: 'AV' }, TA) });
    const z = op('ae-merge', A.merge_heads(zh, { Dsym: 'h·d_h' }), ['attn', 'merge'], { wsub: WA, out: 'a-z', label: 'Concatenar las ' + c.h + ' cabezas', type: 'tensorop', group: 'attn', outMeta: Lm({ label: 'cabezas concatenadas', tex: 'Z' }, TA) });
    const o = op('ae-o-proj', A.linear(z, { dout: c.Da, doutSym: 'D_a', bias: false }), ['attn', 'o-proj'], { wsub: WA, out: 'a-o', label: 'W_O del experto (h·d_h → D_a)', type: 'embed', group: 'attn', outMeta: Lm({ label: 'salida de la atención', tex: 'O = ZW_O' }, TA) });
    const r1 = op('ae-res1', A.residual_add(x, o), ['res1'], { out: 'a-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: Lm({ label: 's + atención', tex: "s'" }) });
    const hn2 = op('ae-norm2', A.rmsnorm(r1, { eps: c.eps }), ['norm2'], { out: 'a-h-norm2', label: 'RMSNorm 2 (antes de la FFN)', type: 'norm', group: 'norm', outMeta: Lm({ label: 'entrada normalizada (RMSNorm 2)', tex: "\\mathrm{RMSNorm}_2(s')" }) });
    const gt = op('ae-gate-proj', A.linear(hn2, { dout: c.Dmlpa, doutSym: '4D_a', bias: false }), ['ffn', 'gate-proj'], { wsub: WF, out: 'a-gate', label: 'W_gate (D_a → 4D_a)', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'rama gate', tex: 'sW_{\\mathrm{gate}}' }, TF) });
    const up = op('ae-up-proj', A.linear(hn2, { dout: c.Dmlpa, doutSym: '4D_a', bias: false }), ['ffn', 'up-proj'], { wsub: WF, out: 'a-up', label: 'W_up (D_a → 4D_a)', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'rama up', tex: 'sW_{\\mathrm{up}}' }, TF) });
    const ac = op('ae-gelu', A.gelu(gt), ['ffn', 'gelu'], { wsub: WF, out: 'a-act', label: 'GELU (tanh) sobre la rama gate', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'compuerta GELU(gate)', tex: '\\mathrm{GELU}(sW_{\\mathrm{gate}})' }, TF) });
    const pr = op('ae-mul', A.mul(ac, up), ['ffn', 'mul'], { wsub: WF, out: 'a-prod', label: 'Producto GELU(gate) ⊙ up', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'compuerta ⊙ up', tex: '\\mathrm{GELU}(\\cdot)\\odot sW_{\\mathrm{up}}' }, TF) });
    const f = op('ae-down-proj', A.linear(pr, { dout: c.Da, doutSym: 'D_a', bias: false }), ['ffn', 'down-proj'], { wsub: WF, out: 'a-f', label: 'W_down (4D_a → D_a)', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'salida de la FFN', tex: 'F' }, TF) });
    return op('ae-res2', A.residual_add(r1, f), ['res2'], { out: 'a-x-out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: { label: 'Experto · salida del bloque (tras las L capas)', tex: 'y_L', perLayer: false, note: 'Salida de cada capa; tras la capa L es y_L.' } });
  }

  // ------------------------------------------------------------------ roofline (≈)
  // Un segmento: máx(FLOPs / pico, bytes / ancho de banda) en ms. bytes = pesos (bf16) + extra.
  function seg(macs, weightParams, extraBytes, hw) {
    const tc = 2 * macs / hw.peakFlops, bytes = 2 * weightParams + (extraBytes || 0), tm = bytes / hw.bandwidth;
    return { ms: 1000 * Math.max(tc, tm), bound: tc >= tm ? 'cómputo' : 'memoria', bytes, computeMs: 1000 * tc, memoryMs: 1000 * tm };
  }
  function hwFrom(ov) {
    const bw = ov.bandwidth !== undefined ? ov.bandwidth : H100.bandwidth;
    const peak = ov.peakFlops !== undefined ? ov.peakFlops : H100.peakFlops;
    [['bandwidth', bw], ['peakFlops', peak]].forEach(([k, v]) => { if (!(typeof v === 'number' && v > 0 && isFinite(v))) throw new Error(k + ' debe ser un número positivo.'); });
    return { id: 'custom', key: '', label: ov.bandwidth !== undefined || ov.peakFlops !== undefined ? 'hardware dado' : 'H100 SXM', bandwidth: bw, peakFlops: peak, source: ov.bandwidth !== undefined || ov.peakFlops !== undefined ? 'entradas bandwidth / peakFlops' : H100.source };
  }
  const nd = (r, id) => r.totals.byNode[id] || { params: 0, macs: 0 };
  const idleOf = (r, root) => r.ops.filter((o) => o.prim === 'idle_params' && o.path[0] === root).reduce((s, o) => s + o.params, 0);

  // ------------------------------------------------------------------ OpenVLA: cantidades y métricas
  function ovlaParts(c, r) {
    const dino = nd(r, 'dinov2'), sig = nd(r, 'siglip'), proj = nd(r, 'projector');
    const llm = nd(r, 'llm'), head = nd(r, 'lm-head'), emb = nd(r, 'embed');
    const kvTok = 2 * c.L * c.G * c.dh * 2;
    const decode = r.ops.find((o) => o.id === 'ar-decode');
    const idle = idleOf(r, 'dinov2') + idleOf(r, 'siglip');
    const discarded = nd(r, 'last-layer').macs;
    const visionMacs = dino.macs + sig.macs;
    const llmPrefillMacs = llm.macs + head.macs;
    return {
      dinoParams: dino.params, siglipParams: sig.params, visionParams: dino.params + sig.params, idleParams: idle, visionParamsUsed: dino.params + sig.params - idle,
      projectorParams: proj.params, llmParams: llm.params + head.params + emb.params, embedParams: emb.params, lmHeadParams: head.params, totalParams: r.totals.params,
      dinoMacs: dino.macs, siglipMacs: sig.macs, visionMacs, visionMacsDiscarded: discarded, projectorMacs: proj.macs, llmPrefillMacs,
      prefillMacs: visionMacs + proj.macs + llmPrefillMacs, decodeMacsTotal: decode ? decode.macs : 0, decodeSteps: decode ? decode.detail.steps.slice() : [],
      macsPerAction: r.totals.macs, kvTok,
    };
  }
  function ovlaQuantities(c, r) {
    const p = ovlaParts(c, r);
    return Object.assign({
      tokens: c.S, visualTokens: c.N, textTokens: c.T, promptTokens: c.S, patches: c.Np, actionTokensPerStep: c.da, actionBins: c.bins,
      actionTokenFirst: c.actionTokenFirst, actionTokenLast: c.actionTokenLast, decodeStepsCount: c.decodeSteps, binCenters: c.bins - 1,
      H: c.H, W: c.W, P: c.P, D: c.D, L: c.L, h: c.h, G: c.G, dh: c.dh, Dmlp: c.Dmlp, V: c.V, Vtok: c.Vtok, T: c.T, N: c.N, Np: c.Np, S: c.S, da: c.da,
      Dd: c.Dd, Ld: c.Ld, hd: c.hd, dd: c.dd, Dmlpd: c.Dmlpd, Ds: c.Ds, Ls: c.Ls, hs: c.hs, ds: c.ds, Ms: c.Ms, Dv: c.Dv, Dproj: c.Dproj, reg: c.reg,
      kvBytesPerToken: p.kvTok, kvBytesPrompt: c.S * p.kvTok, weightBytes: 2 * r.totals.params, decodeWeightBytesRead: 2 * (p.llmParams - p.embedParams),
      paperHz: 6, paperVramGB: 15, paperEpisodes: 970000, paperA100Hours: 21500,
      instruction: c.instruction, images: c.images, res: c.res,
    }, Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'number')));
  }
  function ovlaLatency(c, r, p, hw) {
    const vis = seg(p.visionMacs + p.projectorMacs, p.visionParamsUsed + p.projectorParams, 0, hw);
    const llmW = p.llmParams - p.embedParams;
    // filas de embedding: solo las T de texto (las N visuales salen del proyector, no de la tabla); como pi0Latency.
    const pre = seg(p.llmPrefillMacs, llmW, c.T * c.D * 2 + c.S * p.kvTok, hw);
    const decs = p.decodeSteps.map((z) => seg(z.macs, llmW, c.D * 2 + z.ctx * p.kvTok, hw));
    const decMs = decs.reduce((s, x) => s + x.ms, 0);
    const actionMs = vis.ms + pre.ms + decMs;
    return { id: hw.id, label: hw.label, bandwidth: hw.bandwidth, peakFlops: hw.peakFlops, source: hw.source, estimate: !!hw.estimate,
      visionMs: vis.ms, prefillMs: pre.ms, llmPrefillMs: pre.ms, decodeMs: decs.length ? decs[0].ms : 0, decodeTotalMs: decMs, actionMs, hz: 1000 / actionMs,
      prefillBound: pre.bound, visionBound: vis.bound, decodeBound: decs.length ? decs[0].bound : null,
      segments: [{ id: 'vision', label: 'visión + proyector', ms: vis.ms }, { id: 'prefill', label: 'prefill del LLM', ms: pre.ms }, { id: 'decode', label: (c.da - 1) + ' pasos de decode', ms: decMs }] };
  }
  function ovlaMetrics(c, r, o) {
    const ov = o.overrides || {};
    const p = ovlaParts(c, r);
    const hw = hwFrom(ov);
    const base = ovlaLatency(c, r, p, hw);
    const out = {
      visualTokens: c.N, textTokens: c.T, promptTokens: c.S, actionTokensPerStep: c.da, actionBins: c.bins, decodeSteps: c.decodeSteps,
      actionTokenFirst: c.actionTokenFirst, actionTokenLast: c.actionTokenLast,
      dinoParams: p.dinoParams, siglipParams: p.siglipParams, visionParams: p.visionParams, visionParamsUsed: p.visionParamsUsed, idleParams: p.idleParams,
      projectorParams: p.projectorParams, llmParams: p.llmParams, embedParams: p.embedParams, totalParams: p.totalParams,
      dinoMacs: p.dinoMacs, siglipMacs: p.siglipMacs, visionMacs: p.visionMacs, visionMacsDiscarded: p.visionMacsDiscarded, projectorMacs: p.projectorMacs,
      llmPrefillMacs: p.llmPrefillMacs, prefillMacs: p.prefillMacs, decodeMacsPerToken: p.decodeSteps.length ? p.decodeSteps[0].macs : 0, decodeMacsTotal: p.decodeMacsTotal,
      macsPerAction: p.macsPerAction, prefillShare: p.prefillMacs / p.macsPerAction, visionMacsShare: p.visionMacs / p.macsPerAction,
      kvBytesPerToken: p.kvTok, kvBytesPrompt: c.S * p.kvTok, weightBytes: 2 * p.totalParams, decodeWeightBytesRead: 2 * (p.llmParams - p.embedParams),
      visionMs: base.visionMs, prefillMs: base.prefillMs, decodeMs: base.decodeMs, decodeTotalMs: base.decodeTotalMs, actionMs: base.actionMs, hz: base.hz,
      actionBound: base.prefillBound, decodeBound: base.decodeBound, bandwidth: hw.bandwidth, peakFlops: hw.peakFlops, hardwareSource: hw.source,
      paperHz: 6, units: VLA_UNITS,
    };
    out.hardware = HARDWARE.map((h) => ovlaLatency(c, r, p, h));
    out.hardware.forEach((h) => {
      const k = HARDWARE.find((x) => x.id === h.id).key;
      Object.assign(out, { ['visionMs' + k]: h.visionMs, ['prefillMs' + k]: h.prefillMs, ['decodeMs' + k]: h.decodeMs, ['actionMs' + k]: h.actionMs, ['hz' + k]: h.hz });
    });
    // T (largo del prompt): el prefill crece, el decode casi no
    out.textScaling = [8, 22, 64, 256].map((T) => {
      const rr = A.run(r.id, { T }), pp = ovlaParts(rr.config, rr), l = ovlaLatency(rr.config, rr, pp, HARDWARE[1]);
      return { T, promptTokens: rr.config.S, prefillMacs: pp.prefillMacs, decodeMacsTotal: pp.decodeMacsTotal, macsPerAction: pp.macsPerAction, actionMsRtx4090: l.actionMs, hzRtx4090: l.hz };
    });
    return out;
  }

  // ------------------------------------------------------------------ π0: cantidades y métricas
  function pi0Parts(c, r) {
    const sig = nd(r, 'siglip'), prj = r.totals.byPath['siglip>img-proj'] || { params: 0, macs: 0 };
    const gem = nd(r, 'gemma'), lang = nd(r, 'language'), ex = nd(r, 'action-expert');
    const sufNodes = ['state', 'noisy-actions', 't-embed', 'velocity', 'euler'];
    const actProjParams = sufNodes.reduce((s, k) => s + nd(r, k).params, 0);
    const flowMacs = sufNodes.reduce((s, k) => s + nd(r, k).macs, 0) + ex.macs;
    const flowStepMacs = flowMacs / c.steps;
    const kvTok = 2 * c.L * c.G * c.dh * 2;
    const visionMacs = sig.macs, prefixMacs = sig.macs + gem.macs + lang.macs;
    return {
      siglipParams: sig.params - prj.params, imgProjParams: prj.params, gemmaParams: gem.params + lang.params, paligemmaParams: sig.params + gem.params + lang.params,
      expertParams: ex.params, actionProjParams: actProjParams, totalParams: r.totals.params, embedParams: lang.params,
      visionMacs, gemmaPrefixMacs: gem.macs, prefixMacs, flowStepMacs, expertStepMacs: ex.macs / c.steps, flowMacs, macsPerChunk: r.totals.macs, kvTok,
    };
  }
  function pi0Quantities(c, r) {
    const p = pi0Parts(c, r);
    return Object.assign({
      tokens: c.S, cams: c.cams, visualTokens: c.N, visualTokensPerImage: c.Np, textTokens: c.T, prefixTokens: c.S, suffixTokens: c.suffix, kvRows: c.ctx,
      chunk: c.Ha, steps: c.steps, actionDim: c.da, H: c.H, W: c.W, P: c.P, D: c.D, L: c.L, h: c.h, G: c.G, dh: c.dh, Dmlp: c.Dmlp, V: c.V, T: c.T, N: c.N, Np: c.Np,
      S: c.S, Ds: c.Ds, Ls: c.Ls, hs: c.hs, ds: c.ds, Ms: c.Ms, Da: c.Da, Dmlpa: c.Dmlpa, Ha: c.Ha, da: c.da, Dq: c.Dq,
      macsPerAction: p.macsPerChunk / c.Ha, kvBytesPerToken: p.kvTok, prefixKvBytes: c.S * p.kvTok, weightBytes: 2 * r.totals.params,
      expertLayersParams: nd(r, 'block').params - (r.totals.byPath['gemma>block'] || { params: 0 }).params,
      paperParamsB: 3.3, paperExpertParamsM: 300, paperImageMs: 14, paperPrefixMs: 32, paperFlowMs: 27, paperOnboardMs: 73, paperOffboardMs: 86, paperNetworkMs: 13,
      paperControlHzFast: 50, paperExecutedFast: 25, paperControlHzSlow: 20, paperExecutedSlow: 16,
    }, Object.fromEntries(Object.entries(p).filter(([k, v]) => typeof v === 'number' && k !== 'kvTok')));
  }
  function pi0Latency(c, r, p, hw) {
    const img = seg(p.visionMacs, p.siglipParams + p.imgProjParams, 0, hw);
    const gemW = p.gemmaParams - p.embedParams;
    const pre = seg(p.gemmaPrefixMacs, gemW, c.T * c.D * 2 + c.S * p.kvTok, hw);
    const step = seg(p.flowStepMacs, p.expertParams + p.actionProjParams, c.ctx * p.kvTok, hw);
    const flowMs = c.steps * step.ms, chunkMs = img.ms + pre.ms + flowMs;
    return { id: hw.id, label: hw.label, bandwidth: hw.bandwidth, peakFlops: hw.peakFlops, source: hw.source, estimate: !!hw.estimate,
      imageMs: img.ms, prefixMs: pre.ms, flowStepMs: step.ms, flowMs, chunkMs, chunkHz: 1000 / chunkMs, actionsPerSecond: c.Ha * 1000 / chunkMs,
      imageBound: img.bound, prefixBound: pre.bound, flowBound: step.bound,
      segments: [{ id: 'vision', label: 'encoders de imagen', ms: img.ms }, { id: 'prefix', label: 'prefijo (Gemma)', ms: pre.ms }, { id: 'flow', label: c.steps + ' pasos de flow', ms: flowMs }] };
  }
  function pi0Metrics(c, r, o) {
    const ov = o.overrides || {};
    const p = pi0Parts(c, r);
    const hw = hwFrom(ov);
    const base = pi0Latency(c, r, p, hw);
    const out = {
      cams: c.cams, visualTokens: c.N, visualTokensPerImage: c.Np, textTokens: c.T, prefixTokens: c.S, suffixTokens: c.suffix, kvRows: c.ctx,
      chunk: c.Ha, steps: c.steps, actionDim: c.da,
      siglipParams: p.siglipParams, imgProjParams: p.imgProjParams, gemmaParams: p.gemmaParams, paligemmaParams: p.paligemmaParams, expertParams: p.expertParams,
      actionProjParams: p.actionProjParams, totalParams: p.totalParams,
      visionMacs: p.visionMacs, gemmaPrefixMacs: p.gemmaPrefixMacs, prefixMacs: p.prefixMacs, flowStepMacs: p.flowStepMacs, expertStepMacs: p.expertStepMacs,
      flowMacs: p.flowMacs, macsPerChunk: p.macsPerChunk, macsPerAction: p.macsPerChunk / c.Ha,
      prefixShare: p.prefixMacs / p.macsPerChunk, flowShare: p.flowMacs / p.macsPerChunk,
      kvBytesPerToken: p.kvTok, prefixKvBytes: c.S * p.kvTok, weightBytes: 2 * p.totalParams,
      imageMs: base.imageMs, prefixMs: base.prefixMs, flowStepMs: base.flowStepMs, flowMs: base.flowMs, chunkMs: base.chunkMs, chunkHz: base.chunkHz,
      actionsPerSecond: base.actionsPerSecond, prefixBound: base.prefixBound, flowBound: base.flowBound,
      bandwidth: hw.bandwidth, peakFlops: hw.peakFlops, hardwareSource: hw.source,
      paperOnboardMs: 73, units: VLA_UNITS,
    };
    out.hardware = HARDWARE.map((h) => pi0Latency(c, r, p, h));
    out.hardware.forEach((h) => {
      const k = HARDWARE.find((x) => x.id === h.id).key;
      Object.assign(out, { ['imageMs' + k]: h.imageMs, ['prefixMs' + k]: h.prefixMs, ['flowMs' + k]: h.flowMs, ['chunkMs' + k]: h.chunkMs, ['chunkHz' + k]: h.chunkHz });
    });
    out.paperLatency = { source: 'Black et al. 2024, Tabla I (Apéndice D), RTX 4090', imageMs: 14, prefixMs: 32, flowMs: 27, networkMs: 13, onboardMs: 73, offboardMs: 86 };
    // Control del paper: a 50 Hz se ejecutan 25 acciones por chunk (inferencia cada 0.5 s); a 20 Hz, 16 (cada 0.8 s).
    const rtx = out.hardware.find((h) => h.id === 'rtx4090');
    out.chunkRates = [[50, 25], [20, 16]].map(([controlHz, executed]) => ({ controlHz, executed, intervalMs: 1000 * executed / controlHz, chunkRateHz: controlHz / executed,
      chunkMsRtx4090: rtx.chunkMs, fitsRtx4090: rtx.chunkMs <= 1000 * executed / controlHz, paperOnboardMs: 73 }));
    const arch = {};
    Object.keys(r.overrides || {}).forEach((k) => { if (k in (A.model(r.model).knobs || {})) arch[k] = r.overrides[k]; });
    const row = (rr) => { const pp = pi0Parts(rr.config, rr), l = pi0Latency(rr.config, rr, pp, HARDWARE[1]);
      return { prefixTokens: rr.config.S, prefixMacs: pp.prefixMacs, flowStepMacs: pp.flowStepMacs, macsPerChunk: pp.macsPerChunk, chunkMsRtx4090: l.chunkMs, flowMsRtx4090: l.flowMs }; };
    out.stepsScaling = [1, 5, 10, 20].map((steps) => Object.assign({ steps }, row(A.run(r.id, Object.assign({}, arch, { steps })))));
    out.chunkScaling = [10, 25, 50, 100].map((H) => Object.assign({ H }, row(A.run(r.id, Object.assign({}, arch, { H })))));
    out.camsScaling = [1, 2, 3].map((cams) => Object.assign({ cams }, row(A.run(r.id, Object.assign({}, arch, { cams })))));
    return out;
  }

  const VLA_UNITS = {
    visualTokens: 'count', visualTokensPerImage: 'count', textTokens: 'count', promptTokens: 'count', prefixTokens: 'count', suffixTokens: 'count', kvRows: 'count',
    actionTokensPerStep: 'count', actionBins: 'count', decodeSteps: 'count', actionTokenFirst: 'count', actionTokenLast: 'count', cams: 'count', chunk: 'count',
    steps: 'count', actionDim: 'count',
    dinoParams: 'params', siglipParams: 'params', visionParams: 'params', visionParamsUsed: 'params', idleParams: 'params', projectorParams: 'params',
    llmParams: 'params', embedParams: 'params', totalParams: 'params', imgProjParams: 'params', gemmaParams: 'params', paligemmaParams: 'params',
    expertParams: 'params', actionProjParams: 'params',
    dinoMacs: 'macs', siglipMacs: 'macs', visionMacs: 'macs', visionMacsDiscarded: 'macs', projectorMacs: 'macs', llmPrefillMacs: 'macs', prefillMacs: 'macs',
    decodeMacsPerToken: 'macs', decodeMacsTotal: 'macs', macsPerAction: 'macs', gemmaPrefixMacs: 'macs', prefixMacs: 'macs', flowStepMacs: 'macs',
    expertStepMacs: 'macs', flowMacs: 'macs', macsPerChunk: 'macs',
    prefillShare: 'pct', visionMacsShare: 'pct', prefixShare: 'pct', flowShare: 'pct',
    kvBytesPerToken: 'bytes', kvBytesPrompt: 'bytes', prefixKvBytes: 'bytes', weightBytes: 'bytes', decodeWeightBytesRead: 'bytes',
    visionMs: 'ms', prefillMs: 'ms', decodeMs: 'ms', decodeTotalMs: 'ms', actionMs: 'ms', imageMs: 'ms', prefixMs: 'ms', flowStepMs: 'ms', flowMs: 'ms', chunkMs: 'ms',
    hz: 'ratio', chunkHz: 'ratio', actionsPerSecond: 'ratio', paperHz: 'count', paperOnboardMs: 'ms', bandwidth: 'count', peakFlops: 'count',
    attnMacs: 'macs', scoreMacs: 'macs', linearMacs: 'macs',   // genéricas de ATLAS.Arch.metrics
  };
  HARDWARE.forEach((h) => {
    ['visionMs', 'prefillMs', 'decodeMs', 'actionMs', 'imageMs', 'prefixMs', 'flowMs', 'chunkMs'].forEach((k) => { VLA_UNITS[k + h.key] = 'ms'; });
    VLA_UNITS['hz' + h.key] = 'ratio'; VLA_UNITS['chunkHz' + h.key] = 'ratio';
  });

  // ------------------------------------------------------------------ ayudas: RT-2, tokenizador de acciones, máscara de π0
  // RT-2 (Brohan et al. 2023, arXiv:2307.15818, §3.2): cada paso = 8 enteros (terminar + Δpos 3 + Δrot 3 + pinza 1), cada
  // dimensión continua en 256 bins, escritos como texto. o = {dims=7, terminate=true, bins=256, hz}
  function rt2Tokens(o) {
    o = o || {};
    const dims = o.dims != null ? o.dims : 7, term = o.terminate !== false ? 1 : 0, bins = o.bins || 256;
    const tokensPerStep = dims + term;
    const r = { dims, terminate: term, bins, tokensPerStep, bitsPerDim: Math.log2(bins), valuesPerStep: Math.pow(bins, dims) };
    if (o.hz != null) Object.assign(r, { hz: o.hz, tokensPerSecond: tokensPerStep * o.hz, msPerStep: 1000 / o.hz, msPerToken: 1000 / (o.hz * tokensPerStep) });
    return r;
  }
  // Discretización uniforme en `bins` intervalos de [lo, hi] (RT-2): índice 0..bins−1 y su centro.
  function discretize(x, o) {
    o = o || {};
    const bins = o.bins || 256, lo = o.lo != null ? o.lo : -1, hi = o.hi != null ? o.hi : 1;
    const t = Math.min(Math.max((x - lo) / (hi - lo), 0), 1);
    const bin = Math.min(bins - 1, Math.floor(t * bins));
    const center = lo + (bin + 0.5) * (hi - lo) / bins;
    return { bin, center, error: x - center, width: (hi - lo) / bins };
  }
  const binCenter = (bin, o) => { o = o || {}; const bins = o.bins || 256, lo = o.lo != null ? o.lo : -1, hi = o.hi != null ? o.hi : 1; return lo + (bin + 0.5) * (hi - lo) / bins; };
  // OpenVLA (ActionTokenizer / predict_action): edges = linspace(−1, 1, 256); b = digitize(clip(x)) ∈ [1, 256]; id = 32,000 − b.
  // Detokenizar: centro = centers[clip(b − 1, 0, 254)] (255 centros). x en [−1, 1] = ya normalizado con q01 / q99.
  function openvlaTokenize(x, o) {
    o = o || {};
    const n = o.bins || 256, vocab = o.vocab || 32000;
    const xc = Math.min(Math.max(x, -1), 1);
    let b = 0;
    for (let i = 0; i < n; i++) { if (xc >= -1 + (2 * i) / (n - 1)) b = i + 1; }
    return { bin: b, id: vocab - b };
  }
  function openvlaDetokenize(id, o) {
    o = o || {};
    const n = o.bins || 256, vocab = o.vocab || 32000;
    const b = Math.min(Math.max(vocab - id - 1, 0), n - 2);
    const lo = -1 + (2 * b) / (n - 1), hi = -1 + (2 * (b + 1)) / (n - 1);
    return { bin: vocab - id, center: (lo + hi) / 2 };
  }
  // Máscara de π0 (make_attn_mask): ar_mask por token (prefijo 0…0, estado 1, 1.ª acción 1, resto 0); i ve a j si
  // cumsum[j] ≤ cumsum[i]. groups = [{id, from, to}] y matrix[g1][g2] = ¿el grupo g1 (queries) ve al g2 (keys)?
  function pi0Mask(o) {
    o = o || {};
    const cams = o.cams != null ? o.cams : 3, Np = o.Np || 256, T = o.T != null ? o.T : 48, H = o.H || 50;
    const groups = [];
    let at = 0;
    for (let i = 0; i < cams; i++) { groups.push({ id: 'image-' + (i + 1), kind: 'images', from: at, to: at + Np }); at += Np; }
    groups.push({ id: 'language', kind: 'language', from: at, to: at + T }); at += T;
    groups.push({ id: 'state', kind: 'state', from: at, to: at + 1 }); at += 1;
    groups.push({ id: 'actions', kind: 'actions', from: at, to: at + H }); at += H;
    const cum = (g) => (g.kind === 'state' ? 1 : g.kind === 'actions' ? 2 : 0);
    const matrix = groups.map((q) => groups.map((k) => cum(k) <= cum(q)));
    return { groups, matrix, total: at, canAttend: (qi, kj) => { const gq = groups.find((g) => qi >= g.from && qi < g.to), gk = groups.find((g) => kj >= g.from && kj < g.to); return !!(gq && gk) && cum(gk) <= cum(gq); } };
  }

  A.vla = { hardware: () => HARDWARE.map((h) => Object.assign({}, h)), rt2Tokens, discretize, binCenter, openvlaTokenize, openvlaDetokenize, pi0Mask,
    primitives: () => A.primitives().filter((p) => VLA_PRIM_IDS.includes(p.id)).sort((x, y) => VLA_PRIM_IDS.indexOf(x.id) - VLA_PRIM_IDS.indexOf(y.id)), prims: Object.assign({}, P) };

  A.defineModel({
    id: 'openvla',
    label: 'OpenVLA (DINOv2 + SigLIP + MLP + Llama 2 7B; acciones como tokens)',
    paper: { title: 'OpenVLA: An Open-Source Vision-Language-Action Model', authors: 'Kim, Pertsch, Karamcheti et al.', venue: 'CoRL 2024', year: 2024, arxiv: '2406.09246',
      note: 'Backbone Prismatic: Karamcheti et al., Prismatic VLMs, ICML 2024, arXiv:2402.07865. DINOv2: Oquab et al. 2023, arXiv:2304.07193 (registros: Darcet et al., ICLR 2024, arXiv:2309.16588). SigLIP: Zhai et al., ICCV 2023, arXiv:2303.15343. Llama 2: arXiv:2307.09288.' },
    configs: OPENVLA,
    knobs: { T: [8, 22, 64, 256], res: [224, 336, 448], images: [1, 2, 3], da: [7, 14] },
    hardware: HARDWARE.map((h) => Object.assign({}, h)),
    applyKnobs: ovlaApply, resolve: ovlaResolve, build: ovlaBuild, quantities: ovlaQuantities, metrics: ovlaMetrics,
  });

  A.defineModel({
    id: 'pi0',
    label: 'π0 (PaliGemma 3B + experto de acción; flow matching sobre chunks)',
    paper: { title: 'π0: A Vision-Language-Action Flow Model for General Robot Control', authors: 'Black, Brown, Driess et al. (Physical Intelligence)', venue: 'RSS 2025', year: 2024, arxiv: '2410.24164',
      note: 'Código oficial: github.com/Physical-Intelligence/openpi. PaliGemma: Beyer et al. 2024, arXiv:2407.07726. Gemma: arXiv:2403.08295. Flow matching: Lipman et al., ICLR 2023, arXiv:2210.02747.' },
    configs: PI0,
    knobs: { cams: [1, 2, 3], H: [10, 25, 50, 100], steps: [1, 5, 10, 20], T: [16, 48, 64] },
    hardware: HARDWARE.map((h) => Object.assign({}, h)),
    applyKnobs: pi0Apply, resolve: pi0Resolve, build: pi0Build, quantities: pi0Quantities, metrics: pi0Metrics,
  });
})(typeof window !== 'undefined' ? window : globalThis);
