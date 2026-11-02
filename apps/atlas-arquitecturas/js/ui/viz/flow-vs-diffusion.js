/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/flow-vs-diffusion.js
   Visualización "flow-vs-diffusion" (SPEC §7.8, §20.4): caminos curvos (difusión) frente a caminos rectos (flujo rectificado).
   Juguete 2-D ("ilustrativo"): datos = 8 gaussianas en un anillo; ruido ε ~ N(0, I). Dos paneles con el MISMO ruido inicial:
   - Difusión (VP, convención DDPM/SD): por par (x₀, ε) el camino es x_t = √ᾱ_t·x₀ + √(1−ᾱ_t)·ε, un ARCO (los dos
     coeficientes recorren un cuarto de círculo); al muestrear se sigue el ODE de flujo de probabilidad (DDIM, η = 0).
   - Flujo rectificado (Liu et al. 2023; Lipman et al. 2023; SD3): x_t = (1−t)·x₀ + t·ε, una RECTA por par; el modelo
     aprende v = ε − x₀ y se integra con Euler de t = 1 a 0.
   Modo "pares": los caminos por par (condicionales). Modo "muestreo": las trayectorias del ODE con el modelo óptimo exacto
   (tenues, con 200 pasos) y las de N pasos (marcadas), con el error de los N pasos frente a la solución fina.
   Nota honesta (en la viz): las trayectorias marginales del flujo NO son rectas del todo (cada x_t mezcla muchos pares), y con
   el modelo exacto DDIM = Euler sobre el flujo tras reescalar (Gao et al. 2024): lo que cambia con N chico es la grilla de
   tiempos (ᾱ del calculador, sin ruido puro, frente a t uniforme). "Reflow" (Liu et al.) endereza las trayectorias.
   Lo NO ilustrativo: la agenda ᾱ de la config del calculador (la de SD).
   params: { config:'sd15-unet', steps:4, mode:'ode'|'pairs' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const STEPS = [1, 2, 3, 4, 6, 8, 12, 20, 50];
  const TOY = { s: 0.12, modes: Array.from({ length: 8 }, (_, k) => ({ mu: [2 * Math.cos(k * Math.PI / 4), 2 * Math.sin(k * Math.PI / 4)], cls: k % 2 })) };
  const R = 3.1, NS = 20, FINE = 200;

  function render(el, params) {
    const V = ATLAS.Viz, D = V.diff;
    const cfgId = params.config || 'sd15-unet';
    const sched = D.scheduleOf(cfgId);
    if (!sched) { const d = V.html('div', { class: 'ad-error', role: 'alert', text: 'La config ' + cfgId + ' del calculador no trae la agenda de ruido (β).' }, el); return { destroy() { d.remove(); } }; }
    const state = { si: Math.max(0, STEPS.indexOf(+params.steps || 4)), mode: params.mode === 'pairs' ? 'pairs' : 'ode' };
    if (STEPS.indexOf(+params.steps || 4) < 0) state.si = STEPS.indexOf(4);

    const starts = [];
    { const rng = V.rng(5); for (let i = 0; i < NS; i++) starts.push([rng.normal(), rng.normal()]); }
    // pares (x₀, ε) para el modo "pares": x₀ de un modo al azar
    const pairs = [];
    { const rng = V.rng(77); for (let i = 0; i < 16; i++) { const m = TOY.modes[Math.floor(rng() * TOY.modes.length)]; pairs.push({ x0: [m.mu[0] + TOY.s * rng.normal(), m.mu[1] + TOY.s * rng.normal()], e: [rng.normal(), rng.normal()] }); } }
    const fineVP = starts.map((z) => D.sampleVP(TOY, z, sched.abar, D.timesteps(sched.T, FINE)));
    const fineFL = starts.map((z) => D.sampleFlow(TOY, z, FINE));
    const cache = {};
    function coarse(n) {
      if (!cache[n]) cache[n] = { vp: starts.map((z) => D.sampleVP(TOY, z, sched.abar, D.timesteps(sched.T, n))), fl: starts.map((z) => D.sampleFlow(TOY, z, n)) };
      return cache[n];
    }
    const err = (cs, fs) => cs.reduce((a, p, i) => { const q = p[p.length - 1], f = fs[i][fs[i].length - 1]; return a + Math.hypot(q[0] - f[0], q[1] - f[1]); }, 0) / cs.length;

    const wrap = V.html('div', { class: 'viz viz-fd' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Qué caminos mostrar' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Mostrar' }, g1);
    const mBtns = [['pairs', 'caminos por par (x₀, ε)'], ['ode', 'muestreo con N pasos']].map(([k, text]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text }, g1); b.addEventListener('click', () => { state.mode = k; draw(); }); b._k = k; return b; });
    const g2 = V.html('label', { class: 'viz-ctl viz-fd-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Pasos N' }, g2);
    const inp = V.html('input', { type: 'range', min: 0, max: STEPS.length - 1, step: 1, 'aria-label': 'Pasos de Euler / DDIM' }, g2);
    const outN = V.html('output', { class: 'viz-ns-out' }, g2);
    inp.addEventListener('input', () => { state.si = +inp.value; state.mode = 'ode'; draw(); });
    const stage = V.html('div', { class: 'viz-stage viz-fd-stage', tabindex: 0, role: 'group', 'aria-label': 'Difusión frente a flujo. Flechas izquierda y derecha: pasos N; P: alterna caminos por par y muestreo' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      mBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.mode)));
      const n = STEPS[state.si];
      inp.value = state.si; outN.textContent = 'N = ' + n;
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(440, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const tx = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); if (V.rich) V.rich(e, s); else e.textContent = s; return e; };
      const pairsMode = state.mode === 'pairs';
      tx(svg, 8, 15, pairsMode ? 'Por par (x₀, ε): difusión = arco · flujo = recta' : (narrow ? 'Muestreo con N = ' + n + ' pasos' : 'Muestreo con N = ' + n + ' pasos desde el mismo ruido: difusión (DDIM) frente a flujo (Euler)'), 'viz-t');
      tx(svg, 8, 29, narrow ? 'juguete 2-D ilustrativo (modelo exacto)' : (pairsMode ? 'juguete 2-D ilustrativo; ᾱ de la config del calculador' : 'juguete 2-D, modelo exacto: DDIM en la grilla de ᾱ del calculador (no llega a ruido puro) · Euler en t uniforme'), 'viz-s');
      const gap = 24, top = 70;
      const P = narrow ? W - 16 : (W - 16 - gap) / 2;
      const C = coarse(n);
      const eVP = err(C.vp, fineVP), eFL = err(C.fl, fineFL);
      const panel = (k, title, sub, cls, finePaths, coarsePaths, pairPath) => {
        const x0 = narrow ? 8 : 8 + k * (P + gap), y0 = narrow ? top + k * (P + 74) : top;
        const X = (v) => x0 + P / 2 + Math.max(-R, Math.min(R, v)) / R * P / 2, Y = (v) => y0 + P / 2 - Math.max(-R, Math.min(R, v)) / R * P / 2;
        tx(svg, x0, y0 - 22, title, 'viz-n');
        tx(svg, x0, y0 - 8, sub, 'viz-s');
        V.svg('rect', { x: x0, y: y0, width: r1(P), height: r1(P), class: 'viz-ds-box' }, svg);
        TOY.modes.forEach((m) => V.svg('circle', { cx: r1(X(m.mu[0])), cy: r1(Y(m.mu[1])), r: r1(3 * TOY.s / R * P / 2), class: 'viz-ds-mode' }, svg));
        const line = (pts, c) => V.svg('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + r1(X(p[0])) + ' ' + r1(Y(p[1]))).join(''), class: c }, svg);
        if (pairsMode) {
          pairs.forEach((pr) => {
            line(pairPath(pr), 'viz-fd-pair ' + cls);
            V.svg('circle', { cx: r1(X(pr.e[0])), cy: r1(Y(pr.e[1])), r: 2.6, class: 'viz-ds-start' }, svg);
            V.svg('circle', { cx: r1(X(pr.x0[0])), cy: r1(Y(pr.x0[1])), r: 3, class: 'viz-ds-end ' + cls }, svg);
          });
        } else {
          finePaths.forEach((p) => line(p, 'viz-fd-fine ' + cls));
          coarsePaths.forEach((p) => {
            line(p, 'viz-ds-path ' + cls);
            if (p.length <= 13) p.slice(1, -1).forEach((q) => V.svg('circle', { cx: r1(X(q[0])), cy: r1(Y(q[1])), r: 1.8, class: 'viz-ds-step ' + cls }, svg));
            V.svg('circle', { cx: r1(X(p[0][0])), cy: r1(Y(p[0][1])), r: 2.6, class: 'viz-ds-start' }, svg);
            const e = p[p.length - 1];
            V.svg('circle', { cx: r1(X(e[0])), cy: r1(Y(e[1])), r: 3.2, class: 'viz-ds-end ' + cls + (D.nearestMode(TOY, e).d < 0.4 ? '' : ' is-off') }, svg);
          });
        }
        return y0 + P;
      };
      const vpPair = (pr) => { const out2 = []; for (let t = sched.T - 1; t >= 0; t -= 10) { const a = sched.abar[t]; out2.push([Math.sqrt(a) * pr.x0[0] + Math.sqrt(1 - a) * pr.e[0], Math.sqrt(a) * pr.x0[1] + Math.sqrt(1 - a) * pr.e[1]]); } out2.push(pr.x0); return out2; };
      const flPair = (pr) => [pr.e, pr.x0];
      const b1 = panel(0, 'Difusión (VP: DDPM, SD 1.x)', pairsMode ? 'x_t = √ᾱ_t·x₀ + √(1−ᾱ_t)·ε' : 'DDIM (ODE), N = ' + n + ' · error ' + eVP.toFixed(2), 'is-ddim', fineVP, C.vp, vpPair);
      const b2 = panel(1, 'Flujo rectificado (convención de SD3)', pairsMode ? 'x_t = (1−t)·x₀ + t·ε' : 'Euler, N = ' + n + ' · error ' + eFL.toFixed(2), 'is-flow', fineFL, C.fl, flPair);
      let y = Math.max(b1, b2) + 18;
      // puntos neutros (tinta): cada panel pinta los suyos con su color (azul difusión, verde flujo)
      const lgd = pairsMode ? [['viz-ds-start', 'ε (ruido)'], ['viz-ds-end', 'x₀ (dato, en el color de cada panel)']] : [['viz-ds-start', 'ruido inicial'], ['viz-ds-end', 'final (en el color de cada panel)'], ['viz-ds-end is-off', 'fuera de un modo']];
      let lx = 8;
      lgd.forEach(([c, lab]) => { V.svg('circle', { cx: lx + 4, cy: y - 4, r: 3.5, class: c }, svg); tx(svg, lx + 12, y, lab, 'viz-s'); lx += 26 + lab.length * 6.4; });
      if (!pairsMode) {
        if (narrow) { lx = 8; y += 15; }
        V.svg('path', { d: 'M' + r1(lx) + ' ' + r1(y - 4) + 'h18', class: 'viz-fd-fine is-ddim' }, svg); tx(svg, lx + 22, y, 'tenue: el mismo ODE con ' + FINE + ' pasos', 'viz-s');
      }
      y += 16;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      svg.setAttribute('aria-label', pairsMode ? 'Caminos por par: en difusión cada par ruido–dato se une con un arco; en flujo rectificado, con una recta.' : 'Con ' + n + ' pasos: error medio de difusión ' + eVP.toFixed(2) + ' y de flujo ' + eFL.toFixed(2) + ' frente a la solución con ' + FINE + ' pasos.');
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      kv('pasos:', String(n));
      kv('error medio del final frente a ' + FINE + ' pasos: difusión', eVP.toFixed(2));
      kv('flujo', eFL.toFixed(2));
      note.innerHTML = 'Por par, el flujo rectificado une ruido y dato con una recta (x<sub>t</sub> = (1−t)·x₀ + t·ε, objetivo v = ε − x₀) y la difusión con un arco. Las trayectorias que sigue el muestreo mezclan muchos pares y no son rectas (aquí se ve: primero van hacia el centro y después eligen un modo). ' +
        'Ojo con leer "recto, luego menos pasos": con el modelo exacto, DDIM <i>es</i> Euler sobre el flujo después de reescalar x/α (Gao et al. 2024, <i>Diffusion Meets Flow Matching</i>). La diferencia que ves con N chico viene de la <b>grilla de tiempos</b>: DDIM usa los pasos de la agenda ᾱ del calculador, que no llega a ruido puro (ᾱ<sub>T−1</sub> ≈ ' + sched.abar[sched.T - 1].toFixed(4) + '), y Euler una t uniforme de 1 a 0. Las ganancias reales del flujo en la práctica: agenda y grilla, cómo se pesa la pérdida en t, y reflow (Liu et al. 2023: re-entrenar con los pares (ruido, muestra) del propio modelo) o destilación. ' +
        'π0 también usa flujo, para acciones, con la convención opuesta en el paper (τ = 0 es ruido, u = A − ε); el código público (openpi) usa la de SD3. Juguete con el modelo exacto: el error es solo el de discretizar.';
      // en "pares" el deslizador de N y el error no aplican
      inp.disabled = pairsMode; g2.classList.toggle('is-off', pairsMode);
      out.hidden = pairsMode;
    }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') { state.si = Math.min(STEPS.length - 1, state.si + 1); state.mode = 'ode'; }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { state.si = Math.max(0, state.si - 1); state.mode = 'ode'; }
      else if (k === 'p' || k === 'P') state.mode = state.mode === 'pairs' ? 'ode' : 'pairs';
      else return;
      ev.preventDefault();
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('flow-vs-diffusion', render);
})(typeof window !== 'undefined' ? window : globalThis);
