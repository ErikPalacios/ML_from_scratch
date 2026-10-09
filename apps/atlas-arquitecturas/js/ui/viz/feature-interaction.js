/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/feature-interaction.js
   Visualización "feature-interaction" (SPEC §7.8, §25.4): cómo un ranker cruza features explícitamente.
   Demo ILUSTRATIVA con m = 6 vectores de d = 4 (la salida del bottom MLP + 5 campos categóricos ya convertidos en embeddings):
     - DLRM (Naumov et al. 2019, arXiv:1906.00091; dlrm_s_pytorch.py, interaction_op = "dot"): se apilan los m vectores en
       T (m × d), se calcula Z = T·Tᵀ (m × m) y se toma el triángulo inferior ESTRICTO (sin la diagonal: arch_interaction_itself
       = False por omisión): m(m − 1)/2 productos punto, uno por par de campos y sin pesos; la entrada del top MLP es
       [salida densa (d), esos productos].
     - DCN v2 (Wang et al., WWW 2021, arXiv:2008.13535): una capa cruzada x_{l+1} = x_0 ⊙ (W_l x_l + b_l) + x_l sobre el
       vector concatenado x_0 (m·d): la coordenada i recibe Σ_j W_ij · x0_i · x0_j, un peso aprendido por PAR de coordenadas
       (bloques de d × d por par de campos), con (m·d)² + m·d parámetros por capa.
   Pasa el cursor (o enfoca) una celda para ver su cuenta. Números reales de la config (no ilustrativos): m = 1 + 26, dim, los
   m(m − 1)/2 productos y la entrada del top MLP (dlrm-criteo-kaggle) y los parámetros de las capas cruzadas (dlrm-dcnv2), de
   ATLAS.Arch.run / metrics.
   params: { config:'dlrm-criteo-kaggle', mode:'dlrm'|'dcn', dcnConfig:'dlrm-dcnv2' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  // subíndices del texto plano de las formas (n_s, n_pairs) como <sub> en el readout html
  const sub = (x) => String(x).replace(/_(\{[^}]*\}|[A-Za-z0-9]+)/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const FIELDS = ['denso', 'usuario', 'anuncio', 'anunciante', 'hora', 'dispositivo'];
  const M = FIELDS.length, D = 4;

  function vectors() {
    const R = ATLAS.Viz.rng(1906);
    return FIELDS.map(() => Array.from({ length: D }, () => Math.round(R.normal() * 10) / 10));
  }
  function weights() {
    const R = ATLAS.Viz.rng(2008);
    const n = M * D;
    return Array.from({ length: n }, () => Array.from({ length: n }, () => R.normal() * 0.5));
  }
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const fint = fmt.int || ((n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const cfgId = params.config || 'dlrm-criteo-kaggle', dcnId = params.dcnConfig || 'dlrm-dcnv2';
    const state = { mode: params.mode === 'dcn' ? 'dcn' : 'dlrm', cell: null };
    const T = vectors(), Wc = weights();
    const Z = T.map((a) => T.map((b) => dot(a, b)));
    const x0 = T.flat();

    const wrap = V.html('div', { class: 'viz viz-fi' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Interacción' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Interacción' }, g);
    const chips = [['dlrm', 'DLRM: producto punto por par de campos'], ['dcn', 'DCN v2: capa cruzada']].map(([v, t]) => {
      const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g);
      b.addEventListener('click', () => { state.mode = v; state.cell = null; draw(); });
      b._v = v; return b;
    });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      chips.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.mode)));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      if (state.mode === 'dlrm') drawDlrm(cw, narrow, t); else drawDcn(cw, narrow, t);
      readout();
      realNumbers();
    }

    // ---- DLRM: T (m × d) → Z = T·Tᵀ → triángulo inferior estricto
    function drawDlrm(cw, narrow, t) {
      const cs = narrow ? 34 : 42, tc = narrow ? 30 : 34;
      const lab = narrow ? 86 : 88;
      const Tw = lab + D * tc, Zx = narrow ? lab : Tw + 70;
      const W = narrow ? Math.max(300, lab + M * cs + 12) : Zx + M * cs + 210;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'group', 'aria-label': 'DLRM: ' + M + ' vectores de ' + D + ', matriz de productos punto ' + M + '×' + M + ' y su triángulo inferior estricto' }, stage);
      t(svg, 8, 15, narrow ? 'DLRM: Z = T·Tᵀ, triángulo inferior' : 'DLRM: apilar los m vectores en T, Z = T·Tᵀ y quedarse con el triángulo inferior estricto', 'viz-t');
      t(svg, 8, 29, 'm = ' + M + ' vectores de d = ' + D + ' → ' + (M * (M - 1) / 2) + ' productos punto (uno por par de campos, sin pesos)', 'viz-s');
      const top = 64;
      // T
      t(svg, lab, top - 10, 'T (m × d)', 'viz-n');
      T.forEach((v, i) => {
        t(svg, lab - 6, top + i * tc + tc / 2 + 4, FIELDS[i], 'viz-s', 'end');
        v.forEach((x, k) => {
          V.svg('rect', { x: r1(lab + k * tc + 1), y: r1(top + i * tc + 1), width: tc - 2, height: tc - 2, rx: 2, class: 'viz-fi-t' + (i === 0 ? ' is-dense' : '') }, svg);
          t(svg, lab + k * tc + tc / 2, top + i * tc + tc / 2 + 4, x.toFixed(1), 'viz-fi-v', 'middle');
        });
      });
      // Z
      const zt = narrow ? top + M * tc + 44 : top;
      t(svg, Zx, zt - 10, 'Z = T·Tᵀ (m × m)', 'viz-n');
      const zs = Z.flat(), zmax = Math.max(...zs.map(Math.abs)) || 1;
      for (let i = 0; i < M; i++) {
        if (narrow) t(svg, Zx - 6, zt + i * cs + cs / 2 + 4, FIELDS[i], 'viz-s', 'end');
        for (let j = 0; j < M; j++) {
          const used = j < i, x = Zx + j * cs, y = zt + i * cs, v = Z[i][j];
          const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: used ? 0 : -1, role: 'img', 'aria-label': FIELDS[i] + ' · ' + FIELDS[j] + ': ' + v.toFixed(2) + (used ? ' (va al top MLP)' : i === j ? ' (diagonal: no se usa)' : ' (triángulo superior: repetido, no se usa)') }, svg);
          V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: 'viz-fi-z' + (used ? '' : ' is-off'), style: used ? 'fill:color-mix(in srgb, var(--op-fuse) ' + Math.round(10 + 60 * Math.abs(v) / zmax) + '%, var(--surface))' : null }, gEl);
          t(gEl, x + cs / 2, y + cs / 2 + 4, v.toFixed(1), 'viz-fi-v' + (used ? '' : ' is-off'), 'middle');
          V.svg('rect', { x: x + 1, y: y + 1, width: cs - 2, height: cs - 2, rx: 2, class: 'viz-sim-hit' }, gEl);
          if (used) { const show = () => { state.cell = { i, j }; readout(); }; gEl.addEventListener('pointerenter', show); gEl.addEventListener('focus', show); }
        }
      }
      if (!narrow) FIELDS.forEach((f, j) => { const tt = V.svg('text', { class: 'viz-s', transform: 'translate(' + r1(Zx + j * cs + cs / 2 + 3) + ',' + r1(zt + M * cs + 10) + ') rotate(40)' }, svg); tt.textContent = f; });
      // salida: [denso (d), Z inferior] → top MLP
      const oy = zt + M * cs + (narrow ? 26 : 70);
      const n = M * (M - 1) / 2, ow = Math.min(W - 16, (D + n) * (narrow ? 14 : 18));
      const ux = (W - ow) / 2, uw = ow / (D + n);
      t(svg, 8, oy - 8, narrow ? 'al top MLP: ' + D + ' + ' + n + ' = ' + (D + n) : 'entrada del top MLP: [denso (' + D + '), ' + n + ' productos] = ' + (D + n), 'viz-n');
      for (let k = 0; k < D + n; k++) V.svg('rect', { x: r1(ux + k * uw + 0.5), y: r1(oy), width: r1(uw - 1), height: 14, class: k < D ? 'viz-fi-t is-dense' : 'viz-fi-out' }, svg);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(oy + 24));
      note.textContent = 'Valores ilustrativos (m = ' + M + ', d = ' + D + '). El triángulo inferior estricto alcanza: Z es simétrica (zᵢⱼ = zⱼᵢ) y la diagonal es la norma al cuadrado de cada vector, que DLRM no usa por omisión. Cada número cruza DOS campos enteros (un producto punto, sin pesos propios): cuánto "combinan" este usuario y este anuncio en el espacio de embeddings. Con Criteo, m = 1 + 26 = 27 vectores.';
    }

    // ---- DCN v2: x_1 = x_0 ⊙ (W x_0 + b) + x_0 sobre el vector concatenado (m·d)
    function drawDcn(cw, narrow, t) {
      const n = M * D;
      const cs = narrow ? Math.max(9, Math.floor((Math.min(cw, 520) - 70) / n)) : 13;
      const x0x = narrow ? 44 : 96, Wx = x0x + cs + 22;
      const W = narrow ? Math.max(300, Wx + n * cs + 12) : Wx + n * cs + 300;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'group', 'aria-label': 'DCN v2: matriz W de ' + n + '×' + n + ' de la capa cruzada, en bloques de ' + D + '×' + D + ' por par de campos' }, stage);
      t(svg, 8, 15, narrow ? 'DCN v2: x₁ = x₀ ⊙ (W x₀ + b) + x₀' : 'DCN v2, una capa cruzada: x_{l+1} = x_0 ⊙ (W_l x_l + b_l) + x_l', 'viz-t');
      t(svg, 8, 29, narrow ? 'x_0: ' + M + ' × ' + D + ' = ' + n + ' números · W: ' + n + '×' + n : 'x_0 = ' + M + ' campos × ' + D + ' = ' + n + ' números · W: ' + n + '×' + n + ' (un peso por par de coordenadas)', 'viz-s');
      const top = 62;
      const sel = state.cell ? state.cell.i : 9;
      // x_0 como columna
      t(svg, x0x + cs / 2, top - 6, 'x₀', 'viz-n', 'middle');
      x0.forEach((v, i) => V.svg('rect', { x: r1(x0x), y: r1(top + i * cs + 0.5), width: cs, height: r1(cs - 1), class: 'viz-fi-x0' + (Math.floor(i / D) === 0 ? ' is-dense' : '') + (i === sel ? ' is-sel' : ''), style: 'fill-opacity:' + (0.25 + 0.6 * Math.min(1, Math.abs(v) / 2)).toFixed(2) }, svg));
      for (let f = 0; f < M; f++) t(svg, x0x - 4, top + (f + 0.5) * D * cs + 4, narrow ? FIELDS[f].slice(0, 4) : FIELDS[f], 'viz-s', 'end');
      // W en bloques
      const wmax = Math.max(...Wc.flat().map(Math.abs));
      for (let i = 0; i < n; i++) {
        const gr = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': 'Fila ' + (i + 1) + ' de W (coordenada ' + ((i % D) + 1) + ' de ' + FIELDS[Math.floor(i / D)] + '): ' + n + ' pesos, uno por coordenada de x₀' }, svg);
        for (let j = 0; j < n; j++) V.svg('rect', { x: r1(Wx + j * cs), y: r1(top + i * cs), width: cs, height: cs, class: 'viz-fi-w ' + (Wc[i][j] >= 0 ? 'is-pos' : 'is-neg'), 'fill-opacity': (0.15 + 0.75 * Math.abs(Wc[i][j]) / wmax).toFixed(2) }, gr);
        V.svg('rect', { x: r1(Wx), y: r1(top + i * cs), width: n * cs, height: cs, class: i === sel ? 'viz-fi-row is-sel' : 'viz-fi-row' }, gr);
        const show = () => { state.cell = { i }; drawSel(); readout(); };
        gr.addEventListener('pointerenter', show); gr.addEventListener('focus', show);
      }
      let dgrid = '';
      for (let f = 0; f <= M; f++) { const p = f * D * cs; dgrid += 'M' + r1(Wx + p) + ' ' + top + 'V' + r1(top + n * cs) + 'M' + Wx + ' ' + r1(top + p) + 'H' + r1(Wx + n * cs); }
      V.svg('path', { d: dgrid, class: 'viz-fi-blk' }, svg);
      t(svg, Wx, top - 6, narrow ? 'W: bloques de ' + D + '×' + D + ' por par de campos' : 'W (bloque a, b = ' + D + '×' + D + ' pesos entre el campo a y el campo b)', 'viz-n');
      const selG = V.svg('g', null, svg);
      function drawSel() {
        selG.innerHTML = '';
        const i = state.cell ? state.cell.i : sel;
        V.svg('rect', { x: r1(Wx - 1), y: r1(top + i * cs - 1), width: n * cs + 2, height: cs + 2, class: 'viz-fi-rowsel' }, selG);
      }
      drawSel();
      let yEnd = top + n * cs + 16;
      if (!narrow) {
        const tx = Wx + n * cs + 18;
        ['coordenada i de la salida:', 'x₁ᵢ = x₀ᵢ · (Σⱼ Wᵢⱼ x₀ⱼ + bᵢ) + x₀ᵢ', '= Σⱼ Wᵢⱼ · x₀ᵢ x₀ⱼ + …', '→ cada par (i, j) de coordenadas', '   tiene su propio peso Wᵢⱼ', '', 'parámetros por capa:', '(m·d)² + m·d = ' + fint(n * n + n), '', 'DLRM, mismo m, d:', M * (M - 1) / 2 + ' productos, 0 pesos'].forEach((s, k) => t(svg, tx, top + 10 + k * 16, s, k === 0 || k === 6 || k === 9 ? 'viz-n' : 'viz-s'));
      } else {
        ['x₁ᵢ = x₀ᵢ·(Σⱼ Wᵢⱼ x₀ⱼ + bᵢ) + x₀ᵢ', 'un peso Wᵢⱼ por par (i, j) de coordenadas', 'parámetros por capa: (m·d)² + m·d = ' + fint(n * n + n)].forEach((s, k) => t(svg, 8, yEnd + k * 15, s, 'viz-s'));
        yEnd += 45;
      }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(yEnd));
      note.textContent = 'Valores ilustrativos (m = ' + M + ' campos de d = ' + D + '). La capa cruzada multiplica x₀ coordenada a coordenada por una transformación lineal de xₗ: en la primera capa, la coordenada i suma Wᵢⱼ·x₀ᵢ·x₀ⱼ sobre todas las j, así que cada par de coordenadas (también dentro del mismo campo) tiene su peso. Apilar L capas da cruces de grado L + 1. Es más expresiva que el producto punto de DLRM pero cuesta (m·d)² parámetros por capa; DCN-Mix los baja con matrices de rango bajo (U·Vᵀ).';
    }

    function readout() {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const c = state.cell;
      if (state.mode === 'dlrm') {
        kv('pares usados:', M * (M - 1) / 2 + ' de ' + M * M);
        if (c) kv(FIELDS[c.i] + ' · ' + FIELDS[c.j] + ' =', T[c.i].map((x, k) => '(' + x.toFixed(1) + ')(' + T[c.j][k].toFixed(1) + ')').join(' + ') + ' = ' + Z[c.i][c.j].toFixed(2));
        else kv('pasa el cursor por', 'una celda del triángulo inferior');
      } else {
        const n = M * D, i = c ? c.i : 9;
        const s = Wc[i].reduce((a, w, j) => a + w * x0[j], 0);
        kv('fila i =', (i + 1) + ' (coordenada ' + ((i % D) + 1) + ' de ' + FIELDS[Math.floor(i / D)] + ')');
        kv('(W x₀)ᵢ =', s.toFixed(2) + ' (b = 0 en la demo)');
        kv('x₁ᵢ = x₀ᵢ·(W x₀)ᵢ + x₀ᵢ =', x0[i].toFixed(1) + '·' + s.toFixed(2) + ' + ' + x0[i].toFixed(1) + ' = ' + (x0[i] * s + x0[i]).toFixed(2));
        kv('pesos de la capa:', fint(n * n) + ' + ' + n + ' sesgos');
      }
    }

    // Números reales del calculador (no ilustrativos)
    function realNumbers() {
      real.innerHTML = '';
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = k + ' <b>' + sub(v) + '</b>'; };
      const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(o[k])) return o[k]; return null; };
      const shp = (r, ids) => { for (const id of ids) { const tt = r && r.tensors && r.tensors[id]; if (tt && fmt.shape) return fmt.shape(tt, 'sym') + ' = ' + fmt.shape(tt, 'num'); } return null; };
      const id = state.mode === 'dcn' ? dcnId : cfgId;
      let run = null, met = null;
      try { run = A.run(id); } catch (e) { run = null; }
      try { met = A.metrics(id); } catch (e) { met = null; }
      if (!run) return;
      const c = run.config || {};
      kv('config:', run.label || id);
      const dim = pick(c, ['dim', 'D']), nCat = pick(c, ['nSparse']);
      if (dim != null) kv('dim:', String(dim));
      if (state.mode === 'dlrm') {
        const mm = nCat != null ? nCat + 1 : null;
        if (mm != null) kv('m = 1 + ' + nCat + ' =', String(mm));
        const zt = shp(run, ['gram']); if (zt) kv('Z:', zt);
        const zf = shp(run, ['pairs']); if (zf) kv('productos:', zf); else if (mm != null) kv('productos m(m − 1)/2:', fint(mm * (mm - 1) / 2));
        const ti = shp(run, ['top-in']); if (ti) kv('entrada del top MLP:', ti);
        const im = pick(met, ['interactionMacs']); if (im != null) kv('MACs de la interacción:', fmt.ops ? fmt.ops(im) : fint(im));
      } else {
        const cp = pick(met, ['interactionParams']); if (cp != null) kv('parámetros de las capas cruzadas:', fint(cp));
        const L = pick(c, ['crossLayers']); if (L != null) kv('capas cruzadas:', String(L));
        const rk = pick(c, ['rank']); if (rk != null) kv('rango de W (W = U·Vᵀ, rango bajo):', String(rk));
        const x0t = shp(run, ['x0']); if (x0t) kv('x₀:', x0t);
      }
    }

    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('feature-interaction', render);
})(typeof window !== 'undefined' ? window : globalThis);
