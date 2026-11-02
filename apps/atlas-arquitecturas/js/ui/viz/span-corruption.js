/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/span-corruption.js
   Visualización "span-corruption" (SPEC §7.8, §24.4): el objetivo de pre-entrenamiento de T5.
   Raffel et al., JMLR 2020 (arXiv:1910.10683), §3.1.4 y Figura 2: se corrompe el 15 % de los tokens en tramos (spans) de largo
   medio 3; cada tramo se reemplaza en la ENTRADA por un token centinela único (<X>, <Y>, …; en el vocabulario, <extra_id_0>,
   <extra_id_1>, …) y el OBJETIVO del decoder es la lista de tramos, cada uno precedido por su centinela.
   El objetivo lleva un centinela final SOLO si el texto termina en un tramo sin corromper (la Figura 2: "… week ." → <Z>); las
   máscaras al azar de T5 siempre terminan en un tramo corrompido, así que su objetivo no lo lleva.
   El muestreo de tramos es el del código de T5 (random_spans_noise_mask, el mismo de HF run_t5_mlm_flax.py): n_ruido =
   round(n·densidad), n_tramos = round(n_ruido / largo medio), y los tokens con y sin ruido se parten en tramos al azar y se
   intercalan empezando por uno SIN ruido. Los largos (random_spans_helper / compute_input_and_target_lengths): con 512 tokens
   de entrada, el texto original mide 568 y el objetivo 114 (densidad 0.15, largo medio 3): esos tres números los lee del
   calculador (metrics de t5-base); con otra densidad o largo medio, llama a la MISMA función del calculador
   (ATLAS.Arch.encdec.spanCorruption: redondeo de Python, búsqueda desde inputs_length − 1 y la corrección de densidad 0.5).
   Lo ilustrativo: el texto (palabras como tokens; T5 usa SentencePiece) y la semilla. El ejemplo del paper es la Figura 2, que
   muestra el objetivo baseline (ruido i.i.d., §3.1.4); el T5 final usa el mismo formato con tramos de largo medio 3 (§3.3.4).
   params: { mode:'paper'|'random', density:0.15, span:3, seed:1 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  // Figura 2 del paper: "Thank you for inviting me to your party last week." con "for inviting" y "last" corrompidos
  const PAPER = { words: ['Thank', 'you', 'for', 'inviting', 'me', 'to', 'your', 'party', 'last', 'week', '.'], noise: [2, 3, 8] };
  // texto de ejemplo para el muestreo (estilo C4; palabras como tokens, ilustrativo)
  const TEXT = ('The museum opened a new wing last spring , and since then the number of visitors has almost doubled . ' +
    'Most of them come for the old maps , which were stored in a basement for decades before a volunteer found them .').split(' ');
  const DENS = [0.15, 0.3, 0.5];
  const SPANS = [1, 3, 8];
  const LETTERS = ['X', 'Y', 'Z'];

  // random_spans_noise_mask del código de T5 (misma lógica, con un generador con semilla)
  function noiseMask(n, density, meanSpan, rng) {
    let nNoise = Math.round(n * density);
    nNoise = Math.min(Math.max(nNoise, 1), n - 1);
    const nSpans = Math.max(Math.round(nNoise / meanSpan), 1);
    const nKeep = n - nNoise;
    // _random_segmentation: num_items en num_segments tramos no vacíos al azar
    const seg = (items, k) => {
      const ind = Array.from({ length: items - 1 }, (_, i) => i < k - 1);
      for (let i = ind.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = ind[i]; ind[i] = ind[j]; ind[j] = t; }
      const lens = [];
      let cur = 1;
      for (const b of ind) { if (b) { lens.push(cur); cur = 1; } else cur++; }
      lens.push(cur);
      return lens;
    };
    const noiseL = seg(nNoise, nSpans), keepL = seg(nKeep, nSpans);
    const mask = [];
    for (let s = 0; s < nSpans; s++) {
      for (let i = 0; i < keepL[s]; i++) mask.push(false);
      for (let i = 0; i < noiseL[s]; i++) mask.push(true);
    }
    return mask.slice(0, n);
  }
  // largos del pre-entrenamiento: del calculador (metrics de t5-base: spanRawTokens / spanInputTokens / spanTargetTokens, con 15 % y
  // largo medio 3). Con otra densidad o largo, la función del calculador (random_spans_helper de T5) sobre la misma entrada.
  // revisión fase 12: antes había aquí una copia (Math.round, búsqueda desde inputs_length y sin la corrección de 0.5) que daba
  // 5 de las 9 combinaciones mal (p. ej. 15 % / 1: entrada 513 > 512)
  function pretrain(density, meanSpan) {
    const A = ATLAS.Arch;
    let m = null;
    try { m = A && A.metrics ? A.metrics('t5-base') : null; } catch (e) { m = null; }
    const ok = (k) => m && Number.isFinite(+m[k]) && +m[k] > 0;
    if (ok('spanInputTokens') && ok('spanRawTokens') && ok('spanTargetTokens') && Math.abs(density - (+m.noiseDensity || 0.15)) < 1e-9 && meanSpan === (+m.meanNoiseSpan || 3)) {
      return { raw: +m.spanRawTokens, input: +m.spanInputTokens, target: +m.spanTargetTokens, src: 'calculador' };
    }
    let r = null;
    try { r = A && A.encdec && A.encdec.spanCorruption ? A.encdec.spanCorruption(ok('spanInputTokens') ? +m.spanInputTokens : 512, density, meanSpan) : null; } catch (e) { r = null; }
    if (r && Number.isFinite(r.tokens) && Number.isFinite(r.inputs) && Number.isFinite(r.targets)) return { raw: r.tokens, input: r.inputs, target: r.targets, src: 'cálculo de T5' };
    return null;
  }

  function render(el, params) {
    const V = ATLAS.Viz;
    const fint = (ATLAS.Arch && ATLAS.Arch.fmt && ATLAS.Arch.fmt.int) || ((n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const state = {
      mode: params.mode === 'random' ? 'random' : 'paper',
      density: DENS.indexOf(+params.density) >= 0 ? +params.density : 0.15,
      span: SPANS.indexOf(+params.span) >= 0 ? +params.span : 3,
      seed: Number.isFinite(+params.seed) ? +params.seed : 1,
    };

    const wrap = V.html('div', { class: 'viz viz-span' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const all = [];
    const chips = (g, vals, key, label) => vals.map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label(v) }, g); b.addEventListener('click', () => { state[key] = v; if (key !== 'mode') state.mode = 'random'; draw(); }); b._v = v; b._k = key; all.push(b); return b; });
    chips(grp('Texto'), ['paper', 'random'], 'mode', (v) => (v === 'paper' ? 'Figura 2 del paper' : 'Muestra al azar'));
    const gD = grp('Ruido');
    chips(gD, DENS, 'density', (v) => Math.round(v * 100) + ' %');
    const gS = grp('Largo medio');
    chips(gS, SPANS, 'span', (v) => String(v));
    const gN = grp('Semilla');
    const bNew = V.html('button', { type: 'button', class: 'viz-chip', text: 'Nueva muestra' }, gN);
    bNew.addEventListener('click', () => { state.mode = 'random'; state.seed++; draw(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-span-stage', tabindex: 0, role: 'group', 'aria-label': 'Span corruption de T5. N: nueva muestra; P: volver al ejemplo del paper' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    function example() {
      if (state.mode === 'paper') {
        const noise = PAPER.words.map((w, i) => PAPER.noise.indexOf(i) >= 0);
        return { words: PAPER.words, noise, paper: true };
      }
      const rng = V.rng(7000 + state.seed * 7919 + Math.round(state.density * 100) * 31 + state.span);
      return { words: TEXT, noise: noiseMask(TEXT.length, state.density, state.span, rng), paper: false };
    }
    // tramos: [{noise, from, to}] y las dos secuencias (entrada del encoder y objetivo del decoder)
    function build(ex) {
      const spans = [];
      ex.words.forEach((w, i) => {
        const last = spans[spans.length - 1];
        if (last && last.noise === ex.noise[i]) last.to = i;
        else spans.push({ noise: ex.noise[i], from: i, to: i });
      });
      let k = 0;
      const sent = (j) => (ex.paper ? '<' + LETTERS[j] + '>' : '‹' + j + '›');
      const input = [], target = [];
      spans.forEach((s) => {
        if (!s.noise) { for (let i = s.from; i <= s.to; i++) input.push({ t: ex.words[i] }); return; }
        s.k = k;
        input.push({ t: sent(k), sent: true, k });
        target.push({ t: sent(k), sent: true, k });
        for (let i = s.from; i <= s.to; i++) target.push({ t: ex.words[i], k });
        k++;
      });
      // centinela final solo si el texto termina en un tramo SIN corromper (Figura 2: "… week ." → <Z>). Las máscaras al azar
      // de T5 siempre terminan en un tramo corrompido: su objetivo no lleva centinela final (de ahí n_ruido + n_tramos + 1 = </s>)
      const lastNoise = spans.length && spans[spans.length - 1].noise;
      if (!lastNoise) target.push({ t: sent(k), sent: true, k, final: true });
      return { spans, input, target, nSpans: k, finalSentinel: !lastNoise };
    }

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v && (b._k === 'mode' || state.mode === 'random'))));
      const ex = example(), B = build(ex);
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 15, narrow ? 'Span corruption (T5)' : 'Span corruption: el objetivo de pre-entrenamiento de T5 (§3.1.4 y §3.3.4)', 'viz-t');
      t(svg, 8, 29, ex.paper ? (narrow ? 'Figura 2: baseline i.i.d., mismo formato' : 'Figura 2 del paper: el objetivo baseline (ruido i.i.d.), con el mismo formato que el span corruption final') : (narrow ? 'muestreo real, texto ilustrativo' : 'tramos muestreados con el algoritmo de T5 (random_spans_noise_mask); texto ilustrativo'), 'viz-s');
      const lx = 8, gap = 4, chipH = 20, lineH = 28;
      let y = 46;
      // una fila de chips que envuelve; devuelve la y siguiente
      const row = (title, items, cls) => {
        t(svg, lx, y + 4, title, 'viz-n');
        y += 12;
        let x = lx;
        items.forEach((it) => {
          const w = Math.max(it.t.length * 7 + 10, 18);
          if (x + w > W - 6) { x = lx; y += lineH; }
          const k = it.k != null ? it.k % 6 : 0;
          const c = it.sent ? 'is-sent is-k' + k : it.noise ? 'is-noise is-k' + k : it.k != null ? 'is-tgt is-k' + k : '';
          V.svg('rect', { x: r1(x), y: r1(y), width: r1(w), height: chipH, rx: 3, class: 'viz-span-chip ' + cls + ' ' + c }, svg);
          t(svg, x + w / 2, y + 14, it.t, 'viz-span-txt' + (it.sent ? ' is-sent' : '') + (it.noise ? ' is-noise' : ''), 'middle');
          x += w + gap;
        });
        y += lineH + 10;
      };
      // texto original: los tramos corrompidos tachados, con el color de su centinela
      const orig = ex.words.map((w, i) => {
        const s = B.spans.find((sp) => i >= sp.from && i <= sp.to);
        return { t: w, noise: ex.noise[i], k: s && s.noise ? s.k : null };
      });
      row('Texto original (' + ex.words.length + ' tokens)', orig, 'is-orig');
      row('Entrada del encoder (' + B.input.length + ' + </s>)', B.input, 'is-in');
      row('Objetivo del decoder (' + B.target.length + ' + </s>)', B.target, 'is-out');
      // leyenda
      let lgx = lx;
      [['is-noise is-k0', 'tramo corrompido'], ['is-sent is-k0', ex.paper ? 'centinela <X>, <Y>, <Z>' : 'centinela ‹k› = <extra_id_k>']].forEach(([c, lab]) => {
        const iw = 22 + lab.length * 6.3 + 16;
        if (lgx > lx && lgx + iw > W - 6) { lgx = lx; y += 18; }
        V.svg('rect', { x: r1(lgx), y: r1(y - 10), width: 16, height: 12, rx: 2, class: 'viz-span-chip ' + c }, svg);
        t(svg, lgx + 21, y, lab, 'viz-s');
        lgx += iw;
      });
      y += 24;
      // largos del pre-entrenamiento real (el mismo cálculo del código de T5)
      const Ls = pretrain(state.mode === 'paper' ? 0.15 : state.density, state.mode === 'paper' ? 3 : state.span);
      const dTxt = state.mode === 'paper' ? 'el de T5: 15 %, largo medio 3' : Math.round(state.density * 100) + ' %, largo medio ' + state.span;
      if (!Ls) t(svg, lx, y, 'Pre-entrenamiento (' + dTxt + '): el calculador no está cargado', 'viz-s');
      else if (narrow) {
        t(svg, lx, y, 'Pre-entrenamiento (' + dTxt.replace(/^el de T5: /, '') + '):', 'viz-n'); y += 15;
        t(svg, lx, y, 'texto ' + fint(Ls.raw) + ' → entrada ' + fint(Ls.input) + ' → objetivo ' + fint(Ls.target), 'viz-s');
      } else t(svg, lx, y, 'En el pre-entrenamiento (' + dTxt + '): un texto de ' + fint(Ls.raw) + ' tokens → entrada de ' + fint(Ls.input) + ' → objetivo de ' + fint(Ls.target) + ' (con </s>)', 'viz-n');
      y += 10;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      const spansTxt = B.spans.filter((s) => s.noise).map((s) => ex.words.slice(s.from, s.to + 1).join(' ')).join(' | ');
      svg.setAttribute('aria-label', 'Entrada: ' + B.input.map((x) => x.t).join(' ') + '. Objetivo: ' + B.target.map((x) => x.t).join(' ') + '. Tramos corrompidos: ' + spansTxt + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const nNoise = ex.noise.filter(Boolean).length;
      kv('corrompidos:', nNoise + ' de ' + ex.words.length + ' (' + Math.round(100 * nNoise / ex.words.length) + ' %)');
      kv('tramos:', String(B.nSpans));
      kv('entrada:', B.input.length + ' + &lt;/s&gt;');
      kv('objetivo:', B.target.length + ' + &lt;/s&gt;');
      if (Ls) kv('pre-entrenamiento:', fint(Ls.raw) + ' → ' + fint(Ls.input) + ' → ' + fint(Ls.target) + ' (' + Ls.src + ')');
      note.innerHTML = 'El encoder ve el texto con huecos (cada tramo, un solo centinela) y el decoder genera SOLO lo que falta, cada tramo tras su centinela: el objetivo es mucho más corto que la entrada' + (Ls ? ' (≈ ' + Math.round(100 * Ls.target / Ls.input) + ' % aquí)' : '') + ', así que el pre-entrenamiento es barato en el decoder. Frente al MLM de BERT: no se predice cada [MASK] por separado, sino tramos enteros de forma autorregresiva, y no hay posiciones "sin pérdida" en el objetivo. Los centinelas son ids reservados del vocabulario (&lt;extra_id_0&gt; … &lt;extra_id_99&gt;: los ids 32,099 … 32,000 en HF). El ejemplo del paper (Figura 2) es el objetivo baseline, con ruido i.i.d. (los tokens corrompidos seguidos forman un tramo); el T5 final elige los tramos con largo medio 3 (§3.3.4), con el mismo formato. El paper compara tasas de corrupción (Tabla 6: importa poco entre 10 y 25 %) y largos medios de tramo (Tabla 7) y se queda con 15 % y 3: rinde igual o un poco mejor que corromper tokens sueltos y acorta el objetivo.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'n' || k === 'N') { ev.preventDefault(); state.mode = 'random'; state.seed++; draw(); }
      else if (k === 'p' || k === 'P') { ev.preventDefault(); state.mode = 'paper'; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('span-corruption', render);
})(typeof window !== 'undefined' ? window : globalThis);
