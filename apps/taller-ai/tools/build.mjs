#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html                    portada: el método, la línea de C01 y cómo empezar
//   <caso>/<estacion>/index.html  una página por estación, desde content/estaciones/<caso>-<id>.json
//   kits/<caso>-<estacion>.zip    el kit listo para usar: esqueleto en pipeline/, config.yaml, GUION.md y OBJETIVOS.md
//   sw.js, dojo.css, app.js…      modo sin conexión y estilos (todas las páginas usan el diseño Dojo de TrueML: tools/dojo.mjs)
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { estacion as molde, cruzadas, practica as moldePractica, cruzadasPractica } from './schema.mjs';
import { zip } from './zip.mjs';
import { cuerpoEstacion, cuerpoPractica, cuerpoPortada } from './dojo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const SITE_URL = 'https://taller-ai-engineer.vercel.app'; // cámbiala cuando exista el proyecto o haya dominio propio
const SITE_NAME = "Dojo de entrenamiento ML engineer's";
const fail = (msg) => { console.error('[build] ERROR: ' + msg); process.exit(1); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

// ---------------------------------------------------------------- contenido
const TRONCO = JSON.parse(readFileSync(join(ROOT, 'content', 'tronco.json'), 'utf8'));
// El mapa del C01, copiado de la cheat sheet «Del dato a producción» con tools/importar-mapa.mjs.
const MAPA = JSON.parse(readFileSync(join(ROOT, 'content', 'mapa-c01.json'), 'utf8'));
const HOJA_RECORRIDO = 'https://cheat-sheets-ml.vercel.app/recorrido/';
const ESTACIONES = readdirSync(join(ROOT, 'content', 'estaciones')).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const e = JSON.parse(readFileSync(join(ROOT, 'content', 'estaciones', f), 'utf8'));
  const errs = molde(e, f);
  if (!errs.length) errs.push(...cruzadas(e));
  if (errs.length) fail(`${f} no cumple el molde (corre node tools/validate.mjs):\n  ${errs.join('\n  ')}`);
  e.prompt = Object.fromEntries(Object.entries(e.prompts).map(([k, p]) => [k, readFileSync(join(ROOT, p), 'utf8').trim()]));
  e.slug = `${e.caso}-${e.id}`;
  e.url = `/${e.caso}/${e.id}/`;
  // Las prácticas desde cero: cada una con su página, debajo de la de la estación.
  e.practicas = (e.practicas || []).map((rel) => {
    const p = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
    const perrs = moldePractica(p, rel);
    if (perrs.length) fail(`${rel} no cumple el molde (corre node tools/validate.mjs):\n  ${perrs.join('\n  ')}`);
    p.url = `${e.url}${p.id}/`;
    p.prompt = Object.fromEntries(Object.entries(p.prompts).map(([k, r]) => [k, readFileSync(join(ROOT, r), 'utf8').trim()]));
    return p;
  }).sort((a, b) => a.orden - b.orden);
  const conocidos = new Set([...e.conceptos.map((c) => c.id), ...e.practicas.flatMap((p) => p.conceptos.map((c) => c.id))]);
  const perrs = e.practicas.flatMap((p) => cruzadasPractica(p, conocidos, (r) => existsSync(join(ROOT, r))));
  if (perrs.length) fail(`${f}: ${perrs.join('\n  ')}`);
  // el código que viene de la solución probada se lee aquí, ya validado
  e.practicas.forEach((p) => p.pasos.forEach((x) => x.codigo.forEach((c) => { if (c.desde) c.code = readFileSync(join(ROOT, c.desde), 'utf8').replace(/\n$/, ''); })));
  return e;
});

// ---------------------------------------------------------------- piezas de HTML
function pagina({ path, title, desc, body }) {
  const url = SITE_URL + path;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<script>try { var t = localStorage.getItem('taller-tema'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:locale" content="es_MX"><meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:image" content="${SITE_URL}/og.png">
<meta name="theme-color" content="#EDEFF7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0A0F22" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/dojo.css">
</head>
<body class="dojo">
${body}
<script src="/app.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- portada
function portada() {
  const lista = new Map(ESTACIONES.filter((e) => e.caso === TRONCO.caso).map((e) => [e.id, e]));
  return pagina({ path: '/', title: `${SITE_NAME} · TrueML`, desc: 'Proyectos chicos de ML engineering que construyes, rehaces y rompes en tu Mac, estación por estación del camino del dato a producción. En español, gratis.',
    body: cuerpoPortada({ tronco: TRONCO, lista, mapa: MAPA, hoja: HOJA_RECORRIDO }) });
}

// ---------------------------------------------------------------- kit
const sinHtml = (s) => s.replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<code>(.*?)<\/code>/g, '`$1`').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function guion(e) {
  const out = [`# Guion · ${e.caso.toUpperCase()} · ${e.titulo}`, '', `Ronda Guiado. ${sinHtml(e.pregunta)}`, ''];
  const precalculos = () => {
    out.push('## Precálculos', '', sinHtml(e.precalculos.intro), '');
    e.precalculos.cuentas.forEach((x, i) => {
      out.push(`### ${i + 1}. ${sinHtml(x.pregunta)}`, '', `**Fórmula:** ${x.formula}`, '',
        `- **En C01:** ${sinHtml(x.c01.cuenta)} → ${sinHtml(x.c01.valor)}`, `- **En el dojo:** ${sinHtml(x.taller.cuenta)} → ${sinHtml(x.taller.valor)}`, '',
        `**Qué decides:** ${sinHtml(x.decide)}`, '');
      if (x.comprueba) out.push('```bash', x.comprueba.code, '```', ...(x.comprueba.nota ? ['', sinHtml(x.comprueba.nota)] : []), '');
      if (x.confirma) out.push(`**Lo confirmas en:** ${sinHtml(x.confirma)}`, '');
    });
  };
  for (const p of e.guiado) {
    if (p.n === 1) precalculos();
    out.push(`## Paso ${p.n} · ${p.titulo}`, '', `**Objetivo:** ${sinHtml(p.objetivo)}`, '', sinHtml(p.explica), '');
    for (const c of p.codigo) out.push(`\`${c.path || c.lang}\``, '', '```' + c.lang, c.code, '```', ...(c.nota ? ['', sinHtml(c.nota)] : []), '');
    for (const c of p.comandos) out.push('```bash', c.code, '```', ...(c.nota ? ['', sinHtml(c.nota)] : []), '');
    out.push(`**Listo cuando:** ${sinHtml(p.verifica)}`, '');
    if (p.ojo) out.push(`**Ojo:** ${sinHtml(p.ojo)}`, '');
  }
  return out.join('\n');
}

function objetivos(e) {
  return [`# Objetivos · ${e.caso.toUpperCase()} · ${e.titulo}`, '', 'Ronda Solo. Sin código: cada objetivo tiene su check en verificar.py.', '',
    ...e.solo.reglas.map((r) => `- ${sinHtml(r)}`), '',
    ...e.solo.objetivos.map((o) => `${o.n}. ${sinHtml(o.objetivo)} → \`python verificar.py ${o.check}\``), ''].join('\n');
}

function archivosKit(e) {
  const base = join(ROOT, 'kits', e.slug);
  const fuera = /(^|\/)(data|\.taller|\.venv|\.respaldo|__pycache__)(\/|$)|\.pyc$|\.DS_Store$/;
  const archivos = [];
  const recorrer = (dir) => {
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n), rel = relative(base, p);
      if (fuera.test(rel)) continue;
      if (statSync(p).isDirectory()) recorrer(p);
      else archivos.push({ rel, data: readFileSync(p) });
    }
  };
  recorrer(base);
  // el esqueleto de pipeline/ y config.yaml en su lugar: el kit abre listo para el paso 0
  const esq = join(base, 'mundo', 'esqueleto');
  for (const n of readdirSync(join(esq, 'pipeline')).sort()) archivos.push({ rel: `pipeline/${n}`, data: readFileSync(join(esq, 'pipeline', n)) });
  archivos.push({ rel: 'config.yaml', data: readFileSync(join(esq, 'config.yaml')) });
  archivos.push({ rel: 'GUION.md', data: Buffer.from(guion(e)) });
  archivos.push({ rel: 'OBJETIVOS.md', data: Buffer.from(objetivos(e)) });
  archivos.sort((a, b) => a.rel.localeCompare(b.rel));
  return archivos.map((a) => ({ name: `${e.slug}/${a.rel}`, data: a.data, mode: /\.(py|sh)$/.test(a.rel) && a.data.slice(0, 2).toString() === '#!' ? 0o755 : 0o644 }));
}

// ---------------------------------------------------------------- escribir
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'kits'), { recursive: true });
const pages = {};
for (const e of ESTACIONES) {
  if (!existsSync(join(ROOT, 'kits', e.slug))) fail(`falta kits/${e.slug}`);
  const z = zip(archivosKit(e));
  writeFileSync(join(OUT, 'kits', `${e.slug}.zip`), z);
  e.versionTxt = fecha(e.version);
  pages[e.url] = pagina({ path: e.url, title: `${e.titulo} · ${e.caso.toUpperCase()} · ${SITE_NAME}`, desc: `${e.pregunta} Un mini-proyecto para construir, rehacer y romper en tu Mac.`,
    body: cuerpoEstacion(e, { total: TRONCO.estaciones.length, kitBytes: z.length, kb }) });
  mkdirSync(join(OUT, e.caso, e.id), { recursive: true });
  writeFileSync(join(OUT, e.caso, e.id, 'index.html'), pages[e.url]);
  console.log(`[build] ${e.url} · kit ${kb(z.length)}`);
  for (const p of e.practicas) {
    pages[p.url] = pagina({ path: p.url, title: `${p.titulo} · ${e.titulo} · ${SITE_NAME}`, desc: `${p.subtitulo} Práctica desde cero de la estación ${e.num} de C01.`,
      body: cuerpoPractica(e, p) });
    mkdirSync(join(OUT, e.caso, e.id, p.id), { recursive: true });
    writeFileSync(join(OUT, e.caso, e.id, p.id, 'index.html'), pages[p.url]);
    console.log(`[build] ${p.url}`);
  }
}
pages['/'] = portada();
writeFileSync(join(OUT, 'index.html'), pages['/']);
for (const f of ['dojo.css', 'app.js', 'icon.svg', 'manifest.webmanifest', 'og.png']) copyFileSync(join(ROOT, 'site', f), join(OUT, f));

const urls = ['/', ...ESTACIONES.flatMap((e) => [e.url, ...e.practicas.map((p) => p.url)])];
const core = [...urls, '/dojo.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];
const hash = createHash('sha256');
for (const p of Object.keys(pages).sort()) hash.update(p).update(pages[p]);
for (const f of ['dojo.css', 'app.js']) hash.update(readFileSync(join(ROOT, 'site', f)));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(ROOT, 'site', 'sw.js'), 'utf8').replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] listo: ${Object.keys(pages).length} páginas · BUILD ${BUILD}`);
