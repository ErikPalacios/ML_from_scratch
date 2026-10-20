/* Service worker del sitio: la portada y las hojas abren sin conexión después de la primera visita.
   tools/build.mjs reemplaza el marcador de BUILD por un hash del contenido y el de PAGES por la lista de páginas:
   cada deploy nuevo instala un service worker nuevo, guarda las páginas nuevas y borra la caché anterior. */
'use strict';
const BUILD = '__BUILD__';
const CACHE = 'hojas-' + BUILD;
const FONTS = 'hojas-fonts'; // las fuentes no cambian entre deploys: caché aparte que sobrevive
const CDN = 'hojas-cdn'; // scripts de cdnjs (js-yaml del revisor de Kubernetes): la versión va en la URL, también sobrevive
const PAGES = __PAGES__;
const CORE = PAGES.concat(['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']);
const NAV_TIMEOUT_MS = 4000; // con mala señal, después de 4 s se usa la copia guardada

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('hojas-') && k !== CACHE && k !== FONTS && k !== CDN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Páginas y PDF: primero la red (para ver la versión más nueva); si falla o una página tarda más
// del tope, la copia guardada. Sin copia, se espera a la red. Cada respuesta buena se guarda,
// así un PDF que abriste una vez queda disponible sin conexión.
async function networkFirst(request, timeoutMs) {
  const cache = await caches.open(CACHE);
  const net = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; });
  net.catch(() => {}); // si gana la copia guardada, un fallo posterior de la red no es un error sin manejar
  try {
    if (!timeoutMs) return await net;
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))]);
  } catch (e) {
    const url = new URL(request.url);
    const hit = (await cache.match(request, { ignoreSearch: true }))
      || (!url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname) ? await cache.match(url.pathname + '/') : undefined);
    if (hit) return hit;
    try { return await net; } catch (e2) { return Response.error(); }
  }
}

// Fuentes de Google y scripts de cdnjs: la copia guardada al instante y se actualiza por detrás (stale-while-revalidate).
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
  if (url.hostname === 'cdnjs.cloudflare.com' && req.destination === 'script') { event.respondWith(swr(req, CDN)); return; }
  if (url.origin !== self.location.origin) return; // enlaces externos del contenido: directo a la red
  if (url.pathname.endsWith('.pdf')) { event.respondWith(networkFirst(req, 0)); return; } // sin tope: pesan MB
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req, NAV_TIMEOUT_MS)); return; }
  // íconos y manifest: de la caché si están; si no, de la red
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
