// Recorre una página larga y guarda una captura por pantalla (para encontrar los momentos vistosos).
// Uso: node tools/tira.mjs <url> <carpeta> [pantallas=12] [desde=0]
import { abrir } from './navegador.mjs';

const [url, out, n = '12', desde = '0'] = process.argv.slice(2);
const b = await abrir();
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })).newPage();
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(1500);
for (let i = 0; i < +n; i++) {
  const y = (+desde + i) * 850;
  await p.evaluate((y) => window.scrollTo(0, y), y);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/${String(i).padStart(2, '0')}.png` });
  console.log(i, y, await p.evaluate(() => [...document.querySelectorAll('h2,h3')].filter((h) => { const r = h.getBoundingClientRect(); return r.top > 0 && r.top < 900; }).map((h) => h.textContent.trim().slice(0, 50)).join(' | ')));
}
await b.close();
