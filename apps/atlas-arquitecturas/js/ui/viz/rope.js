/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/rope.js
   Visualización "rope" (SPEC §7.8, §18.3): RoPE (Su et al., RoFormer) rota cada par de componentes
   (x_{2i}, x_{2i+1}) de q y de k por un ángulo posición·θ_i, con θ_i = b^(−2i/d). Un "reloj" por par:
   q (en la posición m) gira m·θ_i, k (en la posición n) gira n·θ_i; el ángulo entre los dos es
   (m − n)·θ_i, así que q·k solo depende de la distancia m − n (no de m y n por separado).
   Abajo, la curva q·k en función de m − n (la misma para cualquier m y n con esa diferencia).
   Lo ilustrativo: q y k (vectores sintéticos de d = 8, 4 pares) y la base b = 100 (para que los 4 relojes
   giren a la vista). Lo real (del calculador): d_h y θ de la config, en la nota (pares, frecuencias y
   longitud de onda del par más lento).
   params: { config:'llama3-8b', m:5, n:2 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const D = 8, PAIRS = D / 2, BASE = 100, MAXP = 24;

  function cfgVal(c, keys, d) { for (const k of keys) { const v = c && c[k]; if (Number.isFinite(v)) return v; } return d; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n) };
    const cfgId = params.config || 'llama3-8b';
    let cfg = {}, label = cfgId;
    try { const r = A.run(cfgId); cfg = r.config || {}; label = r.label || cfgId; } catch (e) { cfg = {}; }
    const dh = Math.round(cfgVal(cfg, ['dh', 'dHead', 'd_h', 'headDim'], 128));
    const theta = cfgVal(cfg, ['ropeTheta', 'theta', 'rope_theta', 'ropeBase'], 500000);

    // q y k sintéticos (semilla fija) y las frecuencias del juguete
    const rnd = V.rng(20240);
    const q = Array.from({ length: D }, () => +(rnd.normal() * 0.9).toFixed(2));
    const k = Array.from({ length: D }, () => +(rnd.normal() * 0.9).toFixed(2));
    const th = Array.from({ length: PAIRS }, (_, i) => Math.pow(BASE, -2 * i / D));
    const clampP = (v) => Math.max(0, Math.min(MAXP, v));
    const state = { m: clampP(Number.isFinite(+params.m) ? +params.m : 5), n: clampP(Number.isFinite(+params.n) ? +params.n : 2), moved: false };

    const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    // producto punto de q rotado (pos. m) y k rotado (pos. n), y su aporte por par
    function score(m, n) {
      const per = [];
      for (let i = 0; i < PAIRS; i++) {
        const a = rot(q[2 * i], q[2 * i + 1], m * th[i]), b = rot(k[2 * i], k[2 * i + 1], n * th[i]);
        per.push(a[0] * b[0] + a[1] * b[1]);
      }
      return { per, s: per.reduce((x, y) => x + y, 0) };
    }

    const wrap = V.html('div', { class: 'viz viz-rope' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const mk = (parent, label, fn, aria) => { const b = V.html('button', { type: 'button', class: 'viz-chip', text: label, 'aria-label': aria || label }, parent); b.addEventListener('click', fn); return b; };
    const gm = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Posición de la query' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'q en m' }, gm);
    const bm0 = mk(gm, '−', () => set(state.m - 1, state.n), 'm menos 1');
    const mOut = V.html('span', { class: 'viz-rope-pos' }, gm);
    const bm1 = mk(gm, '+', () => set(state.m + 1, state.n), 'm más 1');
    const gn = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Posición de la key' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'k en n' }, gn);
    const bn0 = mk(gn, '−', () => set(state.m, state.n - 1), 'n menos 1');
    const nOut = V.html('span', { class: 'viz-rope-pos' }, gn);
    const bn1 = mk(gn, '+', () => set(state.m, state.n + 1), 'n más 1');
    const gb = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Desplazar las dos posiciones' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Las dos' }, gb);
    const bb0 = mk(gb, '← ambos −1', () => set(state.m - 1, state.n - 1, true));
    const bb1 = mk(gb, 'ambos +1 →', () => set(state.m + 1, state.n + 1, true));
    const stage = V.html('div', { class: 'viz-stage viz-rope-stage', tabindex: 0, role: 'group', 'aria-label': 'Relojes de RoPE. Flechas izquierda y derecha: mover la query (m); arriba y abajo: mover la key (n); Mayúsculas con flecha: mover las dos' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const pairsReal = Math.round(dh / 2);
    const slowWave = 2 * Math.PI * Math.pow(theta, (dh - 2) / dh);
    V.html('p', { class: 'viz-note' }, wrap, 'Ilustrativo: q y k son vectores sintéticos de d = ' + D + ' (' + PAIRS + ' pares) y la base del juguete es b = ' + BASE +
      ' (θ<sub>i</sub> = b<sup>−2i/d</sup> = ' + th.map((t) => +t.toFixed(3)).join(', ') + ' rad por posición), para que los relojes giren a la vista. ' +
      'RoPE no suma nada al vector: lo <b>rota</b>. Cada par (x<sub>2i</sub>, x<sub>2i+1</sub>) de q gira m·θ<sub>i</sub> y el de k gira n·θ<sub>i</sub>; el producto punto de dos vectores rotados depende solo del ángulo ENTRE ellos, (m − n)·θ<sub>i</sub>. ' +
      'Por eso «ambos +1» no cambia q·k: la atención ve la distancia relativa, aunque cada token lleve su posición absoluta. Se aplica a q y a k (no a v), después de las proyecciones y antes de QKᵀ, en cada capa. ' +
      'En ' + label + ' (del calculador): d<sub>h</sub> = ' + dh + ' → ' + pairsReal + ' pares por cabeza, base θ = ' + fmt.int(theta) + '; el par más rápido gira 1 rad por posición y el más lento da una vuelta cada ≈ ' + fmt.int(Math.round(slowWave)) + ' posiciones (por eso una base grande sirve para contextos largos).');

    function set(m, n, both) {
      const nm = clampP(m), nn = clampP(n);
      if (both && (nm !== m || nn !== n)) return;   // "ambos" solo si los dos pueden moverse
      state.m = nm; state.n = nn; state.moved = !!both;
      draw();
    }

    let lastNarrow = null;
    function draw() {
      mOut.textContent = 'm = ' + state.m; nOut.textContent = 'n = ' + state.n;
      bm0.disabled = state.m <= 0; bm1.disabled = state.m >= MAXP; bn0.disabled = state.n <= 0; bn1.disabled = state.n >= MAXP;
      bb0.disabled = state.m <= 0 || state.n <= 0; bb1.disabled = state.m >= MAXP || state.n >= MAXP;
      const cw = stage.clientWidth || 860;
      const narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const cols = narrow ? 2 : 4, R = narrow ? 50 : 60, CW = R * 2 + (narrow ? 36 : 76), CH = R * 2 + 64;
      const W = cols * CW + 16;
      const KEY = 16;   // franja de la clave (qué flecha es q y cuál k)
      const plotY = 34 + KEY + Math.ceil(PAIRS / cols) * CH + 18, plotH = 150;
      const Hh = plotY + plotH + 52;
      const sc = score(state.m, state.n);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img', 'aria-label': ariaOf(sc) }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 16, narrow ? 'Un reloj por par: q gira m·θᵢ, k gira n·θᵢ' : 'Un reloj por par de componentes: q gira m·θᵢ, k gira n·θᵢ', 'viz-t');
      t(svg, 8, 30, narrow ? 'ángulo entre ellos = (m − n)·θᵢ' : 'el ángulo entre ellos es (m − n)·θᵢ: solo importa la distancia', 'viz-s');
      // clave: rosa = q, azul = k, punteadas = sin rotar (posición 0)
      const kg = V.svg('g', { class: 'viz-rope-key' }, svg);
      let kx = 8;
      const keyItem = (cls, lab) => {
        V.svg('path', { d: 'M' + kx + ' 44H' + (kx + 18), class: 'viz-rope-vec ' + cls }, kg);
        t(kg, kx + 23, 48, lab, 'viz-s'); kx += 23 + lab.length * (narrow ? 5.6 : 6.2) + 14;
      };
      keyItem('viz-rope-q', narrow ? 'q (en m)' : 'q (posición m)');
      keyItem('viz-rope-k', narrow ? 'k (en n)' : 'k (posición n)');
      keyItem('viz-rope-q0', narrow ? 'sin rotar' : 'punteadas: sin rotar (posición 0)');
      for (let i = 0; i < PAIRS; i++) {
        const cx = 8 + (i % cols) * CW + CW / 2, cy = 34 + KEY + Math.floor(i / cols) * CH + R + 14;
        const g = V.svg('g', { class: 'viz-rope-dial' }, svg);
        V.svg('circle', { cx: r1(cx), cy: r1(cy), r: R, class: 'viz-rope-face' }, g);
        V.svg('path', { d: 'M' + r1(cx - R) + ' ' + r1(cy) + 'H' + r1(cx + R) + 'M' + r1(cx) + ' ' + r1(cy - R) + 'V' + r1(cy + R), class: 'viz-rope-axis' }, g);
        const qs = Math.hypot(q[2 * i], q[2 * i + 1]), ks = Math.hypot(k[2 * i], k[2 * i + 1]);
        const s = (R - 6) / Math.max(qs, ks, 1e-6);
        const qa = rot(q[2 * i], q[2 * i + 1], state.m * th[i]), ka = rot(k[2 * i], k[2 * i + 1], state.n * th[i]);
        // vectores sin rotar (posición 0), tenues
        arrow(g, cx, cy, q[2 * i] * s, q[2 * i + 1] * s, 'viz-rope-q0');
        arrow(g, cx, cy, k[2 * i] * s, k[2 * i + 1] * s, 'viz-rope-k0');
        // arco del ángulo entre q y k rotados (en pantalla y hacia abajo: se invierte el eje y)
        const angQ = Math.atan2(qa[1], qa[0]), angK = Math.atan2(ka[1], ka[0]);
        let dA = angQ - angK; while (dA > Math.PI) dA -= 2 * Math.PI; while (dA < -Math.PI) dA += 2 * Math.PI;
        const ar = R * 0.42;
        const p0 = [cx + ar * Math.cos(angK), cy - ar * Math.sin(angK)], p1 = [cx + ar * Math.cos(angK + dA), cy - ar * Math.sin(angK + dA)];
        if (Math.abs(dA) > 0.02) V.svg('path', { d: 'M' + r1(p0[0]) + ' ' + r1(p0[1]) + 'A' + r1(ar) + ' ' + r1(ar) + ' 0 0 ' + (dA > 0 ? 0 : 1) + ' ' + r1(p1[0]) + ' ' + r1(p1[1]), class: 'viz-rope-arc' }, g);
        arrow(g, cx, cy, ka[0] * s, ka[1] * s, 'viz-rope-k');
        arrow(g, cx, cy, qa[0] * s, qa[1] * s, 'viz-rope-q');
        t(g, cx, cy + R + 15, 'par ' + i + ' · θ' + sub(i) + ' = ' + (+th[i].toFixed(3)), 'viz-n', 'middle');
        t(g, cx, cy + R + 29, 'aporte a q·k: ' + sc.per[i].toFixed(2), 'viz-s', 'middle');
      }
      // curva q·k(m − n): la misma para cualquier par (m, n) con esa diferencia
      const px0 = 44, px1 = W - 16, DM = MAXP;
      const xs = (d) => px0 + (d + DM) / (2 * DM) * (px1 - px0);
      const vals = []; for (let d = -DM; d <= DM; d++) vals.push(score(d, 0).s);
      const vmax = Math.max(...vals.map(Math.abs), 1e-6) * 1.08;
      const ys = (v) => plotY + plotH / 2 - v / vmax * (plotH / 2);
      const pg = V.svg('g', { class: 'viz-rope-plot' }, svg);
      t(pg, 8, plotY - 4, narrow ? 'q·k según m − n (igual si mueves las dos)' : 'q·k en función de m − n (la curva no cambia al mover las dos posiciones juntas)', narrow ? 'viz-s' : 'viz-t');
      V.svg('rect', { x: px0, y: plotY, width: r1(px1 - px0), height: plotH, class: 'viz-rope-box' }, pg);
      V.svg('path', { d: 'M' + px0 + ' ' + r1(ys(0)) + 'H' + r1(px1), class: 'viz-rope-axis' }, pg);
      V.svg('path', { d: 'M' + r1(xs(0)) + ' ' + plotY + 'V' + (plotY + plotH), class: 'viz-rope-axis' }, pg);
      V.svg('path', { d: vals.map((v, j) => (j ? 'L' : 'M') + r1(xs(j - DM)) + ' ' + r1(ys(v))).join(''), class: 'viz-rope-curve' }, pg);
      const dCur = state.m - state.n;
      V.svg('path', { d: 'M' + r1(xs(dCur)) + ' ' + plotY + 'V' + (plotY + plotH), class: 'viz-rope-cur' }, pg);
      V.svg('circle', { cx: r1(xs(dCur)), cy: r1(ys(sc.s)), r: 4.5, class: 'viz-rope-dot' }, pg);
      for (const d of [-DM, -DM / 2, 0, DM / 2, DM]) t(pg, xs(d), plotY + plotH + 14, (d > 0 ? '+' : '') + d, 'viz-s', 'middle');
      t(pg, (px0 + px1) / 2, plotY + plotH + 30, narrow ? 'm − n (distancia query → key)' : 'm − n: distancia de la query a la key (negativa = key posterior: la máscara causal la oculta)', 'viz-s', 'middle');
      t(pg, px0 - 6, plotY + 10, '+', 'viz-s', 'end'); t(pg, px0 - 6, plotY + plotH - 2, '−', 'viz-s', 'end');
      readout(sc);
    }
    function sub(i) { return '₀₁₂₃₄₅₆₇₈₉'[i] || String(i); }
    function arrow(g, cx, cy, dx, dy, cls) {
      const x = cx + dx, y = cy - dy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = -dy / L, s = 7, w = 3.6;
      const bx = x - ux * s, by = y - uy * s;
      V.svg('path', { d: 'M' + r1(cx) + ' ' + r1(cy) + 'L' + r1(bx) + ' ' + r1(by), class: 'viz-rope-vec ' + cls }, g);
      V.svg('path', { d: 'M' + r1(x) + ' ' + r1(y) + 'L' + r1(bx - uy * w) + ' ' + r1(by + ux * w) + 'L' + r1(bx + uy * w) + ' ' + r1(by - ux * w) + 'Z', class: 'viz-rope-head ' + cls }, g);
    }
    function readout(sc) {
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      kv('m =', state.m); kv('n =', state.n); kv('m − n =', state.m - state.n);
      kv('q·k =', sc.s.toFixed(3));
      if (state.moved) kv('', '(igual que antes de mover las dos: solo cuenta m − n)');
    }
    function ariaOf(sc) { return 'RoPE con q en la posición ' + state.m + ' y k en la posición ' + state.n + ': distancia ' + (state.m - state.n) + ', producto punto ' + sc.s.toFixed(3) + '.'; }

    stage.addEventListener('keydown', (ev) => {
      const k2 = ev.key;
      if (k2 === 'ArrowLeft' || k2 === 'ArrowRight') { ev.preventDefault(); const d = k2 === 'ArrowRight' ? 1 : -1; if (ev.shiftKey) set(state.m + d, state.n + d, true); else set(state.m + d, state.n); }
      else if (k2 === 'ArrowUp' || k2 === 'ArrowDown') { ev.preventDefault(); set(state.m, state.n + (k2 === 'ArrowUp' ? 1 : -1)); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('rope', render);
})(typeof window !== 'undefined' ? window : globalThis);
