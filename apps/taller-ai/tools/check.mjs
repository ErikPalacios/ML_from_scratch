#!/usr/bin/env node
// Revisa dist/ en Chrome headless (con tools/browser-check.mjs de la app ml-system-design):
//   1. ninguna página se sale de ancho en celular (375), tablet (768 y 1024) ni en modo oscuro,
//      tampoco con todas las tarjetas, salidas, prompts y el catálogo de fallas abiertos;
//   2. el selector de tema funciona y se recuerda;
//   3. el service worker se instala, guarda todas las páginas y las sirve sin conexión;
//   4. «Tu tablero»: las pruebas del modelo (tools/test-tablero.mjs), que la copia del motor del tablero esté al día
//      y, en Chrome, que importar un progreso.json marque las rondas y no se salga de ancho con todo abierto.
// Sirve dist/ con un servidor local que imita a Vercel (trailingSlash) y que puede "cortar la red".
// Uso: npm run check   (arma dist/ y después corre esto)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { revisarMotor } from './motor.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BC = join(ROOT, '..', 'ml-system-design', 'tools', 'browser-check.mjs');
if (!existsSync(join(DIST, 'index.html'))) { console.error('[check] falta dist/: corre antes node tools/build.mjs'); process.exit(1); }
const ESTACIONES = readdirSync(join(ROOT, 'content', 'estaciones')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'content', 'estaciones', f), 'utf8')));
// /<línea>/<estación>/: la línea es el caso del tronco (c01) o la rama (tools/lineas.mjs)
// la portada, la página de cada entrenamiento (/c01/ y una por rama) y las de cada estación
const LINEAS_PAG = [`/${JSON.parse(readFileSync(join(ROOT, 'content', 'tronco.json'), 'utf8')).caso}/`, ...JSON.parse(readFileSync(join(ROOT, 'content', 'ramas.json'), 'utf8')).ramas.map((r) => `/${r.id}/`)];
const PAGES = ['/', ...LINEAS_PAG, ...ESTACIONES.flatMap((e) => { const L = e.rama || e.caso; return [`/${L}/${e.id}/`, ...(e.practicas?.length ? [`/${L}/${e.id}/proyecto-con-kit/`] : []),
  ...(e.practicas || []).map((rel) => `/${L}/${e.id}/${JSON.parse(readFileSync(join(ROOT, rel), 'utf8')).id}/`)]; }), '/tablero/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.zip': 'application/zip', '.webmanifest': 'application/manifest+json' };

let offline = false;
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/__offline') { offline = true; res.end('ok'); return; }
  if (offline) { req.socket.destroy(); return; } // como si no hubiera red
  if (!path.endsWith('/') && !extname(path)) { res.writeHead(308, { Location: path + '/' }); res.end(); return; }
  let file = join(DIST, path);
  if (path.endsWith('/')) file = join(file, 'index.html');
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;

const OVERFLOW = `(async () => {
  const measure = () => {
    const vw = window.innerWidth, cw = document.documentElement.clientWidth, out = [];
    const scrollBox = (el) => /(auto|scroll|hidden)/.test(getComputedStyle(el).overflowX);
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || (r.right <= cw + 0.5 && r.left >= -0.5)) return;
      let p = el.parentElement, inside = false;
      while (p && p !== document.body) { if (scrollBox(p)) { inside = true; break; } p = p.parentElement; }
      if (!inside) out.push(el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
    });
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: vw, wide: out.length, sample: out.slice(0, 5) };
  };
  const a = measure();
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  await new Promise((r) => setTimeout(r, 300));
  const b = measure();
  return JSON.stringify({ title: document.title, bar: !!document.querySelector('.bar'), a, b });
})()`;

const SW = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reg = await Promise.race([navigator.serviceWorker.ready, wait(10000).then(() => null)]);
  if (!reg) return JSON.stringify({ error: 'el service worker no quedó listo' });
  for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await wait(100);
  const name = (await caches.keys()).find((k) => k.startsWith('taller-') && k !== 'taller-fonts');
  const cached = name ? (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname) : [];
  await fetch('/__offline');
  const results = {};
  for (const p of ${JSON.stringify(PAGES.slice(1))}) {
    const f = document.createElement('iframe');
    const loaded = new Promise((r) => { f.onload = r; });
    f.src = p; document.body.appendChild(f);
    await Promise.race([loaded, wait(8000)]);
    let title = null; try { title = f.contentDocument.title; } catch (e) {}
    // el tablero tiene que arrancar sin red (sus módulos salen de la caché), no solo abrir la página
    if (p === '/tablero/') { for (let i = 0; i < 30 && !(f.contentWindow && f.contentWindow.dojoTablero); i++) await wait(100); if (!(f.contentWindow && f.contentWindow.dojoTablero)) title = 'el tablero no arrancó sin conexión'; }
    results[p] = title;
  }
  return JSON.stringify({ controller: !!navigator.serviceWorker.controller, cache: name, cached, offline: results });
})()`;

// El selector de tema, con el sistema en oscuro: «Claro» pinta la paleta clara y se guarda, «Oscuro» la oscura y
// «Auto» vuelve a la del sistema y borra la elección.
const THEME = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bg = () => getComputedStyle(document.body).backgroundColor;
  const lum = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  const pick = async (t) => { const b = document.querySelector('.tema [data-tema="' + t + '"]'); if (!b) return null; b.click(); await wait(120); return { bg: bg(), saved: localStorage.getItem('taller-tema'), pressed: b.getAttribute('aria-pressed'), attr: document.documentElement.getAttribute('data-theme') }; };
  const sys = bg();
  const light = await pick('light'), dark = await pick('dark'), auto = await pick('auto');
  if (!light) return JSON.stringify({ error: 'no hay selector de tema' });
  const ok = lum(light.bg) > lum(dark.bg) + 100 && dark.bg === sys && auto.bg === sys && light.saved === 'light' && dark.saved === 'dark' && auto.saved === null && auto.attr === null && light.pressed === 'true';
  return JSON.stringify({ ok, sys, light: light.bg, dark: dark.bg, auto: auto.bg });
})()`;

// asíncrono: el servidor de arriba vive en este mismo proceso y tiene que seguir respondiendo
function run(args, js) {
  return new Promise((resolve) => {
    const ch = spawn('node', [BC, ...args, '--eval', js]);
    let out = '', err = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => ch.kill('SIGKILL'), 180000);
    ch.on('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').find((l) => l.startsWith('[eval] '));
      if (!line) { console.error(out.slice(-400), err.slice(-400)); resolve(null); return; }
      resolve(JSON.parse(JSON.parse(line.slice(7))));
    });
  });
}

let bad = 0;
const VIEWS = [['375', ['--width', '375', '--height', '812', '--mobile', '--light']], ['768', ['--width', '768', '--height', '1024', '--light']], ['1024', ['--width', '1024', '--height', '1366', '--light']], ['375 oscuro', ['--width', '375', '--height', '812', '--mobile', '--dark']]];
const jobs = PAGES.flatMap((p) => VIEWS.map(([label, args]) => ({ p, label, args })));
const results = new Array(jobs.length);
let next = 0;
await Promise.all([0, 1, 2].map(async () => { // tres Chrome a la vez
  while (next < jobs.length) { const i = next++; results[i] = await run(['--url', BASE + jobs[i].p, '--wait', '1500', ...jobs[i].args], OVERFLOW); }
}));
for (let i = 0; i < jobs.length; i++) {
  {
    const { p, label } = jobs[i], v = results[i];
    const ok = v && v.a.wide === 0 && v.b.wide === 0 && v.a.scrollWidth <= v.a.innerWidth && v.b.scrollWidth <= v.b.innerWidth;
    if (!ok) bad++;
    console.log(`${ok ? 'ok ' : 'MAL'} ${p.padEnd(16)} ${label.padEnd(10)} ${v ? `ancho ${v.a.scrollWidth}/${v.a.innerWidth}, abierto ${v.b.scrollWidth}/${v.b.innerWidth}${v.b.wide ? ' · ' + v.b.sample.join(' ') : ''}` : 'sin resultado'}`);
  }
}
const themes = [];
next = 0;
await Promise.all([0, 1, 2].map(async () => {
  while (next < PAGES.length) { const i = next++; themes[i] = await run(['--url', BASE + PAGES[i], '--wait', '1200', '--width', '375', '--height', '812', '--mobile', '--dark'], THEME); }
}));
PAGES.forEach((p, i) => {
  const v = themes[i], ok = !!(v && v.ok);
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'MAL'} ${p.padEnd(16)} tema       ${v ? (v.error || `sistema ${v.sys} · claro ${v.light} · oscuro ${v.dark} · auto ${v.auto}`) : 'sin resultado'}`);
});
// «Tu tablero» con datos: importar un progreso.json como el del kit (con fallas, bitácora y verificaciones) tiene que
// marcar las rondas, encender la T y no salirse de ancho con todo abierto; importarlo otra vez no cambia nada.
const PROGRESO = JSON.stringify({ estacion: 'c01-empaquetado', rondas: {
  guiado: { estado: 'hecha', inicio: '2026-11-10T09:12:00-06:00', fin: '2026-11-10T12:47:00-06:00' }, solo: { estado: 'en_curso', inicio: '2026-11-11T18:00:00-06:00', fin: null, pistas: 1 },
  romper_ayuda: { estado: 'en_curso', fallas: [{ id: 'url-localhost', inicio: '2026-11-12T16:00:00Z', fin: '2026-11-12T16:31:10Z', minutos: 31.2, pistas: 2, rendido: false, aprendi: 'Dentro de un contenedor, localhost es el propio contenedor: el gateway tiene que llamar al model server por el nombre del servicio de compose, y una nota muy larga sin espacios rompe-el-ancho-si-no-se-parte-bien-https://ejemplo.com/una/ruta/larguisima/que/no/termina/nunca' }] },
  romper_solo: { estado: 'pendiente', fallas: [] } },
  bitacora: [{ fecha: '2026-11-10T10:00:00-06:00', ronda: 'guiado', paso: 'gateway', hice: 'El Dockerfile del gateway con python:3.12-slim y usuario sin root.', medi: 'imagen de 162 MB', sigue: 'La caché de capas' }],
  verificaciones: [{ fecha: '2026-11-10T12:46:00-06:00', pasan: ['mundo', 'deps', 'contexto', 'gateway'], fallan: ['model-server'] }] });
const TABLERO = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40 && !window.dojoTablero; i++) await wait(100);
  if (!window.dojoTablero) return JSON.stringify({ error: 'el tablero no cargó' });
  const ok1 = window.dojoTablero.importarTexto(${JSON.stringify(PROGRESO)});
  const d = window.dojoTablero.leer();
  const e = d.estaciones.find((x) => x.id === 'c01-empaquetado');
  const rev = d.rev;
  window.dojoTablero.importarTexto(${JSON.stringify(PROGRESO)});
  const igual = window.dojoTablero.leer().rev === rev;
  document.querySelectorAll('details').forEach((x) => { x.open = true; });
  await wait(300);
  const cw = document.documentElement.clientWidth, wide = [];
  const scrollBox = (el) => /(auto|scroll|hidden)/.test(getComputedStyle(el).overflowX);
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || (r.right <= cw + 0.5 && r.left >= -0.5)) return;
    let p = el.parentElement, inside = false;
    while (p && p !== document.body) { if (scrollBox(p)) { inside = true; break; } p = p.parentElement; }
    if (!inside) wide.push(el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.'));
  });
  const g = document.querySelector('#t-marca [data-stage="contenedor"]:not([data-kind])');
  return JSON.stringify({ ok1, igual, rondas: e.rondas.map((r) => r.estado).join(','), fallas: e.fallas.length, notas: e.bitacora.length,
    pressed: document.querySelectorAll('#est-c01-empaquetado [aria-pressed="true"]').length, t: g ? +g.style.opacity : null,
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, wide: wide.slice(0, 5) });
})()`;
for (const [label, args] of VIEWS) {
  const v = await run(['--url', BASE + '/tablero/', '--wait', '1500', ...args], TABLERO);
  const ok = v && !v.error && v.ok1 && v.igual && v.rondas === 'hecha,en_curso,en_curso,pendiente' && v.fallas === 1 && v.notas === 1 && v.pressed === 4
    && v.t > 0.3 && !v.wide.length && v.scrollWidth <= v.innerWidth;
  if (!ok) bad++;
  console.log(`${ok ? 'ok ' : 'MAL'} /tablero/ importar ${label.padEnd(10)} ${v ? (v.error || `rondas ${v.rondas} · fallas ${v.fallas} · notas ${v.notas} · T ${v.t} · ancho ${v.scrollWidth}/${v.innerWidth}${v.wide.length ? ' · ' + v.wide.join(' ') : ''}`) : 'sin resultado'}`);
}
const s = await run(['--url', BASE + '/', '--wait', '2500', '--width', '1024', '--height', '800', '--light'], SW);
const swOk = s && s.controller && PAGES.every((p) => s.cached.includes(p)) && PAGES.slice(1).every((p) => s.offline[p] && s.offline[p].includes("Dojo de entrenamiento ML engineer's"));
if (!swOk) bad++;
console.log(`${swOk ? 'ok ' : 'MAL'} service worker: ${JSON.stringify(s)}`);
server.close();

const motor = revisarMotor();
if (motor.desfasados.length) bad++;
console.log(`${motor.desfasados.length ? 'MAL' : 'ok '} motor del tablero: ${!motor.fuente ? 'sin apps/tablero-ml al lado, no se revisa' : motor.desfasados.length ? `desfasado (${motor.desfasados.join(', ')}): corre node tools/motor.mjs` : 'la copia está al día'}`);
const pruebas = spawnSync('node', ['--test', join(ROOT, 'tools', 'test-tablero.mjs')], { encoding: 'utf8' });
const pasan = (pruebas.stdout.match(/^ℹ pass (\d+)/m) || [])[1], fallan = (pruebas.stdout.match(/^ℹ fail (\d+)/m) || [])[1];
if (pruebas.status !== 0) { bad++; console.log(pruebas.stdout.split('\n').filter((l) => /^not ok|Error|expected|actual/.test(l)).slice(0, 12).join('\n')); }
console.log(`${pruebas.status === 0 ? 'ok ' : 'MAL'} pruebas del tablero: ${pasan ?? '?'} pasan, ${fallan ?? '?'} fallan`);
console.log(bad ? `[check] ${bad} problema(s)` : '[check] todo bien');
process.exit(bad ? 1 : 0);
