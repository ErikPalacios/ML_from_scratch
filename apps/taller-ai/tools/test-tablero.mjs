#!/usr/bin/env node
// Pruebas de «Tu tablero» (site/tablero): el documento, el motor del tablero con el esquema del Dojo y la
// importación de taller/progreso.json. Corre con node --test (lo llama npm run check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nuevoTablero, migrar, validar, aplicar, opsDeProgreso, opsEstado, aIso, queEs, RONDAS } from '../site/tablero/modelo.mjs';
import { crearAlmacen } from '../site/tablero/almacen.mjs';
import { plantillaTablero } from './tablero.mjs';
import { LINEAS, TRONCO as tronco, RAMAS, enLinea, etapaDe, cruzadasLinea, revisarRamas } from './lineas.mjs';
import { estacion as molde, cruzadas, normalizar } from './schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const est = readdirSync(join(ROOT, 'content', 'estaciones')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'content', 'estaciones', f), 'utf8')));
// como en el build: cada estación en su línea (slug, url, etapa de la T); kitUrl = url basta para la plantilla
const enSuLinea = (e) => { const x = enLinea(normalizar(JSON.parse(JSON.stringify(e)))); x.kitUrl = x.url; return x; };
const P = plantillaTablero(est.map(enSuLinea), LINEAS);
// Una estación de rama de prueba (todavía no hay ninguna con taller): la 5 de IA Privada, «RAG privado», hecha con
// el contenido de una del tronco. Lo que importa aquí es su línea, su número y su etapa, no su contenido.
const IA = RAMAS.find((r) => r.id === 'ia-privada');
const RAG = IA.estaciones.find((s) => s.num === 5);
const deRama = (() => { const x = JSON.parse(JSON.stringify(est.find((e) => e.id === 'versionado'))); delete x.caso; return { ...x, rama: IA.id, id: RAG.id, num: RAG.num, titulo: RAG.titulo, etapa: RAG.etapa }; })();
const PR = plantillaTablero([...est, deRama].map(enSuLinea), LINEAS);

// las estaciones con taller, en el orden del tronco; los casos de prueba las buscan por id, no por posición
const CON_TALLER = tronco.estaciones.filter((t) => est.some((e) => e.caso === tronco.caso && e.id === t.id)).map((t) => `${tronco.caso}-${t.id}`);
const PROXIMAS = [...LINEAS.values()].reduce((n, l) => n + l.total, 0) - CON_TALLER.length;
const de = (doc, id) => doc.estaciones.find((x) => x.id === id);

const memoria = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const importar = (doc, p) => { const r = opsDeProgreso(doc, p, P); const a = aplicar(doc, r.ops); assert.deepEqual(a.rejected, []); return { doc: a.project, r }; };

const PROGRESO = {
  estacion: 'c01-datos',
  rondas: {
    guiado: { estado: 'hecha', inicio: '2026-11-03T10:05:00-06:00', fin: '2026-11-03T13:40:00-06:00' },
    solo: { estado: 'en_curso', inicio: '2026-11-04', fin: null, pistas: 2 },
    romper_ayuda: { estado: 'pendiente', fallas: [{ id: 'zona-horaria', inicio: '2026-11-05T16:00:00Z', fin: '2026-11-05T16:25:30Z', minutos: 25.5, pistas: 1, rendido: false, aprendi: 'La ventana de 30 días se mide en UTC.' }] },
    romper_solo: { estado: 'pendiente', fallas: [] },
  },
  bitacora: [
    { fecha: '2026-11-03T10:30:00-06:00', ronda: 'guiado', paso: 'senales', hice: 'Uní las señales por request_id.', medi: '24,000 filas', sigue: 'Filtrar el label débil' },
    { fecha: '2026-11-04', ronda: 'solo', paso: 'debil', hice: 'Filtro sin ayuda', medi: '', sigue: '' },
  ],
  verificaciones: [{ fecha: '2026-11-03T13:39:00-06:00', pasan: ['mundo', 'senales'], fallan: ['debil'] }],
};

test('la plantilla trae las estaciones con taller y las demás como próximamente', () => {
  assert.deepEqual(P.estaciones.map((e) => e.id), CON_TALLER);
  assert.ok(CON_TALLER.includes('c01-datos') && CON_TALLER.includes('c01-empaquetado'));
  assert.equal(P.proximas.length, PROXIMAS);
  assert.equal(P.proximas.filter((s) => s.grupo === tronco.caso).length, tronco.estaciones.length - CON_TALLER.length);
  assert.equal(P.proximas.filter((s) => s.grupo === 'ia-privada').length, IA.estaciones.length, 'las 8 de IA Privada, próximamente');
  assert.ok(P.estaciones.every((e) => e.objetivos.length && e.fallas.length && e.pasos.length));
});

test('un tablero nuevo es válido y tiene las cuatro rondas por estación, todas pendientes', () => {
  const d = nuevoTablero(P);
  assert.deepEqual(validar(d), []);
  for (const e of d.estaciones) assert.deepEqual(e.rondas.map((r) => [r.id, r.estado]), RONDAS.map((r) => [r.id, 'pendiente']));
});

test('fechas: todo queda en ISO UTC; una fecha sin hora queda a mediodía UTC', () => {
  assert.equal(aIso('2026-11-03T10:05:00-06:00'), '2026-11-03T16:05:00Z');
  assert.equal(aIso('2026-11-03'), '2026-11-03T12:00:00Z');
  assert.equal(aIso('ayer'), null);
});

test('importar progreso.json marca rondas, fallas, bitácora y verificaciones; dos veces no duplica', () => {
  let { doc, r } = importar(nuevoTablero(P), PROGRESO);
  assert.deepEqual(validar(doc), []);
  const e = doc.estaciones.find((x) => x.id === 'c01-datos');
  const estado = Object.fromEntries(e.rondas.map((x) => [x.id, x.estado]));
  assert.deepEqual(estado, { 'construir-con-ayuda': 'hecha', 'construir-solo': 'en_curso', 'romper-con-ayuda': 'en_curso', 'romper-solo': 'pendiente' });
  assert.equal(e.rondas[0].inicio, '2026-11-03T16:05:00Z');
  assert.equal(e.rondas[0].fin, '2026-11-03T19:40:00Z');
  assert.equal(e.rondas[1].pistas, 2);
  assert.equal(e.fallas.length, 1);
  assert.equal(e.fallas[0].minutos, 25.5);
  assert.equal(e.bitacora.length, 2);
  assert.equal(e.verificaciones.length, 1);
  assert.equal(r.nuevas, 4);
  assert.equal(doc.importaciones.length, 1);
  const otra = opsDeProgreso(doc, PROGRESO, P);
  assert.equal(otra.ops.length, 0, 'la misma importación no cambia nada');
  // Claude corrige una entrada y agrega otra: se actualiza una y entra la nueva
  const p2 = JSON.parse(JSON.stringify(PROGRESO));
  p2.bitacora[0].medi = '24,000 filas, 0 duplicadas';
  p2.bitacora.push({ fecha: '2026-11-04T18:00:00Z', ronda: 'solo', paso: 'cola', hice: 'La cola', medi: '', sigue: '' });
  ({ doc, r } = importar(doc, p2));
  assert.equal(r.nuevas, 1);
  assert.equal(r.cambios, 1);
  assert.equal(doc.estaciones[0].bitacora.length, 3);
});

test('lo que anotaste en el tablero no se pierde al reimportar', () => {
  let { doc } = importar(nuevoTablero(P), PROGRESO);
  const f = doc.estaciones[0].fallas[0];
  doc = aplicar(doc, [{ op: 'set', path: ['estaciones', '#c01-datos', 'fallas', `#${f.id}`], value: { ...f, aprendi: '', pistas: 3 } }]).project;
  const p = JSON.parse(JSON.stringify(PROGRESO));
  ({ doc } = importar(doc, p));
  assert.equal(doc.estaciones[0].fallas[0].pistas, 3);
  assert.equal(doc.estaciones[0].fallas[0].aprendi, 'La ventana de 30 días se mide en UTC.');
});

test('el estado más avanzado gana: un progreso.json viejo no regresa una ronda hecha', () => {
  let { doc } = importar(nuevoTablero(P), PROGRESO);
  const viejo = { estacion: 'c01-datos', rondas: { guiado: { estado: 'en_curso', inicio: '2026-11-03', fin: null } }, bitacora: [] };
  ({ doc } = importar(doc, viejo));
  assert.equal(doc.estaciones[0].rondas[0].estado, 'hecha');
});

test('errores claros: archivo ajeno o estación sin taller', () => {
  const d = nuevoTablero(P);
  assert.throws(() => opsDeProgreso(d, [], P), /no es un progreso.json/);
  assert.throws(() => opsDeProgreso(d, { foo: 1 }, P), /falta «estacion»/);
  assert.throws(() => opsDeProgreso(d, { estacion: 'ia-privada-modelo-local' }, P), /no tiene taller/);
  assert.equal(queEs(PROGRESO), 'progreso');
  assert.equal(queEs({ app: 'dojo-tablero', tablero: d }), 'respaldo');
});

test('cambiar una ronda desde el tablero pone la hora de inicio y de fin', () => {
  let d = nuevoTablero(P);
  d = aplicar(d, opsEstado(d, 'c01-empaquetado', 'romper-solo', 'hecha', '2026-11-15T20:00:00Z')).project;
  const r = de(d, 'c01-empaquetado').rondas[3];
  assert.equal(r.estado, 'hecha');
  assert.equal(r.inicio, '2026-11-15T20:00:00Z');
  assert.equal(r.fin, '2026-11-15T20:00:00Z');
  d = aplicar(d, opsEstado(d, 'c01-empaquetado', 'romper-solo', 'pendiente')).project;
  assert.equal(de(d, 'c01-empaquetado').rondas[3].inicio, null);
});

test('el motor rechaza un cambio inválido y deja el resto', () => {
  const d = nuevoTablero(P);
  const r = aplicar(d, [
    { op: 'set', path: ['estaciones', '#c01-datos', 'rondas', '#construir-solo', 'estado'], value: 'terminada' },
    { op: 'insert', path: ['estaciones', '#c01-datos', 'bitacora'], value: { ronda: 'construir-solo', hice: 'algo' } },
  ]);
  assert.equal(r.applied, 1);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.project.estaciones[0].bitacora[0].origen, 'tablero');
});

test('migrar suma estaciones nuevas y rondas que falten sin tocar lo tuyo', () => {
  const viejo = { ...nuevoTablero({ estaciones: [{ id: 'c01-datos' }] }) };
  viejo.estaciones[0].rondas = viejo.estaciones[0].rondas.slice(0, 2);
  viejo.estaciones[0].rondas[0].estado = 'hecha';
  const m = migrar(viejo, P);
  assert.deepEqual(validar(m), []);
  assert.equal(m.estaciones.length, CON_TALLER.length);
  assert.equal(m.estaciones[0].rondas.length, 4);
  assert.equal(m.estaciones[0].rondas[0].estado, 'hecha');
});

test('el almacén guarda en localStorage, restaura un respaldo y se borra', () => {
  const s = memoria();
  const a = crearAlmacen(P, s);
  const r = opsDeProgreso(a.leer(), PROGRESO, P);
  const { tablero } = a.cambiar(r.ops);
  assert.equal(tablero.rev, 1);
  assert.equal(crearAlmacen(P, s).leer().estaciones[0].bitacora.length, 2);
  const otro = crearAlmacen(P, memoria());
  otro.reemplazar(JSON.parse(JSON.stringify(tablero)));
  assert.equal(otro.leer().estaciones[0].fallas.length, 1);
  assert.throws(() => otro.reemplazar({ app: 'dojo-tablero', estaciones: [] }), /no es válido/);
  assert.equal(a.borrar().estaciones[0].bitacora.length, 0);
});

test('el historial de importaciones se queda con las 50 más nuevas', () => {
  let d = nuevoTablero(P);
  for (let i = 0; i < 55; i++) {
    const p = { estacion: 'c01-datos', rondas: {}, bitacora: [{ fecha: `2026-11-03T10:${String(i).padStart(2, '0')}:00Z`, ronda: 'guiado', paso: 'senales', hice: `vuelta ${i}` }] };
    ({ doc: d } = importar(d, p));
  }
  assert.equal(d.importaciones.length, 50);
  assert.equal(d.estaciones[0].bitacora.length, 55);
});

test('dos corridas de verificar.py en el mismo segundo entran las dos', () => {
  const p = { estacion: 'c01-empaquetado', rondas: {}, bitacora: [], verificaciones: [
    { fecha: '2026-11-15T18:58:14-06:00', pasan: ['deps'], fallan: [] }, { fecha: '2026-11-15T18:58:14-06:00', pasan: ['contexto'], fallan: [] }] };
  const { doc } = importar(nuevoTablero(P), p);
  assert.equal(de(doc, 'c01-empaquetado').verificaciones.length, 2);
});

// ---------------------------------------------------------------- tronco y ramas
test('ramas.json: IA Privada con sus 8 estaciones, cada una con su etapa de la T; 1, 5 y 6 corren solo en la Mac', () => {
  assert.deepEqual(revisarRamas(), []);
  assert.equal(IA.estaciones.length, 8);
  assert.deepEqual(IA.sin_gpu.estaciones, [1, 5, 6]);
  for (const n of IA.sin_gpu.estaciones) assert.equal(IA.estaciones[n - 1].donde, 'mac');
  // los errores que atrapa
  const mala = JSON.parse(JSON.stringify(RAMAS));
  const k = mala.findIndex((r) => r.id === 'ia-privada');
  mala[k].estaciones[2].etapa = 'gpu';
  mala[k].sin_gpu.estaciones.push(3);
  const errs = revisarRamas(mala);
  assert.ok(errs.some((x) => /etapa de la T/.test(x)) && errs.some((x) => /no corre solo en la Mac/.test(x)), errs.join('; '));
});

test('ramas.json: el entrenamiento RAG (C11) con 12 estaciones en la Mac, su mapa y su comparación', () => {
  const R = RAMAS.find((r) => r.id === 'rag');
  assert.ok(R, 'la rama rag existe');
  assert.equal(R.caso.codigo, 'C11');
  assert.equal(R.estaciones.length, 12);
  assert.ok(R.estaciones.every((s) => s.donde === 'mac'), 'todo el entrenamiento corre sin GPU rentada');
  assert.ok(R.compara && R.tramos, 'es un entrenamiento de la portada, con su mapa en anillo');
  // los errores que atrapa: un tramo que cruza de la fila de arriba a la de abajo y una fila de la comparación vacía
  const mala = JSON.parse(JSON.stringify(RAMAS));
  const r = mala.find((x) => x.id === 'rag');
  r.tramos[0] = [4, 7, 'Cruza', 'minutos'];
  r.compara.gate = '';
  const errs = revisarRamas(mala);
  assert.ok(errs.some((x) => /no cruzar de la 5 a la 6/.test(x)) && errs.some((x) => /compara\.gate: falta/.test(x)), errs.join('; '));
});

test('la etapa de la T: en el tronco sale del número; en una rama, de la estación', () => {
  assert.equal(etapaDe({ caso: 'c01', id: 'empaquetado', num: 7 }), 3);   // contenedor
  assert.equal(etapaDe({ rama: 'ia-privada', id: 'rag', num: 5 }), 0);     // datos, aunque la 5 del C01 sea modelo
  assert.equal(etapaDe({ rama: 'ia-privada', id: 'rag', num: 5, etapa: 'datos' }), 0);
  assert.equal(enSuLinea(deRama).url, '/ia-privada/rag/');
  assert.equal(enSuLinea(deRama).slug, 'ia-privada-rag');
  assert.deepEqual(cruzadasLinea(deRama), []);
  assert.match(cruzadasLinea({ ...deRama, num: 4 }).join(), /en su línea es la 5/);
  assert.match(cruzadasLinea({ ...deRama, rama: 'no-existe' }).join(), /no está en content\/ramas.json/);
});

test('el molde: caso o rama (uno de los dos), y c01 es el nombre viejo de ref', () => {
  for (const e of est) {
    assert.deepEqual([...molde(e, e.id), ...cruzadas(e)], [], `${e.id} sigue pasando el molde sin reescribirse`);
    const n = normalizar(JSON.parse(JSON.stringify(e)));
    for (const x of n.precalculos.cuentas) assert.deepEqual(x.ref, x.c01);
    for (const x of n.mapa.escala) assert.equal(x.ref, x.c01);
  }
  assert.deepEqual([...molde(deRama, 'rama'), ...cruzadas(deRama)], []);
  const ambas = { ...deRama, caso: 'c01' };
  assert.match(cruzadas(ambas).join(), /«caso» \(tronco\) o «rama»/);
  const sinEtapa = { ...deRama }; delete sinEtapa.etapa;
  assert.match(cruzadas(sinEtapa).join(), /lleva su «etapa»/);
  // con ref en lugar de c01 también pasa; con los dos, no
  const conRef = JSON.parse(JSON.stringify(deRama));
  conRef.precalculos.cuentas.forEach((x) => { x.ref = x.c01; delete x.c01; });
  assert.deepEqual(cruzadas(conRef), []);
  conRef.precalculos.cuentas[0].c01 = conRef.precalculos.cuentas[0].ref;
  assert.match(cruzadas(conRef).join(), /lleva «ref»/);
});

test('la plantilla agrupa por línea: el tronco primero y después cada rama', () => {
  assert.deepEqual(PR.grupos.map((g) => [g.id, g.tipo]), [['c01', 'tronco'], ...RAMAS.map((r) => [r.id, 'rama'])]);
  assert.deepEqual(PR.estaciones.map((e) => e.id), [...CON_TALLER, 'ia-privada-rag']);
  const rag = PR.estaciones.find((e) => e.id === 'ia-privada-rag');
  assert.equal(rag.grupo, 'ia-privada');
  assert.equal(rag.rama, 'IA Privada');
  assert.equal(rag.ref, 'estación 5 de IA Privada');
  assert.equal(rag.etapa, 'datos');
  assert.equal(rag.url, '/ia-privada/rag/');
  assert.equal(PR.estaciones.find((e) => e.id === 'c01-datos').ref, 'estación 1');
  assert.ok(!PR.proximas.some((s) => s.grupo === 'ia-privada' && s.num === 5), 'la 5 ya tiene taller');
  assert.equal(PR.proximas.length, PROXIMAS - 1);
});

test('un tablero del tronco C01 se migra a la plantilla con ramas sin perder nada', () => {
  // un tablero real de antes de las ramas: importaciones, rondas a mano, una nota y una falla anotadas en el tablero
  let d = nuevoTablero(P);
  ({ doc: d } = importar(d, PROGRESO));
  d = aplicar(d, opsEstado(d, 'c01-empaquetado', 'construir-con-ayuda', 'hecha', '2026-11-15T20:00:00Z')).project;
  d = aplicar(d, [{ op: 'insert', path: ['estaciones', '#c01-versionado', 'bitacora'], value: { id: 'b-mia', fecha: '2026-11-15T21:00:00Z', ronda: 'construir-solo', paso: '', hice: 'Manifest sin ayuda', medi: '', sigue: '', origen: 'tablero' } }]).project;
  d = aplicar(d, [{ op: 'insert', path: ['estaciones', '#c01-datos', 'fallas'], value: { id: 'f-mia', falla: 'zona-horaria', ronda: 'romper-solo', inicio: null, fin: '2026-11-16T10:00:00Z', minutos: 40, pistas: 0, rendido: false, aprendi: 'UTC', origen: 'tablero' } }]).project;
  assert.deepEqual(validar(d), []);
  const antes = JSON.parse(JSON.stringify(d));
  // así queda en localStorage: el texto JSON
  const leido = JSON.parse(JSON.stringify(d));

  const m = migrar(leido, PR);
  assert.deepEqual(validar(m), []);
  // todo lo del tronco, igual: cada estación (rondas con su hora, fallas, bitácora, verificaciones) y el historial
  for (const e of antes.estaciones) assert.deepEqual(de(m, e.id), e, `${e.id} quedó igual`);
  assert.deepEqual(m.importaciones, antes.importaciones);
  for (const k of ['id', 'rev', 'createdAt', 'updatedAt', 'lastActivity', 'app']) assert.equal(m[k], antes[k], k);
  // y entra la estación de la rama, vacía, al final
  assert.equal(m.estaciones.length, antes.estaciones.length + 1);
  assert.equal(m.estaciones.at(-1).id, 'ia-privada-rag');
  assert.deepEqual(m.estaciones.at(-1).rondas.map((r) => r.estado), ['pendiente', 'pendiente', 'pendiente', 'pendiente']);
  // migrar dos veces no cambia nada; un tablero sin la rama sigue leyéndose con la plantilla de antes
  assert.deepEqual(migrar(m, PR), m);
  assert.deepEqual(migrar(antes, P), antes);

  // el progreso.json de un kit de rama entra a su estación y no toca las del tronco
  const p = { estacion: 'ia-privada-rag', rondas: { guiado: { estado: 'en_curso', inicio: '2026-11-20T10:00:00-06:00' } }, bitacora: [] };
  const r = opsDeProgreso(m, p, PR);
  const { project } = aplicar(m, r.ops);
  assert.equal(de(project, 'ia-privada-rag').rondas[0].estado, 'en_curso');
  for (const e of antes.estaciones) assert.deepEqual(de(project, e.id), e);
  assert.throws(() => opsDeProgreso(m, p, P), /no tiene taller/, 'con la plantilla de antes, la rama no existe');
});

test('el almacén migra al leer: un tablero guardado antes de las ramas abre con la plantilla nueva', () => {
  const s = memoria();
  const a = crearAlmacen(P, s);
  a.cambiar(opsDeProgreso(a.leer(), PROGRESO, P).ops);
  const antes = a.leer();
  const b = crearAlmacen(PR, s).leer();
  assert.deepEqual(validar(b), []);
  for (const e of antes.estaciones) assert.deepEqual(de(b, e.id), e);
  assert.ok(de(b, 'ia-privada-rag'));
});
