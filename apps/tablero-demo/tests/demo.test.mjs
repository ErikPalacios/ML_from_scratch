// Tests of the demo: the sample project is valid and consistent, nothing private leaks into dist/, and the in-browser
// «server» behaves like the real API (list, ops with the entry gate, create/duplicate, delete).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const load = (rel) => import(pathToFileURL(join(DIST, rel)).href);

// A browser-like global for demo-boot.js (window + localStorage).
const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); },
  key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
};
let api, model, calc, seed;

before(async () => {
  execFileSync('node', [join(ROOT, 'tools', 'build.mjs')], { stdio: 'ignore' });
  ({ demoApi: api } = await load('js/demo-boot.js'));
  model = await load('js/shared/model.mjs');
  calc = await load('js/shared/calc.mjs');
  seed = (await load('js/seed-demo.mjs')).seedDemo();
});

test('the sample project is valid and in the sincrono pattern', () => {
  assert.deepEqual(model.validateProject(seed), []);
  assert.equal(seed.id, 'sample');
  assert.equal(seed.pattern, 'sincrono');
});

test('done steps have their entry gate met; the in-progress serving step still has it open', () => {
  const ev = calc.evaluateProject(seed);
  for (const id of ['kickoff', 'datos']) {
    assert.equal(seed.steps.find((s) => s.id === id).status, 'hecho');
    assert.equal(ev.gates[id].met, true, `${id} gate`);
  }
  assert.equal(seed.steps.find((s) => s.id === 'serving').status, 'en_curso');
  assert.equal(ev.gates.serving.open, true);
  assert.ok(ev.gates.serving.done >= 2);
});

test('the sample is fictional: no personal paths, names or the real C01 data anywhere in dist/', () => {
  const bad = /erikpalacios|Palacios|Caso1|ProyectosPortafolio|\/Users\/|APP_PASSWORD=|SESSION_SECRET=|API_TOKEN=|UPSTASH/;
  for (const f of walk(DIST)) {
    if (/\.(png|ico)$/.test(f)) continue;
    const txt = readFileSync(f, 'utf8');
    const m = bad.exec(txt);
    // the banner's links to the public repo are fine; the author's name only appears inside those URLs
    if (m && !(m[0] === 'Palacios' || m[0] === 'erikpalacios')) assert.fail(`${f}: ${m[0]}`);
    if (m && (m[0] === 'Palacios' || m[0] === 'erikpalacios')) assert.match(txt.slice(Math.max(0, m.index - 30), m.index + 40), /github\.com\/ErikPalacios|ErikPalacios/, f);
  }
  // «c01» alone is fine (the course's own reference case); the author's real measurements and commits are not.
  const j = JSON.stringify(seed);
  for (const real of ['f3133a3', '4bc61ef', '456–511', '2180', 'Image Classification API (Caso1)', 'DESIGN.md']) assert.equal(j.includes(real), false, real);
  assert.notEqual(seed.id, 'c01');
  assert.equal(readFileSync(join(DIST, 'js', 'shared', 'seed-c01.mjs'), 'utf8').includes('Caso1'), false);
});

test('the demo API lists the sample and serves it', async () => {
  const { projects } = await api('GET', 'projects');
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, 'sample');
  assert.ok(projects[0].hecho >= 2 && projects[0].total > projects[0].hecho);
  const { project } = await api('GET', 'projects/sample');
  assert.equal(project.name, 'Sample · Receipt Classifier API');
  assert.deepEqual(await api('GET', 'session'), { auth: true, store: 'demo', problems: [] });
});

test('ops apply, bump the revision and respect the entry gate', async () => {
  const before = (await api('GET', 'projects/sample')).project;
  const ok = await api('POST', 'projects/sample/ops', { ops: [{ op: 'set', path: ['steps', '#serving', 'notes'], value: 'edited in the demo' }] });
  assert.equal(ok.rejected.length, 0);
  assert.equal(ok.project.rev, before.rev + 1);
  assert.equal(ok.project.steps.find((s) => s.id === 'serving').notes, 'edited in the demo');
  const gated = await api('POST', 'projects/sample/ops', { ops: [{ op: 'set', path: ['steps', '#serving', 'status'], value: 'hecho' }] });
  assert.equal(gated.rejected.length, 1);
  assert.match(gated.rejected[0].error, /Entry gate/);
  assert.equal(gated.project.steps.find((s) => s.id === 'serving').status, 'en_curso');
});

test('create, duplicate (409), limit and delete work; unknown things 404', async () => {
  const mk = (id) => ({ ...structuredClone(seed), id, name: id, rev: 0 });
  assert.equal((await api('POST', 'projects', { project: mk('mine') })).project.id, 'mine');
  await assert.rejects(api('POST', 'projects', { project: mk('mine') }), (e) => e.status === 409);
  for (let i = 0; i < 6; i++) await api('POST', 'projects', { project: mk('p' + i) });
  await assert.rejects(api('POST', 'projects', { project: mk('too-many') }), (e) => e.status === 409 && /up to 8/.test(e.message));
  assert.deepEqual(await api('DELETE', 'projects/mine'), { ok: true });
  await assert.rejects(api('GET', 'projects/mine'), (e) => e.status === 404);
  await assert.rejects(api('GET', 'nope'), (e) => e.status === 404);
});

test('index.html is indexable, has its SEO tags and loads the demo scripts before the app', () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.equal(/noindex/.test(html), false);
  assert.match(html, /rel="canonical" href="https:\/\/tablero-ml-demo\.vercel\.app\/"/);
  assert.match(html, /og:image/);
  assert.ok(html.indexOf('demo-boot.js') < html.indexOf('/js/app.js'));
  assert.match(readFileSync(join(DIST, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/tablero-ml-demo\.vercel\.app\/<\/loc>/);
});
