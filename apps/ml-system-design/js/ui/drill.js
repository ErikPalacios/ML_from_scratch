/* =============================================================================
   Ronda de Diseño ML — js/ui/drill.js
   Práctica de un módulo (#practicar-mNN): rondas de 10 preguntas difíciles.
     - opción múltiple de MSD.drillBank[mNN].questions (primero las que no has visto);
     - cálculos de MSD.drillBank[mNN].calc con números nuevos en cada ronda (se acepta ±tol);
     - panel de apuntes a la derecha: formulario, notas rápidas y tus notas del módulo.
   La ronda en curso vive en memoria (si vas a releer una sección y vuelves, sigue donde estabas);
   las estadísticas (rondas, mejor puntaje) y las preguntas vistas se guardan en prefs del store.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const D = MSD.dom;
  const { h, icon } = D;

  const ROUND_MCQ = 6;
  const ROUND_CALC = 4;
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const reduced = () => (D.reducedMotion ? D.reducedMotion() : false);
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (x) => {
    const n = Number(x);
    const dec = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : Math.abs(n) >= 1 ? 2 : 3;
    return n.toLocaleString('en-US', { maximumFractionDigits: dec });
  };

  // Generador de números para las plantillas (aleatorio de verdad: cada ronda trae datos nuevos).
  const R = {
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    int: (lo, hi, step) => { const s = step || 1; return lo + s * Math.floor(Math.random() * (Math.floor((hi - lo) / s) + 1)); },
  };
  function shuffle(a) {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = x[i]; x[i] = x[j]; x[j] = t; }
    return x;
  }

  // "1,200" · "1200" · "1.2k" · "3.5 M" · "1e6" · "0,5" → número (null si no se entiende).
  function parseNum(str) {
    let s = String(str || '').trim().toLowerCase().replace(/\s+/g, '').replace(/^≈/, '');
    if (!s) return null;
    let mult = 1;
    const suf = /([kmb])$/.exec(s);
    if (suf) { mult = { k: 1e3, m: 1e6, b: 1e9 }[suf[1]]; s = s.slice(0, -1); }
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');   // miles con coma
    else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');                // decimal con coma
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(s)) return null;
    const n = parseFloat(s) * mult;
    return isFinite(n) ? n : null;
  }

  const bankOf = (mod) => (MSD.drillBank && MSD.drillBank[mod]) || null;
  const pageOf = (mod) => safe(() => MSD.getPage(mod), null);
  const metaOf = (mod) => safe(() => MSD.catalog().items[mod], null) || {};
  function sectionTitle(mod, sid) {
    const p = pageOf(mod);
    const s = p && p.sections ? p.sections.find((x) => x.id === sid) : null;
    return s ? s.title : '';
  }
  function hasDrill(mod) {
    const b = bankOf(mod);
    return !!(b && ((b.questions && b.questions.length) || (b.calc && b.calc.length)));
  }

  // ------------------------------------------------------------------ estado
  const rounds = {};   // mod → ronda en curso {items, i, answers, done}
  function stats(store, mod) { return (store.pref('drillStats') || {})[mod] || { rounds: 0, best: null, last: null }; }
  function saveStats(store, mod, pct) {
    const all = store.pref('drillStats') || {};
    const s = all[mod] || { rounds: 0, best: null, last: null };
    all[mod] = { rounds: s.rounds + 1, best: s.best === null ? pct : Math.max(s.best, pct), last: pct };
    store.setPref('drillStats', all);
  }

  function newRound(store, mod) {
    const b = bankOf(mod);
    const qs = (b.questions || []).filter((q) => q && q.id && Array.isArray(q.options));
    const seenAll = store.pref('drillSeen') || {};
    let seen = new Set(seenAll[mod] || []);
    if (qs.filter((q) => !seen.has(q.id)).length < ROUND_MCQ) seen = new Set();   // ya viste todas: empieza otra vuelta
    const unseen = shuffle(qs.filter((q) => !seen.has(q.id)));
    const pickQ = unseen.slice(0, ROUND_MCQ);
    pickQ.forEach((q) => seen.add(q.id));
    seenAll[mod] = Array.from(seen);
    store.setPref('drillSeen', seenAll);
    const calcs = shuffle(b.calc || []).slice(0, ROUND_CALC).map((t) => {
      const g = t.gen(R);
      return Object.assign({ kind: 'calc', id: t.id, section: t.section, title: t.title }, g);
    });
    const mcq = pickQ.map((q) => ({ kind: 'mcq', id: q.id, section: q.section, q: q.q, explain: q.explain, options: shuffle(q.options) }));
    // Intercaladas: no cuatro cálculos seguidos.
    const items = shuffle(mcq.concat(calcs));
    return { items, i: 0, answers: [], done: false };
  }

  // ------------------------------------------------------------------ panel de apuntes (derecha)
  let notesPanel = null;
  function apuntesPanel(mod, store) {
    const b = bankOf(mod) || {};
    let tab = 'formulario';
    const tabs = {};
    const body = h('div', { class: 'dpanel__body' });
    const panel = h('aside', { class: 'dpanel', id: 'drill-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'drill-panel-title', hidden: true },
      h('header', { class: 'dpanel__head' },
        h('h2', { class: 'dpanel__title', id: 'drill-panel-title', tabindex: '-1' }, 'Apuntes de ' + mod.toUpperCase()),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cerrar los apuntes', on: { click: () => close(true) } }, h('span', { html: icon('close') }))),
      h('div', { class: 'seg dpanel__tabs', role: 'tablist', 'aria-label': 'Apuntes' }, [['formulario', 'Formulario'], ['notas', 'Notas rápidas'], ['mias', 'Mis notas']].map(([k, t]) =>
        (tabs[k] = h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab), 'aria-pressed': String(k === tab), on: { click: () => setTab(k) } }, t)))),
      body);
    let ret = null;
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } });
    function setTab(k) {
      tab = k;
      Object.keys(tabs).forEach((x) => { tabs[x].setAttribute('aria-selected', String(x === k)); tabs[x].setAttribute('aria-pressed', String(x === k)); });
      paint();
    }
    function paint() {
      body.innerHTML = '';
      if (tab === 'formulario') {
        (b.formulas || []).forEach((f) => body.appendChild(h('div', { class: 'dform' },
          h('p', { class: 'dform__t' }, f.title),
          h('p', { class: 'dform__expr mono' }, f.expr),
          f.ex ? h('p', { class: 'dform__ex muted small' }, f.ex) : null)));
        if (!(b.formulas || []).length) body.appendChild(h('p', { class: 'muted' }, 'Este módulo no tiene formulario.'));
      } else if (tab === 'notas') {
        (b.quick || []).forEach((c) => body.appendChild(h('section', { class: 'dquick' }, h('h3', { class: 'dquick__t' }, c.title), h('div', { class: 'dquick__html', html: String(c.html || '') }))));
        if (!(b.quick || []).length) body.appendChild(h('p', { class: 'muted' }, 'Todavía no hay notas rápidas para este módulo.'));
      } else {
        const mine = safe(() => store.listNotes({ page: mod }), []);
        if (!mine.length) body.appendChild(h('p', { class: 'muted' }, 'No tienes notas en ' + mod.toUpperCase() + '. Mientras lees el módulo, usa «Nota» en la barra flotante; aquí aparecen para repasarlas.'));
        mine.forEach((n) => body.appendChild(h('div', { class: 'note note--' + n.kind },
          h('header', { class: 'note__head' },
            h('span', { class: 'chip ' + (n.kind === 'term' ? 'chip--accent' : 'chip--warn') }, n.kind === 'term' ? 'Término' : 'Nota'),
            n.kind === 'term' ? h('strong', { class: 'note__term' }, n.term) : null,
            n.section ? h('a', { class: 'note__where', href: '#' + mod + '.' + n.section }, sectionTitle(mod, n.section)) : null),
          h('div', { class: 'note__text' }, n.text))));
      }
      if (MSD.Blocks && MSD.Blocks.decorate && tab === 'notas') safe(() => MSD.Blocks.decorate(body));
    }
    function open(k) {
      if (k) setTab(k); else paint();
      if (panel.hidden) ret = document.activeElement;
      panel.hidden = false;
      document.documentElement.classList.add('drill-panel-open');
      panel.querySelector('.dpanel__title').focus({ preventScroll: true });
      syncButtons();
    }
    function close(restore) {
      if (panel.hidden) return;
      panel.hidden = true;
      document.documentElement.classList.remove('drill-panel-open');
      syncButtons();
      if (restore && ret && ret.isConnected) ret.focus({ preventScroll: true });
    }
    function syncButtons() {
      document.querySelectorAll('[data-drill-open]').forEach((bt) => bt.setAttribute('aria-expanded', String(!panel.hidden && bt.dataset.drillOpen === tab)));
    }
    return { panel, open, close, isOpen: () => !panel.hidden, tab: () => tab };
  }

  // ------------------------------------------------------------------ página
  function render(container, route, ctx) {
    const store = (ctx && ctx.store) || MSD.store;
    const mod = String(route.pageId || '').replace(/^practicar-/, '');
    const m = metaOf(mod);
    if (notesPanel) { notesPanel.close(false); if (notesPanel.panel.isConnected) notesPanel.panel.remove(); notesPanel = null; }
    document.documentElement.classList.remove('drill-panel-open');

    const wrap = h('div', { class: 'px drill' });
    container.appendChild(wrap);
    const eb = h('p', { class: 'eyebrow' },
      h('a', { href: '#' + mod }, 'Módulo ' + pad2(m.num || +mod.slice(1))),
      h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), h('span', null, 'Práctica'));
    wrap.appendChild(h('header', { class: 'phead' }, eb,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, 'Practicar ' + mod.toUpperCase() + (m.short ? ': ' + m.short : '')),
      h('p', { class: 'phead__summary' }, 'Rondas de 10 preguntas difíciles del módulo: escenarios con trampa como en la entrevista y cálculos con números nuevos en cada ronda. Ten a la mano el formulario y las notas rápidas.')));

    if (!hasDrill(mod)) {
      wrap.appendChild(h('div', { class: 'px-empty' }, h('p', { class: 'px-empty__t' }, 'Este módulo todavía no tiene práctica'),
        h('p', null, h('a', { class: 'btn', href: '#' + mod }, 'Volver al módulo'))));
      return;
    }

    notesPanel = apuntesPanel(mod, store);
    document.body.appendChild(notesPanel.panel);
    const openBtn = (k, label, ic) => h('button', {
      type: 'button', class: 'btn btn--sm', 'aria-controls': 'drill-panel', 'aria-expanded': 'false', dataset: { drillOpen: k },
      on: { click: () => (notesPanel.isOpen() && notesPanel.tab() === k ? notesPanel.close(true) : notesPanel.open(k)) },
    }, h('span', { html: icon(ic) }), label);
    const tools = h('div', { class: 'drill__tools' },
      openBtn('formulario', 'Formulario', 'approx'), openBtn('notas', 'Notas rápidas', 'note'), openBtn('mias', 'Mis notas', 'book'));
    wrap.appendChild(tools);
    const stage = h('div', { class: 'drill__stage', 'aria-live': 'polite' });
    wrap.appendChild(stage);

    // Al salir de la página se quita el panel (vive en <body> para ir fijo a la derecha).
    const onHash = () => {
      if (!wrap.isConnected || !/^#practicar-/.test(root.location.hash)) {
        if (notesPanel) { notesPanel.close(false); notesPanel.panel.remove(); notesPanel = null; }
        document.documentElement.classList.remove('drill-panel-open');
        root.removeEventListener('hashchange', onHash);
      }
    };
    root.addEventListener('hashchange', onHash);

    function paintIntro() {
      stage.innerHTML = '';
      const st = stats(store, mod);
      const b = bankOf(mod);
      stage.appendChild(h('section', { class: 'drill__intro' },
        h('ul', { class: 'drill__facts' },
          h('li', null, h('b', null, String((b.questions || []).length)), ' preguntas de opción múltiple'),
          h('li', null, h('b', null, String((b.calc || []).length)), ' tipos de cálculo con datos nuevos cada ronda (se acepta ±15 %)'),
          h('li', null, 'Rondas jugadas: ', h('b', null, String(st.rounds)), st.best !== null ? [' · mejor: ', h('b', null, st.best + ' %'), ' · última: ', h('b', null, st.last + ' %')] : null)),
        h('div', { class: 'drill__start' },
          h('button', { type: 'button', class: 'btn btn--primary btn--lg', on: { click: start } }, h('span', { html: icon('play') }), 'Nueva ronda'),
          h('span', { class: 'muted small' }, ROUND_MCQ + ' de opción múltiple + ' + ROUND_CALC + ' cálculos · Enter comprueba y pasa a la siguiente'))));
    }

    function start() {
      rounds[mod] = newRound(store, mod);
      paintQuestion(true);
    }

    function paintQuestion(focus) {
      const rd = rounds[mod];
      if (!rd || rd.done) { paintSummary(focus); return; }
      const it = rd.items[rd.i];
      const ans = rd.answers[rd.i];
      stage.innerHTML = '';
      const n = rd.items.length;
      const head = h('div', { class: 'drill__prog' },
        h('span', { class: 'mono small' }, 'Pregunta ' + (rd.i + 1) + ' de ' + n),
        h('span', { class: 'drill__bar', 'aria-hidden': 'true' }, h('i', { style: { width: ((rd.i + (ans ? 1 : 0)) / n) * 100 + '%' } })),
        h('span', { class: 'mono small muted' }, rd.answers.filter((a) => a && a.ok).length + ' bien'));
      const secT = sectionTitle(mod, it.section);
      const card = h('article', { class: 'dq' + (ans ? (ans.ok ? ' is-ok' : ' is-bad') : ''), 'aria-labelledby': 'dq-q' },
        h('div', { class: 'dq__tags' },
          h('span', { class: 'chip ' + (it.kind === 'calc' ? 'chip--warn' : 'chip--accent') }, it.kind === 'calc' ? 'Cálculo' : 'Opción múltiple'),
          secT ? h('span', { class: 'chip' }, secT) : null),
        h('div', { class: 'dq__q', id: 'dq-q', tabindex: '-1', html: String(it.q) }));
      let act;
      if (it.kind === 'mcq') {
        const name = 'dq-opt-' + rd.i;
        const list = h('div', { class: 'dq__opts', role: 'radiogroup', 'aria-labelledby': 'dq-q' });
        it.options.forEach((o, k) => {
          const chosen = ans && ans.choice === k;
          const cls = 'dq__opt' + (ans ? (o.ok ? ' is-right' : chosen ? ' is-wrong' : ' is-dim') : '');
          const inp = h('input', { type: 'radio', name, value: String(k), id: name + '-' + k });
          if (ans) { inp.disabled = true; inp.checked = chosen; }
          list.appendChild(h('label', { class: cls, for: name + '-' + k },
            inp, h('span', { class: 'dq__key mono' }, String.fromCharCode(65 + k)),
            h('span', { class: 'dq__otext' }, h('span', { html: String(o.html) }),
              ans && (o.ok || chosen) && o.why ? h('span', { class: 'dq__why', html: String(o.why) }) : null)));
        });
        card.appendChild(list);
        act = () => {
          const sel = list.querySelector('input:checked');
          if (!sel) { toastMsg('Elige una opción'); return; }
          const k = +sel.value;
          rd.answers[rd.i] = { ok: !!it.options[k].ok, choice: k };
          paintQuestion(false);
          focusResult();
        };
      } else {
        const inId = 'dq-in-' + rd.i;
        const inp = h('input', { class: 'input dq__num mono', id: inId, inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: 'tu número' });
        if (ans) { inp.value = ans.raw; inp.disabled = true; }
        const msg = h('p', { class: 'result-msg is-bad', role: 'alert', hidden: true });
        card.appendChild(h('div', { class: 'dq__calc' },
          h('label', { class: 'px-k', for: inId }, 'Tu respuesta'),
          h('div', { class: 'dq__row' }, inp, h('span', { class: 'dq__unit' }, it.unit)),
          h('p', { class: 'muted small' }, it.tol ? 'Se acepta ±' + Math.round(it.tol * 100) + ' %: importa el orden de magnitud. Acepta 1,200 · 1.2k · 3.5M.' : 'Respuesta exacta (un número entero).'),
          msg));
        if (!ans) setTimeout(() => inp.focus({ preventScroll: true }), 0);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); act(); } });
        act = () => {
          const v = parseNum(inp.value);
          if (v === null) { msg.textContent = 'Escribe un número (p. ej. 350, 1,200 o 1.2k).'; msg.hidden = false; inp.focus(); return; }
          const ok = it.tol ? Math.abs(v - it.answer) <= it.tol * Math.abs(it.answer) : Math.round(v) === Math.round(it.answer);
          rd.answers[rd.i] = { ok, raw: inp.value, value: v };
          paintQuestion(false);
          focusResult();
        };
      }
      if (ans) {
        const res = h('div', { class: 'dq__res', id: 'dq-res', tabindex: '-1' },
          h('p', { class: 'dq__verdict' }, h('span', { html: icon(ans.ok ? 'check' : 'close') }), ans.ok ? '¡Correcto!' : 'No esta vez.'));
        if (it.kind === 'calc') {
          res.appendChild(h('p', { class: 'small' }, 'Tu respuesta: ', h('b', { class: 'mono' }, fmt(ans.value) + ' ' + it.unit), ' · esperado ≈ ', h('b', { class: 'mono' }, fmt(it.answer) + ' ' + it.unit)));
          res.appendChild(h('ol', { class: 'dq__steps' }, (it.steps || []).map((s) => h('li', { html: String(s) }))));
        } else if (it.explain) res.appendChild(h('div', { class: 'dq__explain', html: String(it.explain) }));
        if (secT) res.appendChild(h('p', { class: 'small' }, 'Repasar: ', h('a', { href: '#' + mod + '.' + it.section }, secT)));
        card.appendChild(res);
      }
      const isLast = rd.i === rd.items.length - 1;
      const primary = ans
        ? h('button', { type: 'button', class: 'btn btn--primary', on: { click: next } }, isLast ? 'Ver resultado' : 'Siguiente', h('span', { html: icon('arrow-right') }))
        : h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => act() } }, 'Comprobar');
      card.appendChild(h('div', { class: 'dq__actions' }, primary,
        h('button', { type: 'button', class: 'btn btn--text btn--sm', on: { click: () => { delete rounds[mod]; paintIntro(); } } }, 'Terminar ronda')));
      stage.appendChild(head);
      stage.appendChild(card);
      if (MSD.Blocks && MSD.Blocks.decorate) safe(() => MSD.Blocks.decorate(card));
      card._act = act;
      if (focus && it.kind === 'mcq') { const q = card.querySelector('#dq-q'); if (q) q.focus({ preventScroll: true }); stage.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
    }

    function focusResult() {
      const r = stage.querySelector('#dq-res');
      if (r) { r.focus({ preventScroll: true }); const b = r.getBoundingClientRect(); if (b.bottom > root.innerHeight) r.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); }
    }

    function next() {
      const rd = rounds[mod];
      if (rd.i < rd.items.length - 1) { rd.i++; paintQuestion(true); return; }
      rd.done = true;
      const okN = rd.answers.filter((a) => a && a.ok).length;
      saveStats(store, mod, Math.round((okN / rd.items.length) * 100));
      paintSummary(true);
    }

    function paintSummary(focus) {
      const rd = rounds[mod];
      stage.innerHTML = '';
      const okN = rd.answers.filter((a) => a && a.ok).length;
      const pct = Math.round((okN / rd.items.length) * 100);
      const st = stats(store, mod);
      const miss = rd.items.map((it, k) => ({ it, a: rd.answers[k] })).filter((x) => !(x.a && x.a.ok));
      const bySec = {};
      miss.forEach((x) => { bySec[x.it.section] = (bySec[x.it.section] || 0) + 1; });
      stage.appendChild(h('section', { class: 'drill__sum' },
        h('h2', { class: 'drill__score', id: 'drill-score', tabindex: '-1' }, okN + ' de ' + rd.items.length, h('span', { class: 'muted' }, ' · ' + pct + ' %')),
        h('p', { class: 'muted' }, pct >= 80 ? 'Muy bien: este módulo lo tienes. Haz otra ronda en unos días para que no se olvide.'
          : pct >= 50 ? 'Vas bien. Relee las secciones de abajo y haz otra ronda.'
            : 'Relee las secciones de abajo antes de la próxima ronda: ahí está lo que falló.'),
        h('p', { class: 'small' }, 'Rondas: ', h('b', null, String(st.rounds)), st.best !== null ? [' · mejor: ', h('b', null, st.best + ' %')] : null),
        Object.keys(bySec).length ? h('div', null, h('p', { class: 'px-k' }, 'Para repasar'),
          h('ul', { class: 'drill__miss' }, Object.keys(bySec).map((sid) => h('li', null,
            h('a', { href: '#' + mod + '.' + sid }, sectionTitle(mod, sid) || sid), h('span', { class: 'muted small' }, ' · ' + bySec[sid] + (bySec[sid] === 1 ? ' falla' : ' fallas')))))) : null,
        h('div', { class: 'drill__start' },
          h('button', { type: 'button', class: 'btn btn--primary btn--lg', on: { click: start } }, h('span', { html: icon('play') }), 'Nueva ronda'),
          h('a', { class: 'btn', href: '#' + mod }, 'Volver al módulo'))));
      if (focus) { const t = stage.querySelector('#drill-score'); if (t) t.focus({ preventScroll: true }); }
    }

    function toastMsg(t) { if (D.toast) D.toast(t); }

    // Teclado: 1–4 / A–D eligen opción; Enter comprueba o pasa a la siguiente.
    wrap.addEventListener('keydown', (e) => {
      const rd = rounds[mod];
      if (!rd || rd.done || e.metaKey || e.ctrlKey || e.altKey) return;
      const it = rd.items[rd.i];
      const card = stage.querySelector('.dq');
      if (!card) return;
      const t = e.target;
      const typing = t && t.tagName === 'INPUT' && t.type !== 'radio';
      if (e.key === 'Enter' && !typing && !(t && (t.tagName === 'BUTTON' || t.tagName === 'A'))) {
        e.preventDefault();
        if (rd.answers[rd.i]) next(); else if (card._act) card._act();
      } else if (it.kind === 'mcq' && !rd.answers[rd.i] && !typing) {
        const k = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(String(e.key).toLowerCase());
        if (k >= 0 && k < it.options.length) { const r = card.querySelector('input[value="' + k + '"]'); if (r) { r.checked = true; r.focus(); } }
      }
    });

    if (rounds[mod] && !rounds[mod].done) paintQuestion(false);
    else if (rounds[mod] && rounds[mod].done) paintSummary(false);
    else paintIntro();
  }

  // current(mod): la ronda en curso (solo lectura; la usa la prueba de humo para contestar).
  MSD.Drill = { render, hasDrill, parseNum, current: (mod) => rounds[mod] || null };
})(typeof window !== 'undefined' ? window : globalThis);
