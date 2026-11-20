// PNG de un SVG con Chromium: node personaje/foto-svg.mjs <entrada.svg> <salida.png> [escala]
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const [,, entrada, salida, escala = '1'] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/Users/erikpalacios/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const tag = readFileSync(entrada, 'utf8').match(/<svg[^>]*>/)[0];
const w = +tag.match(/width="(\d+)"/)[1], h = +tag.match(/height="(\d+)"/)[1];
const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: +escala });
await p.goto('file://' + resolve(entrada));
await p.screenshot({ path: salida });
await b.close();
