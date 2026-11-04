#!/usr/bin/env node
// Los íconos de cada app con la marca TrueML: la T de vidrio sobre azul marino, con las etapas de la app encendidas.
// Escribe icon.svg (esquinas redondeadas, para la pestaña) y, donde la app ya los tiene, icon-192.png, icon-512.png y
// apple-touch-icon.png (cuadrados a sangre: iOS y Android recortan sus propias esquinas; la T queda dentro de la zona
// segura del 80 %). Los PNG salen de Google Chrome sin ventana.
//
//   node apps/trueml/iconos.mjs            todas las apps
//   node apps/trueml/iconos.mjs atlas      solo las que contienen ese texto
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { marca } from './lib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APPS_DIR = join(AQUI, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NAVY = '#0E1530';

// carpeta con los íconos de cada app → etapas que enciende (null = las seis)
const APPS = [
  ['portada/src', null],
  ['taller-ai/site', null],
  ['cimientos/site', null],
  ['ml-system-design/web', null],
  ['tablero-ml/web', null],
  ['atlas-arquitecturas/web', ['modelo']],
  ['cheat-sheets/site', ['api', 'contenedor', 'orquestacion', 'monitoreo']],
  ['transformer-lab/public', ['datos', 'modelo']],
];

// La T dentro de un cuadrado de 512: `escala` es la fracción del alto que ocupa.
function icono(encender, { redondo, escala }) {
  const t = marca({ encender, dim: 0.22 }).replace(/^<svg /, '<svg x="0" y="0" ');
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(t);
  const [, , , w, h] = vb.map(Number);
  const alto = 512 * escala, ancho = alto * (w / h);
  const x = (512 - ancho) / 2, y = (512 - alto) / 2 + 512 * 0.02;
  const dentro = t.replace(/width="100%"/, `width="${ancho.toFixed(1)}" height="${alto.toFixed(1)}"`).replace(/x="0" y="0"/, `x="${x.toFixed(1)}" y="${y.toFixed(1)}"`)
    .replace(/ style="[^"]*"/, '').replace(/ role="img" aria-label="TrueML"/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>TrueML</title>`
    + `<rect width="512" height="512"${redondo ? ' rx="112"' : ''} fill="${NAVY}"/>${dentro}</svg>`;
}

const solo = process.argv[2];
const tmp = join(tmpdir(), 'iconos-' + process.pid);
mkdirSync(tmp, { recursive: true });
for (const [carpeta, encender] of APPS) {
  if (solo && !carpeta.includes(solo)) continue;
  const dir = join(APPS_DIR, carpeta);
  writeFileSync(join(dir, 'icon.svg'), icono(encender, { redondo: true, escala: 0.8 }) + '\n');
  const pngs = [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]].filter(([f]) => existsSync(join(dir, f)));
  if (pngs.length) {
    const svg = icono(encender, { redondo: false, escala: 0.66 });
    for (const [f, px] of pngs) {
      const html = join(tmp, f + '.html');
      writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:${NAVY}}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
        `--window-size=${px},${px}`, '--screenshot=' + join(dir, f), 'file://' + html], { stdio: 'ignore' });
    }
  }
  console.log(`[iconos] ${carpeta}: icon.svg${pngs.map(([f]) => ' · ' + f).join('')}`);
}
rmSync(tmp, { recursive: true, force: true });
