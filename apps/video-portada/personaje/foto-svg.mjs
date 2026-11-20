// PNG de un SVG con Chromium: node personaje/foto-svg.mjs <entrada.svg> <salida.png> [escala]
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const [,, entrada, salida, escala = '1'] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/Users/erikpalacios/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const p = await b.newPage({ viewport: { width: 1300, height: 820 }, deviceScaleFactor: +escala });
await p.goto('file://' + resolve(entrada));
await p.screenshot({ path: salida });
await b.close();
