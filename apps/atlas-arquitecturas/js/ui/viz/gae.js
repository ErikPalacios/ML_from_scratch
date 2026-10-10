/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/gae.js
   Visualización "gae" (SPEC §7.8, §27.3): Generalized Advantage Estimation (Schulman et al., ICLR 2016, arXiv:1506.02438).
       δ_t = r_t + γ·V(s_{t+1})·(1 − done_t) − V(s_t)
       Â_t = δ_t + γλ·Â_{t+1}          (recursión hacia atrás, como CleanRL / rsl_rl)
           = Σ_{l=0}^{T−1−t} (γλ)^l δ_{t+l}   (forma cerrada; la viz verifica que coinciden)
       λ = 0 → Â_t = δ_t (TD(0));  λ = 1 → Â_t = Σ_l γ^l r_{t+l} + γ^{T−t} V(s_T) − V(s_t) (Monte Carlo menos la línea de base)
       retorno objetivo del crítico: R_t = Â_t + V(s_t)
   Juguete ILUSTRATIVO y exacto: una cadena de T = 16 pasos con recompensa media μ_t (−0.05 por paso, +1 en el último) y ruido
   σ_r en cada recompensa (un episodio muestreado con semilla fija); V*(s_t) = Σ γ^l μ_{t+l} (+ γ^{T−t}·c si el rollout se corta
   y el episodio sigue: c = valor verdadero del estado de corte). El crítico se equivoca: V = V* + e_t (error fijo, inventado).
   Sesgo y varianza de Â_t, en forma cerrada (transiciones deterministas, solo las recompensas son ruidosas):
       sesgo_t = E[Â_t] + V(s_t) − V*(s_t) = Σ_l (γλ)^l (γ e_{t+l+1} − e_{t+l}) + e_t
               (se suma e_t porque el término −V(s_t) depende solo de s_t: es línea de base y no sesga el gradiente)
       var_t   = σ_r² · Σ_l (γλ)^{2l}
   λ = 1 con episodio terminal: sesgo 0 (solo queda el ruido); λ = 0: sesgo γ·e_{t+1}, varianza σ_r² (mínima).
   γ y λ de la config del calculador (ATLAS.Arch.run / metrics; ppo-mujoco por omisión).
   params: { config:'ppo-mujoco', gamma:<γ>, lambda:<λ>, t:3, end:'terminal'|'cut' }
   Puro (sin DOM) para tests: ATLAS.Viz.gae = { episode, deltas, gaeRecursive, gaeClosed, biasVar }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9θφ]{1,3}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const f2 = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)).replace('-', '−');
  const f3 = (v) => (Math.abs(v) < 0.0005 ? '0.000' : v.toFixed(3)).replace('-', '−');
  const T = 16, SIG_R = 0.12, CUT_VALUE = 0.6;

  // ---- el juguete (puro)
  function episode(gamma, end, seed) {
    const R = ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(seed || 1506) : Math.random;
    const mu = [], r = [], e = [];
    for (let t = 0; t < T; t++) mu.push(t === T - 1 ? 1 : -0.05);
    for (let t = 0; t < T; t++) r.push(mu[t] + SIG_R * (R.normal ? R.normal() : 0));
    // V* por Bellman hacia atrás; V*(s_T) = 0 si es terminal, c si el rollout se corta y el episodio sigue
    const vT = end === 'cut' ? CUT_VALUE : 0;
    const vStar = new Array(T + 1); vStar[T] = vT;
    for (let t = T - 1; t >= 0; t--) vStar[t] = mu[t] + gamma * vStar[t + 1];
    // error del crítico (inventado, sesgado y suave); en un estado terminal el valor es 0 por definición (sin error)
    for (let t = 0; t <= T; t++) e.push(0.4 * Math.cos(0.75 * t + 0.4) - 0.1);
    if (end !== 'cut') e[T] = 0;
    const v = vStar.map((x, t) => x + e[t]);
    if (end !== 'cut') v[T] = 0;
    return { mu, r, e, vStar, v, end, done: end !== 'cut' };
  }
  // δ_t con V(s_T) = 0 si es terminal (done) o el bootstrap del crítico si el rollout se corta
  function deltas(ep, gamma) {
    const d = [];
    for (let t = 0; t < T; t++) { const last = t === T - 1; const next = last ? (ep.done ? 0 : ep.v[T]) : ep.v[t + 1]; d.push(ep.r[t] + gamma * next - ep.v[t]); }
    return d;
  }
  function gaeRecursive(d, gamma, lam) { const A = new Array(d.length); let acc = 0; for (let t = d.length - 1; t >= 0; t--) { acc = d[t] + gamma * lam * acc; A[t] = acc; } return A; }
  function gaeClosed(d, gamma, lam) { return d.map((_, t) => { let s = 0, w = 1; for (let l = 0; t + l < d.length; l++) { s += w * d[t + l]; w *= gamma * lam; } return s; }); }
  // sesgo y varianza exactos de Â_t (ver la cabecera)
  function biasVar(ep, gamma, lam, t) {
    const e = ep.e.slice(); if (ep.done) e[T] = 0;
    let b = e[t], vr = 0, w = 1;
    for (let l = 0; t + l < T; l++) { b += w * (gamma * e[t + l + 1] - e[t + l]); vr += w * w; w *= gamma * lam; }
    return { bias: b, variance: SIG_R * SIG_R * vr };
  }

  function render(el, params) {
    const V = ATLAS.Viz, Ar = ATLAS.Arch;
    const cfgId = params.config || 'ppo-mujoco';
    let run = null, met = null;
    try { run = Ar.run(cfgId); } catch (e) { run = null; }
    try { met = Ar.metrics(cfgId); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const pick = (o, ks, d) => { for (const k of ks) { const v = o ? k.split('.').reduce((a, p) => (a == null ? a : a[p]), o) : undefined; if (Number.isFinite(v)) return v; } return d; };
    const g0 = pick(met, ['gamma'], pick(cfg, ['gamma', 'discount'], 0.99)), l0 = pick(met, ['lambda', 'gaeLambda', 'lam'], pick(cfg, ['lambda', 'gaeLambda', 'lam', 'lmbda'], 0.95));
    const GAMMAS = [0.9, 0.99, 1]; if (GAMMAS.indexOf(g0) < 0) { GAMMAS.push(g0); GAMMAS.sort((a, b) => a - b); }
    const num = (v, d) => (Number.isFinite(+v) && v != null && v !== '' ? +v : d);
    const state = {
      gamma: GAMMAS.indexOf(+params.gamma) >= 0 ? +params.gamma : g0,
      lam: Math.max(0, Math.min(1, num(params.lambda, l0))),
      t: Math.max(0, Math.min(T - 1, Math.round(num(params.t, 3)))),
      end: params.end === 'cut' ? 'cut' : 'terminal',
    };

    const wrap = V.html('div', { class: 'viz viz-gae' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const all = [];
    const grp = (lab, keep) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab, style: keep ? 'text-transform:none' : null }, g); return g; };
    const chips = (g, vals, key, label) => vals.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._k = key; b._v = v; all.push(b); });
    chips(grp('γ', true), GAMMAS, 'gamma', (v) => String(v) + (v === g0 ? ' (config)' : ''));
    chips(grp('Fin del rollout'), ['terminal', 'cut'], 'end', (v) => (v === 'terminal' ? 'terminal' : 'corte (bootstrap)'));
    const slider = (label, min, max, stp, aria, onIn) => {
      const g = V.html('label', { class: 'viz-ctl viz-pc-sl' }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label, style: 'text-transform:none' }, g);
      const inp = V.html('input', { type: 'range', min, max, step: stp, 'aria-label': aria }, g);
      const o = V.html('output', { class: 'viz-pc-out' }, g);
      inp.addEventListener('input', () => { onIn(+inp.value); draw(); });
      return { inp, o };
    };
    const sL = slider('λ', 0, 1, 0.01, 'λ de GAE (0 = TD de un paso, 1 = Monte Carlo)', (v) => { state.lam = v; });
    const sT = slider('Paso t', 0, T - 1, 1, 'Paso t cuya ventaja se detalla (0 a ' + (T - 1) + ')', (v) => { state.t = v; });
    const bL = V.html('button', { type: 'button', class: 'viz-chip', text: 'λ de la config (' + l0 + ')' }, ctl);
    bL.addEventListener('click', () => { state.lam = l0; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-gae-stage', tabindex: 0, role: 'group', 'aria-label': 'GAE en un episodio de juguete. Flechas izquierda y derecha: paso t; arriba y abajo: λ ± 0.05; Inicio: λ = 0; Fin: λ = 1' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      const { gamma, lam } = state;
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      sL.inp.value = lam; sL.o.textContent = lam.toFixed(2);
      sT.inp.value = state.t; sT.o.textContent = 't = ' + state.t;
      const ep = episode(gamma, state.end, 1506);
      const d = deltas(ep, gamma), Ar_ = gaeRecursive(d, gamma, lam), Ac = gaeClosed(d, gamma, lam);
      const maxDiff = Math.max(...Ar_.map((a, i) => Math.abs(a - Ac[i])));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(520, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'Â_t = Σ_l (γλ)ˡ δ_{t+l}' : 'GAE: δ_t = r_t + γV(s_{t+1}) − V(s_t)  ·  Â_t = δ_t + γλ·Â_{t+1} = Σ_l (γλ)ˡ δ_{t+l}', 'viz-t');
      t(svg, 8, 29, 'γ = ' + gamma + ' · λ = ' + lam.toFixed(2) + ' · episodio de ' + T + ' pasos (' + (state.end === 'cut' ? 'el rollout se corta: bootstrap con V(s_T)' : 'termina: V(s_T) = 0') + ')', 'viz-s');

      // ---- panel 1: recompensas y valores
      const x0 = 44, pw = W - 56, slot = pw / (T + 1);
      const X = (i) => x0 + slot * (i + 0.5);
      const y1 = 52, h1 = narrow ? 110 : 120;
      const vals1 = ep.r.concat(ep.v, ep.vStar);
      let lo1 = Math.min(0, ...vals1), hi1 = Math.max(...vals1); const p1 = (hi1 - lo1) * 0.08; lo1 -= p1; hi1 += p1;
      const Y1 = (v) => y1 + h1 - h1 * (v - lo1) / (hi1 - lo1);
      t(svg, x0, y1 - 6, 'recompensa r_t (barras) · V(s_t) del crítico (línea) · V*(s_t) verdadero (punteada)', 'viz-n');
      V.svg('rect', { x: x0, y: y1, width: r1(pw), height: h1, class: 'viz-pc-bg' }, svg);
      V.svg('path', { d: 'M' + x0 + ' ' + r1(Y1(0)) + 'H' + r1(x0 + pw), class: 'viz-pc-axis' }, svg);
      const bw = Math.max(4, slot * 0.5);
      ep.r.forEach((rv, i) => V.svg('rect', { x: r1(X(i) - bw / 2), y: r1(Math.min(Y1(0), Y1(rv))), width: r1(bw), height: r1(Math.max(1, Math.abs(Y1(rv) - Y1(0)))), class: 'viz-gae-r' + (i === state.t ? ' is-sel' : '') }, svg));
      const line = (arr, cls, n) => { let dd = ''; for (let i = 0; i < n; i++) dd += (i ? 'L' : 'M') + r1(X(i)) + ' ' + r1(Y1(arr[i])); V.svg('path', { d: dd, class: cls }, svg); };
      line(ep.vStar, 'viz-gae-vs', T + 1);
      line(ep.v, 'viz-gae-v', T + 1);
      ep.v.forEach((v, i) => { if (i <= T) V.svg('circle', { cx: r1(X(i)), cy: r1(Y1(v)), r: 2.6, class: 'viz-gae-vd' + (i === T && state.end === 'cut' ? ' is-boot' : '') }, svg); });
      t(svg, X(T), y1 + h1 - 4, state.end === 'cut' ? 's_T: bootstrap' : 's_T terminal', 'viz-s', 'middle');
      [0, 5, 10, 15].forEach((i) => t(svg, X(i), y1 + h1 + 13, String(i), 'viz-s', 'middle'));

      // ---- panel 2: δ_t y Â_t, con los pesos (γλ)^l del paso elegido
      const y2 = y1 + h1 + 44, h2 = narrow ? 130 : 140;
      const vals2 = d.concat(Ar_);
      let lo2 = Math.min(0, ...vals2), hi2 = Math.max(0, ...vals2); const p2 = (hi2 - lo2) * 0.1; lo2 -= p2; hi2 += p2;
      const Y2 = (v) => y2 + h2 - h2 * (v - lo2) / (hi2 - lo2);
      t(svg, x0, y2 - 6, narrow ? 'δ_t (delgadas) · Â_t (gruesas) · pesos de Â_' + state.t : 'δ_t (barras delgadas) · Â_t (barras gruesas) · en sombra: el peso (γλ)ˡ de cada δ futuro en Â_' + state.t, 'viz-n');
      V.svg('rect', { x: x0, y: y2, width: r1(pw), height: h2, class: 'viz-pc-bg' }, svg);
      // pesos (γλ)^l desde t: sombra de alto proporcional
      for (let l = 0; state.t + l < T; l++) {
        const w = Math.pow(gamma * lam, l);
        if (w < 0.004 && l > 0) break;
        const hh = h2 * w;
        V.svg('rect', { x: r1(X(state.t + l) - slot / 2), y: r1(y2 + h2 - hh), width: r1(slot), height: r1(hh), class: 'viz-gae-w' }, svg);
      }
      V.svg('path', { d: 'M' + x0 + ' ' + r1(Y2(0)) + 'H' + r1(x0 + pw), class: 'viz-pc-axis' }, svg);
      d.forEach((dv, i) => V.svg('rect', { x: r1(X(i) - bw * 0.65), y: r1(Math.min(Y2(0), Y2(dv))), width: r1(Math.max(2, bw * 0.3)), height: r1(Math.max(1, Math.abs(Y2(dv) - Y2(0)))), class: 'viz-gae-d' }, svg));
      Ar_.forEach((av, i) => V.svg('rect', { x: r1(X(i) - bw * 0.25), y: r1(Math.min(Y2(0), Y2(av))), width: r1(bw * 0.7), height: r1(Math.max(1, Math.abs(Y2(av) - Y2(0)))), class: 'viz-gae-a' + (i === state.t ? ' is-sel' : '') }, svg));
      [0, 5, 10, 15].forEach((i) => t(svg, X(i), y2 + h2 + 13, String(i), 'viz-s', 'middle'));
      t(svg, x0 + pw, y2 + h2 + 13, 't', 'viz-n', 'end');

      // ---- panel 3: sesgo² y varianza de Â_t en función de λ (forma cerrada)
      const y3 = y2 + h2 + 46, h3 = narrow ? 100 : 110, w3 = narrow ? pw : Math.min(pw, 560);
      const N = 100, bvs = [];
      for (let i = 0; i <= N; i++) { const L = i / N; const bv = biasVar(ep, gamma, L, state.t); bvs.push({ L, b2: bv.bias * bv.bias, v: bv.variance }); }
      const hi3 = Math.max(...bvs.map((o) => Math.max(o.b2, o.v, o.b2 + o.v))) * 1.08 || 1;
      const X3 = (L) => x0 + w3 * L, Y3 = (v) => y3 + h3 - h3 * v / hi3;
      t(svg, x0, y3 - 6, narrow ? 'Â_' + state.t + ': sesgo² y varianza vs λ' : 'Â_' + state.t + ' en función de λ (forma cerrada): sesgo² por el error del crítico, varianza por el ruido de las recompensas', 'viz-n');
      V.svg('rect', { x: x0, y: y3, width: r1(w3), height: h3, class: 'viz-pc-bg' }, svg);
      const curve = (f, cls) => { let dd = ''; bvs.forEach((o, i) => { dd += (i ? 'L' : 'M') + r1(X3(o.L)) + ' ' + r1(Y3(f(o))); }); V.svg('path', { d: dd, class: cls }, svg); };
      curve((o) => o.b2, 'viz-gae-bias');
      curve((o) => o.v, 'viz-gae-var');
      curve((o) => o.b2 + o.v, 'viz-gae-mse');
      V.svg('path', { d: 'M' + r1(X3(lam)) + ' ' + r1(y3) + 'V' + r1(y3 + h3), class: 'viz-pc-cur' }, svg);
      [0, 0.5, 1].forEach((v) => t(svg, X3(v), y3 + h3 + 13, String(v), 'viz-s', 'middle'));
      t(svg, X3(0), y3 + h3 + 26, 'TD(0)', 'viz-s', 'middle'); t(svg, X3(1), y3 + h3 + 26, 'Monte Carlo', 'viz-s', 'end');
      t(svg, x0 + w3 / 2, y3 + h3 + 26, 'λ', 'viz-n', 'middle');
      // leyenda (de todos los paneles)
      let ly = y3 + h3 + 50, lx = 8;
      const leg = [['rect', 'viz-gae-r', 'r_t'], ['line', 'viz-gae-v', 'V (crítico)'], ['line', 'viz-gae-vs', 'V* (verdadero)'], ['rect', 'viz-gae-d', 'δ_t'], ['rect', 'viz-gae-a', 'Â_t'], ['rect', 'viz-gae-w', '(γλ)ˡ'], ['line', 'viz-gae-bias', 'sesgo²'], ['line', 'viz-gae-var', 'varianza'], ['line', 'viz-gae-mse', 'sesgo² + varianza']];
      if (!narrow) { lx = x0 + w3 + 24; ly = y3 + 10; }
      leg.forEach(([k, cls, s]) => {
        const iw = 26 + s.length * 6.6 + 12;
        if (narrow) { if (lx > 8 && lx + iw > W - 8) { lx = 8; ly += 16; } }
        if (k === 'rect') V.svg('rect', { x: lx, y: ly - 10, width: 14, height: 10, class: cls }, svg);
        else V.svg('path', { d: 'M' + lx + ' ' + (ly - 4) + 'h18', class: cls }, svg);
        t(svg, lx + 24, ly, s, 'viz-s');
        if (narrow) lx += iw; else ly += 15;
      });
      const H2 = narrow ? ly + 12 : Math.max(y3 + h3 + 34, ly);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(H2));

      // ---- lecturas: Â_t por las dos vías y los casos λ = 0 y λ = 1
      const st = state.t, bv = biasVar(ep, gamma, lam, st);
      let G = 0, gk = 1; for (let k = st; k < T; k++) { G += gk * ep.r[k]; gk *= gamma; }
      const boot = ep.done ? 0 : Math.pow(gamma, T - st) * ep.v[T];
      svg.setAttribute('aria-label', 'Con γ = ' + gamma + ' y λ = ' + lam.toFixed(2) + ': Â_' + st + ' = ' + f3(Ar_[st]) + ' (recursión) y ' + f3(Ac[st]) + ' (forma cerrada); sesgo ' + f3(bv.bias) + ', varianza ' + f3(bv.variance) + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('δ_' + st + ' =', f3(d[st]));
      kv('Â_' + st + ' recursión =', f3(Ar_[st]));
      kv('forma cerrada =', f3(Ac[st]) + ' (máx |dif| en los ' + T + ' pasos: ' + (maxDiff === 0 ? '0' : maxDiff.toExponential(1)) + ')');
      if (lam === 0) kv('λ = 0:', 'Â_' + st + ' = δ_' + st + ' ✓');
      if (lam === 1) kv('λ = 1: G_' + st + (ep.done ? '' : ' + γ^{T−t}V(s_T)') + ' − V(s_' + st + ') =', f3(G + boot - ep.v[st]) + ' ✓');
      kv('R_' + st + ' = Â + V (objetivo del crítico) =', f3(Ar_[st] + ep.v[st]));
      kv('sesgo =', f3(bv.bias));
      kv('varianza =', f3(bv.variance));
      kv('config ' + ((run && run.label) || cfgId) + ':', 'γ = ' + g0 + ', λ = ' + l0);
      note.innerHTML = sub('λ elige cuánto confiar en el crítico. Con λ = 0, Â_t = δ_t: un paso de recompensa real y el resto lo pone V(s_{t+1}); poca varianza, pero si el crítico se equivoca, Â hereda su error (sesgo γ·e_{t+1}). Con λ = 1 es el retorno Monte Carlo menos V(s_t): sin sesgo si el episodio termina (el −V(s_t) es línea de base: no sesga el gradiente), pero suma el ruido de todas las recompensas futuras. Los valores típicos (λ = 0.95, γ = 0.99) quedan cerca del mínimo de la suma. Si el rollout se corta sin terminar (lo normal con horizontes fijos de 2048 o 24 pasos), el último δ usa V(s_T) del crítico: hasta λ = 1 queda ese sesgo. Juguete: transiciones deterministas, recompensas con ruido σ = ' + SIG_R + ' y un crítico con error inventado; la recursión y la forma cerrada son las mismas que en CleanRL o rsl&#95;rl.');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.t = Math.max(0, Math.min(T - 1, state.t + (k === 'ArrowRight' ? 1 : -1))); draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); state.lam = Math.max(0, Math.min(1, Math.round((state.lam + (k === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100)); draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.lam = 0; draw(); }
      else if (k === 'End') { ev.preventDefault(); state.lam = 1; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.gae = { episode, deltas, gaeRecursive, gaeClosed, biasVar, T };
    ATLAS.Viz.register('gae', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
