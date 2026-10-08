/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/vlm-token-cost.js
   Visualización "vlm-token-cost" (SPEC §7.8, §19.4): cuánto del costo de un prompt multimodal se lo lleva la imagen.
   Dos barras apiladas, del calculador (ATLAS.Arch.metrics de la config con sus knobs):
   - MACs del prefill: encoder de visión · proyector (o merger) · LLM sobre los tokens visuales · LLM sobre el texto;
   - KV cache del prompt: la parte de las imágenes (kvBytesPerImage × imágenes) y la del texto.
   Y una curva: la fracción del prefill que viene de la imagen (prefillShareFromImage) al crecer la imagen (Qwen2-VL:
   lado en píxeles) o el número de imágenes (LLaVA-1.5: 576 tokens cada una), con el punto actual; el eje x es
   proporcional al knob.
   Lo único que no es del calculador: nada (las configs y los knobs son los del calculador; la curva es una barrida de
   metrics()).
   params: { model:'qwen2-vl'|'llava', side:812 (Qwen2-VL), images:1 (LLaVA), T:128 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const MODELS = {
    llava: { cfg: 'llava15-7b', title: 'LLaVA-1.5 7B', proj: 'proyector' },
    'qwen2-vl': { cfg: 'qwen2-vl-7b', title: 'Qwen2-VL 7B', proj: 'merger' },
  };
  const SIDES = [224, 448, 812, 1120, 1456, 1792];
  const IMAGES = [1, 2, 4, 8];
  const TS = [32, 128, 512, 2048];

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), bytes: (n) => n + ' B', ops: (n) => n + ' MACs' };
    const ops = (n) => (fmt.ops ? fmt.ops(n) : fmt.si(n) + 'MACs');
    const state = {
      model: MODELS[params.model] ? params.model : 'qwen2-vl',
      side: SIDES.indexOf(+params.side) >= 0 ? +params.side : 812,
      images: IMAGES.indexOf(+params.images) >= 0 ? +params.images : 1,
      T: TS.indexOf(+params.T) >= 0 ? +params.T : 128,
    };
    // knobs del calculador: Qwen2-VL H, W (múltiplos de 28) y T; LLaVA images y T
    const ovOf = (st) => (st.model === 'qwen2-vl' ? { H: st.side, W: st.side, T: st.T } : { images: st.images, T: st.T });
    function met(st) {
      try { return A.metrics(MODELS[st.model].cfg, ovOf(st)); } catch (e) { return null; }
    }
    // porcentaje: "<1 %" en vez de un 0 % que no es cero (el merger de Qwen2-VL, ≈ 0.4 % del prefill)
    const pct = (v, tot) => { const f = tot > 0 ? 100 * v / tot : 0; return f > 0 && f < 1 ? '<1 %' : Math.round(f) + ' %'; };
    const num = (m, ...ks) => { for (const k of ks) if (m && Number.isFinite(m[k])) return m[k]; return null; };

    const wrap = V.html('div', { class: 'viz viz-vtc' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const chips = (g, vals, key, label) => vals.map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._v = v; b._k = key; return b; });
    const all = [];
    all.push(...chips(grp('Modelo'), Object.keys(MODELS), 'model', (k) => MODELS[k].title));
    const gSide = grp('Lado de la imagen');
    all.push(...chips(gSide, SIDES, 'side', (v) => v + ' px'));
    const gImg = grp('Imágenes');
    all.push(...chips(gImg, IMAGES, 'images', (v) => String(v)));
    all.push(...chips(grp('Texto'), TS, 'T', (v) => v + ' tokens'));
    const stage = V.html('div', { class: 'viz-stage viz-vtc-stage', tabindex: 0, role: 'group', 'aria-label': 'Costo de la imagen en el prefill. Flechas izquierda y derecha: tamaño de la imagen (Qwen2-VL) o número de imágenes (LLaVA)' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      gSide.hidden = state.model !== 'qwen2-vl'; gImg.hidden = state.model === 'qwen2-vl';
      const m = met(state);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(440, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      if (!m) { t(svg, 8, 20, 'El calculador no tiene esta combinación.', 'viz-t'); svg.setAttribute('viewBox', '0 0 ' + W + ' 30'); readout(null); return; }
      const vis = num(m, 'visionMacs') || 0, proj = num(m, 'projectorMacs') || 0, llm = num(m, 'llmPrefillMacs') || 0;
      const total = num(m, 'prefillMacs') || vis + proj + llm;
      const share = num(m, 'prefillShareFromImage');
      // el LLM, partido por el calculador: con N + T filas menos con T (llmMacsFromImage) y solo el texto (llmMacsTextOnly)
      const llmImg = num(m, 'llmMacsFromImage'), llmTxt = num(m, 'llmMacsTextOnly');
      const nImg = state.model === 'qwen2-vl' ? 1 : state.images;
      const kvImg = (num(m, 'kvBytesPerImage') || 0) * nImg, kvTok = num(m, 'kvBytesPerToken');
      const tTxt = num(m, 'textTokens'), tVis = num(m, 'visualTokens');
      const kvTxt = kvTok != null && tTxt != null ? kvTok * tTxt : null;
      t(svg, 8, 15, MODELS[state.model].title + ' · ' + (state.model === 'qwen2-vl' ? 'imagen de ' + state.side + '×' + state.side + ' px' : state.images + (state.images === 1 ? ' imagen' : ' imágenes')) + ' + ' + state.T + (narrow ? ' de texto' : ' tokens de texto'), 'viz-t');
      t(svg, 8, 29, narrow ? 'costo del prompt (calculador)' : 'de dónde sale el costo del prompt (del calculador)', 'viz-s');
      const lx = 8, bw = W - 16, barH = 22;
      let y = 46;
      const stack = (title, parts, tot, f) => {
        t(svg, lx, y, title + ': ' + f(tot), 'viz-n');
        y += 6;
        let x = lx;
        parts.forEach((p) => {
          const w = tot > 0 ? bw * p.v / tot : 0;
          if (w > 0) V.svg('rect', { x: r1(x), y: r1(y), width: r1(Math.max(w, 0.8)), height: barH, class: 'viz-vtc-seg ' + p.cls }, svg);
          x += w;
        });
        y += barH + 4;
        // leyenda debajo: una línea por parte en el teléfono, en fila en ancho
        let lx2 = lx;
        parts.forEach((p) => {
          const s = p.label + ' ' + pct(p.v, tot);
          if (narrow) { y += 14; V.svg('rect', { x: lx, y: r1(y - 9), width: 9, height: 9, class: 'viz-vtc-seg ' + p.cls }, svg); t(svg, lx + 13, y, s, 'viz-s'); }
          else { V.svg('rect', { x: r1(lx2), y: r1(y + 4), width: 9, height: 9, class: 'viz-vtc-seg ' + p.cls }, svg); t(svg, lx2 + 13, y + 13, s, 'viz-s'); lx2 += 13 + s.length * 6.6 + 18; }
        });
        y += narrow ? 22 : 34;
      };
      const P = MODELS[state.model].proj;
      stack('MACs del prefill', [
        { v: vis, label: 'encoder de visión', cls: 'is-vis' },
        { v: proj, label: P, cls: 'is-proj' },
        { v: llmImg || 0, label: 'LLM: tokens de imagen', cls: 'is-llmimg' },
        { v: llmTxt || 0, label: 'LLM: texto', cls: 'is-llmtxt' },
      ], total, ops);
      if (kvTxt != null) stack('KV cache del prompt (16 bits)', [
        { v: kvImg, label: nImg === 1 ? 'imagen' : 'imágenes', cls: 'is-llmimg' },
        { v: kvTxt, label: 'texto', cls: 'is-llmtxt' },
      ], kvImg + kvTxt, fmt.bytes);
      // curva: fracción del prefill que viene de la imagen al barrer el knob
      const sweep = state.model === 'qwen2-vl' ? SIDES.map((s) => ({ x: s, lab: s + '', st: Object.assign({}, state, { side: s }) })) : IMAGES.map((n) => ({ x: n, lab: String(n), st: Object.assign({}, state, { images: n }) }));
      const pts = sweep.map((p) => { const mm = met(p.st); return { x: p.x, lab: p.lab, s: num(mm, 'prefillShareFromImage') }; }).filter((p) => Number.isFinite(p.s));
      if (pts.length > 1) {
        const ch = 120, cx0 = lx + 34, cw2 = bw - 50, cy0 = y + 22;
        t(svg, lx, y + 4, narrow ? 'prefill por la imagen, según ' + (state.model === 'qwen2-vl' ? 'el lado' : 'las imágenes') : 'parte del prefill que viene de la imagen, según ' + (state.model === 'qwen2-vl' ? 'el lado (px)' : 'las imágenes'), 'viz-s');
        V.svg('rect', { x: cx0, y: cy0, width: cw2, height: ch, class: 'viz-rl-box' }, svg);
        [0, 50, 100].forEach((v) => { const yy = cy0 + ch - ch * v / 100; t(svg, cx0 - 5, yy + 4, v + ' %', 'viz-s', 'end'); if (v && v < 100) V.svg('path', { d: 'M' + cx0 + ' ' + r1(yy) + 'H' + r1(cx0 + cw2), class: 'viz-rl-grid' }, svg); });
        // x proporcional al knob (lado en px o número de imágenes), no equiespaciado: una escala pareja doblaba la curva
        const xa = pts[0].x, xb = pts[pts.length - 1].x;
        const X = (i) => cx0 + 10 + (pts[i].x - xa) / ((xb - xa) || 1) * (cw2 - 20), Y = (s) => cy0 + ch - ch * s;
        V.svg('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + r1(X(i)) + ' ' + r1(Y(p.s))).join(''), class: 'viz-vtc-line' }, svg);
        pts.forEach((p, i) => {
          const cur = state.model === 'qwen2-vl' ? p.x === state.side : p.x === state.images;
          const g = V.svg('g', { class: 'viz-cell-btn' }, svg);
          g.addEventListener('click', () => { if (state.model === 'qwen2-vl') state.side = p.x; else state.images = p.x; draw(); });
          V.svg('circle', { cx: r1(X(i)), cy: r1(Y(p.s)), r: cur ? 6 : 4, class: 'viz-vtc-pt' + (cur ? ' is-on' : '') }, g);
          t(svg, X(i), cy0 + ch + 14, p.lab, cur ? 'viz-n' : 'viz-s', 'middle');
          if (cur) t(svg, X(i) + (i === pts.length - 1 ? -10 : 0), p.s > 0.8 ? Y(p.s) + 20 : Y(p.s) - 10, Math.round(100 * p.s) + ' %', 'viz-rl-lab', i === pts.length - 1 ? 'end' : 'middle');
        });
        y = cy0 + ch + 24;
      }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      svg.setAttribute('aria-label', 'Prefill: ' + ops(total) + ', ' + (Number.isFinite(share) ? Math.round(100 * share) + ' % por la imagen' : '') + '. Tokens: ' + tVis + ' visuales y ' + tTxt + ' de texto.');
      readout(m, { total, share, kvImg, kvTxt, tVis, tTxt });
    }
    function readout(m, x) {
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      if (!m) { kv('', 'sin datos del calculador'); return; }
      if (x.tVis != null) kv('tokens visuales:', fmt.int(x.tVis));
      if (x.tTxt != null) kv('de texto:', fmt.int(x.tTxt));
      if (Number.isFinite(num(m, 'visualShare'))) kv('del prompt, imagen:', Math.round(100 * num(m, 'visualShare')) + ' %');
      kv('prefill:', ops(x.total));
      if (Number.isFinite(x.share)) kv('por la imagen:', Math.round(100 * x.share) + ' %');
      if (x.kvTxt != null) kv('KV cache del prompt:', fmt.bytes(x.kvImg + x.kvTxt));
      note.innerHTML = 'Todo del calculador (' + MODELS[state.model].title + (state.model === 'qwen2-vl' ? ': una imagen; se cambian su lado y el texto' : ': se cambian el número de imágenes y el texto; el tamaño no es un knob, cada imagen se lleva a 336×336') + '). La imagen paga dos veces: el encoder de visión la procesa entera y, después, sus tokens entran al LLM como cualquier otro token (MACs del prefill, atención cuadrática y KV cache). ' +
        (state.model === 'qwen2-vl' ? 'En Qwen2-VL los tokens crecen con el área de la imagen: el doble de lado ≈ el cuádruple de tokens.' : 'En LLaVA-1.5 cada imagen son siempre los mismos tokens: el costo crece con el número de imágenes, no con su tamaño.');
    }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
      ev.preventDefault();
      const d = k === 'ArrowRight' ? 1 : -1;
      if (state.model === 'qwen2-vl') { const i = Math.max(0, Math.min(SIDES.length - 1, SIDES.indexOf(state.side) + d)); state.side = SIDES[i]; }
      else { const i = Math.max(0, Math.min(IMAGES.length - 1, IMAGES.indexOf(state.images) + d)); state.images = IMAGES[i]; }
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('vlm-token-cost', render);
})(typeof window !== 'undefined' ? window : globalThis);
