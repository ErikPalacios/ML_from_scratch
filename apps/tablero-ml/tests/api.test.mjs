// Tests de la API y del modelo de datos: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/handler.mjs';
import { memoryStore } from '../server/store.mjs';
import { applyOps } from '../web/js/shared/ops.mjs';
import { validateProject } from '../web/js/shared/model.mjs';
import { projectFromTemplate } from '../web/js/shared/factory.mjs';
import { seedC01 } from '../web/js/shared/seed-c01.mjs';
import { T } from '../web/js/shared/templates.mjs';

const ENV = { APP_PASSWORD: 'una-contraseña-larga', SESSION_SECRET: 's'.repeat(40), API_TOKEN: 't'.repeat(40) };
const BASE = 'https://tablero.test';

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

test('las plantillas de los 7 patrones crean proyectos válidos', () => {
  assert.deepEqual(T.ORDER, ['sincrono', 'batch', 'asincrono', 'llm', 'hibrido', 'streaming', 'edge']);
  for (const pattern of T.ORDER) {
    const p = projectFromTemplate({ id: `p-${pattern}`, name: pattern, pattern });
    assert.deepEqual(validateProject(p), [], pattern);
    assert.ok(p.steps.length >= 9, pattern);
  }
  assert.equal(T.STEPS.sincrono.length, 12);
  assert.ok(T.STEPS.sincrono.every((s) => s.done.length >= 3 && s.links.some((l) => l.href.startsWith(T.COURSE_URL))));
});

test('la precarga del C01 es válida y apunta al paso 1.4 del hito 1', () => {
  const p = seedC01();
  assert.deepEqual(validateProject(p), []);
  assert.equal(p.resume.nextStepId, 'serving');
  assert.match(p.resume.next, /paso 1\.4/);
  assert.equal(p.steps.find((s) => s.id === 'empaquetado').hitos.find((h) => h.id === 'h0').status, 'hecho');
  assert.ok(p.steps.filter((s) => s.status === 'no_aplica').every((s) => s.reason));
});

test('applyOps: set, insert, move, remove, y una op inválida se descarta sin tocar las demás', () => {
  const p = projectFromTemplate({ id: 'x', name: 'x', pattern: 'sincrono' });
  const { project, applied, rejected } = applyOps(p, [
    { op: 'set', path: ['steps', '#serving', 'status'], value: 'hecho' },
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
  assert.match(rejected[1].error, /necesita su razón/);
  assert.equal(project.steps[0].id, 'monitoreo');
  assert.ok(!project.steps.some((s) => s.id === 'kubernetes'));
  const serving = project.steps.find((s) => s.id === 'serving');
  assert.equal(serving.status, 'hecho');
  assert.equal(serving.results[0].unit, 'ms');
  assert.ok(serving.results[0].id);
  assert.equal(project.id, 'x');
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
  const list = await c.call('GET', 'projects');
  assert.equal(list.body.projects[0].id, 'c01');
  const r = await c.call('POST', 'projects/c01/ops', { ops: [{ op: 'set', path: ['resume', 'next'], value: 'probar' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.project.rev, 1);
  assert.equal(r.body.project.resume.next, 'probar');
  const md = await c.call('GET', 'projects/c01/resumen');
  assert.match(md.body, /^# Retomar: C01/);
  assert.match(md.body, /probar/);
  const exp = await c.call('GET', 'export');
  assert.equal(exp.body.projects.length, 1);
  assert.equal((await c.call('DELETE', 'projects/c01')).status, 200);
  assert.equal((await c.call('GET', 'projects/c01')).status, 404);
});

test('un POST con cookie desde otro origen se rechaza', async () => {
  const c = client();
  await c.login();
  const r = await c.call('POST', 'projects/c01/ops', { ops: [] }, { origin: 'https://malo.example' });
  assert.equal(r.status, 403);
});

test('Claude Code con su token: lee el resumen, marca un paso, agrega bitácora y no puede borrar', async () => {
  const c = client();
  await c.login();
  await c.call('POST', 'projects', { project: seedC01() });
  assert.equal((await c.call('GET', 'claude/c01', undefined, { authorization: 'Bearer malo' })).status, 401);
  const md = await c.claude('GET', 'claude/c01');
  assert.equal(md.status, 200);
  assert.match(md.body, /Próximo paso concreto/);
  const r = await c.claude('POST', 'claude/c01/paso/serving', {
    hito: { id: 'h1', estado: 'hecho' }, resultado: { nombre: 'p50 del curl', valor: '31', unidad: 'ms' }, nota: 'POST /v1/classify listo', vuelta: { v1: 'hecho' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await c.claude('POST', 'claude/c01/bitacora', { hice: 'paso 1.4', medi: 'p50 31 ms', sigue: 'hito 2', pasos: ['serving', 'nope'] })).status, 200);
  assert.equal((await c.claude('POST', 'claude/c01/retomar', { proximo: 'Hito 2, paso 2.1', paso: 'serving' })).status, 200);
  assert.equal((await c.claude('POST', 'claude/c01/decision', { que: 'A', contra: 'B', porque: 'C', paso: 'serving' })).status, 200);
  assert.equal((await c.claude('POST', 'claude/c01/paso/serving', { estado: 'listo' })).status, 400);
  assert.equal((await c.claude('POST', 'claude/c01/paso/nope', { estado: 'hecho' })).status, 404);
  const ops = await c.claude('POST', 'projects/c01/ops', { ops: [{ op: 'remove', path: ['steps', '#serving'] }] });
  assert.equal(ops.body.rejected.length, 1);
  assert.equal((await c.claude('DELETE', 'projects/c01')).status, 403);
  assert.equal((await c.claude('GET', 'export')).status, 403);
  const p = (await c.claude('GET', 'claude/c01.json')).body.project;
  const s = p.steps.find((x) => x.id === 'serving');
  assert.equal(s.hitos.find((h) => h.id === 'h1').status, 'hecho');
  assert.equal(s.vuelta.v1, 'hecho');
  assert.match(s.notes, /Claude Code\] POST \/v1\/classify listo$/);
  assert.equal(p.sessions.at(-1).source, 'claude');
  assert.deepEqual(p.sessions.at(-1).stepIds, ['serving']);
  assert.equal(p.resume.next, 'Hito 2, paso 2.1');
  assert.equal(p.rev, 4);
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
  const r2 = await handle(new Request(BASE + '/api/projects'), { env: {}, store: null });
  assert.equal(r2.status, 503);
});

test('la validación rechaza campos con nombres heredados (toString, constructor, __proto__)', () => {
  const p = seedC01();
  const bad = JSON.parse(JSON.stringify(p));
  bad.sessions[0].toString = { x: 1 };
  bad.sessions[0].constructor = 42;
  assert.ok(validateProject(bad).some((e) => /toString: campo desconocido/.test(e)));
  assert.ok(validateProject(bad).some((e) => /constructor: campo desconocido/.test(e)));
  const proto = JSON.parse('{"x":1,"__proto__":{"a":1}}');
  const bad2 = JSON.parse(JSON.stringify(p));
  Object.assign(bad2.decisions[0], proto);
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
  const store = memoryStore();
  const c = client(store);
  await c.login();
  await c.call('POST', 'projects', { project: projectFromTemplate({ id: 'h', name: 'h', pattern: 'edge' }) });
  await c.call('POST', 'projects/h/ops', { ops: [{ op: 'set', path: ['goal'], value: 'uno' }] });
  const list = (await c.call('GET', 'projects/h/historial')).body.history;
  assert.equal(list.length, 1);
  assert.equal(list[0].project, undefined);
  assert.equal(list[0].steps, 15);
  const one = await c.call('GET', 'projects/h/historial/0');
  assert.equal(one.body.project.rev, 0);
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
  await c.claude('POST', 'claude/c01/bitacora', { hice: 'algo' });
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
