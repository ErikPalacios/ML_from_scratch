/* =============================================================================
   Atlas de Arquitecturas — js/ui/flashcards.js
   Basado en apps/ml-system-design/js/ui/flashcards.js.
   ATLAS.Flashcards.render(container, route, ctx) — página 'flashcards' (SPEC §8.4).
   Mazo = ATLAS.flashcards() (sin compuerta de práctica en esta app). '#flashcards.<cardId>'
   (desde la búsqueda) pone esa tarjeta primero. Repetición espaciada Leitner (5 cajas) en
   ATLAS.store: dueCards / gradeCard / cardState / flashStats. Filtro guardado en pref 'flashFilter'
   (la página practica-<modelo> lo fija antes de enlazar aquí).
   Flujo: pregunta → "Mostrar respuesta" (Espacio) → Otra vez (1) / Difícil (2) / Bien (3).
   Preguntas y respuestas pueden traer {{…}} (ATLAS.Quantities.fill) y LaTeX \( \) / \[ \]
   (ATLAS.MathTex.typeset tras pintar).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const h = (...a) => ATLAS.dom.h(...a);
  const icon = (n) => (ATLAS.dom && ATLAS.dom.icon ? ATLAS.dom.icon(n) : '');

  const KIND_LABEL = { forma: 'Forma', formula: 'Fórmula', conteo: 'Conteo', concepto: 'Concepto', tradeoff: 'Trade-off', trampa: 'Trampa' };
  const KIND_ORDER = ['forma', 'formula', 'conteo', 'concepto', 'tradeoff', 'trampa'];
  const KIND_CLS = { trampa: 'chip--bad', conteo: 'chip--warn', forma: 'chip--accent', formula: 'chip--accent' };
  const GRADES = [
    { id: 'again', key: '1', label: 'Otra vez' },
    { id: 'hard', key: '2', label: 'Difícil' },
    { id: 'good', key: '3', label: 'Bien' },
  ];
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const reduced = () => (ATLAS.dom && ATLAS.dom.reducedMotion ? ATLAS.dom.reducedMotion() : false);
  const item = (s) => safe(() => (ATLAS.catalog().items || {})[s], null);
  const srcLabel = (s) => (s === 'general' ? 'General' : ((item(s) || {}).short || (item(s) || {}).title || String(s)));
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  function fillQ(html, source) {
    const Q = ATLAS.Quantities;
    const s = String(html == null ? '' : html);
    if (!Q || typeof Q.fill !== 'function' || s.indexOf('{{') < 0) return s;
    return safe(() => Q.fill(s, { config: (item(source) || {}).canonical, pageId: source }), s);
  }
  function typeset(el) {
    const M = ATLAS.MathTex;
    if (M && typeof M.typeset === 'function') { try { const p = M.typeset(el); if (p && p.catch) p.catch(() => {}); } catch (e) { /* LaTeX visible como respaldo */ } }
  }

  function visibleCards() { return safe(() => ATLAS.flashcards(), []).filter((c) => c && c.id); }

  function isTextEntry(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    return ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].indexOf((el.type || '').toLowerCase()) < 0;
  }

  // "en 10 min", "en 5 h", "mañana", "en 3 días"
  function fmtIn(ms) {
    if (ms <= MIN) return 'en un momento';
    if (ms < HOUR) return 'en ' + Math.round(ms / MIN) + ' min';
    if (ms < 18 * HOUR) return 'en ' + Math.round(ms / HOUR) + ' h';
    const d = Math.round(ms / DAY);
    return d <= 1 ? 'mañana' : 'en ' + d + ' días';
  }

  let mounted = null;

  function render(container, route, ctx) {
    if (mounted) { mounted.teardown(); mounted = null; }
    const store = (ctx && ctx.store) || ATLAS.store;
    const LEITNER = Array.isArray(store.LEITNER_DAYS) ? store.LEITNER_DAYS : [0, 1, 3, 7, 16];
    const deck = visibleCards();
    // Tarjeta pedida desde la búsqueda (#flashcards.<id>): va primero, solo en la primera sesión.
    let want = route && route.sectionId ? String(route.sectionId) : null;
    const byId = {};
    deck.forEach((c) => { byId[c.id] = c; });
    const m = item('flashcards') || {};

    const wrap = h('div', { class: 'px fc' });
    container.appendChild(wrap);
    const eb = h('p', { class: 'eyebrow' }, h('span', null, 'Práctica'));
    wrap.appendChild(h('header', { class: 'phead' }, eb,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, m.title || 'Flashcards'),
      h('p', { class: 'phead__en', lang: 'en' }, m.titleEn || 'Flashcards'),
      h('p', { class: 'phead__summary', html: String(m.summary || 'Repaso espaciado (Leitner) de formas, fórmulas, conteos, conceptos, trade-offs y trampas de cada arquitectura.') })));

    if (!deck.length) {
      wrap.appendChild(h('div', { class: 'px-empty' },
        h('p', { class: 'px-empty__t' }, 'El mazo está vacío'),
        h('p', { class: 'muted' }, 'Las tarjetas llegan con cada modelo. Empieza por ViT.'),
        h('p', null, h('a', { class: 'btn btn--primary', href: '#vit' }, 'Abrir ViT'))));
      return;
    }

    // ---------------------------------------------------------------- filtro
    const order = safe(() => ATLAS.courseOrder(), []) || [];
    const rank = (s) => (s === 'general' ? 1e6 : order.indexOf(s) >= 0 ? order.indexOf(s) : 1e5);
    const sources = Array.from(new Set(deck.map((c) => c.source))).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    const kinds = KIND_ORDER.filter((k) => deck.some((c) => c.kind === k))
      .concat(Array.from(new Set(deck.map((c) => c.kind))).filter((k) => k && KIND_ORDER.indexOf(k) < 0));
    const F = (() => {
      const f = store.pref('flashFilter') || {};
      return {
        mode: f.mode === 'all' ? 'all' : 'due',
        source: sources.indexOf(f.source) >= 0 ? f.source : 'all',
        kind: kinds.indexOf(f.kind) >= 0 ? f.kind : 'all',
      };
    })();
    // La tarjeta pedida debe caber en el filtro: si no, se quita el filtro que la oculta.
    if (want && byId[want]) {
      if (F.source !== 'all' && byId[want].source !== F.source) F.source = 'all';
      if (F.kind !== 'all' && byId[want].kind !== F.kind) F.kind = 'all';
    }
    const inFilter = (c) => (F.source === 'all' || c.source === F.source) && (F.kind === 'all' || c.kind === F.kind);
    const filteredIds = () => deck.filter(inFilter).map((c) => c.id);

    function setFilter(patch, focusSel) {
      Object.assign(F, patch);
      store.setPref('flashFilter', { mode: F.mode, source: F.source, kind: F.kind });
      startSession();
      paintFilters();
      paintStats();
      paintStage(false);
      if (focusSel) { const f = filtersEl.querySelector(focusSel); if (f) f.focus(); }
    }

    // ---------------------------------------------------------------- sesión
    let S = null;
    function startSession() {
      const ids = filteredIds();
      const pos = {};
      ids.forEach((id, i) => { pos[id] = i; });
      let queue;
      if (F.mode === 'due') {
        // Primero los repasos vencidos (el más atrasado primero), luego las nuevas en orden del mazo.
        queue = store.dueCards(ids).sort((a, b) => {
          const A = store.cardState(a), B = store.cardState(b);
          const sa = A.seen > 0 ? 0 : 1, sb = B.seen > 0 ? 0 : 1;
          return sa - sb || (sa === 0 ? A.due - B.due : 0) || pos[a] - pos[b];
        });
      } else {
        // Todas: las más débiles (caja baja) primero.
        queue = ids.slice().sort((a, b) => store.cardState(a).box - store.cardState(b).box || pos[a] - pos[b]);
      }
      if (want && byId[want]) queue = [want].concat(queue.filter((id) => id !== want));
      want = null;
      S = { queue, total: queue.length, finished: 0, counts: { again: 0, hard: 0, good: 0 }, revealed: false, graded: 0 };
    }

    function nextDueText(ids) {
      const now = Date.now();
      let min = Infinity;
      ids.forEach((id) => { const c = store.cardState(id); if (c.seen > 0 && c.due > now) min = Math.min(min, c.due); });
      return min === Infinity ? null : fmtIn(min - now);
    }

    function intervalText(grade, st) {
      if (grade === 'again') return 'vuelve en esta sesión';
      if (grade === 'hard') return st.box === 0 ? 'en 10 min' : 'en 1 día';
      const days = LEITNER[Math.min(4, st.box + 1)];
      return days === 1 ? 'en 1 día' : 'en ' + days + ' días';
    }

    // ---------------------------------------------------------------- filtros (UI)
    const filtersEl = h('div', { class: 'fc__filters' });
    function chipGroup(label, key, options) {
      return h('div', { class: 'fc__frow' },
        h('span', { class: 'fc__fk', id: 'fc-fk-' + key }, label),
        h('div', { class: 'fchips', role: 'group', 'aria-labelledby': 'fc-fk-' + key }, options.map(([v, t, n]) =>
          h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(F[key] === v), dataset: { k: key, v },
            on: { click: () => { if (F[key] !== v) setFilter({ [key]: v }, '.fchip[data-k="' + key + '"][data-v="' + v + '"]'); } } },
          t, n != null ? h('span', { class: 'fchip__n mono' }, String(n)) : null))));
    }
    function paintFilters() {
      filtersEl.innerHTML = '';
      const ids = filteredIds();
      const dueN = store.dueCards(ids).length;
      filtersEl.appendChild(h('div', { class: 'fc__frow' },
        h('span', { class: 'fc__fk', id: 'fc-fk-mode' }, 'Mostrar'),
        h('div', { class: 'seg fc__seg', role: 'group', 'aria-labelledby': 'fc-fk-mode' },
          [['due', 'Pendientes hoy', dueN], ['all', 'Todas', ids.length]].map(([v, t, n]) =>
            h('button', { type: 'button', 'aria-pressed': String(F.mode === v), dataset: { k: 'mode', v },
              on: { click: () => { if (F.mode !== v) setFilter({ mode: v }, '.fc__seg [data-v="' + v + '"]'); } } },
            t, h('span', { class: 'fchip__n mono' }, String(n)))))));
      const cnt = (pred) => deck.filter(pred).length;
      // Cada conteo aplica también la otra faceta activa: el chip promete lo que da al pulsarlo.
      if (sources.length > 1) filtersEl.appendChild(chipGroup('Fuente', 'source', [['all', 'Todas', cnt((c) => F.kind === 'all' || c.kind === F.kind)]].concat(sources.map((s) => [s, srcLabel(s), cnt((c) => c.source === s && (F.kind === 'all' || c.kind === F.kind))]))));
      filtersEl.appendChild(chipGroup('Tipo', 'kind', [['all', 'Todos', null]].concat(kinds.map((k) => [k, KIND_LABEL[k] || k, cnt((c) => c.kind === k && (F.source === 'all' || c.source === F.source))]))));
    }

    // ---------------------------------------------------------------- estadísticas
    const statsEl = h('aside', { class: 'fc__stats', 'aria-label': 'Estado del mazo' });
    function paintStats() {
      statsEl.innerHTML = '';
      const ids = filteredIds();
      const st = store.flashStats ? store.flashStats(ids) : { total: ids.length, due: store.dueCards(ids).length, seen: 0, boxes: [ids.length, 0, 0, 0, 0] };
      const maxBox = Math.max(1, ...st.boxes);
      const nd = nextDueText(ids);
      statsEl.appendChild(h('p', { class: 'px-k' }, F.source === 'all' && F.kind === 'all' ? 'Estado del mazo' : 'Estado del filtro'));
      statsEl.appendChild(h('div', { class: 'stat-line fc__nums' },
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(st.due)), h('span', { class: 'stat__k' }, 'pendientes hoy')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(st.total)), h('span', { class: 'stat__k' }, 'tarjetas')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(st.seen)), h('span', { class: 'stat__k' }, 'vistas'))));
      statsEl.appendChild(h('div', { class: 'fc__boxes' },
        h('div', { class: 'boxes', role: 'img', 'aria-label': 'Tarjetas por caja de Leitner, de la 0 a la 4: ' + st.boxes.join(', ') },
          st.boxes.map((n, i) => h('div', { class: 'boxes__col', title: 'Caja ' + i + ': ' + plural(n, 'tarjeta', 'tarjetas') },
            h('span', { class: 'boxes__n' }, String(n)),
            h('span', { class: 'boxes__bar', style: { height: (n ? Math.max(3, Math.round(Math.sqrt(n / maxBox) * 20)) : 1) + 'px' } }),
            h('span', { class: 'boxes__k' }, String(i)),
            h('span', { class: 'fc__int' }, LEITNER[i] ? LEITNER[i] + ' d' : 'hoy')))),
        h('span', { class: 'stat__k' }, 'Tarjetas por caja de Leitner y cada cuánto vuelve cada una.')));
      statsEl.appendChild(h('p', { class: 'fc__leitner' },
        h('b', null, 'Bien'), ' sube una caja; ', h('b', null, 'Difícil'), ' la deja donde está; ', h('b', null, 'Otra vez'), ' la regresa a la 0.'));
      if (nd) statsEl.appendChild(h('p', { class: 'fc__next' }, 'Próximo repaso ', nd, '.'));
    }

    // ---------------------------------------------------------------- escenario (tarjeta / resumen / vacío)
    const stage = h('section', { class: 'fc__stage', 'aria-label': 'Repaso' });
    function paintStage(focus) {
      stage.innerHTML = '';
      if (!S.total && !S.graded) { paintEmpty(); return; }
      if (!S.queue.length) { paintSummary(focus); return; }
      paintCard(focus);
    }

    function paintEmpty() {
      const ids = filteredIds();
      if (!ids.length) {
        stage.appendChild(h('div', { class: 'px-empty' },
          h('p', { class: 'px-empty__t' }, 'No hay tarjetas con este filtro'),
          h('button', { type: 'button', class: 'btn', on: { click: () => setFilter({ source: 'all', kind: 'all' }) } }, 'Quitar filtros')));
        return;
      }
      const nd = nextDueText(ids);
      stage.appendChild(h('div', { class: 'px-empty fc-done' },
        h('span', { class: 'fc-done__mark', html: icon('check') }),
        h('p', { class: 'px-empty__t', tabindex: '-1' }, 'Todo al día'),
        h('p', { class: 'muted' }, 'No tienes tarjetas pendientes hoy' + (F.source !== 'all' || F.kind !== 'all' ? ' con este filtro' : '') + '.' + (nd ? ' El próximo repaso vence ' + nd + '.' : '')),
        h('p', null, h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => setFilter({ mode: 'all' }) } },
          h('span', { html: icon('cards') }), 'Repasar todo igual'))));
    }

    function paintCard(focus) {
      const id = S.queue[0];
      const card = byId[id];
      const st = store.cardState(id);
      const done = S.finished;
      const qEl = h('div', { class: 'fcard__q', id: 'fc-q', tabindex: '-1', html: fillQ(card.q, card.source) });
      const src = card.source !== 'general' && item(card.source)
        ? h('a', { class: 'chip', href: '#' + card.source, title: 'Tarjeta de ' + srcLabel(card.source) }, srcLabel(card.source))
        : h('span', { class: 'chip' }, srcLabel(card.source));
      const headEl = h('header', { class: 'fcard__head' },
        h('div', { class: 'fcard__prog' },
          h('span', { class: 'fcard__pos mono' }, 'Tarjeta ' + Math.min(S.total, done + 1) + ' de ' + S.total),
          h('span', { class: 'fcard__bar', 'aria-hidden': 'true' }, h('i', { style: { width: (S.total ? (done / S.total) * 100 : 0) + '%' } })),
          S.queue.length > 1 ? h('span', { class: 'fcard__left mono' }, 'quedan ' + S.queue.length) : null),
        h('div', { class: 'fcard__tags' }, src, card.kind ? h('span', { class: 'chip ' + (KIND_CLS[card.kind] || '') }, KIND_LABEL[card.kind] || card.kind) : null,
          h('span', { class: 'fcard__box mono', title: st.seen ? 'Vista ' + plural(st.seen, 'vez', 'veces') : 'Tarjeta nueva' }, st.seen ? 'caja ' + st.box : 'nueva')));
      let body;
      if (!S.revealed) {
        body = h('div', { class: 'fcard__actions' },
          h('button', { type: 'button', class: 'btn btn--primary btn--lg fcard__reveal', on: { click: reveal } },
            'Mostrar respuesta', h('kbd', null, 'Espacio')));
      } else {
        body = h('div', null,
          h('div', { class: 'fcard__a', id: 'fc-a', tabindex: '-1' },
            h('p', { class: 'fcard__ak' }, 'Respuesta'),
            h('div', { class: 'fcard__ahtml', html: fillQ(card.a, card.source) })),
          h('div', { class: 'fcard__grades', role: 'group', 'aria-label': '¿Qué tan bien la recordaste?' }, GRADES.map((g) =>
            h('button', { type: 'button', class: 'grade grade--' + g.id, on: { click: () => grade(g.id) } },
              h('span', { class: 'grade__top' }, h('kbd', null, g.key), h('span', { class: 'grade__t' }, g.label)),
              h('span', { class: 'grade__s' }, intervalText(g.id, st))))));
      }
      const art = h('article', { class: 'fcard' + (S.revealed ? ' is-revealed' : ''), 'aria-labelledby': 'fc-q' }, headEl, qEl, body);
      stage.appendChild(art);
      if (ATLAS.Blocks && ATLAS.Blocks.decorate) safe(() => ATLAS.Blocks.decorate(art));
      typeset(art);
      stage.appendChild(h('p', { class: 'kbd-hint fc__keys' }, 'Atajos: ', h('kbd', null, 'Espacio'), ' muestra la respuesta · ',
        h('kbd', null, '1'), ' Otra vez · ', h('kbd', null, '2'), ' Difícil · ', h('kbd', null, '3'), ' Bien'));
      if (focus) {
        const t = S.revealed ? stage.querySelector('#fc-a') : qEl;
        if (t) t.focus({ preventScroll: true });
        const top = art.getBoundingClientRect().top;
        if (top < 0 || top > root.innerHeight * 0.6) art.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      }
    }

    function reveal() {
      if (!S.queue.length || S.revealed) return;
      S.revealed = true;
      paintStage(true);
    }

    function grade(g) {
      if (!S.queue.length || !S.revealed) return;
      const id = S.queue.shift();
      store.gradeCard(id, g);
      S.counts[g]++;
      S.graded++;
      if (g === 'again') S.queue.push(id);   // vuelve al final de esta sesión
      else S.finished++;
      S.revealed = false;
      paintStage(true);
      paintStats();
      paintFilters();
    }

    function paintSummary(focus) {
      const ids = filteredIds();
      const nd = nextDueText(ids);
      const c = S.counts;
      const h2 = h('h2', { class: 'fc-sum__t', tabindex: '-1' }, 'Sesión terminada');
      stage.appendChild(h('div', { class: 'fc-sum' },
        h('span', { class: 'fc-done__mark', html: icon('check') }),
        h2,
        h('p', null, 'Repasaste ', h('b', null, plural(S.finished, 'tarjeta', 'tarjetas')), c.again ? ' (' + plural(c.again, 'repetición', 'repeticiones') + ' con «Otra vez»)' : '', '.'),
        h('ul', { class: 'fc-sum__counts' },
          GRADES.slice().reverse().map((g) => h('li', { class: 'fc-sum__c grade--' + g.id }, h('span', { class: 'fc-sum__n mono' }, String(c[g.id])), g.label))),
        nd ? h('p', { class: 'muted' }, 'Próximo repaso ' + nd + '. Poco y seguido rinde más que mucho de golpe.') : null,
        h('div', { class: 'fc-sum__actions' },
          F.mode === 'due'
            ? h('button', { type: 'button', class: 'btn', on: { click: () => setFilter({ mode: 'all' }) } }, h('span', { html: icon('cards') }), 'Repasar todo igual')
            : h('button', { type: 'button', class: 'btn', on: { click: () => { startSession(); paintStage(true); } } }, h('span', { html: icon('reset') }), 'Otra ronda'),
          h('a', { class: 'btn btn--ghost', href: '#practica' }, 'Ir a los ejercicios'))));
      if (focus) h2.focus({ preventScroll: true });
    }

    // ---------------------------------------------------------------- teclado (solo con la página montada)
    function onKey(e) {
      if (!wrap.isConnected) { teardown(); return; }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const de = document.documentElement;
      if (de.classList.contains('modal-open') || de.classList.contains('drawer-open')) return;
      const t = e.target;
      if (isTextEntry(t) || !S || !S.queue.length) return;
      if ((e.key === ' ' || e.key === 'Spacebar') && !S.revealed) {
        // Sobre un botón/enlace, la barra espaciadora ya lo activa: no duplicar.
        if (t && t.closest && t.closest('button, a[href], summary, [role="button"]')) return;
        e.preventDefault();
        reveal();
      } else if (S.revealed && (e.key === '1' || e.key === '2' || e.key === '3')) {
        e.preventDefault();
        grade(GRADES[+e.key - 1].id);
      }
    }
    function teardown() {
      document.removeEventListener('keydown', onKey);
      if (mounted && mounted.wrap === wrap) mounted = null;
    }
    document.addEventListener('keydown', onKey);
    mounted = { wrap, teardown };

    startSession();
    paintFilters();
    paintStats();
    paintStage(false);
    wrap.appendChild(filtersEl);
    wrap.appendChild(h('div', { class: 'fc__grid' }, stage, statsEl));
  }

  ATLAS.Flashcards = { render, visibleCards, KINDS: KIND_ORDER.slice(), KIND_LABEL: Object.assign({}, KIND_LABEL) };
})(typeof window !== 'undefined' ? window : globalThis);
