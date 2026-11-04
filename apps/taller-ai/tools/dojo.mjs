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
    ${volver ? `<a class="d-dojo" href="${volver}">Dojo</a>` : '<span class="d-dojo">Dojo</span>'}
    ${ruta ? `<span class="d-ruta">${esc(ruta)}</span>` : ''}
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
  const py = e.mundo.python || 'python';   // cómo se llama Python en el kit (con venv: python; sin venv: python3)
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
          <div class="d-esc d-esc-dojo"><span class="d-lbl">En el dojo</span><span>${x.taller.cuenta}</span><strong>${x.taller.valor}</strong></div>
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
${hero({ volver: '/', volverTxt: "Dojo de entrenamiento ML engineer's", pill: `${e.caso.toUpperCase()} · Estación ${e.num} de ${total}`, h1: e.titulo, lead: e.pregunta, num: e.num, tituloEstacion: e.titulo,
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
  <div class="d-tabla"><table><thead><tr><th></th><th>En C01</th><th class="d-th-dojo">En el dojo</th></tr></thead><tbody>${e.mapa.escala.map((r) => `<tr><th scope="row">${esc(r.que)}</th><td>${r.c01}</td><td>${r.taller}</td></tr>`).join('')}</tbody></table></div>
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
    ${codigo(e.mundo.arranque || `unzip ${e.slug}.zip && cd ${e.slug}\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d\npython mundo/reiniciar.py --todo`, 'arranque')}
  </div>
  <div class="d-grid2">
    <div class="d-card"><h3>Lo que trae <small>no lo escribes</small></h3><div class="d-lista">${e.mundo.trae.map((t) => `<p><b>${esc(t.que)}.</b> ${t.detalle}</p>`).join('')}</div></div>
    <div class="d-card"><h3>${e.id === 'datos' ? 'Tu pipeline' : 'Lo que escribes'} <small>lo escribes tú</small></h3><ol class="d-linea">${e.mundo.tu_pipeline.map((t) => `<li><code>${esc(t.archivo)}</code><span>${t.hace}</span></li>`).join('')}</ol></div>
  </div>
  <div class="d-card"><h3>Necesitas</h3><ul class="d-ul">${e.mundo.requisitos.map((r) => `<li>${r}</li>`).join('')}</ul></div>
  <div class="d-tabla"><table><thead><tr><th>En la nube</th><th class="d-th-dojo">En el dojo</th><th>Qué cambia</th></tr></thead><tbody>${e.mundo.sustituciones.map((r) => `<tr><th scope="row">${esc(r.nube)}</th><td>${esc(r.local)}</td><td>${r.diferencia}</td></tr>`).join('')}</tbody></table></div>
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
    ${e.solo.objetivos.map((o) => `<div class="d-obj"><span>${String(o.n).padStart(2, '0')}</span><span>${o.objetivo}<code>${py} verificar.py ${esc(o.check)}</code>${o.pista ? `<small><b>Pista:</b> ${o.pista}</small>` : ''}</span></div>`).join('\n    ')}
  </div>
</section>

<section class="d-sec" id="romper">
  ${titulo('Romper', `${e.fallas.length} fallas`)}
  <div class="d-grid2">
    <p class="d-p">Con todo en verde, <code>romper.py</code> mete una falla en el mundo, la configuración o la infraestructura (nunca en lo que escribiste) y, si hace falta, deja corriendo lo que «pasó anoche». Tú empiezas por <code>verificar.py</code>.</p>
    ${codigo([['--mostrar', 'con ayuda: Claude sabe cuál es'], ['', 'solo: escondida, ni Claude la sabe'], ['--verificar', '¿ya quedó?'], ['--revelar', 'me rindo'], ['--restaurar', 'deshacer']]
      .map(([a, c]) => `${`${py} romper.py ${a}`.padEnd(py.length + 23)}# ${c}`).join('\n'), 'romper.py')}
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

// ---------------------------------------------------------------- portada
// Colores de las 6 etapas de la T (los de trueml-mark.js) y de las 4 velocidades del mapa (los del diseño).
const COLOR_ETAPA = ['#E8AE36', '#EC6A3F', '#17B386', '#3D5AFE', '#7A69EE', '#5A6699'];
const NOMBRE_ETAPA = ['Datos', 'Modelo', 'API', 'Contenedor', 'Orquestación', 'Monitoreo'];
const VEL = { sem: '#EC6A3F', dia: '#3D5AFE', ms: '#17B386', cont: '#6B78B3' };
const rango = (i) => { const [a, b] = ETAPAS[i]; const n = Array.from({ length: b - a + 1 }, (_, k) => a + k); return `${n.length > 1 ? 'estaciones' : 'estación'} ${n.join(' · ')}`; };

// El mapa del C01 en anillo (del diseño): 5 estaciones arriba, 7 abajo, y el reentrenamiento que vuelve a 1.
// Las que ya tienen dojo abren su página; las demás, su sección en la cheat sheet.
function anillo(estaciones, enlace, lista) {
  const H = 640, xL = 170, xR = 990, yT = 214, yB = 454, R = (yB - yT) / 2, yM = (yT + yB) / 2;
  const top = [0, 1, 2, 3, 4].map((i) => xL + i * (xR - xL) / 4);
  const bot = [0, 1, 2, 3, 4, 5, 6].map((i) => xR - i * (xR - xL) / 6);
  const P = top.map((x) => [x, yT]).concat(bot.map((x) => [x, yB]));
  const f = (n) => Math.round(n * 10) / 10;
  const wrap = (t, n) => { const out = []; let cur = ''; t.split(' ').forEach((w) => { if (cur && (cur + ' ' + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }); if (cur) out.push(cur); return out; };
  const SANS = 'system-ui,-apple-system,Segoe UI,sans-serif', MONO = 'ui-monospace,Menlo,monospace';
  const INK = 'class="r-ink"', INK3 = 'class="r-ink3"';
  let o = '';
  const band = (x0, x1, y, label, below) => `<path d="M${f(x0)} ${y}H${f(x1)}M${f(x0)} ${y - 5}V${y + 5}M${f(x1)} ${y - 5}V${y + 5}" fill="none" stroke-width="1.5" opacity=".5" class="r-band"/><text x="${f(x0)}" y="${below ? y + 20 : y - 10}" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="1.4" ${INK3}>${label}</text>`;
  o += band(top[0] - 60, top[1] + 60, 64, 'DATOS') + band(top[2] - 60, top[4] + 60, 64, 'MODELO');
  o += band(bot[4] - 55, bot[0] + 60, H - 46, 'RELEASE', 1) + band(bot[6] - 60, bot[5] + 50, H - 46, 'OPERACIÓN', 1);
  const dSem = `M${xL} ${yT}H${xR}A${R} ${R} 0 0 1 ${xR} ${yB}`, dDia = `M${xR} ${yB}H${f(bot[5])}`, dMs = `M${f(bot[5])} ${yB}H${xL}`, dRe = `M${xL} ${yB}A${R} ${R} 0 0 1 ${xL} ${yT}`;
  const tr = (d, c, dash) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"${dash ? ' stroke-dasharray="0.1 15"' : ''}/>`;
  const fl = (d) => `<path d="${d}" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 18" opacity=".9" class="r-flow"><animate attributeName="stroke-dashoffset" from="0" to="-18.1" dur="1.2s" repeatCount="indefinite"/></path>`;
  o += tr(dRe, VEL.cont, 1) + tr(dSem, VEL.sem) + tr(dDia, VEL.dia) + tr(dMs, VEL.ms) + fl(dSem) + fl(dDia) + fl(dMs);
  o += `<path d="M${xL - 36} ${yT - 8}L${xL - 21} ${yT}L${xL - 36} ${yT + 8}Z" fill="${VEL.cont}"/>`;
  o += `<text transform="translate(28 ${yM}) rotate(-90)" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="1" fill="${VEL.cont}">reentrenamiento</text>`;
  estaciones.forEach((s, i) => {
    const [x, y] = P[i], isTop = i < 5, listo = lista.has(s.id), k = listo ? 'dojo' : (i === 5 || i === 10 || i === 11) ? 'tb' : 'st';
    const nl = wrap(s.titulo, isTop ? 24 : 17), al = wrap('→ ' + s.sale, isTop ? 28 : 20);
    const pill = listo ? 26 : 0, h = pill + nl.length * 17 + 5 + al.length * 14, w = isTop ? 196 : 132;
    const y0 = isTop ? y - 30 - h : y + 32;
    const ry = isTop ? y0 - 4 : y - 18, rh = isTop ? y + 18 - ry : y0 + h + 4 - ry;
    let g = `<rect x="${f(x - w / 2)}" y="${f(ry)}" width="${w}" height="${f(rh)}" fill="transparent"/>`;
    if (pill) g += `<rect x="${f(x - 56)}" y="${f(y0)}" width="112" height="20" rx="10" fill="#FFC857"/><text x="${f(x)}" y="${f(y0 + 14)}" text-anchor="middle" font-family="${SANS}" font-size="11" font-weight="700" fill="#0E1530">ya tiene dojo →</text>`;
    nl.forEach((t, j) => { g += `<text x="${f(x)}" y="${f(y0 + pill + 13 + j * 17)}" text-anchor="middle" font-family="${SANS}" font-size="${isTop ? 14 : 13}" font-weight="700" ${INK}>${esc(t)}</text>`; });
    al.forEach((t, j) => { g += `<text x="${f(x)}" y="${f(y0 + pill + nl.length * 17 + 16 + j * 14)}" text-anchor="middle" font-family="${MONO}" font-size="10.5" ${INK3}>${esc(t)}</text>`; });
    if (k === 'dojo') {
      g += `<circle cx="${x}" cy="${y}" r="17" fill="none" stroke="#E8AE36" stroke-width="3" class="r-pulso"><animate attributeName="r" values="17;32" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".9;0" dur="1.8s" repeatCount="indefinite"/></circle>`;
      g += `<circle cx="${x}" cy="${y}" r="17" fill="#FFC857" stroke="#0E1530" stroke-width="4"/>`;
    } else if (k === 'tb') g += `<circle cx="${f(x)}" cy="${y}" r="15" stroke-width="4" class="r-tb"/>`;
    else g += `<circle cx="${f(x)}" cy="${y}" r="12" stroke="${i <= 4 ? VEL.sem : VEL.dia}" stroke-width="4" class="r-st"/>`;
    g += `<text x="${f(x)}" y="${f(y + 4)}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" ${k === 'dojo' ? 'fill="#0E1530"' : INK}>${s.num}</text>`;
    o += `<a href="${enlace(s)}" data-st="${i}"><title>${s.num} · ${esc(s.titulo)} · sale: ${esc(s.sale)}</title>${g}</a>`;
  });
  const L1 = [[VEL.sem, 'semanas', 'el modelo'], [VEL.dia, 'días', 'el código'], [VEL.ms, 'milisegundos', 'una request'], [VEL.cont, 'continuo', 'la operación']];
  o += `<text x="580" y="${yT + 62}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" letter-spacing="1.4" ${INK3}>LAS CUATRO VELOCIDADES</text>`;
  L1.forEach(([c, a, b], j) => { const x = 292 + j * 150, y = yT + 100; o += `<path d="M${x} ${y - 4}H${x + 26}" stroke="${c}" stroke-width="7" stroke-linecap="round"/><text x="${x + 38}" y="${y}" font-family="${SANS}" font-size="13" font-weight="700" ${INK}>${a}</text><text x="${x + 38}" y="${y + 16}" font-family="${SANS}" font-size="12" ${INK3}>${b}</text>`; });
  const y2 = yT + 158;
  o += `<circle cx="345" cy="${y2 - 4}" r="8" stroke-width="3.5" class="r-tb"/><text x="363" y="${y2}" font-family="${SANS}" font-size="13" font-weight="700" ${INK}>transbordo</text>`;
  o += `<path d="M502 ${y2 - 4}H534" stroke="${VEL.cont}" stroke-width="7" stroke-linecap="round" stroke-dasharray="0.1 12"/><text x="546" y="${y2}" font-family="${SANS}" font-size="13" font-weight="700" ${INK}>reentrenamiento</text><text x="546" y="${y2 + 16}" font-family="${SANS}" font-size="12" ${INK3}>vuelve a 1 · Datos</text>`;
  o += `<circle cx="712" cy="${y2 - 4}" r="9" fill="#FFC857" stroke="#0E1530" stroke-width="3"/><text x="730" y="${y2}" font-family="${SANS}" font-size="13" font-weight="700" ${INK}>ya tiene dojo</text>`;
  return `<svg class="d-anillo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1160 ${H}" width="100%" role="group" aria-label="Mapa del C01: 12 estaciones en un anillo, de Datos a Monitoreo, y el reentrenamiento que vuelve a Datos">${o}</svg>`;
}

// tronco: content/tronco.json · lista: Map id → estación lista (con url y prácticas) · mapa: content/mapa-c01.json
export function cuerpoPortada({ tronco, lista, mapa, hoja }) {
  const enlace = (s) => (lista.has(s.id) ? lista.get(s.id).url : `${hoja}#est-${s.id}`);
  const primera = tronco.estaciones.find((s) => lista.has(s.id));
  const listas = tronco.estaciones.filter((s) => lista.has(s.id)).length;
  const indice = [['c01', 'Qué es C01'], ['estaciones', 'Estaciones'], ['mapa', 'El mapa'], ['como', 'Cómo se usa']];
  const LB = NOMBRE_ETAPA.map((n, i) => [n, rango(i)]);
  const pips = tronco.estaciones.map((s) => `<span style="background:${COLOR_ETAPA[etapa(s.num)]}${lista.has(s.id) ? '' : ';opacity:.3'}"></span>`).join('');

  const grupos = ETAPAS.map(([a, b], i) => {
    const filas = tronco.estaciones.filter((s) => s.num >= a && s.num <= b).map((s) => {
      const e = lista.get(s.id);
      return `<a class="d-est${e ? ' lista' : ''}" href="${enlace(s)}"><span class="d-est-n">${s.num}</span><span class="d-est-t"><span>${esc(s.titulo)}</span><span>sale: ${esc(s.sale)}</span>${e && e.practicas.length ? `<span class="d-est-x">+ ${e.practicas.length} prácticas desde cero</span>` : ''}</span>${e ? '<span class="d-est-b">Entrar →</span>' : '<span class="d-est-p">próximamente <br>hoja ↗</span>'}</a>`;
    }).join('');
    return `<div class="d-etapa" data-etapa="${TM.ST[i][0]}" style="--c:${COLOR_ETAPA[i]}"><div class="d-etapa-h"><i></i><b>${NOMBRE_ETAPA[i]}</b><span>${rango(i)}</span></div>${filas}</div>`;
  }).join('\n    ');

  // el mapa vertical de la cheat sheet, para el celular: el anillo necesita 780 px
  const mapv = mapa.mapv.replace(/<a class="stn" href="#est-([a-z]+)" aria-label="([^"]*)">/g, (m, id, lab) => lista.has(id)
    ? `<a class="stn lista" href="${lista.get(id).url}" aria-label="${lab}. Abrir su página en el dojo">`
    : `<a class="stn" href="${hoja}#est-${id}" aria-label="${lab}. Su explicación en la cheat sheet">`);

  const paso = (n, t, txt, extra = '') => `<div class="d-card d-uso${extra ? ' d-uso-full' : ''}"><span class="d-uso-n">${n}</span><h3>${t}</h3><p class="d-txt">${txt}</p>${extra}</div>`;
  const ronda = (n, t, d) => `<div class="d-uso-r"><span><i>${n} </i>${t}</span><span>${d}</span></div>`;

  return `${barra({ ruta: '', volver: '', indice })}
<div class="d-wrap d-home">
<section class="d-home-hero">
  <span class="d-kick">TrueML · Entrenamiento práctico</span>
  <h1>Dojo de entrenamiento <span>ML engineer's</span></h1>
  <p class="d-lead">Proyectos chicos que corren en tu Mac, uno por cada estación del camino del dato a producción. Cada uno lo construyes cuatro veces: con ayuda, solo, roto con ayuda y roto solo. Con una explicación rápida de cada concepto en el momento en que lo usas.</p>
  <div class="d-pips"><div>${pips}</div><span>${listas} de ${tronco.estaciones.length} estaciones listas</span></div>
  <div class="d-btns">${primera ? `<a class="d-btn" href="${lista.get(primera.id).url}">Empezar por la estación ${primera.num} →</a>` : ''}<a class="d-btn d-btn2" href="#mapa">Ver el mapa</a></div>
</section>

<div class="d-home-t">
  <div class="d-hero-mark d-t-grande">${TM.mark(true, LB, 'dojo', 'min(calc(100vh - 150px), 820px)')}</div>
  <div class="d-hero-mark d-t-chica">${TM.mark(true, null, '', '420px')}</div>
  <span class="d-t-cap" data-def="Pasa el cursor por una etapa de la lista para verla en la T.">Pasa el cursor por una etapa de la lista para verla en la T.</span>
</div>

<section class="d-sec" id="c01">
  ${titulo('Qué es C01', 'el caso del tronco')}
  <p class="d-p">C01 es el primer caso del curso: un <strong>marketplace de segunda mano</strong> donde quien vende sube fotos al crear una publicación y el sistema le <strong>sugiere la categoría</strong>. Por dentro es un clasificador de imágenes (una ResNet-50 con 500 categorías) servido con Triton en Kubernetes, que responde unas 10 millones de fotos al día y tiene que contestar el 99 % de las veces en menos de 200 ms.</p>
  <div class="d-c01">${[['500', 'categorías'], ['≈ 10 M', 'fotos al día'], ['≤ 200 ms', 'p99'], ['top-5', 'por foto'], ['1 al mes', 'modelo nuevo']].map(([n, t]) => `<div><b>${n}</b><span>${t}</span></div>`).join('')}</div>
  <p class="d-p">Es el tronco del dojo porque recorre las 12 estaciones completas: de las fotos etiquetadas al entrenamiento, del modelo aprobado a la imagen de Docker en el clúster, y de la request en vivo al monitoreo que pide el siguiente modelo. Los otros patrones (batch, LLM y RAG, streaming, edge…) cambian solo algunas estaciones, así que llegan después, como ramas.</p>
  <p class="d-p">En el dojo, cada estación es una versión chica de C01 que corre en tu Mac: los mismos conceptos y las mismas fallas, con otros tamaños. La estación 1, por ejemplo, usa fotos de Fashion-MNIST, 24,000 requests y un S3 local en Docker.</p>
</section>

<section class="d-sec" id="estaciones">
  ${titulo(`Las ${tronco.estaciones.length} estaciones`, `agrupadas en la T · ${listas} ${listas === 1 ? 'lista' : 'listas'}`)}
  <p class="d-p">Doce estaciones, agrupadas en las seis etapas de la T. Entre una estación y la siguiente viaja un artefacto concreto (el snapshot del dataset, el checkpoint, el engine, la imagen de Docker…), y el reentrenamiento cierra el ciclo.</p>
  <div class="d-etapas">
    ${grupos}
  </div>
  <div class="d-reent"><span>↺</span>Reentrenamiento: vuelve a 1 · Datos</div>
</section>
</div>

<section class="d-wrap d-sec d-sec-sola" id="mapa">
  ${titulo('El mapa del C01', '12 estaciones · 4 tramos')}
  <p class="d-p">Doce estaciones en cuatro tramos: Datos, Modelo, Release y Operación. Entre una estación y la siguiente viaja un artefacto concreto (el snapshot del dataset, el checkpoint, el engine, la imagen de Docker…), y el reentrenamiento cierra el ciclo. Los colores son las cuatro velocidades: el modelo cambia en semanas, el código en días, una request dura milisegundos y el monitoreo no para.</p>
  <div class="d-mapa">
    ${anillo(tronco.estaciones, enlace, lista)}
    <svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>${mapa.simbolos}</defs></svg>
    <div class="d-mapv">
      <div class="maplg">${[['semanas', 'semanas', 'el modelo'], ['dias', 'días', 'el código'], ['ms', 'milisegundos', 'una request'], ['continuo', 'continuo', 'la operación']].map(([c, t, d]) => `<span class="lg ln-${c}"><i class="lg-line"></i><b>${t}</b> ${d}</span>`).join('')}<span class="lg"><svg class="lg-x" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" class="g-fr"/><circle cx="14" cy="14" r="6.5" class="g-i"/></svg>ya tiene dojo</span></div>
      ${mapv}
    </div>
  </div>
  <p class="d-nota">Toca una estación: la que ya tiene dojo abre su página; las demás, su explicación en la cheat sheet <a href="${hoja}">«Del dato a producción»</a>, de donde sale este mapa.</p>
</section>

<section class="d-wrap d-sec d-sec-sola" id="como">
  ${titulo('Cómo se usa el dojo', 'de la lectura a romper')}
  <p class="d-p">Cada estación es un mini-proyecto con su kit. Esta app es la guía y no corre nada: el trabajo pasa en tu Mac, en la carpeta del kit, con una sesión de Claude Code abierta ahí.</p>
  <div class="d-usos">
    ${paso('01', 'Lee antes de tocar', 'En la página de la estación: <strong>el mapa</strong> (dónde estás, qué entra y qué sale), <strong>los precálculos</strong> (las cuentas de servilleta, en C01 y en el dojo) y <strong>los conceptos exprés</strong>. Se lee en el celular, en un rato libre.')}
    ${paso('02', 'Baja el kit y levanta el mundo', 'Un .zip con una empresa ficticia que ya tiene el problema: sus datos, sus servicios en Docker, un <code>verificar.py</code> que revisa tu trabajo y un <code>romper.py</code> que mete fallas. Cinco comandos y queda arriba.')}
    ${paso('03', 'Haz las cuatro rondas', 'Copia el prompt de la ronda en la página de la estación y pégalo en Claude Code. El <code>CLAUDE.md</code> del kit pone las reglas de fondo, así que Claude sabe cuánto ayudarte en cada una.',
      `<div class="d-rondas d-rondas-uso"><span></span><span class="d-eje">Construir</span><span class="d-eje">Romper</span><span class="d-eje d-eje-v">Con ayuda</span>${ronda(1, 'Guiado', 'Construyes el proyecto con Claude Code paso a paso. Cada paso explica el concepto que usa.')}${ronda(3, 'Romper con ayuda', 'Un script mete una falla real. La diagnostican juntos: síntoma, hipótesis, prueba, arreglo.')}<span class="d-eje d-eje-v">Solo</span>${ronda(2, 'Solo', 'Lo rehaces desde el esqueleto con los objetivos y el verificador. Claude no te da código.')}${ronda(4, 'Romper solo', 'El script esconde la falla, ni Claude la sabe. Tú la encuentras y la arreglas.')}</div>`)}
    ${paso('04', 'Repasa', 'Al final de cada página: el memo de la estación, su trampa, la lista de «listo cuando…» y cómo te lo pueden preguntar en una entrevista.')}
    ${paso('05', 'Lleva tu registro', 'Claude anota cada ronda en <code>BITACORA.md</code> (qué hiciste, cuánto tardaste, qué pistas usaste) y en <code>taller/progreso.json</code>. Pronto vas a poder subirlo a tu tablero aquí mismo.')}
  </div>
  <div class="d-grid2">
    <div class="d-card"><h3>Qué necesitas</h3><ul class="d-ok-lista"><li>Una Mac con Docker Desktop y unos GB libres</li><li>Python 3.11 o más nuevo</li><li>Claude Code</li></ul><p class="d-nota">Cada estación dice lo suyo en «El kit».</p></div>
    <div class="d-orden"><h3>En qué orden</h3><p>Del 1 al 12, que es el orden en que el dato viaja en C01. Cada kit trae su propio mundo, así que una estación corre aunque no hayas terminado la anterior.</p>${primera ? `<a class="d-btn" href="${lista.get(primera.id).url}">Empezar por la estación ${primera.num}: ${esc(primera.titulo)}</a>` : ''}</div>
  </div>
  <div class="d-card"><h3>Los otros patrones</h3><p class="d-txt">Después del tronco vienen las ramas: batch, LLM y RAG, streaming, edge, asíncrono e híbrido, cada una con su mini-proyecto y solo las estaciones que cambian.</p><div class="d-mini">${['batch', 'LLM y RAG', 'streaming', 'edge', 'asíncrono', 'híbrido'].map((x) => `<span>${x}</span>`).join('')}</div></div>
</section>
${pie}`;
}
