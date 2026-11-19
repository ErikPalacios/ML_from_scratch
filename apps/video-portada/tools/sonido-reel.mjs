// La pista de cada reel (tools/sintes.mjs), con los tiempos y efectos de src/reels/reels.json.
// Un reel tiene que enganchar desde el primer segundo: el pad y el arpegio suenan desde el frame 0, el filtro
// se abre durante el gancho y en `drop` entran bombo y bajo con un golpe. Escribe public/reels/<id>.wav.
// Uso: node tools/sonido-reel.mjs [id …]   (sin argumentos: todos)
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESCALA, FPS, mezcla, tramos } from './sintes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = JSON.parse(readFileSync(join(ROOT, 'src', 'reels', 'reels.json'), 'utf8'));
const pedidos = process.argv.slice(2);
mkdirSync(join(ROOT, 'public', 'reels'), { recursive: true });

for (const reel of R.reels.filter((r) => !pedidos.length || pedidos.includes(r.id))) {
  const total = reel.escenas.reduce((s, e) => s + e.dur, 0);
  const DUR = total / FPS, S = reel.sonido;
  const s = (f) => f / FPS;
  const cierre = s(total - reel.escenas.at(-1).dur);
  const drop = s(S.drop), hat = s(S.hat);
  const M = mezcla(DUR);
  M.musica({
    pad: (t) => tramos(t, [[0, 0.6], [drop, 0.8], [DUR - 2.5, 0.8], [DUR, 0]]),
    corte: (t) => tramos(t, [[0, 700], [drop - 0.05, 2600], [drop, 1600], [cierre, 1600], [cierre + 0.1, 2600], [DUR, 900]]),
    bombo: (t) => t >= drop && t < DUR - 2 ? 1 : 0,
    bajo: (t) => t >= drop && t < DUR - 2 ? 1 : 0,
    hat: (t) => t >= hat && t < cierre ? 1 : 0,
    arpegio: (t) => tramos(t, [[0, 0.45], [drop, 0.55], [drop + 0.5, 0.9], [DUR - 1.5, 0.5], [DUR, 0]]),
  });
  // el barrido de colores al entrar a cada escena que lo pide
  let t = 0;
  for (const e of reel.escenas) { if (e.barrido) M.whoosh(s(t), R.barrido / FPS); t += e.dur; }
  for (const ev of S.eventos) {
    const t0 = s(ev.f), g = ev.g ?? 1;
    if (ev.t === 'golpe') M.golpe(t0, g);
    else if (ev.t === 'tic') M.tic(t0, g * 0.8, 0.2);
    else if (ev.t === 'pop') M.pop(t0, ev.m, g);
    else if (ev.t === 'subida') M.subida(t0, s(ev.a), g);
    // una nota por pieza de la T, de datos a monitoreo
    else if (ev.t === 'escala') ESCALA.forEach((m, i) => M.pop(t0 + s(i * ev.paso), m + (ev.m ?? 0), g, -0.3 + i * 0.12));
    // los siete pasos de la Ronda: la escala y una nota más arriba
    else if (ev.t === 'escala7') [...ESCALA, 84].forEach((m, i) => M.pop(t0 + s(i * ev.paso), m, g * 0.8, -0.3 + i * 0.1));
    // las nueve hojas que caen
    else if (ev.t === 'baraja') for (let i = 0; i < 9; i++) { M.tic(t0 + s(i * ev.paso), 0.7, -0.4 + i * 0.1); M.pop(t0 + s(i * ev.paso), ESCALA[i % 6] + (i >= 6 ? 12 : 0), 0.45); }
    // el reloj: un tic por segundo, más fuerte cada dos
    else if (ev.t === 'reloj') for (let f = ev.f; f < ev.a; f += 15) M.tic(s(f), (f / 15) % 2 ? 0.5 : 0.9, (f / 15) % 2 ? 0.3 : -0.3);
    else throw new Error(`efecto desconocido: ${ev.t}`);
  }
  // acorde final largo
  [57, 64, 69, 72].forEach((m) => M.nota(DUR - 3.2, m, 2.8, 0.03, 0, 0.6));
  M.escribir(join(ROOT, 'public', 'reels', `${reel.id}-crudo.wav`), join(ROOT, 'public', 'reels', `${reel.id}.wav`));
  console.log(`✓ public/reels/${reel.id}.wav: ${DUR.toFixed(2)} s`);
}
