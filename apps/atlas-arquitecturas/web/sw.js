/* Basado en apps/ml-system-design/web/sw.js.
   Service worker de la versión web (Vercel): hace que la app abra sin conexión después de la
   primera visita. No se usa en el Artifact de claude.ai ni al abrir el HTML con doble clic.
   build-web.mjs reemplaza el marcador de BUILD por un hash del build (cada deploy instala un service
   worker nuevo, guarda la página nueva y borra la caché anterior) y agrega el Laboratorio (lab/)
   a la precarga cuando existe. MathJax (cdnjs) y las fuentes van en una caché aparte que sobrevive
   entre deploys (stale-while-revalidate): las fórmulas funcionan sin conexión desde la segunda visita. */
'use strict';
const BUILD = '__BUILD__';
const CACHE = 'atlas-app-' + BUILD;
const RUNTIME = 'atlas-runtime'; // fuentes + MathJax: no cambian entre deploys
const CORE = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png', /*__EXTRA__*/];
const NAV_TIMEOUT_MS = 4000; // con mala señal, después de 4 s se usa la copia guardada

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('atlas-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Página (la app o el Laboratorio): primero la red, con tope de tiempo; si falla, la copia guardada.
async function navigate(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  const isLab = /\/lab\/(index\.html)?$/.test(url.pathname);
  const key = isLab ? './lab/' : './';
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(key)) || (await cache.match(request)) || Response.error();
  }
}

// Fuentes de Google y MathJax: la copia guardada al instante y se actualiza por detrás.
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
  // MathJax 3 desde cdnjs (el script y los módulos que carga a pedido, p. ej. extensiones de TeX)
  if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.indexOf('/ajax/libs/mathjax/') === 0) { event.respondWith(staleWhileRevalidate(req)); return; }
  if (url.origin === self.location.origin) {
    // íconos y manifest: de la caché si están; si no, de la red
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
  // todo lo demás (enlaces externos del contenido) va directo a la red
});
