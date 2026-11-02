// Servidor local que imita a Vercel: sirve dist/ y responde /api/* con server/handler.mjs. Lo usan dev.mjs y check.mjs.
// GET /__offline corta la red (cierra cada conexión, como si no hubiera señal) y /__online la devuelve.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../server/handler.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
// Los mismos encabezados de seguridad que pone Vercel (vercel.json, regla "/(.*)"): así el chequeo en Chrome
// también ve si la CSP bloquea algo (fuentes, el service worker, estilos).
const VERCEL = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const SECURITY = Object.fromEntries((VERCEL.headers.find((h) => h.source === '/(.*)') || { headers: [] }).headers.filter((h) => h.key !== 'Strict-Transport-Security').map((h) => [h.key, h.value]));

export function localServer({ env, store, frameSelf = false }) {
  // check.mjs abre la app en un iframe para la prueba sin conexión: solo ahí se permite enmarcarla desde sí misma
  const SEC = frameSelf ? { ...SECURITY, 'Content-Security-Policy': SECURITY['Content-Security-Policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'") } : SECURITY;
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  let offline = false;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/__offline') { offline = true; res.end('sin red'); return; }
    if (url.pathname === '/__online') { offline = false; res.end('con red'); return; }
    if (offline) { req.socket.destroy(); return; }
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const response = await handle(request, { env, store });
      res.writeHead(response.status, { ...SEC, ...Object.fromEntries(response.headers) });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = join(file, 'index.html');
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { ...SEC, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  });
  return server;
}
