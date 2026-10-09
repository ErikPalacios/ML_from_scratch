/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/action-chunking.js
   Visualización "action-chunking" (SPEC §7.8, §21.4): predecir un CHUNK de H acciones por consulta (ACT, π0,
   OpenVLA-OFT) frente a una acción por consulta. Un juguete 1-D: el robot sigue un objetivo que se mueve; a los 1.13 s el
   objeto salta (una perturbación). La política, en cada consulta, ve el objetivo de ESE momento y predice las H acciones
   siguientes con un pequeño error que crece con el horizonte; entre consultas el robot ejecuta a ciegas (lazo abierto).
   Se ve el compromiso:
   - más acciones ejecutadas por consulta (k) = menos inferencias por segundo (f / k), pero más retraso para reaccionar
     (hasta k / f) y saltos donde empieza cada chunk (los chunks no coinciden entre sí);
   - ensamble temporal (ACT, Zhao et al. 2023, arXiv:2304.13705): consultar en CADA paso y promediar las predicciones de
     todos los chunks que cubren ese paso, con pesos w_i = exp(−m·i) (w_0 = la predicción más vieja): suave, pero cada
     paso paga una inferencia y la reacción se diluye.
   Todo es ilustrativo (un objetivo sintético, errores con semilla); lo que no es inventado es la aritmética:
   consultas/s = f / k, retraso ≤ k / f, un paso dura 1000 / f ms.
   params: { f:50|10, H:1|5|10|25|50, exec:'chunk'|'half'|'ens' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const RATES = [50, 10], HS = [1, 5, 10, 25, 50];
  const EXECS = { chunk: 'todo el chunk', half: 'la mitad', ens: 'ensamble (consulta en cada paso)' };
  const TD = 1.13, JUMP = 0.6, TEND = 2.4, M = 0.1;

  function render(el, params) {
    const V = ATLAS.Viz;
    const state = {
      f: RATES.indexOf(+params.f) >= 0 ? +params.f : 50,
      H: HS.indexOf(+params.H) >= 0 ? +params.H : 25,
      exec: EXECS[params.exec] ? params.exec : 'chunk',
    };
    const goal = (t, seen) => 0.45 * Math.sin(2 * Math.PI * 0.55 * t) + 0.15 * Math.sin(2 * Math.PI * 1.3 * t + 0.7) + (seen && t >= TD ? JUMP : 0);
    // predicción del chunk consultado en el paso q (determinista por q y f: el mismo chunk en todos los modos)
    function chunkAt(q, f, H) {
      const rng = V.rng(1000 + q * 7 + f * 131);
      const t0 = q / f, seen = t0 >= TD;
      const e = 0.05 * rng.normal(), s = 0.35 * rng.normal();
      const out = [];
      for (let j = 0; j < H; j++) { const t = (q + j) / f; out.push(goal(t, seen) + e + s * (t - t0)); }
      return out;
    }
    function simulate(st) {
      const n = Math.round(TEND * st.f), H = st.H;
      const k = st.exec === 'ens' ? 1 : st.exec === 'half' ? Math.max(1, Math.floor(H / 2)) : H;
      const act = new Float64Array(n), queries = [];
      if (st.exec === 'ens') {
        const preds = [];
        for (let q = 0; q < n; q++) { preds.push(chunkAt(q, st.f, H)); queries.push(q); }
        for (let i = 0; i < n; i++) {
          let sw = 0, sv = 0, age = 0;
          // de la consulta más vieja que cubre i (peso exp(0)) a la más nueva (i)
          for (let q = Math.max(0, i - H + 1); q <= i; q++, age++) { const w = Math.exp(-M * age); sw += w; sv += w * preds[q][i - q]; }
          act[i] = sv / sw;
        }
      } else {
        let cur = null, q0 = 0;
        for (let i = 0; i < n; i++) {
          if (!cur || i - q0 >= k) { cur = chunkAt(i, st.f, H); q0 = i; queries.push(i); }
          act[i] = cur[i - q0];
        }
      }
      // reacción: del salto al primer paso cuya acción ejecutada ya cubre la mitad del salto (con chunks, eso llega con la
      // primera consulta que lo ve; con ensamble, cuando el promedio pesa lo bastante las predicciones nuevas)
      let delay = null;
      for (let i = Math.ceil(TD * st.f - 1e-9); i < n; i++) if (Math.abs(act[i] - goal(i / st.f, true)) < JUMP / 2) { delay = i / st.f - TD; break; }
      let rms = 0;
      for (let i = 0; i < n; i++) { const e = act[i] - goal(i / st.f, true); rms += e * e; }
      rms = Math.sqrt(rms / n);
      // saltos donde empieza un chunk, lejos de la perturbación (que no es un defecto del chunk); con ensamble, el mayor
      // salto entre pasos que no explica el propio objetivo
      let jb = 0, nb = 0;
      for (const q of queries) if (q > 0 && (q / st.f < TD - 0.5 / st.f || q / st.f > TD + (k + 1) / st.f)) { nb++; jb = Math.max(jb, Math.abs(act[q] - act[q - 1])); }
      return { n, k, act, queries, delay, jumpMax: st.exec === 'ens' ? jumpOutside(act, st.f) : nb ? jb : null, rms, qps: st.f / k };
    }
    function jumpOutside(act, f) { let m = 0; for (let i = 1; i < act.length; i++) { const t = i / f; if (Math.abs(t - TD) < 0.25) continue; m = Math.max(m, Math.abs(act[i] - act[i - 1]) - Math.abs(goal(t, true) - goal((i - 1) / f, true))); } return Math.max(0, m); }

    const wrap = V.html('div', { class: 'viz viz-ac' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const all = [];
    const chips = (g, vals, key, label) => vals.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._k = key; b._v = v; all.push(b); });
    chips(grp('Control'), RATES, 'f', (v) => v + ' Hz');
    chips(grp('Chunk H'), HS, 'H', (v) => String(v));
    chips(grp('Se ejecuta'), Object.keys(EXECS), 'exec', (k) => EXECS[k]);
    const stage = V.html('div', { class: 'viz-stage viz-ac-stage', tabindex: 0, role: 'group', 'aria-label': 'Chunks de acciones. Flechas izquierda y derecha: tamaño del chunk H' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      const sim = simulate(state);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(280, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, (narrow ? 'H = ' : 'Chunk de H = ') + state.H + ' a ' + state.f + ' Hz · ' + (state.exec === 'ens' ? 'consulta en cada paso + ensamble' : 'ejecuta ' + sim.k + (narrow ? '' : ' por consulta')), 'viz-t');
      t(svg, 8, 29, narrow ? 'juguete 1-D (ilustrativo)' : 'juguete 1-D (ilustrativo): seguir un objetivo que salta a los ' + TD + ' s', 'viz-s');
      const px0 = narrow ? 30 : 40, pw = W - px0 - 10, py0 = 42, ph = narrow ? 170 : 210;
      // rango vertical: objetivo, acciones y planes (dentro de la ventana), con margen
      const plans = state.exec === 'ens' ? [] : sim.queries.map((q) => chunkAt(q, state.f, state.H).map((v, j) => [(q + j) / state.f, v]).filter((p) => p[0] <= TEND + 1e-9));
      let lo = Infinity, hi = -Infinity;
      const see = (v) => { if (v < lo) lo = v; if (v > hi) hi = v; };
      for (let i = 0; i <= 120; i++) see(goal(i / 120 * TEND, true));
      sim.act.forEach(see); plans.forEach((pl) => pl.forEach((p) => see(p[1])));
      const pad = 0.12 * (hi - lo), ylo = lo - pad, yhi = hi + pad + 0.18 * (hi - lo);   // arriba, sitio para el rótulo del salto
      const X = (tt) => px0 + tt / TEND * pw, Y = (v) => py0 + ph - (v - ylo) / (yhi - ylo) * ph;
      V.svg('rect', { x: px0, y: py0, width: pw, height: ph, class: 'viz-rl-box' }, svg);
      for (let s = 0.5; s < TEND - 1e-9; s += 0.5) V.svg('path', { d: 'M' + r1(X(s)) + ' ' + py0 + 'V' + (py0 + ph), class: 'viz-rl-grid' }, svg);
      for (let s = 0; s <= TEND + 1e-9; s += 0.5) t(svg, X(s), py0 + ph + 13, s + ' s', 'viz-s', 'middle');
      // fronteras de chunk (consultas): marcas abajo; con ensamble, una por paso (demasiadas: una franja)
      if (state.exec !== 'ens') {
        let dq = '';
        sim.queries.forEach((q) => { dq += 'M' + r1(X(q / state.f)) + ' ' + (py0 + ph) + 'v-7'; });
        V.svg('path', { d: dq, class: 'viz-ac-q' }, svg);
        // predicciones de cada chunk (lo que planeó al consultar), tenues; las ejecutadas van encima
        plans.forEach((pl) => {
          if (pl.length < 2) return;
          V.svg('path', { d: pl.map((p, j) => (j ? 'L' : 'M') + r1(X(p[0])) + ' ' + r1(Y(p[1]))).join(''), class: 'viz-ac-plan' }, svg);
        });
      } else V.svg('rect', { x: px0, y: py0 + ph - 7, width: pw, height: 7, class: 'viz-ac-qband' }, svg);
      // objetivo verdadero y perturbación
      const tg = [];
      for (let i = 0; i <= 200; i++) { const tt = i / 200 * TEND; tg.push([X(tt), Y(goal(tt, true))]); }
      V.svg('path', { d: tg.map((p, i) => (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join(''), class: 'viz-ac-goal' }, svg);
      V.svg('path', { d: 'M' + r1(X(TD)) + ' ' + py0 + 'V' + (py0 + ph), class: 'viz-ac-dist' }, svg);
      t(svg, X(TD) + 4, py0 + 12, narrow ? 'salta' : 'el objeto salta', 'viz-ac-distt');
      // reacción: del salto a la primera consulta que lo ve
      if (sim.delay != null && sim.delay > 0) {
        const yR = py0 + 24;
        V.svg('path', { d: 'M' + r1(X(TD)) + ' ' + yR + 'H' + r1(X(TD + sim.delay)), class: 'viz-ac-delay' }, svg);
        t(svg, X(TD + sim.delay) + 4, yR + 4, Math.round(sim.delay * 1000) + ' ms', 'viz-ac-distt');
      }
      // acciones ejecutadas (un punto por paso de control, unidos en escalera)
      let d = '';
      for (let i = 0; i < sim.n; i++) { const x0 = X(i / state.f), x1 = X(Math.min(TEND, (i + 1) / state.f)), y = Y(sim.act[i]); d += (i ? 'L' : 'M') + r1(x0) + ' ' + r1(y) + 'H' + r1(x1); }
      V.svg('path', { d, class: 'viz-ac-exec' }, svg);
      // leyenda
      let ly = py0 + ph + 32;
      const item = (x, cls, s, box) => { if (box) V.svg('path', { d: 'M' + r1(x) + ' ' + (ly - 1) + 'v-7', class: cls }, svg); else V.svg('path', { d: 'M' + r1(x) + ' ' + r1(ly - 4) + 'h18', class: cls }, svg); t(svg, x + (box ? 6 : 23), ly, s, 'viz-s'); };
      const items = [['viz-ac-goal', 'objetivo real'], ['viz-ac-exec', 'acciones ejecutadas']].concat(state.exec === 'ens' ? [['viz-ac-q', 'consulta en cada paso', true]] : [['viz-ac-plan', 'lo que planeó cada chunk'], ['viz-ac-q', 'consulta (inferencia)', true]]);
      if (narrow) items.forEach((it) => { item(8, it[0], it[1], it[2]); ly += 14; });
      else { let x = 8; items.forEach((it) => { item(x, it[0], it[1], it[2]); x += 23 + it[1].length * 6.6 + 22; }); ly += 6; }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(ly + 4));
      svg.setAttribute('aria-label', 'Chunk de ' + state.H + ' acciones a ' + state.f + ' Hz: ' + r1(sim.qps) + ' consultas por segundo, reacción a la perturbación en ' + (sim.delay != null ? Math.round(sim.delay * 1000) + ' ms' : '—'));
      readout(sim);
    }
    function readout(sim) {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('un paso:', r1(1000 / state.f) + ' ms');
      kv('consultas/s:', r1(sim.qps) + ' (f / k = ' + state.f + ' / ' + sim.k + ')');
      kv('reacción (cubre la mitad del salto):', (sim.delay != null ? Math.round(sim.delay * 1000) + ' ms' : 'no llega en la ventana') + (state.exec === 'ens' ? '' : ' (espera a la consulta: hasta k / f = ' + Math.round(sim.k / state.f * 1000) + ' ms)'));
      kv(state.exec === 'ens' ? 'salto máx. entre pasos:' : 'salto máx. entre chunks:', sim.jumpMax == null ? '— (un solo cambio de chunk)' : sim.jumpMax.toFixed(3));
      kv('error RMS:', sim.rms.toFixed(3));
      note.innerHTML = 'Ilustrativo: un objetivo 1-D sintético y una política "casi perfecta" con un error chico que crece con el horizonte del chunk. Lo general: ejecutar k acciones por consulta divide las inferencias por k (a ' + state.f + ' Hz un paso son ' + r1(1000 / state.f) + ' ms; si la inferencia tarda más, consultar en cada paso no es posible) a cambio de reaccionar tarde (hasta k / f) y de saltos donde cambia el chunk. El ensamble temporal de ACT suaviza promediando los chunks que se solapan (pesos exp(−' + M + '·i), el más viejo pesa más), pero exige una inferencia por paso. π0 predice chunks de 50 acciones con flow matching; OpenVLA-OFT agregó chunks a OpenVLA.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
      ev.preventDefault();
      const i = Math.max(0, Math.min(HS.length - 1, HS.indexOf(state.H) + (k === 'ArrowRight' ? 1 : -1)));
      state.H = HS[i];
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('action-chunking', render);
})(typeof window !== 'undefined' ? window : globalThis);
