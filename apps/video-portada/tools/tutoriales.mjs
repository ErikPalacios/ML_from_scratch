// Produce los videos explicativos en out/tutoriales/: la pista de cada uno, el video (1920×1080, H.264 + AAC)
// y un póster (PNG de la portada del video). Uso: node tools/tutoriales.mjs [id …]   (sin argumentos: los siete)
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out', 'tutoriales');
mkdirSync(OUT, { recursive: true });
const TODOS = ['sensei', 'dojo', 'tablero', 'transformer', 'atlas', 'ronda', 'hojas'];
const pedidos = process.argv.slice(2);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

for (const id of TODOS.filter((x) => !pedidos.length || pedidos.includes(x))) {
  run('node', ['tools/sonido-tutorial.mjs', id]);
  run('npx', ['remotion', 'render', 'src/index.ts', `Tutorial-${id}`, join(OUT, `${id}.mp4`), '--codec', 'h264', '--crf', '20', '--audio-codec', 'aac', '--audio-bitrate', '160k', '--log=error']);
  run('npx', ['remotion', 'still', 'src/index.ts', `Tutorial-${id}`, join(OUT, `${id}-poster.png`), '--frame=90', '--log=error']);
  console.log(`✓ out/tutoriales/${id}.mp4`);
}
