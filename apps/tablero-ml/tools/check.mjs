#!/usr/bin/env node
// Revisa dist/ en Chrome headless (con tools/browser-check.mjs de la app ml-system-design):
//   1. ninguna vista se sale de ancho en celular (375), tablet (768) ni escritorio (1024), en claro y en oscuro,
//      con el C01 precargado, un paso abierto, los formularios abiertos y el resumen para retomar;
//   2. sin conexión: la página abre desde el service worker, muestra los proyectos de la copia local, guarda un cambio
//      en la cola y lo sube cuando vuelve la red.
// Uso: npm run check   (arma dist/ y después corre esto)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localServer } from './local-server.mjs';
import { memoryStore } from '../server/store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BC = join(ROOT, '..', 'ml-system-design', 'tools', 'browser-check.mjs');
if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('[check] falta dist/: corre antes node tools/build.mjs'); process.exit(1); }
const PASSWORD = 'check-password-123';
const store = memoryStore();
const server = localServer({ env: { APP_PASSWORD: PASSWORD, SESSION_SECRET: 'c'.repeat(40) }, store, frameSelf: true });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;

const ROUTES = ['#/', '#/new', '#/p/c01', '#/p/c01/step/kickoff', '#/p/c01/step/serving', '#/p/c01/sizing', '#/p/c01/log', '#/p/c01/decisions', '#/p/c01/settings'];

// Dentro de la página: entra, precarga el C01, recorre las vistas y mide si algo se sale del ancho.
const WIDTHS = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ${JSON.stringify(PASSWORD)} }) });
  const { seedC01 } = await import('/js/shared/seed-c01.mjs');
  if (!(await (await fetch('/api/projects')).json()).projects.some((p) => p.id === 'c01')) await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: seedC01() }) });
  const measure = () => {
    const cw = document.documentElement.clientWidth, out = [];
    const scrollBox = (el) => /(auto|scroll|hidden)/.test(getComputedStyle(el).overflowX);
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || (r.right <= cw + 0.5 && r.left >= -0.5)) return;
      let p = el.parentElement, inside = false;
      while (p && p !== document.body) { if (scrollBox(p)) { inside = true; break; } p = p.parentElement; }
      if (!inside && !el.closest('svg')) out.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : '') + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
    });
    return { scroll: document.documentElement.scrollWidth, cw, wide: out.length, sample: out.slice(0, 4) };
  };
  const res = {};
  for (const r of ${JSON.stringify(ROUTES)}) {
    location.hash = r;
    await wait(700);
    const m = measure();
    // abre los formularios de agregar para medirlos también
    document.querySelectorAll('[data-act="item-edit"]').forEach((b, i) => { if (i === 0) b.click(); });
    await wait(150);
    const m2 = measure();
    res[r] = { title: document.querySelector('h1') ? document.querySelector('h1').textContent.trim().slice(0, 40) : null, a: m.wide, b: m2.wide, sample: [...m.sample, ...m2.sample].slice(0, 4), stations: document.querySelectorAll('.st').length, layout: (document.querySelector('.map') || {}).dataset ? document.querySelector('.map') && document.querySelector('.map').dataset.layout : null };
  }
  location.hash = '#/p/c01';
  await wait(600);
  document.querySelector('[data-act="summary"]').click();
  await wait(300);
  res.summary = { open: !!document.querySelector('dialog[open]'), md: (document.querySelector('dialog pre.md') || {}).textContent ? document.querySelector('dialog pre.md').textContent.slice(0, 30) : null, ...measure() };
  return JSON.stringify(res);
})()`;

// Sin conexión: el service worker sirve la página, la copia local muestra el C01 y un cambio espera en la cola.
const OFFLINE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ${JSON.stringify(PASSWORD)} }) });
  location.hash = '#/p/c01';
  await wait(1200);
  const reg = await Promise.race([navigator.serviceWorker.ready, wait(8000).then(() => null)]);
  for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await wait(100);
  const cached = reg ? (await (await caches.open((await caches.keys()).find((k) => k.startsWith('tablero-') && k !== 'tablero-fonts'))).keys()).length : 0;
  await fetch('/__offline');
  const f = document.createElement('iframe');
  const loaded = new Promise((r) => { f.onload = r; });
  f.src = '/#/p/c01'; f.style.width = '375px'; f.style.height = '800px';
  document.body.appendChild(f);
  await Promise.race([loaded, wait(8000)]);
  await wait(2500);
  const doc = f.contentDocument;
  const offlineTitle = doc && doc.querySelector('h1') ? doc.querySelector('h1').textContent : null;
  const pill = doc && doc.getElementById('sync') ? doc.getElementById('sync').textContent : null;
  // un cambio sin red: marcar la vuelta 1 del paso de empaquetado como hecha
  f.contentWindow.location.hash = '#/p/c01/step/empaquetado';
  await wait(800);
  const btn = [...doc.querySelectorAll('[data-act="set"]')].find((b) => b.dataset.path.includes('v1') && b.dataset.value === '"hecho"');
  if (btn) btn.click();
  await wait(1200);
  const pillAfter = doc.getElementById('sync').textContent;
  await fetch('/__online');
  f.contentWindow.dispatchEvent(new Event('online'));
  await wait(2500);
  const pillOnline = doc.getElementById('sync').textContent;
  const server = await (await fetch('/api/projects/c01', { cache: 'no-store' })).json();
  const v1 = server.project.steps.find((s) => s.id === 'empaquetado').vuelta.v1;
  return JSON.stringify({ sw: !!reg, cached, offlineTitle, pill, clicked: !!btn, pillAfter, pillOnline, serverV1: v1 });
})()`;

function run(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BC, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, out }));
  });
}
// browser-check imprime «[eval] <JSON>»; el eval devuelve un texto JSON, así que se decodifica dos veces.
function lastJson(out) {
  for (const l of out.trim().split('\n').reverse()) {
    if (!l.startsWith('[eval] ')) continue;
    try { const v = JSON.parse(l.slice(7)); return typeof v === 'string' ? JSON.parse(v) : v; } catch {}
  }
  return null;
}
// Errores de consola que no son fallas: recursos que no cargan porque la prueba cortó la red a propósito.
const realErrors = (out, offline) => out.split('\n').filter((l) => (/^\[(log\.error|exception)/.test(l) || /Content Security Policy|violates/i.test(l)) && !(offline && /ERR_EMPTY_RESPONSE|ERR_CONNECTION|Failed to fetch/.test(l)));

let failed = 0;
const runs = [
  { w: 375, h: 812, mobile: true, dark: false }, { w: 375, h: 812, mobile: true, dark: true },
  { w: 768, h: 1024, dark: false }, { w: 1024, h: 768, dark: true }, { w: 1024, h: 768, dark: false },
];
for (const r of runs) {
  await new Promise((res) => setTimeout(res, 50));
  const { code, out } = await run(['--url', BASE + '/', '--width', String(r.w), '--height', String(r.h), ...(r.mobile ? ['--mobile'] : []), r.dark ? '--dark' : '--light', '--wait', '1500', '--eval', WIDTHS, '--timeout', '90000']);
  const j = lastJson(out);
  const label = `${r.w}px ${r.dark ? 'oscuro' : 'claro'}`;
  if (!j) { console.log(`✖ ${label}: sin resultado (exit ${code})\n${out.slice(-1500)}`); failed++; continue; }
  const bad = Object.entries(j).filter(([k, v]) => k !== 'summary' && (v.a || v.b));
  const okSummary = j.summary && j.summary.open && j.summary.md && !j.summary.wide;
  const okMap = j['#/p/c01'] && j['#/p/c01'].stations === 13 && j['#/p/c01'].layout === (r.w >= 640 ? 'grid' : 'list');
  const errs = realErrors(out, false);
  if (bad.length || !okSummary || !okMap || errs.length) {
    failed++;
    console.log(`✖ ${label}: ${bad.map(([k, v]) => `${k} se sale (${v.sample.join(', ')})`).join(' · ')}${okSummary ? '' : ' · resumen ' + JSON.stringify(j.summary)}${okMap ? '' : ' · mapa ' + JSON.stringify(j['#/p/c01'])}${errs.length ? ' · errores en consola:\n' + errs.slice(0, 5).join('\n') : ''}`);
  } else console.log(`✔ ${label}: ${ROUTES.length} vistas y el resumen caben; mapa ${j['#/p/c01'].layout} con 13 estaciones`);
}

// la prueba sin conexión usa un store nuevo con el C01 ya cargado
const { seedC01 } = await import('../web/js/shared/seed-c01.mjs');
await store.put(seedC01(), (await store.get('c01')) ? (await store.get('c01')).rev : -1).catch(() => {});
const { code, out } = await run(['--url', BASE + '/', '--width', '1024', '--height', '800', '--wait', '1500', '--eval', OFFLINE, '--timeout', '90000']);
const o = lastJson(out);
const oerrs = realErrors(out, true);
if (oerrs.length || !o || !o.sw || !o.cached || !/C01/.test(o.offlineTitle || '') || !/Offline/.test(o.pill || '') || !o.clicked || !/unsynced/.test(o.pillAfter || '') || o.serverV1 !== 'hecho') {
  failed++;
  console.log(`✖ sin conexión: ${JSON.stringify(o)} (exit ${code})\n${oerrs.join('\n')}${o ? '' : out.slice(-1500)}`);
} else console.log(`✔ sin conexión: el service worker guardó ${o.cached} archivos; sin red abre «${o.offlineTitle}» («${o.pill.trim()}»), el cambio queda en cola («${o.pillAfter.trim()}») y se sube al volver la red («${o.pillOnline.trim()}»)`);

server.close();
process.exit(failed ? 1 : 0);
