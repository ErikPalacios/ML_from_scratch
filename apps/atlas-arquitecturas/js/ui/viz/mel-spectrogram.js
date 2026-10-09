/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/mel-spectrogram.js
   Visualización "mel-spectrogram" (SPEC §7.8, §24.4): de la onda a las posiciones del encoder de Whisper.
   Radford et al., ICML 2023 (arXiv:2212.04356), §2.2: audio a 16 kHz, log-Mel de 80 canales (128 en large-v3) con ventanas de
   25 ms y salto de 10 ms, normalizado; todo audio se rellena (o corta) a 30 s → 3,000 frames; el encoder empieza con dos conv1d
   (kernel 3, GELU; la segunda con stride 2) → 1,500 posiciones + posiciones sinusoidales.
   El procesamiento es EL de Whisper (verificado contra WhisperFeatureExtractor de HF: diferencia máx. 2e-5) (whisper/audio.py: STFT con n_fft = 400, hop = 160, ventana de Hann periódica, center con
   reflect, se descarta el último frame, |·|², filtros mel de librosa (escala y norma Slaney), log10 con piso 1e-10, recorte a
   máx − 8 y (x + 4) / 4); la FFT de 400 puntos es mixta (2 y 5). Lo ilustrativo es el AUDIO: una "voz" sintética (sílabas con
   armónicos y formantes, fricativas de ruido y pausas; semilla fija), no una grabación.
   Del calculador (si está el modelo): bandas mel, frames y posiciones del encoder de la config elegida.
   params: { config:'whisper-small'|'whisper-large-v3', seconds:3|12|30 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const SR = 16000, NFFT = 400, HOP = 160, WIN_S = 30, NS = SR * WIN_S;
  const SECS = [3, 12, 30];
  const CFGS = [{ id: 'whisper-small', label: 'Whisper small', mels: 80 }, { id: 'whisper-large-v3', label: 'large-v3', mels: 128 }];

  // ---- FFT de largo mixto (factores 2 y 5; 400 = 2⁴·5²), recursiva por decimación en el tiempo; twiddles en tabla por largo
  const TW = {};
  function tw(n) {
    if (!TW[n]) { const c = new Float64Array(n), s = new Float64Array(n); for (let i = 0; i < n; i++) { c[i] = Math.cos(-2 * Math.PI * i / n); s[i] = Math.sin(-2 * Math.PI * i / n); } TW[n] = { c, s }; }
    return TW[n];
  }
  function fft(xr, xi, n, stride, off) {
    const p = n % 2 === 0 ? 2 : n % 5 === 0 ? 5 : n;
    const m = n / p, T = tw(n), R = new Float64Array(n), I = new Float64Array(n);
    if (m === 1) {                                   // hoja: DFT directa de p puntos
      for (let k = 0; k < n; k++) { let sr = 0, si = 0; for (let j = 0; j < n; j++) { const q = (j * k) % n, ur = xr[off + j * stride], ui = xi[off + j * stride]; sr += ur * T.c[q] - ui * T.s[q]; si += ur * T.s[q] + ui * T.c[q]; } R[k] = sr; I[k] = si; }
      return [R, I];
    }
    const subs = [];
    for (let r = 0; r < p; r++) subs.push(fft(xr, xi, m, stride * p, off + r * stride));
    for (let k = 0; k < n; k++) {
      let sr = 0, si = 0;
      const km = k % m;
      for (let r = 0; r < p; r++) {
        const q = (r * k) % n, ur = subs[r][0][km], ui = subs[r][1][km];
        sr += ur * T.c[q] - ui * T.s[q]; si += ur * T.s[q] + ui * T.c[q];
      }
      R[k] = sr; I[k] = si;
    }
    return [R, I];
  }
  // ---- filtros mel de librosa (htk = false: escala Slaney; norm = 'slaney')
  function hzToMel(f) { const fsp = 200 / 3, minHz = 1000, minMel = minHz / fsp, step = Math.log(6.4) / 27; return f >= minHz ? minMel + Math.log(f / minHz) / step : f / fsp; }
  function melToHz(m) { const fsp = 200 / 3, minHz = 1000, minMel = minHz / fsp, step = Math.log(6.4) / 27; return m >= minMel ? minHz * Math.exp(step * (m - minMel)) : fsp * m; }
  function melFilters(nMels) {
    const nb = NFFT / 2 + 1, fft = Array.from({ length: nb }, (_, i) => i * SR / NFFT);
    const m0 = hzToMel(0), m1 = hzToMel(SR / 2);
    const hz = Array.from({ length: nMels + 2 }, (_, i) => melToHz(m0 + (m1 - m0) * i / (nMels + 1)));
    return Array.from({ length: nMels }, (_, i) => {
      const w = new Float64Array(nb), en = 2 / (hz[i + 2] - hz[i]);
      for (let k = 0; k < nb; k++) {
        const lo = (fft[k] - hz[i]) / (hz[i + 1] - hz[i]), up = (hz[i + 2] - fft[k]) / (hz[i + 2] - hz[i + 1]);
        w[k] = Math.max(0, Math.min(lo, up)) * en;
      }
      return w;
    });
  }
  // ---- "voz" sintética: sílabas (armónicos de f0 con dos formantes), fricativas (ruido diferenciado) y pausas
  function synthVoice(seconds, seed, V) {
    const rng = V.rng(seed), n = Math.round(seconds * SR), x = new Float64Array(NS);
    const VOW = [[730, 1090], [270, 2290], [530, 1840], [570, 840], [300, 870], [440, 1020]];
    let t = 0.25;
    const end = Math.min(seconds, WIN_S) - 0.15;
    while (t < end) {
      const nSyl = 2 + Math.floor(rng() * 3);
      for (let s = 0; s < nSyl && t < end; s++) {
        if (rng() < 0.45) {                          // fricativa
          const d = 0.04 + 0.05 * rng(), a = Math.round(t * SR), b = Math.min(n, Math.round((t + d) * SR));
          let prev = 0;
          for (let i = a; i < b; i++) { const w = rng() * 2 - 1, env = Math.sin(Math.PI * (i - a) / (b - a)); x[i] += 0.18 * (w - prev) * env; prev = w; }
          t += d;
        }
        const d = 0.11 + 0.18 * rng(), a = Math.round(t * SR), b = Math.min(n, Math.round((t + d) * SR));
        const [F1, F2] = VOW[Math.floor(rng() * VOW.length)], f0a = 110 + 70 * rng(), f0b = f0a * (0.85 + 0.3 * rng());
        const H = Math.floor(3800 / Math.max(f0a, f0b));
        const amp = Array.from({ length: H + 1 }, (_, h) => (h ? Math.exp(-Math.pow((h * f0a - F1) / 180, 2)) + 0.6 * Math.exp(-Math.pow((h * f0a - F2) / 260, 2)) + 0.05 / h : 0));
        let ph = 0;
        for (let i = a; i < b; i++) {
          const u = (i - a) / (b - a), f0 = f0a + (f0b - f0a) * u, env = Math.min(1, u * 12) * Math.min(1, (1 - u) * 8);
          ph += 2 * Math.PI * f0 / SR;
          let v = 0;
          for (let h = 1; h <= H; h++) v += amp[h] * Math.sin(h * ph);
          x[i] += 0.12 * env * v;
        }
        t += d + 0.015 * rng();
      }
      t += 0.05 + 0.18 * rng();                        // pausa entre palabras
    }
    return x;
  }
  // ---- log-Mel como whisper/audio.py (sobre la señal ya rellenada a 30 s)
  function logMel(x, nMels) {
    const filt = melFilters(nMels), nb = NFFT / 2 + 1;
    const win = Float64Array.from({ length: NFFT }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NFFT));   // Hann periódica
    const nFrames = 1 + Math.floor(NS / HOP) - 1;      // center=True da 3,001; Whisper descarta el último
    const pad = NFFT / 2, at = (i) => { const j = i - pad; return j < 0 ? x[-j] : j >= NS ? x[2 * NS - j - 2] : x[j]; };   // reflect
    let last = 0;
    for (let i = NS - 1; i >= 0; i--) if (x[i] !== 0) { last = i; break; }
    const mel = new Float64Array(nMels * nFrames);
    const zr = new Float64Array(NFFT), zi = new Float64Array(NFFT);
    let mx = -Infinity;
    for (let f = 0; f < nFrames; f++) {
      const s0 = f * HOP;
      let silent = s0 - pad > last + 1;
      if (!silent) {
        for (let i = 0; i < NFFT; i++) { zr[i] = at(s0 + i) * win[i]; zi[i] = 0; }
        const [R, I] = fft(zr, zi, NFFT, 1, 0);
        for (let m = 0; m < nMels; m++) {
          let acc = 0;
          const w = filt[m];
          for (let k = 0; k < nb; k++) if (w[k]) acc += w[k] * (R[k] * R[k] + I[k] * I[k]);
          const v = Math.log10(Math.max(acc, 1e-10));
          mel[m * nFrames + f] = v;
          if (v > mx) mx = v;
        }
      } else for (let m = 0; m < nMels; m++) mel[m * nFrames + f] = -10;
    }
    for (let i = 0; i < mel.length; i++) mel[i] = (Math.max(mel[i], mx - 8) + 4) / 4;
    return { mel, nFrames, nMels, max: (mx + 4) / 4, min: (mx - 8 + 4) / 4 };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fint = (A && A.fmt && A.fmt.int) || ((n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const state = {
      cfg: CFGS.some((c) => c.id === params.config) ? params.config : 'whisper-small',
      sec: SECS.indexOf(+params.seconds) >= 0 ? +params.seconds : 12,
      cur: 2.4,
    };
    const cache = {};
    // números de la config: del calculador si está el modelo; si no, los del paper (marcados)
    function nums(id) {
      const def = CFGS.find((c) => c.id === id);
      let c = null;
      try { c = A && A.run ? A.run(id).config : null; } catch (e) { c = null; }
      const pick = (ks, d) => { for (const k of ks) if (c && Number.isFinite(+c[k]) && +c[k] > 0) return +c[k]; return d; };
      const mels = pick(['nMels', 'mels', 'nmels', 'melBins'], def.mels);
      const frames = pick(['frames', 'nFrames', 'melFrames'], 3000);
      const pos = pick(['Tin', 'encPositions', 'audioCtx', 'nAudioCtx'], frames / 2);
      const D = pick(['D', 'd'], null);
      return { mels, frames, pos, D, src: c ? 'calculador' : 'paper', label: def.label };
    }
    function data() {
      const N = nums(state.cfg), key = state.sec + '|' + N.mels;
      if (!cache[key]) { const x = synthVoice(state.sec, 2212 + state.sec, V); cache[key] = { x, lm: logMel(x, N.mels) }; }
      return Object.assign({ N }, cache[key]);
    }

    const wrap = V.html('div', { class: 'viz viz-mel' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const all = [];
    const chips = (g, vals, key, label) => vals.map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._v = v; b._k = key; all.push(b); return b; });
    chips(grp('Voz'), SECS, 'sec', (v) => v + ' s');
    chips(grp('Modelo'), CFGS.map((c) => c.id), 'cfg', (v) => CFGS.find((c) => c.id === v).label + ' · ' + nums(v).mels + ' mel');
    V.html('span', { class: 'viz-tag', text: 'audio sintético' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-mel-stage', tabindex: 0, role: 'group', 'aria-label': 'De la onda al encoder de Whisper. Flechas izquierda y derecha: mover el cursor de tiempo (0.1 s; con Mayúsculas, 1 s)' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);
    const cv = root.document.createElement('canvas');
    let maskN = 0;

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      const D = data(), N = D.N, lm = D.lm;
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 15, narrow ? 'Audio → log-Mel → encoder' : 'De la onda a las posiciones del encoder de Whisper (' + N.label + ')', 'viz-t');
      t(svg, 8, 29, narrow ? 'voz sintética; proceso de Whisper' : 'voz sintética de ' + state.sec + ' s; el log-Mel se calcula como en whisper/audio.py', 'viz-s');
      const x0 = narrow ? 8 : 88, gw = W - x0 - 8, X = (s) => x0 + gw * s / WIN_S;
      const lab = (y, s1, s2) => { if (narrow) { t(svg, 8, y, s1 + (s2 ? ' · ' + s2 : ''), 'viz-n'); } else { t(svg, x0 - 8, y + 4, s1, 'viz-n', 'end'); if (s2) t(svg, x0 - 8, y + 17, s2, 'viz-s', 'end'); } };
      // ---- 1. onda (envolvente min/max por columna), 30 s con el relleno
      let y = narrow ? 52 : 46;
      if (narrow) { lab(y, 'onda', '16 kHz'); y += 8; }
      const wh = narrow ? 44 : 56, mid = y + wh / 2, cols = Math.round(gw), per = NS / cols;
      if (!narrow) lab(y + wh / 2 - 8, 'onda', '16 kHz');
      V.svg('rect', { x: r1(X(state.sec)), y: r1(y), width: r1(X(WIN_S) - X(state.sec)), height: wh, class: 'viz-mel-pad' }, svg);
      let d = '';
      for (let c = 0; c < cols; c++) {
        let lo = 0, hi = 0;
        const a = Math.floor(c * per), b = Math.floor((c + 1) * per);
        for (let i = a; i < b; i += 4) { const v = D.x[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        d += 'M' + r1(x0 + c + 0.5) + ' ' + r1(mid - hi * wh * 0.9) + 'V' + r1(mid - lo * wh * 0.9 + 0.6);
      }
      V.svg('path', { d, class: 'viz-mel-wave' }, svg);
      if (state.sec < WIN_S) t(svg, (X(state.sec) + X(WIN_S)) / 2, mid + 4, narrow ? 'relleno (ceros)' : 'relleno con ceros hasta 30 s', 'viz-s', 'middle');
      y += wh + 8;
      // eje de tiempo
      for (let s = 0; s <= WIN_S; s += narrow ? 10 : 5) { V.svg('path', { d: 'M' + r1(X(s)) + ' ' + r1(y) + 'v4', class: 'viz-xam-tick' }, svg); t(svg, X(s), y + 15, s + ' s', 'viz-s', s === 0 ? 'start' : s === WIN_S ? 'end' : 'middle'); }
      y += 28;
      // ---- 2. log-Mel: n_mels × 3,000 frames como imagen (máscara de luminancia sobre el color de audio: cambia con el tema)
      const mh = narrow ? 90 : 128;
      if (narrow) { lab(y, 'log-Mel', N.mels + ' × ' + fint(lm.nFrames)); y += 8; } else lab(y + mh / 2 - 8, 'log-Mel', N.mels + ' × ' + fint(lm.nFrames));
      const iw = Math.min(lm.nFrames, Math.round(gw * 2)), ih = lm.nMels;
      cv.width = iw; cv.height = ih;
      const c2 = cv.getContext('2d'), im = c2.createImageData(iw, ih), span = lm.max - lm.min || 1;
      for (let px = 0; px < iw; px++) {
        const fa = Math.floor(px * lm.nFrames / iw), fb = Math.max(fa + 1, Math.floor((px + 1) * lm.nFrames / iw));
        for (let m = 0; m < ih; m++) {
          let v = -Infinity;
          for (let f = fa; f < fb; f++) v = Math.max(v, lm.mel[m * lm.nFrames + f]);
          const u = Math.max(0, Math.min(1, (v - lm.min) / span)), g = Math.round(255 * Math.pow(u, 1.15));
          const o = ((ih - 1 - m) * iw + px) * 4;            // graves abajo
          im.data[o] = im.data[o + 1] = im.data[o + 2] = g; im.data[o + 3] = 255;
        }
      }
      c2.putImageData(im, 0, 0);
      const mid2 = 'viz-mel-m' + (++maskN) + Math.floor(Math.random() * 1e6);
      const defs = V.svg('defs', null, svg);
      const mk = V.svg('mask', { id: mid2, maskUnits: 'userSpaceOnUse', x: x0, y, width: gw, height: mh }, defs);
      V.svg('image', { href: cv.toDataURL(), x: x0, y, width: gw, height: mh, preserveAspectRatio: 'none', style: 'image-rendering:pixelated' }, mk);
      V.svg('rect', { x: x0, y, width: gw, height: mh, class: 'viz-mel-bg' }, svg);
      V.svg('rect', { x: x0, y, width: gw, height: mh, class: 'viz-mel-heat', mask: 'url(#' + mid2 + ')' }, svg);
      V.svg('rect', { x: x0, y, width: gw, height: mh, class: 'viz-rl-box' }, svg);
      if (!narrow) { t(svg, x0 + 4, y + mh - 5, 'graves', 'viz-mel-ax'); t(svg, x0 + 4, y + 12, '8 kHz', 'viz-mel-ax'); }
      // cursor de tiempo
      const cx = X(state.cur);
      V.svg('path', { d: 'M' + r1(cx) + ' ' + r1(y - 6) + 'V' + r1(y + mh + 6), class: 'viz-mel-cur' }, svg);
      y += mh + 18;
      // ---- 3. frames → conv1 (stride 1) → conv2 (stride 2) → posiciones del encoder, en un tramo ampliado alrededor del cursor
      const nF = narrow ? 8 : 12;
      // f0 par: la salida j de la conv2 (stride 2, padding 1) se centra en el frame 2j
      const f0 = 2 * Math.floor(Math.max(0, Math.min(lm.nFrames - nF, Math.round(state.cur * 100) - nF / 2 + 1)) / 2), bw = narrow ? (W - 16) / nF : Math.min(44, (gw - 20) / nF), bx = narrow ? 8 : x0;
      if (!narrow) { lab(y + 6, 'frames', '10 ms'); lab(y + 46, 'conv1', 'k3 · s1'); lab(y + 86, 'conv2', 'k3 · s2'); }
      else { t(svg, 8, y, 'frames → conv1 → conv2 (stride 2)', 'viz-n'); y += 10; }
      const rowF = y, rowC1 = y + 40, rowC2 = y + 80, bh = 16;
      for (let i = 0; i < nF; i++) {
        const f = f0 + i;
        V.svg('rect', { x: r1(bx + i * bw + 1), y: rowF, width: r1(bw - 2), height: bh, rx: 2, class: 'viz-mel-fr' }, svg);
        t(svg, bx + i * bw + bw / 2, rowF + 12, String(f), 'viz-mel-fn', 'middle');
        V.svg('rect', { x: r1(bx + i * bw + 1), y: rowC1, width: r1(bw - 2), height: bh, rx: 2, class: 'viz-mel-c1' }, svg);
        V.svg('path', { d: 'M' + r1(bx + i * bw + bw / 2) + ' ' + r1(rowF + bh) + 'V' + r1(rowC1), class: 'viz-mel-k' }, svg);
        if (i > 0) V.svg('path', { d: 'M' + r1(bx + (i - 1) * bw + bw / 2) + ' ' + r1(rowF + bh) + 'L' + r1(bx + i * bw + bw / 2) + ' ' + r1(rowC1), class: 'viz-mel-k is-side' }, svg);
        if (i < nF - 1) V.svg('path', { d: 'M' + r1(bx + (i + 1) * bw + bw / 2) + ' ' + r1(rowF + bh) + 'L' + r1(bx + i * bw + bw / 2) + ' ' + r1(rowC1), class: 'viz-mel-k is-side' }, svg);
      }
      for (let j = 0; j < nF / 2; j++) {
        const c = 2 * j, p = (f0 + c) / 2;
        V.svg('rect', { x: r1(bx + c * bw + 1), y: rowC2, width: r1(2 * bw - 2), height: bh, rx: 2, class: 'viz-mel-c2' }, svg);
        t(svg, bx + c * bw + bw, rowC2 + 12, String(Math.floor(p)), 'viz-mel-fn', 'middle');
        [-1, 0, 1].forEach((dd) => { const xs = bx + (c + dd) * bw + bw / 2; if (c + dd >= 0 && c + dd < nF) V.svg('path', { d: 'M' + r1(xs) + ' ' + r1(rowC1 + bh) + 'L' + r1(bx + c * bw + bw) + ' ' + r1(rowC2), class: 'viz-mel-k' + (dd ? ' is-side' : '') }, svg); });
      }
      y = rowC2 + bh + (narrow ? 18 : 30);
      t(svg, 8, y, narrow ? fint(lm.nFrames) + ' frames → ' + fint(N.pos) + ' posiciones (20 ms c/u)' : 'Cada posición del encoder cubre 2 frames = 20 ms: ' + fint(lm.nFrames) + ' frames → ' + fint(N.pos) + ' posiciones' + (N.D ? ' de D = ' + fint(N.D) : '') + ', + posiciones sinusoidales', 'viz-n');
      y += 10;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      const fr = Math.round(state.cur * 100);
      svg.setAttribute('aria-label', 'Voz sintética de ' + state.sec + ' s rellenada a 30 s; log-Mel de ' + N.mels + ' bandas por ' + lm.nFrames + ' frames; el encoder la reduce a ' + N.pos + ' posiciones. Cursor en ' + state.cur.toFixed(1) + ' s: frame ' + fr + ', posición ' + Math.floor(fr / 2) + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('muestras:', fint(NS) + ' (30 s × 16 kHz)');
      kv('log-Mel:', N.mels + ' × ' + fint(lm.nFrames));
      kv('encoder:', fint(N.pos) + ' posiciones' + (N.src === 'paper' ? ' (paper)' : ''));
      kv('voz:', state.sec + ' s de 30 (' + Math.round(100 * state.sec / WIN_S) + ' %)');
      kv('cursor:', state.cur.toFixed(1) + ' s → frame ' + fr + ' → posición ' + Math.floor(fr / 2));
      note.innerHTML = 'Whisper SIEMPRE procesa una ventana de 30 s: con ' + state.sec + ' s de voz, el ' + Math.round(100 * (WIN_S - state.sec) / WIN_S) + ' % de los frames es relleno y el encoder cuesta lo mismo que con 30 s de voz (por eso transcribir audios cortos no es más barato en el encoder; audios largos se cortan en ventanas de 30 s). El espectrograma: 25 ms de ventana cada 10 ms, potencia en ' + N.mels + ' bandas mel (más finas en graves, como el oído), log10 y normalización. La conv1d con stride 2 reduce los frames a la mitad: el encoder ve ' + fint(N.pos) + ' posiciones, una cada 20 ms. La "voz" es sintética (sílabas armónicas con formantes y fricativas): el procesamiento sí es el de Whisper.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k !== 'ArrowRight' && k !== 'ArrowLeft') return;
      ev.preventDefault();
      const d = (ev.shiftKey ? 1 : 0.1) * (k === 'ArrowRight' ? 1 : -1);
      state.cur = Math.max(0, Math.min(WIN_S - 0.1, Math.round((state.cur + d) * 10) / 10));
      draw();
    });
    stage.addEventListener('click', (ev) => {
      const svg = stage.querySelector('svg');
      if (!svg) return;
      const rc = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      const narrow = vb.width < 640, x0 = narrow ? 8 : 88, gw = vb.width - x0 - 8;
      const xu = (ev.clientX - rc.left) * vb.width / rc.width;
      if (xu < x0 || xu > x0 + gw) return;
      state.cur = Math.max(0, Math.min(WIN_S - 0.1, Math.round((xu - x0) / gw * WIN_S * 10) / 10));
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('mel-spectrogram', render);
})(typeof window !== 'undefined' ? window : globalThis);
