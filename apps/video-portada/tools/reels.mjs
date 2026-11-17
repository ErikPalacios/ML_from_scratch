// Produce los reels de Instagram en out/reels/: la pista de cada uno, el video (1080×1920, H.264 + AAC),
// la portada sugerida (PNG del frame `portada` de src/reels/reels.json) y el texto de la publicación
// (src/reels/textos/<id>.txt). El reel 01 es la composición Instagram (el video completo).
// Uso: node tools/reels.mjs [id …]   (sin argumentos: los siete)
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = JSON.parse(readFileSync(join(ROOT, 'src', 'reels', 'reels.json'), 'utf8'));
const OUT = join(ROOT, 'out', 'reels');
mkdirSync(OUT, { recursive: true });
const todos = [{ id: '01-recorrido', comp: 'Instagram', portada: 120 }, ...R.reels.map((r) => ({ id: r.id, comp: `Reel-${r.id}`, portada: r.portada }))];
const pedidos = process.argv.slice(2);
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

for (const r of todos.filter((x) => !pedidos.length || pedidos.includes(x.id))) {
  if (r.comp === 'Instagram') run('node', ['tools/sonido.mjs']);
  else run('node', ['tools/sonido-reel.mjs', r.id]);
  run('npx', ['remotion', 'render', 'src/index.ts', r.comp, join(OUT, `${r.id}.mp4`), '--codec', 'h264', '--crf', '18', '--audio-codec', 'aac', '--audio-bitrate', '192k', '--log=error']);
  run('npx', ['remotion', 'still', 'src/index.ts', r.comp, join(OUT, `${r.id}-portada.png`), `--frame=${r.portada}`, '--log=error']);
  copyFileSync(join(ROOT, 'src', 'reels', 'textos', `${r.id}.txt`), join(OUT, `${r.id}.txt`));
  console.log(`✓ out/reels/${r.id}.mp4`);
}
