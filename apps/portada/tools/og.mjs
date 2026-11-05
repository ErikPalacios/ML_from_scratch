#!/usr/bin/env node
// Genera las imágenes para redes (1200×630) con Chrome sin ventana. Salidas:
//   apps/portada/src/og.png, apps/ml-system-design/web/og.png, apps/atlas-arquitecturas/web/og.png,
//   apps/transformer-lab/public/og.png, apps/cheat-sheets/site/og.png, apps/tablero-demo/web/og.png, apps/taller-ai/site/og.png,
//   apps/sensei/site/og.png
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
  { out: 'ml-system-design/web/og.png', etapas: 'todas', kicker: 'Curso y simulador', title: 'Ronda de Diseño ML', sub: 'Todo lo que rodea al modelo en producción, como lo evalúa un entrevistador', foot: 'TrueML · ronda-diseno-ml.vercel.app' },
  { out: 'cheat-sheets/site/og.png', etapas: ['api', 'contenedor', 'orquestacion', 'monitoreo'], kicker: 'Hojas de estudio', title: 'Cheat sheets ML', sub: 'Docker, Kubernetes, Git, Triton, FastAPI, Prometheus y vLLM, con PDF y revisores', foot: 'TrueML · cheat-sheets-ml.vercel.app' },
  { out: 'atlas-arquitecturas/web/og.png', etapas: ['modelo'], kicker: 'Arquitecturas a nivel 2', title: 'Atlas de Arquitecturas', sub: 'Diagramas, matemáticas y dimensiones de los modelos que preguntan en entrevistas', foot: 'TrueML · atlas-arquitecturas.vercel.app' },
  { out: 'tablero-demo/web/og.png', etapas: 'todas', kicker: 'Demo en vivo', title: 'ML Board', sub: 'Cada proyecto como un mapa del dato al monitoreo, con cálculos de entrada que se verifican', foot: 'TrueML · tablero-ml-demo.vercel.app' },
  { out: 'taller-ai/site/og.png', etapas: 'todas', kicker: 'Entrenamiento práctico', title: 'Dojo de entrenamiento ML engineer\'s', sub: 'Mini-proyectos en tu Mac: los construyes, los rehaces y los arreglas cuando se rompen', foot: 'TrueML · taller-ai-engineer.vercel.app' },
  { out: 'sensei/site/og.png', etapas: 'todas', kicker: 'Teoría desde cero', title: 'Sensei', sub: 'Lo que hay detrás de poner un modelo en producción, explicado desde cero, con diagramas y el mismo caso del Dojo', foot: 'TrueML · sensei-ml.vercel.app' },
  { out: 'transformer-lab/public/og.png', etapas: ['datos', 'modelo'], kicker: 'Laboratorio', title: 'Laboratorio Transformer', sub: 'Un transformer pequeño entrenándose paso a paso: cada matriz, fórmula y gradiente', foot: 'TrueML · laboratorio-transformer.vercel.app' },
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
// Cada herramienta, con la misma marca: fondo de cuadrícula, la franja, su nombre y la T con sus etapas encendidas.
const paginaApp = (i) => `<!doctype html><meta charset="utf-8"><style>
:root{--tm-ink:#0E1530;--tm-ink2:#3A4364;--tm-ink3:#5A6385;--tm-lead:#9AA2C0}
html,body{margin:0;width:1200px;height:630px}
body{background:#EDEFF7;color:#0E1530;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;grid-template-columns:1fr 400px;gap:32px;padding:64px 64px 56px 72px;box-sizing:border-box;
background-image:linear-gradient(rgba(14,21,48,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(14,21,48,.055) 1px,transparent 1px);background-size:32px 32px}
.c{display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.k{display:inline-block;font:600 20px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#3D5AFE;background:#fff;padding:12px 18px;border-radius:999px}
h1{font:800 ${i.title.length > 26 ? 70 : 84}px/.98 system-ui,-apple-system,sans-serif;letter-spacing:-.045em;margin:30px 0 22px;text-wrap:balance}
p{font-size:28px;line-height:1.38;color:#3A4364;margin:0;text-wrap:pretty}
.f{display:flex;align-items:center;gap:12px;font:600 20px/1 ui-monospace,Menlo,monospace;color:#0E1530;white-space:nowrap}
.f b{font:800 22px/1 system-ui,sans-serif;letter-spacing:-.04em}.f b span{color:#3D5AFE}
.f i{width:1px;height:20px;background:#C9CEE0}
.t{display:flex;align-items:center;justify-content:center}
.s{position:fixed;left:0;right:0;top:0;height:10px;display:grid;grid-template-columns:repeat(6,1fr)}
</style><div class="s"><i style="background:#E8AE36"></i><i style="background:#EC6A3F"></i><i style="background:#17B386"></i><i style="background:#3D5AFE"></i><i style="background:#7A69EE"></i><i style="background:#5A6699"></i></div>
<div class="c"><div><div class="k">${esc(i.kicker)}</div><h1>${esc(i.title)}</h1><p>${esc(i.sub)}</p></div><div class="f"><b>True<span>ML</span></b><i></i>${esc(i.foot.replace(/^TrueML · /, ''))}</div></div>
<div class="t">${marca({ etiquetas: true, encender: i.etapas === 'todas' ? null : i.etapas, maxAltura: '500px' })}</div>`;
const page = (i) => (i.trueml ? paginaTrueML(i) : paginaApp(i));
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
