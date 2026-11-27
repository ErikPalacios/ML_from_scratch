#!/usr/bin/env node
// Arma el sitio de IA Privada en dist/ (lo que sube a Vercel). Es el armazón de Sensei (apps/sensei/tools/build.mjs):
// el mismo formato de lectura, el mismo Markdown (tools/md.mjs), el mismo glosario con globos y el mismo motor de
// calculadoras (tools/calculadora.mjs, con lo que IA Privada le suma). Sin dependencias: corre igual en tu Mac y en Vercel.
//   index.html                 inicio con las 4 secciones: Lecciones, Herramientas, Casos y Dojo · rama IA Privada
//   herramientas/<id>/         una página por cada content/herramientas/<id>.md que exista (la calculadora y sus conceptos)
//   <leccion>/index.html       una página por cada content/lecciones/<id>.md que exista
//   casos/<id>/index.html      una página por cada content/casos/<id>.md que exista (los casos de content/casos.json)
//   glosario/index.html        todos los conceptos, con buscador
//   indice.json                lo que busca el buscador de la barra lateral
//   sw.js, ia-privada.css…     modo sin conexión y estilos
//
// Los datos que vienen de otras apps los copia apps/trueml/sync.mjs y no se editan a mano:
//   content/datos/gpus.json    las GPUs de Sensei: la única fuente de especificaciones (las listas de GPU salen de aquí)
//   content/datos/sensei.json  los títulos y direcciones de las lecciones de Sensei que cada módulo da por leídas
//   content/dojo.json          la rama IA Privada del Dojo, con qué estaciones ya están listas
//
// Revisa al construir: que cada [[id]] exista en el glosario, que cada concepto se presente en una sola página, que las
// calculadoras estén bien (tools/calculadora.mjs las evalúa con sus valores iniciales, sus extremos y sus preajustes) y
// que lo que se enlaza de Sensei exista.
//
//   node tools/build.mjs                 todo el sitio en dist/
//   node tools/build.mjs --solo <id>     solo esa lección o herramienta, en .solo/<id>/
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { crear, esc } from './md.mjs';
import { validar as validarDiagrama, montar } from './diagrama.mjs';
import { validar as validarCalc, dibujar as dibujarCalc } from './calculadora.mjs';
import { validarDatos, dibujarCatalogo } from './catalogo.mjs';
import { marca, miniT, etapas as etapasDe, donar } from '../vendor/trueml/lib.mjs';

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
const HERR = json(join(C, 'herramientas.json')).herramientas;
const CASOS = json(join(C, 'casos.json'));
const DOJO = json(join(C, 'dojo.json'));
const SENSEI = json(join(C, 'datos', 'sensei.json'));
const GPUS = json(join(C, 'datos', 'gpus.json'));
const APIS = json(join(C, 'datos', 'apis.json'));
const EQUIPOS = json(join(C, 'datos', 'equipos.json'));
errores.push(...validarDatos(GPUS, EQUIPOS));
for (const a of APIS.apis) if (!a.fuente?.url || !a.fuente?.consultado || typeof a.usd_millon_entrada !== 'number' || typeof a.usd_millon_salida !== 'number') errores.push(`apis.json ${a.id}: necesita precios y fuente con url y fecha`);
const CLAVE = SITIO.clave;

// ---------------------------------------------------------------- glosario: un archivo por página en content/glosario/
const GLOS = new Map();
const TERMINOS = readdirSync(join(C, 'glosario')).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
  try { return json(join(C, 'glosario', f)).terminos.map((g) => ({ ...g, archivo: f })); }
  catch (e) { throw new Error(`glosario/${f}: ${e.message}`); }
});
for (const g of TERMINOS) {
  if (!/^[a-z0-9-]+$/.test(g.id || '')) errores.push(`glosario: id inválido «${g.id}»`);
  if (GLOS.has(g.id)) errores.push(`glosario: «${g.id}» está dos veces (${GLOS.get(g.id).archivo} y ${g.archivo})`);
  for (const k of ['termino', 'corto']) if (!g[k]) errores.push(`glosario ${g.id}: falta «${k}»`);
  // «sensei»: la lección de Sensei donde el concepto se explica a fondo (se enlaza en el globo y en el glosario)
  if (g.sensei && !SENSEI.lecciones[g.sensei]) errores.push(`glosario ${g.id}: «sensei» = «${g.sensei}», que no está en el temario de Sensei`);
  GLOS.set(g.id, { ver: [], ...g });
}
const REALES = () => [...GLOS.values()];
for (const g of GLOS.values()) for (const v of g.ver) if (!GLOS.has(v)) errores.push(`glosario ${g.id}: «ver» menciona «${v}», que no existe`);
const senseiDe = (id) => { const l = SENSEI.lecciones[id]; return l && { id, titulo: l.titulo, url: l.url }; };

// ---------------------------------------------------------------- temario, herramientas y lecciones
const ORDEN = [];   // todas las lecciones del temario, en orden de lectura
TEMARIO.modulos.forEach((m, k) => {
  etapasDe(m.etapas);
  m.num = k + 1;
  for (const s of m.sensei || []) if (!SENSEI.lecciones[s]) errores.push(`temario ${m.id}: «sensei» menciona «${s}», que no está en el temario de Sensei`);
  for (const l of m.lecciones) {
    etapasDe(l.etapas);
    l.modulo = m;
    l.url = `/${l.id}/`;
    l.archivo = join(C, 'lecciones', `${l.id}.md`);
    l.lista = existsSync(l.archivo);
    l.n = String(ORDEN.length + 1).padStart(2, '0');
    ORDEN.push(l);
  }
});
// Las herramientas van primero en el orden de lectura: presentan sus conceptos antes que cualquier lección.
HERR.forEach((h, k) => {
  h.url = `/herramientas/${h.id}/`;
  h.archivo = join(C, 'herramientas', `${h.id}.md`);
  h.lista = existsSync(h.archivo);
  h.herramienta = true;
  h.n = `H${k + 1}`;
});
// Los casos van al final del orden de lectura: aplican lo que presentan las herramientas y las lecciones.
CASOS.casos.forEach((c, k) => {
  c.url = `/casos/${c.id}/`;
  c.archivo = join(C, 'casos', `${c.id}.md`);
  c.lista = existsSync(c.archivo);
  c.caso = true;
  c.num = k + 1;
  c.n = `C${k + 1}`;
});
const PAGINAS = [...HERR, ...ORDEN, ...CASOS.casos];
PAGINAS.forEach((p, k) => { p.pos = k; });
const POR_ID = new Map(PAGINAS.map((l) => [l.id, l]));
if (POR_ID.size !== PAGINAS.length) errores.push('una herramienta, una lección o un caso tienen el mismo id');
for (const g of GLOS.values()) if (g.leccion && !POR_ID.has(g.leccion)) errores.push(`glosario ${g.id}: «leccion» = «${g.leccion}», que no está en el temario`);
for (const [dir, f] of [['lecciones', 'md'], ['herramientas', 'md'], ['casos', 'md']]) if (existsSync(join(C, dir))) for (const x of readdirSync(join(C, dir)).filter((x) => x.endsWith('.' + f))) if (!POR_ID.has(x.slice(0, -3))) errores.push(`${dir}/${x} no está en el temario ni en herramientas.json`);

function frente(texto, archivo) {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) fail(`${archivo}: falta el encabezado --- … ---`);
  const meta = Object.fromEntries(m[1].split('\n').filter(Boolean).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  for (const k of ['titulo', 'subtitulo', 'pregunta']) if (!meta[k]) fail(`${archivo}: falta «${k}» en el encabezado`);
  const lista = (k) => (meta[k] ? meta[k].split(',').map((s) => s.trim()).filter(Boolean) : []);
  meta.requisitos = lista('requisitos');
  meta.sensei = lista('sensei');   // lecciones de Sensei que esta página da por leídas
  return { meta, cuerpo: texto.slice(m[0].length) };
}

const diagrama = (id, pie, inline) => {
  const p = join(C, 'diagramas', `${id}.json`);
  if (!existsSync(p)) throw new Error(`falta content/diagramas/${id}.json`);
  const d = json(p), errs = validarDiagrama(d, id);
  if (errs.length) throw new Error(errs.join('; '));
  return montar(id, d, pie, inline);
};
// Una entrada con "opciones": "gpus" se llena con las GPUs de content/datos/gpus.json (su «valor» es la VRAM en GB y
// «inicial» dice cuál va elegida). Así ningún número de una GPU se escribe a mano en una calculadora.
const GPU_POR_ID = new Map(GPUS.gpus.map((g) => [g.id, g]));
function resolverDatos(c, id) {
  for (const x of c.entradas || []) {
    if (x.opciones !== 'gpus') continue;
    const g = GPU_POR_ID.get(x.inicial);
    if (!g) throw new Error(`calculadora ${id}: entrada ${x.id}: «inicial» = «${x.inicial}» no está en gpus.json`);
    x.tipo = 'opcion';
    x.opciones = GPUS.gpus.map((y) => ({ id: y.id, valor: y.vram_gb, label: `${y.nombre} · ${y.vram_gb} GB` }));
    x.valor = g.vram_gb;
    x.seleccion = GPUS.gpus.indexOf(g);
  }
  // Una lista de preajustes con "datos": "gpus" | "apis" se llena desde esos archivos: cada opción pone en las entradas
  // de «campos» el dato de esa GPU o API. Un dato que el fabricante no publica queda en 0 y la nota lo dice. Las entradas
  // toman su valor inicial de la opción «inicial»: ningún número de una GPU o de un precio se escribe a mano.
  const porId = new Map((c.entradas || []).map((x) => [x.id, x]));
  for (const pa of (Array.isArray(c.preajustes) ? c.preajustes : [])) {
    if (!pa.datos) continue;
    const fuente = { gpus: GPUS.gpus, apis: APIS.apis }[pa.datos];
    if (!fuente) throw new Error(`calculadora ${id}: «datos» = «${pa.datos}» no existe (gpus o apis)`);
    const filas = fuente.filter((y) => (!pa.ids || pa.ids.includes(y.id)) && (pa.requiere || []).every((k) => dato(y, k) !== null));
    const ini = filas.findIndex((y) => y.id === pa.inicial);
    if (ini < 0) throw new Error(`calculadora ${id}: «${pa.label}»: «inicial» = «${pa.inicial}» no está en ${pa.datos}.json (o no pasa el filtro)`);
    pa.opciones = filas.map((y) => {
      const valores = {}, faltan = [];
      for (const [k, campo] of Object.entries(pa.campos)) { const v = dato(y, campo); valores[k] = v === null ? 0 : v; if (v === null) faltan.push(NOMBRE_DATO[campo] || campo); }
      const f = y.fuente || {};
      const nota = pa.datos === 'gpus'
        ? `${y.nombre}: especificaciones de [${dominio(f.url)}](${f.url}), consultado ${f.consultado}.${pa.campos && Object.values(pa.campos).includes('renta_min_usd_hora') && y.nube?.length ? ` Renta: la más barata de gpus.json (${rentaMin(y).proveedor}, ${rentaMin(y).fuente.consultado}).` : ''}${faltan.length ? ` **Sin dato publicado:** ${faltan.join(', ')} (queda en 0; escribe el tuyo).` : ''}`
        : `${y.proveedor}, ${y.modelo}: [precios de ${dominio(f.url)}](${f.url}), consultado ${f.consultado}.${y.nota ? ` ${y.nota}` : ''}`;
      return { id: y.id, label: pa.datos === 'gpus' ? `${y.nombre} · ${y.vram_gb} GB` : `${y.modelo} · ${y.proveedor}`, valores, nota };
    });
    pa.inicial = ini;
    for (const [k, v] of Object.entries(pa.opciones[ini].valores)) if (porId.has(k)) porId.get(k).valor = v;
    delete pa.datos; delete pa.campos; delete pa.ids; delete pa.requiere;
  }
  return c;
}
// Lo que una calculadora puede pedir de una GPU: cualquier campo de gpus.json, más la renta más barata por GPU y hora.
const rentaMin = (g) => (g.nube || []).filter((n) => n.usd_gpu_hora && !n.gpu_cobrada_aparte).sort((a, b) => a.usd_gpu_hora - b.usd_gpu_hora)[0] || null;
function dato(y, campo) {
  if (campo === 'renta_min_usd_hora') { const r = rentaMin(y); return r ? r.usd_gpu_hora : null; }
  const v = y[campo];
  return typeof v === 'number' ? v : null;
}
const NOMBRE_DATO = { fp16_tflops_denso: 'FP16 denso', fp8_tflops_denso: 'FP8 denso', int8_tops_denso: 'INT8 denso', compra_usd: 'precio de compra', renta_min_usd_hora: 'renta por hora', potencia_w: 'consumo', ancho_banda_gbs: 'ancho de banda' };
const dominio = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'la fuente'; } };
const calculadora = (id, pie, inline) => {
  const p = join(C, 'calculadoras', `${id}.json`);
  if (!existsSync(p)) throw new Error(`falta content/calculadoras/${id}.json`);
  const c = resolverDatos(json(p), id), errs = validarCalc(c, id);
  if (errs.length) throw new Error(errs.join('; '));
  return dibujarCalc(c, id, pie, inline);
};
const figura = (id) => {
  const p = join(C, 'figuras', `${id}.svg`);
  if (!existsSync(p)) throw new Error(`falta content/figuras/${id}.svg`);
  return leer(p).trim();
};

// Los enlaces a una herramienta con valores (/herramientas/sizing/?r=200&p1=l40s): cada nombre tiene que ser una entrada
// de su calculadora o una lista de preajustes (p0, p1…) con una opción que exista (su id de datos o su índice), y cada
// número tiene que caber en el rango de su entrada. Así un caso nunca abre la herramienta con un control que no existe.
const CALC_DE = new Map();   // herramienta → su calculadora, ya con los datos puestos
function calcDe(h) {
  if (CALC_DE.has(h)) return CALC_DE.get(h);
  const md = join(C, 'herramientas', `${h}.md`);
  const m = existsSync(md) && leer(md).match(/^:::calculadora\s+(\S+)/m);
  const c = m ? resolverDatos(json(join(C, 'calculadoras', `${m[1]}.json`)), m[1]) : null;
  CALC_DE.set(h, c);
  return c;
}
function enlacesHerramienta(texto, rel) {
  const e = [];
  for (const [, h, q] of texto.matchAll(/\]\(\/herramientas\/([a-z0-9-]+)\/\?([^)#\s]+)/g)) {
    const c = calcDe(h);
    if (!c) { e.push(`${rel}: el enlace a /herramientas/${h}/ lleva valores, pero esa herramienta no tiene calculadora`); continue; }
    const listas = Array.isArray(c.preajustes) ? c.preajustes : c.preajustes ? [c.preajustes] : [];
    for (const [k, v] of new URLSearchParams(q)) {
      const pm = k.match(/^p(\d+)$/);
      if (pm) {
        const pa = listas[+pm[1]];
        if (!pa) e.push(`${rel}: /herramientas/${h}/?${k}: esa calculadora no tiene la lista de preajustes ${pm[1]}`);
        else if (!pa.opciones.some((o, n) => o.id === v || String(n) === v)) e.push(`${rel}: /herramientas/${h}/?${k}=${v}: no es una opción de «${pa.label}»`);
        continue;
      }
      const x = (c.entradas || []).find((y) => y.id === k);
      if (!x) { e.push(`${rel}: /herramientas/${h}/?${k}: «${k}» no es una entrada de la calculadora`); continue; }
      if (x.tipo === 'opcion') { if (!x.opciones.some((o) => o.id === v || o.valor === Number(v))) e.push(`${rel}: /herramientas/${h}/?${k}=${v}: no es una opción de «${x.label}»`); continue; }
      const n = Number(v);
      if (!Number.isFinite(n)) e.push(`${rel}: /herramientas/${h}/?${k}=${v}: no es un número`);
      else if ((x.min !== undefined && n < x.min) || (x.max !== undefined && n > x.max)) e.push(`${rel}: /herramientas/${h}/?${k}=${v}: fuera del rango de la entrada (${x.min}–${x.max})`);
    }
  }
  return e;
}

if (SOLO && !POR_ID.has(SOLO)) fail(`--solo ${SOLO}: no está en el temario ni en herramientas.json`);
if (SOLO && !POR_ID.get(SOLO).lista) fail(`--solo ${SOLO}: falta su archivo .md`);
const LISTAS = PAGINAS.filter((l) => l.lista && (!SOLO || l.id === SOLO));
const LECCIONES = LISTAS.filter((l) => !l.herramienta && !l.caso);
const PRESENTA = new Map();   // concepto → la página que lo presenta
for (const l of LISTAS) {
  const rel = `${l.herramienta ? 'herramientas' : l.caso ? 'casos' : 'lecciones'}/${l.id}.md`;
  const { meta, cuerpo } = frente(leer(l.archivo), rel);
  if (meta.titulo !== l.titulo) errores.push(`${rel}: el título «${meta.titulo}» no es el del temario («${l.titulo}»)`);
  errores.push(...enlacesHerramienta(leer(l.archivo), rel));
  for (const r of meta.requisitos) if (!POR_ID.has(r)) errores.push(`${rel}: requisito «${r}» no está en el temario`);
  for (const s of meta.sensei) if (!SENSEI.lecciones[s]) errores.push(`${rel}: «sensei» menciona «${s}», que no está en el temario de Sensei`);
  l.meta = meta;
  try {
    Object.assign(l, crear({ glosario: GLOS, diagrama, figura, calculadora, extras: { catalogo: (arg, dentro, inline) => dibujarCatalogo(GPUS, EQUIPOS, inline) }, contexto: rel }).render(cuerpo));
  } catch (e) { fail(e.message); }
  for (const id of l.conceptos) {
    if (PRESENTA.has(id)) errores.push(`«${id}» se presenta en ${PRESENTA.get(id).id} y otra vez en ${l.id}`);
    else PRESENTA.set(id, l);
  }
  // El tiempo de lectura: 200 palabras por minuto más lo que toma cada pieza interactiva (como en Sensei).
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
const adelantos = [];
for (const l of LISTAS) {
  l.adelantos = [...l.terminos].filter((id) => !PRESENTA.has(id) || PRESENTA.get(id).pos > l.pos);
  if (l.adelantos.length) adelantos.push(`${l.id}: ${l.adelantos.join(', ')}`);
}
if (!SOLO) for (const g of GLOS.values()) if (!PRESENTA.has(g.id)) errores.push(`glosario ${g.id} (${g.archivo}) no está en el :::conceptos de ninguna página`);
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
  calc: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5h5M5.5 8.5h1M9.5 8.5h1M5.5 11h1M9.5 11h1" stroke-linecap="round"/></svg>',
  dojo: '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 6.5h12M3.5 6.5V14M12.5 6.5V14M1.5 3.5c3 .9 10 .9 13 0M6 9.5h4"/></svg>',
  chev: '<svg class="ico chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
};
const TEMA = `<div class="tema" role="group" aria-label="Tema">${[['auto', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false">${l}</button>`).join('')}</div>`;
const marcaLink = (sub) => `<a class="brand" href="/"><span class="brand__mark">${marcaChica}</span><span class="brand__txt"><span class="brand__name">${esc(SITIO.nombre)}</span><span class="brand__sub">${esc(sub)}</span></span></a>`;
// Un enlace a una lección de Sensei: con dirección si ya está publicada, si no solo su título.
const aSensei = (id) => { const s = senseiDe(id); return s.url ? `<a href="${s.url}">${esc(s.titulo)}</a>` : esc(s.titulo); };

function sidebar(actual) {
  const navItem = (l) => (l.lista
    ? `<li><a class="nav__item" href="${l.url}" data-leccion="${l.id}" data-buscar="${esc(l.titulo.toLowerCase())}"${l.id === actual ? ' aria-current="page"' : ''}><span class="nav__num">${l.n}</span><span class="nav__title">${esc(l.corto || l.titulo)}</span><span class="nav__mk"><span class="nav__mk-ok" aria-label="leída">✓</span></span></a></li>`
    : `<li><span class="nav__item is-soon" data-buscar="${esc(l.titulo.toLowerCase())}"><span class="nav__num">${l.n}</span><span class="nav__title">${esc(l.corto || l.titulo)}</span><span class="nav__mk"></span></span></li>`);
  const grupo = (titulo, ls, fase, abierto) => {
    const listas = ls.filter((l) => l.lista).length;
    return `<details class="nav__group"${abierto || listas || ls.some((l) => l.id === actual) ? ' open' : ''}><summary><span class="nav__label">${titulo}</span><span class="nav__fase${listas === ls.length ? ' is-lista' : ''}">${listas === ls.length ? 'Listo' : listas ? `${listas}/${ls.length}` : `Fase ${fase}`}</span></summary><ol class="nav__list">${ls.map(navItem).join('')}</ol></details>`;
  };
  const grupos = grupo('Herramientas', HERR, 2, true) + TEMARIO.modulos.map((m) => grupo(`${m.num} · ${esc(m.titulo)}`, m.lecciones, m.fase, false)).join('')
    + grupo('Casos', CASOS.casos.map((c) => ({ ...c, n: `C${c.num}` })), CASOS.casos[0].fase, CASOS.casos.some((c) => c.lista));
  const top = [['/', ICO.casa, 'Inicio', 'inicio'], ['/glosario/', ICO.libro, 'Glosario', 'glosario']]
    .map(([href, ico, t, id]) => `<a class="nav__item" href="${href}"${id === actual ? ' aria-current="page"' : ''}>${ico}<span>${t}</span>${id === 'glosario' ? `<span class="nav__count">${REALES().length}</span>` : '<span></span>'}</a>`).join('');
  return `<aside class="sidebar" id="sidebar" aria-label="Índice">
  <div class="sidebar__head">${marcaLink(`TrueML · ${SITIO.subtitulo}`)}<button type="button" class="btn-ico sidebar__close" aria-label="Cerrar el índice" data-cajon="cerrar">${ICO.x}</button></div>
  <div class="side-search" role="search"><input type="search" placeholder="Buscar herramientas y conceptos…" aria-label="Buscar herramientas y conceptos" autocomplete="off" data-buscar-nav><kbd aria-hidden="true">/</kbd><ul class="side-res" hidden></ul></div>
  <nav class="nav"><div class="nav__top">${top}</div>${grupos}<div class="nav__top nav__fin"><a class="nav__item" href="${DOJO.url}">${ICO.dojo}<span>Dojo · rama ${esc(DOJO.nombre)}</span><span></span></a></div></nav>
  <div class="sidebar__foot">
    <div class="tema-row"><span class="lbl">Tema</span>${TEMA}</div>
    <span>Lo que eliges se guarda solo en este navegador.</span>
  </div>
</aside>`;
}

const pie = `<footer class="pie">
  <p>© ${new Date().getFullYear()} Erik Palacios · Contenido bajo <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es">CC BY-NC-ND 4.0</a> · <a href="${SITIO.portada}">TrueML</a> · <a href="${SITIO.sensei}">Sensei</a> · <a href="${SITIO.issues}">Reportar un error</a></p>
  <p>Después de la primera visita, ${esc(SITIO.nombre)} abre sin conexión, calculadoras incluidas.</p>
  <p>${esc(SITIO.nombre)} es gratis y sin anuncios. ¿Te sirvió? ${donar()}</p>
</footer>`;

const globo = `<div class="g-pop" hidden role="dialog" aria-modal="false" aria-labelledby="g-pop-t"><div class="g-pop-in">
  <button type="button" class="g-pop-x" aria-label="Cerrar">×</button>
  <span class="g-pop-t" id="g-pop-t"></span><span class="g-pop-en"></span>
  <p class="g-pop-def"></p>
  <p class="g-pop-donde"></p>
  <a class="g-pop-ir" href="/glosario/">Ver en el glosario →</a>
</div></div>`;

// Los datos de los globos: los conceptos que usa la página y, por si se abren desde un globo, los que usan sus definiciones.
// «f» (a fondo) apunta a la lección de Sensei del concepto, si la tiene.
function datosGlobos(ids) {
  const todos = new Set(ids), cola = [...ids];
  while (cola.length) {
    const id = cola.pop(), usados = new Set();
    R.inline(GLOS.get(id).corto, usados);
    for (const u of usados) if (!todos.has(u)) { todos.add(u); cola.push(u); }
  }
  const datos = {};
  for (const id of [...todos].sort()) {
    const g = GLOS.get(id), p = PRESENTA.get(id), s = g.sensei && senseiDe(g.sensei);
    datos[id] = { t: g.termino, en: g.en || '', c: R.inline(g.corto),
      p: p ? [p.url, p.titulo] : null,
      f: s ? [s.url, `${s.titulo} (Sensei)`, s.url ? '' : 'próximamente'] : null };
  }
  return `<script type="application/json" id="g-datos">${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>`;
}

function pagina({ path, title, desc, actual, contenido, toc = '', ancho = false, globos = [], diagramas = false, scripts = [], leccion = false }) {
  const url = SITIO.url + path;
  const og = existsSync(join(ROOT, 'site', 'og.png'));
  return `<!doctype html>
<html lang="es" data-tm-herramienta="${esc(SITIO.nombre)}" data-tm-inicio="/" data-tm-clave="${CLAVE}" data-tm-portada="${SITIO.portada}/"${leccion ? ' data-tm-avance="#contenido .prose section.sec" data-tm-notas="#contenido .prose" data-tm-tanque-en=".phead__meta"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<script>try { var t = localStorage.getItem('${CLAVE}-tema'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
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
<link rel="stylesheet" href="/ia-privada.css">
</head>
<body>
<a class="skip" href="#contenido">Saltar al contenido</a>
<header class="topbar"><button type="button" class="btn-ico" aria-label="Abrir el índice" aria-controls="sidebar" aria-expanded="false" data-cajon="abrir">${ICO.menu}</button>${marcaLink(SITIO.subtitulo)}</header>
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

// ================================================================ una lección o una herramienta
function paginaLeccion(l) {
  const m = l.meta, mod = l.modulo;
  const vecinos = l.herramienta ? HERR : l.caso ? CASOS.casos : ORDEN;
  const i = vecinos.indexOf(l);
  const anterior = vecinos.slice(0, i).reverse().find((x) => x.lista);
  const siguiente = vecinos[i + 1];
  const req = m.requisitos.map((r) => POR_ID.get(r));
  const leido = [...m.sensei, ...(mod ? mod.sensei || [] : [])].filter((x, k, a) => a.indexOf(x) === k);
  const requisitos = [
    req.length ? `Antes de esta página: ${req.map((r) => (r.lista ? `<a href="${r.url}">${esc(r.titulo)}</a>` : `${esc(r.titulo)} (próximamente)`)).join(', ')}.` : '',
    leido.length ? `Si un concepto se te hace nuevo, está explicado desde cero en Sensei: ${leido.map(aSensei).join(', ')}. Aquí se repasa lo justo para usarlo.` : '',
  ].filter(Boolean).join(' ') || 'No necesitas saber nada antes. Empieza aquí.';
  const secciones = l.secciones.map((x, k) => `<li><a class="toc__link${x.extra ? ' is-extra' : ''}" href="#${x.id}"><span class="toc__n">${String(k + 1).padStart(2, '0')}</span><span>${esc(x.t)}${x.extra ? ' <small>extra</small>' : ''}</span></a></li>`).join('');
  const ceja = l.herramienta
    ? `<a href="/#herramientas">Herramientas</a><span aria-hidden="true">·</span><span>${i + 1} de ${HERR.length}</span>`
    : l.caso ? `<a href="/#casos">Casos</a><span aria-hidden="true">·</span><span>Caso ${l.num} de ${CASOS.casos.length}</span>`
    : `<a href="/#m-${mod.id}">${mod.num} · ${esc(mod.titulo)}</a><span aria-hidden="true">·</span><span>Lección ${mod.lecciones.indexOf(l) + 1} de ${mod.lecciones.length}</span>`;
  const est = DOJO.estaciones.find((e) => (m.dojo || '') === e.id);
  const contenido = `<article class="page">
  <header class="phead">
    <p class="eyebrow">${ceja}</p>
    <h1 class="phead__title" id="titulo">${esc(l.titulo)}</h1>
    ${m.en ? `<p class="phead__en">${esc(m.en)}</p>` : ''}
    <p class="phead__summary">${esc(m.subtitulo)}</p>
    <div class="phead__meta"><span>⏱ ${l.min.esencial < l.min.todo ? `${l.min.esencial} min lo esencial · ${l.min.todo} min todo` : `${l.min.todo} min de lectura`}</span><span>${l.conceptos.length} conceptos</span>${l.cuenta.calculadoras ? `<span>${l.cuenta.calculadoras} calculadora${l.cuenta.calculadoras > 1 ? 's' : ''}</span>` : ''}${l.cuenta.intentos ? `<span>${l.cuenta.intentos} para intentar</span>` : ''}${l.cuenta.ejercicios ? `<span>${l.cuenta.ejercicios} ejercicios</span>` : ''}${l.etapas ? `<span>${miniT(l.etapas)}</span>` : ''}</div>
    <details class="page-toc"><summary>${ICO.chev}<span class="lbl">Secciones</span><span class="page-toc__count">${l.secciones.length}</span></summary><ol>${secciones}</ol></details>
  </header>
  <div class="prose">
    <div class="c-pregunta"><span class="c-lbl">La pregunta</span><p>${esc(m.pregunta)}</p><div class="c-req">${requisitos}</div></div>
    ${l.html}
  </div>
  <section class="cierre" aria-label="Al terminar">
    ${l.herramienta || l.caso ? '' : `<button type="button" class="btn c-leida" data-leida="${l.id}" aria-pressed="false"><span class="no">Marcar como leída</span><span class="si">Leída ✓</span></button>`}
    ${siguiente ? `<a class="card${siguiente.lista ? '' : ' card--pronto'}" href="${siguiente.lista ? siguiente.url : (l.herramienta ? '/#herramientas' : l.caso ? '/#casos' : '/#lecciones')}"><span class="lbl">Sigue · ${siguiente.caso ? `Caso ${siguiente.num}` : siguiente.n}</span><b>${esc(siguiente.titulo)}</b><span class="txt">${siguiente.lista ? esc(siguiente.resumen || siguiente.modulo?.titulo || '') : `Próximamente (fase ${siguiente.fase || siguiente.modulo?.fase}). ${esc(siguiente.resumen || '')}`}</span></a>` : ''}
    <a class="card card--dojo" href="${est && est.url ? est.url : DOJO.url}"><span class="lbl">Practícalo con código</span><b>${est ? `Estación ${est.num} del Dojo: ${esc(est.titulo)}` : `Dojo · rama ${esc(DOJO.nombre)}`}</b><span class="txt">${est && est.lista ? 'Constrúyelo, rómpelo y arréglalo con Claude Code.' : `En el Dojo levantas un modelo en tu Mac, lo mides, lo cuantizas y lo sirves. ${DOJO.estaciones.filter((e) => e.lista).length ? '' : 'Sus estaciones todavía están en camino.'}`}</span></a>
    ${anterior ? `<a class="c-ant" href="${anterior.url}">← ${anterior.caso ? `Caso ${anterior.num}` : anterior.n} · ${esc(anterior.titulo)}</a>` : ''}
  </section>
</article>`;
  const toc = `<aside class="toc" aria-label="En esta página"><p class="toc__title">En esta página</p><ol class="toc__list">${secciones}</ol><div class="toc__foot">${l.caso ? `Caso ${l.num} · Casos` : `${l.n} · ${esc(l.herramienta ? 'Herramientas' : mod.titulo)}`}<br><a href="#titulo">↑ Arriba</a></div></aside>`;
  return pagina({ path: l.url, title: `${l.caso ? `Caso: ${l.titulo}` : l.titulo} · ${SITIO.nombre} · TrueML`, desc: `${m.subtitulo} ${m.pregunta}`, actual: l.id, contenido, toc,
    globos: [...l.terminos], diagramas: l.html.includes('dg-mount'), leccion: !l.herramienta });
}

// ================================================================ inicio: las 4 secciones
const pronto = (fase) => `Próximamente · fase ${fase}`;
function portada() {
  const herr = HERR.map((h) => (h.lista
    ? `<li><a class="card card--herr" href="${h.url}"><span class="lbl">${h.n} · ${esc(h.corto)} · lista</span><b>${esc(h.titulo)}</b><span class="txt">${esc(h.resumen)}</span></a></li>`
    : `<li><div class="card card--pronto"><span class="lbl">${h.n} · ${esc(h.corto)} · ${pronto(h.fase)}</span><b>${esc(h.titulo)}</b><span class="txt">${esc(h.resumen)}</span></div></li>`)).join('');
  const mods = TEMARIO.modulos.map((m) => {
    const listas = m.lecciones.filter((l) => l.lista).length;
    const items = m.lecciones.map((l) => (l.lista
      ? `<li><a class="tl" href="${l.url}" data-leccion="${l.id}"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)}</span><span class="tl__ok" aria-label="leída">✓</span></a></li>`
      : `<li><span class="tl is-soon"><span class="tl__n">${l.n}</span><span>${esc(l.titulo)}${l.resumen ? ` <small>${esc(l.resumen)}</small>` : ''}</span><span></span></span></li>`)).join('');
    return `<li class="mod${listas ? '' : ' mod--pronto'}" id="m-${m.id}">
      <div class="mod__h"><span class="mod__n">${m.num}</span><h3>${esc(m.titulo)}</h3><p>${esc(m.resumen)}</p></div>
      <ol class="tls">${items}</ol>
      ${m.sensei?.length ? `<p class="mod__sensei"><span class="lbl">Da por leído en Sensei</span> ${m.sensei.map(aSensei).join(' · ')}</p>` : ''}
      <span class="mod__est">${listas === m.lecciones.length ? 'Listo' : listas ? `${listas} de ${m.lecciones.length} lecciones` : pronto(m.fase)}</span>
    </li>`;
  }).join('\n');
  const casos = CASOS.casos.map((c, k) => (c.lista
    ? `<li><a class="card card--caso" href="${c.url}"><span class="lbl">Caso ${k + 1} · listo</span><b>${esc(c.titulo)}</b><span class="txt">${esc(c.resumen)}</span></a></li>`
    : `<li><div class="card card--pronto"><span class="lbl">Caso ${k + 1} · ${pronto(c.fase)}</span><b>${esc(c.titulo)}</b><span class="txt">${esc(c.resumen)}</span></div></li>`)).join('');
  const sinGpu = new Set(DOJO.sin_gpu?.estaciones || []);
  const DONDE = { mac: 'Mac', gpu: 'GPU rentada', 'mac-gpu': 'Mac y GPU rentada' };
  const estaciones = DOJO.estaciones.map((e) => {
    const tag = e.lista && e.url ? 'a' : 'span';
    return `<li><${tag} class="tl${e.lista ? '' : ' is-soon'}"${e.lista ? ` href="${e.url}"` : ''}><span class="tl__n">${String(e.num).padStart(2, '0')}</span><span>${esc(e.titulo)} <small>${esc(e.sale)} · ${esc(DONDE[e.donde] || e.donde)}${sinGpu.has(e.num) ? ' · sin GPU' : ''}${e.lista ? '' : ' · próximamente'}</small></span><span>${e.lista ? '→' : ''}</span></${tag}></li>`;
  }).join('');
  const primera = HERR.find((h) => h.lista);
  const contenido = `<section class="home-hero">
  <div>
    <p class="eyebrow">${esc(SITIO.pill)}</p>
    <h1>${esc(SITIO.nombre)}</h1>
    <p class="titular">${esc(SITIO.titular)}</p>
    <p class="lead">${esc(SITIO.lead)}</p>
    <div class="btns">${primera ? `<a class="btn" href="${primera.url}">Probar: ${esc(primera.titulo)}</a>` : ''}<a class="btn btn--2" href="#lecciones">Ver el temario</a></div>
  </div>
  <div class="home-t">${marca({ etiquetas: true, maxAltura: '420px', clave: 'p' })}</div>
</section>
<nav class="home-secs" aria-label="Secciones">
  <a href="#lecciones"><b>Lecciones</b><span>${ORDEN.length} en ${TEMARIO.modulos.length} módulos</span></a>
  <a href="#herramientas"><b>Herramientas</b><span>${HERR.filter((h) => h.lista).length} de ${HERR.length} listas</span></a>
  <a href="#casos"><b>Casos</b><span>${CASOS.casos.filter((c) => c.lista).length ? `${CASOS.casos.filter((c) => c.lista).length} de ${CASOS.casos.length} listos` : `${CASOS.casos.length} empresas`}</span></a>
  <a href="#dojo"><b>Dojo</b><span>rama ${esc(DOJO.nombre)}</span></a>
</nav>
<section class="home-sec" id="herramientas" aria-labelledby="h-herr">
  <h2 id="h-herr">Herramientas</h2>
  <p>Calculadoras que corren en tu navegador, también sin conexión, y que muestran cada cuenta paso a paso con los números del momento. Usan las mismas fórmulas que Sensei y toman las especificaciones de las GPUs de un solo archivo, con fecha y fuente.</p>
  <ol class="ruta">${herr}</ol>
</section>
<section class="home-sec" id="lecciones" aria-labelledby="h-lec">
  <h2 id="h-lec">Lecciones</h2>
  <p>Cada concepto explicado desde cero, con el estándar de Sensei: diagramas, figuras, calculadoras y ejercicios con solución. No repiten lo que Sensei ya explica: cada módulo dice qué lecciones de Sensei da por leídas y desde ahí va más a fondo. ${LECCIONES.length ? `Van ${LECCIONES.length} de ${ORDEN.length}; los módulos que faltan dicen en qué fase llegan.` : 'Todavía no hay ninguna publicada; cada módulo dice en qué fase llega.'}</p>
  <ol class="mods">${mods}</ol>
</section>
<section class="home-sec" id="casos" aria-labelledby="h-casos">
  <h2 id="h-casos">Casos</h2>
  <p>Empresas ficticias resueltas de principio a fin: ${CASOS.pasos.map((p) => p.toLowerCase()).join(' → ')}. Cada caso usa las herramientas de arriba con sus propios números.</p>
  <ol class="ruta">${casos}</ol>
</section>
<section class="home-sec" id="dojo" aria-labelledby="h-dojo">
  <h2 id="h-dojo">Dojo · rama ${esc(DOJO.nombre)}</h2>
  <p>La práctica vive en el Dojo de TrueML: ahí construyes el stack, lo rompes y lo arreglas con Claude Code, estación por estación. ${esc(DOJO.resumen)}</p>
  <p><b>El caso de la rama: ${esc(DOJO.caso.nombre.toLowerCase())}.</b> ${esc(DOJO.caso.resumen)}</p>
  <ol class="tls tls--dojo">${estaciones}</ol>
  ${DOJO.sin_gpu ? `<p class="c-req">${esc(DOJO.sin_gpu.texto)}</p>` : ''}
  <div class="conecta"><a class="btn btn--2" href="${DOJO.url}">Abrir la rama en el Dojo →</a></div>
</section>`;
  return pagina({ path: '/', title: `${SITIO.nombre} · ${SITIO.subtitulo} · TrueML`, desc: SITIO.descripcion, actual: 'inicio', contenido, ancho: true });
}

// ================================================================ glosario
function paginaGlosario() {
  const usan = new Map(REALES().map((g) => [g.id, LISTAS.filter((l) => l.terminos.has(g.id))]));
  const lista = REALES().sort((a, b) => a.termino.localeCompare(b.termino, 'es'));
  const letra = (g) => g.termino.normalize('NFD')[0].toUpperCase();
  const letras = [...new Set(lista.map(letra))];
  const entrada = (g) => {
    const p = PRESENTA.get(g.id), s = g.sensei && senseiDe(g.sensei), u = usan.get(g.id), t = new Set();
    const buscar = (g.termino + ' ' + (g.en || '') + ' ' + g.corto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\[\[[^|\]]*\|?|\]\]/g, '');
    return `<article class="gent" id="g-${g.id}" data-buscar="${esc(buscar)}">
      <div class="gent__h"><h3>${esc(g.termino)}</h3>${g.en ? `<span class="c-k-en">${esc(g.en)}</span>` : ''}</div>
      <p class="gent__def">${R.inline(g.corto, t)}</p>
      ${g.largo ? `<p>${R.inline(g.largo, t)}</p>` : ''}
      ${g.analogia ? `<p><b>Analogía. </b>${R.inline(g.analogia, t)}</p>` : ''}
      ${g.ejemplo ? `<p><b>Ejemplo. </b>${R.inline(g.ejemplo, t)}</p>` : ''}
      <div class="gent__pie">${p ? `<span>Se presenta en <a href="${p.url}#k-${g.id}">${esc(p.titulo)}</a></span>` : ''}${s ? `<span>A fondo en Sensei: ${s.url ? `<a href="${s.url}">${esc(s.titulo)}</a>` : `${esc(s.titulo)} (próximamente)`}</span>` : ''}${u.length > 1 ? `<span>Aparece en ${u.length} páginas</span>` : ''}</div>
      ${g.ver.length ? `<div class="chips">${g.ver.map((v) => `<a class="chip" href="#g-${v}">${esc(GLOS.get(v).termino)}</a>`).join('')}</div>` : ''}
    </article>`;
  };
  const contenido = `<header class="phead">
  <p class="eyebrow">Referencia</p>
  <h1 class="phead__title" id="titulo">Glosario</h1>
  <p class="phead__en">Glossary · español–English</p>
  <p class="phead__summary">${REALES().length} conceptos, cada uno en un solo lugar, con su nombre en inglés, su analogía y dónde se explica a fondo. Crece con cada herramienta y cada lección.</p>
  <label class="buscar"><span class="lbl">Buscar</span><input type="search" placeholder="KV cache, cuantización, VRAM…" autocomplete="off" data-buscar-en=".gent"></label>
  <nav class="letras" aria-label="Letras">${letras.map((x) => `<a href="#l-${x}">${x}</a>`).join('')}</nav>
  <p class="c-req c-sin" hidden>Nada coincide. Si falta un concepto, <a href="${SITIO.issues}">dímelo en GitHub</a> y lo agrego.</p>
</header>
${letras.map((x) => `<section class="letra" id="l-${x}"><h2>${x}</h2><div class="g-lista">${lista.filter((g) => letra(g) === x).map(entrada).join('\n')}</div></section>`).join('\n')}`;
  return pagina({ path: '/glosario/', title: `Glosario · ${SITIO.nombre} · TrueML`, desc: `Los ${REALES().length} conceptos de ${SITIO.nombre} explicados en palabras simples, con su analogía y su nombre en inglés.`,
    actual: 'glosario', contenido, ancho: true, globos: REALES().map((g) => g.id) });
}

// ================================================================ escribir
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const pages = SOLO ? {} : { '/': portada(), '/glosario/': paginaGlosario() };
for (const l of LISTAS) pages[l.url] = paginaLeccion(l);
for (const [path, html] of Object.entries(pages)) {
  mkdirSync(join(OUT, path), { recursive: true });
  writeFileSync(join(OUT, path, 'index.html'), html);
  console.log(`[build] ${path}`);
}
for (const f of ['app.js', 'icon.svg', 'manifest.webmanifest', 'og.png']) if (existsSync(join(ROOT, 'site', f))) copyFileSync(join(ROOT, 'site', f), join(OUT, f));
copyFileSync(join(ROOT, 'vendor', 'ronda', 'diagram.js'), join(OUT, 'diagram.js'));
for (const f of ['codigo.js', 'piezas.js']) copyFileSync(join(ROOT, 'vendor', 'trueml', f), join(OUT, f));
const CSS = [join(ROOT, 'vendor', 'trueml', 'tokens.css'), join(ROOT, 'vendor', 'trueml', 'piezas.css'), join(ROOT, 'vendor', 'ronda', 'components.css'), join(ROOT, 'site', 'ia-privada.css')].map(leer).join('\n');
writeFileSync(join(OUT, 'ia-privada.css'), CSS);
const sinMd = (s) => s.replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_, id, t) => t || GLOS.get(id).termino.toLowerCase()).replace(/[*`]/g, '').replace(/\\\(|\\\)/g, '');
writeFileSync(join(OUT, 'indice.json'), JSON.stringify({
  lecciones: LISTAS.map((l) => ({ t: l.titulo, n: l.n, u: l.url, m: l.herramienta ? 'Herramientas' : l.caso ? 'Casos' : l.modulo.titulo })),
  conceptos: REALES().map((g) => ({ t: g.termino, en: g.en || '', u: `/glosario/#g-${g.id}`, c: sinMd(g.corto) })),
}));

const urls = Object.keys(pages);
const core = [...urls, '/ia-privada.css', '/app.js', '/codigo.js', '/piezas.js', '/diagram.js', '/indice.json', '/icon.svg', '/manifest.webmanifest'];
const hash = createHash('sha256');
for (const p of urls.sort()) hash.update(p).update(pages[p]);
hash.update(CSS).update(leer(join(ROOT, 'site', 'app.js'))).update(leer(join(ROOT, 'vendor', 'ronda', 'diagram.js'))).update(leer(join(ROOT, 'vendor', 'trueml', 'piezas.js'))).update(leer(join(ROOT, 'vendor', 'trueml', 'codigo.js')));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), leer(join(ROOT, 'site', 'sw.js')).replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITIO.url}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((p) => `  <url><loc>${SITIO.url}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] glosario: ${REALES().length} conceptos · ${PRESENTA.size} presentados`);
if (adelantos.length) console.log(`[build] adelantos (palabras usadas antes de presentarse):\n  ${adelantos.join('\n  ')}`);
if (SOLO) { const l = POR_ID.get(SOLO); console.log(`[build] --solo ${SOLO}: ${l.palabras} palabras · ${l.min.esencial} min lo esencial, ${l.min.todo} min todo · ${JSON.stringify(l.cuenta)} · en ${OUT}`); }
console.log(`[build] listo: ${urls.length} páginas · ${HERR.filter((h) => h.lista).length} de ${HERR.length} herramientas · ${LECCIONES.length} de ${ORDEN.length} lecciones · BUILD ${BUILD}`);
