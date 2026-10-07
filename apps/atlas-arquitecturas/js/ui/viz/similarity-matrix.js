/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/similarity-matrix.js
   Visualización "similarity-matrix" (SPEC §7.8, §14.4): la pérdida contrastiva de CLIP.
   Un lote ILUSTRATIVO de B pares imagen–texto (íconos dibujados por código y embeddings
   sintéticos con semilla) → matriz B×B de similitudes coseno × logit scale → softmax por FILA
   (imagen → texto, CE con la diagonal como positivo) y por COLUMNA (texto → imagen); la pérdida
   es el promedio de las dos. Debajo, los números reales del lote del paper (B = 32,768) desde
   ATLAS.Arch.run / metrics (memoria de la matriz de logits, negativos por muestra B − 1).
   Pasa el cursor (o enfoca) una celda para ver su similitud, su logit y su probabilidad.
   params: { config:'clip-vit-b16', B:6 (2–8, ilustrativo), view:'cos'|'row'|'col', scale:'init'|'max' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const CAPTIONS = {
    house: 'a red house', tree: 'a green tree', sun: 'the sun in the sky', boat: 'a sailboat',
    mountain: 'a snowy mountain', fish: 'a teal fish', car: 'a small car', star: 'a yellow star',
  };
  const SHORT = { house: 'house', tree: 'tree', sun: 'sun', boat: 'boat', mountain: 'mountain', fish: 'fish', car: 'car', star: 'star' };

  // Embeddings sintéticos: un vector base por concepto, imagen y texto = base + ruido distinto, L2-normalizados.
  // "sun" y "star" comparten parte de su base (un negativo difícil, como pasa con datos reales).
  function embeddings(names, E, seed) {
    const R = ATLAS.Viz.rng(seed);
    const vec = () => Array.from({ length: E }, () => R.normal());
    const base = {};
    for (const n of ATLAS.Viz.ICONS) base[n] = vec();
    const shared = vec();
    for (const n of ['sun', 'star']) base[n] = base[n].map((v, i) => 0.55 * v + 0.85 * shared[i]);
    const norm = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
    const img = names.map((n) => norm(base[n].map((v) => v + 0.6 * R.normal())));
    const txt = names.map((n) => norm(base[n].map((v) => v + 0.6 * R.normal())));
    return { img, txt };
  }
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  function softmax(xs) { const m = Math.max(...xs); const e = xs.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, fmt = A.fmt;
    const cfgId = params.config || 'clip-vit-b16';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const c = (run && run.config) || {};
    // logit scale: inicial 1/τ con τ = 0.07 y tope 100 (Radford et al. 2021, §2.5); del calculador si los expone
    const tau0 = c.temperatureInit || c.tau0 || 0.07;
    const scaleMax = c.logitScaleMax || 100;
    const knobB = (A.model && run && A.model(run.model).knobs && A.model(run.model).knobs.B) || [8, 256, 4096, 32768];
    const state = {
      B: clampB(params.B || 6), view: ['cos', 'row', 'col'].indexOf(params.view) >= 0 ? params.view : 'row',
      scale: params.scale === 'max' ? 'max' : 'init', cell: null, realB: c.B || knobB[knobB.length - 1],
    };
    function clampB(b) { return Math.max(2, Math.min(8, Math.round(b))); }

    const wrap = V.html('div', { class: 'viz viz-sim' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const chipGroup = (label, items, key, after) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => {
        const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g);
        b.addEventListener('click', () => { state[key] = v; state.cell = null; (after || draw)(); });
        b._v = v; b._k = key; return b;
      });
    };
    const chipsB = chipGroup('Lote (demo)', [[4, 'B = 4'], [6, 'B = 6'], [8, 'B = 8']], 'B');
    const chipsV = chipGroup('Ver', [['cos', 'coseno'], ['row', 'softmax por fila'], ['col', 'softmax por columna']], 'view');
    const chipsS = chipGroup('Escala', [['init', '1/τ = 1/' + tau0], ['max', 'tope ' + scaleMax]], 'scale');
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Lote, íconos y embeddings ilustrativos (generados por código, no por un CLIP entrenado). Fila = imagen, columna = texto; la diagonal son los pares correctos. Softmax por fila = pérdida imagen→texto; por columna = texto→imagen; CLIP promedia las dos.' }, wrap);

    function draw() {
      [chipsB, chipsV, chipsS].forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      const B = state.B;
      const names = V.ICONS.slice(0, B);
      const { img, txt } = embeddings(names, 16, 20210226);
      const s = state.scale === 'max' ? scaleMax : 1 / tau0;
      const cos = img.map((u) => txt.map((v) => dot(u, v)));
      const logits = cos.map((row) => row.map((x) => x * s));
      const rowP = logits.map((row) => softmax(row));
      const colP = (() => { const P = logits.map((r) => r.slice()); for (let j = 0; j < B; j++) { const col = softmax(logits.map((r) => r[j])); for (let i = 0; i < B; i++) P[i][j] = col[i]; } return P; })();
      const lossRow = rowP.map((r, i) => -Math.log(r[i]));
      const lossCol = names.map((_, j) => -Math.log(colP[j][j]));
      const Lr = mean(lossRow), Lc = mean(lossCol), L = (Lr + Lc) / 2;
      const M = state.view === 'cos' ? cos : state.view === 'row' ? rowP : colP;

      stage.innerHTML = '';
      const cs = 44, IX = 64, TOP = 92, ML = IX + 8;
      const W = ML + B * cs + 110, Hh = TOP + B * cs + 30;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px;min-width:' + Math.min(W, 600) + 'px', role: 'group',
        'aria-label': 'Matriz de ' + B + '×' + B + ' entre imágenes (filas) y textos (columnas): ' + (state.view === 'cos' ? 'similitud coseno' : state.view === 'row' ? 'softmax por fila' : 'softmax por columna') }, stage);
      t(svg, 8, 16, state.view === 'cos' ? 'cos(imagen i, texto j): embeddings con norma 1' : state.view === 'row' ? 'softmax por fila de s·cos: p(texto j | imagen i)' : 'softmax por columna de s·cos: p(imagen i | texto j)', 'viz-t');
      t(svg, 8, 31, 's = ' + fmtS(s) + ' · logits = s·Î·T̂ᵀ (B×B)', 'viz-s');
      // encabezados: columnas = textos (girados), filas = imágenes (íconos)
      names.forEach((n, j) => {
        const x = ML + j * cs + cs / 2;
        const tt = V.svg('text', { class: 'viz-s', transform: 'translate(' + (x + 3) + ',' + (TOP - 8) + ') rotate(-40)' }, svg);
        tt.textContent = 'T' + (j + 1) + ' ' + SHORT[n];
      });
      names.forEach((n, i) => { V.icon(svg, n, IX - 40, TOP + i * cs + (cs - 34) / 2, 34); t(svg, IX - 46, TOP + i * cs + cs / 2 + 4, 'I' + (i + 1), 'viz-s', 'end'); });
      const lo = state.view === 'cos' ? Math.min(...cos.flat()) : 0, hi = state.view === 'cos' ? Math.max(...cos.flat()) : 1;
      for (let i = 0; i < B; i++) for (let j = 0; j < B; j++) {
        const v = M[i][j], f = hi > lo ? (v - lo) / (hi - lo) : 0;
        const x = ML + j * cs, y = TOP + i * cs;
        const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': 'Imagen ' + (i + 1) + ' (' + SHORT[names[i]] + ') con texto ' + (j + 1) + ' (' + SHORT[names[j]] + '): coseno ' + cos[i][j].toFixed(2) + ', logit ' + logits[i][j].toFixed(1) + ', p fila ' + rowP[i][j].toFixed(2) + ', p columna ' + colP[i][j].toFixed(2) + (i === j ? ' (par positivo)' : '') }, svg);
        V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: 'viz-sim-cell', style: 'fill:color-mix(in srgb, var(--op-attn) ' + Math.round(6 + 74 * f) + '%, var(--surface))' }, gEl);
        t(gEl, x + cs / 2, y + cs / 2 + 4, v.toFixed(2), 'viz-sim-v', 'middle');
        V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: i === j ? 'viz-sim-pos' : 'viz-sim-hit' }, gEl);
        const show = () => { state.cell = { i, j }; readout(); };
        gEl.addEventListener('pointerenter', show); gEl.addEventListener('focus', show);
      }
      // pérdida por fila (derecha) y por columna (abajo)
      const lx = ML + B * cs + 10;
      t(svg, lx, TOP - 10, state.view === 'col' ? '' : '−log p(i, i)', 'viz-s');
      if (state.view !== 'col') lossRow.forEach((l, i) => t(svg, lx, TOP + i * cs + cs / 2 + 4, l.toFixed(2), 'viz-n'));
      if (state.view === 'col') {
        t(svg, 8, TOP + B * cs + 18, '−log p(j, j)', 'viz-s');
        lossCol.forEach((l, j) => t(svg, ML + j * cs + cs / 2, TOP + B * cs + 18, l.toFixed(2), 'viz-n', 'middle'));
      }
      state.last = { cos, logits, rowP, colP, names, s, L, Lr, Lc };
      readout();
      realNumbers();
    }

    function readout() {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const S = state.last; if (!S) return;
      kv('B =', state.B + ' (demo)');
      kv('negativos por imagen:', String(state.B - 1));
      const cl = state.cell;
      if (cl) {
        kv('I' + (cl.i + 1) + ' · T' + (cl.j + 1) + ':', 'cos ' + S.cos[cl.i][cl.j].toFixed(3) + ' → logit ' + S.logits[cl.i][cl.j].toFixed(2) + ' → p fila ' + S.rowP[cl.i][cl.j].toFixed(3) + ' · p columna ' + S.colP[cl.i][cl.j].toFixed(3));
      }
      kv('L(img→txt) =', S.Lr.toFixed(3));
      kv('L(txt→img) =', S.Lc.toFixed(3));
      kv('L = promedio =', S.L.toFixed(3) + ' (s = ' + fmtS(S.s) + ')');
    }

    // Números reales del calculador para el lote de verdad (no ilustrativos).
    function realNumbers() {
      real.innerHTML = '';
      if (!run) return;
      const head = V.html('div', { class: 'viz-controls' }, real);
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Lote real' }, head);
      V.html('span', { class: 'viz-ctl-l', text: 'Lote real (calculador)' }, g);
      for (const b of knobB) {
        const x = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': String(b === state.realB), text: 'B = ' + fmt.int(b) }, g);
        x.addEventListener('click', () => { state.realB = b; realNumbers(); });
      }
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      let r2 = null, m = null;
      try { r2 = A.run(cfgId, { B: state.realB }); } catch (e) { r2 = null; }
      try { m = A.metrics(cfgId, { B: state.realB }); } catch (e) { m = null; }
      const lt = r2 && r2.tensors.logits;
      if (lt) kv('logits:', fmt.shape(lt, 'sym') + ' = ' + fmt.shape(lt, 'num') + ' = ' + fmt.int(lt.elements || lt.num.reduce((a, b) => a * b, 1)) + ' números');
      const mem = m && (m.logitsMem != null ? m.logitsMem : m.logitsBytes != null ? m.logitsBytes : null);
      if (mem != null) kv('memoria de la matriz (' + (m.dtype || 'bf16') + '):', fmt.bytes(mem));
      const neg = m && (m.negatives != null ? m.negatives : m.negativesPerSample != null ? m.negativesPerSample : null);
      kv('negativos por muestra:', fmt.int(neg != null ? neg : state.realB - 1));
      const ib = r2 && r2.tensors['img-batch'];
      if (ib) kv('embeddings por lado:', fmt.shape(ib, 'sym') + ' = ' + fmt.shape(ib, 'num'));
    }
    function fmtS(s) { return s >= 99.5 ? String(Math.round(s)) : s.toFixed(1).replace(/\.0$/, ''); }
    function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
    function t(p, x, y, s, cls, anchor) { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; }

    draw();
    return { destroy() { wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('similarity-matrix', render);
})(typeof window !== 'undefined' ? window : globalThis);
