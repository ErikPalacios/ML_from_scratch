/* =============================================================================
   Atlas de Arquitecturas — js/ui/reference.js
   Basado en apps/ml-system-design/js/ui/reference.js.
   ATLAS.Reference.renderGlossary(container, route, ctx) → {el, destroy} — página 'glosario' (SPEC §8.6):
   tabla ES–EN filtrable (sin acentos), salto A–Z, cada fila con id "glosario.<slug(en)>".
   Las definiciones pueden traer {{…}} (ATLAS.Quantities.fill) y LaTeX (ATLAS.MathTex.typeset).
   La hoja 'ref-formas' NO vive aquí: es contenido (bloques formulas/compare que pinta blocks.js).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const h = (...a) => ATLAS.dom.h(...a);
  const icon = (n) => (ATLAS.dom && ATLAS.dom.icon ? ATLAS.dom.icon(n) : '');

  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const strip = (s) => (typeof ATLAS.stripHtml === 'function' ? ATLAS.stripHtml(s) : String(s || '').replace(/<[^>]*>/g, ' '));
  const slug = (s) => (typeof ATLAS.slug === 'function' ? ATLAS.slug(s) : ATLAS.dom.slug(s));
  const reduced = () => (ATLAS.dom && ATLAS.dom.reducedMotion ? ATLAS.dom.reducedMotion() : false);
  const meta = (id) => safe(() => (ATLAS.catalog().items || {})[id], null) || {};

  function fill(html, source) {
    const Q = ATLAS.Quantities;
    const s = String(html == null ? '' : html);
    if (!Q || typeof Q.fill !== 'function' || s.indexOf('{{') < 0) return s;
    return safe(() => Q.fill(s, { config: meta(source).canonical, pageId: source }), s);
  }

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
    if (src === 'general') return h('span', { class: 'chip' }, 'General');
    const m = meta(src);
    return h('a', { class: 'chip', href: '#' + src, title: m.title || src }, m.short || m.title || String(src));
  }

  let mounted = null;

  function renderGlossary(container, route) {
    if (mounted) { mounted.teardown(); mounted = null; }
    const c = h('div', { class: 'px' });
    container.appendChild(c);
    const m = Object.assign({ title: 'Glosario ES–EN', titleEn: 'Spanish–English glossary' }, meta('glosario'));
    c.appendChild(header({ eyebrow: ['Referencia'], title: m.title, en: m.titleEn,
      summary: m.summary || 'Los términos tal como se dicen en una entrevista (en inglés), con su traducción y una definición corta.' }));
    const terms = safe(() => ATLAS.glossary(), []).filter((t) => t && t.en);
    if (!terms.length) {
      c.appendChild(h('div', { class: 'px-empty' },
        h('p', { class: 'px-empty__t' }, 'El glosario está vacío'),
        h('p', { class: 'muted' }, 'Los términos llegan con cada modelo.')));
      return { el: c, destroy() { c.remove(); } };
    }

    const letterOf = (en) => { const L = norm(en).charAt(0).toUpperCase(); return /[A-Z]/.test(L) ? L : '#'; };
    const groups = new Map();
    const rows = terms.map((t) => {
      const s = slug(t.en);
      const L = letterOf(t.en);
      const src = (t.sources || [])[0];
      const tr = h('tr', { class: 'gl__row', id: 'glosario.' + s, tabindex: '-1', dataset: { slug: s } },
        h('th', { scope: 'row', class: 'gl__en' }, h('span', { lang: 'en' }, t.en)),
        h('td', { class: 'gl__es', dataset: { label: 'Español' } }, t.es || '—'),
        h('td', { class: 'gl__def', dataset: { label: 'Definición' } },
          h('div', { class: 'gl__defhtml', html: fill(t.def || '', src) }),
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
    if (ATLAS.Blocks && ATLAS.Blocks.decorate) rows.forEach((r) => safe(() => ATLAS.Blocks.decorate(r.tr)));

    const input = h('input', {
      type: 'search', class: 'input gl__input', id: 'gl-q', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'patch embedding, KV cache, softmax…', 'aria-controls': 'gl-table', 'aria-describedby': 'gl-count',
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
    const M = ATLAS.MathTex;
    if (M && typeof M.typeset === 'function') { try { const p = M.typeset(table); if (p && p.catch) p.catch(() => {}); } catch (e) { /* LaTeX visible */ } }

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
    // El shell llama destroy() al salir de la página: quita el listener de hashchange al instante.
    return { el: c, destroy() { teardown(); c.remove(); } };
  }

  // render(): alias por compatibilidad con el router de la Ronda.
  function render(container, route, ctx) { return renderGlossary(container, route, ctx); }

  ATLAS.Reference = { renderGlossary, render };
})(typeof window !== 'undefined' ? window : globalThis);
