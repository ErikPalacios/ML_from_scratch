/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/ivfpq-quantize.js
   Visualización "ivfpq-quantize" (SPEC §7.8, §23.4): product quantization (Jégou, Douze y Schmid, TPAMI 2011) en un juguete
   (sintético, ilustrativo). Un vector de D = 8 dimensiones se parte en m = 4 sub-vectores de 2 dimensiones; cada sub-espacio
   tiene su codebook de K = 2^nbits centroides (k-means de verdad sobre 400 vectores de entrenamiento, semilla fija); el código
   del vector son los m índices de sus centroides más cercanos (m·nbits bits en vez de D floats). Para buscar (ADC, distancia
   asimétrica): con la consulta SIN cuantizar se arma una tabla m × K de distancias ‖q_j − c_jk‖² una sola vez; la distancia
   a cada vector de la base es la suma de m lecturas de esa tabla. Se ven el error de cuantización por sub-espacio, la tabla,
   la distancia ADC contra la exacta y cómo cambia el ranking (recall). En IVF-PQ se cuantiza el residuo x − c_lista (aquí se
   omite la lista: es la misma idea sobre el residuo). La escala real (m = 96 × 8 bits para 768 dimensiones) va en la nota, del
   calculador (modelo `ann`) si está.
   params: { nbits:4, item:0, query:0 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const D = 8, M = 4, SD = D / M, NTRAIN = 400, NDB = 12;
  const NBITS = [2, 3, 4, 6];

  // datos: mezcla de 6 gaussianas en R^8 (coordenadas en [0, 1] aprox.)
  function makeData(rng) {
    const centers = Array.from({ length: 6 }, () => Array.from({ length: D }, () => 0.15 + 0.7 * rng()));
    const draw = () => { const c = centers[Math.floor(rng() * centers.length)]; return c.map((v) => Math.max(0.01, Math.min(0.99, v + 0.11 * rng.normal()))); };
    return { train: Array.from({ length: NTRAIN }, draw), db: Array.from({ length: NDB }, draw), queries: Array.from({ length: 6 }, draw) };
  }
  const sq = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) * (v - b[i]), 0);
  const subOf = (x, j) => x.slice(j * SD, (j + 1) * SD);
  // k-means (Lloyd) con inicialización k-means++ (semilla fija): un codebook por sub-espacio
  function kmeans(pts, K, rng) {
    const C = [pts[Math.floor(rng() * pts.length)].slice()];
    while (C.length < K) {
      const d2 = pts.map((p) => Math.min(...C.map((c) => sq(p, c))));
      const tot = d2.reduce((a, b) => a + b, 0);
      let u = rng() * tot, i = 0;
      while (i < pts.length - 1 && u > d2[i]) { u -= d2[i]; i++; }
      C.push(pts[i].slice());
    }
    for (let it = 0; it < 20; it++) {
      const sum = C.map(() => new Array(SD).fill(0)), cnt = C.map(() => 0);
      pts.forEach((p) => { const k = nearest(C, p); cnt[k]++; p.forEach((v, d) => { sum[k][d] += v; }); });
      C.forEach((c, k) => { if (cnt[k]) for (let d = 0; d < SD; d++) c[d] = sum[k][d] / cnt[k]; });
    }
    return C;
  }
  function nearest(C, p) { let b = 0, bd = Infinity; C.forEach((c, k) => { const d = sq(p, c); if (d < bd) { bd = d; b = k; } }); return b; }

  function calcNote() {
    const A = ATLAS.Arch;
    if (!A || typeof A.run !== 'function') return null;
    let run = null, met = null;
    try { run = A.run('ivfpq-1m-768'); } catch (e) { return null; }
    try { met = A.metrics ? A.metrics('ivfpq-1m-768') : null; } catch (e) { met = null; }
    const c = run.config || {};
    const m = +c.m, nb = +c.nbits, d = +c.d || +c.D;
    if (!(m > 0 && nb > 0 && d > 0)) return null;
    return { m, nbits: nb, d, codeBytes: m * nb / 8, fp32: d * 4, met };
  }

  function render(el, params) {
    const V = ATLAS.Viz;
    const fint = (ATLAS.Arch && ATLAS.Arch.fmt && ATLAS.Arch.fmt.int) || ((n) => String(n));
    const state = { nbits: NBITS.indexOf(+params.nbits) >= 0 ? +params.nbits : 4, item: Number.isFinite(+params.item) ? +params.item : -1, qi: Number.isFinite(+params.query) ? +params.query : 0 };
    const data = makeData(V.rng(2011));
    const books = {};
    const bookFor = (nb) => {
      if (!books[nb]) books[nb] = Array.from({ length: M }, (_, j) => kmeans(data.train.map((x) => subOf(x, j)), 1 << nb, V.rng(77 + nb * 13 + j)));
      return books[nb];
    };

    const wrap = V.html('div', { class: 'viz viz-pq' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const all = [];
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const gB = grp('nbits (K = 2ⁿᵇⁱᵗˢ)');
    NBITS.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: v + ' (K = ' + (1 << v) + ')' }, gB); b.addEventListener('click', () => { state.nbits = v; draw(); }); b._v = v; all.push(b); });
    const gS = grp('Vector');
    const act = (g, label, fn) => { const b = V.html('button', { type: 'button', class: 'viz-chip', text: label }, g); b.addEventListener('click', () => { fn(); draw(); }); return b; };
    act(gS, 'Siguiente de la base', () => { state.item = (state.item + 1 + NDB) % NDB; });
    act(gS, 'Otra consulta', () => { state.qi = (state.qi + 1) % data.queries.length; state.item = -1; });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-pq-stage', tabindex: 0, role: 'group', 'aria-label': 'Product quantization. Flechas izquierda y derecha: vector de la base; arriba y abajo: nbits; Q: otra consulta' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.nbits)));
      const C = bookFor(state.nbits), K = 1 << state.nbits;
      const q = data.queries[state.qi];
      const codes = data.db.map((x) => C.map((cb, j) => nearest(cb, subOf(x, j))));
      const lut = C.map((cb, j) => cb.map((c) => sq(subOf(q, j), c)));
      const exact = data.db.map((x) => sq(q, x));
      const adc = codes.map((cd) => cd.reduce((s, k, j) => s + lut[j][k], 0));
      const rankBy = (arr) => arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
      const rEx = rankBy(exact), rAdc = rankBy(adc);
      if (state.item < 0) state.item = rEx[0];
      const x = data.db[state.item], cd = codes[state.item];
      const qerr = C.map((cb, j) => sq(subOf(x, j), cb[cd[j]]));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, xx, yy, s, cls, anchor) => { const e = V.svg('text', { x: r1(xx), y: r1(yy), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'PQ: D = 8 → m = 4 sub-vectores de 2' : 'Product quantization: D = 8 se parte en m = 4 sub-vectores de 2; cada uno se reemplaza por su centroide más cercano (K = ' + K + ')', 'viz-t');
      t(svg, 8, 29, narrow ? 'k-means real sobre datos sintéticos' : 'codebooks de k-means sobre ' + NTRAIN + ' vectores sintéticos; código = ' + M + ' × ' + state.nbits + ' bits = ' + (M * state.nbits / 8) + ' B en vez de ' + D * 4 + ' B (fp32)', 'viz-s');
      // ---- 4 sub-espacios
      const cols = narrow ? 2 : 4, gap = narrow ? 10 : 14;
      const s = (W - 16 - (cols - 1) * gap) / cols, y0 = 52;
      for (let j = 0; j < M; j++) {
        const px = 8 + (j % cols) * (s + gap), py = y0 + Math.floor(j / cols) * (s + 30);
        // margen de 7 px y recorte a [0, 1]: ningún centroide ni punto queda sobre el borde del panel (a 375 px se salía)
        const mg = 7, cl = (u) => Math.max(0, Math.min(1, u));
        const P = (v) => [px + mg + cl(v[0]) * (s - 2 * mg), py + mg + (1 - cl(v[1])) * (s - 2 * mg)];
        V.svg('rect', { x: r1(px), y: r1(py), width: r1(s), height: r1(s), rx: 4, class: 'viz-pq-bg' }, svg);
        t(svg, px, py - 6, 'sub-espacio ' + (j + 1) + (narrow ? '' : ' (dims ' + (j * SD + 1) + '–' + (j + 1) * SD + ')'), 'viz-s');
        let d = '';
        data.train.forEach((tx) => { const p = P(subOf(tx, j)); d += 'M' + r1(p[0]) + ' ' + r1(p[1]) + 'h0.01'; });
        V.svg('path', { d, class: 'viz-pq-train' }, svg);
        C[j].forEach((c, k) => { const p = P(c), on = k === cd[j]; V.svg('rect', { x: r1(p[0] - (on ? 4.5 : 3)), y: r1(p[1] - (on ? 4.5 : 3)), width: on ? 9 : 6, height: on ? 9 : 6, class: 'viz-pq-cent' + (on ? ' is-on' : '') }, svg); });
        const xp = P(subOf(x, j)), cp = P(C[j][cd[j]]), qp = P(subOf(q, j));
        V.svg('path', { d: 'M' + r1(xp[0]) + ' ' + r1(xp[1]) + 'L' + r1(cp[0]) + ' ' + r1(cp[1]), class: 'viz-pq-err' }, svg);
        V.svg('circle', { cx: r1(xp[0]), cy: r1(xp[1]), r: 5, class: 'viz-pq-x' }, svg);
        V.svg('path', { d: 'M' + r1(qp[0] - 6) + ' ' + r1(qp[1]) + 'L' + r1(qp[0]) + ' ' + r1(qp[1] - 6) + 'L' + r1(qp[0] + 6) + ' ' + r1(qp[1]) + 'L' + r1(qp[0]) + ' ' + r1(qp[1] + 6) + 'Z', class: 'viz-pq-q' }, svg);
        t(svg, px + s - 4, py + s - 6, 'código ' + cd[j], 'viz-n', 'end');
      }
      let yy = y0 + Math.ceil(M / cols) * (s + 30) - 12;
      // leyenda de los símbolos de los sub-espacios
      {
        let lgx = 8;
        const items = [['x', 'vector de la base x_j'], ['q', 'consulta q_j'], ['on', 'centroide elegido'], ['c', 'otros centroides'], ['err', 'error de cuantización']];
        items.forEach(([k, lab]) => {
          const iw = 18 + lab.length * 6.3 + 14;
          if (lgx > 8 && lgx + iw > W - 6) { lgx = 8; yy += 16; }
          const cx = lgx + 6, cy = yy - 4;
          if (k === 'x') V.svg('circle', { cx: r1(cx), cy: r1(cy), r: 4.5, class: 'viz-pq-x' }, svg);
          else if (k === 'q') V.svg('path', { d: 'M' + r1(cx - 5) + ' ' + r1(cy) + 'l5,-5l5,5l-5,5Z', class: 'viz-pq-q' }, svg);
          else if (k === 'on' || k === 'c') V.svg('rect', { x: r1(cx - 4), y: r1(cy - 4), width: 8, height: 8, class: 'viz-pq-cent' + (k === 'on' ? ' is-on' : '') }, svg);
          else V.svg('path', { d: 'M' + r1(cx - 6) + ' ' + r1(cy) + 'h12', class: 'viz-pq-err' }, svg);
          t(svg, lgx + 16, yy, lab, 'viz-s');
          lgx += iw;
        });
        yy += 24;
      }
      // ---- código como tira de m celdas de nbits
      t(svg, 8, yy, 'código del vector #' + (state.item + 1) + ':', 'viz-n');
      const cwid = narrow ? 52 : 64;
      cd.forEach((k, j) => {
        const xx = (narrow ? 8 : 160) + j * (cwid + 4), yb = narrow ? yy + 8 : yy - 13;
        V.svg('rect', { x: r1(xx), y: r1(yb), width: cwid, height: 18, rx: 2, class: 'viz-pq-code' }, svg);
        t(svg, xx + cwid / 2, yb + 13, k.toString(2).padStart(state.nbits, '0'), 'viz-pq-bits', 'middle');
      });
      yy += narrow ? 44 : 22;
      // ---- tabla ADC m × K
      t(svg, 8, yy, narrow ? 'tabla ADC: m × K distancias q ↔ centroides' : 'Tabla ADC (una por consulta): ' + M + ' × ' + K + ' distancias ‖q_j − c_jk‖²; la distancia a un vector = suma de ' + M + ' lecturas', 'viz-n');
      yy += 8;
      const tw = W - 16 - 30, cellW = Math.min(22, tw / K), cellH = 13;
      const lmax = Math.max(...lut.map((r) => Math.max(...r)));
      lut.forEach((row, j) => {
        t(svg, 8, yy + j * (cellH + 2) + 10, 'j=' + (j + 1), 'viz-s');
        row.forEach((v, k) => {
          const xx = 38 + k * cellW;
          V.svg('rect', { x: r1(xx), y: r1(yy + j * (cellH + 2)), width: r1(Math.max(1, cellW - 1)), height: cellH, class: 'viz-pq-lut', style: 'fill-opacity:' + Math.round((0.12 + 0.88 * (1 - v / lmax)) * 100) / 100 }, svg);
          if (k === cd[j]) V.svg('rect', { x: r1(xx - 1), y: r1(yy + j * (cellH + 2) - 1), width: r1(Math.max(3, cellW + 1)), height: cellH + 2, class: 'viz-pq-lutpick' }, svg);
        });
      });
      yy += M * (cellH + 2) + 10;
      t(svg, 8, yy, narrow ? 'intenso = cerca de q · recuadro = lectura de #' + (state.item + 1) : 'color más intenso = más cerca de q · recuadro = la lectura del vector #' + (state.item + 1), 'viz-s');
      yy += 22;
      // ---- ranking exacto vs ADC
      const kk = 3;
      t(svg, 8, yy, 'Ranking de los ' + NDB + ' vectores de la base' + (narrow ? '' : ' (top-' + kk + ' marcado)'), 'viz-n');
      yy += 16;
      const colW = narrow ? (W - 16) / 2 : 260;
      [['exacto', rEx, exact], ['ADC (PQ)', rAdc, adc]].forEach(([lab, rk, vals], c) => {
        const xx = 8 + c * colW;
        t(svg, xx, yy, lab, 'viz-s');
        rk.slice(0, 6).forEach((i, r) => {
          const inEx = rEx.slice(0, kk).indexOf(i) >= 0;
          t(svg, xx, yy + 15 + r * 14, (r + 1) + '. #' + (i + 1) + '  ' + vals[i].toFixed(3), 'viz-pq-rank' + (r < kk ? ' is-top' : '') + (c === 1 && r < kk && !inEx ? ' is-miss' : '') + (i === state.item ? ' is-cur' : ''));
        });
      });
      yy += 15 + 6 * 14 + 6;
      const recall = rAdc.slice(0, kk).filter((i) => rEx.slice(0, kk).indexOf(i) >= 0).length / kk;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(yy + 6));
      svg.setAttribute('aria-label', 'PQ con m = 4 y K = ' + K + '. Vector #' + (state.item + 1) + ': código ' + cd.join(', ') + '; distancia exacta a la consulta ' + exact[state.item].toFixed(3) + ', ADC ' + adc[state.item].toFixed(3) + '. Recall@3 del ADC: ' + recall.toFixed(2) + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('bytes por vector:', (M * state.nbits / 8) + ' B (fp32: ' + D * 4 + ' B)');
      kv('error de cuantización ‖x − x̂‖²:', qerr.reduce((a, b) => a + b, 0).toFixed(3));
      kv('distancia exacta:', exact[state.item].toFixed(3));
      kv('ADC:', adc[state.item].toFixed(3));
      kv('recall@3:', recall.toFixed(2));
      const cn = calcNote();
      note.textContent = 'Más bits por sub-vector = más centroides = menos error y mejor recall, a cambio de un código más largo y una tabla más grande (m × 2ⁿᵇⁱᵗˢ). ADC no cuantiza la consulta: solo la base. La tabla se arma una vez por consulta (m·K distancias de d/m dimensiones) y después cada vector cuesta m sumas, sin multiplicar. En IVF-PQ esto se aplica al residuo x − c_lista de cada vector respecto del centroide de su lista (y la tabla se arma con q − c_lista, una vez por lista recorrida); aquí se omite la lista para ver solo la cuantización.' + (cn ? ' A escala real (ivfpq-1m-768): d = ' + cn.d + ' en m = ' + cn.m + ' sub-vectores de ' + (cn.d / cn.m) + ', ' + cn.nbits + ' bits cada uno: ' + fint(cn.codeBytes) + ' B por vector en vez de ' + fint(cn.fp32) + ' B en fp32 (' + Math.round(cn.fp32 / cn.codeBytes) + '× menos).' : '');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.item = (state.item + (k === 'ArrowRight' ? 1 : NDB - 1)) % NDB; draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); const i = NBITS.indexOf(state.nbits); state.nbits = NBITS[Math.max(0, Math.min(NBITS.length - 1, i + (k === 'ArrowUp' ? 1 : -1)))]; draw(); }
      else if (k === 'q' || k === 'Q') { ev.preventDefault(); state.qi = (state.qi + 1) % data.queries.length; state.item = -1; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('ivfpq-quantize', render);
})(typeof window !== 'undefined' ? window : globalThis);
