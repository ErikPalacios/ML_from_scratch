#!/usr/bin/env node
// Basado en apps/ml-system-design/tools/build-web.mjs.
// Arma la versión web (para Vercel o cualquier hosting estático) en dist/web/:
//   index.html      = dist/atlas-arquitecturas.html + manifest, íconos y registro del service worker
//                     (ATLAS_ENV pasa de 'single' a 'web': el enlace al Laboratorio apunta a lab/#<pestaña>)
//   lab/index.html  = vendor/lab/index.html (copia commiteada del Laboratorio Transformer), si existe
//   sw.js           = web/sw.js con el hash del build y la lista de archivos a precargar
//   manifest, íconos = copiados de web/
// Requiere haber corrido antes build.mjs (npm run build:web hace las dos cosas).
// --require-lab (lo usa build:vercel): falla si falta vendor/lab/index.html en vez de solo avisar.
// No depende de ningún archivo que empiece con punto (Vercel no los sube).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'dist', 'atlas-arquitecturas.html');
const WEB = join(ROOT, 'web');
const LAB = join(ROOT, 'vendor', 'lab', 'index.html');
const OUT = join(ROOT, 'dist', 'web');
const requireLab = process.argv.includes('--require-lab');   // build:vercel: sin el Laboratorio, falla
if (!existsSync(SRC)) { console.error('[build-web] ERROR: falta dist/atlas-arquitecturas.html (corre antes node build.mjs).'); process.exit(1); }

let html = readFileSync(SRC, 'utf8');
const ENV_SINGLE = 'window.ATLAS_ENV = "single";';
if (html.split(ENV_SINGLE).length !== 2) { console.error('[build-web] ERROR: dist/atlas-arquitecturas.html debe tener exactamente un ' + ENV_SINGLE); process.exit(1); }
html = html.replace(ENV_SINGLE, 'window.ATLAS_ENV = "web";');
// SEO y vista previa en redes (Open Graph / Twitter Card). SITE_URL: dirección pública; cámbiala cuando haya dominio propio.
const SITE_URL = 'https://atlas-arquitecturas.vercel.app';
const SITE_NAME = 'Atlas de Arquitecturas';
const metaTitle = (/<title>([^<]*)<\/title>/i.exec(html) || [])[1] || SITE_NAME;
const metaDesc = (/<meta name="description" content="([^"]*)"/i.exec(html) || [])[1] || '';
const SEO = [
  `<link rel="canonical" href="${SITE_URL}/">`,
  '<meta property="og:type" content="website">',
  '<meta property="og:locale" content="es_MX">',
  `<meta property="og:site_name" content="${SITE_NAME}">`,
  `<meta property="og:title" content="${metaTitle} — diagramas, matemáticas y dimensiones de modelos de ML">`,
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
  '<meta name="apple-mobile-web-app-title" content="Atlas">',
  ...SEO,
].join('\n');
// el service worker solo se registra servido por http(s): con doble clic (file://) no aplica
const register = `<script>
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
</script>`;
if (!/<\/title>/i.test(html) || !/<\/body>/i.test(html)) { console.error('[build-web] ERROR: el HTML no tiene </title> o </body>.'); process.exit(1); }
html = html.replace(/<\/title>/i, (m) => m + '\n' + head);
const i = html.lastIndexOf('</body>');
html = html.slice(0, i) + register + '\n' + html.slice(i);

const hasLab = existsSync(LAB);
const labHtml = hasLab ? readFileSync(LAB) : null;
const hash = createHash('sha256').update(html);
if (labHtml) hash.update(labHtml);
const build = hash.digest('hex').slice(0, 12);
const swSrc = readFileSync(join(WEB, 'sw.js'), 'utf8');
if ((swSrc.match(/__BUILD__/g) || []).length !== 1) { console.error('[build-web] ERROR: web/sw.js debe tener exactamente un marcador __BUILD__.'); process.exit(1); }
if ((swSrc.match(/\/\*__EXTRA__\*\//g) || []).length !== 1) { console.error('[build-web] ERROR: web/sw.js debe tener exactamente un marcador /*__EXTRA__*/.'); process.exit(1); }
if ((swSrc.match(/\/\*__RUNTIME__\*\//g) || []).length !== 1) { console.error('[build-web] ERROR: web/sw.js debe tener exactamente un marcador /*__RUNTIME__*/.'); process.exit(1); }
const extra = hasLab ? ["'./lab/'", "'./lab/index.html'"] : [];
// Recursos externos de index.html (MathJax de cdnjs, CSS de Google Fonts): el service worker los
// precarga al instalarse para que funcionen sin conexión desde la primera visita (SPEC §10.2).
const runtimeUrls = Array.from(new Set([
  ...Array.from(html.matchAll(/<script\b[^>]*\bsrc="(https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mathjax\/[^"]+)"/gi), (m) => m[1]),
  ...Array.from(html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/gi), (m) => m[1].replace(/&amp;/g, '&')),
]));
if (!runtimeUrls.some((u) => /mathjax/.test(u))) console.warn('[build-web] AVISO: no encontré el <script> de MathJax en el HTML: el service worker no lo precargará.');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
writeFileSync(join(OUT, 'sw.js'), swSrc.replace('__BUILD__', build).replace('/*__EXTRA__*/', extra.join(', ')).replace('/*__RUNTIME__*/', runtimeUrls.map((u) => JSON.stringify(u)).join(', ')));
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'og.png']) {
  if (!existsSync(join(WEB, f))) { console.error('[build-web] ERROR: falta web/' + f); process.exit(1); }
  copyFileSync(join(WEB, f), join(OUT, f));
}
if (hasLab) {
  mkdirSync(join(OUT, 'lab'), { recursive: true });
  copyFileSync(LAB, join(OUT, 'lab', 'index.html'));
} else if (requireLab) {
  console.error('[build-web] ERROR: no existe vendor/lab/index.html (npm run vendor:lab): sin él, cada enlace lab/#… daría 404 en la web.');
  process.exit(1);
} else {
  console.warn('[build-web] AVISO: no existe vendor/lab/index.html (npm run vendor:lab): los enlaces al Laboratorio no abrirán en la web.');
}
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
console.log('[build-web] dist/web/ listo (build ' + build + ', index.html ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB' + (hasLab ? ', con lab/' : ', sin lab/') + ')');
