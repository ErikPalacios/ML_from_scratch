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
   params: { yw:'yolo-world-l-640', gd:'grounding-dino-t', V:80|1203, n:1|1000|1000000, mode:'reparam'|'online' }
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
    const ywId = params.yw || 'yolo-world-l-640', gdId = params.gd || 'grounding-dino-t';
    let yw0 = null;
    try { yw0 = A.run(ywId); } catch (e) { yw0 = null; }
    const V0 = (yw0 && yw0.config && yw0.config.V) || 80;
    const V_CHIPS = Array.from(new Set([V0, 1203])).sort((a, b) => a - b);
    const state = { V: V_CHIPS.indexOf(+params.V) >= 0 ? +params.V : V0, n: N_CHIPS.indexOf(+params.n) >= 0 ? +params.n : 1000, mode: params.mode === 'online' ? 'online' : 'reparam' };

    const wrap = V.html('div', { class: 'viz viz-ptd' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const gv = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Vocabulario V' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Vocabulario' }, gv);
    const bV = V_CHIPS.map((v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'V = ' + fmt.int(v) + (v === 80 ? ' (COCO)' : v === 1203 ? ' (LVIS)' : '') }, gv); b.addEventListener('click', () => { state.V = v; draw(); }); b._v = v; return b; });
    const gn = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Imágenes' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Imágenes' }, gn);
    const bN = N_CHIPS.map((n) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'N = ' + fmt.int(n) }, gn); b.addEventListener('click', () => { state.n = n; draw(); }); b._v = n; return b; });
    const gm = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Texto de YOLO-World' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'YOLO-World' }, gm);
    const bM = [['reparam', 'vocabulario fijo (re-parametrizado)'], ['online', 'vocabulario nuevo en cada imagen']].map(([k, l]) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: l }, gm); b.addEventListener('click', () => { state.mode = k; draw(); }); b._v = k; return b; });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'MACs del calculador (sin batch) para ' + ywId + ' (con el V elegido) y ' + gdId + '. El texto de YOLO-World se paga una vez: V prompts por el encoder de texto de CLIP, y los V×512 embeddings quedan como pesos de la cabeza. En Grounding DINO el texto entra al forward de cada imagen (BERT, enhancer, selección y decoder lo usan), así que no se puede pre-calcular aparte. Los MACs no son latencia: la atención deformable, la NMS de YOLO-World y la memoria también cuentan; el paper de YOLO-World reporta 52 FPS en una V100 para el modelo L.');

    function draw() {
      bV.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.V)));
      bN.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.n)));
      bM.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.mode)));
      let yw = null, gd = null;
      try { yw = A.run(ywId, state.V !== V0 ? { V: state.V } : undefined); } catch (e) { yw = yw0; }
      try { gd = A.run(gdId); } catch (e) { gd = null; }
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

      stage.innerHTML = '';
      const LX = 10, BX = 190, BW = 430, rowH = 44, Y0 = 44;
      const TX = BX + BW + 40, TW = 220;
      const Wd = TX + TW + 16, Hh = Y0 + 3 * rowH + 44;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + Wd + ' ' + Hh, style: 'max-width:' + Wd + 'px;min-width:' + Math.min(Wd, 640) + 'px', role: 'group',
        'aria-label': 'MACs por imagen: YOLO-World ' + fmt.si(ywImg) + ', Grounding DINO ' + fmt.si(gdImg) + '. Para ' + fmt.int(state.n) + ' imágenes: ' + fmt.si(ywTot) + ' frente a ' + fmt.si(gdTot) + '.' }, stage);
      t(svg, LX, 16, 'MACs por imagen (online), por parte', 'viz-t');
      t(svg, LX, 31, 'escala lineal: la barra más larga = ' + fmt.si(maxImg) + ' MACs', 'viz-s');
      // offline de YOLO-World
      const oy = Y0;
      V.svg('rect', { x: LX, y: oy, width: BX + BW - LX + 8, height: rowH - 8, rx: 4, class: 'ad-frame ad-frame--offline' }, svg);
      t(svg, LX + 8, oy + 15, 'OFFLINE · YOLO-World', 'viz-ptd-off');
      t(svg, LX + 8, oy + 29, 'V = ' + fmt.int(state.V) + ' prompts → CLIP', 'viz-s');
      const offW = BW * Math.min(1, textAll / maxImg);
      V.svg('rect', { x: BX, y: oy + 8, width: Math.max(1, offW), height: rowH - 24, rx: 2, class: 'viz-ptd-bar viz-ptd--txt' + (state.mode === 'online' ? ' viz-ptd--ghost' : '') }, svg);
      const offTxt = fmt.si(textAll) + ' MACs' + (state.mode === 'online' ? ' → ahora en cada imagen' : ' · V×512 → pesos');
      // si la barra es larga, el número va dentro (alineado a la derecha) para no invadir la columna de totales
      if (offW > BW - offTxt.length * 6.8 - 12) t(svg, BX + Math.max(1, offW) - 6, oy + 24, offTxt, 'viz-n', 'end');
      else t(svg, BX + Math.max(1, offW) + 6, oy + 24, offTxt, 'viz-n');
      // filas online
      const rows = [['YOLO-World (online)', ywParts, ywImg], ['Grounding DINO', gdParts, gdImg]];
      rows.forEach(([name, parts, tot], r) => {
        const y = Y0 + (r + 1) * rowH + 6;
        t(svg, LX, y + 14, name, 'viz-t');
        t(svg, LX, y + 28, fmt.si(tot) + ' MACs / imagen', 'viz-s');
        let x = BX;
        parts.forEach((p) => {
          const w = BW * p.macs / maxImg;
          if (w <= 0) return;
          const g = V.svg('g', { class: 'viz-cell-btn', tabindex: 0, role: 'img', 'aria-label': name + ', ' + p.label + ': ' + fmt.int(p.macs) + ' MACs' }, svg);
          V.svg('rect', { x, y: y + 2, width: Math.max(1, w - 1), height: rowH - 18, class: 'viz-ptd-bar viz-ptd--' + p.cls }, g);
          if (w > 58) t(g, x + 4, y + 18, p.label.length * 6 > w - 8 ? p.label.slice(0, Math.max(3, Math.floor((w - 8) / 6) - 1)) + '…' : p.label, 'viz-ptd-lab');
          g.addEventListener('focus', () => pick(p, name)); g.addEventListener('pointerenter', () => pick(p, name));
          x += w;
        });
      });
      // el texto de Grounding DINO casi no se ve en la barra: se dice con números (y se paga en CADA imagen)
      const gdTxt = gdParts.find((p) => p.cls === 'txt');
      if (gdTxt && gdImg) t(svg, BX, Y0 + 3 * rowH + 2, 'BERT (texto): ' + fmt.si(gdTxt.macs) + ' MACs = ' + (100 * gdTxt.macs / gdImg).toFixed(1) + ' % — pero en cada imagen', 'viz-s');
      // leyenda de partes
      const LY = Y0 + 3 * rowH + 18;
      let lx = LX;
      [['conv', 'CNN'], ['attn', 'atención (imagen)'], ['txt', 'texto'], ['fuse', 'fusión imagen–texto'], ['head', 'cabezas / decoder']].forEach(([c, l]) => {
        V.svg('rect', { x: lx, y: LY, width: 12, height: 10, class: 'viz-ptd-bar viz-ptd--' + c }, svg);
        t(svg, lx + 16, LY + 9, l, 'viz-s'); lx += 30 + l.length * 6.6;
      });
      // acumulado para N imágenes
      t(svg, TX, 16, 'Total para N = ' + fmt.int(state.n), 'viz-t');
      t(svg, TX, 31, 'offline + N · online', 'viz-s');
      const mx = Math.max(ywTot, gdTot, 1);
      [['YOLO-World', ywTot, 'yw'], ['Grounding DINO', gdTot, 'gd']].forEach(([n, v, k], i) => {
        const y = Y0 + i * 62;
        t(svg, TX, y + 12, n, 'viz-n');
        V.svg('rect', { x: TX, y: y + 18, width: TW, height: 16, rx: 2, class: 'viz-zs-track' }, svg);
        V.svg('rect', { x: TX, y: y + 18, width: Math.max(1, TW * v / mx), height: 16, rx: 2, class: 'viz-ptd-tot viz-ptd-tot--' + k }, svg);
        t(svg, TX, y + 48, fmt.si(v) + ' MACs', 'viz-s');
      });
      const share = ywTot > 0 ? ywOff / ywTot : 0;
      // el texto de YOLO-World: 0 por imagen (offline, por diseño); amortizado, una fracción del total de N imágenes
      const pct = (x) => (x >= 0.1 ? x.toFixed(1) : x >= 0.001 ? x.toPrecision(2) : '< 0.001');
      if (state.mode === 'online') t(svg, TX, Y0 + 140, 'texto: en cada imagen (sin re-param.)', 'viz-s');
      else {
        t(svg, TX, Y0 + 140, 'texto: 0 % por imagen (offline)', 'viz-s');
        t(svg, TX, Y0 + 156, 'amortizado: ' + pct(100 * share) + ' % del total', 'viz-s');
      }

      out.innerHTML = '';
      const kv = (a, b) => { const sp = V.html('span', null, out); sp.innerHTML = a + ' <b>' + b + '</b>'; };
      kv('por imagen:', 'YOLO-World ' + fmt.si(ywImg) + ' · Grounding DINO ' + fmt.si(gdImg) + (ywImg ? ' (Grounding DINO = ' + (gdImg / ywImg).toFixed(gdImg / ywImg < 1 ? 2 : 1) + '× YOLO-World)' : ''));
      kv('texto offline amortizado:', fmt.si(ywOff / state.n) + ' MACs por imagen');
      kv('N = ' + fmt.int(state.n) + ':', fmt.si(ywTot) + ' frente a ' + fmt.si(gdTot));
      state.pickEl = V.html('span', null, out);
    }
    function pick(p, name) { if (state.pickEl) state.pickEl.innerHTML = name + ' · ' + p.label + ': <b>' + fmt.int(p.macs) + ' MACs</b>'; }
    function t(p, x, y, s, cls, anchor) { const e = V.svg('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; }

    draw();
    return { destroy() { wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('prompt-then-detect', render);
})(typeof window !== 'undefined' ? window : globalThis);
