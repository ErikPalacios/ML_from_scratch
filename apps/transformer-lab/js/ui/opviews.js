/* =============================================================================
   Transformer Lab — js/ui/opviews.js
   TL.OpViews: una vista por tipo de paso (spec §5.1 / §9.3). Cada vista dibuja la operación como
   una ECUACIÓN de matrices (mapas de calor → símbolos → resultado), una línea de «flujo de
   dimensiones» encima y extras propios del tipo (grafo de atención, curvas, barras…).

   API
     const view = TL.OpViews.render(step, containerEl, ctx)
       ctx = { onInspect(html),    // HTML del inspector (título, fórmula \[…\] y cuentas); el shell
                                   //   lo compone con TL.MathTex.typeset
               showValues,         // true | false | 'auto' (por defecto 'auto')
               animateSpeed,       // ms por celda en las animaciones (por defecto 70)
               cfg, tok,           // config del modelo y tokenizador (PE, activación, objetivos…)
               steps?, targetTokens?,  // opcionales: para mostrar el objetivo en el softmax de salida
               content? }          // no se usa (la explicación larga la muestra el shell)
     view.animate() -> Promise     // animación propia del tipo (barrido del matmul, softmax por filas…)
     view.destroy()
     view.el, view.heatmaps        // extra
   Extras: TL.OpViews.kinds (tipos con vista propia), TL.OpViews.renderers (extensible).
   Índices desde 0 en todas las vistas (como en NumPy y en el código del motor).
   ========================================================================== */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const doc = root.document;
  const MINUS = '−';

  // ------------------------------------------------------------------ utilidades
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const f3 = (x) => TL.Heatmap.fmt(x);
  const f4 = (x, s) => TL.Heatmap.fmtFull(x, s || 4);
  const par = (x) => (x < 0 ? '(' + f4(x) + ')' : f4(x));
  const pct = (x) => (x * 100).toFixed(x >= 0.1 ? 0 : 1) + ' %';
  // número para LaTeX (1.2e−4 → 1.2\cdot 10^{-4})
  function texNum(x) {
    if (x === -Infinity) return '-\\infty';
    if (x === Infinity) return '\\infty';
    const s = f4(x).replace(/−/g, '-');
    const m = s.match(/^(-?[\d.]+)e(-?\d+)$/);
    return m ? m[1] + '\\cdot 10^{' + m[2] + '}' : s;
  }
  const at = (tex, i, j) => '{' + tex + '}[' + i + ',' + j + ']';
  const at1 = (tex, i) => '{' + tex + '}[' + i + ']';
  const SUBD = '₀₁₂₃₄₅₆₇₈₉';
  const sub = (n) => String(n).split('').map((c) => SUBD[+c] || c).join('');
  const cellLab = (ref, i, j) => (ref.label || ref.key) + '[' + i + ', ' + j + ']';

  function el(tag, cls, html) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function texSpan(latex, cls, display, lite) {
    const s = el('span', cls);
    if (TL.MathTex) TL.MathTex.render(latex, s, { display: !!display, lite: !!lite }); else s.textContent = latex;
    return s;
  }
  function mkRef(o) {
    return { key: o.key, tex: o.tex, label: o.label, mat: o.mat, role: o.role || 'act', rowAxis: o.rowAxis, colAxis: o.colAxis,
      rowLabels: o.rowLabels || null, colLabels: o.colLabels || null, colOffset: o.colOffset || 0 };
  }
  function maxAbsOf(list) {
    let m = 0;
    for (const r of list) if (r) { const a = (r.mat || r).maxAbs(); if (a > m) m = a; }
    return m > 0 ? m : 1;
  }
  const Mat = () => TL.Mat;
  const isAttnRef = (ref) => ref && ref.rowAxis === 'T' && ref.colAxis === 'T';
  const tokQ = (s) => '«' + s + '»';

  // descripción de la posición de una celda para el inspector
  function where(ref, i, j) {
    const parts = [];
    const attn = isAttnRef(ref);
    const tr = attn && /\\top/.test(ref.tex || ''); // matriz de atención traspuesta: filas = claves
    if (i >= 0) {
      const rl = ref.rowLabels && ref.rowLabels[i] != null ? ' ' + tokQ(ref.rowLabels[i]) : '';
      parts.push((attn ? (tr ? 'clave ' : 'consulta ') : 'fila ') + i + rl);
    }
    if (j >= 0) {
      const cl = ref.colLabels && ref.colLabels[j] != null ? ' ' + tokQ(ref.colLabels[j]) : '';
      const abs = ref.colOffset ? ' (columna ' + (j + ref.colOffset) + ' de la matriz completa)' : '';
      parts.push((attn ? (tr ? 'consulta ' : 'clave ') : 'columna ') + j + cl + abs);
    }
    return parts.join(' · ');
  }

  // HTML del inspector
  function insp(o) {
    let h = '<div class="insp" data-kind="' + esc(o.kind || '') + '">';
    h += '<div class="insp__head"><span class="insp__title">' + esc(o.title) + '</span>';
    if (o.sub) h += '<span class="insp__sub">' + esc(o.sub) + '</span>';
    h += '</div>';
    if (o.tex) h += '<div class="insp__tex">\\[' + o.tex + '\\]</div>';
    if (o.rows && o.rows.length) {
      h += '<div class="insp__rows">';
      for (const r of o.rows) {
        if (typeof r === 'string') h += '<div class="insp__num">' + esc(r) + '</div>';
        else h += '<div class="insp__row"><span class="insp__k">' + esc(r[0]) + '</span><span class="insp__v">' + esc(r[1]) + '</span></div>';
      }
      h += '</div>';
    }
    if (o.note) h += '<p class="insp__note">' + o.note + '</p>';
    return h + '</div>';
  }
  // suma larga con todos los términos: "a + b + … = s"
  const sumStr = (terms) => (terms.length ? terms.join(' + ') : '0');

  const MIN_CELL = 12;
  const reduceMotion = () => { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  // ------------------------------------------------------------------ mini gráfico en canvas
  const plots = new Set();
  let plotWatch = false;
  function watchPlots() {
    if (plotWatch || !doc) return;
    plotWatch = true;
    const redraw = () => requestAnimationFrame(() => { for (const p of Array.from(plots)) { if (!p.canvas.isConnected) { plots.delete(p); continue; } p.draw(); } });
    try { new MutationObserver(redraw).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); } catch (e) { /* nada */ }
    try { const mq = root.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener ? mq.addEventListener('change', redraw) : mq.addListener(redraw); } catch (e) { /* nada */ }
  }
  class MiniPlot {
    // o: { x: [min,max], y: [min,max], xLabel, yLabel, xTicks, height, layers: [(g, api) => void], ariaLabel }
    constructor(o) {
      this.o = o;
      this.canvas = el('canvas', 'ov-plot');
      this.canvas.setAttribute('role', 'img');
      this.canvas.setAttribute('aria-label', o.ariaLabel || '');
      this.canvas.style.height = (o.height || 180) + 'px';
      plots.add(this);
      watchPlots();
      if (typeof ResizeObserver !== 'undefined') {
        this.ro = new ResizeObserver(() => { if (this.canvas.clientWidth !== this._w) this.draw(); });
        this.ro.observe(this.canvas);
      }
    }
    draw() {
      const c = this.canvas;
      const W = c.clientWidth, Hh = c.clientHeight;
      if (!W || !Hh) return;
      this._w = W;
      const dpr = root.devicePixelRatio || 1;
      c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, Hh);
      const cs = getComputedStyle(c);
      const cv = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
      const mono = cv('--font-mono', 'monospace');
      const o = this.o;
      const m = { l: 36, r: 10, t: o.yLabel ? 20 : 8, b: o.xLabel ? 30 : 18 };
      const pw = W - m.l - m.r, ph = Hh - m.t - m.b;
      const sx = (x) => m.l + ((x - o.x[0]) / (o.x[1] - o.x[0])) * pw;
      const sy = (y) => m.t + (1 - (y - o.y[0]) / (o.y[1] - o.y[0])) * ph;
      const ticks = (a, b, n) => (TL.Charts && TL.Charts.niceTicks ? TL.Charts.niceTicks(a, b, n) : [a, (a + b) / 2, b]);
      const tv = (t) => (Array.isArray(t) ? t : t && t.ticks ? t.ticks : []);
      g.font = '10px ' + mono;
      g.lineWidth = 1;
      // rejilla y ejes
      g.strokeStyle = cv('--rule', '#ccc');
      g.fillStyle = cv('--muted', '#666');
      g.textAlign = 'right'; g.textBaseline = 'middle';
      for (const y of tv(ticks(o.y[0], o.y[1], 4))) {
        if (y < o.y[0] - 1e-9 || y > o.y[1] + 1e-9) continue;
        g.beginPath(); g.moveTo(m.l, Math.round(sy(y)) + 0.5); g.lineTo(W - m.r, Math.round(sy(y)) + 0.5); g.stroke();
        g.fillText(TL.Heatmap.fmt(+y.toFixed(6)), m.l - 4, sy(y));
      }
      g.textAlign = 'center'; g.textBaseline = 'top';
      const xt = o.xTicks || tv(ticks(o.x[0], o.x[1], 6));
      for (const x of xt) {
        if (x < o.x[0] - 1e-9 || x > o.x[1] + 1e-9) continue;
        g.fillText(TL.Heatmap.fmt(+x.toFixed(6)), sx(x), Hh - m.b + 4);
      }
      // ejes en 0
      g.strokeStyle = cv('--rule-strong', '#999');
      if (o.y[0] < 0 && o.y[1] > 0) { g.beginPath(); g.moveTo(m.l, Math.round(sy(0)) + 0.5); g.lineTo(W - m.r, Math.round(sy(0)) + 0.5); g.stroke(); }
      if (o.x[0] < 0 && o.x[1] > 0) { g.beginPath(); g.moveTo(Math.round(sx(0)) + 0.5, m.t); g.lineTo(Math.round(sx(0)) + 0.5, m.t + ph); g.stroke(); }
      if (o.xLabel) { g.fillStyle = cv('--muted', '#666'); g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(o.xLabel, W - m.r, Hh - 1); }
      if (o.yLabel) { g.fillStyle = cv('--muted', '#666'); g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(o.yLabel, 4, 2); }
      g.save();
      g.beginPath(); g.rect(m.l, m.t - 4, pw, ph + 8); g.clip();
      const api = { sx, sy, cv, W, H: Hh, m, pw, ph };
      for (const L of o.layers) L(g, api);
      g.restore();
    }
    destroy() { plots.delete(this); if (this.ro) this.ro.disconnect(); }
  }
  function curve(g, api, f, x0, x1, n) {
    g.beginPath();
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n, y = f(x);
      const X = api.sx(x), Y = api.sy(y);
      k ? g.lineTo(X, Y) : g.moveTo(X, Y);
    }
    g.stroke();
  }
  function dot(g, x, y, r, fill, stroke) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.5; g.stroke(); }
  }
  function alpha(color, a) {
    const m = String(color).trim().match(/^#([0-9a-f]{6})$/i);
    if (!m) return color;
    const h = m[1];
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }

  // ------------------------------------------------------------------ vista
  class Line {
    constructor(view, label) {
      this.view = view;
      this.el = el('div', 'ov-line');
      if (label) this.el.appendChild(el('div', 'ov-line__label', label));
      this.eq = el('div', 'ov-eq');
      this.el.appendChild(this.eq);
      this.hms = [];
      this.ops = [];
      this.n = 0;
    }
    _op(o) {
      if (o == null) return null;
      let e;
      if (o === '·') { e = el('span', 'ov-op ov-op--dot'); e.title = 'producto matricial'; }
      else if (typeof o === 'string') { e = el('span', 'ov-op'); e.textContent = o; }
      else if (o.tex) { e = texSpan(o.tex, 'ov-op ov-op--tex'); }
      else if (o.word) { e = el('span', 'ov-op ov-op--word'); e.textContent = o.word; if (o.title) e.title = o.title; }
      else if (o.html) { e = el('span', 'ov-op ov-op--word', o.html); }
      e.setAttribute('aria-hidden', o && o.label ? 'false' : 'true');
      this.ops.push(e);
      return e;
    }
    // un término (mapa de calor) con su operador delante (el operador nunca queda solo al final de una línea)
    term(hm, op, after) {
      const g = el('div', 'ov-term');
      const a = this._op(op);
      if (a) g.appendChild(a);
      g.appendChild(hm.el);
      const b = this._op(after);
      if (b) g.appendChild(b);
      this.eq.appendChild(g);
      this.hms.push(hm);
      hm._termOps = [a, b].filter(Boolean);
      this.n++;
      return this;
    }
    op(o) { const e = this._op(o); const g = el('div', 'ov-term ov-term--op'); g.appendChild(e); this.eq.appendChild(g); this.n++; return this; }
    node(elm, op) {
      const g = el('div', 'ov-term');
      const a = this._op(op);
      if (a) g.appendChild(a);
      g.appendChild(elm);
      this.eq.appendChild(g);
      this.n++;
      return this;
    }
    // fase de lectura (todas las líneas antes de escribir nada: evita reflujos repetidos)
    measure() {
      const hms = this.hms;
      const opsOf = (h) => { let w = 0; for (const o of h._termOps || []) w += o.offsetWidth + 8; return w; };
      let loose = 0;
      for (const o of this.ops) if (!hms.some((h) => (h._termOps || []).indexOf(o) >= 0)) loose += o.offsetWidth + 8;
      return { ow: hms.map(opsOf), loose };
    }
    layout(W, meas) {
      const hms = this.hms;
      if (!hms.length) return;
      const sv = this.view.showValues;
      const m = meas || this.measure();
      let fixed = 12 * Math.max(0, this.n - 1) + m.loose;
      let totalC = 0, needW = 0, prefW = 0, maxR = 0;
      const ow = m.ow;
      hms.forEach((h, k) => { fixed += h.rhW + 10 + ow[k]; totalC += h.C; needW = Math.max(needW, h.valW); prefW = Math.max(prefW, h.prefW); maxR = Math.max(maxR, h.R); });
      const cw = Math.floor((W - fixed) / Math.max(1, totalC));
      // A · toda la ecuación en una línea, con números
      if (sv !== false && cw >= needW) {
        const w = Math.min(Math.max(needW, 46, prefW), cw);
        for (const h of hms) h.fit(W, { w: Math.max(w, h.valW), h: 22, vals: true });
        return;
      }
      // líneas que harían falta con números (empaquetado voraz)
      let lines = 1, x = 0;
      hms.forEach((h, k) => {
        const tw = ow[k] + h.widthFor(Math.min(h.prefW, Math.max(h.valW, Math.floor((W - ow[k] - h.rhW) / h.C)))) + 12;
        if (x && x + tw > W) { lines++; x = 0; }
        x += tw;
      });
      // B · toda la ecuación en una línea, solo color (si con números ocuparía demasiado)
      const sq = Math.min(18, cw);
      if (sv !== true && sq >= 13 && (sv === false || maxR >= 10 || lines >= 3)) {
        for (const h of hms) h.fit(W, { w: sq, h: sq, vals: false });
        return;
      }
      // C · cada término por separado: su mapa cabe en el ancho menos el de sus operadores
      // (si el operador es ancho y el mapa no cabe a su lado, el operador pasa arriba y el mapa usa todo el ancho)
      hms.forEach((h, k) => {
        const beside = W - ow[k] - 4;
        const wraps = ow[k] > 48 && beside < h.widthFor(h.valW) && W - 4 >= h.widthFor(Math.max(MIN_CELL, Math.floor((beside - h.rhW) / h.C)) + 8);
        h.fit(Math.max(120, wraps ? W - 4 : beside));
      });
    }
  }

  class View {
    constructor(step, host, ctx) {
      this.step = step;
      this.ctx = ctx || {};
      this.host = host;
      this.showValues = this.ctx.showValues === undefined ? 'auto' : this.ctx.showValues;
      this.speed = Math.max(1, +this.ctx.animateSpeed || 70);
      this.hms = [];
      this.lines = [];
      this.handlers = new Map();
      this.clearHooks = [];
      this.cleanups = [];
      this.layoutHooks = [];
      this.legendItems = null;
      this.primary = null;
      this.animator = null;
      const r = el('div', 'ov');
      r.dataset.kind = step.kind || 'generic';
      r.dataset.phase = step.phase || 'forward';
      this.root = r;
      this.flowEl = el('div', 'ov-flow');
      this.body = el('div', 'ov-body');
      this.extras = el('div', 'ov-extras');
      this.foot = el('div', 'ov-foot');
      r.append(this.flowEl, this.body, this.extras, this.foot);
    }
    // --- piezas
    hm(ref, opts, onCell) {
      const o = Object.assign({ fit: false, stretch: false, showValues: this.showValues }, opts || {});
      const hm = TL.Heatmap.create(ref, Object.assign(o, {
        onHover: (i, j, v) => this.hover(hm, i, j, v),
        onLeave: () => {},
      }));
      this.hms.push(hm);
      if (onCell) this.handlers.set(hm, onCell);
      return hm;
    }
    line(label) { const L = new Line(this, label); this.lines.push(L); this.body.appendChild(L.el); return L; }
    card(title, cls) {
      const c = el('section', 'ov-card' + (cls ? ' ' + cls : ''));
      if (title) c.appendChild(el('h4', 'ov-card__title', title));
      const b = el('div', 'ov-card__body');
      c.appendChild(b);
      this.extras.appendChild(c);
      return b;
    }
    note(html, cls) { const n = el('p', 'ov-note' + (cls ? ' ' + cls : ''), html); this.foot.appendChild(n); return n; }
    // línea de flujo de dimensiones: items = refs | strings (operadores) | {text, shape}
    flow(items, meta) {
      const f = this.flowEl;
      const eq = el('span', 'ov-flow__eq');
      for (const it of items) {
        if (it == null || it === false) continue;
        if (typeof it === 'string') { eq.appendChild(el('span', 'ov-flow__op', esc(it))); continue; }
        const t = el('span', 'ov-flow__t');
        if (it.mat) {
          t.appendChild(texSpan(it.tex, 'ov-flow__name', false, true));
          t.appendChild(el('span', 'ov-flow__shape', it.mat.r + '×' + it.mat.c));
        } else {
          if (it.tex) t.appendChild(texSpan(it.tex, 'ov-flow__name', false, true));
          if (it.text) t.appendChild(el('span', 'ov-flow__name ov-flow__txt', esc(it.text)));
          if (it.shape) t.appendChild(el('span', 'ov-flow__shape', esc(it.shape)));
        }
        eq.appendChild(t);
      }
      f.appendChild(eq);
      if (meta) f.appendChild(el('span', 'ov-flow__meta', meta));
    }
    // leyenda: grupos de escala (se deducen de los mapas si no se dan)
    legend(items) { this.legendItems = items; }
    _buildLegend() {
      let items = this.legendItems;
      if (!items) {
        const groups = new Map();
        let masked = false;
        for (const h of this.hms) {
          const sc = h.scale;
          if (sc.type === 'none') continue;
          for (let k = 0; k < h.mat.d.length; k++) if (h.mat.d[k] === -Infinity) { masked = true; break; }
          const role = h.ref.role;
          let key;
          if (role === 'mask') key = 'mask';
          else if (sc.type === 'sequential') key = role === 'prob' ? 'seq:prob' : role === 'onehot' ? 'seq:01' : 'seq:own' + this.hms.indexOf(h);
          else key = sc.shared ? 'div:' + sc.maxAbs : 'div:own';
          if (!groups.has(key)) groups.set(key, { scale: sc, names: [], own: key === 'div:own', key });
          const g = groups.get(key);
          const nm = h.ref.label || h.ref.key;
          if (g.names.indexOf(nm) < 0) g.names.push(nm);
        }
        items = [];
        for (const g of groups.values()) {
          if (g.key === 'mask') continue; // la máscara se explica con la fila del rayado
          if (g.own) items.push({ scale: g.scale, names: g.names, own: true });
          else if (g.key === 'seq:prob') items.push({ scale: g.scale, names: g.names, note: 'probabilidades (0 → 1): ' });
          else if (g.key === 'seq:01') items.push({ scale: g.scale, names: g.names, note: 'valores 0 / 1: ' });
          else items.push({ scale: g.scale, names: g.names });
        }
        if (groups.has('mask')) masked = true;
        if (masked && items.length) items[items.length - 1].masked = true;
      }
      const box = el('div', 'ov-legend');
      const L = TL.Heatmap.legend(items.filter((x) => !x.own));
      for (const it of items.filter((x) => x.own)) {
        const row = el('div', 'hm-legend__item');
        row.innerHTML = '<span class="hm-legend__bar hm-legend__bar--diverging" aria-hidden="true"></span>' +
          '<span class="hm-legend__nums">−máx · 0 · +máx</span><span class="hm-legend__names">escala propia de cada matriz: ' + esc(it.names.join(', ')) + '</span>';
        L.insertBefore(row, L.firstChild);
      }
      const idx = el('div', 'hm-legend__item hm-legend__item--plain', '<span class="hm-legend__names">Índices desde 0 · pasa el cursor (o usa las flechas) sobre una celda para ver su cuenta</span>');
      L.appendChild(idx);
      box.appendChild(L);
      this.foot.insertBefore(box, this.foot.firstChild);
    }
    // --- interacción
    hover(hm, i, j, v) {
      this.clearHl();
      const fn = this.handlers.get(hm) || genericCell;
      let html = null;
      try { html = fn.call(this, hm, i, j, v === undefined && i >= 0 && j >= 0 ? hm.mat.get(i, j) : v); } catch (e) { html = null; if (root.console) console.warn('OpViews: error en el inspector', e); }
      if (html) this.inspect(html);
    }
    inspect(html) { if (typeof this.ctx.onInspect === 'function') this.ctx.onInspect(html); }
    clearHl() { for (const h of this.hms) h.clear(); for (const f of this.clearHooks) f(); }
    // --- montaje y tamaño
    mount() {
      if (!this.legendDisabled) this._buildLegend();
      this.host.appendChild(this.root);
      this.layout();
      if (typeof ResizeObserver !== 'undefined') {
        let raf = 0;
        this.ro = new ResizeObserver(() => {
          if (raf) return;
          raf = requestAnimationFrame(() => { raf = 0; this.layout(); });
        });
        this.ro.observe(this.body);
      }
    }
    layout() {
      if (this.destroyed) return;
      const W = Math.floor(this.body.clientWidth);
      if (!(W > 0) || W === this._lastW) return;
      this._lastW = W;
      const meas = this.lines.map((L) => L.measure());
      this.lines.forEach((L, k) => L.layout(W, meas[k]));
      for (const f of this.layoutHooks) f(W);
    }
    // --- animación
    sleep(tok, ms) {
      return new Promise((res) => {
        if (tok.cancelled) { res(); return; }
        const t = setTimeout(res, ms);
        tok.stops.push(() => { clearTimeout(t); res(); });
      });
    }
    stopAnim() {
      const t = this._anim;
      if (!t) return;
      t.cancelled = true;
      for (const f of t.stops) f();
      t.stops = [];
      if (t.finish) t.finish();
      this._anim = null;
    }
    animate() {
      if (this.destroyed) return Promise.resolve();
      this.stopAnim();
      const tok = { cancelled: false, stops: [] };
      this._anim = tok;
      this.root.classList.add('is-animating');
      const fn = this.animator || defaultAnimator;
      return Promise.resolve()
        .then(() => fn.call(this, tok))
        .catch((e) => { if (root.console) console.warn('OpViews: animación interrumpida', e); })
        .then(() => {
          if (tok.finish) tok.finish();
          if (this._anim === tok) this._anim = null;
          this.root.classList.remove('is-animating');
        });
    }
    destroy() {
      if (this.destroyed) return;
      this.stopAnim();
      this.destroyed = true;
      if (this.ro) this.ro.disconnect();
      for (const h of this.hms) h.destroy();
      for (const f of this.cleanups) { try { f(); } catch (e) { /* nada */ } }
      if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
  }

  // barrido por defecto: la salida principal se rellena celda a celda (o fila a fila si es grande)
  async function defaultAnimator(tok) {
    const hm = this.primary;
    if (!hm) return;
    const R = hm.R, C = hm.C, N = R * C;
    tok.finish = () => { hm.reveal(); };
    hm.reveal(0);
    if (N <= 96) {
      for (let k = 0; k < N && !tok.cancelled; k++) {
        hm.reveal(k + 1);
        this.hover(hm, Math.floor(k / C), k % C);
        await this.sleep(tok, this.speed);
      }
    } else {
      const d = Math.max(150, Math.min(900, this.speed * 5));
      for (let i = 0; i < R && !tok.cancelled; i++) {
        hm.reveal((i + 1) * C);
        this.hover(hm, i, -1);
        await this.sleep(tok, d);
      }
    }
    hm.reveal();
  }

  // inspector genérico: valor de la celda
  function genericCell(hm, i, j, v) {
    const ref = hm.ref;
    if (i < 0 || j < 0) {
      if (j === -1) hm.highlightRow(i, 'hl'); else hm.highlightCol(j, 'hl');
      return insp({ title: (ref.label || ref.key) + (j === -1 ? ' · fila ' + i : ' · columna ' + j), sub: where(ref, i, j), rows: [] });
    }
    hm.highlightCell(i, j, 'hl');
    return insp({ title: cellLab(ref, i, j), sub: where(ref, i, j), tex: at(ref.tex, i, j) + ' = ' + texNum(v), rows: [['valor', f4(v, 6)]] });
  }

  // ------------------------------------------------------------------ renderizadores
  const R = {};

  // ---- matmul (forward y backward; con sesgo opcional)
  const MM_NOTES = {
    'fwd.attn.q': 'Cada fila de H (un token) se multiplica por la MISMA matriz W: todas las posiciones comparten parámetros.',
    'fwd.attn.k': 'Cada fila de H (un token) se multiplica por la MISMA matriz W: todas las posiciones comparten parámetros.',
    'fwd.attn.v': 'Cada fila de H (un token) se multiplica por la MISMA matriz W: todas las posiciones comparten parámetros.',
    'fwd.attn.scores': 'La entrada [i, j] es el producto escalar de la consulta del token i con la clave del token j: mide cuánto «encaja» j con lo que busca i. La matriz ya viene traspuesta (Kᵀ): su columna j es la fila j de K.',
    'fwd.attn.context': 'Cada fila de Z es una media ponderada de las filas de V, con los pesos de la misma fila de A (que suman 1).',
    'fwd.attn.proj': 'W_O mezcla las cabezas concatenadas: cada columna de O combina información de todas las cabezas.',
    'fwd.ffn1': 'El sesgo b₁ (una sola fila) se suma a cada fila del producto: broadcasting. La FFN trata cada token por separado.',
    'fwd.ffn2': 'El sesgo b₂ (una sola fila) se suma a cada fila: broadcasting. Vuelve de d_ff a d dimensiones.',
    'fwd.logits': 'Cada columna de W_out corresponde a un token del vocabulario: logits[t, v] mide cuánto apuesta la posición t por el token v.',
  };
  function mmNote(step, a, b) {
    if (MM_NOTES[step.tpl]) return MM_NOTES[step.tpl];
    if (step.phase === 'backward') {
      if (/\.dW$/.test(step.tpl) || /context\.dV|scores\.dK/.test(step.tpl)) {
        return 'Regla del producto matricial: si C = A·B, entonces dB = Aᵀ·dC. Cada entrada suma la contribución de todas las posiciones (las T filas).';
      }
      return 'Regla del producto matricial: si C = A·B, entonces dA = dC·Bᵀ: el gradiente vuelve por la misma matriz, traspuesta.';
    }
    return '';
  }
  R.matmul = function (v) {
    const s = v.step, ax = s.aux || {};
    const A = s.inputs[ax.a == null ? 0 : ax.a], B = s.inputs[ax.b == null ? 1 : ax.b];
    const bias = ax.bias != null ? s.inputs[ax.bias] : null;
    const C = s.outputs[0];
    const K = A.mat.c;
    const flops = s.flops != null ? s.flops : A.mat.r * K * B.mat.c;
    v.flow([A, '·', B, bias && '+', bias, '→', C],
      A.mat.r + '·' + K + '·' + B.mat.c + ' = ' + flops.toLocaleString('es-ES') + ' multiplicaciones y sumas');
    const L = v.line();
    const hA = v.hm(A, {}, cellA), hB = v.hm(B, {}, cellB);
    const hBias = bias ? v.hm(bias, {}, cellBias) : null;
    const hC = v.hm(C, {}, cellC);
    L.term(hA).term(hB, '·');
    if (hBias) L.term(hBias, '+');
    L.term(hC, '=');
    v.primary = hC;
    const n = mmNote(s, A, B);
    if (n) v.note(n);

    function cellC(hm, i, j) {
      if (i < 0 && j < 0) return null;
      if (j === -1) {
        hA.highlightRow(i, 'src'); hC.highlightRow(i, 'hl');
        return insp({ kind: 'matmul', title: (C.label || C.key) + ' · fila ' + i, sub: where(C, i, -1),
          tex: at1(C.tex, i) + ' = ' + at1(A.tex, i) + '\\,' + B.tex + (bias ? ' + ' + bias.tex : ''),
          rows: [['', 'La fila ' + i + ' de ' + (A.label || '') + ' (1×' + K + ') multiplicada por toda ' + (B.label || '') + ' (' + K + '×' + B.mat.c + ') da la fila ' + i + ' del resultado (1×' + C.mat.c + ').']] });
      }
      if (i === -1) {
        hB.highlightCol(j, 'src'); hC.highlightCol(j, 'hl'); if (hBias) hBias.highlightCell(0, j, 'src');
        return insp({ kind: 'matmul', title: (C.label || C.key) + ' · columna ' + j, sub: where(C, -1, j),
          tex: at(C.tex, ':', j) + ' = ' + A.tex + '\\,' + at(B.tex, ':', j) + (bias ? ' + ' + at1(bias.tex, j) : ''),
          rows: [['', 'Toda ' + (A.label || '') + ' (' + A.mat.r + '×' + K + ') por la columna ' + j + ' de ' + (B.label || '') + ' (' + K + '×1).']] });
      }
      hA.highlightRow(i, 'src'); hB.highlightCol(j, 'src'); hC.highlightCell(i, j, 'hl');
      if (hBias) hBias.highlightCell(0, j, 'src');
      const terms = [];
      let sum = 0;
      for (let k = 0; k < K; k++) {
        const a = A.mat.get(i, k), b = B.mat.get(k, j);
        terms.push(par(a) + '·' + par(b));
        sum += a * b;
      }
      const rows = [['Σₖ', '= ' + sumStr(terms)]];
      if (bias) rows.push(['+ sesgo', '= ' + f4(sum) + ' + ' + par(bias.mat.get(0, j))]);
      rows.push(['resultado', '= ' + f4(C.mat.get(i, j), 6)]);
      return insp({ kind: 'matmul', title: cellLab(C, i, j), sub: where(C, i, j),
        tex: at(C.tex, i, j) + ' = \\sum_{k=0}^{' + (K - 1) + '} ' + at(A.tex, i, 'k') + '\\,' + at(B.tex, 'k', j) + (bias ? ' + ' + at1(bias.tex, j) : ''),
        rows, note: K + ' productos: fila ' + i + ' de ' + esc(A.label || '') + ' × columna ' + j + ' de ' + esc(B.label || '') + '.' });
    }
    function cellA(hm, i, k) {
      if (i < 0 || k < 0) return genericCell.call(this, hm, i, k);
      hA.highlightCell(i, k, 'hl'); hB.highlightRow(k, 'alt'); hC.highlightRow(i, 'src');
      return insp({ kind: 'matmul', title: cellLab(A, i, k), sub: where(A, i, k), tex: at(A.tex, i, k) + ' = ' + texNum(A.mat.get(i, k)),
        rows: [['', 'Multiplica a la fila ' + k + ' de ' + (B.label || '') + ' y contribuye a toda la fila ' + i + ' de ' + (C.label || '') + '.']] });
    }
    function cellB(hm, k, j) {
      if (k < 0 || j < 0) return genericCell.call(this, hm, k, j);
      hB.highlightCell(k, j, 'hl'); hA.highlightCol(k, 'alt'); hC.highlightCol(j, 'src');
      return insp({ kind: 'matmul', title: cellLab(B, k, j), sub: where(B, k, j), tex: at(B.tex, k, j) + ' = ' + texNum(B.mat.get(k, j)),
        rows: [['', 'Multiplica a la columna ' + k + ' de ' + (A.label || '') + ' y contribuye a toda la columna ' + j + ' de ' + (C.label || '') + '.']] });
    }
    function cellBias(hm, i, j) {
      if (j < 0) return genericCell.call(this, hm, i, j);
      hBias.highlightCell(0, j, 'hl'); hC.highlightCol(j, 'src');
      return insp({ kind: 'matmul', title: cellLab(bias, 0, j), sub: 'se suma a las ' + C.mat.r + ' filas (broadcasting)',
        tex: at1(bias.tex, j) + ' = ' + texNum(bias.mat.get(0, j)), rows: [['', 'El mismo número se suma a toda la columna ' + j + ' de ' + (C.label || '') + '.']] });
    }
  };

  // ---- add (codificación posicional y residuales)
  R.add = function (v) {
    const s = v.step, ax = s.aux || {};
    const A = s.inputs[0], B = s.inputs[1], C = s.outputs[0];
    const mx = maxAbsOf([A, B, C]);
    v.flow([A, '+', B, '→', C]);
    const L = v.line();
    const hA = v.hm(A, { maxAbs: mx }, cell), hB = v.hm(B, { maxAbs: mx }, cell), hC = v.hm(C, { maxAbs: mx }, cell);
    L.term(hA).term(hB, '+').term(hC, '=');
    v.primary = hC;
    const d = A.mat.c;
    const sinus = ax.posEnc === 'sinusoidal';
    let plot = null, hot = null;
    if (ax.posEnc) {
      if (sinus) {
        const body = v.card('Codificación sinusoidal: columnas de PE a lo largo de las posiciones', 'ov-card--wide');
        body.appendChild(texSpan('PE[p,\\,2i] = \\sin\\!\\Big(\\frac{p}{10000^{2i/d}}\\Big),\\qquad PE[p,\\,2i+1] = \\cos\\!\\Big(\\frac{p}{10000^{2i/d}}\\Big)', 'ov-formula', true));
        const maxLen = (v.ctx.cfg && v.ctx.cfg.maxLen) || Math.max(A.mat.r, 8);
        const T = A.mat.r;
        plot = new MiniPlot({ x: [0, Math.max(1, maxLen - 1)], y: [-1.15, 1.15], xLabel: 'posición p', yLabel: 'PE[p, j]', height: 190,
          xTicks: Array.from({ length: maxLen }, (_, p) => p),
          ariaLabel: 'Curvas seno y coseno de cada columna de PE en función de la posición',
          layers: [(g, api) => {
            const cols = [api.cv('--fwd', '#0E7C74'), api.cv('--upd', '#A86B0C'), api.cv('--prob-1', '#4B2E83'), api.cv('--neg', '#2F64B5')];
            for (let j = 0; j < d; j++) {
              const i2 = j - (j % 2);
              const w = 1 / Math.pow(10000, i2 / d);
              const f = j % 2 === 0 ? (p) => Math.sin(p * w) : (p) => Math.cos(p * w);
              const col = cols[Math.floor(j / 2) % cols.length];
              const isHot = hot && hot.j === j;
              g.strokeStyle = alpha(col, hot ? (isHot ? 1 : 0.18) : 0.75);
              g.lineWidth = isHot ? 2.5 : 1.25;
              g.setLineDash(j % 2 ? [4, 3] : []);
              curve(g, api, f, 0, maxLen - 1, 160);
              g.setLineDash([]);
              for (let p = 0; p < T; p++) {
                const on = isHot && hot.t === p;
                dot(g, api.sx(p), api.sy(f(p)), on ? 5 : isHot ? 3.5 : 2.2, on ? api.cv('--ink', '#000') : alpha(col, hot && !isHot ? 0.25 : 0.95));
              }
            }
          }] });
        body.appendChild(plot.canvas);
        body.appendChild(el('p', 'ov-card__cap', 'Línea continua: seno (columnas pares); discontinua: coseno (impares). Cada par de columnas oscila con otra frecuencia: las primeras cambian rápido, las últimas casi no cambian en ' + maxLen + ' posiciones. Los puntos son las ' + T + ' posiciones de esta frase.'));
        v.cleanups.push(() => plot.destroy());
        v.layoutHooks.push(() => plot.draw());
        v.clearHooks.push(() => { if (hot) { hot = null; plot.draw(); } });
      } else {
        v.note('Codificación posicional <b>aprendida</b>: P<sub>pos</sub> es un parámetro más (una fila por posición) que se entrena con el gradiente, como E.');
      }
    }
    if (ax.residual) {
      const nA = A.mat.frob(), nB = B.mat.frob(), nC = C.mat.frob();
      v.note('Conexión residual: la salida de la subcapa se <b>suma</b> a su entrada, así la información (y el gradiente) tiene un camino directo. Tamaños (norma de Frobenius): ‖' +
        esc(A.label) + '‖ = ' + f4(nA, 3) + ', ‖' + esc(B.label) + '‖ = ' + f4(nB, 3) + ' → ‖' + esc(C.label) + '‖ = ' + f4(nC, 3) + '.');
    } else if (ax.posEnc) {
      v.note('Se suman elemento a elemento dos matrices T×d: el vector de cada token recibe el vector de su posición. Misma escala de color para las tres matrices.');
    }
    function cell(hm, i, j) {
      if (i < 0 && j < 0) return null;
      if (j === -1) { for (const h of [hA, hB, hC]) h.highlightRow(i, h === hm ? 'hl' : 'src'); return insp({ kind: 'add', title: 'fila ' + i, sub: where(C, i, -1), tex: at1(C.tex, i) + ' = ' + at1(A.tex, i) + ' + ' + at1(B.tex, i), rows: [['', 'Suma elemento a elemento de las filas ' + i + '.']] }); }
      if (i === -1) { for (const h of [hA, hB, hC]) h.highlightCol(j, h === hm ? 'hl' : 'src'); return insp({ kind: 'add', title: 'columna ' + j, sub: where(C, -1, j), tex: at(C.tex, ':', j) + ' = ' + at(A.tex, ':', j) + ' + ' + at(B.tex, ':', j), rows: [] }); }
      for (const h of [hA, hB, hC]) h.highlightCell(i, j, h === hC ? 'hl' : 'src');
      const a = A.mat.get(i, j), b = B.mat.get(i, j), c = C.mat.get(i, j);
      const rows = [['suma', '= ' + f4(a) + ' + ' + par(b) + ' = ' + f4(c, 6)]];
      let tex = at(C.tex, i, j) + ' = ' + at(A.tex, i, j) + ' + ' + at(B.tex, i, j);
      if (sinus) {
        const i2 = j - (j % 2);
        const ang = i / Math.pow(10000, i2 / d);
        tex += ',\\quad PE[' + i + ',' + j + '] = \\' + (j % 2 ? 'cos' : 'sin') + '\\Big(\\frac{' + i + '}{10000^{' + i2 + '/' + d + '}}\\Big)';
        rows.unshift(['PE', '= ' + (j % 2 ? 'cos' : 'sin') + '(' + i + ' / 10000^(' + i2 + '/' + d + ')) = ' + (j % 2 ? 'cos' : 'sin') + '(' + f4(ang) + ') = ' + f4(b)]);
        if (plot) { hot = { j, t: i }; plot.draw(); }
      }
      return insp({ kind: 'add', title: cellLab(C, i, j), sub: where(C, i, j), tex, rows });
    }
  };

  // ---- accumulate (suma de contribuciones de gradiente)
  R.accumulate = function (v) {
    const s = v.step, ins = s.inputs, C = s.outputs[0];
    const mx = maxAbsOf(ins.concat([C]));
    const f = [];
    ins.forEach((r, k) => { if (k) f.push('+'); f.push(r); });
    f.push('→', C);
    v.flow(f);
    const L = v.line();
    const hs = ins.map((r) => v.hm(r, { maxAbs: mx }, cell));
    hs.forEach((h, k) => L.term(h, k ? '+' : null));
    const hC = v.hm(C, { maxAbs: mx }, cell);
    L.term(hC, '=');
    v.primary = hC;
    v.note('Cuando un tensor se usa por varios caminos, su gradiente es la <b>suma</b> de lo que llega por cada uno (regla de la cadena multivariable). Misma escala de color para todas.');
    function cell(hm, i, j) {
      if (i < 0 && j < 0) return null;
      const all = hs.concat([hC]);
      if (i < 0 || j < 0) { for (const h of all) (j === -1 ? h.highlightRow(i, 'src') : h.highlightCol(j, 'src')); return genericCell.call(this, hm, i, j); }
      for (const h of all) h.highlightCell(i, j, h === hC ? 'hl' : 'src');
      const vals = ins.map((r) => r.mat.get(i, j));
      return insp({ kind: 'accumulate', title: cellLab(C, i, j), sub: where(C, i, j),
        tex: at(C.tex, i, j) + ' = ' + ins.map((r) => at(r.tex, i, j)).join(' + '),
        rows: [['suma', '= ' + vals.map((x, k) => (k ? par(x) : f4(x))).join(' + ') + ' = ' + f4(C.mat.get(i, j), 6)]] });
    }
  };

  // ---- residual_split (el gradiente se copia a las ramas)
  R.residual_split = function (v) {
    const s = v.step, X = s.inputs[0], outs = s.outputs, br = (s.aux && s.aux.branches) || [];
    const mx = maxAbsOf([X].concat(outs));
    const f = [X, '→'];
    outs.forEach((r, k) => { if (k) f.push(','); f.push(r); });
    v.flow(f);
    const L = v.line();
    const hX = v.hm(X, { maxAbs: mx }, cell);
    L.term(hX);
    const hs = outs.map((r, k) => v.hm(r, { maxAbs: mx, note: br[k] ? esc(br[k]) : null }, cell));
    hs.forEach((h, k) => L.term(h, k ? ',' : '↦'));
    v.primary = hs[hs.length - 1];
    if (outs.length > 1) v.note('En el forward había una suma (y = a + b), y ∂y/∂a = ∂y/∂b = 1: el gradiente llega <b>intacto</b> a las dos ramas. Son copias exactas, no mitades.');
    else v.note('PE es una constante (no se entrena): el gradiente solo sigue hacia el embedding, sin cambios.');
    function cell(hm, i, j) {
      if (i < 0 && j < 0) return null;
      const all = [hX].concat(hs);
      if (i < 0 || j < 0) { for (const h of all) (j === -1 ? h.highlightRow(i, 'src') : h.highlightCol(j, 'src')); return genericCell.call(this, hm, i, j); }
      for (const h of all) h.highlightCell(i, j, h === hm ? 'hl' : 'src');
      const x = X.mat.get(i, j);
      return insp({ kind: 'residual_split', title: cellLab(hm.ref, i, j), sub: where(hm.ref, i, j),
        tex: outs.map((r) => at(r.tex, i, j)).join(' = ') + ' = ' + at(X.tex, i, j) + ' = ' + texNum(x),
        rows: [['copia', f4(x, 6)]] });
    }
  };

  // ---- scale (1/√d_k, forward y backward)
  R.scale = function (v) {
    const s = v.step, ax = s.aux || {}, X = s.inputs[0], Y = s.outputs[0];
    const fac = ax.factor, dk = ax.dk || Math.round(1 / (fac * fac));
    const mx = maxAbsOf([X, Y]);
    v.flow([X, '× 1/√' + dk, '→', Y]);
    const L = v.line();
    const hX = v.hm(X, { maxAbs: mx }, cell), hY = v.hm(Y, { maxAbs: mx }, cell);
    L.term(hX).term(hY, { tex: '\\times\\frac{1}{\\sqrt{' + dk + '}} =' });
    v.primary = hY;
    const sd = (m) => { let n = 0, s1 = 0, s2 = 0; for (const x of m.d) if (Number.isFinite(x)) { n++; s1 += x; s2 += x * x; } return n ? Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2)) : 0; };
    if (s.phase === 'backward') {
      v.note('Como S̃ = S / √d_k, la derivada es ∂S̃/∂S = 1/√d_k = ' + f4(fac) + ': el gradiente se escala por el mismo factor que en el forward.');
    } else {
      v.note('Factor 1/√d_k = 1/√' + dk + ' = ' + f4(fac) + '. Un producto escalar suma d_k términos, así que su varianza crece ≈ d_k; dividir por √d_k la devuelve a ≈ 1 y el softmax no se satura. Desviación típica aquí: ' +
        esc(X.label) + ' = ' + f4(sd(X.mat), 3) + ' → ' + esc(Y.label) + ' = ' + f4(sd(Y.mat), 3) + '. Misma escala de color: se ve cómo se «apaga».');
    }
    function cell(hm, i, j) {
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      hX.highlightCell(i, j, hm === hX ? 'hl' : 'src'); hY.highlightCell(i, j, hm === hY ? 'hl' : 'src');
      const x = X.mat.get(i, j);
      return insp({ kind: 'scale', title: cellLab(Y, i, j), sub: where(Y, i, j),
        tex: at(Y.tex, i, j) + ' = \\frac{' + at(X.tex, i, j) + '}{\\sqrt{' + dk + '}}',
        rows: [['', '= ' + f4(x) + ' / ' + f4(Math.sqrt(dk)) + ' = ' + f4(x) + ' × ' + f4(fac) + ' = ' + f4(Y.mat.get(i, j), 6)]] });
    }
  };

  // ---- mask (máscara causal)
  R.mask = function (v) {
    const s = v.step, X = s.inputs[0], M = s.inputs[1], Y = s.outputs[0];
    const mx = maxAbsOf([X, Y]);
    v.flow([X, '+', M, '→', Y]);
    const L = v.line();
    const hX = v.hm(X, { maxAbs: mx }, cell), hM = v.hm(M, {}, cell), hY = v.hm(Y, { maxAbs: mx }, cell);
    L.term(hX).term(hM, '+').term(hY, '=');
    v.primary = hY;
    v.note('Fila i = consulta (el token i), columna j = clave. Si j > i, la clave está en el <b>futuro</b>: se suma −∞ y, tras el softmax, su peso será exactamente 0. La diagonal (j = i) siempre es visible.');
    function cell(hm, i, j) {
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      for (const h of [hX, hM, hY]) h.highlightCell(i, j, h === hm ? 'hl' : 'src');
      const x = X.mat.get(i, j), m = M.mat.get(i, j), y = Y.mat.get(i, j);
      const q = X.rowLabels ? tokQ(X.rowLabels[i]) : 'la consulta ' + i, k = X.colLabels ? tokQ(X.colLabels[j]) : 'la clave ' + j;
      return insp({ kind: 'mask', title: cellLab(Y, i, j), sub: where(Y, i, j),
        tex: at(Y.tex, i, j) + ' = ' + at(X.tex, i, j) + ' + M[' + i + ',' + j + ']',
        rows: [['', '= ' + f4(x) + ' + ' + (m === -Infinity ? '(−∞)' : f4(m)) + ' = ' + f4(y)]],
        note: j > i ? q + ' (posición ' + i + ') no puede mirar a ' + k + ' (posición ' + j + '): está en el futuro.' : q + ' (posición ' + i + ') sí puede mirar a ' + k + ' (posición ' + j + ' ≤ ' + i + ').' });
    }
  };

  // ---- grafo de atención (consultas a la izquierda, claves a la derecha)
  function attnGraph(A, qLab, kLab, onPick) {
    const T = A.r;
    const rowH = 26, top = 30, W = 320;
    const H = top + T * rowH + 6;
    const xq = 118, xk = 202;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'ov-ag');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Grafo de atención: cada consulta (izquierda) une con las claves (derecha) que atiende; el grosor es el peso');
    const mk = (tag, attrs, parent) => { const e = doc.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; };
    const y = (i) => top + i * rowH + rowH / 2;
    const tq = mk('text', { x: xq, y: 14, 'text-anchor': 'end', class: 'ov-ag__head' }); tq.textContent = 'consultas (i)';
    const tk = mk('text', { x: xk, y: 14, 'text-anchor': 'start', class: 'ov-ag__head' }); tk.textContent = 'claves (j)';
    const gl = mk('g', { class: 'ov-ag__lines' });
    const lines = [];
    for (let i = 0; i < T; i++) {
      for (let j = 0; j < A.c; j++) {
        const a = A.get(i, j);
        if (!(a > 0)) continue;
        const p = mk('path', { d: 'M' + xq + ' ' + y(i) + ' C ' + (xq + 40) + ' ' + y(i) + ', ' + (xk - 40) + ' ' + y(j) + ', ' + xk + ' ' + y(j),
          class: 'ov-ag__line', 'stroke-width': (0.6 + 7 * a).toFixed(2), 'stroke-opacity': (0.12 + 0.88 * a).toFixed(3) }, gl);
        p.dataset.i = i; p.dataset.j = j;
        lines.push(p);
      }
    }
    const wts = mk('g', { class: 'ov-ag__wts' });
    const qNodes = [];
    for (let i = 0; i < T; i++) {
      const g = mk('g', { class: 'ov-ag__q', tabindex: '0', role: 'button', 'aria-label': 'Consulta ' + i + ' ' + (qLab[i] || '') });
      mk('circle', { cx: xq, cy: y(i), r: 4.5, class: 'ov-ag__node' }, g);
      const t = mk('text', { x: xq - 10, y: y(i), 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'ov-ag__lab' }, g);
      t.textContent = qLab[i] + ' ' + i;
      g.addEventListener('mouseenter', () => onPick(i));
      g.addEventListener('focus', () => onPick(i));
      g.addEventListener('click', () => onPick(i));
      qNodes.push(g);
    }
    for (let j = 0; j < A.c; j++) {
      mk('circle', { cx: xk, cy: y(j), r: 4.5, class: 'ov-ag__node' });
      const t = mk('text', { x: xk + 10, y: y(j), 'text-anchor': 'start', 'dominant-baseline': 'central', class: 'ov-ag__lab' });
      t.textContent = j + ' ' + kLab[j];
    }
    return {
      el: svg,
      isolate(i, jHot) {
        svg.classList.toggle('is-iso', i != null);
        for (const p of lines) {
          const on = i != null && +p.dataset.i === i;
          p.classList.toggle('is-on', on);
          p.classList.toggle('is-hot', on && +p.dataset.j === jHot);
        }
        for (let q = 0; q < qNodes.length; q++) qNodes[q].classList.toggle('is-on', q === i);
        wts.textContent = '';
        if (i == null) return;
        for (let j = 0; j < A.c; j++) {
          const a = A.get(i, j);
          const t = mk('text', { x: W - 4, y: y(j), 'text-anchor': 'end', 'dominant-baseline': 'central', class: 'ov-ag__w' + (j === jHot ? ' is-hot' : '') }, wts);
          t.textContent = a > 0 ? a.toFixed(3) : '0';
        }
      },
    };
  }

  // objetivos del softmax de salida (el paso no los trae): ctx.targetTokens → ctx.steps → tokenizador
  function findTargets(ctx, queryLabels) {
    if (ctx.targetTokens) return ctx.targetTokens;
    if (Array.isArray(ctx.steps)) {
      const st = ctx.steps.find((x) => x && x.kind === 'crossentropy') || ctx.steps.find((x) => x && x.kind === 'tokenize');
      if (st && st.aux && st.aux.targetTokens) return st.aux.targetTokens.map((t) => (ctx.tok && ctx.tok.display ? ctx.tok.display(t) : t));
    }
    const tok = ctx.tok;
    if (tok && tok.sentences) {
      const disp = tok.display || ((t) => t);
      for (const sen of tok.sentences) {
        const inp = sen.inputTokens.map(disp);
        if (inp.length === queryLabels.length && inp.every((t, k) => t === queryLabels[k])) return sen.targetTokens.map(disp);
      }
    }
    return null;
  }

  // ---- softmax por filas (atención y salida)
  R.softmax = function (v) {
    const s = v.step, ax = s.aux || {}, X = s.inputs[0], P = s.outputs[0];
    const T = X.mat.r, C = X.mat.c;
    const attn = !!ax.attention;
    v.flow([X, '→', { tex: '\\mathrm{softmax}_{\\text{fila}}', text: '' }, '→', P], 'cada fila suma 1');
    const rl = X.rowLabels;
    const mRef = mkRef({ key: 'rowMax', tex: 'm', label: 'm (máx. fila)', mat: ax.rowMax, rowAxis: X.rowAxis, colAxis: '1', rowLabels: rl });
    const eTex = attn ? 'e^{' + X.tex + ' - m}' : '\\exp(' + X.tex + ' - m)';
    const eRef = mkRef({ key: 'exps', tex: eTex, label: 'exp(x − m)', mat: ax.exps, rowAxis: X.rowAxis, colAxis: X.colAxis, rowLabels: rl, colLabels: X.colLabels });
    const sRef = mkRef({ key: 'rowSum', tex: '\\textstyle\\sum_j e', label: 'Σ fila', mat: ax.rowSum, rowAxis: X.rowAxis, colAxis: '1', rowLabels: rl });
    const chk = TL.Mat.map(TL.Mat.sumCols(P.mat), (x) => Math.round(x * 1e9) / 1e9); // (redondeo solo visual)
    const cRef = mkRef({ key: 'check', tex: '\\textstyle\\sum_j ' + P.tex, label: 'Σ fila de ' + P.label, mat: chk, rowAxis: X.rowAxis, colAxis: '1', rowLabels: rl });
    const L1 = v.line('1 · Máximo de cada fila (estabilidad numérica)');
    const hX = v.hm(X, {}, cell);
    const hm_ = v.hm(mRef, { caption: 'compact', tag: false }, cellRow);
    L1.term(hX).term(hm_, { word: 'máx. por fila', title: 'm_i = máx_j x_ij' });
    const L2 = v.line('2 · Exponencial y suma de cada fila');
    const hE = v.hm(eRef, { tag: false }, cell);
    const hS = v.hm(sRef, { caption: 'compact', tag: false }, cellRow);
    L2.term(hE, { tex: 'e_{ij} = \\exp(x_{ij} - m_i) =' }).term(hS, { word: 'Σ por fila' });
    const L3 = v.line('3 · Normalizar: dividir cada fila por su suma');
    const hP = v.hm(P, {}, cell);
    const hC = v.hm(cRef, { caption: 'compact', scale: 'sequential', maxAbs: 1, tag: false }, cellRow);
    L3.term(hP, { tex: at(P.tex, 'i', 'j') + ' = \\frac{e_{ij}}{\\sum_k e_{ik}} =' }).term(hC, { word: 'comprobación' });
    v.primary = hP;
    v.legend([
      { scale: hX.scale, names: [X.label, mRef.label, eRef.label, sRef.label], own: true },
      { scale: hP.scale, names: [P.label, cRef.label], note: 'probabilidades (0 → 1): ', masked: attn },
    ]);

    let graph = null, topBox = null;
    if (attn) {
      const body = v.card('Grafo de atención: a quién mira cada token', 'ov-card--graph');
      graph = attnGraph(P.mat, ax.queryLabels || rl || [], ax.keyLabels || X.colLabels || [], (i) => { v.clearHl(); pickRow(i); });
      body.appendChild(graph.el);
      body.appendChild(el('p', 'ov-card__cap', 'Grosor y opacidad = peso A[i, j]. Pasa el cursor por una consulta (o por una fila de la matriz) para aislarla. Las líneas hacia el futuro no existen: la máscara las dejó en 0.'));
      v.clearHooks.push(() => graph.isolate(null));
      v.note('Cada fila de A es una distribución de probabilidad sobre las claves visibles: pesos ≥ 0 que suman 1. Restar el máximo m de cada fila no cambia el resultado (se cancela al dividir) pero evita desbordes de exp.');
    } else {
      const targets = findTargets(v.ctx, ax.queryLabels || rl || []);
      topBox = v.card('Top-3 predicciones por posición', 'ov-card--wide');
      topBox.appendChild(topTable(P, ax.queryLabels || rl || [], ax.keyLabels || X.colLabels || [], targets));
      v.note('Cada fila de P es la distribución del <b>siguiente</b> token en esa posición. Restar el máximo de cada fila no cambia el resultado pero evita desbordes de exp.');
    }

    function pickRow(i, jHot) {
      hX.highlightRow(i, 'src'); hE.highlightRow(i, 'src'); hP.highlightRow(i, 'hl');
      hm_.highlightCell(i, 0, 'src'); hS.highlightCell(i, 0, 'src'); hC.highlightCell(i, 0, 'hl');
      if (graph) graph.isolate(i, jHot);
      if (jHot == null) {
        let sum = 0; const terms = [];
        for (let j = 0; j < C; j++) { const p = P.mat.get(i, j); sum += p; terms.push(f4(p, 3)); }
        v.inspect(insp({ kind: 'softmax', title: (P.label || 'P') + ' · fila ' + i, sub: where(P, i, -1),
          tex: '\\sum_j ' + at(P.tex, i, 'j') + ' = 1',
          rows: [['m', '= ' + f4(ax.rowMax.get(i, 0))], ['Σ e', '= ' + f4(ax.rowSum.get(i, 0))], ['Σ ' + (P.label || 'P'), '= ' + terms.join(' + ') + ' = ' + f4(sum, 6)]] }));
      }
    }
    function cellRow(hm, i, j) {
      if (i < 0) return genericCell.call(this, hm, i, j);
      pickRow(i);
      return null;
    }
    function cell(hm, i, j) {
      if (i < 0 && j < 0) return null;
      if (j === -1) { pickRow(i); return null; }
      if (i === -1) { for (const h of [hX, hE, hP]) h.highlightCol(j, h === hm ? 'hl' : 'src'); return genericCell.call(this, hm, -1, j); }
      pickRow(i, j);
      hX.highlightCell(i, j, 'alt'); hE.highlightCell(i, j, 'alt'); hP.highlightCell(i, j, 'alt');
      const x = X.mat.get(i, j), m = ax.rowMax.get(i, 0), e = ax.exps.get(i, j), sm = ax.rowSum.get(i, 0);
      const eTerms = [];
      for (let k = 0; k < C; k++) eTerms.push(f4(ax.exps.get(i, k), 3));
      return insp({ kind: 'softmax', title: cellLab(P, i, j), sub: where(P, i, j),
        tex: at(P.tex, i, j) + ' = \\frac{\\exp(' + at(X.tex, i, j) + ' - m_{' + i + '})}{\\sum_{k} \\exp(' + at(X.tex, i, 'k') + ' - m_{' + i + '})}',
        rows: [
          ['m' + sub(i), '= máxₖ ' + (X.label || 'x') + '[' + i + ', k] = ' + f4(m)],
          ['e[' + i + ', ' + j + ']', x === -Infinity ? '= exp(−∞) = 0 (enmascarada)' : '= exp(' + f4(x) + ' − ' + par(m) + ') = ' + f4(e)],
          ['Σₖ e', '= ' + sumStr(eTerms) + ' = ' + f4(sm)],
          [(P.label || 'P') + '[' + i + ', ' + j + ']', '= ' + f4(e) + ' / ' + f4(sm) + ' = ' + f4(P.mat.get(i, j), 6)],
        ] });
    }
    // animación: normalización fila a fila
    v.animator = async function (tok) {
      tok.finish = () => { hE.reveal(); hS.reveal(); hP.reveal(); hC.reveal(); };
      hE.reveal(0); hS.reveal(0); hP.reveal(0); hC.reveal(0);
      const d = Math.max(260, Math.min(1100, this.speed * C * 1.2));
      for (let i = 0; i < T && !tok.cancelled; i++) {
        hE.reveal((i + 1) * C); hS.reveal(i + 1);
        this.clearHl(); pickRow(i);
        await this.sleep(tok, d / 2);
        if (tok.cancelled) break;
        hP.reveal((i + 1) * C); hC.reveal(i + 1);
        let jb = 0; for (let j = 1; j < C; j++) if (P.mat.get(i, j) > P.mat.get(i, jb)) jb = j;
        this.hover(hP, i, jb);
        await this.sleep(tok, d / 2);
      }
      tok.finish();
    };
  }

  function topTable(P, qLab, vocab, targets) {
    const wrap = el('div', 'table-wrap ov-top');
    const tb = el('table', 'table table--compact');
    let h = '<thead><tr><th class="num">t</th><th>entrada</th>' + (targets ? '<th>objetivo</th>' : '') + '<th>top-3 predicciones</th>' + (targets ? '<th class="num">P(objetivo)</th>' : '') + '</tr></thead><tbody>';
    for (let t = 0; t < P.mat.r; t++) {
      const row = Array.from({ length: P.mat.c }, (_, k) => k).sort((a, b) => P.mat.get(t, b) - P.mat.get(t, a)).slice(0, 3);
      const tgt = targets ? targets[t] : null;
      const tgtId = tgt != null ? vocab.indexOf(tgt) : -1;
      h += '<tr><td class="num">' + t + '</td><td class="mono">' + esc(qLab[t] || '') + '</td>';
      if (targets) h += '<td class="mono ov-top__tgt">' + esc(tgt || '') + '</td>';
      h += '<td><div class="ov-top__preds">';
      for (const k of row) {
        const p = P.mat.get(t, k);
        const ok = k === tgtId;
        h += '<span class="ov-top__p' + (ok ? ' is-ok' : '') + '"><span class="ov-top__tok">' + esc(vocab[k]) + (ok ? ' ✓' : '') + '</span>' +
          '<span class="ov-top__bar" style="--w:' + Math.max(2, Math.round(p * 100)) + '%"></span><span class="ov-top__num">' + p.toFixed(3) + '</span></span>';
      }
      h += '</div></td>';
      if (targets) h += '<td class="num">' + (tgtId >= 0 ? P.mat.get(t, tgtId).toFixed(3) : '—') + '</td>';
      h += '</tr>';
    }
    tb.innerHTML = h + '</tbody>';
    wrap.appendChild(tb);
    return wrap;
  }

  // ---- layernorm
  R.layernorm = function (v) {
    const s = v.step, ax = s.aux, X = s.inputs[0], G = s.inputs[1], Bt = s.inputs[2], Y = s.outputs[0];
    const T = X.mat.r, d = X.mat.c, eps = ax.eps;
    v.flow([X, '→', { tex: '\\mathrm{LN}', text: '' }, '→', Y], G.label + ', ' + Bt.label + ': 1×' + d + ' (parámetros)');
    const rl = X.rowLabels;
    const muRef = mkRef({ key: 'mu', tex: '\\mu', label: 'μ', mat: ax.mu, rowAxis: 'T', colAxis: '1', rowLabels: rl });
    const sgRef = mkRef({ key: 'sigma', tex: '\\sqrt{\\sigma^2+\\varepsilon}', label: '√(σ²+ε)', mat: ax.sigma, rowAxis: 'T', colAxis: '1', rowLabels: rl });
    const xhRef = mkRef({ key: 'xhat', tex: '\\hat X', label: 'X̂', mat: ax.xhat, rowAxis: 'T', colAxis: 'd', rowLabels: rl });
    const shared = maxAbsOf([xhRef, Y]);
    const L1 = v.line('1 · Media y desviación de cada fila (de cada token)');
    const hX = v.hm(X, {}, cellY);
    const hMu = v.hm(muRef, { caption: 'compact', tag: false }, cellStat);
    const hSg = v.hm(sgRef, { caption: 'compact', tag: false }, cellStat);
    L1.term(hX).term(hMu, '↦').term(hSg, ',');
    const L2 = v.line('2 · Normalizar: media 0 y varianza 1 en cada fila');
    const hXh = v.hm(xhRef, { maxAbs: shared }, cellY);
    L2.term(hXh, { tex: '\\hat X = \\frac{X - \\mu}{\\sqrt{\\sigma^2+\\varepsilon}} =' });
    const L3 = v.line('3 · Escalar y desplazar cada columna (parámetros aprendidos)');
    const hG = v.hm(G, {}, cellParam), hB = v.hm(Bt, {}, cellParam), hY = v.hm(Y, { maxAbs: shared }, cellY);
    L3.term(hG).term(hB, { tex: '\\odot\\,\\hat X\\;+' }).term(hY, '=');
    v.primary = hY;
    v.note('LayerNorm trabaja <b>por filas</b>: cada token se normaliza con su propia media y desviación (sobre sus d = ' + d + ' números), sin mirar a los demás tokens. X̂ y ' + esc(Y.label) + ' comparten escala de color.');

    function statRows(i) {
      const xs = []; for (let j = 0; j < d; j++) xs.push(f4(X.mat.get(i, j), 3));
      const ds = []; for (let j = 0; j < d; j++) { const z = X.mat.get(i, j) - ax.mu.get(i, 0); ds.push(f4(z * z, 3)); }
      return [
        ['μ' + sub(i), '= (' + sumStr(xs) + ') / ' + d + ' = ' + f4(ax.mu.get(i, 0))],
        ['σ²' + sub(i), '= (' + sumStr(ds) + ') / ' + d + ' = ' + f4(ax.var.get(i, 0))],
        ['√(σ²+ε)', '= √(' + f4(ax.var.get(i, 0)) + ' + ' + f4(eps) + ') = ' + f4(ax.sigma.get(i, 0))],
      ];
    }
    function cellStat(hm, i) {
      if (i < 0) return null;
      hX.highlightRow(i, 'src'); hMu.highlightCell(i, 0, hm === hMu ? 'hl' : 'src'); hSg.highlightCell(i, 0, hm === hSg ? 'hl' : 'src');
      return insp({ kind: 'layernorm', title: 'Estadísticos de la fila ' + i, sub: where(X, i, -1),
        tex: '\\mu_{' + i + '} = \\frac{1}{' + d + '}\\sum_j ' + at(X.tex, i, 'j') + ',\\quad \\sigma^2_{' + i + '} = \\frac{1}{' + d + '}\\sum_j (' + at(X.tex, i, 'j') + ' - \\mu_{' + i + '})^2',
        rows: statRows(i) });
    }
    function cellY(hm, i, j) {
      if (i < 0 && j < 0) return null;
      if (j === -1) {
        hX.highlightRow(i, 'src'); hXh.highlightRow(i, 'src'); hY.highlightRow(i, 'hl'); hMu.highlightCell(i, 0, 'src'); hSg.highlightCell(i, 0, 'src');
        let m = 0, q = 0; for (let k = 0; k < d; k++) m += ax.xhat.get(i, k); m /= d; for (let k = 0; k < d; k++) q += (ax.xhat.get(i, k) - m) ** 2; q /= d;
        return insp({ kind: 'layernorm', title: 'Fila ' + i, sub: where(X, i, -1), rows: statRows(i).concat([['fila de X̂', 'media = ' + f4(Math.abs(m) < 1e-12 ? 0 : m, 3) + ', varianza = ' + f4(q, 4) + ' (≈ 1; un poco menos por ε)']]) });
      }
      if (i === -1) { hXh.highlightCol(j, 'src'); hY.highlightCol(j, 'hl'); hG.highlightCell(0, j, 'src'); hB.highlightCell(0, j, 'src'); return cellParam.call(this, hG, 0, j); }
      hX.highlightRow(i, 'src'); hX.highlightCell(i, j, 'alt'); hMu.highlightCell(i, 0, 'src'); hSg.highlightCell(i, 0, 'src');
      hXh.highlightCell(i, j, 'alt'); hG.highlightCell(0, j, 'src'); hB.highlightCell(0, j, 'src'); hY.highlightCell(i, j, 'hl');
      const x = X.mat.get(i, j), mu = ax.mu.get(i, 0), sg = ax.sigma.get(i, 0), xh = ax.xhat.get(i, j), g = G.mat.get(0, j), b = Bt.mat.get(0, j);
      return insp({ kind: 'layernorm', title: cellLab(Y, i, j), sub: where(Y, i, j),
        tex: at(Y.tex, i, j) + ' = ' + at1(G.tex, j) + '\\,\\frac{' + at(X.tex, i, j) + ' - \\mu_{' + i + '}}{\\sqrt{\\sigma^2_{' + i + '} + \\varepsilon}} + ' + at1(Bt.tex, j),
        rows: statRows(i).concat([
          ['x̂', '= (' + f4(x) + ' − ' + par(mu) + ') / ' + f4(sg) + ' = ' + f4(xh)],
          ['y', '= ' + f4(g) + ' · ' + par(xh) + ' + ' + par(b) + ' = ' + f4(Y.mat.get(i, j), 6)],
        ]) });
    }
    function cellParam(hm, i, j) {
      if (j < 0) return null;
      hG.highlightCell(0, j, hm === hG ? 'hl' : 'src'); hB.highlightCell(0, j, hm === hB ? 'hl' : 'src'); hXh.highlightCol(j, 'alt'); hY.highlightCol(j, 'src');
      return insp({ kind: 'layernorm', title: 'Columna ' + j + ': ' + (G.label || 'γ') + '[' + j + '] y ' + (Bt.label || 'β') + '[' + j + ']', sub: 'la misma para las ' + T + ' filas',
        tex: at(Y.tex, ':', j) + ' = ' + at1(G.tex, j) + '\\,' + at('\\hat X', ':', j) + ' + ' + at1(Bt.tex, j),
        rows: [[G.label + '[' + j + ']', '= ' + f4(G.mat.get(0, j))], [Bt.label + '[' + j + ']', '= ' + f4(Bt.mat.get(0, j))]],
        note: 'γ escala y β desplaza la columna ' + j + ' de X̂ (al empezar γ = 1 y β = 0: este paso deja X̂ igual).' });
    }
    v.animator = async function (tok) {
      const hs = [hMu, hSg, hXh, hY];
      tok.finish = () => hs.forEach((h) => h.reveal());
      hs.forEach((h) => h.reveal(0));
      const dl = Math.max(260, Math.min(1000, this.speed * d));
      for (let i = 0; i < T && !tok.cancelled; i++) {
        hMu.reveal(i + 1); hSg.reveal(i + 1);
        this.hover(hMu, i, 0);
        await this.sleep(tok, dl / 2);
        if (tok.cancelled) break;
        hXh.reveal((i + 1) * d); hY.reveal((i + 1) * d);
        this.hover(hY, i, 0);
        await this.sleep(tok, dl / 2);
      }
      tok.finish();
    };
  };

  // ---- split / concat (cabezas): bandas de color por cabeza
  const headVar = (h) => '--head-' + ((h % 8) + 1);
  function headBands(nH, dk) { return Array.from({ length: nH }, (_, h) => [h * dk, (h + 1) * dk, headVar(h)]); }
  function headChips(nH, dk, v) {
    const box = el('div', 'ov-heads');
    for (let h = 0; h < nH; h++) {
      const c = el('span', 'ov-head', 'cabeza ' + (h + 1) + ' · columnas ' + (h * dk) + '…' + ((h + 1) * dk - 1));
      c.style.setProperty('--band', 'var(' + headVar(h) + ')');
      box.appendChild(c);
    }
    v.body.insertBefore(box, v.body.firstChild);
  }
  R.split = function (v) {
    const s = v.step, ax = s.aux, nH = ax.nHeads, dk = ax.dK;
    const nOut = s.outputs.length;
    v.flow([s.inputs.length > 1 ? { text: s.inputs.map((r) => r.label).join(', '), shape: s.inputs.length + '×(' + s.inputs[0].mat.r + '×' + s.inputs[0].mat.c + ')' } : s.inputs[0],
      '→', { text: nOut + ' matrices', shape: s.outputs[0].mat.r + '×' + dk + ' cada una' }], 'h = ' + nH + ' cabezas · d_k = ' + dk);
    headChips(nH, dk, v);
    const pairs = [];
    for (const g of ax.groups) {
      const src = s.inputs[g.input];
      const L = v.line();
      const hSrc = v.hm(src, { highlightCols: headBands(nH, dk) }, cellSrc);
      L.term(hSrc);
      const outs = g.outputs.map((oi, h) => {
        const r = s.outputs[oi];
        const hm = v.hm(r, { highlightCols: [[0, dk, headVar(h)]], note: 'columnas ' + (h * dk) + '…' + ((h + 1) * dk - 1) + ' de ' + esc(src.label) }, cellOut);
        L.term(hm, h ? '‖' : '↦');
        return hm;
      });
      pairs.push({ src, hSrc, outs });
      if (!v.primary) v.primary = outs[outs.length - 1];
    }
    v.note(s.phase === 'backward'
      ? 'En el forward se concatenaron las cabezas; hacia atrás, el gradiente se <b>reparte</b> por columnas: cada cabeza recibe solo las columnas que ella produjo ((h−1)·d_k … h·d_k − 1, contando las columnas desde 0). No se calcula nada.'
      : 'Dividir en cabezas <b>no calcula nada</b>: solo agrupa columnas. La cabeza h usa las columnas (h−1)·d_k … h·d_k − 1 (contando las columnas desde 0), y cada una atenderá por su cuenta.');
    function find(hm) { for (const p of pairs) { if (p.hSrc === hm) return { p, h: -1 }; const h = p.outs.indexOf(hm); if (h >= 0) return { p, h }; } return null; }
    function cellSrc(hm, i, c) {
      const f = find(hm);
      if (i < 0 || c < 0) return genericCell.call(this, hm, i, c);
      const h = Math.floor(c / dk), j = c - h * dk;
      f.p.hSrc.highlightCell(i, c, 'hl'); f.p.outs[h].highlightCell(i, j, 'src');
      return insp({ kind: 'split', title: cellLab(f.p.src, i, c), sub: where(f.p.src, i, c) + ' → cabeza ' + (h + 1),
        tex: at(f.p.src.tex, i, c) + ' \\;\\to\\; ' + at(f.p.outs[h].ref.tex, i, j), rows: [['valor', f4(f.p.src.mat.get(i, c), 6) + ' (se copia tal cual)']] });
    }
    function cellOut(hm, i, j) {
      const f = find(hm);
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      const off = f.h * dk;
      hm.highlightCell(i, j, 'hl'); f.p.hSrc.highlightCell(i, off + j, 'src');
      return insp({ kind: 'split', title: cellLab(hm.ref, i, j), sub: where(hm.ref, i, j),
        tex: at(hm.ref.tex, i, j) + ' = ' + at(f.p.src.tex, i, off + ' + ' + j) + ' = ' + at(f.p.src.tex, i, off + j),
        rows: [['valor', f4(hm.mat.get(i, j), 6)]], note: 'Es una copia: la cabeza ' + (f.h + 1) + ' ve las columnas ' + off + '…' + (off + dk - 1) + '.' });
    }
  };
  R.concat = function (v) {
    const s = v.step, ax = s.aux, nH = ax.nHeads, dk = ax.dK;
    v.flow([{ text: s.inputs.length + ' matrices', shape: s.inputs[0].mat.r + '×' + dk + ' cada una' }, '→',
      s.outputs.length > 1 ? { text: s.outputs.map((r) => r.label).join(', '), shape: s.outputs.length + '×(' + s.outputs[0].mat.r + '×' + s.outputs[0].mat.c + ')' } : s.outputs[0]],
      'h = ' + nH + ' cabezas · d_k = ' + dk);
    headChips(nH, dk, v);
    const pairs = [];
    for (const g of ax.groups) {
      const dst = s.outputs[g.output];
      const L = v.line();
      const ins = g.inputs.map((ii, h) => {
        const r = s.inputs[ii];
        const hm = v.hm(r, { highlightCols: [[0, dk, headVar(h)]] }, cellIn);
        L.term(hm, h ? '‖' : null);
        return hm;
      });
      const hDst = v.hm(dst, { highlightCols: headBands(nH, dk) }, cellDst);
      L.term(hDst, '=');
      pairs.push({ dst, hDst, ins });
      v.primary = hDst;
    }
    v.note(s.phase === 'backward'
      ? 'Los gradientes de cada cabeza se colocan de nuevo lado a lado, en las mismas columnas que ocupaban Q, K y V: es la operación inversa de la división.'
      : 'Concatenar pone las salidas de las cabezas lado a lado: la cabeza h ocupa las columnas (h−1)·d_k … h·d_k − 1 (contando desde 0). No se calcula nada; después W_O las mezcla.');
    function find(hm) { for (const p of pairs) { if (p.hDst === hm) return { p, h: -1 }; const h = p.ins.indexOf(hm); if (h >= 0) return { p, h }; } return null; }
    function cellIn(hm, i, j) {
      const f = find(hm);
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      hm.highlightCell(i, j, 'hl'); f.p.hDst.highlightCell(i, f.h * dk + j, 'src');
      return insp({ kind: 'concat', title: cellLab(hm.ref, i, j), sub: where(hm.ref, i, j), tex: at(hm.ref.tex, i, j) + '\\;\\to\\;' + at(f.p.dst.tex, i, f.h * dk + j), rows: [['valor', f4(hm.mat.get(i, j), 6)]] });
    }
    function cellDst(hm, i, c) {
      const f = find(hm);
      if (i < 0 || c < 0) return genericCell.call(this, hm, i, c);
      const h = Math.floor(c / dk), j = c - h * dk;
      hm.highlightCell(i, c, 'hl'); f.p.ins[h].highlightCell(i, j, 'src');
      return insp({ kind: 'concat', title: cellLab(f.p.dst, i, c), sub: where(f.p.dst, i, c) + ' ← cabeza ' + (h + 1),
        tex: at(f.p.dst.tex, i, c) + ' = ' + at(f.p.ins[h].ref.tex, i, j), rows: [['valor', f4(hm.mat.get(i, c), 6)]] });
    }
  };

  // ---- activation (ReLU / GELU) y su gradiente
  const GC = Math.sqrt(2 / Math.PI);
  const ACTF = {
    relu: { f: (x) => (x > 0 ? x : 0), df: (x) => (x > 0 ? 1 : 0), name: 'ReLU', tex: '\\mathrm{ReLU}' },
    gelu: {
      f: (x) => 0.5 * x * (1 + Math.tanh(GC * (x + 0.044715 * x * x * x))),
      df: (x) => { const th = Math.tanh(GC * (x + 0.044715 * x * x * x)); return 0.5 * (1 + th) + 0.5 * x * (1 - th * th) * GC * (1 + 3 * 0.044715 * x * x); },
      name: 'GELU', tex: '\\mathrm{GELU}',
    },
  };
  function actPlot(v, U, fn, deriv) {
    const A = ACTF[fn];
    let lo = Math.min(-3, U.mat.min()), hi = Math.max(3, U.mat.max());
    const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
    const f = deriv ? A.df : A.f;
    let ylo = Infinity, yhi = -Infinity;
    for (let k = 0; k <= 200; k++) { const y = f(lo + ((hi - lo) * k) / 200); if (y < ylo) ylo = y; if (y > yhi) yhi = y; }
    if (deriv) { ylo = Math.min(ylo, -0.1); yhi = Math.max(yhi, 1.1); }
    const yp = (yhi - ylo) * 0.08;
    let hot = null;
    const plot = new MiniPlot({ x: [lo, hi], y: [ylo - yp, yhi + yp], xLabel: 'u', yLabel: (deriv ? A.name + "'(u)" : A.name + '(u)'), height: 180,
      ariaLabel: 'Curva de ' + A.name + (deriv ? ' derivada' : '') + ' con los valores reales de U como puntos',
      layers: [(g, api) => {
        g.strokeStyle = api.cv('--ink', '#000'); g.lineWidth = 1.75;
        if (deriv && fn === 'relu') {
          g.beginPath(); g.moveTo(api.sx(lo), api.sy(0)); g.lineTo(api.sx(0), api.sy(0)); g.stroke();
          g.beginPath(); g.moveTo(api.sx(0), api.sy(1)); g.lineTo(api.sx(hi), api.sy(1)); g.stroke();
        } else curve(g, api, f, lo, hi, 220);
        const col = api.cv(v.step.phase === 'backward' ? '--bwd' : '--fwd', '#0E7C74');
        const d = U.mat.d;
        for (let k = 0; k < d.length; k++) dot(g, api.sx(d[k]), api.sy(f(d[k])), 2.6, alpha(col, hot != null ? 0.3 : 0.6));
        if (hot != null) dot(g, api.sx(d[hot]), api.sy(f(d[hot])), 5.5, api.cv('--surface', '#fff'), api.cv('--ink', '#000'));
      }] });
    v.cleanups.push(() => plot.destroy());
    v.layoutHooks.push(() => plot.draw());
    v.clearHooks.push(() => { if (hot != null) { hot = null; plot.draw(); } });
    return { plot, setHot(k) { hot = k; plot.draw(); } };
  }
  R.activation = function (v) {
    const s = v.step, U = s.inputs[0], G = s.outputs[0], fn = (s.aux && s.aux.fn) || 'relu';
    const A = ACTF[fn];
    const mx = maxAbsOf([U, G]);
    v.flow([U, '→', { text: A.name }, '→', G], 'elemento a elemento');
    const L = v.line();
    const hU = v.hm(U, { maxAbs: mx }, cell), hG = v.hm(G, { maxAbs: mx }, cell);
    L.term(hU).term(hG, { word: A.name + ' ↦' });
    v.primary = hG;
    const body = v.card('Función ' + A.name + ' con los ' + U.mat.d.length + ' valores de ' + (U.label || 'U'), 'ov-card--plot');
    body.appendChild(texSpan(fn === 'relu' ? '\\mathrm{ReLU}(u) = \\max(0,\\,u)' : '\\mathrm{GELU}(u) \\approx \\tfrac12\\,u\\,\\Big(1 + \\tanh\\!\\big(\\sqrt{2/\\pi}\\,(u + 0.044715\\,u^3)\\big)\\Big)', 'ov-formula', true));
    const P = actPlot(v, U, fn, false);
    body.appendChild(P.plot.canvas);
    let zeros = 0, neg = 0;
    for (const x of U.mat.d) { if (x <= 0) neg++; }
    for (const x of G.mat.d) if (x === 0) zeros++;
    const n = U.mat.d.length;
    v.note(fn === 'relu'
      ? 'ReLU deja pasar los positivos y pone a 0 los negativos: aquí ' + zeros + ' de ' + n + ' valores (' + pct(zeros / n) + ') quedan en 0. Se aplica a cada número por separado; la forma no cambia.'
      : 'GELU es una versión suave de ReLU: casi 0 para u muy negativo, casi u para u positivo, y deja pasar un poco de los negativos cercanos a 0 (' + neg + ' de ' + n + ' valores de U son ≤ 0). Se aplica a cada número por separado.');
    function cell(hm, i, j) {
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      hU.highlightCell(i, j, hm === hU ? 'hl' : 'src'); hG.highlightCell(i, j, hm === hG ? 'hl' : 'src');
      P.setHot(i * U.mat.c + j);
      const u = U.mat.get(i, j), g = G.mat.get(i, j);
      if (fn === 'relu') {
        return insp({ kind: 'activation', title: cellLab(G, i, j), sub: where(G, i, j), tex: at(G.tex, i, j) + ' = \\max(0,\\,' + at(U.tex, i, j) + ')',
          rows: [['', '= máx(0, ' + f4(u) + ') = ' + f4(g, 6)]], note: u > 0 ? 'u > 0: pasa tal cual.' : 'u ≤ 0: se anula.' });
      }
      const z = GC * (u + 0.044715 * u * u * u);
      return insp({ kind: 'activation', title: cellLab(G, i, j), sub: where(G, i, j),
        tex: at(G.tex, i, j) + ' = \\tfrac12\\,u\\,(1 + \\tanh z),\\quad z = \\sqrt{2/\\pi}\\,(u + 0.044715\\,u^3)',
        rows: [['u', '= ' + f4(u)], ['z', '= 0.7979 · (' + f4(u) + ' + 0.044715 · ' + par(u) + '³) = ' + f4(z)], ['tanh z', '= ' + f4(Math.tanh(z))], ['GELU', '= 0.5 · ' + par(u) + ' · (1 + ' + par(Math.tanh(z)) + ') = ' + f4(g, 6)]] });
    }
  };
  R.grad_activation = function (v) {
    const s = v.step, dG = s.inputs[0], U = s.inputs[1], dU = s.outputs[0], ax = s.aux, fn = ax.fn || 'relu';
    const A = ACTF[fn];
    const dRef = mkRef({ key: 'deriv', tex: A.tex + "'(" + U.tex + ')', label: A.name + "'(U)", mat: ax.deriv, rowAxis: U.rowAxis, colAxis: U.colAxis, rowLabels: U.rowLabels });
    v.flow([dG, '⊙', dRef, '→', dU], 'elemento a elemento');
    const L1 = v.line('1 · Derivada de la activación, evaluada en ' + (U.label || 'U'));
    const hU = v.hm(U, {}, cell);
    const hD = v.hm(dRef, fn === 'relu' ? { scale: 'sequential', maxAbs: 1, tag: 'máscara 0/1' } : { tag: false }, cell);
    L1.term(hU).term(hD, { word: A.name + "' ↦" });
    const L2 = v.line('2 · Regla de la cadena, elemento a elemento');
    const mx = maxAbsOf([dG, dU]);
    const hdG = v.hm(dG, { maxAbs: mx }, cell), hdU = v.hm(dU, { maxAbs: mx }, cell);
    L2.term(hdG).term(hdU, { tex: '\\odot\\;' + A.tex + "'(" + U.tex + ')\\;=' });
    v.primary = hdU;
    const body = v.card('Derivada ' + A.name + "' con los valores de " + (U.label || 'U'), 'ov-card--plot');
    body.appendChild(texSpan(fn === 'relu' ? "\\mathrm{ReLU}'(u) = \\mathbb{1}[u > 0]" : "\\mathrm{GELU}'(u) = \\tfrac12(1+\\tanh z) + \\tfrac12\\,u\\,(1-\\tanh^2 z)\\,\\sqrt{2/\\pi}\\,(1 + 3\\cdot 0.044715\\,u^2)", 'ov-formula', true));
    const P = actPlot(v, U, fn, true);
    body.appendChild(P.plot.canvas);
    let off = 0; for (const x of ax.deriv.d) if (x === 0) off++;
    v.note(fn === 'relu'
      ? 'ReLU\'(u) vale 1 si u > 0 y 0 si no: el gradiente pasa entero por las neuronas activas y se <b>corta</b> en las apagadas (' + off + ' de ' + ax.deriv.d.length + ' aquí).'
      : 'GELU\'(u) es suave: ≈ 1 para u grande, ≈ 0 para u muy negativo, y hasta ligeramente negativa cerca de u ≈ −0.75. El gradiente se multiplica por ella en cada celda.');
    function cell(hm, i, j) {
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      for (const h of [hU, hD, hdG, hdU]) h.highlightCell(i, j, h === hm ? 'hl' : 'src');
      P.setHot(i * U.mat.c + j);
      const u = U.mat.get(i, j), dv = ax.deriv.get(i, j), g = dG.mat.get(i, j);
      return insp({ kind: 'grad_activation', title: cellLab(dU, i, j), sub: where(dU, i, j),
        tex: at(dU.tex, i, j) + ' = ' + at(dG.tex, i, j) + '\\cdot ' + A.tex + "'(" + at(U.tex, i, j) + ')',
        rows: [['u', '= ' + f4(u)], [A.name + "'(u)", fn === 'relu' ? (u > 0 ? '= 1 (u > 0)' : '= 0 (u ≤ 0)') : '= ' + f4(dv)], ['dU', '= ' + f4(g) + ' · ' + par(dv) + ' = ' + f4(dU.mat.get(i, j), 6)]] });
    }
  };

  // ---- entropía cruzada
  R.crossentropy = function (v) {
    const s = v.step, ax = s.aux, P = s.inputs[0], Y = s.inputs[1], Lr = s.outputs[0];
    const T = P.mat.r, V = P.mat.c, loss = Lr.mat.get(0, 0);
    const lRef = mkRef({ key: 'perToken', tex: '\\ell_t', label: 'ℓₜ = −log P[t, yₜ]', mat: ax.perToken, rowAxis: 'T', colAxis: '1', rowLabels: P.rowLabels });
    v.flow([P, ',', Y, '→', { tex: '\\ell', shape: T + '×1' }, '→', Lr], 'media de ' + T + ' pérdidas');
    const L1 = v.line('1 · Probabilidad asignada al token correcto (recuadrado)');
    const hP = v.hm(P, {}, cell), hY = v.hm(Y, {}, cell);
    L1.term(hP).term(hY);
    const L2 = v.line('2 · Pérdida de cada posición y media');
    const hL = v.hm(lRef, { caption: 'compact', tag: false }, cellL);
    const big = el('div', 'ov-big');
    big.appendChild(texSpan('\\mathcal{L} = \\frac{1}{' + T + '}\\sum_t \\ell_t', 'ov-big__tex'));
    big.appendChild(el('div', 'ov-big__num', f4(loss, 5)));
    L2.term(hL, { tex: '\\ell_t = -\\log ' + P.tex + '[t, y_t] =' }).node(big, '→');
    v.primary = hL;
    for (let t = 0; t < T; t++) { const y = ax.targetIds[t]; hP.mark(t, y, 'tgt'); hY.mark(t, y, 'tgt'); }
    const body = v.card('−log p por posición (ℒ es su media)', 'ov-card--wide');
    const bars = el('div', 'ov-bars');
    body.appendChild(bars);
    const q = P.rowLabels || [];
    const items = [];
    for (let t = 0; t < T; t++) items.push({ label: t + ' · ' + (q[t] || '') + ' → ' + ax.targetTokens[t], value: ax.perToken.get(t, 0), colorVar: '--fwd', key: 't' + t, t });
    const chart = TL.Charts && TL.Charts.bars ? TL.Charts.bars(bars, items, { format: (x) => x.toFixed(3), onSelect: (it) => v.hover(hL, it.t, 0), ariaLabel: 'Pérdida por posición' }) : null;
    if (chart) v.cleanups.push(() => chart.destroy());
    const lnV = Math.log(V);
    body.appendChild(el('p', 'ov-card__cap', 'Si el modelo repartiera la probabilidad por igual entre los ' + V + ' tokens, cada ℓ_t sería ln ' + V + ' = ' + lnV.toFixed(3) + '. Ahora ℒ = ' + loss.toFixed(4) + (loss < lnV ? ' (mejor que al azar).' : ' (aún no mejor que al azar).')));
    v.note('−log p penaliza la probabilidad del token correcto: si p = 1 la pérdida es 0; si p → 0, crece sin límite. Solo cuenta la columna del objetivo, pero como cada fila suma 1, subirla obliga a bajar las demás.');
    function tgtRows(t) {
      const y = ax.targetIds[t], p = ax.pTarget.get(t, 0);
      return [['objetivo', 'y' + sub(t) + ' = ' + ax.targetTokens[t] + ' (id ' + y + ')'], ['P[' + t + ', y' + sub(t) + ']', '= ' + f4(p)], ['ℓ' + sub(t), '= −ln(' + f4(p) + ') = ' + f4(ax.perToken.get(t, 0), 6)]];
    }
    function cellL(hm, t) {
      if (t < 0) return null;
      const y = ax.targetIds[t];
      hL.highlightCell(t, 0, 'hl'); hP.highlightCell(t, y, 'src'); hY.highlightCell(t, y, 'src'); hP.highlightRow(t, 'alt');
      const terms = []; for (let k = 0; k < T; k++) terms.push(f4(ax.perToken.get(k, 0), 3));
      return insp({ kind: 'crossentropy', title: 'ℓ' + sub(t) + ' · posición ' + t, sub: (q[t] ? tokQ(q[t]) + ' → ' : '') + tokQ(ax.targetTokens[t]),
        tex: '\\ell_{' + t + '} = -\\log ' + at(P.tex, t, y), rows: tgtRows(t).concat([['ℒ', '= (' + sumStr(terms) + ') / ' + T + ' = ' + f4(loss, 6)]]) });
    }
    function cell(hm, t, k) {
      if (t < 0 || k < 0) return genericCell.call(this, hm, t, k);
      const y = ax.targetIds[t];
      hP.highlightCell(t, k, hm === hP ? 'hl' : 'src'); hY.highlightCell(t, k, hm === hY ? 'hl' : 'src');
      if (k === y) { hL.highlightCell(t, 0, 'src'); return insp({ kind: 'crossentropy', title: cellLab(hm.ref, t, k), sub: where(hm.ref, t, k) + ' · es el objetivo', tex: '\\ell_{' + t + '} = -\\log ' + at(P.tex, t, k), rows: tgtRows(t) }); }
      return insp({ kind: 'crossentropy', title: cellLab(hm.ref, t, k), sub: where(hm.ref, t, k),
        tex: at(hm.ref.tex, t, k) + ' = ' + texNum(hm.mat.get(t, k)),
        rows: [['objetivo de la fila', ax.targetTokens[t] + ' (columna ' + y + ')'], ['P[t, y_t]', '= ' + f4(ax.pTarget.get(t, 0))]],
        note: 'Esta celda no es el objetivo, así que no entra directamente en ℓ' + sub(t) + '.' });
    }
    v.animator = async function (tok) {
      tok.finish = () => hL.reveal();
      hL.reveal(0);
      for (let t = 0; t < T && !tok.cancelled; t++) {
        hL.reveal(t + 1);
        this.hover(hL, t, 0);
        await this.sleep(tok, Math.max(300, this.speed * 6));
      }
      tok.finish();
    };
  };

  // ---- gradiente de softmax + entropía cruzada
  R.grad_ce = function (v) {
    const s = v.step, P = s.inputs[0], Y = s.inputs[1], D = s.outputs[0], T = (s.aux && s.aux.T) || P.mat.r;
    const PmY = TL.Mat.sub(P.mat, Y.mat);
    const dRef = mkRef({ key: 'PmY', tex: P.tex + ' - ' + Y.tex, label: 'P − Y', mat: PmY, rowAxis: P.rowAxis, colAxis: P.colAxis, rowLabels: P.rowLabels, colLabels: P.colLabels });
    v.flow([P, '−', Y, '→', { text: '÷ T = ' + T }, '→', D]);
    const L1 = v.line('1 · Diferencia entre lo predicho y lo correcto');
    const hP = v.hm(P, {}, cell), hY = v.hm(Y, {}, cell), hPY = v.hm(dRef, {}, cell);
    L1.term(hP).term(hY, '−').term(hPY, '=');
    const L2 = v.line('2 · Dividir por T (la pérdida es una media)');
    const hD = v.hm(D, {}, cell);
    L2.term(hD, { tex: '\\frac{1}{' + T + '}\\,(' + P.tex + ' - ' + Y.tex + ') =' });
    v.primary = hD;
    const tg = [];
    for (let t = 0; t < Y.mat.r; t++) for (let k = 0; k < Y.mat.c; k++) if (Y.mat.get(t, k) === 1) tg.push([t, k]);
    for (const [t, k] of tg) for (const h of [hP, hY, hPY, hD]) h.mark(t, k, 'tgt');
    v.note('Signo: en la columna correcta (recuadrada) P − 1 < 0, así que el descenso de gradiente (θ ← θ − η·g) empuja ese logit hacia <b>arriba</b>; en las demás P > 0 y los empuja hacia <b>abajo</b>, más cuanto más probables eran. Cada fila suma 0.');
    function cell(hm, t, k) {
      if (t < 0 || k < 0) return genericCell.call(this, hm, t, k);
      for (const h of [hP, hY, hPY, hD]) h.highlightCell(t, k, h === hm ? 'hl' : 'src');
      const p = P.mat.get(t, k), y = Y.mat.get(t, k), d = D.mat.get(t, k);
      return insp({ kind: 'grad_ce', title: cellLab(D, t, k), sub: where(D, t, k) + (y === 1 ? ' · objetivo' : ''),
        tex: at(D.tex, t, k) + ' = \\frac{' + at(P.tex, t, k) + ' - ' + at(Y.tex, t, k) + '}{' + T + '}',
        rows: [['', '= (' + f4(p) + ' − ' + f4(y) + ') / ' + T + ' = ' + f4(d, 6)]],
        note: y === 1 ? 'Negativo: el descenso de gradiente empujará este logit hacia <b>arriba</b> (el token correcto ganará probabilidad).' : 'Positivo: el descenso de gradiente empujará este logit hacia <b>abajo</b>, en proporción a lo probable que era (' + pct(p) + ').' });
    }
  };

  // ---- gradiente del softmax (atención)
  R.grad_softmax = function (v) {
    const s = v.step, A = s.inputs[0], dA = s.inputs[1], dS = s.outputs[0], rd = s.aux.rowDot;
    const T = A.mat.r, C = A.mat.c;
    const rRef = mkRef({ key: 'rowDot', tex: '\\mathrm{rowDot}', label: 'rowDot = Σₖ dA⊙A', mat: rd, rowAxis: 'T', colAxis: '1', rowLabels: A.rowLabels });
    v.flow([A, '⊙', '(', dA, '−', { tex: '\\mathrm{rowDot}', shape: T + '×1' }, ')', '→', dS]);
    const L = v.line();
    const hA = v.hm(A, {}, cell), hdA = v.hm(dA, {}, cell);
    const hR = v.hm(rRef, { caption: 'compact', tag: false }, cellR);
    const hdS = v.hm(dS, {}, cell);
    L.term(hA).term(hdA, { tex: '\\odot\\Big(' }).term(hR, '−', { tex: '\\Big)' }).term(hdS, '=');
    v.primary = hdS;
    v.note('<code>rowDot</code> = Σₖ dA[i,k]·A[i,k] (uno por fila) se resta a toda la fila: así cada fila de dŜ suma 0 (el softmax ignora constantes sumadas a una fila). Donde A = 0 (enmascarado), el gradiente es 0.');
    function rowDotRows(i) {
      const terms = []; for (let k = 0; k < C; k++) terms.push(par(dA.mat.get(i, k)) + '·' + par(A.mat.get(i, k)));
      return ['rowDot[' + i + ']', '= ' + sumStr(terms) + ' = ' + f4(rd.get(i, 0))];
    }
    function cellR(hm, i) {
      if (i < 0) return null;
      hR.highlightCell(i, 0, 'hl'); hA.highlightRow(i, 'src'); hdA.highlightRow(i, 'src');
      return insp({ kind: 'grad_softmax', title: 'rowDot[' + i + ']', sub: where(A, i, -1), tex: '\\mathrm{rowDot}_{' + i + '} = \\sum_k ' + at(dA.tex, i, 'k') + '\\,' + at(A.tex, i, 'k'), rows: [rowDotRows(i)] });
    }
    function cell(hm, i, j) {
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      for (const h of [hA, hdA, hdS]) h.highlightCell(i, j, h === hm ? 'hl' : 'src');
      hR.highlightCell(i, 0, 'src'); hA.highlightRow(i, 'alt');
      const a = A.mat.get(i, j), g = dA.mat.get(i, j), r = rd.get(i, 0);
      return insp({ kind: 'grad_softmax', title: cellLab(dS, i, j), sub: where(dS, i, j),
        tex: at(dS.tex, i, j) + ' = ' + at(A.tex, i, j) + '\\,\\Big(' + at(dA.tex, i, j) + ' - \\sum_k ' + at(dA.tex, i, 'k') + '\\,' + at(A.tex, i, 'k') + '\\Big)',
        rows: [rowDotRows(i), ['dŜ', '= ' + f4(a) + ' · (' + f4(g) + ' − ' + par(r) + ') = ' + f4(dS.mat.get(i, j), 6)]],
        note: a === 0 ? 'A = 0 aquí (posición enmascarada): el gradiente es exactamente 0.' : null });
    }
  };

  // ---- gradiente de la máscara
  R.grad_mask = function (v) {
    const s = v.step, dSh = s.inputs[0], M = s.inputs[1], dSt = s.outputs[0];
    const mx = maxAbsOf([dSh, dSt]);
    v.flow([dSh, '⊙', { tex: '\\mathbb{1}[M = 0]', shape: M.mat.r + '×' + M.mat.c }, '→', dSt]);
    const L = v.line();
    const hS = v.hm(dSh, { maxAbs: mx }, cell), hM = v.hm(M, {}, cell), hT = v.hm(dSt, { maxAbs: mx }, cell);
    L.term(hS).term(hM, { tex: '\\odot\\,\\mathbb{1}\\big[' }, { tex: '= 0\\big]' }).term(hT, '=');
    v.primary = hT;
    v.note('M es una constante: donde vale −∞ (el futuro) no hay nada que aprender y el gradiente se fuerza a 0. En el resto pasa sin cambios. (Allí A ya era 0, así que dŜ también lo era.)');
    function cell(hm, i, j) {
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      for (const h of [hS, hM, hT]) h.highlightCell(i, j, h === hm ? 'hl' : 'src');
      const masked = M.mat.get(i, j) === -Infinity;
      return insp({ kind: 'grad_mask', title: cellLab(dSt, i, j), sub: where(dSt, i, j),
        tex: at(dSt.tex, i, j) + ' = ' + (masked ? '0' : at(dSh.tex, i, j)),
        rows: [['', masked ? 'M = −∞ (futuro) → 0' : 'M = 0 → pasa: ' + f4(dSh.mat.get(i, j), 6)]] });
    }
  };

  // ---- gradiente de LayerNorm
  R.grad_layernorm = function (v) {
    const s = v.step, ax = s.aux, dY = s.inputs[0], X = s.inputs[1], G = s.inputs[2];
    const dX = s.outputs[0], dG = s.outputs[1], dB = s.outputs[2];
    const T = dY.mat.r, d = dY.mat.c;
    const rl = dY.rowLabels;
    const m1 = new TL.Mat(T, 1), m2 = new TL.Mat(T, 1);
    for (let t = 0; t < T; t++) {
      let a = 0, b = 0;
      for (let j = 0; j < d; j++) { a += ax.dxhat.get(t, j); b += ax.dxhat.get(t, j) * ax.xhat.get(t, j); }
      m1.d[t] = a / d; m2.d[t] = b / d;
    }
    const xhRef = mkRef({ key: 'xhat', tex: '\\hat X', label: 'X̂', mat: ax.xhat, rowAxis: 'T', colAxis: 'd', rowLabels: rl });
    const sgRef = mkRef({ key: 'sigma', tex: '\\sqrt{\\sigma^2+\\varepsilon}', label: '√(σ²+ε)', mat: ax.sigma, rowAxis: 'T', colAxis: '1', rowLabels: rl });
    const dxhRef = mkRef({ key: 'dxhat', tex: '\\mathrm{d}\\hat X', label: 'dX̂', mat: ax.dxhat, rowAxis: 'T', colAxis: 'd', role: 'grad', rowLabels: rl });
    const m1Ref = mkRef({ key: 'm1', tex: '\\overline{\\mathrm{d}\\hat X}', label: 'media(dX̂)', mat: m1, rowAxis: 'T', colAxis: '1', role: 'grad', rowLabels: rl });
    const m2Ref = mkRef({ key: 'm2', tex: '\\overline{\\mathrm{d}\\hat X\\odot\\hat X}', label: 'media(dX̂⊙X̂)', mat: m2, rowAxis: 'T', colAxis: '1', role: 'grad', rowLabels: rl });
    v.flow([dY, ',', X, ',', G, '→', dX, ',', dG, ',', dB]);
    const L0 = v.line('0 · Del forward (caché): la entrada normalizada y su desviación');
    const hX = v.hm(X, {}, cellX), hXh = v.hm(xhRef, {}, cellX), hSg = v.hm(sgRef, { caption: 'compact', tag: false }, cellX);
    L0.term(hX).term(hXh, '↦').term(hSg, ',');
    const L1 = v.line('1 · Atravesar γ (regla de la cadena): dX̂ = dY ⊙ γ');
    const hdY = v.hm(dY, {}, cellDX), hG = v.hm(G, {}, cellParam), hdXh = v.hm(dxhRef, { tag: false }, cellDX);
    L1.term(hdY).term(hG, '⊙').term(hdXh, '=');
    const L2 = v.line('2 · Atravesar la normalización: restar las medias de cada fila y dividir por √(σ²+ε)');
    const hM1 = v.hm(m1Ref, { caption: 'compact', tag: false }, cellDX), hM2 = v.hm(m2Ref, { caption: 'compact', tag: false }, cellDX);
    const hdX = v.hm(dX, {}, cellDX);
    L2.term(hM1, { tex: '\\frac{1}{\\sqrt{\\sigma^2+\\varepsilon}}\\Big(\\mathrm{d}\\hat X\\; -' }).term(hM2, { tex: '-\\;\\hat X\\odot' }, { tex: '\\Big)' }).term(hdX, '=');
    const L3 = v.line('3 · Gradientes de los parámetros (suma sobre las T filas)');
    const hdG = v.hm(dG, {}, cellParam), hdB = v.hm(dB, {}, cellParam);
    L3.term(hdG, { tex: '\\textstyle\\sum_t \\mathrm{d}Y\\odot\\hat X =' }).term(hdB, { tex: '\\quad\\textstyle\\sum_t \\mathrm{d}Y =' });
    v.primary = hdX;
    v.note('Las dos medias restadas vienen de que μ y σ dependen de TODA la fila: mover un x cambia la media y la desviación que usan los demás. Por eso dX no es simplemente dX̂ / σ.');
    function cellX(hm, i, j) {
      if (i < 0) return null;
      hX.highlightRow(i, 'src'); hSg.highlightCell(i, 0, 'src'); hXh.highlightRow(i, 'src');
      if (j >= 0 && hm !== hSg) { hX.highlightCell(i, j, 'hl'); hXh.highlightCell(i, j, 'hl'); }
      return insp({ kind: 'grad_layernorm', title: 'Fila ' + i + ' en el forward', sub: where(X, i, -1),
        tex: '\\hat X[' + i + ',j] = \\frac{' + at(X.tex, i, 'j') + ' - \\mu_{' + i + '}}{\\sqrt{\\sigma^2_{' + i + '}+\\varepsilon}}',
        rows: [['μ' + sub(i), '= ' + f4(ax.mu.get(i, 0))], ['√(σ²+ε)', '= ' + f4(ax.sigma.get(i, 0))]].concat(j >= 0 && hm !== hSg ? [['x̂', '= (' + f4(X.mat.get(i, j)) + ' − ' + par(ax.mu.get(i, 0)) + ') / ' + f4(ax.sigma.get(i, 0)) + ' = ' + f4(ax.xhat.get(i, j))]] : []) });
    }
    function cellDX(hm, i, j) {
      if (i < 0) return null;
      if (hm === hM1 || hm === hM2 || j < 0) {
        hdXh.highlightRow(i, 'src'); hXh.highlightRow(i, 'alt'); hM1.highlightCell(i, 0, hm === hM1 ? 'hl' : 'src'); hM2.highlightCell(i, 0, hm === hM2 ? 'hl' : 'src');
        const t1 = [], t2 = [];
        for (let k = 0; k < d; k++) { t1.push(f4(ax.dxhat.get(i, k), 3)); t2.push(par(ax.dxhat.get(i, k)) + '·' + par(ax.xhat.get(i, k))); }
        return insp({ kind: 'grad_layernorm', title: 'Medias de la fila ' + i, sub: where(dY, i, -1),
          tex: '\\overline{\\mathrm{d}\\hat X}_{' + i + '} = \\frac1{' + d + '}\\sum_j \\mathrm{d}\\hat X[' + i + ',j],\\quad \\overline{\\mathrm{d}\\hat X\\odot\\hat X}_{' + i + '} = \\frac1{' + d + '}\\sum_j \\mathrm{d}\\hat X[' + i + ',j]\\,\\hat X[' + i + ',j]',
          rows: [['media(dX̂)', '= (' + sumStr(t1) + ') / ' + d + ' = ' + f4(m1.d[i])], ['media(dX̂⊙X̂)', '= (' + sumStr(t2) + ') / ' + d + ' = ' + f4(m2.d[i])]] });
      }
      for (const h of [hdY, hdXh, hdX, hXh]) h.highlightCell(i, j, h === hm ? 'hl' : 'src');
      hG.highlightCell(0, j, 'src'); hM1.highlightCell(i, 0, 'src'); hM2.highlightCell(i, 0, 'src'); hSg.highlightCell(i, 0, 'src');
      const dy = dY.mat.get(i, j), g = G.mat.get(0, j), dxh = ax.dxhat.get(i, j), xh = ax.xhat.get(i, j), sg = ax.sigma.get(i, 0);
      return insp({ kind: 'grad_layernorm', title: cellLab(dX, i, j), sub: where(dX, i, j),
        tex: at(dX.tex, i, j) + ' = \\frac{1}{\\sqrt{\\sigma^2_{' + i + '}+\\varepsilon}}\\Big(\\mathrm{d}\\hat X[' + i + ',' + j + '] - \\overline{\\mathrm{d}\\hat X}_{' + i + '} - \\hat X[' + i + ',' + j + ']\\,\\overline{\\mathrm{d}\\hat X\\odot\\hat X}_{' + i + '}\\Big)',
        rows: [['dx̂', '= dY · γ = ' + f4(dy) + ' · ' + par(g) + ' = ' + f4(dxh)], ['media(dX̂)', '= ' + f4(m1.d[i])], ['media(dX̂⊙X̂)', '= ' + f4(m2.d[i])], ['x̂', '= ' + f4(xh)],
          ['dX', '= (' + f4(dxh) + ' − ' + par(m1.d[i]) + ' − ' + par(xh) + '·' + par(m2.d[i]) + ') / ' + f4(sg) + ' = ' + f4(dX.mat.get(i, j), 6)]] });
    }
    function cellParam(hm, i, j) {
      if (j < 0) return null;
      if (hm === hG) { hG.highlightCell(0, j, 'hl'); hdY.highlightCol(j, 'src'); hdXh.highlightCol(j, 'src'); return insp({ kind: 'grad_layernorm', title: cellLab(G, 0, j), sub: 'multiplica a la columna ' + j, tex: at1(G.tex, j) + ' = ' + texNum(G.mat.get(0, j)), rows: [] }); }
      const isG = hm === hdG;
      hm.highlightCell(0, j, 'hl'); hdY.highlightCol(j, 'src'); if (isG) hXh.highlightCol(j, 'src');
      const terms = []; let sum = 0;
      for (let t = 0; t < T; t++) { const a = dY.mat.get(t, j); if (isG) { const b = ax.xhat.get(t, j); terms.push(par(a) + '·' + par(b)); sum += a * b; } else { terms.push(f4(a)); sum += a; } }
      return insp({ kind: 'grad_layernorm', title: cellLab(hm.ref, 0, j), sub: 'suma sobre las ' + T + ' filas de la columna ' + j,
        tex: at1(hm.ref.tex, j) + ' = \\sum_{t=0}^{' + (T - 1) + '} ' + at(dY.tex, 't', j) + (isG ? '\\,\\hat X[t,' + j + ']' : ''),
        rows: [['', '= ' + sumStr(terms) + ' = ' + f4(hm.mat.get(0, j), 6)]] });
    }
  };

  // ---- sumrows (gradiente de un sesgo)
  R.sumrows = function (v) {
    const s = v.step, X = s.inputs[0], b = s.outputs[0];
    const T = X.mat.r;
    v.flow([X, '→', { tex: '\\textstyle\\sum_t' }, '→', b]);
    const L = v.line();
    const hX = v.hm(X, {}, cell), hb = v.hm(b, {}, cell);
    L.term(hX).term(hb, { tex: '\\textstyle\\sum_{t}\\;\\mapsto' });
    v.primary = hb;
    v.note('En el forward el sesgo (1×n) se sumó a las ' + T + ' filas (broadcasting): cada fila «usó» el mismo sesgo, así que su gradiente es la <b>suma</b> de los gradientes de todas las filas (suma de cada columna).');
    function cell(hm, i, j) {
      if (j < 0) return genericCell.call(this, hm, i, j);
      if (hm === hX && i >= 0) { hX.highlightCell(i, j, 'hl'); hb.highlightCell(0, j, 'src'); return insp({ kind: 'sumrows', title: cellLab(X, i, j), sub: where(X, i, j), tex: at(X.tex, i, j) + ' = ' + texNum(X.mat.get(i, j)), rows: [['', 'Se suma a ' + (b.label || 'db') + '[' + j + '].']] }); }
      hX.highlightCol(j, 'src'); hb.highlightCell(0, j, 'hl');
      const terms = []; for (let t = 0; t < T; t++) terms.push(t ? par(X.mat.get(t, j)) : f4(X.mat.get(t, j)));
      return insp({ kind: 'sumrows', title: cellLab(b, 0, j), sub: 'columna ' + j,
        tex: at1(b.tex, j) + ' = \\sum_{t=0}^{' + (T - 1) + '} ' + at(X.tex, 't', j),
        rows: [['', '= ' + sumStr(terms) + ' = ' + f4(b.mat.get(0, j), 6)]] });
    }
  };

  // ---- norma del gradiente y recorte
  R.gradnorm = function (v) {
    const s = v.step, ax = s.aux;
    const total = ax.total, clip = ax.clip, factor = ax.factor;
    v.flow([{ text: 'todos los gradientes', shape: (ax.nParams || '') + ' números' }, '→', { tex: '\\|g\\|', shape: 'escalar' }]);
    const top = el('div', 'ov-gn');
    const big = el('div', 'ov-big');
    big.appendChild(texSpan('\\|g\\| = \\sqrt{\\textstyle\\sum_\\theta \\|\\mathrm{d}\\theta\\|^2}', 'ov-big__tex'));
    big.appendChild(el('div', 'ov-big__num', f4(total, 5)));
    top.appendChild(big);
    const gauge = el('div', 'ov-gauge');
    if (clip) {
      const scaleMax = Math.max(total, clip) * 1.1;
      gauge.innerHTML = '<div class="ov-gauge__track"><span class="ov-gauge__bar' + (ax.clipped ? ' is-over' : '') + '" style="width:' + ((total / scaleMax) * 100).toFixed(2) + '%"></span>' +
        '<span class="ov-gauge__tau" style="left:' + ((clip / scaleMax) * 100).toFixed(2) + '%"><span>τ = ' + esc(f4(clip)) + '</span></span></div>' +
        '<p class="ov-gauge__txt">' + (ax.clipped
          ? '‖g‖ = ' + f4(total, 4) + ' &gt; τ = ' + f4(clip) + ' ⇒ <b>se recorta</b>: c = τ/‖g‖ = ' + f4(factor, 4) + '. Todos los gradientes se multiplican por c; la dirección no cambia, solo la longitud (queda ‖c·g‖ = τ).'
          : '‖g‖ = ' + f4(total, 4) + ' ≤ τ = ' + f4(clip) + ' ⇒ no se recorta (c = 1).') + '</p>';
    } else {
      gauge.innerHTML = '<p class="ov-gauge__txt">Recorte desactivado: los gradientes se usan tal cual.</p>';
    }
    top.appendChild(gauge);
    v.body.appendChild(top);
    const body = v.card('Norma de cada gradiente ‖dθ‖ (antes del recorte)', 'ov-card--wide');
    const bars = el('div', 'ov-bars');
    body.appendChild(bars);
    const items = ax.norms.map((n) => ({ label: n.name, tex: '\\mathrm{d}' + n.tex, value: n.norm, colorVar: '--bwd', key: n.name, n }));
    const pick = (it) => {
      if (!it) return;
      const n = it.n;
      const share = total > 0 ? (n.norm * n.norm) / (total * total) : 0;
      v.inspect(insp({ kind: 'gradnorm', title: '‖d' + n.name + '‖', sub: 'parámetro ' + n.name,
        tex: '\\|\\mathrm{d}' + n.tex + '\\| = \\sqrt{\\textstyle\\sum_{i,j} (\\mathrm{d}' + n.tex + '[i,j])^2} = ' + texNum(n.norm),
        rows: [['‖dθ‖²', '= ' + f4(n.norm * n.norm)], ['parte de ‖g‖²', '= ' + f4(n.norm * n.norm) + ' / ' + f4(total * total) + ' = ' + pct(share)]].concat(clip && ax.clipped ? [['tras recortar', '= c · ‖dθ‖ = ' + f4(factor) + ' · ' + f4(n.norm) + ' = ' + f4(factor * n.norm)]] : []) }));
    };
    const chart = TL.Charts && TL.Charts.bars ? TL.Charts.bars(bars, items, { sort: 'desc', format: (x) => x.toFixed(4), onSelect: pick, ariaLabel: 'Norma del gradiente por parámetro' }) : null;
    if (chart) v.cleanups.push(() => chart.destroy());
    bars.addEventListener('mouseover', (e) => { const r = e.target.closest && e.target.closest('.chart-bars__row'); if (r && r._item && r._item !== bars._last) { bars._last = r._item; pick(r._item); } });
    body.appendChild(el('p', 'ov-card__cap', '‖g‖² es la suma de los cuadrados de las ' + ax.norms.length + ' normas. Pasa el cursor (o pulsa Intro) sobre una barra para ver su parte.'));
    v.note('La norma global mide el tamaño de TODO el gradiente como si fuera un único vector de ' + (ax.nParams || '') + ' números. El recorte evita pasos gigantes cuando el gradiente se dispara.');
    v.legendDisabled = true;
    v.animator = async function () {};
  };

  // ---- actualización de un parámetro (SGD / Adam)
  R.update = function (v) {
    const s = v.step, ax = s.aux;
    const th = s.inputs[0], g = s.inputs[1], thN = s.outputs[0];
    const adam = ax.optimizer === 'adam';
    const m0 = adam ? s.inputs[2] : null, v0 = adam ? s.inputs[3] : null, m1 = adam ? s.outputs[1] : null, v1 = adam ? s.outputs[2] : null;
    const rl = th.rowLabels, cl = th.colLabels;
    const base = { rowAxis: th.rowAxis, colAxis: th.colAxis, rowLabels: rl, colLabels: cl };
    const dRef = mkRef(Object.assign({ key: 'delta', tex: '\\Delta ' + ax.tex, label: 'Δ' + (th.label || ''), mat: ax.delta, role: 'act' }, base));
    const clipped = ax.clipFactor < 1;
    const lr = ax.lr, t = ax.t;
    const thMx = maxAbsOf([th, thN]);
    const MOM = { tag: 'momento', tagRole: 'mom' };
    if (adam) v.flow([th, ',', g, ',', m0, ',', v0, '→', thN, ',', m1, ',', v1], 'Adam · t = ' + t + ' · η = ' + f4(lr));
    else v.flow([th, ',', g, '→', thN], 'SGD · η = ' + f4(lr));
    const hs = {};
    const b1 = ax.beta1, b2 = ax.beta2;
    if (adam) {
      const mMx = maxAbsOf([m0, m1, g]), vMx = maxAbsOf([v0, v1]);
      const mh = mkRef(Object.assign({ key: 'mhat', tex: '\\hat m', label: 'm̂', mat: ax.mhat }, base));
      const vh = mkRef(Object.assign({ key: 'vhat', tex: '\\hat v', label: 'v̂', mat: ax.vhat }, base));
      const L1 = v.line('1 · Primer momento: media móvil del gradiente');
      hs.m0 = v.hm(m0, Object.assign({ maxAbs: mMx }, MOM), cell); hs.g = v.hm(g, { maxAbs: mMx }, cell); hs.m1 = v.hm(m1, Object.assign({ maxAbs: mMx }, MOM), cell);
      L1.term(hs.m0, { tex: String(b1) + '\\,\\cdot' }).term(hs.g, { tex: '+\\;' + fmtC(1 - b1) + '\\,\\cdot' }).term(hs.m1, '=');
      const L2 = v.line('2 · Segundo momento: media móvil del gradiente al cuadrado');
      hs.v0 = v.hm(v0, Object.assign({ maxAbs: vMx }, MOM), cell); hs.v1 = v.hm(v1, Object.assign({ maxAbs: vMx }, MOM), cell);
      L2.term(hs.v0, { tex: String(b2) + '\\,\\cdot' }).term(hs.v1, { tex: '+\\;' + fmtC(1 - b2) + '\\,\\cdot (' + g.tex + ')^2 =' });
      const L3 = v.line('3 · Corrección de sesgo (los momentos empiezan en 0)');
      hs.mh = v.hm(mh, { tag: false }, cell); hs.vh = v.hm(vh, { tag: false }, cell);
      L3.term(hs.mh, { tex: '\\hat m = \\frac{m}{1-' + b1 + '^{' + t + '}} =' }).term(hs.vh, { tex: '\\quad\\hat v = \\frac{v}{1-' + b2 + '^{' + t + '}} =' });
      const L4 = v.line('4 · Paso: θ ← θ − η · m̂ / (√v̂ + ε)');
      hs.th = v.hm(th, { maxAbs: thMx }, cell); hs.d = v.hm(dRef, {}, cell); hs.thN = v.hm(thN, { maxAbs: thMx }, cell);
      L4.term(hs.th).term(hs.d, '+').term(hs.thN, '=');
    } else {
      const L1 = v.line('1 · Paso de descenso de gradiente: Δθ = −η · g');
      hs.g = v.hm(g, {}, cell); hs.d = v.hm(dRef, {}, cell);
      L1.term(hs.g, { tex: '-' + texNum(lr) + '\\,\\cdot' }).term(hs.d, '=');
      const L2 = v.line('2 · Nuevo valor: θ ← θ + Δθ');
      hs.th = v.hm(th, { maxAbs: thMx }, cell); hs.thN = v.hm(thN, { maxAbs: thMx }, cell);
      L2.term(hs.th).term(hs.thN, { tex: '+\\;\\Delta ' + ax.tex + '\\;=' });
    }
    v.primary = hs.thN;
    let zeroRows = 0;
    if (th.rowAxis === 'V') for (let i = 0; i < g.mat.r; i++) { let z = true; for (let j = 0; j < g.mat.c; j++) if (g.mat.get(i, j) !== 0) { z = false; break; } if (z) zeroRows++; }
    const notes = [];
    if (clipped) notes.push('El gradiente usado es c·dθ con c = ' + f4(ax.clipFactor) + ' (recorte por norma global).');
    if (adam) {
      notes.push('Adam divide cada paso por √v̂: cada número del parámetro tiene su propia tasa de aprendizaje efectiva.' + (t === 1 ? ' En t = 1, m̂ = g y v̂ = g², así que Δθ ≈ −η·signo(g): cada número con gradiente distinto de 0 se mueve ≈ η = ' + f4(lr) + '.' : ''));
      if (zeroRows) notes.push(zeroRows + ' filas tienen gradiente 0 (tokens que no están en la frase)' + (t > 1 ? ', pero aun así se mueven: el momento m recuerda gradientes de iteraciones anteriores.' : ': en t = 1 no se mueven.'));
    } else {
      notes.push('SGD: Δθ = −η·g. El paso es proporcional al gradiente: donde el gradiente es grande, el cambio también.');
      if (zeroRows) notes.push(zeroRows + ' filas tienen gradiente 0 (tokens que no están en la frase) y no cambian.');
    }
    v.note(notes.join(' '));

    function cell(hm, i, j) {
      if (i < 0 || j < 0) return genericCell.call(this, hm, i, j);
      for (const k in hs) if (hs[k]) hs[k].highlightCell(i, j, hs[k] === hm ? 'hl' : 'src');
      const gv = g.mat.get(i, j), tv = th.mat.get(i, j), tn = thN.mat.get(i, j), dv = ax.delta.get(i, j);
      const rows = [];
      if (clipped) rows.push(['g = c·dθ', '= ' + f4(ax.clipFactor) + ' · ' + par(gv / ax.clipFactor) + ' = ' + f4(gv)]);
      else rows.push(['g', '= ' + f4(gv)]);
      let tex;
      if (adam) {
        const mo = m0.mat.get(i, j), vo = v0.mat.get(i, j), mn = m1.mat.get(i, j), vn = v1.mat.get(i, j), mh = ax.mhat.get(i, j), vh = ax.vhat.get(i, j);
        rows.push(['m', '= ' + b1 + '·' + par(mo) + ' + ' + fmtC(1 - b1) + '·' + par(gv) + ' = ' + f4(mn)]);
        rows.push(['v', '= ' + b2 + '·' + par(vo) + ' + ' + fmtC(1 - b2) + '·' + par(gv) + '² = ' + f4(vn)]);
        rows.push(['m̂', '= ' + f4(mn) + ' / (1 − ' + b1 + '^' + t + ') = ' + f4(mn) + ' / ' + f4(ax.bc1) + ' = ' + f4(mh)]);
        rows.push(['v̂', '= ' + f4(vn) + ' / (1 − ' + b2 + '^' + t + ') = ' + f4(vn) + ' / ' + f4(ax.bc2) + ' = ' + f4(vh)]);
        rows.push(['Δθ', '= −' + f4(lr) + ' · ' + par(mh) + ' / (√' + f4(vh) + ' + ' + f4(ax.eps) + ') = −' + f4(lr) + ' · ' + par(mh) + ' / ' + f4(Math.sqrt(vh) + ax.eps) + ' = ' + f4(dv)]);
        tex = '\\theta \\leftarrow \\theta - \\eta\\,\\frac{\\hat m}{\\sqrt{\\hat v}+\\epsilon},\\quad \\hat m = \\frac{m}{1-' + b1 + '^{' + t + '}},\\ \\hat v = \\frac{v}{1-' + b2 + '^{' + t + '}}';
      } else {
        rows.push(['Δθ', '= −η·g = −' + f4(lr) + ' · ' + par(gv) + ' = ' + f4(dv)]);
        tex = '\\theta \\leftarrow \\theta - \\eta\\,g,\\quad \\eta = ' + texNum(lr);
      }
      rows.push(['θ nuevo', '= ' + f4(tv) + ' + ' + par(dv) + ' = ' + f4(tn, 6)]);
      return insp({ kind: 'update', title: (th.label || 'θ') + '[' + i + ', ' + j + ']', sub: where(th, i, j), tex, rows });
    }
  };

  // ---- tokenización
  R.tokenize = function (v) {
    const s = v.step, ax = s.aux;
    const disp = (t) => (v.ctx.tok && v.ctx.tok.display ? v.ctx.tok.display(t) : TL.Tokenizer && TL.Tokenizer.displayToken ? TL.Tokenizer.displayToken(t) : t);
    const toks = ax.tokens.map(disp), ids = ax.ids, n = toks.length, T = ax.inputIds.length;
    v.flow([{ text: 'texto' }, '→', { text: n + ' tokens' }, '→', s.outputs[0], ',', { tex: 'y', shape: '1×' + T }]);
    const card = el('div', 'ov-tokz');
    card.appendChild(el('div', 'ov-tokz__text', '<span class="eyebrow">Texto</span><span class="ov-tokz__quote">«' + esc(ax.text) + '»</span>'));
    const grid = el('div', 'ov-seq');
    grid.style.gridTemplateColumns = 'max-content repeat(' + n + ', minmax(52px, max-content))';
    let h = '<div class="ov-seq__lab">índice</div>';
    for (let k = 0; k < n; k++) h += '<div class="ov-seq__ix">' + k + '</div>';
    h += '<div class="ov-seq__lab">tokens</div>';
    for (let k = 0; k < n; k++) h += '<button type="button" class="ov-tok" data-k="' + k + '" data-row="all"><span class="ov-tok__t">' + esc(toks[k]) + '</span><span class="ov-tok__id">id ' + ids[k] + '</span></button>';
    h += '<div class="ov-seq__lab">entrada · ids</div>';
    for (let k = 0; k < n; k++) h += k < T ? '<button type="button" class="ov-tok ov-tok--in" data-t="' + k + '" data-row="in"><span class="ov-tok__t">' + esc(toks[k]) + '</span><span class="ov-tok__id">t = ' + k + '</span></button>' : '<div></div>';
    h += '<div class="ov-seq__lab"></div>';
    for (let k = 0; k < n; k++) h += k < T ? '<div class="ov-seq__arrow" aria-hidden="true">↘</div>' : '<div></div>';
    h += '<div class="ov-seq__lab">objetivo · y</div>';
    for (let k = 0; k < n; k++) h += k >= 1 ? '<button type="button" class="ov-tok ov-tok--tgt" data-t="' + (k - 1) + '" data-row="tgt"><span class="ov-tok__t">' + esc(toks[k]) + '</span><span class="ov-tok__id">y<sub>' + (k - 1) + '</sub></span></button>' : '<div></div>';
    grid.innerHTML = h;
    const sc = el('div', 'ov-scroll');
    sc.appendChild(grid);
    card.appendChild(sc);
    v.body.appendChild(card);
    // ids e y como vectores 1×T
    const idsRef = s.outputs[0];
    const yRef = mkRef({ key: 'y', tex: 'y', label: 'y', mat: TL.Mat.fromRow(ax.targetIds), role: 'const', rowAxis: '1', colAxis: 'T', colLabels: ax.targetTokens.map(disp) });
    const L = v.line('Lo que recibe el modelo: dos vectores de ' + T + ' enteros');
    const hI = v.hm(idsRef, { scale: 'none', tag: false }, cellIds), hY = v.hm(yRef, { scale: 'none', tag: false }, cellIds);
    L.term(hI, { tex: '\\mathrm{ids} =' }).term(hY, { tex: '\\quad y =' });
    v.primary = hI;
    // vocabulario
    const vb = v.card('Vocabulario (V = ' + ax.vocab.length + ' tokens)', 'ov-card--wide');
    const used = new Set(ids);
    const strip = el('div', 'ov-vocab');
    strip.innerHTML = ax.vocab.map((t, k) => '<span class="ov-vtok' + (used.has(k) ? ' is-used' : '') + '"><span class="ov-vtok__id">' + k + '</span>' + esc(disp(t)) + '</span>').join('');
    vb.appendChild(strip);
    vb.appendChild(el('p', 'ov-card__cap', 'Resaltados: los tokens que aparecen en esta frase. El id de cada token es su posición en el vocabulario (orden de primera aparición en el corpus; &lt;s&gt; es el 0).'));
    v.note('<b>T = ' + T + '</b>: la frase tiene ' + n + ' tokens contando <code>&lt;s&gt;</code>. La entrada son los ' + T + ' primeros y el objetivo, los ' + T + ' últimos (desplazados una posición): en cada posición t el modelo debe predecir el token siguiente.' +
      (ax.truncated ? ' La frase se ha recortado a maxLen + 1 tokens.' : '') + (ax.mode === 'char' ? ' Modo carácter: cada letra (y el espacio, ␣) es un token.' : ''));
    v.legendDisabled = true;
    const btns = Array.from(grid.querySelectorAll('.ov-tok'));
    function pick(t, row, k) {
      for (const b of btns) b.classList.remove('is-hl', 'is-src');
      hI.clear(); hY.clear();
      if (row === 'all') {
        const b = btns.find((x) => x.dataset.row === 'all' && +x.dataset.k === k); if (b) b.classList.add('is-hl');
        const asIn = k < T, asT = k >= 1;
        if (asIn) { btns.filter((x) => x.dataset.row === 'in' && +x.dataset.t === k).forEach((x) => x.classList.add('is-src')); hI.highlightCell(0, k, 'src'); }
        if (asT) { btns.filter((x) => x.dataset.row === 'tgt' && +x.dataset.t === k - 1).forEach((x) => x.classList.add('is-src')); hY.highlightCell(0, k - 1, 'src'); }
        return insp({ kind: 'tokenize', title: 'Token ' + k + ': ' + tokQ(toks[k]), sub: 'id ' + ids[k],
          rows: [['vocabulario', 'vocab[' + ids[k] + '] = ' + toks[k]], ['papel', (asIn ? 'entrada en t = ' + k : '') + (asIn && asT ? '; ' : '') + (asT ? 'objetivo en t = ' + (k - 1) : '')]] });
      }
      btns.filter((x) => (x.dataset.row === 'in' || x.dataset.row === 'tgt') && +x.dataset.t === t).forEach((x) => x.classList.add('is-hl'));
      hI.highlightCell(0, t, 'hl'); hY.highlightCell(0, t, 'hl');
      return insp({ kind: 'tokenize', title: 'Posición t = ' + t, sub: tokQ(disp(ax.inputTokens[t])) + ' → ' + tokQ(disp(ax.targetTokens[t])),
        rows: [['entrada', 'ids[' + t + '] = ' + ax.inputIds[t] + ' (' + disp(ax.inputTokens[t]) + ')'], ['objetivo', 'y[' + t + '] = ' + ax.targetIds[t] + ' (' + disp(ax.targetTokens[t]) + ')']],
        note: 'Viendo ' + ax.inputTokens.slice(0, t + 1).map((x) => tokQ(disp(x))).join(' ') + ', el modelo debe predecir ' + tokQ(disp(ax.targetTokens[t])) + '.' });
    }
    const onTok = (e) => {
      const b = e.target.closest && e.target.closest('.ov-tok');
      if (!b) return;
      const html = b.dataset.row === 'all' ? pick(null, 'all', +b.dataset.k) : pick(+b.dataset.t, b.dataset.row);
      if (html) v.inspect(html);
    };
    grid.addEventListener('mouseover', onTok);
    grid.addEventListener('focusin', onTok);
    function cellIds(hm, i, j) { if (j < 0) return null; return pick(j, 'in'); }
    v.clearHooks.push(() => { for (const b of btns) b.classList.remove('is-hl', 'is-src'); });
    v.animator = async function (tok) {
      for (let t = 0; t < T && !tok.cancelled; t++) {
        const html = pick(t, 'in');
        if (html) this.inspect(html);
        await this.sleep(tok, Math.max(350, this.speed * 8));
      }
    };
  };

  // ---- lookup (embedding): onehot · E = X_emb
  R.lookup = function (v) {
    const s = v.step, ax = s.aux, O = s.inputs[0], E = s.inputs[1], X = s.outputs[0];
    const T = X.mat.r, d = X.mat.c, V = E.mat.r, ids = ax.ids;
    v.flow([O, '·', E, '→', X], 'en la práctica: copiar ' + T + ' filas (' + T * d + ' números) en vez de ' + (T * V * d).toLocaleString('es-ES') + ' multiplicaciones');
    const L = v.line();
    const mxE = maxAbsOf([E, X]);
    const hO = v.hm(O, {}, cellO), hE = v.hm(E, { maxAbs: mxE }, cellE), hX = v.hm(X, { maxAbs: mxE }, cellX);
    L.term(hO).term(hE, '·').term(hX, '=');
    for (let t = 0; t < T; t++) hO.mark(t, ids[t], 'pin');
    v.primary = hX;
    v.note('Cada fila de la matriz one-hot tiene un único 1 (en la columna del id): multiplicarla por E <b>selecciona</b> una fila de E. En la práctica no se multiplica: X_emb = E[ids]. La forma matricial explica el gradiente (dE = onehotᵀ · dX_emb).');
    function cellX(hm, t, j) {
      if (t < 0 && j < 0) return null;
      if (j === -1) {
        const id = ids[t];
        hX.highlightRow(t, 'hl'); hO.highlightRow(t, 'src'); hO.highlightCell(t, id, 'hl'); hE.highlightRow(id, 'src');
        return insp({ kind: 'lookup', title: (X.label || 'X_emb') + ' · fila ' + t, sub: where(X, t, -1) + ' · id ' + id,
          tex: at1(X.tex, t) + ' = ' + at1('E', id), rows: [['', 'La fila ' + t + ' de X_emb es una copia de la fila ' + id + ' de E (' + (E.rowLabels ? tokQ(E.rowLabels[id]) : '') + ').']] });
      }
      if (t === -1) { hX.highlightCol(j, 'hl'); hE.highlightCol(j, 'src'); return genericCell.call(this, hm, -1, j); }
      const id = ids[t];
      hO.highlightRow(t, 'src'); hO.highlightCell(t, id, 'hl'); hE.highlightCol(j, 'alt'); hE.highlightRow(id, 'src'); hE.highlightCell(id, j, 'hl'); hX.highlightCell(t, j, 'hl');
      const val = E.mat.get(id, j);
      return insp({ kind: 'lookup', title: cellLab(X, t, j), sub: where(X, t, j) + ' · id ' + id,
        tex: at(X.tex, t, j) + ' = \\sum_{v=0}^{' + (V - 1) + '} \\mathrm{onehot}[' + t + ',v]\\,E[v,' + j + '] = E[' + id + ',' + j + ']',
        rows: [['Σᵥ', '= 0·E[0,' + j + '] + … + 1·E[' + id + ',' + j + '] + … + 0·E[' + (V - 1) + ',' + j + ']'], ['resultado', '= E[' + id + ', ' + j + '] = ' + f4(val, 6)]],
        note: 'Solo un término es distinto de 0: el del token ' + tokQ(X.rowLabels ? X.rowLabels[t] : id) + ' (id ' + id + ').' });
    }
    function cellO(hm, t, k) {
      if (t < 0 || k < 0) return genericCell.call(this, hm, t, k);
      hO.highlightCell(t, k, 'hl');
      const one = O.mat.get(t, k) === 1;
      if (one) { hE.highlightRow(k, 'src'); hX.highlightRow(t, 'src'); }
      return insp({ kind: 'lookup', title: cellLab(O, t, k), sub: where(O, t, k), tex: '\\mathrm{onehot}[' + t + ',' + k + '] = ' + (one ? '1' : '0'),
        rows: [['', one ? 'El token de la posición ' + t + ' es el id ' + k + ': esta fila selecciona la fila ' + k + ' de E.' : 'La posición ' + t + ' no es el token ' + k + '.']] });
    }
    function cellE(hm, k, j) {
      if (k < 0 || j < 0) return genericCell.call(this, hm, k, j);
      hE.highlightCell(k, j, 'hl');
      const pos = []; for (let t = 0; t < T; t++) if (ids[t] === k) pos.push(t);
      for (const t of pos) { hX.highlightCell(t, j, 'src'); hO.highlightCell(t, k, 'src'); }
      return insp({ kind: 'lookup', title: cellLab(E, k, j), sub: where(E, k, j), tex: 'E[' + k + ',' + j + '] = ' + texNum(E.mat.get(k, j)),
        rows: [['', pos.length ? 'Se copia en X_emb[' + pos.join(', ') + ', ' + j + '].' : 'Este token no aparece en la frase: su fila no se usa.']] });
    }
  };

  // ---- gradiente del embedding: suma dispersa (scatter-add)
  R.grad_lookup = function (v) {
    const s = v.step, ax = s.aux, OT = s.inputs[0], dX = s.inputs[1], dE = s.outputs[0];
    const T = dX.mat.r, d = dX.mat.c, V = dE.mat.r, ids = ax.ids;
    const mx = maxAbsOf([dX, dE]);
    v.flow([OT, '·', dX, '→', dE], 'en la práctica: sumar ' + T + ' filas en dE (scatter-add)');
    const L = v.line();
    const hO = v.hm(OT, {}, cellO), hX = v.hm(dX, { maxAbs: mx }, cellX), hE = v.hm(dE, { maxAbs: mx }, cellE);
    L.term(hO).term(hX, '·').term(hE, '=');
    for (let t = 0; t < T; t++) hO.mark(ids[t], t, 'pin');
    v.primary = hE;
    // lista de filas destino
    const groups = new Map();
    ids.forEach((id, t) => { if (!groups.has(id)) groups.set(id, []); groups.get(id).push(t); });
    const body = v.card('Qué fila de dX_emb va a qué fila de dE', 'ov-card--wide');
    const list = el('div', 'ov-scatter');
    const vocab = dE.rowLabels || [];
    const toks = dX.rowLabels || [];
    for (const [id, ts] of groups) {
      const r = el('button', 'ov-scatter__row');
      r.type = 'button';
      r.dataset.id = id;
      r.innerHTML = '<span class="ov-scatter__dst">dE[' + id + '] <span class="muted">' + esc(vocab[id] || '') + '</span></span><span class="ov-scatter__arrow">←</span>' +
        ts.map((t) => '<span class="ov-scatter__src">dX_emb[' + t + '] <span class="muted">' + esc(toks[t] || '') + '</span></span>').join('<span class="ov-scatter__plus">+</span>') +
        (ts.length > 1 ? '<span class="chip chip--bwd ov-scatter__rep">repetido: se suman</span>' : '');
      r.addEventListener('mouseenter', () => v.hover(hE, id, -1));
      r.addEventListener('focus', () => v.hover(hE, id, -1));
      list.appendChild(r);
    }
    body.appendChild(list);
    body.appendChild(el('p', 'ov-card__cap', 'Las otras ' + (V - groups.size) + ' filas de dE son 0: esos tokens no aparecen en la frase y no reciben gradiente.'));
    v.note('Cada fila de dX_emb vuelve a la fila de E de la que salió. Si un token aparece varias veces, sus gradientes se <b>suman</b> (en NumPy: <code>np.add.at(dE, ids, dX_emb)</code>).');
    function cellE(hm, k, j) {
      if (k < 0) return genericCell.call(this, hm, k, j);
      const ts = groups.get(k) || [];
      if (j < 0) {
        hE.highlightRow(k, 'hl'); hO.highlightRow(k, 'src');
        for (const t of ts) hX.highlightRow(t, 'src');
        return insp({ kind: 'grad_lookup', title: (dE.label || 'dE') + ' · fila ' + k, sub: where(dE, k, -1),
          tex: at1(dE.tex, k) + ' = ' + (ts.length ? ts.map((t) => at1(dX.tex, t)).join(' + ') : '0'), rows: [['', ts.length ? 'Suma de ' + ts.length + ' fila(s) de dX_emb.' : 'Fila nula: el token no aparece.']] });
      }
      hE.highlightCell(k, j, 'hl'); hO.highlightRow(k, 'src');
      for (const t of ts) hX.highlightCell(t, j, 'src');
      const terms = ts.map((t) => f4(dX.mat.get(t, j)));
      return insp({ kind: 'grad_lookup', title: cellLab(dE, k, j), sub: where(dE, k, j),
        tex: at(dE.tex, k, j) + ' = \\sum_{t:\\ \\mathrm{ids}_t = ' + k + '} ' + at(dX.tex, 't', j),
        rows: [['', ts.length ? '= ' + terms.join(' + ') + ' = ' + f4(dE.mat.get(k, j), 6) : '= 0 (ninguna posición tiene este token)']] });
    }
    function cellX(hm, t, j) {
      if (t < 0) return genericCell.call(this, hm, t, j);
      const id = ids[t];
      if (j < 0) { hX.highlightRow(t, 'hl'); hE.highlightRow(id, 'src'); hO.highlightCell(id, t, 'hl'); return insp({ kind: 'grad_lookup', title: 'fila ' + t + ' de ' + (dX.label || 'dX_emb'), sub: where(dX, t, -1), rows: [['destino', 'fila ' + id + ' de dE']] }); }
      hX.highlightCell(t, j, 'hl'); hE.highlightCell(id, j, 'src'); hO.highlightCell(id, t, 'hl');
      return insp({ kind: 'grad_lookup', title: cellLab(dX, t, j), sub: where(dX, t, j), tex: at(dX.tex, t, j) + '\\;\\to\\;' + at(dE.tex, id, j), rows: [['valor', f4(dX.mat.get(t, j), 6)]] });
    }
    function cellO(hm, k, t) {
      if (k < 0 || t < 0) return genericCell.call(this, hm, k, t);
      hO.highlightCell(k, t, 'hl');
      const one = OT.mat.get(k, t) === 1;
      if (one) { hX.highlightRow(t, 'src'); hE.highlightRow(k, 'src'); }
      return insp({ kind: 'grad_lookup', title: cellLab(OT, k, t), sub: where(OT, k, t), tex: '\\mathrm{onehot}^{\\top}[' + k + ',' + t + '] = ' + (one ? '1' : '0'), rows: [['', one ? 'La fila ' + t + ' de dX_emb se suma a la fila ' + k + ' de dE.' : 'Sin contribución.']] });
    }
  };

  // ---- genérico (cualquier tipo sin vista propia)
  R.generic = function (v) {
    const s = v.step;
    const f = [];
    s.inputs.forEach((r, k) => { if (k) f.push(','); f.push(r); });
    if (s.outputs.length) { f.push('→'); s.outputs.forEach((r, k) => { if (k) f.push(','); f.push(r); }); }
    v.flow(f);
    const L = v.line();
    s.inputs.forEach((r, k) => L.term(v.hm(r), k ? ',' : null));
    s.outputs.forEach((r, k) => { const h = v.hm(r); L.term(h, k ? ',' : '↦'); v.primary = h; });
    if (!s.inputs.length && !s.outputs.length) v.note('Este paso no tiene matrices que mostrar.');
  };

  const fmtC = (x) => {
    // coeficiente compacto para LaTeX (0.1, 0.001)
    const r = +x.toPrecision(6);
    return String(r);
  };

  // ------------------------------------------------------------------ punto de entrada
  function render(step, containerEl, ctx) {
    if (!step || !containerEl) throw new Error('OpViews.render: faltan el paso o el contenedor');
    const v = new View(step, containerEl, ctx);
    const fn = R[step.kind] || R.generic;
    try {
      fn(v);
    } catch (e) {
      if (root.console) console.warn('OpViews: la vista «' + step.kind + '» falló; se usa la genérica', e);
      for (const h of v.hms) h.destroy();
      const v2 = new View(step, containerEl, ctx);
      R.generic(v2);
      v2.mount();
      return api(v2);
    }
    v.mount();
    return api(v);
  }
  function api(v) {
    return { el: v.root, heatmaps: v.hms, animate: () => v.animate(), destroy: () => v.destroy(), layout: () => { v._lastW = 0; v.layout(); } };
  }

  TL.OpViews = { render, renderers: R, kinds: Object.keys(R).filter((k) => k !== 'generic'), _insp: insp };
})(typeof window !== 'undefined' ? window : globalThis);
