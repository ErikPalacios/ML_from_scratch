/* =============================================================================
   Atlas de Arquitecturas — js/arch/detr.js
   Modelos `detr` (Carion et al., ECCV 2020, arXiv:2005.12872; código oficial facebookresearch/detr) y
   `deformable-detr` (Zhu et al., ICLR 2021, arXiv:2010.04159; código oficial fundamentalvision/Deformable-DETR).
   Referencia del cross-check: HF `DetrForObjectDetection(DetrConfig(...))` y
   `DeformableDetrForObjectDetection(DeformableDetrConfig(...))` construidos en código, backbone timm
   resnet50 sin pesos (crosscheck/detr.py). Contrato de ids: SPEC §15.

   Convenciones: formas sin batch; rejillas H×W×C (PyTorch: C×H×W). Símbolos: N tokens de la memoria
   (DETR: H/32·W/32 = 950 a 800×1216; Deformable: Σ_l H_l·W_l), D = 256, h = 8 cabezas, d_h = D/h,
   D_mlp (FFN: 2048 en DETR, 1024 en Deformable), Q queries, G objetos reales, K+1 clases de DETR (91 ids de
   COCO + "no object"). Deformable DETR usa la notación del paper para L niveles y K puntos (h = cabezas,
   como en el resto del Atlas; el paper las llama M) y K_cls = 91 clases (focal loss: sin clase ∅).

   BACKBONE (ResNet-50 de js/arch/resnet.js: mismos bloques y anchos, v1.5): FrozenBatchNorm2d en el código
   oficial Y en HF: γ, β, media y varianza son BUFFERS (4C), no parámetros. El calculador sigue al
   oficial (cfg.frozenBN = true): backbone = 23,454,912 parámetros (las convs). Con cfg.frozenBN = false
   cuenta γ y β como parámetros (+2C por BN, +53,120: el conteo de torchvision resnet50 sin la fc).
   HF coincide con el oficial (no hace falta un flag para reproducirlo; ver crosscheck/expected/*.json).
   El código oficial además congela conv1 y layer1 (requires_grad = False): quantities.trainableParams.
   Cabezas: la predicción usa la salida de la última capa del decoder (repeat 1). El código oficial de
   DETR (y HF/oficial de Deformable DETR) aplica las cabezas a las 6 salidas del decoder en cada forward
   para las pérdidas auxiliares: quantities.auxHeadsMacs = (L_dec − 1)·(MACs de las cabezas).

   ---------------------------------------------------------------- DETR (`detr`)
   Configs: detr-r50-800x1216 (canónica, 25×38 = 950 tokens), detr-r50-640 (640×640 → 20×20 = 400).
   Knobs: res (cuadrada: H = W = res), H, W (múltiplos de 32), Q (queries), G (objetos reales; G ≤ Q).
   Ops (id · path · entradas → salida):
     Backbone (op.where ['Backbone (ResNet-50)']):
       stem       backbone › stem      x-img → stem-out        (conv 7×7 s2 + FrozenBN + ReLU)
       maxpool    backbone › maxpool   stem-out → pool-out
       l{k}-b1    backbone › layer{k}  → l{k}-b1-out          (bottleneck con proyección; stride 2 si k > 1)
       l{k}-b2    backbone › layer{k}  → c{k+1}               (bottlenecks 2…n, repeat n − 1)
     input-proj   input-proj           c5 → proj               (conv 1×1 2048 → D, con sesgo)
     flatten      flatten              proj → memory-in        (25×38×D → 950×D)
     pos-enc      pos-enc              → pos                   (PE 2-D seno/coseno, buffer)
     Capa del encoder (repeat L_enc = 6; path encoder › enc-layer › …; post-LN):
       e-add-pos   add-pos                 memory-in, pos → e-qk-in   (x + pos: SOLO para Q y K)
       e-q-proj    self-attn › q-proj      e-qk-in → e-qp
       e-k-proj    self-attn › k-proj      e-qk-in → e-kp
       e-v-proj    self-attn › v-proj      memory-in → e-vp           (V sin posición)
       e-split     self-attn › split       → e-q, e-k, e-v            (h×N×d_h)
       e-scores    self-attn › scores      → e-scores                 (h×N×N = 8×950×950)
       e-scale     self-attn › scale       → e-scores-scaled
       e-softmax   self-attn › softmax     → e-attn
       e-weighted-sum self-attn › weighted-sum → e-z-heads
       e-merge     self-attn › merge       → e-z
       e-proj      self-attn › proj        → e-o
       e-res1      res1                    memory-in, e-o → e-r1
       e-ln1       ln1                     → e-ln1
       e-fc1 / e-relu / e-fc2   ffn › fc1 / relu / fc2   → e-u / e-g / e-f
       e-res2      res2                    e-ln1, e-f → e-r2
       e-ln2       ln2                     → memory                   (salida de cada capa; tras la 6.ª, la memoria)
     Queries: query-embed (queries) → query-pos (Q×D, aprendida) · tgt-init (queries) → tgt0 (Q×D, ceros).
     Capa del decoder (repeat L_dec = 6; path decoder › dec-layer › …; post-LN):
       d-add-qpos        add-qpos                tgt0, query-pos → d-qk-in
       d-self-q-proj / d-self-k-proj / d-self-v-proj   self-attn › q-proj / k-proj / v-proj
                         (Q, K desde d-qk-in; V desde tgt0) → d-self-qp / d-self-kp / d-self-vp
       d-self-split      self-attn › split       → d-self-q, d-self-k, d-self-v
       d-self-scores     self-attn › scores      → d-self-scores (h×Q×Q = 8×100×100)
       d-self-scale · d-self-softmax · d-self-weighted-sum · d-self-merge · d-self-proj
                         (scale · softmax · weighted-sum · merge · proj) → d-self-scores-scaled · d-self-attn ·
                         d-self-z-heads · d-self-z · d-self-o
       d-res1 (res1) tgt0, d-self-o → d-r1 · d-ln1 (ln1) → d-ln1
       d-cross-add-qpos  cross-attn › add-qpos   d-ln1, query-pos → d-cross-q-in
       d-cross-add-pos   cross-attn › add-pos    memory, pos → d-cross-k-in
       d-cross-q-proj    cross-attn › q-proj     d-cross-q-in → d-cross-qp (Q×D)
       d-cross-k-proj    cross-attn › k-proj     d-cross-k-in → d-cross-kp (N×D)
       d-cross-v-proj    cross-attn › v-proj     memory → d-cross-vp (N×D)
       d-cross-split     cross-attn › split      → d-cross-q (h×Q×d_h), d-cross-k, d-cross-v (h×N×d_h)
       d-cross-scores    cross-attn › scores     → d-cross-scores (h×Q×N = 8×100×950)
       d-cross-scale · d-cross-softmax · d-cross-weighted-sum · d-cross-merge · d-cross-proj
                         → d-cross-scores-scaled · d-cross-attn · d-cross-z-heads · d-cross-z · d-cross-o
       d-res2 (res2) d-ln1, d-cross-o → d-r2 · d-ln2 (ln2) → d-ln2
       d-fc1 / d-relu / d-fc2 (ffn › fc1 / relu / fc2) → d-u / d-g / d-f
       d-res3 (res3) → d-r3 · d-ln3 (ln3) → d-out (salida de cada capa)
     dec-norm     dec-norm                d-out → hs              (LayerNorm final, compartida por las salidas aux.)
     class-head   class-head              hs → logits             (Linear D → K+1 = 92)
     box-fc1 · box-relu1 · box-fc2 · box-relu2 · box-fc3 · box-sigmoid   box-head › fc1 · relu1 · fc2 · relu2 ·
                  fc3 · sigmoid           hs → box-h1 → box-a1 → box-h2 → box-a2 → box-raw → boxes (Q×4)
     Entrenamiento: entradas gt-labels (G), gt-boxes (G×4);
       match-cost   matching              logits, boxes, gt-labels, gt-boxes → cost (Q×G)
       match-assign matching              cost → assignment (G×2)
       loss         loss                  logits, boxes, assignment, gt-labels, gt-boxes → loss
   Tensores (orden del forward): x-img stem-out pool-out l1-b1-out c2 l2-b1-out c3 l3-b1-out c4 l4-b1-out c5
     proj memory-in pos e-qk-in e-qp e-kp e-vp e-q e-k e-v e-scores e-scores-scaled e-attn e-z-heads e-z e-o
     e-r1 e-ln1 e-u e-g e-f e-r2 memory query-pos tgt0 d-qk-in d-self-qp d-self-kp d-self-vp d-self-q d-self-k
     d-self-v d-self-scores d-self-scores-scaled d-self-attn d-self-z-heads d-self-z d-self-o d-r1 d-ln1
     d-cross-q-in d-cross-k-in d-cross-qp d-cross-kp d-cross-vp d-cross-q d-cross-k d-cross-v d-cross-scores
     d-cross-scores-scaled d-cross-attn d-cross-z-heads d-cross-z d-cross-o d-r2 d-ln2 d-u d-g d-f d-r3 d-out
     hs logits box-h1 box-a1 box-h2 box-a2 box-raw boxes gt-labels gt-boxes cost assignment loss
   Añadidos a SPEC §15.1 (nada renombrado): nodos `add-qpos` y `add-pos` también DENTRO de `cross-attn`
   (la suma de query_pos a Q y de pos a la memoria para K: por eso byNode['add-qpos'] incluye las dos
   sumas de query_pos); nodos internos ffn › {fc1, relu, fc2}, backbone › {stem, maxpool, layer1…4} y
   box-head › {fc1, relu1, fc2, relu2, fc3, sigmoid}; tensores de backbone (stem-out, pool-out,
   l{k}-b1-out, c2…c4), proyecciones antes de partir en cabezas (`*-qp/-kp/-vp`), `*-scores-scaled`,
   `*-z-heads`, `*-z`, `*-o`, residuales y normas, `d-out` (salida de una capa del decoder, antes de
   dec-norm), los tensores del box MLP y `gt-labels`, `gt-boxes`, `assignment`. Op ids `match-cost` y
   `match-assign` (nodo `matching`) y `loss` (nodo `loss`).

   ---------------------------------------------------------------- Deformable DETR (`deformable-detr`)
   Config: deformable-detr-r50 (800×1216, 4 niveles: C3 100×152, C4 50×76, C5 25×38 y una conv 3×3 s2
   sobre C5 → 13×19; N = 20,197 tokens; 300 queries; FFN 1024; K = 4 puntos por cabeza y nivel).
   Knobs: res, H, W, Q, G, points (K).
   Ops: backbone igual que DETR (stem, maxpool, l{k}-b1, l{k}-b2) →
     proj-l{i} (input-proj › proj-l{i})   c3/c4/c5 → src-l{i}-conv  (conv 1×1 → D; nivel 4: conv 3×3 s2 sobre c5)
     gn-l{i}   (input-proj › proj-l{i})   → src-l{i}                (GroupNorm 32)        i = 1…4
     flatten   (flatten)                  src-l1…l4 → memory-in     (N×D)
     pos-enc   (pos-enc › sine)           → pos-sine                (PE seno/coseno de cada nivel, buffer)
     level-embed (pos-enc › level-embed)  → level-table             (L×D, aprendida)
     add-level (pos-enc › add-level)      pos-sine, level-table → pos
     enc-ref-points (encoder › ref-points) → e-ref                  (N×L×2, centros de cada token)
     Capa del encoder (repeat 6; path encoder › enc-layer › …):
       e-add-pos (add-pos) memory-in, pos → e-q-in ·
       self-attn › {value-proj: e-value-proj memory-in → e-value · offsets: e-offsets e-q-in → e-offsets
       (N×hLK·2) · attn-weights: e-attn-weights → e-aw-logits (N×hLK) · softmax: e-softmax → e-aw ·
       sample: e-sample e-value, e-offsets, e-ref → e-sampled (h×N×LK×d_h) · weighted-sum:
       e-weighted-sum e-sampled, e-aw → e-z (N×D) · proj: e-proj → e-o} · res1 (e-r1) · ln1 (e-ln1) ·
       ffn › {fc1, relu, fc2} (e-u, e-g, e-f) · res2 (e-r2) · ln2 → memory
     query-embed (queries) → query-pos, tgt0  (tabla Q×2D partida en dos: en Deformable la entrada es aprendida)
     ref-points (decoder › ref-points) query-pos → d-ref-logits (Q×2) · ref-sigmoid (decoder › ref-points) → d-ref
     Capa del decoder (repeat 6; path decoder › dec-layer › …): d-add-qpos y self-attn como en DETR
       (d-self-*, d-res1, d-ln1); cross-attn deformable: d-cross-add-qpos (cross-attn › add-qpos) d-ln1,
       query-pos → d-cross-q-in · cross-attn › {value-proj: d-cross-value-proj memory → d-cross-value (N×D) ·
       offsets: d-cross-offsets → d-cross-offsets (Q×hLK·2) · attn-weights: d-cross-attn-weights →
       d-cross-aw-logits · softmax: d-cross-softmax → d-cross-aw · sample: d-cross-sample (con d-ref) →
       d-cross-sampled (h×Q×LK×d_h) · weighted-sum → d-cross-z · proj → d-cross-o} · d-res2, d-ln2,
       ffn (d-u, d-g, d-f), d-res3, d-ln3 → hs  (Deformable DETR no tiene LayerNorm final del decoder)
     class-head → logits (Q×K_cls) · box-fc1 … box-fc3 (box-head › …) → box-raw · box-ref
       (box-head › ref) box-raw, d-ref → box-logits · box-sigmoid → boxes · match-cost / match-assign
       (matching) → cost, assignment · loss.
   Tensores: x-img stem-out pool-out l1-b1-out c2 l2-b1-out c3 l3-b1-out c4 l4-b1-out c5 src-l1-conv src-l1
     … src-l4-conv src-l4 memory-in pos-sine level-table pos e-ref e-q-in e-value e-offsets e-aw-logits e-aw
     e-sampled e-z e-o e-r1 e-ln1 e-u e-g e-f e-r2 memory query-pos tgt0 d-ref-logits d-ref d-qk-in d-self-qp
     d-self-kp d-self-vp d-self-q d-self-k d-self-v d-self-scores d-self-scores-scaled d-self-attn
     d-self-z-heads d-self-z d-self-o d-r1 d-ln1 d-cross-q-in d-cross-value d-cross-offsets d-cross-aw-logits
     d-cross-aw d-cross-sampled d-cross-z d-cross-o d-r2 d-ln2 d-u d-g d-f d-r3 hs logits box-h1 box-a1 box-h2
     box-a2 box-raw box-logits boxes gt-labels gt-boxes cost assignment loss
   MACs del muestreo (deform_sample 4·h·N_q·L·K·d_h + deform_weighted_sum h·N_q·L·K·d_h): analíticos
   (FlopCounterMode no cuenta grid_sample ni la suma ponderada elementwise); el JSON lo anota.

   Etiquetas de tensor con prefijo de contexto ("Encoder · …", "Decoder · self-attention · …",
   "Decoder · cross-attention · …", "Backbone · …") y op.where = ['Encoder', 'self-attention'],
   ['Decoder', 'cross-attention'], ['Backbone (ResNet-50)'], … para que la práctica nombre sin ambigüedad.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('detr.js necesita js/arch/primitives.js antes.');

  // ResNet-50: bloques, anchos y stem de js/arch/resnet.js (si está cargado), con la misma v1.5.
  const R50 = (function () {
    try {
      const c = A.model('resnet').configs['resnet50-224'];
      return { blocks: c.blocks.slice(), widths: c.widths.slice(), expansion: c.expansion, stem: c.stem };
    } catch (e) { return { blocks: [3, 4, 6, 3], widths: [64, 128, 256, 512], expansion: 4, stem: 64 }; }
  })();

  const backboneCfg = { Cin: 3, backbone: 'resnet50', blocks: R50.blocks, widths: R50.widths, expansion: R50.expansion, stem: R50.stem, frozenBN: true };
  const detrBase = Object.assign({}, backboneCfg, {
    D: 256, h: 8, Dmlp: 2048, Lenc: 6, Ldec: 6, Q: 100, classes: 91, G: 7, act: 'relu', postLN: true, boxLayers: 3,
    // Matching y pérdida (código oficial: main.py; verificar contra el paper antes de citarlos)
    costClass: 1, costBbox: 5, costGiou: 2, lossCe: 1, lossBbox: 5, lossGiou: 2, eosCoef: 0.1, auxLoss: true,
  });
  const deformBase = Object.assign({}, backboneCfg, {
    D: 256, h: 8, Dmlp: 1024, Lenc: 6, Ldec: 6, Q: 300, classes: 91, G: 7, act: 'relu', postLN: true, boxLayers: 3,
    levels: 4, points: 4, gnGroups: 32, twoStage: false, boxRefine: false,
    costClass: 2, costBbox: 5, costGiou: 2, lossCls: 2, lossBbox: 5, lossGiou: 2, focalAlpha: 0.25, focalGamma: 2, auxLoss: true,
  });

  // Pares de resolución del explorador de escala (H×W, múltiplos de 32).
  const RES_PAIRS = [[512, 512], [640, 640], [800, 800], [800, 1216], [1024, 1024], [1024, 1536]];

  // ------------------------------------------------------------------ knobs y resolución
  function applyKnobs(c, ov, name) {
    const notes = [];
    const Q0 = c.Q, P0 = c.points;
    if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
    if (ov.H !== undefined) c.H = ov.H;
    if (ov.W !== undefined) c.W = ov.W;
    if (ov.Q !== undefined) c.Q = ov.Q;
    if (ov.G !== undefined) c.G = ov.G;
    if (ov.points !== undefined) c.points = ov.points;
    if (c.Q !== Q0) notes.push('Q = ' + c.Q + ' queries (la config usa ' + Q0 + '): la tabla de queries pasa a ' + c.Q + '×' + (c.points ? 2 * c.D : c.D) + ' parámetros; un modelo entrenado con otro Q no se puede reusar tal cual.');
    if (P0 !== undefined && c.points !== P0) notes.push('K = ' + c.points + ' puntos por cabeza y nivel (la config usa ' + P0 + '): cambian los Linear de offsets (D → hLK·2) y de pesos (D → hLK).');
    if (ov.res !== undefined || ov.H !== undefined || ov.W !== undefined || ov.Q !== undefined || ov.points !== undefined) {
      c.label = name + ' @ ' + c.H + '×' + c.W + (c.Q !== Q0 ? ' · Q = ' + c.Q : '') + (P0 !== undefined && c.points !== P0 ? ' · K = ' + c.points : '');
    }
    c._notes = notes;
    return c;
  }

  function resolveCommon(c) {
    if (c.H % 32 !== 0 || c.W % 32 !== 0) throw new Error('DETR: la resolución debe ser múltiplo de 32 en alto y ancho (recibí ' + c.H + '×' + c.W + ').');
    if (c.H < 64 || c.W < 64) throw new Error('DETR: la resolución mínima es 64×64.');
    if (c.D % c.h !== 0) throw new Error('DETR: D = ' + c.D + ' no es divisible por h = ' + c.h + '.');
    if (c.G > c.Q) throw new Error('DETR: hay más objetos reales (G = ' + c.G + ') que queries (Q = ' + c.Q + '); el matching uno a uno necesita G ≤ Q.');
    if (c.H === c.W) c.res = c.H; else delete c.res;
    c.gridH = c.H / 32; c.gridW = c.W / 32;        // C5 (stride 32)
    c.c5Tokens = c.gridH * c.gridW;
    c.dh = c.D / c.h;
    c.headClasses = c.classes;
    c.stride = 32;
    c.unmatched = c.Q - c.G;
    return c;
  }

  // ------------------------------------------------------------------ backbone (ResNet-50, FrozenBN)
  function backboneOps(g, img, c) {
    const W = ['Backbone (ResNet-50)'], TL = 'Backbone · ';
    const fz = c.frozenBN !== false;
    const bnName = fz ? 'FrozenBN' : 'BN';
    const sym = (res, s) => { res.out = A.shape(s, res.out.num, res.out.mod, res.out.layout); res.shapeTex = A.fmt.shapeTex(res.inputs[0]) + ' \\to ' + A.fmt.shapeTex(res.out); return res; };
    const stem = g.op('stem', sym(A.conv_bn(img, { k: 7, s: 2, p: 3, cout: c.stem, frozenBN: fz }), ['H/2', 'W/2', String(c.stem)]), {
      path: ['backbone', 'stem'], out: 'stem-out', where: W, label: 'Stem: conv 7×7 s2 + ' + bnName + ' + ReLU', type: 'conv', group: 'embed',
      outMeta: { label: TL + 'salida del stem (stride 2)', tex: 'h_{\\mathrm{stem}}' },
    });
    let x = g.op('maxpool', A.maxpool2d(stem, { k: 3, s: 2, p: 1, outSym: ['H/4', 'W/4'] }), {
      path: ['backbone', 'maxpool'], out: 'pool-out', where: W, label: 'Max pooling 3×3, stride 2', type: 'tensorop', group: 'embed',
      outMeta: { label: TL + 'entrada de layer1 (stride 4)', tex: 'h_0' },
    });
    let stride = 4;
    const outs = {};
    for (let i = 0; i < 4; i++) {
      const k = i + 1, w = c.widths[i], cout = w * c.expansion, s = i === 0 ? 1 : 2;
      stride *= s;
      const os = ['H/' + stride, 'W/' + stride, String(cout)];
      const cid = 'c' + (k + 1), C = 'C' + (k + 1);
      x = g.op('l' + k + '-b1', sym(A.bottleneck(x, { width: w, cout, stride: s, project: true, frozenBN: fz }), os), {
        path: ['backbone', 'layer' + k], out: 'l' + k + '-b1-out', where: W,
        label: 'layer' + k + ' · bloque 1 (bottleneck ' + w + ' → ' + cout + (s > 1 ? ', stride 2' : '') + ', atajo proyectado)', type: 'conv', group: 'embed',
        outMeta: { label: TL + 'layer' + k + ', salida del bloque 1', tex: 'h_{' + k + ',1}' },
      });
      x = g.op('l' + k + '-b2', sym(A.bottleneck(x, { width: w, cout, stride: 1, project: false, frozenBN: fz }), os), {
        path: ['backbone', 'layer' + k], out: cid, where: W, repeat: c.blocks[i] - 1,
        label: 'layer' + k + ' · bloques 2…' + c.blocks[i] + ' (bottleneck, atajo identidad)', type: 'conv', group: 'embed',
        outMeta: { label: TL + C + ' (salida de layer' + k + ', stride ' + stride + ')', tex: C },
      });
      outs[cid] = x;
    }
    return outs;
  }

  // ------------------------------------------------------------------ atención multi-cabeza como ops
  // pre = prefijo de ids ('e-', 'd-self-', 'd-cross-'); P = path del grupo de atención; L = meta por capa;
  // qIn, kIn, vIn = handles. Devuelve la salida (W_O).
  function mhaOps(g, s) {
    const { pre, P, rep, where, tl } = s;
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, where }, extra));
    const D = s.qIn.num[1];
    const qp = op('q-proj', A.linear(s.qIn, { dout: D, doutSym: 'D' }), 'q-proj', { out: pre + 'qp', label: 'Proyección W_Q' + s.qNote, type: 'embed', group: 'attn', outMeta: L({ label: 'Q proyectada', tex: s.qTex }) });
    const kp = op('k-proj', A.linear(s.kIn, { dout: D, doutSym: 'D' }), 'k-proj', { out: pre + 'kp', label: 'Proyección W_K' + s.kNote, type: 'embed', group: 'attn', outMeta: L({ label: 'K proyectada', tex: s.kTex }) });
    const vp = op('v-proj', A.linear(s.vIn, { dout: D, doutSym: 'D' }), 'v-proj', { out: pre + 'vp', label: 'Proyección W_V' + s.vNote, type: 'embed', group: 'attn', outMeta: L({ label: 'V proyectada (sin posición)', tex: s.vTex }) });
    const [q, k, v] = op('split', A.split_qkv_heads(qp, kp, vp, { h: s.h }), 'split', {
      out: [pre + 'q', pre + 'k', pre + 'v'], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Queries por cabeza', tex: 'Q' }), L({ label: 'Keys por cabeza', tex: 'K' }), L({ label: 'Values por cabeza', tex: 'V' })],
    });
    const sc = op('scores', A.attention_scores(q, k), 'scores', { out: pre + 'scores', label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const ss = op('scale', A.scale(sc), 'scale', { out: pre + 'scores-scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const a = op('softmax', A.softmax(ss), 'softmax', { out: pre + 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), 'weighted-sum', { out: pre + 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: 'D' }), 'merge', { out: pre + 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    return op('proj', A.linear(z, { dout: D, doutSym: 'D' }), 'proj', { out: pre + 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'Salida de la atención', tex: 'O = ZW_O' }) });
  }

  // FFN post-LN: fc1 (D → D_mlp) → ReLU → fc2.
  function ffnOps(g, x, s) {
    const { pre, P, rep, where, tl } = s;
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat(['ffn', node]), repeat: rep, where }, extra));
    const u = op('fc1', A.linear(x, { dout: s.Dmlp, doutSym: 'D_mlp' }), 'fc1', { out: pre + 'u', label: 'FFN: capa 1 (expansión)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta de la FFN', tex: 'U = xW_1 + b_1' }) });
    const gg = op('relu', A.relu(u), 'relu', { out: pre + 'g', label: 'ReLU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación ReLU', tex: '\\mathrm{ReLU}(U)' }) });
    return op('fc2', A.linear(gg, { dout: x.num[1], doutSym: 'D' }), 'fc2', { out: pre + 'f', label: 'FFN: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida de la FFN', tex: 'F' }) });
  }

  // ------------------------------------------------------------------ DETR: capas
  function detrEncoderLayer(g, x, pos, c) {
    const P = ['encoder', 'enc-layer'], rep = c.Lenc, tl = 'Encoder · ';
    const WA = ['Encoder', 'self-attention'], WL = ['Encoder'], WF = ['Encoder', 'FFN'];
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: rep, where: WL }, extra));
    const qk = op('e-add-pos', A.add(x, pos), P.concat(['add-pos']), { out: 'e-qk-in', label: 'Suma de posición (solo para Q y K)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'entrada de Q y K (x + pos)', tex: 'x + p' }) });
    const o = mhaOps(g, { pre: 'e-', P: P.concat(['self-attn']), rep, where: WA, tl: tl + 'self-attention · ', h: c.h,
      qIn: qk, kIn: qk, vIn: x, qNote: ' (desde x + pos)', kNote: ' (desde x + pos)', vNote: ' (desde x, sin posición)',
      qTex: '(x+p)W_Q', kTex: '(x+p)W_K', vTex: 'xW_V' });
    const r1 = op('e-res1', A.residual_add(x, o), P.concat(['res1']), { out: 'e-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: "x + O" }) });
    const n1 = op('e-ln1', A.layernorm(r1), P.concat(['ln1']), { out: 'e-ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "x' = \\mathrm{LN}_1(x + O)" }) });
    const f = ffnOps(g, n1, { pre: 'e-', P, rep, where: WF, tl: tl + 'FFN · ', Dmlp: c.Dmlp });
    const r2 = op('e-res2', A.residual_add(n1, f), P.concat(['res2']), { out: 'e-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "x' + FFN", tex: "x' + F" }) });
    return op('e-ln2', A.layernorm(r2), P.concat(['ln2']), {
      out: 'memory', label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Memoria del encoder (salida de la capa 6)', tex: 'M = \\mathrm{LN}_2(x\' + F)', perLayer: false, note: 'Salida de cada capa del encoder; tras la capa 6 es la memoria que leen K y V del decoder.' },
    });
  }

  function detrDecoderLayer(g, tgt, qpos, memory, pos, c) {
    const P = ['decoder', 'dec-layer'], rep = c.Ldec, tl = 'Decoder · ';
    const WL = ['Decoder'], WS = ['Decoder', 'self-attention'], WC = ['Decoder', 'cross-attention'], WF = ['Decoder', 'FFN'];
    const L = (m, pre) => Object.assign({ perLayer: true }, m, { label: (pre || tl) + m.label });
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: rep, where: WL }, extra));
    const qk = op('d-add-qpos', A.add(tgt, qpos), P.concat(['add-qpos']), { out: 'd-qk-in', label: 'Suma de query_pos (para Q y K de la self-attention)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'self-attention · entrada de Q y K (tgt + query_pos)', tex: 't + q_{\\mathrm{pos}}' }) });
    const so = mhaOps(g, { pre: 'd-self-', P: P.concat(['self-attn']), rep, where: WS, tl: tl + 'self-attention · ', h: c.h,
      qIn: qk, kIn: qk, vIn: tgt, qNote: ' (desde tgt + query_pos)', kNote: ' (desde tgt + query_pos)', vNote: ' (desde tgt)',
      qTex: '(t+q_{\\mathrm{pos}})W_Q', kTex: '(t+q_{\\mathrm{pos}})W_K', vTex: 'tW_V' });
    const r1 = op('d-res1', A.residual_add(tgt, so), P.concat(['res1']), { out: 'd-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'tgt + self-attention', tex: 't + O_{\\mathrm{self}}' }) });
    const n1 = op('d-ln1', A.layernorm(r1), P.concat(['ln1']), { out: 'd-ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "t' = \\mathrm{LN}_1(\\cdot)" }) });
    const C = P.concat(['cross-attn']), tc = tl + 'cross-attention · ';
    const cq = op('d-cross-add-qpos', A.add(n1, qpos), C.concat(['add-qpos']), { out: 'd-cross-q-in', where: WC, label: 'Suma de query_pos (para Q de la cross-attention)', type: 'tensorop', group: 'embed', outMeta: L({ label: "entrada de Q (t' + query_pos)", tex: "t' + q_{\\mathrm{pos}}" }, tc) });
    const ck = op('d-cross-add-pos', A.add(memory, pos), C.concat(['add-pos']), { out: 'd-cross-k-in', where: WC, label: 'Suma de posición a la memoria (solo para K)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'entrada de K (memoria + pos)', tex: 'M + p' }, tc) });
    const co = mhaOps(g, { pre: 'd-cross-', P: C, rep, where: WC, tl: tc, h: c.h,
      qIn: cq, kIn: ck, vIn: memory, qNote: ' (desde las queries)', kNote: ' (desde la memoria + pos)', vNote: ' (desde la memoria, sin posición)',
      qTex: "(t'+q_{\\mathrm{pos}})W_Q", kTex: '(M+p)W_K', vTex: 'MW_V' });
    const r2 = op('d-res2', A.residual_add(n1, co), P.concat(['res2']), { out: 'd-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "t' + cross-attention", tex: "t' + O_{\\mathrm{cross}}" }) });
    const n2 = op('d-ln2', A.layernorm(r2), P.concat(['ln2']), { out: 'd-ln2', label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 2', tex: "t'' = \\mathrm{LN}_2(\\cdot)" }) });
    const f = ffnOps(g, n2, { pre: 'd-', P, rep, where: WF, tl: tl + 'FFN · ', Dmlp: c.Dmlp });
    const r3 = op('d-res3', A.residual_add(n2, f), P.concat(['res3']), { out: 'd-r3', label: 'Residual 3', type: 'tensorop', group: 'resid', outMeta: L({ label: "t'' + FFN", tex: "t'' + F" }) });
    return op('d-ln3', A.layernorm(r3), P.concat(['ln3']), {
      out: 'd-out', label: 'LayerNorm 3 (post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Decoder · salida de la capa (antes de la LayerNorm final)', tex: 't_{\\ell} = \\mathrm{LN}_3(t\'\' + F)', perLayer: false, note: 'Salida de cada capa del decoder (entrada de la siguiente); tras la capa 6 pasa por dec-norm.' },
    });
  }

  // Cabezas por query (comunes a los dos modelos). Devuelve {logits, boxes}.
  function headOps(g, hs, c, o) {
    const logits = g.op('class-head', A.linear(hs, { dout: o.classOut, doutSym: o.classSym }), {
      path: ['class-head'], out: 'logits', label: 'Cabeza de clase (Linear D → ' + o.classOut + ')', type: 'head', group: 'head',
      outMeta: { label: 'Logits de clase por query' + (o.noObject ? ' (91 ids + ∅)' : ''), tex: 'z = h\\,W_{\\mathrm{cls}} + b' },
    });
    const BH = ['box-head'], WB = ['Cabeza de cajas'];
    const L = (m) => Object.assign({}, m, { label: 'Cabeza de cajas · ' + m.label });
    const h1 = g.op('box-fc1', A.linear(hs, { dout: c.D, doutSym: 'D' }), { path: BH.concat(['fc1']), out: 'box-h1', where: WB, label: 'MLP de cajas: capa 1', type: 'head', group: 'head', outMeta: L({ label: 'capa 1', tex: 'u_1' }) });
    const a1 = g.op('box-relu1', A.relu(h1), { path: BH.concat(['relu1']), out: 'box-a1', where: WB, label: 'ReLU', type: 'head', group: 'head', outMeta: L({ label: 'ReLU 1', tex: '\\mathrm{ReLU}(u_1)' }) });
    const h2 = g.op('box-fc2', A.linear(a1, { dout: c.D, doutSym: 'D' }), { path: BH.concat(['fc2']), out: 'box-h2', where: WB, label: 'MLP de cajas: capa 2', type: 'head', group: 'head', outMeta: L({ label: 'capa 2', tex: 'u_2' }) });
    const a2 = g.op('box-relu2', A.relu(h2), { path: BH.concat(['relu2']), out: 'box-a2', where: WB, label: 'ReLU', type: 'head', group: 'head', outMeta: L({ label: 'ReLU 2', tex: '\\mathrm{ReLU}(u_2)' }) });
    let raw = g.op('box-fc3', A.linear(a2, { dout: 4, doutSym: '4' }), { path: BH.concat(['fc3']), out: 'box-raw', where: WB, label: 'MLP de cajas: capa 3 (D → 4)', type: 'head', group: 'head', outMeta: L({ label: 'cajas antes de la sigmoide', tex: '\\tilde b' }) });
    if (o.ref) {
      raw = g.op('box-ref', A.ref_offset(raw, o.ref), { path: BH.concat(['ref']), out: 'box-logits', where: WB, label: 'Sumar σ⁻¹(ref) en (cx, cy)', type: 'head', group: 'head', outMeta: L({ label: 'cajas relativas a la referencia', tex: '\\tilde b + \\sigma^{-1}(r)' }) });
    }
    const boxes = g.op('box-sigmoid', A.sigmoid(raw), { path: BH.concat(['sigmoid']), out: 'boxes', where: WB, label: 'Sigmoide: (cx, cy, w, h) en [0, 1]', type: 'head', group: 'head', outMeta: { label: 'Cajas por query (cx, cy, w, h normalizados)', tex: '\\hat b = \\sigma(\\cdot)' } });
    return { logits, boxes };
  }

  // Matching húngaro y pérdida (solo entrenamiento).
  function trainingOps(g, logits, boxes, c, o) {
    const gl = g.input('gt-labels', A.shape(['G'], [c.G], null, 'vec'), { label: 'Entrenamiento · clases de los G objetos reales', tex: 'c_i' });
    const gb = g.input('gt-boxes', A.shape(['G', '4'], [c.G, 4], null, 'seq'), { label: 'Entrenamiento · cajas de los G objetos reales', tex: 'b_i' });
    const W = ['Entrenamiento'];
    const cost = g.op('match-cost', A.hungarian_cost(logits, boxes, gl, gb, { wCls: c.costClass, wL1: c.costBbox, wGiou: c.costGiou, focal: !!o.focal }), {
      path: ['matching'], out: 'cost', where: W, label: 'Matriz de costos Q×G (clase + L1 + GIoU)', type: 'head', group: 'head',
      outMeta: { label: 'Entrenamiento · matriz de costos query × objeto', tex: 'C_{ij} = -\\lambda_{\\mathrm{cls}}\\hat p_j(c_i) + \\lambda_{L1}\\lVert b_i - \\hat b_j\\rVert_1 - \\lambda_{\\mathrm{giou}}\\mathrm{GIoU}' },
    });
    const asg = g.op('match-assign', A.hungarian_match(cost), {
      path: ['matching'], out: 'assignment', where: W, label: 'Asignación húngara uno a uno', type: 'head', group: 'head',
      outMeta: { label: 'Entrenamiento · pares (query, objeto) del matching', tex: '\\hat\\sigma' },
    });
    g.op('loss', A.set_prediction_loss(logits, boxes, asg, gl, gb, o.focal
      ? { wCe: c.lossCls, wL1: c.lossBbox, wGiou: c.lossGiou, focal: true }
      : { wCe: c.lossCe, wL1: c.lossBbox, wGiou: c.lossGiou, eos: c.eosCoef }), {
      path: ['loss'], out: 'loss', where: W, label: o.focal ? 'Pérdida: focal + L1 + GIoU' : 'Pérdida: CE (∅ con peso ' + c.eosCoef + ') + L1 + GIoU', type: 'head', group: 'head',
      outMeta: { label: 'Entrenamiento · pérdida de conjunto', tex: '\\mathcal{L}_{\\mathrm{Hungarian}}' },
    });
  }

  // ------------------------------------------------------------------ modelo DETR
  A.defineModel({
    id: 'detr',
    label: 'DETR — DEtection TRansformer',
    paper: {
      title: 'End-to-End Object Detection with Transformers', authors: 'Carion et al.', venue: 'ECCV 2020', year: 2020,
      arxiv: '2005.12872', code: 'github.com/facebookresearch/detr',
    },
    configs: {
      'detr-r50-800x1216': Object.assign({}, detrBase, { label: 'DETR-R50 @ 800×1216', H: 800, W: 1216, canonical: true,
        source: 'Carion et al. 2020 (DETR, backbone R50; lado corto 800, 1216 para que todos los strides dividan exacto) y código oficial facebookresearch/detr; cross-check HF DetrForObjectDetection(DetrConfig(...))' }),
      'detr-r50-640': Object.assign({}, detrBase, { label: 'DETR-R50 @ 640×640', H: 640, W: 640,
        source: 'DETR-R50 a 640×640 (20×20 = 400 tokens): la misma resolución que YOLO para comparar' }),
    },
    knobs: { res: [512, 640, 800, 1024], H: [512, 640, 800, 1024], W: [640, 800, 1024, 1216, 1312], Q: [50, 100, 300], G: [1, 3, 7, 20] },
    resPairs: RES_PAIRS.map((p) => p.slice()),

    applyKnobs(c, ov) { return applyKnobs(c, ov, 'DETR-R50'); },

    resolve(c) {
      resolveCommon(c);
      c.N = c.c5Tokens;
      c.tokens = c.N;
      c.headOut = c.classes + 1;
      return c;
    },

    build(c, A) {
      const g = A.graph(c);
      const img = g.input('x-img', A.shape(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const bb = backboneOps(g, img, c);
      const proj = g.op('input-proj', A.conv2d(bb.c5, { k: 1, cout: c.D, coutSym: 'D', outSym: ['H/32', 'W/32'], bias: true }), {
        path: ['input-proj'], out: 'proj', label: 'Proyección de entrada (conv 1×1, 2048 → D)', type: 'embed', group: 'embed',
        outMeta: { label: 'Mapa C5 proyectado a D canales', tex: 'f = W_{1\\times 1} * C_5' },
      });
      const mem0 = g.op('flatten', A.flatten(proj, { sym: ['N', 'D'] }), {
        path: ['flatten'], out: 'memory-in', label: 'Aplanar H/32 × W/32 → N tokens', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Tokens de imagen (entrada del encoder)', tex: 'x_0' },
      });
      const pos = g.op('pos-enc', A.sine_pos_encoding({ H: c.gridH, W: c.gridW, D: c.D, rowsSym: 'N' }), {
        path: ['pos-enc'], out: 'pos', label: 'Posición 2-D seno/coseno (fija, buffer)', type: 'embed', group: 'embed',
        outMeta: { label: 'Codificación posicional 2-D', tex: 'p' },
      });
      const memory = detrEncoderLayer(g, mem0, pos, c);
      const qpos = g.op('query-embed', A.learned_queries({ Q: c.Q, D: c.D }), {
        path: ['queries'], out: 'query-pos', label: 'Object queries aprendidas (query_pos)', type: 'embed', group: 'embed',
        outMeta: { label: 'Object queries (query_pos)', tex: 'q_{\\mathrm{pos}}' },
      });
      const tgt0 = g.op('tgt-init', A.zeros_init({ rows: c.Q, rowsSym: 'Q', D: c.D }), {
        path: ['queries'], out: 'tgt0', label: 'Entrada del decoder en ceros', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Entrada del decoder (ceros)', tex: 't_0 = 0' },
      });
      const dout = detrDecoderLayer(g, tgt0, qpos, memory, pos, c);
      const hs = g.op('dec-norm', A.layernorm(dout), {
        path: ['dec-norm'], out: 'hs', label: 'LayerNorm final del decoder', type: 'norm', group: 'norm',
        outMeta: { label: 'Embeddings de salida de las queries', tex: 'h = \\mathrm{LN}(t_6)' },
      });
      const { logits, boxes } = headOps(g, hs, c, { classOut: c.headOut, classSym: 'K+1', noObject: true });
      trainingOps(g, logits, boxes, c, { focal: false });
      return g;
    },

    quantities(c, r) { return Object.assign(commonQuantities(c, r), { headOut: c.headOut, classesPlusNoObject: c.classes + 1 }); },

    metrics(c, r, o) {
      const D = c.D, N = c.N, Q = c.Q, h = c.h, by = o.by, B = o.B;
      const enc = 2 * N * N * D, dself = 2 * Q * Q * D, dcross = 2 * Q * N * D;
      const out = layerSplit(c, r);
      Object.assign(out, {
        encScoreMacsLayer: enc, encScoreMacs: c.Lenc * enc,
        decSelfScoreMacsLayer: dself, decSelfScoreMacs: c.Ldec * dself,
        decCrossScoreMacsLayer: dcross, decCrossScoreMacs: c.Ldec * dcross,
        encScoreShare: c.Lenc * enc / r.totals.macs, decSelfScoreShare: c.Ldec * dself / r.totals.macs, decCrossScoreShare: c.Ldec * dcross / r.totals.macs,
        encAttnEntries: h * N * N, decCrossAttnEntries: h * Q * N, decSelfAttnEntries: h * Q * Q,
        encAttnMem: h * N * N * by * B, encAttnFp32Mem: h * N * N * 4 * B, encAttnMemAllLayers: c.Lenc * h * N * N * by * B,
        decCrossAttnMem: h * Q * N * by * B, decSelfAttnMem: h * Q * Q * by * B,
        encToCrossScore: enc / dcross,                       // = N/Q
        tokens2x: 4 * N, encScoreMacs2x: 16 * c.Lenc * enc,  // duplicar H y W: tokens ×4, scores ×16
        encAttnMem2x: 16 * h * N * N * by * B,
      });
      out.scaling = RES_PAIRS.map(([H, W]) => {
        const m = A.run(r.id, { H, W, Q: c.Q, G: c.G });
        const n = (H / 32) * (W / 32);
        return { H, W, tokens: n, encScoreMacs: c.Lenc * 2 * n * n * D, decCrossScoreMacs: c.Ldec * 2 * Q * n * D, encAttnMem: h * n * n * by * B,
          macs: m.totals.macs, backboneMacs: m.totals.byNode.backbone.macs, encoderMacs: m.totals.byNode.encoder.macs };
      });
      return out;
    },
  });

  // ------------------------------------------------------------------ Deformable DETR: capas
  function deformAttnOps(g, s) {
    const { pre, P, rep, where, tl, c } = s;
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, where }, extra));
    const D = c.D, S = c.h * c.levels * c.points;
    const v = op('value-proj', A.linear(s.value, { dout: D, doutSym: 'D' }), 'value-proj', { out: pre + 'value', label: 'Proyección del value (W_V, sobre los N tokens)', type: 'embed', group: 'attn', outMeta: L({ label: 'value proyectado (N tokens de todos los niveles)', tex: 'xW_V' }) });
    const off = op('offsets', A.linear(s.q, { dout: 2 * S, doutSym: 'hLK·2' }), 'offsets', { out: pre + 'offsets', label: 'Offsets de muestreo (Linear D → hLK·2)', type: 'attn', group: 'attn', outMeta: L({ label: 'offsets Δp (x, y) por cabeza, nivel y punto', tex: '\\Delta p = qW_{\\Delta}' }) });
    const awl = op('attn-weights', A.linear(s.q, { dout: S, doutSym: 'hLK' }), 'attn-weights', { out: pre + 'aw-logits', label: 'Pesos de atención (Linear D → hLK)', type: 'attn', group: 'attn', outMeta: L({ label: 'logits de los pesos de muestreo', tex: 'qW_A' }) });
    const aw = op('softmax', A.softmax(awl), 'softmax', { out: pre + 'aw', label: 'Softmax sobre los L·K puntos de cada cabeza', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos de muestreo A (suman 1 por cabeza)', tex: 'A = \\mathrm{softmax}_{LK}(qW_A)' }) });
    const smp = op('sample', A.deform_sample(v, off, s.ref, { h: c.h, L: c.levels, K: c.points }), 'sample', { out: pre + 'sampled', label: 'Muestreo bilineal del value en ref + Δp', type: 'attn', group: 'attn', outMeta: L({ label: 'values muestreados (hLK puntos por query)', tex: 'V(r + \\Delta p)' }) });
    const z = op('weighted-sum', A.deform_weighted_sum(smp, aw, { Dsym: 'D' }), 'weighted-sum', { out: pre + 'z', label: 'Suma ponderada de las muestras (y concatenar cabezas)', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por query (cabezas concatenadas)', tex: '\\textstyle\\sum_{l,k} A\\,V(r+\\Delta p)' }) });
    const o = op('proj', A.linear(z, { dout: D, doutSym: 'D' }), 'proj', { out: pre + 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'salida de la atención deformable', tex: 'O = ZW_O' }) });
    return o;
  }

  function deformEncoderLayer(g, x, pos, ref, c) {
    const P = ['encoder', 'enc-layer'], rep = c.Lenc, tl = 'Encoder · ';
    const WL = ['Encoder'];
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: rep, where: WL }, extra));
    const q = op('e-add-pos', A.add(x, pos), P.concat(['add-pos']), { out: 'e-q-in', label: 'Suma de posición + nivel (para la query)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'query de la atención deformable (x + pos)', tex: 'x + p' }) });
    const o = deformAttnOps(g, { pre: 'e-', P: P.concat(['self-attn']), rep, where: ['Encoder', 'atención deformable'], tl: tl + 'atención deformable · ', c, q, value: x, ref });
    const r1 = op('e-res1', A.residual_add(x, o), P.concat(['res1']), { out: 'e-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: 'x + O' }) });
    const n1 = op('e-ln1', A.layernorm(r1), P.concat(['ln1']), { out: 'e-ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "x' = \\mathrm{LN}_1(x + O)" }) });
    const f = ffnOps(g, n1, { pre: 'e-', P, rep, where: ['Encoder', 'FFN'], tl: tl + 'FFN · ', Dmlp: c.Dmlp });
    const r2 = op('e-res2', A.residual_add(n1, f), P.concat(['res2']), { out: 'e-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "x' + FFN", tex: "x' + F" }) });
    return op('e-ln2', A.layernorm(r2), P.concat(['ln2']), {
      out: 'memory', label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Memoria multi-escala del encoder (salida de la capa 6)', tex: 'M = \\mathrm{LN}_2(x\' + F)', perLayer: false, note: 'Salida de cada capa del encoder; tras la capa 6 es el value de la cross-attention deformable.' },
    });
  }

  function deformDecoderLayer(g, tgt, qpos, memory, ref, c) {
    const P = ['decoder', 'dec-layer'], rep = c.Ldec, tl = 'Decoder · ';
    const WL = ['Decoder'], WS = ['Decoder', 'self-attention'], WC = ['Decoder', 'cross-attention deformable'];
    const L = (m, pre) => Object.assign({ perLayer: true }, m, { label: (pre || tl) + m.label });
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: rep, where: WL }, extra));
    const qk = op('d-add-qpos', A.add(tgt, qpos), P.concat(['add-qpos']), { out: 'd-qk-in', label: 'Suma de query_pos (para Q y K de la self-attention)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'self-attention · entrada de Q y K (tgt + query_pos)', tex: 't + q_{\\mathrm{pos}}' }) });
    const so = mhaOps(g, { pre: 'd-self-', P: P.concat(['self-attn']), rep, where: WS, tl: tl + 'self-attention · ', h: c.h,
      qIn: qk, kIn: qk, vIn: tgt, qNote: ' (desde tgt + query_pos)', kNote: ' (desde tgt + query_pos)', vNote: ' (desde tgt)',
      qTex: '(t+q_{\\mathrm{pos}})W_Q', kTex: '(t+q_{\\mathrm{pos}})W_K', vTex: 'tW_V' });
    const r1 = op('d-res1', A.residual_add(tgt, so), P.concat(['res1']), { out: 'd-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'tgt + self-attention', tex: 't + O_{\\mathrm{self}}' }) });
    const n1 = op('d-ln1', A.layernorm(r1), P.concat(['ln1']), { out: 'd-ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "t' = \\mathrm{LN}_1(\\cdot)" }) });
    const C = P.concat(['cross-attn']), tc = tl + 'cross-attention deformable · ';
    const cq = op('d-cross-add-qpos', A.add(n1, qpos), C.concat(['add-qpos']), { out: 'd-cross-q-in', where: WC, label: 'Suma de query_pos (para la query de la cross-attention)', type: 'tensorop', group: 'embed', outMeta: L({ label: "query (t' + query_pos)", tex: "t' + q_{\\mathrm{pos}}" }, tc) });
    const co = deformAttnOps(g, { pre: 'd-cross-', P: C, rep, where: WC, tl: tc, c, q: cq, value: memory, ref });
    const r2 = op('d-res2', A.residual_add(n1, co), P.concat(['res2']), { out: 'd-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "t' + cross-attention", tex: "t' + O_{\\mathrm{cross}}" }) });
    const n2 = op('d-ln2', A.layernorm(r2), P.concat(['ln2']), { out: 'd-ln2', label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 2', tex: "t'' = \\mathrm{LN}_2(\\cdot)" }) });
    const f = ffnOps(g, n2, { pre: 'd-', P, rep, where: ['Decoder', 'FFN'], tl: tl + 'FFN · ', Dmlp: c.Dmlp });
    const r3 = op('d-res3', A.residual_add(n2, f), P.concat(['res3']), { out: 'd-r3', label: 'Residual 3', type: 'tensorop', group: 'resid', outMeta: L({ label: "t'' + FFN", tex: "t'' + F" }) });
    return op('d-ln3', A.layernorm(r3), P.concat(['ln3']), {
      out: 'hs', label: 'LayerNorm 3 (post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Embeddings de salida de las queries', tex: 'h = \\mathrm{LN}_3(t\'\' + F)', perLayer: false, note: 'Salida de cada capa del decoder; tras la capa 6 van a las cabezas (Deformable DETR no tiene LayerNorm final).' },
    });
  }

  // Niveles de la pirámide: C3, C4, C5 (strides 8, 16, 32) + conv 3×3 s2 sobre C5 (stride 64, redondeo hacia arriba).
  function levelsOf(c) {
    const lv = [8, 16, 32].map((s) => [c.H / s, c.W / s]);
    const h5 = c.H / 32, w5 = c.W / 32;
    lv.push([Math.floor((h5 + 2 - 3) / 2) + 1, Math.floor((w5 + 2 - 3) / 2) + 1]);
    return lv.slice(0, c.levels);
  }
  const ceilSym = (d, n) => (n % 64 === 0 ? d + '/64' : '⌈' + d + '/64⌉');

  // ------------------------------------------------------------------ modelo Deformable DETR
  A.defineModel({
    id: 'deformable-detr',
    label: 'Deformable DETR',
    paper: {
      title: 'Deformable DETR: Deformable Transformers for End-to-End Object Detection', authors: 'Zhu et al.', venue: 'ICLR 2021', year: 2021,
      arxiv: '2010.04159', code: 'github.com/fundamentalvision/Deformable-DETR',
    },
    configs: {
      'deformable-detr-r50': Object.assign({}, deformBase, { label: 'Deformable DETR-R50 @ 800×1216', H: 800, W: 1216, canonical: true,
        source: 'Zhu et al. 2021 (Deformable DETR, single-scale no: 4 niveles C3–C5 + stride 64; 300 queries; sin box refinement ni two-stage) y código oficial fundamentalvision/Deformable-DETR; cross-check HF DeformableDetrForObjectDetection(DeformableDetrConfig(...))' }),
    },
    knobs: { res: [512, 640, 800, 1024], H: [512, 640, 800, 1024], W: [640, 800, 1024, 1216, 1312], Q: [100, 300, 900], G: [1, 3, 7, 20], points: [1, 2, 4, 8] },
    resPairs: RES_PAIRS.map((p) => p.slice()),

    applyKnobs(c, ov) { return applyKnobs(c, ov, 'Deformable DETR-R50'); },

    resolve(c) {
      resolveCommon(c);
      if (c.levels !== 4) throw new Error('Deformable DETR: el calculador modela 4 niveles (C3–C5 + stride 64).');
      c.levelShapes = levelsOf(c);
      c.levelTokens = c.levelShapes.map(([a, b]) => a * b);
      c.N = c.levelTokens.reduce((s, x) => s + x, 0);
      c.tokens = c.N;
      c.samples = c.h * c.levels * c.points;        // hLK puntos por query
      c.offsetsDim = 2 * c.samples;
      c.headOut = c.classes;
      return c;
    },

    build(c, A) {
      const g = A.graph(c);
      const img = g.input('x-img', A.shape(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const bb = backboneOps(g, img, c);
      const ins = [bb.c3, bb.c4, bb.c5];
      const syms = [['H/8', 'W/8'], ['H/16', 'W/16'], ['H/32', 'W/32'], [ceilSym('H', c.H), ceilSym('W', c.W)]];
      const strides = [8, 16, 32, 64];
      const src = [];
      for (let i = 0; i < c.levels; i++) {
        const l = i + 1, extra = i === 3;
        const P = ['input-proj', 'proj-l' + l], W = ['Proyección de entrada', 'nivel ' + l + ' (stride ' + strides[i] + ')'];
        const cv = g.op('proj-l' + l, A.conv2d(extra ? bb.c5 : ins[i], extra
          ? { k: 3, s: 2, p: 1, cout: c.D, coutSym: 'D', outSym: syms[i], bias: true, floor: true }
          : { k: 1, cout: c.D, coutSym: 'D', outSym: syms[i], bias: true }), {
          path: P, out: 'src-l' + l + '-conv', where: W,
          label: extra ? 'Nivel 4: conv 3×3 stride 2 sobre C5 (2048 → D)' : 'Nivel ' + l + ': conv 1×1 sobre C' + (l + 2) + ' (' + ins[i].num[2] + ' → D)', type: 'conv', group: 'embed',
          outMeta: { label: 'Nivel ' + l + ' · mapa proyectado (stride ' + strides[i] + ')', tex: 'W * ' + (extra ? 'C_5' : 'C_' + (l + 2)) },
        });
        src.push(g.op('gn-l' + l, A.group_norm(cv, { groups: c.gnGroups }), {
          path: P, out: 'src-l' + l, where: W, label: 'GroupNorm (32 grupos)', type: 'norm', group: 'norm',
          outMeta: { label: 'Nivel ' + l + ' · mapa normalizado (stride ' + strides[i] + ')', tex: 'f_' + l },
        }));
      }
      const mem0 = g.op('flatten', A.flatten_levels(src, { sym: ['N', 'D'] }), {
        path: ['flatten'], out: 'memory-in', label: 'Aplanar y concatenar los ' + c.levels + ' niveles', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Tokens multi-escala (entrada del encoder)', tex: 'x_0' },
      });
      const ps = g.op('pos-enc', A.sine_pos_encoding({ levels: c.levelShapes, D: c.D, rowsSym: 'N' }), {
        path: ['pos-enc', 'sine'], out: 'pos-sine', label: 'Posición 2-D seno/coseno de cada nivel (buffer)', type: 'embed', group: 'embed',
        outMeta: { label: 'Codificación posicional 2-D (niveles concatenados)', tex: 'p_{\\mathrm{sin}}' },
      });
      const lt = g.op('level-embed', A.level_embed({ L: c.levels, D: c.D }), {
        path: ['pos-enc', 'level-embed'], out: 'level-table', label: 'Embedding de nivel (aprendido, L×D)', type: 'embed', group: 'embed',
        outMeta: { label: 'Tabla de embeddings de nivel', tex: 'e_{\\mathrm{lvl}}' },
      });
      const pos = g.op('add-level', A.add_level_embed(ps, lt, { levels: c.levelTokens }), {
        path: ['pos-enc', 'add-level'], out: 'pos', label: 'Sumar a cada token el vector de su nivel', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Posición + nivel de cada token', tex: 'p = p_{\\mathrm{sin}} + e_{\\mathrm{lvl}}' },
      });
      const eref = g.op('enc-ref-points', A.reference_points({ levels: c.levelShapes, rowsSym: 'N' }), {
        path: ['encoder', 'ref-points'], out: 'e-ref', label: 'Puntos de referencia del encoder (centro de cada token)', type: 'tensorop', group: 'attn',
        outMeta: { label: 'Encoder · puntos de referencia (x, y) por token y nivel', tex: 'r' },
      });
      const memory = deformEncoderLayer(g, mem0, pos, eref, c);
      const [qpos, tgt0] = g.op('query-embed', A.learned_queries({ Q: c.Q, D: c.D, split: true }), {
        path: ['queries'], out: ['query-pos', 'tgt0'], label: 'Object queries aprendidas (Q×2D → query_pos y tgt)', type: 'embed', group: 'embed',
        outMeta: [{ label: 'Object queries (query_pos)', tex: 'q_{\\mathrm{pos}}' }, { label: 'Entrada del decoder (aprendida)', tex: 't_0' }],
      });
      const rl = g.op('ref-points', A.linear(qpos, { dout: 2, doutSym: '2' }), {
        path: ['decoder', 'ref-points'], out: 'd-ref-logits', label: 'Punto de referencia de cada query (Linear D → 2)', type: 'attn', group: 'attn',
        outMeta: { label: 'Decoder · referencia antes de la sigmoide', tex: 'q_{\\mathrm{pos}}W_r' },
      });
      const dref = g.op('ref-sigmoid', A.sigmoid(rl), {
        path: ['decoder', 'ref-points'], out: 'd-ref', label: 'Sigmoide: referencia (x, y) en [0, 1]', type: 'attn', group: 'attn',
        outMeta: { label: 'Decoder · punto de referencia (x, y) de cada query', tex: 'r = \\sigma(q_{\\mathrm{pos}}W_r)' },
      });
      const hs = deformDecoderLayer(g, tgt0, qpos, memory, dref, c);
      const { logits, boxes } = headOps(g, hs, c, { classOut: c.headOut, classSym: 'K_cls', noObject: false, ref: dref });
      trainingOps(g, logits, boxes, c, { focal: true });
      return g;
    },

    quantities(c, r) {
      const q = commonQuantities(c, r);
      const n = r.totals.byNode;
      c.levelShapes.forEach(([a, b], i) => { q['l' + (i + 1) + 'H'] = a; q['l' + (i + 1) + 'W'] = b; q['l' + (i + 1) + 'Tokens'] = a * b; });
      const msda = r.ops.filter((o) => o.path[0] === 'encoder' && o.path[2] === 'self-attn');
      return Object.assign(q, {
        levels: c.levels, points: c.points, samples: c.samples, offsetsDim: c.offsetsDim, attnWeightsDim: c.samples,
        msdaParams: msda.reduce((s, o) => s + o.params, 0),
        levelEmbedParams: n['level-embed'].params, refPointsParams: n['ref-points'].params,
        queryTableParams: n.queries.params,
      });
    },

    metrics(c, r, o) {
      const D = c.D, N = c.N, Q = c.Q, h = c.h, by = o.by, B = o.B, S = c.samples, dh = c.dh;
      const out = layerSplit(c, r);
      const encSamp = 5 * N * S * dh, decSamp = 5 * Q * S * dh;
      const dense = 2 * N * N * D, denseCross = 2 * Q * N * D, dself = 2 * Q * Q * D;
      Object.assign(out, {
        // Sin término N²: el cruce scores ↔ lineales de un bloque denso no aplica (lo pondría el genérico).
        crossoverN: null, crossoverNProj: null, scoreToLinear: null,
        samplesPerQuery: S, keysPerQueryDense: N,
        encSamplingMacsLayer: encSamp, encSamplingMacs: c.Lenc * encSamp,
        decCrossSamplingMacsLayer: decSamp, decCrossSamplingMacs: c.Ldec * decSamp,
        decSelfScoreMacsLayer: dself, decSelfScoreMacs: c.Ldec * dself,
        samplingMacs: c.Lenc * encSamp + c.Ldec * decSamp,
        samplingShare: (c.Lenc * encSamp + c.Ldec * decSamp) / r.totals.macs,
        // Si el encoder usara atención densa (como DETR) sobre los mismos N tokens multi-escala:
        denseEncScoreMacsLayer: dense, denseEncScoreMacs: c.Lenc * dense, denseToDeform: dense / encSamp,
        denseEncAttnMem: h * N * N * by * B, denseEncAttnFp32Mem: h * N * N * 4 * B,
        denseDecCrossScoreMacsLayer: denseCross,
        encSampledMem: N * S * dh * by * B,                // h×N×LK×d_h (lo materializa la ruta PyTorch; el kernel CUDA no)
        encAttnWeightsMem: N * S * by * B,
        decSelfAttnMem: h * Q * Q * by * B,
        tokens2x: 4 * N,
      });
      out.scaling = RES_PAIRS.map(([H, W]) => {
        const m = A.run(r.id, { H, W, Q: c.Q, G: c.G, points: c.points });
        const n = m.config.N;
        return { H, W, tokens: n, encSamplingMacs: c.Lenc * 5 * n * S * dh, denseEncScoreMacs: c.Lenc * 2 * n * n * D,
          denseEncAttnMem: h * n * n * by * B, macs: m.totals.macs, backboneMacs: m.totals.byNode.backbone.macs, encoderMacs: m.totals.byNode.encoder.macs };
      });
      return out;
    },
  });

  // ------------------------------------------------------------------ cantidades y métricas comunes
  function commonQuantities(c, r) {
    const n = r.totals.byNode;
    // BN del backbone: buffers (frozen: 4C) y lo que serían parámetros con BN normal (γ, β = 2C).
    const bn = bnStats(c), bnC = bn.C;
    const frozen = frozenOfficial(r);
    const headMacs = n['class-head'].macs + n['box-head'].macs;
    const encL = r.ops.filter((o) => o.path[0] === 'encoder' && o.path[1] === 'enc-layer');
    const decL = r.ops.filter((o) => o.path[0] === 'decoder' && o.path[1] === 'dec-layer');
    const q = {
      tokens: c.tokens, N: c.N, gridH: c.gridH, gridW: c.gridW, H: c.H, W: c.W, D: c.D, h: c.h, dh: c.dh, Dmlp: c.Dmlp,
      Lenc: c.Lenc, Ldec: c.Ldec, Q: c.Q, G: c.G, classes: c.classes, unmatched: c.Q - c.G, costEntries: c.Q * c.G,
      backboneParams: n.backbone.params, backboneMacs: n.backbone.macs,
      inputProjParams: n['input-proj'].params, inputProjMacs: n['input-proj'].macs,
      encoderParams: n.encoder.params, encoderMacs: n.encoder.macs, decoderParams: n.decoder.params, decoderMacs: n.decoder.macs,
      encLayerParams: encL.reduce((s, o) => s + o.params, 0), decLayerParams: decL.reduce((s, o) => s + o.params, 0),
      encLayerMacs: encL.reduce((s, o) => s + o.macs, 0), decLayerMacs: decL.reduce((s, o) => s + o.macs, 0),
      queryParams: n.queries.params, classHeadParams: n['class-head'].params, boxHeadParams: n['box-head'].params,
      headParams: n['class-head'].params + n['box-head'].params, headMacs,
      auxHeadsMacs: (c.Ldec - 1) * headMacs,
      transformerParams: r.totals.params - n.backbone.params,
      bnLayers: bn.n, bnChannels: bnC,
      bnBuffers: c.frozenBN !== false ? 4 * bnC : 2 * bnC + bn.n,   // frozen: γ, β, media, varianza; normal: media, varianza, contador
      bnAffine: 2 * bnC,                                   // γ y β: parámetros en torchvision, buffers en DETR
      paramsWithTrainableBN: c.frozenBN !== false ? r.totals.params + 2 * bnC : r.totals.params,
      frozenParamsOfficial: frozen, trainableParams: r.totals.params - frozen,
    };
    if (n['dec-norm']) q.decNormParams = n['dec-norm'].params;
    return q;
  }

  // Canales de BN del backbone (stem + 3 por bottleneck + 1 por atajo proyectado) y número de BN.
  function bnStats(c) {
    let C = c.stem, n = 1;
    for (let i = 0; i < 4; i++) {
      const w = c.widths[i], cout = w * c.expansion;
      C += c.blocks[i] * (2 * w + cout) + cout;
      n += 3 * c.blocks[i] + 1;
    }
    return { C, n };
  }

  // Parámetros que el código oficial congela (requires_grad = False): conv1 y layer1 del backbone
  // (solo entrena layer2…layer4: `train_backbone` en backbone.py).
  function frozenOfficial(r) {
    return r.ops.filter((o) => o.path[0] === 'backbone' && (o.path[1] === 'stem' || o.path[1] === 'layer1'))
      .reduce((s, o) => s + o.params * o.repeat, 0);
  }

  // Reparto de MACs por bloque (los dos modelos).
  function layerSplit(c, r) {
    const n = r.totals.byNode, t = r.totals.macs;
    const backbone = n.backbone.macs, enc = n.encoder.macs, dec = n.decoder.macs;
    const proj = n['input-proj'].macs;
    const heads = n['class-head'].macs + n['box-head'].macs;
    return {
      backboneMacs: backbone, backboneMacsShare: backbone / t, inputProjMacs: proj,
      encoderMacs: enc, encoderMacsShare: enc / t, decoderMacs: dec, decoderMacsShare: dec / t,
      headMacs: heads, auxHeadsMacs: (c.Ldec - 1) * heads, queries: c.Q, costEntries: c.Q * c.G,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
