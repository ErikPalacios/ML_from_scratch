/* =============================================================================
   Ronda de Diseño ML — js/ui/notes.js
   Notas propias del usuario, sin tocar el contenido del curso:
     - sectionBlock(pageId, sectionId) → {panel, button}: notas al final de cada sección
       (el shell pone el panel después del contenido y el botón junto a "Marcar como leída");
     - render(container, route, ctx): página #mis-notas (todas las notas, agrupadas por página);
     - termForm({onDone}): formulario para agregar un término propio (lo usa el glosario);
     - glossaryTerms() / cards() / searchItems(): tus términos en el glosario, como flashcards
       y en el buscador.
   Todo se guarda con MSD.store (listNotes/addNote/updateNote/deleteNote): viaja con exportar /
   importar y, dentro de claude.ai, se sincroniza con la cuenta. El texto del usuario se muestra
   siempre como texto (nunca como HTML).
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const D = MSD.dom;
  const { h, icon } = D;

  const MAX_NOTE = 4000;
  const MAX_TERM = 120;
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const store = () => MSD.store;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const getPage = (id) => safe(() => MSD.getPage(id), null);
  const catItem = (id) => safe(() => (MSD.catalog().items || {})[id], null) || {};
  const courseOrder = () => safe(() => MSD.courseOrder(), []);
  const reduced = () => (D.reducedMotion ? D.reducedMotion() : false);
  // Texto del usuario → HTML seguro (escapado; los saltos de línea se conservan).
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const textHtml = (s) => D.esc(String(s || '')).replace(/\n/g, '<br>');

  function pageLabel(id) {
    if (!id) return 'Generales';
    if (id === 'glosario') return 'Glosario';
    const it = catItem(id);
    if (/^[mc]\d\d$/.test(id)) return id.toUpperCase() + (it.short ? ' · ' + it.short : '');
    return it.short || it.title || id;
  }
  function sectionTitle(pageId, sectionId) {
    const p = getPage(pageId);
    const s = p && Array.isArray(p.sections) ? p.sections.find((x) => x && x.id === sectionId) : null;
    return s ? s.title || s.id : '';
  }
  // A dónde lleva una nota: su sección, su página, o la página de notas.
  function noteHref(n) {
    if (n.page && n.section && sectionTitle(n.page, n.section)) return '#' + n.page + '.' + n.section;
    if (n.page && (getPage(n.page) || n.page === 'glosario')) return '#' + n.page;
    return '#mis-notas';
  }
  function whenText(n) {
    const edited = n.at > n.createdAt + 1000;
    return D.fmtDate(n.createdAt) + (edited ? ' · editada ' + D.fmtDate(n.at) : '');
  }

  // ------------------------------------------------------------------ formulario (nota o término)
  // o = {kind, term, text, allowKind, submitLabel, onSave(values) → bool, onCancel}
  let formSeq = 0;
  function noteForm(o) {
    const id = 'nf' + (++formSeq);
    let kind = o.kind === 'term' ? 'term' : 'note';
    const termIn = h('input', { class: 'input notes-form__term', id: id + '-term', maxlength: String(MAX_TERM), autocomplete: 'off', placeholder: 'p. ej. TLS, load balancer' });
    termIn.value = o.term || '';
    const textTa = h('textarea', { class: 'textarea notes-form__text', id: id + '-text', rows: 4, maxlength: String(MAX_NOTE) });
    textTa.value = o.text || '';
    const termLabel = h('label', { class: 'px-k', for: id + '-term' }, 'Término');
    const textLabel = h('label', { class: 'px-k', for: id + '-text' });
    const termRow = h('div', { class: 'notes-form__row' }, termLabel, termIn);
    const msg = h('p', { class: 'result-msg is-bad notes-form__msg', role: 'alert', hidden: true });
    const segBtns = {};
    const seg = o.allowKind ? h('div', { class: 'seg notes-form__kind', role: 'group', 'aria-label': 'Tipo' },
      [['note', 'Nota'], ['term', 'Término para el glosario']].map(([k, txt]) => (segBtns[k] = h('button', {
        type: 'button', 'aria-pressed': String(kind === k), on: { click: () => setKind(k, true) },
      }, txt)))) : null;

    function setKind(k, focus) {
      kind = k;
      Object.keys(segBtns).forEach((x) => segBtns[x].setAttribute('aria-pressed', String(x === kind)));
      termRow.hidden = kind !== 'term';
      textLabel.textContent = kind === 'term' ? 'Tu definición' : 'Tu nota';
      textTa.placeholder = kind === 'term'
        ? 'Qué es, con tus palabras. P. ej.: cifra la conexión entre cliente y servidor (el candado de HTTPS).'
        : 'Lo que no entendiste, una duda, un resumen, un ejemplo…';
      msg.hidden = true;
      if (focus) (kind === 'term' && !termIn.value.trim() ? termIn : textTa).focus();
    }
    function save() {
      const term = termIn.value.trim();
      const text = textTa.value;
      if (kind === 'term' && !term) { msg.textContent = 'Escribe el término.'; msg.hidden = false; termIn.focus(); return; }
      if (kind === 'note' && !text.trim()) { msg.textContent = 'La nota está vacía.'; msg.hidden = false; textTa.focus(); return; }
      if (o.onSave({ kind, term: kind === 'term' ? term : '', text }) === false) { msg.textContent = 'No se pudo guardar.'; msg.hidden = false; }
    }
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
      else if (e.key === 'Escape' && o.onCancel) { e.preventDefault(); e.stopPropagation(); o.onCancel(); }
    };
    termIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); textTa.focus(); } else onKey(e); });
    textTa.addEventListener('keydown', onKey);

    const form = h('div', { class: 'notes-form' },
      seg,
      termRow,
      h('div', { class: 'notes-form__row' }, textLabel, textTa),
      msg,
      h('div', { class: 'notes-form__actions' },
        h('button', { type: 'button', class: 'btn btn--sm btn--primary', on: { click: save } }, o.submitLabel || 'Guardar'),
        o.onCancel ? h('button', { type: 'button', class: 'btn btn--sm btn--text', on: { click: () => o.onCancel() } }, 'Cancelar') : null,
        h('span', { class: 'muted small notes-form__hint' }, 'Cmd/Ctrl + Enter guarda')));
    setKind(kind, false);
    form.focusFirst = () => (kind === 'term' && !termIn.value.trim() ? termIn : textTa).focus();
    return form;
  }

  // ------------------------------------------------------------------ una nota (ver, editar, borrar)
  // opts = {showWhere, onChange}
  function noteCard(n, opts) {
    const o = opts || {};
    const card = h('article', { class: 'note note--' + n.kind, dataset: { note: n.id }, id: 'nota-' + n.id, tabindex: '-1' });
    function view() {
      card.innerHTML = '';
      const where = o.showWhere && n.page ? h('a', { class: 'note__where', href: noteHref(n) },
        sectionTitle(n.page, n.section) || pageLabel(n.page)) : null;
      card.appendChild(h('header', { class: 'note__head' },
        h('span', { class: 'chip ' + (n.kind === 'term' ? 'chip--accent' : 'chip--warn') }, n.kind === 'term' ? 'Término' : 'Nota'),
        n.kind === 'term' ? h('strong', { class: 'note__term' }, n.term) : null,
        where,
        h('span', { class: 'note__when muted small' }, whenText(n)),
        h('span', { class: 'note__actions' },
          h('button', { type: 'button', class: 'btn btn--sm btn--text', on: { click: edit } }, 'Editar'),
          h('button', { type: 'button', class: 'btn btn--sm btn--text note__del', on: { click: confirmDel } }, 'Borrar'))));
      card.appendChild(h('div', { class: 'note__text' }, n.text));
    }
    function edit() {
      card.innerHTML = '';
      const f = noteForm({
        kind: n.kind, term: n.term, text: n.text, allowKind: true, submitLabel: 'Guardar cambios',
        onSave: (v) => {
          const r = store().updateNote(n.id, v);
          if (!r) return false;
          n = r;
          view();
          card.focus({ preventScroll: true });
          if (o.onChange) o.onChange();
          return true;
        },
        onCancel: () => { view(); card.focus({ preventScroll: true }); },
      });
      card.appendChild(f);
      f.focusFirst();
    }
    function confirmDel() {
      const row = h('div', { class: 'note__confirm', role: 'group', 'aria-label': 'Confirmar borrado' },
        h('span', null, n.kind === 'term' ? '¿Borrar este término?' : '¿Borrar esta nota?'),
        h('button', { type: 'button', class: 'btn btn--sm btn--danger', on: { click: () => {
          store().deleteNote(n.id);
          if (o.onChange) o.onChange({ deleted: n.id });
        } } }, 'Sí, borrar'),
        h('button', { type: 'button', class: 'btn btn--sm btn--text', on: { click: () => { row.remove(); card.querySelector('.note__del').focus(); } } }, 'No'));
      const prev = card.querySelector('.note__confirm');
      if (prev) prev.remove();
      card.appendChild(row);
      row.querySelector('.btn--danger').focus();
    }
    view();
    return card;
  }

  // ------------------------------------------------------------------ notas al final de una sección
  function sectionBlock(pageId, sectionId) {
    const list = h('div', { class: 'notes__list' });
    const slot = h('div', { class: 'notes__form' });
    const panel = h('div', { class: 'notes', dataset: { notesFor: pageId + '.' + sectionId } },
      h('p', { class: 'notes__title' }, h('span', { html: icon('note') }), 'Mis notas'),
      list, slot);
    const countEl = h('span', { class: 'notes-btn__n mono' });
    const button = h('button', {
      type: 'button', class: 'btn btn--sm notes-btn', 'aria-expanded': 'false',
      on: { click: () => (slot.firstChild ? closeForm(true) : openForm()) },
    }, h('span', { html: icon('note') }), h('span', null, 'Agregar nota'), countEl);

    function paint() {
      const items = store().listNotes({ page: pageId, section: sectionId });
      list.innerHTML = '';
      items.forEach((n) => list.appendChild(noteCard(n, { onChange: paint })));
      countEl.textContent = items.length ? String(items.length) : '';
      button.title = items.length ? items.length + (items.length === 1 ? ' nota en esta sección' : ' notas en esta sección') : '';
      panel.hidden = !items.length && !slot.firstChild;
    }
    function openForm() {
      slot.innerHTML = '';
      const f = noteForm({
        kind: 'note', allowKind: true,
        onSave: (v) => {
          const n = store().addNote(Object.assign({ page: pageId, section: sectionId }, v));
          if (!n) return false;
          closeForm(false);
          paint();
          const el = list.querySelector('[data-note="' + n.id + '"]');
          if (el) el.focus({ preventScroll: true });
          return true;
        },
        onCancel: () => closeForm(true),
      });
      slot.appendChild(f);
      button.setAttribute('aria-expanded', 'true');
      panel.hidden = false;
      f.focusFirst();
      const r = f.getBoundingClientRect();
      if (r.bottom > root.innerHeight) f.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
    }
    function closeForm(focusBtn) {
      slot.innerHTML = '';
      button.setAttribute('aria-expanded', 'false');
      paint();
      if (focusBtn) button.focus();
    }
    paint();
    return { panel, button, refresh: paint };
  }

  // ------------------------------------------------------------------ términos propios (glosario, flashcards, búsqueda)
  function glossaryTerms() {
    return safe(() => store().listNotes({ kind: 'term' }), []).map((n) => ({
      en: n.term, es: '', def: textHtml(n.text), mine: true, noteId: n.id, slug: 'mio-' + n.id, href: noteHref(n), page: n.page,
    }));
  }

  function cards() {
    return safe(() => store().listNotes({ kind: 'term' }), []).filter((n) => n.text.trim()).map((n) => ({
      id: 'mio-' + n.id, q: '¿Qué es <b>' + D.esc(n.term) + '</b>?', a: textHtml(n.text), kind: 'mio', source: 'mis-notas',
    }));
  }

  function searchItems() {
    return safe(() => store().listNotes(), []).map((n) => {
      const where = [pageLabel(n.page), sectionTitle(n.page, n.section)].filter(Boolean).join(' · ');
      if (n.kind === 'term') return { type: 'myterm', id: 'myterm:' + n.id, title: n.term, text: n.text.slice(0, 160), href: '#glosario.mio-' + n.id };
      const first = n.text.trim().split('\n')[0];
      return { type: 'note', id: 'note:' + n.id, title: first.length > 90 ? first.slice(0, 88) + '…' : first, text: (where ? where + ' · ' : '') + n.text.slice(0, 160), href: noteHref(n) };
    });
  }

  function termForm(o) {
    const opts = o || {};
    return noteForm({
      kind: 'term', allowKind: false, submitLabel: 'Agregar al glosario',
      onSave: (v) => {
        const n = store().addNote({ kind: 'term', page: opts.page || 'glosario', section: '', term: v.term, text: v.text });
        if (!n) return false;
        if (opts.onDone) opts.onDone(n);
        return true;
      },
      onCancel: opts.onCancel,
    });
  }

  // ------------------------------------------------------------------ página #mis-notas
  function render(container, route, ctx) {
    const wrap = h('div', { class: 'px mynotes' });
    container.appendChild(wrap);
    const m = catItem('mis-notas');
    const eb = h('p', { class: 'eyebrow' }, h('span', null, 'Parte 3'), h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), h('span', null, 'Práctica'));
    wrap.appendChild(h('header', { class: 'phead' }, eb,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, m.title || 'Mis notas'),
      h('p', { class: 'phead__en', lang: 'en' }, m.titleEn || 'My notes'),
      h('p', { class: 'phead__summary' }, 'Lo que fuiste anotando al leer: dudas, resúmenes y términos con tu propia definición. Agrega notas con el botón «Agregar nota» al final de cada sección. Tus términos también salen en el glosario, en el buscador y como flashcards.')));

    let filter = 'all';
    const q = h('input', { type: 'search', class: 'input', id: 'mn-q', autocomplete: 'off', spellcheck: 'false', placeholder: 'Buscar en tus notas…', 'aria-controls': 'mn-list' });
    const segBtns = {};
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Mostrar' }, [['all', 'Todo'], ['note', 'Notas'], ['term', 'Términos']].map(([k, txt]) =>
      (segBtns[k] = h('button', { type: 'button', 'aria-pressed': String(k === filter), on: { click: () => { filter = k; Object.keys(segBtns).forEach((x) => segBtns[x].setAttribute('aria-pressed', String(x === k))); paint(); } } }, txt))));
    const addSlot = h('div', { class: 'mynotes__add' });
    const addBtn = h('button', { type: 'button', class: 'btn btn--sm', 'aria-expanded': 'false', on: { click: () => (addSlot.firstChild ? closeAdd(true) : openAdd()) } },
      h('span', { html: icon('note') }), 'Agregar término');
    const count = h('p', { class: 'mono small muted', id: 'mn-count', 'aria-live': 'polite' });
    const list = h('div', { class: 'mynotes__list', id: 'mn-list' });
    wrap.appendChild(h('div', { class: 'mynotes__tools' },
      h('div', { class: 'mynotes__search' }, h('label', { class: 'px-k', for: 'mn-q' }, 'Buscar'), q),
      seg, addBtn));
    wrap.appendChild(addSlot);
    wrap.appendChild(count);
    wrap.appendChild(list);
    const backend = safe(() => store().backend(), 'local');
    wrap.appendChild(h('p', { class: 'mynotes__foot muted small' }, h('span', { html: icon('info') }),
      backend === 'account' ? 'Tus notas se sincronizan con tu cuenta de claude.ai (solo tú las ves). Exportar / importar progreso también las incluye.'
        : backend === 'local' ? 'Tus notas se guardan en este navegador. Para llevarlas a otro dispositivo usa «Exportar / importar progreso» (pie de la barra lateral).'
          : 'Este navegador no permite guardar: tus notas se pierden al cerrar. Exporta antes de salir.'));

    function openAdd() {
      addSlot.innerHTML = '';
      const f = termForm({ page: '', onDone: () => { closeAdd(false); paint(); }, onCancel: () => closeAdd(true) });
      addSlot.appendChild(f);
      addBtn.setAttribute('aria-expanded', 'true');
      f.focusFirst();
    }
    function closeAdd(focusBtn) {
      addSlot.innerHTML = '';
      addBtn.setAttribute('aria-expanded', 'false');
      if (focusBtn) addBtn.focus();
    }

    function paint() {
      const all = store().listNotes();
      const tokens = norm(q.value).split(/\s+/).filter(Boolean);
      const shown = all.filter((n) => (filter === 'all' || n.kind === filter)
        && tokens.every((t) => norm([n.term, n.text, pageLabel(n.page), sectionTitle(n.page, n.section)].join(' ')).indexOf(t) >= 0));
      list.innerHTML = '';
      const nTerms = all.filter((n) => n.kind === 'term').length;
      count.textContent = all.length
        ? (shown.length === all.length ? '' : shown.length + ' de ') + all.length + (all.length === 1 ? ' entrada' : ' entradas') + ' · ' + plural(all.length - nTerms, 'nota', 'notas') + ' · ' + plural(nTerms, 'término', 'términos')
        : '';
      if (!all.length) {
        list.appendChild(h('div', { class: 'px-empty' },
          h('p', { class: 'px-empty__t' }, 'Todavía no tienes notas'),
          h('p', { class: 'muted' }, 'Al final de cada sección hay un botón «Agregar nota». Ahí puedes escribir una duda, un resumen o un término con tu definición (p. ej. qué es TLS o un load balancer).'),
          h('p', null, h('a', { class: 'btn btn--primary', href: '#m01' }, 'Abrir M01'))));
        return;
      }
      if (!shown.length) {
        list.appendChild(h('div', { class: 'px-empty' }, h('p', { class: 'px-empty__t' }, 'Sin resultados'),
          h('p', { class: 'muted' }, 'Nada coincide con el filtro.')));
        return;
      }
      // Agrupadas por página, en el orden del curso; luego glosario y generales.
      const order = courseOrder();
      const rank = (p) => { const i = order.indexOf(p); return i >= 0 ? i : p === 'glosario' ? 9000 : p ? 8000 : 9999; };
      const groups = new Map();
      shown.forEach((n) => { if (!groups.has(n.page)) groups.set(n.page, []); groups.get(n.page).push(n); });
      Array.from(groups.keys()).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1)).forEach((p) => {
        const items = groups.get(p);
        const head = p && (getPage(p) || p === 'glosario')
          ? h('a', { href: '#' + p }, pageLabel(p)) : pageLabel(p);
        list.appendChild(h('section', { class: 'mynotes__grp', 'aria-label': pageLabel(p) },
          h('h2', { class: 'mynotes__h' }, head, h('span', { class: 'muted small mono' }, ' ' + items.length)),
          items.map((n) => noteCard(n, { showWhere: true, onChange: paint }))));
      });
    }
    q.addEventListener('input', paint);
    paint();
    // #mis-notas.<id-de-nota>: resalta esa nota.
    const target = route && route.sectionId ? wrap.querySelector('[data-note="' + String(route.sectionId).replace(/^nota-/, '') + '"]') : null;
    if (target) { target.classList.add('is-target'); setTimeout(() => target.scrollIntoView({ block: 'center' }), 0); }
  }

  MSD.Notes = { sectionBlock, render, termForm, glossaryTerms, cards, searchItems, pageLabel };
})(typeof window !== 'undefined' ? window : globalThis);
