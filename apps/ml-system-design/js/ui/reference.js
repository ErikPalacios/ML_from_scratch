/* =============================================================================
   Ronda de Diseño ML — js/ui/reference.js
   MSD.Reference.render(container, route, ctx) (SPEC §7.4):
     'glosario'                                  → tabla ES–EN filtrable (sin acentos), salto A–Z,
                                                   cada fila con id "glosario.<slug(en)>"
     'ref-numeros' | 'ref-herramientas' | 'ref-comandos' → "Próximamente" con los temas del catálogo
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const D = MSD.dom;
  const { h, icon } = D;

  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const strip = (s) => (typeof MSD.stripHtml === 'function' ? MSD.stripHtml(s) : String(s || '').replace(/<[^>]*>/g, ' '));
  const slug = (s) => (typeof MSD.slug === 'function' ? MSD.slug(s) : D.slug(s));
  const reduced = () => (D.reducedMotion ? D.reducedMotion() : false);
  const catalog = () => safe(() => MSD.catalog(), null);
  const meta = (id) => { const c = catalog(); return (c && c.items && c.items[id]) || {}; };

  const FALLBACK = {
    glosario: { title: 'Glosario ES–EN', titleEn: 'Spanish–English glossary' },
    'ref-numeros': { title: 'Números que debes saber', titleEn: 'Numbers you should know' },
    'ref-herramientas': { title: 'Herramientas por categoría', titleEn: 'Tools by category' },
    'ref-comandos': { title: 'Docker y kubectl', titleEn: 'Docker and kubectl' },
  };
  // Lo que ya está disponible y cubre parte de cada hoja pendiente (solo se muestra si existe).
  const MEANWHILE = {
    'ref-numeros': [['m01', 'estimaciones-express'], ['c01', 'estimaciones'], ['flashcards', null, 'Flashcards de números']],
    'ref-herramientas': [['c01', 'serving'], ['c01', 'monitoreo'], ['glosario', null, 'Glosario ES–EN']],
    'ref-comandos': [['c01', 'archivos'], ['glosario', null, 'Glosario ES–EN']],
  };

  function header(o) {
    const eb = h('p', { class: 'eyebrow' });
    (o.eyebrow || []).forEach((p, i) => {
      if (i) eb.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'));
      eb.appendChild(typeof p === 'string' ? h('span', null, p) : p);
    });
    return h('header', { class: 'phead' }, eb,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, o.title || ''),
      o.en ? h('p', { class: 'phead__en', lang: 'en' }, o.en) : null,
      o.summary ? h('p', { class: 'phead__summary', html: String(o.summary) }) : null);
  }

  function srcChip(src) {
    if (!/^[mc]\d\d$/.test(src)) return h('span', { class: 'chip' }, src === 'general' ? 'General' : String(src));
    const p = safe(() => MSD.getPage(src), null) || {};
    return h('a', { class: 'chip', href: '#' + src, title: p.title || src.toUpperCase() }, h('span', { class: 'chip__id' }, src.toUpperCase()));
  }

  let mounted = null;

  // ================================================================== GLOSARIO
  function renderGlossary(c, route) {
    const m = Object.assign({}, FALLBACK.glosario, meta('glosario'));
    c.appendChild(header({ eyebrow: ['Parte 4', 'Referencias'], title: m.title, en: m.titleEn, summary: m.summary }));
    const terms = safe(() => MSD.glossary(), []).filter((t) => t && t.en);
    if (!terms.length) {
      c.appendChild(h('div', { class: 'px-empty' },
        h('p', { class: 'px-empty__t' }, 'El glosario está vacío'),
        h('p', { class: 'muted' }, 'Los términos llegan con cada módulo y caso.')));
      return;
    }

    const letterOf = (en) => { const L = norm(en).charAt(0).toUpperCase(); return /[A-Z]/.test(L) ? L : '#'; };
    const groups = new Map();
    const rows = terms.map((t) => {
      const s = slug(t.en);
      const L = letterOf(t.en);
      const tr = h('tr', { class: 'gl__row', id: 'glosario.' + s, tabindex: '-1', dataset: { slug: s } },
        h('th', { scope: 'row', class: 'gl__en' }, h('span', { lang: 'en' }, t.en)),
        h('td', { class: 'gl__es', dataset: { label: 'Español' } }, t.es || '—'),
        h('td', { class: 'gl__def', dataset: { label: 'Definición' } },
          h('div', { class: 'gl__defhtml', html: String(t.def || '') }),
          t.say ? h('p', { class: 'gl__say' }, h('span', { class: 'gl__sayk' }, 'Cómo lo dirías'), h('q', { lang: 'en' }, t.say)) : null),
        h('td', { class: 'gl__src', dataset: { label: 'Fuente' } }, (t.sources || []).map(srcChip)));
      const row = { tr, L, hay: norm([t.en, t.es, strip(t.def), t.say].filter(Boolean).join(' ')) };
      if (!groups.has(L)) groups.set(L, { rows: [], tbody: null });
      groups.get(L).rows.push(row);
      return row;
    });
    groups.forEach((g, L) => {
      g.tbody = h('tbody', { class: 'gl__grp' },
        h('tr', { class: 'gl__letter' }, h('th', { colspan: '4', scope: 'colgroup', id: 'glosario.letra-' + L.toLowerCase().replace('#', 'otros') }, L)),
        g.rows.map((r) => r.tr));
    });
    if (MSD.Blocks && MSD.Blocks.decorate) rows.forEach((r) => MSD.Blocks.decorate(r.tr));

    const input = h('input', {
      type: 'search', class: 'input gl__input', id: 'gl-q', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'latencia, drift, batch…', 'aria-controls': 'gl-table', 'aria-describedby': 'gl-count',
    });
    const count = h('p', { class: 'gl__count mono', id: 'gl-count', 'aria-live': 'polite' });
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(groups.has('#') ? ['#'] : []);
    const azBtns = {};
    const az = h('nav', { class: 'gl__az', 'aria-label': 'Saltar a una letra' }, letters.map((L) => (azBtns[L] = h('button', {
      type: 'button', class: 'gl__azb', 'aria-label': L === '#' ? 'Saltar a otros símbolos' : 'Saltar a la letra ' + L,
      on: { click: () => jump(L) },
    }, L))));
    const clearBtn = h('button', { type: 'button', class: 'btn btn--sm', on: { click: () => { input.value = ''; apply(); input.focus(); } } }, 'Limpiar búsqueda');
    const empty = h('div', { class: 'px-empty gl__empty', hidden: true },
      h('p', { class: 'px-empty__t' }, 'Sin resultados'),
      h('p', { class: 'muted gl__emptytxt' }),
      h('p', null, clearBtn));

    const table = h('table', { class: 'gl__table', id: 'gl-table' },
      h('caption', { class: 'sr-only' }, 'Glosario español–inglés'),
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, 'Inglés'), h('th', { scope: 'col' }, 'Español'),
        h('th', { scope: 'col' }, 'Definición y cómo lo dirías'), h('th', { scope: 'col' }, 'Fuente'))),
      Array.from(groups.values()).map((g) => g.tbody));

    const gl = h('div', { class: 'gl' },
      h('div', { class: 'gl__tools' },
        h('div', { class: 'gl__search' },
          h('label', { class: 'px-k', for: 'gl-q' }, 'Filtrar términos'),
          h('span', { class: 'gl__icon', html: icon('search') }),
          input,
          count),
        az),
      table,
      empty);
    c.appendChild(gl);

    function apply() {
      const tokens = norm(input.value).split(/\s+/).filter(Boolean);
      let n = 0;
      rows.forEach((r) => { const on = tokens.every((tk) => r.hay.indexOf(tk) >= 0); r.tr.hidden = !on; if (on) n++; });
      groups.forEach((g, L) => {
        const any = g.rows.some((r) => !r.tr.hidden);
        g.tbody.hidden = !any;
        if (azBtns[L]) azBtns[L].disabled = !any;
      });
      letters.forEach((L) => { if (!groups.has(L)) azBtns[L].disabled = true; });
      count.textContent = tokens.length ? n + ' de ' + rows.length + ' términos' : rows.length + ' términos';
      table.hidden = n === 0;
      empty.hidden = n > 0;
      if (!n) empty.querySelector('.gl__emptytxt').textContent = 'Nada coincide con «' + input.value.trim() + '». Prueba con el término en inglés o en español, o con una palabra más corta.';
    }

    function jump(L) {
      const g = groups.get(L);
      if (!g) return;
      const first = g.rows.find((r) => !r.tr.hidden);
      if (!first) return;
      g.tbody.firstChild.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      first.tr.focus({ preventScroll: true });
    }

    // Resalta el término de #glosario.<slug>. El router ya desplaza y enfoca la fila; aquí solo
    // se quita el filtro si la ocultaba (y entonces sí desplazamos nosotros).
    function markTarget(s, scroll) {
      rows.forEach((r) => r.tr.classList.remove('is-target'));
      if (!s) return;
      const r = rows.find((x) => x.tr.dataset.slug === s);
      if (!r) return;
      const wasHidden = r.tr.hidden;
      if (wasHidden) { input.value = ''; apply(); }
      r.tr.classList.add('is-target');
      if (scroll || wasHidden) {
        r.tr.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
        r.tr.focus({ preventScroll: true });
      }
    }

    input.addEventListener('input', apply);
    apply();
    markTarget(route && route.sectionId, false);

    const onHash = () => {
      if (!gl.isConnected) { teardown(); return; }
      let s = String(root.location.hash || '').replace(/^#/, '');
      try { s = decodeURIComponent(s); } catch (e) { /* tal cual */ }
      const i = s.indexOf('.');
      if ((i < 0 ? s : s.slice(0, i)) !== 'glosario') return;
      markTarget(i < 0 ? null : s.slice(i + 1), false);
    };
    function teardown() {
      root.removeEventListener('hashchange', onHash);
      if (mounted && mounted.el === gl) mounted = null;
    }
    root.addEventListener('hashchange', onHash);
    mounted = { el: gl, teardown };
  }

  // ================================================================== HOJAS "PRÓXIMAMENTE"
  function renderSoonRef(c, id) {
    const m = Object.assign({ title: id }, FALLBACK[id] || {}, meta(id));
    const chip = h('span', { class: 'chip chip--soon', style: { marginLeft: '10px' } }, 'Próximamente');
    c.appendChild(header({ eyebrow: ['Parte 4', 'Referencias', chip], title: m.title, en: m.titleEn, summary: m.summary }));

    const row = (k, body, small) => h('section', { class: 'drow', 'aria-label': k },
      h('h2', { class: 'drow__label' }, k, small ? h('small', null, small) : null), h('div', { class: 'drow__body' }, body));
    const rowsEl = h('div', { class: 'soon-grid' });

    if (Array.isArray(m.topics) && m.topics.length) {
      rowsEl.appendChild(row('Qué va a incluir', h('ul', { class: 'topic-list' }, m.topics.map((t) => h('li', { html: String(t) }))), m.topics.length + ' temas'));
    }

    const cat = catalog();
    const phase = cat && Array.isArray(cat.roadmap) ? cat.roadmap.find((ph) => Array.isArray(ph.items) && ph.items.indexOf(id) >= 0) : null;
    if (phase) {
      const st = { done: ['chip--ok', 'Hecha'], next: ['chip--accent', 'Siguiente'], later: ['', 'Después'] }[phase.status] || ['', 'Después'];
      rowsEl.appendChild(row('Cuándo llega', [
        h('p', { class: 'rsoon__phase' }, h('span', { class: 'chip ' + st[0] }, st[1]), h('b', null, phase.title || ('Fase ' + phase.phase))),
        phase.note ? h('p', { class: 'muted rsoon__note', html: String(phase.note) }) : null,
      ]));
    }

    const links = [];
    (MEANWHILE[id] || []).forEach(([pid, sid, txt]) => {
      if (/^[mc]\d\d$/.test(pid)) {
        const p = safe(() => MSD.getPage(pid), null);
        const s = p && p.ready && (p.sections || []).find((x) => x.id === sid);
        if (s) links.push(h('li', null, h('a', { href: '#' + pid + '.' + sid }, pid.toUpperCase() + ' · ' + (s.num ? s.num + '. ' : '') + s.title)));
      } else links.push(h('li', null, h('a', { href: '#' + pid }, txt)));
    });
    if (links.length) rowsEl.appendChild(row('Mientras tanto', h('ul', { class: 'topic-list' }, links), 'ya disponible'));

    const connects = (m.connects || []).filter((x) => x !== id);
    if (connects.length) {
      rowsEl.appendChild(row('Conecta con', h('div', { class: 'rsoon__chips' }, connects.map((cid) => {
        const cm = meta(cid);
        return h('a', { class: 'chip', href: '#' + cid, title: cm.title || cid },
          /^[mc]\d\d$/.test(cid) ? h('span', { class: 'chip__id' }, cid.toUpperCase()) : null, cm.short || cm.title || cid);
      }))));
    }
    c.appendChild(rowsEl);
    c.appendChild(h('p', { class: 'soon-note' }, h('span', { html: icon('info') }),
      h('span', null, 'Esta hoja de referencia llega en una fase posterior. Pídela cuando termines lo anterior.')));
  }

  // ================================================================== API
  function render(container, route, ctx) {
    if (mounted) { mounted.teardown(); mounted = null; }
    const id = (route && route.pageId) || 'glosario';
    const wrap = h('div', { class: 'px' });
    container.appendChild(wrap);
    if (id === 'glosario') renderGlossary(wrap, route || {});
    else renderSoonRef(wrap, id);
  }

  MSD.Reference = { render };
})(typeof window !== 'undefined' ? window : globalThis);
