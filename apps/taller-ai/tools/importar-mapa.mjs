// Copia el mapa del C01 de la cheat sheet «Del dato a producción» a content/mapa-c01.json.
// Se corre a mano cuando cambia la hoja (node tools/importar-mapa.mjs); el build lee solo el JSON,
// así que el Dojo se despliega sin depender de otras carpetas.
//
// Toma las dos figuras ya dibujadas (la del anillo, para tablet y escritorio, y la vertical, para celular)
// y los íconos que usan. Los enlaces #est-<id> se quedan así: el build decide a dónde apunta cada estación.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOJA = join(ROOT, '..', 'cheat-sheets', 'sheets', 'recorrido', 'recorrido.html');
const html = readFileSync(HOJA, 'utf8');

function svg(clase) {
  const i = html.indexOf(`<svg class="mapsvg ${clase}"`);
  if (i < 0) throw new Error(`no encontré la figura «${clase}» en ${HOJA}`);
  return html.slice(i, html.indexOf('</svg>', i) + 6);
}
const map2d = svg('map2d');
const mapv = svg('mapv');

const usados = [...new Set([...(map2d + mapv).matchAll(/href="#(i-[a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
const simbolos = usados.map((id) => {
  const i = html.indexOf(`<symbol id="${id}"`);
  if (i < 0) throw new Error(`falta el ícono ${id} en la hoja`);
  return html.slice(i, html.indexOf('</symbol>', i) + 9);
});

const estaciones = [...new Set([...map2d.matchAll(/href="#est-([a-z]+)"/g)].map((m) => m[1]))];
if (estaciones.length !== 12) throw new Error(`el mapa trae ${estaciones.length} estaciones; se esperaban 12`);

const out = { fuente: relative(ROOT, HOJA), estaciones, map2d, mapv, simbolos: simbolos.join('') };
writeFileSync(join(ROOT, 'content', 'mapa-c01.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`mapa-c01.json: 2 figuras, ${usados.length} íconos, ${estaciones.length} estaciones`);
