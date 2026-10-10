/* =============================================================================
   Atlas de Arquitecturas — js/arch/perception.js
   Fase 14 (SPEC §26). Tesis: percepción para un robot = detección + tiempo + geometría. Tres modelos:
     `bytetrack` (página bytetrack): SORT / ByteTrack — Kalman + asignación sobre las detecciones de un detector.
     `depth`     (página depth):     DPT / Depth Anything V2 — encoder ViT + cabeza densa que re-ensambla tokens en 4 escalas.
     `pointnet`  (página pointnet):  PointNet / PointNet++ — MLP compartido por punto + max-pool simétrico.
   Cargar DESPUÉS de yolo-world.js (detector yolov8l-640), llm.js (H100) y vla.js (Jetson AGX Orin). Contrato de ids:
   scratchpad build14/arch-ids.md (copiado aquí abajo, resumido). Cross-check: crosscheck/perception.py.

   ---------------------------------------------------------------- bytetrack (grafo POR FRAME)
   Configs: bytetrack-mot17 (canónica), sort, bytetrack-ultralytics. Knobs: nDet (detecciones con score > 0.1 por frame),
   nTracks (tracks del pool: tracked + lost; todos se predicen), fps, lowPct (% de nDet con score bajo; DESVIACIÓN de §26:
   lowFrac → lowPct porque los knobs son enteros). Defaults (carga de referencia elegida aquí): nDet 50, nTracks 50, lowPct 20,
   fps 30. Modelo de asociación (≈ cota superior de emparejamientos): D_h = nDet − D_l, D_l = round(nDet·lowPct/100);
   m₁ = min(T, D_h); r = T − m₁; m₂ = min(r, D_l) (solo ByteTrack); U = m₁ + m₂ tracks corregidos; nacen D_h − m₁.
   Ops: detector (detector) frame → dets · split-score (split) → dets-high, dets-low · kalman-predict (tracker › predict)
   track-mean, track-cov → pred-mean, pred-cov · iou-1 / cost-1 / assign-1 (tracker › assoc-1 › iou | cost | assign) →
   iou-1, cost-1, matches-1 · iou-2 / cost-2 / assign-2 (tracker › assoc-2 › …; no en sort ni si r = 0 o D_l = 0) ·
   kalman-update (tracker › update) → track-mean-new · track-manage (tracker › manage) → tracks-out.
   totals: params = los del detector (el tracker no tiene parámetros aprendidos); MACs = detector + productos de matrices del
   Kalman (las matmuls 8×8 SÍ son MACs); IoU, costos, asignación y gestión en "otros" (≈). byNode.tracker = solo el tracker.
   Tracker frente al detector, todo en FLOPs: trackerFlops = 2 × MACs del Kalman, trackerOtherOps = "otros" del tracker (≈, 1 op
   ≈ 1 FLOP), trackerOps = trackerFlops + trackerOtherOps; trackerShare = trackerOps / detectorFlops (= 2 × MACs del detector);
   trackerShareKalman = trackerFlops / detectorFlops. La separación por score (split, 2 ops por caja) queda fuera de trackerOps.
   Borrado: un track perdido sobrevive mientras lleve ≤ framesLost frames sin detección y se borra al siguiente (regla "> buffer":
   frame_id − end_frame > max_time_lost en ByteTrack y ultralytics, time_since_update > max_age en sort.py; con max_age = 1, SORT
   tolera UN frame sin detección y borra al segundo seguido).
   Kalman (primitives.kalmanCost, verificado contando las llamadas reales en el crosscheck): ByteTrack oficial 8-D, H densa +
   Cholesky: 1,088 MACs predict + 1,194 update por track; Ultralytics 8.4 KalmanFilterXYAH: 1,088 + 526 (H por slicing + solve);
   SORT (filterpy, 7-D, Joseph): 735 + 1,728.
   Detector: bytetrack-mot17 y sort = YOLOX-X (depth 1.33, width 1.25, 1 clase) a 800×1440 (exps/example/mot/yolox_x_mix_det.py):
   98,995,378 parámetros y 395,135,280,000 MACs, calculados por crosscheck/perception.py (YOLOX transcrito del código oficial,
   FlopCounterMode; con 80 clases a 640: 99,071,455 = los 99.1 M del README de YOLOX). bytetrack-ultralytics = yolov8l-640 del
   calculador (#yolov8).

   ---------------------------------------------------------------- depth
   Configs: depth-anything-v2-small (canónica), -base, -large (HF DepthAnythingForDepthEstimation, configs de
   depth-anything/Depth-Anything-V2-*-hf), dpt-large (HF DPTForDepthEstimation, Intel/dpt-large). Knob res (múltiplo de P;
   DPT: de 2P para que las fusiones ×2 calcen). La tabla de posición guardada no cambia con res (se interpola en el forward).
   Ops: patch-embed (patch-embed › conv) · patch-flatten (patch-embed › flatten) · cls · pos-embed · add-pos · capa ×L
   (encoder › enc-layer › ln1, mhsa › {qkv, split, scores, scale, softmax, weighted-sum, merge, proj}, [ls1], res1, ln2,
   mlp › {fc1, gelu, fc2}, [ls2], res2 → x-out) · taps (x-out → tap-1…4) · [DA: tap-ln-i (taps › tap-ln)] · por rama i:
   readout-i, to-grid-i, project-i, resample-i, neck-conv-i (reassemble › reassemble-i › readout | to-grid | project | resample |
   conv) → feat-i · fusión de grueso a fino (fusion › fusion-k › rcu1 | add | rcu2 | upsample | proj) → fused-k ·
   head (head › conv1 | upsample | conv2 | relu | conv3 | act) → depth · idle (sin uso): idle-mask-token (DA), idle-final-ln (DPT),
   fuse-4-idle (RCU 1 de la primera fusión, sin entrada).

   ---------------------------------------------------------------- pointnet
   Configs: pointnet-cls (canónica), pointnet-seg, pointnet-cls-no-tnet, pointnet2-ssg-cls. Knobs N, tnet (0/1, solo PointNet).
   Código oficial (TF): cada conv/fc lleva sesgo + BN (β, γ = 2C parámetros; medias móviles = buffers), T-Net 64-128-1024 →
   max → 512-256 → K² con W = 0 y b = I. Ops: ver build14/arch-ids.md §3 y pnBuild.

   ---------------------------------------------------------------- hardware y cotas (≈)
   Jetson AGX Orin 64GB (vla.js: 204.8 GB/s, 42.5 TFLOPS FP16 denso derivado ≈) y H100 SXM (llm.js). Roofline sin overheads:
   ms = máx(2·MACs/pico, bytes/ancho de banda), bytes = pesos en fp16 (2·params) + activaciones escritas y leídas una vez
   (2 × actMem por muestra en bf16). Las cotas son techos: lo medido siempre es más lento.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel || !A.kalmanCost) throw new Error('perception.js necesita js/arch/primitives.js (fase 14) antes.');
  if (!A.vla || !A.hasConfig('yolov8l-640') || !A.hasConfig('llama3-8b')) throw new Error('perception.js necesita yolo-world.js, llm.js y vla.js antes.');
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);
  const HW = A.vla.hardware().filter((h) => h.id === 'orin' || h.id === 'h100');
  const ORIN = HW.find((h) => h.id === 'orin'), H100 = HW.find((h) => h.id === 'h100');
  // Las tablas de escala (resScaling, nScaling) llaman a metrics() con otros knobs: sin esta guarda, cada llamada volvería a armar
  // su propia tabla (recursión infinita).
  let scaling = false;
  function guarded(fn) { if (scaling) return null; scaling = true; try { return fn(); } finally { scaling = false; } }

  // Roofline (≈): un forward de B muestras. bytes = 2·params (fp16) + 2·actBytes (activaciones escritas y leídas una vez).
  function roof(macs, params, actBytes, hw, B) {
    const b = B || 1;
    const tc = 2 * macs * b / hw.peakFlops, bytes = 2 * params + 2 * actBytes * b, tm = bytes / hw.bandwidth;
    const ms = 1000 * Math.max(tc, tm);
    return { ms, fps: 1000 * b / ms, bound: tc >= tm ? 'cómputo' : 'memoria', intensity: 2 * macs * b / bytes };
  }
  // Orden fijo: [Orin, H100].
  function hwRows(macs, params, actBytes, B) {
    return [ORIN, H100].map((h) => { const x = roof(macs, params, actBytes, h, B); return { id: h.id, label: h.label, ms: x.ms, fps: x.fps, bound: x.bound, estimate: true }; });
  }
  // Activaciones de inferencia (≈, bytes bf16 por muestra): actMem genérico SIN las matrices de atención (softmax: FlashAttention no
  // las materializa en inferencia).
  function inferAct(r, o) {
    const att = r.ops.filter((x) => x.prim === 'softmax').reduce((s, x) => s + r.tensors[x.out[0]].elements * x.repeat, 0);
    return (o.actMemPerSample / o.by - att) * 2;
  }
  // Resultado "externo" con la forma de una primitiva (detector importado de otro calculador o del crosscheck).
  function ext(prim, inputs, out, o) {
    return { prim, inputs, out, params: o.params || 0, macs: o.macs || 0, other: o.other || 0, paramFormula: o.paramTex || '0', macFormula: o.macTex || '0',
      paramArith: fint(o.params || 0), macArith: fint(o.macs || 0), shapeTex: o.shapeTex || '', detail: o.detail || {} };
  }

  // ============================================================== bytetrack
  // YOLOX-X del ByteTrack de MOT17 (1 clase) a 800×1440: lo calcula crosscheck/perception.py (el JSON lo compara).
  const YOLOX_X_MOT17 = { id: 'yolox-x-mot17', label: 'YOLOX-X (1 clase) @ 800×1440', H: 800, W: 1440, params: 98995378, macs: 395135280000,
    source: 'YOLOX-X (Ge et al. 2021, arXiv:2107.08430; depth 1.33, width 1.25) con num_classes = 1, test_size (800, 1440) de exps/example/mot/yolox_x_mix_det.py del repo oficial de ByteTrack. Parámetros y MACs: crosscheck/perception.py (arquitectura transcrita de yolox/models, FlopCounterMode, BN sin fusionar).' };
  const BT_BASE = { nDet: 50, nTracks: 50, lowPct: 20, fps: 30, m: 4 };
  const BT_CONFIGS = {
    'bytetrack-mot17': Object.assign({}, BT_BASE, { label: 'ByteTrack · MOT17 (YOLOX-X @ 800×1440)', canonical: true, tracker: 'bytetrack', impl: 'dense-cholesky', n: 8,
      detector: 'yolox-x-mot17', trackHigh: 0.6, trackLow: 0.1, newTrackThresh: 0.7, matchThresh: 0.9, matchThresh2: 0.5, unconfirmedThresh: 0.7, fuseScore: true,
      trackBuffer: 30, bufferScalesWithFps: true, secondPass: true, matchThreshPaper: 0.8,
      source: 'Zhang et al., ByteTrack, ECCV 2022, arXiv:2110.06864; repo oficial ifzhang/ByteTrack: tools/track.py (track_thresh 0.6, track_buffer 30, match_thresh 0.9 por defecto; el comando del README para MOT17 no los cambia), yolox/tracker/byte_tracker.py (score bajo > 0.1 fijo; det_thresh = track_thresh + 0.1 = 0.7; 2.ª asociación con umbral 0.5; no confirmados 0.7; fuse_score en la 1.ª asociación fuera de MOT20; buffer_size = int(frame_rate/30·track_buffer), fórmula de la clase: el evaluador de MOT17 y el demo de video la construyen con frame_rate = 30 fijo), yolox/tracker/kalman_filter.py (8-D, H densa, Cholesky). El paper rechaza IoU < 0.2 (= costo 0.8, como tools/demo_track.py); el evaluador baja track_buffer a 14 / 25 y sube track_thresh en algunas secuencias de MOT17.' }),
    'sort': Object.assign({}, BT_BASE, { label: 'SORT (Kalman 7-D + Hungarian sobre IoU)', tracker: 'sort', impl: 'filterpy-joseph', n: 7,
      detector: 'yolox-x-mot17', trackHigh: 0.6, trackLow: 0.1, newTrackThresh: 0.6, matchThresh: 0.7, iouThreshold: 0.3, maxAge: 1, minHits: 3, fuseScore: false,
      trackBuffer: 1, bufferScalesWithFps: false, secondPass: false,
      source: 'Bewley et al., SORT, ICIP 2016, arXiv:1602.00763; abewley/sort sort.py: KalmanFilter(dim_x = 7, dim_z = 4) de filterpy (u, v, s, r, u̇, v̇, ṡ), iou_threshold 0.3 (costo −IoU; tras asignar se descartan los pares con IoU < 0.3), max_age 1 (se borra cuando time_since_update > max_age: tolera un frame sin detección), min_hits 3, lap.lapjv(extend_cost = True) sin cost_limit (scipy linear_sum_assignment si lap no está). Solo detecciones con score > el umbral (0.6, como Sort(track_thresh) en el evaluador de ByteTrack); mismo detector que bytetrack-mot17 para aislar el tracker. Ojo: el Sort que trae el repo de ByteTrack (yolox/sort_tracker/sort.py) usa max_age = 30 por defecto; aquí, el de abewley/sort (max_age = 1, el T_lost = 1 del paper).' }),
    'bytetrack-ultralytics': Object.assign({}, BT_BASE, { label: 'ByteTrack · Ultralytics (YOLOv8-L @ 640)', tracker: 'bytetrack', impl: 'slice-lu', n: 8,
      detector: 'yolov8l-640', trackHigh: 0.25, trackLow: 0.1, newTrackThresh: 0.25, matchThresh: 0.8, matchThresh2: 0.5, unconfirmedThresh: 0.7, fuseScore: true,
      trackBuffer: 30, bufferScalesWithFps: false, secondPass: true,
      source: 'ultralytics 8.4.174: cfg/trackers/bytetrack.yaml (track_high_thresh 0.25, track_low_thresh 0.1, new_track_thresh 0.25, track_buffer 30, match_thresh 0.8, fuse_score True); trackers/byte_tracker.py (2.ª asociación 0.5 sin fuse, no confirmados 0.7, max_frames_lost = track_buffer sin escalar por fps); trackers/utils/kalman_filter.py (KalmanFilterXYAH: proyección por slicing, np.linalg.solve). Detector = yolov8l-640 del calculador.' }),
  };

  function btApply(c, ov) {
    Object.assign(c, ov);
    const ks = Object.keys(ov);
    if (ks.length) c._notes = ks.map((k) => k + ' = ' + ov[k] + ' (what-if)');
    return c;
  }
  function btResolve(c) {
    const W = 'Tracker: ';
    if (c.lowPct > 100) throw new Error(W + 'lowPct = ' + c.lowPct + ' (0 a 100).');
    if (c.nDet < 1 || c.nTracks < 1) throw new Error(W + 'nDet y nTracks deben ser ≥ 1.');
    c.nLow = Math.round(c.nDet * c.lowPct / 100);
    c.nHigh = c.nDet - c.nLow;
    if (c.nHigh < 1) throw new Error(W + 'con lowPct = ' + c.lowPct + ' no queda ninguna detección alta (nDet = ' + c.nDet + ').');
    const T = c.nTracks;
    c.m1 = Math.min(T, c.nHigh);
    c.rest = T - c.m1;
    c.second = !!c.secondPass && c.rest > 0 && c.nLow > 0;
    c.m2 = c.second ? Math.min(c.rest, c.nLow) : 0;
    c.U = c.m1 + c.m2;
    c.born = c.nHigh - c.m1;
    c.lost = c.rest - c.m2;
    c.out = c.U + c.born;
    // lapjv: con cost_limit (ByteTrack) cuadrada de lado filas + columnas (n₁ = T + D_h, n₂ = r + D_l); sin él (SORT, extend_cost)
    // de lado máx(filas, columnas). La 2.ª pasada usa r = T − m₁ filas: cota (incluye los perdidos; el oficial solo usa los tracked).
    c.n1 = c.tracker === 'sort' ? Math.max(T, c.nHigh) : T + c.nHigh;
    c.n2 = c.second ? c.rest + c.nLow : 0;
    c.framesLost = c.bufferScalesWithFps ? Math.floor(c.fps / 30 * c.trackBuffer) : c.trackBuffer;
    if (c.secondPass && !c.second) (c._notes = c._notes || []).push('sin segunda asociación: ' + (c.rest === 0 ? 'todos los tracks se emparejaron en la primera' : 'no hay detecciones bajas'));
    const det = c.detector === 'yolox-x-mot17' ? YOLOX_X_MOT17 : null;
    if (det) { c.detH = det.H; c.detW = det.W; c.detParams = det.params; c.detMacs = det.macs; c.detLabel = det.label; c.detSource = det.source; }
    else {
      const rr = A.run(c.detector);
      c.detH = rr.config.H; c.detW = rr.config.W; c.detParams = rr.totals.params; c.detMacs = rr.totals.macs; c.detLabel = rr.label; c.detSource = 'calculador: ' + c.detector + ' (#yolov8)';
    }
    return c;
  }

  function btBuild(c) {
    const g = A.graph(c);
    const n = String(c.n), T = c.nTracks;
    const frame = g.input('frame', shp(['H', 'W', 'C'], [c.detH, c.detW, 3], 'img', 'grid'), { label: 'Frame de video (entrada del detector, ' + c.detH + '×' + c.detW + ')', tex: 'I_t' });
    const dets = g.op('detector', ext('detector', [frame], shp(['n_det', '5'], [c.nDet, 5], 'qry', 'seq'), {
      params: c.detParams, macs: c.detMacs, paramTex: '\\text{detector}', macTex: '\\text{detector}', shapeTex: 'H\\times W\\times 3 \\to n_{\\mathrm{det}}\\times 5',
      detail: { detector: c.detector, label: c.detLabel, source: c.detSource, H: c.detH, W: c.detW } }), {
      path: ['detector'], out: 'dets', label: 'Detector: ' + c.detLabel + ' (cajas + score tras NMS)', type: 'conv', group: 'embed',
      outMeta: { label: 'Detecciones del frame: caja (x₁, y₁, x₂, y₂) + score', tex: 'Z_t' } });
    const thr = { high: c.trackHigh, low: c.trackLow };
    const keepLow = c.tracker !== 'sort' && c.nLow > 0;   // sin detecciones bajas (lowPct = 0) no hay tensor dets-low
    const ge = c.impl === 'slice-lu' ? '≥ ' : '> ';   // oficial y sort del repo de ByteTrack: score > umbral; ultralytics 8.4: ≥
    const sp = g.op('split-score', A.split_score(dets, { nHigh: c.nHigh, nLow: c.nLow, keepLow, thresholds: thr }), {
      path: ['split'], out: keepLow ? ['dets-high', 'dets-low'] : 'dets-high', label: keepLow ? 'Separar por score: altas (' + ge + c.trackHigh + ') y bajas (' + c.trackLow + ' < s < ' + c.trackHigh + ')' : 'Quedarse con las altas (' + ge + c.trackHigh + '); las bajas se descartan',
      type: 'tensorop', group: 'head',
      outMeta: keepLow ? [{ label: 'Detecciones altas (1.ª asociación)', tex: 'Z^{\\mathrm{high}}' }, { label: 'Detecciones bajas (2.ª asociación: oclusiones, desenfoque)', tex: 'Z^{\\mathrm{low}}' }] : { label: 'Detecciones altas', tex: 'Z^{\\mathrm{high}}' } });
    const hi = keepLow ? sp[0] : sp, lo = keepLow ? sp[1] : null;
    const tm = g.input('track-mean', shp(['T', n], [T, c.n], 'qry', 'seq'), { label: 'Estado de cada track (' + (c.n === 8 ? 'x, y, a, h y sus velocidades' : 'u, v, s, r, u̇, v̇, ṡ') + ')', tex: '\\hat x' });
    const tc = g.input('track-cov', shp(['T', n, n], [T, c.n, c.n], 'qry', 'seq'), { label: 'Covarianza de cada track (incertidumbre)', tex: 'P' });
    const Wt = ['Tracker (por frame)'];
    const [pm, pc] = g.op('kalman-predict', A.kalman_predict(tm, tc, { impl: c.impl, m: c.m }), { path: ['tracker', 'predict'], out: ['pred-mean', 'pred-cov'], where: Wt,
      label: 'Kalman: predecir cada track (velocidad constante)', type: 'mlp', group: 'mlp',
      outMeta: [{ label: 'Estado predicho', tex: "\\hat x' = F\\hat x" }, { label: 'Covarianza predicha', tex: "P' = FPF^\\top + Q" }] });
    const assoc = (k, dIn, rows, cols, fuse, thresh, nn, matches, label) => {
      const P = ['tracker', 'assoc-' + k];
      // la 2.ª asociación usa solo las filas de los r tracks sin pareja (r ≤ T)
      const iouRes = A.iou_matrix(rows === T ? pm : A.shape(['r', n], [rows, c.n], 'qry', 'seq'), dIn);
      const iou = g.op('iou-' + k, iouRes, { path: P.concat(['iou']), in: ['pred-mean', dIn.id], out: 'iou-' + k, where: Wt, label: 'IoU ' + label, type: 'attn', group: 'attn',
        outMeta: { label: 'IoU de cada track con cada detección ' + (k === 1 ? 'alta' : 'baja'), tex: 'IoU_{' + k + '}',
          note: k === 2 ? 'Filas = los ' + rows + ' tracks sin pareja de la 1.ª pasada: cota (incluye los perdidos; el código oficial solo usa los que estaban tracked).' : undefined } });
      const sort = c.tracker === 'sort';
      const cl = sort ? 'Costo −IoU (se descartan pares con IoU < ' + c.iouThreshold + ')' : fuse ? 'Costo 1 − IoU·score' : 'Costo 1 − IoU';
      const cost = g.op('cost-' + k, A.assoc_cost(iou, { fuse, thresh }), { path: P.concat(['cost']), out: 'cost-' + k, where: Wt, label: cl, type: 'attn', group: 'attn',
        outMeta: { label: sort ? 'Matriz de costos −IoU (tras asignar se descartan los pares con IoU < ' + c.iouThreshold + ')' : 'Matriz de costos (se rechaza todo par con costo > ' + thresh + ')', tex: 'C_' + k } });
      const la = A.linear_assignment(cost, { n: nn, matches, solver: 'lapjv', thresh, msym: 'm_' + k });
      la.detail.note = sort ? 'lapjv con extend_cost, sin cost_limit: matriz de lado máx(' + rows + ', ' + cols + ') = ' + nn + ' (≈ n³ peor caso)'
        : 'lapjv con cost_limit: matriz extendida de lado filas + columnas = ' + rows + ' + ' + cols + ' = ' + nn + ' (≈ n³ peor caso)';
      return g.op('assign-' + k, la, { path: P.concat(['assign']), out: 'matches-' + k, where: Wt,
        label: 'Asignación óptima (Jonker-Volgenant, lapjv; matriz ' + nn + '×' + nn + (sort ? ')' : ', extendida)'), type: 'head', group: 'head', outMeta: { label: 'Parejas (track, detección) aceptadas', tex: 'M_' + k } });
    };
    const mt1 = assoc(1, hi, T, c.nHigh, c.fuseScore, c.matchThresh, c.n1, c.m1, 'tracks × detecciones altas');
    const ms = [mt1];
    if (c.second) ms.push(assoc(2, lo, c.rest, c.nLow, false, c.matchThresh2, c.n2, c.m2, 'tracks sin pareja × detecciones bajas'));
    const upd = g.op('kalman-update', A.kalman_update(pm, pc, ms, { impl: c.impl, m: c.m, U: c.U }), { path: ['tracker', 'update'], out: 'track-mean-new', where: Wt,
      label: 'Kalman: corregir los ' + c.U + ' tracks emparejados', type: 'mlp', group: 'mlp', outMeta: { label: 'Estados corregidos con su detección', tex: '\\hat x + K(z - H\\hat x)' } });
    g.op('track-manage', A.track_manage(upd, { out: c.out, born: c.born, lost: c.lost, ops: T + c.nDet }), { path: ['tracker', 'manage'], out: 'tracks-out', where: Wt,
      label: 'Nuevos (' + c.born + '), perdidos (' + c.lost + ') y borrados con más de ' + c.framesLost + (c.framesLost === 1 ? ' frame' : ' frames') + ' sin detección', type: 'tensorop', group: 'resid',
      outMeta: { label: 'Tracks activos con su id (salida)', tex: '\\{(b_i, \\mathrm{id}_i)\\}' } });
    return g;
  }

  function btParts(c, r) {
    const op = (id) => r.ops.find((o) => o.id === id);
    const k = A.kalmanCost(c.impl, c.n, c.m);
    const trk = r.totals.byNode.tracker;
    const iouOps = ['iou-1', 'iou-2'].map(op).filter(Boolean).reduce((s, o) => s + o.other, 0);
    const costOps = ['cost-1', 'cost-2'].map(op).filter(Boolean).reduce((s, o) => s + o.other, 0);
    const assignOps = ['assign-1', 'assign-2'].map(op).filter(Boolean).reduce((s, o) => s + o.other, 0);
    const iouPairs = c.nTracks * c.nHigh + (c.second ? c.rest * c.nLow : 0);
    // Todo en FLOPs: 2 × MACs del Kalman + "otros" del tracker (≈ 1 FLOP por op), contra 2 × MACs del detector.
    const trackerMacs = trk.macs, trackerOtherOps = trk.other, trackerOps = 2 * trk.macs + trk.other;
    return { k, trk, iouOps, costOps, assignOps, iouPairs, trackerMacs, trackerOtherOps, trackerOps, detFlops: 2 * c.detMacs };
  }
  function btQuantities(c, r) {
    const p = btParts(c, r);
    return {
      nDet: c.nDet, nTracks: c.nTracks, nHigh: c.nHigh, nLow: c.nLow, matches1: c.m1, matches2: c.m2, updates: c.U, born: c.born, lost: c.lost,
      stateDim: c.n, measDim: c.m, kalmanPredictMacs: p.k.predict, kalmanUpdateMacs: p.k.update, kalmanMacsPerTrack: p.k.predict + p.k.update,
      trackerMacs: p.trackerMacs, detectorParams: c.detParams, detectorMacs: c.detMacs, iouPairs: p.iouPairs, assignN1: c.n1, assignN2: c.n2,
      framesLost: c.framesLost, tokens: c.nDet,
    };
  }
  function btMetrics(c, r, o) {
    const p = btParts(c, r), fps = c.fps;
    const kb = (c.n + c.n * c.n) * 8;   // float64 (numpy): media n + covarianza n²
    // Cota del detector: pesos + cómputo, sin activaciones en los dos detectores (YOLOX-X no tiene modelo en el calculador; YOLOv8-L
    // lo tiene, pero su actMemPerSample es de entrenamiento). Los dos son compute-bound en Orin y H100: no cambia el número.
    const det = hwRows(c.detMacs, c.detParams, 0, 1);
    const out = {
      tracker: c.tracker, kalmanImpl: c.impl, stateDim: c.n, measDim: c.m,
      kalmanPredictMacs: p.k.predict, kalmanUpdateMacs: p.k.update, kalmanMacsPerTrack: p.k.predict + p.k.update, kalmanFlopsPerTrack: 2 * (p.k.predict + p.k.update),
      nDet: c.nDet, nHigh: c.nHigh, nLow: c.nLow, nTracks: c.nTracks, matches1: c.m1, matches2: c.m2, updates: c.U, born: c.born, lost: c.lost,
      iouPairs: p.iouPairs, iouOps: p.iouOps + p.costOps, assignSizes: c.second ? [c.n1, c.n2] : [c.n1], assignN1: c.n1, assignN2: c.n2, assignOps: p.assignOps,
      trackerMacs: p.trackerMacs, trackerFlops: 2 * p.trackerMacs, trackerOtherOps: p.trackerOtherOps, trackerOps: p.trackerOps, trackerParams: 0,
      detectorConfig: c.detector, detectorLabel: c.detLabel, detectorParams: c.detParams, detectorMacs: c.detMacs, detectorFlops: p.detFlops,
      trackerShare: p.trackerOps / p.detFlops, trackerShareKalman: 2 * p.trackerMacs / p.detFlops, assignShareTracker: p.assignOps / p.trackerOps,
      framesLost: c.framesLost, secondsLost: c.framesLost / fps, fps,
      kalmanBytesPerTrack: kb, trackMemBytes: c.nTracks * kb,
      trackHigh: c.trackHigh, trackLow: c.trackLow, newTrackThresh: c.newTrackThresh, matchThresh: c.matchThresh, trackBuffer: c.trackBuffer,
      detectorMsOrin: det[0].ms, detectorFpsOrin: det[0].fps, detectorMsH100: det[1].ms, detectorFpsH100: det[1].fps,
      detectorHardware: det, hardwareSource: ORIN.source + ' · ' + H100.source, estimate: true,
      paramMem: c.detParams * o.by,
      units: BT_UNITS,
    };
    if (c.tracker === 'bytetrack') Object.assign(out, { matchThresh2: c.matchThresh2, unconfirmedThresh: c.unconfirmedThresh });
    if (c.tracker === 'sort') Object.assign(out, { iouThreshold: c.iouThreshold, maxAge: c.maxAge, minHits: c.minHits });
    if (c.matchThreshPaper !== undefined) out.matchThreshPaper = c.matchThreshPaper;
    const arch = {};
    Object.keys(r.overrides || {}).forEach((k) => { if (k in A.model('bytetrack').knobs) arch[k] = r.overrides[k]; });
    out.nDetScaling = [10, 50, 100, 200, 500].map((nd) => {
      const rr = A.run(r.id, Object.assign({}, arch, { nDet: nd, nTracks: nd })), pp = btParts(rr.config, rr);
      return { nDet: nd, nTracks: nd, kalmanMacs: pp.trackerMacs, iouOps: pp.iouOps + pp.costOps, assignOps: pp.assignOps, trackerOps: pp.trackerOps, trackerShare: pp.trackerOps / pp.detFlops };
    });
    return out;
  }
  const BT_UNITS = {
    kalmanPredictMacs: 'macs', kalmanUpdateMacs: 'macs', kalmanMacsPerTrack: 'macs', kalmanFlopsPerTrack: 'count', trackerMacs: 'macs', detectorMacs: 'macs',
    trackerFlops: 'count', trackerOtherOps: 'count', trackerOps: 'count', detectorFlops: 'flops', iouOps: 'count', assignOps: 'count', iouPairs: 'count',
    detectorParams: 'params', trackerParams: 'params', trackerShare: 'pct', trackerShareKalman: 'pct', assignShareTracker: 'pct',
    stateDim: 'count', measDim: 'count', nDet: 'count', nHigh: 'count', nLow: 'count', nTracks: 'count', matches1: 'count', matches2: 'count', updates: 'count', born: 'count', lost: 'count',
    assignN1: 'count', assignN2: 'count', framesLost: 'count', secondsLost: 'ratio', fps: 'count', kalmanBytesPerTrack: 'bytes', trackMemBytes: 'bytes', paramMem: 'bytes',
    trackHigh: 'ratio', trackLow: 'ratio', newTrackThresh: 'ratio', matchThresh: 'ratio', matchThresh2: 'ratio', unconfirmedThresh: 'ratio', matchThreshPaper: 'ratio', iouThreshold: 'ratio',
    trackBuffer: 'count', maxAge: 'count', minHits: 'count', detectorMsOrin: 'ms', detectorMsH100: 'ms', detectorFpsOrin: 'ratio', detectorFpsH100: 'ratio',
  };

  A.defineModel({
    id: 'bytetrack',
    label: 'Tracking multi-objeto: SORT y ByteTrack',
    paper: { title: 'ByteTrack: Multi-Object Tracking by Associating Every Detection Box', authors: 'Zhang et al.', venue: 'ECCV 2022', year: 2022, arxiv: '2110.06864',
      note: 'SORT: Bewley et al., Simple Online and Realtime Tracking, ICIP 2016, arXiv:1602.00763. DeepSORT: Wojke et al., ICIP 2017, arXiv:1703.07402. Asignación: Jonker y Volgenant, Computing 38, 1987 (lap.lapjv).' },
    configs: BT_CONFIGS,
    knobs: { nDet: [10, 50, 100, 200], nTracks: [10, 50, 100, 200], fps: [10, 14, 25, 30, 60], lowPct: [0, 10, 20, 40] },
    zeroKnobs: ['lowPct'],
    hardware: HW.map((h) => Object.assign({}, h)),
    applyKnobs: btApply,
    resolve: btResolve,
    build: btBuild,
    quantities: btQuantities,
    metrics: btMetrics,
  });

  // ============================================================== depth
  const DA_SRC = 'Yang et al., Depth Anything V2, NeurIPS 2024, arXiv:2406.09414; HF ';
  // posInterp: interpolación de la tabla de posición en el forward. DINOv2 de HF (Depth Anything): bicúbica, solo si la rejilla
  // cambia (a 518 devuelve la tabla tal cual). DPT de HF (DPTViTEmbeddings._resize_pos_embed): bilineal y en TODO forward, también a
  // 384 (24×24 → 24×24). En los dos casos se interpolan las N filas de la rejilla; la del CLS se copia.
  const DEPTH_BASE = { C: 3, res: 518, P: 14, headHidden: 32, factors: [4, 2, 1, 0.5], readout: 'ignore', layerScale: true, tapNorm: true, maskToken: true, finalLnIdle: false,
    fusionUp: 'to-next', headUp: 'to-input', relative: true, eps: 1e-6, imgSize: 518, posInterp: 'bicubic', posInterpAlways: false };
  const DEPTH_CONFIGS = {
    'depth-anything-v2-small': Object.assign({}, DEPTH_BASE, { label: 'Depth Anything V2 Small (ViT-S/14 @ 518)', canonical: true, D: 384, L: 12, h: 6, Dmlp: 1536, taps: [3, 6, 9, 12],
      neck: [48, 96, 192, 384], F: 64, hf: 'depth-anything/Depth-Anything-V2-Small-hf', source: DA_SRC + 'depth-anything/Depth-Anything-V2-Small-hf (config.json: DINOv2 ViT-S/14, out_indices [3, 6, 9, 12], neck_hidden_sizes [48, 96, 192, 384], fusion_hidden_size 64, head_hidden_size 32, reassemble_factors [4, 2, 1, 0.5]; preprocessor 518×518, múltiplo de 14).' }),
    'depth-anything-v2-base': Object.assign({}, DEPTH_BASE, { label: 'Depth Anything V2 Base (ViT-B/14 @ 518)', D: 768, L: 12, h: 12, Dmlp: 3072, taps: [3, 6, 9, 12],
      neck: [96, 192, 384, 768], F: 128, hf: 'depth-anything/Depth-Anything-V2-Base-hf', source: DA_SRC + 'depth-anything/Depth-Anything-V2-Base-hf (DINOv2 ViT-B/14, out_indices [3, 6, 9, 12], neck [96, 192, 384, 768], fusion 128).' }),
    'depth-anything-v2-large': Object.assign({}, DEPTH_BASE, { label: 'Depth Anything V2 Large (ViT-L/14 @ 518)', D: 1024, L: 24, h: 16, Dmlp: 4096, taps: [5, 12, 18, 24],
      neck: [256, 512, 1024, 1024], F: 256, hf: 'depth-anything/Depth-Anything-V2-Large-hf', source: DA_SRC + 'depth-anything/Depth-Anything-V2-Large-hf (DINOv2 ViT-L/14, 24 capas, out_indices [5, 12, 18, 24], neck [256, 512, 1024, 1024], fusion 256).' }),
    'dpt-large': Object.assign({}, DEPTH_BASE, { label: 'DPT-Large (ViT-L/16 @ 384)', res: 384, imgSize: 384, P: 16, D: 1024, L: 24, h: 16, Dmlp: 4096, taps: [6, 12, 18, 24],
      neck: [256, 512, 1024, 1024], F: 256, readout: 'project', layerScale: false, tapNorm: false, maskToken: false, finalLnIdle: true, fusionUp: 'x2', headUp: 'x2', eps: 1e-12, posInterp: 'bilinear', posInterpAlways: true,
      hf: 'Intel/dpt-large', source: 'Ranftl et al., Vision Transformers for Dense Prediction (DPT), ICCV 2021, arXiv:2103.13413; HF Intel/dpt-large (DPTForDepthEstimation: ViT-L/16 a 384, backbone_out_indices [5, 11, 17, 23] = salidas de las capas 6, 12, 18, 24, readout_type project, neck [256, 512, 1024, 1024], fusion 256; la tabla de posición se re-muestrea bilineal en cada forward, modeling_dpt.py _resize_pos_embed).' }),
  };

  function dApply(c, ov) {
    const notes = [];
    if (ov.res !== undefined) {
      c.res = ov.res;
      if (c.res % c.P !== 0) throw new Error('La resolución ' + c.res + ' no es múltiplo del parche P = ' + c.P + '.');
      if (c.fusionUp === 'x2' && (c.res / c.P) % 2 !== 0) throw new Error('DPT: la rejilla ' + (c.res / c.P) + ' debe ser par (res múltiplo de ' + 2 * c.P + ') para que las fusiones ×2 calcen.');
      if (c.res !== c.imgSize) notes.push('Position embeddings interpolados en el forward: la tabla guardada sigue siendo de ' + ((c.imgSize / c.P) * (c.imgSize / c.P) + 1) + ' filas (' + (c.posInterp === 'bilinear' ? 'bilineal' : 'bicúbica') + ' a ' + ((c.res / c.P) * (c.res / c.P) + 1) + '; la del CLS se copia).');
    }
    c._notes = notes;
    return c;
  }
  function dResolve(c) {
    c.H = c.res; c.W = c.res;
    c.g = c.res / c.P;
    c.N = c.g * c.g; c.tokens = c.N + 1;
    c.dh = c.D / c.h;
    c.posRows = (c.imgSize / c.P) * (c.imgSize / c.P) + 1;
    // Tamaño de cada rama tras resample (×4, ×2, ×1, conv 3×3 s2 p1 → ⌈g/2⌉).
    c.sizes = c.factors.map((f) => (f > 1 ? c.g * f : f === 1 ? c.g : Math.floor((c.g + 2 - 3) / 2) + 1));
    return c;
  }

  // Capa ViT pre-LN con LayerScale (DINOv2): mismos ids que preLnLayer + ls1 / ls2. (Como lsLayer de vla.js, con γ iniciado en 1.0:
  // layerscale_value del Dinov2Config.)
  function lsLayer(g, x, o) {
    const Pp = o.prefix, rep = o.L;
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    const at = Pp.concat(['mhsa']), ml = Pp.concat(['mlp']);
    const Lm = (m) => Object.assign({ perLayer: true }, m);
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: rep, where: o.where }, extra));
    const hln1 = op('ln1', A.layernorm(x, { eps: 1e-6 }), Pp.concat(['ln1']), { out: 'h-ln1', label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: Lm({ label: 'Entrada normalizada (LN 1)', tex: '\\mathrm{LN}_1(x)' }) });
    const qkv = op('qkv', A.linear(hln1, { dout: 3 * D, doutSym: '3' + Ds, bias: true }), at.concat(['qkv']), { out: 'qkv', label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: Lm({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }) });
    const [q, k, v] = op('split', A.split_heads(qkv, { h: o.h, parts: 3 }), at.concat(['split']), {
      out: ['q', 'k', 'v'], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [Lm({ label: 'Queries por cabeza', tex: 'Q' }), Lm({ label: 'Keys por cabeza', tex: 'K' }), Lm({ label: 'Values por cabeza', tex: 'V' })] });
    const sc = op('scores', A.attention_scores(q, k), at.concat(['scores']), { out: 'scores', label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const ss = op('scale', A.scale(sc), at.concat(['scale']), { out: 'scores-scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const a = op('softmax', A.softmax(ss), at.concat(['softmax']), { out: 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), at.concat(['weighted-sum']), { out: 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: Lm({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: Ds }), at.concat(['merge']), { out: 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: Lm({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    const ov = op('proj', A.linear(z, { dout: D, doutSym: Ds, bias: true }), at.concat(['proj']), { out: 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: Lm({ label: 'Salida de la atención', tex: 'O = ZW_O' }) });
    const ol = op('ls1', A.layer_scale(ov, { init: 1.0 }), Pp.concat(['ls1']), { out: 'o-ls', label: 'LayerScale 1 (γ₁ ⊙ atención)', type: 'tensorop', group: 'resid', outMeta: Lm({ label: 'Atención escalada (LayerScale)', tex: '\\gamma_1\\odot O' }) });
    const r1 = op('res1', A.residual_add(x, ol), Pp.concat(['res1']), { out: 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: Lm({ label: 'x + atención', tex: "x'" }) });
    const hln2 = op('ln2', A.layernorm(r1, { eps: 1e-6 }), Pp.concat(['ln2']), { out: 'h-ln2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: Lm({ label: 'Entrada normalizada (LN 2)', tex: "\\mathrm{LN}_2(x')" }) });
    const u = op('fc1', A.linear(hln2, { dout: o.Dmlp, doutSym: 'D_mlp', bias: true }), ml.concat(['fc1']), { out: 'u', label: 'MLP: capa 1 (expansión)', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'Capa oculta del MLP', tex: 'U' }) });
    const gg = op('gelu', A.gelu(u), ml.concat(['gelu']), { out: 'g', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'Activación', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', A.linear(gg, { dout: D, doutSym: Ds, bias: true }), ml.concat(['fc2']), { out: 'f', label: 'MLP: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: Lm({ label: 'Salida del MLP', tex: 'F' }) });
    const fl = op('ls2', A.layer_scale(f, { init: 1.0 }), Pp.concat(['ls2']), { out: 'f-ls', label: 'LayerScale 2 (γ₂ ⊙ MLP)', type: 'tensorop', group: 'resid', outMeta: Lm({ label: 'MLP escalado (LayerScale)', tex: '\\gamma_2\\odot F' }) });
    return op('res2', A.residual_add(r1, fl), Pp.concat(['res2']), { out: 'x-out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: { label: 'Salida del encoder (x_L)', tex: 'x_L', perLayer: false, note: 'Salida de cada capa x_ℓ; tras la capa L es x_L.' } });
  }

  const RS = ['4H/P', '2H/P', 'H/P', 'H/2P'], RSW = ['4W/P', '2W/P', 'W/P', 'W/2P'];
  // La rama ×0.5 es una conv 3×3 s2 p1: ⌈g/2⌉. Con g impar (Depth Anything a 518: 37 → 19) el símbolo lleva el techo.
  const rsSym = (c, i) => (i === 3 && (c.H / c.P) % 2 ? ['⌈H/2P⌉', '⌈W/2P⌉'] : [RS[i], RSW[i]]);
  function dBuild(c) {
    const g = A.graph(c);
    const Wenc = ['Encoder ViT (' + (c.layerScale ? 'DINOv2' : 'ViT-L/16') + ')'], Wneck = ['Cabeza DPT: reassemble'], Wfus = ['Cabeza DPT: fusión'], Whead = ['Cabeza DPT: salida'];
    const img = g.input('x-img', shp(['H', 'W', 'C'], [c.H, c.W, c.C], 'img', 'grid'), { label: 'Imagen de entrada (' + c.H + '×' + c.W + ')', tex: 'x' });
    const grid = g.op('patch-embed', A.conv2d(img, { k: c.P, s: c.P, cout: c.D, coutSym: 'D', kSym: 'P', outSym: ['H/P', 'W/P'], bias: true, macTex: 'N\\cdot D\\cdot P^2\\cdot C' }), {
      path: ['patch-embed', 'conv'], out: 'x-patch-grid', where: Wenc, label: 'Patch embedding (conv P×P, stride P)', type: 'conv', group: 'embed', outMeta: { label: 'Rejilla de parches embebidos', tex: 'X_{\\mathrm{grid}}' } });
    const xp = g.op('patch-flatten', A.flatten(grid, { sym: ['N', 'D'] }), { path: ['patch-embed', 'flatten'], out: 'x-patches', where: Wenc, label: 'Aplanar la rejilla en secuencia', type: 'tensorop', group: 'embed', outMeta: { label: 'Patches embebidos', tex: 'X_p E' } });
    const xc = g.op('cls', A.cls_token(xp, { outSym: 'N+1' }), { path: ['cls'], out: 'x-cls-cat', where: Wenc, label: 'Token CLS (se antepone)', type: 'embed', group: 'embed', outMeta: { label: 'CLS + patches', tex: '[x_{\\mathrm{cls}};\\,X_p E]' } });
    const resized = c.posRows !== c.N + 1, interp = resized || c.posInterpAlways;
    const pe = A.pos_embed_learned({ rows: c.N + 1, rowsSym: 'N+1', D: c.D, mod: 'img', interpolatedFrom: resized ? c.posRows : null });
    if (resized) {
      // La tabla guardada no cambia: se interpola en el forward. Parámetros = filas guardadas · D.
      pe.params = c.posRows * c.D; pe.paramArith = c.posRows + '·' + c.D + ' = ' + fint(pe.params); pe.paramFormula = '(N_0{+}1)\\cdot D';
    }
    // Costo ≈ de la interpolación: N filas de la rejilla × D × ops por salida (bilineal 4, bicúbica 16). DPT la corre siempre.
    if (interp) { pe.other = c.N * c.D * A.OTHER_COST[c.posInterp]; pe.detail = Object.assign({}, pe.detail, { interp: c.posInterp, everyForward: !!c.posInterpAlways }); }
    const modeTxt = c.posInterp === 'bilinear' ? 'bilineal' : 'bicúbica';
    const ep = g.op('pos-embed', pe, { path: ['pos-embed'], out: 'e-pos', where: Wenc, label: 'Position embeddings aprendidos' + (resized ? ' (interpolación ' + modeTxt + ' de ' + c.posRows + ' filas)' : interp ? ' (re-muestreo ' + modeTxt + ' en cada forward: rejilla ' + (c.imgSize / c.P) + '×' + (c.imgSize / c.P) + ' → ' + c.g + '×' + c.g + ')' : ''), type: 'embed', group: 'embed',
      outMeta: { label: 'Tabla de posición', tex: 'E_{\\mathrm{pos}}' } });
    const x0 = g.op('add-pos', A.add(xc, ep), { path: ['add-pos'], out: 'x0', where: Wenc, label: 'Suma de posición', type: 'tensorop', group: 'embed', outMeta: { label: 'Entrada al encoder', tex: 'x_0' } });
    const xL = c.layerScale
      ? lsLayer(g, x0, { prefix: ['encoder', 'enc-layer'], L: c.L, h: c.h, Dmlp: c.Dmlp, where: Wenc })
      : A.preLnLayer(g, x0, { prefix: ['encoder', 'enc-layer'], L: c.L, h: c.h, Dmlp: c.Dmlp, qkvBias: true, projBias: true, mlpBias: true, where: Wenc });
    if (c.maskToken) g.op('idle-mask-token', A.idle_params({ paramTerms: [[c.D]], paramTex: 'D', what: 'mask_token de DINOv2 (solo con bool_masked_pos, en el preentrenamiento iBOT)' }), {
      path: ['idle'], out: [], in: [], label: 'Sin uso: mask token de DINOv2', type: 'embed', group: 'embed' });
    if (c.finalLnIdle) g.op('idle-final-ln', A.idle_params({ paramTerms: [[2, c.D]], paramTex: '2D', what: 'LayerNorm final de DPTModel (se aplica a la última capa; el neck lee las 4 salidas intermedias sin ella)' }), {
      path: ['idle'], out: [], in: [], label: 'Sin uso por la cabeza: LayerNorm final del ViT', type: 'norm', group: 'norm' });
    const taps = g.op('taps', A.layer_taps(xL, { layers: c.taps }), { path: ['taps'], out: ['tap-1', 'tap-2', 'tap-3', 'tap-4'], where: Wenc,
      label: 'Salidas de las capas ' + c.taps.join(', ') + ' (1-based)', type: 'tensorop', group: 'embed',
      outMeta: c.taps.map((l, i) => ({ label: 'Salida de la capa ' + l + ' (rama ' + (i + 1) + ')', tex: 'x_{' + l + '}' })) });
    const feats = [];
    for (let i = 0; i < 4; i++) {
      const b = i + 1, P = ['reassemble', 'reassemble-' + b];
      let t = taps[i];
      if (c.tapNorm) {
        t = g.op('tap-ln-' + b, A.layernorm(t, { eps: c.eps }), { path: ['taps', 'tap-ln'], out: 'tap-n-' + b, where: Wenc, paramRepeat: i === 0 ? 1 : 0,
          label: 'LayerNorm del backbone sobre la salida de la capa ' + c.taps[i] + (i ? ' (los mismos pesos)' : ''), type: 'norm', group: 'norm',
          outMeta: { label: 'Salida normalizada de la capa ' + c.taps[i], tex: '\\mathrm{LN}(x_{' + c.taps[i] + '})' } });
      }
      const tok = g.op('readout-' + b, A.readout(t, { mode: c.readout }), { path: P.concat(['readout']), out: 'tok-' + b, where: Wneck,
        label: c.readout === 'project' ? 'Readout: concatenar el CLS a cada token y Linear 2D → D + GELU' : 'Readout: descartar el CLS', type: c.readout === 'project' ? 'mlp' : 'tensorop', group: c.readout === 'project' ? 'mlp' : 'embed',
        outMeta: { label: 'Tokens de la rama ' + b + ' (sin CLS)', tex: 'T_' + b } });
      const gr = g.op('to-grid-' + b, A.to_grid(tok, { H: c.g, W: c.g, sym: ['H/P', 'W/P'] }), { path: P.concat(['to-grid']), out: 'grid-' + b, where: Wneck,
        label: 'Rearmar la rejilla H/P × W/P', type: 'tensorop', group: 'embed', outMeta: { label: 'Rejilla de la rama ' + b, tex: 'G_' + b } });
      const pj = g.op('project-' + b, A.conv2d(gr, { k: 1, s: 1, cout: c.neck[i], coutSym: 'C_' + b, outSym: ['H/P', 'W/P'], bias: true }), { path: P.concat(['project']), out: 'proj-' + b, where: Wneck,
        label: 'Conv 1×1: D → ' + c.neck[i] + ' canales', type: 'conv', group: 'mlp', outMeta: { label: 'Rama ' + b + ' proyectada', tex: 'G_' + b + 'W_' + b } });
      const f = c.factors[i];
      const rs = g.op('resample-' + b, A.resample(pj, { factor: f, outSym: rsSym(c, i) }), { path: P.concat(['resample']), out: 'rs-' + b, where: Wneck,
        label: f > 1 ? 'Subir ×' + f + ' (ConvTranspose ' + f + '×' + f + ', stride ' + f + ')' : f === 1 ? 'Escala ×1 (identidad)' : 'Bajar ×½ (conv 3×3, stride 2)', type: 'conv', group: 'mlp',
        outMeta: { label: 'Rama ' + b + ' a 1/' + (c.P / f) + ' de la imagen (' + c.sizes[i] + '×' + c.sizes[i] + ')', tex: 'R_' + b } });
      const fe = g.op('neck-conv-' + b, A.conv2d(rs, { k: 3, s: 1, p: 1, cout: c.F, coutSym: 'F', outSym: rsSym(c, i), bias: false }), { path: P.concat(['neck-conv']), out: 'feat-' + b, where: Wneck,
        label: 'Conv 3×3: ' + c.neck[i] + ' → F = ' + c.F + ' (sin sesgo)', type: 'conv', group: 'mlp', outMeta: { label: 'Rama ' + b + ' con F canales', tex: 'F_' + b } });
      feats.push(fe);
    }
    // Fusión de grueso (rama 4) a fino (rama 1). DA: cada fusión sube al tamaño de la rama siguiente y la última ×2; DPT: siempre ×2.
    let fused = null;
    const FS = ['8H/P', '4H/P', '2H/P', 'H/P'], FSW = ['8W/P', '4W/P', '2W/P', 'W/P'];
    for (let b = 4; b >= 1; b--) {
      const P = ['fusion', 'fusion-' + b], i = b - 1;
      const tg = (s) => 'fz-' + b + '-' + s;
      let h;
      if (!fused) {
        h = feats[i];
        g.op('fuse-4-idle', A.idle_params({ paramTerms: [[2, 9, c.F, c.F], [2, c.F]], paramTex: '2\\,(9F^2 + F)', what: 'RCU 1 de la primera fusión (rama 4): no tiene una entrada residual que procesar' }), {
          path: P.concat(['rcu1']), out: [], in: [], label: 'Sin uso: RCU 1 de la fusión 4', type: 'conv', group: 'mlp', where: Wfus });
      } else {
        const r1 = g.op('fuse-' + b + '-rcu1', A.rcu(feats[i]), { path: P.concat(['rcu1']), out: tg('r1'), where: Wfus, label: 'RCU sobre la rama ' + b, type: 'conv', group: 'mlp', outMeta: { label: 'Rama ' + b + ' refinada', tex: '\\mathrm{RCU}(F_' + b + ')' } });
        h = g.op('fuse-' + b + '-add', A.add(fused, r1), { path: P.concat(['add']), out: tg('sum'), where: Wfus, label: 'Sumar lo fusionado (más grueso) y la rama ' + b, type: 'tensorop', group: 'resid',
          outMeta: { label: 'Suma de escalas', tex: 'Y_{' + (b + 1) + '} + \\mathrm{RCU}(F_' + b + ')' } });
      }
      const r2 = g.op('fuse-' + b + '-rcu2', A.rcu(h), { path: P.concat(['rcu2']), out: tg('r2'), where: Wfus, label: 'RCU 2', type: 'conv', group: 'mlp', outMeta: { label: 'Tras RCU 2', tex: '\\mathrm{RCU}_2' } });
      const toSize = b > 1 && c.fusionUp === 'to-next' ? c.sizes[i - 1] : 2 * r2.num[0];
      const up = g.op('fuse-' + b + '-up', A.upsample_bilinear(r2, { H: toSize, W: toSize, outSym: [FS[i], FSW[i]] }), { path: P.concat(['upsample']), out: tg('up'), where: Wfus,
        label: c.fusionUp === 'to-next' && b > 1 ? 'Bilineal al tamaño de la rama ' + (b - 1) + ' (' + toSize + '×' + toSize + ')' : 'Bilineal ×2', type: 'tensorop', group: 'resid',
        outMeta: { label: 'Subida a ' + toSize + '×' + toSize, tex: '\\uparrow' } });
      fused = g.op('fuse-' + b + '-proj', A.conv2d(up, { k: 1, s: 1, cout: c.F, coutSym: 'F', outSym: [FS[i], FSW[i]], bias: true }), { path: P.concat(['proj']), out: 'fused-' + b, where: Wfus,
        label: 'Conv 1×1 F → F', type: 'conv', group: 'mlp', outMeta: { label: 'Mapa fusionado ' + b + ' (' + toSize + '×' + toSize + ')', tex: 'Y_' + b } });
    }
    const F2 = c.F / 2;
    const h1 = g.op('head-conv1', A.conv2d(fused, { k: 3, s: 1, p: 1, cout: F2, coutSym: 'F/2', outSym: ['8H/P', '8W/P'], bias: true }), { path: ['head', 'conv1'], out: 'hd-c1', where: Whead,
      label: 'Conv 3×3: F → F/2', type: 'conv', group: 'head', outMeta: { label: 'Mitad de canales', tex: 'h_1' } });
    const hu = g.op('head-up', A.upsample_bilinear(h1, { H: c.H, W: c.W, outSym: ['H', 'W'] }), { path: ['head', 'upsample'], out: 'hd-up', where: Whead,
      label: c.headUp === 'x2' ? 'Bilineal ×2 (a la resolución de entrada)' : 'Bilineal a la resolución de entrada (' + c.H + '×' + c.W + ')', type: 'tensorop', group: 'head', outMeta: { label: 'A resolución completa', tex: '\\uparrow h_1' } });
    const h2 = g.op('head-conv2', A.conv2d(hu, { k: 3, s: 1, p: 1, cout: c.headHidden, coutSym: '32', outSym: ['H', 'W'], bias: true }), { path: ['head', 'conv2'], out: 'hd-c2', where: Whead,
      label: 'Conv 3×3: F/2 → ' + c.headHidden + ' (a resolución completa)', type: 'conv', group: 'head', outMeta: { label: 'Rasgos a resolución completa', tex: 'h_2' } });
    const hr = g.op('head-relu', A.relu(h2), { path: ['head', 'relu'], out: 'hd-relu', where: Whead, label: 'ReLU', type: 'mlp', group: 'act', outMeta: { label: 'Activación', tex: '\\mathrm{ReLU}(h_2)' } });
    const h3 = g.op('head-conv3', A.conv2d(hr, { k: 1, s: 1, cout: 1, coutSym: '1', outSym: ['H', 'W'], bias: true }), { path: ['head', 'conv3'], out: 'hd-c3', where: Whead,
      label: 'Conv 1×1: ' + c.headHidden + ' → 1', type: 'conv', group: 'head', outMeta: { label: 'Un valor por píxel', tex: 'h_3' } });
    const act = A.relu(h3);
    act.out = shp(['H', 'W'], [c.H, c.W], 'img', 'grid');
    act.shapeTex = 'H\\times W\\times 1 \\to H\\times W';
    g.op('head-act', act, { path: ['head', 'act'], out: 'depth', where: Whead, label: 'ReLU: profundidad relativa ≥ 0 (disparidad afín, sin escala)', type: 'head', group: 'head',
      outMeta: { label: 'Mapa de profundidad relativa (H×W)', tex: '\\hat d' } });
    return g;
  }

  function dParts(c, r) {
    const n = r.totals.byNode, z = { params: 0, macs: 0 };
    const nd = (k) => n[k] || z;
    const enc = ['patch-embed', 'cls', 'pos-embed', 'add-pos', 'encoder', 'taps', 'idle'].reduce((s, k) => ({ params: s.params + nd(k).params, macs: s.macs + nd(k).macs }), { params: 0, macs: 0 });
    const re = nd('reassemble'), fu = nd('fusion'), hd = nd('head');
    return { enc, re, fu, hd, dec: { params: re.params + fu.params + hd.params, macs: re.macs + fu.macs + hd.macs } };
  }
  function dQuantities(c, r) {
    const p = dParts(c, r);
    return {
      tokens: c.tokens, patches: c.N, grid: c.g, res: c.H, P: c.P, D: c.D, L: c.L, h: c.h, F: c.F, outH: c.H, outW: c.W,
      encoderParams: p.enc.params, decoderParams: p.dec.params, reassembleParams: p.re.params, fusionParams: p.fu.params, headParams: p.hd.params,
      encoderMacs: p.enc.macs, decoderMacs: p.dec.macs, reassembleMacs: p.re.macs, fusionMacs: p.fu.macs, headMacs: p.hd.macs,
      branch1: c.sizes[0], branch2: c.sizes[1], branch3: c.sizes[2], branch4: c.sizes[3], posRows: c.posRows,
    };
  }
  function dMetrics(c, r, o) {
    const p = dParts(c, r), t = r.totals;
    const act = inferAct(r, o);
    const hw = hwRows(t.macs, t.params, act, o.B);
    const out = {
      tokens: c.tokens, patches: c.N, grid: c.g, res: c.H, P: c.P, outH: c.H, outW: c.W, taps: c.taps.slice(),
      encoderParams: p.enc.params, decoderParams: p.dec.params, reassembleParams: p.re.params, fusionParams: p.fu.params, headParams: p.hd.params,
      encoderMacs: p.enc.macs, decoderMacs: p.dec.macs, reassembleMacs: p.re.macs, fusionMacs: p.fu.macs, headMacs: p.hd.macs,
      decoderMacsShare: p.dec.macs / t.macs, decoderParamsShare: p.dec.params / t.params, encoderMacsShare: p.enc.macs / t.macs,
      scales: c.sizes.map((s, i) => ({ branch: i + 1, factor: c.factors[i], size: s, stride: c.H / s, channels: c.neck[i] })),
      fullResHeadMacs: (r.ops.find((x) => x.id === 'head-conv2') || { macs: 0 }).macs + (r.ops.find((x) => x.id === 'head-conv3') || { macs: 0 }).macs,
      msOrin: hw[0].ms, fpsOrin: hw[0].fps, boundOrin: hw[0].bound, msH100: hw[1].ms, fpsH100: hw[1].fps, boundH100: hw[1].bound,
      hardware: hw, hardwareSource: ORIN.source + ' · ' + H100.source, estimate: true,
      units: D_UNITS,
    };
    out.fullResHeadMacsShare = out.fullResHeadMacs / t.macs;
    const res0 = c.H, P = c.P, step = c.fusionUp === 'x2' ? 2 * P : P;
    const list = [Math.round(256 / step) * step, Math.round(384 / step) * step, Math.round(518 / step) * step, Math.round(768 / step) * step, Math.round(1024 / step) * step]
      .filter((v, i, a) => a.indexOf(v) === i);
    out.resScaling = guarded(() => list.map((res) => {
      const rr = res === res0 ? r : A.run(r.id, { res }), pp = dParts(rr.config, rr), m = rr.totals;
      const am = res === res0 ? act : inferAct(rr, { actMemPerSample: A.metrics(r.id, { res }).actMemPerSample, by: 2 });
      const o2 = roof(m.macs, m.params, am, ORIN, 1);
      return { res, tokens: rr.config.tokens, macs: m.macs, encoderMacs: pp.enc.macs, decoderMacs: pp.dec.macs, decoderMacsShare: pp.dec.macs / m.macs, fpsOrin: o2.fps };
    }));
    return out;
  }
  const D_UNITS = {
    encoderParams: 'params', decoderParams: 'params', reassembleParams: 'params', fusionParams: 'params', headParams: 'params',
    encoderMacs: 'macs', decoderMacs: 'macs', reassembleMacs: 'macs', fusionMacs: 'macs', headMacs: 'macs', fullResHeadMacs: 'macs',
    decoderMacsShare: 'pct', decoderParamsShare: 'pct', encoderMacsShare: 'pct', fullResHeadMacsShare: 'pct',
    tokens: 'count', patches: 'count', grid: 'count', res: 'count', P: 'count', outH: 'count', outW: 'count',
    msOrin: 'ms', msH100: 'ms', fpsOrin: 'ratio', fpsH100: 'ratio',
  };

  A.defineModel({
    id: 'depth',
    label: 'Profundidad monocular: DPT y Depth Anything V2',
    paper: { title: 'Depth Anything V2', authors: 'Yang et al.', venue: 'NeurIPS 2024', year: 2024, arxiv: '2406.09414',
      note: 'DPT: Ranftl et al., Vision Transformers for Dense Prediction, ICCV 2021, arXiv:2103.13413. MiDaS: Ranftl et al., TPAMI 2022, arXiv:1907.01341. Depth Anything (V1): Yang et al., CVPR 2024, arXiv:2401.10891.' },
    configs: DEPTH_CONFIGS,
    // res: múltiplos de 14 para Depth Anything (252…728) y de 32 para DPT-Large (384, 768); el explorador apaga los que no valen
    // para la config (invalidReason), y cada config tiene al menos un valor distinto de su base.
    knobs: { res: [252, 364, 384, 518, 616, 728, 768] },
    hardware: HW.map((h) => Object.assign({}, h)),
    applyKnobs: dApply,
    resolve: dResolve,
    build: dBuild,
    quantities: dQuantities,
    metrics: dMetrics,
  });

  // ============================================================== pointnet
  const PN_SRC = 'Qi et al., PointNet, CVPR 2017, arXiv:1612.00593; código oficial charlesq34/pointnet (TF): ';
  const PN_CONFIGS = {
    'pointnet-cls': { label: 'PointNet · clasificación ModelNet40 (N = 1,024)', canonical: true, arch: 'pointnet', task: 'cls', N: 1024, K: 40, tnet: 1,
      source: PN_SRC + 'models/pointnet_cls.py y transform_nets.py (T-Net de entrada 3×3 y de features 64×64; conv 64-64 y 64-128-1024; fc 512-256-40 con dropout keep 0.7; BN en todo salvo la última capa), train.py --num_point 1024.' },
    'pointnet-seg': { label: 'PointNet · segmentación de partes (N = 2,048, 50 partes)', arch: 'pointnet', task: 'seg', N: 2048, K: 50, tnet: 1,
      source: PN_SRC + 'models/pointnet_seg.py (la red de segmentación de la Fig. 2: concat 64 + 1024 = 1088 → 512-256-128-128 → 50); N = 2,048 como part_seg/train.py. Los números de partes del paper usan part_seg/pointnet_part_seg.py, una variante más grande (concatena out1…out5 y la etiqueta de categoría).' },
    'pointnet-cls-no-tnet': { label: 'PointNet sin T-Nets (vanilla)', arch: 'pointnet', task: 'cls', N: 1024, K: 40, tnet: 0, dropouts: 1,
      source: PN_SRC + 'models/pointnet_cls_basic.py (conv 64-64-64-128-1024, fc 512-256-40, un solo dropout): la arquitectura de pointnet_cls sin las dos T-Nets.' },
    'pointnet2-ssg-cls': { label: 'PointNet++ SSG · clasificación (N = 1,024)', arch: 'pointnet2', task: 'cls', N: 1024, K: 40, tnet: 0,
      sa: [{ S: 512, r: 0.2, k: 32, mlp: [64, 64, 128] }, { S: 128, r: 0.4, k: 64, mlp: [128, 128, 256] }, { all: true, mlp: [256, 512, 1024] }],
      source: 'Qi et al., PointNet++, NeurIPS 2017, arXiv:1706.02413; charlesq34/pointnet2 models/pointnet2_cls_ssg.py: SA1 512 centros, r 0.2, 32 vecinos, MLP 64-64-128; SA2 128, r 0.4, 64, MLP 128-128-256; SA3 group_all 256-512-1024; use_xyz (+3 canales: xyz relativo al centro en SA1 y SA2, absoluto en SA3 con group_all, sample_and_group_all de utils/pointnet_util.py); fc 512-256-40 con dropout keep 0.5.' },
  };
  function pnApply(c, ov) {
    const notes = [];
    if (ov.N !== undefined) c.N = ov.N;
    if (ov.tnet !== undefined) {
      if (c.arch !== 'pointnet') throw new Error('El knob tnet solo aplica a PointNet (PointNet++ no tiene T-Nets).');
      if (ov.tnet > 1) throw new Error('tnet vale 0 o 1.');
      c.tnet = ov.tnet;
    }
    if (c.arch === 'pointnet2' && c.N < c.sa[0].S) throw new Error('PointNet++: N = ' + c.N + ' es menor que los ' + c.sa[0].S + ' centros de SA1.');
    Object.keys(ov).forEach((k) => notes.push(k + ' = ' + ov[k] + ' (what-if)'));
    c._notes = notes;
    return c;
  }
  function pnResolve(c) { c.tokens = c.N; return c; }

  function pnBuild(c) {
    const g = A.graph(c);
    const pts = g.input('points', shp(['N', '3'], [c.N, 3], 'lat', 'seq'), { label: 'Nube de puntos: N puntos (x, y, z) sin orden', tex: 'X' });
    const mlp = (id, x, cout, path, out, o) => g.op(id, A.point_mlp(x, Object.assign({ cout }, o && o.prim)), Object.assign({ path, out, label: (o && o.label) || ('MLP compartido ' + x.num[x.num.length - 1] + ' → ' + cout + ' (+ BN + ReLU)'), type: 'mlp', group: 'mlp',
      outMeta: { label: (o && o.olabel) || ('Feature de ' + cout + ' por punto'), tex: (o && o.tex) || out } }, o && o.where ? { where: o.where } : {}));
    if (c.arch === 'pointnet2') return pn2Build(c, g, pts, mlp);
    const tnet = (pre, x, K, root) => {
      const W = [root === 'input-tnet' ? 'T-Net de entrada (3×3)' : 'T-Net de features (64×64)'], P = [root];
      const h1 = mlp(pre + '-mlp1', x, 64, P.concat(['tconv1']), pre + '-h1', { where: W });
      const h2 = mlp(pre + '-mlp2', h1, 128, P.concat(['tconv2']), pre + '-h2', { where: W });
      const h3 = mlp(pre + '-mlp3', h2, 1024, P.concat(['tconv3']), pre + '-h3', { where: W });
      const gp = g.op(pre + '-pool', A.max_pool_points(h3), { path: P.concat(['tmaxpool']), out: pre + '-g', where: W, label: 'Max-pool sobre los puntos', type: 'attn', group: 'attn', outMeta: { label: 'Feature global de la T-Net', tex: 'g_T' } });
      const f1 = mlp(pre + '-fc1', gp, 512, P.concat(['tfc1']), pre + '-f1', { where: W, label: 'FC 1024 → 512 (+ BN + ReLU)' });
      const f2 = mlp(pre + '-fc2', f1, 256, P.concat(['tfc2']), pre + '-f2', { where: W, label: 'FC 512 → 256 (+ BN + ReLU)' });
      return g.op(pre + '-transform', A.tnet_transform(f2, { K }), { path: P.concat(['transform']), out: K === 3 ? 't-in' : 't-feat', where: W,
        label: 'FC 256 → ' + K + '² (W = 0, b = I) → matriz ' + K + '×' + K, type: 'head', group: 'head', outMeta: { label: 'Matriz de alineación ' + K + '×' + K, tex: K === 3 ? 'A_{3}' : 'A_{64}' } });
    };
    let x = pts;
    if (c.tnet) {
      const Tin = tnet('itn', pts, 3, 'input-tnet');
      x = g.op('itn-apply', A.point_transform(pts, Tin), { path: ['input-tnet', 'apply'], out: 'points-t', where: ['T-Net de entrada (3×3)'], label: 'Alinear la nube: X·A₃', type: 'attn', group: 'attn', outMeta: { label: 'Puntos alineados', tex: 'XA_3' } });
    }
    const h1 = mlp('conv1', x, 64, ['shared-mlp-1', 'conv1'], 'h1');
    const h2 = mlp('conv2', h1, 64, ['shared-mlp-1', 'conv2'], 'h2');
    let h = h2;
    if (c.tnet) {
      const Tf = tnet('ftn', h2, 64, 'feature-tnet');
      h = g.op('ftn-apply', A.point_transform(h2, Tf), { path: ['feature-tnet', 'apply'], out: 'h2-t', where: ['T-Net de features (64×64)'], label: 'Alinear las features: H·A₆₄', type: 'attn', group: 'attn', outMeta: { label: 'Features alineadas (64 por punto)', tex: 'HA_{64}' } });
    }
    const h3 = mlp('conv3', h, 64, ['shared-mlp-2', 'conv3'], 'h3');
    const h4 = mlp('conv4', h3, 128, ['shared-mlp-2', 'conv4'], 'h4');
    const h5 = mlp('conv5', h4, 1024, ['shared-mlp-2', 'conv5'], 'h5', { olabel: 'Feature de 1024 por punto (antes del max-pool)' });
    const gl = g.op('max-pool', A.max_pool_points(h5, { note: 'función simétrica: invariante a permutaciones de los puntos' }), { path: ['maxpool'], out: 'global', label: 'Max-pool sobre los N puntos (simétrico)', type: 'attn', group: 'attn',
      outMeta: { label: 'Feature global (1024): el máximo de cada canal', tex: 'g = \\max_i h_i' } });
    if (c.task === 'seg') {
      const W = ['Cabeza de segmentación'];
      const cat = g.op('seg-concat', A.concat_global(h, gl), { path: ['seg-head', 'concat'], out: 'concat', where: W, label: 'Concatenar a cada punto su feature local (64) y la global (1024)', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Local + global por punto (1088)', tex: '[h_i;\\,g]' } });
      const s6 = mlp('conv6', cat, 512, ['seg-head', 'conv6'], 's6', { where: W });
      const s7 = mlp('conv7', s6, 256, ['seg-head', 'conv7'], 's7', { where: W });
      const s8 = mlp('conv8', s7, 128, ['seg-head', 'conv8'], 's8', { where: W });
      const s9 = mlp('conv9', s8, 128, ['seg-head', 'conv9'], 's9', { where: W });
      mlp('conv10', s9, c.K, ['seg-head', 'conv10'], 'point-logits', { where: W, prim: { bn: false, relu: false, coutSym: 'K' }, label: 'Conv 1×1 128 → K (logits por punto, sin BN)', olabel: 'Logits de parte por punto', tex: 'Y' });
      return g;
    }
    const W = ['Cabeza de clasificación'];
    // pointnet_cls.py: dropout tras fc1 y fc2; pointnet_cls_basic.py (sin T-Nets): uno solo, tras fc2.
    const f1 = mlp('fc1', gl, 512, ['head', 'fc1'], 'f1', { where: W, label: 'FC 1024 → 512 (+ BN + ReLU' + (c.dropouts === 1 ? ')' : '; dropout)') });
    const f2 = mlp('fc2', f1, 256, ['head', 'fc2'], 'f2', { where: W, label: 'FC 512 → 256 (+ BN + ReLU; dropout)' });
    mlp('fc3', f2, c.K, ['head', 'fc3'], 'logits', { where: W, prim: { bn: false, relu: false, coutSym: 'K' }, label: 'FC 256 → K = ' + c.K + ' (logits)', olabel: 'Logits de clase', tex: 'z' });
    return g;
  }
  function pn2Build(c, g, pts, mlp) {
    let xyz = pts, feats = null, Cprev = 0;
    c.sa.forEach((s, j) => {
      const sa = 'sa' + (j + 1), W = ['Set abstraction ' + (j + 1)];
      let grp;
      if (s.all) {
        // group_all: un único grupo con todos los centros que quedan: [xyz; features] → 1 × S × (3 + C) (aquí S × (3 + C)).
        grp = g.op(sa + '-group', A.concat_global(xyz, feats, { sym: String(3 + Cprev) }), { path: [sa, 'group'], out: sa + '-grouped', where: W,
          label: 'Agrupar todo: [xyz absoluto; features] de los ' + xyz.num[0] + ' centros', type: 'tensorop', group: 'embed', outMeta: { label: 'Un solo grupo con todos los puntos', tex: '[X;\\,H]' } });
      } else {
        const ctr = g.op(sa + '-fps', A.fps_sample(xyz, { S: s.S, sym: 'S_' + (j + 1) }), { path: [sa, 'fps'], out: sa + '-xyz', where: W, label: 'Farthest point sampling: ' + s.S + ' centros', type: 'attn', group: 'attn',
          outMeta: { label: s.S + ' centros bien repartidos', tex: 'X_{' + (j + 1) + '}' } });
        const idx = g.op(sa + '-ball', A.ball_query(xyz, ctr, { k: s.k, r: s.r, kSym: 'k_' + (j + 1) }), { path: [sa, 'ball-query'], out: sa + '-idx', where: W, label: 'Ball query: hasta ' + s.k + ' vecinos a radio ' + s.r, type: 'attn', group: 'attn',
          outMeta: { label: 'Índices de los vecinos de cada centro', tex: '\\mathcal N' } });
        const gr = A.group_points(idx, ctr, feats, { sym: String(3 + Cprev) });
        grp = g.op(sa + '-group', gr, { path: [sa, 'group'], in: [sa + '-idx', sa + '-xyz'].concat(feats ? [feats.id] : []), out: sa + '-grouped', where: W,
          label: 'Agrupar: xyz relativo al centro' + (feats ? ' + features (' + Cprev + ')' : ''), type: 'tensorop', group: 'embed', outMeta: { label: 'Regiones locales', tex: 'G_{' + (j + 1) + '}' } });
        xyz = ctr;
      }
      let h = grp;
      s.mlp.forEach((co, q) => { h = mlp(sa + '-mlp' + (q + 1), h, co, [sa, 'mlp' + (q + 1)], sa + '-h' + (q + 1), { where: W }); });
      feats = g.op(sa + '-pool', A.max_pool_points(h), { path: [sa, 'maxpool'], out: s.all ? 'global' : sa + '-out', where: W, label: s.all ? 'Max-pool global sobre los ' + h.num[0] + ' centros' : 'Max-pool dentro de cada región', type: 'attn', group: 'attn',
        outMeta: { label: s.all ? 'Feature global (1024)' : 'Una feature de ' + s.mlp[s.mlp.length - 1] + ' por centro', tex: s.all ? 'g' : 'H_{' + (j + 1) + '}' } });
      Cprev = s.mlp[s.mlp.length - 1];
    });
    const W = ['Cabeza de clasificación'];
    const f1 = mlp('fc1', feats, 512, ['head', 'fc1'], 'f1', { where: W, label: 'FC 1024 → 512 (+ BN + ReLU; dropout 0.5)' });
    const f2 = mlp('fc2', f1, 256, ['head', 'fc2'], 'f2', { where: W, label: 'FC 512 → 256 (+ BN + ReLU; dropout 0.5)' });
    mlp('fc3', f2, c.K, ['head', 'fc3'], 'logits', { where: W, prim: { bn: false, relu: false, coutSym: 'K' }, label: 'FC 256 → K = ' + c.K + ' (logits)', olabel: 'Logits de clase', tex: 'z' });
    return g;
  }

  function pnParts(c, r) {
    // MACs que escalan con N (por punto) vs los que no (fc de las T-Nets y de la cabeza: sobre un vector).
    let perPoint = 0, global = 0, pool = 0;
    for (const op of r.ops) {
      if (op.prim === 'max_pool_points') pool += op.other;
      const vec = op.in.length && r.tensors[op.in[0]].layout === 'vec';
      if (vec) global += op.macs; else perPoint += op.macs;
    }
    const n = r.totals.byNode, z = { params: 0, macs: 0 };
    const itn = n['input-tnet'] || z, ftn = n['feature-tnet'] || z;
    // Cota de puntos críticos = criticalMax del max-pool global (min(entradas, canales)): min(N, 1024) en PointNet; en PointNet++ el
    // pool global ve los 128 centros de SA2, así que ≤ 128 aunque N crezca.
    const gp = r.ops.find((x) => x.id === 'max-pool' || x.id === 'sa3-pool');
    const crit = gp && gp.detail && gp.detail.criticalMax != null ? gp.detail.criticalMax : Math.min(c.N, 1024);
    return { perPoint, global, pool, itn, ftn, crit, poolGlobal: gp ? gp.other : 0 };
  }
  function pnQuantities(c, r) {
    const p = pnParts(c, r);
    const q = { N: c.N, K: c.K, tokens: c.N, inputTnetParams: p.itn.params, featureTnetParams: p.ftn.params, tnetParams: p.itn.params + p.ftn.params,
      perPointMacs: p.perPoint, globalMacs: p.global, macsPerPoint: p.perPoint / c.N, maxpoolOps: p.pool, criticalPointsMax: p.crit, globalDim: 1024 };
    return q;
  }
  function pnMetrics(c, r, o) {
    const p = pnParts(c, r), t = r.totals;
    const act = inferAct(r, o);
    const hw = hwRows(t.macs, t.params, act, o.B);
    const sumOther = (prim) => r.ops.filter((x) => x.prim === prim).reduce((s, x) => s + x.other * x.repeat, 0);
    const out = {
      N: c.N, K: c.K, params: t.params, macs: t.macs,
      inputTnetParams: p.itn.params, featureTnetParams: p.ftn.params, tnetParams: p.itn.params + p.ftn.params, tnetParamsShare: (p.itn.params + p.ftn.params) / t.params,
      tnetMacs: p.itn.macs + p.ftn.macs, tnetMacsShare: (p.itn.macs + p.ftn.macs) / t.macs,
      perPointMacs: p.perPoint, globalMacs: p.global, macsPerPoint: p.perPoint / c.N, perPointMacsShare: p.perPoint / t.macs,
      maxpoolOps: p.pool, maxpoolShare: p.pool / (2 * t.macs + p.pool), globalDim: 1024, criticalPointsMax: p.crit,
      maxpoolOpsGlobal: p.poolGlobal,
      orthoRegMacs: c.tnet && c.arch === 'pointnet' ? 64 * 64 * 64 : 0,
      msOrin: hw[0].ms, fpsOrin: hw[0].fps, boundOrin: hw[0].bound, msH100: hw[1].ms, fpsH100: hw[1].fps, boundH100: hw[1].bound,
      hardware: hw, hardwareSource: ORIN.source + ' · ' + H100.source, estimate: true,
      units: PN_UNITS,
    };
    if (c.arch === 'pointnet2') Object.assign(out, { fpsOps: sumOther('fps_sample'), ballQueryOps: sumOther('ball_query'), groupOps: sumOther('group_points'),
      samplingShare: (sumOther('fps_sample') + sumOther('ball_query')) / (2 * t.macs + sumOther('fps_sample') + sumOther('ball_query')) });
    const arch = {};
    Object.keys(r.overrides || {}).forEach((k) => { if (k in A.model('pointnet').knobs) arch[k] = r.overrides[k]; });
    out.nScaling = guarded(() => [512, 1024, 2048, 4096, 16384].filter((N) => c.arch !== 'pointnet2' || N >= c.sa[0].S).map((N) => {
      const rr = A.run(r.id, Object.assign({}, arch, { N })), pp = pnParts(rr.config, rr);
      const mm = A.metrics(r.id, Object.assign({}, arch, { N }));
      return { N, macs: rr.totals.macs, perPointMacs: pp.perPoint, maxpoolOps: pp.pool, criticalPointsMax: pp.crit, fpsOrin: roof(rr.totals.macs, rr.totals.params, mm.actMemPerSample / mm.bytesPerElement * 2, ORIN, 1).fps };
    }));
    return out;
  }
  const PN_UNITS = {
    params: 'params', inputTnetParams: 'params', featureTnetParams: 'params', tnetParams: 'params', tnetParamsShare: 'pct', tnetMacs: 'macs', tnetMacsShare: 'pct',
    macs: 'macs', perPointMacs: 'macs', globalMacs: 'macs', macsPerPoint: 'count', perPointMacsShare: 'pct', maxpoolOps: 'count', maxpoolOpsGlobal: 'count', maxpoolShare: 'pct',
    globalDim: 'count', criticalPointsMax: 'count', orthoRegMacs: 'macs', N: 'count', K: 'count', fpsOps: 'count', ballQueryOps: 'count', groupOps: 'count', samplingShare: 'pct',
    msOrin: 'ms', msH100: 'ms', fpsOrin: 'ratio', fpsH100: 'ratio',
  };

  A.defineModel({
    id: 'pointnet',
    label: 'PointNet y PointNet++ (nubes de puntos)',
    paper: { title: 'PointNet: Deep Learning on Point Sets for 3D Classification and Segmentation', authors: 'Qi et al.', venue: 'CVPR 2017', year: 2017, arxiv: '1612.00593',
      note: 'PointNet++: Qi et al., Deep Hierarchical Feature Learning on Point Sets in a Metric Space, NeurIPS 2017, arXiv:1706.02413.' },
    configs: PN_CONFIGS,
    knobs: { N: [512, 1024, 2048, 4096, 16384], tnet: [0, 1] },
    zeroKnobs: ['tnet'],
    hardware: HW.map((h) => Object.assign({}, h)),
    applyKnobs: pnApply,
    resolve: pnResolve,
    build: pnBuild,
    quantities: pnQuantities,
    metrics: pnMetrics,
  });

  A.perception = { hardware: () => HW.map((h) => Object.assign({}, h)), yoloxMot17: Object.assign({}, YOLOX_X_MOT17), kalmanCost: A.kalmanCost, roof };
})(typeof window !== 'undefined' ? window : globalThis);
