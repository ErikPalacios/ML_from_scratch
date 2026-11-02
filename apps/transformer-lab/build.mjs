#!/usr/bin/env node
// Empaqueta la app en un único HTML (sin dependencias):
//   dist/transformer-lab.html  documento completo e independiente (doble clic y listo)
//   dist/artifact.html         el mismo contenido SIN <!doctype>, <html>, <head> ni <body>:
//                              <title> primero, luego estilos, marcado y scripts (para publicar)
// Se incrustan todos los <link rel="stylesheet" href="css/…"> y <script src="js/…"> locales;
// MathJax (CDN) y Google Fonts se mantienen como recursos externos.
// Uso: node build.mjs [--allow-missing]   (con --allow-missing, un archivo local ausente solo avisa)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const allowMissing = process.argv.includes('--allow-missing');

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const inlined = [];
const missing = [];

function readLocal(rel) {
  const p = resolve(ROOT, rel);
  // contención real (no por prefijo de texto: «../transformer-lab-old/x.js» empieza igual que ROOT)
  const r = relative(ROOT, p);
  if (r.startsWith('..') || isAbsolute(r) || !existsSync(p)) {
    missing.push(rel);
    return null;
  }
  const txt = readFileSync(p, 'utf8');
  inlined.push({ rel, bytes: Buffer.byteLength(txt) });
  return txt;
}
// Dentro de <script>, '</script' cerraría la etiqueta y '<!--' activa el modo de escape: se neutralizan.
const escScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const escStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

let out = html;
// hojas de estilo locales → <style>
out = out.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, (tag) => {
  const m = /\bhref=["']([^"']+)["']/i.exec(tag);
  if (!m || /^(https?:)?\/\//i.test(m[1])) return tag; // externo (Google Fonts): se deja
  const css = readLocal(m[1]);
  if (css === null) return allowMissing ? '<!-- falta ' + m[1] + ' -->' : tag;
  return '<style data-src="' + m[1] + '">\n' + escStyle(css) + '\n</style>';
});
// scripts locales → <script> en línea
out = out.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, a, src, b) => {
  if (/^(https?:)?\/\//i.test(src)) return tag; // externo (MathJax): se deja
  const js = readLocal(src);
  if (js === null) return allowMissing ? '<!-- falta ' + src + ' -->' : tag;
  return '<script data-src="' + src + '">\n' + escScript(js) + '\n</script>';
});

if (missing.length) {
  const msg = 'Archivos locales no encontrados: ' + missing.join(', ');
  if (!allowMissing) { console.error('[build] ERROR ' + msg + '\n        (usa --allow-missing para continuar sin ellos)'); process.exit(1); }
  console.warn('[build] AVISO ' + msg);
}

// ---------- fragmento para el artefacto (sin envoltorio de documento)
const headM = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(out);
const bodyM = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(out);
if (!headM || !bodyM) { console.error('[build] ERROR: index.html debe tener <head> y <body>.'); process.exit(1); }
let head = headM[1];
let body = bodyM[1];
const titleM = /<title\b[^>]*>[\s\S]*?<\/title>/i.exec(head);
const title = titleM ? titleM[0] : '<title>Laboratorio Transformer</title>';
head = head.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '').replace(/<meta\b[^>]*>\s*/gi, '');
// todos los <script> (cabecera y cuerpo) van al final, en su orden original
const SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi;
const headScripts = head.match(SCRIPT_RE) || [];
const bodyScripts = body.match(SCRIPT_RE) || [];
head = head.replace(SCRIPT_RE, '');
body = body.replace(SCRIPT_RE, '');
const styles = head.trim();
const markup = body.trim();
const artifact = [title, styles, markup, headScripts.concat(bodyScripts).join('\n')].join('\n') + '\n';

// --web (Vercel): service worker para abrir sin conexión. El HTML que lleva el registro es el de la web; el que se
// copia al Atlas (npm run vendor:lab) y el artifact se arman sin --web y no registran nada.
const web = process.argv.includes('--web');
let outHtml = out;
if (web) {
  if (!/<\/body>/i.test(outHtml)) { console.error('[build] ERROR: el HTML no tiene </body>.'); process.exit(1); }
  const register = `<script>
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
}
</script>`;
  const i = outHtml.lastIndexOf('</body>');
  outHtml = outHtml.slice(0, i) + register + '\n' + outHtml.slice(i);
}
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'transformer-lab.html'), outHtml);
writeFileSync(join(DIST, 'artifact.html'), artifact);
if (web) {
  const runtimeUrls = Array.from(new Set([
    ...Array.from(outHtml.matchAll(/<script\b[^>]*\bsrc="(https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/mathjax\/[^"]+)"/gi), (m) => m[1]),
    ...Array.from(outHtml.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/gi), (m) => m[1].replace(/&amp;/g, '&')),
  ]));
  if (!runtimeUrls.some((u) => /mathjax/.test(u))) console.warn('[build] AVISO: no encontré el <script> de MathJax: el service worker no lo precargará.');
  const swSrc = readFileSync(join(ROOT, 'web', 'sw.template.js'), 'utf8');
  if ((swSrc.match(/__BUILD__/g) || []).length !== 1 || (swSrc.match(/\/\*__RUNTIME__\*\//g) || []).length !== 1) { console.error('[build] ERROR: web/sw.template.js debe tener un __BUILD__ y un /*__RUNTIME__*/.'); process.exit(1); }
  const buildId = createHash('sha256').update(outHtml).digest('hex').slice(0, 12);
  writeFileSync(join(DIST, 'sw.js'), swSrc.replace('__BUILD__', buildId).replace('/*__RUNTIME__*/', runtimeUrls.map((u) => JSON.stringify(u)).join(', ')));
  console.log('[build] dist/sw.js (build ' + buildId + ', ' + runtimeUrls.length + ' recursos externos precargados)');
}
// Archivos públicos (imagen para redes, etc.): public/ se copia tal cual a dist/. Más robots.txt y sitemap.xml.
const SITE_URL = 'https://laboratorio-transformer.vercel.app';
if (existsSync(join(ROOT, 'public'))) for (const f of readdirSync(join(ROOT, 'public'))) copyFileSync(join(ROOT, 'public', f), join(DIST, f));
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);

// ---------- comprobaciones e informe
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const leftovers = (out.match(/<(link|script)\b[^>]*\s(href|src)=["'](?!https?:|\/\/)[^"']+["']/gi) || []);
if (leftovers.length && !allowMissing) { console.error('[build] ERROR: quedan referencias locales sin incrustar:\n  ' + leftovers.join('\n  ')); process.exit(1); }
if (/<!doctype|<html\b|<\/?head\b|<\/?body\b/i.test(artifact)) { console.error('[build] ERROR: artifact.html contiene etiquetas de documento.'); process.exit(1); }
const tpos = artifact.indexOf('<title');
if (tpos !== 0 || Buffer.byteLength(artifact.slice(0, tpos + 200)) > 8192) { console.error('[build] ERROR: <title> debe ir al principio de artifact.html.'); process.exit(1); }

console.log('[build] incrustados:');
for (const f of inlined) console.log('  ' + f.rel.padEnd(24) + kb(f.bytes).padStart(10));
console.log('[build] dist/transformer-lab.html ' + kb(Buffer.byteLength(out)));
console.log('[build] dist/artifact.html        ' + kb(Buffer.byteLength(artifact)));
