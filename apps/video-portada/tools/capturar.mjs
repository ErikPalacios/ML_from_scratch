// Graba las tomas del video desde las apps publicadas. Uso: node tools/capturar.mjs [nombre ...] (sin nombres: todas)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { grabar } from './grabador.mjs';
import { TOMAS as BASE } from './tomas.mjs';
import { TUTORIALES } from './tomas-tutoriales.mjs';

const TOMAS = [...BASE, ...TUTORIALES];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'capturas');
mkdirSync(OUT, { recursive: true });
const pedidas = process.argv.slice(2);
const lista = pedidas.length ? TOMAS.filter((t) => pedidas.includes(t.nombre)) : TOMAS;
if (pedidas.length && lista.length !== pedidas.length) throw new Error('no conozco: ' + pedidas.filter((n) => !TOMAS.some((t) => t.nombre === n)).join(', '));

// duraciones.json: lo lee el video para saber cuánto dura cada toma
const fDur = join(ROOT, 'src', 'duraciones.json');
const dur = existsSync(fDur) ? JSON.parse(readFileSync(fDur, 'utf8')) : {};
// marcas.json: dónde estaba cada elemento que el montaje rodea con un aro (lo escribe marcar() en grabador.mjs)
const fMar = join(ROOT, 'src', 'marcas.json');
const mar = existsSync(fMar) ? JSON.parse(readFileSync(fMar, 'utf8')) : {};
for (const t of lista) {
  try { const r = await grabar(t, OUT); dur[t.nombre] = +r.dur.toFixed(2); writeFileSync(fDur, JSON.stringify(dur, null, 2) + '\n');
    if (Object.keys(r.marcas || {}).length) { mar[t.nombre] = r.marcas; writeFileSync(fMar, JSON.stringify(mar, null, 1) + '\n'); } }
  catch (e) { console.error(`✗ ${t.nombre}: ${e.message}`); process.exitCode = 1; }
}
