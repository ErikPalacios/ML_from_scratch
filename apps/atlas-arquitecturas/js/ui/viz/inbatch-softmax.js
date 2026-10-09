/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/inbatch-softmax.js
   Visualización "inbatch-softmax" (SPEC §7.8, §25.4): la pérdida de entrenamiento del two-tower con negativos del lote y la
   corrección logQ (Yi et al., "Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations", RecSys 2019).
   Un lote ILUSTRATIVO de B pares (usuario i, ítem que vio i) tomado de un flujo donde los ítems aparecen con probabilidad
   Q_j (Zipf: unos pocos son muy populares) → logits s_ij = u_i·v_j / τ (B×B; diagonal = positivos, el resto = negativos del
   lote) → corregidos s_ij − log Q_j → softmax por fila → L = promedio de −log p_ii. Sin corrección, los ítems populares son
   negativos mucho más seguido de lo que les tocaría (aparecen en más lotes) y el modelo aprende a bajarles el puntaje; restar
   log Q_j a cada columna compensa ese muestreo (es la corrección del sampled softmax). Si un ítem aparece dos veces en el lote,
   la celda fuera de la diagonal es un falso negativo (mismo ítem). Abajo: veces esperadas que cada ítem del catálogo es negativo
   en 1,000 lotes, ∝ (B − 1)·Q_j. Números del calculador (no ilustrativos): B, dim y la matriz B×B de la config (two-tower-base).
   Q_j: en el paper se estima en streaming (un arreglo con el último paso en que se vio cada ítem y un promedio móvil del
   intervalo entre apariciones; Q ≈ 1 / intervalo).
   params: { config:'two-tower-base', B:6 (4|6|8), view:'logits'|'corr'|'softmax', correct:true }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const ITEMS = ['noticias', 'fútbol', 'receta', 'música', 'tutorial', 'gatos', 'podcast', 'viaje', 'ciencia', 'humor', 'autos', 'jardín'];
  const TAU = 0.1;            // temperatura de la demo (Yi et al. usan τ con embeddings normalizados)
  const E = 16;               // dimensión de los embeddings de la demo (no se dibujan)
  // popularidad Zipf (exponente 1) normalizada
  const QZ = (() => { const w = ITEMS.map((_, i) => 1 / (i + 1)); const s = w.reduce((a, b) => a + b, 0); return w.map((x) => x / s); })();

  function softmax(xs) { const m = Math.max(...xs); const e = xs.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); }
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const norm = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };

  // lote: B ítems muestreados ∝ Q (con reemplazo: pueden repetirse) y un usuario por par cuyo vector apunta a su ítem
  function batch(B, seed) {
    const R = ATLAS.Viz.rng(seed);
    const vec = () => Array.from({ length: E }, () => R.normal());
    const itemV = ITEMS.map(() => norm(vec()));
    const pick = () => { let u = R(), j = 0; while (j < QZ.length - 1 && u > QZ[j]) { u -= QZ[j]; j++; } return j; };
    const items = [];
    for (let i = 0; i < B; i++) items.push(pick());
    const users = items.map((j) => norm(itemV[j].map((x) => x + 0.85 * R.normal() / Math.sqrt(E) * 4)));
    return { items, users, itemV };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const fint = fmt.int || ((n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const cfgId = params.config || 'two-tower-base';
    let run = null, met = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { met = A.metrics(cfgId); } catch (e) { met = null; }
    const state = {
      B: [4, 6, 8].indexOf(+params.B) >= 0 ? +params.B : 6,
      view: ['logits', 'corr', 'softmax'].indexOf(params.view) >= 0 ? params.view : 'softmax',
      correct: params.correct !== false && params.correct !== 'false',
      cell: null,
    };

    const wrap = V.html('div', { class: 'viz viz-ib' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g); b.addEventListener('click', () => { state[key] = v; state.cell = null; draw(); }); b._v = v; b._k = key; return b; });
    };
    const cB = chipGroup('Lote (demo)', [[4, 'B = 4'], [6, 'B = 6'], [8, 'B = 8']], 'B');
    const cV = chipGroup('Ver', [['logits', 's = u·v/τ'], ['corr', 's − log Q'], ['softmax', 'softmax por fila']], 'view');
    const cC = chipGroup('Corrección logQ', [[true, 'sí'], [false, 'no']], 'correct');
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Lote, ítems y embeddings ilustrativos (12 ítems con popularidad de Zipf). Fila = usuario, columna = ítem del lote; la diagonal es el ítem que ese usuario vio (positivo) y el resto de la fila son los negativos: los positivos de los OTROS pares, gratis porque sus vectores ya se calcularon. Como un ítem entra al lote con probabilidad Qⱼ, los populares son negativos muchísimas más veces que los raros (barras de abajo); sin corregir, el modelo aprende a castigarlos. Restar log Qⱼ a su columna (Yi et al., RecSys 2019) compensa ese muestreo. Recuadro punteado: el mismo ítem dos veces en el lote, un falso negativo.' }, wrap);

    let lastNarrow = null;
    function draw() {
      [cB, cV, cC].forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      const B = state.B;
      const bt = batch(B, 2019 + B);
      const s = bt.users.map((u) => bt.items.map((j) => dot(u, bt.itemV[j]) / TAU));
      const lq = bt.items.map((j) => Math.log(QZ[j]));
      const sc = s.map((row) => row.map((v, k) => v - lq[k]));
      const use = state.correct ? sc : s;
      const P = use.map((row) => softmax(row));
      const loss = (M) => M.map((row, i) => -Math.log(softmax(row)[i])).reduce((a, b) => a + b, 0) / B;
      const L = loss(use), Lc = loss(sc), Ln = loss(s);
      const M = state.view === 'logits' ? s : state.view === 'corr' ? sc : P;

      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const cs = narrow ? Math.max(30, Math.min(40, Math.floor((cw - 120) / B))) : 48;
      const ML = narrow ? 56 : 80, TOP = narrow ? 128 : 136;
      const need = ML + B * cs + 64;
      const W = narrow ? Math.max(300, need) : Math.max(620, ML + B * cs + 140);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'group', 'aria-label': 'Matriz ' + B + '×' + B + ' de usuarios (filas) por ítems del lote (columnas)' }, stage);
      const t = (p, x, y, str, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, str); return e; };
      t(svg, 8, 15, state.view === 'logits' ? 'logits s_ij = u_i·v_j / τ (B×B)' : state.view === 'corr' ? 'logits corregidos s_ij − log Q_j' : 'softmax por fila' + (state.correct ? ' de s − log Q' : ' de s (sin corregir)'), 'viz-t');
      t(svg, 8, 31, 'L = ' + L.toFixed(3) + (narrow ? '' : '  ·  ln B = ' + Math.log(B).toFixed(2) + ' (no distinguir)'), 'viz-n');
      // encabezados de columna: ítem, barra de popularidad Q_j y −log Q_j
      const qMax = Math.max(...QZ);
      bt.items.forEach((j, k) => {
        const x = ML + k * cs;
        const bh = 34 * QZ[j] / qMax;
        V.svg('rect', { x: r1(x + cs * 0.3), y: r1(TOP - 30 - bh), width: r1(cs * 0.4), height: r1(Math.max(1, bh)), class: 'viz-ib-q' }, svg);
        t(svg, x + cs / 2, TOP - 18, (100 * QZ[j]).toFixed(QZ[j] < 0.1 ? 1 : 0) + '%', 'viz-s', 'middle');
        t(svg, x + cs / 2, TOP - 6, (-lq[k]).toFixed(1), 'viz-ib-lq', 'middle');
        const tt = V.svg('text', { class: 'viz-s', transform: 'translate(' + r1(x + cs / 2 + 3) + ',' + r1(TOP - 70) + ') rotate(-40)' }, svg);
        tt.textContent = ITEMS[j];
      });
      t(svg, ML - 6, TOP - 18, 'Q_j', 'viz-s', 'end');
      t(svg, ML - 6, TOP - 6, '−log Q_j', 'viz-s', 'end');
      const flat = M.flat(), lo = state.view === 'softmax' ? 0 : Math.min(...flat), hi = state.view === 'softmax' ? 1 : Math.max(...flat);
      for (let i = 0; i < B; i++) {
        t(svg, ML - 6, TOP + i * cs + cs / 2 + 4, 'u' + (i + 1), 'viz-s', 'end');
        for (let k = 0; k < B; k++) {
          const v = M[i][k], f = hi > lo ? (v - lo) / (hi - lo) : 0;
          const x = ML + k * cs, y = TOP + i * cs;
          const dup = i !== k && bt.items[i] === bt.items[k];
          const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': 'Usuario ' + (i + 1) + ' con ' + ITEMS[bt.items[k]] + ': s ' + s[i][k].toFixed(2) + ', corregido ' + sc[i][k].toFixed(2) + ', p ' + P[i][k].toFixed(2) + (i === k ? ' (positivo)' : dup ? ' (mismo ítem que el positivo: falso negativo)' : ' (negativo)') }, svg);
          V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: 'viz-sim-cell', style: 'fill:color-mix(in srgb, var(--op-fuse) ' + Math.round(6 + 70 * f) + '%, var(--surface))' }, gEl);
          t(gEl, x + cs / 2, y + cs / 2 + 4, state.view === 'softmax' ? v.toFixed(2) : v.toFixed(1), 'viz-sim-v', 'middle');
          V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: i === k ? 'viz-sim-pos' : dup ? 'viz-ib-dup' : 'viz-sim-hit' }, gEl);
          const show = () => { state.cell = { i, k }; readout(); };
          gEl.addEventListener('pointerenter', show); gEl.addEventListener('focus', show);
        }
      }
      // pérdida por fila
      const lx = ML + B * cs + 10;
      t(svg, lx, TOP - 6, '−log p_ii', 'viz-s');
      use.forEach((row, i) => t(svg, lx, TOP + i * cs + cs / 2 + 4, (-Math.log(softmax(row)[i])).toFixed(2), 'viz-n'));
      // ---- veces esperadas que cada ítem del catálogo es negativo en 1,000 lotes: 1000·(B − 1)·Q_j
      let y = TOP + B * cs + 52;
      t(svg, 8, y - 22, narrow ? 'veces que cada ítem es negativo (1,000 lotes)' : 'veces esperadas que cada ítem del catálogo es negativo en 1,000 lotes = 1,000·(B − 1)·Q_j', 'viz-n');
      const bw = (W - 40) / ITEMS.length, hB = 60, nMax = 1000 * (B - 1) * qMax;
      ITEMS.forEach((name, j) => {
        const n = 1000 * (B - 1) * QZ[j], hh = hB * n / nMax;
        const x = 8 + j * bw;
        V.svg('rect', { x: r1(x + 2), y: r1(y + hB - hh), width: r1(bw - 4), height: r1(Math.max(1, hh)), class: 'viz-ib-neg' + (bt.items.indexOf(j) >= 0 ? ' is-in' : '') }, svg);
        t(svg, x + bw / 2, y + hB - hh - 3, fint(n), 'viz-ib-nv', 'middle');
        const tt = V.svg('text', { class: 'viz-s', transform: 'translate(' + r1(x + bw / 2 + 3) + ',' + r1(y + hB + 10) + ') rotate(40)' }, svg);
        tt.textContent = name;
      });
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y + hB + 56));
      state.last = { s, sc, P, L, Lc, Ln, items: bt.items };
      readout();
      realNumbers();
    }
    function readout() {
      out.innerHTML = '';
      const S = state.last; if (!S) return;
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('B =', state.B + ' (demo) · negativos por fila: ' + (state.B - 1));
      kv('τ =', String(TAU));
      kv('L sin corrección =', S.Ln.toFixed(3));
      kv('L con logQ =', S.Lc.toFixed(3));
      const c = state.cell;
      if (c) kv('u' + (c.i + 1) + ' · ' + ITEMS[S.items[c.k]] + ':', 's ' + S.s[c.i][c.k].toFixed(2) + ' − log Q (' + Math.log(QZ[S.items[c.k]]).toFixed(2) + ') = ' + S.sc[c.i][c.k].toFixed(2) + ' → p ' + S.P[c.i][c.k].toFixed(3));
    }
    // Números reales de la config del calculador
    function realNumbers() {
      real.innerHTML = '';
      if (!run) return;
      const cfg = run.config || {};
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(o[k])) return o[k]; return null; };
      kv('config:', run.label || cfgId);
      const B = pick(cfg, ['B', 'batch']), dim = pick(cfg, ['dim', 'D']);
      const lt = run.tensors && (run.tensors.logits || run.tensors['inbatch-logits']);
      if (lt && fmt.shape) kv('logits del lote:', fmt.shape(lt, 'sym') + ' = ' + fmt.shape(lt, 'num'));
      else if (B != null) kv('logits del lote:', fint(B) + '×' + fint(B));
      if (B != null) kv('negativos por ejemplo:', fint(B - 1));
      const macs = pick(met, ['inBatchLogitsMacs']);
      if (macs != null) kv('MACs de U·Vᵀ:', fmt.ops ? fmt.ops(macs) : fint(macs));
      else if (B != null && dim != null) kv('MACs de U·Vᵀ (B²·dim):', fint(B * B * dim));
    }
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('inbatch-softmax', render);
})(typeof window !== 'undefined' ? window : globalThis);
