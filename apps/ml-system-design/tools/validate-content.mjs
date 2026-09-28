#!/usr/bin/env node
// Validador del contenido (SPEC §5–§6). Carga registry + catálogo + archivos de contenido en un
// contexto aislado de Node (sin DOM) y comprueba esquema, plantilla de casos, enlaces internos,
// diagramas, bloques de código y HTML en línea.
// Uso: node tools/validate-content.mjs [--quiet] [--json]
// Sale con código 1 si hay errores (los avisos no fallan).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes("--quiet");
const asJson = process.argv.includes('--json');

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(where + ': ' + msg);
const warn = (where, msg) => warnings.push(where + ': ' + msg);

// ------------------------------------------------------------------ carga
const ctx = vm.createContext({ console });
function load(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) { return false; }
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: rel }); return true; }
  catch (e) { err(rel, 'no carga: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); return false; }
}
load('js/core/registry.js');
const contentDir = join(ROOT, 'js', 'content');
const contentFiles = existsSync(contentDir) ? readdirSync(contentDir).filter((f) => f.endsWith('.js')).sort() : [];
const ordered = ['catalog.js', 'reference-files.js'].filter((f) => contentFiles.includes(f))
  .concat(contentFiles.filter((f) => f !== 'catalog.js' && f !== 'reference-files.js'));
if (!contentFiles.includes('catalog.js')) err('js/content', 'falta catalog.js');
for (const f of ordered) load('js/content/' + f);

const MSD = ctx.MSD;
if (!MSD || typeof MSD.getPage !== 'function') { console.error('registry.js no definió MSD'); process.exit(1); }
for (const p of MSD.registryProblems()) err('registry', p);

const catalog = MSD.catalog();
const FILES = MSD.files || {};

// ------------------------------------------------------------------ utilidades
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SPECIAL_IDS = ['inicio', 'practica', 'historial', 'flashcards', 'glosario', 'ref-numeros', 'ref-herramientas', 'ref-comandos'];
const ALL_IDS = MSD.courseOrder().concat(SPECIAL_IDS);
const LANGS = ['python', 'dockerfile', 'yaml', 'bash', 'pbtxt', 'json', 'toml', 'text', 'promql', 'ini'];
const NODE_KINDS = ['client', 'edge', 'service', 'model', 'gpu', 'store', 'queue', 'job', 'monitor', 'external', 'human'];
const EDGE_KINDS = ['online', 'offline', 'async', 'monitor', 'neutral'];
const LANE_KINDS = ['online', 'offline', 'monitor', 'neutral'];
const INLINE_OK = new Set(['b', 'strong', 'i', 'em', 'code', 'a', 'br', 'sub', 'sup', 'kbd', 'span', 'abbr', 'mark', 's', 'small']);
const BLOCK_HTML_OK = new Set([...INLINE_OK, 'p', 'ul', 'ol', 'li', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'details', 'summary', 'h4', 'hr', 'figure', 'figcaption', 'blockquote', 'dl', 'dt', 'dd']);
const VOID = new Set(['br', 'hr', 'img', 'wbr']);
const links = []; // {where, href}
const stats = {};

function checkHtml(where, html, allowBlock) {
  if (html == null) return;
  if (typeof html !== 'string') { err(where, 'se esperaba texto/HTML'); return; }
  if (/<script/i.test(html)) err(where, 'contiene <script>');
  if (/\bon[a-z]+\s*=/i.test(html)) err(where, 'contiene manejadores on*= en línea');
  if (/\b(TODO|TBD|lorem ipsum|FIXME)\b/i.test(html)) err(where, 'contiene TODO/TBD/lorem');
  const ok = allowBlock ? BLOCK_HTML_OK : INLINE_OK;
  const stack = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const closing = m[0][1] === '/';
    if (!ok.has(tag)) { err(where, 'etiqueta no permitida <' + tag + '>' + (allowBlock ? '' : ' (usa un bloque html si de verdad la necesitas)')); continue; }
    if (VOID.has(tag) || m[2] === '/') continue;
    if (!closing) stack.push(tag);
    else {
      const top = stack.pop();
      if (top !== tag) { err(where, 'etiquetas desbalanceadas: esperaba </' + (top || '∅') + '> y encontré </' + tag + '>'); return; }
    }
    if (tag === 'a' && !closing) {
      const h = /href\s*=\s*"([^"]*)"/i.exec(m[0]);
      if (!h) err(where, '<a> sin href entre comillas dobles');
      else if (h[1].startsWith('#')) links.push({ where, href: h[1] });
      else if (!/^https:\/\//.test(h[1])) err(where, 'enlace no permitido: ' + h[1]);
      else if (!/target="_blank"/.test(m[0]) || !/rel="noopener/.test(m[0])) warn(where, 'enlace externo sin target="_blank" rel="noopener": ' + h[1]);
    }
  }
  if (stack.length) err(where, 'etiquetas sin cerrar: ' + stack.join(', '));
  // Un "<" suelto que no abre etiqueta (p. ej. "p99 < 200 ms") rompe el HTML: debe ir como &lt;
  const rest = html.replace(re, '');
  const k = rest.indexOf('<');
  if (k >= 0) err(where, '"<" sin escapar (usa &lt;): …' + rest.slice(Math.max(0, k - 25), k + 25) + '…');
}

function words(html) { return MSD.stripHtml(html).split(/\s+/).filter(Boolean).length; }

// ------------------------------------------------------------------ bloques
function checkBlock(where, b, page, ids) {
  if (!b || typeof b !== 'object') { err(where, 'bloque vacío'); return 0; }
  if (!MSD.BLOCK_TYPES.includes(b.t)) { err(where, 'tipo de bloque desconocido: ' + b.t); return 0; }
  let w = 0;
  const need = (k) => { if (b[k] == null || b[k] === '' || (Array.isArray(b[k]) && !b[k].length)) err(where, 'falta "' + k + '"'); };
  switch (b.t) {
    case 'p': need('html'); checkHtml(where, b.html); w += words(b.html); break;
    case 'h3': need('text'); checkHtml(where, b.text); break;
    case 'html': need('html'); checkHtml(where, b.html, true); w += words(b.html); break;
    case 'list': need('items'); (b.items || []).forEach((it, i) => { checkHtml(where + '[' + i + ']', it); w += words(it); }); break;
    case 'callout':
      if (!MSD.CALLOUT_KINDS[b.kind]) err(where, 'callout kind inválido: ' + b.kind);
      need('html'); checkHtml(where, b.html, true); if (b.title) checkHtml(where, b.title); w += words(b.html); break;
    case 'table':
      need('head'); need('rows');
      (b.head || []).forEach((c, i) => checkHtml(where + '.head[' + i + ']', c));
      (b.rows || []).forEach((r, i) => {
        if (!Array.isArray(r)) { err(where, 'fila ' + i + ' no es arreglo'); return; }
        if (b.head && r.length !== b.head.length) err(where, 'fila ' + i + ' tiene ' + r.length + ' celdas y head ' + b.head.length);
        r.forEach((c, j) => { checkHtml(where + '[' + i + '][' + j + ']', String(c)); w += words(String(c)); });
      });
      if (b.caption) checkHtml(where, b.caption); if (b.note) checkHtml(where, b.note, true); break;
    case 'kv': need('items'); (b.items || []).forEach((it, i) => { if (!Array.isArray(it) || it.length < 2) err(where, 'item ' + i + ' debe ser [label, value, note?]'); else it.forEach((c) => checkHtml(where, String(c))); }); break;
    case 'steps': need('items'); (b.items || []).forEach((it, i) => { if (!it.title) err(where, 'step ' + i + ' sin title'); checkHtml(where, it.title); checkHtml(where, it.meta); checkHtml(where + '[' + i + ']', it.html, true); w += words(it.html); }); break;
    case 'calc':
      need('rows'); (b.rows || []).forEach((r, i) => { if (!r.label || r.value == null) err(where, 'fila ' + i + ' necesita label y value'); ['label', 'expr', 'value', 'note'].forEach((k) => r[k] != null && checkHtml(where + '[' + i + '].' + k, String(r[k]))); });
      if (b.result) checkHtml(where, b.result, true); if (b.title) checkHtml(where, b.title); break;
    case 'qa': need('items'); (b.items || []).forEach((it, i) => { if (!it.q || !it.a) err(where, 'qa ' + i + ' necesita q y a'); checkHtml(where, it.q); checkHtml(where, it.a, true); checkHtml(where, it.why, true); w += words(it.q) + words(it.a) + words(it.why || ''); }); break;
    case 'followups': need('items'); (b.items || []).forEach((it, i) => { if (!it.q || !it.junior || !it.senior) err(where, 'followup ' + i + ' necesita q, junior y senior'); checkHtml(where, it.q); checkHtml(where, it.junior, true); checkHtml(where, it.senior, true); checkHtml(where, it.why, true); w += words(it.q) + words(it.junior) + words(it.senior) + words(it.why || ''); }); break;
    case 'tradeoffs': need('items'); (b.items || []).forEach((it, i) => { if (!it.option || !['elegido', 'descartado', 'depende'].includes(it.verdict)) err(where, 'tradeoff ' + i + ' necesita option y verdict elegido|descartado|depende'); ['option', 'pros', 'cons', 'why'].forEach((k) => checkHtml(where + '[' + i + '].' + k, it[k], true)); w += words(it.pros || '') + words(it.cons || '') + words(it.why || ''); }); break;
    case 'checklist':
      need('id'); need('items');
      if (b.id && !KEBAB.test(b.id)) err(where, 'checklist id no es kebab-case: ' + b.id);
      if (b.id) { if (ids.checklists.has(b.id)) err(where, 'checklist id repetido: ' + b.id); ids.checklists.add(b.id); }
      { const seen = new Set(); (b.items || []).forEach((it, i) => { if (!it.id || !it.html) err(where, 'item ' + i + ' necesita id y html'); if (seen.has(it.id)) err(where, 'item id repetido: ' + it.id); seen.add(it.id); checkHtml(where, it.html); w += words(it.html); }); }
      break;
    case 'quiz': need('items'); (b.items || []).forEach((it, i) => { if (!it.q || !Array.isArray(it.options) || it.options.length < 2 || !(it.answer >= 0 && it.answer < it.options.length)) err(where, 'quiz ' + i + ' inválido (q, options≥2, answer índice)'); checkHtml(where, it.q); (it.options || []).forEach((o) => checkHtml(where, o)); checkHtml(where, it.explain, true); }); break;
    case 'diagram': checkDiagram(where, b, ids); break;
    case 'code': checkCode(where, b); break;
  }
  return w;
}

function checkDiagram(where, b, ids) {
  if (!b.id || !KEBAB.test(b.id)) err(where, 'diagram necesita id kebab-case');
  if (b.id) { if (ids.diagrams.has(b.id)) err(where, 'diagram id repetido: ' + b.id); ids.diagrams.add(b.id); }
  if (!b.title) err(where, 'diagram necesita title');
  const s = b.spec;
  if (!s || !(s.width > 0) || !(s.height > 0)) { err(where, 'spec necesita width/height'); return; }
  const nodes = new Map();
  (s.lanes || []).forEach((l, i) => {
    if (!LANE_KINDS.includes(l.kind || 'neutral')) err(where, 'lane ' + i + ' kind inválido: ' + l.kind);
    if (l.x < 0 || l.y < 0 || l.x + l.w > s.width + 0.01 || l.y + l.h > s.height + 0.01) err(where, 'lane ' + (l.id || i) + ' se sale del lienzo');
  });
  (s.nodes || []).forEach((n, i) => {
    if (!n.id) { err(where, 'nodo ' + i + ' sin id'); return; }
    if (nodes.has(n.id)) err(where, 'nodo repetido: ' + n.id);
    nodes.set(n.id, n);
    if (!NODE_KINDS.includes(n.kind)) err(where, 'nodo ' + n.id + ' kind inválido: ' + n.kind);
    if (!n.label) err(where, 'nodo ' + n.id + ' sin label');
    if ((n.label || '').length > 22) warn(where, 'label largo (>22) en ' + n.id + ': ' + n.label);
    if ((n.sub || '').length > 30) warn(where, 'sub largo (>30) en ' + n.id + ': ' + n.sub);
    if (!(n.w > 0 && n.h > 0)) err(where, 'nodo ' + n.id + ' sin w/h');
    if (n.x < 0 || n.y < 0 || n.x + n.w > s.width + 0.01 || n.y + n.h > s.height + 0.01) err(where, 'nodo ' + n.id + ' se sale del lienzo');
    if (!n.note) warn(where, 'nodo ' + n.id + ' sin note (el "por qué está aquí")');
    checkHtml(where + '.' + n.id, n.note, true);
  });
  // solapamiento de nodos
  const arr = Array.from(nodes.values());
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i], c = arr[j];
    if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) err(where, 'nodos solapados: ' + a.id + ' y ' + c.id);
  }
  const edgeIds = new Set();
  (s.edges || []).forEach((e, i) => {
    if (!nodes.has(e.from) || !nodes.has(e.to)) err(where, 'arista ' + i + ' referencia nodo inexistente: ' + e.from + '>' + e.to);
    if (e.kind && !EDGE_KINDS.includes(e.kind)) err(where, 'arista ' + i + ' kind inválido: ' + e.kind);
    ['fromSide', 'toSide'].forEach((k) => { if (e[k] && !['l', 'r', 't', 'b'].includes(e[k])) err(where, 'arista ' + i + ' ' + k + ' inválido'); });
    (e.via || []).forEach((p) => { if (!Array.isArray(p) || p.length !== 2) err(where, 'arista ' + i + ' via inválido'); });
    edgeIds.add(e.from + '>' + e.to);
    if (e.label) checkHtml(where, e.label);
  });
  (s.flows || []).forEach((f, i) => {
    if (!f.id || !f.label || !Array.isArray(f.steps) || !f.steps.length) err(where, 'flow ' + i + ' necesita id, label, steps');
    (f.steps || []).forEach((st, k) => {
      (st.nodes || []).forEach((n) => { if (!nodes.has(n)) err(where, 'flow ' + f.id + ' paso ' + k + ' nodo inexistente: ' + n); });
      (st.edges || []).forEach((e) => { if (!edgeIds.has(e)) err(where, 'flow ' + f.id + ' paso ' + k + ' arista inexistente: ' + e); });
      if (!st.text) err(where, 'flow ' + f.id + ' paso ' + k + ' sin text');
      checkHtml(where, st.text, true);
    });
  });
  if (b.caption) checkHtml(where, b.caption, true);
}

function checkCode(where, b) {
  if (!Array.isArray(b.files) || !b.files.length) { err(where, 'code necesita files'); return; }
  b.files.forEach((f, i) => {
    const w = where + '.files[' + i + ']';
    if (!f.name) err(w, 'falta name');
    if (!LANGS.includes(f.lang)) err(w, 'lang inválido: ' + f.lang);
    if (f.src) { if (typeof FILES[f.src] !== 'string') err(w, 'src no encontrado en MSD.files (¿corriste tools/embed-reference.mjs?): ' + f.src); }
    else if (!f.code) err(w, 'necesita src o code');
    if (f.note) checkHtml(w, f.note, true);
  });
}

// ------------------------------------------------------------------ catálogo
if (catalog) {
  const items = catalog.items || {};
  for (const id of ALL_IDS) if (!items[id]) err('catalog', 'falta el item ' + id);
  for (const [id, it] of Object.entries(items)) {
    const w = 'catalog.' + id;
    if (it.id !== id) err(w, 'id no coincide con la clave');
    if (!['module', 'case', 'special'].includes(it.kind)) err(w, 'kind inválido');
    if (!it.title) err(w, 'falta title');
    if (!it.short) err(w, 'falta short'); else if (it.short.length > 28) err(w, 'short > 28 caracteres: ' + it.short);
    if (!it.summary) err(w, 'falta summary'); else checkHtml(w + '.summary', it.summary);
    if (it.kind !== 'special') {
      if (!it.titleEn) err(w, 'falta titleEn');
      if (!['alta', 'media', 'baja'].includes(it.freq)) err(w, 'freq inválido');
      if (!Array.isArray(it.topics) || it.topics.length < 3) err(w, 'topics necesita ≥ 3');
      (it.topics || []).forEach((t) => checkHtml(w + '.topics', t));
      if (!(it.minutes > 0)) err(w, 'minutes inválido');
      (it.connects || []).forEach((c) => { if (!ALL_IDS.includes(c)) err(w, 'connects a id inexistente: ' + c); });
      if (!(it.part >= 1 && it.part <= 2)) err(w, 'part inválido');
    }
    if (it.kind === 'case') {
      if (!it.prompt) err(w, 'caso sin prompt'); else checkHtml(w + '.prompt', it.prompt);
      if (!['intro', 'media', 'alta'].includes(it.difficulty)) err(w, 'difficulty inválido');
      if (!Array.isArray(it.tests) || it.tests.length < 2) err(w, 'tests necesita ≥ 2');
    }
  }
  if (!Array.isArray(catalog.roadmap) || !catalog.roadmap.length) err('catalog', 'falta roadmap');
  (catalog.roadmap || []).forEach((r, i) => {
    if (!r.title || !['done', 'next', 'later'].includes(r.status) || !Array.isArray(r.items)) err('catalog.roadmap[' + i + ']', 'necesita title, status done|next|later, items[]');
    (r.items || []).forEach((id) => { if (!ALL_IDS.includes(id)) err('catalog.roadmap[' + i + ']', 'id inexistente: ' + id); });
  });
}

// ------------------------------------------------------------------ páginas registradas
const pages = MSD.listPages().filter((p) => p.sections.length);
for (const page of pages) {
  const where = page.id;
  const ids = { sections: new Set(), checklists: new Set(), diagrams: new Set() };
  let total = 0;
  const blockCount = {};
  if (!catalog || !catalog.items[page.id]) err(where, 'no está en el catálogo');
  for (const s of page.sections) {
    const sw = where + '.' + s.id;
    if (!KEBAB.test(s.id)) err(sw, 'id de sección no es kebab-case');
    if (ids.sections.has(s.id)) err(sw, 'sección repetida'); ids.sections.add(s.id);
    if (!s.title) err(sw, 'falta title');
    if (s.priority && !['core', 'extra', 'skip'].includes(s.priority)) err(sw, 'priority inválido');
    if (!Array.isArray(s.blocks) || !s.blocks.length) { err(sw, 'sin bloques'); continue; }
    s.blocks.forEach((b, i) => { total += checkBlock(sw + '[' + i + ':' + (b && b.t) + ']', b, page, ids); blockCount[b && b.t] = (blockCount[b && b.t] || 0) + 1; });
  }
  if (page.kind === 'case') {
    for (const t of MSD.CASE_TEMPLATE) if (!ids.sections.has(t.id)) err(where, 'falta la sección de plantilla ' + t.num + ' "' + t.id + '"');
    for (const sid of ids.sections) if (!MSD.CASE_TEMPLATE.some((t) => t.id === sid)) err(where, 'sección fuera de la plantilla: ' + sid);
    const has = (sid, t) => { const s = page.sections.find((x) => x.id === sid); return s && s.blocks.some((b) => b.t === t); };
    [['aclaracion', 'qa'], ['estimaciones', 'calc'], ['arquitectura', 'diagram'], ['tradeoffs', 'tradeoffs'], ['archivos', 'code'], ['seguimiento', 'followups'], ['checklist', 'checklist']]
      .forEach(([sid, t]) => { if (ids.sections.has(sid) && !has(sid, t)) err(where + '.' + sid, 'debe incluir un bloque "' + t + '"'); });
    if (!Array.isArray(page.specs) || page.specs.length < 4 || page.specs.length > 6) err(where, 'specs necesita 4–6 pares');
    for (const d of MSD.RUBRIC_DIMENSIONS) {
      const pts = page.rubric && page.rubric[d.id];
      if (!Array.isArray(pts) || pts.length < 3) err(where, 'rubric.' + d.id + ' necesita ≥ 3 puntos clave');
      const seen = new Set();
      (pts || []).forEach((p) => { if (!p.id || !p.text) err(where, 'rubric.' + d.id + ' punto sin id/text'); if (seen.has(p.id)) err(where, 'rubric.' + d.id + ' id repetido: ' + p.id); seen.add(p.id); checkHtml(where + '.rubric', p.text); });
    }
  }
  // flashcards y glosario
  const fseen = new Set();
  (page.flashcards || []).forEach((c, i) => {
    const w = where + '.flashcards[' + i + ']';
    if (!c.id || !c.id.startsWith(page.id + '-')) err(w, 'id debe empezar por "' + page.id + '-"');
    if (fseen.has(c.id)) err(w, 'id repetido'); fseen.add(c.id);
    if (!c.q || !c.a) err(w, 'necesita q y a');
    if (!['concepto', 'numero', 'tradeoff', 'trampa', 'frase'].includes(c.kind)) err(w, 'kind inválido: ' + c.kind);
    checkHtml(w, c.q); checkHtml(w, c.a, true);
  });
  (page.glossary || []).forEach((t, i) => {
    const w = where + '.glossary[' + i + ']';
    if (!t.en || !t.es || !t.def) err(w, 'necesita en, es, def');
    checkHtml(w, t.def, true); if (t.say && /[<>]/.test(t.say)) err(w, 'say debe ser texto plano');
  });
  stats[page.id] = { sections: page.sections.length, words: total, blocks: blockCount, flashcards: (page.flashcards || []).length, glossary: (page.glossary || []).length, ready: page.ready };
}

// ------------------------------------------------------------------ enlaces internos
for (const { where, href } of links) {
  const [pid, sid] = href.slice(1).split('.');
  if (!/^[A-Za-z0-9._~-]+$/.test(href.slice(1))) { err(where, 'hash con caracteres no permitidos: ' + href); continue; }
  if (!ALL_IDS.includes(pid) && !/^practica-c\d\d$/.test(pid)) { err(where, 'enlace a página inexistente: ' + href); continue; }
  if (sid) {
    if (pid === 'glosario') { if (!MSD.glossary().some((t) => MSD.slug(t.en) === sid)) err(where, 'enlace a término de glosario inexistente: ' + href); continue; }
    const p = MSD.getPage(pid);
    if (!p || !p.sections.length) { err(where, 'enlace a sección de una página sin contenido (enlaza solo a la página): ' + href); continue; }
    if (!p.sections.some((s) => s.id === sid)) err(where, 'enlace a sección inexistente: ' + href);
  }
}

// ------------------------------------------------------------------ informe
if (asJson) {
  console.log(JSON.stringify({ errors, warnings, stats }, null, 2));
} else {
  if (!quiet) {
    console.log('[validate] páginas con contenido:');
    for (const [id, s] of Object.entries(stats)) {
      console.log('  ' + id.padEnd(6) + (s.ready ? 'lista ' : 'parcial') + '  secciones ' + String(s.sections).padStart(2) + '  palabras ≈ ' + String(s.words).padStart(6) +
        '  flashcards ' + String(s.flashcards).padStart(3) + '  glosario ' + String(s.glossary).padStart(3) + '  bloques ' + Object.entries(s.blocks).map(([k, v]) => k + ':' + v).join(' '));
    }
    console.log('[validate] archivos embebidos: ' + Object.keys(FILES).length + ' · flashcards totales: ' + MSD.flashcards().length + ' · términos de glosario: ' + MSD.glossary().length);
  }
  for (const w of warnings) console.log('[aviso] ' + w);
  for (const e of errors) console.log('[ERROR] ' + e);
  console.log(errors.length ? '[validate] ' + errors.length + ' errores, ' + warnings.length + ' avisos' : '[validate] OK (' + warnings.length + ' avisos)');
}
process.exit(errors.length ? 1 : 0);
