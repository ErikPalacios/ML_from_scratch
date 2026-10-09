/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/lora-rank.js
   Visualización "lora-rank" (SPEC §7.8, §22.3): un ΔW sintético (32×32, ilustrativo) y su mejor aproximación de rango r.
   ΔW = U·diag(s)·Vᵀ con U, V ortonormales suaves (cosenos, signos con semilla fija) y un espectro elegido:
     - "cae rápido": la hipótesis de LoRA (Hu et al. 2022, arXiv:2106.09685, §4 y §7): el cambio de los pesos al
       adaptar tiene un rango intrínseco bajo; pocos valores singulares concentran casi toda la energía;
     - "cae lento": un cambio con energía repartida (aprender conocimiento nuevo, p. ej. código o matemática con
       pretraining continuado: Biderman et al. 2024, "LoRA Learns Less and Forgets Less", arXiv:2405.09673, miden
       perturbaciones del FT completo con rango 10–100× mayor que los r típicos de LoRA).
   Con r (deslizador) se ve: ΔW, la reconstrucción B·A de rango r = la SVD truncada (el ÓPTIMO de rango r en norma de
   Frobenius, Eckart–Young; LoRA no calcula la SVD: entrena B y A, que a lo sumo llegan a esto), el error, los valores
   singulares (los r que se quedan, resaltados) y la energía explicada Σ_{i≤r} s_i² / Σ s_i² con la línea del 90 %.
   Los factores B (d_out × r) y A (r × d_in) se dibujan a escala junto a B·A: el cuello de botella de ancho r.
   Lo único del calculador: el ancho real de Llama 3 8B (cfg.D de llama3-8b) para la cuenta r·(d_in + d_out) de W_Q.
   params: { r:4, spectrum:'fast'|'slow' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  // subíndices estilo TeX en el texto html (readout y nota): π_ref → π<sub>ref</sub>
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9θ]+)/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const N = 32;                       // ΔW de N × N (juguete)
  const SPECTRA = {
    fast: { label: 'cae rápido (rango intrínseco bajo)', short: 'cae rápido', s: (i) => 3.2 * Math.exp(-i / 1.8) + 0.035 },
    slow: { label: 'cae lento (energía repartida)', short: 'cae lento', s: (i) => 1.25 * Math.exp(-i / 13) + 0.06 },
  };

  // Bases ortonormales SUAVES (cosenos: DCT-II para las filas, DCT-IV para las columnas, con signos al azar de semilla fija):
  // cada componente de rango 1 es un "tejido" suave, así la estructura de rango bajo se ve a ojo (con vectores al azar,
  // ΔW parecía ruido aunque tuviera rango 3). Columnas = vectores.
  function cosBasis(kind, rng) {
    const Q = [];
    for (let k = 0; k < N; k++) {
      const sg = rng() < 0.5 ? -1 : 1;
      let v = Array.from({ length: N }, (_, i) => Math.cos(Math.PI * (i + 0.5) * (kind === 'iv' ? k + 0.5 : k) / N));
      const L = Math.hypot(...v) || 1;
      Q.push(v.map((x) => sg * x / L));
    }
    return Q;
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const fint = fmt.int || ((n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const rng = V.rng(2106);
    const U = cosBasis('ii', rng), Vt = cosBasis('iv', rng);
    const state = { r: Math.max(1, Math.min(N, Math.round(+params.r) || 4)), spec: SPECTRA[params.spectrum] ? params.spectrum : 'fast' };
    // ancho real de Llama 3 8B (W_Q es D × D): del calculador; si no está, no se muestra la línea
    let Dllm = null;
    try { const c = A && A.run ? A.run('llama3-8b').config : null; if (c && Number.isFinite(c.D)) Dllm = c.D; } catch (e) { Dllm = null; }

    const wrap = V.html('div', { class: 'viz viz-lr' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Espectro de ΔW' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Espectro de ΔW' }, g1);
    const sBtns = Object.keys(SPECTRA).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: SPECTRA[k].label }, g1); b.addEventListener('click', () => { state.spec = k; draw(); }); b._k = k; return b; });
    const g2 = V.html('label', { class: 'viz-ctl viz-lr-sl' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Rango r' }, g2);
    const inp = V.html('input', { type: 'range', min: 1, max: N, step: 1, 'aria-label': 'Rango r de la aproximación B·A (1 a ' + N + ')' }, g2);
    const outR = V.html('output', { class: 'viz-lr-out' }, g2);
    inp.addEventListener('input', () => { state.r = +inp.value; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-lr-stage', tabindex: 0, role: 'group', 'aria-label': 'Aproximación de rango r de un ΔW sintético. Flechas: r ± 1; Inicio y Fin: r = 1 y r = ' + N + '; E: cambiar el espectro' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    const cache = {};
    function matrices(spec) {
      if (cache[spec]) return cache[spec];
      const s = Array.from({ length: N }, (_, i) => SPECTRA[spec].s(i));
      const tot = s.reduce((a, x) => a + x * x, 0);
      const cum = [0];
      s.forEach((x, i) => cum.push(cum[i] + x * x / tot));
      // ΔW_ij = Σ_k U_ik s_k V_jk (U[k] y Vt[k] son las columnas k)
      const rankK = (k) => { const M = []; for (let i = 0; i < N; i++) { const row = new Float64Array(N); for (let j = 0; j < N; j++) { let v = 0; for (let q = 0; q < k; q++) v += U[q][i] * s[q] * Vt[q][j]; row[j] = v; } M.push(row); } return M; };
      const full = rankK(N);
      let vmax = 0;
      full.forEach((row) => row.forEach((v) => { vmax = Math.max(vmax, Math.abs(v)); }));
      const r90 = cum.findIndex((c) => c >= 0.9);
      cache[spec] = { s, cum, full, vmax, rankK, r90 };
      return cache[spec];
    }

    let lastNarrow = null;
    function draw() {
      sBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.spec)));
      const r = state.r;
      inp.value = r; outR.textContent = 'r = ' + r;
      const M = matrices(state.spec);
      const approx = M.rankK(r);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'ΔW ≈ B·A de rango r (SVD truncada)' : 'Un cambio de pesos ΔW (' + N + '×' + N + ') y su mejor aproximación de rango r: B·A = SVD truncada (Eckart–Young)', 'viz-t');
      t(svg, 8, 29, narrow ? 'ΔW sintético (ilustrativo)' : 'ΔW sintético con espectro ' + SPECTRA[state.spec].short + ' (ilustrativo); color: signo, intensidad: |valor|', 'viz-s');

      // ---- tres mapas: ΔW · B·A (con los factores a escala) · error
      const hs = narrow ? Math.floor((W - 16 - 2 * 12) / 3) : 150;
      const cell = hs / N, hy = 58;
      const gap = narrow ? 12 : 64;
      const heat = (x0, y0, Mx, title) => {
        t(svg, x0, y0 - 8, title, 'viz-n');
        const g = V.svg('g', { class: 'viz-lr-heat' }, svg);
        V.svg('rect', { x: r1(x0), y: r1(y0), width: r1(hs), height: r1(hs), class: 'viz-lr-bg' }, g);
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
          const v = Mx[i][j] / M.vmax;
          if (Math.abs(v) < 0.015) continue;
          V.svg('rect', { x: r1(x0 + j * cell), y: r1(y0 + i * cell), width: r1(cell + 0.15), height: r1(cell + 0.15), class: 'viz-lr-c ' + (v > 0 ? 'is-pos' : 'is-neg'), 'fill-opacity': Math.min(1, Math.abs(v) * 1.8).toFixed(2) }, g);
        }
        V.svg('rect', { x: r1(x0), y: r1(y0), width: r1(hs), height: r1(hs), class: 'viz-lr-frame' }, g);
      };
      const err = M.full.map((row, i) => row.map((v, j) => v - approx[i][j]));
      // factores a escala (en el juguete, d = N): B es N × r (alto y angosto), A es r × N (ancho y bajo)
      const fw = Math.max(2, cell * r);                 // ancho de B = alto de A
      let x = 8;
      heat(x, hy, M.full, 'ΔW (completa)');
      x += hs + gap;
      const xBA = x;
      heat(x, hy, approx, narrow ? 'B·A (rango ' + r + ')' : 'B·A, rango r = ' + r);
      x += hs + gap;
      heat(x, hy, err, narrow ? 'error' : 'error ΔW − B·A');
      let y = hy + hs + 10;
      if (!narrow) {
        // B (d × r) a la izquierda debajo y A (r × d) a la derecha: el producto pasa por un cuello de ancho r
        const fy = y + 6, bx = xBA, ax = xBA + 14 + fw;
        V.svg('rect', { x: r1(bx), y: r1(fy), width: r1(fw), height: r1(hs * 0.5), class: 'viz-lr-fac' }, svg);
        t(svg, bx + fw / 2, fy + hs * 0.5 + 12, 'B', 'viz-n', 'middle');
        V.svg('rect', { x: r1(ax), y: r1(fy), width: r1(hs * 0.5), height: r1(fw), class: 'viz-lr-fac' }, svg);
        t(svg, ax + hs * 0.25, fy + fw + 12, 'A', 'viz-n', 'middle');
        t(svg, ax + hs * 0.5 + 8, fy + 9, 'B: ' + N + '×' + r + ' · A: ' + r + '×' + N + ' (a escala)', 'viz-s');
        t(svg, ax + hs * 0.5 + 8, fy + 23, 'el producto pasa por un cuello de ancho r', 'viz-s');
        y = fy + hs * 0.5 + 24;
      } else {
        t(svg, 8, y + 6, 'B: ' + N + '×' + r + ' · A: ' + r + '×' + N + ' (cuello de ancho r)', 'viz-s');
        y += 16;
      }

      // ---- valores singulares (los r primeros se quedan) y energía explicada
      const cx0 = 8, cwid = narrow ? W - 16 : (W - 16 - 40) / 2, ch = narrow ? 90 : 110;
      const sy = y + 22;
      t(svg, cx0, sy - 8, narrow ? 'valores singulares s_i' : 'Valores singulares s_i de ΔW (resaltados: los r que se quedan)', 'viz-n');
      const smax = M.s[0];
      const bw = cwid / N;
      V.svg('path', { d: 'M' + r1(cx0) + ' ' + r1(sy + ch) + 'H' + r1(cx0 + cwid), class: 'viz-lr-axis' }, svg);
      M.s.forEach((sv, i) => {
        const h = Math.max(1, ch * sv / smax);
        V.svg('rect', { x: r1(cx0 + i * bw + 0.6), y: r1(sy + ch - h), width: r1(Math.max(1, bw - 1.2)), height: r1(h), class: 'viz-lr-sv' + (i < r ? ' is-kept' : '') }, svg);
      });
      t(svg, cx0, sy + ch + 13, '1', 'viz-s');
      t(svg, cx0 + cwid, sy + ch + 13, String(N), 'viz-s', 'end');
      t(svg, cx0 + cwid / 2, sy + ch + 13, 'índice i', 'viz-s', 'middle');
      // energía
      const ex0 = narrow ? 8 : cx0 + cwid + 40, ey = narrow ? sy + ch + 44 : sy;
      t(svg, ex0, ey - 8, narrow ? 'energía explicada vs r' : 'Energía explicada Σ_{i≤r} s_i² / Σ s_i² vs r', 'viz-n');
      const X = (k) => ex0 + cwid * k / N, Y = (f) => ey + ch - ch * f;
      V.svg('path', { d: 'M' + r1(ex0) + ' ' + r1(ey + ch) + 'H' + r1(ex0 + cwid) + 'M' + r1(ex0) + ' ' + r1(ey) + 'V' + r1(ey + ch), class: 'viz-lr-axis' }, svg);
      V.svg('path', { d: 'M' + r1(ex0) + ' ' + r1(Y(0.9)) + 'H' + r1(ex0 + cwid), class: 'viz-lr-ref' }, svg);
      t(svg, ex0 + 6, Y(0.9) - 4, '90 %', 'viz-s');
      let d = '';
      M.cum.forEach((c, k) => { d += (k ? 'L' : 'M') + r1(X(k)) + ' ' + r1(Y(c)); });
      V.svg('path', { d, class: 'viz-lr-curve' }, svg);
      V.svg('path', { d: 'M' + r1(X(r)) + ' ' + r1(ey) + 'V' + r1(ey + ch), class: 'viz-lr-cur' }, svg);
      V.svg('circle', { cx: r1(X(r)), cy: r1(Y(M.cum[r])), r: 4.5, class: 'viz-lr-pt' }, svg);
      const pct = (f) => (100 * f).toFixed(f > 0.995 && f < 1 ? 1 : 0) + ' %';
      t(svg, Math.min(X(r) + 8, ex0 + cwid - 4), Math.min(ey + ch - 6, Y(M.cum[r]) + 18), pct(M.cum[r]), 'viz-n', X(r) + 60 > ex0 + cwid ? 'end' : null);
      t(svg, ex0, ey + ch + 13, '0', 'viz-s');
      t(svg, ex0 + cwid, ey + ch + 13, 'r = ' + N, 'viz-s', 'end');
      y = (narrow ? ey : sy) + ch + 26;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      const relErr = Math.sqrt(Math.max(0, 1 - M.cum[r]));
      svg.setAttribute('aria-label', 'Espectro ' + SPECTRA[state.spec].short + '; rango r = ' + r + ': energía explicada ' + pct(M.cum[r]) + ', error relativo ' + (100 * relErr).toFixed(0) + ' %; con este espectro hacen falta r = ' + (M.r90) + ' para el 90 %.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('r =', String(r));
      kv('energía explicada:', pct(M.cum[r]));
      kv('error relativo (Frobenius) ‖ΔW − B·A‖ / ‖ΔW‖:', (100 * relErr).toFixed(1) + ' %');
      kv('90 % con r =', String(M.r90));
      kv('parámetros B·A (juguete):', fint(r * 2 * N) + ' vs ' + fint(N * N) + ' de ΔW');
      if (Dllm) kv('con W_Q de Llama 3 8B (' + fint(Dllm) + '×' + fint(Dllm) + '):', fint(r * 2 * Dllm) + ' vs ' + fint(Dllm * Dllm) + ' (' + (100 * r * 2 * Dllm / (Dllm * Dllm)).toFixed(2) + ' %)');
      note.innerHTML = sub('Ilustrativo: un ΔW sintético con un espectro elegido, no medido en un modelo. B·A de rango r no puede hacerlo mejor que la SVD truncada (Eckart–Young); LoRA no calcula ninguna SVD: entrena B (empieza en 0) y A (gaussiana) por gradiente, así que a lo sumo llega a esto. Con un espectro que cae rápido (la hipótesis de LoRA: el cambio al adaptar tiene rango intrínseco bajo), r = 4–16 alcanza; con uno que cae lento, r chico pierde energía: es lo que miden Biderman et al. (2024) cuando el FT aprende conocimiento nuevo (código, matemática). La cuenta de parámetros es r·(d_in + d_out) por matriz' + (Dllm ? ' (el ancho ' + fint(Dllm) + ' de Llama 3 8B, del calculador)' : '') + '.');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') { ev.preventDefault(); state.r = Math.min(N, state.r + 1); draw(); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { ev.preventDefault(); state.r = Math.max(1, state.r - 1); draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.r = 1; draw(); }
      else if (k === 'End') { ev.preventDefault(); state.r = N; draw(); }
      else if (k === 'e' || k === 'E') { ev.preventDefault(); state.spec = state.spec === 'fast' ? 'slow' : 'fast'; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('lora-rank', render);
})(typeof window !== 'undefined' ? window : globalThis);
