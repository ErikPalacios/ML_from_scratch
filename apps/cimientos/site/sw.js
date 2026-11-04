/* Service worker de Cimientos: la portada, las lecciones y el glosario abren sin conexión después de la primera visita.
   tools/build.mjs reemplaza __BUILD__ por el hash del contenido y __PAGES__ por la lista de archivos: cada deploy
   nuevo instala un service worker nuevo, guarda lo nuevo y borra la caché anterior. */
'use strict';
const BUILD = '__BUILD__';
const CACHE = 'cimientos-' + BUILD;
const CORE = __PAGES__;
const NAV_TIMEOUT_MS = 4000; // con mala señal, después de 4 s se usa la copia guardada

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cimientos-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Páginas: primero la red, para ver la versión más nueva; si falla o tarda más del tope, la copia guardada.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const net = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; });
  net.catch(() => {});
  try {
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS))]);
  } catch (e) {
    const url = new URL(request.url);
    const hit = (await cache.match(request, { ignoreSearch: true }))
      || (!url.pathname.endsWith('/') ? await cache.match(url.pathname + '/') : undefined);
    if (hit) return hit;
    try { return await net; } catch (e2) { return Response.error(); }
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req)); return; }
  // solo en la caché de Cimientos: si el mismo origen tuvo otra app (localhost), sus archivos no se cuelan
  event.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || fetch(req)));
});
