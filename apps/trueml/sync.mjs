#!/usr/bin/env node
// Copia el sistema de diseño TrueML a cada app que lo usa (apps/<app>/vendor/trueml/) y genera los datos que una
// app toma de otra. Cada app se despliega sola desde su carpeta en Vercel, así que lleva su copia; esta es la fuente.
//
//   node apps/trueml/sync.mjs           copia y regenera
//   node apps/trueml/sync.mjs --check   solo revisa que todo esté al día (sale con 1 si algo se desfasó)
//
// Para sumar una app: agrégala a APPS. Para compartir un archivo nuevo: agrégalo a ARCHIVOS.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APPS_DIR = join(AQUI, '..');
const ARCHIVOS = ['trueml-mark.js', 'lib.mjs', 'etapas.json', 'tokens.css', 'cliente.js'];
// La carpeta de cada app que se despliega (el tablero copia su web/ entera, también al demo).
const APPS = ['taller-ai', 'portada', 'ml-system-design', 'atlas-arquitecturas', 'transformer-lab', 'tablero-ml/web', 'cheat-sheets'];
const DOJO = { carpeta: 'taller-ai', url: 'https://taller-ai-engineer.vercel.app' };
const check = process.argv.includes('--check');

const salidas = [];   // [ruta, contenido]
for (const app of APPS) for (const f of ARCHIVOS) salidas.push([join(APPS_DIR, app, 'vendor', 'trueml', f), readFileSync(join(AQUI, f), 'utf8')]);

// El avance del Dojo para la portada: qué estaciones del C01 ya tienen su página.
const contenido = join(APPS_DIR, DOJO.carpeta, 'content');
const tronco = JSON.parse(readFileSync(join(contenido, 'tronco.json'), 'utf8'));
const listas = new Set(readdirSync(join(contenido, 'estaciones')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(contenido, 'estaciones', f), 'utf8'))).filter((e) => e.caso === tronco.caso).map((e) => e.id));
const { etapaDeEstacion } = await import('./lib.mjs');
const dojo = {
  nota: `Generado por apps/trueml/sync.mjs desde apps/${DOJO.carpeta}/content. No se edita a mano.`,
  url: DOJO.url, caso: tronco.caso, total: tronco.estaciones.length,
  estaciones: tronco.estaciones.map((s) => ({ num: s.num, id: s.id, titulo: s.titulo, etapa: etapaDeEstacion(s.num),
    lista: listas.has(s.id), url: listas.has(s.id) ? `${DOJO.url}/${tronco.caso}/${s.id}/` : null })),
};
salidas.push([join(APPS_DIR, 'portada', 'data', 'dojo.json'), JSON.stringify(dojo, null, 2) + '\n']);

let malos = 0;
for (const [ruta, texto] of salidas) {
  const igual = existsSync(ruta) && readFileSync(ruta, 'utf8') === texto;
  if (igual) continue;
  if (check) { console.error(`✗ desfasado: ${relative(APPS_DIR, ruta)}`); malos++; continue; }
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
  console.log(`  escrito ${relative(APPS_DIR, ruta)}`);
}
if (check && malos) { console.error(`\n${malos} archivo(s) desfasados: corre node apps/trueml/sync.mjs`); process.exit(1); }
console.log(check ? '✓ TrueML al día en todas las apps' : `✓ sync listo · ${APPS.length} apps · Dojo: ${[...listas].length} de ${dojo.total} estaciones`);
