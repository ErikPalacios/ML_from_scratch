#!/usr/bin/env node
// Arma la versión web (para Vercel o cualquier hosting estático) en dist/web/:
//   index.html      = dist/ml-system-design.html + manifest, íconos y registro del service worker
//   sw.js           = web/sw.js con el hash del build (abre sin conexión después de la primera visita)
//   manifest, íconos = copiados de web/
// Requiere haber corrido antes build.mjs (npm run build:web hace las dos cosas).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'dist', 'ml-system-design.html');
const WEB = join(ROOT, 'web');
const OUT = join(ROOT, 'dist', 'web');
if (!existsSync(SRC)) { console.error('[build-web] ERROR: falta dist/ml-system-design.html (corre antes node build.mjs).'); process.exit(1); }

let html = readFileSync(SRC, 'utf8');
// SEO y vista previa en redes (Open Graph / Twitter Card). SITE_URL: dirección pública; cámbiala cuando haya dominio propio.
const SITE_URL = 'https://ronda-diseno-ml.vercel.app';
const SITE_NAME = 'Ronda de Diseño ML';
const metaTitle = (/<title>([^<]*)<\/title>/i.exec(html) || [])[1] || SITE_NAME;
const metaDesc = (/<meta name="description" content="([^"]*)"/i.exec(html) || [])[1] || '';
const SEO = [
  `<link rel="canonical" href="${SITE_URL}/">`,
  '<meta property="og:type" content="website">',
  '<meta property="og:locale" content="es_MX">',
  `<meta property="og:site_name" content="${SITE_NAME}">`,
  `<meta property="og:title" content="${metaTitle} — curso y simulador de ML System Design">`,
  `<meta property="og:description" content="${metaDesc}">`,
  `<meta property="og:url" content="${SITE_URL}/">`,
  `<meta property="og:image" content="${SITE_URL}/og.png">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:title" content="${metaTitle}">`,
  `<meta name="twitter:description" content="${metaDesc}">`,
  `<meta name="twitter:image" content="${SITE_URL}/og.png">`,
];
const head = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="icon" href="icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  '<meta name="theme-color" content="#EEF1F3" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#10151B" media="(prefers-color-scheme: dark)">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Ronda ML">',
  ...SEO,
].join('\n');
// el service worker solo se registra servido por http(s): con doble clic (file://) no aplica.
// navigator.storage.persist() pide que el navegador no borre el progreso y las notas
// (localStorage) cuando el dispositivo se queda sin espacio; si no lo concede, todo sigue igual.
const register = `<script>
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persisted().then(function (p) { if (!p) return navigator.storage.persist(); }).catch(function () {});
}
</script>`;
if (!/<\/title>/i.test(html) || !/<\/body>/i.test(html)) { console.error('[build-web] ERROR: el HTML no tiene </title> o </body>.'); process.exit(1); }
html = html.replace(/<\/title>/i, (m) => m + '\n' + head);
const i = html.lastIndexOf('</body>');
html = html.slice(0, i) + register + '\n' + html.slice(i);

const build = createHash('sha256').update(html).digest('hex').slice(0, 12);
const swSrc = readFileSync(join(WEB, 'sw.js'), 'utf8');
if ((swSrc.match(/__BUILD__/g) || []).length !== 1) { console.error('[build-web] ERROR: web/sw.js debe tener exactamente un marcador __BUILD__.'); process.exit(1); }
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(WEB, 'sw.js'), 'utf8').replaceAll('__BUILD__', build));
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'og.png']) {
  if (!existsSync(join(WEB, f))) { console.error('[build-web] ERROR: falta web/' + f); process.exit(1); }
  copyFileSync(join(WEB, f), join(OUT, f));
}
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
console.log('[build-web] dist/web/ listo (build ' + build + ', index.html ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB)');
