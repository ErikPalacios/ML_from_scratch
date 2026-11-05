#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html            inicio: el camino, tu avance, la ruta TrueML y el temario
//   <leccion>/index.html  una página por cada content/lecciones/<id>.md que exista
//   glosario/index.html   todos los conceptos, con buscador
//   ronda/index.html      «Para leer la Ronda»: qué lecciones preparan para cada módulo de la Ronda de Diseño
//   indice.json           lo que busca el buscador de la barra lateral (lecciones y conceptos)
//   sw.js, sensei.css…    modo sin conexión, estilos y el motor de diagramas de la Ronda
//
// Todas las páginas tienen la estructura de lectura de la Ronda: barra lateral con el índice, la página como una hoja
// y, en las lecciones, «En esta página» a la derecha.
//
// Revisa al construir: que cada [[id]] exista en el glosario, que cada concepto se presente en una sola lección, que
// los diagramas, figuras y calculadoras existan y estén bien, y cuenta las palabras que una lección usa antes de que
// alguna las presente («adelantos»: salen en su globo con su definición, pero conviene que sean pocas).
//
//   node tools/build.mjs                 todo el sitio en dist/
//   node tools/build.mjs --solo <id>     solo esa lección, en .solo/<id>/ (para escribir varias lecciones en paralelo):
//                                        tolera glosarios ajenos a medias y acepta los [[id]] que estén planeados en
//                                        content/conceptos-plan.json aunque todavía no existan.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { crear, esc } from './md.mjs';
import { validar as validarDiagrama, montar } from './diagrama.mjs';
import { validar as validarCalc, dibujar as dibujarCalc } from './calculadora.mjs';
import { marca, miniT, etapas as etapasDe } from '../vendor/trueml/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = join(ROOT, 'content');
const SOLO = process.argv.includes('--solo') ? process.argv[process.argv.indexOf('--solo') + 1] : null;
const OUT = SOLO ? join(ROOT, '.solo', SOLO) : join(ROOT, 'dist');
const avisos = [];
const leer = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(leer(p));
const errores = [];
const fail = (msg) => { console.error('[build] ERROR: ' + msg); process.exit(1); };

const SITIO = json(join(C, 'sitio.json'));
const TEMARIO = json(join(C, 'temario.json'));
const RONDA = json(join(C, 'ronda.json'));
const RMOD = new Map(RONDA.modulos.map((m) => [m.id, m]));
const DOJO = existsSync(join(C, 'dojo.json')) ? json(join(C, 'dojo.json')) : { estaciones: [] };   // lo escribe apps/trueml/sync.mjs

// ---------------------------------------------------------------- glosario: un archivo por lección en content/glosario/
const GLOS = new Map();
const TERMINOS = readdirSync(join(C, 'glosario')).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
  try { return json(join(C, 'glosario', f)).terminos.map((g) => ({ ...g, archivo: f })); }
  catch (e) { if (SOLO && f !== `${SOLO}.json`) { avisos.push(`glosario/${f} no se pudo leer (¿a medio escribir?): se ignora`); return []; } throw new Error(`glosario/${f}: ${e.message}`); }
});
// en --solo, los problemas de los glosarios de otras lecciones son avisos, no errores
const propio = (archivo) => !SOLO || archivo === `${SOLO}.json`;
const problema = (archivo, msg) => (propio(archivo) ? errores : avisos).push(msg);
for (const g of TERMINOS) {
  if (!/^[a-z0-9-]+$/.test(g.id || '')) problema(g.archivo, `glosario: id inválido «${g.id}»`);
  if (GLOS.has(g.id)) { problema(propio(g.archivo) ? g.archivo : GLOS.get(g.id).archivo, `glosario: «${g.id}» está dos veces (${GLOS.get(g.id).archivo} y ${g.archivo})`); if (!propio(g.archivo)) continue; }
  for (const k of ['termino', 'corto']) if (!g[k]) problema(g.archivo, `glosario ${g.id}: falta «${k}»`);
  GLOS.set(g.id, { ver: [], ...g });
}
// Los conceptos planeados (content/conceptos-plan.json) que su lección todavía no escribe cuentan como existentes:
// así se publica por tandas. Su globo dice en qué lección se ven y que llega después; no salen en el glosario.
const PLAN = existsSync(join(C, 'conceptos-plan.json')) ? json(join(C, 'conceptos-plan.json')).lecciones : {};
const nombrePlan = (id) => (id.length <= 4 ? id.toUpperCase() : id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()));
for (const [lec, ids] of Object.entries(PLAN)) for (const id of ids) if (!GLOS.has(id)) GLOS.set(id, { id, termino: nombrePlan(id), corto: 'Este concepto todavía no tiene su lección escrita.', ver: [], plan: lec, leccion: lec, archivo: '(plan)' });
const REALES = () => [...GLOS.values()].filter((g) => !g.plan);
for (const g of GLOS.values()) for (const v of g.ver) if (!GLOS.has(v)) problema(g.archivo, `glosario ${g.id}: «ver» menciona «${v}», que no existe`);

// ---------------------------------------------------------------- temario y lecciones
const ORDEN = [];   // todas las lecciones del temario, en orden de lectura
TEMARIO.modulos.forEach((m, k) => {
  etapasDe(m.etapas);
  m.num = k;
  for (const l of m.lecciones) {
    etapasDe(l.etapas);
    for (const r of l.ronda || []) if (!RMOD.has(r)) errores.push(`temario ${l.id}: «ronda» menciona «${r}», que no está en content/ronda.json`);
    l.ronda = l.ronda || [];
    l.modulo = m;
    l.url = `/${l.id}/`;
    l.archivo = join(C, 'lecciones', `${l.id}.md`);
    l.lista = existsSync(l.archivo);
    l.pos = ORDEN.length;
    l.n = String(ORDEN.length).padStart(2, '0');
    ORDEN.push(l);
  }
});
const POR_ID = new Map(ORDEN.map((l) => [l.id, l]));
for (const g of GLOS.values()) if (g.leccion && !POR_ID.has(g.leccion)) problema(g.archivo, `glosario ${g.id}: «leccion» = «${g.leccion}», que no está en el temario`);
for (const f of readdirSync(join(C, 'lecciones')).filter((f) => f.endsWith('.md'))) if (!POR_ID.has(f.slice(0, -3))) errores.push(`lecciones/${f} no está en el temario`);

function frente(texto, archivo) {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) fail(`${archivo}: falta el encabezado --- … ---`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ['titulo', 'subtitulo', 'pregunta']) if (!meta[k]) fail(`${archivo}: falta «${k}» en el encabezado`);
  meta.requisitos = meta.requisitos ? meta.requisitos.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { meta, cuerpo: texto.slice(m[0].length) };
}

const diagrama = (id, pie, inline) => {
  const p = join(C, 'diagramas', `${id}.json`);
  if (!existsSync(p)) throw new Error(`falta content/diagramas/${id}.json`);
  const d = json(p), errs = validarDiagrama(d, id);
  if (errs.length) throw new Error(errs.join('; '));
  return montar(id, d, pie, inline);
};
const calculadora = (id, pie, inline) => {
  const p = join(C, 'calculadoras', `${id}.json`);
  if (!existsSync(p)) throw new Error(`falta content/calculadoras/${id}.json`);
  const c = json(p), errs = validarCalc(c, id);
  if (errs.length) throw new Error(errs.join('; '));
  return dibujarCalc(c, id, pie, inline);
};
const figura = (id) => {
  const p = join(C, 'figuras', `${id}.svg`);
  if (!existsSync(p)) throw new Error(`falta content/figuras/${id}.svg`);
  return leer(p).trim();
};

// En --solo solo se arma esa lección (las demás pueden estar a medio escribir).
if (SOLO && !POR_ID.has(SOLO)) fail(`--solo ${SOLO}: no está en el temario`);
if (SOLO && !POR_ID.get(SOLO).lista) fail(`--solo ${SOLO}: falta content/lecciones/${SOLO}.md`);
const LISTAS = ORDEN.filter((l) => l.lista && (!SOLO || l.id === SOLO));
const PRESENTA = new Map();   // concepto → la lección que lo presenta
for (const l of LISTAS) {
  const { meta, cuerpo } = frente(leer(l.archivo), `lecciones/${l.id}.md`);
  if (meta.titulo !== l.titulo) errores.push(`lecciones/${l.id}.md: el título «${meta.titulo}» no es el del temario («${l.titulo}»)`);
  for (const r of meta.requisitos) if (!POR_ID.has(r)) errores.push(`lecciones/${l.id}.md: requisito «${r}» no está en el temario`);
  l.meta = meta;
  try {
    Object.assign(l, crear({ glosario: GLOS, diagrama, figura, calculadora, contexto: `lecciones/${l.id}.md` }).render(cuerpo));
  } catch (e) { fail(e.message); }
  for (const id of l.conceptos) {
    if (PRESENTA.has(id)) errores.push(`«${id}» se presenta en ${PRESENTA.get(id).id} y otra vez en ${l.id}`);
    else PRESENTA.set(id, l);
    if (GLOS.get(id).plan) errores.push(`lecciones/${l.id}.md presenta «${id}», pero no está en content/glosario/${l.id}.json`);
  }
  // el tiempo de lectura sale del texto: 200 palabras por minuto, más lo que toma jugar con lo interactivo
  const total = l.intro + l.secciones.reduce((a, x) => a + x.palabras, 0);
  const esencial = l.intro + l.secciones.filter((x) => !x.extra).reduce((a, x) => a + x.palabras, 0);
  const extra = l.cuenta.diagramas * 1 + l.cuenta.figuras * 0.5 + l.cuenta.calculadoras * 1.5 + l.cuenta.ejercicios * 1.5 + l.cuenta.cuentas * 0.5;
  l.palabras = total;
  l.min = { todo: Math.max(1, Math.round(total / 200 + extra)), esencial: Math.max(1, Math.round(esencial / 200 + extra * (esencial / Math.max(1, total)))) };
}
// adelantos: palabras que una lección usa antes de que alguna lección (esta o una anterior) las presente
const adelantos = [];
for (const l of LISTAS) {
  l.adelantos = [...l.terminos].filter((id) => !PRESENTA.has(id) || PRESENTA.get(id).pos > l.pos);
  if (l.adelantos.length) adelantos.push(`${l.id}: ${l.adelantos.join(', ')}`);
}
// En el sitio completo, cada concepto del glosario lo presenta alguna lección publicada.
if (!SOLO) for (const g of GLOS.values()) if (!PRESENTA.has(g.id) && POR_ID.get(g.archivo.replace(/\.json$/, ''))?.lista) errores.push(`glosario ${g.id} (${g.archivo}) no está en el :::conceptos de su lección`);
if (avisos.length) console.log(`[build] avisos:\n  ${avisos.join('\n  ')}`);
if (errores.length) fail('\n  ' + errores.join('\n  '));

// ================================================================ piezas comunes
const R = crear({ glosario: GLOS, diagrama, figura, contexto: 'glosario' });
const marcaChica = marca();
const ICO = {
  menu: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></svg>',
  x: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  casa: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 7.5 8 3l5.5 4.5V13h-4v-3.5h-3V13h-4z"/></svg>',
  libro: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 2.5h8.5v11H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM2 11.5a1 1 0 0 1 1-1h8.5"/></svg>',
  ronda: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.8V8l2.2 1.4" stroke-linecap="round"/></svg>',
  chev: '<svg class="ico chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
};
const TEMA = `<div class="tema" role="group" aria-label="Tema">${[['auto', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false">${l}</button>`).join('')}</div>`;
const dojoDe = (num) => DOJO.estaciones.find((s) => s.num === num);
const rondaUrl = (id) => `${RONDA.url}/#${id}`;
const chipRonda = (id) => `<a class="chip" href="${rondaUrl(id)}"><b>${id.toUpperCase()}</b>${esc(RMOD.get(id).titulo)}</a>`;
const marcaLink = (sub) => `<a class="brand" href="/"><span class="brand__mark">${marcaChica}</span><span class="brand__txt"><span class="brand__name">${esc(SITIO.nombre)}</span><span class="brand__sub">${esc(sub)}</span></span></a>`;

// La franja de avance: una celda por lección (lista, leída —la pinta app.js— o próximamente).
const strip = (ls) => `<div class="strip" style="--n:${ls.length}" aria-hidden="true">${ls.map((l) => `<i class="${l.lista ? 'is-lista' : 'is-pronto'}" data-leccion="${l.id}" title="${esc(`${l.n} · ${l.titulo}${l.lista ? '' : ' (próximamente)'}`)}"></i>`).join('')}</div>`;

function sidebar(actual) {
  const grupos = TEMARIO.modulos.map((m) => {
    const listas = m.lecciones.filter((l) => l.lista).length;
    const abierto = listas > 0 || m.lecciones.some((l) => l.id === actual);
    const items = m.lecciones.map((l) => (l.lista
      ? `<li><a class="nav__item" href="${l.url}" data-leccion="${l.id}" data-buscar="${esc(l.titulo.toLowerCase())}"${l.id === actual ? ' aria-current="page"' : ''}><span class="nav__num">${l.n}</span><span class="nav__title">${esc(l.titulo)}</span><span class="nav__mk"><span class="nav__mk-ok" aria-label="leída">✓</span></span></a></li>`
      : `<li><span class="nav__item is-soon" data-buscar="${esc(l.titulo.toLowerCase())}"><span class="nav__num">${l.n}</span><span class="nav__title">${esc(l.titulo)}</span><span class="nav__mk"></span></span></li>`)).join('');
    return `<details class="nav__group"${abierto ? ' open' : ''}><summary><span class="nav__label">${m.num} · ${esc(m.titulo)}</span><span class="nav__fase${listas === m.lecciones.length ? ' is-lista' : ''}">${listas === m.lecciones.length ? 'Listo' : listas ? `${listas}/${m.lecciones.length}` : `Fase ${m.fase}`}</span></summary><ol class="nav__list">${items}</ol></details>`;
  }).join('');
  const top = [['/', ICO.casa, 'Inicio', 'inicio'], ['/ronda/', ICO.ronda, 'Para leer la Ronda', 'ronda'], ['/glosario/', ICO.libro, `Glosario`, 'glosario']]
    .map(([href, ico, t, id]) => `<a class="nav__item" href="${href}"${id === actual ? ' aria-current="page"' : ''}>${ico}<span>${t}</span>${id === 'glosario' ? `<span class="nav__count">${REALES().length}</span>` : '<span></span>'}</a>`).join('');
  return `<aside class="sidebar" id="sidebar" aria-label="Índice">
  <div class="sidebar__head">${marcaLink('TrueML · teoría desde cero')}<button type="button" class="btn-ico sidebar__close" aria-label="Cerrar el índice" data-cajon="cerrar">${ICO.x}</button></div>
  <div class="side-search" role="search"><input type="search" placeholder="Buscar lecciones y conceptos…" aria-label="Buscar lecciones y conceptos" autocomplete="off" data-buscar-nav><kbd aria-hidden="true">/</kbd><ul class="side-res" hidden></ul></div>
  <div class="side-prog"><div class="side-prog__row"><span class="lbl">Progreso</span><b data-prog>0/${LISTAS.length}</b></div>${strip(ORDEN)}</div>
  <nav class="nav"><div class="nav__top">${top}</div>${grupos}</nav>
  <div class="sidebar__foot">
    <div class="tema-row"><span class="lbl">Tema</span>${TEMA}</div>
    <span>Tu avance se guarda solo en este navegador.</span>
    <a href="${SITIO.portada}">Todas las herramientas de TrueML →</a>
  </div>
</aside>`;
}

const pie = `<footer class="pie">
  <p>© ${new Date().getFullYear()} Erik Palacios · Contenido bajo <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es">CC BY-NC-ND 4.0</a> · <a href="${SITIO.portada}">TrueML</a> · <a href="${SITIO.dojo}">Dojo</a> · <a href="${RONDA.url}">Ronda de Diseño</a> · <a href="${SITIO.issues}">Reportar un error</a></p>
  <p>Después de la primera visita, ${esc(SITIO.nombre)} abre sin conexión.</p>
</footer>`;

const globo = `<div class="g-pop" hidden role="dialog" aria-modal="false" aria-labelledby="g-pop-t"><div class="g-pop-in">
  <button type="button" class="g-pop-x" aria-label="Cerrar">×</button>
  <span class="g-pop-t" id="g-pop-t"></span><span class="g-pop-en"></span>
  <p class="g-pop-def"></p>
  <p class="g-pop-donde"></p>
  <a class="g-pop-ir" href="/glosario/">Ver en el glosario →</a>
</div></div>`;

// Los datos de los globos: los conceptos que usa la página y, por si se abren desde un globo, los que usan sus definiciones.
function datosGlobos(ids) {
  const todos = new Set(ids), cola = [...ids];
  while (cola.length) {
    const id = cola.pop(), usados = new Set();
    R.inline(GLOS.get(id).corto, usados);
    for (const u of usados) if (!todos.has(u)) { todos.add(u); cola.push(u); }
  }
  const datos = {};
  for (const id of [...todos].sort()) {
    const g = GLOS.get(id), p = PRESENTA.get(id), f = g.leccion && POR_ID.get(g.leccion);
    datos[id] = { t: g.termino, en: g.en || '', c: R.inline(g.corto),
      p: p ? [p.url, p.titulo] : null,
      f: f && f !== p ? [f.lista ? f.url : null, f.titulo, f.lista ? '' : `fase ${f.modulo.fase}`] : null };
  }
  return `<script type="application/json" id="g-datos">${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>`;
}

function pagina({ path, title, desc, actual, contenido, toc = '', ancho = false, globos = [], diagramas = false }) {
  const url = SITIO.url + path;
  const og = existsSync(join(ROOT, 'site', 'og.png'));
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<script>try { var t = localStorage.getItem('sensei-tema'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:locale" content="es_MX"><meta property="og:site_name" content="${esc(SITIO.nombre)} · TrueML">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
${og ? `<meta property="og:image" content="${SITIO.url}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${SITIO.url}/og.png">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(title)}">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121A36" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/sensei.css">
</head>
<body>
<a class="skip" href="#contenido">Saltar al contenido</a>
<header class="topbar"><button type="button" class="btn-ico" aria-label="Abrir el índice" aria-controls="sidebar" aria-expanded="false" data-cajon="abrir">${ICO.menu}</button>${marcaLink('Teoría desde cero')}<span class="topbar__prog" data-prog>0/${LISTAS.length}</span></header>
${sidebar(actual)}
<div class="backdrop" hidden data-cajon="cerrar"></div>
<div class="shell${ancho ? ' shell--ancho' : ''}">
  <main class="main" id="contenido" tabindex="-1">
${contenido}
${pie}
  </main>
  ${toc}
</div>
${globo}
${globos.length ? datosGlobos(globos) : ''}
${diagramas ? '<script src="/diagram.js" defer></script>' : ''}
<script src="/app.js" defer></script>
</body>
</html>
`;
}

// ================================================================ lección
function paginaLeccion(l) {
  const m = l.meta, mod = l.modulo;
  const anterior = ORDEN.slice(0, l.pos).reverse().find((x) => x.lista);
  const siguiente = ORDEN[l.pos + 1];
  const est = l.estacion && dojoDe(l.estacion);
  const req = m.requisitos.map((r) => POR_ID.get(r));
  const requisitos = req.length
    ? `Antes de esta lección: ${req.map((r) => (r.lista ? `<a href="${r.url}">${esc(r.titulo)}</a>` : `${esc(r.titulo)} (próximamente)`)).join(', ')}.`
    : 'No necesitas saber nada antes. Empieza aquí.';
  const secciones = l.secciones.map((x, k) => `<li><a class="toc__link${x.extra ? ' is-extra' : ''}" href="#${x.id}"><span class="toc__n">${String(k + 1).padStart(2, '0')}</span><span>${esc(x.t)}${x.extra ? ' <small>extra</small>' : ''}</span></a></li>`).join('');
  const conecta = (l.ronda.length || est) ? `<div class="conecta"><span class="lbl">Te prepara para</span>${l.ronda.map(chipRonda).join('')}${est ? `<a class="chip chip--dojo" href="${est.url || SITIO.dojo}"><b>DOJO</b>Estación ${est.num} · ${esc(est.titulo)}</a>` : ''}</div>` : '';
  const contenido = `<article class="page">
  <header class="phead">
    <p class="eyebrow"><a href="/#m-${mod.id}">${mod.num} · ${esc(mod.titulo)}</a><span aria-hidden="true">·</span><span>Lección ${mod.lecciones.indexOf(l) + 1} de ${mod.lecciones.length}</span></p>
    <h1 class="phead__title" id="titulo">${esc(l.titulo)}</h1>
    ${m.en ? `<p class="phead__en">${esc(m.en)}</p>` : ''}
    <p class="phead__summary">${esc(m.subtitulo)}</p>
    <div class="phead__meta"><span>⏱ ${l.min.esencial < l.min.todo ? `${l.min.esencial} min lo esencial · ${l.min.todo} min todo` : `${l.min.todo} min de lectura`}</span><span>${l.conceptos.length} conceptos nuevos</span>${l.cuenta.calculadoras ? `<span>${l.cuenta.calculadoras} calculadora${l.cuenta.calculadoras > 1 ? 's' : ''}</span>` : ''}${l.cuenta.ejercicios ? `<span>${l.cuenta.ejercicios} ejercicios</span>` : ''}<span>${miniT(l.etapas)}</span></div>
    ${conecta}
    <details class="page-toc"><summary>${ICO.chev}<span class="lbl">Secciones</span><span class="page-toc__count">${l.secciones.length}</span></summary><ol>${secciones}</ol></details>
  </header>
  <div class="prose">
    <div class="c-pregunta"><span class="c-lbl">La pregunta</span><p>${esc(m.pregunta)}</p><div class="c-req">${requisitos}</div></div>
    ${l.html}
  </div>
  <section class="cierre" aria-label="Al terminar">
    <button type="button" class="btn c-leida" data-leida="${l.id}" aria-pressed="false"><span class="no">Marcar como leída</span><span class="si">Leída ✓</span></button>
    ${siguiente ? `<a class="card${siguiente.lista ? '' : ' card--pronto'}" href="${siguiente.lista ? siguiente.url : '/#temario'}"><span class="lbl">Sigue · ${siguiente.n}</span><b>${esc(siguiente.titulo)}</b><span class="txt">${siguiente.lista ? esc(siguiente.modulo.titulo) : `Próximamente · ${esc(siguiente.modulo.titulo)} (fase ${siguiente.modulo.fase})`}</span></a>` : ''}
    ${est ? `<a class="card card--dojo" href="${est.url || SITIO.dojo}"><span class="lbl">Practícalo en el Dojo</span><b>Estación ${est.num} · ${esc(est.titulo)}</b><span class="txt">${est.lista ? 'Construye, rehaz y rompe esta estación con Claude Code.' : 'La estación del Dojo todavía no está lista.'}</span></a>` : ''}
    ${l.ronda.length ? `<a class="card card--ronda" href="${rondaUrl(l.ronda[0])}"><span class="lbl">Léelo en la Ronda</span><b>${l.ronda[0].toUpperCase()} · ${esc(RMOD.get(l.ronda[0]).titulo)}</b><span class="txt">Lo que acabas de leer, con el ojo del entrevistador.</span></a>` : ''}
    ${anterior ? `<a class="c-ant" href="${anterior.url}">← ${anterior.n} · ${esc(anterior.titulo)}</a>` : ''}
  </section>
</article>`;
  const toc = `<aside class="toc" aria-label="En esta página"><p class="toc__title">En esta página</p><ol class="toc__list">${secciones}</ol><div class="toc__foot">${l.n} · ${esc(mod.titulo)}<br><a href="#titulo">↑ Arriba</a></div></aside>`;
  return pagina({ path: l.url, title: `${l.titulo} · ${SITIO.nombre} · TrueML`, desc: `${m.subtitulo} ${m.pregunta}`, actual: l.id, contenido, toc,
    globos: [...l.terminos], diagramas: l.html.includes('dg-mount') });
}

// ================================================================ inicio
function portada() {
  const primera = LISTAS[0];
  const usados = new Set();   // las palabras del glosario que trae el diagrama del camino
  const mods = TEMARIO.modulos.map((m) => {
    const listas = m.lecciones.filter((l) => l.lista).length;
    const items = m.lecciones.map((l) => (l.lista
      ? `<li><a class="tl" href="${l.url}" data-leccion="${l.id}"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)}</span><span class="tl__ok" aria-label="leída">✓</span></a></li>`
      : `<li><span class="tl is-soon"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)}</span><span></span></span></li>`)).join('');
    return `<li class="mod${listas ? '' : ' mod--pronto'}" id="m-${m.id}">
      <div class="mod__h"><span class="mod__n">${m.num}</span><h3>${esc(m.titulo)}</h3><p>${esc(m.resumen)}</p></div>
      <ol class="tls">${items}</ol>
      <span class="mod__est">${listas === m.lecciones.length ? 'Listo' : listas ? `${listas} de ${m.lecciones.length} lecciones` : `Próximamente · fase ${m.fase}`}</span>
    </li>`;
  }).join('\n');
  const contenido = `<section class="home-hero">
  <div>
    <p class="eyebrow">${esc(SITIO.pill)}</p>
    <h1>${esc(SITIO.nombre)}</h1>
    <p class="titular">${esc(SITIO.titular)}</p>
    <p class="lead">${esc(SITIO.lead)}</p>
    <div class="btns"><a class="btn" href="${primera.url}" data-seguir>Empezar: ${esc(primera.titulo)}</a><a class="btn btn--2" href="/ronda/">Para leer la Ronda</a></div>
  </div>
  <div class="home-t">${marca({ etiquetas: true, maxAltura: '420px', clave: 'p' })}</div>
</section>
<section class="home-sec" aria-labelledby="h-prog">
  <h2 id="h-prog">Tu avance</h2>
  <div class="prog"><span class="prog__big"><span data-prog-n>0</span> <small>de ${LISTAS.length} leídas</small></span>${strip(ORDEN)}
    <div class="prog__ley"><span><i style="background:var(--g)"></i>Leída</span><span><i style="background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)"></i>Lista para leer</span><span><i style="background:repeating-linear-gradient(135deg,var(--tm-off) 0 2px,transparent 2px 4px)"></i>Próximamente</span><span>${LISTAS.length} de ${ORDEN.length} lecciones publicadas</span></div></div>
</section>
<section class="home-sec" aria-labelledby="h-ruta">
  <h2 id="h-ruta">Dónde cae Sensei en TrueML</h2>
  <ol class="ruta">
    <li><div class="card card--ronda"><span class="n">1</span><b>Entender · ${esc(SITIO.nombre)}</b><span class="txt">Cada paso desde cero: qué es, por qué existe, cómo se conecta. Aquí estás.</span></div></li>
    <li><a class="card card--dojo" href="${SITIO.dojo}"><span class="n">2</span><b>Practicar · Dojo</b><span class="txt">Construir, rehacer y romper cada estación con Claude Code.</span></a></li>
    <li><a class="card" href="${RONDA.url}"><span class="n">3</span><b>Defender · Ronda de Diseño</b><span class="txt">Diseñar el sistema completo como en una entrevista de ML System Design.</span></a></li>
  </ol>
</section>
<section class="home-sec" aria-labelledby="h-camino">
  <h2 id="h-camino">El camino de un modelo</h2>
  <p>Todo lo que hay que hacer para que un modelo responda en una app de verdad cabe en seis etapas, y la última regresa a la primera. Toca cada caja para ver qué es, o recórrelo paso a paso.</p>
  ${diagrama('camino', 'Las seis etapas de la T de TrueML. Cada una tiene su módulo de lecciones.', (s) => R.inline(s, usados))}
</section>
<section class="home-sec" id="temario" aria-labelledby="h-temario">
  <h2 id="h-temario">Temario</h2>
  <p>Primero el mapa. Luego los cimientos de verdad: lo básico de ML, los números, la computadora, la red, los datos, las herramientas, la nube y la seguridad. Al final, una lección por cada estación de C01, en el orden del Dojo. Las que todavía no están dicen en qué fase llegan.</p>
  <ol class="mods">${mods}</ol>
</section>
<section class="home-sec" aria-labelledby="h-como">
  <h2 id="h-como">Cómo se lee</h2>
  <ol class="ruta">${SITIO.como.map((x, k) => `<li><div class="card"><span class="n">${k + 1}</span><b>${esc(x.t)}</b><span class="txt">${esc(x.d)}</span></div></li>`).join('')}</ol>
</section>`;
  return pagina({ path: '/', title: `${SITIO.nombre} · la teoría del dato a producción, desde cero · TrueML`, desc: SITIO.descripcion, actual: 'inicio', contenido, ancho: true, diagramas: true, globos: [...usados] });
}

// ================================================================ glosario
function paginaGlosario() {
  const usan = new Map(REALES().map((g) => [g.id, LISTAS.filter((l) => l.terminos.has(g.id))]));
  const lista = REALES().sort((a, b) => a.termino.localeCompare(b.termino, 'es'));
  const letra = (g) => g.termino.normalize('NFD')[0].toUpperCase();
  const letras = [...new Set(lista.map(letra))];
  const entrada = (g) => {
    const p = PRESENTA.get(g.id), f = g.leccion && POR_ID.get(g.leccion), u = usan.get(g.id), t = new Set();
    const buscar = (g.termino + ' ' + (g.en || '') + ' ' + g.corto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\[\[[^|\]]*\|?|\]\]/g, '');
    return `<article class="gent" id="g-${g.id}" data-buscar="${esc(buscar)}">
      <div class="gent__h"><h3>${esc(g.termino)}</h3>${g.en ? `<span class="c-k-en">${esc(g.en)}</span>` : ''}</div>
      <p class="gent__def">${R.inline(g.corto, t)}</p>
      ${g.largo ? `<p>${R.inline(g.largo, t)}</p>` : ''}
      ${g.analogia ? `<p><b>Analogía. </b>${R.inline(g.analogia, t)}</p>` : ''}
      ${g.ejemplo ? `<p><b>Ejemplo. </b>${R.inline(g.ejemplo, t)}</p>` : ''}
      <div class="gent__pie">${p ? `<span>Se presenta en <a href="${p.url}#k-${g.id}">${p.n} · ${esc(p.titulo)}</a></span>` : ''}${f && f !== p ? `<span>A fondo en ${f.lista ? `<a href="${f.url}">${f.n} · ${esc(f.titulo)}</a>` : `${f.n} · ${esc(f.titulo)} (fase ${f.modulo.fase})`}</span>` : ''}${u.length > 1 ? `<span>Aparece en ${u.length} lecciones</span>` : ''}</div>
      ${g.ver.length ? `<div class="chips">${g.ver.map((v) => `<a class="chip" href="#g-${v}">${esc(GLOS.get(v).termino)}</a>`).join('')}</div>` : ''}
    </article>`;
  };
  const contenido = `<header class="phead">
  <p class="eyebrow">Referencia</p>
  <h1 class="phead__title" id="titulo">Glosario</h1>
  <p class="phead__en">Glossary · español–English</p>
  <p class="phead__summary">${REALES().length} conceptos, cada uno en un solo lugar, con su nombre en inglés y las lecciones que lo usan. Cuando te surja una duda en el Dojo o en la Ronda, la respuesta se agrega aquí.</p>
  <label class="buscar"><span class="lbl">Buscar</span><input type="search" placeholder="modelo, softmax, latencia…" autocomplete="off" data-buscar-en=".gent"></label>
  <nav class="letras" aria-label="Letras">${letras.map((x) => `<a href="#l-${x}">${x}</a>`).join('')}</nav>
  <p class="c-req c-sin" hidden>Nada coincide. Si falta un concepto, <a href="${SITIO.issues}">dímelo en GitHub</a> y lo agrego.</p>
</header>
${letras.map((x) => `<section class="letra" id="l-${x}"><h2>${x}</h2><div class="g-lista">${lista.filter((g) => letra(g) === x).map(entrada).join('\n')}</div></section>`).join('\n')}`;
  return pagina({ path: '/glosario/', title: `Glosario · ${SITIO.nombre} · TrueML`, desc: `Los ${REALES().length} conceptos para llevar un modelo de ML a producción, explicados en palabras simples, con su nombre en inglés.`,
    actual: 'glosario', contenido, ancho: true, globos: REALES().map((g) => g.id) });
}

// ================================================================ para leer la Ronda
function paginaRonda() {
  const mods = RONDA.modulos.map((rm) => {
    const ls = ORDEN.filter((l) => l.ronda.includes(rm.id));
    const listas = ls.filter((l) => l.lista).length;
    const items = ls.map((l) => (l.lista
      ? `<li><a class="tl" href="${l.url}" data-leccion="${l.id}"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)}</span><span class="tl__ok" aria-label="leída">✓</span></a></li>`
      : `<li><span class="tl is-soon"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)} · fase ${l.modulo.fase}</span><span></span></span></li>`)).join('');
    return `<li class="rmod" id="r-${rm.id}">
      <div class="rmod__h"><a href="${rondaUrl(rm.id)}"><b>${rm.id.toUpperCase()}</b>${esc(rm.titulo)}</a><span class="rmod__cob">${listas}/${ls.length} listas</span></div>
      ${strip(ls)}
      <ol class="tls">${items}</ol>
    </li>`;
  }).join('\n');
  const contenido = `<header class="phead">
  <p class="eyebrow">El puente con la Ronda de Diseño</p>
  <h1 class="phead__title" id="titulo">Para leer la Ronda</h1>
  <p class="phead__en">What to read before each Ronda module</p>
  <p class="phead__summary">La Ronda de Diseño explica todo lo que rodea al modelo en producción, como lo evalúa un entrevistador, y da por sabidos cientos de conceptos. Aquí está, módulo por módulo, qué lecciones de ${esc(SITIO.nombre)} leer antes para entenderla completa.</p>
  <div class="conecta"><a class="btn btn--2" href="${RONDA.url}">Abrir la Ronda de Diseño →</a></div>
</header>
<section class="home-sec"><h2>Los 15 módulos de la Ronda</h2><p>Cada tarjeta lista las lecciones que preparan para ese módulo, en orden de lectura. Las que ya leíste se marcan con ✓.</p><ol class="rmods">${mods}</ol></section>`;
  return pagina({ path: '/ronda/', title: `Para leer la Ronda · ${SITIO.nombre} · TrueML`, desc: 'Qué lecciones de Sensei leer antes de cada módulo de la Ronda de Diseño ML.', actual: 'ronda', contenido, ancho: true });
}

// ================================================================ escribir
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const pages = SOLO ? {} : { '/': portada(), '/glosario/': paginaGlosario(), '/ronda/': paginaRonda() };
for (const l of LISTAS) pages[l.url] = paginaLeccion(l);
for (const [path, html] of Object.entries(pages)) {
  mkdirSync(join(OUT, path), { recursive: true });
  writeFileSync(join(OUT, path, 'index.html'), html);
  console.log(`[build] ${path}`);
}
for (const f of ['app.js', 'icon.svg', 'manifest.webmanifest', 'og.png']) if (existsSync(join(ROOT, 'site', f))) copyFileSync(join(ROOT, 'site', f), join(OUT, f));
copyFileSync(join(ROOT, 'vendor', 'ronda', 'diagram.js'), join(OUT, 'diagram.js'));
const CSS = [join(ROOT, 'vendor', 'trueml', 'tokens.css'), join(ROOT, 'vendor', 'ronda', 'components.css'), join(ROOT, 'site', 'sensei.css')].map(leer).join('\n');
writeFileSync(join(OUT, 'sensei.css'), CSS);
// el índice del buscador: lecciones (publicadas) y conceptos
const sinMd = (s) => s.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, t) => t || GLOS.get(id).termino.toLowerCase()).replace(/[*`]/g, '');
writeFileSync(join(OUT, 'indice.json'), JSON.stringify({
  lecciones: LISTAS.map((l) => ({ t: l.titulo, n: l.n, u: l.url, m: l.modulo.titulo })),
  conceptos: REALES().map((g) => ({ t: g.termino, en: g.en || '', u: `/glosario/#g-${g.id}`, c: sinMd(g.corto) })),
}));

const urls = Object.keys(pages);
const core = [...urls, '/sensei.css', '/app.js', '/diagram.js', '/indice.json', '/icon.svg', '/manifest.webmanifest'];
const hash = createHash('sha256');
for (const p of urls.sort()) hash.update(p).update(pages[p]);
hash.update(CSS).update(leer(join(ROOT, 'site', 'app.js'))).update(leer(join(ROOT, 'vendor', 'ronda', 'diagram.js')));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), leer(join(ROOT, 'site', 'sw.js')).replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITIO.url}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITIO.url}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
const enlazadosPlan = [...new Set(LISTAS.flatMap((l) => [...l.terminos].filter((id) => GLOS.get(id).plan)))];
console.log(`[build] glosario: ${REALES().length} conceptos · ${PRESENTA.size} presentados en alguna lección${enlazadosPlan.length ? ` · ${enlazadosPlan.length} enlazados que todavía no tienen su lección (${enlazadosPlan.join(', ')})` : ''}`);
if (adelantos.length) console.log(`[build] adelantos (palabras usadas antes de presentarse):\n  ${adelantos.join('\n  ')}`);
if (SOLO) { const l = POR_ID.get(SOLO); console.log(`[build] --solo ${SOLO}: ${l.palabras} palabras · ${l.min.esencial} min lo esencial, ${l.min.todo} min todo · ${JSON.stringify(l.cuenta)} · ${l.secciones.length} secciones · en ${OUT}`); }
console.log(`[build] listo: ${urls.length} páginas · ${LISTAS.length} de ${ORDEN.length} lecciones · BUILD ${BUILD}`);
