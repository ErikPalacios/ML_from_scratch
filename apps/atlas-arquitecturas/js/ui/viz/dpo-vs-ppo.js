/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/dpo-vs-ppo.js
   Visualización "dpo-vs-ppo" (SPEC §7.8, §22.3): qué hace la pérdida de DPO con las probabilidades (juguete, ilustrativo).
   DPO (Rafailov et al. 2023, arXiv:2305.18290): recompensa implícita r̂(x, y) = β·log(π_θ(y|x) / π_ref(y|x)) y
     L = −log σ(r̂(x, y_w) − r̂(x, y_l)) = −log σ(β·[(log π_θ(y_w) − log π_ref(y_w)) − (log π_θ(y_l) − log π_ref(y_l))]).
   Es la pérdida de Bradley–Terry con r̂ en vez de un modelo de recompensa; su óptimo es el de RLHF con KL
   (max E[r] − β·KL(π‖π_ref) ⇒ π* ∝ π_ref·exp(r/β), eq. 4 del paper), sin muestrear respuestas ni entrenar un crítico.
   Juguete: una política sobre 6 respuestas enteras (softmax de logits z = z_ref + Φ·θ, θ ∈ R², empieza en 0 = π_ref) y UN
   par (y_w, y_l). El gradiente de DPO es −β·σ(−β·Δ)·(φ_w − φ_l): solo mueve θ en la dirección que separa las dos.
     - "distintas": φ_w y φ_l no comparten nada → sube y_w y baja y_l.
     - "parecidas": comparten casi todo y la dirección que las separa baja a las DOS (la rechazada más): el margen crece
       igual, la masa se va a otras respuestas. Es el "likelihood displacement" (Pal et al. 2024, arXiv:2402.13228;
       Razin et al. 2024, arXiv:2410.08847).
   Acuerdo de los anotadores p: con p = 80 % (el par se etiqueta y_w ≻ y_l el 80 % de las veces) la pérdida esperada
   p·(−log σ(βΔ)) + (1 − p)·(−log σ(−βΔ)) tiene su mínimo en βΔ = logit(p): la política se detiene. Con p = 100 % (preferencias
   deterministas) Δ crece sin fin y β casi no frena (la crítica de IPO: Azar et al. 2023, arXiv:2310.12036).
   β: con el paso escalado por 1/β² la pérdida baja igual con todos los β (dβΔ/dt no depende de β); lo que cambia es CUÁNTO
   se aleja la política de la referencia (KL): β chico = más lejos. β de juguete (0.5–2: aquí los log-probs son de 6 respuestas,
   no sumas sobre tokens; el paper usa sobre todo β = 0.1). La línea punteada es un presupuesto de KL de ejemplo.
   params: { beta:1, pair:'distinct'|'similar', agree:0.8|1, step:120 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  // subíndices estilo TeX en el texto html (readout y nota): π_ref → π<sub>ref</sub>
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9θ]+)/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const BETAS = [0.5, 1, 2];
  const AGREE = [0.8, 1];
  const STEPS = 200, ETA0 = 0.15, KL_BUDGET = 0.25;
  const Z_REF = [0.2, 0.7, 0.5, 0.1, -0.2, -0.6];      // logits de la referencia: al empezar, la rechazada es MÁS probable
  const NAMES = ['y_w', 'y_l', 'y₃', 'y₄', 'y₅', 'y₆'];
  const PAIRS = {
    distinct: { label: 'distintas', phi: [[1, 0], [0, 1], [0, 0], [0, 0], [0, 0], [0, 0]] },
    similar: { label: 'parecidas', phi: [[1, -0.2], [1, -0.6], [0, 0], [0, 0], [0, 0], [0, 0]] },
  };
  const f2 = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)).replace('-', '−');

  function softmax(z) { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); }
  // trayectoria de DPO en el juguete: estado por paso
  function trajectory(beta, pairKey, agree) {
    const phi = PAIRS[pairKey].phi;
    const d = [phi[0][0] - phi[1][0], phi[0][1] - phi[1][1]], dd = d[0] * d[0] + d[1] * d[1];
    const lr = ETA0 / (dd * beta * beta);
    const pref = softmax(Z_REF), lref = pref.map(Math.log);
    const th = [0, 0];
    const out = [];
    for (let s = 0; s <= STEPS; s++) {
      const z = Z_REF.map((v, i) => v + phi[i][0] * th[0] + phi[i][1] * th[1]);
      const p = softmax(z), lp = p.map(Math.log);
      const ratio = lp.map((v, i) => v - lref[i]);
      const D = ratio[0] - ratio[1];
      const kl = p.reduce((a, v, i) => a + (v > 0 ? v * (lp[i] - lref[i]) : 0), 0);
      // pérdida esperada con acuerdo p (p = 1: la de DPO tal cual) y el peso de su gradiente respecto de βΔ
      const w = agree * sig(-beta * D) - (1 - agree) * sig(beta * D);
      out.push({ p, ratio, D, kl, loss: agree * Math.log1p(Math.exp(-beta * D)) + (1 - agree) * Math.log1p(Math.exp(beta * D)), w, pw: sig(beta * D) });
      const g = beta * w;
      th[0] += lr * g * d[0]; th[1] += lr * g * d[1];
    }
    return { pref, out };
  }

  function render(el, params) {
    const V = ATLAS.Viz;
    const state = { beta: BETAS.indexOf(+params.beta) >= 0 ? +params.beta : 1, agree: AGREE.indexOf(+params.agree) >= 0 ? +params.agree : 0.8, pair: PAIRS[params.pair] ? params.pair : 'distinct', step: Number.isFinite(+params.step) ? Math.max(0, Math.min(STEPS, Math.round(+params.step))) : 120 };

    const wrap = V.html('div', { class: 'viz viz-dp' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    // keep = sin mayúsculas (la β mayúscula, Β, se lee como una B)
    const grp = (lab, keep) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab, style: keep ? 'text-transform:none' : null }, g); return g; };
    const all = [];
    const chips = (g, vals, key, label) => vals.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._k = key; b._v = v; all.push(b); });
    chips(grp('β', true), BETAS, 'beta', (v) => String(v));
    chips(grp('Par elegida / rechazada'), Object.keys(PAIRS), 'pair', (k) => PAIRS[k].label);
    chips(grp('Acuerdo de anotadores'), AGREE, 'agree', (v) => Math.round(v * 100) + ' %');
    const gS = V.html('label', { class: 'viz-ctl viz-dp-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Paso' }, gS);
    const inp = V.html('input', { type: 'range', min: 0, max: STEPS, step: 1, 'aria-label': 'Paso de entrenamiento de DPO (0 a ' + STEPS + ')' }, gS);
    const outS = V.html('output', { class: 'viz-dp-out' }, gS);
    inp.addEventListener('input', () => { state.step = +inp.value; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-dp-stage', tabindex: 0, role: 'group', 'aria-label': 'DPO en un juguete de 6 respuestas. Flechas izquierda y derecha: paso ± 5; arriba y abajo: β; P: cambiar el par' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      inp.value = state.step; outS.textContent = String(state.step);
      const T = trajectory(state.beta, state.pair, state.agree), cur = T.out[state.step];
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'DPO: r̂ = β·log(π_θ / π_ref)' : 'DPO: recompensa implícita r̂(y) = β·log(π_θ(y) / π_ref(y)); pérdida −log σ(r̂(y_w) − r̂(y_l))', 'viz-t');
      t(svg, 8, 29, narrow ? 'juguete: 6 respuestas, 1 par (ilustrativo)' : 'juguete: una política sobre 6 respuestas enteras y un solo par (y_w, y_l); paso ' + state.step + ' de ' + STEPS + ' (ilustrativo)', 'viz-s');

      // ---- barras: π_ref (contorno) y π_θ (relleno) por respuesta, y r̂ debajo
      const bx0 = narrow ? 38 : 40, bw = narrow ? W - bx0 - 10 : 400, bh = narrow ? 100 : 130, by = 64;
      const n = NAMES.length, slot = bw / n, w1 = slot * 0.32;
      const pmax = Math.max(0.5, ...T.out.map((o) => Math.max(...o.p)));
      const Y = (p) => by + bh - bh * p / pmax;
      t(svg, bx0 - (narrow ? 22 : 32), by - 8, narrow ? 'probabilidad' : 'Probabilidad de cada respuesta: π_ref (contorno) y π_θ (relleno)', 'viz-n');
      let gd = '';
      [0, 0.25, 0.5, 0.75, 1].filter((v) => v <= pmax + 1e-9).forEach((v) => { gd += 'M' + r1(bx0) + ' ' + r1(Y(v)) + 'H' + r1(bx0 + bw); t(svg, bx0 - 5, Y(v) + 4, String(v), 'viz-s', 'end'); });
      V.svg('path', { d: gd, class: 'viz-dp-grid' }, svg);
      const cls = (i) => (i === 0 ? 'is-w' : i === 1 ? 'is-l' : 'is-o');
      for (let i = 0; i < n; i++) {
        const x = bx0 + i * slot + slot / 2;
        V.svg('rect', { x: r1(x - w1 - 1), y: r1(Y(T.pref[i])), width: r1(w1), height: r1(by + bh - Y(T.pref[i])), class: 'viz-dp-ref ' + cls(i) }, svg);
        V.svg('rect', { x: r1(x + 1), y: r1(Y(cur.p[i])), width: r1(w1), height: r1(by + bh - Y(cur.p[i])), class: 'viz-dp-pol ' + cls(i) }, svg);
        t(svg, x, by + bh + 14, NAMES[i], 'viz-dp-name ' + cls(i), 'middle');
        t(svg, x, by + bh + 28, f2(state.beta * cur.ratio[i]), 'viz-s', 'middle');
      }
      t(svg, bx0 - (narrow ? 22 : 32), by + bh + 28, 'r̂', 'viz-n');
      t(svg, bx0 + bw, by + bh + 42, narrow ? 'r̂ = β·log(π_θ/π_ref)' : 'r̂ = β·log(π_θ/π_ref) por respuesta (0 = igual que la referencia)', 'viz-s', 'end');

      // ---- curvas en el tiempo: log-ratio de y_w y de y_l, y el KL
      const lx0 = narrow ? 34 : 500, lw = narrow ? W - lx0 - 12 : W - lx0 - 16, lh = narrow ? 110 : 130;
      const ly = narrow ? by + bh + 78 : by;
      const rs = T.out.flatMap((o) => [o.ratio[0], o.ratio[1], o.kl]).concat([0, KL_BUDGET]);
      let lo = Math.min(...rs), hi = Math.max(...rs);
      const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
      const X = (s) => lx0 + lw * s / STEPS, YL = (v) => ly + lh - lh * (v - lo) / (hi - lo);
      t(svg, lx0 - (narrow ? 26 : 30), ly - 8, narrow ? 'log(π_θ/π_ref) y KL vs paso' : 'log(π_θ/π_ref) de y_w y de y_l, y KL(π_θ ‖ π_ref), por paso', 'viz-n');
      V.svg('path', { d: 'M' + r1(lx0) + ' ' + r1(YL(0)) + 'H' + r1(lx0 + lw), class: 'viz-dp-zero' }, svg);
      V.svg('path', { d: 'M' + r1(lx0) + ' ' + r1(YL(KL_BUDGET)) + 'H' + r1(lx0 + lw), class: 'viz-dp-budget' }, svg);
      const ticks = [];
      const stepT = (hi - lo) > 20 ? 10 : (hi - lo) > 8 ? 4 : (hi - lo) > 3 ? 1 : 0.5;
      for (let v = Math.ceil(lo / stepT) * stepT; v <= hi; v += stepT) ticks.push(v);
      ticks.forEach((v) => t(svg, lx0 - 5, YL(v) + 4, f2(v).replace('.00', ''), 'viz-s', 'end'));
      const line = (f, c) => { let d = ''; T.out.forEach((o, s) => { d += (s ? 'L' : 'M') + r1(X(s)) + ' ' + r1(YL(f(o))); }); V.svg('path', { d, class: 'viz-dp-line ' + c }, svg); };
      line((o) => o.ratio[0], 'is-w');
      line((o) => o.ratio[1], 'is-l');
      line((o) => o.kl, 'is-kl');
      V.svg('path', { d: 'M' + r1(X(state.step)) + ' ' + r1(ly) + 'V' + r1(ly + lh), class: 'viz-dp-cur' }, svg);
      [[cur.ratio[0], 'is-w'], [cur.ratio[1], 'is-l'], [cur.kl, 'is-kl']].forEach(([v, c]) => V.svg('circle', { cx: r1(X(state.step)), cy: r1(YL(v)), r: 4, class: 'viz-dp-pt ' + c }, svg));
      t(svg, lx0, ly + lh + 14, '0', 'viz-s', 'middle');
      t(svg, lx0 + lw, ly + lh + 14, String(STEPS), 'viz-s', 'middle');
      // leyenda de las curvas
      let lgy = ly + lh + 32;
      // leyenda (con el presupuesto de KL) en dos filas también en escritorio: en una sola, "presupuesto de KL" pasaba del viewBox
      const leg = [['viz-dp-line is-w', 'y_w (elegida)'], ['viz-dp-line is-l', 'y_l (rechazada)'], ['viz-dp-line is-kl', 'KL'], ['viz-dp-budget', narrow ? 'presupuesto (ej.)' : 'presupuesto de KL (ejemplo)']];
      let lgx = lx0;
      leg.forEach(([c, s], i) => {
        if (i === 2) { lgx = lx0; lgy += 16; }
        V.svg('path', { d: 'M' + r1(lgx) + ' ' + r1(lgy - 4) + 'h16', class: c }, svg); t(svg, lgx + 21, lgy, s, 'viz-s'); lgx += 21 + s.length * 6.6 + 14;
      });
      const y = Math.max(by + bh + 50, lgy + 12);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      const dw = cur.ratio[0], dl = cur.ratio[1];
      svg.setAttribute('aria-label', 'Paso ' + state.step + ' con β = ' + state.beta + ' y respuestas ' + PAIRS[state.pair].label + ': log(π_θ/π_ref) de y_w ' + f2(dw) + ', de y_l ' + f2(dl) + ', KL ' + f2(cur.kl) + ', pérdida ' + f2(cur.loss) + '.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('pérdida DPO' + (state.agree < 1 ? ' (esperada)' : '') + ':', f2(cur.loss));
      kv('P implícita (y_w ≻ y_l) = σ(βΔ):', f2(cur.pw));
      kv('peso del gradiente:', f2(cur.w));
      kv('Δ log π(y_w):', f2(dw));
      kv('Δ log π(y_l):', f2(dl));
      kv('KL(π_θ ‖ π_ref):', f2(cur.kl) + ' nats' + (cur.kl > KL_BUDGET ? ' (pasa el presupuesto)' : ''));
      note.innerHTML = sub('Ilustrativo: 6 respuestas enteras en vez de secuencias de tokens, y un solo par. Lo que sí vale en general: DPO solo empuja la DIFERENCIA de log-ratios (el gradiente va por ∇log π(y_w) − ∇log π(y_l)), con un peso que se apaga cuando el par ya está bien ordenado; no necesita un modelo de recompensa ni generar respuestas (PPO sí: rollouts, el modelo de recompensa y un crítico). ' + (state.pair === 'similar' ? 'Con respuestas parecidas, la dirección que las separa baja a las DOS: el margen crece pero y_w también pierde probabilidad y la masa se va a otras respuestas (Pal et al. 2024, DPO-Positive; Razin et al. 2024). ' : 'Con respuestas que no comparten nada, sube y_w y baja y_l. Prueba "parecidas": bajan las dos. ') + (state.agree < 1 ? 'Con acuerdo del 80 % la pérdida tiene un piso (β·Δ = logit 0.8 ≈ 1.39) y la política se detiene; ' : 'Con preferencias deterministas (100 %) no hay piso: Δ sigue creciendo y el KL también (la crítica de IPO); ') + 'β hace de presupuesto de KL: aquí el paso se escala con 1/β² para que la pérdida baje igual con cualquier β, y con β chico la política se aleja más de la referencia para el mismo resultado. El óptimo de RLHF con KL es π* ∝ π_ref·exp(r/β), el mismo al que apunta DPO.');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.step = Math.max(0, Math.min(STEPS, state.step + (k === 'ArrowRight' ? 5 : -5))); draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); const i = Math.max(0, Math.min(BETAS.length - 1, BETAS.indexOf(state.beta) + (k === 'ArrowUp' ? 1 : -1))); state.beta = BETAS[i]; draw(); }
      else if (k === 'p' || k === 'P') { ev.preventDefault(); state.pair = state.pair === 'distinct' ? 'similar' : 'distinct'; draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.step = 0; draw(); }
      else if (k === 'End') { ev.preventDefault(); state.step = STEPS; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('dpo-vs-ppo', render);
})(typeof window !== 'undefined' ? window : globalThis);
