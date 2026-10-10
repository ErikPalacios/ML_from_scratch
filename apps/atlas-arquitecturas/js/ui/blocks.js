/* =============================================================================
   Atlas de Arquitecturas — js/ui/blocks.js
   Basado en apps/ml-system-design/js/ui/blocks.js.
   ATLAS.Blocks.render(block, ctx) → HTMLElement para cada tipo de bloque (SPEC §5.4).
   ATLAS.Blocks.renderAll(blocks, container, ctx)   ctx = {pageId, sectionId, store, model, config}
     - Todos los tipos de la Ronda + math, op, trace, params, flops, compare, card, formulas
       (generados desde ATLAS.Arch, §6.7) · archdiagram / viz (ATLAS.ArchDiagram / ATLAS.Viz, §7.9)
       · scaling, blankdiagram, shapedrill, whatif (delegados a ATLAS.Practice.renderBlock, §8.6).
     - {{config.path}} en cualquier texto pasa por ATLAS.Quantities.fill (§6.6).
     - <a href="lab:…"> se reescribe con ATLAS.labLink (§10.3).
     - Componentes ausentes → aviso visible; nunca lanza.
   Componentes con controlador (diagramas, viz, práctica) se montan cuando el bloque ya está en el
   documento (para que puedan medir su ancho): ATLAS.Blocks.mount(scope). El controlador queda en
   el elemento (el._atlasCtrl) y se listan con ATLAS.Blocks.controllers(scope, kind?).
   Eventos: el recorrido de un diagrama puede emitir en document 'atlas:walkstep'
   {detail:{tensors:[ids], model?}} y la tabla trace resalta esas filas (también markTrace()).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const { h, icon } = ATLAS.dom;

  const CALLOUT_ICON = { why: 'question', trap: 'warn', senior: 'star', skip: 'skip', estimate: 'approx', connect: 'link', interview: 'chat', note: 'note' };
  const CALLOUT_TITLES = ATLAS.CALLOUT_KINDS || { why: 'El porqué', trap: 'Trampa', senior: 'Señal senior', skip: 'Sáltate esto', estimate: 'Estimación — verifica', connect: 'Conexión', interview: 'Cómo decirlo en la entrevista', note: 'Nota' };
  const VERDICT = { elegido: 'Elegido', descartado: 'Descartado', depende: 'Depende' };
  const EST_TIP = 'Estimación: mídela en tu caso';
  const OP_TITLE = {};
  (ATLAS.OP_TYPES || []).forEach((o) => { OP_TITLE[o.id] = o.title; });

  const arr = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => (x == null ? '' : String(x));
  const strip = (s) => (typeof ATLAS.stripHtml === 'function' ? ATLAS.stripHtml(s) : str(s).replace(/<[^>]*>/g, ''));
  const htmlSpan = (cls, html, tag) => h(tag || 'span', { class: cls, html: str(html) });
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const tex = (s) => '\\(' + str(s) + '\\)';

  function warnBox(title, detail) {
    return h('div', { class: 'block-warn', role: 'note', dataset: { block: 'warn' } },
      h('span', { class: 'block-warn__icon', html: icon('warn') }),
      h('div', null, h('strong', null, title), detail ? h('div', { class: 'block-warn__detail' }, String(detail)) : null));
  }
  function missingComponent(kind, file) {
    return warnBox('Falta el componente: ' + kind, 'No se cargó ' + file + '. El resto de la página funciona.');
  }

  // ------------------------------------------------------------------ calculadora (ATLAS.Arch) — acceso defensivo
  const A = () => ATLAS.Arch || null;
  // copias de los pesos de una op (op.paramRepeat, fase 7; por defecto op.repeat): los parámetros se multiplican por esto
  const pRep = (o) => (o && o.paramRepeat != null ? o.paramRepeat : (o && o.repeat) || 1);
  function fmtInt(n) {
    const f = A() && A().fmt;
    if (f && typeof f.int === 'function') { const v = safe(() => f.int(n), null); if (v != null) return v; }
    return typeof n === 'number' && isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
  }
  function fmtSi(n) {
    const f = A() && A().fmt;
    if (f && typeof f.si === 'function') { const v = safe(() => f.si(n), null); if (v != null) return v; }
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(2) + ' T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + ' G';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + ' M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + ' K';
    return String(n);
  }
  // Cociente con 3 cifras significativas; desde 1,000 con separador de miles (3,814,995 → '3,810,000', no '3810000').
  function fmtRatio3(v) { const x = Number(v.toPrecision(3)); return Math.abs(x) >= 1000 ? fmtInt(x) : String(x); }
  // Cómputo con el prefijo pegado a la unidad, formato único de la app: '17.56 GMACs', '872 MACs'.
  function fmtOps(n, unit) {
    const u = unit || 'MACs';
    const f = A() && A().fmt;
    if (f && typeof f.ops === 'function') { const v = safe(() => f.ops(n, u), null); if (v != null) return v; }
    const s = fmtSi(n);
    const m = /^(.*) ([KMGTPE])$/.exec(s);
    return m ? m[1] + ' ' + m[2] + u : s + ' ' + u;
  }
  function shapeNum(t) {
    if (!t) return '—';
    const f = A() && A().fmt;
    if (f && typeof f.shape === 'function') { const v = safe(() => f.shape(t, 'num'), null); if (v) return v; }
    return arr(t.num).join('×') || '—';
  }
  function shapeSym(t) {
    if (!t) return '—';
    const f = A() && A().fmt;
    if (f && typeof f.shape === 'function') { const v = safe(() => f.shape(t, 'sym'), null); if (v) return v; }
    return arr(t.sym).map((s) => (/[+\-]/.test(String(s)) ? '(' + s + ')' : s)).join('×') || '—';
  }
  const elements = (t) => arr(t && t.num).reduce((p, x) => p * (Number(x) || 0), arr(t && t.num).length ? 1 : 0);

  const runCache = new Map();
  function run(cfgId) {
    const Ar = A();
    if (!Ar || typeof Ar.run !== 'function') return { error: 'no-arch' };
    if (!cfgId) return { error: 'Falta la configuración (config) del modelo.' };
    if (runCache.has(cfgId)) return runCache.get(cfgId);
    let out;
    try { const r = Ar.run(cfgId); out = r ? { run: r } : { error: 'La calculadora no devolvió resultado para "' + cfgId + '".' }; }
    catch (e) { out = { error: String(e && e.message || e) }; }
    runCache.set(cfgId, out);
    return out;
  }

  function catalogItem(id) { return safe(() => (ATLAS.catalog().items || {})[id], null); }
  function canonicalFor(model) {
    if (!model) return null;
    const Ar = A();
    const list = Ar && typeof Ar.configs === 'function' ? safe(() => Ar.configs(model), []) : [];
    const c = arr(list).find((x) => x && x.canonical) || arr(list)[0];
    if (c && c.id) return c.id;
    const it = catalogItem(model);
    return it && it.canonical ? it.canonical : null;
  }
  // Config de un bloque generado: la del bloque, la de la página (si es el mismo modelo) o la canónica.
  function configFor(b, ctx) {
    if (b.config) return b.config;
    if (ctx && ctx.config && (!b.model || !ctx.model || b.model === ctx.model)) return ctx.config;
    return canonicalFor(b.model || (ctx && ctx.model));
  }

  // Ops que pertenecen a un nodo del diagrama (por path; también op.node o el propio id).
  // Respeta las mismas marcas que el diagrama (archdiagram.js nodeOps): costOf, scope y opsExact, porque
  // desde la fase 2 hay ids de nodo repetidos (las dos torres de CLIP; W-MSA y SW-MSA en Swin).
  // El bloque op puede afinar con `scope` (p. ej. 'txt-encoder') o elegir el diagrama con `diagram`.
  function opsOfNode(r, nodeId, info, scopeOverride) {
    info = info || {};
    const extra = arr(info.ops);
    const pid = info.costOf || nodeId;
    const scope = scopeOverride || info.scope || null;
    return arr(r.ops).filter((o) => o && (extra.indexOf(o.id) >= 0 || (!info.opsExact && (
      (Array.isArray(o.path) && o.path.indexOf(pid) >= 0) || o.node === pid || o.id === pid) &&
      (!scope || (Array.isArray(o.path) && o.path.indexOf(scope) >= 0)))));
  }
  // Etiqueta / tipo de un nodo del diagrama del modelo (para títulos y colores de los bloques generados).
  function nodeInfo(model, nodeId, diagramId) {
    let all = safe(() => Object.values(ATLAS.diagrams()), []);
    if (diagramId) all = all.filter((d) => d && d.id === diagramId).concat(all.filter((d) => d && d.id !== diagramId));
    for (const d of all) {
      if (!d || (model && d.model && d.model !== model)) continue;
      const n = arr(d.nodes).find((x) => x && x.id === nodeId);
      if (n) return { label: n.label || nodeId, op: n.op || null, sub: n.sub || '', ops: arr(n.ops), costOf: n.costOf || null,
        scope: n.scope || null, opsExact: !!n.opsExact, diagram: d.id, page: d.page, section: d.section };
    }
    for (const d of all) {   // grupos (p. ej. 'encoder' con repeat L)
      if (!d || (model && d.model && d.model !== model)) continue;
      const g = arr(d.groups).find((x) => x && x.id === nodeId);
      if (g) return { label: g.label || nodeId, op: null, sub: '', ops: [], diagram: d.id, page: d.page, section: d.section, group: true };
    }
    return null;
  }
  // #página.sección~nodo, calificado (~diagrama.nodo) si el id se repite en la sección (SPEC §4.2).
  function nodeHrefFor(pageId, sectionId, nodeId, diagramId) {
    if (typeof ATLAS.nodeHref === 'function') { const v = safe(() => ATLAS.nodeHref(pageId, sectionId, nodeId, diagramId), null); if (v) return v; }
    return '#' + pageId + '.' + sectionId + '~' + nodeId;
  }
  // Etiqueta de nodo (puede traer subíndices TeX: 'Entrada z_{ℓ−1}') → texto plano o HTML con <sub>.
  const labelText = (l) => (typeof ATLAS.deTex === 'function' ? ATLAS.deTex(str(l)) : str(l).replace(/[{}]/g, ''));
  const labelHtml = (l) => ATLAS.dom.esc(str(l)).replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9ℓ])/g, '<sub>$1</sub>');
  function opColor(op) {
    const id = op && OP_TITLE[op] !== undefined ? op : null;
    return id ? { '--opc': 'var(--op-' + id + ')', '--opc-soft': 'var(--op-' + id + '-soft)' } : null;
  }

  function archError(kind, res, b) {
    if (res.error === 'no-arch') return missingComponent('calculadora', 'js/arch/primitives.js (ATLAS.Arch)');
    return warnBox('No se pudo generar el bloque "' + kind + '"' + (b && b.model ? ' de ' + b.model : ''), res.error);
  }

  // ------------------------------------------------------------------ cantidades en el texto ({{…}})
  const QRE = /\{\{\s*([^{}]+?)\s*\}\}/g;
  function fillText(s, ctx) {
    if (typeof s !== 'string' || s.indexOf('{{') < 0) return s;
    const Q = ATLAS.Quantities;
    if (Q && typeof Q.fill === 'function') {
      const v = safe(() => Q.fill(s, { config: ctx && ctx.config, model: ctx && ctx.model, pageId: ctx && ctx.pageId }), null);
      if (typeof v === 'string') return v;
    }
    // Sin el resolvedor (o si falló): aviso visible en lugar del número.
    return s.replace(QRE, (m, k) => '<mark class="q-warn" title="Cantidad sin resolver (falta js/core/quantities.js)">{{' + k.replace(/[<>&"]/g, '') + '}}</mark>');
  }
  // Copia del bloque con todas sus cadenas rellenadas (no toca ids ni claves).
  const NO_FILL = { t: 1, id: 1, block: 1, model: 1, config: 1, diagram: 1, walk: 1, kind: 1, in: 1, out: 1, from: 1, to: 1, pool: 1, configs: 1, models: 1, rows_keys: 1 };
  function fillDeep(x, ctx, key) {
    if (typeof x === 'string') return NO_FILL[key] ? x : fillText(x, ctx);
    if (Array.isArray(x)) return x.map((v) => fillDeep(v, ctx, key));
    if (x && typeof x === 'object') {
      const out = {};
      for (const k of Object.keys(x)) out[k] = fillDeep(x[k], ctx, k);
      return out;
    }
    return x;
  }
  const hasQ = (b) => { try { return JSON.stringify(b).indexOf('{{') >= 0; } catch (e) { return false; } };

  // ------------------------------------------------------------------ renderizadores (tipos de la Ronda)
  const R = {};

  R.p = (b) => htmlSpan('b-p', b.html, 'p');
  R.h3 = (b) => htmlSpan('b-h3', b.text != null ? b.text : b.html, 'h3');
  R.html = (b) => htmlSpan('b-html', b.html, 'div');

  R.list = (b) => h(b.ordered ? 'ol' : 'ul', { class: 'b-list' + (b.ordered ? ' b-list--ol' : '') },
    arr(b.items).map((it) => h('li', { html: str(it) })));

  R.callout = (b) => {
    const kind = CALLOUT_TITLES[b.kind] ? b.kind : 'note';
    const title = b.title || CALLOUT_TITLES[kind];
    return h('div', { class: 'callout callout--' + kind, role: 'note', 'aria-label': strip(title) },
      h('div', { class: 'callout__head' },
        h('span', { class: 'callout__icon', html: icon(CALLOUT_ICON[kind] || 'info') }),
        h('span', { class: 'callout__title', html: str(title) })),
      h('div', { class: 'callout__body', html: str(b.html) }));
  };

  function tableFigure(cls, caption, table, note, label) {
    return h('figure', { class: 'b-table' + (cls ? ' ' + cls : '') },
      caption ? h('figcaption', { class: 'b-table__cap', html: caption }) : null,
      h('div', { class: 'scroll-x', tabindex: '0', role: 'region', 'aria-label': (label || (caption ? strip(caption) : 'Tabla')) + ' (desplazable)' }, table),
      note ? (typeof note === 'string' ? h('div', { class: 'b-table__note', html: note }) : note) : null);
  }

  R.table = (b) => {
    const head = arr(b.head);
    const caption = b.caption ? str(b.caption) : '';
    const table = h('table', { class: 'dtable' },
      head.length ? h('thead', null, h('tr', null, head.map((c) => h('th', { scope: 'col', html: str(c) })))) : null,
      h('tbody', null, arr(b.rows).map((row) => h('tr', null, arr(row).map((c, j) =>
        j === 0 ? h('th', { scope: 'row', html: str(c) }) : h('td', { html: str(c) }))))));
    return tableFigure('', caption, table, b.note ? str(b.note) : null);
  };

  R.kv = (b) => h('dl', { class: 'kv' }, arr(b.items).map((it) => {
    const [k, v, note] = arr(it);
    return h('div', { class: 'kv__row' },
      h('dt', { class: 'kv__k', html: str(k) }),
      h('dd', { class: 'kv__v' },
        h('span', { class: 'kv__val', html: str(v) }),
        note ? h('span', { class: 'kv__note', html: str(note) }) : null));
  }));

  R.steps = (b) => h('ol', { class: 'steps' }, arr(b.items).map((it, i) =>
    h('li', { class: 'steps__item' },
      h('span', { class: 'steps__num', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', { class: 'steps__main' },
        h('div', { class: 'steps__head' },
          h('span', { class: 'steps__title', html: str(it.title) }),
          it.meta ? h('span', { class: 'steps__meta', html: str(it.meta) }) : null),
        it.html ? h('div', { class: 'steps__body', html: str(it.html) }) : null))));

  // Un valor que ya empieza con ≈, ~ o un signo de comparación no lleva "=" delante.
  const APPROX_START = /^(≈|~|≤|≥|≲|≳|<|>|&lt;|&gt;|&le;|&ge;|&asymp;|&sim;)/;
  const calcValue = (v) => {
    const html = str(v);
    const lead = html.replace(/<[^>]*>/g, '').trim();
    return h('div', { class: 'calc__value' },
      APPROX_START.test(lead) ? null : h('span', { class: 'calc__eq', 'aria-hidden': 'true' }, '='),
      h('span', { html }));
  };

  R.calc = (b) => h('figure', { class: 'calc' },
    h('figcaption', { class: 'calc__head' },
      h('span', { class: 'calc__icon', html: icon('approx') }),
      h('span', { class: 'calc__title', html: str(b.title || 'Cálculo a mano') }),
      h('span', { class: 'calc__tag' }, b.tag || 'Cálculo')),
    h('div', { class: 'calc__rows' }, arr(b.rows).map((r) =>
      h('div', { class: 'calc__row' },
        h('div', { class: 'calc__label' },
          h('span', { html: str(r.label) }),
          r.note ? h('span', { class: 'calc__note', html: str(r.note) }) : null),
        h('div', { class: 'calc__expr', html: str(r.expr) }),
        calcValue(r.value)))),
    b.result ? h('div', { class: 'calc__result' }, h('span', { class: 'calc__result-k' }, 'Resultado'), h('div', { class: 'calc__result-v', html: str(b.result) })) : null);

  R.qa = (b) => h('div', { class: 'qa' }, arr(b.items).map((it) =>
    h('div', { class: 'qa__item' + (it.trap ? ' qa__item--trap' : '') },
      h('div', { class: 'qa__row qa__row--q' }, h('span', { class: 'qa__k' }, it.trap ? 'Trampa' : 'Pregunta'), h('div', { class: 'qa__v qa__q', html: str(it.q) })),
      h('div', { class: 'qa__row qa__row--a' }, h('span', { class: 'qa__k' }, 'Respuesta'), h('div', { class: 'qa__v', html: str(it.a) })),
      it.why ? h('div', { class: 'qa__row qa__row--why' }, h('span', { class: 'qa__k' }, 'Por qué importa'), h('div', { class: 'qa__v', html: str(it.why) })) : null,
      it.say ? h('div', { class: 'qa__row qa__row--say' }, h('span', { class: 'qa__k' }, 'Dilo así'), h('div', { class: 'qa__v', lang: 'en', html: str(it.say) })) : null)));

  R.followups = (b) => h('div', { class: 'fu' }, arr(b.items).map((it) =>
    h('div', { class: 'fu__item' + (it.trap ? ' fu__item--trap' : '') },
      h('div', { class: 'fu__q' }, h('span', { class: 'fu__who' }, it.trap ? 'Entrevistador · trampa' : 'Entrevistador'), h('div', { class: 'fu__qtext', html: str(it.q) })),
      h('div', { class: 'fu__cols' },
        h('div', { class: 'fu__col fu__col--junior' }, h('div', { class: 'fu__label' }, h('span', { class: 'fu__mark', html: icon('close') }), 'Nivel junior'), h('div', { class: 'fu__text', html: str(it.junior) })),
        h('div', { class: 'fu__col fu__col--senior' }, h('div', { class: 'fu__label' }, h('span', { class: 'fu__mark', html: icon('check') }), 'Nivel senior'), h('div', { class: 'fu__text', html: str(it.senior) }),
          // say (opcional): la respuesta senior en inglés, en una o dos frases, para decirla tal cual
          it.say ? h('p', { class: 'fu__say' }, h('span', { class: 'fu__say-k' }, 'Dilo así'), h('span', { lang: 'en', html: str(it.say) })) : null)),
      it.why ? h('div', { class: 'fu__why' }, h('span', { class: 'fu__why-k' }, 'Por qué puntúa'), h('div', { html: str(it.why) })) : null)));

  R.tradeoffs = (b) => h('div', { class: 'to' }, arr(b.items).map((it) => {
    const v = VERDICT[it.verdict] ? it.verdict : 'depende';
    return h('div', { class: 'to__item to__item--' + v },
      h('div', { class: 'to__head' },
        h('span', { class: 'to__option', html: str(it.option) }),
        h('span', { class: 'verdict verdict--' + v }, VERDICT[v])),
      h('div', { class: 'to__cols' },
        h('div', { class: 'to__col to__col--pro' }, h('div', { class: 'to__k' }, 'A favor'), h('div', { class: 'to__v', html: str(it.pros || '—') })),
        h('div', { class: 'to__col to__col--con' }, h('div', { class: 'to__k' }, 'En contra'), h('div', { class: 'to__v', html: str(it.cons || '—') }))),
      it.why ? h('div', { class: 'to__why' }, h('span', { class: 'to__k' }, 'Por qué'), h('div', { class: 'to__v', html: str(it.why) })) : null);
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
        input, h('label', { for: inputId, class: 'checklist__label', html: str(it.html) }));
    }));
    const wrap = h('div', { class: 'checklist', dataset: { list: listId } },
      h('div', { class: 'checklist__head' }, h('span', { class: 'checklist__title' }, b.title || 'Checklist'), bar, count),
      list);
    update();
    return wrap;
  };

  let quizSeq = 0;
  R.quiz = (b, ctx) => {
    const base = 'qz-' + ((ctx && ctx.pageId) || 'x') + '-' + ((ctx && ctx.sectionId) || 'x') + '-' + (++quizSeq);
    return h('div', { class: 'quiz' }, arr(b.items).map((it, qi) => {
      const fb = h('div', { class: 'quiz__fb', 'aria-live': 'polite' });
      const qid = base + '-' + qi;
      const opts = arr(it.options).map((o, oi) => h('button', {
        type: 'button', class: 'quiz__opt', dataset: { i: oi },
        on: { click: () => choose(oi) },
      }, h('span', { class: 'quiz__letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + oi)), h('span', { class: 'quiz__text', html: str(o) })));
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
        if (it.explain) { const ex = h('div', { class: 'quiz__explain', html: str(it.explain) }); fb.appendChild(decorate(ex)); typeset(ex); }
        retry.hidden = false;
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
          h('div', { html: str(it.q) })),
        h('div', { class: 'quiz__opts' }, opts),
        fb, retry);
    }));
  };

  // Código: visor simple (pestañas si hay varios archivos, botón Copiar). Sin resaltado de sintaxis.
  let codeSeq = 0;
  R.code = (b) => {
    const files = arr(b.files).filter((f) => f && typeof f === 'object');
    if (!files.length && typeof b.code === 'string') files.push({ name: b.title || 'código', lang: b.lang || '', code: b.code });
    const n = ++codeSeq;
    const panels = files.map((f, i) => {
      const text = typeof f.code === 'string' ? f.code : '';
      const pre = h('pre', { class: 'code__pre', tabindex: '0' }, h('code', { class: 'no-tex' }, text || (f.src ? '(archivo de referencia no incluido: ' + f.src + ')' : '')));
      const copy = h('button', { type: 'button', class: 'btn btn--sm btn--ghost code__copy', on: { click: () => {
        ATLAS.dom.copyText(text, pre).then((ok) => { copy.lastChild.textContent = ok ? 'Copiado' : 'Selecciona y copia'; setTimeout(() => { copy.lastChild.textContent = 'Copiar'; }, 2000); });
      } } }, h('span', { html: icon('copy') }), h('span', null, 'Copiar'));
      return h('div', { class: 'code__panel', id: 'code-' + n + '-' + i, role: files.length > 1 ? 'tabpanel' : null, hidden: i > 0 },
        h('div', { class: 'code__bar' }, h('span', { class: 'code__name mono' }, str(f.name || 'código')), f.lang ? h('span', { class: 'code__lang' }, str(f.lang)) : null, copy),
        pre,
        f.note ? h('div', { class: 'code__note', html: str(f.note) }) : null);
    });
    let tabs = null;
    if (files.length > 1) {
      const btns = files.map((f, i) => h('button', {
        type: 'button', role: 'tab', class: 'code__tab', 'aria-selected': String(i === 0), 'aria-controls': 'code-' + n + '-' + i, tabindex: i === 0 ? '0' : '-1',
        on: { click: () => select(i), keydown: (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const j = (i + (e.key === 'ArrowRight' ? 1 : files.length - 1)) % files.length; select(j); btns[j].focus(); } } },
      }, str(f.name || 'archivo ' + (i + 1))));
      const select = (i) => { btns.forEach((x, j) => { x.setAttribute('aria-selected', String(i === j)); x.tabIndex = i === j ? 0 : -1; }); panels.forEach((p, j) => { p.hidden = i !== j; }); };
      tabs = h('div', { class: 'code__tabs', role: 'tablist', 'aria-label': 'Archivos' }, btns);
    }
    return h('figure', { class: 'code' },
      b.title ? h('figcaption', { class: 'b-table__cap', html: str(b.title) }) : null,
      tabs, panels,
      b.caption ? h('div', { class: 'b-table__note', html: str(b.caption) }) : null);
  };

  // ------------------------------------------------------------------ math (§5.4)
  R.math = (b) => {
    const display = b.display !== false;
    const box = h('div', { class: 'b-math__tex' + (display ? '' : ' is-inline') });
    if (ATLAS.MathTex && typeof ATLAS.MathTex.render === 'function') ATLAS.MathTex.render(str(b.tex), box, { display });
    else box.appendChild(h('code', { class: 'tex-fallback', title: 'Fórmula sin componer (falta js/ui/math.js)' }, str(b.tex)));
    return h('figure', { class: 'b-math' }, box, b.caption ? h('figcaption', { class: 'b-math__cap', html: str(b.caption) }) : null);
  };

  // ------------------------------------------------------------------ op: tarjeta por bloque (§5.4, sección 4)
  function shapeLine(r, ids, label) {
    const list = arr(ids);
    if (!list.length) return null;
    return h('div', { class: 'opc__io-row' },
      h('dt', null, label),
      h('dd', null, list.map((id) => {
        const t = r.tensors && r.tensors[id];
        if (!t) return h('span', { class: 'opc__shape is-missing', title: 'Tensor desconocido en la calculadora' }, id + ': ?');
        return h('span', { class: 'opc__shape', dataset: { tensor: id } },
          t.tex ? h('span', { class: 'opc__tname' }, tex(t.tex)) : h('span', { class: 'opc__tname mono' }, id),
          h('span', { class: 'opc__sym mono' }, shapeSym(t)),
          h('span', { class: 'opc__eq', 'aria-hidden': 'true' }, '='),
          h('span', { class: 'opc__num mono' }, shapeNum(t)));
      })));
  }

  R.op = (b, ctx) => {
    const cfg = configFor(b, ctx);
    const res = run(cfg);
    if (!res.run) return archError('op', res, b);
    const r = res.run;
    const model = b.model || r.model || (ctx && ctx.model);
    const info = nodeInfo(model, b.block, b.diagram) || {};
    const ops = opsOfNode(r, b.block, info, b.scope);
    const pageId = (ctx && ctx.pageId) || '';
    const sectionId = (ctx && ctx.sectionId) || 'operaciones';
    const perCall = ops.reduce((s, o) => ({ p: s.p + (o.params || 0), m: s.m + (o.macs || 0) }), { p: 0, m: 0 });
    const byNode = !info.opsExact && !info.scope && !b.scope && !info.costOf && r.totals && r.totals.byNode && r.totals.byNode[b.block];
    const total = byNode || ops.reduce((s, o) => ({ params: s.params + (o.params || 0) * pRep(o), macs: s.macs + (o.macs || 0) * (o.repeat || 1) }), { params: 0, macs: 0 });
    const reps = Array.from(new Set(ops.map((o) => o.repeat || 1)));
    const rep = reps.length === 1 ? reps[0] : null;
    // pesos compartidos (fase 7: LLaVA con varias imágenes): las copias de los pesos (paramRepeat) ≠ ejecuciones (repeat)
    const preps = Array.from(new Set(ops.map(pRep)));
    const prep = preps.length === 1 ? preps[0] : null;
    const showP = b.params === true || (b.params !== false && total.params > 0);
    const showM = b.flops === true || (b.flops !== false && total.macs > 0);
    const page = safe(() => ATLAS.getPage(pageId), null);
    // El nodo puede vivir en otra sección (p. ej. el diagrama de Deformable DETR está en 'variantes').
    const diagSection = (info.page === pageId && info.section) || 'diagrama';
    const hasDiagram = page && arr(page.sections).some((s) => s.id === diagSection);

    const head = h('header', { class: 'opc__head' },
      info.op ? h('span', { class: 'opc__type' }, OP_TITLE[info.op] || info.op) : null,
      h('h3', { class: 'opc__title', html: b.title ? str(b.title) : info.label ? labelHtml(info.label) : str(b.block) }),
      hasDiagram ? h('a', { class: 'opc__diag', href: nodeHrefFor(pageId, diagSection, b.block, info.diagram) }, h('span', { html: icon('diagram') }), 'Ver en el diagrama') : null);

    const counts = [];
    const rows = ops.filter((o) => (showP && o.params) || (showM && o.macs));
    const other = ops.reduce((x, o) => x + (o.other || 0) * (o.repeat || 1), 0);
    if ((showP || showM) && ops.length) {
      if (rows.length) {
      const table = h('table', { class: 'dtable dtable--num opc__table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Operación'),
          showP ? h('th', { scope: 'col' }, 'Parámetros') : null,
          showM ? h('th', { scope: 'col' }, 'MACs') : null)),
        h('tbody', null, rows.map((o) => h('tr', null,
          h('th', { scope: 'row' }, h('span', null, str(o.label || o.id)), h('span', { class: 'opc__prim mono' }, str(o.prim || ''))),
          showP ? h('td', null, o.params ? [h('div', { class: 'opc__ftex' }, o.paramTex ? tex(o.paramTex) : ''), h('div', { class: 'opc__arith mono' }, str(o.paramArith || fmtInt(o.params)))] : h('span', { class: 'muted' }, '0')) : null,
          showM ? h('td', null, o.macs ? [h('div', { class: 'opc__ftex' }, o.macTex ? tex(o.macTex) : ''), h('div', { class: 'opc__arith mono' }, str(o.macArith || fmtInt(o.macs)))] : h('span', { class: 'muted' }, '0')) : null))));
      counts.push(h('div', { class: 'scroll-x opc__scroll', tabindex: '0', role: 'region', 'aria-label': 'Conteo de ' + strip(b.title || labelText(info.label) || b.block) + ' (desplazable)' }, table));
      }
      const sum = [];
      if (showP) sum.push(h('span', { class: 'opc__sum-item' }, h('span', { class: 'opc__k' }, 'Parámetros'), h('b', { class: 'mono' }, fmtInt(prep && prep > 1 ? perCall.p : total.params)), prep && prep > 1 ? h('span', { class: 'muted' }, ' por capa · × ' + prep + ' = ', h('b', { class: 'mono' }, fmtInt(total.params))) : null));
      if (showM) sum.push(h('span', { class: 'opc__sum-item' }, h('span', { class: 'opc__k' }, 'MACs'), h('b', { class: 'mono' }, fmtInt(rep && rep > 1 ? perCall.m : total.macs)), rep && rep > 1 ? h('span', { class: 'muted' }, ' por capa · × ' + rep + ' = ', h('b', { class: 'mono' }, fmtOps(total.macs))) : h('span', { class: 'muted mono' }, ' (' + fmtOps(total.macs) + ')')));
      if (other > 0) sum.push(h('span', { class: 'opc__sum-item muted' }, h('span', { class: 'opc__k' }, 'Otros (≈)'), h('span', { class: 'mono' }, fmtSi(other)), ' elementwise, fuera del total de MACs'));
      counts.push(h('div', { class: 'opc__sum' }, sum));
    } else if (!ops.length) {
      counts.push(h('p', { class: 'opc__none muted' }, 'Sin parámetros ni MACs propios en la calculadora (operación de tensor).'));
    }

    const el = h('article', {
      class: 'opc', id: pageId ? pageId + '.' + sectionId + '.' + b.block : null,
      style: opColor(info.op), dataset: { node: b.block, model: model || '' },
      'aria-label': strip(b.title || labelText(info.label) || b.block),
    },
    head,
    b.tex ? h('div', { class: 'opc__tex' }, '\\[' + str(b.tex) + '\\]') : null,
    h('dl', { class: 'opc__io' }, shapeLine(r, b.in, 'Entrada'), shapeLine(r, b.out, 'Salida')),
    b.what ? h('div', { class: 'opc__txt' }, h('span', { class: 'opc__k' }, 'Qué hace'), h('div', { html: str(b.what) })) : null,
    b.why ? h('div', { class: 'opc__txt opc__txt--why' }, h('span', { class: 'opc__k' }, 'Por qué'), h('div', { html: str(b.why) })) : null,
    counts.length ? h('div', { class: 'opc__counts' }, counts) : null);
    return el;
  };

  // ------------------------------------------------------------------ trace: recorrido numérico (§5.4)
  function producerOf(r, t) { return t && t.producer ? arr(r.ops).find((o) => o.id === t.producer) || null : null; }

  R.trace = (b, ctx) => {
    const cfg = configFor(b, ctx);
    const res = run(cfg);
    if (!res.run) return archError('trace', res, b);
    const r = res.run;
    let order = arr(r.order).length ? arr(r.order).slice() : Object.keys(r.tensors || {});
    if (b.from) { const i = order.indexOf(b.from); if (i >= 0) order = order.slice(i); }
    if (b.to) { const i = order.indexOf(b.to); if (i >= 0) order = order.slice(0, i + 1); }
    const model = b.model || r.model;
    const pageId = (ctx && ctx.pageId) || '';
    const rows = [];
    let step = 0;
    let lastLayerRep = 0;
    const layerRow = (rep) => h('tr', { class: 'trace__layers' },
      h('td', { colspan: '6' }, h('span', { html: icon('layers') }),
        h('span', null, 'Las otras ' + (rep - 1) + ' capas repiten esta secuencia con las mismas formas (× ' + rep + ' en total); la salida de cada capa es la entrada de la siguiente.')));
    order.forEach((id, i) => {
      const t = r.tensors && r.tensors[id];
      if (!t) return;
      const op = producerOf(r, t);
      const rep = t.perLayer ? (op && op.repeat) || 0 : 0;
      if (lastLayerRep > 1 && !t.perLayer) { rows.push(layerRow(lastLayerRep)); lastLayerRep = 0; }
      if (t.perLayer && rep > lastLayerRep) lastLayerRep = rep;
      step++;
      const node = op && Array.isArray(op.path) && op.path.length ? op.path[op.path.length - 1] : (op && op.node) || null;
      const note = [];
      if (t.perLayer) note.push('capa 1 de ' + (rep || 'L'));
      if (t.note) note.push(str(t.note));
      rows.push(h('tr', {
        class: 'trace__row', dataset: { tensor: id, node: node || '' }, tabindex: '0',
        'aria-label': 'Resaltar ' + (t.label || id) + ' en el diagrama',
      },
      h('td', { class: 'num trace__step' }, String(step)),
      h('th', { scope: 'row', class: 'trace__th' }, h('span', { class: 'trace__t' },
        t.tex ? h('span', { class: 'trace__tex' }, tex(t.tex)) : null, h('span', { class: 'trace__id mono' }, id), t.label ? h('span', { class: 'trace__label' }, str(t.label)) : null)),
      h('td', { class: 'trace__op' }, op ? [h('span', null, str(op.label || op.id)), op.prim ? h('span', { class: 'trace__prim mono' }, str(op.prim)) : null] : h('span', { class: 'muted' }, i === 0 ? 'entrada' : '—')),
      h('td', { class: 'mono trace__sym' }, shapeSym(t)),
      h('td', { class: 'mono trace__num' }, shapeNum(t)),
      h('td', { class: 'num trace__el' }, fmtInt(elements(t)), note.length ? h('span', { class: 'trace__note' }, note.join(' · ')) : null)));
    });
    if (lastLayerRep > 1) rows.push(layerRow(lastLayerRep));
    const table = h('table', { class: 'dtable dtable--num trace' },
      h('thead', null, h('tr', null, ['#', 'Tensor (fórmula)', 'Operación', 'Forma simbólica', 'Forma numérica', 'Elementos'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows));
    const label = h('span', null, 'Recorrido con números · ', h('span', { class: 'mono' }, str(r.label || cfg)));
    const fig = tableFigure('b-trace', null, table,
      h('div', { class: 'b-table__note' }, 'Formas sin batch (', h('span', { class: 'mono' }, 'tokens × canales'), '). Toca una fila para resaltar ese tensor en el diagrama de la página.'),
      'Recorrido con números de ' + str(r.label || cfg));
    fig.insertBefore(h('figcaption', { class: 'b-table__cap' }, label), fig.firstChild);
    fig.dataset.model = model || '';
    const activate = (tr) => {
      if (!tr || !tr.dataset.tensor) return;
      fig.querySelectorAll('.trace__row.is-active').forEach((x) => x.classList.remove('is-active'));
      tr.classList.add('is-active');
      highlightInDiagrams(pageId, model, { tensors: [tr.dataset.tensor] });
    };
    table.addEventListener('click', (e) => activate(e.target.closest && e.target.closest('.trace__row')));
    table.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const tr = e.target.closest && e.target.closest('.trace__row'); if (tr) { e.preventDefault(); activate(tr); } } });
    return fig;
  };

  // Resalta en los diagramas de la página (mismo modelo) sin mover la vista.
  function highlightInDiagrams(pageId, model, sel) {
    const scope = (pageId && document.getElementById('page')) || document;
    for (const c of controllers(scope, 'diagram')) {
      const spec = safe(() => ATLAS.diagram(c.diagram), null);
      if (model && spec && spec.model && spec.model !== model) continue;
      if (c.ctrl && typeof c.ctrl.highlight === 'function') safe(() => c.ctrl.highlight(Object.assign({ nodes: [], edges: [], tensors: [] }, sel)), null);
    }
  }

  // Marca en las tablas trace las filas de estos tensores (lo usa el recorrido del diagrama).
  function markTrace(tensorIds, scope) {
    const ids = new Set(arr(tensorIds));
    (scope || document).querySelectorAll('.b-trace .trace__row').forEach((tr) => tr.classList.toggle('is-walk', ids.has(tr.dataset.tensor)));
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('atlas:walkstep', (e) => { const d = (e && e.detail) || {}; markTrace(d.tensors || []); });
  }

  // ------------------------------------------------------------------ params / flops: tablas generadas (§5.4)
  // Agrupa las ops por nodo: 'block' = path[0]; 'layer' = como 'block', pero las capas repetidas se
  // abren en sus sub-bloques (path[2]: ln1, mhsa, ln2, mlp…); 'op' = cada op.
  function groupOps(r, group) {
    const groups = [];
    const byKey = new Map();
    for (const o of arr(r.ops)) {
      const path = Array.isArray(o.path) && o.path.length ? o.path : [o.node || o.id];
      const key = group === 'op' ? o.id : group === 'layer' ? ((o.repeat || 1) > 1 && path.length > 2 ? path[2] : path[0]) : path[0];
      let g = byKey.get(key);
      if (!g) { g = { key, ops: [], params: 0, macs: 0 }; byKey.set(key, g); groups.push(g); }
      g.ops.push(o);
      g.params += (o.params || 0) * pRep(o);
      g.macs += (o.macs || 0) * (o.repeat || 1);
    }
    return groups;
  }
  function groupName(model, g, group, cfgId) {
    if (group === 'op' || g.ops.length === 1 && !nodeInfo(model, g.key)) return str(g.ops[0].label || g.key);
    const info = nodeInfo(model, g.key);
    if (!info) return g.key;
    // Etiquetas de nodo con {{cfg.…}} (VLMs: "LLM decoder ({{cfg.llmLabel}})"): se llenan con la config de la tabla.
    let lab = info.label;
    if (cfgId && typeof lab === 'string' && lab.indexOf('{{') >= 0 && ATLAS.Quantities) {
      lab = String(lab).replace(/\{\{\s*(cfg|metrics|q|tensor|node)\.([^}]+?)\s*\}\}/g, (m, h0, rest) => {
        const q = ATLAS.Quantities.get(cfgId + '.' + h0 + '.' + rest); return q ? q.text : m;
      });
    }
    return labelText(lab);
  }
  // Fórmula de un grupo: la de su op si es una; si son pocas, sumadas; si no, un detalle desplegable.
  function groupFormula(g, which) {
    const texKey = which === 'params' ? 'paramTex' : 'macTex';
    const valKey = which === 'params' ? 'params' : 'macs';
    const ops = g.ops.filter((o) => o[valKey] > 0 && o[texKey]);
    if (!ops.length) return h('span', { class: 'muted' }, '—');
    const nRep = (o) => (which === 'params' ? pRep(o) : o.repeat || 1);
    const reps = Array.from(new Set(ops.map(nRep)));
    const rep = reps.length === 1 && reps[0] > 1 ? reps[0] : 0;
    if (ops.length <= 2) {
      const body = ops.map((o) => o[texKey]).join(' + ');
      return h('span', { class: 'ptab__tex' }, tex(rep ? rep + ' \\times (' + body + ')' : body));
    }
    return h('details', { class: 'ptab__det' },
      h('summary', null, (rep ? '× ' + rep + ' · ' : '') + ops.length + ' operaciones'),
      h('ul', null, ops.map((o) => h('li', null, h('span', { class: 'ptab__oplabel' }, str(o.label || o.id)), ' ', h('span', { class: 'ptab__tex' }, tex(o[texKey])),
        h('span', { class: 'mono muted' }, ' = ' + fmtInt(o[valKey]) + (nRep(o) > 1 ? ' × ' + nRep(o) : ''))))));
  }
  const pct = (x, tot) => (tot > 0 ? (x / tot * 100) : 0);
  const pctTxt = (x, tot) => { const p = pct(x, tot); return p === 0 ? '0 %' : p < 0.1 ? '< 0.1 %' : p >= 99.95 && p < 100 ? '> 99.9 %' : p.toFixed(1) + ' %'; };
  function pctBar(x, tot) {
    return h('span', { class: 'pbar', 'aria-hidden': 'true' }, h('i', { style: { width: Math.max(0.5, Math.min(100, pct(x, tot))).toFixed(1) + '%' } }));
  }

  R.params = (b, ctx) => {
    const cfg = configFor(b, ctx);
    const res = run(cfg);
    if (!res.run) return archError('params', res, b);
    const r = res.run;
    const model = b.model || r.model;
    const group = ['block', 'layer', 'op'].indexOf(b.group) >= 0 ? b.group : 'block';
    const groups = groupOps(r, group).filter((g) => g.params > 0);
    const total = r.totals && typeof r.totals.params === 'number' ? r.totals.params : groups.reduce((s, g) => s + g.params, 0);
    const sum = groups.reduce((s, g) => s + g.params, 0);
    const rows = groups.map((g) => h('tr', { dataset: { node: g.key } },
      h('th', { scope: 'row' }, groupName(model, g, group, r.id)),
      h('td', null, groupFormula(g, 'params')),
      h('td', { class: 'num' }, fmtInt(g.params)),
      h('td', { class: 'num ptab__pct' }, pctBar(g.params, total), pctTxt(g.params, total))));
    if (sum !== total) {
      rows.push(h('tr', { class: 'ptab__diff' }, h('th', { scope: 'row' }, 'Sin asignar a un bloque'), h('td', null, h('span', { class: 'muted' }, 'diferencia con el total')), h('td', { class: 'num' }, fmtInt(total - sum)), h('td', { class: 'num' }, pctTxt(total - sum, total))));
    }
    const table = h('table', { class: 'dtable dtable--num ptab' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, group === 'op' ? 'Operación' : 'Bloque'), h('th', { scope: 'col' }, 'Fórmula'), h('th', { scope: 'col', class: 'num' }, 'Parámetros'), h('th', { scope: 'col', class: 'num' }, '% del total'))),
      h('tbody', null, rows),
      h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, 'Total'), h('td', null, h('span', { class: 'mono muted' }, fmtSi(total))), h('td', { class: 'num' }, h('b', null, fmtInt(total))), h('td', { class: 'num' }, '100 %'))));
    return tableFigure('b-ptab', 'Parámetros · ' + str(r.label || cfg), table,
      'Enteros exactos de la calculadora (sesgos incluidos cuando la implementación de referencia los tiene; los buffers fijos no cuentan). Las capas repetidas ya están multiplicadas.');
  };

  R.flops = (b, ctx) => {
    const cfg = configFor(b, ctx);
    const res = run(cfg);
    if (!res.run) return archError('flops', res, b);
    const r = res.run;
    const model = b.model || r.model;
    const group = ['block', 'layer', 'op'].indexOf(b.group) >= 0 ? b.group : 'block';
    const groups = groupOps(r, group).filter((g) => g.macs > 0);
    const total = r.totals && typeof r.totals.macs === 'number' ? r.totals.macs : groups.reduce((s, g) => s + g.macs, 0);
    const other = r.totals && typeof r.totals.other === 'number' ? r.totals.other : 0;
    const table = h('table', { class: 'dtable dtable--num ptab' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, group === 'op' ? 'Operación' : 'Bloque'), h('th', { scope: 'col' }, 'Fórmula (MACs)'), h('th', { scope: 'col', class: 'num' }, 'MACs'), h('th', { scope: 'col', class: 'num' }, 'FLOPs (= 2 × MACs)'), h('th', { scope: 'col', class: 'num' }, '% del total'))),
      h('tbody', null, groups.map((g) => h('tr', { dataset: { node: g.key } },
        h('th', { scope: 'row' }, groupName(model, g, group, r.id)),
        h('td', null, groupFormula(g, 'macs')),
        h('td', { class: 'num' }, fmtInt(g.macs)),
        h('td', { class: 'num' }, fmtInt(2 * g.macs)),
        h('td', { class: 'num ptab__pct' }, pctBar(g.macs, total), pctTxt(g.macs, total))))),
      h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, 'Total'), h('td', null, h('span', { class: 'mono muted' }, fmtOps(total) + ' · ' + fmtOps(2 * total, 'FLOPs'))), h('td', { class: 'num' }, h('b', null, fmtInt(total))), h('td', { class: 'num' }, fmtInt(2 * total)), h('td', { class: 'num' }, '100 %'))));
    const note = h('div', { class: 'b-table__note' },
      h('b', null, 'Convención: '), 'MACs = multiplicaciones-acumulaciones de matmuls y convoluciones (', h('span', { class: 'mono' }, 'm·n·k'), ' para ', h('span', { class: 'mono' }, 'm×k · k×n'), '); FLOPs = 2 × MACs. ',
      'Muchos papers y herramientas (fvcore, las tablas de DeiT/Swin) llaman «FLOPs» a lo que son MACs: compara siempre la misma unidad. ',
      other > 0 ? ['Las operaciones elementwise, softmax, normas y activaciones (≈ ', h('span', { class: 'mono' }, fmtSi(other)), ') no entran en el total.'] : 'Las operaciones elementwise, softmax, normas y activaciones no entran en el total.');
    return tableFigure('b-ptab', 'Costo de cómputo · ' + str(r.label || cfg), table, note);
  };

  // ------------------------------------------------------------------ compare: tabla lado a lado (§5.4)
  const METRICS = {
    params: { label: 'Parámetros', get: (r) => r.totals && r.totals.params, fmt: 'int' },
    paramsM: { label: 'Parámetros (M)', get: (r) => r.totals && r.totals.params, fmt: 'si' },
    macs: { label: 'MACs', get: (r) => r.totals && r.totals.macs, fmt: 'si', unit: 'MACs' },
    flops: { label: 'FLOPs (= 2 × MACs)', get: (r) => r.totals && (r.totals.flops || 2 * r.totals.macs), fmt: 'si', unit: 'FLOPs' },
    tokens: { label: 'Tokens', get: (r) => r.quantities && r.quantities.tokens, fmt: 'int' },
    patches: { label: 'Patches', get: (r) => r.quantities && r.quantities.patches, fmt: 'int' },
    D: { label: 'Ancho D', get: (r) => r.config && r.config.D, fmt: 'int' },
    L: { label: 'Capas L', get: (r) => r.config && r.config.L, fmt: 'int' },
    h: { label: 'Heads h', get: (r) => r.config && r.config.h, fmt: 'int' },
    Dmlp: { label: 'MLP D_mlp', get: (r) => r.config && r.config.Dmlp, fmt: 'int' },
    Ld: { label: 'Capas del decoder L_d', get: (r) => r.config && r.config.Ld, fmt: 'int' },
    nMels: { label: 'Bandas log-Mel n_mels', get: (r) => r.config && r.config.nMels, fmt: 'int' },
    E: { label: 'Dimensión del embedding compartido E', get: (r) => r.config && r.config.E, fmt: 'int' },
    // retrieval: el cross-encoder no guarda embeddings (da un puntaje por par): «—», como en las fichas de práctica.
    dim: { label: 'Dimensión del embedding guardado', get: (r) => (r.config && r.config.kind === 'cross' ? null : r.config && r.config.dim), fmt: 'int' },
    // En SAM, P son clics del prompt (el patch es 16); en SAM 2, el P de la página son punteros de objeto.
    P: { label: 'Patch P', labels: { sam: 'Clics P' }, get: (r) => r.config && r.config.P, fmt: 'int' },
    ptrs: { label: 'Punteros de objeto P', get: (r) => r.config && r.config.ptrs, fmt: 'int' },
    memFrames: { label: 'Frames recientes N_r', get: (r) => r.config && r.config.memFrames, fmt: 'int' },
    res: { label: 'Resolución', get: (r) => r.config && r.config.H ? r.config.H + '×' + (r.config.W || r.config.H) : null, fmt: 'raw' },
    Q: { label: 'Object queries Q', get: (r) => r.config && r.config.Q, fmt: 'int' },
    // LLM (fase 6): G = cabezas de KV en el calculador (nKV es su alias de perilla).
    nKV: { label: 'Cabezas KV n_KV (G)', get: (r) => r.config && (r.config.G != null ? r.config.G : r.config.nKV), fmt: 'int' },
    G: { label: 'Cabezas KV n_KV (G)', get: (r) => r.config && (r.config.G != null ? r.config.G : r.config.nKV), fmt: 'int' },
    V: { label: 'Vocabulario V', get: (r) => r.config && r.config.V, fmt: 'int' },
    activeParams: { label: 'Parámetros activos por token', get: (r) => r.quantities && r.quantities.activeParams, fmt: 'int' },
    kvBytesPerToken: { label: 'KV cache por token', get: (r) => r.quantities && r.quantities.kvBytesPerToken, fmt: 'bytes' },
    // VLMs (fase 7): de metrics() si no están en quantities.
    visualTokens: { label: 'Tokens visuales N', get: (r) => vlmMetric(r, 'visualTokens'), fmt: 'int' },
    kvBytesPerImage: { label: 'KV cache por imagen', get: (r) => vlmMetric(r, 'kvBytesPerImage'), fmt: 'bytes' },
    visionMacs: { label: 'MACs de la torre de visión', get: (r) => vlmMetric(r, 'visionMacs'), fmt: 'si', unit: 'MACs' },
    llmPrefillMacs: { label: 'MACs del prefill del LLM', get: (r) => vlmMetric(r, 'llmPrefillMacs'), fmt: 'si', unit: 'MACs' },
    visionParams: { label: 'Parámetros de visión', get: (r) => vlmMetric(r, 'visionParams'), fmt: 'si' },
    llmParams: { label: 'Parámetros del LLM', get: (r) => vlmMetric(r, 'llmParams'), fmt: 'si' },
    // Difusión (fase 8): por evaluación de la red (NFE) y por imagen.
    unetParams: { label: 'Parámetros de la U-Net', get: (r) => vlmMetric(r, 'unetParams'), fmt: 'si' },
    ditParams: { label: 'Parámetros del DiT', get: (r) => vlmMetric(r, 'ditParams'), fmt: 'si' },
    unetMacs: { label: 'MACs por NFE (U-Net)', get: (r) => vlmMetric(r, 'unetMacs'), fmt: 'si', unit: 'MACs' },
    ditMacs: { label: 'MACs por NFE (DiT)', get: (r) => vlmMetric(r, 'ditMacs'), fmt: 'si', unit: 'MACs' },
    scoreShareDit: { label: 'QKᵀ y A·V (% de los MACs por NFE)', get: (r) => vlmMetric(r, 'scoreShareDit'), fmt: 'pct' },
    selfScoreShareUnet: { label: 'Self-attention: QKᵀ y A·V (% de los MACs por NFE)', get: (r) => vlmMetric(r, 'selfScoreShareUnet'), fmt: 'pct' },
    denoiserSamplingShare: { label: 'Parte de la red en la imagen', get: (r) => vlmMetric(r, 'denoiserSamplingShare'), fmt: 'pct' },
    vaeDecoderMacs: { label: 'MACs del decoder del VAE', get: (r) => vlmMetric(r, 'vaeDecoderMacs'), fmt: 'si', unit: 'MACs' },
    textEncoderParams: { label: 'Parámetros del text encoder', get: (r) => vlmMetric(r, 'textEncoderParams'), fmt: 'si' },
    sequentialPasses: { label: 'Pasadas secuenciales', get: (r) => vlmMetric(r, 'sequentialPasses'), fmt: 'int' },
    msPerImage: { label: 'ms por imagen (≈ cota, H100)', get: (r) => vlmMetric(r, 'msPerImage'), fmt: 'ms' },
    nfe: { label: 'Evaluaciones (NFE)', get: (r) => vlmMetric(r, 'nfe'), fmt: 'int' },
    samplingMacs: { label: 'MACs por imagen', get: (r) => vlmMetric(r, 'samplingMacs'), fmt: 'si', unit: 'MACs' },
    latentTokens: { label: 'Tokens del latente', get: (r) => vlmMetric(r, 'latentTokens'), fmt: 'int' },
    // VLA (fase 9).
    macsPerAction: { label: 'MACs por acción', get: (r) => vlmMetric(r, 'macsPerAction'), fmt: 'si', unit: 'MACs' },
    macsPerChunk: { label: 'MACs por chunk', get: (r) => vlmMetric(r, 'macsPerChunk'), fmt: 'si', unit: 'MACs' },
    actionTokensPerStep: { label: 'Tokens de acción por paso', get: (r) => vlmMetric(r, 'actionTokensPerStep'), fmt: 'int' },
    prefixTokens: { label: 'Tokens del prefijo', get: (r) => vlmMetric(r, 'prefixTokens'), fmt: 'int' },
    // Fine-tuning (fase 10). r / α / matrices adaptadas solo cuando HAY adapter (full FT y RLHF sin LoRA: «—»); los knobs
    // enteros (targets 2 | 4 | 7, optimizer = bytes de estado) se muestran con su nombre (A.finetune.TARGET_LABELS / OPTIMIZERS).
    r: { label: 'Rango r', get: (r) => (ftAdapter(r) ? r.config.r : null), fmt: 'int' },
    alpha: { label: 'Escala α (α/r)', get: (r) => (ftAdapter(r) && r.config.alpha > 0 ? r.config.alpha + ' (α/r = ' + String(+(r.config.alpha / r.config.r).toFixed(3)) + ')' : null), fmt: 'raw' },
    targets: { label: 'Matrices adaptadas', get: ftTargets, fmt: 'sub' },
    targetsCount: { label: 'Matrices adaptadas por bloque', get: (r) => (ftAdapter(r) ? vlmMetric(r, 'targetsCount') : null), fmt: 'int' },
    optimizer: { label: 'Optimizador', get: ftOptimizer, fmt: 'raw' },
    trainableParams: { label: 'Parámetros entrenables', get: (r) => vlmMetric(r, 'trainableParams'), fmt: 'int' },
    trainableShare: { label: 'Entrenables / totales', get: (r) => vlmMetric(r, 'trainableShare'), fmt: 'pct' },
    adapterParamsPerLayer: { label: 'Adapter por capa', get: (r) => vlmMetric(r, 'adapterParamsPerLayer'), fmt: 'int' },
    adapterBytes: { label: 'Archivo del adapter', get: (r) => (ftAdapter(r) ? vlmMetric(r, 'adapterBytes') : null), fmt: 'bytes' },
    baseWeightBytes: { label: 'Pesos de la base', get: (r) => vlmMetric(r, 'baseWeightBytes'), fmt: 'bytes' },
    gradBytes: { label: 'Gradientes', get: (r) => vlmMetric(r, 'gradBytes'), fmt: 'bytes' },
    optimizerBytes: { label: 'Memoria del optimizador', get: (r) => vlmMetric(r, 'optimizerBytes'), fmt: 'bytes' },
    bytesPerTrainableParam: { label: 'Bytes por parámetro entrenable', get: (r) => vlmMetric(r, 'bytesPerTrainableParam'), fmt: 'raw' },
    fitsOn24: { label: 'Cabe en 24 GB', get: (r) => metricAny(r, 'fitsOn24'), fmt: 'bool' },
    fitsOn48: { label: 'Cabe en 48 GB', get: (r) => metricAny(r, 'fitsOn48'), fmt: 'bool' },
    fitsOn80: { label: 'Cabe en 80 GB', get: (r) => metricAny(r, 'fitsOn80'), fmt: 'bool' },
    gpus80Needed: { label: 'GPUs de 80 GB (≈)', get: (r) => vlmMetric(r, 'gpus80Needed'), fmt: 'int' },
    rolloutShare: { label: 'Generación (% de los MACs del paso)', get: (r) => vlmMetric(r, 'rolloutShare'), fmt: 'pct' },
    updateShare: { label: 'Actualización (% de los MACs del paso)', get: (r) => vlmMetric(r, 'updateShare'), fmt: 'pct' },
    trainStepMacsVsFullFt: { label: 'MACs del paso / full FT', get: (r) => vlmMetric(r, 'trainStepMacsVsFullFt'), fmt: 'ratio' },
    memoryVsFullFt: { label: 'Memoria / full FT', get: (r) => vlmMetric(r, 'memoryVsFullFt'), fmt: 'ratio' },
    activationBytes: { label: 'Activaciones (≈)', get: (r) => vlmMetric(r, 'activationBytes'), fmt: 'bytes' },
    totalTrainMemory: { label: 'Memoria total de entrenamiento (≈)', get: (r) => vlmMetric(r, 'totalTrainMemory'), fmt: 'bytes' },
    trainStepMacs: { label: 'MACs por paso', get: (r) => vlmMetric(r, 'trainStepMacs'), fmt: 'si', unit: 'MACs' },
    modelsInMemory: { label: 'Modelos en memoria', get: (r) => vlmMetric(r, 'modelsInMemory'), fmt: 'int' },
    generationTokensPerStep: { label: 'Tokens generados por paso', get: (r) => vlmMetric(r, 'generationTokensPerStep'), fmt: 'int' },
    // Retrieval y ANN (fase 11).
    embedParams: { label: 'Parámetros de embeddings', get: (r) => vlmMetric(r, 'embedParams'), fmt: 'int' },
    encoderMacs: { label: 'MACs del encoder', get: (r) => vlmMetric(r, 'encoderMacs'), fmt: 'si', unit: 'MACs' },
    queryEncodeMacs: { label: 'MACs por consulta (encoder)', get: (r) => vlmMetric(r, 'queryEncodeMacs'), fmt: 'si', unit: 'MACs' },
    docEncodeMacs: { label: 'MACs por documento (offline)', get: (r) => vlmMetric(r, 'docEncodeMacs'), fmt: 'si', unit: 'MACs' },
    crossEncoderMacsPerPair: { label: 'MACs por par (cross-encoder)', get: (r) => vlmMetric(r, 'crossEncoderMacsPerPair'), fmt: 'si', unit: 'MACs' },
    bruteForceBytes: { label: 'Bytes del índice (lo que lee la fuerza bruta)', get: (r) => vlmMetric(r, 'bruteForceBytes'), fmt: 'bytes' },
    rerankMacs: { label: 'MACs del rerank (k pares)', get: (r) => vlmMetric(r, 'rerankMacs'), fmt: 'si', unit: 'MACs' },
    embeddingIndexBytes: { label: 'Memoria del índice', get: (r) => vlmMetric(r, 'embeddingIndexBytes'), fmt: 'bytes' },
    indexBytes: { label: 'Memoria del índice', get: (r) => vlmMetric(r, 'indexBytes'), fmt: 'bytes' },
    bytesPerVector: { label: 'Bytes por vector', get: (r) => vlmMetric(r, 'bytesPerVector'), fmt: 'int' },
    memoryVsFlat: { label: 'Memoria / la del índice exacto', get: (r) => vlmMetric(r, 'memoryVsFlat'), fmt: 'pct' },
    distanceComputations: { label: 'Distancias por consulta (≈)', get: (r) => vlmMetric(r, 'distanceComputations'), fmt: 'int' },
    bytesTouchedPerQuery: { label: 'Bytes leídos por consulta (≈)', get: (r) => vlmMetric(r, 'bytesTouchedPerQuery'), fmt: 'bytes' },
    searchMacs: { label: 'MACs de la búsqueda', get: (r) => vlmMetric(r, 'searchMacs'), fmt: 'si', unit: 'MACs' },
    latencyMs: { label: 'ms por consulta en CPU (≈ cota)', get: (r) => vlmMetric(r, 'latencyMs'), fmt: 'ms' },
    // Fase 14 (percepción)
    nDet: { label: 'Detecciones por frame', get: (r) => r.config && r.config.nDet, fmt: 'int' },
    nTracks: { label: 'Tracks en el pool', get: (r) => r.config && r.config.nTracks, fmt: 'int' },
    kalmanFlopsPerTrack: { label: 'FLOPs del Kalman por track', get: (r) => vlmMetric(r, 'kalmanFlopsPerTrack'), fmt: 'int' },
    iouOps: { label: 'Operaciones de IoU y costo (≈, las dos pasadas)', get: (r) => vlmMetric(r, 'iouOps'), fmt: 'si' },
    trackerOps: { label: 'Operaciones del tracker por frame (≈, FLOPs del Kalman + otros)', get: (r) => vlmMetric(r, 'trackerOps'), fmt: 'si' },
    detectorMacs: { label: 'MACs del detector', get: (r) => vlmMetric(r, 'detectorMacs'), fmt: 'si', unit: 'MACs' },
    detectorFlops: { label: 'FLOPs del detector', get: (r) => vlmMetric(r, 'detectorFlops'), fmt: 'si', unit: 'FLOPs' },
    trackerShare: { label: 'Tracker / FLOPs del detector (≈)', get: (r) => vlmMetric(r, 'trackerShare'), fmt: 'pct' },
    framesLost: { label: 'Frames sin detección que aguanta un track', get: (r) => vlmMetric(r, 'framesLost'), fmt: 'int' },
    kalmanBytesPerTrack: { label: 'Bytes del Kalman por track (float64)', get: (r) => vlmMetric(r, 'kalmanBytesPerTrack'), fmt: 'int' },
    decoderMacs: { label: 'MACs del decoder / cabeza', get: (r) => vlmMetric(r, 'decoderMacs'), fmt: 'si', unit: 'MACs' },
    decoderMacsShare: { label: 'Cabeza: % de los MACs', get: (r) => vlmMetric(r, 'decoderMacsShare'), fmt: 'pct' },
    msOrin: { label: 'ms en Jetson AGX Orin (≈)', get: (r) => vlmMetric(r, 'msOrin'), fmt: 'ms' },
    msH100: { label: 'ms en H100 (≈)', get: (r) => vlmMetric(r, 'msH100'), fmt: 'ms' },
    N: { label: 'Puntos N', get: (r) => r.config && r.config.N, fmt: 'int' },
    tnetParams: { label: 'Parámetros de los T-Net', get: (r) => vlmMetric(r, 'tnetParams'), fmt: 'si' },
    perPointMacs: { label: 'MACs de la parte por punto (× N)', get: (r) => vlmMetric(r, 'perPointMacs'), fmt: 'si', unit: 'MACs' },
    macsPerPoint: { label: 'MACs por punto', get: (r) => vlmMetric(r, 'macsPerPoint'), fmt: 'si', unit: 'MACs' },
    globalMacs: { label: 'MACs después del max-pool', get: (r) => vlmMetric(r, 'globalMacs'), fmt: 'si', unit: 'MACs' },
    maxpoolOps: { label: 'Comparaciones del max-pool', get: (r) => vlmMetric(r, 'maxpoolOps'), fmt: 'si' },
    // Fase 15 (RL y aprendizaje por imitación)
    trunkParams: { label: 'Parámetros del tronco compartido', get: (r) => vlmMetric(r, 'trunkParams'), fmt: 'si' },
    actorParams: { label: 'Parámetros del actor', get: (r) => vlmMetric(r, 'actorParams'), fmt: 'si' },
    criticParams: { label: 'Parámetros del crítico', get: (r) => vlmMetric(r, 'criticParams'), fmt: 'si' },
    nEnvs: { label: 'Entornos en paralelo N', get: (r) => vlmMetric(r, 'nEnvs'), fmt: 'int' },
    horizon: { label: 'Pasos por entorno y rollout T', get: (r) => vlmMetric(r, 'horizon'), fmt: 'int' },
    samplesPerUpdate: { label: 'Muestras por update (N × T)', get: (r) => vlmMetric(r, 'samplesPerUpdate'), fmt: 'int' },
    minibatchSize: { label: 'Tamaño del minibatch', get: (r) => vlmMetric(r, 'minibatchSize'), fmt: 'int' },
    epochs: { label: 'Épocas por update K', get: (r) => vlmMetric(r, 'epochs'), fmt: 'int' },
    gradStepsPerUpdate: { label: 'Pasos de gradiente por update', get: (r) => vlmMetric(r, 'gradStepsPerUpdate'), fmt: 'int' },
    actorMacs: { label: 'MACs del actor por paso', get: (r) => vlmMetric(r, 'actorMacs'), fmt: 'si', unit: 'MACs' },
    updateMacs: { label: 'MACs del update (fwd + bwd, K épocas)', get: (r) => vlmMetric(r, 'updateMacs'), fmt: 'si', unit: 'MACs' },
    rolloutBufferBytes: { label: 'Memoria del buffer del rollout (fp32)', get: (r) => vlmMetric(r, 'rolloutBufferBytes'), fmt: 'bytes' },
    macsPerInference: { label: 'MACs por inferencia', get: (r) => vlmMetric(r, 'macsPerInference'), fmt: 'si', unit: 'MACs' },
    actionsPerInference: { label: 'Acciones ejecutadas por inferencia', get: (r) => vlmMetric(r, 'actionsPerInference'), fmt: 'int' },
    inferenceHz: { label: 'Inferencias por segundo (Hz)', get: (r) => vlmMetric(r, 'inferenceHz'), fmt: 'raw' },
    // Fase 13 (recomendación y árboles)
    nTrees: { label: 'Árboles', get: (r) => r.config && r.config.nTrees, fmt: 'int' },
    // LightGBM (leaf-wise) sin max_depth: depth = 0 es "sin límite" (max_depth −1), no profundidad 0; manda num_leaves.
    depth: { label: 'Profundidad máxima', get: (r) => (!r.config ? null : r.config.kind === 'leafwise' && !r.config.depth ? 'sin límite (' + r.config.leavesPerTree + ' hojas)' : r.config.depth), fmt: 'int' },
    leaves: { label: 'Hojas del ensamble', get: (r) => vlmMetric(r, 'leaves'), fmt: 'int' },
    nodes: { label: 'Nodos del ensamble', get: (r) => vlmMetric(r, 'nodes'), fmt: 'int' },
    modelBytes: { label: 'Tamaño del modelo (≈)', get: (r) => vlmMetric(r, 'modelBytes'), fmt: 'bytes' },
    comparisonsPerPrediction: { label: 'Comparaciones por predicción', get: (r) => vlmMetric(r, 'comparisonsPerPrediction'), fmt: 'int' },
    predictionsPerSecCpu: { label: 'Predicciones/s en CPU (≈)', get: (r) => vlmMetric(r, 'predictionsPerSecCpu'), fmt: 'si' },
    histogramAddsPerTree: { label: 'Sumas a histogramas por árbol', get: (r) => vlmMetric(r, 'histogramAddsPerTree'), fmt: 'si' },
    splitEvalsPerTree: { label: 'Evaluaciones de split por árbol', get: (r) => vlmMetric(r, 'splitEvalsPerTree'), fmt: 'si' },
    trainOps: { label: 'Operaciones de entrenamiento (≈)', get: (r) => vlmMetric(r, 'trainOps'), fmt: 'si' },
    tables: { label: 'Tablas de embeddings', get: (r) => vlmMetric(r, 'tables'), fmt: 'int' },
    totalRows: { label: 'Filas en todas las tablas', get: (r) => vlmMetric(r, 'totalRows'), fmt: 'si' },
    lookupsPerSample: { label: 'Lookups por muestra', get: (r) => vlmMetric(r, 'lookupsPerSample'), fmt: 'int' },
    embeddingParams: { label: 'Parámetros en tablas de embeddings', get: (r) => vlmMetric(r, 'embeddingParams'), fmt: 'si' },
    mlpParams: { label: 'Parámetros en MLPs', get: (r) => vlmMetric(r, 'mlpParams'), fmt: 'si' },
    embeddingParamsShare: { label: 'Tablas: % de los parámetros', get: (r) => vlmMetric(r, 'embeddingParamsShare'), fmt: 'pct' },
    embeddingBytes: { label: 'Memoria de las tablas', get: (r) => vlmMetric(r, 'embeddingBytes'), fmt: 'bytes' },
    lookupBytesPerSample: { label: 'Bytes de lookups por muestra', get: (r) => vlmMetric(r, 'lookupBytesPerSample'), fmt: 'bytes' },
    macsPerSample: { label: 'MACs por muestra', get: (r) => vlmMetric(r, 'macsPerSample'), fmt: 'si', unit: 'MACs' },
    interactionMacs: { label: 'MACs de la interacción', get: (r) => vlmMetric(r, 'interactionMacs'), fmt: 'si', unit: 'MACs' },
    arithmeticIntensity: { label: 'Intensidad aritmética (FLOPs/B)', get: (r) => vlmMetric(r, 'arithmeticIntensity'), fmt: 'raw' },
    samplesPerSecH100: { label: 'Muestras/s en H100 (≈ tope)', get: (r) => vlmMetric(r, 'samplesPerSecH100'), fmt: 'si' },
    rankingMsH100: { label: 'ms por request de ranking (≈ H100)', get: (r) => vlmMetric(r, 'rankingMsH100'), fmt: 'ms' },
    userTowerMacs: { label: 'MACs de la torre de usuario', get: (r) => vlmMetric(r, 'userTowerMacs'), fmt: 'si', unit: 'MACs' },
    itemTowerMacs: { label: 'MACs de la torre de ítem', get: (r) => vlmMetric(r, 'itemTowerMacs'), fmt: 'si', unit: 'MACs' },
    inBatchLogitsMacs: { label: 'MACs de los logits in-batch', get: (r) => vlmMetric(r, 'inBatchLogitsMacs'), fmt: 'si', unit: 'MACs' },
    servingMsH100: { label: 'ms por request (≈ H100)', get: (r) => vlmMetric(r, 'servingMsH100'), fmt: 'ms' },
    nItems: { label: 'Ítems en el catálogo', get: (r) => vlmMetric(r, 'nItems'), fmt: 'si' },
    interactionParams: { label: 'Parámetros de la interacción', get: (r) => vlmMetric(r, 'interactionParams'), fmt: 'si' },
    embeddingBytes32: { label: 'Memoria de las tablas en fp32', get: (r) => vlmMetric(r, 'embeddingBytes32'), fmt: 'bytes' },
    // Fase 12 (encoder-decoder)
    sharedEmbedParams: { label: 'Embedding compartido', get: (r) => vlmMetric(r, 'sharedEmbedParams'), fmt: 'si' },
    encoderParams: { label: 'Parámetros del encoder', get: (r) => vlmMetric(r, 'encoderParams'), fmt: 'si' },
    decoderParams: { label: 'Parámetros del decoder (con cross-attention)', get: (r) => vlmMetric(r, 'decoderParams'), fmt: 'si' },
    crossAttnParams: { label: 'Parámetros de la cross-attention', get: (r) => vlmMetric(r, 'crossAttnParams'), fmt: 'si' },
    lmHeadParams: { label: 'Parámetros del LM head (0 si está atado)', get: (r) => vlmMetric(r, 'lmHeadParams'), fmt: 'si' },
    frontendParams: { label: 'Parámetros de las convoluciones', get: (r) => vlmMetric(r, 'frontendParams'), fmt: 'si' },
    encoderMacsPerWindow: { label: 'MACs del encoder por ventana de 30 s', get: (r) => vlmMetric(r, 'encoderMacsPerWindow'), fmt: 'si', unit: 'MACs' },
    crossKvMacs: { label: 'MACs de K/V cruzados (una vez)', get: (r) => vlmMetric(r, 'crossKvMacs'), fmt: 'si', unit: 'MACs' },
    decoderMacsPerToken: { label: 'MACs del decoder por token', get: (r) => vlmMetric(r, 'decoderMacsPerToken'), fmt: 'si', unit: 'MACs' },
    totalGenerationMacs: { label: 'MACs de generar la salida', get: (r) => vlmMetric(r, 'totalGenerationMacs'), fmt: 'si', unit: 'MACs' },
    encoderShare: { label: 'Encoder: % de los MACs de la generación', get: (r) => vlmMetric(r, 'encoderShare'), fmt: 'pct' },
    crossKvBytes: { label: 'K/V de la cross-attention (bf16)', get: (r) => vlmMetric(r, 'crossKvBytes'), fmt: 'bytes' },
    selfKvCacheBytes: { label: 'KV cache del decoder (bf16)', get: (r) => vlmMetric(r, 'selfKvCacheBytes'), fmt: 'bytes' },
    generationMs: { label: 'ms de la generación (≈ H100)', get: (r) => vlmMetric(r, 'generationMs'), fmt: 'ms' },
    speedVsRealtime: { label: 'Veces más rápido que tiempo real (≈ H100)', get: (r) => vlmMetric(r, 'speedVsRealtime'), fmt: 'ratio' },
    projectorParams: { label: 'Parámetros del proyector / merger', get: (r) => vlmMetric(r, 'projectorParams'), fmt: 'si' },
    visualModuleParams: { label: 'Parámetros de visión + proyector', get: (r) => vlmMetric(r, 'visualModuleParams'), fmt: 'si' },
    promptTokens: { label: 'Tokens del prompt (N + T)', get: (r) => vlmMetric(r, 'promptTokens'), fmt: 'int' },
    kvBytesPrompt: { label: 'KV cache del prompt', get: (r) => vlmMetric(r, 'kvBytesPrompt'), fmt: 'bytes' },
    visualShare: { label: 'Parte visual del prompt', get: (r) => vlmMetric(r, 'visualShare'), fmt: 'pct' },
    prefillShareFromImage: { label: 'Prefill debido a la imagen', get: (r) => vlmMetric(r, 'prefillShareFromImage'), fmt: 'pct' },
    visionMacsShare: { label: 'Visión: % del prefill', get: (r) => vlmMetric(r, 'visionMacsShare'), fmt: 'pct' },
    Dv: { label: 'Ancho de la visión D_v', get: (r) => r.config && r.config.Dv, fmt: 'int' },
    Lv: { label: 'Capas de la visión L_v', get: (r) => r.config && r.config.Lv, fmt: 'int' },
    // Revisión de la fase 6: bits de los pesos y de la KV cache por separado; pesos INT-k con embedding y LM head en 16 bits.
    bits: { label: 'Bits de los pesos', labels: { lora: 'Bits de la base congelada', 'rlhf-dpo': 'Bits de la base congelada' }, get: (r) => r.config && r.config.bits, fmt: 'int' },
    kvBits: { label: 'Bits de la KV cache', get: (r) => r.config && r.config.kvBits, fmt: 'int' },
    weightBytes: { label: 'Pesos en memoria', get: (r) => (r.quantities && r.quantities.weightBytes != null ? r.quantities.weightBytes : vlmMetric(r, 'weightBytes')), fmt: 'bytes' },
    kvCacheBytes: { label: 'KV cache (ctx × B)', labels: { 'rlhf-dpo': 'KV cache del rollout' }, get: (r) => (r.quantities && r.quantities.kvCacheBytes != null ? r.quantities.kvCacheBytes : vlmMetric(r, 'kvCacheBytes')), fmt: 'bytes' },
  };
  function resolveRunId(id) {
    const Ar = A();
    if (!Ar) return null;
    const isCfg = typeof Ar.configs === 'function' && arr(safe(() => Ar.configs(), [])).some((c) => c && c.id === id);
    return isCfg ? id : canonicalFor(id) || id;
  }
  // Porcentaje: 1 decimal; debajo de 1 %, 3 cifras significativas ('0.0848 %'): ATLAS.Arch.fmt.pctAuto.
  const pctAuto = (v) => { const f = A() && A().fmt; if (f && f.pctAuto) return f.pctAuto(v); const p = 100 * v; return (p !== 0 && Math.abs(p) < 1 ? p.toPrecision(3) : p.toFixed(1)) + ' %'; };
  // Milisegundos con 3 cifras significativas (como quantities.js): 1.62 · 83.8 · 121.
  const fmtMs = (v) => { const a = Math.abs(v); return a >= 100 ? fmtInt(Math.round(v)) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : String(Number(v.toPrecision(3))); };
  function vlmMetric(r, k) {
    if (r.quantities && r.quantities[k] != null) return r.quantities[k];
    const m = safe(() => A().metrics(r.id, r.overrides || {}), null);
    return m && typeof m[k] === 'number' ? m[k] : null;
  }
  // Cualquier valor de metrics() (booleanos fitsOn…, textos targetsName…).
  function metricAny(r, k) {
    const m = safe(() => A().metrics(r.id, r.overrides || {}), null);
    return m && m[k] != null ? m[k] : null;
  }
  // Fase 10: ¿la config tiene adapter? (full FT: r = 0; RLHF / DPO / GRPO con lora = 0 arrastran r 16 sin usarlo).
  const ftAdapter = (r) => { const c = r && r.config; return !!(c && c.r > 0 && c.full !== 1 && (c.lora === undefined || c.lora === 1)); };
  function ftTargets(r) {
    const c = r && r.config;
    if (!c) return null;
    if (c.full === 1) return 'todas (full FT)';
    if (!ftAdapter(r)) return null;
    const F = A() && A().finetune;
    const n = c.targets != null ? c.targets : (Array.isArray(c.adapted) ? c.adapted.length : null);
    const lab = F && F.TARGET_LABELS && F.TARGET_LABELS[n];
    const code = metricAny(r, 'targetsName') || (F && F.TARGET_NAMES && F.TARGET_NAMES[n]);
    return lab ? lab + (code ? ' · ' + code : '') : n != null ? n + ' matrices' : null;
  }
  function ftOptimizer(r) {
    const c = r && r.config, F = A() && A().finetune;
    if (!c || c.optimizer == null) return null;
    const o = F && F.OPTIMIZERS && F.OPTIMIZERS[c.optimizer];
    return o ? o.label : c.optimizer + ' B de estado por parámetro';
  }
  R.compare = (b, ctx) => {
    if (!A()) return missingComponent('calculadora', 'js/arch/primitives.js (ATLAS.Arch)');
    const cols = arr(b.models).map((id) => { const cfg = resolveRunId(id); return Object.assign({ id, cfg }, run(cfg)); });
    const keys = arr(b.rows).length ? arr(b.rows) : ['params', 'tokens', 'macs'];
    // Etiqueta de la fila: la del modelo si todas las columnas son de ese modelo (SAM: «Clics P»).
    const colModels = cols.map((c) => (c.run && c.run.model) || null);
    const rowLabel = (k) => {
      const m = METRICS[k];
      if (!m) return k;
      const ms = Array.from(new Set(colModels));
      if (m.labels && ms.length === 1 && m.labels[ms[0]]) return m.labels[ms[0]];
      if (m.labels && ms.some((x) => m.labels[x])) return m.label + ' (' + ms.filter((x) => m.labels[x]).map((x) => 'en ' + x.toUpperCase() + ', ' + m.labels[x].replace(/\s+\S+$/, '').toLowerCase()).join('; ') + ')';   // «Patch P (en SAM, clics)»
      return m.label;
    };
    const cell = (r, k) => {
      const m = METRICS[k];
      let v = m ? safe(() => m.get(r), null) : null;
      if (v == null && !m) v = safe(() => (r.quantities && r.quantities[k] != null ? r.quantities[k] : r.config && r.config[k] != null ? r.config[k] : vlmMetric(r, k)), null);
      if (v == null) return '—';
      if (typeof v === 'boolean' || (m && m.fmt === 'bool')) return v ? 'sí' : 'no';
      if (m && m.fmt === 'sub') return h('span', { html: labelHtml(v) });   // 'W_Q y W_V' → subíndices
      if (typeof v !== 'number') return String(v);
      if (m && m.fmt === 'raw') return String(+v.toPrecision(4));
      if (m && m.fmt === 'ratio') return '×' + fmtRatio3(v);
      if (m && m.fmt === 'bytes') { const f = A() && A().fmt; return f && f.bytes ? f.bytes(v) : fmtInt(v) + ' B'; }
      if (m && m.fmt === 'pct') return pctAuto(v);
      if (m && m.fmt === 'ms') return fmtMs(v) + ' ms';
      // Sin entrada en METRICS: la unidad del mapa metrics.units del modelo (un % no se imprime como el entero "0").
      if (!m) {
        const u = safe(() => (A().metrics(r.id, r.overrides || {}).units || {})[k], null);
        const f = A() && A().fmt;
        if (u === 'pct') return pctAuto(v);
        if (u === 'bytes' && f && f.bytes) return f.bytes(v);
        if (u === 'macs') return fmtOps(v, 'MACs');
        if (u === 'ms') return fmtMs(v) + ' ms';
        if (u === 'duration' && f && f.duration) return f.duration(v);
        if (u === 'ratio') return '×' + fmtRatio3(v);
      }
      return (m && m.fmt === 'si') ? (m.unit ? fmtOps(v, m.unit) : fmtSi(v)) : fmtInt(v);   // "17.56 GMACs", como en la prosa
    };
    const table = h('table', { class: 'dtable dtable--num cmp' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Métrica'), cols.map((c) => h('th', { scope: 'col', class: 'num' },
        c.run ? h('a', { href: '#' + (c.run.model || c.id) }, str(c.run.label || c.cfg)) : str(c.id))))),
      h('tbody', null, keys.map((k) => h('tr', null,
        h('th', { scope: 'row' }, rowLabel(k)),
        cols.map((c) => h('td', { class: 'num', title: c.run && METRICS[k] && METRICS[k].fmt === 'si' ? fmtInt(METRICS[k].get(c.run)) : null }, c.run ? cell(c.run, k) : h('span', { class: 'q-warn', title: c.error === 'no-arch' ? 'Falta la calculadora' : str(c.error) }, '?')))))));
    const cfgList = arr(safe(() => A().configs(), []));
    const allCanon = cols.every((c) => { const k = cfgList.find((x) => x && x.id === c.cfg); return !k || k.canonical; });
    return tableFigure('b-cmp', b.caption ? str(b.caption) : (allCanon ? 'Comparación (configuración canónica)' : 'Comparación entre configuraciones'), table,
      allCanon ? 'Generado por la calculadora en la configuración canónica de cada modelo.' : 'Generado por la calculadora en la configuración de cada columna.');
  };

  // ------------------------------------------------------------------ formulas: primitivas (§5.4, ref-formas)
  R.formulas = (b) => {
    const Ar = A();
    if (!Ar || typeof Ar.primitives !== 'function') return missingComponent('calculadora', 'js/arch/primitives.js (ATLAS.Arch.primitives)');
    let prims = arr(safe(() => Ar.primitives(), []));
    if (arr(b.prims).length) { const want = arr(b.prims); prims = want.map((id) => prims.find((p) => p && p.id === id)).filter(Boolean); }
    const table = h('table', { class: 'dtable ftab' },
      h('thead', null, h('tr', null, ['Primitiva', 'Parámetros', 'MACs', 'Forma de salida', 'Nota'].map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, prims.map((p) => h('tr', { id: 'prim-' + p.id },
        h('th', { scope: 'row' }, h('span', { class: 'mono' }, str(p.id)), p.label ? h('span', { class: 'ftab__label' }, str(p.label)) : null),
        h('td', null, p.paramTex ? tex(p.paramTex) : '0'),
        h('td', null, p.macTex ? tex(p.macTex) : '0'),
        h('td', null, p.outTex ? tex(p.outTex) : '—'),
        h('td', { class: 'ftab__note', html: str(p.note) })))));
    return tableFigure('b-ftab', b.caption ? str(b.caption) : 'Primitivas de la calculadora', table, 'Fórmulas que usa la calculadora; cada una tiene pruebas unitarias.');
  };

  // ------------------------------------------------------------------ card: tarjeta del mapa (§5.5)
  const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return null; };
  function paperLine(p) {
    if (!p) return null;
    const bits = [p.authors, p.venue || p.year].filter(Boolean).join(' · ');
    const href = p.url || (p.arxiv ? 'https://arxiv.org/abs/' + p.arxiv : null);
    return h('span', { class: 'paper' },
      p.title ? (href ? h('a', { href, target: '_blank', rel: 'noopener', class: 'paper__title' }, str(p.title)) : h('i', { class: 'paper__title' }, str(p.title))) : null,
      bits ? h('span', { class: 'paper__meta' }, (p.title ? ' — ' : '') + bits) : null,
      p.arxiv ? h('span', { class: 'paper__arxiv mono' }, ' · arXiv:' + p.arxiv) : null);
  }
  const STATE_TXT = { done: 'Completado', progress: 'En curso', ready: 'Disponible', soon: 'Próximamente' };
  function modelCard(id, ctx) {
    const it = catalogItem(id);
    if (!it) return warnBox('Tarjeta desconocida: "' + id + '"', 'No está en js/content/catalog.js.');
    const fam = safe(() => ATLAS.families().find((f) => f.id === it.family), null);
    const page = safe(() => ATLAS.getPage(id), null);
    const st = ctx && ctx.store && it.kind !== 'card' ? safe(() => ctx.store.pageState(id), 'soon') : null;
    const cfg = it.canonical || null;
    const res = cfg && A() ? run(cfg) : null;
    const cd = (it.card && typeof it.card === 'object') ? it.card : {};
    const q = (v) => (v == null ? null : fillText(String(v), { config: cfg, model: it.model }));
    const size = q(pick(cd, ['tamano', 'size'])) || q(pick(it, ['size'])) || (res && res.run ? str(res.run.label || cfg) + ' · ' + fmtSi(res.run.totals && res.run.totals.params) + ' parámetros' : (cfg ? cfg : null));
    const level2 = it.kind === 'model' || it.kind === 'recap';
    const foot = it.anchor ? h('span', { class: 'mcard__lvl' }, 'Ya lo conoces · ancla')
      : level2 ? (page && page.ready ? h('span', { class: 'mcard__lvl' }, 'Nivel 2 en: ', h('a', { href: '#' + id }, str(it.short || it.title)))
        : h('span', { class: 'mcard__lvl muted' }, 'Nivel 2: próximamente' + (it.phase ? ' (fase ' + it.phase + ')' : '')))
        : h('span', { class: 'mcard__lvl muted' }, 'Solo nivel 1');
    const cin = pick(cd, ['in']), cout = pick(cd, ['out']);
    const io = cin || cout ? str(cin || '?') + ' → ' + str(cout || '?') : pick(it, ['io']);
    const idea = pick(cd, ['idea']) || pick(it, ['idea']);
    const uses = pick(cd, ['uso', 'uses']) || pick(it, ['uses']);
    const rows = [
      io ? ['Entradas → salidas', io] : null,
      idea ? ['Idea', idea] : null,
      uses ? ['Dónde se usa', uses] : null,
      size ? ['Tamaño canónico', size] : null,
    ].filter(Boolean);
    return h('article', {
      class: 'mcard' + (it.anchor ? ' mcard--anchor' : '') + (it.kind === 'card' ? ' mcard--l1' : ''),
      id: ctx && ctx.pageId === 'mapa' ? 'mapa.' + (ATLAS.slug ? ATLAS.slug(id) : id) : null, dataset: { card: id },
    },
    h('header', { class: 'mcard__head' },
      fam ? h('span', { class: 'mcard__fam' }, str(fam.title)) : null,
      h('h3', { class: 'mcard__title' }, page && page.ready ? h('a', { href: '#' + id }, str(it.title)) : str(it.title)),
      st ? h('span', { class: 'chip mcard__st mcard__st--' + st }, STATE_TXT[st]) : null),
    it.titleEn ? h('p', { class: 'mcard__en', lang: 'en' }, str(it.titleEn)) : null,
    it.summary && !idea ? h('p', { class: 'mcard__sum', html: str(it.summary) }) : null,
    rows.length ? h('dl', { class: 'mcard__dl' }, rows.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', { html: str(v) })))) : null,
    it.paper ? h('p', { class: 'mcard__paper' }, paperLine(it.paper)) : null,
    h('footer', { class: 'mcard__foot' }, foot));
  }
  function familyCard(fid, ctx) {
    const fam = safe(() => ATLAS.families().find((f) => f.id === fid), null);
    if (!fam) return warnBox('Familia desconocida: "' + fid + '"', 'No está en catalog.families.');
    const items = safe(() => Object.values(ATLAS.catalog().items).filter((it) => it.family === fid && ['model', 'recap', 'card'].indexOf(it.kind) >= 0), [])
      .sort((a, b) => ((a.block || 0) - (b.block || 0)) || ((a.num || 0) - (b.num || 0)));
    return h('article', { class: 'mcard mcard--family', id: ctx && ctx.pageId === 'mapa' ? 'mapa.familia-' + fid : null, dataset: { family: fid } },
      h('header', { class: 'mcard__head' }, h('span', { class: 'mcard__fam' }, 'Familia'), h('h3', { class: 'mcard__title' }, str(fam.title))),
      fam.titleEn ? h('p', { class: 'mcard__en', lang: 'en' }, str(fam.titleEn)) : null,
      fam.summary ? h('p', { class: 'mcard__sum', html: str(fam.summary) }) : null,
      items.length ? h('ul', { class: 'mcard__members' }, items.map((it) => {
        const page = safe(() => ATLAS.getPage(it.id), null);
        return h('li', null, page && page.ready ? h('a', { class: 'chip', href: '#' + it.id }, str(it.short || it.title))
          : h('span', { class: 'chip ' + (it.anchor ? 'chip--anchor' : 'chip--soon') }, str(it.short || it.title)));
      })) : null);
  }
  R.card = (b, ctx) => (b.family ? familyCard(b.family, ctx) : modelCard(b.model || b.id, ctx));

  // ------------------------------------------------------------------ componentes con controlador (montaje diferido)
  // El bloque se devuelve con un host vacío; mount(scope) llama al componente cuando ya está en el documento.
  function deferred(fig, host, kind, mountFn, meta) {
    fig.dataset.ctrl = kind;
    if (meta && meta.diagram) fig.dataset.diagram = meta.diagram;
    fig._atlasMount = () => {
      if (fig._atlasMounted) return;
      fig._atlasMounted = true;
      try {
        const ctrl = mountFn(host);
        if (ctrl) fig._atlasCtrl = ctrl;
      } catch (e) {
        if (root.console) root.console.warn('[blocks] error al montar ' + kind, e);
        host.innerHTML = '';
        host.appendChild(warnBox('No se pudo mostrar este ' + (kind === 'diagram' ? 'diagrama' : kind === 'viz' ? 'visualización' : 'ejercicio'), e && e.message));
      }
    };
    return fig;
  }

  function pageCtxOf(ctx) {
    return { pageId: ctx && ctx.pageId, sectionId: ctx && ctx.sectionId, model: ctx && ctx.model, config: ctx && ctx.config };
  }
  function practiceCtx(ctx) {
    const app = ATLAS.App;
    return Object.assign({}, pageCtxOf(ctx), {
      store: (ctx && ctx.store) || ATLAS.store,
      navigate: app && app.navigate ? app.navigate : (hash) => { root.location.hash = hash; },
      renderBlocks: (blocks, el, pctx) => renderAll(blocks, el, Object.assign({ store: (ctx && ctx.store) || ATLAS.store }, pctx || pageCtxOf(ctx))),
      pageCtx: pageCtxOf(ctx),
    });
  }

  R.archdiagram = (b, ctx) => {
    const AD = ATLAS.ArchDiagram;
    if (!AD || typeof AD.render !== 'function') return missingComponent('diagrama de arquitectura', 'js/ui/archdiagram.js (ATLAS.ArchDiagram)');
    const host = h('div', { class: 'b-diagram__host' });
    const fig = h('figure', { class: 'b-diagram' + (b.wide ? ' wide' : '') }, host,
      b.caption ? h('figcaption', { class: 'b-diagram__cap', html: str(b.caption) }) : null);
    const store = (ctx && ctx.store) || ATLAS.store;
    return deferred(fig, host, 'diagram', (el) => AD.render(b.diagram, el, {
      mode: 'full', walk: b.walk, wide: !!b.wide,
      showNumbers: store ? store.pref('showNumbers') !== false : true,
      pageId: ctx && ctx.pageId, sectionId: ctx && ctx.sectionId,
    }), { diagram: b.diagram });
  };

  R.viz = (b, ctx) => {
    const V = ATLAS.Viz;
    if (!V || typeof V.render !== 'function') return missingComponent('visualización', 'js/ui/viz/' + str(b.kind) + '.js (ATLAS.Viz)');
    const host = h('div', { class: 'b-viz__host' });
    const fig = h('figure', { class: 'b-viz' + (b.wide ? ' wide' : ''), dataset: { viz: str(b.kind) } }, host,
      b.caption ? h('figcaption', { class: 'b-diagram__cap', html: str(b.caption) }) : null);
    return deferred(fig, host, 'viz', (el) => V.render(b.kind, el, b.params || {}, Object.assign({ arch: ATLAS.Arch, store: (ctx && ctx.store) || ATLAS.store }, pageCtxOf(ctx))));
  };

  const PRACTICE_TYPES = ['scaling', 'blankdiagram', 'shapedrill', 'whatif'];
  const PRACTICE_NAME = { scaling: 'explorador de escala', blankdiagram: 'diagrama en blanco', shapedrill: '¿qué forma tiene este tensor?', whatif: '¿qué pasa si…?' };
  PRACTICE_TYPES.forEach((t) => {
    R[t] = (b, ctx) => {
      const P = ATLAS.Practice;
      if (!P || typeof P.renderBlock !== 'function') return missingComponent(PRACTICE_NAME[t], 'js/ui/practice.js (ATLAS.Practice)');
      const host = h('div', { class: 'b-practice__host' });
      const fig = h('div', { class: 'b-practice b-practice--' + t }, host);
      return deferred(fig, host, 'practice', (el) => P.renderBlock(b, el, practiceCtx(ctx)), { diagram: b.diagram });
    };
  });

  // ------------------------------------------------------------------ decoración del HTML en línea
  // .est → tooltip; .en → lang="en"; lab: → ATLAS.labLink; enlaces internos a páginas no listas → marca.
  function decorate(el) {
    if (!el || !el.querySelectorAll) return el;
    el.querySelectorAll('span.est').forEach((s) => {
      if (!s.title) s.title = EST_TIP;
      if (!s.hasAttribute('data-est')) s.setAttribute('data-est', '');
    });
    el.querySelectorAll('span.en').forEach((s) => { if (!s.lang) s.lang = 'en'; });
    el.querySelectorAll('a[href^="lab:"]').forEach((a) => {
      const tab = (a.getAttribute('href') || '').slice(4);
      const href = typeof ATLAS.labLink === 'function' ? safe(() => ATLAS.labLink(tab), null) : null;
      if (href) {
        a.setAttribute('href', href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        a.classList.add('lab-link');
        if (root.ATLAS_ENV === 'single') {
          // El HTML de un solo archivo enlaza por ruta relativa: solo abre si sigue dentro del repo.
          a.classList.add('lab-link--fragile');
          if (!a.title) a.title = 'Abre el Laboratorio Transformer (' + tab + '). Requiere el repo: apps/transformer-lab junto a apps/atlas-arquitecturas';
        } else if (!a.title) a.title = 'Abre el Laboratorio Transformer (' + tab + ')';
      } else {
        // Artifact: sin enlace, una nota que dice dónde está. La ubicación completa va solo en la
        // primera nota de la página; las siguientes, en forma corta (sin repetir el nombre 20 veces).
        const span = document.createElement('span');
        span.className = 'lab-link lab-link--note';
        span.innerHTML = a.innerHTML;
        span.title = 'Abre el Laboratorio Transformer (apps/transformer-lab), pestaña ' + tab;
        const named = /laboratorio/i.test(a.textContent || '');
        const pageEl = document.getElementById('page');
        const first = !el.querySelector('.lab-link__where--full') && !(pageEl && pageEl.querySelector('.lab-link__where--full'));
        const where = first ? (named ? ' (apps/transformer-lab)' : ' (Laboratorio Transformer: apps/transformer-lab)') : (named ? '' : ' (en el Laboratorio)');
        if (where) span.appendChild(Object.assign(document.createElement('span'), { className: 'lab-link__where' + (first ? ' lab-link__where--full' : ''), textContent: where }));
        a.replaceWith(span);
      }
    });
    el.querySelectorAll('a[href^="#"]').forEach((a) => {
      const pid = (a.getAttribute('href') || '').slice(1).split(/[.~]/)[0];
      if (!pid || typeof ATLAS.getPage !== 'function') return;
      const it = catalogItem(pid);
      if (!it || (it.kind !== 'model' && it.kind !== 'recap')) return;
      const p = safe(() => ATLAS.getPage(pid), null);
      if (!p || !p.ready) { a.classList.add('is-soon'); if (!a.title) a.title = 'Próximamente: se abre la ficha del modelo'; }
    });
    el.querySelectorAll('a[target="_blank"]').forEach((a) => {
      if (!a.rel) a.rel = 'noopener';
      if (!a.classList.contains('lab-link')) a.classList.add('is-external');
    });
    return el;
  }

  function typeset(el) {
    const M = ATLAS.MathTex;
    if (M && typeof M.typeset === 'function' && el) { try { return M.typeset(el); } catch (e) { /* respaldo: el LaTeX queda como texto */ } }
    return Promise.resolve();
  }

  // ------------------------------------------------------------------ API
  function render(block, ctx) {
    if (!block || typeof block !== 'object') return warnBox('Bloque vacío o inválido');
    const fn = R[block.t];
    if (!fn) return warnBox('Tipo de bloque desconocido: "' + String(block.t) + '"', 'Tipos válidos: ' + Object.keys(R).join(', '));
    let el;
    try {
      const b = hasQ(block) ? fillDeep(block, ctx || {}) : block;
      el = fn(b, ctx || {});
    } catch (e) {
      if (root.console) root.console.warn('[blocks] error al renderizar', block.t, e);
      return warnBox('No se pudo mostrar un bloque "' + block.t + '"', e && e.message);
    }
    if (!el || typeof el.nodeType !== 'number') return warnBox('El bloque "' + block.t + '" no produjo contenido');
    if (el.dataset && !el.dataset.block) el.dataset.block = block.t;
    return decorate(el);
  }

  // Monta los componentes diferidos dentro de scope (debe estar en el documento).
  function mount(scope) {
    if (!scope || !scope.querySelectorAll) return;
    const list = Array.from(scope.querySelectorAll('[data-ctrl]'));
    if (scope.dataset && scope.dataset.ctrl) list.unshift(scope);
    list.forEach((el) => { if (typeof el._atlasMount === 'function' && !el._atlasMounted) el._atlasMount(); });
  }
  // Si el contenedor aún no está en el documento, se reintenta unos cuadros y luego se monta igual.
  function mountWhenConnected(container, tries) {
    if (!container) return;
    if (container.isConnected || (tries || 0) > 20) { mount(container); typeset(container); return; }
    const raf = root.requestAnimationFrame || ((f) => setTimeout(f, 16));
    raf(() => mountWhenConnected(container, (tries || 0) + 1));
  }

  function renderAll(blocks, container, ctx) {
    if (!container) return container;
    arr(blocks).forEach((b) => container.appendChild(render(b, ctx)));
    if (container.isConnected) { mount(container); typeset(container); } else mountWhenConnected(container, 0);
    return container;
  }

  // Controladores montados en scope: [{el, ctrl, kind, diagram}]
  function controllers(scope, kind) {
    const s = scope || document;
    return Array.from(s.querySelectorAll('[data-ctrl]'))
      .filter((el) => el._atlasCtrl && (!kind || el.dataset.ctrl === kind))
      .map((el) => ({ el, ctrl: el._atlasCtrl, kind: el.dataset.ctrl, diagram: el.dataset.diagram || null }));
  }
  function destroyAll(scope) {
    for (const c of controllers(scope)) {
      if (c.ctrl && typeof c.ctrl.destroy === 'function') { try { c.ctrl.destroy(); } catch (e) { /* nada */ } }
      c.el._atlasCtrl = null;
    }
  }

  ATLAS.Blocks = {
    render, renderAll, decorate, mount, controllers, destroyAll, markTrace, typeset,
    fillText, paperLine, run, configFor: (b, ctx) => configFor(b || {}, ctx || {}), canonicalFor,
    fmt: { int: fmtInt, si: fmtSi, ops: fmtOps, shapeNum, shapeSym },
    clearCache: () => runCache.clear(),
    TYPES: Object.keys(R),
    COMPARE_METRICS: Object.keys(METRICS),   // filas con etiqueta y formato propios en el bloque compare (validador y pruebas)
  };
})(typeof window !== 'undefined' ? window : globalThis);
