// Las páginas de estación con el diseño «Dojo» de TrueML (Claude Design: «Dojo Estacion 01»).
// La T de vidrio y las etapas salen del sistema de diseño compartido (apps/trueml, copiado en vendor/trueml con
// node apps/trueml/sync.mjs). Se dibuja al construir: la página no necesita JavaScript para verse y abre sin conexión.
import { TrueMLMark as TM, RANGOS_C01, franja, miniT, IDS, bloqueCodigo } from '../vendor/trueml/lib.mjs';
import { repartir, repartirPractica } from './schema.mjs';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PORTADA = 'https://ml-desde-cero.vercel.app';

// Las 12 estaciones del C01 en las 6 etapas de la T (la agrupación del diseño). Solo para el tronco: una estación
// de rama trae su etapa escrita, y a las páginas llega ya resuelta en e.etapaIdx (tools/lineas.mjs).
const ETAPAS = RANGOS_C01;   // [[1, 2], [3, 5], [6, 6], [7, 8], [9, 10], [11, 12]], de etapas.json
const etapa = (num) => ETAPAS.findIndex(([a, b]) => num >= a && num <= b);

const marcaNav = TM.mark(true, null);
const CLAVES = new Map();
function marcaHero(i, num, titulo) {
  const clave = TM.ST[i][0];
  const LB = TM.ST.map((_, j) => (j === i ? ['Estás aquí', `${num} · ${titulo}`] : null));
  // como TrueMLMark.sync(el, [etapa], .16): la etapa de la estación encendida y las demás apagadas
  // TM.mark guarda cada T por su clave: dos estaciones de la misma etapa (la 1 y la 2 son de Datos) necesitan claves
  // distintas, o la segunda sale con la etiqueta de la primera.
  const k = `${num}·${titulo}`;
  if (!CLAVES.has(k)) CLAVES.set(k, CLAVES.size);
  return TM.mark(true, LB, 'aqui' + i + (CLAVES.get(k) ? 'x' + CLAVES.get(k) : ''), '460px')
    .replace(/<g data-stage="([a-z]+)" data-dim="\.1">/g, (m, s) => (s === clave ? m : `<g data-stage="${s}" data-dim=".1" style="opacity:.16">`));
}

// ---------------------------------------------------------------- piezas
let uid = 0;
const TEMA = `<div class="tema d-tema" role="group" aria-label="Tema">${[['light', 'Claro'], ['dark', 'Oscuro'], ['auto', 'Auto']]
  .map(([t, l]) => `<button type="button" data-tema="${t}" aria-pressed="false">${l}</button>`).join('')}</div>`;

// La marca de TrueML con la palabra Dojo lleva a la portada del Dojo; el botón «Volver a TrueML» lo pone piezas.js.
function barra({ ruta, indice }) {
  return `<div class="d-top">
<div class="d-stripe" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
<header class="d-head">
  <div class="d-brand">
    <a class="d-logo" href="/" aria-label="Portada del Dojo"><span class="d-logo-mark">${marcaNav}</span><span class="d-word">Dojo</span></a>
    ${ruta ? '<span class="d-sep" aria-hidden="true"></span>' : ''}
    ${ruta ? `<span class="d-ruta">${esc(ruta)}</span>` : ''}
  </div>
  ${TEMA}
</header>
${indice.length ? `<nav class="d-nav" aria-label="En esta página">${indice.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>` : ''}
</div>`;
}

const titulo = (h, tag) => `<div class="d-h2"><h2>${esc(h)}</h2>${tag ? `<span class="d-tag">${esc(tag)}</span>` : ''}</div>`;

// El lenguaje de un bloque, a partir de su etiqueta (nombre del archivo, «terminal», «python»…); sin pista queda sin color.
function lenguaDe(lbl, code) {
  const l = String(lbl || '').toLowerCase();
  if (['python', 'json', 'yaml', 'sql', 'bash', 'toml', 'docker', 'js'].includes(l)) return l;
  if (/\.py$/.test(l)) return 'python';
  if (/\.ya?ml$/.test(l)) return 'yaml';
  if (/\.json$/.test(l)) return 'json';
  if (/\.sql$/.test(l)) return 'sql';
  if (/\.toml$/.test(l)) return 'toml';
  if (/(^|\/)dockerfile/.test(l)) return 'docker';
  if (/\.sh$/.test(l) || /^(terminal|arranque|mac)/.test(l)) return 'bash';
  return /^\s*(\$ |docker |pip |python3? |cd |unzip )/m.test(code) ? 'bash' : '';
}

// El bloque de código estándar de TrueML (codigo.js / piezas.css): barra con lenguaje, título y copiar.
function codigo(code, lbl, forzado) {
  const lang = forzado || lenguaDe(lbl, code);
  // «terminal» ya lo dice la barra (Terminal): no se repite como título
  return bloqueCodigo({ codigo: code, lang, titulo: lbl === lang || lbl === 'terminal' ? '' : lbl });
}

function salida(s, lbl = 'Salida real') {
  if (s === null || s === undefined) return `<p class="d-nota">La salida depende de tu corrida.</p>`;
  if (s === '') return `<p class="d-nota">No imprime nada.</p>`;
  return bloqueCodigo({ codigo: s, salida: true, titulo: lbl === 'Salida real' ? '' : lbl });
}

const comando = (c, lbl = 'terminal') => codigo(c.code, c.donde && c.donde !== 'mac' ? c.donde : lbl) + (c.nota ? `<p class="d-nota">${c.nota}</p>` : '') + salida(c.salida);

// El prompt para pegar en Claude Code: el botón del resumen lo copia entero sin abrir el bloque (mismo botón que el código).
const ICO_COPIAR = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2"/><path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5"/></svg>';
function prompt(texto, { boton = 'Copiar el prompt', ver = 'Ver el prompt' } = {}) {
  const id = `p${++uid}`;
  return `<details class="d-prompt"><summary><span>${esc(ver)} <i aria-hidden="true">↓</i></span><button type="button" class="tm-code__copy" data-tm-copiar="pre-${id}" aria-label="${esc(boton)}">${ICO_COPIAR}<span>${esc(boton)}</span></button></summary>${bloqueCodigo({ codigo: texto, lang: '', titulo: 'prompt', id })}</details>`;
}

const chips = (ids, idx) => (ids.length ? `<div class="d-chips">${ids.map((i) => `<a href="${idx.get(i).url}">${esc(idx.get(i).termino)}</a>`).join('')}</div>` : '');

const listo = (verifica, ojo) => `<div class="d-listo"><div class="d-ok"><b>Listo cuando: </b>${verifica}</div>${ojo ? `<div class="d-ojo"><b>Ojo: </b>${ojo}</div>` : ''}</div>`;

// Con id, la del glosario (a donde apuntan las fichas); sin id, la copia dentro de su paso del Guiado.
const concepto = (c, conId = true) => `<details class="d-k"${conId ? ` id="k-${c.id}"` : ''}><summary>
      <span class="d-k-t">${esc(c.termino)}</span><span class="d-k-en">${esc(c.en)}</span><span class="d-k-def">${c.def}</span><span class="d-mas">Analogía, por qué importa y la trampa <i aria-hidden="true">↓</i></span>
    </summary><div class="d-k-body"><p><b>Analogía</b>${c.analogia}</p><p><b>Por qué importa</b>${c.importa}</p><p class="d-trampa"><b>Trampa</b>${c.trampa}</p></div></details>`;

// Un colapsable cerrado dentro de un paso (los conceptos o los precálculos que se usan ahí) o en el arranque.
const sub = (t, body) => `<details class="d-arreglo d-sub"><summary>${esc(t)} <i aria-hidden="true">↓</i></summary><div>${body}</div></details>`;

// extra: las tarjetas que la página mete en el paso (conceptos y precálculos, cerradas) y los comandos del paso 0
// que no son de arranque (van antes de los del paso).
function paso(p, idx, abierto, extra = {}) {
  const { conceptos = [], precalculos = [], cmds0 = [] } = extra;
  return `<details class="d-paso" id="paso-${p.id}"${abierto ? ' open' : ''}><summary>
      <span class="d-circ">${p.n}</span><span class="d-paso-t"><span>${esc(p.titulo)}</span><span>${p.objetivo}</span></span><span class="d-pm" aria-hidden="true"></span>
    </summary><div class="d-paso-body">
      ${chips(p.conceptos, idx)}
      <p class="d-txt">${p.explica}</p>
      ${cmds0.map((c) => comando(c) + '\n      ').join('')}${p.codigo.map((c) => codigo(c.code, c.path || c.lang) + (c.nota ? `<p class="d-nota">${c.nota}</p>` : '')).join('\n      ')}
      ${p.comandos.map((c) => comando(c)).join('\n      ')}
      ${[listo(p.verifica, p.ojo),
    conceptos.length ? sub(conceptos.length === 1 ? 'Concepto de este paso' : 'Conceptos de este paso', `<div class="d-kgrid">${conceptos.map((c) => concepto(c, false)).join('')}</div>`) : '',
    precalculos.length ? sub(precalculos.length === 1 ? 'Precálculo' : 'Precálculos', precalculos.join('\n')) : ''].filter(Boolean).join('\n      ')}
    </div></details>`;
}

function stats(items) {
  return `<div class="d-stats" style="--n:${items.length}">${items.map(([n, t, href]) => `<a href="${href.includes('/') ? href : '#' + href}"><b>${n}</b><span>${esc(t)}</span></a>`).join('')}</div>`;
}

function hero({ volver, volverTxt, pill, h1, lead, tiles, botones, etapaIdx, num, tituloEstacion }) {
  return `<section class="d-wrap d-hero">
  <div class="d-hero-txt">
    <a class="d-back" href="${volver}">← ${esc(volverTxt)}</a>
    <span class="d-pill">${esc(pill)}</span>
    <h1>${esc(h1)}</h1>
    <p class="d-lead">${esc(lead)}</p>
    ${tiles ? stats(tiles) : ''}
    <div class="d-btns">${botones}</div>
  </div>
  <div class="d-hero-mark">${marcaHero(etapaIdx, num, tituloEstacion)}</div>
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

// «La teoría, en Sensei»: la lección de la estación y las que conviene leer antes (abren en otra pestaña).
const fuera = (url) => `href="${esc(url)}" target="_blank" rel="noopener"`;
function tarjetaSensei(x, num) {
  if (!x) return '';
  return `<div class="d-card d-sensei">
    <h3>La teoría, en Sensei</h3>
    <p class="d-txt">Sensei es el curso de teoría desde cero de TrueML. Su lección de esta estación explica el porqué de lo que aquí construyes; léela antes o vuelve a ella cuando algo no cierre.</p>
    <a class="d-sensei-l" ${fuera(x.leccion.url)}><span class="d-lbl">Lección de la estación ${num}</span><b>${esc(x.leccion.titulo)}</b><span class="d-ir">Leer en Sensei ↗</span></a>
    ${x.requisitos.length ? `<span class="d-lbl">Si te falta base, lee antes</span>
    <div class="d-chips">${x.requisitos.map((r) => `<a ${fuera(r.url)}>${esc(r.titulo)} ↗</a>`).join('')}</div>` : ''}
  </div>`;
}

const TIPO = { mundo: 'd-t-mundo', config: 'd-t-config', infra: 'd-t-infra', entorno: 'd-t-entorno' };

// Etiquetas de un camino: en qué momento pasa (antes o en producción) y si usa el kit.
const etiquetas = (momento, kit, conKit) => `<span class="d-etqs">${momento ? `<span class="d-etq d-etq-${/antes/i.test(momento) ? 'antes' : 'prod'}">${esc(momento)}</span>` : ''}<span class="d-etq ${conKit ? 'd-etq-kit' : 'd-etq-sin'}">${esc(kit)}</span></span>`;

// ---------------------------------------------------------------- estación
// modo: 'completa' (estación sin prácticas: todo en una página), 'estacion' (con prácticas: mapa, por dónde ir,
// conceptos y repaso) o 'proyecto' (la página del proyecto con kit: precálculos, kit, rondas, guiado, solo, romper).
function paginaEstacion(e, { total, kitBytes, kb }, modo) {
  const idx = indiceConceptos(e, modo === 'proyecto' ? e.kitUrl : e.url);
  const py = e.mundo.python || 'python';   // cómo se llama Python en el kit (con venv: python; sin venv: python3)
  const conPracticas = e.practicas.length > 0;
  const indice = [];   // sin barra de anclas: la página va en orden (arranque, rondas, guiado, solo, romper…)
  const kitBtn = `<a class="d-btn" href="/kits/${e.slug}.zip" download>Bajar el kit .zip · ${kb(kitBytes)}</a>`;

  // Cada ronda: su prompt y un enlace a la sección de esta página donde se trabaja.
  const ronda = (n, t, d, p, [href, ir]) => `<div class="d-card d-ronda"><span class="d-ronda-t"><i>${n} · </i>${esc(t)}</span><span class="d-txt">${esc(d)}</span>${prompt(p)}<a class="d-ir d-ronda-ir" href="${href}">${ir} ↓</a></div>`;

  const precalc = new Map(e.precalculos.cuentas.map((x, i) => [x.id, `<article class="d-card d-pc" id="pc-${x.id}">
      <div class="d-pc-h"><span class="d-num">${i + 1}</span><h3>${esc(x.pregunta)}</h3></div>
      <code class="d-formula">${esc(x.formula)}</code>
      ${chips(x.conceptos, idx)}
      <details class="d-ver"><summary>Ver la cuenta</summary><div class="d-ver-body">
        <div class="d-escalas">
          <div class="d-esc"><span class="d-lbl">${esc(e.linea.escala)}</span><span>${x.ref.cuenta}</span><strong>${x.ref.valor}</strong></div>
          <div class="d-esc d-esc-dojo"><span class="d-lbl">En el dojo</span><span>${x.taller.cuenta}</span><strong>${x.taller.valor}</strong></div>
        </div>
        <p class="d-decide"><b>Qué decides con esto. </b>${x.decide}</p>
        ${x.comprueba ? comando(x.comprueba, 'terminal · compruébalo en el kit') : ''}
        ${x.confirma ? `<p class="d-nota"><b>Lo confirmas en</b> ${x.confirma}</p>` : ''}
      </div></details>
    </article>`]));

  // El paso 0 del Guiado es el arranque: sus comandos viven en #arranque; sus salidas, notas y su «ojo», en
  // «¿Algo falló al levantar?». Los comandos que no son de arranque (en_pagina.del_paso0) pasan a su paso.
  const p0 = e.guiado[0], reparto = repartir(e);
  const movidos = new Set([...reparto.values()].flatMap((r) => r.delPaso0));
  const k = new Map(e.conceptos.map((c) => [c.id, c]));
  const arranque = (e.mundo.arranque || `unzip ${e.slug}.zip && cd ${e.slug}\npython3 -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\ndocker compose up -d\npython mundo/reiniciar.py --todo`)
    .split('\n').filter((l) => !/verificar\.py mundo\s*$/.test(l)).join('\n');
  const primera = (code) => code.split('\n')[0];
  const fallo = [
    p0.ojo ? `<div class="d-listo"><div class="d-ojo"><b>Ojo: </b>${p0.ojo}</div></div>` : '',
    ...p0.comandos.filter((_, i) => !movidos.has(i)).map((c) => `${c.nota ? `<p class="d-nota"><code>${esc(primera(c.code))}</code> · ${c.nota}</p>` : ''}${salida(c.salida, `Salida real · ${primera(c.code)}`)}`),
  ].join('\n      ');
  const paso4 = (n, t, body) => `<div class="d-card d-pc"><div class="d-pc-h"><span class="d-num">${n}</span><h3>${esc(t)}</h3></div>${body}</div>`;
  const ctx = (t, body) => `<details class="d-ctx"><summary>${esc(t)}</summary><div class="d-ctx-b">${body}</div></details>`;

  // Por dónde ir: las prácticas desde cero y el proyecto con kit, en orden, cada uno con su momento y si usa kit.
  const proy = e.proyecto || {};
  const paso3 = (n, href, cls, etqs, t, txt, mini, ir) => `<li><a class="d-card d-camino-p ${cls}" href="${href}"><span class="d-camino-n">${n}</span>${etqs}<h3>${t}</h3><span class="d-txt">${txt}</span>${mini ? `<span class="d-mini">${mini.map((c) => `<span>${esc(c)}</span>`).join('')}</span>` : ''}<span class="d-ir">${ir}</span></a></li>`;
  const ruta = conPracticas ? `<section class="d-sec" id="ruta">
  ${titulo('Por dónde ir', `${e.practicas.length + 1} caminos, en orden`)}
  <p class="d-p">Esta estación pasa en dos momentos: <b>antes de producción</b>, cuando se arma el primer dataset, y <b>en producción</b>, el ciclo de cada mes con el modelo ya atendiendo. Las prácticas desde cero los recorren con tus propias manos y sin kit; el proyecto con kit repite el mes en producción a más escala, en las cuatro rondas.</p>
  <ol class="d-camino">
    ${e.practicas.map((q) => paso3(q.orden, q.url, 'd-practica', etiquetas(q.momento, q.carpeta ? `Sin kit · ${q.carpeta}` : 'Sin kit', false), `Práctica ${q.orden} · ${esc(q.titulo)}`, esc(q.subtitulo), q.chips, 'Abrir la práctica →')).join('\n    ')}
    ${paso3(e.practicas.length + 1, e.kitUrl, 'd-camino-kit', etiquetas(proy.momento, 'Con kit · 4 rondas', true), 'El proyecto con kit', esc(e.mundo.resumen), [`${e.guiado.length} pasos`, `${e.solo.objetivos.length} checks`, `${e.fallas.length} fallas`, `kit ${kb(kitBytes)}`], 'Abrir el proyecto →')}
  </ol>
  ${proy.relacion ? `<p class="d-nota">${proy.relacion}</p>` : ''}
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
        <span class="d-meta">Concepto: <a href="${idx.get(f.concepto).url}">${esc(idx.get(f.concepto).termino)}</a> · check: ${esc(f.check)}</span>
      </div>`).join('\n      ');

  const memo = e.repaso.memo.match(/^<b>(.*?)<\/b>\s*([\s\S]*)$/);

  const S = {
    mapa: `<section class="d-sec" id="mapa">
  ${titulo('Dónde estás', 'el mapa')}
  <p class="d-p">${e.mapa.resumen}</p>
  <div class="d-io">
    <div class="d-card"><span class="d-lbl">Entra</span><ul>${e.mapa.entra.map((x) => `<li>${x}</li>`).join('')}</ul></div>
    <div class="d-io-n" aria-hidden="true"><span>→</span><b>${e.num}</b><span>→</span></div>
    <div class="d-card"><span class="d-lbl">Sale</span><ul>${e.mapa.sale.map((x) => `<li>${x}</li>`).join('')}</ul></div>
  </div>
  <div class="d-tabla"><table><thead><tr><th></th><th>${esc(e.linea.escala)}</th><th class="d-th-dojo">En el dojo</th></tr></thead><tbody>${e.mapa.escala.map((r) => `<tr><th scope="row">${esc(r.que)}</th><td>${r.ref}</td><td>${r.taller}</td></tr>`).join('')}</tbody></table></div>
  ${e.mapa.hoja ? `<p class="d-nota">La estación completa, con su lugar en el mapa: <a href="${esc(e.mapa.hoja)}">cheat sheet «Del dato a producción»</a>.</p>` : ''}
  ${tarjetaSensei(e.sensei, e.num)}
</section>`,
    conceptos: `<section class="d-sec" id="conceptos">
  ${titulo('Conceptos exprés', String(e.conceptos.length))}
  <p class="d-p">Una línea para entenderlo; abre la tarjeta para la analogía, por qué importa y la trampa.</p>
  <div class="d-kgrid">
    ${e.conceptos.map((c) => concepto(c)).join('\n    ')}
  </div>
</section>`,
    // Contexto opcional: todo lo que antes iba antes del trabajo, al final y cerrado.
    contexto: `<section class="d-sec" id="contexto">
  ${titulo('Contexto opcional', 'para consultar')}
  ${modo === 'proyecto' ? '' : ctx('Dónde estás en el pipeline', `<p class="d-p">${e.mapa.resumen}</p>
  <div class="d-io">
    <div class="d-card"><span class="d-lbl">Entra</span><ul>${e.mapa.entra.map((x) => `<li>${x}</li>`).join('')}</ul></div>
    <div class="d-io-n" aria-hidden="true"><span>→</span><b>${e.num}</b><span>→</span></div>
    <div class="d-card"><span class="d-lbl">Sale</span><ul>${e.mapa.sale.map((x) => `<li>${x}</li>`).join('')}</ul></div>
  </div>`)}
  ${ctx('El escenario del proyecto', `${etiquetas(proy.momento, 'Con kit · 4 rondas', true)}
  <p class="d-p">${proy.resumen || e.mundo.resumen}</p>${proy.relacion ? `<p class="d-nota">${proy.relacion}</p>` : ''}
  <p class="d-txt">${p0.explica}</p>`)}
  ${modo === 'proyecto' ? '' : ctx(`Glosario: los ${e.conceptos.length} conceptos`, `<p class="d-p">Una línea para entenderlo; abre la tarjeta para la analogía, por qué importa y la trampa.</p>
  <div class="d-kgrid">
    ${e.conceptos.map((c) => concepto(c)).join('\n    ')}
  </div>`)}
  ${ctx('Nube real vs. local', `${modo === 'proyecto' ? '' : `<div class="d-tabla"><table><thead><tr><th></th><th>${esc(e.linea.escala)}</th><th class="d-th-dojo">En el dojo</th></tr></thead><tbody>${e.mapa.escala.map((r) => `<tr><th scope="row">${esc(r.que)}</th><td>${r.ref}</td><td>${r.taller}</td></tr>`).join('')}</tbody></table></div>`}
  <div class="d-tabla"><table><thead><tr><th>En la nube</th><th class="d-th-dojo">En el dojo</th><th>Qué cambia</th></tr></thead><tbody>${e.mundo.sustituciones.map((r) => `<tr><th scope="row">${esc(r.nube)}</th><td>${esc(r.local)}</td><td>${r.diferencia}</td></tr>`).join('')}</tbody></table></div>`)}
  ${ctx('Qué trae el kit y qué escribes tú', `<div class="d-grid2">
    <div class="d-card"><h3>Lo que trae <small>no lo escribes</small></h3><div class="d-lista">${e.mundo.trae.map((t) => `<p><b>${esc(t.que)}.</b> ${t.detalle}</p>`).join('')}</div></div>
    <div class="d-card"><h3>${e.id === 'datos' ? 'Tu pipeline' : 'Lo que escribes'} <small>lo escribes tú</small></h3><ol class="d-linea">${e.mundo.tu_pipeline.map((t) => `<li><code>${esc(t.archivo)}</code><span>${t.hace}</span></li>`).join('')}</ol></div>
  </div>`)}
  ${ctx('Reglas CLAUDE.md del kit', `<div class="d-card d-ronda"><span class="d-ronda-t">El CLAUDE.md del kit</span><span class="d-txt">Las reglas de fondo para Claude Code en la carpeta del kit. Ya viene en el .zip.</span>${prompt(e.prompt.claude_md, { boton: 'Copiar', ver: 'Ver el CLAUDE.md' })}</div>`)}
  ${modo === 'proyecto' ? `<p class="d-nota">El mapa, los conceptos y el repaso son de toda la estación: están en <a href="${e.url}#mapa">su página</a>.</p>` : `${e.mapa.hoja ? `<p class="d-nota">La estación completa, con su lugar en el mapa: <a href="${esc(e.mapa.hoja)}">cheat sheet «Del dato a producción»</a>.</p>` : ''}
  ${tarjetaSensei(e.sensei, e.num)}`}
</section>`,
    arranque: `<section class="d-sec" id="arranque">
  ${titulo('Arranca en 3 pasos', 'lo vital')}
  <p class="d-p"><b>Necesitas:</b> ${e.mundo.requisitos.join(' · ')}</p>
  ${paso4(1, 'Descarga el kit', kitBtn)}
  ${paso4(2, 'Levanta el mundo', codigo(arranque, 'arranque'))}
  ${paso4(3, 'Verifica', codigo(`${py} verificar.py mundo`, 'terminal') + listo(`${p0.verifica} Ya puedes practicar.`))}
  ${sub('¿Algo falló al levantar?', fallo)}
</section>`,
    rondas: `<section class="d-sec" id="rondas">
  ${titulo('¿Ya está corriendo? Elige cómo practicar', 'las cuatro rondas')}
  <p class="d-p">Cada ronda se trabaja en una sesión de Claude Code abierta en la carpeta del kit. Copia el prompt de la ronda y pégalo; el enlace de cada tarjeta te lleva a su sección en esta página. El <code>CLAUDE.md</code> del kit pone las reglas de fondo.</p>
  <div class="d-rondas">
    <span></span><span class="d-eje">Construir</span><span class="d-eje">Romper</span>
    <span class="d-eje d-eje-v">Con ayuda</span>
    ${ronda(1, 'Construir con ayuda', `Con el Guiado de abajo: construyen juntos los pasos 1 a ${e.guiado.at(-1).n}. Empieza aquí.`, e.prompt.guiado, ['#guiado', 'Ir al Guiado'])}
    ${ronda(3, 'Romper con ayuda', 'Una falla real; Claude te guía con preguntas.', e.prompt.romper_ayuda, ['#romper', 'Ir a Romper'])}
    <span class="d-eje d-eje-v">Solo</span>
    ${ronda(2, 'Construir solo', 'Rehaces todo desde el esqueleto, solo con los objetivos de Solo.', e.prompt.solo, ['#solo', 'Ir a Solo'])}
    ${ronda(4, 'Romper solo', 'Una falla escondida; nadie te da pistas.', e.prompt.romper_solo, ['#romper', 'Ir a Romper'])}
  </div>
  <p class="d-nota">Lleva la cuenta en <a href="/tablero/#est-${e.slug}">tu tablero</a>: el kit anota tu avance en <code>taller/progreso.json</code> y ahí lo importas.</p>
</section>`,
    guiado: `<section class="d-sec" id="guiado">
  ${titulo('Guiado', 'paso a paso')}
  <p class="d-p">¿Aún no levantas el ambiente? <a href="#arranque">Ve al arranque</a>.</p>
  <p class="d-p">El código que ves es el de la solución de referencia, y cada salida es la que salió al correr el kit en una carpeta limpia.</p>
  <p class="d-nota"><b>Precálculos. </b>${e.precalculos.intro} Cada uno está dentro del paso donde se usa.</p>
  <div class="d-pasos">
    ${e.guiado.slice(1).map((p, i) => { const r = reparto.get(p.id); return paso(p, idx, i === 0, { conceptos: r.conceptos.map((c) => k.get(c)), precalculos: r.precalculos.map((x) => precalc.get(x)), cmds0: r.delPaso0.map((j) => p0.comandos[j]) }); }).join('\n    ')}
  </div>
</section>`,
    solo: `<section class="d-sec" id="solo">
  ${titulo('Solo', `${e.solo.objetivos.length} objetivos`)}
  <div class="d-reglas">${e.solo.reglas.map((r) => `<p>${r}</p>`).join('')}</div>
  <div class="d-objs">
    ${e.solo.objetivos.map((o) => `<div class="d-obj"><span>${String(o.n).padStart(2, '0')}</span><span>${o.objetivo}<code>${py} verificar.py ${esc(o.check)}</code>${o.pista ? `<small><b>Pista:</b> ${o.pista}</small>` : ''}</span></div>`).join('\n    ')}
  </div>
</section>`,
    romper: `<section class="d-sec" id="romper">
  ${titulo('Romper', `${e.fallas.length} fallas`)}
  <div class="d-grid2">
    <p class="d-p">Con todo en verde, <code>romper.py</code> mete una falla en el mundo, la configuración o la infraestructura (nunca en lo que escribiste) y, si hace falta, deja corriendo lo que «pasó anoche». Tú empiezas por <code>verificar.py</code>.</p>
    ${codigo([['--mostrar', 'con ayuda: Claude sabe cuál es'], ['', 'solo: escondida, ni Claude la sabe'], ['--verificar', '¿ya quedó?'], ['--revelar', 'me rindo'], ['--restaurar', 'deshacer']]
      .map(([a, c]) => `${`${py} romper.py ${a}`.padEnd(py.length + 23)}# ${c}`).join('\n'), 'romper.py', 'bash')}
  </div>
  <details class="d-catalogo"><summary><span><span class="d-cat-t">Catálogo de fallas <em>(spoilers)</em></span><span class="d-txt">El catálogo de abajo trae las respuestas. Ábrelo después de romper, para repasar.</span></span><span class="d-cat-b">Abrir el catálogo</span></summary>
    <div class="d-fallas">
      ${fallas}
    </div>
  </details>
</section>`,
    repaso: `<section class="d-sec" id="repaso">
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
</section>`,
    sigue: `<section class="d-sec" id="sigue">
  <div class="d-btns"><a class="d-btn" href="${e.url}#repaso">El repaso de la estación</a><a class="d-btn d-btn2" href="${e.url}#ruta">Volver a la estación</a></div>
</section>`,
  };
  // Lo vital al frente (arranque y rondas), después el trabajo y al final el contexto, cerrado.
  const trabajo = [S.arranque, S.rondas, S.guiado, S.solo, S.romper];
  const main = modo === 'estacion' ? [S.mapa, ruta, S.conceptos, S.repaso]
    : modo === 'proyecto' ? [...trabajo, S.contexto, S.sigue]
    : [...trabajo, S.repaso, S.contexto];
  const empezar = `<a class="d-btn" href="#${modo === 'estacion' ? 'ruta' : 'arranque'}">Empezar</a>`;
  const L = e.linea.corto, inicio = `/${e.linea.id}/`;
  return `${modo === 'proyecto' ? `${barra({ ruta: `/ ${L} · ${e.num} · proyecto con kit`, indice })}
${hero({ volver: e.url + '#ruta', volverTxt: e.titulo, pill: `${L} · Estación ${e.num} · Proyecto con kit`, h1: 'El proyecto con kit', lead: e.mundo.resumen, etapaIdx: e.etapaIdx, num: e.num, tituloEstacion: e.titulo,
    botones: empezar })}
` : `${barra({ ruta: `/ ${L} · ${e.num}`, indice })}
${hero({ volver: inicio, volverTxt: e.linea.entrenamiento, pill: `${L} · Estación ${e.num} de ${total}`, h1: e.titulo, lead: e.pregunta, etapaIdx: e.etapaIdx, num: e.num, tituloEstacion: e.titulo,
    botones: empezar })}
`}<main class="d-wrap d-main">
${main.join('\n\n')}
</main>
${pie}`;
}

export const cuerpoEstacion = (e, opts) => paginaEstacion(e, opts, e.practicas.length ? 'estacion' : 'completa');
export const cuerpoProyecto = (e, opts) => paginaEstacion(e, opts, 'proyecto');

// ---------------------------------------------------------------- práctica desde cero
export function cuerpoPractica(e, p) {
  const idx = indiceConceptos(e, p.url);
  const otra = e.practicas.filter((q) => q.id !== p.id);
  const indice = [];   // sin barra de anclas, como las estaciones

  const precalc = new Map(p.precalculos.map((x, i) => [x.id, `<article class="d-card d-pc" id="pc-${x.id}">
      <div class="d-pc-h"><span class="d-num">${i + 1}</span><h3>${esc(x.pregunta)}</h3></div>
      ${chips(x.conceptos, idx)}
      <details class="d-ver"><summary>Ver la cuenta</summary><div class="d-ver-body">
        <div class="d-escalas">
          <div class="d-esc d-esc-dojo"><span class="d-lbl">En tu carpeta</span><span>${x.cuenta}</span><strong>${x.valor}</strong></div>
          ${x.ref ? `<div class="d-esc"><span class="d-lbl">${esc(e.linea.escala)}</span><span>${x.ref}</span></div>` : ''}
        </div>
        <p class="d-decide"><b>Qué decides con esto. </b>${x.decide}</p>
        ${x.comprueba ? comando(x.comprueba, 'terminal · compruébalo') : ''}
        ${x.confirma ? `<p class="d-nota"><b>Lo confirmas en</b> ${x.confirma}</p>` : ''}
      </div></details>
    </article>`]));

  // El arranque: el paso que lo es (sus archivos, sus comandos y cómo verificar; sus salidas van en «¿Algo falló
  // al levantar?») o, si la práctica sigue a otra, volver a esa carpeta y levantar los servicios.
  const p1 = p.arranque?.paso ? p.pasos[0] : null;
  const reparto = repartirPractica(p);
  const k = new Map(p.conceptos.map((c) => [c.id, c]));
  const paso4 = (n, t, body) => `<div class="d-card d-pc"><div class="d-pc-h"><span class="d-num">${n}</span><h3>${esc(t)}</h3></div>${body}</div>`;
  const ctx = (t, body) => `<details class="d-ctx"><summary>${esc(t)}</summary><div class="d-ctx-b">${body}</div></details>`;
  const antes = otra.filter((q) => q.orden < p.orden).at(-1);
  const pasosArranque = p1 ? [
    paso4(1, 'Escribe los archivos', `<p class="d-txt">${p1.explica}</p>${p1.codigo.map((c) => codigo(c.code, c.path || c.lang) + (c.nota ? `<p class="d-nota">${c.nota}</p>` : '')).join('')}`),
    paso4(2, 'Levanta el entorno y los servicios', p1.comandos.map((c) => codigo(c.code, 'terminal') + (c.nota ? `<p class="d-nota">${c.nota}</p>` : '')).join('')),
    paso4(3, 'Verifica', listo(`${p1.verifica} Ya puedes practicar.`)),
  ] : [
    ...(antes ? [paso4(1, 'Termina la práctica anterior', `<a class="d-btn" href="${antes.url}">${esc(antes.titulo)}</a>`)] : []),
    ...(p.arranque?.code ? [paso4(antes ? 2 : 1, 'Levanta los servicios', codigo(p.arranque.code, 'terminal'))] : []),
  ];
  const fallo = p1 ? [p1.ojo ? `<div class="d-listo"><div class="d-ojo"><b>Ojo: </b>${p1.ojo}</div></div>` : '',
    ...p1.comandos.filter((c) => c.salida).map((c) => salida(c.salida, `Salida real · ${c.code.split('\n').at(-1)}`))].join('\n      ') : '';
  const guiado = p.pasos.filter((x) => x !== p1);

  return `${barra({ ruta: `/ ${e.linea.corto} · ${e.num} · desde cero`, indice })}
${hero({ volver: e.url + '#ruta', volverTxt: e.titulo, pill: `${e.linea.corto} · Estación ${e.num} · Desde cero ${p.orden} de ${e.practicas.length}`, h1: p.titulo, lead: p.subtitulo, etapaIdx: e.etapaIdx, num: e.num, tituloEstacion: e.titulo,
    botones: '<a class="d-btn" href="#arranque">Empezar</a>' })}
<main class="d-wrap d-main">
<section class="d-sec" id="arranque">
  ${titulo(`Arranca en ${pasosArranque.length} pasos`, 'lo vital')}
  <p class="d-p"><b>Necesitas:</b> ${p.requisitos.join(' · ')}</p>
  ${pasosArranque.join('\n  ')}
  ${fallo ? sub('¿Algo falló al levantar?', fallo) : ''}
</section>

<section class="d-sec" id="rondas">
  ${titulo('¿Ya está corriendo? Elige cómo practicar', 'dos formas')}
  <div class="d-grid2">
    <div class="d-card d-ronda"><span class="d-ronda-t"><i>Guiado · </i>Cómo se trabaja</span><span class="d-txt">Abre una sesión de Claude Code en la carpeta de la práctica y pega este prompt. Tú escribes el código; Claude explica, revisa y te hace las preguntas. Esta página es tu referencia: el código es el de la solución probada y cada salida es la que salió de verdad.</span>${prompt(p.prompt.guiado)}<a class="d-ir d-ronda-ir" href="#guiado">Ir al Guiado ↓</a></div>
    <div class="d-card d-ronda"><span class="d-ronda-t"><i>Solo · </i>El prompt</span>${prompt(p.prompt.solo)}<a class="d-ir d-ronda-ir" href="#solo">Ir a Hazlo solo ↓</a></div>
  </div>
</section>

<section class="d-sec" id="guiado">
  ${titulo('Guiado', `${guiado.length} pasos`)}
  <p class="d-p">¿Aún no levantas el ambiente? <a href="#arranque">Ve al arranque</a>.${p1 ? ` El paso ${p1.n} es el arranque.` : ''}</p>
  <p class="d-nota"><b>Precálculos. </b>Haz cada cuenta antes de abrirla. Con un dataset tan chico los números son de juguete, pero las preguntas son las mismas que en ${esc(e.linea.corto)}. Cada uno está dentro del paso donde se usa.</p>
  <div class="d-pasos">
    ${guiado.map((x, i) => { const r = reparto.get(x.id); return paso(x, idx, i === 0, { conceptos: r.conceptos.map((c) => k.get(c)), precalculos: r.precalculos.map((q) => precalc.get(q)) }); }).join('\n    ')}
  </div>
</section>

<section class="d-sec" id="solo">
  ${titulo('Hazlo solo', `${p.solo.length - 1} objetivos`)}
  <div class="d-reglas"><p>${p.solo[0]}</p><p>Claude no te da código: te contesta con preguntas, y solo da una pista si dices «me rindo».</p></div>
  <div class="d-objs">
    ${p.solo.slice(1).map((o, i) => `<div class="d-obj"><span>${String(i + 1).padStart(2, '0')}</span><span>${o}</span></div>`).join('\n    ')}
  </div>
  <div class="d-btns">${otra.map((q) => `<a class="d-btn${q.orden > p.orden ? '' : ' d-btn2'}" href="${q.url}">${q.orden > p.orden ? 'Sigue' : 'Antes'}: ${esc(q.titulo)}</a>`).join('')}${p.orden === e.practicas.length ? `<a class="d-btn" href="${e.kitUrl}">Sigue: el proyecto con kit</a>` : ''}<a class="d-btn d-btn2" href="${e.url}#ruta">Volver a la estación</a></div>
</section>

<section class="d-sec" id="contexto">
  ${titulo('Contexto opcional', 'para consultar')}
  ${ctx('La escena', `${etiquetas(p.momento, p.carpeta ? `Sin kit · ${p.carpeta}` : 'Sin kit', false)}
  <p class="d-p">${p.escena}</p>
  <div class="d-ojo d-cuando"><b>Cuándo pasa esto: </b>${p.cuando}</div>`)}
  ${ctx('Terminas con', `<ul class="d-ul">${p.resultado.map((r) => `<li>${r}</li>`).join('')}</ul>`)}
  ${p.conceptos.length ? ctx(`Glosario: los ${p.conceptos.length} conceptos nuevos`, `<p class="d-p">Los que aparecen aquí por primera vez. Los demás chips llevan a los conceptos de la estación.</p>
  <div class="d-kgrid">
    ${p.conceptos.map((c) => concepto(c)).join('\n    ')}
  </div>`) : ''}
  <p class="d-nota">Los demás conceptos y el repaso son de toda la estación: están en <a href="${e.url}#conceptos">su página</a>.</p>
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

// El mapa del C01, siempre sobre azul marino como el bloque del Dojo en la portada. La línea va pintada con las 6 etapas
// de la T: 5 estaciones arriba, 7 abajo y el reentrenamiento punteado que vuelve a 1. En el centro, el avance; al pasar
// por una estación, el centro dice qué sale de ella (site/app.js). Las que ya tienen dojo abren su página; las demás,
// su sección en la cheat sheet.
const ETAPA_ID = ['datos', 'modelo', 'api', 'contenedor', 'orquestacion', 'monitoreo'];
const TRAMOS = [[1, 2, 'Datos', 'semanas'], [3, 5, 'Modelo', 'semanas'], [6, 10, 'Release', 'días'], [11, 12, 'Operación', 'milisegundos y continuo']];
// El mismo anillo sirve para cualquier línea de 12 estaciones: `o` trae su etapa de la T por estación, sus tramos, el
// texto del centro y el del lazo (en una rama: content/ramas.json). Sin `o`, es el del C01.
const MAPA_C01 = { et: (s) => etapa(s.num), tramos: TRAMOS, centro: 'C01 · DEL DATO A PRODUCCIÓN', lazo: 'reentrenamiento',
  lazoLargo: '<b>Reentrenamiento</b>: de 12 vuelve a 1 · Datos', aria: 'Mapa del C01: 12 estaciones en un anillo, de Datos a Monitoreo, y el reentrenamiento que vuelve a Datos' };
function metro(estaciones, enlace, lista, o_ = MAPA_C01) {
  const { et, tramos, centro, lazo, aria } = o_;
  const W = 1160, H = 560, xL = 150, xR = 1010, yT = 196, yB = 404, R = (yB - yT) / 2, yM = (yT + yB) / 2;
  const P = [0, 1, 2, 3, 4].map((i) => [xL + i * (xR - xL) / 4, yT]).concat([0, 1, 2, 3, 4, 5, 6].map((i) => [xR - i * (xR - xL) / 6, yB]));
  const f = (n) => Math.round(n * 10) / 10;
  const wrap = (t, n) => { const out = []; let cur = ''; t.split(' ').forEach((w) => { if (cur && (cur + ' ' + w).length > n) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }); if (cur) out.push(cur); return out; };
  const tramo = (n) => { const [x, y] = P[n - 1]; return [x, y]; };
  const seg = (a, b) => (a === 4 ? `M${f(P[a][0])} ${yT}A${R} ${R} 0 0 1 ${f(P[b][0])} ${yB}` : `M${f(P[a][0])} ${P[a][1]}L${f(P[b][0])} ${P[b][1]}`);
  let o = '';
  // los tramos: una regla fina con su nombre y su velocidad, arriba de la fila de arriba y abajo de la de abajo
  tramos.forEach(([a, b, nom, vel]) => {
    const xa = tramo(a)[0], xb = tramo(b)[0], arriba = a <= 5, y = arriba ? 54 : H - 44, x0 = Math.min(xa, xb) - 46, x1 = Math.max(xa, xb) + 46;
    o += `<path d="M${f(x0)} ${y}H${f(x1)}M${f(x0)} ${y - 5}V${y + 5}M${f(x1)} ${y - 5}V${y + 5}" class="m-regla"/>`;
    o += `<text x="${f(x0)}" y="${arriba ? y - 11 : y + 21}" class="m-tramo">${nom.toUpperCase()} <tspan>· ${vel}</tspan></text>`;
  });
  // la línea: un brillo ancho debajo y el trazo de color de cada etapa encima
  const segs = estaciones.slice(0, -1).map((s, i) => [seg(i, i + 1), ETAPA_ID[et(s)]]);
  o += segs.map(([d, e]) => `<path d="${d}" class="m-brillo m-${e}"/>`).join('') + segs.map(([d, e]) => `<path d="${d}" class="m-linea m-${e}"/>`).join('');
  const ruta = `M${xL} ${yT}H${xR}A${R} ${R} 0 0 1 ${xR} ${yB}H${xL}`;
  o += `<path d="${ruta}" class="m-flujo"><animate attributeName="stroke-dashoffset" from="0" to="-22" dur="1.4s" repeatCount="indefinite"/></path>`;
  // el reentrenamiento: de 12 vuelve a 1
  o += `<path d="M${xL} ${yB}A${R} ${R} 0 0 1 ${xL} ${yT}" class="m-loop"/><path d="M${xL - 30} ${yT - 9}L${xL - 13} ${yT}L${xL - 30} ${yT + 9}Z" class="m-loop-f"/>`;
  o += `<text transform="translate(${xL - R - 22} ${yM}) rotate(-90)" text-anchor="middle" class="m-loop-t">↺ ${esc(lazo)}</text>`;
  // el centro: el avance y, al pasar por una estación, qué sale de ella
  const listas = estaciones.filter((s) => lista.has(s.id)).length;
  o += `<g class="m-centro"><text x="${W / 2}" y="${yM - 38}" text-anchor="middle" class="m-c1" data-def="${esc(centro)}">${esc(centro)}</text>`;
  o += `<text x="${W / 2}" y="${yM - 8}" text-anchor="middle" class="m-c2" data-def="${listas} de ${estaciones.length} estaciones ya tienen dojo">${listas} de ${estaciones.length} estaciones ya tienen dojo</text>`;
  o += `<text x="${W / 2}" y="${yM + 18}" text-anchor="middle" class="m-c3" data-def="Pasa el cursor por una estación para ver qué sale de ella">Pasa el cursor por una estación para ver qué sale de ella</text>`;
  const pw = 26, pg = 6, px = W / 2 - (estaciones.length * (pw + pg) - pg) / 2;
  o += estaciones.map((s, i) => `<rect x="${f(px + i * (pw + pg))}" y="${yM + 38}" width="${pw}" height="7" rx="2" class="m-${ETAPA_ID[et(s)]}-f${lista.has(s.id) ? '' : ' m-apagado'}"/>`).join('') + '</g>';
  // las estaciones
  estaciones.forEach((s, i) => {
    const [x, y] = P[i], arriba = i < 5, listo = lista.has(s.id), e = ETAPA_ID[et(s)];
    const nl = wrap(s.titulo, arriba ? 22 : 15), lh = 18, pill = listo ? 30 : 0, alto = nl.length * lh + pill;
    const y0 = arriba ? y - 34 - alto : y + 36;
    let g = `<rect x="${f(x - (arriba ? 100 : 70))}" y="${f(arriba ? y0 - 6 : y - 26)}" width="${arriba ? 200 : 140}" height="${f(arriba ? y + 26 - y0 + 6 : y0 + alto + 6 - y + 26)}" fill="transparent"/>`;
    const yp = arriba ? y0 : y0 + nl.length * lh + 8, yt = arriba ? y0 + pill : y0;
    if (listo) g += `<rect x="${f(x - 54)}" y="${f(yp)}" width="108" height="22" rx="11" class="m-pill"/><text x="${f(x)}" y="${f(yp + 15)}" text-anchor="middle" class="m-pill-t">abrir el dojo →</text>`;
    nl.forEach((t, j) => { g += `<text x="${f(x)}" y="${f(yt + 14 + j * lh)}" text-anchor="middle" class="m-tit${listo ? ' m-tit-dojo' : ''}">${esc(t)}</text>`; });
    if (listo) g += `<circle cx="${f(x)}" cy="${y}" r="20" class="m-pulso"><animate attributeName="r" values="20;36" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="1.8s" repeatCount="indefinite"/></circle>`;
    g += `<circle cx="${f(x)}" cy="${y}" r="20" class="m-nodo m-${e}${listo ? ' m-nodo-dojo' : ''}"/>`;
    g += `<text x="${f(x)}" y="${f(y + 5)}" text-anchor="middle" class="m-num${listo ? ' m-num-dojo' : ''}">${s.num}</text>`;
    o += `<a href="${enlace(s)}" data-st="${i}" data-etapa="${NOMBRE_ETAPA[et(s)]}" data-num="${s.num}" data-titulo="${esc(s.titulo)}" data-sale="${esc(s.sale)}"><title>${s.num} · ${esc(s.titulo)} · sale: ${esc(s.sale)}</title>${g}</a>`;
  });
  return `<svg class="d-metro" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="group" aria-label="${esc(aria)}">${o}</svg>`;
}

// El mismo mapa para el celular: una línea vertical con los tramos, las estaciones y lo que viaja entre ellas.
function metroVertical(estaciones, enlace, lista, o_ = MAPA_C01) {
  let o = '';
  estaciones.forEach((s) => {
    const t = o_.tramos.find(([a]) => a === s.num), e = ETAPA_ID[o_.et(s)], listo = lista.has(s.id);
    if (t) o += `<div class="mv-tramo m-${e}-c"><b>${t[2]}</b> · ${t[3]}</div>`;
    o += `<a class="mv-st m-${e}-c${listo ? ' mv-dojo' : ''}" href="${enlace(s)}"><span class="mv-n">${s.num}</span><span class="mv-t"><b>${esc(s.titulo)}</b><span>→ ${esc(s.sale)}</span></span>${listo ? '<span class="mv-pill">dojo →</span>' : `<span class="mv-hoja">${o_.pendiente || 'hoja ↗'}</span>`}</a>`;
  });
  return `<div class="d-metrov">${o}<div class="mv-loop">↺ ${o_.lazoLargo}</div></div>`;
}

// ---------------------------------------------------------------- entrenamientos
// El Dojo se divide en entrenamientos: el tronco C01 (clasificación de imágenes) y cada rama de content/ramas.json que
// trae `compara` (hoy RAG, con el caso C11). La portada es el selector; cada entrenamiento tiene su página
// (/c01/, /<rama>/) con su caso, su mapa y sus estaciones. Las ramas sin `compara` (IA Privada) van en «Lo que viene».
const DONDE = { mac: 'Mac', gpu: 'GPU rentada', 'mac-gpu': 'Mac y GPU rentada' };
const dos = (n) => String(n).padStart(2, '0');

// «1 · 2 · 3 · 5» → «1–3, 5»: para las etiquetas de la T, donde no cabe la lista entera
function tramosNum(nums) {
  const out = [];
  nums.forEach((n) => { const u = out[out.length - 1]; if (u && n === u[1] + 1) u[1] = n; else out.push([n, n]); });
  return out.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a}–${b}`)).join(', ');
}
const numsDe = (ests, et, i) => ests.filter((s) => et(s) === i).map((s) => s.num);
const enEtapa = (nums) => `${nums.length > 1 ? 'estaciones' : 'estación'} ${nums.join(' · ')}`;
const cifras = (xs) => `<div class="d-c01">${xs.map(([n, t]) => `<div><b>${esc(n)}</b><span>${esc(t)}</span></div>`).join('')}</div>`;
const pipsDe = (ests, et, lista) => ests.map((s) => `<span style="background:${COLOR_ETAPA[et(s)]}${lista.has(s.id) ? '' : ';opacity:.3'}"></span>`).join('');
const bloqueT = (LB, clave, cap = '') => `<div class="d-home-t">
  <div class="d-hero-mark d-t-grande">${TM.mark(true, LB, clave, 'min(calc(100vh - 150px), 820px)')}</div>
  ${cap ? `<span class="d-t-cap" data-def="${esc(cap)}">${esc(cap)}</span>` : `<div class="d-hero-mark d-t-chica">${TM.mark(true, null, '', '420px')}</div>`}
</div>`;

// La línea de un entrenamiento en chiquito, para su puerta: las 12 estaciones con el color de su etapa de la T; las que ya
// tienen dojo van encendidas y laten, como en el mapa.
function lineaMini(ests, et, lista) {
  const W = 600, H = 60, x0 = 22, x1 = W - 22, y = 30, n = ests.length, X = (i) => Math.round((x0 + i * (x1 - x0) / (n - 1)) * 10) / 10;
  let o = ests.slice(0, -1).map((s, i) => `<path d="M${X(i)} ${y}H${X(i + 1)}" class="pl-seg m-${ETAPA_ID[et(s)]}"/>`).join('');
  o += `<path d="M${x0} ${y}H${x1}" class="pl-flujo"><animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1.2s" repeatCount="indefinite"/></path>`;
  o += ests.map((s, i) => {
    const on = lista.has(s.id);
    return `${on ? `<circle cx="${X(i)}" cy="${y}" r="12" class="pl-pulso"><animate attributeName="r" values="12;24" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="1.8s" repeatCount="indefinite"/></circle>` : ''}<circle cx="${X(i)}" cy="${y}" r="12" class="pl-n m-${ETAPA_ID[et(s)]}${on ? ' pl-on' : ''}"/><text x="${X(i)}" y="${y + 4}" text-anchor="middle" class="pl-t${on ? ' pl-t-on' : ''}">${s.num}</text>`;
  }).join('');
  return `<svg class="d-pl" viewBox="0 0 ${W} ${H}" width="100%" aria-hidden="true">${o}</svg>`;
}

// Una fila de estación, agrupada por etapa. Con dojo abre su página; sin dojo, en el tronco su sección de la cheat
// sheet y en una rama nada (dice «próximamente»).
function filaEstacion(s, e, { enlace, sensei, rama }) {
  const tags = rama ? `<span class="d-rama-tags"><span class="d-rama-donde d-donde-${s.donde}">${DONDE[s.donde]}</span></span>` : '';
  const extra = e && e.practicas && e.practicas.length ? `<span class="d-est-x">+ ${e.practicas.length} prácticas desde cero</span>` : '';
  const fin = e ? '<span class="d-est-b">Entrar →</span>' : rama ? '<span class="d-est-p">próximamente</span>' : '<span class="d-est-p">próximamente <br>hoja ↗</span>';
  const cuerpo = `<span class="d-est-n">${s.num}</span><span class="d-est-t"><span>${esc(s.titulo)}</span><span>sale: ${esc(s.sale)}</span>${extra}${tags}</span>${fin}`;
  const id = rama ? ` id="est-${rama}-${s.id}"` : '';
  const fila = e || !rama ? `<a class="d-est${e ? ' lista' : ''}"${id} href="${enlace(s)}">${cuerpo}</a>` : `<div class="d-est"${id}>${cuerpo}</div>`;
  return fila + (sensei && sensei.has(s.num) ? `<a class="d-est-sensei" ${fuera(sensei.get(s.num).leccion.url)}>Teoría en Sensei: ${esc(sensei.get(s.num).leccion.titulo)} ↗</a>` : '');
}
function gruposEtapa(ests, et, lista, opts) {
  return NOMBRE_ETAPA.map((nom, i) => {
    const xs = ests.filter((s) => et(s) === i);
    if (!xs.length) return '';
    return `<div class="d-etapa" data-etapa="${TM.ST[i][0]}" style="--c:${COLOR_ETAPA[i]}"><div class="d-etapa-h"><i></i><b>${nom}</b><span>${enEtapa(xs.map((s) => s.num))}</span></div>${xs.map((s) => filaEstacion(s, lista.get(s.id), opts)).join('')}</div>`;
  }).filter(Boolean).join('\n    ');
}

// Cada entrenamiento, ya resuelto para las páginas: { n, id, url, nombre, codigo, caso, frase, cifras, construyes, compara,
// ests, et, lista, primera }. build.mjs arma la lista: el tronco primero y después las ramas con `compara`.
export function entrenamientos({ tronco, listaTronco, ramas }) {
  const t = { n: 1, id: tronco.caso, url: `/${tronco.caso}/`, nombre: tronco.entrenamiento, codigo: tronco.caso.toUpperCase(),
    caso: tronco.titulo.replace(/^C\d\d · /, ''), frase: tronco.frase, cifras: tronco.cifras, construyes: tronco.construyes, compara: tronco.compara,
    ests: tronco.estaciones, et: (s) => etapa(s.num), lista: listaTronco };
  const rs = ramas.filter((r) => r.compara).map((r, k) => ({ n: k + 2, id: r.id, url: `/${r.id}/`, nombre: r.entrenamiento || r.nombre, codigo: r.caso.codigo || '',
    caso: r.caso.nombre, frase: r.frase || r.resumen, cifras: r.cifras || [], construyes: r.construyes || [], compara: r.compara,
    ests: r.estaciones, et: (s) => IDS.indexOf(s.etapa), lista: r.lista, rama: r }));
  return [t, ...rs].map((x) => ({ ...x, primera: x.ests.find((s) => x.lista.has(s.id)) || null, listas: x.ests.filter((s) => x.lista.has(s.id)).length }));
}

function puerta(x) {
  const estado = x.listas ? `${x.listas} de ${x.ests.length} listas` : 'próximamente';
  const empezar = x.primera ? `<a class="d-btn d-btn2" href="${x.lista.get(x.primera.id).url}">Empezar por la ${x.primera.num}</a>` : '';
  return `<article class="d-card d-puerta" id="entrenamiento-${x.id}">
    <a class="d-mapa d-puerta-top" href="${x.url}">
      ${franja('tm-stripe d-mapa-franja')}
      <span class="d-puerta-k"><span>Entrenamiento ${dos(x.n)}</span><span class="d-puerta-est${x.listas ? ' on' : ''}">${estado}</span></span>
      <span class="d-puerta-h"><b>${esc(x.nombre)}</b><span>${esc(x.codigo)}${x.codigo ? ' · ' : ''}${esc(x.caso)}</span></span>
      ${lineaMini(x.ests, x.et, x.lista)}
      <span class="d-puerta-ley"><span><i class="on"></i>con dojo</span><span><i></i>en camino</span><span class="d-puerta-ir">Entrar →</span></span>
    </a>
    <div class="d-puerta-body">
      <p class="d-txt">${esc(x.frase)}</p>
      ${x.cifras.length ? cifras(x.cifras.slice(0, 3)) : ''}
      ${x.construyes.length ? `<div class="d-puerta-con"><span class="d-lbl">Lo que vas a tocar</span><div class="d-mini">${x.construyes.map((c) => `<span>${esc(c)}</span>`).join('')}</div></div>` : ''}
      <div class="d-btns"><a class="d-btn" href="${x.url}">${x.listas ? 'Entrar al entrenamiento' : 'Ver su temario'} →</a>${empezar}</div>
    </div>
  </article>`;
}

const FILAS_CMP = [['construyes', 'Qué construyes'], ['entrena', 'Qué se entrena'], ['dificil', 'Dónde está lo difícil'], ['request', 'Cuánto tarda una respuesta'],
  ['gate', 'Qué decide si un cambio sale'], ['corre', 'Dónde corre']];

// tronco: content/tronco.json · lista: Map id → estación del tronco con dojo · ramas: content/ramas.json, cada una con
// `lista` (Map id → estación con dojo)
export function cuerpoPortada({ tronco, lista, ramas = [] }) {
  const ents = entrenamientos({ tronco, listaTronco: lista, ramas });
  const despues = ramas.filter((r) => !r.compara);
  const total = ents.reduce((n, x) => n + x.ests.length, 0), listas = ents.reduce((n, x) => n + x.listas, 0);
  const primera = ents.find((x) => x.primera);
  const indice = [['entrenamientos', 'Entrenamientos'], ['comparar', '¿Cuál elijo?'], ['como', 'Cómo se usa'], ['viene', 'Lo que viene']];
  // la T dice dónde cae cada entrenamiento en cada etapa: «C01 1–2 · C11 1–4»
  const LB = NOMBRE_ETAPA.map((nom, i) => [nom, ents.map((x) => { const ns = numsDe(x.ests, x.et, i); return ns.length ? `${x.codigo || x.nombre} ${tramosNum(ns)}` : ''; }).filter(Boolean).join(' · ')]);
  const atajo = (x) => `<a class="d-atajo" href="${x.url}"><span class="d-atajo-n">${dos(x.n)}</span><span class="d-atajo-t"><b>${esc(x.nombre)}</b><span>${esc(x.codigo)}${x.codigo ? ' · ' : ''}${x.listas ? `${x.listas} de ${x.ests.length} listas` : 'próximamente'}</span></span><span class="d-atajo-p">${x.ests.map((s) => `<i style="background:${COLOR_ETAPA[x.et(s)]}${x.lista.has(s.id) ? '' : ';opacity:.3'}"></i>`).join('')}</span><span class="d-atajo-f" aria-hidden="true">→</span></a>`;
  const paso = (n, t, txt, extra = '') => `<div class="d-card d-uso${extra ? ' d-uso-full' : ''}"><span class="d-uso-n">${n}</span><h3>${t}</h3><p class="d-txt">${txt}</p>${extra}</div>`;
  const ronda = (n, t, d) => `<div class="d-uso-r"><span><i>${n} </i>${t}</span><span>${d}</span></div>`;
  const sinListas = ents.filter((x) => !x.listas);

  return `${barra({ ruta: '', indice })}
<div class="d-wrap d-home">
<section class="d-home-hero">
  <span class="d-kick">TrueML · Entrenamiento práctico</span>
  <h1>Dojo de entrenamiento <span>ML engineer's</span></h1>
  <p class="d-lead">Elige un proyecto real y constrúyelo de punta a punta en tu Mac, estación por estación. Cada estación la haces cuatro veces: con ayuda, solo, rota con ayuda y rota solo, con la explicación de cada concepto justo cuando lo usas.</p>
  <div class="d-atajos" aria-label="Los entrenamientos">${ents.map(atajo).join('')}</div>
  <div class="d-btns"><a class="d-btn" href="#entrenamientos">Elegir entrenamiento</a><a class="d-btn d-btn2" href="/tablero/">Tu tablero</a></div>
</section>
${bloqueT(LB, 'portada')}
</div>

<section class="d-wrap d-sec d-sec-sola" id="entrenamientos">
  ${titulo('Elige tu entrenamiento', `${ents.length} proyectos completos · ${total} estaciones · ${listas} ${listas === 1 ? 'lista' : 'listas'}`)}
  <p class="d-p">Cada entrenamiento es un proyecto de punta a punta con su caso de referencia: una empresa ficticia con números reales, que recorres en 12 estaciones. Los dos usan el mismo método (el kit, las cuatro rondas y <a href="/tablero/">tu tablero</a>) y no dependen uno del otro: empieza por el que te sirva.</p>
  <div class="d-puertas">
  ${ents.map(puerta).join('\n  ')}
  </div>
</section>

<section class="d-wrap d-sec d-sec-sola" id="comparar">
  ${titulo('¿Cuál elijo?', 'lo que cambia entre los dos')}
  <p class="d-p">Los dos llevan un modelo a producción, pero el trabajo cae en lugares distintos. En clasificación se entrena un modelo; en RAG el modelo ya existe y lo difícil son los datos que le llegan y medir sus respuestas.</p>
  <div class="d-cmp" role="table" aria-label="Los entrenamientos, lado a lado">
    <div class="d-cmp-f d-cmp-cab" role="row"><span role="columnheader"></span>${ents.map((x) => `<a role="columnheader" href="${x.url}"><span class="d-lbl">Entrenamiento ${dos(x.n)}</span><b>${esc(x.nombre)}</b></a>`).join('')}</div>
    ${FILAS_CMP.map(([k, t]) => `<div class="d-cmp-f" role="row"><span class="d-lbl" role="rowheader">${t}</span>${ents.map((x) => `<span role="cell" data-cab="${esc(x.nombre)}">${esc(x.compara[k])}</span>`).join('')}</div>`).join('\n    ')}
  </div>
  <div class="d-orden d-cmp-v"><h3>¿No sabes por cuál empezar?</h3><p>Si nunca has llevado un modelo a producción, empieza por <b>${esc(ents[0].nombre)}</b>: lo que aprendes ahí (datos versionados, Docker, monitoreo) también lo usa RAG. Si tu trabajo ya es con LLMs, entra directo a <b>${esc(ents[ents.length - 1].nombre)}</b>: no necesitas haber hecho el otro.${sinListas.length ? ` ${sinListas.map((x) => x.nombre).join(' y ')} todavía no tiene estaciones listas: llegan una por una, y su temario ya está publicado.` : ''}</p>${primera ? `<a class="d-btn" href="${primera.lista.get(primera.primera.id).url}">Empezar: ${esc(primera.nombre)}, estación ${primera.primera.num}</a>` : ''}</div>
</section>

<section class="d-wrap d-sec d-sec-sola" id="como">
  ${titulo('Cómo se usa el dojo', 'igual en los dos entrenamientos')}
  <p class="d-p">Cada estación es un mini-proyecto con su kit. Esta app es la guía y no corre nada: el trabajo pasa en tu Mac, en la carpeta del kit, con una sesión de Claude Code abierta ahí.</p>
  <div class="d-usos">
    ${paso('01', 'Lee antes de tocar', 'En la página de la estación: <strong>el mapa</strong> (dónde estás, qué entra y qué sale), <strong>los precálculos</strong> (las cuentas de servilleta, en el caso de referencia y en el dojo) y <strong>los conceptos exprés</strong>. Se lee en el celular, en un rato libre.')}
    ${paso('02', 'Baja el kit y levanta el mundo', 'Un .zip con una empresa ficticia que ya tiene el problema: sus datos, sus servicios en Docker, un <code>verificar.py</code> que revisa tu trabajo y un <code>romper.py</code> que mete fallas. Cinco comandos y queda arriba.')}
    ${paso('03', 'Haz las cuatro rondas', 'Copia el prompt de la ronda en la página de la estación y pégalo en Claude Code. El <code>CLAUDE.md</code> del kit pone las reglas de fondo, así que Claude sabe cuánto ayudarte en cada una.',
      `<div class="d-rondas d-rondas-uso"><span></span><span class="d-eje">Construir</span><span class="d-eje">Romper</span><span class="d-eje d-eje-v">Con ayuda</span>${ronda(1, 'Construir con ayuda', 'Construyes el proyecto con Claude Code paso a paso. Cada paso explica el concepto que usa.')}${ronda(3, 'Romper con ayuda', 'Un script mete una falla real. La diagnostican juntos: síntoma, hipótesis, prueba, arreglo.')}<span class="d-eje d-eje-v">Solo</span>${ronda(2, 'Construir solo', 'Lo rehaces desde el esqueleto con los objetivos y el verificador. Claude no te da código.')}${ronda(4, 'Romper solo', 'El script esconde la falla, ni Claude la sabe. Tú la encuentras y la arreglas.')}</div>`)}
    ${paso('04', 'Repasa', 'Al final de cada página: el memo de la estación, su trampa, la lista de «listo cuando…» y cómo te lo pueden preguntar en una entrevista.')}
    ${paso('05', 'Lleva tu registro', 'El kit anota tu avance en <code>taller/progreso.json</code>: <code>verificar.py</code> cada corrida, <code>romper.py</code> cada falla con su tiempo y Claude Code el estado de las rondas y tu bitácora. Lo importas en <a href="/tablero/">tu tablero</a>, que se guarda en tu navegador, sin cuenta, con los dos entrenamientos.')}
  </div>
  <div class="d-grid2">
    <div class="d-card"><h3>Qué necesitas</h3><ul class="d-ok-lista"><li>Una Mac con Docker Desktop y unos GB libres</li><li>Python 3.11 o más nuevo</li><li>Claude Code</li></ul><p class="d-nota">Cada estación dice lo suyo en «El kit». Ninguno de los dos entrenamientos necesita rentar GPU.</p></div>
    <div class="d-orden"><h3>En qué orden</h3><p>Dentro de cada entrenamiento, del 1 al 12, que es el orden en que viaja el dato. Cada kit trae su propio mundo, así que una estación corre aunque no hayas terminado la anterior, y puedes llevar los dos entrenamientos a la vez.</p>${primera ? `<a class="d-btn" href="${primera.lista.get(primera.primera.id).url}">Empezar por la estación ${primera.primera.num}: ${esc(primera.primera.titulo)}</a>` : ''}</div>
  </div>
</section>

<section class="d-wrap d-sec d-sec-sola" id="viene">
  ${titulo('Lo que viene', 'más entrenamientos')}
  <div class="d-grid2">
    ${despues.map((r) => `<a class="d-card d-viene" href="/${r.id}/"><span class="d-rama-h"><span class="d-lbl">Entrenamiento · patrón ${esc(r.patron_txt)}</span>${miniT([...new Set(r.estaciones.map((s) => s.etapa))])}</span><h3>${esc(r.entrenamiento || r.nombre)}</h3><p class="d-txt">${esc(r.resumen)}</p><span class="d-nota">${r.estaciones.length} estaciones · caso: ${esc(r.caso.nombre)} · ${r.estaciones.filter((s) => s.donde !== 'mac').length} necesitan GPU rentada</span><span class="d-ir">Ver su temario →</span></a>`).join('')}
    <div class="d-card"><h3>Los otros patrones</h3><p class="d-txt">Cada patrón de sistema de ML cambia solo algunas estaciones del camino, así que llegan como entrenamientos más cortos, después de estos dos.</p><div class="d-mini">${['batch', 'streaming', 'edge', 'asíncrono', 'híbrido'].map((x) => `<span>${x}</span>`).join('')}</div></div>
  </div>
</section>
${pie}`;
}

// La página de clasificación de imágenes (/c01/): qué es C01, su mapa y sus 12 estaciones por etapa de la T.
// mapa: content/mapa-c01.json · hoja: la cheat sheet «Del dato a producción» · sensei: Map num → lección del tronco
export function cuerpoTronco({ tronco, lista, ramas = [], hoja, sensei = new Map() }) {
  const [x, ...otros] = entrenamientos({ tronco, listaTronco: lista, ramas });
  const enlace = (s) => (lista.has(s.id) ? lista.get(s.id).url : `${hoja}#est-${s.id}`);
  const indice = [['c01', 'Qué es C01'], ['mapa', 'El mapa'], ['estaciones', 'Estaciones'], ['otros', 'Otros entrenamientos']];
  const LB = NOMBRE_ETAPA.map((n, i) => [n, rango(i)]);
  return `${barra({ ruta: `/ ${x.nombre}`, indice })}
<div class="d-wrap d-home">
<section class="d-home-hero">
  <a class="d-back" href="/#entrenamientos">← Todos los entrenamientos</a>
  <span class="d-kick">Entrenamiento ${dos(x.n)} · ${esc(x.codigo)}</span>
  <h1>${esc(x.nombre)} <span>de punta a punta</span></h1>
  <p class="d-lead">Un clasificador de fotos, del dato etiquetado al modelo en producción, en las 12 estaciones del mapa «Del dato a producción». Cada estación es un mini-proyecto que corre en tu Mac.</p>
  <div class="d-pips"><div>${pipsDe(x.ests, x.et, lista)}</div><span>${x.listas} de ${x.ests.length} estaciones listas</span></div>
  <div class="d-btns">${x.primera ? `<a class="d-btn" href="${lista.get(x.primera.id).url}">Empezar por la estación ${x.primera.num} →</a>` : ''}<a class="d-btn d-btn2" href="#mapa">Ver el mapa</a><a class="d-btn d-btn2" href="/tablero/">Tu tablero</a></div>
</section>
${bloqueT(LB, 'c01')}

<section class="d-sec" id="c01">
  ${titulo('Qué es C01', 'el caso de referencia')}
  <p class="d-p">C01 es el primer caso del curso: un <strong>marketplace de segunda mano</strong> donde quien vende sube fotos al crear una publicación y el sistema le <strong>sugiere la categoría</strong>. Por dentro es un clasificador de imágenes (una ResNet-50 con 500 categorías) servido con Triton en Kubernetes, que responde unas 10 millones de fotos al día y tiene que contestar el 99 % de las veces en menos de 200 ms.</p>
  ${cifras(x.cifras)}
  <p class="d-p">Recorre las 12 estaciones completas: de las fotos etiquetadas al entrenamiento, del modelo aprobado a la imagen de Docker en el clúster, y de la request en vivo al monitoreo que pide el siguiente modelo. ${otros.length ? `El otro entrenamiento, <a href="${otros[0].url}">${esc(otros[0].nombre)}</a>, cambia casi todas: ahí nada se entrena.` : ''}</p>
  <p class="d-p">En el dojo, cada estación es una versión chica de C01 que corre en tu Mac: los mismos conceptos y las mismas fallas, con otros tamaños. La estación 1, por ejemplo, usa fotos de Fashion-MNIST, 24,000 requests y un S3 local en Docker.</p>
</section>
</div>

<section class="d-wrap d-sec d-sec-sola" id="mapa">
  ${titulo('El mapa del C01', '12 estaciones · 4 tramos')}
  <p class="d-p">Doce estaciones en cuatro tramos: Datos, Modelo, Release y Operación. Entre una estación y la siguiente viaja un artefacto concreto (el snapshot del dataset, el checkpoint, el engine, la imagen de Docker…), y el reentrenamiento cierra el ciclo. La línea lleva los colores de las seis etapas de la T, y cada tramo dice a qué ritmo cambia: el modelo en semanas, el código en días, una request dura milisegundos y el monitoreo no para.</p>
  <div class="d-mapa">
    ${franja('tm-stripe d-mapa-franja')}
    ${metro(tronco.estaciones, enlace, lista)}
    ${metroVertical(tronco.estaciones, enlace, lista)}
  </div>
  <p class="d-nota">Toca una estación: la que ya tiene dojo abre su página; las demás, su explicación en la cheat sheet <a href="${hoja}">«Del dato a producción»</a>, de donde sale este mapa.</p>
</section>

<div class="d-wrap d-home d-home-est">
<section class="d-sec" id="estaciones">
  ${titulo(`Las ${x.ests.length} estaciones`, `agrupadas en la T · ${x.listas} ${x.listas === 1 ? 'lista' : 'listas'}`)}
  <p class="d-p">Las mismas doce, agrupadas en las seis etapas de la T. Las que ya tienen dojo se abren aquí; las demás llevan a su explicación en la cheat sheet mientras llega su mini-proyecto. Debajo de cada una va su lección en Sensei, el curso de teoría desde cero, que explica el porqué de lo que construyes en ella; las doce ya están publicadas.</p>
  <div class="d-etapas">
    ${gruposEtapa(x.ests, x.et, lista, { enlace, sensei })}
  </div>
  <div class="d-reent"><span>↺</span>Reentrenamiento: vuelve a 1 · Datos</div>
</section>
${bloqueT(LB, 'c01-est', 'Pasa el cursor por una etapa de la lista para verla en la T.')}
</div>
${otrosEntrenamientos(otros)}
${pie}`;
}

// Al final de la página de un entrenamiento: los otros y «Cómo se usa», que vive en la portada.
function otrosEntrenamientos(otros) {
  return `<section class="d-wrap d-sec d-sec-sola" id="otros">
  ${titulo('Otros entrenamientos', 'el mismo método')}
  <div class="d-grid2">
    ${otros.map((y) => `<a class="d-card d-viene" href="${y.url}"><span class="d-lbl">Entrenamiento ${dos(y.n)} · ${esc(y.codigo)}</span><h3>${esc(y.nombre)}</h3><p class="d-txt">${esc(y.frase)}</p><span class="d-nota">${y.listas ? `${y.listas} de ${y.ests.length} estaciones listas` : `${y.ests.length} estaciones · próximamente`}</span><span class="d-ir">Ir al entrenamiento →</span></a>`).join('')}
    <a class="d-card d-viene" href="/#como"><span class="d-lbl">¿Primera vez?</span><h3>Cómo se usa el dojo</h3><p class="d-txt">El kit, las cuatro rondas con sus prompts, el repaso y tu registro en el tablero: igual en todos los entrenamientos.</p><span class="d-ir">Leerlo →</span></a>
  </div>
</section>`;
}

// La página de una rama (/<rama>/): su caso, lo que cambia contra clasificación, su mapa (si trae `tramos`) y sus
// estaciones por etapa de la T. Las que no tienen dojo dicen «próximamente».
export function cuerpoRama(r, { tronco, listaTronco, ramas }) {
  const ents = entrenamientos({ tronco, listaTronco, ramas });
  const x = ents.find((y) => y.id === r.id) || { n: null, id: r.id, url: `/${r.id}/`, nombre: r.entrenamiento || r.nombre, codigo: r.caso.codigo || '', caso: r.caso.nombre,
    ests: r.estaciones, et: (s) => IDS.indexOf(s.etapa), lista: r.lista, primera: r.estaciones.find((s) => r.lista.has(s.id)) || null, listas: r.estaciones.filter((s) => r.lista.has(s.id)).length };
  const otros = ents.filter((y) => y.id !== r.id);
  const lista = r.lista, et = x.et;
  const enlace = (s) => (lista.has(s.id) ? lista.get(s.id).url : `#est-${r.id}-${s.id}`);
  const LB = NOMBRE_ETAPA.map((n, i) => { const ns = numsDe(r.estaciones, et, i); return ns.length ? [n, enEtapa(ns)] : null; });
  const conMapa = r.tramos && r.estaciones.length === 12;
  const mapa = { et, tramos: r.tramos || [], centro: `${x.codigo ? x.codigo + ' · ' : ''}${r.caso.nombre}`.toUpperCase(), lazo: r.lazo ? r.lazo.corto : 'reentrenamiento',
    lazoLargo: r.lazo ? r.lazo.largo : '', pendiente: 'en camino', aria: `Mapa de ${x.nombre}: ${r.estaciones.length} estaciones en un anillo, de Datos a Monitoreo` };
  const kick = x.n ? `Entrenamiento ${dos(x.n)} · ${x.codigo || r.patron_txt}` : `Próximamente · patrón ${r.patron_txt}`;
  const indice = [['caso', `Qué es ${x.codigo || 'el caso'}`], ...(conMapa ? [['mapa', 'El mapa']] : []), ['estaciones', 'Estaciones'], ['otros', 'Otros entrenamientos']];
  return `${barra({ ruta: `/ ${x.nombre}`, indice })}
<div class="d-wrap d-home">
<section class="d-home-hero">
  <a class="d-back" href="/#entrenamientos">← Todos los entrenamientos</a>
  <span class="d-kick">${esc(kick)}</span>
  <h1>${esc(x.nombre)} <span>${x.n ? 'de punta a punta' : 'en hardware propio'}</span></h1>
  <p class="d-lead">${esc(r.resumen)}</p>
  <div class="d-pips"><div style="grid-template-columns:repeat(${r.estaciones.length}, minmax(0, 1fr))">${pipsDe(r.estaciones, et, lista)}</div><span>${x.listas ? `${x.listas} de ${r.estaciones.length} estaciones listas` : `${r.estaciones.length} estaciones · el temario, mientras llegan sus kits`}</span></div>
  <div class="d-btns">${x.primera ? `<a class="d-btn" href="${lista.get(x.primera.id).url}">Empezar por la estación ${x.primera.num} →</a>` : `<a class="d-btn" href="#estaciones">Ver el temario</a>`}${conMapa ? '<a class="d-btn d-btn2" href="#mapa">Ver el mapa</a>' : ''}<a class="d-btn d-btn2" href="/tablero/">Tu tablero</a></div>
</section>
${bloqueT(LB, `rama-${r.id}`)}

<section class="d-sec" id="caso">
  ${titulo(`Qué es ${x.codigo || 'el caso'}`, 'el caso de referencia')}
  <p class="d-p"><strong>${esc(r.caso.nombre)}.</strong> ${esc(r.caso.resumen)}</p>
  ${r.cifras ? cifras(r.cifras) : ''}
  ${r.cambia ? `<div class="d-card d-cambia"><h3>Lo que cambia contra clasificación de imágenes</h3><ul>${r.cambia.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
  ${r.sin_gpu ? `<div class="d-rama-sin"><span class="d-lbl">Sin rentar GPU</span><div class="d-rama-ruta">${r.sin_gpu.estaciones.map((n) => `<b>${n}</b>`).join('<i aria-hidden="true">→</i>')}</div><p class="d-txt">${esc(r.sin_gpu.texto)}</p></div>` : ''}
  <p class="d-nota">En cada estación, las cuentas de servilleta van en dos escalas: «${esc(r.escala)}» y «En el dojo».</p>
</section>
</div>

${conMapa ? `<section class="d-wrap d-sec d-sec-sola" id="mapa">
  ${titulo(`El mapa de ${x.nombre}`, `${r.estaciones.length} estaciones · ${r.tramos.length} tramos`)}
  <p class="d-p">${r.estaciones.length} estaciones en ${r.tramos.length} tramos: ${r.tramos.map((t) => `«${t[2]}»`).join(', ').replace(/, ([^,]*)$/, ' y $1')}. La línea lleva los colores de las seis etapas de la T, y cada tramo dice a qué ritmo cambia. ${r.lazo ? 'El lazo no es un reentrenamiento: se cierra con cambios de chunking, prompt o índice que pasan el mismo gate.' : ''}</p>
  <div class="d-mapa">
    ${franja('tm-stripe d-mapa-franja')}
    ${metro(r.estaciones, enlace, lista, mapa)}
    ${metroVertical(r.estaciones, enlace, lista, mapa)}
  </div>
  <p class="d-nota">Pasa el cursor por una estación para ver qué sale de ella. Las que ya tienen dojo abren su página.</p>
</section>` : ''}

<div class="d-wrap d-home d-home-est">
<section class="d-sec" id="estaciones">
  ${titulo(`Las ${r.estaciones.length} estaciones`, `agrupadas en la T · ${x.listas ? `${x.listas} ${x.listas === 1 ? 'lista' : 'listas'}` : 'temario'}`)}
  <p class="d-p">${x.listas ? 'Las que ya tienen dojo se abren aquí; las demás dicen qué sale de ellas mientras llega su mini-proyecto.' : 'El temario: qué sale de cada estación y en qué etapa de la T cae. Cada una llega con su kit, sus cuatro rondas y su lugar en tu tablero, igual que las de clasificación.'} Todas corren ${r.estaciones.every((s) => s.donde === 'mac') ? 'en tu Mac' : 'en tu Mac, salvo las que dicen GPU rentada'}.</p>
  <div class="d-etapas">
    ${gruposEtapa(r.estaciones, et, lista, { enlace, rama: r.id })}
  </div>
</section>
${bloqueT(LB, `rama-${r.id}-est`, 'Pasa el cursor por una etapa de la lista para verla en la T.')}
</div>
${otrosEntrenamientos(otros)}
${pie}`;
}

// Para «Tu tablero» (tools/tablero.mjs): la misma barra, títulos y pie que el resto del Dojo.
export { barra, titulo, pie, etapa, COLOR_ETAPA, NOMBRE_ETAPA };
