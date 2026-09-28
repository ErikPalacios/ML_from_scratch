/* =============================================================================
   Ronda de Diseño ML — js/core/registry.js
   Registro de contenido: catálogo (todos los módulos/casos, listos o no), páginas
   registradas por los archivos de contenido, plantillas fijas y búsquedas.
   Sin DOM: se carga también en Node (tools/validate-content.mjs).
   Contrato: docs/SPEC.md §5.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // ---------------------------------------------------------------- constantes
  // Plantilla obligatoria de cada caso (SPEC §6). El orden es información: se respeta siempre.
  const CASE_TEMPLATE = [
    { id: 'enunciado',    num: 1,  title: 'Enunciado' },
    { id: 'aclaracion',   num: 2,  title: 'Preguntas de aclaración' },
    { id: 'requisitos',   num: 3,  title: 'Requisitos' },
    { id: 'estimaciones', num: 4,  title: 'Estimaciones back-of-the-envelope' },
    { id: 'arquitectura', num: 5,  title: 'Arquitectura' },
    { id: 'datos',        num: 6,  title: 'Pipeline de datos y entrenamiento' },
    { id: 'serving',      num: 7,  title: 'Serving' },
    { id: 'evaluacion',   num: 8,  title: 'Evaluación offline y online' },
    { id: 'monitoreo',    num: 9,  title: 'Monitoreo, alertas y reentrenamiento' },
    { id: 'fallas',       num: 10, title: 'Modos de falla y degradación' },
    { id: 'tradeoffs',    num: 11, title: 'Trade-offs' },
    { id: 'costo',        num: 12, title: 'Costo y cómo reducirlo' },
    { id: 'archivos',     num: 13, title: 'Archivos de referencia' },
    { id: 'seguimiento',  num: 14, title: 'Preguntas de seguimiento' },
    { id: 'checklist',    num: 15, title: 'Checklist final' },
  ];

  // Framework de 7 pasos para 45 minutos (SPEC §7.1). Fuente única: m01 y el simulador lo usan.
  const FRAMEWORK = [
    { id: 'aclarar',      num: 1, title: 'Aclarar el problema',                 en: 'Clarify the problem',                  minutes: 5,  from: 0,  to: 5 },
    { id: 'requisitos',   num: 2, title: 'Requisitos y métricas',               en: 'Requirements & metrics',               minutes: 5,  from: 5,  to: 10 },
    { id: 'estimar',      num: 3, title: 'Estimaciones',                        en: 'Back-of-the-envelope estimates',       minutes: 5,  from: 10, to: 15 },
    { id: 'arquitectura', num: 4, title: 'Arquitectura de alto nivel',          en: 'High-level design',                    minutes: 10, from: 15, to: 25 },
    { id: 'profundizar',  num: 5, title: 'Deep dives',                          en: 'Deep dives',                           minutes: 12, from: 25, to: 37 },
    { id: 'operar',       num: 6, title: 'Evaluación, despliegue y monitoreo',  en: 'Evaluation, deployment & monitoring',  minutes: 5,  from: 37, to: 42 },
    { id: 'cerrar',       num: 7, title: 'Fallas, trade-offs y cierre',         en: 'Failure modes, trade-offs & wrap-up',  minutes: 3,  from: 42, to: 45 },
  ];

  // Dimensiones de la rúbrica de autoevaluación (SPEC §7.2). Niveles 1–4 genéricos.
  const RUBRIC_DIMENSIONS = [
    { id: 'aclaracion', title: 'Aclaración', en: 'Problem navigation',
      question: '¿Convertiste un enunciado ambiguo en un problema acotado, con supuestos explícitos?',
      levels: [
        'No hice preguntas: empecé a diseñar sobre supuestos implícitos.',
        'Pregunté algo, pero sin cubrir escala, latencia, datos/labels ni objetivo de negocio.',
        'Cubrí casi todo lo relevante y anoté supuestos, aunque sin priorizar lo que cambia el diseño.',
        'Pregunté justo lo que cambia la arquitectura, fijé supuestos en voz alta y los usé después.',
      ] },
    { id: 'estimaciones', title: 'Estimaciones', en: 'Back-of-the-envelope',
      question: '¿Pusiste números (QPS pico, hardware, memoria, almacenamiento, costo) y los usaste para decidir?',
      levels: [
        'Ningún número.',
        'Algún número suelto, sin pico ni conexión con decisiones.',
        'QPS promedio y pico, hardware y almacenamiento razonables; poco uso en las decisiones.',
        'Números redondos y correctos en orden de magnitud que justificaron decisiones (cuántas GPUs, batching, costo).',
      ] },
    { id: 'arquitectura', title: 'Arquitectura', en: 'High-level design & deep dives',
      question: '¿Separaste camino online y offline, y profundizaste donde el problema lo pedía?',
      levels: [
        'Solo el modelo, o cajas sin flujo de datos claro.',
        'Diagrama de alto nivel correcto pero genérico, sin separar online/offline ni profundizar.',
        'Online y offline separados, componentes justificados, al menos un deep dive sólido.',
        'Diseño simple primero, luego deep dives en los cuellos de botella reales (serving, datos, features) con detalle concreto.',
      ] },
    { id: 'tradeoffs', title: 'Trade-offs', en: 'Trade-offs',
      question: '¿Comparaste alternativas y explicaste por qué elegiste cada pieza?',
      levels: [
        'Elegí herramientas sin justificar (name-dropping).',
        'Mencioné alguna alternativa, sin criterio claro.',
        'Comparé alternativas en los puntos importantes con pros y contras.',
        'Cada decisión con su porqué, alternativa descartada y en qué condición cambiaría de opinión.',
      ] },
    { id: 'monitoreo', title: 'Monitoreo y operación', en: 'Evaluation, monitoring & reliability',
      question: '¿Cubriste evaluación offline/online, despliegue seguro, monitoreo, reentrenamiento y fallas?',
      levels: [
        'No hablé de qué pasa después del despliegue.',
        'Mencioné "monitorear" o "hacer A/B" sin concretar.',
        'Métricas de sistema y de modelo, rollout seguro y reentrenamiento concretos.',
        'Alertas concretas, drift, degradación con gracia, rollback y un plan de reentrenamiento ligado a métricas.',
      ] },
    { id: 'comunicacion', title: 'Comunicación', en: 'Communication',
      question: '¿Llevaste la conversación con estructura, tiempos y chequeos con el entrevistador?',
      levels: [
        'Monólogo desordenado o me quedé sin tiempo sin cubrir lo esencial.',
        'Seguí algo de estructura, pero perdí tiempo en detalles poco importantes.',
        'Estructura clara, buen manejo del tiempo, resumí decisiones.',
        'Conduje la entrevista: agenda al inicio, chequeos frecuentes, adapté el deep dive a las señales del entrevistador y cerré con un resumen.',
      ] },
  ];

  const BLOCK_TYPES = ['p', 'h3', 'list', 'callout', 'table', 'kv', 'steps', 'calc', 'qa', 'followups',
    'tradeoffs', 'checklist', 'quiz', 'diagram', 'code', 'html'];

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

  const MODULE_IDS = Array.from({ length: 15 }, (_, i) => 'm' + String(i + 1).padStart(2, '0'));
  const CASE_IDS = Array.from({ length: 13 }, (_, i) => 'c' + String(i + 1).padStart(2, '0'));

  // ------------------------------------------------------------------ estado
  let catalog = null;                 // lo define js/content/catalog.js
  const registered = {};              // id → página registrada (contenido)
  const extraSections = {};           // id → { sectionId: section } añadidas con addSection
  const problems = [];                // errores de registro (los muestra el validador y la app)

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

  function orderSections(kind, sections) {
    if (kind !== 'case') return sections;
    const pos = {};
    CASE_TEMPLATE.forEach((s, i) => { pos[s.id] = i; });
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
    // Un caso solo está "listo" con sus 15 secciones; un módulo, con al menos una sección.
    merged.ready = merged.kind === 'case'
      ? CASE_TEMPLATE.every((t) => merged.sections.some((s) => s.id === t.id))
      : merged.sections.length > 0;
    // En los casos, cada sección hereda número y título de la plantilla si no los trae.
    if (merged.kind === 'case') {
      merged.sections = merged.sections.map((s) => {
        const t = CASE_TEMPLATE.find((x) => x.id === s.id);
        return t ? Object.assign({ num: t.num, title: t.title }, s) : s;
      });
    }
    return merged;
  }

  function courseOrder() { return MODULE_IDS.concat(CASE_IDS); }

  function listPages(kind) {
    const ids = kind === 'module' ? MODULE_IDS : kind === 'case' ? CASE_IDS : courseOrder();
    return ids.map(getPage).filter(Boolean);
  }

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
      out.push({ type: 'page', id, title: it.title, text: [it.titleEn, it.summary, (it.topics || []).join(' ')].filter(Boolean).join(' · '), href: '#' + id });
    }
    for (const p of pagesWithContent()) {
      for (const s of p.sections) {
        out.push({ type: 'section', id: p.id + '.' + s.id, title: s.title, text: (p.title || p.id) + (s.titleEn ? ' · ' + s.titleEn : ''), href: '#' + p.id + '.' + s.id });
      }
    }
    for (const t of glossary()) {
      out.push({ type: 'term', id: 'term:' + t.en, title: t.en, text: t.es + ' · ' + stripHtml(t.def), href: '#glosario.' + slug(t.en) });
    }
    for (const c of flashcards()) {
      out.push({ type: 'card', id: 'card:' + c.id, title: stripHtml(c.q), text: c.source, href: '#flashcards' });
    }
    return out;
  }

  Object.assign(MSD, {
    CASE_TEMPLATE, FRAMEWORK, RUBRIC_DIMENSIONS, BLOCK_TYPES, CALLOUT_KINDS, MODULE_IDS, CASE_IDS,
    defineCatalog, register, addSection, getPage, listPages, courseOrder, flashcards, glossary, searchIndex,
    slug, stripHtml,
    catalog: () => catalog,
    registryProblems: () => problems.slice(),
    files: MSD.files || {},
  });
})(typeof window !== 'undefined' ? window : globalThis);
