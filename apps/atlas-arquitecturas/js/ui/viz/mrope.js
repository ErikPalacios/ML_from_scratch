/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/mrope.js
   Visualización "mrope" (SPEC §7.8, §19.4): los ids de posición que M-RoPE (Qwen2-VL) le da a cada token de un prompt
   con texto + una imagen + texto. RoPE 1-D usa UN id por token (0, 1, 2…); M-RoPE usa tres (t, h, w):
   - texto: el mismo id en los tres ejes (equivale a RoPE 1-D);
   - imagen: los tokens (tras el merger 2×2) comparten t y varían h (fila) y w (columna) a partir del id de inicio;
   - el texto que sigue retoma en max(id) + 1: tras una imagen de gh × gw tokens avanza max(gh, gw), no gh·gw
     (verificado contra get_rope_index de HF transformers 5.19 con imágenes).
   Las rotaciones de cada cabeza se reparten entre los tres ejes (mrope_section de HF): unas frecuencias rotan con t,
   otras con h y otras con w.
   Lo ilustrativo: el prompt (palabras), la escena y el tamaño de la rejilla. Los ids salen de la misma regla que
   get_rope_index de HF (ATLAS.ArchDiagram.mropeIds, la que usa también el diagrama). Del calculador (si la config lo
   tiene): el reparto de frecuencias (mrope_section) y d_h.
   params: { config:'qwen2-vl-7b', grid:'2x3', sel:5 }
   (Solo imágenes: con video, t avanza por grupo temporal, pero cuánto avanza el texto de después cambió entre
   versiones de HF transformers; la página lo explica en prosa.)
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const BEFORE = ['Mira', 'la', '<vs>'], AFTER = ['<ve>', '¿qué', 'hay?'];
  const GRIDS = { '2x2': [2, 2], '2x3': [2, 3], '3x4': [3, 4] };

  function cfgVal(c, keys, d) { for (const k of keys) { const v = c && c[k]; if (v != null && (Number.isFinite(v) || Array.isArray(v))) return v; } return d; }

  // misma regla que el motor (ATLAS.ArchDiagram.mropeIds); copia de respaldo si el motor no la exporta
  function idsOf(segs) {
    const AD = ATLAS.ArchDiagram;
    if (AD && typeof AD.mropeIds === 'function') return AD.mropeIds(segs);
    const out = []; let st = 0;
    for (const s of segs) {
      if (s.kind === 'img') { for (let ti = 0; ti < (s.gt || 1); ti++) for (let hi = 0; hi < s.gh; hi++) for (let wi = 0; wi < s.gw; wi++) out.push({ kind: 'img', t: st + ti, h: st + hi, w: st + wi, ti, hi, wi, seg: s }); st += Math.max(s.gt || 1, s.gh, s.gw); }
      else { for (let i = 0; i < s.n; i++) out.push({ kind: 'txt', t: st + i, h: st + i, w: st + i, word: s.words && s.words[i], seg: s }); st += s.n; }
    }
    return out;
  }

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const cfgId = params.config || 'qwen2-vl-7b';
    let cfg = {}, label = cfgId;
    try { const r = A.run(cfgId); cfg = r.config || {}; label = r.label || cfgId; } catch (e) { cfg = {}; }
    const sect = cfgVal(cfg, ['mropeSection', 'mrope_section'], null);
    const dh = cfgVal(cfg, ['dh', 'dHead', 'headDim'], null);
    const state = { grid: GRIDS[params.grid] ? params.grid : '2x3', video: false, sel: Number.isFinite(+params.sel) ? +params.sel : 5 };

    const wrap = V.html('div', { class: 'viz viz-mrope' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const g1 = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': 'Tokens de la imagen tras el merger' }, ctl);
    V.html('span', { class: 'viz-ctl-l', text: 'Imagen (tokens)' }, g1);
    const gChips = Object.keys(GRIDS).map((k) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: GRIDS[k][0] + '×' + GRIDS[k][1] }, g1); b.addEventListener('click', () => { state.grid = k; draw(); }); b._k = k; return b; });
    const stage = V.html('div', { class: 'viz-stage viz-mrope-stage', tabindex: 0, role: 'group', 'aria-label': 'Ids de posición de M-RoPE por token. Flechas izquierda y derecha: elegir el token' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const secTxt = Array.isArray(sect) && sect.length === 3
      ? ' En ' + label + ' (del calculador): las ' + sect.reduce((a, b) => a + b, 0) + ' frecuencias de cada cabeza' + (dh ? ' (d<sub>h</sub> = ' + dh + ', una frecuencia por par)' : '') + ' se reparten ' + sect[0] + ' para t, ' + sect[1] + ' para h y ' + sect[2] + ' para w (mrope_section).'
      : '';
    // una imagen real (la config del calculador): su rejilla de tokens tras el merger
    let realTxt = '';
    try { if (cfg.H && cfg.W && A.vlm) { const qt = A.vlm.qwenTokens(cfg.H, cfg.W); realTxt = ' (en ' + label + ', la imagen de ' + cfg.H + '×' + cfg.W + ' da ' + qt.gridH + '×' + qt.gridW + ' tokens)'; } } catch (e) { realTxt = ''; }
    V.html('p', { class: 'viz-note' }, wrap, 'Ilustrativo: las palabras, la escena y el tamaño de la rejilla' + realTxt + '. &lt;vs&gt; y &lt;ve&gt; son los tokens de texto que abren y cierran la imagen (&lt;|vision_start|&gt;, &lt;|vision_end|&gt;). ' +
      'Los ids siguen la regla de Qwen2-VL (get_rope_index de HF): el texto lleva el mismo id en t, h y w (como RoPE 1-D); los tokens de la imagen comparten t y varían h y w según su fila y su columna, así la atención ve distancias 2-D entre parches; el texto siguiente retoma en el máximo + 1. ' +
      'En un video, además, t avanza una unidad por grupo de 2 frames. Cada eje rota su parte de las frecuencias de q y k.' + secTxt);

    function draw() {
      gChips.forEach((b) => b.setAttribute('aria-pressed', String(b._k === state.grid)));
      const [gh, gw] = GRIDS[state.grid], gt = state.video ? 2 : 1;
      const segs = [{ kind: 'txt', n: BEFORE.length, words: BEFORE }, { kind: 'img', gh, gw, gt }, { kind: 'txt', n: AFTER.length, words: AFTER }];
      const ids = idsOf(segs);
      state.sel = Math.max(0, Math.min(ids.length - 1, state.sel));
      const cw0 = stage.clientWidth || 860, narrow = cw0 < 640;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(440, cw0)) : 880;
      const colW = narrow ? 30 : 38, labW = narrow ? 34 : 44;
      // panel de la imagen: a la derecha (ancho) o arriba (angosto)
      const cell = narrow ? 32 : 46, imgW = gt * gw * cell + (gt - 1) * 10, imgH = gh * cell;
      const tblX = 8 + labW, tblW = narrow ? W - 16 - labW : W - 16 - labW - imgW - 40;
      const perRow = Math.max(4, Math.floor(tblW / colW));
      const nRows = Math.ceil(ids.length / perRow);
      const rowH = 18 + 4 * 15 + 14;
      const imgY = narrow ? 52 : 50, tblY = narrow ? imgY + imgH + 34 : 40;
      const Hh = Math.max(tblY + nRows * rowH + 6, narrow ? 0 : imgY + imgH + 46);
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' ' + Hh, style: 'max-width:' + W + 'px', role: 'img', 'aria-label': ariaOf(ids, gh, gw, gt) }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); e.textContent = s; return e; };
      t(svg, 8, 15, narrow ? 'Ids por token: M-RoPE (t, h, w) y RoPE 1-D' : 'Ids de posición por token: (t, h, w) con M-RoPE · 1-D con RoPE común', 'viz-t');
      t(svg, 8, 29, narrow ? 'clic o flechas: elegir un token' : 'clic en un token o en un parche (o flechas ← →) para ver sus ids', 'viz-s');
      // ---- tabla: una columna por token (chip + t, h, w + 1-D)
      ids.forEach((p, i) => {
        const row = Math.floor(i / perRow), col = i % perRow;
        const x = tblX + col * colW, y = tblY + row * rowH;
        if (col === 0) ['t', 'h', 'w', '1-D'].forEach((ax, j) => t(svg, 8, y + 32 + j * 15, ax, ax === '1-D' ? 'viz-s' : 'viz-mrope-ax'));
        const g = V.svg('g', { class: 'viz-cell-btn viz-mrope-col' + (i === state.sel ? ' is-sel' : '') }, svg);
        g.addEventListener('click', () => { state.sel = i; draw(); });
        const isImg = p.kind === 'img';
        V.svg('rect', { x: x + 1, y, width: colW - 2, height: 18, rx: 2, class: 'viz-mrope-tok ' + (isImg ? 'is-img' : 'is-txt') }, g);
        t(g, x + colW / 2, y + 12.5, isImg ? (gt > 1 && !narrow ? 'f' + p.ti + ':' : '') + p.hi + ',' + p.wi : shortW(p.word, narrow), 'viz-mrope-toktxt', 'middle');
        ['t', 'h', 'w'].forEach((ax, j) => {
          const vary = isImg && (ax !== 't' || gt > 1);
          t(g, x + colW / 2, y + 32 + j * 15, String(p[ax]), 'viz-n viz-mrope-id' + (vary ? ' is-var' : ''), 'middle');
        });
        t(g, x + colW / 2, y + 32 + 3 * 15, String(i), 'viz-s', 'middle');
        if (i === state.sel) V.svg('rect', { x: x + 0.5, y: y - 2, width: colW - 1, height: rowH - 10, rx: 3, class: 'viz-sel' }, g);
      });
      // ---- la imagen (o los 2 tiempos del video) partida en gh × gw tokens
      const ix0 = narrow ? 8 : W - 8 - imgW;
      t(svg, narrow ? 8 : W - 8, imgY - 8, state.video ? 'video: 2 tiempos × ' + gh + '×' + gw + ' tokens' : 'imagen: ' + gh + '×' + gw + ' tokens', 'viz-s', narrow ? null : 'end');
      for (let ti = 0; ti < gt; ti++) {
        const ox = ix0 + ti * (gw * cell + 10);
        V.scene(svg, ox, imgY, gw * cell, gh * cell, 0);
        for (let hi = 0; hi < gh; hi++) for (let wi = 0; wi < gw; wi++) {
          const k = ids.findIndex((p) => p.kind === 'img' && p.ti === ti && p.hi === hi && p.wi === wi);
          const g = V.svg('g', { class: 'viz-cell-btn' }, svg);
          g.addEventListener('click', () => { state.sel = k; draw(); });
          V.svg('rect', { x: ox + wi * cell, y: imgY + hi * cell, width: cell, height: cell, class: 'viz-mrope-patch' + (k === state.sel ? ' is-sel' : '') }, g);
        }
        if (gt > 1) t(svg, ox + gw * cell / 2, imgY + gh * cell + 14, 't = ' + (ids.find((p) => p.kind === 'img' && p.ti === ti) || {}).t, 'viz-s', 'middle');
      }
      readout(ids, gh, gw, gt);
    }
    function shortW(w, narrow) { const s = String(w || ''); return narrow && s.length > 4 ? s.slice(0, 3) + '…' : s; }

    function readout(ids, gh, gw, gt) {
      out.innerHTML = '';
      const kv = (k2, v) => { const sp = V.html('span', null, out); sp.innerHTML = k2 + ' <b>' + v + '</b>'; };
      const p = ids[state.sel];
      if (p.kind === 'img') kv('token ' + state.sel + ' (imagen' + (gt > 1 ? ', tiempo ' + p.ti : '') + ', fila ' + p.hi + ', columna ' + p.wi + '):', '(t, h, w) = (' + p.t + ', ' + p.h + ', ' + p.w + ')');
      else kv('token ' + state.sel + ' (texto «' + esc(p.word) + '»):', 't = h = w = ' + p.t);
      const firstAfter = ids.findIndex((q, i) => i > 0 && q.kind === 'txt' && ids[i - 1].kind === 'img');
      if (firstAfter > 0) kv('el texto de después empieza en:', ids[firstAfter].t + ' con M-RoPE (con RoPE 1-D: ' + firstAfter + ')');
      kv('tokens de la imagen:', gt * gh * gw + ' → avanzan ' + Math.max(gt, gh, gw) + ' posiciones');
    }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function ariaOf(ids, gh, gw, gt) { return 'Prompt de ' + ids.length + ' tokens: ' + BEFORE.length + ' de texto, ' + gt * gh * gw + ' de ' + (gt > 1 ? 'video' : 'imagen') + ' (' + (gt > 1 ? gt + ' tiempos de ' : '') + gh + ' por ' + gw + ') y ' + AFTER.length + ' de texto. Ids (t, h, w): ' + ids.map((q) => '(' + q.t + ',' + q.h + ',' + q.w + ')').join(' '); }

    stage.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowRight') { ev.preventDefault(); state.sel++; draw(); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); state.sel = Math.max(0, state.sel - 1); draw(); }
      else if (ev.key === 'Home') { ev.preventDefault(); state.sel = 0; draw(); }
      else if (ev.key === 'End') { ev.preventDefault(); state.sel = 1e9; draw(); }
    });
    draw();
    let ro = null, lastNarrow = (stage.clientWidth || 860) < 640;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) { lastNarrow = nar; draw(); } }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('mrope', render);
})(typeof window !== 'undefined' ? window : globalThis);
