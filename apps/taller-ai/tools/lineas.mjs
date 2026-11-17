// Las líneas del Dojo: el tronco C01 (content/tronco.json) y sus ramas (content/ramas.json). Una estación pertenece
// a una línea por su `caso` (el tronco) o su `rama`; de la línea salen su URL (/<línea>/<estación>/), su etapa de la T,
// la etiqueta de su escala de referencia («En C01», «En el despacho») y cuántas estaciones tiene.
// Lo usan build.mjs, validate.mjs, check.mjs y test-tablero.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDS, RANGOS_C01 } from '../vendor/trueml/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (f) => JSON.parse(readFileSync(join(ROOT, 'content', f), 'utf8'));

export const TRONCO = leer('tronco.json');
export const RAMAS = leer('ramas.json').ramas;
// Las filas de «¿Cuál elijo?» en la portada: cada entrenamiento (el tronco y cada rama con `compara`) llena las mismas.
export const COMPARA = ['construyes', 'entrena', 'dificil', 'request', 'gate', 'corre'];
export const DONDE = { mac: 'Mac', gpu: 'GPU rentada', 'mac-gpu': 'Mac y GPU rentada' };

// En el tronco, la etapa sale del número con los rangos del C01; en una rama, cada estación la trae escrita.
const etapaC01 = (num) => RANGOS_C01.findIndex(([a, b]) => num >= a && num <= b);

/** Revisa content/ramas.json: ids, números seguidos, etapas de la T y dónde corre cada estación. Devuelve los errores. */
export function revisarRamas(ramas = RAMAS, tronco = TRONCO) {
  const errs = [];
  const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const ids = ramas.map((r) => r.id);
  ramas.forEach((r, k) => {
    const p = `ramas[${k}]`;
    if (!ID.test(r.id || '')) errs.push(`${p}.id: «${r.id}» no es un id`);
    if (r.id === tronco.caso || /^c\d\d$/.test(r.id)) errs.push(`${p}.id: «${r.id}» choca con los casos del tronco`);
    if (ids.indexOf(r.id) !== k) errs.push(`${p}.id: «${r.id}» repetido`);
    for (const c of ['nombre', 'patron', 'patron_txt', 'resumen', 'escala']) if (typeof r[c] !== 'string' || !r[c].trim()) errs.push(`${p}.${c}: falta`);
    if (!r.caso || !r.caso.nombre || !r.caso.resumen) errs.push(`${p}.caso: falta su nombre y su resumen`);
    if (!Array.isArray(r.estaciones) || !r.estaciones.length) { errs.push(`${p}.estaciones: falta la lista`); return; }
    r.estaciones.forEach((s, i) => {
      const q = `${p}.estaciones[${i}]`;
      if (s.num !== i + 1) errs.push(`${q}.num = ${s.num}; van numeradas 1, 2, 3…`);
      if (!ID.test(s.id || '')) errs.push(`${q}.id: «${s.id}» no es un id`);
      if (!s.titulo || !s.sale) errs.push(`${q}: le falta título o lo que sale`);
      if (!IDS.includes(s.etapa)) errs.push(`${q}.etapa: «${s.etapa}» no es una etapa de la T (${IDS.join(', ')})`);
      if (!DONDE[s.donde]) errs.push(`${q}.donde: «${s.donde}» no es uno de ${Object.keys(DONDE).join(', ')}`);
    });
    const sids = r.estaciones.map((s) => s.id);
    sids.forEach((x, i) => sids.indexOf(x) !== i && errs.push(`${p}: estación «${x}» repetida`));
    if (r.tramos) {
      if (r.estaciones.length !== 12) errs.push(`${p}.tramos: el mapa en anillo necesita 12 estaciones (hay ${r.estaciones.length})`);
      for (const t of r.tramos) if (!Array.isArray(t) || t.length !== 4 || !(t[0] <= t[1]) || (t[0] <= 5) !== (t[1] <= 5)) errs.push(`${p}.tramos: «${JSON.stringify(t)}» tiene que ser [desde, hasta, nombre, ritmo] y no cruzar de la 5 a la 6`);
    }
    if (r.compara) for (const c of COMPARA) if (typeof r.compara[c] !== 'string' || !r.compara[c].trim()) errs.push(`${p}.compara.${c}: falta`);
    if (r.sin_gpu) {
      for (const n of r.sin_gpu.estaciones || []) {
        const s = r.estaciones.find((x) => x.num === n);
        if (!s) errs.push(`${p}.sin_gpu: no hay estación ${n}`);
        else if (s.donde !== 'mac') errs.push(`${p}.sin_gpu: la estación ${n} no corre solo en la Mac (${s.donde})`);
      }
    }
  });
  return errs;
}

// Las líneas: id → { id, tipo, corto, nombre, escala, total, estaciones: [{ num, id, titulo, sale, etapa (índice), donde? }] }
export const LINEAS = new Map([
  [TRONCO.caso, { id: TRONCO.caso, tipo: 'tronco', corto: TRONCO.caso.toUpperCase(), nombre: TRONCO.caso.toUpperCase(), escala: TRONCO.escala, entrenamiento: TRONCO.entrenamiento || TRONCO.caso.toUpperCase(),
    total: TRONCO.estaciones.length, estaciones: TRONCO.estaciones.map((s) => ({ ...s, etapa: etapaC01(s.num) })) }],
  ...RAMAS.map((r) => [r.id, { id: r.id, tipo: 'rama', corto: r.nombre, nombre: `la rama ${r.nombre}`, escala: r.escala, entrenamiento: r.entrenamiento || r.nombre, rama: r,
    total: r.estaciones.length, estaciones: r.estaciones.map((s) => ({ ...s, etapa: IDS.indexOf(s.etapa) })) }]),
]);

/** La línea de una estación (por su `caso` o su `rama`), o null si no existe. */
export const lineaDe = (e) => LINEAS.get(e.rama || e.caso) || null;

/** La etapa de la T de una estación (índice 0–5): la que trae escrita o, en el tronco, la de su número. */
export function etapaDe(e) {
  if (e.etapa) return IDS.indexOf(e.etapa);
  const l = lineaDe(e), s = l && l.estaciones.find((x) => x.id === e.id);
  return s ? s.etapa : etapaC01(e.num);
}

/** Lo que cada estación necesita de su línea, puesto en la estación (después de validar el molde). */
export function enLinea(e) {
  const l = lineaDe(e);
  e.linea = l;
  e.slug = `${l.id}-${e.id}`;
  e.url = `/${l.id}/${e.id}/`;
  e.etapaIdx = etapaDe(e);
  return e;
}

/** Reglas entre la estación y su línea: que la línea exista, que la estación esté en ella con el mismo número. */
export function cruzadasLinea(e) {
  const l = lineaDe(e);
  if (!l) return [`${e.rama ? `la rama «${e.rama}» no está en content/ramas.json` : `el caso «${e.caso}» no es el del tronco (${TRONCO.caso})`}`];
  const s = l.estaciones.find((x) => x.id === e.id);
  if (!s) return [`la estación «${e.id}» no está en ${l.tipo === 'tronco' ? 'content/tronco.json' : `la rama ${l.corto} (content/ramas.json)`}`];
  const errs = [];
  if (s.num !== e.num) errs.push(`num = ${e.num}, pero en su línea es la ${s.num}`);
  if (e.etapa && IDS.indexOf(e.etapa) !== s.etapa) errs.push(`etapa «${e.etapa}», pero en su línea es «${IDS[s.etapa]}»`);
  return errs;
}
