/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/hungarian.js
   Visualización "hungarian" (SPEC §7.8, §15.3): el matching de DETR en el entrenamiento.
   Una imagen SINTÉTICA (escena dibujada por código, cajas ilustrativas) con G objetos anotados y las
   Q predicciones de las object queries → matriz de costos Q×G, separada en sus tres términos
   (clase −p̂(c), L1 de la caja, −GIoU) → la asignación óptima 1 a 1 (algoritmo húngaro, el
   linear_sum_assignment del código oficial) → cada objeto queda con UNA query; las Q − G restantes
   reciben el objetivo ∅ ("no object"). Los duplicados (queries con una caja buena sobre un objeto ya
   tomado) pierden contra la mejor y se van a ∅: así aprende DETR a no duplicar, sin NMS.
   Q, G, los pesos λ del costo y la resolución salen del calculador (config); las cajas, de la escena.
   Pasa el cursor (o enfoca) una celda para ver sus tres términos.
   params: { config:'detr-r50-800x1216', view:'total'|'cls'|'l1'|'giou', rows:'some'|'all',
             model:'trained'|'init', match:'total'|'term' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const VIEWS = [['total', 'costo total'], ['cls', 'clase: −p̂(c)'], ['l1', 'L1 de la caja'], ['giou', '−GIoU']];

  function num(v, d) { return Number.isFinite(v) ? v : d; }
  function cfgNum(c, keys, d) { for (const k of keys) { const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), c); if (Number.isFinite(v)) return v; } return d; }

  // Predicciones sintéticas de las Q queries (con semilla). trained: una query "especialista" por objeto
  // (caja cercana, p̂ alta), algunos duplicados (caja buena, p̂ media) y el resto cajas sueltas con p̂ baja.
  // init: al inicio del entrenamiento todas las queries dan cajas parecidas cerca del centro y p̂ ≈ 1/(C+1).
  function predictions(objs, Q, model, nCls, seed) {
    const V = ATLAS.Viz, R = V.rng(seed);
    const G = objs.length;
    const perm = Array.from({ length: Q }, (_, i) => i);
    for (let i = Q - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    const clamp01 = (b) => { const w = Math.min(0.95, Math.max(0.02, b[2])), h = Math.min(0.95, Math.max(0.02, b[3])); return [Math.min(1 - w / 2, Math.max(w / 2, b[0])), Math.min(1 - h / 2, Math.max(h / 2, b[1])), w, h]; };
    const labels = Array.from(new Set(objs.map((o) => o.label)));
    const preds = Array.from({ length: Q }, (_, q) => ({ q, role: 'bg', box: null, p: {} }));
    const base = 1 / (nCls + 1);
    if (model === 'init') {
      for (const pr of preds) {
        pr.box = clamp01([0.5 + 0.16 * R.normal(), 0.5 + 0.16 * R.normal(), 0.42 + 0.12 * R.normal(), 0.42 + 0.12 * R.normal()]);
        for (const l of labels) pr.p[l] = base * (0.7 + 0.6 * R());
      }
      return preds;
    }
    const jit = (b, s, k) => clamp01([b[0] + s * b[2] * R.normal(), b[1] + s * b[3] * R.normal(), b[2] * (1 + k * R.normal()), b[3] * (1 + k * R.normal())]);
    objs.forEach((o, j) => {
      const pr = preds[perm[j]];
      pr.role = 'spec'; pr.obj = j; pr.box = jit(o.box, 0.05, 0.06);
      for (const l of labels) pr.p[l] = 0.004 + 0.02 * R();
      pr.p[o.label] = 0.82 + 0.13 * R();
    });
    // duplicados: sobre 1 de cada 3 objetos (los primeros del orden de la escena), con p̂ media
    const nd = Math.min(3, Math.ceil(G / 3), Q - G);
    for (let k = 0; k < nd; k++) {
      const j = (k * 3 + 1) % G, o = objs[j], pr = preds[perm[G + k]];
      pr.role = 'dup'; pr.obj = j; pr.box = jit(o.box, 0.12, 0.12);
      for (const l of labels) pr.p[l] = 0.004 + 0.02 * R();
      pr.p[o.label] = 0.22 + 0.2 * R();
    }
    for (const pr of preds) if (!pr.box) {
      pr.box = clamp01([0.1 + 0.8 * R(), 0.1 + 0.8 * R(), 0.06 + 0.25 * R(), 0.06 + 0.25 * R()]);
      for (const l of labels) pr.p[l] = 0.002 + 0.03 * R();
    }
    return preds;
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch, B = V.box;
    const fmt = (A && A.fmt) || { int: (n) => String(n) };
    const cfgId = params.config || 'detr-r50-800x1216';
    let run = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    const c = (run && run.config) || {};
    const Q = Math.max(1, Math.round(cfgNum(c, ['Q', 'numQueries', 'queries'], 100)));
    const Graw = Math.round(cfgNum(c, ['G', 'gt', 'numGt'], 7));
    const G = Math.max(1, Math.min(Graw, V.DET_OBJECTS.length, Q));
    const nCls = Math.round(cfgNum(c, ['numClasses', 'classes', 'C'], 91));
    // pesos del costo del matcher (set_cost_class, set_cost_bbox, set_cost_giou en el código oficial)
    const lam = { cls: cfgNum(c, ['costClass', 'matcher.cls', 'matcher.class', 'lambdaCls', 'lossWeights.cls'], 1), l1: cfgNum(c, ['costBbox', 'costL1', 'matcher.l1', 'matcher.bbox', 'lambdaL1', 'lossWeights.l1'], 5), giou: cfgNum(c, ['costGiou', 'matcher.giou', 'lambdaGiou', 'lossWeights.giou'], 2) };
    const eos = cfgNum(c, ['eosCoef', 'noObjectWeight', 'lossWeights.noObject'], 0.1);
    const imgH = cfgNum(c, ['H', 'res.0', 'imgH'], 800), imgW = cfgNum(c, ['W', 'res.1', 'imgW'], 1216);
    const objs = V.DET_OBJECTS.slice(0, G);
    const state = {
      view: VIEWS.some((v) => v[0] === params.view) ? params.view : 'total', rows: params.rows === 'all' ? 'all' : 'some',
      model: params.model === 'init' ? 'init' : 'trained', match: params.match === 'term' ? 'term' : 'total', cell: null,
    };

    const wrap = V.html('div', { class: 'viz viz-hung' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const chipGroup = (label, items, key) => {
      const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': label }, ctl);
      V.html('span', { class: 'viz-ctl-l', text: label }, g);
      return items.map(([v, t]) => {
        const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: t }, g);
        b.addEventListener('click', () => { state[key] = v; state.cell = null; draw(); });
        b._v = v; b._k = key; return b;
      });
    };
    const chips = [
      chipGroup('Ver', VIEWS, 'view'),
      chipGroup('Emparejar por', [['total', 'costo total (DETR)'], ['term', 'solo el término visible']], 'match'),
      chipGroup('Filas', [['some', 'las relevantes'], ['all', 'las Q = ' + Q]], 'rows'),
      chipGroup('Modelo', [['trained', 'entrenado'], ['init', 'inicio del entrenamiento']], 'model'),
    ];
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note', text: 'Escena, cajas y probabilidades ilustrativas (generadas por código, no por un DETR entrenado); Q, G y los pesos λ son los de la config. ' +
      'Costo de emparejar la query i con el objeto j: C = λ_cls·(−p̂ᵢ(cⱼ)) + λ_L1·‖bᵢ − bⱼ‖₁ + λ_giou·(−GIoU(bᵢ, bⱼ)), con λ = (' + lam.cls + ', ' + lam.l1 + ', ' + lam.giou + '). ' +
      'El algoritmo húngaro elige las G parejas que minimizan la suma (cada objeto con una query distinta). No es diferenciable: se calcula sin gradiente en cada paso, por imagen, y la pérdida se aplica después sobre esas parejas. ' +
      'Las queries sin pareja tienen como objetivo la clase ∅ ("no object"), con peso ' + eos + ' en la cross-entropy. Un duplicado (buena caja sobre un objeto ya tomado) pierde contra la query que mejor lo explica y se entrena hacia ∅: por eso DETR no necesita NMS.' }, wrap);

    const SEED = 20200526;
    function draw() {
      chips.forEach((cs) => cs.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v))));
      const preds = predictions(objs, Q, state.model, nCls, SEED + (state.model === 'init' ? 7 : 0));
      // términos por (query i, objeto j)
      const T = preds.map((pr) => objs.map((o) => {
        const cls = -(pr.p[o.label] || 0), l1 = B.l1(pr.box, o.box), giou = -B.giou(pr.box, o.box);
        return { cls, l1, giou, total: lam.cls * cls + lam.l1 * l1 + lam.giou * giou };
      }));
      const assign = (key) => {
        const cost = objs.map((_, j) => preds.map((_, i) => T[i][j][key]));       // G × Q (filas = objetos)
        const h = V.hungarian(cost);
        const qOf = h.col, objOf = new Array(Q).fill(-1);
        qOf.forEach((q, j) => { objOf[q] = j; });
        return { qOf, objOf, sum: qOf.reduce((s, q, j) => s + T[q][j].total, 0) };
      };
      const best = assign('total');
      const shown = state.match === 'term' && state.view !== 'total' ? assign(state.view) : best;
      const changed = shown === best ? 0 : best.qOf.filter((q, j) => shown.qOf[j] !== q).length;

      // filas que se muestran
      let rows;
      if (state.rows === 'all') rows = preds.map((p) => p.q);
      else {
        const set = new Set(best.qOf.concat(shown.qOf));
        preds.forEach((p) => { if (p.role === 'dup') set.add(p.q); });
        const R = V.rng(SEED + 3);
        let guard = 0;
        while (set.size < Math.min(Q, best.qOf.length + 6) && guard++ < 500) set.add(Math.floor(R() * Q));
        rows = Array.from(set).sort((a, b) => a - b);
      }

      stage.innerHTML = '';
      const narrow = (stage.clientWidth || 900) < 640;
      const compact = state.rows === 'all';
      const IW = narrow ? 320 : 380, IH = Math.round(IW * imgH / imgW);
      const cw = narrow ? 40 : 46, rh = compact ? Math.max(3, Math.min(8, Math.floor(560 / Q))) : 24;
      const MX0 = narrow ? 44 : IW + 40 + 44, MY0 = (narrow ? IH + 64 : 0) + 74;           // origen de la matriz
      const W = Math.max(narrow ? IW + 16 : 0, MX0 + G * cw + 74), Hh = Math.max(narrow ? 0 : IH + 70, MY0 + rows.length * rh + 30);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px' + (narrow ? '' : ';min-width:' + Math.min(W, 640) + 'px'), role: 'group',
        'aria-label': 'Matching húngaro de DETR: imagen con ' + G + ' objetos y matriz de costos de ' + Q + ' queries por ' + G + ' objetos (' + VIEWS.find((v) => v[0] === state.view)[1] + ')' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };

      // ---- imagen con los G objetos (cajas de verdad) y las cajas de las filas mostradas
      const IX = 8, IY = 34;
      t(svg, IX, 16, narrow ? 'Imagen sintética: ' + G + ' objetos anotados' : 'Imagen (' + fmt.int(imgH) + '×' + fmt.int(imgW) + ', escena sintética): ' + G + ' objetos anotados', 'viz-t');
      t(svg, IX, 29, state.model === 'init' ? 'al inicio, las queries dan cajas parecidas cerca del centro' : 'sólidas: objetos · punteadas: queries de la tabla', 'viz-s');
      V.detScene(svg, IX, IY, IW, IH, objs);
      const px = (b) => { const r = B.xyxy(b); return { x: IX + r[0] * IW, y: IY + r[1] * IH, w: (r[2] - r[0]) * IW, h: (r[3] - r[1]) * IH }; };
      const predG = V.svg('g', { class: 'viz-hung-preds' }, svg);
      const shownRows = compact ? rows.filter((q) => shown.objOf[q] >= 0 || preds[q].role === 'dup') : rows;
      for (const q of shownRows) {
        const r = px(preds[q].box), m = shown.objOf[q] >= 0;
        const sel = state.cell && state.cell.q === q;
        V.svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'viz-hung-pbox' + (m ? ' is-m' : preds[q].role === 'dup' ? ' is-dup' : '') + (sel ? ' is-sel' : ''), 'data-q': q }, predG);
        if (!compact || m) t(predG, r.x + 2, r.y + r.h - 3, 'q' + q + (m ? '' : ' ∅'), 'viz-hung-plab' + (m ? ' is-m' : ''));
      }
      const tags = [];
      objs.forEach((o, j) => {
        const r = px(o.box), sel = state.cell && state.cell.j === j;
        V.svg('rect', { x: r.x, y: r.y, width: r.w, height: r.h, class: 'viz-hung-gbox' + (sel ? ' is-sel' : ''), 'data-j': j }, svg);
        const lab = 'g' + (j + 1) + ' ' + o.label, lw = lab.length * 6.4 + 6;
        // etiqueta arriba a la izquierda; si choca con otra (los dos coches), debajo de la caja
        const hit = (a) => tags.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
        let tg = { x: r.x, y: r.y - 13, w: lw, h: 13 };
        if (hit(tg)) tg = { x: r.x + r.w - lw, y: r.y + r.h, w: lw, h: 13 };
        tags.push(tg);
        V.svg('rect', { x: tg.x, y: tg.y, width: lw, height: 13, class: 'viz-hung-gtag' + (sel ? ' is-sel' : ''), 'data-j': j }, svg);
        t(svg, tg.x + 3, tg.y + 10, lab, 'viz-hung-gtxt');
      });

      // ---- matriz de costos Q×G (filas = queries, columnas = objetos)
      const VT = VIEWS.find((v) => v[0] === state.view);
      t(svg, MX0 - 40, MY0 - 58, 'Matriz de costos Q×G = ' + Q + '×' + G + ': ' + VT[1], 'viz-t');
      t(svg, MX0 - 40, MY0 - 44, state.view === 'total' ? 'λ = (' + lam.cls + ', ' + lam.l1 + ', ' + lam.giou + ') · más oscuro = menor costo' : (narrow ? 'sin ponderar (× λ = ' : 'término sin ponderar (en el costo: × λ = ') + lam[state.view] + ') · más oscuro = menor', 'viz-s');
      t(svg, MX0 - 40, MY0 - 30, state.rows === 'all' ? 'las ' + Q + ' filas (a la derecha, las ' + G + ' con pareja; el resto → ∅)' : rows.length + ' de las ' + Q + ' filas' + (narrow ? ' (con pareja, duplicados, otras)' : ': las emparejadas, los duplicados y algunas más'), 'viz-s');
      objs.forEach((o, j) => {
        const x = MX0 + j * cw + cw / 2;
        V.icon(svg, o.icon, x - 8, MY0 - 29, 16);
        t(svg, x, MY0 - 2, 'g' + (j + 1), 'viz-s', 'middle');
      });
      const vals = rows.map((q) => objs.map((_, j) => T[q][j][state.view]));
      const flat = vals.flat(), lo = Math.min(...flat), hi = Math.max(...flat);
      rows.forEach((q, ri) => {
        const y = MY0 + ri * rh;
        if (!compact || ri % 10 === 0) t(svg, MX0 - 6, y + rh / 2 + (compact ? 3 : 4), 'q' + q, 'viz-s', 'end');
        objs.forEach((o, j) => {
          const v = vals[ri][j], f = hi > lo ? (hi - v) / (hi - lo) : 0;
          const x = MX0 + j * cw, m = shown.qOf[j] === q;
          const g = V.svg('g', { class: 'viz-cell-btn' + (state.cell && state.cell.q === q && state.cell.j === j ? ' is-hl' : ''), tabindex: compact ? -1 : 0, role: 'img',
            'aria-label': 'Query ' + q + ' con objeto ' + (j + 1) + ' (' + o.label + '): costo ' + T[q][j].total.toFixed(2) + ' (clase ' + T[q][j].cls.toFixed(2) + ', L1 ' + T[q][j].l1.toFixed(2) + ', −GIoU ' + T[q][j].giou.toFixed(2) + ')' + (m ? ', emparejados' : '') }, svg);
          V.svg('rect', { x: x + 1, y: y + (compact ? 0 : 1), width: cw - 2, height: compact ? rh : rh - 2, rx: compact ? 0 : 2, class: 'viz-hung-cell', style: 'fill:color-mix(in srgb, var(--op-head) ' + Math.round(4 + 76 * f) + '%, var(--surface))' }, g);
          if (!compact) t(g, x + cw / 2, y + rh / 2 + 4, v.toFixed(2), 'viz-sim-v', 'middle');
          V.svg('rect', { x: x + 1, y: y + (compact ? 0 : 1), width: cw - 2, height: compact ? rh : rh - 2, rx: compact ? 0 : 2, class: m ? 'viz-hung-m' : 'viz-sim-hit' }, g);
          const show = () => { state.cell = { q, j }; readout(); hl(g); };
          g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
        });
        // destino del entrenamiento de esa query
        const jj = shown.objOf[q];
        if (!compact || jj >= 0) t(svg, MX0 + G * cw + 8, y + rh / 2 + (compact ? 3 : 4), jj >= 0 ? '→ g' + (jj + 1) : '∅', jj >= 0 ? 'viz-n' : 'viz-s');
      });
      function hl(cur) {
        svg.querySelectorAll('.viz-hung-pbox').forEach((r) => r.classList.toggle('is-sel', !!state.cell && +r.getAttribute('data-q') === state.cell.q));
        svg.querySelectorAll('.viz-hung-gbox, .viz-hung-gtag').forEach((r) => r.classList.toggle('is-sel', !!state.cell && +r.getAttribute('data-j') === state.cell.j));
        svg.querySelectorAll('.viz-cell-btn.is-hl').forEach((g) => g.classList.remove('is-hl'));
        if (cur) cur.classList.add('is-hl');
      }
      state.last = { T, best, shown, changed, preds };
      readout();
    }

    function readout() {
      out.innerHTML = '';
      const S = state.last; if (!S) return;
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('Q×G =', Q + '×' + G + ' = ' + fmt.int(Q * G) + ' costos');
      kv('parejas:', G + ' (una por objeto)');
      kv('→ ∅ (no object):', String(Q - G) + ' queries');
      kv('Σ C de la asignación =', S.shown.sum.toFixed(2) + (S.shown !== S.best ? ' (la óptima por costo total: ' + S.best.sum.toFixed(2) + ')' : ''));
      if (state.match === 'term' && state.view !== 'total') kv('parejas que cambian frente al costo total:', S.changed + ' de ' + G);
      const dups = S.preds.filter((p) => p.role === 'dup');
      if (dups.length && state.model === 'trained') kv('duplicados →', dups.map((p) => 'q' + p.q + (S.shown.objOf[p.q] >= 0 ? ' (emparejado)' : ' ∅')).join(', '));
      const cl = state.cell;
      if (cl) {
        const x = S.T[cl.q][cl.j];
        kv('q' + cl.q + ' · g' + (cl.j + 1) + ':', lam.cls + '·(' + x.cls.toFixed(2) + ') + ' + lam.l1 + '·' + x.l1.toFixed(2) + ' + ' + lam.giou + '·(' + x.giou.toFixed(2) + ') = ' + x.total.toFixed(2) + (S.shown.qOf[cl.j] === cl.q ? ' · emparejados' : ''));
      }
    }

    draw();
    let ro = null, lastNarrow = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 900) < 640; if (lastNarrow !== null && nar !== lastNarrow) draw(); lastNarrow = nar; });
      ro.observe(stage);
    }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('hungarian', render);
})(typeof window !== 'undefined' ? window : globalThis);
