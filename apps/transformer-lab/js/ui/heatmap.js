/* =============================================================================
   Transformer Lab — js/ui/heatmap.js
   TL.Heatmap: mapa de calor DOM (CSS grid) de un TensorRef (spec §9.2).

   API
     const hm = TL.Heatmap.create(ref, {
        cell,            // px fijo (número o {w,h}); si se omite, tamaño adaptable (fit)
        showValues,      // true | false | 'auto' (por defecto 'auto': números si caben)
        scale,           // 'diverging' | 'sequential' | 'none' | 'auto' (por rol)
        maxAbs,          // escala compartida (divergente) o máximo (secuencial)
        caption,         // true | false | 'compact'
        name,            // LaTeX alternativo para el título (por defecto ref.tex)
        note,            // HTML corto bajo el título (p. ej. «columnas 4…7 de Q»)
        tag,             // texto de la etiqueta de rol (false = sin etiqueta)
        tagRole,         // clase de color de la etiqueta (por defecto, el rol del tensor)
        onTag,           // si se da, la etiqueta es un botón que llama a onTag() (p. ej. «del forward · paso 12»)
        tagTitle,        // título (tooltip) de la etiqueta
        highlightCols,   // [[c0, c1, cssVar]] bandas de columnas (colores de cabeza)
        rowLabels, colLabels, rowOffset,   // anulan los de ref (rowOffset: índice absoluto de filas)
        fit,             // false = no se ajusta solo (lo hace quien lo usa llamando a hm.fit(ancho))
        fitTo,           // elemento cuyo ancho limita el mapa (por defecto, el padre)
        onHover(i, j, value), onLeave(), ariaLabel })
     hm.el  hm.ref  hm.mat  hm.scale {type, maxAbs, lo, hi}
     hm.highlightCell(i, j, cls)  hm.highlightRow(i, cls)  hm.highlightCol(j, cls)  hm.clear()
     hm.mark(i, j, cls) / hm.markRow / hm.markCol / hm.clearMarks()   (marcas persistentes: clear() no las borra)
     hm.update(mat)  hm.reveal(n)  (n primeras celdas visibles, en orden de filas; sin n: todas)
     hm.fit(anchoDisponible)  hm.focusCell(i, j)  hm.hover(i, j)  hm.recolor()  hm.destroy()
     Matrices grandes (> 700 celdas, o opts.canvas = true): las celdas se dibujan en un <canvas>
     (mismas cabeceras DOM, mismos resaltados y la misma interacción; teclado con un cursor virtual).
   Estáticos
     TL.Heatmap.fmt(x)  (3 cifras significativas, −∞, 1.2e−4)   TL.Heatmap.fmtFull(x, sig=4)
     TL.Heatmap.legend(items)  items: [{ scale, names: string[], note }] → elemento .hm-legend
     TL.Heatmap.axisSym(ax) → HTML ('d<sub>k</sub>'…)   TL.Heatmap.colorOf(value, scale) → '#rrggbb'
     TL.Heatmap.recolorAll()
   Clases de resaltado (css/viz.css): hl (celda en foco / resultado), src (fila/columna que
   contribuye), alt (segundo operando), tgt (objetivo), dim; marcas: tgt, head, pin.
   Teclado: una sola parada de tabulación por mapa (tabindex itinerante); flechas, Inicio/Fin,
   Ctrl+Inicio/Fin. Se puede ir a las cabeceras (fila −1 / columna −1). Cada movimiento llama a onHover.
   ========================================================================== */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const doc = root.document;

  // tamaños (px)
  const CH_W = 6.05;       // avance de IBM Plex Mono a 10 px (valores)
  const LAB_W = 6.6;       // avance a 11 px (etiquetas)
  const VAL_H = 22;        // alto de celda con números
  const MAX_W = 54;        // ancho máximo de celda con números
  const MIN_C = 12;        // lado mínimo de celda (solo color)
  const SQ_MAX = 26;       // lado máximo de celda cuadrada (solo color)
  const CONFIG = { canvasMin: 700 }; // a partir de tantas celdas, se dibujan en un <canvas> (rendimiento)
  const GAP = 1;           // separación entre celdas (px), igual que el gap de la rejilla CSS

  const MINUS = '−';
  const AXSYM = { T: 'T', V: 'V', d: 'd', dk: 'd<sub>k</sub>', dff: 'd<sub>ff</sub>', '1': '1', maxLen: 'T<sub>max</sub>' };
  const AXNAME = { T: 'posición', V: 'token', d: 'dimensión', dk: 'dimensión', dff: 'neurona', '1': '', maxLen: 'posición' };
  const TAGS = { grad: 'gradiente', param: 'parámetro', const: 'constante', onehot: 'one-hot', mask: 'máscara', fwd: 'del forward' };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NINF_HTML = '<span class="hm__ninf">' + '−∞' + '</span>';

  // ---------------------------------------------------------------- números
  function expForm(x, digits) {
    const a = Math.abs(x);
    let e = Math.floor(Math.log10(a));
    let m = +(x / Math.pow(10, e)).toFixed(digits);
    if (Math.abs(m) >= 10) { m /= 10; e += 1; m = +m.toFixed(digits); }
    let ms = String(m);
    return (ms + 'e' + e).replace(/-/g, MINUS);
  }
  // celda: 3 cifras significativas (2 si |x| < 0.01); enteros tal cual; |x| < 0.001 en notación 1.2e−4
  function fmt(x) {
    if (x === -Infinity) return MINUS + '∞';
    if (x === Infinity) return '∞';
    if (Number.isNaN(x) || x == null) return '—';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (Number.isInteger(x) && a < 1e4) return String(x).replace('-', MINUS);
    if (a < 0.001 || a >= 1e4) return expForm(x, 1);
    if (a >= 1000) return String(Math.round(x)).replace('-', MINUS);
    return x.toPrecision(a < 0.01 ? 2 : 3).replace('-', MINUS);
  }
  // inspector: `sig` cifras significativas (por defecto 4)
  function fmtFull(x, sig) {
    sig = sig || 4;
    if (x === -Infinity) return MINUS + '∞';
    if (x === Infinity) return '∞';
    if (Number.isNaN(x) || x == null) return '—';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (Number.isInteger(x) && a < 1e6) return String(x).replace('-', MINUS);
    if (a < 1e-4 || a >= 1e6) return expForm(x, sig - 1);
    let s = x.toPrecision(sig);
    if (s.indexOf('e') >= 0) s = String(+s);
    return s.replace('-', MINUS);
  }

  // ---------------------------------------------------------------- colores (leídos de las variables CSS)
  let theme = null;
  function parseColor(s) {
    s = String(s || '').trim();
    let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
      if (p.length === 3 && p.every(Number.isFinite)) return p;
    }
    return null;
  }
  function readTheme() {
    if (theme) return theme;
    const cs = doc ? getComputedStyle(doc.documentElement) : null;
    const g = (n, fb) => parseColor(cs && cs.getPropertyValue(n)) || parseColor(fb);
    theme = {
      neg: g('--neg', '#2F64B5'), zero: g('--zero', '#F8FAFB'), pos: g('--pos', '#C8502A'),
      p0: g('--prob-0', '#F8FAFB'), p1: g('--prob-1', '#4B2E83'), masked: g('--masked', '#9AA6B2'),
      ink: g('--ink', '#15202B'), surface: g('--surface', '#F8FAFB'), surface2: g('--surface-2', '#F1F4F7'),
      muted: g('--muted', '#5A6774'),
    };
    theme.mono = (cs && cs.getPropertyValue('--font-mono').trim()) || 'ui-monospace, monospace';
    const lum = (c) => {
      const f = (v) => LIN[Math.max(0, Math.min(255, Math.round(v)))];
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    theme.lum = lum;
    theme.inkL = lum(theme.ink);
    theme.surfL = lum(theme.surface);
    theme.inkHex = hex(theme.ink);
    theme.surfHex = hex(theme.surface);
    return theme;
  }
  // tabla sRGB → lineal (luminancia relativa, WCAG) para no calcular potencias en cada celda
  const LIN = new Float64Array(256);
  for (let v = 0; v < 256; v++) { const x = v / 255; LIN[v] = x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
  const HEX2 = Array.from({ length: 256 }, (_, v) => v.toString(16).padStart(2, '0'));
  const hex = (c) => '#' + HEX2[Math.max(0, Math.min(255, Math.round(c[0])))] + HEX2[Math.max(0, Math.min(255, Math.round(c[1])))] + HEX2[Math.max(0, Math.min(255, Math.round(c[2])))];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // color de fondo [r,g,b] de un valor según la escala
  function rgbOf(v, sc) {
    const th = readTheme();
    if (sc.type === 'none') return th.surface;
    if (Number.isNaN(v)) return th.masked;
    if (sc.type === 'sequential') {
      const t = sc.hi > sc.lo ? Math.max(0, Math.min(1, (v - sc.lo) / (sc.hi - sc.lo))) : 0;
      return mix(th.p0, th.p1, t);
    }
    const t = Math.max(-1, Math.min(1, v / (sc.maxAbs || 1)));
    return t >= 0 ? mix(th.zero, th.pos, t) : mix(th.zero, th.neg, -t);
  }
  function colorOf(v, sc) { return hex(rgbOf(v, sc)); }
  // texto: tinta o superficie, la que más contraste; si ninguna llega a 4.5:1 (celdas de tono
  // medio), negro o blanco puros, que siempre lo superan
  function textOn(rgb) {
    const th = readTheme();
    const L = th.lum(rgb);
    const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const ci = cr(L, th.inkL), cs = cr(L, th.surfL);
    if (Math.max(ci, cs) >= 4.5) return ci >= cs ? th.inkHex : th.surfHex;
    return cr(L, 0) >= cr(L, 1) ? '#000000' : '#ffffff';
  }

  // ---------------------------------------------------------------- registro (tema)
  const live = new Set();
  let watching = false, raf = 0;
  function recolorAll() {
    theme = null;
    for (const hm of Array.from(live)) {
      if (!hm.el.isConnected) { live.delete(hm); hm._stale = true; continue; }
      hm.recolor();
    }
  }
  function watchTheme() {
    if (watching || !doc) return;
    watching = true;
    const sched = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; recolorAll(); }); };
    try { new MutationObserver(sched).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* nada */ }
    try {
      const mq = root.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', sched); else if (mq.addListener) mq.addListener(sched);
    } catch (e) { /* nada */ }
    // los mapas en canvas se redibujan al cargar las fuentes y al cambiar la densidad de píxeles
    const redrawCanvas = () => { for (const hm of live) if (hm.canvasMode && hm.el.isConnected) hm._draw(); };
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(redrawCanvas).catch(() => {});
    let dpr = root.devicePixelRatio || 1;
    try { root.addEventListener('resize', () => { const n = root.devicePixelRatio || 1; if (n !== dpr) { dpr = n; redrawCanvas(); } }); } catch (e) { /* nada */ }
  }

  // ajuste automático compartido (un solo ResizeObserver)
  let ro = null;
  const roTargets = new Map(); // elemento → Set<hm>
  function observeFit(hm, target) {
    if (typeof ResizeObserver === 'undefined') return;
    if (!ro) {
      ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const set = roTargets.get(e.target);
          if (!set) continue;
          const w = e.contentRect.width;
          for (const h of set) if (!h._destroyed && w > 0 && Math.abs(w - (h._lastFit || 0)) > 0.5) h.fit(w);
        }
      });
    }
    let set = roTargets.get(target);
    if (!set) { set = new Set(); roTargets.set(target, set); ro.observe(target); }
    set.add(hm);
    hm._fitTarget = target;
  }
  function unobserveFit(hm) {
    const t = hm._fitTarget;
    if (!t || !ro) return;
    const set = roTargets.get(t);
    if (set) {
      set.delete(hm);
      if (!set.size) { roTargets.delete(t); ro.unobserve(t); }
    }
    hm._fitTarget = null;
  }

  // ---------------------------------------------------------------- etiquetas
  function axisSym(ax) { return AXSYM[ax] || esc(ax); }

  // Tras mover el foco con el teclado: el inspector (fijo al pie en pantallas medianas) crece un
  // fotograma después y puede tapar la celda. Dos fotogramas más tarde se vuelve a asegurar que se
  // ve (html tiene scroll-padding con la altura del inspector y de la línea de tiempo).
  function keepInView(el) {
    if (!el || typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!el.isConnected) return;
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* nada */ }
    }));
  }

  // ---------------------------------------------------------------- clase
  class Heatmap {
    constructor(ref, opts) {
      this.ref = ref;
      this.opts = opts = Object.assign({ showValues: 'auto', scale: 'auto', caption: true }, opts || {});
      this.mat = ref.mat;
      this.R = ref.mat.r;
      this.C = ref.mat.c;
      this._bands = [];
      this._marks = [];
      this._hlHead = [];
      this._revealed = Infinity;
      this._fi = 0; this._fj = 0;
      this._lastHover = null;
      this.rowLabels = opts.rowLabels !== undefined ? opts.rowLabels : ref.rowLabels;
      this.colLabels = opts.colLabels !== undefined ? opts.colLabels : ref.colLabels;
      this.rowOffset = opts.rowOffset || 0;
      this.colOffset = ref.colOffset || 0;
      this._computeScale();
      this.canvasMode = opts.canvas != null ? !!opts.canvas : this.R * this.C > CONFIG.canvasMin;
      this._build();
      if (this.canvasMode) this.paint();
      live.add(this);
      watchTheme();
      if (opts.cell) this._fixedCell(opts.cell);
      else if (opts.fit !== false) this._autoFit();
    }

    // ---- escala
    _computeScale() {
      const o = this.opts, role = this.ref.role, m = this.mat;
      let type = o.scale;
      if (!type || type === 'auto') type = role === 'prob' || role === 'onehot' || role === 'mask' ? 'sequential' : 'diverging';
      const sc = { type, shared: o.maxAbs != null };
      if (type === 'diverging') {
        sc.maxAbs = o.maxAbs != null ? o.maxAbs : m.maxAbs();
        if (!(sc.maxAbs > 0)) sc.maxAbs = 1;
      } else if (type === 'sequential') {
        sc.lo = 0;
        sc.hi = o.maxAbs != null ? o.maxAbs : (role === 'prob' || role === 'onehot' || role === 'mask' ? 1 : m.max());
        if (!(sc.hi > sc.lo)) sc.hi = sc.lo + 1;
        sc.maxAbs = sc.hi;
      }
      this.scale = sc;
      // ancho necesario para mostrar los números
      let mx = 1;
      const d = m.d;
      for (let k = 0; k < d.length; k++) { const L = fmt(d[k]).length; if (L > mx) mx = L; }
      this.valW = Math.max(26, Math.ceil(mx * CH_W + 7));
    }

    // ---- etiquetas de filas / columnas
    _rowLabel(i) {
      const L = this.rowLabels, ax = this.ref.rowAxis;
      if (ax === '1') return '';
      const idx = i + this.rowOffset;
      if (L && L[i] != null) return '<span class="hm__ix">' + idx + '</span><span class="hm__tok">' + esc(L[i]) + '</span>';
      return '<span class="hm__ix">' + idx + '</span>';
    }
    _colLabel(j) {
      const L = this.colLabels, ax = this.ref.colAxis;
      if (ax === '1') return '';
      if (L && L[j] != null) return '<span class="hm__tok">' + esc(L[j]) + '</span>';
      if (ax === 'dk' && this.colOffset > 0) return '<span class="hm__ix">' + j + '</span><span class="hm__abs" title="columna ' + (j + this.colOffset) + ' de la matriz completa">(' + (j + this.colOffset) + ')</span>';
      return '<span class="hm__ix">' + j + '</span>';
    }
    _estRowHeader() {
      const ax = this.ref.rowAxis;
      if (ax === '1') return 8;
      let mx = 0;
      const L = this.rowLabels;
      for (let i = 0; i < this.R; i++) {
        const n = String(i + this.rowOffset).length + (L && L[i] != null ? String(L[i]).length + 1 : 0);
        if (n > mx) mx = n;
      }
      return Math.ceil(mx * LAB_W + 15);
    }
    _estColLabel() {
      const L = this.colLabels;
      let mx = 1;
      if (L) { for (let j = 0; j < this.C; j++) if (L[j] != null && String(L[j]).length > mx) mx = String(L[j]).length; }
      else mx = String(this.C - 1 + this.colOffset).length;
      return Math.ceil(mx * LAB_W + 6);
    }

    // ---- DOM
    _build() {
      const o = this.opts, ref = this.ref;
      const fig = doc.createElement('figure');
      fig.className = 'hm hm--' + (ref.role || 'act') + ' hm--' + this.scale.type;
      this.el = fig;
      if (o.caption) {
        const cap = doc.createElement('figcaption');
        cap.className = 'hm__cap' + (o.caption === 'compact' ? ' hm__cap--compact' : '');
        const name = doc.createElement('span');
        name.className = 'hm__name';
        const tex = o.name || ref.tex || ref.label || '';
        if (TL.MathTex) TL.MathTex.render(tex, name, { lite: true }); else name.textContent = ref.label || tex;
        cap.appendChild(name);
        const b = doc.createElement('span');
        b.className = 'badge-shape hm__shape';
        b.textContent = this.R + '×' + this.C;
        b.title = 'Forma: ' + this.R + ' filas × ' + this.C + ' columnas';
        cap.appendChild(b);
        if (o.caption !== 'compact') {
          const s = doc.createElement('span');
          s.className = 'badge-shape badge-shape--sym hm__sym';
          s.innerHTML = axisSym(ref.rowAxis) + '×' + axisSym(ref.colAxis);
          cap.appendChild(s);
        }
        const tagText = o.tag !== undefined ? o.tag : TAGS[ref.role];
        if (tagText) {
          const t = doc.createElement(typeof o.onTag === 'function' ? 'button' : 'span');
          t.className = 'hm__tag hm__tag--' + (o.tagRole || ref.role);
          t.textContent = tagText;
          if (o.tagTitle) t.title = o.tagTitle;
          if (typeof o.onTag === 'function') {
            t.type = 'button';
            t.classList.add('hm__tag--btn');
            t.addEventListener('click', (e) => { e.preventDefault(); o.onTag(); });
          }
          cap.appendChild(t);
        }
        fig.appendChild(cap);
        if (o.note) {
          const n = doc.createElement('div');
          n.className = 'hm__note';
          n.innerHTML = o.note;
          fig.appendChild(n);
        }
      }
      const scroll = doc.createElement('div');
      scroll.className = 'hm__scroll';
      const grid = doc.createElement('div');
      grid.className = 'hm__grid';
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', o.ariaLabel || ((ref.label || ref.key || 'matriz') + ', ' + this.R + ' por ' + this.C));
      grid.setAttribute('aria-rowcount', String(this.R + 1));
      grid.setAttribute('aria-colcount', String(this.C + 1));
      grid.style.gridTemplateColumns = 'max-content repeat(' + this.C + ', var(--cw, 24px))';
      grid.style.gridTemplateRows = 'auto repeat(' + this.R + ', var(--ch, 24px))';
      const R = this.R, C = this.C;
      const parts = [];
      if (this.canvasMode) {
        // cabeceras DOM con posición explícita; las R×C celdas se dibujan en un único canvas
        grid.setAttribute('role', 'group');
        grid.removeAttribute('aria-rowcount'); grid.removeAttribute('aria-colcount');
        parts.push('<div class="hm__corner" aria-hidden="true" style="grid-area:1/1"></div>');
        for (let j = 0; j < C; j++) parts.push('<div class="hm__ch" data-j="' + j + '" style="grid-row:1;grid-column:' + (j + 2) + '">' + this._colLabel(j) + '</div>');
        for (let i = 0; i < R; i++) parts.push('<div class="hm__rh" data-i="' + i + '" style="grid-row:' + (i + 2) + ';grid-column:1">' + this._rowLabel(i) + '</div>');
        grid.innerHTML = parts.join('');
        this.cells = [];
        const cv = doc.createElement('canvas');
        cv.className = 'hm__cv';
        cv.style.gridArea = '2 / 2 / ' + (R + 2) + ' / ' + (C + 2);
        cv.tabIndex = 0;
        cv.setAttribute('role', 'img');
        cv.setAttribute('aria-label', (ref.label || ref.key || 'matriz') + ', ' + R + ' por ' + C + '. Usa las flechas para recorrer las celdas.');
        grid.appendChild(cv);
        this.canvas = cv;
        const live = doc.createElement('div');
        live.className = 'sr-only';
        live.setAttribute('aria-live', 'polite');
        fig.appendChild(live);
        this.liveEl = live;
      } else {
        parts.push('<div class="hm__row" role="row"><div class="hm__corner" role="columnheader" aria-hidden="true"></div>');
        for (let j = 0; j < C; j++) parts.push('<div class="hm__ch" role="columnheader" data-j="' + j + '">' + this._colLabel(j) + '</div>');
        parts.push('</div>');
        for (let i = 0; i < R; i++) {
          parts.push('<div class="hm__row" role="row"><div class="hm__rh" role="rowheader" data-i="' + i + '">' + this._rowLabel(i) + '</div>');
          for (let j = 0; j < C; j++) parts.push(this._cellHTML(i * C + j));
          parts.push('</div>');
        }
        grid.innerHTML = parts.join('');
        this.cells = Array.from(grid.getElementsByClassName('hm__c'));
        if (this.cells.length) this.cells[0].tabIndex = 0;
      }
      this.colHeads = Array.from(grid.getElementsByClassName('hm__ch'));
      this.rowHeads = Array.from(grid.getElementsByClassName('hm__rh'));
      scroll.appendChild(grid);
      fig.appendChild(scroll);
      this.grid = grid;
      this.scrollEl = scroll;
      this.rhW = this._estRowHeader();
      this.colLabW = this._estColLabel();
      // ancho preferido con números: el de los números, o el de las etiquetas de columna si caben (≤ 66 px)
      this.prefW = Math.max(this.valW, this.colLabels ? Math.min(this.colLabW, 66) : 0);
      this._band(2, 2, R + 2, C + 2, 'hm__frame', []);
      // «todo ceros» (p. ej. los momentos m, v de Adam en la primera iteración)
      this._allZero = R * C >= 4 && this.mat.maxAbs() === 0;
      if (this._allZero) {
        const z = doc.createElement('div');
        z.className = 'hm__allzero';
        z.setAttribute('aria-hidden', 'true');
        z.style.gridArea = '2 / 2 / ' + (R + 2) + ' / ' + (C + 2);
        z.innerHTML = '<span>todo ceros</span>';
        grid.appendChild(z);
        this._zeroNote = z;
      }
      if (o.highlightCols) { fig.classList.add('hm--cols'); for (const [c0, c1, v] of o.highlightCols) this._band(1, c0 + 2, R + 2, c1 + 2, 'hm__cols', this._marks, v); }
      this._bind();
    }

    // HTML inicial de una celda (colores y texto ya calculados: un solo análisis de HTML, sin reescrituras)
    _cellHTML(k) {
      const v = this.mat.d[k], sc = this.scale;
      let cls = 'hm__c';
      if (v === -Infinity) cls += ' is-ninf';
      else if (v === 0) cls += ' is-zero';
      if (k >= this._revealed) cls += ' is-pending';
      let st = '';
      if (v !== -Infinity && sc.type !== 'none') { const rgb = rgbOf(v, sc); st = ' style="background:' + hex(rgb) + ';color:' + textOn(rgb) + '"'; }
      return '<div class="' + cls + '" role="gridcell" data-k="' + k + '"' + st + '>' + (v === -Infinity ? NINF_HTML : fmt(v)) + '</div>';
    }
    paint() {
      if (this.canvasMode) { this._draw(); this._stale = false; return; }
      const d = this.mat.d, sc = this.scale, cells = this.cells;
      const noColor = sc.type === 'none';
      for (let k = 0; k < cells.length; k++) {
        const v = d[k], c = cells[k];
        let cls = 'hm__c';
        if (v === -Infinity) cls += ' is-ninf';
        else if (v === 0) cls += ' is-zero';
        if (k >= this._revealed) cls += ' is-pending';
        c.className = cls;
        if (v === -Infinity) c.innerHTML = NINF_HTML; else c.textContent = fmt(v);
        if (v === -Infinity || noColor) { c.style.background = ''; c.style.color = ''; continue; }
        const rgb = rgbOf(v, sc);
        c.style.background = hex(rgb);
        c.style.color = textOn(rgb);
      }
      this._stale = false;
    }
    recolor() { if (this._destroyed) return; this.paint(); }
    update(mat) {
      if (mat) {
        if (mat.r !== this.R || mat.c !== this.C) throw new Error('Heatmap.update: forma distinta');
        this.mat = mat;
      }
      if (this._stale) { theme = null; live.add(this); }
      this.paint();
    }
    reveal(n) {
      const N = this.R * this.C;
      const v = n == null ? N : Math.max(0, Math.min(N, n));
      this._revealed = v >= N ? Infinity : v;
      if (this.canvasMode) { this._draw(); return; }
      for (let k = 0; k < N; k++) this.cells[k].classList.toggle('is-pending', k >= v);
    }
    // dibujo en canvas (modo de matrices grandes): mismo aspecto que las celdas DOM
    _draw() {
      const cv = this.canvas;
      if (!cv || !this.cellW) return;
      const R = this.R, C = this.C, cw = this.cellW, ch = this.cellH;
      const W = C * cw + (C - 1) * GAP, H = R * ch + (R - 1) * GAP;
      const dpr = root.devicePixelRatio || 1;
      const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
      if (cv.width !== pw) cv.width = pw;
      if (cv.height !== ph) cv.height = ph;
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const th = readTheme();
      g.fillStyle = hex(th.surface);
      g.fillRect(0, 0, W, H);
      const d = this.mat.d, sc = this.scale, vals = this.valuesShown, noColor = sc.type === 'none';
      if (vals) { g.font = '10px ' + th.mono; g.textAlign = 'center'; g.textBaseline = 'middle'; }
      const s2 = hex(th.surface2), mk = hex(th.masked), mu = hex(th.muted), ink = th.inkHex;
      for (let i = 0; i < R; i++) {
        const y = i * (ch + GAP);
        for (let j = 0; j < C; j++) {
          const k = i * C + j, v = d[k], x = j * (cw + GAP);
          if (k >= this._revealed) { g.fillStyle = s2; g.fillRect(x, y, cw, ch); continue; }
          if (v === -Infinity) {
            g.fillStyle = s2; g.fillRect(x, y, cw, ch);
            g.save(); g.beginPath(); g.rect(x, y, cw, ch); g.clip();
            g.strokeStyle = mk; g.lineWidth = 1.5; g.beginPath();
            for (let o = -ch; o < cw + ch; o += 5) { g.moveTo(x + o, y); g.lineTo(x + o + ch, y + ch); }
            g.stroke(); g.restore();
            if (vals) {
              // placa del color de fondo detrás del texto: el rayado no cruza los glifos
              g.font = '600 11px ' + th.mono;
              const tw = g.measureText('−∞').width + 4;
              g.fillStyle = s2; g.fillRect(x + (cw - tw) / 2, y + ch / 2 - 7, tw, 14);
              g.fillStyle = ink; g.fillText('−∞', x + cw / 2, y + ch / 2 + 0.5);
              g.font = '10px ' + th.mono;
            }
            continue;
          }
          const rgb = noColor ? th.surface : rgbOf(v, sc);
          g.fillStyle = hex(rgb);
          g.fillRect(x, y, cw, ch);
          if (vals) { g.fillStyle = v === 0 ? mu : textOn(rgb); g.fillText(fmt(v), x + cw / 2, y + ch / 2 + 0.5); }
        }
      }
    }

    // ---- tamaño
    _fixedCell(cell) {
      const w = typeof cell === 'number' ? cell : cell.w;
      const h = typeof cell === 'number' ? cell : cell.h || cell.w;
      const vals = this.opts.showValues === true || (this.opts.showValues === 'auto' && w >= this.valW);
      this._applySize(w, h, vals);
    }
    _applySize(w, h, vals) {
      this.cellW = w; this.cellH = h; this.valuesShown = vals;
      this.grid.style.setProperty('--cw', w + 'px');
      this.grid.style.setProperty('--ch', h + 'px');
      this.el.classList.toggle('hm--vals', !!vals);
      // solo se giran las etiquetas de columna que no caben (p. ej. «<s>»); las cortas siguen horizontales
      let vert = false;
      const L = this.colLabels;
      for (let j = 0; j < this.colHeads.length; j++) {
        const lab = L && L[j] != null ? String(L[j]) : null;
        const on = !!lab && Math.ceil(lab.length * LAB_W + 6) > w + 1;
        this.colHeads[j].classList.toggle('is-vert', on);
        if (on) vert = true;
      }
      this.el.classList.toggle('hm--vert', vert);
      const tiny = w < 16;
      this.el.classList.toggle('hm--tiny', tiny);
      // celdas diminutas con índices numéricos: solo se rotula cada 5.ª columna (y la última)
      if (!L) {
        const idxW = String(this.C - 1 + this.colOffset).length * 5.8 + 2;
        const sparse = tiny && idxW > w;
        for (let j = 0; j < this.colHeads.length; j++) this.colHeads[j].classList.toggle('is-skip', sparse && j % 5 !== 0 && j !== this.C - 1);
      }
      // matriz entera de ceros solo con color: sin un rótulo parecería que no se dibujó
      if (this._allZero) this._zeroNote.hidden = !!vals;
      if (this.canvasMode) this._draw();
    }
    // ancho natural del mapa con celdas de ancho w
    // (cada columna ocupa w + GAP: la rejilla tiene 1 px de separación entre celdas)
    widthFor(w) { return this.rhW + this.C * (w + GAP) + 4; }
    // tamaño de celda que usaría con un ancho disponible `avail`
    sizeFor(avail) {
      const sv = this.opts.showValues;
      const cw = Math.floor((avail - this.rhW - 4) / Math.max(1, this.C)) - GAP;
      const compact = this.opts.stretch === false;
      // en modo compacto (vistas), las matrices altas (≥ 12 filas) van solo con color: los números, en el inspector
      const tall = compact && this.R >= 12;
      if (sv === true || (sv !== false && !tall && cw >= this.valW)) {
        if (!compact) return { w: Math.max(this.valW, Math.min(MAX_W, cw)), h: VAL_H, vals: true };
        return { w: cw >= this.prefW ? this.prefW : this.valW, h: VAL_H, vals: true };
      }
      const smax = compact ? (this.R >= 16 ? 16 : 18) : SQ_MAX;
      const sz = Math.max(MIN_C, Math.min(smax, cw));
      return { w: sz, h: sz, vals: false };
    }
    fit(avail, force) {
      if (this._destroyed || !(avail > 0)) return this;
      this._lastFit = avail;
      const s = force || this.sizeFor(avail);
      this._applySize(s.w, s.h, s.vals);
      return this;
    }
    _autoFit() {
      const go = () => {
        if (this._destroyed) return;
        const target = this.opts.fitTo || this.el.parentElement;
        if (!target) { this.fit(480); return; }
        const cs = getComputedStyle(target);
        const w = target.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
        this.fit(w > 0 ? w : 480);
        observeFit(this, target);
      };
      this.fit(480);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); else go();
    }

    // ---- resaltados
    _band(r0, c0, r1, c1, cls, list, colorVar) {
      const b = doc.createElement('div');
      b.className = 'hm__band ' + cls;
      b.setAttribute('aria-hidden', 'true');
      b.style.gridArea = r0 + ' / ' + c0 + ' / ' + r1 + ' / ' + c1;
      if (colorVar) b.style.setProperty('--band', colorVar.startsWith('--') ? 'var(' + colorVar + ')' : colorVar);
      this.grid.appendChild(b);
      list.push(b);
      return b;
    }
    highlightCell(i, j, cls) {
      if (i < 0 || j < 0 || i >= this.R || j >= this.C) return this;
      this._band(i + 2, j + 2, i + 3, j + 3, 'hm__hl-' + (cls || 'hl') + ' hm__band--cell', this._bands);
      return this;
    }
    highlightRow(i, cls) {
      if (i < 0 || i >= this.R) return this;
      this._band(i + 2, 1, i + 3, this.C + 2, 'hm__hl-' + (cls || 'src') + ' hm__band--row', this._bands);
      const h = this.rowHeads[i]; if (h) { h.classList.add('is-hl'); this._hlHead.push(h); }
      return this;
    }
    highlightCol(j, cls) {
      if (j < 0 || j >= this.C) return this;
      this._band(1, j + 2, this.R + 2, j + 3, 'hm__hl-' + (cls || 'src') + ' hm__band--col', this._bands);
      const h = this.colHeads[j]; if (h) { h.classList.add('is-hl'); this._hlHead.push(h); }
      return this;
    }
    // rango rectangular [i0,i1) × [j0,j1)
    highlightRange(i0, j0, i1, j1, cls) {
      this._band(i0 + 2, j0 + 2, i1 + 2, j1 + 2, 'hm__hl-' + (cls || 'src') + ' hm__band--rect', this._bands);
      return this;
    }
    clear() {
      for (const b of this._bands) b.remove();
      this._bands.length = 0;
      for (const h of this._hlHead) h.classList.remove('is-hl');
      this._hlHead.length = 0;
      return this;
    }
    mark(i, j, cls) { this._band(i + 2, j + 2, i + 3, j + 3, 'hm__mk-' + (cls || 'pin') + ' hm__band--cell', this._marks); return this; }
    markRow(i, cls) { this._band(i + 2, 1, i + 3, this.C + 2, 'hm__mk-' + (cls || 'pin') + ' hm__band--row', this._marks); return this; }
    markCol(j, cls) { this._band(1, j + 2, this.R + 2, j + 3, 'hm__mk-' + (cls || 'pin') + ' hm__band--col', this._marks); return this; }
    clearMarks() { for (const b of this._marks) b.remove(); this._marks.length = 0; return this; }

    // ---- interacción
    _elAt(i, j) {
      if (i >= 0 && j >= 0) return this.cells[i * this.C + j];
      if (i === -1 && j >= 0) return this.colHeads[j];
      if (j === -1 && i >= 0) return this.rowHeads[i];
      return null;
    }
    _posOf(t) {
      if (!t) return null;
      if (t.classList.contains('hm__c')) { const k = +t.dataset.k; return [Math.floor(k / this.C), k % this.C]; }
      if (t.classList.contains('hm__rh')) return [+t.dataset.i, -1];
      if (t.classList.contains('hm__ch')) return [-1, +t.dataset.j];
      return null;
    }
    _fire(i, j) {
      const key = i + ',' + j;
      if (this._lastHover === key) return;
      this._lastHover = key;
      if (this._stale) { theme = null; this.paint(); live.add(this); }
      const v = i >= 0 && j >= 0 ? this.mat.d[i * this.C + j] : null;
      if (typeof this.opts.onHover === 'function') this.opts.onHover(i, j, v);
    }
    _ariaFor(i, j) {
      const lab = this.ref.label || this.ref.key || '';
      const rl = this.rowLabels && this.rowLabels[i] != null ? ' «' + this.rowLabels[i] + '»' : '';
      const cl = this.colLabels && this.colLabels[j] != null ? ' «' + this.colLabels[j] + '»' : '';
      if (i >= 0 && j >= 0) return lab + ', fila ' + (i + this.rowOffset) + rl + ', columna ' + (j + this.colOffset) + cl + ': ' + fmtFull(this.mat.d[i * this.C + j]);
      if (j === -1) return lab + ', cabecera de la fila ' + (i + this.rowOffset) + rl;
      return lab + ', cabecera de la columna ' + (j + this.colOffset) + cl;
    }
    // dispara onHover como si el cursor estuviera sobre (i, j) (j = −1: cabecera de fila; i = −1: de columna)
    hover(i, j) { this._lastHover = null; this._fire(i, j); return this; }
    // cursor virtual del modo canvas
    _cvFocus(i, j, announce) {
      i = Math.max(0, Math.min(this.R - 1, i)); j = Math.max(0, Math.min(this.C - 1, j));
      this._fi = i; this._fj = j;
      if (!this._focusBand) { this._focusBand = doc.createElement('div'); this._focusBand.className = 'hm__band hm__band--focus'; this._focusBand.setAttribute('aria-hidden', 'true'); }
      this._focusBand.style.gridArea = (i + 2) + ' / ' + (j + 2) + ' / ' + (i + 3) + ' / ' + (j + 3);
      if (!this._focusBand.parentNode) this.grid.appendChild(this._focusBand);
      if (announce && this.liveEl) this.liveEl.textContent = this._ariaFor(i, j);
      this._lastHover = null;
      this._fire(i, j);
      if (announce) keepInView(this._focusBand);
    }
    focusCell(i, j) {
      if (this.canvasMode) { this.canvas.focus({ preventScroll: true }); this._cvFocus(i, j, true); return; }
      const el = this._elAt(i, j);
      if (!el) return;
      const prev = this._elAt(this._fi, this._fj);
      if (prev && prev !== el) prev.tabIndex = -1;
      el.tabIndex = 0;
      this._fi = i; this._fj = j;
      el.focus({ preventScroll: false });
      keepInView(el);
    }
    _bind() {
      const g = this.grid;
      this._onOver = (e) => {
        const t = e.target.closest && e.target.closest('.hm__c, .hm__rh, .hm__ch');
        if (!t || !g.contains(t)) return;
        const p = this._posOf(t);
        if (p) this._fire(p[0], p[1]);
      };
      this._onLeave = () => {
        if (g.contains(doc.activeElement)) return;
        this._lastHover = null;
        if (typeof this.opts.onLeave === 'function') this.opts.onLeave();
      };
      this._onFocusIn = (e) => {
        const p = this._posOf(e.target);
        if (!p) return;
        const prev = this._elAt(this._fi, this._fj);
        if (prev && prev !== e.target) prev.tabIndex = -1;
        e.target.tabIndex = 0;
        this._fi = p[0]; this._fj = p[1];
        e.target.setAttribute('aria-label', this._ariaFor(p[0], p[1]));
        this._lastHover = null;
        this._fire(p[0], p[1]);
        keepInView(e.target);
      };
      this._onFocusOut = (e) => {
        if (e.relatedTarget && g.contains(e.relatedTarget)) return;
        this._lastHover = null;
        if (typeof this.opts.onLeave === 'function') this.opts.onLeave();
      };
      this._onKey = (e) => {
        if (this.canvasMode) return; // el canvas tiene su propio manejador
        let i = this._fi, j = this._fj;
        const R = this.R, C = this.C;
        switch (e.key) {
          case 'ArrowRight': j = Math.min(C - 1, j + 1); break;
          case 'ArrowLeft': j = Math.max(i === -1 ? 0 : -1, j - 1); break;
          case 'ArrowDown': i = Math.min(R - 1, i + 1); break;
          case 'ArrowUp': i = Math.max(j === -1 ? 0 : -1, i - 1); break;
          case 'Home': if (e.ctrlKey || e.metaKey) { i = 0; j = 0; } else j = i === -1 ? 0 : -1; break;
          case 'End': if (e.ctrlKey || e.metaKey) { i = R - 1; j = C - 1; } else j = C - 1; break;
          default: return;
        }
        if (i === -1 && j === -1) return;
        e.preventDefault();
        this.focusCell(i, j);
      };
      if (this.canvasMode) {
        const cv = this.canvas;
        const at = (e) => {
          const r = cv.getBoundingClientRect();
          const j = Math.floor((e.clientX - r.left) / (this.cellW + GAP)), i = Math.floor((e.clientY - r.top) / (this.cellH + GAP));
          return [Math.max(0, Math.min(this.R - 1, i)), Math.max(0, Math.min(this.C - 1, j))];
        };
        this._cvMove = (e) => { const p = at(e); this._fire(p[0], p[1]); };
        this._cvFocusIn = () => this._cvFocus(this._fi >= 0 ? this._fi : 0, this._fj >= 0 ? this._fj : 0, true);
        this._cvBlur = () => { if (this._focusBand) this._focusBand.remove(); this._lastHover = null; if (typeof this.opts.onLeave === 'function') this.opts.onLeave(); };
        this._cvKey = (e) => {
          let i = this._fi, j = this._fj;
          switch (e.key) {
            case 'ArrowRight': j++; break;
            case 'ArrowLeft': j--; break;
            case 'ArrowDown': i++; break;
            case 'ArrowUp': i--; break;
            case 'Home': if (e.ctrlKey || e.metaKey) i = 0; j = 0; break;
            case 'End': if (e.ctrlKey || e.metaKey) i = this.R - 1; j = this.C - 1; break;
            default: return;
          }
          e.preventDefault();
          this._cvFocus(i, j, true);
        };
        cv.addEventListener('mousemove', this._cvMove);
        cv.addEventListener('click', this._cvMove);
        cv.addEventListener('focus', this._cvFocusIn);
        cv.addEventListener('blur', this._cvBlur);
        cv.addEventListener('keydown', this._cvKey);
      }
      g.addEventListener('mouseover', this._onOver);
      g.addEventListener('click', this._onOver);
      g.addEventListener('mouseleave', this._onLeave);
      g.addEventListener('focusin', this._onFocusIn);
      g.addEventListener('focusout', this._onFocusOut);
      g.addEventListener('keydown', this._onKey);
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      live.delete(this);
      unobserveFit(this);
      const g = this.grid;
      g.removeEventListener('mouseover', this._onOver);
      g.removeEventListener('click', this._onOver);
      g.removeEventListener('mouseleave', this._onLeave);
      g.removeEventListener('focusin', this._onFocusIn);
      g.removeEventListener('focusout', this._onFocusOut);
      g.removeEventListener('keydown', this._onKey);
      if (this.canvas) {
        const cv = this.canvas;
        cv.removeEventListener('mousemove', this._cvMove);
        cv.removeEventListener('click', this._cvMove);
        cv.removeEventListener('focus', this._cvFocusIn);
        cv.removeEventListener('blur', this._cvBlur);
        cv.removeEventListener('keydown', this._cvKey);
      }
      if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }
  }

  // ---------------------------------------------------------------- leyenda
  // items: [{ scale, names: ['X_emb', 'PE'], note }]
  function legend(items) {
    const box = doc.createElement('div');
    box.className = 'hm-legend';
    let hasMask = false;
    for (const it of items) {
      const sc = it.scale;
      if (!sc || sc.type === 'none') continue;
      const row = doc.createElement('div');
      row.className = 'hm-legend__item';
      const bar = doc.createElement('span');
      bar.className = 'hm-legend__bar hm-legend__bar--' + sc.type;
      bar.setAttribute('aria-hidden', 'true');
      const nums = doc.createElement('span');
      nums.className = 'hm-legend__nums';
      if (sc.type === 'sequential') nums.textContent = fmt(sc.lo) + ' → ' + fmtFull(sc.hi, 3);
      else nums.textContent = MINUS + fmtFull(sc.maxAbs, 3).replace(MINUS, '') + ' · 0 · ' + fmtFull(sc.maxAbs, 3);
      const names = doc.createElement('span');
      names.className = 'hm-legend__names';
      const n = it.names || [];
      names.textContent = (it.note ? it.note : n.length > 1 ? 'escala compartida: ' : 'escala propia: ') + n.join(', ');
      row.append(bar, nums, names);
      box.appendChild(row);
      if (it.masked) hasMask = true;
    }
    if (hasMask) {
      const row = doc.createElement('div');
      row.className = 'hm-legend__item';
      row.innerHTML = '<span class="hm-legend__sw is-ninf" aria-hidden="true"></span><span class="hm-legend__names">rayado = ' + MINUS + '∞ (posición enmascarada: el futuro)</span>';
      box.appendChild(row);
    }
    return box;
  }

  TL.Heatmap = {
    create: (ref, opts) => new Heatmap(ref, opts),
    config: CONFIG,
    Heatmap,
    fmt,
    fmtFull,
    legend,
    axisSym,
    axisName: (ax) => AXNAME[ax] || '',
    colorOf,
    textOn: (hexStr) => textOn(parseColor(hexStr) || [255, 255, 255]),
    recolorAll,
    _theme: () => readTheme(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
