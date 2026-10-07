/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/prompt-then-detect.js
   Visualización "prompt-then-detect" (SPEC §7.8, §16.3): dónde se paga el texto.
   YOLO-World codifica el vocabulario UNA vez, offline (V prompts → encoder de texto de CLIP → V×512), y esos
   embeddings quedan como pesos de la cabeza (re-parametrización): en cada imagen solo corre el detector.
   Grounding DINO pasa el texto por BERT y lo fusiona con la imagen (enhancer, selección de queries,
   decoder) EN CADA imagen: el texto es parte del forward.
   Barras = MACs por imagen de cada parte (del calculador: totals.byNode de yolo-world-l-640 y de
   grounding-dino-t, con el V elegido); a la derecha, el costo acumulado para N imágenes (offline + N·online).
   Los MACs no son latencia (memoria, NMS, kernels de atención deformable…): se dice en la nota.
   Grounding DINO se compara a resolución elegida (chips): por defecto grounding-dino-t-672 (≈ la escala de YOLO-World
   @ 640); la canónica 896×1344 y 448×448 también. Pantallas angostas (< 640 px): una columna, totales debajo.
   params: { yw:'yolo-world-l-640', gd:'grounding-dino-t' (base), gdRes:<config inicial>, V:80|1203, n:1|1000|1000000, mode:'reparam'|'online' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // Partes de cada modelo = ids de nodo de sus diagramas (SPEC §16); el calculador agrega byNode por id.
  const YW_PARTS = [
    { ids: ['backbone'], label: 'Backbone (YOLOv8-L)', cls: 'conv' },
    { ids: ['neck'], label: 'RepVL-PAN', cls: 'fuse' },
    { ids: ['head-box', 'head-text'], label: 'Cabezas', cls: 'head' },
  ];
  const GD_PARTS = [
    { ids: ['img-backbone', 'img-proj'], label: 'Swin-T + proyección', cls: 'attn' },
    { ids: ['txt-backbone', 'txt-proj'], label: 'BERT (texto)', cls: 'txt' },
    { ids: ['enhancer'], label: 'Feature enhancer', cls: 'fuse' },
    { ids: ['query-select', 'decoder', 'contrastive-head', 'box-head'], label: 'Selección + decoder + cabezas', cls: 'head' },
  ];
  const N_CHIPS = [1, 1000, 1000000];

  function byNode(run, id) { const b = run && run.totals && run.totals.byNode && run.totals.byNode[id]; return b ? b.macs || 0 : 0; }
  function partMacs(run, part) { return part.ids.reduce((s, id) => s + byNode(run, id), 0); }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt0 = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n) };
    // totales de millones de imágenes: fmt.si llega hasta T; más allá, P (10^15) y E (10^18)
    const fmt = Object.assign({}, fmt0, { si: (n) => (n >= 1e18 ? (n / 1e18).toFixed(2) + ' E' : n >= 1e15 ? (n / 1e15).toFixed(2) + ' P' : fmt0.si(n)) });
    const has = (id) => { try { return !!(A && (A.hasConfig ? A.hasConfig(id) : A.run(id))); } catch (e) { return false; } };
    const ywId = params.yw || 'yolo-world-l-640', gdBase = params.gd || 'grounding-dino-t';
    // Grounding DINO a varias escalas (mismos pesos): comparar por imagen solo tiene sentido a resolución parecida.
    // 672×672 ≈ la de YOLO-World-L @ 640 (por defecto); la canónica 896×1344 tiene 2.9× más píxeles; 448×448 ≈ sus MACs.
    const GD_CHIPS = [[gdBase + '-672', '672×672 (≈ misma resolución)'], [gdBase, '896×1344 (canónica)'], [gdBase + '-448', '448×448']].filter(([id]) => has(id));
    let yw0 = null;
    try { yw0 = A.run(ywId); } catch (e) { yw0 = null; }
    const V0 = (yw0 && yw0.config && yw0.config.V) || 80;
    const V_CHIPS = Array.from(new Set([V0, 1203])).sort((a, b) => a - b);
    const gdStart = GD_CHIPS.some(([id]) => id === params.gdRes) ? params.gdRes : (GD_CHIPS[0] ? GD_CHIPS[0][0] : gdBase);
    const state = { V: V_CHIPS.indexOf(+params.V) >= 0 ? +params.V : V0, n: N_CHIPS.indexOf(+params.n) >= 0 ? +params.n : 1000, mode: params.mode === 'online' ? 'online' : 'reparam', gd: gdStart };

    const wrap = V.html('div', { class: 'viz viz-ptd' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const gv = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Vocabulario V' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Vocabulario' }, gv);
    const bV = V_CHIPS.map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'V = ' + fmt.int(v) + (v === 80 ? ' (COCO)' : v === 1203 ? ' (LVIS)' : '') }, gv); b.addEventListener('click', () => { state.V = v; draw(); }); b._v = v; return b; });
    const gg = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Resolución de Grounding DINO' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Grounding DINO a' }, gg);
    const bG = GD_CHIPS.map(([id, l]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: l }, gg); b.addEventListener('click', () => { state.gd = id; draw(); }); b._v = id; return b; });
    const gn = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Imágenes' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Imágenes' }, gn);
    const bN = N_CHIPS.map((n) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'N = ' + fmt.int(n) }, gn); b.addEventListener('click', () => { state.n = n; draw(); }); b._v = n; return b; });
    const gm = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Texto de YOLO-World' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'YOLO-World' }, gm);
    const bM = [['reparam', 'vocabulario fijo (re-parametrizado)'], ['online', 'vocabulario nuevo en cada imagen']].map(([k, l]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: l }, gm); b.addEventListener('click', () => { state.mode = k; draw(); }); b._v = k; return b; });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const clipT = (yw0 && yw0.quantities && yw0.quantities.clipT) || 77;
    // cuántos píxeles más que YOLO-World procesa Grounding DINO a una resolución dada
    const pxRatio = (run) => { const a = run && run.config, b = yw0 && yw0.config; return a && b && a.H && b.H ? (a.H * a.W) / (b.H * b.W) : 1; };
    let gdCanon = null;
    try { gdCanon = A.run(gdBase); } catch (e) { gdCanon = null; }
    V.html('p', { class: 'viz-note' }, wrap, 'MACs del calculador (sin batch) para ' + ywId + ' (con el V elegido) y Grounding DINO-T a la resolución elegida (mismos pesos; por defecto 672×672, la escala de YOLO-World-L @ 640: la canónica 896×1344 tiene ' + pxRatio(gdCanon).toFixed(1) + '× más píxeles y mezclaría resolución con arquitectura). El texto de YOLO-World se paga una vez: V prompts por el encoder de texto de CLIP, y los V×512 embeddings quedan como pesos de la cabeza y de las max-sigmoid del neck. Ese costo offline usa ' + clipT + ' tokens por prompt, como Ultralytics; el repo oficial rellena solo hasta el prompt más largo (unos pocos tokens con nombres de clase): el costo real es varias veces menor. En Grounding DINO el texto entra al forward de cada imagen: BERT cuesta poco, pero la fusión imagen–texto del enhancer es una parte grande del total, y no se puede pre-calcular aparte. Los MACs no son latencia: la atención deformable, la NMS de YOLO-World y la memoria también cuentan; el paper de YOLO-World reporta 52.0 FPS para el modelo L re-parametrizado en una V100, sin TensorRT (Tabla 2).');

    let lastNarrow = null;
    function draw() {
      bV.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.V)));
      bG.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.gd)));
      bN.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.n)));
      bM.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.mode)));
      let yw = null, gd = null;
      try { yw = A.run(ywId, state.V !== V0 ? { V: state.V } : undefined); } catch (e) { yw = yw0; }
      try { gd = A.run(state.gd); } catch (e) { gd = null; }
      // costo del texto de YOLO-World: V prompts por el encoder de texto de CLIP (quantities.vocabTextMacs; en el
      // grafo el nodo txt-encoder vale 0 porque es offline)
      const textAll = (yw && yw.quantities && yw.quantities.vocabTextMacs) || 0;
      const ywParts = YW_PARTS.map((p) => ({ label: p.label, cls: p.cls, macs: partMacs(yw, p) }));
      if (state.mode === 'online') ywParts.push({ label: 'Encoder de texto (V prompts)', cls: 'txt', macs: textAll });
      const gdParts = GD_PARTS.map((p) => ({ label: p.label, cls: p.cls, macs: partMacs(gd, p) }));
      const ywImg = ywParts.reduce((a, p) => a + p.macs, 0), gdImg = gdParts.reduce((a, p) => a + p.macs, 0);
      const ywOff = state.mode === 'online' ? 0 : textAll;
      const ywTot = ywOff + state.n * ywImg, gdTot = state.n * gdImg;
      const maxImg = Math.max(ywImg, gdImg, 1);
      // nombre y resolución de cada fila, del label de la config ("Grounding DINO-T @ 672×672")
      const split = (run, dflt) => { const l = (run && run.label) || dflt; const i = l.indexOf(' @ '); return i > 0 ? [l.slice(0, i), '@ ' + l.slice(i + 3)] : [l, '']; };
      const [ywName, ywRes] = split(yw, 'YOLO-World'), [gdName, gdRes] = split(gd, 'Grounding DINO');

      const narrow = (stage.clientWidth || 900) < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      // ancho: dos columnas (barras | totales) o, en pantallas angostas, una sola (los totales debajo)
      const LX = narrow ? 6 : 10, BX = narrow ? 6 : 190, BW = narrow ? Math.max(270, Math.min(330, (stage.clientWidth || 320) - 16)) : 430;
      const rowH = narrow ? 58 : 50, nameH = narrow ? 30 : 0, Y0 = 44;
      const TX = narrow ? LX : BX + BW + 40, TW = narrow ? BW - 10 : 220;
      const yA = Y0 + 3 * rowH + (narrow ? 14 : 4);                // las dos líneas del texto de Grounding DINO
      const LY = yA + 30;                                            // leyenda de partes (2 filas en angosto)
      const TY = narrow ? LY + 2 * 16 + 34 : Y0;                     // origen del bloque de totales
      const Wd = narrow ? BX + BW + 8 : TX + TW + 16;
      const Hh = narrow ? TY + 6 + 2 * 62 + 40 : Y0 + 3 * rowH + 56;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + Wd + ' ' + Hh, style: 'max-width:' + Wd + 'px' + (narrow ? '' : ';min-width:' + Math.min(Wd, 640) + 'px'), role: 'group',
        'aria-label': 'MACs por imagen: ' + ywName + ' ' + ywRes + ' ' + fmt.si(ywImg) + ', ' + gdName + ' ' + gdRes + ' ' + fmt.si(gdImg) + '. Para ' + fmt.int(state.n) + ' imágenes: ' + fmt.si(ywTot) + ' frente a ' + fmt.si(gdTot) + '.' }, stage);
      t(svg, LX, 16, 'MACs por imagen (online), por parte', 'viz-t');
      t(svg, LX, 31, (narrow ? 'escala lineal: máx = ' : 'escala lineal: la barra más larga = ') + fmt.si(maxImg) + ' MACs', 'viz-s');
      // offline de YOLO-World
      const oy = Y0;
      V.svg('rect', { x: LX, y: oy, width: BX + BW - LX + (narrow ? 2 : 8), height: rowH - 8, rx: 4, class: 'ad-frame ad-frame--offline' }, svg);
      t(svg, LX + 8, oy + 15, 'OFFLINE · YOLO-World', 'viz-ptd-off');
      t(svg, narrow ? LX + 150 : LX + 8, narrow ? oy + 15 : oy + 29, 'V = ' + fmt.int(state.V) + ' prompts → CLIP', 'viz-s');
      const offY = narrow ? oy + 22 : oy + 8, offH = narrow ? rowH - 34 : rowH - 24, bx0 = narrow ? BX + 8 : BX, bw0 = narrow ? BW - 14 : BW;
      const offW = bw0 * Math.min(1, textAll / maxImg);
      V.svg('rect', { x: bx0, y: offY, width: Math.max(1, offW), height: offH, rx: 2, class: 'viz-ptd-bar viz-ptd--txt' + (state.mode === 'online' ? ' viz-ptd--ghost' : '') }, svg);
      const offTxt = fmt.si(textAll) + ' MACs' + (state.mode === 'online' ? ' → ahora en cada imagen' : ' · V×512 → pesos');
      // si la barra es larga, el número va dentro (alineado a la derecha) para no invadir la columna de totales
      if (offW > bw0 - offTxt.length * 6.8 - 12) t(svg, bx0 + Math.max(1, offW) - 6, offY + offH / 2 + 4, offTxt, 'viz-n', 'end');
      else t(svg, bx0 + Math.max(1, offW) + 6, offY + offH / 2 + 4, offTxt, 'viz-n');
      // filas online
      const rows = [[ywName + (narrow ? '' : ' (online)'), ywRes, ywParts, ywImg], [gdName, gdRes, gdParts, gdImg]];
      rows.forEach(([name, res, parts, tot], r) => {
        const y = Y0 + (r + 1) * rowH + 6;
        if (narrow) { t(svg, LX, y + 10, name + ' ' + res, 'viz-t'); t(svg, LX + BW, y + 10, fmt.si(tot) + ' MACs', 'viz-s', 'end'); }
        else { t(svg, LX, y + 10, name, 'viz-t'); t(svg, LX, y + 23, res, 'viz-s'); t(svg, LX, y + 36, fmt.si(tot) + ' MACs / imagen', 'viz-s'); }
        const by = narrow ? y + 16 : y + 2, bh = narrow ? rowH - 26 : rowH - 18;
        let x = BX;
        parts.forEach((p) => {
          const w = BW * p.macs / maxImg;
          if (w <= 0) return;
          const g = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': name + ' ' + res + ', ' + p.label + ': ' + fmt.int(p.macs) + ' MACs' }, svg);
          V.svg('rect', { x, y: by, width: Math.max(1, w - 1), height: bh, class: 'viz-ptd-bar viz-ptd--' + p.cls }, g);
          if (w > 58) t(g, x + 4, by + bh / 2 + 4, p.label.length * 6 > w - 8 ? p.label.slice(0, Math.max(3, Math.floor((w - 8) / 6) - 1)) + '…' : p.label, 'viz-ptd-lab');
          g.addEventListener('focus', () => pick(p, name)); g.addEventListener('pointerenter', () => pick(p, name));
          x += w;
        });
      });
      // el texto de Grounding DINO: BERT casi no se ve en la barra, pero la fusión con el texto (i2t + t2i del
      // enhancer) es una parte grande; las dos se pagan en CADA imagen
      const gdTxt = gdParts.find((p) => p.cls === 'txt');
      const fus = byNode(gd, 'i2t') + byNode(gd, 't2i');
      const pc = (x) => (100 * x / gdImg).toFixed(1) + ' %';
      if (gdTxt && gdImg) {
        t(svg, narrow ? LX : BX, yA, (narrow ? 'BERT: ' : 'BERT (texto): ') + fmt.si(gdTxt.macs) + ' MACs = ' + pc(gdTxt.macs) + ' · en cada imagen', 'viz-s');
        t(svg, narrow ? LX : BX, yA + 14, (narrow ? 'fusión con el texto: ' : 'fusión con el texto (enhancer): ') + fmt.si(fus) + ' = ' + pc(fus), 'viz-s');
      }
      // leyenda de partes
      const legY = LY;
      let lx = LX, ly = legY;
      [['conv', 'CNN'], ['attn', 'atención (imagen)'], ['txt', 'texto'], ['fuse', 'fusión imagen–texto'], ['head', 'cabezas / decoder']].forEach(([c, l]) => {
        const wd = 30 + l.length * 6.6;
        if (narrow && lx + wd > Wd) { lx = LX; ly += 16; }
        V.svg('rect', { x: lx, y: ly, width: 12, height: 10, class: 'viz-ptd-bar viz-ptd--' + c }, svg);
        t(svg, lx + 16, ly + 9, l, 'viz-s'); lx += wd;
      });
      // acumulado para N imágenes
      t(svg, TX, TY - (narrow ? 12 : 28), 'Total para N = ' + fmt.int(state.n), 'viz-t');
      t(svg, TX, TY - (narrow ? -2 : 13), 'offline + N · online', 'viz-s');
      const mx = Math.max(ywTot, gdTot, 1);
      const T0 = narrow ? TY + 6 : TY;
      [[ywName, ywTot, 'yw'], [gdName + ' ' + gdRes, gdTot, 'gd']].forEach(([n, v, k], i) => {
        const y = T0 + i * 62;
        t(svg, TX, y + 12, n, 'viz-n');
        V.svg('rect', { x: TX, y: y + 18, width: TW, height: 16, rx: 2, class: 'viz-zs-track' }, svg);
        V.svg('rect', { x: TX, y: y + 18, width: Math.max(1, TW * v / mx), height: 16, rx: 2, class: 'viz-ptd-tot viz-ptd-tot--' + k }, svg);
        t(svg, TX, y + 48, fmt.si(v) + ' MACs', 'viz-s');
      });
      const share = ywTot > 0 ? ywOff / ywTot : 0;
      // el texto de YOLO-World: 0 por imagen (offline, por diseño); amortizado, una fracción del total de N imágenes
      const pct = (x) => (x >= 0.1 ? x.toFixed(1) : x >= 0.001 ? x.toPrecision(2) : '< 0.001');
      const sx = TX, sy = narrow ? T0 + 2 * 62 + 6 : T0 + 140;
      if (state.mode === 'online') t(svg, sx, sy, 'texto: en cada imagen (sin re-param.)', 'viz-s');
      else {
        t(svg, sx, sy, 'texto: 0 % por imagen (offline)', 'viz-s');
        t(svg, sx, sy + 16, 'amortizado: ' + pct(100 * share) + ' % del total', 'viz-s');
      }

      out.innerHTML = '';
      const kv = (a, b) => { const sp = V.html('span', null, out); sp.innerHTML = a + ' <b>' + b + '</b>'; };
      const ratio = (r) => r.toFixed(r < 1 ? 2 : r < 10 ? 2 : 1);
      kv('por imagen:', ywName + ' ' + ywRes + ' ' + fmt.si(ywImg) + ' · ' + gdName + ' ' + gdRes + ' ' + fmt.si(gdImg) + (ywImg ? ' (Grounding DINO = ' + ratio(gdImg / ywImg) + '× YOLO-World' + (pxRatio(gd) > 1.3 ? ', con ' + pxRatio(gd).toFixed(1) + '× más píxeles' : '') + ')' : ''));
      kv('texto en Grounding DINO, por imagen:', 'BERT ' + pc(gdTxt ? gdTxt.macs : 0) + ' · fusión ' + pc(fus));
      kv('texto offline amortizado (YOLO-World):', fmt.si(ywOff / state.n) + ' MACs por imagen');
      kv('N = ' + fmt.int(state.n) + ':', fmt.si(ywTot) + ' frente a ' + fmt.si(gdTot));
      state.pickEl = V.html('span', null, out);
    }
    function pick(p, name) { if (state.pickEl) state.pickEl.innerHTML = name + ' · ' + p.label + ': <b>' + fmt.int(p.macs) + ' MACs</b>'; }
    function t(p, x, y, s, cls, anchor) { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; }

    draw();
    // redibuja si el ancho cruza el umbral (o si el primer dibujo se hizo sin ancho medido)
    let ro = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 900) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); });
      ro.observe(stage);
    }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('prompt-then-detect', render);
})(typeof window !== 'undefined' ? window : globalThis);
