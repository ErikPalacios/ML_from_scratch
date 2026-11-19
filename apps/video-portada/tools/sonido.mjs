// Compone la pista del video completo con código (tools/sintes.mjs): música electrónica suave a 120 BPM en la menor
// (Am · F · C · G), con efectos sincronizados a lo que pasa en pantalla. Escribe public/sonido.wav.
// Los tiempos salen de src/tiempos.json, los mismos que usa el video.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESCALA, FPS, mezcla, tramos } from './sintes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(readFileSync(join(ROOT, 'src', 'tiempos.json'), 'utf8'));
const inicio = {}; let acc = 0;
for (const e of T.escenas) { inicio[e.id] = acc / FPS; acc += e.dur; }
const DUR = acc / FPS;
const en = (id, frame = 0) => inicio[id] + frame / FPS;
const s = (id) => inicio[id];
const M = mezcla(DUR);

// ---------------------------------------------------------------- forma del tema: cuánto suena cada capa en el tiempo
M.musica({
  pad: (t) => tramos(t, [[0, 0], [1.2, 0.55], [s('transformer'), 0.8], [DUR - 3.5, 0.8], [DUR, 0]]),
  corte: (t) => tramos(t, [[0, 300], [s('transformer') - 0.05, 2200], [s('transformer'), 1500], [s('puente'), 1500], [s('puente') + 0.2, 700], [s('sensei') - 0.1, 3200], [s('sensei'), 1600], [s('cierre'), 2600], [DUR, 900]]),
  bombo: (t) => (t >= s('transformer') && t < s('puente')) || (t >= s('sensei') && t < s('cierre') + 4) ? 1 : 0,
  bajo: (t) => (t >= s('transformer') && t < s('puente')) || (t >= s('sensei') && t < DUR - 2.5) ? 1 : 0,
  hat: (t) => (t >= s('transformer') + 4 && t < s('puente')) || (t >= s('dojo') && t < s('cierre')) ? 1 : 0,
  arpegio: (t) => tramos(t, [[0, 0], [s('atlas'), 0], [s('atlas') + 1, 0.8], [s('puente'), 0.8], [s('puente') + 0.5, 0.35], [s('sensei'), 0.9], [DUR - 2, 0.6], [DUR, 0]]),
});

// ---------------------------------------------------------------- efectos sincronizados con la imagen
const { pop, tic, golpe, subida, whoosh, nota } = M;
// 1 · la T se arma: una nota por pieza, y la subida hacia el «drop»
ESCALA.forEach((m, i) => pop(en('intro', 16 + i * 7), m, 1, -0.2 + i * 0.08));
subida(en('intro', 60), s('transformer'), 1);
// cortes con barrido
T.escenas.forEach((e) => { if (e.barrido) whoosh(inicio[e.id], T.barrido / FPS); });
golpe(s('transformer'), 0.9);
// 3 · Atlas: entra la segunda ventana
tic(en('atlas', 112), 0.8, 0.3); pop(en('atlas', 116), 76, 0.6, 0.3);
// 4 · puente: las dos tarjetas, y la subida hacia Sensei
pop(en('puente', 28), 72, 1, -0.4); pop(en('puente', 38), 76, 1, 0.4);
subida(en('puente', 60), s('sensei'), 0.9);
golpe(s('sensei'), 0.7);
// 5 · Sensei: cada punto de la lista
[40, 60, 150, 310].forEach((f, i) => tic(en('sensei', f + 4), 0.7, -0.3 + i * 0.1));
// 6 · Dojo: las seis etapas se encienden en escala, y los puntos
ESCALA.forEach((m, i) => pop(en('dojo', 64 + i * 22), m, 0.75, 0.5));
[150, 170, 190].forEach((f) => tic(en('dojo', f + 4), 0.7, 0.3));
// 7 · y además: entran las tres ventanas
[12, 28, 44].forEach((f, i) => { tic(en('ademas', f + 2), 0.7, -0.5 + i * 0.5); pop(en('ademas', f + 6), [69, 72, 76][i], 0.5, -0.5 + i * 0.5); });
// 8 · cierre: golpe, la T otra vez, y las tres garantías
golpe(s('cierre'), 1);
ESCALA.forEach((m, i) => pop(en('cierre', 10 + i * 5), m + 12, 0.6, -0.2 + i * 0.08));
[56, 65, 74].forEach((f, i) => pop(en('cierre', f + 4), [76, 79, 81][i], 1));
// acorde final largo
[57, 64, 69, 72].forEach((m) => nota(DUR - 4.5, m, 3.5, 0.03, 0, 0.6));

M.escribir(join(ROOT, 'public', 'sonido-crudo.wav'), join(ROOT, 'public', 'sonido.wav'));
console.log(`✓ public/sonido.wav: ${DUR.toFixed(2)} s, normalizado a −14 LUFS`);
