#!/usr/bin/env node
// Validador del contenido (SPEC §9.1). Basado en apps/ml-system-design/tools/validate-content.mjs.
// Carga en un contexto aislado de Node (sin DOM) lo mismo que carga index.html, en el mismo orden,
// y comprueba: catálogo, plantilla de modelo, esquema de bloques, enlaces internos y al Laboratorio,
// cantidades {{…}}, ids de tensores/ops contra ATLAS.Arch.run, diagramas (solapes, grilla, cruces),
// papers, glosario y archivos que index.html no carga.
// Uso: node tools/validate-content.mjs [--quiet] [--json]
// Sale con código 1 si hay errores (los avisos no fallan).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const asJson = process.argv.includes('--json');

const errors = [];
const warnings = [];
const infos = [];
const err = (where, msg) => errors.push(where + ': ' + msg);
const warn = (where, msg) => warnings.push(where + ': ' + msg);
const info = (msg) => infos.push(msg);

// ------------------------------------------------------------------ qué carga index.html
const rel = (...p) => p.join('/');
const listJs = (dir) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith('.js') && statSync(join(abs, f)).isFile()).sort().map((f) => rel(dir, f));
};

const indexPath = join(ROOT, 'index.html');
const hasIndex = existsSync(indexPath);
let scripts = [];          // rutas relativas en orden de carga
if (hasIndex) {
  const html = readFileSync(indexPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]+)"[^>]*>/gi)].map((m) => m[1])
    .filter((s) => !/^(https?:)?\/\//.test(s)).map((s) => s.replace(/^\.\//, ''));
  info('index.html: ' + scripts.length + ' scripts locales, cargados en ese orden');
} else {
  // Respaldo: el orden de SPEC §2.1 con los archivos que existen hoy.
  const archOthers = listJs('js/arch').filter((f) => f !== 'js/arch/primitives.js');
  // transformer.js primero (los demás modelos pueden reutilizar su bloque).
  archOthers.sort((a, b) => (b.endsWith('/transformer.js') - a.endsWith('/transformer.js')) || a.localeCompare(b));
  const contentFiles = listJs('js/content').filter((f) => f !== 'js/content/catalog.js');
  const diagramFiles = listJs('js/content/diagrams');
  scripts = [
    'js/core/registry.js', 'js/core/store.js', 'js/arch/primitives.js', ...archOthers, 'js/core/quantities.js',
    'js/ui/dom.js', 'js/ui/math.js', 'js/ui/blocks.js', 'js/ui/archdiagram.js', ...listJs('js/ui/viz'),
    'js/ui/practice.js', 'js/ui/flashcards.js', 'js/ui/reference.js', 'js/content/catalog.js',
    ...diagramFiles, ...contentFiles, 'js/app.js',
  ].filter((f) => existsSync(join(ROOT, f)));
  info('index.html no existe todavía: cargo los archivos que existen en el orden de SPEC §2.1 (' + scripts.length + ' scripts)');
  warn('index.html', 'no existe: no se comprueba qué archivos carga (SPEC §2.1)');
}

// Archivos que la app debe cargar (SPEC §2.1): todo js/arch, js/ui/viz y js/content (+ diagrams).
if (hasIndex) {
  const appAt = scripts.indexOf('js/app.js');
  if (appAt < 0) err('index.html', 'no carga js/app.js');
  const must = [...listJs('js/arch'), ...listJs('js/ui/viz'), ...listJs('js/content'), ...listJs('js/content/diagrams')];
  for (const f of must) {
    const i = scripts.indexOf(f);
    if (i < 0) err('index.html', f + ' existe pero index.html no lo carga: la app no lo verá');
    else if (appAt >= 0 && i > appAt) err('index.html', f + ' se carga después de js/app.js');
  }
  for (const f of scripts) if (!existsSync(join(ROOT, f))) err('index.html', 'carga ' + f + ', que no existe');
  const seen = new Set();
  for (const f of scripts) { if (seen.has(f)) err('index.html', f + ' se carga dos veces'); seen.add(f); }
  const order = (f) => scripts.indexOf(f);
  const before = (a, b) => { if (order(a) >= 0 && order(b) >= 0 && order(a) > order(b)) err('index.html', a + ' debe cargarse antes que ' + b + ' (SPEC §2.1)'); };
  before('js/core/registry.js', 'js/content/catalog.js');
  before('js/arch/primitives.js', 'js/core/quantities.js');
  for (const f of listJs('js/arch')) if (f !== 'js/arch/primitives.js') before('js/arch/primitives.js', f);
  for (const f of [...listJs('js/content'), ...listJs('js/content/diagrams')]) if (f !== 'js/content/catalog.js') before('js/content/catalog.js', f);
}

// ------------------------------------------------------------------ carga en el vm
const ctx = vm.createContext({ console });
const noDom = (f) => /^js\/(core|arch|content)\//.test(f);
const loaded = [];
function load(f) {
  const p = join(ROOT, f);
  if (!existsSync(p)) return false;
  try { vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f }); loaded.push(f); return true; }
  catch (e) {
    const msg = 'no carga en Node: ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e);
    // core/arch/content no pueden tocar el DOM al cargar (SPEC §1); la UI sí puede, y entonces no se valida aquí.
    if (noDom(f)) err(f, msg); else warn(f, msg + ' (archivo de UI: no se valida en Node)');
    return false;
  }
}
const rawPages = {};       // páginas tal como las registra cada archivo (antes de reordenar secciones)
for (const f of scripts) {
  if (f === 'js/app.js') continue;     // arranca la app: necesita el DOM
  load(f);
  const A = ctx.ATLAS;
  if (f === 'js/core/registry.js' && A && typeof A.register === 'function' && !A.__wrapped) {
    const orig = A.register;
    A.register = function (page) { if (page && typeof page.id === 'string') rawPages[page.id] = page; return orig.apply(this, arguments); };
    A.__wrapped = true;
  }
}

const ATLAS = ctx.ATLAS;
if (!ATLAS || typeof ATLAS.getPage !== 'function') { console.error('[validate] registry.js no definió ATLAS'); process.exit(1); }
for (const p of ATLAS.registryProblems()) err('registry', p);
for (const x of (ATLAS.sectionOverrides ? ATLAS.sectionOverrides() : [])) warn('registry', 'addSection reemplaza la sección ' + x + ' que el archivo principal ya registra');

const catalog = ATLAS.catalog();
if (!catalog) err('catalog', 'js/content/catalog.js no llamó a ATLAS.defineCatalog');
const items = (catalog && catalog.items) || {};
const Arch = ATLAS.Arch || null;
const Q = ATLAS.Quantities || null;
if (!Arch) err('js/arch', 'ATLAS.Arch no está definido: se omiten las comprobaciones contra el calculador');
if (!Q) err('js/core/quantities.js', 'ATLAS.Quantities no está definido: no se pueden resolver las cantidades {{…}}');

// ------------------------------------------------------------------ constantes
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KINDS = ['recap', 'model', 'card', 'special'];
const OP_IDS = (ATLAS.OP_TYPES || []).map((o) => o.id);
const MOD_IDS = (ATLAS.MODALITIES || []).map((o) => o.id);
const EDGE = Object.fromEntries((ATLAS.EDGE_KINDS || []).map((e) => [e.id, e]));
const REL_KINDS = ['hereda', 'usa', 'contrasta', 'reemplaza'];
const CARD_KINDS = ['forma', 'formula', 'conteo', 'concepto', 'tradeoff', 'trampa'];
const LANGS = ['python', 'bash', 'json', 'text', 'yaml', 'js', 'javascript', 'pseudo'];
const LAB_TABS = ['paso', 'entrenamiento', 'generacion', 'datos'];
const SIDES = ['left', 'right', 'top', 'bottom'];   // los nombres que entiende js/ui/archdiagram.js
const SPECIAL_IDS = ['inicio', 'mapa', 'practica', 'flashcards', 'ref-formas', 'glosario', 'buscar'];
const INLINE_OK = new Set(['b', 'strong', 'i', 'em', 'code', 'a', 'br', 'sub', 'sup', 'kbd', 'span', 'abbr', 'mark', 's', 'small']);
const BLOCK_HTML_OK = new Set([...INLINE_OK, 'p', 'ul', 'ol', 'li', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'details', 'summary', 'h4', 'hr', 'figure', 'figcaption', 'blockquote', 'dl', 'dt', 'dd']);
const VOID = new Set(['br', 'hr', 'img', 'wbr']);
// Métricas con etiqueta propia en el bloque compare (js/ui/blocks.js METRICS).
const COMPARE_METRICS = ['params', 'paramsM', 'macs', 'flops', 'tokens', 'patches', 'D', 'L', 'h', 'Dmlp', 'P', 'res'];

// ids de §13.3 (contrato del catálogo)
const REQUIRED_IDS = {
  recap: ['repaso-atencion'],
  model: ['vit', 'swin', 'clip', 'detr', 'grounding-dino', 'yolo-world', 'sam', 'sam2', 'llm-decoder', 'llm-inferencia',
    'llava', 'qwen2-vl', 'stable-diffusion', 'dit', 'rt2', 'openvla', 'pi0', 'lora', 'rlhf-dpo', 'bert', 'retrieval', 'ann',
    't5', 'whisper', 'two-tower', 'dlrm', 'gbdt', 'bytetrack', 'depth', 'pointnet', 'rl-ppo', 'imitation'],
  card: ['resnet', 'yolo', 'gnn', 'mamba', 'gan', 'rnn-lstm', 'nerf-3dgs'],
  special: SPECIAL_IDS,
};
const REQUIRED_FAMILIES = ['transformer', 'cnn', 'vit', 'contrastive', 'detect', 'seg', 'llm', 'vlm', 'gen', 'vla', 'encoder',
  'encdec', 'align', 'search', 'recsys', 'trees', 'robot', 'otros'];

const links = [];   // {where, href}
const stats = {};

// ------------------------------------------------------------------ calculador (memo + tolerante a fallas)
const runCache = new Map();
function run(configId) {
  if (!Arch || !configId) return null;
  if (runCache.has(configId)) return runCache.get(configId);
  let r = null;
  try { r = Arch.run(configId); } catch (e) { r = null; }
  runCache.set(configId, r);
  return r;
}
// Fase 6: edge.ov / node.ov / tensors[].ov = knobs del calculador solo para esa arista, nodo o glifo (p. ej. {decode: 1}:
// el carril de decode dentro de un diagrama de prefill). Igual que js/ui/archdiagram.js ovRun: la misma config con
// esos overrides. Devuelve null si el calculador rechaza el ov (el validador lo reporta).
function runOv(configId, ov) {
  if (!ov) return run(configId);
  if (!Arch || !configId) return null;
  const key = configId + '|' + JSON.stringify(ov);
  if (runCache.has(key)) return runCache.get(key);
  let r = null;
  try { r = Arch.run(configId, ov); } catch (e) { r = null; }
  runCache.set(key, r);
  return r;
}
const allConfigs = (() => { try { return Arch && Arch.configs ? Arch.configs() : []; } catch (e) { err('ATLAS.Arch.configs', String(e && e.message || e)); return []; } })();
const configIds = new Set(allConfigs.map((c) => c.id));
const modelIds = new Set((() => { try { return Arch && Arch.models ? Arch.models() : []; } catch (e) { return []; } })());
for (const c of allConfigs) {
  try { Arch.run(c.id); } catch (e) { err('ATLAS.Arch.run(' + c.id + ')', 'falla: ' + (e && e.message || e)); }
}
const canonicalOf = (modelId) => {
  const cs = allConfigs.filter((c) => c.model === modelId);
  return (cs.find((c) => c.canonical) || cs[0] || {}).id || null;
};
const primIds = new Set((() => { try { return Arch && Arch.primitives ? Arch.primitives().map((p) => p.id) : []; } catch (e) { return []; } })());

// Cantidades {{…}}
function quantityOk(key) {
  if (!Q) return false;
  try {
    if (typeof Q.has === 'function') return !!Q.has(key);
    if (typeof Q.get === 'function') { const v = Q.get(key); return v !== undefined && v !== null && !(v && typeof v === 'object' && v.error); }
    if (typeof Q.resolve === 'function') { const v = Q.resolve(key); return v !== undefined && v !== null; }
    if (typeof Q.keys === 'function') { const cfg = key.split('.')[0]; return (Q.keys(cfg) || []).includes(key); }
  } catch (e) { return false; }
  return false;
}
function quantityKeysFor(configId) {
  if (!Q || typeof Q.keys !== 'function') return [];
  try { return (Q.keys(configId) || []).map((k) => (k.startsWith(configId + '.') ? k : configId + '.' + k)); } catch (e) { return []; }
}
function quantityRaw(key) {
  if (!Q || typeof Q.get !== 'function') return undefined;
  try { const v = Q.get(key); return v && typeof v === 'object' && 'value' in v ? v.value : v; } catch (e) { return undefined; }
}
// Mismo patrón que ATLAS.Quantities (las claves no llevan barras ni llaves: el LaTeX {{…}} no choca).
const QTY = /\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g;
// Config por defecto de las cantidades sin prefijo ({{metrics.x}}, {{cfg.T}}): la del diagrama que se está revisando
// (archdiagram.js resuelve el texto de un diagrama con Quantities.fill(html, {config})). En las páginas no hay: las
// cantidades llevan su config ({{llama3-8b.metrics.x}}).
let qDefaultConfig = null;
function checkQuantities(where, s) {
  if (typeof s !== 'string' || s.indexOf('{{') < 0) return;
  for (const m of s.matchAll(QTY)) {
    const key = m[1];
    const cfg = key.split('.')[0];
    if (Arch && !configIds.has(cfg)) {
      if (qDefaultConfig && Q && typeof Q.has === 'function') {
        let ok = false;
        try { ok = !!Q.has(key, { config: qDefaultConfig }); } catch (e) { ok = false; }
        if (!ok) err(where, 'cantidad desconocida {{' + key + '}} (con la config del diagrama, ' + qDefaultConfig + ')');
        continue;
      }
      err(where, 'cantidad {{' + key + '}}: la config "' + cfg + '" no existe en el calculador'); continue;
    }
    if (!quantityOk(key)) err(where, 'cantidad desconocida {{' + key + '}}');
  }
  const rest = s.replace(QTY, '');
  const open = /\{\{\s*[A-Za-z0-9_.\-]+(?!\s*\}\})/.exec(rest);
  if (open && /^\{\{\s*[a-z0-9]+(-[a-z0-9]+)*\./.test(open[0])) err(where, 'cantidad {{…}} sin cerrar: ' + open[0]);
}
// Solo prosa: campos que el lector ve como texto (no ids, configs, tex ni opciones de bloques).
const NOT_PROSE = new Set(['t', 'id', 'model', 'config', 'configs', 'diagram', 'pool', 'block', 'in', 'out', 'tex', 'kind', 'walk',
  'change', 'ask', 'values', 'knobs', 'show', 'prims', 'models', 'slots', 'files', 'family', 'priority', 'answer', 'options']);
function walkProse(where, obj, fn, depth = 0) {
  if (depth > 12 || obj == null) return;
  if (typeof obj === 'string') { fn(where, obj); return; }
  if (Array.isArray(obj)) { obj.forEach((x, i) => walkProse(where + '[' + i + ']', x, fn, depth + 1)); return; }
  if (typeof obj === 'object') {
    if (obj.t === 'compare') return;   // rows = claves de métricas
    for (const k of Object.keys(obj)) if (!NOT_PROSE.has(k)) walkProse(where + '.' + k, obj[k], fn, depth + 1);
  }
}
// Recorre todas las cadenas de un objeto (para {{…}}).
function walkStrings(where, obj, fn, depth = 0) {
  if (depth > 12 || obj == null) return;
  if (typeof obj === 'string') { fn(where, obj); return; }
  if (Array.isArray(obj)) { obj.forEach((x, i) => walkStrings(where + '[' + i + ']', x, fn, depth + 1)); return; }
  if (typeof obj === 'object') for (const k of Object.keys(obj)) walkStrings(where + '.' + k, obj[k], fn, depth + 1);
}

// ------------------------------------------------------------------ HTML en línea
function checkLatex(where, s) {
  const count = (re) => (s.match(re) || []).length;
  if (count(/\\\(/g) !== count(/\\\)/g)) err(where, 'LaTeX en línea desbalanceado: \\( y \\) no coinciden');
  if (count(/\\\[/g) !== count(/\\\]/g)) err(where, 'LaTeX en bloque desbalanceado: \\[ y \\] no coinciden');
}
function checkTex(where, tex) {
  if (typeof tex !== 'string' || !tex.trim()) { err(where, 'falta tex'); return; }
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth < 0) break; }
  }
  if (depth !== 0) err(where, 'tex con llaves desbalanceadas: ' + tex.slice(0, 60));
  if (/\\\(|\\\)/.test(tex)) warn(where, 'tex no debe llevar delimitadores \\( \\): ' + tex.slice(0, 40));
}
function checkHtml(where, html, allowBlock) {
  if (html == null) return;
  if (typeof html !== 'string') { err(where, 'se esperaba texto/HTML'); return; }
  if (/<script/i.test(html)) err(where, 'contiene <script>');
  if (/<[^>]*\son[a-z]+\s*=/i.test(html)) err(where, 'contiene manejadores on*= en línea');
  if (/(^|[^\p{L}])(TODO|TBD|FIXME)(?![\p{L}])/u.test(html) || /lorem ipsum/i.test(html)) err(where, 'contiene TODO/TBD/FIXME/lorem');
  checkLatex(where, html);
  checkQuantities(where, html);
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
    if (tag === 'span' && !closing) {
      const c = /class\s*=\s*"([^"]*)"/i.exec(m[0]);
      if (c && !c[1].split(/\s+/).every((x) => ['en', 'est', 'mono', 'muted', 'nowrap'].includes(x))) warn(where, '<span class="' + c[1] + '"> fuera de la lista (en, est)');
    }
    if (tag === 'a' && !closing) {
      const h = /href\s*=\s*"([^"]*)"/i.exec(m[0]);
      if (!h) err(where, '<a> sin href entre comillas dobles');
      else if (h[1].startsWith('#')) links.push({ where, href: h[1] });
      else if (h[1].startsWith('lab:')) {
        const t = h[1].slice(4);
        if (!LAB_TABS.includes(t) && !/^paso-[1-9]\d*$/.test(t)) err(where, 'enlace al Laboratorio desconocido: ' + h[1] + ' (usa lab:' + LAB_TABS.join(' | lab:') + ' o lab:paso-<n>)');
      }
      else if (!/^https:\/\//.test(h[1])) err(where, 'enlace no permitido: ' + h[1]);
      else if (!/target="_blank"/.test(m[0]) || !/rel="noopener/.test(m[0])) warn(where, 'enlace externo sin target="_blank" rel="noopener": ' + h[1]);
    }
  }
  if (stack.length) err(where, 'etiquetas sin cerrar: ' + stack.join(', '));
  // Un "<" suelto rompe el HTML: en prosa va como &lt; y en LaTeX como \lt
  const rest = html.replace(re, '');
  const k = rest.indexOf('<');
  if (k >= 0) err(where, '"<" sin escapar (usa &lt; en prosa o \\lt en LaTeX): …' + rest.slice(Math.max(0, k - 25), k + 25) + '…');
}
function words(html) { return ATLAS.stripHtml(String(html || '').replace(QTY, '0')).split(/\s+/).filter(Boolean).length; }

// ------------------------------------------------------------------ diagramas registrados
const diagrams = ATLAS.diagrams ? ATLAS.diagrams() : {};
const vizNames = (() => {
  const names = new Set();
  try { if (ATLAS.Viz && typeof ATLAS.Viz.names === 'function') ATLAS.Viz.names().forEach((n) => names.add(n)); } catch (e) { /* sin lista */ }
  try { if (ATLAS.Viz && typeof ATLAS.Viz.list === 'function') ATLAS.Viz.list().forEach((n) => names.add(typeof n === 'string' ? n : n.name)); } catch (e) { /* sin lista */ }
  // Respaldo estático: los archivos de js/ui/viz registran con ATLAS.Viz.register('<nombre>', …).
  for (const f of listJs('js/ui/viz')) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/register\(\s*['"]([a-z0-9-]+)['"]/g)) names.add(m[1]);
  }
  return names;
})();

// Ruteo ortogonal: copia de la lógica pura de js/ui/archdiagram.js (autoSides/attach/routeEdge),
// en unidades de grilla, para contar los cruces que de verdad se dibujan.
const NORMAL = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const nearly = (a, b) => Math.abs(a - b) < 0.5 / 8;   // el renderer usa 0.5 px con 1 unidad = 8 px
function attachPt(r, side, at) {
  const t = at == null ? 0.5 : at;
  if (side === 'left') return [r.x, r.y + r.h * t];
  if (side === 'right') return [r.x + r.w, r.y + r.h * t];
  if (side === 'top') return [r.x + r.w * t, r.y];
  return [r.x + r.w * t, r.y + r.h];
}
function autoSides(dir, a, b) {
  const below = b.y >= a.y + a.h - 1 / 8, above = b.y + b.h <= a.y + 1 / 8;
  const right = b.x >= a.x + a.w - 1 / 8, left = b.x + b.w <= a.x + 1 / 8;
  const order = dir === 'tb'
    ? [[below, 'bottom', 'top'], [above, 'top', 'bottom'], [right, 'right', 'left'], [left, 'left', 'right']]
    : [[right, 'right', 'left'], [left, 'left', 'right'], [below, 'bottom', 'top'], [above, 'top', 'bottom']];
  for (const [c, f, t] of order) if (c) return [f, t];
  return dir === 'tb' ? ['bottom', 'top'] : ['right', 'left'];
}
function polyline(e, a, b, dir) {
  let [fs, ts] = autoSides(dir, a, b);
  if (e.fromSide) fs = e.fromSide;
  if (e.toSide) ts = e.toSide;
  const A = attachPt(a, fs, e.fromAt), B = attachPt(b, ts, e.toAt);
  const targets = (e.via || []).filter((v) => Array.isArray(v) && v.length === 2).map((v) => [v[0], v[1]]).concat([B]);
  const pts = [A];
  let heading = NORMAL[fs] || [0, 1];
  targets.forEach((q, i) => {
    const p = pts[pts.length - 1];
    const last = i === targets.length - 1;
    if (nearly(p[0], q[0]) || nearly(p[1], q[1])) pts.push(q);
    else {
      const hHor = heading[1] === 0;
      if (last) {
        const eHor = ts === 'left' || ts === 'right';
        if (hHor && eHor) { const mx = e.midX != null ? e.midX : (p[0] + q[0]) / 2; pts.push([mx, p[1]], [mx, q[1]], q); }
        else if (!hHor && !eHor) { const my = e.midY != null ? e.midY : (p[1] + q[1]) / 2; pts.push([p[0], my], [q[0], my], q); }
        else if (hHor) pts.push([q[0], p[1]], q);
        else pts.push([p[0], q[1]], q);
      } else if (hHor) pts.push([q[0], p[1]], q);
      else pts.push([p[0], q[1]], q);
    }
    const u = pts[pts.length - 2], w = pts[pts.length - 1];
    if (!(nearly(u[0], w[0]) && nearly(u[1], w[1]))) heading = nearly(u[1], w[1]) ? [Math.sign(w[0] - u[0]), 0] : [0, Math.sign(w[1] - u[1])];
  });
  return pts;
}
// Curva (mapas, edgeRoute:'curve'): copia de curveEdge de js/ui/archdiagram.js (px = unidades × 8).
const OPP = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
function curvePts(e, a, b) {
  const U = 8;
  const R = (o) => ({ x: o.x * U, y: o.y * U, w: o.w * U, h: o.h * U });
  const ra = R(a), rb = R(b);
  const ca = [ra.x + ra.w / 2, ra.y + ra.h / 2], cb = [rb.x + rb.w / 2, rb.y + rb.h / 2];
  const dx = cb[0] - ca[0], dy = cb[1] - ca[1];
  let fs, ts;
  const horiz = Math.abs(dx) - (ra.w + rb.w) / 2 > Math.abs(dy) - (ra.h + rb.h) / 2;
  if (horiz) { fs = dx > 0 ? 'right' : 'left'; ts = OPP[fs]; } else { fs = dy > 0 ? 'bottom' : 'top'; ts = OPP[fs]; }
  if (e.fromSide) fs = e.fromSide;
  if (e.toSide) ts = e.toSide;
  const A = attachPt(ra, fs, e.fromAt), B = attachPt(rb, ts, e.toAt);
  const k = Math.max(16, Math.min(160, Math.hypot(B[0] - A[0], B[1] - A[1]) * (e.bend || 0.4)));
  const na = NORMAL[fs], nb = NORMAL[ts];
  const C1 = [A[0] + na[0] * k, A[1] + na[1] * k], C2 = [B[0] + nb[0] * k, B[1] + nb[1] * k];
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    pts.push([(u * u * u * A[0] + 3 * u * u * t * C1[0] + 3 * u * t * t * C2[0] + t * t * t * B[0]) / U,
      (u * u * u * A[1] + 3 * u * u * t * C1[1] + 3 * u * t * t * C2[1] + t * t * t * B[1]) / U]);
  }
  return pts;
}
const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
function properCross(p1, p2, q1, q2) {
  const o1 = orient(p1, p2, q1), o2 = orient(p1, p2, q2), o3 = orient(q1, q2, p1), o4 = orient(q1, q2, p2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
function crossings(lines) {
  let n = 0;
  const pairs = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    // Aristas que comparten un nodo se tocan en él: no cuentan como cruce.
    const [f1, t1] = lines[i].id.split('>'), [f2, t2] = lines[j].id.split('>');
    if (f1 === f2 || f1 === t2 || t1 === f2 || t1 === t2) continue;
    const A = lines[i].pts, B = lines[j].pts;
    let k = 0;
    for (let a = 1; a < A.length; a++) for (let b = 1; b < B.length; b++) if (properCross(A[a - 1], A[a], B[b - 1], B[b])) k++;
    if (k) { n += 1; pairs.push(lines[i].id + ' × ' + lines[j].id + (k > 1 ? ' (' + k + ' veces)' : '')); }
  }
  return { n, pairs };
}

function checkDiagram(d) {
  const where = 'diagrama ' + d.id;
  if (!KEBAB.test(d.id)) err(where, 'id no es kebab-case');
  if (!['arch', 'map'].includes(d.kind)) err(where, 'kind debe ser arch | map: ' + d.kind);
  if (!d.title) err(where, 'falta title');
  if (!d.caption) warn(where, 'sin caption (la frase que lo hace entendible sin leer la página, SPEC §7.1)');
  checkHtml(where + '.caption', d.caption, false);
  if (d.page) {
    if (!items[d.page]) err(where, 'page desconocida: ' + d.page);
    else if (d.section) {
      const p = ATLAS.getPage(d.page);
      if (p && p.sections.length && !p.sections.some((s) => s.id === d.section)) err(where, 'la página ' + d.page + ' no tiene la sección ' + d.section);
      // page/section dicen dónde vive (búsqueda y rutas ~nodo): una raíz debe estar en un bloque
      // archdiagram de esa sección; una vista expandida, en la misma sección que su padre.
      else if (p && p.sections.length && !d.parent) {
        const homes = p.sections.filter((s) => (s.blocks || []).some((b) => b && b.t === 'archdiagram' && b.diagram === d.id)).map((s) => s.id);
        if (homes.length && !homes.includes(d.section)) err(where, 'section: "' + d.section + '", pero el bloque archdiagram está en ' + d.page + '.' + homes.join(', ') + ' (la búsqueda enlazaría #' + d.page + '.' + d.section + '~nodo a una sección sin el diagrama; usa section: \'' + homes[0] + '\')');
      }
    }
  }
  if (d.parent && diagrams[d.parent] && d.page && (diagrams[d.parent].page !== d.page || diagrams[d.parent].section !== d.section)) {
    err(where, 'page/section (' + d.page + '.' + d.section + ') distintos de los de su padre ' + d.parent + ' (' + diagrams[d.parent].page + '.' + diagrams[d.parent].section + ')');
  }
  if (d.parent) {
    const par = diagrams[d.parent];
    if (!par) err(where, 'parent desconocido: ' + d.parent);
    else if (d.parentNode) {
      const pn = (par.nodes || []).find((n) => n.id === d.parentNode);
      if (!pn) err(where, 'parentNode ' + d.parentNode + ' no existe en ' + d.parent);
      else if (pn.expand !== d.id) warn(where, 'el nodo ' + d.parent + '~' + d.parentNode + ' no tiene expand:"' + d.id + '"');
    }
  }
  const isMap = d.kind === 'map';
  let R = null;
  if (!isMap) {
    if (!d.model) err(where, 'falta model');
    else if (Arch && !modelIds.has(d.model)) err(where, 'model desconocido en el calculador: ' + d.model);
    if (!d.config) err(where, 'falta config');
    else if (Arch && !configIds.has(d.config)) err(where, 'config desconocida en el calculador: ' + d.config);
    else R = run(d.config);
  }
  const g = d.grid || {};
  if (!(g.w > 0 && g.h > 0)) { err(where, 'grid necesita w y h > 0'); return; }
  if (d.direction && !['lr', 'tb'].includes(d.direction)) err(where, 'direction debe ser lr | tb');
  const inside = (o) => o.x >= 0 && o.y >= 0 && o.x + o.w <= g.w + 1e-9 && o.y + o.h <= g.h + 1e-9;
  const boxes = new Map();
  const tensorOk = (id) => !R || !!(R.tensors && R.tensors[id]);
  const opOk = (id) => !R || (R.ops || []).some((o) => o.id === id);
  // ov (fase 6): la arista, el nodo o el glifo se evalúa con run(config, ov), como lo dibuja el motor.
  const ovR = (x, w) => {
    if (!x || !x.ov || !R) return R;
    if (typeof x.ov !== 'object' || Array.isArray(x.ov)) { err(w, 'ov debe ser un objeto de knobs del calculador ({decode: 1})'); return R; }
    const r2 = runOv(d.config, x.ov);
    if (!r2) err(w, 'ov ' + JSON.stringify(x.ov) + ': el calculador no acepta esos knobs para ' + d.config);
    return r2 || R;
  };
  const inRun = (r, id, kind) => !r || !!(kind === 'op' ? (r.ops || []).some((o) => o.id === id) : r.tensors && r.tensors[id]);
  const ovTag = (x) => (x && x.ov ? ', ov ' + JSON.stringify(x.ov) : '');
  // Corridas que usa el diagrama (la base y las de cada ov): un paso del recorrido o un hueco puede nombrar un tensor
  // que solo existe en el carril con ov (k-past, k-ctx…).
  const ovRuns = [];
  if (R) [].concat(d.edges || [], d.nodes || [], d.tensors || []).forEach((x) => { if (x && x.ov && typeof x.ov === 'object') { const r2 = runOv(d.config, x.ov); if (r2 && !ovRuns.includes(r2)) ovRuns.push(r2); } });
  const tensorOkAny = (id) => tensorOk(id) || ovRuns.some((r2) => !!(r2.tensors && r2.tensors[id]));
  (d.groups || []).forEach((gr, i) => {
    const w = where + '.groups[' + (gr.id || i) + ']';
    if (!gr.id) { err(w, 'sin id'); return; }
    if (boxes.has(gr.id)) err(w, 'id repetido: ' + gr.id);
    boxes.set(gr.id, Object.assign({ group: true }, gr));
    if (![gr.x, gr.y, gr.w, gr.h].every(Number.isFinite) || !(gr.w > 0 && gr.h > 0)) err(w, 'necesita x, y, w, h');
    else if (!inside(gr)) err(w, 'se sale de la grilla ' + g.w + '×' + g.h);
    if (gr.modality && !MOD_IDS.includes(gr.modality)) err(w, 'modality desconocida: ' + gr.modality);
    if (gr.repeat && R && gr.repeat.from && R.config && R.config[gr.repeat.from] === undefined) err(w, 'repeat.from "' + gr.repeat.from + '" no es un campo de la config ' + d.config);
  });
  const nodes = [];
  (d.nodes || []).forEach((n, i) => {
    const w = where + '.nodes[' + (n.id || i) + ']';
    if (!n.id) { err(w, 'sin id'); return; }
    if (boxes.has(n.id)) {
      // En el mapa, familia y modelo pueden compartir id (§13.3: la familia "vit" y el modelo "vit").
      if (isMap && boxes.get(n.id).group) warn(w, 'el nodo "' + n.id + '" comparte id con una región; las aristas y #mapa~' + n.id + ' van al nodo');
      else err(w, 'id repetido: ' + n.id);
    }
    boxes.set(n.id, n);
    nodes.push(n);
    if (!isMap) {
      if (!OP_IDS.includes(n.op)) err(w, 'op desconocido: ' + n.op + ' (usa ' + OP_IDS.join(', ') + ')');
      if (!n.label) err(w, 'sin label');
    } else if (!items[n.id] && !items[n.ref] && !(catalog && (catalog.families || []).some((f) => f.id === n.id || f.id === n.ref))) {
      warn(w, 'nodo del mapa que no es un id del catálogo (usa ref:"<id>")');
    }
    if (![n.x, n.y, n.w, n.h].every(Number.isFinite) || !(n.w > 0 && n.h > 0)) err(w, 'necesita x, y, w, h');
    else if (!inside(n)) err(w, 'se sale de la grilla ' + g.w + '×' + g.h + ' (x=' + n.x + ', y=' + n.y + ', w=' + n.w + ', h=' + n.h + ')');
    if (n.shape && !['add', 'concat', 'split', 'pool', 'flatten', 'mul', 'rect', 'pill'].includes(n.shape)) err(w, 'shape desconocida: ' + n.shape);
    if (n.expand && !diagrams[n.expand]) err(w, 'expand a un diagrama no registrado: ' + n.expand);
    const nR = isMap ? null : ovR(n, w);
    (n.ops || []).forEach((o) => { if (!inRun(nR, o, 'op')) err(w, 'op del calculador desconocida: ' + o + ' (' + d.config + ovTag(n) + ')'); });
    if (n.tex) checkTex(w + '.tex', n.tex);
    if (!isMap && !n.note) warn(w, 'sin note (qué hace y por qué)');
    checkHtml(w + '.note', n.note, true);
    if (n.label && n.label.length > 28) warn(w, 'label largo (> 28): ' + n.label);
  });
  // solapes entre nodos (los grupos los contienen a propósito)
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], c = nodes[j];
    if (a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h) err(where, 'nodos solapados: ' + a.id + ' y ' + c.id);
  }
  const edgeIds = new Set();
  const edgeDup = new Set();
  const dataLines = [];
  const mapLines = [];
  (d.edges || []).forEach((e, i) => {
    const id = e.from + '>' + e.to;
    const w = where + '.edges[' + id + ']';
    const A = boxes.get(e.from), B = boxes.get(e.to);
    if (!A || !B) err(w, 'referencia un nodo inexistente');
    const dupKey = id + '|' + (e.kind || '') + '|' + (e.tensor || '');
    if (edgeDup.has(dupKey)) warn(w, 'arista repetida (mismos nodos, kind y tensor)');
    edgeDup.add(dupKey);
    edgeIds.add(id);
    if (isMap) {
      if (!REL_KINDS.includes(e.kind) && !EDGE[e.kind]) err(w, 'kind desconocido en el mapa: ' + e.kind);
    } else {
      if (!EDGE[e.kind]) err(w, 'kind desconocido: ' + e.kind + ' (usa ' + Object.keys(EDGE).join(', ') + ')');
      else if (EDGE[e.kind].shaped && !e.tensor) err(w, 'arista "' + e.kind + '" sin tensor: su forma debe salir del calculador');
    }
    if (e.tensor && !inRun(isMap ? null : ovR(e, w), e.tensor)) err(w, 'tensor desconocido: ' + e.tensor + ' (' + d.config + ovTag(e) + ')');
    ['fromSide', 'toSide'].forEach((k) => { if (e[k] && !SIDES.includes(e[k])) err(w, k + ' inválido: ' + e[k]); });
    (e.via || []).forEach((p) => {
      if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) err(w, 'via inválido: ' + JSON.stringify(p));
      else if (p[0] < 0 || p[1] < 0 || p[0] > g.w || p[1] > g.h) err(w, 'via fuera de la grilla: ' + JSON.stringify(p));
    });
    if (e.label) checkHtml(w + '.label', e.label);
    if (A && B && [A.x, A.y, A.w, A.h, B.x, B.y, B.w, B.h].every(Number.isFinite)) {
      const curved = (e.route || d.edgeRoute) === 'curve';
      const line = { id, pts: curved ? curvePts(e, A, B) : polyline(e, A, B, d.direction || 'lr') };
      if (e.kind === 'data') dataLines.push(line);
      if (isMap) mapLines.push(line);
    }
  });
  const max = Number.isFinite(d.maxCrossings) ? d.maxCrossings : 0;
  const cx = crossings(dataLines);
  if (cx.n > max) err(where, cx.n + ' cruces de aristas data (máx ' + max + '): ' + cx.pairs.join('; ') + ' — agrega via o mueve nodos');
  if (isMap) {
    // El mapa enruta sus curvas en el motor (js/ui/archdiagram.js): se cuentan los cruces sobre la
    // geometría real (ATLAS.ArchDiagram.geometry) y no sobre la copia local de curvePts, que ya no
    // coincide. Sin el motor (no cargó en Node), se usa la aproximación local.
    const AD = ATLAS.ArchDiagram;
    let lines = mapLines;
    if (AD && typeof AD.geometry === 'function') {
      try { lines = AD.geometry(d).edges.filter((ge) => Array.isArray(ge.pts) && ge.pts.length > 1).map((ge) => ({ id: ge.from + '>' + ge.to, pts: ge.pts })); }
      catch (e) { err(where, 'ATLAS.ArchDiagram.geometry falla: ' + (e && e.message || e)); }
    }
    const cm = crossings(lines);
    if (cm.n > max) warn(where, cm.n + ' cruces entre relaciones del mapa (máx ' + max + '): ' + cm.pairs.slice(0, 8).join('; ') + (cm.pairs.length > 8 ? '…' : ''));
    // Curvas que pasan por detrás de un nodo que no unen o sobre el título de una región: error.
    if (AD && typeof AD.mapCheck === 'function') {
      try {
        const mc = AD.mapCheck(d) || {};
        for (const t of mc.through || []) err(where, 'relación del mapa ' + t + ' (re-enruta con via/bend o mueve nodos)');
        for (const t of mc.overTitle || []) err(where, 'relación del mapa: ' + t);
      } catch (e) { err(where, 'ATLAS.ArchDiagram.mapCheck falla: ' + (e && e.message || e)); }
    } else warn(where, 'ATLAS.ArchDiagram.mapCheck no está disponible en Node: no se comprueba que las curvas eviten nodos y títulos');
  }
  (d.tensors || []).forEach((t, i) => {
    const w = where + '.tensors[' + (t.id || i) + ']';
    if (!t.id) { err(w, 'sin id'); return; }
    if (!inRun(ovR(t, w), t.id)) err(w, 'tensor desconocido: ' + t.id + ' (' + d.config + ovTag(t) + ')');
    if (t.at && t.at.edge && !edgeIds.has(t.at.edge)) err(w, 'at.edge a una arista inexistente: ' + t.at.edge);
    if (t.at && Number.isFinite(t.at.x) && (t.at.x < 0 || t.at.y < 0 || t.at.x > g.w || t.at.y > g.h)) err(w, 'at fuera de la grilla');
    if (t.show && !['glyph', 'label', 'both'].includes(t.show)) err(w, 'show inválido: ' + t.show);
  });
  (d.walks || []).forEach((wk, i) => {
    const w = where + '.walks[' + (wk.id || i) + ']';
    if (!wk.id || !wk.label || !Array.isArray(wk.steps) || !wk.steps.length) { err(w, 'necesita id, label, steps'); return; }
    wk.steps.forEach((st, k) => {
      const ws = w + '.paso ' + (k + 1);
      // Un paso puede abrir un diagrama expandido: sus ids se buscan también allí.
      const sub = st.expand ? diagrams[st.expand] : null;
      if (st.expand && !sub) err(ws, 'expand a un diagrama no registrado: ' + st.expand);
      const subNodes = new Set(((sub && sub.nodes) || []).map((n) => n.id).concat(((sub && sub.groups) || []).map((n) => n.id)));
      const subEdges = new Set(((sub && sub.edges) || []).map((e) => e.from + '>' + e.to));
      const subR = sub && sub.config ? run(sub.config) : null;
      (st.nodes || []).forEach((n) => { if (!boxes.has(n) && !subNodes.has(n)) err(ws, 'nodo inexistente: ' + n); });
      (st.edges || []).forEach((e) => { if (!edgeIds.has(e) && !subEdges.has(e)) err(ws, 'arista inexistente: ' + e); });
      (st.tensors || []).forEach((t) => { if (!tensorOkAny(t) && !(subR && subR.tensors && subR.tensors[t])) err(ws, 'tensor desconocido: ' + t); });
      if (!st.text) err(ws, 'sin text');
      checkHtml(ws, st.text, true);
    });
  });
  if (d.legend && d.legend !== 'auto' && !Array.isArray(d.legend)) err(where, 'legend debe ser "auto" o una lista');
}
for (const d of Object.values(diagrams)) {
  qDefaultConfig = d.kind !== 'map' && d.config && configIds.has(d.config) ? d.config : null;
  try { checkDiagram(d); } finally { qDefaultConfig = null; }
}

// ------------------------------------------------------------------ bloques
// pctx = {pageId, model, config}: la config por defecto de los bloques generados.
function blockConfig(b, pctx) {
  if (b.config) return b.config;
  if (b.model && pctx.model === b.model && pctx.config) return pctx.config;
  return b.model ? canonicalOf(b.model) : pctx.config;
}
function checkModelRef(where, b, pctx) {
  if (!b.model) { err(where, 'falta "model"'); return null; }
  if (Arch && !modelIds.has(b.model)) { err(where, 'model desconocido en el calculador: ' + b.model); return null; }
  const cfg = blockConfig(b, pctx);
  if (b.config && Arch && !configIds.has(b.config)) { err(where, 'config desconocida: ' + b.config); return null; }
  if (b.config && Arch) { const c = allConfigs.find((x) => x.id === b.config); if (c && c.model !== b.model) err(where, 'la config ' + b.config + ' es del modelo ' + c.model + ', no de ' + b.model); }
  return cfg ? run(cfg) : null;
}
function nodeKnown(model, nodeId, R) {
  if (R && R.totals && R.totals.byNode && R.totals.byNode[nodeId]) return true;
  if (R && (R.ops || []).some((o) => (o.path || []).includes(nodeId) || o.node === nodeId)) return true;
  return Object.values(diagrams).some((d) => d.model === model && (d.nodes || []).some((n) => n.id === nodeId));
}
function metricsOk(where, cfg, change) {
  if (!Arch || typeof Arch.metrics !== 'function') { err(where, 'ATLAS.Arch.metrics no existe'); return null; }
  try { return Arch.metrics(cfg, change || {}); } catch (e) { err(where, 'ATLAS.Arch.metrics(' + cfg + ', ' + JSON.stringify(change) + ') falla: ' + (e && e.message || e)); return null; }
}

function checkBlock(where, b, page, ids, pctx) {
  if (!b || typeof b !== 'object') { err(where, 'bloque vacío'); return 0; }
  if (!ATLAS.BLOCK_TYPES.includes(b.t)) { err(where, 'tipo de bloque desconocido: ' + b.t); return 0; }
  let w = 0;
  const need = (k) => { if (b[k] == null || b[k] === '' || (Array.isArray(b[k]) && !b[k].length)) err(where, 'falta "' + k + '"'); };
  switch (b.t) {
    case 'p': need('html'); checkHtml(where, b.html); w += words(b.html); break;
    case 'h3': need('text'); checkHtml(where, b.text); break;
    case 'html': need('html'); checkHtml(where, b.html, true); w += words(b.html); break;
    case 'list': need('items'); (b.items || []).forEach((it, i) => { checkHtml(where + '[' + i + ']', it); w += words(it); }); break;
    case 'callout':
      if (!ATLAS.CALLOUT_KINDS[b.kind]) err(where, 'callout kind inválido: ' + b.kind);
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
    case 'qa': need('items'); (b.items || []).forEach((it, i) => { if (!it.q || !it.a) err(where, 'qa ' + i + ' necesita q y a'); checkHtml(where, it.q); checkHtml(where, it.a, true); checkHtml(where, it.why, true); if (it.say != null) { if (typeof it.say !== 'string' || !it.say.trim()) err(where, 'qa ' + i + ': say debe ser texto'); else checkHtml(where, it.say); } w += words(it.q) + words(it.a) + words(it.why || ''); }); break;
    case 'followups': need('items'); (b.items || []).forEach((it, i) => { if (!it.q || !it.junior || !it.senior) err(where, 'followup ' + i + ' necesita q, junior y senior'); checkHtml(where, it.q); checkHtml(where, it.junior, true); checkHtml(where, it.senior, true); checkHtml(where, it.why, true);
      // say (opcional): la respuesta senior en inglés para decirla tal cual ("Dilo así")
      if (it.say != null) { if (typeof it.say !== 'string' || !it.say.trim()) err(where, 'followup ' + i + ': say debe ser texto (la respuesta senior en inglés)'); else checkHtml(where, it.say); }
      w += words(it.q) + words(it.junior) + words(it.senior) + words(it.why || ''); }); break;
    case 'tradeoffs': need('items'); (b.items || []).forEach((it, i) => { if (!it.option || !['elegido', 'descartado', 'depende'].includes(it.verdict)) err(where, 'tradeoff ' + i + ' necesita option y verdict elegido|descartado|depende'); ['option', 'pros', 'cons', 'why'].forEach((k) => checkHtml(where + '[' + i + '].' + k, it[k], true)); w += words(it.pros || '') + words(it.cons || '') + words(it.why || ''); }); break;
    case 'checklist':
      need('id'); need('items');
      if (b.id && !KEBAB.test(b.id)) err(where, 'checklist id no es kebab-case: ' + b.id);
      if (b.id) { if (ids.checklists.has(b.id)) err(where, 'checklist id repetido: ' + b.id); ids.checklists.add(b.id); }
      { const seen = new Set(); (b.items || []).forEach((it, i) => { if (!it.id || !it.html) err(where, 'item ' + i + ' necesita id y html'); if (seen.has(it.id)) err(where, 'item id repetido: ' + it.id); seen.add(it.id); checkHtml(where, it.html); w += words(it.html); }); }
      break;
    case 'quiz': need('items'); (b.items || []).forEach((it, i) => { if (!it.q || !Array.isArray(it.options) || it.options.length < 2 || !(it.answer >= 0 && it.answer < it.options.length)) err(where, 'quiz ' + i + ' inválido (q, options≥2, answer índice)'); checkHtml(where, it.q); (it.options || []).forEach((o) => checkHtml(where, o)); checkHtml(where, it.explain, true); }); break;
    case 'code':
      if (!Array.isArray(b.files) || !b.files.length) { err(where, 'code necesita files'); break; }
      b.files.forEach((f, i) => { const wf = where + '.files[' + i + ']'; if (!f.name) err(wf, 'falta name'); if (!LANGS.includes(f.lang)) err(wf, 'lang inválido: ' + f.lang); if (!f.code) err(wf, 'falta code'); if (f.note) checkHtml(wf, f.note, true); });
      break;
    // --------------------------------------------------- tipos nuevos del Atlas (SPEC §5.4)
    case 'math': checkTex(where, b.tex); if (b.caption) checkHtml(where + '.caption', b.caption); break;
    case 'op': {
      ['block', 'title', 'tex', 'what', 'why'].forEach(need);
      const R = checkModelRef(where, b, pctx);
      if (b.tex) checkTex(where + '.tex', b.tex);
      checkHtml(where + '.title', b.title); checkHtml(where + '.what', b.what, true); checkHtml(where + '.why', b.why, true);
      w += words(b.what) + words(b.why);
      if (!Array.isArray(b.in) || !b.in.length) err(where, 'falta "in" (ids de tensores)');
      if (!Array.isArray(b.out) || !b.out.length) err(where, 'falta "out" (ids de tensores)');
      if (R) {
        [...(b.in || []), ...(b.out || [])].forEach((t) => { if (!R.tensors || !R.tensors[t]) err(where, 'tensor desconocido: ' + t + ' (' + R.id + ')'); });
        if (b.block && !nodeKnown(b.model, b.block, R)) err(where, 'block "' + b.block + '" no es un nodo del calculador ni de un diagrama de ' + b.model);
      }
      break;
    }
    case 'trace': {
      const R = checkModelRef(where, b, pctx);
      if (R) ['from', 'to'].forEach((k) => { if (b[k] && (!R.tensors || !R.tensors[b[k]])) err(where, k + ' tensor desconocido: ' + b[k]); });
      break;
    }
    case 'params': checkModelRef(where, b, pctx); if (b.group && !['block', 'layer', 'op'].includes(b.group)) err(where, 'group debe ser block | layer | op'); break;
    case 'flops': checkModelRef(where, b, pctx); break;
    case 'scaling': {
      const R = checkModelRef(where, b, pctx);
      need('knobs');
      const cfg = blockConfig(b, pctx);
      let base = null;
      if (R && cfg) base = metricsOk(where, cfg, {});
      (b.knobs || []).forEach((k, i) => {
        if (!k || !k.key || !Array.isArray(k.values) || !k.values.length) { err(where, 'knob ' + i + ' necesita key y values'); return; }
        if (R && cfg) k.values.forEach((v) => metricsOk(where + '.knobs[' + k.key + '=' + v + ']', cfg, { [k.key]: v }));
      });
      if (base) (b.show || []).forEach((m) => { if (!(m in base)) err(where, 'show: métrica desconocida "' + m + '" (ATLAS.Arch.metrics da: ' + Object.keys(base).join(', ') + ')'); });
      break;
    }
    case 'archdiagram': {
      need('diagram');
      const d = diagrams[b.diagram];
      if (b.diagram && !d) err(where, 'diagrama no registrado: ' + b.diagram);
      if (d && b.walk && !(d.walks || []).some((x) => x.id === b.walk)) err(where, 'walk desconocido en ' + b.diagram + ': ' + b.walk);
      if (d && d.page && d.page !== page.id) warn(where, 'el diagrama ' + b.diagram + ' declara page "' + d.page + '"');
      if (b.diagram) ids.diagrams.add(b.diagram);
      if (b.caption) checkHtml(where + '.caption', b.caption, true);
      break;
    }
    case 'viz':
      need('kind');
      if (b.kind && !vizNames.has(b.kind)) err(where, 'visualización no registrada: ' + b.kind + (vizNames.size ? ' (hay: ' + [...vizNames].join(', ') + ')' : ''));
      if (b.caption) checkHtml(where + '.caption', b.caption, true);
      break;
    case 'compare': {
      need('models'); need('rows');
      const runs = (b.models || []).map((m) => {
        if (configIds.has(m)) return run(m);
        if (modelIds.has(m)) return run(canonicalOf(m));
        if (Arch) err(where, 'models: "' + m + '" no es una config ni un modelo del calculador');
        return null;
      }).filter(Boolean);
      (b.rows || []).forEach((k) => {
        const known = runs.length === 0 || COMPARE_METRICS.includes(k) || runs.some((R) => (R.config && k in R.config) || (R.quantities && k in R.quantities) || (R.totals && k in R.totals));
        if (!known) err(where, 'rows: métrica desconocida "' + k + '" (no está en config, quantities ni totals)');
      });
      break;
    }
    case 'blankdiagram': {
      need('diagram'); need('slots');
      const d = diagrams[b.diagram];
      if (b.diagram && !d) { err(where, 'diagrama no registrado: ' + b.diagram); break; }
      const nodeIds = new Set(((d && d.nodes) || []).map((n) => n.id));
      const edgeIds = new Set(((d && d.edges) || []).map((e) => e.from + '>' + e.to));
      (b.slots || []).forEach((s, i) => {
        if (!s || !['label', 'shape', 'op'].includes(s.ask)) err(where, 'slot ' + i + ' ask debe ser label | shape | op');
        const id = s && (s.node || s.edge || s.id);
        if (!id) err(where, 'slot ' + i + ' necesita node o edge');
        else if (!nodeIds.has(id) && !edgeIds.has(id)) err(where, 'slot ' + i + ': ' + id + ' no existe en ' + b.diagram);
        // {node, ask:'shape'} lo pregunta practice.js en la arista que sale del nodo (o en s.tensor).
        // ov (fase 6): el tensor del hueco puede vivir solo en una arista o un nodo con ov (el carril de decode).
        if (s && s.tensor) {
          const Rd = d && d.config ? run(d.config) : null;
          const ovs = [].concat((d && d.edges) || [], (d && d.nodes) || []).filter((x) => x && x.ov && typeof x.ov === 'object').map((x) => runOv(d.config, x.ov)).filter(Boolean);
          if (Rd && !(Rd.tensors && Rd.tensors[s.tensor]) && !ovs.some((r2) => r2.tensors && r2.tensors[s.tensor])) err(where, 'slot ' + i + ': tensor desconocido ' + s.tensor);
        }
        // Un hueco de forma en una arista con ov: la forma tiene que existir en run(config, ov).
        if (s && s.edge && s.ask === 'shape' && d && d.config) {
          const e = (d.edges || []).find((x) => x.from + '>' + x.to === s.edge);
          if (e && e.ov && e.tensor) { const r2 = runOv(d.config, e.ov); if (r2 && !(r2.tensors && r2.tensors[s.tensor || e.tensor])) err(where, 'slot ' + i + ': la arista ' + s.edge + ' (ov ' + JSON.stringify(e.ov) + ') no tiene el tensor ' + (s.tensor || e.tensor)); }
        }
        if (s && s.desc != null && (typeof s.desc !== 'string' || !s.desc.trim())) err(where, 'slot ' + i + ': desc debe ser texto');
      });
      break;
    }
    case 'shapedrill': {
      const R = checkModelRef(where, b, pctx);
      need('pool');
      if (Array.isArray(b.pool) && R) b.pool.forEach((t) => { if (!R.tensors || !R.tensors[t]) err(where, 'pool: tensor desconocido ' + t); });
      else if (b.pool && b.pool !== 'all' && !Array.isArray(b.pool)) err(where, 'pool debe ser "all" o una lista de tensores');
      (b.configs || []).forEach((c) => { if (Arch && !configIds.has(c)) err(where, 'configs: desconocida ' + c); });
      break;
    }
    case 'whatif': {
      need('items');
      const cfg = b.config || (b.model ? canonicalOf(b.model) : pctx.config);
      (b.items || []).forEach((it, i) => {
        const wi = where + '[' + i + ']';
        if (!it || !it.q || !it.change || typeof it.change !== 'object') { err(wi, 'necesita q y change'); return; }
        if (typeof it.ask !== 'string' || !it.ask) err(wi, 'ask debe ser una métrica de ATLAS.Arch.metrics (tokens, params, macs, attnMem, kv, kvCacheBytes…)');
        checkHtml(wi + '.q', it.q); if (it.explain) checkHtml(wi + '.explain', it.explain, true);
        if (Arch && cfg) {
          const m = metricsOk(wi, cfg, it.change);
          const key = it.ask === 'kv' ? 'kvCache' : it.ask;
          if (m && !(key in m) && !(it.ask in m)) err(wi, 'ATLAS.Arch.metrics no da "' + it.ask + '" para ' + cfg);
        }
      });
      break;
    }
    case 'card':
      if (!b.family && !b.model) err(where, 'card necesita family o model');
      if (b.family && !(catalog && (catalog.families || []).some((f) => f.id === b.family))) err(where, 'family desconocida: ' + b.family);
      if (b.model && !items[b.model]) err(where, 'model desconocido en el catálogo: ' + b.model);
      break;
    case 'formulas':
      (b.prims || []).forEach((p) => { if (Arch && !primIds.has(p)) err(where, 'primitiva desconocida: ' + p); });
      if (Arch && !primIds.size) err(where, 'ATLAS.Arch.primitives() está vacío');
      break;
  }
  return w;
}

// ------------------------------------------------------------------ flashcards y glosario
function checkCards(where, cards, prefix) {
  const seen = new Set();
  cards.forEach((c, i) => {
    const w = where + '[' + i + ']';
    if (!c || !c.id || !c.id.startsWith(prefix)) err(w, 'id debe empezar por "' + prefix + '"');
    if (!c) return;
    if (seen.has(c.id)) err(w, 'id repetido'); seen.add(c.id);
    if (!c.q || !c.a) err(w, 'necesita q y a');
    if (!CARD_KINDS.includes(c.kind)) err(w, 'kind inválido: ' + c.kind + ' (usa ' + CARD_KINDS.join(', ') + ')');
    checkHtml(w + '.q', c.q); checkHtml(w + '.a', c.a, true);
  });
}
function checkTerms(where, terms) {
  terms.forEach((t, i) => {
    const w = where + '[' + i + ']';
    if (!t || !t.en || !t.es || !t.def) { err(w, 'necesita en, es, def'); if (!t) return; }
    checkHtml(w, t.def, true); if (t.say && /[<>]/.test(t.say)) err(w, 'say debe ser texto plano');
  });
}

// ------------------------------------------------------------------ catálogo
function checkPaper(where, p, required) {
  if (!p) { if (required) err(where, 'falta paper'); return; }
  if (!p.title) err(where, 'paper sin title');
  if (!p.authors) err(where, 'paper sin authors');
  else if (!/( et al\.| & |^[^,]+$)/.test(p.authors)) warn(where, 'authors debería ser "Apellido et al." (o "A & B"): ' + p.authors);
  if (!p.venue) err(where, 'paper sin venue');
  if (p.arxiv) { if (!/^\d{4}\.\d{4,5}$/.test(p.arxiv)) err(where, 'arxiv con formato inválido: ' + p.arxiv); }
  else if (!p.url) warn(where, 'paper sin arxiv ni url: "' + p.title + '" — verifícalo antes de su fase');
  if (p.url && !/^https:\/\//.test(p.url)) err(where, 'paper.url debe ser https');
}
const familyIds = new Set(((catalog && catalog.families) || []).map((f) => f.id));
if (catalog) {
  for (const [kind, ids] of Object.entries(REQUIRED_IDS)) for (const id of ids) {
    if (!items[id]) err('catalog', 'falta el item ' + id + ' (SPEC §13.3)');
    else if (items[id].kind !== kind) err('catalog.' + id, 'kind debe ser ' + kind + ', es ' + items[id].kind);
  }
  for (const f of REQUIRED_FAMILIES) if (!familyIds.has(f)) err('catalog.families', 'falta la familia ' + f + ' (SPEC §13.3)');
  const famSeen = new Set();
  (catalog.families || []).forEach((f, i) => {
    const w = 'catalog.families[' + (f.id || i) + ']';
    if (!f.id || !KEBAB.test(f.id)) err(w, 'id inválido');
    if (famSeen.has(f.id)) err(w, 'familia repetida'); famSeen.add(f.id);
    if (!f.title || !f.titleEn || !f.summary) err(w, 'necesita title, titleEn y summary');
    if (f.kind !== 'family') err(w, 'kind debe ser "family"');
    checkHtml(w + '.summary', f.summary);
    if (!Object.values(items).some((it) => it.family === f.id)) warn(w, 'familia sin ningún item');
  });
  const blockNums = {};
  for (const [id, it] of Object.entries(items)) {
    const w = 'catalog.' + id;
    if (it.id !== id) err(w, 'id no coincide con la clave');
    if (!KEBAB.test(id)) err(w, 'id no es kebab-case');
    if (!KINDS.includes(it.kind)) err(w, 'kind inválido: ' + it.kind);
    if (!it.title) err(w, 'falta title');
    if (!it.short) err(w, 'falta short'); else if (it.short.length > 28) err(w, 'short > 28 caracteres: ' + it.short);
    if (!it.summary) err(w, 'falta summary'); else checkHtml(w + '.summary', it.summary);
    walkStrings(w, it, checkQuantities);
    if (it.kind === 'special') continue;
    if (!it.titleEn) err(w, 'falta titleEn');
    if (!familyIds.has(it.family)) err(w, 'family desconocida: ' + it.family);
    if (!['alta', 'media', 'baja'].includes(it.freq)) err(w, 'freq inválido (alta | media | baja)');
    if (![1, 2].includes(it.level)) err(w, 'level debe ser 1 o 2');
    if (it.anchor && it.kind !== 'card') err(w, 'anchor solo vale para kind "card"');
    for (const k of ['from', 'to']) {
      if (it[k] !== undefined && !Array.isArray(it[k])) { err(w, k + ' debe ser una lista'); continue; }
      (it[k] || []).forEach((ref) => {
        const star = ref.endsWith('*');
        const rid = star ? ref.slice(0, -1) : ref;
        if (!items[rid]) err(w, k + ' a id inexistente: ' + ref);
        else if (star && !items[rid].anchor) err(w, k + ': "' + ref + '" con * debe ser una tarjeta anchor:true');
        else if (!star && items[rid].anchor) warn(w, k + ': "' + rid + '" es un anchor; escríbelo "' + rid + '*"');
        if (rid === id) err(w, k + ' se apunta a sí mismo');
      });
    }
    checkPaper(w + '.paper', it.paper, it.kind !== 'card' || it.anchor === undefined);
    if (it.kind === 'card') {
      const c = it.card || {};
      if (!c.in || !c.out || !c.idea || !c.uso) err(w, 'card necesita in, out, idea, uso');
      ['in', 'out', 'idea', 'uso', 'tamano'].forEach((k) => c[k] && checkHtml(w + '.card.' + k, c[k]));
      continue;
    }
    // recap y model
    if (!Array.isArray(it.topics) || it.topics.length < 3) err(w, 'topics necesita ≥ 3');
    (it.topics || []).forEach((t) => checkHtml(w + '.topics', t));
    if (!(it.minutes > 0)) err(w, 'minutes inválido');
    if (!Number.isInteger(it.block) || it.block < 0 || it.block > 3) err(w, 'block debe ser 0–3');
    if (!Number.isInteger(it.num)) err(w, 'falta num');
    const bk = it.block + '.' + it.num;
    if (blockNums[bk]) err(w, 'block/num repetido con ' + blockNums[bk] + ': ' + bk); blockNums[bk] = id;
    if (it.card) ['in', 'out', 'idea', 'uso', 'tamano'].forEach((k) => it.card[k] && checkHtml(w + '.card.' + k, it.card[k]));
    else if (it.kind === 'model') warn(w, 'sin card (la tarjeta de nivel 1 del Mapa)');
    if (it.canonical && Arch && configIds.has(it.canonical) && it.model && allConfigs.find((c) => c.id === it.canonical).model !== it.model) err(w, 'canonical ' + it.canonical + ' no es del modelo ' + it.model);
  }
  checkCards('catalog.flashcards', catalog.flashcards || [], 'gen-');
  checkTerms('catalog.glossary', catalog.glossary || []);

  // relaciones tipadas
  const relSeen = new Set();
  (catalog.relations || []).forEach((r, i) => {
    const w = 'catalog.relations[' + i + ']';
    if (!r || !items[r.from] || !items[r.to]) { err(w, 'from/to inexistente: ' + (r && r.from) + ' → ' + (r && r.to)); return; }
    if (items[r.from].kind === 'special' || items[r.to].kind === 'special') err(w, 'una relación no puede apuntar a una página especial');
    if (!REL_KINDS.includes(r.kind)) err(w, 'kind debe ser ' + REL_KINDS.join(' | '));
    const k = r.from + '>' + r.to;
    if (relSeen.has(k)) err(w, 'relación repetida ' + k); relSeen.add(k);
    if (r.label) checkHtml(w + '.label', r.label);
  });
  // El mapa dibuja exactamente estas relaciones (SPEC §5.5).
  const mapSpecs = Object.values(diagrams).filter((d) => d.kind === 'map');
  for (const d of mapSpecs) {
    const nodeRef = new Map((d.nodes || []).map((n) => [n.id, n.ref || n.id]));
    const drawn = new Map();
    for (const e of d.edges || []) if (REL_KINDS.includes(e.kind)) drawn.set((nodeRef.get(e.from) || e.from) + '>' + (nodeRef.get(e.to) || e.to), e.kind);
    for (const r of catalog.relations || []) {
      const k = r.from + '>' + r.to;
      if (!drawn.has(k)) err('diagrama ' + d.id, 'el catálogo tiene la relación ' + k + ' (' + r.kind + ') y el mapa no la dibuja');
      else if (drawn.get(k) !== r.kind) err('diagrama ' + d.id, 'relación ' + k + ': el mapa dice "' + drawn.get(k) + '" y el catálogo "' + r.kind + '"');
    }
    for (const [k, kind] of drawn) if (!relSeen.has(k)) err('diagrama ' + d.id, 'el mapa dibuja ' + k + ' (' + kind + ') que no está en catalog.relations');
  }
  if (!mapSpecs.length) warn('catalog.relations', 'no hay diagrama kind:"map" registrado: no se compara con el mapa');

  // hoja de ruta
  if (!Array.isArray(catalog.roadmap) || !catalog.roadmap.length) err('catalog', 'falta roadmap');
  const nexts = (catalog.roadmap || []).filter((r) => r.status === 'next').length;
  if (nexts > 1) warn('catalog.roadmap', nexts + ' fases en "next" (debería haber una)');
  const inRoadmap = new Set();
  (catalog.roadmap || []).forEach((r, i) => {
    const w = 'catalog.roadmap[' + i + ']';
    if (r.phase !== i + 1) err(w, 'phase debería ser ' + (i + 1));
    if (!r.title || !['done', 'next', 'later'].includes(r.status) || !Array.isArray(r.items)) err(w, 'necesita title, status done|next|later, items[]');
    if (r.note) checkHtml(w + '.note', r.note, true);
    (r.items || []).forEach((id) => { if (!items[id]) err(w, 'id inexistente: ' + id); inRoadmap.add(id); });
    // Solo cuentan las páginas que se llenan con contenido (repaso, modelos, mapa, ref-formas).
    const content = (r.items || []).filter((id) => items[id] && (['recap', 'model'].includes(items[id].kind) || ['mapa', 'ref-formas'].includes(id)));
    const notReady = content.filter((id) => !(ATLAS.getPage(id) || {}).ready);
    if (r.status === 'done' && notReady.length) err(w, 'fase "done" con ítems sin contenido completo: ' + notReady.join(', '));
    if (r.status !== 'done' && content.length && !notReady.length) warn(w, 'todos sus ítems ya tienen contenido: márcala "done" (y la siguiente "next")');
  });
  for (const [id, it] of Object.entries(items)) if (['model', 'recap'].includes(it.kind) && !inRoadmap.has(id)) err('catalog.roadmap', id + ' no está en ninguna fase');
}

// ------------------------------------------------------------------ páginas registradas
const REGISTRABLE = Object.keys(items).filter((id) => ['recap', 'model'].includes(items[id].kind) || ['mapa', 'ref-formas'].includes(id));
for (const id of ATLAS.registeredIds()) if (!REGISTRABLE.includes(id)) err('registry', 'contenido registrado con id desconocido o no registrable: ' + id);

// Valores numéricos del calculador de un modelo (para el aviso "usa {{…}}"). Solo conteos ≥ 10,000:
// las dimensiones (768, 3072, 1024…) se escriben a mano con naturalidad; los conteos de parámetros y
// MACs, no (son los que se desincronizan cuando cambia el calculador).
const MIN_TYPED = 10000;
function numbersOf(modelId) {
  const map = new Map();
  const put = (v, src, min) => { if (Number.isInteger(v) && v >= min && !map.has(v)) map.set(v, src); };
  for (const c of allConfigs.filter((x) => x.model === modelId)) {
    const R = run(c.id); if (!R) continue;
    const t = R.totals || {};
    ['params', 'macs', 'flops', 'other'].forEach((k) => put(t[k], c.id + ' totals.' + k, MIN_TYPED));
    for (const [nid, v] of Object.entries(t.byNode || {})) { put(v.params, c.id + ' node ' + nid + '.params', MIN_TYPED); put(v.macs, c.id + ' node ' + nid + '.macs', MIN_TYPED); }
    for (const o of R.ops || []) { put(o.params, c.id + ' op ' + o.id + '.params', MIN_TYPED); put(o.macs, c.id + ' op ' + o.id + '.macs', MIN_TYPED);
      if (o.repeat > 1) { put(o.params * o.repeat, c.id + ' op ' + o.id + ' ×' + o.repeat, MIN_TYPED); put(o.macs * o.repeat, c.id + ' op ' + o.id + ' ×' + o.repeat, MIN_TYPED); } }
    for (const [k, v] of Object.entries(R.quantities || {})) put(v, c.id + ' quantities.' + k, MIN_TYPED);
  }
  return map;
}
function suggestKey(modelId, value) {
  for (const c of allConfigs.filter((x) => x.model === modelId)) for (const k of quantityKeysFor(c.id)) {
    const raw = quantityRaw(k);
    if (raw === value) return '{{' + k + '}}';
  }
  return '{{…}}';
}
function scanTypedNumbers(where, s, nums, modelId) {
  if (typeof s !== 'string' || !nums.size) return;
  const text = s.replace(QTY, ' ').replace(/<[^>]*>/g, ' ');
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d{3,})(?![\d,]*\d)/g)) {
    const v = parseInt(m[1].replace(/,/g, ''), 10);
    if (nums.has(v)) warn(where, '"' + m[1] + '" coincide con ' + nums.get(v) + ': usa ' + suggestKey(modelId, v));
  }
}

const pages = REGISTRABLE.map(ATLAS.getPage).filter((p) => p && p.sections && p.sections.length);
for (const page of pages) {
  const where = page.id;
  const it = items[page.id] || {};
  const pctx = { pageId: page.id, model: it.model || null, config: (it.canonical && configIds.has(it.canonical)) ? it.canonical : (it.model ? canonicalOf(it.model) : null) };
  const ids = { sections: new Set(), checklists: new Set(), diagrams: new Set() };
  let total = 0;
  const blockCount = {};
  const raw = rawPages[page.id];
  if (raw && raw.kind && it.kind && raw.kind !== it.kind) err(where, 'register() declara kind "' + raw.kind + '" y el catálogo "' + it.kind + '"');
  for (const s of page.sections) {
    const sw = where + '.' + s.id;
    if (!KEBAB.test(s.id || '')) err(sw, 'id de sección no es kebab-case');
    if (ids.sections.has(s.id)) err(sw, 'sección repetida'); ids.sections.add(s.id);
    if (!s.title) err(sw, 'falta title');
    if (s.priority && !['core', 'extra', 'skip'].includes(s.priority)) err(sw, 'priority inválido');
    if (!Array.isArray(s.blocks) || !s.blocks.length) { err(sw, 'sin bloques'); continue; }
    s.blocks.forEach((b, i) => { total += checkBlock(sw + '[' + i + ':' + (b && b.t) + ']', b, page, ids, pctx); blockCount[b && b.t] = (blockCount[b && b.t] || 0) + 1; });
  }
  if (page.kind === 'model') {
    const T = ATLAS.MODEL_TEMPLATE.map((t) => t.id);
    const order = ((raw && raw.sections) || page.sections).map((s) => s.id);
    for (const t of ATLAS.MODEL_TEMPLATE) if (!order.includes(t.id)) err(where, 'falta la sección de plantilla ' + t.num + ' "' + t.id + '"');
    for (const sid of order) if (!T.includes(sid)) err(where, 'sección fuera de la plantilla: ' + sid + ' (las sub-páginas van por el catálogo)');
    const inT = order.filter((x) => T.includes(x));
    const expected = T.filter((x) => inT.includes(x));
    if (inT.join() !== expected.join()) err(where, 'secciones fuera de orden: ' + inT.join(', ') + ' (orden de la plantilla: ' + expected.join(', ') + ')');
    const has = (sid, t) => { const s = page.sections.find((x) => x.id === sid); return s && s.blocks.some((b) => b && b.t === t); };
    [['puente', 'table'], ['diagrama', 'archdiagram'], ['operaciones', 'op'], ['operaciones', 'trace'], ['costo', 'params'], ['costo', 'flops'],
      ['costo', 'scaling'], ['entrevista', 'followups'], ['entrevista', 'qa'], ['practica', 'blankdiagram'], ['practica', 'shapedrill'], ['practica', 'whatif']]
      .forEach(([sid, t]) => { if (ids.sections.has(sid) && !has(sid, t)) err(where + '.' + sid, 'debe incluir un bloque "' + t + '" (SPEC §5.3)'); });
    if (ids.sections.has('entrenamiento') && !has('entrenamiento', 'math')) warn(where + '.entrenamiento', 'sin bloque math (la pérdida con su fórmula)');
    if (ids.sections.has('fallas') && !has('fallas', 'table') && !has('fallas', 'compare') && !has('fallas', 'tradeoffs')) warn(where + '.fallas', 'sin tabla comparativa');
    if (ids.sections.has('entrevista')) {
      const s = page.sections.find((x) => x.id === 'entrevista');
      const traps = s.blocks.some((b) => b && ((b.items || []).some((q) => q && q.trap) || (b.t === 'callout' && b.kind === 'trap')));
      if (!traps) warn(where + '.entrevista', 'ninguna pregunta marcada trap:true');
    }
    if (page.ready && it.canonical && Arch && !configIds.has(it.canonical)) err(where, 'página lista con canonical "' + it.canonical + '" que no existe en el calculador');
  }
  // flashcards y glosario
  checkCards(where + '.flashcards', page.flashcards || [], page.id + '-');
  checkTerms(where + '.glossary', page.glossary || []);
  // {{…}} fuera de los campos html (flashcards, términos…) y números tecleados
  walkStrings(where + '.flashcards', page.flashcards || [], checkQuantities);
  if (pctx.model && Arch) {
    const nums = numbersOf(pctx.model);
    walkProse(where, { sections: page.sections, flashcards: page.flashcards || [] }, (w, s) => scanTypedNumbers(w.replace(/\.sections\[(\d+)\]/, (m0, k) => '.' + (page.sections[k] || {}).id), s, nums, pctx.model));
  }
  stats[page.id] = { sections: page.sections.length, words: total, blocks: blockCount, flashcards: (page.flashcards || []).length, glossary: (page.glossary || []).length, ready: page.ready };
}

// ------------------------------------------------------------------ tarjetas del Mapa (SPEC §5.5)
// El buscador enlaza cada tarjeta de nivel 1 a #mapa.<id>: el Mapa debe tener su bloque card.
{
  const mp = ATLAS.getPage('mapa');
  if (mp && mp.sections.length) {
    const onMap = new Set(), famOnMap = new Set();
    for (const sct of mp.sections) for (const b of sct.blocks || []) if (b && b.t === 'card') { if (b.model) onMap.add(b.model); if (b.family) famOnMap.add(b.family); }
    for (const [id, it] of Object.entries(items)) {
      if (it.kind === 'card' && !onMap.has(id)) err('mapa', 'falta la tarjeta de ' + id + ' (el buscador enlaza a #mapa.' + ATLAS.slug(id) + ')');
      if (it.kind === 'model' && !onMap.has(id)) warn('mapa', 'falta la tarjeta del modelo ' + id);
    }
    for (const f of familyIds) if (!famOnMap.has(f)) warn('mapa', 'falta la tarjeta de la familia ' + f);
  }
}

// ------------------------------------------------------------------ glosario fusionado
{
  const bySlug = new Map();
  for (const t of ATLAS.glossary()) {
    const s = ATLAS.slug(t.en);
    if (bySlug.has(s)) err('glosario', 'dos términos con el mismo slug "' + s + '": "' + bySlug.get(s) + '" y "' + t.en + '" (usa una sola grafía)');
    else bySlug.set(s, t.en);
  }
}

// ------------------------------------------------------------------ enlaces internos
const cardIds = new Set(ATLAS.flashcards().map((c) => c.id));
for (const { where, href } of links) {
  const h = href.slice(1);
  if (!/^[A-Za-z0-9._~-]+$/.test(h)) { err(where, 'hash con caracteres no permitidos: ' + href); continue; }
  const [path, node] = h.split('~');
  const [pid, sid, sub] = path.split('.');
  const pm = /^practica-(.+)$/.exec(pid);
  if (pm) { if (!items[pm[1]] || items[pm[1]].kind !== 'model') err(where, 'enlace a la práctica de un modelo inexistente: ' + href); continue; }
  if (!items[pid]) { err(where, 'enlace a página inexistente: ' + href); continue; }
  if (!sid) { if (node) err(where, '"~nodo" necesita una sección: ' + href); continue; }
  if (pid === 'glosario') { if (!ATLAS.glossary().some((t) => ATLAS.slug(t.en) === sid)) err(where, 'enlace a término de glosario inexistente: ' + href); continue; }
  if (pid === 'flashcards') { if (!cardIds.has(sid)) err(where, 'enlace a flashcard inexistente: ' + href); continue; }
  const p = ATLAS.getPage(pid);
  // En el Mapa, cada bloque card es un ancla: #mapa.<id> (modelo o tarjeta) y #mapa.familia-<id>.
  if (pid === 'mapa' && p && !node && p.sections.some((s) => (s.blocks || []).some((b) => b && b.t === 'card' &&
    ((b.model && ATLAS.slug(b.model) === sid) || (b.family && 'familia-' + b.family === sid))))) continue;
  if (!p || !p.sections.length) { err(where, 'enlace a sección de una página sin contenido (enlaza solo a la página): ' + href); continue; }
  if (!p.sections.some((s) => s.id === sid)) { err(where, 'enlace a sección inexistente: ' + href); continue; }
  if (sub && !KEBAB.test(sub)) err(where, 'sub-ancla inválida: ' + href);
  if (node) {
    // El nodo debe existir en un diagrama de esa sección (o en sus vistas expandidas). Forma calificada
    // ~<diagrama>.<nodo>: ese diagrama debe ser de la sección y tener el nodo. Sin calificar, el id debe
    // ser único en la sección: si está en varias vistas, el router no sabría cuál abrir (SPEC §4.2).
    const ref = ATLAS.splitNodeRef(node);
    const ds = ATLAS.sectionDiagrams(pid, sid);
    if (ref.diagram) {
      if (!ds.includes(ref.diagram)) err(where, 'enlace calificado a un diagrama que no está en ' + pid + '.' + sid + ': ' + href);
      else if (!ATLAS.nodeDiagrams(pid, sid, ref.node).includes(ref.diagram)) err(where, 'el diagrama ' + ref.diagram + ' no tiene el nodo "' + ref.node + '": ' + href);
    } else {
      const hits = ATLAS.nodeDiagrams(pid, sid, ref.node);
      if (!hits.length) err(where, 'enlace a un nodo que no está en los diagramas de ' + pid + '.' + sid + ': ' + href);
      else if (hits.length > 1) err(where, 'enlace ambiguo: el nodo "' + ref.node + '" está en ' + hits.join(', ') + '; usa #' + pid + '.' + sid + '~<diagrama>.' + ref.node + ' (p. ej. ' + ATLAS.nodeHref(pid, sid, ref.node, hits[0]) + ')');
    }
  }
}

// ------------------------------------------------------------------ ids de nodo repetidos en una sección
// Las rutas ~nodo y la búsqueda necesitan ids únicos por sección; los de entrada/salida (op 'io') se
// permiten repetidos porque no se indexan (su enlace, si lo hubiera, debe ir calificado).
{
  const seen = new Set();
  for (const d of Object.values(diagrams)) {
    if (!d.page || !d.section || d.kind === 'map') continue;
    const key = d.page + '.' + d.section;
    if (seen.has(key)) continue;
    seen.add(key);
    const owners = {};
    for (const id of ATLAS.sectionDiagrams(d.page, d.section)) {
      for (const n of diagrams[id].nodes || []) if (n && n.id && n.op !== 'io') (owners[n.id] = owners[n.id] || []).push(id);
    }
    for (const [nid, ids] of Object.entries(owners)) {
      if (ids.length > 1) warn('diagramas de ' + key, 'el nodo "' + nid + '" aparece en ' + ids.join(', ') + ': un enlace #' + key + '~' + nid + ' sería ambiguo (la búsqueda usa ~<diagrama>.' + nid + ')');
    }
  }
}

// ------------------------------------------------------------------ LaTeX que perdió sus barras
// En un template literal normal (sin R`…`/String.raw), "\(" se vuelve "(", "\cdot" → "cdot" y
// "\top" → TAB + "op", "\frac" → salto de página + "rac", "\beta" → retroceso + "eta". Se revisan
// las cadenas ya evaluadas de páginas, catálogo y diagramas.
{
  const CTRL = /[\x08\x09\x0B\x0C\x0D]/;
  const CTRL_NAME = { '\x08': 'retroceso (\\b de \\beta, \\bar…)', '\x09': 'tabulador (\\t de \\top, \\times, \\tau…)', '\x0B': 'tab vertical (\\v de \\vec…)', '\x0C': 'salto de página (\\f de \\frac…)', '\x0D': 'retorno de carro (\\r de \\right, \\rho…)' };
  // Comandos que nunca son palabras de prosa: sin "\" delante son LaTeX roto en cualquier parte (también
  // fuera de \( … \): sin R`…` los delimitadores pierden su barra y quedan como "( … )"). No cuentan
  // dentro de un identificador: "linear_sum_assignment" o "np.cumsum_" no son \sum_ (antes: falso positivo).
  const NEVER_PROSE = /(^|[^\\A-Za-z0-9_])(cdot|cdots|ldots|mathrm|mathbf|mathit|mathcal|operatorname|boldsymbol|sqrt\{|frac\{|sum_(?![a-z]{2})|prod_(?![a-z]{2}))/;
  // Dentro de \( … \) / \[ … \] (o en un campo tex): también estas, tras "(" o espacio.
  const IN_MATH = /(^|[\s(])(cdot|frac|sqrt|mathbf|mathrm|top|times|sum|ell|approx|operatorname|infty|alpha|beta|gamma|sigma|lambda|epsilon)\b/;
  const SKIP_KEYS = new Set(['code', 'id', 't', 'model', 'config', 'configs', 'diagram', 'href', 'family', 'kind', 'ref', 'src', 'arxiv', 'url', 'parent', 'parentNode', 'expand']);
  const reported = new Set();
  const mathSegs = (s) => Array.from(s.matchAll(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g), (m) => m[1] != null ? m[1] : m[2]);
  const check = (where, str, key) => {
    if (typeof str !== 'string' || !str) return;
    const at = (i) => JSON.stringify(str.slice(Math.max(0, i - 20), i + 20));
    const say = (msg) => { const k = where + msg; if (!reported.has(k)) { reported.add(k); err(where, msg); } };
    const c = CTRL.exec(str);
    if (c) say('carácter de control ' + CTRL_NAME[c[0]] + ': LaTeX que perdió su "\\" (usa R`…`): …' + at(c.index) + '…');
    const n = NEVER_PROSE.exec(str);
    if (n) say('comando LaTeX sin "\\": "' + n[2] + '" (¿template literal sin R`…`?): …' + at(n.index) + '…');
    const segs = key === 'tex' ? [str] : mathSegs(str);
    for (const seg of segs) { const m = IN_MATH.exec(seg); if (m) { say('dentro de la fórmula, "' + m[2] + '" sin "\\": ' + JSON.stringify(seg.slice(0, 60))); break; } }
  };
  const walk = (where, obj, key, depth) => {
    if (depth > 14 || obj == null) return;
    if (typeof obj === 'string') { check(where, obj, key); return; }
    if (Array.isArray(obj)) { obj.forEach((x, i) => walk(where + '[' + i + ']', x, key, depth + 1)); return; }
    if (typeof obj === 'object') for (const k of Object.keys(obj)) if (!SKIP_KEYS.has(k)) walk(where + '.' + k, obj[k], k, depth + 1);
  };
  for (const [id, pg] of Object.entries(rawPages)) {
    (pg.sections || []).forEach((sct) => walk(id + '.' + (sct && sct.id), sct, null, 0));
    walk(id + '.flashcards', pg.flashcards || [], null, 0);
    walk(id + '.glossary', pg.glossary || [], null, 0);
  }
  if (catalog) walk('catalog', catalog, null, 0);
  for (const d of Object.values(diagrams)) walk('diagrama ' + d.id, d, null, 0);
}

// ------------------------------------------------------------------ informe
if (asJson) {
  console.log(JSON.stringify({ errors, warnings, infos, stats, loaded }, null, 2));
} else {
  for (const m of infos) console.log('[validate] ' + m);
  if (!quiet) {
    console.log('[validate] páginas con contenido:');
    for (const [id, s] of Object.entries(stats)) {
      console.log('  ' + id.padEnd(17) + (s.ready ? 'lista ' : 'parcial') + '  secciones ' + String(s.sections).padStart(2) + '  palabras ≈ ' + String(s.words).padStart(6) +
        '  flashcards ' + String(s.flashcards).padStart(3) + '  glosario ' + String(s.glossary).padStart(3) + '  bloques ' + Object.entries(s.blocks).map(([k, v]) => k + ':' + v).join(' '));
    }
    console.log('[validate] configs del calculador: ' + allConfigs.length + ' · diagramas: ' + Object.keys(diagrams).length + ' · visualizaciones: ' + vizNames.size +
      ' · flashcards: ' + ATLAS.flashcards().length + ' · glosario: ' + ATLAS.glossary().length);
  }
  for (const w of warnings) console.log('[aviso] ' + w);
  for (const e of errors) console.log('[ERROR] ' + e);
  console.log(errors.length ? '[validate] ' + errors.length + ' errores, ' + warnings.length + ' avisos' : '[validate] OK (' + warnings.length + ' avisos)');
}
process.exit(errors.length ? 1 : 0);
