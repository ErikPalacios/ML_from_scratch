// Lista los elementos interactivos de una página con su posición (para escribir las tomas).
// Uso: node tools/sondear.mjs <url> [filtro]
import { abrir } from './navegador.mjs';

const [url, filtro = ''] = process.argv.slice(2);
const b = await abrir();
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' })).newPage();
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(1500);
const filas = await p.evaluate((filtro) => {
  const sy = (el) => Math.round(el.getBoundingClientRect().top + scrollY);
  const sel = (el) => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  return [...document.querySelectorAll('h2,h3,button,input,select,[role=slider],canvas,svg[class],figure,[data-term],abbr,.calc,[class*=calc]')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => `${sy(el)}\t${el.tagName.toLowerCase()}\t${sel(el)}\t${(el.textContent || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 70)}`)
    .filter((l) => !filtro || l.toLowerCase().includes(filtro.toLowerCase()));
}, filtro);
console.log(filas.slice(0, 160).join('\n'));
await b.close();
