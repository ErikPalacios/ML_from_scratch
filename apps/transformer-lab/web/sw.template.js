/* Service worker del Laboratorio Transformer (solo en la versión web de Vercel: `node build.mjs --web`).
   Basado en el del Atlas. Hace que el laboratorio abra sin conexión después de la primera visita:
   - la página se guarda en una caché por build (cada deploy instala un service worker nuevo y borra la anterior);
   - MathJax (cdnjs) y las fuentes de Google van en una caché aparte, stale-while-revalidate, y se precargan al
     instalar (sin bloquear la instalación si falla) para que las fórmulas funcionen sin red desde la primera visita.
   build.mjs reemplaza el marcador de BUILD por un hash y el de RUNTIME por los recursos externos que carga el HTML. */
'use strict';
const BUILD = '__BUILD__';
const CACHE = 'lab-app-' + BUILD;
const RUNTIME = 'lab-runtime'; // fuentes + MathJax: no cambian entre deploys
const RUNTIME_URLS = [/*__RUNTIME__*/];
const NAV_TIMEOUT_MS = 4000; // con mala señal, después de 4 s se usa la copia guardada
const WARM_TIMEOUT_MS = 8000;
const tfetch = (u, o) => Promise.race([fetch(u, o), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), WARM_TIMEOUT_MS))]);

async function warmRuntime() {
  try {
    const cache = await caches.open(RUNTIME);
    await Promise.all(RUNTIME_URLS.map(async (u) => {
      try {
        if (await cache.match(u)) return;
        const css = /^https:\/\/fonts\.googleapis\.com\//.test(u);
        const res = await tfetch(u, { mode: css ? 'cors' : 'no-cors', credentials: 'omit' });
        if (!res.ok && res.type !== 'opaque') return;
        await cache.put(u, res.clone());
        if (!css) return;
        const files = Array.from((await res.text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)/g), (m) => m[1]);
        await Promise.all(files.map(async (f) => {
          try { if (!(await cache.match(f))) { const r = await tfetch(f, { mode: 'cors', credentials: 'omit' }); if (r.ok) await cache.put(f, r); } } catch (e) { /* sin red */ }
        }));
      } catch (e) { /* sin red: se cachea en la próxima visita */ }
    }));
  } catch (e) { /* Cache API no disponible */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./'])).then(() => warmRuntime()).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lab-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página: primero la red (con tope de tiempo, para ver siempre la versión nueva); si falla, la copia guardada.
async function navigate(request) {
  const cache = await caches.open(CACHE);
  const isApp = /\/(index\.html|transformer-lab\.html)?$/.test(new URL(request.url).pathname);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS))]);
    if (res.ok && isApp) cache.put('./', res.clone());
    return res;
  } catch (e) {
    return (await cache.match('./')) || (await cache.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);
  const net = fetch(request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) { event.respondWith(navigate(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(staleWhileRevalidate(req)); return; }
  if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.indexOf('/ajax/libs/mathjax/') === 0) { event.respondWith(staleWhileRevalidate(req)); return; }
  // lo demás (og.png, robots, sitemap) va directo a la red
});
