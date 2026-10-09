/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/mlm-masking.js
   Visualización "mlm-masking" (SPEC §7.8, §23.4): el pre-entrenamiento de BERT con un par de oraciones.
   Devlin et al. 2019 (arXiv:1810.04805), §3.1 y apéndice A.1: se elige el 15 % de los tokens (nunca [CLS] ni [SEP]); de los
   elegidos, el 80 % pasa a [MASK], el 10 % a un token aleatorio y el 10 % queda igual; la pérdida MLM mira SOLO las posiciones
   elegidas (las demás llevan la etiqueta −100 en HF y no cuentan). El par es el ejemplo del paper (§A.1): "the man went to the
   store" + "he bought a gallon of milk" (IsNext) o "penguin ##s are flight ##less birds" (NotNext); [CLS] pasa por el pooler y la
   cabeza NSP predice IsNext / NotNext. Las proporciones y V salen del calculador (modelo `bert`) cuando están; si no, del paper.
   Interacción: nueva muestra (semilla), par IsNext / NotNext, y "a mano": flechas para recorrer los tokens y Enter para ciclar
   el destino de uno (no elegido → [MASK] → aleatorio → sin cambio). Abajo, la cuenta sobre 100,000 tokens muestreados con la
   misma regla (12 % [MASK], 1.5 % aleatorio, 1.5 % sin cambio del total): el muestreo es real, la frase es ilustrativa.
   params: { pair:'isnext'|'notnext', seed:3 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const A_TOK = ['the', 'man', 'went', 'to', 'the', 'store'];
  const PAIRS = {
    isnext: { label: 'IsNext', b: ['he', 'bought', 'a', 'gallon', 'of', 'milk'] },
    notnext: { label: 'NotNext', b: ['penguin', '##s', 'are', 'flight', '##less', 'birds'] },
  };
  // vocabulario chico para el reemplazo aleatorio (en BERT: cualquier id de los V = 30,522)
  const RANDOM = ['table', 'run', 'blue', 'seven', 'river', 'quickly', 'paper', 'song', 'cold', 'window', 'eat', 'green'];
  const STATES = ['none', 'mask', 'rand', 'keep'];
  const ST_TXT = { none: 'no elegido', mask: '[MASK]', rand: 'aleatorio', keep: 'sin cambio' };

  // proporciones: del calculador si las expone (quantities / metrics de la config canónica), si no, las del paper
  function rates() {
    const def = { p: 0.15, mask: 0.8, rand: 0.1, keep: 0.1, V: 30522, src: 'paper' };
    const A = ATLAS.Arch;
    if (!A || typeof A.run !== 'function') return def;
    let run = null, met = null;
    try { run = A.run('bert-base'); } catch (e) { return def; }
    try { met = A.metrics ? A.metrics('bert-base') : null; } catch (e) { met = null; }
    const pick = (ks) => { for (const k of ks) { for (const src of [met, run.quantities, run.config]) { const v = src && src[k]; if (Number.isFinite(+v) && v !== null && v !== '') return +v; } } return undefined; };
    const norm = (v) => (v > 1 ? v / 100 : v);
    const p = pick(['mlmProb', 'mlmMaskProb', 'maskProb', 'mlmSelect', 'mlmRate']);
    const m = pick(['mlmMaskShare', 'mlmMask', 'maskReplace', 'mlmReplaceMask']);
    const rr = pick(['mlmRandomShare', 'mlmRandom', 'maskRandom', 'mlmReplaceRandom']);
    const k = pick(['mlmKeepShare', 'mlmKeep', 'maskKeep', 'mlmReplaceKeep']);
    const V = pick(['V', 'vocab', 'vocabSize']);
    const out = Object.assign({}, def);
    if (p > 0) { out.p = norm(p); out.src = 'calculador'; }
    if (m > 0 && rr >= 0 && k >= 0) { out.mask = norm(m); out.rand = norm(rr); out.keep = norm(k); }
    if (V > 0) out.V = V;
    return out;
  }

  function sample(n, special, rng, R) {
    return Array.from({ length: n }, (_, i) => {
      if (special[i]) return { st: 'none' };
      if (rng() >= R.p) return { st: 'none' };
      const u = rng();
      return u < R.mask ? { st: 'mask' } : u < R.mask + R.rand ? { st: 'rand', w: RANDOM[Math.floor(rng() * RANDOM.length)] } : { st: 'keep' };
    });
  }

  function render(el, params) {
    const V = ATLAS.Viz;
    const R = rates();
    const pct = (v) => (Math.round(v * 1000) / 10).toString().replace(/\.0$/, '') + ' %';
    const fint = (ATLAS.Arch && ATLAS.Arch.fmt && ATLAS.Arch.fmt.int) || ((n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const state = { pair: PAIRS[params.pair] ? params.pair : 'isnext', seed: Number.isFinite(+params.seed) ? +params.seed : 3, cur: 1, picks: null, hand: false };

    const wrap = V.html('div', { class: 'viz viz-mlm' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const gP = grp('Segunda oración');
    const pBtns = Object.keys(PAIRS).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: PAIRS[k].label }, gP); b.addEventListener('click', () => { state.pair = k; resample(); }); b._k = k; return b; });
    const gS = grp('Máscara');
    const bNew = V.html('button', { type: 'button', class: 'viz-chip', text: 'Nueva muestra' }, gS);
    bNew.addEventListener('click', () => { state.seed++; resample(); });
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-mlm-stage', tabindex: 0, role: 'group', 'aria-label': 'Enmascarado de BERT. Flechas izquierda y derecha: elegir un token; Enter: cambiar su destino (no elegido, [MASK], aleatorio, sin cambio); N: nueva muestra; P: cambiar la segunda oración' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    const tokens = () => ['[CLS]'].concat(A_TOK, ['[SEP]'], PAIRS[state.pair].b, ['[SEP]']);
    const segOf = (i) => (i <= A_TOK.length + 1 ? 0 : 1);
    function resample() {
      const toks = tokens();
      const special = toks.map((t) => t === '[CLS]' || t === '[SEP]');
      state.picks = sample(toks.length, special, V.rng(1000 + state.seed * 7919), R);
      state.hand = false;
      draw();
    }
    // conteo sobre 100,000 tokens (muestreo real con la misma regla): converge a p·(80/10/10)
    const stats = (() => {
      const rng = V.rng(424242), n = 100000;
      const c = { sel: 0, mask: 0, rand: 0, keep: 0 };
      for (let i = 0; i < n; i++) { if (rng() >= R.p) continue; c.sel++; const u = rng(); if (u < R.mask) c.mask++; else if (u < R.mask + R.rand) c.rand++; else c.keep++; }
      return { n, c };
    })();

    let lastNarrow = null;
    function draw() {
      pBtns.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.pair)));
      const toks = tokens(), picks = state.picks;
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, narrow ? 'MLM + NSP: un par de oraciones' : 'Pre-entrenamiento de BERT: Masked LM (15 % de los tokens) + Next Sentence Prediction', 'viz-t');
      t(svg, 8, 29, narrow ? 'frase del paper · muestreo real (ilustrativo)' : 'el par es el ejemplo del paper (§A.1); qué tokens se eligen sale de un muestreo real con la regla 15 % · 80/10/10', 'viz-s');

      // ---- tarjetas por token (envuelven en el teléfono): texto / entrada al modelo / objetivo de la pérdida
      const lx = narrow ? 8 : 112, gap = 4, cardH = 64;
      if (!narrow) ['texto', 'entrada', 'objetivo', 'segmento'].forEach((s, i) => t(svg, 8, 58 + i * 17 - (i === 3 ? 2 : 0), s, 'viz-s'));
      else {
        // leyenda de las tres líneas (a 375 px no caben los rótulos a la izquierda)
        t(svg, 8, 46, 'cada tarjeta, de arriba abajo: texto,', 'viz-s');
        t(svg, 8, 59, 'entrada, objetivo y segmento (A o B)', 'viz-s');
      }
      let x = lx, y = narrow ? 70 : 42;
      const cards = [];
      toks.forEach((tk, i) => {
        const pk = picks[i] || { st: 'none' };
        const inTok = pk.st === 'mask' ? '[MASK]' : pk.st === 'rand' ? pk.w : tk;
        const w = Math.max(tk.length, inTok.length, 3) * 7 + 12;
        if (x + w > W - 6) { x = lx; y += cardH + 10; }
        cards.push({ i, x, y, w, tk, inTok, pk });
        x += w + gap;
      });
      const yEnd = cards.reduce((a, c) => Math.max(a, c.y + cardH), 0);
      cards.forEach((c) => {
        const special = c.tk === '[CLS]' || c.tk === '[SEP]';
        const g = V.svg('g', { class: 'viz-mlm-card' + (c.i === state.cur && document.activeElement === stage ? ' is-cur' : '') + (c.pk.st !== 'none' ? ' is-sel' : '') }, svg);
        V.svg('rect', { x: r1(c.x), y: r1(c.y), width: r1(c.w), height: cardH, rx: 4, class: 'viz-mlm-bg is-seg' + segOf(c.i) }, g);
        t(g, c.x + c.w / 2, c.y + 14, c.tk, 'viz-mlm-tok' + (special ? ' is-special' : ''), 'middle');
        const cls = c.pk.st === 'mask' ? 'is-mask' : c.pk.st === 'rand' ? 'is-rand' : c.pk.st === 'keep' ? 'is-keep' : 'is-none';
        V.svg('rect', { x: r1(c.x + 3), y: r1(c.y + 20), width: r1(c.w - 6), height: 16, rx: 3, class: 'viz-mlm-in ' + cls }, g);
        t(g, c.x + c.w / 2, c.y + 32, c.inTok, 'viz-mlm-intxt ' + cls, 'middle');
        t(g, c.x + c.w / 2, c.y + 50, c.pk.st === 'none' ? '·' : c.tk, 'viz-mlm-tgt' + (c.pk.st === 'none' ? ' is-none' : ''), 'middle');
        t(g, c.x + c.w / 2, c.y + 61, segOf(c.i) ? 'B' : 'A', 'viz-mlm-segt', 'middle');
        if (c.i === state.cur && state.hand) V.svg('rect', { x: r1(c.x - 1.5), y: r1(c.y - 1.5), width: r1(c.w + 3), height: cardH + 3, rx: 5, class: 'viz-mlm-cursor' }, g);
      });
      // ---- NSP: [CLS] → pooler → IsNext / NotNext
      let yy = yEnd + 22;
      const nsp = PAIRS[state.pair].label;
      if (narrow) { t(svg, 8, yy, 'NSP: [CLS] → pooler (tanh) → Linear D → 2', 'viz-n'); yy += 14; t(svg, 8, yy, 'etiqueta del par: ' + nsp, 'viz-n'); }
      else t(svg, 8, yy, 'NSP: [CLS] → pooler (tanh) → Linear D → 2 · etiqueta del par: ' + nsp, 'viz-n');
      yy += 14;
      t(svg, 8, yy, state.pair === 'isnext' ? 'B sigue a A en el corpus (50 % de los pares)' : (narrow ? 'B: oración al azar (el otro 50 %)' : 'B es una oración al azar de otro documento (el otro 50 %)'), 'viz-s');
      // ---- leyenda de los destinos
      yy += 22;
      let lgx = 8;
      [['is-mask', '[MASK] (80 %)'], ['is-rand', 'token aleatorio (10 %)'], ['is-keep', 'sin cambio (10 %)'], ['is-none', 'no elegido: no entra en la pérdida']].forEach(([cls, lab]) => {
        const iw = 22 + lab.length * 6.2 + 14;
        if (lgx > 8 && lgx + iw > W - 6) { lgx = 8; yy += 18; }
        V.svg('rect', { x: r1(lgx), y: r1(yy - 10), width: 16, height: 12, rx: 2, class: 'viz-mlm-in ' + cls }, svg);
        t(svg, lgx + 21, yy, lab, 'viz-s');
        lgx += iw;
      });
      // ---- conteo sobre 100,000 tokens
      yy += 26;
      const c = stats.c, n = stats.n;
      t(svg, 8, yy, narrow ? 'en ' + fint(n) + ' tokens (muestreo real):' : 'La misma regla sobre ' + fint(n) + ' tokens (muestreo real): elegidos ' + pct(c.sel / n) + ' · [MASK] ' + pct(c.mask / n) + ' · aleatorio ' + pct(c.rand / n) + ' · sin cambio ' + pct(c.keep / n), narrow ? 'viz-n' : 'viz-n');
      if (narrow) { yy += 15; t(svg, 8, yy, 'elegidos ' + pct(c.sel / n) + ' · [MASK] ' + pct(c.mask / n), 'viz-s'); yy += 14; t(svg, 8, yy, 'aleatorio ' + pct(c.rand / n) + ' · sin cambio ' + pct(c.keep / n), 'viz-s'); }
      yy += 16;
      t(svg, 8, yy, 'esperado: ' + pct(R.p) + ' · ' + pct(R.p * R.mask) + ' · ' + pct(R.p * R.rand) + ' · ' + pct(R.p * R.keep) + ' del total', 'viz-s');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(yy + 10));

      const sel = picks.map((p, i) => ({ p, i })).filter((o) => o.p.st !== 'none');
      const desc = sel.length ? sel.map((o) => toks[o.i] + ' → ' + (o.p.st === 'mask' ? '[MASK]' : o.p.st === 'rand' ? o.p.w + ' (aleatorio)' : toks[o.i] + ' (sin cambio)')).join('; ') : 'ningún token elegido en esta muestra';
      svg.setAttribute('aria-label', 'Par ' + nsp + ' de ' + toks.length + ' tokens. Elegidos para la pérdida MLM: ' + desc + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const nTok = toks.filter((tk) => tk !== '[CLS]' && tk !== '[SEP]').length;
      kv('tokens elegibles:', nTok + ' de ' + toks.length);
      kv('elegidos aquí:', String(sel.length) + (state.hand ? ' (a mano)' : ''));
      kv('esperado por frase:', '≈ ' + (Math.round(nTok * R.p * 10) / 10));
      kv('salida MLM:', 'logits de ' + fint(R.V) + ' por posición elegida');
      kv('NSP:', nsp);
      if (state.hand && state.cur >= 0) kv('token ' + (state.cur + 1) + ':', toks[state.cur] + ' → ' + ST_TXT[(picks[state.cur] || { st: 'none' }).st]);
      note.innerHTML = 'La pérdida MLM solo mira los tokens elegidos: el modelo ve todo el contexto (izquierda y derecha, sin máscara causal) y predice el original en esas posiciones con una softmax sobre el vocabulario, usando la matriz de embeddings de palabras como decoder (pesos atados). El 10 % aleatorio y el 10 % sin cambio existen porque [MASK] nunca aparece en el fine-tuning: así el modelo no puede confiar en que solo los [MASK] importan. Como solo aprende del ≈ 15 % de las posiciones, el MLM necesita más pasos que un modelo autorregresivo, que aprende de todas. RoBERTa (2019) quita NSP y vuelve a enmascarar en cada época (máscara dinámica) y le va mejor.' + (R.src === 'paper' ? ' Proporciones del paper (§3.1).' : '');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key, n = tokens().length;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.hand = true; state.cur = (state.cur + (k === 'ArrowRight' ? 1 : n - 1)) % n; draw(); }
      else if (k === 'Enter' || k === ' ') {
        ev.preventDefault();
        const tk = tokens()[state.cur];
        state.hand = true;
        if (tk === '[CLS]' || tk === '[SEP]') { draw(); return; }
        const p = state.picks[state.cur] || { st: 'none' };
        const nx = STATES[(STATES.indexOf(p.st) + 1) % STATES.length];
        state.picks[state.cur] = nx === 'rand' ? { st: 'rand', w: RANDOM[state.cur % RANDOM.length] } : { st: nx };
        draw();
      } else if (k === 'n' || k === 'N') { ev.preventDefault(); state.seed++; resample(); }
      else if (k === 'p' || k === 'P') { ev.preventDefault(); state.pair = state.pair === 'isnext' ? 'notnext' : 'isnext'; resample(); }
    });
    stage.addEventListener('focus', () => draw());
    stage.addEventListener('blur', () => draw());
    resample();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('mlm-masking', render);
})(typeof window !== 'undefined' ? window : globalThis);
