/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/roofline.js
   Visualización "roofline" (SPEC §7.8, §18.3): el modelo roofline (Williams et al., CACM 2009) para un LLM.
   Eje x: intensidad aritmética I = FLOPs / bytes movidos de la memoria (HBM); eje y: TFLOPS alcanzables,
   min(pico de cómputo, ancho de banda · I). El codo (ridge point) = pico / ancho de banda.
   Dos puntos del calculador (config llama3-8b): el PREFILL de T tokens (cada peso leído se usa T veces:
   I ≈ T por byte de peso a 16 bits → a la derecha del codo, limitado por cómputo) y un paso de DECODE con
   lote B (cada peso se usa B veces y además se lee el KV cache: I ≈ B → a la izquierda, limitado por
   memoria). La cota de tokens/s del decode = ancho de banda / bytes por paso (estimación, "≈").
   Lo NO ilustrativo: FLOPs y bytes del calculador; los números de la GPU, de la hoja de datos de NVIDIA
   (rotulados con su fuente). Nada sintético.
   params: { config:'llama3-8b', gpu:'h100'|'a100', T:2048, B:1, ctx:4096, bits:16 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;

  // Hojas de datos de NVIDIA (BF16 denso, sin dispersidad; ancho de banda de HBM)
  const GPUS = {
    h100: { label: 'H100 SXM', tflops: 989, bw: 3.35e12, src: 'NVIDIA H100 Tensor Core GPU datasheet (SXM5): 989 TFLOPS BF16 denso (1,979 con dispersidad 2:4), HBM3 3.35 TB/s' },
    a100: { label: 'A100 SXM 80 GB', tflops: 312, bw: 2.039e12, src: 'NVIDIA A100 Tensor Core GPU datasheet (SXM, 80 GB): 312 TFLOPS BF16 denso (624 con dispersidad), HBM2e 2,039 GB/s' },
  };
  const POW2 = (lo, hi) => { const a = []; for (let v = lo; v <= hi; v *= 2) a.push(v); return a; };
  const TS = POW2(1, 8192), BS = POW2(1, 256);

  function num(m, keys) { for (const k of keys) { const v = m && m[k]; if (typeof v === 'function') continue; if (Number.isFinite(v)) return v; } return null; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n), bytes: (n) => n + ' B' };
    const cfgId = params.config || 'llama3-8b';
    let label = cfgId;
    try { label = A.run(cfgId).label || cfgId; } catch (e) { /* id */ }
    const pick = (arr, v, d) => (arr.indexOf(+v) >= 0 ? +v : d);
    const state = { gpu: GPUS[params.gpu] ? params.gpu : 'h100', T: pick(TS, params.T, 2048), B: pick(BS, params.B, 1), ctx: Number.isFinite(+params.ctx) ? +params.ctx : 4096, bits: [16, 8, 4].indexOf(+params.bits) >= 0 ? +params.bits : 16 };

    // ----- adaptador al calculador: intensidad del prefill (T tokens) y de un paso de decode (lote B, contexto ctx)
    function calc() {
      const G = GPUS[state.gpu], hw = { bits: state.bits, bandwidth: G.bw, peakFlops: G.tflops * 1e12 };
      let mp = null, md = null;
      try { mp = A.metrics(cfgId, Object.assign({ T: state.T, B: 1 }, hw)); } catch (e) { mp = null; }
      try { md = A.metrics(cfgId, Object.assign({ ctx: state.ctx, B: state.B }, hw)); } catch (e) { md = null; }
      const Ip = num(mp, ['arithmeticIntensityPrefill']), Id = num(md, ['arithmeticIntensityDecode']);
      return { Ip, Id, tok: num(md, ['decodeTokPerSecUpperBound']), perSeq: num(md, ['decodeTokPerSecPerSeq']), wB: num(md, ['weightBytes']), kvB: num(md, ['kvCacheBytes']),
        stepB: num(md, ['decodeBytesPerStep']), ok: Number.isFinite(Ip) && Number.isFinite(Id) };
    }

    const wrap = V.html('div', { class: 'viz viz-rl' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (lab, items, get, setv) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: lab }, g);
      return items.map(([v, text]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text }, g); b.addEventListener('click', () => { setv(v); draw(); }); b._v = v; b._get = get; return b; });
    };
    const stepGroup = (lab, arr, key, fmtv) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: lab }, g);
      const b0 = V.html('button', { type: 'button', class: 'viz-chip', text: '÷2', 'aria-label': lab + ' a la mitad' }, g);
      const o = V.html('span', { class: 'viz-rope-pos' }, g);
      const b1 = V.html('button', { type: 'button', class: 'viz-chip', text: '×2', 'aria-label': lab + ' al doble' }, g);
      const mv = (d) => { const i = arr.indexOf(state[key]); state[key] = arr[Math.max(0, Math.min(arr.length - 1, i + d))]; draw(); };
      b0.addEventListener('click', () => mv(-1)); b1.addEventListener('click', () => mv(1));
      return { upd() { const i = arr.indexOf(state[key]); o.textContent = fmtv(state[key]); b0.disabled = i <= 0; b1.disabled = i >= arr.length - 1; }, mv };
    };
    const gChips = chipGroup('GPU', Object.keys(GPUS).map((k) => [k, GPUS[k].label]), () => state.gpu, (v) => { state.gpu = v; });
    const bChips = chipGroup('Pesos y KV a', [[16, '16 bits'], [8, '8 bits'], [4, '4 bits']], () => state.bits, (v) => { state.bits = v; });
    const sT = stepGroup('Prefill: T', TS, 'T', (v) => 'T = ' + fmt.int(v));
    const sB = stepGroup('Decode: lote B', BS, 'B', (v) => 'B = ' + v);
    const stage = V.html('div', { class: 'viz-stage viz-rl-stage', tabindex: 0, role: 'group', 'aria-label': 'Roofline. Flechas izquierda y derecha: T del prefill; arriba y abajo: lote B del decode' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      [...gChips, ...bChips].forEach((b) => b.setAttribute('aria-pressed', String(b._get() === b._v)));
      sT.upd(); sB.upd();
      const G = GPUS[state.gpu], c = calc();
      const peak = G.tflops * 1e12, ridge = peak / G.bw;
      const cw = stage.clientWidth || 860;
      const narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? 360 : 820, Hh = narrow ? 300 : 340;
      const px0 = narrow ? 46 : 64, px1 = W - 14, py0 = 34, py1 = Hh - 44;
      const X0 = -1, X1 = 4.5, Y0 = 12, Y1 = Math.log10(peak) + 0.6;     // log10: I ∈ [0.1, ~3e4] FLOPs/B; y en FLOP/s
      const xs = (I) => px0 + (Math.log10(Math.max(I, 1e-3)) - X0) / (X1 - X0) * (px1 - px0);
      const ys = (F) => py1 - (Math.log10(Math.max(F, 1)) - Y0) / (Y1 - Y0) * (py1 - py0);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img', 'aria-label': ariaOf(c, G, ridge) }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 15, 'Roofline de ' + G.label + ' con ' + label + ' (' + state.bits + ' bits)', 'viz-t');
      t(svg, 8, 29, narrow ? 'TFLOPS alcanzables = min(pico, BW · I)' : 'TFLOPS alcanzables = min(pico de cómputo, ancho de banda · intensidad); ejes logarítmicos', 'viz-s');
      // zonas y rejilla
      V.svg('rect', { x: px0, y: py0, width: r1(xs(ridge) - px0), height: r1(py1 - py0), class: 'viz-rl-mem' }, svg);
      V.svg('rect', { x: r1(xs(ridge)), y: py0, width: r1(px1 - xs(ridge)), height: r1(py1 - py0), class: 'viz-rl-comp' }, svg);
      for (let e = Math.ceil(X0); e <= Math.floor(X1); e++) { V.svg('path', { d: 'M' + r1(xs(Math.pow(10, e))) + ' ' + py0 + 'V' + py1, class: 'viz-rl-grid' }, svg); t(svg, xs(Math.pow(10, e)), py1 + 14, e < 0 ? '0.1' : fmt.int(Math.pow(10, e)), 'viz-s', 'middle'); }
      for (let e = Math.ceil(Y0); e <= Math.floor(Y1); e++) { V.svg('path', { d: 'M' + px0 + ' ' + r1(ys(Math.pow(10, e))) + 'H' + px1, class: 'viz-rl-grid' }, svg); t(svg, px0 - 5, ys(Math.pow(10, e)) + 4, fmt.int(Math.pow(10, e - 12)), 'viz-s', 'end'); }
      V.svg('rect', { x: px0, y: py0, width: px1 - px0, height: py1 - py0, class: 'viz-rl-box' }, svg);
      t(svg, (px0 + px1) / 2, py1 + 30, narrow ? 'I (FLOPs por byte de HBM)' : 'intensidad aritmética I (FLOPs por byte leído de la HBM)', 'viz-s', 'middle');
      const yl = V.svg('text', { class: 'viz-s', transform: 'translate(' + (narrow ? 11 : 14) + ',' + r1((py0 + py1) / 2) + ') rotate(-90)', 'text-anchor': 'middle' }, svg); yl.textContent = 'TFLOPS';
      // techo
      const xa = Math.max(Math.pow(10, X0), Math.pow(10, Y0) / G.bw), F0 = G.bw * xa;
      V.svg('path', { d: 'M' + r1(xs(xa)) + ' ' + r1(ys(F0)) + 'L' + r1(xs(ridge)) + ' ' + r1(ys(peak)) + 'L' + r1(px1) + ' ' + r1(ys(peak)), class: 'viz-rl-roof' }, svg);
      V.svg('path', { d: 'M' + r1(xs(ridge)) + ' ' + r1(ys(peak)) + 'V' + py1, class: 'viz-rl-ridge' }, svg);
      t(svg, xs(ridge) + 5, py1 - 8, 'codo ≈ ' + Math.round(ridge), 'viz-n');
      t(svg, px0 + 6, py0 + 14, 'limitado por memoria', 'viz-rl-zone');
      t(svg, px1 - 6, py0 + 14, 'limitado por cómputo', 'viz-rl-zone', 'end');
      t(svg, px1 - 6, ys(peak) - 6, 'pico ' + G.tflops + ' TFLOPS', 'viz-s', 'end');
      // puntos del calculador
      if (c.ok) {
        const dot = (I, cls, lab, anchor, dy) => {
          const F = Math.min(peak, G.bw * I);
          const g = V.svg('g', { class: 'viz-rl-pt ' + cls }, svg);
          V.svg('circle', { cx: r1(xs(I)), cy: r1(ys(F)), r: 6 }, g);
          t(g, xs(I) + (anchor === 'end' ? -10 : anchor === 'middle' ? 0 : 10), ys(F) + dy, lab, 'viz-rl-lab', anchor);
          return F;
        };
        c.Fp = dot(c.Ip, 'is-prefill', 'prefill (T = ' + fmt.int(state.T) + ')', c.Ip > Math.pow(10, X1 - 0.6) ? 'end' : 'middle', 24);
        c.Fd = dot(c.Id, 'is-decode', 'decode (B = ' + state.B + ')', 'start', -10);
      } else t(svg, (px0 + px1) / 2, (py0 + py1) / 2, 'el calculador no da las intensidades (' + cfgId + ')', 'viz-s', 'middle');
      readout(c, G, ridge);
      note.innerHTML = 'Del calculador (' + label + '): FLOPs y bytes del prefill de T tokens (B = 1) y de un paso de decode con lote B y ' + fmt.int(state.ctx) + ' tokens de contexto por secuencia (pesos leídos una vez por paso + la KV cache de cada secuencia), con el pico y el ancho de banda de la GPU elegida. ' +
        'De la GPU, la hoja de datos — ' + G.src + '. El modelo roofline ignora cachés, solapes y eficiencia real de los kernels: es una cota. ' +
        'Prefill: cada peso leído se usa en T tokens → I crece con T y pasa el codo (compute-bound). Decode: un token por secuencia, cada peso se usa B veces → I ≈ B (a 16 bits; la KV cache, que no se comparte, la baja), muy a la izquierda (memory-bound): por eso se sube el lote (continuous batching) y se cuantizan los pesos (menos bytes por paso).';
    }

    const fI = (v) => (v >= 1000 ? fmt.int(Math.round(v)) : String(+v.toPrecision(3)));
    function readout(c, G, ridge) {
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      if (!c.ok) { kv('', 'sin datos del calculador'); return; }
      kv('I prefill ≈', fI(c.Ip) + ' FLOPs/B → ' + (c.Ip >= ridge ? 'cómputo' : 'memoria'));
      kv('I decode ≈', fI(c.Id) + ' FLOPs/B → ' + (c.Id >= ridge ? 'cómputo' : 'memoria'));
      kv('codo =', Math.round(ridge) + ' FLOPs/B');
      if (Number.isFinite(c.Fd)) kv('decode usa ≈', (100 * c.Fd / (G.tflops * 1e12)).toPrecision(2) + ' % del pico');
      if (Number.isFinite(c.tok)) kv('cota decode ≈', fmt.int(Math.round(c.tok)) + ' tokens/s' + (state.B > 1 && Number.isFinite(c.perSeq) ? ' (' + fmt.int(Math.round(c.perSeq)) + ' por secuencia)' : ''));
      if (Number.isFinite(c.stepB)) kv('bytes por paso:', fmt.bytes(c.stepB));
      if (Number.isFinite(c.wB)) kv('pesos:', fmt.bytes(c.wB));
      if (Number.isFinite(c.kvB)) kv('KV leída:', fmt.bytes(c.kvB));
    }
    function ariaOf(c, G, ridge) {
      if (!c.ok) return 'Roofline de ' + G.label + ' sin datos del calculador.';
      return 'Roofline de ' + G.label + ': codo en ' + Math.round(ridge) + ' FLOPs por byte. Prefill con T = ' + state.T + ' tokens, intensidad ' + (+c.Ip.toPrecision(3)) + ' (' + (c.Ip >= ridge ? 'limitado por cómputo' : 'limitado por memoria') + '). Decode con lote ' + state.B + ', intensidad ' + (+c.Id.toPrecision(3)) + ' (' + (c.Id >= ridge ? 'limitado por cómputo' : 'limitado por memoria') + ').';
    }

    stage.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') { ev.preventDefault(); sT.mv(ev.key === 'ArrowRight' ? 1 : -1); }
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); sB.mv(ev.key === 'ArrowUp' ? 1 : -1); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('roofline', render);
})(typeof window !== 'undefined' ? window : globalThis);
