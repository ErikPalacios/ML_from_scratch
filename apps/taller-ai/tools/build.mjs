#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html                    portada: el método, la línea de C01 y cómo empezar
//   <caso>/<estacion>/index.html  una página por estación, desde content/estaciones/<caso>-<id>.json
//   kits/<caso>-<estacion>.zip    el kit listo para usar: esqueleto en pipeline/, config.yaml, GUION.md y OBJETIVOS.md
//   sw.js, style.css, app.js…     modo sin conexión y estilos
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { estacion as molde, cruzadas, practica as moldePractica, cruzadasPractica } from './schema.mjs';
import { zip } from './zip.mjs';
import { cuerpoEstacion, cuerpoPractica } from './dojo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const SITE_URL = 'https://taller-ai-engineer.vercel.app'; // cámbiala cuando exista el proyecto o haya dominio propio
const SITE_NAME = 'Taller de AI Engineer';
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
const ICON = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/></svg>',
};
const TEMA = `<div class="tema" role="group" aria-label="Tema">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Auto']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false" title="${l}">${ICON[t]}<span>${l}</span></button>`).join('')}</div>`;

function pagina({ path, title, desc, body, dojo = false }) {
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
<meta name="theme-color" content="${dojo ? '#EDEFF7' : '#F4F6F9'}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${dojo ? '#0A0F22' : '#0E131A'}" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
${dojo ? '<link rel="stylesheet" href="/dojo.css">' : `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<link rel="stylesheet" href="/style.css">`}
</head>
${dojo ? `<body class="dojo">
${body}
<script src="/app.js" defer></script>
</body>
</html>
` : `<body>
<div class="wrap">
${body}
<footer class="foot">
  <p>© ${new Date().getFullYear()} Erik Palacios · Contenido bajo <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es">CC BY-NC-ND 4.0</a> · <a href="https://ml-desde-cero.vercel.app">ML desde cero</a> · <a href="https://github.com/ErikPalacios/ML_from_scratch/issues/new">Reportar un error</a></p>
  <p>La app es la guía: no corre nada. El trabajo pasa en tu Mac, con el kit y una sesión de Claude Code. Después de la primera visita abre sin conexión.</p>
</footer>
</div>
<script src="/app.js" defer></script>
</body>
</html>
`}`;
}

const barra = (volver) => `<nav class="bar" aria-label="Navegación">${volver ? `<a href="/">← Taller de AI Engineer</a>` : '<span></span>'}${TEMA}</nav>`;

// ---------------------------------------------------------------- portada
// Las estaciones del mapa que ya tienen taller abren su página (y llevan el aro punteado); las demás,
// su sección en la cheat sheet.
function mapaC01(lista) {
  const enlaces = (svg) => svg.replace(/<a class="stn" href="#est-([a-z]+)" aria-label="([^"]*)">/g, (m, id, lab) => lista.has(id)
    ? `<a class="stn lista" href="${lista.get(id).url}" aria-label="${lab}. Abrir su taller">`
    : `<a class="stn" href="${HOJA_RECORRIDO}#est-${id}" aria-label="${lab}. Su explicación en la cheat sheet">`);
  const lineas = [['semanas', 'semanas', 'el modelo'], ['dias', 'días', 'el código'], ['ms', 'milisegundos', 'una request'], ['continuo', 'continuo', 'la operación']]
    .map(([c, t, d]) => `<span class="lg ln-${c}"><i class="lg-line"></i><b>${t}</b> ${d}</span>`).join('');
  return `<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>${MAPA.simbolos}</defs></svg>
  <figure class="mapa">
    <div class="maplg">${lineas}<span class="lg"><svg class="lg-x" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11.5" class="g-o"/><circle cx="14" cy="14" r="7" class="g-i"/></svg>transbordo</span><span class="lg"><i class="lg-loop"></i>reentrenamiento</span><span class="lg"><svg class="lg-x" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" class="g-fr"/><circle cx="14" cy="14" r="6.5" class="g-i"/></svg>ya tiene taller</span></div>
    ${enlaces(MAPA.map2d)}
    ${enlaces(MAPA.mapv)}
    <figcaption>Toca una estación: las que ya tienen taller abren su página; las demás, su explicación en la cheat sheet <a href="${HOJA_RECORRIDO}">«Del dato a producción»</a>, de donde sale este mapa.</figcaption>
  </figure>`;
}

function portada() {
  const lista = new Map(ESTACIONES.filter((e) => e.caso === TRONCO.caso).map((e) => [e.id, e]));
  const lineas = TRONCO.estaciones.map((s) => lista.has(s.id)
    ? `<li class="lista"><span class="num">${s.num}</span><a href="${lista.get(s.id).url}">${esc(s.titulo)}</a>${lista.get(s.id).practicas.length ? `<span class="extra">+ ${lista.get(s.id).practicas.length} prácticas desde cero</span>` : ''}</li>`
    : `<li><span class="num">${s.num}</span><span class="t">${esc(s.titulo)}</span><span class="pronto">próximamente</span></li>`).join('\n      ');
  const primera = ESTACIONES.find((e) => e.caso === TRONCO.caso);
  const body = `${barra(false)}
<header class="hero">
  <p class="kicker">ML desde cero · Entrenamiento práctico</p>
  <h1>Taller de <mark>AI Engineer</mark></h1>
  <p class="lead">Proyectos chicos que corren en tu Mac, uno por cada estación del camino del dato a producción. Cada uno lo construyes cuatro veces: con ayuda, solo, roto con ayuda y roto solo. Con una explicación rápida de cada concepto en el momento en que lo usas.</p>
</header>
<nav class="indice" aria-label="En esta página">
  <a href="#c01">Qué es C01</a><a href="#mapa">El mapa</a><a href="#como">Cómo se usa</a><a href="#estaciones">Estaciones</a>
</nav>
<main>
<section class="blk" id="c01">
  <h2>Qué es C01 <small>el caso del tronco</small></h2>
  <p>C01 es el primer caso del curso: un <b>marketplace de segunda mano</b> donde quien vende sube fotos al crear una publicación y el sistema le <b>sugiere la categoría</b>. Por dentro es un clasificador de imágenes (una ResNet-50 con 500 categorías) servido con Triton en Kubernetes, que responde unas 10 millones de fotos al día y tiene que contestar el 99 % de las veces en menos de 200 ms.</p>
  <ul class="chips datos-c01"><li>500 categorías</li><li>≈ 10 M fotos al día</li><li>p99 ≤ 200 ms</li><li>top-5 por foto</li><li>un modelo nuevo cada mes</li></ul>
  <p>Es el tronco del taller porque recorre las 12 estaciones completas: de las fotos etiquetadas al entrenamiento, del modelo aprobado a la imagen de Docker en el clúster, y de la request en vivo al monitoreo que pide el siguiente modelo. Los otros patrones (batch, LLM y RAG, streaming, edge…) cambian solo algunas estaciones, así que llegan después, como ramas.</p>
  <p>En el taller, cada estación es una versión chica de C01 que corre en tu Mac: los mismos conceptos y las mismas fallas, con otros tamaños. La estación 1, por ejemplo, usa fotos de Fashion-MNIST, 24,000 requests y un S3 local en Docker.</p>
</section>

<section class="blk" id="mapa">
  <h2>El mapa del C01 <small>12 estaciones</small></h2>
  <p class="intro">Doce estaciones en cuatro tramos: Datos, Modelo, Release y Operación. Entre una estación y la siguiente viaja un artefacto concreto (el snapshot del dataset, el checkpoint, el engine, la imagen de Docker…), y el reentrenamiento cierra el ciclo. Los colores son las cuatro velocidades: el modelo cambia en semanas, el código en días, una request dura milisegundos y el monitoreo no para.</p>
  ${mapaC01(lista)}
</section>

<section class="blk" id="como">
  <h2>Cómo se usa el taller <small>de la lectura a romper</small></h2>
  <p class="intro">Cada estación es un mini-proyecto con su kit. Esta app es la guía y no corre nada: el trabajo pasa en tu Mac, en la carpeta del kit, con una sesión de Claude Code abierta ahí.</p>
  <ol class="uso">
    <li><h3>Lee antes de tocar</h3><p>En la página de la estación: <b>el mapa</b> (dónde estás, qué entra y qué sale), <b>los precálculos</b> (las cuentas de servilleta, en C01 y en el taller) y <b>los conceptos exprés</b>. Se lee en el celular, en un rato libre.</p></li>
    <li><h3>Baja el kit y levanta el mundo</h3><p>Un .zip con una empresa ficticia que ya tiene el problema: sus datos, sus servicios en Docker, un <code>verificar.py</code> que revisa tu trabajo y un <code>romper.py</code> que mete fallas. Cinco comandos y queda arriba.</p></li>
    <li><h3>Haz las cuatro rondas</h3><p>Copia el prompt de la ronda en la página de la estación y pégalo en Claude Code. El <code>CLAUDE.md</code> del kit pone las reglas de fondo, así que Claude sabe cuánto ayudarte en cada una.</p>
      <ol class="ciclo" aria-label="Las cuatro rondas">
        <li><h4>Guiado</h4><p>Construyes el proyecto con Claude Code paso a paso. Cada paso explica el concepto que usa.</p></li>
        <li><h4>Solo</h4><p>Lo rehaces desde el esqueleto con los objetivos y el verificador. Claude no te da código.</p></li>
        <li class="rompe"><h4>Romper con ayuda</h4><p>Un script mete una falla real. La diagnostican juntos: síntoma, hipótesis, prueba, arreglo.</p></li>
        <li class="rompe"><h4>Romper solo</h4><p>El script esconde la falla, ni Claude la sabe. Tú la encuentras y la arreglas.</p></li>
      </ol>
    </li>
    <li><h3>Repasa</h3><p>Al final de cada página: el memo de la estación, su trampa, la lista de «listo cuando…» y cómo te lo pueden preguntar en una entrevista.</p></li>
    <li><h3>Lleva tu registro</h3><p>Claude anota cada ronda en <code>BITACORA.md</code> (qué hiciste, cuánto tardaste, qué pistas usaste) y en <code>taller/progreso.json</code>. Pronto vas a poder subirlo a tu tablero aquí mismo.</p></li>
  </ol>
  <div class="dos">
    <div class="card"><h3>Qué necesitas</h3><ul><li>Una Mac con Docker Desktop y unos GB libres</li><li>Python 3.11 o más nuevo</li><li>Claude Code</li></ul><p class="cmd-nota">Cada estación dice lo suyo en «El kit».</p></div>
    <div class="card"><h3>En qué orden</h3><p>Del 1 al 12, que es el orden en que el dato viaja en C01. Cada kit trae su propio mundo, así que una estación corre aunque no hayas terminado la anterior.</p></div>
  </div>
  ${primera ? `<div class="acciones"><a class="btn btn--primary" href="${primera.url}">Empezar por la estación ${primera.num}: ${esc(primera.titulo)}</a></div>` : ''}
</section>

<section class="blk" id="estaciones">
  <h2>Las estaciones <small>${lista.size} de ${TRONCO.estaciones.length} listas</small></h2>
  <div class="linea">
    <h3>${esc(TRONCO.titulo)}</h3>
    <p>${esc(TRONCO.resumen)}</p>
    <ol class="estaciones">
      ${lineas}
    </ol>
  </div>
  <div class="notas">
    <div class="nota"><h3>Los otros patrones</h3><p>Después del tronco vienen las ramas: batch, LLM y RAG, streaming, edge, asíncrono e híbrido, cada una con su mini-proyecto y solo las estaciones que cambian.</p></div>
  </div>
</section>
</main>`;
  return pagina({ path: '/', title: `${SITE_NAME} — construir, rehacer y romper`, desc: 'Proyectos chicos de ML engineering que construyes, rehaces y rompes en tu Mac, estación por estación del camino del dato a producción. En español, gratis.', body });
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
        `- **En C01:** ${sinHtml(x.c01.cuenta)} → ${sinHtml(x.c01.valor)}`, `- **En el taller:** ${sinHtml(x.taller.cuenta)} → ${sinHtml(x.taller.valor)}`, '',
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
  pages[e.url] = pagina({ path: e.url, title: `${e.titulo} · ${e.caso.toUpperCase()} — ${SITE_NAME}`, desc: `${e.pregunta} Un mini-proyecto para construir, rehacer y romper en tu Mac.`,
    body: cuerpoEstacion(e, { total: TRONCO.estaciones.length, kitBytes: z.length, kb }), dojo: true });
  mkdirSync(join(OUT, e.caso, e.id), { recursive: true });
  writeFileSync(join(OUT, e.caso, e.id, 'index.html'), pages[e.url]);
  console.log(`[build] ${e.url} · kit ${kb(z.length)}`);
  for (const p of e.practicas) {
    pages[p.url] = pagina({ path: p.url, title: `${p.titulo} · ${e.titulo} — ${SITE_NAME}`, desc: `${p.subtitulo} Práctica desde cero de la estación ${e.num} de C01.`,
      body: cuerpoPractica(e, p), dojo: true });
    mkdirSync(join(OUT, e.caso, e.id, p.id), { recursive: true });
    writeFileSync(join(OUT, e.caso, e.id, p.id, 'index.html'), pages[p.url]);
    console.log(`[build] ${p.url}`);
  }
}
pages['/'] = portada();
writeFileSync(join(OUT, 'index.html'), pages['/']);
for (const f of ['style.css', 'dojo.css', 'app.js', 'icon.svg', 'manifest.webmanifest', 'og.png']) copyFileSync(join(ROOT, 'site', f), join(OUT, f));

const urls = ['/', ...ESTACIONES.flatMap((e) => [e.url, ...e.practicas.map((p) => p.url)])];
const core = [...urls, '/style.css', '/dojo.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];
const hash = createHash('sha256');
for (const p of Object.keys(pages).sort()) hash.update(p).update(pages[p]);
for (const f of ['style.css', 'dojo.css', 'app.js']) hash.update(readFileSync(join(ROOT, 'site', f)));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(ROOT, 'site', 'sw.js'), 'utf8').replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] listo: ${Object.keys(pages).length} páginas · BUILD ${BUILD}`);
