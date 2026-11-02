/* =============================================================================
   Atlas de Arquitecturas — js/arch/yolo-world.js
   Modelos `yolo-world` (Cheng et al., YOLO-World: Real-Time Open-Vocabulary Object Detection, CVPR 2024,
   arXiv:2401.17270; código oficial AILab-CVC/YOLO-World sobre mmyolo) y `yolov8` (ancla: Ultralytics YOLOv8-L,
   solo calculadora, sin página; lo usan los bloques `compare` y el puente). Contrato de ids: SPEC §16.2.
   Referencia del cross-check: Ultralytics 8.4.174 construido desde los YAML incluidos en el paquete
   (`yolov8l.yaml`, `yolov8l-world.yaml`), sin pesos, sin CLIP y sin red (crosscheck/yolo_world.py): DetectionModel
   y WorldModel con los embeddings del vocabulario puestos a mano (sin correr el codificador de texto).

   Convenciones: formas sin batch; rejillas H×W×C (PyTorch: C×H×W). YOLOv8-L = escala l del YAML (depth 1.0,
   width 1.0, max_channels 512): canales 64, 128, 256, 512, 512 (el 1024 del YAML se recorta a 512) y C2f con
   n = 3, 6, 6, 3 en el backbone y 3 en el neck. Los canales se escriben como números en las formas (no hay D).
   Símbolos: H, W (imagen), K = 80 clases (YOLOv8), V = clases del vocabulario (YOLO-World, knob, 80 por
   defecto), A = Σ_l h_l·w_l celdas (anclas sin caja: 80² + 40² + 20² = 8,400 a 640), R = 16 bins de la DFL.
   quantities.tokens = A (las "posiciones" que predicen; no hay tokens de un transformer).

   YOLO-World-L (v1 = la del paper; Ultralytics `yolov8l-world.yaml`, WorldDetect con ContrastiveHead):
   - backbone = el de YOLOv8-L (CSPDarknet con C2f + SPPF).
   - RepVL-PAN: el PAN-FPN de YOLOv8 con T-CSPLayers (C2fAttn: C2f + max-sigmoid attention guiada por los V
     embeddings) en los 4 nodos (top-down P4 y P3, bottom-up P4 y P5) y la image-pooling attention entre el
     top-down y el bottom-up: actualiza los embeddings de texto con 27 tokens de imagen (3×3 por nivel, desde
     P3, P4 top-down y C5). Los T-CSPLayers del bottom-up usan el texto actualizado; la cabeza usa el ORIGINAL
     (igual en el código oficial: el neck no devuelve el texto).
   - cabeza por nivel: cajas (conv 3×3 ×2 + conv 1×1 → 4R, DFL) y región-texto (conv 3×3 ×2 + conv 1×1 → 512,
     L2 y coseno con cada embedding, × e^s + b).
   - codificador de texto CLIP ViT-B/32 (torre de texto de js/arch/clip.js, `clip-vit-b32`): OFFLINE. Corre una
     vez por vocabulario ("prompt-then-detect": los embeddings quedan como pesos) y su costo no entra en los
     totales online; va en la op txt-encoder (detail) y en metrics (promptTextMacs, vocabTextMacs,
     textEncoderParams). La v2 (yolov8l-worldv2) quita la image-pooling attention y usa BNContrastiveHead (BN
     en el embedding de la región): quantities.v2* y las notas del JSON. Con la image-pooling attention el texto
     que guía al bottom-up depende de la imagen, así que la reparametrización completa (texto → pesos fijos)
     solo es exacta en la v2.
   Diferencias Ultralytics ↔ oficial (mmyolo) en el JSON del cross-check (SPPF sin activación en cv1 en
   Ultralytics 8.4, etc.). Parámetros y MACs: los de Ultralytics (cross-check exacto).

   metrics() (además de las genéricas; B = 1, bf16). Unidades: …Macs = MACs, …Mem = bytes, …Share = fracción,
   …Params = parámetros; ratios (units = 'ratio'): vocabTextToOnline, macsVsYolov8, gdinoToYoloWorldMacs,
   detrToYoloWorldMacs, yoloWorldToYolov8Macs, detrToYolov8Macs, gdino672ToYoloWorldMacs, gdino448ToYoloWorldMacs (Grounding
   DINO-T @ 672×672 y @ 448×448, configs grounding-dino-t-672 / -448, contra esta config; gdino672Macs / gdino448Macs);
   conteos: anchors, vocabSize, logits*Elements. units también marca 'macs' / 'params' donde el nombre no lo dice.
     las dos: backboneMacs/-MacsShare/-Params, neckMacs/-MacsShare/-Params, headMacs/-MacsShare/-Params, boxHeadMacs,
       anchors (A), logitsElements, logitsMem, scaling [{res, anchors, macs}]
     YOLOv8: yoloWorldMacs, yoloWorldParams, yoloWorldToYolov8Macs, detrMacs, detrParams (detr-r50-640), detrToYolov8Macs
     YOLO-World: vocabSize; texto OFFLINE: textEncoderParams (CLIP ViT-B/32 de texto + proyección), promptTextMacs (un
       prompt de 77 tokens), vocabTextMacs (= V·promptTextMacs, una vez por vocabulario), onlineTextMacs (= 0),
       vocabTextToOnline; fusión online: fusionMacs (= maxSigmoidMacs + ipaMacs), fusionMacsShare, tcspMacs,
       tcspMacsShare, regionTextMacs; logitsP3/P4/P5Elements (h·w·V); comparación: yolov8Macs, yolov8Params,
       deltaParamsVsYolov8, deltaMacsVsYolov8, macsVsYolov8, gdinoMacs, gdinoParams, gdinoTextMacs (BERT por imagen),
       gdinoToYoloWorldMacs, detrMacs, detrParams, detrToYoloWorldMacs; vocabScaling [{V, macs, vocabTextMacs, logitsElements}]
     null: attnMem, attnMemAllLayers, scoreMacs, scoreMacsShare, crossoverN… (no hay transformer sobre la imagen)
   actMem (genérica): las compuestas (Conv, C2f, SPPF) no exponen sus intermedios → cota inferior (más baja en YOLOv8,
   que usa C2f compuestos, que en el RepVL-PAN de YOLO-World, dibujado op por op).

   Vista general `yolo-world-overview` — nodos (path[0]): input (tensor x-img) · backbone · neck (RepVL-PAN,
   vista `yw-repvl-pan`) · txt-encoder (offline) · vocab · head-box · head-text · output. YOLOv8: input ·
   backbone · neck · head-box · head-cls · output.
   Ops (id · path · entradas → salida):
     Backbone (op.where ['Backbone (CSPDarknet + C2f)']):
       stem      backbone › stem              x-img → stem-out          (Conv 3×3 s2, 3 → 64)
       s{k}-conv backbone › stage{k} › conv   → s{k}-down              (Conv 3×3 s2; k = 2…5)
       s{k}-c2f  backbone › stage{k} › c2f    → s2-out / c3 / c4 / s5-out   (C2f con atajo; n = 3, 6, 6, 3)
       sppf      backbone › sppf              s5-out → c5               (SPPF, pools 5/9/13)
     Neck (YOLOv8: PAN-FPN; YOLO-World: RepVL-PAN):
       td4-up · td4-cat     neck › td-p4 › upsample / concat     c5 → td4-up; [td4-up, c4] → td4-cat
       td4-c2f (YOLOv8)     neck › td-p4 › c2f                   → p4-td (stride 16)
       td3-up · td3-cat     neck › td-p3 › upsample / concat     p4-td → td3-up; [td3-up, c3] → td3-cat
       td3-c2f (YOLOv8)     neck › td-p3 › c2f                   → p3 (stride 8, salida P3)
       bu4-down · bu4-cat   neck › bu-p4 › downsample / concat   p3 → bu4-down (Conv 3×3 s2); [bu4-down, p4-td] → bu4-cat
       bu4-c2f (YOLOv8)     neck › bu-p4 › c2f                   → p4 (stride 16)
       bu5-down · bu5-cat   neck › bu-p5 › downsample / concat   p4 → bu5-down; [bu5-down, c5] → bu5-cat
       bu5-c2f (YOLOv8)     neck › bu-p5 › c2f                   → p5 (stride 32)
       YOLO-World: en lugar de cada {td4, td3, bu4, bu5}-c2f, el T-CSPLayer (path neck › <nodo> › t-csp › …):
         {L}-tcsp-cv1 (cv1) → {L}-tcsp-cv1 · {L}-tcsp-split (split) → {L}-tcsp-y0, {L}-tcsp-y1 ·
         {L}-tcsp-bottlenecks (bottlenecks, repeat 3, sin atajo) → {L}-tcsp-m ·
         max-sigmoid › {guide: {L}-tg-guide → {L}-tg-guide (V×E) · scores: {L}-tg-scores → {L}-tg-scores
         (n_h×HW×V) · max: {L}-tg-max → {L}-tg-max · gate: {L}-tg-gate → {L}-tg-gate · proj-conv: {L}-tg-proj →
         {L}-tg-proj · modulate: {L}-tg-modulate → {L}-tg-out} ·
         {L}-tcsp-concat (concat) → {L}-tcsp-cat ((3+n)c) · {L}-tcsp-cv2 (cv2) → p4-td / p3 / p4 / p5
         (L = td4, td3, bu4, bu5; los de td4/td3 usan `vocab`, los de bu4/bu5 `vocab-upd`)
       Image-pooling attention (YOLO-World v1; path neck › img-pool-attn › …): ipa-proj-p3/-p4/-p5 (proj) →
         ipa-p3-proj…; ipa-pool-p3/-p4/-p5 (pool) → ipa-p3-pool… (3×3×256) · ipa-tokens (tokens) → ipa-tokens
         (27×256) · ipa-q-ln, ipa-q-proj (q-proj) vocab → ipa-q-ln, ipa-q (V×256) · ipa-k-ln, ipa-k-proj (k-proj) →
         ipa-k-ln, ipa-k · ipa-v-ln, ipa-v-proj (v-proj) → ipa-v-ln, ipa-v · ipa-split (split) → ipa-qh, ipa-kh,
         ipa-vh · ipa-scores (scores) → ipa-scores (8×V×27) · ipa-scale (scale) → ipa-scaled · ipa-softmax
         (softmax) → ipa-attn · ipa-weighted-sum (weighted-sum) → ipa-z-heads · ipa-merge (merge) → ipa-z ·
         ipa-out-proj (out-proj) → ipa-o (V×512) · ipa-res (res) vocab, ipa-o → vocab-upd
     Texto (YOLO-World): entrada prompts (V×77 ids de CLIP) · txt-encoder (txt-encoder) → txt-emb (V×512;
       offline: 0 en el grafo, costo en detail) · vocab-norm (vocab) → vocab (V×512, L2)
     Cabeza por nivel l ∈ {p3, p4, p5}:
       hb-{l}-conv1 · hb-{l}-conv2 · hb-{l}-out   head-box › {l} › conv1 / conv2 / out   → hb-{l}-h1, hb-{l}-h2, boxes-{l} (h×w×4R)
       YOLO-World: ht-{l}-conv1 · ht-{l}-conv2 · ht-{l}-embed (head-text › {l} › conv1 / conv2 / embed) →
         ht-{l}-h1, ht-{l}-h2, obj-emb-{l} (h×w×512) · ht-{l}-sim (head-text › {l} › sim) obj-emb-{l}, vocab →
         sims-{l} (h·w×V) · ht-{l}-scale (head-text › {l} › scale) → logits-{l} (h·w×V)
       YOLOv8: hc-{l}-conv1 · hc-{l}-conv2 · hc-{l}-out (head-cls › {l} › conv1 / conv2 / out) → hc-{l}-h1, hc-{l}-h2,
         logits-{l} (h×w×K)
       dfl     head-box › dfl         boxes-p3, boxes-p4, boxes-p5 → box-dist (A×4)
       decode  output › decode        box-dist → boxes (A×4, xyxy en píxeles)
       scores  output › scores        logits-p3, -p4, -p5 → scores (A×V o A×K, con sigmoide; luego NMS, fuera del modelo)
   Tensores: x-img stem-out s2-down s2-out s3-down c3 s4-down c4 s5-down s5-out c5 · [prompts txt-emb vocab] ·
     td4-up td4-cat p4-td td3-up td3-cat p3 [ipa-…, vocab-upd] bu4-down bu4-cat p4 bu5-down bu5-cat p5 ·
     [{L}-tcsp-cv1 {L}-tcsp-y0 {L}-tcsp-y1 {L}-tcsp-m {L}-tg-guide {L}-tg-scores {L}-tg-max {L}-tg-gate {L}-tg-proj
     {L}-tg-out {L}-tcsp-cat] · hb-{l}-h1 hb-{l}-h2 boxes-{l} · [ht-{l}-h1 ht-{l}-h2 obj-emb-{l} sims-{l} logits-{l}] /
     [hc-{l}-h1 hc-{l}-h2 logits-{l}] · box-dist boxes scores
   Añadidos a SPEC §16.2 (nada renombrado): nodos internos (backbone › stem/stage2…5/sppf; neck › td-p4, td-p3,
   bu-p4, bu-p5, img-pool-attn y sus internos; t-csp › max-sigmoid › …; head-box/head-text/head-cls › p3/p4/p5 ›
   …; head-box › dfl; output › decode/scores), el anclaje `yolov8` usa `head-cls` (no hay texto), tensores
   intermedios (s{k}-down, td…/bu…, sims-…, box-dist, scores, prompts, txt-emb, vocab-upd, ipa-…). `boxes-*` son
   los mapas de distribución DFL por nivel (h×w×4R) y `boxes` las cajas decodificadas (A×4).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('yolo-world.js necesita js/arch/primitives.js antes.');

  // Escala l de yolov8.yaml: [depth, width, max_channels] = [1.00, 1.00, 512].
  const v8l = {
    Cin: 3, widths: [64, 128, 256, 512, 512], depths: [3, 6, 6, 3], neckDepth: 3, regMax: 16, sppfK: 5,
    neckC: { p3: 256, p4: 512, p5: 512 }, ultralytics: '8.4.174',
  };
  // YOLO-World-L (yolov8l-world.yaml): C2fAttn [c2, ec, nh] = [512, 256, 8] (P4), [256, 128, 4] (P3), [512, 256, 8]
  // (P4 bottom-up), [1024 → 512, 512 → 256, 16 → 8] (P5; ec y nh recortados con max_channels 512).
  const world = { E: 512, tcsp: { td4: { ec: 256, nh: 8 }, td3: { ec: 128, nh: 4 }, bu4: { ec: 256, nh: 8 }, bu5: { ec: 256, nh: 8 } },
    ipa: { ec: 256, nh: 8, k: 3 }, textEncoder: 'clip-vit-b32', clipT: 77, withBn: false, version: 'v1' };

  const RES = [320, 480, 640, 960, 1280];
  const LEVELS = [['p3', 8], ['p4', 16], ['p5', 32]];

  function applyKnobs(c, ov, name) {
    const notes = [];
    if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
    if (ov.V !== undefined) c.V = ov.V;
    if (ov.V !== undefined && ov.V !== 80) notes.push('V = ' + ov.V + ' clases en el vocabulario: los parámetros no cambian (las clases son embeddings, no pesos); cambian la guía de texto, la image-pooling attention y los logits (A×V).');
    if (ov.res !== undefined || ov.V !== undefined) c.label = name + ' @ ' + c.H + (c.V !== undefined && c.V !== 80 ? ' · V = ' + c.V : '');
    c._notes = notes;
    return c;
  }

  function resolve(c) {
    if (c.H !== c.W) throw new Error('YOLO: el calculador modela imágenes cuadradas (H = W).');
    if (c.H % 32 !== 0 || c.H < 64) throw new Error('YOLO: la resolución debe ser múltiplo de 32 y al menos 64 (recibí ' + c.H + ').');
    c.res = c.H;
    c.levelShapes = LEVELS.map(([, s]) => [c.H / s, c.W / s]);
    c.A = c.levelShapes.reduce((s, [a, b]) => s + a * b, 0);
    c.tokens = c.A;
    c.boxCh = Math.max(16, c.neckC.p3 / 4, 4 * c.regMax);                 // 64 (Detect: c2)
    c.clsCh = Math.max(c.neckC.p3, Math.min(c.K || 80, 100));            // 256 (Detect / WorldDetect: c3; WorldDetect usa el nc del YAML, 80)
    return c;
  }

  // ------------------------------------------------------------------ utilidades
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const g2 = (s) => ['H/' + s, 'W/' + s];
  const cbs = (x, k, s, cout, os, act) => A.conv_bn_act(x, { k, s, cout, outSym: os, act });

  // ------------------------------------------------------------------ backbone (CSPDarknet con C2f, YOLOv8-L)
  function backbone(g, img, c) {
    const W = ['Backbone (CSPDarknet + C2f)'], TL = 'Backbone · ';
    const w = c.widths;
    const stem = g.op('stem', cbs(img, 3, 2, w[0], g2(2)), {
      path: ['backbone', 'stem'], out: 'stem-out', where: W, label: 'Stem: Conv 3×3 stride 2 (3 → ' + w[0] + ') + BN + SiLU', type: 'conv', group: 'embed',
      outMeta: { label: TL + 'salida del stem (stride 2)', tex: 'x_1' },
    });
    let x = stem;
    const outs = {};
    const names = { 2: 's2-out', 3: 'c3', 4: 'c4', 5: 's5-out' };
    for (let k = 2; k <= 5; k++) {
      const s = Math.pow(2, k), cout = w[k - 1], n = c.depths[k - 2];
      const P = ['backbone', 'stage' + k], Wk = W.concat(['stage ' + k + ' (stride ' + s + ')']);
      x = g.op('s' + k + '-conv', cbs(x, 3, 2, cout, g2(s)), {
        path: P.concat(['conv']), out: 's' + k + '-down', where: Wk, label: 'Conv 3×3 stride 2 (' + x.num[2] + ' → ' + cout + ')', type: 'conv', group: 'embed',
        outMeta: { label: TL + 'stage ' + k + ', tras la conv con stride 2', tex: 'x_{' + k + '}^{\\downarrow}' },
      });
      x = g.op('s' + k + '-c2f', A.c2f(x, { cout, n, shortcut: true }), {
        path: P.concat(['c2f']), out: names[k], where: Wk, label: 'C2f (n = ' + n + ', con atajo; ' + cout + ' canales)', type: 'conv', group: 'embed',
        outMeta: { label: TL + (k === 3 || k === 4 ? 'C' + k + ' (salida del stage ' + k + ', stride ' + s + ')' : 'salida del stage ' + k + ' (stride ' + s + ')'), tex: k === 3 || k === 4 ? 'C_' + k : 'x_{' + k + '}' },
      });
      outs[names[k]] = x;
    }
    outs.c5 = g.op('sppf', A.sppf(x, { cout: w[4], k: c.sppfK }), {
      path: ['backbone', 'sppf'], out: 'c5', where: W, label: 'SPPF (3 max-pool 5×5 encadenados = 5, 9, 13)', type: 'conv', group: 'embed',
      outMeta: { label: TL + 'C5 (salida del SPPF, stride 32)', tex: 'C_5' },
    });
    return outs;
  }

  // ------------------------------------------------------------------ T-CSPLayer (C2fAttn) como ops
  function tCsp(g, x, guide, c, s) {
    const L = s.L, P = ['neck', s.node, 't-csp'], W = ['RepVL-PAN', s.where, 'T-CSPLayer'], tl = 'RepVL-PAN · ' + s.where + ' · T-CSPLayer · ';
    const n = c.neckDepth, cout = s.cout, ch = cout / 2, E = s.ec, nh = s.nh;
    const op = (id, res, inner, extra) => g.op(L + '-' + id, res, Object.assign({ path: P.concat(inner), where: W }, extra));
    const M = (m) => Object.assign({}, m, { label: tl + m.label });
    const os = [x.sym[0], x.sym[1]];
    const cv1 = op('tcsp-cv1', cbs(x, 1, 1, 2 * ch, os), ['cv1'], { out: L + '-tcsp-cv1', label: 'cv1: Conv 1×1 (' + x.num[2] + ' → ' + (2 * ch) + ')', type: 'conv', group: 'embed', outMeta: M({ label: 'tras cv1', tex: 'y' }) });
    const [y0, y1] = op('tcsp-split', A.split_channels(cv1, { parts: 2 }), ['split'], {
      out: [L + '-tcsp-y0', L + '-tcsp-y1'], label: 'Partir en dos mitades de ' + ch, type: 'tensorop', group: 'embed',
      outMeta: [M({ label: 'mitad que pasa directa', tex: 'y_0' }), M({ label: 'mitad que entra a los bottlenecks', tex: 'y_1' })],
    });
    const m = op('tcsp-bottlenecks', A.csp_bottleneck(y1, { shortcut: false }), ['bottlenecks'], {
      out: L + '-tcsp-m', repeat: n, label: 'Bottleneck (2 convs 3×3, sin atajo), ×' + n + ' encadenados', type: 'conv', group: 'embed',
      outMeta: Object.assign(M({ label: 'salida de un bottleneck (la última va a la atención)', tex: 'm_i' }), { perLayer: true }),
    });
    const MS = P.concat(['max-sigmoid']), WM = W.concat(['max-sigmoid']), tm = tl + 'max-sigmoid · ';
    const opm = (id, res, inner, extra) => g.op(L + '-' + id, res, Object.assign({ path: MS.concat(inner), where: WM }, extra));
    const MM = (mm) => Object.assign({}, mm, { label: tm + mm.label });
    let emb = m;
    if (m.num[2] !== E) {
      emb = opm('tg-embed', cbs(m, 1, 1, E, os, 'none'), ['embed'], { out: L + '-tg-embed', label: 'Conv 1×1 al ancho de la guía (' + m.num[2] + ' → ' + E + ')', type: 'conv', group: 'attn', outMeta: MM({ label: 'embedding de la imagen', tex: 'e' }) });
    }
    const gd = opm('tg-guide', A.linear(guide, { dout: E, doutSym: String(E) }), ['guide'], { out: L + '-tg-guide', label: 'Guía de texto: Linear 512 → ' + E + ' sobre los V embeddings', type: 'embed', group: 'attn', outMeta: MM({ label: 'texto proyectado (una fila por clase)', tex: 'W_g\\,t' }) });
    const sc = opm('tg-scores', A.text_guided_scores(emb, gd, { nh, hwSym: os[0] + '·' + os[1] }), ['scores'], { out: L + '-tg-scores', label: 'Scores píxel × clase por cabeza (' + nh + ' cabezas de ' + (E / nh) + ')', type: 'attn', group: 'attn', outMeta: MM({ label: 'similitud de cada píxel con cada clase', tex: 'e\\cdot (W_g t)^\\top' }) });
    const mx = opm('tg-max', A.max_over_text(sc), ['max'], { out: L + '-tg-max', label: 'Máximo sobre las V clases', type: 'attn', group: 'attn', outMeta: MM({ label: 'máxima similitud de cada píxel', tex: '\\max_V' }) });
    const gt = opm('tg-gate', A.maxsig_gate(mx, { nh, hc: E / nh }), ['gate'], { out: L + '-tg-gate', label: 'σ(max/√c_h + b_h): peso por píxel y cabeza', type: 'attn', group: 'attn', outMeta: MM({ label: 'peso por píxel (0–1)', tex: '\\sigma(\\max/\\sqrt{c_h} + b)' }) });
    const pj = opm('tg-proj', cbs(m, 3, 1, ch, os, 'none'), ['proj-conv'], { out: L + '-tg-proj', label: 'Conv 3×3 (' + ch + ' → ' + ch + ', BN, sin activación)', type: 'conv', group: 'attn', outMeta: MM({ label: 'rama a modular', tex: 'f' }) });
    const at = opm('tg-modulate', A.head_modulate(pj, gt, { nh }), ['modulate'], { out: L + '-tg-out', label: 'Multiplicar cada cabeza por su peso', type: 'attn', group: 'attn', outMeta: MM({ label: 'salida de la max-sigmoid attention', tex: 'f\\odot w' }) });
    const cat = op('tcsp-concat', A.concat_channels([y0, y1, m, at], { mult: [1, 1, n, 1] }), ['concat'], { out: L + '-tcsp-cat', label: 'Concatenar las ' + (3 + n) + ' ramas ((3+n)·' + ch + ')', type: 'tensorop', group: 'embed', outMeta: M({ label: 'ramas concatenadas', tex: '[y_0, y_1, m_1..m_n, f\\odot w]' }) });
    return op('tcsp-cv2', cbs(cat, 1, 1, cout, os), ['cv2'], { out: s.outId, label: 'cv2: Conv 1×1 (' + cat.num[2] + ' → ' + cout + ')', type: 'conv', group: 'embed', outMeta: s.outMeta });
  }

  // ------------------------------------------------------------------ image-pooling attention (v1)
  function ipaOps(g, feats, vocab, c) {
    const P = ['neck', 'img-pool-attn'], W = ['RepVL-PAN', 'image-pooling attention'], tl = 'Image-pooling attention · ';
    const E = world.ipa.ec, nh = world.ipa.nh, k = world.ipa.k;
    const op = (id, res, inner, extra) => g.op(id, res, Object.assign({ path: P.concat([inner]), where: W }, extra));
    const M = (m) => Object.assign({}, m, { label: tl + m.label });
    const pooled = feats.map(([lvl, f]) => {
      const pj = op('ipa-proj-' + lvl, A.conv2d(f, { k: 1, cout: E, coutSym: String(E), outSym: [f.sym[0], f.sym[1]] }), 'proj', { out: 'ipa-' + lvl + '-proj', label: 'Conv 1×1 de ' + lvl.toUpperCase() + ' (' + f.num[2] + ' → ' + E + ', con sesgo)', type: 'conv', group: 'attn', outMeta: M({ label: lvl.toUpperCase() + ' proyectado', tex: 'W_' + lvl[1] + ' * ' + lvl.toUpperCase() }) });
      return op('ipa-pool-' + lvl, A.adaptive_max_pool(pj, { k }), 'pool', { out: 'ipa-' + lvl + '-pool', label: 'Max-pool adaptativo a ' + k + '×' + k, type: 'tensorop', group: 'attn', outMeta: M({ label: lvl.toUpperCase() + ' resumido en ' + k + '×' + k, tex: '\\mathrm{pool}' }) });
    });
    const tok = op('ipa-tokens', A.flatten_levels(pooled, { sym: [String(k * k * feats.length), String(E)] }), 'tokens', { out: 'ipa-tokens', label: 'Aplanar: ' + (k * k * feats.length) + ' tokens de imagen', type: 'tensorop', group: 'attn', outMeta: M({ label: 'tokens de imagen (3×3 por nivel)', tex: 'X' }) });
    const qn = op('ipa-q-ln', A.layernorm(vocab), 'q-proj', { out: 'ipa-q-ln', label: 'LayerNorm del texto', type: 'norm', group: 'norm', outMeta: M({ label: 'texto normalizado', tex: '\\mathrm{LN}(t)' }) });
    const q = op('ipa-q-proj', A.linear(qn, { dout: E, doutSym: String(E) }), 'q-proj', { out: 'ipa-q', label: 'Q desde el texto (Linear 512 → ' + E + ')', type: 'embed', group: 'attn', outMeta: M({ label: 'Q (una por clase)', tex: 'Q' }) });
    const kn = op('ipa-k-ln', A.layernorm(tok), 'k-proj', { out: 'ipa-k-ln', label: 'LayerNorm de los tokens (para K)', type: 'norm', group: 'norm', outMeta: M({ label: 'tokens normalizados (K)', tex: '\\mathrm{LN}_K(X)' }) });
    const kk = op('ipa-k-proj', A.linear(kn, { dout: E, doutSym: String(E) }), 'k-proj', { out: 'ipa-k', label: 'K desde la imagen (Linear ' + E + ' → ' + E + ')', type: 'embed', group: 'attn', outMeta: M({ label: 'K (27 tokens)', tex: 'K' }) });
    const vn = op('ipa-v-ln', A.layernorm(tok), 'v-proj', { out: 'ipa-v-ln', label: 'LayerNorm de los tokens (para V)', type: 'norm', group: 'norm', outMeta: M({ label: 'tokens normalizados (V)', tex: '\\mathrm{LN}_V(X)' }) });
    const v = op('ipa-v-proj', A.linear(vn, { dout: E, doutSym: String(E) }), 'v-proj', { out: 'ipa-v', label: 'V desde la imagen (Linear ' + E + ' → ' + E + ')', type: 'embed', group: 'attn', outMeta: M({ label: 'V (27 tokens)', tex: 'V' }) });
    const [qh, kh, vh] = op('ipa-split', A.split_qkv_heads(q, kk, v, { h: nh, hSym: String(nh), dhSym: String(E / nh) }), 'split', {
      out: ['ipa-qh', 'ipa-kh', 'ipa-vh'], label: 'Separar en ' + nh + ' cabezas', type: 'tensorop', group: 'attn',
      outMeta: [M({ label: 'Q por cabeza', tex: 'Q' }), M({ label: 'K por cabeza', tex: 'K' }), M({ label: 'V por cabeza', tex: 'V' })],
    });
    const sc = op('ipa-scores', A.attention_scores(qh, kh), 'scores', { out: 'ipa-scores', label: 'Scores clase × token de imagen', type: 'attn', group: 'attn', outMeta: M({ label: 'scores (V×27 por cabeza)', tex: 'QK^\\top' }) });
    const sl = op('ipa-scale', A.scale(sc), 'scale', { out: 'ipa-scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: M({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const sm = op('ipa-softmax', A.softmax(sl), 'softmax', { out: 'ipa-attn', label: 'Softmax sobre los 27 tokens', type: 'attn', group: 'attn', outMeta: M({ label: 'pesos de atención', tex: 'A' }) });
    const ws = op('ipa-weighted-sum', A.attention_weighted_sum(sm, vh), 'weighted-sum', { out: 'ipa-z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: M({ label: 'salida por cabeza', tex: 'AV' }) });
    const mg = op('ipa-merge', A.merge_heads(ws, { Dsym: String(E) }), 'merge', { out: 'ipa-z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: M({ label: 'cabezas concatenadas', tex: 'Z' }) });
    const o = op('ipa-out-proj', A.linear(mg, { dout: vocab.num[1], doutSym: vocab.sym[1] }), 'out-proj', { out: 'ipa-o', label: 'Proyección de salida (' + E + ' → 512)', type: 'embed', group: 'attn', outMeta: M({ label: 'actualización del texto', tex: '\\Delta t' }) });
    return op('ipa-res', A.residual_add(vocab, o), 'res', { out: 'vocab-upd', label: 'Residual: texto + actualización (escala 1)', type: 'tensorop', group: 'resid', outMeta: { label: 'Vocabulario actualizado con la imagen (guía del bottom-up)', tex: "t' = t + \\Delta t" } });
  }

  // ------------------------------------------------------------------ neck (PAN-FPN / RepVL-PAN)
  function neck(g, bb, vocab, c, isWorld) {
    const N = c.neckC, n = c.neckDepth;
    const WN = isWorld ? 'RepVL-PAN' : 'Neck (PAN-FPN)';
    const TL = isWorld ? 'RepVL-PAN · ' : 'Neck · ';
    const fuse = (L, node, where, x, guide, cout, outId, outMeta) => {
      if (!isWorld) {
        return g.op(L + '-c2f', A.c2f(x, { cout, n, shortcut: false }), {
          path: ['neck', node, 'c2f'], out: outId, where: [WN, where], label: 'C2f (n = ' + n + ', sin atajo; ' + x.num[2] + ' → ' + cout + ')', type: 'conv', group: 'embed', outMeta,
        });
      }
      const t = world.tcsp[L];
      return tCsp(g, x, guide, c, { L, node, where, cout, ec: t.ec, nh: t.nh, outId, outMeta });
    };
    const up = (id, x, s, node, where) => g.op(id + '-up', A.upsample_nearest(x, { s: 2, outSym: g2(s) }), {
      path: ['neck', node, 'upsample'], out: id + '-up', where: [WN, where], label: 'Upsample ×2 (nearest)', type: 'tensorop', group: 'embed',
      outMeta: { label: TL + where + ' · mapa subido ×2', tex: '\\uparrow' },
    });
    const cat = (id, a, b, node, where) => g.op(id + '-cat', A.concat_channels([a, b]), {
      path: ['neck', node, 'concat'], out: id + '-cat', where: [WN, where], label: 'Concatenar canales (' + a.num[2] + ' + ' + b.num[2] + ')', type: 'tensorop', group: 'embed',
      outMeta: { label: TL + where + ' · concatenación', tex: '[\\cdot\\,;\\cdot]' },
    });
    const down = (id, x, s, node, where) => g.op(id + '-down', cbs(x, 3, 2, x.num[2], g2(s)), {
      path: ['neck', node, 'downsample'], out: id + '-down', where: [WN, where], label: 'Conv 3×3 stride 2 (' + x.num[2] + ' → ' + x.num[2] + ')', type: 'conv', group: 'embed',
      outMeta: { label: TL + where + ' · mapa bajado ×2', tex: '\\downarrow' },
    });
    const wTd4 = 'top-down P4 (stride 16)', wTd3 = 'top-down P3 (stride 8)', wBu4 = 'bottom-up P4 (stride 16)', wBu5 = 'bottom-up P5 (stride 32)';
    const p4td = fuse('td4', 'td-p4', wTd4, cat('td4', up('td4', bb.c5, 16, 'td-p4', wTd4), bb.c4, 'td-p4', wTd4), vocab, N.p4, 'p4-td',
      { label: TL + 'P4 del camino top-down (stride 16)', tex: 'P_4^{\\mathrm{td}}' });
    const p3 = fuse('td3', 'td-p3', wTd3, cat('td3', up('td3', p4td, 8, 'td-p3', wTd3), bb.c3, 'td-p3', wTd3), vocab, N.p3, 'p3',
      { label: TL + 'P3 (salida, stride 8)', tex: 'P_3' });
    let guide = vocab;
    if (isWorld) guide = ipaOps(g, [['p3', p3], ['p4', p4td], ['p5', bb.c5]], vocab, c);
    const p4 = fuse('bu4', 'bu-p4', wBu4, cat('bu4', down('bu4', p3, 16, 'bu-p4', wBu4), p4td, 'bu-p4', wBu4), guide, N.p4, 'p4',
      { label: TL + 'P4 (salida, stride 16)', tex: 'P_4' });
    const p5 = fuse('bu5', 'bu-p5', wBu5, cat('bu5', down('bu5', p4, 32, 'bu-p5', wBu5), bb.c5, 'bu-p5', wBu5), guide, N.p5, 'p5',
      { label: TL + 'P5 (salida, stride 32)', tex: 'P_5' });
    return { p3, p4, p5 };
  }

  // ------------------------------------------------------------------ cabezas
  function heads(g, feats, vocab, c, isWorld) {
    const boxLv = [], clsLv = [];
    for (const [lvl, s] of LEVELS) {
      const x = feats[lvl], os = g2(s), up = lvl.toUpperCase();
      const BW = ['Cabeza de cajas', up], BL = 'Cabeza de cajas · ' + up + ' · ';
      const bp = ['head-box', lvl];
      const h1 = g.op('hb-' + lvl + '-conv1', cbs(x, 3, 1, c.boxCh, os), { path: bp.concat(['conv1']), out: 'hb-' + lvl + '-h1', where: BW, label: 'Conv 3×3 (' + x.num[2] + ' → ' + c.boxCh + ')', type: 'conv', group: 'head', outMeta: { label: BL + 'capa 1', tex: 'u_1' } });
      const h2 = g.op('hb-' + lvl + '-conv2', cbs(h1, 3, 1, c.boxCh, os), { path: bp.concat(['conv2']), out: 'hb-' + lvl + '-h2', where: BW, label: 'Conv 3×3 (' + c.boxCh + ' → ' + c.boxCh + ')', type: 'conv', group: 'head', outMeta: { label: BL + 'capa 2', tex: 'u_2' } });
      boxLv.push(g.op('hb-' + lvl + '-out', A.conv2d(h2, { k: 1, cout: 4 * c.regMax, coutSym: '4R', outSym: os }), {
        path: bp.concat(['out']), out: 'boxes-' + lvl, where: BW, label: 'Conv 1×1 → 4·R = ' + (4 * c.regMax) + ' (distribución DFL por lado)', type: 'head', group: 'head',
        outMeta: { label: BL + 'distribución de cada lado de la caja (4 lados × R = ' + c.regMax + ' bins = ' + (4 * c.regMax) + ' canales)', tex: 'p(l, t, r, b)' },
      }));
      if (isWorld) {
        const TW = ['Cabeza región-texto', up], TLb = 'Cabeza región-texto · ' + up + ' · ', tp = ['head-text', lvl];
        const t1 = g.op('ht-' + lvl + '-conv1', cbs(x, 3, 1, c.clsCh, os), { path: tp.concat(['conv1']), out: 'ht-' + lvl + '-h1', where: TW, label: 'Conv 3×3 (' + x.num[2] + ' → ' + c.clsCh + ')', type: 'conv', group: 'head', outMeta: { label: TLb + 'capa 1', tex: 'u_1' } });
        const t2 = g.op('ht-' + lvl + '-conv2', cbs(t1, 3, 1, c.clsCh, os), { path: tp.concat(['conv2']), out: 'ht-' + lvl + '-h2', where: TW, label: 'Conv 3×3 (' + c.clsCh + ' → ' + c.clsCh + ')', type: 'conv', group: 'head', outMeta: { label: TLb + 'capa 2', tex: 'u_2' } });
        const em = g.op('ht-' + lvl + '-embed', A.conv2d(t2, { k: 1, cout: c.E, coutSym: '512', outSym: os }), { path: tp.concat(['embed']), out: 'obj-emb-' + lvl, where: TW, label: 'Conv 1×1 → embedding de 512 por celda', type: 'head', group: 'head', outMeta: { label: TLb + 'embedding de objeto de cada celda', tex: 'e' } });
        const sm = g.op('ht-' + lvl + '-sim', A.region_text_similarity(em, vocab, { hwSym: os[0] + '·' + os[1] }), { path: tp.concat(['sim']), out: 'sims-' + lvl, where: TW, label: 'Coseno celda × clase (L2 de los dos lados)', type: 'fuse', group: 'head', outMeta: { label: TLb + 'similitud coseno celda × clase', tex: '\\hat e\\,\\hat t^\\top' } });
        clsLv.push(g.op('ht-' + lvl + '-scale', A.scale_bias(sm), { path: tp.concat(['scale']), out: 'logits-' + lvl, where: TW, label: 'Escala e^s y sesgo b aprendidos', type: 'head', group: 'head', outMeta: { label: TLb + 'logits celda × clase', tex: 'e^{s}\\,\\hat e\\,\\hat t^\\top + b' } }));
      } else {
        const CW = ['Cabeza de clases', up], CL = 'Cabeza de clases · ' + up + ' · ', cp = ['head-cls', lvl];
        const t1 = g.op('hc-' + lvl + '-conv1', cbs(x, 3, 1, c.clsCh, os), { path: cp.concat(['conv1']), out: 'hc-' + lvl + '-h1', where: CW, label: 'Conv 3×3 (' + x.num[2] + ' → ' + c.clsCh + ')', type: 'conv', group: 'head', outMeta: { label: CL + 'capa 1', tex: 'u_1' } });
        const t2 = g.op('hc-' + lvl + '-conv2', cbs(t1, 3, 1, c.clsCh, os), { path: cp.concat(['conv2']), out: 'hc-' + lvl + '-h2', where: CW, label: 'Conv 3×3 (' + c.clsCh + ' → ' + c.clsCh + ')', type: 'conv', group: 'head', outMeta: { label: CL + 'capa 2', tex: 'u_2' } });
        clsLv.push(g.op('hc-' + lvl + '-out', A.conv2d(t2, { k: 1, cout: c.K, coutSym: 'K', outSym: os }), { path: cp.concat(['out']), out: 'logits-' + lvl, where: CW, label: 'Conv 1×1 → K = ' + c.K + ' clases fijas', type: 'head', group: 'head', outMeta: { label: CL + 'logits por celda (K clases fijas)', tex: 'z' } }));
      }
    }
    const dist = g.op('dfl', A.dfl_decode(boxLv, { R: c.regMax, Asym: 'A' }), {
      path: ['head-box', 'dfl'], out: 'box-dist', where: ['Cabeza de cajas'], label: 'DFL: softmax sobre R = 16 bins y esperanza (conv 1×1 de pesos fijos)', type: 'head', group: 'head',
      outMeta: { label: 'Cabeza de cajas · distancias (l, t, r, b) de cada una de las A = ' + c.A + ' celdas', tex: '\\mathbb{E}[d]' },
    });
    const boxes = g.op('decode', A.dist2bbox(dist), {
      path: ['output', 'decode'], out: 'boxes', where: ['Salida'], label: 'Distancias → cajas (centro de la celda ± d, × stride)', type: 'head', group: 'head',
      outMeta: { label: 'Cajas por celda (xyxy en píxeles; A = ' + c.A + ' celdas)', tex: '\\hat b' },
    });
    const scores = g.op('scores', A.merge_level_logits(clsLv, { Asym: 'A', Ksym: isWorld ? 'V' : 'K' }), {
      path: ['output', 'scores'], out: 'scores', where: ['Salida'], label: 'Unir los 3 niveles y sigmoide (después: NMS, fuera del modelo)', type: 'head', group: 'head',
      outMeta: { label: 'Scores por celda y clase (A = ' + c.A + ' celdas)', tex: '\\sigma(z)' },
    });
    return { boxes, scores };
  }

  // Costo del codificador de texto de CLIP ViT-B/32 (torre de texto + proyección), por prompt de 77 tokens.
  function clipText() {
    try {
      const r = A.run(world.textEncoder);
      const n = r.totals.byNode;
      return { params: n['txt-encoder'].params + n['txt-proj'].params, macs: n['txt-encoder'].macs + n['txt-proj'].macs, T: r.config.T, E: r.config.E };
    } catch (e) { return { params: 0, macs: 0, T: world.clipT, E: world.E }; }
  }

  // Reparto de MACs (los dos modelos).
  function split(r) {
    const n = r.totals.byNode, t = r.totals.macs;
    const head = (n['head-box'] ? n['head-box'].macs : 0) + (n['head-text'] ? n['head-text'].macs : 0) + (n['head-cls'] ? n['head-cls'].macs : 0);
    return {
      backboneMacs: n.backbone.macs, backboneMacsShare: n.backbone.macs / t, neckMacs: n.neck.macs, neckMacsShare: n.neck.macs / t,
      headMacs: head, headMacsShare: head / t, boxHeadMacs: n['head-box'].macs,
      backboneParams: n.backbone.params, neckParams: n.neck.params, headParams: (n['head-box'] ? n['head-box'].params : 0) + (n['head-text'] ? n['head-text'].params : 0) + (n['head-cls'] ? n['head-cls'].params : 0),
    };
  }
  const ref = (id, ov) => { try { return A.run(id, ov); } catch (e) { return null; } };

  // ------------------------------------------------------------------ YOLOv8 (ancla)
  A.defineModel({
    id: 'yolov8',
    label: 'YOLOv8',
    paper: {
      title: 'Ultralytics YOLOv8', authors: 'Jocher, Chaurasia y Qiu (Ultralytics)', venue: 'software (sin paper)', year: 2023,
      url: 'https://github.com/ultralytics/ultralytics', code: 'github.com/ultralytics/ultralytics',
    },
    configs: {
      'yolov8l-640': Object.assign({}, v8l, { label: 'YOLOv8-L @ 640', H: 640, W: 640, K: 80, canonical: true,
        source: 'Ultralytics yolov8.yaml, escala l (depth 1.0, width 1.0, max_channels 512); cross-check Ultralytics 8.4.174 DetectionModel("yolov8l.yaml") sin pesos. Ultralytics reporta 43.7M parámetros y 165.2 GFLOPs (= 2 × MACs) a 640' }),
    },
    knobs: { res: RES.slice() },
    applyKnobs(c, ov) { return applyKnobs(c, ov, 'YOLOv8-L'); },
    resolve(c) { return resolve(c); },
    build(c, A) {
      const g = A.graph(c);
      const img = g.input('x-img', shp(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const bb = backbone(g, img, c);
      const nk = neck(g, bb, null, c, false);
      heads(g, nk, null, c, false);
      return g;
    },
    quantities(c, r) {
      const s = split(r);
      const q = { tokens: c.A, anchors: c.A, res: c.H, K: c.K, R: c.regMax, boxCh: c.boxCh, clsCh: c.clsCh,
        backboneParams: s.backboneParams, backboneMacs: s.backboneMacs, neckParams: s.neckParams, neckMacs: s.neckMacs,
        headParams: s.headParams, headMacs: s.headMacs, dflParams: r.totals.byPath['head-box>dfl'].params,
        clsHeadParams: r.totals.byNode['head-cls'].params, boxHeadParams: r.totals.byNode['head-box'].params };
      c.levelShapes.forEach(([a, b], i) => { q['p' + (i + 3) + 'Cells'] = a * b; q['p' + (i + 3) + 'Side'] = a; });
      return q;
    },
    metrics(c, r, o) {
      const t = r.totals;
      const out = Object.assign({ crossoverN: null, crossoverNProj: null, scoreToLinear: null, attnMem: null, attnMemAllLayers: null, scoreMacs: null, scoreMacsShare: null },
        split(r), { anchors: c.A, logitsElements: c.A * c.K, logitsMem: c.A * c.K * o.by * o.B, units: UNITS });
      const yw = ref('yolo-world-l-640', { res: c.H }), detr = ref('detr-r50-640');
      if (yw) Object.assign(out, { yoloWorldMacs: yw.totals.macs, yoloWorldParams: yw.totals.params, yoloWorldToYolov8Macs: yw.totals.macs / t.macs });
      if (detr) Object.assign(out, { detrMacs: detr.totals.macs, detrParams: detr.totals.params, detrToYolov8Macs: detr.totals.macs / t.macs });
      out.scaling = RES.map((res) => { const m = A.run(r.id, { res }); return { res, anchors: m.config.A, macs: m.totals.macs }; });
      return out;
    },
  });

  // ------------------------------------------------------------------ YOLO-World
  A.defineModel({
    id: 'yolo-world',
    label: 'YOLO-World',
    paper: {
      title: 'YOLO-World: Real-Time Open-Vocabulary Object Detection', authors: 'Cheng et al.', venue: 'CVPR 2024', year: 2024,
      arxiv: '2401.17270', code: 'github.com/AILab-CVC/YOLO-World',
    },
    configs: {
      'yolo-world-l-640': Object.assign({}, v8l, world, { label: 'YOLO-World-L @ 640 (V = 80)', H: 640, W: 640, V: 80, canonical: true,
        source: 'Cheng et al. 2024 (YOLO-World-L: backbone YOLOv8-L, RepVL-PAN con T-CSPLayers e image-pooling attention, cabeza contrastiva región-texto, CLIP ViT-B/32 de texto offline); Ultralytics yolov8-world.yaml escala l; cross-check Ultralytics 8.4.174 WorldModel("yolov8l-world.yaml") sin pesos ni CLIP' }),
    },
    knobs: { res: RES.slice(), V: [1, 20, 80, 365, 1203] },
    applyKnobs(c, ov) { return applyKnobs(c, ov, 'YOLO-World-L'); },
    resolve(c) { return resolve(c); },
    build(c, A) {
      const g = A.graph(c);
      const img = g.input('x-img', shp(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const ct = clipText();
      const prompts = g.input('prompts', shp(['V', String(world.clipT)], [c.V, world.clipT], 'txt', 'seq'), { label: 'Vocabulario · V prompts de texto (ids BPE de CLIP, 77 tokens)', tex: '\\{\\text{clase}_v\\}' });
      const te = g.op('txt-encoder', A.offline_text_encoder(prompts, { E: c.E, Esym: '512', model: 'CLIP ViT-B/32 (torre de texto)', params: ct.params, macsPerPrompt: ct.macs }), {
        path: ['txt-encoder'], out: 'txt-emb', where: ['Texto (offline)'], label: 'Codificador de texto CLIP ViT-B/32 (OFFLINE: una vez por vocabulario; 0 en el costo online)', type: 'embed', group: 'embed',
        outMeta: { label: 'Vocabulario · embeddings de CLIP (offline)', tex: 'f_T(\\cdot)' },
      });
      const vocab = g.op('vocab-norm', A.l2_normalize(te), {
        path: ['vocab'], out: 'vocab', where: ['Texto (offline)'], label: 'Normalización L2 (offline): el vocabulario queda como V×512 "pesos"', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Vocabulario · V embeddings de texto normalizados', tex: 't' },
      });
      const bb = backbone(g, img, c);
      const nk = neck(g, bb, vocab, c, true);
      heads(g, nk, vocab, c, true);
      return g;
    },
    quantities(c, r) {
      const s = split(r), n = r.totals.byNode, by = r.totals.byPath, ct = clipText();
      const tcsp = r.ops.filter((o) => o.path[0] === 'neck' && o.path[2] === 't-csp');
      const ms = tcsp.filter((o) => o.path[3] === 'max-sigmoid');
      const sumP = (ops) => ops.reduce((a, o) => a + o.params * o.repeat, 0), sumM = (ops) => ops.reduce((a, o) => a + o.macs * o.repeat, 0);
      const q = { tokens: c.A, anchors: c.A, res: c.H, V: c.V, E: c.E, R: c.regMax, boxCh: c.boxCh, clsCh: c.clsCh,
        backboneParams: s.backboneParams, backboneMacs: s.backboneMacs, neckParams: s.neckParams, neckMacs: s.neckMacs,
        headParams: s.headParams, headMacs: s.headMacs, textHeadParams: n['head-text'].params, boxHeadParams: n['head-box'].params,
        tcspParams: sumP(tcsp), tcspMacs: sumM(tcsp), maxSigmoidParams: sumP(ms), maxSigmoidMacs: sumM(ms),
        ipaParams: by['neck>img-pool-attn'].params, ipaMacs: by['neck>img-pool-attn'].macs,
        contrastiveHeadParams: r.ops.filter((o) => o.prim === 'scale_bias').reduce((a, o) => a + o.params, 0),
        textEncoderParams: ct.params, promptTextMacs: ct.macs, vocabTextMacs: c.V * ct.macs, clipT: ct.T,
        // v2 (yolov8l-worldv2.yaml): sin image-pooling attention y con BN en la cabeza contrastiva (BNContrastiveHead:
        // +2·512 por nivel; conserva bias y logit_scale, como la cabeza de v1).
        v2Params: r.totals.params - by['neck>img-pool-attn'].params + 3 * 2 * c.E,
      };
      c.levelShapes.forEach(([a, b], i) => { q['p' + (i + 3) + 'Cells'] = a * b; q['p' + (i + 3) + 'Side'] = a; q['logitsP' + (i + 3) + 'Elements'] = a * b * c.V; });
      return q;
    },
    // metrics(): costo del texto (offline, una vez por vocabulario) frente al online, fusión texto-imagen,
    // logits por nivel y comparación con YOLOv8-L, Grounding DINO y DETR.
    metrics(c, r, o) {
      const t = r.totals, q = r.quantities, by = o.by, B = o.B;
      const fusion = q.maxSigmoidMacs + q.ipaMacs;
      const out = Object.assign({ crossoverN: null, crossoverNProj: null, scoreToLinear: null, attnMem: null, attnMemAllLayers: null, scoreMacs: null, scoreMacsShare: null },
        split(r), {
          anchors: c.A, vocabSize: c.V,
          // texto: CLIP ViT-B/32 una vez por vocabulario (offline); online = 0
          textEncoderParams: q.textEncoderParams, promptTextMacs: q.promptTextMacs, vocabTextMacs: q.vocabTextMacs,
          onlineTextMacs: 0, vocabTextToOnline: q.vocabTextMacs / t.macs,
          // fusión texto-imagen online: max-sigmoid de los 4 T-CSPLayers + image-pooling attention
          fusionMacs: fusion, fusionMacsShare: fusion / t.macs, maxSigmoidMacs: q.maxSigmoidMacs, ipaMacs: q.ipaMacs,
          tcspMacs: q.tcspMacs, tcspMacsShare: q.tcspMacs / t.macs,
          // logits por nivel (HW×V) y en total (A×V)
          logitsP3Elements: q.logitsP3Elements, logitsP4Elements: q.logitsP4Elements, logitsP5Elements: q.logitsP5Elements,
          logitsElements: c.A * c.V, logitsMem: c.A * c.V * by * B, regionTextMacs: r.ops.filter((x) => x.prim === 'region_text_similarity').reduce((a, x) => a + x.macs, 0),
          units: UNITS,
        });
      const y8 = ref('yolov8l-640', { res: c.H }), gd = ref('grounding-dino-t'), detr = ref('detr-r50-640');
      if (y8) Object.assign(out, { yolov8Macs: y8.totals.macs, yolov8Params: y8.totals.params, deltaParamsVsYolov8: t.params - y8.totals.params, deltaMacsVsYolov8: t.macs - y8.totals.macs, macsVsYolov8: t.macs / y8.totals.macs });
      if (gd) {
        const gt = gd.totals.byNode['txt-backbone'].macs + gd.totals.byNode['txt-proj'].macs;
        Object.assign(out, { gdinoMacs: gd.totals.macs, gdinoParams: gd.totals.params, gdinoTextMacs: gt, gdinoToYoloWorldMacs: gd.totals.macs / t.macs });
      }
      // Grounding DINO-T a escala parecida (mismo modelo): 672×672 ≈ la resolución de YOLO-World-L @ 640; 448×448 ≈ sus MACs.
      const gd672 = ref('grounding-dino-t-672'), gd448 = ref('grounding-dino-t-448');
      if (gd672) Object.assign(out, { gdino672Macs: gd672.totals.macs, gdino672ToYoloWorldMacs: gd672.totals.macs / t.macs });
      if (gd448) Object.assign(out, { gdino448Macs: gd448.totals.macs, gdino448ToYoloWorldMacs: gd448.totals.macs / t.macs });
      if (detr) Object.assign(out, { detrMacs: detr.totals.macs, detrParams: detr.totals.params, detrToYoloWorldMacs: detr.totals.macs / t.macs });
      out.vocabScaling = [1, 20, 80, 365, 1203].map((V) => {
        const m = V === c.V ? r : A.run(r.id, { V, res: c.H });
        return { V, macs: m.totals.macs, vocabTextMacs: V * q.promptTextMacs, logitsElements: c.A * V };
      });
      out.scaling = RES.map((res) => { const m = A.run(r.id, { res, V: c.V }); return { res, anchors: m.config.A, macs: m.totals.macs }; });
      return out;
    },
  });

  const UNITS = { anchors: 'count', vocabSize: 'count', logitsElements: 'count', logitsP3Elements: 'count', logitsP4Elements: 'count', logitsP5Elements: 'count',
    vocabTextToOnline: 'ratio', macsVsYolov8: 'ratio', gdinoToYoloWorldMacs: 'ratio', detrToYoloWorldMacs: 'ratio', yoloWorldToYolov8Macs: 'ratio', detrToYolov8Macs: 'ratio',
    gdino672ToYoloWorldMacs: 'ratio', gdino448ToYoloWorldMacs: 'ratio', gdino672Macs: 'macs', gdino448Macs: 'macs', gdinoMacs: 'macs', gdinoTextMacs: 'macs',
    deltaMacsVsYolov8: 'macs', deltaParamsVsYolov8: 'params' };
})(typeof window !== 'undefined' ? window : globalThis);
