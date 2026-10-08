/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/moe-router.js
   Visualización "moe-router" (SPEC §7.8, §18.3): el router de una capa MoE (Mixtral 8×7B) manda cada
   token a sus top-k expertos (k = 2 de E = 8): softmax sobre los logits del router, se quedan los k
   mayores, sus pesos se renormalizan y la salida es la suma ponderada de esos k FFN (SwiGLU).
   A la izquierda, los tokens; en el medio, los E expertos con las aristas de cada token a sus k elegidos
   (grosor ∝ peso); a la derecha, las probabilidades del token elegido y la CARGA de cada experto
   (cuántas asignaciones recibe) frente a la ideal T·k/E. Dos routers sintéticos: uno balanceado (como
   lo deja la pérdida auxiliar de balanceo) y uno colapsado (sin esa pérdida, unos pocos expertos se
   llevan casi todo). Opcional: la capacidad fija de Switch/GShard (tokens que desbordan).
   Lo ilustrativo: los tokens y los logits del router. Del calculador: E, k, parámetros totales y activos
   por token (config mixtral-8x7b).
   params: { config:'mixtral-8x7b', mode:'balanced'|'collapsed', token:1, capacity:false }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const WORDS = ['Los', 'gatos', 'duermen', 'en', 'la', 'alfombra', 'porque', 'afuera', 'hace', 'frío', 'y', 'llueve'];
  const CF = 1.25;

  function cfgVal(c, keys, d) { for (const k of keys) { const v = c && c[k]; if (Number.isFinite(v)) return v; } return d; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n) };
    const cfgId = params.config || 'mixtral-8x7b';
    let run = null, met = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { met = A.metrics(cfgId, {}); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const E = Math.max(2, Math.round(cfgVal(cfg, ['nExperts', 'experts', 'E', 'numExperts', 'nExp'], 8)));
    const K = Math.max(1, Math.min(E, Math.round(cfgVal(cfg, ['topK', 'topk', 'k', 'expertsPerToken'], 2))));
    const T = WORDS.length;
    const state = { mode: params.mode === 'collapsed' ? 'collapsed' : 'balanced', tok: Math.max(0, Math.min(T - 1, Number.isFinite(+params.token) ? +params.token : 1)), cap: !!params.capacity };

    // logits sintéticos (semilla fija). El colapsado favorece a 2 expertos (sesgo + afinidad): es lo que pasa
    // sin la pérdida de balanceo: los que reciben más tokens se entrenan más y el router los elige aún más.
    const rnd = V.rng(81);
    const base = WORDS.map(() => Array.from({ length: E }, () => rnd.normal()));
    // balanceado: cada token prefiere un par de expertos distinto, y los pares cubren a los E expertos por igual
    // (lo que la pérdida de balanceo empuja a que pase); colapsado: casi todos prefieren los mismos dos
    const PREF = [[0, 5], [3, 6], [1, 7], [2, 4], [5, 1], [6, 0], [4, 3], [7, 2], [1, 6], [0, 4], [2, 5], [3, 7]];
    function logits(t) {
      const b = base[t];
      if (state.mode === 'balanced') { const pr = PREF[t % PREF.length]; return b.map((x, e) => 0.35 * x + (e === pr[0] % E ? 2.1 : e === pr[1] % E ? 1.7 : 0)); }
      return b.map((x, e) => 0.6 * x + (e === 2 % E ? 2.4 : e === 5 % E ? 1.7 : 0));
    }
    const softmax = (z) => { const m = Math.max(...z); const ex = z.map((x) => Math.exp(x - m)); const s = ex.reduce((a, b) => a + b, 0); return ex.map((x) => x / s); };
    function route() {
      const rows = WORDS.map((_, t) => {
        const p = softmax(logits(t));
        const top = p.map((v, e) => [v, e]).sort((a, b) => b[0] - a[0]).slice(0, K);
        const s = top.reduce((a, x) => a + x[0], 0);
        return { p, top: top.map(([v, e]) => ({ e, w: v / s })) };
      });
      const load = Array(E).fill(0), over = Array(E).fill(0);
      const cap = Math.ceil(CF * T * K / E);
      const dropped = new Set();
      rows.forEach((r, t) => r.top.forEach((x) => { load[x.e]++; if (state.cap && load[x.e] > cap) { over[x.e]++; dropped.add(t + ':' + x.e); } }));
      const f = load.map((c) => c / (T * K));
      const P = Array.from({ length: E }, (_, e) => rows.reduce((a, r) => a + r.p[e], 0) / T);
      const aux = E * f.reduce((a, fi, i) => a + fi * P[i], 0);
      return { rows, load, over, cap, dropped, aux };
    }

    const wrap = V.html('div', { class: 'viz viz-moe' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Router' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Router' }, g1);
    const bBal = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'balanceado (con pérdida auxiliar)' }, g1);
    const bCol = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'colapsado (sin ella)' }, g1);
    bBal.addEventListener('click', () => { state.mode = 'balanced'; draw(); });
    bCol.addEventListener('click', () => { state.mode = 'collapsed'; draw(); });
    const g2 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Capacidad' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Capacidad' }, g2);
    const bCap = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'aplicar capacidad (CF = ' + CF + ', Switch)' }, g2);
    bCap.addEventListener('click', () => { state.cap = !state.cap; draw(); });
    const stage = V.html('div', { class: 'viz-stage viz-moe-stage', tabindex: 0, role: 'group', 'aria-label': 'Tokens enrutados a expertos. Flechas arriba y abajo: elegir un token' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const tot = run && run.totals ? run.totals.params : null;
    const act = met && Number.isFinite(met.activeParams) ? met.activeParams : null;
    V.html('p', { class: 'viz-note' }, wrap, 'Ilustrativo: los ' + T + ' tokens y los logits del router (aleatorios con semilla fija). Del calculador (' + ((run && run.label) || cfgId) + '): E = ' + E + ' expertos y top-k = ' + K +
      (tot ? '; ' + fmt.si(tot) + ' parámetros en total' : '') + (act ? ' pero solo ≈ ' + fmt.si(act) + ' activos por token (atención, normas, embeddings y ' + K + ' de los ' + E + ' FFN)' : '') + '. ' +
      'El router es una sola matriz d × E: logits → softmax → se quedan los ' + K + ' mayores y sus pesos se renormalizan (suman 1); la salida es Σ w·FFN<sub>e</sub>(x) solo sobre esos ' + K + '. ' +
      'Sin una pérdida auxiliar de balanceo el router colapsa en pocos expertos (los demás casi no se entrenan y, en paralelo de expertos, unas GPUs esperan a otras). La pérdida de Switch Transformer, E·Σ f<sub>i</sub>·P<sub>i</sub> (f<sub>i</sub> = fracción de asignaciones, P<sub>i</sub> = probabilidad media), vale 1 si todo está parejo y crece con el desbalance (la implementación de Mixtral en HF la incluye: router_aux_loss_coef). ' +
      'La capacidad fija (Switch, GShard) corta lo que pasa de CF·T·k/E por experto y esos tokens solo siguen por la residual; las implementaciones de inferencia de Mixtral (HF, vLLM) no descartan tokens: cada experto procesa todos los que le tocan. El paper de Mixtral no habla de capacidad; cita MegaBlocks (MoE "dropless") para hacerlo eficiente.');

    let lastNarrow = null;
    function draw() {
      bBal.setAttribute('aria-pressed', String(state.mode === 'balanced'));
      bCol.setAttribute('aria-pressed', String(state.mode === 'collapsed'));
      bCap.setAttribute('aria-pressed', String(state.cap));
      const R = route();
      const cw = stage.clientWidth || 860;
      const narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? 360 : 880;
      const rowE = 30, top = narrow ? 44 : 58, hE = E * rowE;
      const rowT = hE / T;
      const tx = 8, tw = narrow ? 96 : 104;
      const ex = narrow ? 238 : 300, ew = narrow ? 52 : 64;
      const bx = narrow ? 30 : 470, bw = narrow ? 110 : 150;           // barras: probabilidades del token
      const lx = narrow ? 204 : 690, lw = narrow ? 116 : 170;          // barras: carga por experto
      const yB = narrow ? top + hE + 54 : top;                          // en el teléfono, las barras van debajo
      const Hh = (narrow ? yB + hE + 48 : top + hE + 48) + 16;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img', 'aria-label': ariaOf(R) }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, tx, 15, 'Cada token va a sus top-' + K + ' de ' + E + ' expertos (grosor ∝ peso)', 'viz-t');
      t(svg, tx, 31, narrow ? 'toca un token para ver su router' : 'toca o elige con ↑/↓ un token para ver las probabilidades de su router', 'viz-s');
      const yT = (i) => top + i * rowT + rowT / 2, yE = (e) => top + e * rowE + rowE / 2;
      // aristas token → experto (primero las no elegidas, luego las del token elegido, encima)
      const lines = V.svg('g', { class: 'viz-moe-lines' }, svg);
      const sel = [];
      R.rows.forEach((r, i) => r.top.forEach((x) => {
        const d = 'M' + (tx + tw) + ' ' + r1(yT(i)) + 'C' + r1((tx + tw + ex) / 2) + ' ' + r1(yT(i)) + ' ' + r1((tx + tw + ex) / 2) + ' ' + r1(yE(x.e)) + ' ' + ex + ' ' + r1(yE(x.e));
        const drop = R.dropped.has(i + ':' + x.e);
        const p = { d, class: 'viz-moe-ln' + (i === state.tok ? ' is-sel' : '') + (drop ? ' is-drop' : ''), 'stroke-width': r1(0.8 + 3.6 * x.w) };
        if (i === state.tok) sel.push(p); else V.svg('path', p, lines);
      }));
      sel.forEach((p) => V.svg('path', p, lines));
      // tokens
      WORDS.forEach((w, i) => {
        const g = V.svg('g', { class: 'viz-cell-btn viz-moe-tok' + (i === state.tok ? ' is-sel' : ''), transform: 'translate(' + tx + ',' + r1(yT(i) - rowT / 2 + 1.5) + ')' }, svg);
        V.svg('rect', { x: 0, y: 0, width: tw, height: r1(rowT - 3), rx: 3, class: 'viz-moe-tokbox' }, g);
        t(g, 8, rowT / 2 + 2.5, w, 'viz-moe-toktxt');
        g.addEventListener('click', () => { state.tok = i; draw(); });
      });
      // expertos (los k del token elegido, llenos)
      const chosen = new Set(R.rows[state.tok].top.map((x) => x.e));
      for (let e = 0; e < E; e++) {
        const g = V.svg('g', { class: 'viz-moe-exp' + (chosen.has(e) ? ' is-on' : '') }, svg);
        V.svg('rect', { x: ex, y: r1(top + e * rowE + 3), width: ew, height: rowE - 6, rx: 4, class: 'viz-moe-ebox' }, g);
        t(g, ex + ew / 2, yE(e) + 4, 'FFN ' + e, 'viz-moe-etxt', 'middle');
      }
      // barras: p(experto | token) del token elegido, con los k elegidos marcados
      const r0 = R.rows[state.tok];
      const pmax = Math.max(...r0.p);
      t(svg, bx, yB - 8, 'router de «' + WORDS[state.tok] + '»', 'viz-s');
      if (narrow) for (let e = 0; e < E; e++) t(svg, bx - 6, yE(e) - top + yB + 4, 'E' + e, 'viz-s', 'end');
      for (let e = 0; e < E; e++) {
        const y = yE(e) - top + yB;
        V.svg('rect', { x: bx, y: r1(y - 8), width: bw, height: 16, class: 'viz-moe-track' }, svg);
        const on = chosen.has(e);
        V.svg('rect', { x: bx, y: r1(y - 8), width: r1(Math.max(1, bw * r0.p[e] / pmax)), height: 16, class: 'viz-moe-bar' + (on ? ' is-on' : '') }, svg);
        t(svg, bx + bw + 6, y + 4, r0.p[e].toFixed(2), on ? 'viz-n' : 'viz-s');
      }
      // barras: carga por experto (asignaciones) frente a la ideal T·k/E y, si está activa, la capacidad
      const ideal = T * K / E;
      const lmax = Math.max(...R.load, R.cap, ideal) * 1.05;
      t(svg, lx, yB - 8, narrow ? 'carga (de ' + T * K + ')' : 'carga (de ' + T * K + ' asignaciones)', 'viz-s');
      for (let e = 0; e < E; e++) {
        const y = yE(e) - top + yB;
        V.svg('rect', { x: lx, y: r1(y - 8), width: lw, height: 16, class: 'viz-moe-track' }, svg);
        const kept = R.load[e] - R.over[e];
        V.svg('rect', { x: lx, y: r1(y - 8), width: r1(lw * kept / lmax), height: 16, class: 'viz-moe-load' }, svg);
        if (R.over[e]) V.svg('rect', { x: r1(lx + lw * kept / lmax), y: r1(y - 8), width: r1(lw * R.over[e] / lmax), height: 16, class: 'viz-moe-over' }, svg);
        t(svg, lx + lw + 6, y + 4, String(R.load[e]), 'viz-n');
      }
      const xi = lx + lw * ideal / lmax;
      V.svg('path', { d: 'M' + r1(xi) + ' ' + (yB - 2) + 'V' + (yB + hE + 2), class: 'viz-moe-ideal' }, svg);
      t(svg, xi, yB + hE + 15, 'ideal ' + (+ideal.toFixed(2)), 'viz-s', 'middle');
      if (state.cap) {
        const xc = lx + lw * R.cap / lmax;
        V.svg('path', { d: 'M' + r1(xc) + ' ' + (yB - 2) + 'V' + (yB + hE + 2), class: 'viz-moe-cap' }, svg);
        t(svg, xc, yB + hE + 30, 'capacidad ' + R.cap, 'viz-moe-captxt', 'middle');
      }
      readout(R);
    }

    function readout(R) {
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      const r0 = R.rows[state.tok];
      kv('«' + WORDS[state.tok] + '» →', r0.top.map((x) => (+x.w.toFixed(2)) + '·FFN' + x.e).join(' + '));
      kv('pérdida de balanceo E·Σ fᵢ·Pᵢ =', R.aux.toFixed(2) + ' (1 = parejo)');
      kv('carga máx / ideal =', (Math.max(...R.load) / (T * K / E)).toFixed(2) + '×');
      if (state.cap) kv('desbordan:', R.over.reduce((a, b) => a + b, 0) + ' asignaciones (siguen solo por la residual)');
    }
    function ariaOf(R) {
      const r0 = R.rows[state.tok];
      return 'Token «' + WORDS[state.tok] + '» enrutado a ' + r0.top.map((x) => 'experto ' + x.e + ' con peso ' + x.w.toFixed(2)).join(' y ') + '. Carga por experto: ' + R.load.join(', ') + '.';
    }

    stage.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); state.tok = Math.max(0, Math.min(T - 1, state.tok + (ev.key === 'ArrowDown' ? 1 : -1))); draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('moe-router', render);
})(typeof window !== 'undefined' ? window : globalThis);
