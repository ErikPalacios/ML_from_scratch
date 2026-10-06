/* =============================================================================
   Atlas de Arquitecturas — js/app.js
   Basado en apps/ml-system-design/js/app.js.
   ATLAS.App: arranque, router por hash (SPEC §4.2–4.3, incl. #página.sección~nodo), barra
   lateral (índice por bloques, búsqueda, tira de familias compacta, estado del guardado, tema,
   exportar/importar), páginas del shell (§4.5: inicio, modelo con plantilla de 11 secciones y
   ficha técnica, repaso, mapa y hojas de referencia, próximamente, tarjeta, buscar, no encontrado),
   TOC derecho con marcas de lectura y delegación a ATLAS.Practice / Flashcards / Reference.
   También define ATLAS.labLink (§10.3). Tolera catálogo, calculadora o componentes ausentes:
   estados vacíos o avisos visibles, nunca excepciones.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const D = ATLAS.dom;
  const { h, icon } = D;
  const store = ATLAS.store;
  const APP_NAME = 'Atlas de Arquitecturas';

  const MODEL_TEMPLATE = ATLAS.MODEL_TEMPLATE || [];

  // Páginas especiales: valores por defecto si el catálogo no las trae.
  const SPECIAL = {
    inicio: { title: 'Inicio', short: 'Inicio', ico: 'home' },
    mapa: { title: 'Mapa de familias', short: 'Mapa', ico: 'map' },
    'repaso-atencion': { title: 'Repaso de atención', short: 'Repaso de atención', ico: 'formula', kind: 'recap', block: 0 },
    practica: { title: 'Práctica', short: 'Ejercicios', ico: 'drill' },
    flashcards: { title: 'Flashcards', short: 'Flashcards', ico: 'cards' },
    'ref-formas': { title: 'Formas y fórmulas', short: 'Formas y fórmulas', ico: 'ref' },
    glosario: { title: 'Glosario ES–EN', short: 'Glosario', ico: 'book' },
    buscar: { title: 'Buscar', short: 'Buscar', ico: 'search' },
  };
  // Si no hay catálogo, el índice sigue mostrando los modelos del plan (SPEC §13.3), como "Próx.".
  const FALLBACK_MODELS = {
    1: ['vit', 'swin', 'clip', 'detr', 'grounding-dino', 'yolo-world', 'sam', 'sam2', 'llm-decoder', 'llm-inferencia', 'llava', 'qwen2-vl', 'stable-diffusion', 'dit', 'rt2', 'openvla', 'pi0'],
    2: ['lora', 'rlhf-dpo', 'bert', 'retrieval', 'ann', 't5', 'whisper', 'two-tower', 'dlrm', 'gbdt'],
    3: ['bytetrack', 'depth', 'pointnet', 'rl-ppo', 'imitation'],
  };
  const BLOCKS = {
    0: { label: 'Repaso', long: 'Repaso de atención' },
    1: { label: 'Bloque 1', long: 'Visión + atención' },
    2: { label: 'Bloque 2', long: 'LLMs, retrieval y ML de industria' },
    3: { label: 'Bloque 3', long: 'Robótica' },
  };
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
    route: null, page: null, observer: null, wideObserver: null, currentSec: null,
    searchItems: null, results: [], active: -1,
    pending: new Set(), flushQueued: false,
    drawerOpen: false, modalOpen: false, lastFocus: null, booted: false, forceRender: false,
    delegated: null,   // controlador {destroy} que devolvió el renderizador de una página delegada
    pendingFrom: new Set(),   // orígenes de los cambios pendientes del store: local | tab | account
  };
  const themeListeners = new Set();

  // ------------------------------------------------------------------ utilidades seguras
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const catalog = () => safe(() => (typeof ATLAS.catalog === 'function' ? ATLAS.catalog() : null), null);
  const items = () => (catalog() && catalog().items) || {};
  const pad2 = (n) => String(n).padStart(2, '0');
  const getPage = (id) => safe(() => ATLAS.getPage(id), null);
  const strip = (s) => (typeof ATLAS.stripHtml === 'function' ? ATLAS.stripHtml(s) : String(s || '').replace(/<[^>]*>/g, ''));
  const reduced = () => D.reducedMotion();
  const arr = (x) => (Array.isArray(x) ? x : []);
  const B = () => ATLAS.Blocks || null;

  function courseOrder() {
    const o = safe(() => ATLAS.courseOrder(), []);
    if (o.length) return o;
    return ['repaso-atencion'].concat(FALLBACK_MODELS[1], FALLBACK_MODELS[2], FALLBACK_MODELS[3]);
  }

  function meta(id) {
    const it = items()[id];
    if (it) return Object.assign({ id }, SPECIAL[id] || {}, it);
    if (SPECIAL[id]) return Object.assign({ id, kind: 'special' }, SPECIAL[id]);
    for (const b of [1, 2, 3]) {
      const i = FALLBACK_MODELS[b].indexOf(id);
      if (i >= 0) return { id, kind: 'model', block: b, num: i + 1, title: id, short: id };
    }
    return { id, kind: 'special', title: id, short: id };
  }
  const isCourse = (id) => { const k = meta(id).kind; return k === 'model' || k === 'recap'; };
  function pageTitle(id) {
    const pm = /^practica-(.+)$/.exec(id);
    if (pm && meta(pm[1]).kind === 'model') return 'Práctica: ' + (meta(pm[1]).short || meta(pm[1]).title);
    return meta(id).title || id;
  }
  function modelsOfBlock(b) {
    const list = Object.values(items()).filter((it) => it.kind === 'model' && (it.block || 0) === b)
      .sort((x, y) => (x.num || 0) - (y.num || 0)).map((it) => it.id);
    return list.length || catalog() ? list : FALLBACK_MODELS[b] || [];
  }

  // Modelo de la calculadora y config canónica de una página (contexto de los bloques generados).
  function archCtx(m) {
    const config = m.canonical || null;
    let model = m.model || m.archModel || null;
    if (!model && config && B()) { const r = B().run(config); model = r && r.run ? r.run.model : null; }
    return { model: model || (m.kind === 'model' ? m.id : null), config };
  }

  // ------------------------------------------------------------------ enlace al Laboratorio (§10.3)
  // ATLAS_ENV lo fijan los builds: 'single' (dist/atlas-arquitecturas.html), 'web' (dist/web), 'artifact'.
  function labLink(tab) {
    const t = String(tab == null ? '' : tab).replace(/[^A-Za-z0-9._~-]/g, '');
    const env = root.ATLAS_ENV || 'dev';
    if (env === 'artifact') return null;
    if (env === 'web') return 'lab/#' + t;
    if (env === 'single') return '../../transformer-lab/index.html#' + t;
    return '../transformer-lab/index.html#' + t;
  }
  ATLAS.labLink = labLink;

  // ------------------------------------------------------------------ hash
  // #página · #página.sección · #página.sección.sub · #página.sección~nodo · #página.sección~diagrama.nodo
  // (la forma calificada desambigua un id de nodo que se repite en varios diagramas de la sección)
  function parseHash(hash) {
    let s = String(hash || '').replace(/^#/, '');
    try { s = decodeURIComponent(s); } catch (e) { /* hash raro: se usa tal cual */ }
    if (!s) return { pageId: 'inicio', sectionId: null, section: null, sub: null, node: null, hash: '#inicio' };
    let node = null;
    const t = s.indexOf('~');
    let base = s;
    if (t >= 0) { node = s.slice(t + 1) || null; base = s.slice(0, t); }
    const i = base.indexOf('.');
    const pageId = i < 0 ? base : base.slice(0, i);
    const sectionId = i < 0 ? null : base.slice(i + 1) || null;
    const j = sectionId ? sectionId.indexOf('.') : -1;
    const section = sectionId ? (j < 0 ? sectionId : sectionId.slice(0, j)) : null;
    const sub = sectionId && j >= 0 ? sectionId.slice(j + 1) || null : null;
    const r = { pageId, sectionId, section, sub, node, nodeDiagram: null, nodeId: node, hash: '#' + s };
    if (node) { const k = node.indexOf('.'); if (k > 0) { r.nodeDiagram = node.slice(0, k); r.nodeId = node.slice(k + 1) || null; } }
    const pm = /^practica-(.+)$/.exec(pageId);
    if (pm) r.modelId = pm[1];
    return r;
  }

  function navigate(hash) {
    const hsh = String(hash || '').charAt(0) === '#' ? String(hash) : '#' + String(hash || '');
    if (root.location.hash === hsh) onRoute(false, true);
    else root.location.hash = hsh;
  }

  function renderBlocks(blocks, el, pageCtx) {
    return B() ? B().renderAll(blocks, el, Object.assign({ store }, pageCtx || {})) : el;
  }
  function typeset(el) {
    const M = ATLAS.MathTex;
    if (M && typeof M.typeset === 'function' && el) { try { M.typeset(el); } catch (e) { /* respaldo: LaTeX como texto */ } }
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

  // Tira de familias (§3.4.4): una celda por modelo (y el repaso), agrupadas por familia.
  function stripGroups() {
    const its = Object.values(items()).filter((it) => it.kind === 'model' || it.kind === 'recap');
    const fams = safe(() => ATLAS.families(), []);
    const groups = [];
    const used = new Set();
    const order = courseOrder();
    const byOrder = (a, b) => order.indexOf(a.id) - order.indexOf(b.id);
    for (const f of fams) {
      const ms = its.filter((it) => it.family === f.id).sort(byOrder);
      if (!ms.length) continue;
      ms.forEach((m) => used.add(m.id));
      groups.push({ id: f.id, title: f.short || String(f.title || f.id).replace(/\s*\(.*\)\s*$/, ''), ids: ms.map((m) => m.id) });
    }
    const rest = order.filter((id) => !used.has(id) && isCourse(id));
    if (rest.length) groups.push({ id: 'otros', title: groups.length ? 'Otros' : 'Curso', ids: rest });
    return groups;
  }

  function familiesStrip(compact) {
    const current = S.route && S.route.pageId;
    const cell = (id) => {
      const st = store.pageState(id);
      const m = meta(id);
      const cls = 'ucell ucell--' + st + (id === current ? ' is-current' : '');
      const title = (m.short || m.title) + ' — ' + STATE_LABEL[st];
      const el = compact ? h('span', { class: cls, title }) : h('a', { class: cls, href: '#' + id, title, tabindex: '-1' });
      if (st === 'progress') el.appendChild(h('i', { style: { height: Math.max(18, store.pageProgress(id).pct) + '%' } }));
      return el;
    };
    const groups = stripGroups();
    const cp = store.courseProgress();
    const summary = cp.done + ' de ' + cp.total + ' completados, ' + cp.inProgress + ' en curso, ' + cp.ready + ' disponibles.';
    const out = h('div', { class: 'fstrip' + (compact ? ' fstrip--compact' : '') },
      h('div', { class: 'fstrip__groups', 'aria-hidden': 'true' }, groups.map((g) =>
        h('div', { class: 'fstrip__grp', style: { '--n': String(g.ids.length) } },
          h('div', { class: 'fstrip__cells' }, g.ids.map(cell)),
          compact ? null : h('span', { class: 'fstrip__label' }, g.title)))),
      h('p', { class: 'sr-only' }, 'Estado del atlas: ' + summary));
    if (!compact) {
      out.appendChild(h('div', { class: 'fstrip__legend' },
        ['done', 'progress', 'ready', 'soon'].map((st) => h('span', null,
          h('span', { class: 'ucell ucell--' + st, 'aria-hidden': 'true' }, st === 'progress' ? h('i', { style: { height: '50%' } }) : null),
          STATE_LABEL[st].charAt(0).toUpperCase() + STATE_LABEL[st].slice(1)))));
    }
    return out;
  }

  function freqEl(f) {
    if (!FREQ_LABEL[f]) return null;
    return h('span', { class: 'freq freq--' + f, title: 'Qué tan seguido aparece en entrevistas de ML/AI Engineer' },
      h('span', { class: 'freq__bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', null, 'Frecuencia en entrevistas: ', h('b', null, FREQ_LABEL[f])));
  }

  // Chip a otra página. Entradas con '*' (resnet*, yolo*) = lo que ya sabes: chip gris al mapa.
  function linkChip(rawId) {
    const anchor = /\*$/.test(rawId);
    const id = String(rawId).replace(/\*$/, '');
    const m = meta(id);
    const txt = m.short || m.title || id;
    if (anchor || m.anchor || m.kind === 'card') {
      return h('a', { class: 'chip chip--anchor', href: '#mapa.' + (ATLAS.slug ? ATLAS.slug(id) : id), title: (m.title || txt) + (anchor || m.anchor ? ' — ya lo conoces' : ' — tarjeta del mapa') }, txt);
    }
    const p = getPage(id);
    const ready = p && p.ready;
    return h('a', { class: 'chip' + (ready || !isCourse(id) ? '' : ' chip--soonlink'), href: '#' + id, title: (m.title || txt) + (ready || !isCourse(id) ? '' : ' — próximamente') }, txt);
  }

  function prioChip(p) {
    const x = PRIO[p];
    return x ? h('span', { class: 'prio ' + x[0] }, x[1]) : null;
  }

  // Ficha técnica (§3.4.1): paper · año · config canónica · parámetros · tokens · GMACs (de la calculadora).
  function fichaTecnica(m) {
    const cells = [];
    const p = m.paper || null;
    if (p) {
      const year = p.year || (/(\d{4})/.exec(String(p.venue || '')) || [])[1];
      cells.push(['Paper', h('span', null, p.authors ? String(p.authors) : '', p.venue ? h('span', { class: 'muted' }, (p.authors ? ' · ' : '') + String(p.venue).replace(/\s*\d{4}$/, '')) : null)]);
      if (year) cells.push(['Año', year]);
    }
    const res = m.canonical && B() ? B().run(m.canonical) : null;
    if (res && res.run) {
      const r = res.run;
      const F = B().fmt;
      cells.push(['Config canónica', r.label || m.canonical]);
      if (r.totals && typeof r.totals.params === 'number') cells.push(['Parámetros', h('span', { title: F.int(r.totals.params) + ' parámetros' }, F.si(r.totals.params))]);
      const tok = r.quantities && r.quantities.tokens;
      if (tok != null) cells.push(['Tokens', F.int(tok)]);
      if (r.totals && typeof r.totals.macs === 'number') {
        const big = r.totals.macs >= 1e7;   // modelos de juguete: MACs enteros, no "0.00 G"
        cells.push([big ? 'GMACs' : 'MACs', h('span', { title: F.int(r.totals.macs) + ' MACs (FLOPs = 2 × MACs)' }, big ? (r.totals.macs / 1e9).toFixed(2) : F.int(r.totals.macs))]);
      }
    } else if (m.canonical) {
      cells.push(['Config canónica', m.canonical]);
      cells.push(['Calculadora', h('span', { class: 'muted' }, res && res.error && res.error !== 'no-arch' ? 'error: ' + res.error : 'no disponible')]);
    }
    if (!cells.length) return null;
    return h('dl', { class: 'specstrip ficha', 'aria-label': 'Ficha técnica (números de la calculadora)' }, cells.map(([k, v]) =>
      h('div', { class: 'specstrip__item' }, h('dt', null, k), h('dd', null, v))));
  }

  function connections(m) {
    const from = arr(m.from).filter((x) => x && x !== m.id);
    const to = arr(m.to).filter((x) => x && x !== m.id);
    if (!from.length && !to.length) return null;
    return h('div', { class: 'conn' },
      from.length ? h('div', { class: 'conn__row' }, h('span', { class: 'conn__k' }, 'Viene de'), h('span', { class: 'conn__chips' }, from.map(linkChip))) : null,
      to.length ? h('div', { class: 'conn__row' }, h('span', { class: 'conn__k' }, 'Lleva a'), h('span', { class: 'conn__chips' }, to.map(linkChip))) : null);
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
    if (m.level) metaRow.appendChild(h('span', { class: 'meta-item' }, 'Nivel ', h('b', { class: 'mono', style: { color: 'var(--ink)' } }, String(m.level))));
    const fq = freqEl(m.freq);
    if (fq) metaRow.appendChild(fq);
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
      const p = getPage(tid);
      return h('a', { class: 'pager__link pager__link--' + dir + (p && p.ready ? '' : ' is-soon'), href: '#' + tid, rel: dir === 'next' ? 'next' : 'prev' },
        h('span', { class: 'pager__dir' },
          dir === 'prev' ? h('span', { html: icon('arrow-left') }) : null,
          dir === 'prev' ? 'Anterior' : 'Siguiente',
          dir === 'next' ? h('span', { html: icon('arrow-right') }) : null),
        h('span', { class: 'pager__title' }, m.short || m.title, p && p.ready ? null : h('span', { class: 'pager__soon' }, ' · próximamente')));
    };
    return h('div', null,
      h('nav', { class: 'pager', 'aria-label': 'Anterior y siguiente en el curso' }, link(order[i - 1], 'prev'), link(order[i + 1], 'next')),
      h('p', { class: 'kbd-hint' }, 'Atajos: ', h('kbd', null, '['), ' anterior · ', h('kbd', null, ']'), ' siguiente · ', h('kbd', null, '/'), ' buscar'));
  }

  function placeholderPage(container, title, text) {
    container.appendChild(pageHeader({ title }, { eyebrow: [APP_NAME] }));
    container.appendChild(h('div', { class: 'block-warn', role: 'note' }, h('span', { class: 'block-warn__icon', html: icon('warn') }),
      h('div', null, h('strong', null, text || 'Esta sección se está preparando.'))));
  }

  // ------------------------------------------------------------------ barra lateral
  function navGroups() {
    const groups = [{ id: 'top', label: null, ids: ['inicio', 'mapa', 'repaso-atencion'] }];
    for (const b of [1, 2, 3]) {
      groups.push({ id: 'b' + b, label: BLOCKS[b].label + ' — ' + BLOCKS[b].long, ids: modelsOfBlock(b), models: true });
    }
    groups.push({ id: 'prac', label: 'Práctica', ids: ['practica', 'flashcards'] });
    groups.push({ id: 'ref', label: 'Referencia', ids: ['ref-formas', 'glosario'] });
    return groups;
  }

  function buildNav() {
    els.nav.innerHTML = '';
    for (const g of navGroups()) {
      if (!g.ids.length) continue;
      const list = h('ul', { class: 'nav__list' });
      for (const id of g.ids) {
        const m = meta(id);
        const numEl = g.models
          ? h('span', { class: 'nav__num' }, m.num ? pad2(m.num) : '·')
          : h('span', { class: 'nav__num', html: icon(m.ico || (SPECIAL[id] && SPECIAL[id].ico) || 'dot') });
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

  function visibleCardIds() {
    const F = ATLAS.Flashcards;
    const cards = F && typeof F.visibleCards === 'function'
      ? safe(() => F.visibleCards(store), null)
      : safe(() => ATLAS.flashcards().filter((c) => c && c.id), null);
    return (cards || []).map((c) => c.id);
  }

  function updateNavMarkers() {
    const cur = S.route ? S.route.pageId : null;
    const cards = visibleCardIds();
    const due = cards.length ? store.dueCards(cards).length : 0;
    els.nav.querySelectorAll('.nav__item').forEach((a) => {
      const id = a.dataset.id;
      const mk = a.querySelector('.nav__mk');
      const m = meta(id);
      let html = '';
      let title = m.title || id;
      a.classList.remove('is-soon');
      if (isCourse(id)) {
        const st = store.pageState(id);
        if (st === 'done') html = '<span class="mk-done">' + icon('check') + '</span>';
        else if (st === 'progress') html = ringSvg(store.pageProgress(id).pct);
        else if (st === 'soon') { html = '<span class="mk-soon">Próx.</span>'; a.classList.add('is-soon'); }
        title += ' — ' + STATE_LABEL[st];
      } else if (id === 'flashcards' && due > 0) {
        html = '<span class="mk-count">' + due + '</span>';
        title += ' — ' + due + ' pendientes hoy';
      } else if ((id === 'mapa' || id === 'ref-formas') && !(getPage(id) || {}).ready) {
        html = '<span class="mk-soon">Próx.</span>';
        a.classList.add('is-soon');
        title += ' — próximamente';
      }
      if (mk.innerHTML !== html) mk.innerHTML = html;
      a.title = title;
      const isCur = id === cur || (id === 'practica' && /^practica-/.test(cur || ''));
      if (isCur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function renderSideStrip() {
    const cp = store.courseProgress();
    els.sideStrip.innerHTML = '';
    els.sideStrip.appendChild(h('div', { class: 'side-uptime__row' },
      h('span', { class: 'side-uptime__label' }, 'Progreso'),
      h('span', { class: 'side-uptime__count', title: cp.done + ' de ' + cp.total + ' páginas del curso completadas (modelos + repaso)' }, cp.done + '/' + cp.total)));
    els.sideStrip.appendChild(familiesStrip(true));
    if (els.topProgress) els.topProgress.textContent = cp.done + '/' + cp.total;
  }

  function renderFoot() {
    const f = els.foot;
    f.innerHTML = '';
    const status = h('div', { class: 'store-status', id: 'store-status' }, h('span', { class: 'store-status__dot', 'aria-hidden': 'true' }), h('span', { class: 'store-status__text' }));
    const t0 = store.pref('theme');
    const theme = t0 === 'light' || t0 === 'dark' ? t0 : 'system';
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

  // ------------------------------------------------------------------ tema
  const darkMq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveTheme() {
    const t = store.pref('theme');
    if (t === 'light' || t === 'dark') return t;
    return darkMq && darkMq.matches ? 'dark' : 'light';
  }
  let lastTheme = null;
  function emitTheme() {
    const t = effectiveTheme();
    if (t === lastTheme) return;
    lastTheme = t;
    for (const fn of Array.from(themeListeners)) { try { fn(t); } catch (e) { if (root.console) root.console.error(e); } }
  }
  function onTheme(fn) {
    if (typeof fn !== 'function') return () => {};
    themeListeners.add(fn);
    return () => themeListeners.delete(fn);
  }
  function applyTheme(t) {
    const de = document.documentElement;
    if (t === 'light' || t === 'dark') de.setAttribute('data-theme', t); else de.removeAttribute('data-theme');
    emitTheme();
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
    const probs = safe(() => ATLAS.registryProblems(), []).slice();
    if (!catalog()) probs.unshift('No se cargó el catálogo (js/content/catalog.js): se muestran nombres genéricos.');
    if (!B()) probs.push('No se cargó js/ui/blocks.js.');
    els.banner.innerHTML = '';
    els.banner.hidden = !probs.length;
    if (!probs.length) return;
    els.banner.appendChild(h('details', null,
      h('summary', null, 'Aviso de desarrollo: ' + probs.length + (probs.length === 1 ? ' problema' : ' problemas') + ' al cargar el contenido'),
      h('ul', null, probs.map((p) => h('li', null, p)))));
  }

  // ------------------------------------------------------------------ búsqueda
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const TYPE_LABEL = { page: 'Página', section: 'Sección', block: 'Bloque', term: 'Término', card: 'Tarjeta' };
  // Las tarjetas no suman bonos por título (sus preguntas son largas) y salen como máximo 3.
  const TYPE_WEIGHT = { page: 40, section: 30, block: 26, term: 20, card: 0 };
  const MAX_CARD_RESULTS = 3;
  const MAX_RESULTS = 24;

  function ensureIndex() {
    if (S.searchItems) return S.searchItems;
    const idx = safe(() => ATLAS.searchIndex(), []);
    S.searchItems = idx.map((e) => Object.assign({}, e, { nTitle: norm(e.title), nText: norm(e.text) }));
    return S.searchItems;
  }

  function runSearch(q, max) {
    const tokens = norm(q).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const out = [];
    for (const e of ensureIndex()) {
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
    return out.filter((x) => x.e.type !== 'card' || nc++ < MAX_CARD_RESULTS).slice(0, max || MAX_RESULTS).map((x) => x.e);
  }

  function renderResults(q) {
    const box = els.results;
    box.innerHTML = '';
    S.results = q.trim() ? runSearch(q) : [];
    S.active = S.results.length ? 0 : -1;
    if (!q.trim()) { closeResults(); return; }
    box.appendChild(h('div', { class: 'search__meta', 'aria-hidden': 'true' },
      S.results.length ? S.results.length + (S.results.length === MAX_RESULTS ? '+ resultados · ' : ' resultados · ') + '↑↓ para moverte, Enter para abrir' : ''));
    if (!S.results.length) box.appendChild(h('div', { class: 'search__empty' }, 'Sin resultados para «' + q.trim() + '». Prueba con el término en inglés o en español.'));
    S.results.forEach((e, i) => {
      box.appendChild(h('div', {
        class: 'sres', role: 'option', id: 'sres-' + i, 'aria-selected': String(i === S.active), dataset: { i },
        on: { mousedown: (ev) => ev.preventDefault(), click: () => openResult(i), mousemove: () => setActive(i) },
      },
      h('span', { class: 'sres__type' }, TYPE_LABEL[e.type] || e.type),
      h('span', { class: 'sres__title' }, e.title),
      e.text ? h('span', { class: 'sres__text' }, e.text) : null));
    });
    if (S.results.length === MAX_RESULTS) {
      box.appendChild(h('a', { class: 'search__all', href: '#buscar', on: { mousedown: (ev) => ev.preventDefault(), click: () => { S.searchQuery = q; closeResults(); if (S.drawerOpen) closeDrawer(false); } } }, 'Ver todos los resultados'));
    }
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
    const importTa = h('textarea', { class: 'textarea', rows: 6, id: 'import-text', spellcheck: 'false', placeholder: '{ "app": "atlas-arquitecturas", "v": 1, … }' });
    const msg = h('p', { class: 'result-msg', role: 'status', 'aria-live': 'polite' });
    // Tamaño en unidades decimales, con el formateador único de la app (ATLAS.Arch.fmt.bytes).
    const nBytes = new Blob([json]).size;
    const F = ATLAS.Arch && ATLAS.Arch.fmt;
    const sizeTxt = F && typeof F.bytes === 'function' ? safe(() => F.bytes(nBytes), null) || (nBytes / 1000).toFixed(1) + ' KB' : (nBytes / 1000).toFixed(1) + ' KB';
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
        msg.textContent = 'Importado y fusionado: ' + pl(r.sections, 'sección leída', 'secciones leídas') + ', ' + pl(r.cards, 'tarjeta', 'tarjetas') + ', ' + pl(r.drills, 'ejercicio', 'ejercicios') + '.';
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
          h('p', null, 'Copia este respaldo y guárdalo (en un archivo .json o en tus notas). Incluye secciones leídas, flashcards, ejercicios de práctica, diagramas en blanco y preferencias.'),
          exportTa,
          h('div', { class: 'modal__row' }, copyBtn, h('span', { class: 'muted small mono' }, sizeTxt))),
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

  function buildToc(p, numbered) {
    const secs = p.sections;
    els.toc.innerHTML = '';
    els.toc.appendChild(h('p', { class: 'toc__title' }, 'En esta página'));
    els.toc.appendChild(h('ol', { class: 'toc__list' }, secs.map((s, i) => h('li', { dataset: { sec: s.id } }, tocLink(p, s, numbered ? (s.num || i + 1) : 0)))));
    els.toc.appendChild(h('div', { class: 'toc__foot' },
      h('span', { class: 'toc__count' }),
      h('br'),
      h('a', { href: '#' + p.id, on: { click: (e) => { e.preventDefault(); root.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); } } }, 'Volver arriba')));
    els.toc.hidden = false;
  }

  function pageTocDisclosure(p) {
    return h('details', { class: 'page-toc' },
      h('summary', null, h('span', { html: icon('chevron') }), 'Secciones', h('span', { class: 'page-toc__count' })),
      h('ol', null, p.sections.map((s) => h('li', { dataset: { sec: s.id } }, tocLink(p, s, 0)))));
  }

  const completeLabel = (kind, done) => {
    const w = kind === 'recap' ? 'repaso' : 'modelo';
    return done ? (kind === 'recap' ? 'Repaso completado' : 'Modelo completado') : 'Marcar ' + w + ' como completado';
  };

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
      b.lastChild.textContent = completeLabel(P.kind, pr.completed);
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

  // Los diagramas .wide ocupan también la columna del TOC (≥ 1200 px): mientras uno está a la vista,
  // el TOC se oculta para no quedar debajo.
  function observeWide() {
    if (S.wideObserver) { S.wideObserver.disconnect(); S.wideObserver = null; }
    els.toc.classList.remove('is-covered');
    const wides = Array.from(els.page.querySelectorAll('.wide'));
    if (!wides.length || typeof root.IntersectionObserver !== 'function') return;
    const vis = new Set();
    S.wideObserver = new root.IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) vis.add(en.target); else vis.delete(en.target); });
      els.toc.classList.toggle('is-covered', vis.size > 0);
    }, { rootMargin: '0px', threshold: 0 });
    wides.forEach((el) => S.wideObserver.observe(el));
  }

  function buildSection(p, s, n, pageCtx) {
    const sid = p.id + '.' + s.id;
    const read = store.isSectionRead(p.id, s.id);
    const btn = h('button', {
      type: 'button', class: 'btn btn--sm read-toggle', 'aria-pressed': String(read), dataset: { sec: s.id },
      on: { click: () => store.setSectionRead(p.id, s.id, btn.getAttribute('aria-pressed') !== 'true') },
    }, h('span', { html: icon('check') }), h('span', null, read ? 'Leída' : 'Marcar como leída'));
    const body = h('div', { class: 'sec__body' });
    const el = h('section', { class: 'sec' + (s.priority === 'skip' ? ' sec--skip' : ''), id: sid, 'aria-labelledby': 'h-' + sid, dataset: { sec: s.id } },
      h('header', { class: 'sec__head' },
        n ? h('span', { class: 'sec__num', 'aria-hidden': 'true' }, pad2(n)) : null,
        h('h2', { class: 'sec__title', id: 'h-' + sid, tabindex: '-1' }, n ? h('span', { class: 'sr-only' }, n + '. ') : null, s.title || s.id),
        prioChip(s.priority),
        s.titleEn ? h('p', { class: 'sec__en', lang: 'en' }, s.titleEn) : null),
      body,
      h('footer', { class: 'sec__foot' }, btn));
    // Los bloques se pintan con la sección ya en el documento: los diagramas pueden medir su ancho.
    el._fill = () => renderBlocks(s.blocks, body, Object.assign({ pageId: p.id, sectionId: s.id }, pageCtx || {}));
    return el;
  }
  function appendSections(c, p, numbered, pageCtx) {
    p.sections.forEach((s, i) => {
      const el = buildSection(p, s, numbered ? (s.num || i + 1) : 0, pageCtx);
      c.appendChild(el);
      el._fill();
    });
  }

  function progressLine() {
    return h('div', { class: 'pprog' },
      h('span', { class: 'pprog__bar', 'aria-hidden': 'true' }, h('span', { class: 'pprog__fill' })),
      h('span', { class: 'pprog__txt' }));
  }

  function pageFoot(p) {
    const btn = h('button', {
      type: 'button', class: 'btn complete-toggle', 'aria-pressed': 'false',
      on: { click: () => store.setPageCompleted(p.id, btn.getAttribute('aria-pressed') !== 'true') },
    }, h('span', { html: icon('flag') }), h('span', null, completeLabel(p.kind, false)));
    return h('footer', { class: 'pfoot' },
      h('div', { class: 'complete-row' }, btn, h('span', { class: 'complete-row__text' })),
      pager(p.id));
  }

  function eyebrowFor(m) {
    const b = BLOCKS[m.block] || null;
    if (m.kind === 'recap') return ['Repaso', 'Notación de todo el atlas'];
    if (m.kind === 'model' && b) return [b.label, b.long].concat(m.num ? ['Modelo ' + pad2(m.num)] : []);
    return [APP_NAME];
  }

  // ------------------------------------------------------------------ páginas del shell
  // Página de modelo (§4.5): cabecera + ficha técnica + conexiones, navegador 1–11, 11 secciones, pie.
  function renderModel(c, p) {
    const m = Object.assign({}, meta(p.id), p);
    const ctx = archCtx(m);
    S.page = { id: p.id, kind: 'model', sections: p.sections };
    c.appendChild(pageHeader(m, { eyebrow: eyebrowFor(m), after: h('div', null, fichaTecnica(m), connections(m), progressLine()) }));
    c.appendChild(h('nav', { class: 'tnav', 'aria-label': 'Plantilla del modelo: ' + p.sections.length + ' secciones' },
      h('div', { class: 'tnav__head' }, h('p', { class: 'eyebrow' }, 'Plantilla del modelo · ' + p.sections.length + ' secciones'), h('span', { class: 'page-toc__count mono small muted' })),
      h('ol', { class: 'tnav__list' }, p.sections.map((s, i) => h('li', { class: 'tnav__item', dataset: { sec: s.id } },
        h('a', { class: 'tnav__link', href: '#' + p.id + '.' + s.id, dataset: { sec: s.id } },
          h('span', { class: 'tnav__n' }, pad2(s.num || i + 1)),
          h('span', null, s.title || s.id),
          h('span', { class: 'tnav__tick', html: icon('check') })))))));
    appendSections(c, p, true, Object.assign({ pageId: p.id }, ctx));
    c.appendChild(pageFoot(p));
    buildToc(p, true);
    return 'toc';
  }

  // Repaso (cuenta en el curso) y páginas especiales con contenido (mapa, ref-formas…): como un módulo.
  function renderSheet(c, p) {
    const m = Object.assign({}, meta(p.id), p);
    const course = m.kind === 'recap';
    const ctx = archCtx(m);
    S.page = { id: p.id, kind: course ? 'recap' : 'sheet', sections: p.sections };
    const eyebrow = course ? eyebrowFor(m) : p.id === 'mapa' ? ['Mapa', 'Familias y relaciones'] : /^ref-/.test(p.id) ? ['Referencia'] : [APP_NAME];
    const after = h('div', null,
      p.id === 'mapa' ? h('div', { class: 'phead__strip' }, familiesStrip(false)) : null,
      course ? fichaTecnica(m) : null,
      course ? connections(m) : null,
      progressLine());
    c.appendChild(pageHeader(m, { eyebrow, after }));
    c.appendChild(pageTocDisclosure(p));
    appendSections(c, p, false, Object.assign({ pageId: p.id }, ctx));
    if (course) c.appendChild(pageFoot(p));
    buildToc(p, false);
    return 'toc';
  }

  function roadmapPhaseOf(id) {
    const rm = catalog() && Array.isArray(catalog().roadmap) ? catalog().roadmap : [];
    return rm.find((ph) => arr(ph.items).indexOf(id) >= 0) || null;
  }

  // Próximamente (§4.5): título, resumen, temas, config canónica planeada, paper, conexiones y su tarjeta.
  function renderSoon(c, id) {
    const m = meta(id);
    S.page = null;
    const eyebrow = eyebrowFor(m);
    eyebrow.push(h('span', { class: 'chip chip--soon', style: { marginLeft: '10px' } }, 'Próximamente'));
    c.appendChild(pageHeader(m, { eyebrow, minutesLabel: ' de lectura (estimado)' }));
    const rows = h('div', { class: 'soon-grid' });
    const row = (k, body, small) => h('div', { class: 'drow' }, h('div', { class: 'drow__label' }, k, small ? h('small', null, small) : null), h('div', { class: 'drow__body' }, body));
    if (Array.isArray(m.topics) && m.topics.length) {
      rows.appendChild(row('Qué vas a aprender', h('ul', { class: 'topic-list' }, m.topics.map((t) => h('li', { html: String(t) })))));
    }
    if (m.canonical) {
      const res = B() ? B().run(m.canonical) : null;
      rows.appendChild(row('Configuración canónica', h('p', null, h('span', { class: 'mono' }, res && res.run ? (res.run.label || m.canonical) : m.canonical),
        res && res.run ? null : h('span', { class: 'muted' }, ' — propuesta; la fase la confirma contra la tabla del paper.')), 'planeada'));
    }
    if (m.paper && B()) rows.appendChild(row('Paper', h('p', null, B().paperLine(m.paper))));
    const conn = connections(m);
    if (conn) rows.appendChild(row('Conexiones', conn));
    const ph = roadmapPhaseOf(id);
    if (ph) rows.appendChild(row('Llega en', h('p', null, h('b', null, ph.title || ('Fase ' + ph.phase)))));
    if (B() && (items()[id])) rows.appendChild(row('Tarjeta del mapa', B().render({ t: 'card', model: id }, { store, pageId: id }), 'nivel 1'));
    c.appendChild(rows);
    c.appendChild(h('p', { class: 'soon-note' }, h('span', { html: icon('info') }),
      h('span', null, 'Este modelo llega en una fase posterior. Pídelo cuando termines lo anterior.')));
    if (isCourse(id)) c.appendChild(h('footer', { class: 'pfoot' }, pager(id)));
    typeset(c);
    return isCourse(id) ? 'toc' : 'wide';
  }

  // Tarjeta de nivel 1 o ancla (resnet, gnn…): no tiene página propia.
  function renderCardPage(c, id) {
    const m = meta(id);
    S.page = null;
    c.appendChild(pageHeader(m, { eyebrow: ['Mapa', m.anchor ? 'Lo que ya sabes' : 'Nivel 1'] }));
    if (B()) c.appendChild(B().render({ t: 'card', model: id }, { store, pageId: id }));
    c.appendChild(h('div', { class: 'modal__row', style: { marginTop: '20px' } },
      h('a', { class: 'btn', href: '#mapa.' + (ATLAS.slug ? ATLAS.slug(id) : id) }, h('span', { html: icon('map') }), 'Ver en el mapa')));
    return 'wide';
  }

  function renderNotFound(c, r) {
    S.page = null;
    c.appendChild(pageHeader({ title: 'No encontramos esta página' }, { eyebrow: ['Dirección desconocida'] }));
    c.appendChild(h('p', { class: 'b-p' }, 'La dirección ', h('code', null, r.hash), ' no corresponde a ningún modelo, repaso ni herramienta del atlas.'));
    c.appendChild(h('div', { class: 'modal__row', style: { marginTop: '20px' } },
      h('a', { class: 'btn btn--primary', href: '#inicio' }, h('span', { html: icon('home') }), 'Ir al inicio'),
      h('a', { class: 'btn', href: '#buscar' }, h('span', { html: icon('search') }), 'Buscar')));
    return 'wide';
  }

  // Buscar (página completa): mismo índice que la barra lateral, sin tope de 24.
  function renderSearchPage(c) {
    S.page = null;
    c.appendChild(pageHeader(meta('buscar'), { eyebrow: [APP_NAME], title: 'Buscar en el atlas' }));
    const input = h('input', { class: 'input search-page__input', type: 'search', id: 'page-search', placeholder: 'Modelo, bloque (MHSA, patch embedding), término, tarjeta…', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'page-search-meta' });
    const metaEl = h('p', { class: 'search-page__meta muted small', id: 'page-search-meta', 'aria-live': 'polite' });
    const list = h('ol', { class: 'search-page__list' });
    const paint = () => {
      const q = input.value;
      const res = q.trim() ? runSearch(q, 200) : [];
      list.innerHTML = '';
      metaEl.textContent = q.trim() ? (res.length ? res.length + (res.length === 1 ? ' resultado' : ' resultados') : 'Sin resultados. Prueba con el término en inglés o en español.') : 'Escribe para buscar en páginas, secciones, bloques de los diagramas, glosario y flashcards.';
      res.forEach((e) => list.appendChild(h('li', null, h('a', { class: 'sres sres--page', href: e.href, on: { click: () => { if (e.type === 'card') S.forceRender = true; } } },
        h('span', { class: 'sres__type' }, TYPE_LABEL[e.type] || e.type),
        h('span', { class: 'sres__title' }, e.title),
        e.text ? h('span', { class: 'sres__text' }, e.text) : null))));
    };
    input.addEventListener('input', paint);
    c.appendChild(h('div', { class: 'search-page', role: 'search' }, h('label', { class: 'sr-only', for: 'page-search' }, 'Buscar en el atlas'), input, metaEl, list));
    if (S.searchQuery) { input.value = S.searchQuery; S.searchQuery = null; }
    paint();
    setTimeout(() => { if (document.activeElement === document.body || !document.activeElement) input.focus({ preventScroll: true }); }, 0);
    return 'wide';
  }

  // Inicio: panel de estudio, todo derivado del estado real.
  function renderHome(c) {
    S.page = null;
    const m = meta('inicio');
    const summary = m.purpose ? m.purpose :
      'Atlas de arquitecturas a <b>nivel 2</b> para entrevistas de ML/AI Engineer: diagrama de bloques, matemáticas y la forma de cada tensor —con parámetros y FLOPs calculados, no copiados— de los modelos que combinan atención y visión, y después LLMs, retrieval y robótica.';
    c.appendChild(h('header', { class: 'phead home-hero' },
      h('p', { class: 'eyebrow' }, 'Panel de estudio'),
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, APP_NAME),
      h('p', { class: 'phead__summary', html: summary })));

    const row = (k, small, ...body) => h('section', { class: 'drow', 'aria-label': k },
      h('h2', { class: 'drow__label' }, k, small ? h('small', null, small) : null), h('div', { class: 'drow__body' }, body));

    // Progreso: tira de familias. Mismo denominador que la barra lateral y la tira: las páginas del
    // curso = modelos + repaso (SPEC §4.4, store.courseProgress).
    const order = courseOrder();
    const cp = store.courseProgress();
    c.appendChild(row('Familias', 'tu avance en el curso', h('div', null,
      h('div', { class: 'home-status__head' },
        h('span', { class: 'home-status__big' }, cp.done + ' de ' + cp.total, h('small', null, 'páginas del curso completadas (modelos + repaso)')),
        h('span', { class: 'home-status__stats' },
          h('span', null, h('b', null, String(cp.inProgress)), ' en curso'),
          h('span', null, h('b', null, String(cp.ready)), cp.ready === 1 ? ' disponible' : ' disponibles'),
          h('span', null, h('b', null, String(Math.max(0, cp.total - cp.ready))), ' próximamente'))),
      familiesStrip(false),
      h('p', { class: 'small muted' }, h('a', { href: '#mapa' }, 'Abre el mapa'), ' para ver cómo se relacionan las familias.'))));

    // Ahora: continuar + siguiente recomendado
    const last = parseHash(store.lastLocation() || '');
    const lastValid = store.lastLocation() && last.pageId !== 'inicio' && (isCourse(last.pageId) || SPECIAL[last.pageId] || /^practica-/.test(last.pageId)) && (getPage(last.pageId) || {}).ready !== false;
    const first = order.find((id) => (getPage(id) || {}).ready) || 'repaso-atencion';
    const cont = lastValid ? last : { pageId: first, sectionId: null, hash: '#' + first };
    const nextId = order.find((id) => { const p = getPage(id); return id !== cont.pageId && p && p.ready && !store.pageProgress(id).completed; }) || null;
    const contPage = getPage(cont.pageId);
    const contSec = cont.section && contPage && contPage.sections ? contPage.sections.find((s) => s.id === cont.section) : null;
    const card = (k, title, text, actions) => h('div', { class: 'now-card' },
      h('span', { class: 'now-card__k' }, k),
      h('span', { class: 'now-card__title' }, title),
      text ? h('span', { class: 'now-card__text', html: text }) : null,
      h('div', { class: 'now-card__actions' }, actions));
    const contCard = card(lastValid ? 'Continúa donde lo dejaste' : 'Empieza por aquí', pageTitle(cont.pageId),
      contSec ? 'Sección: ' + D.esc(contSec.title || contSec.id) : (meta(cont.pageId).summary || ''),
      h('a', { class: 'btn btn--primary', href: cont.hash }, lastValid ? 'Continuar' : 'Empezar', h('span', { html: icon('arrow-right') })));
    let nextCard;
    if (nextId) {
      const nm = meta(nextId);
      const pr = store.pageProgress(nextId);
      nextCard = card('Siguiente recomendado', nm.title,
        (pr.read ? pr.read + ' de ' + pr.total + ' secciones leídas. ' : '') + (nm.summary || ''),
        h('a', { class: 'btn', href: '#' + nextId }, 'Abrir ' + (nm.short || nm.title)));
    } else {
      nextCard = card('Siguiente recomendado', 'Practica lo que ya leíste',
        'Completaste lo disponible por ahora: repasa con ejercicios de formas y flashcards, y pide la siguiente fase.',
        h('a', { class: 'btn', href: '#practica' }, 'Ir a la práctica'));
    }
    c.appendChild(row('Ahora', null, h('div', { class: 'now-grid' }, contCard, nextCard)));

    // Práctica: drills + flashcards
    const ds = store.drillStats();
    const cards = visibleCardIds();
    const st = store.flashStats(cards);
    const maxBox = Math.max(1, ...st.boxes);
    const acc = ds.seen ? Math.round((ds.ok / ds.seen) * 100) : null;
    c.appendChild(row('Práctica', 'ejercicios y repetición espaciada',
      h('div', { class: 'stat-line' },
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(ds.streak)), h('span', { class: 'stat__k' }, 'racha de aciertos')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(ds.seen)), h('span', { class: 'stat__k' }, 'ejercicios respondidos')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, acc == null ? '—' : acc + ' %'), h('span', { class: 'stat__k' }, 'aciertos')),
        h('a', { class: 'btn', href: '#practica' }, h('span', { html: icon('drill') }), 'Ejercicios')),
      cards.length
        ? h('div', { class: 'stat-line' },
          h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(st.due)), h('span', { class: 'stat__k' }, 'flashcards pendientes hoy')),
          h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(st.total)), h('span', { class: 'stat__k' }, 'tarjetas en el mazo')),
          h('div', { class: 'stat' },
            h('div', { class: 'boxes', 'aria-label': 'Tarjetas por caja de Leitner: ' + st.boxes.join(', ') },
              st.boxes.map((n, i) => h('div', { class: 'boxes__col', title: 'Caja ' + i + ': ' + n + (n === 1 ? ' tarjeta' : ' tarjetas') },
                h('span', { class: 'boxes__n' }, String(n)),
                h('span', { class: 'boxes__bar', style: { height: (n ? Math.max(3, Math.round(Math.sqrt(n / maxBox) * 20)) : 1) + 'px' } }),
                h('span', { class: 'boxes__k' }, String(i))))),
            h('span', { class: 'stat__k' }, 'por caja (0 → 4)')),
          h('a', { class: 'btn' + (st.due ? ' btn--primary' : ''), href: '#flashcards' }, st.due ? 'Repasar ahora (' + st.due + ')' : 'Abrir flashcards'))
        : h('p', { class: 'muted' }, 'El mazo de flashcards se llena con las tarjetas de cada modelo a medida que llega el contenido.')));

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

    // Ciclo de estudio (§4.5)
    const how = h('div');
    renderBlocks([{ t: 'steps', items: [
      { title: 'Diagrama', meta: '5 min', html: 'Abre la sección 3 del modelo y entiende el flujo <b>sin leer el texto</b>: bloques, formas en las aristas, leyenda. Abre cada bloque para ver sus sub-operaciones.' },
      { title: 'Recorrido con números', meta: '10 min', html: 'Usa «Recorrido» en el diagrama y la tabla de la sección 4: sigue un ejemplo concreto (224×224×3 → … → 1000 logits) antes de la notación.' },
      { title: 'Costo', meta: '10 min', html: 'Parámetros y MACs con la aritmética a la vista; mueve el explorador de escala y di en voz alta qué crece con qué.' },
      { title: 'Preguntas de entrevista', meta: '15 min', html: 'Responde en voz alta antes de abrir la versión senior; fíjate en las trampas marcadas.' },
      { title: 'Práctica activa', meta: '10 min', html: 'Diagrama en blanco, «¿qué forma tiene este tensor?» y «¿qué pasa si duplico…?». Las respuestas salen de la calculadora.' },
      { title: 'Flashcards', meta: '5–10 min al día', html: 'Repetición espaciada (Leitner): poco y seguido rinde más que mucho de golpe.' },
    ] }], how, { pageId: 'inicio' });
    c.appendChild(row('Cómo estudiar', 'el ciclo por modelo', how,
      h('p', { class: 'kbd-hint' }, 'Atajos: ', h('kbd', null, '/'), ' buscar · ', h('kbd', null, '['), ' ', h('kbd', null, ']'), ' anterior / siguiente · ', h('kbd', null, 'Esc'), ' cerrar')));
    return 'wide';
  }

  // Páginas de otros componentes: (container, route, ctx) — SPEC §8.6.
  function delegate(c, modName, fnName, r, pageCtx) {
    const mod = ATLAS[modName];
    S.page = null;
    if (!mod || typeof mod[fnName] !== 'function') {
      placeholderPage(c, pageTitle(r.pageId), 'Esta parte del atlas todavía no está cargada (falta ATLAS.' + modName + '.' + fnName + ').');
      return 'wide';
    }
    // ctx.navigate(hash): mismo pageId → no re-renderiza (solo desplaza);  ctx.rerender(): vuelve a pintar la ruta.
    // Lo que devuelva el renderizador ({destroy}) se guarda y se destruye al salir (teardownPage):
    // sus diagramas, observadores y listeners no viven dentro de un [data-ctrl] del shell.
    const ret = mod[fnName](c, r, Object.assign({
      store, navigate, renderBlocks, app: ATLAS.App, pageId: r.pageId, rerender: () => rerender(false),
    }, pageCtx || {}));
    S.delegated = ret && typeof ret.destroy === 'function' ? ret : null;
    return 'wide';
  }

  // ------------------------------------------------------------------ router
  function teardownPage() {
    if (S.observer) { S.observer.disconnect(); S.observer = null; }
    if (S.wideObserver) { S.wideObserver.disconnect(); S.wideObserver = null; }
    if (S.delegated) { const d = S.delegated; S.delegated = null; safe(() => d.destroy(), null); }
    if (B()) safe(() => B().destroyAll(els.page), null);
  }

  function renderRoute(r) {
    const c = els.page;
    teardownPage();
    S.currentSec = null;
    S.page = null;
    c.innerHTML = '';
    els.toc.innerHTML = '';
    els.toc.hidden = true;
    els.toc.classList.remove('is-covered');
    const id = r.pageId;
    const m = meta(id);
    let layout = 'wide';
    try {
      if (id === 'inicio') layout = renderHome(c);
      else if (id === 'buscar') layout = renderSearchPage(c);
      else if (id === 'practica') layout = delegate(c, 'Practice', 'renderHub', r);
      else if (r.modelId && meta(r.modelId).kind === 'model') {
        const mm = meta(r.modelId);
        layout = delegate(c, 'Practice', 'renderModel', r, Object.assign({ model: r.modelId }, archCtx(mm), { modelId: r.modelId }));
      } else if (id === 'flashcards') layout = delegate(c, 'Flashcards', 'render', r);
      else if (id === 'glosario') layout = delegate(c, 'Reference', 'renderGlossary', r);
      else if (m.kind === 'model') {
        const p = getPage(id);
        layout = p && p.ready ? renderModel(c, p) : renderSoon(c, id);
      } else if (m.kind === 'card') layout = renderCardPage(c, id);
      else if (m.kind === 'recap' || SPECIAL[id] || items()[id]) {
        const p = getPage(id);
        if (p && p.ready) layout = renderSheet(c, p);
        else if (m.kind === 'recap' || id === 'mapa' || id === 'ref-formas') layout = renderSoon(c, id);
        else layout = renderNotFound(c, r);
      } else layout = renderNotFound(c, r);
      if (B()) B().mount(c);
      typeset(c);
    } catch (e) {
      if (root.console) root.console.error('[app] error al mostrar ' + id, e);
      teardownPage();
      c.innerHTML = '';
      c.appendChild(pageHeader({ title: pageTitle(id) }, { eyebrow: [APP_NAME] }));
      c.appendChild(h('div', { class: 'block-warn', role: 'alert' }, h('span', { class: 'block-warn__icon', html: icon('warn') }),
        h('div', null, h('strong', null, 'No se pudo mostrar esta página.'), h('div', { class: 'block-warn__detail' }, String(e && e.message || e)))));
      layout = 'wide';
    }
    els.shell.dataset.layout = layout;
    els.shell.dataset.page = id;
    document.title = id === 'inicio' ? APP_NAME : pageTitle(id) + ' · ' + APP_NAME;
    if (S.page) { refreshReadMarks(); observeSections(); observeWide(); }
  }

  function sectionEl(r) {
    if (!r.sectionId) return null;
    return document.getElementById(r.pageId + '.' + r.sectionId) || (r.section ? document.getElementById(r.pageId + '.' + r.section) : null);
  }

  function scrollToSection(r, smooth) {
    const el = sectionEl(r);
    if (!el) return false;
    el.scrollIntoView({ block: 'start', behavior: smooth && !reduced() ? 'smooth' : 'auto' });
    // Sección → su título; otra ancla (#mapa.<tarjeta>, #vit.operaciones.<nodo>…) → el propio elemento,
    // para que el foco no se quede en <body> (teclado y lector de pantalla no pierden el lugar).
    let hd = el.querySelector('.sec__title');
    if (!hd) { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); hd = el; }
    if (hd && hd.focus) hd.focus({ preventScroll: true });
    const sec = el.closest ? el.closest('section.sec') : null;
    if (sec && sec.dataset && sec.dataset.sec) setCurrentSection(sec.dataset.sec, false);
    return true;
  }

  // #página.sección~nodo (o ~diagrama.nodo) → el diagrama de esa sección, abierto en la vista que
  // contiene el nodo, lo enfoca (y abre su panel). Sin calificar y con el id repetido en varias vistas
  // (el validador lo prohíbe en el contenido) se prefiere la vista actual y después la primera.
  function focusDiagramNode(r) {
    if (!r.node || !B()) return false;
    const scope = (r.section && document.getElementById(r.pageId + '.' + r.section)) || els.page;
    const ctrls = B().controllers(scope, 'diagram');
    if (!ctrls.length) return false;
    const diagrams = safe(() => ATLAS.diagrams(), {});
    const nId = r.nodeId || r.node;
    const has = (d) => !!d && (arr(d.nodes).some((n) => n && n.id === nId) || arr(d.groups).some((g) => g && g.id === nId));
    const chainTo = (specId, rootId) => {   // [rootId, …, specId] si specId cuelga de rootId
      const chain = [];
      let cur = diagrams[specId];
      let guard = 0;
      while (cur && guard++ < 8) {
        chain.unshift(cur.id);
        if (cur.id === rootId) return chain;
        cur = cur.parent ? diagrams[cur.parent] : null;
      }
      return null;
    };
    const viewOf = (c) => safe(() => c.ctrl.view, null) || c.diagram;
    // Candidatos: [{c, target}] = controlador y vista (diagrama) donde está el nodo.
    const cands = [];
    for (const c of ctrls) {
      for (const d of Object.values(diagrams)) {
        if (!has(d) || (r.nodeDiagram && d.id !== r.nodeDiagram)) continue;
        if (chainTo(d.id, c.diagram)) cands.push({ c, target: d.id });
      }
    }
    const pick = cands.find((x) => x.target === viewOf(x.c)) || cands.find((x) => x.target === x.c.diagram) || cands[0];
    const focus = (c) => { try { if (typeof c.ctrl.focusNode === 'function') return c.ctrl.focusNode(nId); } catch (e) { /* nodo desconocido */ } return null; };
    if (!pick) { focus(ctrls[0]); return false; }
    const c = pick.c;
    try {
      let p = null;
      if (viewOf(c) !== pick.target) {
        if (pick.target === c.diagram) {
          // volver a la raíz: collapse() sube un nivel por llamada (puede animar)
          p = (async () => { for (let i = 0; i < 8 && viewOf(c) !== c.diagram; i++) { if (typeof c.ctrl.collapse !== 'function') break; await c.ctrl.collapse(); } })();
        } else if (typeof c.ctrl.expand === 'function') {
          p = c.ctrl.expand(pick.target);   // el diagrama recorre él mismo la cadena de padres
        }
      }
      const done = () => focus(c);
      if (p && typeof p.then === 'function') p.then(done, done); else done();
      c.el.scrollIntoView({ block: 'start', behavior: 'auto' });
      return true;
    } catch (e) { if (root.console) root.console.warn('[app] focusNode', e); }
    return false;
  }

  function onRoute(initial, sameHash) {
    const r = parseHash(root.location.hash);
    const prev = S.route;
    closeResults();
    if (S.modalOpen) closeModal();
    if (prev && prev.pageId === r.pageId && !S.forceRender && r.pageId !== 'buscar') {
      S.route = r;
      if (r.sectionId) scrollToSection(r, !r.node);
      else if (!sameHash || prev.sectionId) root.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      if (r.node) focusDiagramNode(r);
      if (r.sectionId && isCourse(r.pageId)) store.setLastLocation(r.hash);
      return;
    }
    S.forceRender = false;
    S.route = r;
    renderRoute(r);
    updateNavMarkers();
    revealNavItem();
    renderSideStrip();
    const known = r.pageId === 'inicio' || isCourse(r.pageId) || SPECIAL[r.pageId] || /^practica-/.test(r.pageId);
    if (known && r.pageId !== 'inicio' && r.pageId !== 'buscar') {
      store.markVisited(r.pageId);
      // "Continúa donde lo dejaste" apunta solo a páginas de estudio (curso listo o práctica de un modelo),
      // nunca a una "Próximamente" ni al glosario, el mapa o las flashcards.
      const study = (isCourse(r.pageId) && (getPage(r.pageId) || {}).ready) || /^practica-/.test(r.pageId);
      if (study) store.setLastLocation(r.hash);
    }
    const scrolled = r.sectionId ? scrollToSection(r, false) : false;
    if (!scrolled) root.scrollTo(0, 0);
    if (r.node) focusDiagramNode(r);
    if (!initial && !scrolled && !r.node) {
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
  function onStoreChange(kind, source) {
    S.pending.add(kind);
    if (source && source !== 'local') S.pendingFrom.add(kind);
    if (S.flushQueued) return;
    S.flushQueued = true;
    const run = () => { S.flushQueued = false; flushStoreChanges(); };
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run); else setTimeout(run, 16);
  }

  // El store avisa con el tipo de cambio y su origen (esta pestaña, otra pestaña o la cuenta). Solo
  // se vuelve a pintar la página entera cuando hace falta: importación, la primera fusión con la cuenta
  // ('remote') o, desde otra pestaña, checklists (lo único del shell que no se actualiza en su sitio).
  // Desplazarse o visitar páginas en otra pestaña (location / visit) nunca re-renderiza esta.
  function flushStoreChanges() {
    const kinds = S.pending;
    const fromElsewhere = S.pendingFrom;
    S.pending = new Set();
    S.pendingFrom = new Set();
    const only = (list) => Array.from(kinds).every((k) => list.indexOf(k) >= 0);
    if (only(['location', 'visit'])) return;
    if (kinds.has('prefs') || kinds.has('remote') || kinds.has('import')) {
      const t0 = store.pref('theme');
      const t = t0 === 'light' || t0 === 'dark' ? t0 : 'system';
      const de = document.documentElement;
      if ((de.getAttribute('data-theme') || 'system') !== t) applyTheme(t);
      syncThemeButtons(t);
    }
    if (only(['location', 'visit', 'prefs'])) return;
    updateNavMarkers();
    renderSideStrip();
    if (kinds.has('progress')) refreshReadMarks();
    const full = kinds.has('remote') || kinds.has('import');
    if (full) renderFoot();
    const pid = S.route && S.route.pageId;
    const shellPage = S.route && (pid === 'inicio' || isCourse(pid) || (S.page && S.page.kind === 'sheet'));
    const elsewhere = Array.from(fromElsewhere).filter((k) => k !== 'location' && k !== 'visit');
    const needs = full || (pid === 'inicio' && elsewhere.length > 0) || fromElsewhere.has('checklist');
    const typing = isTextEntry(document.activeElement) && els.page.contains(document.activeElement);
    if (shellPage && needs && !typing) rerender(false);
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
    if (S.drawerOpen) {
      trapTab(e, els.sidebar);
      if (e.key === '[' || e.key === ']') return;   // el contenido detrás del cajón está inerte
    }
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTextEntry(e.target)) return;
    // Dentro de un diagrama enfocado, sus teclas mandan (SPEC §7.7).
    if (e.target && e.target.closest && e.target.closest('[data-ctrl="diagram"], [data-ctrl="viz"], [data-ctrl="practice"]') && e.key !== '/') return;
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
      page: $('page'), toc: $('toc'), shell: $('shell'), nav: $('nav'), sideStrip: $('side-uptime'), foot: $('side-foot'),
      banner: $('dev-banner'), search: $('search-input'), results: $('search-results'), sidebar: $('sidebar'),
      backdrop: $('backdrop'), menuBtn: $('menu-btn'), drawerClose: $('drawer-close'), topbar: $('topbar'),
      topProgress: $('topbar-progress'), modal: $('modal'),
    });
    if (!els.page || !els.nav) { if (root.console) root.console.error('[app] index.html no tiene los contenedores esperados'); return; }

    applyTheme(store.pref('theme'));
    if (darkMq) {
      const onScheme = () => emitTheme();
      if (darkMq.addEventListener) darkMq.addEventListener('change', onScheme); else if (darkMq.addListener) darkMq.addListener(onScheme);
    }
    buildNav();
    renderSideStrip();
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
    // MathJax que llega tarde: las fórmulas de respaldo ya se sustituyen solas (math.js).

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

  ATLAS.App = {
    boot, navigate, rerender, onTheme, theme: effectiveTheme,
    route: () => (S.route ? Object.assign({}, S.route) : null),
    renderBlocks, familiesStrip, openPortability, parseHash, labLink, runSearch,
    focusNode: (hash) => focusDiagramNode(parseHash(hash)),
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
