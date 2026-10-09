/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/pi0-mask.js
   Visualización "pi0-mask" (SPEC §7.8, §21.4): la máscara de atención por bloques de π0 (Black et al. 2024,
   arXiv:2410.24164; openpi: make_attn_mask con ar_mask). Tres bloques en orden: [imágenes + lenguaje] (el prefijo,
   bidireccional entre sí), [estado] y [acciones] (bidireccional entre las H acciones). Cada bloque ve su propio bloque
   y los anteriores, nunca los siguientes: el prefijo no ve al robot ni a las acciones ruidosas (así su KV no cambia
   entre pasos de flujo y se calcula UNA vez), el estado no ve las acciones.
   Fila = query, columna = key. Cada grupo se dibuja con pocas celdas (ilustrativo); su número real de tokens, del
   calculador (config pi0: cámaras × tokens por imagen, T de lenguaje, H_a acciones = cfg.Ha), va en la etiqueta.
   Interacción: pasar el cursor o enfocar un grupo (o una celda) muestra a qué atiende; "Máscara" compara con una causal
   de LLM (las acciones no verían las de después); "Paso de flujo" marca qué se recalcula en cada uno de los pasos de
   Euler (las filas del sufijo) y qué sale del caché (las columnas del prefijo).
   params: { config:'pi0', mode:'pi0'|'causal', step:false }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','), ops: (n) => String(n) };
    const cfgId = params.config || 'pi0';
    let run = null, m = null;
    try { run = A.run(cfgId); } catch (e) { run = null; }
    try { m = A.metrics(cfgId); } catch (e) { m = null; }
    const pickN = (...ks) => { for (const k of ks) { const parts = k.split('.'); const src = parts[0] === 'cfg' ? run && run.config : m; const v = src ? src[parts[1]] : undefined; if (Number.isFinite(v)) return v; } return null; };
    const cams = pickN('cfg.cams', 'metrics.cams') || 3;
    const perImg = pickN('metrics.visualTokensPerImage', 'metrics.tokensPerImage', 'cfg.imgTokens', 'cfg.Np') || 256;
    const T = pickN('cfg.T', 'metrics.textTokens') || 48;
    // el chunk es cfg.Ha (metrics.chunk); cfg.H es el ALTO de la imagen (224)
    const H = pickN('cfg.Ha', 'metrics.chunk') || 50;
    const steps = pickN('cfg.steps', 'metrics.steps') || 10;
    const prefixN = pickN('metrics.prefixTokens') || cams * perImg + T;
    const suffixN = pickN('metrics.suffixTokens') || 1 + H;
    const fromCalc = !!(run && m);
    // grupos: id, etiqueta, bloque (0 = prefijo, 1 = estado, 2 = acciones), celdas dibujadas, tokens reales
    const groups = [];
    for (let c = 0; c < cams; c++) groups.push({ id: 'img' + c, short: 'img ' + (c + 1), label: 'imagen ' + (c + 1), block: 0, cells: 3, n: perImg, cls: 'is-img' });
    groups.push({ id: 'lang', short: 'texto', label: 'lenguaje', block: 0, cells: 3, n: T, cls: 'is-txt' });
    groups.push({ id: 'state', short: 's', label: 'estado del robot', block: 1, cells: 1, n: 1, cls: 'is-state' });
    groups.push({ id: 'act', short: 'acciones', label: 'acciones (ruidosas)', block: 2, cells: 5, n: H, cls: 'is-act' });
    const cells = [];
    groups.forEach((g, gi) => { g.start = cells.length; for (let i = 0; i < g.cells; i++) cells.push({ g: gi, i }); });
    const state = { mode: params.mode === 'causal' ? 'causal' : 'pi0', step: !!params.step, focus: groups.length - 1, cell: null };
    const BLOCK_NAMES = ['prefijo (imágenes + lenguaje)', 'estado', 'acciones'];
    const allowed = (ri, ci) => {
      const r = cells[ri], c = cells[ci];
      if (state.mode === 'causal') return ci <= ri;
      return groups[c.g].block <= groups[r.g].block;
    };

    const wrap = V.html('div', { class: 'viz viz-pm' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const btns = [];
    const chip = (g, label, on, fn) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label }, g); b.addEventListener('click', fn); b._on = on; btns.push(b); };
    const gM = grp('Máscara');
    chip(gM, 'π0 (por bloques)', () => state.mode === 'pi0', () => { state.mode = 'pi0'; draw(); });
    chip(gM, 'causal (como un LLM)', () => state.mode === 'causal', () => { state.mode = 'causal'; draw(); });
    const gS = grp('Vista');
    chip(gS, 'qué ve cada grupo', () => !state.step, () => { state.step = false; draw(); });
    chip(gS, 'un paso de flujo (con caché)', () => state.step, () => { state.step = true; draw(); });
    const stage = V.html('div', { class: 'viz-stage viz-pm-stage', tabindex: 0, role: 'group', 'aria-label': 'Máscara de atención de π0. Flechas arriba y abajo: grupo de queries' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      btns.forEach((b) => b.setAttribute('aria-pressed', String(b._on())));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const n = cells.length, cs = narrow ? 11 : 17;
      const lw = narrow ? 64 : 150;                    // etiquetas de fila
      const gx = lw + 10, gy = narrow ? 80 : 92;
      const sideW = narrow ? 0 : 300;
      const W = narrow ? Math.max(280, Math.min(460, cw)) : Math.max(gx + n * cs + 40 + sideW, 720);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'group', 'aria-label': 'Máscara ' + (state.mode === 'pi0' ? 'por bloques de π0' : 'causal') + ' sobre ' + groups.map((g) => g.label).join(', ') }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      t(svg, 8, 15, state.mode === 'pi0' ? 'Máscara por bloques de π0' : 'Si fuera causal (como un LLM)', 'viz-t');
      t(svg, 8, 29, narrow ? 'fila = query · columna = key' : 'fila = query (quién mira) · columna = key (a quién puede mirar) · pocas celdas por grupo (ilustrativo)', 'viz-s');
      const fg = groups[state.focus];
      // corchetes de los grupos arriba (columnas)
      groups.forEach((g) => {
        const x0 = gx + g.start * cs, x1 = x0 + g.cells * cs;
        V.svg('path', { d: 'M' + r1(x0 + 1) + ' ' + (gy - 4) + 'V' + (gy - 8) + 'H' + r1(x1 - 1) + 'V' + (gy - 4), class: 'viz-pm-brace' }, svg);
        const lab = narrow ? (g.block === 0 && g.id !== 'lang' ? 'i' + (g.start / 3 + 1) : g.id === 'lang' ? 'T' : g.id === 'state' ? 's' : 'a') : g.short;
        t(svg, (x0 + x1) / 2, gy - 12, lab, 'viz-s', 'middle');
      });
      // bloques (0, 1, 2) arriba del todo
      [0, 1, 2].forEach((b) => {
        const gs = groups.filter((g) => g.block === b), x0 = gx + gs[0].start * cs, x1 = gx + (gs[gs.length - 1].start + gs[gs.length - 1].cells) * cs;
        V.svg('rect', { x: r1(x0), y: gy - 30, width: r1(x1 - x0), height: 4, rx: 2, class: 'viz-pm-blk is-b' + b }, svg);
        t(svg, b === 0 ? x0 : b === 1 ? (x0 + x1) / 2 : x1, gy - 34, narrow ? 'B' + (b + 1) : ['B1 prefijo', 'B2', 'B3 acciones'][b], 'viz-n', b === 0 ? null : b === 1 ? 'middle' : 'end');
      });
      // celdas
      const ri = state.cell ? state.cell[0] : null;
      for (let r = 0; r < n; r++) {
        const rg = groups[cells[r].g];
        for (let c = 0; c < n; c++) {
          const ok = allowed(r, c), cg = groups[cells[c].g];
          const x = gx + c * cs, y = gy + r * cs;
          const lit = cells[r].g === state.focus;
          const cached = state.step && cg.block === 0;           // columnas del prefijo: K, V del caché
          const frozenRow = state.step && rg.block === 0;          // filas del prefijo: no se recalculan en el paso
          const cls = 'viz-pm-cell ' + (ok ? 'is-ok ' + cg.cls : 'is-no') + (lit ? ' is-lit' : '') + (frozenRow ? ' is-frozen' : '') + (cached && ok && !frozenRow ? ' is-cached' : '');
          const gEl = V.svg('g', { class: 'viz-cell-btn', tabindex: -1 }, svg);
          V.svg('rect', { x: r1(x + 0.5), y: r1(y + 0.5), width: cs - 1, height: cs - 1, rx: 1.5, class: cls }, gEl);
          if (!ok && !narrow) V.svg('path', { d: 'M' + r1(x + 5) + ' ' + r1(y + 5) + 'l' + (cs - 10) + ' ' + (cs - 10) + 'm0 ' + -(cs - 10) + 'l' + -(cs - 10) + ' ' + (cs - 10), class: 'viz-mask-x' }, gEl);
          gEl.addEventListener('pointerenter', () => { state.focus = cells[r].g; state.cell = [r, c]; paintFocus(); });
          gEl.addEventListener('click', () => { state.focus = cells[r].g; state.cell = [r, c]; draw(); });
        }
      }
      if (ri != null) { /* la celda bajo el cursor se marca en paintFocus */ }
      // separadores de bloques
      [1, 2].forEach((b) => {
        const g0 = groups.find((g) => g.block === b), p = g0.start * cs;
        V.svg('path', { d: 'M' + r1(gx + p) + ' ' + (gy - 2) + 'V' + r1(gy + n * cs + 2) + 'M' + r1(gx - 2) + ' ' + r1(gy + p) + 'H' + r1(gx + n * cs + 2), class: 'viz-pm-sep' }, svg);
      });
      // etiquetas de fila (botones por grupo)
      groups.forEach((g, gi) => {
        const y0 = gy + g.start * cs, h = g.cells * cs;
        const on = gi === state.focus;
        const b = V.svg('g', { class: 'viz-cell-btn viz-pm-rowlab' + (on ? ' is-on' : ''), tabindex: 0, role: 'button', 'aria-pressed': String(on), 'aria-label': 'Queries de ' + g.label + ' (' + fmt.int(g.n) + (g.n === 1 ? ' token' : ' tokens') + ')' }, svg);
        V.svg('rect', { x: 4, y: r1(y0 + 0.5), width: lw, height: h - 1, rx: 3, class: 'viz-pm-lab ' + g.cls + (on ? ' is-on' : '') }, b);
        const ty = y0 + h / 2 + (narrow || h < 30 ? 4 : -1);
        t(b, 10, ty, narrow ? g.short : g.label, on ? 'viz-n' : 'viz-s');
        if (!narrow && h >= 30) t(b, 10, ty + 12, '× ' + fmt.int(g.n) + (g.n === 1 ? ' token' : ' tokens'), 'viz-s');
        else if (!narrow) t(b, lw - 2, ty, fmt.int(g.n), 'viz-s', 'end');
        b.addEventListener('click', () => { state.focus = gi; state.cell = null; draw(); });
        b.addEventListener('focus', () => { if (state.focus !== gi) { state.focus = gi; state.cell = null; paintFocus(); } });
        b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); state.focus = gi; draw(); } });
      });
      let y = gy + n * cs + 18;
      // panel lateral (o debajo en el teléfono): qué ve el grupo enfocado y los tokens reales
      const px = narrow ? 8 : gx + n * cs + 30;
      let py = narrow ? y : gy - 30;
      const [seen, hidden] = lists(fg);
      const wrapTxt = (s, x, yy, maxW, cls) => {
        const words = s.split(' '); let line = '', ly = yy;
        const per = (cls === 'viz-t' ? 6.4 : 6.6);
        for (const w of words) { if ((line + ' ' + w).trim().length * per > maxW && line) { t(svg, x, ly, line, cls); ly += 14; line = w; } else line = (line + ' ' + w).trim(); }
        if (line) { t(svg, x, ly, line, cls); ly += 14; }
        return ly;
      };
      const maxW = narrow ? W - 16 : W - px - 8;
      py = wrapTxt('B1 = prefijo · B2 = estado · B3 = acciones', px, py, maxW, 'viz-s');
      py = wrapTxt('Queries de ' + fg.label + ':', px, py + 4, maxW, 'viz-t');
      py = wrapTxt('ven ' + seen.join(', '), px, py, maxW, 'viz-s');
      if (hidden.length) py = wrapTxt('no ven ' + hidden.join(', '), px, py, maxW, 'viz-pm-no');
      py += 6;
      // la caja de cuentas reales
      const rows = [
        ['prefijo', fmt.int(prefixN) + ' tokens (' + cams + ' × ' + fmt.int(perImg) + ' + ' + fmt.int(T) + ')'],
        ['sufijo', fmt.int(suffixN) + ' tokens (estado + ' + fmt.int(H) + ' acciones)'],
      ];
      if (state.step) rows.push(['por paso', fmt.int(suffixN) + ' queries × ' + fmt.int(prefixN + suffixN) + ' keys'], ['pasos', String(steps) + ' (el prefijo, 1 vez)']);
      rows.forEach(([k, v]) => { t(svg, px, py, k, 'viz-s'); py = wrapTxt(v, px + (narrow ? 70 : 68), py, maxW - (narrow ? 70 : 68), 'viz-n'); });
      if (state.step) {
        py += 4;
        V.svg('rect', { x: px, y: r1(py - 9), width: 11, height: 11, rx: 1.5, class: 'viz-pm-cell is-ok is-img is-cached' }, svg); py = wrapTxt('K, V del caché (calculadas una vez)', px + 16, py, maxW - 16, 'viz-s');
        V.svg('rect', { x: px, y: r1(py - 9), width: 11, height: 11, rx: 1.5, class: 'viz-pm-cell is-ok is-img is-frozen' }, svg); py = wrapTxt('filas del prefijo: no se recalculan', px + 16, py, maxW - 16, 'viz-s');
      }
      y = Math.max(y, py + 6);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(y));
      readout(seen, hidden);
      if (state.cell) paintFocus();
    }
    // resaltado ligero sin redibujar (hover)
    function paintFocus() {
      const svg = stage.querySelector('svg');
      if (!svg) return;
      const rects = svg.querySelectorAll('.viz-pm-cell');
      const n = cells.length;
      rects.forEach((rc, k) => {
        const r = Math.floor(k / n), c = k % n;
        rc.classList.toggle('is-lit', cells[r].g === state.focus);
        rc.classList.toggle('is-hit', !!state.cell && state.cell[0] === r && state.cell[1] === c);
      });
      svg.querySelectorAll('.viz-pm-rowlab').forEach((b, gi) => { b.classList.toggle('is-on', gi === state.focus); b.setAttribute('aria-pressed', String(gi === state.focus)); });
      const fg = groups[state.focus];
      readout(...lists(fg));
    }
    // qué grupos ve un grupo de queries (en la causal, su propio grupo solo hasta sí mismo)
    function lists(fg) {
      const seen = [], hidden = [];
      for (const g of groups) {
        if (!allowed(fg.start, g.start)) hidden.push(g.label);
        else seen.push(g === fg && state.mode === 'causal' && g.cells > 1 ? g.label + ' (solo los tokens anteriores)' : g.label);
      }
      return [seen, hidden];
    }
    function readout(seen, hidden) {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const fg = groups[state.focus];
      kv('queries:', fg.label + ' (' + fmt.int(fg.n) + ')');
      kv('ven:', seen.join(', '));
      if (hidden.length) kv('no ven:', hidden.join(', '));
      if (state.cell) {
        const [r, c] = state.cell;
        kv('celda:', groups[cells[r].g].label + ' → ' + groups[cells[c].g].label + (allowed(r, c) ? ': permitido' : ': bloqueado (−∞)'));
      }
      note.innerHTML = (state.mode === 'pi0'
        ? 'Tres bloques: cada uno ve el suyo y los anteriores. El prefijo (imágenes + lenguaje) es bidireccional y no ve al robot: por eso su K y su V no dependen del estado ni de las acciones ruidosas, y se calculan una vez por chunk y se reusan en los ' + steps + ' pasos de flujo. Las acciones se ven todas entre sí (bidireccional): cada acción se ajusta a todas las del chunk.'
        : 'Con una máscara causal, cada acción vería solo las anteriores (no podría ajustarse a las que vienen después). Ojo: la máscara no decide cómo se decodifica; con flujo, las ' + fmt.int(H) + ' acciones seguirían refinándose juntas en cada paso. Lo de generar token a token es otra decisión (OpenVLA usa máscara causal Y decodificación autorregresiva). π0 usa atención bidireccional entre las acciones para que el chunk entero sea coherente.')
        + ' Celdas por grupo: ilustrativo; las cuentas de tokens son ' + (fromCalc ? 'del calculador (' + ((run && run.label) || cfgId) + ').' : 'las del paper (calculador no disponible).');
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k !== 'ArrowUp' && k !== 'ArrowDown') return;
      ev.preventDefault();
      state.focus = (state.focus + (k === 'ArrowDown' ? 1 : groups.length - 1)) % groups.length;
      state.cell = null;
      draw();
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('pi0-mask', render);
})(typeof window !== 'undefined' ? window : globalThis);
