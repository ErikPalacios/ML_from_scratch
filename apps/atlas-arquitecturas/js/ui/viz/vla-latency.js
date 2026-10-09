/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/vla-latency.js
   Visualización "vla-latency" (SPEC §7.8, §21.4): cuánto tarda una inferencia de un VLA y si le alcanza al control del robot.
   Barras apiladas por modelo, en ms, del calculador (ATLAS.Arch.metrics(...).hardware[i].segments, roofline ≈ con hardware
   citado: H100 SXM, RTX 4090, Jetson AGX Orin — el FP16 de Orin es DERIVADO, rotulado ≈):
   - OpenVLA 7B, UNA acción: visión + proyector · prefill de Llama 2 · 6 pasos de decode (limitados por memoria);
   - π0, UN chunk de H_a acciones: encoders de imagen · prefijo (Gemma) · pasos de flow (knob: pasos);
   y, con la RTX 4090, lo MEDIDO en los papers (OpenVLA ≈ 6 Hz; π0: 14 + 32 + 27 = 73 ms, Tabla I), que la cota no incluye
   (kernels, Python, comunicación). Abajo, "¿llega?": el presupuesto de tiempo por inferencia según la frecuencia de control
   (OpenVLA: 1 acción por inferencia → 1/f; π0: ejecuta k acciones del chunk → k/f, las del paper: 25 a 50 Hz, 16 a 20 Hz).
   RT-2 no tiene barra (pesos cerrados): su fila dice lo que reporta el paper (1–3 Hz con 55B en TPUs en la nube).
   params: { hw:'rtx4090'|'h100'|'orin', steps:10 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const HWS = ['rtx4090', 'h100', 'orin'];
  const STEPS = [1, 5, 10, 20];
  const ms = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ms';
  const hz = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const state = { hw: HWS.indexOf(params.hw) >= 0 ? params.hw : 'rtx4090', steps: STEPS.indexOf(+params.steps) >= 0 ? +params.steps : 10 };
    const met = (cfg, ov) => { try { return A.metrics(cfg, ov); } catch (e) { return null; } };
    const hwOf = (m) => (m && Array.isArray(m.hardware) ? m.hardware.find((h) => h.id === state.hw) : null);

    const wrap = V.html('div', { class: 'viz viz-vl' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const all = [];
    const chips = (g, vals, key, label) => vals.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._k = key; b._v = v; all.push(b); });
    const m0 = met('openvla-7b');
    const hwLabel = (id) => { const h = m0 && (m0.hardware || []).find((x) => x.id === id); return h ? h.label.replace('Jetson AGX Orin 64GB', 'Jetson Orin') : id; };
    chips(grp('Hardware'), HWS, 'hw', (id) => hwLabel(id) + (id === 'orin' ? ' (≈)' : ''));
    chips(grp('Pasos de flow (π0)'), STEPS, 'steps', (v) => String(v));
    const stage = V.html('div', { class: 'viz-stage viz-vl-stage', tabindex: 0, role: 'group', 'aria-label': 'Latencia de los VLA. Flechas izquierda y derecha: hardware; arriba y abajo: pasos de flow de π0' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      const mo = met('openvla-7b'), mp = met('pi0', { steps: state.steps });
      const ho = hwOf(mo), hp = hwOf(mp);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(280, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      if (!ho || !hp) { t(svg, 8, 20, 'El calculador no tiene estos modelos.', 'viz-t'); svg.setAttribute('viewBox', '0 0 ' + W + ' 30'); out.textContent = ''; return; }
      const is4090 = state.hw === 'rtx4090';
      const pl = mp.paperLatency || null;
      t(svg, 8, 15, (narrow ? 'Latencia ≈ en ' : 'Latencia por inferencia (≈ roofline del calculador) en ') + hwLabel(state.hw), 'viz-t');
      t(svg, 8, 29, narrow ? 'cota: sin overheads de kernels ni Python' : 'cota optimista: máx(FLOPs / pico, bytes / ancho de banda) por tramo, sin overheads', 'viz-s');
      // eje común en ms
      const paperOv = mo.paperHz ? 1000 / mo.paperHz : null;
      const maxMs = Math.max(ho.actionMs, hp.chunkMs, is4090 ? Math.max(paperOv || 0, (pl && pl.onboardMs) || 0) : 0) * 1.08;
      const lx = 8, bx = narrow ? 8 : 200, bw = W - bx - (narrow ? 8 : 160), bh = 18;
      const X = (v) => bx + bw * v / maxMs;
      let y = 46;
      const cls = { vision: 'is-vis', prefill: 'is-pre', prefix: 'is-pre', decode: 'is-loop', flow: 'is-loop' };
      const row = (title, sub, segs, total, right, paper) => {
        if (narrow) { t(svg, lx, y, title, 'viz-n'); t(svg, W - 8, y, right, 'viz-n', 'end'); y += 6; }
        else { t(svg, lx, y + 12, title, 'viz-n'); t(svg, lx, y + 25, sub, 'viz-s'); }
        let x = X(0);
        segs.forEach((sg) => { const w = bw * sg.ms / maxMs; V.svg('rect', { x: r1(x), y: r1(y), width: r1(Math.max(w, 0.8)), height: bh, class: 'viz-vl-seg ' + (cls[sg.id] || 'is-pre') }, svg); x += w; });
        V.svg('rect', { x: r1(X(0)), y: r1(y), width: r1(X(total) - X(0)), height: bh, class: 'viz-vl-frame' }, svg);
        if (!narrow) t(svg, X(total) + 6, y + 13, right, 'viz-n');
        y += bh + 4;
        // leyenda de los tramos de esta fila
        let sx = narrow ? lx : bx;
        segs.forEach((sg) => {
          const s = sg.label + ' ' + ms(sg.ms);
          if (narrow) { y += 13; V.svg('rect', { x: lx, y: r1(y - 8.5), width: 9, height: 9, class: 'viz-vl-seg ' + (cls[sg.id] || 'is-pre') }, svg); t(svg, lx + 13, y, s, 'viz-s'); }
          else { V.svg('rect', { x: r1(sx), y: r1(y + 3), width: 9, height: 9, class: 'viz-vl-seg ' + (cls[sg.id] || 'is-pre') }, svg); t(svg, sx + 13, y + 11.5, s, 'viz-s'); sx += 13 + s.length * 6.6 + 14; }
        });
        y += narrow ? 6 : 18;
        if (paper) {
          // lo medido en el paper (misma GPU): barra fina con sus tramos, o una marca si solo hay un total
          y += 4;
          if (paper.segs) {
            let px = X(0);
            paper.segs.forEach((sg) => { const w = bw * sg.ms / maxMs; V.svg('rect', { x: r1(px), y: r1(y), width: r1(w), height: 8, class: 'viz-vl-paper ' + (cls[sg.id] || 'is-pre') }, svg); px += w; });
          } else V.svg('rect', { x: r1(X(0)), y: r1(y), width: r1(X(paper.total) - X(0)), height: 8, class: 'viz-vl-paper is-pre' }, svg);
          V.svg('rect', { x: r1(X(0)), y: r1(y), width: r1(X(paper.total) - X(0)), height: 8, class: 'viz-vl-frame' }, svg);
          t(svg, narrow ? lx : X(0), y + 20, paper.label, 'viz-vl-ptxt');
          y += 30;
        }
        y += 10;
      };
      // eje
      const ticks = [];
      const stepT = maxMs > 300 ? 100 : maxMs > 120 ? 50 : maxMs > 40 ? 20 : maxMs > 15 ? 5 : maxMs > 4 ? 1 : 0.5;
      for (let v = 0; v <= maxMs; v += stepT) ticks.push(v);
      const axisY0 = y - 6;
      row('OpenVLA 7B', '1 acción (7 tokens)', ho.segments, ho.actionMs, ms(ho.actionMs) + ' → ' + hz(ho.hz) + ' acciones/s',
        is4090 && paperOv ? { total: paperOv, label: (narrow ? 'paper: ≈ ' : 'medido (paper): ≈ ') + mo.paperHz + ' Hz = ' + Math.round(paperOv) + ' ms' } : null);
      row('π0 (' + mp.cams + ' cámaras)', 'chunk de ' + mp.chunk + ' · ' + state.steps + (state.steps === 1 ? ' paso' : ' pasos'), hp.segments.map((s) => (s.id === 'flow' ? Object.assign({}, s, { label: state.steps + (state.steps === 1 ? ' paso' : ' pasos') + ' de flow' }) : s)), hp.chunkMs, ms(hp.chunkMs) + ' → ' + hz(hp.chunkHz) + ' chunks/s',
        is4090 && pl && state.steps === 10 ? { total: pl.onboardMs, segs: [{ id: 'vision', ms: pl.imageMs }, { id: 'prefix', ms: pl.prefixMs }, { id: 'flow', ms: pl.flowMs }], label: (narrow ? 'paper: ' : 'medido (paper, Tabla I): ') + pl.imageMs + ' + ' + pl.prefixMs + ' + ' + pl.flowMs + ' = ' + pl.onboardMs + ' ms' } : null);
      // rejilla del eje (detrás no hace falta: líneas finas al final, con sus números abajo)
      let dg = '';
      ticks.forEach((v) => { dg += 'M' + r1(X(v)) + ' ' + r1(axisY0) + 'V' + r1(y - 8); });
      const grid = V.svg('path', { d: dg, class: 'viz-rl-grid' });
      svg.insertBefore(grid, svg.firstChild);
      ticks.forEach((v, i) => { if (!narrow || i % 2 === 0) t(svg, X(v), y + 2, String(v >= 1 ? Math.round(v) : v), 'viz-s', 'middle'); });
      t(svg, X(maxMs), y + 2, 'ms', 'viz-s', 'end');
      y += 16;
      // RT-2: sin barra
      t(svg, lx, y + 6, narrow ? 'RT-2 55B: pesos cerrados; el paper' : 'RT-2 55B: pesos cerrados, sin barra; el paper reporta 1–3 Hz en TPUs en la nube (≈ 5 Hz con 5B)', 'viz-s');
      if (narrow) { y += 13; t(svg, lx, y + 6, 'reporta 1–3 Hz en TPUs en la nube', 'viz-s'); }
      y += 26;
      // ¿llega a tiempo?
      t(svg, lx, y, '¿Llega a tiempo para el control?', 'viz-t');
      y += 8;
      const budgets = [];
      (mp.chunkRates || []).forEach((cr) => budgets.push({ f: cr.controlHz, k: cr.executed }));
      const cols = narrow ? [lx, lx + 70, lx + 175] : [lx, lx + 150, lx + 470];
      t(svg, cols[0], y + 12, 'control', 'viz-s'); t(svg, cols[1], y + 12, narrow ? 'OpenVLA (1/f)' : 'OpenVLA: 1 acción por inferencia (1/f)', 'viz-s'); t(svg, cols[2], y + 12, narrow ? 'π0 (k/f)' : 'π0: ejecuta k del chunk (k/f, del paper)', 'viz-s');
      y += 16;
      budgets.forEach((b) => {
        const bo = 1000 / b.f, bp = 1000 * b.k / b.f;
        const okO = ho.actionMs <= bo, okP = hp.chunkMs <= bp;
        y += 16;
        t(svg, cols[0], y, b.f + ' Hz', 'viz-n');
        t(svg, cols[1], y, (narrow ? '' : 'presupuesto ') + ms(bo) + (okO ? ' ✓' : ' ✗'), okO ? 'viz-vl-ok' : 'viz-vl-no');
        t(svg, cols[2], y, 'k = ' + b.k + ': ' + ms(bp) + (okP ? ' ✓' : ' ✗'), okP ? 'viz-vl-ok' : 'viz-vl-no');
      });
      y += 14;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      svg.setAttribute('aria-label', 'En ' + hwLabel(state.hw) + ': OpenVLA ' + ms(ho.actionMs) + ' por acción; π0 ' + ms(hp.chunkMs) + ' por chunk de ' + mp.chunk + ' acciones con ' + state.steps + ' pasos (estimaciones de roofline).');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('OpenVLA:', ms(ho.actionMs) + ' por acción (' + hz(ho.hz) + ' Hz)');
      kv('π0:', ms(hp.chunkMs) + ' por chunk (' + mp.chunk + ' acciones)');
      kv('π0, ' + state.steps + ' pasos de flow:', ms(hp.flowMs));
      const h = (mo.hardware || []).find((x) => x.id === state.hw);
      // lo que lee CADA decode: los pesos del LLM sin la tabla de embedding (≈ 13.2 GB), no el checkpoint entero (weightBytes)
      const decB = Number.isFinite(mo.decodeWeightBytesRead) ? mo.decodeWeightBytesRead : (mo.bytesPerElement || 2) * (mo.llmParams - mo.embedParams);
      note.innerHTML = 'Del calculador (≈ roofline, una cota optimista). Hardware: ' + (h ? h.source : '') + '. OpenVLA genera 7 tokens: el prefill + ' + mo.decodeSteps + ' decodes que releen los pesos del LLM (' + ((A.fmt && A.fmt.bytes) ? A.fmt.bytes(decB) : decB + ' B') + ' en bf16, sin la tabla de embedding; la visión no corre en el decode) cada uno (limitados por memoria). π0 calcula el prefijo una vez y repite solo el experto chico en cada paso de flow: más pasos casi no cuestan. Y π0 entrega ' + mp.chunk + ' acciones por inferencia: el robot ejecuta parte del chunk mientras tanto. Lo medido en los papers incluye todo lo que el roofline no ve.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); const i = (HWS.indexOf(state.hw) + (k === 'ArrowRight' ? 1 : HWS.length - 1)) % HWS.length; state.hw = HWS[i]; draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); const i = Math.max(0, Math.min(STEPS.length - 1, STEPS.indexOf(state.steps) + (k === 'ArrowUp' ? 1 : -1))); state.steps = STEPS[i]; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('vla-latency', render);
})(typeof window !== 'undefined' ? window : globalThis);
