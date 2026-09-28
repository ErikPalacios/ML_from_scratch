// Pruebas de js/core/store.js (lógica pura + sincronización simulada), sin navegador.
// Cada prueba carga registry.js + store.js en un contexto aislado de Node con reloj,
// temporizadores y localStorage falsos.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
const REGISTRY = readFileSync(join(ROOT, 'js/core/registry.js'), 'utf8');
const STORE = readFileSync(join(ROOT, 'js/core/store.js'), 'utf8');
const MIN = 60000;
const DAY = 86400000;
const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);

function fakeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

// Entorno: reloj + temporizadores controlados; `advance(ms)` ejecuta los vencidos en orden.
function makeEnv({ storage, claude, withCatalog = true } = {}) {
  const clock = { t: T0 };
  let timers = [];
  let seq = 1;
  const ctx = {
    console,
    setTimeout: (fn, ms) => { const id = seq++; timers.push({ id, at: clock.t + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id); },
    Promise,
  };
  if (storage !== undefined) ctx.localStorage = storage;
  if (claude) ctx.claude = claude;
  vm.createContext(ctx);
  vm.runInContext('Date.now = () => globalThis.__clock.t;', Object.assign(ctx, { __clock: clock }));
  vm.runInContext(REGISTRY, ctx, { filename: 'registry.js' });
  if (withCatalog) {
    vm.runInContext(`
      MSD.defineCatalog({ version: 1, items: {
        m01: { id: 'm01', kind: 'module', part: 1, num: 1, title: 'Mapa', short: 'Mapa' },
        c01: { id: 'c01', kind: 'case', part: 2, num: 1, title: 'Clasificación', short: 'Clasificación' },
      }, roadmap: [] });
      MSD.register({ id: 'm01', kind: 'module', sections: [
        { id: 'a', title: 'A', blocks: [{ t: 'p', html: 'x' }] },
        { id: 'b', title: 'B', blocks: [{ t: 'p', html: 'x' }] },
        { id: 'c', title: 'C', blocks: [{ t: 'p', html: 'x' }] },
        { id: 'd', title: 'D', blocks: [{ t: 'p', html: 'x' }] },
      ] });
    `, ctx);
  }
  vm.runInContext(STORE, ctx, { filename: 'store.js' });
  const flushMicro = () => new Promise((r) => setImmediate(r));
  async function advance(ms) {
    const end = clock.t + ms;
    for (;;) {
      await flushMicro();
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      clock.t = Math.max(clock.t, next.at);
      next.fn();
      await flushMicro();
    }
    clock.t = end;
    await flushMicro();
  }
  return { ctx, store: ctx.MSD.store, MSD: ctx.MSD, clock, advance, flushMicro, pending: () => timers.length };
}

// db falsa con la misma forma que claude.use('db') (doc/collection/get/set/delete).
function fakeDb(seed) {
  const docs = new Map(Object.entries(seed || {}));
  const log = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let failNext = null;   // {path, code}
  const snap = (path) => ({ id: path.split('/').pop(), exists: docs.has(path), data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined), metadata: {} });
  const docRef = (path) => ({
    id: path.split('/').pop(), path,
    get: async () => snap(path),
    set: async (data) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      if (failNext && failNext.path === path) { const e = { code: failNext.code, message: 'x' }; failNext = null; throw e; }
      docs.set(path, JSON.parse(JSON.stringify(data))); log.push(['set', path]);
    },
    delete: async () => { docs.delete(path); log.push(['delete', path]); },
    collection: (sub) => colRef(path + '/' + sub),
  });
  const colRef = (path) => ({
    path,
    doc: (id) => docRef(path + '/' + id),
    get: async () => {
      const out = [];
      for (const k of docs.keys()) if (k.startsWith(path + '/') && k.slice(path.length + 1).indexOf('/') < 0) out.push(snap(k));
      return { docs: out, size: out.length, empty: !out.length };
    },
  });
  return {
    docs, log,
    maxInFlight: () => maxInFlight,
    failNextWrite: (path, code) => { failNext = { path, code }; },
    api: { doc: docRef, collection: colRef },
  };
}
const fakeClaude = (db, uid = 'u_test') => ({
  use: async (name) => (name === 'db' ? db.api : name === 'user' ? { id: async () => uid } : null),
});
const MAIN = 'data/users/u_test/state';

test('carga en Node sin localStorage: backend memory y la API funciona', () => {
  const { store } = makeEnv();
  assert.strictEqual(store.backend(), 'memory');
  store.setSectionRead('m01', 'a', true);
  assert.strictEqual(store.isSectionRead('m01', 'a'), true);
});

test('localStorage que lanza al acceder → memory, sin excepciones', () => {
  const bad = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() {} };
  const { store } = makeEnv({ storage: bad });
  assert.strictEqual(store.backend(), 'memory');
  store.setPref('theme', 'dark');
  assert.strictEqual(store.pref('theme'), 'dark');
});

test('persistencia local: se escribe coalescida y se recupera al recargar', async () => {
  const ls = fakeStorage();
  const env = makeEnv({ storage: ls });
  assert.strictEqual(env.store.backend(), 'local');
  env.store.setSectionRead('m01', 'a', true);
  env.store.setChecklistItem('c01', 'checklist', 'slo', true);
  env.store.setLastLocation('#m01.a');
  assert.strictEqual(ls.getItem('msd.v1'), null, 'aún no se escribió (coalescido)');
  await env.advance(300);
  assert.ok(ls.getItem('msd.v1'));
  const env2 = makeEnv({ storage: ls });
  assert.strictEqual(env2.store.isSectionRead('m01', 'a'), true);
  assert.deepStrictEqual(Object.assign({}, env2.store.getChecklist('c01', 'checklist')), { slo: true });
  assert.strictEqual(env2.store.lastLocation(), '#m01.a');
});

test('JSON corrupto en localStorage: estado vacío y copia de respaldo', () => {
  const ls = fakeStorage({ 'msd.v1': '{roto' });
  const { store } = makeEnv({ storage: ls });
  assert.strictEqual(store.backend(), 'local');
  assert.strictEqual(store.lastLocation(), '');
  assert.strictEqual(ls.getItem('msd.v1.corrupto'), '{roto');
});

test('progreso de página y del curso', () => {
  const { store } = makeEnv();
  assert.deepStrictEqual(Object.assign({}, store.pageProgress('m01')), { read: 0, total: 4, pct: 0, completed: false });
  assert.strictEqual(store.pageState('m01'), 'ready');
  assert.strictEqual(store.pageState('m02'), 'soon');
  store.setSectionRead('m01', 'a', true);
  store.setSectionRead('m01', 'zzz', true);   // sección inexistente: no cuenta
  assert.strictEqual(store.pageProgress('m01').read, 1);
  assert.strictEqual(store.pageProgress('m01').pct, 25);
  assert.strictEqual(store.pageState('m01'), 'progress');
  store.setPageCompleted('m01', true);
  assert.strictEqual(store.pageState('m01'), 'done');
  const cp = store.courseProgress();
  assert.strictEqual(cp.total, 28);
  assert.strictEqual(cp.done, 1);
  assert.strictEqual(cp.ready, 1);
  assert.strictEqual(cp.pct, 4);
  store.setSectionRead('m01', 'a', false);
  assert.strictEqual(store.isSectionRead('m01', 'a'), false);
});

test('suscriptores reciben el tipo de cambio; no se notifica si nada cambia', () => {
  const { store } = makeEnv();
  const kinds = [];
  const off = store.subscribe((k) => kinds.push(k));
  store.setSectionRead('m01', 'a', true);
  store.setSectionRead('m01', 'a', true);     // sin cambio
  store.gradeCard('m01-01', 'good');
  store.setPref('theme', 'light');
  store.setPref('theme', 'light');            // sin cambio
  off();
  store.setPref('theme', 'dark');
  assert.deepStrictEqual(kinds, ['progress', 'flash', 'prefs']);
});

test('Leitner: intervalos [0,1,3,7,16] días, hard en caja 0 → 10 min, again → caja 0', () => {
  const env = makeEnv();
  const { store } = env;
  const t0 = env.clock.t;
  const unseen = store.cardState('x');
  assert.strictEqual(unseen.box, 0);
  assert.strictEqual(unseen.due, t0);
  assert.deepStrictEqual(Array.from(store.dueCards(['x', 'y'])), ['x', 'y']);

  let s = store.gradeCard('x', 'hard');
  assert.strictEqual(s.box, 0);
  assert.strictEqual(s.due, t0 + 10 * MIN);
  assert.deepStrictEqual(Array.from(store.dueCards(['x', 'y'])), ['y']);

  const expect = [1, 3, 7, 16, 16];
  for (let i = 0; i < 5; i++) {
    s = store.gradeCard('x', 'good');
    assert.strictEqual(s.box, Math.min(4, i + 1));
    assert.strictEqual(s.due, env.clock.t + expect[i] * DAY);
  }
  s = store.gradeCard('x', 'hard');
  assert.strictEqual(s.box, 4);
  assert.strictEqual(s.due, env.clock.t + DAY);
  s = store.gradeCard('x', 'again');
  assert.strictEqual(s.box, 0);
  assert.strictEqual(s.due, env.clock.t);
  assert.strictEqual(s.lapses, 1);
  assert.strictEqual(s.seen, 8);
  const st = store.flashStats(['x', 'y', 'z']);
  assert.deepStrictEqual(Array.from(st.boxes), [3, 0, 0, 0, 0]);
  assert.strictEqual(st.due, 3);
  // una tarjeta en caja 1 vence al día siguiente
  store.gradeCard('y', 'good');
  env.clock.t += DAY - 1;
  assert.ok(!store.dueCards(['y']).includes('y'));
  env.clock.t += 1;
  assert.ok(store.dueCards(['y']).includes('y'));
});

test('práctica: borrador único, tiempo transcurrido, terminar, listar, descartar, borrar', () => {
  const env = makeEnv();
  const { store } = env;
  assert.strictEqual(store.getDraft('c01'), null);
  const d1 = store.startDraft('c01');
  const d2 = store.startDraft('c01');
  assert.strictEqual(d1.id, d2.id, 'un solo borrador por caso');
  assert.strictEqual(d1.status, 'draft');
  store.updateDraft('c01', { text: 'hola', running: true, resumedAt: env.clock.t, status: 'done', id: 'hack' });
  let d = store.getDraft('c01');
  assert.strictEqual(d.text, 'hola');
  assert.strictEqual(d.status, 'draft', 'status no se cambia con updateDraft');
  assert.strictEqual(d.id, d1.id);
  // la copia devuelta no modifica el estado interno
  d.text = 'mutado';
  assert.strictEqual(store.getDraft('c01').text, 'hola');
  // tope de texto
  store.updateDraft('c01', { text: 'x'.repeat(100050) });
  assert.strictEqual(store.getDraft('c01').text.length, 100000);

  env.clock.t += 90 * 1000;
  const done = store.finishAttempt('c01', { rubric: { aclaracion: { level: 3, points: ['p1'] } }, score: { total: 18, max: 24, pct: 75 } });
  assert.strictEqual(done.status, 'done');
  assert.strictEqual(done.elapsedSec, 90);
  assert.strictEqual(done.running, false);
  assert.strictEqual(done.finishedAt, env.clock.t);
  assert.strictEqual(store.getDraft('c01'), null);
  assert.strictEqual(store.pageState('c01'), 'soon', 'c01 no está listo en este catálogo de prueba');

  env.clock.t += 1000;
  store.startDraft('c01');
  env.clock.t += 1000;
  store.finishAttempt('c01', { score: { total: 12, max: 24, pct: 50 } });
  env.clock.t += 1000;
  store.startDraft('c02');
  const list = store.listAttempts('c01');
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].score.pct, 50, 'más reciente primero');
  assert.strictEqual(store.listAttempts().length, 2);
  assert.strictEqual(store.listAttempts({ includeDrafts: true }).length, 3);
  assert.strictEqual(store.listAttempts('c02', { includeDrafts: true }).length, 1);

  const saved = store.saveRubric(list[1].id, { x: 1 }, { total: 20, max: 24, pct: 83 });
  assert.strictEqual(saved.score.pct, 83);
  assert.strictEqual(store.saveRubric('no-existe', {}, {}), null);

  store.discardDraft('c02');
  assert.strictEqual(store.getDraft('c02'), null);
  store.deleteAttempt(list[0].id);
  assert.strictEqual(store.listAttempts('c01').length, 1);
  assert.ok(store.getState().tomb[list[0].id] > 0, 'queda lápida del borrado');
});

test('preferencias: valores por defecto y copias aisladas', () => {
  const { store } = makeEnv();
  assert.strictEqual(store.pref('theme'), 'system');
  const sr = store.pref('solutionRevealed');
  assert.deepStrictEqual(Object.assign({}, sr), {});
  sr.c01 = true;   // mutar la copia no cambia el estado
  assert.deepStrictEqual(Object.assign({}, store.pref('solutionRevealed')), {});
  store.setPref('solutionRevealed', Object.assign(store.pref('solutionRevealed'), { c01: true }));
  assert.strictEqual(store.pref('solutionRevealed').c01, true);
  assert.strictEqual(store.pref('noExiste'), undefined);
});

test('exportar / importar: ida y vuelta, validación y fusión por timestamp', () => {
  const a = makeEnv();
  a.store.setSectionRead('m01', 'a', true);
  a.store.gradeCard('m01-01', 'good');
  a.store.startDraft('c01');
  a.store.updateDraft('c01', { text: 'mi diseño' });
  a.store.setPref('theme', 'dark');
  const json = a.store.exportJSON();
  assert.strictEqual(JSON.parse(json).app, 'ronda-diseno-ml');

  const b = makeEnv();
  b.clock.t += 5000;
  b.store.setPref('theme', 'light');   // más reciente que el del respaldo → gana
  const r = b.store.importJSON(json);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sections, 1);
  assert.strictEqual(b.store.isSectionRead('m01', 'a'), true);
  assert.strictEqual(b.store.cardState('m01-01').box, 1);
  assert.strictEqual(b.store.getDraft('c01').text, 'mi diseño');
  assert.strictEqual(b.store.pref('theme'), 'light');

  assert.strictEqual(b.store.importJSON('no json').ok, false);
  assert.strictEqual(b.store.importJSON('[1,2]').ok, false);
  assert.strictEqual(b.store.importJSON('{"v":2,"progress":{}}').ok, false);
  assert.strictEqual(b.store.importJSON('{"v":1}').ok, false);
  assert.strictEqual(b.store.importJSON('{"v":1,"progress":[]}').ok, false);
  assert.ok(typeof b.store.importJSON('{}').error === 'string');
});

test('sync: fusiona lo remoto al arrancar y escribe solo lo que cambió, coalescido', async () => {
  const remoteMain = {
    v: 1, updatedAt: T0 - 1000,
    progress: { updatedAt: T0 - 1000, sections: { 'm01.b': { read: true, at: T0 - 1000 } }, pages: {} },
    flash: { updatedAt: 0, cards: {} }, prefs: { updatedAt: 0, values: {} }, checklists: { updatedAt: 0, items: {} },
    lastLocation: { updatedAt: T0 - 1000, hash: '#m01.b' }, tomb: {},
  };
  const db = fakeDb({ [MAIN]: remoteMain });
  const ls = fakeStorage();
  const env = makeEnv({ storage: ls, claude: fakeClaude(db) });
  const statuses = [];
  env.store.onStatus((s) => statuses.push(s));
  const kinds = [];
  env.store.subscribe((k) => kinds.push(k));
  assert.strictEqual(env.store.backend(), 'local', 'no bloquea el arranque');
  await env.advance(0);
  assert.strictEqual(env.store.backend(), 'account');
  assert.deepStrictEqual(statuses, ['account']);
  assert.ok(kinds.includes('remote'));
  assert.strictEqual(env.store.isSectionRead('m01', 'b'), true, 'se trajo lo remoto');
  assert.strictEqual(env.store.lastLocation(), '#m01.b');
  await env.advance(5000);
  assert.strictEqual(db.log.length, 0, 'lo remoto ya estaba al día: no se reescribe');

  // Ráfaga de cambios → una sola escritura ≥ 2 s después del último.
  env.store.setSectionRead('m01', 'a', true);
  await env.advance(1000);
  env.store.setSectionRead('m01', 'c', true);
  await env.advance(1500);
  assert.strictEqual(db.log.length, 0);
  await env.advance(600);
  assert.deepStrictEqual(db.log, [['set', MAIN]]);
  assert.strictEqual(db.docs.get(MAIN).progress.sections['m01.c'].read, true);

  // Intentos: documento propio en la subcolección; borrar → delete + lápida en el principal.
  const d = env.store.startDraft('c01');
  env.store.updateDraft('c01', { text: 'borrador' });
  await env.advance(2100);
  const apath = MAIN + '/attempts/' + d.id;
  assert.strictEqual(db.docs.get(apath).text, 'borrador');
  db.log.length = 0;
  env.store.discardDraft('c01');
  await env.advance(2100);
  assert.ok(!db.docs.has(apath));
  assert.ok(db.log.some((x) => x[0] === 'delete' && x[1] === apath));
  assert.ok(db.docs.get(MAIN).tomb[d.id] > 0);
  assert.ok(db.maxInFlight() <= 1, 'una escritura a la vez');
});

test('sync: lo local más reciente gana y se sube; las lápidas remotas borran intentos locales', async () => {
  const ls = fakeStorage();
  const first = makeEnv({ storage: ls });
  first.store.setSectionRead('m01', 'a', true);
  const dead = first.store.startDraft('c03');
  first.store.updateDraft('c03', { text: 'viejo' });
  first.store.flush();

  const db = fakeDb({
    [MAIN]: { v: 1, updatedAt: T0 + 10, progress: { updatedAt: 0, sections: {}, pages: {} }, flash: { updatedAt: 0, cards: {} },
      prefs: { updatedAt: 0, values: {} }, checklists: { updatedAt: 0, items: {} }, lastLocation: { updatedAt: 0, hash: '' },
      tomb: { [dead.id]: T0 + 10 } },
  });
  const env = makeEnv({ storage: ls, claude: fakeClaude(db) });
  env.clock.t = T0 + 20;
  await env.advance(0);
  assert.strictEqual(env.store.getDraft('c03'), null, 'la lápida remota elimina el borrador local');
  await env.advance(2100);
  assert.strictEqual(db.docs.get(MAIN).progress.sections['m01.a'].read, true, 'lo local se subió');
});

test('sync: invalid_argument en el documento principal → vuelve a guardado local', async () => {
  const db = fakeDb({});
  const env = makeEnv({ storage: fakeStorage(), claude: fakeClaude(db) });
  await env.advance(0);
  assert.strictEqual(env.store.backend(), 'account');
  db.failNextWrite(MAIN, 'invalid_argument');
  env.store.setSectionRead('m01', 'a', true);
  await env.advance(2100);
  assert.strictEqual(env.store.backend(), 'local');
  env.store.setSectionRead('m01', 'b', true);
  await env.advance(5000);
  assert.ok(!db.docs.has(MAIN), 'no se vuelve a intentar');
});

test('sync: unavailable → un reintento tras 1–3 s', async () => {
  const db = fakeDb({});
  const env = makeEnv({ storage: fakeStorage(), claude: fakeClaude(db) });
  await env.advance(0);
  db.failNextWrite(MAIN, 'unavailable');
  env.store.setSectionRead('m01', 'a', true);
  await env.advance(2100);
  assert.ok(!db.docs.has(MAIN));
  await env.advance(3100);
  assert.ok(db.docs.has(MAIN), 'el reintento escribió');
  assert.strictEqual(env.store.backend(), 'account');
});

test('sync: sin claude.use o con use() → null, se queda en local', async () => {
  const env = makeEnv({ storage: fakeStorage(), claude: { use: async () => null } });
  await env.advance(0);
  assert.strictEqual(env.store.backend(), 'local');
  const env2 = makeEnv({ storage: fakeStorage(), claude: fakeClaude(fakeDb({}), null) });
  await env2.advance(0);
  assert.strictEqual(env2.store.backend(), 'local', 'sin uid no hay sincronización');
});
