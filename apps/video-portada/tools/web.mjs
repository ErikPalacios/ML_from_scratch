// Del render maestro (out/portada.mp4) saca las versiones para la web y las deja en apps/portada/src/video/:
//   trueml-540.webm y .mp4 (el chico, en bucle en el hero, sin audio), trueml-1080.mp4 (el grande, con controles y con
//   sonido) y el póster.
import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAESTRO = join(ROOT, 'out', 'portada.mp4');
const DEST = join(ROOT, '..', 'portada', 'src', 'video');
mkdirSync(DEST, { recursive: true });
const ff = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', MAESTRO, ...a], { stdio: 'inherit' });
const web = ['-movflags', '+faststart', '-pix_fmt', 'yuv420p'];
const sin = ['-an', ...web];

ff('-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '128k', ...web, join(DEST, 'trueml-1080.mp4'));
ff('-vf', 'scale=960:540:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'high', ...sin, join(DEST, 'trueml-540.mp4'));
ff('-vf', 'scale=960:540:flags=lanczos', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-an', join(DEST, 'trueml-540.webm'));
// el póster: el gancho ya completo (la T armada y la pregunta)
ff('-ss', '4.4', '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '4', join(DEST, 'trueml-poster.jpg'));

for (const f of ['trueml-540.webm', 'trueml-540.mp4', 'trueml-1080.mp4', 'trueml-poster.jpg']) console.log(`✓ ${f}: ${(statSync(join(DEST, f)).size / 1e6).toFixed(2)} MB`);
