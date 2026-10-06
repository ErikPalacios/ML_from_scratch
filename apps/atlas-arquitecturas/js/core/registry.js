/* =============================================================================
   Atlas de Arquitecturas — js/core/registry.js
   Basado en apps/ml-system-design/js/core/registry.js.
   Registro de contenido: catálogo (todas las páginas, listas o no), páginas registradas
   por los archivos de contenido, diagramas, plantilla fija de modelo y búsquedas.
   Sin DOM: se carga también en Node (tools/validate-content.mjs, tests).
   Contrato: docs/SPEC.md §5.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // ---------------------------------------------------------------- constantes
  // Plantilla obligatoria de cada página de modelo (SPEC §5.3). El orden es información.
  const MODEL_TEMPLATE = [
    { id: 'para-que',      num: 1,  title: 'Para qué sirve' },
    { id: 'puente',        num: 2,  title: 'Puente con lo que ya sabes' },
    { id: 'diagrama',      num: 3,  title: 'Diagrama de bloques' },
    { id: 'operaciones',   num: 4,  title: 'Operaciones por bloque' },
    { id: 'costo',         num: 5,  title: 'Parámetros y costo' },
    { id: 'entrenamiento', num: 6,  title: 'Entrenamiento' },
    { id: 'inferencia',    num: 7,  title: 'Inferencia' },
    { id: 'fallas',        num: 8,  title: 'Cómo falla y trade-offs' },
    { id: 'variantes',     num: 9,  title: 'Variantes y descendientes' },
    { id: 'entrevista',    num: 10, title: 'Preguntas de entrevista' },
    { id: 'practica',      num: 11, title: 'Práctica activa' },
  ];

  // Tipos de operación (SPEC §3.1): token CSS --op-<id> y --op-<id>-soft.
  const OP_TYPES = [
    { id: 'embed',    title: 'Embeddings y proyecciones', en: 'Embeddings & projections' },
    { id: 'attn',     title: 'Atención',                  en: 'Attention' },
    { id: 'norm',     title: 'Normalización',             en: 'Normalization' },
    { id: 'mlp',      title: 'MLP / FFN',                 en: 'MLP / FFN' },
    { id: 'conv',     title: 'Convolución',               en: 'Convolution' },
    { id: 'fuse',     title: 'Fusión de modalidades',     en: 'Modality fusion' },
    { id: 'head',     title: 'Cabezas de salida y pérdidas', en: 'Output heads & losses' },
    { id: 'tensorop', title: 'Operaciones de tensor (sin parámetros)', en: 'Tensor ops' },
    { id: 'io',       title: 'Entrada / salida',          en: 'Input / output' },
  ];

  // Modalidades (SPEC §3.2): token CSS --mod-<id>.
  const MODALITIES = [
    { id: 'img', title: 'Imagen' },
    { id: 'txt', title: 'Texto' },
    { id: 'act', title: 'Acciones / estado del robot' },
    { id: 'aud', title: 'Audio' },
    { id: 'lat', title: 'Latente / ruido' },
    { id: 'qry', title: 'Queries aprendidas' },
  ];

  // Tipos de arista (SPEC §3.3). shaped = debe nombrar un tensor (su forma sale del calculador).
  const EDGE_KINDS = [
    { id: 'data',     title: 'Flujo de datos',      shaped: true },
    { id: 'residual', title: 'Conexión residual',   shaped: false },
    { id: 'skip',     title: 'Skip connection',     shaped: true },
    { id: 'cross',    title: 'Cross-attention (K, V de otro flujo)', shaped: true },
    { id: 'query',    title: 'Queries aprendidas',  shaped: true },
    { id: 'control',  title: 'Control / máscara',   shaped: false },
  ];

  const BLOCK_TYPES = ['p', 'h3', 'list', 'callout', 'table', 'kv', 'steps', 'calc', 'qa', 'followups',
    'tradeoffs', 'checklist', 'quiz', 'code', 'html',
    'math', 'op', 'trace', 'params', 'flops', 'scaling', 'archdiagram', 'viz', 'compare',
    'blankdiagram', 'shapedrill', 'whatif', 'card', 'formulas'];

  const CALLOUT_KINDS = {
    why: 'El porqué',
    trap: 'Trampa',
    senior: 'Señal senior',
    skip: 'Sáltate esto',
    estimate: 'Estimación — verifica',
    connect: 'Conexión',
    interview: 'Cómo decirlo en la entrevista',
    note: 'Nota',
  };

  // Tipos de página que cuentan en el progreso del curso (SPEC §4.4).
  const COURSE_KINDS = ['recap', 'model'];

  // ------------------------------------------------------------------ estado
  let catalog = null;                 // lo define js/content/catalog.js
  const registered = {};              // id → página registrada (contenido)
  const extraSections = {};           // id → { sectionId: section } añadidas con addSection
  const diagrams = {};                // id → spec de diagrama (SPEC §7.2)
  const problems = [];                // errores de registro (los muestran el validador y la app)

  function note(msg) { problems.push(msg); }

  // ------------------------------------------------------------------ API
  function defineCatalog(c) {
    if (catalog) note('defineCatalog llamado más de una vez; se usa el último.');
    catalog = c;
  }

  function register(page) {
    if (!page || typeof page.id !== 'string') { note('register(): falta id'); return; }
    if (registered[page.id]) note('register(): "' + page.id + '" registrado dos veces; se usa el último.');
    registered[page.id] = page;
  }

  function addSection(pageId, section) {
    if (!section || typeof section.id !== 'string') { note('addSection(' + pageId + '): falta id de sección'); return; }
    (extraSections[pageId] = extraSections[pageId] || {})[section.id] = section;
  }

  function registerDiagram(spec) {
    if (!spec || typeof spec.id !== 'string') { note('registerDiagram(): falta id'); return; }
    if (diagrams[spec.id]) note('registerDiagram(): "' + spec.id + '" registrado dos veces; se usa el último.');
    diagrams[spec.id] = spec;
  }

  function orderSections(kind, sections) {
    if (kind !== 'model') return sections;
    const pos = {};
    MODEL_TEMPLATE.forEach((s, i) => { pos[s.id] = i; });
    return sections.slice().sort((a, b) => (pos[a.id] ?? 999) - (pos[b.id] ?? 999));
  }

  // Página combinada: meta del catálogo + contenido registrado (+ secciones añadidas).
  function getPage(id) {
    const meta = (catalog && catalog.items && catalog.items[id]) || null;
    const content = registered[id] || null;
    if (!meta && !content) return null;
    const merged = Object.assign({}, meta || {}, content || {});
    let sections = (content && Array.isArray(content.sections)) ? content.sections.slice() : [];
    const extra = extraSections[id];
    if (extra) {
      for (const sid of Object.keys(extra)) {
        const i = sections.findIndex((s) => s.id === sid);
        if (i >= 0) sections[i] = extra[sid]; else sections.push(extra[sid]);
      }
    }
    merged.kind = (meta && meta.kind) || (content && content.kind) || 'special';
    merged.sections = orderSections(merged.kind, sections);
    // Un modelo solo está "listo" con sus 11 secciones; las demás páginas, con al menos una.
    merged.ready = merged.kind === 'model'
      ? MODEL_TEMPLATE.every((t) => merged.sections.some((s) => s.id === t.id))
      : merged.kind === 'card' ? false : merged.sections.length > 0;
    if (merged.kind === 'model') {
      merged.sections = merged.sections.map((s) => {
        const t = MODEL_TEMPLATE.find((x) => x.id === s.id);
        return t ? Object.assign({ num: t.num, title: t.title }, s) : s;
      });
    }
    return merged;
  }

  // Orden del curso: repaso + modelos, por bloque y número (catálogo).
  function courseOrder() {
    const items = (catalog && catalog.items) || {};
    return Object.values(items)
      .filter((it) => COURSE_KINDS.indexOf(it.kind) >= 0)
      .sort((a, b) => ((a.block || 0) - (b.block || 0)) || ((a.num || 0) - (b.num || 0)))
      .map((it) => it.id);
  }

  function listPages(kind) {
    const items = (catalog && catalog.items) || {};
    const ids = kind ? Object.keys(items).filter((id) => items[id].kind === kind) : courseOrder();
    const order = courseOrder();
    return ids.map(getPage).filter(Boolean)
      .sort((a, b) => (order.indexOf(a.id) - order.indexOf(b.id)) || ((a.num || 0) - (b.num || 0)));
  }

  function families() { return (catalog && Array.isArray(catalog.families)) ? catalog.families.slice() : []; }

  function pagesWithContent() {
    const ids = new Set(Object.keys(registered).concat(Object.keys(extraSections)));
    return Array.from(ids).map(getPage).filter(Boolean);
  }

  function flashcards() {
    const out = [];
    const seen = new Set();
    const push = (card, source) => {
      if (!card || !card.id || seen.has(card.id)) { if (card && card.id) note('flashcard duplicada: ' + card.id); return; }
      seen.add(card.id);
      out.push(Object.assign({ source }, card));
    };
    for (const p of pagesWithContent()) (p.flashcards || []).forEach((c) => push(c, p.id));
    if (catalog && Array.isArray(catalog.flashcards)) catalog.flashcards.forEach((c) => push(c, c.source || 'general'));
    return out;
  }

  function glossary() {
    const map = new Map();
    const add = (term, source) => {
      if (!term || !term.en) return;
      const key = term.en.toLowerCase();
      const prev = map.get(key);
      if (prev) { if (prev.sources.indexOf(source) < 0) prev.sources.push(source); return; }
      map.set(key, Object.assign({}, term, { sources: [source] }));
    };
    for (const p of pagesWithContent()) (p.glossary || []).forEach((t) => add(t, p.id));
    if (catalog && Array.isArray(catalog.glossary)) catalog.glossary.forEach((t) => add(t, 'general'));
    return Array.from(map.values()).sort((a, b) => a.en.localeCompare(b.en, 'en', { sensitivity: 'base' }));
  }

  function slug(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim(); }

  function searchIndex() {
    const out = [];
    const items = (catalog && catalog.items) || {};
    for (const id of Object.keys(items)) {
      const it = items[id];
      if (it.kind === 'card') {
        out.push({ type: 'page', id, title: it.title, text: [it.titleEn, it.summary].filter(Boolean).join(' · '), href: '#mapa.' + slug(id) });
        continue;
      }
      out.push({ type: 'page', id, title: it.title, text: [it.titleEn, it.summary, (it.topics || []).join(' ')].filter(Boolean).join(' · '), href: '#' + id });
    }
    for (const p of pagesWithContent()) {
      for (const s of p.sections) {
        out.push({ type: 'section', id: p.id + '.' + s.id, title: s.title, text: (p.title || p.id) + (s.titleEn ? ' · ' + s.titleEn : ''), href: '#' + p.id + '.' + s.id });
      }
    }
    // Bloques de los diagramas: buscar "MHSA" lleva al diagrama abierto en ese bloque.
    for (const d of Object.values(diagrams)) {
      if (!d.page || !d.section) continue;
      for (const n of (d.nodes || [])) {
        if (!n.label) continue;
        out.push({ type: 'block', id: d.id + ':' + n.id, title: n.label, text: (d.title || d.id) + (n.sub ? ' · ' + n.sub : ''), href: '#' + d.page + '.' + d.section + '~' + n.id });
      }
    }
    for (const t of glossary()) {
      out.push({ type: 'term', id: 'term:' + t.en, title: t.en, text: t.es + ' · ' + stripHtml(t.def), href: '#glosario.' + slug(t.en) });
    }
    for (const c of flashcards()) {
      out.push({ type: 'card', id: 'card:' + c.id, title: stripHtml(c.q), text: c.source, href: '#flashcards.' + c.id });
    }
    return out;
  }

  Object.assign(ATLAS, {
    MODEL_TEMPLATE, OP_TYPES, MODALITIES, EDGE_KINDS, BLOCK_TYPES, CALLOUT_KINDS, COURSE_KINDS,
    defineCatalog, register, addSection, registerDiagram, getPage, listPages, courseOrder, families,
    flashcards, glossary, searchIndex, slug, stripHtml,
    diagram: (id) => diagrams[id] || null,
    diagrams: () => Object.assign({}, diagrams),
    catalog: () => catalog,
    registryProblems: () => problems.slice(),
    registeredIds: () => Array.from(new Set(Object.keys(registered).concat(Object.keys(extraSections)))),
    sectionOverrides: () => Object.keys(extraSections).flatMap((pid) => Object.keys(extraSections[pid])
      .filter((sid) => registered[pid] && Array.isArray(registered[pid].sections) && registered[pid].sections.some((s) => s && s.id === sid))
      .map((sid) => pid + '.' + sid)),
  });
})(typeof window !== 'undefined' ? window : globalThis);
