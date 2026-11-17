// «Tu tablero»: la plantilla del Dojo (qué estaciones tienen taller, sus pasos, objetivos y fallas) y el esqueleto de
// la página /tablero/. Lo que cambia con tu avance lo dibuja site/tablero/tablero.mjs en el navegador, desde el
// tablero guardado en localStorage (site/tablero/almacen.mjs).
import { marca } from '../vendor/trueml/lib.mjs';
import { esc, barra, titulo, pie, COLOR_ETAPA, NOMBRE_ETAPA } from './dojo.mjs';
import { RONDAS } from '../site/tablero/modelo.mjs';

const ETAPA_ID = ['datos', 'modelo', 'api', 'contenedor', 'orquestacion', 'monitoreo'];
const sinHtml = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// estaciones: las del build (ya validadas y puestas en su línea con tools/lineas.mjs: slug, url, kitUrl, linea, etapaIdx)
// lineas: LINEAS de tools/lineas.mjs (el tronco primero y después cada rama). Cada estación lleva el grupo de su línea:
// el tablero las dibuja agrupadas, el tronco arriba y cada rama debajo. El id de cada estación en el documento es su
// slug (c01-datos, ia-privada-rag), así que un tablero de antes sigue sirviendo tal cual: migrar() solo suma.
export function plantillaTablero(estaciones, lineas) {
  const orden = [...lineas.keys()];
  const conTaller = estaciones.filter((e) => lineas.has(e.linea.id)).sort((a, b) => orden.indexOf(a.linea.id) - orden.indexOf(b.linea.id) || a.num - b.num);
  const slugs = new Set(conTaller.map((e) => e.slug));
  const ref = (l, num) => (l.tipo === 'rama' ? `estación ${num} de ${l.corto}` : `estación ${num}`);
  return {
    grupos: [...lineas.values()].map((l) => ({ id: l.id, tipo: l.tipo, nombre: l.tipo === 'rama' ? `Rama ${l.corto}` : `Tronco · ${l.corto}`, total: l.total })),
    estaciones: conTaller.map((e) => ({
      id: e.slug, grupo: e.linea.id, rama: e.linea.tipo === 'rama' ? e.linea.corto : null, ref: ref(e.linea, e.num), num: e.num, titulo: e.titulo,
      etapa: ETAPA_ID[e.etapaIdx], color: COLOR_ETAPA[e.etapaIdx], nombreEtapa: NOMBRE_ETAPA[e.etapaIdx],
      url: e.url, rondasUrl: `${e.kitUrl}#rondas`, python: e.mundo.python || 'python',
      pasos: e.guiado.map((p) => ({ id: p.id, n: p.n, titulo: p.titulo })),
      objetivos: e.solo.objetivos.map((o) => ({ n: o.n, check: o.check, objetivo: sinHtml(o.objetivo) })),
      fallas: e.fallas.map((f) => ({ id: f.id, titulo: f.titulo })),
    })),
    proximas: [...lineas.values()].flatMap((l) => l.estaciones.filter((s) => !slugs.has(`${l.id}-${s.id}`))
      .map((s) => ({ grupo: l.id, num: s.num, titulo: s.titulo, etapa: ETAPA_ID[s.etapa], color: COLOR_ETAPA[s.etapa] }))),
  };
}

export function cuerpoTablero(plantilla) {
  const indice = [['como', 'Cómo funciona'], ['estaciones', 'Estaciones'], ['importar', 'Importar'], ['respaldo', 'Respaldo']];
  // La T: solo las etapas que ya tienen taller llevan etiqueta; el navegador las enciende con lo que vas haciendo.
  const LB = ETAPA_ID.map((id) => {
    const es = plantilla.estaciones.filter((e) => e.etapa === id);
    const corto = new Map(plantilla.grupos.filter((g) => g.tipo === 'rama').map((g) => [g.id, g.nombre.replace(/^Rama /, '')]));
    return es.length ? [NOMBRE_ETAPA[ETAPA_ID.indexOf(id)], es.map((e) => `${corto.has(e.grupo) ? corto.get(e.grupo) + ' ' : ''}${e.num} · ${e.titulo}`).join(' · ')] : null;
  });
  const t = marca({ etiquetas: LB, encender: [], dim: 0.16, maxAltura: '440px', clave: 'tablero' });
  const ronda = (r, i) => `<div class="d-uso-r" style="--o:${i}"><span><i>${i + 1} </i>${esc(r.nombre)}</span><span>${esc(r.hace)}</span></div>`;
  const R = RONDAS;
  const datos = JSON.stringify(plantilla).replace(/</g, '\\u003c');

  return `${barra({ ruta: 'Tu tablero', volver: '/', indice })}
<section class="d-wrap d-hero t-hero">
  <div class="d-hero-txt">
    <a class="d-back" href="/">← Dojo</a>
    <span class="d-pill">Tu tablero</span>
    <h1>Tu avance en el dojo</h1>
    <p class="d-lead">Aquí ves qué rondas llevas en cada estación, qué fallas arreglaste y cuánto tardaste, y tu bitácora. Todo se guarda en este navegador: no necesitas cuenta y funciona sin conexión.</p>
    <div class="d-stats t-stats" id="t-stats" style="--n:4">
      <a href="#estaciones"><b data-stat="rondas">0/${plantilla.estaciones.length * 4}</b><span>rondas hechas</span></a>
      <a href="#estaciones"><b data-stat="fallas">0</b><span>fallas arregladas</span></a>
      <a href="#estaciones"><b data-stat="bitacora">0</b><span>notas en la bitácora</span></a>
      <a href="#importar"><b data-stat="ultima">—</b><span>último avance</span></a>
    </div>
    <div class="d-btns"><a class="d-btn" href="#importar">Importar progreso.json</a><a class="d-btn d-btn2" href="#estaciones">Ver las estaciones</a></div>
  </div>
  <div class="d-hero-mark t-marca" id="t-marca" role="img" aria-label="La T de TrueML: cada etapa se enciende con las rondas que terminas en sus estaciones">${t}</div>
</section>

<section class="d-wrap d-sec d-sec-sola" id="como">
  ${titulo('Cómo funciona', 'sin cuenta')}
  <p class="d-p">Cada estación del dojo es un <b>mini-proyecto</b>: una versión chica de un sistema de ML que armas en tu Mac con un kit. Una <b>ronda</b> es una vuelta completa a ese mini-proyecto. Cada estación se hace en cuatro rondas, cada una con menos ayuda que la anterior:</p>
  <div class="d-rondas d-rondas-uso t-orden"><span></span><span class="d-eje">Construir</span><span class="d-eje">Romper</span><span class="d-eje d-eje-v">Con ayuda</span>${ronda(R[0], 0)}${ronda(R[2], 2)}<span class="d-eje d-eje-v">Solo</span>${ronda(R[1], 1)}${ronda(R[3], 3)}</div>
  <div class="d-grid2">
    <div class="d-card"><h3>Qué guarda</h3><p class="d-txt">Por estación: el <b>estado</b> de cada ronda (pendiente, en curso o hecha) con la fecha y hora en que empezó y terminó; las <b>fallas</b> que arreglaste, con los minutos y las pistas que usaste; y la <b>bitácora</b>, tus notas de qué hiciste, qué mediste y qué sigue.</p></div>
    <div class="d-card"><h3>De dónde sale</h3><p class="d-txt">El kit de cada estación trae un archivo, <code>taller/progreso.json</code>. Ahí anotan tu avance <code>verificar.py</code> (cada vez que lo corres), <code>romper.py</code> (cada falla que cierras, con su tiempo real) y Claude Code (el estado de las rondas y la bitácora). Lo importas aquí y el tablero se marca solo. También puedes cambiar cualquier ronda a mano.</p></div>
    <div class="d-card"><h3>Dónde vive</h3><p class="d-txt">En este navegador, y en ningún otro lado: nada se manda a un servidor. Por eso cada dispositivo tiene su propio tablero. Para pasarlo de la Mac al celular, o para no perderlo si borras los datos del navegador, usa <a href="#respaldo">Respaldo</a>.</p></div>
    <div class="d-card"><h3>El Guiado y Solo</h3><p class="d-txt">En la página de cada estación, el paso a paso se llama <b>Guiado</b> y la lista de objetivos sin código se llama <b>Solo</b>. Son el material de Construir con ayuda y de Construir solo; en el <code>progreso.json</code> del kit, esas dos rondas se guardan como <code>guiado</code> y <code>solo</code>.</p></div>
  </div>
</section>

<section class="d-wrap d-sec d-sec-sola" id="estaciones">
  ${titulo('Estaciones', `${plantilla.estaciones.length} con taller · ${plantilla.proximas.length} próximamente`)}
  <p class="d-p">Toca el estado de una ronda para cambiarlo: la hora de inicio y de fin se anotan solas. Abajo de cada estación están los objetivos de Construir solo (con el resultado de tu último <code>verificar.py</code>), tus fallas y tu bitácora. Las estaciones van agrupadas: primero el tronco C01 y después cada rama.</p>
  <p class="d-nota t-aviso" id="t-aviso" hidden></p>
  <div class="t-ests" id="t-estaciones"><noscript><p class="d-p">Tu tablero necesita JavaScript: guarda y dibuja tu avance en este navegador.</p></noscript></div>
  <div class="d-card t-prox">
    <h3>Próximamente</h3>
    <p class="d-txt">Estas estaciones todavía no tienen kit. Cuando llegue el suyo, aparecen arriba en su grupo, con sus cuatro rondas, sin que pierdas nada de lo que ya llevas.</p>
    ${plantilla.grupos.map((g) => { const ps = plantilla.proximas.filter((s) => s.grupo === g.id); return ps.length ? `<div class="t-prox-g"><span class="d-lbl">${esc(g.nombre)}</span>
    <div class="t-prox-l">${ps.map((s) => `<span style="--c:${s.color}"><b>${s.num}</b>${esc(s.titulo)}</span>`).join('')}</div></div>` : ''; }).join('\n    ')}
  </div>
</section>

<section class="d-wrap d-sec d-sec-sola" id="importar">
  ${titulo('Importar', 'taller/progreso.json')}
  <p class="d-p">Elige el <code>taller/progreso.json</code> de la carpeta de tu kit, o pega su contenido. Puedes importarlo cuantas veces quieras: lo que ya estaba no se duplica, solo entra lo nuevo.</p>
  <div class="d-grid2">
    <div class="d-card t-form">
      <h3>Desde un archivo</h3>
      <p class="d-txt">En la Mac, el archivo está en la carpeta del kit, dentro de <code>taller/</code>. En el celular o la tablet, pásalo primero (por AirDrop o iCloud Drive) y elígelo aquí.</p>
      <label class="t-file"><input type="file" id="t-archivo" accept=".json,application/json"><span class="d-btn">Elegir el archivo</span></label>
    </div>
    <div class="d-card t-form">
      <h3>Pegando el texto</h3>
      <p class="d-txt">Pídele a Claude Code «muéstrame taller/progreso.json», copia lo que imprime y pégalo aquí.</p>
      <label class="t-campo"><span class="d-lbl">Contenido del JSON</span><textarea id="t-pegado" rows="5" spellcheck="false" placeholder='{ "estacion": "c01-datos", … }'></textarea></label>
      <button type="button" class="d-btn d-btn2" id="t-importar-pegado">Importar lo pegado</button>
    </div>
  </div>
  <div class="d-card t-res" id="t-res" hidden aria-live="polite"></div>
  <details class="d-card t-hist" id="t-hist"><summary><span class="d-lbl">Importaciones anteriores</span></summary><ul id="t-hist-l"></ul></details>
</section>

<section class="d-wrap d-sec d-sec-sola" id="respaldo">
  ${titulo('Respaldo', 'todo tu tablero en un archivo')}
  <p class="d-p">Tu tablero completo es un solo archivo JSON, con la fecha y hora de cada avance. Descárgalo para guardarlo o para abrirlo en otro dispositivo: ahí lo importas arriba, igual que un <code>progreso.json</code>, y reemplaza al tablero de ese dispositivo.</p>
  <div class="d-btns"><button type="button" class="d-btn" id="t-exportar">Descargar el respaldo</button><button type="button" class="d-btn d-btn2" id="t-borrar">Borrar mi tablero</button></div>
  <p class="d-nota">Borrar deja todas las rondas en pendiente y vacía la bitácora y las fallas de este navegador. No toca los archivos de tus kits.</p>
</section>
${pie}
<script type="application/json" id="t-plantilla">${datos}</script>
<script type="module" src="/tablero/tablero.mjs"></script>`;
}
