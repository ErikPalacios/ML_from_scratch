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
import { estacion as molde, cruzadas } from './schema.mjs';
import { zip } from './zip.mjs';

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
const ESTACIONES = readdirSync(join(ROOT, 'content', 'estaciones')).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const e = JSON.parse(readFileSync(join(ROOT, 'content', 'estaciones', f), 'utf8'));
  const errs = molde(e, f);
  if (!errs.length) errs.push(...cruzadas(e));
  if (errs.length) fail(`${f} no cumple el molde (corre node tools/validate.mjs):\n  ${errs.join('\n  ')}`);
  e.prompt = Object.fromEntries(Object.entries(e.prompts).map(([k, p]) => [k, readFileSync(join(ROOT, p), 'utf8').trim()]));
  e.slug = `${e.caso}-${e.id}`;
  e.url = `/${e.caso}/${e.id}/`;
  return e;
});

// ---------------------------------------------------------------- piezas de HTML
let uid = 0;
const ICON = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/></svg>',
};
const TEMA = `<div class="tema" role="group" aria-label="Tema">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Auto']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false" title="${l}">${ICON[t]}<span>${l}</span></button>`).join('')}</div>`;

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
<meta name="theme-color" content="#F4F6F9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0E131A" media="(prefers-color-scheme: dark)">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<link rel="stylesheet" href="/style.css">
</head>
<body>
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
`;
}

function bloqueCodigo(code, { lbl = '', lang = '' } = {}) {
  const id = `c${++uid}`;
  return `<div class="code"><div class="lbl"><span>${esc(lbl || lang)}</span><button type="button" class="copiar" data-copiar="${id}">Copiar</button></div><pre id="${id}"><code>${esc(code)}</code></pre></div>`;
}

function comando(c) {
  const salida = c.salida === null || c.salida === undefined
    ? `<p class="sin-salida">La salida depende de tu corrida.</p>`
    : `<details class="salida"><summary>Salida real</summary><pre><code>${esc(c.salida)}</code></pre></details>`;
  return bloqueCodigo(c.code, { lbl: c.donde === 'mac' || !c.donde ? 'terminal' : c.donde })
    + (c.nota ? `<p class="cmd-nota">${c.nota}</p>` : '') + salida;
}

function promptBox(titulo, texto, { primario = false } = {}) {
  const id = `p${++uid}`;
  return `<details class="mas prompt"><summary>${esc(titulo)}</summary><div class="code"><div class="lbl"><span>prompt</span><button type="button" class="copiar" data-copiar="${id}">Copiar</button></div><pre id="${id}">${esc(texto)}</pre></div></details>`
    + `<div class="acciones"><button type="button" class="btn${primario ? ' btn--primary' : ''}" data-copiar="${id}">Copiar el prompt</button></div>`;
}

const barra = (volver) => `<nav class="bar" aria-label="Navegación">${volver ? `<a href="/">← Taller de AI Engineer</a>` : '<span></span>'}${TEMA}</nav>`;

// ---------------------------------------------------------------- portada
function portada() {
  const lista = new Map(ESTACIONES.filter((e) => e.caso === TRONCO.caso).map((e) => [e.id, e]));
  const lineas = TRONCO.estaciones.map((s) => lista.has(s.id)
    ? `<li class="lista"><span class="num">${s.num}</span><a href="${lista.get(s.id).url}">${esc(s.titulo)}</a></li>`
    : `<li><span class="num">${s.num}</span><span class="t">${esc(s.titulo)}</span><span class="pronto">próximamente</span></li>`).join('\n      ');
  const body = `${barra(false)}
<header class="hero">
  <p class="kicker">ML desde cero · Entrenamiento práctico</p>
  <h1>Taller de <mark>AI Engineer</mark></h1>
  <p class="lead">Proyectos chicos que corren en tu Mac, uno por cada estación del camino del dato a producción. Cada uno lo construyes cuatro veces: con ayuda, solo, roto con ayuda y roto solo. Con una explicación rápida de cada concepto en el momento en que lo usas.</p>
</header>
<main>
  <ol class="ciclo" aria-label="Las cuatro rondas">
    <li><h3>Guiado</h3><p>Construyes el proyecto con Claude Code paso a paso. Cada paso explica el concepto que usa.</p></li>
    <li><h3>Solo</h3><p>Lo rehaces desde cero con los objetivos y un verificador. Claude no te da código.</p></li>
    <li class="rompe"><h3>Romper con ayuda</h3><p>Un script mete una falla real. La diagnostican juntos: síntoma, hipótesis, prueba, arreglo.</p></li>
    <li class="rompe"><h3>Romper solo</h3><p>El script esconde la falla, ni Claude la sabe. Tú la encuentras y la arreglas.</p></li>
  </ol>
  <section class="linea" aria-labelledby="t-tronco">
    <h2 id="t-tronco">${esc(TRONCO.titulo)}</h2>
    <p>${esc(TRONCO.resumen)}</p>
    <ol class="estaciones">
      ${lineas}
    </ol>
  </section>
  <div class="notas">
    <div class="nota"><h3>Cómo empezar</h3><p>Abre una estación, baja su kit, corre los cuatro comandos de arranque y pega en Claude Code el prompt de la ronda Guiado.</p></div>
    <div class="nota"><h3>Los otros patrones</h3><p>Después del tronco vienen las ramas: batch, LLM y RAG, streaming, edge, asíncrono e híbrido, cada una con su mini-proyecto y solo las estaciones que cambian.</p></div>
    <div class="nota"><h3>Tu progreso</h3><p>Claude anota cada ronda en el BITACORA.md del kit y en un progreso.json. Pronto vas a poder importarlo a tu tablero aquí mismo.</p></div>
  </div>
</main>`;
  return pagina({ path: '/', title: `${SITE_NAME} — construir, rehacer y romper`, desc: 'Proyectos chicos de ML engineering que construyes, rehaces y rompes en tu Mac, estación por estación del camino del dato a producción. En español, gratis.', body });
}

// ---------------------------------------------------------------- estación
function paginaEstacion(e, kitBytes) {
  const nombre = Object.fromEntries(e.conceptos.map((c) => [c.id, c.termino]));
  const chipsC = (ids) => `<div class="cs">${ids.map((i) => `<a href="#k-${i}">${esc(nombre[i])}</a>`).join('')}</div>`;
  const total = TRONCO.estaciones.length;

  const conceptos = e.conceptos.map((c) => `<article class="card concepto" id="k-${c.id}">
      <h3>${esc(c.termino)}</h3><p class="en">${esc(c.en)}</p>
      <p class="def">${c.def}</p>
      <details class="mas"><summary>Analogía, por qué importa y la trampa</summary><div class="kv">
        <div><b>Analogía</b>${c.analogia}</div><div><b>Por qué importa</b>${c.importa}</div><div class="trampa"><b>Trampa</b>${c.trampa}</div>
      </div></details>
    </article>`).join('\n    ');

  const pasos = e.guiado.map((p) => `<li class="card paso" id="paso-${p.id}">
      <h3><span class="n">${p.n}</span>${esc(p.titulo)}</h3>
      <p class="objetivo">${p.objetivo}</p>
      ${chipsC(p.conceptos)}
      <p>${p.explica}</p>
      ${p.codigo.map((c) => bloqueCodigo(c.code, { lbl: c.path || c.lang }) + (c.nota ? `<p class="cmd-nota">${c.nota}</p>` : '')).join('\n      ')}
      ${p.comandos.map(comando).join('\n      ')}
      <div class="verifica"><b>Listo cuando:</b> ${p.verifica}</div>
      ${p.ojo ? `<div class="ojo"><b>Ojo:</b> ${p.ojo}</div>` : ''}
    </li>`).join('\n    ');

  const objetivos = e.solo.objetivos.map((o) => `<li><span class="n">${o.n}</span><div>${o.objetivo} <code>verificar.py ${esc(o.check)}</code>${o.pista ? `<details class="mas"><summary>Pista</summary><p>${o.pista}</p></details>` : ''}</div></li>`).join('\n      ');

  const fallas = e.fallas.map((f) => `<article class="card falla" id="falla-${f.id}">
        <span class="tipo">${esc(f.tipo)}</span>
        <h3>${esc(f.titulo)}</h3>
        <p class="historia">${f.historia}</p>
        <div class="kv"><div><b>Síntoma</b>${f.sintoma}</div><div><b>Hipótesis para descartar</b><ul>${f.hipotesis.map((h) => `<li>${h}</li>`).join('')}</ul></div></div>
        <p><b>Cómo confirmar</b></p>
        ${comando(f.confirma)}
        <details class="mas"><summary>El arreglo</summary><p>${f.arreglo}</p><p>Concepto: <a href="#k-${f.concepto}">${esc(nombre[f.concepto])}</a> · check: <code>${esc(f.check)}</code></p></details>
      </article>`).join('\n      ');

  const escala = e.mapa.escala.map((r) => `<tr><td data-k="">${esc(r.que)}</td><td data-k="En C01">${r.c01}</td><td data-k="En el taller">${r.taller}</td></tr>`).join('');
  const subs = e.mundo.sustituciones.map((r) => `<tr><td data-k="">${esc(r.nube)}</td><td data-k="En el taller">${esc(r.local)}</td><td data-k="Qué cambia">${r.diferencia}</td></tr>`).join('');

  const body = `${barra(true)}
<header class="st-head">
  <p class="kicker">${e.caso.toUpperCase()} · Estación ${e.num} de ${total}</p>
  <h1>${esc(e.titulo)}</h1>
  <p class="pregunta">${esc(e.pregunta)}</p>
  <ul class="chips"><li>${e.conceptos.length} conceptos</li><li>${e.guiado.length} pasos</li><li>${e.solo.objetivos.length} checks</li><li>${e.fallas.length} fallas</li></ul>
</header>
<nav class="indice" aria-label="En esta estación">
  <a href="#mapa">Mapa</a><a href="#rondas">Rondas</a><a href="#conceptos">Conceptos</a><a href="#kit">Kit</a><a href="#guiado">Guiado</a><a href="#solo">Solo</a><a href="#romper">Romper</a><a href="#repaso">Repaso</a>
</nav>
<main>
<section class="blk" id="mapa">
  <h2>Dónde estás <small>el mapa</small></h2>
  <p>${e.mapa.resumen}</p>
  <div class="dos">
    <div class="card"><h3>Entra</h3><ul>${e.mapa.entra.map((x) => `<li>${x}</li>`).join('')}</ul></div>
    <div class="card"><h3>Sale</h3><ul>${e.mapa.sale.map((x) => `<li>${x}</li>`).join('')}</ul></div>
  </div>
  <table class="tabla"><thead><tr><th></th><th>En C01</th><th>En el taller</th></tr></thead><tbody>${escala}</tbody></table>
  ${e.mapa.hoja ? `<p>La estación completa, con su lugar en el mapa: <a href="${esc(e.mapa.hoja)}">cheat sheet «Del dato a producción»</a>.</p>` : ''}
</section>

<section class="blk" id="rondas">
  <h2>Las cuatro rondas <small>los prompts</small></h2>
  <p class="intro">Cada ronda se trabaja en una sesión de Claude Code abierta en la carpeta del kit. Copia el prompt de la ronda y pégalo; el <code>CLAUDE.md</code> del kit pone las reglas de fondo.</p>
  <div class="rondas">
    <div class="card ronda"><h3>1 · Guiado</h3><p>Construyen juntos los pasos 0 a 7.</p>${promptBox('Ver el prompt', e.prompt.guiado, { primario: true })}</div>
    <div class="card ronda"><h3>2 · Solo</h3><p>Rehaces todo desde el esqueleto, solo con los objetivos.</p>${promptBox('Ver el prompt', e.prompt.solo)}</div>
    <div class="card ronda"><h3>3 · Romper con ayuda</h3><p>Una falla real; Claude te guía con preguntas.</p>${promptBox('Ver el prompt', e.prompt.romper_ayuda)}</div>
    <div class="card ronda"><h3>4 · Romper solo</h3><p>Una falla escondida; nadie te da pistas.</p>${promptBox('Ver el prompt', e.prompt.romper_solo)}</div>
  </div>
</section>

<section class="blk" id="conceptos">
  <h2>Conceptos exprés <small>${e.conceptos.length}</small></h2>
  <p class="intro">Una línea para entenderlo; abre la tarjeta para la analogía, por qué importa y la trampa.</p>
  <div class="conceptos">
    ${conceptos}
  </div>
</section>

<section class="blk" id="kit">
  <h2>El kit <small>el mundo</small></h2>
  <p>${e.mundo.resumen}</p>
  <div class="acciones"><a class="btn btn--primary" href="/kits/${e.slug}.zip" download>Bajar el kit <small>.zip · ${kb(kitBytes)}</small></a></div>
  ${bloqueCodigo('unzip ' + e.slug + '.zip && cd ' + e.slug + '\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d\npython mundo/reiniciar.py --todo', { lbl: 'arranque' })}
  <div class="dos">
    <div class="card"><h3>Lo que trae (no lo escribes)</h3><ul>${e.mundo.trae.map((t) => `<li><b>${esc(t.que)}.</b> ${t.detalle}</li>`).join('')}</ul></div>
    <div class="card"><h3>Tu pipeline (lo escribes tú)</h3><ul>${e.mundo.tu_pipeline.map((t) => `<li><code>${esc(t.archivo)}</code> ${t.hace}</li>`).join('')}</ul></div>
  </div>
  <div class="card"><h3>Necesitas</h3><ul>${e.mundo.requisitos.map((r) => `<li>${r}</li>`).join('')}</ul></div>
  <table class="tabla"><thead><tr><th>En la nube</th><th>En el taller</th><th>Qué cambia</th></tr></thead><tbody>${subs}</tbody></table>
  ${promptBox('El CLAUDE.md del kit', e.prompt.claude_md)}
</section>

<section class="blk" id="guiado">
  <h2>Guiado <small>paso a paso</small></h2>
  <p class="intro">El código que ves es el de la solución de referencia, y cada salida es la que salió al correr el kit en una carpeta limpia.</p>
  <ol class="pasos">
    ${pasos}
  </ol>
</section>

<section class="blk" id="solo">
  <h2>Solo <small>${e.solo.objetivos.length} objetivos</small></h2>
  <ul>${e.solo.reglas.map((r) => `<li>${r}</li>`).join('')}</ul>
  <ol class="objetivos">
      ${objetivos}
  </ol>
</section>

<section class="blk" id="romper">
  <h2>Romper <small>${e.fallas.length} fallas</small></h2>
  <p>Con tu pipeline en verde, <code>python romper.py</code> mete una falla en el mundo, la configuración o la infraestructura (nunca en tu código) y, si hace falta, corre el job del mes como si hubiera corrido anoche. Tú empiezas por <code>python verificar.py</code>.</p>
  ${bloqueCodigo('python romper.py --mostrar      # con ayuda: Claude sabe cuál es\npython romper.py                # solo: escondida, ni Claude la sabe\npython romper.py --verificar    # ¿ya quedó?\npython romper.py --revelar      # me rindo\npython romper.py --restaurar    # deshacer', { lbl: 'romper.py' })}
  <div class="aviso">El catálogo de abajo trae las respuestas. Ábrelo después de romper, para repasar.</div>
  <details class="catalogo"><summary>Catálogo de fallas (spoilers)</summary>
    <div class="fallas">
      ${fallas}
    </div>
  </details>
</section>

<section class="blk" id="repaso">
  <h2>Repaso <small>para el celular</small></h2>
  <p class="memo">${e.repaso.memo}</p>
  <div class="ojo"><b>Trampa:</b> ${e.repaso.trampa}</div>
  <h3>Listo cuando</h3>
  <ul class="listo">${e.listo.map((l) => `<li>${l}</li>`).join('')}</ul>
  <h3>Así te lo pueden preguntar en una entrevista</h3>
  ${e.repaso.entrevista.map((x) => `<details class="mas qa"><summary>${esc(x.q)}</summary><p>${x.a}</p></details>`).join('\n  ')}
  <p class="cmd-nota">Versión del contenido: ${fecha(e.version)}.</p>
</section>
</main>`;
  return pagina({ path: e.url, title: `${e.titulo} · ${e.caso.toUpperCase()} — ${SITE_NAME}`, desc: `${e.pregunta} Un mini-proyecto para construir, rehacer y romper en tu Mac.`, body });
}

// ---------------------------------------------------------------- kit
const sinHtml = (s) => s.replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<code>(.*?)<\/code>/g, '`$1`').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function guion(e) {
  const out = [`# Guion · ${e.caso.toUpperCase()} · ${e.titulo}`, '', `Ronda Guiado. ${sinHtml(e.pregunta)}`, ''];
  for (const p of e.guiado) {
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
  pages[e.url] = paginaEstacion(e, z.length);
  mkdirSync(join(OUT, e.caso, e.id), { recursive: true });
  writeFileSync(join(OUT, e.caso, e.id, 'index.html'), pages[e.url]);
  console.log(`[build] ${e.url} · kit ${kb(z.length)}`);
}
pages['/'] = portada();
writeFileSync(join(OUT, 'index.html'), pages['/']);
for (const f of ['style.css', 'app.js', 'icon.svg', 'manifest.webmanifest']) copyFileSync(join(ROOT, 'site', f), join(OUT, f));

const core = ['/', ...ESTACIONES.map((e) => e.url), '/style.css', '/app.js', '/icon.svg', '/manifest.webmanifest'];
const hash = createHash('sha256');
for (const p of Object.keys(pages).sort()) hash.update(p).update(pages[p]);
for (const f of ['style.css', 'app.js']) hash.update(readFileSync(join(ROOT, 'site', f)));
const BUILD = hash.digest('hex').slice(0, 12);
writeFileSync(join(OUT, 'sw.js'), readFileSync(join(ROOT, 'site', 'sw.js'), 'utf8').replace("'__BUILD__';", `'${BUILD}';`).replace('= __PAGES__;', `= ${JSON.stringify(core)};`));
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...ESTACIONES.map((e) => e.url)].map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] listo: ${Object.keys(pages).length} páginas · BUILD ${BUILD}`);
