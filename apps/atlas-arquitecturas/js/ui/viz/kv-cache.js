/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/kv-cache.js
   Visualización "kv-cache" (SPEC §7.8, §18.3): el KV cache de un decoder durante la generación.
   El prefill escribe una fila de K y una de V por token del prompt EN CADA CAPA; cada paso de decode agrega una
   fila más por capa (la del token nuevo) y lee todas las anteriores. Cada fila tiene n_kv cabezas de d_h:
   con MHA (n_kv = h) es ancha, con GQA (n_kv = 8 en Llama 3) 4 veces más angosta, con MQA (n_kv = 1) una
   sola cabeza. Abajo, los bytes del calculador: por token (2·L·n_kv·d_h·bytes), del caché actual y del
   contexto completo, para MHA / GQA / MQA.
   Lo ilustrativo: las palabras del prompt y de la salida (y que se dibujen 4 capas de L). Del calculador
   (config llama3-8b, knobs nKV y kvBits, la precisión de la KV cache): L, h, n_kv, d_h y todos los bytes.
   params: { config:'llama3-8b', prompt:6, steps:3, nKV:'gqa'|'mha'|'mqa', bits:16 }   (bits = los de la caché → kvBits)
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const PROMPT = ['El', 'gato', 'se', 'subió', 'al', 'tejado'];
  const GEN = ['y', 'miró', 'la', 'luna', 'llena', 'en', 'silencio', '.', 'Luego', 'bajó'];

  function cfgVal(c, keys, d) { for (const k of keys) { const v = c && c[k]; if (Number.isFinite(v)) return v; } return d; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n), bytes: (n) => n + ' B' };
    const cfgId = params.config || 'llama3-8b';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const cfg = (run && run.config) || {};
    const L = Math.round(cfgVal(cfg, ['L', 'layers', 'nLayers'], 32));
    const h = Math.round(cfgVal(cfg, ['h', 'heads', 'nHeads'], 32));
    const nKV0 = Math.round(cfgVal(cfg, ['nKV', 'kvHeads', 'nKv'], 8));
    const dh = Math.round(cfgVal(cfg, ['dh', 'dHead', 'd_h', 'headDim'], 128));
    const ctxMax = Math.round(cfgVal(cfg, ['ctxMax', 'maxCtx', 'context', 'ctx'], 8192));
    const KINDS = { mha: { nKV: h, label: 'MHA' }, gqa: { nKV: nKV0, label: 'GQA' }, mqa: { nKV: 1, label: 'MQA' } };
    if (nKV0 === h) KINDS.gqa.nKV = Math.max(1, h / 4);
    const P0 = Math.max(2, Math.min(PROMPT.length, Math.round(+params.prompt || PROMPT.length)));
    const state = { kind: KINDS[params.nKV] ? params.nKV : 'gqa', steps: Math.max(0, Math.min(GEN.length, Math.round(+params.steps || 0))), bits: [16, 8].indexOf(+params.bits) >= 0 ? +params.bits : 16 };

    // ----- adaptador al calculador: bytes por token y del caché para ctx tokens (B = 1)
    function bytesFor(nKV, ctx) {
      let m = null;
      try { m = A.metrics(cfgId, { nKV, kvBits: state.bits, ctx, B: 1 }); } catch (e) { m = null; }
      const per = m && Number.isFinite(m.kvBytesPerToken) ? m.kvBytesPerToken : null, tot = m && Number.isFinite(m.kvCacheBytes) ? m.kvCacheBytes : null;
      return { per, tot, ok: Number.isFinite(per) && Number.isFinite(tot) };
    }

    const wrap = V.html('div', { class: 'viz viz-kv' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Cabezas K,V' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Cabezas K,V' }, g1);
    const kChips = Object.keys(KINDS).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: KINDS[k].label + ' (n_kv = ' + KINDS[k].nKV + ')' }, g1); b.addEventListener('click', () => { state.kind = k; draw(); }); b._k = k; return b; });
    const g2 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Generación' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Decode' }, g2);
    const bStep = V.html('button', { type: 'button', class: 'viz-chip', text: '+1 token' }, g2);
    const bReset = V.html('button', { type: 'button', class: 'viz-chip', text: 'volver al prefill' }, g2);
    bStep.addEventListener('click', () => { if (state.steps < GEN.length) { state.steps++; draw(); } });
    bReset.addEventListener('click', () => { state.steps = 0; draw(); });
    const g3 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Precisión del caché' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Caché a' }, g3);
    const bChips = [16, 8].map((b) => { const x = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: b + ' bits' }, g3); x.addEventListener('click', () => { state.bits = b; draw(); }); x._b = b; return x; });
    const stage = V.html('div', { class: 'viz-stage viz-kv-stage', tabindex: 0, role: 'group', 'aria-label': 'KV cache por capa. Flecha derecha: un paso de decode; izquierda: deshacer; M, G, Q: MHA, GQA, MQA' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'Ilustrativo: las palabras (un token por palabra) y que se dibujen solo algunas de las ' + L + ' capas (todas guardan lo mismo). Del calculador (' + ((run && run.label) || cfgId) + '): L = ' + L + ', h = ' + h + ', d<sub>h</sub> = ' + dh + ', n<sub>kv</sub> y los bytes. ' +
      'El prefill procesa el prompt entero en paralelo y escribe su K y su V en cada capa; cada paso de decode procesa UN token, lee todo el caché y agrega una fila por capa. Sin caché, cada paso volvería a calcular K y V de todo el prefijo. ' +
      'Una fila guarda K y V de n<sub>kv</sub> cabezas de d<sub>h</sub>: con GQA las ' + h + ' cabezas de query comparten ' + nKV0 + ' cabezas K,V, y el caché es ' + (h / nKV0) + ' veces más chico que con MHA (con MQA, ' + h + ' veces). Bytes por token = 2·L·n<sub>kv</sub>·d<sub>h</sub>·bytes; el caché crece lineal con el contexto y con el lote B.');

    let lastNarrow = null;
    function draw() {
      kChips.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.kind)));
      bChips.forEach((b) => b.setAttribute('aria-pressed', String(b._b === state.bits)));
      bStep.disabled = state.steps >= GEN.length; bReset.disabled = state.steps === 0;
      const nKV = KINDS[state.kind].nKV;
      const ctx = P0 + state.steps;
      const cw = stage.clientWidth || 860;
      const narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W0 = narrow ? 360 : 880;
      const layers = narrow ? [0, L - 1] : [0, 1, 2, L - 1];
      const blkWmax0 = h * (narrow ? 2.0 : 3.2), panelW = 2 * blkWmax0 + 14, pgap = narrow ? 18 : 20, dotsW = narrow ? 24 : 44;
      const W = Math.max(W0, 16 + layers.length * panelW + (layers.length - 1) * pgap + dotsW);
      const words = PROMPT.slice(0, P0).concat(GEN.slice(0, state.steps));
      // tira de tokens (en el teléfono, en dos filas)
      const chipW = narrow ? 40 : 52, perLine = Math.floor((W - 16) / (chipW + 4));
      const tokLines = Math.ceil(words.length / perLine);
      const yTok = 40, yLay = yTok + tokLines * 24 + 26;
      const rowH = 8, maxRows = P0 + GEN.length;
      const colPx = narrow ? 2.0 : 3.2;                   // px por cabeza (el ancho de la fila ∝ n_kv)
      const blkW = Math.max(5, nKV * colPx), blkWmax = h * colPx;
      const yBars = yLay + 30 + maxRows * rowH + 34;
      const Hh = yBars + 3 * 22 + 30;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img', 'aria-label': ariaOf(nKV, ctx) }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 15, state.steps ? 'Decode: paso ' + state.steps + ' (el token nuevo agrega una fila en cada capa)' : 'Prefill: el prompt escribe ' + P0 + ' filas de K y V en cada capa', 'viz-t');
      t(svg, 8, 29, 'fila = K o V de un token: ' + nKV + ' cabeza' + (nKV > 1 ? 's' : '') + ' × d_h = ' + dh, 'viz-s');
      words.forEach((w, i) => {
        const x = 8 + (i % perLine) * (chipW + 4), y = yTok + Math.floor(i / perLine) * 24;
        const cls = i < P0 ? 'is-prompt' : i === words.length - 1 && state.steps ? 'is-new' : 'is-gen';
        V.svg('rect', { x, y, width: chipW, height: 19, rx: 3, class: 'viz-kv-tok ' + cls }, svg);
        t(svg, x + chipW / 2, y + 13.5, w, 'viz-kv-toktxt' + (cls === 'is-new' ? ' is-new' : ''), 'middle');
      });
      // capas: K y V con una fila por token
      const oxOf = (j) => 8 + j * (panelW + pgap) + (j === layers.length - 1 ? dotsW : 0);
      layers.forEach((li, j) => {
        const ox = oxOf(j);
        const g = V.svg('g', { class: 'viz-kv-layer' }, svg);
        t(g, ox, yLay, 'capa ' + (li + 1), 'viz-n');
        ['K', 'V'].forEach((nm, q) => {
          const bx = ox + q * (blkWmax + 14);
          t(g, bx, yLay + 16, nm, 'viz-s');
          for (let r = 0; r < ctx; r++) {
            const cls = r < P0 ? 'is-prompt' : r === ctx - 1 && state.steps ? 'is-new' : 'is-gen';
            V.svg('rect', { x: r1(bx), y: r1(yLay + 22 + r * rowH), width: r1(blkW), height: rowH - 1.5, class: 'viz-kv-row ' + cls }, g);
          }
          if (nKV > 1 && blkW >= 10) {
            let d = '';
            for (let c = 1; c < nKV; c++) d += 'M' + r1(bx + c * blkW / nKV) + ' ' + r1(yLay + 22) + 'V' + r1(yLay + 22 + ctx * rowH - 1.5);
            V.svg('path', { d, class: 'viz-kv-heads' }, g);
          }
        });
      });
      // "…" entre las capas dibujadas y la última
      const dotsX = oxOf(layers.length - 2) + panelW + pgap / 2 + dotsW / 2;
      t(svg, dotsX, yLay + 22 + 3 * rowH, '…', 'viz-kv-dots', 'middle');
      t(svg, dotsX, yLay + 22 + 3 * rowH + 16, '×' + L, 'viz-s', 'middle');
      // bytes del calculador: MHA / GQA / MQA a contexto completo; el elegido resaltado
      t(svg, 8, yBars - 8, narrow ? 'KV cache, contexto máx. ' + fmt.int(ctxMax) + ' (B = 1):' : 'KV cache con el contexto máximo, ' + fmt.int(ctxMax) + ' tokens (B = 1, ' + state.bits + ' bits):', narrow ? 'viz-s' : 'viz-t');
      const rows = Object.keys(KINDS).map((k) => ({ k, b: bytesFor(KINDS[k].nKV, ctxMax) }));
      const bmax = Math.max(...rows.map((x) => x.b.tot || 0), 1);
      const lw = narrow ? 52 : 66, bw = W - 16 - lw - (narrow ? 70 : 96);
      rows.forEach((x, i) => {
        const y = yBars + i * 22;
        t(svg, 8, y + 12, KINDS[x.k].label + ' ' + KINDS[x.k].nKV, x.k === state.kind ? 'viz-n' : 'viz-s');
        V.svg('rect', { x: 8 + lw, y, width: bw, height: 15, class: 'viz-moe-track' }, svg);
        if (x.b.ok) V.svg('rect', { x: 8 + lw, y, width: r1(Math.max(1.5, bw * x.b.tot / bmax)), height: 15, class: 'viz-kv-bar' + (x.k === state.kind ? ' is-on' : '') }, svg);
        t(svg, 8 + lw + bw + 6, y + 12, x.b.ok ? fmt.bytes(x.b.tot) : '—', x.k === state.kind ? 'viz-n' : 'viz-s');
      });
      readout(nKV, ctx);
    }

    function readout(nKV, ctx) {
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      const cur = bytesFor(nKV, ctx);
      kv('contexto:', ctx + ' tokens (' + P0 + ' del prompt + ' + state.steps + (state.steps === 1 ? ' generado)' : ' generados)'));
      if (cur.ok) {
        kv('por token:', fmt.bytes(cur.per) + ' (2·' + L + '·' + nKV + '·' + dh + '·' + state.bits / 8 + ' B)');
        kv('caché ahora:', fmt.bytes(cur.tot));
      } else kv('', 'el calculador no da los bytes del KV cache');
    }
    function ariaOf(nKV, ctx) { return 'KV cache con ' + nKV + ' cabezas K,V por capa y ' + ctx + ' tokens: ' + P0 + ' del prompt y ' + state.steps + ' generados; cada capa guarda ' + ctx + ' filas de K y de V.'; }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight') { ev.preventDefault(); if (state.steps < GEN.length) { state.steps++; draw(); } }
      else if (k === 'ArrowLeft') { ev.preventDefault(); if (state.steps > 0) { state.steps--; draw(); } }
      else if (/^[mgq]$/i.test(k)) { ev.preventDefault(); state.kind = { m: 'mha', g: 'gqa', q: 'mqa' }[k.toLowerCase()]; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('kv-cache', render);
})(typeof window !== 'undefined' ? window : globalThis);
