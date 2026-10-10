/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/histogram-split.js
   Visualización "histogram-split" (SPEC §7.8, §25.4): cómo un GBDT con histogramas elige el corte de UNA feature en UN nodo.
   Datos ILUSTRATIVOS (N = 240 filas con semilla, una feature x ∈ [0, 1]) → gradientes g_i y hessianos h_i de la pérdida en la
   predicción actual F_{t−1} (cuadrática: g = F − y, h = 1; logística: g = p − y, h = p(1 − p)) → la feature cuantizada en
   `bins` bins por cuantiles (como el método hist de XGBoost / LightGBM: un bin por cada ~N/bins filas) → por bin, G_b = Σ g y
   H_b = Σ h (el histograma) → un barrido de izquierda a derecha con las sumas acumuladas G_L, H_L (y G_R = G − G_L,
   H_R = H − H_L) → la ganancia de cada umbral con la fórmula de XGBoost (Chen y Guestrin, KDD 2016, arXiv:1603.02754, ec. 7):
       Gain = ½ [ G_L²/(H_L + λ) + G_R²/(H_R + λ) − (G_L + G_R)²/(H_L + H_R + λ) ] − γ
   y el peso óptimo de cada hoja w* = −G/(H + λ) (ec. 5). Un umbral con H_L o H_R por debajo de min_child_weight (1 por
   omisión) no se permite. Si la mejor ganancia es ≤ 0 el nodo queda hoja.
   Nota verificada en el código de XGBoost (src/tree/param.h, split_evaluator.h, updater_prune.cc): CalcGain = G²/(H + λ)
   SIN el ½, la ganancia del split (loss_chg) es la suma de los dos hijos menos el padre, y el nodo se poda si
   loss_chg < min_split_loss (= γ, NeedPrune). O sea, en el código γ se compara con el corchete entero; en el paper, con su
   mitad. La viz muestra la del paper y, en el readout, el loss_chg del código.
   Números del calculador (no ilustrativos): bins, F, N y el costo de armar histogramas / buscar el corte de la config
   (ATLAS.Arch.run / metrics; xgboost-500-d6 por omisión).
   params: { config:'xgboost-500-d6', bins:16 (8|16|32|64), loss:'sq'|'log', lambda:1, gamma:0 }
   Puro (sin DOM) para tests: ATLAS.Viz.histSplit = { gain, leafWeight, histogram, scan, data }.
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  // subíndices estilo TeX en el html del readout: G_L → G<sub>L</sub>, F_{t−1} → F<sub>t−1</sub>
  const sub = (s) => String(s).replace(/_(\{[^}]*\}|[A-Za-z0-9]{1,2}(?![A-Za-z0-9_]))/g, (m, g) => '<sub>' + (g[0] === '{' ? g.slice(1, -1) : g) + '</sub>');
  const f2 = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2));
  const NROWS = 240, MIN_CHILD = 1;
  const BIN_CHOICES = [8, 16, 32, 64];
  const LAMBDAS = [0, 1, 5, 20];
  const GAMMAS = [0, 1, 4, 10];

  // ---- matemática pura (exacta, la del paper)
  // Gain = ½[G_L²/(H_L+λ) + G_R²/(H_R+λ) − (G_L+G_R)²/(H_L+H_R+λ)] − γ
  function gain(GL, HL, GR, HR, lambda, gamma) {
    const t = (G, H) => (G * G) / (H + lambda);
    return 0.5 * (t(GL, HL) + t(GR, HR) - t(GL + GR, HL + HR)) - gamma;
  }
  // loss_chg del código de XGBoost (sin el ½ ni el γ; se poda si loss_chg < γ)
  function lossChg(GL, HL, GR, HR, lambda) {
    const t = (G, H) => (H > 0 ? (G * G) / (H + lambda) : 0);
    return t(GL, HL) + t(GR, HR) - t(GL + GR, HL + HR);
  }
  const leafWeight = (G, H, lambda) => -G / (H + lambda);

  // datos sintéticos: x ∈ [0, 1]; regresión: escalón en x ≈ 0.62 + pendiente + ruido; clasificación: P(y = 1) sube en ese tramo
  function data(seed) {
    const R = ATLAS.Viz && ATLAS.Viz.rng ? ATLAS.Viz.rng(seed || 1603) : Math.random;
    const rows = [];
    for (let i = 0; i < NROWS; i++) {
      const x = R();
      const yr = (x > 0.62 ? 1.6 : 0) + 0.8 * x + 0.45 * R.normal();
      const p = 1 / (1 + Math.exp(-(x > 0.62 ? 1.6 : -1.1) - 1.2 * (x - 0.5)));
      rows.push({ x, yr, yc: R() < p ? 1 : 0 });
    }
    rows.sort((a, b) => a.x - b.x);
    return rows;
  }
  // gradientes en F_{t−1} = la predicción constante del primer árbol (promedio / log-odds del promedio)
  function grads(rows, loss) {
    if (loss === 'log') {
      const m = rows.reduce((a, r) => a + r.yc, 0) / rows.length;
      const p = m;
      return { F: Math.log(m / (1 - m)), rows: rows.map((r) => ({ x: r.x, y: r.yc, g: p - r.yc, h: p * (1 - p) })) };
    }
    const m = rows.reduce((a, r) => a + r.yr, 0) / rows.length;
    return { F: m, rows: rows.map((r) => ({ x: r.x, y: r.yr, g: m - r.yr, h: 1 })) };
  }
  // bins por cuantiles (la misma cantidad de filas por bin, como el sketch de cuantiles): bordes en x
  function histogram(gr, nb) {
    const n = gr.length, edges = [], bins = [];
    for (let b = 0; b < nb; b++) {
      const lo = Math.floor(b * n / nb), hi = Math.floor((b + 1) * n / nb);
      const part = gr.slice(lo, hi);
      bins.push({ lo: part[0].x, hi: part[part.length - 1].x, n: part.length, G: part.reduce((a, r) => a + r.g, 0), H: part.reduce((a, r) => a + r.h, 0) });
      if (b < nb - 1) edges.push((gr[hi - 1].x + gr[hi].x) / 2);
    }
    return { bins, edges };
  }
  // barrido: umbral k = "x en bins 0…k a la izquierda" (k = 0 … nb − 2)
  function scan(hist, lambda, gamma) {
    const G = hist.bins.reduce((a, b) => a + b.G, 0), H = hist.bins.reduce((a, b) => a + b.H, 0);
    const out = [];
    let GL = 0, HL = 0;
    for (let k = 0; k < hist.bins.length - 1; k++) {
      GL += hist.bins[k].G; HL += hist.bins[k].H;
      const GR = G - GL, HR = H - HL;
      const ok = HL >= MIN_CHILD && HR >= MIN_CHILD;
      out.push({ k, GL, HL, GR, HR, ok, gain: gain(GL, HL, GR, HR, lambda, gamma), chg: lossChg(GL, HL, GR, HR, lambda) });
    }
    let best = -1;
    out.forEach((s, i) => { if (s.ok && (best < 0 || s.gain > out[best].gain)) best = i; });
    return { G, H, splits: out, best };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const fint = fmt.int || ((n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const cfgId = params.config || 'xgboost-500-d6';
    let run = null, met = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { met = A.metrics(cfgId); } catch (e) { met = null; }
    const cfg = (run && run.config) || {};
    const pickB = (b) => (BIN_CHOICES.indexOf(+b) >= 0 ? +b : 16);
    const pickL = (v, list, d) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
    const state = { bins: pickB(params.bins), loss: params.loss === 'log' ? 'log' : 'sq', lambda: pickL(params.lambda, LAMBDAS, 1), gamma: pickL(params.gamma, GAMMAS, 0), k: null };
    const rows = data(1603);

    const wrap = V.html('div', { class: 'viz viz-hs' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      // las letras griegas no van en mayúsculas (η → H, λ → Λ): sin text-transform
      V.html('span', { class: 'viz-ctl-l', text: label, style: /[α-ω]/.test(label) ? 'text-transform:none' : null }, g);
      return items.map(([v, t]) => {
        const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g);
        b.addEventListener('click', () => { state[key] = v; state.k = null; draw(); });
        b._v = v; b._k = key; return b;
      });
    };
    const cB = chipGroup('Bins', BIN_CHOICES.map((b) => [b, String(b)]), 'bins');
    const cP = chipGroup('Pérdida', [['sq', 'cuadrática'], ['log', 'logística']], 'loss');
    const cL = chipGroup('λ', LAMBDAS.map((v) => [v, String(v)]), 'lambda');
    const cG = chipGroup('γ', GAMMAS.map((v) => [v, String(v)]), 'gamma');
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-hs-stage', tabindex: 0, role: 'group', 'aria-label': 'Histograma de gradientes de una feature y ganancia de cada umbral. Flechas izquierda y derecha: mover el umbral; Inicio: el mejor' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const real = V.html('div', { class: 'viz-real' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, sub('Datos sintéticos (' + NROWS + ' filas, una feature). La fórmula es la del paper de XGBoost (ec. 7): ganancia = ½[G_L²/(H_L+λ) + G_R²/(H_R+λ) − G²/(H+λ)] − γ, con G y H las sumas de gradientes y hessianos de cada lado; el peso de cada hoja es w = −G/(H+λ). λ achica los pesos y castiga los lados con poco H; γ es el costo de agregar una hoja: si ninguna ganancia supera 0, el nodo no se parte. Umbrales grises: un lado con H < min_child_weight = 1. En el código de XGBoost el corchete va sin el ½ (loss_chg) y el nodo se poda si loss_chg < γ.'));

    let lastNarrow = null;
    function draw() {
      [cB, cP, cL, cG].forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      const G0 = grads(rows, state.loss);
      const hist = histogram(G0.rows, state.bins);
      const sc = scan(hist, state.lambda, state.gamma);
      if (state.k == null || state.k >= sc.splits.length) state.k = sc.best >= 0 ? sc.best : Math.floor(sc.splits.length / 2);
      const cur = sc.splits[state.k];
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(520, cw)) : 860;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'Elegir el corte de una feature con histogramas' : 'Un nodo, una feature: histograma de gradientes (G_b, H_b por bin) → ganancia de cada umbral', 'viz-t');
      t(svg, 8, 29, (state.loss === 'log' ? 'logística: g = p − y, h = p(1 − p)' : 'cuadrática: g = F − y, h = 1') + ' · F_{t−1} = ' + G0.F.toFixed(2), 'viz-s');

      const x0 = narrow ? 34 : 60, pw = W - x0 - (narrow ? 10 : 210);
      const nb = state.bins, bw = pw / nb;
      const X = (b) => x0 + b * bw;               // borde izquierdo del bin b
      const cutX = X(state.k + 1);
      // ---- panel 1: los datos (x, y) con el umbral elegido y los dos pesos de hoja
      let y = 48;
      const h1 = narrow ? 92 : 110;
      const ys = G0.rows.map((r) => r.y), yMin = Math.min(...ys), yMax = Math.max(...ys);
      const Yd = (v) => y + h1 - (h1 - 8) * (v - yMin) / ((yMax - yMin) || 1) - 4;
      t(svg, x0, y - 6, narrow ? 'datos (filas ordenadas por x en bins)' : 'datos: y contra x (las columnas son los bins; cada una tiene ≈ ' + Math.round(NROWS / nb) + ' filas)', 'viz-n');
      V.svg('rect', { x: r1(x0), y: r1(y), width: r1(pw), height: r1(h1), class: 'viz-hs-bg' }, svg);
      for (let b = 1; b < nb; b++) V.svg('path', { d: 'M' + r1(X(b)) + ' ' + r1(y) + 'V' + r1(y + h1), class: 'viz-hs-grid' }, svg);
      G0.rows.forEach((r, i) => {
        const b = Math.min(nb - 1, Math.floor(i * nb / NROWS));
        const xx = X(b) + bw * ((i - b * NROWS / nb) + 0.5) / (NROWS / nb);
        V.svg('circle', { cx: r1(xx), cy: r1(Yd(r.y + (state.loss === 'log' ? (r1(((i * 37) % 11) / 11) - 0.5) * 0.12 : 0))), r: narrow ? 1.6 : 2, class: 'viz-hs-pt' + (b <= state.k ? ' is-l' : ' is-r') }, svg);
      });
      // predicción de cada lado tras este árbol: F + w (η = 1 solo para verla; el entrenamiento multiplica por η)
      const wl = leafWeight(cur.GL, cur.HL, state.lambda), wr = leafWeight(cur.GR, cur.HR, state.lambda);
      const toY = (f) => (state.loss === 'log' ? 1 / (1 + Math.exp(-f)) : f);
      V.svg('path', { d: 'M' + r1(x0) + ' ' + r1(Yd(toY(G0.F))) + 'H' + r1(x0 + pw), class: 'viz-hs-base' }, svg);
      V.svg('path', { d: 'M' + r1(x0) + ' ' + r1(Yd(toY(G0.F + wl))) + 'H' + r1(cutX), class: 'viz-hs-leaf is-l' }, svg);
      V.svg('path', { d: 'M' + r1(cutX) + ' ' + r1(Yd(toY(G0.F + wr))) + 'H' + r1(x0 + pw), class: 'viz-hs-leaf is-r' }, svg);
      if (!narrow) {
        t(svg, x0 + pw + 8, Yd(toY(G0.F)) + 4, 'F_{t−1}', 'viz-s');
        t(svg, x0 + pw + 8, Yd(toY(G0.F + wr)) + 4, 'F + w_R', 'viz-s');
      }
      // ---- panel 2: histograma G_b (con signo) y H_b
      y += h1 + 30;
      const h2 = narrow ? 70 : 84;
      const gmax = Math.max(...hist.bins.map((b) => Math.abs(b.G))) || 1;
      const zero = y + h2 / 2;
      t(svg, x0, y - 6, narrow ? 'G_b = Σ g por bin' : 'histograma: G_b = Σ g (barra) y H_b = Σ h (abajo) de las filas de cada bin', 'viz-n');
      V.svg('path', { d: 'M' + r1(x0) + ' ' + r1(zero) + 'H' + r1(x0 + pw), class: 'viz-hs-axis' }, svg);
      hist.bins.forEach((b, i) => {
        const hh = (h2 / 2 - 2) * Math.abs(b.G) / gmax;
        V.svg('rect', { x: r1(X(i) + 1), y: r1(b.G >= 0 ? zero - hh : zero), width: r1(Math.max(1, bw - 2)), height: r1(Math.max(0.8, hh)), class: 'viz-hs-bar' + (i <= state.k ? ' is-l' : ' is-r') }, svg);
        if (nb <= 16 || (!narrow && nb <= 32)) t(svg, X(i) + bw / 2, y + h2 + 11, (Math.abs(b.H) >= 10 ? b.H.toFixed(0) : b.H.toFixed(1)), 'viz-hs-hv', 'middle');
      });
      t(svg, x0 - 6, y + h2 + 11, 'H_b', 'viz-s', 'end');
      t(svg, x0 - 6, zero - h2 / 2 + 8, '+', 'viz-s', 'end');
      t(svg, x0 - 6, zero + h2 / 2, '−', 'viz-s', 'end');
      // ---- panel 3: ganancia por umbral
      y += h2 + 34;
      const h3 = narrow ? 80 : 96;
      const gains = sc.splits.map((s) => s.gain);
      const gHi = Math.max(0, ...gains), gLo = Math.min(0, ...gains);
      const Yg = (v) => y + h3 - (h3 - 6) * (v - gLo) / ((gHi - gLo) || 1) - 3;
      t(svg, x0, y - 6, narrow ? 'ganancia de cada umbral' : 'ganancia de cada umbral (corte entre bins) = ½[…] − γ', 'viz-n');
      V.svg('path', { d: 'M' + r1(x0) + ' ' + r1(Yg(0)) + 'H' + r1(x0 + pw), class: 'viz-hs-axis' }, svg);
      t(svg, x0 - 6, Yg(0) + 4, '0', 'viz-s', 'end');
      sc.splits.forEach((s, i) => {
        const cx = X(i + 1), top = Yg(Math.max(0, s.gain)), bot = Yg(Math.min(0, s.gain));
        const gEl = V.svg('g', { class: 'viz-cell-btn' }, svg);
        V.svg('rect', { x: r1(cx - Math.max(1.5, bw * 0.3)), y: r1(top), width: r1(Math.max(3, bw * 0.6)), height: r1(Math.max(1, bot - top)), class: 'viz-hs-gain' + (!s.ok ? ' is-off' : i === sc.best ? ' is-best' : s.gain <= 0 ? ' is-neg' : '') }, gEl);
        V.svg('rect', { x: r1(cx - bw / 2), y: r1(y), width: r1(bw), height: r1(h3), class: 'viz-hs-hit' }, gEl);
        gEl.addEventListener('click', () => { state.k = i; draw(); });
      });
      // umbral elegido: línea vertical a través de los tres paneles (cortada en los títulos de cada panel)
      const y2 = 48 + h1 + 30;
      V.svg('path', { d: 'M' + r1(cutX) + ' 46V' + r1(48 + h1 + 2) + 'M' + r1(cutX) + ' ' + r1(y2 - 2) + 'V' + r1(y2 + h2 + 14) + 'M' + r1(cutX) + ' ' + r1(y - 2) + 'V' + r1(y + h3 + 2), class: 'viz-hs-cut' }, svg);
      if (sc.best >= 0 && !narrow) t(svg, X(sc.best + 1), Yg(sc.splits[sc.best].gain) - 6, 'mejor', 'viz-n', 'middle');
      // cuentas a la derecha (ancho) o abajo (angosto)
      const lines = [
        'G_L = ' + cur.GL.toFixed(2) + '   H_L = ' + cur.HL.toFixed(1),
        'G_R = ' + cur.GR.toFixed(2) + '   H_R = ' + cur.HR.toFixed(1),
        'w_L = ' + wl.toFixed(3) + '   w_R = ' + wr.toFixed(3),
      ];
      let yEnd = y + h3 + 8;
      if (narrow) { lines.forEach((ln, i) => t(svg, 8, yEnd + 14 + i * 15, ln, 'viz-n')); yEnd += 14 + lines.length * 15; }
      else lines.forEach((ln, i) => t(svg, x0 + pw + 10, y + 14 + i * 16, ln.replace('   ', ' · '), 'viz-hs-acc'));
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(yEnd + 8));
      const bestTxt = sc.best >= 0 && sc.splits[sc.best].gain > 0 ? 'mejor corte después del bin ' + (sc.best + 1) + ' (x < ' + hist.edges[sc.best].toFixed(3) + '), ganancia ' + sc.splits[sc.best].gain.toFixed(3) : 'ninguna ganancia supera 0: el nodo queda hoja';
      svg.setAttribute('aria-label', nb + ' bins por cuantiles; umbral elegido después del bin ' + (state.k + 1) + ': G_L ' + cur.GL.toFixed(2) + ', H_L ' + cur.HL.toFixed(1) + ', G_R ' + cur.GR.toFixed(2) + ', H_R ' + cur.HR.toFixed(1) + ', ganancia ' + cur.gain.toFixed(3) + '; ' + bestTxt + '.');

      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = sub(k) + ' <b>' + sub(v) + '</b>'; };
      kv('umbral:', 'x < ' + hist.edges[state.k].toFixed(3) + ' (bins 1…' + (state.k + 1) + ' a la izquierda)');
      kv('G = G_L + G_R =', f2(sc.G) + (state.loss === 'sq' ? ' (≈ 0: F_{t−1} es el promedio)' : ''));
      const term = (G, H) => (G * G / (H + state.lambda)).toFixed(3);
      kv('ganancia (paper) = ½[' + term(cur.GL, cur.HL) + ' + ' + term(cur.GR, cur.HR) + ' − ' + term(cur.GL + cur.GR, cur.HL + cur.HR) + '] − ' + state.gamma + ' =', cur.ok ? cur.gain.toFixed(3) : '— (H < min_child_weight)');
      kv('loss_chg (código de XGBoost, sin ½) =', cur.chg.toFixed(3) + (cur.chg < state.gamma ? ' < γ: se poda' : ' ≥ γ: se queda'));
      kv('decisión:', bestTxt);
      kv('cortes evaluados:', fint(nb - 1) + ' (bins − 1) para esta feature');
      realNumbers();
    }

    // Números de la config del calculador (no ilustrativos)
    function realNumbers() {
      real.innerHTML = '';
      if (!run) return;
      const rd = V.html('div', { class: 'viz-readout' }, real);
      const kv = (k, v) => { const sp = V.html('span', null, rd); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(o[k])) return o[k]; return null; };
      kv('config:', (run.label || cfgId));
      const bins = pick(cfg, ['bins', 'maxBin', 'max_bin']), F = pick(cfg, ['F', 'features']), N = pick(cfg, ['N', 'rows']);
      const nbins = pick(cfg, ['histBins']) || bins;
      if (nbins != null) kv('bins por feature (a lo sumo):', fint(nbins));
      if (F != null && nbins != null) kv('cortes candidatos por nodo ((bins − 1) × F):', fint((nbins - 1) * F));
      if (N != null && F != null) kv('filas × features (N × F):', fint(N) + ' × ' + fint(F));
      const sf = pick(met, ['splitEvalsPerTree']);
      if (sf != null) kv('cortes evaluados por árbol (calculador):', fint(sf));
      const ha = pick(met, ['histogramAddsPerTree']);
      if (ha != null) kv('sumas a histogramas por árbol:', fint(ha));
      const hb = pick(met, ['histogramBytesPerNode']);
      if (hb != null && fmt.bytes) kv('un histograma (F × bins × (g, h)):', fmt.bytes(hb));
    }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, n = state.bins - 1;
      if (k === 'ArrowRight' || k === 'ArrowUp') { ev.preventDefault(); state.k = Math.min(n - 1, state.k + 1); draw(); }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { ev.preventDefault(); state.k = Math.max(0, state.k - 1); draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.k = null; draw(); }
      else if (k === 'End') { ev.preventDefault(); state.k = n - 1; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.histSplit = { gain, lossChg, leafWeight, histogram, scan, grads, data };
    ATLAS.Viz.register('histogram-split', render);
  }
})(typeof window !== 'undefined' ? window : globalThis);
