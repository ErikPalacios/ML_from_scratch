// TrueML · las piezas de la marca para los builds (Node, sin dependencias).
// La T de vidrio sale de trueml-mark.js, el generador del diseño, y se dibuja al construir: la página no
// necesita JavaScript para verse y abre sin conexión. Cada app usa su copia en vendor/trueml/ (sync.mjs).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(AQUI, 'trueml-mark.js'), 'utf8'), ctx);
const TM = ctx.window.TrueMLMark;
// El formato de los bloques de código (codigo.js, el mismo que corre en el navegador).
const ctxCodigo = {};
vm.runInNewContext(readFileSync(join(AQUI, 'codigo.js'), 'utf8'), ctxCodigo);
const CODIGO = ctxCodigo.TrueMLCodigo;
/** Código resaltado como HTML (ya escapado). lang: python, bash, json, yaml, docker, js, sql, toml; si no se reconoce, texto sin color. */
export const resaltar = (codigo, lang) => CODIGO.resaltar(codigo, lang);
/** El bloque de código estándar de TrueML: {codigo, lang, titulo, id, salida}. `salida: true` lo pinta como la salida real de un comando. */
export const bloqueCodigo = (o) => CODIGO.bloque(o);

const DATOS = JSON.parse(readFileSync(join(AQUI, 'etapas.json'), 'utf8'));
export const ETAPAS = DATOS.etapas;
export const IDS = ETAPAS.map((e) => e.id);
const NOMBRE = Object.fromEntries(ETAPAS.map((e) => [e.id, e.nombre]));
/** El generador del diseño, tal cual (window.TrueMLMark de trueml-mark.js), para quien necesite llamarlo directo. */
export const TrueMLMark = TM;
/** Las estaciones del C01 de cada etapa, en el orden de la T: [[1, 2], [3, 5], …]. */
export const RANGOS_C01 = IDS.map((id) => DATOS.estaciones_c01[id]);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** La etapa de la T a la que pertenece una estación del C01 (1–12). */
export function etapaDeEstacion(num) {
  const e = Object.entries(DATOS.estaciones_c01).find(([, [a, b]]) => num >= a && num <= b);
  if (!e) throw new Error(`la estación ${num} no está en etapas.json`);
  return e[0];
}

/** Las etapas de una herramienta: "todas" o una lista de ids. Falla si un id no existe (atrapa typos en los datos). */
export function etapas(lista) {
  if (lista === 'todas') return [...IDS];
  const malos = lista.filter((x) => !IDS.includes(x));
  if (malos.length) throw new Error(`etapas desconocidas: ${malos.join(', ')}. Hay: ${IDS.join(', ')}`);
  return IDS.filter((x) => lista.includes(x));
}

/** «las seis etapas», «Modelo», «Datos y Modelo», «API, Contenedor, Orquestación y Monitoreo». */
export function resumen(lista, { mayus = false } = {}) {
  const l = etapas(lista);
  if (l.length === IDS.length) return mayus ? 'Las seis etapas' : 'las seis etapas';
  const n = l.map((x) => NOMBRE[x]);
  return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}`;
}

/**
 * La T de vidrio como SVG.
 *   etiquetas: null (sin texto) · true (nombre y tecnología de cada etapa) · [[nombre, sub] | null, …] (6, propias)
 *   encender:  ids de las etapas que quedan encendidas; las demás se apagan a `dim` (null = todas encendidas)
 *   maxAltura: tope CSS de la altura (p. ej. '460px')
 */
export function marca({ etiquetas = null, encender = null, dim = 0.16, maxAltura, clave = '' } = {}) {
  const svg = TM.mark(true, etiquetas === true ? 1 : etiquetas, clave, maxAltura);
  if (!encender) return svg;
  const on = new Set(etapas(encender));
  return svg.replace(/<g data-stage="([a-z]+)" data-dim="([.\d]+)"( data-kind="label")?>/g, (m, s, d, lb) =>
    on.has(s) ? m : `<g data-stage="${s}" data-dim="${d}"${lb || ''} style="opacity:${lb ? d : dim}">`);
}

/** La T chica de 6 cuadritos (como en el logo): la barra de arriba y el tronco, con las etapas encendidas en color. */
export function miniT(lista, { etiqueta = true } = {}) {
  const on = new Set(etapas(lista));
  const celda = (id) => `<i class="tm-mini-${id}${on.has(id) ? '' : ' tm-off'}"></i>`;
  // fila 1: contenedor · orquestación · monitoreo; luego el tronco de arriba abajo: API, modelo, datos
  const t = `<span class="tm-mini" role="img" aria-label="${esc('Etapas: ' + resumen(lista))}">${['contenedor', 'orquestacion', 'monitoreo', 'api', 'modelo', 'datos'].map(celda).join('')}</span>`;
  return etiqueta ? `<span class="tm-mini-wrap"><span class="tm-mini-txt">${esc(resumen(lista, { mayus: true }))}</span>${t}</span>` : t;
}

/** La franja de 6 colores. */
export const franja = (clase = 'tm-stripe') => `<div class="${clase}" aria-hidden="true">${IDS.map((id) => `<span class="tm-c-${id}"></span>`).join('')}</div>`;

/** El selector de tema: Claro / Oscuro / Auto (lo maneja cliente.js o el script de la app). */
export const selectorTema = (clase = '') => `<div class="tema tm-tema ${clase}" role="group" aria-label="Tema">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Auto']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false">${l}</button>`).join('')}</div>`;

// ---------------------------------------------------------------- donar
// El enlace de donación de todas las apps. La misma URL vive en piezas.js (para las apps sin build); sync.mjs revisa que coincidan.
export const DONAR_URL = 'https://ko-fi.com/trueml';
const TAZA = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.5h8.5v3.5a3 3 0 0 1-3 3h-2.5a3 3 0 0 1-3-3z"/><path d="M11 7.5h1a1.9 1.9 0 0 1 0 3.8h-1.2"/><path d="M5.5 2.5v1.8M8.5 2.5v1.8"/></svg>';
export const donar = ({ texto = 'Invítame un café', clase = '' } = {}) =>
  `<a class="tm-donar${clase ? ' ' + clase : ''}" href="${DONAR_URL}" target="_blank" rel="noopener">${TAZA}<span>${esc(texto)}</span></a>`;
