/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/attention-masks.js
   Visualización "attention-masks" (SPEC §7.8, §13.2): las tres máscaras lado a lado con N
   posiciones (N = 5 del juguete, como en el Laboratorio): bidireccional (encoder), causal
   (decoder) y cross-attention (queries del decoder × keys/values del encoder). Fila = query,
   columna = key. Los conteos (N², N(N+1)/2) se calculan aquí a partir de N del calculador y se
   comparan con ATLAS.Arch.metrics cuando existe la config causal. No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const cfgId = params.config || 'toy-n5-d8';
    const run = A.run(cfgId);
    const N = run.config.N || run.config.tokens || (run.quantities && run.quantities.tokens) || 5;
    const S = params.source || N;                 // largo de la secuencia del encoder en cross-attention (keys/values)
    const M = params.queries || Math.max(2, N - 2); // queries del decoder: otro largo (M × N no tiene por qué ser cuadrada)
    const fmt = A.fmt;
    const state = { cell: null };

    const wrap = V.html('div', { class: 'viz viz-masks' }, el);
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Fila = query (quien pregunta), columna = key (a quién puede mirar). Celda llena = puntuación usada; vacía con × = −∞ antes de la softmax (peso 0). Pasa el cursor o enfoca una celda.' }, wrap);

    const masks = [
      { id: 'bi', title: 'Bidireccional', sub: 'encoder (BERT, ViT)', rows: N, cols: N, on: () => true, cls: 'viz-mask-on', qn: 'token', kn: 'token' },
      { id: 'causal', title: 'Causal', sub: 'decoder (GPT, LLMs)', rows: N, cols: N, on: (i, j) => j <= i, cls: 'viz-mask-on', qn: 'token', kn: 'token' },
      { id: 'cross', title: 'Cross-attention', sub: 'Q: decoder (M) · K,V: encoder (N)', rows: M, cols: S, on: () => true, cls: 'viz-mask-cross', qn: 'decoder', kn: 'encoder', foot: 'M × N: no tiene por qué ser cuadrada' },
    ];
    const cs = 22, pad = 44, mw = Math.max(N, S) * cs;
    const W = masks.length * (mw + pad + 26) + 100, Hh = N * cs + 84;   // +90: textos de la tercera máscara
    const svg = V.svg('svg', { class: 'viz-svg', style: 'max-width:' + W + 'px', viewBox: '0 0 ' + W + ' ' + Hh, role: 'group', 'aria-label': 'Tres máscaras de atención con ' + N + ' posiciones' }, stage);

    masks.forEach((m, k) => {
      const ox = 10 + k * (mw + pad + 26) + 26, oy = 48;
      txt(svg, ox - 26, 16, m.title, 'viz-t');
      txt(svg, ox - 26, 31, m.sub, 'viz-s');
      txt(svg, ox + m.cols * cs / 2, oy - 4, 'keys →', 'viz-s', 'middle');
      const lab = V.svg('text', { class: 'viz-s', transform: 'translate(' + (ox - 14) + ',' + (oy + m.rows * cs / 2) + ') rotate(-90)', 'text-anchor': 'middle' }, svg);
      lab.textContent = 'queries';
      let used = 0;
      for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) {
        const ok = m.on(i, j);
        if (ok) used++;
        const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': m.title + ': query ' + (i + 1) + ' → key ' + (j + 1) + (ok ? ' permitido' : ' bloqueado') }, svg);
        const x = ox + j * cs, y = oy + i * cs;
        if (ok) V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: m.cls }, gEl);
        else { V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: 'viz-mask-off' }, gEl); V.svg('path', { d: 'M' + (x + 7) + ' ' + (y + 7) + 'l8 8m0 -8l-8 8', class: 'viz-mask-x' }, gEl); }
        V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, fill: 'none', stroke: 'none' }, gEl);
        const show = () => { state.cell = { m, i, j, ok }; readout(); };
        gEl.addEventListener('pointerenter', show); gEl.addEventListener('focus', show);
      }
      for (let i = 0; i < m.rows; i++) txt(svg, ox - 4, oy + i * cs + cs / 2 + 4, String(i + 1), 'viz-s', 'end');
      for (let j = 0; j < m.cols; j++) txt(svg, ox + j * cs + cs / 2, oy + m.rows * cs + 13, String(j + 1), 'viz-s', 'middle');
      txt(svg, ox - 26, oy + m.rows * cs + 32, 'usadas: ' + used + ' de ' + (m.rows * m.cols), 'viz-n');
      if (m.foot) txt(svg, ox - 26, oy + m.rows * cs + 48, m.foot, 'viz-s');
      m.used = used;
    });

    function readout() {
      out.innerHTML = '';
      const kv = (k, v) => { const s = V.html('span', null, out); s.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('N =', N);
      kv('bidireccional:', 'N² = ' + fmt.int(N * N));
      kv('causal:', 'N(N+1)/2 = ' + fmt.int(N * (N + 1) / 2) + ' (mismos MACs: la máscara no ahorra cómputo sin kernels especiales)');
      kv('cross-attention:', 'M×N = ' + M + '×' + S + ' = ' + fmt.int(M * S));
      const c = state.cell;
      if (c) kv(c.m.title + ':', 'query ' + (c.i + 1) + ' (' + c.m.qn + ') → key ' + (c.j + 1) + ' (' + c.m.kn + ') ' + (c.ok ? 'permitido' : 'bloqueado: −∞ → peso 0'));
    }
    function txt(p, x, y, s, c, anchor) { const t = V.svg('text', { x, y, class: c, 'text-anchor': anchor || null }, p); t.textContent = s; return t; }
    readout();
    return { destroy() { wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('attention-masks', render);
})(typeof window !== 'undefined' ? window : globalThis);
