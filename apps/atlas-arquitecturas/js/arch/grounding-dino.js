/* =============================================================================
   Atlas de Arquitecturas — js/arch/grounding-dino.js
   Modelo `grounding-dino` (Liu et al., Grounding DINO: Marrying DINO with Grounded Pre-Training for Open-Set
   Object Detection, ECCV 2024, arXiv:2303.05499; código oficial IDEA-Research/GroundingDINO).
   Referencia del cross-check: HF `GroundingDinoForObjectDetection(GroundingDinoConfig(...))` construido en código
   (Swin-T y BERT-base SIN pesos, sin hub ni tokenizer; crosscheck/grounding_dino.py). Contrato de ids: SPEC §16.1.

   Convenciones: formas sin batch; rejillas H×W×C (PyTorch: C×H×W). Símbolos: C = 96 (ancho del stage 1 de
   Swin-T; stages C, 2C, 4C, 8C), M = 7 (ventana), D = 256 (ancho del transformer), h = 8 cabezas (d_h = 32),
   D_mlp = 2048 (FFN de la imagen y del decoder), T tokens de texto (knob, 16 por defecto, máximo 256),
   V = 30,522 (vocabulario de BERT), N = Σ_l H_l·W_l tokens de imagen (4 niveles, strides 8, 16, 32, 64),
   L = 4 niveles y K = 4 puntos por cabeza y nivel (notación de Deformable DETR), Q = 900 queries, G objetos
   reales (solo entrenamiento). El texto del feature enhancer usa h/2 = 4 cabezas y FFN D_mlp/2 = 1024; la
   fusión imagen ↔ texto proyecta a E = D_mlp/2 = 1024 con h/2 = 4 cabezas de 256 (como HF y el oficial:
   embed_dim = dim_feedforward // 2, num_heads = nhead // 2). BERT: 12 capas post-LN de 768 con 12 cabezas y
   FFN 3072 (las formas escriben 768 y la tabla de posición 512 como números).

   Config canónica grounding-dino-t: 896×1344×3. Los cuatro stages de Swin (224×336, 112×168, 56×84, 28×42) son
   múltiplos exactos de la ventana 7×7: no hay padding (el entrenamiento estilo DINO usa lado corto 800 y Swin
   rellena hasta múltiplo de 7; el calculador no modela ese padding y exige H y W múltiplos de 224).
   Niveles: 112×168, 56×84, 28×42 y 14×21 (conv 3×3 stride 2 sobre el stage 4) → N = 24,990 tokens.

   PARÁMETROS (cross-check exacto contra HF, ver crosscheck/expected/grounding-dino-t.json):
   - HF SwinBackbone conserva `swin.layernorm` (768·2 = 1,536 parámetros) que su forward NO usa (el backbone
     normaliza cada salida con hidden_states_norms): el calculador no lo cuenta (no hay op que lo use) y el JSON
     lo resta (params_total = HF − 1,536; params_total_hf_raw guarda el crudo). quantities.unusedSwinLnParams.
   - HF construye BERT sin pooler (add_pooling_layer = False). El código oficial envuelve un BertModel con
     pooler (congelado y sin uso): quantities.bertPoolerParams = 768·768 + 768 (no se suma).
   - Pesos COMPARTIDOS: el MLP de cajas de la cabeza (box-head) es el mismo módulo que refina las cajas en
     cada capa del decoder (decoder_bbox_embed_share = True): las ops de refinamiento (d-refine-*) tienen
     0 parámetros y detail.sharedWith = 'box-head'. El MLP que convierte la caja de referencia en query_pos
     (reference_points_head) es UNO para las 6 capas: su op (decoder › ref-head, repeat 1) cuenta sus
     parámetros una vez y sus MACs × L_dec (detail.calls = 6), porque se aplica en cada capa.
   - El MLP de cajas de la query selection (encoder_output_bbox_embed) es otra copia (two_stage_bbox_embed_share
     = False, como la config oficial SwinT_OGC).
   MACs: convención del calculador (MACs de matmuls/convs; FLOPs = 2·MACs). Muestreo deformable analítico
   (4 MACs por lectura bilineal + 1 de la suma ponderada, como Deformable DETR: FlopCounterMode no cuenta
   grid_sample). Las cabezas predicen con la última capa del decoder (repeat 1): HF y el oficial aplican
   además cabezas a las 5 capas intermedias en cada forward (pérdidas auxiliares) y calculan los logits de
   las queries de contenido contra el texto (encoder_logits, solo para la pérdida): quantities.auxHeadsMacs
   y quantities.encoderLogitsMacs; el cross-check los resta.

   metrics() (además de las genéricas; B = 1 y bf16 por defecto). Unidades: …Macs = MACs, …Mem = bytes, …Share =
   fracción de los MACs totales, …Params = parámetros, ratios (units = 'ratio'): macsVsYolov8, paramsVsYolov8,
   macsVsDetr, paramsVsDetr, macsVsYoloWorld, paramsVsYoloWorld, macsVsYoloWorldAt672, macsVsYoloWorldAt448 (el mismo modelo a
   672×672 y 448×448 contra YOLO-World-L @ 640; macsAt672 / macsAt448 son sus MACs); conteos: fusionAttnEntries, logitsElements, logitsPaddedElements,
   queries, imageTokens, textTokens.
     texto (se paga en CADA imagen): textEncoderMacs (BERT + proyección, T tokens), textEncoderParams,
       textEncoderMacsShare, textEncoderMacsMaxT (con T = 256)
     fusión imagen ↔ texto: fusionMacs (6 capas), fusionMacsLayer, fusionMacsShare, fusionScoreMacsLayer (3·N·T·E),
       fusionAttnEntries (h/2·N·T), fusionAttnMem
     reparto: imgBackboneMacs/-MacsShare, enhancerMacs/-MacsShare, querySelectMacs/-MacsShare, decoderMacs/-MacsShare,
       headMacs, auxHeadsMacs
     deformable: encSamplingMacs, decCrossSamplingMacs, samplingMacs, samplingShare; matrices densas: decSelfScoreMacs,
       decSelfAttnMem (h×Q×Q), decTextScoreMacs, decTextAttnMem (h×Q×T), txtSelfAttnMem (h/2×T×T), denseEncAttnMem
       (h×N×N si el encoder fuera denso)
     salida: logitsElements (Q×T), logitsPaddedElements (Q×256), logitsMem
     comparación (configs de referencia, si están cargadas): yolov8Macs, yolov8Params, detrMacs, detrParams,
       yoloWorldMacs, yoloWorldParams y los ratios de arriba
     listas: scaling [{H, W, tokens, macs, imgBackboneMacs, enhancerMacs, decoderMacs, textEncoderMacs, fusionAttnMem}],
       textScaling [{T, macs, textEncoderMacs, fusionAttnMem}]
     null (no aplican: no hay una matriz h×N×N): attnMem, attnMemAllLayers, scoreMacs, scoreMacsShare, crossoverN…
   actMem (genérica) cuenta los tensores del grafo: las compuestas (atención por ventanas de Swin, capas de BERT) no
   exponen sus intermedios, así que es una cota inferior.

   Vista general `grounding-dino-overview` — nodos (path[0] de las ops):
     img-input (tensor i-img) · img-backbone · img-proj · txt-input · txt-backbone · txt-proj · enhancer ·
     query-select · decoder · dec-norm (añadido) · contrastive-head · box-head · output (sin ops: logits, boxes) ·
     matching · loss
   Ops (id · path · entradas → salida):
     Backbone de imagen (Swin-T; op.where ['Backbone de imagen (Swin-T)', …]):
       i-patch-embed   img-backbone › patch-embed      i-img → i-patch-grid     (conv 4×4 stride 4, con sesgo)
       i-patch-norm    img-backbone › patch-embed      → i-s1-in                (LayerNorm)
       por stage k = 1…4 y bloque j = 1 (W-MSA) / 2 (SW-MSA), repeat = profundidad/2, path img-backbone ›
       stage{k} › block{j}: i-s{k}-b{j}-ln1 · -attn (window_attention compuesta: shift (j = 2), partición,
       qkv, cabezas, QKᵀ, sesgo relativo, máscara, softmax, A·V, proyección, revertir) · -res1 · -ln2 · -fc1 ·
       -gelu · -fc2 · -res2 → i-s{k}-b{j}-ln1, -attn, -r1, -ln2, -u, -g, -f y la salida i-s{k}-b1-out /
       i-s{k}-out (salida del stage)
       i-m{k}          img-backbone › merge{k}          i-s{k}-out → i-m{k}-out  (patch merging, k = 1…3)
       i-s{k}-norm     img-backbone › out-norm          i-s{k}-out → i-c3 / i-c4 / i-c5   (k = 2, 3, 4; LayerNorm)
     Proyección de imagen (img-proj):
       i-proj-l{l} · i-gn-l{l}   img-proj › proj-l{l}   i-c{l+2} → i-src-l{l}-conv → i-src-l{l}  (l = 1…3: conv 1×1
                                 → D + GroupNorm 32; l = 4: conv 3×3 stride 2 sobre i-c5)
       i-flatten       img-proj › flatten               i-src-l1…l4 → i-mem-in (N×D)
       i-pos-enc       img-proj › pos-enc › sine        → i-pos-sine             (seno/coseno, temperatura 20, buffer)
       i-level-embed   img-proj › pos-enc › level-embed → i-level-table          (L×D, aprendido)
       i-add-level     img-proj › pos-enc › add-level   → i-pos
     Texto (txt-input, txt-backbone = BERT-base, txt-proj):
       entradas t-ids (T), t-type-ids (T, ceros)
       t-submask       txt-input › mask                 t-ids → t-mask (T×T), t-pos-ids (T)   (sub-oraciones)
       t-tok-embed · t-pos-embed · t-type-embed  txt-backbone › embeddings › tok/pos/type → t-tok, t-e-pos, t-e-type
       t-add-pos · t-add-type · t-emb-ln          txt-backbone › embeddings › add/ln     → t-x-pos, t-x-sum, t-x0
       capa BERT (repeat 12, path txt-backbone › bert-layer › …, post-LN): t-attn (attn: MHSA compuesta de
       12 cabezas con la máscara t-mask) → t-attn · t-res1 (res1) → t-r1 · t-ln1 (ln1) → t-ln1 · t-ffn (ffn:
       MLP compuesta 768 → 3072 → 768, GELU) → t-ffn · t-res2 (res2) → t-r2 · t-ln2 (ln2) → t-bert-out
       txt-proj        txt-proj                          t-bert-out → t-feat (T×D)
     Feature enhancer (enhancer; capa repeat 6, path enhancer › enh-layer › …):
       enc-ref-points  enhancer › ref-points            → i-ref (N×L×2)
       t-pos-enc       enhancer › txt-pos-enc           t-pos-ids → t-pos (T×D, buffer)
       Fusión (primero): e-fus-ln-img (fus-ln-img) i-mem-in → i-enh-fus-ln · e-fus-ln-txt (fus-ln-txt) t-feat →
         t-enh-fus-ln ·
         i2t (imagen consulta al texto) › {q-proj: e-i2t-q-proj → i-enh-i2t-q (N×E) · k-proj: e-i2t-k-proj →
         t-enh-i2t-k (T×E) · v-proj: e-i2t-v-proj → t-enh-i2t-v · split: e-i2t-split → i-enh-i2t-qh, t-enh-i2t-kh,
         t-enh-i2t-vh · scores: e-i2t-scores → i-enh-fus-scores (h/2×N×T, la ÚNICA matriz de scores de la fusión) ·
         scale: e-i2t-scale → i-enh-fus-scaled · softmax (sobre T): e-i2t-softmax → i-enh-i2t-attn ·
         weighted-sum: e-i2t-weighted-sum → i-enh-i2t-z-heads · merge: e-i2t-merge → i-enh-i2t-z · out-proj:
         e-i2t-out-proj → i-enh-i2t-o (N×D) · gamma: e-i2t-gamma → i-enh-i2t-g (layer scale)}
         t2i (el texto consulta a la imagen, con los MISMOS scores transpuestos) › {v-proj: e-t2i-v-proj →
         i-enh-t2i-v (N×E) · split: e-t2i-split → i-enh-t2i-vh · transpose: e-t2i-transpose → t-enh-t2i-scores
         (h/2×T×N) · softmax (sobre N): e-t2i-softmax → t-enh-t2i-attn · weighted-sum: e-t2i-weighted-sum →
         t-enh-t2i-z-heads · merge: e-t2i-merge → t-enh-t2i-z · out-proj: e-t2i-out-proj → t-enh-t2i-o (T×D) ·
         gamma: e-t2i-gamma → t-enh-t2i-g}
         e-fus-res-img (fus-res-img) → i-enh-fused · e-fus-res-txt (fus-res-txt) → t-enh-fused
       Texto (txt-self, post-LN, h/2 = 4 cabezas): e-txt-add-pos (txt-self › add-pos) → t-enh-qk-in ·
         txt-self › {q-proj, k-proj, v-proj, split, scores, scale, mask, softmax, weighted-sum, merge, proj}:
         e-txt-<nodo> → t-enh-self-qp, -kp, -vp, -q, -k, -v, -scores, -scaled, -masked, -attn, -z-heads, -z, -o ·
         e-txt-res1 (txt-res1) → t-enh-r1 · e-txt-ln1 (txt-ln1) → t-enh-ln1 · txt-ffn › {fc1, relu, fc2}:
         e-txt-fc1/-relu/-fc2 → t-enh-u, t-enh-g, t-enh-f (D → D_mlp/2 → D) · e-txt-res2 (txt-res2) → t-enh-r2 ·
         e-txt-ln2 (txt-ln2) → t-memory (texto tras la capa 6)
       Imagen (img-self = atención deformable, post-LN): e-img-add-pos (img-self › add-pos) → i-enh-q-in ·
         img-self › {value-proj, offsets, attn-weights, softmax, sample, weighted-sum, proj}: e-img-<nodo> →
         i-enh-value, i-enh-offsets, i-enh-aw-logits, i-enh-aw, i-enh-sampled, i-enh-z, i-enh-o ·
         e-img-res1 (img-res1) → i-enh-r1 · e-img-ln1 (img-ln1) → i-enh-ln1 · img-ffn › {fc1, relu, fc2}:
         e-img-fc1/-relu/-fc2 → i-enh-u, i-enh-g, i-enh-f · e-img-res2 (img-res2) → i-enh-r2 · e-img-ln2 (img-ln2)
         → i-memory (imagen tras la capa 6)
     Query selection guiada por lenguaje (query-select):
       qs-proposals    query-select › proposals          → q-proposals (N×4, anclas en logit)
       qs-proj · qs-norm  query-select › enc-output      i-memory → q-cand-proj → q-cand (N×D)
       qs-logits       query-select › enc-logits         q-cand, t-memory → q-enc-logits (N×T)
       qs-box-fc1 · qs-box-relu1 · qs-box-fc2 · qs-box-relu2 · qs-box-fc3   query-select › enc-box › fc1…fc3
                       → q-enc-box-h1, q-enc-box-a1, q-enc-box-h2, q-enc-box-a2, q-enc-delta (N×4)
       qs-box-add      query-select › enc-box › add      q-enc-delta, q-proposals → q-enc-boxes
       qs-topk         query-select › topk               q-enc-logits → q-topk (Q índices: máx. sobre el texto)
       qs-gather · qs-ref-sigmoid   query-select › gather   q-enc-boxes, q-topk → q-ref0-logit → q-ref0 (Q×4)
       query-embed     query-select › content            → q-tgt0 (Q×D: la parte de CONTENIDO es aprendida)
     Decoder (decoder):
       d-ref-pe · d-ref-fc1 · d-ref-relu · d-ref-fc2   decoder › ref-head › pe / fc1 / relu / fc2
                       q-ref0 → q-ref-pe (Q×2D) → q-ref-h → q-ref-a → q-pos (Q×D)   (repeat 1, MACs × 6 capas)
       Capa (repeat 6, path decoder › dec-layer › …, post-LN):
         d-add-qpos (add-qpos) q-tgt0, q-pos → q-qk-in · self-attn › {q-proj … proj}: d-self-<nodo> → q-self-qp,
         -kp, -vp, -q, -k, -v, -scores (h×Q×Q), -scaled, -attn, -z-heads, -z, -o · d-res1 (res1) → q-r1 · d-ln1 (ln1)
         → q-ln1 ·
         txt-cross › {add-qpos: d-txt-add-qpos → q-txt-q-in · q-proj … proj: d-txt-<nodo> → q-txt-qp (Q×D),
         q-txt-kp, q-txt-vp (T×D), q-txt-q, -k, -v, q-txt-scores (h×Q×T), -scaled, -attn, -z-heads, -z, -o} ·
         d-res2 (res2) → q-r2 · d-ln2 (ln2) → q-ln2 ·
         img-cross › {add-qpos: d-img-add-qpos → q-img-q-in · value-proj, offsets, attn-weights, softmax, sample,
         weighted-sum, proj: d-img-<nodo> → q-img-value (N×D), q-img-offsets, q-img-aw-logits, q-img-aw,
         q-img-sampled (h×Q×LK×d_h), q-img-z, q-img-o} · d-res3 (res3) → q-r3 · d-ln3 (ln3) → q-ln3 ·
         ffn › {fc1, relu, fc2}: d-fc1/-relu/-fc2 → q-u, q-g, q-f · d-res4 (res4) → q-r4 · d-ln4 (ln4) → q-out ·
         box-refine › {fc1, relu1, fc2, relu2, fc3, ref, sigmoid}: d-refine-fc1 · -relu1 · -fc2 · -relu2 · -fc3 · d-refine-add ·
         d-refine-sigmoid →
         q-refine-h1, q-refine-a1, q-refine-h2, q-refine-a2, q-refine-delta, q-refine-logit, q-ref
         (caja refinada = referencia de la capa siguiente; 0 parámetros: pesos de box-head)
     dec-norm          dec-norm                          q-out → hs (LayerNorm del decoder)
     contrastive-head  contrastive-head                  hs, t-memory → logits (Q×T; HF rellena a 256 con −∞)
     box-fc1 · box-relu1 · box-fc2 · box-relu2 · box-fc3 · box-ref · box-sigmoid   box-head › fc1 … sigmoid
                       hs → box-h1 → box-a1 → box-h2 → box-a2 → box-raw; box-raw, q-ref → box-logits → boxes (Q×4)
     Entrenamiento: entradas gt-labels (G), gt-boxes (G×4); match-cost · match-assign (matching) → cost (Q×G),
       assignment (G×2); loss (loss) → loss (focal sobre los logits por token + L1 + GIoU).
   Tensores (orden del forward): i-img i-patch-grid i-s1-in · por stage: i-s{k}-b1-ln1 i-s{k}-b1-attn i-s{k}-b1-r1
     i-s{k}-b1-ln2 i-s{k}-b1-u i-s{k}-b1-g i-s{k}-b1-f i-s{k}-b1-out (y los mismos de b2 con salida i-s{k}-out),
     i-c3/i-c4/i-c5 (stages 2–4), i-m1-out i-m2-out i-m3-out · i-src-l{1…4}-conv i-src-l{1…4} i-mem-in i-pos-sine
     i-level-table i-pos · t-ids t-type-ids t-mask t-pos-ids t-tok t-e-pos t-e-type t-x-pos t-x-sum t-x0 t-attn t-r1
     t-ln1 t-ffn t-r2 t-bert-out t-feat · i-ref t-pos · (capa del enhancer, arriba) · i-memory t-memory ·
     q-proposals q-cand-proj q-cand q-enc-logits q-enc-box-h1 q-enc-box-a1 q-enc-box-h2 q-enc-box-a2 q-enc-delta
     q-enc-boxes q-topk q-ref0-logit q-ref0 q-tgt0 q-ref-pe q-ref-h q-ref-a q-pos · (capa del decoder, arriba) ·
     hs logits box-h1 box-a1 box-h2 box-a2 box-raw box-logits boxes gt-labels gt-boxes cost assignment loss
   Añadidos a SPEC §16.1 (nada renombrado): nodo `dec-norm`; nodos internos de la capa del enhancer
   (fus-ln-img, fus-ln-txt, fus-res-img, fus-res-txt, txt-res1/ln1/res2/ln2, img-res1/ln1/res2/ln2 y los internos
   de i2t, t2i, txt-self, img-self, txt-ffn, img-ffn) y del decoder (add-qpos, res1…res4, ln1…ln4, los internos
   de self-attn, txt-cross, img-cross, ffn, y box-refine); decoder › ref-head (query_pos desde la caja de
   referencia); nodos internos de img-backbone (patch-embed, stage1…4 › block1/block2, merge1…3, out-norm),
   img-proj (proj-l1…l4, flatten, pos-enc › sine/level-embed/add-level), txt-input › mask, txt-backbone
   (embeddings, bert-layer › attn/res1/ln1/ffn/res2/ln2), enhancer › ref-points / txt-pos-enc y query-select
   (proposals, enc-output, enc-logits, enc-box, topk, gather, content). Tensores q-… también para los values de la
   cross-attention deformable (q-img-value, N×D: es la memoria de imagen proyectada dentro del decoder).
   Etiquetas de tensor con prefijo de contexto ("Backbone de imagen · Stage 2 · …", "Texto (BERT) · …",
   "Feature enhancer · fusión · …", "Decoder · cross-attention de texto · …") y op.where para la práctica.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('grounding-dino.js necesita js/arch/primitives.js antes.');

  // Swin-T: profundidades, cabezas y ventana de js/arch/swin.js (si está cargado), con la misma regla de bloques.
  const SWIN_T = (function () {
    try {
      const c = A.model('swin').configs['swin-t-224'];
      return { C: c.C, depths: c.depths.slice(), heads: c.heads.slice(), M: c.M, P: c.P, mlpRatio: c.mlpRatio };
    } catch (e) { return { C: 96, depths: [2, 2, 6, 2], heads: [3, 6, 12, 24], M: 7, P: 4, mlpRatio: 4 }; }
  })();

  const base = {
    Cin: 3,
    // Backbone de imagen: Swin-T (HF SwinConfig por defecto = swin_tiny_patch4_window7_224; out_indices [2, 3, 4]).
    P: SWIN_T.P, C: SWIN_T.C, depths: SWIN_T.depths, heads: SWIN_T.heads, M: SWIN_T.M, mlpRatio: SWIN_T.mlpRatio,
    // Texto: BERT-base (bert-base-uncased: 12 capas, 768, 12 cabezas, FFN 3072, vocabulario 30,522, 512 posiciones).
    Lt: 12, Dtxt: 768, ht: 12, Dmlpt: 3072, V: 30522, posMax: 512, typeVocab: 2, T: 16, maxText: 256,
    // Transformer (DINO): D = 256, 8 cabezas, FFN 2048, 6 + 6 capas, 900 queries, 4 niveles × 4 puntos.
    D: 256, h: 8, Dmlp: 2048, Lenc: 6, Ldec: 6, Q: 900, levels: 4, points: 4, gnGroups: 32, posTemperature: 20,
    G: 7,
    // Matching y pérdida (HF GroundingDinoConfig; verificar contra el paper/código antes de citarlos).
    costClass: 1, costBbox: 5, costGiou: 2, lossBbox: 5, lossGiou: 2, focalAlpha: 0.25,
  };

  // Pares (H, W) del explorador de escala: múltiplos de 224 (todos los stages de Swin múltiplos de 7).
  const RES_PAIRS = [[448, 672], [672, 896], [896, 896], [896, 1344], [1120, 1568], [1344, 2016]];

  const SWIN_SYM = ['C', '2C', '4C', '8C'];
  const WB = 'Backbone de imagen (Swin-T)';

  // ------------------------------------------------------------------ knobs y resolución
  function applyKnobs(c, ov) {
    const notes = [];
    const Q0 = c.Q, T0 = c.T;
    if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
    if (ov.H !== undefined) c.H = ov.H;
    if (ov.W !== undefined) c.W = ov.W;
    if (ov.Q !== undefined) c.Q = ov.Q;
    if (ov.T !== undefined) c.T = ov.T;
    if (ov.G !== undefined) c.G = ov.G;
    if (c.Q !== Q0) notes.push('Q = ' + c.Q + ' queries (la config usa ' + Q0 + '): la tabla de contenido pasa a ' + c.Q + '×' + c.D + ' parámetros y la query selection se queda con los ' + c.Q + ' mejores tokens.');
    if (c.T !== T0) notes.push('T = ' + c.T + ' tokens de texto (la config usa ' + T0 + '): cambian BERT, la fusión (h/2×N×T) y los logits (Q×T); los parámetros no.');
    if (['res', 'H', 'W', 'Q', 'T'].some((k) => ov[k] !== undefined)) {
      c.label = 'Grounding DINO-T @ ' + c.H + '×' + c.W + (c.T !== T0 ? ' · T = ' + c.T : '') + (c.Q !== Q0 ? ' · Q = ' + c.Q : '');
    }
    c._notes = notes;
    return c;
  }

  function resolve(c) {
    if (c.H % 224 !== 0 || c.W % 224 !== 0) {
      throw new Error('Grounding DINO: H y W deben ser múltiplos de 224 (recibí ' + c.H + '×' + c.W + ') para que cada stage de Swin sea múltiplo de la ventana 7×7 (el calculador no modela el padding).');
    }
    if (c.T < 1 || c.T > c.maxText) throw new Error('Grounding DINO: T = ' + c.T + ' tokens de texto; el máximo es ' + c.maxText + ' (max_text_len).');
    if (c.D % c.h !== 0) throw new Error('Grounding DINO: D = ' + c.D + ' no es divisible por h = ' + c.h + '.');
    if (c.H === c.W) c.res = c.H; else delete c.res;
    c.stages = c.depths.map((depth, i) => {
      const k = i + 1, f = c.P * Math.pow(2, i);
      const Hk = c.H / f, Wk = c.W / f, Ck = c.C * Math.pow(2, i), hk = c.heads[i];
      if (depth % 2 !== 0) throw new Error('Grounding DINO: la profundidad del stage ' + k + ' de Swin debe ser par.');
      return {
        k, H: Hk, W: Wk, tokens: Hk * Wk, C: Ck, Csym: SWIN_SYM[i], h: hk, dh: Ck / hk, depth, pairs: depth / 2, stride: f,
        windows: (Hk / c.M) * (Wk / c.M), shift: Math.floor(c.M / 2), sym: ['H/' + f, 'W/' + f],
      };
    });
    const h5 = c.H / 32, w5 = c.W / 32;
    c.levelShapes = [[c.H / 8, c.W / 8], [c.H / 16, c.W / 16], [h5, w5], [Math.ceil(h5 / 2), Math.ceil(w5 / 2)]];
    c.levelTokens = c.levelShapes.map(([a, b]) => a * b);
    c.N = c.levelTokens.reduce((s, x) => s + x, 0);
    c.tokens = c.N;
    if (c.Q > c.N) throw new Error('Grounding DINO: Q = ' + c.Q + ' queries y solo hay N = ' + c.N + ' tokens de imagen para elegirlas.');
    if (c.G > c.Q) throw new Error('Grounding DINO: hay más objetos reales (G = ' + c.G + ') que queries (Q = ' + c.Q + ').');
    c.dh = c.D / c.h;
    c.hFusion = c.h / 2;                 // 4 cabezas en la fusión y en la self-attention del texto
    c.Efusion = c.Dmlp / 2;              // 1024
    c.DmlpText = c.Dmlp / 2;             // FFN del texto en el enhancer
    c.samples = c.h * c.levels * c.points;
    c.unmatched = c.Q - c.G;
    return c;
  }

  // ------------------------------------------------------------------ utilidades
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  // Fija los símbolos de la salida de una primitiva (y su shapeTex).
  function sym(res, s) {
    const outs = Array.isArray(res.out) ? res.out : [res.out];
    const fixed = outs.map((o, i) => A.shape(Array.isArray(s[0]) ? s[i] : s, o.num, o.mod, o.layout));
    res.out = Array.isArray(res.out) ? fixed : fixed[0];
    res.shapeTex = res.inputs.map(A.fmt.shapeTex).join(',\\ ') + ' \\to ' + fixed.map(A.fmt.shapeTex).join(',\\ ');
    return res;
  }
  // Una op que se aplica `n` veces con la misma forma (una por capa) pero con pesos compartidos: los
  // parámetros cuentan una vez y los MACs n veces.
  function calls(res, n, what) {
    res.detail = Object.assign({}, res.detail, { calls: n, macsPerCall: res.macs, note: what });
    if (res.macs) { res.macArith = n + '·(' + res.macArith.replace(/ = [\d,]+$/, '') + ') = ' + A.fmt.int(res.macs * n); res.macs *= n; }
    if (res.macFormula && res.macFormula !== '0') res.macFormula = 'L_{\\mathrm{dec}}\\cdot ' + res.macFormula;
    res.other *= n;
    return res;
  }
  // Pesos compartidos con otro nodo (se cuentan allí): 0 parámetros en esta op.
  function shared(res, withNode) {
    res.detail = Object.assign({}, res.detail, { sharedWith: withNode, paramsIfNotShared: res.params });
    res.params = 0;
    res.paramArith = '0 (pesos compartidos con ' + withNode + ')';
    res.paramFormula = '0';
    return res;
  }

  // Atención multi-cabeza con Q, K, V separados (GroundingDinoMultiheadAttention / DETR): ops q-proj, k-proj,
  // v-proj, split, scores, scale, [mask], softmax, weighted-sum, merge, proj. s = {g, pre, tpre, P, rep, where,
  // tl, h, hSym, qIn, kIn, vIn, mask, notes…}
  function mhaOps(s) {
    const { g, pre, tpre, P, rep, where, tl } = s;
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, where }, extra));
    const D = s.qIn.num[1], hs = s.hSym || 'h';
    const qp = op('q-proj', A.linear(s.qIn, { dout: D, doutSym: 'D' }), 'q-proj', { out: tpre + 'qp', label: 'Proyección W_Q' + (s.qNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'Q proyectada', tex: s.qTex || 'QW_Q' }) });
    const kp = op('k-proj', A.linear(s.kIn, { dout: D, doutSym: 'D' }), 'k-proj', { out: tpre + 'kp', label: 'Proyección W_K' + (s.kNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'K proyectada', tex: s.kTex || 'KW_K' }) });
    const vp = op('v-proj', A.linear(s.vIn, { dout: D, doutSym: 'D' }), 'v-proj', { out: tpre + 'vp', label: 'Proyección W_V' + (s.vNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'V proyectada', tex: s.vTex || 'VW_V' }) });
    const [q, k, v] = op('split', A.split_qkv_heads(qp, kp, vp, { h: s.h, hSym: hs, dhSym: s.dhSym || 'd_h' }), 'split', {
      out: [tpre + 'q', tpre + 'k', tpre + 'v'], label: 'Separar en ' + s.h + ' cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'queries por cabeza', tex: 'Q' }), L({ label: 'keys por cabeza', tex: 'K' }), L({ label: 'values por cabeza', tex: 'V' })],
    });
    const sc = op('scores', A.attention_scores(q, k), 'scores', { out: tpre + 'scores', label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'scores sin escalar', tex: 'QK^\\top' }) });
    let ss = op('scale', A.scale(sc), 'scale', { out: tpre + 'scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    if (s.mask) {
      ss = op('mask', A.token_mask(ss, { kind: 'sub-oraciones' }), 'mask', {
        in: [ss.id, s.mask.id], out: tpre + 'masked', label: 'Máscara de sub-oraciones (0 / −∞)', type: 'attn', group: 'attn',
        outMeta: L({ label: 'scores con la máscara de sub-oraciones', tex: 'QK^\\top/\\sqrt{d_h} + M_{\\mathrm{sub}}' }),
      });
    }
    const a = op('softmax', A.softmax(ss), 'softmax', { out: tpre + 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), 'weighted-sum', { out: tpre + 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: 'D' }), 'merge', { out: tpre + 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'cabezas concatenadas', tex: 'Z' }) });
    return op('proj', A.linear(z, { dout: D, doutSym: 'D' }), 'proj', { out: tpre + 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'salida de la atención', tex: 'O = ZW_O' }) });
  }

  // Atención deformable multi-escala como ops (como js/arch/detr.js): value-proj, offsets, attn-weights, softmax,
  // sample, weighted-sum, proj. s = {g, pre, tpre, P, rep, where, tl, c, q, value, ref}
  function deformOps(s) {
    const { g, pre, tpre, P, rep, where, tl, c } = s;
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, where }, extra));
    const D = c.D, S = c.samples;
    const v = op('value-proj', A.linear(s.value, { dout: D, doutSym: 'D' }), 'value-proj', { out: tpre + 'value', label: 'Proyección del value (W_V, sobre los N tokens de imagen)', type: 'embed', group: 'attn', outMeta: L({ label: 'value proyectado (N tokens de los 4 niveles)', tex: 'xW_V' }) });
    const off = op('offsets', A.linear(s.q, { dout: 2 * S, doutSym: 'hLK·2' }), 'offsets', { out: tpre + 'offsets', label: 'Offsets de muestreo (Linear D → hLK·2)', type: 'attn', group: 'attn', outMeta: L({ label: 'offsets Δp por cabeza, nivel y punto', tex: '\\Delta p = qW_{\\Delta}' }) });
    const awl = op('attn-weights', A.linear(s.q, { dout: S, doutSym: 'hLK' }), 'attn-weights', { out: tpre + 'aw-logits', label: 'Pesos de atención (Linear D → hLK)', type: 'attn', group: 'attn', outMeta: L({ label: 'logits de los pesos de muestreo', tex: 'qW_A' }) });
    const aw = op('softmax', A.softmax(awl), 'softmax', { out: tpre + 'aw', label: 'Softmax sobre los L·K puntos de cada cabeza', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos de muestreo A', tex: 'A = \\mathrm{softmax}_{LK}(qW_A)' }) });
    const smp = op('sample', A.deform_sample(v, off, s.ref, { h: c.h, L: c.levels, K: c.points }), 'sample', { out: tpre + 'sampled', label: 'Muestreo bilineal del value en ref + Δp', type: 'attn', group: 'attn', outMeta: L({ label: 'values muestreados (hLK puntos por query)', tex: 'V(r + \\Delta p)' }) });
    const z = op('weighted-sum', A.deform_weighted_sum(smp, aw, { Dsym: 'D' }), 'weighted-sum', { out: tpre + 'z', label: 'Suma ponderada de las muestras (y concatenar cabezas)', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por query (cabezas concatenadas)', tex: '\\textstyle\\sum_{l,k} A\\,V(r+\\Delta p)' }) });
    return op('proj', A.linear(z, { dout: D, doutSym: 'D' }), 'proj', { out: tpre + 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'salida de la atención deformable', tex: 'O = ZW_O' }) });
  }

  // FFN post-LN: fc1 → ReLU → fc2.
  function ffnOps(s, x) {
    const { g, pre, tpre, P, rep, where, tl, Dmlp, DmlpSym } = s;
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, where }, extra));
    const u = op('fc1', A.linear(x, { dout: Dmlp, doutSym: DmlpSym }), 'fc1', { out: tpre + 'u', label: 'FFN: capa 1 (D → ' + Dmlp + ')', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta de la FFN', tex: 'U = xW_1 + b_1' }) });
    const gg = op('relu', A.relu(u), 'relu', { out: tpre + 'g', label: 'ReLU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación ReLU', tex: '\\mathrm{ReLU}(U)' }) });
    return op('fc2', A.linear(gg, { dout: x.num[1], doutSym: 'D' }), 'fc2', { out: tpre + 'f', label: 'FFN: capa 2 (' + Dmlp + ' → D)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida de la FFN', tex: 'F' }) });
  }

  // MLP de cajas (3 capas D → D → D → 4, ReLU) como ops. s = {g, pre, tpre, P, rep, where, tl, share}
  function boxMlpOps(s, x) {
    const { g, pre, tpre, P, rep, where, tl, D } = s;
    const L = (m) => Object.assign({}, m, { label: tl + m.label }, rep > 1 ? { perLayer: true } : {});
    const sh = (res) => (s.share ? shared(res, s.share) : res);
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, where }, extra));
    const h1 = op('fc1', sh(A.linear(x, { dout: D, doutSym: 'D' })), 'fc1', { out: tpre + 'h1', label: 'MLP de cajas: capa 1', type: 'head', group: 'head', outMeta: L({ label: 'capa 1', tex: 'u_1' }) });
    const a1 = op('relu1', A.relu(h1), 'relu1', { out: tpre + 'a1', label: 'ReLU', type: 'head', group: 'head', outMeta: L({ label: 'ReLU 1', tex: '\\mathrm{ReLU}(u_1)' }) });
    const h2 = op('fc2', sh(A.linear(a1, { dout: D, doutSym: 'D' })), 'fc2', { out: tpre + 'h2', label: 'MLP de cajas: capa 2', type: 'head', group: 'head', outMeta: L({ label: 'capa 2', tex: 'u_2' }) });
    const a2 = op('relu2', A.relu(h2), 'relu2', { out: tpre + 'a2', label: 'ReLU', type: 'head', group: 'head', outMeta: L({ label: 'ReLU 2', tex: '\\mathrm{ReLU}(u_2)' }) });
    return op('fc3', sh(A.linear(a2, { dout: 4, doutSym: '4' })), 'fc3', { out: s.outId || (tpre + 'raw'), label: 'MLP de cajas: capa 3 (D → 4)', type: 'head', group: 'head', outMeta: L({ label: s.outLabel || 'ajuste de la caja (antes de la sigmoide)', tex: '\\Delta b' }) });
  }

  // ------------------------------------------------------------------ backbone de imagen (Swin-T)
  function swinBackbone(g, img, c) {
    const s1 = c.stages[0];
    const pg = g.op('i-patch-embed', A.conv2d(img, { k: c.P, s: c.P, cout: c.C, coutSym: 'C', kSym: 'P', outSym: s1.sym, bias: true }), {
      path: ['img-backbone', 'patch-embed'], out: 'i-patch-grid', where: [WB], label: 'Patch embedding (conv ' + c.P + '×' + c.P + ', stride ' + c.P + ')', type: 'conv', group: 'embed',
      outMeta: { label: 'Backbone de imagen · rejilla de parches embebidos', tex: 'X_{\\mathrm{grid}}' },
    });
    let x = g.op('i-patch-norm', A.layernorm(pg), {
      path: ['img-backbone', 'patch-embed'], out: 'i-s1-in', where: [WB], label: 'LayerNorm del patch embedding', type: 'norm', group: 'norm',
      outMeta: { label: 'Backbone de imagen · entrada del stage 1', tex: 'z_0' },
    });
    const feats = {};
    for (const st of c.stages) {
      if (st.k > 1) x = patchMerging(g, x, c.stages[st.k - 2], st);
      x = swinBlock(g, x, st, 1, c);
      x = swinBlock(g, x, st, 2, c);
      if (st.k >= 2) {
        const cid = 'i-c' + (st.k + 1);
        feats[cid] = g.op('i-s' + st.k + '-norm', A.layernorm(x), {
          path: ['img-backbone', 'out-norm'], out: cid, where: [WB, 'Stage ' + st.k], label: 'LayerNorm de la salida del stage ' + st.k, type: 'norm', group: 'norm',
          outMeta: { label: 'Backbone de imagen · C' + (st.k + 1) + ' (salida normalizada del stage ' + st.k + ', stride ' + st.stride + ')', tex: 'C_' + (st.k + 1) },
        });
      }
    }
    return feats;
  }

  function swinBlock(g, x, st, j, c) {
    const k = st.k, pre = 'i-s' + k + '-b' + j + '-';
    const kind = j === 1 ? 'W-MSA' : 'SW-MSA';
    const where = [WB, 'Stage ' + k, 'bloque ' + j + ' (' + kind + ')'];
    const tl = 'Backbone de imagen · Stage ' + k + ' · bloque ' + j + ' (' + kind + ') · ';
    const P = ['img-backbone', 'stage' + k, 'block' + j];
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, extra) => g.op(pre + id, res, Object.assign({ path: P, repeat: st.pairs, where }, extra));
    const ln1 = op('ln1', A.layernorm(x), { out: pre + 'ln1', label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada', tex: '\\mathrm{LN}_1(z)' }) });
    const at = op('attn', A.window_attention(ln1, { M: c.M, h: st.h, shift: j === 2 ? st.shift : 0 }), {
      out: pre + 'attn', label: (j === 1 ? 'W-MSA' : 'SW-MSA (desplazamiento ' + st.shift + ')') + ': atención en ventanas ' + c.M + '×' + c.M + ', ' + st.h + ' cabezas', type: 'attn', group: 'attn',
      outMeta: L({ label: 'salida de la atención por ventanas', tex: '\\mathrm{' + (j === 1 ? 'W' : 'SW') + '\\text{-}MSA}(\\cdot)' }),
    });
    const r1 = op('res1', A.residual_add(x, at), { out: pre + 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'z + atención', tex: "z'" }) });
    const ln2 = op('ln2', A.layernorm(r1), { out: pre + 'ln2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada del MLP', tex: "\\mathrm{LN}_2(z')" }) });
    const cs = st.Csym === 'C' ? '4C' : (4 * parseInt(st.Csym, 10)) + 'C';
    const u = op('fc1', A.linear(ln2, { dout: c.mlpRatio * st.C, doutSym: cs }), { out: pre + 'u', label: 'MLP: capa 1 (×4)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta del MLP', tex: 'U' }) });
    const gg = op('gelu', A.gelu(u), { out: pre + 'g', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación GELU', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', A.linear(gg, { dout: st.C, doutSym: st.Csym }), { out: pre + 'f', label: 'MLP: capa 2', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida del MLP', tex: 'F' }) });
    return op('res2', A.residual_add(r1, f), {
      out: j === 1 ? pre + 'out' : 'i-s' + k + '-out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: j === 1 ? L({ label: 'salida del bloque', tex: 'z_\\ell' })
        : { label: 'Backbone de imagen · salida del stage ' + k + ' (stride ' + st.stride + ')', tex: 'z_{' + k + '}', perLayer: false, note: 'Salida de cada par de bloques; tras el último par es la salida del stage.' },
    });
  }

  function patchMerging(g, x, prev, st) {
    const m = prev.k;
    return g.op('i-m' + m, sym(A.patch_merging(x), [st.sym[0], st.sym[1], st.Csym]), {
      path: ['img-backbone', 'merge' + m], out: 'i-m' + m + '-out', where: [WB, 'Patch merging ' + m + ' (stage ' + m + ' → ' + (m + 1) + ')'],
      label: 'Patch merging (concat 2×2 → LayerNorm(4C) → Linear 4C → 2C)', type: 'embed', group: 'embed',
      outMeta: { label: 'Backbone de imagen · entrada del stage ' + st.k + ' (tras el patch merging ' + m + ')', tex: 'z' },
    });
  }

  // ------------------------------------------------------------------ proyección de imagen (4 niveles)
  function imageProjection(g, feats, c) {
    const ins = [feats['i-c3'], feats['i-c4'], feats['i-c5']];
    const strides = [8, 16, 32, 64];
    const ceilSym = (d, n) => (n % 64 === 0 ? d + '/64' : '⌈' + d + '/64⌉');
    const syms = [['H/8', 'W/8'], ['H/16', 'W/16'], ['H/32', 'W/32'], [ceilSym('H', c.H), ceilSym('W', c.W)]];
    const src = [];
    for (let i = 0; i < c.levels; i++) {
      const l = i + 1, extra = i === 3, inp = extra ? feats['i-c5'] : ins[i];
      const P = ['img-proj', 'proj-l' + l], W = ['Proyección de imagen', 'nivel ' + l + ' (stride ' + strides[i] + ')'];
      const cv = g.op('i-proj-l' + l, A.conv2d(inp, extra
        ? { k: 3, s: 2, p: 1, cout: c.D, coutSym: 'D', outSym: syms[i], bias: true, floor: true }
        : { k: 1, cout: c.D, coutSym: 'D', outSym: syms[i], bias: true }), {
        path: P, out: 'i-src-l' + l + '-conv', where: W,
        label: extra ? 'Nivel 4: conv 3×3 stride 2 sobre C5 (8C → D)' : 'Nivel ' + l + ': conv 1×1 sobre C' + (l + 2) + ' (' + inp.sym[2] + ' → D)', type: 'conv', group: 'embed',
        outMeta: { label: 'Proyección de imagen · nivel ' + l + ', mapa proyectado (stride ' + strides[i] + ')', tex: 'W * C_' + (extra ? 5 : l + 2) },
      });
      src.push(g.op('i-gn-l' + l, A.group_norm(cv, { groups: c.gnGroups }), {
        path: P, out: 'i-src-l' + l, where: W, label: 'GroupNorm (32 grupos)', type: 'norm', group: 'norm',
        outMeta: { label: 'Proyección de imagen · nivel ' + l + ', mapa normalizado (stride ' + strides[i] + ')', tex: 'f_' + l },
      }));
    }
    const mem0 = g.op('i-flatten', A.flatten_levels(src, { sym: ['N', 'D'] }), {
      path: ['img-proj', 'flatten'], out: 'i-mem-in', label: 'Aplanar y concatenar los 4 niveles', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Tokens de imagen multi-escala (entrada del feature enhancer)', tex: 'x_0' },
    });
    const ps = g.op('i-pos-enc', A.sine_pos_encoding({ levels: c.levelShapes, D: c.D, rowsSym: 'N', temperature: c.posTemperature }), {
      path: ['img-proj', 'pos-enc', 'sine'], out: 'i-pos-sine', label: 'Posición 2-D seno/coseno de cada nivel (temperatura 20, buffer)', type: 'embed', group: 'embed',
      outMeta: { label: 'Proyección de imagen · codificación posicional 2-D (niveles concatenados)', tex: 'p_{\\mathrm{sin}}' },
    });
    const lt = g.op('i-level-embed', A.level_embed({ L: c.levels, D: c.D }), {
      path: ['img-proj', 'pos-enc', 'level-embed'], out: 'i-level-table', label: 'Embedding de nivel (aprendido, L×D)', type: 'embed', group: 'embed',
      outMeta: { label: 'Proyección de imagen · tabla de embeddings de nivel', tex: 'e_{\\mathrm{lvl}}' },
    });
    const pos = g.op('i-add-level', A.add_level_embed(ps, lt, { levels: c.levelTokens }), {
      path: ['img-proj', 'pos-enc', 'add-level'], out: 'i-pos', label: 'Sumar a cada token el vector de su nivel', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Proyección de imagen · posición + nivel de cada token', tex: 'p = p_{\\mathrm{sin}} + e_{\\mathrm{lvl}}' },
    });
    return { mem0, pos };
  }

  // ------------------------------------------------------------------ texto (BERT-base)
  function textBackbone(g, c) {
    const TI = 'Texto · ', TB = 'Texto (BERT) · ', WT = ['Texto (BERT-base)'];
    const ids = g.input('t-ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Ids de tokens del prompt (WordPiece, con [CLS] y [SEP])', tex: 't' });
    const types = g.input('t-type-ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Texto · token type ids (todos 0)', tex: 's' });
    const [mask, posIds] = g.op('t-submask', A.subsentence_mask(ids), {
      path: ['txt-input', 'mask'], out: ['t-mask', 't-pos-ids'], where: ['Entrada de texto'], label: 'Máscara de sub-oraciones y position ids (desde los tokens especiales)', type: 'tensorop', group: 'embed',
      outMeta: [{ label: TI + 'máscara de sub-oraciones (cada categoría se atiende a sí misma)', tex: 'M_{\\mathrm{sub}}' }, { label: TI + 'position ids reiniciados en cada frase', tex: '\\mathrm{pos}' }],
    });
    const E = ['txt-backbone', 'embeddings'];
    const tok = g.op('t-tok-embed', A.embedding_lookup(ids, { V: c.V, D: c.Dtxt, Dsym: '768' }), {
      path: E.concat(['tok']), out: 't-tok', where: WT, label: 'Word embeddings (V × 768)', type: 'embed', group: 'embed',
      outMeta: { label: TB + 'embeddings de tokens', tex: 'E_{\\mathrm{tok}}[t]' },
    });
    const pe = g.op('t-pos-embed', A.embedding_lookup(posIds, { V: c.posMax, Vsym: '512', D: c.Dtxt, Dsym: '768' }), {
      path: E.concat(['pos']), out: 't-e-pos', where: WT, label: 'Position embeddings aprendidos (512 × 768, indexados por los position ids)', type: 'embed', group: 'embed',
      outMeta: { label: TB + 'embeddings de posición', tex: 'E_{\\mathrm{pos}}[\\mathrm{pos}]' },
    });
    const te = g.op('t-type-embed', A.embedding_lookup(types, { V: c.typeVocab, Vsym: '2', D: c.Dtxt, Dsym: '768' }), {
      path: E.concat(['type']), out: 't-e-type', where: WT, label: 'Token type embeddings (2 × 768)', type: 'embed', group: 'embed',
      outMeta: { label: TB + 'embeddings de tipo de token', tex: 'E_{\\mathrm{type}}[s]' },
    });
    const x1 = g.op('t-add-pos', A.add(tok, pe), { path: E.concat(['add']), out: 't-x-pos', where: WT, label: 'Suma de posición', type: 'tensorop', group: 'embed', outMeta: { label: TB + 'tokens + posición', tex: 'E_{\\mathrm{tok}} + E_{\\mathrm{pos}}' } });
    const x2 = g.op('t-add-type', A.add(x1, te), { path: E.concat(['add']), out: 't-x-sum', where: WT, label: 'Suma del tipo de token', type: 'tensorop', group: 'embed', outMeta: { label: TB + 'suma de los tres embeddings', tex: 'E_{\\mathrm{tok}} + E_{\\mathrm{pos}} + E_{\\mathrm{type}}' } });
    const x0 = g.op('t-emb-ln', A.layernorm(x2), { path: E.concat(['ln']), out: 't-x0', where: WT, label: 'LayerNorm de los embeddings', type: 'norm', group: 'norm', outMeta: { label: TB + 'entrada de la capa 1', tex: 'x_0' } });
    // Capa BERT (post-LN). MHSA y FFN compuestas (12 cabezas; el detalle por cabeza no se dibuja).
    const P = ['txt-backbone', 'bert-layer'], rep = c.Lt, W2 = WT.concat(['capa']);
    const L = (m) => Object.assign({ perLayer: true }, m, { label: TB + m.label });
    const op = (id, res, node, extra) => g.op(id, res, Object.assign({ path: P.concat([node]), repeat: rep, where: W2 }, extra));
    const at = A.mhsa(x0, { h: c.ht, Dsym: '768' });
    at.other += c.ht * c.T * c.T;   // máscara de sub-oraciones sumada a los scores (h×T×T)
    at.detail = Object.assign({}, at.detail, { mask: 'sub-oraciones (t-mask)' });
    const a = op('t-attn', at, 'attn', { in: ['t-x0', 't-mask'], out: 't-attn', paramTex: '4\\cdot 768^2 + 4\\cdot 768', macTex: '4\\,T\\cdot 768^2 + 2\\,T^2\\cdot 768', label: 'Self-attention de BERT (12 cabezas, con la máscara de sub-oraciones)', type: 'attn', group: 'attn', outMeta: L({ label: 'salida de la self-attention', tex: '\\mathrm{MHSA}(x)' }) });
    const r1 = op('t-res1', A.residual_add(x0, a), 'res1', { out: 't-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: 'x + \\mathrm{MHSA}(x)' }) });
    const n1 = op('t-ln1', A.layernorm(r1), 'ln1', { out: 't-ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "x'" }) });
    const f = op('t-ffn', A.mlp(n1, { Dmlp: c.Dmlpt, DmlpSym: '3072' }), 'ffn', { out: 't-ffn', paramTex: '2\\cdot 768\\cdot 3072 + 3072 + 768', macTex: '2\\,T\\cdot 768\\cdot 3072', label: 'FFN de BERT (768 → 3072 → 768, GELU)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida de la FFN', tex: 'F' }) });
    const r2 = op('t-res2', A.residual_add(n1, f), 'res2', { out: 't-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "x' + FFN", tex: "x' + F" }) });
    const out = op('t-ln2', A.layernorm(r2), 'ln2', {
      out: 't-bert-out', label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: TB + 'salida (tras la capa 12)', tex: 'h_{\\mathrm{txt}}', perLayer: false, note: 'Salida de cada capa de BERT; tras la capa 12 es la salida del codificador de texto.' },
    });
    const feat = g.op('txt-proj', A.linear(out, { dout: c.D, doutSym: 'D' }), {
      path: ['txt-proj'], out: 't-feat', label: 'Proyección de texto (Linear 768 → D)', type: 'embed', group: 'embed',
      outMeta: { label: 'Tokens de texto proyectados a D (entrada del feature enhancer)', tex: 'h_{\\mathrm{txt}}W_t' },
    });
    return { feat, mask, posIds };
  }

  // ------------------------------------------------------------------ feature enhancer (capa)
  function enhancerLayer(g, img, txt, pos, tpos, ref, mask, c) {
    const P = ['enhancer', 'enh-layer'], rep = c.Lenc, E = c.Efusion, hf = c.hFusion;
    const FE = 'Feature enhancer · ';
    const W = (x) => ['Feature enhancer'].concat(x ? [x] : []);
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path: P.concat(path), repeat: rep }, extra));
    const L = (m, pre) => Object.assign({ perLayer: true }, m, { label: (pre || FE) + m.label });
    // ---- fusión (pre-LN): imagen ↔ texto con una sola matriz de scores
    const WF = W('fusión imagen ↔ texto'), tf = FE + 'fusión · ';
    const iN = op('e-fus-ln-img', A.layernorm(img), ['fus-ln-img'], { out: 'i-enh-fus-ln', where: WF, label: 'LayerNorm de la imagen (antes de la fusión)', type: 'norm', group: 'norm', outMeta: L({ label: 'imagen normalizada', tex: '\\mathrm{LN}(v)' }, tf) });
    const tN = op('e-fus-ln-txt', A.layernorm(txt), ['fus-ln-txt'], { out: 't-enh-fus-ln', where: WF, label: 'LayerNorm del texto (antes de la fusión)', type: 'norm', group: 'norm', outMeta: L({ label: 'texto normalizado', tex: '\\mathrm{LN}(t)' }, tf) });
    // Flechas = sentido de la información, como el diagrama: i2t actualiza la imagen con el texto (imagen ← texto).
    const i2 = ['i2t'], WI = W('fusión: imagen ← texto'), ti = FE + 'imagen ← texto · ';
    const Es = 'D_mlp/2';
    const q = op('e-i2t-q-proj', A.linear(iN, { dout: E, doutSym: Es }), i2.concat(['q-proj']), { out: 'i-enh-i2t-q', where: WI, label: 'Q desde la imagen (Linear D → D_mlp/2)', type: 'embed', group: 'attn', outMeta: L({ label: 'Q de la imagen', tex: 'vW_Q' }, ti) });
    const k = op('e-i2t-k-proj', A.linear(tN, { dout: E, doutSym: Es }), i2.concat(['k-proj']), { out: 't-enh-i2t-k', where: WI, label: 'K desde el texto (Linear D → D_mlp/2)', type: 'embed', group: 'attn', outMeta: L({ label: 'K del texto', tex: 'tW_K' }, ti) });
    const v = op('e-i2t-v-proj', A.linear(tN, { dout: E, doutSym: Es }), i2.concat(['v-proj']), { out: 't-enh-i2t-v', where: WI, label: 'V desde el texto (Linear D → D_mlp/2)', type: 'embed', group: 'attn', outMeta: L({ label: 'V del texto', tex: 'tW_V^{t}' }, ti) });
    const sp = A.split_qkv_heads(q, k, v, { h: hf, hSym: 'h/2', dhSym: String(E / hf) });
    const [qh, kh, vh] = op('e-i2t-split', sp, i2.concat(['split']), {
      out: ['i-enh-i2t-qh', 't-enh-i2t-kh', 't-enh-i2t-vh'], where: WI, label: 'Separar en h/2 = ' + hf + ' cabezas de ' + (E / hf), type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Q de la imagen por cabeza', tex: 'Q' }, ti), L({ label: 'K del texto por cabeza', tex: 'K' }, ti), L({ label: 'V del texto por cabeza', tex: 'V^{t}' }, ti)],
    });
    const sc = op('e-i2t-scores', A.attention_scores(qh, kh), i2.concat(['scores']), { out: 'i-enh-fus-scores', where: WI, label: 'Scores imagen × texto (QKᵀ, la única matriz de la fusión)', type: 'attn', group: 'attn', outMeta: L({ label: 'scores imagen × texto', tex: 'QK^\\top' }, tf) });
    const ss = op('e-i2t-scale', A.scale(sc), i2.concat(['scale']), { out: 'i-enh-fus-scaled', where: WI, label: 'Escala 1/√d (d = ' + (E / hf) + ')', type: 'attn', group: 'attn', outMeta: L({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d}' }, tf) });
    const ai = op('e-i2t-softmax', A.softmax(ss), i2.concat(['softmax']), { out: 'i-enh-i2t-attn', where: WI, label: 'Softmax sobre los T tokens de texto', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos (cada token de imagen reparte 1 entre los T de texto)', tex: 'A = \\mathrm{softmax}_T' }, ti) });
    const zi = op('e-i2t-weighted-sum', A.attention_weighted_sum(ai, vh), i2.concat(['weighted-sum']), { out: 'i-enh-i2t-z-heads', where: WI, label: 'Suma ponderada A·V del texto', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por cabeza', tex: 'AV^{t}' }, ti) });
    const mi = op('e-i2t-merge', sym(A.merge_heads(zi, { Dsym: Es }), ['N', Es]), i2.concat(['merge']), { out: 'i-enh-i2t-z', where: WI, label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'cabezas concatenadas', tex: 'Z' }, ti) });
    const oi = op('e-i2t-out-proj', A.linear(mi, { dout: c.D, doutSym: 'D' }), i2.concat(['out-proj']), { out: 'i-enh-i2t-o', where: WI, label: 'Proyección de salida (D_mlp/2 → D)', type: 'embed', group: 'attn', outMeta: L({ label: 'Δ de la imagen', tex: '\\Delta v' }, ti) });
    const gi = op('e-i2t-gamma', A.layer_scale(oi), i2.concat(['gamma']), { out: 'i-enh-i2t-g', where: WI, label: 'Layer scale γ_v (init 1e-4)', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Δ escalado por γ_v', tex: '\\gamma_v\\,\\Delta v' }, ti) });
    const t2 = ['t2i'], WT = W('fusión: texto ← imagen'), tt = FE + 'texto ← imagen · ';
    const vi = op('e-t2i-v-proj', A.linear(iN, { dout: E, doutSym: Es }), t2.concat(['v-proj']), { out: 'i-enh-t2i-v', where: WT, label: 'V desde la imagen (Linear D → D_mlp/2)', type: 'embed', group: 'attn', outMeta: L({ label: 'V de la imagen', tex: 'vW_V^{v}' }, tt) });
    const vih = op('e-t2i-split', A.split_heads(vi, { h: hf, hSym: 'h/2', dhSym: String(E / hf) }), t2.concat(['split']), { out: 'i-enh-t2i-vh', where: WT, label: 'Separar en h/2 = ' + hf + ' cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'V de la imagen por cabeza', tex: 'V^{v}' }, tt) });
    const tr = op('e-t2i-transpose', A.transpose_scores(ss), t2.concat(['transpose']), { out: 't-enh-t2i-scores', where: WT, label: 'Los mismos scores, transpuestos (texto × imagen)', type: 'tensorop', group: 'attn', outMeta: L({ label: 'scores texto × imagen (transpuestos)', tex: '(QK^\\top)^\\top' }, tt) });
    const at = op('e-t2i-softmax', A.softmax(tr), t2.concat(['softmax']), { out: 't-enh-t2i-attn', where: WT, label: 'Softmax sobre los N tokens de imagen', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos (cada token de texto reparte 1 entre los N de imagen)', tex: 'A^\\top = \\mathrm{softmax}_N' }, tt) });
    const zt = op('e-t2i-weighted-sum', A.attention_weighted_sum(at, vih), t2.concat(['weighted-sum']), { out: 't-enh-t2i-z-heads', where: WT, label: 'Suma ponderada A·V de la imagen', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por cabeza', tex: 'A^\\top V^{v}' }, tt) });
    const mt = op('e-t2i-merge', sym(A.merge_heads(zt, { Dsym: Es }), ['T', Es]), t2.concat(['merge']), { out: 't-enh-t2i-z', where: WT, label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'cabezas concatenadas', tex: 'Z^{t}' }, tt) });
    const ot = op('e-t2i-out-proj', A.linear(mt, { dout: c.D, doutSym: 'D' }), t2.concat(['out-proj']), { out: 't-enh-t2i-o', where: WT, label: 'Proyección de salida (D_mlp/2 → D)', type: 'embed', group: 'attn', outMeta: L({ label: 'Δ del texto', tex: '\\Delta t' }, tt) });
    const gt = op('e-t2i-gamma', A.layer_scale(ot), t2.concat(['gamma']), { out: 't-enh-t2i-g', where: WT, label: 'Layer scale γ_t (init 1e-4)', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Δ escalado por γ_t', tex: '\\gamma_t\\,\\Delta t' }, tt) });
    const iF = op('e-fus-res-img', A.residual_add(iN, gi), ['fus-res-img'], { out: 'i-enh-fused', where: WF, label: 'Residual de la imagen (sobre la imagen normalizada)', type: 'tensorop', group: 'resid', outMeta: L({ label: 'imagen fusionada', tex: '\\mathrm{LN}(v) + \\gamma_v\\Delta v' }, tf) });
    const tF = op('e-fus-res-txt', A.residual_add(tN, gt), ['fus-res-txt'], { out: 't-enh-fused', where: WF, label: 'Residual del texto (sobre el texto normalizado)', type: 'tensorop', group: 'resid', outMeta: L({ label: 'texto fusionado', tex: '\\mathrm{LN}(t) + \\gamma_t\\Delta t' }, tf) });
    // ---- texto: self-attention (h/2 cabezas, máscara de sub-oraciones) + FFN (D_mlp/2), post-LN
    const WS = W('texto: self-attention'), ts = FE + 'texto · self-attention · ';
    const tq = op('e-txt-add-pos', A.add(tF, tpos), ['txt-self', 'add-pos'], { out: 't-enh-qk-in', where: WS, label: 'Suma de posición (seno/coseno, solo para Q y K)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'entrada de Q y K (texto + posición)', tex: 't + p_t' }, ts) });
    const to = mhaOps({ g, pre: 'e-txt-', tpre: 't-enh-self-', P: P.concat(['txt-self']), rep, where: WS, tl: ts, h: hf, hSym: 'h/2', dhSym: String(c.D / hf),
      qIn: tq, kIn: tq, vIn: tF, mask, qNote: ' (texto + posición)', kNote: ' (texto + posición)', vNote: ' (texto, sin posición)' });
    const WTL = W('texto'), tl = FE + 'texto · ';
    const tr1 = op('e-txt-res1', A.residual_add(tF, to), ['txt-res1'], { out: 't-enh-r1', where: WTL, label: 'Residual (texto)', type: 'tensorop', group: 'resid', outMeta: L({ label: 'texto + self-attention', tex: 't + O' }, tl) });
    const tn1 = op('e-txt-ln1', A.layernorm(tr1), ['txt-ln1'], { out: 't-enh-ln1', where: WTL, label: 'LayerNorm (texto, post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras la LayerNorm de la atención', tex: "t'" }, tl) });
    const tf2 = ffnOps({ g, pre: 'e-txt-', tpre: 't-enh-', P: P.concat(['txt-ffn']), rep, where: W('texto: FFN'), tl: FE + 'texto · FFN · ', Dmlp: c.DmlpText, DmlpSym: 'D_mlp/2' }, tn1);
    const tr2 = op('e-txt-res2', A.residual_add(tn1, tf2), ['txt-res2'], { out: 't-enh-r2', where: WTL, label: 'Residual (texto, FFN)', type: 'tensorop', group: 'resid', outMeta: L({ label: "t' + FFN", tex: "t' + F" }, tl) });
    const tOut = op('e-txt-ln2', A.layernorm(tr2), ['txt-ln2'], {
      out: 't-memory', where: WTL, label: 'LayerNorm (texto, post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Memoria de texto (salida del feature enhancer, capa 6)', tex: 't_{\\mathrm{enh}}', perLayer: false, note: 'Salida de texto de cada capa; tras la capa 6 la leen la query selection, el decoder y la cabeza contrastiva.' },
    });
    // ---- imagen: atención deformable multi-escala + FFN, post-LN
    const WD = W('imagen: atención deformable'), tdf = FE + 'imagen · atención deformable · ';
    const iq = op('e-img-add-pos', A.add(iF, pos), ['img-self', 'add-pos'], { out: 'i-enh-q-in', where: WD, label: 'Suma de posición + nivel (para la query)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'query (imagen + posición)', tex: 'v + p' }, tdf) });
    const io = deformOps({ g, pre: 'e-img-', tpre: 'i-enh-', P: P.concat(['img-self']), rep, where: WD, tl: tdf, c, q: iq, value: iF, ref });
    const WIL = W('imagen'), il = FE + 'imagen · ';
    const ir1 = op('e-img-res1', A.residual_add(iF, io), ['img-res1'], { out: 'i-enh-r1', where: WIL, label: 'Residual (imagen)', type: 'tensorop', group: 'resid', outMeta: L({ label: 'imagen + atención deformable', tex: 'v + O' }, il) });
    const in1 = op('e-img-ln1', A.layernorm(ir1), ['img-ln1'], { out: 'i-enh-ln1', where: WIL, label: 'LayerNorm (imagen, post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras la LayerNorm de la atención', tex: "v'" }, il) });
    const if2 = ffnOps({ g, pre: 'e-img-', tpre: 'i-enh-', P: P.concat(['img-ffn']), rep, where: W('imagen: FFN'), tl: FE + 'imagen · FFN · ', Dmlp: c.Dmlp, DmlpSym: 'D_mlp' }, in1);
    const ir2 = op('e-img-res2', A.residual_add(in1, if2), ['img-res2'], { out: 'i-enh-r2', where: WIL, label: 'Residual (imagen, FFN)', type: 'tensorop', group: 'resid', outMeta: L({ label: "v' + FFN", tex: "v' + F" }, il) });
    const iOut = op('e-img-ln2', A.layernorm(ir2), ['img-ln2'], {
      out: 'i-memory', where: WIL, label: 'LayerNorm (imagen, post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Memoria de imagen (salida del feature enhancer, capa 6)', tex: 'v_{\\mathrm{enh}}', perLayer: false, note: 'Salida de imagen de cada capa; tras la capa 6 es la memoria de la query selection y de la cross-attention deformable.' },
    });
    return { img: iOut, txt: tOut };
  }

  // ------------------------------------------------------------------ query selection guiada por lenguaje
  function querySelection(g, mem, tmem, c) {
    const QS = 'Query selection · ', W = ['Query selection'];
    const prop = g.op('qs-proposals', A.encoder_proposals({ levels: c.levelShapes, rowsSym: 'N' }), {
      path: ['query-select', 'proposals'], out: 'q-proposals', where: W, label: 'Cajas ancla por token (centro del token, lado 0.05·2^l)', type: 'tensorop', group: 'head',
      outMeta: { label: QS + 'cajas ancla de cada token (en logit)', tex: 'a' },
    });
    const pj = g.op('qs-proj', A.linear(mem, { dout: c.D, doutSym: 'D' }), {
      path: ['query-select', 'enc-output'], out: 'q-cand-proj', where: W, label: 'Linear D → D sobre los N tokens', type: 'embed', group: 'head',
      outMeta: { label: QS + 'tokens de imagen proyectados', tex: 'vW_o' },
    });
    const cand = g.op('qs-norm', A.layernorm(pj), {
      path: ['query-select', 'enc-output'], out: 'q-cand', where: W, label: 'LayerNorm', type: 'norm', group: 'norm',
      outMeta: { label: QS + 'candidatos (cada token de imagen es una query posible)', tex: '\\tilde v' },
    });
    const lg = g.op('qs-logits', A.contrastive_logits(cand, tmem, { pad: c.maxText }), {
      path: ['query-select', 'enc-logits'], out: 'q-enc-logits', where: W, label: 'Similitud de cada token de imagen con cada token de texto', type: 'fuse', group: 'head',
      outMeta: { label: QS + 'logits token de imagen × token de texto', tex: '\\tilde v\\,t^\\top' },
    });
    const delta = boxMlpOps({ g, pre: 'qs-box-', tpre: 'q-enc-box-', P: ['query-select', 'enc-box'], rep: 1, where: W, tl: QS + 'MLP de cajas · ', D: c.D, outId: 'q-enc-delta', outLabel: 'ajuste de la caja de cada token' }, cand);
    const eb = g.op('qs-box-add', A.add(delta, prop), {
      path: ['query-select', 'enc-box', 'add'], out: 'q-enc-boxes', where: W, label: 'Ancla + ajuste (en logit)', type: 'head', group: 'head',
      outMeta: { label: QS + 'caja propuesta por cada token (en logit)', tex: 'a + \\Delta b' },
    });
    const tk = g.op('qs-topk', A.topk_select(lg, { k: c.Q, kSym: 'Q' }), {
      path: ['query-select', 'topk'], out: 'q-topk', where: W, label: 'Top-' + c.Q + ' tokens por su máxima similitud con el texto', type: 'head', group: 'head',
      outMeta: { label: QS + 'índices de los Q tokens elegidos', tex: '\\mathrm{topk}_Q\\,\\max_T' },
    });
    const rl = g.op('qs-gather', A.gather_rows(eb, tk), {
      path: ['query-select', 'gather'], out: 'q-ref0-logit', where: W, label: 'Tomar las cajas de los Q tokens elegidos', type: 'tensorop', group: 'head',
      outMeta: { label: QS + 'cajas elegidas (en logit)', tex: 'b_0^{\\mathrm{logit}}' },
    });
    const ref0 = g.op('qs-ref-sigmoid', A.sigmoid(rl), {
      path: ['query-select', 'gather'], out: 'q-ref0', where: W, label: 'Sigmoide: caja de referencia inicial (sin gradiente)', type: 'head', group: 'head',
      outMeta: { label: 'Decoder · cajas de referencia iniciales (parte POSICIONAL de las queries)', tex: 'b_0' },
    });
    const tgt = g.op('query-embed', A.learned_queries({ Q: c.Q, D: c.D }), {
      path: ['query-select', 'content'], out: 'q-tgt0', where: W, label: 'Queries de contenido aprendidas (Q×D)', type: 'embed', group: 'embed',
      outMeta: { label: 'Decoder · queries de contenido (aprendidas, entrada de la capa 1)', tex: 't_0' },
    });
    return { ref0, tgt };
  }

  // ------------------------------------------------------------------ decoder
  function decoder(g, tgt, ref0, imem, tmem, c) {
    const DE = 'Decoder · ';
    // query_pos = MLP(PE(caja)): un solo módulo para las 6 capas (pesos compartidos, MACs × L_dec).
    const RH = ['decoder', 'ref-head'], WR = ['Decoder', 'query_pos desde la caja'], tr = DE + 'query_pos · ';
    const pe = g.op('d-ref-pe', calls(A.box_sine_embed(ref0, { D: c.D, outSym: '2D' }), c.Ldec, 'se calcula en cada capa del decoder'), {
      path: RH.concat(['pe']), out: 'q-ref-pe', where: WR, label: 'PE seno/coseno de la caja de referencia (4 × D/2), en cada capa', type: 'embed', group: 'embed',
      outMeta: { label: tr + 'PE de la caja (cx, cy, w, h)', tex: '\\mathrm{PE}(b)' },
    });
    const rh = g.op('d-ref-fc1', calls(A.linear(pe, { dout: c.D, doutSym: 'D' }), c.Ldec, 'un MLP para las 6 capas'), {
      path: RH.concat(['fc1']), out: 'q-ref-h', where: WR, label: 'MLP de query_pos: capa 1 (2D → D; en cada capa, pesos compartidos)', type: 'embed', group: 'embed',
      outMeta: { label: tr + 'capa oculta', tex: 'u' },
    });
    const ra = g.op('d-ref-relu', calls(A.relu(rh), c.Ldec, ''), {
      path: RH.concat(['relu']), out: 'q-ref-a', where: WR, label: 'ReLU', type: 'embed', group: 'embed', outMeta: { label: tr + 'ReLU', tex: '\\mathrm{ReLU}(u)' },
    });
    const qpos = g.op('d-ref-fc2', calls(A.linear(ra, { dout: c.D, doutSym: 'D' }), c.Ldec, 'un MLP para las 6 capas'), {
      path: RH.concat(['fc2']), out: 'q-pos', where: WR, label: 'MLP de query_pos: capa 2 (D → D; en cada capa, pesos compartidos)', type: 'embed', group: 'embed',
      outMeta: { label: DE + 'query_pos (parte posicional, desde la caja de referencia)', tex: 'q_{\\mathrm{pos}}' },
    });
    // ---- capa (post-LN)
    const P = ['decoder', 'dec-layer'], rep = c.Ldec;
    const L = (m, pre) => Object.assign({ perLayer: true }, m, { label: (pre || DE) + m.label });
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path: P.concat(path), repeat: rep, where: ['Decoder'] }, extra));
    const qk = op('d-add-qpos', A.add(tgt, qpos), ['add-qpos'], { out: 'q-qk-in', label: 'Suma de query_pos (para Q y K de la self-attention)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'self-attention · entrada de Q y K (contenido + query_pos)', tex: 't + q_{\\mathrm{pos}}' }) });
    const so = mhaOps({ g, pre: 'd-self-', tpre: 'q-self-', P: P.concat(['self-attn']), rep, where: ['Decoder', 'self-attention'], tl: DE + 'self-attention · ', h: c.h,
      qIn: qk, kIn: qk, vIn: tgt, qNote: ' (contenido + query_pos)', kNote: ' (contenido + query_pos)', vNote: ' (contenido)' });
    const r1 = op('d-res1', A.residual_add(tgt, so), ['res1'], { out: 'q-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'contenido + self-attention', tex: 't + O_{\\mathrm{self}}' }) });
    const n1 = op('d-ln1', A.layernorm(r1), ['ln1'], { out: 'q-ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "t'" }) });
    const WX = ['Decoder', 'cross-attention de texto'], tx = DE + 'cross-attention de texto · ';
    const xq = op('d-txt-add-qpos', A.add(n1, qpos), ['txt-cross', 'add-qpos'], { out: 'q-txt-q-in', where: WX, label: 'Suma de query_pos (para Q)', type: 'tensorop', group: 'embed', outMeta: L({ label: "entrada de Q (t' + query_pos)", tex: "t' + q_{\\mathrm{pos}}" }, tx) });
    const xo = mhaOps({ g, pre: 'd-txt-', tpre: 'q-txt-', P: P.concat(['txt-cross']), rep, where: WX, tl: tx, h: c.h,
      qIn: xq, kIn: tmem, vIn: tmem, qNote: ' (desde las queries)', kNote: ' (desde la memoria de texto)', vNote: ' (desde la memoria de texto)' });
    const r2 = op('d-res2', A.residual_add(n1, xo), ['res2'], { out: 'q-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "t' + cross-attention de texto", tex: "t' + O_{\\mathrm{txt}}" }) });
    const n2 = op('d-ln2', A.layernorm(r2), ['ln2'], { out: 'q-ln2', label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 2', tex: "t''" }) });
    const WI = ['Decoder', 'cross-attention deformable de imagen'], ti = DE + 'cross-attention de imagen · ';
    const iq = op('d-img-add-qpos', A.add(n2, qpos), ['img-cross', 'add-qpos'], { out: 'q-img-q-in', where: WI, label: 'Suma de query_pos (para la query)', type: 'tensorop', group: 'embed', outMeta: L({ label: "query (t'' + query_pos)", tex: "t'' + q_{\\mathrm{pos}}" }, ti) });
    const io = deformOps({ g, pre: 'd-img-', tpre: 'q-img-', P: P.concat(['img-cross']), rep, where: WI, tl: ti, c, q: iq, value: imem, ref: ref0 });
    const r3 = op('d-res3', A.residual_add(n2, io), ['res3'], { out: 'q-r3', label: 'Residual 3', type: 'tensorop', group: 'resid', outMeta: L({ label: "t'' + cross-attention de imagen", tex: "t'' + O_{\\mathrm{img}}" }) });
    const n3 = op('d-ln3', A.layernorm(r3), ['ln3'], { out: 'q-ln3', label: 'LayerNorm 3 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 3', tex: "t'''" }) });
    const f = ffnOps({ g, pre: 'd-', tpre: 'q-', P: P.concat(['ffn']), rep, where: ['Decoder', 'FFN'], tl: DE + 'FFN · ', Dmlp: c.Dmlp, DmlpSym: 'D_mlp' }, n3);
    const r4 = op('d-res4', A.residual_add(n3, f), ['res4'], { out: 'q-r4', label: 'Residual 4', type: 'tensorop', group: 'resid', outMeta: L({ label: "t''' + FFN", tex: "t''' + F" }) });
    const out = op('d-ln4', A.layernorm(r4), ['ln4'], {
      out: 'q-out', label: 'LayerNorm 4 (post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Decoder · salida de la capa (antes de la LayerNorm final)', tex: 't_\\ell', perLayer: false, note: 'Salida de cada capa (entrada de la siguiente); tras la capa 6 pasa por dec-norm.' },
    });
    // ---- refinamiento de la caja en cada capa (pesos de la cabeza de cajas)
    const WB2 = ['Decoder', 'refinamiento de la caja'], tb = DE + 'refinamiento de la caja · ';
    const dl = boxMlpOps({ g, pre: 'd-refine-', tpre: 'q-refine-', P: P.concat(['box-refine']), rep, where: WB2, tl: tb, D: c.D, share: 'box-head', outId: 'q-refine-delta', outLabel: 'ajuste de la caja de referencia' }, out);
    const rl = op('d-refine-add', A.ref_offset(dl, ref0), ['box-refine', 'ref'], { out: 'q-refine-logit', where: WB2, label: 'Sumar σ⁻¹(caja de referencia)', type: 'head', group: 'head', outMeta: L({ label: 'caja refinada (en logit)', tex: '\\Delta b + \\sigma^{-1}(b)' }, tb) });
    const ref = op('d-refine-sigmoid', A.sigmoid(rl), ['box-refine', 'sigmoid'], {
      out: 'q-ref', where: WB2, label: 'Sigmoide: caja refinada (referencia de la capa siguiente)', type: 'head', group: 'head',
      outMeta: { label: 'Decoder · caja de referencia refinada (entrada de la capa siguiente; la de la capa 5 la usa la cabeza)', tex: 'b_\\ell', perLayer: false, note: 'Refinamiento iterativo: cada capa corrige la caja de la anterior (sin gradiente entre capas).' },
    });
    return { out, ref };
  }

  // ------------------------------------------------------------------ modelo
  A.defineModel({
    id: 'grounding-dino',
    label: 'Grounding DINO',
    paper: {
      title: 'Grounding DINO: Marrying DINO with Grounded Pre-Training for Open-Set Object Detection', authors: 'Liu et al.', venue: 'ECCV 2024', year: 2024,
      arxiv: '2303.05499', code: 'github.com/IDEA-Research/GroundingDINO',
    },
    configs: {
      'grounding-dino-t': Object.assign({}, base, { label: 'Grounding DINO-T @ 896×1344', H: 896, W: 1344, canonical: true,
        source: 'Liu et al. 2023/2024 (Grounding DINO-T: Swin-T + BERT-base, feature enhancer de 6 capas, query selection guiada por lenguaje, decoder cross-modal de 6 capas, 900 queries) y código oficial IDEA-Research/GroundingDINO; 896×1344 para que los 4 stages de Swin sean múltiplos de la ventana 7 (sin padding); cross-check HF GroundingDinoForObjectDetection(GroundingDinoConfig(...))' }),
      // Mismo modelo a resoluciones cuadradas (múltiplos de 224) para comparar con YOLO-World-L @ 640 a escala parecida:
      // 672×672 ≈ la misma resolución; 448×448 ≈ los mismos MACs. Los parámetros no cambian.
      'grounding-dino-t-672': Object.assign({}, base, { label: 'Grounding DINO-T @ 672×672', H: 672, W: 672,
        source: 'El mismo Grounding DINO-T (pesos idénticos) a 672×672: la resolución más cercana a 640 que deja los 4 stages de Swin múltiplos de la ventana 7 (21×21 en el stage 4). Para comparar con YOLO-World-L @ 640 a igual escala; cross-check HF GroundingDinoForObjectDetection(GroundingDinoConfig(...)) a 672×672' }),
      'grounding-dino-t-448': Object.assign({}, base, { label: 'Grounding DINO-T @ 448×448', H: 448, W: 448,
        source: 'El mismo Grounding DINO-T (pesos idénticos) a 448×448 (múltiplo de 224): a esta escala cuesta ≈ lo mismo que YOLO-World-L @ 640. Cross-check HF GroundingDinoForObjectDetection(GroundingDinoConfig(...)) a 448×448' }),
    },
    knobs: { T: [4, 16, 64, 256], res: [448, 672, 896, 1120], H: [448, 672, 896, 1120, 1344], W: [672, 896, 1344, 1568, 2016], Q: [300, 900], G: [1, 3, 7, 20] },
    resPairs: RES_PAIRS.map((p) => p.slice()),

    applyKnobs(c, ov) { return applyKnobs(c, ov); },
    resolve(c) { return resolve(c); },

    build(c, A) {
      const g = A.graph(c);
      const img = g.input('i-img', shp(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const feats = swinBackbone(g, img, c);
      const { mem0, pos } = imageProjection(g, feats, c);
      const { feat, mask, posIds } = textBackbone(g, c);
      const ref = g.op('enc-ref-points', A.reference_points({ levels: c.levelShapes, rowsSym: 'N' }), {
        path: ['enhancer', 'ref-points'], out: 'i-ref', where: ['Feature enhancer'], label: 'Puntos de referencia (centro de cada token de imagen)', type: 'tensorop', group: 'attn',
        outMeta: { label: 'Feature enhancer · puntos de referencia (x, y) por token y nivel', tex: 'r' },
      });
      const tpos = g.op('t-pos-enc', A.sine_pos_1d({ rows: c.T, rowsSym: 'T', D: c.D }), {
        path: ['enhancer', 'txt-pos-enc'], in: ['t-pos-ids'], out: 't-pos', where: ['Feature enhancer'], label: 'Posición seno/coseno del texto (de los position ids, buffer)', type: 'embed', group: 'embed',
        outMeta: { label: 'Feature enhancer · posición seno/coseno de cada token de texto', tex: 'p_t' },
      });
      void posIds;
      const enh = enhancerLayer(g, mem0, feat, pos, tpos, ref, mask, c);
      const { ref0, tgt } = querySelection(g, enh.img, enh.txt, c);
      const dec = decoder(g, tgt, ref0, enh.img, enh.txt, c);
      const hs = g.op('dec-norm', A.layernorm(dec.out), {
        path: ['dec-norm'], out: 'hs', label: 'LayerNorm final del decoder', type: 'norm', group: 'norm',
        outMeta: { label: 'Embeddings de salida de las queries', tex: 'h = \\mathrm{LN}(t_6)' },
      });
      const logits = g.op('contrastive-head', A.contrastive_logits(hs, enh.txt, { pad: c.maxText }), {
        path: ['contrastive-head'], out: 'logits', label: 'Cabeza contrastiva: query · token de texto (sin pesos)', type: 'fuse', group: 'head',
        outMeta: { label: 'Logits por token de texto (Q×T; HF rellena hasta 256 columnas con −∞)', tex: 'z = h\\,t^\\top' },
      });
      const raw = boxMlpOps({ g, pre: 'box-', tpre: 'box-', P: ['box-head'], rep: 1, where: ['Cabeza de cajas'], tl: 'Cabeza de cajas · ', D: c.D, outId: 'box-raw', outLabel: 'ajuste de la caja (antes de la sigmoide)' }, hs);
      const bl = g.op('box-ref', A.ref_offset(raw, dec.ref), {
        path: ['box-head', 'ref'], out: 'box-logits', where: ['Cabeza de cajas'], label: 'Sumar σ⁻¹(caja de referencia de la última capa)', type: 'head', group: 'head',
        outMeta: { label: 'Cabeza de cajas · caja en logit (relativa a la referencia)', tex: '\\Delta b + \\sigma^{-1}(b_5)' },
      });
      const boxes = g.op('box-sigmoid', A.sigmoid(bl), {
        path: ['box-head', 'sigmoid'], out: 'boxes', where: ['Cabeza de cajas'], label: 'Sigmoide: (cx, cy, w, h) en [0, 1]', type: 'head', group: 'head',
        outMeta: { label: 'Cajas por query (cx, cy, w, h normalizados)', tex: '\\hat b = \\sigma(\\cdot)' },
      });
      // Entrenamiento: matching húngaro con costo focal sobre los logits por token + L1 + GIoU.
      const gl = g.input('gt-labels', shp(['G'], [c.G], null, 'vec'), { label: 'Entrenamiento · frase (tokens) de cada uno de los G objetos reales', tex: 'c_g' });
      const gb = g.input('gt-boxes', shp(['G', '4'], [c.G, 4], null, 'seq'), { label: 'Entrenamiento · cajas de los G objetos reales', tex: 'b_g' });
      const W = ['Entrenamiento'];
      const cost = g.op('match-cost', A.hungarian_cost(logits, boxes, gl, gb, { wCls: c.costClass, wL1: c.costBbox, wGiou: c.costGiou, focal: true }), {
        path: ['matching'], out: 'cost', where: W, label: 'Matriz de costos Q×G (focal sobre los tokens de la frase + L1 + GIoU)', type: 'head', group: 'head',
        outMeta: { label: 'Entrenamiento · matriz de costos query × objeto', tex: 'C_{qg}' },
      });
      const asg = g.op('match-assign', A.hungarian_match(cost), {
        path: ['matching'], out: 'assignment', where: W, label: 'Asignación húngara uno a uno', type: 'head', group: 'head',
        outMeta: { label: 'Entrenamiento · pares (query, objeto) del matching', tex: '\\hat\\sigma' },
      });
      g.op('loss', A.set_prediction_loss(logits, boxes, asg, gl, gb, { wL1: c.lossBbox, wGiou: c.lossGiou, focal: true }), {
        path: ['loss'], out: 'loss', where: W, label: 'Pérdida: focal sobre los logits por token + L1 + GIoU', type: 'head', group: 'head',
        outMeta: { label: 'Entrenamiento · pérdida', tex: '\\mathcal{L}' },
      });
      return g;
    },

    quantities(c, r) {
      const n = r.totals.byNode, by = r.totals.byPath;
      const sumOps = (f) => r.ops.filter(f).reduce((s, o) => s + o.params, 0);
      const sumMacs = (f) => r.ops.filter(f).reduce((s, o) => s + o.macs, 0);
      const inEnh = (o) => o.path[0] === 'enhancer' && o.path[1] === 'enh-layer';
      const inDec = (o) => o.path[0] === 'decoder' && o.path[1] === 'dec-layer';
      const fusion = (o) => inEnh(o) && ['i2t', 't2i', 'fus-ln-img', 'fus-ln-txt', 'fus-res-img', 'fus-res-txt'].indexOf(o.path[2]) >= 0;
      const boxMlp = r.ops.filter((o) => o.path[0] === 'box-head' && /^fc/.test(o.path[1])).reduce((s, o) => s + o.macs, 0);
      const headMacs = n['contrastive-head'].macs + n['box-head'].macs;
      const q = {
        tokens: c.N, N: c.N, H: c.H, W: c.W, T: c.T, maxText: c.maxText, Q: c.Q, G: c.G, D: c.D, h: c.h, dh: c.dh, Dmlp: c.Dmlp,
        Lenc: c.Lenc, Ldec: c.Ldec, Lt: c.Lt, levels: c.levels, points: c.points, samples: c.samples,
        hFusion: c.hFusion, Efusion: c.Efusion, unmatched: c.Q - c.G, costEntries: c.Q * c.G,
        imgBackboneParams: n['img-backbone'].params, imgBackboneMacs: n['img-backbone'].macs,
        imgProjParams: n['img-proj'].params, imgProjMacs: n['img-proj'].macs,
        txtBackboneParams: n['txt-backbone'].params, txtBackboneMacs: n['txt-backbone'].macs,
        txtProjParams: n['txt-proj'].params, txtProjMacs: n['txt-proj'].macs,
        tokEmbedParams: by['txt-backbone>embeddings>tok'].params,
        enhancerParams: n.enhancer.params, enhancerMacs: n.enhancer.macs,
        querySelectParams: n['query-select'].params, querySelectMacs: n['query-select'].macs,
        decoderParams: n.decoder.params, decoderMacs: n.decoder.macs,
        refHeadParams: by['decoder>ref-head'].params, refHeadMacs: by['decoder>ref-head'].macs,
        contentQueryParams: by['query-select>content'].params,
        boxHeadParams: n['box-head'].params, headMacs,
        enhLayerParams: sumOps(inEnh), enhLayerMacs: sumMacs(inEnh), decLayerParams: sumOps(inDec), decLayerMacs: sumMacs(inDec),
        fusionLayerParams: sumOps(fusion), fusionLayerMacs: sumMacs(fusion),
        bertLayerParams: sumOps((o) => o.path[0] === 'txt-backbone' && o.path[1] === 'bert-layer'),
        // Lo que HF y el oficial calculan además en cada forward (el calculador predice con la última capa):
        auxHeadsMacs: (c.Ldec - 1) * (boxMlp + c.Q * c.T * c.D),        // cabezas de las 5 capas intermedias
        encoderLogitsMacs: c.Q * c.T * c.D,                              // queries de contenido × texto (solo pérdida)
        // Conteos de las implementaciones de referencia que el grafo no usa:
        unusedSwinLnParams: 2 * c.stages[3].C,                           // HF SwinBackbone.swin.layernorm
        paramsHF: r.totals.params + 2 * c.stages[3].C,
        bertPoolerParams: c.Dtxt * c.Dtxt + c.Dtxt,                       // BertModel del código oficial (congelado, sin uso)
        logitsElements: c.Q * c.T, logitsPaddedElements: c.Q * c.maxText,
      };
      c.levelShapes.forEach(([a, b], i) => { q['l' + (i + 1) + 'H'] = a; q['l' + (i + 1) + 'W'] = b; q['l' + (i + 1) + 'Tokens'] = a * b; });
      c.stages.forEach((st) => { q['s' + st.k + 'Res'] = st.H + '×' + st.W; q['s' + st.k + 'Windows'] = st.windows; q['s' + st.k + 'Params'] = by['img-backbone>stage' + st.k].params; });
      return q;
    },

    // metrics(): costo del texto por imagen, fusión, reparto por bloque, memoria de los scores con nombre y
    // comparación con YOLOv8-L y DETR (configs de referencia). Las genéricas de "scores h×N×N" no aplican: el
    // encoder de imagen es deformable y las matrices densas son de otro tipo (fusión N×T, decoder Q×Q y Q×T).
    metrics(c, r, o) {
      const t = r.totals, n = t.byNode, q = r.quantities, by = o.by, B = o.B;
      const N = c.N, T = c.T, Q = c.Q, D = c.D, E = c.Efusion, hf = c.hFusion, S = c.samples, dh = c.dh;
      const pathHas = (op, id) => op.path.indexOf(id) >= 0;
      const fusionMacs = r.ops.filter((op) => op.path[0] === 'enhancer' && (pathHas(op, 'i2t') || pathHas(op, 't2i'))).reduce((s, op) => s + op.macs * op.repeat, 0);
      const textMacs = n['txt-backbone'].macs + n['txt-proj'].macs;
      const textParams = n['txt-backbone'].params + n['txt-proj'].params;
      const encSamp = 5 * N * S * dh, decSamp = 5 * Q * S * dh;
      const ref = (id) => { try { return A.run(id); } catch (e) { return null; } };
      const y8 = ref('yolov8l-640'), detr = ref('detr-r50-800x1216'), yw = ref('yolo-world-l-640');
      const out = {
        crossoverN: null, crossoverNProj: null, scoreToLinear: null,
        attnMem: null, attnMemAllLayers: null, scoreMacs: null, scoreMacsShare: null,
        // texto: BERT + proyección, se paga en CADA imagen (el prompt entra junto con la imagen)
        textEncoderMacs: textMacs, textEncoderParams: textParams, textEncoderMacsShare: textMacs / t.macs,
        textEncoderMacsMaxT: (function () { const m = c.T === c.maxText ? r : A.run(r.id, { T: c.maxText, H: c.H, W: c.W, Q: c.Q, G: c.G }); return m.totals.byNode['txt-backbone'].macs + m.totals.byNode['txt-proj'].macs; })(),
        // fusión imagen ↔ texto (6 capas): proyecciones a E = 1024 + una matriz h/2×N×T
        fusionMacs, fusionMacsShare: fusionMacs / t.macs, fusionMacsLayer: fusionMacs / c.Lenc,
        fusionScoreMacsLayer: 3 * N * T * E,                 // QKᵀ + A·V (imagen) + Aᵀ·V (texto)
        fusionAttnEntries: hf * N * T, fusionAttnMem: hf * N * T * by * B,
        // reparto por bloque
        imgBackboneMacs: n['img-backbone'].macs, imgBackboneMacsShare: n['img-backbone'].macs / t.macs,
        enhancerMacs: n.enhancer.macs, enhancerMacsShare: n.enhancer.macs / t.macs,
        querySelectMacs: n['query-select'].macs, querySelectMacsShare: n['query-select'].macs / t.macs,
        decoderMacs: n.decoder.macs, decoderMacsShare: n.decoder.macs / t.macs,
        headMacs: q.headMacs, auxHeadsMacs: q.auxHeadsMacs,
        // atención deformable (convención del calculador: 5 MACs por punto y canal)
        encSamplingMacs: c.Lenc * encSamp, decCrossSamplingMacs: c.Ldec * decSamp,
        samplingMacs: c.Lenc * encSamp + c.Ldec * decSamp, samplingShare: (c.Lenc * encSamp + c.Ldec * decSamp) / t.macs,
        // matrices densas que sí existen (por capa)
        decSelfScoreMacs: c.Ldec * 2 * Q * Q * D, decSelfAttnMem: c.h * Q * Q * by * B,
        decTextScoreMacs: c.Ldec * 2 * Q * T * D, decTextAttnMem: c.h * Q * T * by * B,
        txtSelfAttnMem: hf * T * T * by * B,
        denseEncAttnMem: c.h * N * N * by * B,               // si el encoder de imagen fuera denso (como DETR)
        // salida: logits por token de texto
        logitsElements: Q * T, logitsPaddedElements: Q * c.maxText, logitsMem: Q * T * by * B,
        queries: Q, imageTokens: N, textTokens: T,
        units: METRIC_UNITS,
      };
      if (y8) Object.assign(out, { yolov8Macs: y8.totals.macs, yolov8Params: y8.totals.params, macsVsYolov8: t.macs / y8.totals.macs, paramsVsYolov8: t.params / y8.totals.params });
      if (detr) Object.assign(out, { detrMacs: detr.totals.macs, detrParams: detr.totals.params, macsVsDetr: t.macs / detr.totals.macs, paramsVsDetr: t.params / detr.totals.params });
      if (yw) {
        // A escala parecida: el mismo modelo (mismos T, Q y G) a 672×672 (≈ la resolución de YOLO-World-L @ 640) y a 448×448.
        const at = (res) => (c.H === res && c.W === res ? r : A.run(r.id, { H: res, W: res, T: c.T, Q: c.Q, G: c.G }));
        const m672 = at(672), m448 = at(448);
        Object.assign(out, { yoloWorldMacs: yw.totals.macs, yoloWorldParams: yw.totals.params, macsVsYoloWorld: t.macs / yw.totals.macs, paramsVsYoloWorld: t.params / yw.totals.params,
          macsAt672: m672.totals.macs, macsAt448: m448.totals.macs,
          macsVsYoloWorldAt672: m672.totals.macs / yw.totals.macs, macsVsYoloWorldAt448: m448.totals.macs / yw.totals.macs });
      }
      out.scaling = RES_PAIRS.map(([H, W]) => {
        const m = A.run(r.id, { H, W, T: c.T, Q: Math.min(c.Q, 900), G: c.G });
        const nn = m.totals.byNode;
        return { H, W, tokens: m.config.N, macs: m.totals.macs, imgBackboneMacs: nn['img-backbone'].macs, enhancerMacs: nn.enhancer.macs, decoderMacs: nn.decoder.macs,
          textEncoderMacs: nn['txt-backbone'].macs + nn['txt-proj'].macs, fusionAttnMem: hf * m.config.N * T * by * B };
      });
      out.textScaling = [4, 16, 64, 256].map((Tt) => {
        const m = Tt === c.T ? r : A.run(r.id, { T: Tt, H: c.H, W: c.W, Q: c.Q, G: c.G });
        const nn = m.totals.byNode;
        return { T: Tt, macs: m.totals.macs, textEncoderMacs: nn['txt-backbone'].macs + nn['txt-proj'].macs, fusionAttnMem: hf * N * Tt * by * B };
      });
      return out;
    },
  });

  // Unidades de las métricas que no siguen la convención de nombres (…Mem = bytes, …Share = fracción).
  const METRIC_UNITS = { macsVsYolov8: 'ratio', paramsVsYolov8: 'ratio', macsVsDetr: 'ratio', paramsVsDetr: 'ratio', macsVsYoloWorld: 'ratio',
    paramsVsYoloWorld: 'ratio', macsVsYoloWorldAt672: 'ratio', macsVsYoloWorldAt448: 'ratio', macsAt672: 'macs', macsAt448: 'macs',
    textEncoderMacsMaxT: 'macs', samplingShare: 'pct', fusionAttnMem: 'bytes',
    fusionAttnEntries: 'count', logitsElements: 'count', logitsPaddedElements: 'count', queries: 'count', imageTokens: 'count', textTokens: 'count' };
})(typeof window !== 'undefined' ? window : globalThis);
