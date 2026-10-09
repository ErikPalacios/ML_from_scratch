/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/encdec-cost.js
   Visualización "encdec-cost" (SPEC §7.8, §24.4): la asimetría de costo de un encoder-decoder (T5, Whisper).
   Costo ACUMULADO de generar t tokens (eje x: 0 … T_out máx.): el encoder y las K, V de la cross-attention son un escalón al
   inicio (una vez por entrada); cada token suma un paso del decoder (que crece un poco con t: la self-attention mira t filas).
   Línea punteada: lo que costaría SIN guardar las K, V de la cross-attention (recalcularlas en cada token). Arriba, la barra del
   punto elegido (encoder · K, V cruzadas · decoder) en MACs o en tiempo ≈ (cota de roofline en una H100).
   TODOS los números salen del calculador: ATLAS.Arch.metrics(config, {Tout, Tin | seconds}) en cada punto de la curva
   (totalGenerationMacs, encoderMacs, crossKvMacs, generationDecoderMacs, encoderMs, crossKvMs, decoderMs, encoderVsToken,
   paddingShare, wastedEncoderMacs). Lo único derivado aquí: la curva sin caché = total + crossKvMacs · (t − 1), y el cruce
   decoder = encoder (el primer t con generationDecoderMacs ≥ encoderMacs, por búsqueda binaria en el calculador).
   params: { model:'t5'|'whisper' | config:'<id>', Tout, Tin (T5), seconds (Whisper), unit:'macs'|'ms' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const MODELS = {
    t5: { title: 'T5', cfgs: ['t5-small', 't5-base', 't5-large', 'flan-t5-base'], def: 't5-base', Tout: [16, 64, 114, 256, 512], Tin: [64, 128, 512, 1024, 2048] },
    whisper: { title: 'Whisper', cfgs: ['whisper-tiny', 'whisper-base', 'whisper-small', 'whisper-medium', 'whisper-large-v3', 'distil-whisper-large-v3'], def: 'whisper-small', Tout: [16, 64, 128, 256, 448], seconds: [5, 10, 20, 30] },
  };

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), ops: (n) => n + ' MACs' };
    const ops = (n) => (fmt.ops ? fmt.ops(n) : n + ' MACs');
    const ms = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' ms';
    const has = (id) => { try { return !!(A && A.hasConfig && A.hasConfig(id)); } catch (e) { return false; } };
    // config pedida: params.config (un id) o params.model ('t5' | 'whisper' | un id de config)
    const want = params.config || params.model || 't5';
    let model = MODELS[want] ? want : /whisper/.test(want) ? 'whisper' : 't5';
    const state = {
      model,
      cfg: !MODELS[want] && has(want) ? want : MODELS[model].def,
      Tout: +params.Tout > 0 ? +params.Tout : null,
      Tin: +params.Tin > 0 ? +params.Tin : null,
      seconds: +params.seconds > 0 ? +params.seconds : 30,
      unit: params.unit === 'ms' ? 'ms' : 'macs',
      nocache: !!params.nocache,
    };
    const cfgOf = (id) => { try { return A.run(id).config; } catch (e) { return null; } };
    const tmax = () => { const c = cfgOf(state.cfg); return c && c.Tmax ? c.Tmax : 512; };
    function ov(st, t) {
      const o = { Tout: Math.max(1, Math.min(t, tmax())) };
      if (st.model === 't5' && st.Tin) o.Tin = st.Tin;
      if (st.model === 'whisper') o.seconds = st.seconds;
      return o;
    }
    const met = (st, t) => { try { return A.metrics(st.cfg, ov(st, t)); } catch (e) { return null; } };

    const wrap = V.html('div', { class: 'viz viz-edc' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const gM = grp('Modelo');
    const mBtns = Object.keys(MODELS).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: MODELS[k].title }, gM); b.addEventListener('click', () => { state.model = k; state.cfg = MODELS[k].def; state.Tout = null; state.Tin = null; build(); draw(); }); b._k = k; return b; });
    const gC = grp('Config');
    const gT = grp('T_out');
    const gI = grp('T_in');
    const gS = grp('Audio');
    const gU = grp('Unidad');
    const uBtns = [['macs', 'MACs'], ['ms', 'tiempo ≈']].map(([k, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, gU); b.addEventListener('click', () => { state.unit = k; draw(); }); b._k = k; return b; });
    const gN = grp('Comparar');
    const bNc = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'sin guardar K, V cruzadas' }, gN);
    bNc.addEventListener('click', () => { state.nocache = !state.nocache; draw(); });
    const stage = V.html('div', { class: 'viz-stage viz-edc-stage', tabindex: 0, role: 'group', 'aria-label': 'Costo acumulado de generar. Flechas izquierda y derecha: T_out; U: MACs o tiempo' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);
    let chips = [];
    function build() {
      [gC, gT, gI, gS].forEach((g) => { while (g.children.length > 1) g.removeChild(g.lastChild); });
      const M = MODELS[state.model];
      const label = (id) => { try { return (A.configs().find((c) => c.id === id) || {}).label || id; } catch (e) { return id; } };
      chips = [];
      const add = (g, vals, key, lab) => vals.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: lab(v) }, g); b.addEventListener('click', () => { state[key] = v; if (key === 'cfg') { state.Tout = Math.min(state.Tout || 1e9, tmax()); } draw(); }); b._k = key; b._v = v; chips.push(b); });
      add(gC, M.cfgs.filter(has), 'cfg', (v) => label(v).replace(/^Whisper /, '').replace(/^T5-/, 'T5 '));
      add(gT, M.Tout, 'Tout', String);
      if (M.Tin) add(gI, M.Tin, 'Tin', String);
      if (M.seconds) add(gS, M.seconds, 'seconds', (v) => v + ' s');
      gI.hidden = !M.Tin; gS.hidden = !M.seconds;
    }

    let lastNarrow = null;
    function draw() {
      const M = MODELS[state.model], c = cfgOf(state.cfg);
      if (!state.Tout) state.Tout = c && c.Tout ? c.Tout : M.Tout[2];
      if (!state.Tin && state.model === 't5') state.Tin = c && c.Tin ? c.Tin : 512;
      state.Tout = Math.min(state.Tout, tmax());
      mBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.model)));
      uBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.unit)));
      bNc.setAttribute('aria-pressed', String(state.nocache)); gN.hidden = state.unit === 'ms';
      chips.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      const m = met(state, state.Tout);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); if (V.rich) V.rich(e, s); else e.textContent = s; return e; };
      if (!m) { t(svg, 8, 20, 'El calculador no tiene esta combinación.', 'viz-t'); svg.setAttribute('viewBox', '0 0 ' + W + ' 30'); out.innerHTML = ''; return; }
      const isMs = state.unit === 'ms', fv = isMs ? ms : ops;
      const enc = isMs ? m.encoderMs : m.encoderMacs, ckv = isMs ? m.crossKvMs : m.crossKvMacs, dec = isMs ? m.decoderMs : m.generationDecoderMacs;
      const tot = enc + ckv + dec;
      const head = (A.configs().find((x) => x.id === state.cfg) || {}).label || state.cfg;
      t(svg, 8, 15, (narrow ? head : 'Generar con ' + head) + ': T_out = ' + state.Tout + (state.model === 't5' ? ', T_in = ' + state.Tin : ', ' + state.seconds + ' s de audio'), 'viz-t');
      t(svg, 8, 31, isMs ? (narrow ? 'tiempo ≈ (cota, H100)' : 'tiempo ≈: cota de roofline del calculador en una H100, sin overheads (no es una medición)') : (narrow ? 'MACs (del calculador)' : 'MACs del calculador: el encoder una vez, el decoder una vez por token'), 'viz-s');
      // ---- barra del punto elegido
      const lx = 8, bw = W - 16, barH = 20;
      let y = 42;
      const nFwd = Number.isFinite(m.decoderForwards) ? m.decoderForwards : state.Tout;
      const parts = [
        { v: enc, label: state.model === 'whisper' ? 'encoder + front end (× 1)' : 'encoder (× 1)', short: 'encoder × 1', cls: 'is-enc' },
        { v: ckv, label: 'K, V de la cross (× 1)', short: 'K, V cruzadas × 1', cls: 'is-ckv' },
        // revisión fase 12: pasos del decoder del calculador (Whisper: el prompt de 4 tokens en un forward → T_out − 3 pasos)
        { v: dec, label: 'decoder (× ' + nFwd + ' pasos)', short: 'decoder × ' + nFwd, cls: 'is-dec' },
      ];
      let x = lx;
      parts.forEach((p) => { const w = tot > 0 ? bw * p.v / tot : 0; if (w > 0) V.svg('rect', { x: r1(x), y, width: r1(Math.max(w, 1)), height: barH, class: 'viz-edc-seg ' + p.cls }, svg); x += w; });
      y += barH + 4;
      const pct = (v) => { const f = tot > 0 ? 100 * v / tot : 0; return f > 0 && f < 1 ? '<1 %' : Math.round(f) + ' %'; };
      let lx2 = lx;
      parts.forEach((p) => {
        const s = (narrow ? p.short : p.label) + ': ' + fv(p.v) + ' · ' + pct(p.v);
        if (narrow) { y += 14; V.svg('rect', { x: lx, y: r1(y - 9), width: 9, height: 9, class: 'viz-edc-seg ' + p.cls }, svg); t(svg, lx + 13, y, s, 'viz-s'); }
        else {
          // revisión fase 12: la fila envuelve si no cabe (Whisper: "decoder (× 128 tokens): … · 10 %" se cortaba en x = 919)
          const sw = 13 + s.length * 6.6;
          if (lx2 > lx && lx2 + sw > W - 8) { lx2 = lx; y += 16; }
          V.svg('rect', { x: r1(lx2), y: r1(y + 4), width: 9, height: 9, class: 'viz-edc-seg ' + p.cls }, svg); t(svg, lx2 + 13, y + 13, s, 'viz-s'); lx2 += sw + 16;
        }
      });
      y += narrow ? 26 : 38;
      // ---- curva: costo acumulado al generar t tokens (t = 0 … máx.), con y sin la caché de K, V cruzadas
      const tMax = Math.min(tmax(), Math.max.apply(null, M.Tout));
      const N = 24, pts = [];
      for (let i = 0; i <= N; i++) {
        const tt = Math.round(tMax * i / N);
        if (tt === 0) { const m1 = met(state, 1); if (m1) pts.push({ t: 0, v: (isMs ? m1.encoderMs + m1.crossKvMs : m1.encoderMacs + m1.crossKvMacs), nc: null }); continue; }
        const mm = met(state, tt);
        if (!mm) continue;
        const v = isMs ? mm.encoderMs + mm.crossKvMs + mm.decoderMs : mm.totalGenerationMacs;
        // sin caché cruzada: las K, V de la cross se recalculan en cada token (solo en MACs: el tiempo dependería de cómo se lance)
        pts.push({ t: tt, v, nc: isMs || !state.nocache ? null : v + mm.crossKvMacs * (tt - 1) });
      }
      // revisión fase 12: marcas del eje y compactas (3 cifras: "283 G", "4.02 T"; la unidad va en el título del gráfico): con
      // fmt.si ("283.28 G") la etiqueta empezaba en x = −4 a ≤ 640 px
      const ch = narrow ? 150 : 190, cx0 = lx + (narrow ? 44 : 52), cwid = W - cx0 - 16, cy0 = y + 14;
      const tick = (v) => {
        if (isMs) return ms(v);
        const u = [[1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'K']].find((x) => v >= x[0]);
        return u ? String(Number((v / u[0]).toPrecision(3))) + ' ' + u[1] : String(Math.round(v));
      };
      const vmax = Math.max.apply(null, pts.map((p) => Math.max(p.v, p.nc || 0))) * 1.05 || 1;
      const X = (tt) => cx0 + cwid * tt / tMax, Y = (v) => cy0 + ch - ch * v / vmax;
      t(svg, lx, y + 2, (narrow ? 'acumulado' : 'costo acumulado') + (isMs ? ' (ms)' : ' (MACs)') + ' al generar t tokens' + (narrow ? '' : ' (el escalón en t = 0: encoder + K, V cruzadas)'), 'viz-s');
      V.svg('rect', { x: r1(cx0), y: r1(cy0), width: r1(cwid), height: ch, class: 'viz-rl-box' }, svg);
      [0, 0.5, 1].forEach((f) => { const yy = cy0 + ch - ch * f; t(svg, cx0 - 5, yy + 4, f === 0 ? '0' : tick(vmax * f), 'viz-s', 'end'); if (f > 0 && f < 1) V.svg('path', { d: 'M' + r1(cx0) + ' ' + r1(yy) + 'H' + r1(cx0 + cwid), class: 'viz-rl-grid' }, svg); });
      // franja del encoder (fija)
      const e0 = pts[0] ? pts[0].v : 0;
      V.svg('rect', { x: r1(cx0), y: r1(Y(e0)), width: r1(cwid), height: r1(cy0 + ch - Y(e0)), class: 'viz-edc-band' }, svg);
      // revisión fase 12: con "sin guardar" la escala sube a T y la franja queda de pocos px: su rótulo caía sobre el punto elegido.
      // Si la franja no le da lugar (< 18 px), el rótulo va a la leyenda de abajo
      const bandLab = narrow ? 'encoder + K, V (× 1)' : 'encoder + K, V cruzadas: se pagan una vez';
      const bandIn = cy0 + ch - Y(e0) >= 18;
      if (bandIn) t(svg, cx0 + 6, Math.min(cy0 + ch - 6, Y(e0) + 14), bandLab, 'viz-edc-bandt');
      const ln = pts.map((p, i) => (i ? 'L' : 'M') + r1(X(p.t)) + ' ' + r1(Y(p.v))).join('');
      V.svg('path', { d: 'M' + r1(X(0)) + ' ' + r1(cy0 + ch) + 'L' + r1(X(0)) + ' ' + r1(Y(e0)) + ln.replace(/^M/, 'L'), class: 'viz-edc-line' }, svg);
      const nc = pts.filter((p) => p.nc != null);
      if (nc.length > 1) V.svg('path', { d: nc.map((p, i) => (i ? 'L' : 'M') + r1(X(p.t)) + ' ' + r1(Y(p.nc))).join(''), class: 'viz-edc-nc' }, svg);
      // eje x y punto elegido
      // etiquetas del eje x: los valores del knob que no se pisan (≥ 26 px entre sí)
      // revisión fase 12: el valor elegido siempre; los demás solo si quedan a ≥ 26 px de todos los ya puestos ("0" y "16" se pisaban a 340 px)
      const xv = [0].concat(M.Tout.filter((v) => v <= tMax)), kept = [state.Tout];
      xv.forEach((v) => { if (v !== state.Tout && kept.every((k) => Math.abs(X(k) - X(v)) >= 26)) kept.push(v); });
      xv.filter((v) => kept.indexOf(v) >= 0).forEach((v) => t(svg, X(v), cy0 + ch + 14, String(v), v === state.Tout ? 'viz-n' : 'viz-s', 'middle'));
      t(svg, cx0 + cwid, cy0 + ch + 30, 'tokens generados t', 'viz-s', 'end');
      const cur = { t: state.Tout, v: tot };
      V.svg('circle', { cx: r1(X(cur.t)), cy: r1(Y(cur.v)), r: 5, class: 'viz-edc-pt' }, svg);
      // dónde el decoder alcanza al encoder (en MACs)
      // revisión fase 12: el primer t en que el decoder acumulado (generationDecoderMacs) alcanza al encoder, buscado en el
      // calculador (antes, encoderVsToken del T_out elegido: se movía con el chip, 339–362 para un cruce real de 355 en T5-Base)
      let cross = NaN;
      if (!isMs) {
        const m1 = met(state, tMax);
        if (m1 && m1.generationDecoderMacs >= m1.encoderMacs) {
          let lo = 1, hi = tMax;
          while (lo < hi) { const mid = (lo + hi) >> 1, mm = met(state, mid); if (mm && mm.generationDecoderMacs >= mm.encoderMacs) hi = mid; else lo = mid + 1; }
          cross = lo;
        }
      }
      if (!isMs && Number.isFinite(cross) && cross <= tMax) {
        V.svg('path', { d: 'M' + r1(X(cross)) + ' ' + r1(cy0) + 'V' + r1(cy0 + ch), class: 'viz-edc-x' }, svg);
        t(svg, X(cross) - 4, cy0 + 12, narrow ? 't = ' + cross : 'decoder ≥ encoder desde t = ' + cross, 'viz-s', 'end');
      }
      y = cy0 + ch + 50;
      // leyenda de líneas
      let lg = lx;
      [['viz-edc-line', 'con las K, V cruzadas guardadas'], ...(isMs || !state.nocache ? [] : [['viz-edc-nc', 'recalculándolas en cada token']]), ...(bandIn ? [] : [['viz-edc-band', bandLab]])].forEach(([cls, lab]) => {
        if (!narrow && lg > lx && lg + 24 + lab.length * 6.4 > W - 8) { lg = lx; y += 15; }
        if (cls === 'viz-edc-band') V.svg('rect', { x: r1(lg), y: r1(y - 9), width: 18, height: 10, class: cls }, svg);
        else V.svg('path', { d: 'M' + r1(lg) + ' ' + r1(y - 4) + 'h18', class: cls }, svg);
        t(svg, lg + 24, y, lab, 'viz-s');
        lg += 24 + lab.length * 6.4 + 18;
        if (narrow) { lg = lx; y += 15; }
      });
      y += 8;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      svg.setAttribute('aria-label', head + ', T_out = ' + state.Tout + ': encoder ' + fv(enc) + ', K y V de la cross ' + fv(ckv) + ', decoder ' + fv(dec) + '.');
      // ---- lectura
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('total:', fv(tot));
      kv('encoder:', pct(enc));
      kv('por token:', ops(m.decoderMacsPerToken));
      kv('encoder ÷ token:', '≈ ' + Math.round(m.encoderVsToken) + '×');
      if (state.model === 'whisper' && Number.isFinite(m.paddingShare)) kv('relleno en el encoder:', Math.round(100 * m.paddingShare) + ' %');
      if (fmt.bytes && Number.isFinite(m.crossKvBytes)) kv('K, V cruzadas guardadas:', fmt.bytes(m.crossKvBytes));
      note.innerHTML = (state.model === 't5'
        ? 'Con T_in fijo, el encoder es un costo fijo por entrada y el decoder crece con cada token. En tareas de entrada larga y salida corta (resumir, clasificar, extraer) domina el encoder en MACs; en generación larga, el decoder. '
        : 'El encoder de Whisper procesa SIEMPRE una ventana de 30 s (' + (Number.isFinite(m.paddingShare) && m.paddingShare > 0 ? 'con ' + state.seconds + ' s de audio, el ' + Math.round(100 * m.paddingShare) + ' % de su trabajo es relleno' : 'sin relleno con 30 s de audio') + '): es caro pero fijo. ') +
        'En tiempo cambia la foto: cada paso del decoder procesa un token y lee todos sus pesos (limitado por memoria), así que el decoder se lleva casi todo el tiempo aunque no los MACs. Con "sin guardar K, V cruzadas" (en MACs), la línea punteada muestra qué pasaría si cada token recalculara las K y V de la cross-attention sobre las T_in posiciones: por eso se guardan.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, L = MODELS[state.model].Tout.filter((v) => v <= tmax());
      if (k === 'ArrowRight' || k === 'ArrowLeft') {
        ev.preventDefault();
        const i = L.indexOf(state.Tout), j = Math.max(0, Math.min(L.length - 1, (i < 0 ? 0 : i) + (k === 'ArrowRight' ? 1 : -1)));
        state.Tout = L[j]; draw();
      } else if (k === 'u' || k === 'U') { ev.preventDefault(); state.unit = state.unit === 'ms' ? 'macs' : 'ms'; draw(); }
    });
    build();
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('encdec-cost', render);
})(typeof window !== 'undefined' ? window : globalThis);
