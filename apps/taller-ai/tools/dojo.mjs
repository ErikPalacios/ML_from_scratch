// Las páginas de estación con el diseño «Dojo» de TrueML (Claude Design: «Dojo Estacion 01»).
// La T de vidrio sale de tools/trueml-mark.js, el mismo generador del diseño, y se dibuja aquí, al construir:
// la página no necesita React ni JavaScript para verse, y abre sin conexión.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'tools', 'trueml-mark.js'), 'utf8'), ctx);
const TM = ctx.window.TrueMLMark;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PORTADA = 'https://ml-desde-cero.vercel.app';

// Las 12 estaciones del C01 en las 6 etapas de la T (la agrupación del diseño).
const ETAPAS = [[1, 2], [3, 5], [6, 6], [7, 8], [9, 10], [11, 12]];
const etapa = (num) => ETAPAS.findIndex(([a, b]) => num >= a && num <= b);

const marcaNav = TM.mark(true, null);
function marcaHero(num, titulo) {
  const i = etapa(num), clave = TM.ST[i][0];
  const LB = TM.ST.map((_, j) => (j === i ? ['Estás aquí', `${num} · ${titulo}`] : null));
  // como TrueMLMark.sync(el, [etapa], .16): la etapa de la estación encendida y las demás apagadas
  return TM.mark(true, LB, 'aqui' + i, '460px')
    .replace(/<g data-stage="([a-z]+)" data-dim="\.1">/g, (m, s) => (s === clave ? m : `<g data-stage="${s}" data-dim=".1" style="opacity:.16">`));
}

// ---------------------------------------------------------------- piezas
let uid = 0;
const TEMA = `<div class="tema d-tema" role="group" aria-label="Tema">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Auto']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false">${l}</button>`).join('')}</div>`;

function barra({ ruta, volver, indice }) {
  return `<div class="d-top">
<div class="d-stripe" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
<header class="d-head">
  <div class="d-brand">
    <a class="d-logo" href="${PORTADA}"><span class="d-logo-mark">${marcaNav}</span><span class="d-word">True<span>ML</span></span></a>
    <span class="d-sep" aria-hidden="true"></span>
    <a class="d-dojo" href="${volver}">Dojo</a>
    <span class="d-ruta">${esc(ruta)}</span>
  </div>
  ${TEMA}
</header>
<nav class="d-nav" aria-label="En esta página">${indice.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>
</div>`;
}

const titulo = (h, tag) => `<div class="d-h2"><h2>${esc(h)}</h2>${tag ? `<span class="d-tag">${esc(tag)}</span>` : ''}</div>`;

function codigo(code, lbl) {
  const id = `c${++uid}`;
  return `<div class="d-code"><div class="d-code-h"><span>${esc(lbl)}</span><button type="button" class="d-copy" data-copiar="${id}">Copiar</button></div><pre id="${id}"><code>${esc(code)}</code></pre></div>`;
}

function salida(s, lbl = 'Salida real') {
  if (s === null || s === undefined) return `<p class="d-nota">La salida depende de tu corrida.</p>`;
  if (s === '') return `<p class="d-nota">No imprime nada.</p>`;
  return `<div class="d-salida"><div class="d-salida-h">${esc(lbl)}</div><pre><code>${esc(s)}</code></pre></div>`;
}

const comando = (c, lbl = 'terminal') => codigo(c.code, c.donde && c.donde !== 'mac' ? c.donde : lbl) + (c.nota ? `<p class="d-nota">${c.nota}</p>` : '') + salida(c.salida);

function prompt(texto, { boton = 'Copiar el prompt', ver = 'Ver el prompt' } = {}) {
  const id = `p${++uid}`;
  return `<details class="d-prompt"><summary><span>${esc(ver)} <i aria-hidden="true">↓</i></span><button type="button" class="d-copy-y" data-copiar="${id}">${esc(boton)}</button></summary><pre id="${id}">${esc(texto)}</pre></details>`;
}

const chips = (ids, idx) => (ids.length ? `<div class="d-chips">${ids.map((i) => `<a href="${idx.get(i).url}">${esc(idx.get(i).termino)}</a>`).join('')}</div>` : '');

const listo = (verifica, ojo) => `<div class="d-listo"><div class="d-ok"><b>Listo cuando: </b>${verifica}</div>${ojo ? `<div class="d-ojo"><b>Ojo: </b>${ojo}</div>` : ''}</div>`;

const concepto = (c) => `<details class="d-k" id="k-${c.id}"><summary>
      <span class="d-k-t">${esc(c.termino)}</span><span class="d-k-en">${esc(c.en)}</span><span class="d-k-def">${c.def}</span><span class="d-mas">Analogía, por qué importa y la trampa <i aria-hidden="true">↓</i></span>
    </summary><div class="d-k-body"><p><b>Analogía</b>${c.analogia}</p><p><b>Por qué importa</b>${c.importa}</p><p class="d-trampa"><b>Trampa</b>${c.trampa}</p></div></details>`;

function paso(p, idx, abierto) {
  return `<details class="d-paso" id="paso-${p.id}"${abierto ? ' open' : ''}><summary>
      <span class="d-circ">${p.n}</span><span class="d-paso-t"><span>${esc(p.titulo)}</span><span>${p.objetivo}</span></span><span class="d-pm" aria-hidden="true"></span>
    </summary><div class="d-paso-body">
      ${chips(p.conceptos, idx)}
      <p class="d-txt">${p.explica}</p>
      ${p.codigo.map((c) => codigo(c.code, c.path || c.lang) + (c.nota ? `<p class="d-nota">${c.nota}</p>` : '')).join('\n      ')}
      ${p.comandos.map((c) => comando(c)).join('\n      ')}
      ${listo(p.verifica, p.ojo)}
    </div></details>`;
}

function stats(items) {
  return `<div class="d-stats" style="--n:${items.length}">${items.map(([n, t, href]) => `<a href="#${href}"><b>${n}</b><span>${esc(t)}</span></a>`).join('')}</div>`;
}

function hero({ volver, volverTxt, pill, h1, lead, tiles, botones, num, tituloEstacion }) {
  return `<section class="d-wrap d-hero">
  <div class="d-hero-txt">
    <a class="d-back" href="${volver}">← ${esc(volverTxt)}</a>
    <span class="d-pill">${esc(pill)}</span>
    <h1>${esc(h1)}</h1>
    <p class="d-lead">${esc(lead)}</p>
    ${stats(tiles)}
    <div class="d-btns">${botones}</div>
  </div>
  <div class="d-hero-mark">${marcaHero(num, tituloEstacion)}</div>
</section>`;
}

const pie = `<footer class="d-wrap d-foot">
  <p>© ${new Date().getFullYear()} Erik Palacios · Contenido bajo <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es">CC BY-NC-ND 4.0</a> · <a href="${PORTADA}">TrueML</a> · <a href="https://github.com/ErikPalacios/ML_from_scratch/issues/new">Reportar un error</a></p>
  <p>La app es la guía: no corre nada. El trabajo pasa en tu Mac, con el kit y una sesión de Claude Code. Después de la primera visita abre sin conexión.</p>
</footer>
<div class="d-toast" aria-live="polite" role="status"></div>`;

// Índice de conceptos: los de la estación viven en su página; los de cada práctica, en la suya.
function indiceConceptos(e, aqui) {
  return new Map([...e.conceptos.map((c) => [c.id, { termino: c.termino, url: `${aqui === e.url ? '' : e.url}#k-${c.id}` }]),
    ...e.practicas.flatMap((q) => q.conceptos.map((c) => [c.id, { termino: c.termino, url: `${aqui === q.url ? '' : q.url}#k-${c.id}` }]))]);
}

const TIPO = { mundo: 'd-t-mundo', config: 'd-t-config', infra: 'd-t-infra', entorno: 'd-t-entorno' };

// ---------------------------------------------------------------- estación
export function cuerpoEstacion(e, { total, kitBytes, kb }) {
  const idx = indiceConceptos(e, e.url);
  const indice = [['mapa', 'Mapa'], ['rondas', 'Rondas'], ...(e.practicas.length ? [['desde-cero', 'Desde cero']] : []), ['conceptos', 'Conceptos'], ['precalculos', 'Precálculos'], ['kit', 'Kit'], ['guiado', 'Guiado'], ['solo', 'Solo'], ['romper', 'Romper'], ['repaso', 'Repaso']];
  const kitBtn = `<a class="d-btn" href="/kits/${e.slug}.zip" download>Bajar el kit .zip · ${kb(kitBytes)}</a>`;

  const ronda = (n, t, d, p) => `<div class="d-card d-ronda"><span class="d-ronda-t"><i>${n} · </i>${esc(t)}</span><span class="d-txt">${esc(d)}</span>${prompt(p)}</div>`;

  const precalc = e.precalculos.cuentas.map((x, i) => `<article class="d-card d-pc" id="pc-${x.id}">
      <div class="d-pc-h"><span class="d-num">${i + 1}</span><h3>${esc(x.pregunta)}</h3></div>
      <code class="d-formula">${esc(x.formula)}</code>
      ${chips(x.conceptos, idx)}
      <details class="d-ver"><summary>Ver la cuenta</summary><div class="d-ver-body">
        <div class="d-escalas">
          <div class="d-esc"><span class="d-lbl">En C01</span><span>${x.c01.cuenta}</span><strong>${x.c01.valor}</strong></div>
          <div class="d-esc d-esc-dojo"><span class="d-lbl">En el taller</span><span>${x.taller.cuenta}</span><strong>${x.taller.valor}</strong></div>
        </div>
        <p class="d-decide"><b>Qué decides con esto. </b>${x.decide}</p>
        ${x.comprueba ? comando(x.comprueba, 'terminal · compruébalo en el kit') : ''}
        ${x.confirma ? `<p class="d-nota"><b>Lo confirmas en</b> ${x.confirma}</p>` : ''}
      </div></details>
    </article>`).join('\n    ');

  const desdeCero = e.practicas.length ? `<section class="d-sec" id="desde-cero">
  ${titulo('Desde cero', `${e.practicas.length} prácticas`)}
  <p class="d-p">Sin kit ni mundo armado: una carpeta vacía y un dataset tan chico que se etiqueta a mano en minutos, para hacer el proceso completo con tus propias manos. La primera arma el dataset antes de que exista el modelo; la segunda, el ciclo de cada mes con el modelo ya en producción. Hazlas en orden: la segunda sigue en la misma carpeta.</p>
  <div class="d-grid2">
    ${e.practicas.map((p) => `<a class="d-card d-practica" href="${p.url}">
      <span class="d-lbl">Práctica ${p.orden} de ${e.practicas.length}</span>
      <h3>${esc(p.titulo)}</h3>
      <span class="d-txt">${esc(p.subtitulo)}</span>
      <span class="d-mini">${p.chips.map((c) => `<span>${esc(c)}</span>`).join('')}</span>
      <span class="d-ir">Abrir la práctica →</span>
    </a>`).join('\n    ')}
  </div>
</section>` : '';

  const fallas = e.fallas.map((f) => `<div class="d-card d-falla" id="falla-${f.id}">
        <span class="d-tipo ${TIPO[f.tipo]}">${esc(f.tipo)}</span>
        <h3>${esc(f.titulo)}</h3>
        <p class="d-txt">${f.historia}</p>
        <p class="d-txt"><b>Síntoma. </b>${f.sintoma}</p>
        <details class="d-arreglo"><summary>Hipótesis, cómo confirmar y el arreglo <i aria-hidden="true">↓</i></summary><div>
          <p class="d-txt"><b>Hipótesis para descartar</b></p><ul>${f.hipotesis.map((h) => `<li>${h}</li>`).join('')}</ul>
          ${comando(f.confirma, 'cómo confirmar')}
          <p class="d-txt"><b>El arreglo. </b>${f.arreglo}</p>
        </div></details>
        <span class="d-meta">Concepto: <a href="#k-${f.concepto}">${esc(idx.get(f.concepto).termino)}</a> · check: ${esc(f.check)}</span>
      </div>`).join('\n      ');

  const memo = e.repaso.memo.match(/^<b>(.*?)<\/b>\s*([\s\S]*)$/);

  return `${barra({ ruta: `/ ${e.caso.toUpperCase()} · ${e.num}`, volver: '/', indice })}
${hero({ volver: '/', volverTxt: 'Taller de AI Engineer', pill: `${e.caso.toUpperCase()} · Estación ${e.num} de ${total}`, h1: e.titulo, lead: e.pregunta, num: e.num, tituloEstacion: e.titulo,
    tiles: [[e.precalculos.cuentas.length, 'precálculos', 'precalculos'], [e.conceptos.length, 'conceptos', 'conceptos'], [e.guiado.length, 'pasos', 'guiado'], [e.solo.objetivos.length, 'checks', 'solo'], [e.fallas.length, 'fallas', 'romper'], ...(e.practicas.length ? [[e.practicas.length, 'desde cero', 'desde-cero']] : [])],
    botones: `${kitBtn}<a class="d-btn d-btn2" href="#guiado">Ir al guiado</a>` })}
<main class="d-wrap d-main">
<section class="d-sec" id="mapa">
  ${titulo('Dónde estás', 'el mapa')}
  <p class="d-p">${e.mapa.resumen}</p>
  <div class="d-io">
    <div class="d-card"><span class="d-lbl">Entra</span><ul>${e.mapa.entra.map((x) => `<li>${x}</li>`).join('')}</ul></div>
    <div class="d-io-n" aria-hidden="true"><span>→</span><b>${e.num}</b><span>→</span></div>
    <div class="d-card"><span class="d-lbl">Sale</span><ul>${e.mapa.sale.map((x) => `<li>${x}</li>`).join('')}</ul></div>
  </div>
  <div class="d-tabla"><table><thead><tr><th></th><th>En C01</th><th class="d-th-dojo">En el taller</th></tr></thead><tbody>${e.mapa.escala.map((r) => `<tr><th scope="row">${esc(r.que)}</th><td>${r.c01}</td><td>${r.taller}</td></tr>`).join('')}</tbody></table></div>
  ${e.mapa.hoja ? `<p class="d-nota">La estación completa, con su lugar en el mapa: <a href="${esc(e.mapa.hoja)}">cheat sheet «Del dato a producción»</a>.</p>` : ''}
</section>

<section class="d-sec" id="rondas">
  ${titulo('Las cuatro rondas', 'los prompts')}
  <p class="d-p">Cada ronda se trabaja en una sesión de Claude Code abierta en la carpeta del kit. Copia el prompt de la ronda y pégalo; el <code>CLAUDE.md</code> del kit pone las reglas de fondo.</p>
  <div class="d-rondas">
    <span></span><span class="d-eje">Construir</span><span class="d-eje">Romper</span>
    <span class="d-eje d-eje-v">Con ayuda</span>
    ${ronda(1, 'Guiado', `Construyen juntos los pasos 0 a ${e.guiado.length - 1}.`, e.prompt.guiado)}
    ${ronda(3, 'Romper con ayuda', 'Una falla real; Claude te guía con preguntas.', e.prompt.romper_ayuda)}
    <span class="d-eje d-eje-v">Solo</span>
    ${ronda(2, 'Solo', 'Rehaces todo desde el esqueleto, solo con los objetivos.', e.prompt.solo)}
    ${ronda(4, 'Romper solo', 'Una falla escondida; nadie te da pistas.', e.prompt.romper_solo)}
  </div>
</section>

${desdeCero}

<section class="d-sec" id="conceptos">
  ${titulo('Conceptos exprés', String(e.conceptos.length))}
  <p class="d-p">Una línea para entenderlo; abre la tarjeta para la analogía, por qué importa y la trampa.</p>
  <div class="d-kgrid">
    ${e.conceptos.map(concepto).join('\n    ')}
  </div>
</section>

<section class="d-sec" id="precalculos">
  ${titulo('Precálculos', `${e.precalculos.cuentas.length} cuentas`)}
  <p class="d-p">${e.precalculos.intro}</p>
  ${precalc}
</section>

<section class="d-sec" id="kit">
  ${titulo('El kit', 'el mundo')}
  <div class="d-grid2">
    <div class="d-kit-txt"><p class="d-p">${e.mundo.resumen}</p>${kitBtn}</div>
    ${codigo(`unzip ${e.slug}.zip && cd ${e.slug}\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d\npython mundo/reiniciar.py --todo`, 'arranque')}
  </div>
  <div class="d-grid2">
    <div class="d-card"><h3>Lo que trae <small>no lo escribes</small></h3><div class="d-lista">${e.mundo.trae.map((t) => `<p><b>${esc(t.que)}.</b> ${t.detalle}</p>`).join('')}</div></div>
    <div class="d-card"><h3>Tu pipeline <small>lo escribes tú</small></h3><ol class="d-linea">${e.mundo.tu_pipeline.map((t) => `<li><code>${esc(t.archivo)}</code><span>${t.hace}</span></li>`).join('')}</ol></div>
  </div>
  <div class="d-card"><h3>Necesitas</h3><ul class="d-ul">${e.mundo.requisitos.map((r) => `<li>${r}</li>`).join('')}</ul></div>
  <div class="d-tabla"><table><thead><tr><th>En la nube</th><th class="d-th-dojo">En el taller</th><th>Qué cambia</th></tr></thead><tbody>${e.mundo.sustituciones.map((r) => `<tr><th scope="row">${esc(r.nube)}</th><td>${esc(r.local)}</td><td>${r.diferencia}</td></tr>`).join('')}</tbody></table></div>
  <div class="d-card d-ronda"><span class="d-ronda-t">El CLAUDE.md del kit</span><span class="d-txt">Las reglas de fondo para Claude Code en la carpeta del kit. Ya viene en el .zip.</span>${prompt(e.prompt.claude_md, { boton: 'Copiar', ver: 'Ver el CLAUDE.md' })}</div>
</section>

<section class="d-sec" id="guiado">
  ${titulo('Guiado', 'paso a paso')}
  <p class="d-p">El código que ves es el de la solución de referencia, y cada salida es la que salió al correr el kit en una carpeta limpia.</p>
  <div class="d-pasos">
    ${e.guiado.map((p, i) => paso(p, idx, i === 1)).join('\n    ')}
  </div>
</section>

<section class="d-sec" id="solo">
  ${titulo('Solo', `${e.solo.objetivos.length} objetivos`)}
  <div class="d-reglas">${e.solo.reglas.map((r) => `<p>${r}</p>`).join('')}</div>
  <div class="d-objs">
    ${e.solo.objetivos.map((o) => `<div class="d-obj"><span>${String(o.n).padStart(2, '0')}</span><span>${o.objetivo}<code>verificar.py ${esc(o.check)}</code>${o.pista ? `<small><b>Pista:</b> ${o.pista}</small>` : ''}</span></div>`).join('\n    ')}
  </div>
</section>

<section class="d-sec" id="romper">
  ${titulo('Romper', `${e.fallas.length} fallas`)}
  <div class="d-grid2">
    <p class="d-p">Con tu pipeline en verde, <code>python romper.py</code> mete una falla en el mundo, la configuración o la infraestructura (nunca en tu código) y, si hace falta, corre el job del mes como si hubiera corrido anoche. Tú empiezas por <code>python verificar.py</code>.</p>
    ${codigo('python romper.py --mostrar      # con ayuda: Claude sabe cuál es\npython romper.py                # solo: escondida, ni Claude la sabe\npython romper.py --verificar    # ¿ya quedó?\npython romper.py --revelar      # me rindo\npython romper.py --restaurar    # deshacer', 'romper.py')}
  </div>
  <details class="d-catalogo"><summary><span><span class="d-cat-t">Catálogo de fallas <em>(spoilers)</em></span><span class="d-txt">El catálogo de abajo trae las respuestas. Ábrelo después de romper, para repasar.</span></span><span class="d-cat-b">Abrir el catálogo</span></summary>
    <div class="d-fallas">
      ${fallas}
    </div>
  </details>
</section>

<section class="d-sec" id="repaso">
  ${titulo('Repaso', 'para el celular')}
  <div class="d-grid2">
    <div class="d-memo">
      <div class="d-stripe" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      ${memo ? `<span class="d-memo-t">${memo[1]}</span><span class="d-memo-p">${memo[2]}</span>` : `<span class="d-memo-p">${e.repaso.memo}</span>`}
      <span class="d-memo-trampa"><b>Trampa: </b>${e.repaso.trampa}</span>
      <span class="d-lbl">Listo cuando</span>
      <ul class="d-checks">${e.listo.map((l) => `<li>${l}</li>`).join('')}</ul>
    </div>
    <div class="d-qas">
      <h3>Así te lo pueden preguntar en una entrevista</h3>
      ${e.repaso.entrevista.map((x) => `<details class="d-qa"><summary>${esc(x.q)}</summary><p>${x.a}</p></details>`).join('\n      ')}
    </div>
  </div>
  <p class="d-nota">Versión del contenido: ${esc(e.versionTxt)}.</p>
</section>
</main>
${pie}`;
}

// ---------------------------------------------------------------- práctica desde cero
export function cuerpoPractica(e, p) {
  const idx = indiceConceptos(e, p.url);
  const otra = e.practicas.filter((q) => q.id !== p.id);
  const indice = [['escena', 'La escena'], ['precalculos', 'Precálculos'], ...(p.conceptos.length ? [['conceptos', 'Conceptos']] : []), ['pasos', 'Pasos'], ['solo', 'Hazlo solo']];

  const precalc = p.precalculos.map((x, i) => `<article class="d-card d-pc" id="pc-${x.id}">
      <div class="d-pc-h"><span class="d-num">${i + 1}</span><h3>${esc(x.pregunta)}</h3></div>
      ${chips(x.conceptos, idx)}
      <details class="d-ver"><summary>Ver la cuenta</summary><div class="d-ver-body">
        <div class="d-escalas">
          <div class="d-esc d-esc-dojo"><span class="d-lbl">En tu carpeta</span><span>${x.cuenta}</span><strong>${x.valor}</strong></div>
          ${x.c01 ? `<div class="d-esc"><span class="d-lbl">En C01</span><span>${x.c01}</span></div>` : ''}
        </div>
        <p class="d-decide"><b>Qué decides con esto. </b>${x.decide}</p>
        ${x.comprueba ? comando(x.comprueba, 'terminal · compruébalo') : ''}
        ${x.confirma ? `<p class="d-nota"><b>Lo confirmas en</b> ${x.confirma}</p>` : ''}
      </div></details>
    </article>`).join('\n    ');

  return `${barra({ ruta: `/ ${e.caso.toUpperCase()} · ${e.num} · desde cero`, volver: '/', indice })}
${hero({ volver: e.url + '#desde-cero', volverTxt: e.titulo, pill: `${e.caso.toUpperCase()} · Estación ${e.num} · Desde cero ${p.orden} de ${e.practicas.length}`, h1: p.titulo, lead: p.subtitulo, num: e.num, tituloEstacion: e.titulo,
    tiles: [[p.precalculos.length, 'precálculos', 'precalculos'], ...(p.conceptos.length ? [[p.conceptos.length, 'conceptos', 'conceptos']] : []), [p.pasos.length, 'pasos', 'pasos'], [p.solo.length - 1, 'objetivos', 'solo']],
    botones: `<a class="d-btn" href="#pasos">Ir a los pasos</a><a class="d-btn d-btn2" href="#escena">Ver la escena</a>` })}
<main class="d-wrap d-main">
<section class="d-sec" id="escena">
  ${titulo('La escena', p.chips.join(' · '))}
  <p class="d-p">${p.escena}</p>
  <div class="d-ojo d-cuando"><b>Cuándo pasa esto: </b>${p.cuando}</div>
  <div class="d-grid2">
    <div class="d-card"><h3>Necesitas</h3><ul class="d-ul">${p.requisitos.map((r) => `<li>${r}</li>`).join('')}</ul></div>
    <div class="d-card"><h3>Terminas con</h3><ul class="d-ul">${p.resultado.map((r) => `<li>${r}</li>`).join('')}</ul></div>
  </div>
  <div class="d-card d-ronda"><span class="d-ronda-t"><i>Guiado · </i>Cómo se trabaja</span><span class="d-txt">Abre una sesión de Claude Code en la carpeta de la práctica y pega este prompt. Tú escribes el código; Claude explica, revisa y te hace las preguntas. Esta página es tu referencia: el código es el de la solución probada y cada salida es la que salió de verdad.</span>${prompt(p.prompt.guiado)}</div>
</section>

<section class="d-sec" id="precalculos">
  ${titulo('Precálculos', `${p.precalculos.length} cuentas`)}
  <p class="d-p">Haz cada cuenta antes de abrirla. Con un dataset tan chico los números son de juguete, pero las preguntas son las mismas que en C01.</p>
  ${precalc}
</section>
${p.conceptos.length ? `
<section class="d-sec" id="conceptos">
  ${titulo('Conceptos exprés', `${p.conceptos.length} nuevos`)}
  <p class="d-p">Los que aparecen aquí por primera vez. Los demás chips llevan a los conceptos de la estación.</p>
  <div class="d-kgrid">
    ${p.conceptos.map(concepto).join('\n    ')}
  </div>
</section>
` : ''}
<section class="d-sec" id="pasos">
  ${titulo('Pasos', `${p.pasos.length} pasos`)}
  <div class="d-pasos">
    ${p.pasos.map((x, i) => paso(x, idx, i === 0)).join('\n    ')}
  </div>
</section>

<section class="d-sec" id="solo">
  ${titulo('Hazlo solo', `${p.solo.length - 1} objetivos`)}
  <div class="d-reglas"><p>${p.solo[0]}</p><p>Claude no te da código: te contesta con preguntas, y solo da una pista si dices «me rindo».</p></div>
  <div class="d-objs">
    ${p.solo.slice(1).map((o, i) => `<div class="d-obj"><span>${String(i + 1).padStart(2, '0')}</span><span>${o}</span></div>`).join('\n    ')}
  </div>
  <div class="d-card d-ronda"><span class="d-ronda-t"><i>Solo · </i>El prompt</span>${prompt(p.prompt.solo)}</div>
  <div class="d-btns">${otra.map((q) => `<a class="d-btn${q.orden > p.orden ? '' : ' d-btn2'}" href="${q.url}">${q.orden > p.orden ? 'Sigue' : 'Antes'}: ${esc(q.titulo)}</a>`).join('')}<a class="d-btn d-btn2" href="${e.url}#desde-cero">Volver a la estación</a></div>
</section>
</main>
${pie}`;
}
