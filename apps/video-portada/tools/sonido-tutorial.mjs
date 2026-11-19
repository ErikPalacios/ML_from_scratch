// La pista de cada video explicativo (tools/sintes.mjs). Es un fondo tranquilo para leer: pad, bajo, arpegio
// y platillos suaves, sin bombo. Cada paso nuevo suena con una nota de la escala; la portada y el cierre llevan
// el barrido y un golpe. Los tiempos salen del guion (src/tutoriales/), que se compila con esbuild para leerlo aquí.
// Escribe public/tutoriales/<id>.wav. Uso: node tools/sonido-tutorial.mjs [id …]   (sin argumentos: todos)
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ESCALA, FPS, mezcla, tramos } from './sintes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(ROOT, 'out', '.guiones.mjs');
mkdirSync(join(ROOT, 'out'), { recursive: true });
await build({
  stdin: { contents: "export { GUIONES } from './guiones'; export { iniciosPasos, duracionGuion } from './tiempo';", resolveDir: join(ROOT, 'src', 'tutoriales'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: tmp, logLevel: 'error',
});
const { GUIONES, iniciosPasos, duracionGuion } = await import(pathToFileURL(tmp).href + '?' + Date.now());
rmSync(tmp, { force: true });

const pedidos = process.argv.slice(2);
mkdirSync(join(ROOT, 'public', 'tutoriales'), { recursive: true });
for (const g of GUIONES.filter((x) => !pedidos.length || pedidos.includes(x.id))) {
  const total = duracionGuion(g), DUR = total / FPS;
  const s = (f) => f / FPS;
  const cuerpo = s(g.intro), cierre = s(total - g.cierre);
  const M = mezcla(DUR);
  M.musica({
    pad: (t) => tramos(t, [[0, 0.5], [cuerpo, 0.75], [DUR - 3, 0.75], [DUR, 0]]),
    corte: (t) => tramos(t, [[0, 800], [cuerpo, 1500], [cierre, 1500], [cierre + 1, 2400], [DUR, 900]]),
    bombo: () => 0,
    bajo: (t) => (t >= cuerpo && t < DUR - 2 ? 1 : 0),
    hat: (t) => (t >= cuerpo + 2 && t < cierre ? 1 : 0),
    arpegio: (t) => tramos(t, [[0, 0.35], [cuerpo, 0.45], [cierre, 0.6], [DUR - 1.5, 0.3], [DUR, 0]]),
  });
  ESCALA.forEach((m, i) => M.pop(0.15 + i * 0.17, m, 0.7, -0.3 + i * 0.12)); // la T se arma en la portada
  M.whoosh(cuerpo, 0.9); M.golpe(cuerpo, 0.6);
  iniciosPasos(g).forEach((f, i) => { const t0 = cuerpo + s(f); if (i) M.tic(t0, 0.7, 0.2); M.pop(t0 + 0.02, ESCALA[i % 6] + (i >= 6 ? 12 : 0), 0.55); });
  M.whoosh(cierre, 0.9); M.golpe(cierre, 0.7);
  [57, 64, 69, 72].forEach((m) => M.nota(DUR - 3.4, m, 3.0, 0.03, 0, 0.6));
  M.escribir(join(ROOT, 'public', 'tutoriales', `${g.id}-crudo.wav`), join(ROOT, 'public', 'tutoriales', `${g.id}.wav`));
  rmSync(join(ROOT, 'public', 'tutoriales', `${g.id}-crudo.wav`), { force: true });
  console.log(`✓ public/tutoriales/${g.id}.wav: ${DUR.toFixed(1)} s, ${g.pasos.length} pasos`);
}
