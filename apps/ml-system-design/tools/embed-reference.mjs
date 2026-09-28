#!/usr/bin/env node
// Incrusta los archivos de referencia reales (reference/**) en js/content/reference-files.js
// como MSD.files["c01/gateway/app/main.py"] = "…". Así la app funciona con doble clic (file://)
// sin fetch, y los archivos siguen siendo archivos de verdad que se pueden ejecutar y probar.
// Uso: node tools/embed-reference.mjs [--check]   (--check: sale con 1 si el generado está desactualizado)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = join(ROOT, 'reference');
const OUT = join(ROOT, 'js', 'content', 'reference-files.js');
const check = process.argv.includes('--check');

const SKIP_DIRS = new Set(['.venv', 'venv', '__pycache__', 'node_modules', '.pytest_cache', '.mypy_cache', 'dist', 'build', '.git']);
const SKIP_FILES = /(^\.DS_Store$|\.pyc$|\.plan$|\.onnx$|\.pt$|\.pth$|\.engine$|\.png$|\.jpe?g$|\.webp$|\.gif$|\.zip$|\.tar(\.gz)?$)/i;
const MAX_BYTES = 200 * 1024;

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(p, out); continue; }
    if (SKIP_FILES.test(name)) continue;
    if (name.startsWith('.') && name !== '.dockerignore' && name !== '.env.example') continue;
    if (st.size > MAX_BYTES) { console.warn('[embed] omitido (> 200 KB): ' + relative(REF, p)); continue; }
    const txt = readFileSync(p, 'utf8');
    if (txt.includes('\u0000')) { console.warn('[embed] omitido (binario): ' + relative(REF, p)); continue; }
    out.push({ key: relative(REF, p).split(sep).join('/'), txt });
  }
  return out;
}

const files = walk(REF, []);
const body = files.map((f) => '    ' + JSON.stringify(f.key) + ': ' + JSON.stringify(f.txt)).join(',\n');
const js = `/* GENERADO por tools/embed-reference.mjs a partir de reference/** — NO editar a mano.
   Regenera con: node tools/embed-reference.mjs */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  MSD.files = Object.assign(MSD.files || {}, {
${body}
  });
})(typeof window !== 'undefined' ? window : globalThis);
`;
const escaped = js.replace(/<\/script/gi, '<\\/script');

if (check) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== escaped) { console.error('[embed] js/content/reference-files.js está desactualizado: corre node tools/embed-reference.mjs'); process.exit(1); }
  console.log('[embed] OK (' + files.length + ' archivos)');
} else {
  writeFileSync(OUT, escaped);
  console.log('[embed] ' + files.length + ' archivos → js/content/reference-files.js');
  for (const f of files) console.log('  ' + f.key.padEnd(56) + String(Buffer.byteLength(f.txt)).padStart(8) + ' B');
}
