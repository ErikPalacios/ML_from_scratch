// Tests de la API, del modelo de datos, del motor de cálculos y de la migración v1 → v2: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../server/handler.mjs';
import { memoryStore } from '../server/store.mjs';
import { applyOps } from '../web/js/shared/ops.mjs';
import { validateProject } from '../web/js/shared/model.mjs';
import { evaluateProject, parse, evaluate, matches } from '../web/js/shared/calc.mjs';
import { projectFromTemplate } from '../web/js/shared/factory.mjs';
import { migrate } from '../web/js/shared/migrate.mjs';
import { seedC01 } from '../web/js/shared/seed-c01.mjs';
import { seedC01V1 } from '../web/js/shared/seed-c01-v1.mjs';
import { T } from '../web/js/shared/templates.mjs';

const ENV = { APP_PASSWORD: 'una-contraseña-larga', SESSION_SECRET: 's'.repeat(40), API_TOKEN: 't'.repeat(40) };
const BASE = 'https://tablero.test';
const EXPECTED = JSON.parse(readFileSync(new URL('./calc-expected.json', import.meta.url), 'utf8'));

function client(store = memoryStore(), env = ENV) {
  let cookie = null;
  const call = async (method, path, body, headers = {}) => {
    const h = { ...headers };
    if (cookie && !h.authorization) h.cookie = cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await handle(new Request(BASE + '/api/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), { env, store });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { call, store, login: () => call('POST', 'login', { password: ENV.APP_PASSWORD }), claude: (method, path, body) => call(method, path, body, { authorization: 'Bearer ' + ENV.API_TOKEN }) };
}

// Fills every calc of a project with the engine's own value (what a diligent engineer would type).
function solveAll(p, only) {
  const ev = evaluateProject(p);
  for (const s of p.steps) for (const c of s.calcs) if (!only || only.includes(s.id)) { const r = ev.calcs[`${s.id}/${c.id}`]; if (r && Number.isFinite(r.value)) c.answer = String(r.value); }
  return p;
}

test('las plantillas de los 7 patrones crean proyectos válidos, con kickoff, cálculos y variables', () => {
  assert.deepEqual(T.ORDER, ['sincrono', 'batch', 'asincrono', 'llm', 'hibrido', 'streaming', 'edge']);
  for (const pattern of T.ORDER) {
    const p = projectFromTemplate({ id: `p-${pattern}`, name: pattern, pattern });
    assert.deepEqual(validateProject(p), [], pattern);
    assert.equal(p.steps[0].id, 'kickoff', pattern);
    assert.ok(p.steps[0].calcs.length >= 6, pattern);
    assert.ok(p.vars.length >= 20, pattern);
    assert.ok(p.vars.filter((v) => v.kind === 'requirement').every((v) => v.value === ''), `${pattern}: requirements start empty`);
  }
  assert.equal(T.STEPS.sincrono.length, 13);
  assert.ok(T.STEPS.sincrono.every((s) => /^[A-Z]/.test(s.title) && s.done.length >= 3));
});

test('con los valores de referencia, cada cálculo del curso da su número y ningún check falla', () => {
  for (const pattern of T.ORDER) {
    const p = projectFromTemplate({ id: 'x', name: 'x', pattern });
    for (const v of p.vars) v.value = v.ref;
    const ev = evaluateProject(p);
    for (const s of p.steps) for (const c of s.calcs) {
      const r = ev.calcs[`${s.id}/${c.id}`];
      assert.ok(['todo'].includes(r.status), `${pattern}/${s.id}/${c.id}: ${r.status} ${r.error || r.missing}`);
      assert.ok(Math.abs(r.value - EXPECTED[`${pattern}/${s.id}/${c.id}`]) < 1e-6, `${pattern}/${s.id}/${c.id}`);
      if (r.check) assert.ok(r.check.ok, `${pattern}/${s.id}/${c.id} check`);
    }
  }
});

test('motor: fórmulas, redondeos y respuestas con unidades, comas o %', () => {
  const t = (e, env = {}) => evaluate(parse(e), env);
  assert.equal(t('ceilto(486, 50)'), 500);
  assert.equal(t('max(ceil(500 / 600) + 1, 2)'), 2);
  assert.equal(t('2^3^2'), 512);
  assert.equal(t('-2^2'), -4);
  assert.throws(() => parse('alert(1)'), /unknown function/);
  assert.throws(() => parse('a; b'), /unexpected/);
  assert.ok(matches('1,692', 1692.4, 0.02));
  assert.ok(matches('≈ 116 req/s', 115.74, 0.02));
  assert.ok(matches('42 %', 0.4167, 0.02));
  assert.ok(!matches('3', 2, 0));
  assert.ok(!matches('', 2, 0));
});

test('la precarga del C01 (v2) es válida, honesta con DESIGN.md y apunta al paso 1.4', () => {
  const p = seedC01();
  assert.deepEqual(validateProject(p), []);
  assert.equal(p.resume.nextStepId, 'serving');
  assert.match(p.resume.next, /step 1\.4/);
  const ev = evaluateProject(p);
  assert.equal(ev.gates.kickoff.done, 5);
  assert.equal(ev.gates.serving.done, 2);
  assert.equal(ev.gates.datos.done, 1, 'logs/day with DESIGN.md\'s 400 B/line');
  assert.ok(Object.values(ev.calcs).every((r) => r.status !== 'wrong' && r.status !== 'error'));
});

test('el gate bloquea pasar a «en curso» o «hecho»; con los cálculos o un waiver, deja', () => {
  let p = projectFromTemplate({ id: 'g', name: 'g', pattern: 'sincrono' });
  for (const v of p.vars) v.value = v.ref;
  let r = applyOps(p, [{ op: 'set', path: ['steps', '#kickoff', 'status'], value: 'en_curso' }]);
  assert.match(r.rejected[0].error, /Entry gate not met: 14 of 14/);
  r = applyOps(p, [{ op: 'set', path: ['steps', '#kickoff', 'status'], value: 'bloqueado' }, { op: 'set', path: ['steps', '#kickoff', 'reason'], value: 'x' }]);
  assert.equal(r.applied, 2, 'blocked and to-do are always allowed');
  p = solveAll(p, ['kickoff']);
  r = applyOps(p, [{ op: 'set', path: ['steps', '#kickoff', 'status'], value: 'hecho' }]);
  assert.equal(r.applied, 1);
  r = applyOps(p, [{ op: 'set', path: ['steps', '#datos', 'gate'], value: { waived: true, reason: '', at: '' } }]);
  assert.match(r.rejected[0].error, /waiver needs a reason/);
  r = applyOps(p, [
    { op: 'set', path: ['steps', '#datos', 'gate'], value: { waived: true, reason: 'labels come from Imagenette', at: '2026-10-26T00:00:00Z' } },
    { op: 'set', path: ['steps', '#datos', 'status'], value: 'en_curso' },
  ]);
  assert.equal(r.applied, 2);
  // a failing acceptance check also keeps the gate closed
  const q = solveAll(projectFromTemplate({ id: 'h', name: 'h', pattern: 'sincrono' }));
  for (const v of q.vars) v.value = v.ref;
  q.vars.find((v) => v.id === 'budget_month').value = '1000';
  const q2 = solveAll(q);
  const g = evaluateProject(q2).gates.kickoff;
  assert.equal(g.failedChecks, 1);
  assert.equal(applyOps(q2, [{ op: 'set', path: ['steps', '#kickoff', 'status'], value: 'hecho' }]).applied, 0);
});

test('revelar cuenta para el gate pero queda marcado', () => {
  const p = projectFromTemplate({ id: 'r', name: 'r', pattern: 'edge' });
  for (const v of p.vars) v.value = v.ref;
  for (const c of p.steps[0].calcs) c.revealed = true;
  const ev = evaluateProject(p);
  assert.equal(ev.gates.kickoff.met, true);
  assert.equal(ev.gates.kickoff.revealed, p.steps[0].calcs.length);
});

test('applyOps: set, insert, move, remove, y una op inválida se descarta sin tocar las demás', () => {
  const p = projectFromTemplate({ id: 'x', name: 'x', pattern: 'sincrono' });
  const { project, applied, rejected } = applyOps(p, [
    { op: 'set', path: ['steps', '#serving', 'status'], value: 'bloqueado' },
    { op: 'set', path: ['steps', '#serving', 'status'], value: 'terminado' },
    { op: 'insert', path: ['steps', '#serving', 'results'], value: { name: 'p99', value: '41', unit: 'ms' } },
    { op: 'move', path: ['steps', '#monitoreo'], index: 0 },
    { op: 'remove', path: ['steps', '#kubernetes'] },
    { op: 'set', path: ['steps', '#gate', 'status'], value: 'no_aplica' },
    { op: 'set', path: ['__proto__', 'x'], value: 1 },
    { op: 'set', path: ['id'], value: 'otro' },
  ]);
  assert.equal(applied, 4);
  assert.deepEqual(rejected.map((r) => r.index), [1, 5, 6, 7]);
  assert.match(rejected[1].error, /N\/A needs a reason/);
  assert.equal(project.steps[0].id, 'monitoreo');
  assert.ok(!project.steps.some((s) => s.id === 'kubernetes'));
  assert.equal(project.steps.find((s) => s.id === 'serving').results[0].unit, 'ms');
});

test('la migración v1 → v2 agrega kickoff, cálculos y variables, pasa a inglés y respeta lo editado', () => {
  const v1 = seedC01V1();
  // what the v1 app saved: no v2 fields, v = 1, plus a couple of the user's own edits
  delete v1.vars;
  for (const s of v1.steps) { delete s.calcs; delete s.gate; delete s.inputs; delete s.outputs; }
  v1.steps = v1.steps.filter((s) => s.id !== 'kickoff');
  v1.v = 1;
  v1.steps.find((s) => s.id === 'serving').notes = 'Mis notas propias';
  v1.decisions[0].why = 'Mi porqué';
  const d = migrate(v1);
  assert.deepEqual(validateProject(d), []);
  assert.equal(d.v, 2);
  assert.equal(d.steps[0].id, 'kickoff');
  assert.equal(d.steps[0].status, 'en_curso');
  assert.equal(d.name, 'C01 · Image Classification API (Caso1)');
  assert.equal(d.steps.find((s) => s.id === 'gate').title, 'Evaluation Gate & Registry');
  assert.equal(d.steps.find((s) => s.id === 'serving').notes, 'Mis notas propias');
  assert.equal(d.decisions[0].why, 'Mi porqué');
  assert.equal(d.decisions[1].why, seedC01().decisions[1].why);
  assert.match(d.steps.find((s) => s.id === 'serving').hitos[0].text, /^Milestone 1/);
  assert.ok(d.vars.length > 50 && d.vars.every((v) => v.value !== ''));
  const ev = evaluateProject(d);
  assert.equal(ev.gates.kickoff.done, 5);
  assert.deepEqual(migrate(d), d, 'idempotent');
});

test('sin sesión todo da 401 y el login limita los intentos', async () => {
  const c = client();
  assert.equal((await c.call('GET', 'projects')).status, 401);
  assert.equal((await c.call('POST', 'login', { password: 'mala' })).status, 401);
  for (let i = 0; i < 9; i++) await c.call('POST', 'login', { password: 'mala' });
  assert.equal((await c.call('POST', 'login', { password: ENV.APP_PASSWORD })).status, 429);
});

test('la cookie de sesión es HttpOnly, Secure y SameSite=Strict, y una cookie alterada no sirve', async () => {
  const c = client();
  const r = await c.login();
  assert.equal(r.status, 200);
  const set = r.headers.get('set-cookie');
  assert.match(set, /^__Host-tablero=/);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(set.includes(attr), attr);
  assert.equal((await c.call('GET', 'session')).body.auth, true);
  const forged = set.split(';')[0].replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
  const r2 = await handle(new Request(BASE + '/api/projects', { headers: { cookie: forged } }), { env: ENV, store: c.store });
  assert.equal(r2.status, 401);
});

test('crear, editar con ops, resumen, exportar y borrar', async () => {
  const c = client();
  await c.login();
  const p = seedC01();
  assert.equal((await c.call('POST', 'projects', { project: p })).status, 201);
  assert.equal((await c.call('POST', 'projects', { project: p })).status, 409);
  assert.equal((await c.call('GET', 'projects')).body.projects[0].id, 'c01');
  const r = await c.call('POST', 'projects/c01/ops', { ops: [{ op: 'set', path: ['resume', 'next'], value: 'probar' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.project.rev, 1);
  const md = await c.call('GET', 'projects/c01/resumen');
  assert.match(md.body, /^# Resume brief: C01/);
  assert.match(md.body, /probar/);
  assert.match(md.body, /Entry gate: open 5\/14/);
  assert.doesNotMatch(md.body, /Gateway vCPU requests at design QPS \(`gw-vcpu`\) =/, 'unanswered calcs never show their value');
  assert.equal((await c.call('GET', 'export')).body.projects.length, 1);
  assert.equal((await c.call('DELETE', 'projects/c01')).status, 200);
  assert.equal((await c.call('GET', 'projects/c01')).status, 404);
});

test('un proyecto v1 guardado en la base se lee y se escribe ya migrado', async () => {
  const store = memoryStore();
  const v1 = seedC01V1();
  delete v1.vars; v1.v = 1;
  for (const s of v1.steps) { delete s.calcs; delete s.gate; delete s.inputs; delete s.outputs; }
  v1.steps = v1.steps.filter((s) => s.id !== 'kickoff');
  await store.put(v1, -1);
  const c = client(store);
  await c.login();
  const got = (await c.call('GET', 'projects/c01')).body.project;
  assert.equal(got.v, 2);
  assert.equal(got.steps[0].id, 'kickoff');
  const r = await c.claude('POST', 'claude/c01/step/kickoff', { calc: { id: 'gw-vcpu', answer: '5' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await store.get('c01')).v, 2);
});

test('un POST con cookie desde otro origen se rechaza', async () => {
  const c = client();
  await c.login();
  assert.equal((await c.call('POST', 'projects/c01/ops', { ops: [] }, { origin: 'https://malo.example' })).status, 403);
});

test('Claude Code con su token: lee, marca, responde cálculos, respeta el gate y no puede revelar ni hacer waivers', async () => {
  const c = client();
  await c.login();
  await c.call('POST', 'projects', { project: seedC01() });
  assert.equal((await c.call('GET', 'claude/c01', undefined, { authorization: 'Bearer malo' })).status, 401);
  const md = await c.claude('GET', 'claude/c01');
  assert.match(md.body, /## Next action/);
  // English keys
  let r = await c.claude('POST', 'claude/c01/step/serving', { milestone: { id: 'h1', status: 'hecho' }, result: { name: 'curl p50', value: '31', unit: 'ms' }, note: 'POST /v1/classify ready', pass: { v1: 'hecho' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Spanish keys still work (v1 CLAUDE.md)
  r = await c.claude('POST', 'claude/c01/paso/serving', { resultado: { nombre: 'p99', valor: '80', unidad: 'ms' } });
  assert.equal(r.status, 200);
  // the gate holds for the token too
  r = await c.claude('POST', 'claude/c01/step/datos', { status: 'en_curso' });
  assert.equal(r.status, 422);
  assert.match(r.body.rejected[0].error, /Entry gate not met/);
  // answers + status in one request: answers land first
  const p0 = (await c.claude('GET', 'claude/c01.json')).body.project;
  const ev = evaluateProject(p0);
  const datos = p0.steps.find((s) => s.id === 'datos');
  for (const k of datos.calcs) {
    r = await c.claude('POST', 'claude/c01/step/datos', { calc: { id: k.id, answer: String(ev.calcs[`datos/${k.id}`].value) } });
    assert.equal(r.status, 200);
  }
  assert.equal((await c.claude('POST', 'claude/c01/step/datos', { status: 'en_curso' })).status, 200);
  // inputs
  assert.equal((await c.claude('POST', 'claude/c01/var/log_bytes', { value: '350' })).status, 200);
  assert.equal((await c.claude('POST', 'claude/c01/var/nope', { value: '1' })).status, 404);
  // no reveals, no waivers, no calc definitions through the token
  for (const op of [
    { op: 'set', path: ['steps', '#kickoff', 'calcs', '#gw-vcpu', 'revealed'], value: true },
    { op: 'set', path: ['steps', '#kickoff', 'gate'], value: { waived: true, reason: 'x', at: '' } },
    { op: 'set', path: ['steps', '#kickoff', 'calcs', '#gw-vcpu', 'expr'], value: '5' },
    { op: 'insert', path: ['steps', '#kickoff', 'calcs'], value: { label: 'x', out: 'x', expr: '1' } },
  ]) {
    const x = await c.claude('POST', 'projects/c01/ops', { ops: [op] });
    assert.equal(x.body.rejected.length, 1, JSON.stringify(op));
  }
  assert.equal((await c.claude('POST', 'claude/c01/log', { did: 'step 1.4', measured: 'p50 31 ms', next: 'milestone 2', steps: ['serving', 'nope'] })).status, 200);
  assert.equal((await c.claude('POST', 'claude/c01/resume', { next: 'Milestone 2, step 2.1', step: 'serving' })).status, 200);
  assert.equal((await c.claude('POST', 'claude/c01/decision', { what: 'A', over: 'B', why: 'C', step: 'serving' })).status, 200);
  assert.equal((await c.claude('POST', 'claude/c01/step/serving', { status: 'listo' })).status, 400);
  assert.equal((await c.claude('POST', 'claude/c01/step/nope', { status: 'hecho' })).status, 404);
  assert.equal((await c.claude('DELETE', 'projects/c01')).status, 403);
  assert.equal((await c.claude('GET', 'export')).status, 403);
  const p = (await c.claude('GET', 'claude/c01.json')).body.project;
  const s = p.steps.find((x) => x.id === 'serving');
  assert.equal(s.hitos.find((h) => h.id === 'h1').status, 'hecho');
  assert.equal(s.vuelta.v1, 'hecho');
  assert.match(s.notes, /Claude Code\] POST \/v1\/classify ready$/);
  assert.equal(p.steps.find((x) => x.id === 'datos').status, 'en_curso');
  assert.equal(p.vars.find((v) => v.id === 'log_bytes').value, '350');
  assert.equal(p.sessions.at(-1).source, 'claude');
  assert.deepEqual(p.sessions.at(-1).stepIds, ['serving']);
  assert.equal(p.resume.next, 'Milestone 2, step 2.1');
});

test('la validación rechaza campos con nombres heredados (toString, constructor, __proto__)', () => {
  const p = seedC01();
  const bad = JSON.parse(JSON.stringify(p));
  bad.sessions[0].toString = { x: 1 };
  bad.sessions[0].constructor = 42;
  assert.ok(validateProject(bad).some((e) => /toString: unknown field/.test(e)));
  assert.ok(validateProject(bad).some((e) => /constructor: unknown field/.test(e)));
  const bad2 = JSON.parse(JSON.stringify(p));
  Object.assign(bad2.decisions[0], JSON.parse('{"x":1,"__proto__":{"a":1}}'));
  assert.ok(validateProject(bad2).length > 0);
});

test('el token no reemplaza un paso, una sesión ni una decisión completos', async () => {
  const c = client();
  await c.login();
  await c.call('POST', 'projects', { project: seedC01() });
  const r = await c.claude('POST', 'projects/c01/ops', { ops: [
    { op: 'set', path: ['steps', '#serving'], value: { title: 'x' } },
    { op: 'set', path: ['sessions', '#s-2026-10-12'], value: { did: 'x' } },
    { op: 'set', path: ['steps', '#serving', 'notes'], value: 'esto sí' },
  ] });
  assert.deepEqual(r.body.rejected.map((x) => x.index), [0, 1]);
  assert.equal(r.body.project.steps.find((s) => s.id === 'serving').notes, 'esto sí');
});

test('historial: la lista no trae proyectos completos, una versión se pide aparte y borrar el proyecto borra su historial', async () => {
  const c = client();
  await c.login();
  await c.call('POST', 'projects', { project: projectFromTemplate({ id: 'h', name: 'h', pattern: 'edge' }) });
  await c.call('POST', 'projects/h/ops', { ops: [{ op: 'set', path: ['goal'], value: 'uno' }] });
  const list = (await c.call('GET', 'projects/h/historial')).body.history;
  assert.equal(list.length, 1);
  assert.equal(list[0].project, undefined);
  assert.equal(list[0].steps, 16);
  assert.equal((await c.call('GET', 'projects/h/historial/0')).body.project.rev, 0);
  assert.equal((await c.call('GET', 'projects/h/historial/7')).status, 404);
  await c.call('DELETE', 'projects/h');
  await c.call('POST', 'projects', { project: projectFromTemplate({ id: 'h', name: 'h2', pattern: 'edge' }) });
  assert.equal((await c.call('GET', 'projects/h/historial')).body.history.length, 0);
});

test('reemplazar con baseRev viejo da 409 y no pisa lo que escribió otro', async () => {
  const c = client();
  await c.login();
  const p = seedC01();
  await c.call('POST', 'projects', { project: p });
  await c.claude('POST', 'claude/c01/log', { did: 'algo' });
  const r = await c.call('PUT', 'projects/c01', { project: { ...p, name: 'pisado' }, baseRev: 0 });
  assert.equal(r.status, 409);
  assert.equal((await c.call('GET', 'projects/c01')).body.project.name, p.name);
});

test('una IP bloqueada en el login ya no gasta comandos de la base', async () => {
  let hits = 0;
  const base = memoryStore();
  const store = { ...base, hit: (k, t) => { hits++; return base.hit(k, t); } };
  const c = client(store);
  const h = { 'x-forwarded-for': '203.0.113.9' };
  for (let i = 0; i < 11; i++) await c.call('POST', 'login', { password: 'mala' }, h);
  const before = hits;
  for (let i = 0; i < 20; i++) assert.equal((await c.call('POST', 'login', { password: 'mala' }, h)).status, 429);
  assert.equal(hits, before);
});

test('dos escritores a la vez: ninguna op se pierde', async () => {
  const c = client();
  await c.login();
  await c.call('POST', 'projects', { project: projectFromTemplate({ id: 'z', name: 'z', pattern: 'batch' }) });
  await Promise.all(Array.from({ length: 8 }, (_, i) => c.call('POST', 'projects/z/ops', { ops: [{ op: 'insert', path: ['sessions'], value: { did: `s${i}` } }] })));
  const p = (await c.call('GET', 'projects/z')).body.project;
  assert.equal(p.sessions.length, 8);
  assert.equal(p.rev, 8);
});

test('sin configuración la API lo dice y no deja entrar', async () => {
  const r = await handle(new Request(BASE + '/api/session'), { env: {}, store: null });
  const b = await r.json();
  assert.equal(b.auth, false);
  assert.ok(b.problems.length >= 3);
  assert.equal((await handle(new Request(BASE + '/api/projects'), { env: {}, store: null })).status, 503);
});
