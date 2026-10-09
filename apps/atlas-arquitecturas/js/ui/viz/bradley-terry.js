/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/bradley-terry.js
   Visualización "bradley-terry" (SPEC §7.8, §22.3): el modelo de recompensa de RLHF y su pérdida.
   Bradley–Terry (1952): P(y_w ≻ y_l | x) = σ(r(x, y_w) − r(x, y_l)). El modelo de recompensa (InstructGPT, Ouyang et al.
   2022, arXiv:2203.02155, §3.5) se entrena con −log σ(r_w − r_l) sobre los pares que eligieron los anotadores; Llama 2
   (Touvron et al. 2023, arXiv:2307.09288, §3.2.2) agrega un margen m según cuán clara fue la preferencia:
   −log σ(r_w − r_l − m).
   Interacción: las dos recompensas (deslizadores o flechas), el margen m y "sumar c a las dos" (la probabilidad no cambia:
   la recompensa solo está definida a menos de una constante; por eso se normaliza antes de PPO).
   Se ven: las dos recompensas en una recta, la curva σ(Δ − m) con el punto actual, la pérdida y el tamaño del gradiente
   σ(−(Δ − m)) (los pares ya bien ordenados casi no empujan). Todo es aritmética exacta sobre números elegidos (ilustrativo).
   params: { rw:1, rl:-0.5, m:0 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  // subíndices estilo TeX en el texto html (readout y nota): π_ref → π<sub>ref</sub>
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9θ]+)/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const softplus = (z) => (z > 30 ? z : Math.log1p(Math.exp(z)));
  const MARGINS = [0, 1, 3];
  const RMIN = -4, RMAX = 4, DMAX = 7;
  const f2 = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)).replace('-', '−');

  function render(el, params) {
    const V = ATLAS.Viz;
    const clampR = (v) => Math.max(RMIN, Math.min(RMAX, Math.round(v * 10) / 10));
    const state = { rw: clampR(Number.isFinite(+params.rw) ? +params.rw : 1), rl: clampR(Number.isFinite(+params.rl) ? +params.rl : -0.5), m: MARGINS.indexOf(+params.m) >= 0 ? +params.m : 0, c: 0 };

    const wrap = V.html('div', { class: 'viz viz-bt' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const slider = (lab, aria, key) => {
      const l = V.html('label', { class: 'viz-ctl viz-bt-sl' }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: lab }, l);
      const inp = V.html('input', { type: 'range', min: RMIN, max: RMAX, step: 0.1, 'aria-label': aria }, l);
      const o = V.html('output', { class: 'viz-bt-out' }, l);
      inp.addEventListener('input', () => { state[key] = clampR(+inp.value); draw(); });
      return { inp, o };
    };
    const sw = slider('r de la elegida', 'Recompensa de la respuesta elegida y_w', 'rw');
    const sl = slider('r de la rechazada', 'Recompensa de la respuesta rechazada y_l', 'rl');
    const gM = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Margen m (Llama 2)' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Margen m' }, gM);
    const mBtns = MARGINS.map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: String(v) }, gM); b.addEventListener('click', () => { state.m = v; draw(); }); b._v = v; return b; });
    const gC = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Desplazar las dos recompensas' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Sumar c a las dos' }, gC);
    const cBtns = [0, 2].map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'c = ' + v }, gC); b.addEventListener('click', () => { state.c = v; draw(); }); b._v = v; return b; });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-bt-stage', tabindex: 0, role: 'group', 'aria-label': 'Bradley–Terry. Flechas izquierda y derecha: recompensa de y_w; arriba y abajo: recompensa de y_l; M: margen' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      mBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.m)));
      cBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.c)));
      sw.inp.value = state.rw; sw.o.textContent = f2(state.rw);
      sl.inp.value = state.rl; sl.o.textContent = f2(state.rl);
      const rw = state.rw + state.c, rl = state.rl + state.c;
      const D = rw - rl, z = D - state.m, P = sig(z), loss = softplus(-z), grad = sig(-z);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'P(y_w ≻ y_l) = σ(r_w − r_l' + (state.m ? ' − m' : '') + ')' : 'Bradley–Terry: P(y_w ≻ y_l | x) = σ(r(x, y_w) − r(x, y_l)' + (state.m ? ' − m' : '') + '); pérdida del modelo de recompensa = −log P', 'viz-t');
      t(svg, 8, 29, narrow ? 'recompensas elegidas a mano (ilustrativo)' : 'recompensas elegidas a mano (ilustrativo); la curva y las cuentas son exactas', 'viz-s');

      // ---- recta de recompensas
      const lx0 = 20, lx1 = W - 20, ly = 84;
      const span = RMAX + 2 - (RMIN);
      const LX = (v) => lx0 + (lx1 - lx0) * (v - RMIN) / span;
      V.svg('path', { d: 'M' + r1(lx0) + ' ' + ly + 'H' + r1(lx1), class: 'viz-bt-axis' }, svg);
      for (let v = RMIN; v <= RMAX + 2; v += 2) { V.svg('path', { d: 'M' + r1(LX(v)) + ' ' + (ly - 3) + 'V' + (ly + 3), class: 'viz-bt-axis' }, svg); t(svg, LX(v), ly + 16, String(v).replace('-', '−'), 'viz-s', 'middle'); }
      t(svg, lx1, ly + 30, 'recompensa r (escalar por respuesta)', 'viz-s', 'end');
      // Δ como corchete entre los dos puntos
      const xa = LX(rl), xb = LX(rw);
      V.svg('path', { d: 'M' + r1(xa) + ' ' + (ly - 25) + 'V' + (ly - 29) + 'H' + r1(xb) + 'V' + (ly - 25), class: 'viz-bt-brace' + (D < 0 ? ' is-neg' : '') }, svg);
      t(svg, (xa + xb) / 2, ly - 33, 'Δ = ' + f2(D), 'viz-n', 'middle');
      // etiquetas sobre los puntos, hacia afuera (la de la mayor a la derecha): no se pisan aunque Δ sea chico
      const dot = (x, cls, lab, right) => { V.svg('circle', { cx: r1(x), cy: ly, r: 6, class: 'viz-bt-dot ' + cls }, svg); t(svg, x + (right ? 2 : -2), ly - 10, lab, 'viz-bt-lab ' + cls, right ? 'start' : 'end'); };
      dot(xb, 'is-w', 'y_w', D >= 0);
      dot(xa, 'is-l', 'y_l', D < 0);

      // ---- curvas: P = σ(Δ − m) y pérdida / gradiente
      const cx0 = narrow ? 34 : 46, cwid = narrow ? W - cx0 - 12 : (W - 16 - 2 * 46 - 30) / 2, ch = narrow ? 110 : 140;
      const cy = 150;
      const panel = (x0, y0, title, yTicks, curves, yLab) => {
        t(svg, x0 - (narrow ? 30 : 40), y0 - 10, title, 'viz-n');
        const X = (d) => x0 + cwid * (d + DMAX) / (2 * DMAX), Y = (v, ymax) => y0 + ch - ch * v / ymax;
        const ymax = yTicks[yTicks.length - 1];
        let gd = '';
        yTicks.forEach((v) => { gd += 'M' + r1(x0) + ' ' + r1(Y(v, ymax)) + 'H' + r1(x0 + cwid); });
        V.svg('path', { d: gd, class: 'viz-bt-grid' }, svg);
        yTicks.forEach((v) => t(svg, x0 - 5, Y(v, ymax) + 4, String(v), 'viz-s', 'end'));
        V.svg('path', { d: 'M' + r1(X(0)) + ' ' + r1(y0) + 'V' + r1(y0 + ch), class: 'viz-bt-zero' }, svg);
        if (state.m) V.svg('path', { d: 'M' + r1(X(state.m)) + ' ' + r1(y0) + 'V' + r1(y0 + ch), class: 'viz-bt-margin' }, svg);
        [-6, -3, 0, 3, 6].forEach((d) => t(svg, X(d), y0 + ch + 14, String(d).replace('-', '−'), 'viz-s', 'middle'));
        t(svg, x0 + cwid, y0 + ch + 28, 'Δ = r_w − r_l', 'viz-s', 'end');
        curves.forEach((c) => {
          let d = '';
          // fuera del panel (pérdida > ymax) la curva se corta: no una meseta falsa en el borde
          let pen = false;
          for (let i = 0; i <= 140; i++) { const dd = -DMAX + 2 * DMAX * i / 140, v = c.f(dd); if (v > ymax) { pen = false; continue; } d += (pen ? 'L' : 'M') + r1(X(dd)) + ' ' + r1(Y(v, ymax)); pen = true; }
          V.svg('path', { d, class: 'viz-bt-curve ' + c.cls }, svg);
          const v = c.f(Math.max(-DMAX, Math.min(DMAX, D)));
          if (Math.abs(D) <= DMAX && v <= ymax) V.svg('circle', { cx: r1(X(D)), cy: r1(Y(v, ymax)), r: 4.5, class: 'viz-bt-pt ' + c.cls }, svg);
        });
        if (yLab) yLab(X, Y, ymax);
      };
      panel(cx0, cy, 'P(y_w ≻ y_l)' + (state.m ? ' = σ(Δ − m)' : ' = σ(Δ)'), [0, 0.5, 1], [{ f: (d) => sig(d - state.m), cls: 'is-p' }], (X, Y, ymax) => {
        if (Math.abs(D) <= DMAX) t(svg, Math.min(X(D) + 8, cx0 + cwid - 2), Y(P, ymax) + (P > 0.8 ? 16 : -8), f2(P), 'viz-n', X(D) + 50 > cx0 + cwid ? 'end' : null);
      });
      const px2 = narrow ? cx0 : cx0 + cwid + 30 + 46, py2 = narrow ? cy + ch + 56 : cy;
      // (la x de este panel la resuelve panel(); aquí solo se arma la leyenda de las dos curvas)
      const savedX0 = px2;
      panel(savedX0, py2, narrow ? 'pérdida y |gradiente|' : 'Pérdida −log σ(Δ − m) y |∂pérdida/∂Δ| = σ(−(Δ − m))', [0, 1, 2, 3, 4], [{ f: (d) => softplus(-(d - state.m)), cls: 'is-loss' }, { f: (d) => sig(-(d - state.m)), cls: 'is-grad' }], () => {});
      // leyenda del panel 2
      const ly2 = py2 + ch + (narrow ? 42 : 44);
      V.svg('path', { d: 'M' + r1(savedX0) + ' ' + r1(ly2 - 4) + 'h18', class: 'viz-bt-curve is-loss' }, svg);
      t(svg, savedX0 + 24, ly2, 'pérdida ' + f2(loss), 'viz-s');
      V.svg('path', { d: 'M' + r1(savedX0 + (narrow ? 130 : 150)) + ' ' + r1(ly2 - 4) + 'h18', class: 'viz-bt-curve is-grad' }, svg);
      t(svg, savedX0 + (narrow ? 154 : 174), ly2, '|gradiente| ' + f2(grad), 'viz-s');
      let y = ly2 + 18;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      svg.setAttribute('aria-label', 'r_w = ' + f2(rw) + ', r_l = ' + f2(rl) + ', Δ = ' + f2(D) + (state.m ? ', margen ' + state.m : '') + ': P(y_w ≻ y_l) = ' + f2(P) + ', pérdida ' + f2(loss) + ', gradiente ' + f2(grad) + '.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('Δ = r<sub>w</sub> − r<sub>l</sub>:', f2(D));
      kv('P(y<sub>w</sub> ≻ y<sub>l</sub>):', f2(P));
      kv('pérdida −log σ(Δ' + (state.m ? ' − m' : '') + '):', f2(loss));
      kv('|∂pérdida/∂Δ|:', f2(grad));
      if (state.c) kv('con c = ' + state.c + ':', 'la misma P (solo importa Δ)');
      note.innerHTML = sub('El modelo de recompensa es un LLM con una cabeza escalar (d → 1) que puntúa la respuesta entera; se entrena solo con <i>pares</i> que eligieron personas, así que únicamente aprende diferencias: sumar la misma c a las dos no cambia nada (por eso InstructGPT normaliza la recompensa con un sesgo antes de PPO). Los pares ya bien ordenados (Δ grande) casi no empujan: el gradiente es σ(−Δ). Con margen m (Llama 2: más grande cuanto más clara fue la preferencia), un par bien ordenado sigue empujando hasta que Δ supera m. DPO usa esta misma pérdida, pero con la recompensa implícita β·log(π/π_ref) en vez de una red aparte.');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.rw = clampR(state.rw + (k === 'ArrowRight' ? 0.5 : -0.5)); draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); state.rl = clampR(state.rl + (k === 'ArrowUp' ? 0.5 : -0.5)); draw(); }
      else if (k === 'm' || k === 'M') { ev.preventDefault(); state.m = MARGINS[(MARGINS.indexOf(state.m) + 1) % MARGINS.length]; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('bradley-terry', render);
})(typeof window !== 'undefined' ? window : globalThis);
