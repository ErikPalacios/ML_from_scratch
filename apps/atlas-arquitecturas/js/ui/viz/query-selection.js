/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/query-selection.js
   Visualización "query-selection" (SPEC §7.8, §16.3): la selección de queries guiada por el lenguaje de
   Grounding DINO. Cada token de imagen (salida del feature enhancer) se compara con cada token del texto
   (producto punto); su puntaje es el MÁXIMO sobre los tokens del texto; los top-K tokens de imagen se
   vuelven las queries del decoder: su posición (la caja que se predice en ese token) inicializa la parte
   posicional; la parte de contenido es aprendida (como en DINO).
   Escena, rejilla y similitudes: SINTÉTICAS ("ilustrativo"). Los números reales (N tokens de imagen en los
   niveles, T, Q y el costo de la matriz N×T) salen de ATLAS.Arch.run(config) y de metrics().
   params: { config:'grounding-dino-t', prompt:'cat-dog'|'cat'|'dog-car'|'zebra', k:<n>, cell:<i> }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // Escena: objetos con su caja normalizada [cx, cy, w, h] y la palabra que los nombra.
  const OBJECTS = [
    { icon: 'tree', word: 'tree', box: [0.11, 0.50, 0.14, 0.52] },
    { icon: 'sun', word: 'sun', box: [0.88, 0.17, 0.11, 0.18] },
    { icon: 'cat', word: 'cat', box: [0.36, 0.71, 0.20, 0.30] },
    { icon: 'dog', word: 'dog', box: [0.67, 0.68, 0.28, 0.36] },
    { icon: 'car', word: 'car', box: [0.88, 0.84, 0.16, 0.16] },
  ];
  // Prompts: la frase (con los puntos que separan categorías, como en el paper) y sus tokens BERT.
  const PROMPTS = {
    'cat-dog': { text: 'cat . dog .', toks: ['[CLS]', 'cat', '.', 'dog', '.', '[SEP]'] },
    cat: { text: 'cat .', toks: ['[CLS]', 'cat', '.', '[SEP]'] },
    'dog-car': { text: 'dog . car .', toks: ['[CLS]', 'dog', '.', 'car', '.', '[SEP]'] },
    zebra: { text: 'zebra .', toks: ['[CLS]', 'zebra', '.', '[SEP]'] },
  };
  const SPECIAL = { '[CLS]': 1, '[SEP]': 1, '.': 1 };
  // Afinidad sintética palabra → objeto (las que no están: 0; "zebra" se parece un poco a los animales)
  const AFF = { cat: { cat: 1, dog: 0.25 }, dog: { dog: 1, cat: 0.25 }, car: { car: 1 }, zebra: { cat: 0.22, dog: 0.26 }, tree: { tree: 1 } };
  const GR = 12, GC = 18;                       // rejilla de la demo: 12×18 = 216 tokens (proporción 2:3 como 896×1344)

  function cfgNum(c, keys, d) { for (const k of keys) { const v = String(k).split('.').reduce((o, p) => (o == null ? o : o[p]), c); if (Number.isFinite(v)) return v; } return d; }

  // Números reales del calculador (con respaldos si la config no los tiene).
  function realOf(run) {
    const c = (run && run.config) || {};
    const m = (run && run.metrics) || {};
    const tz = (run && run.tensors) || {};
    const n0 = (id) => (tz[id] && tz[id].num ? tz[id].num : null);
    const qn = run && run.quantities ? run.quantities : {};
    const Q = cfgNum(c, ['Q', 'numQueries'], 900);
    const T = cfgNum(c, ['T', 'textLen'], 16);
    let N = cfgNum(qn, ['imgTokens', 'tokens', 'N'], null) || cfgNum(m, ['imgTokens', 'tokens'], null);
    const mem = n0('i-mem') || n0('i-memory') || n0('i-tokens');
    if (!N && mem) N = mem[0];
    const levels = Array.isArray(c.levelShapes) ? c.levelShapes : null;
    return { Q, T, N: N || null, D: cfgNum(c, ['D', 'd'], 256), H: cfgNum(c, ['H'], null), W: cfgNum(c, ['W'], null), levels, m, qn, c };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n) };
    const cfgId = params.config || 'grounding-dino-t';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const real = realOf(run);
    const NT = GR * GC;
    // K por defecto: la misma proporción que Q/N en el modelo real (≈ 900 de ~25 mil), al menos 4
    const kProp = real.N ? Math.max(4, Math.round(NT * real.Q / real.N)) : 8;
    const K_CHIPS = Array.from(new Set([kProp, 16, 32, 64])).sort((a, b) => a - b);
    const state = { prompt: PROMPTS[params.prompt] ? params.prompt : 'cat-dog', k: K_CHIPS.indexOf(+params.k) >= 0 ? +params.k : kProp, cell: null };

    const wrap = V.html('div', { class: 'viz viz-qs' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const gp = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Prompt' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Prompt' }, gp);
    const bP = Object.keys(PROMPTS).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: '"' + PROMPTS[k].text + '"' }, gp); b.addEventListener('click', () => { state.prompt = k; state.cell = null; draw(); }); b._v = k; return b; });
    const gk = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Queries K' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'top-K' }, gk);
    const bK = K_CHIPS.map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: k === kProp ? k + ' (≈ Q/N real)' : String(k) }, gk); b.addEventListener('click', () => { state.k = k; draw(); }); b._v = k; return b; });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const realBox = V.html('div', { class: 'viz-real viz-readout' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'Similitudes sintéticas (no de un modelo entrenado) en una rejilla de ' + GR + '×' + GC + ' = ' + NT + ' tokens de un solo nivel; el modelo real usa los tokens de los 4 niveles a la vez. Puntaje de cada token de imagen = <b>máx</b> sobre los tokens del texto de su producto punto; los K mejores se vuelven queries. Con un prompt que no está en la imagen ("zebra") igual se eligen K: decidir si hay objeto le toca al umbral de la salida, no a la selección. Toca un token (o muévete con las flechas) para ver su fila de similitudes.');

    // ---- similitudes sintéticas (con semilla): sims[cell][token]
    function sims(pk) {
      const P = PROMPTS[pk];
      const R = V.rng(7 + pk.length * 13);
      const out = [];
      for (let i = 0; i < NT; i++) {
        const r = Math.floor(i / GC), c = i % GC;
        const fx = (c + 0.5) / GC, fy = (r + 0.5) / GR;
        // pertenencia suave de la celda a cada objeto (gaussiana dentro de la caja)
        const memb = {};
        for (const o of OBJECTS) {
          const dx = (fx - o.box[0]) / (o.box[2] / 2), dy = (fy - o.box[1]) / (o.box[3] / 2);
          memb[o.word] = Math.exp(-1.3 * (dx * dx + dy * dy));
        }
        out.push(P.toks.map((t) => {
          const nz = (R() - 0.5) * 0.14;
          if (SPECIAL[t]) return -0.25 + nz * 0.8 + (t === '[CLS]' ? 0.05 : 0);
          const aff = AFF[t] || {};
          let v = -0.12;
          for (const w in aff) v += 1.05 * aff[w] * memb[w];
          return v + nz;
        }));
      }
      return out;
    }

    function draw() {
      bP.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.prompt)));
      bK.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.k)));
      const P = PROMPTS[state.prompt];
      const S = sims(state.prompt);
      const score = S.map((row) => Math.max(...row));
      const arg = S.map((row) => row.indexOf(Math.max(...row)));
      const order = score.map((v, i) => i).sort((a, b) => score[b] - score[a]);
      const sel = new Set(order.slice(0, state.k));
      const cut = score[order[state.k - 1]];
      if (state.cell == null) state.cell = order[0];
      // escala FIJA (no por prompt): con "zebra" el mapa queda pálido aunque igual se elijan K tokens
      const lo = -0.3, hi = 1.0;

      stage.innerHTML = '';
      const cs = 22, IX = 12, IY = 40, IW = GC * cs, IH = GR * cs;
      const RX = IX + IW + 34, RW = 384;
      const Wd = RX + RW + 12, Hh = IY + IH + 34;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + Wd + ' ' + Hh, style: 'max-width:' + Wd + 'px;min-width:' + Math.min(Wd, 640) + 'px', role: 'group',
        'aria-label': 'Selección de queries con el prompt "' + P.text + '": se eligen los ' + state.k + ' tokens de imagen con mayor similitud máxima al texto.' }, stage);
      t(svg, IX, 16, '1 · Tokens de imagen × tokens de texto → máx por token', 'viz-t');
      t(svg, IX, 31, 'color = máx de sim(img, txt) · contorno = top-' + state.k, 'viz-s');
      V.detScene(svg, IX, IY, IW, IH, OBJECTS);
      // mapa de calor del puntaje (color de fusión: imagen × texto)
      const grid = V.svg('g', { tabindex: 0, role: 'grid', 'aria-label': 'Tokens de imagen: flechas para moverse, Enter para elegir' }, svg);
      for (let i = 0; i < NT; i++) {
        const r = Math.floor(i / GC), c = i % GC;
        const a = Math.min(1, Math.max(0, (score[i] - lo) / (hi - lo)));
        const rect = V.svg('rect', { x: IX + c * cs, y: IY + r * cs, width: cs, height: cs, class: 'viz-heat', fill: 'var(--op-fuse)', 'fill-opacity': (0.08 + 0.62 * a * a).toFixed(3) }, grid);
        rect.addEventListener('click', () => { state.cell = i; draw(); });
      }
      let d = '';
      for (let i = 1; i < GC; i++) d += 'M' + (IX + i * cs) + ' ' + IY + 'V' + (IY + IH);
      for (let i = 1; i < GR; i++) d += 'M' + IX + ' ' + (IY + i * cs) + 'H' + (IX + IW);
      V.svg('path', { d, class: 'viz-qs-grid', 'pointer-events': 'none' }, svg);
      // seleccionados: contorno + la caja que se predice en ese token (parte posicional de la query)
      for (const i of sel) {
        const r = Math.floor(i / GC), c = i % GC;
        V.svg('rect', { x: IX + c * cs + 1.5, y: IY + r * cs + 1.5, width: cs - 3, height: cs - 3, class: 'viz-qs-sel', 'pointer-events': 'none' }, svg);
      }
      const cr = Math.floor(state.cell / GC), cc = state.cell % GC;
      // caja ancla del token elegido (ilustrativa: la del objeto que domina la celda, o una caja chica)
      const fx = (cc + 0.5) / GC, fy = (cr + 0.5) / GR;
      const near = OBJECTS.map((o) => [Math.hypot((fx - o.box[0]) / o.box[2], (fy - o.box[1]) / o.box[3]), o]).sort((a, b) => a[0] - b[0])[0];
      const ab = near[0] < 0.6 ? near[1].box : [fx, fy, 0.08, 0.12];
      if (sel.has(state.cell)) V.svg('rect', { x: IX + (ab[0] - ab[2] / 2) * IW, y: IY + (ab[1] - ab[3] / 2) * IH, width: ab[2] * IW, height: ab[3] * IH, class: 'viz-qs-anchor', 'pointer-events': 'none' }, svg);
      V.svg('rect', { x: IX + cc * cs, y: IY + cr * cs, width: cs, height: cs, class: 'viz-q', 'pointer-events': 'none' }, svg);
      V.svg('rect', { x: IX, y: IY, width: IW, height: IH, class: 'viz-det-frame', 'pointer-events': 'none' }, svg);
      grid.addEventListener('keydown', (ev) => {
        const k = ev.key; let q = state.cell;
        if (k === 'ArrowRight' && q % GC < GC - 1) q++; else if (k === 'ArrowLeft' && q % GC > 0) q--;
        else if (k === 'ArrowDown' && q + GC < NT) q += GC; else if (k === 'ArrowUp' && q - GC >= 0) q -= GC; else return;
        ev.preventDefault(); state.cell = q; draw(); const ng = stage.querySelector('[role="grid"]'); if (ng) ng.focus();
      });
      // leyenda del calor
      const LY = IY + IH + 16;
      V.svg('rect', { x: IX, y: LY, width: 12, height: 10, fill: 'var(--op-fuse)', 'fill-opacity': 0.08, stroke: 'var(--rule-strong)', 'stroke-width': 0.8 }, svg);
      t(svg, IX + 16, LY + 9, 'baja', 'viz-s');
      V.svg('rect', { x: IX + 52, y: LY, width: 12, height: 10, fill: 'var(--op-fuse)', 'fill-opacity': 0.7, stroke: 'var(--rule-strong)', 'stroke-width': 0.8 }, svg);
      t(svg, IX + 68, LY + 9, 'alta', 'viz-s');
      V.svg('rect', { x: IX + 106, y: LY, width: 12, height: 10, class: 'viz-qs-sel' }, svg);
      t(svg, IX + 122, LY + 9, 'top-' + state.k + ' → query', 'viz-s');
      V.svg('rect', { x: IX + 226, y: LY, width: 14, height: 10, class: 'viz-qs-anchor' }, svg);
      t(svg, IX + 244, LY + 9, 'su caja → posición inicial', 'viz-s');

      // ---- derecha: fila de similitudes del token elegido y el ranking
      t(svg, RX, 16, '2 · Fila del token (' + (cr + 1) + ', ' + (cc + 1) + ')', 'viz-t');
      t(svg, RX, 31, 'sim con cada token de "' + P.text + '"', 'viz-s');
      const row = S[state.cell], vmax = Math.max(0.6, ...row.map(Math.abs));
      const zx = RX + 70, bw = 110;
      P.toks.forEach((tk, j) => {
        const y = IY + 4 + j * 22;
        const isMax = j === arg[state.cell];
        t(svg, RX + 62, y + 12, tk, SPECIAL[tk] ? 'viz-s' : 'viz-n', 'end');
        V.svg('rect', { x: zx, y: y + 3, width: 2 * bw, height: 13, rx: 2, class: 'viz-zs-track' }, svg);
        const v = row[j], w = bw * Math.abs(v) / vmax;
        V.svg('rect', { x: v >= 0 ? zx + bw : zx + bw - w, y: y + 3, width: Math.max(1, w), height: 13, rx: 2, class: isMax ? 'viz-qs-bar viz-qs-bar--max' : 'viz-qs-bar' }, svg);
        t(svg, zx + 2 * bw + 4, y + 13, (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + (isMax ? ' ← máx' : ''), isMax ? 'viz-n' : 'viz-s');
      });
      V.svg('path', { d: 'M' + (zx + bw) + ' ' + (IY + 2) + 'V' + (IY + 6 + P.toks.length * 22), class: 'viz-ln', 'stroke-dasharray': '2 2' }, svg);
      // ranking: los NT puntajes ordenados, con el corte en K
      const KY = IY + 30 + P.toks.length * 22, KH = 70, KW = RW - 90;
      t(svg, RX, KY - 6, '3 · Los ' + NT + ' puntajes, ordenados: corte en K = ' + state.k, 'viz-t');
      const bwk = KW / NT;
      order.forEach((i, rnk) => {
        const a = Math.min(1, Math.max(0, (score[i] - lo) / (hi - lo)));
        V.svg('rect', { x: RX + rnk * bwk, y: KY + KH - Math.max(1, a * KH), width: Math.max(0.6, bwk - 0.2), height: Math.max(1, a * KH), class: rnk < state.k ? 'viz-qs-rk viz-qs-rk--on' : 'viz-qs-rk' }, svg);
      });
      const kx = RX + state.k * bwk;
      V.svg('path', { d: 'M' + kx + ' ' + (KY - 2) + 'V' + (KY + KH + 4), class: 'viz-qs-cut' }, svg);
      t(svg, kx + 4, KY + 10, 'top-' + state.k, 'viz-n');
      t(svg, RX, KY + KH + 16, 'rango 1', 'viz-s');
      t(svg, RX + KW, KY + KH + 16, 'rango ' + NT, 'viz-s', 'end');

      // ---- lectura
      out.innerHTML = '';
      const kv = (a, b) => { const sp = V.html('span', null, out); sp.innerHTML = a + ' <b>' + b + '</b>'; };
      kv('token elegido:', '(' + (cr + 1) + ', ' + (cc + 1) + ') · máx ' + score[state.cell].toFixed(2).replace('-', '−') + ' con "' + P.toks[arg[state.cell]] + '"');
      kv('rango:', (order.indexOf(state.cell) + 1) + ' de ' + NT + (sel.has(state.cell) ? ' → es query' : ' → no entra'));
      kv('corte (puntaje del K-ésimo):', cut.toFixed(2).replace('-', '−'));
      const hits = {};
      for (const i of sel) { const w = P.toks[arg[i]]; hits[w] = (hits[w] || 0) + 1; }
      kv('las ' + state.k + ' queries por palabra:', Object.keys(hits).map((w) => w + ' ' + hits[w]).join(' · '));

      // ---- números reales
      realBox.innerHTML = '';
      const rk = (a, b) => { const sp = V.html('span', null, realBox); sp.innerHTML = a + ' <b>' + b + '</b>'; };
      rk('real (' + ((run && run.label) || cfgId) + '):', '');
      if (real.N) rk('tokens de imagen N =', fmt.int(real.N) + (real.levels ? ' (' + real.levels.map((x) => x[0] + '×' + x[1]).join(' + ') + ')' : ''));
      rk('tokens de texto T =', fmt.int(real.T));
      if (real.N) rk('matriz N×T =', fmt.int(real.N * real.T) + ' similitudes (' + fmt.si(real.N * real.T * real.D) + ' MACs)');
      rk('Q =', fmt.int(real.Q) + ' queries' + (real.N ? ' = ' + (100 * real.Q / real.N).toFixed(1) + ' % de los tokens' : ''));
    }
    function t(p, x, y, s, cls, anchor) { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; }

    draw();
    return { destroy() { wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('query-selection', render);
})(typeof window !== 'undefined' ? window : globalThis);
