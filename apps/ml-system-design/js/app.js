/* =============================================================================
   Ronda de Diseño ML — js/app.js
   MSD.App: arranque, router por hash (SPEC §4.3), barra lateral (índice, búsqueda,
   uptime compacto, estado del guardado, tema, exportar/importar), páginas del shell
   (§4.5: inicio, módulo, caso con compuerta de práctica, próximamente, no encontrado),
   TOC derecho con marcas de lectura y delegación a MSD.Practice / Flashcards / Reference.
   Tolera catálogo o contenido ausentes: estados vacíos, nunca excepciones.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const D = MSD.dom;
  const { h, icon } = D;
  const store = MSD.store;
  const APP_NAME = 'Ronda de Diseño ML';

  const MODULE_IDS = MSD.MODULE_IDS || [];
  const CASE_IDS = MSD.CASE_IDS || [];
  const CASE_TEMPLATE = MSD.CASE_TEMPLATE || [];

  // Páginas especiales: valores por defecto si el catálogo no las trae.
  const SPECIAL = {
    inicio: { title: 'Inicio', short: 'Inicio', ico: 'home' },
    practica: { title: 'Simulador de entrevista', short: 'Simulador', ico: 'practice', part: 3 },
    historial: { title: 'Historial de práctica', short: 'Historial', ico: 'list', part: 3 },
    flashcards: { title: 'Flashcards', short: 'Flashcards', ico: 'cards', part: 3 },
    'mis-notas': { title: 'Mis notas', short: 'Mis notas', ico: 'note', part: 3 },
    'ref-numeros': { title: 'Números que debes saber', short: 'Números que debes saber', ico: 'ref', part: 4 },
    'ref-herramientas': { title: 'Herramientas por categoría', short: 'Herramientas por categoría', ico: 'ref', part: 4 },
    'ref-comandos': { title: 'Docker y kubectl', short: 'Docker y kubectl', ico: 'ref', part: 4 },
    glosario: { title: 'Glosario ES–EN', short: 'Glosario ES–EN', ico: 'book', part: 4 },
  };
  const NAV_GROUPS = [
    { id: 'home', label: null, ids: ['inicio'] },
    { id: 'p1', label: 'Parte 1 — Fundamentos', ids: MODULE_IDS },
    { id: 'p2', label: 'Parte 2 — Casos de diseño', ids: CASE_IDS },
    { id: 'p3', label: 'Parte 3 — Práctica', ids: ['practica', 'historial', 'flashcards', 'mis-notas'] },
    { id: 'p4', label: 'Parte 4 — Referencias', ids: ['ref-numeros', 'ref-herramientas', 'ref-comandos', 'glosario'] },
  ];
  const STATE_LABEL = { done: 'completado', progress: 'en curso', ready: 'disponible', soon: 'próximamente' };
  const FREQ_LABEL = { alta: 'alta', media: 'media', baja: 'baja' };
  const PRIO = { core: ['prio--core', 'Esencial'], extra: ['prio--extra', 'Extra'], skip: ['prio--skip', 'Sáltate esto'] };
  const BACKEND_TEXT = {
    account: ['Guardado en tu cuenta', 'Tu progreso se sincroniza con tu cuenta de claude.ai (privado: solo tú lo ves).'],
    local: ['Guardado en este navegador', 'Tu progreso vive en el almacenamiento local de este navegador. Usa Exportar para llevarlo a otro lado.'],
    memory: ['Sin guardado', 'El navegador no permite guardar: el progreso se pierde al cerrar. Exporta antes de salir.'],
  };

  const els = {};
  const S = {
    route: null, page: null, observer: null, currentSec: null,
    searchItems: null, results: [], active: -1,
    pending: new Set(), flushQueued: false,
    drawerOpen: false, modalOpen: false, lastFocus: null, booted: false,
  };

  // ------------------------------------------------------------------ utilidades seguras
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const catalog = () => safe(() => (typeof MSD.catalog === 'function' ? MSD.catalog() : null), null);
  const pad2 = (n) => String(n).padStart(2, '0');
  const isCourseId = (id) => /^[mc]\d\d$/.test(id) && (MODULE_IDS.indexOf(id) >= 0 || CASE_IDS.indexOf(id) >= 0);
  const courseOrder = () => safe(() => MSD.courseOrder(), MODULE_IDS.concat(CASE_IDS));
  const getPage = (id) => safe(() => MSD.getPage(id), null);
  const strip = (s) => (typeof MSD.stripHtml === 'function' ? MSD.stripHtml(s) : String(s || '').replace(/<[^>]*>/g, ''));
  const reduced = () => D.reducedMotion();

  function meta(id) {
    const pm = /^practicar-(m\d\d)$/.exec(id);
    if (pm) { const b = meta(pm[1]); return { id, kind: 'special', title: 'Practicar ' + pm[1].toUpperCase() + (b.short ? ': ' + b.short : ''), short: 'Practicar ' + pm[1].toUpperCase() }; }
    const c = catalog();
    const it = c && c.items && c.items[id];
    if (it) return Object.assign({}, SPECIAL[id] || {}, it);
    if (SPECIAL[id]) return Object.assign({ id, kind: 'special' }, SPECIAL[id]);
    if (/^m\d\d$/.test(id)) return { id, kind: 'module', part: 1, num: +id.slice(1), title: 'Módulo ' + id.slice(1), short: 'Módulo ' + id.slice(1) };
    if (/^c\d\d$/.test(id)) return { id, kind: 'case', part: 2, num: +id.slice(1), title: 'Caso ' + id.slice(1), short: 'Caso ' + id.slice(1) };
    return { id, kind: 'special', title: id, short: id };
  }
  const label = (id) => (/^[mc]\d\d$/.test(id) ? id.toUpperCase() : '');
  function pageTitle(id) {
    if (/^practica-c\d\d$/.test(id)) return 'Práctica: ' + meta(id.slice(9)).title;
    return meta(id).title || id;
  }

  function parseHash(hash) {
    let s = String(hash || '').replace(/^#/, '');
    try { s = decodeURIComponent(s); } catch (e) { /* hash raro: se usa tal cual */ }
    if (!s) return { pageId: 'inicio', sectionId: null, hash: '#inicio' };
    const i = s.indexOf('.');
    const pageId = i < 0 ? s : s.slice(0, i);
    const sectionId = i < 0 ? null : s.slice(i + 1) || null;
    const r = { pageId, sectionId, hash: '#' + s };
    if (/^practica-c\d\d$/.test(pageId)) r.caseId = pageId.slice(9);
    return r;
  }

  function navigate(hash) {
    const hsh = String(hash || '').charAt(0) === '#' ? String(hash) : '#' + String(hash || '');
    if (root.location.hash === hsh) onRoute(false, true);
    else root.location.hash = hsh;
  }

  function renderBlocks(blocks, el, pageCtx) {
    return MSD.Blocks ? MSD.Blocks.renderAll(blocks, el, Object.assign({ store }, pageCtx || {})) : el;
  }

  function isTextEntry(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    return ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].indexOf((el.type || '').toLowerCase()) < 0;
  }

  // ------------------------------------------------------------------ piezas visuales compartidas
  function ringSvg(pct) {
    const len = 2 * Math.PI * 6;
    const f = Math.max(0.12, Math.min(1, pct / 100));
    return '<svg class="ring" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle class="ring__track" cx="8" cy="8" r="6"/>' +
      '<circle class="ring__arc" cx="8" cy="8" r="6" stroke-dasharray="' + (len * f).toFixed(2) + ' ' + len.toFixed(2) + '"/></svg>';
  }

  function uptimeStrip(compact) {
    const current = S.route && S.route.pageId;
    const cell = (id) => {
      const st = store.pageState(id);
      const m = meta(id);
      const cls = 'ucell ucell--' + st + (id === current ? ' is-current' : '');
      const title = label(id) + ' · ' + m.title + ' — ' + STATE_LABEL[st];
      const el = compact ? h('span', { class: cls, title }) : h('a', { class: cls, href: '#' + id, title, tabindex: '-1' });
      if (st === 'progress') el.appendChild(h('i', { style: { height: Math.max(18, store.pageProgress(id).pct) + '%' } }));
      return el;
    };
    const cp = store.courseProgress();
    const summary = cp.done + ' de ' + cp.total + ' completados, ' + cp.inProgress + ' en curso, ' + cp.ready + ' disponibles.';
    const out = h('div', { class: 'uptime' + (compact ? ' uptime--compact' : '') },
      h('div', { class: 'uptime__bars', 'aria-hidden': 'true' },
        h('div', { class: 'uptime__grp uptime__grp--m' }, MODULE_IDS.map(cell)),
        h('div', { class: 'uptime__grp uptime__grp--c' }, CASE_IDS.map(cell))),
      h('p', { class: 'sr-only' }, 'Estado del curso: ' + summary));
    if (!compact) {
      out.appendChild(h('div', { class: 'uptime__axis', 'aria-hidden': 'true' },
        h('span', null, h('span', null, 'M01'), h('span', null, 'Fundamentos'), h('span', null, 'M15')),
        h('span', null, h('span', null, 'C01'), h('span', null, 'Casos'), h('span', null, 'C13'))));
      out.appendChild(h('div', { class: 'uptime__legend' },
        ['done', 'progress', 'ready', 'soon'].map((st) => h('span', null,
          h('span', { class: 'ucell ucell--' + st, 'aria-hidden': 'true' }, st === 'progress' ? h('i', { style: { height: '50%' } }) : null),
          STATE_LABEL[st].charAt(0).toUpperCase() + STATE_LABEL[st].slice(1)))));
    }
    return out;
  }

  function freqEl(f) {
    if (!FREQ_LABEL[f]) return null;
    return h('span', { class: 'freq freq--' + f, title: 'Qué tan seguido aparece en entrevistas de diseño para ML Engineer' },
      h('span', { class: 'freq__bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', null, 'Frecuencia en entrevistas: ', h('b', null, FREQ_LABEL[f])));
  }

  function linkChip(id) {
    const m = meta(id);
    const txt = m.short || m.title || id;
    return h('a', { class: 'chip', href: '#' + id, title: m.title || txt },
      label(id) ? h('span', { class: 'chip__id' }, label(id)) : null, txt);
  }

  function prioChip(p) {
    const x = PRIO[p];
    return x ? h('span', { class: 'prio ' + x[0] }, x[1]) : null;
  }

  function specStrip(specs) {
    if (!Array.isArray(specs) || !specs.length) return null;
    return h('dl', { class: 'specstrip', 'aria-label': 'Números clave del caso' }, specs.map((pair) =>
      h('div', { class: 'specstrip__item' }, h('dt', { html: String(pair[0] || '') }), h('dd', { html: String(pair[1] || '') }))));
  }

  function pageHeader(m, opts) {
    const o = opts || {};
    const eyebrow = h('p', { class: 'eyebrow' });
    (o.eyebrow || []).forEach((part, i) => {
      if (i) eyebrow.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'));
      eyebrow.appendChild(typeof part === 'string' ? h('span', null, part) : part);
    });
    const metaRow = h('div', { class: 'phead__meta' });
    if (m.minutes > 0 && !o.noMinutes) metaRow.appendChild(h('span', { class: 'meta-item' }, h('span', { html: icon('timer') }), h('span', { class: 'mono' }, '≈ ' + m.minutes + ' min'), o.minutesLabel || ' de lectura'));
    if (m.difficulty) metaRow.appendChild(h('span', { class: 'meta-item' }, 'Dificultad: ', h('b', { style: { color: 'var(--ink)' } }, m.difficulty)));
    const fq = freqEl(m.freq);
    if (fq) metaRow.appendChild(fq);
    const connects = (m.connects || []).filter((id) => id !== m.id);
    if (connects.length) {
      metaRow.appendChild(h('span', { class: 'phead__connects' },
        h('span', { class: 'phead__connects-k' }, 'Conecta con'), connects.map(linkChip)));
    }
    return h('header', { class: 'phead' },
      eyebrow,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, o.title || m.title || ''),
      m.titleEn ? h('p', { class: 'phead__en', lang: 'en' }, m.titleEn) : null,
      m.summary ? h('p', { class: 'phead__summary', html: String(m.summary) }) : null,
      metaRow.childNodes.length ? metaRow : null,
      o.after || null);
  }

  function pager(id) {
    const order = courseOrder();
    const i = order.indexOf(id);
    if (i < 0) return null;
    const link = (tid, dir) => {
      if (!tid) return null;
      const m = meta(tid);
      return h('a', { class: 'pager__link pager__link--' + dir, href: '#' + tid, rel: dir === 'next' ? 'next' : 'prev' },
        h('span', { class: 'pager__dir' },
          dir === 'prev' ? h('span', { html: icon('arrow-left') }) : null,
          dir === 'prev' ? 'Anterior' : 'Siguiente',
          dir === 'next' ? h('span', { html: icon('arrow-right') }) : null),
        h('span', { class: 'pager__title' }, h('span', { class: 'mono' }, label(tid)), m.short || m.title));
    };
    return h('div', null,
      h('nav', { class: 'pager', 'aria-label': 'Anterior y siguiente en el curso' }, link(order[i - 1], 'prev'), link(order[i + 1], 'next')),
      h('p', { class: 'kbd-hint' }, 'Atajos: ', h('kbd', null, '['), ' anterior · ', h('kbd', null, ']'), ' siguiente · ', h('kbd', null, '/'), ' buscar'));
  }

  function placeholderPage(container, title, text) {
    container.appendChild(pageHeader({ title }, { eyebrow: [APP_NAME] }));
    container.appendChild(h('p', { class: 'placeholder-page' }, text || 'Esta sección se está preparando.'));
  }

  // ------------------------------------------------------------------ barra lateral
  function buildNav() {
    els.nav.innerHTML = '';
    for (const g of NAV_GROUPS) {
      const list = h('ul', { class: 'nav__list' });
      for (const id of g.ids) {
        const m = meta(id);
        const numEl = /^[mc]\d\d$/.test(id)
          ? h('span', { class: 'nav__num' }, id.slice(1))
          : h('span', { class: 'nav__num', html: icon(m.ico || 'dot') });
        list.appendChild(h('li', null, h('a', {
          class: 'nav__item', href: '#' + id, dataset: { id },
          on: { click: () => { if (S.drawerOpen) closeDrawer(false); } },
        }, numEl, h('span', { class: 'nav__title' }, m.short || m.title), h('span', { class: 'nav__mk' }))));
      }
      els.nav.appendChild(h('div', { class: 'nav__group', role: g.label ? 'group' : null, 'aria-label': g.label || null },
        g.label ? h('p', { class: 'nav__label', 'aria-hidden': 'true' }, g.label) : null, list));
    }
    updateNavMarkers();
  }

  // Tarjetas que se reparten: las de un caso cuya solución sigue tras la compuerta de práctica
  // no cuentan (sus respuestas son la solución). MSD.Flashcards decide; si no está, misma regla aquí.
  function lockedCardSource(src) {
    const F = MSD.Flashcards;
    if (F && typeof F.isLockedSource === 'function') return !!safe(() => F.isLockedSource(store, src), false);
    return /^c\d\d$/.test(String(src)) && caseGateState(String(src)).gated;
  }
  function visibleCardIds() {
    const F = MSD.Flashcards;
    const cards = F && typeof F.visibleCards === 'function'
      ? safe(() => F.visibleCards(store), null)
      : safe(() => MSD.flashcards().filter((c) => c && c.id && !lockedCardSource(c.source)), null);
    return (cards || []).map((c) => c.id);
  }

  function updateNavMarkers() {
    const cur = S.route ? S.route.pageId : null;
    const cards = visibleCardIds();
    const due = cards.length ? store.dueCards(cards).length : 0;
    const drafts = store.listAttempts({ includeDrafts: true }).filter((a) => a.status === 'draft');
    const notesN = safe(() => store.listNotes().length, 0);
    els.nav.querySelectorAll('.nav__item').forEach((a) => {
      const id = a.dataset.id;
      const mk = a.querySelector('.nav__mk');
      const m = meta(id);
      let html = '';
      let title = (label(id) ? label(id) + ' · ' : '') + (m.title || id);
      a.classList.remove('is-soon');
      if (isCourseId(id)) {
        const st = store.pageState(id);
        if (st === 'done') html = '<span class="mk-done">' + icon('check') + '</span>';
        else if (st === 'progress') html = ringSvg(store.pageProgress(id).pct);
        else if (st === 'soon') { html = '<span class="mk-soon">Próx.</span>'; a.classList.add('is-soon'); }
        title += ' — ' + STATE_LABEL[st];
      } else if (id === 'flashcards' && due > 0) {
        html = '<span class="mk-count">' + due + '</span>';
        title += ' — ' + due + ' pendientes hoy';
      } else if (id === 'mis-notas' && notesN > 0) {
        html = '<span class="mk-count mk-count--notes">' + notesN + '</span>';
        title += ' — ' + notesN + (notesN === 1 ? ' entrada' : ' entradas');
      } else if (id === 'practica' && drafts.length) {
        html = '<span class="mk-draft"></span>';
        title += ' — ' + drafts.length + (drafts.length === 1 ? ' borrador abierto' : ' borradores abiertos');
      } else if (/^ref-/.test(id) && !(getPage(id) || {}).ready) {
        html = '<span class="mk-soon">Próx.</span>';
        a.classList.add('is-soon');
        title += ' — próximamente';
      }
      if (mk.innerHTML !== html) mk.innerHTML = html;
      a.title = title;
      const isCur = id === cur || (id === 'practica' && /^practica-c\d\d$/.test(cur || '')) || cur === 'practicar-' + id;
      if (isCur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function renderSideUptime() {
    const cp = store.courseProgress();
    els.sideUptime.innerHTML = '';
    els.sideUptime.appendChild(h('div', { class: 'side-uptime__row' },
      h('span', { class: 'side-uptime__label' }, 'Progreso'),
      h('span', { class: 'side-uptime__count' }, cp.done + '/' + cp.total)));
    els.sideUptime.appendChild(uptimeStrip(true));
    if (els.topProgress) els.topProgress.textContent = cp.done + '/' + cp.total;
  }

  function renderFoot() {
    const f = els.foot;
    f.innerHTML = '';
    const status = h('div', { class: 'store-status', id: 'store-status' }, h('span', { class: 'store-status__dot', 'aria-hidden': 'true' }), h('span', { class: 'store-status__text' }));
    const theme = store.pref('theme') || 'system';
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema de color' },
      [['system', 'Sistema', 'system'], ['light', 'Claro', 'sun'], ['dark', 'Oscuro', 'moon']].map(([v, txt, ic]) =>
        h('button', { type: 'button', 'aria-pressed': String(theme === v), dataset: { theme: v }, on: { click: () => setTheme(v) } },
          h('span', { html: icon(ic) }), txt)));
    f.appendChild(status);
    f.appendChild(h('div', { class: 'foot-row' }, h('span', { class: 'foot-row__label', 'aria-hidden': 'true' }, 'Tema'), seg));
    f.appendChild(h('button', { type: 'button', class: 'btn btn--sm', id: 'btn-portability', on: { click: openPortability } },
      h('span', { html: icon('database') }), 'Exportar / importar progreso'));
    renderStatus();
  }

  function renderStatus() {
    const el = document.getElementById('store-status');
    if (!el) return;
    const b = store.backend();
    const t = BACKEND_TEXT[b] || BACKEND_TEXT.memory;
    el.dataset.backend = b;
    el.title = t[1];
    el.querySelector('.store-status__text').textContent = t[0];
  }

  function applyTheme(t) {
    const de = document.documentElement;
    if (t === 'light' || t === 'dark') de.setAttribute('data-theme', t); else de.removeAttribute('data-theme');
  }
  function syncThemeButtons(t) {
    els.foot.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === t)));
  }
  function setTheme(t) {
    store.setPref('theme', t);
    applyTheme(t);
    syncThemeButtons(t);
  }

  function renderDevBanner() {
    const probs = safe(() => MSD.registryProblems(), []).slice();
    if (!catalog()) probs.unshift('No se cargó el catálogo (js/content/catalog.js): se muestran nombres genéricos.');
    if (!MSD.Blocks) probs.push('No se cargó js/ui/blocks.js.');
    els.banner.innerHTML = '';
    els.banner.hidden = !probs.length;
    if (!probs.length) return;
    els.banner.appendChild(h('details', null,
      h('summary', null, 'Aviso de desarrollo: ' + probs.length + (probs.length === 1 ? ' problema' : ' problemas') + ' al cargar el contenido'),
      h('ul', null, probs.map((p) => h('li', null, p)))));
  }

  // ------------------------------------------------------------------ búsqueda
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const TYPE_LABEL = { page: 'Página', section: 'Sección', term: 'Término', card: 'Tarjeta', note: 'Mi nota', myterm: 'Mi término' };
  // Las tarjetas no suman bonos por título (sus preguntas son largas y taparían páginas y secciones)
  // y salen como máximo 3.
  const TYPE_WEIGHT = { page: 40, section: 30, term: 20, card: 0, note: 35, myterm: 45 };
  const MAX_CARD_RESULTS = 3;

  function ensureIndex() {
    if (S.searchItems) return S.searchItems;
    // Tus notas y términos también se buscan (el índice se rehace cuando cambian).
    const idx = safe(() => MSD.searchIndex(), []).concat(safe(() => (MSD.Notes ? MSD.Notes.searchItems() : []), []));
    S.searchItems = idx.map((e) => {
      const lab = e.type === 'page' ? label(e.id) : '';
      return Object.assign({}, e, { lab, nTitle: norm((lab ? lab + ' ' : '') + e.title), nText: norm(e.text) });
    });
    return S.searchItems;
  }

  function runSearch(q) {
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const out = [];
    for (const e of ensureIndex()) {
      // Tarjetas de un caso tras su compuerta: no se muestran (en el índice, `text` es la fuente).
      if (e.type === 'card' && lockedCardSource(e.text)) continue;
      const hay = e.nTitle + ' ' + e.nText;
      if (!tokens.every((t) => hay.indexOf(t) >= 0)) continue;
      let score = TYPE_WEIGHT[e.type] || 0;
      if (e.type !== 'card') {
        if (tokens.every((t) => e.nTitle.indexOf(t) >= 0)) score += 25;
        if (e.nTitle.startsWith(tokens[0]) || e.nTitle.indexOf(' ' + tokens[0]) >= 0) score += 15;
      }
      out.push({ e, score });
    }
    out.sort((a, b) => b.score - a.score || a.e.title.length - b.e.title.length);
    let nc = 0;
    return out.filter((x) => x.e.type !== 'card' || nc++ < MAX_CARD_RESULTS).slice(0, 24).map((x) => x.e);
  }

  function renderResults(q) {
    const box = els.results;
    box.innerHTML = '';
    S.results = q.trim() ? runSearch(q) : [];
    S.active = S.results.length ? 0 : -1;
    if (!q.trim()) { closeResults(); return; }
    box.appendChild(h('div', { class: 'search__meta', 'aria-hidden': 'true' },
      S.results.length ? S.results.length + (S.results.length === 24 ? '+ resultados · ' : ' resultados · ') + '↑↓ para moverte, Enter para abrir' : ''));
    if (!S.results.length) box.appendChild(h('div', { class: 'search__empty' }, 'Sin resultados para «' + q.trim() + '». Prueba con el término en inglés o en español.'));
    S.results.forEach((e, i) => {
      box.appendChild(h('div', {
        class: 'sres', role: 'option', id: 'sres-' + i, 'aria-selected': String(i === S.active), dataset: { i },
        on: { mousedown: (ev) => ev.preventDefault(), click: () => openResult(i), mousemove: () => setActive(i) },
      },
      h('span', { class: 'sres__type' }, TYPE_LABEL[e.type] || e.type),
      h('span', { class: 'sres__title' }, (e.lab ? e.lab + ' · ' : '') + e.title),
      e.text ? h('span', { class: 'sres__text' }, e.text) : null));
    });
    box.hidden = false;
    els.search.setAttribute('aria-expanded', 'true');
    syncActive();
  }

  function setActive(i) { if (i !== S.active) { S.active = i; syncActive(); } }
  function syncActive() {
    els.results.querySelectorAll('.sres').forEach((el) => el.setAttribute('aria-selected', String(+el.dataset.i === S.active)));
    if (S.active >= 0) {
      els.search.setAttribute('aria-activedescendant', 'sres-' + S.active);
      const el = document.getElementById('sres-' + S.active);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    } else els.search.removeAttribute('aria-activedescendant');
  }
  function closeResults() {
    els.results.hidden = true;
    els.search.setAttribute('aria-expanded', 'false');
    els.search.removeAttribute('aria-activedescendant');
  }
  function openResult(i) {
    const e = S.results[i];
    if (!e) return;
    closeResults();
    els.search.blur();
    if (S.drawerOpen) closeDrawer(false);
    // Una tarjeta abre #flashcards.<id>: si ya estás en flashcards hay que volver a pintar la sesión.
    if (e.type === 'card') S.forceRender = true;
    navigate(e.href);
  }
  function focusSearch() {
    if (isDrawerMode() && !S.drawerOpen) openDrawer();
    els.search.focus();
    els.search.select();
  }

  function bindSearch() {
    const inp = els.search;
    inp.addEventListener('focus', () => { ensureIndex(); if (inp.value.trim()) renderResults(inp.value); });
    inp.addEventListener('input', () => renderResults(inp.value));
    inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) closeResults(); }, 120));
    inp.addEventListener('keydown', (e) => {
      const n = S.results.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); if (els.results.hidden && inp.value.trim()) renderResults(inp.value); else if (n) setActive((S.active + 1) % n); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((S.active - 1 + n) % n); }
      else if (e.key === 'Enter') { e.preventDefault(); if (n) openResult(S.active >= 0 ? S.active : 0); }
      else if (e.key === 'Escape') {
        e.stopPropagation();
        if (!els.results.hidden) closeResults();
        else if (inp.value) inp.value = '';
        else if (S.drawerOpen) closeDrawer(true);
        else inp.blur();
      }
    });
  }

  // ------------------------------------------------------------------ cajón (< 768 px) y modal
  const mq = root.matchMedia ? root.matchMedia('(max-width: 767px)') : null;
  const isDrawerMode = () => !!(mq && mq.matches);

  function openDrawer() {
    if (S.drawerOpen) return;
    S.drawerOpen = true;
    S.lastFocus = document.activeElement;
    els.sidebar.classList.add('is-open');
    els.sidebar.setAttribute('role', 'dialog');
    els.sidebar.setAttribute('aria-modal', 'true');
    els.backdrop.hidden = false;
    document.documentElement.classList.add('drawer-open');
    els.menuBtn.setAttribute('aria-expanded', 'true');
    els.shell.inert = true;
    els.topbar.inert = true;
    const cur = els.nav.querySelector('[aria-current="page"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
    setTimeout(() => { if (S.drawerOpen && !els.sidebar.contains(document.activeElement)) els.drawerClose.focus(); }, 30);
  }
  function closeDrawer(restoreFocus) {
    if (!S.drawerOpen) return;
    S.drawerOpen = false;
    els.sidebar.classList.remove('is-open');
    els.sidebar.removeAttribute('role');
    els.sidebar.removeAttribute('aria-modal');
    els.backdrop.hidden = true;
    document.documentElement.classList.remove('drawer-open');
    els.menuBtn.setAttribute('aria-expanded', 'false');
    els.shell.inert = false;
    els.topbar.inert = false;
    closeResults();
    if (restoreFocus !== false) els.menuBtn.focus();
  }

  function trapTab(e, container) {
    if (e.key !== 'Tab') return;
    const f = D.focusables(container);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  function openModal(panel, focusEl) {
    S.modalOpen = true;
    S.modalReturn = document.activeElement;
    els.modal.innerHTML = '';
    els.modal.appendChild(panel);
    els.modal.hidden = false;
    document.documentElement.classList.add('modal-open');
    els.shell.inert = true;
    els.sidebar.inert = true;
    els.topbar.inert = true;
    setTimeout(() => (focusEl || panel).focus(), 20);
  }
  function closeModal() {
    if (!S.modalOpen) return;
    S.modalOpen = false;
    els.modal.hidden = true;
    els.modal.innerHTML = '';
    document.documentElement.classList.remove('modal-open');
    els.sidebar.inert = false;
    els.topbar.inert = false;
    if (!S.drawerOpen) els.shell.inert = false;
    if (S.modalReturn && S.modalReturn.focus) S.modalReturn.focus();
  }

  function openPortability() {
    const json = store.exportJSON();
    const exportTa = h('textarea', { class: 'textarea', readonly: true, rows: 8, 'aria-label': 'Respaldo en JSON (solo lectura)', spellcheck: 'false' });
    exportTa.value = json;
    const importTa = h('textarea', { class: 'textarea', rows: 6, id: 'import-text', spellcheck: 'false', placeholder: '{ "app": "ronda-diseno-ml", "v": 1, … }' });
    const msg = h('p', { class: 'result-msg', role: 'status', 'aria-live': 'polite' });
    const kb = (new Blob([json]).size / 1024).toFixed(1);
    const copyBtn = h('button', { type: 'button', class: 'btn btn--sm', on: { click: () => {
      D.copyText(json, exportTa).then((ok) => {
        copyBtn.lastChild.textContent = ok ? 'Copiado' : 'Selecciónalo y copia (Cmd/Ctrl+C)';
        setTimeout(() => { copyBtn.lastChild.textContent = 'Copiar respaldo'; }, 2400);
      });
    } } }, h('span', { html: icon('copy') }), h('span', null, 'Copiar respaldo'));
    const importBtn = h('button', { type: 'button', class: 'btn btn--sm btn--primary', on: { click: () => {
      const txt = importTa.value.trim();
      if (!txt) { msg.className = 'result-msg is-bad'; msg.textContent = 'Pega primero el respaldo en el cuadro de arriba.'; importTa.focus(); return; }
      const r = store.importJSON(txt);
      if (r.ok) {
        msg.className = 'result-msg is-ok';
        const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
        msg.textContent = 'Importado y fusionado: ' + pl(r.sections, 'sección leída', 'secciones leídas') + ', ' + pl(r.attempts, 'intento', 'intentos') + ', ' + pl(r.cards, 'tarjeta', 'tarjetas') + ', ' + pl(r.notes || 0, 'nota', 'notas') + '.';
        importTa.value = '';
        exportTa.value = store.exportJSON();
      } else { msg.className = 'result-msg is-bad'; msg.textContent = r.error; }
    } } }, h('span', { html: icon('upload') }), 'Importar');
    const title = h('h2', { class: 'modal__title', id: 'modal-title', tabindex: '-1' }, 'Exportar / importar progreso');
    const panel = h('div', { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', tabindex: '-1' },
      h('div', { class: 'modal__head' }, title,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar', on: { click: closeModal } }, h('span', { html: icon('close') }))),
      h('div', { class: 'modal__body' },
        h('section', { class: 'modal__sec' },
          h('h3', null, 'Exportar'),
          h('p', null, 'Copia este respaldo y guárdalo (en un archivo .json o en tus notas). Incluye secciones leídas, intentos de práctica con su texto, flashcards, tus notas y términos, y preferencias.'),
          exportTa,
          h('div', { class: 'modal__row' }, copyBtn, h('span', { class: 'muted small mono' }, kb + ' KB'))),
        h('section', { class: 'modal__sec' },
          h('h3', null, h('label', { for: 'import-text' }, 'Importar')),
          h('p', null, 'Pega aquí un respaldo. Se fusiona con lo que ya tienes: en cada dato gana la versión más reciente, nada se borra.'),
          importTa,
          h('div', { class: 'modal__row' }, importBtn),
          msg)));
    openModal(panel, title);
  }

  // ------------------------------------------------------------------ TOC derecho y marcas de lectura
  function tocLink(p, s, n) {
    return h('a', { class: 'toc__link', href: '#' + p.id + '.' + s.id, dataset: { sec: s.id } },
      h('span', { class: 'toc__tick', html: icon('check') }),
      h('span', null, n ? h('span', { class: 'toc__n' }, pad2(n)) : null, s.title || s.id));
  }

  // "En esta página" se puede plegar: plegado deja solo una pestaña y el contenido se ensancha
  // (los diagramas grandes se ven completos). La preferencia se recuerda (pref 'tocCollapsed').
  function applyTocCollapsed(collapsed) {
    els.shell.classList.toggle('toc-collapsed', !!collapsed);
    const t = els.toc.querySelector('.toc__toggle');
    if (t) {
      t.setAttribute('aria-expanded', String(!collapsed));
      t.setAttribute('aria-label', collapsed ? 'Mostrar «En esta página»' : 'Ocultar «En esta página»');
      t.title = collapsed ? 'Mostrar el índice de la página' : 'Ocultar el índice y ensanchar el contenido';
    }
  }
  function buildToc(p, numbered) {
    const secs = p.sections;
    els.toc.innerHTML = '';
    const toggle = h('button', {
      type: 'button', class: 'toc__toggle', 'aria-controls': 'toc-body',
      on: { click: () => {
        const next = !els.shell.classList.contains('toc-collapsed');
        store.setPref('tocCollapsed', next);
        applyTocCollapsed(next);
        // El ancho del contenido cambió: los diagramas se reacomodan con el resize.
        try { root.dispatchEvent(new Event('resize')); } catch (e) { /* nada */ }
      } },
    }, h('span', { class: 'toc__toggle-ico', html: icon('chevron') }), h('span', { class: 'toc__title' }, 'En esta página'));
    els.toc.appendChild(toggle);
    els.toc.appendChild(h('div', { class: 'toc__body', id: 'toc-body' },
      h('ol', { class: 'toc__list' }, secs.map((s, i) => h('li', { dataset: { sec: s.id } }, tocLink(p, s, numbered ? (s.num || i + 1) : 0)))),
      h('div', { class: 'toc__foot' },
        h('span', { class: 'toc__count' }),
        h('br'),
        h('a', { href: '#' + p.id, on: { click: (e) => { e.preventDefault(); root.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); } } }, 'Volver arriba'))));
    els.toc.hidden = false;
    applyTocCollapsed(!!store.pref('tocCollapsed'));
  }

  function pageTocDisclosure(p) {
    return h('details', { class: 'page-toc' },
      h('summary', null, h('span', { html: icon('chevron') }), 'Secciones', h('span', { class: 'page-toc__count' })),
      h('ol', null, p.sections.map((s) => h('li', { dataset: { sec: s.id } }, tocLink(p, s, 0)))));
  }

  function refreshReadMarks() {
    const P = S.page;
    if (!P || !P.sections) return;
    const pr = store.pageProgress(P.id);
    const scope = [els.page, els.toc];
    for (const s of P.sections) {
      const read = store.isSectionRead(P.id, s.id);
      scope.forEach((root2) => root2.querySelectorAll('[data-sec="' + s.id + '"]').forEach((el) => {
        if (el.classList.contains('read-toggle')) {
          el.setAttribute('aria-pressed', String(read));
          el.lastChild.textContent = read ? 'Leída' : 'Marcar como leída';
        } else if (el.tagName === 'LI' || el.classList.contains('toc__link')) {
          el.classList.toggle('is-read', read);
        }
      }));
      els.page.querySelectorAll('.tnav__item[data-sec="' + s.id + '"]').forEach((li) => li.classList.toggle('is-read', read));
    }
    const countTxt = pr.read + ' de ' + pr.total + ' leídas';
    els.page.querySelectorAll('.page-toc__count').forEach((el) => { el.textContent = countTxt; });
    els.toc.querySelectorAll('.toc__count').forEach((el) => { el.textContent = countTxt; });
    els.page.querySelectorAll('.pprog').forEach((el) => {
      el.classList.toggle('is-done', pr.completed);
      el.querySelector('.pprog__fill').style.width = pr.pct + '%';
      el.querySelector('.pprog__txt').textContent = pr.read + '/' + pr.total + ' secciones leídas' + (pr.completed ? ' · completado' : '');
    });
    els.page.querySelectorAll('.complete-toggle').forEach((b) => {
      b.setAttribute('aria-pressed', String(pr.completed));
      b.lastChild.textContent = pr.completed ? (P.kind === 'case' ? 'Caso completado' : 'Módulo completado') : (P.kind === 'case' ? 'Marcar caso como completado' : 'Marcar módulo como completado');
    });
    els.page.querySelectorAll('.complete-row__text').forEach((el) => {
      el.textContent = pr.read === pr.total && pr.total > 0 && !pr.completed
        ? 'Leíste todas las secciones: márcalo como completado para que cuente en tu progreso.'
        : pr.read + ' de ' + pr.total + ' secciones leídas.';
    });
  }

  function setCurrentSection(sid, fromScroll) {
    if (!S.page || sid === S.currentSec) return;
    S.currentSec = sid;
    const upd = (el) => el.classList.toggle('is-current', el.dataset.sec === sid);
    els.toc.querySelectorAll('.toc__link').forEach(upd);
    els.page.querySelectorAll('.page-toc .toc__link, .tnav__link').forEach(upd);
    els.toc.querySelectorAll('.toc__link').forEach((a) => { if (a.dataset.sec === sid) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    if (fromScroll && sid) store.setLastLocation('#' + S.page.id + '.' + sid);
  }

  function observeSections() {
    if (S.observer) { S.observer.disconnect(); S.observer = null; }
    const secs = Array.from(els.page.querySelectorAll('section.sec'));
    if (!secs.length || typeof root.IntersectionObserver !== 'function') return;
    const visible = new Set();
    S.observer = new root.IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) visible.add(en.target); else visible.delete(en.target); });
      const cur = secs.find((el) => visible.has(el));
      if (cur) setCurrentSection(cur.dataset.sec, true);
    }, { rootMargin: '-12% 0px -62% 0px', threshold: 0 });
    secs.forEach((el) => S.observer.observe(el));
  }

  function buildSection(p, s, n) {
    const sid = p.id + '.' + s.id;
    const read = store.isSectionRead(p.id, s.id);
    const btn = h('button', {
      type: 'button', class: 'btn btn--sm read-toggle', 'aria-pressed': String(read), dataset: { sec: s.id },
      on: { click: () => store.setSectionRead(p.id, s.id, btn.getAttribute('aria-pressed') !== 'true') },
    }, h('span', { html: icon('check') }), h('span', null, read ? 'Leída' : 'Marcar como leída'));
    const body = h('div', { class: 'sec__body' });
    renderBlocks(s.blocks, body, { pageId: p.id, sectionId: s.id });
    const notes = MSD.Notes ? safe(() => MSD.Notes.sectionBlock(p.id, s.id), null) : null;
    return h('section', { class: 'sec', id: sid, 'aria-labelledby': 'h-' + sid, dataset: { sec: s.id } },
      h('header', { class: 'sec__head' },
        n ? h('span', { class: 'sec__num', 'aria-hidden': 'true' }, pad2(n)) : null,
        h('h2', { class: 'sec__title', id: 'h-' + sid, tabindex: '-1' }, n ? h('span', { class: 'sr-only' }, n + '. ') : null, s.title || s.id),
        prioChip(s.priority),
        s.titleEn ? h('p', { class: 'sec__en', lang: 'en' }, s.titleEn) : null),
      body,
      notes ? notes.panel : null,
      h('footer', { class: 'sec__foot' }, btn, notes ? notes.button : null));
  }

  function progressLine() {
    return h('div', { class: 'pprog' },
      h('span', { class: 'pprog__bar', 'aria-hidden': 'true' }, h('span', { class: 'pprog__fill' })),
      h('span', { class: 'pprog__txt' }));
  }

  function pageFoot(p) {
    const kindWord = p.kind === 'case' ? 'caso' : 'módulo';
    const btn = h('button', {
      type: 'button', class: 'btn complete-toggle', 'aria-pressed': 'false',
      on: { click: () => store.setPageCompleted(p.id, btn.getAttribute('aria-pressed') !== 'true') },
    }, h('span', { html: icon('flag') }), h('span', null, 'Marcar ' + kindWord + ' como completado'));
    return h('footer', { class: 'pfoot' },
      h('div', { class: 'complete-row' }, btn, h('span', { class: 'complete-row__text' })),
      pager(p.id));
  }

  // ------------------------------------------------------------------ páginas del shell
  function renderModule(c, p) {
    const m = Object.assign({}, meta(p.id), p);
    S.page = { id: p.id, kind: 'module', sections: p.sections };
    c.appendChild(pageHeader(m, { eyebrow: ['Parte 1', 'Módulo ' + pad2(m.num || +p.id.slice(1))], after: progressLine() }));
    const drill = MSD.Drill && safe(() => MSD.Drill.hasDrill(p.id), false);
    const drillCta = () => h('div', { class: 'drill-cta' },
      h('span', { class: 'drill-cta__ico', html: icon('practice') }),
      h('span', { class: 'drill-cta__txt' }, h('b', null, 'Practica este módulo'), ' · preguntas difíciles y cálculos con datos nuevos en cada ronda, con formulario y notas rápidas a la mano.'),
      h('a', { class: 'btn btn--sm btn--primary', href: '#practicar-' + p.id }, 'Practicar ' + p.id.toUpperCase()));
    if (drill) c.appendChild(drillCta());
    c.appendChild(pageTocDisclosure(p));
    p.sections.forEach((s) => c.appendChild(buildSection(p, s, 0)));
    if (drill) c.appendChild(drillCta());
    c.appendChild(pageFoot(p));
    buildToc(p, false);
    return 'toc';
  }

  // Hoja de la parte 4 (ref-numeros, ref-herramientas, ref-comandos) con secciones registradas: se pinta
  // como un módulo (secciones, marcas de lectura, TOC), sin "completado" ni anterior/siguiente, porque
  // no cuenta en el progreso del curso. Sin contenido, MSD.Reference muestra su página Próximamente.
  function renderSheet(c, p) {
    const m = Object.assign({}, meta(p.id), p);
    S.page = { id: p.id, kind: 'sheet', sections: p.sections };
    c.appendChild(pageHeader(m, { eyebrow: ['Parte 4', 'Referencias'], after: progressLine() }));
    c.appendChild(pageTocDisclosure(p));
    p.sections.forEach((s) => c.appendChild(buildSection(p, s, 0)));
    buildToc(p, false);
    return 'toc';
  }

  function caseGateState(id) {
    const done = store.listAttempts(id).length > 0;
    const revealed = !!(store.pref('solutionRevealed') || {})[id];
    return { done, revealed, gated: !done && !revealed };
  }

  function renderCase(c, p, r) {
    const m = Object.assign({}, meta(p.id), p);
    const g = caseGateState(p.id);
    S.page = { id: p.id, kind: 'case', sections: g.gated ? [] : p.sections };
    const eyebrow = ['Parte 2', 'Caso ' + pad2(m.num || +p.id.slice(1))];
    // Con la compuerta puesta no se muestra la tira de datos: sus números (pico, hardware, costo) son parte de la solución.
    c.appendChild(pageHeader(m, { eyebrow, minutesLabel: ' de lectura', after: g.gated ? null : h('div', null, specStrip(p.specs), progressLine()) }));

    if (g.gated) {
      // Solo el enunciado ambiguo del entrevistador (el mismo que muestra el simulador). El resto de la
      // sección 1 (escenario fijado, lo que anota el entrevistador) responde las preguntas de aclaración.
      const body = h('div', { class: 'gate__body' });
      body.appendChild(h('blockquote', { class: 'prompt-quote', html: String(m.prompt || 'Diseña el sistema.') }));
      if (Array.isArray(m.tests) && m.tests.length) {
        body.appendChild(h('details', { class: 'sim__hint' },
          h('summary', null, h('span', { html: icon('chevron') }), 'Pista: qué evalúa este caso'),
          h('ul', { class: 'b-list' }, m.tests.map((t) => h('li', { html: String(t) })))));
      }
      if (r.sectionId && r.sectionId !== 'enunciado') {
        const t = CASE_TEMPLATE.find((x) => x.id === r.sectionId);
        c.appendChild(h('div', { class: 'notice', role: 'note' }, h('span', { html: icon('info') }),
          h('span', null, 'La sección «' + (t ? t.title : r.sectionId) + '» es parte de la solución. Practica primero el enunciado, o ábrela sin practicar.')));
      }
      c.appendChild(h('section', { class: 'gate', 'aria-labelledby': 'gate-h' },
        h('h2', { class: 'gate__head', id: 'gate-h' }, h('span', { html: icon('timer') }), 'Enunciado · practica antes de ver la solución'),
        body,
        h('div', { class: 'gate__actions' },
          h('a', { class: 'btn btn--primary btn--lg', href: '#practica-' + p.id }, h('span', { html: icon('play') }), 'Practicar primero (45 min)'),
          h('button', { type: 'button', class: 'btn btn--text', on: { click: () => {
            const sr = store.pref('solutionRevealed') || {};
            sr[p.id] = true;
            store.setPref('solutionRevealed', sr);
            rerender(true);
          } } }, 'Ver la solución sin practicar'),
          h('p', { class: 'gate__note' }, 'En la entrevista real no ves la solución: 45 minutos con reloj, luego la rúbrica y recién entonces la solución completa (15 secciones).'))));
      c.appendChild(h('footer', { class: 'pfoot' }, pager(p.id)));
      els.toc.hidden = true;
      return 'toc';
    }

    if (g.done) {
      const best = store.listAttempts(p.id).reduce((b, a) => Math.max(b, (a.score && a.score.pct) || 0), 0);
      c.appendChild(h('div', { class: 'notice', role: 'note' }, h('span', { html: icon('star') }),
        h('span', null, 'Ya practicaste este caso (mejor puntaje: ', h('b', { class: 'mono' }, best + ' %'), '). ',
          h('a', { href: '#practica-' + p.id }, 'Practicar de nuevo'), ' · ', h('a', { href: '#historial' }, 'ver intentos'))));
    } else {
      c.appendChild(h('div', { class: 'notice', role: 'note' }, h('span', { html: icon('info') }),
        h('span', null, 'Abriste la solución sin practicar. Cuando quieras medirte: ', h('a', { href: '#practica-' + p.id }, 'practica el enunciado con reloj'), '.')));
    }

    // Navegador numerado de la plantilla (1–15)
    c.appendChild(h('nav', { class: 'tnav', 'aria-label': 'Plantilla del caso: 15 secciones' },
      h('div', { class: 'tnav__head' }, h('p', { class: 'eyebrow' }, 'Plantilla del caso · 15 secciones'), h('span', { class: 'page-toc__count mono small muted' })),
      h('ol', { class: 'tnav__list' }, p.sections.map((s, i) => h('li', { class: 'tnav__item', dataset: { sec: s.id } },
        h('a', { class: 'tnav__link', href: '#' + p.id + '.' + s.id, dataset: { sec: s.id } },
          h('span', { class: 'tnav__n' }, pad2(s.num || i + 1)),
          h('span', null, s.title || s.id),
          h('span', { class: 'tnav__tick', html: icon('check') })))))));
    p.sections.forEach((s, i) => c.appendChild(buildSection(p, s, s.num || i + 1)));
    c.appendChild(pageFoot(p));
    buildToc(p, true);
    return 'toc';
  }

  function renderSoon(c, id) {
    const m = meta(id);
    const isCase = m.kind === 'case' || /^c\d\d$/.test(id);
    S.page = null;
    const eyebrow = isCase ? ['Parte 2', 'Caso ' + pad2(m.num || +id.slice(1))] : /^m\d\d$/.test(id) ? ['Parte 1', 'Módulo ' + pad2(m.num || +id.slice(1))] : ['Parte ' + (m.part || 4)];
    eyebrow.push(h('span', { class: 'chip chip--soon', style: { marginLeft: '10px' } }, 'Próximamente'));
    c.appendChild(pageHeader(m, { eyebrow, minutesLabel: ' de lectura (estimado)' }));
    const rows = h('div', { class: 'soon-grid' });
    const row = (k, body, small) => h('div', { class: 'drow' }, h('div', { class: 'drow__label' }, k, small ? h('small', null, small) : null), h('div', { class: 'drow__body' }, body));
    if (isCase && m.prompt) {
      rows.appendChild(row('Enunciado', [
        h('blockquote', { class: 'prompt-quote', html: String(m.prompt) }),
        h('div', { class: 'modal__row' },
          h('a', { class: 'btn btn--primary', href: '#practica-' + id }, h('span', { html: icon('play') }), 'Practicar este enunciado'),
          h('span', { class: 'muted small' }, 'La práctica funciona ya; la solución llega en una fase posterior.')),
      ], 'Así lo diría el entrevistador'));
    }
    if (Array.isArray(m.topics) && m.topics.length) {
      rows.appendChild(row(isCase ? 'Qué vas a diseñar' : 'Qué vas a aprender', h('ul', { class: 'topic-list' }, m.topics.map((t) => h('li', { html: String(t) })))));
    }
    if (isCase && Array.isArray(m.tests) && m.tests.length) {
      rows.appendChild(row('Qué evalúa', h('ul', { class: 'topic-list' }, m.tests.map((t) => h('li', { html: String(t) })))));
    }
    c.appendChild(rows);
    c.appendChild(h('p', { class: 'soon-note' }, h('span', { html: icon('info') }),
      h('span', null, 'Este contenido llega en una fase posterior. Pídelo cuando termines lo anterior.')));
    if (isCourseId(id)) c.appendChild(h('footer', { class: 'pfoot' }, pager(id)));
    return isCourseId(id) ? 'toc' : 'wide';
  }

  function renderNotFound(c, r) {
    S.page = null;
    c.appendChild(pageHeader({ title: 'No encontramos esta página' }, { eyebrow: ['Dirección desconocida'] }));
    c.appendChild(h('p', { class: 'b-p' }, 'La dirección ', h('code', null, r.hash), ' no corresponde a ningún módulo, caso ni herramienta de la app.'));
    c.appendChild(h('div', { class: 'modal__row', style: { marginTop: '20px' } },
      h('a', { class: 'btn btn--primary', href: '#inicio' }, h('span', { html: icon('home') }), 'Ir al inicio'),
      h('button', { type: 'button', class: 'btn', on: { click: focusSearch } }, h('span', { html: icon('search') }), 'Buscar')));
    return 'wide';
  }

  // Inicio: panel de estudio, todo derivado del estado real.
  function renderHome(c) {
    S.page = null;
    const m = meta('inicio');
    const summary = m.summary && m.summary !== m.title ? m.summary :
      'Curso y simulador para la ronda de <i>ML System Design</i> de las entrevistas de ML Engineer: todo lo que rodea al modelo en producción —serving, datos, evaluación, monitoreo y costo— explicado como lo evalúa un entrevistador.';
    c.appendChild(h('header', { class: 'phead home-hero' },
      h('p', { class: 'eyebrow' }, 'Panel de estudio'),
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, APP_NAME),
      h('p', { class: 'phead__summary', html: summary })));

    const row = (k, small, ...body) => h('section', { class: 'drow', 'aria-label': k },
      h('h2', { class: 'drow__label' }, k, small ? h('small', null, small) : null), h('div', { class: 'drow__body' }, body));

    // Progreso (uptime strip)
    const cp = store.courseProgress();
    c.appendChild(row('Progreso', 'módulos y casos', h('div', null,
      h('div', { class: 'home-status__head' },
        h('span', { class: 'home-status__big' }, cp.done + ' de ' + cp.total, h('small', null, 'completados')),
        h('span', { class: 'home-status__stats' },
          h('span', null, h('b', null, String(cp.inProgress)), ' en curso'),
          h('span', null, h('b', null, String(cp.ready)), ' disponibles'),
          h('span', null, h('b', null, String(Math.max(0, cp.total - cp.ready))), ' próximamente'))),
      uptimeStrip(false))));

    // Ahora: continuar + siguiente recomendado
    const order = courseOrder();
    const last = parseHash(store.lastLocation() || '');
    const lastValid = store.lastLocation() && last.pageId !== 'inicio' && (isCourseId(last.pageId) || SPECIAL[last.pageId] || /^practica-c\d\d$/.test(last.pageId));
    const cont = lastValid ? last : { pageId: 'm01', sectionId: null, hash: '#m01' };
    // Siguiente recomendado: primer ítem listo y no completado que no sea el de "continuar".
    const nextId = order.find((id) => { const p = getPage(id); return id !== cont.pageId && p && p.ready && !store.pageProgress(id).completed; }) || null;
    const contPage = getPage(cont.pageId);
    const contSec = cont.sectionId && contPage && contPage.sections ? contPage.sections.find((s) => s.id === cont.sectionId) : null;
    const card = (k, id, title, text, actions) => h('div', { class: 'now-card' },
      h('span', { class: 'now-card__k' }, k),
      h('span', { class: 'now-card__title' }, label(id) ? h('span', { class: 'mono' }, label(id)) : null, title),
      text ? h('span', { class: 'now-card__text', html: text }) : null,
      h('div', { class: 'now-card__actions' }, actions));
    const contCard = card(lastValid ? 'Continúa donde lo dejaste' : 'Empieza por aquí', cont.pageId, pageTitle(cont.pageId),
      contSec ? 'Sección: ' + D.esc(contSec.title) : (meta(cont.pageId).summary || ''),
      h('a', { class: 'btn btn--primary', href: cont.hash }, lastValid ? 'Continuar' : 'Empezar', h('span', { html: icon('arrow-right') })));
    let nextCard;
    if (nextId) {
      const nm = meta(nextId);
      const pr = store.pageProgress(nextId);
      nextCard = card('Siguiente recomendado', nextId, nm.title,
        (pr.read ? pr.read + ' de ' + pr.total + ' secciones leídas. ' : '') + (nm.summary || ''),
        h('a', { class: 'btn', href: '#' + nextId }, 'Abrir ' + label(nextId)));
    } else {
      const allDone = order.every((id) => { const p = getPage(id); return !p || !p.ready || store.pageProgress(id).completed; });
      nextCard = card('Siguiente recomendado', 'practica', 'Practica con reloj',
        allDone ? 'Completaste todo lo disponible por ahora. Practica un enunciado y pide la siguiente fase.'
          : 'Cuando termines lo de la izquierda, pon a prueba lo aprendido con un enunciado: 45 minutos con reloj, sin mirar la solución.',
        h('a', { class: 'btn', href: '#practica' }, 'Ir al simulador'));
    }
    c.appendChild(row('Ahora', null, h('div', { class: 'now-grid' }, contCard, nextCard)));

    // Práctica
    const attempts = store.listAttempts();
    const drafts = store.listAttempts({ includeDrafts: true }).filter((a) => a.status === 'draft');
    const pracBody = [];
    drafts.slice(0, 3).forEach((d) => {
      const el = d.elapsedSec + (d.running && typeof d.resumedAt === 'number' ? (Date.now() - d.resumedAt) / 1000 : 0);
      pracBody.push(h('div', { class: 'notice', style: { marginTop: 0 } }, h('span', { html: icon('timer') }),
        h('span', null, 'Borrador abierto en ', h('b', null, label(d.caseId) + ' · ' + meta(d.caseId).title), ' — ', h('span', { class: 'mono' }, D.fmtDuration(el)), ' transcurridos. ',
          h('a', { href: '#practica-' + d.caseId }, 'Continuar'))));
    });
    if (attempts.length) {
      pracBody.push(h('table', { class: 'mini-table' },
        h('thead', null, h('tr', null, h('th', null, 'Caso'), h('th', null, 'Fecha'), h('th', { class: 'num' }, 'Duración'), h('th', { class: 'num' }, 'Puntaje'))),
        h('tbody', null, attempts.slice(0, 5).map((a) => {
          const pct = a.score && typeof a.score.pct === 'number' ? Math.round(a.score.pct) : null;
          return h('tr', null,
            h('td', null, h('a', { href: '#historial' }, label(a.caseId)), ' ', h('span', { class: 'muted' }, meta(a.caseId).short || '')),
            h('td', { class: 'muted' }, D.fmtDate(a.finishedAt || a.updatedAt)),
            h('td', { class: 'num' }, D.fmtDuration(a.elapsedSec)),
            h('td', { class: 'num' }, pct == null ? '—' : h('span', null, h('span', { class: 'scorebar', 'aria-hidden': 'true' }, h('i', { style: { width: pct + '%' } })), pct + ' %')));
        }))));
    } else if (!drafts.length) {
      pracBody.push(h('p', { class: 'muted' }, 'Aún no tienes intentos. El primero siempre cuesta: 45 minutos con reloj, sin mirar la solución.'));
    }
    // El primer caso listo que aún no practicaste (practicar antes de leer la solución).
    const readyCases = CASE_IDS.filter((id) => (getPage(id) || {}).ready);
    const firstCase = readyCases.find((id) => !store.listAttempts(id).length) || readyCases[0] || 'c01';
    pracBody.push(h('div', { class: 'modal__row' },
      h('a', { class: 'btn btn--primary', href: '#practica-' + firstCase }, h('span', { html: icon('play') }), 'Practicar ' + label(firstCase)),
      h('a', { class: 'btn', href: '#practica' }, 'Elegir otro caso'),
      attempts.length ? h('a', { class: 'btn btn--ghost', href: '#historial' }, 'Ver historial') : null));
    c.appendChild(row('Práctica', attempts.length ? attempts.length + (attempts.length === 1 ? ' intento' : ' intentos') : 'simulador de 45 min', pracBody));

    // Flashcards
    const cards = visibleCardIds();
    const st = store.flashStats(cards);
    const maxBox = Math.max(1, ...st.boxes);
    c.appendChild(row('Flashcards', 'repetición espaciada', cards.length
      ? h('div', { class: 'stat-line' },
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(st.due)), h('span', { class: 'stat__k' }, 'pendientes hoy')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(st.total)), h('span', { class: 'stat__k' }, 'tarjetas en el mazo')),
        h('div', { class: 'stat' },
          h('div', { class: 'boxes', 'aria-label': 'Tarjetas por caja de Leitner: ' + st.boxes.join(', ') },
            st.boxes.map((n, i) => h('div', { class: 'boxes__col', title: 'Caja ' + i + ': ' + n + (n === 1 ? ' tarjeta' : ' tarjetas') },
              h('span', { class: 'boxes__n' }, String(n)),
              h('span', { class: 'boxes__bar', style: { height: (n ? Math.max(3, Math.round(Math.sqrt(n / maxBox) * 20)) : 1) + 'px' } }),
              h('span', { class: 'boxes__k' }, String(i))))),
          h('span', { class: 'stat__k' }, 'por caja (0 → 4)')),
        h('a', { class: 'btn' + (st.due ? ' btn--primary' : ''), href: '#flashcards' }, st.due ? 'Repasar ahora (' + st.due + ')' : 'Abrir flashcards'))
      : h('p', { class: 'muted' }, 'El mazo se llena con las tarjetas de cada módulo y caso a medida que llega el contenido.')));

    // Hoja de ruta
    const cat = catalog();
    const roadmap = cat && Array.isArray(cat.roadmap) ? cat.roadmap : [];
    if (roadmap.length) {
      const chipFor = { done: ['chip--ok', 'Hecha'], next: ['chip--accent', 'Siguiente'], later: ['', 'Después'] };
      c.appendChild(row('Hoja de ruta', 'fases del contenido', h('ol', { class: 'roadmap' }, roadmap.map((ph) => {
        const cf = chipFor[ph.status] || chipFor.later;
        return h('li', { class: 'roadmap__item' },
          h('div', null, h('span', { class: 'chip ' + cf[0] }, ph.status === 'done' ? h('span', { html: icon('check') }) : null, cf[1])),
          h('div', null,
            h('div', { class: 'roadmap__title' }, ph.title || ('Fase ' + ph.phase)),
            Array.isArray(ph.items) && ph.items.length ? h('div', { class: 'roadmap__items' }, ph.items.map(linkChip)) : null,
            ph.note ? h('div', { class: 'roadmap__note', html: String(ph.note) }) : (ph.status === 'next' ? h('div', { class: 'roadmap__note' }, 'Pídela cuando termines la fase actual.') : null)));
      }))));
    }

    // Cómo usar esta app (orden real → pasos numerados)
    const how = h('div');
    renderBlocks([{ t: 'steps', items: [
      { title: 'Lee un módulo', meta: '20–40 min', html: 'Empieza por <a href="#m01">M01</a>: el mapa de la entrevista y el framework de 45 minutos. Marca cada sección como leída.' },
      { title: 'Repasa con flashcards', meta: '5–10 min al día', html: 'Las tarjetas vuelven según la repetición espaciada (Leitner); las de un caso se desbloquean cuando lo practicas o abres su solución. Poco y seguido rinde más que mucho de golpe.' },
      { title: 'Practica un caso con reloj', meta: '45 min', html: 'Lee el enunciado y escribe tu diseño siguiendo los 7 pasos; el reloj te indica en qué paso deberías ir.' },
      { title: 'Autoevalúate con la rúbrica', meta: '5 min', html: 'Seis dimensiones con niveles 1–4 y los puntos clave del caso. Sé estricto: es lo que anota el entrevistador.' },
      { title: 'Compara con la solución', meta: '30–60 min', html: 'Recién entonces abre la solución completa y anota qué te faltó; vuelve a los módulos que la rúbrica marca como débiles.' },
    ] }], how, { pageId: 'inicio' });
    c.appendChild(row('Cómo usar esta app', 'el ciclo de estudio', how,
      h('p', { class: 'kbd-hint' }, 'Atajos: ', h('kbd', null, '/'), ' buscar · ', h('kbd', null, '['), ' ', h('kbd', null, ']'), ' anterior / siguiente · ', h('kbd', null, 'Esc'), ' cerrar')));
    return 'wide';
  }

  function delegate(c, modName, r, fallback) {
    const mod = MSD[modName];
    S.page = null;
    if (!mod || typeof mod.render !== 'function') {
      if (fallback) return fallback();
      placeholderPage(c, pageTitle(r.pageId), 'Esta parte de la app todavía no está cargada. Vuelve en un momento.');
      return 'wide';
    }
    // ctx.navigate(hash): mismo pageId → no re-renderiza (solo desplaza a #<pageId>.<sectionId>);
    // ctx.rerender(): vuelve a pintar la ruta actual (conserva el scroll).
    mod.render(c, r, { store, navigate, renderBlocks, app: MSD.App, rerender: () => rerender(false) });
    return 'wide';
  }

  // ------------------------------------------------------------------ router
  function renderRoute(r) {
    const c = els.page;
    if (S.observer) { S.observer.disconnect(); S.observer = null; }
    S.currentSec = null;
    S.page = null;
    c.innerHTML = '';
    els.toc.innerHTML = '';
    els.toc.hidden = true;
    const id = r.pageId;
    let layout = 'wide';
    try {
      if (id === 'inicio') layout = renderHome(c);
      else if (isCourseId(id)) {
        const p = getPage(id);
        if (p && p.ready) layout = p.kind === 'case' ? renderCase(c, p, r) : renderModule(c, p);
        else layout = renderSoon(c, id);
      } else if (/^practica(-c\d\d)?$/.test(id) || id === 'historial') layout = delegate(c, 'Practice', r);
      else if (id === 'flashcards') layout = delegate(c, 'Flashcards', r);
      else if (id === 'mis-notas') layout = delegate(c, 'Notes', r);
      else if (/^practicar-m\d\d$/.test(id)) layout = delegate(c, 'Drill', r);
      else if (/^ref-(numeros|herramientas|comandos)$/.test(id) && (getPage(id) || {}).ready) layout = renderSheet(c, getPage(id));
      else if (id === 'glosario' || /^ref-(numeros|herramientas|comandos)$/.test(id)) layout = delegate(c, 'Reference', r, id === 'glosario' ? null : () => renderSoon(c, id));
      else layout = renderNotFound(c, r);
    } catch (e) {
      if (root.console) root.console.error('[app] error al mostrar ' + id, e);
      c.innerHTML = '';
      c.appendChild(pageHeader({ title: pageTitle(id) }, { eyebrow: [APP_NAME] }));
      c.appendChild(h('div', { class: 'block-warn', role: 'alert' }, h('span', { class: 'block-warn__icon', html: icon('warn') }),
        h('div', null, h('strong', null, 'No se pudo mostrar esta página.'), h('div', { class: 'block-warn__detail' }, String(e && e.message || e)))));
      layout = 'wide';
    }
    els.shell.dataset.layout = layout;
    document.title = id === 'inicio' ? APP_NAME : pageTitle(id) + ' · ' + APP_NAME;
    if (S.page) { refreshReadMarks(); observeSections(); }
    // Barra flotante de notas: solo en páginas con secciones visibles (módulos, casos abiertos, hojas).
    if (MSD.Notes) safe(() => MSD.Notes.setPage(S.page && S.page.sections && S.page.sections.length ? {
      id: S.page.id,
      sections: S.page.sections.map((x) => ({ id: x.id, title: x.title })),
      current: () => S.currentSec,
    } : null));
  }

  function scrollToSection(r, smooth) {
    const el = r.sectionId ? document.getElementById(r.pageId + '.' + r.sectionId) : null;
    if (!el) return false;
    el.scrollIntoView({ block: 'start', behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    const hd = el.querySelector('.sec__title') || (el.matches('[tabindex]') ? el : null);
    if (hd && hd.focus) hd.focus({ preventScroll: true });
    if (el.dataset && el.dataset.sec) setCurrentSection(el.dataset.sec, false);
    return true;
  }

  function onRoute(initial, sameHash) {
    const r = parseHash(root.location.hash);
    const prev = S.route;
    closeResults();
    if (S.modalOpen) closeModal();
    if (prev && prev.pageId === r.pageId && !S.forceRender) {
      S.route = r;
      if (r.sectionId) scrollToSection(r, true);
      else if (!sameHash || prev.sectionId) root.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      if (r.sectionId && isCourseId(r.pageId)) store.setLastLocation(r.hash);
      return;
    }
    S.forceRender = false;
    S.route = r;
    renderRoute(r);
    updateNavMarkers();
    revealNavItem();
    renderSideUptime();
    const known = r.pageId === 'inicio' || isCourseId(r.pageId) || SPECIAL[r.pageId] || /^practica-c\d\d$/.test(r.pageId) || /^practicar-m\d\d$/.test(r.pageId);
    if (known && r.pageId !== 'inicio') {
      store.markVisited(r.pageId);
      // "Continúa donde lo dejaste" no debe apuntar a una página "Próximamente".
      const soon = (isCourseId(r.pageId) || /^ref-/.test(r.pageId)) && !(getPage(r.pageId) || {}).ready;
      if (!soon) store.setLastLocation(r.hash);
    }
    const scrolled = r.sectionId ? scrollToSection(r, false) : false;
    if (!scrolled) root.scrollTo(0, 0);
    if (!initial && !scrolled) {
      const t = document.getElementById('page-title') || els.page.querySelector('h1');
      if (t) { if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); }
    }
  }

  // Re-render de la página actual (p. ej. tras importar o fusionar datos remotos), conservando el scroll.
  function rerender(focusTitle) {
    if (!S.route) return;
    const y = root.scrollY;
    renderRoute(S.route);
    updateNavMarkers();
    if (focusTitle) {
      const t = document.getElementById('page-title');
      if (t) t.focus({ preventScroll: true });
      root.scrollTo(0, 0);
    } else root.scrollTo(0, y);
  }

  // ------------------------------------------------------------------ cambios del store (sin re-render mientras escribes)
  function onStoreChange(kind) {
    S.pending.add(kind);
    if (S.flushQueued) return;
    S.flushQueued = true;
    const run = () => { S.flushQueued = false; flushStoreChanges(); };
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run); else setTimeout(run, 16);
  }

  function flushStoreChanges() {
    const kinds = S.pending;
    S.pending = new Set();
    const only = (list) => Array.from(kinds).every((k) => list.indexOf(k) >= 0);
    if (only(['location', 'visit'])) return;
    if (kinds.has('prefs') || kinds.has('remote') || kinds.has('import')) {
      const t = store.pref('theme') || 'system';
      applyTheme(t);
      syncThemeButtons(t);
    }
    if (only(['location', 'visit', 'prefs'])) return;
    if (kinds.has('notes') || kinds.has('remote') || kinds.has('import')) S.searchItems = null;
    updateNavMarkers();
    renderSideUptime();
    if (kinds.has('progress')) refreshReadMarks();
    if (kinds.has('remote') || kinds.has('import')) {
      renderFoot();
      const shellPage = S.route && (S.route.pageId === 'inicio' || isCourseId(S.route.pageId) || (S.page && S.page.kind === 'sheet') || S.route.pageId === 'mis-notas' || S.route.pageId === 'glosario');
      const typing = isTextEntry(document.activeElement) && els.page.contains(document.activeElement);
      if (shellPage && !typing) rerender(false);
    }
  }

  // ------------------------------------------------------------------ teclado global
  function neighbor(dir) {
    const order = courseOrder();
    const cur = S.route ? S.route.pageId : 'inicio';
    const i = order.indexOf(cur);
    if (i < 0) return cur === 'inicio' && dir > 0 ? order[0] : null;
    return order[i + dir] || null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (S.modalOpen) { e.preventDefault(); closeModal(); return; }
      if (!els.results.hidden) { closeResults(); return; }
      if (S.drawerOpen) { e.preventDefault(); closeDrawer(true); return; }
      return;
    }
    if (S.modalOpen) { trapTab(e, els.modal); return; }
    if (S.drawerOpen) { trapTab(e, els.sidebar); }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTextEntry(e.target)) return;
    if (e.key === '/') { e.preventDefault(); focusSearch(); }
    else if (e.key === '[' || e.key === ']') {
      const t = neighbor(e.key === ']' ? 1 : -1);
      if (t) { e.preventDefault(); navigate('#' + t); }
    }
  }

  // ------------------------------------------------------------------ arranque
  function boot() {
    if (S.booted) return;
    S.booted = true;
    const $ = (id) => document.getElementById(id);
    Object.assign(els, {
      page: $('page'), toc: $('toc'), shell: $('shell'), nav: $('nav'), sideUptime: $('side-uptime'), foot: $('side-foot'),
      banner: $('dev-banner'), search: $('search-input'), results: $('search-results'), sidebar: $('sidebar'),
      backdrop: $('backdrop'), menuBtn: $('menu-btn'), drawerClose: $('drawer-close'), topbar: $('topbar'),
      topProgress: $('topbar-progress'), modal: $('modal'),
    });
    if (!els.page || !els.nav) { if (root.console) root.console.error('[app] index.html no tiene los contenedores esperados'); return; }

    applyTheme(store.pref('theme'));
    buildNav();
    renderSideUptime();
    renderFoot();
    renderDevBanner();
    bindSearch();

    els.menuBtn.addEventListener('click', () => (S.drawerOpen ? closeDrawer(true) : openDrawer()));
    els.drawerClose.addEventListener('click', () => closeDrawer(true));
    els.backdrop.addEventListener('click', () => closeDrawer(true));
    els.modal.addEventListener('mousedown', (e) => { if (e.target === els.modal) closeModal(); });
    if (mq) {
      const onMq = () => { if (!isDrawerMode() && S.drawerOpen) closeDrawer(false); };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    const skip = $('skip-link');
    if (skip) skip.addEventListener('click', (e) => { e.preventDefault(); const t = document.getElementById('page-title') || els.page; if (t) { t.setAttribute('tabindex', '-1'); t.focus(); } });
    // Enlace al mismo hash (p. ej. volver a la misma sección): hashchange no se dispara → se maneja aquí.
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.getAttribute('href') === root.location.hash && a.getAttribute('href') !== '#') { e.preventDefault(); onRoute(false, true); }
    });
    document.addEventListener('keydown', onKeydown);
    root.addEventListener('hashchange', () => onRoute(false));

    store.subscribe(onStoreChange);
    store.onStatus(() => renderStatus());
    onRoute(true);
  }

  // Mantiene visible en la barra lateral el ítem actual (sin mover la ventana).
  function revealNavItem() {
    const a = els.nav.querySelector('[aria-current="page"]');
    if (!a) return;
    const nav = els.nav;
    const top = a.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
    if (top < nav.scrollTop + 8 || top + a.offsetHeight > nav.scrollTop + nav.clientHeight - 8) {
      nav.scrollTop = Math.max(0, top - nav.clientHeight / 3);
    }
  }

  MSD.App = {
    boot, navigate, rerender,
    route: () => (S.route ? Object.assign({}, S.route) : null),
    renderBlocks, uptimeStrip, openPortability, parseHash,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
