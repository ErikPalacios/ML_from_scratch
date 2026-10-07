/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/open-vocab-head.js
   Visualización "open-vocab-head" (SPEC §7.8, §16.3): de la cabeza de clases fija a la de texto.
   Izquierda, una escena con 4 regiones (cada una = el embedding de un objeto, como el que sale del
   decoder de Grounding DINO o de la rama de clase de YOLO-World). Arriba, la cabeza CERRADA de un detector
   clásico (YOLOv8): una capa con K filas aprendidas, una por clase del dataset; para una clase nueva no hay
   fila (hay que agregarla y re-entrenar). Abajo, la cabeza ABIERTA: las filas son los embeddings de texto
   de las palabras que escribes (normalizados), logit = α·cos(región, texto) + β; una palabra nueva es una
   columna nueva, sin entrenar nada.
   Embeddings SINTÉTICOS (con semilla; "ilustrativo"): cada concepto tiene una dirección; los sinónimos
   ("kitten", "gato") caen cerca; "animal" o "pet" entre gato y perro; una palabra desconocida, en una
   dirección al azar (coseno ≈ 0 con todo). α y β: valores ilustrativos. K, el ancho de los embeddings y
   los parámetros de cada cabeza salen del calculador (yolov8l-640 y yolo-world-l-640).
   params: { config:'yolo-world-l-640', anchor:'yolov8l-640', words:['person','car','dog','cat'] }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const OBJECTS = [
    { icon: 'person', label: 'persona', concept: 'person', box: [0.16, 0.58, 0.16, 0.56] },
    { icon: 'dog', label: 'perro', concept: 'dog', box: [0.43, 0.74, 0.26, 0.32] },
    { icon: 'cat', label: 'gato', concept: 'cat', box: [0.71, 0.78, 0.17, 0.26] },
    { icon: 'car', label: 'auto', concept: 'car', box: [0.84, 0.36, 0.24, 0.18] },
  ];
  // Clases de la cabeza fija que se muestran (las primeras de COCO en el orden de YOLOv8 que aparecen aquí)
  const FIXED = ['person', 'car', 'dog', 'cat'];
  // Palabra → concepto (con un peso: 1 = sinónimo cercano; < 1, pariente). Sin tildes ni mayúsculas.
  const LEX = {
    person: [['person', 1]], persona: [['person', 1]], man: [['person', 0.9]], woman: [['person', 0.9]], hombre: [['person', 0.9]], mujer: [['person', 0.9]], people: [['person', 0.9]], gente: [['person', 0.85]],
    cat: [['cat', 1]], gato: [['cat', 1]], kitten: [['cat', 0.92]], kitty: [['cat', 0.9]], gatito: [['cat', 0.9]],
    dog: [['dog', 1]], perro: [['dog', 1]], puppy: [['dog', 0.92]], cachorro: [['dog', 0.9]],
    car: [['car', 1]], auto: [['car', 1]], coche: [['car', 1]], carro: [['car', 0.95]], vehicle: [['car', 0.8]], vehiculo: [['car', 0.8]], truck: [['car', 0.7]], camion: [['car', 0.7]],
    animal: [['cat', 0.6], ['dog', 0.6]], pet: [['cat', 0.65], ['dog', 0.65]], mascota: [['cat', 0.65], ['dog', 0.65]],
    tree: [['tree', 1]], arbol: [['tree', 1]], house: [['house', 1]], casa: [['house', 1]],
    zebra: [['dog', 0.2], ['cat', 0.15]], cebra: [['dog', 0.2], ['cat', 0.15]],
  };
  const CONCEPTS = ['person', 'cat', 'dog', 'car', 'tree', 'house'];
  const SUGGEST = ['kitten', 'puppy', 'pet', 'truck', 'zebra', 'perro'];
  const ED = 12;                                      // dimensión de la demo (la real sale del calculador)
  const ALPHA = 10, BETA = -6;                        // escala y desplazamiento (ilustrativos)
  const MAXW = 7;

  const norm = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const fold = (w) => String(w || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  function opsSum(run, test) { return run ? run.ops.filter(test).reduce((a, o) => a + (o.params || 0) * (o.repeat || 1), 0) : 0; }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n) };
    const cfgId = params.config || 'yolo-world-l-640', anchorId = params.anchor || 'yolov8l-640';
    let run = null, base = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { base = A.run(anchorId); } catch (e) { base = null; }

    // ---- embeddings sintéticos: base ortonormal con semilla; un concepto = una dirección
    const R = V.rng(31);
    const Eb = [];
    for (let k = 0; k < ED; k++) { let v = Array.from({ length: ED }, () => R.normal()); for (const e of Eb) { const d = dot(v, e); v = v.map((x, i) => x - d * e[i]); } Eb.push(norm(v)); }
    const dir = {}; CONCEPTS.forEach((c, k) => { dir[c] = Eb[k]; });
    const common = Eb[CONCEPTS.length];                  // componente común a todo (un poco de coseno de base)
    const noise = (rng, amp) => Array.from({ length: ED }, () => rng.normal() * amp / Math.sqrt(ED));
    // región = su concepto + común + ruido
    const REG = OBJECTS.map((o, i) => { const r = V.rng(100 + i); const nz = noise(r, 0.35); return norm(dir[o.concept].map((x, j) => x + 0.35 * common[j] + nz[j])); });
    function textEmb(word) {
      const w = fold(word), r = V.rng(hash(w));
      const lex = LEX[w];
      let v;
      // lo que la palabra no comparte con los conceptos de la escena va a una dirección propia (al azar):
      // así "zebra" (pariente lejano de perro y gato) no queda dominada por la componente común
      const own = norm(Array.from({ length: ED }, () => r.normal()));
      if (lex) { const m = Math.hypot(...Array.from({ length: ED }, (_, j) => lex.reduce((s, [c, a]) => s + a * dir[c][j], 0))); v = Array.from({ length: ED }, (_, j) => lex.reduce((s, [c, a]) => s + a * dir[c][j], 0) + Math.max(0, 1 - m) * 1.3 * own[j]); }
      else v = own;                                                                     // desconocida: dirección al azar
      const nz = noise(r, lex ? 0.3 : 0.2);
      return norm(v.map((x, j) => x + 0.35 * common[j] + nz[j]));
    }
    // cabeza fija: K filas aprendidas (aquí: la dirección de la clase con ruido) + sesgo
    const WFIX = FIXED.map((c, i) => { const r = V.rng(200 + i); const nz = noise(r, 0.25); return norm(dir[c].map((x, j) => x + 0.3 * common[j] + nz[j])); });

    const K = (base && base.config && (base.config.nc || base.config.K || base.config.classes)) || 80;
    const state = { words: (Array.isArray(params.words) && params.words.length ? params.words : FIXED.slice()).slice(0, MAXW), added: null, msg: '' };

    const wrap = V.html('div', { class: 'viz viz-ov' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const form = V.html('form', { class: 'viz-ctl viz-ov-form', 'aria-label': 'Agregar una clase escribiendo una palabra' }, ctl);
    V.html('label', { class: 'viz-ctl-l', for: 'ov-in-' + (++uid), text: 'Nueva clase' }, form);
    const inp = V.html('input', { id: 'ov-in-' + uid, class: 'viz-ov-in', type: 'text', maxlength: '24', autocomplete: 'off', spellcheck: 'false', placeholder: 'p. ej. kitten' }, form);
    V.html('button', { type: 'submit', class: 'viz-chip', text: 'Agregar' }, form);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); add(inp.value); inp.value = ''; });
    const gs = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Sugerencias' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Prueba' }, gs);
    SUGGEST.forEach((w) => { const b = V.html('button', { type: 'button', class: 'viz-chip', text: w }, gs); b.addEventListener('click', () => add(w)); });
    const bReset = V.html('button', { type: 'button', class: 'viz-chip', text: 'reiniciar' }, gs);
    bReset.addEventListener('click', () => { state.words = FIXED.slice(); state.added = null; state.msg = ''; draw(); });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const realBox = V.html('div', { class: 'viz-real viz-readout' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'Embeddings sintéticos con semilla (no de un modelo entrenado). Cabeza fija: logit = W·e + b, con una fila aprendida por clase del dataset: «kitten» o «zebra» no tienen fila. Cabeza de texto (YOLO-World): logit = α·cos(e, t) + β con e y t normalizados (Grounding DINO usa el producto punto de la query con cada token del texto); la clase nueva solo necesita su embedding de texto. Puntaje = sigmoide del logit; α = ' + ALPHA + ' y β = −' + Math.abs(BETA) + ' son ilustrativos.');

    function add(w) {
      const word = String(w || '').trim().slice(0, 24);
      if (!word) return;
      if (state.words.some((x) => fold(x) === fold(word))) { state.msg = '«' + word + '» ya está en el vocabulario.'; draw(); return; }
      if (state.words.length >= MAXW) state.words.shift();
      state.words.push(word);
      state.added = word;
      state.msg = FIXED.some((c) => fold(c) === fold(word)) ? '' : 'La cabeza fija no tiene fila para «' + word + '»: habría que agregarla (K + 1 filas) y re-entrenar.';
      draw();
    }

    function scores(rows, isText) {
      return REG.map((e) => rows.map((w, j) => { const c = dot(e, w); return isText ? { c, s: sig(ALPHA * c + BETA) } : { c, s: sig(9 * c - 4.5 + 0 * j) }; }));
    }

    function draw() {
      const TXT = state.words.map(textEmb);
      const SF = scores(WFIX, false), ST = scores(TXT, true);
      stage.innerHTML = '';
      const IX = 10, IY = 40, IW = 250, IH = 190;
      const MX = IX + IW + 70, cw = 62, rh = 30;
      const nW = state.words.length;
      const Wd = MX + Math.max(FIXED.length + 2, nW) * cw + 20, Hh = IY + 28 + 2 * OBJECTS.length * rh + 82;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + Wd + ' ' + Hh, style: 'max-width:' + Wd + 'px;min-width:' + Math.min(Wd, 620) + 'px', role: 'group',
        'aria-label': 'Cabeza de clases fija frente a cabeza de texto: ' + nW + ' palabras en el vocabulario abierto.' }, stage);
      t(svg, IX, 16, 'Regiones detectadas', 'viz-t');
      t(svg, IX, 31, 'un embedding por región', 'viz-s');
      V.detScene(svg, IX, IY, IW, IH, OBJECTS);
      // etiqueta de cada región con su mejor clase en la cabeza de texto
      OBJECTS.forEach((o, i) => {
        const b = o.box, x0 = IX + (b[0] - b[2] / 2) * IW, y0 = IY + (b[1] - b[3] / 2) * IH;
        V.svg('rect', { x: x0, y: y0, width: b[2] * IW, height: b[3] * IH, class: 'viz-ov-rbox' }, svg);
        const bi = argmax(ST[i].map((x) => x.s));
        const lab = 'r' + (i + 1) + (ST[i][bi] && ST[i][bi].s >= 0.5 ? ': ' + state.words[bi] : '');
        V.svg('rect', { x: x0, y: y0 - 13, width: lab.length * 6.4 + 8, height: 13, class: 'viz-ov-rtag' }, svg);
        t(svg, x0 + 4, y0 - 3, lab, 'viz-ov-rtxt');
      });
      // flechas región → cabezas
      const y1 = IY + 28, y2 = y1 + OBJECTS.length * rh + 70;
      V.svg('path', { d: 'M' + (IX + IW + 6) + ' ' + (IY + IH / 2) + 'H' + (MX - 46) + 'V' + (y1 + OBJECTS.length * rh / 2) + 'H' + (MX - 34), class: 'viz-ln' }, svg);
      V.svg('path', { d: 'M' + (MX - 46) + ' ' + (IY + IH / 2) + 'V' + (y2 + OBJECTS.length * rh / 2) + 'H' + (MX - 34), class: 'viz-ln' }, svg);
      [y1, y2].forEach((y) => V.svg('path', { d: 'M' + (MX - 28) + ' ' + (y + OBJECTS.length * rh / 2) + 'l-7 -4v8z', class: 'viz-head' }, svg));

      // ---- cabeza fija
      t(svg, MX - 26, y1 - 30, 'Cabeza fija (detector clásico): K = ' + K + ' filas aprendidas', 'viz-t');
      t(svg, MX - 26, y1 - 16, 'logit = W · e + b → sigmoide (W: K×D)', 'viz-s');
      FIXED.forEach((c, j) => t(svg, MX + j * cw + cw / 2, y1 - 3, c, 'viz-n', 'middle'));
      t(svg, MX + FIXED.length * cw + cw / 2, y1 - 3, '… ' + (K - FIXED.length) + ' más', 'viz-s', 'middle');
      grid(svg, SF, MX, y1, cw, rh, FIXED.map(() => false), 'fija');
      if (state.added && !FIXED.some((c) => fold(c) === fold(state.added))) {
        const gx = MX + (FIXED.length + 1) * cw + 4;
        if (gx + cw < Wd) {
          V.svg('rect', { x: gx, y: y1 + 2, width: cw - 6, height: OBJECTS.length * rh - 4, rx: 3, class: 'viz-ov-nofila' }, svg);
          t(svg, gx + (cw - 6) / 2, y1 - 3, state.added, 'viz-s', 'middle');
          t(svg, gx + (cw - 6) / 2, y1 + OBJECTS.length * rh / 2 + 4, 'sin fila', 'viz-n', 'middle');
        }
      }
      // ---- cabeza de texto
      t(svg, MX - 26, y2 - 30, 'Cabeza de texto: filas = encoder de texto(palabra)', 'viz-t');
      t(svg, MX - 26, y2 - 16, 'logit = α · cos(e, t) + β → sigmoide · ' + nW + ' palabras', 'viz-s');
      state.words.forEach((w, j) => {
        const b = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'button', 'aria-label': 'Quitar la palabra ' + w }, svg);
        const lab = w.length > 9 ? w.slice(0, 8) + '…' : w;
        t(b, MX + j * cw + cw / 2, y2 - 3, lab + ' ×', fold(w) === fold(state.added || '') ? 'viz-n viz-ov-new' : 'viz-n', 'middle');
        V.svg('rect', { x: MX + j * cw + 2, y: y2 - 15, width: cw - 4, height: 16, class: 'viz-ov-hit' }, b);
        const rm = () => { if (state.words.length <= 1) return; state.words.splice(j, 1); if (fold(state.added || '') === fold(w)) state.added = null; state.msg = ''; draw(); };
        b.addEventListener('click', rm); b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); rm(); } });
      });
      grid(svg, ST, MX, y2, cw, rh, state.words.map((w) => fold(w) === fold(state.added || '')), 'texto');

      out.innerHTML = '';
      const kv = (a, b) => { const sp = V.html('span', null, out); sp.innerHTML = a + ' <b>' + b + '</b>'; };
      OBJECTS.forEach((o, i) => {
        const bt = argmax(ST[i].map((x) => x.s)), bf = argmax(SF[i].map((x) => x.s));
        kv('r' + (i + 1) + ' (' + o.label + '):', 'fija → ' + FIXED[bf] + ' ' + SF[i][bf].s.toFixed(2) + ' · texto → ' + (ST[i][bt].s >= 0.5 ? state.words[bt] + ' ' + ST[i][bt].s.toFixed(2) : 'nada ≥ 0.5'));
      });
      if (state.msg) kv('', state.msg);
      real();
    }
    function grid(svg, Sx, X, Y, cw, rh, isNew, which) {
      OBJECTS.forEach((o, i) => {
        t(svg, X - 8, Y + i * rh + rh / 2 + 4, 'r' + (i + 1), 'viz-s', 'end');
        const best = argmax(Sx[i].map((x) => x.s));
        Sx[i].forEach((v, j) => {
          const g = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': 'Cabeza ' + which + ', región ' + (i + 1) + ', columna ' + (j + 1) + ': coseno ' + v.c.toFixed(2) + ', puntaje ' + v.s.toFixed(2) }, svg);
          V.svg('rect', { x: X + j * cw + 2, y: Y + i * rh + 2, width: cw - 4, height: rh - 4, rx: 3, class: 'viz-ov-cell' + (isNew[j] ? ' viz-ov-cell--new' : ''),
            style: 'fill:color-mix(in srgb, var(--op-head) ' + Math.round(6 + 39 * v.s) + '%, var(--surface))' }, g);
          t(g, X + j * cw + cw / 2, Y + i * rh + rh / 2 + 4, v.s.toFixed(2), v.s >= 0.5 ? 'viz-ov-v viz-ov-v--hi' : 'viz-ov-v', 'middle');
          if (j === best && v.s >= 0.5) V.svg('rect', { x: X + j * cw + 1, y: Y + i * rh + 1, width: cw - 2, height: rh - 2, rx: 3, class: 'viz-ov-best' }, g);
        });
      });
    }
    function real() {
      realBox.innerHTML = '';
      const rk = (a, b) => { const sp = V.html('span', null, realBox); sp.innerHTML = a + ' <b>' + b + '</b>'; };
      const vc = run && run.tensors && run.tensors.vocab ? run.tensors.vocab.num : null;
      const c = (run && run.config) || {};
      rk('real:', '');
      // cabeza fija de YOLOv8-L: la conv 1×1 final de la rama de clase en cada nivel (hc-p3/p4/p5-out) = K filas
      const fixP = base ? opsSum(base, (o) => /^hc-p\d-out$/.test(o.id)) : 0;
      const qn = (run && run.quantities) || {};
      if (fixP) rk('cabeza fija de ' + ((base && base.label) || anchorId) + ' (conv 1×1 final, 3 niveles, K = ' + K + '):', fmt.int(fixP) + ' parámetros atados a esas K clases');
      if (qn.contrastiveHeadParams != null) rk('cabeza de texto de ' + ((run && run.label) || cfgId) + ' (α, β):', fmt.int(qn.contrastiveHeadParams) + ' parámetros');
      if (vc) rk('vocabulario:', vc.join('×') + ' = ' + fmt.int(vc[0] * vc[1]) + ' números, calculados una vez' + (qn.promptTextMacs ? ' (' + fmt.si(qn.promptTextMacs) + ' MACs por palabra)' : ''));
      else if (c.V) rk('vocabulario:', 'V = ' + c.V + ' embeddings de texto');
      rk('clase nueva:', 'fija → re-entrenar · texto → 1 pasada del encoder de texto');
    }
    function argmax(a) { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }
    function t(p, x, y, s, cls, anchor) { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; }

    draw();
    return { destroy() { wrap.remove(); } };
  }
  let uid = 0;

  if (ATLAS.Viz) ATLAS.Viz.register('open-vocab-head', render);
})(typeof window !== 'undefined' ? window : globalThis);
