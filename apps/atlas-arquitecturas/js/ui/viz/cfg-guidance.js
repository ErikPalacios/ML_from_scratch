/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/cfg-guidance.js
   Visualización "cfg-guidance" (SPEC §7.8, §20.4): guía libre de clasificador (Ho & Salimans, arXiv:2207.12598).
   ε̃ = ε_u + w · (ε_c − ε_u)   (convención de diffusers: w = 1 es sin guía; w = 0, incondicional)
   Juguete 2-D ("ilustrativo"): datos = 4 gaussianas de dos clases (A a la izquierda, B a la derecha). Con el modelo óptimo
   exacto de la mezcla:
   - Panel 1: un punto ruidoso x_t (arrastrable; flechas lo mueven) y lo que el modelo "cree" que es la imagen limpia:
     x̂₀ incondicional (sin clase), x̂₀ condicional (con la clase) y x̂₀ guiado = x̂₀_u + w·(x̂₀_c − x̂₀_u) (x̂₀ es afín en ε̂, así
     que guiar ε es guiar x̂₀).
   - Panel 2: 40 muestras (DDIM, 25 pasos) con esa guía: con w = 0 salen de las dos clases; con w = 1, de la pedida; con w
     grande se van más allá de los datos (más "típicas" que los datos y menos variadas).
   Lo NO ilustrativo: la agenda ᾱ y la escala de guía por omisión, de la config del calculador; el costo (CFG duplica las
   evaluaciones de la U-Net), de ATLAS.Arch.metrics.
   params: { config:'sd15-unet', w:7.5, cls:0 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const TOY = { s: 0.2, modes: [{ mu: [-1.5, 1.0], cls: 0 }, { mu: [-1.0, -1.2], cls: 0 }, { mu: [1.4, 1.2], cls: 1 }, { mu: [1.2, -1.0], cls: 1 }] };
  const CLS = ['A', 'B'];
  const R = 3.2;           // medio lado del panel (unidades del juguete)
  const NS = 40, NSTEP = 25;
  const TLEV = [[850, 'mucho ruido'], [600, 'medio'], [300, 'poco']];

  function num(m, keys) { for (const k of keys) { const v = m && m[k]; if (Number.isFinite(v)) return v; } return null; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, D = V.diff;
    const cfgId = params.config || 'sd15-unet';
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n) };
    const ops = (n) => (fmt.ops ? fmt.ops(n) : fmt.si(n) + 'MACs');
    const sched = D.scheduleOf(cfgId);
    if (!sched) { const d = V.html('div', { class: 'ad-error', role: 'alert', text: 'La config ' + cfgId + ' del calculador no trae la agenda de ruido (β).' }, el); return { destroy() { d.remove(); } }; }
    let cfgW = null, label = cfgId;
    try { const r = A.run(cfgId); label = r.label || cfgId; const c = r.config || {}; cfgW = [c.cfgScale, c.guidanceScale, c.guidance, c.cfgW].find((v) => Number.isFinite(+v) && +v > 1); cfgW = cfgW != null ? +cfgW : null; } catch (e) { cfgW = null; }
    const WS = [0, 1, 2, 3, 5, 10, 15];
    if (cfgW != null && WS.indexOf(cfgW) < 0) { WS.push(cfgW); WS.sort((a, b) => a - b); }
    const w0 = Number.isFinite(+params.w) && WS.indexOf(+params.w) >= 0 ? +params.w : cfgW != null ? cfgW : 3;
    const state = { wi: WS.indexOf(w0), cls: params.cls === 1 || params.cls === '1' ? 1 : 0, ti: 1, x: [0.15, 0.35] };

    const starts = [];
    { const rng = V.rng(31); for (let i = 0; i < NS; i++) starts.push([rng.normal(), rng.normal()]); }
    const ts = D.timesteps(sched.T, NSTEP);
    const sCache = {};
    function samples(w, cls) {
      const k = w + ':' + cls;
      if (!sCache[k]) sCache[k] = starts.map((z) => D.sampleVP(TOY, z, sched.abar, ts, { cls, w }).pop());
      return sCache[k];
    }
    function cost(cfgOn) { try { const m = A.metrics(cfgId, { cfg: cfgOn }); return num(m, ['samplingMacs']); } catch (e) { return null; } }

    const wrap = V.html('div', { class: 'viz viz-cfg' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Condición (clase)' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Condición' }, g1);
    const cBtns = CLS.map((c, i) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'clase ' + c }, g1); b.addEventListener('click', () => { state.cls = i; draw(); }); b._v = i; return b; });
    const g2 = V.html('label', { class: 'viz-ctl viz-cfg-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Escala w' }, g2);
    const inp = V.html('input', { type: 'range', min: 0, max: WS.length - 1, step: 1, 'aria-label': 'Escala de guía w' }, g2);
    const outW = V.html('output', { class: 'viz-ns-out' }, g2);
    inp.addEventListener('input', () => { state.wi = +inp.value; draw(); });
    const g3 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Nivel de ruido del punto' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Ruido de x_t'.replace('_t', 'ₜ') }, g3);
    const tBtns = TLEV.map(([t, text], i) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: text + ' (t = ' + t + ')' }, g3); b.addEventListener('click', () => { state.ti = i; draw(); }); b._v = i; return b; });
    const stage = V.html('div', { class: 'viz-stage viz-cfg-stage', tabindex: 0, role: 'group', 'aria-label': 'Guía libre de clasificador. Flechas: mueven el punto ruidoso; + y −: cambian w; A y B: la clase' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null, drag = null, geom = null;
    function draw() {
      cBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.cls)));
      tBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.ti)));
      const w = WS[state.wi];
      inp.value = state.wi; outW.textContent = 'w = ' + w + (w === cfgW ? ' (SD)' : '');
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(440, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const tx = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); if (V.rich) V.rich(e, s); else e.textContent = s; return e; };
      tx(svg, 8, 15, narrow ? 'ε̃ = ε_u + w·(ε_c − ε_u), w = ' + w : 'Guía libre de clasificador: ε̃ = ε_u + w · (ε_c − ε_u), con w = ' + w + ' y la clase ' + CLS[state.cls], 'viz-t');
      tx(svg, 8, 29, narrow ? 'juguete 2-D ilustrativo (modelo exacto)' : 'juguete 2-D ilustrativo (modelo exacto de la mezcla)', 'viz-s');
      const P = narrow ? W - 16 : 420, gap = 24, top = 54;
      const panels = narrow ? [[8, top], [8, top + P + 80]] : [[8, top], [8 + P + gap, top]];
      const P2 = narrow ? P : W - 16 - P - gap;
      const sz = [P, P2];
      const mk = (k) => { const [x0, y0] = panels[k], S = sz[k]; return { X: (v) => x0 + S / 2 + v / R * S / 2, Y: (v) => y0 + S / 2 - v / R * S / 2, x0, y0, S, inv: (px, py) => [(px - x0 - S / 2) / (S / 2) * R, -(py - y0 - S / 2) / (S / 2) * R] }; };
      const drawModes = (G) => {
        V.svg('rect', { x: G.x0, y: G.y0, width: G.S, height: G.S, class: 'viz-ds-box' }, svg);
        TOY.modes.forEach((m) => {
          V.svg('circle', { cx: r1(G.X(m.mu[0])), cy: r1(G.Y(m.mu[1])), r: r1(2 * TOY.s / R * G.S / 2), class: 'viz-cfg-mode is-c' + m.cls + (m.cls === state.cls ? ' is-want' : '') }, svg);
          tx(svg, G.X(m.mu[0]), G.Y(m.mu[1]) + 4, CLS[m.cls], 'viz-cfg-ml', 'middle');
        });
      };
      // ---- panel 1: el punto ruidoso y las tres predicciones de x̂₀
      const G1 = mk(0);
      tx(svg, G1.x0, G1.y0 - 8, narrow ? 'qué cree el modelo que es x₀' : '1 · desde x_t, la imagen limpia que predice el modelo (x̂₀)', 'viz-s');
      drawModes(G1);
      const ab = sched.abar[TLEV[state.ti][0]];
      const eu = D.epsHat(TOY, state.x, ab, null), ec = D.epsHat(TOY, state.x, ab, state.cls);
      const eg = [eu[0] + w * (ec[0] - eu[0]), eu[1] + w * (ec[1] - eu[1])];
      const xu = D.x0From(state.x, eu, ab), xc = D.x0From(state.x, ec, ab), xg = D.x0From(state.x, eg, ab);
      const cl = (v) => Math.max(-R, Math.min(R, v));
      const P_ = (p) => [r1(G1.X(cl(p[0]))), r1(G1.Y(cl(p[1])))];
      const arrow = (a, b, cls) => {
        const A2 = P_(a), B2 = P_(b), L = Math.hypot(B2[0] - A2[0], B2[1] - A2[1]);
        if (L < 2) return;
        const ux = (B2[0] - A2[0]) / L, uy = (B2[1] - A2[1]) / L, hs = Math.min(9, L * 0.5);
        V.svg('path', { d: 'M' + A2.join(' ') + 'L' + r1(B2[0] - ux * hs * 0.8) + ' ' + r1(B2[1] - uy * hs * 0.8), class: 'viz-cfg-arr ' + cls }, svg);
        V.svg('path', { d: 'M' + B2.join(' ') + 'L' + r1(B2[0] - ux * hs - uy * hs * 0.5) + ' ' + r1(B2[1] - uy * hs + ux * hs * 0.5) + 'L' + r1(B2[0] - ux * hs + uy * hs * 0.5) + ' ' + r1(B2[1] - uy * hs - ux * hs * 0.5) + 'Z', class: 'viz-cfg-head ' + cls }, svg);
      };
      arrow(state.x, xu, 'is-u');
      arrow(state.x, xc, 'is-c');
      if (Math.abs(w - 1) > 1e-9 && w !== 0) arrow(xu, xg, 'is-g');
      let clipped = false;
      [[xu, 'is-u'], [xc, 'is-c'], [xg, 'is-g']].forEach(([p, cls], k) => {
        const q = P_(p);
        if (Math.abs(p[0]) > R || Math.abs(p[1]) > R) clipped = true;
        V.svg('circle', { cx: q[0], cy: q[1], r: k === 2 ? 6 : 4.5, class: 'viz-cfg-pt ' + cls }, svg);
      });
      // x̂₀ guiado fuera del recuadro: se dibuja en el borde y se dice
      if (clipped) tx(svg, G1.x0 + 6, G1.y0 + 16, 'x̂₀ guiado fuera del recuadro: (' + xg[0].toFixed(1) + ', ' + xg[1].toFixed(1) + ')', 'viz-rl-warn');
      // el punto ruidoso (arrastrable)
      const xp = P_(state.x);
      const hg = V.svg('g', { class: 'viz-cfg-probe' }, svg);
      V.svg('circle', { cx: xp[0], cy: xp[1], r: 7, class: 'viz-cfg-x' }, hg);
      tx(hg, xp[0] + 10, xp[1] - 9, 'x_t', 'viz-n');
      V.svg('rect', { x: G1.x0, y: G1.y0, width: G1.S, height: G1.S, class: 'viz-cfg-hit' }, svg);
      geom = G1;
      // leyenda del panel 1
      let ly = G1.y0 + G1.S + 16, lx = G1.x0;
      [['is-u', 'sin clase (ε_u)'], ['is-c', 'con clase (ε_c)'], ['is-g', 'guiado (w = ' + w + ')']].forEach(([cls, lab], k) => {
        if (narrow && k === 2) { lx = G1.x0; ly += 15; }
        V.svg('circle', { cx: lx + 5, cy: ly - 4, r: 4.5, class: 'viz-cfg-pt ' + cls }, svg); tx(svg, lx + 13, ly, lab, 'viz-s'); lx += 22 + lab.length * 6.2;
      });
      tx(svg, G1.x0, ly + 15, narrow ? 'arrastra x_t (o flechas)' : 'arrastra x_t; la flecha gruesa es w·(x̂₀_c − x̂₀_u)', 'viz-s');
      // ---- panel 2: muestras con esa guía
      const G2 = mk(1);
      const sm = samples(w, state.cls);
      tx(svg, G2.x0, G2.y0 - 8, narrow ? 'muestras con w = ' + w + ' (DDIM, ' + NSTEP + ' pasos)' : '2 · ' + NS + ' muestras guiadas (DDIM, ' + NSTEP + ' pasos)', 'viz-s');
      drawModes(G2);
      let inC = 0, outD = 0;
      sm.forEach((p) => {
        const nm = D.nearestMode(TOY, p);
        const ok = nm.d < 3 * TOY.s;
        if (ok && nm.m.cls === state.cls) inC++;
        if (!ok) outD++;
        const cls = ok ? 'is-c' + nm.m.cls : 'is-out';
        V.svg('circle', { cx: r1(G2.X(Math.max(-R, Math.min(R, p[0])))), cy: r1(G2.Y(Math.max(-R, Math.min(R, p[1])))), r: 3.2, class: 'viz-cfg-s ' + cls }, svg);
      });
      ly = G2.y0 + G2.S + 16;
      tx(svg, G2.x0, ly, narrow ? 'clase ' + CLS[state.cls] + ': ' + inC + '/' + NS + ' · fuera: ' + outD : 'de la clase ' + CLS[state.cls] + ': ' + inC + ' de ' + NS + ' · fuera de los datos: ' + outD, 'viz-n');
      const Hh = (narrow ? panels[1][1] + P2 : top + Math.max(P, P2)) + 40;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(Hh));
      svg.setAttribute('aria-label', 'Guía w = ' + w + ', clase ' + CLS[state.cls] + ': de ' + NS + ' muestras, ' + inC + ' caen en la clase pedida y ' + outD + ' fuera de los datos.');
      // pista de arrastre
      const hit = svg.querySelector('.viz-cfg-hit');
      hit.addEventListener('pointerdown', (ev) => { drag = true; try { hit.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ } moveTo(ev, svg); });
      hit.addEventListener('pointermove', (ev) => { if (drag) moveTo(ev, svg); });
      hit.addEventListener('pointerup', () => { drag = null; });
      hit.addEventListener('pointercancel', () => { drag = null; });
      // lectura
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      kv('w:', String(w));
      kv('clase ' + CLS[state.cls] + ':', inC + ' / ' + NS);
      kv('fuera de los datos:', String(outD));
      const c1 = cost(1), c0 = cost(0);
      if (c1 != null && c0 != null) { kv('por imagen con CFG:', ops(c1)); kv('sin CFG:', ops(c0)); }
      note.innerHTML = 'La red se evalúa dos veces por paso: con la condición (ε<sub>c</sub>) y con la condición vacía (ε<sub>u</sub>; en SD el prompt "", en DiT la clase nula). Por eso se entrena borrando la condición una fracción de las veces. ' +
        'w = 1 es el modelo condicional tal cual; w &gt; 1 empuja más allá, lejos de lo que distingue a la otra clase: más fiel al prompt, menos variado y, con w grande, fuera de los datos (en imágenes: colores saturados). ' +
        'Convención: diffusers usa ε<sub>u</sub> + w·(ε<sub>c</sub> − ε<sub>u</sub>)' + (cfgW != null ? ' con w = ' + cfgW + ' en ' + label : '') + '; Ho &amp; Salimans escriben (1 + w)·ε<sub>c</sub> − w·ε<sub>u</sub>, donde su w = 0 es sin guía (el mismo número menos 1).' +
        (c1 != null && c0 != null ? ' Costo del calculador: ' + ops(c1) + ' con CFG frente a ' + ops(c0) + ' sin CFG por imagen.' : '');
    }
    function moveTo(ev, svg) {
      if (!geom) return;
      const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
      const m = svg.getScreenCTM(); if (!m) return;
      const p = pt.matrixTransform(m.inverse());
      const q = geom.inv(p.x, p.y);
      if (Math.abs(q[0]) > R || Math.abs(q[1]) > R) return;
      state.x = [Math.round(q[0] * 20) / 20, Math.round(q[1] * 20) / 20];
      draw();
    }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, st = 0.1;
      if (k === 'ArrowRight') state.x[0] = Math.min(R - 0.1, state.x[0] + st);
      else if (k === 'ArrowLeft') state.x[0] = Math.max(-R + 0.1, state.x[0] - st);
      else if (k === 'ArrowUp') state.x[1] = Math.min(R - 0.1, state.x[1] + st);
      else if (k === 'ArrowDown') state.x[1] = Math.max(-R + 0.1, state.x[1] - st);
      else if (k === '+' || k === '=') state.wi = Math.min(WS.length - 1, state.wi + 1);
      else if (k === '-') state.wi = Math.max(0, state.wi - 1);
      else if (k === 'a' || k === 'A') state.cls = 0;
      else if (k === 'b' || k === 'B') state.cls = 1;
      else return;
      ev.preventDefault();
      state.x = state.x.map((v) => Math.round(v * 100) / 100);
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('cfg-guidance', render);
})(typeof window !== 'undefined' ? window : globalThis);
