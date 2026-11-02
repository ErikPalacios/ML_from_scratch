/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/shifted-windows.js
   Visualización "shifted-windows" (SPEC §7.8, §14.4): la partición en ventanas de Swin.
   - Regular (W-MSA): el mapa de una etapa se corta en ventanas M×M; la atención va solo dentro.
   - Desplazada (SW-MSA): las ventanas se corren ⌊M/2⌋; en vez de rellenar, el mapa se desplaza
     cíclicamente (torch.roll(x, (−s, −s))), quedan otra vez nW ventanas regulares y una máscara
     (−100 antes de la softmax, como timm) impide que se mezclen las 9 regiones del roll.
   Rejillas: la ilustrativa de la Fig. 2 del paper (8×8 tokens, M = 4) y las de cada etapa de la
   config (56×56, 28×28, 14×14, 7×7 con M = 7 en Swin-T). Los números (tokens, ventanas, M,
   puntuaciones por cabeza, la comparación con atención global) salen del calculador
   (ATLAS.Arch.run / metrics); la rejilla 8×8 se marca "ilustrativo".
   Toca (o enfoca y pulsa Enter) una ventana para ver su máscara. Las ventanas se nombran por posición
   (fila, columna) y las regiones del roll como r0…r8, para no confundir unas con otras.
   Con < 600 px de ancho los paneles se apilan en vertical (la máscara no queda fuera de la pantalla).
   No toca el DOM al cargar.
   params: { config:'swin-t-224', grid:'demo'|1|2|3|4 (etapa), mode:'regular'|'shifted' }
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // Etiqueta de región (0–8) en el marco DESPLAZADO, como el img_mask de timm:
  // tramos de filas/columnas [0, H−M) · [H−M, H−s) · [H−s, H).
  function band(i, H, M, s) { return i < H - M ? 0 : i < H - s ? 1 : 2; }
  function regionRolled(r, c, H, M, s) { return 3 * band(r, H, M, s) + band(c, H, M, s); }
  // Tramos de cada banda en los dos marcos (para dibujar las 9 regiones como rectángulos).
  function bandsRolled(H, M, s) { return [[0, H - M], [H - M, H - s], [H - s, H]]; }
  function bandsOrig(H, M, s) { return [[s, H - M + s], [H - M + s, H], [0, s]]; }   // banda k del marco original

  function stageInfo(run, k) {
    const c = run.config;
    const st = c.stages && c.stages[k - 1];
    if (st) {
      const t0 = run.tensors['s' + k + '-b1-scores'] || null;
      return { k, res: st.side, M: st.M, M0: c.M, shift: st.shift, heads: st.h, scoresT: t0 };
    }
    const P = c.P || 4, H0 = c.H || 224;
    const res = H0 / P / Math.pow(2, k - 1);
    const M0 = c.M || c.window || 7;
    const M = Math.min(M0, res);
    const shift = res <= M0 ? 0 : Math.floor(M0 / 2);
    const heads = Array.isArray(c.heads) ? c.heads[k - 1] : null;
    const t = run.tensors['s' + k + '-b1-scores'] || run.tensors['s' + k + '-b2-scores'] || null;
    return { k, res, M, M0, shift, heads, scoresT: t };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, fmt = A.fmt;
    const cfgId = params.config || 'swin-t-224';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    let met = null;
    try { met = run ? A.metrics(cfgId) : null; } catch (e) { met = null; }
    const stages = run ? [1, 2, 3, 4].map((k) => stageInfo(run, k)) : [];
    const state = {
      grid: params.grid != null ? params.grid : 'demo',
      mode: params.mode === 'regular' ? 'regular' : 'shifted',
      win: null,
    };

    const wrap = V.html('div', { class: 'viz viz-swin' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const tag = V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Atención' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Bloque' }, g1);
    const bMode = [['regular', 'W-MSA (regular)'], ['shifted', 'SW-MSA (desplazada)']].map(([m, label]) => {
      const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label }, g1);
      b.addEventListener('click', () => { state.mode = m; state.win = null; draw(); });
      b._m = m; return b;
    });
    const g2 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Rejilla' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Rejilla' }, g2);
    const grids = [{ id: 'demo', label: '8×8 · M = 4 (paper)' }].concat(stages.map((s) => ({ id: s.k, label: 'Etapa ' + s.k + ' · ' + s.res + '×' + s.res })));
    const bGrid = grids.map((gd) => {
      const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: gd.label }, g2);
      b.addEventListener('click', () => { state.grid = gd.id; state.win = null; draw(); });
      b._g = gd.id; return b;
    });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    function current() {
      if (state.grid === 'demo' || !stages.length) return { demo: true, res: 8, M: 4, M0: 4, shift: 2, heads: null, k: null };
      return Object.assign({ demo: false }, stages.find((s) => s.k === state.grid) || stages[0]);
    }

    const winName = (wi, wj) => '(fila ' + (wi + 1) + ', col ' + (wj + 1) + ')';
    let lastNarrow = null;
    function draw() {
      bMode.forEach((b) => b.setAttribute('aria-pressed', String(b._m === state.mode)));
      bGrid.forEach((b) => b.setAttribute('aria-pressed', String(b._g === state.grid)));
      const g = current();
      tag.hidden = !g.demo;
      const H = g.res, M = g.M, n = H / M, s = state.mode === 'shifted' ? g.shift : 0;
      const shifted = state.mode === 'shifted' && s > 0;
      const noShift = state.mode === 'shifted' && s === 0;   // SW-MSA en un mapa de una sola ventana (stage 4)
      if (state.win == null || state.win >= n * n) state.win = shifted ? n * n - 1 : 0;   // por defecto: la ventana de la esquina (4 regiones)
      stage.innerHTML = '';
      const narrow = (stage.clientWidth || wrap.clientWidth || 800) < 600;
      lastNarrow = narrow;
      const S = 228;                                   // lado de cada panel (px)
      const cs = S / H;                                // lado de un token
      const PAD = 8, TT = 50, GAP = 96, GAPV = 104;     // TT = alto de los títulos de panel
      const MS = Math.min(S, Math.max(176, M * M * 4)); // lado de la máscara
      const KEYH = 64;                                 // pie de la máscara: conteo + leyenda de colores
      // posiciones (x, y = esquina superior izquierda del panel)
      const pA = { x: PAD, y: TT };
      const pB = shifted ? (narrow ? { x: PAD, y: pA.y + S + GAPV } : { x: pA.x + S + GAP, y: TT }) : null;
      const prev = pB || pA;
      const pC = narrow ? { x: PAD, y: prev.y + S + GAPV } : { x: prev.x + S + GAP, y: TT };
      const W = narrow ? PAD + Math.max(S, MS, 262) + PAD : pC.x + Math.max(MS, 262) + PAD;
      const Hh = narrow ? pC.y + MS + KEYH : TT + Math.max(S, MS + KEYH) + 8;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px' + (narrow ? '' : ';min-width:' + Math.min(W, 600) + 'px'), role: 'group',
        'aria-label': (shifted ? 'Ventanas desplazadas' : 'Ventanas regulares') + ' sobre un mapa de ' + H + '×' + H + ' tokens con M = ' + M }, stage);
      const title = (p, a, b) => { txt(svg, p.x, p.y - 34, a, 'viz-t'); txt(svg, p.x, p.y - 17, b, 'viz-s'); };
      const link = (p, q, label, label2) => (narrow ? arrowV(svg, p.x + S / 2, p.y + S + 6, q.y - 50, label, label2) : arrow(svg, p.x + S + 8, p.y + S / 2, q.x - 8, label, label2));

      // ---------- panel A: partición sobre el mapa original
      const ax = pA.x, ay = pA.y;
      const nw = n * n + (n * n === 1 ? ' ventana' : ' ventanas');
      if (shifted) title(pA, '1 · Ventanas corridas ⌊M/2⌋ = ' + s, 'sin roll: ' + (n + 1) + '×' + (n + 1) + ' ventanas desiguales');
      else if (noShift) title(pA, '1 · SW-MSA sin desplazamiento: una sola ventana', 'el mapa (' + H + '×' + H + ') cabe en una ventana: shift 0');
      else title(pA, '1 · Ventanas regulares M×M', n + '×' + n + ' = ' + nw + ' de ' + M + '×' + M + ' tokens');
      if (shifted) drawRegions(svg, ax, ay, cs, H, M, s, false);
      else V.svg('rect', { x: ax, y: ay, width: S, height: S, class: 'viz-sw-r0' }, svg);
      tokenGrid(svg, ax, ay, cs, H);
      // fronteras de ventana: regulares en k·M; desplazadas en s + k·M
      let d = '';
      const cuts = shifted ? [s].concat(range(n - 1).map((i) => s + (i + 1) * M)) : range(n - 1).map((i) => (i + 1) * M);
      for (const c of cuts) d += 'M' + (ax + c * cs) + ' ' + ay + 'V' + (ay + S) + 'M' + ax + ' ' + (ay + c * cs) + 'H' + (ax + S);
      if (d) V.svg('path', { d, class: 'viz-sw-win' }, svg);
      V.svg('rect', { x: ax, y: ay, width: S, height: S, class: 'viz-sw-frame' }, svg);
      if (!shifted) windowButtons(svg, ax, ay, cs, n, M, false);

      // ---------- panel B: tras el roll (solo SW-MSA)
      if (shifted) {
        const bx = pB.x, by = pB.y;
        link(pA, pB, 'roll', '(−' + s + ', −' + s + ')');
        title(pB, '2 · Desplazamiento cíclico', 'otra vez ' + n + '×' + n + ' ventanas regulares');
        drawRegions(svg, bx, by, cs, H, M, s, true);
        tokenGrid(svg, bx, by, cs, H);
        let d2 = '';
        for (let i = 1; i < n; i++) d2 += 'M' + (bx + i * M * cs) + ' ' + by + 'V' + (by + S) + 'M' + bx + ' ' + (by + i * M * cs) + 'H' + (bx + S);
        V.svg('path', { d: d2, class: 'viz-sw-win' }, svg);
        V.svg('rect', { x: bx, y: by, width: S, height: S, class: 'viz-sw-frame' }, svg);
        windowButtons(svg, bx, by, cs, n, M, true);
        link(pB, pC, 'máscara');
      } else link(pA, pC, 'atención', 'por ventana');

      // ---------- panel C: máscara de la ventana elegida (M² × M²)
      const wi = Math.floor(state.win / n), wj = state.win % n;
      const toks = [];
      for (let a = 0; a < M; a++) for (let b = 0; b < M; b++) toks.push(shifted ? regionRolled(wi * M + a, wj * M + b, H, M, s) : 0);
      const L = M * M, mc = MS / L;
      const mx = pC.x, cy = pC.y;
      title(pC, (shifted ? '3' : '2') + ' · Máscara de la ventana ' + (n * n === 1 ? '(la única)' : winName(wi, wj)), 'M²×M² = ' + L + '×' + L + ' (fila = query, col = key)');
      let allowed = 0;
      let dOn = '', dOff = '';
      for (let p = 0; p < L; p++) for (let q = 0; q < L; q++) {
        const ok = toks[p] === toks[q];
        if (ok) allowed++;
        const r = 'M' + r1(mx + q * mc) + ' ' + r1(cy + p * mc) + 'h' + r1(mc) + 'v' + r1(mc) + 'h' + r1(-mc) + 'z';
        if (ok) dOn += r; else dOff += r;
      }
      V.svg('path', { d: dOn, class: 'viz-mask-on' }, svg);
      if (dOff) V.svg('path', { d: dOff, class: 'viz-mask-off' }, svg);
      V.svg('rect', { x: mx, y: cy, width: MS, height: MS, class: 'viz-sw-frame' }, svg);
      const regs = Array.from(new Set(toks)).sort();
      txt(svg, mx, cy + MS + 18, allowed === L * L ? 'todo permitido: ' + fmt.int(L * L) + ' pares' : 'permitidos ' + fmt.int(allowed) + ' de ' + fmt.int(L * L), 'viz-n');
      txt(svg, mx, cy + MS + 34, allowed === L * L ? (shifted ? 'una sola región' : 'sin máscara') : 'regiones ' + regs.map((r) => 'r' + r).join(', ') + ' en esta ventana', 'viz-s');
      // leyenda de colores de la máscara (no solo en el texto)
      const ky = cy + MS + 44;
      V.svg('rect', { x: mx, y: ky, width: 11, height: 11, class: 'viz-mask-on' }, svg);
      txt(svg, mx + 16, ky + 9.5, shifted ? 'misma región: +0' : 'permitido: +0', 'viz-s');
      if (shifted) {
        V.svg('rect', { x: mx + 136, y: ky, width: 11, height: 11, class: 'viz-mask-off' }, svg);
        txt(svg, mx + 152, ky + 9.5, 'distinta: −100', 'viz-s');
      }

      readout(g, n, s, shifted, allowed, L, wi, wj);
    }
    // el ancho del contenedor decide la disposición (horizontal / vertical): se redibuja al cruzar 600 px
    let ro = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 800) < 600; if (lastNarrow !== null && nar !== lastNarrow) draw(); });
      ro.observe(stage);
    }

    function readout(g, n, s, shifted, allowed, L, wi, wj) {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const T = g.res * g.res;
      kv(g.demo ? 'rejilla (ilustrativa)' : 'etapa ' + g.k + ':', g.res + '×' + g.res + ' = ' + fmt.int(T) + ' tokens');
      kv('M =', String(g.M) + (g.M < g.M0 ? ' (recortada al mapa)' : ''));
      kv('ventanas nW =', '(' + g.res + '/' + g.M + ')² = ' + fmt.int(n * n));
      kv('desplazamiento', g.shift ? '⌊' + g.M0 + '/2⌋ = ' + g.shift : '0 (una sola ventana: timm no desplaza)');
      // puntuaciones por cabeza y capa: nW·M⁴ (ventanas) frente a T² (global)
      const win = n * n * L * L, glob = T * T;
      const t = g.scoresT;
      if (t && t.num && !g.demo) kv('QKᵀ (calculador):', fmt.shape(t, 'sym') + ' = ' + fmt.shape(t, 'num'));
      kv('puntuaciones por cabeza:', fmt.int(win) + ' (ventanas) vs ' + fmt.int(glob) + ' (global)' + (glob > win ? ' → ' + (glob / win).toFixed(glob / win >= 10 ? 0 : 1) + '× menos' : ': iguales (una sola ventana = atención global)'));
      const ps = met && met.stages && !g.demo ? met.stages[g.k - 1] : null;
      if (ps && ps.scoreMacs != null && ps.globalScoreMacs != null) kv('MACs de QKᵀ + A·V por bloque (calculador):', fmt.si(ps.scoreMacs) + ' vs ' + fmt.si(ps.globalScoreMacs) + ' con atención global');
      if (shifted) kv('ventana ' + winName(wi, wj) + ':', fmt.int(allowed) + ' de ' + fmt.int(L * L) + ' pares permitidos');
      const how = shifted
        ? ' Colores y etiquetas r0…r8 = las 9 regiones del roll (como el img_mask de timm): solo se atienden entre sí los tokens de la misma región; el resto recibe −100 antes de la softmax. Las ventanas que mezclan regiones son las del borde derecho e inferior tras el roll.'
        : ' Cada token atiende solo a los M² tokens de su ventana: el costo de QKᵀ crece lineal con el número de tokens (M fijo), no cuadrático.';
      note.textContent = (g.demo
        ? 'Rejilla ilustrativa de 8×8 tokens con M = 4, como la Fig. 2 del paper: con el desplazamiento quedan 3×3 = 9 ventanas desiguales; el roll las vuelve 2×2.'
        : 'Rejilla real de la etapa ' + g.k + ' de ' + (run ? run.label : cfgId) + ' (números del calculador).') + how + ' Toca una ventana para ver su máscara.';
    }

    // ---------- dibujo
    function drawRegions(svg, x0, y0, cs, H, M, s, rolled) {
      const bands = rolled ? bandsRolled(H, M, s) : bandsOrig(H, M, s);
      for (let bi = 0; bi < 3; bi++) for (let bj = 0; bj < 3; bj++) {
        const [r0, r1_] = bands[bi], [c0, c1] = bands[bj];
        if (r1_ <= r0 || c1 <= c0) continue;
        const reg = 3 * bi + bj;
        const x = x0 + c0 * cs, y = y0 + r0 * cs, w = (c1 - c0) * cs, h = (r1_ - r0) * cs;
        V.svg('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(h), class: 'viz-sw-r viz-sw-r' + reg }, svg);
        if (w >= 16 && h >= 13) txt(svg, x + w / 2, y + h / 2 + 4, 'r' + reg, 'viz-sw-rl', 'middle');
      }
    }
    function tokenGrid(svg, x0, y0, cs, H) {
      if (cs < 3) return;   // con tokens de < 3 px la rejilla sería ruido
      let d = '';
      for (let i = 1; i < H; i++) d += 'M' + r1(x0 + i * cs) + ' ' + y0 + 'V' + r1(y0 + H * cs) + 'M' + x0 + ' ' + r1(y0 + i * cs) + 'H' + r1(x0 + H * cs);
      V.svg('path', { d, class: 'viz-sw-tok' }, svg);
    }
    function windowButtons(svg, x0, y0, cs, n, M, rolled) {
      const ws = M * cs;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const k = i * n + j;
        const gEl = V.svg('g', { class: 'viz-cell-btn viz-sw-wbtn' + (k === state.win ? ' is-hl' : ''), tabindex: 0, role: 'button',
          'aria-pressed': String(k === state.win), 'aria-label': 'Ventana de la fila ' + (i + 1) + ', columna ' + (j + 1) + (rolled ? ', tras el roll' : '') }, svg);
        V.svg('rect', { x: r1(x0 + j * ws), y: r1(y0 + i * ws), width: r1(ws), height: r1(ws), fill: 'transparent' }, gEl);
        V.svg('rect', { x: r1(x0 + j * ws + 1), y: r1(y0 + i * ws + 1), width: r1(ws - 2), height: r1(ws - 2), class: 'viz-sw-sel' }, gEl);
        const pick = () => { if (state.win !== k) { state.win = k; draw(); refocus(k); } };
        gEl.addEventListener('click', pick);
        gEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      }
    }
    function refocus(k) { const b = stage.querySelectorAll('.viz-sw-wbtn')[k]; if (b && b.focus) try { b.focus({ preventScroll: true }); } catch (e) { /* sin foco */ } }
    function arrow(svg, x0, y, x1, label, label2) {
      V.svg('path', { d: 'M' + x0 + ' ' + y + 'H' + (x1 - 6), class: 'viz-ln' }, svg);
      V.svg('path', { d: 'M' + x1 + ' ' + y + 'l-7 -4v8z', class: 'viz-head' }, svg);
      txt(svg, (x0 + x1) / 2, y - 8, label, 'viz-s', 'middle');
      if (label2) txt(svg, (x0 + x1) / 2, y + 17, label2, 'viz-s', 'middle');
    }
    function arrowV(svg, x, y0, y1, label, label2) {
      V.svg('path', { d: 'M' + x + ' ' + y0 + 'V' + (y1 - 6), class: 'viz-ln' }, svg);
      V.svg('path', { d: 'M' + x + ' ' + y1 + 'l-4 -7h8z', class: 'viz-head' }, svg);
      txt(svg, x + 10, (y0 + y1) / 2 - 3, label, 'viz-s');
      if (label2) txt(svg, x + 10, (y0 + y1) / 2 + 11, label2, 'viz-s');
    }
    function txt(p, x, y, s, cls, anchor) { const t = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); t.textContent = s; return t; }
    function range(k) { return Array.from({ length: Math.max(0, k) }, (_, i) => i); }
    function r1(v) { return Math.round(v * 10) / 10; }

    draw();
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('shifted-windows', render);
})(typeof window !== 'undefined' ? window : globalThis);
