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
     ATLAS.ArchDiagram.mapCheck(spec) → {through:[…], overTitle:[…], ok}  curvas de un mapa que pasan por
                  detrás de un nodo que no unen o sobre el título de una región (para el validador)
     ATLAS.ArchDiagram.glyphSize(tensor) → {w, h}
   Campos de spec que entiende el motor (además de SPEC §7.2):
     mapa: edge.via (puntos de paso, u), fromSide/toSide, bend, off (desvío lateral, px), pin (no re-enrutar);
           sin ellos, cada curva se enruta sola evitando nodos y títulos. spec.mobileFocus = ids que se
           encuadran al abrir en el teléfono.
     nodo: style:'block' (bloque compuesto, marco neutro), badgeTotal ("por capa"), badgePos:'right',
           subNum (sub con {{cfg.X}} cuando "Números" está activo). group.repeat.totalOf = id del nodo cuyo
           total (× L) se muestra bajo "× L = n". Etiquetas con subíndices TeX: "z_{ℓ−1}", "W_O".
     arista: tag, tagStyle:'plain' (neutra), tagSide:'on' (sobre la línea), tagT.
     tensors[]: at:{edge} o at:{x, y} (centro inferior, u) + note (texto encima) + labelSide:'below'.
     fase 5: tensors[].leader = {node, side, at} (línea guía del glifo suelto a su bloque); node.costExclude = [ids
           de path] (ops que no cuentan en la insignia: el neck dentro del encoder de SAM); group.style:'lane' +
           tone (warn|accent|head|fuse|muted) + legend (carriles "una vez por imagen" / "por prompt"; su label2 no
           va en la práctica) y group.hideInBlank (título oculto en la práctica).
     fase 8: node.runs / runsTone (píldora "× n"), node.costSplit (barra del costo por imagen), node.costNote, node.hideInBlank
           (nodo oculto en la práctica), edge.loop (↻ en la etiqueta), edge.shapeLabel (forma en una arista de control),
           edge.blankHide (forma oculta cuando un hueco pide la de ese tensor: da un factor de la respuesta).
     fase 10: node.bars (barras apiladas por fila, cada fila con su config, misma escala, líneas de referencia: memoria por
           método y GPU de 24/48/80 GB), node.matrix (la matriz de pesos a escala: W cuadrada, A y B como tiras de ancho r),
           node.adapter (píldora "+ B·A" encendida si la config adapta esa lineal, del calculador) y node.trainPill:false
           (congelado solo con el rayado).
     fase 12: tokens[].sent (centinela de span corruption, color por it.k) y tokens[].drop (token de un tramo corrompido);
           node.wave = {pad, seed} (onda de audio ilustrativa con el relleno a 30 s) y node.melGrid = {rows, cols, pad, seed}
           (espectrograma log-Mel ilustrativo), abajo del bloque. Ninguno cambia los diagramas anteriores.
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
  // Leyenda del mapa: la dirección se lee "A → B" (from → to).
  const MAP_KIND_TITLES = { hereda: 'A → B: B hereda de A (o toma su técnica)', usa: 'A ⇢ B: B usa A (componente o etapa previa)', contrasta: 'A ··· B: alternativas (sin dirección)', reemplaza: 'A → B: B reemplazó a A' };
  const MAP_KIND_SENT = {
    hereda: (a, b) => b + ' hereda de ' + a, usa: (a, b) => b + ' usa ' + a,
    contrasta: (a, b) => a + ' y ' + b + ': alternativas', reemplaza: (a, b) => b + ' reemplazó a ' + a,
  };
  const OPP = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  const NORMAL = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  const CIRCLE_SHAPES = { add: 1, concat: 1, split: 1, pool: 1, flatten: 1, mul: 1 };
  let uid = 0;
  // fase 7 (revisión): node.xref = [{href, label, cfg, cfgWhy}]: con cfg, el enlace abre la vista de destino con esa config
  // (LLaVA → el bloque del decoder con llama2-7b, la arquitectura de Vicuna-7B). La ruta (#página.sección~diagrama.nodo) no
  // lleva config: el clic la deja pendiente y la toma focusNode del diagrama que contiene la vista de destino.
  let pendingXref = null;

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
    // fromPt (u): la arista sale de un punto de otra (p. ej. una residual que se bifurca del flujo de datos)
    const A = e.fromPt ? [e.fromPt[0] * U, e.fromPt[1] * U] : attach(a, fs, e.fromAt), B = attach(b, ts, e.toAt);
    const targets = (e.via || []).map((v) => [v[0] * U, v[1] * U]).concat([B]);
    const pts = [A];
    let heading = e.fromPt ? (dirOf(A, targets[0]) || NORMAL[fs]) : NORMAL[fs];
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

  // ------------------------------------------------------------ curvas (mapas)
  // Una curva es una lista de tramos cúbicos [P0, C1, C2, P1] (px). pts = muestreo (cruces y choques).
  function bez(s, t) {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]];
  }
  function sampleCurve(segsC) {
    const pts = [];
    segsC.forEach((s, i) => {
      const L = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) + Math.hypot(s[2][0] - s[1][0], s[2][1] - s[1][1]) + Math.hypot(s[3][0] - s[2][0], s[3][1] - s[2][1]);
      const n = Math.max(8, Math.ceil(L / 12));
      for (let k = i ? 1 : 0; k <= n; k++) pts.push(bez(s, k / n));
    });
    return pts;
  }
  function polyLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
  const unit = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
  // Curva directa: una cúbica que sale y llega perpendicular a los lados (bend = tensión, off = desvío lateral).
  function directCurve(A, B, fs, ts, bend, off) {
    const dist = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const k = clamp(dist * bend, 16, 160);
    const na = NORMAL[fs], nb = NORMAL[ts];
    const n = unit([-(B[1] - A[1]), B[0] - A[0]]);
    return [[A, [A[0] + na[0] * k + n[0] * off, A[1] + na[1] * k + n[1] * off], [B[0] + nb[0] * k + n[0] * off, B[1] + nb[1] * k + n[1] * off], B]];
  }
  // Curva por puntos de paso: spline de Hermite con tangentes perpendiculares en los extremos.
  function viaCurve(A, B, fs, ts, vias) {
    const Q = [A].concat(vias, [B]);
    const T = Q.map((q, i) => (i === 0 ? NORMAL[fs] : i === Q.length - 1 ? [-NORMAL[ts][0], -NORMAL[ts][1]] : unit([Q[i + 1][0] - Q[i - 1][0], Q[i + 1][1] - Q[i - 1][1]])));
    const out = [];
    for (let i = 0; i < Q.length - 1; i++) {
      const L = Math.hypot(Q[i + 1][0] - Q[i][0], Q[i + 1][1] - Q[i][1]);
      const ka = (i === 0 ? 0.45 : 0.36) * L, kb = (i === Q.length - 2 ? 0.45 : 0.36) * L;
      out.push([Q[i], [Q[i][0] + T[i][0] * ka, Q[i][1] + T[i][1] * ka], [Q[i + 1][0] - T[i + 1][0] * kb, Q[i + 1][1] - T[i + 1][1] * kb], Q[i + 1]]);
    }
    return out;
  }
  function autoCurveSides(a, b) {
    const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
    const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
    const horiz = Math.abs(dx) - (a.w + b.w) / 2 > Math.abs(dy) - (a.h + b.h) / 2;
    if (horiz) { const fs = dx > 0 ? 'right' : 'left'; return [fs, OPP[fs]]; }
    const fs = dy > 0 ? 'bottom' : 'top';
    return [fs, OPP[fs]];
  }
  // Lado de r que mira hacia el punto p (eje dominante, normalizado por el tamaño del rectángulo).
  function sideToward(r, p) {
    const dx = (p[0] - (r.x + r.w / 2)) / (r.w / 2 + 8), dy = (p[1] - (r.y + r.h / 2)) / (r.h / 2 + 8);
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
  }

  // Obstáculos del mapa: nodos y títulos de región (los títulos van arriba a la izquierda, ver drawGroup).
  const REGION_TITLE = { dx: 10, base: 17, px: 11, charW: 7.6, asc: 11, desc: 3 };
  // Ancho máximo del título: el de la región menos márgenes (si no cabe, se comprime con textLength).
  const regionTitleMax = (r) => r.w - REGION_TITLE.dx - 4;
  function regionTitleRect(g, r) {
    if (!g.label) return null;
    const w = Math.min(String(g.label).length * REGION_TITLE.charW, regionTitleMax(r));
    return { x: r.x + REGION_TITLE.dx, y: r.y + REGION_TITLE.base - REGION_TITLE.asc, w, h: REGION_TITLE.asc + REGION_TITLE.desc };
  }
  function mapObstacles(spec, rects) {
    const obs = [];
    for (const n of spec.nodes || []) obs.push({ id: n.id, kind: 'node', r: rects[n.id] });
    for (const g of spec.groups || []) if (g.region) { const t = regionTitleRect(g, rects[g.id]); if (t) obs.push({ id: g.id, label: g.label, kind: 'title', r: t }); }
    return obs;
  }
  // Choques de una curva muestreada: nodos ajenos (inflados 5 px), títulos (3 px) y sus propios extremos (por dentro).
  function curveHits(pts, from, to, obs) {
    const hit = [];
    const A = pts[0], B = pts[pts.length - 1];
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of pts) { if (p[0] < bx0) bx0 = p[0]; if (p[0] > bx1) bx1 = p[0]; if (p[1] < by0) by0 = p[1]; if (p[1] > by1) by1 = p[1]; }
    for (const o of obs) {
      if (o.r.x - 6 > bx1 || o.r.x + o.r.w + 6 < bx0 || o.r.y - 6 > by1 || o.r.y + o.r.h + 6 < by0) continue;
      const own = o.kind === 'node' && (o.id === from || o.id === to);
      const m = own ? -2 : o.kind === 'title' ? 3 : 5;
      const r = o.r;
      for (const p of pts) {
        if (own && (Math.hypot(p[0] - A[0], p[1] - A[1]) < 10 || Math.hypot(p[0] - B[0], p[1] - B[1]) < 10)) continue;
        if (p[0] > r.x - m && p[0] < r.x + r.w + m && p[1] > r.y - m && p[1] < r.y + r.h + m) { hit.push(o); break; }
      }
    }
    return hit;
  }
  function polyCross(P, Q) {
    let n = 0;
    const or = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    for (let i = 1; i < P.length; i++) {
      const p1 = P[i - 1], p2 = P[i];
      const x0 = Math.min(p1[0], p2[0]), x1 = Math.max(p1[0], p2[0]), y0 = Math.min(p1[1], p2[1]), y1 = Math.max(p1[1], p2[1]);
      for (let j = 1; j < Q.length; j++) {
        const q1 = Q[j - 1], q2 = Q[j];
        if (Math.max(q1[0], q2[0]) < x0 || Math.min(q1[0], q2[0]) > x1 || Math.max(q1[1], q2[1]) < y0 || Math.min(q1[1], q2[1]) > y1) continue;
        if (or(p1, p2, q1) * or(p1, p2, q2) < 0 && or(q1, q2, p1) * or(q1, q2, p2) < 0) n++;
      }
    }
    return n;
  }
  // Carriles libres: huecos entre columnas y filas de nodos (en px), a 1/4, 1/2 y 3/4 de cada hueco.
  function mapLanes(spec, rects) {
    const ns = (spec.nodes || []).map((n) => rects[n.id]);
    const lanes = (lo, hi) => {
      const iv = ns.map((r) => [lo(r), hi(r)]).sort((p, q) => p[0] - q[0]);
      const merged = [];
      for (const v of iv) { const l = merged[merged.length - 1]; if (l && v[0] <= l[1]) l[1] = Math.max(l[1], v[1]); else merged.push(v.slice()); }
      const out = [];
      if (merged.length) out.push(merged[0][0] - 2 * U);
      for (let i = 1; i < merged.length; i++) { const g0 = merged[i - 1][1], g1 = merged[i][0]; [0.22, 0.5, 0.78].forEach((f) => out.push(g0 + (g1 - g0) * f)); }
      if (merged.length) out.push(merged[merged.length - 1][1] + 2 * U);
      return out;
    };
    return { x: lanes((r) => r.x, (r) => r.x + r.w), y: lanes((r) => r.y, (r) => r.y + r.h) };
  }
  // Enrutado del mapa: por arista, la curva directa si no choca; si no, la mejor entre variantes de lados,
  // tensión, desvío lateral y uno o dos puntos de paso por los carriles. Puntaje = choques ≫ cruces > largo.
  const mapCache = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function routeMap(spec, rects, W, Hh) {
    if (mapCache && mapCache.has(spec)) return mapCache.get(spec);
    const obs = mapObstacles(spec, rects);
    const lanes = mapLanes(spec, rects);
    const done = [];
    const out = {};
    let grid = new Map();                         // hash espacial de puntos ya trazados (celdas de 8 px)
    const cell = (x, y) => Math.floor(x / 8) + ',' + Math.floor(y / 8);
    const ends = (pts, p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) < 22 || Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) < 22;
    // tramos que corren encima de otra relación (paralelos a < 5 px), salvo junto a los extremos
    const overlap = (pts) => {
      let n = 0;
      for (const p of pts) {
        if (ends(pts, p)) continue;
        const cx = Math.floor(p[0] / 8), cy = Math.floor(p[1] / 8);
        let hit = false;
        for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) {
          const l = grid.get((cx + i) + ',' + (cy + j));
          if (l) for (const q of l) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 5) { hit = true; break; }
        }
        if (hit) n++;
      }
      return n;
    };
    function addGrid(pts) { for (const p of pts) { if (ends(pts, p)) continue; const k = cell(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); } }
    const SIDES = ['left', 'right', 'top', 'bottom'];
    const outside = (pts) => pts.some((p) => p[0] < -4 || p[1] < -4 || p[0] > W + 4 || p[1] > Hh + 4);
    // routePasses > 1 (solo para fijar rutas en desarrollo): vuelve a enrutar cada arista viendo todas las demás.
    const passes = spec.routePasses || 1;
    for (let pass = 0; pass < passes; pass++) for (const e of spec.edges || []) {
      if ((e.route || spec.edgeRoute) !== 'curve') continue;
      const a = rects[e.from], b = rects[e.to];
      if (!a || !b) continue;
      const key = edgeKey(e);
      if (pass > 0 && e.pin) continue;
      const pool = pass === 0 ? done : Object.keys(out).filter((k) => k !== key).map((k) => out[k]);
      if (pass > 0) { grid = new Map(); for (const d of pool) addGrid(d.pts); }
      const others = pool.filter((d) => d.from !== e.from && d.from !== e.to && d.to !== e.from && d.to !== e.to);
      const evalC = (segsC, extra, how) => {
        const pts = sampleCurve(segsC);
        const hits = curveHits(pts, e.from, e.to, obs);
        const nH = hits.filter((h) => h.kind === 'node').length, tH = hits.length - nH;
        const ov = overlap(pts);
        return { segs: segsC, pts, hits, ov, how, base: nH * 1000 + tH * 700 + ov * 40 + (outside(pts) ? 900 : 0) + polyLen(pts) + (extra || 0) };
      };
      const auto = autoCurveSides(a, b);
      const fs0 = e.fromSide || auto[0], ts0 = e.toSide || auto[1];
      let best;
      if (e.via && e.via.length) {
        const vias = e.via.map((v) => [v[0] * U, v[1] * U]);
        const fs = e.fromSide || sideToward(a, vias[0]), ts = e.toSide || sideToward(b, vias[vias.length - 1]);
        best = evalC(viaCurve(attach(a, fs, e.fromAt), attach(b, ts, e.toAt), fs, ts, vias), 0, null);
      } else {
        const first = evalC(directCurve(attach(a, fs0, e.fromAt), attach(b, ts0, e.toAt), fs0, ts0, e.bend || 0.4, e.off || 0), 0, null);
        first.cross = others.reduce((s, d) => s + polyCross(first.pts, d.pts), 0);
        if (e.pin || (!first.hits.length && !first.cross && !first.ov)) best = first;
        else {
          const cands = [first];
          const pick = () => {
            cands.sort((p, q) => p.base - q.base);
            const top = cands.filter((c) => c.base <= cands[0].base + 700).slice(0, 40);
            for (const c of top) if (c.cross == null) c.cross = others.reduce((s, d) => s + polyCross(c.pts, d.pts), 0);
            top.sort((p, q) => (p.base + p.cross * 220) - (q.base + q.cross * 220));
            return top[0];
          };
          const clean = (c) => c && !c.hits.length && !c.cross && !c.ov;
          // 1) variantes directas: lados, tensión y desvío lateral
          const fsL = e.fromSide ? [e.fromSide] : SIDES, tsL = e.toSide ? [e.toSide] : SIDES;
          for (const fs of fsL) for (const ts of tsL) {
            const A = attach(a, fs, e.fromAt), B = attach(b, ts, e.toAt);
            // penaliza salir/entrar de espaldas al otro extremo
            const back = ((B[0] - A[0]) * NORMAL[fs][0] + (B[1] - A[1]) * NORMAL[fs][1] < -8 ? 140 : 0) + ((A[0] - B[0]) * NORMAL[ts][0] + (A[1] - B[1]) * NORMAL[ts][1] < -8 ? 140 : 0);
            for (const bend of [0.4, 0.7]) for (const off of [0, -56, 56]) cands.push(evalC(directCurve(A, B, fs, ts, bend, off), back + Math.abs(off) * 0.6, { fromSide: fs, toSide: ts, bend, off }));
          }
          best = pick();
          if (!clean(best)) {
            // 2) uno o dos puntos de paso por los carriles libres
            const ca = [a.x + a.w / 2, a.y + a.h / 2], cb = [b.x + b.w / 2, b.y + b.h / 2];
            const x0 = Math.min(ca[0], cb[0]) - 24 * U, x1 = Math.max(ca[0], cb[0]) + 24 * U, y0 = Math.min(ca[1], cb[1]) - 12 * U, y1 = Math.max(ca[1], cb[1]) + 12 * U;
            const LX = lanes.x.filter((x) => x >= x0 && x <= x1), LY = lanes.y.filter((y) => y >= y0 && y <= y1);
            const viaC = (vias) => {
              const fs = e.fromSide || sideToward(a, vias[0]), ts = e.toSide || sideToward(b, vias[vias.length - 1]);
              cands.push(evalC(viaCurve(attach(a, fs, e.fromAt), attach(b, ts, e.toAt), fs, ts, vias), 60 * vias.length, { fromSide: fs, toSide: ts, via: vias.map((v) => [r1(v[0] / U), r1(v[1] / U)]) }));
            };
            for (const x of LX) for (const y of LY) viaC([[x, y]]);
            best = pick();
            if (!clean(best)) {
              const nearest = (arr, v, k) => arr.slice().sort((p, q) => Math.abs(p - v) - Math.abs(q - v)).slice(0, k);
              for (const y of LY) for (const xa of nearest(LX, ca[0], 3)) for (const xb of nearest(LX, cb[0], 3)) if (Math.abs(xa - xb) > U) viaC([[xa, y], [xb, y]]);
              for (const x of LX) for (const ya of nearest(LY, ca[1], 3)) for (const yb of nearest(LY, cb[1], 3)) if (Math.abs(ya - yb) > U) viaC([[x, ya], [x, yb]]);
              best = pick();
            }
          }
        }
      }
      out[key] = { from: e.from, to: e.to, segs: best.segs, pts: best.pts, hits: best.hits, how: best.how || null, cross: best.cross || 0, ov: best.ov || 0 };
      if (pass === 0) { done.push(out[key]); addGrid(best.pts); }
    }
    const res = { edges: out, obstacles: obs };
    if (mapCache) mapCache.set(spec, res);
    return res;
  }
  // Verificación pura (para el validador): curvas del mapa que pasan por detrás de un nodo que no unen
  // o por encima del título de una región. Vacío = OK.
  function mapCheck(spec) {
    const geo = geometry(spec);
    const through = [], overTitle = [];
    const obs = mapObstacles(spec, Object.assign({}, geo.groups, geo.nodes));
    for (const ge of geo.edges) {
      if (!ge.curve) continue;
      for (const h of curveHits(ge.pts, ge.from, ge.to, obs)) {
        if (h.kind === 'node') through.push(ge.key + ' pasa por detrás de ' + h.id);
        else overTitle.push(ge.key + ' cruza el título "' + h.label + '"');
      }
    }
    return { through, overTitle, ok: !through.length && !overTitle.length };
  }

  function geometry(spec) {
    const nodes = {}, groups = {}, rects = {};
    for (const g of spec.groups || []) { groups[g.id] = rectOf(g); rects[g.id] = groups[g.id]; }
    for (const n of spec.nodes || []) { nodes[n.id] = rectOf(n); rects[n.id] = nodes[n.id]; }
    const W = (spec.grid && spec.grid.w || 0) * U, Hh = (spec.grid && spec.grid.h || 0) * U;
    const routed = (spec.edges || []).some((e) => (e.route || spec.edgeRoute) === 'curve') ? routeMap(spec, rects, W, Hh) : null;
    const edges = [];
    for (const e of spec.edges || []) {
      if ((e.route || spec.edgeRoute) === 'curve') {
        const c = routed && routed.edges[edgeKey(e)];
        edges.push({ key: edgeKey(e), from: e.from, to: e.to, kind: e.kind || 'data', tensor: e.tensor || null, pts: c ? c.pts : [], curve: c ? c.segs : null, spec: e });
        continue;
      }
      const r = routeEdge(spec, e, rects);
      edges.push({ key: edgeKey(e), from: e.from, to: e.to, kind: e.kind || 'data', tensor: e.tensor || null,
        pts: r ? r.pts : [], fromSide: r && r.fromSide, toSide: r && r.toSide, spec: e });
    }
    return { nodes, groups, edges, width: (spec.grid && spec.grid.w || 0) * U, height: (spec.grid && spec.grid.h || 0) * U };
  }

  // ------------------------------------------------------------ fase 10 (revisión): la vista según la config y el ancho
  // cond = 'cfg.X' | 'metrics.X' (verdadero si no es 0 / vacío) o {key, eq | ne | lt | gt}: se evalúa en la corrida dibujada.
  function condOf(run, c) {
    if (c == null) return true;
    const o = typeof c === 'string' ? { key: c } : c;
    const parts = String(o.key || '').split('.'), ns = parts[0], rest = parts.slice(1).join('.');
    const v = !run ? undefined : ns === 'cfg' ? cfgPath(run.config, rest) : ns === 'metrics' ? cfgPath(metricsOf(run), rest) : ns === 'q' ? (run.quantities || {})[rest] : undefined;
    if ('eq' in o) return v === o.eq;
    if ('ne' in o) return v !== o.ne;
    if ('lt' in o) return v < o.lt;
    if ('gt' in o) return v > o.gt;
    return !!v;
  }
  // La spec que se dibuja (una copia solo si algo cambia; si no, la MISMA: las vistas anteriores no cambian):
  //  · node.when = [{if: cond, set: {…}}] (o uno solo): props del nodo que cambian con la config (la política de DPO con LoRA:
  //    base congelada + adaptador; la referencia, "fantasma": la misma base sin adaptadores). edge.when / note.when = cond: la
  //    arista o la nota solo existen si se cumple.
  //  · spec.mobileGrid + node.mobile = {x, y, w, h}: otra grilla cuando la figura mide < 640 px (las vistas de barras: rótulo,
  //    barra y total en líneas propias, legibles a 375 px).
  //  · node.bars: el alto del nodo crece hasta lo que ocupan sus filas (addCur agrega una; el título no queda tapado).
  function viewSpec(ctl, spec, run) {
    if (!spec || spec.kind === 'map') return spec;
    const nodes = spec.nodes || [];
    const narrow = !!(ctl.narrow && spec.mobileGrid);
    const hasWhen = nodes.some((n) => n.when) || (spec.edges || []).some((e) => e.when != null || e.whenSet) || (spec.notes || []).some((nt) => nt.when != null);
    const hasBars = nodes.some((n) => n.bars) && ctl.mode !== 'blank' && !ctl.quiz;
    if (!hasWhen && !narrow && !hasBars) return spec;
    const out = Object.assign({}, spec);
    if (narrow) out.grid = Object.assign({}, spec.mobileGrid);
    else out.grid = Object.assign({}, spec.grid);
    out.nodes = nodes.map((n) => {
      let m = n;
      if (narrow && n.mobile) m = Object.assign({}, m, n.mobile);
      if (n.when) for (const w of [].concat(n.when)) if (w && condOf(run, w.if)) m = Object.assign({}, m, w.set || {});
      return m;
    });
    if (spec.edges) out.edges = spec.edges.filter((e) => e.when == null || condOf(run, e.when)).map((e) => {
      // fase 11 (revisión): edge.whenSet = [{if: cond, set: {…}}] (o uno solo): props de la arista que cambian con la config
      // (IVF-PQ de mil millones: el HNSW sobre los centroides calcula ≈ 4k distancias, no n_list: la arista lleva esa cuenta)
      let m = e;
      if (e.whenSet) for (const w of [].concat(e.whenSet)) if (w && condOf(run, w.if)) m = Object.assign({}, m, w.set || {});
      return m;
    });
    // fase 11 (revisión): group.mobile = {x, y, w, h} en la grilla angosta (bi-encoder vs cross-encoder: carriles apilados)
    if (narrow && spec.groups && spec.groups.some((g) => g.mobile)) out.groups = spec.groups.map((g) => (g.mobile ? Object.assign({}, g, g.mobile) : g));
    if (spec.notes) out.notes = spec.notes.filter((nt) => nt.when == null || condOf(run, nt.when));
    if (hasBars) {
      const cur = (ctl.opts && ctl.opts.config) || spec.config;
      out.nodes = out.nodes.map((n) => {
        if (!n.bars) return n;
        const lay = barsLayout(n.bars, n.w * U, run, cur, ctl, out, narrow);
        if (!lay) return n;
        const need = Math.ceil((lay.H + 30) / U * 2) / 2;
        if (need <= n.h) return n;
        out.grid.h = Math.max(out.grid.h || 0, n.y + need + 1);
        return Object.assign({}, n, { h: need });
      });
    }
    return out;
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
  // Eje de canales/profundidad: log más empinado, para que 768 vs 3072 o 64 vs 197 se vean distintos
  // (64 → 10, 197 → 26, 768 → 46, 3072 → 66 px).
  const extD = (n) => clamp(10 * Math.log2(Math.max(2, n)) - 50, 6, 72);
  const DEPTH = [0.55, -0.42];                   // proyección isométrica de la profundidad
  // Matrices de atención (fase 3, hint.glyph:'amat'): log más empinado para que 950 vs 100 se vea ≈ 2×
  // (950 → 53, 400 → 43, 100 → 27, 7 → 6 px): la de cross-attention de DETR (100×950) se ve ancha y baja.
  const extM = (n) => clamp(8 * Math.log2(Math.max(2, n)) - 26, 6, 64);
  // Disposición del glifo (§7.3) + extensiones de la fase 2:
  //   'mat'     matriz cuadrada B×B (logits de CLIP): cara frontal cuadrada con la diagonal marcada
  //   'windows' nW×M²×C (ventanas de Swin como lote): pila de min(nW, 8) rebanadas M²×C
  //   'winheads' nW×h×M²×d_h: pila de min(h, 8) rebanadas M²×d_h (las nW ventanas, implícitas)
  //   'fmap'    (solo con hint.glyph:'fmap') H×W×C con la cara en escala LINEAL (hint.px px por token)
  //             y la rejilla de ventanas M×M (hint.win) dibujada encima: la jerarquía de Swin a la vista
  // fase 3 (DETR):
  //   'mat'     también rectangular (filas × columnas, p. ej. el costo Q×G); hint.diag:false = sin diagonal
  //   'amat'    (solo con hint.glyph:'amat') h×N×M: un mazo de min(h, 8) matrices planas N×M (filas = queries,
  //             columnas = keys), con hint.axes = {rows, cols}: 8×950×950 cuadrada, 8×100×950 ancha y baja
  // hint = la entrada de spec.tensors (o refTensors): {glyph, px, win}.
  function layoutOf(t, hint) {
    const num = (t && t.num) || [], sym = (t && t.sym) || [];
    if (hint && hint.glyph === 'matrix') return 'mat';
    if (hint && hint.glyph === 'amat' && num.length === 3) return 'amat';
    if (hint && hint.glyph === 'fmap' && num.length === 3) return 'fmap';
    const lay = t && t.layout;
    if (lay === 'mat' || lay === 'windows' || lay === 'winheads') return lay;
    if (num.length === 4) return 'winheads';
    if (num.length === 2 && num[0] === num[1] && sym[0] && sym[0] === sym[1] && lay !== 'seq') return 'mat';
    if (num.length === 3 && /^n_?W/.test(String(sym[0] || ''))) return lay === 'heads' ? 'heads' : 'windows';
    return lay || (num.length === 3 ? 'grid' : num.length === 1 ? 'vec' : 'seq');
  }
  function glyphDims(t, hint) {
    const num = (t && t.num) || [];
    const lay = layoutOf(t, hint);
    // un vector de D = una rebanada de token del glifo N×D (la D va en el mismo eje de profundidad)
    if (lay === 'vec') return { lay, w: 6, h: 6, d: extD(num[0] || 2) };
    if (lay === 'fmap') { const px = (hint && hint.pxEff) || (hint && hint.px) || 2; return { lay, w: Math.max(6, (num[1] || 2) * px), h: Math.max(6, (num[0] || 2) * px), d: extD(num[2] || 2), win: hint && hint.win, gridH: num[0], gridW: num[1] }; }
    if (lay === 'grid') return { lay, w: ext(num[1] || 2), h: ext(num[0] || 2), d: extD(num[2] || 2) };
    if (lay === 'mat') return { lay, w: ext(num[1] || num[0] || 2), h: ext(num[0] || 2), d: 4 };
    if (lay === 'amat') return { lay, w: extM(num[2] || 2), h: extM(num[1] || 2), d: 0, n: Math.min(num[0] || 1, 8), heads: num[0] };
    if (lay === 'windows') return { lay: 'heads', w: ext(num[1] || 2), h: 4, d: extD(num[2] || 2), n: Math.min(num[0] || 1, 8), heads: num[0] };
    if (lay === 'winheads') return { lay: 'heads', w: ext(num[2] || 2), h: 4, d: extD(num[3] || 2), n: Math.min(num[1] || 1, 8), heads: num[1] };
    if (lay === 'heads') return { lay, w: ext(num[1] || 2), h: 4, d: extD(num[2] || 2), n: Math.min(num[0] || 1, 8), heads: num[0] };
    return { lay: 'seq', w: ext(num[0] || 2), h: 6, d: extD(num[1] || 2) };
  }
  function glyphSize(t, hint) {
    const g = glyphDims(t, hint);
    const dx = g.d * DEPTH[0], dy = -g.d * DEPTH[1];
    if (g.lay === 'amat') return { w: g.w + (g.n - 1) * 3, h: g.h + (g.n - 1) * 3 };
    const stack = g.lay === 'heads' ? (g.n - 1) * 4 : 0;
    return { w: g.w + dx, h: g.h + dy + stack };
  }

  // ============================================================ acceso al calculador
  function arch() { return ATLAS.Arch || null; }
  function runFor(configId) {
    const A = arch();
    if (!A || typeof A.run !== 'function') throw new Error('El calculador (ATLAS.Arch) no está cargado.');
    return A.run(configId);
  }
  // fase 6: edge.ov / node.ov = knobs del calculador SOLO para esa arista o ese nodo (p. ej. {decode: 1}: el carril de
  // decode de la inferencia LLM, con formas de 1 token, dentro de un diagrama cuya config es el prefill). Mismo id de config.
  function ovRun(run, ov) {
    if (!ov || !run) return run;
    const A = arch();
    try { return A.run(run.id, Object.assign({}, run.overrides || {}, ov)); } catch (e) { return run; }
  }
  // fase 11: edge.config = la forma de esa arista sale de OTRA config del mismo modelo (ann-overview: la columna de HNSW con
  // hnsw-1m-768 y la de IVF-PQ con ivfpq-1m-768 en la misma figura); con edge.ov encima. La arista lleva data-config.
  function cfgRun(cfg, ov) { let r = null; try { r = runFor(cfg); } catch (e) { return null; } return ov ? ovRun(r, ov) : r; }
  const edgeRun = (run, e) => (e && e.config ? (cfgRun(e.config, e.ov) || run) : e && e.ov ? ovRun(run, e.ov) : run);
  function configLabel(id) {
    const A = arch();
    try { const c = A && A.configs ? A.configs().find((x) => x.id === id) : null; return c ? c.label : id; } catch (e) { return id; }
  }
  function shapeText(t, mode) {
    const A = arch();
    if (A && A.fmt && typeof A.fmt.shape === 'function') return A.fmt.shape(t, mode);
    const a = mode === 'sym' ? t.sym : t.num;
    return (a || []).join('×');
  }
  // "sym = num" para leer en voz alta / en texto; si no hay símbolos (p. ej. 1 token), solo el número
  function shapeSay(t) { const a = plainSub(shapeText(t, 'sym')), b = shapeText(t, 'num'); return a === b ? b : a + ' = ' + b; }
  function shapeTexOf(t) {
    const A = arch();
    if (A && A.fmt && typeof A.fmt.shapeTex === 'function') return A.fmt.shapeTex(t);
    return (t.sym || []).map((x) => (/[+\-]/.test(x) ? '(' + x + ')' : x)).join('\\times ');
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

  // sub de un nodo: con "Números" activado y subNum definido, la versión con números del calculador
  // (p. ej. 'conv {{cfg.P}}×{{cfg.P}}' → 'conv 16×16'); si no, la simbólica.
  function nodeSub(n, ctl, spec) {
    // fase 7 (revisión): subWhen = {claveDeConfig: sub}: otro sub si esa clave de la config es verdadera (el LM head
    // atado al embedding en Qwen2-VL 2B, que si no parecía sin parámetros)
    if (n.subWhen) {
      const cid = (ctl && ctl.opts && ctl.opts.config) || (spec && spec.config) || (ctl && ctl.view && ctl.view.spec && ctl.view.spec.config);
      let c = null;
      try { c = cid ? runFor(cid).config : null; } catch (e) { c = null; }
      for (const k in n.subWhen) if (c && c[k]) return n.subWhen[k];
    }
    // fase 11: node.blankSub = el sub en la práctica cuando el visible delata un hueco ("Linear D → 2" junto al hueco de la forma
    // de los logits de NSP)
    if (ctl && ctl.mode === 'blank' && n.blankSub != null && !slotFor(ctl, n.id)) return n.blankSub;
    if (n.subNum && ctl && ctl.showNumbers && ctl.mode !== 'blank') {
      const cfg = (ctl.opts && ctl.opts.config) || (spec && spec.config) || (ctl.view && ctl.view.spec && ctl.view.spec.config);
      const v = String(n.subNum).split('\n').map((ln) => strip(qResolve(ln, cfg))).join('\n');
      if (v && v.indexOf('{{') < 0 && v.indexOf('¿') < 0) return v;
    }
    return n.sub || '';
  }

  // node.costOf = id de path del calculador que el nodo representa (p. ej. el bloque dentro del grupo
  // stage1 cuesta lo de path 'stage1'): ops y byNode se toman de ese id en vez del id del nodo.
  // node.scope = id de path que además debe aparecer (p. ej. 'img-encoder' o 'txt-encoder' en CLIP, donde
  // las dos torres comparten ids de nodo: enc-layer, ln1, qkv…). node.opsExact = solo las ops de node.ops.
  // node.costExclude = ids de path que NO cuentan (fase 5: el encoder de SAM sin su neck, que es otro nodo; la
  // memory attention de SAM 2 sin la entrada/salida ×1, para que la insignia sea "por capa").
  // node.costRef = {config, nodes:[…]}: el costo sale de OTRA config (fase 4: el encoder de texto de CLIP que
  // YOLO-World corre offline; en su propio grafo vale 0). node.costNote = aclaración en el tooltip y el panel.
  function nodeOps(run, node) {
    if (node && node.costRef) {
      let r2 = null;
      try { r2 = runFor(node.costRef.config); } catch (e) { r2 = null; }
      return r2 ? r2.ops.filter((o) => o.path && (node.costRef.nodes || []).some((id) => o.path.indexOf(id) >= 0)) : [];
    }
    if (!run) return [];
    const ids = node.ops || [];
    const pid = node.costOf || node.id;
    const ex = node.costExclude || [];
    return run.ops.filter((o) => ids.indexOf(o.id) >= 0 || (!node.opsExact && o.path && o.path.indexOf(pid) >= 0 && (!node.scope || o.path.indexOf(node.scope) >= 0) && !ex.some((x) => o.path.indexOf(x) >= 0)));
  }
  function nodeCost(run, node) {
    if (node && node.ov) run = ovRun(run, node.ov);
    const ops = nodeOps(run, node);
    let params = 0, macs = 0, rep = 1;
    for (const o of ops) { params += o.params || 0; macs += o.macs || 0; rep = Math.max(rep, o.repeat || 1); }
    // nodo compuesto con ops de distinta repetición (p. ej. una torre entera de CLIP: embeddings ×1 + capas ×L):
    // "por capa" no tiene sentido; se muestra el total (Σ op × repeat)
    // fase 7: pesos compartidos entre ejecuciones (LLaVA con varias imágenes: op.paramRepeat < op.repeat) → también total
    const pRep = (o) => (o.paramRepeat != null ? o.paramRepeat : o.repeat || 1);
    if (ops.some((o) => (o.repeat || 1) !== rep || pRep(o) !== (o.repeat || 1))) {
      params = ops.reduce((a, o) => a + (o.params || 0) * pRep(o), 0);
      macs = ops.reduce((a, o) => a + (o.macs || 0) * (o.repeat || 1), 0);
      rep = 1;
    }
    // fase 9: node.perPass = costo de UNA pasada cuando el bloque corre más veces que sus pesos (π0: el experto, 18 capas × 10
    // pasos de flujo, op.repeat 180 y op.paramRepeat 18 → "por capa"; las proyecciones del sufijo, × 10 pasos con paramRepeat 1):
    // parámetros y MACs de una capa (o del bloque) en una pasada; las veces que corre van en costNote / runs
    if (node && node.perPass && ops.length) {
      const r0 = ops[0].repeat || 1, p0 = pRep(ops[0]);
      if (r0 > p0 && ops.every((o) => (o.repeat || 1) === r0 && pRep(o) === p0)) {
        params = ops.reduce((a, o) => a + (o.params || 0), 0);
        macs = ops.reduce((a, o) => a + (o.macs || 0), 0);
        rep = p0;
      }
    }
    const by = !node.costRef && run && run.totals && run.totals.byNode && run.totals.byNode[node.costOf || node.id];
    return { ops, params, macs, rep, total: (!node.opsExact && !node.scope && !node.costExclude && by) || { params: ops.reduce((a, o) => a + (o.params || 0) * pRep(o), 0), macs: ops.reduce((a, o) => a + (o.macs || 0) * (o.repeat || 1), 0) } };
  }

  // Unidad de un nodo repetido: node.badgeUnit ('por par' en los stages de Swin) o 'por capa'; con el plural
  // de la repetición ("× 3 pares"). La usan la insignia, el tooltip, el panel y el texto alternativo.
  const REP_WORD = { 'por capa': 'capas', 'por par': 'pares', 'por bloque': 'bloques' };
  function unitOf(n) { return (n && n.badgeUnit) || 'por capa'; }
  function repTimes(n, rep) { const w = REP_WORD[unitOf(n)]; return '× ' + rep + (w ? ' ' + w : ''); }
  // Ops que el calculador cuenta "por par" dentro de un lote (la matriz B×B de CLIP: detail.perPair):
  // sus MACs son una fila de la matriz; detail.batchMacs = la matmul de todo el lote.
  function perPairOf(ops) { const o = (ops || []).find((x) => x.detail && x.detail.perPair); return o ? o.detail : null; }
  // fase 11 (revisión): torre siamesa (Sentence-BERT, ColBERT): sus ops tienen parámetros con op.paramRepeat 0 (ya contados en la
  // otra torre). El tooltip y el panel lo dicen en vez de "Sin parámetros" / "Total: 0". Devuelve el rótulo de la otra torre
  // (la arista tie) o '' si no hay arista.
  function sharedTower(spec, n, c) {
    if (c.params || !c.ops.some((o) => o.params > 0 && o.paramRepeat === 0)) return null;
    const e = (spec.edges || []).find((x) => x.tie && (x.from === n.id || x.to === n.id));
    const other = e && (spec.nodes || []).find((x) => x.id === (e.from === n.id ? e.to : e.from));
    return other ? String(other.label || other.id).replace(/\n/g, ' ') : '';
  }
  // fase 11 (revisión): node.repK = clave del calculador con las veces que corre el bloque con los MISMOS pesos (los k pares del
  // cross-encoder: 'cfg.k'); el tooltip y el panel muestran "por par × k = …" (las formas de las aristas son de un par)
  function repKOf(run, n) { const K = n && n.repK ? numKey(run, n.repK) : 0; return K > 1 ? K : 0; }

  // Valor de config por ruta: 'h', 'heads.0' o 'heads[0]' (cabezas por etapa en Swin).
  function cfgPath(cfg, key) {
    if (!cfg || key == null) return undefined;
    let v = cfg;
    for (const k of String(key).replace(/\[(\d+)\]/g, '.$1').split('.')) { if (v == null) return undefined; v = v[k]; }
    return v;
  }
  // Texto corto del spec (etiquetas de grupo, notas de glifo) con {{…}} del calculador, sin HTML.
  function qText(s, ctl, spec, cfg) {
    if (!s || String(s).indexOf('{{') < 0) return s;
    return strip(qResolve(s, cfg || (ctl && ctl.opts && ctl.opts.config) || (spec && spec.config)));
  }

  // Valor de un grupo repetido: config[from] (o config[from][index] si es una lista, p. ej. depths de
  // Swin), dividido por div (pares de bloques W-MSA + SW-MSA: depth / 2). raw = sin dividir.
  // rep.len:true = el largo de la lista (p. ej. strides [8, 16, 32] → × 3 niveles).
  function repeatValue(cfg, rep, raw) {
    let v = cfg ? cfgPath(cfg, rep.from || rep.sym) : undefined;
    if (Array.isArray(v)) v = rep.len ? v.length : v[rep.index || 0];
    if (!raw && rep.div && Number.isFinite(v)) v = v / rep.div;
    return v;
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
    setRich(t, s);
    return t;
  }
  // Subíndices estilo TeX en las etiquetas del SVG: "z_{ℓ−1}", "W_O", "d_h" → tspan rebajado
  // (sin guion bajo visible). textContent queda en forma plana: "zℓ−1", "WO", "dh" (ver plainSub).
  // fase 8 (revisión): una letra con sombrero o tilde combinantes (ε̂, ε̃, v̂: U+0302 / U+0303) va en la fuente mono, donde
  // la marca se compone sobre la letra; en IBM Plex Sans (Condensed) queda corrida a la derecha y se lee "ε ̂".
  const COMB_RE = /([^\s<>&])([\u0302\u0303])/g;
  function setRich(t, s) {
    s = String(s == null ? '' : s);
    t.textContent = '';
    const hasComb = /[\u0302\u0303]/.test(s);
    if (s.indexOf('_') < 0 && !hasComb) { t.textContent = s; return; }
    let last = 0, m, down = false;
    SUB_RE.lastIndex = 0;
    const put = (str, dy, cls) => {
      if (!hasComb) { const ts = S('tspan', { dy: dy || null, class: cls || null }, t); ts.textContent = str; return; }
      // trozos: texto normal / letra + marca (tspan .ad-comb); el dy va solo en el primero
      const parts = String(str).split(/([^\s<>&][\u0302\u0303])/).filter((x) => x !== '');
      parts.forEach((pt, i) => { const ts = S('tspan', { dy: i === 0 ? dy || null : null, class: [cls, /[\u0302\u0303]/.test(pt) ? 'ad-comb' : null].filter(Boolean).join(' ') || null }, t); ts.textContent = pt; });
    };
    if (s.indexOf('_') < 0) { put(s); return; }
    while ((m = SUB_RE.exec(s))) {
      if (m.index > last) { put(s.slice(last, m.index), down ? '-0.25em' : null); down = false; }
      put(subOf(m[1]), down ? null : '0.25em', 'ad-subscript');
      down = true;
      last = m.index + m[0].length;
    }
    if (last < s.length) put(s.slice(last), down ? '-0.25em' : null);
  }
  const SUB_RE = /_(\{[^}]*\}|[A-Za-z0-9ℓ\u0370-\u03FF]+)/g;
  const subOf = (g) => (g[0] === '{' ? g.slice(1, -1) : g);
  function plainSub(s) { return String(s == null ? '' : s).replace(SUB_RE, (m, g) => subOf(g)); }
  // Caption (html): los subíndices del spec (d_h, L_e, q_pos) como <sub>, como en las etiquetas del SVG;
  // no toca las etiquetas html ni el texto dentro de <code> (p. ej. <code>ln_pre</code>).
  const CAP_SUB_RE = /(^|[^A-Za-z0-9_])([A-Za-z\u0370-\u03FF])_(\{[^}]*\}|[A-Za-z0-9ℓ\u0370-\u03FF]+)/g;
  function captionHtml(html) {
    let code = 0;
    return combSafe(String(html).split(/(<[^>]+>)/).map((part) => {
      if (part[0] === '<') { if (/^<code\b/i.test(part)) code++; else if (/^<\/code>/i.test(part)) code = Math.max(0, code - 1); return part; }
      // solo símbolos de una letra (d_h, L_e, W_O, q_pos); identificadores como ln_post quedan tal cual
      return code ? part : part.replace(CAP_SUB_RE, (m, pre, base, g) => pre + base + '<sub>' + subOf(g) + '</sub>');
    }).join(''));
  }
  // html: letra + marca combinante → <span class="ad-comb"> (fuente mono; ver COMB_RE). No toca las etiquetas html.
  function combSafe(html) {
    const s = String(html == null ? '' : html);
    if (!/[\u0302\u0303]/.test(s)) return s;
    return s.split(/(<[^>]+>)/).map((part) => (part[0] === '<' ? part : part.replace(COMB_RE, '<span class="ad-comb">$1$2</span>'))).join('');
  }
  function htmlSub(s) { return esc(s).replace(SUB_RE, (m, g) => '<sub>' + subOf(g) + '</sub>'); }
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
  function textW(s, px, mono) { return plainSub(s).length * px * (mono ? 0.6 : 0.56); }

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
    pat('joint', () => {});   // tensores conjuntos (matriz B×B de CLIP): color de fusión, sin textura
    // fase 7: rayado diagonal de un bloque congelado (node.train:'frozen')
    const fzp = S('pattern', { id: id + '-tx-frozen', patternUnits: 'userSpaceOnUse', width: 7, height: 7, patternTransform: 'rotate(45)' }, d);
    S('path', { d: 'M0 0V7', class: 'ad-frozen-ln' }, fzp);
    return d;
  }

  // ------------------------------------------------------------ glifo isométrico
  // (x, y) = esquina inferior izquierda de la cara frontal.
  function drawGlyph(parent, t, x, y, id, mark, hint) {
    const g = glyphDims(t, hint);
    const mod = (hint && hint.mod) || (t && t.mod) || (g.lay === 'mat' ? 'joint' : 'img');
    // las matrices de atención ('amat') con filas = queries van rellenas (el contorno punteado se perdía en el mazo)
    const grp = S('g', { class: 'ad-glyph ad-mod--' + mod + (mod === 'qry' && g.lay !== 'amat' ? ' ad-glyph--outline' : '') }, parent);
    const fill = 'url(#' + id + '-tx-' + mod + ')';
    const box = (bx, by, w, h, d) => {
      const dx = d * DEPTH[0], dy = d * DEPTH[1];
      // cara superior y lateral, luego frontal
      S('path', { d: 'M' + P([bx, by - h]) + 'L' + P([bx + dx, by - h + dy]) + 'L' + P([bx + w + dx, by - h + dy]) + 'L' + P([bx + w, by - h]) + 'Z', class: 'ad-face ad-face--top', fill }, grp);
      S('path', { d: 'M' + P([bx + w, by]) + 'L' + P([bx + w, by - h]) + 'L' + P([bx + w + dx, by - h + dy]) + 'L' + P([bx + w + dx, by + dy]) + 'Z', class: 'ad-face ad-face--side', fill }, grp);
      S('rect', { x: r1(bx), y: r1(by - h), width: r1(w), height: r1(h), class: 'ad-face ad-face--front', fill }, grp);
    };
    if (g.lay === 'heads') {
      for (let i = g.n - 1; i >= 0; i--) box(x, y - i * 4, g.w, g.h, g.d);
    } else if (g.lay === 'amat') {
      // mazo de h matrices planas (una por cabeza), la de delante abajo a la izquierda
      for (let i = g.n - 1; i >= 1; i--) S('rect', { x: r1(x + i * 3), y: r1(y - g.h - i * 3), width: r1(g.w), height: r1(g.h), class: 'ad-face ad-face--deck', fill }, grp);
      S('rect', { x: r1(x), y: r1(y - g.h), width: r1(g.w), height: r1(g.h), class: 'ad-face ad-face--front', fill }, grp);
    } else box(x, y, g.w, g.h, g.d);
    if (g.lay === 'seq' && t && t.num && t.num[0] > 1) {
      // marcas de tokens sobre la cara frontal (hasta 12)
      const k = Math.min(t.num[0], 12), step = g.w / k;
      let d = '';
      for (let i = 1; i < k; i++) d += 'M' + P([x + i * step, y]) + 'V' + r1(y - g.h);
      S('path', { d, class: 'ad-tokmarks' }, grp);
      if (mark === 'first') S('rect', { x: r1(x), y: r1(y - g.h), width: r1(step), height: r1(g.h), class: 'ad-tokfirst' }, grp);
      // fase 7: mark:'dropfirst' = el primer token (CLS) tachado: se descarta
      // (revisión: pegado al glifo, al menos 7 px de ancho, con la etiqueta "CLS" encima; la leyenda lo explica)
      if (mark === 'dropfirst') {
        const dw = Math.max(step, 8), dh = Math.max(g.h, 9), fx = x - dw - 1;
        S('rect', { x: r1(fx), y: r1(y - dh), width: r1(dw), height: r1(dh), class: 'ad-tokdrop' }, grp);
        S('path', { d: 'M' + P([fx + 1.5, y - dh + 1.5]) + 'L' + P([fx + dw - 1.5, y - 1.5]) + 'M' + P([fx + dw - 1.5, y - dh + 1.5]) + 'L' + P([fx + 1.5, y - 1.5]), class: 'ad-tokdrop-x' }, grp);
        const ct = S('text', { x: r1(fx + dw / 2), y: r1(y - dh - 3), 'text-anchor': 'middle', class: 'ad-tokdrop-lab' }, grp);
        ct.textContent = 'CLS';
      }
    }
    if (g.lay === 'mat' || g.lay === 'amat') {
      // matriz: rejilla tenue (hasta 8×8) y, en la cuadrada de CLIP, la diagonal (los pares positivos)
      const nr = g.lay === 'amat' ? (t.num && t.num[1]) : (t.num && t.num[0]), nc = g.lay === 'amat' ? (t.num && t.num[2]) : (t.num && (t.num[1] || t.num[0]));
      const kr = Math.min(nr || 2, 8), kc = Math.min(nc || 2, 8);
      let d = '';
      for (let i = 1; i < kc; i++) d += 'M' + P([x + i * g.w / kc, y]) + 'V' + r1(y - g.h);
      for (let i = 1; i < kr; i++) d += 'M' + P([x, y - i * g.h / kr]) + 'H' + r1(x + g.w);
      if (d) S('path', { d, class: 'ad-tokmarks' }, grp);
      if (g.lay === 'mat' && !(hint && hint.diag === false)) S('path', { d: 'M' + P([x, y - g.h]) + 'L' + P([x + g.w, y]), class: 'ad-matdiag' }, grp);
      // hint.axes = {rows:'img', cols:'txt'}: franja de la modalidad de las filas a la izquierda y de las
      // columnas arriba (con su textura), para leer qué eje es qué sin el texto
      const ax = hint && hint.axes;
      if (ax) {
        if (ax.rows) S('rect', { x: r1(x - 7), y: r1(y - g.h), width: 5, height: r1(g.h), class: 'ad-axis ad-mod--' + ax.rows, fill: 'url(#' + id + '-tx-' + ax.rows + ')' }, parent);
        // en el mazo 'amat' las columnas van debajo (arriba están las cartas de las otras cabezas)
        if (ax.cols) S('rect', { x: r1(x), y: r1(g.lay === 'amat' ? y + 2 : y - g.h - 7), width: r1(g.w), height: 5, class: 'ad-axis ad-mod--' + ax.cols, fill: 'url(#' + id + '-tx-' + ax.cols + ')' }, parent);
      }
    }
    if (g.lay === 'fmap' && g.win && g.gridW > g.win) {
      // rejilla de ventanas M×M sobre la cara frontal (8×8 ventanas en la etapa 1 de Swin-T, 1 en la 4)
      const nx = g.gridW / g.win, ny = g.gridH / g.win;
      let d = '';
      for (let i = 1; i < nx; i++) d += 'M' + P([x + i * g.w / nx, y]) + 'V' + r1(y - g.h);
      for (let i = 1; i < ny; i++) d += 'M' + P([x, y - i * g.h / ny]) + 'H' + r1(x + g.w);
      S('path', { d, class: 'ad-winmarks' }, grp);
    }
    return grp;
  }

  const isJoint = (grp) => /\bad-mod--joint\b/.test(grp.getAttribute('class') || '');

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
    // fase 2 (Swin, CLIP): ventanas, roll cíclico, máscara, fusión 2×2, normalizar a la esfera
    else if (shape === 'window' || shape === 'merge') {
      // 'window' = rejilla partida en 2×2 ventanas; 'merge' = 2×2 vecinos → 1 (cuadro interior)
      d = 'M' + P([cx - k, cy - k]) + 'H' + r1(cx + k) + 'V' + r1(cy + k) + 'H' + r1(cx - k) + 'Z' + 'M' + P([cx, cy - k]) + 'V' + r1(cy + k) + 'M' + P([cx - k, cy]) + 'H' + r1(cx + k);
      if (shape === 'merge') d += 'M' + P([cx + k * 1.25, cy]) + 'h' + r1(k * 0.5);
    } else if (shape === 'roll') {
      // flecha circular (desplazamiento cíclico)
      const rr = k * 0.95;
      d = 'M' + P([cx + rr, cy]) + 'A' + r1(rr) + ',' + r1(rr) + ' 0 1,1 ' + P([cx, cy - rr]) + 'M' + P([cx, cy - rr]) + 'l' + r1(k * 0.55) + ',' + r1(-k * 0.35) + 'M' + P([cx, cy - rr]) + 'l' + r1(k * 0.45) + ',' + r1(k * 0.45);
    } else if (shape === 'mask') {
      // matriz con el triángulo superior tachado (máscara causal / de regiones)
      d = 'M' + P([cx - k, cy - k]) + 'H' + r1(cx + k) + 'V' + r1(cy + k) + 'H' + r1(cx - k) + 'Z' + 'M' + P([cx - k, cy - k]) + 'L' + P([cx + k, cy + k]) + 'M' + P([cx, cy - k]) + 'L' + P([cx + k, cy]) + 'M' + P([cx - k * 0.5, cy - k]) + 'L' + P([cx + k, cy + k * 0.5]) + 'M' + P([cx + k * 0.5, cy - k]) + 'L' + P([cx + k, cy - k * 0.5]);
    } else if (shape === 'sphere') {
      // ‖x‖ = 1: círculo con un radio
      d = 'M' + P([cx + k, cy]) + 'A' + r1(k) + ',' + r1(k) + ' 0 1,1 ' + P([cx - k, cy]) + 'A' + r1(k) + ',' + r1(k) + ' 0 1,1 ' + P([cx + k, cy]) + 'M' + P([cx, cy]) + 'L' + P([cx + k * 0.7, cy - k * 0.7]);
    } else if (shape === 'pick') {
      // elegir un token: secuencia con una celda marcada
      d = 'M' + P([cx - k, cy - k * 0.45]) + 'H' + r1(cx + k) + 'V' + r1(cy + k * 0.45) + 'H' + r1(cx - k) + 'Z' + 'M' + P([cx - k * 0.33, cy - k * 0.45]) + 'V' + r1(cy + k * 0.45) + 'M' + P([cx + k * 0.33, cy - k * 0.45]) + 'V' + r1(cy + k * 0.45) + 'M' + P([cx + k * 0.66, cy - k * 1.0]) + 'V' + r1(cy - k * 0.6);
    }
    S('path', { d, class: 'ad-sym' }, parent);
  }

  // 2×2 celdas (c = 6 px) → flecha → barra de 4 celdas; devuelve el ancho. Las celdas llevan 4 tonos (ad-c2-0…3).
  function drawConcat2x2(parent, x, cy) {
    const c = 6, gp = 1, g = S('g', { class: 'ad-c2x2' }, parent);
    const blk = 2 * c + gp, y0 = cy - blk / 2;
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([i, j], k) => S('rect', { x: r1(x + i * (c + gp)), y: r1(y0 + j * (c + gp)), width: c, height: c, class: 'ad-c2-' + k }, g));
    const ax = x + blk + 3;
    S('path', { d: 'M' + P([ax, cy]) + 'h7M' + P([ax + 4.5, cy - 2.5]) + 'l2.5,2.5l-2.5,2.5', class: 'ad-sym' }, g);
    const bx = ax + 11;
    for (let k = 0; k < 4; k++) S('rect', { x: r1(bx + k * c), y: r1(cy - c / 2), width: c, height: c, class: 'ad-c2-' + k }, g);
    return bx + 4 * c - x;
  }

  // ============================================================ dibujo de una vista
  function buildView(ctl, spec) {
    const run = ctl.runFor(spec);
    spec = viewSpec(ctl, spec, run);
    ctl.building = spec;
    ctl.blankHide = blankGiveaways(ctl, spec, run);
    const id = ctl.id;
    const geo = geometry(spec);
    const svg = S('svg', { class: 'ad-svg', 'data-kind': spec.kind || 'arch', xmlns: SVGNS, role: 'group', 'aria-label': spec.title || spec.id, preserveAspectRatio: 'xMidYMid meet' });
    defs(svg, id);
    const W = geo.width, Hh = geo.height;
    S('rect', { x: -400, y: -400, width: W + 800, height: Hh + 800, class: 'ad-bg' }, svg);
    S('path', { d: blueprint(W, Hh), class: 'ad-grid' }, svg);
    const scene = S('g', { class: 'ad-scene' }, svg);
    const L = { groups: S('g', { class: 'ad-l-groups' }, scene), edges: S('g', { class: 'ad-l-edges' }, scene), nodes: S('g', { class: 'ad-l-nodes' }, scene), labels: S('g', { class: 'ad-l-labels' }, scene) };
    const used = { ops: new Set(), mods: new Set(), edges: new Set(), repeat: false, heads: false, badge: false, glyph: false, map: new Set() };
    const isMap = spec.kind === 'map';

    // ---- grupos
    // práctica: un grupo cuyos bloques son todos huecos de nombre no muestra su título ("Feature enhancer"
    // alrededor del hueco de la capa del enhancer sería la respuesta)
    const slotOnlyGroup = (r) => {
      if (ctl.mode !== 'blank' || !r) return false;
      const inside = (spec.nodes || []).filter((n) => {
        const nr = geo.nodes[n.id];
        if (!nr || n.op === 'io') return false;
        const cx = nr.x + nr.w / 2, cy = nr.y + nr.h / 2;
        return cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h;
      });
      return inside.length > 0 && inside.every((n) => { const s = slotFor(ctl, n.id); return s && s.ask === 'label'; });
    };
    for (const g of spec.groups || []) {
      const r = geo.groups[g.id];
      // group.hideInBlank: título que nombra un bloque que la práctica pregunta ("Memoria entre frames" junto al banco)
      const hideTitle = slotOnlyGroup(r) || (ctl.mode === 'blank' && !!g.hideInBlank);
      // style:'batch' = marco discontinuo de la parte "con lote" (CLIP: donde las formas pasan a llevar B)
      if (g.style === 'batch') used.batch = true;
      // style:'train' = carril de "solo entrenamiento" (DETR: matching húngaro y pérdida), marco discontinuo gris
      if (g.style === 'train') used.train = true;
      // style:'offline' = carril "offline" (YOLO-World: el vocabulario se codifica una vez, antes de la inferencia)
      if (g.style === 'offline') used.offline = true;
      // fase 5: style:'lane' = carril de "cuándo corre" (SAM: una vez por imagen / por prompt; SAM 2: por frame),
      // con tone (warn|accent|head|fuse|muted: tokens del tema) y legend = el texto de su entrada en la leyenda.
      // fase 11 (revisión): group.config = el carril de esa config; si es la dibujada, marco continuo y más grueso (is-curcfg)
      const lane = g.style === 'lane';
      if (lane) (used.lanes = used.lanes || new Map()).set(g.legend || g.label || g.id, g.tone || 'muted');
      const gg = S('g', { class: 'ad-group' + (g.region ? ' ad-region' : '') + (g.repeat ? ' ad-group--repeat' : '') + (g.style === 'batch' ? ' ad-group--batch' : '') + (g.style === 'train' ? ' ad-group--train' : '') + (g.style === 'offline' ? ' ad-group--offline' : '') + (lane ? ' ad-group--lane ad-tone--' + (g.tone || 'muted') : '') + (lane && g.config && g.config === ((ctl.opts && ctl.opts.config) || spec.config) ? ' is-curcfg' : ''), 'data-group': g.id }, L.groups);
      if (g.repeat) {
        used.repeat = true;
        S('rect', { x: r.x + 10, y: r.y + 10, width: r.w, height: r.h, rx: 6, class: 'ad-stack' }, gg);
        S('rect', { x: r.x + 5, y: r.y + 5, width: r.w, height: r.h, rx: 6, class: 'ad-stack' }, gg);
      }
      if (g.heads) {
        used.heads = true;
        const hv = (run && cfgPath(run.config, g.heads)) || 0;
        const n = Math.min(Math.max(hv, 1), 8);
        for (let i = n - 1; i >= 1; i--) S('rect', { x: r.x + i * 3, y: r.y - i * 3, width: r.w, height: r.h, rx: 6, class: 'ad-deck' }, gg);
        txt(gg, r.x + r.w + (n - 1) * 3 - 4, r.y - (n - 1) * 3 - 6, (g.headsSym || g.heads) + ' = ' + hv, 'ad-group-tag', 'end');
      }
      S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 6, class: 'ad-frame' }, gg);
      if (g.modality) { used.mods.add(g.modality); S('rect', { x: r.x, y: r.y + 6, width: 4, height: r.h - 12, class: 'ad-stripe ad-mod--' + g.modality }, gg); }
      if (g.label && !hideTitle) {
        const right = /right$/.test(g.labelPos || '');
        // títulos de región: encima de las aristas (capa de etiquetas) y con halo
        // fase 6: abajo y con label2 (carril de decode de la inferencia LLM), el título sube una línea y label2 va debajo
        const bottomL = (g.labelPos || '').indexOf('bottom') === 0, sub2 = bottomL && g.label2 && !(lane && (ctl.mode === 'blank' || ctl.quiz));
        // fase 7 (revisión): labelDx (u) corre el título a la derecha (el de un carril, encima de los bloques que enfoca
        // la vista del teléfono)
        const ldx = (g.labelDx || 0) * U;
        const lt = txt(g.region ? L.labels : gg, right ? r.x + r.w - 10 : r.x + 10 + ldx, bottomL ? r.y + r.h - (sub2 ? 22 : 8) : r.y + 17, qText(g.label, ctl, spec), g.region ? 'ad-region-label' : 'ad-group-label', right ? 'end' : null);
        if (g.region && String(g.label).length * 7.0 > regionTitleMax(r)) { lt.setAttribute('textLength', r1(regionTitleMax(r))); lt.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
      }
      if (g.repeat && run) {
        const v = repeatValue(run.config, g.repeat);
        let tag = g.repeat.tag ? String(g.repeat.tag).replace('{v}', v).replace('{pl}', v === 1 ? '' : 'es').replace('{raw}', repeatValue(run.config, g.repeat, true)) : '× ' + (g.repeat.sym || 'L') + ' = ' + v;
        // repeat.totalOf: parámetros del nodo repetido en todo el modelo (byNode del calculador); una lista de
        // ids suma sus totales (fase 5: la etapa del ViT de SAM = bloques con ventanas + bloque global)
        const tns = [].concat(g.repeat.totalOf || []).map((id) => (spec.nodes || []).find((x) => x.id === id)).filter(Boolean);
        // repeat.tagPos:'bottom' = la etiqueta "× v" abajo a la derecha (un grupo dentro de otro: la de arriba
        // chocaría con la pila de cabezas del bloque)
        const bottom = g.repeat.tagPos === 'bottom';
        txt(gg, r.x + r.w - 10, bottom ? r.y + r.h - 8 : r.y + 17, tag, 'ad-group-tag', 'end');
        // total del bloque repetido (byNode); repeat.totalLabel = plantilla con {t} (y {{…}} del calculador);
        // sin línea si se repite 1 vez
        if (tns.length && ctl.mode !== 'blank' && !ctl.quiz && v !== 1) {
          const tot = tns.reduce((a, tn) => { const c = nodeCost(run, tn); return a + ((c.total && c.total.params) || 0); }, 0);
          if (tot) txt(gg, r.x + r.w - 10, bottom ? r.y + r.h - 22 : r.y + (tag.indexOf('_') >= 0 ? 34 : 32), String(qText(g.repeat.totalLabel || '= {t} en total', ctl, spec)).replace('{t}', fsi(tot)), 'ad-group-total', 'end');
        }
      }
      // el subtítulo de un carril (costos que nombran sus bloques: "encoder + neck: …") no va en la práctica
      if (g.label2 && !hideTitle && !(lane && (ctl.mode === 'blank' || ctl.quiz))) {
        // label2Pos: dónde va el subtítulo (por omisión, con el título); 'bottom-left' lo deja abajo con el título arriba
        const p2 = g.label2Pos || g.labelPos || '';
        const bl = p2.indexOf('bottom') === 0, rt = /right$/.test(p2);
        txt(gg, rt ? r.x + r.w - 10 : r.x + 10, bl ? r.y + r.h - 8 : r.y + 31, qText(g.label2, ctl, spec), 'ad-group-sub', rt ? 'end' : null);
      }
    }

    // ---- nodos
    const nodeEls = {};
    for (const n of spec.nodes || []) {
      const el = isMap ? drawMapNode(ctl, L.nodes, n, geo.nodes[n.id], used) : drawNode(ctl, L.nodes, n, geo.nodes[n.id], run, used, spec);
      nodeEls[n.id] = el;
      // fase 8 (revisión): node.hideInBlank = el nodo no va en la práctica (la barra del costo por imagen: sin ella, el marco
      // quedaba vacío con solo el título)
      if (el && ctl.mode === 'blank' && n.hideInBlank && !slotFor(ctl, n.id)) { el.setAttribute('display', 'none'); el.setAttribute('aria-hidden', 'true'); }
    }

    // ---- aristas
    const edgeEls = [];
    const tensorAt = {};
    for (const t of spec.tensors || []) if (t.at && t.at.edge) tensorAt[t.at.edge + (t.at.tensor ? '@' + t.at.tensor : '')] = t;
    // fase 7 (revisión): una arista que entra (o sale) por arriba o por la derecha de un bloque con mazo de cabezas
    // termina en la carta más externa; si no, el mazo (los nodos van encima de las aristas) tapaba la punta de la flecha
    if (!isMap && run) geo.edges.forEach((ge) => deckTrim(ge, spec, run, geo));
    geo.edges.forEach((ge) => {
      const el = drawEdge(ctl, L, ge, run, used, tensorAt, isMap);
      if (el) edgeEls.push(el);
    });
    // ---- glifos sueltos (at:{x,y}); refTensors = los mismos, pero de OTRA config (p. ej. ResNet-50
    // junto a Swin para comparar c2…c5): el grupo lleva data-config y checkLabels usa esa config.
    const loose = (spec.tensors || []).map((t) => ({ t, rt: run && run.tensors[t.id], cfg: null }));
    for (const t of spec.refTensors || []) {
      let rr = null;
      try { rr = runFor(t.config); } catch (e) { rr = null; }
      loose.push({ t, rt: rr && rr.tensors[t.id], cfg: t.config, ref: true });
    }
    for (const { t, rt, cfg, ref } of loose) {
      if (!t.at || t.at.edge || !rt) continue;
      const gg = S('g', { class: 'ad-tensor' + (ref ? ' ad-tensor--ref' : ''), 'data-tensor-glyph': t.id, 'data-config': cfg }, L.labels);
      // win: 'M' = tamaño de ventana tomado de la config (rejilla de ventanas sobre la cara del glifo)
      const hcfg = (cfg ? runFor(cfg) : run).config;
      let hint = typeof t.win === 'string' ? Object.assign({}, t, { win: cfgPath(hcfg, t.win) }) : t;
      // pxFit = {key, w}: px por token = min(px, w / config[key]); la misma escala para toda la tira (p. ej. los
      // 4 stages de Swin a 384 no invaden el marco del stage 1), sin cambiar la config canónica
      if (t.pxFit) { const side = cfgPath(hcfg, t.pxFit.key); if (side > 0) hint = Object.assign({}, hint, { pxEff: Math.min(t.px || 2, t.pxFit.w / side) }); }
      const gs = glyphSize(rt, hint);
      // (x, y) = centro inferior del glifo; nota opcional encima y forma a la derecha o debajo
      const gx = t.at.x * U - gs.w / 2, gy = t.at.y * U;
      if (isJoint(drawGlyph(gg, rt, gx, gy, id, t.mark, hint))) used.joint = true;
      if (rt.mod) used.mods.add(rt.mod); used.glyph = true;
      if (t.note) txt(gg, t.at.x * U, gy - gs.h - 7, qText(t.note, ctl, spec, cfg), 'ad-glyph-note', 'middle');
      if (t.show !== 'glyph' && !(ctl.blankHide && ctl.blankHide.nums.has(rt.num.join('×')))) {
        // en el mazo 'amat' la franja de modalidad de las columnas va DEBAJO del glifo (y + 2 … y + 7):
        // la forma baja 7 px para no quedar encima de esas marcas
        const axPad = t.glyph === 'amat' && t.axes && t.axes.cols ? 7 : 0;
        if (t.labelSide === 'below') shapeLabel(ctl, gg, rt, t.at.x * U, gy - 4 + axPad, 'below', t.id);
        else if (t.labelSide === 'left') shapeLabel(ctl, gg, rt, gx - 2, gy - gs.h / 2, 'left', t.id);
        else shapeLabel(ctl, gg, rt, gx + gs.w, gy - gs.h / 2, 'right', t.id);
      }
      // fase 5: leader = {node, side, at} — línea fina punteada del glifo al bloque que lo produce o usa
      // (un glifo suelto entre columnas se leía como un tensor sin dueño)
      // (la caja del glifo incluye su nota de arriba: la línea no la tacha)
      if (t.leader && geo.nodes[t.leader.node]) { const top = gy - gs.h - (t.note ? 18 : 0); drawLeader(gg, [gx, top, gs.w, gy - top], geo.nodes[t.leader.node], t.leader); }
    }
    // ---- anotaciones (spec.notes): texto corto fijo en la grilla, p. ej. "stride 4" o el título de una
    // tira de comparación. Admite {{…}} del calculador (los números nunca se escriben a mano).
    for (const nt of spec.notes || []) {
      // práctica (diagrama en blanco) y figuras de los drills: las notas suelen nombrar lo que se pregunta
      // ("filas: queries · columnas: tokens del texto", "P3: 6,400 celdas…"); solo quedan los títulos y
      // las marcadas keepInBlank
      if ((ctl.mode === 'blank' || ctl.quiz) && !nt.keepInBlank && nt.cls !== 'title') continue;
      const s = strip(qResolve(nt.text, (ctl.opts && ctl.opts.config) || spec.config));
      if (!s) continue;
      // swatch: muestra de modalidad antes del texto (p. ej. "filas: imágenes" con la franja de --mod-img)
      if (nt.swatch) S('rect', { x: r1(nt.x * U), y: r1(nt.y * U - 8.5), width: 9, height: 9, class: 'ad-axis ad-mod--' + nt.swatch, fill: nt.swatch === 'joint' ? 'var(--op-fuse-soft)' : 'url(#' + id + '-tx-' + nt.swatch + ')' }, L.labels);
      if (nt.swatch === 'joint') S('path', { d: 'M' + P([nt.x * U, nt.y * U - 8.5]) + 'l9,9', class: 'ad-matdiag' }, L.labels);
      const te = txt(L.labels, nt.x * U + (nt.swatch ? 13 : 0), nt.y * U, s, nt.cls === 'title' ? 'ad-ref-label' : 'ad-note-txt' + (nt.cls === 'ink' ? ' ad-note-txt--ink' : ''), nt.anchor || null);
      te.setAttribute('data-note', nt.id || '');
    }
    ctl.building = null;
    // fase 9 (revisión): spec.blankCrop = en la práctica, el alto llega hasta lo visible (los nodos hideInBlank de abajo, las
    // barras del costo, dejaban una banda vacía de ≈ 170 px)
    let Hv = Hh;
    if (ctl.mode === 'blank' && spec.blankCrop) {
      const vis = (spec.nodes || []).filter((n) => !n.hideInBlank || slotFor(ctl, n.id)).map((n) => geo.nodes[n.id]);
      const gr = (spec.groups || []).map((g) => geo.groups[g.id]);
      const ys = vis.concat(gr).filter(Boolean).map((r) => r.y + r.h);
      geo.edges.forEach((ge) => ge.pts.forEach((p) => ys.push(p[1])));
      if (ys.length) Hv = Math.min(Hh, Math.max(...ys) + 2 * U);
    }
    return { svg, geo, used, nodeEls, edgeEls, run, spec, width: W, height: Hv };
  }

  // Mazo de cabezas de un nodo (node.heads): las cartas 1…k−1 van desplazadas 3 px arriba a la derecha (drawNode).
  // deckTrim lleva el extremo de una arista que llega por arriba o por la derecha hasta la carta más externa que cubre
  // ese punto (la que se ve), sin cambiar el tramo anterior (horizontal por la derecha, vertical por arriba).
  function deckTrim(ge, spec, run, geo) {
    if (ge.curve || !ge.pts || ge.pts.length < 2) return;
    const fix = (end) => {
      const id = end ? ge.to : ge.from, side = end ? ge.toSide : ge.fromSide;
      if (side !== 'right' && side !== 'top') return;
      const n = (spec.nodes || []).find((x) => x.id === id), r = geo.nodes[id];
      const hv = n && n.heads && r ? cfgPath(run.config, n.heads) : 0;
      if (!(hv > 1)) return;
      const k = Math.min(hv, 8) - 1;
      const i = end ? ge.pts.length - 1 : 0, j = end ? i - 1 : 1;
      const p = ge.pts[i].slice(), q = ge.pts[j];
      let m = 0;
      for (let c = 1; c <= k; c++) {
        if (side === 'right' ? (p[1] >= r.y - 3 * c && p[1] <= r.y + r.h - 3 * c) : (p[0] >= r.x + 3 * c && p[0] <= r.x + r.w + 3 * c)) m = c;
      }
      if (!m) return;
      if (side === 'right') { p[0] = r.x + r.w + 3 * m; if (q[0] < p[0] + 6) return; }
      else { p[1] = r.y - 3 * m; if (q[1] > p[1] - 6) return; }
      if (!ge.pts0) ge.pts0 = ge.pts;
      ge.pts = ge.pts.slice();
      ge.pts[i] = p;
    };
    fix(true);
    fix(false);
  }

  // Línea guía de un glifo suelto a su bloque: del punto del contorno del glifo más cercano al punto de
  // anclaje del bloque (lado + at, como las aristas), con un punto en el extremo del bloque. box = [x, y, w, h] px.
  function drawLeader(parent, box, r, ld) {
    const B = attach(r, ld.side || 'left', ld.at);
    const A = [clamp(B[0], box[0], box[0] + box[2]), clamp(B[1], box[1], box[1] + box[3])];
    const lg = S('g', { class: 'ad-leader' }, parent);
    S('path', { d: 'M' + P(A) + 'L' + P(B), class: 'ad-leader-ln' }, lg);
    S('circle', { cx: r1(B[0]), cy: r1(B[1]), r: 2.2, class: 'ad-leader-dot' }, lg);
    return lg;
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
    // style:'block' = bloque compuesto (p. ej. una capa entera): marco neutro; el color lo dan sus sub-ops (mini).
    const block = n.style === 'block' && !blankOp;
    // fase 9: style:'closed' = caja negra (pesos cerrados, RT-2): relleno opaco, sin el color de su op (no se ve por dentro)
    const closed = n.style === 'closed' && !blankOp;
    // fase 9: spec.calc === false = vista sin calculador (pesos cerrados): imagen, tira y regla de bins con literales
    const nocalc = !!(spec && spec.calc === false);
    // fase 10 (revisión): node.ghost = no es otro modelo en memoria (contorno punteado, relleno tenue)
    if (n.ghost) used.ghost = true;
    const g = S('g', { class: 'ad-node ad-op--' + (blankOp ? 'blank' : op) + (op === 'io' ? ' ad-node--io' : '') + (CIRCLE_SHAPES[shape] ? ' ad-node--sym' : '') + (n.expand ? ' ad-node--expandable' : '') + (block ? ' ad-node--block' : '') + (closed ? ' ad-node--closed' : '') + (n.ghost ? ' ad-node--ghost' : ''),
      'data-node': n.id, tabindex: ctl.mode === 'blank' && !slot ? -1 : 0, role: 'button' }, parent);
    if (closed) used.closed = true;
    // fase 9 (revisión): la máscara de π0 es un tensorop que no dibuja ⊕: no lleva "Operaciones de tensor" a la leyenda
    if (op !== 'io' && !blankOp && !block && !closed && !n.maskGrid) used.ops.add(op);
    if (n.modality) used.mods.add(n.modality);
    const cost = run && op !== 'io' ? nodeCost(run, n) : null;
    let label = blankName(ctl, n) || '';
    let sub = nodeSub(n, ctl, spec);
    if (slot && slot.ask === 'label') { label = ''; sub = ''; }
    if (blankOp) sub = '';                       // la píldora del hueco ocupa el centro: sin sub debajo
    const hv = n.heads && run ? cfgPath(run.config, n.heads) : 0;
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
        txt(g, r.x + r.w + (k - 1) * 3 + 4, r.y - (k - 1) * 3 + 4, (n.headsSym || n.heads) + ' = ' + hv, 'ad-heads-tag');
      }
      // fase 9: parallel puede ser una clave del calculador ('cfg.cams': una carta por cámara de π0)
      const par = typeof n.parallel === 'string' ? numKey(run, n.parallel) : n.parallel;
      if (par > 1) {
        for (let i = Math.min(par, 4) - 1; i >= 1; i--) S('rect', { x: r.x + i * 4, y: r.y + i * 4, width: r.w, height: r.h, rx: 4, class: 'ad-box ad-box--deck' }, g);
      }
      // style:'store' = almacén (cilindro): guarda tensores entre pasos (el banco de memoria de SAM 2); no es una
      // operación. Su color sigue siendo el de su op (p. ej. embed: sus únicos parámetros son una tabla).
      const store = n.style === 'store' && !blankOp;
      const ry = store ? Math.min(6, r.h * 0.12) : 0;
      if (store) {
        used.store = true;
        S('path', { d: 'M' + P([r.x, r.y + ry]) + 'V' + r1(r.y + r.h - ry) + 'A' + r1(r.w / 2) + ',' + r1(ry) + ' 0 0 0 ' + P([r.x + r.w, r.y + r.h - ry]) + 'V' + r1(r.y + ry), class: 'ad-box ad-box--store' }, g);
        S('ellipse', { cx: r1(r.x + r.w / 2), cy: r1(r.y + ry), rx: r1(r.w / 2), ry: r1(ry), class: 'ad-box ad-box--store' }, g);
      } else S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: shape === 'pill' ? Math.min(r.h / 2, 12) : 4, class: 'ad-box' }, g);
      if (n.modality) S('rect', { x: r.x + 1, y: r.y + 4, width: 3.5, height: r.h - 8, class: 'ad-stripe ad-mod--' + n.modality }, g);
      if (n.image && ((run && run.config) || nocalc)) {
        const pad = 6, side = Math.min(r.w - 2 * pad, r.h - 2 * pad - (label ? 16 : 0));
        const grid = n.imageGrid != null ? n.imageGrid : run && run.config.P ? Math.round(run.config.H / run.config.P) : 0;
        drawScene(g, r.x + (r.w - side) / 2, r.y + pad, side, side, grid);
        if (label) txt(g, r.x + r.w / 2, r.y + r.h - 7, label, 'ad-label', 'middle');
      } else {
        const lines = String(label).split('\n').filter(Boolean);
        // fase 6: kvGroups / experts / rows ocupan la parte de abajo del bloque (como mini): el texto sube
        const hideInner = slot && slot.ask === 'label';
        // fase 7: strip (tira de tokens), posIds (ids de M-RoPE) y layers (capas con la toma) también van abajo
        // fase 8: costSplit (barra del costo por imagen) también va abajo
        // fase 10: bars (barras por fila, fuera de la práctica) y matrix (matriz a escala) también van abajo
        const innerH = hideInner ? 0 : n.kvGroups ? KVG_H : n.experts ? EXP_H : (n.rows && store) ? ROWS_H(n.rows) : n.strip ? STRIP_H : n.posIds ? POS_H : n.layers ? LAYERS_H : n.bins ? BINS_H : n.maskGrid ? maskGridH(n.maskGrid) : (n.costSplit && ctl.mode !== 'blank' && !ctl.quiz) ? COST_H(n.costSplit) : (n.bars && ctl.mode !== 'blank' && !ctl.quiz) ? BARS_H(n.bars, r.w, (ctl.opts && ctl.opts.config) || (spec && spec.config), run, ctl, spec, !!(ctl.narrow && spec && spec.mobileGrid)) : n.matrix ? MAT_H(n.matrix) : n.tokens ? TOK_H(n.tokens) : n.cells ? CELLS_H(n.cells, run) : n.layered ? LAYERED_H(n.layered) : n.wave ? WAVE_H : n.melGrid ? MEL_H(n.melGrid) : 0;
        const miniH = n.mini ? 22 : innerH;
        // sub con '\n' = varias líneas (el banco de SAM 2: "FIFO de N_r recientes" / "+ N_p con prompt (fijos)")
        const subs = sub ? String(sub).split('\n') : [];
        const total = lines.length * 15 + subs.length * 13;
        let y0 = r.y + ry + (r.h - ry - miniH) / 2 - total / 2 + 11;
        let cx = r.x + r.w / 2;
        if (n.symbol === 'concat2x2') {
          // fase 7 (revisión): pictograma ancho del merger de Qwen2-VL: 2×2 parches vecinos → 1 vector con los 4 uno al
          // lado del otro (concatenación, no promedio): el mismo tono para el mismo parche a los dos lados
          const pw = drawConcat2x2(g, r.x + 7, r.y + r.h / 2);
          cx = r.x + pw + 10 + (r.w - pw - 10) / 2;
        } else if (n.symbol) {
          // símbolo de operación de tensor a la izquierda, texto centrado en el resto
          const sr = Math.min(r.h / 2 - 3, 9);
          drawSymbol(g, n.symbol, r.x + 6 + sr, r.y + r.h / 2, sr);
          cx = r.x + (2 * sr + 8) + (r.w - (2 * sr + 8)) / 2;
        }
        lines.forEach((ln, i) => txt(g, cx, y0 + i * 15, ln, 'ad-label', 'middle'));
        subs.forEach((sl, i) => txt(g, cx, y0 + lines.length * 15 + 0.5 + i * 13, sl, 'ad-sub', 'middle'));
        // un hueco que pide el NOMBRE del bloque no muestra su esquema en miniatura: los chips
        // ("top-down: T-CSP ×2", "imagen ← texto"…) darían la respuesta
        if (n.mini && !(slot && slot.ask === 'label')) drawMini(g, n.mini, r, used);
        if (!hideInner && run && run.config) {
          if (n.kvGroups) drawKvGroups(g, n.kvGroups, r, run.config, used);
          else if (n.experts) drawExperts(g, n.experts, r, run.config, used);
          else if (n.rows && store) drawStoreRows(g, n.rows, r, used, ctl, spec);
          else if (n.strip) drawStrip(g, n.strip, r, run, used, ctl, spec);
          else if (n.layers) drawLayers(g, n.layers, r, run, used, layersNeutral(ctl, spec, n));
          // en la práctica la barra no va: sus filas nombran los bloques ("Encoder de texto × 2") que los huecos preguntan
          else if (n.costSplit && ctl.mode !== 'blank' && !ctl.quiz) drawCostSplit(g, n.costSplit, r, run, used, ctl, spec);
          else if (n.bars && ctl.mode !== 'blank' && !ctl.quiz) drawBars(g, n.bars, r, run, used, ctl, spec);
          else if (n.matrix) drawMatrix(g, n.matrix, r, run, used, ctl);
          // fase 11: tabla de celdas (similitudes token×token de ColBERT, tabla ADC, listas invertidas)
          else if (n.cells) drawCells(g, n.cells, r, run, used, ctl, spec);
        } else if (!hideInner && nocalc && n.strip) drawStrip(g, n.strip, r, null, used, ctl, spec);
        // fase 9: regla de bins (una dimensión de la acción) y máscara de atención por bloques: no dependen del calculador
        if (!hideInner && n.bins) drawBins(g, n.bins, r, used);
        // fase 11: fila de tokens de ejemplo (BERT) y grafo por capas (HNSW): pictogramas sin números del calculador
        if (!hideInner && n.tokens) drawTokens(g, n.tokens, r, used, ctl, spec);
        if (!hideInner && n.layered) drawLayered(g, n.layered, r, used, ctl, spec);
        // fase 12: onda de audio y espectrograma log-Mel (pictogramas ilustrativos de Whisper)
        if (!hideInner && n.wave) drawWave(g, n.wave, r, used);
        if (!hideInner && n.melGrid) drawMelGrid(g, n.melGrid, r, used);
        if (!hideInner && n.maskGrid) drawMaskGrid(g, n.maskGrid, r, used);
        if (!hideInner && n.posIds) drawPosIds(g, n.posIds, r, used, ctl);
      }
      if (cost && cost.params > 0 && ctl.mode !== 'blank' && !ctl.quiz) {
        used.badge = true;
        // badgeTotal: en un bloque repetido, "por capa · total" (ambos del calculador)
        // (el total del bloque repetido va en la etiqueta "× L" del grupo: repeat.totalOf)
        const s = n.badgeTotal && cost.rep > 1 ? fsi(cost.params) + ' ' + (n.badgeUnit || 'por capa') : fsi(cost.params);
        const bw = textW(s, 10.5, true) + 18;
        // insignia de parámetros arriba a la izquierda, entera por encima del borde: la derecha de cada nodo la
        // ocupan las etiquetas de forma de la arista que llega (y la pila de cabezas). badgePos:'right' la mueve.
        const left = n.badgePos !== 'right';
        const bx = left ? r.x + 4 : r.x + r.w - bw - 4, by = r.y - 11;
        const b = S('g', { class: 'ad-badge' }, g);
        S('rect', { x: r1(bx), y: by, width: r1(bw), height: 15, rx: 7.5, class: 'ad-badge-bg' }, b);
        S('path', { d: 'M' + P([bx + 6, by + 7.5]) + 'm-2.2,0a2.2,2.2 0 1,0 4.4,0a2.2,2.2 0 1,0 -4.4,0M' + P([bx + 8.2, by + 7.5]) + 'h3.6M' + P([bx + 10.6, by + 7.5]) + 'v2.2', class: 'ad-key' }, b);
        txt(b, bx + 14, by + 11.3, s, 'ad-badge-txt');
      }
      // fase 7: congelado / entrena (en la práctica también: es parte de la figura, no la respuesta de un hueco de nombre)
      if (n.train && !(slot && slot.ask === 'label')) drawTrain(g, n, r, used, ctl);
      // fase 10: adaptador LoRA (B·A) sobre una lineal, encendido según la config dibujada
      if (n.adapter && run) drawAdapter(g, n, r, run, used, ctl);
      // fase 8: node.runs = cuántas veces corre por imagen ("× {{metrics.nfe}}"), píldora con ↻ arriba a la derecha
      if (n.runs && !(slot && (slot.ask === 'label' || slot.ask === 'op'))) drawRuns(g, n, r, used, ctl, spec);
      const flag = n.flag && ctl.mode !== 'blank' && !n.train ? qText(n.flag, ctl, spec) : '';
      if (flag) {
        // marca corta arriba a la derecha (p. ej. "≠ ViT"): diferencias de un modelo frente a su base
        const fw = textW(flag, 10, true) + 10;
        const fl = S('g', { class: 'ad-flag' }, g);
        S('rect', { x: r1(r.x + r.w - fw - 4), y: r.y - 8, width: r1(fw), height: 14, rx: 3, class: 'ad-flag-bg' }, fl);
        txt(fl, r.x + r.w - 4 - fw / 2, r.y + 2.6, flag, 'ad-flag-txt', 'middle');
      }
      if (n.expand && ctl.mode === 'full') {
        const ex = S('g', { class: 'ad-expand-mark' }, g);
        S('path', { d: 'M' + P([r.x + r.w - 12, r.y + r.h - 4]) + 'h8v-8', class: 'ad-expand-ico' }, ex);
      }
      // fase 7: node.xref = [{href, label}] enlaces a vistas de OTRA página (el encoder de CLIP, el bloque del LLM): flecha ↗
      // arriba a la derecha (por dentro); los botones van en el panel de detalle
      if (n.xref && n.xref.length && ctl.mode === 'full') {
        used.xref = true;
        // arriba a la derecha, por dentro (abajo a la derecha va la marca de "se abre"; abajo, las filas internas)
        const xr = r.x + r.w - 13, yb = r.y + 13 + (n.train && n.trainPill !== false ? 9 : 0);   // con la píldora congelado/entrena, debajo de ella
        const xm = S('g', { class: 'ad-xref-mark' }, g);
        S('path', { d: 'M' + P([xr, yb]) + 'l8,-8M' + P([xr + 3, yb - 8]) + 'h5v5', class: 'ad-expand-ico' }, xm);
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
    // residuales: puente discontinuo por encima, con punta que entra en el ⊕ (como .ad-edge--residual)
    for (const [a, b] of mini.res || []) {
      const xa = cx[a][0] - 3, xb = (cx[b][0] + cx[b][1]) / 2, top = y - 7;
      const rg = S('g', { class: 'ad-edge--residual ad-mini-resg' }, mg);
      S('circle', { cx: r1(xa), cy: r1(y + hgt / 2), r: 1.8, class: 'ad-dot' }, rg);
      S('path', { d: 'M' + P([xa, y + hgt / 2]) + 'V' + r1(top) + 'H' + r1(xb) + 'V' + r1(y + hgt / 2 - 6 - 3.5), class: 'ad-ln ad-mini-res' }, rg);
      arrowHead(rg, [[xb, top], [xb, y + hgt / 2 - 6]], 'ad-head', 4.5);
      used.edges.add('residual');
    }
  }

  // ------------------------------------------------------------ fase 6 (LLM): agrupación GQA, expertos MoE, filas de un caché
  // node.kvGroups = {q:'h', kv:'nKV'} (claves de la config): dentro del bloque, n_kv grupos; cada uno con sus h/n_kv
  // cartas de query (Q) que bajan a UNA barra K,V compartida. MHA (n_kv = h) = grupos de 1; MQA (n_kv = 1) = un grupo.
  // Hasta 8 grupos dibujados (con "…" si hay más) y una línea con la cuenta de la config.
  const KVG_H = 50, EXP_H = 36;
  const ROWS_H = (o) => Math.min(o.n || 5, 8) * 6 + 10;
  function gqaWords(cfg, o) {
    const hq = cfgPath(cfg, o.q || 'h'), hk = cfgPath(cfg, o.kv || 'nKV');
    if (!(hq > 0 && hk > 0)) return null;
    const per = hq / hk;
    const text = per === 1 ? hq + ' Q y ' + hk + ' K,V: uno a uno (MHA)' : hk === 1 ? 'las ' + hq + ' Q comparten 1 K,V (MQA)' : per + ' Q comparten cada K,V · ' + hk + ' grupos (GQA)';
    return { hq, hk, per, text };
  }
  function drawKvGroups(g, o, r, cfg, used) {
    const w = gqaWords(cfg, o);
    if (!w) return;
    used.gqa = true;
    const gg = S('g', { class: 'ad-gqa' }, g);
    const x0 = r.x + 10, x1 = r.x + r.w - 10, yQ = r.y + r.h - KVG_H + 2, yK = yQ + 17, gap = 7;
    const more = w.hk > 8, nd = Math.min(w.hk, 8);
    const cellW = (x1 - x0 - (nd - 1) * gap) / nd;
    for (let i = 0; i < nd; i++) {
      const cx = x0 + i * (cellW + gap);
      if (more && i === nd - 1) { txt(gg, cx + cellW / 2, yK + 4, '… ' + w.hk, 'ad-gqa-more', 'middle'); continue; }
      const nq = Math.max(1, Math.min(w.per, Math.floor((cellW + 1.5) / 4.5)));
      const qW = (cellW - (nq - 1) * 1.5) / nq;
      const kvx = cx + cellW / 2;
      for (let j = 0; j < nq; j++) {
        const qx = cx + j * (qW + 1.5);
        S('path', { d: 'M' + P([qx + qW / 2, yQ + 9]) + 'L' + P([kvx, yK - 0.5]), class: 'ad-gqa-ln' }, gg);
        S('rect', { x: r1(qx), y: r1(yQ), width: r1(qW), height: 9, rx: 1.5, class: 'ad-gqa-q' }, gg);
      }
      if (nq < w.per) txt(gg, cx + cellW, yQ - 2, '×' + w.per, 'ad-gqa-more', 'end');
      S('rect', { x: r1(cx), y: r1(yK), width: r1(cellW), height: 10, rx: 2, class: 'ad-gqa-kv' }, gg);
      if (cellW >= 26) txt(gg, kvx, yK + 8, 'K,V', 'ad-gqa-kvtxt', 'middle');
    }
    txt(gg, r.x + r.w / 2, yK + 23, w.text, 'ad-gqa-cap', 'middle');
  }
  // node.experts = {n:'nExperts', k:'topK', lit:[i, j]}: una fila de n cajas (los FFN expertos) con k encendidas
  // (cuáles, ilustrativo: depende de cada token) y la cuenta "top-k de n" de la config.
  function drawExperts(g, o, r, cfg, used) {
    const E = cfgPath(cfg, o.n || 'nExperts'), K = cfgPath(cfg, o.k || 'topK');
    if (!(E > 0)) return;
    used.experts = true;
    const lit = new Set((o.lit || Array.from({ length: K || 0 }, (_, i) => i)).slice(0, K || 0));
    const gg = S('g', { class: 'ad-exps' }, g);
    const nd = Math.min(E, 16), gap = 4, x0 = r.x + 10, x1 = r.x + r.w - 10, y = r.y + r.h - EXP_H + 2;
    const bw = (x1 - x0 - (nd - 1) * gap) / nd;
    for (let i = 0; i < nd; i++) {
      const on = lit.has(i);
      S('rect', { x: r1(x0 + i * (bw + gap)), y: r1(y), width: r1(bw), height: 15, rx: 2, class: 'ad-exp' + (on ? ' is-on' : '') }, gg);
      if (bw >= 12) txt(gg, x0 + i * (bw + gap) + bw / 2, y + 11, String(i), 'ad-exp-txt' + (on ? ' is-on' : ''), 'middle');
    }
    txt(gg, r.x + r.w / 2, y + 29, String(o.caption || 'top-{k} de {n} por token').replace('{k}', K).replace('{n}', E), 'ad-gqa-cap', 'middle');
  }
  // node.rows = {n, add, label} en un almacén (style:'store'): n filas (una por token ya guardado) y las `add` últimas
  // resaltadas (lo que se agrega en este paso), con una etiqueta corta (p. ej. "+1 fila por token").
  function drawStoreRows(g, o, r, used, ctl, spec) {
    used.rows = true;
    const n = Math.min(o.n || 5, 8), add = Math.min(o.add == null ? 1 : o.add, n);
    const gg = S('g', { class: 'ad-rows' }, g);
    const w = Math.min(r.w * 0.42, 120), x = r.x + 14, yb = r.y + r.h - 9;
    for (let i = 0; i < n; i++) {
      const isNew = i >= n - add;
      S('rect', { x: r1(x), y: r1(yb - (n - i) * 6), width: r1(w), height: 4.2, rx: 1, class: 'ad-row' + (isNew ? ' is-new' : '') }, gg);
    }
    if (o.label) txt(gg, x + w + 7, yb - 3 * add + 2, qText(o.label, ctl, spec), 'ad-row-txt');
  }

  // ------------------------------------------------------------ fase 7 (VLM): tira de tokens, ids de M-RoPE, capas con toma,
  // marcas de entrenamiento y enlaces a otras páginas
  // Número del calculador por clave (nunca escrito a mano en el spec):
  //   'cfg.X' (config resuelta) · 'metrics.X' (ATLAS.Arch.metrics de la misma corrida) · 'q.X' (run.quantities) · 'ops.ID.params' ·
  //   'tensor.ID.i' (dimensión i del tensor) · un número literal solo para ejemplos ilustrativos.
  const metricsMemo = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function metricsOf(run) {
    if (!run) return null;
    if (metricsMemo && metricsMemo.has(run)) return metricsMemo.get(run);
    let m = null;
    try { const A = arch(); m = A && typeof A.metrics === 'function' ? A.metrics(run.id, run.overrides || undefined) : null; } catch (e) { m = null; }
    if (metricsMemo) metricsMemo.set(run, m);
    return m;
  }
  function numKey(run, key) {
    if (typeof key === 'number') return key;
    if (!run || key == null) return undefined;
    const parts = String(key).split('.'), ns = parts[0], rest = parts.slice(1);
    let v;
    if (ns === 'cfg') v = cfgPath(run.config, rest.join('.'));
    else if (ns === 'metrics') { const m = metricsOf(run); v = m ? cfgPath(m, rest.join('.')) : undefined; }
    else if (ns === 'q') v = run.quantities ? run.quantities[rest.join('.')] : undefined;
    else if (ns === 'tensor') { const t = run.tensors && run.tensors[rest[0]]; v = t && t.num ? t.num[+(rest[1] || 0)] : undefined; }
    // fase 10: 'ops.ID.params' / 'ops.ID.macs' = parámetros o MACs de esa op del calculador (una instancia, sin × repeat)
    else if (ns === 'ops') { const os = (run.ops || []).filter((o) => o.id === rest[0]); v = os.length ? os.reduce((a, o) => a + (o[rest[1] === 'macs' ? 'macs' : 'params'] || 0), 0) : undefined; }
    return Number.isFinite(v) ? v : undefined;
  }

  // node.strip = {segs:[{mod:'txt'|'img', n:<clave>, label}], caption}: el prompt como una tira de tokens, cada tramo con
  // ancho ∝ su número de tokens (lineal: los 576 de la imagen se ven dominar el prompt), la textura de su modalidad y su
  // cuenta debajo. caption admite {{…}} del calculador. Los tramos de menos de 30 px se ensanchan (sin mentir en la cuenta).
  const STRIP_H = 46;
  function stripSegs(o, run) {
    // frac: el tramo es una fracción de la clave (texto antes / después de <image> cuando el calculador solo da el total T;
    // esos tramos llevan count:false: no se inventa la partición, solo el total va en el caption)
    const segs = (o.segs || []).map((s) => { const v = numKey(run, s.n); return Object.assign({}, s, { v: Number.isFinite(v) ? v * (s.frac || 1) : v }); });
    return segs.every((s) => Number.isFinite(s.v) && s.v >= 0) ? segs : null;
  }
  function drawStrip(g, o, r, run, used, ctl, spec) {
    const segs = stripSegs(o, run);
    if (!segs) return;
    used.strip = true;
    const gg = S('g', { class: 'ad-strip' }, g);
    const x0 = r.x + 10, W = r.w - 20, y = r.y + r.h - STRIP_H + 1, bh = 16, gap = 2;
    const tot = segs.reduce((a, s) => a + s.v, 0) || 1;
    const avail = W - gap * (segs.length - 1), minW = Math.min(30, avail / segs.length);
    let ws = segs.map((s) => avail * s.v / tot);
    const small = ws.map((w) => w < minW);
    const fixed = small.reduce((a, s) => a + (s ? minW : 0), 0), big = ws.reduce((a, w, i) => a + (small[i] ? 0 : w), 0);
    ws = ws.map((w, i) => (small[i] ? minW : big > 0 ? w * (avail - fixed) / big : w));
    let x = x0;
    segs.forEach((s, i) => {
      const w = ws[i], mod = s.mod || 'txt';
      used.mods.add(mod);
      // fase 9 (revisión): la leyenda de la tira muestra exactamente las modalidades dibujadas (RT-2: solo acción)
      used.stripMods = used.stripMods || [];
      if (used.stripMods.indexOf(mod) < 0) used.stripMods.push(mod);
      const sg = S('g', { class: 'ad-glyph ad-mod--' + mod }, gg);
      S('rect', { x: r1(x), y: r1(y), width: r1(w), height: bh, class: 'ad-face ad-face--front ad-strip-seg', fill: 'url(#' + ctl.id + '-tx-' + mod + ')' }, sg);
      // marcas de token (hasta 1 cada 3 px): densidad ∝ tokens, como las marcas de un glifo
      const k = Math.min(s.v, Math.floor(w / 3));
      if (k > 1 && k <= 48) { let d = ''; for (let j = 1; j < k; j++) d += 'M' + P([x + j * w / k, y]) + 'V' + r1(y + bh); S('path', { d, class: 'ad-tokmarks' }, sg); }
      const lab = s.count === false ? (s.label || '') : fint(s.v) + (s.label ? ' ' + s.label : '');
      const short = s.count === false ? '' : fint(s.v);
      const fits = textW(lab, 10, true) < w + gap;
      txt(gg, x + w / 2, y + bh + 11, fits ? lab : short, 'ad-strip-n', 'middle');
      x += w + gap;
    });
    if (o.caption) txt(gg, r.x + r.w / 2, y + bh + 24, qText(o.caption, ctl, spec), 'ad-gqa-cap', 'middle');
  }

  // node.posIds = {segs:[{kind:'txt', n, words?}, {kind:'img', gh, gw, gt?}]}: ids de posición de M-RoPE (t, h, w) de un
  // prompt corto ILUSTRATIVO: el texto lleva el mismo id en los 3 ejes; los tokens de imagen comparten t y varían h y w;
  // el texto de después sigue en max(id) + 1. Misma regla que get_rope_index de HF (Qwen2-VL), sin la escala temporal.
  function mropeIds(segs) {
    const out = [];
    let st = 0;
    for (const s of segs || []) {
      if (s.kind === 'img' || s.kind === 'video') {
        const gt = s.gt || 1, gh = s.gh || 1, gw = s.gw || 1;
        for (let ti = 0; ti < gt; ti++) for (let hi = 0; hi < gh; hi++) for (let wi = 0; wi < gw; wi++) out.push({ kind: 'img', t: st + ti, h: st + hi, w: st + wi, ti, hi, wi, seg: s });
        st += Math.max(gt, gh, gw);
      } else {
        const n = s.n || (s.words || []).length || 1;
        for (let i = 0; i < n; i++) out.push({ kind: 'txt', t: st + i, h: st + i, w: st + i, word: s.words && s.words[i], seg: s });
        st += n;
      }
    }
    return out;
  }
  const POS_H = 70;
  function drawPosIds(g, o, r, used, ctl) {
    const ids = mropeIds(o.segs);
    if (!ids.length) return;
    used.posIds = true;
    used.mods.add('txt'); used.mods.add('img');
    const gg = S('g', { class: 'ad-posids' }, g);
    const lx = r.x + 12, x0 = r.x + 28, W = r.w - 40, n = ids.length;
    const cw = Math.min(26, W / n), y0 = r.y + r.h - POS_H + 4;
    const xs = (i) => x0 + (W - cw * n) / 2 + i * cw;
    ['t', 'h', 'w'].forEach((ax, j) => txt(gg, lx, y0 + 30 + j * 13, ax, 'ad-pos-ax'));
    ids.forEach((p, i) => {
      const x = xs(i), mod = p.kind === 'img' ? 'img' : 'txt';
      const sg = S('g', { class: 'ad-glyph ad-mod--' + mod }, gg);
      S('rect', { x: r1(x + 1), y: r1(y0 + 6), width: r1(cw - 2), height: 12, rx: 1.5, class: 'ad-face ad-face--front', fill: 'url(#' + ctl.id + '-tx-' + mod + ')' }, sg);
      ['t', 'h', 'w'].forEach((ax, j) => {
        const same = p.kind === 'txt' || ax === 't';
        txt(gg, x + cw / 2, y0 + 30 + j * 13, String(p[ax]), 'ad-pos-n' + (p.kind === 'img' && !same ? ' is-var' : ''), 'middle');
      });
    });
    // llave bajo los tokens de imagen
    const firstImg = ids.findIndex((p) => p.kind === 'img');
    if (firstImg >= 0) {
      let lastImg = firstImg; while (lastImg + 1 < n && ids[lastImg + 1].kind === 'img') lastImg++;
      const a = xs(firstImg) + 1, b = xs(lastImg) + cw - 1, seg = ids[firstImg].seg;
      S('path', { d: 'M' + P([a, y0 + 3]) + 'V' + r1(y0 + 1) + 'H' + r1(b) + 'V' + r1(y0 + 3), class: 'ad-pos-brace' }, gg);
      txt(gg, (a + b) / 2, y0 - 2, 'imagen ' + (seg.gh || 1) + '×' + (seg.gw || 1) + ' tokens', 'ad-pos-cap', 'middle');
    }
  }

  // node.layers = {L:<clave>, tap:<clave o número negativo>, label?}: la pila de capas de un encoder en una fila, con la capa
  // de la que se toman las features resaltada ("toma") y las que quedan después atenuadas ("no se usa"). LLaVA: la penúltima.
  const LAYERS_H = 34;
  // capa de la toma (1-based): un índice negativo cuenta desde el final como hidden_states[−k] (−2 = la penúltima capa)
  function tapOf(run, o, L) { const t = numKey(run, o.tap); return Number.isFinite(t) && t < 0 ? L + t + 1 : t; }
  // práctica: si el hueco pregunta por el bloque que consume estas features (la "penúltima capa, sin CLS" de LLaVA) o
  // por el propio encoder, la fila va neutra (sin la capa resaltada ni "se toma"): si no, daría la respuesta
  function layersNeutral(ctl, spec, n) {
    if (ctl.mode !== 'blank' && !ctl.quiz) return false;
    const isSlot = (id) => { const s = slotFor(ctl, id); return !!(s && (s.ask === 'label' || s.ask === 'op')); };
    if (isSlot(n.id)) return true;
    return (spec.edges || []).some((e) => e.from === n.id && isSlot(e.to));
  }
  function drawLayers(g, o, r, run, used, neutral) {
    const L = numKey(run, o.L);
    const tap = tapOf(run, o, L);
    if (!(L > 0) || !(tap > 0)) return;
    used.layers = true;
    const gg = S('g', { class: 'ad-layers' }, g);
    const head = Math.min(3, L), tail = Math.min(4, L - head);
    const cells = [];
    for (let i = 1; i <= head; i++) cells.push(i);
    if (L > head + tail) cells.push(null);
    for (let i = L - tail + 1; i <= L; i++) if (i > head) cells.push(i);
    const x0 = r.x + 12, W = r.w - 24, y = r.y + r.h - LAYERS_H + 2, ch = 13;
    const cw = W / cells.length;
    cells.forEach((c, i) => {
      const x = x0 + i * cw;
      if (c == null) { txt(gg, x + cw / 2, y + 10, '…', 'ad-layer-n', 'middle'); return; }
      const cls = neutral ? '' : c === tap ? ' is-tap' : c > tap ? ' is-off' : '';
      S('rect', { x: r1(x + 1.5), y: r1(y), width: r1(cw - 3), height: ch, rx: 2, class: 'ad-layer' + cls }, gg);
      txt(gg, x + cw / 2, y + 9.8, String(c), 'ad-layer-n' + cls, 'middle');
      // solo la toma lleva texto (las capas que no se usan van atenuadas y punteadas; la leyenda lo explica)
      if (c === tap && !neutral) txt(gg, x + cw / 2, y + ch + 11, o.tapLabel || 'toma', 'ad-layer-cap is-tap', 'middle');
    });
  }

  // node.train = 'frozen' | 'trained': píldora arriba a la derecha (congelado / entrena) y, si está congelado, un rayado
  // tenue sobre el bloque. La leyenda explica las dos.
  // fase 10: trainPill:false = solo el rayado (sin la píldora): las 7 lineales congeladas del bloque de LoRA no llevan 7 píldoras
  function drawTrain(g, n, r, used, ctl) {
    const fz = n.train === 'frozen';
    if (fz) S('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 4, class: 'ad-frozen-hatch', fill: 'url(#' + ctl.id + '-tx-frozen)' }, g);
    if (n.trainPill === false) { used[fz ? 'frozenHatch' : 'trained'] = true; return; }
    used[fz ? 'frozen' : 'trained'] = true;
    const label = fz ? 'congelado' : 'entrena';
    const w = textW(label, 10.5, true) + 24, x = r.x + r.w - w - 4, y = r.y - 8;
    const pg = S('g', { class: 'ad-train ' + (fz ? 'ad-train--frozen' : 'ad-train--on') }, g);
    S('rect', { x: r1(x), y, width: r1(w), height: 15, rx: 7.5, class: 'ad-train-bg' }, pg);
    trainIcon(pg, fz, x + 9, y + 7.5);
    txt(pg, x + 17, y + 11.3, label, 'ad-train-txt');
  }
  function trainIcon(p, fz, cx, cy) {
    if (fz) {
      // copo: tres líneas cruzadas
      let d = '';
      for (let i = 0; i < 3; i++) { const a = Math.PI * i / 3, dx = 4.2 * Math.cos(a), dy = 4.2 * Math.sin(a); d += 'M' + P([cx - dx, cy - dy]) + 'L' + P([cx + dx, cy + dy]); }
      S('path', { d, class: 'ad-train-ico' }, p);
    } else {
      // gradiente: flecha hacia abajo sobre una barra (los pesos se actualizan)
      S('path', { d: 'M' + P([cx, cy - 4.2]) + 'V' + r1(cy + 2.4) + 'M' + P([cx - 2.8, cy - 0.2]) + 'L' + P([cx, cy + 2.6]) + 'L' + P([cx + 2.8, cy - 0.2]) + 'M' + P([cx - 3.8, cy + 4.4]) + 'H' + r1(cx + 3.8), class: 'ad-train-ico' }, p);
    }
  }

  // ------------------------------------------------------------ fase 8 (difusión): veces que corre, costo por imagen, bucle
  // Flecha circular (↻) centrada en (cx, cy), radio k: el bucle de muestreo y las píldoras "× n".
  function loopIcon(p, cx, cy, k, cls) {
    const a0 = -0.35 * Math.PI, a1 = 1.25 * Math.PI;
    const P0 = [cx + k * Math.cos(a0), cy + k * Math.sin(a0)], P1 = [cx + k * Math.cos(a1), cy + k * Math.sin(a1)];
    // arco de 288° SOBRE el círculo (cx, cy): de P0 en sentido horario (ángulo creciente con y hacia abajo) hasta P1, dejando
    // el hueco arriba. (Antes iba de P1 a P0 con large-arc = 1 y sweep = 1: el arco horario entre esos puntos en este círculo es
    // el chico, así que SVG tomaba el círculo espejado por encima de la cuerda y el ↻ asomaba por el borde de la píldora.)
    S('path', { d: 'M' + P(P0) + 'A' + r1(k) + ',' + r1(k) + ' 0 1,1 ' + P(P1), class: cls || 'ad-loop-ico' }, p);
    // punta en P1, tangente al giro (sentido horario en pantalla)
    const tx = -Math.sin(a1), ty = Math.cos(a1), h = k * 0.8;
    S('path', { d: 'M' + P([P1[0] + tx * h * 0.2, P1[1] + ty * h * 0.2]) + 'L' + P([P1[0] - tx * h * 0.7 - ty * h * 0.55, P1[1] - ty * h * 0.7 + tx * h * 0.55]) + 'L' + P([P1[0] - tx * h * 0.7 + ty * h * 0.55, P1[1] - ty * h * 0.7 - tx * h * 0.55]) + 'Z', class: (cls || 'ad-loop-ico') + '-head' }, p);
  }
  // node.runs = texto corto con {{…}} del calculador ("× {{metrics.nfe}} pasadas"): píldora arriba a la derecha (con la de
  // congelado/entrena, a su izquierda). runsTone:'once' = tono neutro (corre una vez); por omisión, acento (corre en el bucle).
  function drawRuns(g, n, r, used, ctl, spec) {
    const s = qText(n.runs, ctl, spec);
    if (!s || String(s).indexOf('{{') >= 0) return;
    const once = n.runsTone === 'once';
    used[once ? 'runsOnce' : 'runs'] = true;
    const w = textW(s, 10.5, true) + 26;
    const trainW = n.train && n.trainPill !== false ? textW(n.train === 'frozen' ? 'congelado' : 'entrena', 10.5, true) + 24 + 6 : 0;
    // fase 9: con una marca (flag, p. ej. "pesos cerrados" en RT-2) la píldora va a su izquierda
    const fs = n.flag && ctl.mode !== 'blank' && !n.train ? qText(n.flag, ctl, spec) : '';
    const flagW = fs ? textW(fs, 10, true) + 10 + 6 : 0;
    const x = r.x + r.w - w - 4 - trainW - flagW, y = r.y - 8;
    const pg = S('g', { class: 'ad-runs' + (once ? ' ad-runs--once' : '') }, g);
    S('rect', { x: r1(x), y, width: r1(w), height: 15, rx: 7.5, class: 'ad-runs-bg' }, pg);
    loopIcon(pg, x + 10, y + 7.5, 3.6);
    txt(pg, x + 18, y + 11.3, s, 'ad-runs-txt');
  }
  // node.costSplit = {segs:[{tone:'loop'|'once'|'once2' (o op), n:<clave>, times?:<clave>, label}], caption} (times multiplica: el
  // encoder de texto corre textPasses veces con CFG): barra horizontal del costo (MACs) con un tramo por parte, ancho
  // ∝ su valor (lineal y honesto: un tramo chico queda en 1.5 px y su porcentaje lo dice), y debajo una fila por parte
  // (muestra · etiqueta · valor · %). caption (con {{…}}) debajo. Los números, del calculador (claves de numKey).
  const COST_H = (o) => 30 + 14 * ((o && o.segs) || []).length + (o && o.caption ? 14 : 0);
  function drawCostSplit(g, o, r, run, used, ctl, spec) {
    // fase 9 (revisión): seg.n puede ser una lista de claves que se suman (OpenVLA: visión + proyector en un solo tramo, como
    // el segmento del calculador; el proyector solo, azul, se confundía con los decodes del bucle)
    const val = (k) => (Array.isArray(k) ? k.reduce((a, x) => a + numKey(run, x), 0) : numKey(run, k));
    const segs = (o.segs || []).map((sg) => Object.assign({}, sg, { v: val(sg.n) * (sg.times != null ? numKey(run, sg.times) : 1) }));
    const cls = (sg) => 'ad-cs-seg ' + (sg.tone ? 'ad-cs--' + sg.tone : 'ad-op--' + (sg.op || 'tensorop'));
    if (!segs.length || !segs.every((sg) => Number.isFinite(sg.v) && sg.v >= 0)) return;
    used.costSplit = true;
    // fase 10 (revisión): legendSegs = la muestra de la leyenda con los colores de los dos primeros tramos (PPO no tiene tono "loop")
    if (o.legendSegs) used.costSplitCls = segs.slice(0, 2).map(cls);
    // fase 9: unit:'ms' = la barra del TIEMPO (≈ roofline del calculador) en vez de los MACs
    const A = arch(), ops = o.unit === 'ms' ? (v) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ms' : (v) => (A && A.fmt && A.fmt.ops ? A.fmt.ops(v) : fsi(v) + 'MACs');
    const tot = segs.reduce((a, sg) => a + sg.v, 0) || 1;
    const gg = S('g', { class: 'ad-cs' }, g);
    const x0 = r.x + 12, W = r.w - 24, y = r.y + r.h - COST_H(o) + 4, bh = 14;
    let x = x0;
    segs.forEach((sg) => {
      const w = Math.max(1.5, W * sg.v / tot);
      S('rect', { x: r1(x), y, width: r1(Math.min(w, x0 + W - x)), height: bh, class: cls(sg) }, gg);
      x += W * sg.v / tot;
    });
    S('rect', { x: x0, y, width: W, height: bh, class: 'ad-cs-frame' }, gg);
    // fase 10 (revisión): pct1 = un decimal por debajo de 10 % (el rollout de PPO: "2.7 %" como el caption, no "3 %")
    // fase 11 (revisión): pct1:'all' = un decimal en todos los tramos (el reranker: "94.8 %", como el rótulo del carril)
    const pct = (v) => { const f = 100 * v / tot; return o.pct1 && f > 0 && (f < 10 || (o.pct1 === 'all' && f < 99.95)) ? f.toFixed(1) + ' %' : f > 0 && f < 1 ? '<1 %' : (f > 99 && f < 100 ? '>99 %' : Math.round(f) + ' %'); };
    segs.forEach((sg, i) => {
      const yy = y + bh + 14 + i * 14;
      S('rect', { x: x0, y: r1(yy - 8.5), width: 9, height: 9, class: cls(sg) }, gg);
      txt(gg, x0 + 14, yy, qText(sg.label || '', ctl, spec), 'ad-cs-lab');
      txt(gg, x0 + W, yy, ops(sg.v) + ' · ' + pct(sg.v), 'ad-cs-val', 'end');
    });
    if (o.caption) txt(gg, x0, y + bh + 14 + segs.length * 14, qText(o.caption, ctl, spec), 'ad-gqa-cap');
  }

  // ------------------------------------------------------------ fase 9 (VLA): regla de bins y máscara por bloques
  // node.bins = {n:256, at:0.62, label}: la regla de n bins de UNA dimensión de acción (RT-2, OpenVLA) en la parte de abajo del
  // bloque: un trazo por bin (todos si caben a ≥ 1 px), marcas mayores cada n/8 con su índice, el bin `at` (fracción del rango,
  // ilustrativo) resaltado con su número y el valor continuo como un triángulo encima.
  const BINS_H = 44;
  function drawBins(g, o, r, used) {
    const n = o.n || 256;
    used.bins = true;
    const gg = S('g', { class: 'ad-bins' }, g);
    const x0 = r.x + 12, W = r.w - 24, y = r.y + r.h - BINS_H + 14, bh = 12;
    S('rect', { x: r1(x0), y: r1(y), width: r1(W), height: bh, class: 'ad-bins-track' }, gg);
    const step = W / n, every = step >= 1.5 ? 1 : Math.ceil(1.5 / step);
    let d = '';
    for (let i = every; i < n; i += every) d += 'M' + P([x0 + i * step, y + (i % (n / 8) === 0 ? 0 : bh * 0.45)]) + 'V' + r1(y + bh);
    S('path', { d, class: 'ad-bins-tick' }, gg);
    for (let i = 0; i <= 8; i++) { const b = Math.min(n - 1, i * n / 8); txt(gg, x0 + (i === 8 ? W : b * step), y + bh + 11, String(i === 8 ? n - 1 : b), 'ad-bins-n', i === 0 ? 'start' : i === 8 ? 'end' : 'middle'); }
    const at = o.at == null ? 0.5 : o.at, b = Math.min(n - 1, Math.floor(at * n));
    S('rect', { x: r1(x0 + b * step - 1), y: r1(y - 2), width: r1(Math.max(step, 1) + 2), height: bh + 4, class: 'ad-bins-on' }, gg);
    const vx = x0 + at * W;
    S('path', { d: 'M' + P([vx, y - 3]) + 'l-4,-6h8Z', class: 'ad-bins-val' }, gg);
    txt(gg, vx + 7, y - 5, (o.label || 'bin') + ' = ' + b, 'ad-bins-lab');
  }

  // node.maskGrid = {groups:[{label, cells, block, mod}], causal?:false}: la máscara de atención por bloques (π0) como una
  // grilla chica: fila = query, columna = key; permitido si block(key) ≤ block(query) (o causal: key ≤ query). Las celdas
  // permitidas llevan el color de la modalidad de la KEY; las bloqueadas, vacías con ×. Etiquetas de grupo a la izquierda.
  // en palabras (aria y texto alternativo): qué grupo ve a cuáles
  function maskWords(o) {
    const gs = o.groups || [];
    return gs.map((gq, i) => gq.label + ' ve ' + gs.filter((x, j) => (o.causal ? j <= i : (x.block || 0) <= (gq.block || 0))).map((x) => x.label).join(', ')).join('; ');
  }
  function maskGridH(o) { const n = (o.groups || []).reduce((a, gq) => a + (gq.cells || 1), 0); return n * (o.cell || 11) + 34; }
  // fase 9 (revisión): maskGrid.runRows = [bloques] cuyas filas (queries) corren en un paso de flujo: las demás filas se
  // atenúan y un corchete a la derecha las nombra (runLabel, con '\n'); mod:'state' = celda del estado del robot (no es
  // ruido: no usa el gris de 'lat')
  const MASK_RUN_W = 74;
  function drawMaskGrid(g, o, r, used) {
    const groups = o.groups || [];
    const cells = [];
    groups.forEach((gq, gi) => { for (let i = 0; i < (gq.cells || 1); i++) cells.push(gi); });
    const n = cells.length, cs = o.cell || 11;
    used.maskGrid = true;
    const run = Array.isArray(o.runRows) && o.runRows.length ? o.runRows : null;
    if (run) used.maskRun = true;
    const idleRow = (ri) => !!run && run.indexOf(groups[cells[ri]].block || 0) < 0;
    const gg = S('g', { class: 'ad-mask' }, g);
    const lw = o.labelW || 70;
    const gx = r.x + (r.w - (lw + 8 + n * cs + (run ? MASK_RUN_W : 0))) / 2 + lw + 8, gy = r.y + r.h - maskGridH(o) + 22;
    const ok = (ri, ci) => (o.causal ? ci <= ri : (groups[cells[ci]].block || 0) <= (groups[cells[ri]].block || 0));
    const idleG = run ? S('g', { class: 'ad-mask-idle' }, gg) : null;
    for (let ri = 0; ri < n; ri++) for (let ci = 0; ci < n; ci++) {
      const x = gx + ci * cs, y = gy + ri * cs, mod = groups[cells[ci]].mod || 'txt';
      const pg = idleRow(ri) ? idleG : gg;
      if (ok(ri, ci)) S('rect', { x: r1(x + 0.5), y: r1(y + 0.5), width: cs - 1, height: cs - 1, class: 'ad-mask-on ' + (mod === 'state' ? 'ad-mask--state' : 'ad-mod--' + mod) }, pg);
      else { S('rect', { x: r1(x + 0.5), y: r1(y + 0.5), width: cs - 1, height: cs - 1, class: 'ad-mask-off' }, pg); S('path', { d: 'M' + P([x + 3, y + 3]) + 'l' + (cs - 6) + ',' + (cs - 6) + 'm0,' + -(cs - 6) + 'l' + -(cs - 6) + ',' + (cs - 6), class: 'ad-mask-x' }, pg); }
    }
    let k = 0;
    groups.forEach((gq) => {
      const c = gq.cells || 1, y0 = gy + k * cs, x0 = gx + k * cs;
      const idle = !!run && run.indexOf(gq.block || 0) < 0;
      txt(gg, gx - 6, y0 + c * cs / 2 + 4, gq.label, 'ad-mask-lab' + (idle ? ' ad-mask-lab--idle' : ''), 'end');
      S('path', { d: 'M' + P([x0 + 1, gy - 4]) + 'V' + r1(gy - 7) + 'H' + r1(x0 + c * cs - 1) + 'V' + r1(gy - 4), class: 'ad-mask-brace' }, gg);
      if (gq.short) txt(gg, x0 + c * cs / 2, gy - 10, gq.short, 'ad-mask-lab', 'middle');
      k += c;
    });
    // separadores de bloque
    let d = '';
    for (let i = 1; i < n; i++) if ((groups[cells[i]].block || 0) !== (groups[cells[i - 1]].block || 0)) d += 'M' + P([gx + i * cs, gy - 2]) + 'V' + r1(gy + n * cs + 2) + 'M' + P([gx - 2, gy + i * cs]) + 'H' + r1(gx + n * cs + 2);
    if (d) S('path', { d, class: 'ad-mask-sep' }, gg);
    // corchete de las filas que corren
    if (run) {
      const rows = cells.map((gi, ri) => ri).filter((ri) => !idleRow(ri));
      if (rows.length) {
        const ya = gy + rows[0] * cs + 1, yb = gy + (rows[rows.length - 1] + 1) * cs - 1, bx = gx + n * cs + 6;
        S('path', { d: 'M' + P([bx, ya]) + 'h4V' + r1(yb) + 'h-4', class: 'ad-mask-run' }, gg);
        const lines = String(o.runLabel || 'corren en\ncada paso').split('\n');
        lines.forEach((ln, i) => txt(gg, bx + 9, (ya + yb) / 2 + 4 + (i - (lines.length - 1) / 2) * 12, ln, 'ad-mask-runlab'));
      }
    }
  }

  // ------------------------------------------------------------ fase 10 (LoRA / RLHF): barras por fila, matriz a escala, adaptador
  // node.bars = {unit:'bytes'|'params'|'macs'|'flops'|'count', rows:[{label, config?, ov?, segs?}], legend?:false, segs:[{n:<clave o [claves]>, label,
  //   op|mod|tone, frozen?, times?}], lines:[{v:<número o clave>, label}], labelW?, caption?, fits?:true}: una barra apilada
  // horizontal por fila, todas en la MISMA escala (lineal), con líneas verticales de referencia (las GPU de 24 / 48 / 80 GB).
  // Cada fila toma sus números de SU config (row.config; si no, la dibujada): claves de numKey (cfg.X, metrics.X, q.X…). Los
  // tramos frozen llevan el rayado de "congelado". La fila de la config dibujada va resaltada (is-cur). Debajo, la leyenda de
  // los tramos (una muestra por tramo) y el caption. En la práctica no se dibuja (las filas nombran bloques y métodos).
  const BAR_ROW = 22, BAR_BH = 14;
  // fase 10 (revisión): row.sub = segunda línea chica de la fila (qué genera cada método); narrow (< 640 px, spec.mobileGrid) =
  // rótulo arriba de la barra con el total a la derecha (o debajo si no entra), las líneas de las GPU solo sobre las barras, el
  // caption partido en líneas. Los textos llevan halo (las líneas rojas no los cortan).
  function barsLegendRows(o, w, ctl, spec) {
    const avail = w - 24;
    let rows = 1, x = 0;
    (o.segs || []).forEach((sg) => { const iw = 14 + textW(String((ctl ? qText(sg.label || '', ctl, spec) : sg.label) || ''), 10.5, false) + 14; if (x > 0 && x + iw > avail) { rows++; x = 0; } x += iw; });
    return rows;
  }
  // parte un texto en líneas de ancho ≤ w (corta en " · " y si no alcanza, en espacios)
  function wrapText(s, w, px, mono) {
    s = String(s || '');
    if (!s || textW(s, px, mono) <= w) return s ? [s] : [];
    const words = s.split(' '), lines = [];
    let cur = '';
    words.forEach((wd) => { const t = cur ? cur + ' ' + wd : wd; if (cur && textW(t, px, mono) > w) { lines.push(cur); cur = wd; } else cur = t; });
    if (cur) lines.push(cur);
    return lines;
  }
  function barsTotalText(o, row, D, fmtV) {
    let s = fmtV(row.total);
    if (o.fits && D.lines.length) {
      const fit = D.lines.slice().sort((a, b) => a.v - b.v).find((ln) => row.total <= ln.v);
      s += fit ? ' · entra en ' + (fit.label || fmtV(fit.v)) : ' · no entra';
    }
    return s;
  }
  // geometría de las filas (relativa a y0 = primera barra o primer rótulo): la usan el alto del nodo y el dibujo
  function barsLayout(o, w, run, cur, ctl, spec, narrow) {
    const D = barsData(o, run, cur);
    if (!D.rows.length || !D.rows.every((x) => x.ok)) return null;
    const fmtV = barsFmt(o.unit);
    const full = w - 24;
    let off = 0;
    const rows = D.rows.map((row) => {
      const lab = plainSub(qText(row.row.label || '', ctl, spec, row.row.config || null));
      const sub = row.row.sub ? qText(row.row.sub, ctl, spec, row.row.config || null) : '';
      const val = barsTotalText(o, row, D, fmtV);
      // la segunda línea se parte si no entra en el ancho del nodo (a 375 px, la de GRPO)
      const subs = sub ? wrapText(sub, full, 10, false) : [];
      const L = { off, lab, subs, val };
      if (narrow) {
        L.valInline = textW(lab, 11, false) + 12 + textW(val, 10.5, true) <= full;
        L.labY = 10; L.barY = 15;
        let b = L.barY + BAR_BH;
        if (!L.valInline) { L.valY = b + 11; b += 12; }
        if (subs.length) { L.subY = b + 11; b += 12 * subs.length; }
        L.bottom = b; L.h = b + 8;
      } else {
        L.labY = 11; L.barY = 0; L.valY = 11;
        if (subs.length) { L.subY = 26; L.bottom = 29 + 12 * (subs.length - 1); L.h = L.bottom + 5; } else { L.bottom = BAR_BH; L.h = BAR_ROW; }
      }
      off += L.h;
      return L;
    });
    const last = rows[rows.length - 1];
    const yEndRel = last.off + last.bottom;
    const legendRows = o.legend === false ? 0 : barsLegendRows(o, w, ctl, spec);
    const capLines = o.caption ? wrapText(qText(o.caption, ctl, spec), full, 10.5, true) : [];
    return { D, rows, yEndRel, legendRows, capLines, H: 18 + yEndRel + 8 + 6 + legendRows * 14 + capLines.length * 14 + 4 };
  }
  function BARS_H(o, w, cur, run, ctl, spec, narrow) { const lay = barsLayout(o, w, run, cur, ctl, spec, narrow); return lay ? lay.H : 0; }
  function barsRun(run, row) {
    if (!row || (!row.config && !row.ov)) return run;
    let r2 = null;
    try { r2 = runFor(row.config || run.id); } catch (e) { r2 = null; }
    return row.ov ? ovRun(r2, row.ov) : r2;
  }
  function barsFmt(unit) {
    const A = arch(), F = (A && A.fmt) || {};
    if (unit === 'bytes') return (v) => (F.bytes ? F.bytes(v) : fsi(v) + 'B');
    if (unit === 'macs') return (v) => (F.ops ? F.ops(v) : fsi(v) + 'MACs');
    if (unit === 'flops') return (v) => (F.ops ? F.ops(v, 'FLOPs') : fsi(v) + 'FLOPs');
    if (unit === 'count') return (v) => fint(v);
    return (v) => fsi(v);
  }
  // addCur = plantilla del rótulo de una fila extra con la config DIBUJADA, si no está entre las filas (lora r64 junto a las tres de siempre)
  function barsRowsOf(o, cur) {
    const rows = (o.rows || []).slice();
    if (o.addCur && cur && !rows.some((row) => (row.config === cur && !row.ov) || (!row.config && !row.ov))) rows.push({ config: cur, label: o.addCur, sub: o.addCurSub, added: true });
    return rows;
  }
  function barsData(o, run, cur) {
    const val = (rr, k) => (Array.isArray(k) ? k.reduce((a, x) => a + numKey(rr, x), 0) : numKey(rr, k));
    const rows = barsRowsOf(o, cur).map((row) => {
      const rr = barsRun(run, row);
      // seg.frozen = true | clave del calculador ('cfg.lora': rayado solo en las filas cuya config la tiene, la política de DPO con LoRA)
      const segs = (row.segs || o.segs || []).map((sg) => Object.assign({}, sg, { v: rr ? val(rr, sg.n) * (sg.times != null ? numKey(rr, sg.times) : 1) : NaN, fz: typeof sg.frozen === 'string' ? !!numKey(rr, sg.frozen) : !!sg.frozen }));
      return { row, run: rr, segs, total: segs.reduce((a, s) => a + (Number.isFinite(s.v) ? s.v : 0), 0), ok: !!rr && segs.every((s) => Number.isFinite(s.v) && s.v >= 0) };
    });
    const lines = (o.lines || []).map((ln) => ({ v: typeof ln.v === 'number' ? ln.v : numKey(run, ln.v), label: ln.label })).filter((ln) => Number.isFinite(ln.v) && ln.v > 0);
    return { rows, lines };
  }
  // rayado de "congelado" visible sobre un tramo de color (claro sobre el relleno): se agrega a <defs> solo cuando hace falta,
  // así las vistas anteriores no cambian
  function frozenBarFill(g, ctl) {
    const svg = g.ownerSVGElement, pid = ctl.id + '-tx-frozenbar';
    if (svg && !svg.querySelector('#' + pid)) {
      const d = svg.querySelector('defs') || S('defs', null, svg);
      const p = S('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(45)' }, d);
      S('path', { d: 'M0 0V5', class: 'ad-frozen-ln2' }, p);
    }
    return 'url(#' + pid + ')';
  }
  function barsCls(sg) { return 'ad-bar-seg ' + (sg.tone ? 'ad-cs--' + sg.tone : sg.mod ? 'ad-bar--mod ad-mod--' + sg.mod : 'ad-op--' + (sg.op || 'tensorop')); }
  function drawBars(g, o, r, run, used, ctl, spec) {
    const cur = (ctl.opts && ctl.opts.config) || spec.config;
    const narrow = !!(ctl.narrow && spec.mobileGrid);
    const lay = barsLayout(o, r.w, run, cur, ctl, spec, narrow);
    if (!lay) return;
    const D = lay.D;
    used.bars = true;
    const gg = S('g', { class: 'ad-bars' + (narrow ? ' ad-bars--narrow' : '') }, g);
    const lw = narrow ? 0 : (o.labelW != null ? o.labelW : 15) * U, tw = narrow ? 0 : (o.totalW != null ? o.totalW : 11) * U;
    const x0 = r.x + 12 + lw, W = r.w - 24 - lw - tw, y0 = r.y + r.h - lay.H + 18;
    const maxV = Math.max(...D.rows.map((x) => x.total), ...D.lines.map((ln) => ln.v)) * 1.04 || 1;
    const X = (v) => x0 + W * v / maxV;
    const yEnd = y0 + lay.yEndRel;
    // líneas de referencia (detrás de las barras y de los textos, que llevan halo) con su rótulo arriba; en angosto, solo sobre
    // las barras (los rótulos de las filas van entre ellas)
    D.lines.forEach((ln) => {
      const d = narrow ? lay.rows.map((L) => 'M' + P([X(ln.v), y0 + L.off + L.barY - 1.5]) + 'V' + r1(y0 + L.off + L.barY + BAR_BH + 1.5)).join('') : 'M' + P([X(ln.v), y0 - 5]) + 'V' + r1(yEnd + 3);
      S('path', { d, class: 'ad-bars-line' }, gg);
      txt(gg, X(ln.v), y0 - 8, ln.label || barsFmt(o.unit)(ln.v), 'ad-bars-ltxt', 'middle');
    });
    // texto con fondo (y halo en CSS): las líneas rojas pasan por detrás sin cortar ningún carácter
    const bgTxt = (x, y, s, cls, anchor, px, mono) => {
      const w = textW(s, px, mono) + 6, x1 = anchor === 'end' ? x - w + 3 : x - 3;
      S('rect', { x: r1(x1), y: r1(y - px - 0.5), width: r1(w), height: r1(px + 5), class: 'ad-bars-txtbg' }, gg);
      return txt(gg, x, y, s, cls, anchor);
    };
    D.rows.forEach((row, i) => {
      const L = lay.rows[i], y = y0 + L.off, by = y + L.barY;
      const isCur = row.row.config ? row.row.config === cur && !row.row.ov : !row.row.ov;
      bgTxt(r.x + 12, y + L.labY, qText(row.row.label || '', ctl, spec, row.row.config || null), 'ad-bars-lab' + (isCur ? ' is-cur' : ''), null, 11, false);
      let x = x0;
      row.segs.forEach((sg) => {
        const w = W * sg.v / maxV;
        if (sg.v > 0) {
          S('rect', { x: r1(x), y: r1(by), width: r1(Math.max(1.5, w)), height: BAR_BH, class: barsCls(sg) }, gg);
          if (sg.fz) { used.frozenBarHatch = true; S('rect', { x: r1(x), y: r1(by), width: r1(Math.max(1.5, w)), height: BAR_BH, class: 'ad-frozen-hatch', fill: frozenBarFill(gg, ctl) }, gg); }
        }
        x += w;
      });
      // fase 11 (revisión): bars.curFrameMin = px: una barra más angosta no lleva el marco grueso de la fila dibujada (la tapaba
      // de negro: HNSW e IVF-PQ en "Distancias por query" de ann-costs); la fila sigue resaltada por el rótulo y el total
      const fw = X(row.total) - x0;
      S('rect', { x: r1(x0), y: r1(by), width: r1(Math.max(1.5, fw)), height: BAR_BH, class: 'ad-bars-frame' + (isCur && fw >= (o.curFrameMin || 0) ? ' is-cur' : '') }, gg);
      // total a la derecha de la barra (en angosto: a la derecha del rótulo, o debajo de la barra); con fits, la GPU más chica
      // de las líneas en la que entra (o que no entra en ninguna)
      const vc = 'ad-bars-val' + (isCur ? ' is-cur' : '');
      if (!narrow) bgTxt(X(row.total) + 6, y + L.valY, L.val, vc, null, 10.5, true);
      else if (L.valInline) bgTxt(x0 + W, y + L.labY, L.val, vc, 'end', 10.5, true);
      else bgTxt(x0, y + L.valY, L.val, vc, null, 10.5, true);
      L.subs.forEach((sl, k) => bgTxt(r.x + 12, y + L.subY + 12 * k, sl, 'ad-bars-sub', null, 10, false));
    });
    // leyenda de los tramos (fluye en filas); legend:false = sin leyenda (filas con sus propios tramos, ya rotuladas)
    let lx = r.x + 12, ly = yEnd + (o.legend === false ? 4 : 18);
    (o.legend === false ? [] : o.segs || []).forEach((sg) => {
      const label = qText(String(sg.label || ''), ctl, spec), iw = 14 + textW(label, 10.5, false) + 14;
      if (lx > r.x + 12 && lx + iw > r.x + r.w - 12) { lx = r.x + 12; ly += 14; }
      S('rect', { x: r1(lx), y: r1(ly - 8.5), width: 9, height: 9, class: barsCls(sg) }, gg);
      if (sg.frozen === true) S('rect', { x: r1(lx), y: r1(ly - 8.5), width: 9, height: 9, class: 'ad-frozen-hatch', fill: frozenBarFill(gg, ctl) }, gg);
      txt(gg, lx + 13, ly, label, 'ad-cs-lab');
      lx += iw;
    });
    lay.capLines.forEach((ln, i) => txt(gg, r.x + 12, ly + 14 + i * 14, ln, 'ad-gqa-cap'));
  }
  // en palabras (aria y texto alternativo): fila: total (tramos)
  function barsWords(o, run, ctl, spec) {
    const D = barsData(o, run, (ctl.opts && ctl.opts.config) || (spec && spec.config));
    if (!D.rows.length || !D.rows.every((x) => x.ok)) return '';
    const f = barsFmt(o.unit);
    return D.rows.map((x) => plainSub(qText(x.row.label || '', ctl, spec, x.row.config || null)) + (x.row.sub ? ' (' + plainSub(qText(x.row.sub, ctl, spec, x.row.config || null)) + ')' : '') + ': ' + f(x.total) + ' (' + x.segs.filter((s) => s.v > 0).map((s) => plainSub(qText(String(s.label || ''), ctl, spec)) + ' ' + f(s.v)).join(', ') + ')').join('; ');
  }

  // node.matrix = {rows:<clave o número>, cols:<clave o número>, ref:<clave o número>, px?:44}: la matriz de pesos del bloque A
  // ESCALA (lineal: ref = px), abajo, con su forma "filas×columnas" al lado. La misma ref en W, A y B de LoRA: W se ve cuadrada y
  // A (r × d_in) y B (d_out × r) como tiras finas (mínimo 2.5 px): el cuello de rango r a la vista.
  const MAT_H = (o) => (o.px || 44) + 12;
  // fase 10 (revisión): un lado que no llega a 2.5 px se dibuja con 2.5 px y borde punteado (is-clamped: "no a escala"; a escala,
  // la tira de A con r = 16 mediría 0.25 px); en la práctica no lleva el texto "filas×columnas" (delataba d_out, la mitad de un
  // hueco de forma). label:false = sin texto.
  const MAT_MIN = 2.5;
  function drawMatrix(g, o, r, run, used, ctl) {
    const R = numKey(run, o.rows), C = numKey(run, o.cols), ref = numKey(run, o.ref) || Math.max(R, C);
    if (!(R > 0 && C > 0 && ref > 0)) return;
    used.matrix = true;
    const px = o.px || 44, w0 = px * C / ref, h0 = px * R / ref, w = Math.max(MAT_MIN, w0), h = Math.max(MAT_MIN, h0);
    const clamped = w0 < MAT_MIN || h0 < MAT_MIN;
    if (clamped) used.matrixClamped = true;
    const lab = o.label === false || (ctl && ctl.mode === 'blank') ? '' : fint(R) + '×' + fint(C);
    const tw = lab ? textW(lab, 10, true) : 0;
    const tot = w + (lab ? 8 + tw : 0), x = r.x + (r.w - tot) / 2, yb = r.y + r.h - 8;
    const gg = S('g', { class: 'ad-mat' }, g);
    S('rect', { x: r1(x), y: r1(yb - h), width: r1(w), height: r1(h), class: 'ad-mat-box' + (clamped ? ' is-clamped' : '') }, gg);
    if (lab) txt(gg, x + w + 8, yb - Math.min(h, px) / 2 + 3.5, lab, 'ad-mat-txt');
  }

  // node.adapter = {ops:[ids] | key:'cfg.X', has:'q', label?}: el adaptador LoRA (B·A, entrenable) sobre una lineal congelada.
  // Encendido si el calculador tiene esas ops con parámetros en la corrida dibujada (o si la clave contiene `has`): una píldora
  // verde "+ B·A" con sus parámetros por capa (del calculador) abajo a la derecha, sobre el borde. Apagado: una píldora tenue
  // "sin adaptador". Así cada config (targets qv / attn / all) enciende lo suyo.
  function adapterState(run, o) {
    if (!run || !o) return { on: false, params: 0 };
    if (o.ops) {
      const ids = [].concat(o.ops);
      const ops = run.ops.filter((x) => ids.indexOf(x.id) >= 0 && (!o.scope || (x.path && x.path.indexOf(o.scope) >= 0)));
      const params = ops.reduce((a, x) => a + (x.params || 0), 0);
      return { on: params > 0, params };
    }
    const parts = String(o.key || '').split('.'), ns = parts[0], rest = parts.slice(1).join('.');
    const src = ns === 'cfg' ? run.config : ns === 'metrics' ? metricsOf(run) : null;
    const v = src ? cfgPath(src, rest) : undefined;
    const on = Array.isArray(v) ? v.indexOf(o.has) >= 0 : typeof v === 'string' ? (o.in ? [].concat(o.in).indexOf(v) >= 0 : v === o.has) : !!(v && o.has && v[o.has]);
    return { on, params: 0 };
  }
  function drawAdapter(g, n, r, run, used, ctl) {
    const st = adapterState(run, n.adapter);
    const on = st.on;
    used[on ? 'adapterOn' : 'adapterOff'] = true;
    const s = on ? (n.adapter.label || '+ B·A') + (st.params ? ' ' + fsi(st.params) : '') : (n.adapter.offLabel || 'sin LoRA');
    const w = textW(s, 10, true) + (on ? 24 : 12), x = r.x + r.w - w - 4, y = r.y + r.h - 7;
    const pg = S('g', { class: 'ad-adapter' + (on ? ' is-on' : ' is-off') }, g);
    S('rect', { x: r1(x), y, width: r1(w), height: 14, rx: 7, class: 'ad-adapter-bg' }, pg);
    if (on) trainIcon(pg, false, x + 9, y + 7);
    txt(pg, on ? x + 17 : x + w / 2, y + 10.4, s, 'ad-adapter-txt', on ? null : 'middle');
    return st;
  }

  // ------------------------------------------------------------ fase 11 (BERT / retrieval / ANN): tokens, celdas, grafo por capas
  // node.tokens = {items:[{t, seg?:0|1, mask?:true, special?:true}], caption?}: una fila de tokens de EJEMPLO (texto literal, no
  // del calculador) en la parte de abajo del bloque: chip por token ([MASK] resaltado, [CLS]/[SEP] atenuados) y una barra fina
  // con el segmento (A / B: la tabla de token-type de BERT). Si no entran, la fila se achica (hasta 70 %) y luego corta con "…".
  const TOK_H = (o) => 30 + (o && o.caption ? 13 : 0);
  // fase 11 (revisión): it.rand = 'palabra' (elegido y cambiado por una palabra al azar: se dibuja esa palabra en naranja) e
  // it.keep = true (elegido y sin cambio: borde verde punteado), la regla 80 / 10 / 10 en el dibujo y no solo en el texto
  function tokLab(it) { return it.mask ? '[MASK]' : it.rand ? String(it.rand) : String(it.t); }
  function drawTokens(g, o, r, used, ctl, spec) {
    const items = (o.items || []).slice();
    if (!items.length) return;
    used.tokens = true;
    if (items.some((it) => it.mask)) used.tokMask = true;
    if (items.some((it) => it.rand)) used.tokRand = true;
    if (items.some((it) => it.keep)) used.tokKeep = true;
    if (items.some((it) => it.seg === 1)) used.tokSeg = true;
    if (items.some((it) => it.sent)) used.tokSent = true;
    if (items.some((it) => it.drop)) used.tokDrop = true;
    const gg = S('g', { class: 'ad-toks' }, g);
    const x0 = r.x + 8, W = r.w - 16, y = r.y + r.h - TOK_H(o) + 3, h = 15, gap = 3;
    let k = 1, list = items;
    const widths = (L, kk) => L.map((it) => (it.ell ? 12 : textW(tokLab(it), 10 * kk, true) + 8 * kk));
    const total = (L, kk) => widths(L, kk).reduce((a, b) => a + b, 0) + gap * (L.length - 1);
    if (total(list, 1) > W) k = Math.max(0.7, W / total(list, 1));
    // si aún no entra: se quitan tokens comunes cerca del medio (nunca [CLS], [SEP] ni [MASK]) y queda un "…" en su lugar
    while (total(list, k) > W && list.filter((it) => !it.ell).length > 3) {
      const mid = list.length / 2;
      const cand = list.map((it, j) => j).filter((j) => !list[j].ell && !list[j].special && !list[j].mask && !list[j].rand && !list[j].keep && !list[j].sent && !list[j].drop).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      if (!cand.length) break;
      const i = cand[0];
      if ((list[i - 1] && list[i - 1].ell) || (list[i + 1] && list[i + 1].ell)) list.splice(i, 1);
      else list.splice(i, 1, { ell: true });
    }
    const ws = widths(list, k);
    let x = x0 + (W - total(list, k)) / 2;
    list.forEach((it, i) => {
      const w = ws[i];
      if (it.ell) { txt(gg, x + w / 2, y + 11, '…', 'ad-tok-txt', 'middle'); x += w + gap; return; }
      const seg = it.seg === 1 ? 1 : 0;
      // fase 12: it.sent = centinela de span corruption (T5: <X>, <Y>…; color por it.k), it.drop = token de un tramo corrompido
      const sk = it.sent || it.drop ? ' is-k' + ((it.k || 0) % 6) : '';
      S('rect', { x: r1(x), y: r1(y), width: r1(w), height: h, rx: 2.5, class: 'ad-tok is-seg' + seg + (it.mask ? ' is-mask' : '') + (it.rand ? ' is-rand' : '') + (it.keep ? ' is-keep' : '') + (it.special ? ' is-special' : '') + (it.sent ? ' is-sent' + sk : '') + (it.drop ? ' is-drop' + sk : '') }, gg);
      const tt = txt(gg, x + w / 2, y + 10.8, tokLab(it), 'ad-tok-txt' + (it.special ? ' is-special' : '') + (it.mask ? ' is-mask' : '') + (it.sent ? ' is-sent' : '') + (it.drop ? ' is-drop' : ''), 'middle');
      if (k < 1) tt.setAttribute('style', 'font-size:' + r1(10 * k) + 'px');
      if (used.tokSeg) S('rect', { x: r1(x), y: r1(y + h + 2), width: r1(w), height: 2.5, class: 'ad-tok-seg is-seg' + seg }, gg);
      x += w + gap;
    });
    if (o.caption && ctl.mode !== 'blank' && !ctl.quiz) txt(gg, r.x + r.w / 2, y + h + 15, qText(o.caption, ctl, spec), 'ad-gqa-cap', 'middle');
  }
  function tokensWords(o) { return 'tokens de ejemplo: ' + (o.items || []).map((it) => tokLab(it) + (it.rand ? ' (al azar, era ' + it.t + ')' : it.keep ? ' (elegido, sin cambio)' : it.sent ? ' (centinela)' : it.drop ? ' (tramo corrompido)' : '')).join(' '); }

  // ------------------------------------------------------------ fase 12 (Whisper): onda de audio y espectrograma log-Mel
  // node.wave = {pad: fracción del ancho que es relleno con ceros (30 s), seed}: una onda sintética en la parte de abajo del
  // bloque y, a la derecha, el relleno (línea plana con marco punteado). Ilustrativa: no sale del calculador.
  const WAVE_H = 28;
  function drawWave(g, o, r, used) {
    used.wave = true;
    const gg = S('g', { class: 'ad-wave' }, g);
    const x0 = r.x + 8, W = r.w - 16, h = 18, y = r.y + r.h - WAVE_H + 3, mid = y + h / 2;
    const pad = Math.max(0, Math.min(0.9, o.pad || 0)), xs = x0 + W * (1 - pad);
    const rng = (ATLAS.Viz && ATLAS.Viz.rng) ? ATLAS.Viz.rng(o.seed || 30) : Math.random;
    // envolvente por "sílabas" (arcos de 10–22 px separados por pausas cortas) con ruido por muestra
    let d = '', sx = x0, sw = 10 + 12 * rng(), peak = 0.55 + 0.45 * rng();
    for (let x = x0; x < xs; x += 1.5) {
      if (x > sx + sw) { sx = x + 2 + 5 * rng(); sw = 10 + 12 * rng(); peak = 0.55 + 0.45 * rng(); }
      const u = (x - sx) / sw, env = x < sx ? 0.06 : Math.max(0.06, Math.sin(Math.PI * Math.min(1, u)) * peak);
      const a = env * (0.55 + 0.45 * rng()) * h / 2;
      d += 'M' + r1(x) + ' ' + r1(mid - a) + 'V' + r1(mid + a);
    }
    S('path', { d, class: 'ad-wave-ln' }, gg);
    if (pad > 0) {
      S('rect', { x: r1(xs), y: r1(y), width: r1(x0 + W - xs), height: h, class: 'ad-wave-pad' }, gg);
      S('path', { d: 'M' + r1(xs) + ' ' + r1(mid) + 'H' + r1(x0 + W), class: 'ad-wave-flat' }, gg);
    }
  }
  // node.melGrid = {rows, cols, pad, seed}: espectrograma chico (filas = bandas mel, graves abajo; columnas = frames) con tono
  // ILUSTRATIVO; la parte de relleno (pad) va vacía. Las cuentas reales (n_mels × 3,000) están en las formas de las aristas.
  const MEL_H = (o) => ((o && o.rows) || 8) * 3 + 8;
  function drawMelGrid(g, o, r, used) {
    used.melGrid = true;
    const gg = S('g', { class: 'ad-melg' }, g);
    const rows = o.rows || 8, cols = o.cols || 40, cs = 3, x0 = r.x + 8, W = r.w - 16, cw = W / cols, y0 = r.y + r.h - MEL_H(o) + 3;
    const pad = Math.max(0, Math.min(0.9, o.pad || 0)), live = Math.round(cols * (1 - pad));
    const rng = (ATLAS.Viz && ATLAS.Viz.rng) ? ATLAS.Viz.rng(o.seed || 80) : Math.random;
    S('rect', { x: r1(x0), y: r1(y0), width: r1(W), height: rows * cs, class: 'ad-melg-bg' }, gg);
    for (let c = 0; c < live; c++) {
      const on = rng() < 0.82, f = 0.3 + 0.7 * rng();
      for (let k = 0; k < rows; k++) {
        const v = on ? Math.max(0, Math.min(1, f * (1 - k / rows * 0.75) * (0.55 + 0.45 * rng()))) : 0.05 * rng();
        if (v > 0.06) S('rect', { x: r1(x0 + c * cw), y: r1(y0 + (rows - 1 - k) * cs), width: r1(cw + 0.2), height: cs, class: 'ad-melg-cell', style: 'fill-opacity:' + r1(v * 10) / 10 }, gg);
      }
    }
    if (pad > 0) S('rect', { x: r1(x0 + live * cw), y: r1(y0), width: r1(W - live * cw), height: rows * cs, class: 'ad-wave-pad' }, gg);
  }

  // node.cells = {rows, cols (claves o números), maxR?:6, maxC?:12, mark:'rowmax'|'pick'|'rows'|'none', lit?:<clave o número>,
  //   sum?:texto, label?, caption?, seed?, cell?:9}: una tabla chica (filas × columnas, recortada a maxR × maxC con "…" y con la
  //   cuenta real en label/caption) en la parte de abajo del bloque. El tono de cada celda es ILUSTRATIVO (semilla fija): lo que
  //   dice la tabla es su forma y la marca: rowmax = el máximo de cada fila (MaxSim de ColBERT; sum = columna con los máximos y su
  //   suma), pick = una celda leída por fila (la tabla ADC: el código de cada sub-cuantizador), rows = las primeras `lit` filas
  //   resaltadas (las nprobe listas que se recorren). En la práctica no lleva label ni caption (darían la forma de un hueco).
  function cellsDims(o, run) {
    const R = numKey(run, o.rows), C = numKey(run, o.cols);
    if (!(R > 0 && C > 0)) return null;
    const maxR = o.maxR || 6, maxC = o.maxC || 12, cs = o.cell || 9;
    const nR = Math.min(R, maxR), nC = Math.min(C, maxC);
    return { R, C, nR, nC, cs, moreR: R > maxR, moreC: C > maxC };
  }
  const CELLS_TOP = (o) => (o.label ? (o.sum ? 28 : 16) : (o.sum ? 14 : 6));
  const CELLS_H = (o, run) => { const d = cellsDims(o, run); if (!d) return 0; return CELLS_TOP(o) + (d.nR + (d.moreR ? 1 : 0)) * d.cs + (o.sum ? 14 : 0) + (o.caption ? 15 : 0) + 6; };
  function drawCells(g, o, r, run, used, ctl, spec) {
    const d = cellsDims(o, run);
    if (!d) return;
    const mark = o.mark || 'none';
    if (mark === 'rows') used.cellsRows = true; else used.cells = true;
    const quiet = ctl.mode === 'blank' || ctl.quiz;
    const gg = S('g', { class: 'ad-cells' }, g);
    const rng = (ATLAS.Viz && ATLAS.Viz.rng) ? ATLAS.Viz.rng(o.seed || 11) : Math.random;
    const cs = d.cs, rowsDrawn = d.nR + (d.moreR ? 1 : 0), colsDrawn = d.nC + (d.moreC ? 1 : 0);
    const sumW = mark === 'rowmax' && o.sum ? cs + 10 : 0;
    const gw = colsDrawn * cs + sumW;
    const x0 = r.x + (r.w - gw) / 2, y0 = r.y + r.h - CELLS_H(o, run) + CELLS_TOP(o);
    if (o.label && !quiet) txt(gg, r.x + r.w / 2, y0 - (o.sum ? 17 : 5), qText(o.label, ctl, spec), 'ad-cells-lab', 'middle');
    const lit = mark === 'rows' ? Math.min(numKey(run, o.lit) || 0, d.nR) : 0;
    // fase 11 (revisión): litRows = las filas dibujadas resaltadas, sueltas (las n_probe listas están donde caen los centroides
    // más cercanos, no arriba de todo)
    const litSet = mark === 'rows' && Array.isArray(o.litRows) ? new Set(o.litRows.filter((i) => i < d.nR)) : null;
    const isLit = (i) => (litSet ? litSet.has(i) : i < lit);
    const vals = [];
    for (let i = 0; i < rowsDrawn; i++) {
      const isMoreR = d.moreR && i === d.nR;
      const yy = y0 + i * cs;
      if (isMoreR) { txt(gg, x0 + (d.nC * cs) / 2, yy + cs - 1, '⋮', 'ad-cells-ell', 'middle'); continue; }
      const row = [];
      for (let j = 0; j < d.nC; j++) row.push(rng());
      vals.push(row);
      const best = row.indexOf(Math.max(...row)), pick = Math.floor(rng() * d.nC);
      for (let j = 0; j < colsDrawn; j++) {
        const xx = x0 + j * cs;
        if (d.moreC && j === d.nC) { txt(gg, xx + cs / 2, yy + cs - 2, '…', 'ad-cells-ell', 'middle'); continue; }
        if (mark === 'rows') S('rect', { x: r1(xx + 0.5), y: r1(yy + 1.5), width: r1(cs - 1), height: r1(cs - 3), class: 'ad-cell-row' + (isLit(i) ? ' is-lit' : '') }, gg);
        else S('rect', { x: r1(xx + 0.5), y: r1(yy + 0.5), width: r1(cs - 1), height: r1(cs - 1), class: 'ad-cell', style: 'fill-opacity:' + (Math.round((0.12 + 0.75 * row[j]) * 100) / 100) }, gg);
        if ((mark === 'rowmax' && j === best) || (mark === 'pick' && j === pick)) S('rect', { x: r1(xx - 0.5), y: r1(yy - 0.5), width: r1(cs + 1), height: r1(cs + 1), class: 'ad-cell-mark' }, gg);
      }
      if (sumW) {
        const xs = x0 + colsDrawn * cs + 10;
        S('rect', { x: r1(xs + 0.5), y: r1(yy + 0.5), width: r1(cs - 1), height: r1(cs - 1), class: 'ad-cell is-max', style: 'fill-opacity:' + (Math.round((0.12 + 0.75 * row[best]) * 100) / 100) }, gg);
      }
    }
    if (sumW) {
      const xs = x0 + colsDrawn * cs + 10, yb = y0 + rowsDrawn * cs;
      txt(gg, xs + cs / 2, y0 - 5, 'máx', 'ad-cells-ell', 'middle');
      if (!quiet) txt(gg, xs + cs / 2, yb + 11, String(o.sum), 'ad-cells-sum', 'middle');
    }
    if (o.caption && !quiet) txt(gg, r.x + r.w / 2, y0 + rowsDrawn * cs + (sumW ? 14 : 0) + 12, qText(o.caption, ctl, spec), 'ad-gqa-cap', 'middle');
  }
  function cellsWords(o, run, ctl, spec) {
    const d = cellsDims(o, run);
    if (!d) return '';
    const quiet = ctl.mode === 'blank' || ctl.quiz;
    const what = o.mark === 'rowmax' ? 'el máximo de cada fila marcado' + (o.sum ? ' y sumado' : '') : o.mark === 'pick' ? 'una celda leída por fila' : o.mark === 'rows' ? 'filas resaltadas: las que se recorren' : '';
    return 'tabla' + (quiet ? '' : ' de ' + fint(d.R) + ' × ' + fint(d.C)) + (what ? ', ' + what : '') + ' (tono ilustrativo)' + (o.caption && !quiet ? ': ' + plainSub(qText(o.caption, ctl, spec)) : '');
  }

  // node.layered = {levels:[{n, label?}, …] (de arriba abajo), seed?}: pictograma de un grafo por capas (HNSW): una lámina por capa
  // con n puntos (los de arriba son un subconjunto de los de abajo), enlaces a los vecinos más cercanos de esa capa, la ruta
  // codiciosa resaltada (de la entrada arriba hacia la consulta, bajando por el mismo punto) y la consulta (rombo) abajo, con su
  // misma posición tenue en las capas de arriba. Todo ILUSTRATIVO (pocos puntos); los rótulos pueden llevar {{…}} del calculador.
  // fase 11 (revisión): distancias, vecinos y ruta se miden en el espacio DIBUJADO (la lámina es ~10× más ancha que alta y va
  // sesgada): así cada salto de la ruta acerca el punto al rombo en pantalla. Puntos con separación mínima (dardos con semilla),
  // enlaces no dirigidos (cada enlace que usa la ruta está dibujado) y rótulos a la izquierda, bajo cada lámina.
  const LAY_STEP = 46, LAY_SK = 14, LAY_PH = 32;
  const LAYERED_H = (o) => ((o && o.levels) || []).length * LAY_STEP + 6;
  function layeredGeom(o, W) {
    const levels = o.levels || [], L = levels.length;
    const rng = (ATLAS.Viz && ATLAS.Viz.rng) ? ATLAS.Viz.rng(o.seed || 5) : Math.random;
    const nBottom = levels.length ? levels[L - 1].n : 0;
    const AX = (W || 312) - LAY_SK;
    const proj = (p) => [LAY_SK * (1 - p[1]) + p[0] * AX, p[1] * LAY_PH];
    const dist = (a, b) => { const A = proj(a), B = proj(b); return Math.hypot(A[0] - B[0], A[1] - B[1]); };
    const q = o.query || [0.78, 0.62];
    const pts = [];
    for (let i = 0; i < nBottom; i++) {
      let best = null, bd = -1;
      for (let t = 0; t < 60; t++) {
        const c = [0.06 + 0.88 * rng(), 0.12 + 0.76 * rng()];
        const md = Math.min(dist(c, q) - 3, ...pts.map((p) => dist(c, p)));
        if (md > bd) { bd = md; best = c; }
        if (md >= 11) break;
      }
      pts.push(best);
    }
    // capa i (0 = arriba) = los primeros n_i puntos (anidadas, como en HNSW)
    const sets = levels.map((lv) => pts.slice(0, Math.min(lv.n, nBottom)).map((p, j) => j));
    const adj = sets.map((ids) => {
      const A = new Map(ids.map((j) => [j, new Set()]));
      ids.forEach((j) => ids.filter((x) => x !== j).sort((a, b) => dist(pts[a], pts[j]) - dist(pts[b], pts[j])).slice(0, Math.min(3, ids.length - 1)).forEach((e) => { A.get(j).add(e); A.get(e).add(j); }));
      return A;
    });
    // ruta codiciosa: en cada capa, saltar al vecino más cercano a q hasta no mejorar
    const path = [];
    let cur = 0;
    sets.forEach((ids, li) => {
      const seg = [cur];
      for (let it = 0; it < 30; it++) {
        const best = [...(adj[li].get(cur) || [])].reduce((b, x) => (dist(pts[x], q) < dist(pts[b], q) ? x : b), cur);
        if (best === cur) break;
        cur = best; seg.push(cur);
      }
      path.push(seg);
    });
    return { levels, pts, q, sets, adj, path };
  }
  function drawLayered(g, o, r, used, ctl, spec) {
    const x0 = r.x + 12, W = r.w - 24, sk = LAY_SK, ph = LAY_PH;
    const G = layeredGeom(o, W);
    if (!G.levels.length) return;
    used.layered = true;
    const gg = S('g', { class: 'ad-layered' }, g);
    const yTop = r.y + r.h - LAYERED_H(o) + 4;
    const Q = (li, p) => { const yy = yTop + li * LAY_STEP; return [x0 + sk * (1 - p[1]) + p[0] * (W - sk), yy + p[1] * ph]; };
    const diamond = (p, k) => 'M' + P([p[0] - k, p[1]]) + 'L' + P([p[0], p[1] - k]) + 'L' + P([p[0] + k, p[1]]) + 'L' + P([p[0], p[1] + k]) + 'Z';
    const last = G.levels.length - 1;
    G.levels.forEach((lv, li) => {
      const yy = yTop + li * LAY_STEP;
      S('path', { d: 'M' + r1(x0 + sk) + ' ' + r1(yy) + 'H' + r1(x0 + W) + 'L' + r1(x0 + W - sk) + ' ' + r1(yy + ph) + 'H' + r1(x0) + 'Z', class: 'ad-lay-plane' }, gg);
      let d = '';
      G.adj[li].forEach((nbs, j) => nbs.forEach((e) => { if (e > j) d += 'M' + P(Q(li, G.pts[j])) + 'L' + P(Q(li, G.pts[e])); }));
      if (d) S('path', { d, class: 'ad-lay-edge' }, gg);
      // la posición de q en las capas de arriba (tenue): "más cerca de q" se lee en cada lámina
      if (li < last) S('path', { d: diamond(Q(li, G.q), 4), class: 'ad-lay-q is-ghost' }, gg);
    });
    // verticales punteadas: el mismo nodo baja de capa
    for (let li = 0; li < last; li++) {
      const j = G.path[li][G.path[li].length - 1], a = Q(li, G.pts[j]), b = Q(li + 1, G.pts[j]);
      S('path', { d: 'M' + P(a) + 'L' + P(b), class: 'ad-lay-drop' }, gg);
    }
    G.levels.forEach((lv, li) => {
      const seg = G.path[li];
      if (seg.length > 1) S('path', { d: seg.map((j, k) => (k ? 'L' : 'M') + P(Q(li, G.pts[j]))).join(''), class: 'ad-lay-path' }, gg);
      G.sets[li].forEach((j) => { const p = Q(li, G.pts[j]); S('circle', { cx: r1(p[0]), cy: r1(p[1]), r: seg.indexOf(j) >= 0 ? 2.8 : 2, class: 'ad-lay-pt' + (seg.indexOf(j) >= 0 ? ' is-on' : '') }, gg); });
      if (li === 0) { const p = Q(0, G.pts[0]); S('circle', { cx: r1(p[0]), cy: r1(p[1]), r: 5, class: 'ad-lay-ep' }, gg); }
      if (lv.label && !(ctl.mode === 'blank' || ctl.quiz)) txt(gg, x0 + 2, yTop + li * LAY_STEP + ph + 11, qText(lv.label, ctl, spec), 'ad-lay-lab');
    });
    S('path', { d: diamond(Q(last, G.q), 5), class: 'ad-lay-q' }, gg);
  }
  function layeredWords(o, ctl, spec) {
    const lv = o.levels || [];
    return 'grafo por capas, ilustrativo: ' + lv.map((x, i) => (x.label && !(ctl.mode === 'blank' || ctl.quiz) ? plainSub(qText(x.label, ctl, spec)) : 'capa ' + (lv.length - 1 - i)) + ' (' + x.n + ' puntos dibujados)').join(', ') + (ctl.mode === 'blank' || ctl.quiz ? '' : '; la búsqueda baja codiciosa desde la entrada de arriba');
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
    g.setAttribute('aria-label', label + (state === 'ready' ? ' — listo' : state === 'anchor' ? ' — lo que ya sabes' : state === 'card' ? ' — tarjeta de nivel 1' : ' — próximamente' + (it && it.phase ? ' (fase ' + it.phase + ')' : '')));
    return g;
  }

  // Práctica: si un hueco pide la forma de un tensor, se ocultan las formas iguales de las aristas vecinas
  // (las que comparten un nodo con la del hueco), que si no darían la respuesta.
  function blankGiveaways(ctl, spec, run) {
    const out = new Set();
    out.nums = new Set();
    out.tensors = new Set();   // fase 11: tensores cuya forma delata un hueco (blankHide): tampoco van en el aria de sus nodos
    if (ctl.mode !== 'blank' || !run) return out;
    const edges = spec.edges || [];
    const num = (e) => { const er = edgeRun(run, e); return e.tensor && er.tensors[e.tensor] ? er.tensors[e.tensor].num.join('×') : null; };
    for (const sid in ctl.slots) {
      const sl = ctl.slots[sid];
      if (!sl || sl.ask !== 'shape') continue;
      const hits = edges.filter((e) => e.tensor && (sid === edgeKey(e) || sid === edgeKey(e) + '@' + e.tensor || sid === 'tensor:' + e.tensor) && (!sl.tensor || sl.tensor === e.tensor));
      // la forma pedida no puede aparecer en ninguna otra arista ni glifo de la vista (antes solo se
      // ocultaban las vecinas; en la cross-attention, la A de dos aristas más abajo la delataba)
      for (const h of hits) {
        const want = num(h);
        if (!want) continue;
        out.nums.add(want);
        for (const e of edges) if (e !== h && num(e) === want) out.add(edgeKey(e) + '@' + e.tensor);
        // fase 8: edge.blankHide = true | id de tensor | [ids]: la forma de esta arista se oculta cuando un hueco pide la forma
        // de ese tensor (true = cualquiera), porque da UN factor de la respuesta ("D 1152" y "256×32" delatan 256×1152)
        for (const e of edges) if (e !== h && e.tensor && e.blankHide && (e.blankHide === true || [].concat(e.blankHide).indexOf(h.tensor) >= 0)) { out.add(edgeKey(e) + '@' + e.tensor); out.tensors.add(e.tensor); }
      }
    }
    return out;
  }
  // fase 9 (revisión): en la práctica, un bloque con hueco de nombre o de tipo no se nombra en el aria de sus vecinos
  // (las aristas decían "(de Cámaras a SigLIP So400m/14)" con SigLIP en blanco)
  function nodeLabelOf(ctl, id) {
    if (ctl.mode === 'blank') { const sl = slotFor(ctl, id); if (sl && (sl.ask === 'label' || sl.ask === 'op')) return 'bloque con hueco'; }
    const sp = ctl.building || (ctl.view ? ctl.view.spec : null); const n = sp && (sp.nodes || []).find((x) => x.id === id); return n ? String(blankName(ctl, n) || id).replace(/\n/g, ' ') : id;
  }
  // fase 10 (revisión): node.blankLabel = el nombre del bloque en la práctica cuando el visible delata un hueco (el reward model
  // congelado de la etapa 3 nombraba al hueco del reward model de la etapa 2)
  function blankName(ctl, n) { return ctl.mode === 'blank' && n.blankLabel != null && !slotFor(ctl, n.id) ? n.blankLabel : n.label; }
  // fase 9 (revisión): en la práctica, ¿esta forma es la respuesta de un hueco (o la delata)? Entonces no va en el aria.
  function blankShapeHidden(ctl, t, key) {
    if (ctl.mode !== 'blank' || !ctl.blankHide || !t) return false;
    return ctl.blankHide.nums.has(t.num.join('×')) || (key != null && ctl.blankHide.has(key)) || !!(t.id && ctl.blankHide.tensors && ctl.blankHide.tensors.has(t.id));
  }
  function mapName(id) { const c = ATLAS.catalog && ATLAS.catalog(); const it = c && c.items && c.items[id]; return (it && (it.short || it.title)) || id; }

  function nodeAria(ctl, n, run) {
    const parts = [plainSub(blankName(ctl, n) || n.id)];
    if (n.sub) parts.push(plainSub(nodeSub(n, ctl)).replace(/\n/g, ' '));
    const io = nodeIO(ctl.cur(), n.id, run);
    const ioTxt = (ts) => ts.map((t) => (blankShapeHidden(ctl, t) ? 'forma oculta' : shapeText(t, 'num'))).join(', ');
    if (io.in.length) parts.push('entrada ' + ioTxt(io.in));
    if (io.out.length) parts.push('salida ' + ioTxt(io.out));
    if (n.kvGroups && run) { const w = gqaWords(run.config, n.kvGroups); if (w) parts.push(w.text); }
    if (n.experts && run) { const E = cfgPath(run.config, n.experts.n || 'nExperts'), K = cfgPath(run.config, n.experts.k || 'topK'); if (E) parts.push(K + ' de ' + E + ' expertos por token'); }
    if (n.train) parts.push(n.train === 'frozen' ? 'congelado' : 'entrena');
    if (n.style === 'closed') parts.push('caja negra: pesos cerrados');
    if (n.bins) parts.push((n.bins.n || 256) + ' bins');
    if (n.maskGrid) parts.push('máscara: ' + maskWords(n.maskGrid));
    // fase 10: barras (fuera de la práctica), adaptador LoRA y matriz a escala
    if (n.bars && run && ctl.mode !== 'blank' && !ctl.quiz) { const bw = barsWords(n.bars, run, ctl, ctl.building || (ctl.cur() ? ctl.cur().spec : {})); if (bw) parts.push(bw); }
    if (n.adapter && run) { const st = adapterState(run, n.adapter); parts.push(st.on ? 'con adaptador LoRA entrenable' + (st.params ? ' (' + fint(st.params) + ' parámetros por capa)' : '') : 'sin adaptador con esta config'); }
    if (n.matrix && run && ctl.mode !== 'blank') { const R = numKey(run, n.matrix.rows), C = numKey(run, n.matrix.cols); if (R && C) parts.push('matriz ' + fint(R) + '×' + fint(C)); }
    // fase 11: tokens de ejemplo, tabla de celdas (sin números en la práctica) y grafo por capas
    if (n.tokens) parts.push(tokensWords(n.tokens));
    if (n.cells && run) { const cw = cellsWords(n.cells, run, ctl, ctl.building || (ctl.cur() ? ctl.cur().spec : {})); if (cw) parts.push(cw); }
    if (n.layered) parts.push(layeredWords(n.layered, ctl, ctl.building || (ctl.cur() ? ctl.cur().spec : {})));
    if (n.strip && run) { const sg = stripSegs(n.strip, run); if (sg) parts.push('prompt: ' + sg.map((x) => (x.count === false ? '' : fint(x.v) + ' ') + (x.label || '')).join(' + ')); }
    if (n.layers && run) { const L = numKey(run, n.layers.L); const tp = tapOf(run, n.layers, L); if (L && tp) parts.push(layersNeutral(ctl, ctl.building || (ctl.cur() ? ctl.cur().spec : {}), n) ? L + ' capas' : 'features de la capa ' + tp + ' de ' + L); }
    if (n.expand) parts.push('se puede abrir');
    if (n.xref && n.xref.length) parts.push('con enlace a otra página');
    return parts.join('; ');
  }

  function nodeIO(view, nodeId, run) {
    const ins = [], outs = [];
    if (!run || !view) return { in: ins, out: outs };
    for (const e of view.spec.edges || []) {
      const er = edgeRun(run, e);
      if (!e.tensor || !er.tensors[e.tensor]) continue;
      if (e.to === nodeId && ins.indexOf(er.tensors[e.tensor]) < 0) ins.push(er.tensors[e.tensor]);
      if (e.from === nodeId && outs.indexOf(er.tensors[e.tensor]) < 0) outs.push(er.tensors[e.tensor]);
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
    if (sym === num) {   // forma sin símbolos (p. ej. 1 token): una sola línea, no "1 / 1"
      const tx1 = side === 'left' ? x - 7 : side === 'right' ? x + 7 : x;
      const y1 = side === 'above' ? y - 6 : side === 'below' ? y + 15 : y + 4;
      txt(g, tx1, y1, num, 'ad-shape-num', anchor).setAttribute('data-tensor', tensorId);
      return g;
    }
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
    // fase 10: edge.tagBlank = el tag en la práctica (false = sin tag): "log π_ref" junto al hueco de la referencia la nombraba
    const e = ctl.mode === 'blank' && ge.spec.tagBlank !== undefined ? Object.assign({}, ge.spec, { tag: ge.spec.tagBlank }) : ge.spec;
    if (!ge.pts.length) return null;
    const kind = ge.kind;
    // fase 11: edge.tie = pesos atados / compartidos (la tabla de palabras de BERT y el decoder del MLM; las dos torres de un
    // bi-encoder con pesos compartidos): línea de control propia, sin punta, con un punto en cada extremo; su entrada de leyenda
    if (e.tie) used.tie = true; else used.edges.add(kind);
    if (isMap && MAP_KINDS.indexOf(kind) >= 0) used.map.add(kind);
    const t = e.tensor && run ? edgeRun(run, e).tensors[e.tensor] : null;
    let slot = (e.tensor && slotFor(ctl, ge.key + '@' + e.tensor)) || slotFor(ctl, ge.key) || (e.tensor && slotFor(ctl, 'tensor:' + e.tensor));
    if (slot && slot.tensor && e.tensor && slot.tensor !== e.tensor) slot = null;   // aristas paralelas (q y k): solo la del tensor pedido
    const g = S('g', { class: 'ad-edge ad-edge--' + kind + (e.tie ? ' ad-edge--tie' : ''), 'data-edge': ge.key, 'data-kind': kind, 'data-tensor': e.tensor || null, 'data-ov': e.ov ? JSON.stringify(e.ov) : null, 'data-config': e.config || null,
      tabindex: (t || isMap) && ctl.mode !== 'blank' ? -1 : null, role: t ? 'button' : null }, L.edges);
    const headSize = kind === 'control' ? 5 : 7;
    let d;
    let headPts = ge.pts;
    if (ge.curve) {
      const cs = ge.curve, last = cs[cs.length - 1];
      const C2 = near(last[2][0], last[3][0]) && near(last[2][1], last[3][1]) ? last[1] : last[2], B = last[3];
      const L = Math.hypot(B[0] - C2[0], B[1] - C2[1]) || 1;
      const B2 = kind === 'contrasta' ? B : [B[0] - (B[0] - C2[0]) / L * (headSize - 1), B[1] - (B[1] - C2[1]) / L * (headSize - 1)];
      const path = (end) => 'M' + P(cs[0][0]) + cs.map((s, i) => 'C' + P(s[1]) + ' ' + P(s[2]) + ' ' + P(i === cs.length - 1 ? end : s[3])).join('');
      d = path(B2);
      S('path', { d: path(B), class: 'ad-hit' }, g);
      headPts = [C2, B];
    } else {
      d = roundedPath(e.tie ? ge.pts : shorten(ge.pts, headSize - 1), 8);
      S('path', { d: roundedPath(ge.pts, 8), class: 'ad-hit' }, g);  // área de toque
    }
    if (kind === 'cross') {
      S('path', { d, class: 'ad-ln ad-ln--cross-out' }, g);
      S('path', { d, class: 'ad-ln ad-ln--cross-in' }, g);
    } else S('path', { d, class: 'ad-ln' }, g);
    const hollow = kind === 'cross' || kind === 'usa';
    if (kind !== 'contrasta' && !e.tie) arrowHead(g, headPts, 'ad-head' + (hollow ? ' ad-head--hollow' : ''), headSize);
    if (e.tie) { const p0 = ge.pts[0], p1 = ge.pts[ge.pts.length - 1]; S('circle', { cx: r1(p0[0]), cy: r1(p0[1]), r: 3, class: 'ad-end' }, g); S('circle', { cx: r1(p1[0]), cy: r1(p1[1]), r: 3, class: 'ad-end' }, g); }
    if (kind === 'contrasta') { const p0 = ge.pts[0], p1 = ge.pts[ge.pts.length - 1]; S('circle', { cx: r1(p0[0]), cy: r1(p0[1]), r: 2.4, class: 'ad-end' }, g); S('circle', { cx: r1(p1[0]), cy: r1(p1[1]), r: 2.4, class: 'ad-end' }, g); }
    if (isMap) g.setAttribute('aria-label', (MAP_KIND_SENT[kind] ? MAP_KIND_SENT[kind](mapName(e.from), mapName(e.to)) : e.from + ' → ' + e.to) + (e.label ? ' (' + e.label + ')' : ''));
    // fase 9 (revisión): en la práctica, la arista con hueco de forma dice solo que es un hueco, y las que comparten esa forma
    // (o la delatan, blankHide) la callan: el lector de pantalla oía la respuesta ("Tokens visuales …, 256×4096")
    const fromTo = () => ' (de ' + plainSub(nodeLabelOf(ctl, e.from)) + ' a ' + plainSub(nodeLabelOf(ctl, e.to)) + ')';
    if (t && !isMap && ctl.mode === 'blank' && slot && slot.ask === 'shape') g.setAttribute('aria-label', 'Hueco: forma del tensor' + fromTo());
    // fase 10 (revisión): y si un extremo es un hueco de nombre o de tipo, la arista no dice qué tensor es (su descripción lo
    // nombraba: "ΔW·x = (α/r)·B·A·x" entre los huecos de A, B y la escala; "Referencia · log-probs…" saliendo del hueco)
    else if (t && !isMap && ctl.mode === 'blank' && [e.from, e.to].some((id) => { const sl = slotFor(ctl, id); return sl && (sl.ask === 'label' || sl.ask === 'op'); })) g.setAttribute('aria-label', 'Tensor' + (blankShapeHidden(ctl, t, ge.key + '@' + e.tensor) ? '' : ', ' + shapeText(t, 'num')) + fromTo());
    else if (t && !isMap) g.setAttribute('aria-label', (e.tag && e.tag !== 'K,V' ? plainSub(qText(e.tag, ctl, ctl.building)) + ': ' : '') + plainSub(t.label || e.tensor) + (blankShapeHidden(ctl, t, ge.key + '@' + e.tensor) ? '' : ', ' + shapeSay(t)) + fromTo());
    // arista de control con etiqueta (sin tensor): el lector de pantalla oye qué decide y entre qué bloques
    // fase 9: en una vista sin calculador (calc:false) las aristas de datos tampoco tienen tensor: también dicen su etiqueta
    if (!t && !isMap && (kind === 'control' || (ctl.building && ctl.building.calc === false)) && e.tag) { g.setAttribute('role', 'img'); g.setAttribute('aria-label', plainSub(qText(e.tag, ctl, ctl.building)) + (e.loop ? ', se repite' : '') + (e.tie ? ' (pesos compartidos entre ' + plainSub(nodeLabelOf(ctl, e.from)) + ' y ' : kind === 'control' ? ' (control, de ' + plainSub(nodeLabelOf(ctl, e.from)) + ' a ' : ' (flujo, de ' + plainSub(nodeLabelOf(ctl, e.from)) + ' a ') + plainSub(nodeLabelOf(ctl, e.to)) + ')'); }
    if (e.dot) { const dp = e.fromPt ? ge.pts[0] : ge.pts.length > 2 ? ge.pts[1] : ge.pts[0]; S('circle', { cx: r1(dp[0]), cy: r1(dp[1]), r: 2.8, class: 'ad-dot' }, g); }
    if ((kind === 'cross' || e.tag) && e.tag !== false) {   // tag:false = arista cross sin etiqueta (chips de texto de YOLO-World)
      const la = labelAnchor(ge.pts0 || ge.pts, Object.assign({}, e, { labelT: e.tagT == null ? 0.25 : e.tagT, labelSeg: e.tagSeg != null ? e.tagSeg : e.labelSeg, labelSide: e.tagSide && e.tagSide !== 'on' ? e.tagSide : null }));
      if (la) {
        const tg = S('g', { class: 'ad-tag' + (e.tagStyle === 'plain' ? ' ad-tag--plain' : '') }, L.labels);
        tg.setAttribute('data-edge-tag', ge.key);
        if (e.tensor) tg.setAttribute('data-tensor', e.tensor);
        // fase 8: el texto admite {{…}} del calculador ("× {{cfg.steps}} pasos"); loop:true = flecha circular delante (bucle)
        const s = e.tag ? qText(e.tag, ctl, ctl.building) : 'K,V';
        const li = e.loop ? 14 : 0;
        if (e.loop) used.loop = true;
        const tw = textW(s, e.tagStyle === 'plain' ? 11.5 : 10.5, true) + 8 + li;   // plain = 11.5 px en CSS
        // tagSide:'on' = la etiqueta va sobre la línea (nombra la arista); si no, al costado
        const off = e.tagSide === 'on' ? [0, 0] : la.vertical ? [-(tw / 2) - 8, 0] : [0, 12];
        S('rect', { x: r1(la.x + off[0] - tw / 2), y: r1(la.y + off[1] - 8), width: r1(tw), height: 15, rx: 3, class: 'ad-tag-bg' }, tg);
        if (e.loop) loopIcon(tg, la.x + off[0] - tw / 2 + 9, la.y + off[1] - 0.5, 4);
        txt(tg, la.x + off[0] + li / 2, la.y + off[1] + 3.5, s, 'ad-tag-txt', 'middle');
      }
    }
    // fase 8: una arista de control puede nombrar su tensor y mostrar la forma con shapeLabel:true (el vector de
    // condicionamiento c de DiT, 1152, que llega a cada bloque: es condicionamiento, no el flujo de datos)
    if (t && (SHAPED[kind] || (kind === 'control' && e.shapeLabel))) {
      const la = labelAnchor(ge.pts0 || ge.pts, e);   // pts0: la ruta antes de deckTrim (las etiquetas no se mueven)
      const tk = tensorAt[ge.key + '@' + e.tensor] || tensorAt[ge.key];
      const hide = ctl.hideShapes === true || (Array.isArray(ctl.hideShapes) && ctl.hideShapes.indexOf(e.tensor) >= 0) || (ctl.blankHide && ctl.blankHide.has(ge.key + '@' + e.tensor));
      if (slot) {
        drawEdgeSlot(ctl, g, ge, la, slot, e.tensor);
      } else if (la && !hide && e.label !== false) {
        let lx = la.x, ly = la.y;
        if (tk && tk.show !== 'label') {
          const gs = glyphSize(t, tk);
          let gx, gy;
          // con ejes (franja de filas a la izquierda del glifo) se separa un poco más de la línea
          if (la.side === 'right') { gx = la.x + (tk.axes ? 14 : 9); gy = la.y + gs.h / 2; lx = gx + gs.w; }
          else if (la.side === 'left') { gx = la.x - 9 - gs.w; gy = la.y + gs.h / 2; lx = gx; }
          else if (la.side === 'below') { gx = la.x - gs.w / 2; gy = la.y + 8 + gs.h; ly = gy; }
          else { gx = la.x - gs.w / 2; gy = la.y - 7; ly = gy - gs.h + 2; }
          // práctica: la marca de "CLS descartado" no va si el hueco pregunta por el bloque que lo descarta
          const mk = tk.mark === 'dropfirst' && (ctl.mode === 'blank' || ctl.quiz) && slotFor(ctl, e.from) ? null : tk.mark;
          if (mk === 'dropfirst') used.dropfirst = true;
          if (isJoint(drawGlyph(g, t, gx, gy, ctl.id, mk, tk))) used.joint = true;
          // la leyenda lista una modalidad solo si se dibuja un glifo (o una franja) de ella: las formas
          // escritas de las aristas no la muestran (fase 5: "queries aprendidas" sin ningún glifo azul)
          if (t.mod) used.mods.add(t.mod);
          used.glyph = true;
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
      // fase 8 (revisión): subíndices TeX en la leyenda ("Tiempo e_t") como <sub>, igual que en las etiquetas
      if (String(label).indexOf('_') >= 0) H('span', null, li, htmlSub(label)); else H('span', { text: label }, li);
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
      if (!used.mods.has(m.id) || !(used.glyph || used.strip || used.posIds)) continue;
      item((s) => {
        defs(s, lid + '-l' + m.id);
        const g = S('g', { class: 'ad-glyph ad-mod--' + m.id + (m.id === 'qry' ? ' ad-glyph--outline' : '') }, s);
        S('rect', { x: 3, y: 3, width: 20, height: 10, class: 'ad-face ad-face--front', fill: 'url(#' + lid + '-l' + m.id + '-tx-' + m.id + ')' }, g);
      }, 'Tensor: ' + m.title.toLowerCase());
    }
    if (used.joint) item((s) => { const g = S('g', { class: 'ad-glyph ad-mod--joint' }, s); S('rect', { x: 3, y: 3, width: 20, height: 10, class: 'ad-face ad-face--front', fill: 'var(--op-fuse-soft)' }, g); S('path', { d: 'M3 3L23 13', class: 'ad-matdiag' }, g); }, 'Tensor conjunto (lote B×B)');
    const ek = ATLAS.EDGE_KINDS || [];
    for (const k of ek) {
      if (!used.edges.has(k.id)) continue;
      item((s) => {
        const g = S('g', { class: 'ad-edge ad-edge--' + k.id }, s);
        if (k.id === 'cross') { S('path', { d: 'M2 8H20', class: 'ad-ln ad-ln--cross-out' }, g); S('path', { d: 'M2 8H20', class: 'ad-ln ad-ln--cross-in' }, g); }
        else S('path', { d: 'M2 8H19', class: 'ad-ln' }, g);
        arrowHead(g, [[2, 8], [25, 8]], 'ad-head' + (k.id === 'cross' ? ' ad-head--hollow' : ''), k.id === 'control' ? 5 : 7);
      }, (view.spec && view.spec.edgeLegend && view.spec.edgeLegend[k.id]) || k.title);   // spec.edgeLegend: texto propio por tipo
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
    if (used.store) item((s) => { const g = S('g', { class: 'ad-op--io' }, s); S('path', { d: 'M5,4V12A8,2.6 0 0 0 21,12V4', class: 'ad-box' }, g); S('ellipse', { cx: 13, cy: 4, rx: 8, ry: 2.6, class: 'ad-box' }, g); }, 'Cilindro: almacén (guarda tensores para pasos siguientes; no es una operación)');
    // fase 6: agrupación GQA, expertos MoE y filas de un caché
    if (used.gqa) {
      item((s) => { S('rect', { x: 3, y: 3, width: 6, height: 7, rx: 1, class: 'ad-gqa-q' }, s); S('rect', { x: 11, y: 3, width: 6, height: 7, rx: 1, class: 'ad-gqa-q' }, s); S('path', { d: 'M6 10L13 13M14 10L13 13', class: 'ad-gqa-ln' }, s); S('rect', { x: 3, y: 13, width: 20, height: 3, rx: 1, class: 'ad-gqa-kv' }, s); }, 'Cabezas de query (Q) que comparten una cabeza K,V (un grupo)');
    }
    if (used.experts) item((s) => { [2, 8, 14, 20].forEach((x, i) => S('rect', { x, y: 3, width: 5, height: 10, rx: 1, class: 'ad-exp' + (i === 1 || i === 2 ? ' is-on' : '') }, s)); }, 'Expertos (FFN): encendidos = los top-k elegidos para un token');
    if (used.rows) item((s) => { const g = S('g', { class: 'ad-rows' }, s); [2, 6, 10].forEach((y, i) => S('rect', { x: 3, y, width: 20, height: 3, rx: 1, class: 'ad-row' + (i === 2 ? ' is-new' : '') }, g)); }, 'Filas del caché (una por token; la resaltada se agrega en este paso)');
    // fase 7: tira de tokens, ids de M-RoPE, capas con toma, congelado / entrena, enlaces
    if (used.strip) {
      // texto + imagen (el prompt de LLaVA / Qwen2-VL): la muestra y el texto de siempre; otra mezcla (RT-2: solo acción;
      // OpenVLA: prompt + tira de la acción): una muestra por modalidad dibujada, en orden, y el texto las nombra
      const sm = used.stripMods || ['txt', 'img'];
      const classic = sm.length === 2 && sm.indexOf('txt') >= 0 && sm.indexOf('img') >= 0;
      const MW = { txt: 'texto rayado', img: 'imagen liso', act: 'acción con puntos', aud: 'audio', lat: 'latente', qry: 'queries' };
      if (classic) item((s) => { defs(s, lid + '-lstrip'); const a = S('g', { class: 'ad-glyph ad-mod--txt' }, s); S('rect', { x: 2, y: 4, width: 6, height: 8, class: 'ad-face ad-face--front', fill: 'url(#' + lid + '-lstrip-tx-txt)' }, a); const b = S('g', { class: 'ad-glyph ad-mod--img' }, s); S('rect', { x: 9, y: 4, width: 15, height: 8, class: 'ad-face ad-face--front', fill: 'url(#' + lid + '-lstrip-tx-img)' }, b); }, ((view.spec && view.spec.legendText) || {}).strip || 'Tira del prompt: ancho proporcional al número de tokens (texto rayado, imagen liso)');
      else item((s) => {
        defs(s, lid + '-lstrip');
        const k = Math.min(sm.length, 3), w = (22 - (k - 1)) / k;
        sm.slice(0, k).forEach((m, i) => { const a = S('g', { class: 'ad-glyph ad-mod--' + m }, s); S('rect', { x: r1(2 + i * (w + 1)), y: 4, width: r1(w), height: 8, class: 'ad-face ad-face--front', fill: 'url(#' + lid + '-lstrip-tx-' + m + ')' }, a); });
      }, ((view.spec && view.spec.legendText) || {}).strip || 'Tira de tokens: ancho proporcional al número (' + sm.map((m) => MW[m] || m).join(', ') + ')');
    }
    if (used.posIds) item((s) => { const t = S('text', { x: 13, y: 12, 'text-anchor': 'middle', class: 'ad-pos-n is-var' }, s); t.textContent = 't h w'; }, 'Ids de posición (t, h, w) de M-RoPE: ilustrativo');
    if (used.dropfirst) item((s) => { const g = S('g', { class: 'ad-glyph ad-mod--img' }, s); S('rect', { x: 9, y: 4, width: 15, height: 9, class: 'ad-face ad-face--front', fill: 'var(--surface)' }, g); S('rect', { x: 2, y: 4, width: 7, height: 9, class: 'ad-tokdrop' }, s); S('path', { d: 'M3 5L8 12M8 5L3 12', class: 'ad-tokdrop-x' }, s); }, 'Token descartado (CLS): no sigue al proyector');
    if (used.layers) item((s) => { [2, 8, 14, 20].forEach((x, i) => S('rect', { x, y: 3, width: 5, height: 10, rx: 1, class: 'ad-layer' + (i === 2 ? ' is-tap' : i === 3 ? ' is-off' : '') }, s)); }, 'Capas del encoder: resaltada = de la que se toman las features; atenuada = no se usa');
    if (used.frozen) item((s) => { const g = S('g', { class: 'ad-train ad-train--frozen' }, s); S('rect', { x: 1, y: 1, width: 24, height: 14, rx: 7, class: 'ad-train-bg' }, g); trainIcon(g, true, 13, 8); }, 'Congelado: sus pesos no se actualizan en esta etapa');
    // fase 10: congelado solo con el rayado (trainPill:false) o en un tramo de barra: la muestra es el rayado
    if (used.frozenHatch && !used.frozen) item((s) => { const g = S('g', { class: 'ad-op--embed' }, s); S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-box' }, g); defs(s, lid + '-lfz'); S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-frozen-hatch', fill: 'url(#' + lid + '-lfz-tx-frozen)' }, g); }, ((view.spec && view.spec.legendText) || {}).frozenHatch || 'Rayado: congelado (sus pesos no se actualizan)');
    // fase 10 (revisión): solo tramos de barra rayados (las vistas de memoria): la muestra es un tramo gris rayado, como en la barra
    if (used.frozenBarHatch && !used.frozen && !used.frozenHatch) item((s) => { S('rect', { x: 2, y: 3, width: 22, height: 10, class: 'ad-bar-seg ad-op--norm' }, s); defs(s, lid + '-lfb'); S('rect', { x: 2, y: 3, width: 22, height: 10, class: 'ad-frozen-hatch', fill: 'url(#' + lid + '-lfb-tx-frozen)' }, s); }, ((view.spec && view.spec.legendText) || {}).frozenHatch || 'Rayado: congelado (sus pesos no se actualizan)');
    // fase 10 (revisión): contorno punteado = no es otro modelo en memoria (la referencia de DPO con LoRA: la base sin adaptadores)
    if (used.ghost) item((s) => { const g = S('g', { class: 'ad-node--ghost ad-op--attn' }, s); S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-box' }, g); }, ((view.spec && view.spec.legendText) || {}).ghost || 'Contorno punteado: no es otro modelo en memoria');
    if (used.trained) item((s) => { const g = S('g', { class: 'ad-train ad-train--on' }, s); S('rect', { x: 1, y: 1, width: 24, height: 14, rx: 7, class: 'ad-train-bg' }, g); trainIcon(g, false, 13, 8); }, 'Entrena: sus pesos se actualizan en esta etapa');
    if (used.xref) item((s) => { S('path', { d: 'M8 13l9,-9M11 4h6v6', class: 'ad-expand-ico', style: 'stroke:var(--ink)' }, s); }, 'Enlace: se ve por dentro en otra página');
    // fase 8: bucle de muestreo, veces que corre cada red y la barra del costo por imagen
    // fase 9: spec.legendText = textos propios de estas entradas (VLA: "por acción" / "por chunk", no "por imagen")
    const LT = (view.spec && view.spec.legendText) || {};
    if (used.loop) item((s) => { const g = S('g', { class: 'ad-tag' }, s); S('rect', { x: 1, y: 1, width: 24, height: 14, rx: 3, class: 'ad-tag-bg' }, g); loopIcon(g, 13, 8, 4.2); }, LT.loop || 'Bucle: se repite en cada paso de muestreo');
    if (used.runs) item((s) => { const g = S('g', { class: 'ad-runs' }, s); S('rect', { x: 1, y: 1, width: 24, height: 14, rx: 7, class: 'ad-runs-bg' }, g); loopIcon(g, 13, 8, 3.6); }, LT.runs || 'Veces que corre por imagen (en el bucle)');
    if (used.runsOnce) item((s) => { const g = S('g', { class: 'ad-runs ad-runs--once' }, s); S('rect', { x: 1, y: 1, width: 24, height: 14, rx: 7, class: 'ad-runs-bg' }, g); loopIcon(g, 13, 8, 3.6); }, LT.runsOnce || 'Veces que corre por imagen (fuera del bucle)');
    // fase 10 (revisión): la muestra usa las clases de los dos primeros tramos de la barra dibujada (en PPO no hay tono "loop")
    if (used.costSplit) item((s) => { const cc = used.costSplitCls || ['ad-cs-seg ad-cs--loop', 'ad-cs-seg ad-cs--once']; S('rect', { x: 2, y: 4, width: 18, height: 8, class: cc[0] }, s); S('rect', { x: 20, y: 4, width: 4, height: 8, class: cc[1] || cc[0] }, s); S('rect', { x: 2, y: 4, width: 22, height: 8, class: 'ad-cs-frame' }, s); }, LT.costSplit || 'Costo por imagen: ancho proporcional a los MACs (del calculador)');
    // fase 10: barras por fila (memoria por método), adaptador LoRA y matriz a escala
    if (used.bars) item((s) => { S('rect', { x: 2, y: 3, width: 12, height: 5, class: 'ad-bar-seg ad-op--norm' }, s); S('rect', { x: 14, y: 3, width: 6, height: 5, class: 'ad-bar-seg ad-op--conv' }, s); S('rect', { x: 2, y: 10, width: 7, height: 5, class: 'ad-bar-seg ad-op--norm' }, s); S('path', { d: 'M22 1V15', class: 'ad-bars-line' }, s); }, LT.bars || 'Barras: ancho proporcional (del calculador); línea punteada = referencia');
    if (used.adapterOn) item((s) => { const g = S('g', { class: 'ad-adapter is-on' }, s); S('rect', { x: 1, y: 1, width: 24, height: 14, rx: 7, class: 'ad-adapter-bg' }, g); trainIcon(g, false, 13, 8); }, LT.adapterOn || 'Adaptador LoRA (B·A, entrenable) sobre esa lineal; su número: parámetros por capa');
    if (used.adapterOff) item((s) => { const g = S('g', { class: 'ad-adapter is-off' }, s); S('rect', { x: 1, y: 1, width: 24, height: 14, rx: 7, class: 'ad-adapter-bg' }, g); }, LT.adapterOff || 'Sin adaptador con esta config: la lineal queda congelada tal cual');
    // fase 11: pesos atados, tokens de ejemplo, tablas de celdas y grafo por capas
    if (used.tie) item((s) => { const g = S('g', { class: 'ad-edge ad-edge--control ad-edge--tie' }, s); S('path', { d: 'M4 8H22', class: 'ad-ln' }, g); S('circle', { cx: 4, cy: 8, r: 2.6, class: 'ad-end' }, g); S('circle', { cx: 22, cy: 8, r: 2.6, class: 'ad-end' }, g); }, LT.tie || 'Pesos atados: la misma matriz en los dos extremos (se cuenta una vez)');
    if (used.tokens) item((s) => { const g = S('g', { class: 'ad-toks' }, s); S('rect', { x: 1, y: 3, width: 11, height: 9, rx: 2, class: 'ad-tok is-seg0' }, g); S('rect', { x: 14, y: 3, width: 11, height: 9, rx: 2, class: 'ad-tok is-seg1' }, g); S('rect', { x: 1, y: 13, width: 11, height: 2, class: 'ad-tok-seg is-seg0' }, g); S('rect', { x: 14, y: 13, width: 11, height: 2, class: 'ad-tok-seg is-seg1' }, g); }, LT.tokens || ('Tokens de ejemplo (ilustrativo)' + (used.tokSeg ? '; la barra de abajo es el segmento: A o B' : '')));
    if (used.tokMask) item((s) => { const g = S('g', { class: 'ad-toks' }, s); S('rect', { x: 2, y: 3, width: 22, height: 10, rx: 2, class: 'ad-tok is-mask' }, g); }, LT.tokMask || '[MASK]: token enmascarado (lo que el MLM predice)');
    if (used.tokRand) item((s) => { const g = S('g', { class: 'ad-toks' }, s); S('rect', { x: 2, y: 3, width: 22, height: 10, rx: 2, class: 'ad-tok is-rand' }, g); }, LT.tokRand || 'Elegido y cambiado por una palabra al azar (10 % de los elegidos)');
    if (used.tokSent) item((s) => { const g = S('g', { class: 'ad-toks' }, s); S('rect', { x: 2, y: 3, width: 22, height: 10, rx: 2, class: 'ad-tok is-sent is-k0' }, g); }, LT.tokSent || 'Centinela: reemplaza un tramo corrompido (<X>, <Y>, …)');
    if (used.tokDrop) item((s) => { const g = S('g', { class: 'ad-toks' }, s); S('rect', { x: 2, y: 3, width: 22, height: 10, rx: 2, class: 'ad-tok is-drop is-k0' }, g); }, LT.tokDrop || 'Token de un tramo corrompido (lo que el decoder genera)');
    if (used.wave) item((s) => { const g = S('g', { class: 'ad-wave' }, s); S('path', { d: 'M3 8V8M5 5V11M7 3V13M9 6V10M11 4V12M13 7V9', class: 'ad-wave-ln' }, g); S('rect', { x: 15, y: 4, width: 9, height: 8, class: 'ad-wave-pad' }, g); }, LT.wave || 'Onda de audio (ilustrativa); marco punteado = relleno con ceros hasta 30 s');
    if (used.melGrid) item((s) => { const g = S('g', { class: 'ad-melg' }, s); [[3, 9, .9], [6, 9, .6], [9, 9, .8], [3, 6, .5], [6, 6, .3], [9, 6, .6], [3, 3, .2], [9, 3, .3]].forEach(([x, y, v]) => S('rect', { x, y, width: 3, height: 3, class: 'ad-melg-cell', style: 'fill-opacity:' + v }, g)); S('rect', { x: 14, y: 3, width: 10, height: 9, class: 'ad-wave-pad' }, g); }, LT.melGrid || 'Espectrograma log-Mel (tono ilustrativo): filas = bandas mel, columnas = frames de 10 ms');
    if (used.tokKeep) item((s) => { const g = S('g', { class: 'ad-toks' }, s); S('rect', { x: 2, y: 3, width: 22, height: 10, rx: 2, class: 'ad-tok is-seg0 is-keep' }, g); }, LT.tokKeep || 'Elegido y sin cambio (10 % de los elegidos): también entra en la pérdida');
    if (used.cells) item((s) => { const g = S('g', { class: 'ad-cells' }, s); [[2, 2, .25], [8, 2, .8], [14, 2, .4], [2, 8, .6], [8, 8, .2], [14, 8, .9]].forEach(([x, y, v]) => S('rect', { x, y, width: 5, height: 5, class: 'ad-cell', style: 'fill-opacity:' + v }, g)); S('rect', { x: 7.5, y: 1.5, width: 6, height: 6, class: 'ad-cell-mark' }, g); S('rect', { x: 13.5, y: 7.5, width: 6, height: 6, class: 'ad-cell-mark' }, g); }, LT.cells || 'Tabla (ilustrativa: el tono no es un valor real); recuadro = la celda elegida por fila');
    if (used.cellsRows) item((s) => { const g = S('g', { class: 'ad-cells' }, s); [2, 6, 10].forEach((y, i) => S('rect', { x: 2, y, width: 22, height: 3, class: 'ad-cell-row' + (i === 1 ? ' is-lit' : '') }, g)); }, LT.cellsRows || 'Filas: listas del índice; resaltadas = las que se recorren');
    if (used.layered) item((s) => { const g = S('g', { class: 'ad-layered' }, s); S('path', { d: 'M4 3H24L21 7H1Z', class: 'ad-lay-plane' }, g); S('path', { d: 'M4 9H24L21 13H1Z', class: 'ad-lay-plane' }, g); S('path', { d: 'M8 5L8 11', class: 'ad-lay-drop' }, g); S('path', { d: 'M8 11L16 11', class: 'ad-lay-path' }, g); S('circle', { cx: 8, cy: 5, r: 2.6, class: 'ad-lay-ep' }, g); S('path', { d: 'M19 11L21 9L23 11L21 13Z', class: 'ad-lay-q' }, g); }, LT.layered || 'Grafo por capas (ilustrativo): la ruta resaltada es la búsqueda codiciosa');
    if (used.matrix) item((s) => { const g = S('g', { class: 'ad-op--embed' }, s); S('rect', { x: 3, y: 2, width: 12, height: 12, class: 'ad-mat-box' }, g); S('rect', { x: 18, y: 2, width: 3, height: 12, class: 'ad-mat-box' + (used.matrixClamped ? ' is-clamped' : '') }, g); }, LT.matrix || 'Matriz de pesos a escala (lineal): filas × columnas');
    if (used.closed) item((s) => { const g = S('g', { class: 'ad-node--closed' }, s); S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-box' }, g); }, 'Caja negra: pesos cerrados (no se ve por dentro)');
    if (used.bins) item((s) => { const g = S('g', { class: 'ad-bins' }, s); S('rect', { x: 2, y: 4, width: 22, height: 8, class: 'ad-bins-track' }, g); S('path', { d: 'M5 4V12M8 4V12M11 4V12M14 4V12M17 4V12M20 4V12', class: 'ad-bins-tick' }, g); S('rect', { x: 13, y: 3, width: 4, height: 10, class: 'ad-bins-on' }, g); }, 'Bins de una dimensión de la acción (resaltado: el del ejemplo, ilustrativo)');
    if (used.maskGrid) item((s) => { [[3, 3, 1], [9, 3, 0], [15, 3, 0], [3, 9, 1], [9, 9, 1], [15, 9, 0]].forEach(([x, y, on]) => S('rect', { x, y, width: 5, height: 5, class: on ? 'ad-mask-on ad-mod--img' : 'ad-mask-off' }, s)); }, 'Máscara de atención: fila = query, columna = key; llena = permitido, vacía = bloqueado (−∞)' + (used.maskRun ? '; filas atenuadas = no corren en el paso' : ''));
    if (used.repeat) item((s) => { S('rect', { x: 7, y: 6, width: 16, height: 9, rx: 2, class: 'ad-stack' }, s); S('rect', { x: 4.5, y: 3.5, width: 16, height: 9, rx: 2, class: 'ad-stack' }, s); S('rect', { x: 2, y: 1, width: 16, height: 9, rx: 2, class: 'ad-frame' }, s); }, 'Bloque repetido × L');
    if (used.heads) item((s) => { const g = S('g', { class: 'ad-op--attn' }, s); for (let i = 3; i >= 0; i--) S('rect', { x: 2 + i * 2.5, y: 5 - i * 1.5, width: 14, height: 9, rx: 2, class: 'ad-box' + (i ? ' ad-box--deck' : '') }, g); }, 'Una carta por cabeza (h)');
    if (used.batch) item((s) => { S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-frame ad-frame--batch' }, s); }, 'Marco discontinuo: formas con lote (B)');
    if (used.train) item((s) => { S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-frame ad-frame--train' }, s); }, 'Marco gris discontinuo: solo en entrenamiento');
    if (used.offline) item((s) => { S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-frame ad-frame--offline' }, s); }, 'Marco ámbar: offline (una vez, antes de la inferencia)');
    if (used.lanes) for (const [label, tone] of used.lanes) item((s) => { S('rect', { x: 2, y: 2, width: 22, height: 12, rx: 3, class: 'ad-frame ad-frame--lane ad-tone--' + tone }, s); }, label);
    if (used.badge) item((s) => { S('rect', { x: 1, y: 3, width: 24, height: 10, rx: 5, class: 'ad-badge-bg' }, s); S('path', { d: 'M5,8m-2,0a2,2 0 1,0 4,0a2,2 0 1,0 -4,0M7,8h3.5M9.5,8v2', class: 'ad-key' }, s); }, 'Parámetros aprendibles');
    // antes "opts && …": nunca se mostraba. Fase 9: sin calculador (calc:false) no hay formas, y una vista sin aristas (la
    // máscara de π0) no lleva el ejemplo fijo de ViT
    if ((!opts || opts.withShapes !== false) && view.spec.kind !== 'map' && view.run && (view.spec.edges || []).length) {
      const li = H('div', { class: 'ad-leg-item ad-leg-shape', role: 'listitem' }, wrap);
      // Ejemplo con la primera arista de datos con tensor de ESTA vista (antes: un ejemplo fijo de ViT).
      const run = view.run, de = (view.spec.edges || []).find((e) => (e.kind || 'data') === 'data' && e.tensor && run && run.tensors[e.tensor]);
      const ex = de ? run.tensors[de.tensor] : null;
      H('span', { class: 'ad-leg-mono' }, li, ex ? '<b>' + htmlSub(shapeText(ex, 'sym')) + '</b> / ' + esc(shapeText(ex, 'num')) : '<b>N×D</b> / 197×768');
      H('span', { text: 'forma: símbolos / números (sin batch)' }, li);
    }
    return wrap;
  }

  // ============================================================ controlador
  function render(diagramId, container, opts) {
    // copia: opts.config se ajusta por vista (spec.configs) sin tocar el objeto del llamador
    opts = Object.assign({}, opts || {});
    let reqConfig = opts.config || null;
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
      if (spec0.kind === 'map') btn('Ver como lista', 'Ver los modelos y sus relaciones como lista', () => { if (!alt) return; alt.open = true; const sm = alt.querySelector('summary'); try { alt.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* sin scroll */ } if (sm) sm.focus({ preventScroll: true }); });
      ctl.bFull = btn('<span aria-hidden="true">⛶</span>', 'Pantalla completa', () => toggleFull(), { 'aria-pressed': 'false' });
      walkBar = H('div', { class: 'ad-walk', hidden: 'hidden', 'aria-live': 'polite' }, fig);
      walkBar.hidden = true;
    }
    // fase 6: spec.configs = configs donde la vista tiene sentido (p. ej. la FFN SwiGLU no es la MoE de Mixtral);
    // con otra config se dibuja la canónica del spec y se avisa (en vez de una figura en blanco o equivocada).
    const cfgNote = H('p', { class: 'ad-cfgnote', role: 'status' }, fig);
    cfgNote.hidden = true;
    const body = H('div', { class: 'ad-body' }, fig);
    const vp = H('div', { class: 'ad-viewport', tabindex: '-1' }, body);
    if (ctl.mode !== 'blank' && !ctl.quiz) { tip = H('div', { class: 'ad-tip', role: 'tooltip', id: ctl.id + '-tip' }, vp); tip.hidden = true; }
    if (ctl.mode === 'full') {
      panel = H('aside', { class: 'ad-panel', 'aria-label': 'Detalle del bloque' }, body);
      panel.hidden = true;
      hint = H('div', { class: 'ad-hint', 'aria-hidden': 'true', text: 'Toca para explorar · pellizca para hacer zoom' }, vp);
      ctl.hintTimer = setTimeout(() => { if (hint) hint.classList.add('ad-hint--gone'); }, 2500);
      legendBox = H('div', { class: 'ad-legend-wrap' }, fig);
      const lo = prefGet('legendOpen', true);
      legendBox.hidden = !lo;
      ctl.bLeg.setAttribute('aria-pressed', String(!!lo));
    }
    // Caption del spec (§7.1): el html va como contenido (4.º argumento de H). Cada vista expandida
    // pone el suyo en mountView (si no tiene, queda el de la raíz).
    const capEl = ctl.mode === 'full' ? H('figcaption', { class: 'ad-caption' }, fig) : null;
    if (ctl.mode === 'full') { alt = H('details', { class: 'ad-alt' }, fig); }

    // ---- vista actual
    function mountView(id) {
      const spec = ATLAS.diagram(id);
      const cfgOk = !reqConfig || !Array.isArray(spec.configs) || spec.configs.indexOf(reqConfig) >= 0;
      opts.config = cfgOk ? reqConfig : undefined;
      cfgNote.hidden = cfgOk;
      cfgNote.textContent = '';
      if (cfgOk && ctl.xref && reqConfig === ctl.xref.config) {
        // vista abierta desde un enlace de otra página con otra config: se dice cuál y se puede volver a la canónica
        cfgNote.hidden = false;
        H('span', { text: 'Vista con la config ' + configLabel(reqConfig) + (ctl.xref.why ? ' (' + ctl.xref.why + ')' : '') + '. ' }, cfgNote);
        const back = H('button', { type: 'button', class: 'ad-btn', text: 'Volver a ' + configLabel(spec0.config) }, cfgNote);
        back.addEventListener('click', () => { reqConfig = null; ctl.xref = null; redraw(); });
      }
      if (!cfgOk) cfgNote.textContent = 'Esta vista no aplica a ' + configLabel(reqConfig) + (spec.configsNote ? ' (' + spec.configsNote + ')' : '') + '; se muestra ' + configLabel(spec.config) + '.';
      // fase 9: vista sin calculador (calc:false, pesos cerrados): se dice por qué no hay formas
      if (spec.calc === false && spec.calcNote && ctl.mode === 'full') { cfgNote.hidden = false; cfgNote.textContent = spec.calcNote; }
      // fase 10 (revisión): figura angosta (< 640 px): las vistas con spec.mobileGrid usan su otra grilla (viewSpec)
      ctl.narrow = narrowNow();
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
      fig.setAttribute('data-config', opts.config || spec.config || '');
      // aria-label de nodos (necesita la vista actual para las formas)
      for (const n of view.spec.nodes || []) if (view.nodeEls[n.id] && spec.kind !== 'map' && !ctl.slots[n.id]) view.nodeEls[n.id].setAttribute('aria-label', nodeAria(ctl, n, view.run));
      if (legendBox) { legendBox.innerHTML = ''; legendBox.appendChild(legendEl(view)); }
      if (capEl) { const cap = spec.caption || spec0.caption || ''; capEl.innerHTML = cap ? captionHtml(qResolve(cap, opts.config || spec.config || spec0.config)) : ''; capEl.hidden = !cap; }
      if (crumbs) renderCrumbs();
      if (alt) renderAlt();
      if (ctl.bBack) ctl.bBack.hidden = ctl.stack.length < 2;
      if (ctl.hl) applyHighlight(ctl.hl);
      return view;
    }
    function redraw() {
      const keep = ctl.vb, from = ctl.view && ctl.view.from;
      // fase 11 (revisión): el nodo enfocado sigue enfocado tras redibujar (al abrir el panel la figura baja de 640 px y una
      // vista con mobileGrid se redibuja en su grilla angosta: el foco caía en <body>)
      const a = root.document && root.document.activeElement, nid = a && fig.contains(a) && a.getAttribute && a.getAttribute('data-node');
      mountView(ctl.stack[ctl.stack.length - 1]);
      if (ctl.view && from) ctl.view.from = from;
      sizeViewport(); if (keep && ctl.zoomed) setVB(keep); else fit(false);
      if (nid && ctl.view && ctl.view.nodeEls[nid]) ctl.view.nodeEls[nid].focus({ preventScroll: true });
    }

    function renderCrumbs() {
      crumbs.innerHTML = '';
      let repShown = false;
      ctl.stack.forEach((id, i) => {
        const sp = ATLAS.diagram(id);
        const cl = i === 0 ? null : crumbLabel(ATLAS.diagram(ctl.stack[i - 1]), sp, repShown);
        if (cl && cl.rep) repShown = true;
        const label = i === 0 ? rootTitle(sp) : cl.text;
        if (i > 0) H('span', { class: 'ad-crumb-sep', 'aria-hidden': 'true', text: '›' }, crumbs);
        // fase 10 (revisión): subíndices como en las etiquetas ("solo W_Q y W_V" se leía con guiones bajos)
        if (i === ctl.stack.length - 1) H('span', { class: 'ad-crumb', 'aria-current': 'location' }, crumbs, htmlSub(label));
        else { const b = H('button', { type: 'button', class: 'ad-crumb ad-crumb--link' }, crumbs, htmlSub(label)); b.addEventListener('click', () => collapseTo(i)); }
      });
    }
    function rootTitle(sp) {
      if (sp.kind === 'map') return sp.title || 'Mapa';
      try { const r = ctl.runFor(sp); return (r && r.label) || sp.title; } catch (e) { return sp.title || sp.id; }
    }
    // "× L" solo en el primer nivel repetido (la capa); más adentro sería ambiguo (¿L o h?).
    function crumbLabel(parentSpec, sp, repShown) {
      const n = parentSpec && (parentSpec.nodes || []).find((x) => x.id === sp.parentNode);
      let s = plainSub((n && n.label ? n.label.replace(/\n/g, ' ') : sp.title) || sp.id);
      const grp = !repShown && parentSpec && n && (parentSpec.groups || []).find((g) => g.repeat && inside(n, g));
      let rep = false;
      if (grp && grp.repeat.crumb !== false) { try { const r = ctl.runFor(parentSpec); s += ' × ' + repeatValue(r.config, grp.repeat); rep = true; } catch (e) { /* sin número */ } }
      return { text: s, rep };
    }

    function renderAlt() {
      const view = ctl.view, spec = view.spec, run = view.run;
      alt.innerHTML = '';
      if (spec.kind === 'map') { renderMapList(spec); return; }
      H('summary', { text: 'Bloques y formas (texto alternativo)' }, alt);
      const list = H('dl', { class: 'ad-alt-list' }, alt);
      for (const n of spec.nodes || []) {
        H('dt', null, list, htmlSub((n.label || n.id).replace(/\n/g, ' ') + (n.sub ? ' — ' + nodeSub(n, ctl) : '')));
        const dd = H('dd', null, list);
        if (spec.kind === 'map') { dd.innerHTML = '<a href="#' + esc(n.id) + '">Abrir</a>'; continue; }
        const io = nodeIO(view, n.id, run);
        const parts = [];
        if (io.in.length) parts.push('Entra: ' + io.in.map((t) => shapeSay(t)).join(', '));
        if (io.out.length) parts.push('Sale: ' + io.out.map((t) => shapeSay(t)).join(', '));
        if (run && n.op !== 'io') { const c = nodeCost(run, n); const pp = perPairOf(c.ops); if (c.params) parts.push('Parámetros: ' + fint(c.params) + (c.rep > 1 ? ' ' + unitOf(n) : '')); if (c.macs) parts.push('MACs: ' + fint(c.macs) + (c.rep > 1 ? ' ' + unitOf(n) : '') + (pp ? ' por par (lote de B = ' + fint(pp.B) + ': ' + fint(pp.batchMacs) + ')' : '')); }
        if (n.costNote) parts.push(strip(qResolve(n.costNote, opts.config || spec.config)));
        if (n.expand) parts.push('Se abre en: ' + ((ATLAS.diagram(n.expand) || {}).title || n.expand));
        if (n.train) parts.push(n.train === 'frozen' ? 'Congelado en esta etapa' : 'Entrena en esta etapa');
        if (n.strip && run) { const sg = stripSegs(n.strip, run); if (sg) parts.push('Prompt: ' + sg.map((x) => (x.count === false ? '' : fint(x.v) + ' ') + (x.label || '')).join(' + ') + (n.strip.caption ? ' (' + qText(n.strip.caption, ctl, spec) + ')' : '')); }
        if (n.posIds) parts.push('Ids (t, h, w): ' + mropeIds(n.posIds.segs).map((q) => '(' + q.t + ',' + q.h + ',' + q.w + ')').join(' '));
        if (n.maskGrid) parts.push('Máscara por bloques: ' + maskWords(n.maskGrid));
        if (n.style === 'closed') parts.push('Caja negra: pesos cerrados');
        if (n.bars && run) { const bw = barsWords(n.bars, run, ctl, spec); if (bw) parts.push(bw); }
        if (n.adapter && run) { const st = adapterState(run, n.adapter); parts.push(st.on ? 'Adaptador LoRA entrenable' + (st.params ? ': ' + fint(st.params) + ' parámetros por capa' : '') : 'Sin adaptador con esta config'); }
        if (n.matrix && run) { const R = numKey(run, n.matrix.rows), C = numKey(run, n.matrix.cols); if (R && C) parts.push('Matriz ' + fint(R) + '×' + fint(C)); }
        if (n.tokens) parts.push(tokensWords(n.tokens));
        if (n.cells && run) { const cw = cellsWords(n.cells, run, ctl, spec); if (cw) parts.push(cw); }
        if (n.layered) parts.push(layeredWords(n.layered, ctl, spec));
        dd.innerHTML = combSafe(esc(parts.join(' · ')) + (n.note ? '<br>' + qResolve(n.note, opts.config || spec.config) : ''));
      }
    }

    // Mapa como lista: por región, cada modelo con sus relaciones en frase y el enlace a su ficha.
    function renderMapList(spec) {
      H('summary', { text: 'Ver como lista: modelos y relaciones' }, alt);
      const wrapL = H('div', { class: 'ad-alt-map' }, alt);
      const nodes = spec.nodes || [];
      const regions = (spec.groups || []).filter((g) => g.region);
      const placed = new Set();
      const sentence = (e) => (MAP_KIND_SENT[e.kind] ? MAP_KIND_SENT[e.kind](mapLabel(e.from), mapLabel(e.to)) : e.from + ' → ' + e.to) + (e.label ? ' — ' + e.label : '');
      const block = (title, list) => {
        if (!list.length) return;
        H('h5', { class: 'ad-alt-h', text: title }, wrapL);
        const dl = H('dl', { class: 'ad-alt-list' }, wrapL);
        for (const n of list) {
          placed.add(n.id);
          const it = catItem(n.id);
          const dt = H('dt', null, dl);
          const href = it && it.kind === 'card' ? '#mapa.' + (ATLAS.slug ? ATLAS.slug(n.id) : n.id) : '#' + n.id;
          H('a', { href, text: (it && it.title) || n.label || n.id }, dt);
          const rels = (spec.edges || []).filter((e) => e.from === n.id || e.to === n.id);
          const dd = H('dd', null, dl);
          if (rels.length) { const ul = H('ul', { class: 'ad-alt-rels' }, dd); rels.forEach((e) => H('li', { text: sentence(e) }, ul)); }
          else dd.textContent = 'Sin relaciones dibujadas.';
        }
      };
      for (const g of regions) block(g.label, nodes.filter((n) => !placed.has(n.id) && inside(n, g)));
      block('Otros', nodes.filter((n) => !placed.has(n.id)));
    }

    // ---- tamaño del viewport y viewBox
    function sizeViewport() {
      const view = ctl.view; if (!view) return;
      const cw = vp.clientWidth || container.clientWidth || 800;
      if (fig.classList.contains('ad--fs')) { vp.style.height = ''; return; }
      if (view.spec.kind === 'map' && isMobile() && ctl.mode === 'full') { vp.style.height = Math.round(Math.min((root.innerHeight || 800) * 0.7, 560)) + 'px'; return; }
      const s = Math.min(capScale(), cw / (view.width + 24));
      // Diagramas verticales altos (tb) en escritorio: ajustados al ANCHO, con un viewport de hasta 1.5 pantallas
      // (la página se desplaza). Ajustarlos al alto dejaba las etiquetas en ≈ 8 px (Swin, 96×136 u).
      const tall = !isMobile() && view.spec.direction === 'tb' && ctl.mode !== 'mini';
      const maxH = Math.max(260, (root.innerHeight || 900) * (isMobile() ? 0.72 : tall ? 1.5 : 0.92));
      vp.style.height = Math.round(clamp((view.height + 24) * s, 160, maxH)) + 'px';
    }
    function content() { const v = ctl.view; return { x: -12, y: -12, w: v.width + 24, h: v.height + 24 }; }
    function vpSize() { return { w: vp.clientWidth || 800, h: vp.clientHeight || 500 }; }
    function capScale() { return fig.classList.contains('ad--fs') ? 1.6 : ctl.mode === 'mini' ? 1 : 1.1; }
    function isMobile() { return (root.innerWidth || 1000) < 768; }
    function narrowNow() { return (vp.clientWidth || container.clientWidth || root.innerWidth || 1000) < 640; }
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
      // fase 11 (revisión): desde qué nodo se abrió (spec.mobileFocusFrom[nodo]: el reranker abre el bi-vs-cross en el cross-encoder)
      if (ctl.view) ctl.view.from = nodeId;
      sizeViewport();
      fadeIn();
      // fase 8: en el teléfono, la vista abierta usa su mobileFocus (antes solo se leía al montar y la U-Net abría a 5 px)
      initialView();
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
      if (r) { setVB(rectVB(r)); fadeIn(); await animateVB(ctl.vb, initialVB(), 300); } else initialView();
      const el = ctl.view.nodeEls[leaving.parentNode];
      if (el && (hadFocus || fig.contains(document.activeElement))) el.focus({ preventScroll: true });
    }

    // ---- tooltip
    let tipFor = null;
    function showTip(target, x, y) {
      if (!tip || ctl.mode === 'blank') return;
      const html = tipHTML(target);
      if (!html) { hideTip(); return; }
      tip.innerHTML = combSafe(html);
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
        let h = '<div class="ad-tip-t">' + htmlSub((n.label || n.id).replace(/\n/g, ' ')) + '</div>';
        if (n.sub) h += '<div class="ad-tip-sub">' + htmlSub(nodeSub(n, ctl)) + '</div>';
        if (n.tex) h += '<div class="ad-tip-tex" data-tex="' + esc(n.tex) + '"></div>';
        const io = nodeIO(view, n.id, run);
        if (io.in.length || io.out.length) h += '<div class="ad-tip-io">' + io.in.map(shp).join(', ') + (io.in.length && io.out.length ? ' <span aria-hidden="true">→</span> ' : '') + io.out.map(shp).join(', ') + '</div>';
        if (run && n.op !== 'io') {
          const c = nodeCost(run, n);
          const shw = sharedTower(spec, n, c), K = repKOf(run, n);
          const kTxt = K && c.macs ? ' <span class="ad-muted">(' + fsi(c.macs / K) + ' por par × ' + esc(String(n.repKSym || 'k')) + ' = ' + fint(K) + ')</span>' : '';
          if (shw != null && c.macs) h += '<div class="ad-tip-cost">Pesos compartidos' + (shw ? ' con «' + htmlSub(shw) + '»' : '') + ' (no se cuentan dos veces) · MACs <b>' + fsi(c.macs) + '</b></div>';
          else if (c.params || c.macs) h += '<div class="ad-tip-cost">' + (c.params ? 'Parámetros <b>' + fint(c.params) + '</b>' : 'Sin parámetros') + (c.macs ? ' · MACs <b>' + fsi(c.macs) + '</b>' + kTxt : '') + (c.rep > 1 ? ' <span class="ad-muted">' + unitOf(n) + ' (' + repTimes(n, c.rep) + ')</span>' : '') + '</div>';
          else h += '<div class="ad-tip-cost ad-muted">Sin parámetros ni MACs de matmul</div>';
          const pp = perPairOf(c.ops);
          if (pp && c.macs) h += '<div class="ad-tip-cost ad-muted">MACs por par (una fila de la matriz); el lote de B = ' + fint(pp.B) + ' entero: <b>' + fsi(pp.batchMacs) + '</b></div>';
          if (n.costNote) h += '<div class="ad-tip-cost ad-muted">' + esc(qText(n.costNote, ctl, spec)) + '</div>';
        }
        h += '<div class="ad-tip-hint">' + (n.expand && ctl.mode === 'full' ? 'Clic: detalle · doble clic o + : abrir bloque' : ctl.mode === 'full' ? 'Clic o Enter: detalle' + (n.xref && n.xref.length ? ' (con enlace: ' + esc(n.xref[0].label) + ')' : '') : '') + '</div>';
        return h;
      }
      if (target.edge) {
        const e = (spec.edges || []).find((x) => edgeKey(x) === target.edge && (!target.tensor || x.tensor === target.tensor));
        if (!e) return '';
        if (spec.kind === 'map') return '<div class="ad-tip-t">' + esc(MAP_KIND_SENT[e.kind] ? MAP_KIND_SENT[e.kind](mapLabel(e.from), mapLabel(e.to)) : e.kind) + '</div>' + (e.label ? '<div class="ad-tip-sub">' + esc(e.label) + '</div>' : '');
        const t = e.tensor && run && edgeRun(run, e).tensors[e.tensor];
        if (!t || slotFor(ctl, edgeKey(e)) || slotFor(ctl, edgeKey(e) + '@' + e.tensor)) return '';
        const els = (t.num || []).reduce((a, b) => a * b, 1);
        return '<div class="ad-tip-t">' + esc(t.label || e.tensor) + '</div>' + (t.tex ? '<div class="ad-tip-tex" data-tex="' + esc(t.tex + ' \\in \\mathbb{R}^{' + shapeTexOf(t) + '}') + '"></div>' : '')
          + '<div class="ad-tip-io">' + shp(t) + '</div><div class="ad-tip-cost">' + fint(els) + ' elementos · ' + esc(((ATLAS.MODALITIES || []).find((m) => m.id === t.mod) || {}).title || t.mod || '') + '</div>'
          + (e.kind === 'cross' ? '<div class="ad-tip-sub">' + esc(e.crossNote || 'K y V vienen de otro flujo') + '</div>' : '');
      }
      return '';
    }
    function shp(t) { const a = shapeText(t, 'sym'), b = shapeText(t, 'num'); return '<span class="ad-mono">' + (a === b ? '' : htmlSub(a) + ' = ') + '<b>' + esc(b) + '</b></span>'; }
    function mapLabel(id) { const n = (ctl.view.spec.nodes || []).find((x) => x.id === id); const it = catItem(id); return (n && n.label) || (it && (it.short || it.title)) || id; }
    function catItem(id) { const c = ATLAS.catalog && ATLAS.catalog(); return (c && c.items && c.items[id]) || null; }
    function mapTip(n) {
      const it = catItem(n.id);
      let h = '<div class="ad-tip-t">' + esc((it && it.title) || n.label || n.id) + '</div>';
      if (it && it.summary) h += '<div class="ad-tip-p">' + it.summary + '</div>';
      const rels = (ctl.view.spec.edges || []).filter((e) => e.from === n.id || e.to === n.id);
      if (rels.length) h += '<div class="ad-tip-cost">' + rels.map((e) => esc(MAP_KIND_SENT[e.kind] ? MAP_KIND_SENT[e.kind](mapLabel(e.from), mapLabel(e.to)) : e.from + ' → ' + e.to)).join('<br>') + '</div>';
      if (it && it.phase && !(ATLAS.getPage && (ATLAS.getPage(n.id) || {}).ready) && !it.anchor) h += '<div class="ad-tip-hint">Llega en la fase ' + esc(it.phase) + ' del Atlas</div>';
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
      H('h4', { class: 'ad-panel-t' }, head, htmlSub((n.label || n.id).replace(/\n/g, ' ')));
      const close = H('button', { type: 'button', class: 'ad-btn ad-panel-x', 'aria-label': 'Cerrar detalle', title: 'Cerrar (Esc)' }, head, '×');
      close.addEventListener('click', () => { closePanel(); const el = ctl.view.nodeEls[nodeId]; if (el) el.focus({ preventScroll: true }); });
      if (spec.kind === 'map') {
        const it = catItem(n.id);
        if (it && it.titleEn) H('p', { class: 'ad-panel-en', text: it.titleEn }, panel);
        if (it && it.summary) H('p', null, panel, it.summary);
        if (n.note) H('p', null, panel, combSafe(n.note));
        const page = ATLAS.getPage ? ATLAS.getPage(n.id) : null;
        const href = it && it.kind === 'card' ? '#mapa.' + (ATLAS.slug ? ATLAS.slug(n.id) : n.id) : '#' + n.id;
        H('a', { class: 'ad-btn ad-btn--primary', href, text: page && page.ready ? 'Abrir página' : it && it.kind === 'card' ? 'Ver tarjeta' : 'Ver qué viene' }, panel);
      } else {
        if (n.sub) H('p', { class: 'ad-panel-sub' }, panel, htmlSub(nodeSub(n, ctl)));
        if (n.note) H('div', { class: 'ad-panel-note' }, panel, combSafe(qResolve(n.note, opts.config || spec.config)));
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
          const shw = sharedTower(spec, n, c), K = repKOf(run, n);
          if (withP.length) {
            H('h5', { text: 'Parámetros' + (c.rep > 1 ? ' (' + unitOf(n) + ')' : shw != null ? ' (compartidos)' : '') }, box);
            for (const o of withP) costRow(box, o, 'param');
            if (shw != null) H('p', { class: 'ad-panel-sum' }, box, 'Pesos compartidos' + (shw ? ' con «' + htmlSub(shw) + '»' : '') + ': ya están contados ahí, no suman al total del modelo.');
            else if (withP.length > 1) H('p', { class: 'ad-panel-sum' }, box, 'Total: <b>' + fint(c.params) + '</b>');
          } else if (c.ops.length) H('p', { class: 'ad-muted', text: 'Sin parámetros aprendibles.' }, box);
          if (withM.length) {
            const pp = perPairOf(c.ops);
            H('h5', { text: 'MACs' + (c.rep > 1 ? ' (' + unitOf(n) + ')' : pp ? ' (por par)' : '') }, box);
            for (const o of withM) costRow(box, o, 'mac');
            if (withM.length > 1) H('p', { class: 'ad-panel-sum' }, box, 'Total: <b>' + fint(c.macs) + '</b> (= ' + fsi(c.macs) + ' MACs, ' + fsi(2 * c.macs) + ' FLOPs)');
            if (pp) H('p', { class: 'ad-panel-sum' }, box, 'Por par: una fila de la matriz B×B. El lote entero (B = ' + fint(pp.B) + '): <b>' + fint(pp.batchMacs) + '</b> MACs (= ' + fsi(pp.batchMacs) + ').');
            if (K && c.macs) H('p', { class: 'ad-panel-sum' }, box, 'Por par: ' + fsi(c.macs / K) + ' MACs (las filas de arriba son de un par' + (withM.some((o) => (o.repeat || 1) > K) ? ' y una capa' : '') + '). × ' + esc(String(n.repKSym || 'k')) + ' = ' + fint(K) + ' pares: <b>' + fint(c.macs) + '</b> MACs (= ' + fsi(c.macs) + ').');
          }
          if (c.rep > 1) H('p', { class: 'ad-panel-sum' }, box, 'En el modelo (' + repTimes(n, c.rep) + '): <b>' + fint(c.total.params) + '</b> parámetros · <b>' + fsi(c.total.macs) + '</b> MACs');
          if (n.costNote) H('p', { class: 'ad-panel-sum ad-muted' }, box, esc(qText(n.costNote, ctl, spec)));
        }
        const acts = H('div', { class: 'ad-panel-acts' }, panel);
        if (n.expand && ATLAS.diagram(n.expand)) { const b = H('button', { type: 'button', class: 'ad-btn ad-btn--primary', text: 'Abrir bloque' }, acts); b.addEventListener('click', () => expandTo(n.expand, n.id)); }
        for (const xr of n.xref || []) {
          const a = H('a', { class: 'ad-btn' + (n.expand ? '' : ' ad-btn--primary'), href: xr.href, text: xr.label }, acts);
          if (xr.cfg) a.addEventListener('click', () => { const m = /~([^.]+)\./.exec(xr.href || ''); pendingXref = { config: xr.cfg, why: xr.cfgWhy || '', diagram: m ? m[1] : null, t: Date.now() }; });
        }
        if (spec.page && run && n.op !== 'io') H('a', { class: 'ad-btn', href: '#' + spec.page + '.operaciones', text: 'Ver en Operaciones' }, acts);
      }
      panel.hidden = false;
      hideTip();
      fig.classList.add('ad--panel');
      panel.querySelectorAll('[data-tex]').forEach((el) => texInto(el, el.getAttribute('data-tex'), false));
      if (!ctl.zoomed) { sizeViewport(); fit(false); }
      fitTex(panel);
      const vh = root.innerWidth < 1024;
      if (vh) panel.scrollTop = 0;
    }
    // Fórmulas un poco más anchas que el panel (p. ej. el paramTex de un bottleneck de ResNet): se achica la
    // fuente hasta el 80 % para que entren; si aún no entran, queda el scroll horizontal del contenedor.
    function fitTex(scope) {
      const go = () => scope.querySelectorAll('.ad-cost-tex, .ad-panel-tex').forEach((el) => {
        const mj = el.querySelector('mjx-container');
        if (!mj || !el.clientWidth) return;
        el.style.fontSize = '';
        const need = mj.scrollWidth || mj.getBoundingClientRect().width, have = el.clientWidth - 2;
        if (need > have) el.style.fontSize = (parseFloat(root.getComputedStyle(el).fontSize) * Math.max(0.8, have / need)).toFixed(2) + 'px';
      });
      go();
      if (root.requestAnimationFrame) root.requestAnimationFrame(go);
    }
    function costRow(box, o, which) {
      const p = H('div', { class: 'ad-cost-row' }, box);
      H('div', { class: 'ad-cost-l' }, p, htmlSub(o.label || o.id));
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
        svg.querySelectorAll('[data-edge="' + cssq(key) + '"], [data-edge-tag="' + cssq(key) + '"]').forEach((el) => { if (!tn || !el.hasAttribute('data-tensor') || el.getAttribute('data-tensor') === tn) el.classList.add('is-on'); });
      }
      const listed = h.onlyListed ? new Set((h.edges || []).map((k) => k.split('@')[0])) : null;
      const inListed = (el) => { const e = el.closest('[data-edge], [data-edge-tag]'); return !!e && listed.has(e.getAttribute('data-edge') || e.getAttribute('data-edge-tag')); };
      for (const t of h.tensors || []) svg.querySelectorAll('[data-tensor="' + cssq(t) + '"].ad-edge, [data-tensor="' + cssq(t) + '"].ad-tag, [data-tensor-glyph="' + cssq(t) + '"]').forEach((el) => { if (!listed || inListed(el)) el.classList.add('is-on'); });
      // los grupos que contienen nodos activos no se atenúan
      for (const g of view.spec.groups || []) {
        if ((h.nodes || []).some((id) => { const n = (view.spec.nodes || []).find((x) => x.id === id); return n && inside(n, g); })) { const gr = svg.querySelector('[data-group="' + g.id + '"]'); if (gr) gr.classList.add('is-on'); }
      }
    }
    // Modo mini (drills): en vez de encoger todo el diagrama, encuadra lo resaltado (+ contexto) a escala ≥ 0.85.
    function miniFocus(h) {
      const view = ctl.view; if (!view) return;
      const spec = view.spec, g = view.geo;
      const ids = new Set((h && h.nodes) || []);
      for (const k of (h && h.edges) || []) k.split('@')[0].split('>').forEach((x) => ids.add(x));
      for (const e of spec.edges || []) if (h && e.tensor && (h.tensors || []).indexOf(e.tensor) >= 0) { ids.add(e.from); ids.add(e.to); }
      const rs = Array.from(ids).map((id) => g.nodes[id] || g.groups[id]).filter(Boolean);
      if (!rs.length) { sizeViewport(); fit(false); return; }
      const pad = 36;
      const x0 = Math.min(...rs.map((r) => r.x)) - pad, y0 = Math.min(...rs.map((r) => r.y)) - pad;
      const x1 = Math.max(...rs.map((r) => r.x + r.w)) + pad, y1 = Math.max(...rs.map((r) => r.y + r.h)) + pad;
      const cw = vp.clientWidth || 400;
      const k = Math.min(1, Math.max(0.85, cw / (x1 - x0)));
      const vh = clamp((y1 - y0) * k, 200, 380);
      vp.style.height = Math.round(vh) + 'px';
      const w = cw / k, hh = vh / k;
      setVB({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - hh / 2, w, h: hh });
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
      // st.tensorsOn = 'edges': los tensores del paso (y la fila de la tabla de trace) solo encienden las aristas
      // listadas (fase 6: k-rope va en las tres aristas del caché; el paso del prefill no debe encender las del decode)
      ctl.hl = { nodes: st.nodes || [], edges: st.edges || [], tensors: st.tensors || [], onlyListed: st.tensorsOn === 'edges' };
      applyHighlight(ctl.hl);
      walkBar.querySelector('.ad-walk-n').textContent = 'Paso ' + (w.i + 1) + ' de ' + w.spec.steps.length;
      // fase 10 (revisión): las claves sin prefijo del texto siguen la config DIBUJADA (lora-overview con r = 64, dpo-step con LoRA)
      walkBar.querySelector('.ad-walk-text').innerHTML = combSafe(qResolve(st.text || '', opts.config || spec0.config));
      walkBar.querySelector('.ad-walk-prev').disabled = w.i === 0;
      walkBar.querySelector('.ad-walk-next').disabled = w.i === w.spec.steps.length - 1;
      const M = ATLAS.MathTex; if (M && M.typeset) try { M.typeset(walkBar.querySelector('.ad-walk-text')); } catch (e) { /* sin MathJax */ }
      try {
        document.dispatchEvent(new CustomEvent('atlas:diagram-tensor', { detail: { diagram: ctl.rootId, config: opts.config || spec0.config, tensors: st.tensors || [] } }));
        document.querySelectorAll('tr.is-walk').forEach((tr) => tr.classList.remove('is-walk'));
        for (const t of st.tensors || []) document.querySelectorAll('tr[data-tensor="' + cssq(t) + '"]').forEach((tr) => tr.classList.add('is-walk'));
      } catch (e) { /* sin tabla de trace */ }
      // En el teléfono el paso activo se acerca (texto ≥ 11 px); con zoom manual, se centra.
      const ids = (st.nodes || []).concat(...(st.edges || []).map((k) => k.split('@')[0].split('>')));
      if (isMobile()) focusBox(ids, 0.96);
      else if (ctl.zoomed) focusBox(ids);
    }
    function focusBox(ids, minK) {
      const g = ctl.view.geo; const rs = ids.map((id) => g.nodes[id]).filter(Boolean);
      if (!rs.length) return;
      const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
      const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
      const vb = ctl.vb, s = vpSize();
      let w = vb.w, h = vb.h;
      if (minK) {
        const r = rectVB({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        w = Math.min(r.w, s.w / minK); h = w * s.h / s.w;
      }
      setVB({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
    }
    function buildWalkBar() {
      walkBar.innerHTML = '';
      const top = H('div', { class: 'ad-walk-top' }, walkBar);
      H('span', { class: 'ad-walk-label' }, top, htmlSub(ctl.walk.spec.label || 'Recorrido'));
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
    function onDocEsc(ev) { if (ev.key === 'Escape' && !ev.defaultPrevented && fig.classList.contains('ad--fs') && !fig.contains(ev.target)) toggleFull(false); }
    function toggleFull(force) {
      const on = force != null ? force : !fig.classList.contains('ad--fs');
      fig.classList.toggle('ad--fs', on);
      document.documentElement.classList.toggle('ad-noscroll', on);
      // Escape cierra la pantalla completa aunque el foco no esté dentro de la figura (fase 5, revisión n21)
      document.removeEventListener('keydown', onDocEsc);
      if (on) document.addEventListener('keydown', onDocEsc);
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
      // flechas: por las aristas con forma (data, y desde la fase 3 también cross/query/skip: la memoria de DETR)
      const edges = (ctl.view.spec.edges || []).filter((e) => SHAPED[e.kind || 'data'] || ctl.view.spec.kind === 'map');
      const goEdge = (e) => {
        const el = edgeEl(e);
        if (el && el.hasAttribute('tabindex')) { el.focus({ preventScroll: false }); showTipAt({ edge: edgeKey(e), tensor: e.tensor, el }); return true; }
        return false;
      };
      if (t.node) {
        const e = fwd ? edges.find((x) => x.from === t.node) : edges.find((x) => x.to === t.node);
        if (!e) return;
        if (!goEdge(e)) { const n = ctl.view.nodeEls[fwd ? e.to : e.from]; if (n) n.focus(); }
      } else if (t.edge) {
        // ←/→ recorren las aristas hermanas (mismo origen, p. ej. Q, K y V); ↓/↑ van al destino/origen
        const [from, to] = t.edge.split('>');
        const sib = edges.filter((x) => x.from === from);
        const i = sib.findIndex((x) => edgeKey(x) === t.edge && (!t.tensor || x.tensor === t.tensor));
        if ((k === 'ArrowRight' || k === 'ArrowLeft') && sib.length > 1 && i >= 0) {
          const j = (i + (k === 'ArrowRight' ? 1 : sib.length - 1)) % sib.length;
          hideTip(); goEdge(sib[j]);
          return;
        }
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
      ro = new ResizeObserver(() => {
        const w = vp.clientWidth; if (Math.abs(w - lastW) < 2) return; lastW = w;
        if (ctl.mode === 'mini' && ctl.hl) { miniFocus(ctl.hl); return; }
        // fase 10 (revisión): si la figura cruza los 640 px y la vista tiene grilla angosta, se vuelve a dibujar
        if (ctl.view && ctl.view.spec && ctl.view.spec.mobileGrid && narrowNow() !== ctl.narrow) { redraw(); return; }
        const z = ctl.zoomed, keep = ctl.vb; sizeViewport(); if (z && keep) setVB(keep); else fit(false);
      });
      ro.observe(body);
    }
    const onWinResize = () => { if (fig.classList.contains('ad--fs')) fit(false); };
    on(root, 'resize', onWinResize);

    // Vista inicial: ajustada; en el teléfono, con zoom sobre spec.mobileFocus si existe (p. ej. el núcleo del mapa).
    // initialVB() = esa vista (sin aplicarla): la usan el montaje, expandTo y la animación de volver (collapseTo).
    function initialVB() {
      const spec = ctl.view && ctl.view.spec;
      const from = spec && spec.mobileFocusFrom && ctl.view.from ? spec.mobileFocusFrom[ctl.view.from] : null;
      const ids = spec && isMobile() && ctl.mode === 'full' && !fig.classList.contains('ad--fs') ? from || spec.mobileFocus : null;
      const rs = (ids || []).map((id) => ctl.view.geo.nodes[id] || ctl.view.geo.groups[id]).filter(Boolean);
      if (!rs.length) return fitVB();
      // mobileFocusPad (u): margen extra arriba a la izquierda (p. ej. para que entre el título de un carril)
      const mp = (spec.mobileFocusPad || 0) * U;
      const x0 = Math.min(...rs.map((r) => r.x)) - mp, y0 = Math.min(...rs.map((r) => r.y)) - mp, x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
      return rectVB({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    function initialView() { setVB(initialVB()); }
    ctl.initialView = initialView;

    // ---- montaje inicial
    mountView(diagramId);
    sizeViewport();
    initialView();
    if (root.requestAnimationFrame) root.requestAnimationFrame(() => { if (ctl.destroyed) return; if (ctl.mode === 'mini' && ctl.hl) { miniFocus(ctl.hl); return; } sizeViewport(); if (!ctl.zoomed) initialView(); });

    function inside(n, g) { return n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h; }

    // enlace con config pendiente (pendingXref) cuyo destino cuelga de este diagrama: se adopta esa config
    function takeXref() {
      const p = pendingXref;
      if (!p || !p.diagram || Date.now() - p.t > 20000) return false;
      const all = ATLAS.diagrams ? Object.values(ATLAS.diagrams()) : [];
      const desc = (id) => all.filter((d) => d.parent === id).flatMap((d) => [d.id].concat(desc(d.id)));
      if ([ctl.rootId].concat(desc(ctl.rootId)).indexOf(p.diagram) < 0) return false;
      const sp = ATLAS.diagram(p.diagram);
      if (!sp || (Array.isArray(sp.configs) && sp.configs.indexOf(p.config) < 0)) return false;
      try { runFor(p.config); } catch (e) { return false; }
      pendingXref = null;
      reqConfig = p.config;
      ctl.xref = p;
      return true;
    }

    const api = {
      el: fig,
      get view() { return ctl.stack[ctl.stack.length - 1]; },
      expand: (id) => expandTo(id),
      collapse: () => collapseTo(ctl.stack.length - 2),
      focusNode(nodeId, o) {
        o = o || {};
        if (takeXref()) redraw();
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
      highlight(h) { ctl.hl = h || null; applyHighlight(ctl.hl); if (ctl.mode === 'mini') miniFocus(ctl.hl); },
      clearHighlight() { ctl.hl = null; applyHighlight(null); if (ctl.mode === 'mini') miniFocus(null); },
      setSlot(slotId, text, state) {
        const st = { text: text == null || text === '' ? '?' : String(text), state: state || (text ? 'filled' : 'empty') };
        ctl.slotState[slotId] = st;
        const el = ctl.view && ctl.view.svg.querySelector('[data-slot="' + cssq(slotId) + '"]');
        if (el) layoutSlot(el, ctl.slots[slotId] || {}, st);   // actualización ligera: no redibuja la vista
      },
      startWalk(walkId) {
        if (ctl.mode !== 'full') return;
        // fase 8: un id de recorrido desconocido (p. ej. 'forward' en una vista cuyo recorrido es 'sampling') usa el primero
        const w = walkSpec(walkId) || (spec0.walks || [])[0] || null;
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
        if (ctl.zoomed) fit(true);
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
        clearTimeout(ctl.hintTimer);
        if (ro) ro.disconnect();
        for (const [el, ev, fn, o] of ctl.listeners) el.removeEventListener(ev, fn, o);
        document.removeEventListener('keydown', onDocEsc);
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
      const run = runFor(f.getAttribute('data-config') || spec.config);
      f.querySelectorAll('[data-edge] .ad-shape-num, [data-edge] .ad-shape-sym, [data-tensor-glyph] .ad-shape-num, [data-tensor-glyph] .ad-shape-sym').forEach((tEl) => {
        const id = tEl.getAttribute('data-tensor');
        const refCfg = tEl.closest('[data-config]') && tEl.closest('[data-config]').getAttribute('data-config');
        const ovEl = tEl.closest('[data-ov]');
        const base = refCfg && refCfg !== (f.getAttribute('data-config') || spec.config) ? runFor(refCfg) : run;
        const t = (ovEl ? ovRun(base, JSON.parse(ovEl.getAttribute('data-ov'))) : base).tensors[id];
        const want = t ? plainSub(shapeText(t, tEl.classList.contains('ad-shape-num') ? 'num' : 'sym')) : '(tensor desconocido)';
        if (tEl.textContent !== want) bad.push({ diagram: spec.id, edge: (tEl.closest('[data-edge]') || {}).getAttribute ? tEl.closest('[data-edge]').getAttribute('data-edge') : null, tensor: id, got: tEl.textContent, want });
      });
    }
    return bad;
  }

  ATLAS.ArchDiagram = { render, legend, plainSub, geometry, crossings, mapCheck, glyphSize, edgeKey, checkLabels, drawScene, mropeIds, numKey, UNIT: U, _route: routeEdge,
    _routeMap: (spec) => { const g = geometry(spec); return mapCache && mapCache.get(spec) || g; } };

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
    icon: drawIcon,
    // fase 8: texto de SVG con subíndices estilo TeX ("x_t", "ᾱ_{T−1}") como tspan rebajado (lo mismo que las etiquetas)
    rich: (t, s) => setRich(t, s),
    ICONS: ['house', 'tree', 'sun', 'boat', 'mountain', 'fish', 'car', 'star'],
    // fase 4: íconos extra (fuera de ICONS para no mover la semilla de similarity-matrix)
    ICONS_EXTRA: ['cat', 'dog', 'person'],
    // generador pseudoaleatorio con semilla (mulberry32) y normal estándar: datos ilustrativos reproducibles
    rng(seed) {
      let a = (seed >>> 0) || 1;
      const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      u.normal = () => { let x = 0, y = 0; while (!x) x = u(); while (!y) y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); };
      return u;
    },
    // ---- fase 3 (DETR): cajas normalizadas [cx, cy, w, h] ∈ [0, 1] (como las predice DETR)
    box: {
      xyxy: (b) => [b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2],
      area: (b) => Math.max(0, b[2]) * Math.max(0, b[3]),
      iou(a, b) { const A = boxXY(a), B = boxXY(b); const i = ovl(A, B); const u = a[2] * a[3] + b[2] * b[3] - i; return u > 0 ? i / u : 0; },
      // GIoU (Rezatofighi et al. 2019): IoU − |C \ (A ∪ B)| / |C|, C = la caja mínima que encierra a ambas. ∈ (−1, 1]
      giou(a, b) {
        const A = boxXY(a), B = boxXY(b); const i = ovl(A, B); const u = a[2] * a[3] + b[2] * b[3] - i;
        const c = (Math.max(A[2], B[2]) - Math.min(A[0], B[0])) * (Math.max(A[3], B[3]) - Math.min(A[1], B[1]));
        return (u > 0 ? i / u : 0) - (c > 0 ? (c - u) / c : 0);
      },
      l1: (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]),
    },
    // Asignación óptima 1 a 1 (algoritmo húngaro, O(n²·m), potenciales): cost = n filas × m columnas con n ≤ m.
    // Devuelve col[i] = columna asignada a la fila i (cada columna a lo sumo una vez) y el costo total.
    hungarian(cost) {
      const n = cost.length, m = n ? cost[0].length : 0;
      if (!n) return { col: [], total: 0 };
      if (n > m) throw new Error('hungarian: hace falta filas ≤ columnas');
      const INF = 1e18, u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
      for (let i = 1; i <= n; i++) {
        p[0] = i; let j0 = 0;
        const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
        do {
          used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
          for (let j = 1; j <= m; j++) if (!used[j]) {
            const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
            if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
            if (minv[j] < delta) { delta = minv[j]; j1 = j; }
          }
          for (let j = 0; j <= m; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
          j0 = j1;
        } while (p[j0] !== 0);
        do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
      }
      const col = new Array(n).fill(-1);
      for (let j = 1; j <= m; j++) if (p[j]) col[p[j] - 1] = j - 1;
      return { col, total: col.reduce((s, j, i) => s + cost[i][j], 0) };
    },
    // Escena de detección procedural (sin imágenes externas): fondo + objetos de DET_OBJECTS con sus cajas
    // (normalizadas). (x, y, w, h) = rectángulo de la imagen en px. Devuelve el grupo.
    detScene(parent, x, y, w, h, objects) {
      const g = S('g', { class: 'viz-det-scene' }, parent);
      S('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(h), class: 'viz-det-sky' }, g);
      S('rect', { x: r1(x), y: r1(y + h * 0.66), width: r1(w), height: r1(h * 0.34), class: 'viz-det-ground' }, g);
      for (const o of objects) {
        const b = boxXY(o.box);
        const og = S('g', { transform: 'translate(' + r1(x + b[0] * w) + ',' + r1(y + b[1] * h) + ') scale(' + r1((b[2] - b[0]) * w / 40 * 1000) / 1000 + ',' + r1((b[3] - b[1]) * h / 40 * 1000) / 1000 + ')' }, g);
        drawIcon(og, o.icon, 0, 0, 40);
      }
      S('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(h), class: 'viz-det-frame' }, g);
      return g;
    },
    // Objetos de la escena sintética (orden de dibujo: el fondo primero). Los dos autos se solapan a
    // propósito (IoU ≈ 0.62, más que el duplicado más flojo de set-vs-nms, 0.52): ningún umbral fijo de
    // la NMS conserva los dos autos y a la vez borra todos los duplicados.
    DET_OBJECTS: [
      { icon: 'mountain', label: 'montaña', box: [0.62, 0.40, 0.32, 0.30] },
      { icon: 'house', label: 'casa', box: [0.18, 0.60, 0.20, 0.30] },
      { icon: 'tree', label: 'árbol', box: [0.38, 0.53, 0.11, 0.38] },
      { icon: 'car', label: 'auto', box: [0.60, 0.80, 0.17, 0.15] },
      { icon: 'car', label: 'auto', box: [0.63, 0.81, 0.17, 0.15] },
      { icon: 'sun', label: 'sol', box: [0.87, 0.16, 0.12, 0.18] },
      { icon: 'star', label: 'estrella', box: [0.10, 0.15, 0.08, 0.12] },
      { icon: 'boat', label: 'barco', box: [0.88, 0.62, 0.13, 0.17] },
      { icon: 'fish', label: 'pez', box: [0.44, 0.88, 0.12, 0.09] },
      { icon: 'star', label: 'estrella', box: [0.30, 0.12, 0.07, 0.11] },
    ],
  };
  // ---- fase 8 (difusión): utilidades matemáticas puras para las visualizaciones (sin DOM)
  // Agenda de ruido de la config del calculador (β lineal o "scaled linear" de SD) y un juguete 2-D exacto: datos = mezcla
  // de gaussianas isotrópicas (N(μ_k, s²I)), para la que el ε-predictor óptimo (VP/DDPM) y la velocidad óptima (flujo
  // rectificado, x_t = (1−t)·x₀ + t·ε) tienen forma cerrada: los muestreadores corren con el "modelo perfecto" y lo que se
  // ve es solo el efecto del muestreador y del número de pasos (ilustrativo).
  ATLAS.Viz.diff = (function () {
    const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(+o[k]) && o[k] !== '' && o[k] != null) return +o[k]; return undefined; };
    // agenda: betas y ᾱ_t (t = 0…T−1, como diffusers: alphas_cumprod[t])
    function schedule(b0, b1, T, kind) {
      const betas = new Float64Array(T), abar = new Float64Array(T);
      let p = 1;
      for (let i = 0; i < T; i++) {
        const f = T > 1 ? i / (T - 1) : 0;
        betas[i] = kind === 'scaled_linear' ? Math.pow(Math.sqrt(b0) + f * (Math.sqrt(b1) - Math.sqrt(b0)), 2) : b0 + f * (b1 - b0);
        p *= 1 - betas[i];
        abar[i] = p;
      }
      return { T, b0, b1, kind, betas, abar };
    }
    // agenda de una config del calculador (campos betaStart/betaEnd/trainSteps/betaSchedule o sus alias)
    function scheduleOf(configId) {
      const A = ATLAS.Arch;
      let c = null;
      try { c = A && A.run ? A.run(configId).config : null; } catch (e) { c = null; }
      const s = c && (c.scheduler || c.sched || c);
      const b0 = pick(s, ['betaStart', 'beta_start', 'beta0', 'betaMin']), b1 = pick(s, ['betaEnd', 'beta_end', 'beta1', 'betaMax']);
      const T = pick(s, ['trainSteps', 'trainTimesteps', 'numTrainTimesteps', 'num_train_timesteps', 'Ttrain', 'timesteps']);
      if (!(b0 > 0 && b1 > b0 && T > 1)) return null;
      const kind = String((s && (s.betaSchedule || s.beta_schedule || s.schedule)) || 'scaled_linear').replace('-', '_');
      return Object.assign(schedule(b0, b1, Math.round(T), kind), { configId, label: (c && c.label) || configId });
    }
    // pasos de inferencia de mayor a menor. 'trailing' (por omisión): t = T − 1 − round(i·T / n), el primero en T − 1 (con
    // pocos pasos se empieza de verdad desde ruido); 'leading' = diffusers DDIM/PNDM con steps_offset = 1: t = i·⌊T / n⌋ + 1
    // (con 1 paso sería t = 1: casi sin ruido, el defecto que señalan Lin et al. 2023)
    function timesteps(T, n, spacing) {
      const out = [];
      if (spacing === 'leading') { const k = Math.floor(T / n); for (let i = n - 1; i >= 0; i--) out.push(Math.min(T - 1, i * k + 1)); return out; }
      for (let i = 0; i < n; i++) out.push(Math.max(0, T - 1 - Math.round(i * T / n)));
      return out;
    }
    // ---- mezcla de gaussianas: modes = [{mu:[x, y], w, cls}], s = desvío de cada modo
    function comps(g, cls) { const ms = g.modes.filter((m) => cls == null || m.cls === cls); const W = ms.reduce((a, m) => a + (m.w || 1), 0); return ms.map((m) => ({ mu: m.mu, w: (m.w || 1) / W })); }
    function post(cs, x, mean, varr) {
      // pesos de cada componente dado x (en log para que no se anulen)
      const lg = cs.map((c, k) => { const d0 = x[0] - mean(c)[0], d1 = x[1] - mean(c)[1]; return Math.log(c.w) - (d0 * d0 + d1 * d1) / (2 * varr); });
      const mx = Math.max(...lg); const e = lg.map((v) => Math.exp(v - mx)); const S = e.reduce((a, b) => a + b, 0);
      return e.map((v) => v / S);
    }
    // VP: x_t = √ᾱ·x₀ + √(1−ᾱ)·ε → ε̂(x, ᾱ) = E[ε | x_t = x]
    function epsHat(g, x, ab, cls) {
      const cs = comps(g, cls), s2 = g.s * g.s, v = ab * s2 + 1 - ab, sa = Math.sqrt(ab);
      const w = post(cs, x, (c) => [sa * c.mu[0], sa * c.mu[1]], v);
      let e0 = 0, e1 = 0;
      cs.forEach((c, k) => { e0 += w[k] * (x[0] - sa * c.mu[0]); e1 += w[k] * (x[1] - sa * c.mu[1]); });
      const f = Math.sqrt(1 - ab) / v;
      return [f * e0, f * e1];
    }
    const x0From = (x, e, ab) => [(x[0] - Math.sqrt(1 - ab) * e[0]) / Math.sqrt(ab), (x[1] - Math.sqrt(1 - ab) * e[1]) / Math.sqrt(ab)];
    // guía libre de clasificador (convención de diffusers: w = 1 es sin guía): ε̃ = ε_u + w·(ε_c − ε_u)
    function epsGuided(g, x, ab, cls, w) {
      if (cls == null || w === 0) return epsHat(g, x, ab, w === 0 ? null : cls);
      const u = epsHat(g, x, ab, null), c = epsHat(g, x, ab, cls);
      return [u[0] + w * (c[0] - u[0]), u[1] + w * (c[1] - u[1])];
    }
    // DDIM generalizado (η = 0: determinista, el ODE de flujo de probabilidad; η = 1: DDPM ancestral) con ᾱ de la agenda y
    // los pasos ts (de mayor a menor); el último paso devuelve x̂₀. opts = {eta, rng, cls, w}. Devuelve la trayectoria.
    function sampleVP(g, xT, abar, ts, opts) {
      const o = opts || {};
      let x = xT.slice();
      const path = [x.slice()];
      for (let i = 0; i < ts.length; i++) {
        const ab = abar[ts[i]], abp = i + 1 < ts.length ? abar[ts[i + 1]] : 1;
        const e = epsGuided(g, x, ab, o.cls, o.w == null ? 1 : o.w);
        const x0 = x0From(x, e, ab);
        const sig = (o.eta || 0) * Math.sqrt((1 - abp) / (1 - ab)) * Math.sqrt(Math.max(0, 1 - ab / abp));
        const c = Math.sqrt(Math.max(0, 1 - abp - sig * sig));
        const z = sig > 0 && o.rng ? [o.rng.normal(), o.rng.normal()] : [0, 0];
        x = [Math.sqrt(abp) * x0[0] + c * e[0] + sig * z[0], Math.sqrt(abp) * x0[1] + c * e[1] + sig * z[1]];
        path.push(x.slice());
      }
      return path;
    }
    // flujo rectificado: x_t = (1−t)·x₀ + t·ε, v = ε − x₀ → v̂(x, t) = E[ε − x₀ | x_t = x]
    function velHat(g, x, t, cls) {
      const cs = comps(g, cls), s2 = g.s * g.s, a = 1 - t, v = a * a * s2 + t * t;
      const w = post(cs, x, (c) => [a * c.mu[0], a * c.mu[1]], v);
      let r0 = 0, r1_ = 0;
      cs.forEach((c, k) => {
        const d0 = x[0] - a * c.mu[0], d1 = x[1] - a * c.mu[1];
        const ex0 = c.mu[0] + a * s2 / v * d0, ex1 = c.mu[1] + a * s2 / v * d1;   // E[x₀ | x, k]
        const ee0 = t / v * d0, ee1 = t / v * d1;                                 // E[ε | x, k]
        r0 += w[k] * (ee0 - ex0); r1_ += w[k] * (ee1 - ex1);
      });
      return [r0, r1_];
    }
    function velGuided(g, x, t, cls, w) {
      if (cls == null || w === 0) return velHat(g, x, t, w === 0 ? null : cls);
      const u = velHat(g, x, t, null), c = velHat(g, x, t, cls);
      return [u[0] + w * (c[0] - u[0]), u[1] + w * (c[1] - u[1])];
    }
    // Euler de t = 1 (ruido) a t = 0 (datos) en n pasos iguales
    function sampleFlow(g, x1, n, opts) {
      const o = opts || {};
      let x = x1.slice();
      const path = [x.slice()];
      for (let i = 0; i < n; i++) {
        const t = 1 - i / n, dt = 1 / n;
        const v = velGuided(g, x, t, o.cls, o.w == null ? 1 : o.w);
        x = [x[0] - dt * v[0], x[1] - dt * v[1]];
        path.push(x.slice());
      }
      return path;
    }
    const nearestMode = (g, p) => g.modes.reduce((b, m) => { const d = Math.hypot(p[0] - m.mu[0], p[1] - m.mu[1]); return d < b.d ? { d, m } : b; }, { d: Infinity, m: null });
    return { schedule, scheduleOf, timesteps, epsHat, epsGuided, x0From, sampleVP, velHat, velGuided, sampleFlow, nearestMode };
  })();

  function boxXY(b) { return [b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2]; }
  function ovl(A, B) { return Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])) * Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1])); }

  // Íconos procedurales (sin imágenes externas) para las visualizaciones de CLIP: (x, y) esquina, size lado.
  // Colores de los tokens del tema (var(--…)), así que cambian con el tema sin redibujar.
  function drawIcon(parent, name, x, y, size) {
    const g = S('g', { class: 'viz-icon viz-icon--' + name, transform: 'translate(' + r1(x) + ',' + r1(y) + ') scale(' + r1(size / 40 * 100) / 100 + ')' }, parent);
    S('rect', { x: 0, y: 0, width: 40, height: 40, rx: 4, class: 'viz-icon-bg' }, g);
    const p = (d, fill, extra) => S('path', Object.assign({ d, fill, stroke: 'none' }, extra || {}), g);
    if (name === 'house') { p('M8 20L20 9L32 20Z', 'var(--op-attn)'); p('M11 20H29V33H11Z', 'var(--op-conv)'); p('M18 25H23V33H18Z', 'var(--surface)'); }
    else if (name === 'tree') { p('M18 24H22V34H18Z', 'var(--op-conv)'); S('circle', { cx: 20, cy: 17, r: 10, fill: 'var(--op-mlp)' }, g); }
    else if (name === 'sun') { S('circle', { cx: 20, cy: 20, r: 7.5, fill: 'var(--warn)' }, g); p('M20 5V10M20 30V35M5 20H10M30 20H35M9.4 9.4L12.9 12.9M27.1 27.1L30.6 30.6M9.4 30.6L12.9 27.1M27.1 12.9L30.6 9.4', 'none', { stroke: 'var(--warn)', 'stroke-width': 2.4, 'stroke-linecap': 'round' }); }
    else if (name === 'boat') { p('M7 26H33L28 33H12Z', 'var(--op-conv)'); p('M20 7V25H9Z', 'var(--op-embed)'); p('M22 11V25H31Z', 'var(--mod-img)'); }
    else if (name === 'mountain') { p('M4 33L16 12L24 24L28 18L37 33Z', 'var(--muted)'); p('M16 12L20.2 19.4L17.6 18L15.4 20L13 17.3Z', 'var(--surface)'); }
    else if (name === 'fish') { p('M8 20C13 11 25 11 30 20C25 29 13 29 8 20Z', 'var(--op-head)'); p('M30 20L37 13V27Z', 'var(--op-head)'); S('circle', { cx: 14, cy: 18, r: 1.8, fill: 'var(--surface)' }, g); }
    else if (name === 'car') { p('M6 27V21L11 20L15 14H26L31 20L35 21V27Z', 'var(--op-attn)'); S('circle', { cx: 13, cy: 28, r: 3.6, fill: 'var(--ink)' }, g); S('circle', { cx: 28, cy: 28, r: 3.6, fill: 'var(--ink)' }, g); p('M16.5 16H20V20H13.8Z', 'var(--surface)'); }
    else if (name === 'star') { p('M20 6L24 16H35L26 22.5L29.5 33L20 26.5L10.5 33L14 22.5L5 16H16Z', 'var(--warn)'); }
    // fase 4 (Grounding DINO, YOLO-World): gato, perro y persona, para los prompts "cat . dog ."
    else if (name === 'cat') {
      p('M9 34C9 25 12 20 20 20C28 20 31 25 31 34Z', 'var(--op-conv)');                         // cuerpo
      p('M11 10L14 3.5L18 9Z', 'var(--op-conv)'); p('M22 9L26 3.5L29 10Z', 'var(--op-conv)');  // orejas
      S('circle', { cx: 20, cy: 13.5, r: 8, fill: 'var(--op-conv)' }, g);                         // cabeza
      p('M31 32C36 31 37 25 34 22', 'none', { stroke: 'var(--op-conv)', 'stroke-width': 2.4, 'stroke-linecap': 'round' });   // cola
      S('circle', { cx: 17, cy: 12.5, r: 1.3, fill: 'var(--surface)' }, g); S('circle', { cx: 23, cy: 12.5, r: 1.3, fill: 'var(--surface)' }, g);
      p('M12 16.5H6M12 18H7M28 16.5H34M28 18H33', 'none', { stroke: 'var(--ink)', 'stroke-width': 0.8, 'stroke-linecap': 'round' });
    } else if (name === 'dog') {
      p('M6 24C6 19 9 17 14 17H28C32 17 34 19 34 24V27H6Z', 'var(--op-embed)');                 // lomo
      p('M8 26H12V34H8ZM28 26H32V34H28Z', 'var(--op-embed)');                                   // patas
      S('circle', { cx: 30, cy: 13, r: 6.5, fill: 'var(--op-embed)' }, g);                         // cabeza
      p('M34 13.5H38.5Q39.5 13.5 39.5 15V17H34Z', 'var(--op-embed)');                          // hocico
      p('M25.2 9.5L26.6 2.5L30.5 7.6Z', 'var(--op-embed)');                                     // oreja
      p('M6 21C3 19 2.5 15.5 4 13', 'none', { stroke: 'var(--op-embed)', 'stroke-width': 2.4, 'stroke-linecap': 'round' });   // cola
      S('circle', { cx: 31.5, cy: 11.5, r: 1.2, fill: 'var(--surface)' }, g); S('circle', { cx: 39.2, cy: 14.6, r: 1.1, fill: 'var(--ink)' }, g);
    } else if (name === 'person') {
      S('circle', { cx: 20, cy: 8.5, r: 5, fill: 'var(--op-head)' }, g);
      p('M13 15H27L29 26H25L24 35H16L15 26H11Z', 'var(--op-head)');
    }
    return g;
  }
})(typeof window !== 'undefined' ? window : globalThis);
