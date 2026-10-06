/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/attention-map.js
   Visualización "attention-map" (SPEC §7.8): la fila de atención de UN token (query) sobre los
   parches de la imagen, como mapa de calor encima de la escena. Los pesos son SINTÉTICOS
   (ilustrativos: no salen de un modelo entrenado) y se construyen con una softmax real sobre
   puntuaciones inventadas por "cabeza" (local, semántica, por fila, global). La rejilla y N salen
   del calculador. Toca un parche para elegir la query. No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // Clase de la escena procedural en (fx, fy) ∈ [0,1]² (misma geometría que ArchDiagram.drawScene).
  function sceneClass(fx, fy) {
    if (Math.hypot(fx - 0.76, fy - 0.22) < 0.09) return 'sol';
    if (fx > 0.56 && fx < 0.72 && fy > 0.70 && fy < 0.81) return 'casa';
    if (fx > 0.54 && fx < 0.74 && fy > 0.63 && fy <= 0.71 && fy > 0.71 - (0.08 * (1 - Math.abs(fx - 0.64) / 0.10))) return 'casa';
    if (Math.hypot(fx - 0.178, fy - 0.62) < 0.075 || (fx > 0.16 && fx < 0.195 && fy > 0.66 && fy < 0.78)) return 'arbol';
    const ground = fy > 0.80 - 0.10 * Math.sin(Math.PI * Math.min(1, fx / 0.62)) * 0.6 && fy > 0.74;
    if (ground) return 'pasto';
    const ridge = [[0, 0.70], [0.28, 0.32], [0.5, 0.58], [0.68, 0.40], [1, 0.72]];
    for (let i = 1; i < ridge.length; i++) {
      const [x0, y0] = ridge[i - 1], [x1, y1] = ridge[i];
      if (fx >= x0 && fx <= x1) { const yr = y0 + (y1 - y0) * (fx - x0) / (x1 - x0); return fy > yr ? 'montaña' : 'cielo'; }
    }
    return 'cielo';
  }

  const HEADS = [
    { id: 'local', label: 'Cabeza "local"', note: 'mira sobre todo a los parches vecinos (como un kernel grande)' },
    { id: 'sem', label: 'Cabeza "semántica"', note: 'mira a los parches del mismo objeto, estén donde estén' },
    { id: 'row', label: 'Cabeza "por fila"', note: 'mira a su misma fila (patrón de posición)' },
    { id: 'glob', label: 'Cabeza "global"', note: 'reparte casi uniforme: promedia toda la imagen' },
  ];

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const cfgId = params.config || 'vit-b16-224';
    const run = A.run(cfgId);
    const g = run.config.H / run.config.P;       // parches por lado (14 en ViT-B/16 @ 224)
    const N = g * g;
    const fmt = A.fmt;
    const state = { q: params.query != null ? params.query : Math.round(g * 0.45) * g + Math.round(g * 0.3), head: params.head || 'sem' };
    const id = 'am' + Math.random().toString(36).slice(2, 8);
    const cls = [];
    for (let i = 0; i < N; i++) cls.push(sceneClass(((i % g) + 0.5) / g, (Math.floor(i / g) + 0.5) / g));

    const wrap = V.html('div', { class: 'viz viz-attnmap' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const hg = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Cabeza' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Cabeza' }, hg);
    const hb = HEADS.map((h) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: h.label.replace('Cabeza ', '') }, hg); b.addEventListener('click', () => { state.head = h.id; draw(); }); b._h = h.id; return b; });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Pesos sintéticos (no de un ViT entrenado) para mostrar la idea: cada query tiene una fila de softmax sobre los ' + N + ' parches (+ [CLS]) que suma 1. Toca un parche para cambiar la query; con flechas también se mueve.' }, wrap);

    function weights() {
      const qi = state.q, qr = Math.floor(qi / g), qc = qi % g;
      const s = new Array(N + 1);
      for (let i = 0; i < N; i++) {
        const r = Math.floor(i / g), c = i % g;
        const d2 = ((r - qr) ** 2 + (c - qc) ** 2) / (g * g);
        let v;
        if (state.head === 'local') v = -d2 * 60;
        else if (state.head === 'sem') v = (cls[i] === cls[qi] ? 3.2 : 0) - d2 * 4;
        else if (state.head === 'row') v = (r === qr ? 3.5 : 0) - Math.abs(c - qc) / g;
        else v = -d2 * 0.8;
        s[i + 1] = v;
      }
      s[0] = state.head === 'glob' ? 1.5 : 0.5;                // el [CLS]
      const mx = Math.max(...s);
      const e = s.map((v) => Math.exp(v - mx));
      const z = e.reduce((a, b) => a + b, 0);
      return e.map((v) => v / z);
    }

    function draw() {
      hb.forEach((b) => b.setAttribute('aria-pressed', String(b._h === state.head)));
      const w = weights();
      const wmax = Math.max(...w.slice(1));
      stage.innerHTML = '';
      const W = 560, IX = 12, IY = 30, IS = 300;
      const svg = V.svg('svg', { class: 'viz-svg', style: 'max-width:' + W + 'px', viewBox: '0 0 ' + W + ' 350', role: 'img', 'aria-label': 'Mapa de atención ilustrativo de la query en la fila ' + (Math.floor(state.q / g) + 1) + ', columna ' + (state.q % g + 1) + '.' }, stage);
      const defs = V.svg('defs', null, svg);
      V.scene(V.svg('g', { id: id + '-s' }, defs), 0, 0, 100, 100, 0);
      V.svg('use', { href: '#' + id + '-s', transform: 'translate(' + IX + ',' + IY + ') scale(' + IS / 100 + ')', opacity: 0.55 }, svg);
      const cs = IS / g;
      const grid = V.svg('g', { tabindex: 0, role: 'grid', 'aria-label': 'Parches: usa las flechas para mover la query' }, svg);
      for (let i = 0; i < N; i++) {
        const r = Math.floor(i / g), c = i % g;
        const rect = V.svg('rect', { x: IX + c * cs, y: IY + r * cs, width: cs, height: cs, class: 'viz-heat', fill: 'var(--op-attn)', 'fill-opacity': (0.82 * w[i + 1] / wmax).toFixed(3) }, grid);
        rect.addEventListener('click', () => { state.q = i; draw(); });
      }
      let d = '';
      for (let i = 1; i < g; i++) d += 'M' + (IX + i * cs) + ' ' + IY + 'V' + (IY + IS) + 'M' + IX + ' ' + (IY + i * cs) + 'H' + (IX + IS);
      V.svg('path', { d, class: 'ad-scene-grid', 'stroke-opacity': 0.35, 'pointer-events': 'none' }, svg);
      V.svg('rect', { x: IX, y: IY, width: IS, height: IS, class: 'ad-scene-frame', 'pointer-events': 'none' }, svg);
      V.svg('rect', { x: IX + (state.q % g) * cs, y: IY + Math.floor(state.q / g) * cs, width: cs, height: cs, class: 'viz-q', 'pointer-events': 'none' }, svg);
      grid.addEventListener('keydown', (ev) => {
        const k = ev.key; let q = state.q;
        if (k === 'ArrowRight' && q % g < g - 1) q++; else if (k === 'ArrowLeft' && q % g > 0) q--;
        else if (k === 'ArrowDown' && q + g < N) q += g; else if (k === 'ArrowUp' && q - g >= 0) q -= g; else return;
        ev.preventDefault(); state.q = q; draw(); const ng = stage.querySelector('[role="grid"]'); if (ng) ng.focus();
      });
      txt(svg, IX, IY - 12, 'Query: parche fila ' + (Math.floor(state.q / g) + 1) + ', columna ' + (state.q % g + 1) + ' (' + cls[state.q] + ')', 'viz-t');
      // ---- barra lateral: la fila de la softmax (CLS + top parches)
      const BX = IX + IS + 28;
      txt(svg, BX, IY - 12, 'Fila de A (softmax): suma 1', 'viz-t');
      const order = w.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 9);
      order.forEach(([v, i], k) => {
        const y = IY + 8 + k * 30;
        const name = i === 0 ? '[CLS]' : 'parche ' + (Math.floor((i - 1) / g) + 1) + ',' + ((i - 1) % g + 1) + ' (' + cls[i - 1] + ')';
        txt(svg, BX, y + 4, name, 'viz-s');
        V.svg('rect', { x: BX, y: y + 9, width: Math.max(1, 180 * v / order[0][0]), height: 8, rx: 2, fill: 'var(--op-attn)' }, svg);
        txt(svg, BX + 186, y + 17, (v * 100).toFixed(1) + ' %', 'viz-n');
      });
      out.innerHTML = '';
      const h = HEADS.find((x) => x.id === state.head);
      const kv = (k, v) => { const s = V.html('span', null, out); s.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('fila de A:', fmt.int(N + 1) + ' pesos (' + g + '×' + g + ' parches + [CLS])');
      kv('suma', w.reduce((a, b) => a + b, 0).toFixed(3));
      kv(h.label + ':', h.note);
    }
    function txt(p, x, y, s, c) { const t = V.svg('text', { x, y, class: c }, p); t.textContent = s; return t; }
    draw();
    return { destroy() { wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('attention-map', render);
})(typeof window !== 'undefined' ? window : globalThis);
