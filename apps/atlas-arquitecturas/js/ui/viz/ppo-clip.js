/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/ppo-clip.js
   Visualización "ppo-clip" (SPEC §7.8, §27.3): el objetivo recortado de PPO (Schulman et al. 2017, arXiv:1707.06347, ec. 7)
       L^CLIP(r) = min( r·A, clip(r, 1 − ε, 1 + ε)·A ),   r = π_θ(a|s) / π_θ_old(a|s)
   dibujado como en la Fig. 1 del paper: un panel con A > 0 y otro con A < 0 (A = ±1), la banda [1 − ε, 1 + ε] y la zona
   donde ∂L/∂r = 0 (exacto, por tramos):
       A > 0:  L = A·min(r, 1 + ε)       ∂L/∂r = A si r < 1 + ε;  0 si r > 1 + ε
       A < 0:  L = A·max(r, 1 − ε)       ∂L/∂r = A si r > 1 − ε;  0 si r < 1 − ε
   (en r = 1 ± ε exacto la derivada lateral cambia: se toma el valor de dentro de la banda, convención para un conjunto de
   medida cero). Es la cota pesimista: se ignora el cambio de r cuando MEJORA el objetivo más allá de 1 ± ε, pero no
   cuando lo empeora.
   Abajo, un minibatch ILUSTRATIVO de n muestras (r_i, Â_i): Â normalizada por minibatch (como CleanRL / rsl_rl) y la
   dispersión de r crece con la época (en la 1.ª época del 1.er minibatch r = 1 exacto: θ = θ_old). Se cuentan
   clipfrac = mean(|r − 1| > ε) (la métrica que registra CleanRL) y la fracción con gradiente CERO (solo la mitad de esos:
   los que el recorte "protege" según el signo de Â).
   ε, épocas y tamaño de minibatch salen del calculador (ATLAS.Arch.run / metrics de la config; ppo-mujoco por omisión).
   params: { config:'ppo-mujoco', eps:<ε>, r:1.3, epoch:3 }
   Puro (sin DOM) para tests: ATLAS.Viz.ppo = { clip, surrogate, dSurrogate, batch }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9θ]{1,3}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const f2 = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)).replace('-', '−');
  const R_MAX = 2;

  // ---- matemática exacta (puro)
  const clip = (r, eps) => Math.min(1 + eps, Math.max(1 - eps, r));
  const surrogate = (r, A, eps) => Math.min(r * A, clip(r, eps) * A);
  // ∂L/∂r por tramos; en los bordes exactos, el valor de dentro de la banda
  function dSurrogate(r, A, eps) {
    if (A === 0) return 0;
    if (A > 0) return r <= 1 + eps ? A : 0;
    return r >= 1 - eps ? A : 0;
  }
  // minibatch ilustrativo: r_i = exp(σ_k z_i), Â normalizada (media 0, desvío 1). σ_k = 0.07·(k − 1): época 1 → r = 1
  function batch(n, epoch, seed) {
    const R = ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(seed || 1707) : Math.random;
    const zs = [], as = [];
    for (let i = 0; i < n; i++) { zs.push(R.normal ? R.normal() : 0); as.push(R.normal ? R.normal() : 0); }
    const m = as.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(as.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, n - 1)) || 1;
    const sig = 0.07 * Math.max(0, epoch - 1);
    return zs.map((z, i) => ({ r: Math.exp(sig * z), A: (as[i] - m) / (sd + 1e-8) }));
  }

  function render(el, params) {
    const V = ATLAS.Viz, Ar = ATLAS.Arch;
    const cfgId = params.config || 'ppo-mujoco';
    let run = null, met = null;
    try { run = Ar.run(cfgId); } catch (e) { run = null; }
    try { met = Ar.metrics(cfgId); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const pick = (o, ks, d) => { for (const k of ks) { const v = o ? k.split('.').reduce((a, p) => (a == null ? a : a[p]), o) : undefined; if (Number.isFinite(v)) return v; } return d; };
    const eps0 = pick(met, ['clipEps', 'clipRange'], pick(cfg, ['clipEps', 'clip', 'eps', 'epsilon', 'clipRange'], 0.2));
    const K = Math.max(1, Math.round(pick(met, ['epochs'], pick(cfg, ['epochs', 'K', 'nEpochs'], 10))));
    const mb = Math.max(4, Math.round(pick(met, ['minibatchSize', 'minibatch'], pick(cfg, ['minibatchSize', 'minibatch', 'mbSize'], 64))));
    const nShow = Math.min(mb, 128);
    const EPSS = [0.1, 0.2, 0.3];
    if (EPSS.indexOf(eps0) < 0) { EPSS.push(eps0); EPSS.sort((a, b) => a - b); }
    const state = {
      eps: EPSS.indexOf(+params.eps) >= 0 ? +params.eps : eps0,
      r: Number.isFinite(+params.r) && params.r != null && params.r !== '' ? Math.max(0, Math.min(R_MAX, +params.r)) : 1.3,
      epoch: Number.isFinite(+params.epoch) && params.epoch != null && params.epoch !== '' ? Math.max(1, Math.min(K, Math.round(+params.epoch))) : Math.min(K, 3),
    };

    const wrap = V.html('div', { class: 'viz viz-pc' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const gE = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'ε (rango del recorte)' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'ε', style: 'text-transform:none' }, gE);
    const chipsE = EPSS.map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: String(v) + (v === eps0 ? ' (config)' : '') }, gE); b.addEventListener('click', () => { state.eps = v; draw(); }); b._v = v; return b; });
    const slider = (label, min, max, stp, aria, onIn) => {
      const g = V.html('label', { class: 'viz-ctl viz-pc-sl' }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label, style: 'text-transform:none' }, g);
      const inp = V.html('input', { type: 'range', min, max, step: stp, 'aria-label': aria }, g);
      const o = V.html('output', { class: 'viz-pc-out' }, g);
      inp.addEventListener('input', () => { onIn(+inp.value); draw(); });
      return { inp, o };
    };
    const sR = slider('r = π_θ / π_old', 0, R_MAX, 0.01, 'Cociente r entre la política nueva y la vieja (0 a 2)', (v) => { state.r = v; });
    const sK = slider('Época', 1, K, 1, 'Época sobre el mismo lote (1 a ' + K + '): con cada una, r se aleja más de 1', (v) => { state.epoch = v; });
    V.html('span', { class: 'viz-tag', text: 'minibatch ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-pc-stage', tabindex: 0, role: 'group', 'aria-label': 'Objetivo recortado de PPO. Flechas izquierda y derecha: mover r; arriba y abajo: cambiar ε; Inicio: r = 1' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      const eps = state.eps;
      chipsE.forEach((b) => b.setAttribute('aria-pressed', String(state.eps === b._v)));
      sR.inp.value = state.r; sR.o.textContent = state.r.toFixed(2);
      sK.inp.value = state.epoch; sK.o.textContent = state.epoch + ' / ' + K;
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(520, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'L_{CLIP} = min(r·A, clip(r, 1−ε, 1+ε)·A)' : 'Objetivo recortado de PPO: L_{CLIP}(r) = min(r·A, clip(r, 1 − ε, 1 + ε)·A), con r = π_θ(a|s) / π_{θ_old}(a|s)', 'viz-t');
      t(svg, 8, 29, 'ε = ' + eps + ' · A = +1 (izquierda) y A = −1 (derecha) · zona roja: ∂L/∂r = 0', 'viz-s');

      // ---- dos paneles: A = +1 y A = −1
      const pw = narrow ? W - 56 : (W - 120) / 2, ph = narrow ? 150 : 180;
      const panels = narrow ? [[44, 52], [44, 52 + ph + 64]] : [[44, 52], [44 + pw + 52, 52]];
      [1, -1].forEach((A, pi) => {
        const [x0, y0] = panels[pi];
        const lo = A > 0 ? -0.15 : -2.15, hi = A > 0 ? 2.15 : 0.15;
        const X = (r) => x0 + pw * r / R_MAX, Y = (v) => y0 + ph - ph * (v - lo) / (hi - lo);
        V.svg('rect', { x: r1(x0), y: r1(y0), width: r1(pw), height: ph, class: 'viz-pc-bg' }, svg);
        // banda de recorte y zona sin gradiente
        V.svg('rect', { x: r1(X(1 - eps)), y: r1(y0), width: r1(X(1 + eps) - X(1 - eps)), height: ph, class: 'viz-pc-band' }, svg);
        const z0 = A > 0 ? 1 + eps : 0, z1 = A > 0 ? R_MAX : 1 - eps;
        V.svg('rect', { x: r1(X(z0)), y: r1(y0), width: r1(X(z1) - X(z0)), height: ph, class: 'viz-pc-zero' }, svg);
        t(svg, (X(z0) + X(z1)) / 2, y0 + 14, '∂L/∂r = 0', 'viz-pc-zt', 'middle');
        // ejes
        V.svg('path', { d: 'M' + r1(x0) + ' ' + r1(Y(0)) + 'H' + r1(x0 + pw), class: 'viz-pc-axis' }, svg);
        V.svg('path', { d: 'M' + r1(X(1)) + ' ' + r1(y0) + 'V' + r1(y0 + ph), class: 'viz-pc-one' }, svg);
        [0, 0.5, 1, 1.5, 2].forEach((v) => t(svg, X(v), y0 + ph + 13, String(v), 'viz-s', 'middle'));
        [1 - eps, 1 + eps].forEach((v) => t(svg, X(v), y0 + ph + 26, v.toFixed(2), 'viz-pc-et', 'middle'));
        (A > 0 ? [0, 1, 2] : [0, -1, -2]).forEach((v) => t(svg, x0 - 5, Y(v) + 4, String(v).replace('-', '−'), 'viz-s', 'end'));
        t(svg, x0 + pw, y0 + ph + 26, 'r', 'viz-n', 'end');
        t(svg, x0, y0 - 6, A > 0 ? 'A > 0: la acción fue mejor de lo esperado' : 'A < 0: la acción fue peor de lo esperado', 'viz-n');
        // curvas: r·A (sin recortar), clip(r)·A y el mínimo (lo que se optimiza)
        const N = 200;
        const path = (f) => { let d = ''; for (let i = 0; i <= N; i++) { const r = R_MAX * i / N; d += (i ? 'L' : 'M') + r1(X(r)) + ' ' + r1(Y(f(r))); } return d; };
        V.svg('path', { d: path((r) => r * A), class: 'viz-pc-raw' }, svg);
        V.svg('path', { d: path((r) => clip(r, eps) * A), class: 'viz-pc-clip' }, svg);
        V.svg('path', { d: path((r) => surrogate(r, A, eps)), class: 'viz-pc-min' }, svg);
        // punto actual
        const L = surrogate(state.r, A, eps), g = dSurrogate(state.r, A, eps);
        V.svg('path', { d: 'M' + r1(X(state.r)) + ' ' + r1(y0) + 'V' + r1(y0 + ph), class: 'viz-pc-cur' }, svg);
        V.svg('circle', { cx: r1(X(state.r)), cy: r1(Y(L)), r: 5, class: 'viz-pc-pt' + (g === 0 ? ' is-zero' : '') }, svg);
        const lx = X(state.r) + (state.r > 1.45 ? -8 : 8);
        t(svg, lx, Y(L) + (A > 0 ? -9 : 17), 'L = ' + f2(L) + (g === 0 ? ' · grad 0' : ''), 'viz-pc-lab', state.r > 1.45 ? 'end' : null);
      });
      // leyenda de curvas
      let ly = (narrow ? panels[1][1] : panels[0][1]) + ph + 48, lx = 8;
      const leg = [['viz-pc-min', 'min(·): lo que se optimiza'], ['viz-pc-raw', 'r·A (sin recorte)'], ['viz-pc-clip', 'clip(r)·A'], ['band', 'banda 1 ± ε'], ['zero', 'gradiente cero']];
      leg.forEach(([c, s]) => {
        const iw = 26 + s.length * 6.4 + 14;
        if (lx > 8 && lx + iw > W - 8) { lx = 8; ly += 16; }
        if (c === 'band' || c === 'zero') V.svg('rect', { x: lx, y: ly - 10, width: 18, height: 10, class: c === 'band' ? 'viz-pc-band' : 'viz-pc-zero' }, svg);
        else V.svg('path', { d: 'M' + lx + ' ' + (ly - 4) + 'h18', class: c }, svg);
        t(svg, lx + 24, ly, s, 'viz-s');
        lx += iw;
      });

      // ---- el minibatch: n muestras (r_i, Â_i)
      const B = batch(nShow, state.epoch, 1707);
      const sy = ly + 34, sh = narrow ? 70 : 80, sx0 = 44, sw = W - 60;
      const SX = (r) => sx0 + sw * Math.min(R_MAX, r) / R_MAX, mid = sy + sh / 2;
      t(svg, 8, sy - 10, narrow ? 'Un minibatch de ' + nShow + ': r_i y el signo de Â_i' : 'Un minibatch de ' + nShow + ' muestras en la época ' + state.epoch + ': cada punto es (r_i, signo de Â_i); hueco = el recorte le quita el gradiente', 'viz-n');
      V.svg('rect', { x: sx0, y: r1(sy), width: r1(sw), height: sh, class: 'viz-pc-bg' }, svg);
      V.svg('rect', { x: r1(SX(1 - eps)), y: r1(sy), width: r1(SX(1 + eps) - SX(1 - eps)), height: sh, class: 'viz-pc-band' }, svg);
      V.svg('path', { d: 'M' + sx0 + ' ' + r1(mid) + 'H' + r1(sx0 + sw), class: 'viz-pc-axis' }, svg);
      V.svg('path', { d: 'M' + r1(SX(1)) + ' ' + r1(sy) + 'V' + r1(sy + sh), class: 'viz-pc-one' }, svg);
      t(svg, sx0 - 5, sy + 13, 'Â > 0', 'viz-s', 'end'); t(svg, sx0 - 5, sy + sh - 4, 'Â < 0', 'viz-s', 'end');
      [0, 0.5, 1, 1.5, 2].forEach((v) => t(svg, SX(v), sy + sh + 13, String(v), 'viz-s', 'middle'));
      let nClip = 0, nZero = 0;
      B.forEach((s, i) => {
        const outB = Math.abs(s.r - 1) > eps, zero = dSurrogate(s.r, s.A, eps) === 0;
        if (outB) nClip++;
        if (zero) nZero++;
        const yy = s.A >= 0 ? mid - 6 - Math.min(1, Math.abs(s.A) / 2.5) * (sh / 2 - 12) : mid + 6 + Math.min(1, Math.abs(s.A) / 2.5) * (sh / 2 - 12);
        const jit = ((i * 37) % 11 - 5) * 0.4;
        V.svg('circle', { cx: r1(SX(s.r)), cy: r1(yy + jit), r: 3.2, class: 'viz-pc-dot' + (s.A >= 0 ? ' is-pos' : ' is-neg') + (zero ? ' is-zero' : '') }, svg);
      });
      const H2 = sy + sh + 22;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(H2));
      const Lp = surrogate(state.r, 1, eps), Ln = surrogate(state.r, -1, eps);
      const gp = dSurrogate(state.r, 1, eps), gn = dSurrogate(state.r, -1, eps);
      svg.setAttribute('aria-label', 'Con ε = ' + eps + ' y r = ' + state.r.toFixed(2) + ': para A = +1, L = ' + f2(Lp) + ' y ∂L/∂r = ' + gp + '; para A = −1, L = ' + f2(Ln) + ' y ∂L/∂r = ' + gn + '. Minibatch en la época ' + state.epoch + ': clipfrac ' + Math.round(100 * nClip / nShow) + ' %, sin gradiente ' + Math.round(100 * nZero / nShow) + ' %.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('r =', state.r.toFixed(2) + (Math.abs(state.r - 1) > eps ? ' (fuera de 1 ± ε)' : ' (dentro de 1 ± ε)'));
      kv('A = +1:', 'L = ' + f2(Lp) + ', ∂L/∂r = ' + gp);
      kv('A = −1:', 'L = ' + f2(Ln) + ', ∂L/∂r = ' + String(gn).replace('-', '−'));
      kv('clipfrac (|r − 1| > ε):', Math.round(100 * nClip / nShow) + ' %');
      kv('sin gradiente:', Math.round(100 * nZero / nShow) + ' % del minibatch');
      kv('config ' + ((run && run.label) || cfgId) + ':', 'ε = ' + eps0 + ' · ' + K + ' épocas · minibatch ' + mb);
      note.innerHTML = sub('El mínimo es una cota pesimista: si la acción fue buena (A > 0), subir su probabilidad paga hasta r = 1 + ε y ahí el objetivo se aplana (gradiente 0: no hay incentivo para alejarse más); si fue mala (A < 0), bajarla paga hasta r = 1 − ε. Pero cuando el cambio EMPEORA el objetivo (A > 0 con r chico, A < 0 con r grande) el recorte no actúa: el gradiente sigue y corrige. Por eso, de las muestras fuera de la banda (clipfrac, lo que registra CleanRL), solo las que "ya ganaron" pierden su gradiente. El recorte no impide que r salga de la banda (tras varias épocas y minibatches, sale): solo quita el incentivo. Minibatch ilustrativo: Â normalizada por minibatch; la dispersión de r con la época es inventada (en la 1.ª época del 1.er minibatch r = 1 exacto).');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.r = Math.max(0, Math.min(R_MAX, Math.round((state.r + (k === 'ArrowRight' ? 0.05 : -0.05)) * 100) / 100)); draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); const i = Math.max(0, Math.min(EPSS.length - 1, EPSS.indexOf(state.eps) + (k === 'ArrowUp' ? 1 : -1))); state.eps = EPSS[i]; draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.r = 1; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.ppo = { clip, surrogate, dSurrogate, batch };
    ATLAS.Viz.register('ppo-clip', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
