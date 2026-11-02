#!/usr/bin/env node
// Genera las imágenes para redes (1200×630) con Chrome sin ventana. Salidas:
//   apps/portada/src/og.png, apps/ml-system-design/web/og.png, apps/atlas-arquitecturas/web/og.png,
//   apps/transformer-lab/public/og.png, apps/cheat-sheets/site/og.png
// Uso: node tools/og.mjs   (necesita Google Chrome en /Applications)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const APPS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const IMAGES = [
  { out: 'portada/src/og.png', kicker: 'ML desde cero', title: 'Estudia ML engineering con herramientas que se usan', sub: 'Curso · hojas de estudio · atlas de arquitecturas · laboratorio Transformer', foot: 'Gratis · sin cuenta · funciona sin conexión' },
  { out: 'ml-system-design/web/og.png', kicker: 'Curso y simulador', title: 'Ronda de Diseño ML', sub: 'Todo lo que rodea al modelo en producción, como lo evalúa un entrevistador', foot: 'ML desde cero · ronda-diseno-ml.vercel.app' },
  { out: 'cheat-sheets/site/og.png', kicker: 'Hojas de estudio', title: 'Cheat sheets ML', sub: 'Docker, Kubernetes, Git, Triton, FastAPI, Prometheus y vLLM, con PDF y revisores', foot: 'ML desde cero · cheat-sheets-ml.vercel.app' },
  { out: 'atlas-arquitecturas/web/og.png', kicker: 'Arquitecturas a nivel 2', title: 'Atlas de Arquitecturas', sub: 'Diagramas, matemáticas y dimensiones de los modelos que preguntan en entrevistas', foot: 'ML desde cero · atlas-arquitecturas.vercel.app' },
  { out: 'transformer-lab/public/og.png', kicker: 'Laboratorio', title: 'Laboratorio Transformer', sub: 'Un transformer pequeño entrenándose paso a paso: cada matriz, fórmula y gradiente', foot: 'ML desde cero · laboratorio-transformer.vercel.app' },
];
const page = (i) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px}
body{background:#0e131a;color:#e5ecf4;font-family:-apple-system,"SF Pro Display",Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:72px 80px;box-sizing:border-box;
background-image:linear-gradient(rgba(125,175,240,.085) 1px,transparent 1px),linear-gradient(90deg,rgba(125,175,240,.085) 1px,transparent 1px);background-size:40px 40px}
.k{font-size:26px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7db1ff}
h1{font-size:${i.title.length > 30 ? 76 : 92}px;line-height:1.05;margin:20px 0 24px;letter-spacing:-.025em}
p{font-size:32px;line-height:1.35;color:#9aa7b7;margin:0;max-width:980px}
.f{font-size:26px;color:#f2c14e;font-weight:600}
</style><div><div class="k">${esc(i.kicker)}</div><h1>${esc(i.title)}</h1><p>${esc(i.sub)}</p></div><div class="f">${esc(i.foot)}</div>`;
const tmp = join(tmpdir(), 'og-' + process.pid); mkdirSync(tmp, { recursive: true });
for (const [n, img] of IMAGES.entries()) {
  const html = join(tmp, n + '.html'); writeFileSync(html, page(img));
  const out = join(APPS, img.out); mkdirSync(dirname(out), { recursive: true });
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--screenshot=' + out, 'file://' + html], { stdio: 'ignore' });
  console.log('[og]', img.out);
}
rmSync(tmp, { recursive: true, force: true });
