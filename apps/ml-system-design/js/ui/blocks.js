/* =============================================================================
   Ronda de Diseño ML — js/ui/blocks.js
   MSD.Blocks.render(block, ctx) → HTMLElement para cada tipo de bloque (SPEC §5.3).
   MSD.Blocks.renderAll(blocks, container, ctx)   ctx = {pageId, sectionId, store}
   El HTML de contenido es nuestro (confiable) y se inserta con innerHTML.
   Nunca lanza: un bloque roto o desconocido se muestra como aviso visible.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const { h, icon } = MSD.dom;

  const CALLOUT_ICON = { why: 'question', trap: 'warn', senior: 'star', skip: 'skip', estimate: 'approx', connect: 'link', interview: 'chat', note: 'note' };
  const CALLOUT_TITLES = MSD.CALLOUT_KINDS || { why: 'El porqué', trap: 'Trampa', senior: 'Señal senior', skip: 'Sáltate esto', estimate: 'Estimación — verifica', connect: 'Conexión', interview: 'Cómo decirlo en la entrevista', note: 'Nota' };
  const VERDICT = { elegido: 'Elegido', descartado: 'Descartado', depende: 'Depende' };
  const EST_TIP = 'Estimación: mídela en tu caso';

  const htmlSpan = (cls, html, tag) => h(tag || 'span', { class: cls, html: html == null ? '' : String(html) });
  const arr = (x) => (Array.isArray(x) ? x : []);

  function warnBox(title, detail) {
    return h('div', { class: 'block-warn', role: 'note', dataset: { block: 'warn' } },
      h('span', { class: 'block-warn__icon', html: icon('warn') }),
      h('div', null, h('strong', null, title), detail ? h('div', { class: 'block-warn__detail' }, String(detail)) : null));
  }

  function placeholder(kind, title) {
    return h('div', { class: 'block-placeholder', role: 'note' },
      h('span', { class: 'block-placeholder__kind' }, kind),
      h('span', null, title ? String(title) : ''),
      h('span', { class: 'block-placeholder__hint' }, 'El componente aún no está cargado.'));
  }

  // ------------------------------------------------------------------ renderizadores
  const R = {};

  R.p = (b) => htmlSpan('b-p', b.html, 'p');
  R.h3 = (b) => htmlSpan('b-h3', b.text, 'h3');
  R.html = (b) => htmlSpan('b-html', b.html, 'div');

  R.list = (b) => h(b.ordered ? 'ol' : 'ul', { class: 'b-list' + (b.ordered ? ' b-list--ol' : '') },
    arr(b.items).map((it) => h('li', { html: String(it) })));

  R.callout = (b) => {
    const kind = CALLOUT_TITLES[b.kind] ? b.kind : 'note';
    const title = b.title || CALLOUT_TITLES[kind];
    return h('div', { class: 'callout callout--' + kind, role: 'note', 'aria-label': MSD.stripHtml ? MSD.stripHtml(title) : title },
      h('div', { class: 'callout__head' },
        h('span', { class: 'callout__icon', html: icon(CALLOUT_ICON[kind] || 'info') }),
        h('span', { class: 'callout__title', html: String(title) })),
      h('div', { class: 'callout__body', html: String(b.html || '') }));
  };

  R.table = (b) => {
    const head = arr(b.head);
    const caption = b.caption ? String(b.caption) : '';
    const table = h('table', { class: 'dtable' },
      head.length ? h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col', html: String(c) })))) : null,
      h('tbody', null, arr(b.rows).map((row) => h('tr', null, arr(row).map((c, j) =>
        j === 0 ? h('th', { scope: 'row', html: String(c) }) : h('td', { html: String(c) }))))));
    const label = caption ? (MSD.stripHtml ? MSD.stripHtml(caption) : caption) : 'Tabla';
    return h('figure', { class: 'b-table' },
      caption ? h('figcaption', { class: 'b-table__cap', html: caption }) : null,
      h('div', { class: 'scroll-x', tabindex: '0', role: 'region', 'aria-label': label + ' (desplazable)' }, table),
      b.note ? h('div', { class: 'b-table__note', html: String(b.note) }) : null);
  };

  R.kv = (b) => h('dl', { class: 'kv' }, arr(b.items).map((it) => {
    const [k, v, note] = arr(it);
    return h('div', { class: 'kv__row' },
      h('dt', { class: 'kv__k', html: String(k == null ? '' : k) }),
      h('dd', { class: 'kv__v' },
        h('span', { class: 'kv__val', html: String(v == null ? '' : v) }),
        note ? h('span', { class: 'kv__note', html: String(note) }) : null));
  }));

  R.steps = (b) => h('ol', { class: 'steps' }, arr(b.items).map((it, i) =>
    h('li', { class: 'steps__item' },
      h('span', { class: 'steps__num', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', { class: 'steps__main' },
        h('div', { class: 'steps__head' },
          h('span', { class: 'steps__title', html: String(it.title || '') }),
          it.meta ? h('span', { class: 'steps__meta', html: String(it.meta) }) : null),
        it.html ? h('div', { class: 'steps__body', html: String(it.html) }) : null))));

  // Un valor que ya empieza con ≈, ~ o un signo de comparación no lleva "=" delante ("= ≈ 500" se lee mal).
  const APPROX_START = /^(≈|~|≤|≥|≲|≳|<|>|&lt;|&gt;|&le;|&ge;|&asymp;|&sim;|&lsim;|&gsim;)/;
  const calcValue = (v) => {
    const html = String(v == null ? '' : v);
    const lead = html.replace(/<[^>]*>/g, '').trim();
    return h('div', { class: 'calc__value' },
      APPROX_START.test(lead) ? null : h('span', { class: 'calc__eq', 'aria-hidden': 'true' }, '='),
      h('span', { html }));
  };

  R.calc = (b) => h('figure', { class: 'calc' },
    h('figcaption', { class: 'calc__head' },
      h('span', { class: 'calc__icon', html: icon('approx') }),
      h('span', { class: 'calc__title', html: String(b.title || 'Cálculo back-of-the-envelope') }),
      h('span', { class: 'calc__tag' }, 'Estimación')),
    h('div', { class: 'calc__rows' }, arr(b.rows).map((r) =>
      h('div', { class: 'calc__row' },
        h('div', { class: 'calc__label' },
          h('span', { html: String(r.label == null ? '' : r.label) }),
          r.note ? h('span', { class: 'calc__note', html: String(r.note) }) : null),
        h('div', { class: 'calc__expr', html: r.expr == null ? '' : String(r.expr) }),
        calcValue(r.value)))),
    b.result ? h('div', { class: 'calc__result' }, h('span', { class: 'calc__result-k' }, 'Resultado'), h('div', { class: 'calc__result-v', html: String(b.result) })) : null);

  R.qa = (b) => h('div', { class: 'qa' }, arr(b.items).map((it) =>
    h('div', { class: 'qa__item' },
      h('div', { class: 'qa__row qa__row--q' }, h('span', { class: 'qa__k' }, 'Pregunta'), h('div', { class: 'qa__v qa__q', html: String(it.q || '') })),
      h('div', { class: 'qa__row qa__row--a' }, h('span', { class: 'qa__k' }, 'Supuesto'), h('div', { class: 'qa__v', html: String(it.a || '') })),
      it.why ? h('div', { class: 'qa__row qa__row--why' }, h('span', { class: 'qa__k' }, 'Por qué importa'), h('div', { class: 'qa__v', html: String(it.why) })) : null)));

  R.followups = (b) => h('div', { class: 'fu' }, arr(b.items).map((it) =>
    h('div', { class: 'fu__item' },
      h('div', { class: 'fu__q' }, h('span', { class: 'fu__who' }, 'Entrevistador'), h('div', { class: 'fu__qtext', html: String(it.q || '') })),
      h('div', { class: 'fu__cols' },
        h('div', { class: 'fu__col fu__col--junior' }, h('div', { class: 'fu__label' }, h('span', { class: 'fu__mark', html: icon('close') }), 'Nivel junior'), h('div', { class: 'fu__text', html: String(it.junior || '') })),
        h('div', { class: 'fu__col fu__col--senior' }, h('div', { class: 'fu__label' }, h('span', { class: 'fu__mark', html: icon('check') }), 'Nivel senior'), h('div', { class: 'fu__text', html: String(it.senior || '') }))),
      it.why ? h('div', { class: 'fu__why' }, h('span', { class: 'fu__why-k' }, 'Por qué puntúa'), h('div', { html: String(it.why) })) : null)));

  R.tradeoffs = (b) => h('div', { class: 'to' }, arr(b.items).map((it) => {
    const v = VERDICT[it.verdict] ? it.verdict : 'depende';
    return h('div', { class: 'to__item to__item--' + v },
      h('div', { class: 'to__head' },
        h('span', { class: 'to__option', html: String(it.option || '') }),
        h('span', { class: 'verdict verdict--' + v }, VERDICT[v])),
      h('div', { class: 'to__cols' },
        h('div', { class: 'to__col to__col--pro' }, h('div', { class: 'to__k' }, 'A favor'), h('div', { class: 'to__v', html: String(it.pros || '—') })),
        h('div', { class: 'to__col to__col--con' }, h('div', { class: 'to__k' }, 'En contra'), h('div', { class: 'to__v', html: String(it.cons || '—') }))),
      it.why ? h('div', { class: 'to__why' }, h('span', { class: 'to__k' }, 'Por qué'), h('div', { class: 'to__v', html: String(it.why) })) : null);
  }));

  R.checklist = (b, ctx) => {
    const store = ctx && ctx.store;
    const pageId = (ctx && ctx.pageId) || 'dev';
    const listId = b.id || 'checklist';
    const local = {};   // sin store: estado solo en memoria
    const get = () => (store ? store.getChecklist(pageId, listId) : local);
    const items = arr(b.items);
    const count = h('span', { class: 'checklist__count', 'aria-live': 'polite' });
    const bar = h('span', { class: 'checklist__bar' }, h('span', { class: 'checklist__fill' }));
    const update = () => {
      const st = get();
      const n = items.filter((it) => st[it.id]).length;
      count.textContent = n + ' / ' + items.length;
      bar.firstChild.style.width = (items.length ? (n / items.length) * 100 : 0) + '%';
      wrap.classList.toggle('is-complete', items.length > 0 && n === items.length);
    };
    const st0 = get();
    const list = h('ul', { class: 'checklist__list' }, items.map((it) => {
      const inputId = 'ck-' + pageId + '-' + listId + '-' + it.id;
      const input = h('input', {
        type: 'checkbox', id: inputId, class: 'checklist__box', checked: !!st0[it.id],
        on: { change: (e) => {
          if (store) store.setChecklistItem(pageId, listId, it.id, e.target.checked); else local[it.id] = e.target.checked;
          e.target.closest('.checklist__item').classList.toggle('is-on', e.target.checked);
          update();
        } },
      });
      return h('li', { class: 'checklist__item' + (st0[it.id] ? ' is-on' : '') },
        input, h('label', { for: inputId, class: 'checklist__label', html: String(it.html || '') }));
    }));
    const wrap = h('div', { class: 'checklist', dataset: { list: listId } },
      h('div', { class: 'checklist__head' }, h('span', { class: 'checklist__title' }, 'Checklist'), bar, count),
      list);
    update();
    return wrap;
  };

  R.quiz = (b, ctx) => {
    const base = 'qz-' + ((ctx && ctx.pageId) || 'x') + '-' + ((ctx && ctx.sectionId) || 'x') + '-' + Math.random().toString(36).slice(2, 6);
    return h('div', { class: 'quiz' }, arr(b.items).map((it, qi) => {
      const fb = h('div', { class: 'quiz__fb', 'aria-live': 'polite' });
      const qid = base + '-' + qi;
      const opts = arr(it.options).map((o, oi) => h('button', {
        type: 'button', class: 'quiz__opt', dataset: { i: oi },
        on: { click: () => choose(oi) },
      }, h('span', { class: 'quiz__letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + oi)), h('span', { class: 'quiz__text', html: String(o) })));
      const retry = h('button', { type: 'button', class: 'btn btn--sm btn--ghost quiz__retry', hidden: true, on: { click: reset } }, 'Intentar de nuevo');
      function choose(oi) {
        const right = oi === it.answer;
        opts.forEach((btn, i) => {
          btn.disabled = true;
          btn.classList.toggle('is-right', i === it.answer);
          btn.classList.toggle('is-wrong', i === oi && !right);
          btn.setAttribute('aria-pressed', i === oi ? 'true' : 'false');
        });
        fb.className = 'quiz__fb ' + (right ? 'is-right' : 'is-wrong');
        fb.innerHTML = '';
        fb.appendChild(h('div', { class: 'quiz__verdict' }, h('span', { html: icon(right ? 'check' : 'close') }), right ? 'Correcto' : 'No exactamente: la respuesta es ' + String.fromCharCode(65 + (it.answer || 0))));
        if (it.explain) fb.appendChild(h('div', { class: 'quiz__explain', html: String(it.explain) }));
        retry.hidden = false;
        // Las opciones quedan deshabilitadas: el foco pasa a "Intentar de nuevo" para no perderse en <body>.
        retry.focus({ preventScroll: true });
      }
      function reset() {
        opts.forEach((btn) => { btn.disabled = false; btn.classList.remove('is-right', 'is-wrong'); btn.removeAttribute('aria-pressed'); });
        fb.className = 'quiz__fb';
        fb.innerHTML = '';
        retry.hidden = true;
        if (opts[0]) opts[0].focus();
      }
      return h('div', { class: 'quiz__item', role: 'group', 'aria-labelledby': qid },
        h('div', { class: 'quiz__q', id: qid },
          h('span', { class: 'quiz__tag' }, 'Autoevaluación'),
          h('div', { html: String(it.q || '') })),
        h('div', { class: 'quiz__opts' }, opts),
        fb, retry);
    }));
  };

  R.diagram = (b) => {
    if (MSD.Diagram && typeof MSD.Diagram.render === 'function') {
      return MSD.Diagram.render(b.spec, { id: b.id, title: b.title, caption: b.caption });
    }
    return placeholder('Diagrama', b.title);
  };

  R.code = (b) => {
    if (MSD.Code && typeof MSD.Code.render === 'function') {
      return MSD.Code.render(b.files, { title: b.title, caption: b.caption });
    }
    return placeholder('Código', b.title || arr(b.files).map((f) => f && f.name).filter(Boolean).join(' · '));
  };

  // ------------------------------------------------------------------ decoración del HTML en línea
  // .est → tooltip; .en → lang="en"; enlaces internos a páginas "próximamente" → marca discreta.
  function decorate(el) {
    if (!el || !el.querySelectorAll) return el;
    el.querySelectorAll('span.est').forEach((s) => {
      if (!s.title) s.title = EST_TIP;
      if (!s.hasAttribute('data-est')) s.setAttribute('data-est', '');
    });
    el.querySelectorAll('span.en').forEach((s) => { if (!s.lang) s.lang = 'en'; });
    el.querySelectorAll('a[href^="#"]').forEach((a) => {
      const pid = (a.getAttribute('href') || '').slice(1).split('.')[0];
      if (!/^([mc]\d\d|ref-[a-z]+)$/.test(pid) || typeof MSD.getPage !== 'function') return;
      const p = MSD.getPage(pid);
      if (!p || !p.ready) { a.classList.add('is-soon'); if (!a.title) a.title = 'Próximamente: se abre la ficha del tema'; }
    });
    el.querySelectorAll('a[target="_blank"]').forEach((a) => {
      if (!a.rel) a.rel = 'noopener';
      a.classList.add('is-external');
    });
    return el;
  }

  // ------------------------------------------------------------------ API
  function render(block, ctx) {
    if (!block || typeof block !== 'object') return warnBox('Bloque vacío o inválido');
    const fn = R[block.t];
    if (!fn) return warnBox('Tipo de bloque desconocido: "' + String(block.t) + '"', 'Tipos válidos: ' + Object.keys(R).join(', '));
    let el;
    try { el = fn(block, ctx || {}); }
    catch (e) {
      if (root.console) root.console.warn('[blocks] error al renderizar', block.t, e);
      return warnBox('No se pudo mostrar un bloque "' + block.t + '"', e && e.message);
    }
    if (!el || typeof el.nodeType !== 'number') return warnBox('El bloque "' + block.t + '" no produjo contenido');
    if (el.dataset && !el.dataset.block) el.dataset.block = block.t;
    return decorate(el);
  }

  function renderAll(blocks, container, ctx) {
    if (!container) return container;
    arr(blocks).forEach((b) => container.appendChild(render(b, ctx)));
    return container;
  }

  MSD.Blocks = { render, renderAll, decorate, TYPES: Object.keys(R) };
})(typeof window !== 'undefined' ? window : globalThis);
