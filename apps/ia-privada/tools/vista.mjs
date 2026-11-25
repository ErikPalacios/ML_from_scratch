#!/usr/bin/env node
// Capturas de las piezas visuales de una lección, para revisarlas con los ojos antes de darla por terminada.
//
//   node tools/vista.mjs <id-de-la-lección> [--solo-oscuro] [--solo-claro] [--anchos 375,780] [--filtro texto]
//
// Arma la lección con --solo, saca cada figura, diagrama, calculadora y cuenta a una página propia (con los mismos
// estilos y scripts) y toma una captura de cada una en claro y oscuro, a 375 px (celular) y 780 px (la columna de
// lectura). Deja los PNG en .solo/<id>/vistas/ e imprime sus rutas: ábrelos para ver si algo se encima, se corta o no
// se lee. Necesita Google Chrome (usa apps/ml-system-design/tools/browser-check.mjs).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BC = process.env.BROWSER_CHECK || join(ROOT, '..', 'ml-system-design', 'tools', 'browser-check.mjs');
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--') && !/^\d/.test(a) && args[args.indexOf(a) - 1] !== '--filtro');
if (!id) { console.error('uso: node tools/vista.mjs <id-de-la-lección> [--solo-oscuro|--solo-claro] [--anchos 375,780] [--filtro texto]'); process.exit(2); }
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const anchos = (opt('--anchos') || '375,780').split(',').map(Number);
const temas = args.includes('--solo-oscuro') ? ['oscuro'] : args.includes('--solo-claro') ? ['claro'] : ['claro', 'oscuro'];
const filtro = opt('--filtro');

execFileSync('node', [join(ROOT, 'tools', 'build.mjs'), '--solo', id], { stdio: 'inherit' });
const base = join(ROOT, '.solo', id);
const html = readFileSync(join(base, id, 'index.html'), 'utf8');
const piezas = [
  ...[...html.matchAll(/<figure class="c-figura" id="fig-([^"]+)">[\s\S]*?<\/figure>/g)].map((m) => ['figura', m[1], m[0]]),
  ...[...html.matchAll(/<div class="dg-mount" data-dg="([^"]+)"[\s\S]*?<\/figure>\n<\/div>/g)].map((m) => ['diagrama', m[1], m[0]]),
  ...[...html.matchAll(/<figure class="cx-calc" id="calc-([^"]+)"[\s\S]*?\n<\/figure>/g)].map((m) => ['calculadora', m[1], m[0]]),
  ...[...html.matchAll(/<figure class="calc">[\s\S]*?<\/figure>/g)].map((m, k) => ['cuenta', String(k + 1), m[0]]),
  ...[...html.matchAll(/<figure class="formula">[\s\S]*?<\/figure>/g)].map((m, k) => ['formula', String(k + 1), m[0]]),
].filter(([tipo, nombre]) => !filtro || nombre.includes(filtro) || tipo === filtro);
const datos = (html.match(/<script type="application\/json" id="g-datos">[\s\S]*?<\/script>/) || [''])[0];
const dir = join(base, 'vistas');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const salidas = [];
for (const [tipo, nombre, frag] of piezas) {
  const pagina = join(dir, `${tipo}-${nombre}.html`);
  writeFileSync(pagina, `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${pathToFileURL(join(base, 'sensei.css')).href}"><style>body{background:var(--surface)} .main{margin:0!important;border-radius:0!important;box-shadow:none!important;padding:16px!important}</style></head>
<body><main class="main"><div class="prose">${frag}</div></main>${datos}
<script src="${pathToFileURL(join(base, 'diagram.js')).href}"></script><script src="${pathToFileURL(join(base, 'app.js')).href}"></script></body></html>`);
  for (const ancho of anchos) for (const tema of temas) {
    const png = join(dir, `${tipo}-${nombre}-${ancho}-${tema}.png`);
    const r = spawnSync('node', [BC, '--url', pathToFileURL(pagina).href, '--width', String(ancho), '--height', '600', '--full', '--wait', '900', tema === 'oscuro' ? '--dark' : '--light', '--shot', png], { encoding: 'utf8' });
    if (r.status !== 0 && !existsSync(png)) { console.error(`[vista] no salió ${png}:\n${(r.stdout || '').slice(-300)}${(r.stderr || '').slice(-300)}`); continue; }
    salidas.push(png);
  }
}
console.log(`[vista] ${piezas.length} piezas · ${salidas.length} capturas en ${dir}`);
for (const p of salidas) console.log(p);
