#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html          = site/hub.html con una tarjeta por hoja de sheets.json
//   <id>/index.html     = la página de la hoja (sheets/<id>/<page>) + barra para volver a la portada
//   <id>/<pdf>          = el PDF de la hoja
//   sw.js               = site/sw.js con el hash del build y la lista de páginas (abre sin conexión)
//   manifest e íconos   = copiados de site/
// Las páginas de las hojas ya vienen con las fórmulas en MathML: se generan con sheets/<id>/fuentes/.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

// Tema elegido a mano (claro u oscuro): se aplica antes de pintar, para que no parpadee. Sin elección, la página sigue
// al sistema. Cada hoja ya trae sus dos paletas: la oscura vive en @media (prefers-color-scheme: dark) con el guardia
// :root:not([data-theme="light"]) y otra vez en :root[data-theme="dark"], así que basta con poner data-theme en <html>.
const THEME_KEY = 'hojas-tema';
const HEAD = [
  `<script>try { var t = localStorage.getItem('${THEME_KEY}'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>`,
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<link rel="icon" href="/icon.svg" type="image/svg+xml">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<meta name="theme-color" content="#F4F6F9" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#0E131A" media="(prefers-color-scheme: dark)">',
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
    metas.forEach(function (m, i) { m.setAttribute('content', t === 'auto' ? orig[i] : (t === 'dark' ? '#0E131A' : '#F4F6F9')); });
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
// Barra de cada hoja: volver a la portada y bajar el PDF. Usa los tokens de color de la hoja.
const BAR_CSS = `
body { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
.hub-bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px 16px; padding-top: 14px; font: 600 14.5px/1.3 var(--f-display); }
.hub-bar a { color: var(--accent); text-decoration: none; display: inline-flex; align-items: center; min-height: 40px; }
.hub-bar a:hover { text-decoration: underline; }
.hub-bar a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }
.hub-bar .hub-pdf { border: 1px solid var(--rule); background: var(--paper); border-radius: 999px; padding: 0 14px; color: var(--ink); }
.hub-bar .hub-pdf:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; }
.hub-bar + .hero { padding-top: 22px; }
.hub-bar--home { justify-content: flex-end; }
.hub-acc { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.tema { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--rule); border-radius: 999px; background: var(--paper); }
.tema button { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font: 600 13.5px/1 var(--f-display); cursor: pointer; }
.tema button svg { width: 16px; height: 16px; flex: none; }
.tema button:hover { color: var(--ink); }
.tema button[aria-pressed="true"] { background: var(--accent); color: var(--paper); }
.tema button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 480px) {
  .tema button { padding: 0 10px; }
  .tema button span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
}
.hub-credit { max-width: 960px; margin: 40px auto 0; padding: 20px 16px 36px; border-top: 1px solid rgba(128, 138, 152, .3); text-align: center; font: 13.5px/1.5 var(--f-body, system-ui, sans-serif); opacity: .8; }
.hub-credit p { margin: 0; }
@media print { .hub-bar { display: none !important; } }
`;

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
  for (const k of ['id', 'title', 'topic', 'summary', 'sample', 'sample_kind', 'facts', 'page', 'pdf', 'updated']) if (!(k in s)) fail(`la hoja ${s.id || '?'} no tiene "${k}" en sheets.json`);
  if (!/^[a-z0-9-]+$/.test(s.id) || ids.has(s.id)) fail(`id inválido o repetido: ${s.id}`);
  ids.add(s.id);
  const dir = join(ROOT, 'sheets', s.id);
  for (const f of [s.page, s.pdf]) if (!existsSync(join(dir, f))) fail(`falta sheets/${s.id}/${f}`);
  s.pdfSize = statSync(join(dir, s.pdf)).size;
  const bar = `<nav class="hub-bar" aria-label="Cheat sheets"><a href="/">← Todas las cheat sheets</a><div class="hub-acc">${THEME_UI}<a class="hub-pdf" href="${esc(s.pdf)}">PDF · ${mb(s.pdfSize)}</a></div></nav>`;
  const src = readFileSync(join(dir, s.page), 'utf8');
  const html = inject(src, s.id, { head: seo(`/${s.id}/`, `${s.title} — ${SITE_NAME}`, s.summary, src), css: BAR_CSS, afterWrap: bar, beforeBody: FOOT + REGISTER + THEME_JS });
  mkdirSync(join(OUT, s.id), { recursive: true });
  writeFileSync(join(OUT, s.id, 'index.html'), html);
  copyFileSync(join(dir, s.pdf), join(OUT, s.id, s.pdf));
  pages[`/${s.id}/`] = html;
}

// 2 · portada
const card = (s) => `    <article class="sheet" id="${esc(s.id)}">
      <div class="strip"><span class="${s.sample_kind === 'math' ? 'math' : 'code'}">${s.sample}</span></div>
      <div class="sheet__body">
        <p class="topic">${esc(s.topic)}</p>
        <h2><a href="${esc(s.id)}/">${esc(s.title)}</a></h2>
        <p class="sum">${esc(s.summary)}</p>
        <ul class="facts">${s.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="actions">
          <a class="btn btn--primary" href="${esc(s.id)}/">Abrir la hoja</a>
          <a class="btn" href="${esc(s.id)}/${esc(s.pdf)}">PDF <small>${mb(s.pdfSize)}</small></a>
        </div>
        <p class="updated">Actualizada el ${fecha(s.updated)}</p>
      </div>
    </article>`;
let hub = readFileSync(join(SITE, 'hub.html'), 'utf8');
if (!hub.includes('<!--HOJAS-->')) fail('site/hub.html no tiene el marcador <!--HOJAS-->');
hub = hub.replace('<!--HOJAS-->', SHEETS.map(card).join('\n'));
hub = inject(hub, 'portada', {
  head: seo('/', SITE_NAME + ' — hojas de estudio para ML engineering', 'Hojas de estudio con versión web y PDF: estimaciones, Docker, Kubernetes, Git y Actions, Triton, FastAPI, Prometheus y vLLM, con diagnosticadores y revisores que corren en tu navegador.', hub),
  css: BAR_CSS, afterWrap: `<nav class="hub-bar hub-bar--home" aria-label="Preferencias">${THEME_UI}</nav>`, beforeBody: FOOT + REGISTER + THEME_JS,
});
writeFileSync(join(OUT, 'index.html'), hub);
pages['/'] = hub;

// 3 · service worker, manifest e íconos
const order = ['/', ...SHEETS.map((s) => `/${s.id}/`)];
const hash = createHash('sha256');
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
console.log(`[build] dist/ listo · build ${build} · ${SHEETS.length} hojas: ${SHEETS.map((s) => s.id).join(', ')}`);

// 4 · robots.txt y sitemap.xml
const hoy = new Date().toISOString().slice(0, 10);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${order.map((p) => `  <url><loc>${SITE_URL}${p}</loc><lastmod>${p === '/' ? hoy : SHEETS.find((s) => `/${s.id}/` === p).updated}</lastmod></url>`).join('\n')}\n</urlset>\n`);
