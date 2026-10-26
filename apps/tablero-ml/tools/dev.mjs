#!/usr/bin/env node
// Servidor local para probar el tablero en tu Mac sin Vercel ni Upstash: arma dist/, lo sirve y responde /api/* con el
// mismo server/handler.mjs que corre en Vercel. Los datos van a .data/dev-store.json (git lo ignora).
// Variables: lee .env.local si existe (APP_PASSWORD, SESSION_SECRET, API_TOKEN, TABLERO_TZ). Sin APP_PASSWORD usa
// «tablero-local» y avisa. Con UPSTASH_REDIS_REST_URL/TOKEN en .env.local usa esa base de datos en vez del archivo.
// Uso: npm run dev [-- --port 5173]    ·    GET /__offline corta la red (para probar sin conexión), /__online la devuelve.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { localServer } from './local-server.mjs';
import { memoryStore, storeFromEnv } from '../server/store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 5173;

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...readEnvFile(join(ROOT, '.env.local')), ...process.env };
if (!env.APP_PASSWORD) { env.APP_PASSWORD = 'tablero-local'; console.log('[dev] sin APP_PASSWORD en .env.local: la contraseña local es «tablero-local»'); }
if (!env.SESSION_SECRET) env.SESSION_SECRET = randomBytes(24).toString('hex');
const store = storeFromEnv(env) || memoryStore({ file: join(ROOT, '.data', 'dev-store.json') });

execFileSync(process.execPath, [join(ROOT, 'tools', 'build.mjs')], { stdio: 'inherit' });

const server = localServer({ env, store });
server.listen(port, '127.0.0.1', () => console.log(`[dev] http://localhost:${port} · datos en ${store.kind}`));
