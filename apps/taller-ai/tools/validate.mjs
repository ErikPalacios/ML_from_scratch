#!/usr/bin/env node
// Valida cada estación de content/estaciones/*.json contra el molde (schema.mjs) y revisa que existan sus prompts.
//   node tools/validate.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estacion, cruzadas } from './schema.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'content', 'estaciones');

let total = 0;
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()) {
  const e = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const errs = estacion(e, f.replace('.json', ''));
  if (!errs.length) {
    errs.push(...cruzadas(e));
    if (`${e.caso}-${e.id}.json` !== f) errs.push(`el archivo debería llamarse ${e.caso}-${e.id}.json`);
    for (const [k, rel] of Object.entries(e.prompts)) if (!existsSync(join(ROOT, rel))) errs.push(`prompts.${k}: no existe ${rel}`);
  }
  errs.forEach((x) => console.error('  ✗ ' + x));
  console.log(`${errs.length ? '✗' : '✓'} ${f}: ${e.conceptos?.length ?? 0} conceptos, ${e.guiado?.length ?? 0} pasos, ${e.fallas?.length ?? 0} fallas`);
  total += errs.length;
}
process.exit(total ? 1 : 0);
