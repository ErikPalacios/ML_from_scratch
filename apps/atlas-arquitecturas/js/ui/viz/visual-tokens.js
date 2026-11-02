/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/visual-tokens.js
   Visualización "visual-tokens" (SPEC §7.8, §19.4): cuántos tokens visuales le cuesta una imagen al LLM según cómo se
   convierte en tokens. Se arrastra la esquina de la imagen (o se usan los deslizadores / las flechas) y se ven tres
   estrategias lado a lado:
   - LLaVA-1.5: la imagen se rellena a un cuadrado y se redimensiona a 336×336 → siempre la misma rejilla (fijo);
   - LLaVA-NeXT (AnyRes): se elige la grilla de recortes de 336 que mejor encaja con la proporción, + la imagen base;
   - Qwen2-VL (resolución dinámica): se redimensiona a múltiplos de 28 (dentro de un mínimo y un máximo de píxeles) y cada
     bloque de 28×28 píxeles (2×2 parches de 14 unidos por el merger) es un token.
   Todas las cuentas y la geometría que se dibuja (tamaño redimensionado, grilla de recortes) salen del calculador:
   ATLAS.Arch.vlm (smartResize + qwenTokens de Qwen2-VL, llavaNextTokens de AnyRes; las reglas de los procesadores de HF)
   y ATLAS.Arch.metrics (tokens por imagen de LLaVA-1.5, bytes del KV cache por token).
   params: { W: 1280, H: 720 }   (tamaño de la imagen original en píxeles)
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const MINS = 112, MAXS = 2240, STEP = 4;   // los tamaños de ejemplo (1280×720, 812², 448×1344…) son múltiplos de 4
  const PRESETS = [[336, 336, '336²'], [1280, 720, '1280×720'], [812, 812, '812²'], [448, 1344, '448×1344'], [2016, 2016, '2016²']];
  const MODELS = [
    { id: 'llava15', cfg: 'llava15-7b', title: 'LLaVA-1.5', how: 'fijo: cuadrado de 336 px' },
    { id: 'anyres', cfg: 'llava-next-7b', kvCfg: 'llava15-7b', title: 'LLaVA-NeXT (AnyRes)', how: 'recortes de 336 + base' },
    { id: 'qwen', cfg: 'qwen2-vl-7b', title: 'Qwen2-VL', how: 'dinámico: múltiplos de 28' },
  ];

  // ----- calculador: cuentas (ATLAS.Arch.vlm = las reglas de los procesadores de HF) y bytes del KV cache por token
  const kvMemo = {};
  function kvPerTok(A, cfg) {
    if (kvMemo[cfg] == null) { try { kvMemo[cfg] = A.metrics(cfg).kvBytesPerToken; } catch (e) { kvMemo[cfg] = NaN; } }
    return kvMemo[cfg];
  }
  function infoOf(A, m, H, W) {
    const vlm = A && A.vlm;
    const o = { ok: false, tokens: null, kv: null };
    try {
      if (m.id === 'llava15') {
        const c = A.run(m.cfg).config;
        o.tokens = A.metrics(m.cfg).visualTokensPerImage;
        o.grid = c.H / c.P;
        o.geo = c.W + '×' + c.H + ' px → ' + o.grid + '×' + o.grid;
      } else if (m.id === 'anyres') {
        const x = vlm.llavaNextTokens(H, W);
        o.tokens = x.tokens; o.cropPx = String(x.grid).split('×').map(Number); o.detail = x;
        o.geo = x.crops + ' recortes (' + o.cropPx[1] + '×' + o.cropPx[0] + ' px) + base';
      } else {
        const r = vlm.smartResize(H, W), q = vlm.qwenTokens(r.H, r.W);
        o.tokens = q.tokens; o.resized = [r.H, r.W]; o.cells = [q.gridH, q.gridW];
        o.geo = r.W + '×' + r.H + ' px → ' + q.gridW + '×' + q.gridH;
      }
      o.ok = Number.isFinite(o.tokens);
      const kpt = kvPerTok(A, m.kvCfg || m.cfg);
      if (o.ok && Number.isFinite(kpt)) o.kv = o.tokens * kpt;
    } catch (e) { o.ok = false; o.err = e.message; }
    return o;
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), bytes: (n) => n + ' B' };
    const clampS = (v) => Math.max(MINS, Math.min(MAXS, Math.round(v / STEP) * STEP));
    const state = { W: clampS(+params.W || 1280), H: clampS(+params.H || 720) };

    const wrap = V.html('div', { class: 'viz viz-vt' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Tamaños de ejemplo' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Imagen' }, g1);
    const pChips = PRESETS.map(([w, h, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g1); b.addEventListener('click', () => { state.W = w; state.H = h; draw(); }); b._wh = [w, h]; return b; });
    const g2 = V.html('div', { class: 'viz-ctl viz-vt-sliders' }, ctl);
    const slider = (lab, key) => {
      const l = V.html('label', { class: 'viz-vt-sl' }, g2);
      V.html('span', { class: 'viz-ctl-l', text: lab }, l);
      const inp = V.html('input', { type: 'range', min: MINS, max: MAXS, step: STEP, 'aria-label': lab + ' de la imagen en píxeles' }, l);
      const o = V.html('output', { class: 'viz-vt-out' }, l);
      inp.addEventListener('input', () => { state[key] = clampS(+inp.value); draw(); });
      return { inp, o };
    };
    const sW = slider('Ancho', 'W'), sH = slider('Alto', 'H');
    const stage = V.html('div', { class: 'viz-stage viz-vt-stage', tabindex: 0, role: 'group', 'aria-label': 'Tamaño de la imagen: flechas izquierda y derecha cambian el ancho, arriba y abajo el alto (de a 28 píxeles); o arrastra la esquina' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null, dragging = null;
    function draw() {
      pChips.forEach((b) => b.setAttribute('aria-pressed', String(b._wh[0] === state.W && b._wh[1] === state.H)));
      sW.inp.value = state.W; sW.o.textContent = state.W + ' px'; sH.inp.value = state.H; sH.o.textContent = state.H + ' px';
      const infos = MODELS.map((m) => Object.assign({ m }, infoOf(A, m, state.H, state.W)));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(440, cw)) : 880;
      // fila 1: la imagen original con su asa (izquierda en ancho; arriba en angosto)
      const box = narrow ? 120 : 150, k = box / MAXS;
      const ow = state.W * k, oh = state.H * k;
      const panW = narrow ? W - 16 : (W - 16 - box - 30) / 3, panH = narrow ? 150 : 210, drawH = narrow ? 92 : 128;
      const y0 = 40, py0 = narrow ? y0 + box + 30 : y0;
      // rejillas de más de 32 tokens por lado: una línea cada k tokens (el mismo k en los dos ejes); el pie lo dice
      const gridK = Math.max(1, ...infos.filter((x) => x.ok && x.m.id !== 'anyres').map((x) => (x.cells ? Math.ceil(Math.max(x.cells[0], x.cells[1]) / 32) : Math.ceil(x.grid / 32))));
      const Hh = (narrow ? py0 + 3 * (panH + 10) + 6 : y0 + Math.max(box, panH) + 12) + (gridK > 1 ? 14 : 0);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img', 'aria-label': ariaOf(infos) }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 15, narrow ? 'Imagen de ' + state.W + '×' + state.H + ' px → ¿tokens?' : 'Una imagen de ' + state.W + '×' + state.H + ' px → ¿cuántos tokens para el LLM?', 'viz-t');
      t(svg, 8, 29, narrow ? 'arrastra la esquina o usa los deslizadores' : 'arrastra la esquina de la imagen (o flechas: ±28 px)', 'viz-s');
      // imagen original (escala común: el marco = ' + MAXS + ' px)
      const ox = 8, oy = y0;
      V.svg('rect', { x: ox, y: oy, width: box, height: box, class: 'viz-vt-max' }, svg);
      V.scene(svg, ox, oy + box - oh, ow, oh, 0);
      const hx = ox + ow, hy = oy + box - oh;
      const handle = V.svg('g', { class: 'viz-vt-handle' }, svg);
      V.svg('circle', { cx: r1(hx), cy: r1(hy), r: 7, class: 'viz-vt-knob' }, handle);
      V.svg('circle', { cx: r1(hx), cy: r1(hy), r: 16, class: 'viz-vt-hit' }, handle);
      t(svg, ox, oy + box + 13, 'original (marco = ' + MAXS + ' px)', 'viz-s');
      handle.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        const rc = svg.getBoundingClientRect();
        dragging = { rc, sc: W / rc.width, ox, oy, box, k, id: ev.pointerId };
        try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ }
      });
      // escala común de las barras: el máximo de los tres a este tamaño
      const tmax = Math.max(1, ...infos.map((x) => (x.ok ? x.tokens : 0)));
      infos.forEach((x, i) => {
        const px = narrow ? 8 : ox + box + 30 + i * panW, py = narrow ? py0 + i * (panH + 10) : py0;
        const g = V.svg('g', { class: 'viz-vt-pan viz-vt--' + x.m.id }, svg);
        V.svg('rect', { x: r1(px), y: r1(py - 2), width: r1(panW - 8), height: panH, rx: 4, class: 'viz-vt-panbg' }, g);
        t(g, px + 8, py + 13, x.m.title, 'viz-t');
        t(g, px + 8, py + 26, x.m.how, 'viz-s');
        const dx = px + 8, dy = py + 34, dw = narrow ? Math.min(150, panW - 120) : panW - 24, dh = drawH;
        drawMethod(V, g, x, dx, dy, dw, dh, state);
        // cuenta y barra
        const bx = narrow ? dx + dw + 14 : dx, by = narrow ? dy + 8 : dy + dh + 18;
        t(g, bx, by + (narrow ? 14 : 0), x.ok ? fmt.int(x.tokens) : '—', 'viz-vt-big');
        t(g, bx, by + (narrow ? 28 : 14), 'tokens visuales', 'viz-s');
        const bw = narrow ? panW - 16 - (bx - px) : panW - 24;
        V.svg('rect', { x: r1(bx), y: r1(by + (narrow ? 36 : 20)), width: r1(bw), height: 8, class: 'viz-moe-track' }, g);
        if (x.ok) V.svg('rect', { x: r1(bx), y: r1(by + (narrow ? 36 : 20)), width: r1(Math.max(1.5, bw * x.tokens / tmax)), height: 8, class: 'viz-vt-bar' }, g);
      });
      readout(infos);
      if (gridK > 1) t(svg, W - 8, Hh - 4, 'rejilla: una línea cada ' + gridK + ' tokens', 'viz-s', 'end');
    }

    // dibujo de cada estrategia dentro de (X, Y, w, h); la geometría es la que devolvió el calculador
    function drawMethod(V, g, x, X, Y, w, h, st) {
      if (!x.ok) return;
      if (x.m.id === 'llava15') {
        const side = Math.min(w, h), sx = X + (w - side) / 2;
        V.svg('rect', { x: r1(sx), y: r1(Y), width: r1(side), height: r1(side), class: 'viz-vt-pad' }, g);
        const s = side / Math.max(st.W, st.H), iw = st.W * s, ih = st.H * s;
        V.scene(g, sx + (side - iw) / 2, Y + (side - ih) / 2, iw, ih, 0);
        gridLines(V, g, sx, Y, side, side, x.grid, x.grid);
        return;
      }
      if (x.m.id === 'qwen') {
        const [rh, rw] = x.resized, s = Math.min(w / rw, h / rh), dw = rw * s, dh = rh * s, sx = X + (w - dw) / 2;
        V.scene(g, sx, Y, dw, dh, 0);
        gridLines(V, g, sx, Y, dw, dh, x.cells[0], x.cells[1]);
        return;
      }
      // AnyRes: la grilla de recortes de 336 (la imagen encajada sin deformar) + la imagen base, más chica
      const [gh, gw] = x.cropPx, rows = gh / 336, cols = gw / 336;
      const bw = Math.min(w * 0.28, h * 0.5);
      const sc = Math.min((w - bw - 8) / gw, h / gh), cw2 = gw * sc, ch2 = gh * sc;
      V.svg('rect', { x: r1(X), y: r1(Y), width: r1(cw2), height: r1(ch2), class: 'viz-vt-pad' }, g);
      const s2 = Math.min(cw2 / st.W, ch2 / st.H), iw = st.W * s2, ih = st.H * s2;
      V.scene(g, X + (cw2 - iw) / 2, Y + (ch2 - ih) / 2, iw, ih, 0);
      gridLines(V, g, X, Y, cw2, ch2, rows, cols, 'viz-vt-crop');
      const bx = X + cw2 + 8, by = Y + ch2 - bw;
      V.svg('rect', { x: r1(bx), y: r1(by), width: r1(bw), height: r1(bw), class: 'viz-vt-pad' }, g);
      const s3 = bw / Math.max(st.W, st.H);
      V.scene(g, bx + (bw - st.W * s3) / 2, by + (bw - st.H * s3) / 2, st.W * s3, st.H * s3, 0);
      V.svg('rect', { x: r1(bx), y: r1(by), width: r1(bw), height: r1(bw), class: 'viz-vt-crop' }, g);
      V.svg('text', { x: r1(bx + bw / 2), y: r1(by - 4), class: 'viz-s', 'text-anchor': 'middle' }, g).textContent = 'base';
    }
    function gridLines(V, g, x, y, w, h, nr, nc, cls) {
      // hasta 32 líneas por eje (más serían una mancha): si hay más, una cada k tokens, el MISMO k en los dos ejes (una
      // celda dibujada = k×k tokens; con k distintos las celdas dejaban de ser cuadradas); el pie lo avisa (gridNote)
      const k = Math.max(1, Math.ceil(nr / 32), Math.ceil(nc / 32)), kr = k, kc = k;
      let d = '';
      for (let i = kc; i < nc; i += kc) d += 'M' + r1(x + i * w / nc) + ' ' + r1(y) + 'V' + r1(y + h);
      for (let i = kr; i < nr; i += kr) d += 'M' + r1(x) + ' ' + r1(y + i * h / nr) + 'H' + r1(x + w);
      if (d) V.svg('path', { d, class: cls || 'viz-vt-grid' }, g);
      V.svg('rect', { x: r1(x), y: r1(y), width: r1(w), height: r1(h), class: 'viz-vt-frame' }, g);
    }

    function readout(infos) {
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      infos.forEach((x) => kv(x.m.title + ':', x.ok ? fmt.int(x.tokens) + ' (' + x.geo + ')' + (x.kv ? ' · KV ' + fmt.bytes(x.kv) : '') : 'sin dato del calculador'));
      const nx = infos.find((x) => x.m.id === 'anyres' && x.ok);
      note.innerHTML = 'Tamaños como ancho × alto. Cuentas del calculador, con la regla del procesador de HF de cada modelo; KV cache de la imagen a 16 bits = tokens × bytes por token del LLM (LLaVA-NeXT con el de LLaVA-1.5 7B). ' +
        'LLaVA-1.5 ve siempre la misma rejilla: barato, pero una imagen grande o alargada pierde detalle (texto chico, documentos). ' +
        'AnyRes agrega recortes de 336 a resolución completa más la imagen base para el contexto global' + (nx ? ' (aquí: ' + fmt.int(nx.detail.unpadded) + ' tokens de los recortes sin el relleno + ' + fmt.int(nx.detail.newlines) + ' saltos de línea + la base; el blog cuenta (recortes + 1)·576 = ' + fmt.int(nx.detail.tokensPaper) + ')' : '') + '. ' +
        'Qwen2-VL respeta la proporción y la resolución (lados múltiplos de 28, entre un mínimo y un máximo de píxeles): los tokens crecen con el área, ≈ píxeles / 28². Más detalle, a cambio de un prefill y un KV cache que crecen con la imagen.';
    }
    function ariaOf(infos) { return 'Imagen de ' + state.W + ' por ' + state.H + ' píxeles. ' + infos.map((x) => x.m.title + ': ' + (x.ok ? x.tokens + ' tokens' : 'sin dato')).join('; ') + '.'; }

    // arrastre: los eventos van al escenario (persiste aunque el SVG se redibuje)
    stage.addEventListener('pointermove', (ev) => {
      if (!dragging || ev.pointerId !== dragging.id) return;
      const x = (ev.clientX - dragging.rc.left) * dragging.sc, y = (ev.clientY - dragging.rc.top) * dragging.sc;
      const nw = clampS((x - dragging.ox) / dragging.k), nh = clampS((dragging.oy + dragging.box - y) / dragging.k);
      if (nw !== state.W || nh !== state.H) { state.W = nw; state.H = nh; draw(); }
    });
    const endDrag = () => { dragging = null; };
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, d = 28;
      if (k === 'ArrowRight') state.W = clampS(state.W + d);
      else if (k === 'ArrowLeft') state.W = clampS(state.W - d);
      else if (k === 'ArrowUp') state.H = clampS(state.H + d);
      else if (k === 'ArrowDown') state.H = clampS(state.H - d);
      else return;
      ev.preventDefault(); draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('visual-tokens', render);
})(typeof window !== 'undefined' ? window : globalThis);
