#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html            inicio: el video «Cómo se usa», tu avance, el camino y el temario
//   <leccion>/index.html  una página por cada content/lecciones/<id>.md que exista
//   glosario/index.html   todos los conceptos, con buscador
//   repaso/index.html     tarjetas del glosario con repetición espaciada (Leitner, 5 cajas); sus datos en
//                         repaso/tarjetas.json y su lógica en site/repaso.js. Funciona sin conexión.
//   que-sigue/index.html  «¿Qué sigue después de Sensei?»: el Dojo y la Ronda de Diseño. Es el único lugar del sitio que
//                         los nombra (y el cierre de una lección, con su estación del Dojo); las lecciones no.
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
const RONDA = json(join(C, 'ronda.json'));   // solo para /que-sigue/
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
  // El tiempo de lectura sale del texto (200 palabras por minuto) más lo que toma cada pieza interactiva. Lo esencial
  // es la intro y las secciones sin [extra], sin lo que va dentro de :::profundo (eso es de la segunda pasada).
  const PESO = { diagramas: 1, figuras: 0.5, calculadoras: 1.5, ejercicios: 1.5, cuentas: 0.5 };
  const piezas = (p) => Object.entries(PESO).reduce((a, [k, w]) => a + (p[k] || 0) * w, 0);
  let esencial = 0, todo = 0;
  for (const s of [{ ...l.intro, extra: false }, ...l.secciones]) {
    const primera = (s.palabras - s.profundo) / 200 + piezas(s.piezas), segunda = s.profundo / 200 + piezas(s.piezasProfundo);
    todo += primera + segunda;
    if (!s.extra) esencial += primera;
  }
  l.palabras = l.intro.palabras + l.secciones.reduce((a, x) => a + x.palabras, 0);
  l.min = { todo: Math.max(1, Math.round(todo)), esencial: Math.max(1, Math.round(esencial)) };
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
  tarjetas: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="5" width="9.5" height="8.5" rx="1.2"/><path d="M5 2.5h7.5a1 1 0 0 1 1 1V10"/></svg>',
  chev: '<svg class="ico chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
};
const TEMA = `<div class="tema" role="group" aria-label="Tema">${[['auto', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false">${l}</button>`).join('')}</div>`;
const dojoDe = (num) => DOJO.estaciones.find((s) => s.num === num);
const rondaUrl = (id) => `${RONDA.url}/#${id}`;
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
  const top = [['/', ICO.casa, 'Inicio', 'inicio'], ['/glosario/', ICO.libro, `Glosario`, 'glosario'], ['/repaso/', ICO.tarjetas, 'Repaso', 'repaso']]
    .map(([href, ico, t, id]) => `<a class="nav__item" href="${href}"${id === actual ? ' aria-current="page"' : ''}>${ico}<span>${t}</span>${id === 'glosario' ? `<span class="nav__count">${REALES().length}</span>` : id === 'repaso' ? '<span class="nav__count" data-repaso-hoy></span>' : '<span></span>'}</a>`).join('');
  return `<aside class="sidebar" id="sidebar" aria-label="Índice">
  <div class="sidebar__head">${marcaLink('TrueML · teoría desde cero')}<button type="button" class="btn-ico sidebar__close" aria-label="Cerrar el índice" data-cajon="cerrar">${ICO.x}</button></div>
  <div class="side-search" role="search"><input type="search" placeholder="Buscar lecciones y conceptos…" aria-label="Buscar lecciones y conceptos" autocomplete="off" data-buscar-nav><kbd aria-hidden="true">/</kbd><ul class="side-res" hidden></ul></div>
  <div class="side-prog"><div class="side-prog__row"><span class="lbl">Progreso</span><b data-prog>0/${LISTAS.length}</b></div>${strip(ORDEN)}</div>
  <nav class="nav"><div class="nav__top">${top}</div>${grupos}<div class="nav__top nav__fin"><a class="nav__item" href="/que-sigue/"${actual === 'que-sigue' ? ' aria-current="page"' : ''}>${ICO.ronda}<span>¿Qué sigue después de Sensei?</span><span></span></a></div></nav>
  <div class="sidebar__foot">
    <div class="tema-row"><span class="lbl">Tema</span>${TEMA}</div>
    <span>Tu avance se guarda solo en este navegador.</span>
  </div>
</aside>`;
}

const pie = `<footer class="pie">
  <p>© ${new Date().getFullYear()} Erik Palacios · Contenido bajo <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es">CC BY-NC-ND 4.0</a> · <a href="${SITIO.portada}">TrueML</a> · <a href="/que-sigue/">Después de Sensei</a> · <a href="${SITIO.issues}">Reportar un error</a></p>
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

function pagina({ path, title, desc, actual, contenido, toc = '', ancho = false, globos = [], diagramas = false, scripts = [], leccion = false }) {
  const url = SITIO.url + path;
  const og = existsSync(join(ROOT, 'site', 'og.png'));
  return `<!doctype html>
<html lang="es" data-tm-herramienta="${esc(SITIO.nombre)}" data-tm-inicio="/" data-tm-clave="sensei" data-tm-portada="${SITIO.portada}/"${leccion ? ' data-tm-avance="#contenido .prose section.sec" data-tm-notas="#contenido .prose" data-tm-tanque-en=".phead__meta"' : ''}>
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
<script src="/codigo.js" defer></script>
<script src="/piezas.js" defer></script>
<script src="/app.js" defer></script>
${scripts.map((s) => `<script src="${s}" defer></script>`).join('\n')}
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
  const contenido = `<article class="page">
  <header class="phead">
    <p class="eyebrow"><a href="/#m-${mod.id}">${mod.num} · ${esc(mod.titulo)}</a><span aria-hidden="true">·</span><span>Lección ${mod.lecciones.indexOf(l) + 1} de ${mod.lecciones.length}</span></p>
    <h1 class="phead__title" id="titulo">${esc(l.titulo)}</h1>
    ${m.en ? `<p class="phead__en">${esc(m.en)}</p>` : ''}
    <p class="phead__summary">${esc(m.subtitulo)}</p>
    <div class="phead__meta"><span>⏱ ${l.min.esencial < l.min.todo ? `${l.min.esencial} min lo esencial · ${l.min.todo} min todo` : `${l.min.todo} min de lectura`}</span><span>${l.conceptos.length} conceptos nuevos</span>${l.cuenta.calculadoras ? `<span>${l.cuenta.calculadoras} calculadora${l.cuenta.calculadoras > 1 ? 's' : ''}</span>` : ''}${l.cuenta.ejercicios ? `<span>${l.cuenta.ejercicios} ejercicios</span>` : ''}<span>${miniT(l.etapas)}</span></div>
    <details class="page-toc"><summary>${ICO.chev}<span class="lbl">Secciones</span><span class="page-toc__count">${l.secciones.length}</span></summary><ol>${secciones}</ol></details>
  </header>
  <div class="prose">
    <div class="c-pregunta"><span class="c-lbl">La pregunta</span><p>${esc(m.pregunta)}</p><div class="c-req">${requisitos}</div></div>
    ${l.html}
  </div>
  <section class="cierre" aria-label="Al terminar">
    <button type="button" class="btn c-leida" data-leida="${l.id}" aria-pressed="false"><span class="no">Marcar como leída</span><span class="si">Leída ✓</span></button>
    ${l.conceptos.length ? `<a class="c-repaso" href="/repaso/?l=${l.id}">${ICO.tarjetas}<span>${l.conceptos.length === 1 ? 'Repasar el concepto de esta lección con tarjetas' : `Repasar los ${l.conceptos.length} conceptos de esta lección con tarjetas`}</span></a>` : ''}
    ${siguiente ? `<a class="card${siguiente.lista ? '' : ' card--pronto'}" href="${siguiente.lista ? siguiente.url : '/#temario'}"><span class="lbl">Sigue · ${siguiente.n}</span><b>${esc(siguiente.titulo)}</b><span class="txt">${siguiente.lista ? esc(siguiente.modulo.titulo) : `Próximamente · ${esc(siguiente.modulo.titulo)} (fase ${siguiente.modulo.fase})`}</span></a>` : ''}
    ${siguiente ? '' : `<a class="card card--ronda" href="/que-sigue/"><span class="lbl">Terminaste el curso</span><b>¿Qué sigue después de Sensei?</b><span class="txt">Practicar con código y defender el diseño en una entrevista.</span></a>`}
    ${est ? `<a class="card card--dojo" href="${est.url || SITIO.dojo}"><span class="lbl">Practícalo con código</span><b>Estación ${est.num} del Dojo: ${esc(est.titulo)}</b><span class="txt">${est.lista ? 'El Dojo es la parte de TrueML donde construyes, rehaces y rompes cada pieza del sistema de Alba con Claude Code.' : 'El Dojo es la parte de TrueML donde practicas con código. Esta estación todavía no está lista.'}</span></a>` : ''}
    ${anterior ? `<a class="c-ant" href="${anterior.url}">← ${anterior.n} · ${esc(anterior.titulo)}</a>` : ''}
  </section>
</article>`;
  const toc = `<aside class="toc" aria-label="En esta página"><p class="toc__title">En esta página</p><ol class="toc__list">${secciones}</ol><div class="toc__foot">${l.n} · ${esc(mod.titulo)}<br><a href="#titulo">↑ Arriba</a></div></aside>`;
  return pagina({ path: l.url, title: `${l.titulo} · ${SITIO.nombre} · TrueML`, desc: `${m.subtitulo} ${m.pregunta}`, actual: l.id, contenido, toc,
    globos: [...l.terminos], diagramas: l.html.includes('dg-mount'), leccion: true });
}

// ================================================================ inicio
// El video «Cómo se usa»: los archivos viven en site/video/ y el texto en sitio.json (video). Los capítulos son botones;
// app.js los conecta con el video. Sin JavaScript, el video se ve igual con sus controles.
const VIDEO = SITIO.video && existsSync(join(ROOT, 'site', 'video', 'como-se-usa.mp4')) ? SITIO.video : null;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function seccionVideo() {
  if (!VIDEO) return '';
  const caps = (VIDEO.capitulos || []).map((c) => `<li><button type="button" class="vcap" data-vcap="${c.s}"><span class="vcap__t">${mmss(c.s)}</span><span>${esc(c.t)}</span></button></li>`).join('');
  return `<section class="home-sec" id="como-se-usa" aria-labelledby="h-video">
  <div class="eyebrow">${esc(VIDEO.kicker)}</div>
  <h2 id="h-video">${esc(VIDEO.titulo)}</h2>
  <p>${esc(VIDEO.texto)}</p>
  <div class="vid"><video controls preload="none" playsinline poster="/video/como-se-usa.jpg" width="1920" height="1080" data-video><source src="/video/como-se-usa.mp4" type="video/mp4">Tu navegador no puede mostrar el video. <a href="/video/como-se-usa.mp4">Descárgalo aquí</a>.</video></div>
  ${caps ? `<nav class="vcaps" aria-label="Partes del video"><ol>${caps}</ol></nav>` : ''}
</section>`;
}

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
    <div class="btns"><a class="btn" href="${primera.url}" data-seguir>Empezar: ${esc(primera.titulo)}</a><a class="btn btn--2" href="#temario">Ver el temario</a>${VIDEO ? `<a class="btn-video" href="#como-se-usa">▶ ${esc(VIDEO.kicker)} · ${esc(VIDEO.duracion)}</a>` : ''}</div>
  </div>
  <div class="home-t">${marca({ etiquetas: true, maxAltura: '420px', clave: 'p' })}</div>
</section>
${seccionVideo()}
<section class="home-sec" aria-labelledby="h-prog">
  <h2 id="h-prog">Tu avance</h2>
  <div class="prog"><span class="prog__big"><span data-prog-n>0</span> <small>de ${LISTAS.length} leídas</small></span>${strip(ORDEN)}
    <div class="prog__ley"><span><i style="background:var(--g)"></i>Leída</span><span><i style="background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)"></i>Lista para leer</span><span><i style="background:repeating-linear-gradient(135deg,var(--tm-off) 0 2px,transparent 2px 4px)"></i>Próximamente</span><span>${LISTAS.length} de ${ORDEN.length} lecciones publicadas</span></div></div>
</section>
<section class="home-sec" aria-labelledby="h-camino">
  <h2 id="h-camino">El camino de un modelo</h2>
  <p>Todo lo que hay que hacer para que un modelo responda en una app de verdad cabe en seis etapas, y la última regresa a la primera. Toca cada caja para ver qué es, o recórrelo paso a paso.</p>
  ${diagrama('camino', 'Las seis etapas de la T de TrueML. Cada una tiene su módulo de lecciones.', (s) => R.inline(s, usados))}
</section>
<section class="home-sec" id="temario" aria-labelledby="h-temario">
  <h2 id="h-temario">Temario</h2>
  <p>Primero el mapa. Luego los cimientos de verdad: lo básico de ML, los números, la computadora, la red, los datos, las herramientas, la nube y la seguridad. Al final, una lección por cada una de las 12 estaciones del sistema de Alba, la empresa que seguimos en todo el curso. Las que todavía no están dicen en qué fase llegan.</p>
  <ol class="mods">${mods}</ol>
  <a class="card card--ronda" href="/que-sigue/"><span class="lbl">Al terminar</span><b>¿Qué sigue después de Sensei?</b><span class="txt">Las dos herramientas de TrueML para practicar lo que aprendiste y defenderlo en una entrevista.</span></a>
</section>
<section class="home-sec" aria-labelledby="h-como">
  <h2 id="h-como">Cómo se lee</h2>
  <ol class="ruta">${SITIO.como.map((x, k) => { const tag = x.u ? 'a' : 'div'; return `<li><${tag} class="card"${x.u ? ` href="${esc(x.u)}"` : ''}><span class="n">${k + 1}</span><b>${esc(x.t)}</b><span class="txt">${esc(x.d)}</span></${tag}></li>`; }).join('')}</ol>
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
  <p class="phead__summary">${REALES().length} conceptos, cada uno en un solo lugar, con su nombre en inglés y las lecciones que lo usan. Cuando a alguien le surge una duda, la respuesta se agrega o se mejora aquí.</p>
  <label class="buscar"><span class="lbl">Buscar</span><input type="search" placeholder="modelo, softmax, latencia…" autocomplete="off" data-buscar-en=".gent"></label>
  <nav class="letras" aria-label="Letras">${letras.map((x) => `<a href="#l-${x}">${x}</a>`).join('')}</nav>
  <p class="c-req c-sin" hidden>Nada coincide. Si falta un concepto, <a href="${SITIO.issues}">dímelo en GitHub</a> y lo agrego.</p>
</header>
${letras.map((x) => `<section class="letra" id="l-${x}"><h2>${x}</h2><div class="g-lista">${lista.filter((g) => letra(g) === x).map(entrada).join('\n')}</div></section>`).join('\n')}`;
  return pagina({ path: '/glosario/', title: `Glosario · ${SITIO.nombre} · TrueML`, desc: `Los ${REALES().length} conceptos para llevar un modelo de ML a producción, explicados en palabras simples, con su nombre en inglés.`,
    actual: 'glosario', contenido, ancho: true, globos: REALES().map((g) => g.id) });
}

// ================================================================ ¿qué sigue después de Sensei?
// El único lugar del sitio que presenta el Dojo y la Ronda de Diseño, con sus códigos (C01, M01…).
function paginaQueSigue() {
  const leccion = (id) => {
    const l = POR_ID.get(id);
    return l.lista
      ? `<li><a class="tl" href="${l.url}" data-leccion="${l.id}"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)}</span><span class="tl__ok" aria-label="leída">✓</span></a></li>`
      : `<li><span class="tl is-soon"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)} · fase ${l.modulo.fase}</span><span></span></span></li>`;
  };
  const mods = RONDA.modulos.map((rm) => {
    const ls = rm.lecciones.filter((id) => POR_ID.has(id));
    return `<li class="rmod" id="r-${rm.id}">
      <div class="rmod__h"><a href="${rondaUrl(rm.id)}"><b>${rm.id.toUpperCase()}</b>${esc(rm.titulo)}</a><span class="rmod__cob">${ls.length} lecciones</span></div>
      <ol class="tls">${ls.map(leccion).join('')}</ol>
    </li>`;
  }).join('\n');
  const estaciones = DOJO.estaciones.map((e) => (e.lista && e.url
    ? `<li><a class="tl" href="${e.url}"><span class="tl__n">${String(e.num).padStart(2, '0')}</span><span>${esc(e.titulo)}</span><span class="tl__ok" style="opacity:1">→</span></a></li>`
    : `<li><span class="tl is-soon"><span class="tl__n">${String(e.num).padStart(2, '0')}</span><span>${esc(e.titulo)} · próximamente</span><span></span></span></li>`)).join('');
  const contenido = `<header class="phead">
  <p class="eyebrow">Después del curso</p>
  <h1 class="phead__title" id="titulo">¿Qué sigue después de ${esc(SITIO.nombre)}?</h1>
  <p class="phead__en">What comes after ${esc(SITIO.nombre)}</p>
  <p class="phead__summary">${esc(SITIO.nombre)} es la teoría: qué es cada pieza, por qué existe y cómo se calcula. TrueML tiene dos herramientas más para lo que sigue: el Dojo, para practicarlo con código, y la Ronda de Diseño, para defender el diseño completo en una entrevista.</p>
</header>
<section class="home-sec" aria-labelledby="h-dojo">
  <h2 id="h-dojo">Practicar: el Dojo</h2>
  <p>En el Dojo construyes, rehaces y rompes un mini-proyecto por cada estación del sistema de Alba, con Claude Code como compañero. Es el mismo caso que leíste aquí, con los mismos números. Allá se llama <b>C01</b>: es el caso 1 de la Ronda de Diseño, que viene abajo.</p>
  <p>Un buen ritmo: lee la lección de una estación aquí y, en cuanto la termines, practícala en el Dojo.</p>
  <ol class="tls">${estaciones}</ol>
  <div class="conecta"><a class="btn btn--2" href="${SITIO.dojo}">Abrir el Dojo →</a></div>
</section>
<section class="home-sec" aria-labelledby="h-ronda">
  <h2 id="h-ronda">Defender: la Ronda de Diseño</h2>
  <p>La Ronda de Diseño ML enseña a diseñar el sistema completo como en una entrevista de ML System Design. Tiene 15 módulos, de M01 a M15, y 15 casos, de C01 a C15: C01 es el de Alba, y los demás van del video en tiempo real y el fraude a los sistemas con LLMs. Da por sabidos cientos de conceptos, y todos están en ${esc(SITIO.nombre)}.</p>
  <p>Cada tarjeta lista las lecciones que conviene repasar antes de ese módulo, en orden de lectura. Las que ya leíste se marcan con ✓.</p>
  <ol class="rmods">${mods}</ol>
  <div class="conecta"><a class="btn btn--2" href="${RONDA.url}">Abrir la Ronda de Diseño →</a></div>
</section>`;
  return pagina({ path: '/que-sigue/', title: `¿Qué sigue después de ${SITIO.nombre}? · TrueML`, desc: 'Después del curso de teoría: practicar con código en el Dojo y defender el diseño en la Ronda de Diseño ML.', actual: 'que-sigue', contenido, ancho: true });
}

// ================================================================ repaso: tarjetas del glosario
// Cada concepto que presenta una lección publicada es una tarjeta. El frente: el término, su nombre en inglés y la
// lección. El dorso: «corto» y, en «Ver más», «largo», la analogía y el ejemplo. El texto va ya convertido a HTML en
// repaso/tarjetas.json; site/repaso.js lleva las cajas (Leitner) en localStorage. Sin JavaScript, la página explica qué
// es y manda al glosario.
function datosRepaso() {
  const mods = [], lecs = {};
  for (const m of TEMARIO.modulos) {
    const ls = m.lecciones.filter((l) => l.lista);
    if (!ls.length) continue;
    mods.push([m.id, m.num, m.titulo, ls.map((l) => l.id)]);
    for (const l of ls) lecs[l.id] = [l.n, l.titulo, m.id];
  }
  const tarjetas = [];
  for (const l of LISTAS) for (const id of l.conceptos) {
    const g = GLOS.get(id), f = g.leccion && POR_ID.get(g.leccion);
    const t = { i: id, t: g.termino, l: l.id, c: R.inline(g.corto) };
    if (g.en) t.en = g.en;
    if (g.largo) t.lg = R.inline(g.largo);
    if (g.analogia) t.an = R.inline(g.analogia);
    if (g.ejemplo) t.ej = R.inline(g.ejemplo);
    if (f && f !== l) t.f = [f.lista ? f.url : null, f.titulo, f.lista ? '' : `fase ${f.modulo.fase}`];
    tarjetas.push(t);
  }
  return { modulos: mods, lecciones: lecs, tarjetas };
}

function paginaRepaso(datos) {
  const porLec = new Map();
  for (const t of datos.tarjetas) porLec.set(t.l, (porLec.get(t.l) || 0) + 1);
  const mods = datos.modulos.map(([id, num, titulo, ls]) => {
    const n = ls.reduce((a, l) => a + (porLec.get(l) || 0), 0);
    return `<li class="rp-mod" data-mod="${id}">
      <label class="rp-mod__h"><input type="checkbox" data-sel-mod="${id}"><span class="rp-mod__t"><b>${num} · ${esc(titulo)}</b><span class="rp-mod__n">${n} conceptos · <span data-av-txt="${id}">ninguno repasado</span></span></span></label>
      <div class="rp-av" aria-hidden="true"><i class="rp-av__firme" data-av-firme="${id}"></i><i class="rp-av__visto" data-av-visto="${id}"></i></div>
      <details class="rp-lecs"><summary>${ICO.chev}<span>Elegir lecciones (${ls.length})</span></summary><ul>${ls.map((l) => { const x = POR_ID.get(l); return `<li><label><input type="checkbox" data-sel-lec="${l}" data-de="${id}"><span><span class="rp-lec__n">${x.n}</span> ${esc(x.titulo)}</span><span class="rp-lec__c" data-lec-c="${l}">${porLec.get(l) || 0}</span></label></li>`; }).join('')}</ul></details>
    </li>`;
  }).join('\n');
  const total = datos.tarjetas.length.toLocaleString('en-US');   // 1,025, como en el resto del curso
  const contenido = `<header class="phead">
  <p class="eyebrow">Práctica</p>
  <h1 class="phead__title" id="titulo">Repaso</h1>
  <p class="phead__en">Spaced repetition · flashcards</p>
  <p class="phead__summary">Los ${total} conceptos del glosario, como tarjetas. Ves el término, intentas recordar qué es y volteas la tarjeta: recordar sin mirar fija un concepto mejor que releerlo. Las que olvidas vuelven pronto; las que sabes, en unos días.</p>
</header>
<div class="rp-sinjs" data-rp-sinjs>
  <p>El repaso necesita JavaScript: es el que voltea las tarjetas y recuerda cuándo te toca ver cada una. Sin él, todos los conceptos están en el <a href="/glosario/">glosario</a>, con su definición, su analogía y su ejemplo.</p>
</div>
<div class="rp" data-rp hidden>
  <section class="rp-elegir" data-rp-elegir aria-labelledby="h-elegir">
    <h2 id="h-elegir" class="rp-h">Qué repasar</h2>
    <p class="rp-intro">Marca qué quieres repasar y pulsa «Empezar el repaso». Cada sesión trae hasta 20 tarjetas.</p>
    <div class="rp-filtros">
      <label class="rp-filtro"><input type="checkbox" data-filtro="leidas"><span><b>Solo las lecciones que marqué como leídas</b><small>Con el botón «Marcar como leída» del final de cada lección.</small></span></label>
      <label class="rp-filtro"><input type="checkbox" data-filtro="cuestan"><span><b>Solo las que todavía no se me quedan</b><small>Las que ya viste y siguen en las dos primeras cajas: las que no recordaste, las que te costaron y las que solo te han salido fáciles una vez.</small></span></label>
    </div>
    <div class="rp-mods-h"><span class="lbl">Módulos</span><button type="button" class="rp-link" data-sel="todo">Elegir todos</button><button type="button" class="rp-link" data-sel="nada">Quitar todos</button></div>
    <ul class="rp-mods">${mods}</ul>
    <div class="rp-listo">
      <p class="rp-cuenta" data-rp-cuenta aria-live="polite"></p>
      <button type="button" class="btn" data-rp-empezar>Empezar el repaso</button>
    </div>
  </section>
  <section class="rp-sesion" data-rp-sesion hidden aria-labelledby="rp-pos">
    <div class="rp-top"><h2 class="lbl" id="rp-pos" data-rp-pos>Tarjeta 1 de 20</h2><div class="rp-barra" aria-hidden="true"><i data-rp-barra></i></div><button type="button" class="rp-link" data-rp-terminar title="Lo que ya calificaste queda guardado">Terminar</button></div>
    <div class="rp-card" data-rp-card tabindex="-1">
      <div class="rp-frente" aria-live="polite">
        <span class="rp-caja" data-rp-caja></span>
        <p class="rp-t" data-rp-t></p>
        <p class="rp-en" data-rp-en></p>
        <p class="rp-de" data-rp-de></p>
      </div>
      <div class="rp-dorso" data-rp-dorso aria-live="polite" hidden>
        <p class="rp-corto" data-rp-corto></p>
        <details class="rp-mas" data-rp-mas><summary>${ICO.chev}<span>Ver más</span></summary><div data-rp-mas-in></div></details>
        <p class="rp-ir" data-rp-ir></p>
      </div>
    </div>
    <div class="rp-acc">
      <button type="button" class="btn rp-voltear" data-rp-voltear>Voltear la tarjeta <kbd>Espacio</kbd></button>
      <p class="rp-pregunta" data-rp-pregunta hidden>¿Te acordaste?</p>
      <div class="rp-notas" data-rp-notas role="group" aria-label="¿Te acordaste?" hidden>
        <button type="button" class="rp-nota rp-nota--1" data-nota="1"><kbd>1</kbd><b>No me acordé</b><small data-rp-cuando="1">Vuelve en esta sesión</small></button>
        <button type="button" class="rp-nota rp-nota--2" data-nota="2"><kbd>2</kbd><b>Me costó</b><small data-rp-cuando="2"></small></button>
        <button type="button" class="rp-nota rp-nota--3" data-nota="3"><kbd>3</kbd><b>Fácil</b><small data-rp-cuando="3"></small></button>
      </div>
    </div>
    <p class="rp-teclas">Con teclado: <kbd>Espacio</kbd> voltea la tarjeta; <kbd>1</kbd>, <kbd>2</kbd> y <kbd>3</kbd> dicen qué tan bien te acordaste.</p>
  </section>
  <section class="rp-fin" data-rp-fin hidden aria-labelledby="h-fin">
    <h2 id="h-fin" class="rp-h" tabindex="-1">Terminaste esta sesión</h2>
    <ul class="rp-res" data-rp-res></ul>
    <div class="rp-fin__btns"><button type="button" class="btn" data-rp-otra>Otra sesión</button><button type="button" class="btn btn--2" data-rp-volver>Elegir qué repasar</button></div>
  </section>
  <section class="rp-como" aria-labelledby="h-como-rp">
    <h2 id="h-como-rp" class="rp-h">Cómo funciona</h2>
    <p>Cada tarjeta vive en una de cinco cajas, y su caja dice cuándo vuelve a salir. Una tarjeta nueva entra a la caja 1. Si te salió fácil, sube una caja. Si no te acordaste, regresa a la caja 1 y la vuelves a ver antes de terminar la sesión. Si te costó, se queda en su caja y vuelve como pronto al día siguiente. Entre más alta la caja, más tarda en volver:</p>
    <ol class="rp-cajas"><li><b>Caja 1</b><span>el mismo día</span></li><li><b>Caja 2</b><span>al día siguiente</span></li><li><b>Caja 3</b><span>en 3 días</span></li><li><b>Caja 4</b><span>en 7 días</span></li><li><b>Caja 5</b><span>en 16 días</span></li></ol>
    <p>Así repasas más lo que olvidas y menos lo que ya sabes. Cada sesión trae hasta 20 tarjetas: primero las que te tocan hoy (las que ya viste y cuya fecha de volver ya llegó) y después nuevas, en el orden del curso. Las tarjetas «firmes» son las de las cajas 4 y 5: te salieron fáciles al menos tres veces desde la última vez que no te acordaste.</p>
    <p class="rp-borrar"><span>Tu avance del repaso se guarda solo en este navegador.</span><button type="button" class="rp-link" data-rp-borrar>Borrar mi avance del repaso</button></p>
  </section>
</div>`;
  return pagina({ path: '/repaso/', title: `Repaso · ${SITIO.nombre} · TrueML`, desc: `Los ${total} conceptos del glosario de ${SITIO.nombre} como tarjetas de repaso: las que olvidas vuelven pronto y las que sabes, en unos días. Funciona sin conexión.`,
    actual: 'repaso', contenido, scripts: ['/repaso.js'] });
}

// ================================================================ escribir
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const REPASO = SOLO ? null : datosRepaso();
const pages = SOLO ? {} : { '/': portada(), '/glosario/': paginaGlosario(), '/repaso/': paginaRepaso(REPASO), '/que-sigue/': paginaQueSigue() };
for (const l of LISTAS) pages[l.url] = paginaLeccion(l);
for (const [path, html] of Object.entries(pages)) {
  mkdirSync(join(OUT, path), { recursive: true });
  writeFileSync(join(OUT, path, 'index.html'), html);
  console.log(`[build] ${path}`);
}
for (const f of ['app.js', 'repaso.js', 'icon.svg', 'manifest.webmanifest', 'og.png']) if (existsSync(join(ROOT, 'site', f))) copyFileSync(join(ROOT, 'site', f), join(OUT, f));
// el video de la portada: se copia tal cual y nunca entra a la caché del service worker (ver site/sw.js)
if (!SOLO && existsSync(join(ROOT, 'site', 'video'))) { mkdirSync(join(OUT, 'video'), { recursive: true }); for (const f of readdirSync(join(ROOT, 'site', 'video'))) if (!f.startsWith('.')) copyFileSync(join(ROOT, 'site', 'video', f), join(OUT, 'video', f)); }
copyFileSync(join(ROOT, 'vendor', 'ronda', 'diagram.js'), join(OUT, 'diagram.js'));
for (const f of ['codigo.js', 'piezas.js']) copyFileSync(join(ROOT, 'vendor', 'trueml', f), join(OUT, f));
const CSS = [join(ROOT, 'vendor', 'trueml', 'tokens.css'), join(ROOT, 'vendor', 'trueml', 'piezas.css'), join(ROOT, 'vendor', 'ronda', 'components.css'), join(ROOT, 'site', 'sensei.css')].map(leer).join('\n');
writeFileSync(join(OUT, 'sensei.css'), CSS);
// el índice del buscador: lecciones (publicadas) y conceptos
const sinMd = (s) => s.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, t) => t || GLOS.get(id).termino.toLowerCase()).replace(/[*`]/g, '');
writeFileSync(join(OUT, 'indice.json'), JSON.stringify({
  lecciones: LISTAS.map((l) => ({ t: l.titulo, n: l.n, u: l.url, m: l.modulo.titulo })),
  conceptos: REALES().map((g) => ({ t: g.termino, en: g.en || '', u: `/glosario/#g-${g.id}`, c: sinMd(g.corto) })),
}));

const TARJETAS = REPASO ? JSON.stringify(REPASO) : '';
if (REPASO) { writeFileSync(join(OUT, 'repaso', 'tarjetas.json'), TARJETAS); console.log(`[build] repaso: ${REPASO.tarjetas.length} tarjetas · tarjetas.json ${(Buffer.byteLength(TARJETAS) / 1024).toFixed(0)} KB`); }

const urls = Object.keys(pages);
const core = [...urls, '/sensei.css', '/app.js', '/codigo.js', '/piezas.js', '/diagram.js', '/indice.json', '/icon.svg', '/manifest.webmanifest', ...(REPASO ? ['/repaso.js', '/repaso/tarjetas.json'] : [])];
const hash = createHash('sha256');
for (const p of urls.sort()) hash.update(p).update(pages[p]);
hash.update(CSS).update(TARJETAS).update(leer(join(ROOT, 'site', 'repaso.js'))).update(leer(join(ROOT, 'site', 'app.js'))).update(leer(join(ROOT, 'vendor', 'ronda', 'diagram.js'))).update(leer(join(ROOT, 'vendor', 'trueml', 'piezas.js'))).update(leer(join(ROOT, 'vendor', 'trueml', 'codigo.js')));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), leer(join(ROOT, 'site', 'sw.js')).replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITIO.url}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITIO.url}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
const enlazadosPlan = [...new Set(LISTAS.flatMap((l) => [...l.terminos].filter((id) => GLOS.get(id).plan)))];
console.log(`[build] glosario: ${REALES().length} conceptos · ${PRESENTA.size} presentados en alguna lección${enlazadosPlan.length ? ` · ${enlazadosPlan.length} enlazados que todavía no tienen su lección (${enlazadosPlan.join(', ')})` : ''}`);
if (adelantos.length) console.log(`[build] adelantos (palabras usadas antes de presentarse):\n  ${adelantos.join('\n  ')}`);
if (SOLO) { const l = POR_ID.get(SOLO); console.log(`[build] --solo ${SOLO}: ${l.palabras} palabras · ${l.min.esencial} min lo esencial, ${l.min.todo} min todo · ${JSON.stringify(l.cuenta)} · ${l.secciones.length} secciones · en ${OUT}`); }
console.log(`[build] listo: ${urls.length} páginas · ${LISTAS.length} de ${ORDEN.length} lecciones · BUILD ${BUILD}`);
