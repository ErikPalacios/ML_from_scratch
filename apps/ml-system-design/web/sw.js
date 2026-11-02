/* Service worker de la versión web (Vercel): hace que la app abra sin conexión después de la
   primera visita. No se usa en el Artifact de claude.ai ni al abrir el HTML con doble clic.
   build-web.mjs reemplaza el marcador de BUILD por un hash del index.html: cada deploy nuevo instala un
   service worker nuevo, guarda la página nueva y borra la caché anterior. */
'use strict';
const BUILD = '__BUILD__';
const CACHE = 'ronda-app-' + BUILD;
const FONTS = 'ronda-fonts'; // las fuentes no cambian entre deploys: caché aparte que sobrevive
const CORE = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const NAV_TIMEOUT_MS = 4000; // con mala señal, después de 4 s se usa la copia guardada

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ronda-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Página: primero la red (para ver la versión más nueva), con tope de tiempo; si falla, la copia guardada.
async function navigate(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put('./', res.clone());
    return res;
  } catch (e) {
    return (await cache.match('./')) || (await cache.match(request)) || Response.error();
  }
}

// Fuentes de Google: la copia guardada al instante y se actualiza por detrás (stale-while-revalidate).
async function font(request) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(request);
  const net = fetch(request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) { event.respondWith(navigate(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { event.respondWith(font(req)); return; }
  if (url.origin === self.location.origin) {
    // íconos y manifest: de la caché si están; si no, de la red
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
  // todo lo demás (enlaces externos del contenido) va directo a la red
});
