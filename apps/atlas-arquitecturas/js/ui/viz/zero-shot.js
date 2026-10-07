/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/zero-shot.js
   Visualización "zero-shot" (SPEC §7.8, §14.4): clasificar sin entrenar una cabeza.
   Cada clase → un prompt ("a photo of a {label}.") → el encoder de texto → un embedding
   normalizado: las K filas forman la matriz de pesos W (K×E) de un clasificador lineal. La imagen
   → encoder de imagen → embedding normalizado x̂; logits = s·W·x̂ → softmax → clase.
   Embeddings SINTÉTICOS (con semilla), íconos dibujados por código: todo "ilustrativo"; E, la
   escala y el tamaño de W con las 1000 clases de ImageNet salen del calculador.
   Escala: por defecto la de un CLIP entrenado (s = e^t llega al tope de 100, Radford et al. 2021 §2.5);
   el chip "inicial" muestra s = 1/0.07 ≈ 14.3 (la inicialización) para comparar.
   Embeddings: 12 dimensiones con una base ortonormal (con semilla): cada clase tiene su dirección, "tree"
   y "mountain" comparten una (paisaje: el negativo difícil), cada modalidad su desplazamiento propio
   (la "modality gap": cosenos de ≈ 0.3–0.5 como en un CLIP real, no de ≈ 1) y ruido.
   params: { config:'clip-vit-b16', image:'boat', template:'photo'|'label', scale:'trained'|'init' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const CLASSES = ['house', 'tree', 'sun', 'boat', 'mountain', 'fish'];
  const TEMPLATES = { photo: 'a photo of a {label}.', label: '{label}' };

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, fmt = A.fmt;
    const cfgId = params.config || 'clip-vit-b16';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const c = (run && run.config) || {};
    const E = c.E || c.embedDim || (run && run.tensors['img-emb'] && run.tensors['img-emb'].num[0]) || null;
    const tau0 = c.temperatureInit || c.tau0 || 0.07;
    const scaleMax = c.logitScaleMax || 100;
    const state = { image: CLASSES.indexOf(params.image) >= 0 ? params.image : 'boat', template: params.template === 'label' ? 'label' : 'photo', scale: params.scale === 'init' ? 'init' : 'trained' };
    const ED = 12;                                  // dimensión de la demo (la real es E)

    const wrap = V.html('div', { class: 'viz viz-zs' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const gi = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Imagen' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Imagen' }, gi);
    const bImg = CLASSES.map((n) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: n }, gi); b.addEventListener('click', () => { state.image = n; draw(); }); b._v = n; return b; });
    const gt = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Prompt' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Prompt' }, gt);
    const bTpl = Object.keys(TEMPLATES).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: '"' + TEMPLATES[k] + '"' }, gt); b.addEventListener('click', () => { state.template = k; draw(); }); b._v = k; return b; });
    const gs = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Escala s' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Escala s' }, gs);
    const bScale = [['trained', 'entrenado: ' + scaleMax], ['init', 'inicial: 1/' + tau0 + ' ≈ ' + (1 / tau0).toFixed(1)]].map(([k, label]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label }, gs); b.addEventListener('click', () => { state.scale = k; draw(); }); b._v = k; return b; });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Embeddings sintéticos con semilla (no de un CLIP entrenado) para mostrar el mecanismo: los textos de las clases SON los pesos del clasificador, y cada logit es s·cos(fila k de W, x). En la demo, el prompt "a photo of a {label}." deja menos ruido en los embeddings de texto que la etiqueta sola; el paper reporta el efecto en accuracy: +1.3 % en ImageNet con "A photo of a {label}." (§3.1.4). Con la escala entrenada (100), una diferencia de 0.05 en el coseno ya son 5 logits: por eso las probabilidades son tan marcadas.' }, wrap);

    // Embeddings (ver la cabecera): base ortonormal de 12 dimensiones con semilla. Direcciones 0–5: una por
    // clase; 6: "paisaje" (compartida por tree y mountain); 7: común a todo; 8 y 9: desplazamiento del texto y
    // de la imagen (modality gap). Texto = clase + común + gap_t + ruido (más con la etiqueta sola).
    function embed() {
      const R = V.rng(21);
      const dotv = (a, b) => a.reduce((acc, x, i) => acc + x * b[i], 0);
      const norm = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
      const raw = () => Array.from({ length: ED }, () => R.normal());
      const Eb = [];
      for (let k = 0; k < ED; k++) { let v = raw(); for (const e of Eb) { const d = dotv(v, e); v = v.map((x, i) => x - d * e[i]); } Eb.push(norm(v)); }
      const comb = (cs) => Eb[0].map((_, i) => cs.reduce((acc, [w, k]) => acc + w * Eb[k][i], 0));
      const base = {}; CLASSES.forEach((n, k) => { base[n] = comb([[1, k]]); });
      base.tree = comb([[1, 1], [0.8, 6]]); base.mountain = comb([[1, 4], [0.8, 6]]);
      const noise = (amp) => raw().map((x) => x * amp / Math.sqrt(ED));
      const amp = { photo: 0.8, label: 1.2 };
      const W = {};
      for (const k of Object.keys(TEMPLATES)) W[k] = CLASSES.map((n) => { const nz = noise(amp[k]); return norm(base[n].map((v, i) => v + 0.6 * Eb[7][i] + 1.3 * Eb[8][i] + nz[i])); });
      const X = {};
      CLASSES.forEach((n) => { const nz = noise(0.8); X[n] = norm(base[n].map((v, i) => v + 0.6 * Eb[7][i] + 1.3 * Eb[9][i] + nz[i])); });
      return { W, X };
    }
    const EMB = embed();

    function draw() {
      bImg.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.image)));
      bTpl.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.template)));
      bScale.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.scale)));
      const W = EMB.W[state.template], x = EMB.X[state.image];
      const s = state.scale === 'init' ? 1 / tau0 : scaleMax;
      const cos = W.map((w) => w.reduce((a, v, i) => a + v * x[i], 0));
      const logits = cos.map((v) => v * s);
      const m = Math.max(...logits), ex = logits.map((l) => Math.exp(l - m)), Z = ex.reduce((a, b) => a + b, 0);
      const p = ex.map((e) => e / Z);
      const best = p.indexOf(Math.max(...p));
      const K = CLASSES.length;

      stage.innerHTML = '';
      const rowH = 30, TOP = 52, cw = 15;
      const PX = 8, WX = 236, WE = WX + ED * cw, MX = WE + 30, BX = WE + 60;
      const Wd = BX + 345, Hh = TOP + K * rowH + 110;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + Wd + ' ' + Hh, style: 'max-width:' + Wd + 'px;min-width:' + Math.min(Wd, 600) + 'px', role: 'group',
        'aria-label': 'Clasificación zero-shot de la imagen ' + state.image + ': predicción ' + CLASSES[best] + ' con probabilidad ' + p[best].toFixed(2) }, stage);
      t(svg, PX, 16, '1 · Prompts → encoder de texto → W (K×E)', 'viz-t');
      t(svg, PX, 31, 'una fila por clase, norma 1; se calcula una vez', 'viz-s');
      t(svg, BX - 26, 16, '3 · logits = s·W·x → softmax', 'viz-t');
      t(svg, BX - 26, 31, 's = ' + (state.scale === 'init' ? (1 / tau0).toFixed(1) + ' (inicialización, τ = ' + tau0 + ')' : scaleMax + ' (CLIP entrenado: el tope)'), 'viz-s');
      // matriz W como mapa de calor (valores en [−1, 1]) + prompts a la izquierda
      const lim = Math.max(...W.flat().map(Math.abs));
      // bus de x: sube desde el vector de la imagen y se cruza con cada fila de W (un producto punto por fila)
      const iy = TOP + K * rowH + 44, xy = iy + 15 + (rowH - 6) / 2;
      V.svg('path', { d: 'M' + (WE + 4) + ' ' + xy + 'H' + MX + 'V' + (TOP + rowH / 2 + 5), class: 'viz-ln viz-zs-bus' }, svg);
      V.svg('path', { d: 'M' + MX + ' ' + (TOP + rowH / 2 - 1) + 'l-4 7h8z', class: 'viz-head' }, svg);
      t(svg, MX + 7, xy + 4, 'x', 'viz-t');
      CLASSES.forEach((n, k) => {
        const y = TOP + k * rowH, yc = y + rowH / 2;
        t(svg, WX - 10, yc + 4, TEMPLATES[state.template].replace('{label}', n), 'viz-s', 'end');
        for (let i = 0; i < ED; i++) {
          const v = W[k][i] / lim;
          V.svg('rect', { x: WX + i * cw, y: y + 3, width: cw - 1, height: rowH - 6, rx: 1.5, class: 'viz-zs-w',
            style: 'fill:color-mix(in srgb, var(' + (v >= 0 ? '--op-embed' : '--op-conv') + ') ' + Math.round(8 + 72 * Math.abs(v)) + '%, var(--surface))' }, svg);
        }
        if (k === best) V.svg('rect', { x: WX - 2, y: y + 1, width: ED * cw + 3, height: rowH - 2, rx: 3, class: 'viz-zs-best' }, svg);
        // fila k → (· x) → su barra
        V.svg('path', { d: 'M' + (WE + 3) + ' ' + yc + 'H' + (BX - 3), class: k === best ? 'viz-zs-row viz-zs-row--best' : 'viz-zs-row' }, svg);
        V.svg('circle', { cx: MX, cy: yc, r: 5, class: 'viz-zs-dot' }, svg);
        V.svg('circle', { cx: MX, cy: yc, r: 1.4, class: 'viz-zs-dot-c' }, svg);
      });
      t(svg, WX, TOP + K * rowH + 14, 'W: ' + K + '×' + ED + ' en la demo', 'viz-s');
      t(svg, MX, TOP - 6, 'cos(fila, x)', 'viz-s', 'middle');
      // imagen → x̂
      t(svg, PX, iy - 4, '2 · Imagen → encoder de imagen → x (norma 1)', 'viz-t');
      V.icon(svg, state.image, PX, iy + 6, 44);
      V.svg('path', { d: 'M' + (PX + 52) + ' ' + xy + 'H' + (WX - 14), class: 'viz-ln' }, svg);
      V.svg('path', { d: 'M' + (WX - 8) + ' ' + xy + 'l-7 -4v8z', class: 'viz-head' }, svg);
      const xm = Math.max(...x.map(Math.abs));
      for (let i = 0; i < ED; i++) {
        V.svg('rect', { x: WX + i * cw, y: iy + 15, width: cw - 1, height: rowH - 6, rx: 1.5, class: 'viz-zs-w',
          style: 'fill:color-mix(in srgb, var(' + (x[i] >= 0 ? '--mod-img' : '--op-conv') + ') ' + Math.round(8 + 72 * Math.abs(x[i]) / xm) + '%, var(--surface))' }, svg);
      }
      // barras de probabilidad
      const barW = 150;
      CLASSES.forEach((n, k) => {
        const y = TOP + k * rowH;
        const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': n + ': coseno ' + cos[k].toFixed(3) + ', logit ' + logits[k].toFixed(2) + ', probabilidad ' + p[k].toFixed(3) }, svg);
        V.svg('rect', { x: BX, y: y + 6, width: barW, height: rowH - 12, rx: 2, class: 'viz-zs-track' }, gEl);
        V.svg('rect', { x: BX, y: y + 6, width: Math.max(1, barW * p[k]), height: rowH - 12, rx: 2, class: k === best ? 'viz-zs-bar viz-zs-bar--best' : 'viz-zs-bar' }, gEl);
        t(gEl, BX + barW + 6, y + rowH / 2 + 4, p[k].toFixed(2) + ' · cos ' + cos[k].toFixed(2) + (k === best ? ' ← ' + n : ''), k === best ? 'viz-n' : 'viz-s');
        gEl.addEventListener('focus', () => readout(k)); gEl.addEventListener('pointerenter', () => readout(k));
      });
      state.last = { cos, logits, p, best };
      readout(null);
    }

    function readout(k) {
      out.innerHTML = '';
      const kv = (a, b) => { const sp = V.html('span', null, out); sp.innerHTML = a + ' <b>' + b + '</b>'; };
      const S = state.last;
      kv('predicción:', CLASSES[S.best] + ' (p = ' + S.p[S.best].toFixed(2) + ')' + (CLASSES[S.best] === state.image ? ' ✓' : ' ✗'));
      kv('s =', state.scale === 'init' ? (1 / tau0).toFixed(1) + ' (inicial)' : scaleMax + ' (entrenado)');
      if (k != null) kv(CLASSES[k] + ':', 'cos ' + S.cos[k].toFixed(3) + ' · logit ' + S.logits[k].toFixed(2) + ' · p ' + S.p[k].toFixed(3));
      if (E) {
        kv('real: E =', String(E));
        kv('W para las 1000 clases de ImageNet:', '1000×' + E + ' = ' + fmt.int(1000 * E) + ' números (sin entrenar)');
      }
    }
    function t(p, x, y, s, cls, anchor) { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; }

    draw();
    return { destroy() { wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('zero-shot', render);
})(typeof window !== 'undefined' ? window : globalThis);
