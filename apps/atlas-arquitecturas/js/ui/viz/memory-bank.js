/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/memory-bank.js
   Visualización "memory-bank" (SPEC §7.8, §17.3): el banco de memoria de SAM 2 en un video.
   Una línea de tiempo de T frames sintéticos (un auto que cruza la escena y pasa detrás de un árbol).
   En el frame actual t, la memory attention lee: las memorias espaciales de los frames con prompt (los
   "condicionantes") y de los frames t−1 … t−Nᵣ (la ventana reciente), más los punteros de objeto (un
   vector por frame, del token de salida del decoder). Si el objeto está tapado, la cabeza de oclusión
   dice "no está": la máscara sale vacía y la memoria de ese frame se guarda marcada como "sin objeto".
   Lo NO ilustrativo: N, el máximo de punteros, las formas y los MACs de la memory attention, del
   calculador (config sam2-hiera-l, knobs memFrames y ptrs). Lo ilustrativo: la escena y qué frames tienen
   prompt u oclusión.
   params: { config:'sam2-hiera-l', T:12, t:9, prompted:[0], occluded:[5,6] }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;

  function cfgNum(c, keys, d) { for (const k of keys) { const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), c); if (Number.isFinite(v)) return v; } return d; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n), bytes: (n) => n + ' B' };
    const cfgId = params.config || 'sam2-hiera-l';
    let base = null;
    try { base = A.run(cfgId); } catch (e) { base = null; }
    const cfg = (base && base.config) || {};
    const N = Math.max(1, Math.round(cfgNum(cfg, ['memFrames'], 6)));           // FIFO de frames recientes
    const PTRS = Math.max(1, Math.round(cfgNum(cfg, ['maxPtrs', 'ptrs'], 16)));        // punteros de objeto
    const T = Math.max(8, Math.min(16, Math.round(+params.T || 12)));
    // el auto pasa detrás del árbol en estos frames (la escena: x del auto por frame)
    const carX = (f) => 0.08 + 0.84 * f / (T - 1);
    const TREE = [0.47, 0.60];
    const hiddenAt = (f) => { const x = carX(f); return x > TREE[0] - 0.02 && x < TREE[1] + 0.02; };
    const state = {
      t: Math.max(1, Math.min(T - 1, Number.isFinite(+params.t) ? +params.t : T - 3)),
      prompted: new Set(Array.isArray(params.prompted) ? params.prompted : [0]),
    };

    // costo de la memory attention del calculador para nMem memorias espaciales y nPtr punteros. El calculador
    // cuenta condFrames (frames con prompt, 1 en la config) + memFrames (recientes): para nMem en total se pide
    // memFrames = nMem − condFrames (mínimo 1; solo cambia el largo de la memoria, no los pesos).
    const COND = Math.max(0, Math.round(cfgNum(cfg, ['condFrames'], 1)));
    function costAt(nMem, nPtr) {
      if (!A) return null;
      const ov = { memFrames: Math.max(1, nMem - COND), ptrs: Math.max(1, nPtr) };
      let r = null, m = null;
      try { r = A.run(cfgId, ov); } catch (e) { r = null; }
      if (!r) return null;
      try { m = A.metrics(cfgId, ov); } catch (e) { m = null; }
      const b = r.totals && r.totals.byNode && r.totals.byNode['memory-attn'];
      return { run: r, macs: b ? b.macs : 0, tensor: (r.tensors && r.tensors.memory) || null, metrics: m, exact: nMem - COND >= 1 };
    }

    // qué lee la memory attention en el frame t — la selección del código oficial (sam2_base.py,
    // _prepare_memory_conditioned_features): todos los frames con prompt (salvo t; al propagar un video ya
    // anotado, también los posteriores a t), más la ventana fija t−1 … t−Nᵣ, saltando los que tuvieron prompt (ya
    // están; no se buscan más atrás). Punteros: los de los frames con prompt ANTERIORES a t y los de t−1 … t−(P−1)
    // sin prompt, hasta P en total.
    function memoryAt(t) {
      const cond = Array.from(state.prompted).filter((f) => f !== t).sort((a, b) => a - b);
      const recent = [];
      for (let f = t - 1; f >= Math.max(0, t - N); f--) if (!state.prompted.has(f)) recent.push(f);
      const ptr = cond.filter((f) => f < t).slice(-PTRS);
      for (let f = t - 1; f >= Math.max(0, t - (PTRS - 1)) && ptr.length < PTRS; f--) if (!state.prompted.has(f)) ptr.push(f);
      return { cond, recent: recent.sort((a, b) => a - b), ptr: ptr.sort((a, b) => a - b) };
    }

    const wrap = V.html('div', { class: 'viz viz-mb' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Frame actual' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Frame actual' }, g1);
    const bPrev = V.html('button', { type: 'button', class: 'viz-chip', text: '← t − 1' }, g1);
    const bNext = V.html('button', { type: 'button', class: 'viz-chip', text: 't + 1 →' }, g1);
    bPrev.addEventListener('click', () => { state.t = Math.max(1, state.t - 1); draw(); });
    bNext.addEventListener('click', () => { state.t = Math.min(T - 1, state.t + 1); draw(); });
    const g2 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Prompts' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Prompts' }, g2);
    const bAdd = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'clic de corrección en t' }, g2);
    bAdd.addEventListener('click', () => { if (state.prompted.has(state.t)) state.prompted.delete(state.t); else state.prompted.add(state.t); if (!state.prompted.size) state.prompted.add(0); draw(); });
    const bReset = V.html('button', { type: 'button', class: 'viz-chip', text: 'solo el frame 0' }, g2);
    bReset.addEventListener('click', () => { state.prompted = new Set([0]); draw(); });
    const stage = V.html('div', { class: 'viz-stage viz-mb-stage', tabindex: 0, role: 'group', 'aria-label': 'Línea de tiempo del video; flechas izquierda y derecha: cambiar el frame actual; Enter: poner o quitar un clic en ese frame' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'Ilustrativo: la escena (un auto que pasa detrás de un árbol) y qué frames tienen un clic. Lo de SAM 2: la memory attention del frame t lee las memorias de los Nₚ frames con prompt (todos; al propagar un video ya anotado, también los posteriores a t) y las de los frames t−1 … t−' + N + ' (Nᵣ = ' + N + ': una ventana que avanza con t; un frame de esa ventana que tuvo prompt ya está entre los Nₚ y no se reemplaza por uno más viejo), más hasta ' + PTRS + ' punteros de objeto (uno por frame, del token de salida del decoder: los de frames con prompt anteriores a t y los de los frames recientes). Es la selección del código oficial (sam2_base.py). ' +
      'Cuando el objeto está tapado, la cabeza de oclusión dice "no está": la máscara sale vacía y su memoria se guarda marcada como "sin objeto" (en SAM 2.1, con un embedding aprendido). Así, cuando el auto reaparece, las memorias de antes de la oclusión siguen en la cola y lo recuperan. Los tamaños y los MACs son del calculador (' + cfgId + ').');

    let lastNarrow = null;
    function draw() {
      bAdd.setAttribute('aria-pressed', String(state.prompted.has(state.t)));
      bAdd.textContent = state.prompted.has(state.t) ? 'quitar el clic de t = ' + state.t : 'clic de corrección en t = ' + state.t;
      bPrev.disabled = state.t <= 1; bNext.disabled = state.t >= T - 1;
      const mem = memoryAt(state.t);
      const cw = stage.clientWidth || 860;
      const narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const perRow = narrow ? Math.ceil(T / 2) : T;
      const FW = Math.max(36, Math.min(80, Math.floor(((narrow ? Math.min(cw, 420) : Math.min(cw, 1000)) - 16 - (perRow - 1) * 6) / perRow)));
      const FH = Math.round(FW * 0.68);
      const X0 = 8, Y0 = 46, rowH = FH + (narrow ? 58 : 108);
      const rows = Math.ceil(T / perRow);
      const W = X0 * 2 + perRow * FW + (perRow - 1) * 6;
      const bankY = Y0 + rows * rowH + 10;
      const Hh = bankY + (narrow ? 150 : 110);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img', 'aria-label': ariaOf(mem) }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, X0, 15, 'Video: un frame a la vez (frame actual t = ' + state.t + ')', 'viz-t');
      t(svg, X0, 30, narrow ? 't lee: Nₚ con prompt + Nᵣ = ' + N + ' + punteros' : 'la memory attention de t lee: los Nₚ frames con prompt + t−1 … t−' + N + ' (Nᵣ = ' + N + ') + punteros', 'viz-s');
      const pos = (f) => ({ x: X0 + (f % perRow) * (FW + 6), y: Y0 + Math.floor(f / perRow) * rowH });
      for (let f = 0; f < T; f++) {
        const p = pos(f);
        const isT = f === state.t, future = f > state.t;
        const inCond = mem.cond.includes(f), inRecent = mem.recent.includes(f), inPtr = mem.ptr.includes(f);
        const hid = hiddenAt(f);
        const g = V.svg('g', { class: 'viz-cell-btn viz-mb-f' + (future ? ' is-future' : '') + (isT ? ' is-t' : ''), tabindex: -1, transform: 'translate(' + r1(p.x) + ',' + r1(p.y) + ')' }, svg);
        frame(g, f, FW, FH, hid, !future);
        if (state.prompted.has(f)) { const pt = V.svg('g', { class: 'viz-p2m-pt is-pos', transform: 'translate(' + r1(FW * carX(f)) + ',' + r1(FH * 0.68) + ')' }, g); V.svg('circle', { r: 4.5 }, pt); V.svg('path', { d: 'M-2.4 0H2.4M0 -2.4V2.4' }, pt); }
        V.svg('rect', { x: 0, y: 0, width: FW, height: FH, class: 'viz-mb-frame' + (isT ? ' is-t' : '') }, g);
        t(g, FW / 2, -4, (isT ? 't = ' : '') + f, isT ? 'viz-n' : 'viz-s', 'middle');
        // fila de marcas: memoria espacial (barra: prompt o FIFO) y puntero (punto)
        if (inCond || inRecent) V.svg('rect', { x: 2, y: FH + 5, width: FW - 4, height: 7, rx: 2, class: 'viz-mb-mem ' + (inCond ? 'is-cond' : 'is-recent') + (hid ? ' is-noobj' : '') }, g);
        if (inPtr) V.svg('circle', { cx: FW / 2, cy: FH + 19, r: 3.2, class: 'viz-mb-ptr' + (hid ? ' is-noobj' : '') }, g);
        if (!future && hid) t(g, FW / 2, 12, 'tapado', 'viz-nms-losttxt', 'middle');
        g.addEventListener('click', () => { if (f >= 1) { state.t = f; draw(); } });
      }
      // arcos: de cada memoria leída al frame actual (solo en una fila)
      if (!narrow) {
        const pt = pos(state.t), tx = pt.x + FW / 2, y0 = pt.y + FH + 26;
        const arcs = V.svg('g', { class: 'viz-mb-arcs' }, svg);
        for (const f of mem.cond.concat(mem.recent)) {
          const fx = pos(f).x + FW / 2, dpt = Math.min(52, 10 + 0.08 * Math.abs(tx - fx));
          V.svg('path', { d: 'M' + r1(fx) + ' ' + r1(y0) + 'C' + r1(fx) + ' ' + r1(y0 + dpt) + ' ' + r1(tx - 6) + ' ' + r1(y0 + dpt) + ' ' + r1(tx - 2) + ' ' + r1(y0 + 3), class: 'viz-mb-arc' + (mem.cond.includes(f) ? ' is-cond' : '') }, arcs);
        }
        V.svg('path', { d: 'M' + r1(tx - 5) + ' ' + r1(y0 + 7) + 'L' + r1(tx) + ' ' + r1(y0 - 1) + 'L' + r1(tx + 3) + ' ' + r1(y0 + 8) + 'Z', class: 'viz-mb-arrow' }, arcs);
        t(svg, tx, y0 + 64, '↑ todo esto entra a la memory attention de t', 'viz-s', tx > W * 0.65 ? 'end' : tx < W * 0.3 ? 'start' : 'middle');
      }
      // leyenda
      const ly = bankY;
      let lx = X0;
      const leg = (draw1, label) => { draw1(lx, ly); t(svg, lx + 18, ly + 8, label, 'viz-s'); lx += 30 + label.length * 6.8; if (narrow && lx > W - 120) { lx = X0; } };
      leg((x, y) => V.svg('rect', { x, y, width: 14, height: 7, rx: 2, class: 'viz-mb-mem is-cond' }, svg), 'memoria de un frame con prompt');
      if (narrow) { lx = X0; }
      const ly2 = narrow ? ly + 16 : ly;
      const leg2 = (draw1, label, yy) => { draw1(lx, yy); t(svg, lx + 18, yy + 8, label, 'viz-s'); lx += 30 + label.length * 6.8; };
      leg2((x, y) => V.svg('rect', { x, y, width: 14, height: 7, rx: 2, class: 'viz-mb-mem is-recent' }, svg), 'memoria reciente (Nᵣ ≤ ' + N + ')', ly2);
      if (narrow) lx = X0;
      const ly3 = narrow ? ly + 32 : ly;
      leg2((x, y) => V.svg('circle', { cx: x + 7, cy: y + 4, r: 3.2, class: 'viz-mb-ptr' }, svg), 'puntero (≤ ' + PTRS + ')', ly3);
      if (narrow) lx = X0;
      const ly4 = narrow ? ly + 48 : ly + 18;
      lx = X0;
      leg2((x, y) => V.svg('rect', { x, y, width: 14, height: 7, rx: 2, class: 'viz-mb-mem is-recent is-noobj' }, svg), 'discontinuo: "sin objeto" (tapado)', ly4);
      // números del calculador
      const c = costAt(mem.cond.length + mem.recent.length, mem.ptr.length);
      const sy = (narrow ? ly + 72 : ly + 42);
      if (c && c.macs) {
        if (narrow) { t(svg, X0, sy, 'memory attention en t:', 'viz-t'); t(svg, X0, sy + 15, (mem.cond.length + mem.recent.length) + ' memorias espaciales + ' + mem.ptr.length + ' punteros', 'viz-s'); }
        else t(svg, X0, sy, 'memory attention en t: ' + (mem.cond.length + mem.recent.length) + ' memorias espaciales + ' + mem.ptr.length + ' punteros', 'viz-t');
        t(svg, X0, sy + (narrow ? 31 : 16), (c.tensor ? 'K, V de la memoria: ' + A.fmt.shape(c.tensor, 'sym') + ' = ' + A.fmt.shape(c.tensor, 'num') + ' · ' : '') + fmt.si(c.macs) + ' MACs', 'viz-n');
      } else t(svg, X0, sy, 'calculador sin datos de la memory attention (' + cfgId + ')', 'viz-s');
      readout(mem, c);
    }

    // un frame: cielo, pasto, árbol, auto (oculto si pasa detrás del árbol) y su máscara
    function frame(g, f, w, h, hid, past) {
      V.svg('rect', { x: 0, y: 0, width: w, height: h * 0.62, class: 'viz-p2m-sky' }, g);
      V.svg('rect', { x: 0, y: h * 0.62, width: w, height: h * 0.38, class: 'viz-p2m-grass' }, g);
      const cx = w * carX(f), cy = h * 0.70, cwid = w * 0.20, chei = h * 0.16;
      const car = V.svg('g', { class: 'viz-mb-car' + (past && !hid ? ' is-masked' : '') }, g);
      V.svg('rect', { x: r1(cx - cwid / 2), y: r1(cy - chei / 2), width: r1(cwid), height: r1(chei), rx: 1.5, class: 'viz-p2m-car' }, car);
      V.svg('rect', { x: r1(cx - cwid * 0.28), y: r1(cy - chei * 1.15), width: r1(cwid * 0.56), height: r1(chei * 0.7), rx: 1.5, class: 'viz-p2m-car' }, car);
      V.svg('circle', { cx: r1(cx - cwid * 0.3), cy: r1(cy + chei / 2), r: r1(chei * 0.32), class: 'viz-p2m-wheel' }, car);
      V.svg('circle', { cx: r1(cx + cwid * 0.3), cy: r1(cy + chei / 2), r: r1(chei * 0.32), class: 'viz-p2m-wheel' }, car);
      // árbol (tapa al auto en los frames del medio)
      V.svg('rect', { x: r1(w * (TREE[0] + TREE[1]) / 2 - w * 0.025), y: r1(h * 0.45), width: r1(w * 0.05), height: r1(h * 0.45), class: 'viz-p2m-trunk' }, g);
      V.svg('ellipse', { cx: r1(w * (TREE[0] + TREE[1]) / 2), cy: r1(h * 0.42), rx: r1(w * (TREE[1] - TREE[0]) / 2 + w * 0.03), ry: r1(h * 0.36), class: 'viz-p2m-leaf' }, g);
      if (past && hid) V.svg('rect', { x: 1, y: 1, width: w - 2, height: h - 2, class: 'viz-mb-occl' }, g);
    }

    function readout(mem, c) {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('frames con prompt que lee t:', mem.cond.length ? mem.cond.join(', ') : '—');
      kv('ventana t−1 … t−' + N + ':', mem.recent.length ? mem.recent.join(', ') : '—');
      kv('punteros:', mem.ptr.length + ' (≤ ' + PTRS + ')');
      if (hiddenAt(state.t)) kv('en t:', 'el auto está tapado → máscara vacía, memoria "sin objeto"');
      if (c && c.metrics && Number.isFinite(c.metrics.memoryBankMem)) kv('memoria leída (bf16, con posiciones):', fmt.bytes(c.metrics.memoryBankMem));
    }
    function ariaOf(mem) {
      return 'Frame actual ' + state.t + ' de ' + T + '. Memorias espaciales leídas: frames con prompt ' + (mem.cond.join(', ') || 'ninguno') + '; recientes ' + (mem.recent.join(', ') || 'ninguno') + '; ' + mem.ptr.length + ' punteros de objeto.' + (hiddenAt(state.t) ? ' En este frame el objeto está tapado.' : '');
    }

    stage.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); state.t = Math.max(1, Math.min(T - 1, state.t + (ev.key === 'ArrowRight' ? 1 : -1))); draw(); }
      else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); bAdd.click(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); });
      ro.observe(stage);
    }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('memory-bank', render);
})(typeof window !== 'undefined' ? window : globalThis);
