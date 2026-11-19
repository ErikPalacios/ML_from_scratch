/* Service worker del tablero: la página abre sin conexión después de la primera visita.
   tools/build.mjs reemplaza el marcador de BUILD por un hash del contenido y el de ASSETS por la lista de archivos:
   cada deploy nuevo instala un service worker nuevo y borra la caché anterior.
   Las letras son las del sistema (TrueML): no hay fuentes externas que guardar.
   Los datos NO pasan por aquí: /api/* va siempre a la red y la copia de los proyectos vive en localStorage (js/sync.js). */
'use strict';
// Mudanza a trueml.app (noviembre de 2026): en la dirección *.vercel.app vieja este service worker no guarda nada,
// borra su caché, se da de baja y recarga la página; la recarga va a la red y vercel.json la lleva a /mudanza.html,
// que se lleva el avance (localStorage) al dominio nuevo. Va antes que todo para que ningún otro listener responda.
if (['ml-desde-cero.vercel.app', 'sensei-ml.vercel.app', 'taller-ai-engineer.vercel.app', 'ronda-diseno-ml.vercel.app', 'cheat-sheets-ml.vercel.app',
  'atlas-arquitecturas.vercel.app', 'laboratorio-transformer.vercel.app', 'tablero-ml-demo.vercel.app'].indexOf(self.location.hostname) !== -1) {
  self.addEventListener('install', (e) => { e.stopImmediatePropagation(); self.skipWaiting(); });
  self.addEventListener('activate', (e) => {
    e.stopImmediatePropagation();
    e.waitUntil((async () => {
      for (const k of await caches.keys()) await caches.delete(k);
      await self.registration.unregister();
      for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
    })());
  });
  self.addEventListener('fetch', (e) => { e.stopImmediatePropagation(); });
}

const BUILD = '__BUILD__';
const CACHE = 'tablero-' + BUILD;
const ASSETS = __ASSETS__;
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tablero-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página: primero la red (para ver la versión más nueva); si falla o tarda más de 4 s, la copia.
async function page(request) {
  const cache = await caches.open(CACHE);
  // solo la página de la app es la copia para abrir sin red (no un ícono o el manifest abiertos en una pestaña)
  const isShell = new URL(request.url).pathname === '/';
  const net = fetch(request).then((res) => {
    if (res.ok && isShell && (res.headers.get('content-type') || '').includes('text/html')) cache.put('/', res.clone());
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([net, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS))]);
  } catch (e) {
    return (await cache.match('/')) || net.catch(() => Response.error());
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // datos: siempre a la red
  if (req.mode === 'navigate') { event.respondWith(page(req)); return; }
  // archivos de la app: la copia de este build (cambian juntos), si no, la red
  event.respondWith(caches.open(CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((hit) => hit || fetch(req)));
});
