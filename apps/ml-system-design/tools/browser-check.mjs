#!/usr/bin/env node
// Herramienta de verificación en navegador (Chrome headless vía CDP, sin dependencias).
//
// Uso:
//   node tools/browser-check.mjs --url index.html [--width 1440 --height 900] [--dark | --light] [--mobile]
//        [--wait 2500] [--eval "js"]... [--eval-file script.js] [--shot out.png] [--full] [--timeout ms]
//
// - Imprime todos los console.* y excepciones de la página.
// - Cada --eval se evalúa en orden (se espera si devuelve una Promise) y se imprime su valor (JSON).
// - Sale con código 1 si hubo excepciones no capturadas o console.error.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parseArgs(argv) {
  const o = { width: 1440, height: 900, wait: 2500, evals: [], dark: false, full: false, timeout: 120000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], n = () => argv[++i];
    if (a === '--url') o.url = n();
    else if (a === '--width') o.width = +n();
    else if (a === '--height') o.height = +n();
    else if (a === '--wait') o.wait = +n();
    else if (a === '--eval') o.evals.push(n());
    else if (a === '--eval-file') o.evals.push(readFileSync(n(), 'utf8'));
    else if (a === '--shot') o.shot = n();
    else if (a === '--full') o.full = true;
    else if (a === '--dark') o.dark = true;
    else if (a === '--light') o.light = true;   // fuerza claro aunque el sistema esté en modo oscuro
    else if (a === '--mobile') o.mobile = true;
    else if (a === '--timeout') o.timeout = +n();
    else { console.error('Argumento desconocido: ' + a); process.exit(2); }
  }
  if (!o.url) { console.error('Falta --url'); process.exit(2); }
  if (!/^[a-z]+:\/\//i.test(o.url)) o.url = pathToFileURL(resolve(o.url)).href;
  return o;
}

const opts = parseArgs(process.argv.slice(2));
const userDir = mkdtempSync(join(tmpdir(), 'tl-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${userDir}`, '--allow-file-access-from-files', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let hadError = false;
const killAll = () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(userDir, { recursive: true, force: true }); } catch {} };
const hardTimer = setTimeout(() => { console.error('[timeout] superado ' + opts.timeout + 'ms'); killAll(); process.exit(3); }, opts.timeout);

const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) res(m[1]);
  });
  chrome.on('exit', (c) => rej(new Error('Chrome terminó: ' + c + '\n' + buf)));
});

const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  } else if (msg.method) listeners.forEach((l) => l(msg));
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = nextId++; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);

const fmtArg = (a) => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type);
let loaded = false;
listeners.push((msg) => {
  if (msg.sessionId !== sessionId) return;
  if (msg.method === 'Runtime.consoleAPICalled') {
    const t = msg.params.type; const text = msg.params.args.map(fmtArg).join(' ');
    console.log(`[console.${t}] ${text}`);
    if (t === 'error' || t === 'assert') hadError = true;
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.log(`[EXCEPTION] ${d.exception?.description || d.text} @ ${d.url || ''}:${d.lineNumber}:${d.columnNumber}`);
    hadError = true;
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error' || e.level === 'warning') console.log(`[log.${e.level}] ${e.text} ${e.url || ''}`);
    if (e.level === 'error' && !/favicon/.test(e.url || '')) hadError = true;
  } else if (msg.method === 'Page.loadEventFired') loaded = true;
});

await S('Runtime.enable'); await S('Page.enable'); await S('Log.enable');
await S('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: !!opts.mobile });
if (opts.dark || opts.light) await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.dark ? 'dark' : 'light' }] });
await S('Page.navigate', { url: opts.url });
for (let i = 0; i < 300 && !loaded; i++) await new Promise((r) => setTimeout(r, 50));
await new Promise((r) => setTimeout(r, opts.wait));

for (const expr of opts.evals) {
  try {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) { console.log('[eval EXCEPTION] ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); hadError = true; }
    else console.log('[eval] ' + JSON.stringify(r.result.value, null, 0));
  } catch (e) { console.log('[eval FAILED] ' + e.message); hadError = true; }
  await new Promise((r) => setTimeout(r, 150));
}

if (opts.shot) {
  let clip;
  if (opts.full) {
    const m = await S('Page.getLayoutMetrics');
    const cs = m.cssContentSize || m.contentSize;
    clip = { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.min(Math.ceil(cs.height), 16000), scale: 1 };
  }
  const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!opts.full, ...(clip ? { clip } : {}) });
  writeFileSync(opts.shot, Buffer.from(shot.data, 'base64'));
  console.log('[shot] ' + resolve(opts.shot));
}

clearTimeout(hardTimer);
ws.close(); killAll();
console.log(hadError ? '[resultado] ERRORES detectados' : '[resultado] OK sin errores');
process.exit(hadError ? 1 : 0);
