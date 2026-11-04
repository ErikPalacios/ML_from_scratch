#!/usr/bin/env node
// Arma el sitio en dist/ (lo que sube a Vercel). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html            portada: el camino, cómo funciona y el temario con tu avance
//   <leccion>/index.html  una página por cada content/lecciones/<id>.md que exista
//   glosario/index.html   todos los conceptos, con buscador
//   sw.js, cimientos.css… modo sin conexión y estilos (diseño Dojo de TrueML)
//
// Revisa al construir: que cada [[id]] exista en el glosario, que cada concepto se presente en una sola lección, que
// los diagramas y figuras existan, y cuenta las palabras que una lección usa antes de que alguna las presente
// («adelantos»: salen en su globo con su definición, pero conviene que sean pocas).
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { crear, esc } from './md.mjs';
import { validar as validarDiagrama, dibujar } from './diagrama.mjs';
import { marca, miniT, etapas as etapasDe, resumen, ETAPAS } from '../vendor/trueml/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = join(ROOT, 'content');
const OUT = join(ROOT, 'dist');
const leer = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(leer(p));
const errores = [];
const fail = (msg) => { console.error('[build] ERROR: ' + msg); process.exit(1); };

const SITIO = json(join(C, 'sitio.json'));
const TEMARIO = json(join(C, 'temario.json'));
const DOJO = existsSync(join(C, 'dojo.json')) ? json(join(C, 'dojo.json')) : { estaciones: [] };   // lo escribe apps/trueml/sync.mjs

// ---------------------------------------------------------------- glosario
const GLOS = new Map();
for (const g of json(join(C, 'glosario.json')).terminos) {
  if (!/^[a-z0-9-]+$/.test(g.id || '')) errores.push(`glosario: id inválido «${g.id}»`);
  if (GLOS.has(g.id)) errores.push(`glosario: «${g.id}» está dos veces`);
  for (const k of ['termino', 'corto']) if (!g[k]) errores.push(`glosario ${g.id}: falta «${k}»`);
  GLOS.set(g.id, { ver: [], ...g });
}
for (const g of GLOS.values()) for (const v of g.ver) if (!GLOS.has(v)) errores.push(`glosario ${g.id}: «ver» menciona «${v}», que no existe`);

// ---------------------------------------------------------------- temario y lecciones
const ORDEN = [];   // todas las lecciones del temario, en orden de lectura
for (const m of TEMARIO.modulos) {
  etapasDe(m.etapas);
  for (const l of m.lecciones) {
    etapasDe(l.etapas);
    l.modulo = m;
    l.url = `/${l.id}/`;
    l.archivo = join(C, 'lecciones', `${l.id}.md`);
    l.lista = existsSync(l.archivo);
    l.pos = ORDEN.length;
    ORDEN.push(l);
  }
}
const POR_ID = new Map(ORDEN.map((l) => [l.id, l]));
for (const g of GLOS.values()) if (g.leccion && !POR_ID.has(g.leccion)) errores.push(`glosario ${g.id}: «leccion» = «${g.leccion}», que no está en el temario`);
for (const f of readdirSync(join(C, 'lecciones')).filter((f) => f.endsWith('.md'))) if (!POR_ID.has(f.slice(0, -3))) errores.push(`lecciones/${f} no está en el temario`);

function frente(texto, archivo) {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) fail(`${archivo}: falta el encabezado --- … ---`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ['titulo', 'subtitulo', 'pregunta', 'minutos']) if (!meta[k]) fail(`${archivo}: falta «${k}» en el encabezado`);
  meta.requisitos = meta.requisitos ? meta.requisitos.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { meta, cuerpo: texto.slice(m[0].length) };
}

const diagrama = (id, pie, inline) => {
  const p = join(C, 'diagramas', `${id}.json`);
  if (!existsSync(p)) throw new Error(`falta content/diagramas/${id}.json`);
  const d = json(p), errs = validarDiagrama(d, id);
  if (errs.length) throw new Error(errs.join('; '));
  return dibujar(d, pie, inline);
};
const figura = (id) => {
  const p = join(C, 'figuras', `${id}.svg`);
  if (!existsSync(p)) throw new Error(`falta content/figuras/${id}.svg`);
  return leer(p).trim();
};

const LISTAS = ORDEN.filter((l) => l.lista);
const PRESENTA = new Map();   // concepto → la lección que lo presenta
for (const l of LISTAS) {
  const { meta, cuerpo } = frente(leer(l.archivo), `lecciones/${l.id}.md`);
  if (meta.titulo !== l.titulo) errores.push(`lecciones/${l.id}.md: el título «${meta.titulo}» no es el del temario («${l.titulo}»)`);
  for (const r of meta.requisitos) if (!POR_ID.has(r)) errores.push(`lecciones/${l.id}.md: requisito «${r}» no está en el temario`);
  l.meta = meta;
  try {
    Object.assign(l, crear({ glosario: GLOS, diagrama, figura, contexto: `lecciones/${l.id}.md` }).render(cuerpo));
  } catch (e) { fail(e.message); }
  for (const id of l.conceptos) {
    if (PRESENTA.has(id)) errores.push(`«${id}» se presenta en ${PRESENTA.get(id).id} y otra vez en ${l.id}`);
    else PRESENTA.set(id, l);
  }
}
// adelantos: palabras que una lección usa antes de que alguna lección (esta o una anterior) las presente
const adelantos = [];
for (const l of LISTAS) {
  l.adelantos = [...l.terminos].filter((id) => !PRESENTA.has(id) || PRESENTA.get(id).pos > l.pos);
  if (l.adelantos.length) adelantos.push(`${l.id}: ${l.adelantos.join(', ')}`);
}
if (errores.length) fail('\n  ' + errores.join('\n  '));

// ---------------------------------------------------------------- piezas comunes
const R = crear({ glosario: GLOS, diagrama, figura, contexto: 'glosario' });
const marcaNav = marca();
const TEMA = `<div class="tema d-tema" role="group" aria-label="Tema">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Auto']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false">${l}</button>`).join('')}</div>`;
const etapaNombre = Object.fromEntries(ETAPAS.map((e) => [e.id, e.nombre]));
const dojoDe = (num) => DOJO.estaciones.find((s) => s.num === num);

function barra({ ruta, indice = [] }) {
  return `<div class="d-top">
<div class="d-stripe" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
<header class="d-head">
  <div class="d-brand">
    <a class="d-logo" href="${SITIO.portada}"><span class="d-logo-mark">${marcaNav}</span><span class="d-word">True<span>ML</span></span></a>
    <span class="d-sep" aria-hidden="true"></span>
    <a class="d-app" href="/">${esc(SITIO.nombre)}</a>
    ${ruta ? `<span class="d-ruta">${esc(ruta)}</span>` : ''}
  </div>
  <div class="d-acciones"><a class="d-glos" href="/glosario/">Glosario</a>${TEMA}</div>
</header>
${indice.length ? `<nav class="d-nav" aria-label="En esta página">${indice.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>` : ''}
</div>`;
}

const pie = `<footer class="d-wrap d-foot">
  <div class="d-foot-tema"><span>Tema</span>${TEMA}</div>
  <p>© ${new Date().getFullYear()} Erik Palacios · Contenido bajo <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es">CC BY-NC-ND 4.0</a> · <a href="${SITIO.portada}">TrueML</a> · <a href="${SITIO.dojo}">Dojo</a> · <a href="${SITIO.issues}">Reportar un error</a></p>
  <p>Después de la primera visita, ${esc(SITIO.nombre)} abre sin conexión. Tu avance se guarda solo en este navegador.</p>
</footer>
<div class="g-pop" hidden role="dialog" aria-modal="false" aria-labelledby="g-pop-t"><div class="g-pop-in">
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

function pagina({ path, title, desc, body, globos = [] }) {
  const url = SITIO.url + path;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<script>try { var t = localStorage.getItem('cimientos-tema'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:locale" content="es_MX"><meta property="og:site_name" content="${esc(SITIO.nombre)} · TrueML">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
${existsSync(join(ROOT, 'site', 'og.png')) ? `<meta property="og:image" content="${SITIO.url}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${SITIO.url}/og.png">` : '<meta name="twitter:card" content="summary">'}
<meta name="twitter:title" content="${esc(title)}">
<meta name="theme-color" content="#EDEFF7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0A0F22" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/cimientos.css">
</head>
<body class="dojo">
${body}
${globos.length ? datosGlobos(globos) : ''}
<script src="/app.js" defer></script>
</body>
</html>
`;
}

const etiquetaEtapas = (lista) => `<span class="c-etapas">${miniT(lista)}</span>`;

// ---------------------------------------------------------------- lección
function paginaLeccion(l) {
  const m = l.meta, mod = l.modulo;
  const anterior = ORDEN.slice(0, l.pos).reverse().find((x) => x.lista);
  const siguiente = ORDEN[l.pos + 1];
  const est = l.estacion && dojoDe(l.estacion);
  const req = m.requisitos.map((r) => POR_ID.get(r));
  const requisitos = req.length
    ? `<p>Antes de esta lección: ${req.map((r) => (r.lista ? `<a href="${r.url}">${esc(r.titulo)}</a>` : `${esc(r.titulo)} <small>(próximamente)</small>`)).join(', ')}.</p>`
    : '<p>No necesitas saber nada antes. Empieza aquí.</p>';
  const indice = [['pregunta', 'La pregunta'], ...l.secciones];
  const enc = etapasDe(l.etapas);
  const hero = `<section class="d-wrap d-hero c-hero">
  <div class="d-hero-txt">
    <a class="d-back" href="/#temario">← Temario</a>
    <span class="d-pill">${esc(mod.titulo)} · lección ${mod.lecciones.indexOf(l) + 1} de ${mod.lecciones.length}</span>
    <h1>${esc(l.titulo)}</h1>
    <p class="d-lead">${esc(m.subtitulo)}</p>
    <div class="c-meta"><span>${esc(m.minutos)} min de lectura</span><span>${l.conceptos.length} conceptos nuevos</span>${etiquetaEtapas(l.etapas)}</div>
  </div>
  <div class="d-hero-mark c-hero-t">${marca({ etiquetas: true, encender: enc, maxAltura: '340px', clave: 'l' })}</div>
</section>`;
  const cierre = `<section class="c-cierre" aria-label="Al terminar">
  <button type="button" class="d-btn c-leida" data-leida="${l.id}" aria-pressed="false"><span class="c-leida-no">Marcar como leída</span><span class="c-leida-si">Leída ✓</span></button>
  ${est ? `<a class="d-card c-sig c-dojo" href="${est.url || SITIO.dojo}"><span class="d-lbl">Practícalo en el Dojo</span><b>Estación ${est.num} · ${esc(est.titulo)}</b><span class="d-txt">${est.lista ? 'Construye, rehaz y rompe esta estación con Claude Code.' : 'La estación del Dojo todavía no está lista.'}</span></a>` : ''}
  ${siguiente ? `<a class="d-card c-sig${siguiente.lista ? '' : ' c-pronto'}" href="${siguiente.lista ? siguiente.url : '/#temario'}"><span class="d-lbl">Sigue</span><b>${esc(siguiente.titulo)}</b><span class="d-txt">${siguiente.lista ? esc(siguiente.modulo.titulo) : `Próximamente · ${esc(siguiente.modulo.titulo)} (fase ${siguiente.modulo.fase})`}</span></a>` : ''}
  ${anterior ? `<a class="c-ant" href="${anterior.url}">← ${esc(anterior.titulo)}</a>` : ''}
</section>`;
  const body = `${barra({ ruta: `${mod.titulo} · ${l.titulo}`, indice })}
${hero}
<main class="d-wrap c-main">
  <article class="c-art">
    <section class="c-pregunta" id="pregunta"><span class="c-lbl">La pregunta</span><p>${esc(m.pregunta)}</p><div class="c-req">${requisitos}</div></section>
    ${l.html}
    ${cierre}
  </article>
</main>
${pie}`;
  return pagina({ path: l.url, title: `${l.titulo} · ${SITIO.nombre} · TrueML`, desc: `${m.subtitulo} ${m.pregunta}`, body, globos: [...l.terminos] });
}

// ---------------------------------------------------------------- portada
function portada() {
  const primera = LISTAS[0];
  const modulos = TEMARIO.modulos.map((m, k) => {
    const items = m.lecciones.map((l) => l.lista
      ? `<li><a class="c-tl" href="${l.url}" data-leccion="${l.id}"><span class="c-tl-n"></span><span class="c-tl-t">${esc(l.titulo)}</span>${l.estacion ? `<span class="c-tl-est">Estación ${l.estacion}</span>` : ''}<span class="c-tl-ok" aria-label="leída">✓</span></a></li>`
      : `<li><span class="c-tl c-pronto"><span class="c-tl-n"></span><span class="c-tl-t">${esc(l.titulo)}</span>${l.estacion ? `<span class="c-tl-est">Estación ${l.estacion}</span>` : ''}</span></li>`).join('');
    const listas = m.lecciones.filter((l) => l.lista).length;
    return `<li class="d-card c-mod${listas ? '' : ' c-mod-pronto'}" id="m-${m.id}">
      <div class="c-mod-h"><span class="c-mod-n">${k}</span><div><h3>${esc(m.titulo)}</h3><p class="d-txt">${esc(m.resumen)}</p></div>${etiquetaEtapas(m.etapas)}</div>
      <ol class="c-tls">${items}</ol>
      <span class="c-mod-estado">${listas === m.lecciones.length ? 'Listo' : listas ? `${listas} de ${m.lecciones.length} lecciones` : `Próximamente · fase ${m.fase}`}</span>
    </li>`;
  }).join('\n');
  const total = ORDEN.length, hechas = LISTAS.length;
  const body = `${barra({ indice: [['camino', 'El camino'], ['como', 'Cómo funciona'], ['temario', 'Temario'], ['glosario', 'Glosario']] })}
<section class="d-wrap d-hero">
  <div class="d-hero-txt">
    <span class="d-pill">${esc(SITIO.pill)}</span>
    <h1>${esc(SITIO.nombre)}</h1>
    <p class="d-lead c-titular">${esc(SITIO.titular)}</p>
    <p class="d-lead">${esc(SITIO.lead)}</p>
    <div class="d-btns">
      <a class="d-btn" href="${primera.url}">Empezar: ${esc(primera.titulo)}</a>
      <a class="d-btn d-btn2" href="/glosario/">Abrir el glosario · ${GLOS.size}</a>
    </div>
    <p class="d-nota c-avance" data-avance="${LISTAS.map((l) => l.id).join(' ')}">${hechas} de ${total} lecciones publicadas.</p>
  </div>
  <div class="d-hero-mark">${marca({ etiquetas: true, maxAltura: '460px', clave: 'p' })}</div>
</section>
<main class="d-wrap d-main">
  <section class="d-sec" id="camino">
    <div class="d-h2"><h2>El camino de un modelo</h2><span class="d-tag">6 etapas · 12 estaciones</span></div>
    <p class="d-p">Todo lo que hay que hacer para que un modelo responda en una app de verdad cabe en seis etapas, y la última regresa a la primera. Cimientos explica cada una desde cero, en el mismo orden que el Dojo.</p>
    ${diagrama('camino', '', (s) => R.inline(s))}
  </section>
  <section class="d-sec" id="como">
    <div class="d-h2"><h2>Cómo funciona</h2></div>
    <ol class="c-como">${SITIO.como.map((x, k) => `<li class="d-card"><span class="c-como-n">${k + 1}</span><h3>${esc(x.t)}</h3><p class="d-txt">${esc(x.d)}</p></li>`).join('')}</ol>
  </section>
  <section class="d-sec" id="temario">
    <div class="d-h2"><h2>Temario</h2><span class="d-tag">${hechas} de ${total} lecciones</span></div>
    <p class="d-p">Primero el mapa, luego dos módulos de cimientos (lo básico de ML y lo básico de la computadora y la red) y después una lección por cada estación de C01. Las lecciones que todavía no están dicen en qué fase llegan.</p>
    <ol class="c-mods">${modulos}</ol>
  </section>
  <section class="d-sec" id="glosario">
    <div class="d-h2"><h2>Glosario</h2><span class="d-tag">${GLOS.size} conceptos</span></div>
    <p class="d-p">Cada concepto vive en un solo lugar, con su definición en palabras simples, su nombre en inglés y las lecciones que lo usan. Cuando te surja una duda en el Dojo o en la Ronda, la respuesta se agrega aquí: así no queda regada.</p>
    <div class="c-chips">${[...GLOS.values()].sort((a, b) => a.termino.localeCompare(b.termino, 'es')).map((g) => `<a href="/glosario/#g-${g.id}">${esc(g.termino)}</a>`).join('')}</div>
  </section>
</main>
${pie}`;
  return pagina({ path: '/', title: `${SITIO.nombre} · la teoría del dato a producción, desde cero · TrueML`, desc: SITIO.descripcion, body, globos: [] });
}

// ---------------------------------------------------------------- glosario
function paginaGlosario() {
  const usanTodos = new Map([...GLOS.keys()].map((id) => [id, LISTAS.filter((l) => l.terminos.has(id))]));
  const lista = [...GLOS.values()].sort((a, b) => a.termino.localeCompare(b.termino, 'es'));
  const letra = (g) => g.termino.normalize('NFD')[0].toUpperCase();
  const letras = [...new Set(lista.map(letra))];
  const entrada = (g) => {
    const p = PRESENTA.get(g.id), f = g.leccion && POR_ID.get(g.leccion);
    const usan = usanTodos.get(g.id);
    const t = new Set();
    return `<article class="d-card c-g" id="g-${g.id}" data-buscar="${esc((g.termino + ' ' + (g.en || '') + ' ' + g.corto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\[\[[^|\]]*\|?|\]\]/g, ''))}">
      <div class="c-g-h"><h3>${esc(g.termino)}</h3>${g.en ? `<span class="c-k-en">${esc(g.en)}</span>` : ''}</div>
      <p class="c-g-def">${R.inline(g.corto, t)}</p>
      ${g.largo ? `<p class="d-txt">${R.inline(g.largo, t)}</p>` : ''}
      ${g.analogia ? `<p class="d-txt"><b>Analogía. </b>${R.inline(g.analogia, t)}</p>` : ''}
      ${g.ejemplo ? `<p class="d-txt"><b>Ejemplo. </b>${R.inline(g.ejemplo, t)}</p>` : ''}
      <div class="c-g-pie">
        ${p ? `<span>Se presenta en <a href="${p.url}#k-${g.id}">${esc(p.titulo)}</a></span>` : ''}
        ${f && f !== p ? `<span>A fondo en ${f.lista ? `<a href="${f.url}">${esc(f.titulo)}</a>` : `${esc(f.titulo)} <small>(fase ${f.modulo.fase})</small>`}</span>` : ''}
        ${usan.length > 1 ? `<span>Aparece en ${usan.length} lecciones</span>` : ''}
      </div>
      ${g.ver.length ? `<div class="c-chips c-chips-s">${g.ver.map((v) => `<a href="#g-${v}">${esc(GLOS.get(v).termino)}</a>`).join('')}</div>` : ''}
    </article>`;
  };
  const body = `${barra({ ruta: 'Glosario' })}
<section class="d-wrap c-glos-h">
  <a class="d-back" href="/">← ${esc(SITIO.nombre)}</a>
  <h1>Glosario</h1>
  <p class="d-lead">${GLOS.size} conceptos, cada uno en un solo lugar. Las palabras subrayadas abren su definición sin salir de la página.</p>
  <label class="c-buscar"><span class="d-lbl">Buscar</span><input type="search" placeholder="modelo, latencia, drift…" autocomplete="off" data-buscar-en=".c-g"></label>
  <nav class="c-letras" aria-label="Letras">${letras.map((x) => `<a href="#l-${x}">${x}</a>`).join('')}</nav>
  <p class="d-nota c-sin" hidden>Nada coincide. Si falta un concepto, <a href="${SITIO.issues}">dímelo en GitHub</a> y lo agrego.</p>
</section>
<main class="d-wrap c-glos">
  ${letras.map((x) => `<section class="c-letra" id="l-${x}"><h2>${x}</h2><div class="c-g-lista">${lista.filter((g) => letra(g) === x).map(entrada).join('\n')}</div></section>`).join('\n')}
</main>
${pie}`;
  return pagina({ path: '/glosario/', title: `Glosario · ${SITIO.nombre} · TrueML`, desc: `Los ${GLOS.size} conceptos para llevar un modelo de ML a producción, explicados en palabras simples, con su nombre en inglés.`, body, globos: [...GLOS.keys()] });
}

// ---------------------------------------------------------------- escribir
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const pages = { '/': portada(), '/glosario/': paginaGlosario() };
for (const l of LISTAS) pages[l.url] = paginaLeccion(l);
for (const [path, html] of Object.entries(pages)) {
  mkdirSync(join(OUT, path), { recursive: true });
  writeFileSync(join(OUT, path, 'index.html'), html);
  console.log(`[build] ${path}`);
}
for (const f of ['app.js', 'icon.svg', 'manifest.webmanifest', 'og.png']) if (existsSync(join(ROOT, 'site', f))) copyFileSync(join(ROOT, 'site', f), join(OUT, f));
const CSS = leer(join(ROOT, 'vendor', 'trueml', 'tokens.css')) + '\n' + leer(join(ROOT, 'site', 'cimientos.css'));
writeFileSync(join(OUT, 'cimientos.css'), CSS);

const urls = Object.keys(pages);
const core = [...urls, '/cimientos.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];
const hash = createHash('sha256');
for (const p of urls.sort()) hash.update(p).update(pages[p]);
hash.update(CSS).update(leer(join(ROOT, 'site', 'app.js')));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), leer(join(ROOT, 'site', 'sw.js')).replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITIO.url}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITIO.url}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] glosario: ${GLOS.size} conceptos · ${PRESENTA.size} presentados en alguna lección`);
if (adelantos.length) console.log(`[build] adelantos (palabras usadas antes de presentarse):\n  ${adelantos.join('\n  ')}`);
console.log(`[build] listo: ${urls.length} páginas · ${LISTAS.length} de ${ORDEN.length} lecciones · BUILD ${BUILD}`);
