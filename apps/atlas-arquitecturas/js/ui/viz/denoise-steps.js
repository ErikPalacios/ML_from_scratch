/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/denoise-steps.js
   Visualización "denoise-steps" (SPEC §7.8, §20.4): cuántos pasos de muestreo hacen falta y cuánto cuestan.
   - Izquierda: un juguete 2-D (datos = 8 gaussianas en un anillo, "ilustrativo"). 48 muestras parten del mismo ruido y se
     muestrean con DDPM (estocástico, η = 1), DDIM (determinista, η = 0) o flujo rectificado (Euler), con N pasos; se ve dónde
     terminan y la trayectoria de una. El "modelo" es el óptimo exacto de la mezcla (forma cerrada): lo único que cambia es
     el muestreador y N, así que lo que se ve es el error de discretizar.
   - Derecha arriba: la fracción de muestras que terminan dentro de un modo (a < 3.3 desvíos de su centro), según N, para los
     tres muestreadores (del juguete).
   - Derecha abajo: el costo REAL por imagen de Stable Diffusion según N (ATLAS.Arch.metrics de la config, knobs steps y
     cfg): N × (2 con CFG) evaluaciones de la U-Net + el encoder de texto + el decoder del VAE.
   Las agendas: ᾱ de la config del calculador (la de SD o la lineal de DiT) para DDPM/DDIM; t uniforme de 1 a 0 para el flujo.
   params: { config:'sd15-unet', sampler:'ddim'|'ddpm'|'flow', steps:50, cfg:1 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const STEPS = [1, 2, 4, 8, 10, 20, 25, 50, 100, 250, 1000];
  const SAMPLERS = {
    ddpm: { label: 'DDPM', long: 'DDPM (estocástico)', cls: 'is-ddpm' },
    ddim: { label: 'DDIM', long: 'DDIM (determinista)', cls: 'is-ddim' },
    flow: { label: 'Flujo', long: 'Flujo rectificado (Euler)', cls: 'is-flow' },
  };
  const NS = 48;           // muestras del juguete
  const S_MODE = 0.12;     // desvío de cada modo
  const IN_MODE = 0.4;     // "dentro de un modo": a menos de 0.4 (≈ 3.3 desvíos) de su centro
  const TOY = { s: S_MODE, modes: Array.from({ length: 8 }, (_, k) => ({ mu: [2 * Math.cos(k * Math.PI / 4), 2 * Math.sin(k * Math.PI / 4)], cls: k % 2 })) };

  function num(m, keys) { for (const k of keys) { const v = m && m[k]; if (Number.isFinite(v)) return v; } return null; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, D = V.diff;
    const cfgId = params.config || 'sd15-unet';
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n) };
    const ops = (n) => (fmt.ops ? fmt.ops(n) : fmt.si(n) + 'MACs');
    const sched = D.scheduleOf(cfgId);
    if (!sched) { const d = V.html('div', { class: 'ad-error', role: 'alert', text: 'La config ' + cfgId + ' del calculador no trae la agenda de ruido (β).' }, el); return { destroy() { d.remove(); } }; }
    let label = cfgId, net = 'U-Net';
    try { const r0 = A.run(cfgId); label = r0.label || cfgId; if (r0.model === 'dit') net = 'DiT'; } catch (e) { /* id */ }
    const state = {
      sampler: SAMPLERS[params.sampler] ? params.sampler : 'ddim',
      si: Math.max(0, STEPS.indexOf(+params.steps || 50)),
      cfg: params.cfg === 0 || params.cfg === '0' ? 0 : 1,
    };
    if (STEPS.indexOf(+params.steps || 50) < 0) state.si = STEPS.indexOf(50);

    // ---- juguete: el mismo ruido inicial para todos; se precalcula todo (3 muestreadores × N pasos)
    const starts = [];
    { const rng = V.rng(8); for (let i = 0; i < NS; i++) starts.push([rng.normal(), rng.normal()]); }
    const PI = starts.reduce((b, z, i) => (Math.hypot(z[0], z[1]) < Math.hypot(starts[b][0], starts[b][1]) ? i : b), 0);
    const cache = {};
    function runToy(sampler, n) {
      const key = sampler + n;
      if (cache[key]) return cache[key];
      const paths = starts.map((z, i) => {
        if (sampler === 'flow') return D.sampleFlow(TOY, z, n);
        return D.sampleVP(TOY, z, sched.abar, D.timesteps(sched.T, n), { eta: sampler === 'ddpm' ? 1 : 0, rng: V.rng(1000 + i) });
      });
      const ends = paths.map((p) => p[p.length - 1]);
      const inMode = ends.filter((p) => D.nearestMode(TOY, p).d < IN_MODE).length / NS;
      return (cache[key] = { paths, ends, inMode });
    }
    function cost(n, cfgOn) {
      let m = null;
      try { m = A.metrics(cfgId, { steps: n, cfg: cfgOn }); } catch (e) { m = null; }
      if (!m) return null;
      const tot = num(m, ['samplingMacs']);
      return tot == null ? null : { tot, unet: num(m, ['unetMacs', 'ditMacs', 'nfeMacs']), text: num(m, ['textEncoderMacs']), vae: num(m, ['vaeDecoderMacs']), nfe: num(m, ['nfe', 'unetEvals']) };
    }

    const wrap = V.html('div', { class: 'viz viz-ds' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Muestreador' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Muestreador' }, g1);
    const sBtns = Object.keys(SAMPLERS).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: SAMPLERS[k].long }, g1); b.addEventListener('click', () => { state.sampler = k; draw(); }); b._k = k; return b; });
    const g2 = V.html('label', { class: 'viz-ctl viz-ds-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Pasos N' }, g2);
    const inp = V.html('input', { type: 'range', min: 0, max: STEPS.length - 1, step: 1, 'aria-label': 'Número de pasos de muestreo' }, g2);
    const outN = V.html('output', { class: 'viz-ns-out' }, g2);
    inp.addEventListener('input', () => { state.si = +inp.value; draw(); });
    const g3 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Guía libre de clasificador' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'CFG' }, g3);
    const cBtns = [[1, 'con CFG (×2)'], [0, 'sin CFG']].map(([v, text]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text }, g3); b.addEventListener('click', () => { state.cfg = v; draw(); }); b._v = v; return b; });
    const stage = V.html('div', { class: 'viz-stage viz-ds-stage', tabindex: 0, role: 'group', 'aria-label': 'Pasos de muestreo: flechas izquierda y derecha cambian N; arriba y abajo, el muestreador' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      sBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.sampler)));
      cBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.cfg)));
      const n = STEPS[state.si];
      inp.value = state.si; outN.textContent = 'N = ' + n;
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(440, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const tx = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); if (V.rich) V.rich(e, s); else e.textContent = s; return e; };
      const SM = SAMPLERS[state.sampler];
      const res = runToy(state.sampler, n);
      tx(svg, 8, 15, narrow ? SM.label + ' con N = ' + n + ' pasos' : SM.long + ' con N = ' + n + ' pasos: dónde terminan 48 muestras', 'viz-t');
      tx(svg, 8, 29, narrow ? 'juguete ilustrativo; costo: calculador' : 'juguete 2-D ilustrativo (modelo exacto); costo real de ' + label + ' (calculador)', 'viz-s');
      // ---- panel del juguete
      const P = narrow ? W - 16 : 330, px0 = 8, py0 = 42, R = 3.1;
      const X = (v) => px0 + P / 2 + v / R * P / 2, Y = (v) => py0 + P / 2 - v / R * P / 2;
      V.svg('rect', { x: px0, y: py0, width: P, height: P, class: 'viz-ds-box' }, svg);
      TOY.modes.forEach((m) => V.svg('circle', { cx: r1(X(m.mu[0])), cy: r1(Y(m.mu[1])), r: r1(IN_MODE / R * P / 2), class: 'viz-ds-mode' }, svg));
      // trayectoria resaltada: la muestra que parte más cerca del centro (la más indecisa: se ve elegir un modo)
      const path = res.paths[PI];
      const pi = PI;
      V.svg('path', { d: path.map((p, i) => (i ? 'L' : 'M') + r1(X(p[0])) + ' ' + r1(Y(p[1]))).join(''), class: 'viz-ds-path ' + SM.cls }, svg);
      if (path.length <= 60) path.forEach((p, i) => { if (i && i < path.length - 1) V.svg('circle', { cx: r1(X(p[0])), cy: r1(Y(p[1])), r: 2.2, class: 'viz-ds-step ' + SM.cls }, svg); });
      V.svg('circle', { cx: r1(X(path[0][0])), cy: r1(Y(path[0][1])), r: 4, class: 'viz-ds-start' }, svg);
      res.ends.forEach((p, i) => {
        const ok = D.nearestMode(TOY, p).d < IN_MODE;
        V.svg('circle', { cx: r1(X(Math.max(-R, Math.min(R, p[0])))), cy: r1(Y(Math.max(-R, Math.min(R, p[1])))), r: i === pi ? 4.5 : 3, class: 'viz-ds-end ' + SM.cls + (ok ? '' : ' is-off') + (i === pi ? ' is-sel' : '') }, svg);
      });
      const ly = py0 + P + 16;
      V.svg('circle', { cx: px0 + 6, cy: ly - 4, r: 4, class: 'viz-ds-start' }, svg); tx(svg, px0 + 14, ly, 'ruido inicial', 'viz-s');
      V.svg('circle', { cx: px0 + 112, cy: ly - 4, r: 3.5, class: 'viz-ds-end ' + SM.cls }, svg); tx(svg, px0 + 120, ly, 'final', 'viz-s');
      V.svg('circle', { cx: px0 + 168, cy: ly - 4, r: 3.5, class: 'viz-ds-end ' + SM.cls + ' is-off' }, svg); tx(svg, px0 + 176, ly, 'fuera de un modo', 'viz-s');
      tx(svg, px0, ly + 15, 'círculos: los 8 modos de los datos', 'viz-s');
      // ---- curvas: calidad del juguete y costo real vs N (eje x log, compartido)
      const cx0 = narrow ? 50 : px0 + P + 70, cwid = narrow ? W - 16 - 46 : W - cx0 - 16;
      let cy = narrow ? ly + 44 : py0 + 14;
      const chH = narrow ? 104 : 118;
      const lx = (k) => cx0 + cwid * Math.log(STEPS[k]) / Math.log(STEPS[STEPS.length - 1]);
      tx(svg, cx0 - 44, cy - 6, 'muestras dentro de un modo (juguete)', 'viz-s');
      V.svg('rect', { x: cx0, y: cy, width: r1(cwid), height: chH, class: 'viz-rl-box' }, svg);
      const Yq = (f) => cy + chH - chH * f;
      [0, 0.5, 1].forEach((f) => { tx(svg, cx0 - 4, Yq(f) + 4, Math.round(100 * f) + ' %', 'viz-s', 'end'); if (f > 0 && f < 1) V.svg('path', { d: 'M' + cx0 + ' ' + r1(Yq(f)) + 'H' + r1(cx0 + cwid), class: 'viz-rl-grid' }, svg); });
      Object.keys(SAMPLERS).forEach((k) => {
        const pts = STEPS.map((s, i) => [lx(i), Yq(runToy(k, s).inMode)]);
        V.svg('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join(''), class: 'viz-ds-line ' + SAMPLERS[k].cls + (k === state.sampler ? ' is-on' : '') }, svg);
        const last = pts[pts.length - 1];
        if (k === state.sampler) V.svg('circle', { cx: r1(lx(state.si)), cy: r1(Yq(res.inMode)), r: 5, class: 'viz-ds-cur ' + SAMPLERS[k].cls }, svg);
        void last;
      });
      // leyenda de líneas
      let lgx = cx0;
      Object.keys(SAMPLERS).forEach((k) => { V.svg('path', { d: 'M' + r1(lgx) + ' ' + r1(cy + chH + 30) + 'h16', class: 'viz-ds-line is-on ' + SAMPLERS[k].cls }, svg); tx(svg, lgx + 20, cy + chH + 34, SAMPLERS[k].label, 'viz-s'); lgx += 30 + SAMPLERS[k].label.length * 7; });
      const axis = (yy) => STEPS.forEach((s, i) => { if (i !== state.si && (narrow ? [1, 3, 4, 6, 9] : [4, 6]).indexOf(i) >= 0) return; tx(svg, lx(i), yy, String(s), i === state.si ? 'viz-n' : 'viz-s', i === STEPS.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'); });
      axis(cy + chH + 14);
      cy += chH + 62;
      // costo real (calculador): MACs por imagen según N
      const cs = STEPS.map((s) => cost(s, state.cfg));
      const cur = cs[state.si];
      if (cs.every(Boolean)) {
        tx(svg, cx0 - 44, cy - 6, 'costo por imagen, ' + label + (state.cfg ? ' con CFG' : '') + ' (calculador)', 'viz-s');
        V.svg('rect', { x: cx0, y: cy, width: r1(cwid), height: chH, class: 'viz-rl-box' }, svg);
        const lo = Math.log10(Math.min(...cs.map((c) => c.tot))), hi = Math.log10(Math.max(...cs.map((c) => c.tot)));
        const l0 = Math.floor(lo), l1 = Math.ceil(hi);
        const Yc = (v) => cy + chH - chH * (Math.log10(v) - l0) / ((l1 - l0) || 1);
        for (let e = l0; e <= l1; e++) { tx(svg, cx0 - 4, Yc(Math.pow(10, e)) + 4, ops(Math.pow(10, e)).replace(/\.0+ /, ' ').replace(/MACs/, ''), 'viz-s', 'end'); if (e > l0 && e < l1) V.svg('path', { d: 'M' + cx0 + ' ' + r1(Yc(Math.pow(10, e))) + 'H' + r1(cx0 + cwid), class: 'viz-rl-grid' }, svg); }
        V.svg('path', { d: cs.map((c, i) => (i ? 'L' : 'M') + r1(lx(i)) + ' ' + r1(Yc(c.tot))).join(''), class: 'viz-ds-cost' }, svg);
        V.svg('circle', { cx: r1(lx(state.si)), cy: r1(Yc(cur.tot)), r: 5, class: 'viz-ds-costpt' }, svg);
        // la curva sube hacia la derecha: la cifra va arriba a la izquierda del punto (abajo a la derecha en los dos primeros)
        const lft = state.si >= 2;
        tx(svg, lx(state.si) + (lft ? -9 : 9), Yc(cur.tot) + (lft ? -10 : 18), ops(cur.tot), 'viz-rl-lab', lft ? 'end' : 'start');
        axis(cy + chH + 14);
        tx(svg, cx0 + cwid / 2, cy + chH + 30, 'pasos N (escala log)', 'viz-s', 'middle');
        cy += chH + 40;
      } else {
        tx(svg, cx0 - 44, cy + 10, 'El calculador no da el costo de muestreo de ' + cfgId + '.', 'viz-s');
        cy += 30;
      }
      const Hh = Math.max(ly + 24, cy);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(Hh));
      svg.setAttribute('aria-label', SM.long + ', ' + n + ' pasos: ' + Math.round(100 * res.inMode) + ' % de las muestras del juguete terminan en un modo' + (cur ? '; costo real por imagen ' + ops(cur.tot) : '') + '.');
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      kv('pasos:', String(n));
      kv('en un modo (juguete):', Math.round(100 * res.inMode) + ' %');
      if (cur) {
        const evals = cur.nfe != null ? cur.nfe : n * (state.cfg ? 2 : 1);
        kv('evaluaciones de la red (' + net + '):', fmt.int(evals));
        kv('por imagen:', ops(cur.tot));
        if (cur.unet != null) kv(net + ':', Math.round(100 * cur.unet * evals / cur.tot) + ' %');
      }
      note.innerHTML = 'Cada paso es una pasada completa de la red (' + (net === 'DiT' ? 'el transformer' : 'la U-Net') + ' de ' + label + '), así que el costo crece lineal con N y el CFG lo duplica (la red corre con y sin la condición: el texto en SD, la clase en DiT). ' +
        'DDPM muestrea con ruido en cada paso y necesita muchos; DDIM sigue el mismo modelo de forma determinista (un ODE) y aguanta saltos grandes. El flujo rectificado usa otra agenda y otra grilla de tiempos; con el modelo exacto, DDIM y Euler sobre el flujo son el mismo integrador salvo la grilla (Gao et al. 2024), así que "recto" no da pasos gratis: lo que baja N en la práctica es la agenda, el solver y la destilación. ' +
        'Juguete con el modelo óptimo exacto (ilustrativo): con una red real, al error de discretizar se le suma el de la red.';
    }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, keys = Object.keys(SAMPLERS);
      if (k === 'ArrowRight') state.si = Math.min(STEPS.length - 1, state.si + 1);
      else if (k === 'ArrowLeft') state.si = Math.max(0, state.si - 1);
      else if (k === 'ArrowUp' || k === 'ArrowDown') state.sampler = keys[(keys.indexOf(state.sampler) + (k === 'ArrowDown' ? 1 : keys.length - 1)) % keys.length];
      else return;
      ev.preventDefault();
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('denoise-steps', render);
})(typeof window !== 'undefined' ? window : globalThis);
