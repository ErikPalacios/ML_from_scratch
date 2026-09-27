/* =============================================================================
   Transformer Lab — js/ui/charts.js
   TL.Charts: gráficos ligeros, sin dependencias, sensibles al tema (leen variables CSS
   en cada dibujo), HiDPI y con ResizeObserver.

   API (spec §9.5):
     TL.Charts.line(canvas, series, opts)   series: [{name, points:[[x,y]] | number[], colorVar, faint, dashed, width}]
        opts: {logY, xLabel, yLabel, xName, yMin, yMax, xMin, xMax, includeZero, area, areaIndex,
               showLast, format(v), height, legend, emptyText, ariaLabel}
     TL.Charts.bars(el, items, opts)        items: [{label, value, colorVar, tex?, key?, highlight?}]
        opts: {format(v), min, max, colorVar, sort ('desc'|'abs'|false), limit, compact, onSelect(item), ariaLabel}
     TL.Charts.scatter(canvas, points, opts)  points: [{x, y, label, colorVar?, highlight?}]
        opts: {colorVar, xLabel, yLabel, equal (true), height, format(v), emptyText, ariaLabel}
   Cada llamada devuelve un objeto {update(data, opts), redraw(), destroy()}; volver a llamar
   sobre el mismo canvas/elemento reutiliza (y actualiza) el gráfico existente.
   TL.Charts.redrawAll() — redibuja todo (se llama solo al cambiar el tema).
   Utilidades: TL.Charts.fmt(v), TL.Charts.niceTicks(min, max, n), TL.Charts.texLite(tex),
               TL.Charts.tip.show(buildFn|string, clientX, clientY) / tip.hide()
   ========================================================================== */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const registry = new Set();
  const DEFAULT_COLORS = ['--fwd', '--bwd', '--upd', '--data'];

  // ---------------------------------------------------------------------------
  // números
  // ---------------------------------------------------------------------------
  const MINUS = '−';
  function fmt(v, digits) {
    if (v == null || Number.isNaN(v)) return '—';
    if (!Number.isFinite(v)) return v > 0 ? '∞' : MINUS + '∞';
    const a = Math.abs(v);
    let s;
    if (digits != null) s = v.toFixed(digits);
    else if (a === 0) s = '0';
    else if (a >= 1e5 || a < 1e-3) s = v.toExponential(2).replace('e+', 'e');
    else if (a >= 100) s = v.toFixed(1);
    else if (a >= 10) s = v.toFixed(2);
    else s = v.toFixed(3);
    return s.replace(/^-/, MINUS).replace('e-', 'e' + MINUS);
  }
  // etiqueta de marca: decimales según el paso; notación científica para pasos muy grandes o
  // muy pequeños, con las cifras justas para que dos marcas vecinas nunca se lean igual
  function fmtTick(v, step) {
    if (Math.abs(v) < step * 1e-9) v = 0;
    const a = Math.abs(v);
    if (step < 1e-4 || step >= 1e5 || a >= 1e6) {
      if (v === 0) return '0';
      const d = Math.max(0, Math.min(6, Math.floor(Math.log10(a) + 1e-9) - Math.floor(Math.log10(step) + 1e-9)));
      return v.toExponential(d).replace('e+', 'e').replace(/^-/, MINUS).replace('e-', 'e' + MINUS);
    }
    const dec = step >= 1 ? 0 : Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
    return v.toFixed(dec).replace(/^-/, MINUS);
  }
  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range));
    const f = range / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function niceTicks(min, max, count) {
    count = Math.max(2, Math.min(50, count || 5));
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
    if (max < min) { const t = min; min = max; max = t; }
    // rango nulo o por debajo de la precisión de float64 → se abre alrededor del valor
    const mag = Math.max(Math.abs(min), Math.abs(max));
    if (!(max - min > mag * 1e-9)) { const d = mag || 1; min -= d * 0.5; max += d * 0.5; }
    const step = niceNum((max - min) / (count - 1), true);
    const i0 = Math.floor(min / step), i1 = Math.ceil(max / step);
    const ticks = [];
    // índices enteros (no acumulación v += step): siempre termina
    for (let i = i0; i <= i1 && ticks.length < 200; i++) ticks.push(+(i * step).toPrecision(12));
    return { ticks, step, lo: i0 * step, hi: i1 * step };
  }
  function logTicks(min, max) {
    if (!(min > 0) || !Number.isFinite(min)) min = 1e-12;
    if (!(max > min) || !Number.isFinite(max)) max = min * 10;
    const a = Math.floor(Math.log10(min)), b = Math.ceil(Math.log10(max));
    const span = b - a;
    const out = [];
    for (let e = a; e <= b; e++) {
      const base = Math.pow(10, e);
      out.push(base);
      if (span <= 2) out.push(2 * base, 5 * base);
    }
    let ticks = out.filter((t) => t >= min * 0.999 && t <= max * 1.001);
    if (ticks.length < 2) {
      ticks = [];
      for (let e = a; e <= b; e++) for (const m of [1, 2, 3, 5]) { const t = m * Math.pow(10, e); if (t >= min && t <= max) ticks.push(t); }
    }
    return ticks.sort((x, y) => x - y);
  }

  // recorta un texto con '…' para que quepa en maxW (px, con la fuente actual del ctx)
  function fitText(ctx, s, maxW) {
    s = String(s == null ? '' : s);
    if (!s || maxW <= 0) return '';
    if (ctx.measureText(s).width <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, m) + '…').width <= maxW) lo = m; else hi = m - 1;
    }
    return lo ? s.slice(0, lo).trimEnd() + '…' : '';
  }

  // ---------------------------------------------------------------------------
  // tema / colores
  // ---------------------------------------------------------------------------
  function normVar(v) {
    if (!v) return null;
    v = String(v).trim();
    const m = v.match(/^var\((--[\w-]+)\)$/);
    if (m) return m[1];
    if (v.startsWith('--')) return v;
    if (/^[a-z][\w-]*$/i.test(v) && !/^(red|blue|green|black|white|gray|grey|orange|purple|teal|transparent)$/i.test(v)) return '--' + v;
    return null; // color literal
  }
  function readTheme(el) {
    const cs = getComputedStyle(el);
    const g = (n, fb) => (cs.getPropertyValue(n) || '').trim() || fb;
    return {
      ink: g('--ink', '#15202B'), muted: g('--muted', '#5A6774'), rule: g('--rule', '#C9D2DB'),
      ruleStrong: g('--rule-strong', '#95A4B2'), surface: g('--surface', '#F8FAFB'), grid: g('--grid', '#DCE2E8'),
      mono: g('--font-mono', 'ui-monospace, monospace'), body: g('--font-body', 'system-ui, sans-serif'),
      color(v, i) {
        const name = normVar(v);
        if (name) return g(name, '#888');
        if (v) return v;
        return g(DEFAULT_COLORS[(i || 0) % DEFAULT_COLORS.length], '#888');
      },
    };
  }
  function rgba(color, a) {
    const c = String(color).trim();
    let m = c.match(/^#([0-9a-f]{3,8})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
      return 'rgba(' + p.join(',') + ',' + a + ')';
    }
    return c;
  }

  // ---------------------------------------------------------------------------
  // tooltip compartido (DOM, textContent)
  // ---------------------------------------------------------------------------
  const tip = {
    el: null,
    show(build, clientX, clientY) {
      if (!this.el) {
        this.el = document.createElement('div');
        this.el.className = 'tooltip chart-tip';
        this.el.setAttribute('role', 'tooltip');
        document.body.appendChild(this.el);
      }
      const t = this.el;
      t.textContent = '';
      if (typeof build === 'function') build(t); else t.textContent = String(build);
      t.classList.add('is-visible');
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const r = t.getBoundingClientRect();
      let x = clientX + 14, y = clientY - r.height - 10;
      if (x + r.width > vw - 8) x = clientX - r.width - 14;
      if (x < 8) x = 8;
      if (y < 8) y = clientY + 18;
      if (y + r.height > vh - 8) y = vh - r.height - 8;
      t.style.left = Math.round(x) + 'px';
      t.style.top = Math.round(y) + 'px';
    },
    hide() { if (this.el) this.el.classList.remove('is-visible'); },
  };
  function tipRow(parent, color, val, name, dot) {
    const row = document.createElement('div');
    row.className = 'tooltip__row';
    const k = document.createElement('span');
    k.className = 'tooltip__key' + (dot ? ' tooltip__key--dot' : '');
    k.style.setProperty('--c', color);
    const v = document.createElement('span');
    v.className = 'tooltip__val';
    v.textContent = val;
    row.append(k, v);
    if (name) {
      const n = document.createElement('span');
      n.className = 'tooltip__name';
      n.textContent = name;
      row.append(n);
    }
    parent.appendChild(row);
  }
  function tipTitle(parent, text) {
    const d = document.createElement('div');
    d.className = 'tooltip__title';
    d.textContent = text;
    parent.appendChild(d);
  }

  // ---------------------------------------------------------------------------
  // base de gráficos en canvas
  // ---------------------------------------------------------------------------
  function setupCanvas(canvas, opts) {
    if (opts && opts.height) canvas.style.height = opts.height + 'px';
    let w = canvas.clientWidth, h = canvas.clientHeight;
    if (!h && !(opts && opts.height)) { canvas.style.height = '220px'; h = canvas.clientHeight; }
    if (!w || !h) return null;
    const dpr = Math.max(1, Math.min(3, root.devicePixelRatio || 1));
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h, dpr };
  }

  class CanvasChart {
    constructor(canvas, data, opts) {
      this.canvas = canvas;
      this.data = data;
      this.opts = Object.assign({}, opts || {});
      this.hover = null;
      this.destroyed = false;
      if (!canvas.classList.contains('chart-canvas')) canvas.classList.add('chart-canvas');
      if (!canvas.hasAttribute('role')) canvas.setAttribute('role', 'img');
      // explorable con teclado (←/→) salvo que la app decida otra cosa
      if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
      this._onMove = (e) => this.onPointer(e);
      this._onLeave = () => { this.hover = null; tip.hide(); this.draw(); };
      this._onKey = (e) => {
        if (e.key === 'Escape' && this.hover != null) { this._onLeave(); return; }
        if (this.onKey) this.onKey(e);
      };
      this._onBlur = () => { this.hover = null; tip.hide(); this.draw(); };
      canvas.addEventListener('pointermove', this._onMove);
      canvas.addEventListener('pointerdown', this._onMove);
      canvas.addEventListener('pointerleave', this._onLeave);
      canvas.addEventListener('keydown', this._onKey);
      canvas.addEventListener('blur', this._onBlur);
      this.lastW = 0; this.lastH = 0;
      if (typeof ResizeObserver !== 'undefined') {
        this.ro = new ResizeObserver(() => {
          const w = canvas.clientWidth, h = canvas.clientHeight;
          if (w !== this.lastW || h !== this.lastH) this.draw();
        });
        this.ro.observe(canvas);
      }
      registry.add(this);
      ensureThemeWatch();
    }
    update(data, opts) {
      this.data = data;
      if (opts) this.opts = Object.assign({}, opts);
      this.draw();
      return this;
    }
    redraw() { this.draw(); return this; }
    draw() {
      if (this.destroyed) return;
      registry.add(this);
      const s = setupCanvas(this.canvas, this.opts);
      if (!s) return;
      this.lastW = s.w; this.lastH = s.h;
      this.theme = readTheme(this.canvas);
      this.render(s.ctx, s.w, s.h, this.theme);
    }
    destroy() {
      this.destroyed = true;
      registry.delete(this);
      if (this.ro) this.ro.disconnect();
      const c = this.canvas;
      c.removeEventListener('pointermove', this._onMove);
      c.removeEventListener('pointerdown', this._onMove);
      c.removeEventListener('pointerleave', this._onLeave);
      c.removeEventListener('keydown', this._onKey);
      c.removeEventListener('blur', this._onBlur);
      if (c.__tlChart === this) delete c.__tlChart;
      tip.hide();
    }
    localXY(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
  }

  function empty(ctx, w, h, th, text) {
    ctx.save();
    ctx.strokeStyle = th.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.fillStyle = th.muted;
    ctx.font = '400 12px ' + th.body;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text || 'Sin datos todavía', w / 2, h / 2);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // LÍNEA (curva de pérdida)
  // ---------------------------------------------------------------------------
  function normPoints(points) {
    if (!points || !points.length) return [];
    if (typeof points[0] === 'number') return points.map((y, i) => [i, y]);
    if (!Array.isArray(points[0]) && typeof points[0] === 'object') return points.map((p) => [p.x, p.y]);
    return points;
  }
  function decimate(pts, px, plotX) {
    const out = [];
    let col = null, first = null, mn = null, mx = null, last = null;
    const flush = () => {
      if (!first) return;
      out.push(first);
      const a = mn[0] <= mx[0] ? mn : mx, b = a === mn ? mx : mn;
      if (a !== first && a !== last) out.push(a);
      if (b !== first && b !== last && b !== a) out.push(b);
      if (last !== first) out.push(last);
    };
    for (const p of pts) {
      const c = Math.floor(px(p[0]) - plotX);
      if (c !== col) { flush(); col = c; first = mn = mx = last = p; }
      else { if (p[1] < mn[1]) mn = p; if (p[1] > mx[1]) mx = p; last = p; }
    }
    flush();
    return out;
  }
  function nearestIdx(pts, x) {
    let lo = 0, hi = pts.length - 1;
    if (hi < 0) return -1;
    let sorted = true;
    for (let i = 1; i < pts.length && sorted; i += Math.max(1, (pts.length / 64) | 0)) if (pts[i][0] < pts[i - 1][0]) sorted = false;
    if (!sorted) {
      let bi = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; bi = i; } });
      return bi;
    }
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][0] < x) lo = m; else hi = m; }
    return Math.abs(pts[lo][0] - x) <= Math.abs(pts[hi][0] - x) ? lo : hi;
  }

  class LineChart extends CanvasChart {
    constructor(canvas, series, opts) { super(canvas, series, opts); this.type = 'line'; this.draw(); }
    render(ctx, w, h, th) {
      const o = this.opts;
      const logY = !!o.logY;
      const fmtV = o.format || fmt;
      const ser = (this.data || []).map((s, i) => ({
        name: s.name || '', faint: !!s.faint, dashed: !!s.dashed, width: s.width,
        color: th.color(s.colorVar, i),
        pts: normPoints(s.points).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!logY || p[1] > 0)),
      }));
      this.ser = ser;
      const all = ser.flatMap((s) => s.pts);
      if (!all.length) { this.geom = null; empty(ctx, w, h, th, o.emptyText); this.setAria(null); return; }

      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const p of all) { if (p[0] < xmin) xmin = p[0]; if (p[0] > xmax) xmax = p[0]; if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
      if (Number.isFinite(o.xMin)) xmin = o.xMin; if (Number.isFinite(o.xMax)) xmax = o.xMax;
      if (xmax <= xmin) { xmax = xmin + 1; }
      const includeZero = o.includeZero != null ? o.includeZero : !logY;
      const okLim = (v) => Number.isFinite(v) && (!logY || v > 0); // en log solo valen límites > 0
      if (okLim(o.yMin)) ymin = o.yMin; else if (includeZero && !logY) ymin = Math.min(0, ymin);
      if (okLim(o.yMax)) ymax = o.yMax;
      if (ymax < ymin) { const t = ymin; ymin = ymax; ymax = t; }
      let yt;
      if (logY) {
        const lmin = Math.log10(ymin), lmax = Math.log10(ymax);
        const pad = Math.max(0.04, (lmax - lmin) * 0.06);
        ymin = Math.pow(10, lmin - pad); ymax = Math.pow(10, lmax + pad);
        yt = logTicks(ymin, ymax);
      } else {
        if (ymax <= ymin) { ymax = ymin + (Math.abs(ymin) || 1); }
        const nt = niceTicks(ymin, ymax + (!okLim(o.yMax) ? (ymax - ymin) * 0.04 : 0), Math.max(3, Math.floor(h / 48)));
        if (!okLim(o.yMin)) ymin = nt.lo; if (!okLim(o.yMax)) ymax = nt.hi;
        yt = nt.ticks.filter((t) => t >= ymin - 1e-12 && t <= ymax + 1e-12);
        this.yStep = nt.step;
      }
      const tf = logY ? (v) => Math.log10(v) : (v) => v;
      const trimZ = (x) => (x.includes('.') && !x.includes('e') ? x.replace(/0+$/, '').replace(/\.$/, '') : x);
      const tickLabel = (t) => logY ? trimZ(fmt(t)) : fmtTick(t, this.yStep);

      const monoF = (px, wt) => (wt || 400) + ' ' + px + 'px ' + th.mono;
      ctx.font = monoF(11);
      let labW = 0;
      for (const t of yt) labW = Math.max(labW, ctx.measureText(tickLabel(t)).width);
      const showLegend = o.legend != null ? o.legend : ser.length >= 2;
      const header = showLegend || o.yLabel ? 20 : 0;
      const main = ser[o.areaIndex || 0] || ser[0];
      const lastP = main.pts[main.pts.length - 1];
      ctx.font = monoF(11.5, 600);
      const lastLab = lastP && o.showLast !== false ? fmtV(lastP[1]) : '';
      const lastW = lastLab ? ctx.measureText(lastLab).width + 14 : 0;
      const plot = { x: Math.ceil(labW + 12), y: 8 + header, w: 0, h: 0 };
      plot.w = Math.max(20, w - plot.x - Math.max(10, lastW));
      plot.h = Math.max(20, h - plot.y - (o.xLabel ? 34 : 22));
      const px = (x) => plot.x + ((x - xmin) / (xmax - xmin)) * plot.w;
      const py = (y) => plot.y + plot.h - ((tf(y) - tf(ymin)) / (tf(ymax) - tf(ymin))) * plot.h;
      this.geom = { plot, px, py, xmin, xmax };

      // cuadrícula + etiquetas Y
      ctx.lineWidth = 1;
      ctx.font = monoF(11);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const t of yt) {
        const y = Math.round(py(t)) + 0.5;
        ctx.strokeStyle = rgba(th.rule, 0.75);
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
        ctx.fillStyle = th.muted;
        ctx.fillText(tickLabel(t), plot.x - 7, y);
      }
      // eje X
      const baseY = Math.round(plot.y + plot.h) + 0.5;
      ctx.strokeStyle = th.ruleStrong;
      ctx.beginPath(); ctx.moveTo(plot.x, baseY); ctx.lineTo(plot.x + plot.w, baseY); ctx.stroke();
      const xt = niceTicks(xmin, xmax, Math.max(3, Math.floor(plot.w / 60)));
      const intX = all.every((p) => Number.isInteger(p[0]));
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = th.muted;
      let lastRight = -Infinity;
      for (const t of xt.ticks) {
        if (t < xmin - 1e-9 || t > xmax + 1e-9) continue;
        if (intX && !Number.isInteger(t)) continue;
        const x = Math.round(px(t)) + 0.5;
        ctx.strokeStyle = th.ruleStrong;
        ctx.beginPath(); ctx.moveTo(x, baseY); ctx.lineTo(x, baseY + 4); ctx.stroke();
        const lab = fmtTick(t, intX ? Math.max(1, xt.step) : xt.step);
        const lw = ctx.measureText(lab).width;
        if (x - lw / 2 > lastRight + 6 && x + lw / 2 <= w) { ctx.fillText(lab, x, baseY + 6); lastRight = x + lw / 2; }
      }
      if (o.xLabel) {
        ctx.textAlign = 'right'; ctx.font = '400 11px ' + th.body;
        ctx.fillText(fitText(ctx, o.xLabel, plot.w), plot.x + plot.w, baseY + 20);
      }
      // cabecera: etiqueta Y + leyenda
      let hx = 0;
      ctx.textBaseline = 'middle';
      if (o.yLabel) {
        ctx.textAlign = 'left'; ctx.fillStyle = th.muted; ctx.font = '500 11px ' + th.body;
        const yl = fitText(ctx, o.yLabel, showLegend ? w * 0.45 : w);
        ctx.fillText(yl, 0, 10);
        hx = ctx.measureText(yl).width + 16;
      }
      if (showLegend) {
        ctx.font = '400 11.5px ' + th.body;
        for (const s of ser) {
          if (!s.name) continue;
          const name = fitText(ctx, s.name, w - hx - 19);
          if (!name || name.length < Math.min(4, String(s.name).length)) break;
          const lw = ctx.measureText(name).width;
          ctx.strokeStyle = s.color; ctx.lineWidth = s.faint ? 1.5 : 2; ctx.globalAlpha = s.faint ? 0.55 : 1;
          ctx.setLineDash(s.dashed ? [4, 3] : []);
          ctx.beginPath(); ctx.moveTo(hx, 10.5); ctx.lineTo(hx + 14, 10.5); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
          ctx.fillStyle = th.ink; ctx.textAlign = 'left';
          ctx.fillText(name, hx + 19, 10.5);
          hx += 19 + lw + 14;
        }
      }

      // área bajo la serie principal
      ctx.save();
      ctx.beginPath(); ctx.rect(plot.x, plot.y - 6, plot.w + 1, plot.h + 7); ctx.clip();
      const drawn = ser.map((s) => (s.pts.length > plot.w * 2 ? decimate(s.pts, px, plot.x) : s.pts));
      const mi = ser.indexOf(main);
      if (o.area !== false && drawn[mi].length > 1) {
        const pts = drawn[mi];
        const grad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
        grad.addColorStop(0, rgba(main.color, 0.2));
        grad.addColorStop(1, rgba(main.color, 0.02));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
        for (const p of pts) ctx.lineTo(px(p[0]), py(p[1]));
        ctx.lineTo(px(pts[pts.length - 1][0]), plot.y + plot.h);
        ctx.lineTo(px(pts[0][0]), plot.y + plot.h);
        ctx.closePath(); ctx.fill();
      }
      // líneas (tenues primero)
      const order = ser.map((s, i) => i).sort((a, b) => (ser[b].faint - ser[a].faint) || (a === mi ? 1 : b === mi ? -1 : 0));
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const i of order) {
        const s = ser[i], pts = drawn[i];
        if (!pts.length) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width || (s.faint ? 1.25 : 2);
        ctx.globalAlpha = s.faint ? 0.45 : 1;
        ctx.setLineDash(s.dashed ? [5, 4] : []);
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo(px(p[0]), py(p[1])) : ctx.moveTo(px(p[0]), py(p[1]))));
        if (pts.length === 1) { ctx.arc(px(pts[0][0]), py(pts[0][1]), 1, 0, 7); }
        ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      ctx.restore();

      const dot = (x, y, color, r) => {
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fillStyle = th.surface; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      };
      // hover: línea vertical + puntos
      if (this.hover != null && this.geom) {
        const hx2 = Math.round(px(this.hover)) + 0.5;
        ctx.strokeStyle = th.muted; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(hx2, plot.y); ctx.lineTo(hx2, plot.y + plot.h); ctx.stroke();
        ctx.globalAlpha = 1;
        for (const s of ser) {
          const k = nearestIdx(s.pts, this.hover);
          if (k < 0) continue;
          const p = s.pts[k];
          dot(px(p[0]), py(p[1]), s.color, 3.5);
        }
      }
      // último punto destacado + valor
      if (lastP && o.showLast !== false) {
        const x = px(lastP[0]), y = py(lastP[1]);
        dot(x, y, main.color, 4);
        ctx.font = monoF(11.5, 600);
        ctx.fillStyle = th.ink;
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(lastLab).width;
        let lx = x + 9, ly = y;
        ctx.textAlign = 'left';
        if (lx + tw > w - 1) { lx = x - 9; ctx.textAlign = 'right'; ly = y - 12; }
        ly = Math.max(plot.y + 2, Math.min(plot.y + plot.h - 2, ly));
        ctx.lineWidth = 3; ctx.strokeStyle = th.surface; ctx.lineJoin = 'round';
        ctx.strokeText(lastLab, lx, ly);
        ctx.fillText(lastLab, lx, ly);
      }
      this.setAria(main, lastP);
    }
    setAria(main, lastP) {
      const o = this.opts;
      if (o.ariaLabel) { this.canvas.setAttribute('aria-label', o.ariaLabel); return; }
      if (!main || !lastP) { this.canvas.setAttribute('aria-label', 'Gráfico de líneas sin datos'); return; }
      this.canvas.setAttribute('aria-label', 'Gráfico de líneas' + (main.name ? ' (' + main.name + ')' : '') +
        ': último valor ' + (o.format || fmt)(lastP[1]) + ' en ' + (o.xName || o.xLabel || 'x') + ' ' + fmt(lastP[0], Number.isInteger(lastP[0]) ? 0 : undefined));
    }
    showTip(clientX, clientY) {
      const o = this.opts, fmtV = o.format || fmt;
      const hv = this.hover;
      tip.show((t) => {
        tipTitle(t, (o.xName || o.xLabel || 'x') + ' ' + (Number.isInteger(hv) ? String(hv) : fmt(hv)));
        for (const s of this.ser) {
          const k = nearestIdx(s.pts, hv);
          if (k < 0) continue;
          tipRow(t, s.color, fmtV(s.pts[k][1]), s.name);
        }
      }, clientX, clientY);
    }
    onPointer(e) {
      if (!this.geom) return;
      const [x] = this.localXY(e);
      const g = this.geom;
      if (x < g.plot.x - 8 || x > g.plot.x + g.plot.w + 8) { this._onLeave(); return; }
      const dx = g.xmin + ((x - g.plot.x) / g.plot.w) * (g.xmax - g.xmin);
      const main = this.ser[this.opts.areaIndex || 0] || this.ser[0];
      const k = nearestIdx(main.pts, dx);
      if (k < 0) return;
      this.hover = main.pts[k][0];
      this.draw();
      this.showTip(e.clientX, e.clientY);
    }
    onKey(e) {
      if (!this.geom || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) return;
      const main = this.ser[this.opts.areaIndex || 0] || this.ser[0];
      if (!main.pts.length) return;
      e.preventDefault();
      let k = this.hover == null ? main.pts.length - 1 : nearestIdx(main.pts, this.hover);
      if (e.key === 'Home') k = 0;
      else if (e.key === 'End') k = main.pts.length - 1;
      else k = Math.max(0, Math.min(main.pts.length - 1, k + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1)));
      this.hover = main.pts[k][0];
      this.draw();
      const r = this.canvas.getBoundingClientRect();
      this.showTip(r.left + this.geom.px(this.hover), r.top + this.geom.py(main.pts[k][1]));
    }
  }

  // ---------------------------------------------------------------------------
  // DISPERSIÓN (p. ej. PCA de embeddings)
  // ---------------------------------------------------------------------------
  class ScatterChart extends CanvasChart {
    constructor(canvas, points, opts) { super(canvas, points, opts); this.type = 'scatter'; this.draw(); }
    render(ctx, w, h, th) {
      const o = this.opts;
      const pts = (this.data || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
      if (!pts.length) { this.geom = null; empty(ctx, w, h, th, o.emptyText); return; }
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const p of pts) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
      let rx = xmax - xmin || 1, ry = ymax - ymin || 1;
      xmin -= rx * 0.1; xmax += rx * 0.1; ymin -= ry * 0.1; ymax += ry * 0.1;
      rx = xmax - xmin; ry = ymax - ymin;
      const header = o.yLabel ? 16 : 0;
      const plot = { x: 34, y: 6 + header, w: 0, h: Math.max(20, h - 6 - header - (o.xLabel ? 32 : 20)) };
      ctx.font = '400 10.5px ' + th.mono;
      // marcas de la rejilla por índice entero (siempre termina)
      const grid = (a, b, st) => {
        const out = [];
        for (let i = Math.ceil(a / st - 1e-9); i * st <= b + st * 1e-9 && out.length < 60; i++) out.push(i * st);
        return out;
      };
      // rangos con aspecto 1:1 para el área de trazado actual
      const fitRange = () => {
        plot.w = Math.max(20, w - plot.x - 8);
        if (o.equal === false) return [xmin, xmax, ymin, ymax];
        const k = Math.min(plot.w / rx, plot.h / ry);
        const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
        return [cx - plot.w / k / 2, cx + plot.w / k / 2, cy - plot.h / k / 2, cy + plot.h / k / 2];
      };
      // el margen izquierdo se ajusta al ancho real de las etiquetas del eje Y
      let rng = null, step = 1;
      for (let pass = 0; pass < 3; pass++) {
        rng = fitRange();
        step = niceTicks(Math.min(rng[0], rng[2]), Math.max(rng[1], rng[3]), Math.max(3, Math.floor(Math.max(plot.w, plot.h) / 60))).step;
        let lw = 0;
        for (const t of grid(rng[2], rng[3], step)) lw = Math.max(lw, ctx.measureText(fmtTick(t, step)).width);
        const need = Math.max(26, Math.ceil(lw + 9));
        if (need === plot.x) break;
        plot.x = need;
        rng = null;
      }
      if (!rng) rng = fitRange();
      [xmin, xmax, ymin, ymax] = rng;
      const px = (x) => plot.x + ((x - xmin) / (xmax - xmin)) * plot.w;
      const py = (y) => plot.y + plot.h - ((y - ymin) / (ymax - ymin)) * plot.h;

      // cuadrícula
      ctx.lineWidth = 1;
      ctx.fillStyle = th.muted;
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const t of grid(ymin, ymax, step)) {
        const y = Math.round(py(t)) + 0.5;
        ctx.strokeStyle = Math.abs(t) < step * 1e-6 ? th.ruleStrong : rgba(th.rule, 0.6);
        ctx.beginPath(); ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y); ctx.stroke();
        ctx.fillText(fmtTick(t, step), plot.x - 6, y);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      let lastRight = -Infinity;
      for (const t of grid(xmin, xmax, step)) {
        const x = Math.round(px(t)) + 0.5;
        ctx.strokeStyle = Math.abs(t) < step * 1e-6 ? th.ruleStrong : rgba(th.rule, 0.6);
        ctx.beginPath(); ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); ctx.stroke();
        const lab = fmtTick(t, step), lw = ctx.measureText(lab).width;
        if (x - lw / 2 > lastRight + 6 && x + lw / 2 <= w) { ctx.fillText(lab, x, plot.y + plot.h + 5); lastRight = x + lw / 2; }
      }
      ctx.strokeStyle = th.rule;
      ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);
      ctx.font = '500 11px ' + th.body; ctx.fillStyle = th.muted;
      if (o.xLabel) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; ctx.fillText(fitText(ctx, o.xLabel, plot.w), plot.x + plot.w, plot.y + plot.h + 19); }
      if (o.yLabel) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fitText(ctx, o.yLabel, w), 0, 8); }

      // puntos
      const R = 4.5;
      const P = pts.map((p, i) => ({ p, i, x: px(p.x), y: py(p.y), color: th.color(p.colorVar || o.colorVar || '--fwd', 0), hi: !!p.highlight }));
      this.geom = { plot, P };
      const drawOrder = P.slice().sort((a, b) => a.hi - b.hi);
      for (const q of drawOrder) {
        ctx.beginPath(); ctx.arc(q.x, q.y, R + 2, 0, Math.PI * 2); ctx.fillStyle = th.surface; ctx.fill();
        ctx.beginPath(); ctx.arc(q.x, q.y, q.hi ? R + 1 : R, 0, Math.PI * 2); ctx.fillStyle = q.color; ctx.fill();
      }
      // etiquetas: colocación voraz con 8 candidatos
      ctx.font = '500 11px ' + th.mono;
      const lh = 12;
      const placed = [];
      const pr = P.map((q) => ({ x: q.x - R - 1, y: q.y - R - 1, w: 2 * R + 2, h: 2 * R + 2, q }));
      const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const labelOrder = P.slice().sort((a, b) => (b.hi - a.hi) || (Math.hypot(b.x - plot.x - plot.w / 2, b.y - plot.y - plot.h / 2) - Math.hypot(a.x - plot.x - plot.w / 2, a.y - plot.y - plot.h / 2)));
      for (const q of labelOrder) {
        const lab = q.p.label == null ? '' : String(q.p.label);
        if (!lab) continue;
        const tw = ctx.measureText(lab).width;
        const c = [
          [q.x + 7, q.y - lh / 2], [q.x - 7 - tw, q.y - lh / 2], [q.x - tw / 2, q.y - 8 - lh], [q.x - tw / 2, q.y + 8],
          [q.x + 5, q.y - 5 - lh], [q.x + 5, q.y + 5], [q.x - 5 - tw, q.y - 5 - lh], [q.x - 5 - tw, q.y + 5],
        ];
        let best = null, bestScore = Infinity;
        for (const [x, y] of c) {
          const r = { x, y, w: tw, h: lh };
          let s = 0;
          if (x < plot.x + 1 || y < plot.y + 1 || x + tw > plot.x + plot.w - 1 || y + lh > plot.y + plot.h - 1) s += 1e6;
          for (const b of placed) s += inter(r, b) * 4;
          for (const b of pr) if (b.q !== q) s += inter(r, b) * 2;
          if (s < bestScore) { bestScore = s; best = r; }
          if (s === 0) break;
        }
        q.labelShown = best && bestScore < tw * lh * 0.12 * 4;
        if (q.labelShown) {
          placed.push(best);
          ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = th.surface;
          ctx.strokeText(lab, best.x, best.y);
          ctx.fillStyle = th.ink;
          ctx.font = (q.hi ? '600' : '500') + ' 11px ' + th.mono;
          ctx.fillText(lab, best.x, best.y);
          ctx.font = '500 11px ' + th.mono;
        }
      }
      // hover
      if (this.hover != null && P[this.hover]) {
        const q = P[this.hover];
        ctx.beginPath(); ctx.arc(q.x, q.y, R + 4, 0, Math.PI * 2);
        ctx.strokeStyle = th.ink; ctx.lineWidth = 1.5; ctx.stroke();
      }
      if (!o.ariaLabel) this.canvas.setAttribute('aria-label', 'Gráfico de dispersión con ' + pts.length + ' puntos');
      else this.canvas.setAttribute('aria-label', o.ariaLabel);
    }
    update(data, opts) {
      // el índice resaltado deja de tener sentido si cambian los puntos
      if (!data || !this.data || data.length !== this.data.length) this.hover = null;
      return super.update(data, opts);
    }
    showTip(bi, clientX, clientY) {
      const q = this.geom.P[bi], f = this.opts.format || fmt;
      tip.show((t) => {
        tipTitle(t, String(q.p.label == null ? '' : q.p.label));
        tipRow(t, q.color, '(' + f(q.p.x) + ', ' + f(q.p.y) + ')', '', true);
      }, clientX, clientY);
    }
    onPointer(e) {
      if (!this.geom) return;
      const [x, y] = this.localXY(e);
      let bi = -1, bd = 18 * 18;
      this.geom.P.forEach((q, i) => { const d = (q.x - x) ** 2 + (q.y - y) ** 2; if (d < bd) { bd = d; bi = i; } });
      if (bi < 0) { if (this.hover != null) this._onLeave(); return; }
      if (bi !== this.hover) { this.hover = bi; this.draw(); }
      this.showTip(bi, e.clientX, e.clientY);
    }
    // ←/→ recorren los puntos de izquierda a derecha
    onKey(e) {
      if (!this.geom || !/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) return;
      const P = this.geom.P;
      if (!P.length) return;
      e.preventDefault();
      const ord = P.map((q, i) => i).sort((a, b) => P[a].x - P[b].x || P[a].y - P[b].y);
      let k = this.hover == null ? -1 : ord.indexOf(this.hover);
      if (e.key === 'Home') k = 0;
      else if (e.key === 'End') k = ord.length - 1;
      else k = k < 0 ? 0 : Math.max(0, Math.min(ord.length - 1, k + (e.key === 'ArrowRight' ? 1 : -1)));
      this.hover = ord[k];
      this.draw();
      const r = this.canvas.getBoundingClientRect();
      this.showTip(this.hover, r.left + this.geom.P[this.hover].x, r.top + this.geom.P[this.hover].y);
    }
  }

  // ---------------------------------------------------------------------------
  // BARRAS horizontales (DOM + CSS; etiquetas LaTeX vía TL.MathTex si existe)
  // ---------------------------------------------------------------------------
  const TEX_MAP = {
    '\\top': 'T', '\\gamma': 'γ', '\\beta': 'β', '\\alpha': 'α', '\\eta': 'η', '\\theta': 'θ', '\\mu': 'μ',
    '\\sigma': 'σ', '\\epsilon': 'ε', '\\varepsilon': 'ε', '\\lambda': 'λ', '\\pi': 'π', '\\cdot': '·', '\\times': '×',
    '\\sqrt': '√', '\\sum': 'Σ', '\\partial': '∂', '\\nabla': '∇', '\\infty': '∞', '\\ell': 'ℓ', '\\to': '→',
    '\\leftarrow': '←', '\\odot': '⊙', '\\oplus': '⊕', '\\prime': '′', '\\ldots': '…', '\\dots': '…', '\\|': '‖',
    '\\,': ' ', '\\;': ' ', '\\!': '', '\\quad': ' ', '\\left': '', '\\right': '',
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function texLite(tex) {
    let s = String(tex);
    s = s.replace(/\\mathcal\{L\}/g, 'ℒ');
    s = s.replace(/\\(?:text|mathrm|mathbf|operatorname|mathit|boldsymbol)\{([^{}]*)\}/g, '$1');
    s = s.replace(/\\(tilde|hat|bar)\s*\{?([A-Za-z])\}?/g, (m, k, c) => c + (k === 'tilde' ? '\u0303' : k === 'hat' ? '\u0302' : '\u0304'));
    s = s.replace(/\\[a-zA-Z]+|\\[,;!|]/g, (m) => (m in TEX_MAP ? TEX_MAP[m] : m.slice(1)));
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if ((ch === '_' || ch === '^') && i + 1 < s.length) {
        let t;
        if (s[i + 1] === '{') {
          let depth = 0, j = i + 1;
          for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}' && --depth === 0) break; }
          t = s.slice(i + 2, j); i = j;
        } else { t = s[i + 1]; i += 1; }
        const tag = ch === '_' ? 'sub' : 'sup';
        out += '<' + tag + '>' + esc(t.replace(/[{}]/g, '')) + '</' + tag + '>';
      } else if (ch !== '{' && ch !== '}') out += esc(ch);
    }
    return out;
  }

  class BarsChart {
    constructor(el, items, opts) {
      this.type = 'bars';
      this.el = el;
      this.keys = null; // null → el primer update siempre construye (también el estado vacío)
      this.rows = [];
      el.classList.add('chart-bars');
      this._ownRole = !el.hasAttribute('role');
      this.update(items, opts);
    }
    renderLabel(span, it) {
      span.textContent = '';
      span.title = it.label != null ? String(it.label) : '';
      if (it.tex && TL.MathTex && typeof TL.MathTex.render === 'function') {
        try { TL.MathTex.render(it.tex, span, { display: false }); return; } catch (e) { /* cae al texto */ }
      }
      if (it.tex) { span.innerHTML = texLite(it.tex); return; }
      span.textContent = it.label != null ? String(it.label) : '';
    }
    update(items, opts) {
      if (opts) this.opts = Object.assign({}, opts);
      const o = this.opts || (this.opts = {});
      const f = o.format || fmt;
      let list = (items || []).filter((it) => it && Number.isFinite(it.value));
      if (o.sort === 'abs') list = list.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      else if (o.sort) list = list.slice().sort((a, b) => b.value - a.value);
      if (o.limit) list = list.slice(0, o.limit);
      this.el.classList.toggle('chart-bars--compact', !!o.compact);
      if (o.ariaLabel) this.el.setAttribute('aria-label', o.ariaLabel);

      const vals = list.map((it) => it.value);
      let dmin = Math.min(0, o.min != null ? o.min : Math.min(0, ...vals));
      let dmax = Math.max(0, o.max != null ? o.max : Math.max(0, ...vals));
      if (!(dmax > dmin)) dmax = dmin + 1;
      const pct = (v) => ((v - dmin) / (dmax - dmin)) * 100;
      const hasNeg = dmin < 0;

      const keys = list.map((it) => it.key != null ? String(it.key) : it.tex ? 'tex:' + it.tex : 'l:' + it.label);
      const same = !!this.keys && keys.length === this.keys.length && keys.every((k, i) => k === this.keys[i]);
      if (!same) {
        this.el.textContent = '';
        this.rows = [];
        if (!list.length) {
          const e = document.createElement('div');
          e.className = 'chart-bars__empty';
          e.setAttribute('role', 'listitem');
          e.setAttribute('role', 'note');
          e.textContent = o.emptyText || 'Sin datos todavía';
          this.el.appendChild(e);
        }
        for (const it of list) {
          const row = document.createElement('div');
          row.className = 'chart-bars__row';
          row.setAttribute('role', 'listitem');
          const lab = document.createElement('span'); lab.className = 'chart-bars__label';
          const track = document.createElement('span'); track.className = 'chart-bars__track';
          const zero = document.createElement('span'); zero.className = 'chart-bars__zero';
          const bar = document.createElement('span'); bar.className = 'chart-bars__bar';
          const val = document.createElement('span'); val.className = 'chart-bars__value';
          track.append(zero, bar);
          row.append(lab, track, val);
          this.renderLabel(lab, it);
          // siempre se llama al onSelect MÁS RECIENTE (las filas se reutilizan entre llamadas)
          const fire = () => { const f = this.opts && this.opts.onSelect; if (typeof f === 'function') f(row._item); };
          row.addEventListener('click', fire);
          row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && this.opts && this.opts.onSelect) { e.preventDefault(); fire(); } });
          this.el.appendChild(row);
          this.rows.push({ row, lab, zero, bar, val });
        }
        this.keys = keys;
      }
      const selectable = typeof o.onSelect === 'function';
      if (this._ownRole) this.el.setAttribute('role', selectable ? 'group' : 'list');
      list.forEach((it, i) => {
        const r = this.rows[i];
        r.row._item = it;
        r.row.setAttribute('role', selectable ? 'button' : 'listitem');
        if (selectable) r.row.tabIndex = 0; else r.row.removeAttribute('tabindex');
        r.row.classList.toggle('is-selectable', selectable);
        const v = it.value;
        const a = pct(Math.min(0, v)), b = pct(Math.max(0, v));
        r.bar.style.left = a.toFixed(3) + '%';
        r.bar.style.width = Math.max(0, b - a).toFixed(3) + '%';
        r.bar.classList.toggle('is-neg', v < 0);
        const cv = it.colorVar || o.colorVar || '--fwd';
        const name = normVar(cv);
        r.bar.style.setProperty('--c', name ? 'var(' + name + ')' : cv);
        r.zero.hidden = !hasNeg;
        r.zero.style.left = pct(0).toFixed(3) + '%';
        r.val.textContent = f(v);
        r.row.classList.toggle('is-hi', !!it.highlight);
        r.row.setAttribute('aria-label', (it.label != null ? it.label : it.tex || '') + ': ' + f(v));
      });
      return this;
    }
    redraw() { return this; }
    destroy() {
      this.el.textContent = '';
      this.el.classList.remove('chart-bars', 'chart-bars--compact');
      if (this._ownRole) this.el.removeAttribute('role');
      if (this.el.__tlChart === this) delete this.el.__tlChart;
    }
  }

  // ---------------------------------------------------------------------------
  // registro, tema
  // ---------------------------------------------------------------------------
  function getOrCreate(target, type, Ctor, data, opts) {
    if (!target) throw new Error('TL.Charts: falta el elemento');
    const c = target.__tlChart;
    if (c && c.type === type && !c.destroyed) return c.update(data, opts);
    if (c && c.destroy) c.destroy();
    const n = new Ctor(target, data, opts);
    target.__tlChart = n;
    return n;
  }

  function redrawAll() {
    for (const c of Array.from(registry)) {
      if (!c.canvas || !c.canvas.isConnected) { registry.delete(c); continue; }
      c.draw();
    }
  }

  let watching = false, themeRaf = 0;
  function scheduleRedraw() {
    if (themeRaf) return;
    themeRaf = requestAnimationFrame(() => { themeRaf = 0; redrawAll(); });
  }
  function ensureThemeWatch() {
    if (watching || typeof document === 'undefined') return;
    watching = true;
    try {
      new MutationObserver(scheduleRedraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    } catch (e) { /* sin observer */ }
    try {
      const mq = root.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', scheduleRedraw); else if (mq.addListener) mq.addListener(scheduleRedraw);
    } catch (e) { /* sin matchMedia */ }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleRedraw).catch(() => {});
    // cambio de densidad de píxeles (zoom, otra pantalla): el canvas se vuelve a rasterizar
    let lastDpr = root.devicePixelRatio || 1;
    try {
      root.addEventListener('resize', () => {
        const d = root.devicePixelRatio || 1;
        if (d !== lastDpr) { lastDpr = d; scheduleRedraw(); }
      });
    } catch (e) { /* sin window */ }
  }

  TL.Charts = {
    line: (canvas, series, opts) => getOrCreate(canvas, 'line', LineChart, series, opts),
    scatter: (canvas, points, opts) => getOrCreate(canvas, 'scatter', ScatterChart, points, opts),
    bars: (el, items, opts) => getOrCreate(el, 'bars', BarsChart, items, opts),
    redrawAll,
    fmt, niceTicks, texLite, tip,
  };
})(typeof window !== 'undefined' ? window : globalThis);
