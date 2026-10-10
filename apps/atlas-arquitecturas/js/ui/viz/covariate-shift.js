/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/covariate-shift.js
   Visualización "covariate-shift" (SPEC §7.8, §27.3): por qué behavior cloning acumula errores y qué arreglan DAgger y el
   action chunking. Juguete ILUSTRATIVO (pista, ruido y política inventados); las cotas son las de los papers.
   Pista: un camino con curvas; el estado es el desvío lateral d (la pista mide |d| ≤ 1). Dinámica d_{t+1} = d_t + u_t + w_t,
   w_t ~ N(0, σ_w²). El experto corrige: u*(d) = −κ·d. Sus demostraciones (M corridas) solo visitan |d| ≤ D_0 (la banda de
   "estados vistos"). La política aprendida copia al experto DENTRO de lo visto (con un error chico ε_b) y FUERA extrapola mal:
       π(d) = u*(clip(d, −D, D)) + ε_b + sgn(d)·β·(|d| − D)₊ + σ_π·ξ_t   (ξ_t ~ N(0, 1): sus errores al azar)
   (fuera de lo visto deja de corregir más y su error crece con la distancia: un error lleva a estados nuevos, donde se
   equivoca más — el covariate shift). Con β > 0 hay un punto sin retorno en |d| = D·(1 + κ/β): de ahí se va de la pista.
   DAgger (Ross et al., AISTATS 2011, arXiv:1011.0686): correr la política, que el experto etiquete los estados que ELLA visitó,
   agregar y reentrenar: la banda de lo visto crece hasta cubrir los estados a los que la política llega (aquí, D ← máx |d|
   visitado por las corridas de la iteración anterior, hasta el borde de la pista).
   Cotas (costo extra respecto del experto, en unidades de ε = error por paso en la distribución de entrenamiento):
       BC: ≤ T²·ε (Ross y Bagnell, AISTATS 2010, Thm 2.1)
       DAgger: ≤ u·T·ε_N + O(1) (Ross et al. 2011, Thm 3.2; ε_N en las distribuciones de la propia política; aquí u = 1)
       action chunking de k pasos (ACT, Zhao et al. 2023, arXiv:2304.13705): el horizonte efectivo baja a ⌈T/k⌉ decisiones.
       En PASOS (la unidad de las otras dos curvas): ⌈T/k⌉ decisiones, cada error puede costar hasta T pasos →
       ⌈T/k⌉·T·ε ≈ T²·ε/k (heurístico, no un teorema; supone el mismo ε por chunk que por paso). Es una reducción de k
       veces, la que reclama el paper ("k-fold reduction"); contar en chunks (⌈T/k⌉²) la exageraría a k². Cuadra con el
       ejercicio (d) de la página: T = 100, k = 10, ε = 0.01 → costo exacto del juguete ≈ 5.3 pasos ≤ cota 10.
   k y la frecuencia de control salen del calculador (ATLAS.Arch.run / metrics de act-aloha).
   params: { config:'act-aloha', method:'bc'|'dagger', T:200, seed:0, k:<chunk> }
   Puro (sin DOM) para tests: ATLAS.Viz.covshift = { demos, policy, rollout, dagger, bounds }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9]{1,2}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const KAPPA = 0.3, SIG_W = 0.05, SIG_PI = 0.05, EPS_B = 0.02, BETA = 1, WIDTH = 1, M = 8, T_MAX = 500;

  const rngOf = (seed) => (ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(seed) : Math.random);
  const expert = (d) => -KAPPA * d;
  // demostraciones del experto: M corridas de T_MAX pasos; D_0 = máx |d| visitado
  function demos(seed) {
    const R = rngOf(seed || 2011); let D = 0;
    for (let m = 0; m < M; m++) { let d = 0.02 * R.normal(); for (let t = 0; t < T_MAX; t++) { d = d + expert(d) + SIG_W * R.normal(); D = Math.max(D, Math.abs(d)); } }
    return D;
  }
  function policy(d, D) {
    const c = Math.max(-D, Math.min(D, d));
    return expert(c) + EPS_B + Math.sign(d) * BETA * Math.max(0, Math.abs(d) - D);
  }
  // una corrida: se detiene al salir de la pista (|d| > 1). ruido con semilla propia
  function rollout(D, T, seed, isExpert) {
    const R = rngOf(seed); const ds = [0]; let d = 0, off = -1;
    for (let t = 0; t < T; t++) {
      const u = isExpert ? expert(d) : policy(d, D) + SIG_PI * R.normal();   // la aprendida también se equivoca al azar (σ_π)
      d = d + u + SIG_W * R.normal();
      ds.push(d);
      if (Math.abs(d) > WIDTH) { off = t + 1; break; }
    }
    return { ds, off };
  }
  // DAgger: la cobertura crece con lo que visitan las corridas de cada iteración (el experto etiqueta esos estados)
  function dagger(D0, T, iters, seed) {
    const hist = [D0]; let D = D0;
    for (let i = 0; i < iters; i++) {
      let vis = D;
      for (let m = 0; m < M; m++) { const ro = rollout(D, T, (seed || 0) * 977 + 5000 + 100 * i + m); ro.ds.forEach((x) => { vis = Math.max(vis, Math.min(WIDTH, Math.abs(x))); }); }
      D = vis; hist.push(D);
    }
    return hist;
  }
  // cotas en unidades de ε
  const bounds = (T, k) => ({ bc: T * T, dagger: T, chunk: Math.ceil(T / Math.max(1, k)) * T });

  function render(el, params) {
    const V = ATLAS.Viz, Ar = ATLAS.Arch;
    const cfgId = params.config || 'act-aloha';
    let run = null, met = null;
    try { run = Ar.run(cfgId); } catch (e) { run = null; }
    try { met = Ar.metrics(cfgId); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const pick = (o, ks, d) => { for (const k of ks) { const v = o ? k.split('.').reduce((a, p) => (a == null ? a : a[p]), o) : undefined; if (Number.isFinite(v)) return v; } return d; };
    const kCfg = Math.max(1, Math.round(pick(met, ['chunk', 'actionsPerInference'], pick(cfg, ['chunk', 'k', 'chunkSize'], 100))));
    const hz = pick(met, ['controlHz'], pick(cfg, ['controlHz', 'hz'], 50));
    const KS = [1, 10]; if (KS.indexOf(kCfg) < 0) KS.push(kCfg);
    const num = (v, d) => (Number.isFinite(+v) && v != null && v !== '' ? +v : d);
    const state = {
      method: params.method === 'dagger' ? 'dagger' : 'bc',
      T: Math.max(20, Math.min(T_MAX, Math.round(num(params.T, 200)))),
      seed: Math.max(0, Math.round(num(params.seed, 0))),
      k: KS.indexOf(+params.k) >= 0 ? +params.k : kCfg,
      sel: null,          // null = la primera corrida que se sale (o la 0)
    };
    const D0 = demos(2011);

    const wrap = V.html('div', { class: 'viz viz-cs' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const all = [];
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const chips = (g, vals, key, label) => vals.forEach((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._k = key; b._v = v; all.push(b); });
    chips(grp('Política'), ['bc', 'dagger'], 'method', (v) => (v === 'bc' ? 'behavior cloning' : 'DAgger (1 iteración)'));
    chips(grp('Chunk k (cotas)'), KS, 'k', (v) => String(v) + (v === kCfg ? ' (config)' : ''));
    const gT = V.html('label', { class: 'viz-ctl viz-pc-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Pasos T' }, gT);
    const inT = V.html('input', { type: 'range', min: 20, max: T_MAX, step: 10, 'aria-label': 'Largo del episodio T en pasos de control (20 a ' + T_MAX + ')' }, gT);
    const outT = V.html('output', { class: 'viz-pc-out' }, gT);
    inT.addEventListener('input', () => { state.T = +inT.value; draw(); });
    const bS = V.html('button', { type: 'button', class: 'viz-chip', text: 'otro ruido' }, ctl);
    bS.addEventListener('click', () => { state.seed++; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-cs-stage', tabindex: 0, role: 'group', 'aria-label': 'Behavior cloning contra DAgger en una pista. Flechas izquierda y derecha: largo del episodio; arriba y abajo: elegir la corrida resaltada; D: cambiar la política' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      inT.value = state.T; outT.textContent = state.T + ' (' + (state.T / hz).toFixed(1) + ' s a ' + hz + ' Hz)';
      const hist = state.method === 'dagger' ? dagger(D0, state.T, 1, state.seed) : [D0];   // una iteración basta en el juguete: la 2.ª ya no sale de lo visto y no agrega estados
      const D = hist[hist.length - 1];
      const runs = []; for (let m = 0; m < M; m++) runs.push(rollout(D, state.T, state.seed * 977 + 31 + m));
      const selI = state.sel != null ? state.sel : Math.max(0, runs.findIndex((r) => r.off >= 0));
      const exp = rollout(D, state.T, state.seed * 977 + 31 + selI, true);
      const nOff = runs.filter((r) => r.off >= 0).length;
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(520, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? (state.method === 'bc' ? 'Behavior cloning: un error lleva a estados no vistos' : 'DAgger: el experto etiqueta lo que visita la política') : (state.method === 'bc' ? 'Behavior cloning: un error chico lleva a estados que nunca vio, donde se equivoca más' : 'DAgger: la política maneja, el experto etiqueta esos estados, se reentrena'), 'viz-t');
      t(svg, 8, 29, narrow ? M + ' corridas · ' + state.T + ' pasos · vistos: |d| ≤ ' + D.toFixed(2) : M + ' corridas de ' + state.T + ' pasos · banda: estados vistos en el entrenamiento (|d| ≤ ' + D.toFixed(2) + ')', 'viz-s');

      // ---- la pista: centro c(s), normal n(s); el desvío d se dibuja a escala (|d| = 1 = borde)
      const x0 = 16, x1 = W - 16, yc = 56 + (narrow ? 70 : 80), amp = narrow ? 34 : 50, half = narrow ? 26 : 30;
      const S = state.T;
      const cen = (s) => { const u = s / S; return [x0 + (x1 - x0) * u, yc + amp * Math.sin(2 * Math.PI * 1.25 * u)]; };
      const nor = (s) => { const u = s / S; const dy = amp * 2 * Math.PI * 1.25 * Math.cos(2 * Math.PI * 1.25 * u) / S, dx = (x1 - x0) / S; const L = Math.hypot(dx, dy); return [-dy / L, dx / L]; };
      const pos = (s, d) => { const c = cen(s), n = nor(s); return [c[0] + n[0] * d * half, c[1] + n[1] * d * half]; };
      const band = (w, cls) => {
        let a = '', b = '';
        for (let s = 0; s <= S; s += Math.max(1, S / 120)) { const p = pos(s, w), q = pos(s, -w); a += (a ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); b = 'L' + r1(q[0]) + ' ' + r1(q[1]) + b; }
        const p = pos(S, w), q = pos(S, -w);
        V.svg('path', { d: a + 'L' + r1(p[0]) + ' ' + r1(p[1]) + 'L' + r1(q[0]) + ' ' + r1(q[1]) + b + 'Z', class: cls }, svg);
      };
      band(WIDTH, 'viz-cs-road');
      band(Math.min(WIDTH, D), 'viz-cs-cov');
      const edge = (w) => { let dd = ''; for (let s = 0; s <= S; s += Math.max(1, S / 120)) { const p = pos(s, w); dd += (dd ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); } const p = pos(S, w); dd += 'L' + r1(p[0]) + ' ' + r1(p[1]); V.svg('path', { d: dd, class: 'viz-cs-edge' }, svg); };
      edge(WIDTH); edge(-WIDTH);
      const path = (ds, cls) => { let dd = ''; ds.forEach((d, s) => { const p = pos(s, Math.max(-1.6, Math.min(1.6, d))); dd += (s ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1]); }); return V.svg('path', { d: dd, class: cls }, svg); };
      runs.forEach((ro, m) => { if (m !== selI) path(ro.ds, 'viz-cs-run' + (ro.off >= 0 ? ' is-off' : '')); });
      path(exp.ds, 'viz-cs-exp');
      const cur = runs[selI];
      path(cur.ds, 'viz-cs-run is-sel' + (cur.off >= 0 ? ' is-off' : ''));
      runs.forEach((ro) => { if (ro.off >= 0) { const p = pos(ro.off, Math.sign(ro.ds[ro.ds.length - 1]) * 1.25); V.svg('path', { d: 'M' + r1(p[0] - 4) + ' ' + r1(p[1] - 4) + 'l8 8M' + r1(p[0] + 4) + ' ' + r1(p[1] - 4) + 'l-8 8', class: 'viz-cs-x' }, svg); } });
      { const c = cen(0); t(svg, c[0] + 2, c[1] - half - 6, 'inicio', 'viz-s'); }
      t(svg, x1, yc + amp + half + 18, 'paso ' + S, 'viz-s', 'end');

      // ---- desvío |d| en el tiempo (la corrida resaltada), con D y el punto sin retorno
      const y2 = yc + amp + half + 46, h2 = narrow ? 70 : 80, gx0 = 44, gw = W - 60;
      const GX = (s) => gx0 + gw * s / S, GY = (v) => y2 + h2 - h2 * Math.min(1.3, Math.abs(v)) / 1.3;
      t(svg, gx0, y2 - 6, narrow ? '|d| de la corrida resaltada' : '|d| de la corrida resaltada: dentro de la banda corrige; fuera, el error crece', 'viz-n');
      V.svg('rect', { x: gx0, y: r1(y2), width: r1(gw), height: h2, class: 'viz-pc-bg' }, svg);
      V.svg('rect', { x: gx0, y: r1(GY(Math.min(WIDTH, D))), width: r1(gw), height: r1(y2 + h2 - GY(Math.min(WIDTH, D))), class: 'viz-cs-cov' }, svg);
      const pnr = D * (1 + KAPPA / BETA);
      if (pnr < 1.3) { V.svg('path', { d: 'M' + gx0 + ' ' + r1(GY(pnr)) + 'H' + r1(gx0 + gw), class: 'viz-cs-pnr' }, svg); t(svg, gx0 + gw - 4, GY(pnr) - 3, 'sin retorno', 'viz-s', 'end'); }
      V.svg('path', { d: 'M' + gx0 + ' ' + r1(GY(1)) + 'H' + r1(gx0 + gw), class: 'viz-cs-edge' }, svg);
      t(svg, gx0 - 5, GY(1) + 4, '1', 'viz-s', 'end'); t(svg, gx0 - 5, GY(0) + 4, '0', 'viz-s', 'end');
      let dd = ''; cur.ds.forEach((d, s) => { dd += (s ? 'L' : 'M') + r1(GX(s)) + ' ' + r1(GY(d)); });
      V.svg('path', { d: dd, class: 'viz-cs-dline' + (cur.off >= 0 ? ' is-off' : '') }, svg);

      // ---- cotas: costo extra / ε vs T (escala log)
      const y3 = y2 + h2 + 48, h3 = narrow ? 110 : 120, w3 = narrow ? gw : Math.min(gw, 520);
      const TM = T_MAX, LX = (T) => gx0 + w3 * Math.log10(T) / Math.log10(TM), LY = (v) => y3 + h3 - h3 * Math.log10(Math.max(1, v)) / Math.log10(TM * TM);
      t(svg, gx0, y3 - 6, narrow ? 'Cotas del costo extra (en unidades de ε)' : 'Cotas del costo extra respecto del experto, en unidades de ε (escalas log)', 'viz-n');
      V.svg('rect', { x: gx0, y: r1(y3), width: r1(w3), height: h3, class: 'viz-pc-bg' }, svg);
      const curve = (f, cls) => { let p = ''; for (let i = 0; i <= 120; i++) { const T = Math.pow(TM, i / 120); p += (i ? 'L' : 'M') + r1(LX(T)) + ' ' + r1(LY(f(T))); } V.svg('path', { d: p, class: cls }, svg); };
      curve((T) => bounds(T, state.k).bc, 'viz-cs-bc');
      curve((T) => bounds(T, state.k).dagger, 'viz-cs-dg');
      curve((T) => bounds(Math.round(T), state.k).chunk, 'viz-cs-ch');
      V.svg('path', { d: 'M' + r1(LX(state.T)) + ' ' + r1(y3) + 'V' + r1(y3 + h3), class: 'viz-pc-cur' }, svg);
      [1, 10, 100].concat(TM >= 500 ? [TM] : []).forEach((v) => t(svg, LX(v), y3 + h3 + 13, String(v), 'viz-s', 'middle'));
      [1, 1e2, 1e4].forEach((v, i) => t(svg, gx0 - 5, LY(v) + 4, ['1', '10²', '10⁴'][i], 'viz-s', 'end'));
      t(svg, gx0 + w3, y3 + h3 + 26, 'T', 'viz-n', 'end');
      let ly = narrow ? y3 + h3 + 44 : y3 + 12, lx = narrow ? 8 : gx0 + w3 + 22;
      const B = bounds(state.T, state.k);
      const fmtN = (v) => (ATLAS.Arch && ATLAS.Arch.fmt && ATLAS.Arch.fmt.int ? ATLAS.Arch.fmt.int(v) : String(v));
      const leg = [['viz-cs-bc', 'BC: T² → ' + fmtN(B.bc)], ['viz-cs-dg', 'DAgger: u·T, u = 1 → ' + fmtN(B.dagger)], ['viz-cs-ch', 'chunks de ' + state.k + ': ⌈T/k⌉·T → ' + fmtN(B.chunk)], ['viz-cs-exp', 'experto (pista)'], ['viz-cs-run', 'política (pista)']];
      leg.forEach(([c, s]) => {
        const iw = 26 + s.length * 6.5 + 12;
        if (narrow && lx > 8 && lx + iw > W - 8) { lx = 8; ly += 16; }
        V.svg('path', { d: 'M' + lx + ' ' + (ly - 4) + 'h18', class: c }, svg);
        t(svg, lx + 24, ly, s, 'viz-s');
        if (narrow) lx += iw; else ly += 16;
      });
      const H2 = narrow ? ly + 12 : Math.max(y3 + h3 + 34, ly);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(H2));
      svg.setAttribute('aria-label', (state.method === 'bc' ? 'Behavior cloning' : 'DAgger') + ' con episodios de ' + state.T + ' pasos: ' + nOff + ' de ' + M + ' corridas se salen de la pista. Cotas en unidades de ε: BC ' + B.bc + ', DAgger ' + B.dagger + ', chunks de ' + state.k + ': ' + B.chunk + '.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('se salen de la pista:', nOff + ' de ' + M + ' corridas' + (cur.off >= 0 ? ' (la resaltada, en el paso ' + cur.off + ')' : ''));
      kv('estados vistos |d| ≤', hist.map((x) => x.toFixed(2)).join(' → ') + (state.method === 'dagger' ? ' (demos → iteración 1)' : ' (solo demos del experto)'));
      kv('punto sin retorno |d| ≈', pnr.toFixed(2) + (pnr >= WIDTH ? ' (fuera de la pista: no hay)' : ''));
      kv('decisiones por episodio:', state.T + ' paso a paso · ' + Math.ceil(state.T / state.k) + ' con chunks de ' + state.k);
      kv('config ' + ((run && run.label) || cfgId) + ':', 'k = ' + kCfg + ' acciones por inferencia a ' + hz + ' Hz');
      note.innerHTML = sub('Juguete: el experto corrige hacia el centro y sus demostraciones casi nunca se alejan; la política copia bien DENTRO de la banda (con un sesgo chico) y extrapola mal FUERA. Un desvío por ruido la saca de lo visto, ahí corrige menos, se aleja más: el error se compone y la probabilidad de salirse crece con el largo del episodio (la cota de BC crece como T²). DAgger deja manejar a la política, pide al experto la acción correcta en los estados a los que ELLA llega y reentrena con todo junto: la banda cubre lo que la política visita y la cota crece como u·T·ε_N (lineal si los errores son recuperables, u = O(1); ε_N es el error en los estados que visita la propia política). Action chunking (ACT) no agrega datos: predice k acciones por inferencia, así que hay ⌈T/k⌉ decisiones en lugar de T; contada en pasos, la cota baja de T² a ⌈T/k⌉·T ≈ T²/k, k veces (el argumento del paper aplicado a la cota de BC; heurístico: cada chunk puede equivocarse más y se ejecuta sin realimentación entre inferencias, por eso ACT promedia chunks solapados con temporal ensembling).');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.T = Math.max(20, Math.min(T_MAX, state.T + (k === 'ArrowRight' ? 10 : -10))); draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); state.sel = ((state.sel == null ? 0 : state.sel) + (k === 'ArrowUp' ? 1 : M - 1)) % M; draw(); }
      else if (k === 'd' || k === 'D') { ev.preventDefault(); state.method = state.method === 'bc' ? 'dagger' : 'bc'; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.covshift = { demos, policy, rollout, dagger, bounds, KAPPA, BETA, EPS_B, SIG_W, SIG_PI };
    ATLAS.Viz.register('covariate-shift', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
