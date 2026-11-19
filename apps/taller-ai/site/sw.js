/* Service worker del Dojo: la portada y las estaciones abren sin conexión después de la primera visita.
   tools/build.mjs reemplaza __BUILD__ por el hash del contenido y __PAGES__ por la lista de archivos: cada deploy
   nuevo instala un service worker nuevo, guarda lo nuevo y borra la caché anterior. Los kits (.zip) no se
   guardan por adelantado: se bajan de la red cuando los pides. El video de la portada (.mp4) no se guarda nunca. */
'use strict';
const BUILD = '__BUILD__';
const CACHE = 'taller-' + BUILD;
const FONTS = 'taller-fonts'; // las fuentes no cambian entre deploys: caché aparte que sobrevive
const CORE = __PAGES__;
const NAV_TIMEOUT_MS = 4000; // con mala señal, después de 4 s se usa la copia guardada

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('taller-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
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

async function swr(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const net = fetch(request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(swr(req, FONTS)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.zip')) return; // los kits van directo a la red
  if (url.pathname.endsWith('.mp4')) return; // el video también: la caché rompe las peticiones por rangos al adelantarlo
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req)); return; }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
