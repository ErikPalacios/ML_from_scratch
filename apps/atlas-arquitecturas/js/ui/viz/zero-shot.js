/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/zero-shot.js
   Visualización "zero-shot" (SPEC §7.8, §14.4): clasificar sin entrenar una cabeza.
   Cada clase → un prompt ("a photo of a {label}.") → el encoder de texto → un embedding
   normalizado: las K filas forman la matriz de pesos W (K×E) de un clasificador lineal. La imagen
   → encoder de imagen → embedding normalizado x̂; logits = s·W·x̂ → softmax → clase.
   Embeddings SINTÉTICOS (con semilla), íconos dibujados por código: todo "ilustrativo"; E, la
   escala y el tamaño de W con las 1000 clases de ImageNet salen del calculador.
   params: { config:'clip-vit-b16', image:'boat', template:'photo'|'label' }
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
    const state = { image: CLASSES.indexOf(params.image) >= 0 ? params.image : 'boat', template: params.template === 'label' ? 'label' : 'photo' };
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
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Embeddings sintéticos con semilla (no de un CLIP entrenado) para mostrar el mecanismo: los textos de las clases SON los pesos del clasificador. Con el prompt "a photo of a {label}." los embeddings de texto quedan más cerca de los de imágenes (en la demo, menos ruido), como reporta el paper con su ingeniería de prompts.' }, wrap);

    // Embeddings: concepto base por clase; texto = base + ruido (más con la etiqueta sola); imagen = base + ruido.
    function embed() {
      const R = V.rng(2718);
      const vec = () => Array.from({ length: ED }, () => R.normal());
      const base = {}; CLASSES.forEach((n) => { base[n] = vec(); });
      // "tree" y "mountain" comparten algo (paisaje): un negativo difícil
      const land = vec(); ['tree', 'mountain'].forEach((n) => { base[n] = base[n].map((v, i) => 0.7 * v + 0.7 * land[i]); });
      const nT = {}; for (const k of Object.keys(TEMPLATES)) { nT[k] = {}; CLASSES.forEach((n) => { nT[k][n] = vec(); }); }
      const nI = {}; CLASSES.forEach((n) => { nI[n] = vec(); });
      const norm = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
      const amp = { photo: 0.4, label: 1.0 };
      const W = {}; for (const k of Object.keys(TEMPLATES)) W[k] = CLASSES.map((n) => norm(base[n].map((v, i) => v + amp[k] * nT[k][n][i])));
      const X = {}; CLASSES.forEach((n) => { X[n] = norm(base[n].map((v, i) => v + 0.55 * nI[n][i])); });
      return { W, X };
    }
    const EMB = embed();

    function draw() {
      bImg.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.image)));
      bTpl.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.template)));
      const W = EMB.W[state.template], x = EMB.X[state.image];
      const s = 1 / tau0;
      const cos = W.map((w) => w.reduce((a, v, i) => a + v * x[i], 0));
      const logits = cos.map((v) => v * s);
      const m = Math.max(...logits), ex = logits.map((l) => Math.exp(l - m)), Z = ex.reduce((a, b) => a + b, 0);
      const p = ex.map((e) => e / Z);
      const best = p.indexOf(Math.max(...p));
      const K = CLASSES.length;

      stage.innerHTML = '';
      const rowH = 30, TOP = 52, cw = 15;
      const PX = 8, WX = 236, BX = WX + ED * cw + 52;
      const Wd = BX + 240, Hh = TOP + K * rowH + 110;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + Wd + ' ' + Hh, style: 'max-width:' + Wd + 'px;min-width:' + Math.min(Wd, 600) + 'px', role: 'group',
        'aria-label': 'Clasificación zero-shot de la imagen ' + state.image + ': predicción ' + CLASSES[best] + ' con probabilidad ' + p[best].toFixed(2) }, stage);
      t(svg, PX, 16, '1 · Prompts → encoder de texto → W (K×E)', 'viz-t');
      t(svg, PX, 31, 'una fila por clase; se calcula una vez y se reutiliza', 'viz-s');
      t(svg, BX, 16, '3 · logits = s·W·x → softmax', 'viz-t');
      t(svg, BX, 31, 's = 1/τ = ' + (1 / tau0).toFixed(1) + ' (inicial)', 'viz-s');
      // matriz W como mapa de calor (valores en [−1, 1]) + prompts a la izquierda
      const lim = Math.max(...W.flat().map(Math.abs));
      CLASSES.forEach((n, k) => {
        const y = TOP + k * rowH;
        t(svg, WX - 10, y + rowH / 2 + 4, TEMPLATES[state.template].replace('{label}', n), 'viz-s', 'end');
        for (let i = 0; i < ED; i++) {
          const v = W[k][i] / lim;
          V.svg('rect', { x: WX + i * cw, y: y + 3, width: cw - 1, height: rowH - 6, rx: 1.5, class: 'viz-zs-w',
            style: 'fill:color-mix(in srgb, var(' + (v >= 0 ? '--op-embed' : '--op-conv') + ') ' + Math.round(8 + 72 * Math.abs(v)) + '%, var(--surface))' }, svg);
        }
        if (k === best) V.svg('rect', { x: WX - 2, y: y + 1, width: ED * cw + 3, height: rowH - 2, rx: 3, class: 'viz-zs-best' }, svg);
      });
      t(svg, WX, TOP + K * rowH + 14, 'W: ' + K + '×' + ED + ' en la demo · cada fila normalizada', 'viz-s');
      // imagen → x̂
      const iy = TOP + K * rowH + 44;
      t(svg, PX, iy - 4, '2 · Imagen → encoder de imagen → x (norma 1)', 'viz-t');
      V.icon(svg, state.image, PX, iy + 6, 44);
      V.svg('path', { d: 'M' + (PX + 52) + ' ' + (iy + 28) + 'H' + (WX - 14), class: 'viz-ln' }, svg);
      V.svg('path', { d: 'M' + (WX - 8) + ' ' + (iy + 28) + 'l-7 -4v8z', class: 'viz-head' }, svg);
      for (let i = 0; i < ED; i++) {
        V.svg('rect', { x: WX + i * cw, y: iy + 15, width: cw - 1, height: rowH - 6, rx: 1.5, class: 'viz-zs-w',
          style: 'fill:color-mix(in srgb, var(' + (x[i] >= 0 ? '--mod-img' : '--op-conv') + ') ' + Math.round(8 + 72 * Math.abs(x[i]) / Math.max(...x.map(Math.abs))) + '%, var(--surface))' }, svg);
      }
      t(svg, WX + ED * cw + 8, iy + 32, 'x', 'viz-t');
      // barras de probabilidad
      const barW = 150;
      CLASSES.forEach((n, k) => {
        const y = TOP + k * rowH;
        const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': n + ': coseno ' + cos[k].toFixed(3) + ', logit ' + logits[k].toFixed(2) + ', probabilidad ' + p[k].toFixed(3) }, svg);
        V.svg('rect', { x: BX, y: y + 6, width: barW, height: rowH - 12, rx: 2, class: 'viz-zs-track' }, gEl);
        V.svg('rect', { x: BX, y: y + 6, width: Math.max(1, barW * p[k]), height: rowH - 12, rx: 2, class: k === best ? 'viz-zs-bar viz-zs-bar--best' : 'viz-zs-bar' }, gEl);
        t(gEl, BX + barW + 6, y + rowH / 2 + 4, p[k].toFixed(2) + (k === best ? '  ← ' + n : ''), k === best ? 'viz-n' : 'viz-s');
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
