/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/patchify.js
   Visualización "patchify" (SPEC §7.8): una escena dibujada por código se corta en la rejilla
   (H/P)×(W/P), se aplana en N tokens (orden raster) + [CLS] y se le suma la tabla de posiciones.
   Controles: resolución y P (valores de los knobs del modelo); todos los números salen de
   ATLAS.Arch.metrics / ATLAS.Arch.run. Pasa el cursor (o enfoca) un parche o un token para
   ver su pareja. No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const cfgId = params.config || 'vit-b16-224';
    const base = A.run(cfgId);
    const knobs = (A.model && A.model(base.model) && A.model(base.model).knobs) || { res: [base.config.H], P: [base.config.P] };
    const state = { res: params.res || base.config.H, P: params.P || base.config.P, hover: -1 };
    const fmt = A.fmt;
    const id = 'pz' + Math.random().toString(36).slice(2, 8);

    const wrap = V.html('div', { class: 'viz viz-patchify' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chips = (label, key, values) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return values.map((v) => {
        const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: key === 'res' ? v + '×' + v : 'P = ' + v }, g);
        b.addEventListener('click', () => { state[key] = v; state.hover = -1; draw(); });
        b._v = v; b._k = key;
        return b;
      });
    };
    const bRes = chips('Resolución', 'res', knobs.res || [224]);
    const bP = chips('Parche', 'P', knobs.P || [16]);
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'La escena es ilustrativa (dibujada por código). La rejilla, N, las formas y los conteos salen del calculador. Pasa el cursor sobre un parche o un token.' }, wrap);

    function metricsFor(res, P) {
      try { return A.metrics(cfgId, { res, P }); } catch (e) { return null; }
    }

    function draw() {
      // chips: deshabilita combinaciones no divisibles
      for (const b of bRes.concat(bP)) {
        const res = b._k === 'res' ? b._v : state.res, P = b._k === 'P' ? b._v : state.P;
        b.disabled = !metricsFor(res, P);
        b.setAttribute('aria-pressed', String(state[b._k] === b._v));
        b.title = b.disabled ? 'No divisible: ' + res + ' / ' + P : '';
      }
      let m = metricsFor(state.res, state.P);
      if (!m) { state.P = base.config.P; state.res = base.config.H; m = metricsFor(state.res, state.P); }
      const D = base.config.D, C = base.config.C;
      const g = state.res / state.P;                 // parches por lado
      const N = m.tokens - 1;                        // tokens de parche (sin CLS)
      stage.innerHTML = '';
      const W = 760, Hh = 300;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, role: 'img', 'aria-label': 'Imagen de ' + state.res + '×' + state.res + ' cortada en ' + g + '×' + g + ' parches de ' + state.P + '×' + state.P + ': ' + N + ' tokens más [CLS] = ' + m.tokens + '.' }, stage);
      const defs = V.svg('defs', null, svg);
      const sceneG = V.svg('g', { id: id + '-scene' }, defs);
      V.scene(sceneG, 0, 0, 100, 100, 0);
      // ---- imagen con rejilla
      const IX = 16, IY = 40, IS = 200;
      V.svg('use', { href: '#' + id + '-scene', transform: 'translate(' + IX + ',' + IY + ') scale(' + IS / 100 + ')' }, svg);
      let d = '';
      for (let i = 1; i < g; i++) { const p = IX + i * IS / g, q = IY + i * IS / g; d += 'M' + p + ' ' + IY + 'V' + (IY + IS) + 'M' + IX + ' ' + q + 'H' + (IX + IS); }
      V.svg('path', { d, class: 'ad-scene-grid', 'stroke-width': g > 32 ? 0.4 : 0.8 }, svg);
      V.svg('rect', { x: IX, y: IY, width: IS, height: IS, class: 'ad-scene-frame' }, svg);
      const sel = V.svg('rect', { class: 'viz-sel', width: IS / g, height: IS / g, visibility: 'hidden' }, svg);
      txt(svg, IX, IY - 22, 'Imagen ' + state.res + '×' + state.res + '×' + C, 'viz-t');
      txt(svg, IX, IY - 8, g + '×' + g + ' parches de ' + state.P + '×' + state.P, 'viz-s');
      // hit-areas de parches (teclado: solo los primeros tokens visibles)
      const hit = V.svg('g', null, svg);
      hit.addEventListener('pointermove', (ev) => {
        const b = svg.getBoundingClientRect(), sx = W / b.width;
        const x = (ev.clientX - b.left) * sx - IX, y = (ev.clientY - b.top) * sx - IY;
        const i = Math.floor(y / (IS / g)) * g + Math.floor(x / (IS / g));
        if (i >= 0 && i < N && x >= 0 && y >= 0 && x < IS && y < IS) setHover(i);
      });
      hit.addEventListener('pointerleave', () => setHover(-1));
      V.svg('rect', { x: IX, y: IY, width: IS, height: IS, fill: 'transparent' }, hit);
      // ---- flecha
      V.svg('path', { d: 'M232 140H268', class: 'viz-ln' }, svg);
      V.svg('path', { d: 'M268 140l-6 -4v8z', fill: 'var(--muted)' }, svg);
      txt(svg, 250, 128, 'aplanar', 'viz-s', 'middle');
      // ---- tira de tokens: [CLS] + primeros k + … + últimos 2
      const TX = 280, TY = 92, TS = 26, gap = 3;
      const maxShow = 13;
      const show = N <= maxShow + 2 ? range(N) : range(maxShow).concat([-1, N - 2, N - 1]);
      txt(svg, TX, TY - 30, 'Secuencia: [CLS] + ' + N + ' tokens = ' + m.tokens + ' tokens', 'viz-t');
      txt(svg, TX, TY - 16, 'cada parche: ' + state.P + '·' + state.P + '·' + C + ' = ' + (state.P * state.P * C) + ' números → Linear → D = ' + D, 'viz-s');
      const tokEls = {};
      const cell = (x, i, label) => {
        const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'button', 'aria-label': label }, svg);
        if (i === 'cls') {
          V.svg('rect', { x, y: TY, width: TS, height: TS, rx: 3, class: 'viz-tok viz-tok--cls' }, gEl);
          txt(gEl, x + TS / 2, TY + TS / 2 + 4, 'CLS', 'viz-s', 'middle').setAttribute('style', 'font-size:8.5px;fill:var(--ink)');
        } else {
          const r = Math.floor(i / g), c = i % g;
          const nest = V.svg('svg', { x, y: TY, width: TS, height: TS, viewBox: (c * 100 / g) + ' ' + (r * 100 / g) + ' ' + (100 / g) + ' ' + (100 / g), preserveAspectRatio: 'none' }, gEl);
          V.svg('use', { href: '#' + id + '-scene' }, nest);
          V.svg('rect', { x, y: TY, width: TS, height: TS, rx: 2, class: 'viz-tok', 'fill-opacity': 0 }, gEl);
          gEl.addEventListener('pointerenter', () => setHover(i));
          gEl.addEventListener('focus', () => setHover(i));
          gEl.addEventListener('pointerleave', () => setHover(-1));
          gEl.addEventListener('blur', () => setHover(-1));
          tokEls[i] = gEl;
        }
        return gEl;
      };
      let x = TX;
      cell(x, 'cls', 'Token [CLS], posición 0');
      txt(svg, x + TS / 2, TY + TS + 13, '0', 'viz-s', 'middle');
      x += TS + gap + 4;
      for (const i of show) {
        if (i === -1) { txt(svg, x + 8, TY + TS / 2 + 4, '…', 'viz-t', 'middle'); x += 18; continue; }
        cell(x, i, 'Parche ' + (i + 1) + ' de ' + N + ' (fila ' + (Math.floor(i / g) + 1) + ', columna ' + (i % g + 1) + ')');
        if (i < 3 || i >= N - 2) txt(svg, x + TS / 2, TY + TS + 13, String(i + 1), 'viz-s', 'middle');
        x += TS + gap;
      }
      const stripEnd = x - gap;
      // ---- posición + suma
      const PY = TY + TS + 40;
      txt(svg, TX, PY - 8, '+ E_pos (aprendida): una fila por posición', 'viz-s');
      let px = TX;
      const all = ['cls'].concat(show);
      for (const i of all) {
        if (i === -1) { txt(svg, px + 8, PY + 14, '…', 'viz-t', 'middle'); px += 18; continue; }
        V.svg('rect', { x: px, y: PY, width: TS, height: 12, rx: 2, class: 'viz-pos' }, svg);
        px += TS + gap + (i === 'cls' ? 4 : 0);
      }
      const sumY = PY + 44;
      V.svg('path', { d: 'M' + TX + ' ' + (sumY - 12) + 'H' + stripEnd, class: 'viz-ln', 'stroke-dasharray': '2 3' }, svg);
      txt(svg, TX, sumY + 6, 'z₀ = [CLS; parches] + E_pos  →  ' + fmt.shape({ sym: ['N+1', 'D'], num: [m.tokens, D] }, 'sym') + ' = ' + m.tokens + '×' + D, 'viz-t');
      txt(svg, TX, sumY + 22, 'E_pos: ' + m.tokens + '×' + D + ' = ' + fmt.int(m.tokens * D) + ' parámetros', 'viz-s');
      txt(svg, TX, sumY + 37, 'atención: ' + fmt.int(m.tokens) + '² = ' + fmt.int(m.tokens * m.tokens) + ' puntuaciones por cabeza y capa', 'viz-s');
      const WW = Math.max(stripEnd + 12, 640);
      svg.setAttribute('viewBox', '0 0 ' + WW + ' ' + Hh);
      svg.style.maxWidth = WW + 'px';
      // ---- lectura
      const ref = metricsFor(base.config.H, base.config.P);
      out.innerHTML = '';
      const kv = (k, v) => { const s = V.html('span', null, out); s.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('N =', '(' + state.res + '/' + state.P + ')² = ' + fmt.int(N));
      kv('tokens', fmt.int(m.tokens));
      kv('MACs', fmt.si(m.macs) + (ref ? ' (×' + (m.macs / ref.macs).toFixed(2) + ' vs ' + base.label + ')' : ''));
      // Dos métricas distintas, cada una con su nombre (SPEC §6.5): scoreMacsShare y attnMacsShare.
      kv('atención (solo QKᵀ y A·V) / MACs', fmt.pct(m.scoreMacsShare));
      kv('bloque de atención (con proyecciones) / MACs', fmt.pct(m.attnMacsShare));
      function setHover(i) {
        state.hover = i;
        Object.values(tokEls).forEach((e) => e.classList.remove('is-hl'));
        if (i < 0) { sel.setAttribute('visibility', 'hidden'); return; }
        sel.setAttribute('x', IX + (i % g) * IS / g); sel.setAttribute('y', IY + Math.floor(i / g) * IS / g); sel.setAttribute('visibility', 'visible');
        if (tokEls[i]) tokEls[i].classList.add('is-hl');
      }
    }
    function txt(p, x, y, s, cls, anchor) { const t = V.svg('text', { x, y, class: cls, 'text-anchor': anchor || null }, p); t.textContent = s; return t; }
    function range(n) { return Array.from({ length: n }, (_, i) => i); }
    draw();
    return { destroy() { wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('patchify', render);
})(typeof window !== 'undefined' ? window : globalThis);
