#!/usr/bin/env node
// Valida cada estación de content/estaciones/*.json contra el molde (schema.mjs) y revisa que existan sus prompts.
//   node tools/validate.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estacion, cruzadas, practica, cruzadasPractica } from './schema.mjs';

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
  // Las prácticas desde cero: su molde, y que sus conceptos existan en la estación o en alguna práctica.
  const ps = errs.length ? [] : (e.practicas || []).map((rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')));
  ps.forEach((p, i) => errs.push(...practica(p, e.practicas[i])));
  if (!errs.length && ps.length) {
    const conocidos = new Set([...e.conceptos.map((c) => c.id), ...ps.flatMap((p) => p.conceptos.map((c) => c.id))]);
    ps.forEach((p) => errs.push(...cruzadasPractica(p, conocidos, (rel) => existsSync(join(ROOT, rel)))));
  }
  errs.forEach((x) => console.error('  ✗ ' + x));
  console.log(`${errs.length ? '✗' : '✓'} ${f}: ${e.conceptos?.length ?? 0} conceptos, ${e.guiado?.length ?? 0} pasos, ${e.fallas?.length ?? 0} fallas, ${ps.length} prácticas desde cero`);
  total += errs.length;
}
process.exit(total ? 1 : 0);
