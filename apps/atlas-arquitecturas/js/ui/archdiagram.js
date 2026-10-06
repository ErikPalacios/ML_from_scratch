/* =============================================================================
   Atlas de Arquitecturas — js/ui/archdiagram.js
   ATLAS.ArchDiagram: diagramas de arquitectura interactivos (SPEC §7) + ATLAS.Viz (§7.8).

   API (SPEC §7.9)
     const dg = ATLAS.ArchDiagram.render(diagramId, el, {mode:'full'|'mini'|'blank', walk, wide,
                  showNumbers, config, hideShapes, blank:{slots:[{id, ask}], onSlot(slotId, anchorEl)},
                  onSelect(nodeId), onExpand(diagramId)})
     dg.el · dg.expand(id) · dg.collapse() · dg.focusNode(nodeId, {open}) · dg.highlight({nodes,edges,tensors})
     dg.clearHighlight() · dg.setSlot(slotId, text, state) · dg.startWalk(id) · dg.stopWalk() · dg.destroy()
     ATLAS.ArchDiagram.legend(diagramId) → HTMLElement
   Puras (sin DOM, para el validador y los tests):
     ATLAS.ArchDiagram.geometry(spec) → {nodes, groups, edges:[{key, kind, tensor, pts}]}  (px, 1 u = 8 px)
     ATLAS.ArchDiagram.crossings(spec, kinds=['data']) → {count, pairs}
     ATLAS.ArchDiagram.glyphSize(tensor) → {w, h}
   Verificación en navegador: ATLAS.ArchDiagram.checkLabels(rootEl) → [{edge, tensor, got, want}] (vacío = OK).

   Reglas: las formas de las aristas salen SIEMPRE de ATLAS.Arch.run (nunca del spec). Los colores son
   variables CSS (var(--op-*), var(--mod-*)), así que el cambio de tema no exige volver a dibujar.
   No toca el DOM al cargar (se carga también en Node).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const U = 8;                                  // 1 unidad de grilla = 8 px al 100 %
  const SVGNS = 'http://www.w3.org/2000/svg';
  const SHAPED = { data: 1, skip: 1, cross: 1, query: 1 };
  const MAP_KINDS = ['hereda', 'usa', 'contrasta', 'reemplaza'];
  const MAP_KIND_TITLES = { hereda: 'Hereda de (descendiente)', usa: 'Usa como componente', contrasta: 'Alternativa a', reemplaza: 'Lo reemplaza' };
  const OPP = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  const NORMAL = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  const CIRCLE_SHAPES = { add: 1, concat: 1, split: 1, pool: 1, flatten: 1, mul: 1 };
  let uid = 0;

  // ============================================================ utilidades puras
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const near = (a, b) => Math.abs(a - b) < 0.5;
  const r1 = (v) => Math.round(v * 10) / 10;
  const P = (p) => r1(p[0]) + ',' + r1(p[1]);
  function edgeKey(e) { return e.from + '>' + e.to; }
  function opList() { return (ATLAS.OP_TYPES || []).map((o) => o.id); }

  function rectOf(o) { return { x: o.x * U, y: o.y * U, w: o.w * U, h: o.h * U }; }

  function attach(r, side, at) {
    const t = at == null ? 0.5 : at;
    if (side === 'left') return [r.x, r.y + r.h * t];
    if (side === 'right') return [r.x + r.w, r.y + r.h * t];
    if (side === 'top') return [r.x + r.w * t, r.y];
    return [r.x + r.w * t, r.y + r.h];
  }

  // Lados por defecto según la posición relativa (prioriza la dirección del diagrama).
  function autoSides(dir, a, b) {
    const below = b.y >= a.y + a.h - 1, above = b.y + b.h <= a.y + 1;
    const right = b.x >= a.x + a.w - 1, left = b.x + b.w <= a.x + 1;
    const order = dir === 'tb'
      ? [[below, 'bottom', 'top'], [above, 'top', 'bottom'], [right, 'right', 'left'], [left, 'left', 'right']]
      : [[right, 'right', 'left'], [left, 'left', 'right'], [below, 'bottom', 'top'], [above, 'top', 'bottom']];
    for (const [c, f, t] of order) if (c) return [f, t];
    return dir === 'tb' ? ['bottom', 'top'] : ['right', 'left'];
  }

  function dirOf(p, q) {
    if (near(p[0], q[0]) && near(p[1], q[1])) return null;
    if (near(p[1], q[1])) return [Math.sign(q[0] - p[0]), 0];
    return [0, Math.sign(q[1] - p[1])];
  }

  function simplify(pts) {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (l && near(l[0], p[0]) && near(l[1], p[1])) continue;
      out.push(p);
    }
    // quita puntos colineales intermedios
    for (let i = out.length - 2; i >= 1; i--) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      if ((near(a[0], b[0]) && near(b[0], c[0])) || (near(a[1], b[1]) && near(b[1], c[1]))) out.splice(i, 1);
    }
    return out;
  }

  // Ruta ortogonal: origen → via… → destino, con codos donde haga falta.
  function routeEdge(spec, e, rects) {
    const a = rects[e.from], b = rects[e.to];
    if (!a || !b) return null;
    let [fs, ts] = autoSides(spec.direction || 'lr', a, b);
    if (e.fromSide) fs = e.fromSide;
    if (e.toSide) ts = e.toSide;
    const A = attach(a, fs, e.fromAt), B = attach(b, ts, e.toAt);
    const targets = (e.via || []).map((v) => [v[0] * U, v[1] * U]).concat([B]);
    const pts = [A];
    let heading = NORMAL[fs];
    targets.forEach((q, i) => {
      const p = pts[pts.length - 1];
      const last = i === targets.length - 1;
      if (near(p[0], q[0]) || near(p[1], q[1])) pts.push(q);
      else {
        const hHor = heading[1] === 0;
        if (last) {
          const eHor = ts === 'left' || ts === 'right';
          if (hHor && eHor) { const mx = e.midX != null ? e.midX * U : (p[0] + q[0]) / 2; pts.push([mx, p[1]], [mx, q[1]], q); }
          else if (!hHor && !eHor) { const my = e.midY != null ? e.midY * U : (p[1] + q[1]) / 2; pts.push([p[0], my], [q[0], my], q); }
          else if (hHor) pts.push([q[0], p[1]], q);
          else pts.push([p[0], q[1]], q);
        } else if (hHor) pts.push([q[0], p[1]], q);
        else pts.push([p[0], q[1]], q);
      }
      const d = dirOf(pts[pts.length - 2], pts[pts.length - 1]);
      if (d) heading = d;
    });
    return { pts: simplify(pts), fromSide: fs, toSide: ts };
  }

  // Curva (mapas): Bézier cúbica entre lados elegidos por el eje dominante; pts = muestreo (para cruces).
  function curveEdge(e, rects) {
    const a = rects[e.from], b = rects[e.to];
    if (!a || !b) return null;
    const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
    const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
    let fs, ts;
    const horiz = Math.abs(dx) - (a.w + b.w) / 2 > Math.abs(dy) - (a.h + b.h) / 2;
    if (horiz) { fs = dx > 0 ? 'right' : 'left'; ts = OPP[fs]; } else { fs = dy > 0 ? 'bottom' : 'top'; ts = OPP[fs]; }
    if (e.fromSide) fs = e.fromSide;
    if (e.toSide) ts = e.toSide;
    const A = attach(a, fs, e.fromAt), B = attach(b, ts, e.toAt);
    const dist = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const k = clamp(dist * (e.bend || 0.4), 16, 160);
    const na = NORMAL[fs], nb = NORMAL[ts];
    const C1 = [A[0] + na[0] * k, A[1] + na[1] * k], C2 = [B[0] + nb[0] * k, B[1] + nb[1] * k];
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      pts.push([u * u * u * A[0] + 3 * u * u * t * C1[0] + 3 * u * t * t * C2[0] + t * t * t * B[0], u * u * u * A[1] + 3 * u * u * t * C1[1] + 3 * u * t * t * C2[1] + t * t * t * B[1]]);
    }
    return { pts, ctrl: [A, C1, C2, B] };
  }

  function geometry(spec) {
    const nodes = {}, groups = {}, rects = {};
    for (const g of spec.groups || []) { groups[g.id] = rectOf(g); rects[g.id] = groups[g.id]; }
    for (const n of spec.nodes || []) { nodes[n.id] = rectOf(n); rects[n.id] = nodes[n.id]; }
    const edges = [];
    for (const e of spec.edges || []) {
      if ((e.route || spec.edgeRoute) === 'curve') {
        const c = curveEdge(e, rects);
        edges.push({ key: edgeKey(e), from: e.from, to: e.to, kind: e.kind || 'data', tensor: e.tensor || null, pts: c ? c.pts : [], curve: c ? c.ctrl : null, spec: e });
        continue;
      }
      const r = routeEdge(spec, e, rects);
      edges.push({ key: edgeKey(e), from: e.from, to: e.to, kind: e.kind || 'data', tensor: e.tensor || null,
        pts: r ? r.pts : [], fromSide: r && r.fromSide, toSide: r && r.toSide, spec: e });
    }
    return { nodes, groups, edges, width: (spec.grid && spec.grid.w || 0) * U, height: (spec.grid && spec.grid.h || 0) * U };
  }

  function segs(pts) { const s = []; for (let i = 1; i < pts.length; i++) s.push([pts[i - 1], pts[i]]); return s; }
  function segCross(s, t) {
    // Solo cruces propios horizontal × vertical (los extremos compartidos no cuentan).
    const sh = near(s[0][1], s[1][1]), th = near(t[0][1], t[1][1]);
    if (sh === th) return false;
    const H = sh ? s : t, V = sh ? t : s;
    const y = H[0][1], x = V[0][0];
    const x0 = Math.min(H[0][0], H[1][0]), x1 = Math.max(H[0][0], H[1][0]);
    const y0 = Math.min(V[0][1], V[1][1]), y1 = Math.max(V[0][1], V[1][1]);
    return x > x0 + 0.5 && x < x1 - 0.5 && y > y0 + 0.5 && y < y1 - 0.5;
  }
  function crossings(spec, kinds) {
    const ks = kinds || ['data'];
    const geo = geometry(spec);
    const es = geo.edges.filter((e) => ks.indexOf(e.kind) >= 0);
    const pairs = [];
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      let c = 0;
      for (const s of segs(es[i].pts)) for (const t of segs(es[j].pts)) if (segCross(s, t)) c++;
      if (c) pairs.push([es[i].key + (es[i].tensor ? '@' + es[i].tensor : ''), es[j].key + (es[j].tensor ? '@' + es[j].tensor : ''), c]);
    }
    return { count: pairs.reduce((a, p) => a + p[2], 0), pairs };
  }

  // ------------------------------------------------------------ glifos de tensor (§7.3)
  const ext = (n) => clamp(6.5 * Math.log2(Math.max(2, n)) - 14, 6, 64);   // log2 con pinzas 6–64 px (§7.3)
  const DEPTH = [0.55, -0.42];                   // proyección isométrica de la profundidad
  function glyphDims(t) {
    const num = (t && t.num) || [];
    const lay = (t && t.layout) || (num.length === 3 ? 'grid' : num.length === 1 ? 'vec' : 'seq');
    if (lay === 'vec') return { lay, w: ext(num[0] || 2), h: 5, d: 0 };
    if (lay === 'grid') return { lay, w: ext(num[1] || 2), h: ext(num[0] || 2), d: ext(num[2] || 2) };
    if (lay === 'heads') return { lay, w: ext(num[1] || 2), h: 4, d: ext(num[2] || 2), n: Math.min(num[0] || 1, 8), heads: num[0] };
    return { lay: 'seq', w: ext(num[0] || 2), h: 6, d: ext(num[1] || 2) };
  }
  function glyphSize(t) {
    const g = glyphDims(t);
    const dx = g.d * DEPTH[0], dy = -g.d * DEPTH[1];
    const stack = g.lay === 'heads' ? (g.n - 1) * 5 : 0;
    return { w: g.w + dx, h: g.h + dy + stack };
  }

  // ============================================================ acceso al calculador
  function arch() { return ATLAS.Arch || null; }
  function runFor(configId) {
    const A = arch();
    if (!A || typeof A.run !== 'function') throw new Error('El calculador (ATLAS.Arch) no está cargado.');
    return A.run(configId);
  }
  function shapeText(t, mode) {
    const A = arch();
    if (A && A.fmt && typeof A.fmt.shape === 'function') return A.fmt.shape(t, mode);
    const a = mode === 'sym' ? t.sym : t.num;
    return (a || []).join('×');
  }
  function fint(n) { const A = arch(); return A && A.fmt && A.fmt.int ? A.fmt.int(n) : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fsi(n) {
    const A = arch();
    if (A && A.fmt && A.fmt.si) return A.fmt.si(n);
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' G';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + ' k';
    return String(n);
  }
  function qResolve(html, configId) {
    if (!html) return '';
    const Q = ATLAS.Quantities;
    try { if (Q && typeof Q.fill === 'function') return Q.fill(html, { config: configId }); } catch (e) { /* cae al respaldo */ }
    return String(html).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, key) => fallbackQ(key) || m);
  }
  function fallbackQ(key) {
    const parts = key.split('.');
    let run;
    try { run = runFor(parts[0]); } catch (e) { return null; }
    const rest = parts.slice(1);
    if (rest[0] === 'tensor' && run.tensors[rest[1]]) return shapeText(run.tensors[rest[1]], rest[2] === 'sym' ? 'sym' : 'num');
    if (rest[0] === 'params' && rest[1] === 'total') return fint(run.totals.params);
    if (rest[0] === 'params' && rest[1] === 'totalM') return fsi(run.totals.params);
    if (rest[0] === 'macs' && rest[1] === 'totalG') return fsi(run.totals.macs);
    if (run.quantities && rest.length === 1 && run.quantities[rest[0]] != null) return fint(run.quantities[rest[0]]);
    return null;
  }

  function nodeOps(run, node) {
    if (!run) return [];
    const ids = node.ops || [];
    return run.ops.filter((o) => ids.indexOf(o.id) >= 0 || (o.path && o.path.indexOf(node.id) >= 0 && !(node.opsExact)));
  }
  function nodeCost(run, node) {
    const ops = nodeOps(run, node);
    let params = 0, macs = 0, rep = 1;
    for (const o of ops) { params += o.params || 0; macs += o.macs || 0; rep = Math.max(rep, o.repeat || 1); }
    const by = run && run.totals && run.totals.byNode && run.totals.byNode[node.id];
    return { ops, params, macs, rep, total: by || { params: ops.reduce((a, o) => a + (o.params || 0) * (o.repeat || 1), 0), macs: ops.reduce((a, o) => a + (o.macs || 0) * (o.repeat || 1), 0) } };
  }

  // ============================================================ DOM helpers (solo en render)
  function S(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function H(tag, attrs, parent, html) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (attrs[k] == null || attrs[k] === false) continue;
      if (k === 'class') el.className = attrs[k]; else if (k === 'text') el.textContent = attrs[k]; else el.setAttribute(k, attrs[k]);
    }
    if (html != null) el.innerHTML = html;
    if (parent) parent.appendChild(el);
    return el;
  }
  function txt(parent, x, y, s, cls, anchor) {
    const t = S('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, parent);
    t.textContent = s;
    return t;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function strip(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(); }
  function reducedMotion() { try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function texInto(el, tex, display) {
    if (!tex) return el;
    const M = ATLAS.MathTex;
    if (M && typeof M.render === 'function') { try { M.render(tex, el, { display: !!display }); return el; } catch (e) { /* respaldo */ } }
    el.innerHTML = '<code class="ad-tex">' + esc(tex) + '</code>';
    return el;
  }
  function textW(s, px, mono) { return String(s).length * px * (mono ? 0.6 : 0.56); }

  // ------------------------------------------------------------ <defs>: texturas por modalidad
  function defs(svg, id) {
    const d = S('defs', null, svg);
    const pat = (name, draw) => {
      const p = S('pattern', { id: id + '-tx-' + name, patternUnits: 'userSpaceOnUse', width: 6, height: 6 }, d);
      S('rect', { width: 6, height: 6, class: 'ad-tx-bg ad-mod--' + name }, p);
      draw(p);
    };
    pat('img', () => {});
    pat('txt', (p) => { S('path', { d: 'M0 1.5H6M0 4.5H6', class: 'ad-tx-ln ad-mod--txt' }, p); });
    pat('act', (p) => { S('circle', { cx: 1.5, cy: 1.5, r: 0.9, class: 'ad-tx-dot ad-mod--act' }, p); S('circle', { cx: 4.5, cy: 4.5, r: 0.9, class: 'ad-tx-dot ad-mod--act' }, p); });
    pat('aud', (p) => { S('path', { d: 'M1.5 0V6M4.5 0V6', class: 'ad-tx-ln ad-mod--aud' }, p); });
    pat('lat', (p) => { [[1, 1], [4, 2], [2, 4.5], [5, 5]].forEach(([x, y]) => S('rect', { x, y, width: 0.9, height: 0.9, class: 'ad-tx-dot ad-mod--lat' }, p)); });
    pat('qry', () => {});
    return d;
  }

  // ------------------------------------------------------------ glifo isométrico
  // (x, y) = esquina inferior izquierda de la cara frontal.
  function drawGlyph(parent, t, x, y, id, mark) {
    const g = glyphDims(t);
    const mod = (t && t.mod) || 'img';
    const grp = S('g', { class: 'ad-glyph ad-mod--' + mod + (mod === 'qry' ? ' ad-glyph--outline' : '') }, parent);
    const fill = 'url(#' + id + '-tx-' + mod + ')';
    const box = (bx, by, w, h, d) => {
      const dx = d * DEPTH[0], dy = d * DEPTH[1];
      // cara superior y lateral, luego frontal
      S('path', { d: 'M' + P([bx, by - h]) + 'L' + P([bx + dx, by - h + dy]) + 'L' + P([bx + w + dx, by - h + dy]) + 'L' + P([bx + w, by - h]) + 'Z', class: 'ad-face ad-face--top', fill }, grp);
      S('path', { d: 'M' + P([bx + w, by]) + 'L' + P([bx + w, by - h]) + 'L' + P([bx + w + dx, by - h + dy]) + 'L' + P([bx + w + dx, by + dy]) + 'Z', class: 'ad-face ad-face--side', fill }, grp);
      S('rect', { x: r1(bx), y: r1(by - h), width: r1(w), height: r1(h), class: 'ad-face ad-face--front', fill }, grp);
    };
    if (g.lay === 'heads') {
      for (let i = g.n - 1; i >= 0; i--) box(x, y - i * 5, g.w, g.h, g.d);
    } else box(x, y, g.w, g.h, g.d);
    if (g.lay === 'seq' && t && t.num && t.num[0] > 1) {
      // marcas de tokens sobre la cara frontal (hasta 12)
      const k = Math.min(t.num[0], 12), step = g.w / k;
      let d = '';
      for (let i = 1; i < k; i++) d += 'M' + P([x + i * step, y]) + 'V' + r1(y - g.h);
      S('path', { d, class: 'ad-tokmarks' }, grp);
      if (mark === 'first') S('rect', { x: r1(x), y: r1(y - g.h), width: r1(step), height: r1(g.h), class: 'ad-tokfirst' }, grp);
    }
    return grp;
  }

  // ------------------------------------------------------------ escena procedural (sin imágenes externas)
  function drawScene(parent, x, y, w, h, grid) {
    const g = S('g', { class: 'ad-scene-img' }, parent);
    const cx = (fx) => x + fx * w, cy = (fy) => y + fy * h;
    S('rect', { x, y, width: w, height: h, fill: '#A9CBE8' }, g);
    S('circle', { cx: cx(0.76), cy: cy(0.22), r: w * 0.09, fill: '#F4C95D' }, g);
    S('path', { d: 'M' + P([cx(0), cy(0.70)]) + 'L' + P([cx(0.28), cy(0.32)]) + 'L' + P([cx(0.5), cy(0.58)]) + 'L' + P([cx(0.68), cy(0.40)]) + 'L' + P([cx(1), cy(0.72)]) + 'V' + r1(y + h) + 'H' + r1(x) + 'Z', fill: '#7D97B3' }, g);
    S('path', { d: 'M' + P([cx(0.21), cy(0.41)]) + 'L' + P([cx(0.28), cy(0.32)]) + 'L' + P([cx(0.35), cy(0.41)]) + 'L' + P([cx(0.31), cy(0.39)]) + 'L' + P([cx(0.28), cy(0.42)]) + 'L' + P([cx(0.25), cy(0.39)]) + 'Z', fill: '#F2F5F8' }, g);
    S('path', { d: 'M' + P([cx(0), cy(0.80)]) + 'Q' + P([cx(0.35), cy(0.66)]) + ' ' + P([cx(0.62), cy(0.76)]) + 'T' + P([cx(1), cy(0.74)]) + 'V' + r1(y + h) + 'H' + r1(x) + 'Z', fill: '#7FA866' }, g);
    S('rect', { x: cx(0.16), y: cy(0.66), width: w * 0.035, height: h * 0.12, fill: '#6B4F35' }, g);
    S('circle', { cx: cx(0.178), cy: cy(0.62), r: w * 0.075, fill: '#3F7A4A' }, g);
    S('rect', { x: cx(0.56), y: cy(0.70), width: w * 0.16, height: h * 0.11, fill: '#C9694B' }, g);
    S('path', { d: 'M' + P([cx(0.54), cy(0.71)]) + 'L' + P([cx(0.64), cy(0.63)]) + 'L' + P([cx(0.74), cy(0.71)]) + 'Z', fill: '#8E3B2B' }, g);
    if (grid > 1) {
      let d = '';
      for (let i = 1; i < grid; i++) { d += 'M' + P([x + i * w / grid, y]) + 'V' + r1(y + h) + 'M' + P([x, y + i * h / grid]) + 'H' + r1(x + w); }
      S('path', { d, class: 'ad-scene-grid' }, g);
    }
    S('rect', { x, y, width: w, height: h, class: 'ad-scene-frame' }, g);
    return g;
  }

  // ------------------------------------------------------------ símbolos de operaciones de tensor
  function drawSymbol(parent, shape, cx, cy, r) {
    const k = r * 0.5;
    let d = '';
    if (shape === 'add') d = 'M' + P([cx - k, cy]) + 'H' + r1(cx + k) + 'M' + P([cx, cy - k]) + 'V' + r1(cy + k);
    else if (shape === 'mul') d = 'M' + P([cx - k * 0.75, cy - k * 0.75]) + 'L' + P([cx + k * 0.75, cy + k * 0.75]) + 'M' + P([cx + k * 0.75, cy - k * 0.75]) + 'L' + P([cx - k * 0.75, cy + k * 0.75]);
    else if (shape === 'concat') d = 'M' + P([cx - k * 0.35, cy - k]) + 'V' + r1(cy + k) + 'M' + P([cx + k * 0.35, cy - k]) + 'V' + r1(cy + k);
    else if (shape === 'split') d = 'M' + P([cx - k, cy]) + 'H' + r1(cx - k * 0.1) + 'M' + P([cx - k * 0.1, cy]) + 'L' + P([cx + k, cy - k * 0.8]) + 'M' + P([cx - k * 0.1, cy]) + 'H' + r1(cx + k) + 'M' + P([cx - k * 0.1, cy]) + 'L' + P([cx + k, cy + k * 0.8]);
    else if (shape === 'pool') d = 'M' + P([cx - k, cy - k * 0.6]) + 'L' + P([cx, cy + k * 0.3]) + 'L' + P([cx + k, cy - k * 0.6]) + 'M' + P([cx - k * 0.8, cy + k * 0.8]) + 'H' + r1(cx + k * 0.8);
    else if (shape === 'flatten') d = 'M' + P([cx - k, cy - k * 0.6]) + 'H' + r1(cx + k) + 'M' + P([cx - k, cy]) + 'H' + r1(cx + k) + 'M' + P([cx - k, cy + k * 0.6]) + 'H' + r1(cx + k);
    S('path', { d, class: 'ad-sym' }, parent);
  }

  // ============================================================ dibujo de una vista
  function buildView(ctl, spec) {
    const run = ctl.runFor(spec);
    const id = ctl.id;
    const geo = geometry(spec);
    const svg = S('svg', { class: 'ad-svg', 'data-kind': spec.kind || 'arch', xmlns: SVGNS, role: 'group', 'aria-label': spec.title || spec.id, preserveAspectRatio: 'xMidYMid meet' });
    defs(svg, id);
    const W = geo.width, Hh = geo.height;
    S('rect', { x: -400, y: -400, width: W + 800, height: Hh + 800, class: 'ad-bg' }, svg);
    S('path', { d: blueprint(W, Hh), class: 'ad-grid' }, svg);
    const scene = S('g', { class: 'ad-scene' }, svg);
    const L = { groups: S('g', { class: 'ad-l-groups' }, scene), edges: S('g', { class: 'ad-l-edges' }, scene), nodes: S('g', { class: 'ad-l-nodes' }, scene), labels: S('g', { class: 'ad-l-labels' }, scene) };
    const used = { ops: new Set(), mods: new Set(), edges: new Set(), repeat: false, heads: false, badge: false, map: new Set() };
    const isMap = spec.kind === 'map';

    // ---- grupos
    for (const g of spec.groups || []) {
      const r = geo.groups[g.id];
      const gg = S('g', { class: 'ad-group' + (g.region ? ' ad-region' : '') + (g.repeat ? ' ad-group--repeat' : ''), 'data-group': g.id }, L.groups);
      if (g.repeat) {
        used.repeat = true;
        S('rect', { x: r.x + 10, y: r.y + 10, width: r.w, height: r.h, rx: 6, class: 'ad-stack' }, gg);
        S('rect', { x: r.x + 5, y: r.y + 5, width: r.w, height: r.h, rx: 6, class: 'ad-stack' }, gg);
      }
      if (g.heads) {
        used.heads = true;
        const hv = (run && run.config && run.config[g.heads]) || 0;
        const n = Math.min(Math.max(hv, 1), 8);
        for (let i = n - 1; i >= 1; i--) S('rect', { x: r.x + i * 3, y: r.y - i * 3, width: r.w, height: r.h, rx: 6, class: 'ad-deck' }, gg);
        txt(gg, r.x + r.w + (n - 1) * 3 - 4, r.y - (n - 1) * 3 - 6, g.heads + ' = ' + hv, 'ad-group-tag', 'end');
      }
      S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, class: 'ad-frame' }, gg);
      if (g.modality) { used.mods.add(g.modality); S('rect', { x: r.x, y: r.y + 6, width: 4, height: r.h - 12, class: 'ad-stripe ad-mod--' + g.modality }, gg); }
      if (g.label) {
        const right = g.labelPos === 'bottom-right';
        txt(gg, right ? r.x + r.w - 10 : r.x + 10, (g.labelPos || '').indexOf('bottom') === 0 ? r.y + r.h - 8 : r.y + 17, g.label, g.region ? 'ad-region-label' : 'ad-group-label', right ? 'end' : null);
      }
      if (g.repeat && run) {
        const v = run.config[g.repeat.from || g.repeat.sym];
        const tag = '× ' + (g.repeat.sym || 'L') + ' = ' + v;
        txt(gg, r.x + r.w - 10, r.y + 17, tag, 'ad-group-tag', 'end');
      }
      if (g.label2) txt(gg, r.x + 10, r.y + 31, g.label2, 'ad-group-sub');
    }

    // ---- nodos
    const nodeEls = {};
    for (const n of spec.nodes || []) {
      const el = isMap ? drawMapNode(ctl, L.nodes, n, geo.nodes[n.id], used) : drawNode(ctl, L.nodes, n, geo.nodes[n.id], run, used, spec);
      nodeEls[n.id] = el;
    }

    // ---- aristas
    const edgeEls = [];
    const tensorAt = {};
    for (const t of spec.tensors || []) if (t.at && t.at.edge) tensorAt[t.at.edge + (t.at.tensor ? '@' + t.at.tensor : '')] = t;
    geo.edges.forEach((ge) => {
      const el = drawEdge(ctl, L, ge, run, used, tensorAt, isMap);
      if (el) edgeEls.push(el);
    });
    // ---- glifos sueltos (at:{x,y})
    for (const t of spec.tensors || []) {
      if (!t.at || t.at.edge || !run || !run.tensors[t.id]) continue;
      const rt = run.tensors[t.id];
      const gg = S('g', { class: 'ad-tensor', 'data-tensor-glyph': t.id }, L.labels);
      drawGlyph(gg, rt, t.at.x * U, t.at.y * U, id, t.mark);
      used.mods.add(rt.mod || 'img');
      if (t.show !== 'glyph') shapeLabel(ctl, gg, rt, t.at.x * U + glyphSize(rt).w + 6, t.at.y * U - glyphSize(rt).h / 2, 'right', t.id);
    }
    return { svg, geo, used, nodeEls, edgeEls, run, spec, width: W, height: Hh };
  }

  function blueprint(w, h) {
    // grilla de plano cada 4 u, extendida más allá del área para que el zoom/pan no muestre bordes
    let d = '';
    const x0 = -48 * U, y0 = -48 * U, x1 = w + 48 * U, y1 = h + 48 * U;
    for (let x = x0; x <= x1; x += 4 * U) d += 'M' + x + ' ' + y0 + 'V' + y1;
    for (let y = y0; y <= y1; y += 4 * U) d += 'M' + x0 + ' ' + y + 'H' + x1;
    return d;
  }

  function slotFor(ctl, id) { return ctl.slots && ctl.slots[id]; }

  function drawNode(ctl, parent, n, r, run, used, spec) {
    const op = n.op || 'tensorop';
    const shape = n.shape || (op === 'tensorop' ? 'add' : 'rect');
    const slot = slotFor(ctl, n.id);
    const blankOp = slot && slot.ask === 'op';
    const g = S('g', { class: 'ad-node ad-op--' + (blankOp ? 'blank' : op) + (op === 'io' ? ' ad-node--io' : '') + (CIRCLE_SHAPES[shape] ? ' ad-node--sym' : '') + (n.expand ? ' ad-node--expandable' : ''),
      'data-node': n.id, tabindex: ctl.mode === 'blank' && !slot ? -1 : 0, role: 'button' }, parent);
    if (op !== 'io' && !blankOp) used.ops.add(op);
    if (n.modality) used.mods.add(n.modality);
    const cost = run && op !== 'io' ? nodeCost(run, n) : null;
    let label = n.label || '';
    let sub = n.sub || '';
    if (slot && slot.ask === 'label') { label = ''; sub = ''; }
    const hv = n.heads && run && run.config ? run.config[n.heads] : 0;
    if (CIRCLE_SHAPES[shape]) {
      const rr = Math.min(r.w, r.h) / 2;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      S('circle', { cx, cy, r: rr, class: 'ad-box' }, g);
      if (!blankOp) drawSymbol(g, shape, cx, cy, rr);
      else txt(g, cx, cy + 4.5, '?', 'ad-label', 'middle');
      const pos = n.labelPos || 'right';
      if ((label || sub) && pos !== 'none') {
        const lx = pos === 'right' ? r.x + r.w + 6 : pos === 'left' ? r.x - 6 : cx;
        const anchor = pos === 'right' ? 'start' : pos === 'left' ? 'end' : 'middle';
        const ly = pos === 'below' ? r.y + r.h + 14 : pos === 'above' ? r.y - (sub ? 18 : 6) : cy + (sub ? -2 : 4);
        if (label) txt(g, lx, ly, label, 'ad-label ad-label--sym', anchor);
        if (sub) txt(g, lx, ly + 13, sub, 'ad-sub', anchor);
      }
    } else {
      if (hv > 1) {
        used.heads = true;
        const k = Math.min(hv, 8);
        for (let i = k - 1; i >= 1; i--) S('rect', { x: r.x + i * 3, y: r.y - i * 3, width: r.w, height: r.h, rx: 4, class: 'ad-box ad-box--deck' }, g);
        txt(g, r.x + r.w + (k - 1) * 3 + 4, r.y - (k - 1) * 3 + 4, n.heads + ' = ' + hv, 'ad-heads-tag');
      }
      if (n.parallel > 1) {
        for (let i = Math.min(n.parallel, 4) - 1; i >= 1; i--) S('rect', { x: r.x + i * 4, y: r.y + i * 4, width: r.w, height: r.h, rx: 4, class: 'ad-box ad-box--deck' }, g);
      }
      S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: shape === 'pill' ? Math.min(r.h / 2, 12) : 4, class: 'ad-box' }, g);
      if (n.modality) S('rect', { x: r.x + 1, y: r.y + 4, width: 3.5, height: r.h - 8, class: 'ad-stripe ad-mod--' + n.modality }, g);
      if (n.image && run && run.config) {
        const pad = 6, side = Math.min(r.w - 2 * pad, r.h - 2 * pad - (label ? 16 : 0));
        const grid = run.config.P ? Math.round(run.config.H / run.config.P) : 0;
        drawScene(g, r.x + (r.w - side) / 2, r.y + pad, side, side, grid);
        if (label) txt(g, r.x + r.w / 2, r.y + r.h - 7, label, 'ad-label', 'middle');
      } else {
        const lines = String(label).split('\n').filter(Boolean);
        const miniH = n.mini ? 22 : 0;
        const subLines = sub ? 1 : 0;
        const total = lines.length * 15 + subLines * 13;
        let y0 = r.y + (r.h - miniH) / 2 - total / 2 + 11;
        let cx = r.x + r.w / 2;
        if (n.symbol) {
          // símbolo de operación de tensor a la izquierda, texto centrado en el resto
          const sr = Math.min(r.h / 2 - 3, 9);
          drawSymbol(g, n.symbol, r.x + 6 + sr, r.y + r.h / 2, sr);
          cx = r.x + (2 * sr + 8) + (r.w - (2 * sr + 8)) / 2;
        }
        lines.forEach((ln, i) => txt(g, cx, y0 + i * 15, ln, 'ad-label', 'middle'));
        if (sub) txt(g, cx, y0 + lines.length * 15 + 0.5, sub, 'ad-sub', 'middle');
        if (n.mini) drawMini(g, n.mini, r, used);
      }
      if (cost && cost.params > 0 && ctl.mode !== 'blank' && !ctl.quiz) {
        used.badge = true;
        const s = fsi(cost.params);
        const bw = textW(s, 10.5, true) + 18;
        // insignia de parámetros: arriba a la izquierda (las etiquetas de forma van a la derecha de las aristas)
        const bx = n.badgePos === 'right' ? r.x + r.w - bw - 4 : r.x + 4, by = r.y - 8;
        const b = S('g', { class: 'ad-badge' }, g);
        S('rect', { x: r1(bx), y: by, width: r1(bw), height: 15, rx: 7.5, class: 'ad-badge-bg' }, b);
        S('path', { d: 'M' + P([bx + 6, by + 7.5]) + 'm-2.2,0a2.2,2.2 0 1,0 4.4,0a2.2,2.2 0 1,0 -4.4,0M' + P([bx + 8.2, by + 7.5]) + 'h3.6M' + P([bx + 10.6, by + 7.5]) + 'v2.2', class: 'ad-key' }, b);
        txt(b, bx + 14, by + 11.3, s, 'ad-badge-txt');
      }
      if (n.expand && ctl.mode === 'full') {
        const ex = S('g', { class: 'ad-expand-mark' }, g);
        S('path', { d: 'M' + P([r.x + r.w - 12, r.y + r.h - 4]) + 'h8v-8', class: 'ad-expand-ico' }, ex);
      }
    }
    if (slot) drawSlot(ctl, g, n.id, r, slot, shape);
    g.setAttribute('aria-label', slot ? 'Bloque con hueco' : nodeAria(ctl, n, run));
    return g;
  }

  function drawMini(g, mini, r, used) {
    // Esquema en miniatura dentro del nodo (p. ej. capa del encoder: LN → MHSA → ⊕ → LN → MLP → ⊕)
    const items = mini.items || mini;
    const y = r.y + r.h - 26, hgt = 16;
    const widths = items.map((it) => it.sym ? 12 : textW(it.label, 10, false) + 10);
    const gap = 8;
    const tot = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
    let x = r.x + (r.w - tot) / 2;
    const cx = [];
    const mg = S('g', { class: 'ad-mini' }, g);
    items.forEach((it, i) => {
      const w = widths[i];
      cx.push([x, x + w]);
      if (i > 0) S('path', { d: 'M' + P([x - gap + 1, y + hgt / 2]) + 'H' + r1(x - 1), class: 'ad-mini-ln' }, mg);
      if (it.sym) {
        const c = S('g', { class: 'ad-op--tensorop' }, mg);
        S('circle', { cx: x + 6, cy: y + hgt / 2, r: 6, class: 'ad-box' }, c);
        drawSymbol(c, it.sym, x + 6, y + hgt / 2, 6);
      } else {
        const c = S('g', { class: 'ad-op--' + it.op }, mg);
        if (it.op) used.ops.add(it.op);
        S('rect', { x: r1(x), y, width: r1(w), height: hgt, rx: 3, class: 'ad-box' }, c);
        txt(c, x + w / 2, y + 11.5, it.label, 'ad-mini-txt', 'middle');
      }
      x += w + gap;
    });
    for (const [a, b] of mini.res || []) {
      const xa = cx[a][0] - 3, xb = (cx[b][0] + cx[b][1]) / 2;
      S('path', { d: 'M' + P([xa, y + hgt / 2]) + 'V' + r1(y - 5) + 'H' + r1(xb) + 'V' + r1(y + 1), class: 'ad-mini-res' }, mg);
    }
  }

  function drawMapNode(ctl, parent, n, r, used) {
    const it = (ATLAS.catalog && ATLAS.catalog() && ATLAS.catalog().items && ATLAS.catalog().items[n.id]) || null;
    const page = ATLAS.getPage ? ATLAS.getPage(n.id) : null;
    const anchor = n.anchor || (it && it.anchor);
    const state = anchor ? 'anchor' : (page && page.ready) ? 'ready' : (it && it.kind === 'card') ? 'card' : 'soon';
    used.map.add('state-' + state);
    const g = S('g', { class: 'ad-node ad-mapnode ad-mapnode--' + state, 'data-node': n.id, 'data-href': '#' + n.id, tabindex: 0, role: 'link' }, parent);
    S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.h / 2 > 10 ? 6 : r.h / 2, class: 'ad-box' }, g);
    const label = n.label || (it && (it.short || it.title)) || n.id;
    txt(g, r.x + r.w / 2, r.y + r.h / 2 + 4.5, label, 'ad-map-label', 'middle');
    if (state === 'soon' && it && it.phase) txt(g, r.x + r.w - 4, r.y - 3, 'F' + it.phase, 'ad-map-phase', 'end');
    g.setAttribute('aria-label', label + (state === 'ready' ? ' — listo' : state === 'anchor' ? ' — lo que ya sabes' : state === 'card' ? ' — tarjeta de nivel 1' : ' — próximamente'));
    return g;
  }

  function nodeAria(ctl, n, run) {
    const parts = [n.label || n.id];
    if (n.sub) parts.push(n.sub);
    const io = nodeIO(ctl.cur(), n.id, run);
    if (io.in.length) parts.push('entrada ' + io.in.map((t) => shapeText(t, 'num')).join(', '));
    if (io.out.length) parts.push('salida ' + io.out.map((t) => shapeText(t, 'num')).join(', '));
    if (n.expand) parts.push('se puede abrir');
    return parts.join('; ');
  }

  function nodeIO(view, nodeId, run) {
    const ins = [], outs = [];
    if (!run || !view) return { in: ins, out: outs };
    for (const e of view.spec.edges || []) {
      if (!e.tensor || !run.tensors[e.tensor]) continue;
      if (e.to === nodeId && ins.indexOf(run.tensors[e.tensor]) < 0) ins.push(run.tensors[e.tensor]);
      if (e.from === nodeId && outs.indexOf(run.tensors[e.tensor]) < 0) outs.push(run.tensors[e.tensor]);
    }
    return { in: ins, out: outs };
  }

  // Hueco de práctica (§8.1). align: 'c' centrado en ax, 'l' empieza en ax, 'r' termina en ax.
  function slotText(st, slot) { return st.state === 'empty' ? (slot && slot.ask === 'op' ? '¿tipo de op?' : '?') : st.text; }
  function slotAria(slot, st) {
    const what = slot.ask === 'op' ? 'tipo de operación' : slot.ask === 'shape' ? 'forma del tensor' : 'nombre del bloque';
    return 'Hueco' + (slot.n != null ? ' ' + slot.n : '') + ': ' + what + ' — ' + (st.state === 'empty' ? 'vacío' : st.text);
  }
  function slotBox(ctl, parent, sid, slot, ax, y, align) {
    const st = ctl.slotState[sid] || { text: '?', state: 'empty' };
    const s = S('g', { class: 'ad-slot ad-slot--' + st.state, 'data-slot': sid, 'data-align': align, 'data-ax': r1(ax), 'data-y': r1(y), tabindex: 0, role: 'button', 'aria-label': slotAria(slot, st) }, parent);
    S('rect', { class: 'ad-slot-box', height: 20, rx: 4 }, s);
    S('text', { class: 'ad-slot-txt', 'text-anchor': 'middle' }, s);
    if (slot.n != null) { const nb = S('g', { class: 'ad-slot-n' }, s); S('circle', { r: 7.5 }, nb); S('text', { 'text-anchor': 'middle' }, nb).textContent = String(slot.n); }
    layoutSlot(s, slot, st);
    return s;
  }
  function layoutSlot(s, slot, st) {
    const t = slotText(st, slot);
    const w = Math.max(40, textW(t, 12, true) + 16), h = 20;
    const ax = +s.getAttribute('data-ax'), y = +s.getAttribute('data-y'), al = s.getAttribute('data-align');
    const x = al === 'l' ? ax : al === 'r' ? ax - w : ax - w / 2;
    const rect = s.querySelector('.ad-slot-box'), tx = s.querySelector('.ad-slot-txt');
    rect.setAttribute('x', r1(x)); rect.setAttribute('y', r1(y)); rect.setAttribute('width', r1(w));
    tx.setAttribute('x', r1(x + w / 2)); tx.setAttribute('y', r1(y + 14)); tx.textContent = t;
    const nb = s.querySelector('.ad-slot-n');
    if (nb) { nb.querySelector('circle').setAttribute('cx', r1(x)); nb.querySelector('circle').setAttribute('cy', r1(y)); const nt = nb.querySelector('text'); nt.setAttribute('x', r1(x)); nt.setAttribute('y', r1(y + 3.5)); }
    s.setAttribute('class', 'ad-slot ad-slot--' + st.state);
    s.setAttribute('aria-label', slotAria(slot, st));
  }
  function drawSlot(ctl, g, slotId, r, slot, shape) {
    if (CIRCLE_SHAPES[shape]) slotBox(ctl, g, slotId, slot, r.x + r.w + 8, r.y + r.h / 2 - 10, 'l');
    else if (slot.ask === 'op') slotBox(ctl, g, slotId, slot, r.x + r.w / 2, r.y + r.h - 10, 'c');   // sobre el borde inferior
    else slotBox(ctl, g, slotId, slot, r.x + r.w / 2, r.y + (r.h - 20) / 2, 'c');
  }

  // ------------------------------------------------------------ aristas
  function roundedPath(pts, rad) {
    if (pts.length < 2) return '';
    let d = 'M' + P(pts[0]);
    for (let i = 1; i < pts.length - 1; i++) {
      const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
      const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const rr = Math.min(rad, l1 / 2, l2 / 2);
      const a = [p1[0] + (p0[0] - p1[0]) * rr / l1, p1[1] + (p0[1] - p1[1]) * rr / l1];
      const b = [p1[0] + (p2[0] - p1[0]) * rr / l2, p1[1] + (p2[1] - p1[1]) * rr / l2];
      d += 'L' + P(a) + 'Q' + P(p1) + ' ' + P(b);
    }
    return d + 'L' + P(pts[pts.length - 1]);
  }

  function arrowHead(parent, pts, cls, size) {
    const n = pts.length, q = pts[n - 1], p = pts[n - 2];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L;
    const s = size || 7, w = s * 0.55;
    const b = [q[0] - ux * s, q[1] - uy * s];
    S('path', { d: 'M' + P(q) + 'L' + P([b[0] - uy * w, b[1] + ux * w]) + 'L' + P([b[0] + uy * w, b[1] - ux * w]) + 'Z', class: cls }, parent);
    return b;
  }

  function shorten(pts, by) {
    const out = pts.map((p) => p.slice());
    const n = out.length, q = out[n - 1], p = out[n - 2];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    out[n - 1] = [q[0] - (q[0] - p[0]) / L * by, q[1] - (q[1] - p[1]) / L * by];
    return out;
  }

  function labelAnchor(pts, e) {
    const sg = segs(pts);
    if (!sg.length) return null;
    let i;
    if (e.labelSeg != null) i = e.labelSeg < 0 ? sg.length + e.labelSeg : e.labelSeg;
    else { let best = -1; sg.forEach((s, k) => { const l = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]); if (l > best) { best = l; i = k; } }); }
    i = clamp(i, 0, sg.length - 1);
    const s = sg[i];
    const t = e.labelT == null ? 0.5 : e.labelT;
    const x = s[0][0] + (s[1][0] - s[0][0]) * t, y = s[0][1] + (s[1][1] - s[0][1]) * t;
    const vertical = near(s[0][0], s[1][0]);
    const side = e.labelSide || (vertical ? 'right' : 'above');
    return { x, y, side, vertical };
  }

  // Etiqueta de forma: símbolos arriba, números abajo (mono). (x, y) = ancla; side = dónde va el texto.
  function shapeLabel(ctl, parent, t, x, y, side, tensorId) {
    const sym = shapeText(t, 'sym'), num = shapeText(t, 'num');
    const g = S('g', { class: 'ad-shape' + (ctl.showNumbers ? '' : ' ad-shape--nonum') }, parent);
    const anchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';
    let ys, yn;
    if (side === 'above') { yn = y - 6; ys = ctl.showNumbers ? y - 19 : y - 6; }
    else if (side === 'below') { ys = y + 15; yn = y + 28; }
    else { ys = ctl.showNumbers ? y - 2.5 : y + 4; yn = y + 10.5; }
    const tx = side === 'left' ? x - 7 : side === 'right' ? x + 7 : x;
    const a = txt(g, tx, ys, sym, 'ad-shape-sym', anchor);
    a.setAttribute('data-tensor', tensorId);
    const b = txt(g, tx, yn, num, 'ad-shape-num', anchor);
    b.setAttribute('data-tensor', tensorId);
    if (!ctl.showNumbers) b.setAttribute('visibility', 'hidden');
    return g;
  }

  function drawEdge(ctl, L, ge, run, used, tensorAt, isMap) {
    const e = ge.spec;
    if (!ge.pts.length) return null;
    const kind = ge.kind;
    used.edges.add(kind);
    if (isMap && MAP_KINDS.indexOf(kind) >= 0) used.map.add(kind);
    const t = e.tensor && run ? run.tensors[e.tensor] : null;
    let slot = (e.tensor && slotFor(ctl, ge.key + '@' + e.tensor)) || slotFor(ctl, ge.key) || (e.tensor && slotFor(ctl, 'tensor:' + e.tensor));
    if (slot && slot.tensor && e.tensor && slot.tensor !== e.tensor) slot = null;   // aristas paralelas (q y k): solo la del tensor pedido
    const g = S('g', { class: 'ad-edge ad-edge--' + kind, 'data-edge': ge.key, 'data-kind': kind, 'data-tensor': e.tensor || null,
      tabindex: (t || isMap) && ctl.mode !== 'blank' ? -1 : null, role: t ? 'button' : null }, L.edges);
    const headSize = kind === 'control' ? 5 : 7;
    let d;
    if (ge.curve) {
      const [A, C1, C2, B] = ge.curve;
      const L = Math.hypot(B[0] - C2[0], B[1] - C2[1]) || 1;
      const B2 = kind === 'contrasta' ? B : [B[0] - (B[0] - C2[0]) / L * (headSize - 1), B[1] - (B[1] - C2[1]) / L * (headSize - 1)];
      d = 'M' + P(A) + 'C' + P(C1) + ' ' + P(C2) + ' ' + P(B2);
      S('path', { d: 'M' + P(A) + 'C' + P(C1) + ' ' + P(C2) + ' ' + P(B), class: 'ad-hit' }, g);
    } else {
      d = roundedPath(shorten(ge.pts, headSize - 1), 8);
      S('path', { d: roundedPath(ge.pts, 8), class: 'ad-hit' }, g);  // área de toque
    }
    if (kind === 'cross') {
      S('path', { d, class: 'ad-ln ad-ln--cross-out' }, g);
      S('path', { d, class: 'ad-ln ad-ln--cross-in' }, g);
    } else S('path', { d, class: 'ad-ln' }, g);
    const hollow = kind === 'cross' || kind === 'usa';
    if (kind !== 'contrasta') arrowHead(g, ge.curve ? [ge.curve[2], ge.curve[3]] : ge.pts, 'ad-head' + (hollow ? ' ad-head--hollow' : ''), headSize);
    if (kind === 'contrasta') { const p0 = ge.pts[0], p1 = ge.pts[ge.pts.length - 1]; S('circle', { cx: r1(p0[0]), cy: r1(p0[1]), r: 2.4, class: 'ad-end' }, g); S('circle', { cx: r1(p1[0]), cy: r1(p1[1]), r: 2.4, class: 'ad-end' }, g); }
    if (isMap) g.setAttribute('aria-label', (MAP_KIND_TITLES[kind] || kind) + ': ' + e.from + ' → ' + e.to + (e.label ? ' (' + e.label + ')' : ''));
    if (e.dot) { const dp = ge.pts.length > 2 ? ge.pts[1] : ge.pts[0]; S('circle', { cx: r1(dp[0]), cy: r1(dp[1]), r: 2.8, class: 'ad-dot' }, g); }
    if (kind === 'cross' || e.tag) {
      const la = labelAnchor(ge.pts, Object.assign({}, e, { labelT: e.tagT == null ? 0.25 : e.tagT, labelSide: e.tagSide || null }));
      if (la) {
        const tg = S('g', { class: 'ad-tag' }, L.labels);
        tg.setAttribute('data-edge-tag', ge.key);
        const s = e.tag || 'K,V';
        const tw = textW(s, 10.5, true) + 8;
        const off = la.vertical ? [-(tw / 2) - 8, 0] : [0, 12];
        S('rect', { x: r1(la.x + off[0] - tw / 2), y: r1(la.y + off[1] - 8), width: r1(tw), height: 15, rx: 3, class: 'ad-tag-bg' }, tg);
        txt(tg, la.x + off[0], la.y + off[1] + 3.5, s, 'ad-tag-txt', 'middle');
      }
    }
    if (t && SHAPED[kind]) {
      used.mods.add(t.mod || 'img');
      const la = labelAnchor(ge.pts, e);
      const tk = tensorAt[ge.key + '@' + e.tensor] || tensorAt[ge.key];
      const hide = ctl.hideShapes === true || (Array.isArray(ctl.hideShapes) && ctl.hideShapes.indexOf(e.tensor) >= 0);
      if (slot) {
        drawEdgeSlot(ctl, g, ge, la, slot, e.tensor);
      } else if (la && !hide && e.label !== false) {
        let lx = la.x, ly = la.y;
        if (tk && tk.show !== 'label') {
          const gs = glyphSize(t);
          let gx, gy;
          if (la.side === 'right') { gx = la.x + 9; gy = la.y + gs.h / 2; lx = gx + gs.w; }
          else if (la.side === 'left') { gx = la.x - 9 - gs.w; gy = la.y + gs.h / 2; lx = gx; }
          else if (la.side === 'below') { gx = la.x - gs.w / 2; gy = la.y + 8 + gs.h; ly = gy; }
          else { gx = la.x - gs.w / 2; gy = la.y - 7; ly = gy - gs.h + 2; }
          drawGlyph(g, t, gx, gy, ctl.id, tk.mark);
        }
        if (!tk || tk.show !== 'glyph') {
          const sl = shapeLabel(ctl, g, t, lx, ly, la.side, e.tensor);
          sl.setAttribute('data-for', ge.key);
        }
      }
    }
    return g;
  }

  function drawEdgeSlot(ctl, g, ge, la, slot, tensorId) {
    const sid = slot.id || (ctl.slots[ge.key] ? ge.key : ge.key + '@' + tensorId);
    if (la.side === 'left') slotBox(ctl, g, sid, slot, la.x - 8, la.y - 10, 'r');
    else if (la.side === 'above') slotBox(ctl, g, sid, slot, la.x, la.y - 25, 'c');
    else if (la.side === 'below') slotBox(ctl, g, sid, slot, la.x, la.y + 5, 'c');
    else slotBox(ctl, g, sid, slot, la.x + 8, la.y - 10, 'l');
  }

  // ============================================================ leyenda
  function legendEl(view, opts) {
    const used = view.used;
    const wrap = H('div', { class: 'ad-legend', role: 'list', 'aria-label': 'Leyenda' });
    const item = (sw, label, cls) => {
      const li = H('div', { class: 'ad-leg-item' + (cls ? ' ' + cls : ''), role: 'listitem' }, wrap);
      const s = S('svg', { width: 26, height: 16, viewBox: '0 0 26 16', 'aria-hidden': 'true', class: 'ad-leg-sw' });
      sw(s);
      li.appendChild(s);
      H('span', { text: label }, li);
    };
    const ops = ATLAS.OP_TYPES || [];
    for (const o of ops) {
      if (!used.ops.has(o.id)) continue;
      item((s) => {
        const g = S('g', { class: 'ad-op--' + o.id }, s);
        if (o.id === 'tensorop') { S('circle', { cx: 13, cy: 8, r: 6.5, class: 'ad-box' }, g); drawSymbol(g, 'add', 13, 8, 6.5); }
        else S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-box' }, g);
      }, o.title);
    }
    const mods = ATLAS.MODALITIES || [];
    const lid = view.legendDefsId;
    for (const m of mods) {
      if (!used.mods.has(m.id)) continue;
      item((s) => {
        defs(s, lid + '-l' + m.id);
        const g = S('g', { class: 'ad-glyph ad-mod--' + m.id + (m.id === 'qry' ? ' ad-glyph--outline' : '') }, s);
        S('rect', { x: 3, y: 3, width: 20, height: 10, class: 'ad-face ad-face--front', fill: 'url(#' + lid + '-l' + m.id + '-tx-' + m.id + ')' }, g);
      }, 'Tensor: ' + m.title.toLowerCase());
    }
    const ek = ATLAS.EDGE_KINDS || [];
    for (const k of ek) {
      if (!used.edges.has(k.id)) continue;
      item((s) => {
        const g = S('g', { class: 'ad-edge ad-edge--' + k.id }, s);
        if (k.id === 'cross') { S('path', { d: 'M2 8H20', class: 'ad-ln ad-ln--cross-out' }, g); S('path', { d: 'M2 8H20', class: 'ad-ln ad-ln--cross-in' }, g); }
        else S('path', { d: 'M2 8H19', class: 'ad-ln' }, g);
        arrowHead(g, [[2, 8], [25, 8]], 'ad-head' + (k.id === 'cross' ? ' ad-head--hollow' : ''), k.id === 'control' ? 5 : 7);
      }, k.title);
    }
    for (const mk of MAP_KINDS) {
      if (!used.map.has(mk)) continue;
      item((s) => {
        const g = S('g', { class: 'ad-edge ad-edge--' + mk }, s);
        S('path', { d: 'M2 8H19', class: 'ad-ln' }, g);
        if (mk !== 'contrasta') arrowHead(g, [[2, 8], [25, 8]], 'ad-head' + (mk === 'usa' ? ' ad-head--hollow' : ''), 7);
      }, MAP_KIND_TITLES[mk]);
    }
    const states = [['ready', 'Listo (nivel 2)'], ['soon', 'Próximamente'], ['card', 'Tarjeta de nivel 1'], ['anchor', 'Lo que ya sabes']];
    for (const [st, label] of states) {
      if (!used.map.has('state-' + st)) continue;
      item((s) => { const g = S('g', { class: 'ad-mapnode ad-mapnode--' + st }, s); S('rect', { x: 2, y: 3, width: 22, height: 10, rx: 5, class: 'ad-box' }, g); }, label);
    }
    if (used.repeat) item((s) => { S('rect', { x: 7, y: 6, width: 16, height: 9, rx: 2, class: 'ad-stack' }, s); S('rect', { x: 4.5, y: 3.5, width: 16, height: 9, rx: 2, class: 'ad-stack' }, s); S('rect', { x: 2, y: 1, width: 16, height: 9, rx: 2, class: 'ad-frame' }, s); }, 'Bloque repetido × L');
    if (used.heads) item((s) => { const g = S('g', { class: 'ad-op--attn' }, s); for (let i = 3; i >= 0; i--) S('rect', { x: 2 + i * 2.5, y: 5 - i * 1.5, width: 14, height: 9, rx: 2, class: 'ad-box' + (i ? ' ad-box--deck' : '') }, g); }, 'Una carta por cabeza (h)');
    if (used.badge) item((s) => { S('rect', { x: 1, y: 3, width: 24, height: 10, rx: 5, class: 'ad-badge-bg' }, s); S('path', { d: 'M5,8m-2,0a2,2 0 1,0 4,0a2,2 0 1,0 -4,0M7,8h3.5M9.5,8v2', class: 'ad-key' }, s); }, 'Parámetros aprendibles');
    if (opts && opts.withShapes !== false && view.spec.kind !== 'map') {
      const li = H('div', { class: 'ad-leg-item ad-leg-shape', role: 'listitem' }, wrap);
      H('span', { class: 'ad-leg-mono', html: '<b>(N+1)×D</b> / 197×768' }, li);
      H('span', { text: 'forma: símbolos / números (sin batch)' }, li);
    }
    return wrap;
  }

  // ============================================================ controlador
  function render(diagramId, container, opts) {
    opts = opts || {};
    const spec0 = ATLAS.diagram(diagramId);
    const ctl = {
      id: 'ad' + (++uid), mode: opts.mode || 'full', opts, rootId: diagramId,
      stack: [diagramId], views: {}, slots: {}, slotState: {}, hl: null, walk: null,
      showNumbers: opts.showNumbers != null ? !!opts.showNumbers : prefGet('showNumbers', true),
      hideShapes: opts.hideShapes || false, quiz: !!opts.quiz, vb: null, zoomed: false, destroyed: false, listeners: [],
    };
    ctl.cur = () => ctl.view;
    ctl.runFor = (spec) => {
      if (spec.kind === 'map' || !spec.config) return null;
      return runFor(opts.config || spec.config);
    };
    if (opts.blank && opts.blank.slots) for (const s of opts.blank.slots) {
      ctl.slots[s.id] = s;
      if (s.tensor && s.id.indexOf('>') > 0 && s.id.indexOf('@') < 0) ctl.slots[s.id + '@' + s.tensor] = s;
    }

    const fig = H('figure', { class: 'ad ad--' + ctl.mode + (opts.wide ? ' ad--wide' : ''), 'data-diagram': diagramId });
    container.appendChild(fig);
    if (!spec0) { H('div', { class: 'ad-error', role: 'alert', text: 'Diagrama desconocido: ' + diagramId }, fig); return stubController(fig); }

    // ---- barra de herramientas
    let crumbs = null, walkBar = null, legendBox = null, panel = null, tip = null, alt = null, hint = null;
    if (ctl.mode === 'full') {
      const tb = H('div', { class: 'ad-toolbar' }, fig);
      crumbs = H('nav', { class: 'ad-crumbs', 'aria-label': 'Ruta del diagrama' }, tb);
      const tools = H('div', { class: 'ad-tools', role: 'toolbar', 'aria-label': 'Herramientas del diagrama' }, tb);
      const btn = (label, title, fn, extra) => { const b = H('button', Object.assign({ type: 'button', class: 'ad-btn', title, 'aria-label': title }, extra || {}), tools); b.innerHTML = label; b.addEventListener('click', fn); return b; };
      ctl.bBack = btn('<span aria-hidden="true">←</span> Volver', 'Volver al nivel anterior', () => api.collapse(), { hidden: 'hidden' });
      ctl.bBack.hidden = true;
      btn('−', 'Alejar', () => zoomBy(1 / 1.35));
      btn('+', 'Acercar', () => zoomBy(1.35));
      btn('Ajustar', 'Ajustar al ancho', () => fit(true));
      if (spec0.kind !== 'map') ctl.bNum = btn('Números', 'Mostrar números', () => { ctl.showNumbers = !ctl.showNumbers; prefSet('showNumbers', ctl.showNumbers); if (ctl.bNum) ctl.bNum.setAttribute('aria-pressed', String(ctl.showNumbers)); redraw(); }, { 'aria-pressed': String(ctl.showNumbers) });
      ctl.bLeg = btn('Leyenda', 'Mostrar u ocultar la leyenda', () => { const open = legendBox.hidden; legendBox.hidden = !open; ctl.bLeg.setAttribute('aria-pressed', String(open)); prefSet('legendOpen', open); }, { 'aria-pressed': 'true' });
      const firstWalk = (spec0.walks || [])[0];
      if (firstWalk) ctl.bWalk = btn('Recorrido', 'Recorrido con números paso a paso', () => (ctl.walk ? api.stopWalk() : api.startWalk(opts.walk || firstWalk.id)), { 'aria-pressed': 'false' });
      ctl.bFull = btn('<span aria-hidden="true">⛶</span>', 'Pantalla completa', () => toggleFull(), { 'aria-pressed': 'false' });
      walkBar = H('div', { class: 'ad-walk', hidden: 'hidden', 'aria-live': 'polite' }, fig);
      walkBar.hidden = true;
    }
    const body = H('div', { class: 'ad-body' }, fig);
    const vp = H('div', { class: 'ad-viewport', tabindex: '-1' }, body);
    if (ctl.mode !== 'blank' && !ctl.quiz) { tip = H('div', { class: 'ad-tip', role: 'tooltip', id: ctl.id + '-tip' }, vp); tip.hidden = true; }
    if (ctl.mode === 'full') {
      panel = H('aside', { class: 'ad-panel', 'aria-label': 'Detalle del bloque' }, body);
      panel.hidden = true;
      hint = H('div', { class: 'ad-hint', 'aria-hidden': 'true', text: 'Toca para explorar · pellizca para hacer zoom' }, vp);
      legendBox = H('div', { class: 'ad-legend-wrap' }, fig);
      const lo = prefGet('legendOpen', true);
      legendBox.hidden = !lo;
      ctl.bLeg.setAttribute('aria-pressed', String(!!lo));
    }
    if (spec0.caption && ctl.mode === 'full') H('figcaption', { class: 'ad-caption', html: qResolve(spec0.caption, spec0.config) }, fig);
    if (ctl.mode === 'full') { alt = H('details', { class: 'ad-alt' }, fig); }

    // ---- vista actual
    function mountView(id) {
      const spec = ATLAS.diagram(id);
      let view;
      try { view = buildView(ctl, spec); }
      catch (err) {
        vp.querySelectorAll('svg.ad-svg, .ad-error').forEach((x) => x.remove());
        H('div', { class: 'ad-error', role: 'alert', text: 'No se pudo dibujar "' + id + '": ' + err.message }, vp);
        return null;
      }
      view.legendDefsId = ctl.id + '-' + id;
      const old = vp.querySelector('svg.ad-svg');
      if (old) old.remove();
      vp.querySelectorAll('.ad-error').forEach((x) => x.remove());
      vp.insertBefore(view.svg, vp.firstChild);
      ctl.view = view;
      fig.setAttribute('data-view', id);
      // aria-label de nodos (necesita la vista actual para las formas)
      for (const n of spec.nodes || []) if (view.nodeEls[n.id] && spec.kind !== 'map' && !ctl.slots[n.id]) view.nodeEls[n.id].setAttribute('aria-label', nodeAria(ctl, n, view.run));
      if (legendBox) { legendBox.innerHTML = ''; legendBox.appendChild(legendEl(view)); }
      if (crumbs) renderCrumbs();
      if (alt) renderAlt();
      if (ctl.bBack) ctl.bBack.hidden = ctl.stack.length < 2;
      if (ctl.hl) applyHighlight(ctl.hl);
      return view;
    }
    function redraw() { const keep = ctl.vb; mountView(ctl.stack[ctl.stack.length - 1]); sizeViewport(); if (keep && ctl.zoomed) setVB(keep); else fit(false); }

    function renderCrumbs() {
      crumbs.innerHTML = '';
      ctl.stack.forEach((id, i) => {
        const sp = ATLAS.diagram(id);
        const label = i === 0 ? rootTitle(sp) : crumbLabel(ATLAS.diagram(ctl.stack[i - 1]), sp);
        if (i > 0) H('span', { class: 'ad-crumb-sep', 'aria-hidden': 'true', text: '›' }, crumbs);
        if (i === ctl.stack.length - 1) H('span', { class: 'ad-crumb', 'aria-current': 'location', text: label }, crumbs);
        else { const b = H('button', { type: 'button', class: 'ad-crumb ad-crumb--link', text: label }, crumbs); b.addEventListener('click', () => collapseTo(i)); }
      });
    }
    function rootTitle(sp) {
      if (sp.kind === 'map') return sp.title || 'Mapa';
      try { const r = ctl.runFor(sp); return (r && r.label) || sp.title; } catch (e) { return sp.title || sp.id; }
    }
    function crumbLabel(parentSpec, sp) {
      const n = parentSpec && (parentSpec.nodes || []).find((x) => x.id === sp.parentNode);
      let s = (n && n.label ? n.label.replace(/\n/g, ' ') : sp.title) || sp.id;
      const grp = parentSpec && n && (parentSpec.groups || []).find((g) => g.repeat && inside(n, g));
      if (grp) { try { const r = ctl.runFor(parentSpec); s += ' × ' + r.config[grp.repeat.from || grp.repeat.sym]; } catch (e) { /* sin número */ } }
      return s;
    }

    function renderAlt() {
      const view = ctl.view, spec = view.spec, run = view.run;
      alt.innerHTML = '';
      H('summary', { text: 'Bloques y formas (texto alternativo)' }, alt);
      const list = H('dl', { class: 'ad-alt-list' }, alt);
      for (const n of spec.nodes || []) {
        H('dt', { text: (n.label || n.id).replace(/\n/g, ' ') + (n.sub ? ' — ' + n.sub : '') }, list);
        const dd = H('dd', null, list);
        if (spec.kind === 'map') { dd.innerHTML = '<a href="#' + esc(n.id) + '">Abrir</a>'; continue; }
        const io = nodeIO(view, n.id, run);
        const parts = [];
        if (io.in.length) parts.push('Entra: ' + io.in.map((t) => shapeText(t, 'sym') + ' = ' + shapeText(t, 'num')).join(', '));
        if (io.out.length) parts.push('Sale: ' + io.out.map((t) => shapeText(t, 'sym') + ' = ' + shapeText(t, 'num')).join(', '));
        if (run && n.op !== 'io') { const c = nodeCost(run, n); if (c.params) parts.push('Parámetros: ' + fint(c.params) + (c.rep > 1 ? ' por capa' : '')); if (c.macs) parts.push('MACs: ' + fint(c.macs) + (c.rep > 1 ? ' por capa' : '')); }
        if (n.expand) parts.push('Se abre en: ' + ((ATLAS.diagram(n.expand) || {}).title || n.expand));
        dd.innerHTML = esc(parts.join(' · ')) + (n.note ? '<br>' + qResolve(n.note, spec.config) : '');
      }
    }

    // ---- tamaño del viewport y viewBox
    function sizeViewport() {
      const view = ctl.view; if (!view) return;
      const cw = vp.clientWidth || container.clientWidth || 800;
      if (fig.classList.contains('ad--fs')) { vp.style.height = ''; return; }
      const s = Math.min(capScale(), cw / (view.width + 24));
      const maxH = Math.max(260, (root.innerHeight || 900) * (isMobile() ? 0.72 : 0.92));
      vp.style.height = Math.round(clamp((view.height + 24) * s, 160, maxH)) + 'px';
    }
    function content() { const v = ctl.view; return { x: -12, y: -12, w: v.width + 24, h: v.height + 24 }; }
    function vpSize() { return { w: vp.clientWidth || 800, h: vp.clientHeight || 500 }; }
    function capScale() { return fig.classList.contains('ad--fs') ? 1.6 : ctl.mode === 'mini' ? 1 : 1.1; }
    function isMobile() { return (root.innerWidth || 1000) < 768; }
    function fitVB() {
      // Escritorio: todo el diagrama visible (sin pasar de 1.1×). Móvil (< 768 px): ajustado al ancho,
      // anclado arriba; lo que no cabe se recorre arrastrando.
      const C = content(), s = vpSize();
      const kW = Math.min(capScale(), s.w / C.w);
      const k = isMobile() && !fig.classList.contains('ad--fs') ? kW : Math.min(kW, s.h / C.h);
      const w = s.w / k, h = s.h / k;
      const y = C.h * k > s.h + 1 ? C.y : C.y - (h - C.h) / 2;
      return { x: C.x - (w - C.w) / 2, y, w, h };
    }
    function setVB(vb) {
      const C = content(), f = fitVB();
      const w = clamp(vb.w, f.w / 4, f.w), h = w * (vpSize().h / vpSize().w);
      let x = vb.x, y = vb.y;
      x = w >= C.w ? C.x - (w - C.w) / 2 : clamp(x, C.x, C.x + C.w - w);
      y = h >= C.h ? C.y - (h - C.h) / 2 : clamp(y, C.y, C.y + C.h - h);
      ctl.vb = { x, y, w, h };
      ctl.zoomed = w < f.w * 0.98;
      vp.classList.toggle('ad-viewport--zoomed', ctl.zoomed);
      if (ctl.view) ctl.view.svg.setAttribute('viewBox', [x, y, w, h].map(r1).join(' '));
    }
    function fit(anim) { const f = fitVB(); if (anim && ctl.vb) animateVB(ctl.vb, f, 260); else setVB(f); }
    function zoomAt(f, sx, sy) {
      const vb = ctl.vb, s = vpSize();
      const wx = vb.x + sx / s.w * vb.w, wy = vb.y + sy / s.h * vb.h;
      const nw = clamp(vb.w / f, fitVB().w / 4, fitVB().w), nh = nw * s.h / s.w;
      setVB({ x: wx - sx / s.w * nw, y: wy - sy / s.h * nh, w: nw, h: nh });
    }
    function zoomBy(f) { const s = vpSize(); const target = Object.assign({}, ctl.vb); zoomAt(f, s.w / 2, s.h / 2); const end = ctl.vb; setVB(target); animateVB(target, end, 180); }
    let animId = 0;
    function animateVB(a, b, ms) {
      return new Promise((res) => {
        if (reducedMotion() || !root.requestAnimationFrame) { setVB(b); res(); return; }
        const my = ++animId, t0 = performance.now();
        const step = (now) => {
          if (my !== animId || ctl.destroyed) { res(); return; }
          const t = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - t, 3);
          const vb = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, w: a.w + (b.w - a.w) * e, h: a.h + (b.h - a.h) * e };
          ctl.vb = vb; ctl.view.svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].map(r1).join(' '));
          if (t < 1) root.requestAnimationFrame(step); else { setVB(b); res(); }
        };
        root.requestAnimationFrame(step);
      });
    }
    function rectVB(r) {
      const s = vpSize(), pad = 16;
      let w = r.w + pad * 2, h = r.h + pad * 2;
      if (w / h < s.w / s.h) w = h * s.w / s.h; else h = w * s.h / s.w;
      return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
    }

    // ---- expandir / volver
    async function expandTo(id, fromNodeId) {
      const spec = ATLAS.diagram(id);
      if (!spec || ctl.mode === 'blank') return;
      const curId = ctl.stack[ctl.stack.length - 1];
      if (spec.parent && spec.parent !== curId) {
        // cadena: subir hasta un ancestro común y bajar
        const chain = [];
        let s = spec;
        while (s && s.id !== curId && s.parent) { chain.unshift(s.id); s = ATLAS.diagram(s.parent); }
        if (!s || s.id !== curId) {
          const i = ctl.stack.indexOf(chain.length ? ATLAS.diagram(chain[0]).parent : null);
          if (i >= 0) { ctl.stack = ctl.stack.slice(0, i + 1); mountView(ctl.stack[i]); sizeViewport(); fit(false); }
          else { ctl.stack = [ctl.rootId]; mountView(ctl.rootId); sizeViewport(); fit(false); let p = spec; const up = []; while (p && p.id !== ctl.rootId) { up.unshift(p.id); p = ATLAS.diagram(p.parent); } for (const x of up.slice(0, -1)) { ctl.stack.push(x); } if (up.length > 1) { mountView(ctl.stack[ctl.stack.length - 1]); sizeViewport(); fit(false); } }
          return expandTo(id);
        }
        for (const x of chain.slice(0, -1)) await expandTo(x);
        return expandTo(id);
      }
      hideTip(); closePanel();
      const nodeId = fromNodeId || spec.parentNode;
      const r = ctl.view && ctl.view.geo.nodes[nodeId];
      if (r && ctl.vb) { await animateVB(ctl.vb, rectVB(r), 300); }
      ctl.stack.push(id);
      mountView(id);
      sizeViewport();
      fadeIn();
      fit(false);
      if (opts.onExpand) try { opts.onExpand(id); } catch (e) { /* callback externo */ }
    }
    function fadeIn() { if (reducedMotion()) return; const s = ctl.view.svg; s.classList.add('ad-enter'); root.requestAnimationFrame(() => root.requestAnimationFrame(() => s.classList.remove('ad-enter'))); }
    async function collapseTo(i) {
      if (i < 0 || i >= ctl.stack.length - 1) return;
      const hadFocus = fig.contains(document.activeElement);
      hideTip(); closePanel();
      const leaving = ATLAS.diagram(ctl.stack[i + 1]);
      ctl.stack = ctl.stack.slice(0, i + 1);
      mountView(ctl.stack[i]);
      sizeViewport();
      const r = ctl.view.geo.nodes[leaving.parentNode];
      if (r) { setVB(rectVB(r)); fadeIn(); await animateVB(ctl.vb, fitVB(), 300); } else fit(false);
      const el = ctl.view.nodeEls[leaving.parentNode];
      if (el && (hadFocus || fig.contains(document.activeElement))) el.focus({ preventScroll: true });
    }

    // ---- tooltip
    let tipFor = null;
    function showTip(target, x, y) {
      if (!tip || ctl.mode === 'blank') return;
      const html = tipHTML(target);
      if (!html) { hideTip(); return; }
      tip.innerHTML = html;
      tip.querySelectorAll('[data-tex]').forEach((el) => texInto(el, el.getAttribute('data-tex'), false));
      tip.hidden = false;
      tipFor = target;
      const s = vpSize(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let tx = x + 14, ty = y + 14;
      if (tx + tw > s.w - 4) tx = Math.max(4, x - tw - 14);
      if (ty + th > s.h - 4) ty = Math.max(4, y - th - 14);
      tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
    }
    function hideTip() { if (tip) { tip.hidden = true; tipFor = null; } }
    function tipHTML(target) {
      const view = ctl.view, spec = view.spec, run = view.run;
      if (target.node) {
        const n = (spec.nodes || []).find((x) => x.id === target.node);
        if (!n) return '';
        if (spec.kind === 'map') return mapTip(n);
        if (slotFor(ctl, n.id)) return '';
        let h = '<div class="ad-tip-t">' + esc((n.label || n.id).replace(/\n/g, ' ')) + '</div>';
        if (n.sub) h += '<div class="ad-tip-sub">' + esc(n.sub) + '</div>';
        if (n.tex) h += '<div class="ad-tip-tex" data-tex="' + esc(n.tex) + '"></div>';
        const io = nodeIO(view, n.id, run);
        if (io.in.length || io.out.length) h += '<div class="ad-tip-io">' + io.in.map(shp).join(', ') + (io.in.length && io.out.length ? ' <span aria-hidden="true">→</span> ' : '') + io.out.map(shp).join(', ') + '</div>';
        if (run && n.op !== 'io') {
          const c = nodeCost(run, n);
          if (c.params || c.macs) h += '<div class="ad-tip-cost">' + (c.params ? 'Parámetros <b>' + fint(c.params) + '</b>' : 'Sin parámetros') + (c.macs ? ' · MACs <b>' + fsi(c.macs) + '</b>' : '') + (c.rep > 1 ? ' <span class="ad-muted">por capa (× ' + c.rep + ')</span>' : '') + '</div>';
          else h += '<div class="ad-tip-cost ad-muted">Sin parámetros ni MACs de matmul</div>';
        }
        h += '<div class="ad-tip-hint">' + (n.expand && ctl.mode === 'full' ? 'Clic: detalle · doble clic o + : abrir bloque' : ctl.mode === 'full' ? 'Clic o Enter: detalle' : '') + '</div>';
        return h;
      }
      if (target.edge) {
        const e = (spec.edges || []).find((x) => edgeKey(x) === target.edge && (!target.tensor || x.tensor === target.tensor));
        if (!e) return '';
        if (spec.kind === 'map') return '<div class="ad-tip-t">' + esc(MAP_KIND_TITLES[e.kind] || e.kind) + '</div><div class="ad-tip-sub">' + esc(mapLabel(e.from)) + ' → ' + esc(mapLabel(e.to)) + '</div>' + (e.label ? '<div>' + esc(e.label) + '</div>' : '');
        const t = e.tensor && run && run.tensors[e.tensor];
        if (!t || slotFor(ctl, edgeKey(e)) || slotFor(ctl, edgeKey(e) + '@' + e.tensor)) return '';
        const els = (t.num || []).reduce((a, b) => a * b, 1);
        return '<div class="ad-tip-t">' + esc(t.label || e.tensor) + '</div>' + (t.tex ? '<div class="ad-tip-tex" data-tex="' + esc(t.tex + ' \\in \\mathbb{R}^{' + (t.sym || []).join('\\times ') + '}') + '"></div>' : '')
          + '<div class="ad-tip-io">' + shp(t) + '</div><div class="ad-tip-cost">' + fint(els) + ' elementos · ' + esc(((ATLAS.MODALITIES || []).find((m) => m.id === t.mod) || {}).title || t.mod || '') + '</div>'
          + (e.kind === 'cross' ? '<div class="ad-tip-sub">K y V vienen de otro flujo</div>' : '');
      }
      return '';
    }
    function shp(t) { return '<span class="ad-mono">' + esc(shapeText(t, 'sym')) + ' = <b>' + esc(shapeText(t, 'num')) + '</b></span>'; }
    function mapLabel(id) { const n = (ctl.view.spec.nodes || []).find((x) => x.id === id); const it = catItem(id); return (n && n.label) || (it && (it.short || it.title)) || id; }
    function catItem(id) { const c = ATLAS.catalog && ATLAS.catalog(); return (c && c.items && c.items[id]) || null; }
    function mapTip(n) {
      const it = catItem(n.id);
      let h = '<div class="ad-tip-t">' + esc((it && it.title) || n.label || n.id) + '</div>';
      if (it && it.summary) h += '<div class="ad-tip-p">' + it.summary + '</div>';
      const rels = (ctl.view.spec.edges || []).filter((e) => e.from === n.id || e.to === n.id);
      if (rels.length) h += '<div class="ad-tip-cost">' + rels.map((e) => esc((e.from === n.id ? '→ ' + mapLabel(e.to) : '← ' + mapLabel(e.from)) + ' (' + e.kind + ')')).join('<br>') + '</div>';
      return h;
    }

    // ---- panel de detalle
    let panelFor = null;
    function openPanel(nodeId) {
      const view = ctl.view, spec = view.spec, run = view.run;
      const n = (spec.nodes || []).find((x) => x.id === nodeId);
      if (!n) return;
      if (opts.onSelect) try { opts.onSelect(nodeId); } catch (e) { /* callback externo */ }
      if (!panel) return;
      panelFor = nodeId;
      panel.innerHTML = '';
      const head = H('div', { class: 'ad-panel-head' }, panel);
      H('h4', { class: 'ad-panel-t', text: (n.label || n.id).replace(/\n/g, ' ') }, head);
      const close = H('button', { type: 'button', class: 'ad-btn ad-panel-x', 'aria-label': 'Cerrar detalle', title: 'Cerrar (Esc)' }, head, '×');
      close.addEventListener('click', () => { closePanel(); const el = ctl.view.nodeEls[nodeId]; if (el) el.focus({ preventScroll: true }); });
      if (spec.kind === 'map') {
        const it = catItem(n.id);
        if (it && it.titleEn) H('p', { class: 'ad-panel-en', text: it.titleEn }, panel);
        if (it && it.summary) H('p', null, panel, it.summary);
        if (n.note) H('p', null, panel, n.note);
        const page = ATLAS.getPage ? ATLAS.getPage(n.id) : null;
        const href = it && it.kind === 'card' ? '#mapa.' + (ATLAS.slug ? ATLAS.slug(n.id) : n.id) : '#' + n.id;
        H('a', { class: 'ad-btn ad-btn--primary', href, text: page && page.ready ? 'Abrir página' : it && it.kind === 'card' ? 'Ver tarjeta' : 'Ver qué viene' }, panel);
      } else {
        if (n.sub) H('p', { class: 'ad-panel-sub', text: n.sub }, panel);
        if (n.note) H('div', { class: 'ad-panel-note' }, panel, qResolve(n.note, spec.config));
        if (n.tex) texInto(H('div', { class: 'ad-panel-tex' }, panel), n.tex, true);
        const io = nodeIO(view, n.id, run);
        if (io.in.length || io.out.length) {
          const tbl = H('table', { class: 'ad-panel-io' }, panel);
          const row = (k, ts) => { if (!ts.length) return; const tr = H('tr', null, tbl); H('th', { text: k }, tr); H('td', null, tr, ts.map(shp).join('<br>')); };
          row('Entra', io.in); row('Sale', io.out);
        }
        if (run && n.op !== 'io') {
          const c = nodeCost(run, n);
          const box = H('div', { class: 'ad-panel-cost' }, panel);
          if (!c.ops.length) H('p', { class: 'ad-muted', text: 'Sin operaciones del calculador asociadas.' }, box);
          const withP = c.ops.filter((o) => o.params), withM = c.ops.filter((o) => o.macs);
          if (withP.length) {
            H('h5', { text: 'Parámetros' + (c.rep > 1 ? ' (por capa)' : '') }, box);
            for (const o of withP) costRow(box, o, 'param');
            if (withP.length > 1) H('p', { class: 'ad-panel-sum' }, box, 'Total: <b>' + fint(c.params) + '</b>');
          } else if (c.ops.length) H('p', { class: 'ad-muted', text: 'Sin parámetros aprendibles.' }, box);
          if (withM.length) {
            H('h5', { text: 'MACs' + (c.rep > 1 ? ' (por capa)' : '') }, box);
            for (const o of withM) costRow(box, o, 'mac');
            if (withM.length > 1) H('p', { class: 'ad-panel-sum' }, box, 'Total: <b>' + fint(c.macs) + '</b> (= ' + fsi(c.macs) + ' MACs, ' + fsi(2 * c.macs) + ' FLOPs)');
          }
          if (c.rep > 1) H('p', { class: 'ad-panel-sum' }, box, 'En el modelo (× ' + c.rep + '): <b>' + fint(c.total.params) + '</b> parámetros · <b>' + fsi(c.total.macs) + '</b> MACs');
        }
        const acts = H('div', { class: 'ad-panel-acts' }, panel);
        if (n.expand && ATLAS.diagram(n.expand)) { const b = H('button', { type: 'button', class: 'ad-btn ad-btn--primary', text: 'Abrir bloque' }, acts); b.addEventListener('click', () => expandTo(n.expand, n.id)); }
        if (spec.page && run && n.op !== 'io') H('a', { class: 'ad-btn', href: '#' + spec.page + '.operaciones', text: 'Ver en Operaciones' }, acts);
      }
      panel.hidden = false;
      hideTip();
      fig.classList.add('ad--panel');
      panel.querySelectorAll('[data-tex]').forEach((el) => texInto(el, el.getAttribute('data-tex'), false));
      if (!ctl.zoomed) { sizeViewport(); fit(false); }
      const vh = root.innerWidth < 1024;
      if (vh) panel.scrollTop = 0;
    }
    function costRow(box, o, which) {
      const p = H('div', { class: 'ad-cost-row' }, box);
      H('div', { class: 'ad-cost-l', text: o.label || o.id }, p);
      const tex = which === 'param' ? o.paramTex : o.macTex;
      const ar = which === 'param' ? o.paramArith : o.macArith;
      if (tex) texInto(H('div', { class: 'ad-cost-tex' }, p), tex, false);
      H('div', { class: 'ad-cost-ar ad-mono', text: ar || fint(which === 'param' ? o.params : o.macs) }, p);
    }
    function closePanel() { if (!panel || panel.hidden) return; panel.hidden = true; panelFor = null; fig.classList.remove('ad--panel'); if (!ctl.zoomed) { sizeViewport(); fit(false); } }

    // ---- resaltado
    function applyHighlight(h) {
      const view = ctl.view; if (!view) return;
      const svg = view.svg;
      svg.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on'));
      if (!h) { svg.classList.remove('ad--hl'); return; }
      svg.classList.add('ad--hl');
      for (const id of h.nodes || []) { const el = view.nodeEls[id]; if (el) el.classList.add('is-on'); const gr = svg.querySelector('[data-group="' + id + '"]'); if (gr) gr.classList.add('is-on'); }
      for (const k of h.edges || []) {
        const [key, tn] = k.split('@');
        svg.querySelectorAll('[data-edge="' + cssq(key) + '"]').forEach((el) => { if (!tn || el.getAttribute('data-tensor') === tn) el.classList.add('is-on'); });
      }
      for (const t of h.tensors || []) svg.querySelectorAll('[data-tensor="' + cssq(t) + '"].ad-edge, [data-tensor-glyph="' + cssq(t) + '"]').forEach((el) => el.classList.add('is-on'));
      // los grupos que contienen nodos activos no se atenúan
      for (const g of view.spec.groups || []) {
        if ((h.nodes || []).some((id) => { const n = (view.spec.nodes || []).find((x) => x.id === id); return n && inside(n, g); })) { const gr = svg.querySelector('[data-group="' + g.id + '"]'); if (gr) gr.classList.add('is-on'); }
      }
    }
    function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    // ---- recorrido
    function walkSpec(id) { return (spec0.walks || []).find((w) => w.id === id) || null; }
    async function goStep(i) {
      const w = ctl.walk; if (!w) return;
      w.i = clamp(i, 0, w.spec.steps.length - 1);
      const st = w.spec.steps[w.i];
      const target = st.expand || ctl.rootId;
      if (ctl.stack[ctl.stack.length - 1] !== target) {
        if (target === ctl.rootId) await collapseTo(0); else await expandTo(target);
      }
      ctl.hl = { nodes: st.nodes || [], edges: st.edges || [], tensors: st.tensors || [] };
      applyHighlight(ctl.hl);
      walkBar.querySelector('.ad-walk-n').textContent = 'Paso ' + (w.i + 1) + ' de ' + w.spec.steps.length;
      walkBar.querySelector('.ad-walk-text').innerHTML = qResolve(st.text || '', spec0.config);
      walkBar.querySelector('.ad-walk-prev').disabled = w.i === 0;
      walkBar.querySelector('.ad-walk-next').disabled = w.i === w.spec.steps.length - 1;
      const M = ATLAS.MathTex; if (M && M.typeset) try { M.typeset(walkBar.querySelector('.ad-walk-text')); } catch (e) { /* sin MathJax */ }
      try {
        document.dispatchEvent(new CustomEvent('atlas:diagram-tensor', { detail: { diagram: ctl.rootId, config: opts.config || spec0.config, tensors: st.tensors || [] } }));
        document.querySelectorAll('tr.is-walk').forEach((tr) => tr.classList.remove('is-walk'));
        for (const t of st.tensors || []) document.querySelectorAll('tr[data-tensor="' + cssq(t) + '"]').forEach((tr) => tr.classList.add('is-walk'));
      } catch (e) { /* sin tabla de trace */ }
      // centra los elementos activos si estamos con zoom
      if (ctl.zoomed) focusBox(st.nodes || []);
    }
    function focusBox(ids) {
      const g = ctl.view.geo; const rs = ids.map((id) => g.nodes[id]).filter(Boolean);
      if (!rs.length) return;
      const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
      const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
      const vb = ctl.vb;
      setVB({ x: (x0 + x1) / 2 - vb.w / 2, y: (y0 + y1) / 2 - vb.h / 2, w: vb.w, h: vb.h });
    }
    function buildWalkBar() {
      walkBar.innerHTML = '';
      const top = H('div', { class: 'ad-walk-top' }, walkBar);
      H('span', { class: 'ad-walk-label', text: ctl.walk.spec.label || 'Recorrido' }, top);
      H('span', { class: 'ad-walk-n' }, top);
      const nav = H('div', { class: 'ad-walk-nav' }, top);
      const b = (cls, html, title, fn) => { const x = H('button', { type: 'button', class: 'ad-btn ' + cls, title, 'aria-label': title }, nav, html); x.addEventListener('click', fn); return x; };
      b('ad-walk-prev', '← Anterior', 'Paso anterior', () => { stopPlay(); goStep(ctl.walk.i - 1); });
      ctl.bPlay = b('ad-walk-play', '▶', 'Reproducir', () => (ctl.walk.timer ? stopPlay() : play()));
      b('ad-walk-next', 'Siguiente →', 'Paso siguiente', () => { stopPlay(); goStep(ctl.walk.i + 1); });
      b('ad-walk-x', '×', 'Terminar recorrido', () => api.stopWalk());
      H('div', { class: 'ad-walk-text' }, walkBar);
    }
    function play() {
      const w = ctl.walk; if (!w) return;
      ctl.bPlay.innerHTML = '❚❚'; ctl.bPlay.setAttribute('aria-label', 'Pausa');
      w.timer = setInterval(() => { if (w.i >= w.spec.steps.length - 1) { stopPlay(); return; } goStep(w.i + 1); }, 3800);
    }
    function stopPlay() { const w = ctl.walk; if (w && w.timer) { clearInterval(w.timer); w.timer = null; } if (ctl.bPlay) { ctl.bPlay.innerHTML = '▶'; ctl.bPlay.setAttribute('aria-label', 'Reproducir'); } }

    // ---- pantalla completa (overlay CSS, no Fullscreen API)
    function toggleFull(force) {
      const on = force != null ? force : !fig.classList.contains('ad--fs');
      fig.classList.toggle('ad--fs', on);
      document.documentElement.classList.toggle('ad-noscroll', on);
      if (ctl.bFull) ctl.bFull.setAttribute('aria-pressed', String(on));
      sizeViewport(); fit(false);
    }

    // ---- eventos: puntero, rueda, teclado
    const ptrs = new Map();
    let down = null, pinch = null, lastTap = { node: null, t: 0 };
    function targetOf(el) {
      const slot = el.closest && el.closest('[data-slot]');
      if (slot && fig.contains(slot)) return { slot: slot.getAttribute('data-slot'), el: slot };
      const n = el.closest && el.closest('[data-node]');
      if (n && fig.contains(n)) return { node: n.getAttribute('data-node'), el: n };
      const e = el.closest && el.closest('[data-edge]');
      if (e && fig.contains(e) && e.closest('.ad-svg')) return { edge: e.getAttribute('data-edge'), tensor: e.getAttribute('data-tensor'), el: e };
      return null;
    }
    function local(ev) { const b = vp.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; }
    function on(el, ev, fn, o) { el.addEventListener(ev, fn, o); ctl.listeners.push([el, ev, fn, o]); }

    on(vp, 'pointerdown', (ev) => {
      if (hint) hint.classList.add('ad-hint--gone');
      if (ev.button && ev.button !== 0) return;
      ptrs.set(ev.pointerId, local(ev));
      if (ptrs.size === 1) down = { id: ev.pointerId, p: local(ev), vb: Object.assign({}, ctl.vb), moved: false, target: targetOf(ev.target), type: ev.pointerType };
      else if (ptrs.size === 2) {
        const [a, b] = Array.from(ptrs.values());
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
        if (down) down.moved = true;
      }
    });
    on(vp, 'pointermove', (ev) => {
      if (ptrs.has(ev.pointerId)) ptrs.set(ev.pointerId, local(ev));
      if (pinch && ptrs.size === 2) {
        const [a, b] = Array.from(ptrs.values());
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (pinch.d > 0) zoomAt(d / pinch.d, m[0], m[1]);
        const s = vpSize();
        setVB({ x: ctl.vb.x - (m[0] - pinch.m[0]) * ctl.vb.w / s.w, y: ctl.vb.y - (m[1] - pinch.m[1]) * ctl.vb.h / s.h, w: ctl.vb.w, h: ctl.vb.h });
        pinch = { d, m };
        ev.preventDefault();
        return;
      }
      if (down && ev.pointerId === down.id) {
        const p = local(ev), dx = p[0] - down.p[0], dy = p[1] - down.p[1];
        if (!down.moved && Math.hypot(dx, dy) > 5) { down.moved = true; try { vp.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ } vp.classList.add('ad-viewport--drag'); hideTip(); }
        if (down.moved) {
          const s = vpSize();
          setVB({ x: down.vb.x - dx * down.vb.w / s.w, y: down.vb.y - dy * down.vb.h / s.h, w: down.vb.w, h: down.vb.h });
        }
        return;
      }
      if (ev.pointerType === 'mouse' && !down) {
        const t = targetOf(ev.target);
        mapHover(t && t.node ? t.node : null);
        if (t && (t.node || t.edge)) { const p = local(ev); if (!tipFor || tipFor.el !== t.el) showTip(t, p[0], p[1]); else moveTip(p); }
        else if (tipFor) hideTip();
      }
    });
    function moveTip(p) { if (!tip || tip.hidden) return; const s = vpSize(), tw = tip.offsetWidth, th = tip.offsetHeight; let tx = p[0] + 14, ty = p[1] + 14; if (tx + tw > s.w - 4) tx = Math.max(4, p[0] - tw - 14); if (ty + th > s.h - 4) ty = Math.max(4, p[1] - th - 14); tip.style.left = tx + 'px'; tip.style.top = ty + 'px'; }
    const endPtr = (ev) => {
      ptrs.delete(ev.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (!down || ev.pointerId !== down.id) return;
      const d = down; down = null;
      vp.classList.remove('ad-viewport--drag');
      if (d.moved || ev.type === 'pointercancel') return;
      const t = d.target;
      if (!t) { hideTip(); return; }
      activate(t, d.type, local(ev));
    };
    on(vp, 'pointerup', endPtr);
    on(vp, 'pointercancel', endPtr);
    on(vp, 'pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !down) { hideTip(); mapHover(null); } });
    // Mapa: al pasar o enfocar un nodo se resaltan sus relaciones (si no hay otro resaltado activo).
    let mapHoverId = null;
    function mapHover(id) {
      if (!ctl.view || ctl.view.spec.kind !== 'map' || ctl.walk || ctl.hl) return;
      if (id === mapHoverId) return;
      mapHoverId = id;
      if (!id) { applyHighlight(null); return; }
      const es = (ctl.view.spec.edges || []).filter((e) => e.from === id || e.to === id);
      applyHighlight({ nodes: [id].concat(es.map((e) => (e.from === id ? e.to : e.from))), edges: es.map(edgeKey), tensors: [] });
    }
    on(vp, 'dblclick', (ev) => { const t = targetOf(ev.target); if (t && t.node) { const n = nodeSpec(t.node); if (n && n.expand) { ev.preventDefault(); expandTo(n.expand, n.id); } } });
    on(vp, 'wheel', (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      ev.preventDefault();
      const p = local(ev);
      zoomAt(Math.exp(-ev.deltaY * 0.01), p[0], p[1]);
    }, { passive: false });

    function nodeSpec(id) { return (ctl.view.spec.nodes || []).find((x) => x.id === id); }
    function activate(t, ptype, p) {
      if (t.slot) { const s = ctl.slots[t.slot]; if (opts.blank && opts.blank.onSlot) opts.blank.onSlot(t.slot, t.el); return s; }
      if (ctl.mode === 'blank') return;
      if (t.node && ctl.view.spec.kind === 'map' && ctl.mode !== 'full') { if (opts.onSelect) opts.onSelect(t.node); return; }
      if (ptype === 'touch' || ptype === 'pen') {
        // primer toque = tooltip; segundo = abrir
        const key = t.node || (t.edge + '@' + t.tensor);
        const now = Date.now();
        if (lastTap.key !== key || now - lastTap.t > 6000) { lastTap = { key, t: now }; showTip(t, p[0], p[1]); return; }
        lastTap = { key: null, t: 0 };
      }
      hideTip();
      if (t.node) { if (ctl.mode === 'full') openPanel(t.node); else if (opts.onSelect) opts.onSelect(t.node); }
      else if (t.edge && ctl.mode === 'full') { showTip(t, p[0], p[1]); }
    }

    on(fig, 'keydown', (ev) => {
      const t = targetOf(ev.target);
      const k = ev.key;
      if (k === 'Escape') {
        if (tip && !tip.hidden) { hideTip(); ev.stopPropagation(); return; }
        if (panel && !panel.hidden) { const id = panelFor; closePanel(); if (id && ctl.view.nodeEls[id]) ctl.view.nodeEls[id].focus({ preventScroll: true }); ev.stopPropagation(); return; }
        if (fig.classList.contains('ad--fs')) { toggleFull(false); ev.stopPropagation(); return; }
        return;
      }
      if (!t) return;
      if (k === 'Enter' || k === ' ') {
        ev.preventDefault();
        if (t.slot) { activate(t); return; }
        if (t.node && ctl.view.spec.kind === 'map' && ctl.mode === 'full') { openPanel(t.node); return; }
        if (t.node) { if (ctl.mode === 'full') openPanel(t.node); else if (opts.onSelect) opts.onSelect(t.node); }
        else if (t.edge) showTipAt(t);
        return;
      }
      if (k === '+' || k === '=') { if (t.node) { const n = nodeSpec(t.node); if (n && n.expand) { ev.preventDefault(); expandTo(n.expand, n.id).then(() => focusFirst()); } } return; }
      if (k === '-' || k === 'Backspace') { if (ctl.stack.length > 1) { ev.preventDefault(); collapseTo(ctl.stack.length - 2); } return; }
      const fwd = k === 'ArrowRight' || k === 'ArrowDown', back = k === 'ArrowLeft' || k === 'ArrowUp';
      if (!fwd && !back) return;
      ev.preventDefault();
      const edges = (ctl.view.spec.edges || []).filter((e) => (e.kind || 'data') === 'data' || ctl.view.spec.kind === 'map');
      if (t.node) {
        const e = fwd ? edges.find((x) => x.from === t.node) : edges.find((x) => x.to === t.node);
        if (!e) return;
        const el = edgeEl(e);
        if (el && el.hasAttribute('tabindex')) { el.focus({ preventScroll: false }); showTipAt({ edge: edgeKey(e), tensor: e.tensor, el }); }
        else { const n = ctl.view.nodeEls[fwd ? e.to : e.from]; if (n) n.focus(); }
      } else if (t.edge) {
        const [from, to] = t.edge.split('>');
        const n = ctl.view.nodeEls[fwd ? to : from];
        if (n) { hideTip(); n.focus(); }
      }
    });
    on(fig, 'focusin', (ev) => {
      const t = targetOf(ev.target);
      if (t && t.node && t.node !== panelFor && !(ev.target.matches && ev.target.matches(':hover'))) showTipAt(t);
      if (t && t.node) mapHover(t.node);
      if (t && ctl.zoomed) ensureVisible(t.el);
    });
    on(fig, 'focusout', (ev) => { if (!fig.contains(ev.relatedTarget)) { hideTip(); mapHover(null); } });
    function edgeEl(e) { return Array.from(ctl.view.svg.querySelectorAll('[data-edge="' + cssq(edgeKey(e)) + '"]')).find((x) => !e.tensor || x.getAttribute('data-tensor') === e.tensor); }
    function showTipAt(t) {
      const b = t.el.getBoundingClientRect(), v = vp.getBoundingClientRect();
      showTip(t, b.left - v.left + b.width / 2, b.top - v.top + b.height);
    }
    function ensureVisible(el) {
      const b = el.getBoundingClientRect(), v = vp.getBoundingClientRect();
      if (b.left >= v.left && b.right <= v.right && b.top >= v.top && b.bottom <= v.bottom) return;
      const s = vpSize(), vb = ctl.vb;
      const cx = vb.x + ((b.left + b.right) / 2 - v.left) / s.w * vb.w, cy = vb.y + ((b.top + b.bottom) / 2 - v.top) / s.h * vb.h;
      setVB({ x: cx - vb.w / 2, y: cy - vb.h / 2, w: vb.w, h: vb.h });
    }
    function focusFirst() { const n = (ctl.view.spec.nodes || [])[0]; if (n && ctl.view.nodeEls[n.id]) ctl.view.nodeEls[n.id].focus({ preventScroll: true }); }

    // ---- tamaño reactivo
    let ro = null;
    if (root.ResizeObserver) {
      let lastW = 0;
      ro = new ResizeObserver(() => { const w = vp.clientWidth; if (Math.abs(w - lastW) < 2) return; lastW = w; const z = ctl.zoomed, keep = ctl.vb; sizeViewport(); if (z && keep) setVB(keep); else fit(false); });
      ro.observe(body);
    }
    const onWinResize = () => { if (fig.classList.contains('ad--fs')) fit(false); };
    on(root, 'resize', onWinResize);

    // ---- montaje inicial
    mountView(diagramId);
    sizeViewport();
    fit(false);
    if (root.requestAnimationFrame) root.requestAnimationFrame(() => { if (!ctl.destroyed) { sizeViewport(); if (!ctl.zoomed) fit(false); } });

    function inside(n, g) { return n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h; }

    const api = {
      el: fig,
      get view() { return ctl.stack[ctl.stack.length - 1]; },
      expand: (id) => expandTo(id),
      collapse: () => collapseTo(ctl.stack.length - 2),
      focusNode(nodeId, o) {
        o = o || {};
        let vid = ctl.stack[ctl.stack.length - 1];
        const has = (id) => ((ATLAS.diagram(id) || {}).nodes || []).some((n) => n.id === nodeId);
        const go = () => { const el = ctl.view.nodeEls[nodeId]; if (!el) return false; if (ctl.zoomed) ensureVisible(el); el.focus({ preventScroll: !!o.preventScroll }); if (o.open !== false && ctl.mode === 'full') { openPanel(nodeId); hideTip(); } return true; };
        if (has(vid)) return go();
        // busca en el diagrama raíz y en sus descendientes
        const all = ATLAS.diagrams ? Object.values(ATLAS.diagrams()) : [];
        const desc = (id) => all.filter((d) => d.parent === id).flatMap((d) => [d.id].concat(desc(d.id)));
        const cands = [ctl.rootId].concat(desc(ctl.rootId));
        vid = cands.find(has);
        if (!vid) return false;
        const p = vid === ctl.rootId ? collapseTo(0) : expandTo(vid);
        return Promise.resolve(p).then(go);
      },
      highlight(h) { ctl.hl = h || null; applyHighlight(ctl.hl); },
      clearHighlight() { ctl.hl = null; applyHighlight(null); },
      setSlot(slotId, text, state) {
        const st = { text: text == null || text === '' ? '?' : String(text), state: state || (text ? 'filled' : 'empty') };
        ctl.slotState[slotId] = st;
        const el = ctl.view && ctl.view.svg.querySelector('[data-slot="' + cssq(slotId) + '"]');
        if (el) layoutSlot(el, ctl.slots[slotId] || {}, st);   // actualización ligera: no redibuja la vista
      },
      startWalk(walkId) {
        if (ctl.mode !== 'full') return;
        const w = walkSpec(walkId || ((spec0.walks || [])[0] || {}).id);
        if (!w) return;
        ctl.walk = { spec: w, i: 0, timer: null };
        buildWalkBar();
        walkBar.hidden = false;
        fig.classList.add('ad--walking');
        if (ctl.bWalk) ctl.bWalk.setAttribute('aria-pressed', 'true');
        return goStep(0);
      },
      stopWalk() {
        if (!ctl.walk) return;
        stopPlay();
        ctl.walk = null;
        walkBar.hidden = true;
        fig.classList.remove('ad--walking');
        if (ctl.bWalk) ctl.bWalk.setAttribute('aria-pressed', 'false');
        ctl.hl = null; applyHighlight(null);
        try { document.querySelectorAll('tr.is-walk').forEach((tr) => tr.classList.remove('is-walk')); } catch (e) { /* nada */ }
      },
      walkStep: (i) => goStep(i),
      get walkIndex() { return ctl.walk ? ctl.walk.i : -1; },
      setShowNumbers(v) { ctl.showNumbers = !!v; redraw(); },
      fit: () => fit(false),
      zoom: (f) => zoomBy(f || 1.35),
      destroy() {
        ctl.destroyed = true;
        stopPlay();
        if (ro) ro.disconnect();
        for (const [el, ev, fn, o] of ctl.listeners) el.removeEventListener(ev, fn, o);
        document.documentElement.classList.remove('ad-noscroll');
        if (fig.parentNode) fig.parentNode.removeChild(fig);
      },
      _ctl: ctl,
    };
    return api;
  }

  function stubController(fig) {
    const nop = () => {};
    return { el: fig, expand: nop, collapse: nop, focusNode: nop, highlight: nop, clearHighlight: nop, setSlot: nop, startWalk: nop, stopWalk: nop, destroy() { if (fig.parentNode) fig.parentNode.removeChild(fig); } };
  }

  function prefGet(k, d) { try { const s = ATLAS.store; if (s && s.pref) { const v = s.pref(k); return v == null ? d : v; } } catch (e) { /* sin store */ } return d; }
  function prefSet(k, v) { try { const s = ATLAS.store; if (s && s.setPref) s.setPref(k, v); } catch (e) { /* sin store */ } }

  function legend(diagramId) {
    const spec = ATLAS.diagram(diagramId);
    if (!spec) { const d = document.createElement('div'); d.className = 'ad-error'; d.textContent = 'Diagrama desconocido: ' + diagramId; return d; }
    const ctl = { id: 'adl' + (++uid), mode: 'mini', slots: {}, slotState: {}, showNumbers: true, cur: () => null, runFor: (s) => (s.kind === 'map' || !s.config ? null : runFor(s.config)) };
    const view = buildView(ctl, spec);
    view.legendDefsId = ctl.id;
    const wrap = document.createElement('div');
    wrap.className = 'ad-legend-wrap ad-legend-only';
    wrap.appendChild(legendEl(view));
    return wrap;
  }

  // Verificación: cada etiqueta de forma = ATLAS.Arch.fmt.shape del tensor del calculador.
  function checkLabels(rootEl) {
    const bad = [];
    const figs = rootEl.matches && rootEl.matches('figure.ad') ? [rootEl] : Array.from(rootEl.querySelectorAll('figure.ad'));
    for (const f of figs) {
      const spec = ATLAS.diagram(f.getAttribute('data-view') || f.getAttribute('data-diagram'));
      if (!spec || !spec.config) continue;
      const run = runFor(spec.config);
      f.querySelectorAll('[data-edge] .ad-shape-num, [data-edge] .ad-shape-sym, [data-tensor-glyph] .ad-shape-num, [data-tensor-glyph] .ad-shape-sym').forEach((tEl) => {
        const id = tEl.getAttribute('data-tensor');
        const t = run.tensors[id];
        const want = t ? shapeText(t, tEl.classList.contains('ad-shape-num') ? 'num' : 'sym') : '(tensor desconocido)';
        if (tEl.textContent !== want) bad.push({ diagram: spec.id, edge: (tEl.closest('[data-edge]') || {}).getAttribute ? tEl.closest('[data-edge]').getAttribute('data-edge') : null, tensor: id, got: tEl.textContent, want });
      });
    }
    return bad;
  }

  ATLAS.ArchDiagram = { render, legend, geometry, crossings, glyphSize, edgeKey, checkLabels, drawScene, UNIT: U, _route: routeEdge };

  // ============================================================ ATLAS.Viz (SPEC §7.8)
  const vizReg = {};
  ATLAS.Viz = {
    register(name, fn) { vizReg[name] = fn; },
    has: (name) => !!vizReg[name],
    names: () => Object.keys(vizReg),
    render(name, el, params, ctx) {
      const fn = vizReg[name];
      if (!fn) { const d = document.createElement('div'); d.className = 'ad-error'; d.setAttribute('role', 'alert'); d.textContent = 'Visualización desconocida: ' + name; el.appendChild(d); return { destroy() { d.remove(); } }; }
      try { return fn(el, params || {}, ctx || {}) || { destroy() {} }; }
      catch (err) { const d = document.createElement('div'); d.className = 'ad-error'; d.setAttribute('role', 'alert'); d.textContent = 'No se pudo dibujar la visualización "' + name + '": ' + err.message; el.appendChild(d); return { destroy() { d.remove(); } }; }
    },
    // utilidades compartidas por las visualizaciones
    svg: (tag, attrs, parent) => S(tag, attrs, parent),
    html: (tag, attrs, parent, inner) => H(tag, attrs, parent, inner),
    scene: drawScene,
  };
})(typeof window !== 'undefined' ? window : globalThis);
