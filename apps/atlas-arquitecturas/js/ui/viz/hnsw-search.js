/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/hnsw-search.js
   Visualización "hnsw-search" (SPEC §7.8, §23.4): búsqueda en un HNSW chico (sintético, ilustrativo), paso a paso.
   El grafo se construye de verdad con el algoritmo del paper (Malkov & Yashunin, arXiv:1603.09320): nivel de cada punto
   l = ⌊−ln(U)·m_L⌋ con m_L = 1/ln(M) (Alg. 1), inserción desde el punto de entrada bajando por las capas, M vecinos por capa
   (2·M en la capa 0, como hnswlib/FAISS) con la selección simple (Alg. 3) y recorte de los enlaces de vuelta; efConstruction
   = 32. La búsqueda es la del paper (Alg. 5 + Alg. 2): en cada capa de arriba, codiciosa con ef = 1 (salta al vecino más cercano
   hasta no mejorar); en la capa 0, la lista de candidatos de tamaño efSearch; devuelve los k más cercanos.
   Se ve cada expansión: el nodo que se expande, los visitados (cada uno = un cómputo de distancia), la lista W, los saltos y,
   al final, el top-k contra el exacto (recall@k). 60 puntos en 2-D: la escala real (1M vectores de 768) va en la nota, del
   calculador (modelo `ann`) si está.
   params: { M:4, ef:8, k:5, seed:7, query:0 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const N = 60, EFC = 32, MAXL = 3;
  const MS = [3, 4, 6], EFS = [1, 5, 10, 20], KS = [1, 5];

  // ---- construcción (pura, sin DOM)
  function build(M, seed, rng0) {
    const rng = rng0(seed);
    const pts = Array.from({ length: N }, () => [0.04 + 0.92 * rng(), 0.04 + 0.92 * rng()]);
    const mL = 1 / Math.log(M);
    const lvl = pts.map(() => Math.min(MAXL, Math.floor(-Math.log(1 - rng()) * mL)));
    const D = (a, b) => { const dx = pts[a][0] - pts[b][0], dy = pts[a][1] - pts[b][1]; return dx * dx + dy * dy; };
    const links = pts.map((p, i) => Array.from({ length: lvl[i] + 1 }, () => []));
    let ep = 0, L = lvl[0];
    const search = (qd, eps, ef, lc) => {
      const vis = new Set(eps), C = eps.slice(), Wl = eps.slice();
      while (C.length) {
        C.sort((a, b) => qd(a) - qd(b));
        const c = C.shift();
        Wl.sort((a, b) => qd(a) - qd(b));
        if (qd(c) > qd(Wl[Wl.length - 1])) break;
        for (const e of links[c][lc] || []) {
          if (vis.has(e)) continue;
          vis.add(e);
          Wl.sort((a, b) => qd(a) - qd(b));
          if (Wl.length < ef || qd(e) < qd(Wl[Wl.length - 1])) { C.push(e); Wl.push(e); Wl.sort((a, b) => qd(a) - qd(b)); if (Wl.length > ef) Wl.pop(); }
        }
      }
      return Wl.sort((a, b) => qd(a) - qd(b));
    };
    for (let i = 1; i < N; i++) {
      const qd = (j) => D(i, j);
      let eps = [ep];
      for (let lc = L; lc > lvl[i]; lc--) eps = [search(qd, eps, 1, lc)[0]];
      for (let lc = Math.min(L, lvl[i]); lc >= 0; lc--) {
        const Wl = search(qd, eps, EFC, lc);
        const mmax = lc === 0 ? 2 * M : M;
        const nb = Wl.slice(0, M);
        links[i][lc] = nb.slice();
        for (const e of nb) {
          const le = links[e][lc];
          le.push(i);
          if (le.length > mmax) { le.sort((a, b) => D(e, a) - D(e, b)); le.length = mmax; }
        }
        eps = Wl;
      }
      if (lvl[i] > L) { L = lvl[i]; ep = i; }
    }
    return { pts, lvl, links, ep, L, M };
  }

  // ---- búsqueda con traza (Alg. 5): un paso por nodo expandido {lc, c, pc (quién lo descubrió), news, W, nd}
  function searchTrace(G, q, ef, k) {
    const qd = (j) => { const dx = G.pts[j][0] - q[0], dy = G.pts[j][1] - q[1]; return dx * dx + dy * dy; };
    const steps = [];
    let nd = 1;
    steps.push({ lc: G.L, c: null, pc: null, news: [G.ep], W: [G.ep], nd, note: 'entrada' });
    const layer = (eps, ef2, lc) => {
      const vis = new Set(eps), C = eps.slice(), Wl = eps.slice(), par = new Map();
      while (C.length) {
        C.sort((a, b) => qd(a) - qd(b));
        const c = C.shift();
        Wl.sort((a, b) => qd(a) - qd(b));
        if (qd(c) > qd(Wl[Wl.length - 1])) { steps.push({ lc, c: null, pc: null, news: [], W: Wl.slice(), nd, stop: true }); break; }
        const news = [];
        for (const e of G.links[c][lc] || []) {
          if (vis.has(e)) continue;
          vis.add(e); nd++; news.push(e); par.set(e, c);
          Wl.sort((a, b) => qd(a) - qd(b));
          if (Wl.length < ef2 || qd(e) < qd(Wl[Wl.length - 1])) { C.push(e); Wl.push(e); Wl.sort((a, b) => qd(a) - qd(b)); if (Wl.length > ef2) Wl.pop(); }
        }
        steps.push({ lc, c, pc: par.has(c) ? par.get(c) : null, news, W: Wl.slice(), nd });
      }
      return Wl.sort((a, b) => qd(a) - qd(b));
    };
    let eps = [G.ep];
    for (let lc = G.L; lc >= 1; lc--) { eps = [layer(eps, 1, lc)[0]]; steps.push({ lc, c: null, pc: null, news: [], W: eps.slice(), nd, down: true, best: eps[0] }); }
    const W0 = layer(eps, Math.max(ef, k), 0);
    const res = W0.slice(0, k);
    const exact = G.pts.map((p, j) => j).sort((a, b) => qd(a) - qd(b)).slice(0, k);
    steps.push({ lc: 0, c: null, pc: null, news: [], W: W0.slice(), nd, done: true, res });
    const expanded0 = steps.filter((x) => x.lc === 0 && x.c != null).length;
    return { steps, res, exact, nd, expanded0, recall: res.filter((j) => exact.indexOf(j) >= 0).length / k };
  }

  function calcNote() {
    const A = ATLAS.Arch;
    if (!A || typeof A.metrics !== 'function') return null;
    const get = (cfg) => { try { return A.metrics(cfg); } catch (e) { return null; } };
    const h = get('hnsw-1m-768'), f = get('flat-1m-768');
    if (!h) return null;
    const pick = (o, ks) => { for (const k of ks) if (o && Number.isFinite(+o[k])) return +o[k]; return undefined; };
    const dh = pick(h, ['distanceComputations', 'distComps', 'distanceComps']), df = f ? pick(f, ['distanceComputations', 'distComps', 'distanceComps']) : undefined;
    let cfg = null;
    try { cfg = A.run('hnsw-1m-768').config; } catch (e) { cfg = null; }
    return dh ? { dh, df, cfg } : null;
  }

  function render(el, params) {
    const V = ATLAS.Viz;
    const fint = (ATLAS.Arch && ATLAS.Arch.fmt && ATLAS.Arch.fmt.int) || ((n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    const state = { M: MS.indexOf(+params.M) >= 0 ? +params.M : 4, ef: EFS.indexOf(+params.ef) >= 0 ? +params.ef : 10, k: KS.indexOf(+params.k) >= 0 ? +params.k : 5, seed: Number.isFinite(+params.seed) ? +params.seed : 7, qi: Number.isFinite(+params.query) ? +params.query : 0, step: 0, exact: false };
    let G = null, T = null, q = null;
    const rebuild = () => { G = build(state.M, state.seed, V.rng); };
    const requery = () => { const rq = V.rng(9001 + state.qi * 131); q = [0.08 + 0.84 * rq(), 0.08 + 0.84 * rq()]; };
    const research = (toEnd) => { T = searchTrace(G, q, state.ef, state.k); state.step = toEnd ? T.steps.length - 1 : 0; };

    const wrap = V.html('div', { class: 'viz viz-hn' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const all = [];
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const chip = (g, label, key, v, after) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label }, g); b.addEventListener('click', () => { state[key] = v; after(); draw(); }); b._k = key; b._v = v; all.push(b); return b; };
    const act = (g, label, fn) => { const b = V.html('button', { type: 'button', class: 'viz-chip', text: label }, g); b.addEventListener('click', () => { fn(); draw(); }); return b; };
    const gS = grp('Búsqueda');
    const bPrev = act(gS, '← Paso', () => { state.step = Math.max(0, state.step - 1); });
    const bNext = act(gS, 'Paso →', () => { state.step = Math.min(T.steps.length - 1, state.step + 1); });
    act(gS, 'Hasta el final', () => { state.step = T.steps.length - 1; });
    act(gS, 'Otra consulta', () => { state.qi++; requery(); research(false); });
    const gE = grp('efSearch');
    EFS.forEach((v) => chip(gE, String(v), 'ef', v, () => research(true)));
    const gK = grp('k');
    KS.forEach((v) => chip(gK, String(v), 'k', v, () => research(true)));
    const gM = grp('M');
    MS.forEach((v) => chip(gM, String(v), 'M', v, () => { rebuild(); research(true); }));
    const gX = grp('Exacto');
    chip(gX, 'mostrar', 'exact', true, () => {}); chip(gX, 'ocultar', 'exact', false, () => {});
    V.html('span', { class: 'viz-tag', text: 'ilustrativo' }, ctl);
    const stage = V.html('div', { class: 'viz-stage viz-hn-stage', tabindex: 0, role: 'group', 'aria-label': 'Búsqueda en HNSW. Flecha derecha: siguiente paso; izquierda: anterior; Fin: hasta el final; Inicio: reiniciar; N: otra consulta; E: cambiar efSearch; X: mostrar el exacto' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      bPrev.disabled = state.step === 0; bNext.disabled = state.step >= T.steps.length - 1;
      const st = T.steps[state.step];
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      const efE = Math.max(state.ef, state.k);
      t(svg, 8, 15, narrow ? 'HNSW: bajar por las capas' : 'HNSW: entrar arriba, bajar codicioso (ef = 1) y en la capa 0 buscar con efSearch = ' + state.ef + (efE > state.ef ? ' (se usa max(efSearch, k) = ' + efE + ')' : ''), 'viz-t');
      t(svg, 8, 29, narrow ? N + ' puntos 2-D, M = ' + state.M + ' (ilustrativo)' : N + ' puntos en 2-D (sintético), M = ' + state.M + ' (2·M = ' + 2 * state.M + ' en la capa 0), grafo construido con el algoritmo del paper', 'viz-s');
      // capas superiores (arriba, chicas) y la capa 0 (grande)
      const ups = []; for (let l = G.L; l >= 1; l--) ups.push(l);
      const gap = narrow ? 8 : 14;
      const su = ups.length ? Math.min(narrow ? 140 : 190, (W - 16 - (ups.length - 1) * gap) / ups.length) : 0;
      const s0 = narrow ? W - 16 : 400;
      const y1 = 50, y0 = ups.length ? y1 + su + 34 : y1;
      const panel = (l, x, y, s) => {
        const g = V.svg('g', { class: 'viz-hn-panel' + (st.lc === l && !st.done ? ' is-cur' : '') }, svg);
        V.svg('rect', { x: r1(x), y: r1(y), width: r1(s), height: r1(s), rx: 4, class: 'viz-hn-bg' }, g);
        const cnt = G.lvl.filter((v) => v >= l).length;
        t(g, x, y - 6, narrow && l > 0 ? 'capa ' + l + ' · ' + cnt : 'capa ' + l + (l === G.L ? ' (entrada)' : '') + ' · ' + cnt + ' nodos', 'viz-s');
        const P = (j) => [x + G.pts[j][0] * s, y + G.pts[j][1] * s];
        let d = '';
        for (let j = 0; j < N; j++) if (G.lvl[j] >= l) for (const e of G.links[j][l] || []) if (e > j || (G.links[e][l] || []).indexOf(j) < 0) { const a = P(j), b = P(e); d += 'M' + r1(a[0]) + ' ' + r1(a[1]) + 'L' + r1(b[0]) + ' ' + r1(b[1]); }
        V.svg('path', { d, class: 'viz-hn-edge' }, g);
        // estado de la búsqueda en esta capa (pasos ya hechos)
        const upto = T.steps.slice(0, state.step + 1).filter((x) => x.lc === l);
        const visited = new Set(); upto.forEach((x) => x.news.forEach((j) => visited.add(j)));
        if (l === G.L && state.step >= 0) visited.add(G.ep);
        const last = upto[upto.length - 1];
        const Wset = new Set(last && last.W ? last.W : []);
        // recorrido: cada nodo expandido unido al que lo descubrió (aristas reales del grafo de esa capa)
        const tree = upto.filter((x) => x.c != null && x.pc != null).map((x) => 'M' + r1(P(x.pc)[0]) + ' ' + r1(P(x.pc)[1]) + 'L' + r1(P(x.c)[0]) + ' ' + r1(P(x.c)[1])).join('');
        if (tree) V.svg('path', { d: tree, class: 'viz-hn-path' }, g);
        const expd = new Set(upto.filter((x) => x.c != null).map((x) => x.c));
        const r = s > 200 ? 3.6 : s > 120 ? 3 : 2.4;
        const resSet = new Set(st.done && l === 0 ? st.res : []), exSet = new Set(state.exact && l === 0 ? T.exact : []);
        for (let j = 0; j < N; j++) {
          if (G.lvl[j] < l) continue;
          const p = P(j);
          const cls = resSet.has(j) ? ' is-res' : Wset.has(j) && l === 0 ? ' is-w' : visited.has(j) ? ' is-vis' : '';
          V.svg('circle', { cx: r1(p[0]), cy: r1(p[1]), r: r1(cls ? r + 0.8 : r), class: 'viz-hn-pt' + cls + (expd.has(j) ? ' is-exp' : '') }, g);
          if (exSet.has(j)) V.svg('circle', { cx: r1(p[0]), cy: r1(p[1]), r: r1(r + 3.4), class: 'viz-hn-exact' }, g);
        }
        if (last && last.c != null && l === st.lc && !st.done) { const p = P(last.c); V.svg('circle', { cx: r1(p[0]), cy: r1(p[1]), r: r1(r + 4), class: 'viz-hn-cur' }, g); }
        if (l === G.L) { const p = P(G.ep); V.svg('circle', { cx: r1(p[0]), cy: r1(p[1]), r: r1(r + 2.2), class: 'viz-hn-ep' }, g); }
        const qp = [x + q[0] * s, y + q[1] * s], k = s > 200 ? 6 : 4.5;
        V.svg('path', { d: 'M' + r1(qp[0] - k) + ' ' + r1(qp[1]) + 'L' + r1(qp[0]) + ' ' + r1(qp[1] - k) + 'L' + r1(qp[0] + k) + ' ' + r1(qp[1]) + 'L' + r1(qp[0]) + ' ' + r1(qp[1] + k) + 'Z', class: 'viz-hn-q' }, g);
      };
      ups.forEach((l, i) => panel(l, 8 + i * (su + gap), y1, su));
      if (ups.length > 0) {
        // flecha "baja" entre las capas de arriba y la 0
        const ax = narrow ? W / 2 : 8 + s0 / 2;
        V.svg('path', { d: 'M' + r1(ax) + ' ' + r1(y1 + su + 6) + 'V' + r1(y0 - 18), class: 'viz-hn-down' }, svg);
        V.svg('path', { d: 'M' + r1(ax - 4) + ' ' + r1(y0 - 22) + 'L' + r1(ax) + ' ' + r1(y0 - 16) + 'L' + r1(ax + 4) + ' ' + r1(y0 - 22), class: 'viz-hn-down' }, svg);
        // a 375 px el texto va a la izquierda de la flecha (a la derecha se cortaba: "baja de c…")
        if (narrow) t(svg, ax - 8, y0 - 18, 'el mejor nodo baja', 'viz-s', 'end');
        else t(svg, ax + 8, y0 - 18, 'el mejor nodo de cada capa es la entrada de la siguiente', 'viz-s');
      }
      panel(0, 8, y0, s0);
      // leyenda + lectura a la derecha (escritorio) o debajo (teléfono)
      let lx = narrow ? 8 : 8 + s0 + 24, ly = narrow ? y0 + s0 + 22 : y0 + 4;
      const items = (narrow
        ? [['viz-hn-q', 'consulta'], ['viz-hn-ep', 'entrada'], ['viz-hn-pt is-vis', 'visitado'], ['viz-hn-pt is-exp', 'expandido'], ['viz-hn-pt is-w', 'en la lista W'], ['viz-hn-pt is-res', 'top-k devuelto']]
        : [['viz-hn-q', 'consulta'], ['viz-hn-ep', 'punto de entrada'], ['viz-hn-pt is-vis', 'visitado (1 distancia)'], ['viz-hn-pt is-exp', 'expandido (mide sus vecinos)'], ['viz-hn-pt is-w', 'en la lista W'], ['viz-hn-pt is-res', 'top-k devuelto']]).concat(state.exact ? [['viz-hn-exact', 'top-k exacto']] : []);
      items.forEach(([cls, lab], i) => {
        const xx = narrow ? 8 + (i % 2) * ((W - 16) / 2) : lx, yy = narrow ? ly + Math.floor(i / 2) * 17 : ly + i * 18;
        if (cls === 'viz-hn-q') V.svg('path', { d: 'M' + r1(xx) + ' ' + r1(yy - 4) + 'l5,-5l5,5l-5,5Z', class: cls }, svg);
        else V.svg('circle', { cx: r1(xx + 5), cy: r1(yy - 4), r: cls === 'viz-hn-exact' || cls === 'viz-hn-ep' ? 5.5 : 4, class: cls }, svg);
        t(svg, xx + 16, yy, lab, 'viz-s');
      });
      ly = narrow ? ly + Math.ceil(items.length / 2) * 17 + 10 : ly + items.length * 18 + 16;
      const what = st.done ? 'fin: devuelve los ' + state.k + ' mejores de W' : st.note === 'entrada' ? 'empieza en el punto de entrada (capa ' + G.L + ')' : st.down ? 'capa ' + st.lc + ': ya no mejora → el mejor (nodo ' + st.best + ') entra a la capa ' + (st.lc - 1) : st.stop ? 'capa ' + st.lc + ': el mejor candidato pendiente está más lejos que el peor de W → para' : 'capa ' + st.lc + ': expande el nodo ' + st.c + ' (' + (st.news.length === 0 ? 'sin vecinos nuevos' : st.news.length === 1 ? '1 vecino nuevo: 1 distancia' : st.news.length + ' vecinos nuevos: ' + st.news.length + ' distancias') + ')';
      const lines = [
        'paso ' + (state.step + 1) + ' de ' + T.steps.length,
        what,
        'distancias calculadas: ' + st.nd + ' de ' + N + ' (fuerza bruta: ' + N + ')',
      ].concat(st.done ? ['recall@' + state.k + ' = ' + T.recall.toFixed(2) + ' (contra el exacto)'] : []);
      lines.forEach((s, i) => {
        if (narrow) { const wl = wrapTxt(s, W - 16, 6.4); wl.forEach((ln, j) => t(svg, 8, ly + j * 14, ln, i === 1 ? 'viz-n' : 'viz-s')); ly += wl.length * 14 + 2; }
        else { const wl = wrapTxt(s, W - lx - 8, 6.6); wl.forEach((ln, j) => t(svg, lx, ly + j * 14, ln, i === 1 ? 'viz-n' : 'viz-s')); ly += wl.length * 14 + 4; }
      });
      const yEnd = Math.max(y0 + s0, ly);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(yEnd + 10));
      svg.setAttribute('aria-label', 'HNSW con ' + N + ' puntos, ' + (G.L + 1) + ' capas, M = ' + state.M + ', efSearch = ' + state.ef + '. Paso ' + (state.step + 1) + ' de ' + T.steps.length + ': ' + what + '. Distancias calculadas: ' + st.nd + '.' + (st.done ? ' Recall@' + state.k + ' = ' + T.recall.toFixed(2) + '.' : ''));
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv('capas:', String(G.L + 1));
      kv('distancias (búsqueda completa):', T.nd + ' de ' + N);
      kv('recall@' + state.k + ':', T.recall.toFixed(2));
      kv('nodos expandidos en la capa 0:', String(T.expanded0));
      const cn = calcNote();
      note.textContent = 'Arriba hay pocos nodos y enlaces largos (cada capa tiene ≈ 1/M de los nodos de la de abajo): se cruza el espacio en pocos saltos. En la capa 0 están todos y la lista W de tamaño efSearch evita quedarse en un mínimo local: más efSearch = más distancias y más recall. M sube el grado (más memoria y más distancias por salto, mejor recall).' + (cn ? ' A escala real (hnsw-1m-768: ' + fint(cn.cfg && cn.cfg.N || 1e6) + ' vectores' + (cn.cfg && cn.cfg.efSearch ? ', efSearch = ' + cn.cfg.efSearch : '') + '), el calculador estima ≈ ' + fint(cn.dh) + ' distancias por consulta' + (cn.df ? ' contra ' + fint(cn.df) + ' de la búsqueda exacta' : '') + '.' : '');
    }
    function wrapTxt(s, w, cw) { const words = String(s).split(' '), out2 = []; let cur = ''; words.forEach((wd) => { const tt = cur ? cur + ' ' + wd : wd; if (cur && tt.length * cw > w) { out2.push(cur); cur = wd; } else cur = tt; }); if (cur) out2.push(cur); return out2; }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowRight') { ev.preventDefault(); state.step = Math.min(T.steps.length - 1, state.step + 1); draw(); }
      else if (k === 'ArrowLeft') { ev.preventDefault(); state.step = Math.max(0, state.step - 1); draw(); }
      else if (k === 'End') { ev.preventDefault(); state.step = T.steps.length - 1; draw(); }
      else if (k === 'Home') { ev.preventDefault(); state.step = 0; draw(); }
      else if (k === 'n' || k === 'N') { ev.preventDefault(); state.qi++; requery(); research(false); draw(); }
      else if (k === 'e' || k === 'E') { ev.preventDefault(); state.ef = EFS[(EFS.indexOf(state.ef) + 1) % EFS.length]; research(true); draw(); }
      else if (k === 'x' || k === 'X') { ev.preventDefault(); state.exact = !state.exact; draw(); }
    });
    rebuild(); requery(); research(false);
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) {
    ATLAS.Viz.register('hnsw-search', render);
    ATLAS.Viz.hnsw = { build: (M, seed) => build(M, seed, ATLAS.Viz.rng), searchTrace };
  }
})(typeof window !== 'undefined' ? window : globalThis);
