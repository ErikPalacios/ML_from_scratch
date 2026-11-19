#!/usr/bin/env node
// Builds dist/: the production board's web/ (apps/tablero-ml/web) + the demo layer in web/ of this app.
//   - js/demo-boot.js   in-browser «server» with the sample project (window.TABLERO_API, used by sync.js)
//   - js/demo-banner.js banner + reset button
//   - js/demo-video.js  «Cómo se usa» section on the home route: tutorial video (video/como-se-usa.mp4) + chapters
//   - index.html        indexable, with canonical / Open Graph / Twitter tags; the demo scripts are added
//   - sw.js (never touches the .mp4: range requests go straight to the network), robots.txt, sitemap.xml, og.png, vercel.json (same security headers as production, no API)
// No dependencies. The result is a static site: deploy dist/ (see tools/deploy.mjs).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = join(ROOT, '..', 'tablero-ml', 'web');
const DEMO = join(ROOT, 'web');
const DIST = join(ROOT, 'dist');
const SITE_URL = 'https://tablero.trueml.app';
const fail = (m) => { console.error('[build] ERROR: ' + m); process.exit(1); };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const copyTree = (from, skip = () => false) => {
  for (const f of walk(from)) {
    const rel = relative(from, f);
    if (f.endsWith('.DS_Store') || skip(rel)) continue;
    mkdirSync(dirname(join(DIST, rel)), { recursive: true });
    copyFileSync(f, join(DIST, rel));
  }
};

if (!existsSync(BOARD)) fail('missing ../tablero-ml/web');
rmSync(DIST, { recursive: true, force: true });
// The real C01 preload (seed-c01*.mjs) holds the author's own project data: the demo never ships it. The stub keeps
// the module graph working (migrate.mjs and app.js import it) and hides the «Load C01» card (SEED_C01_INFO = null).
const PRIVATE = new Set(['js/shared/seed-c01.mjs', 'js/shared/seed-c01-v1.mjs']);
copyTree(BOARD, (rel) => rel === 'sw.js' || rel === 'index.html' || PRIVATE.has(rel));
writeFileSync(join(DIST, 'js', 'shared', 'seed-c01.mjs'), `// Demo stub: the real C01 preload is not part of the public demo.
export const SEED_C01_INFO = null;
export const seedC01 = () => { throw new Error('not available in the demo'); };
export const upgradeSeedC01 = (d) => d;
`);
copyTree(DEMO);

// index.html
let html = readFileSync(join(BOARD, 'index.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) fail('index.html no longer contains: ' + from.slice(0, 60)); html = html.replace(from, to); };
const DESC = 'Live demo of an ML project board: every project as a map from data to monitoring, with entry-gate sizing per step. A made-up sample project you can edit; nothing leaves your browser.';
swap('<title>ML Board</title>', '<title>ML Board — live demo</title>');
swap(/<meta name="description" content="[^"]*">/.exec(html)[0], `<meta name="description" content="${DESC}">`);
swap('<meta name="robots" content="noindex, nofollow">', [
  `<link rel="canonical" href="${SITE_URL}/">`,
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="ML desde cero">',
  '<meta property="og:title" content="ML Board — live demo">',
  `<meta property="og:description" content="${DESC}">`,
  `<meta property="og:url" content="${SITE_URL}/">`,
  `<meta property="og:image" content="${SITE_URL}/og.png">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:title" content="ML Board — live demo">',
  `<meta name="twitter:description" content="${DESC}">`,
  `<meta name="twitter:image" content="${SITE_URL}/og.png">`,
].join('\n'));
swap('<script type="module" src="/js/app.js"></script>', '<script type="module" src="/js/demo-boot.js"></script>\n<script type="module" src="/js/demo-banner.js"></script>\n<script type="module" src="/js/demo-video.js"></script>\n<script type="module" src="/js/app.js"></script>');
writeFileSync(join(DIST, 'index.html'), html);

// banner styles + no logout in the demo
const css = readFileSync(join(DIST, 'app.css'), 'utf8') + `
/* demo */
#logout { display: none !important; }
.demo-banner { max-width: 1120px; margin: 14px auto 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 16px; padding: 10px 10px 10px 18px; background: var(--tm-card, #fff); border-radius: 16px; box-shadow: var(--shadow, 0 0 0 1px rgba(14, 21, 48, .08)), inset 4px 0 0 var(--yt, #FFC857); font: 14px/1.45 var(--sans, system-ui, sans-serif); color: var(--ink2, #3A4364); }
.demo-banner strong { color: var(--ink, #0E1530); }
.demo-banner p { margin: 0; }
.demo-banner__links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; font-weight: 600; }
/* demo: «Cómo se usa» (js/demo-video.js), outside #app, below the home view */
.demo-video { margin-top: 28px; scroll-margin-top: 76px; }
.demo-video__card { display: grid; gap: 14px; }
.demo-video__head { display: grid; gap: 8px; justify-items: start; }
.demo-video__head h2 { margin: 4px 0 0; font-size: clamp(22px, 3vw, 28px); letter-spacing: -0.02em; }
.demo-video__head h2:focus { outline: none; }
.demo-video__head h2:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.demo-video__head p { margin: 0; }
.demo-video__lead { color: var(--ink2); max-width: 62ch; text-wrap: pretty; }
.demo-video__frame { aspect-ratio: 16 / 9; width: 100%; border-radius: 14px; overflow: hidden; background: #0A0F22; box-shadow: 0 0 0 1px var(--rule); }
.demo-video__frame video { display: block; width: 100%; height: 100%; object-fit: contain; background: #0A0F22; }
.demo-video__k { margin: 4px 0 0; }
@media (max-width: 520px) { .demo-video .demo-video__card { padding: 14px; } .demo-video__frame { border-radius: 10px; } }
.demo-video__chapters { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.demo-video__chapters button { width: 100%; height: 100%; min-height: 40px; display: flex; align-items: baseline; gap: 6px; text-align: left; padding: 8px 12px; border-radius: 10px;
  border: 1px solid var(--rule); background: var(--paper); color: var(--ink); font: 600 14.5px/1.3 var(--f-display); cursor: pointer; touch-action: manipulation; }
.demo-video__chapters button:hover { border-color: var(--accent); }
.demo-video__chapters button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.demo-video__chapters button[aria-current="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-ink); }
.demo-video__t { font: 600 13px var(--f-mono); color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
.demo-video__chapters button[aria-current="true"] .demo-video__t { color: inherit; }
`;
writeFileSync(join(DIST, 'app.css'), css);

// service worker: same as production, with the demo's files in the list
const files = walk(DIST).filter((f) => !f.endsWith('sw.js')).map((f) => relative(DIST, f).split('\\').join('/')).sort();
const hash = createHash('sha256');
for (const rel of files) hash.update(rel).update(readFileSync(join(DIST, rel)));
const build = hash.digest('hex').slice(0, 12);
// the tutorial video is never precached (14 MB) and the fetch handler lets it through untouched: a cached copy would
// break the range requests the browser uses to stream and seek it. The poster (a small jpg) is precached like any image.
const assets = ['/', ...files.map((f) => '/' + f).filter((p) => !['/index.html', '/robots.txt', '/sitemap.xml', '/vercel.json'].includes(p) && !p.endsWith('.mp4'))];
let sw = readFileSync(join(BOARD, 'sw.js'), 'utf8');
if (!sw.includes("'__BUILD__'") || !sw.includes('__ASSETS__')) fail('tablero-ml/web/sw.js changed: markers not found');
const API_LINE = "  if (url.pathname.startsWith('/api/')) return; // datos: siempre a la red\n";
if (!sw.includes(API_LINE)) fail('tablero-ml/web/sw.js changed: the /api/ early return was not found');
sw = sw.replace(API_LINE, API_LINE + "  if (url.pathname.endsWith('.mp4')) return; // demo: el video va directo a la red (peticiones por rangos)\n");
writeFileSync(join(DIST, 'sw.js'), sw.replace("'__BUILD__'", JSON.stringify(build)).replace('__ASSETS__', JSON.stringify(assets)));

// crawlers and headers
// La mudanza a trueml.app: la página que lleva el avance de la dirección *.vercel.app vieja a la nueva (ver vendor/trueml/mudanza.js).
for (const f of ['mudanza.html', 'mudanza.js']) copyFileSync(join(BOARD, 'vendor', 'trueml', f), join(DIST, f));
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
const prod = JSON.parse(readFileSync(join(ROOT, '..', 'tablero-ml', 'vercel.json'), 'utf8'));
// Las redirecciones (la mudanza a trueml.app) salen del vercel.json de esta carpeta, el mismo que usa el deploy desde GitHub.
const config = { framework: null, trailingSlash: false, redirects: JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).redirects, headers: prod.headers };
writeFileSync(join(DIST, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`[build] dist/ · ${files.length + 1} files · BUILD ${build}`);
