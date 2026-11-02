#!/usr/bin/env node
// Arma dist/ para Vercel: copia web/ y escribe en sw.js el hash del contenido y la lista de archivos a guardar.
// Sin dependencias: Vercel solo corre `node tools/build.mjs`. Las Functions (api/) las empaqueta Vercel aparte.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const DIST = join(ROOT, 'dist');

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
rmSync(DIST, { recursive: true, force: true });
const files = walk(WEB).filter((f) => !f.endsWith('.DS_Store')).sort();
const hash = createHash('sha256');
for (const f of files) {
  const rel = relative(WEB, f);
  if (rel === 'sw.js') continue;
  hash.update(rel).update(readFileSync(f));
  mkdirSync(dirname(join(DIST, rel)), { recursive: true });
  copyFileSync(f, join(DIST, rel));
}
const build = hash.digest('hex').slice(0, 12);
const assets = ['/', ...files.map((f) => '/' + relative(WEB, f).split('\\').join('/')).filter((p) => p !== '/sw.js' && p !== '/index.html')];
writeFileSync(join(DIST, 'sw.js'), readFileSync(join(WEB, 'sw.js'), 'utf8').replace("'__BUILD__'", JSON.stringify(build)).replace('__ASSETS__', JSON.stringify(assets)));
console.log(`[build] dist/ · ${files.length} archivos · BUILD ${build}`);
