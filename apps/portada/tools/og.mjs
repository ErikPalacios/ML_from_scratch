#!/usr/bin/env node
// Genera las imágenes para redes (1200×630) con Chrome sin ventana. Salidas:
//   apps/portada/src/og.png, apps/ml-system-design/web/og.png, apps/atlas-arquitecturas/web/og.png,
//   apps/transformer-lab/public/og.png, apps/cheat-sheets/site/og.png, apps/tablero-demo/web/og.png, apps/taller-ai/site/og.png
// Uso: node tools/og.mjs              (todas; necesita Google Chrome en /Applications)
//      node tools/og.mjs taller-ai    (solo las salidas que contienen ese texto)
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const APPS = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const IMAGES = [
  { out: 'portada/src/og.png', trueml: true, kicker: '6 etapas · del dato al monitoreo', title: 'TrueML', sub: 'Herramientas gratuitas para prepararte como ML Engineer: un dojo, un curso, hojas de estudio y laboratorios', foot: 'Gratis · sin cuenta · funciona sin conexión' },
  { out: 'ml-system-design/web/og.png', kicker: 'Curso y simulador', title: 'Ronda de Diseño ML', sub: 'Todo lo que rodea al modelo en producción, como lo evalúa un entrevistador', foot: 'ML desde cero · ronda-diseno-ml.vercel.app' },
  { out: 'cheat-sheets/site/og.png', kicker: 'Hojas de estudio', title: 'Cheat sheets ML', sub: 'Docker, Kubernetes, Git, Triton, FastAPI, Prometheus y vLLM, con PDF y revisores', foot: 'ML desde cero · cheat-sheets-ml.vercel.app' },
  { out: 'atlas-arquitecturas/web/og.png', kicker: 'Arquitecturas a nivel 2', title: 'Atlas de Arquitecturas', sub: 'Diagramas, matemáticas y dimensiones de los modelos que preguntan en entrevistas', foot: 'ML desde cero · atlas-arquitecturas.vercel.app' },
  { out: 'tablero-demo/web/og.png', kicker: 'Demo en vivo', title: 'ML Board', sub: 'Cada proyecto como un mapa del dato al monitoreo, con cálculos de entrada que se verifican', foot: 'ML desde cero · tablero-ml-demo.vercel.app' },
  { out: 'taller-ai/site/og.png', kicker: 'Entrenamiento práctico', title: 'Taller de AI Engineer', sub: 'Mini-proyectos en tu Mac: los construyes, los rehaces y los arreglas cuando se rompen', foot: 'ML desde cero · taller-ai-engineer.vercel.app' },
  { out: 'transformer-lab/public/og.png', kicker: 'Laboratorio', title: 'Laboratorio Transformer', sub: 'Un transformer pequeño entrenándose paso a paso: cada matriz, fórmula y gradiente', foot: 'ML desde cero · laboratorio-transformer.vercel.app' },
];
// La portada usa la marca TrueML: fondo claro de cuadrícula y la T de vidrio del sistema de diseño compartido.
const { marca } = await import('../vendor/trueml/lib.mjs');
const paginaTrueML = (i) => `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px}
body{background:#EDEFF7;color:#0E1530;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:1fr 470px;gap:24px;padding:64px 72px;box-sizing:border-box;
background-image:linear-gradient(rgba(14,21,48,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(14,21,48,.055) 1px,transparent 1px);background-size:32px 32px}
.c{display:flex;flex-direction:column;justify-content:space-between}
.k{align-self:flex-start;font:600 20px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#3D5AFE;background:#fff;padding:12px 18px;border-radius:999px}
h1{font:800 150px/.9 system-ui,-apple-system,sans-serif;letter-spacing:-.055em;margin:28px 0 22px}h1 span{color:#3D5AFE}
p{font-size:30px;line-height:1.35;color:#3A4364;margin:0}
.f{font:600 20px/1 ui-monospace,Menlo,monospace;color:#0E1530;white-space:nowrap}
.t{display:flex;align-items:center;justify-content:center}
.s{position:fixed;left:0;right:0;top:0;height:10px;display:grid;grid-template-columns:repeat(6,1fr)}
</style><div class="s"><i style="background:#E8AE36"></i><i style="background:#EC6A3F"></i><i style="background:#17B386"></i><i style="background:#3D5AFE"></i><i style="background:#7A69EE"></i><i style="background:#5A6699"></i></div>
<div class="c"><div><div class="k">${esc(i.kicker)}</div><h1>True<span>ML</span></h1><p>${esc(i.sub)}</p></div><div class="f">${esc(i.foot)}</div></div><div class="t">${marca({ maxAltura: '500px' })}</div>`;
const page = (i) => i.trueml ? paginaTrueML(i) : `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px}
body{background:#0e131a;color:#e5ecf4;font-family:-apple-system,"SF Pro Display",Helvetica,Arial,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:72px 80px;box-sizing:border-box;
background-image:linear-gradient(rgba(125,175,240,.085) 1px,transparent 1px),linear-gradient(90deg,rgba(125,175,240,.085) 1px,transparent 1px);background-size:40px 40px}
.k{font-size:26px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7db1ff}
h1{font-size:${i.title.length > 30 ? 76 : 92}px;line-height:1.05;margin:20px 0 24px;letter-spacing:-.025em}
p{font-size:32px;line-height:1.35;color:#9aa7b7;margin:0;max-width:980px}
.f{font-size:26px;color:#f2c14e;font-weight:600}
</style><div><div class="k">${esc(i.kicker)}</div><h1>${esc(i.title)}</h1><p>${esc(i.sub)}</p></div><div class="f">${esc(i.foot)}</div>`;
const tmp = join(tmpdir(), 'og-' + process.pid); mkdirSync(tmp, { recursive: true });
const solo = process.argv[2];
for (const [n, img] of IMAGES.entries()) {
  if (solo && !img.out.includes(solo)) continue;
  const html = join(tmp, n + '.html'); writeFileSync(html, page(img));
  const out = join(APPS, img.out); mkdirSync(dirname(out), { recursive: true });
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', '--screenshot=' + out, 'file://' + html], { stdio: 'ignore' });
  console.log('[og]', img.out);
}
rmSync(tmp, { recursive: true, force: true });
