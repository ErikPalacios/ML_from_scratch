/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/action-tokenizer.js
   Visualización "action-tokenizer" (SPEC §7.8, §21.4): una acción continua de 7 grados de libertad → 256 bins por
   dimensión → tokens de texto, y de vuelta (bin → centro del bin). Arriba, una dimensión a lo largo de un episodio: la
   curva continua y la escalera cuantizada (el error de cuantización a la vista). Abajo, el paso elegido: los 7 valores,
   su bin, el valor reconstruido y el error, y la fila de tokens que emite el modelo:
   - RT-2 (Brohan et al. 2023, arXiv:2307.15818): 8 tokens, "terminar" + Δpos (3) + Δrot (3) + pinza, cada uno el entero
     del bin escrito como texto (PaLI-X tiene un token por entero; en PaLM-E se pisan los 256 tokens menos usados).
   - OpenVLA (Kim et al. 2024, arXiv:2406.09246): 7 tokens; los bins pisan los 256 ÚLTIMOS ids del vocabulario de Llama
     (los menos usados). Como el ActionTokenizer del código oficial (ATLAS.Arch.vla.openvlaTokenize / openvlaDetokenize):
     bordes = linspace(−1, 1, 256) → 255 intervalos; d = digitize(x) ∈ 1…256, id = 32,000 − d, de vuelta al centro del
     intervalo clip(d − 1, 0, 254) (x = 0 → d = 128, id 31,872). Los límites de cada dimensión son los cuantiles 1 % y 99 %
     de los datos (un valor atípico no ensancha los bins); x se normaliza a [−1, 1] con ellos.
   Lo ilustrativo: la trayectoria y el "dataset" (sintéticos, con semilla) — rotulados. Lo real: 256 bins, 7 dims (+ 1
   de RT-2), la regla de los ids de OpenVLA, que el error máximo es medio bin.
   params: { model:'openvla'|'rt2', bins:256|64|16, bounds:'quantile'|'minmax', dim:0…6, t:0…N−1 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const DIMS = [
    { id: 'dx', label: 'Δx', grp: 'pos' }, { id: 'dy', label: 'Δy', grp: 'pos' }, { id: 'dz', label: 'Δz', grp: 'pos' },
    { id: 'droll', label: 'Δroll', grp: 'rot' }, { id: 'dpitch', label: 'Δpitch', grp: 'rot' }, { id: 'dyaw', label: 'Δyaw', grp: 'rot' },
    { id: 'grip', label: 'pinza', grp: 'grip' },
  ];
  const N = 48;                      // pasos del episodio ilustrativo
  const BINS = [256, 64, 16];
  const MODELS = {
    openvla: { label: 'OpenVLA', vocab: 32000 },
    rt2: { label: 'RT-2' },
  };

  // Episodio sintético (normalizado, ≈ [−1, 1]): movimientos suaves por dimensión + la pinza que se cierra a la mitad.
  // Con un valor atípico en Δz (un tirón): con límites min–max ensancha todos los bins de esa dimensión.
  function episode(rng, k, spike) {
    const out = DIMS.map(() => new Float64Array(N));
    for (let d = 0; d < 6; d++) {
      const a = 0.35 + 0.4 * rng(), f = 0.6 + 1.6 * rng(), ph = 6.28 * rng(), b = 0.25 * (rng() - 0.5), c = 0.18 + 0.2 * rng();
      for (let i = 0; i < N; i++) {
        const s = i / (N - 1);
        out[d][i] = a * Math.sin(6.283 * f * s * 0.5 + ph) + b + c * Math.sin(6.283 * 3.1 * s + ph * 1.7) * Math.exp(-2 * s) + 0.04 * rng.normal();
      }
    }
    const close = Math.round(N * (0.42 + 0.16 * rng()));
    for (let i = 0; i < N; i++) out[6][i] = i < close ? 1 : -1;
    if (spike) out[2][Math.round(N * 0.7) + (k % 3)] = 2.4 + 0.5 * rng();
    return out;
  }

  function quantile(sorted, p) {
    const x = (sorted.length - 1) * p, i = Math.floor(x), f = x - i;
    return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const rng = V.rng(20240609);
    // el "dataset": 60 episodios (uno de cada 6 con un tirón en Δz); el que se muestra es el primero con tirón
    const data = [];
    for (let k = 0; k < 60; k++) data.push(episode(rng, k, k % 6 === 0));
    const ep = data[0];
    // límites por dimensión: cuantiles 1 % y 99 % (OpenVLA) o mínimo y máximo de todo el dataset
    const LIM = { quantile: [], minmax: [] };
    for (let d = 0; d < DIMS.length; d++) {
      const all = [];
      for (const e of data) for (let i = 0; i < N; i++) all.push(e[d][i]);
      all.sort((p, q) => p - q);
      if (d === 6) { LIM.quantile.push([-1, 1]); LIM.minmax.push([-1, 1]); continue; }
      LIM.quantile.push([quantile(all, 0.01), quantile(all, 0.99)]);
      LIM.minmax.push([all[0], all[all.length - 1]]);
    }
    const state = {
      model: MODELS[params.model] ? params.model : 'openvla',
      bins: BINS.indexOf(+params.bins) >= 0 ? +params.bins : 256,
      bounds: params.bounds === 'minmax' || params.bounds === 'quantile' ? params.bounds : null,
      dim: Number.isInteger(+params.dim) && +params.dim >= 0 && +params.dim < 7 ? +params.dim : 0,
      t: Number.isInteger(+params.t) && +params.t >= 0 && +params.t < N ? +params.t : 20,
    };
    const boundsOf = () => state.bounds || (state.model === 'openvla' ? 'quantile' : 'minmax');
    // cuantizar: recortar a [lo, hi].
    // RT-2: n intervalos iguales, bin b = ⌊(x − lo)/w⌋ ∈ [0, n−1] (ATLAS.Arch.vla.discretize), de vuelta al centro del bin.
    // OpenVLA: como el código (openvlaTokenize / openvlaDetokenize): n BORDES en [−1, 1] → n − 1 intervalos, d ∈ 1…n, id = 32,000 − d.
    const VLA = A && A.vla;
    const quant = (x, d) => {
      const [lo, hi] = LIM[boundsOf()][d], n = state.bins;
      const xc = Math.min(hi, Math.max(lo, x)), clipped = xc !== x;
      if (state.model === 'openvla' && VLA && VLA.openvlaTokenize && VLA.openvlaDetokenize) {
        const xn = 2 * (xc - lo) / (hi - lo) - 1;
        const tk = VLA.openvlaTokenize(xn, { bins: n, vocab: MODELS.openvla.vocab });
        const dt = VLA.openvlaDetokenize(tk.id, { bins: n, vocab: MODELS.openvla.vocab });
        return { b: tk.bin, id: tk.id, back: lo + (dt.center + 1) / 2 * (hi - lo), w: (hi - lo) / (n - 1), nInt: n - 1, clipped, lo, hi };
      }
      const w = (hi - lo) / n;
      const b = VLA && VLA.discretize ? VLA.discretize(xc, { bins: n, lo, hi }).bin : Math.min(n - 1, Math.max(0, Math.floor((xc - lo) / w)));
      return { b, id: b, back: lo + (b + 0.5) * w, w, nInt: n, clipped, lo, hi };
    };

    const wrap = V.html('div', { class: 'viz viz-at' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const all = [];
    const chips = (g, vals, key, label) => vals.forEach((v) => {
      const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g);
      b.addEventListener('click', () => { state[key] = v; draw(); });
      b._k = key; b._v = v; all.push(b);
    });
    chips(grp('Modelo'), Object.keys(MODELS), 'model', (k) => MODELS[k].label);
    chips(grp('Bins por dimensión'), BINS, 'bins', (v) => String(v) + (v === 256 ? ' (real)' : ''));
    chips(grp('Límites'), ['quantile', 'minmax'], 'bounds', (v) => (v === 'quantile' ? 'cuantiles 1–99 %' : 'mín–máx'));
    const gDim = grp('Dimensión');
    chips(gDim, DIMS.map((_, i) => i), 'dim', (i) => DIMS[i].label);
    const stage = V.html('div', { class: 'viz-stage viz-at-stage', tabindex: 0, role: 'group', 'aria-label': 'Tokenizador de acciones. Flechas izquierda y derecha: paso del episodio; arriba y abajo: dimensión' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(b._k === 'bounds' ? boundsOf() === b._v : state[b._k] === b._v)));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(280, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      const d = state.dim, D = DIMS[d];
      const q0 = quant(0, d);
      // ---- panel 1: la dimensión elegida en el tiempo, continua vs cuantizada
      t(svg, 8, 15, (narrow ? '' : 'Una dimensión en el episodio: ') + D.label + ' continua y cuantizada a ' + state.bins + ' bins', 'viz-t');
      t(svg, 8, 29, narrow ? 'sintético (ilustrativo), normalizado' : 'episodio sintético (ilustrativo) · valores normalizados', 'viz-s');
      const px0 = 44, pw = W - px0 - 12, py0 = 40, ph = narrow ? 150 : 170;
      const vals = Array.from(ep[d]);
      const ymin = Math.min(-1.2, ...vals, q0.lo), ymax = Math.max(1.2, ...vals, q0.hi);
      const X = (i) => px0 + 6 + i / (N - 1) * (pw - 12), Y = (v) => py0 + ph - (v - ymin) / (ymax - ymin) * ph;
      V.svg('rect', { x: px0, y: py0, width: pw, height: ph, class: 'viz-rl-box' }, svg);
      // zonas fuera de los límites (se recorta) y líneas de bins (todas si son pocas; con 256, una de cada 16)
      if (q0.hi < ymax) V.svg('rect', { x: px0, y: r1(py0), width: pw, height: r1(Y(q0.hi) - py0), class: 'viz-at-clip' }, svg);
      if (q0.lo > ymin) V.svg('rect', { x: px0, y: r1(Y(q0.lo)), width: pw, height: r1(py0 + ph - Y(q0.lo)), class: 'viz-at-clip' }, svg);
      const every = state.bins > 64 ? 16 : state.bins > 16 ? 4 : 1;
      let dg = '';
      for (let b = 0; b <= q0.nInt; b += every) { const yy = Y(q0.lo + b * q0.w); if (yy >= py0 - 0.5 && yy <= py0 + ph + 0.5) dg += 'M' + px0 + ' ' + r1(yy) + 'H' + r1(px0 + pw); }
      V.svg('path', { d: dg, class: 'viz-rl-grid' }, svg);
      [q0.lo, q0.hi].forEach((v, k) => { V.svg('path', { d: 'M' + px0 + ' ' + r1(Y(v)) + 'H' + r1(px0 + pw), class: 'viz-at-lim' }, svg); t(svg, px0 + pw - 4, Y(v) + (k ? 12 : -4), (k ? 'límite sup. ' : 'límite inf. ') + v.toFixed(2), 'viz-at-limt', 'end'); });
      [-1, 0, 1].forEach((v) => { if (v > ymin && v < ymax) t(svg, px0 - 4, Y(v) + 4, String(v), 'viz-s', 'end'); });
      // curva continua y escalera cuantizada
      V.svg('path', { d: vals.map((v, i) => (i ? 'L' : 'M') + r1(X(i)) + ' ' + r1(Y(v))).join(''), class: 'viz-at-cont' }, svg);
      let st = '';
      vals.forEach((v, i) => { const qv = quant(v, d).back, xa = i ? (X(i - 1) + X(i)) / 2 : X(0), xb = i < N - 1 ? (X(i) + X(i + 1)) / 2 : X(N - 1); st += (i ? 'L' + r1(xa) + ' ' + r1(Y(qv)) : 'M' + r1(xa) + ' ' + r1(Y(qv))) + 'H' + r1(xb); });
      V.svg('path', { d: st, class: 'viz-at-stair' }, svg);
      // paso elegido
      const cur = quant(vals[state.t], d);
      V.svg('path', { d: 'M' + r1(X(state.t)) + ' ' + py0 + 'V' + (py0 + ph), class: 'viz-at-cur' }, svg);
      V.svg('circle', { cx: r1(X(state.t)), cy: r1(Y(vals[state.t])), r: 4, class: 'viz-at-pt' }, svg);
      V.svg('circle', { cx: r1(X(state.t)), cy: r1(Y(cur.back)), r: 3.5, class: 'viz-at-qpt' }, svg);
      t(svg, px0 + pw / 2, py0 + ph + 14, narrow ? 'paso 0…' + (N - 1) + ' (← →)' : 'paso del episodio (0…' + (N - 1) + '; ← → para mover)', 'viz-s', 'middle');
      // pasos clicables (hit invisibles)
      const hit = V.svg('g', { class: 'viz-at-hits' }, svg);
      for (let i = 0; i < N; i++) {
        const r = V.svg('rect', { x: r1(X(i) - (pw - 12) / (N - 1) / 2), y: py0, width: r1((pw - 12) / (N - 1)), height: ph, class: 'viz-at-hit' }, hit);
        r.addEventListener('click', () => { state.t = i; draw(); });
      }
      // leyenda del panel 1
      let ly = py0 + ph + 30;
      const lg = (x, cls, s) => { V.svg('path', { d: 'M' + r1(x) + ' ' + r1(ly - 4) + 'h18', class: cls }, svg); return t(svg, x + 23, ly, s, 'viz-s'); };
      if (narrow) { lg(8, 'viz-at-cont', 'continua (lo que quiere el robot)'); ly += 14; lg(8, 'viz-at-stair', 'cuantizada (centro del bin)'); ly += 14; V.svg('rect', { x: 8, y: r1(ly - 9), width: 18, height: 9, class: 'viz-at-clip' }, svg); t(svg, 31, ly, 'fuera de los límites: se recorta', 'viz-s'); }
      else { lg(8, 'viz-at-cont', 'continua (lo que quiere el robot)'); lg(290, 'viz-at-stair', 'cuantizada (centro del bin)'); V.svg('rect', { x: 530, y: r1(ly - 9), width: 18, height: 9, class: 'viz-at-clip' }, svg); t(svg, 553, ly, 'fuera de los límites: se recorta', 'viz-s'); }
      // ---- panel 2: el paso elegido, las 7 dimensiones → bins → tokens
      let y = ly + 30;
      t(svg, 8, y, 'Paso ' + state.t + ': acción → bins → tokens' + (narrow ? '' : ' (' + MODELS[state.model].label + ')'), 'viz-t');
      y += 14;
      const row = (narrow ? 16 : 18), colsW = narrow ? [44, 64, 40, 70, 52] : [86, 120, 70, 170, 90];
      const ovl = state.model === 'openvla';
      const heads = narrow ? ['dim', 'valor', ovl ? 'd' : 'bin', 'de vuelta', 'error'] : ['dimensión', 'valor continuo', ovl ? 'bin d' : 'bin b', 'de vuelta (centro)', '|error|'];
      let cx = 8;
      const colX = colsW.map((w) => { const x = cx; cx += w; return x; });
      heads.forEach((h, k) => t(svg, colX[k] + (k ? colsW[k] - 8 : 0), y + 10, h, 'viz-s', k ? 'end' : null));
      y += 14;
      const rows = DIMS.map((dd, k) => { const v = ep[k][state.t], qq = quant(v, k); return { k, dd, v, qq, err: Math.abs(v - qq.back) }; });
      rows.forEach((r) => {
        const on = r.k === d, gy = y;
        const gEl = V.svg('g', { class: 'viz-cell-btn viz-at-row' + (on ? ' is-on' : '') }, svg);
        gEl.addEventListener('click', () => { state.dim = r.k; draw(); });
        V.svg('rect', { x: 4, y: r1(gy), width: r1(cx - 4), height: row - 2, rx: 3, class: 'viz-at-rowbg' + (on ? ' is-on' : '') }, gEl);
        t(gEl, colX[0] + 4, gy + row - 6, r.dd.label, on ? 'viz-n' : 'viz-s');
        t(gEl, colX[1] + colsW[1] - 8, gy + row - 6, r.v.toFixed(3), 'viz-n', 'end');
        t(gEl, colX[2] + colsW[2] - 8, gy + row - 6, String(r.qq.b) + (r.qq.clipped ? '*' : ''), 'viz-n', 'end');
        t(gEl, colX[3] + colsW[3] - 8, gy + row - 6, r.qq.back.toFixed(3), 'viz-n', 'end');
        t(gEl, colX[4] + colsW[4] - 8, gy + row - 6, r.err.toFixed(3), r.err > r.qq.w / 2 + 1e-9 ? 'viz-at-bad' : 'viz-s', 'end');
        y += row;
      });
      if (rows.some((r) => r.qq.clipped)) { t(svg, 8, y + 11, '* recortado a los límites: el error supera medio bin', 'viz-at-bad'); y += 14; }
      // fila de tokens
      y += 16;
      t(svg, 8, y, state.model === 'rt2' ? (narrow ? 'RT-2 escribe 8 tokens' : 'Lo que escribe RT-2 (8 tokens: terminar + 7)') : (narrow ? 'OpenVLA escribe 7 tokens (ids)' : 'Lo que escribe OpenVLA (7 tokens: ids del vocabulario de Llama)'), 'viz-t');
      y += 10;
      const toks = (state.model === 'rt2' ? [{ lab: 'terminar', v: state.t === N - 1 ? 1 : 0, term: true }] : []).concat(rows.map((r) => ({ lab: r.dd.label, v: r.qq.id, k: r.k })));
      const per = narrow ? 4 : toks.length, tw = narrow ? (W - 16 - 3 * 6) / 4 : Math.min(96, (W - 16 - (toks.length - 1) * 6) / toks.length), th = 34;
      toks.forEach((tk, i) => {
        const col = i % per, line = Math.floor(i / per);
        const x = 8 + col * (tw + 6), yy = y + line * (th + 8);
        const on = tk.k === d;
        V.svg('rect', { x: r1(x), y: r1(yy), width: r1(tw), height: th, rx: 4, class: 'viz-at-tok' + (tk.term ? ' is-term' : '') + (on ? ' is-on' : '') }, svg);
        t(svg, x + tw / 2, yy + 15, String(tk.v), 'viz-at-tokv', 'middle');
        t(svg, x + tw / 2, yy + 28, tk.lab, 'viz-s', 'middle');
      });
      y += Math.ceil(toks.length / per) * (th + 8) + 4;
      if (state.model === 'openvla') { t(svg, 8, y + 6, narrow ? 'id = 32000 − d: los 256 últimos ids' : 'id = 32000 − d (d = digitize, 1…256): los 256 últimos ids del vocabulario de 32,000 (31744…31999)', 'viz-s'); y += 12; t(svg, 8, y + 8, narrow ? '256 bordes → 255 intervalos' : '256 bordes en [−1, 1] → 255 intervalos (como el código; el paper dice "256 bins")', 'viz-s'); y += 14; }
      else { t(svg, 8, y + 6, narrow ? 'token = el entero del bin, como texto' : 'cada token es el entero del bin escrito como texto (PaLI-X tiene un token por entero)', 'viz-s'); y += 12; }
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y + 8));
      svg.setAttribute('aria-label', 'Dimensión ' + D.label + ' en el paso ' + state.t + ': valor ' + vals[state.t].toFixed(3) + ', bin ' + cur.b + ' de ' + state.bins + ', de vuelta ' + cur.back.toFixed(3) + '. Tokens: ' + toks.map((x) => x.v).join(' '));
      readout(rows, cur, vals, d);
    }
    function readout(rows, cur, vals, d) {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('ancho del bin (' + DIMS[d].label + '):', cur.w.toFixed(4) + (state.model === 'openvla' ? ' (' + cur.nInt + ' intervalos)' : ''));
      kv('error máx. dentro de los límites (medio bin):', (cur.w / 2).toFixed(4));
      // el error medio, solo con los pasos dentro de los límites; los recortados aparte (su error supera medio bin)
      const qs = vals.map((v) => { const qq = quant(v, d); return { e: Math.abs(v - qq.back), c: qq.clipped }; });
      const inn = qs.filter((x) => !x.c), cl = qs.filter((x) => x.c);
      const mean = (a) => a.reduce((s, x) => s + x.e, 0) / a.length;
      kv('error medio (dentro de los límites):', inn.length ? mean(inn).toFixed(4) : '—');
      if (cl.length) kv('pasos recortados:', cl.length + ' (error medio ' + mean(cl).toFixed(4) + ')');
      kv('tokens por paso:', state.model === 'rt2' ? '8' : '7');
      note.innerHTML = 'Datos ilustrativos (una trayectoria sintética, normalizada). Lo real: ' + (state.model === 'rt2' ? 'RT-2 discretiza cada dimensión continua en 256 bins uniformes y escribe la acción como 8 enteros separados por espacios ("terminar", Δpos, Δrot, pinza); con PaLI-X cada entero ya es un token, con PaLM-E pisa los 256 tokens menos usados.' : 'OpenVLA normaliza cada dimensión a [−1, 1] con sus cuantiles 1 % y 99 % en los datos de entrenamiento y la parte con 256 bordes uniformes (255 intervalos: el paper dice "256 bins"; el código, linspace(−1, 1, 256)) (un tirón aislado no ensancha los bins; con mín–máx sí, y todos los pasos pierden precisión), y escribe cada bin como uno de los 256 últimos tokens de Llama.') + ' Volver del bin al valor da el centro del bin: el error es a lo sumo medio bin, salvo lo recortado (por eso el error medio se cuenta solo dentro de los límites). Con menos bins, la escalera se ve: es el precio de convertir acciones en tokens.';
    }

    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.t = Math.max(0, Math.min(N - 1, state.t + (k === 'ArrowRight' ? 1 : -1))); draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); state.dim = (state.dim + (k === 'ArrowDown' ? 1 : 6)) % 7; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('action-tokenizer', render);
})(typeof window !== 'undefined' ? window : globalThis);
