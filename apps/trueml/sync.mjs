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
const ARCHIVOS = ['trueml-mark.js', 'lib.mjs', 'etapas.json', 'tokens.css', 'cliente.js', 'codigo.js', 'piezas.js', 'piezas.css', 'mudanza.js', 'mudanza.html'];
// La carpeta de cada app que se despliega (el tablero copia su web/ entera, también al demo).
const APPS = ['taller-ai', 'portada', 'sensei', 'ml-system-design', 'atlas-arquitecturas', 'transformer-lab', 'tablero-ml/web', 'cheat-sheets', 'ia-privada'];
const DOJO = { carpeta: 'taller-ai', url: 'https://dojo.trueml.app' };
const check = process.argv.includes('--check');

// El enlace de donación vive en lib.mjs (builds) y en piezas.js (apps sin build): tienen que ser el mismo.
const urlDe = (f, re) => (readFileSync(join(AQUI, f), 'utf8').match(re) || [])[1];
const donarLib = urlDe('lib.mjs', /DONAR_URL = '([^']+)'/), donarPiezas = urlDe('piezas.js', /DONAR_URL = '([^']+)'/);
if (!donarLib || donarLib !== donarPiezas) { console.error(`✗ DONAR_URL distinta: lib.mjs ${donarLib} · piezas.js ${donarPiezas}`); process.exit(1); }

const salidas = [];   // [ruta, contenido]
for (const app of APPS) for (const f of ARCHIVOS) salidas.push([join(APPS_DIR, app, 'vendor', 'trueml', f), readFileSync(join(AQUI, f), 'utf8')]);

// El avance del Dojo para la portada: qué estaciones del tronco C01 y de cada rama ya tienen su página.
// Una estación es de una línea por su `caso` (el tronco) o su `rama` (content/ramas.json); su página es /<línea>/<id>/.
// En el tronco la etapa de la T sale del número; en una rama, cada estación la trae escrita.
const contenido = join(APPS_DIR, DOJO.carpeta, 'content');
const tronco = JSON.parse(readFileSync(join(contenido, 'tronco.json'), 'utf8'));
const ramas = JSON.parse(readFileSync(join(contenido, 'ramas.json'), 'utf8')).ramas;
const conPagina = readdirSync(join(contenido, 'estaciones')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(contenido, 'estaciones', f), 'utf8')));
const listasDe = (linea) => new Set(conPagina.filter((e) => (e.rama || e.caso) === linea).map((e) => e.id));
const listas = listasDe(tronco.caso);
const { etapaDeEstacion } = await import('./lib.mjs');
const estacionesDe = (linea, ests, etapa) => {
  const ls = listasDe(linea);
  return ests.map((s) => ({ num: s.num, id: s.id, titulo: s.titulo, etapa: etapa(s),
    lista: ls.has(s.id), url: ls.has(s.id) ? `${DOJO.url}/${linea}/${s.id}/` : null }));
};
const dojo = {
  nota: `Generado por apps/trueml/sync.mjs desde apps/${DOJO.carpeta}/content. No se edita a mano.`,
  url: DOJO.url, caso: tronco.caso, total: tronco.estaciones.length,
  estaciones: estacionesDe(tronco.caso, tronco.estaciones, (s) => etapaDeEstacion(s.num)),
  ramas: ramas.map((r) => ({ id: r.id, nombre: r.nombre, patron: r.patron_txt, url: `${DOJO.url}/${r.id}/`, total: r.estaciones.length,
    estaciones: estacionesDe(r.id, r.estaciones, (s) => s.etapa) })),
};
salidas.push([join(APPS_DIR, 'portada', 'data', 'dojo.json'), JSON.stringify(dojo, null, 2) + '\n']);
// El avance de Sensei para la portada: qué lecciones del temario ya tienen su archivo (la portada lo pinta como el del Dojo).
const SENSEI = { carpeta: 'sensei', url: 'https://sensei.trueml.app' };
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
//   Dojo:  por estación 1–12 del tronco, la lección de la estación (temario.json, campo estacion) y sus requisitos
//          (encabezado requisitos: de su .md), como taller-ai/content/sensei.json. Cada una lleva su línea (el caso
//          del tronco): el Dojo las busca por línea y número, así una rama no choca con la estación 1 del C01.
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
    .map((l) => existe(l.id) ? { linea: tronco.caso, num: l.estacion, leccion: leccion(l.id), requisitos: requisitos(l.id).filter((id) => valida(id, `${l.id}.md requisitos`)).map(leccion) } : null)
    .filter(Boolean);
  salidas.push([join(APPS_DIR, DOJO.carpeta, 'content', 'sensei.json'), JSON.stringify({ nota: datosRonda.nota, url: SENSEI.url, estaciones }, null, 2) + '\n']);
}

// Sensei dibuja sus diagramas con el mismo motor de la Ronda (carriles, recorridos, «por qué está aquí»):
// copia el motor y sus estilos tal cual, para que los dos se vean y se comporten igual.
for (const [de, a] of [['ml-system-design/js/ui/diagram.js', 'diagram.js'], ['ml-system-design/css/components.css', 'components.css']]) {
  salidas.push([join(APPS_DIR, 'sensei', 'vendor', 'ronda', a), readFileSync(join(APPS_DIR, de), 'utf8')]);
}
// Sensei enlaza cada lección de estación con su estación del Dojo, si ya está lista.
// El avance de IA Privada para la portada: igual que el de Sensei, desde su temario y sus archivos de lección.
{
  const IAP = { carpeta: 'ia-privada', url: 'https://ia.trueml.app' };
  const c = join(APPS_DIR, IAP.carpeta, 'content');
  const temario = JSON.parse(readFileSync(join(c, 'temario.json'), 'utf8'));
  const hechas = new Set(readdirSync(join(c, 'lecciones')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));
  const ls = temario.modulos.flatMap((m, k) => m.lecciones.map((l) => ({ id: l.id, titulo: l.titulo, modulo: `${k} · ${m.titulo}`, fase: m.fase,
    etapa: l.etapas === 'todas' ? 'todas' : l.etapas[0], lista: hechas.has(l.id), url: hechas.has(l.id) ? `${IAP.url}/${l.id}/` : null })));
  salidas.push([join(APPS_DIR, 'portada', 'data', 'ia-privada.json'), JSON.stringify({ nota: `Generado por apps/trueml/sync.mjs desde apps/${IAP.carpeta}/content. No se edita a mano.`, url: IAP.url, total: ls.length, lecciones: ls }, null, 2) + '\n']);
}
salidas.push([join(APPS_DIR, 'sensei', 'content', 'dojo.json'), JSON.stringify(dojo, null, 2) + '\n']);

// IA Privada: usa el mismo motor de diagramas, lee las especificaciones de GPUs de Sensei y sus servidores con precio (la única
// fuente: gpus.json y equipos.json se copian tal cual, nunca a mano), enlaza las lecciones de Sensei que da por leídas y pinta su rama del Dojo.
{
  const IAP = 'ia-privada', gen = `Generado por apps/trueml/sync.mjs. No se edita a mano.`;
  for (const a of ['diagram.js', 'components.css']) salidas.push([join(APPS_DIR, IAP, 'vendor', 'ronda', a), readFileSync(join(APPS_DIR, 'sensei', 'vendor', 'ronda', a), 'utf8')]);
  for (const a of ['gpus.json', 'equipos.json']) salidas.push([join(APPS_DIR, IAP, 'content', 'datos', a), readFileSync(join(APPS_DIR, SENSEI.carpeta, 'content', 'datos', a), 'utf8')]);
  const c = join(APPS_DIR, SENSEI.carpeta, 'content');
  const temario = JSON.parse(readFileSync(join(c, 'temario.json'), 'utf8'));
  const lecciones = Object.fromEntries(temario.modulos.flatMap((m) => m.lecciones).map((l) => [l.id, { titulo: l.titulo,
    url: existsSync(join(c, 'lecciones', `${l.id}.md`)) ? `${SENSEI.url}/${l.id}/` : null }]));
  salidas.push([join(APPS_DIR, IAP, 'content', 'datos', 'sensei.json'), JSON.stringify({ nota: `${gen} Fuente: apps/${SENSEI.carpeta}/content/temario.json.`, url: SENSEI.url, lecciones }, null, 2) + '\n']);
  const rama = ramas.find((r) => r.id === IAP);
  if (!rama) throw new Error(`taller-ai/content/ramas.json no tiene la rama «${IAP}»`);
  const ls = listasDe(IAP);
  salidas.push([join(APPS_DIR, IAP, 'content', 'dojo.json'), JSON.stringify({ nota: `${gen} Fuente: apps/${DOJO.carpeta}/content/ramas.json.`, url: `${DOJO.url}/${IAP}/`,
    nombre: rama.nombre, resumen: rama.resumen, caso: rama.caso, sin_gpu: rama.sin_gpu,
    estaciones: rama.estaciones.map((s) => ({ ...s, lista: ls.has(s.id), url: ls.has(s.id) ? `${DOJO.url}/${IAP}/${s.id}/` : null })) }, null, 2) + '\n']);
}

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
console.log(check ? '✓ TrueML al día en todas las apps' : `✓ sync listo · ${APPS.length} apps · Dojo: ${[...listas].length} de ${dojo.total} estaciones del tronco · ${dojo.ramas.map((r) => `${r.nombre} ${r.estaciones.filter((s) => s.lista).length}/${r.total}`).join(' · ')}`);
