#!/usr/bin/env node
// Revisión de los sitios en vivo antes de anunciar: por cada URL del sitemap de cada sitio revisa estado, título,
// descripción, canonical, imagen para redes y los enlaces (internos y externos). Sin dependencias (Node 20+).
// Uso: node tools/qa.mjs            (todos los sitios)   ·   node tools/qa.mjs https://otro.sitio   (solo ese)
const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://ml-desde-cero.vercel.app',
  'https://ronda-diseno-ml.vercel.app',
  'https://cheat-sheets-ml.vercel.app',
  'https://atlas-arquitecturas.vercel.app',
  'https://laboratorio-transformer.vercel.app',
  'https://tablero-ml-demo.vercel.app',
];
const UA = { 'user-agent': 'ml-desde-cero-qa/1.0' };
const problems = [];
const warns = [];
const seen = new Map(); // url → Promise<status>
const status = (url, method = 'HEAD') => {
  const key = method + ' ' + url;
  if (!seen.has(key)) seen.set(key, fetch(url, { method, redirect: 'follow', headers: UA }).then((r) => r.status, () => 0).then(async (s) => (s === 405 || s === 403) && method === 'HEAD' ? status(url, 'GET') : s));
  return seen.get(key);
};
const attr = (tag, name) => { const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? (m[2] ?? m[3]) : null; };
const metaOf = (html, key, val) => { for (const t of html.match(/<meta\b[^>]*>/gi) || []) if (attr(t, key) === val) return attr(t, 'content'); return null; };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function checkPage(site, url) {
  const res = await fetch(url, { redirect: 'follow', headers: UA }).catch(() => null);
  const where = url.replace(site, '') || '/';
  const bad = (m) => problems.push(`${site}${where}: ${m}`);
  if (!res || res.status !== 200) { bad(`estado ${res ? res.status : 'sin respuesta'}`); return { links: 0 }; }
  const html = await res.text();
  const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1];
  if (!title || !title.trim()) bad('sin <title>');
  else if (title.length > 70) bad(`título largo (${title.length})`);
  const desc = metaOf(html, 'name', 'description');
  if (!desc) bad('sin meta description');
  else if (desc.length > 200) bad(`description larga (${desc.length}; Google recorta ~160)`);
  else if (desc.length > 320) bad(`description larga (${desc.length})`);
  else if (desc.length > 200) warns.push(`${site}${where}: description de ${desc.length} caracteres (Google recorta ~160)`);
  const canon = (html.match(/<link\b[^>]*>/gi) || []).map((t) => (attr(t, 'rel') === 'canonical' ? attr(t, 'href') : null)).find(Boolean);
  if (!canon) bad('sin canonical');
  else if (!canon.startsWith(site)) bad(`canonical fuera del sitio: ${canon}`);
  const og = metaOf(html, 'property', 'og:image');
  if (!og) bad('sin og:image');
  else { const s = await status(og); if (s !== 200) bad(`og:image da ${s}: ${og}`); }
  if (!metaOf(html, 'property', 'og:title')) bad('sin og:title');
  if (/noindex/i.test(html)) bad('tiene noindex');
  // enlaces
  const hrefs = new Set();
  for (const t of html.match(/<a\b[^>]*>/gi) || []) {
    const h = attr(t, 'href');
    if (!h || /^(#|mailto:|javascript:|tel:|lab:)/i.test(h)) continue; // lab: es el esquema propio del Atlas (lo resuelve su JavaScript)
    try { hrefs.add(new URL(decode(h), url).href.split('#')[0]); } catch { bad(`enlace roto en sintaxis: ${h}`); }
  }
  await Promise.all([...hrefs].map(async (h) => {
    const s = await status(h);
    if (s === 200) return;
    if ((s === 403 || s === 429) && !h.startsWith(site)) warns.push(`${site}${where}: enlace externo ${s} (suele ser bloqueo a bots): ${h}`);
    else bad(`enlace ${s}: ${h}`);
  }));
  return { links: hrefs.size, bytes: Buffer.byteLength(html) };
}

let pages = 0, links = 0;
for (const site of SITES) {
  const sm = await fetch(site + '/sitemap.xml', { headers: UA }).then((r) => (r.ok ? r.text() : ''), () => '');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(site));
  if (!urls.length) { problems.push(`${site}: sin sitemap.xml o vacío`); urls.push(site + '/'); }
  const robots = await fetch(site + '/robots.txt', { headers: UA }).then((r) => (r.ok ? r.text() : ''), () => '');
  if (!/Sitemap:/i.test(robots)) problems.push(`${site}: robots.txt sin línea Sitemap`);
  for (const u of urls) { const r = await checkPage(site, u); pages++; links += r.links || 0; }
  console.log(`[qa] ${site}: ${urls.length} páginas`);
}
console.log(`[qa] ${pages} páginas, ${links} enlaces revisados`);
if (warns.length) { console.log(`\n${warns.length} aviso(s):`); for (const w of warns) console.log(' · ' + w); }
if (problems.length) { console.log(`\n${problems.length} problema(s):`); for (const p of problems) console.log(' · ' + p); process.exit(1); }
console.log('[qa] todo bien');
