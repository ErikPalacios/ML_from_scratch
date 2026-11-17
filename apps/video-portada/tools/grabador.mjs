// Graba una toma: abre una página en Chromium, corre sus acciones en tiempo real y guarda lo que se ve como MP4.
// Usa el screencast de Chrome (CDP): cada vez que la página pinta, llega un JPEG con su marca de tiempo. Al final,
// ffmpeg arma un video a FPS fijos repitiendo cada cuadro el tiempo que estuvo en pantalla.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { abrir } from './navegador.mjs';

export const ANCHO = 1600, ALTO = 900, ESCALA = 2; // 3200×1800: deja margen para acercar la cámara sin perder nitidez
const FPS = 30;

// Desplazamiento suave dentro de la página (lo que se graba es el movimiento real, cuadro a cuadro).
export const desplazar = (p, y, ms = 1200, sel = null) => p.evaluate(([y, ms, sel]) => new Promise((ok) => {
  const el = sel ? document.querySelector(sel) : document.scrollingElement;
  const y0 = el.scrollTop, t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const paso = (t) => { const k = Math.min(1, (t - t0) / ms); el.scrollTop = y0 + (y - y0) * ease(k); k < 1 ? requestAnimationFrame(paso) : ok(); };
  requestAnimationFrame(paso);
}), [y, ms, sel]);

// Lleva un elemento a cierta altura de la ventana (0 = arriba).
export const llevar = async (p, sel, margen = 80, ms = 1200, cont = null) => {
  const y = await p.evaluate(([sel, margen, cont]) => {
    const el = document.querySelector(sel); if (!el) throw new Error('no existe ' + sel);
    const c = cont ? document.querySelector(cont) : document.scrollingElement;
    return el.getBoundingClientRect().top - (cont ? c.getBoundingClientRect().top : 0) + c.scrollTop - margen;
  }, [sel, margen, cont]);
  await desplazar(p, y, ms, cont);
};

// Cursor visible (el screencast no dibuja el del sistema): un círculo que sigue al mouse y late al hacer clic.
const CURSOR = `(() => {
  if (window.__cursor) return; const c = document.createElement('div'); window.__cursor = c;
  c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;z-index:2147483647;pointer-events:none;' +
    'background:rgba(255,200,87,.35);border:2px solid #FFC857;box-shadow:0 0 0 6px rgba(255,200,87,.12);transition:transform .15s;opacity:0';
  const pon = () => document.body && document.body.appendChild(c); document.body ? pon() : addEventListener('DOMContentLoaded', pon);
  addEventListener('mousemove', (e) => { c.style.opacity = 1; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(.7)'; }, true);
  addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
})();`;

// Mueve el mouse en una curva suave (se ve humano, no teletransportado).
export const mover = async (p, x, y, ms = 700) => {
  const desde = p.__pos || { x: ANCHO * 0.6, y: ALTO * 0.6 };
  const n = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const t = i / n, k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await p.mouse.move(desde.x + (x - desde.x) * k, desde.y + (y - desde.y) * k);
    await p.waitForTimeout(ms / n);
  }
  p.__pos = { x, y };
};
export const centro = async (p, sel) => {
  const r = await p.locator(sel).first().boundingBox(); if (!r) throw new Error('sin caja ' + sel);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
export const clic = async (p, sel, ms = 700) => { const c = await centro(p, sel); await mover(p, c.x, c.y, ms); await p.waitForTimeout(150); await p.mouse.down(); await p.waitForTimeout(90); await p.mouse.up(); };

// Arrastra un <input type=range> de su valor actual a otro, como lo haría una mano.
export const arrastrar = async (p, loc, hasta, ms = 1400) => {
  const r = await loc.boundingBox();
  const { min, max, value } = await loc.evaluate((i) => ({ min: +i.min, max: +i.max, value: +i.value }));
  const x = (v) => r.x + 8 + ((v - min) / (max - min)) * (r.width - 16);
  const y = r.y + r.height / 2;
  await mover(p, x(value), y, 700); await p.mouse.down();
  await mover(p, x(hasta), y, ms); await p.mouse.up();
};

/**
 * toma ={ nombre, url, preparar?(p) (antes de grabar), accion(p) (lo que se graba), tema?: 'dark' }
 * Devuelve la ruta del MP4 (public/capturas/<nombre>.mp4).
 */
export async function grabar(toma, carpetaSalida) {
  const b = await abrir();
  const ctx = await b.newContext({ viewport: { width: ANCHO, height: ALTO }, deviceScaleFactor: ESCALA, colorScheme: toma.tema || 'dark', reducedMotion: 'no-preference' });
  await ctx.addInitScript(CURSOR);
  const p = await ctx.newPage();
  await p.goto(toma.url, { waitUntil: 'load', timeout: 45000 });
  await p.waitForTimeout(1200);
  if (toma.preparar) await toma.preparar(p);

  const tmp = join(carpetaSalida, `.${toma.nombre}`); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const cdp = await ctx.newCDPSession(p);
  const cuadros = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const i = cuadros.length; const file = join(tmp, `${String(i).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64')); cuadros.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: ANCHO * ESCALA, maxHeight: ALTO * ESCALA, everyNthFrame: 1 });
  // Chrome solo manda cuadros cuando la página pinta: un latido invisible garantiza cuadros aunque nada se mueva.
  await p.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:2147483647'; document.body.appendChild(d); let k = 0; const f = () => { d.style.transform = `translateX(${(k ^= 1)}px)`; requestAnimationFrame(f); }; f(); });
  await p.waitForTimeout(300);
  const t0 = Date.now() / 1000;
  await toma.accion(p);
  await p.waitForTimeout(300);
  const t1 = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await b.close();

  // concat de ffmpeg: cada cuadro dura hasta que llega el siguiente
  const lista = cuadros.filter((c) => c.t >= t0 - 0.05);
  if (lista.length < 5) throw new Error(`${toma.nombre}: solo ${lista.length} cuadros`);
  let txt = '';
  lista.forEach((c, i) => { const fin = i + 1 < lista.length ? lista[i + 1].t : t1; txt += `file '${c.file}'\nduration ${Math.max(0.001, fin - c.t).toFixed(4)}\n`; });
  txt += `file '${lista.at(-1).file}'\n`;
  writeFileSync(join(tmp, 'lista.txt'), txt);
  const salida = join(carpetaSalida, `${toma.nombre}.mp4`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'lista.txt'),
    '-vf', `fps=${FPS},scale=${ANCHO * ESCALA}:${ALTO * ESCALA}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', salida]);
  rmSync(tmp, { recursive: true, force: true });
  const dur = t1 - t0;
  console.log(`✓ ${toma.nombre}: ${dur.toFixed(1)} s, ${lista.length} cuadros (${(lista.length / dur).toFixed(1)} por segundo reales)`);
  return { salida, dur };
}
