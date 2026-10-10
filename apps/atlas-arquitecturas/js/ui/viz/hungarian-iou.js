/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/hungarian-iou.js
   Visualización "hungarian-iou" (SPEC §7.8, §26.5): la asociación de un tracker en UN frame.
   Escena SINTÉTICA (frame de 640×360 dibujado por código): 6 tracks con su caja PREDICHA por el filtro de Kalman (punteadas) y
   las detecciones del frame con su score (sólidas). Matriz tracks × detecciones con el IoU, el costo 1 − IoU o el costo fusionado
   con el score (1 − IoU·s, el fuse_score de ByteTrack fuera de MOT20) → asignación óptima con umbral → resultado por track.
     ByteTrack (Zhang et al., ECCV 2022, arXiv:2110.06864; código ifzhang/ByteTrack, yolox/tracker/byte_tracker.py):
       1ª pasada: tracks activos + perdidos × detecciones ALTAS (s > track_thresh), costo 1 − IoU·s, umbral match_thresh.
       2ª pasada: los tracks activos que quedaron × detecciones BAJAS (0.1 < s < track_thresh), costo 1 − IoU, umbral 0.5.
       Detecciones altas sin pareja con s ≥ track_thresh + 0.1 → tracks nuevos; tracks sin pareja → perdidos (se borran tras
       más de max_time_lost frames seguidos sin detección); bajas sin pareja → se descartan (son casi siempre fondo). Los tracks "sin confirmar" (de un frame)
       tienen su propia pasada con umbral 0.7: aquí no hay ninguno.
     SORT (Bewley et al., ICIP 2016, arXiv:1602.00763; sort.py): una pasada con las detecciones altas, asignación completa que
       maximiza el IoU y después se descartan las parejas con IoU < 0.3; las bajas se tiran antes de asociar.
   Asignación: el algoritmo húngaro (ATLAS.Viz.hungarian, exacto). Con umbral, la semántica de lap.lapjv(extend_cost=True,
   cost_limit=θ) que usan ByteTrack y Ultralytics: la matriz se extiende a (n + m) × (n + m) con θ/2 fuera del bloque de costos y 0
   en el bloque de las ficticias, así que una pareja solo conviene si su costo es < θ (dejar las dos sin pareja cuesta θ/2 + θ/2).
   Verificado contra fuerza bruta en matrices al azar (scratchpad/build14).
   Números del calculador (no ilustrativos): track_thresh, match_thresh, el umbral bajo, track_buffer y fps de la config
   (ATLAS.Arch.run; bytetrack-mot17 por omisión). Las cajas y los scores son ilustrativos.
   params: { config:'bytetrack-mot17', method:'byte'|'sort', pass:1|2, view:'cost'|'iou' }
   Puro (sin DOM) para tests: ATLAS.Viz.track = { iou, assignLimit, assignFull, associate, scene }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9]{1,2}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const IMW = 640, IMH = 360;

  // ---- matemática pura
  // IoU de cajas tlwh (x, y del borde superior izquierdo, ancho, alto), sin el +1 de píxel (como Ultralytics)
  function iou(a, b) {
    const iw = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
    const ih = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    const i = iw * ih, u = a[2] * a[3] + b[2] * b[3] - i;
    return u > 0 ? i / u : 0;
  }
  function hung(cost) { return ATLAS.Viz.hungarian(cost); }
  // asignación completa (filas o columnas sobran): devuelve rowOf[j] / colOf[i] con −1 si no hay pareja
  function assignFull(cost) {
    const n = cost.length, m = n ? cost[0].length : 0;
    const colOf = new Array(n).fill(-1), rowOf = new Array(m).fill(-1);
    if (!n || !m) return { colOf, rowOf };
    if (n <= m) hung(cost).col.forEach((j, i) => { colOf[i] = j; rowOf[j] = i; });
    else hung(cost[0].map((_, j) => cost.map((row) => row[j]))).col.forEach((i, j) => { colOf[i] = j; rowOf[j] = i; });
    return { colOf, rowOf };
  }
  // lap.lapjv(cost, extend_cost=True, cost_limit=θ): matriz (n+m)×(n+m), θ/2 fuera del bloque n×m y 0 en el bloque m×n de abajo
  function assignLimit(cost, theta) {
    const n = cost.length, m = n ? cost[0].length : 0;
    const colOf = new Array(n).fill(-1), rowOf = new Array(m).fill(-1);
    if (!n || !m) return { colOf, rowOf };
    const N = n + m, h = theta / 2;
    const ext = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i < n && j < m ? cost[i][j] : i >= n && j >= m ? 0 : h)));
    hung(ext).col.forEach((j, i) => { if (i < n && j < m) { colOf[i] = j; rowOf[j] = i; } });
    return { colOf, rowOf };
  }

  // Escena: tracks (cajas predichas por Kalman) y detecciones del frame (tlwh en px de 640×360)
  function scene() {
    const tracks = [
      { id: 1, box: [52, 118, 52, 134] },
      { id: 2, box: [160, 108, 56, 142] },
      { id: 3, box: [292, 128, 48, 122] },
      { id: 4, box: [404, 112, 54, 140] },                              // detrás de la persona 5: su detección sale con score bajo
      { id: 5, box: [446, 122, 52, 136] },
      { id: 6, box: [578, 132, 44, 116] },                              // salió de cuadro: sin detección
    ];
    const dets = [
      { id: 1, box: [58, 122, 50, 132], s: 0.93, who: 'persona 1' },
      { id: 2, box: [168, 104, 54, 146], s: 0.88, who: 'persona 2' },
      { id: 3, box: [296, 136, 50, 116], s: 0.81, who: 'persona 3' },
      { id: 4, box: [398, 120, 50, 110], s: 0.22, who: 'persona 4, tapada' },
      { id: 5, box: [452, 118, 52, 138], s: 0.90, who: 'persona 5' },
      { id: 6, box: [222, 176, 40, 104], s: 0.86, who: 'alguien que entra' },
      { id: 7, box: [532, 26, 34, 40], s: 0.17, who: 'fondo (un cartel)' },
      { id: 8, box: [100, 300, 30, 30], s: 0.06, who: 'ruido' },
    ];
    return { tracks, dets };
  }

  // Asociación de un frame. th = {high, low, match, second, newT, sortIou}. Devuelve las pasadas (matriz + asignación) y el destino
  function associate(sc, method, th) {
    const high = sc.dets.filter((d) => d.s > th.high), low = sc.dets.filter((d) => d.s > th.low && d.s < th.high);   // como el código: s > 0.1 y s < track_thresh
    const below = sc.dets.filter((d) => d.s <= th.low);
    const passes = [];
    const fate = { tracks: {}, dets: {} };
    if (method === 'sort') {
      const T = sc.tracks;
      const I = T.map((t) => high.map((d) => iou(t.box, d.box)));
      const a = assignFull(I.map((row) => row.map((v) => -v)));
      const ok = T.map((_, i) => a.colOf[i] >= 0 && I[i][a.colOf[i]] >= th.sortIou);
      passes.push({ rows: T, cols: high, iou: I, cost: I.map((row) => row.map((v) => 1 - v)), costKind: '1 − IoU', theta: 1 - th.sortIou, colOf: T.map((_, i) => (ok[i] ? a.colOf[i] : -1)), raw: a.colOf });
      T.forEach((t, i) => { fate.tracks[t.id] = ok[i] ? { det: high[a.colOf[i]].id, pass: 1 } : { lost: true }; if (ok[i]) fate.dets[high[a.colOf[i]].id] = { track: t.id, pass: 1 }; });
      high.forEach((d) => { if (!fate.dets[d.id]) fate.dets[d.id] = { born: true }; });
      low.concat(below).forEach((d) => { fate.dets[d.id] = { dropped: true, why: 'score bajo' }; });
      return { high, low, below, passes, fate };
    }
    // ByteTrack, 1ª pasada: costo fusionado con el score (1 − IoU·s)
    const T1 = sc.tracks;
    const I1 = T1.map((t) => high.map((d) => iou(t.box, d.box)));
    const C1 = I1.map((row) => row.map((v, j) => 1 - v * high[j].s));
    const a1 = assignLimit(C1, th.match);
    passes.push({ rows: T1, cols: high, iou: I1, cost: C1, costKind: '1 − IoU·s', theta: th.match, colOf: a1.colOf });
    T1.forEach((t, i) => { if (a1.colOf[i] >= 0) { fate.tracks[t.id] = { det: high[a1.colOf[i]].id, pass: 1 }; fate.dets[high[a1.colOf[i]].id] = { track: t.id, pass: 1 }; } });
    // 2ª pasada: los tracks que quedaron × las bajas, costo 1 − IoU sin score, umbral fijo
    const T2 = T1.filter((t) => !fate.tracks[t.id]);
    const I2 = T2.map((t) => low.map((d) => iou(t.box, d.box)));
    const C2 = I2.map((row) => row.map((v) => 1 - v));
    const a2 = assignLimit(C2, th.second);
    passes.push({ rows: T2, cols: low, iou: I2, cost: C2, costKind: '1 − IoU', theta: th.second, colOf: a2.colOf });
    T2.forEach((t, i) => { if (a2.colOf[i] >= 0) { fate.tracks[t.id] = { det: low[a2.colOf[i]].id, pass: 2 }; fate.dets[low[a2.colOf[i]].id] = { track: t.id, pass: 2 }; } else fate.tracks[t.id] = { lost: true }; });
    high.forEach((d) => { if (!fate.dets[d.id]) fate.dets[d.id] = d.s >= th.newT ? { born: true } : { dropped: true, why: 'alta, pero por debajo del umbral de inicio' }; });
    low.forEach((d) => { if (!fate.dets[d.id]) fate.dets[d.id] = { dropped: true, why: 'baja y sin track' }; });
    below.forEach((d) => { fate.dets[d.id] = { dropped: true, why: 's ≤ ' + th.low }; });
    return { high, low, below, passes, fate };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const cfgId = params.config || 'bytetrack-mot17';
    let run = null, met = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { met = A.metrics(cfgId); } catch (e) { met = null; }
    const pick = (o, ks, d) => { for (const k of ks) { const v = String(k).split('.').reduce((a, p) => (a == null ? a : a[p]), o); if (Number.isFinite(v)) return v; } return d; };
    // umbrales de la config (metrics del contrato de perception.js); SORT: iou_threshold 0.3 de sort.py (abewley/sort)
    const isSort = cfgId === 'sort';
    const bt = isSort ? null : met;
    const th = {
      high: pick(bt, ['trackHigh'], 0.6), low: pick(bt, ['trackLow'], 0.1),
      match: pick(bt, ['matchThresh'], 0.8), second: pick(bt, ['matchThresh2'], 0.5),
      sortIou: 0.3,
    };
    th.newT = pick(bt, ['newTrackThresh'], Math.round((th.high + 0.1) * 100) / 100);
    const maxLost = Math.floor(pick(bt, ['framesLost'], 30));
    const state = { method: params.method === 'sort' || (isSort && params.method !== 'byte') ? 'sort' : 'byte', pass: +params.pass === 2 ? 2 : 1, view: params.view === 'iou' ? 'iou' : 'cost', cell: null };
    const sc = scene();

    const wrap = V.html('div', { class: 'viz viz-hiou' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g); b.addEventListener('click', () => { state[key] = v; state.cell = null; draw(); }); b._v = v; b._k = key; return b; });
    };
    const cM = chipGroup('Tracker', [['byte', 'ByteTrack (2 pasadas)'], ['sort', 'SORT (solo altas)']], 'method');
    const cP = chipGroup('Pasada', [[1, '1ª: altas'], [2, '2ª: bajas']], 'pass');
    const cV = chipGroup('Celdas', [['cost', 'costo'], ['iou', 'IoU']], 'view');
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const fates = V.html('ul', { class: 'viz-hiou-fate' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, sub('Cajas y scores ilustrativos; los umbrales son los de la config. Punteadas: dónde predice el filtro de Kalman que está cada track en este frame. Sólidas: las detecciones (más finas si el score es bajo). La matriz se llena con el IoU de cada par y el costo 1 − IoU (en la 1ª pasada de ByteTrack, 1 − IoU·s: una detección floja necesita más solapamiento). El algoritmo húngaro elige las parejas que minimizan la suma; con umbral θ, una pareja con costo ≥ θ queda sin asignar (gris). La 2ª pasada de ByteTrack es la idea del paper: una persona tapada sale con score bajo pero en el lugar que predijo su track, y en vez de tirarla se usa para no perder el id. Las bajas que no caen sobre ningún track (fondo) se descartan.'));

    function draw() {
      if (state.method === 'sort') state.pass = 1;
      [cM, cP, cV].forEach((cs) => cs.forEach((b) => { b.setAttribute('aria-pressed', String(state[b._k] === b._v)); if (b._k === 'pass') b.disabled = state.method === 'sort' && b._v === 2; }));
      const res = associate(sc, state.method, th);
      const P = res.passes[state.pass - 1];
      const cw = stage.clientWidth || 900, narrow = cw < 680;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(560, cw)) : 900;
      const IW = narrow ? W - 16 : 430, sc2 = IW / IMW, IH = IMH * sc2;
      const IX = 8, IY = 40;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'group' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? (state.method === 'sort' ? 'SORT: una pasada (altas)' : 'ByteTrack: ' + (state.pass === 1 ? '1ª pasada (altas)' : '2ª pasada (bajas)')) : state.method === 'sort' ? 'SORT: una pasada con las detecciones altas' : state.pass === 1 ? 'ByteTrack, 1ª pasada: todos los tracks × detecciones altas' : 'ByteTrack, 2ª pasada: tracks sin pareja × detecciones bajas', 'viz-t');
      t(svg, 8, 29, (narrow ? 'altas: s > ' + th.high + ' · ' : 'altas: s > ' + th.high + ' · bajas: ' + th.low + ' < s < ' + th.high + ' · ') + (state.method === 'sort' ? 'IoU ≥ ' + th.sortIou : 'θ = ' + P.theta + (narrow ? '' : ' sobre ' + P.costKind)), 'viz-s');
      // ---- frame: fondo, personas (las detecciones verdaderas), tracks punteados, detecciones
      const R = (b) => ({ x: IX + b[0] * sc2, y: IY + b[1] * sc2, w: b[2] * sc2, h: b[3] * sc2 });
      const objs = sc.dets.filter((d) => /persona|entra/.test(d.who)).map((d) => ({ icon: 'person', box: [(d.box[0] + d.box[2] / 2) / IMW, (d.box[1] + d.box[3] / 2) / IMH, d.box[2] / IMW, d.box[3] / IMH] }));
      V.detScene(svg, IX, IY, IW, IH, objs);
      const inPass = (d) => P.cols.some((c) => c.id === d.id), rowIn = (tk) => P.rows.some((r) => r.id === tk.id);
      const selT = state.cell ? P.rows[state.cell.i].id : null, selD = state.cell ? P.cols[state.cell.j].id : null;
      sc.tracks.forEach((tk) => {
        const r = R(tk.box), f = res.fate.tracks[tk.id];
        V.svg('rect', { x: r1(r.x), y: r1(r.y), width: r1(r.w), height: r1(r.h), class: 'viz-hiou-trk' + (rowIn(tk) ? '' : ' is-out') + (f && f.lost ? ' is-lost' : '') + (selT === tk.id ? ' is-sel' : '') }, svg);
        t(svg, r.x + 2, r.y - 3, 'T' + tk.id, 'viz-hiou-tl' + (rowIn(tk) ? '' : ' is-out'));
      });
      sc.dets.forEach((d) => {
        const r = R(d.box), lowD = d.s < th.high, gone = d.s <= th.low || (state.method === 'sort' && lowD);
        V.svg('rect', { x: r1(r.x), y: r1(r.y), width: r1(r.w), height: r1(r.h), class: 'viz-hiou-det' + (lowD ? ' is-low' : '') + (inPass(d) ? '' : ' is-out') + (gone ? ' is-gone' : '') + (selD === d.id ? ' is-sel' : '') }, svg);
        // bajas: rótulo abajo a la izquierda (la tapada queda pegada a la persona de adelante, cuyo rótulo va a la derecha)
        t(svg, lowD ? r.x + 1 : r.x + r.w - 1, r.y + r.h + 10, 'd' + d.id + ' ' + d.s.toFixed(2), 'viz-hiou-dl' + (lowD ? ' is-low' : '') + (inPass(d) ? '' : ' is-out'), lowD ? null : 'end');
      });
      // líneas de las parejas de esta pasada
      P.rows.forEach((tk, i) => {
        const j = P.colOf[i]; if (j < 0) return;
        const a = R(tk.box), b = R(P.cols[j].box);
        V.svg('path', { d: 'M' + r1(a.x + a.w / 2) + ' ' + r1(a.y + a.h / 2) + 'L' + r1(b.x + b.w / 2) + ' ' + r1(b.y + b.h / 2), class: 'viz-hiou-link' }, svg);
      });
      // ---- matriz
      const n = P.rows.length, m = P.cols.length;
      const cwid = narrow ? Math.min(54, Math.floor((W - 52 - 50) / Math.max(1, m))) : 58, rh = 28;
      const MX = narrow ? 52 : IX + IW + 70, MY = narrow ? IY + IH + 88 : IY + 56;
      t(svg, MX - 44, MY - 50, (state.view === 'iou' ? 'IoU' : 'costo ' + P.costKind) + ': ' + n + (narrow ? ' × ' + m : ' tracks × ' + m + ' detecciones'), 'viz-n');
      t(svg, MX - 44, MY - 36, state.view === 'iou' ? 'más oscuro = más solapamiento' : narrow ? 'oscuro = menor · gris = ≥ θ' : 'más oscuro = menor costo · gris = ≥ θ (no se asigna)', 'viz-s');
      P.cols.forEach((d, j) => { t(svg, MX + j * cwid + cwid / 2, MY - 19, 'd' + d.id, 'viz-n', 'middle'); t(svg, MX + j * cwid + cwid / 2, MY - 5, 's ' + d.s.toFixed(2), 'viz-s', 'middle'); });
      if (!n || !m) t(svg, MX - 44, MY + 18, !n ? 'no queda ningún track sin pareja' : 'no hay detecciones en esta pasada', 'viz-s');
      P.rows.forEach((tk, i) => {
        const y = MY + i * rh;
        t(svg, MX - 8, y + rh / 2 + 4, 'T' + tk.id, 'viz-s', 'end');
        P.cols.forEach((d, j) => {
          const x = MX + j * cwid, c = P.cost[i][j], v = state.view === 'iou' ? P.iou[i][j] : c;
          const off = c >= P.theta, mt = P.colOf[i] === j;
          const f = state.view === 'iou' ? v : Math.max(0, 1 - c);
          const g = V.svg('g', { class: 'viz-cell-btn' + (state.cell && state.cell.i === i && state.cell.j === j ? ' is-hl' : ''), tabindex: 0, role: 'img',
            'aria-label': 'Track ' + tk.id + ' con detección ' + d.id + ': IoU ' + P.iou[i][j].toFixed(2) + ', costo ' + c.toFixed(2) + (off ? ' (no pasa el umbral ' + P.theta + ')' : '') + (mt ? ', asignados' : '') }, svg);
          V.svg('rect', { x: x + 1, y: y + 1, width: cwid - 2, height: rh - 2, rx: 2, class: 'viz-hiou-cell' + (off ? ' is-off' : ''), style: off ? null : 'fill:color-mix(in srgb, var(--op-head) ' + Math.round(6 + 70 * f) + '%, var(--surface))' }, g);
          t(g, x + cwid / 2, y + rh / 2 + 4, v.toFixed(2), 'viz-sim-v', 'middle');
          V.svg('rect', { x: x + 1, y: y + 1, width: cwid - 2, height: rh - 2, rx: 2, class: mt ? 'viz-hung-m' : 'viz-sim-hit' }, g);
          const show = () => { state.cell = { i, j }; draw(); };
          g.addEventListener('click', show);
          g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); show(); } });
        });
        const j = P.colOf[i];
        t(svg, MX + m * cwid + 8, y + rh / 2 + 4, j >= 0 ? '→ d' + P.cols[j].id : state.method === 'byte' && state.pass === 1 ? (narrow ? '→ 2ª' : '→ 2ª pasada') : (narrow ? '→ ∅' : '→ perdido'), j >= 0 ? 'viz-n' : 'viz-s');
      });
      const H2 = Math.max(IY + IH + 22, MY + Math.max(1, n) * rh + 16);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(H2));
      svg.setAttribute('aria-label', 'Frame con ' + sc.tracks.length + ' tracks y ' + sc.dets.length + ' detecciones; matriz de ' + n + ' por ' + m + ' de la pasada ' + state.pass + ' (' + (state.method === 'sort' ? 'SORT' : 'ByteTrack') + ')');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('detecciones:', res.high.length + ' altas · ' + res.low.length + ' bajas · ' + res.below.length + ' con s ≤ ' + th.low);
      kv('parejas en esta pasada:', P.colOf.filter((j) => j >= 0).length + ' de ' + n + ' tracks');
      kv('IoU calculados:', n + ' × ' + m + ' = ' + n * m);
      if (state.cell) {
        const i = state.cell.i, j = state.cell.j, io = P.iou[i][j], d = P.cols[j];
        kv('T' + P.rows[i].id + ' · d' + d.id + ':', 'IoU ' + io.toFixed(2) + (P.costKind === '1 − IoU·s' ? ' · costo 1 − ' + io.toFixed(2) + '·' + d.s.toFixed(2) + ' = ' + P.cost[i][j].toFixed(2) : ' · costo ' + P.cost[i][j].toFixed(2)) + (P.cost[i][j] >= P.theta ? ' ≥ θ' : ' < θ'));
      }
      // destino de cada track y cada detección
      fates.innerHTML = '';
      const li = (html) => { const e = V.html('li', null, fates); e.innerHTML = html; };
      sc.tracks.forEach((tk) => {
        const f = res.fate.tracks[tk.id];
        if (f && f.det) li('<b>T' + tk.id + '</b> ← d' + f.det + (f.pass === 2 ? ' en la <b>2ª pasada</b> (score ' + sc.dets.find((d) => d.id === f.det).s.toFixed(2) + ')' : '') + ': update del Kalman, mismo id');
        else li('<b>T' + tk.id + '</b>: sin detección → <b>perdido</b>' + (state.method === 'sort' ? ' (SORT, max_age = 1: aguanta un frame sin detección; si tampoco aparece en el siguiente, se borra y, si vuelve, id nuevo)' : ' (se sigue prediciendo; se borra si pasa más de ' + maxLost + ' frames seguidos sin detección)'));
      });
      sc.dets.forEach((d) => {
        const f = res.fate.dets[d.id];
        if (f && f.born) li('<b>d' + d.id + '</b> (' + d.who + ', ' + d.s.toFixed(2) + '): sin track → <b>track nuevo</b>' + (state.method === 'byte' ? ' (s ≥ ' + th.newT + ')' : ''));
        else if (f && f.dropped) li('<b>d' + d.id + '</b> (' + d.who + ', ' + d.s.toFixed(2) + '): se descarta (' + f.why + ')');
      });
    }
    draw();
    let ro = null, lastNarrow = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 900) < 680; if (lastNarrow !== null && nar !== lastNarrow) draw(); lastNarrow = nar; }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.track = { iou, assignLimit, assignFull, associate, scene };
    ATLAS.Viz.register('hungarian-iou', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
