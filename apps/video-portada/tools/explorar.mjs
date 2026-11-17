// Toma capturas rápidas de páginas candidatas (para decidir qué grabar).
// Uso: node tools/explorar.mjs <carpeta> [nombre=url ...]   (sin pares: la portada de cada app)
import { abrir } from './navegador.mjs';
import { APPS } from './apps.mjs';

const [out, ...pares] = process.argv.slice(2);
const lista = pares.length ? pares.map((p) => p.split(/=(.*)/s).slice(0, 2)) : Object.entries(APPS);
const b = await abrir();
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' });
for (const [k, u] of lista) {
  const p = await ctx.newPage();
  try {
    await p.goto(u, { waitUntil: 'load', timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}/${k}.png`, fullPage: process.env.FULL === '1' });
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    console.log(k, 'alto', h);
  } catch (e) { console.log(k, 'ERR', e.message); }
  await p.close();
}
await b.close();
