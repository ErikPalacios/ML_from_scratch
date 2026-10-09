/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/embedding-space.js
   Visualización "embedding-space" (SPEC §7.8, §23.4): búsqueda densa en un espacio 2-D de juguete (sintético, ilustrativo).
   Dos modos:
     · Ranking: una consulta y 10 documentos como vectores; el puntaje es el producto punto q·d (con "coseno" = los dos
       normalizados a norma 1). Se ve el top-k, el negativo difícil (comparte palabras con la consulta pero no la responde) y
       la trampa del producto punto sin normalizar: un documento de norma grande (una portada "popular") gana consultas que
       no responde. Flechas: girar la consulta.
     · Lote (in-batch): B = 4 pares (consulta, documento positivo); cada consulta usa los positivos de las otras como negativos
       (la matriz B×B de puntajes, la diagonal son los pares correctos) y, opcional, un negativo difícil por consulta (DPR:
       uno de BM25 por pregunta). Pérdida InfoNCE por fila = −log softmax(s_ii / τ); τ = 0.05 es la escala 20 de la
       MultipleNegativesRankingLoss de sentence-transformers (coseno × 20); DPR usa el producto punto sin temperatura.
   Todos los números son aritmética exacta sobre vectores elegidos a mano.
   params: { mode:'rank'|'batch', query:0, norm:1, hard:1, tau:0.05, k:3 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const DEG = Math.PI / 180;
  // documentos: ángulo (grados) y norma; tema para el color
  const DOCS = [
    { id: 'd0', t: 'Receta de paella', a: 12, n: 1.0, topic: 0 },
    { id: 'd1', t: 'Cómo cocer arroz blanco', a: 33, n: 0.95, topic: 0 },
    { id: 'd2', t: 'Historia del arroz en Asia', a: 62, n: 0.9, topic: 1 },
    { id: 'd3', t: 'Caída del Imperio romano', a: 112, n: 1.0, topic: 1 },
    { id: 'd4', t: 'Coliseo: quién lo construyó', a: 136, n: 0.92, topic: 1 },
    { id: 'd5', t: 'Reglas del fuera de juego', a: 206, n: 1.0, topic: 2 },
    { id: 'd6', t: 'Mundial 2022: resultados', a: 236, n: 1.05, topic: 2 },
    { id: 'd7', t: 'Listas en Python', a: 292, n: 1.0, topic: 3 },
    { id: 'd8', t: 'Errores comunes en Python', a: 316, n: 0.95, topic: 3 },
    { id: 'd9', t: 'Portada del portal (popular)', a: 352, n: 1.85, topic: 4 },
  ];
  // consultas: su positivo y su negativo difícil (comparte palabras, no responde)
  const QUERIES = [
    { t: '¿cómo cocino arroz?', a: 38, pos: 'd1', hard: 'd2' },
    { t: '¿quién construyó el Coliseo?', a: 128, pos: 'd4', hard: 'd3' },
    { t: '¿qué es el fuera de juego?', a: 212, pos: 'd5', hard: 'd6' },
    { t: 'append en listas de Python', a: 298, pos: 'd7', hard: 'd8' },
  ];
  const TAUS = [1, 0.1, 0.05];
  const KS = [1, 3, 5];
  const vec = (a, n) => [n * Math.cos(a * DEG), n * Math.sin(a * DEG)];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1];
  const f2 = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)).replace('-', '−');

  function render(el, params) {
    const V = ATLAS.Viz;
    const state = {
      mode: params.mode === 'batch' ? 'batch' : 'rank',
      q: Number.isInteger(+params.query) && QUERIES[+params.query] ? +params.query : 0,
      ang: null, norm: params.norm == null ? true : !!+params.norm, hard: params.hard == null ? true : !!+params.hard,
      tau: TAUS.indexOf(+params.tau) >= 0 ? +params.tau : 0.05, k: KS.indexOf(+params.k) >= 0 ? +params.k : 3,
    };
    state.ang = QUERIES[state.q].a;

    const wrap = V.html('div', { class: 'viz viz-es' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const all = [];
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const chip = (g, label, key, v, after) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label }, g); b.addEventListener('click', () => { state[key] = v; if (after) after(); draw(); }); b._k = key; b._v = v; all.push(b); return b; };
    const gM = grp('Modo');
    chip(gM, 'Ranking', 'mode', 'rank'); chip(gM, 'Lote (in-batch)', 'mode', 'batch');
    const gQ = grp('Consulta');
    QUERIES.forEach((qq, i) => chip(gQ, 'q' + (i + 1), 'q', i, () => { state.ang = QUERIES[i].a; }));
    const gN = grp('Puntaje');
    chip(gN, 'coseno', 'norm', true); chip(gN, 'punto sin normalizar', 'norm', false);
    const gK = grp('top-k');
    KS.forEach((k) => chip(gK, String(k), 'k', k));
    const gT = grp('Temperatura τ');
    TAUS.forEach((v) => chip(gT, String(v), 'tau', v));
    const gH = grp('Negativo difícil');
    chip(gH, 'sí', 'hard', true); chip(gH, 'no', 'hard', false);
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-es-stage', tabindex: 0, role: 'group', 'aria-label': 'Espacio de embeddings. Flechas izquierda y derecha: girar la consulta; arriba y abajo: cambiar de consulta; N: coseno o producto punto; B: modo lote' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    const docVec = (d) => vec(d.a, state.norm ? 1 : d.n);
    let lastNarrow = null;
    function draw() {
      all.forEach((b) => {
        b.setAttribute('aria-pressed', String(state[b._k] === b._v));
        const kOnly = b._k === 'k' || b._k === 'q', bOnly = b._k === 'tau' || b._k === 'hard';
        b.closest('.viz-ctl').hidden = (state.mode === 'batch' && kOnly) || (state.mode === 'rank' && bOnly);
      });
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      if (state.mode === 'rank') drawRank(svg, t, W, narrow); else drawBatch(svg, t, W, narrow);
    }

    function drawRank(svg, t, W, narrow) {
      const Q = QUERIES[state.q];
      const qv = vec(state.ang, 1);
      const scored = DOCS.map((d) => ({ d, s: dot(qv, docVec(d)) })).sort((a, b) => b.s - a.s);
      const top = scored.slice(0, state.k);
      const rankOf = (id) => scored.findIndex((x) => x.d.id === id) + 1;
      t(svg, 8, 15, narrow ? 'Ranking por ' + (state.norm ? 'coseno' : 'producto punto') : 'Búsqueda densa: puntaje = ' + (state.norm ? 'coseno (q y d normalizados, ‖·‖ = 1)' : 'producto punto q·d (sin normalizar: cuenta la norma)') + ', top-' + state.k, 'viz-t');
      t(svg, 8, 29, narrow ? '2-D de juguete (ilustrativo)' : 'espacio de juguete en 2-D (los reales tienen de cientos a miles de dimensiones); vectores elegidos a mano', 'viz-s');
      // ---- plano
      const S = narrow ? Math.min(W - 16, 300) : 340, cx = narrow ? W / 2 : 8 + S / 2, cy = 44 + S / 2, R = S * (state.norm ? 0.4 : 0.26);
      V.svg('rect', { x: r1(cx - S / 2), y: r1(cy - S / 2), width: S, height: S, rx: 4, class: 'viz-es-plane' }, svg);
      V.svg('circle', { cx: r1(cx), cy: r1(cy), r: r1(R), class: 'viz-es-unit' }, svg);
      t(svg, cx, cy + R + 15, '‖x‖ = 1', 'viz-s', 'middle');
      const P = (v) => [cx + v[0] * R, cy - v[1] * R];
      // documentos
      DOCS.forEach((d) => {
        const p = P(docVec(d)), inTop = top.some((x) => x.d.id === d.id), pos = d.id === Q.pos, hard = d.id === Q.hard;
        V.svg('path', { d: 'M' + r1(cx) + ' ' + r1(cy) + 'L' + r1(p[0]) + ' ' + r1(p[1]), class: 'viz-es-ray is-t' + d.topic + (inTop ? ' is-top' : '') }, svg);
        V.svg('circle', { cx: r1(p[0]), cy: r1(p[1]), r: inTop ? 6 : 4.5, class: 'viz-es-doc is-t' + d.topic + (inTop ? ' is-top' : '') + (pos ? ' is-pos' : '') }, svg);
        if (hard) V.svg('circle', { cx: r1(p[0]), cy: r1(p[1]), r: 9, class: 'viz-es-hardring' }, svg);
        const lab = String(DOCS.indexOf(d) + 1);
        const off = [Math.cos(d.a * DEG) * 12, -Math.sin(d.a * DEG) * 12];
        t(svg, p[0] + off[0], p[1] + off[1] + 4, lab, 'viz-es-dlab', 'middle');
      });
      // consulta
      const qp = P(qv);
      V.svg('path', { d: 'M' + r1(cx) + ' ' + r1(cy) + 'L' + r1(qp[0]) + ' ' + r1(qp[1]), class: 'viz-es-q' }, svg);
      V.svg('path', { d: 'M' + r1(qp[0] - 6) + ' ' + r1(qp[1]) + 'L' + r1(qp[0]) + ' ' + r1(qp[1] - 6) + 'L' + r1(qp[0] + 6) + ' ' + r1(qp[1]) + 'L' + r1(qp[0]) + ' ' + r1(qp[1] + 6) + 'Z', class: 'viz-es-qpt' }, svg);
      t(svg, qp[0] + Math.cos(state.ang * DEG) * 14, qp[1] - Math.sin(state.ang * DEG) * 14 + 4, 'q', 'viz-es-qlab', 'middle');
      // ---- lista: ranking con barras
      const lx = narrow ? 8 : 8 + S + 24, ly = narrow ? 44 + S + 24 : 50, lw = W - lx - 8;
      t(svg, lx, ly, 'q = «' + Q.t + '»', 'viz-n');
      const maxS = Math.max(...scored.map((x) => Math.abs(x.s)), 1);
      const bx = lx + (narrow ? 0 : 236), bw = narrow ? lw - 46 : lw - 236 - 46;
      scored.forEach((x, i) => {
        const y = ly + 22 + i * (narrow ? 30 : 19), inTop = i < state.k;
        const lab = (i + 1) + '. [' + (DOCS.indexOf(x.d) + 1) + '] ' + x.d.t + (x.d.id === Q.pos ? ' ✓' : x.d.id === Q.hard ? ' (difícil)' : '');
        t(svg, lx, y, lab, 'viz-es-row' + (inTop ? ' is-top' : '') + (x.d.id === Q.pos ? ' is-pos' : ''));
        const yb = narrow ? y + 5 : y - 9;
        const w = bw * Math.max(0, x.s) / maxS;
        V.svg('rect', { x: r1(bx), y: r1(yb), width: r1(Math.max(1.5, w)), height: narrow ? 8 : 10, class: 'viz-es-bar is-t' + x.d.topic + (inTop ? ' is-top' : '') }, svg);
        t(svg, bx + Math.max(1.5, w) + 5, yb + (narrow ? 8 : 9), f2(x.s), 'viz-n');
        if (inTop && i === state.k - 1) V.svg('path', { d: 'M' + r1(lx) + ' ' + r1(y + (narrow ? 17 : 6)) + 'H' + r1(W - 8), class: 'viz-es-cut' }, svg);
      });
      const yEnd = narrow ? ly + 22 + scored.length * 30 + 4 : Math.max(44 + S, ly + 22 + scored.length * 19);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(yEnd + 12));
      const rp = rankOf(Q.pos), rh = rankOf(Q.hard), r9 = rankOf('d9');
      svg.setAttribute('aria-label', 'Consulta «' + Q.t + '», ' + (state.norm ? 'coseno' : 'producto punto') + '. Ranking: ' + scored.map((x, i) => (i + 1) + ' ' + x.d.t + ' ' + f2(x.s)).join('; ') + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('positivo:', 'puesto ' + rp + (rp <= state.k ? ' (en el top-' + state.k + ')' : ' (fuera del top-' + state.k + ')'));
      kv('negativo difícil:', 'puesto ' + rh);
      kv('portada popular:', 'puesto ' + r9 + (state.norm ? '' : ' (norma ' + DOCS[9].n + ')'));
      kv('recall@' + state.k + ':', rp <= state.k ? '1' : '0');
      note.textContent = state.norm
        ? 'Con coseno solo importa la dirección. El negativo difícil comparte palabras con la consulta ("arroz", "Coliseo", "Python") y queda cerca: BM25 lo pondría arriba; un buen encoder lo separa del positivo solo si lo vio como negativo al entrenar. Prueba "punto sin normalizar": la portada, con norma 1.85, sube en el ranking sin responder nada.'
        : 'Sin normalizar, el puntaje es ‖q‖·‖d‖·cos: un documento de norma grande sube aunque apunte a otro lado. DPR entrena con producto punto (y los índices MIPS lo buscan tal cual); los modelos tipo sentence-transformers normalizan y usan coseno. Lo importante: buscar con el mismo puntaje con el que se entrenó.';
    }

    function drawBatch(svg, t, W, narrow) {
      const B = QUERIES.length;
      const cols = DOCS.filter((d) => QUERIES.some((qq) => qq.pos === d.id)).sort((a, b) => QUERIES.findIndex((qq) => qq.pos === a.id) - QUERIES.findIndex((qq) => qq.pos === b.id));
      const hards = state.hard ? QUERIES.map((qq) => DOCS.find((d) => d.id === qq.hard)) : [];
      const allCols = cols.concat(hards);
      const rows = QUERIES.map((qq) => {
        const qv = vec(qq.a, 1);
        const s = allCols.map((d) => dot(qv, docVec(d)));
        const z = s.map((v) => v / state.tau), mx = Math.max(...z), e = z.map((v) => Math.exp(v - mx)), Z = e.reduce((a, b) => a + b, 0);
        return { qq, s, p: e.map((v) => v / Z) };
      });
      const loss = rows.map((r, i) => -Math.log(r.p[i]));
      const mean = loss.reduce((a, b) => a + b, 0) / B;
      t(svg, 8, 15, narrow ? 'Negativos in-batch: matriz B×B' : 'Negativos in-batch: cada consulta contra los positivos de las demás (B = ' + B + ')' + (state.hard ? ' + un negativo difícil por consulta' : ''), 'viz-t');
      t(svg, 8, 29, narrow ? 'softmax por fila con τ = ' + state.tau : 'softmax por fila de s/τ (τ = ' + state.tau + ', puntaje ' + (state.norm ? 'coseno' : 'producto punto') + '); la diagonal es el par correcto; pérdida = −log p(diagonal)', 'viz-s');
      const nC = allCols.length, x0 = narrow ? 30 : 190, cs = narrow ? Math.min(38, (W - x0 - 40) / nC) : 54, y0 = narrow ? 70 : 76;
      // encabezados de columna
      allCols.forEach((d, j) => {
        const cx = x0 + j * cs + cs / 2;
        t(svg, cx, y0 - 8, (j < B ? 'd' + (j + 1) + '⁺' : 'h' + (j - B + 1)), 'viz-es-col' + (j >= B ? ' is-hard' : ''), 'middle');
      });
      if (state.hard) t(svg, x0 + B * cs + (nC - B) * cs / 2, y0 - 24, 'difíciles', 'viz-s', 'middle');
      if (narrow) t(svg, x0 + nC * cs + 8, y0 - 8, 'pérd.', 'viz-s');
      t(svg, x0 + B * cs / 2, y0 - 24, 'positivos del lote', 'viz-s', 'middle');
      rows.forEach((r, i) => {
        const y = y0 + i * cs;
        t(svg, narrow ? 8 : 8, y + cs / 2 + 4, narrow ? 'q' + (i + 1) : 'q' + (i + 1) + ' ' + r.qq.t, 'viz-es-rowq');
        r.p.forEach((p, j) => {
          const x = x0 + j * cs;
          V.svg('rect', { x: r1(x + 1), y: r1(y + 1), width: r1(cs - 2), height: r1(cs - 2), class: 'viz-es-cell', style: 'fill-opacity:' + Math.round((0.08 + 0.92 * p) * 100) / 100 }, svg);
          if (i === j) V.svg('rect', { x: r1(x + 1), y: r1(y + 1), width: r1(cs - 2), height: r1(cs - 2), class: 'viz-es-diag' }, svg);
          if (cs >= 26) t(svg, x + cs / 2, y + cs / 2 + 4, p >= 0.995 ? '1.00' : p.toFixed(2).replace(/^0/, ''), 'viz-es-p' + (p > 0.55 ? ' is-hi' : ''), 'middle');
        });
        t(svg, x0 + nC * cs + 8, y + cs / 2 + 4, (narrow ? '' : 'pérdida ') + f2(loss[i]), 'viz-n');
      });
      let yy = y0 + B * cs + 24;
      t(svg, 8, yy, 'pérdida media (InfoNCE) = ' + f2(mean), 'viz-n');
      yy += 16;
      t(svg, 8, yy, narrow ? 'celda = p de la softmax de la fila' : 'cada celda: probabilidad de la softmax de su fila; recuadro = el par correcto', 'viz-s');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(yy + 10));
      svg.setAttribute('aria-label', 'Lote de ' + B + ' pares' + (state.hard ? ' con un negativo difícil por consulta' : '') + ', τ = ' + state.tau + '. Probabilidad del par correcto por fila: ' + rows.map((r, i) => 'q' + (i + 1) + ' ' + r.p[i].toFixed(2)).join(', ') + '. Pérdida media ' + f2(mean) + '.');
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('negativos por consulta:', String(nC - 1) + (state.hard ? ' (' + (B - 1) + ' positivos ajenos + ' + B + ' difíciles: el suyo y los de las demás)' : ' (los positivos de las demás)'));
      kv('τ:', String(state.tau));
      kv('pérdida media:', f2(mean));
      note.textContent = 'Los negativos salen gratis: los positivos de las otras consultas del lote ya están codificados, así que un lote de B da B·(B − 1) negativos sin pasar más documentos por el encoder (DPR, §3.2). Con lotes grandes la tarea se vuelve difícil y el encoder aprende más; con un negativo difícil (de BM25) la pérdida sube porque hay un documento parecido que separar. τ chica (escala alta) hace la softmax casi un argmax: sin ella, con coseno ∈ [−1, 1] la pérdida casi no baja. Es la misma InfoNCE de CLIP (#clip), con texto en las dos torres.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); state.ang = (state.ang + (k === 'ArrowLeft' ? 5 : -5) + 360) % 360; draw(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); state.q = (state.q + (k === 'ArrowDown' ? 1 : QUERIES.length - 1)) % QUERIES.length; state.ang = QUERIES[state.q].a; draw(); }
      else if (k === 'n' || k === 'N') { ev.preventDefault(); state.norm = !state.norm; draw(); }
      else if (k === 'b' || k === 'B') { ev.preventDefault(); state.mode = state.mode === 'rank' ? 'batch' : 'rank'; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('embedding-space', render);
})(typeof window !== 'undefined' ? window : globalThis);
