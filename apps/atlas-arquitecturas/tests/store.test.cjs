// Pruebas de js/core/store.js (lógica pura + sincronización simulada), sin navegador.
// Basado en apps/ml-system-design/tests/store.test.cjs.
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
const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);
const TEMPLATE_IDS = ['para-que', 'puente', 'diagrama', 'operaciones', 'costo', 'entrenamiento', 'inferencia', 'fallas', 'variantes', 'entrevista', 'practica'];

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
    // repaso (recap, listo), vit (modelo, listo con 11 secciones), swin (modelo sin contenido),
    // mapa (especial, no cuenta en el progreso), resnet (tarjeta, no cuenta).
    vm.runInContext(`
      ATLAS.defineCatalog({ version: 1, families: [], items: {
        'repaso-atencion': { id: 'repaso-atencion', kind: 'recap', block: 0, num: 0, title: 'Repaso de atención' },
        vit: { id: 'vit', kind: 'model', block: 1, num: 1, title: 'ViT', short: 'ViT' },
        swin: { id: 'swin', kind: 'model', block: 1, num: 2, title: 'Swin', short: 'Swin' },
        mapa: { id: 'mapa', kind: 'special', title: 'Mapa' },
        resnet: { id: 'resnet', kind: 'card', title: 'ResNet', anchor: true },
      }, roadmap: [] });
      ATLAS.register({ id: 'repaso-atencion', sections: [
        { id: 'a', title: 'A', blocks: [{ t: 'p', html: 'x' }] },
        { id: 'b', title: 'B', blocks: [{ t: 'p', html: 'x' }] },
        { id: 'c', title: 'C', blocks: [{ t: 'p', html: 'x' }] },
        { id: 'd', title: 'D', blocks: [{ t: 'p', html: 'x' }] },
      ] });
      ATLAS.register({ id: 'vit', sections: ${JSON.stringify(TEMPLATE_IDS)}.map((id) => ({ id, blocks: [{ t: 'p', html: id }] })) });
      ATLAS.register({ id: 'mapa', sections: [{ id: 'familias', title: 'Familias', blocks: [] }] });
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
  return { ctx, store: ctx.ATLAS.store, ATLAS: ctx.ATLAS, clock, advance, flushMicro, pending: () => timers.length };
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
  const colRef = (path) => ({ path, doc: (id) => docRef(path + '/' + id), get: async () => ({ docs: [], size: 0, empty: true }) });
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
const PRAC = 'data/users/u_test/practice';

test('carga en Node sin localStorage: backend memory y la API funciona', () => {
  const { store } = makeEnv();
  assert.strictEqual(store.backend(), 'memory');
  store.setSectionRead('vit', 'diagrama', true);
  assert.strictEqual(store.isSectionRead('vit', 'diagrama'), true);
  assert.deepStrictEqual(Array.from(store.listAttempts()), [], 'shim de compatibilidad');
});

test('localStorage que lanza al acceder → memory, sin excepciones', () => {
  const bad = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() {} };
  const { store } = makeEnv({ storage: bad });
  assert.strictEqual(store.backend(), 'memory');
  store.setPref('theme', 'dark');
  assert.strictEqual(store.pref('theme'), 'dark');
});

test('persistencia local en atlas.v1: se escribe coalescida y se recupera al recargar', async () => {
  const ls = fakeStorage();
  const env = makeEnv({ storage: ls });
  assert.strictEqual(env.store.backend(), 'local');
  assert.strictEqual(env.store.KEY, 'atlas.v1');
  env.store.setSectionRead('vit', 'diagrama', true);
  env.store.setChecklistItem('vit', 'checklist', 'formas', true);
  env.store.setLastLocation('#vit.diagrama~enc-layer');
  env.store.drillResult('vit:shape:qkv', { ok: true, answer: '197x2304' });
  env.store.setBlankSlot('vit-overview', 'patch-embed', 'Patch embedding');
  assert.strictEqual(ls.getItem('atlas.v1'), null, 'aún no se escribió (coalescido)');
  await env.advance(300);
  assert.ok(ls.getItem('atlas.v1'));
  assert.strictEqual(ls.getItem('msd.v1'), null, 'no usa la clave de la Ronda');
  const env2 = makeEnv({ storage: ls });
  assert.strictEqual(env2.store.isSectionRead('vit', 'diagrama'), true);
  assert.deepStrictEqual(Object.assign({}, env2.store.getChecklist('vit', 'checklist')), { formas: true });
  assert.strictEqual(env2.store.lastLocation(), '#vit.diagrama~enc-layer');
  assert.strictEqual(env2.store.drillStats('vit:').ok, 1);
  assert.strictEqual(env2.store.blankDiagram('vit-overview').filled['patch-embed'], 'Patch embedding');
});

test('dos pestañas con el mismo localStorage: la escritura de una no borra lo que guardó la otra', async () => {
  const ls = fakeStorage();
  const A = makeEnv({ storage: ls });
  const B = makeEnv({ storage: ls });   // abierta antes de que A guarde nada
  A.store.drillResult('vit:shape:x0', { ok: true, answer: '197x768' });
  A.store.gradeCard('vit-01', 'good');
  A.store.flush();
  const kinds = [];
  B.store.subscribe((k) => kinds.push(k));
  B.clock.t += 10;
  B.store.setSectionRead('vit', 'para-que', true);
  B.store.drillResult('vit:shape:qkv', { ok: false, answer: '197x768' });
  B.store.flush();
  const saved = JSON.parse(ls.getItem('atlas.v1'));
  assert.strictEqual(saved.progress.sections['vit.para-que'].read, true, 'lo de B');
  assert.strictEqual(saved.flash.cards['vit-01'].box, 1, 'y la tarjeta de A sigue');
  assert.strictEqual(Object.keys(saved.drills.items).length, 2, 'drills de ambas pestañas');
  assert.strictEqual(saved.drills.log.length, 2, 'historial unido sin duplicados');
  assert.strictEqual(B.store.drillStats('vit:').seen, 2, 'B ve el drill de A');
  assert.ok(kinds.includes('remote'), 'B avisa que trajo datos de otra pestaña');
});

test('JSON corrupto en localStorage: estado vacío y copia de respaldo', () => {
  const ls = fakeStorage({ 'atlas.v1': '{roto' });
  const { store } = makeEnv({ storage: ls });
  assert.strictEqual(store.backend(), 'local');
  assert.strictEqual(store.lastLocation(), '');
  assert.strictEqual(ls.getItem('atlas.v1.corrupto'), '{roto');
});

test('progreso de página y del curso: cuenta modelos + repaso, no el mapa ni las tarjetas', () => {
  const { store } = makeEnv();
  assert.deepStrictEqual(Object.assign({}, store.pageProgress('repaso-atencion')), { read: 0, total: 4, pct: 0, completed: false });
  assert.strictEqual(store.pageState('repaso-atencion'), 'ready');
  assert.strictEqual(store.pageState('vit'), 'ready', 'modelo con sus 11 secciones');
  assert.strictEqual(store.pageState('swin'), 'soon', 'modelo sin contenido');
  assert.strictEqual(store.pageState('resnet'), 'soon', 'una tarjeta nunca está lista');
  store.setSectionRead('repaso-atencion', 'a', true);
  store.setSectionRead('repaso-atencion', 'zzz', true);   // sección inexistente: no cuenta
  assert.strictEqual(store.pageProgress('repaso-atencion').read, 1);
  assert.strictEqual(store.pageProgress('repaso-atencion').pct, 25);
  assert.strictEqual(store.pageState('repaso-atencion'), 'progress');
  store.setPageCompleted('repaso-atencion', true);
  assert.strictEqual(store.pageState('repaso-atencion'), 'done');
  const cp = store.courseProgress();
  assert.strictEqual(cp.total, 3, 'repaso + vit + swin');
  assert.strictEqual(cp.done, 1);
  assert.strictEqual(cp.ready, 2);
  assert.strictEqual(cp.pct, 33);
  // Un drill respondido de un modelo lo deja "en curso" aunque no haya secciones leídas.
  store.drillResult('vit:shape:qkv', { ok: true });
  assert.strictEqual(store.pageState('vit'), 'progress');
  assert.strictEqual(store.courseProgress().inProgress, 1);
});

test('suscriptores reciben el tipo de cambio; no se notifica si nada cambia', () => {
  const { store } = makeEnv();
  const kinds = [];
  const off = store.subscribe((k) => kinds.push(k));
  store.setSectionRead('vit', 'a', true);
  store.setSectionRead('vit', 'a', true);     // sin cambio
  store.gradeCard('vit-01', 'good');
  store.setPref('theme', 'light');
  store.setPref('theme', 'light');            // sin cambio
  store.drillResult('vit:x', { ok: true });
  store.setBlankSlot('d', 's', 'a');
  store.setBlankSlot('d', 's', 'a');          // sin cambio
  off();
  store.setPref('theme', 'dark');
  assert.deepStrictEqual(kinds, ['progress', 'flash', 'prefs', 'drill', 'blank']);
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
  store.gradeCard('y', 'good');
  env.clock.t += DAY - 1;
  assert.ok(!store.dueCards(['y']).includes('y'));
  env.clock.t += 1;
  assert.ok(store.dueCards(['y']).includes('y'));
});

test('drills: resultado por drill, estadísticas por prefijo y racha', () => {
  const env = makeEnv();
  const { store } = env;
  assert.deepStrictEqual(Object.assign({}, store.drillStats()), { seen: 0, ok: 0, streak: 0, lastAt: null, drills: 0 });
  assert.strictEqual(store.drillState('vit:shape:qkv'), null);
  let r = store.drillResult('vit:shape:qkv', { ok: false, answer: '197x768' });
  assert.strictEqual(r.seen, 1);
  assert.strictEqual(r.ok, 0);
  env.clock.t += 1000;
  r = store.drillResult('vit:shape:qkv', { ok: true, answer: '197 × 2304' });
  assert.strictEqual(r.seen, 2);
  assert.strictEqual(r.ok, 1);
  assert.strictEqual(r.lastOk, true);
  assert.strictEqual(store.drillState('vit:shape:qkv').answer, '197 × 2304');
  env.clock.t += 1000;
  store.drillResult('vit:whatif:res448', { ok: true, answer: 'x4' });
  env.clock.t += 1000;
  store.drillResult('swin:shape:x0', { ok: false });
  env.clock.t += 1000;
  store.drillResult('vit:blank:vit-overview', { ok: true });

  const all = store.drillStats();
  assert.strictEqual(all.seen, 5);
  assert.strictEqual(all.ok, 3);
  assert.strictEqual(all.drills, 4);
  assert.strictEqual(all.streak, 1, 'la respuesta anterior (swin) fue incorrecta');
  assert.strictEqual(all.lastAt, env.clock.t);
  const vit = store.drillStats('vit:');
  assert.strictEqual(vit.seen, 4);
  assert.strictEqual(vit.ok, 3);
  assert.strictEqual(vit.streak, 3, 'dentro de vit: tres correctas seguidas');
  assert.strictEqual(store.drillStats('swin:').streak, 0);
  // ids inválidos se ignoran sin lanzar
  assert.strictEqual(store.drillResult('', { ok: true }), null);
  assert.strictEqual(store.drillResult('con espacios', { ok: true }), null);
  // respuesta recortada
  store.drillResult('vit:largo', { ok: true, answer: 'x'.repeat(500) });
  assert.strictEqual(store.drillState('vit:largo').answer.length, 200);
});

test('drills: el historial para la racha está acotado', () => {
  const env = makeEnv();
  for (let i = 0; i < 450; i++) { env.clock.t += 1; env.store.drillResult('vit:d' + (i % 7), { ok: true }); }
  assert.strictEqual(env.store.getState().drills.log.length, 400);
  assert.strictEqual(env.store.drillStats().streak, 400);
  assert.strictEqual(env.store.drillStats().seen, 450, 'los conteos por drill no se recortan');
});

test('diagramas en blanco: casillas, comprobar y reiniciar', () => {
  const env = makeEnv();
  const { store } = env;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(store.blankDiagram('vit-overview'))), { filled: {} });
  store.setBlankSlot('vit-overview', 'patch-embed', 'opt-patch');
  store.setBlankSlot('vit-overview', 'patch-embed>flatten', '14x14x768');
  store.setBlankSlot('vit-overview', 'head', 'opt-head');
  store.setBlankSlot('vit-overview', 'head', null);   // vaciar
  let b = store.blankDiagram('vit-overview');
  assert.deepStrictEqual(Object.assign({}, b.filled), { 'patch-embed': 'opt-patch', 'patch-embed>flatten': '14x14x768' });
  assert.strictEqual(b.checkedAt, undefined);
  env.clock.t += 5000;
  store.checkBlankDiagram('vit-overview', { ok: 1, total: 2 });
  b = store.blankDiagram('vit-overview');
  assert.strictEqual(b.checkedAt, env.clock.t);
  assert.deepStrictEqual(Object.assign({}, b.result), { ok: 1, total: 2 });
  env.clock.t += 1000;
  store.resetBlankDiagram('vit-overview');
  b = store.blankDiagram('vit-overview');
  assert.deepStrictEqual(Object.assign({}, b.filled), {});
  assert.strictEqual(b.checkedAt, undefined);
  // ids inválidos: no hacen nada
  store.setBlankSlot('con espacio', 's', 'a');
  assert.deepStrictEqual(Object.assign({}, store.blankDiagram('con espacio').filled), {});
});

test('preferencias: valores por defecto (theme, legendOpen, showNumbers) y copias aisladas', () => {
  const { store } = makeEnv();
  assert.strictEqual(store.pref('theme'), 'system');
  assert.strictEqual(store.pref('legendOpen'), true);
  assert.strictEqual(store.pref('showNumbers'), true);
  store.setPref('showNumbers', false);
  assert.strictEqual(store.pref('showNumbers'), false);
  store.setPref('obj', { a: 1 });
  const o = store.pref('obj');
  o.a = 2;
  assert.strictEqual(store.pref('obj').a, 1, 'mutar la copia no cambia el estado');
  assert.strictEqual(store.pref('noExiste'), undefined);
});

test('exportar / importar: ida y vuelta, validación y fusión por timestamp', () => {
  const a = makeEnv();
  a.store.setSectionRead('vit', 'diagrama', true);
  a.store.gradeCard('vit-01', 'good');
  a.store.drillResult('vit:shape:qkv', { ok: true, answer: '197x2304' });
  a.store.setBlankSlot('vit-overview', 'head', 'opt-head');
  a.store.setPref('theme', 'dark');
  const json = a.store.exportJSON();
  assert.strictEqual(JSON.parse(json).app, 'atlas-arquitecturas');

  const b = makeEnv();
  b.clock.t += 5000;
  b.store.setPref('theme', 'light');   // más reciente que el del respaldo → gana
  const r = b.store.importJSON(json);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.sections, 1);
  assert.strictEqual(r.cards, 1);
  assert.strictEqual(r.drills, 1);
  assert.strictEqual(b.store.isSectionRead('vit', 'diagrama'), true);
  assert.strictEqual(b.store.cardState('vit-01').box, 1);
  assert.strictEqual(b.store.drillStats('vit:').ok, 1);
  assert.strictEqual(b.store.blankDiagram('vit-overview').filled.head, 'opt-head');
  assert.strictEqual(b.store.pref('theme'), 'light');
  // importar dos veces no duplica el historial
  b.store.importJSON(json);
  assert.strictEqual(b.store.getState().drills.log.length, 1);

  assert.strictEqual(b.store.importJSON('no json').ok, false);
  assert.strictEqual(b.store.importJSON('[1,2]').ok, false);
  assert.strictEqual(b.store.importJSON('{"v":2,"progress":{}}').ok, false);
  assert.strictEqual(b.store.importJSON('{"v":1}').ok, false);
  assert.strictEqual(b.store.importJSON('{"v":1,"progress":[]}').ok, false);
  assert.strictEqual(b.store.importJSON('{"app":"ronda-diseno-ml","v":1,"state":{"v":1,"progress":{}}}').ok, false, 'respaldo de otra app');
  assert.ok(typeof b.store.importJSON('{}').error === 'string');
});

test('sync: fusiona lo remoto al arrancar y escribe solo lo que cambió, coalescido, por documento', async () => {
  const remoteMain = {
    v: 1, updatedAt: T0 - 1000,
    progress: { updatedAt: T0 - 1000, sections: { 'vit.puente': { read: true, at: T0 - 1000 } }, pages: {} },
    flash: { updatedAt: 0, cards: {} }, prefs: { updatedAt: 0, values: {} }, checklists: { updatedAt: 0, items: {} },
    lastLocation: { updatedAt: T0 - 1000, hash: '#vit.puente' },
  };
  const remotePrac = {
    v: 1, updatedAt: T0 - 1000,
    drills: { updatedAt: T0 - 1000, items: { 'vit:shape:x0': { seen: 1, ok: 1, lastOk: true, answer: '197x768', lastAt: T0 - 1000 } }, log: [{ id: 'vit:shape:x0', ok: true, at: T0 - 1000 }] },
    blank: { updatedAt: 0, items: {} },
  };
  const db = fakeDb({ [MAIN]: remoteMain, [PRAC]: remotePrac });
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
  assert.strictEqual(env.store.isSectionRead('vit', 'puente'), true, 'se trajo lo remoto');
  assert.strictEqual(env.store.lastLocation(), '#vit.puente');
  assert.strictEqual(env.store.drillStats('vit:').ok, 1, 'y la práctica remota');
  await env.advance(5000);
  assert.strictEqual(db.log.length, 0, 'lo remoto ya estaba al día: no se reescribe');

  // Ráfaga de cambios → una sola escritura ≥ 2 s después del último.
  env.store.setSectionRead('vit', 'para-que', true);
  await env.advance(1000);
  env.store.setSectionRead('vit', 'diagrama', true);
  await env.advance(1500);
  assert.strictEqual(db.log.length, 0);
  await env.advance(600);
  assert.deepStrictEqual(db.log, [['set', MAIN]], 'responder drills no toca el principal y viceversa');
  assert.strictEqual(db.docs.get(MAIN).progress.sections['vit.diagrama'].read, true);
  assert.ok(!('drills' in db.docs.get(MAIN)), 'la práctica no va en el documento principal');

  db.log.length = 0;
  env.store.drillResult('vit:shape:qkv', { ok: true, answer: '197x2304' });
  env.store.setBlankSlot('vit-overview', 'head', 'opt-head');
  await env.advance(2100);
  assert.deepStrictEqual(db.log, [['set', PRAC]]);
  assert.strictEqual(db.docs.get(PRAC).drills.items['vit:shape:qkv'].ok, 1);
  assert.strictEqual(db.docs.get(PRAC).blank.items['vit-overview'].slots.head.v, 'opt-head');
  assert.ok(db.maxInFlight() <= 1, 'una escritura a la vez');
});

test('sync: lo local más reciente gana y se sube', async () => {
  const ls = fakeStorage();
  const first = makeEnv({ storage: ls });
  first.store.setSectionRead('vit', 'para-que', true);
  first.store.drillResult('vit:shape:x0', { ok: true });
  first.store.flush();

  const db = fakeDb({});
  const env = makeEnv({ storage: ls, claude: fakeClaude(db) });
  env.clock.t = T0 + 20;
  await env.advance(0);
  await env.advance(2100);
  assert.strictEqual(db.docs.get(MAIN).progress.sections['vit.para-que'].read, true, 'lo local se subió');
  assert.strictEqual(db.docs.get(PRAC).drills.items['vit:shape:x0'].ok, 1);
});

test('sync: invalid_argument en el documento principal → vuelve a guardado local', async () => {
  const db = fakeDb({});
  const env = makeEnv({ storage: fakeStorage(), claude: fakeClaude(db) });
  await env.advance(0);
  assert.strictEqual(env.store.backend(), 'account');
  db.failNextWrite(MAIN, 'invalid_argument');
  await env.advance(2100);
  assert.strictEqual(env.store.backend(), 'local');
  env.store.setSectionRead('vit', 'puente', true);
  await env.advance(5000);
  assert.ok(!db.docs.has(MAIN), 'no se vuelve a intentar');
});

test('sync: unavailable → un reintento tras 1–3 s', async () => {
  const db = fakeDb({});
  const env = makeEnv({ storage: fakeStorage(), claude: fakeClaude(db) });
  await env.advance(0);
  await env.advance(2100);   // escritura inicial de ambos documentos
  db.failNextWrite(MAIN, 'unavailable');
  env.store.setSectionRead('vit', 'para-que', true);
  await env.advance(2100);
  assert.strictEqual(db.docs.get(MAIN).progress.sections['vit.para-que'], undefined, 'falló la escritura');
  await env.advance(3100);
  assert.strictEqual(db.docs.get(MAIN).progress.sections['vit.para-que'].read, true, 'el reintento escribió');
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

test('sin catálogo: courseProgress vacío y pageState "soon", sin lanzar', () => {
  const { store } = makeEnv({ withCatalog: false });
  assert.deepStrictEqual(Object.assign({}, store.courseProgress()), { done: 0, inProgress: 0, ready: 0, total: 0, pct: 0 });
  assert.strictEqual(store.pageState('vit'), 'soon');
});
