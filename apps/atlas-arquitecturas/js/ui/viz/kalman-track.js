/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/kalman-track.js
   Visualización "kalman-track" (SPEC §7.8, §26.5): un filtro de Kalman 2-D de velocidad constante siguiendo a UN objeto.
   Datos ILUSTRATIVOS: una trayectoria verdadera de T = 72 frames (un peatón que acelera y dobla: el modelo de velocidad
   constante no es exacto, por eso hace falta Q), detecciones = verdad + ruido gaussiano (σ = 6 px, semilla fija) y una
   oclusión de k frames sin detección (0, 12 o más que el track_buffer de la config).
   Filtro (dt = 1 frame, como ByteTrack): estado x = (p_x, p_y, v_x, v_y) ∈ ℝ⁴, medición z = (p_x, p_y) ∈ ℝ².
       predict:  x⁻ = F x,   P⁻ = F P Fᵀ + Q          F = [[I, I], [0, I]] (4×4)
       update:   y = z − H x⁻,  S = H P⁻ Hᵀ + R,  K = P⁻ Hᵀ S⁻¹,  x = x⁻ + K y,  P = (I − K H) P⁻   (H = [I 0], 2×4; K 4×2)
   Q = q·[[¼I, ½I], [½I, I]] (ruido de aceleración blanco discreto, varianza q) y R = r²·I; q y r son los sliders: lo que el
   FILTRO supone, no el ruido real. En la oclusión solo hay predict: la elipse (95 %, χ²₂ = 5.991) crece. Si la oclusión dura
   más que max_time_lost = ⌊fps/30 · track_buffer⌋ frames (la regla de ByteTrack), el track se borra y el objeto vuelve con un
   id nuevo. ByteTrack usa el mismo filtro con x ∈ ℝ⁸ (x, y, a, h y sus velocidades) y z ∈ ℝ⁴, con Q y R proporcionales a la
   altura h de la caja.
   Números del calculador (no ilustrativos): track_buffer, fps y los tamaños de estado y medición de la config
   (ATLAS.Arch.run / metrics; bytetrack-mot17 por omisión).
   params: { config:'bytetrack-mot17', q:0.5, r:6, occ:'short'|'none'|'long', t:<frame> }
   Puro (sin DOM) para tests: ATLAS.Viz.kalman = { predict, update, filter, ellipse, track }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9]{1,2}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const T = 72, SIG = 6, OCC0 = 30, IMW = 640, IMH = 300;
  const CHI95 = 5.991;                                                 // χ² con 2 grados de libertad al 95 %

  // ---- álgebra chica (matrices como arreglos de filas)
  const mm = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
  const tr = (A) => A[0].map((_, j) => A.map((row) => row[j]));
  const add = (A, B) => A.map((row, i) => row.map((a, j) => a + B[i][j]));
  const mv = (A, x) => A.map((row) => row.reduce((s, a, k) => s + a * x[k], 0));
  const inv2 = (S) => { const d = S[0][0] * S[1][1] - S[0][1] * S[1][0]; return [[S[1][1] / d, -S[0][1] / d], [-S[1][0] / d, S[0][0] / d]]; };
  const F = [[1, 0, 1, 0], [0, 1, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]];
  const H = [[1, 0, 0, 0], [0, 1, 0, 0]];
  const Qof = (q) => [[q / 4, 0, q / 2, 0], [0, q / 4, 0, q / 2], [q / 2, 0, q, 0], [0, q / 2, 0, q]];
  const Rof = (r) => [[r * r, 0], [0, r * r]];

  function predict(x, P, Q) { return { x: mv(F, x), P: add(mm(mm(F, P), tr(F)), Q) }; }
  function update(x, P, z, R) {
    const PHt = mm(P, tr(H));                                          // 4×2
    const S = add(mm(H, PHt), R);                                      // 2×2
    const K = mm(PHt, inv2(S));                                        // 4×2
    const y = [z[0] - x[0], z[1] - x[1]];                              // innovación
    const xn = x.map((v, i) => v + K[i][0] * y[0] + K[i][1] * y[1]);
    const KH = mm(K, H);
    const IKH = KH.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v));
    return { x: xn, P: mm(IKH, P), K, S, y };
  }
  // elipse de la covarianza de posición 2×2 (semiejes al 95 %)
  function ellipse(P) {
    const a = P[0][0], b = P[0][1], c = P[1][1];
    const m = (a + c) / 2, d = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b));
    const l1 = m + d, l2 = Math.max(0, m - d);
    const ang = Math.abs(b) < 1e-12 ? (a >= c ? 0 : Math.PI / 2) : Math.atan2(l1 - a, b);
    const k = Math.sqrt(CHI95);
    return { rx: k * Math.sqrt(l1), ry: k * Math.sqrt(l2), ang };
  }

  // trayectoria verdadera (px de un frame de 640×300) y detecciones con ruido; la semilla no depende de q, r ni la oclusión
  function track(seed) {
    const R = ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(seed || 1602) : Math.random;
    const truth = [], noise = [];
    for (let t = 0; t < T; t++) {
      const s = t / (T - 1);
      // acelera hacia la derecha y dobla hacia arriba en la segunda mitad
      truth.push([50 + 430 * s + 90 * s * s, 255 - 40 * s - 150 * Math.max(0, s - 0.45) ** 2 * 3.2 + 8 * Math.sin(5 * Math.PI * s)]);
      noise.push([SIG * R.normal(), SIG * R.normal()]);
    }
    return { truth, noise };
  }
  // corre el filtro sobre los T frames; occ = [inicio, largo); maxLost = frames sin detección antes de borrar el track
  function filter(tk, q, r, occ, maxLost) {
    const Q = Qof(q), R = Rof(r);
    const meas = tk.truth.map((p, t) => (t >= occ[0] && t < occ[0] + occ[1] ? null : [p[0] + tk.noise[t][0], p[1] + tk.noise[t][1]]));
    const steps = [];
    let x = null, P = null, lost = 0, id = 1, born = 0, goneAt = null;
    for (let t = 0; t < T; t++) {
      const z = meas[t];
      if (!x) {
        // inicializa en la primera detección: posición = z, velocidad 0 con incertidumbre grande
        if (z) { x = [z[0], z[1], 0, 0]; P = [[r * r, 0, 0, 0], [0, r * r, 0, 0], [0, 0, 100, 0], [0, 0, 0, 100]]; lost = 0; born = t; }
        steps.push({ t, z, x: x && x.slice(), P, prior: null, id: x ? id : null, born: x ? t : null, lost: 0, removed: false, newId: !!x && id > 1, goneAt: x ? null : goneAt });
        continue;
      }
      const pr = predict(x, P, Q);
      if (z) {
        const u = update(pr.x, pr.P, z, R);
        x = u.x; P = u.P; lost = 0;
        steps.push({ t, z, x: x.slice(), P, prior: pr, K: u.K, S: u.S, y: u.y, id, born, lost: 0 });
      } else {
        x = pr.x; P = pr.P; lost++;
        const removed = lost > maxLost;
        steps.push({ t, z: null, x: x.slice(), P, prior: pr, id, born, lost, removed });
        if (removed) { x = null; P = null; id++; goneAt = t; }                      // borrado: la próxima detección abre un id nuevo
      }
    }
    return { meas, steps };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const cfgId = params.config || 'bytetrack-mot17';
    let run = null, met = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { met = A.metrics(cfgId); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const pick = (o, ks, d) => { for (const k of ks) { const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o); if (Number.isFinite(v)) return v; } return d; };
    // metrics primero (claves del contrato de perception.js), después la config
    const fps = pick(met, ['fps'], pick(cfg, ['fps', 'frameRate'], 30)), buffer = pick(met, ['trackBuffer'], pick(cfg, ['trackBuffer', 'track_buffer', 'buffer'], 30));
    const maxLost = Math.floor(pick(met, ['framesLost'], Math.floor(fps / 30 * buffer)));
    const sDim = pick(met, ['stateDim'], 8), mDim = pick(met, ['measDim'], 4);
    const OCC = { none: 0, short: 12, long: maxLost + 6 };
    const state = {
      q: Number.isFinite(+params.q) && params.q !== '' && params.q != null ? +params.q : 0.5,
      r: Number.isFinite(+params.r) && params.r !== '' && params.r != null ? +params.r : SIG,
      occ: OCC[params.occ] != null ? params.occ : 'short',
      t: Number.isFinite(+params.t) && params.t != null && params.t !== '' ? Math.max(0, Math.min(T - 1, +params.t)) : OCC0 + 8,
    };
    const tk = track(1602);

    const wrap = V.html('div', { class: 'viz viz-kf' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._v = v; b._k = key; return b; });
    };
    const cO = chipGroup('Oclusión', [['none', 'sin'], ['short', OCC.short + ' frames'], ['long', OCC.long + ' frames (> buffer)']], 'occ');
    // sliders en escala logarítmica: q ∈ [0.01, 50], r ∈ [0.5, 60] px
    const slider = (label, key, lo, hi, fmtv, aria) => {
      const g = V.html('label', { class: 'viz-ctl viz-kf-sl' }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label, style: 'text-transform:none' }, g);
      const inp = V.html('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': aria }, g);
      const o = V.html('output', { class: 'viz-kf-out' }, g);
      const toV = (u) => lo * Math.pow(hi / lo, u / 100), toU = (v) => Math.round(100 * Math.log(v / lo) / Math.log(hi / lo));
      inp.addEventListener('input', () => { state[key] = +toV(+inp.value).toPrecision(2); draw(); });
      return { sync() { inp.value = toU(state[key]); o.textContent = fmtv(state[key]); } };
    };
    const sQ = slider('Q: q', 'q', 0.01, 50, (v) => 'q = ' + v, 'Ruido de proceso q que supone el filtro (escala logarítmica, 0.01 a 50)');
    const sR = slider('R: r', 'r', 0.5, 60, (v) => 'r = ' + v + ' px', 'Ruido de medición r que supone el filtro, en píxeles (escala logarítmica, 0.5 a 60)');
    const gT = V.html('label', { class: 'viz-ctl viz-kf-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Frame' }, gT);
    const inT = V.html('input', { type: 'range', min: 0, max: T - 1, step: 1, 'aria-label': 'Frame que se muestra (0 a ' + (T - 1) + ')' }, gT);
    const outT = V.html('output', { class: 'viz-kf-out' }, gT);
    inT.addEventListener('input', () => { state.t = +inT.value; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-kf-stage', tabindex: 0, role: 'group', 'aria-label': 'Filtro de Kalman sobre una trayectoria. Flechas: frame anterior o siguiente; Inicio y Fin: primer y último frame' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, sub('Trayectoria y detecciones sintéticas (ruido real σ = ' + SIG + ' px; el objeto acelera y dobla, así que velocidad constante es solo una aproximación). Cada frame: <b>predict</b> (x⁻ = F x, P⁻ = F P Fᵀ + Q) y, si hay detección, <b>update</b> (K = P⁻Hᵀ(HP⁻Hᵀ + R)⁻¹, x = x⁻ + K(z − Hx⁻), P = (I − KH)P⁻). q y r son lo que el filtro SUPONE: r grande → confía en su predicción (suave, pero llega tarde a las curvas); q grande → confía en la detección (sigue el ruido). En la oclusión solo hay predict y la elipse (95 %) crece. Si dura más de max_time_lost frames, el track se borra y el objeto vuelve con otro id: un ID switch. Juguete en 2-D: ByteTrack usa estado de ' + sDim + ' y medición de ' + mDim + ' (la caja entera), con Q y R proporcionales a la altura de la caja.'));

    let lastNarrow = null;
    function draw() {
      cO.forEach((b) => b.setAttribute('aria-pressed', String(state.occ === b._v)));
      sQ.sync(); sR.sync(); inT.value = state.t; outT.textContent = 't = ' + state.t;
      const occ = [OCC0, OCC[state.occ]];
      const res = filter(tk, state.q, state.r, occ, maxLost);
      const st = res.steps[state.t];
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(560, cw)) : 860;
      const sc = (W - 16) / IMW, IH = IMH * sc, X0 = 8, Y0 = 40;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      // plain = sin subíndices ("max_time_lost" es un nombre del código, no x con subíndice)
      const t = (p, x, y, s, cls, anchor, plain) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); if (plain) e.textContent = s; else V.rich(e, s); return e; };
      const PX = (p) => [X0 + p[0] * sc, Y0 + p[1] * sc];
      t(svg, 8, 15, narrow ? 'Kalman: predecir y corregir con la detección' : 'Filtro de Kalman (velocidad constante): predecir dónde estará y corregir con la detección', 'viz-t');
      t(svg, 8, 29, 'q = ' + state.q + ' · r = ' + state.r + ' px · oclusión: ' + (occ[1] ? (narrow ? '' : 'frames ') + occ[0] + '–' + (occ[0] + occ[1] - 1) : 'ninguna') + (narrow ? '' : ' · max_time_lost = ' + maxLost), 'viz-s', null, true);
      V.svg('rect', { x: X0, y: Y0, width: r1(IMW * sc), height: r1(IH), class: 'viz-kf-bg' }, svg);
      if (occ[1]) {
        const a = PX(tk.truth[occ[0]]), b = PX(tk.truth[Math.min(T - 1, occ[0] + occ[1] - 1)]);
        const x0 = Math.min(a[0], b[0]) - 14 * sc, x1 = Math.max(a[0], b[0]) + 14 * sc;
        V.svg('rect', { x: r1(x0), y: Y0, width: r1(x1 - x0), height: r1(IH), class: 'viz-kf-occ' }, svg);
        t(svg, (x0 + x1) / 2, Y0 + 14, 'oclusión', 'viz-kf-occt', 'middle');
      }
      // verdad (punteada), detecciones (puntos), trayectoria filtrada (línea; un tramo por id)
      let d = '';
      tk.truth.forEach((p, i) => { const q = PX(p); d += (i ? 'L' : 'M') + r1(q[0]) + ' ' + r1(q[1]); });
      V.svg('path', { d, class: 'viz-kf-true' }, svg);
      res.meas.forEach((z, i) => { if (!z) return; const q = PX(z); V.svg('circle', { cx: r1(q[0]), cy: r1(q[1]), r: i === state.t ? 4 : 2.6, class: 'viz-kf-z' + (i === state.t ? ' is-cur' : '') + (i > state.t ? ' is-fut' : '') }, svg); });
      const segs = {};
      res.steps.forEach((s) => { if (s.x && s.t <= state.t && !s.removed) (segs[s.id] = segs[s.id] || []).push(PX(s.x)); });
      Object.keys(segs).forEach((id) => {
        const pts = segs[id];
        V.svg('path', { d: pts.map((q, i) => (i ? 'L' : 'M') + r1(q[0]) + ' ' + r1(q[1])).join(''), class: 'viz-kf-est' + (+id > 1 ? ' is-new' : '') }, svg);
        const q = pts[0];
        t(svg, q[0] + 4, q[1] + 16, 'id ' + id, 'viz-kf-id' + (+id > 1 ? ' is-new' : ''));
      });
      // elipses del frame actual: la predicción (punteada) y la estimada (llena)
      const ell = (P, c, cls) => { const e = ellipse(P); const q = PX(c); V.svg('ellipse', { cx: r1(q[0]), cy: r1(q[1]), rx: r1(Math.max(1, e.rx * sc)), ry: r1(Math.max(1, e.ry * sc)), transform: 'rotate(' + r1(e.ang * 180 / Math.PI) + ' ' + r1(q[0]) + ' ' + r1(q[1]) + ')', class: cls }, svg); };
      if (st.prior) ell(st.prior.P, st.prior.x, 'viz-kf-ell-pr');
      if (st.x && !st.removed && st.z) ell(st.P, st.x, 'viz-kf-ell');
      if (st.prior) { const q = PX(st.prior.x); V.svg('path', { d: 'M' + r1(q[0] - 5) + ' ' + r1(q[1]) + 'h10M' + r1(q[0]) + ' ' + r1(q[1] - 5) + 'v10', class: 'viz-kf-prx' }, svg); }
      if (st.x && !st.removed) { const q = PX(st.x); V.svg('circle', { cx: r1(q[0]), cy: r1(q[1]), r: 4.2, class: 'viz-kf-xdot' }, svg); }
      // leyenda
      let ly = Y0 + IH + 20, lx = 8;
      const leg = [['line', 'viz-kf-true', 'verdad'], ['dot', 'viz-kf-z', 'detección z'], ['line', 'viz-kf-est', 'estimación x'], ['cross', 'viz-kf-prx', 'predicción x⁻'], ['ell', 'viz-kf-ell-pr', 'P⁻ (95 %)'], ['ell', 'viz-kf-ell', 'P tras update']];
      leg.forEach(([k, cls, s]) => {
        const iw = 26 + s.length * 6.4 + 12;
        if (lx > 8 && lx + iw > W - 8) { lx = 8; ly += 16; }
        if (k === 'line') V.svg('path', { d: 'M' + lx + ' ' + (ly - 4) + 'h18', class: cls }, svg);
        else if (k === 'dot') V.svg('circle', { cx: lx + 9, cy: ly - 4, r: 3, class: cls }, svg);
        else if (k === 'cross') V.svg('path', { d: 'M' + (lx + 4) + ' ' + (ly - 4) + 'h10M' + (lx + 9) + ' ' + (ly - 9) + 'v10', class: cls }, svg);
        else V.svg('ellipse', { cx: lx + 9, cy: ly - 4, rx: 8, ry: 4.5, class: cls }, svg);
        t(svg, lx + 24, ly, s, 'viz-s');
        lx += iw;
      });
      // traza de la incertidumbre (σ de posición) por frame, con la oclusión sombreada
      const gy = ly + 26, gh = narrow ? 64 : 74, gw = W - 16;
      t(svg, 8, gy - 6, narrow ? 'σ de posición √P₀₀ (px) por frame' : 'σ de posición √P₀₀ (px) por frame: crece sin detección, se achica con cada update', 'viz-n');
      V.svg('rect', { x: 8, y: r1(gy), width: r1(gw), height: gh, class: 'viz-kf-bg' }, svg);
      const sig = res.steps.map((s) => (s.x && !s.removed ? Math.sqrt(s.P[0][0]) : null));
      const sMax = Math.max(SIG * 2, ...sig.filter((v) => v != null)) * 1.08;
      const GX = (i) => 8 + gw * i / (T - 1), GY = (v) => gy + gh - gh * v / sMax;
      if (occ[1]) V.svg('rect', { x: r1(GX(occ[0])), y: r1(gy), width: r1(GX(Math.min(T - 1, occ[0] + occ[1])) - GX(occ[0])), height: gh, class: 'viz-kf-occ' }, svg);
      V.svg('path', { d: 'M8 ' + r1(GY(SIG)) + 'H' + r1(8 + gw), class: 'viz-kf-sig' }, svg);
      t(svg, 8 + gw - 4, GY(SIG) - 3, (narrow ? 'σ real = ' : 'σ real de la detección = ') + SIG + ' px', 'viz-s', 'end');
      let dd = '', on = false;
      sig.forEach((v, i) => { if (v == null) { on = false; return; } dd += (on ? 'L' : 'M') + r1(GX(i)) + ' ' + r1(GY(Math.min(v, sMax))); on = true; });
      V.svg('path', { d: dd, class: 'viz-kf-sline' }, svg);
      V.svg('path', { d: 'M' + r1(GX(state.t)) + ' ' + r1(gy) + 'v' + gh, class: 'viz-kf-cur' }, svg);
      t(svg, 8, gy + gh + 13, '0', 'viz-s'); t(svg, 8 + gw, gy + gh + 13, String(T - 1), 'viz-s', 'end');
      const H2 = gy + gh + 22;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(H2));
      // métricas: error contra la verdad
      const err = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const vis = res.steps.filter((s) => s.z && s.x && s.prior);
      const rmse = (arr) => (arr.length ? Math.sqrt(arr.reduce((a, v) => a + v * v, 0) / arr.length) : NaN);
      const eF = rmse(vis.map((s) => err(s.x, tk.truth[s.t]))), eZ = rmse(vis.map((s) => err(s.z, tk.truth[s.t])));
      const occS = res.steps.filter((s) => !s.z && s.x && !s.removed && s.t >= occ[0]);
      const eO = rmse(occS.map((s) => err(s.x, tk.truth[s.t])));
      const removedAt = res.steps.find((s) => s.removed);
      svg.setAttribute('aria-label', 'Frame ' + state.t + ': ' + (st.z ? 'con detección' : 'sin detección') + '. Error cuadrático medio de la estimación ' + eF.toFixed(1) + ' px contra ' + eZ.toFixed(1) + ' px de las detecciones crudas' + (removedAt ? '; el track se borra en el frame ' + removedAt.t + ' y vuelve con id 2' : '') + '.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('frame ' + state.t + ':', !st.x && !st.removed ? (st.goneAt != null ? 'sin track: el anterior se borró en t = ' + st.goneAt : 'sin track todavía') : st.removed ? 'track borrado (' + st.lost + ' > ' + maxLost + ' frames sin detección)' : st.z ? 'predict + update' : 'solo predict (' + st.lost + ' sin detección)');
      if (st.K) kv('ganancia K_{00} =', st.K[0][0].toFixed(2) + ' (0: ignora z · 1: copia z)');
      if (st.y) kv('innovación |z − Hx⁻| =', Math.hypot(st.y[0], st.y[1]).toFixed(1) + ' px');
      if (st.prior) kv('σ predicha → corregida:', Math.sqrt(st.prior.P[0][0]).toFixed(1) + (st.z ? ' → ' + Math.sqrt(st.P[0][0]).toFixed(1) : '') + ' px');
      kv('RMSE con detección:', 'filtro ' + eF.toFixed(1) + ' px · crudas ' + eZ.toFixed(1) + ' px');
      if (occS.length) kv('RMSE en la oclusión:', eO.toFixed(1) + ' px (solo predict)');
      if (removedAt) kv('ID switch:', 'borrado en t = ' + removedAt.t + ', vuelve como id 2');
      realNumbers();
    }
    function realNumbers() {
      real.innerHTML = '';
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('config:', (run && (run.label || run.id)) || cfgId);
      kv('estado / medición:', sDim + ' / ' + mDim + ' (F ' + sDim + '×' + sDim + ', H ' + mDim + '×' + sDim + ', K ' + sDim + '×' + mDim + ')');
      kv('track_buffer:', buffer + ' a ' + fps + ' fps → ' + maxLost + ' frames sin detección antes de borrar (' + (maxLost / fps).toFixed(1) + ' s)');
      const kf = pick(met, ['kalmanFlopsPerTrack'], null);
      if (kf != null) kv('Kalman por track y frame:', (A && A.fmt && A.fmt.int ? A.fmt.int(kf) : kf) + ' FLOPs');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') { ev.preventDefault(); state.t = Math.min(T - 1, state.t + 1); draw(); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { ev.preventDefault(); state.t = Math.max(0, state.t - 1); draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.t = 0; draw(); }
      else if (k === 'End') { ev.preventDefault(); state.t = T - 1; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.kalman = { predict, update, filter, ellipse, track, F, H, Qof, Rof };
    ATLAS.Viz.register('kalman-track', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
