#!/usr/bin/env node
// Revisa dist/ de la portada en Chrome headless (con tools/browser-check.mjs de la app ml-system-design):
//   1. ninguna página se sale de ancho en celular (375), tablet (768 y 1024) ni en modo oscuro;
//   2. el selector de tema funciona y se recuerda.
// Sirve dist/ con un servidor local que imita a Vercel (trailingSlash) y que puede "cortar la red".
// Uso: npm run check   (arma dist/ y después corre esto)
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'trueml-tema';
const DIST = join(ROOT, 'dist');
const BC = join(ROOT, '..', 'ml-system-design', 'tools', 'browser-check.mjs');
if (!existsSync(join(DIST, 'index.html'))) { console.error('[check] falta dist/: corre antes node tools/build.mjs'); process.exit(1); }
const PAGES = ['/', '/privacidad/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.zip': 'application/zip', '.webmanifest': 'application/manifest+json' };

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

// El selector de tema, con el sistema en oscuro: «Claro» pinta la paleta clara y se guarda, «Oscuro» la oscura y
// «Auto» vuelve a la del sistema y borra la elección.
const THEME = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bg = () => getComputedStyle(document.body).backgroundColor;
  const lum = (c) => { const m = c.match(/\\d+(\\.\\d+)?/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  const pick = async (t) => { const b = document.querySelector('.tm-tema [data-tema="' + t + '"]'); if (!b) return null; b.click(); await wait(120); return { bg: bg(), saved: localStorage.getItem('${KEY}'), pressed: b.getAttribute('aria-pressed'), attr: document.documentElement.getAttribute('data-theme') }; };
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
server.close();
console.log(bad ? `[check] ${bad} problema(s)` : '[check] todo bien');
process.exit(bad ? 1 : 0);
