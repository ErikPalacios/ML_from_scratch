/* «Tu tablero» del Dojo: el documento, su plantilla y la importación de taller/progreso.json.
   - Todo el progreso de la persona es UN solo JSON (el «tablero»), con fecha y hora ISO (UTC) en cada avance. Es el
     mismo documento que se va a sincronizar cuando haya cuentas: no hay que cambiar el formato.
   - Los cambios son ops del motor del tablero (motor/ops.mjs, copia de apps/tablero-ml): set, insert y remove por
     ruta, cada una validada por separado. Aquí está el esquema del Dojo que esas ops respetan (ESQUEMA).
   - migrar() corre al leer: suma las estaciones nuevas de la plantilla y las rondas que falten, así un tablero viejo
     sigue sirviendo cuando el Dojo crece.
   - opsDeProgreso() traduce el progreso.json de un kit a ops; importar el mismo archivo dos veces no duplica nada. */
import { checkShape, nowIso, LIMITS } from './motor/model.mjs';
import { applyOps } from './motor/ops.mjs';

export const VERSION = 1;
export const APP = 'dojo-tablero';

// Las cuatro rondas, siempre con su nombre completo. `kit` es la clave que usa progreso.json en el kit.
export const RONDAS = [
  { id: 'construir-con-ayuda', nombre: 'Construir con ayuda', kit: 'guiado', prompt: 'Guiado', hace: 'Construyes el proyecto con Claude Code, paso a paso.' },
  { id: 'construir-solo', nombre: 'Construir solo', kit: 'solo', prompt: 'Solo', hace: 'Lo rehaces desde el esqueleto, solo con los objetivos y verificar.py.' },
  { id: 'romper-con-ayuda', nombre: 'Romper con ayuda', kit: 'romper_ayuda', prompt: 'Romper con ayuda', hace: 'romper.py mete una falla y dice cuál; la diagnostican juntos.' },
  { id: 'romper-solo', nombre: 'Romper solo', kit: 'romper_solo', prompt: 'Romper solo', hace: 'romper.py esconde la falla; la encuentras y la arreglas tú.' },
];
export const RONDA_IDS = RONDAS.map((r) => r.id);
export const RONDA = Object.fromEntries(RONDAS.map((r) => [r.id, r]));
const DE_KIT = Object.fromEntries(RONDAS.map((r) => [r.kit, r.id]));
export const ESTADOS = ['pendiente', 'en_curso', 'hecha'];
export const ESTADO_TXT = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha' };
const ORDEN = { pendiente: 0, en_curso: 1, hecha: 2 };
const ROMPER = ['romper-con-ayuda', 'romper-solo'];

// ---------------------------------------------------------------- esquema (mismas reglas que el tablero)
const S = (max) => ['string', { max }];
const E = (values) => ['enum', { values }];
const ARR = (item, max) => ['array', { item, max }];
const NUL = (t) => [t[0], { ...t[1], nullable: true }];
const ISO = ['iso', {}];
const ID = ['id', {}];
const TXT = 4000;
const SH = {};
SH.ronda = { id: E(RONDA_IDS), estado: E(ESTADOS), inicio: NUL(ISO), fin: NUL(ISO), pistas: ['int', { min: 0, max: 999 }], actualizada: NUL(ISO) };
SH.entrada = { id: ID, fecha: ISO, ronda: E(RONDA_IDS), paso: S(LIMITS.idLen), hice: S(TXT), medi: S(TXT), sigue: S(TXT), origen: E(['kit', 'tablero']) };
SH.falla = {
  id: ID, falla: S(LIMITS.idLen), ronda: E(ROMPER), inicio: NUL(ISO), fin: NUL(ISO), minutos: ['num', { min: 0, max: 100000 }],
  pistas: ['int', { min: 0, max: 999 }], rendido: ['boolean', {}], aprendi: S(TXT), origen: E(['kit', 'tablero']),
};
SH.verificacion = { id: ID, fecha: ISO, pasan: ['array', { item: S(LIMITS.idLen), max: 60 }], fallan: ['array', { item: S(LIMITS.idLen), max: 60 }] };
SH.estacion = { id: ID, rondas: ARR(SH.ronda, 4), bitacora: ARR(SH.entrada, 1000), fallas: ARR(SH.falla, 300), verificaciones: ARR(SH.verificacion, 30) };
SH.importacion = { id: ID, fecha: ISO, estacion: S(LIMITS.idLen), nuevas: ['int', { min: 0, max: 100000 }], cambios: ['int', { min: 0, max: 100000 }] };
SH.tablero = {
  v: ['int', { min: 1, max: VERSION }], app: E([APP]), id: ID, rev: ['int', { min: 0, max: 1e12 }],
  createdAt: ISO, updatedAt: ISO, lastActivity: ISO,
  estaciones: ARR(SH.estacion, 80), importaciones: ARR(SH.importacion, 50),
};
const BYTES = 900000;

export function validar(doc) {
  const errors = [];
  checkShape(doc, SH.tablero, 'tablero', errors);
  if (!errors.length) {
    doc.estaciones.forEach((e, i) => {
      if (e.rondas.map((r) => r.id).join() !== RONDA_IDS.join()) errors.push(`tablero.estaciones[${i}].rondas: tienen que ser las cuatro, en orden`);
    });
    const bytes = JSON.stringify(doc).length;
    if (bytes > BYTES) errors.push(`tablero: ${bytes} bytes (máximo ${BYTES})`);
  }
  return errors.slice(0, 20);
}

// Completa lo que falte en un elemento nuevo (lo usa el motor al insertar).
function completar(tipo, x) {
  const base = {
    entrada: { fecha: nowIso(), ronda: 'construir-con-ayuda', paso: '', hice: '', medi: '', sigue: '', origen: 'tablero' },
    falla: { falla: '', ronda: 'romper-con-ayuda', inicio: null, fin: null, minutos: 0, pistas: 0, rendido: false, aprendi: '', origen: 'tablero' },
    verificacion: { fecha: nowIso(), pasan: [], fallan: [] },
    importacion: { fecha: nowIso(), estacion: '', nuevas: 0, cambios: 0 },
    estacion: { rondas: rondasVacias(), bitacora: [], fallas: [], verificaciones: [] },
  }[tipo] || {};
  return { id: x.id || nuevoId(tipo[0]), ...base, ...x };
}

export const ESQUEMA = {
  validate: validar,
  fillItem: completar,
  itemKind: { estaciones: 'estacion', bitacora: 'entrada', fallas: 'falla', verificaciones: 'verificacion', importaciones: 'importacion' },
  gate: () => null, // el gate de cálculos de entrada del modo producción no aplica al Dojo
};
export const aplicar = (doc, ops, now) => applyOps(doc, ops, { schema: ESQUEMA, now });

// ---------------------------------------------------------------- ids, fechas
export function nuevoId(p = 'x') {
  return `${p}-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 7)}`;
}
// Un id fijo a partir del contenido (FNV-1a): importar dos veces lo mismo da el mismo id y no se duplica.
export function idFijo(p, texto) {
  let h = 0x811c9dc5;
  for (const ch of String(texto)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${p}-${h.toString(36)}`;
}
// Cualquier fecha a ISO en UTC sin milisegundos («2026-11-03T16:15:00Z»). Una fecha sin hora («2026-11-03», como en
// los progreso.json de antes) queda a mediodía UTC: el mismo día del calendario en toda América y Europa.
export function aIso(x) {
  if (x === null || x === undefined || x === '') return null;
  const s = String(x).trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
const soloFecha = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.trim());

// ---------------------------------------------------------------- crear y migrar
export const rondasVacias = () => RONDAS.map((r) => ({ id: r.id, estado: 'pendiente', inicio: null, fin: null, pistas: 0, actualizada: null }));
const estacionVacia = (id) => ({ id, rondas: rondasVacias(), bitacora: [], fallas: [], verificaciones: [] });

// plantilla: { estaciones: [{ id, ... }] } con las estaciones que tienen taller (la arma el build).
export function nuevoTablero(plantilla) {
  const t = nowIso();
  return { v: VERSION, app: APP, id: 'tablero', rev: 0, createdAt: t, updatedAt: t, lastActivity: t, estaciones: plantilla.estaciones.map((e) => estacionVacia(e.id)), importaciones: [] };
}

// Al leer: el tablero de antes recibe lo que la plantilla tiene de nuevo (estaciones, rondas). Nunca borra nada tuyo.
export function migrar(doc, plantilla) {
  if (!doc || typeof doc !== 'object') return nuevoTablero(plantilla);
  const d = JSON.parse(JSON.stringify(doc));
  d.estaciones = Array.isArray(d.estaciones) ? d.estaciones : [];
  for (const e of plantilla.estaciones) if (!d.estaciones.some((x) => x.id === e.id)) d.estaciones.push(estacionVacia(e.id));
  for (const e of d.estaciones) {
    const tiene = new Map((e.rondas || []).map((r) => [r.id, r]));
    e.rondas = RONDAS.map((r) => ({ ...rondasVacias().find((x) => x.id === r.id), ...(tiene.get(r.id) || {}) }));
    for (const k of ['bitacora', 'fallas', 'verificaciones']) if (!Array.isArray(e[k])) e[k] = [];
  }
  if (!Array.isArray(d.importaciones)) d.importaciones = [];
  d.v = VERSION;
  return d;
}

// ---------------------------------------------------------------- importar progreso.json
// Devuelve { estacion, ops, nuevas, cambios, avisos } o lanza un Error con un mensaje para la persona.
export function opsDeProgreso(doc, p, plantilla, ahora = nowIso()) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('El archivo no es un progreso.json: tiene que ser un objeto JSON.');
  if (typeof p.estacion !== 'string') throw new Error('Al archivo le falta «estacion» (por ejemplo "c01-datos"). ¿Es el taller/progreso.json de un kit?');
  const tpl = plantilla.estaciones.find((x) => x.id === p.estacion);
  if (!tpl) throw new Error(`La estación «${p.estacion}» no tiene taller en este Dojo todavía.`);
  const est = doc.estaciones.find((x) => x.id === p.estacion);
  const base = ['estaciones', `#${p.estacion}`];
  const ops = [], avisos = [];
  let nuevas = 0, cambios = 0;
  const rondasKit = p.rondas && typeof p.rondas === 'object' ? p.rondas : {};
  const conocidas = new Set(Object.keys(rondasKit).filter((k) => DE_KIT[k]));
  for (const k of Object.keys(rondasKit)) if (!DE_KIT[k]) avisos.push(`ronda desconocida «${k}» (se ignoró)`);

  // 1. Las rondas: gana el estado más avanzado; el inicio más temprano; el fin, si quedó hecha.
  const nuevaRonda = new Map(est.rondas.map((r) => [r.id, { ...r }]));
  for (const k of conocidas) {
    const id = DE_KIT[k], r = rondasKit[k] || {}, cur = nuevaRonda.get(id);
    const estado = ESTADOS.includes(r.estado) ? r.estado : (r.estado === 'hecho' ? 'hecha' : null);
    if (r.estado !== undefined && !estado) avisos.push(`${RONDA[id].nombre}: estado «${r.estado}» desconocido`);
    if (estado && ORDEN[estado] > ORDEN[cur.estado]) cur.estado = estado;
    const ini = aIso(r.inicio);
    if (ini && (!cur.inicio || ini < cur.inicio)) cur.inicio = ini;
    const fin = aIso(r.fin);
    if (fin && cur.estado === 'hecha' && fin !== cur.fin) cur.fin = fin;
    if (Number.isInteger(r.pistas) && r.pistas >= 0 && r.pistas > cur.pistas) cur.pistas = Math.min(999, r.pistas);
  }

  // 2. Las fallas: las anota romper.py (inicio y fin reales); Claude agrega lo que aprendiste y las pistas.
  const fallasDoc = new Map(est.fallas.map((f) => [f.id, f]));
  for (const k of ['romper_ayuda', 'romper_solo']) {
    const lista = rondasKit[k] && Array.isArray(rondasKit[k].fallas) ? rondasKit[k].fallas : [];
    lista.forEach((f, i) => {
      if (!f || typeof f !== 'object' || typeof f.id !== 'string') { avisos.push(`${RONDA[DE_KIT[k]].nombre}: una falla sin «id» (se ignoró)`); return; }
      const ronda = DE_KIT[k];
      const inicio = aIso(f.inicio), fin = aIso(f.fin || f.fecha);
      const item = {
        id: idFijo('f', `${ronda}|${f.id}|${inicio || fin || i}`), falla: f.id.slice(0, LIMITS.idLen), ronda, inicio, fin,
        minutos: Number.isFinite(+f.minutos) && +f.minutos >= 0 ? Math.round(+f.minutos * 10) / 10 : 0,
        pistas: Number.isInteger(f.pistas) && f.pistas >= 0 ? Math.min(999, f.pistas) : 0,
        rendido: f.rendido === true, aprendi: String(f.aprendi || '').slice(0, TXT), origen: 'kit',
      };
      if (!tpl.fallas.some((x) => x.id === item.falla)) avisos.push(`falla «${item.falla}» no está en el catálogo de la estación`);
      const ya = fallasDoc.get(item.id);
      if (ya) { item.aprendi = item.aprendi || ya.aprendi; item.pistas = Math.max(item.pistas, ya.pistas); } // lo que anotaste aquí no se pierde
      if (!ya) { ops.push({ op: 'insert', path: [...base, 'fallas'], value: item }); nuevas++; fallasDoc.set(item.id, item); }
      else if (JSON.stringify({ ...ya, origen: 'kit' }) !== JSON.stringify(item)) { ops.push({ op: 'set', path: [...base, 'fallas', `#${item.id}`], value: item }); cambios++; }
      // una falla registrada quiere decir que la ronda ya empezó
      const cur = nuevaRonda.get(ronda);
      if (cur.estado === 'pendiente') cur.estado = 'en_curso';
      if (inicio && (!cur.inicio || inicio < cur.inicio)) cur.inicio = inicio;
    });
  }

  // 3. La bitácora: una entrada por fecha, ronda y paso. Si Claude la corrigió después, se actualiza.
  const bit = Array.isArray(p.bitacora) ? p.bitacora : [];
  const enDoc = new Map(est.bitacora.map((b) => [b.id, b]));
  bit.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const ronda = DE_KIT[b.ronda] || (RONDA_IDS.includes(b.ronda) ? b.ronda : null);
    const fecha = aIso(b.fecha);
    if (!ronda || !fecha) { avisos.push(`bitácora: la entrada ${i + 1} no tiene ronda o fecha válidas (se ignoró)`); return; }
    const paso = String(b.paso || '').slice(0, LIMITS.idLen);
    const item = { id: idFijo('b', `${fecha}|${ronda}|${paso}${soloFecha(b.fecha) ? '|' + (b.hice || '') : ''}`), fecha, ronda, paso,
      hice: String(b.hice || '').slice(0, TXT), medi: String(b.medi || '').slice(0, TXT), sigue: String(b.sigue || '').slice(0, TXT), origen: 'kit' };
    const ya = enDoc.get(item.id);
    if (!ya) { ops.push({ op: 'insert', path: [...base, 'bitacora'], value: item }); nuevas++; enDoc.set(item.id, item); }
    else if (JSON.stringify(ya) !== JSON.stringify(item)) { ops.push({ op: 'set', path: [...base, 'bitacora', `#${item.id}`], value: item }); cambios++; }
    const cur = nuevaRonda.get(ronda);
    if (cur.estado === 'pendiente') cur.estado = 'en_curso';
    if (!cur.inicio || fecha < cur.inicio) cur.inicio = fecha;
  });

  // 4. Las corridas de verificar.py (las anota el kit): el último resultado de cada check.
  const ver = Array.isArray(p.verificaciones) ? p.verificaciones : [];
  const vistas = new Map(est.verificaciones.map((v) => [v.id, v]));
  const nuevasV = [];
  for (const v of ver) {
    const fecha = v && aIso(v.fecha);
    if (!fecha) continue;
    const limpia = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === 'string').map((x) => x.slice(0, LIMITS.idLen)).slice(0, 60) : []);
    const pasan = limpia(v.pasan), fallan = limpia(v.fallan);
    // dos corridas pueden caer en el mismo segundo (verificar.py deps y luego verificar.py contexto): el id lleva el resultado
    const item = { id: idFijo('v', `${fecha}|${pasan.join(',')}|${fallan.join(',')}`), fecha, pasan, fallan };
    if (!vistas.has(item.id)) { vistas.set(item.id, item); nuevasV.push(item); }
  }
  if (nuevasV.length) {
    // se quedan las 30 más nuevas
    const todas = [...vistas.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).slice(-30);
    ops.push({ op: 'set', path: [...base, 'verificaciones'], value: todas });
    nuevas += nuevasV.filter((v) => todas.includes(v)).length;
    // verificar.py corrió: la primera ronda ya empezó
    const cur = nuevaRonda.get('construir-con-ayuda');
    if (cur.estado === 'pendiente') { cur.estado = 'en_curso'; if (!cur.inicio) cur.inicio = todas[0].fecha; }
  }

  // las rondas al final, con lo que sumaron las fallas, la bitácora y las verificaciones
  for (const r of est.rondas) {
    const n = nuevaRonda.get(r.id);
    if (JSON.stringify(n) !== JSON.stringify(r)) {
      ops.push({ op: 'set', path: [...base, 'rondas', `#${r.id}`], value: { ...n, actualizada: ahora } });
      cambios++;
    }
  }
  if (ops.length) {
    // el historial guarda las 50 más nuevas: la más vieja sale para que entre esta
    doc.importaciones.slice(49).forEach((i) => ops.push({ op: 'remove', path: ['importaciones', `#${i.id}`] }));
    ops.push({ op: 'insert', path: ['importaciones'], value: { id: nuevoId('i'), fecha: ahora, estacion: p.estacion, nuevas, cambios }, index: 0 });
  }
  return { estacion: p.estacion, ops, nuevas, cambios, avisos };
}

// Un JSON pegado o subido: ¿es un progreso.json de un kit o un respaldo completo del tablero?
export function queEs(x) {
  if (x && x.app === APP && x.tablero) return 'respaldo';
  if (x && x.app === APP && Array.isArray(x.estaciones)) return 'tablero';
  if (x && typeof x.estacion === 'string') return 'progreso';
  return null;
}

// ---------------------------------------------------------------- lecturas para la vista
export function resumenEstacion(e) {
  const hechas = e.rondas.filter((r) => r.estado === 'hecha').length;
  // el último avance de verdad (no la hora en que importaste): inicio y fin de rondas, notas, fallas y verificaciones
  const ultima = [...e.rondas.flatMap((r) => [r.inicio, r.fin]), ...e.verificaciones.map((v) => v.fecha), ...e.bitacora.map((b) => b.fecha), ...e.fallas.map((f) => f.fin || f.inicio)]
    .filter(Boolean).sort().pop() || null;
  return { hechas, enCurso: e.rondas.filter((r) => r.estado === 'en_curso').length, fallas: e.fallas.length,
    arregladas: e.fallas.filter((f) => !f.rendido).length, entradas: e.bitacora.length, ultima,
    verificacion: e.verificaciones.length ? e.verificaciones[e.verificaciones.length - 1] : null };
}

// Cambiar el estado de una ronda desde el tablero: la hora de inicio y de fin se ponen solas.
export function opsEstado(doc, estacion, ronda, estado, ahora = nowIso()) {
  const e = doc.estaciones.find((x) => x.id === estacion);
  const r = e && e.rondas.find((x) => x.id === ronda);
  if (!r || !ESTADOS.includes(estado)) return [];
  const n = { ...r, estado, actualizada: ahora };
  if (estado !== 'pendiente' && !n.inicio) n.inicio = ahora;
  if (estado === 'hecha') n.fin = n.fin && r.estado === 'hecha' ? n.fin : ahora;
  if (estado !== 'hecha') n.fin = null;
  if (estado === 'pendiente') n.inicio = null;
  return [{ op: 'set', path: ['estaciones', `#${estacion}`, 'rondas', `#${ronda}`], value: n }];
}
