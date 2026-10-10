/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/depth-scale.js
   Visualización "depth-scale" (SPEC §7.8, §26.5): profundidad RELATIVA y la pérdida invariante a escala y desplazamiento.
   Datos ILUSTRATIVOS: una fila de M = 160 píxeles de una escena sintética (pared cerca a la izquierda, una persona a 1.6 m, una
   mesa, una pared de fondo oblicua de 3.2 a 6.8 m y un vidrio a 2.2 m). Verdad en DISPARIDAD (1/profundidad), como entrenan MiDaS y Depth Anything. La predicción
   del modelo es la verdad con un error de estructura chico (ε, ≈ 3 %) y una escala a y un desplazamiento b desconocidos:
   p = a·(d* + ε) + b. Con una sola imagen, la red no puede saber a ni b (un objeto chico cerca y uno grande lejos se ven igual):
   por eso se entrena alineando la predicción con la verdad ANTES de medir el error (Ranftl et al., MiDaS, TPAMI 2022,
   arXiv:1907.01341, sec. 5):
     mínimos cuadrados:  (s, t) = argmin Σ (s·p_i + t − d*_i)²  (forma cerrada, ecuaciones normales 2×2),
                         ℒ_ssimse = 1/(2M) Σ (s·p_i + t − d*_i)²
     mediana y escala:   t(d) = mediana(d), s(d) = 1/M Σ |d − t(d)|, ambos lados normalizados d̂ = (d − t(d))/s(d),
                         ℒ_ssimae = 1/(2M) Σ |p̂_i − d̂*_i|   (la de Depth Anything, Yang et al., CVPR 2024, arXiv:2401.10891)
     + recorte:          ℒ_ssitrim = 1/(2M) Σ_{j ≤ U} |r_j| con los residuos ordenados y U = 0.8·M (descarta el 20 % peor)
   Los sliders cambian a y b: la pérdida sin alinear explota, la alineada NO cambia (invariancia exacta). Con "vidrio" el modelo
   ve a través (predice lo de atrás): esos 12 píxeles son outliers. Mueven s y t en cualquier alineación (el readout da el error en
   los píxeles buenos); el recorte los saca de la pérdida (su aporte baja a ≈ 0), así que el gradiente deja de empujar hacia ellos.
   Profundidad métrica (metros) necesita algo más: la intrínseca de la cámara o una cabeza métrica (ZoeDepth, Depth Pro…).
   Números del calculador (no ilustrativos): la resolución de entrada y el mapa de salida de la config (píxeles por imagen en la
   pérdida). params: { config:'depth-anything-v2-small', a:2.5, b:0.4, align:'lsq'|'median'|'trim', glass:false }
   Puro (sin DOM) para tests: ATLAS.Viz.depthAlign = { lsq, medScale, losses, profile }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9*]{1,2}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const M = 160, TRIM = 0.8;
  // pérdidas chicas en notación científica legible: 5.1·10⁻⁵
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const fl = (v) => (!Number.isFinite(v) ? '—' : v === 0 ? '0' : Math.abs(v) >= 0.01 ? v.toFixed(4) : (() => { const e = Math.floor(Math.log10(Math.abs(v))); return (v / Math.pow(10, e)).toFixed(2) + '·10' + String(e).split('').map((c) => SUP[c]).join(''); })());
  const GLASS = [120, 132];                                            // píxeles del vidrio [desde, hasta)

  // ---- matemática pura
  function lsq(p, g) {
    let sp = 0, sg = 0, spp = 0, spg = 0;
    const n = p.length;
    for (let i = 0; i < n; i++) { sp += p[i]; sg += g[i]; spp += p[i] * p[i]; spg += p[i] * g[i]; }
    const det = spp * n - sp * sp;
    const s = det ? (spg * n - sp * sg) / det : 0, t = det ? (spp * sg - sp * spg) / det : sg / n;
    return { s, t };
  }
  const median = (a) => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
  function medScale(d) { const t = median(d); const s = d.reduce((a, v) => a + Math.abs(v - t), 0) / d.length; return { t, s }; }
  // pérdidas de MiDaS (con el 1/(2M) del paper). Devuelve también la predicción alineada en la escala de la verdad
  function losses(p, g, align) {
    const n = p.length;
    if (align === 'lsq') {
      const { s, t } = lsq(p, g);
      const al = p.map((v) => s * v + t), res = al.map((v, i) => v - g[i]);
      return { s, t, aligned: al, res, loss: res.reduce((a, r) => a + r * r, 0) / (2 * n) };
    }
    const P = medScale(p), G = medScale(g);
    const pn = p.map((v) => (v - P.t) / P.s), gn = g.map((v) => (v - G.t) / G.s);
    const res = pn.map((v, i) => v - gn[i]);
    const abs = res.map(Math.abs);
    const kept = align === 'trim' ? abs.slice().sort((x, y) => x - y).slice(0, Math.floor(TRIM * n)) : abs;
    // en la escala de la verdad: p̂ · s(d*) + t(d*) (lo que se dibuja)
    const al = pn.map((v) => v * G.s + G.t);
    const cut = align === 'trim' ? kept[kept.length - 1] : Infinity;
    return { s: G.s / P.s, t: G.t - P.t * G.s / P.s, aligned: al, res, resScaled: res.map((r) => r * G.s), cut, loss: kept.reduce((a, v) => a + v, 0) / (2 * n), pStats: P, gStats: G };
  }
  // escena: profundidad en metros por píxel de la fila y la predicción relativa (disparidad, con a, b y ε)
  function profile(seed, glass) {
    const R = ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(seed || 1907) : Math.random;
    const depth = [], eps = [], part = [];
    for (let i = 0; i < M; i++) {
      const x = i / (M - 1);
      let z, k;
      if (i < 28) { z = 1.1 + 2.4 * x; k = 'pared'; }                          // pared lateral que se aleja
      else if (i >= 52 && i < 76) { z = 1.6 + 0.08 * Math.sin(i * 0.5); k = 'persona'; }
      else if (i >= 88 && i < 110) { z = 2.6 + 0.6 * (i - 88) / 22; k = 'mesa'; }
      else if (i >= GLASS[0] && i < GLASS[1]) { z = 2.2; k = 'vidrio'; }
      else { z = 3.2 + 3.6 * x; k = 'fondo'; }                      // pared del fondo, oblicua: de 3.2 a 6.8 m
      depth.push(z); part.push(k);
      eps.push(0.03 * R.normal());
    }
    // ε suavizado (error de estructura, no ruido blanco)
    const sm = eps.map((_, i) => (eps[Math.max(0, i - 1)] + 2 * eps[i] + eps[Math.min(M - 1, i + 1)]) / 4);
    const gt = depth.map((z) => 1 / z);
    // con vidrio, el modelo "ve a través": predice la disparidad de lo que hay detrás (9 m)
    const seen = gt.map((d, i) => (glass && part[i] === 'vidrio' ? 1 / 9 : d));
    return { depth, gt, part, eps: sm, pred: (a, b) => seen.map((d, i) => a * (d + sm[i] * d) + b) };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const fint = fmt.int || ((n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const cfgId = params.config || 'depth-anything-v2-small';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const cfg = (run && run.config) || {};
    const num = (v, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
    const state = { a: num(params.a, 2.5), b: num(params.b, 0.4), align: ['lsq', 'median', 'trim'].indexOf(params.align) >= 0 ? params.align : 'lsq', glass: params.glass === true || params.glass === 'true' };

    const wrap = V.html('div', { class: 'viz viz-dsc' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._v = v; b._k = key; return b; });
    };
    const cA = chipGroup('Alinear con', [['lsq', 'mínimos cuadrados'], ['median', 'mediana y escala'], ['trim', '+ recorte 20 %']], 'align');
    const cG = chipGroup('Vidrio', [[false, 'no'], [true, 'sí: píxeles malos']], 'glass');
    const slider = (label, key, lo, hi, step, aria) => {
      const g = V.html('label', { class: 'viz-ctl viz-dsc-sl' }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label, style: 'text-transform:none' }, g);
      const inp = V.html('input', { type: 'range', min: lo, max: hi, step, 'aria-label': aria }, g);
      const o = V.html('output', { class: 'viz-dsc-out' }, g);
      inp.addEventListener('input', () => { state[key] = +inp.value; draw(); });
      return { sync() { inp.value = state[key]; o.textContent = key + ' = ' + state[key]; } };
    };
    const sA = slider('Escala a', 'a', 0.2, 4, 0.1, 'Escala a de la predicción cruda (0.2 a 4)');
    const sB = slider('Desplazamiento b', 'b', -0.6, 0.8, 0.05, 'Desplazamiento b de la predicción cruda (−0.6 a 0.8)');
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, sub('Escena sintética (una fila de ' + M + ' píxeles). Todo en disparidad 1/z: es lo que predicen MiDaS y Depth Anything, y deja al fondo lejano cerca de 0. La predicción cruda es p = a·(d* + ε) + b: correcta salvo por una escala y un desplazamiento que una sola imagen no puede fijar, más un error de estructura ε chico. La pérdida de MiDaS primero alinea (s, t) y después mide: mueve a y b y la pérdida alineada no cambia; solo ε cuenta. Mínimos cuadrados tiene forma cerrada; Depth Anything normaliza con la mediana y la desviación media absoluta. Con píxeles malos (el vidrio: el modelo ve lo de atrás), ninguna alineación sale gratis: s y t se corren y el error crece también en los píxeles buenos. El recorte (ℒ_{ssitrim}) deja afuera de la pérdida el 20 % de residuos más grandes: los píxeles malos dejan de aportar gradiente. Para metros hace falta la intrínseca de la cámara o una cabeza métrica: la alineación usa la verdad, que en inferencia no existe.'));

    function draw() {
      [cA, cG].forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      sA.sync(); sB.sync();
      const pr = profile(1907, state.glass);
      const p = pr.pred(state.a, state.b), g = pr.gt;
      const L = losses(p, g, state.align);
      const raw = p.reduce((a, v, i) => a + (v - g[i]) * (v - g[i]), 0) / (2 * M);
      // "ideal": la pérdida alineada sin vidrio y con a = 1, b = 0 (solo ε): la invariancia la deja igual para cualquier a, b
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(560, cw)) : 860;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (q, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, q); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'Disparidad: verdad, predicción y alineada' : 'Disparidad 1/z en una fila: la verdad, la predicción cruda (a, b desconocidos) y la alineada', 'viz-t');
      t(svg, 8, 29, state.align === 'lsq' ? 's, t por mínimos cuadrados' : (narrow ? 's, t: mediana y desviación' : 's, t por mediana y desviación media') + (state.align === 'trim' ? (narrow ? ' + recorte' : ' + recorte del 20 % peor') : ''), 'viz-s');
      const pw = W - 16, ph = narrow ? 150 : 170, X0 = 8, Y0 = 44;
      const all = g.concat(p, L.aligned);
      let lo = Math.min(0, ...all), hi = Math.max(...all);
      const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
      const X = (i) => X0 + pw * i / (M - 1), Y = (v) => Y0 + ph - ph * (v - lo) / (hi - lo);
      V.svg('rect', { x: X0, y: Y0, width: pw, height: ph, class: 'viz-dsc-bg' }, svg);
      // franjas por parte de la escena
      let i0 = 0;
      for (let i = 1; i <= M; i++) if (i === M || pr.part[i] !== pr.part[i0]) {
        if (pr.part[i0] !== 'fondo') {
          V.svg('rect', { x: r1(X(i0) - pw / (M - 1) / 2), y: Y0, width: r1(pw * (i - i0) / (M - 1)), height: ph, class: 'viz-dsc-band' + (pr.part[i0] === 'vidrio' && state.glass ? ' is-glass' : '') }, svg);
          t(svg, X((i0 + i - 1) / 2), Y0 + ph - 5, pr.part[i0], 'viz-dsc-bt', 'middle');
        }
        i0 = i;
      }
      if (lo < 0) V.svg('path', { d: 'M' + X0 + ' ' + r1(Y(0)) + 'h' + pw, class: 'viz-dsc-zero' }, svg);
      const line = (arr, cls) => V.svg('path', { d: arr.map((v, i) => (i ? 'L' : 'M') + r1(X(i)) + ' ' + r1(Y(v))).join(''), class: cls }, svg);
      line(p, 'viz-dsc-raw'); line(g, 'viz-dsc-gt'); line(L.aligned, 'viz-dsc-al');
      if (state.align === 'trim') L.res.forEach((r, i) => { if (Math.abs(r) > L.cut) V.svg('circle', { cx: r1(X(i)), cy: r1(Y(L.aligned[i])), r: 2.6, class: 'viz-dsc-cut' }, svg); });
      // leyenda
      let ly = Y0 + ph + 18, lx = 8;
      [['viz-dsc-gt', 'verdad d*'], ['viz-dsc-raw', 'predicción cruda p'], ['viz-dsc-al', 'alineada s·p + t']].concat(state.align === 'trim' ? [['dot', 'recortado (20 % peor)']] : []).forEach(([cls, s]) => {
        const iw = 26 + s.length * 6.4 + 12;
        if (lx > 8 && lx + iw > W - 8) { lx = 8; ly += 16; }
        if (cls === 'dot') V.svg('circle', { cx: lx + 9, cy: ly - 4, r: 3, class: 'viz-dsc-cut' }, svg);
        else V.svg('path', { d: 'M' + lx + ' ' + (ly - 4) + 'h18', class: cls }, svg);
        t(svg, lx + 24, ly, s, 'viz-s'); lx += iw;
      });
      // residuos después de alinear
      const ry = ly + 26, rh = narrow ? 70 : 80;
      const res = state.align === 'lsq' ? L.res : L.resScaled;
      const rMax = Math.max(0.02, ...res.map(Math.abs)) * 1.1;
      t(svg, 8, ry - 6, narrow ? 'residuo después de alinear' : 'residuo después de alinear (en disparidad): lo único que la pérdida castiga', 'viz-n');
      V.svg('rect', { x: X0, y: r1(ry), width: pw, height: rh, class: 'viz-dsc-bg' }, svg);
      const RY = (v) => ry + rh / 2 - (rh / 2) * v / rMax;
      V.svg('path', { d: 'M' + X0 + ' ' + r1(RY(0)) + 'h' + pw, class: 'viz-dsc-zero' }, svg);
      res.forEach((r, i) => V.svg('path', { d: 'M' + r1(X(i)) + ' ' + r1(RY(0)) + 'V' + r1(RY(r)), class: 'viz-dsc-res' + (state.align === 'trim' && Math.abs(L.res[i]) > L.cut ? ' is-cut' : '') }, svg));
      const H2 = ry + rh + 10;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(H2));
      const lname = state.align === 'lsq' ? 'ℒ_{ssimse}' : state.align === 'median' ? 'ℒ_{ssimae}' : 'ℒ_{ssitrim}';
      svg.setAttribute('aria-label', 'Predicción con escala ' + state.a + ' y desplazamiento ' + state.b + ': pérdida sin alinear ' + fl(raw) + ', alineada ' + fl(L.loss) + ' (' + lname.replace('_{', ' ').replace('}', '') + ')' + (state.glass ? ', con vidrio' : ''));

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + v + '</b>'; };
      kv('predicción cruda:', 'a = ' + state.a + ', b = ' + state.b);
      kv('alineación:', 's = ' + L.s.toFixed(3) + ', t = ' + L.t.toFixed(3) + (!state.glass && Math.abs(state.a - 1) + Math.abs(state.b) > 1e-9 ? ' (≈ 1/a = ' + (1 / state.a).toFixed(3) + ', −b/a = ' + (-state.b / state.a).toFixed(3) + ')' : ''));
      kv('pérdida sin alinear (MSE/2):', fl(raw));
      kv(lname + ' =', fl(L.loss) + (state.align === 'lsq' ? ' (MSE/2 tras alinear)' : ' (|·|/2 normalizado)'));
      // error en los píxeles buenos (en disparidad, en la escala de la verdad) y aporte del vidrio a la pérdida
      const good = pr.part.map((k) => !(state.glass && k === 'vidrio'));
      const ng = good.filter(Boolean).length;
      const eg = Math.sqrt(L.aligned.reduce((a, v, i) => a + (good[i] ? (v - g[i]) * (v - g[i]) : 0), 0) / ng);
      kv('RMSE en los píxeles buenos:', fl(eg));
      if (state.glass) {
        const term = (i) => (state.align === 'lsq' ? L.res[i] * L.res[i] : state.align === 'trim' && Math.abs(L.res[i]) > L.cut ? 0 : Math.abs(L.res[i]));
        const tot = L.res.reduce((a, _, i) => a + term(i), 0), gl = L.res.reduce((a, _, i) => a + (good[i] ? 0 : term(i)), 0);
        kv('aporte del vidrio (' + (GLASS[1] - GLASS[0]) + ' de ' + M + ' píxeles) a la pérdida:', Math.round(100 * gl / tot) + ' %');
      }
      realNumbers();
    }
    function realNumbers() {
      real.innerHTML = '';
      if (!run) return;
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('config:', run.label || cfgId);
      let met = null;
      try { met = A.metrics(cfgId); } catch (e) { met = null; }
      const res = met && Number.isFinite(met.res) ? met.res : Number.isFinite(cfg.res) ? cfg.res : null;
      if (res) kv('entrada:', res + '×' + res);
      // píxeles por imagen en la pérdida = el mapa de salida (H×W, la resolución de entrada en DPT)
      const oh = met && met.outH, ow = met && met.outW;
      if (Number.isFinite(oh) && Number.isFinite(ow)) kv('M (píxeles en la pérdida por imagen):', oh + '×' + ow + ' = ' + fint(oh * ow));
    }
    draw();
    let ro = null, lastNarrow = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (lastNarrow !== null && nar !== lastNarrow) draw(); lastNarrow = nar; }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.depthAlign = { lsq, medScale, losses, profile };
    ATLAS.Viz.register('depth-scale', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
