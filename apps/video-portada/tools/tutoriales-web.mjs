// Del render de cada video explicativo (out/tutoriales/<id>.mp4) saca la versión para la web: 1080p con sonido,
// pensada para texto de interfaz (-tune animation), y un póster JPG de la portada del video. Las deja en
// out/web/<id>/ y, si la app ya tiene su carpeta en DESTINOS, las copia ahí como video/como-se-usa.{mp4,jpg}.
// Uso: node tools/tutoriales-web.mjs [id …]   (sin argumentos: los siete)
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = join(ROOT, '..');
// la carpeta estática de cada app (lo que se publica tal cual)
export const DESTINOS = {
  sensei: 'sensei/site', dojo: 'taller-ai/site', tablero: 'tablero-demo/web', transformer: 'transformer-lab/public',
  atlas: 'atlas-arquitecturas/web', ronda: 'ml-system-design/web', hojas: 'cheat-sheets/site',
};
const pedidos = process.argv.slice(2);
for (const id of Object.keys(DESTINOS).filter((x) => !pedidos.length || pedidos.includes(x))) {
  const maestro = join(ROOT, 'out', 'tutoriales', `${id}.mp4`);
  if (!existsSync(maestro)) { console.error(`✗ ${id}: falta ${maestro} (corre node tools/tutoriales.mjs ${id})`); process.exitCode = 1; continue; }
  const out = join(ROOT, 'out', 'web', id); mkdirSync(out, { recursive: true });
  const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', maestro, ...a], { stdio: 'inherit' });
  ff('-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-tune', 'animation', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', join(out, 'como-se-usa.mp4'));
  ff('-ss', '3.2', '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '4', join(out, 'como-se-usa.jpg'));
  const mb = (f) => (statSync(f).size / 1e6).toFixed(1);
  console.log(`✓ ${id}: ${mb(join(out, 'como-se-usa.mp4'))} MB, póster ${mb(join(out, 'como-se-usa.jpg'))} MB`);
  if (DESTINOS[id]) {
    const d = join(APPS, DESTINOS[id], 'video'); mkdirSync(d, { recursive: true });
    for (const f of ['como-se-usa.mp4', 'como-se-usa.jpg']) copyFileSync(join(out, f), join(d, f));
    console.log(`  → apps/${DESTINOS[id]}/video/`);
  }
}
