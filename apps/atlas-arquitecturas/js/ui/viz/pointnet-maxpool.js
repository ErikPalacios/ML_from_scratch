/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/pointnet-maxpool.js
   Visualización "pointnet-maxpool" (SPEC §7.8, §26.5): por qué PointNet no depende del orden de los puntos.
   Juguete 2-D ILUSTRATIVO: N = 24 puntos de una figura → la MISMA MLP chica para cada punto (h: ℝ² → ℝ¹⁶ → ℝᴷ con ReLU, K = 8,
   pesos al azar con semilla: no está entrenada) → una matriz N × K de features por punto → max-pool por canal sobre los puntos
   → un vector global g ∈ ℝᴷ. Como el máximo es simétrico:
     · barajar el orden de los puntos permuta las filas de la matriz y g sale IDÉNTICO (invariancia a permutaciones);
     · el punto que gana el máximo de un canal es "crítico"; hay a lo sumo K (Qi et al., CVPR 2017, arXiv:1612.00593, teorema 2:
       el conjunto crítico C_S tiene ≤ K elementos). Quitar todos los NO críticos deja g igual; quitar uno crítico lo cambia.
     · con promedio en vez de máximo también es invariante al orden, pero todos los puntos cuentan: quitar cualquiera cambia g.
   Números del calculador (no ilustrativos): N y el ancho del max-pool de la config (K = 1024 en pointnet-cls → hasta 1024 puntos
   críticos). params: { config:'pointnet-cls', pool:'max'|'mean', shape:'avion'|'silla' }
   Puro (sin DOM) para tests: ATLAS.Viz.pointnet = { mlp, pool, critical, points }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const K = 8, HID = 16;

  // MLP compartida (pesos al azar con semilla): la misma función para cada punto
  function weights(seed) {
    const R = ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(seed || 1612) : Math.random;
    const W1 = Array.from({ length: HID }, () => [R.normal() * 1.4, R.normal() * 1.4]), b1 = Array.from({ length: HID }, () => R.normal() * 0.3);
    const W2 = Array.from({ length: K }, () => Array.from({ length: HID }, () => R.normal() * 0.5)), b2 = Array.from({ length: K }, () => R.normal() * 0.1);
    return { W1, b1, W2, b2 };
  }
  function mlp(w, p) {
    const h = w.W1.map((row, i) => Math.max(0, row[0] * p[0] + row[1] * p[1] + w.b1[i]));
    return w.W2.map((row, k) => Math.max(0, row.reduce((a, v, j) => a + v * h[j], 0) + w.b2[k]));
  }
  // pooling simétrico sobre los puntos (filas): máx o promedio por canal
  function pool(F, kind) {
    if (!F.length) return new Array(K).fill(0);
    return F[0].map((_, k) => (kind === 'mean' ? F.reduce((a, row) => a + row[k], 0) / F.length : Math.max(...F.map((row) => row[k]))));
  }
  // índice del punto que gana cada canal (el primero si empatan); un canal en 0 para todos no tiene ganador
  function critical(F) {
    return F.length ? F[0].map((_, k) => { let b = -1, v = 0; F.forEach((row, i) => { if (row[k] > v) { v = row[k]; b = i; } }); return b; }) : [];
  }
  // figuras en [−1, 1]²: un avión visto desde arriba y una silla de perfil (N = 24)
  function points(shape) {
    if (shape === 'silla') {
      const P = [];
      for (let i = 0; i < 7; i++) P.push([-0.45, 0.85 - i * 0.2]);              // respaldo
      for (let i = 1; i < 6; i++) P.push([-0.45 + i * 0.17, -0.25]);            // asiento
      for (let i = 1; i < 6; i++) P.push([-0.45, -0.25 - i * 0.14]);            // pata trasera
      for (let i = 1; i < 6; i++) P.push([0.4, -0.25 - i * 0.14]);              // pata delantera
      P.push([-0.2, 0.85], [-0.2, 0.55]);
      return P;
    }
    const P = [];
    for (let i = 0; i < 9; i++) P.push([0, 0.9 - i * 0.22]);                    // fuselaje
    for (let i = 1; i < 5; i++) { P.push([-i * 0.2, 0.2 - i * 0.06]); P.push([i * 0.2, 0.2 - i * 0.06]); }   // alas
    for (let i = 1; i < 3; i++) { P.push([-i * 0.13, -0.85 + i * 0.02]); P.push([i * 0.13, -0.85 + i * 0.02]); }   // cola
    P.push([0, -0.95], [0, 1.0], [-0.9, 0.0]);
    return P.slice(0, 24);
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const fint = fmt.int || ((n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const cfgId = params.config || 'pointnet-cls';
    let run = null, met = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { met = A.metrics(cfgId); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const pick = (o, ks, d) => { for (const k of ks) { const v = String(k).split('.').reduce((a, p) => (a == null ? a : a[p]), o); if (Number.isFinite(v)) return v; } return d; };
    const w = weights(1612);
    const state = { pool: params.pool === 'mean' ? 'mean' : 'max', shape: params.shape === 'silla' ? 'silla' : 'avion', order: null, keep: null, last: 'inicio', hl: null };
    let base = null;
    const reset = () => { const P = points(state.shape); state.order = P.map((_, i) => i); state.keep = P.map(() => true); state.last = 'inicio'; state.hl = null; base = null; };
    reset();

    const wrap = V.html('div', { class: 'viz viz-pn' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g); b.addEventListener('click', () => { state[key] = v; reset(); draw(); }); b._v = v; b._k = key; return b; });
    };
    const cS = chipGroup('Figura', [['avion', 'avión'], ['silla', 'silla']], 'shape');
    const cP = chipGroup('Pooling', [['max', 'máx (PointNet)'], ['mean', 'promedio']], 'pool');
    const acts = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Acciones' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Probar' }, acts);
    const R = V.rng(7);
    const act = (label, fn) => { const b = V.html('button', { type: 'button', class: 'viz-chip', text: label }, acts); b.addEventListener('click', () => { fn(); draw(); }); return b; };
    act('barajar el orden', () => { const o = state.order; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; } state.last = 'barajar'; });
    act('quitar los no críticos', () => { const F = feats(); const cs = new Set(critical(F.rows).filter((i) => i >= 0).map((i) => F.idx[i])); state.keep = state.keep.map((k, i) => k && cs.has(i)); state.last = 'noCrit'; });
    act('quitar un crítico', () => { const F = feats(); const c = critical(F.rows).find((i) => i >= 0); if (c != null) state.keep[F.idx[c]] = false; state.last = 'crit'; });
    act('restaurar', () => { reset(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'Juguete en 2-D con una MLP chica de pesos al azar (no entrenada): lo que importa es la estructura, no los valores. Cada punto pasa por la MISMA MLP (en PointNet, una conv1d de kernel 1: ' + 'los pesos se comparten entre puntos) y da una fila de K = ' + K + ' features. El max-pool toma el máximo de cada columna: no le importa en qué fila está, así que barajar los puntos no cambia nada. Los puntos que ganan alguna columna son los críticos (borde grueso): son a lo sumo K, y con ellos solos el vector global sale igual. Con promedio el orden tampoco importa, pero todos los puntos pesan y no hay críticos.');

    function feats() {
      const P = points(state.shape);
      const idx = state.order.filter((i) => state.keep[i]);
      return { P, idx, rows: idx.map((i) => mlp(w, P[i])) };
    }
    function draw() {
      [cS, cP].forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      const F = feats();
      const g = pool(F.rows, state.pool);
      if (!base) base = g.slice();
      const crit = state.pool === 'max' ? critical(F.rows) : [];
      const critPts = new Set(crit.filter((i) => i >= 0).map((i) => F.idx[i]));
      const diff = g.map((v, k) => Math.abs(v - base[k]));
      const same = diff.every((d) => d < 1e-12);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(560, cw)) : 860;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'group' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'Puntos → MLP compartida → ' + (state.pool === 'max' ? 'máx' : 'promedio') + ' por canal' : 'N puntos → la misma MLP para cada uno → ' + (state.pool === 'max' ? 'máximo' : 'promedio') + ' por canal → vector global', 'viz-t');
      t(svg, 8, 29, F.idx.length + ' puntos · K = ' + K + (narrow ? '' : ' canales') + (state.pool === 'max' ? ' · ' + critPts.size + (narrow ? ' críticos' : ' puntos críticos (≤ K)') : ''), 'viz-s');
      // nube de puntos
      const PS = narrow ? Math.min(W - 16, 260) : 250, PX0 = 8, PY0 = 42;
      V.svg('rect', { x: PX0, y: PY0, width: PS, height: PS, class: 'viz-pn-bg' }, svg);
      const toP = (p) => [PX0 + PS * (p[0] + 1.15) / 2.3, PY0 + PS * (1.15 - p[1]) / 2.3];
      const ptEl = {};
      F.P.forEach((p, i) => {
        const q = toP(p), on = state.keep[i], c = critPts.has(i);
        ptEl[i] = V.svg('circle', { cx: r1(q[0]), cy: r1(q[1]), r: c ? 5.4 : 4, class: 'viz-pn-pt' + (on ? '' : ' is-off') + (c ? ' is-crit' : '') }, svg);
      });
      // matriz N × K (filas en el orden actual) y el vector global
      const MX = narrow ? 30 : PX0 + PS + 70, MY = narrow ? PY0 + PS + 40 : PY0 + 30;
      const cwid = narrow ? Math.min(30, Math.floor((W - MX - 12) / K)) : 34;
      const nR = F.idx.length, rh = Math.max(5, Math.min(11, Math.floor((narrow ? 260 : 300) / Math.max(1, nR))));
      const vmax = Math.max(1e-9, ...F.rows.flat(), ...base);
      t(svg, MX - 26, MY - 22, narrow ? 'features: ' + nR + ' × ' + K + ' (una fila por punto)' : 'features por punto: ' + nR + ' × ' + K + ' (una fila por punto, en el orden de entrada)', 'viz-n');
      for (let k = 0; k < K; k++) t(svg, MX + k * cwid + cwid / 2, MY - 6, 'c' + (k + 1), 'viz-s', 'middle');
      F.rows.forEach((row, ri) => {
        const y = MY + ri * rh, pi = F.idx[ri];
        if (rh >= 9 || ri % 4 === 0) t(svg, MX - 6, y + rh - 1.5, 'p' + (pi + 1), 'viz-pn-rl', 'end');
        row.forEach((v, k) => {
          const isMax = state.pool === 'max' && crit[k] === ri;
          V.svg('rect', { x: MX + k * cwid + 0.5, y: r1(y + 0.5), width: cwid - 1, height: rh - 1, class: 'viz-pn-cell' + (isMax ? ' is-max' : ''), style: 'fill:color-mix(in srgb, var(--op-mlp) ' + Math.round(4 + 80 * v / vmax) + '%, var(--surface))' }, svg);
        });
        const hit = V.svg('rect', { x: MX - 30, y: r1(y), width: K * cwid + 30, height: rh, class: 'viz-pn-hit', tabindex: 0, role: 'img', 'aria-label': 'Punto ' + (pi + 1) + (critPts.has(pi) ? ', crítico' : '') + ': ' + row.map((v) => v.toFixed(2)).join(', ') }, svg);
        // resaltar sin redibujar (el foco del teclado se queda en la fila)
        const on = () => { state.hl = { pt: pi }; hlRow(ri, pi); };
        hit.addEventListener('pointerenter', on);
        hit.addEventListener('focus', on);
      });
      const rowSel = V.svg('rect', { x: MX, y: MY, width: K * cwid, height: rh, class: 'viz-pn-rowsel', visibility: 'hidden' }, svg);
      function hlRow(ri, pi) {
        rowSel.setAttribute('y', r1(MY + ri * rh)); rowSel.setAttribute('visibility', 'visible');
        Object.keys(ptEl).forEach((i) => ptEl[i].classList.toggle('is-hl', +i === pi));
      }
      if (state.hl) { const ri = F.idx.indexOf(state.hl.pt); if (ri >= 0) hlRow(ri, state.hl.pt); }
      const gy = MY + nR * rh + 30;
      t(svg, MX - 26, gy - 8, (state.pool === 'max' ? 'máx' : 'promedio') + ' por columna → g (' + K + ')', 'viz-n');
      g.forEach((v, k) => {
        V.svg('rect', { x: MX + k * cwid + 0.5, y: r1(gy), width: cwid - 1, height: 18, class: 'viz-pn-g' + (diff[k] > 1e-12 ? ' is-chg' : ''), style: 'fill:color-mix(in srgb, var(--op-mlp) ' + Math.round(4 + 80 * v / vmax) + '%, var(--surface))' }, svg);
        t(svg, MX + k * cwid + cwid / 2, gy + 31, v.toFixed(2), 'viz-pn-gv' + (diff[k] > 1e-12 ? ' is-chg' : ''), 'middle');
      });
      if (narrow) t(svg, MX - 26, gy + 50, same ? '= el g original' : '≠ el g original', same ? 'viz-pn-ok' : 'viz-pn-bad');
      else t(svg, MX + K * cwid + 10, gy + 13, same ? '= original' : '≠ original', same ? 'viz-pn-ok' : 'viz-pn-bad');
      const H2 = Math.max(PY0 + PS + 10, gy + (narrow ? 58 : 42));
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(H2));
      svg.setAttribute('aria-label', 'Nube de ' + F.idx.length + ' puntos y su matriz de features; vector global ' + (same ? 'igual al original' : 'distinto del original'));

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const what = { inicio: 'la nube original', barajar: 'mismos puntos, otro orden', noCrit: 'solo los puntos críticos', crit: 'sin un punto crítico' }[state.last];
      kv('ahora:', what + ' (' + F.idx.length + ' puntos)');
      kv('g contra el original:', same ? 'idéntico (diferencia máx 0)' : 'cambian ' + diff.filter((d) => d > 1e-12).length + ' de ' + K + ' canales');
      if (state.pool === 'max') kv('puntos críticos:', critPts.size + ' ≤ K = ' + K);
      else kv('puntos críticos:', 'no hay: con promedio todos cuentan');
    }
    function realNumbers() {
      real.innerHTML = '';
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('config:', (run && (run.label || run.id)) || cfgId);
      const N = pick(met, ['N'], pick(cfg, ['N'], 1024)), Kc = pick(met, ['globalDim'], 1024), cm = pick(met, ['criticalPointsMax'], Math.min(N, Kc));
      kv('puntos:', fint(N));
      kv('ancho del max-pool:', fint(Kc) + ' canales → hasta ' + fint(cm) + ' puntos críticos');
    }
    draw(); realNumbers();
    let ro = null, lastNarrow = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (lastNarrow !== null && nar !== lastNarrow) draw(); lastNarrow = nar; }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.pointnet = { mlp, pool, critical, points, weights };
    ATLAS.Viz.register('pointnet-maxpool', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
