/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/noise-schedule.js
   Visualización "noise-schedule" (SPEC §7.8, §20.4): el proceso hacia adelante de la difusión.
   x_t = √ᾱ_t · x₀ + √(1 − ᾱ_t) · ε, con ᾱ_t = ∏_{s ≤ t} (1 − β_s).
   - Arriba: una imagen sintética x₀ (procedural, 40×40 RGB, "ilustrativo"), el ruido ε (semilla fija) y x_t para el t del
     deslizador, con los dos coeficientes como barras (señal y ruido).
   - Abajo: las curvas ᾱ_t y log₁₀ SNR(t) = log₁₀(ᾱ_t / (1 − ᾱ_t)) para t = 0…T−1, con el t actual marcado.
   Lo NO ilustrativo: la agenda de Stable Diffusion sale de la config del calculador (β inicial, β final, T de
   entrenamiento, "scaled linear"); la agenda lineal de DDPM (Ho et al. 2020), de la config de DiT del calculador (DiT la usa).
   Si una de las dos configs no trae β, se muestra solo la otra.
   En SD se ruidea el latente 64×64×4 del VAE, no los píxeles: la imagen es solo para verlo (lo dice la nota).
   params: { config:'sd15-unet', linear:'dit-xl2-256', t:500, sched:'sd'|'ddpm' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const N = 40;   // lado de la imagen sintética (píxeles)

  // Imagen procedural (valores 0…1 por canal): cielo, sol, montaña, pasto y una casa. Sin imágenes externas.
  function sceneRGB() {
    const img = new Float32Array(N * N * 3);
    const put = (x, y, c) => { const i = (y * N + x) * 3; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      let c = [0.55 + 0.25 * v, 0.72 + 0.12 * v, 0.92];                                       // cielo
      if (Math.hypot(u - 0.76, v - 0.22) < 0.1) c = [0.97, 0.80, 0.30];                       // sol
      const ridge = v > 0.68 - 0.36 * Math.max(0, 1 - Math.abs(u - 0.32) / 0.3) && v > 0.42;  // montaña
      if (ridge) c = [0.45, 0.52, 0.62];
      if (ridge && v < 0.5 && Math.abs(u - 0.32) < 0.07) c = [0.94, 0.95, 0.97];               // nieve
      if (v > 0.72 + 0.04 * Math.sin(u * 6)) c = [0.42, 0.62, 0.32];                          // pasto
      if (u > 0.56 && u < 0.76 && v > 0.62 && v < 0.82) c = [0.79, 0.42, 0.30];               // casa
      if (v > 0.5 && v <= 0.62 && Math.abs(u - 0.66) < (v - 0.5) * 0.95) c = [0.55, 0.23, 0.17];   // techo
      if (u > 0.63 && u < 0.69 && v > 0.71 && v < 0.82) c = [0.30, 0.20, 0.14];               // puerta
      put(x, y, c);
    }
    return img;
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, D = V.diff;
    const cfgId = params.config || 'sd15-unet';
    const sd = D.scheduleOf(cfgId);
    // DDPM (Ho et al. 2020, §4): β lineal; los números, de la config de DiT del calculador (la misma agenda)
    const ddpm = D.scheduleOf(params.linear || 'dit-xl2-256');
    if (!sd && !ddpm) { const d = V.html('div', { class: 'ad-error', role: 'alert', text: 'El calculador no trae la agenda de ruido (β) de ' + cfgId + '.' }, el); return { destroy() { d.remove(); } }; }
    const scheds = { sd, ddpm };
    const fmt = (A && A.fmt) || { int: (n) => String(n) };
    const state = { sched: (params.sched === 'ddpm' && ddpm) || !sd ? 'ddpm' : 'sd', t: Number.isFinite(+params.t) ? +params.t : 500 };
    const x0 = sceneRGB();
    const rng = V.rng(20221);
    const eps = new Float32Array(N * N * 3);
    for (let i = 0; i < eps.length; i++) eps[i] = rng.normal();

    const wrap = V.html('div', { class: 'viz viz-ns' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Agenda de ruido' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Agenda' }, g1);
    const chips = [];
    if (sd) chips.push(['sd', 'Stable Diffusion (calculador)']);
    if (ddpm) chips.push(['ddpm', 'Lineal (DDPM, DiT)']);
    const sBtns = chips.map(([k, text]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text }, g1); b.addEventListener('click', () => { state.sched = k; draw(); }); b._k = k; return b; });
    const g2 = V.html('label', { class: 'viz-ctl viz-ns-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Paso t' }, g2);
    const inp = V.html('input', { type: 'range', min: 0, max: 999, step: 1, 'aria-label': 'Paso de ruido t (0 = la imagen, 999 = casi solo ruido)' }, g2);
    const outT = V.html('output', { class: 'viz-ns-out' }, g2);
    inp.addEventListener('input', () => { state.t = +inp.value; draw(); });
    const stage = V.html('div', { class: 'viz-stage viz-ns-stage', tabindex: 0, role: 'group', 'aria-label': 'Ruido a lo largo de t. Flechas: ±10 pasos; Re Pág y Av Pág: ±100; Inicio y Fin: t = 0 y t = T − 1' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);
    const cv = root.document.createElement('canvas');
    cv.width = N; cv.height = N;

    function dataURL(arr, scale) {
      const c2 = cv.getContext('2d');
      const im = c2.createImageData(N, N);
      for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) {
        const v = scale(arr, i * 3 + k);
        im.data[i * 4 + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
      for (let i = 0; i < N * N; i++) im.data[i * 4 + 3] = 255;
      c2.putImageData(im, 0, 0);
      return cv.toDataURL();
    }

    let lastNarrow = null;
    function draw() {
      sBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.sched)));
      const S = scheds[state.sched];
      const T = S.T;
      state.t = Math.max(0, Math.min(T - 1, Math.round(state.t)));
      inp.max = T - 1; inp.value = state.t; outT.textContent = 't = ' + state.t;
      const ab = S.abar[state.t], sa = Math.sqrt(ab), sn = Math.sqrt(1 - ab), snr = ab / (1 - ab);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(440, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const tx = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); if (V.rich) V.rich(e, s); else e.textContent = s; return e; };
      tx(svg, 8, 15, narrow ? 'Ruido hacia adelante: x_t = √ᾱ·x₀ + √(1−ᾱ)·ε' : 'Proceso hacia adelante: x_t = √ᾱ_t · x₀ + √(1 − ᾱ_t) · ε   (' + (state.sched === 'sd' ? S.label : 'lineal de DDPM, config ' + S.label) + ', del calculador' + ')', 'viz-t');
      tx(svg, 8, 29, narrow ? 'ilustrativo: en SD se ruidea el latente' : 'imagen ilustrativa (en SD se ruidea el latente, no los píxeles)', 'viz-s');
      // ---- fila de imágenes: x₀ · ε · x_t (en angosto, tres más chicas)
      const isz = narrow ? Math.floor((W - 16 - 2 * 18) / 3) : 150, iy = 50, gap = narrow ? 18 : 34;
      const imgs = [
        { lab: 'x₀ (la imagen)', url: dataURL(x0, (a, j) => a[j]) },
        { lab: 'ε ~ N(0, I)', url: dataURL(eps, (a, j) => 0.5 + a[j] / 6) },
        { lab: 'x_t (t = ' + state.t + ')', url: dataURL(x0, (a, j) => { const v = sa * (2 * a[j] - 1) + sn * eps[j]; return (v + 1) / 2; }) },
      ];
      imgs.forEach((im, k) => {
        const x = 8 + k * (isz + gap);
        tx(svg, x + isz / 2, iy - 6, im.lab, k === 2 ? 'viz-n' : 'viz-s', 'middle');
        V.svg('image', { href: im.url, x, y: iy, width: isz, height: isz, preserveAspectRatio: 'none', class: 'viz-ns-img' }, svg);
        V.svg('rect', { x, y: iy, width: isz, height: isz, class: 'viz-ns-frame' + (k === 2 ? ' is-on' : '') }, svg);
        if (k < 2) tx(svg, x + isz + gap / 2, iy + isz / 2 + 5, k === 0 ? '+' : '→', 'viz-ns-op', 'middle');
      });
      // coeficientes: señal √ᾱ y ruido √(1 − ᾱ)
      let y = iy + isz + 22;
      const bw = narrow ? W - 16 - 110 : 3 * isz + 2 * gap - 110;
      [['señal √ᾱ_t', sa, 'is-sig'], ['ruido √(1−ᾱ_t)', sn, 'is-noise']].forEach(([lab, v, cls], k) => {
        const yy = y + k * 20;
        tx(svg, 8, yy + 10, lab, 'viz-s');
        V.svg('rect', { x: 110, y: yy, width: r1(bw), height: 12, class: 'viz-ns-track' }, svg);
        V.svg('rect', { x: 110, y: yy, width: r1(Math.max(0.8, bw * v)), height: 12, class: 'viz-ns-bar ' + cls }, svg);
        tx(svg, 110 + bw - 4, yy + 10, v.toFixed(3), 'viz-ns-val', 'end');
      });
      y += 52;
      // ---- curvas: ᾱ_t y log₁₀ SNR (a la derecha en ancho; abajo en angosto)
      const cx0 = narrow ? 44 : 3 * isz + 2 * gap + 70, cwid = narrow ? W - 16 - 40 : W - cx0 - 14;
      let cy = narrow ? y + 8 : iy;
      const chH = narrow ? 92 : 96;
      const X = (t) => cx0 + cwid * t / (T - 1);
      const curve = (title, f, lo, hi, ticks, cls, fmtT) => {
        tx(svg, cx0 - (narrow ? 36 : 40), cy - 6, title, 'viz-s');
        V.svg('rect', { x: cx0, y: cy, width: r1(cwid), height: chH, class: 'viz-rl-box' }, svg);
        const Y = (v) => cy + chH - chH * (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo);
        ticks.forEach((v) => { tx(svg, cx0 - 4, Y(v) + 4, fmtT(v), 'viz-s', 'end'); if (v > lo && v < hi) V.svg('path', { d: 'M' + cx0 + ' ' + r1(Y(v)) + 'H' + r1(cx0 + cwid), class: 'viz-rl-grid' }, svg); });
        // la otra agenda, tenue (comparación)
        Object.keys(scheds).forEach((k) => {
          const Sk = scheds[k]; if (!Sk) return;
          let d = '';
          for (let t = 0; t < Sk.T; t += 4) d += (t ? 'L' : 'M') + r1(cx0 + cwid * t / (Sk.T - 1)) + ' ' + r1(Y(f(Sk.abar[t])));
          d += 'L' + r1(cx0 + cwid) + ' ' + r1(Y(f(Sk.abar[Sk.T - 1])));
          V.svg('path', { d, class: 'viz-ns-curve ' + cls + (k === state.sched ? '' : ' is-other') }, svg);
        });
        const yv = Y(f(ab));
        V.svg('path', { d: 'M' + r1(X(state.t)) + ' ' + cy + 'V' + (cy + chH), class: 'viz-rope-cur' }, svg);
        V.svg('circle', { cx: r1(X(state.t)), cy: r1(yv), r: 4.5, class: 'viz-rope-dot' }, svg);
        cy += chH + 30;
        return Y;
      };
      curve('ᾱ_t (señal que queda)', (a) => a, 0, 1, [0, 0.5, 1], 'is-abar', (v) => String(v));
      curve('log₁₀ SNR = log₁₀ ᾱ/(1−ᾱ)', (a) => Math.log10(a / (1 - a)), -5, 4, [-4, -2, 0, 2, 4], 'is-snr', (v) => (v > 0 ? '+' : '') + v);
      // eje t (debajo de la última curva)
      [0, Math.round((T - 1) / 2), T - 1].forEach((t) => tx(svg, X(t), cy - 30 + 14, 't = ' + t, 'viz-s', t === 0 ? 'start' : t === T - 1 ? 'end' : 'middle'));
      // leyenda de las curvas
      const ly = cy - 4;
      const other = state.sched === 'sd' ? (ddpm ? 'lineal (DDPM)' : '') : sd ? 'Stable Diffusion' : '';
      V.svg('path', { d: 'M' + cx0 + ' ' + r1(ly - 4) + 'h22', class: 'viz-ns-curve is-abar' }, svg);
      tx(svg, cx0 + 28, ly, (state.sched === 'sd' ? 'SD (calculador)' : 'lineal (calculador)'), 'viz-s');
      if (other) { V.svg('path', { d: 'M' + cx0 + ' ' + r1(ly + 10) + 'h22', class: 'viz-ns-curve is-abar is-other' }, svg); tx(svg, cx0 + 28, ly + 14, other + ' (tenue)', 'viz-s'); }
      const Hh = Math.max(y, ly + 24);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(Hh));
      svg.setAttribute('aria-label', 'Paso t = ' + state.t + ' de ' + T + ': ᾱ = ' + (ab < 1e-3 ? ab.toExponential(1) : ab.toFixed(4)) + ', señal √ᾱ = ' + sa.toFixed(3) + ', ruido √(1−ᾱ) = ' + sn.toFixed(3) + ', SNR = ' + fmtSnr(snr) + '.');
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      kv('t:', state.t + ' / ' + (T - 1));
      kv('ᾱ<sub>t</sub>:', ab < 1e-3 ? ab.toExponential(1) : ab.toFixed(4));
      kv('√ᾱ<sub>t</sub>:', sa.toFixed(3));
      kv('√(1 − ᾱ<sub>t</sub>):', sn.toFixed(3));
      kv('SNR:', fmtSnr(snr));
      const S2 = scheds.sd;
      note.innerHTML = (S2 ? 'Stable Diffusion (config del calculador): β de ' + S2.b0 + ' a ' + S2.b1 + ' en T = ' + fmt.int(S2.T) + ' pasos, "scaled linear" (lineal en √β). Al final queda ᾱ<sub>T−1</sub> = ' + S2.abar[S2.T - 1].toFixed(4) + ': la SNR no llega a 0 (Lin et al. 2023, arXiv:2305.08891, lo señalan como defecto). ' : '') +
        (ddpm ? 'La agenda lineal de DDPM (Ho et al. 2020, sobre píxeles; DiT la usa sobre el latente: config ' + ddpm.label + ') va de β = ' + ddpm.b0 + ' a ' + ddpm.b1 + ' y termina en ᾱ ≈ ' + ddpm.abar[ddpm.T - 1].toExponential(1) + '. ' : '') +
        'Entrenar es elegir un t al azar, ruidear así de un salto (sin recorrer los pasos anteriores) y pedirle a la red que adivine ε. La imagen es ilustrativa: en SD se ruidea el latente del VAE, no la imagen.';
    }
    function fmtSnr(s) { return s >= 100 ? Math.round(s).toString() : s >= 0.01 ? s.toFixed(3) : s.toExponential(1); }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, T = scheds[state.sched].T;
      const d = k === 'ArrowRight' || k === 'ArrowUp' ? 10 : k === 'ArrowLeft' || k === 'ArrowDown' ? -10 : k === 'PageUp' ? 100 : k === 'PageDown' ? -100 : null;
      if (k === 'Home') state.t = 0; else if (k === 'End') state.t = T - 1; else if (d != null) state.t += d; else return;
      ev.preventDefault();
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('noise-schedule', render);
})(typeof window !== 'undefined' ? window : globalThis);
