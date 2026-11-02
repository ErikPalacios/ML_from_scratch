#!/usr/bin/env node
// Builds dist/: the production board's web/ (apps/tablero-ml/web) + the demo layer in web/ of this app.
//   - js/demo-boot.js   in-browser «server» with the sample project (window.TABLERO_API, used by sync.js)
//   - js/demo-banner.js banner + reset button
//   - index.html        indexable, with canonical / Open Graph / Twitter tags; the demo scripts are added
//   - sw.js, robots.txt, sitemap.xml, og.png, vercel.json (same security headers as production, no API)
// No dependencies. The result is a static site: deploy dist/ (see tools/deploy.mjs).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOARD = join(ROOT, '..', 'tablero-ml', 'web');
const DEMO = join(ROOT, 'web');
const DIST = join(ROOT, 'dist');
const SITE_URL = 'https://tablero-ml-demo.vercel.app';
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
swap('<script type="module" src="/js/app.js"></script>', '<script type="module" src="/js/demo-boot.js"></script>\n<script type="module" src="/js/demo-banner.js"></script>\n<script type="module" src="/js/app.js"></script>');
writeFileSync(join(DIST, 'index.html'), html);

// banner styles + no logout in the demo
const css = readFileSync(join(DIST, 'app.css'), 'utf8') + `
/* demo */
#logout { display: none !important; }
.demo-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 16px; padding: 8px 16px; background: var(--accent-soft, rgba(31, 95, 174, .12)); border-bottom: 1px solid var(--rule, rgba(128, 138, 152, .35)); font-size: 14px; }
.demo-banner p { margin: 0; }
.demo-banner__links { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
`;
writeFileSync(join(DIST, 'app.css'), css);

// service worker: same as production, with the demo's files in the list
const files = walk(DIST).filter((f) => !f.endsWith('sw.js')).map((f) => relative(DIST, f).split('\\').join('/')).sort();
const hash = createHash('sha256');
for (const rel of files) hash.update(rel).update(readFileSync(join(DIST, rel)));
const build = hash.digest('hex').slice(0, 12);
const assets = ['/', ...files.map((f) => '/' + f).filter((p) => !['/index.html', '/robots.txt', '/sitemap.xml', '/vercel.json'].includes(p))];
const sw = readFileSync(join(BOARD, 'sw.js'), 'utf8');
if (!sw.includes("'__BUILD__'") || !sw.includes('__ASSETS__')) fail('tablero-ml/web/sw.js changed: markers not found');
writeFileSync(join(DIST, 'sw.js'), sw.replace("'__BUILD__'", JSON.stringify(build)).replace('__ASSETS__', JSON.stringify(assets)));

// crawlers and headers
writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_URL}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`);
const prod = JSON.parse(readFileSync(join(ROOT, '..', 'tablero-ml', 'vercel.json'), 'utf8'));
const config = { framework: null, trailingSlash: false, headers: prod.headers };
writeFileSync(join(DIST, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`[build] dist/ · ${files.length + 1} files · BUILD ${build}`);
