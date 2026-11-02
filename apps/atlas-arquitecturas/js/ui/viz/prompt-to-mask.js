/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/prompt-to-mask.js
   Visualización "prompt-to-mask" (SPEC §7.8, §17.3): SAM como segmentación por prompt.
   Una escena sintética (casa, árbol, auto, sol; sin imágenes externas) con regiones anidadas
   (subparte ⊂ parte ⊂ objeto). Un punto es ambiguo: SAM devuelve 3 máscaras (subparte, parte, todo)
   con su IoU predicho y, si se pide una sola, la de mayor IoU predicho. Varios puntos (positivos y
   negativos) o una caja quitan la ambigüedad: SAM usa una sola salida (multimask_output = False).
   Lo NO ilustrativo: el costo. El encoder de imagen corre una vez por imagen; cada prompt solo paga el
   prompt encoder + el mask decoder (MACs del calculador, config sam-vit-h-1024 con P = tokens del prompt).
   Lo ilustrativo (etiquetado): la escena, las máscaras (regiones dibujadas a mano, no una red) y los IoU
   predichos (una regla simple: centralidad del punto en la región y nivel de la jerarquía).
   params: { config:'sam-vit-h-1024', tool:'pos'|'neg'|'box', preset:'puerta'|'rueda'|'dos'|'caja' }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  let uidN = 0;

  // ------------------------------------------------------------------ escena (unidades 0..1 de la imagen)
  const R = (x0, y0, x1, y1) => ({ t: 'rect', x0, y0, x1, y1 });
  const Cc = (cx, cy, r) => ({ t: 'circ', cx, cy, r });
  const Pg = (pts) => ({ t: 'poly', pts });
  const PR = {
    techo: Pg([[0.07, 0.37], [0.27, 0.17], [0.47, 0.37]]),
    pared: R(0.11, 0.37, 0.43, 0.69),
    puerta: R(0.21, 0.50, 0.30, 0.69),
    ventana: R(0.33, 0.43, 0.40, 0.51),
    copa: Cc(0.585, 0.37, 0.10),
    tronco: R(0.568, 0.45, 0.602, 0.67),
    carro: R(0.61, 0.72, 0.93, 0.83),
    cabina: Pg([[0.67, 0.72], [0.71, 0.63], [0.84, 0.63], [0.88, 0.72]]),
    vidrio: Pg([[0.725, 0.655], [0.828, 0.655], [0.852, 0.705], [0.708, 0.705]]),
    ruedaI: Cc(0.685, 0.835, 0.036),
    ruedaD: Cc(0.855, 0.835, 0.036),
    sol: Cc(0.86, 0.14, 0.06),
    cielo: R(0, 0, 1, 0.64),
    pasto: R(0, 0.64, 1, 1),
  };
  const OBJ = ['techo', 'pared', 'copa', 'tronco', 'carro', 'cabina', 'ruedaI', 'ruedaD', 'sol'];
  // Regiones = unión de primitivas (add) menos otras (sub). parent = la región que la contiene (jerarquía).
  const REG = {
    casa: { name: 'casa', add: ['techo', 'pared'] },
    techo: { name: 'techo', add: ['techo'], parent: 'casa' },
    pared: { name: 'fachada', add: ['pared'], parent: 'casa' },
    puerta: { name: 'puerta', add: ['puerta'], parent: 'pared' },
    ventana: { name: 'ventana', add: ['ventana'], parent: 'pared' },
    arbol: { name: 'árbol', add: ['copa', 'tronco'] },
    copa: { name: 'copa', add: ['copa'], parent: 'arbol' },
    tronco: { name: 'tronco', add: ['tronco'], parent: 'arbol' },
    auto: { name: 'auto', add: ['carro', 'cabina', 'ruedaI', 'ruedaD'] },
    carroceria: { name: 'carrocería', add: ['carro', 'cabina'], sub: ['ruedaI', 'ruedaD'], parent: 'auto' },
    vidrio: { name: 'ventanilla', add: ['vidrio'], parent: 'carroceria' },
    ruedaI: { name: 'rueda', add: ['ruedaI'], parent: 'auto' },
    ruedaD: { name: 'rueda', add: ['ruedaD'], parent: 'auto' },
    sol: { name: 'sol', add: ['sol'] },
    fondo: { name: 'fondo', add: ['cielo', 'pasto'], sub: OBJ },
    cielo: { name: 'cielo', add: ['cielo'], sub: OBJ, parent: 'fondo' },
    pasto: { name: 'pasto', add: ['pasto'], sub: OBJ, parent: 'fondo' },
  };
  // hoja = la región más profunda que contiene el punto (orden: las más chicas primero)
  const LEAVES = ['vidrio', 'puerta', 'ventana', 'ruedaI', 'ruedaD', 'techo', 'pared', 'copa', 'tronco', 'carroceria', 'sol', 'cielo', 'pasto'];
  const LEVEL = ['subparte', 'parte', 'objeto'];

  function inPrim(p, x, y) {
    if (p.t === 'rect') return x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1;
    if (p.t === 'circ') return (x - p.cx) * (x - p.cx) + (y - p.cy) * (y - p.cy) <= p.r * p.r;
    let c = false;
    const q = p.pts;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      if ((q[i][1] > y) !== (q[j][1] > y) && x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c;
    }
    return c;
  }
  const inReg = (id, x, y) => { const r = REG[id]; return r.add.some((k) => inPrim(PR[k], x, y)) && !(r.sub || []).some((k) => inPrim(PR[k], x, y)); };
  // rejilla de muestreo para áreas, centroides e IoU (G×G puntos)
  const G = 96;
  const cache = {};
  function stats(id) {
    if (cache[id]) return cache[id];
    let n = 0, sx = 0, sy = 0, x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    const bits = new Uint8Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = (i + 0.5) / G, y = (j + 0.5) / G;
      if (inReg(id, x, y)) { bits[j * G + i] = 1; n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return (cache[id] = { id, area: n / (G * G), cx: n ? sx / n : 0.5, cy: n ? sy / n : 0.5, bbox: [x0, y0, x1, y1], bits });
  }
  function iouBox(id, b) {
    const s = stats(id);
    let inter = 0, boxN = 0;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = (i + 0.5) / G, y = (j + 0.5) / G, inB = x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
      if (inB) boxN++;
      if (inB && s.bits[j * G + i]) inter++;
    }
    const u = s.area * G * G + boxN - inter;
    return u > 0 ? inter / u : 0;
  }
  const leafAt = (x, y) => LEAVES.find((id) => inReg(id, x, y)) || null;
  function chainOf(leaf) { const c = []; let r = leaf; while (r) { c.push(r); r = REG[r].parent; } return c; }
  const contains = (outer, inner) => { let r = inner; while (r) { if (r === outer) return true; r = REG[r].parent; } return false; };

  // IoU predicho (ILUSTRATIVO): una regla simple, no una red. Más alto si el punto cae cerca del centro de la
  // región (relativo a su tamaño) y un poco más alto para las regiones grandes; una salida repetida baja.
  function predIoU(id, x, y, lvl, dup) {
    const s = stats(id);
    const d = Math.hypot(x - s.cx, y - s.cy) / Math.max(0.03, Math.sqrt(s.area));
    const v = 0.78 + 0.05 * lvl + 0.12 * Math.max(0, 1 - d) - (dup ? 0.06 : 0);
    return Math.max(0.5, Math.min(0.99, v));
  }

  // ------------------------------------------------------------------ dibujo
  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n) };
    const cfgId = params.config || 'sam-vit-h-1024';
    const uid = 'vpm' + (++uidN);
    let base = null;
    try { base = A.run(cfgId); } catch (e) { base = null; }
    const cfg = (base && base.config) || {};
    const res = cfg.res || cfg.H || 1024;
    const state = { tool: ['pos', 'neg', 'box'].indexOf(params.tool) >= 0 ? params.tool : 'pos', pts: [], box: null, drag: null, cursor: [0.5, 0.5], boxStart: null, prompts: 0, decSum: 0 };
    // cada prompt evaluado suma SU costo de decoder (con sus tokens), no el del último × n
    function countPrompt() { state.prompts++; const d = decMacs(runP(Math.max(2, sparseCount()))); state.decSum += Number.isFinite(d) ? d : 0; }

    // Costo por prompt del calculador. Knob P = puntos (sin caja se agrega 1 de relleno: P + 1 tokens). Una caja son
    // 2 tokens (sus esquinas, sin relleno): mismo número de tokens que P = tokens − 1, y el decoder solo depende de eso.
    const runP = (tok) => { const P = Math.max(1, tok - 1); try { return A.run(cfgId, P !== (cfg.P || 0) ? { P } : undefined); } catch (e) { return base; } };
    const byNode = (r, id) => { const b = r && r.totals && r.totals.byNode && r.totals.byNode[id]; return b ? b.macs || 0 : 0; };
    const encMacs = (r) => byNode(r, 'img-encoder');   // el path img-encoder incluye el neck
    const decMacs = (r) => byNode(r, 'prompt-enc') + byNode(r, 'mask-decoder');
    const sparseCount = () => state.pts.length + (state.box ? 2 : 0) + (state.box || !state.pts.length ? 0 : 1);

    const wrap = V.html('div', { class: 'viz viz-p2m' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const gTool = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Herramienta' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Prompt' }, gTool);
    const bTool = [['pos', 'punto +'], ['neg', 'punto −'], ['box', 'caja']].map(([k, l]) => {
      const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: l }, gTool);
      b.addEventListener('click', () => { state.tool = k; state.boxStart = null; draw(); }); b._v = k; return b;
    });
    const clr = V.html('button', { type: 'button', class: 'viz-chip', text: 'limpiar' }, gTool);
    clr.addEventListener('click', () => { state.pts = []; state.box = null; state.boxStart = null; draw(); });
    const gEx = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Ejemplos' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Ejemplos' }, gEx);
    const PRESETS = {
      puerta: { label: 'un clic en la puerta', pts: [[0.255, 0.60, 1]] },
      rueda: { label: 'un clic en la rueda', pts: [[0.69, 0.835, 1]] },
      dos: { label: 'puerta + ventana', pts: [[0.255, 0.60, 1], [0.365, 0.47, 1]] },
      neg: { label: 'casa, sin el techo', pts: [[0.30, 0.45, 1], [0.27, 0.30, 0]] },
      caja: { label: 'caja: el auto', box: [0.60, 0.61, 0.94, 0.88] },
    };
    Object.keys(PRESETS).forEach((k) => {
      const b = V.html('button', { type: 'button', class: 'viz-chip', text: PRESETS[k].label }, gEx);
      b.addEventListener('click', () => preset(k));
    });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'Ilustrativo: la escena, las máscaras (regiones dibujadas a mano, no una red) y los IoU predichos (una regla simple). ' +
      'Lo que sí es de SAM: un punto es ambiguo (¿la puerta, la fachada o la casa?), así que el decoder tiene 3 tokens de máscara para 3 hipótesis (subparte, parte, objeto; el orden de las 3 no está fijado en el modelo) y una cabeza que predice el IoU de cada una; ' +
      'si hace falta una sola, se toma la de mayor IoU predicho. Con más de un punto o con una caja el prompt ya no es ambiguo y SAM usa el otro token de máscara (el primero de los 4), el de una sola máscara. ' +
      'Los MACs son del calculador (' + cfgId + '): el encoder de imagen corre una vez por imagen; cada prompt solo paga el prompt encoder y el decoder. El paper reporta ≈ 50 ms por prompt en CPU, en el navegador, con el embedding ya calculado.');

    function preset(k) {
      const p = PRESETS[k];
      state.pts = (p.pts || []).map((q) => ({ x: q[0], y: q[1], pos: !!q[2] }));
      state.box = p.box ? p.box.slice() : null;
      state.boxStart = null;
      countPrompt();
      draw();
    }

    // salidas: 3 máscaras (un punto) o una (varios puntos / caja)
    function outputs() {
      const P = state.pts, pos = P.filter((p) => p.pos), neg = P.filter((p) => !p.pos);
      if (!P.length && !state.box) return { multi: false, masks: [] };
      if (P.length === 1 && !state.box && pos.length === 1) {
        const leaf = leafAt(pos[0].x, pos[0].y);
        if (!leaf) return { multi: true, masks: [] };
        const ch = chainOf(leaf);
        // 3 hipótesis: subparte, parte, objeto (si la jerarquía es más corta, se repite la anterior)
        const pick = [ch[0], ch[Math.min(1, ch.length - 1)], ch[ch.length - 1]];
        const masks = pick.map((id, i) => ({ id, lvl: i, dup: i > 0 && id === pick[i - 1], iou: predIoU(id, pos[0].x, pos[0].y, i, i > 0 && id === pick[i - 1]) }));
        return { multi: true, masks };
      }
      // varios puntos y/o caja: una sola máscara
      let cands = Object.keys(REG).filter((id) => pos.every((p) => inReg(id, p.x, p.y)) && !neg.some((p) => inReg(id, p.x, p.y)));
      let best = null;
      if (state.box) {
        cands = cands.length ? cands : Object.keys(REG);
        let bi = -1;
        for (const id of cands) { const v = iouBox(id, state.box); if (v > bi) { bi = v; best = id; } }
        return { multi: false, masks: best ? [{ id: best, lvl: 0, iou: Math.max(0.5, Math.min(0.98, 0.55 + 0.42 * bi)), boxIoU: bi }] : [] };
      }
      cands.sort((a, b) => stats(a).area - stats(b).area);
      best = cands[0] || null;
      if (!best) return { multi: false, masks: [], none: true };
      const c = pos.reduce((s, p) => [s[0] + p.x / pos.length, s[1] + p.y / pos.length], [0, 0]);
      return { multi: false, masks: [{ id: best, lvl: 0, iou: Math.min(0.98, predIoU(best, c[0], c[1], 1, false) + 0.04) }] };
    }

    // escena en un <g> de 0..S px
    function scene(parent, S) {
      const g = V.svg('g', { class: 'viz-p2m-scene' }, parent);
      const prim = (p, cls) => {
        if (p.t === 'rect') return V.svg('rect', { x: r1(p.x0 * S), y: r1(p.y0 * S), width: r1((p.x1 - p.x0) * S), height: r1((p.y1 - p.y0) * S), class: cls }, g);
        if (p.t === 'circ') return V.svg('circle', { cx: r1(p.cx * S), cy: r1(p.cy * S), r: r1(p.r * S), class: cls }, g);
        return V.svg('polygon', { points: p.pts.map((q) => r1(q[0] * S) + ',' + r1(q[1] * S)).join(' '), class: cls }, g);
      };
      prim(PR.cielo, 'viz-p2m-sky'); prim(PR.pasto, 'viz-p2m-grass'); prim(PR.sol, 'viz-p2m-sun');
      prim(PR.pared, 'viz-p2m-wall'); prim(PR.techo, 'viz-p2m-roof'); prim(PR.puerta, 'viz-p2m-door'); prim(PR.ventana, 'viz-p2m-glass');
      prim(PR.tronco, 'viz-p2m-trunk'); prim(PR.copa, 'viz-p2m-leaf');
      prim(PR.cabina, 'viz-p2m-car'); prim(PR.carro, 'viz-p2m-car'); prim(PR.vidrio, 'viz-p2m-glass'); prim(PR.ruedaI, 'viz-p2m-wheel'); prim(PR.ruedaD, 'viz-p2m-wheel');
      return g;
    }
    // máscara SVG de una región (blanco = dentro), en px de un lienzo de lado S
    function maskDef(defs, id, S, key) {
      const m = V.svg('mask', { id: key, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: S, height: S }, defs);
      const put = (p, fill) => {
        if (p.t === 'rect') V.svg('rect', { x: r1(p.x0 * S), y: r1(p.y0 * S), width: r1((p.x1 - p.x0) * S), height: r1((p.y1 - p.y0) * S), fill }, m);
        else if (p.t === 'circ') V.svg('circle', { cx: r1(p.cx * S), cy: r1(p.cy * S), r: r1(p.r * S), fill }, m);
        else V.svg('polygon', { points: p.pts.map((q) => r1(q[0] * S) + ',' + r1(q[1] * S)).join(' '), fill }, m);
      };
      REG[id].add.forEach((k) => put(PR[k], '#fff'));
      (REG[id].sub || []).forEach((k) => put(PR[k], '#000'));
      return key;
    }
    function inverseMaskDef(defs, id, S, key) {
      const m = V.svg('mask', { id: key, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: S, height: S }, defs);
      V.svg('rect', { x: 0, y: 0, width: S, height: S, fill: '#fff' }, m);
      const inner = V.svg('g', null, m);
      const put = (p, fill) => {
        if (p.t === 'rect') V.svg('rect', { x: r1(p.x0 * S), y: r1(p.y0 * S), width: r1((p.x1 - p.x0) * S), height: r1((p.y1 - p.y0) * S), fill }, inner);
        else if (p.t === 'circ') V.svg('circle', { cx: r1(p.cx * S), cy: r1(p.cy * S), r: r1(p.r * S), fill }, inner);
        else V.svg('polygon', { points: p.pts.map((q) => r1(q[0] * S) + ',' + r1(q[1] * S)).join(' '), fill }, inner);
      };
      REG[id].add.forEach((k) => put(PR[k], '#000'));
      (REG[id].sub || []).forEach((k) => put(PR[k], '#fff'));
      return key;
    }
    // máscara = resto de la imagen atenuado + región teñida + contorno (filtro: dilatar el alfa y quitar el
    // interior; se aplica al grupo, o sea DESPUÉS de la máscara SVG)
    function overlay(parent, defs, id, S, key, strong) {
      const mk = maskDef(defs, id, S, key + '-m'), inv = inverseMaskDef(defs, id, S, key + '-i');
      V.svg('rect', { x: 0, y: 0, width: S, height: S, class: 'viz-p2m-dim', mask: 'url(#' + inv + ')' }, parent);
      const f = V.svg('filter', { id: key + '-f', x: '-5%', y: '-5%', width: '110%', height: '110%', 'color-interpolation-filters': 'sRGB' }, defs);
      V.svg('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: strong ? 2 : 1.4, result: 'd' }, f);
      V.svg('feComposite', { in: 'd', in2: 'SourceAlpha', operator: 'out', result: 'ring' }, f);
      V.svg('feFlood', { class: 'viz-p2m-flood' }, f);
      V.svg('feComposite', { in2: 'ring', operator: 'in', result: 'rc' }, f);
      const mg = V.svg('feMerge', null, f);
      V.svg('feMergeNode', { in: 'SourceGraphic' }, mg); V.svg('feMergeNode', { in: 'rc' }, mg);
      const g = V.svg('g', { filter: 'url(#' + key + '-f)' }, parent);
      V.svg('rect', { x: 0, y: 0, width: S, height: S, class: 'viz-p2m-mask' + (strong ? ' is-strong' : ''), mask: 'url(#' + mk + ')' }, g);
    }
    function drawPrompts(parent, S) {
      if (state.box) V.svg('rect', { x: r1(state.box[0] * S), y: r1(state.box[1] * S), width: r1((state.box[2] - state.box[0]) * S), height: r1((state.box[3] - state.box[1]) * S), class: 'viz-p2m-box' }, parent);
      for (const p of state.pts) {
        const g = V.svg('g', { class: 'viz-p2m-pt ' + (p.pos ? 'is-pos' : 'is-neg'), transform: 'translate(' + r1(p.x * S) + ',' + r1(p.y * S) + ')' }, parent);
        V.svg('circle', { r: 6.5 }, g);
        V.svg('path', { d: p.pos ? 'M-3.5 0H3.5M0 -3.5V3.5' : 'M-3.5 0H3.5' }, g);
      }
    }

    let lastNarrow = null;
    function draw() {
      bTool.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.tool)));
      const o = outputs();
      const cw = stage.clientWidth || 860;
      const narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const S = narrow ? Math.min(300, cw - 16) : 300;           // lado de la escena
      const TS = narrow ? Math.floor((Math.min(cw, 360) - 16 - 2 * 10) / 3) : 116;   // miniaturas
      const X0 = 8, Y0 = 34;
      const MX = narrow ? X0 : X0 + S + 34, MY = narrow ? Y0 + S + 64 : Y0 + 18;
      const cardH = TS + 52;
      const costY = narrow ? MY + cardH + 30 : MY + cardH + 34;
      const W = narrow ? Math.max(S, 3 * TS + 20) + 16 : MX + 3 * TS + 2 * 14 + 8;
      const Hh = narrow ? costY + 132 : Math.max(Y0 + S + 26, costY + 120);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'group', 'aria-label': ariaText(o) }, stage);
      const defs = V.svg('defs', null, svg);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, X0, 16, 'Imagen (' + res + '×' + res + ' tras el resize) y prompts', 'viz-t');
      t(svg, X0, 29, state.tool === 'box' ? (state.boxStart ? 'caja: falta la esquina opuesta' : 'caja: toca dos esquinas (o arrastra)') : state.tool === 'pos' ? 'toca: punto positivo (+)' : 'toca: punto negativo (−, "esto no")', 'viz-s');
      // escena + máscara elegida
      const sc = V.svg('g', { transform: 'translate(' + X0 + ',' + Y0 + ')' }, svg);
      const cp = V.svg('clipPath', { id: uid + '-cp' }, defs);
      V.svg('rect', { x: 0, y: 0, width: S, height: S }, cp);
      const scG = V.svg('g', { 'clip-path': 'url(#' + uid + '-cp)' }, sc);
      scene(scG, S);
      // IoU con 3 decimales cuando dos máscaras distintas empatan a 2 (si no, "0.89 vs 0.89" y gana una)
      const fIou = (m) => (o.masks.some((x) => x !== m && x.iou !== m.iou && x.iou.toFixed(2) === m.iou.toFixed(2)) ? m.iou.toFixed(3) : m.iou.toFixed(2));
      const bestI = o.masks.length ? o.masks.reduce((bi, m, i) => (m.iou > o.masks[bi].iou ? i : bi), 0) : -1;
      const ovG = V.svg('g', null, scG);
      drawPrompts(scG, S);
      if (state.boxStart) V.svg('circle', { cx: r1(state.boxStart[0] * S), cy: r1(state.boxStart[1] * S), r: 3.5, class: 'viz-p2m-corner' }, scG);
      if (state.kbd) V.svg('path', { d: 'M' + r1(state.cursor[0] * S - 8) + ' ' + r1(state.cursor[1] * S) + 'h16M' + r1(state.cursor[0] * S) + ' ' + r1(state.cursor[1] * S - 8) + 'v16', class: 'viz-p2m-cursor' }, scG);
      V.svg('rect', { x: 0, y: 0, width: S, height: S, class: 'viz-det-frame' }, sc);
      const hit = V.svg('rect', { x: 0, y: 0, width: S, height: S, class: 'viz-p2m-hit', tabindex: 0, role: 'button', 'aria-label': 'Escena: toca para poner un prompt; con el teclado, flechas para mover la mira y Enter para ponerlo' }, sc);
      wireHit(hit);
      const capT = t(svg, X0, Y0 + S + 16, '', 'viz-s');
      // qué máscara se ve sobre la imagen: la de mayor IoU predicho, o la tarjeta bajo el puntero / con foco
      // (solo se rehace la capa de la máscara: rehacer todo cambiaría el foco y dispararía más eventos)
      const showMask = (i) => {
        const k = i != null && o.masks[i] ? i : bestI;
        ovG.innerHTML = '';
        defs.querySelectorAll('[id^="' + uid + '-main"]').forEach((x) => x.remove());
        if (k >= 0) overlay(ovG, defs, o.masks[k].id, S, uid + '-main', true);
        capT.textContent = k >= 0 ? 'en la imagen: ' + (k === bestI ? 'la de mayor IoU predicho' : 'la máscara ' + (k + 1)) + ' (' + REG[o.masks[k].id].name + ')' : '';
      };
      showMask(null);
      // salidas
      t(svg, MX, MY - 22, o.multi ? 'Salida: 3 máscaras + IoU predicho' : o.masks.length ? 'Salida: 1 máscara (el token de una sola)' : 'Salida', 'viz-t');
      t(svg, MX, MY - 8, o.multi ? 'un punto es ambiguo: subparte · parte · objeto' : o.masks.length ? 'el prompt ya no es ambiguo: multimask_output = False' : 'pon un punto o una caja', 'viz-s');
      const slots = o.multi ? [0, 1, 2] : [0];
      for (let i = 0; i < 3; i++) {
        const x = MX + i * (TS + (narrow ? 10 : 14)), y = MY;
        const m = o.masks[i];
        const active = slots.indexOf(i) >= 0 && m;
        const card = V.svg('g', { class: 'viz-cell-btn viz-p2m-card' + (active ? '' : ' is-off') + (i === bestI ? ' is-best' : ''), transform: 'translate(' + r1(x) + ',' + r1(y) + ')', tabindex: active ? 0 : -1, role: active ? 'button' : 'img',
          'aria-label': active ? 'Máscara ' + (i + 1) + ': ' + REG[m.id].name + (o.multi ? ' (' + LEVEL[i] + ')' : '') + ', IoU predicho ' + fIou(m) + (i === bestI ? ', la mejor' : '') : 'Salida ' + (i + 1) + ' sin usar' }, svg);
        const cpi = V.svg('clipPath', { id: uid + '-c' + i }, defs);
        V.svg('rect', { x: 0, y: 0, width: TS, height: TS }, cpi);
        const tg = V.svg('g', { 'clip-path': 'url(#' + uid + '-c' + i + ')' }, card);
        if (active) { scene(tg, TS); overlay(tg, defs, m.id, TS, uid + '-t' + i, false); }
        else V.svg('rect', { x: 0, y: 0, width: TS, height: TS, class: 'viz-p2m-empty' }, tg);
        V.svg('rect', { x: 0, y: 0, width: TS, height: TS, class: 'viz-p2m-frame' }, card);
        if (i === bestI) V.svg('rect', { x: -3, y: -3, width: TS + 6, height: TS + 6, rx: 3, class: 'viz-p2m-best' }, card);
        if (active) {
          t(card, 0, TS + 15, (o.multi && !narrow ? LEVEL[i] + ': ' : '') + REG[m.id].name, 'viz-n');
          const bw = TS * m.iou;
          V.svg('rect', { x: 0, y: TS + 22, width: TS, height: 8, rx: 2, class: 'viz-zs-track' }, card);
          V.svg('rect', { x: 0, y: TS + 22, width: r1(bw), height: 8, rx: 2, class: 'viz-p2m-iou' + (i === bestI ? ' is-best' : '') }, card);
          t(card, 0, TS + 44, (m.dup || narrow ? 'IoU ' : 'IoU pred. ') + fIou(m) + (m.dup ? ' · igual' : ''), i === bestI && o.multi ? 'viz-n' : 'viz-s');
          card.addEventListener('pointerenter', () => showMask(i));
          card.addEventListener('pointerleave', () => showMask(null));
          card.addEventListener('focus', () => showMask(i));
          card.addEventListener('blur', () => showMask(null));
        } else t(card, 0, TS + 15, o.multi || !o.masks.length ? '—' : 'no se usa', 'viz-s');
      }
      if (o.none) t(svg, MX, MY + cardH + 4, 'ninguna región de la escena cumple todos los puntos', 'viz-s');
      // costo: encoder una vez, decoder por prompt
      drawCost(svg, t, narrow ? X0 : MX, costY, narrow ? W - 16 : 3 * TS + 28, narrow);
      readout(o);
    }
    function drawCost(svg, t, x, y, w, narrow) {
      const P = Math.max(2, sparseCount());
      const rp = runP(P);
      const enc = encMacs(base), dec = decMacs(rp), n = Math.max(1, state.prompts);
      const decTot = state.decSum > 0 ? state.decSum : n * dec;
      t(svg, x, y, narrow ? 'Costo (del calculador)' : 'Costo (del calculador): el encoder una vez, el decoder por prompt', 'viz-t');
      if (!enc) { t(svg, x, y + 16, 'calculador sin datos de ' + cfgId, 'viz-s'); return; }
      const tot = enc + decTot;
      const bar = (yy, v, cls, lab) => {
        V.svg('rect', { x, y: yy, width: w, height: 14, rx: 2, class: 'viz-zs-track' }, svg);
        V.svg('rect', { x, y: yy, width: Math.max(1.5, r1(w * v / tot)), height: 14, rx: 2, class: cls }, svg);
        t(svg, x, yy + 27, lab, 'viz-s');
      };
      bar(y + 10, enc, 'viz-p2m-enc', (narrow ? 'encoder + neck: ' : 'encoder de imagen + neck: ') + fmt.si(enc) + ' MACs · una vez' + (narrow ? '' : ' por imagen'));
      bar(y + 48, decTot, 'viz-p2m-dec', narrow ? n + ' × decoder: ' + fmt.si(decTot) + ' MACs' : n + ' prompt' + (n === 1 ? '' : 's') + ' × decoder (cada uno con sus tokens; el último, ' + P + '): ' + fmt.si(decTot) + ' MACs');
      t(svg, x, y + 98, (narrow ? '1 prompt = ' : 'un prompt cuesta ') + fmt.si(dec) + ' MACs = 1/' + fmt.int(Math.round(enc / Math.max(1, dec))) + ' del encoder', 'viz-n');
    }

    function readout(o) {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const P = sparseCount();
      kv('prompts en la escena:', state.pts.filter((p) => p.pos).length + ' +, ' + state.pts.filter((p) => !p.pos).length + ' −' + (state.box ? ', 1 caja' : ''));
      if (P) {
        const rp = runP(P);
        const tk = rp && rp.tensors && rp.tensors.tokens;
        kv('tokens del decoder:', (tk ? A.fmt.shape(tk, 'num') : (5 + P) + '×256') + ' (4 de máscara + 1 de IoU + ' + P + ' del prompt' + (state.box || !state.pts.length ? '' : ', con 1 de relleno') + ')');
      }
      if (o.masks.length) kv(o.multi ? 'la de mayor IoU predicho:' : 'máscara:', REG[o.masks.reduce((b, m) => (m.iou > b.iou ? m : b)).id].name);
      kv('prompts evaluados (con la misma imagen):', String(Math.max(0, state.prompts)));
    }
    function ariaText(o) {
      if (!o.masks.length) return 'Escena sintética sin prompts.';
      return 'Prompt: ' + state.pts.length + ' puntos' + (state.box ? ' y una caja' : '') + '. Salida: ' + o.masks.map((m, i) => REG[m.id].name + ' (IoU predicho ' + m.iou.toFixed(2) + ')').join(', ') + '.';
    }

    // ---- interacción: toque / clic / arrastre (caja) y teclado
    function wireHit(hit) {
      const loc = (ev) => { const r = hit.getBoundingClientRect(); return r.width ? [clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height)] : null; };
      hit.addEventListener('pointerdown', (ev) => { if (state.tool !== 'box') return; const p = loc(ev); if (!p) return; state.drag = { a: p, b: p }; try { hit.setPointerCapture(ev.pointerId); } catch (e) { /* sin captura */ } });
      hit.addEventListener('pointermove', (ev) => { if (!state.drag) return; const p = loc(ev); if (p) state.drag.b = p; });
      hit.addEventListener('pointerup', (ev) => {
        const p = loc(ev); if (!p) return;
        state.kbd = false;
        if (state.tool === 'box') {
          const d = state.drag; state.drag = null;
          if (d && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 0.04) { setBox(d.a, d.b); return; }
          place(p); return;
        }
        place(p);
      });
      hit.addEventListener('keydown', (ev) => {
        const k = ev.key;
        const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        if (dx || dy) { ev.preventDefault(); state.kbd = true; state.cursor = [clamp01(state.cursor[0] + 0.03 * dx), clamp01(state.cursor[1] + 0.03 * dy)]; draw(); focusHit(); return; }
        if (k === 'Enter' || k === ' ') { ev.preventDefault(); state.kbd = true; place(state.cursor.slice()); focusHit(); }
      });
    }
    function focusHit() { const h = stage.querySelector('.viz-p2m-hit'); if (h) h.focus({ preventScroll: true }); }
    function setBox(a, b) { state.box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; state.boxStart = null; countPrompt(); draw(); }
    function place(p) {
      if (state.tool === 'box') {
        if (!state.boxStart) { state.boxStart = p; draw(); return; }
        setBox(state.boxStart, p); return;
      }
      // los puntos se acumulan (con la caja, si la hay): más de un prompt = una sola máscara; "limpiar" vuelve a empezar
      state.pts.push({ x: p[0], y: p[1], pos: state.tool === 'pos' });
      countPrompt();
      draw();
    }

    if (params.preset && PRESETS[params.preset]) preset(params.preset); else preset('puerta');
    let ro = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); });
      ro.observe(stage);
    }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  if (ATLAS.Viz) ATLAS.Viz.register('prompt-to-mask', render);
})(typeof window !== 'undefined' ? window : globalThis);
