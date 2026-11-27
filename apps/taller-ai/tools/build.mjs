#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html                     portada: el selector de entrenamientos (clasificación C01, RAG…), cuál elegir y cómo se usa
//   c01/index.html, <rama>/index.html  la página de cada entrenamiento: su caso, su mapa y sus estaciones
//   <linea>/<estacion>/index.html  una página por estación, desde content/estaciones/<linea>-<id>.json; la línea es el
//                                  caso del tronco (c01) o una rama de content/ramas.json (ia-privada): tools/lineas.mjs
//   kits/<linea>-<estacion>.zip    el kit listo para usar: esqueleto en pipeline/, config.yaml, GUION.md y OBJETIVOS.md
//   tablero/index.html            «Tu tablero»: tu avance por estación, en este navegador (tools/tablero.mjs, site/tablero/)
//   video/como-se-usa.mp4 y .jpg  el video «Cómo se usa» de la portada y su póster (site/video/, fuera de la caché)
//   sw.js, dojo.css, app.js…      modo sin conexión y estilos (todas las páginas usan el diseño Dojo de TrueML: tools/dojo.mjs)
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { estacion as molde, cruzadas, practica as moldePractica, cruzadasPractica, normalizar, normalizarPractica } from './schema.mjs';
import { TRONCO, RAMAS, LINEAS, revisarRamas, cruzadasLinea, enLinea } from './lineas.mjs';
import { zip } from './zip.mjs';
import { cuerpoEstacion, cuerpoPractica, cuerpoPortada, cuerpoProyecto, cuerpoTronco, cuerpoRama } from './dojo.mjs';
import { plantillaTablero, cuerpoTablero } from './tablero.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const SITE_URL = 'https://dojo.trueml.app'; // cámbiala cuando exista el proyecto o haya dominio propio
const SITE_NAME = "Dojo de entrenamiento ML engineer's";
const fail = (msg) => { console.error('[build] ERROR: ' + msg); process.exit(1); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

// ---------------------------------------------------------------- contenido
{ const errs = revisarRamas(); if (errs.length) fail(`content/ramas.json:\n  ${errs.join('\n  ')}`); }
// El mapa del C01, copiado de la cheat sheet «Del dato a producción» con tools/importar-mapa.mjs.
const MAPA = JSON.parse(readFileSync(join(ROOT, 'content', 'mapa-c01.json'), 'utf8'));
const HOJA_RECORRIDO = 'https://hojas.trueml.app/recorrido/';
// La teoría de cada estación en Sensei (lección y requisitos), generada por apps/trueml/sync.mjs.
const SENSEI = JSON.parse(readFileSync(join(ROOT, 'content', 'sensei.json'), 'utf8'));
// por línea y número («c01:7»): hoy Sensei enlaza solo las del tronco
const SENSEI_POR_EST = new Map(SENSEI.estaciones.map((x) => [`${x.linea || TRONCO.caso}:${x.num}`, x]));
const SENSEI_TRONCO = new Map(SENSEI.estaciones.filter((x) => (x.linea || TRONCO.caso) === TRONCO.caso).map((x) => [x.num, x]));
const ESTACIONES = readdirSync(join(ROOT, 'content', 'estaciones')).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const e = JSON.parse(readFileSync(join(ROOT, 'content', 'estaciones', f), 'utf8'));
  const errs = molde(e, f);
  if (!errs.length) errs.push(...cruzadas(e));
  if (!errs.length) errs.push(...cruzadasLinea(e));
  if (errs.length) fail(`${f} no cumple el molde (corre node tools/validate.mjs):\n  ${errs.join('\n  ')}`);
  enLinea(normalizar(e));   // slug, url, línea y etapa de la T; c01 → ref
  e.prompt = Object.fromEntries(Object.entries(e.prompts).map(([k, p]) => [k, readFileSync(join(ROOT, p), 'utf8').trim()]));
  e.sensei = SENSEI_POR_EST.get(`${e.linea.id}:${e.num}`) || null;
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
  e.practicas.forEach(normalizarPractica);   // c01 → ref, ya validadas
  // el código que viene de la solución probada se lee aquí, ya validado
  e.practicas.forEach((p) => p.pasos.forEach((x) => x.codigo.forEach((c) => { if (c.desde) c.code = readFileSync(join(ROOT, c.desde), 'utf8').replace(/\n$/, ''); })));
  // con prácticas, el proyecto con kit tiene su propia página; sin prácticas, vive en la de la estación
  e.kitUrl = e.practicas.length ? `${e.url}proyecto-con-kit/` : e.url;
  return e;
});

// ---------------------------------------------------------------- piezas de HTML
// lectura: las páginas de estación, de proyecto y de práctica llevan «Marcar como leída», el tanque de avance y notas (piezas.js)
// Descripciones para buscadores escritas a mano (content/seo.json): ganan a la automática, que a veces pasa de 160.
const SEO = JSON.parse(readFileSync(join(ROOT, 'content', 'seo.json'), 'utf8')).descripciones;
const SEO_USADAS = new Set();
// En el <title> va la marca corta: Google muestra unos 60 caracteres y el nombre largo del Dojo se comía la mitad.
const MARCA_CORTA = 'Dojo TrueML';
function pagina({ path, title, desc, body, lectura = false }) {
  const url = SITE_URL + path;
  if (SEO[path]) { desc = SEO[path]; SEO_USADAS.add(path); }
  return `<!doctype html>
<html lang="es" data-tm-herramienta="Dojo" data-tm-inicio="/" data-tm-clave="dojo" data-tm-portada="https://trueml.app/"${lectura ? ' data-tm-avance=".d-main .d-sec[id]" data-tm-notas=".d-main" data-tm-tanque-en=".d-hero"' : ''}>
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
<script src="/codigo.js" defer></script>
<script src="/piezas.js" defer></script>
<script src="/app.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- portada y entrenamientos
// Una estación de una rama puede ser la misma que la de otra línea («misma»: "<línea>/<id>"): no tiene página propia,
// abre la de la otra línea (la 7 del RAG es la 1 de IA Privada).
const deLinea = (id) => {
  const m = new Map(ESTACIONES.filter((e) => e.linea.id === id).map((e) => [e.id, e]));
  for (const s of (RAMAS.find((r) => r.id === id) || {}).estaciones || []) {
    if (!s.misma) continue;
    const [l, sid] = s.misma.split('/');
    const e = ESTACIONES.find((x) => x.linea.id === l && x.id === sid);
    if (!e) throw new Error(`ramas.json: la estación ${s.num} de ${id} dice ser la misma que ${s.misma}, y esa no existe`);
    m.set(s.id, e);
  }
  return m;
};
const RAMAS_L = RAMAS.map((r) => ({ ...r, lista: deLinea(r.id) }));
function portada() {
  return pagina({ path: '/', title: `${SITE_NAME} · TrueML`, desc: 'Elige un entrenamiento (clasificación de imágenes o RAG) y constrúyelo de punta a punta en tu Mac, estación por estación: con ayuda, solo y rompiéndolo. En español, gratis.',
    body: cuerpoPortada({ tronco: TRONCO, lista: deLinea(TRONCO.caso), ramas: RAMAS_L }) });
}
function paginaTronco() {
  return pagina({ path: `/${TRONCO.caso}/`, title: `${TRONCO.entrenamiento} · ${TRONCO.caso.toUpperCase()} · ${MARCA_CORTA}`, desc: 'Un clasificador de fotos de punta a punta, del dato etiquetado al modelo en producción, en 12 estaciones que corren en tu Mac.',
    body: cuerpoTronco({ tronco: TRONCO, lista: deLinea(TRONCO.caso), ramas: RAMAS_L, mapa: MAPA, hoja: HOJA_RECORRIDO, sensei: SENSEI_TRONCO }) });
}
function paginaRama(r) {
  return pagina({ path: `/${r.id}/`, title: `${r.entrenamiento || r.nombre}${r.caso.codigo ? ' · ' + r.caso.codigo : ''} · ${MARCA_CORTA}`, desc: r.resumen,
    body: cuerpoRama(r, { tronco: TRONCO, listaTronco: deLinea(TRONCO.caso), ramas: RAMAS_L }) });
}

// ---------------------------------------------------------------- kit
const sinHtml = (s) => s.replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<code>(.*?)<\/code>/g, '`$1`').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function guion(e) {
  const out = [`# Guion · ${e.linea.corto} · ${e.titulo}`, '', `Ronda Guiado. ${sinHtml(e.pregunta)}`, ''];
  const precalculos = () => {
    out.push('## Precálculos', '', sinHtml(e.precalculos.intro), '');
    e.precalculos.cuentas.forEach((x, i) => {
      out.push(`### ${i + 1}. ${sinHtml(x.pregunta)}`, '', `**Fórmula:** ${x.formula}`, '',
        `- **${e.linea.escala}:** ${sinHtml(x.ref.cuenta)} → ${sinHtml(x.ref.valor)}`, `- **En el dojo:** ${sinHtml(x.taller.cuenta)} → ${sinHtml(x.taller.valor)}`, '',
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
  return [`# Objetivos · ${e.linea.corto} · ${e.titulo}`, '', 'Ronda Solo. Sin código: cada objetivo tiene su check en verificar.py.', '',
    ...e.solo.reglas.map((r) => `- ${sinHtml(r)}`), '',
    ...e.solo.objetivos.map((o) => `${o.n}. ${sinHtml(o.objetivo)} → \`${e.mundo.python || 'python'} verificar.py ${o.check}\``), ''].join('\n');
}

function archivosKit(e) {
  const base = join(ROOT, 'kits', e.slug);
  const fuera = /(^|\/)(data|fuentes|almacen|chunks|indice|indices|cache|corridas|golden|modelo|\.taller|\.venv|\.respaldo|__pycache__|\.forja|\.nube|\.pytest_cache|\.ruff_cache)(\/|$)|\.pyc$|\.DS_Store$/;
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
  // el esqueleto en su lugar (lo que escribe la persona, con su contrato): el kit abre listo para el paso 0
  const esq = join(base, 'mundo', 'esqueleto');
  const enEsq = (dir) => readdirSync(dir).sort().flatMap((n) => statSync(join(dir, n)).isDirectory() ? enEsq(join(dir, n)) : [join(dir, n)]);
  if (existsSync(esq)) for (const f of enEsq(esq)) archivos.push({ rel: relative(esq, f), data: readFileSync(f) });
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
  pages[e.url] = pagina({ path: e.url, title: `${e.titulo} · ${e.linea.corto} · ${MARCA_CORTA}`, desc: `${e.pregunta} Un mini-proyecto para construir, rehacer y romper en tu Mac.`,
    body: cuerpoEstacion(e, { total: e.linea.total, kitBytes: z.length, kb }), lectura: true });
  const dir = join(OUT, e.linea.id, e.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), pages[e.url]);
  console.log(`[build] ${e.url} · kit ${kb(z.length)}`);
  if (e.kitUrl !== e.url) {
    pages[e.kitUrl] = pagina({ path: e.kitUrl, title: `Proyecto con kit · ${e.titulo} · ${MARCA_CORTA}`, desc: `${e.mundo.resumen.replace(/<[^>]+>/g, '')} Las cuatro rondas de la estación ${e.num} de ${e.linea.nombre}.`,
      body: cuerpoProyecto(e, { total: e.linea.total, kitBytes: z.length, kb }), lectura: true });
    mkdirSync(join(dir, 'proyecto-con-kit'), { recursive: true });
    writeFileSync(join(dir, 'proyecto-con-kit', 'index.html'), pages[e.kitUrl]);
    console.log(`[build] ${e.kitUrl}`);
  }
  for (const p of e.practicas) {
    pages[p.url] = pagina({ path: p.url, title: `${p.titulo} · ${MARCA_CORTA}`, desc: `${p.subtitulo} Práctica desde cero de la estación ${e.num} de ${e.linea.nombre}.`,
      body: cuerpoPractica(e, p), lectura: true });
    mkdirSync(join(dir, p.id), { recursive: true });
    writeFileSync(join(dir, p.id, 'index.html'), pages[p.url]);
    console.log(`[build] ${p.url}`);
  }
}
pages['/'] = portada();
writeFileSync(join(OUT, 'index.html'), pages['/']);
// la página de cada entrenamiento (la carpeta ya existe si la línea tiene estaciones con dojo)
const LINEA_URLS = [`/${TRONCO.caso}/`, ...RAMAS_L.map((r) => `/${r.id}/`)];
pages[LINEA_URLS[0]] = paginaTronco();
RAMAS_L.forEach((r, k) => { pages[LINEA_URLS[k + 1]] = paginaRama(r); });
for (const u of LINEA_URLS) { mkdirSync(join(OUT, u), { recursive: true }); writeFileSync(join(OUT, u, 'index.html'), pages[u]); console.log(`[build] ${u}`); }
// «Tu tablero»: la página, la plantilla de las estaciones con taller y sus módulos (con la copia del motor del tablero)
pages['/tablero/'] = pagina({ path: '/tablero/', title: `Tu tablero · ${SITE_NAME}`, desc: 'Tu avance en el dojo: las cuatro rondas de cada estación, tus fallas con su tiempo y tu bitácora. Sin cuenta, guardado en tu navegador.',
  body: cuerpoTablero(plantillaTablero(ESTACIONES, LINEAS)) });
mkdirSync(join(OUT, 'tablero', 'motor'), { recursive: true });
writeFileSync(join(OUT, 'tablero', 'index.html'), pages['/tablero/']);
const MODULOS = ['modelo.mjs', 'almacen.mjs', 'tablero.mjs', 'motor/ops.mjs', 'motor/model.mjs', 'motor/calc.mjs'];
for (const m of MODULOS) copyFileSync(join(ROOT, 'site', 'tablero', m), join(OUT, 'tablero', m));
console.log('[build] /tablero/');
for (const f of ['app.js', 'icon.svg', 'manifest.webmanifest', 'og.png']) copyFileSync(join(ROOT, 'site', f), join(OUT, f));
// el video «Cómo se usa» de la portada y su póster: van tal cual y nunca entran a la caché del service worker
mkdirSync(join(OUT, 'video'), { recursive: true });
for (const f of ['como-se-usa.mp4', 'como-se-usa.jpg']) copyFileSync(join(ROOT, 'site', 'video', f), join(OUT, 'video', f));
// codigo.js (bloques de código y su botón de copiar) y piezas.js (volver a TrueML, tanque de avance, notas): del sistema compartido
for (const f of ['codigo.js', 'piezas.js']) copyFileSync(join(ROOT, 'vendor', 'trueml', f), join(OUT, f));
// La mudanza a trueml.app: la página que lleva el avance de la dirección *.vercel.app vieja a la nueva (ver vendor/trueml/mudanza.js).
for (const f of ['mudanza.html', 'mudanza.js']) copyFileSync(join(ROOT, 'vendor', 'trueml', f), join(OUT, f));
// dojo.css = los tokens y las piezas de TrueML (vendor/trueml/tokens.css y piezas.css, del sistema compartido) + los componentes del Dojo
const DOJO_CSS = ['tokens.css', 'piezas.css'].map((f) => readFileSync(join(ROOT, 'vendor', 'trueml', f), 'utf8')).join('\n') + '\n' + readFileSync(join(ROOT, 'site', 'dojo.css'), 'utf8');
writeFileSync(join(OUT, 'dojo.css'), DOJO_CSS);

const urls = ['/', ...LINEA_URLS, ...ESTACIONES.flatMap((e) => [e.url, ...(e.kitUrl !== e.url ? [e.kitUrl] : []), ...e.practicas.map((p) => p.url)]), '/tablero/'];
const core = [...urls, '/dojo.css', '/app.js', '/codigo.js', '/piezas.js', '/icon.svg', '/manifest.webmanifest', ...MODULOS.map((m) => `/tablero/${m}`)];
const hash = createHash('sha256');
for (const p of Object.keys(pages).sort()) hash.update(p).update(pages[p]);
hash.update(DOJO_CSS).update(readFileSync(join(ROOT, 'site', 'app.js'))).update(readFileSync(join(ROOT, 'vendor', 'trueml', 'piezas.js'))).update(readFileSync(join(ROOT, 'vendor', 'trueml', 'codigo.js')));
for (const m of MODULOS) hash.update(m).update(readFileSync(join(ROOT, 'site', 'tablero', m)));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(ROOT, 'site', 'sw.js'), 'utf8').replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
for (const [p, d] of Object.entries(SEO)) {
  if (!SEO_USADAS.has(p)) { console.error(`[build] content/seo.json: la ruta ${p} no es una página del dojo`); process.exit(1); }
  if (d.length > 160) { console.error(`[build] content/seo.json: la descripción de ${p} tiene ${d.length} caracteres (máximo 160)`); process.exit(1); }
}
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] listo: ${Object.keys(pages).length} páginas · BUILD ${BUILD}`);
