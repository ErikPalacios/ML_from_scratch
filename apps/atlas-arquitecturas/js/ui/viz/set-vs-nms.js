/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/set-vs-nms.js
   Visualización "set-vs-nms" (SPEC §7.8, §15.3): la figura puente YOLO → DETR.
   Izquierda, un detector DENSO estilo YOLO: cada celda de la grilla (3 escalas, varias anclas)
   propone cajas; tras el umbral de confianza quedan varias por objeto (duplicados) y la NMS greedy
   por clase, con un umbral de IoU FIJO, decide cuáles sobreviven. Derecha, DETR: Q object queries →
   Q salidas, una caja por objeto y el resto ∅, sin NMS (el matching 1 a 1 del entrenamiento
   castiga los duplicados). La escena tiene dos coches que se solapan (IoU ≈ 0.5): con un umbral
   bajo, la NMS borra uno; con uno alto, sobreviven duplicados. No hay umbral que arregle las dos cosas.
   Escena, cajas y confianzas: SINTÉTICAS ("ilustrativo"). Q y la resolución salen de la config de DETR;
   el número de candidatas densas se calcula con la resolución y los strides 8/16/32 (estilo YOLOv5:
   3 anclas por celda; YOLOv8, sin anclas: 1 por celda).
   params: { config:'detr-r50-640', step:'raw'|'nms', iou:0.45 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // IoU de cada duplicado con la mejor caja de su objeto (exactos: caja del mismo tamaño desplazada).
  // Ninguno por debajo de 0.5: con el umbral 0.45 de YOLOv5 la NMS los quita todos; con 0.6 sobreviven varios.
  // Los del segundo coche se desplazan hacia el primero (la NMS los compara con la caja que quedó).
  const DUP_IOU = [[0.71, 0.55], [0.83, 0.66, 0.52], [0.78, 0.61], [0.80, 0.58], [0.74, 0.62], [0.86, 0.69], [0.76], [0.81, 0.57], [0.7], [0.75]];
  const CONF_TH = 0.25, STRIDES = [8, 16, 32];

  function cfgNum(c, keys, d) { for (const k of keys) { const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), c); if (Number.isFinite(v)) return v; } return d; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, B = V.box;
    const fmt = (A && A.fmt) || { int: (n) => String(n) };
    const cfgId = params.config || 'detr-r50-640';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const c = (run && run.config) || {};
    const Q = Math.max(1, Math.round(cfgNum(c, ['Q', 'numQueries', 'queries'], 100)));
    const G = Math.max(1, Math.min(Math.round(cfgNum(c, ['G', 'gt', 'numGt'], 7)), V.DET_OBJECTS.length, Q));
    const imgH = cfgNum(c, ['H', 'res.0', 'imgH'], 640), imgW = cfgNum(c, ['W', 'res.1', 'imgW'], 640);
    const objs = V.DET_OBJECTS.slice(0, G);
    const cells = STRIDES.map((s) => Math.ceil(imgH / s) * Math.ceil(imgW / s));
    const nCells = cells.reduce((a, b) => a + b, 0);
    const state = { step: params.step === 'raw' ? 'raw' : 'nms', iou: [0.3, 0.45, 0.6, 0.8].indexOf(+params.iou) >= 0 ? +params.iou : 0.45 };

    // ---- predicciones densas (tras el umbral de confianza): la mejor por objeto + duplicados
    const R = V.rng(19);
    const dense = [];
    objs.forEach((o, j) => {
      const b0 = o.box;
      // el segundo coche (detrás) sale con algo menos de confianza: es el que la NMS borra
      const lead = o.icon === 'car' && objs.findIndex((x) => x.icon === 'car') !== j ? 0.81 : 0.88 + 0.07 * R();
      dense.push({ obj: j, label: o.label, box: b0.slice(), conf: lead, best: true });
      (DUP_IOU[j] || []).forEach((t, k) => {
        const a = 1 - Math.sqrt(2 * t / (1 + t));
        const second = o.icon === 'car' && objs.findIndex((x) => x.icon === 'car') !== j;
        const sx = second ? -1 : R() < 0.5 ? -1 : 1, sy = R() < 0.5 ? -1 : 1;
        const b = [b0[0] + sx * a * b0[2], b0[1] + sy * a * b0[3], b0[2], b0[3]];
        dense.push({ obj: j, label: o.label, box: b, conf: Math.max(CONF_TH + 0.03, lead - 0.12 - 0.16 * k - 0.05 * R()), iouBest: t });
      });
    });
    function nms(th) {
      const order = dense.map((d, i) => i).sort((a, b) => dense[b].conf - dense[a].conf);
      const keep = [], killedBy = {};
      for (const i of order) {
        const k = keep.find((j) => dense[j].label === dense[i].label && B.iou(dense[j].box, dense[i].box) > th);
        if (k == null) keep.push(i); else killedBy[i] = k;
      }
      return { keep, killedBy };
    }
    // evaluación: cada objeto, ¿lo cubre alguna caja que quedó (misma clase, IoU ≥ 0.5)? Las sobrantes = duplicados
    function evaluate(keepIdx) {
      const used = new Set(), found = new Array(G).fill(-1);
      const pairs = [];
      for (const i of keepIdx) objs.forEach((o, j) => { if (dense[i].label === o.label) pairs.push([B.iou(dense[i].box, o.box), i, j]); });
      pairs.sort((a, b) => b[0] - a[0]);
      for (const [v, i, j] of pairs) if (v >= 0.5 && found[j] < 0 && !used.has(i)) { found[j] = i; used.add(i); }
      return { found, dups: keepIdx.filter((i) => !used.has(i)) };
    }

    const wrap = V.html('div', { class: 'viz viz-nms' }, el);
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
      chipGroup('YOLO', [['raw', '1 · tras el umbral de confianza'], ['nms', '2 · tras NMS']], 'step'),
      chipGroup('Umbral IoU de la NMS', [[0.3, '0.3'], [0.45, '0.45'], [0.6, '0.6'], [0.8, '0.8']], 'iou'),
    ];
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Escena, cajas y confianzas ilustrativas (no son salidas de un YOLO ni de un DETR entrenados). ' +
      'Un detector denso propone cajas en cada celda de 3 grillas (strides 8, 16 y 32) y con varias anclas por celda: muchas cajas buenas caen sobre el mismo objeto, y la NMS (no entrenable, un umbral de IoU fijo) se queda con la de mayor confianza y borra las que se le solapan. ' +
      'Con dos objetos de la misma clase que se solapan, un umbral bajo borra uno real y uno alto deja duplicados. DETR predice un conjunto: cada query da una caja o ∅, y el matching húngaro del entrenamiento asigna cada objeto a UNA sola query, así que los duplicados se castigan en la pérdida y no hace falta NMS. (YOLOv10 también quita la NMS con una asignación 1 a 1 en el entrenamiento.)' }, wrap);

    function draw() {
      chips.forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      const res = nms(state.iou);
      const keepIdx = state.step === 'nms' ? res.keep : dense.map((d, i) => i);
      const ev = evaluate(keepIdx);
      stage.innerHTML = '';
      const narrow = (stage.clientWidth || 900) < 700;
      const S = narrow ? Math.max(240, Math.min(300, (stage.clientWidth || 320) - 16)) : 340, IH = Math.round(S * imgH / imgW);
      const gap = narrow ? 0 : 56;
      const LX = 8, RX = narrow ? 8 : LX + S + gap, TOP = 50, RTOP = narrow ? TOP + IH + 92 : TOP;
      const stripY = RTOP + IH + 26, cols = Math.min(Q, 20), sq = Math.min(13, Math.floor((S - 4) / cols)) ;
      const stripRows = Math.ceil(Q / cols);
      const W = narrow ? S + 16 : RX + S + 10, Hh = stripY + stripRows * sq + 40;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px' + (narrow ? '' : ';min-width:' + Math.min(W, 640) + 'px'), role: 'group',
        'aria-label': 'Izquierda: detector denso estilo YOLO con ' + keepIdx.length + ' cajas ' + (state.step === 'nms' ? 'tras NMS con umbral ' + state.iou : 'antes de la NMS') + '. Derecha: DETR con ' + Q + ' queries, una caja por objeto y el resto vacías.' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      const px = (b, X, Y) => { const r = B.xyxy(b); return { x: X + r[0] * S, y: Y + r[1] * IH, w: (r[2] - r[0]) * S, h: (r[3] - r[1]) * IH }; };

      // ---- izquierda: denso + NMS
      t(svg, LX, 16, 'Denso + NMS (estilo YOLO)', 'viz-t');
      t(svg, LX, 30, fmt.int(nCells) + (narrow ? ' celdas × 3 → ' + fmt.int(3 * nCells) + ' cajas' : ' celdas × 3 anclas → ' + fmt.int(3 * nCells) + ' cajas candidatas'), 'viz-s');
      t(svg, LX, 43, state.step === 'raw' ? 'conf ≥ ' + CONF_TH + ': ' + dense.length + ' cajas, varias por objeto' : (narrow ? 'NMS, IoU > ' : 'NMS por clase, IoU > ') + state.iou + ' → borrar: quedan ' + res.keep.length, 'viz-s');
      V.detScene(svg, LX, TOP, S, IH, objs);
      // grilla de stride 32 (la más gruesa de las 3)
      const gs = Math.ceil(imgW / 32), gr = Math.ceil(imgH / 32);
      let d = '';
      for (let i = 1; i < gs; i++) d += 'M' + (LX + i * S / gs).toFixed(1) + ' ' + TOP + 'V' + (TOP + IH);
      for (let i = 1; i < gr; i++) d += 'M' + LX + ' ' + (TOP + i * IH / gr).toFixed(1) + 'H' + (LX + S);
      V.svg('path', { d, class: 'viz-nms-grid' }, svg);
      const keepSet = new Set(keepIdx);
      // las borradas por la NMS, tenues (para ver qué quitó)
      if (state.step === 'nms') dense.forEach((dd, i) => { if (!keepSet.has(i)) { const r = px(dd.box, LX, TOP); V.svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'viz-nms-gone' }, svg); } });
      const dupSet = new Set(ev.dups);
      keepIdx.slice().sort((a, b) => dense[a].conf - dense[b].conf).forEach((i) => {
        const dd = dense[i], r = px(dd.box, LX, TOP), dup = state.step === 'nms' && dupSet.has(i);
        V.svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'viz-nms-box' + (dup ? ' is-dup' : '') }, svg);
        if (state.step === 'nms' || dd.best) t(svg, r.x + 2, r.y + 10, dd.conf.toFixed(2), 'viz-nms-conf' + (dup ? ' is-dup' : ''));
      });
      if (state.step === 'nms') objs.forEach((o, j) => {
        if (ev.found[j] >= 0) return;
        const r = px(o.box, LX, TOP);
        V.svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'viz-nms-lost' }, svg);
        t(svg, r.x + r.w / 2, r.y + r.h + 12, 'perdido: ' + o.label, 'viz-nms-losttxt', 'middle');
      });
      // leyenda izquierda
      const ly = TOP + IH + 16;
      const leg = (x, cls, label) => { V.svg('rect', { x, y: ly - 8, width: 14, height: 9, class: cls }, svg); t(svg, x + 18, ly, label, 'viz-s'); };
      leg(LX, 'viz-nms-box', 'queda');
      if (state.step === 'nms') { leg(LX + 64, 'viz-nms-gone', 'borrada'); leg(LX + 140, 'viz-nms-box is-dup', 'duplicado'); leg(LX + 230, 'viz-nms-lost', 'perdido'); }
      t(svg, LX, ly + 16, narrow ? 'grilla: stride 32 (' + gr + '×' + gs + ')' : 'grilla dibujada: stride 32 (' + gr + '×' + gs + '), la más gruesa de las 3', 'viz-s');

      // ---- derecha: DETR, un conjunto
      t(svg, RX, RTOP - 34, 'Conjunto (DETR): ' + Q + ' queries → ' + Q + ' salidas', 'viz-t');
      t(svg, RX, RTOP - 20, G + ' cajas (una por objeto) + ' + (Q - G) + ' × ∅ · sin NMS', 'viz-s');
      V.detScene(svg, RX, RTOP, S, IH, objs);
      const R2 = V.rng(5);
      const qIdx = []; while (qIdx.length < G) { const q = Math.floor(R2() * Q); if (qIdx.indexOf(q) < 0) qIdx.push(q); }
      objs.forEach((o, j) => {
        const b = [o.box[0] + 0.01 * R2.normal(), o.box[1] + 0.01 * R2.normal(), o.box[2] * (1 + 0.03 * R2.normal()), o.box[3] * (1 + 0.03 * R2.normal())];
        const r = px(b, RX, RTOP);
        V.svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'viz-nms-qbox' }, svg);
        t(svg, r.x + 2, r.y + 10, 'q' + qIdx[j], 'viz-nms-qtxt');
      });
      // las Q salidas: una celda por query (con objeto o ∅)
      t(svg, RX, stripY - 6, 'las ' + Q + ' salidas (una por query):', 'viz-s');
      for (let q = 0; q < Q; q++) {
        const x = RX + (q % cols) * sq, y = stripY + Math.floor(q / cols) * sq, j = qIdx.indexOf(q);
        V.svg('rect', { x: x + 0.5, y: y + 0.5, width: sq - 1, height: sq - 1, rx: 1.5, class: 'viz-nms-q' + (j >= 0 ? ' is-obj' : '') }, svg);
      }
      const ly2 = stripY + stripRows * sq + 16;
      V.svg('rect', { x: RX, y: ly2 - 8, width: 9, height: 9, rx: 1.5, class: 'viz-nms-q is-obj' }, svg); t(svg, RX + 13, ly2, 'objeto', 'viz-s');
      V.svg('rect', { x: RX + 70, y: ly2 - 8, width: 9, height: 9, rx: 1.5, class: 'viz-nms-q' }, svg); t(svg, RX + 83, ly2, '∅ (no object)', 'viz-s');

      // ---- lectura
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('YOLO, candidatas @ ' + imgH + '×' + imgW + ':', '3·(' + STRIDES.map((st) => { const a = Math.ceil(imgH / st), b = Math.ceil(imgW / st); return a === b ? a + '²' : a + '·' + b; }).join(' + ') + ') = ' + fmt.int(3 * nCells) + ' (sin anclas: ' + fmt.int(nCells) + ')');
      kv('tras conf ≥ ' + CONF_TH + ':', dense.length + ' cajas');
      if (state.step === 'nms') {
        kv('tras NMS (IoU ' + state.iou + '):', res.keep.length + ' cajas');
        kv('objetos encontrados:', ev.found.filter((x) => x >= 0).length + ' de ' + G);
        kv('duplicados que quedan:', String(ev.dups.length));
      }
      const cars = objs.map((o, j) => j).filter((j) => objs[j].icon === 'car');
      if (cars.length > 1) kv('IoU entre los dos coches:', B.iou(objs[cars[0]].box, objs[cars[1]].box).toFixed(2));
      kv('DETR:', Q + ' queries → ' + G + ' objetos + ' + (Q - G) + ' ∅, sin NMS');
    }

    draw();
    let ro = null, lastNarrow = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 900) < 700; if (lastNarrow !== null && nar !== lastNarrow) draw(); lastNarrow = nar; });
      ro.observe(stage);
    }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('set-vs-nms', render);
})(typeof window !== 'undefined' ? window : globalThis);
