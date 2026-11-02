// Pruebas de las funciones puras del shell (js/app.js + js/core/registry.js), sin navegador:
// parseHash (incluida la forma calificada ~diagrama.nodo), labLink por entorno, búsqueda y las rutas
// a nodos de diagrama (cada resultado de tipo Bloque abre exactamente un diagrama).
// Carga lo que index.html carga de js/core, js/arch y js/content, más js/ui/dom.js y js/app.js en un
// contexto de Node sin `document` (app.js no arranca: solo define ATLAS.App).
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');

function loadApp(env) {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const files = Array.from(html.matchAll(/<script src="([^"]+)"/g), (m) => m[1])
    .filter((f) => /^js\/(core|arch|content)\//.test(f) || f === 'js/ui/dom.js' || f === 'js/app.js');
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  if (env) ctx.ATLAS_ENV = env;
  for (const f of files) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.ATLAS;
}
const A = loadApp();
const plain = (x) => JSON.parse(JSON.stringify(x));

test('parseHash: página, sección, sub-ancla, nodo y nodo calificado', () => {
  const P = A.App.parseHash;
  assert.deepStrictEqual(plain(P('')), { pageId: 'inicio', sectionId: null, section: null, sub: null, node: null, hash: '#inicio' });
  const a = plain(P('#vit.operaciones.qkv'));
  assert.strictEqual(a.pageId, 'vit');
  assert.strictEqual(a.section, 'operaciones');
  assert.strictEqual(a.sub, 'qkv');
  assert.strictEqual(a.node, null);
  const b = plain(P('#vit.diagrama~mhsa'));
  assert.strictEqual(b.section, 'diagrama');
  assert.strictEqual(b.node, 'mhsa');
  assert.strictEqual(b.nodeId, 'mhsa');
  assert.strictEqual(b.nodeDiagram, null);
  const c = plain(P('#vit.diagrama~vit-mlp.in'));
  assert.strictEqual(c.node, 'vit-mlp.in');
  assert.strictEqual(c.nodeDiagram, 'vit-mlp');
  assert.strictEqual(c.nodeId, 'in');
  assert.strictEqual(c.hash, '#vit.diagrama~vit-mlp.in');
  assert.strictEqual(P('#practica-vit').modelId, 'vit');
});

test('labLink según ATLAS_ENV (SPEC §10.3)', () => {
  assert.strictEqual(A.labLink('paso'), '../transformer-lab/index.html#paso', 'dev');
  assert.strictEqual(loadApp('single').labLink('paso-5'), '../../transformer-lab/index.html#paso-5');
  assert.strictEqual(loadApp('web').labLink('entrenamiento'), 'lab/#entrenamiento');
  assert.strictEqual(loadApp('artifact').labLink('paso'), null, 'artifact: sin enlace (nota)');
  assert.strictEqual(A.labLink('pa so<x>'), '../transformer-lab/index.html#pasox', 'caracteres fuera del hash se quitan');
});

test('nodeHref: califica solo los ids que se repiten en la sección', () => {
  const dups = A.nodeDiagrams('vit', 'diagrama', 'in');
  assert.ok(dups.length > 1, 'el nodo "in" está en varias vistas de vit.diagrama: ' + dups.join(', '));
  assert.strictEqual(A.nodeHref('vit', 'diagrama', 'in', 'vit-mlp'), '#vit.diagrama~vit-mlp.in');
  assert.strictEqual(A.nodeDiagrams('vit', 'diagrama', 'mhsa').length, 1);
  assert.strictEqual(A.nodeHref('vit', 'diagrama', 'mhsa', 'vit-enc-layer'), '#vit.diagrama~mhsa');
  assert.deepStrictEqual(plain(A.splitNodeRef('vit-mlp.in')), { diagram: 'vit-mlp', node: 'in' });
  assert.deepStrictEqual(plain(A.splitNodeRef('mhsa')), { diagram: null, node: 'mhsa' });
});

test('búsqueda: cada resultado de tipo Bloque abre exactamente un diagrama, el suyo', () => {
  const blocks = A.searchIndex().filter((e) => e.type === 'block');
  assert.ok(blocks.length > 10, 'hay bloques indexados: ' + blocks.length);
  for (const e of blocks) {
    const r = A.App.parseHash(e.href);
    assert.ok(r.node, e.href);
    const hits = A.nodeDiagrams(r.pageId, r.section, r.nodeId).filter((id) => !r.nodeDiagram || id === r.nodeDiagram);
    assert.deepStrictEqual(Array.from(hits), [e.diagram], e.title + ' → ' + e.href);
    assert.match(e.href, /^#[A-Za-z0-9._~-]+$/);
  }
  assert.ok(!blocks.some((e) => A.diagram(e.diagram).nodes.find((n) => n.id === e.node).op === 'io'), 'los nodos io no se indexan');
});

test('búsqueda: ranking y textos sin LaTeX crudo', () => {
  const r = A.App.runSearch('vit');
  assert.ok(r.length > 0);
  assert.strictEqual(r[0].type, 'page');
  assert.strictEqual(r[0].id, 'vit');
  const mh = A.App.runSearch('self-attention');
  assert.ok(mh.some((e) => e.type === 'block' && e.node === 'mhsa'), 'self-attention devuelve el bloque mhsa del diagrama');
  for (const e of A.searchIndex()) {
    assert.ok(!/\\\(|\\\)|\\mathrm|\\frac|\\sqrt/.test(e.title + ' ' + (e.text || '')), 'LaTeX crudo en el índice: ' + e.id + ' → ' + (e.title + ' ' + e.text).slice(0, 120));
    assert.ok(!/<[a-z][^>]*>/i.test(e.text || ''), 'HTML en el texto del índice: ' + e.id);
  }
  assert.strictEqual(A.deTex('\\(\\mathrm{softmax}(QK^\\top/\\sqrt{d_h})\\)'), 'softmax(QK^ᵀ/√d_h)');
});
