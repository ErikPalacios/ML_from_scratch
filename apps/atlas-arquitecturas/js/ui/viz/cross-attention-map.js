/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/cross-attention-map.js
   Visualización "cross-attention-map" (SPEC §7.8, §24.4): la matriz de cross-attention de un decoder encoder-decoder.
   Filas = tokens del decoder (queries, uno por paso de generación); columnas = posiciones del encoder (keys y values, las MISMAS
   para todos los pasos: se calculan una vez por entrada). Cada fila es una softmax sobre las T_in posiciones.
   Dos ejemplos ILUSTRATIVOS (pesos sintéticos, una cabeza; no salen de un modelo entrenado):
     · T5 (traducción en→de): "I have eaten the apple ." → "Ich habe den Apfel gegessen ." (el verbo va al final en alemán: la
       fila de "gegessen" mira a "eaten", fuera de la diagonal).
     · Whisper: una frase de ≈ 3.4 s dentro de la ventana de 30 s; las columnas agrupan las posiciones del encoder (20 ms cada
       una) en tramos de 0.5 s; la parte de relleno (silencio) casi no recibe atención. Whisper usa justo algunas cabezas de
       cross-attention (alignment_heads) + DTW para las marcas de tiempo por palabra.
   Del calculador (si está el modelo): T_in, T_out y el largo de la ventana de la config canónica (la línea de abajo).
   params: { model:'t5'|'whisper', step:<fila> }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const EX = {
    t5: {
      title: 'T5 · traducción (inglés → alemán)', cfg: 't5-base',
      src: ['I', 'have', 'eaten', 'the', 'apple', '.', '</s>'],
      tgt: ['Ich', 'habe', 'den', 'Apfel', 'gegessen', '.', '</s>'],
      align: [0, 1, 3, 4, 2, 5, 6],
    },
    whisper: {
      title: 'Whisper · transcripción de 30 s (≈ 3.4 s de voz)', cfg: 'whisper-small',
      // palabras con su tramo de tiempo (s), sintético
      tgt: [' Hoy', ' vamos', ' a', ' ver', ' cómo', ' funciona', ' Whisper', '.'],
      times: [[0.30, 0.62], [0.62, 1.02], [1.02, 1.12], [1.12, 1.50], [1.62, 2.00], [2.00, 2.62], [2.70, 3.30], [3.30, 3.40]],
      speechEnd: 3.5, window: 30, posMs: 20, binS: 0.5,
    },
  };

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fint = (A && A.fmt && A.fmt.int) || ((n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const state = { model: EX[params.model] ? params.model : 't5', step: Number.isFinite(+params.step) ? +params.step : 3, all: false, zoom: !!params.zoom };
    // Whisper: ventana completa (30 s en tramos de 0.5 s) o zoom a los primeros 4 s (tramos de 0.1 s = 5 posiciones)
    const binS = () => (state.zoom ? 0.1 : EX.whisper.binS);
    const viewS = () => (state.zoom ? 4 : EX.whisper.window);

    // pesos sintéticos (semilla fija): softmax por fila
    function weights(key) {
      const ex = EX[key], rng = V.rng(key === 't5' ? 515 : 1500);
      if (key === 't5') {
        return ex.tgt.map((_, i) => {
          const sc = ex.src.map((_, j) => 3.4 * Math.exp(-Math.pow(j - ex.align[i], 2) / 0.45) + 0.5 * rng() + (j === ex.src.length - 1 ? 0.6 : 0));
          return softmax(sc);
        });
      }
      // pesos por posición del encoder (20 ms) y luego sumados por columna dibujada (tramos de binS segundos)
      const nPos = Math.round(ex.window * 1000 / ex.posMs), bin = binS(), per = Math.round(bin * 1000 / ex.posMs), span = viewS();
      return ex.tgt.map((_, i) => {
        const [a, b] = ex.times[i], c = (a + b) / 2, s = Math.max(0.08, (b - a) / 2);
        const sc = Array.from({ length: nPos }, (_, p) => {
          const tc = (p + 0.5) * ex.posMs / 1000;
          return 6 * Math.exp(-Math.pow(tc - c, 2) / (2 * s * s)) + 0.3 * rng() - (tc > ex.speechEnd ? 2.5 : 0);
        });
        const w = softmax(sc), cols = [];
        for (let j = 0; j < Math.round(span / bin); j++) { let acc = 0; for (let p = j * per; p < (j + 1) * per; p++) acc += w[p]; cols.push(acc); }
        return cols;
      });
    }
    function softmax(v) { const m = Math.max.apply(null, v); const e = v.map((x) => Math.exp(x - m)); const s = e.reduce((p, q) => p + q, 0); return e.map((x) => x / s); }
    // números de la config canónica (si el calculador tiene el modelo)
    function calcInfo(key) {
      const cfg = EX[key].cfg;
      try {
        const run = A.run(cfg), c = run.config || {};
        const Tin = c.Tin != null ? c.Tin : key === 'whisper' ? (c.frames ? c.frames / 2 : null) : null;
        return { label: (A.configs ? (A.configs().find((x) => x.id === cfg) || {}).label : null) || cfg, Tin, Tout: c.Tout, h: c.h, L: c.Ld != null ? c.Ld : c.L };
      } catch (e) { return null; }
    }

    const wrap = V.html('div', { class: 'viz viz-xam' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const gM = grp('Ejemplo');
    const mBtns = Object.keys(EX).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: k === 't5' ? 'T5 (traducción)' : 'Whisper (audio)' }, gM); b.addEventListener('click', () => { state.model = k; state.step = Math.min(state.step, EX[k].tgt.length - 1); draw(); }); b._k = k; return b; });
    const gS = grp('Filas');
    const bStep = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'true', text: 'Hasta el paso actual' }, gS);
    const bAll = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'Todas' }, gS);
    bStep.addEventListener('click', () => { state.all = false; draw(); });
    bAll.addEventListener('click', () => { state.all = true; draw(); });
    const gN = grp('Paso');
    const bPrev = V.html('button', { type: 'button', class: 'viz-chip', text: '← anterior', 'aria-label': 'Paso anterior' }, gN);
    const bNext = V.html('button', { type: 'button', class: 'viz-chip', text: 'siguiente →', 'aria-label': 'Paso siguiente' }, gN);
    bPrev.addEventListener('click', () => { state.step = Math.max(0, state.step - 1); draw(); });
    bNext.addEventListener('click', () => { state.step = Math.min(EX[state.model].tgt.length - 1, state.step + 1); draw(); });
    const gZ = grp('Audio');
    const bFull = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'true', text: 'Ventana de 30 s' }, gZ);
    const bZoom = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'Zoom: 0–4 s' }, gZ);
    bFull.addEventListener('click', () => { state.zoom = false; draw(); });
    bZoom.addEventListener('click', () => { state.zoom = true; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-xam-stage', tabindex: 0, role: 'group', 'aria-label': 'Mapa de cross-attention. Flechas arriba y abajo: paso de generación (fila); T: todas las filas' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      mBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.model)));
      bStep.setAttribute('aria-pressed', String(!state.all)); bAll.setAttribute('aria-pressed', String(state.all));
      gZ.hidden = state.model !== 'whisper';
      bFull.setAttribute('aria-pressed', String(!state.zoom)); bZoom.setAttribute('aria-pressed', String(state.zoom));
      const ex = EX[state.model], key = state.model, Wt = weights(key);
      const info = calcInfo(key);
      // posiciones del encoder de Whisper: del calculador (1,500 = 3,000 frames / 2); si no está el modelo, las del paper
      const encPos = key === 'whisper' && info && info.Tin ? info.Tin : 1500;
      const nR = ex.tgt.length, nC = Wt[0].length;
      state.step = Math.max(0, Math.min(nR - 1, state.step));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 15, narrow ? (key === 't5' ? 'Cross-attention · T5 (en → de)' : 'Cross-attention · Whisper') : 'Cross-attention: ' + ex.title, 'viz-t');
      t(svg, 8, 29, narrow ? 'una cabeza, pesos sintéticos' : 'fila = token que genera el decoder (query); columna = posición del encoder (key y value) · una cabeza, pesos sintéticos', 'viz-s');
      // geometría de la grilla
      const labW = narrow ? 70 : 104, x0 = 8 + labW, gw = W - x0 - (narrow ? 8 : 20);
      const cs = Math.min(key === 't5' ? (narrow ? 38 : 62) : 100, gw / nC);
      const ch = key === 't5' ? Math.min(cs, narrow ? 30 : 36) : (narrow ? 22 : 26);
      const gx = x0, gy = narrow ? 100 : 92;
      // banda de K,V arriba: las columnas se calculan una vez
      const bandY = gy - (key === 't5' ? 40 : 48);
      V.svg('rect', { x: r1(gx), y: r1(bandY), width: r1(cs * nC), height: 14, rx: 2, class: 'viz-xam-kv' }, svg);
      t(svg, gx + cs * nC / 2, bandY + 10.5, narrow ? 'K, V del encoder: una vez' : 'K, V del encoder: se calculan UNA vez y sirven a todos los pasos', 'viz-xam-kvt', 'middle');
      // etiquetas de columna
      if (key === 't5') ex.src.forEach((s, j) => t(svg, gx + (j + 0.5) * cs, gy - 8, s, 'viz-xam-col', 'middle'));
      else {
        const span = viewS(), step = state.zoom ? (narrow ? 1 : 0.5) : (narrow ? 10 : 5);
        for (let s = 0; s <= span + 1e-9; s += step) { const xx = gx + (s / binS()) * cs; t(svg, xx, gy - 8, (Math.round(s * 10) / 10) + ' s', 'viz-xam-col', s === 0 ? 'start' : Math.abs(s - span) < 1e-9 ? 'end' : 'middle'); V.svg('path', { d: 'M' + r1(xx) + ' ' + r1(gy - 4) + 'V' + r1(gy), class: 'viz-xam-tick' }, svg); }
        const pe = gx + (ex.speechEnd / binS()) * cs;
        V.svg('rect', { x: r1(pe), y: r1(gy + nR * ch + 4), width: r1(gx + nC * cs - pe), height: 8, class: 'viz-xam-pad' }, svg);
        // revisión fase 12: "relleno →" (zoom) anclado a su final: centrado en un tramo angosto se salía a la derecha a 375 px
        if (state.zoom) t(svg, gx + nC * cs, gy + nR * ch + 24, 'relleno →', 'viz-s', 'end');
        else t(svg, (pe + gx + nC * cs) / 2, gy + nR * ch + 24, narrow ? 'relleno hasta 30 s' : 'relleno (silencio) hasta completar 30 s: casi sin atención', 'viz-s', 'middle');
        V.svg('rect', { x: r1(gx), y: r1(gy + nR * ch + 4), width: r1(pe - gx), height: 8, class: 'viz-xam-speech' }, svg);
        t(svg, gx, gy + nR * ch + 24, 'voz', 'viz-s');
      }
      // celdas
      const grid = V.svg('g', { role: 'grid', 'aria-label': 'Pesos de atención' }, svg);
      Wt.forEach((row, i) => {
        const future = !state.all && i > state.step;
        const mx = Math.max.apply(null, row);
        const lab = key === 't5' ? (i === 0 ? '<pad>→' : '') + ex.tgt[i] : ex.tgt[i].trim() || ex.tgt[i];
        t(svg, gx - 6, gy + i * ch + ch / 2 + 4, lab, 'viz-xam-row' + (i === state.step ? ' is-cur' : '') + (future ? ' is-future' : ''), 'end');
        const g = V.svg('g', { class: 'viz-cell-btn', 'data-row': i }, grid);
        g.addEventListener('click', () => { state.step = i; draw(); });
        row.forEach((w, j) => {
          V.svg('rect', { x: r1(gx + j * cs), y: r1(gy + i * ch), width: r1(cs), height: r1(ch), class: 'viz-xam-bg' }, g);
          if (!future) V.svg('rect', { x: r1(gx + j * cs + 0.5), y: r1(gy + i * ch + 0.5), width: r1(cs - 1), height: r1(ch - 1), class: 'viz-heat viz-xam-cell', 'fill-opacity': (0.9 * Math.pow(w / mx, key === 't5' ? 0.5 : 0.8)).toFixed(3) }, g);
        });
        if (future) t(svg, gx + cs * nC / 2, gy + i * ch + ch / 2 + 4, i === state.step + 1 ? 'aún no generado' : '', 'viz-s', 'middle');
      });
      V.svg('rect', { x: r1(gx - 1), y: r1(gy + state.step * ch - 1), width: r1(cs * nC + 2), height: r1(ch + 2), class: 'viz-xam-sel' }, svg);
      let y = gy + nR * ch + (key === 't5' ? 24 : 44);
      // fila actual: a dónde mira (top 2)
      const row = Wt[state.step];
      const order = row.map((w, j) => [w, j]).sort((a, b) => b[0] - a[0]);
      const colName = (j) => (key === 't5' ? '"' + ex.src[j] + '"' : (j * binS()).toFixed(1) + '–' + ((j + 1) * binS()).toFixed(1) + ' s');
      const curTok = key === 't5' ? ex.tgt[state.step] : ex.tgt[state.step].trim();
      t(svg, 8, y, 'Paso ' + (state.step + 1) + ' ("' + curTok + '"): ' + Math.round(100 * order[0][0]) + ' % en ' + colName(order[0][1]) + (narrow ? '' : ', ' + Math.round(100 * order[1][0]) + ' % en ' + colName(order[1][1])), 'viz-n');
      y += 16;
      if (info && info.Tin) {
        // revisión fase 12: versión corta a ≤ 640 px (las largas terminaban en 430 / 549 px de 314)
        const s = key === 't5'
          ? (narrow ? info.label + ': softmax sobre T_in = ' + fint(info.Tin) : 'En ' + info.label + ': cada fila es una softmax sobre T_in = ' + fint(info.Tin) + ' posiciones')
          : (narrow ? info.label.replace(/^Whisper /, '') + ': ' + fint(info.Tin) + ' posiciones (20 ms)' : 'En ' + info.label + ': cada fila mira las ' + fint(info.Tin) + ' posiciones del encoder (una cada 20 ms)');
        t(svg, 8, y, s, 'viz-s'); y += 14;
      }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y + 4));
      svg.setAttribute('aria-label', 'Cross-attention, ' + ex.title + '. Paso ' + (state.step + 1) + ', token ' + curTok + ': la mayor atención va a ' + colName(order[0][1]) + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('matriz (una cabeza):', nR + ' × ' + (key === 't5' ? nC : fint(encPos) + ' (dibujadas ' + nC + ' columnas de ' + binS() + ' s' + (state.zoom ? ', solo 0–4 s' : '') + ')'));
      kv('fila:', 'softmax, suma 1');
      kv('columnas:', key === 't5' ? 'K, V de los ' + nC + ' tokens de entrada' : 'K, V de las ' + fint(encPos) + ' posiciones');
      if (info && info.L && info.h) kv('en el modelo:', info.L + ' capas × ' + info.h + ' cabezas');
      note.innerHTML = key === 't5'
        ? 'Cada token nuevo del decoder lanza una query contra TODA la salida del encoder: no hay máscara causal en la cross-attention (la entrada ya está completa), solo en la self-attention del decoder. Las K y V salen de la salida del encoder con W_K y W_V de cada capa: no cambian mientras se genera, así que se calculan una vez y se guardan (la "cross-attention KV cache"). En traducción, el mapa se parece a un alineamiento: "gegessen" va al final en alemán y su fila mira a "eaten". Pesos sintéticos de una cabeza: las cabezas reales son más difusas y cada una mira cosas distintas.'
        : 'Whisper rellena todo audio hasta 30 s: el encoder siempre produce ' + fint(encPos) + ' posiciones (' + fint(2 * encPos) + ' frames de 10 ms; la segunda conv tiene stride 2), aunque la voz dure 3 s. Cada token de texto mira sobre todo el tramo de audio donde se dijo esa palabra: el mapa avanza en diagonal con el tiempo. Whisper usa algunas cabezas de cross-attention con este comportamiento (alignment_heads) y DTW para sacar marcas de tiempo por palabra. Las K y V de las ' + fint(encPos) + ' posiciones se calculan una vez por ventana y sirven a todos los tokens. Pesos sintéticos.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, n = EX[state.model].tgt.length;
      if (k === 'ArrowDown' || k === 'ArrowRight') { ev.preventDefault(); state.step = Math.min(n - 1, state.step + 1); draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowLeft') { ev.preventDefault(); state.step = Math.max(0, state.step - 1); draw(); }
      else if (k === 't' || k === 'T') { ev.preventDefault(); state.all = !state.all; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('cross-attention-map', render);
})(typeof window !== 'undefined' ? window : globalThis);
