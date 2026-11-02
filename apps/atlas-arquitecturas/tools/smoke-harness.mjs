#!/usr/bin/env node
// Corre tools/smoke.js en los entornos que el smoke normal no cubre (SPEC §10):
//   node tools/smoke-harness.mjs artifact   dist/artifact.html envuelto en una página con un
//                                           window.claude falso (db + user) y un localStorage que lanza
//   node tools/smoke-harness.mjs web        dist/web servido por http (python3 -m http.server en un
//                                           puerto libre, que se detiene al terminar): service worker,
//                                           lab/ precargado y MathJax en caché desde la primera visita
//   node tools/smoke-harness.mjs offline    dist/atlas-arquitecturas.html con MathJax apuntando a un
//                                           puerto cerrado: el respaldo de las fórmulas aparece al instante
// Requiere los builds (los scripts npm smoke:artifact / smoke:web / smoke:offline los hacen antes).
// Extra: --width/--height/--dark/--light/--mobile pasan tal cual a browser-check.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const mode = process.argv[2];
const passthru = process.argv.slice(3);
if (!['artifact', 'web', 'offline'].includes(mode)) { console.error('Uso: node tools/smoke-harness.mjs artifact|web|offline [opciones de browser-check]'); process.exit(2); }
const need = (f) => { if (!existsSync(f)) { console.error('[smoke-harness] falta ' + f + ' (corre antes el build)'); process.exit(2); } return f; };

const setMode = '--eval';
const modeJs = 'window.__SMOKE_MODE = ' + JSON.stringify(mode) + '; true';
function browserCheck(url, extra) {
  const args = [join(ROOT, 'tools', 'browser-check.mjs'), '--url', url, '--wait', '2500', '--timeout', '300000',
    setMode, modeJs, '--eval-file', join(ROOT, 'tools', 'smoke.js')].concat(extra || [], passthru);
  if (!passthru.some((a) => a === '--dark' || a === '--light')) args.push('--light');
  return new Promise((res) => { const p = spawn(process.execPath, args, { stdio: 'inherit', cwd: ROOT }); p.on('exit', (code) => res(code == null ? 1 : code)); });
}

let code = 1;
if (mode === 'artifact') {
  // El artefacto real no tiene <!doctype>/<head>/<body>: claude.ai lo envuelve. Aquí, una envoltura
  // mínima con lo que el Artifact ofrece: window.claude.use('db' | 'user') y sin localStorage.
  const art = readFileSync(need(join(DIST, 'artifact.html')), 'utf8');
  const mock = `<script>
try { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); } catch (e) {}
window.__writes = [];
(function () {
  const mem = {};
  const doc = (p) => ({ id: p.split('/').pop(), path: p,
    get: () => Promise.resolve({ exists: p in mem, data: () => (p in mem ? JSON.parse(JSON.stringify(mem[p])) : undefined) }),
    set: (d) => { window.__writes.push(p); mem[p] = JSON.parse(JSON.stringify(d)); return Promise.resolve(); } });
  window.claude = { use(n) {
    if (n === 'user') return Promise.resolve({ id: () => Promise.resolve('u_smoke') });
    if (n === 'db') return Promise.resolve({ doc });
    return Promise.reject(Object.assign(new Error('no'), { code: 'not_granted' }));
  } };
})();
</script>`;
  const out = join(DIST, 'artifact-test.html');
  writeFileSync(out, '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + mock + '</head><body>\n' + art + '\n</body></html>\n');
  code = await browserCheck(out);
} else if (mode === 'offline') {
  const single = readFileSync(need(join(DIST, 'atlas-arquitecturas.html')), 'utf8');
  const re = /(<script\b[^>]*\bid="MathJax-script"[^>]*\bsrc=")https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mathjax\/([^"]+)"/;
  if (!re.test(single)) { console.error('[smoke-harness] no encontré el <script id="MathJax-script"> de cdnjs'); process.exit(1); }
  const out = join(DIST, 'offline-test.html');
  writeFileSync(out, single.replace(re, '$1http://127.0.0.1:9/mathjax/$2"'));
  code = await browserCheck(out, ['--allow-log', '127\\.0\\.0\\.1:9|ERR_CONNECTION_REFUSED']);
} else {
  need(join(DIST, 'web', 'index.html'));
  const port = await new Promise((res, rej) => { const s = createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', join(DIST, 'web')], { stdio: ['ignore', 'ignore', 'ignore'] });
  const stop = () => { try { srv.kill('SIGTERM'); } catch (e) { /* ya terminó */ } };
  process.on('exit', stop);
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/'); up = r.ok; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!up) { console.error('[smoke-harness] python3 -m http.server no respondió en el puerto ' + port); stop(); process.exit(1); }
  console.log('[smoke-harness] dist/web en http://127.0.0.1:' + port + '/');
  code = await browserCheck('http://127.0.0.1:' + port + '/');
  stop();
}
process.exit(code);
