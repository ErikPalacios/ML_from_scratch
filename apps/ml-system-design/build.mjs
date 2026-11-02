#!/usr/bin/env node
// Empaqueta la app en un único HTML (sin dependencias):
//   dist/ml-system-design.html  documento completo e independiente (doble clic y listo)
//   dist/artifact.html          el mismo contenido SIN <!doctype>, <html>, <head> ni <body>:
//                               <title> primero, luego estilos, marcado y scripts (para publicar
//                               como Artifact de claude.ai; declara capabilities {db:{}, user:{}}
//                               para que el progreso se guarde en la cuenta)
// Se incrustan todos los <link rel="stylesheet" href="css/…"> y <script src="js/…"> locales;
// Google Fonts se mantiene como recurso externo.
// Uso: node build.mjs [--allow-missing]   (con --allow-missing, un archivo local ausente solo avisa)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT_NAME = 'ml-system-design.html';
const allowMissing = process.argv.includes('--allow-missing');

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const inlined = [];
const missing = [];

function readLocal(rel) {
  const p = resolve(ROOT, rel);
  // contención real (no por prefijo de texto: «../ml-system-design-old/x.js» empieza igual que ROOT)
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
// (Ocurre de verdad: los archivos de referencia embebidos contienen HTML/YAML con esos patrones.)
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
out = out.replace(/<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi, (tag, a, src) => {
  if (/^(https?:)?\/\//i.test(src)) return tag; // externo: se deja
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
const title = titleM ? titleM[0] : '<title>Ronda de Diseño ML</title>';
head = head.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '').replace(/<meta\b[^>]*>\s*/gi, '');
// todos los <script> (cabecera y cuerpo) van al final, en su orden original
const SCRIPT_RE = /<script\b[\s\S]*?<\/script>/gi;
const headScripts = head.match(SCRIPT_RE) || [];
const bodyScripts = body.match(SCRIPT_RE) || [];
head = head.replace(SCRIPT_RE, '');
body = body.replace(SCRIPT_RE, '');
// comentarios HTML sueltos (p. ej. el marcador de contenido) no hacen falta en el artefacto
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->\s*/g, '');
const styles = stripComments(head).trim();
const markup = stripComments(body).trim();
const artifact = [title, styles, markup, headScripts.concat(bodyScripts).join('\n')].join('\n') + '\n';

mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, OUT_NAME), out);
writeFileSync(join(DIST, 'artifact.html'), artifact);

// ---------- comprobaciones e informe
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const leftovers = (out.match(/<(link|script)\b[^>]*\s(href|src)=["'](?!https?:|\/\/)[^"']+["']/gi) || []);
if (leftovers.length && !allowMissing) { console.error('[build] ERROR: quedan referencias locales sin incrustar:\n  ' + leftovers.join('\n  ')); process.exit(1); }
// (se ignora el contenido de <script>/<style>: un literal JS como '<body>' no es una etiqueta del documento)
const artifactMarkupOnly = artifact.replace(SCRIPT_RE, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
if (/<!doctype|<html\b|<\/?head\b|<\/?body\b/i.test(artifactMarkupOnly)) { console.error('[build] ERROR: artifact.html contiene etiquetas de documento.'); process.exit(1); }
const tpos = artifact.indexOf('<title');
if (tpos !== 0 || Buffer.byteLength(artifact.slice(0, tpos + 200)) > 8192) { console.error('[build] ERROR: <title> debe ir al principio de artifact.html.'); process.exit(1); }
// un '</script' literal dentro de un script embebido cortaría el documento: comprobación extra
const scriptBodies = out.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
const expectedScripts = (html.match(/<script\b/gi) || []).length - (allowMissing ? missing.filter((m) => /\.js$/i.test(m)).length : 0);
if (scriptBodies.length !== expectedScripts) { console.error('[build] ERROR: el número de <script> cambió al incrustar (' + expectedScripts + ' → ' + scriptBodies.length + '); revisa el escape.'); process.exit(1); }
const total = Buffer.byteLength(artifact);
if (total > 16 * 1024 * 1024) { console.error('[build] ERROR: artifact.html supera 16 MB (' + kb(total) + ').'); process.exit(1); }

console.log('[build] incrustados:');
for (const f of inlined) console.log('  ' + f.rel.padEnd(34) + kb(f.bytes).padStart(10));
console.log('[build] dist/' + OUT_NAME.padEnd(24) + kb(Buffer.byteLength(out)));
console.log('[build] dist/artifact.html'.padEnd(37) + kb(total));
