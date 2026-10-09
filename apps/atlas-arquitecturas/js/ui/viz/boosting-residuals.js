/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/boosting-residuals.js
   Visualización "boosting-residuals" (SPEC §7.8, §25.4): gradient boosting en 1-D (regresión, pérdida cuadrática).
   Datos ILUSTRATIVOS: 50 puntos de entrenamiento (x ∈ [0, 1], y = sen(2πx) + 0.3x + ruido, semilla fija) y 300 de prueba de la
   misma curva. F_0 = promedio de y; el árbol m se ajusta al RESIDUO r_i = y_i − F_{m−1}(x_i), que con ½(y − F)² es el gradiente
   negativo (Friedman, Annals of Statistics 2001), con búsqueda exacta del corte que más baja el error cuadrático (= la ganancia
   de XGBoost con h = 1, λ = 0, γ = 0) hasta la profundidad elegida, y hojas = promedio del residuo de sus filas (w = −G/H);
   después F_m = F_{m−1} + η·f_m. Con η = 1 y árboles profundos, el error de entrenamiento se va a 0 y el de prueba vuelve a
   subir (sobreajuste); con η chico hacen falta más árboles pero el mínimo de prueba queda igual o más abajo (shrinkage).
   Paneles: los datos con F_m; el residuo que ve el árbol m y lo que ese árbol ajusta; error (MSE) de entrenamiento y prueba
   contra el número de árboles. Números del calculador (no ilustrativos): nTrees, depth, η de la config y las comparaciones
   por predicción (ATLAS.Arch.run / metrics; xgboost-500-d6 por omisión).
   params: { config:'xgboost-500-d6', m:10 (0…200), eta:0.3 (1|0.3|0.1), depth:2 (1|2|3) }
   Puro (sin DOM): ATLAS.Viz.boosting = { fit, tree }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9]{1,2}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const MMAX = 200, NTR = 50, NTE = 300, MIN_LEAF = 2;
  const ETAS = [1, 0.3, 0.1], DEPTHS = [1, 2, 3];
  const f0 = (x) => Math.sin(2 * Math.PI * x) + 0.3 * x;

  function data() {
    const R = ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(2001) : Math.random;
    const tr = [], te = [];
    for (let i = 0; i < NTR; i++) { const x = R(); tr.push({ x, y: f0(x) + 0.3 * R.normal() }); }
    for (let i = 0; i < NTE; i++) { const x = (i + 0.5) / NTE; te.push({ x, y: f0(x) + 0.3 * R.normal() }); }
    tr.sort((a, b) => a.x - b.x);
    return { tr, te };
  }
  // árbol de regresión sobre (x ordenado, r): búsqueda exacta del corte de máxima reducción del error cuadrático
  function tree(xs, rs, idx, depth) {
    const mean = idx.reduce((a, i) => a + rs[i], 0) / idx.length;
    if (depth === 0 || idx.length < 2 * MIN_LEAF) return { leaf: true, w: mean, n: idx.length };
    const tot = idx.reduce((a, i) => a + rs[i], 0);
    let best = null, sl = 0;
    for (let k = 0; k < idx.length - 1; k++) {
      sl += rs[idx[k]];
      const nl = k + 1, nr = idx.length - nl;
      if (nl < MIN_LEAF || nr < MIN_LEAF || xs[idx[k]] === xs[idx[k + 1]]) continue;
      // reducción del SSE = G_L²/n_L + G_R²/n_R − G²/n (la ganancia de XGBoost ×2 con h = 1, λ = 0)
      const g = sl * sl / nl + (tot - sl) * (tot - sl) / nr - tot * tot / idx.length;
      if (!best || g > best.g) best = { g, k };
    }
    if (!best || best.g <= 1e-12) return { leaf: true, w: mean, n: idx.length };
    const thr = (xs[idx[best.k]] + xs[idx[best.k + 1]]) / 2;
    return { leaf: false, thr, l: tree(xs, rs, idx.slice(0, best.k + 1), depth - 1), r: tree(xs, rs, idx.slice(best.k + 1), depth - 1) };
  }
  const predict = (t, x) => (t.leaf ? t.w : predict(x < t.thr ? t.l : t.r, x));
  // M árboles con η y profundidad: predicciones en train / test / grilla después de cada árbol
  function fit(d, eta, depth, M) {
    const xs = d.tr.map((p) => p.x), ys = d.tr.map((p) => p.y);
    const base = ys.reduce((a, b) => a + b, 0) / ys.length;
    const idx = xs.map((_, i) => i);
    let F = ys.map(() => base), Ft = d.te.map(() => base);
    const trees = [], mseTr = [], mseTe = [], resid = [];
    const mse = (P, Y) => P.reduce((a, p, i) => a + (p - Y[i]) * (p - Y[i]), 0) / P.length;
    const yt = d.te.map((p) => p.y);
    mseTr.push(mse(F, ys)); mseTe.push(mse(Ft, yt));
    for (let m = 1; m <= M; m++) {
      const rs = ys.map((y, i) => y - F[i]);
      resid.push(rs);
      const t = tree(xs, rs, idx, depth);
      trees.push(t);
      F = F.map((f, i) => f + eta * predict(t, xs[i]));
      Ft = Ft.map((f, i) => f + eta * predict(t, d.te[i].x));
      mseTr.push(mse(F, ys)); mseTe.push(mse(Ft, yt));
    }
    const Fx = (x, m) => base + eta * trees.slice(0, m).reduce((a, t) => a + predict(t, x), 0);
    return { base, trees, mseTr, mseTe, resid, Fx, predict };
  }
  const leaves = (t) => (t.leaf ? 1 : leaves(t.l) + leaves(t.r));

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const fint = fmt.int || ((n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const cfgId = params.config || 'xgboost-500-d6';
    let run = null, met = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { met = A.metrics(cfgId); } catch (e) { met = null; }
    const d = data();
    const state = {
      m: Math.max(0, Math.min(MMAX, Math.round(+params.m) || 10)),
      eta: ETAS.indexOf(+params.eta) >= 0 ? +params.eta : 0.3,
      depth: DEPTHS.indexOf(+params.depth) >= 0 ? +params.depth : 2,
    };
    const cache = {};
    const model = () => { const k = state.eta + '|' + state.depth; return cache[k] || (cache[k] = fit(d, state.eta, state.depth, MMAX)); };

    const wrap = V.html('div', { class: 'viz viz-br' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      // las letras griegas no van en mayúsculas (η → H, λ → Λ): sin text-transform
      V.html('span', { class: 'viz-ctl-l', text: label, style: /[α-ω]/.test(label) ? 'text-transform:none' : null }, g);
      return items.map(([v, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._v = v; b._k = key; return b; });
    };
    const cE = chipGroup('η', ETAS.map((v) => [v, String(v)]), 'eta');
    const cD = chipGroup('Profundidad', DEPTHS.map((v) => [v, String(v)]), 'depth');
    const g2 = V.html('label', { class: 'viz-ctl viz-br-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Árboles M' }, g2);
    const inp = V.html('input', { type: 'range', min: 0, max: MMAX, step: 1, 'aria-label': 'Número de árboles M (0 a ' + MMAX + ')' }, g2);
    const outM = V.html('output', { class: 'viz-br-out' }, g2);
    inp.addEventListener('input', () => { state.m = +inp.value; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-br-stage', tabindex: 0, role: 'group', 'aria-label': 'Boosting en una dimensión. Flechas: un árbol más o menos; Inicio y Fin: 0 y ' + MMAX + ' árboles' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, sub('Datos sintéticos (50 puntos de entrenamiento, 300 de prueba de la misma curva con ruido). Cada árbol se ajusta al residuo y − F_{m−1}(x) (el gradiente negativo de la pérdida cuadrática) y se suma achicado por η. η = 1 con árboles profundos memoriza el ruido: el error de entrenamiento baja a casi 0 y el de prueba sube. Con η chico cada árbol corrige poco y hacen falta más, pero el mínimo de prueba queda igual o más abajo y la curva sube más despacio después de él: por eso en la práctica se usa η = 0.05–0.3 y se corta con early stopping sobre un conjunto de validación.'));

    let lastNarrow = null;
    function draw() {
      [cE, cD].forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      inp.value = state.m; outM.textContent = 'M = ' + state.m;
      const Mo = model(), m = state.m;
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(520, cw)) : 860;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'Boosting: cada árbol ajusta el residuo' : 'Gradient boosting: F_m = F_{m−1} + η·f_m, y cada árbol f_m se ajusta al residuo de los anteriores', 'viz-t');
      t(svg, 8, 29, 'η = ' + state.eta + ' · profundidad ' + state.depth + ' (hasta ' + (1 << state.depth) + ' hojas) · M = ' + m + ' árboles', 'viz-s');

      const yLo = -1.9, yHi = 2.3;
      const panel = (x0, y0, w, h, title) => {
        t(svg, x0, y0 - 6, title, 'viz-n');
        V.svg('rect', { x: r1(x0), y: r1(y0), width: r1(w), height: r1(h), class: 'viz-br-bg' }, svg);
        return { X: (x) => x0 + w * x, Y: (v, lo, hi) => y0 + h - h * (v - lo) / (hi - lo) };
      };
      const stepPath = (fn, P, lo, hi) => {
        let dd = '';
        const n = 220;
        for (let i = 0; i <= n; i++) { const x = i / n; dd += (i ? 'L' : 'M') + r1(P.X(x)) + ' ' + r1(P.Y(Math.max(lo, Math.min(hi, fn(x))), lo, hi)); }
        return dd;
      };
      const pw = narrow ? W - 16 : (W - 16 - 24) / 2, ph = narrow ? 120 : 150;
      // panel 1: datos + F_m
      let y = 52;
      const P1 = panel(8, y, pw, ph, 'datos y F_M(x) con M = ' + m);
      V.svg('path', { d: stepPath(f0, P1, yLo, yHi), class: 'viz-br-true' }, svg);
      d.tr.forEach((p) => V.svg('circle', { cx: r1(P1.X(p.x)), cy: r1(P1.Y(p.y, yLo, yHi)), r: 2.6, class: 'viz-br-pt' }, svg));
      V.svg('path', { d: stepPath((x) => Mo.Fx(x, m), P1, yLo, yHi), class: 'viz-br-F' }, svg);
      // panel 2: residuo que ve el árbol m (o el próximo, si M = 0) y su ajuste
      const mm = Math.max(1, m);
      const rs = Mo.resid[mm - 1], tr = Mo.trees[mm - 1];
      const rMax = Math.max(0.3, ...rs.map(Math.abs)) * 1.1;
      const x2 = narrow ? 8 : 8 + pw + 24, y2 = narrow ? y + ph + 30 : y;
      const P2 = panel(x2, y2, pw, ph, 'residuo y − F_{' + (mm - 1) + '} y el árbol ' + mm + ' (' + leaves(tr) + ' hojas)');
      V.svg('path', { d: 'M' + r1(P2.X(0)) + ' ' + r1(P2.Y(0, -rMax, rMax)) + 'H' + r1(P2.X(1)), class: 'viz-br-axis' }, svg);
      d.tr.forEach((p, i) => V.svg('path', { d: 'M' + r1(P2.X(p.x)) + ' ' + r1(P2.Y(0, -rMax, rMax)) + 'V' + r1(P2.Y(rs[i], -rMax, rMax)), class: 'viz-br-res' }, svg));
      d.tr.forEach((p, i) => V.svg('circle', { cx: r1(P2.X(p.x)), cy: r1(P2.Y(rs[i], -rMax, rMax)), r: 2.2, class: 'viz-br-pt' }, svg));
      V.svg('path', { d: stepPath((x) => Mo.predict(tr, x), P2, -rMax, rMax), class: 'viz-br-tree' }, svg);
      // panel 3: MSE vs M
      y = (narrow ? y2 : y) + ph + 34;
      const w3 = W - 16, h3 = narrow ? 96 : 110;
      const all = Mo.mseTr.concat(Mo.mseTe), eHi = Math.max(...all) * 1.05;
      const P3 = panel(8, y, w3, h3, 'error cuadrático medio vs número de árboles');
      const line = (arr, cls) => { let dd = ''; arr.forEach((v, i) => { dd += (i ? 'L' : 'M') + r1(P3.X(i / MMAX)) + ' ' + r1(P3.Y(v, 0, eHi)); }); V.svg('path', { d: dd, class: cls }, svg); };
      line(Mo.mseTr, 'viz-br-tr'); line(Mo.mseTe, 'viz-br-te');
      const bestM = Mo.mseTe.indexOf(Math.min(...Mo.mseTe));
      V.svg('path', { d: 'M' + r1(P3.X(bestM / MMAX)) + ' ' + r1(y) + 'V' + r1(y + h3), class: 'viz-br-best' }, svg);
      V.svg('path', { d: 'M' + r1(P3.X(m / MMAX)) + ' ' + r1(y) + 'V' + r1(y + h3), class: 'viz-br-cur' }, svg);
      V.svg('circle', { cx: r1(P3.X(m / MMAX)), cy: r1(P3.Y(Mo.mseTe[m], 0, eHi)), r: 4, class: 'viz-br-dot is-te' }, svg);
      V.svg('circle', { cx: r1(P3.X(m / MMAX)), cy: r1(P3.Y(Mo.mseTr[m], 0, eHi)), r: 4, class: 'viz-br-dot is-tr' }, svg);
      t(svg, 8, y + h3 + 13, '0', 'viz-s');
      t(svg, 8 + w3, y + h3 + 13, String(MMAX), 'viz-s', 'end');
      // leyenda propia del gráfico
      const ly = y + h3 + 30;
      const leg = [['viz-br-tr', 'entrenamiento'], ['viz-br-te', 'prueba'], ['viz-br-best', 'mínimo de prueba (M = ' + bestM + ')']];
      let lx = 8;
      leg.forEach(([cls, s]) => { V.svg('path', { d: 'M' + lx + ' ' + (ly - 4) + 'h18', class: cls }, svg); t(svg, lx + 22, ly, s, 'viz-s'); lx += 34 + s.length * 6.6; if (narrow && lx > W - 120) lx = W; });
      const ly2 = narrow && lx >= W ? ly + 16 : ly;
      if (narrow && lx >= W) { V.svg('path', { d: 'M8 ' + (ly2 - 4) + 'h18', class: 'viz-br-best' }, svg); t(svg, 30, ly2, 'mínimo de prueba (M = ' + bestM + ')', 'viz-s'); }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(ly2 + 10));
      svg.setAttribute('aria-label', 'Con η = ' + state.eta + ' y profundidad ' + state.depth + ', después de ' + m + ' árboles: error de entrenamiento ' + Mo.mseTr[m].toFixed(3) + ', de prueba ' + Mo.mseTe[m].toFixed(3) + '; el error de prueba es mínimo con ' + bestM + ' árboles (' + Mo.mseTe[bestM].toFixed(3) + ').');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('MSE entrenamiento:', Mo.mseTr[m].toFixed(3));
      kv('MSE prueba:', Mo.mseTe[m].toFixed(3));
      kv('mejor M en prueba:', bestM + ' (MSE ' + Mo.mseTe[bestM].toFixed(3) + ')');
      kv('F_0 =', Mo.base.toFixed(3) + ' (promedio de y)');
      kv('ruido de los datos:', 'σ² = 0.09 (el piso del error de prueba)');
      realNumbers();
    }
    function realNumbers() {
      real.innerHTML = '';
      if (!run) return;
      const c = run.config || {};
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(o[k])) return o[k]; return null; };
      const nT = pick(c, ['nTrees', 'trees']), dep = pick(c, ['depth', 'maxDepth']), eta = pick(c, ['eta', 'learningRate', 'lr']), lv = pick(c, ['leaves', 'numLeaves']);
      kv('config:', run.label || cfgId);
      if (nT != null) kv('árboles:', fint(nT));
      if (dep != null) kv('profundidad:', String(dep));
      else if (lv != null) kv('hojas por árbol:', String(lv));
      if (eta != null) kv('η:', String(eta));
      const cmp = pick(met, ['comparisonsPerPrediction']);
      if (cmp != null) kv('comparaciones por predicción:', fint(cmp) + (nT != null && dep != null ? ' (' + fint(nT) + ' × ' + dep + ')' : ''));
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') { ev.preventDefault(); state.m = Math.min(MMAX, state.m + 1); draw(); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { ev.preventDefault(); state.m = Math.max(0, state.m - 1); draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.m = 0; draw(); }
      else if (k === 'End') { ev.preventDefault(); state.m = MMAX; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.boosting = { fit, tree, data };
    ATLAS.Viz.register('boosting-residuals', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
