/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/multimodal-actions.js
   Visualización "multimodal-actions" (SPEC §7.8, §27.3): por qué la regresión con MSE falla con demostraciones multimodales y
   un modelo generativo (Diffusion Policy, Chi et al., RSS 2023, arXiv:2303.04137) no.
   Juguete ILUSTRATIVO: el robot va del inicio a la meta y hay un obstáculo en el medio. La mitad de las demostraciones lo
   rodea por arriba y la otra mitad por abajo (o p y 1 − p). Cada chunk de T_p waypoints se resume en un latente de 2 números
   x = (a, b): a = desvío lateral (±1 = por arriba / por abajo), b = dónde está el pico del desvío. Las demos son una mezcla de
   dos gaussianas N(μ_k, s²I) con μ = (±1, 0), s = 0.15.
     - MSE: el óptimo de E‖x − f(o)‖² es la media condicional, Σ_k p_k μ_k = (2p − 1, 0): con 50/50, a = 0 → recto, choca.
     - Difusión: DDIM (η = 0) con el ε-predictor ÓPTIMO de la mezcla, en forma cerrada (ATLAS.Viz.diff.epsHat, sin red): lo que se
       ve es solo el efecto del muestreador y del número de pasos K. Agenda "squaredcos_cap_v2" (coseno, Nichol y Dhariwal 2021),
       la de Diffusion Policy, con 100 pasos de entrenamiento: ᾱ(t) = cos²(((t/T + 0.008)/1.008)·π/2), β ≤ 0.999.
       Pasos de inferencia "trailing" (el primero en t = T − 1: se arranca de ruido puro).
     - Con K = 1 el resultado es E[x₀ | x_T] ≈ la media: lo mismo que MSE. Cada paso más compromete la muestra con un modo.
   Lo NO ilustrativo: T_p, T_a, los pasos de inferencia y los MACs por paso de la config del calculador (diffusion-policy-cnn).
   params: { config:'diffusion-policy-cnn', steps:<K>, p:0.5, eta:0 }
   Puro (sin DOM) para tests: ATLAS.Viz.mm = { cosineAbar, mixture, msePrediction, sample, waypoints, collides }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9]{1,2}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const S_MODE = 0.15, T_TRAIN = 100, NS = 16, OBST_R = 0.1, BULGE = 0.22, YH = 0.36;
  const PS = [0.5, 0.7];

  // ---- matemática (pura)
  // agenda coseno de diffusers (betas_for_alpha_bar, max_beta 0.999): ᾱ_t = Π (1 − β_i)
  function cosineAbar(T) {
    const f = (t) => Math.pow(Math.cos((t + 0.008) / 1.008 * Math.PI / 2), 2);
    const abar = new Float64Array(T); let p = 1;
    for (let i = 0; i < T; i++) { const b = Math.min(1 - f((i + 1) / T) / f(i / T), 0.999); p *= 1 - b; abar[i] = p; }
    return abar;
  }
  const mixture = (p) => ({ s: S_MODE, modes: [{ mu: [1, 0], w: p }, { mu: [-1, 0], w: 1 - p }] });
  const msePrediction = (p) => [p * 1 + (1 - p) * -1, 0];
  const trailing = (T, n) => { const out = []; for (let i = 0; i < n; i++) out.push(Math.max(0, T - 1 - Math.round(i * T / n))); return out; };
  function sample(p, K, xT, eta, rng) {
    const D = ATLAS.Viz.diff;
    return D.sampleVP(mixture(p), xT, cosineAbar(T_TRAIN), trailing(T_TRAIN, K), { eta: eta || 0, rng });
  }
  // latente (a, b) → n waypoints (x ∈ [0, 1], y ∈ [−YH, YH] alrededor de 0.5; inicio (0, .5), meta (1, .5)); el pico del desvío se corre con b
  function waypoints(x, n) {
    const pts = [];
    const c = Math.max(0.15, Math.min(0.85, 0.5 + 0.35 * x[1]));
    for (let j = 0; j <= n; j++) {
      const s = j / n;
      const w = s <= c ? Math.sin(Math.PI / 2 * s / c) : Math.sin(Math.PI / 2 * (1 - s) / (1 - c));
      pts.push([s, 0.5 - x[0] * BULGE * w]);
    }
    return pts;
  }
  // choque: algún tramo pasa a menos de OBST_R del centro del obstáculo (0.5, 0.5)
  function collides(pts) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((0.5 - a[0]) * dx + (0.5 - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(a[0] + u * dx - 0.5, a[1] + u * dy - 0.5) < OBST_R) return true;
    }
    return false;
  }

  function render(el, params) {
    const V = ATLAS.Viz, Ar = ATLAS.Arch;
    const cfgId = params.config || 'diffusion-policy-cnn';
    let run = null, met = null;
    try { run = Ar.run(cfgId); } catch (e) { run = null; }
    try { met = Ar.metrics(cfgId); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const pick = (o, ks, d) => { for (const k of ks) { const v = o ? k.split('.').reduce((a, p) => (a == null ? a : a[p]), o) : undefined; if (Number.isFinite(v)) return v; } return d; };
    // claves del contrato de js/arch/robotlearn.js (metrics primero, después la config)
    const Tp = Math.round(pick(met, ['chunk'], pick(cfg, ['chunk', 'Tp', 'horizon'], 16)));
    const Ta = Math.round(pick(met, ['executed'], pick(cfg, ['executed', 'Ta', 'nActionSteps'], 8)));
    const kCfg = Math.max(1, Math.round(pick(met, ['steps'], pick(cfg, ['steps', 'inferenceSteps'], 8))));
    const stepMacs = pick(met, ['stepMacs'], null);
    const obsMacs = pick(met, ['visionMacs'], null);
    const STEPS = [1, 2, 5, 10, 100];   // + los de la config (8 en el YAML de Diffusion Policy) if (STEPS.indexOf(kCfg) < 0) { STEPS.push(kCfg); STEPS.sort((a, b) => a - b); }
    const num = (v, d) => (Number.isFinite(+v) && v != null && v !== '' ? +v : d);
    const state = {
      K: STEPS.indexOf(+params.steps) >= 0 ? +params.steps : kCfg,
      p: PS.indexOf(+params.p) >= 0 ? +params.p : 0.5,
      eta: num(params.eta, 0) ? 1 : 0,
      sel: 0,
    };
    const starts = []; { const R = V.rng(2303); for (let i = 0; i < NS; i++) starts.push([R.normal(), R.normal()]); }
    const demoNoise = []; { const R = V.rng(404); for (let i = 0; i < 12; i++) demoNoise.push([R(), R.normal(), R.normal()]); }

    const wrap = V.html('div', { class: 'viz viz-mm' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const all = [];
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const chips = (g, vals, key, label) => vals.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._k = key; b._v = v; all.push(b); });
    chips(grp('Pasos de denoising K'), STEPS, 'K', (v) => String(v) + (v === kCfg ? ' (config)' : ''));
    chips(grp('Demos arriba / abajo'), PS, 'p', (v) => Math.round(v * 100) + ' / ' + Math.round((1 - v) * 100));
    chips(grp('Muestreador'), [0, 1], 'eta', (v) => (v ? 'DDPM (η = 1)' : 'DDIM (η = 0)'));
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-mm-stage', tabindex: 0, role: 'group', 'aria-label': 'Acciones multimodales: regresión MSE contra difusión. Flechas izquierda y derecha: pasos K; arriba y abajo: muestra resaltada' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      const g = mixture(state.p);
      const R = V.rng(99);
      const samples = starts.map((z) => sample(state.p, state.K, z, state.eta, R));
      const fin = samples.map((path) => path[path.length - 1]);
      const sp = fin.map((x) => waypoints(x, Tp));
      const hit = sp.map(collides);
      const up = fin.filter((x, i) => x[0] > 0 && !hit[i]).length, down = fin.filter((x, i) => x[0] <= 0 && !hit[i]).length, nHit = hit.filter(Boolean).length;
      const mse = msePrediction(state.p), msePts = waypoints(mse, Tp), mseHit = collides(msePts);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(520, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'MSE promedia los modos; difusión elige uno' : 'Demos que rodean el obstáculo por los dos lados: la regresión MSE promedia y choca; la difusión elige un lado', 'viz-t');
      t(svg, 8, 29, narrow ? 'T_p = ' + Tp + ' (se ejecutan ' + Ta + ') · K = ' + state.K + ' · ' + NS + ' muestras' : 'chunk de T_p = ' + Tp + ' waypoints (se ejecutan T_a = ' + Ta + ') · K = ' + state.K + ' pasos · ' + NS + ' muestras de ruido', 'viz-s');

      // ---- escena (unidades [0, 1]²)
      // escala uniforme: x ∈ [−0.04, 1.04], y ∈ 0.5 ± YH (lo que se sale, recortado al marco)
      const sw = narrow ? W - 16 : 520, k = sw / 1.08, sh = 2 * YH * k, sx = 8, sy = 44;
      const P = (q) => [sx + (q[0] + 0.04) * k, sy + sh / 2 + Math.max(-YH, Math.min(YH, q[1] - 0.5)) * k];
      V.svg('rect', { x: sx, y: sy, width: r1(sw), height: r1(sh), class: 'viz-pc-bg' }, svg);
      const oc = P([0.5, 0.5]);
      V.svg('circle', { cx: r1(oc[0]), cy: r1(oc[1]), r: r1(OBST_R * k * 0.98), class: 'viz-mm-obs' }, svg);
      t(svg, oc[0], oc[1] - OBST_R * k * 0.45, 'obstáculo', 'viz-mm-obst', 'middle');
      const poly = (pts, cls) => V.svg('path', { d: pts.map((q, i) => { const pp = P(q); return (i ? 'L' : 'M') + r1(pp[0]) + ' ' + r1(pp[1]); }).join(''), class: cls }, svg);
      // demostraciones (de la mezcla, con semilla)
      demoNoise.forEach(([u, n1, n2]) => { const k = u < state.p ? 0 : 1; poly(waypoints([g.modes[k].mu[0] + S_MODE * n1, S_MODE * n2], 40), 'viz-mm-demo'); });
      // muestras de difusión (la resaltada con sus T_a primeros waypoints marcados)
      sp.forEach((pts, i) => { if (i !== state.sel) poly(pts, 'viz-mm-samp' + (hit[i] ? ' is-hit' : '')); });
      const cur = sp[state.sel];
      poly(cur, 'viz-mm-samp is-sel' + (hit[state.sel] ? ' is-hit' : ''));
      cur.forEach((q, j) => { if (j === 0) return; const pp = P(q); V.svg('circle', { cx: r1(pp[0]), cy: r1(pp[1]), r: j <= Ta ? 3.2 : 2.4, class: 'viz-mm-wp' + (j <= Ta ? ' is-exec' : '') }, svg); });
      // la predicción MSE
      poly(msePts, 'viz-mm-mse' + (mseHit ? ' is-hit' : ''));
      const st = P([0, 0.5]), gl = P([1, 0.5]);
      V.svg('circle', { cx: r1(st[0]), cy: r1(st[1]), r: 6, class: 'viz-mm-start' }, svg);
      V.svg('rect', { x: r1(gl[0] - 7), y: r1(gl[1] - 7), width: 14, height: 14, class: 'viz-mm-goal' }, svg);
      t(svg, st[0] + 2, st[1] - 10, 'inicio', 'viz-mm-pl'); t(svg, gl[0] - 2, gl[1] - 12, 'meta', 'viz-mm-pl', 'end');

      // ---- latente: la mezcla, la media (MSE) y los caminos de denoising
      const lx = narrow ? 8 : sx + sw + 24, ly = narrow ? sy + sh + 34 : sy, lw = narrow ? W - 16 : W - lx - 8, lh = narrow ? lw * 0.62 : sh;
      const RNG = 2.6, L = (x) => [lx + lw / 2 + x[0] / RNG * lw / 2, ly + lh / 2 - x[1] / RNG * lh / 2 * (lw / lh)];
      const clipP = (x) => [Math.max(-RNG, Math.min(RNG, x[0])), Math.max(-RNG * lh / lw, Math.min(RNG * lh / lw, x[1]))];
      t(svg, lx, ly - 6, narrow ? 'Latente (a, b): de ruido a un modo' : 'Latente x = (a, b): de ruido a un modo', 'viz-n');
      V.svg('rect', { x: r1(lx), y: r1(ly), width: r1(lw), height: r1(lh), class: 'viz-pc-bg' }, svg);
      const ax = L([0, 0]);
      V.svg('path', { d: 'M' + r1(lx) + ' ' + r1(ax[1]) + 'H' + r1(lx + lw) + 'M' + r1(ax[0]) + ' ' + r1(ly) + 'V' + r1(ly + lh), class: 'viz-pc-axis' }, svg);
      // franja "choca": |a| bajo el umbral de choque (calculado: el menor |a| con b = 0 que no choca)
      let aMin = 0; for (let a = 0; a <= 1.5; a += 0.005) { if (!collides(waypoints([a, 0], Tp))) { aMin = a; break; } }
      const z0 = L([-aMin, 0]), z1 = L([aMin, 0]);
      V.svg('rect', { x: r1(z0[0]), y: r1(ly), width: r1(z1[0] - z0[0]), height: r1(lh), class: 'viz-mm-hitband' }, svg);
      t(svg, (z0[0] + z1[0]) / 2, ly + lh - 6, 'choca', 'viz-mm-obst', 'middle');
      g.modes.forEach((m) => { const c = L(m.mu); V.svg('ellipse', { cx: r1(c[0]), cy: r1(c[1]), rx: r1(2 * S_MODE / RNG * lw / 2), ry: r1(2 * S_MODE / RNG * lw / 2), class: 'viz-mm-mode' }, svg); t(svg, c[0], c[1] - 2 * S_MODE / RNG * lw / 2 - 5, (m.mu[0] > 0 ? 'arriba ' : 'abajo ') + Math.round(m.w * 100) + ' %', 'viz-s', 'middle'); });
      samples.forEach((path, i) => {
        const d = path.map((x, j) => { const q = L(clipP(x)); return (j ? 'L' : 'M') + r1(q[0]) + ' ' + r1(q[1]); }).join('');
        V.svg('path', { d, class: 'viz-mm-lpath' + (i === state.sel ? ' is-sel' : '') }, svg);
        const e = L(clipP(path[path.length - 1]));
        V.svg('circle', { cx: r1(e[0]), cy: r1(e[1]), r: i === state.sel ? 4.2 : 3, class: 'viz-mm-lend' + (hit[i] ? ' is-hit' : '') + (i === state.sel ? ' is-sel' : '') }, svg);
      });
      const mq = L(mse);
      V.svg('path', { d: 'M' + r1(mq[0] - 6) + ' ' + r1(mq[1] - 6) + 'l12 12M' + r1(mq[0] + 6) + ' ' + r1(mq[1] - 6) + 'l-12 12', class: 'viz-mm-msex' }, svg);
      t(svg, mq[0] + 9, mq[1] + 16, 'MSE', 'viz-mm-msel');
      t(svg, lx + lw - 4, ax[1] - 4, 'a', 'viz-n', 'end'); t(svg, ax[0] + 5, ly + 12, 'b', 'viz-n');

      // leyenda
      let gy = Math.max(sy + sh, ly + lh) + 22, gx = 8;
      const leg = [['viz-mm-demo', 'demostraciones'], ['viz-mm-mse', 'regresión MSE (la media)'], ['viz-mm-samp', 'muestras de difusión'], ['dot', 'waypoints ejecutados (T_a)'], ['viz-mm-lpath', 'camino de denoising (latente)']];
      leg.forEach(([c, s]) => {
        const iw = 26 + s.length * 6.4 + 12;
        if (gx > 8 && gx + iw > W - 8) { gx = 8; gy += 16; }
        if (c === 'dot') V.svg('circle', { cx: gx + 9, cy: gy - 4, r: 3.2, class: 'viz-mm-wp is-exec' }, svg);
        else V.svg('path', { d: 'M' + gx + ' ' + (gy - 4) + 'h18', class: c }, svg);
        const tt = t(svg, gx + 24, gy, '', 'viz-s'); V.rich(tt, s);
        gx += iw;
      });
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(gy + 10));
      svg.setAttribute('aria-label', 'Con demos ' + Math.round(state.p * 100) + '/' + Math.round((1 - state.p) * 100) + ' y K = ' + state.K + ' pasos: la regresión MSE ' + (mseHit ? 'choca' : 'no choca') + '; de ' + NS + ' muestras de difusión, ' + up + ' van por arriba, ' + down + ' por abajo y ' + nHit + ' chocan.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp2 = V.html('span', null, out); sp2.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('MSE:', 'a = ' + mse[0].toFixed(2).replace('-', '−') + (mseHit ? ' → choca' : ' → pasa (pero no es ninguna demo)'));
      kv('difusión (' + NS + ' muestras):', up + ' arriba · ' + down + ' abajo · ' + nHit + ' chocan');
      if (stepMacs != null) {
        const fm = Ar && Ar.fmt && Ar.fmt.ops ? Ar.fmt.ops : (v) => String(v);
        kv('costo por inferencia:', (obsMacs != null ? 'encoder ' + fm(obsMacs) + ' + ' : '') + state.K + ' × ' + fm(stepMacs) + ' = ' + fm((obsMacs || 0) + state.K * stepMacs));
      }
      kv('config ' + ((run && run.label) || cfgId) + ':', 'T_p = ' + Tp + ', T_a = ' + Ta + ', K = ' + kCfg + ' pasos');
      note.innerHTML = sub('La pérdida MSE se minimiza con la media condicional de las acciones: si la mitad de las demos esquiva por arriba y la otra mitad por abajo, la media va derecho al obstáculo (y con 70/30 queda a mitad de camino: tampoco es una demo). Un modelo generativo aprende la distribución entera y muestrea UN modo por inferencia. Aquí el denoiser es el óptimo exacto de la mezcla (sin red): con K = 1 paso, DDIM devuelve E[x₀ | x_T] ≈ la media, igual que MSE; cada paso más compromete la muestra con un lado. El precio: K pasadas de la red de denoising por inferencia (el encoder de observaciones corre una vez). Diffusion Policy predice un chunk de T_p acciones y ejecuta solo las T_a primeras antes de volver a inferir (receding horizon): el chunk mantiene el modo elegido de un paso al siguiente, lo que evita oscilar entre los dos lados.');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); const i = Math.max(0, Math.min(STEPS.length - 1, STEPS.indexOf(state.K) + (k === 'ArrowRight' ? 1 : -1))); state.K = STEPS[i]; draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); state.sel = (state.sel + (k === 'ArrowUp' ? 1 : NS - 1)) % NS; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.mm = { cosineAbar, mixture, msePrediction, sample, waypoints, collides, trailing };
    ATLAS.Viz.register('multimodal-actions', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
