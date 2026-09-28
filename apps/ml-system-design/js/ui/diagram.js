/* =============================================================================
   Ronda de Diseño ML — js/ui/diagram.js
   MSD.Diagram.render(spec, {id, title, caption}) → HTMLElement   (SPEC §5.4)

   Diagrama de arquitectura en SVG a partir de una spec en unidades de grilla
   (1 unidad = 10 px). Carriles (lanes) como bandas de fondo, nodos con forma
   según su tipo, aristas ortogonales con ruteo automático o por puntos `via`,
   selección de nodos con el "por qué está aquí", recorridos guiados (flows) y
   una lista textual de componentes como alternativa accesible.
   Colores: solo variables CSS (css/components.css) → sigue el tema claro/oscuro.
   Nunca lanza: si algo falla, devuelve un aviso visible.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  const SVGNS = 'http://www.w3.org/2000/svg';
  const U = 10;          // px por unidad de grilla
  const PAD = 8;         // margen del viewBox para trazos, anillos y píldoras en el borde
  const STUB = 14;       // tramo mínimo al salir/entrar de un nodo en rutas con rodeo
  const CORNER = 6;      // radio de las esquinas redondeadas de las aristas
  let seq = 0;

  const KIND_NAMES = {
    client: 'Cliente', edge: 'Entrada', service: 'Servicio', model: 'Modelo', gpu: 'GPU',
    store: 'Almacenamiento', queue: 'Cola', job: 'Job batch', monitor: 'Observabilidad',
    external: 'Externo', human: 'Humanos',
  };
  const EDGE_NAMES = { online: 'Camino online', offline: 'Camino offline', monitor: 'Monitoreo', async: 'Asíncrono', neutral: 'Otro' };
  const LANE_KINDS = { online: 1, offline: 1, monitor: 1, neutral: 1 };
  const SIDES = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
  const ICON_EXPAND = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/></svg>';

  // ------------------------------------------------------------ utilidades
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const str = (v) => (v == null ? '' : String(v));
  const round = (v) => Math.round(v * 10) / 10;

  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function h(tag, attrs, kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'on') { for (const ev of Object.keys(v)) e.addEventListener(ev, v[ev]); }
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    add(e, kids);
    return e;
  }

  function s(tag, attrs, kids) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'text') e.textContent = v;
        else e.setAttribute(k, String(v));
      }
    }
    add(e, kids);
    return e;
  }

  function add(parent, kids) {
    if (kids == null) return;
    if (Array.isArray(kids)) { kids.forEach((k) => add(parent, k)); return; }
    parent.appendChild(typeof kids === 'string' ? document.createTextNode(kids) : kids);
  }

  // HTML en línea → texto plano (para <text> del SVG y aria-label). DOMParser no ejecuta nada.
  let parser = null;
  function htmlText(html) {
    const src = str(html);
    if (!/[<&]/.test(src)) return src.replace(/\s+/g, ' ').trim();
    try {
      parser = parser || new DOMParser();
      // Sin prefijo de doctype/body: el HTML en línea permitido (b, code, span…) cae en el body igual,
      // y así dist/artifact.html no contiene etiquetas de documento ni dentro de un string.
      return str(parser.parseFromString(src, 'text/html').body.textContent).replace(/\s+/g, ' ').trim();
    } catch (e) {
      return src.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    }
  }

  // ------------------------------------------------------ medición de texto
  let mctx; // undefined: sin probar · null: no hay canvas → estimación por caracteres
  function textWidth(text, font, size, mono) {
    if (mctx === undefined) {
      try { const c = document.createElement('canvas'); mctx = (c.getContext && c.getContext('2d')) || null; } catch (e) { mctx = null; }
    }
    if (mctx) {
      try { mctx.font = font; const w = mctx.measureText(text).width; if (isNum(w)) return w; } catch (e) { /* estimación abajo */ }
    }
    return text.length * size * (mono ? 0.6 : 0.56);
  }

  function families() {
    let body = '', mono = '';
    try {
      const cs = getComputedStyle(document.documentElement);
      body = cs.getPropertyValue('--font-body').trim();
      mono = cs.getPropertyValue('--font-mono').trim();
    } catch (e) { /* valores por defecto */ }
    return {
      body: body || "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
      mono: mono || "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
    };
  }

  // Promesa única: se resuelve cuando las fuentes web terminan de cargar (o de inmediato si no aplica).
  let fontsPromise = null;
  function fontsLoaded() {
    if (fontsPromise) return fontsPromise;
    try {
      const fs = document.fonts;
      if (!fs || typeof fs.load !== 'function') { fontsPromise = Promise.resolve(false); return fontsPromise; }
      const f = families();
      fontsPromise = Promise.all([
        fs.load('600 15px ' + f.body), fs.load('500 12px ' + f.body), fs.load('400 12px ' + f.mono), fs.load('500 11px ' + f.mono),
      ]).then((r) => r.some((x) => x && x.length), () => false);
    } catch (e) { fontsPromise = Promise.resolve(false); }
    return fontsPromise;
  }

  // Parte un texto en piezas: palabras (separadas por espacio) y, dentro de palabras largas,
  // cortes permitidos después de / . _ - , : + (el separador queda al final de la pieza).
  // Un "·" o "|" suelto es un separador: si cae en un corte de línea, se omite.
  // Otra puntuación suelta (/, +, →, &…) se pega a la palabra anterior para no empezar línea.
  const SEP = /^[·|•]$/;
  const GLUE = /^(?:[/+&=:→←↔]|-|–|—)$/;
  function pieces(text) {
    const out = [];
    str(text).split(/\s+/).filter(Boolean).forEach((word) => {
      if (SEP.test(word)) { out.push({ t: word, sp: true, sep: true }); return; }
      const prev = out[out.length - 1];
      if (GLUE.test(word) && prev && !prev.sep) { prev.t += ' ' + word; return; }
      const parts = word.match(/[^/._\-,:+]+[/._\-,:+]*|[/._\-,:+]+/g) || [word];
      parts.forEach((p, i) => out.push({ t: p, sp: i === 0 }));
    });
    return out;
  }
  function joinPieces(ps) {
    let a = 0, b = ps.length;
    while (a < b && ps[a].sep) a++;
    while (b > a && ps[b - 1].sep) b--;
    return ps.slice(a, b).map((p, i) => (i && p.sp ? ' ' : '') + p.t).join('');
  }

  // Envuelve en ≤ maxLines líneas de ancho ≤ maxW. Devuelve null si no cabe (salvo force).
  function wrapText(text, maxW, maxLines, measure, force) {
    const ps = pieces(text);
    if (!ps.length) return [];
    const lines = [];
    let cur = [];
    for (const p of ps) {
      const cand = cur.concat([p]);
      if (measure(joinPieces(cand)) <= maxW) { cur = cand; continue; }
      if (p.sep) { if (cur.length) lines.push(cur); cur = []; continue; }
      if (cur.length) lines.push(cur);
      cur = [p];
      if (measure(joinPieces(cur)) > maxW && !force) return null;
    }
    if (cur.length) lines.push(cur);
    const out = lines.map(joinPieces).filter(Boolean);
    if (out.length > maxLines && !force) return null;
    // Dos líneas: corte más equilibrado; se prefiere cortar en un separador "·" y que la
    // primera línea sea la más larga (evita "API" / "Gateway / ALB").
    if (out.length === 2 && ps.length > 2) {
      let best = null;
      for (let k = 1; k < ps.length; k++) {
        const a = joinPieces(ps.slice(0, k)), b = joinPieces(ps.slice(k));
        if (!a || !b) continue;
        const wa = measure(a), wb = measure(b);
        if (wa > maxW || wb > maxW) continue;
        const atSep = ps[k].sep || ps[k - 1].sep;
        const score = Math.max(wa, wb) + (wb > wa ? (wb - wa) * 0.25 : 0) - (atSep ? maxW * 0.2 : 0);
        if (!best || score < best.score - 0.5) best = { score, lines: [a, b] };
      }
      if (best) return best.lines;
    }
    return out;
  }

  // Variantes de tamaño/líneas, de la preferida a la más compacta:
  // [tamaño label, líneas label, tamaño sub, líneas sub]
  // Tamaños nominales algo mayores que el texto de la página: el SVG suele mostrarse al
  // 70–80 % de su tamaño natural dentro de la columna de lectura (≈ 11–12 px efectivos).
  const VARIANTS = [
    [15, 1, 12, 1], [15, 1, 12, 2], [15, 2, 12, 1], [15, 2, 12, 2],
    [14, 2, 11.5, 2], [13, 3, 11, 2], [12, 3, 10.5, 3],
  ];
  const LH_LABEL = 1.25, LH_SUB = 1.3, GAP_SUB = 3;

  function layoutText(label, sub, maxW, maxH, fam) {
    const mk = (weight, size, family, mono) => {
      const font = weight + ' ' + size + 'px ' + family;
      return (t) => textWidth(t, font, size, mono);
    };
    const tryVariant = (v, force) => {
      const [ls, ll, ss, sl] = v;
      const L = wrapText(label, maxW, ll, mk(600, ls, fam.body, false), force);
      if (!L) return null;
      const S = sub ? wrapText(sub, maxW, sl, mk(400, ss, fam.mono, true), force) : [];
      if (!S) return null;
      const hgt = L.length * ls * LH_LABEL + (S.length ? GAP_SUB + S.length * ss * LH_SUB : 0);
      if (hgt > maxH && !force) return null;
      return { ls, ss, L, S, hgt, widthOf: { L: mk(600, ls, fam.body, false), S: mk(400, ss, fam.mono, true) } };
    };
    for (const v of VARIANTS) { const r = tryVariant(v, false); if (r) return r; }
    return tryVariant(VARIANTS[VARIANTS.length - 1], true);
  }

  // ------------------------------------------------------------- geometría
  function boxOf(n) {
    const x = n.x * U, y = n.y * U, w = n.w * U, hh = n.h * U;
    return { x, y, w, h: hh, cx: x + w / 2, cy: y + hh / 2, r: x + w, b: y + hh };
  }
  const horiz = (side) => side === 'l' || side === 'r';
  const sign = (v) => (v > 0.01 ? 1 : v < -0.01 ? -1 : 0);

  function portPoint(b, side, along) {
    switch (side) {
      case 'l': return [b.x, isNum(along) ? along : b.cy];
      case 'r': return [b.r, isNum(along) ? along : b.cy];
      case 't': return [isNum(along) ? along : b.cx, b.y];
      default: return [isNum(along) ? along : b.cx, b.b];
    }
  }
  function span(b, side) { return horiz(side) ? [b.y, b.b] : [b.x, b.r]; }
  function inSpan(b, side, v, m) { const [a, c] = span(b, side); return v >= a + m && v <= c - m; }

  // Lado de la caja b que mira hacia el punto p (el eje con mayor separación gana).
  function sideFacing(b, p) {
    const dx = p[0] < b.x ? b.x - p[0] : p[0] > b.r ? p[0] - b.r : 0;
    const dy = p[1] < b.y ? b.y - p[1] : p[1] > b.b ? p[1] - b.b : 0;
    if (dx === 0 && dy === 0) {
      const ddx = p[0] - b.cx, ddy = p[1] - b.cy;
      return Math.abs(ddx) / b.w >= Math.abs(ddy) / b.h ? (ddx >= 0 ? 'r' : 'l') : (ddy >= 0 ? 'b' : 't');
    }
    if (dx >= dy) return p[0] < b.x ? 'l' : 'r';
    return p[1] < b.y ? 't' : 'b';
  }

  // Lados automáticos: enfrentados; recto si hay solape en el otro eje; si no, codo H-V-H o V-H-V.
  function autoSides(A, B) {
    const gR = B.x - A.r, gL = A.x - B.r, gD = B.y - A.b, gU = A.y - B.b;
    const gx = Math.max(gR, gL), gy = Math.max(gD, gU);
    if (gx > 0 && (gy <= 0 || gx >= gy)) return gR > 0 ? ['r', 'l'] : ['l', 'r'];
    if (gy > 0) return gD > 0 ? ['b', 't'] : ['t', 'b'];
    const dx = B.cx - A.cx, dy = B.cy - A.cy;
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? ['r', 'l'] : ['l', 'r']) : (dy >= 0 ? ['b', 't'] : ['t', 'b']);
  }

  function simplify(pts) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (q && Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01) continue;
      out.push(p);
    }
    for (let i = out.length - 2; i >= 1; i--) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      if ((Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) || (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01)) out.splice(i, 1);
    }
    return out;
  }

  // Ruta ortogonal entre dos puertos sin puntos intermedios.
  function routeDirect(A, sA, S, B, sB, E) {
    const [dxS, dyS] = SIDES[sA], [dxE, dyE] = SIDES[sB];
    if (horiz(sA) && horiz(sB)) {
      const forward = dxS === -dxE && sign(E[0] - S[0]) === dxS;
      if (forward && Math.abs(S[1] - E[1]) < 0.5) return [S, E];
      if (forward && Math.abs(E[0] - S[0]) >= 12) { const mx = (S[0] + E[0]) / 2; return [S, [mx, S[1]], [mx, E[1]], E]; }
      if (dxS === dxE) { const x = dxS > 0 ? Math.max(S[0], E[0]) + STUB : Math.min(S[0], E[0]) - STUB; return [S, [x, S[1]], [x, E[1]], E]; }
      const my = A.b < B.y ? (A.b + B.y) / 2 : B.b < A.y ? (B.b + A.y) / 2 : Math.max(A.b, B.b) + STUB;
      const x1 = S[0] + dxS * STUB, x2 = E[0] + dxE * STUB;
      return [S, [x1, S[1]], [x1, my], [x2, my], [x2, E[1]], E];
    }
    if (!horiz(sA) && !horiz(sB)) {
      const forward = dyS === -dyE && sign(E[1] - S[1]) === dyS;
      if (forward && Math.abs(S[0] - E[0]) < 0.5) return [S, E];
      if (forward && Math.abs(E[1] - S[1]) >= 12) { const my = (S[1] + E[1]) / 2; return [S, [S[0], my], [E[0], my], E]; }
      if (dyS === dyE) { const y = dyS > 0 ? Math.max(S[1], E[1]) + STUB : Math.min(S[1], E[1]) - STUB; return [S, [S[0], y], [E[0], y], E]; }
      const mx = A.r < B.x ? (A.r + B.x) / 2 : B.r < A.x ? (B.r + A.x) / 2 : Math.max(A.r, B.r) + STUB;
      const y1 = S[1] + dyS * STUB, y2 = E[1] + dyE * STUB;
      return [S, [S[0], y1], [mx, y1], [mx, y2], [E[0], y2], E];
    }
    if (horiz(sA)) { // sale horizontal, entra vertical → L si la geometría lo permite
      if (sign(E[0] - S[0]) === dxS && sign(S[1] - E[1]) === dyE) return [S, [E[0], S[1]], E];
      const x1 = S[0] + dxS * STUB, y2 = E[1] + dyE * STUB;
      return [S, [x1, S[1]], [x1, y2], [E[0], y2], E];
    }
    if (sign(E[1] - S[1]) === dyS && sign(S[0] - E[0]) === dxE) return [S, [S[0], E[1]], E];
    const y1 = S[1] + dyS * STUB, x2 = E[0] + dxE * STUB;
    return [S, [S[0], y1], [x2, y1], [x2, E[1]], E];
  }

  // Ruta a través de puntos `via`: la primera pierna sigue la dirección de salida,
  // las intermedias alternan y la última entra perpendicular al lado destino.
  function routeVia(S, sA, via, E, sB) {
    const out = [S];
    let cur = S, prevH = horiz(sA);
    via.forEach((q, k) => {
      if (Math.abs(cur[0] - q[0]) > 0.01 && Math.abs(cur[1] - q[1]) > 0.01) {
        const hFirst = k === 0 ? horiz(sA) : !prevH;
        const c = hFirst ? [q[0], cur[1]] : [cur[0], q[1]];
        out.push(c);
        prevH = Math.abs(c[1] - q[1]) < 0.01;
      } else {
        prevH = Math.abs(cur[1] - q[1]) < 0.01;
      }
      out.push(q);
      cur = q;
    });
    if (Math.abs(cur[0] - E[0]) > 0.01 && Math.abs(cur[1] - E[1]) > 0.01) out.push(horiz(sB) ? [cur[0], E[1]] : [E[0], cur[1]]);
    out.push(E);
    return simplify(out);
  }

  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const toward = (a, b, d) => { const L = dist(a, b) || 1; return [a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L]; };
  const fmt = (p) => round(p[0]) + ',' + round(p[1]);

  function pathD(pts, trimStart, trimEnd) {
    if (pts.length < 2) return '';
    const P = pts.map((p) => p.slice());
    if (trimStart) P[0] = toward(P[0], P[1], Math.min(trimStart, dist(P[0], P[1]) / 3));
    if (trimEnd) { const n = P.length; P[n - 1] = toward(P[n - 1], P[n - 2], Math.min(trimEnd, dist(P[n - 1], P[n - 2]) / 3)); }
    let d = 'M' + fmt(P[0]);
    for (let i = 1; i < P.length - 1; i++) {
      const r = Math.min(CORNER, dist(P[i - 1], P[i]) / 2, dist(P[i], P[i + 1]) / 2);
      d += ' L' + fmt(toward(P[i], P[i - 1], r)) + ' Q' + fmt(P[i]) + ' ' + fmt(toward(P[i], P[i + 1], r));
    }
    return d + ' L' + fmt(P[P.length - 1]);
  }

  // ------------------------------------------------------ normalización
  function normNodes(list, problems) {
    const out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach((n, i) => {
      if (!n || typeof n !== 'object') { problems.push('nodo ' + i + ' inválido'); return; }
      const id = str(n.id) || ('n' + i);
      if (seen[id]) { problems.push('nodo repetido: ' + id); return; }
      const w = isNum(n.w) && n.w > 0 ? n.w : 16, hh = isNum(n.h) && n.h > 0 ? n.h : 7;
      const node = {
        id, kind: KIND_NAMES[n.kind] ? n.kind : 'service',
        label: htmlText(n.label) || id, sub: htmlText(n.sub), note: str(n.note), badge: htmlText(n.badge),
        x: isNum(n.x) ? n.x : 0, y: isNum(n.y) ? n.y : 0, w, h: hh,
      };
      node.b = boxOf(node);
      seen[id] = node;
      out.push(node);
    });
    return out;
  }

  function normLanes(list) {
    return (Array.isArray(list) ? list : []).filter((l) => l && isNum(l.x) && isNum(l.y) && isNum(l.w) && isNum(l.h) && l.w > 0 && l.h > 0)
      .map((l, i) => ({ id: str(l.id) || ('lane' + i), label: htmlText(l.label), kind: LANE_KINDS[l.kind] ? l.kind : 'neutral', x: l.x, y: l.y, w: l.w, h: l.h }));
  }

  function normEdges(list, byId, problems) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((e, i) => {
      if (!e || !byId[e.from] || !byId[e.to]) { problems.push('arista ' + i + ' con nodo inexistente'); return; }
      if (e.from === e.to) { problems.push('arista ' + i + ' a sí misma'); return; }
      const kind = EDGE_NAMES[e.kind] ? e.kind : 'neutral';
      const via = (Array.isArray(e.via) ? e.via : []).filter((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])).map((p) => [p[0] * U, p[1] * U]);
      out.push({
        i, from: e.from, to: e.to, key: e.from + '>' + e.to, kind,
        dashed: e.dashed != null ? !!e.dashed : (kind === 'async' || kind === 'monitor'),
        label: htmlText(e.label), bidir: !!e.bidir, via,
        fromSide: SIDES[e.fromSide] ? e.fromSide : null, toSide: SIDES[e.toSide] ? e.toSide : null,
      });
    });
    return out;
  }

  function normFlows(list, byId, edgeKeys) {
    return (Array.isArray(list) ? list : []).filter((f) => f && Array.isArray(f.steps) && f.steps.length).map((f, i) => ({
      id: str(f.id) || ('flow' + i),
      label: htmlText(f.label) || ('Recorrido ' + (i + 1)),
      steps: f.steps.filter((st) => st && typeof st === 'object').map((st) => ({
        nodes: (Array.isArray(st.nodes) ? st.nodes : []).filter((n) => byId[n]),
        edges: (Array.isArray(st.edges) ? st.edges : []).filter((k) => edgeKeys[k]),
        text: str(st.text),
      })),
    })).filter((f) => f.steps.length);
  }

  // ------------------------------------------------------------- ruteo
  function planEdges(edges, byId) {
    // 1) lados y puertos "fijos" (alineados con un via)
    edges.forEach((e) => {
      const A = byId[e.from].b, B = byId[e.to].b;
      e.A = A; e.B = B;
      if (e.via.length) {
        const first = e.via[0], last = e.via[e.via.length - 1];
        e.sA = e.fromSide || sideFacing(A, first);
        e.sB = e.toSide || sideFacing(B, last);
        const aA = horiz(e.sA) ? first[1] : first[0];
        const aB = horiz(e.sB) ? last[1] : last[0];
        if (inSpan(A, e.sA, aA, 4)) e.pA = aA;
        if (inSpan(B, e.sB, aB, 4)) e.pB = aB;
      } else if (e.fromSide && e.toSide) {
        e.sA = e.fromSide; e.sB = e.toSide;
      } else if (e.fromSide) {
        e.sA = e.fromSide;
        const P = portPoint(A, e.sA); const d = SIDES[e.sA];
        e.sB = sideFacing(B, [P[0] + d[0] * STUB * 2, P[1] + d[1] * STUB * 2]);
      } else if (e.toSide) {
        e.sB = e.toSide;
        const P = portPoint(B, e.sB); const d = SIDES[e.sB];
        e.sA = sideFacing(A, [P[0] + d[0] * STUB * 2, P[1] + d[1] * STUB * 2]);
      } else {
        [e.sA, e.sB] = autoSides(A, B);
      }
    });
    // 2) reparte puertos libres que comparten nodo y lado (ordenados por la posición del otro extremo)
    const groups = {};
    const other = (e, end) => {
      if (end === 'A') { const p = e.via.length ? e.via[0] : [e.B.cx, e.B.cy]; return horiz(e.sA) ? p[1] : p[0]; }
      const p = e.via.length ? e.via[e.via.length - 1] : [e.A.cx, e.A.cy]; return horiz(e.sB) ? p[1] : p[0];
    };
    edges.forEach((e) => {
      if (!isNum(e.pA)) (groups[e.from + '|' + e.sA] = groups[e.from + '|' + e.sA] || []).push({ e, end: 'A', k: other(e, 'A') });
      if (!isNum(e.pB)) (groups[e.to + '|' + e.sB] = groups[e.to + '|' + e.sB] || []).push({ e, end: 'B', k: other(e, 'B') });
    });
    Object.keys(groups).forEach((g) => {
      const list = groups[g];
      if (list.length < 2) return;
      list.sort((a, b) => a.k - b.k);
      const first = list[0], box = first.end === 'A' ? first.e.A : first.e.B, side = first.end === 'A' ? first.e.sA : first.e.sB;
      const [lo, hi] = span(box, side);
      const len = hi - lo, mid = (lo + hi) / 2, n = list.length;
      const sp = Math.min(14, (len - 12) / (n - 1));
      list.forEach((it, i) => {
        const v = mid + (i - (n - 1) / 2) * sp;
        if (it.end === 'A') it.e.spreadA = v; else it.e.spreadB = v;
      });
    });
    // 3) rutas
    edges.forEach((e) => {
      const A = e.A, B = e.B;
      let pA = isNum(e.pA) ? e.pA : e.spreadA, pB = isNum(e.pB) ? e.pB : e.spreadB;
      if (!e.via.length) {
        // enfrentados con solape → línea recta dentro del solape
        const facingH = horiz(e.sA) && horiz(e.sB) && SIDES[e.sA][0] === -SIDES[e.sB][0] && sign((e.sA === 'r' ? B.x - A.r : A.x - B.r)) > 0;
        const facingV = !horiz(e.sA) && !horiz(e.sB) && SIDES[e.sA][1] === -SIDES[e.sB][1] && sign((e.sA === 'b' ? B.y - A.b : A.y - B.b)) > 0;
        if (facingH || facingV) {
          const lo = Math.max(span(A, e.sA)[0], span(B, e.sB)[0]) + 6, hi = Math.min(span(A, e.sA)[1], span(B, e.sB)[1]) - 6;
          if (hi >= lo) {
            const pref = isNum(pA) ? pA : isNum(pB) ? pB : null;
            const v = pref != null && pref >= lo && pref <= hi ? pref : (isNum(pB) && pB >= lo && pB <= hi ? pB : (lo + hi) / 2);
            // si ninguno de los dos está repartido, centra en el solape
            pA = pB = (e.spreadA == null && e.spreadB == null) ? clampMid(A, B, e.sA, lo, hi) : v;
          }
        }
      }
      const S = portPoint(A, e.sA, pA), E = portPoint(B, e.sB, pB);
      e.pts = e.via.length ? routeVia(S, e.sA, e.via, E, e.sB) : simplify(routeDirect(A, e.sA, S, B, e.sB, E));
    });
  }

  // Centro del solape, pero si el centro de A (o de B) cae dentro, se prefiere para que la línea salga centrada.
  function clampMid(A, B, sA, lo, hi) {
    const ca = horiz(sA) ? A.cy : A.cx, cb = horiz(sA) ? B.cy : B.cx;
    if (ca >= lo && ca <= hi) return ca;
    if (cb >= lo && cb <= hi) return cb;
    return (lo + hi) / 2;
  }

  // Punto medio del tramo más largo (para la píldora de la etiqueta).
  function labelAnchor(pts) {
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = dist(pts[i], pts[i + 1]);
      if (!best || L > best.L + 0.5) best = { L, x: (pts[i][0] + pts[i + 1][0]) / 2, y: (pts[i][1] + pts[i + 1][1]) / 2, horiz: Math.abs(pts[i][1] - pts[i + 1][1]) < 0.01 };
    }
    return best;
  }

  // ---------------------------------------------------------- formas de nodo
  // Devuelve {els, pad:{l,r,t,b}} — el pad reduce la caja útil para el texto.
  function nodeShape(n) {
    const { x, y, w } = n.b, hh = n.b.h;
    const pad = { l: 10, r: 10, t: 7, b: 7 };
    const els = [];
    const rect = (cls, extra) => s('rect', Object.assign({ class: cls, x, y, width: w, height: hh, rx: 5 }, extra || {}));
    switch (n.kind) {
      case 'store': {
        const ry = Math.max(4, Math.min(7, hh * 0.12));
        els.push(s('path', { class: 'dg-node__shape', d: `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} V${y + hh - ry} A${w / 2},${ry} 0 0 1 ${x},${y + hh - ry} Z` }));
        els.push(s('path', { class: 'dg-node__detail', d: `M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}` }));
        pad.t = 2 * ry + 3; pad.b = ry + 4;
        break;
      }
      case 'queue': {
        els.push(rect('dg-node__shape', { rx: 3 }));
        [7, 13, 19].forEach((d) => els.push(s('line', { class: 'dg-node__detail', x1: x + w - d, y1: y + 1, x2: x + w - d, y2: y + hh - 1 })));
        pad.r = 26;
        break;
      }
      case 'gpu': {
        els.push(rect('dg-node__shape', { rx: 3 }));
        const pins = [];
        const px = [10, 16], py = [9, 15];
        px.forEach((d) => { [x + d, x + w - d].forEach((xx) => { pins.push(`M${xx},${y - 4}V${y}`, `M${xx},${y + hh}V${y + hh + 4}`); }); });
        if (hh >= 44) py.forEach((d) => { [y + d, y + hh - d].forEach((yy) => { pins.push(`M${x - 4},${yy}H${x}`, `M${x + w},${yy}H${x + w + 4}`); }); });
        els.push(s('path', { class: 'dg-node__pins', d: pins.join('') }));
        els.push(s('circle', { class: 'dg-node__dot', cx: x + 7, cy: y + 7, r: 1.8 }));
        pad.l = 14; pad.r = 14;
        break;
      }
      case 'human': {
        els.push(rect('dg-node__shape', { rx: hh / 2 }));
        pad.l = pad.r = Math.max(12, hh * 0.3);
        if (w >= 110) {
          const gx = x + Math.max(14, hh * 0.32), gy = y + hh / 2;
          els.push(s('circle', { class: 'dg-node__glyph', cx: gx, cy: gy - 4, r: 2.8 }));
          els.push(s('path', { class: 'dg-node__glyph', d: `M${gx - 5},${gy + 6} a5,5 0 0 1 10,0` }));
          pad.l = gx - x + 9; pad.r = Math.max(pad.r, 12);
        }
        break;
      }
      case 'model':
        els.push(rect('dg-node__shape'));
        els.push(s('rect', { class: 'dg-node__detail', x: x + 3, y: y + 3, width: w - 6, height: hh - 6, rx: 3 }));
        pad.l = pad.r = 13; pad.t = pad.b = 9;
        break;
      case 'job': {
        const f = 11, r = 5;
        els.push(s('path', { class: 'dg-node__shape', d: `M${x + r},${y} H${x + w - f} L${x + w},${y + f} V${y + hh - r} Q${x + w},${y + hh} ${x + w - r},${y + hh} H${x + r} Q${x},${y + hh} ${x},${y + hh - r} V${y + r} Q${x},${y} ${x + r},${y} Z` }));
        els.push(s('path', { class: 'dg-node__fold', d: `M${x + w - f},${y} V${y + f} H${x + w} Z` }));
        break;
      }
      default:
        els.push(rect('dg-node__shape'));
    }
    return { els, pad };
  }

  // ------------------------------------------------------------- render
  function render(spec, opts) {
    opts = opts || {};
    try {
      return build(spec && typeof spec === 'object' ? spec : {}, opts);
    } catch (err) {
      try { if (root.console) console.warn('[MSD.Diagram] no se pudo dibujar el diagrama', opts.id || '', err); } catch (e) { /* nada */ }
      return fallback(opts, err);
    }
  }

  function fallback(opts, err) {
    try {
      return h('figure', { class: 'dg dg--error' }, [
        opts.title ? h('figcaption', { class: 'dg__head' }, h('span', { class: 'dg__title', text: str(opts.title) })) : null,
        h('p', { class: 'dg__warn', role: 'note', text: 'No se pudo dibujar este diagrama' + (err && err.message ? ': ' + err.message : '.') }),
      ]);
    } catch (e) {
      return document.createElement('div');
    }
  }

  function build(spec, opts) {
    const uid = 'dg' + (++seq) + (opts.id ? '-' + String(opts.id).replace(/[^A-Za-z0-9_-]/g, '') : '');
    const problems = [];
    const fam = families();
    const nodes = normNodes(spec.nodes, problems);
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });
    const lanes = normLanes(spec.lanes);
    const edges = normEdges(spec.edges, byId, problems);
    const edgeKeys = {};
    edges.forEach((e) => { edgeKeys[e.key] = true; });
    const flows = normFlows(spec.flows, byId, edgeKeys);

    // Lienzo: el de la spec, o el que contiene a todos los nodos y carriles.
    let Wu = isNum(spec.width) && spec.width > 0 ? spec.width : 0;
    let Hu = isNum(spec.height) && spec.height > 0 ? spec.height : 0;
    if (!Wu || !Hu) {
      let mx = 10, my = 10;
      nodes.forEach((n) => { mx = Math.max(mx, n.x + n.w + 2); my = Math.max(my, n.y + n.h + 2); });
      lanes.forEach((l) => { mx = Math.max(mx, l.x + l.w); my = Math.max(my, l.y + l.h); });
      Wu = Wu || mx; Hu = Hu || my;
    }
    const W = Wu * U, H = Hu * U;
    const vbW = W + 2 * PAD, vbH = H + 2 * PAD;
    const title = htmlText(opts.title);

    planEdges(edges, byId);

    // ---------- SVG
    const svg = s('svg', {
      class: 'dg__svg', viewBox: `${-PAD} ${-PAD} ${vbW} ${vbH}`, width: vbW, height: vbH,
      role: 'group', 'aria-label': 'Diagrama' + (title ? ': ' + title : ''), focusable: 'false',
    });
    // min-width = 70 % del tamaño natural (legible en móvil, con scroll horizontal); max = natural.
    svg.style.setProperty('--dg-min', Math.round(vbW * 0.7) + 'px');
    svg.style.setProperty('--dg-max', vbW + 'px');

    const defs = s('defs');
    const grid = s('pattern', { id: uid + '-grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
    grid.appendChild(s('circle', { class: 'dg-grid', cx: 1, cy: 1, r: 0.9 }));
    defs.appendChild(grid);
    const markerId = (kind, hl) => uid + '-mk-' + kind + (hl ? '-hl' : '');
    Object.keys(EDGE_NAMES).forEach((kind) => {
      [false, true].forEach((hl) => {
        const size = hl ? 11 : 9;
        const m = s('marker', { id: markerId(kind, hl), viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: size, markerHeight: size, markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
        m.appendChild(s('path', { class: 'dg-mk dg-e-' + kind, d: 'M0,1 L10,5 L0,9 L2.8,5 Z' }));
        defs.appendChild(m);
      });
    });
    svg.appendChild(defs);
    svg.appendChild(s('rect', { class: 'dg-bg', x: -PAD, y: -PAD, width: vbW, height: vbH, fill: `url(#${uid}-grid)` }));

    // Carriles
    const gLanes = s('g', { class: 'dg-lanes', 'aria-hidden': 'true' });
    lanes.forEach((l) => {
      const g = s('g', { class: 'dg-lane dg-l-' + l.kind });
      g.appendChild(s('rect', { class: 'dg-lane__band', x: l.x * U, y: l.y * U, width: l.w * U, height: l.h * U, rx: 6 }));
      if (l.label) g.appendChild(s('text', { class: 'dg-lane__label', x: l.x * U + 10, y: l.y * U + 18, text: l.label.toUpperCase() }));
      gLanes.appendChild(g);
    });
    svg.appendChild(gLanes);

    // Aristas
    const gEdges = s('g', { class: 'dg-edges', 'aria-hidden': 'true' });
    const gLabels = s('g', { class: 'dg-elabels', 'aria-hidden': 'true' });
    edges.forEach((e) => {
      const g = s('g', { class: 'dg-edge dg-e-' + e.kind + (e.dashed ? ' is-dashed' : ''), 'data-key': e.key });
      const d = pathD(e.pts, e.bidir ? 1 : 0, 1);
      e.line = s('path', { class: 'dg-edge__line', d, 'marker-end': `url(#${markerId(e.kind, false)})`, 'marker-start': e.bidir ? `url(#${markerId(e.kind, false)})` : null });
      e.flow = s('path', { class: 'dg-edge__flow', d: pathD(e.pts, e.bidir ? 12 : 3, 12) });
      g.appendChild(e.line);
      g.appendChild(e.flow);
      gEdges.appendChild(g);
      e.g = g;
      if (e.label) {
        e.lg = s('g', { class: 'dg-elabel dg-e-' + e.kind, 'data-key': e.key });
        gLabels.appendChild(e.lg);
      }
    });
    svg.appendChild(gEdges);

    // Nodos
    const gNodes = s('g', { class: 'dg-nodes' });
    nodes.forEach((n) => {
      const aria = n.label + (n.sub ? ', ' + n.sub : '') + '. ' + (KIND_NAMES[n.kind] || '');
      const g = s('g', { class: 'dg-node dg-k-' + n.kind, tabindex: 0, role: 'button', 'aria-pressed': 'false', 'aria-label': aria, 'data-node': n.id });
      const b = n.b;
      g.appendChild(s('rect', { class: 'dg-node__ring', x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, rx: n.kind === 'human' ? (b.h + 8) / 2 : 8 }));
      g.appendChild(s('rect', { class: 'dg-node__focus', x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: n.kind === 'human' ? (b.h + 12) / 2 : 9 }));
      const shape = nodeShape(n);
      shape.els.forEach((el) => g.appendChild(el));
      n.pad = shape.pad;
      n.textG = s('g', { class: 'dg-node__text' });
      g.appendChild(n.textG);
      n.badgeG = s('g', { class: 'dg-node__badge' });
      g.appendChild(n.badgeG);
      g.appendChild(s('title', { text: n.label + (n.sub ? ' — ' + n.sub : '') }));
      n.g = g;
      gNodes.appendChild(g);
    });
    svg.appendChild(gNodes);
    svg.appendChild(gLabels);

    // Texto dependiente de la fuente (se rehace cuando cargan las fuentes web)
    function drawText() {
      const f = families();
      nodes.forEach((n) => drawNodeText(n, f));
      edges.forEach((e) => { if (e.lg) drawEdgeLabel(e, f); });
    }
    drawText();

    // ---------- figura
    const fig = h('figure', { class: 'dg', 'data-diagram': opts.id || null, 'aria-label': title || opts.caption ? null : 'Diagrama' });
    if (title || opts.caption) {
      fig.appendChild(h('figcaption', { class: 'dg__head' }, [
        h('span', { class: 'dg__eyebrow', text: 'Diagrama' }),
        title ? h('span', { class: 'dg__title', text: title }) : null,
        opts.caption ? h('span', { class: 'dg__caption', html: str(opts.caption) }) : null,
      ]));
    }

    // Barra superior: recorridos (si hay) a la izquierda, "Ampliar" a la derecha.
    let flowBtns = [];
    const toolbar = h('div', { class: 'dg__bar' });
    if (flows.length) {
      const group = h('div', { class: 'dg__flows', role: 'group', 'aria-label': 'Recorridos guiados' }, h('span', { class: 'dg__flows-label', text: 'Recorrer:' }));
      flows.forEach((f, i) => {
        const b = h('button', { type: 'button', class: 'dg__flowbtn', 'aria-pressed': 'false', 'data-flow': f.id, on: { click: () => toggleFlow(i) } }, [
          h('span', { class: 'dg__flowbtn-dot', 'aria-hidden': 'true' }), h('span', { text: f.label }),
          h('span', { class: 'dg__flowbtn-n', text: f.steps.length + (f.steps.length === 1 ? ' paso' : ' pasos') }),
        ]);
        flowBtns.push(b);
        group.appendChild(b);
      });
      toolbar.appendChild(group);
    }
    const expandLabel = h('span', { text: 'Ampliar' });
    const expandBtn = h('button', { type: 'button', class: 'dg__expand', 'aria-pressed': 'false', title: 'Ver el diagrama a tamaño completo', on: { click: () => setExpanded(!state.expanded) } }, [
      h('span', { class: 'dg__expand-ico', 'aria-hidden': 'true', html: ICON_EXPAND }), expandLabel,
    ]);
    toolbar.appendChild(expandBtn);
    fig.appendChild(toolbar);

    const scroller = h('div', { class: 'dg__scroll' }, svg);
    const canvas = h('div', { class: 'dg__canvas' }, scroller);
    if (!nodes.length) {
      // Spec vacía o inválida: aviso visible en lugar de un lienzo en blanco.
      toolbar.hidden = true;
      fig.appendChild(h('p', { class: 'dg__warn', role: 'note', text: 'Este diagrama no tiene componentes (spec vacía o inválida).' }));
      if (problems.length) fig.setAttribute('data-problems', problems.join(' · '));
      return fig;
    }
    // main = lienzo + leyenda · side = recorrido, nota y lista (en la vista ampliada ancha, dos columnas)
    const main = h('div', { class: 'dg__main' }, canvas);
    const side = h('div', { class: 'dg__side' });
    fig.appendChild(main);
    fig.appendChild(side);

    // Leyenda + pista de interacción
    const kindsUsed = [];
    edges.forEach((e) => { const k = e.kind === 'neutral' && e.dashed ? 'async' : e.kind; if (kindsUsed.indexOf(k) < 0) kindsUsed.push(k); });
    const order = ['online', 'offline', 'monitor', 'async', 'neutral'];
    kindsUsed.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const legend = h('div', { class: 'dg__legend' });
    if (kindsUsed.length) {
      const ul = h('ul', { class: 'dg__keys', 'aria-label': 'Tipos de flecha' });
      kindsUsed.forEach((k) => {
        const sw = s('svg', { class: 'dg__key-sw dg-e-' + k + (k === 'async' || k === 'monitor' ? ' is-dashed' : ''), viewBox: '0 0 28 10', width: 28, height: 10, 'aria-hidden': 'true' });
        sw.appendChild(s('path', { class: 'dg-edge__line', d: 'M1,5 H21' }));
        sw.appendChild(s('path', { class: 'dg-mk dg-e-' + k, d: 'M19,1.4 L27,5 L19,8.6 L21.2,5 Z' }));
        ul.appendChild(h('li', { class: 'dg__key' }, [sw, h('span', { text: EDGE_NAMES[k] })]));
      });
      legend.appendChild(ul);
    }
    const hint = h('p', { class: 'dg__hint' }, [
      h('span', { class: 'dg__hint-tap', text: nodes.length ? 'Selecciona un componente para ver por qué está ahí.' : '' }),
      h('span', { class: 'dg__hint-scroll', hidden: true, text: ' Desliza para ver todo el diagrama.' }),
    ]);
    legend.appendChild(hint);
    main.appendChild(legend);
    const scrollHint = hint.lastChild;

    // Panel del recorrido
    const stepFlow = h('span', { class: 'dg__step-flow' });
    const stepCount = h('span', { class: 'dg__step-count' });
    const stepBar = h('span', { class: 'dg__step-bar', 'aria-hidden': 'true' });
    const prevBtn = h('button', { type: 'button', class: 'dg__btn', on: { click: () => stepBy(-1) } }, [h('span', { 'aria-hidden': 'true', text: '←' }), 'Anterior']);
    const nextBtn = h('button', { type: 'button', class: 'dg__btn dg__btn--primary', on: { click: () => stepBy(1) } }, ['Siguiente', h('span', { 'aria-hidden': 'true', text: '→' })]);
    const exitBtn = h('button', { type: 'button', class: 'dg__btn dg__btn--quiet', on: { click: () => exitFlow(true) } }, 'Salir');
    const stepText = h('div', { class: 'dg__step-text', 'aria-live': 'polite' });
    const stepPanel = h('div', { class: 'dg__step', hidden: true, role: 'region', 'aria-label': 'Recorrido guiado' }, [
      h('div', { class: 'dg__step-head' }, [
        h('div', { class: 'dg__step-meta' }, [stepFlow, h('span', { class: 'dg__step-pos' }, [h('span', { class: 'dg__step-word', text: 'Paso ' }), stepCount]), stepBar]),
        h('div', { class: 'dg__step-btns' }, [prevBtn, nextBtn, exitBtn]),
      ]),
      stepText,
    ]);
    stepPanel.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight') { ev.preventDefault(); stepBy(1); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepBy(-1); }
    });
    side.appendChild(stepPanel);

    // Panel "Por qué está aquí"
    const noteTitle = h('span', { class: 'dg__note-title' });
    const noteSub = h('span', { class: 'dg__note-sub' });
    const noteBody = h('div', { class: 'dg__note-body' });
    const noteClose = h('button', { type: 'button', class: 'dg__x', 'aria-label': 'Cerrar la explicación', on: { click: () => select(null, true) } }, '×');
    const notePanel = h('div', { class: 'dg__note', hidden: true, role: 'region', 'aria-live': 'polite', 'aria-label': 'Por qué está aquí' }, [
      h('div', { class: 'dg__note-head' }, [h('p', { class: 'dg__note-h' }, [h('span', { class: 'dg__note-eyebrow', text: 'Por qué está aquí: ' }), noteTitle]), noteSub, noteClose]),
      noteBody,
    ]);
    side.appendChild(notePanel);

    // Lista "Componentes y por qué", agrupada por carril (centro del nodo dentro del carril)
    side.appendChild(componentList(nodes, lanes));

    if (problems.length) fig.setAttribute('data-problems', problems.join(' · '));

    // ---------- estado e interacción
    const state = { sel: null, flow: -1, step: 0, expanded: false };

    function paint() {
      let hlN = null, hlE = null, near = null;
      if (state.sel) {
        hlN = new Set([state.sel]); hlE = new Set(); near = new Set();
        edges.forEach((e) => { if (e.from === state.sel || e.to === state.sel) { hlE.add(e); near.add(e.from); near.add(e.to); } });
      } else if (state.flow >= 0) {
        const st = flows[state.flow].steps[state.step];
        hlN = new Set(st.nodes); hlE = new Set(); near = new Set();
        edges.forEach((e) => { if (st.edges.indexOf(e.key) >= 0) { hlE.add(e); near.add(e.from); near.add(e.to); } });
      }
      fig.classList.toggle('is-focusing', !!hlN);
      nodes.forEach((n) => {
        const on = !!(hlN && hlN.has(n.id));
        n.g.classList.toggle('is-hl', on);
        n.g.classList.toggle('is-near', !!(hlN && !on && near.has(n.id)));
        n.g.classList.toggle('is-sel', state.sel === n.id);
        n.g.setAttribute('aria-pressed', state.sel === n.id ? 'true' : 'false');
      });
      edges.forEach((e) => {
        const on = !!(hlE && hlE.has(e));
        e.g.classList.toggle('is-hl', on);
        if (e.lg) e.lg.classList.toggle('is-hl', on);
        const mk = `url(#${markerId(e.kind, on)})`;
        e.line.setAttribute('marker-end', mk);
        if (e.bidir) e.line.setAttribute('marker-start', mk);
      });
    }

    function select(id, focusBack) {
      const prev = state.sel;
      state.sel = id && byId[id] && prev !== id ? id : null;
      if (state.sel) {
        const n = byId[state.sel];
        notePanel.className = 'dg__note dg-k-' + n.kind;
        noteTitle.textContent = n.label;
        noteSub.textContent = n.sub || '';
        noteSub.hidden = !n.sub;
        noteBody.innerHTML = '';
        if (n.note) noteBody.innerHTML = n.note;
        else noteBody.appendChild(h('p', { class: 'dg__muted', text: 'Este componente no tiene nota todavía.' }));
        notePanel.hidden = false;
      } else {
        notePanel.hidden = true;
        if (focusBack && prev && byId[prev]) { try { byId[prev].g.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
      }
      paint();
    }

    function toggleFlow(i) {
      if (state.flow === i) { exitFlow(false); return; }
      state.flow = i; state.step = 0; state.sel = null; notePanel.hidden = true;
      showStep(true);
    }

    function exitFlow(focusBar) {
      const i = state.flow;
      state.flow = -1; state.step = 0;
      stepPanel.hidden = true;
      flowBtns.forEach((b) => b.setAttribute('aria-pressed', 'false'));
      paint();
      if (focusBar && flowBtns[i]) { try { flowBtns[i].focus(); } catch (e) { /* nada */ } }
    }

    function stepBy(d) {
      if (state.flow < 0) return;
      const n = flows[state.flow].steps.length;
      const next = Math.max(0, Math.min(n - 1, state.step + d));
      if (next === state.step) return;
      state.step = next;
      state.sel = null; notePanel.hidden = true;
      showStep(false);
    }

    function showStep(first) {
      const f = flows[state.flow], st = f.steps[state.step], n = f.steps.length;
      flowBtns.forEach((b, i) => b.setAttribute('aria-pressed', i === state.flow ? 'true' : 'false'));
      stepFlow.textContent = f.label;
      stepCount.textContent = (state.step + 1) + '/' + n;
      stepBar.innerHTML = '';
      for (let i = 0; i < n; i++) stepBar.appendChild(h('i', { class: i < state.step ? 'is-done' : i === state.step ? 'is-cur' : null }));
      stepText.innerHTML = st.text || '';
      prevBtn.disabled = state.step === 0;
      nextBtn.disabled = state.step === n - 1;
      stepPanel.hidden = false;
      paint();
      restartPulse();
      revealHighlighted(st);
      if (first) { try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
      else if (nextBtn.disabled && document.activeElement === nextBtn) { try { exitBtn.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
    }

    // Reinicia la animación de pulso de los nodos resaltados (una vez por paso).
    function restartPulse() {
      fig.classList.remove('is-pulsing');
      void fig.offsetWidth; // fuerza reflow para reiniciar la animación CSS
      fig.classList.add('is-pulsing');
    }

    // En pantallas angostas, desplaza el diagrama para que se vea lo resaltado.
    function revealHighlighted(st) {
      try {
        if (scroller.scrollWidth <= scroller.clientWidth + 2) return;
        const ids = st.nodes.slice();
        edges.forEach((e) => { if (st.edges.indexOf(e.key) >= 0) ids.push(e.from, e.to); });
        if (!ids.length) return;
        let lo = Infinity, hi = -Infinity;
        ids.forEach((id) => { const b = byId[id].b; lo = Math.min(lo, b.x); hi = Math.max(hi, b.r); });
        const scale = svg.getBoundingClientRect().width / vbW;
        const a = (lo + PAD) * scale, z = (hi + PAD) * scale;
        const view0 = scroller.scrollLeft, view1 = view0 + scroller.clientWidth;
        if (a >= view0 && z <= view1) return;
        const target = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, (a + z) / 2 - scroller.clientWidth / 2));
        scroller.scrollTo({ left: target, behavior: reducedMotion() ? 'auto' : 'smooth' });
      } catch (e) { /* no es crítico */ }
    }

    gNodes.addEventListener('click', (ev) => {
      const g = ev.target && ev.target.closest ? ev.target.closest('.dg-node') : null;
      if (g) { ev.stopPropagation(); select(g.getAttribute('data-node')); }
    });
    gNodes.addEventListener('keydown', (ev) => {
      const g = ev.target && ev.target.closest ? ev.target.closest('.dg-node') : null;
      if (!g) return;
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); select(g.getAttribute('data-node')); }
    });
    svg.addEventListener('click', (ev) => {
      if (!(ev.target && ev.target.closest && ev.target.closest('.dg-node')) && state.sel) select(null);
    });
    fig.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' && ev.key !== 'Esc') return;
      if (state.sel) { select(null, true); ev.stopPropagation(); }
      else if (state.expanded) { setExpanded(false); ev.stopPropagation(); }
      else if (state.flow >= 0) { exitFlow(true); ev.stopPropagation(); }
    });

    // Vista ampliada: la misma figura pasa a ocupar la ventana (sin mover nodos del DOM,
    // así la selección y los recorridos siguen funcionando). El foco no sale de la figura.
    // (El bloqueo de scroll de la página es CSS: html:has(.dg.is-expanded), así se libera solo
    // si el shell reemplaza la página mientras la vista está ampliada.)
    function keepFocus(ev) {
      if (!fig.isConnected) { setExpanded(false, true); return; }
      if (state.expanded && ev.target && !fig.contains(ev.target)) { try { expandBtn.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
    }
    function onNavigate() { setExpanded(false, true); }
    function setExpanded(on, quiet) {
      state.expanded = !!on;
      fig.classList.toggle('is-expanded', state.expanded);
      expandBtn.setAttribute('aria-pressed', state.expanded ? 'true' : 'false');
      expandLabel.textContent = state.expanded ? 'Cerrar' : 'Ampliar';
      expandBtn.title = state.expanded ? 'Volver al tamaño normal (Esc)' : 'Ver el diagrama a tamaño completo';
      try {
        const add = state.expanded ? 'addEventListener' : 'removeEventListener';
        document[add]('focusin', keepFocus);
        root[add]('hashchange', onNavigate);
        if (quiet) return;
        if (state.expanded) fig.scrollTop = 0;
        expandBtn.focus({ preventScroll: true });
        if (!state.expanded) fig.scrollIntoView({ block: 'nearest' });
      } catch (e) { /* nada */ }
      updateScrollHint();
    }

    // Pista "desliza" solo si realmente hay desborde horizontal.
    const updateScrollHint = () => { try { scrollHint.hidden = !(scroller.scrollWidth > scroller.clientWidth + 2); } catch (e) { /* nada */ } };
    try {
      if (typeof ResizeObserver === 'function') new ResizeObserver(updateScrollHint).observe(scroller);
      else if (root.addEventListener) root.addEventListener('resize', updateScrollHint);
    } catch (e) { /* nada */ }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(updateScrollHint);

    // Cuando llegan las fuentes web, vuelve a medir y acomodar el texto.
    fontsLoaded().then((changed) => { if (changed) { try { drawText(); } catch (e) { /* nada */ } } });

    return fig;
  }

  // ---------------------------------------------------------- texto de nodo
  function drawNodeText(n, fam) {
    const g = n.textG, b = n.b;
    while (g.firstChild) g.removeChild(g.firstChild);
    const maxW = Math.max(20, b.w - n.pad.l - n.pad.r);
    const maxH = Math.max(12, b.h - n.pad.t - n.pad.b);
    const L = layoutText(n.label, n.sub, maxW, maxH, fam);
    const cx = b.x + n.pad.l + maxW / 2;
    let y = b.y + n.pad.t + (maxH - L.hgt) / 2;
    const txt = s('text', { 'text-anchor': 'middle' });
    const line = (t, cls, size, lh, measure) => {
      const base = y + (size * lh) / 2 + size * 0.34;
      const attrs = { class: cls, x: round(cx), y: round(base), style: 'font-size:' + size + 'px', text: t };
      const w = measure(t);
      if (w > maxW + 0.5) { attrs.textLength = round(maxW); attrs.lengthAdjust = 'spacingAndGlyphs'; }
      txt.appendChild(s('tspan', attrs));
      y += size * lh;
    };
    L.L.forEach((t) => line(t, 'dg-node__label', L.ls, LH_LABEL, L.widthOf.L));
    if (L.S.length) { y += GAP_SUB; L.S.forEach((t) => line(t, 'dg-node__sub', L.ss, LH_SUB, L.widthOf.S)); }
    g.appendChild(txt);

    // Insignia: píldora sobre el borde superior derecho
    const bg = n.badgeG;
    while (bg.firstChild) bg.removeChild(bg.firstChild);
    if (n.badge) {
      const size = 11, font = '500 ' + size + 'px ' + fam.mono;
      const tw = textWidth(n.badge, font, size, true);
      const bw = Math.round(tw + 10), bh = 17;
      const bx = b.r - bw - (n.kind === 'gpu' ? 22 : 8), by = b.y - bh / 2;
      bg.appendChild(s('rect', { class: 'dg-node__badge-bg', x: bx, y: by, width: bw, height: bh, rx: 3 }));
      bg.appendChild(s('text', { class: 'dg-node__badge-tx', x: round(bx + bw / 2), y: round(by + bh / 2 + size * 0.35), 'text-anchor': 'middle', text: n.badge }));
    }
  }

  function drawEdgeLabel(e, fam) {
    const g = e.lg;
    while (g.firstChild) g.removeChild(g.firstChild);
    const a = labelAnchor(e.pts);
    if (!a) return;
    const size = 12, font = '500 ' + size + 'px ' + fam.body;
    const tw = textWidth(e.label, font, size, false);
    const w = Math.round(tw + 14), hh = 20;
    g.appendChild(s('rect', { class: 'dg-elabel__bg', x: round(a.x - w / 2), y: round(a.y - hh / 2), width: w, height: hh, rx: 10 }));
    g.appendChild(s('text', { class: 'dg-elabel__tx', x: round(a.x), y: round(a.y + size * 0.35), 'text-anchor': 'middle', style: 'font-size:' + size + 'px', text: e.label }));
  }

  // ------------------------------------------------- lista de componentes
  function componentList(nodes, lanes) {
    const groups = lanes.map((l) => ({ lane: l, items: [] }));
    const rest = { lane: null, items: [] };
    nodes.forEach((n) => {
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      const g = groups.find((gr) => cx >= gr.lane.x && cx <= gr.lane.x + gr.lane.w && cy >= gr.lane.y && cy <= gr.lane.y + gr.lane.h);
      (g || rest).items.push(n);
    });
    const all = groups.concat([rest]).filter((g) => g.items.length);
    const det = h('details', { class: 'dg__list' });
    det.appendChild(h('summary', { class: 'dg__list-sum' }, [
      h('span', { text: 'Componentes y por qué' }), h('span', { class: 'dg__list-n', text: nodes.length + (nodes.length === 1 ? ' componente' : ' componentes') }),
    ]));
    const body = h('div', { class: 'dg__groups' });
    all.forEach((g) => {
      const sec = h('div', { class: 'dg__group' + (g.lane ? ' dg-l-' + g.lane.kind : '') });
      if (g.lane || all.length > 1) sec.appendChild(h('p', { class: 'dg__group-title', text: g.lane ? (g.lane.label || 'Carril') : 'Otros componentes' }));
      const ul = h('ul', { class: 'dg__items' });
      g.items.forEach((n) => {
        ul.appendChild(h('li', { class: 'dg__item dg-k-' + n.kind }, [
          h('div', { class: 'dg__item-head' }, [
            h('span', { class: 'dg__item-sw', 'aria-hidden': 'true' }),
            h('span', { class: 'dg__item-label', text: n.label }),
            n.sub ? h('span', { class: 'dg__item-sub', text: n.sub }) : null,
            h('span', { class: 'dg__item-kind', text: KIND_NAMES[n.kind] || n.kind }),
          ]),
          n.note ? h('div', { class: 'dg__item-note', html: n.note }) : null,
        ]));
      });
      sec.appendChild(ul);
      body.appendChild(sec);
    });
    if (!all.length) body.appendChild(h('p', { class: 'dg__muted', text: 'Este diagrama no tiene componentes.' }));
    det.appendChild(body);
    return det;
  }

  MSD.Diagram = { render, KIND_NAMES, EDGE_NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
