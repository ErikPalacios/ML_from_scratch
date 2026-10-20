#!/usr/bin/env node
// Revisa dist/ en Chrome headless (con tools/browser-check.mjs de la app ml-system-design):
//   1. ninguna página se sale de ancho en celular (375), tablet (768 y 1024) ni en modo oscuro,
//      tampoco con todos los laboratorios, paneles y respuestas abiertos;
//   2. el service worker se instala, guarda todas las páginas y las sirve sin conexión.
// Sirve dist/ con un servidor local que imita a Vercel (trailingSlash) y que puede "cortar la red".
// Uso: npm run check   (arma dist/ y después corre esto)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BC = join(ROOT, '..', 'ml-system-design', 'tools', 'browser-check.mjs');
if (!existsSync(join(DIST, 'index.html'))) { console.error('[check] falta dist/: corre antes node tools/build.mjs'); process.exit(1); }
const SHEETS = JSON.parse(readFileSync(join(ROOT, 'sheets.json'), 'utf8'));
const PAGES = ['/', ...SHEETS.map((s) => `/${s.id}/`)];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json' };

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
  document.querySelectorAll('.dg-panel').forEach((p) => { p.hidden = false; });
  const q = document.getElementById('q-ans'); if (q) q.hidden = false;
  const rv = document.getElementById('rv-c01'); if (rv) rv.click();
  await new Promise((r) => setTimeout(r, 300));
  const b = measure();
  return JSON.stringify({ title: document.title, bar: !!document.querySelector('.hub-bar, .hero'), a, b });
})()`;

const SW = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const reg = await Promise.race([navigator.serviceWorker.ready, wait(10000).then(() => null)]);
  if (!reg) return JSON.stringify({ error: 'el service worker no quedó listo' });
  for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await wait(100);
  const name = (await caches.keys()).find((k) => k.startsWith('hojas-') && k !== 'hojas-fonts' && k !== 'hojas-cdn');
  const cached = name ? (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname) : [];
  await fetch('/__offline');
  const results = {};
  for (const p of ${JSON.stringify(PAGES.slice(1))}) {
    const f = document.createElement('iframe');
    const loaded = new Promise((r) => { f.onload = r; });
    f.src = p; document.body.appendChild(f);
    await Promise.race([loaded, wait(8000)]);
    let title = null; try { title = f.contentDocument.title; } catch (e) {}
    results[p] = title;
  }
  let pdf = null; try { const r = await fetch('${SHEETS[0] ? `/${SHEETS[0].id}/${SHEETS[0].pdf}` : ''}'); pdf = r.status; } catch (e) { pdf = 'sin red y sin copia (esperado si no se abrió antes)'; }
  // scripts de cdnjs que una hoja pidió (js-yaml del revisor): quedan en su caché para la próxima vez sin conexión
  let cdn = [];
  for (let i = 0; i < 30; i++) { cdn = (await caches.has('hojas-cdn')) ? (await (await caches.open('hojas-cdn')).keys()).map((r) => new URL(r.url).pathname) : []; if (cdn.length) break; await wait(100); }
  return JSON.stringify({ controller: !!navigator.serviceWorker.controller, cache: name, cached, offline: results, pdf, cdn });
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
const s = await run(['--url', BASE + '/', '--wait', '2500', '--width', '1024', '--height', '800', '--light'], SW);
const swOk = s && s.controller && PAGES.every((p) => s.cached.includes(p)) && SHEETS.every((h) => s.offline[`/${h.id}/`] === h.title);
if (!swOk) bad++;
console.log(`${swOk ? 'ok ' : 'MAL'} service worker: ${JSON.stringify(s)}`);
server.close();
console.log(bad ? `[check] ${bad} problema(s)` : '[check] todo bien');
process.exit(bad ? 1 : 0);
