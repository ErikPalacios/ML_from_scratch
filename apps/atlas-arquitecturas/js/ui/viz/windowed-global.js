/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/windowed-global.js
   Visualización "windowed-global" (SPEC §7.8, §17.3): el encoder ViT de SAM mezcla bloques con
   atención por ventanas (14×14 tokens, la rejilla 64×64 se rellena a 70×70 = 5×5 ventanas) con unos
   pocos bloques de atención global (4 en ViT-B/L/H, repartidos a lo largo de la pila).
   Arriba, la pila de L bloques (cuáles son globales, de la config del calculador); abajo, la rejilla de
   tokens del bloque elegido con el alcance de un token (su ventana o toda la imagen) y, a la derecha,
   el costo de ESE bloque (atención: QKᵀ y A·V; bloque entero) y el del encoder, todo del calculador.
   params: { config:'sam-vit-h-1024', block:<índice 0..L−1>, tok:[fila, col] }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;

  function cfgVal(c, keys, d) { for (const k of keys) { const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), c); if (v != null) return v; } return d; }

  // ----- adaptador al calculador: costo de UN bloque con ventanas y de UN bloque global
  // Ops cuyo path pasa por el nodo del bloque ('win-blocks' / 'global-blocks'); op.macs es por repetición.
  function blockCost(run, nodeId) {
    if (!run) return null;
    const ops = run.ops.filter((o) => (o.path || []).indexOf(nodeId) >= 0);
    if (!ops.length) return null;
    const sum = (f) => ops.reduce((a, o) => a + (f(o) ? o.macs : 0), 0);
    const score = sum((o) => o.prim === 'attention_scores' || o.prim === 'attention_weighted_sum');
    const attn = sum((o) => o.group === 'attn');
    const all = sum(() => true);
    const params = ops.reduce((a, o) => a + o.params, 0);
    const rep = Math.max(...ops.map((o) => o.repeat || 1));
    const sc = ops.find((o) => o.prim === 'attention_scores');
    const scT = sc && run.tensors[sc.out[0]];
    return { score, attn, all, params, rep, scoresT: scT || null };
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || { int: (n) => String(n), si: (n) => String(n), bytes: (n) => n + ' B' };
    const cfgs = (() => { try { return A.configs('sam').map((c) => c.id); } catch (e) { return []; } })();
    const state = { cfg: cfgs.indexOf(params.config) >= 0 ? params.config : (cfgs.indexOf('sam-vit-h-1024') >= 0 ? 'sam-vit-h-1024' : cfgs[0] || 'sam-vit-h-1024'), block: Number.isInteger(params.block) ? params.block : null, tok: Array.isArray(params.tok) ? params.tok.slice(0, 2) : [20, 23] };

    const wrap = V.html('div', { class: 'viz viz-wg' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const gc = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Encoder' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Encoder' }, gc);
    const bCfg = cfgs.map((id) => {
      let lab = id;
      try { lab = (A.run(id).label || id).replace(/^SAM\s*/i, ''); } catch (e) { /* id */ }
      const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: lab }, gc);
      b.addEventListener('click', () => { state.cfg = id; state.block = null; draw(); }); b._v = id; return b;
    });
    const gb = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Bloque' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Ver' }, gb);
    const bWin = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'un bloque con ventanas' }, gb);
    const bGlob = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: 'un bloque global' }, gb);
    bWin.addEventListener('click', () => { const s = setup(); state.block = s.blocks.findIndex((g) => !g); draw(); });
    bGlob.addEventListener('click', () => { const s = setup(); state.block = s.blocks.findIndex((g) => g); draw(); });
    const stage = V.html('div', { class: 'viz-stage' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    V.html('p', { class: 'viz-note' }, wrap, 'Del calculador: la pila (cuáles bloques son globales), la ventana y los costos. ' +
      'En un bloque con ventanas cada token atiende solo a los de su ventana de 14×14: la rejilla de 64×64 se rellena con ceros hasta 70×70 (5×5 ventanas, la última fila y columna con relleno) y la atención se hace dentro de cada ventana, como un lote. ' +
      'Los pocos bloques globales (cada cuarto de la pila) dejan que la información cruce entre ventanas. Las dos usan posiciones relativas aprendidas (sumadas a los scores), con tablas de 2·14 − 1 o 2·64 − 1 posiciones por eje. Sin desplazamiento de ventanas (eso es Swin).');

    function setup() {
      let run = null;
      try { run = A.run(state.cfg); } catch (e) { run = null; }
      const c = (run && run.config) || {};
      const L = Math.round(cfgVal(c, ['L', 'depth'], 32));
      const win = Math.round(cfgVal(c, ['M', 'win', 'window'], 14));
      const G = Math.round(cfgVal(c, ['G', 'grid'], (cfgVal(c, ['res', 'H'], 1024) / cfgVal(c, ['patch'], 16))));
      const gl = cfgVal(c, ['globals', 'globalIdx'], [7, 15, 23, 31]);
      const blocks = Array.from({ length: L }, (_, i) => gl.indexOf(i) >= 0);
      const nW = Math.ceil(G / win), Gp = nW * win;
      return { run, c, L, win, G, Gp, nW, gl, blocks, wc: blockCost(run, 'win-blocks'), gc: blockCost(run, 'global-blocks') };
    }

    let lastNarrow = null;
    function draw() {
      const s = setup();
      if (state.block == null || state.block >= s.L) { const w0 = s.blocks.findIndex((g) => !g); state.block = w0 >= 0 ? w0 : 0; }
      const isG = s.blocks[state.block];
      bCfg.forEach((b) => b.setAttribute('aria-pressed', String(b._v === state.cfg)));
      bWin.setAttribute('aria-pressed', String(!isG)); bGlob.setAttribute('aria-pressed', String(isG));
      const cw = stage.clientWidth || 860;
      const narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const X0 = 8;
      // pila de bloques
      const SW = narrow ? Math.max(260, Math.min(cw, 420) - 16) : Math.min(860, cw - 16);
      const perRow = narrow ? Math.ceil(s.L / 2) : s.L;
      const bw = Math.floor((SW - (perRow - 1) * 3) / perRow), bh = 22;
      const stackY = 40, stackRows = Math.ceil(s.L / perRow);
      const gridY = stackY + stackRows * (bh + 18) + 30;
      const GS = narrow ? Math.min(SW, 300) : 280;           // lado de la rejilla de tokens (incluido el relleno)
      const RX = narrow ? X0 : X0 + GS + 40, RY = narrow ? gridY + GS + 56 : gridY + 22;
      const W = narrow ? SW + 16 : Math.max(SW + 16, RX + 330);
      const Hh = narrow ? RY + 190 : Math.max(gridY + GS + 40, RY + 200);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'group', 'aria-label': 'Encoder de ' + s.L + ' bloques; globales: ' + s.gl.map((i) => i + 1).join(', ') + '. Bloque ' + (state.block + 1) + ': ' + (isG ? 'global' : 'con ventanas de ' + s.win + '×' + s.win) }, stage);
      const t = (p, x, y, str, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = str; return e; };
      t(svg, X0, 15, narrow ? 'La pila: ' + s.L + ' bloques, ' + s.gl.length + ' globales' : 'La pila: ' + s.L + ' bloques, ' + s.gl.length + ' globales (' + s.gl.map((i) => i + 1).join(', ') + '), el resto con ventanas de ' + s.win + '×' + s.win, 'viz-t');
      t(svg, X0, 30, narrow ? 'toca un bloque (o flechas)' : 'toca un bloque (o usa las flechas con el foco en la pila)', 'viz-s');
      const stack = V.svg('g', { class: 'viz-wg-stack', tabindex: 0, role: 'listbox', 'aria-label': 'Bloques del encoder; flechas para elegir', 'aria-activedescendant': null }, svg);
      for (let i = 0; i < s.L; i++) {
        const col = i % perRow, row = Math.floor(i / perRow);
        const x = X0 + col * (bw + 3), y = stackY + row * (bh + 18);
        const g = V.svg('g', { class: 'viz-wg-b' + (s.blocks[i] ? ' is-global' : '') + (i === state.block ? ' is-sel' : ''), role: 'option', 'aria-selected': String(i === state.block), 'aria-label': 'bloque ' + (i + 1) + (s.blocks[i] ? ', global' : ', con ventanas') }, stack);
        V.svg('rect', { x, y, width: bw, height: bh, rx: 2.5, class: 'viz-wg-cell' }, g);
        if (!s.blocks[i] && bw >= 12) {
          // icono de ventanas: rejilla 2×2 dentro de la celda
          const m = Math.min(bw, bh) * 0.6, ix = x + (bw - m) / 2, iy = y + (bh - m) / 2;
          V.svg('path', { d: 'M' + r1(ix) + ' ' + r1(iy) + 'h' + r1(m) + 'v' + r1(m) + 'h' + r1(-m) + 'ZM' + r1(ix + m / 2) + ' ' + r1(iy) + 'v' + r1(m) + 'M' + r1(ix) + ' ' + r1(iy + m / 2) + 'h' + r1(m), class: 'viz-wg-ico' }, g);
        } else if (s.blocks[i]) t(g, x + bw / 2, y + bh / 2 + 4, 'G', 'viz-wg-g', 'middle');
        if (s.blocks[i] || i === 0 || i === s.L - 1) t(svg, x + bw / 2, y + bh + 12, String(i + 1), i === state.block ? 'viz-n' : 'viz-s', 'middle');
        g.addEventListener('click', () => { state.block = i; draw(); });
      }
      stack.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        state.block = Math.max(0, Math.min(s.L - 1, state.block + (ev.key === 'ArrowRight' ? 1 : -1)));
        draw();
        const st = stage.querySelector('.viz-wg-stack'); if (st) st.focus({ preventScroll: true });
      });
      // rejilla de tokens del bloque elegido
      t(svg, X0, gridY - 12, 'Bloque ' + (state.block + 1) + (isG ? ': atención global' : ': atención por ventanas') + (narrow ? '' : ' · rejilla ' + s.G + '×' + s.G + (isG ? '' : ' (+ relleno a ' + s.Gp + '×' + s.Gp + ')')), 'viz-t');
      const span = isG ? s.G : s.Gp, cs = GS / span;
      const gg = V.svg('g', { class: 'viz-wg-grid', tabindex: 0, role: 'img', 'aria-label': 'Token en la fila ' + (state.tok[0] + 1) + ', columna ' + (state.tok[1] + 1) + ': atiende a ' + (isG ? 'los ' + s.G * s.G + ' tokens' : 'los ' + s.win * s.win + ' tokens de su ventana') + '. Flechas: mover el token.' }, svg);
      const GX = X0, GY = gridY;
      V.svg('rect', { x: GX, y: GY, width: r1(s.G * cs), height: r1(s.G * cs), class: 'viz-wg-img' }, gg);
      if (!isG && s.Gp > s.G) {
        V.svg('rect', { x: r1(GX + s.G * cs), y: GY, width: r1((s.Gp - s.G) * cs), height: r1(s.Gp * cs), class: 'viz-wg-pad' }, gg);
        V.svg('rect', { x: GX, y: r1(GY + s.G * cs), width: r1(s.G * cs), height: r1((s.Gp - s.G) * cs), class: 'viz-wg-pad' }, gg);
      }
      // alcance del token
      const [tr, tc] = state.tok;
      if (isG) V.svg('rect', { x: GX, y: GY, width: r1(s.G * cs), height: r1(s.G * cs), class: 'viz-wg-reach' }, gg);
      else {
        const wr = Math.floor(tr / s.win), wc = Math.floor(tc / s.win);
        V.svg('rect', { x: r1(GX + wc * s.win * cs), y: r1(GY + wr * s.win * cs), width: r1(s.win * cs), height: r1(s.win * cs), class: 'viz-wg-reach' }, gg);
      }
      // líneas de token (cada 2 si son muy finas) y de ventana
      let d = '';
      const step = cs < 3.2 ? 2 : 1;
      for (let i = step; i < span; i += step) d += 'M' + r1(GX + i * cs) + ' ' + GY + 'V' + r1(GY + span * cs) + 'M' + GX + ' ' + r1(GY + i * cs) + 'H' + r1(GX + span * cs);
      V.svg('path', { d, class: 'viz-wg-tok' }, gg);
      if (!isG) {
        let dw = '';
        for (let i = 0; i <= s.nW; i++) dw += 'M' + r1(GX + i * s.win * cs) + ' ' + GY + 'V' + r1(GY + span * cs) + 'M' + GX + ' ' + r1(GY + i * s.win * cs) + 'H' + r1(GX + span * cs);
        V.svg('path', { d: dw, class: 'viz-wg-win' }, gg);
      } else V.svg('rect', { x: GX, y: GY, width: r1(s.G * cs), height: r1(s.G * cs), class: 'viz-wg-winrect' }, gg);
      V.svg('rect', { x: r1(GX + tc * cs), y: r1(GY + tr * cs), width: r1(Math.max(cs, 2.5)), height: r1(Math.max(cs, 2.5)), class: 'viz-wg-q' }, gg);
      const hit = V.svg('rect', { x: GX, y: GY, width: r1(s.G * cs), height: r1(s.G * cs), class: 'viz-wg-hit' }, gg);
      hit.addEventListener('click', (ev) => {
        const r = hit.getBoundingClientRect(); if (!r.width) return;
        state.tok = [Math.max(0, Math.min(s.G - 1, Math.floor((ev.clientY - r.top) / r.height * s.G))), Math.max(0, Math.min(s.G - 1, Math.floor((ev.clientX - r.left) / r.width * s.G)))];
        draw();
      });
      gg.addEventListener('keydown', (ev) => {
        const dx = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0, dy = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
        if (!dx && !dy) return;
        ev.preventDefault();
        state.tok = [Math.max(0, Math.min(s.G - 1, tr + dy * 2)), Math.max(0, Math.min(s.G - 1, tc + dx * 2))];
        draw();
        const g2 = stage.querySelector('.viz-wg-grid'); if (g2) g2.focus({ preventScroll: true });
      });
      t(svg, GX, GY + span * cs + 16, isG ? 'el token atiende a los ' + fmt.int(s.G * s.G) + ' tokens' : 'el token atiende a los ' + s.win * s.win + ' de su ventana (' + s.nW + '×' + s.nW + ' = ' + s.nW * s.nW + ' ventanas)', 'viz-s');
      // costos del calculador
      costs(svg, t, s, isG, RX, RY, narrow ? SW : W - RX - 8, narrow);
      readout(s, isG);
    }

    function costs(svg, t, s, isG, x, y, w, narrow) {
      const cur = isG ? s.gc : s.wc, oth = isG ? s.wc : s.gc;
      t(svg, x, y - 12, narrow ? 'Costo de un bloque (calculador)' : 'Costo de un bloque (del calculador, ' + state.cfg + ')', 'viz-t');
      if (!cur || !oth) { t(svg, x, y + 6, 'calculador sin datos por bloque', 'viz-s'); return; }
      const mx = Math.max(s.gc.all, s.wc.all, 1);
      const row = (yy, lab, v, cls) => {
        t(svg, x, yy, lab, 'viz-s');
        V.svg('rect', { x, y: yy + 6, width: w, height: 12, rx: 2, class: 'viz-zs-track' }, svg);
        V.svg('rect', { x, y: yy + 6, width: Math.max(1.5, r1(w * v / mx)), height: 12, rx: 2, class: cls }, svg);
        t(svg, x + w, yy, fmt.si(v) + ' MACs', 'viz-n', 'end');
      };
      row(y + 8, 'con ventanas: QKᵀ y A·V', s.wc.score, 'viz-wg-bar is-score' + (isG ? '' : ' is-sel'));
      row(y + 34, 'con ventanas: bloque entero', s.wc.all, 'viz-wg-bar' + (isG ? '' : ' is-sel'));
      row(y + 66, 'global: QKᵀ y A·V', s.gc.score, 'viz-wg-bar is-score is-global' + (isG ? ' is-sel' : ''));
      row(y + 92, 'global: bloque entero', s.gc.all, 'viz-wg-bar is-global' + (isG ? ' is-sel' : ''));
      const nG = s.gl.length, nWb = s.L - nG;
      const real = nWb * s.wc.all + nG * s.gc.all, allG = s.L * s.gc.all;
      t(svg, x, y + 128, 'encoder: ' + nWb + '·' + fmt.si(s.wc.all) + ' + ' + nG + '·' + fmt.si(s.gc.all) + ' = ' + fmt.si(real) + ' MACs', 'viz-n');
      t(svg, x, y + 144, 'si los ' + s.L + ' fueran globales: ' + fmt.si(allG) + ' (' + (allG / real).toFixed(2) + '×)', 'viz-s');
    }

    function readout(s, isG) {
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      const sc = isG ? s.gc && s.gc.scoresT : s.wc && s.wc.scoresT;
      if (sc) kv('scores de este bloque:', A.fmt.shape(sc, 'sym') + ' = ' + A.fmt.shape(sc, 'num') + ' (' + fmt.int(sc.elements || sc.num.reduce((a, b) => a * b, 1)) + ' elementos)');
      kv('tokens por ventana:', isG ? s.G + '·' + s.G + ' = ' + fmt.int(s.G * s.G) + ' (una sola "ventana")' : s.win + '·' + s.win + ' = ' + s.win * s.win);
      kv('bloques globales:', s.gl.map((i) => i + 1).join(', ') + ' de ' + s.L);
    }

    draw();
    let ro = null;
    if (root.ResizeObserver) {
      ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); });
      ro.observe(stage);
    }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('windowed-global', render);
})(typeof window !== 'undefined' ? window : globalThis);
