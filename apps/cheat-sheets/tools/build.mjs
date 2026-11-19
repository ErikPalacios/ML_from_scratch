#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html          = site/hub.html con una tarjeta por hoja de sheets.json
//   <id>/index.html     = la página de la hoja (sheets/<id>/<page>) + barra para volver a la portada
//   <id>/<pdf>          = el PDF de la hoja
//   sw.js               = site/sw.js con el hash del build y la lista de páginas (abre sin conexión)
//   manifest e íconos   = copiados de site/
//   video/              = la muestra de 30 s de la portada (site/video/como-se-usa.mp4 y su póster); el service worker no la guarda
// Las páginas de las hojas ya vienen con las fórmulas en MathML: se generan con sheets/<id>/fuentes/.
// El diseño es el de TrueML: el build pega en cada hoja vendor/trueml/tokens.css y site/trueml-hojas.css (que pasa su
// paleta a los colores de TrueML), la franja de 6 colores, la barra con la T y la T chica con las etapas de la hoja.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { etapas, franja, marca, miniT, resumen, IDS, TrueMLMark } from '../vendor/trueml/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'dist');
const SHEETS = JSON.parse(readFileSync(join(ROOT, 'sheets.json'), 'utf8'));
const ASSETS = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'og.png'];

const fail = (msg) => { console.error('[build] ERROR: ' + msg); process.exit(1); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };
const mb = (bytes) => (bytes / 1e6).toFixed(1) + ' MB';

// ---------------------------------------------------------------- TrueML
// Los colores de la marca (vendor/trueml/tokens.css) y la capa que viste a cada hoja con ellos (site/trueml-hojas.css).
const TOKENS = readFileSync(join(ROOT, 'vendor', 'trueml', 'tokens.css'), 'utf8');
const PIEZAS_CSS = readFileSync(join(ROOT, 'vendor', 'trueml', 'piezas.css'), 'utf8'); // el botón «Volver a TrueML» y el bloque de código estándar
const HOJAS_CSS = readFileSync(join(SITE, 'trueml-hojas.css'), 'utf8');
// Los bloques de comandos de las hojas (.code) llevan el lenguaje en data-lang (pinta el puntito de la barra, como en .tm-code).
const LENGUAJE = [[/^(bash|zsh|sh|terminal|shell)\b/i, 'bash'], [/^(python|py)\b/i, 'python'], [/^(yaml|yml)\b/i, 'yaml'], [/^json/i, 'json'], [/^(dockerfile|docker)\b/i, 'docker']];
const conLenguaje = (html) => html.replace(/<div class="code( [^"]*)?">(<div class="code__bar[^"]*"><span class="code__lang">)([^<]*)/g, (m, cls, bar, lbl) => {
  const l = LENGUAJE.find(([re]) => re.test(lbl.trim()));
  return `<div class="code${cls || ''}"${l ? ` data-lang="${l[1]}"` : ''}>${bar}${lbl}`;
});
// El botón «Volver a TrueML» (+ «‹ Cheat sheets» en cada hoja) y el formato de código: atributos en <html> y los dos scripts.
const ATTR_TM = ` data-tm-herramienta="Cheat sheets" data-tm-inicio="/" data-tm-portada="https://ml-desde-cero.vercel.app/"`;
const SCRIPTS_TM = '<script src="/codigo.js" defer></script><script src="/piezas.js" defer></script>';
// El tono de cada hoja: el color de su etapa en el número de sección, el kicker y los títulos de las tarjetas.
// --st es el relleno, --st-on el texto encima y --st-ink el color para texto sobre la tarjeta (contraste AA).
const TONOS = {
  datos: ['var(--y)', '#0E1530', 'var(--hj-amber-ink)'],
  modelo: ['var(--o)', '#0E1530', 'var(--hj-orange-ink)'],
  api: ['var(--g)', '#0E1530', 'var(--hj-teal)'],
  contenedor: ['var(--b)', '#FFFFFF', 'var(--hj-blue)'],
  orquestacion: ['var(--p)', '#FFFFFF', 'var(--hj-violet)'],
  monitoreo: ['var(--n)', '#FFFFFF', 'var(--hj-slate-ink)'],
  tinta: ['var(--tm-ink)', 'var(--tm-bg)', 'var(--tm-ink)'],
};
const tonoCss = (t) => { const [st, on, ink] = TONOS[t]; return `\n:root { --st: ${st}; --st-on: ${on}; --st-ink: ${ink}; }\n`; };
// La T de vidrio de la barra (sin etiquetas). Cada copia lleva su clave: los degradados del SVG no repiten id.
const marcaBarra = (clave) => TrueMLMark.mark(true, null, clave);
const STRIPE = franja('tm-stripe hub-stripe');
// Sin Google Fonts: las hojas usan las fuentes del sistema y abren sin conexión desde la primera visita.
const sinFuentes = (html) => html.replace(/<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\s*/g, '').replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]*">\s*/g, '');

// Tema elegido a mano (claro u oscuro): se aplica antes de pintar, para que no parpadee. Sin elección, la página sigue
// al sistema. Cada hoja ya trae sus dos paletas: la oscura vive en @media (prefers-color-scheme: dark) con el guardia
// :root:not([data-theme="light"]) y otra vez en :root[data-theme="dark"], así que basta con poner data-theme en <html>.
const THEME_KEY = 'hojas-tema';
const HEAD = [
  `<script>try { var t = localStorage.getItem('${THEME_KEY}'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>`,
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="icon" href="/icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<meta name="theme-color" content="#EDEFF7" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#0A0F22" media="(prefers-color-scheme: dark)">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Cheat sheets">',
].join('\n');
// SEO y vista previa en redes: dirección canónica, Open Graph y Twitter Card. SITE_URL es la dirección pública del sitio
// (cámbiala cuando haya dominio propio). La descripción solo se agrega si la página no trae una.
const SITE_URL = 'https://cheat-sheets-ml.vercel.app';
const SITE_NAME = 'Cheat sheets ML';
const seo = (path, title, desc, html) => {
  const url = SITE_URL + path;
  const meta = [
    html && /<meta name="description"/i.test(html) ? '' : `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${url}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="es_MX">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${SITE_URL}/og.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${SITE_URL}/og.png">`,
  ].filter(Boolean).join('\n');
  return HEAD + '\n' + meta;
};
// Crédito y licencia al pie de cada página (la imagen de copia no se bloquea: se protege la atribución).
const FOOT = `<footer class="hub-credit"><p>© ${new Date().getFullYear()} Erik Palacios · Contenido bajo <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es">CC BY-NC-ND 4.0</a> · <a href="https://ml-desde-cero.vercel.app">ML desde cero</a> · <a href="https://github.com/ErikPalacios/ML_from_scratch/issues/new">Reportar un error</a></p></footer>`;
// el service worker solo se registra servido por http(s): abriendo el archivo con doble clic no aplica.
const REGISTER = `<script>
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
}
</script>`;
// Selector de tema (claro · oscuro · como el sistema), el mismo en la portada y en cada hoja. La elección vale para
// todo el sitio y se recuerda en este navegador; imprimir siempre sale en claro.
const ICON = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/></svg>',
};
const THEME_UI = `<div class="tema" role="group" aria-label="Tema">${[['light', 'Claro', 'Tema claro'], ['dark', 'Oscuro', 'Tema oscuro'], ['auto', 'Auto', 'Como el sistema']]
  .map(([t, l, title]) => `<button type="button" data-tema="${t}" aria-pressed="false" title="${title}">${ICON[t]}<span>${l}</span></button>`).join('')}</div>`;
const THEME_JS = `<script>
(function () {
  var KEY = '${THEME_KEY}', root = document.documentElement;
  var metas = [].slice.call(document.querySelectorAll('meta[name="theme-color"]'));
  var orig = metas.map(function (m) { return m.getAttribute('content'); });
  function get() { try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function apply(t) {
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    // la barra del navegador en el celular, del mismo color que la página
    metas.forEach(function (m, i) { m.setAttribute('content', t === 'auto' ? orig[i] : (t === 'dark' ? '#0A0F22' : '#EDEFF7')); });
    [].forEach.call(document.querySelectorAll('.tema [data-tema]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tema') === t)); });
  }
  apply(get());
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.tema [data-tema]') : null;
    if (!b) return;
    var t = b.getAttribute('data-tema');
    try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) {}
    apply(t);
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(get()); }); // otra pestaña lo cambió
  var before = null; // imprimir con la paleta clara, pase lo que pase en pantalla
  window.addEventListener('beforeprint', function () { before = root.getAttribute('data-theme'); root.setAttribute('data-theme', 'light'); });
  window.addEventListener('afterprint', function () { if (before) root.setAttribute('data-theme', before); else root.removeAttribute('data-theme'); before = null; });
})();
</script>`;
// Barra de arriba (portada y hojas), con los colores de TrueML: la marca (la T y TrueML, a la portada de las cheat sheets), volver
// a todas las cheat sheets, el tema y el PDF. En la portada, la marca va sola.
const BAR_CSS = `
body { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); position: relative; }
.hub-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px 16px; padding-top: 18px; font: 600 14px/1.3 var(--sans); }
.hub-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.hub-logo { display: inline-flex; align-items: center; gap: 9px; min-height: 40px; color: var(--tm-ink) !important; text-decoration: none; }
.hub-mark { width: 22px; flex: none; display: block; }
.hub-mark svg { display: block; width: 100%; height: auto; }
.hub-word { font: 800 19px/1 var(--sans); letter-spacing: -.04em; }
.hub-word span { color: var(--tm-acc); }
.hub-sep { width: 1px; height: 22px; background: var(--tm-line); flex: none; }
.hub-home { display: inline-flex; align-items: center; min-height: 40px; color: var(--tm-ink) !important; text-decoration: none; font: 700 14.5px/1.2 var(--sans); }
.hub-home:hover { color: var(--tm-acc) !important; }
.hub-bar a:focus-visible { outline: 2px solid var(--tm-acc); outline-offset: 3px; border-radius: 8px; }
.hub-acc { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.hub-pdf { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 15px; border-radius: 12px; background: var(--tm-btn2); color: var(--tm-ink) !important; text-decoration: none; font: 700 13.5px/1 var(--sans); box-shadow: inset 0 0 0 1px var(--tm-line), 0 3px 0 var(--tm-btn2sh); transition: transform .08s ease, box-shadow .08s ease; }
.hub-pdf small { font: 600 12px/1 var(--sans); color: var(--tm-ink3); font-variant-numeric: tabular-nums; }
.hub-pdf:hover { transform: translateY(-1px); }
.hub-pdf:active { transform: translateY(2px); box-shadow: inset 0 0 0 1px var(--tm-line), 0 1px 0 var(--tm-btn2sh); }
.hub-bar + .hero { padding-top: 22px; }
.tema { display: inline-flex; gap: 2px; padding: 4px; border: 0; border-radius: 999px; background: var(--tm-card); box-shadow: 0 1px 0 rgba(14, 21, 48, .07), 0 0 0 1px rgba(14, 21, 48, .06); }
.tema button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--tm-ink2); font: 600 13px/1 var(--sans); cursor: pointer; }
.tema button svg { width: 15px; height: 15px; flex: none; }
.tema button:hover { color: var(--tm-ink); }
.tema button[aria-pressed="true"] { background: var(--tm-ink); color: var(--tm-bg); }
.tema button:focus-visible { outline: 2px solid var(--tm-acc); outline-offset: 2px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .tema { box-shadow: 0 0 0 1px #232C52; } }
:root[data-theme="dark"] .tema { box-shadow: 0 0 0 1px #232C52; }
@media (max-width: 480px) {
  .tema button { padding: 0 10px; }
  .tema button span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
.hub-credit { max-width: 1120px; margin: 48px auto 0; padding: 22px 16px 40px; border-top: 1px solid var(--tm-line); text-align: center; font: 13.5px/1.55 var(--sans); color: var(--tm-ink3); }
.hub-credit p { margin: 0; }
.hub-credit a { color: var(--tm-acc); }
@media print { .hub-bar { display: none !important; } }
`;

// Los bloques `@media print { … }` de una hoja de estilos, completos (con sus llaves anidadas).
function bloquesPrint(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of css.matchAll(/@media\s+print\s*\{/g)) {
    let d = 1, j = m.index + m[0].length;
    while (d && j < css.length) { if (css[j] === '{') d++; else if (css[j] === '}') d--; j++; }
    out.push(css.slice(m.index, j));
  }
  return out.join('\n');
}

function inject(html, where, { head = '', css = '', afterWrap = '', beforeBody = '' }) {
  if (!/<\/title>/i.test(html) || !/<\/style>/i.test(html) || !/<\/body>/i.test(html)) fail(where + ': falta </title>, </style> o </body>');
  html = html.replace(/<\/title>/i, (m) => m + '\n' + head);
  if (css) html = html.replace(/<\/style>/i, (m) => css + m);
  if (afterWrap) {
    if (!html.includes('<div class="wrap">')) fail(where + ': falta <div class="wrap">');
    html = html.replace('<div class="wrap">', (m) => m + afterWrap);
  }
  const i = html.lastIndexOf('</body>');
  return html.slice(0, i) + beforeBody + '\n' + html.slice(i);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const pages = {};

// 1 · una carpeta por hoja
const ids = new Set();
for (const s of SHEETS) {
  for (const k of ['id', 'title', 'topic', 'etapas', 'tono', 'summary', 'sample', 'sample_kind', 'facts', 'page', 'pdf', 'updated']) if (!(k in s)) fail(`la hoja ${s.id || '?'} no tiene "${k}" en sheets.json`);
  if (!/^[a-z0-9-]+$/.test(s.id) || ids.has(s.id)) fail(`id inválido o repetido: ${s.id}`);
  try { etapas(s.etapas); } catch (e) { fail(`${s.id}: ${e.message}`); }
  if (!(s.tono in TONOS)) fail(`${s.id}: tono "${s.tono}" no existe (${Object.keys(TONOS).join(', ')})`);
  ids.add(s.id);
  const dir = join(ROOT, 'sheets', s.id);
  for (const f of [s.page, s.pdf]) if (!existsSync(join(dir, f))) fail(`falta sheets/${s.id}/${f}`);
  s.pdfSize = statSync(join(dir, s.pdf)).size;
  const bar = `<nav class="hub-bar" aria-label="Cheat sheets"><div class="hub-brand"><a class="hub-logo" href="/" aria-label="Portada de las cheat sheets"><span class="hub-mark" aria-hidden="true">${marcaBarra('barra')}</span><span class="hub-word">True<span>ML</span></span></a><span class="hub-sep" aria-hidden="true"></span><a class="hub-home" href="/">← Todas las cheat sheets</a></div><div class="hub-acc">${THEME_UI}<a class="hub-pdf" href="${esc(s.pdf)}">PDF <small>${mb(s.pdfSize)}</small></a></div></nav>`;
  let src = sinFuentes(readFileSync(join(dir, s.page), 'utf8'));
  if (s.seo) src = src.replace(/<meta name="description"[^>]*>\s*/i, ''); // la descripción corta de sheets.json manda sobre la de la página
  // la T chica con las etapas de la hoja, junto al kicker del hero: el marcador de etapa
  if (!/<p class="kicker">[\s\S]*?<\/p>/.test(src)) fail(`${s.id}: el hero no tiene <p class="kicker">`);
  src = src.replace(/<p class="kicker">[\s\S]*?<\/p>/, (m) => `<div class="hero__top">${m}${miniT(s.etapas)}</div>`);
  src = src.replace(/<body[^>]*>/i, (m) => m + STRIPE);
  src = conLenguaje(src).replace(/<html([^>]*)>/i, (m, a) => `<html${a} data-hoja="${esc(s.id)}"${ATTR_TM}>`); // para los ajustes de una sola hoja en trueml-hojas.css
  // Al imprimir mandan las medidas de la hoja: sus bloques @media print van otra vez después de la capa (que en
  // pantalla agranda rellenos y letras), y detrás los de la capa, para que los colores de TrueML sigan ganando.
  const estilos = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const css = '\n' + TOKENS + '\n' + PIEZAS_CSS + '\n' + HOJAS_CSS + tonoCss(s.tono) + BAR_CSS
    + '\n/* imprimir: las medidas de la hoja y después los colores de TrueML */\n' + bloquesPrint(estilos) + '\n' + bloquesPrint(HOJAS_CSS) + '\n';
  const html = inject(src, s.id, { head: seo(`/${s.id}/`, `${s.title} — ${SITE_NAME}`, s.seo || s.summary, src), css, afterWrap: bar, beforeBody: FOOT + REGISTER + THEME_JS + SCRIPTS_TM });
  mkdirSync(join(OUT, s.id), { recursive: true });
  writeFileSync(join(OUT, s.id, 'index.html'), html);
  copyFileSync(join(dir, s.pdf), join(OUT, s.id, s.pdf));
  pages[`/${s.id}/`] = html;
}

// 2 · portada: la T de vidrio con sus etapas (las enciende vendor/trueml/cliente.js al pasar por una hoja) y una tarjeta por hoja
const card = (s) => `      <article class="sheet t-${esc(s.tono)}" id="${esc(s.id)}" data-etapas="${etapas(s.etapas).join(' ')}" data-nombre="${esc(s.title)}" data-resumen="${esc(resumen(s.etapas))}">
        <div class="strip"><span class="${s.sample_kind === 'math' ? 'math' : 'code'}">${s.sample}</span></div>
        <div class="sheet__body">
          <div class="sheet__h"><p class="topic">${esc(s.topic)}</p>${miniT(s.etapas)}</div>
          <h2><a href="${esc(s.id)}/">${esc(s.title)}</a></h2>
          <p class="sum">${esc(s.summary)}</p>
          <ul class="facts">${s.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
          <div class="actions">
            <a class="btn btn--primary" href="${esc(s.id)}/">Abrir la hoja →</a>
            <a class="btn" href="${esc(s.id)}/${esc(s.pdf)}">PDF <small>${mb(s.pdfSize)}</small></a>
          </div>
          <p class="updated">Actualizada el ${fecha(s.updated)}</p>
        </div>
      </article>`;
let hub = readFileSync(join(SITE, 'hub.html'), 'utf8');
for (const m of ['<!--HOJAS-->', '<!--MARCA-->']) if (!hub.includes(m)) fail(`site/hub.html no tiene el marcador ${m}`);
hub = hub.replace('<!--HOJAS-->', SHEETS.map(card).join('\n'));
// la T con etiquetas si hay espacio; sin ellas en pantallas angostas (lo decide un container query del CSS)
hub = hub.replace('<!--MARCA-->', `<div class="t-con">${marca({ etiquetas: true, clave: 'hub', maxAltura: 'min(calc(100vh - 120px), 760px)' })}</div><div class="t-sin">${TrueMLMark.mark(true, null, 'hub-sin', '420px')}</div>`);
const CLIENTE = readFileSync(join(ROOT, 'vendor', 'trueml', 'cliente.js'), 'utf8');
const homeBar = `<nav class="hub-bar" aria-label="Cheat sheets"><div class="hub-brand"><a class="hub-logo" href="/" aria-label="Portada de las cheat sheets"><span class="hub-mark" aria-hidden="true">${marcaBarra('barra')}</span><span class="hub-word">True<span>ML</span></span></a><span class="hub-sep" aria-hidden="true"></span><span class="hub-home">Cheat sheets</span></div><div class="hub-acc">${THEME_UI}</div></nav>`;
hub = hub.replace(/<html([^>]*)>/i, (m, a) => `<html${a}${ATTR_TM}>`).replace(/<body[^>]*>/i, (m) => m + STRIPE);
hub = inject(hub, 'portada', {
  head: seo('/', SITE_NAME + ' — hojas de estudio para ML engineering', 'Hojas de estudio con PDF: estimaciones, Docker, Kubernetes, Git, Triton, FastAPI, Prometheus y vLLM, con diagnosticadores y revisores en tu navegador.', hub),
  css: '\n' + TOKENS + '\n' + PIEZAS_CSS + BAR_CSS + '\n.hub-stripe { position: absolute; top: 0; left: 0; right: 0; height: 4px; z-index: 30; }\n', afterWrap: homeBar, beforeBody: FOOT + REGISTER + THEME_JS + SCRIPTS_TM + `<script>\n${CLIENTE}</script>`,
});
writeFileSync(join(OUT, 'index.html'), hub);
pages['/'] = hub;

// 3 · service worker, manifest e íconos
const order = ['/', ...SHEETS.map((s) => `/${s.id}/`)];
const hash = createHash('sha256');
for (const f of ['piezas.js', 'codigo.js']) hash.update(readFileSync(join(ROOT, 'vendor', 'trueml', f)));
for (const p of order) hash.update(p).update(pages[p]);
for (const s of SHEETS) hash.update(readFileSync(join(ROOT, 'sheets', s.id, s.pdf)));
const build = hash.digest('hex').slice(0, 12);
const sw = readFileSync(join(SITE, 'sw.js'), 'utf8');
if ((sw.match(/__BUILD__/g) || []).length !== 1 || (sw.match(/__PAGES__/g) || []).length !== 1) fail('site/sw.js debe tener un __BUILD__ y un __PAGES__');
writeFileSync(join(OUT, 'sw.js'), sw.replace('__BUILD__', build).replace('__PAGES__', JSON.stringify(order)));
for (const f of ASSETS) {
  if (!existsSync(join(SITE, f))) fail('falta site/' + f);
  copyFileSync(join(SITE, f), join(OUT, f));
}
for (const f of ['piezas.js', 'codigo.js']) copyFileSync(join(ROOT, 'vendor', 'trueml', f), join(OUT, f));
mkdirSync(join(OUT, 'video'), { recursive: true });
for (const f of ['como-se-usa.mp4', 'como-se-usa.jpg']) {
  if (!existsSync(join(SITE, 'video', f))) fail('falta site/video/' + f);
  copyFileSync(join(SITE, 'video', f), join(OUT, 'video', f));
}
console.log(`[build] dist/ listo · build ${build} · ${SHEETS.length} hojas: ${SHEETS.map((s) => s.id).join(', ')}`);

// 4 · robots.txt y sitemap.xml
const hoy = new Date().toISOString().slice(0, 10);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${order.map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${p === '/' ? hoy : SHEETS.find((s) => `/${s.id}/` === p).updated}</lastmod></url>`).join('\n')}\n</urlset>\n`);
