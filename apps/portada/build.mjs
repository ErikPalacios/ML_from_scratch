#!/usr/bin/env node
// Arma dist/ (lo que sube a Vercel) a partir de site.json y src/. Sin dependencias.
//   index.html, privacidad/index.html, style.css, icon.svg, og.png, robots.txt, sitemap.xml
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));
const fail = (m) => { console.error('[build] ERROR: ' + m); process.exit(1); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date().toISOString().slice(0, 10);

const card = (a) => a.url
  ? `      <a class="card" href="${esc(a.url)}"><span class="tag">${esc(a.tag)}</span><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p><span class="go">${esc(a.cta)} →</span></a>`
  : `      <div class="card soon"><span class="tag">${esc(a.tag)}</span><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></div>`;

const jsonld = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: site.url + '/', inLanguage: 'es',
  description: site.description, author: { '@type': 'Person', name: site.author },
  license: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
}).replace(/</g, '\\u003c');

const vars = {
  NAME: esc(site.name), URL: site.url, TAGLINE: esc(site.tagline), DESC: esc(site.description), AUTHOR: esc(site.author),
  REPO: site.repo, ISSUES: site.issues, YEAR: new Date().getFullYear(), DATE: today, JSONLD: jsonld,
  CARDS: site.apps.map(card).join('\n'),
  ...Object.fromEntries(site.apps.map((a) => ['U_' + a.id, a.url || '#'])),
};
const fill = (t) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in vars)) fail('falta la variable {{' + k + '}}'); return vars[k]; });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'privacidad'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), fill(readFileSync(join(SRC, 'index.html'), 'utf8')));
writeFileSync(join(OUT, 'privacidad', 'index.html'), fill(readFileSync(join(SRC, 'privacidad.html'), 'utf8')));
for (const f of ['style.css', 'icon.svg', 'og.png']) {
  if (!existsSync(join(SRC, f))) fail('falta src/' + f + (f === 'og.png' ? ' (corre npm run og)' : ''));
  copyFileSync(join(SRC, f), join(OUT, f));
}
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`);
const urls = [site.url + '/', site.url + '/privacidad/', ...site.apps.filter((a) => a.url).map((a) => a.url + '/')];
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] dist/ listo · ${site.apps.length} tarjetas · ${urls.length} URLs en el sitemap`);
