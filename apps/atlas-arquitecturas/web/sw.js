/* Basado en apps/ml-system-design/web/sw.js.
   Service worker de la versión web (Vercel): hace que la app abra sin conexión después de la
   primera visita. No se usa en el Artifact de claude.ai ni al abrir el HTML con doble clic.
   build-web.mjs reemplaza el marcador de BUILD por un hash del build (cada deploy instala un service
   worker nuevo, guarda la página nueva y borra la caché anterior) y agrega el Laboratorio (lab/)
   a la precarga cuando existe. MathJax (cdnjs) y las fuentes van en una caché aparte que sobrevive
   entre deploys (stale-while-revalidate). Como en la primera visita la página los pide antes de que el
   service worker la controle, la instalación los precarga (sin bloquearla si falla): las fórmulas y
   las fuentes funcionan sin conexión desde la primera visita (SPEC §10.2). build-web.mjs pone en
   RUNTIME_URLS los recursos externos que carga index.html. */
'use strict';
const BUILD = '__BUILD__';
const CACHE = 'atlas-app-' + BUILD;
const RUNTIME = 'atlas-runtime'; // fuentes + MathJax: no cambian entre deploys
const CORE = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png', /*__EXTRA__*/];
const RUNTIME_URLS = [/*__RUNTIME__*/];
const NAV_TIMEOUT_MS = 4000; // con mala señal, después de 4 s se usa la copia guardada

const WARM_TIMEOUT_MS = 8000; // la precarga nunca retiene la instalación más que esto por recurso
const tfetch = (u, o) => Promise.race([fetch(u, o), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), WARM_TIMEOUT_MS))]);

// Precarga de la caché de recursos externos (MathJax, CSS de Google Fonts y los archivos de fuente
// que nombra). Nunca hace fallar la instalación.
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
      } catch (e) { /* sin red: se cachea en la próxima visita (stale-while-revalidate) */ }
    }));
  } catch (e) { /* Cache API no disponible */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => warmRuntime()).then(() => self.skipWaiting()));
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
  const isApp = /\/(index\.html)?$/.test(url.pathname) && !isLab;
  const key = isLab ? './lab/' : './';
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    // Solo la app y el Laboratorio se guardan como página: abrir /icon.svg o el manifest en una
    // pestaña no debe reemplazar la copia sin conexión de la app.
    if (res.ok && (isApp || isLab)) cache.put(key, res.clone());
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
