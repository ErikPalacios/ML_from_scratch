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
const APPS = ['taller-ai', 'portada', 'sensei', 'ml-system-design', 'atlas-arquitecturas', 'transformer-lab', 'tablero-ml/web', 'cheat-sheets'];
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
// El avance de Sensei para la portada: qué lecciones del temario ya tienen su archivo (la portada lo pinta como el del Dojo).
const SENSEI = { carpeta: 'sensei', url: 'https://sensei-ml.vercel.app' };
{
  const c = join(APPS_DIR, SENSEI.carpeta, 'content');
  const temario = JSON.parse(readFileSync(join(c, 'temario.json'), 'utf8'));
  const hechas = new Set(readdirSync(join(c, 'lecciones')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
  const ls = temario.modulos.flatMap((m, k) => m.lecciones.map((l) => ({ id: l.id, titulo: l.titulo, modulo: `${k} · ${m.titulo}`, fase: m.fase,
    etapa: l.etapas === 'todas' ? 'todas' : l.etapas[0], lista: hechas.has(l.id), url: hechas.has(l.id) ? `${SENSEI.url}/${l.id}/` : null })));
  salidas.push([join(APPS_DIR, 'portada', 'data', 'sensei.json'), JSON.stringify({ nota: `Generado por apps/trueml/sync.mjs desde apps/${SENSEI.carpeta}/content. No se edita a mano.`, url: SENSEI.url, total: ls.length, lecciones: ls }, null, 2) + '\n']);
}

// La Ronda y el Dojo enlazan a su teoría en Sensei: solo lecciones que ya tienen su archivo.
//   Ronda: por módulo m01…m15, las lecciones que conviene repasar antes (sensei/content/ronda.json, campo lecciones),
//          como js/content/sensei.js (un script más, para que abra también con doble clic, file://).
//   Dojo:  por estación 1–12, la lección de la estación (temario.json, campo estacion) y sus requisitos (encabezado
//          requisitos: de su .md), como taller-ai/content/sensei.json.
{
  const c = join(APPS_DIR, SENSEI.carpeta, 'content');
  const temario = JSON.parse(readFileSync(join(c, 'temario.json'), 'utf8'));
  const existe = (id) => existsSync(join(c, 'lecciones', `${id}.md`));
  const titulos = new Map(temario.modulos.flatMap((m) => m.lecciones.map((l) => [l.id, l.titulo])));
  const leccion = (id) => ({ id, titulo: titulos.get(id), url: `${SENSEI.url}/${id}/` });
  const valida = (id, donde) => {
    if (!titulos.has(id)) throw new Error(`${donde}: la lección «${id}» no está en sensei/content/temario.json`);
    return existe(id);
  };
  const ronda = JSON.parse(readFileSync(join(c, 'ronda.json'), 'utf8'));
  const modulos = Object.fromEntries(ronda.modulos.map((m) => [m.id, m.lecciones.filter((id) => valida(id, `ronda.json ${m.id}`)).map(leccion)]));
  const datosRonda = { nota: `Generado por apps/trueml/sync.mjs desde apps/${SENSEI.carpeta}/content. No se edita a mano.`, url: SENSEI.url, modulos };
  salidas.push([join(APPS_DIR, 'ml-system-design', 'js', 'content', 'sensei.js'), `/* =============================================================================
   Ronda de Diseño ML — js/content/sensei.js
   ${datosRonda.nota}
   Por módulo, las lecciones de Sensei (el curso de teoría desde cero) que conviene repasar antes.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  MSD.sensei = ${JSON.stringify(datosRonda, null, 2).replace(/\n/g, '\n  ')};
})(typeof window !== 'undefined' ? window : globalThis);
`]);
  const requisitos = (id) => {
    const md = readFileSync(join(c, 'lecciones', `${id}.md`), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(md);
    const linea = fm && /^requisitos:\s*(.*)$/m.exec(fm[1]);
    return linea ? linea[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
  };
  const estaciones = temario.modulos.flatMap((m) => m.lecciones).filter((l) => l.estacion).sort((a, b) => a.estacion - b.estacion)
    .map((l) => existe(l.id) ? { num: l.estacion, leccion: leccion(l.id), requisitos: requisitos(l.id).filter((id) => valida(id, `${l.id}.md requisitos`)).map(leccion) } : null)
    .filter(Boolean);
  salidas.push([join(APPS_DIR, DOJO.carpeta, 'content', 'sensei.json'), JSON.stringify({ nota: datosRonda.nota, url: SENSEI.url, estaciones }, null, 2) + '\n']);
}

// Sensei dibuja sus diagramas con el mismo motor de la Ronda (carriles, recorridos, «por qué está aquí»):
// copia el motor y sus estilos tal cual, para que los dos se vean y se comporten igual.
for (const [de, a] of [['ml-system-design/js/ui/diagram.js', 'diagram.js'], ['ml-system-design/css/components.css', 'components.css']]) {
  salidas.push([join(APPS_DIR, 'sensei', 'vendor', 'ronda', a), readFileSync(join(APPS_DIR, de), 'utf8')]);
}
// Sensei enlaza cada lección de estación con su estación del Dojo, si ya está lista.
salidas.push([join(APPS_DIR, 'sensei', 'content', 'dojo.json'), JSON.stringify(dojo, null, 2) + '\n']);

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
