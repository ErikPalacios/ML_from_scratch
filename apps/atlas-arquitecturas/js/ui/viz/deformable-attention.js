/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/deformable-attention.js
   Visualización "deformable-attention" (SPEC §7.8, §15.3): la atención deformable multiescala
   de Deformable DETR. Una query con su punto de referencia p̂ (normalizado, el mismo en los L niveles)
   mira solo K puntos por cabeza y por nivel: p̂ + Δp_{mlk}/(W_l, H_l), con offsets Δp y pesos A_{mlk}
   que salen de la propia query (dos Linear), A normalizado con una softmax sobre los L·K puntos de
   cada cabeza; los valores se leen con interpolación bilineal y se suman ponderados. Costo lineal en
   tokens: h·L·K muestras por query en vez de las N keys de la atención densa.
   Dos estados: "inicialización" (la del código oficial: cabeza m apunta en la dirección 2πm/M, el
   punto k a distancia k+1 en píxeles de su nivel, pesos uniformes) y "aprendido" (offsets y pesos
   sintéticos con semilla, "ilustrativo"). Toca un mapa (o usa las flechas) para mover p̂.
   Niveles, M, K y d salen del calculador (config deformable-detr-r50) con respaldo en la resolución.
   params: { config:'deformable-detr-r50', head:0..M-1|'all', mode:'init'|'learned', ref:[x, y] }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // un color por cabeza (tokens del tema: cambian con el tema sin redibujar)
  const HEAD_COLORS = ['var(--op-attn)', 'var(--op-embed)', 'var(--op-mlp)', 'var(--op-conv)', 'var(--op-fuse)', 'var(--op-head)', 'var(--mod-txt)', 'var(--mod-act)'];
  let uidN = 0;

  function cfgNum(c, keys, d) { for (const k of keys) { const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), c); if (Number.isFinite(v)) return v; } return d; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n) };
    const cfgId = params.config || 'deformable-detr-r50';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const c = (run && run.config) || {};
    const M = Math.max(1, Math.round(cfgNum(c, ['M', 'h', 'heads', 'nHeads'], 8)));
    const K = Math.max(1, Math.round(cfgNum(c, ['K', 'points', 'nPoints'], 4)));
    const d = Math.round(cfgNum(c, ['d', 'D', 'dModel'], 256));
    const imgH = cfgNum(c, ['H', 'res.0', 'imgH'], 800), imgW = cfgNum(c, ['W', 'res.1', 'imgW'], 1216);
    // niveles: c.levelShapes = [[H_l, W_l], …] del calculador (strides 8, 16, 32, 64); si no, desde la resolución
    let levels = Array.isArray(c.levelShapes) && c.levelShapes.length
      ? c.levelShapes.map((hw, i) => ({ h: hw[0], w: hw[1], s: 8 * Math.pow(2, i) }))
      : [8, 16, 32, 64].slice(0, Math.max(1, Math.round(cfgNum(c, ['levels'], 4)))).map((s) => ({ s, h: Math.ceil(imgH / s), w: Math.ceil(imgW / s) }));
    levels = levels.filter((l) => l.h > 0 && l.w > 0);
    const L = levels.length;
    const N = levels.reduce((a, l) => a + l.h * l.w, 0);
    const Qd = Math.round(cfgNum(c, ['Q', 'numQueries', 'queries'], 300));
    const state = {
      head: params.head === 'all' ? 'all' : Number.isFinite(+params.head) ? Math.max(0, Math.min(M - 1, +params.head)) : 0,
      mode: params.mode === 'init' ? 'init' : 'learned',
      ref: Array.isArray(params.ref) ? params.ref.slice(0, 2) : [0.18, 0.60],
    };
    const uid = 'vdf' + (++uidN);

    // offsets Δp (en píxeles de cada nivel) y pesos A por cabeza
    function sampling(mode) {
      const R = V.rng(2010);
      const out = [];
      for (let m = 0; m < M; m++) {
        const th = 2 * Math.PI * m / M, cx = Math.cos(th), cy = Math.sin(th), mx = Math.max(Math.abs(cx), Math.abs(cy));
        const dir = [cx / mx, cy / mx];
        const pts = [];
        for (let l = 0; l < L; l++) for (let k = 0; k < K; k++) {
          let off = [dir[0] * (k + 1), dir[1] * (k + 1)];
          if (mode === 'learned') {
            const rot = 0.7 * R.normal(), sc = 0.6 + 1.2 * R();
            const cr = Math.cos(rot), sr = Math.sin(rot);
            off = [(off[0] * cr - off[1] * sr) * sc + 0.6 * R.normal(), (off[0] * sr + off[1] * cr) * sc + 0.6 * R.normal()];
          }
          pts.push({ l, k, off, logit: mode === 'learned' ? 1.3 * R.normal() + (l === 1 ? 0.5 : 0) : 0 });
        }
        const mxl = Math.max(...pts.map((p) => p.logit)), ex = pts.map((p) => Math.exp(p.logit - mxl)), s = ex.reduce((a, b) => a + b, 0);
        pts.forEach((p, i) => { p.a = ex[i] / s; });
        out.push(pts);
      }
      return out;
    }

    const wrap = V.html('div', { class: 'viz viz-deform' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => {
        const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g);
        b.addEventListener('click', () => { state[key] = v; draw(); });
        b._v = v; b._k = key; return b;
      });
    };
    const chips = [
      chipGroup('Cabeza', Array.from({ length: M }, (_, m) => [m, String(m + 1)]).concat([['all', 'las ' + M]]), 'head'),
      chipGroup('Offsets y pesos', [['init', 'inicialización'], ['learned', 'aprendidos']], 'mode'),
    ];
    const stage = V.html('div', { class: 'viz-stage viz-deform-stage', tabindex: 0, role: 'group', 'aria-label': 'Mapas de los ' + L + ' niveles; flechas: mover el punto de referencia' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Escena, offsets aprendidos y pesos ilustrativos (con semilla); la inicialización es la del código oficial. ' +
      'Para cada cabeza m, nivel l y punto k: posición = p̂ + Δp_mlk / (W_l, H_l), es decir, el offset se mide en píxeles de ese nivel (el mismo Δp cubre más imagen en un nivel grueso). ' +
      'Δp sale de una Linear D → h·L·K·2 de la query y los pesos de otra D → h·L·K con softmax sobre los L·K puntos de la cabeza. Cada muestra se lee con interpolación bilineal (por eso Δp es fraccionario). ' +
      'Toca un mapa o usa las flechas para mover p̂.' }, wrap);

    function draw() {
      chips.forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      const S = sampling(state.mode);
      stage.innerHTML = '';
      const narrow = (stage.clientWidth || 800) < 600;
      const perRow = narrow ? 2 : L;
      const PW = narrow ? Math.min(150, Math.floor(((stage.clientWidth || 320) - 30) / 2)) : Math.min(190, Math.floor(((stage.clientWidth || 800) - 24 - (L - 1) * 14) / L)), PH = Math.round(PW * imgH / imgW);
      const gapX = 14, TOP = narrow ? 58 : 44, rowH = PH + (narrow ? 56 : 44);
      const rowsN = Math.ceil(L / perRow);
      const barTop = TOP + rowsN * rowH + 14, barH = 64;
      const W = perRow * PW + (perRow - 1) * gapX + 16, Hh = barTop + barH + (narrow ? 56 : 46);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img',
        'aria-label': 'Punto de referencia en (' + state.ref.map((v) => v.toFixed(2)).join(', ') + ') y ' + (state.head === 'all' ? M + ' cabezas' : 'la cabeza ' + (state.head + 1)) + ': ' + K + ' puntos por nivel en ' + L + ' niveles' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      const refTxt = 'p̂ = (' + state.ref.map((v) => v.toFixed(2)).join(', ') + ')';
      const cnt = (state.head === 'all' ? M + ' cabezas × ' : '1 cabeza × ') + L + ' niveles × ' + K + ' puntos = ' + ((state.head === 'all' ? M : 1) * L * K) + ' muestras';
      if (narrow) { t(svg, 8, 16, 'Una query: ' + refTxt, 'viz-t'); t(svg, 8, 30, 'el mismo punto en los ' + L + ' niveles', 'viz-s'); t(svg, 8, 43, cnt, 'viz-s'); }
      else {
        t(svg, 8, 16, 'Una query: punto de referencia ' + refTxt + ' en los ' + L + ' niveles', 'viz-t');
        t(svg, 8, 30, cnt + (state.head === 'all' ? '' : ' (de ' + M * L * K + ' de la query)'), 'viz-s');
      }
      const heads = state.head === 'all' ? Array.from({ length: M }, (_, m) => m) : [state.head];
      const defs = V.svg('defs', null, svg);
      levels.forEach((lv, l) => {
        const col = l % perRow, row = Math.floor(l / perRow);
        const X = 8 + col * (PW + gapX), Y = TOP + row * rowH + 14;
        if (narrow) { t(svg, X, Y - 16, 'nivel ' + (l + 1) + ' · stride ' + lv.s, 'viz-s'); t(svg, X, Y - 4, lv.h + '×' + lv.w + ' tokens', 'viz-s'); }
        else t(svg, X, Y - 4, 'nivel ' + (l + 1) + ' · stride ' + lv.s + ' · ' + lv.h + '×' + lv.w, 'viz-s');
        const cp = V.svg('clipPath', { id: uid + '-c' + l }, defs);
        V.svg('rect', { x: X, y: Y, width: PW, height: PH }, cp);
        const g = V.svg('g', { 'clip-path': 'url(#' + uid + '-c' + l + ')', class: 'viz-deform-map', 'data-l': l }, svg);
        V.detScene(g, X, Y, PW, PH, V.DET_OBJECTS.slice(0, 7));
        // rejilla de tokens del nivel (si las celdas quedan < 3.5 px, una línea de cada 'step')
        const cw = PW / lv.w, ch = PH / lv.h, step = Math.max(1, Math.ceil(3.5 / Math.min(cw, ch)));
        let dd = '';
        for (let i = step; i < lv.w; i += step) dd += 'M' + (X + i * cw).toFixed(1) + ' ' + Y + 'V' + (Y + PH);
        for (let i = step; i < lv.h; i += step) dd += 'M' + X + ' ' + (Y + i * ch).toFixed(1) + 'H' + (X + PW);
        V.svg('path', { d: dd, class: 'viz-deform-grid' }, g);
        if (step > 1) t(svg, X + PW, Y + PH + 12, '(1 de cada ' + step + ' líneas)', 'viz-s', 'end');
        const rx = X + state.ref[0] * PW, ry = Y + state.ref[1] * PH;
        for (const m of heads) for (const p of S[m]) if (p.l === l) {
          const sx = rx + p.off[0] * cw, sy = ry + p.off[1] * ch;
          V.svg('line', { x1: rx.toFixed(1), y1: ry.toFixed(1), x2: sx.toFixed(1), y2: sy.toFixed(1), class: 'viz-deform-ray', style: 'stroke:' + HEAD_COLORS[m % HEAD_COLORS.length] }, g);
          V.svg('circle', { cx: sx.toFixed(1), cy: sy.toFixed(1), r: (1.6 + 9 * Math.sqrt(p.a)).toFixed(1), class: 'viz-deform-pt', style: 'fill:' + HEAD_COLORS[m % HEAD_COLORS.length] }, g);
        }
        V.svg('path', { d: 'M' + (rx - 6).toFixed(1) + ' ' + ry.toFixed(1) + 'h12M' + rx.toFixed(1) + ' ' + (ry - 6).toFixed(1) + 'v12', class: 'viz-deform-ref' }, g);
        V.svg('rect', { x: X, y: Y, width: PW, height: PH, class: 'viz-det-frame' }, svg);
        const hit = V.svg('rect', { x: X, y: Y, width: PW, height: PH, class: 'viz-deform-hit' }, svg);
        hit.addEventListener('click', (ev) => {
          const r = hit.getBoundingClientRect();
          if (!r.width) return;
          state.ref = [Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))];
          draw();
        });
      });
      // pesos A de la cabeza elegida (o de la 1.ª con "todas"): L grupos de K barras, suman 1
      const mm = state.head === 'all' ? 0 : state.head;
      t(svg, 8, barTop, narrow ? 'Pesos A, cabeza ' + (mm + 1) + ' (' + L * K + ' puntos, suman 1)' : 'Pesos A de la cabeza ' + (mm + 1) + ' (softmax sobre ' + L + '·' + K + ' = ' + L * K + ' puntos, suman 1)', 'viz-s');
      const bw = Math.min(14, Math.floor((W - 16 - (L - 1) * 12) / (L * K)));
      const amax = Math.max(...S[mm].map((p) => p.a));
      S[mm].forEach((p, i) => {
        const x = 8 + i * bw + p.l * 12, h = Math.max(1, (barH - 14) * p.a / amax);
        V.svg('rect', { x, y: barTop + barH - h, width: bw - 2, height: h, class: 'viz-deform-bar', style: 'fill:' + HEAD_COLORS[mm % HEAD_COLORS.length] }, svg);
        if (p.k === 0) t(svg, x, barTop + barH + 12, 'l' + (p.l + 1), 'viz-s');
      });
      if (narrow) { t(svg, 8, barTop + barH + 28, 'salida = Σ_m W_m · Σ_l Σ_k A_mlk ·', 'viz-n'); t(svg, 8, barTop + barH + 42, '        W′_m·x_l(p̂ + Δp_mlk)', 'viz-n'); }
      else t(svg, 8, barTop + barH + 28, 'salida = Σ_m W_m · Σ_l Σ_k A_mlk · W′_m·x_l(p̂ + Δp_mlk)', 'viz-n');
      readout();
    }

    function readout() {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('tokens en los ' + L + ' niveles:', levels.map((l) => l.h + '·' + l.w).join(' + ') + ' = ' + fmt.int(N));
      kv('muestras por query:', 'h·L·K = ' + M + '·' + L + '·' + K + ' = ' + M * L * K);
      kv('atención densa (una query):', fmt.int(N) + ' keys por cabeza');
      kv('offsets:', 'Linear ' + d + ' → ' + M * L * K * 2 + ' (h·L·K·2)');
      kv('pesos:', 'Linear ' + d + ' → ' + M * L * K + ' (h·L·K), softmax por cabeza');
      kv('en el encoder:', fmt.int(N) + ' queries (una por token) · en el decoder: ' + Qd);
    }

    function onKey(ev) {
      const dx = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0, dy = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
      if (!dx && !dy) return;
      ev.preventDefault();
      state.ref = [Math.max(0, Math.min(1, state.ref[0] + 0.03 * dx)), Math.max(0, Math.min(1, state.ref[1] + 0.03 * dy))];
      draw();
    }
    stage.addEventListener('keydown', onKey);
    draw();
    let ro = null, lastW = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const w = stage.clientWidth || 800; if (lastW !== null && Math.abs(w - lastW) > 24) draw(); lastW = w; });
      ro.observe(stage);
    }
    return { destroy() { if (ro) ro.disconnect(); stage.removeEventListener('keydown', onKey); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('deformable-attention', render);
})(typeof window !== 'undefined' ? window : globalThis);
