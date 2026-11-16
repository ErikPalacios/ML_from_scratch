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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const est = readdirSync(join(ROOT, 'content', 'estaciones')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'content', 'estaciones', f), 'utf8')));
const tronco = JSON.parse(readFileSync(join(ROOT, 'content', 'tronco.json'), 'utf8'));
const P = plantillaTablero(est.map((e) => ({ ...e, slug: `${e.caso}-${e.id}`, url: `/${e.caso}/${e.id}/`, kitUrl: `/${e.caso}/${e.id}/` })), tronco);

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
  assert.deepEqual(P.estaciones.map((e) => e.id), ['c01-datos', 'c01-empaquetado']);
  assert.equal(P.proximas.length, tronco.estaciones.length - 2);
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
  assert.throws(() => opsDeProgreso(d, { estacion: 'c01-serving' }, P), /no tiene taller/);
  assert.equal(queEs(PROGRESO), 'progreso');
  assert.equal(queEs({ app: 'dojo-tablero', tablero: d }), 'respaldo');
});

test('cambiar una ronda desde el tablero pone la hora de inicio y de fin', () => {
  let d = nuevoTablero(P);
  d = aplicar(d, opsEstado(d, 'c01-empaquetado', 'romper-solo', 'hecha', '2026-11-15T20:00:00Z')).project;
  const r = d.estaciones[1].rondas[3];
  assert.equal(r.estado, 'hecha');
  assert.equal(r.inicio, '2026-11-15T20:00:00Z');
  assert.equal(r.fin, '2026-11-15T20:00:00Z');
  d = aplicar(d, opsEstado(d, 'c01-empaquetado', 'romper-solo', 'pendiente')).project;
  assert.equal(d.estaciones[1].rondas[3].inicio, null);
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
  assert.equal(m.estaciones.length, 2);
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
  assert.equal(doc.estaciones[1].verificaciones.length, 2);
});
