// Los diagramas de flujo de las lecciones (content/diagramas/<id>.json), en HTML y CSS en lugar de SVG: el texto se
// acomoda solo, se lee igual de grande en el celular y respeta el tema. En pantallas angostas el flujo va de arriba
// abajo; cuando el espacio alcanza (container query en cimientos.css), va en filas de izquierda a derecha.
//
// Formato:
//   { "titulo": "lo que dice el diagrama, para lectores de pantalla",
//     "numerar": true,                       // un número en cada caja
//     "columnas": 3,                         // opcional: cajas por fila en pantallas anchas (por omisión: todas si son ≤ 4, si no la mitad)
//     "nodos": [ { "t": "Datos", "sub": "fotos con su categoría", "etapa": "datos", "tono": "fuera", "flecha": "entrenas" } ],
//     "regreso": "el texto de la flecha que vuelve al inicio" }
// «flecha» es la etiqueta de la flecha que sale de esa caja hacia la siguiente. «tono»: "fuera" (algo que no es del
// sistema, como la persona que usa la app) o "clave" (lo importante del diagrama). «etapa»: un id de etapas.json.
import { esc } from './md.mjs';

const ETAPAS = new Set(['datos', 'modelo', 'api', 'contenedor', 'orquestacion', 'monitoreo']);

export function validar(d, id) {
  const errs = [];
  if (typeof d.titulo !== 'string' || !d.titulo) errs.push('falta «titulo»');
  if (!Array.isArray(d.nodos) || d.nodos.length < 2) errs.push('«nodos» necesita al menos 2 cajas');
  (d.nodos || []).forEach((n, k) => {
    if (!n.t) errs.push(`nodo ${k + 1} sin «t»`);
    if (n.etapa && !ETAPAS.has(n.etapa)) errs.push(`nodo ${k + 1}: etapa «${n.etapa}» no existe`);
    if (n.tono && !['fuera', 'clave'].includes(n.tono)) errs.push(`nodo ${k + 1}: tono «${n.tono}» no existe`);
    if (n.flecha && k === d.nodos.length - 1) errs.push(`nodo ${k + 1}: el último no tiene flecha hacia otro (usa «regreso»)`);
  });
  if (d.columnas && !(d.columnas >= 2 && d.columnas <= 4)) errs.push('«columnas» va de 2 a 4');
  return errs.map((e) => `diagrama ${id}: ${e}`);
}

export function dibujar(d, pie, inline) {
  const n = d.nodos.length;
  const c = d.columnas || (n <= 4 ? n : Math.ceil(n / 2));
  const nodo = (x, k) => `<div class="fl-nodo${x.etapa ? ' fl-e-' + x.etapa : ''}${x.tono ? ' fl-' + x.tono : ''}">${
    d.numerar ? `<span class="fl-num">${k + 1}</span>` : ''}<b>${inline(x.t)}</b>${x.sub ? `<span>${inline(x.sub)}</span>` : ''}</div>`;
  // la flecha que salta de una fila a la siguiente trae <i>: en filas es el tramo que baja hacia la primera caja
  const flecha = (x, clase = '') => `<div class="fl-a${clase}"${x.flecha ? '' : ' aria-hidden="true"'}>${x.flecha ? `<span>${inline(x.flecha)}</span>` : ''}${clase ? '<i></i>' : ''}</div>`;
  const filas = [];
  for (let i = 0; i < n; i += c) filas.push(d.nodos.slice(i, i + c));
  const html = filas.map((fila, r) => {
    const celdas = fila.map((x, j) => nodo(x, r * c + j) + (j < fila.length - 1 ? flecha(x) : '')).join('');
    const ultimo = fila[fila.length - 1];
    const salto = r < filas.length - 1 ? flecha(ultimo, ' fl-salto') : '';
    return `<div class="fl-fila">${celdas}</div>${salto}`;
  }).join('');
  const regreso = d.regreso ? `<div class="fl-loop"><span class="fl-loop-i" aria-hidden="true">↺</span><span>${inline(d.regreso)}</span></div>` : '';
  return `<figure class="c-flujo fl-c${c}" style="--c1:${c - 1}" role="group" aria-label="${esc(d.titulo)}"><div class="fl">${html}${regreso}</div>${pie ? `<figcaption>${pie}</figcaption>` : ''}</figure>`;
}
