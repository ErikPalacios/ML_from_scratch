/* «Tu tablero» en el navegador: dibuja las estaciones con su avance y manda cada cambio al almacén (almacen.mjs),
   que lo aplica con el motor del tablero y lo guarda en localStorage. La plantilla (estaciones, pasos, objetivos y
   fallas) viene en la página, en #t-plantilla. */
import { RONDAS, RONDA, ESTADOS, ESTADO_TXT, opsDeProgreso, opsEstado, resumenEstacion, queEs, nuevoId, APP } from './modelo.mjs';
import { crearAlmacen } from './almacen.mjs';

const P = JSON.parse(document.getElementById('t-plantilla').textContent);
const PE = new Map(P.estaciones.map((e) => [e.id, e]));
const almacen = crearAlmacen(P);
let T = almacen.leer();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- fechas en la hora de quien mira
const FMT = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const FMT_CORTA = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
const cuando = (iso) => (iso ? FMT.format(new Date(iso)) : '');
const corta = (iso) => (iso ? FMT_CORTA.format(new Date(iso)) : '—');
const min = (m) => (m < 1 ? 'menos de 1 min' : m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);

// ---------------------------------------------------------------- avisos
const toast = document.querySelector('.d-toast');
let tToast;
function avisar(txt) {
  if (!toast) return;
  toast.textContent = txt; toast.classList.add('on');
  clearTimeout(tToast); tToast = setTimeout(() => toast.classList.remove('on'), 2200);
}

function cambiar(ops, ok) {
  if (!ops.length) return true;
  const r = almacen.cambiar(ops);
  T = r.tablero;
  pintar();
  if (r.rechazadas.length) { avisar('No se pudo guardar un cambio'); console.warn('[tablero] rechazadas', r.rechazadas); return false; }
  if (ok) avisar(ok);
  return true;
}

// ---------------------------------------------------------------- dibujar
function ronda(e, r) {
  const pe = PE.get(e.id);
  const extra = [];
  if (r.inicio) extra.push(`Empezó ${cuando(r.inicio)}`);
  if (r.fin) extra.push(`Terminó ${cuando(r.fin)}`);
  if (r.id === 'construir-solo' && r.pistas) extra.push(`${r.pistas} ${r.pistas === 1 ? 'pista' : 'pistas'}`);
  if (r.id.startsWith('romper')) {
    const fs = e.fallas.filter((f) => f.ronda === r.id);
    if (fs.length) extra.push(`${fs.length} ${fs.length === 1 ? 'falla' : 'fallas'}`);
  }
  return `<div class="t-ronda" data-estado="${r.estado}" style="--o:${RONDAS.findIndex((x) => x.id === r.id)}">
    <span class="t-ronda-t">${esc(RONDA[r.id].nombre)}</span>
    <span class="t-ronda-d">${esc(RONDA[r.id].hace)}</span>
    <div class="t-seg" role="group" aria-label="Estado de ${esc(RONDA[r.id].nombre)} en la estación ${pe.num}">${ESTADOS.map((s) =>
      `<button type="button" data-acc="estado" data-est="${e.id}" data-ronda="${r.id}" data-valor="${s}" aria-pressed="${r.estado === s}">${ESTADO_TXT[s]}</button>`).join('')}</div>
    ${extra.length ? `<span class="t-ronda-f">${esc(extra.join(' · '))}</span>` : ''}
  </div>`;
}

function objetivos(e, pe) {
  // el último resultado de cada check: verificar.py se puede correr con uno solo (python verificar.py deps)
  const ultimo = new Map();
  for (const x of [...e.verificaciones].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    x.pasan.forEach((c) => ultimo.set(c, true));
    x.fallan.forEach((c) => ultimo.set(c, false));
  }
  const v = e.verificaciones.length ? e.verificaciones.reduce((a, b) => (b.fecha > a.fecha ? b : a)) : null;
  const pasan = new Set([...ultimo].filter(([, ok]) => ok).map(([c]) => c)), fallan = new Set([...ultimo].filter(([, ok]) => !ok).map(([c]) => c));
  const n = pe.objetivos.filter((o) => pasan.has(o.check)).length;
  const items = pe.objetivos.map((o) => {
    const s = pasan.has(o.check) ? 'ok' : fallan.has(o.check) ? 'mal' : 'nada';
    return `<li class="t-obj t-obj-${s}"><span class="t-obj-m" aria-hidden="true">${s === 'ok' ? '✓' : s === 'mal' ? '✗' : '·'}</span><span>${esc(o.objetivo)} <code>${esc(o.check)}</code></span><span class="sr">${s === 'ok' ? 'pasa' : s === 'mal' ? 'no pasa' : 'sin correr'}</span></li>`;
  }).join('');
  return `<details class="t-det" data-id="obj-${e.id}"><summary><span>Objetivos de Construir solo</span><span class="t-det-n">${v ? `${n}/${pe.objetivos.length} en verde · ${corta(v.fecha)}` : 'sin verificar'}</span></summary>
    <div class="t-det-b">
      <p class="d-nota">${v ? `El último resultado de cada objetivo en tus corridas de <code>${esc(pe.python)} verificar.py</code>; la más reciente fue el ${esc(cuando(v.fecha))}.` : `Cuando corras <code>${esc(pe.python)} verificar.py</code> en el kit e importes <code>taller/progreso.json</code>, aquí aparece qué objetivo pasa y cuál no.`}</p>
      <ol class="t-objs">${items}</ol>
    </div></details>`;
}

const opcion = (v, t, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(t)}</option>`;

function fallas(e, pe) {
  const titulo = new Map(pe.fallas.map((f) => [f.id, f.titulo]));
  const lista = [...e.fallas].sort((a, b) => ((b.fin || b.inicio || '') > (a.fin || a.inicio || '') ? 1 : -1)).map((f) => `<li class="t-item">
      <div class="t-item-h"><b>${esc(titulo.get(f.falla) || f.falla)}</b><span class="t-tag${f.rendido ? ' t-tag-r' : ''}">${f.rendido ? 'me rendí' : 'arreglada'}</span></div>
      <span class="t-item-m">${esc(RONDA[f.ronda].nombre)} · ${f.minutos ? esc(min(f.minutos)) : 'sin tiempo'} · ${f.pistas} ${f.pistas === 1 ? 'pista' : 'pistas'}${f.fin || f.inicio ? ` · ${esc(cuando(f.fin || f.inicio))}` : ''}${f.origen === 'kit' ? ' · de romper.py' : ''}</span>
      ${f.aprendi ? `<p class="t-item-t"><b>Aprendí:</b> ${esc(f.aprendi)}</p>` : ''}
      <button type="button" class="t-quitar" data-acc="quitar" data-est="${e.id}" data-lista="fallas" data-item="${f.id}">Quitar</button>
    </li>`).join('');
  return `<details class="t-det" data-id="fallas-${e.id}"><summary><span>Fallas</span><span class="t-det-n">${e.fallas.length ? `${e.fallas.filter((f) => !f.rendido).length} de ${e.fallas.length} ${e.fallas.length === 1 ? 'arreglada' : 'arregladas'}` : 'ninguna todavía'}</span></summary>
    <div class="t-det-b">
      <p class="d-nota">Una <b>falla</b> es un problema real que <code>romper.py</code> mete en el kit para que lo diagnostiques. Al cerrarla, <code>romper.py</code> anota en <code>progreso.json</code> cuál era y cuánto tardaste; aquí también puedes anotarla a mano.</p>
      ${lista ? `<ul class="t-items">${lista}</ul>` : ''}
      <form class="t-add" data-acc="falla" data-est="${e.id}">
        <span class="d-lbl">Anotar una falla</span>
        <div class="t-fila">
          <label class="t-campo"><span>Ronda</span><select name="ronda">${opcion('romper-con-ayuda', 'Romper con ayuda')}${opcion('romper-solo', 'Romper solo')}</select></label>
          <label class="t-campo"><span>Falla</span><select name="falla">${pe.fallas.map((f) => opcion(f.id, f.titulo)).join('')}</select></label>
        </div>
        <div class="t-fila">
          <label class="t-campo t-corto"><span>Minutos</span><input name="minutos" type="number" min="0" max="100000" step="1" inputmode="numeric" value="0"></label>
          <label class="t-campo t-corto"><span>Pistas</span><input name="pistas" type="number" min="0" max="999" step="1" inputmode="numeric" value="0"></label>
          <label class="t-check"><input name="rendido" type="checkbox"> Me rendí (usé <code>--revelar</code>)</label>
        </div>
        <label class="t-campo"><span>Qué aprendí</span><textarea name="aprendi" rows="2" maxlength="4000"></textarea></label>
        <button type="submit" class="d-btn d-btn2">Anotar la falla</button>
      </form>
    </div></details>`;
}

function bitacora(e, pe) {
  const paso = new Map(pe.pasos.map((p) => [p.id, `paso ${p.n} · ${p.titulo}`]));
  const lista = [...e.bitacora].sort((a, b) => (b.fecha > a.fecha ? 1 : -1)).map((b) => `<li class="t-item">
      <div class="t-item-h"><b>${esc(cuando(b.fecha))}</b><span class="t-item-m">${esc(RONDA[b.ronda].nombre)}${b.paso ? ` · ${esc(paso.get(b.paso) || b.paso)}` : ''}</span></div>
      ${b.hice ? `<p class="t-item-t"><b>Hice:</b> ${esc(b.hice)}</p>` : ''}${b.medi ? `<p class="t-item-t"><b>Medí:</b> ${esc(b.medi)}</p>` : ''}${b.sigue ? `<p class="t-item-t"><b>Sigue:</b> ${esc(b.sigue)}</p>` : ''}
      <button type="button" class="t-quitar" data-acc="quitar" data-est="${e.id}" data-lista="bitacora" data-item="${b.id}">Quitar</button>
    </li>`).join('');
  return `<details class="t-det" data-id="bit-${e.id}"><summary><span>Bitácora</span><span class="t-det-n">${e.bitacora.length ? `${e.bitacora.length} ${e.bitacora.length === 1 ? 'nota' : 'notas'}` : 'vacía'}</span></summary>
    <div class="t-det-b">
      <p class="d-nota">La <b>bitácora</b> es tu diario del proyecto: qué hiciste, qué números salieron y qué sigue. Claude Code la escribe en <code>BITACORA.md</code> y en <code>progreso.json</code> al cerrar cada paso.</p>
      ${lista ? `<ul class="t-items">${lista}</ul>` : ''}
      <form class="t-add" data-acc="nota" data-est="${e.id}">
        <span class="d-lbl">Agregar una nota</span>
        <div class="t-fila">
          <label class="t-campo"><span>Ronda</span><select name="ronda">${RONDAS.map((r) => opcion(r.id, r.nombre)).join('')}</select></label>
          <label class="t-campo"><span>Paso</span><select name="paso">${opcion('', 'Ninguno en especial')}${pe.pasos.map((p) => opcion(p.id, `${p.n} · ${p.titulo}`)).join('')}</select></label>
        </div>
        <label class="t-campo"><span>Hice</span><textarea name="hice" rows="2" maxlength="4000"></textarea></label>
        <label class="t-campo"><span>Medí</span><textarea name="medi" rows="2" maxlength="4000"></textarea></label>
        <label class="t-campo"><span>Sigue</span><textarea name="sigue" rows="2" maxlength="4000"></textarea></label>
        <button type="submit" class="d-btn d-btn2">Agregar a la bitácora</button>
      </form>
    </div></details>`;
}

function estacion(e) {
  const pe = PE.get(e.id);
  if (!pe) return '';
  const s = resumenEstacion(e);
  const por = (id) => e.rondas.find((r) => r.id === id);
  return `<article class="d-card t-est" id="est-${e.id}" style="--c:${pe.color}">
    <header class="t-est-h">
      <span class="t-num">${pe.num}</span>
      <div class="t-est-t"><h3>${esc(pe.titulo)}</h3><span class="d-lbl">Etapa ${esc(pe.nombreEtapa)} · ${s.hechas} de 4 rondas hechas${s.ultima ? ` · ${esc(corta(s.ultima))}` : ''}</span></div>
      <a class="t-est-a" href="${esc(pe.url)}">Abrir la estación →</a>
    </header>
    <div class="t-pips" aria-hidden="true">${e.rondas.map((r) => `<i data-estado="${r.estado}"></i>`).join('')}</div>
    <div class="t-rondas">
      <span></span><span class="d-eje">Construir</span><span class="d-eje">Romper</span>
      <span class="d-eje d-eje-v">Con ayuda</span>${ronda(e, por('construir-con-ayuda'))}${ronda(e, por('romper-con-ayuda'))}
      <span class="d-eje d-eje-v">Solo</span>${ronda(e, por('construir-solo'))}${ronda(e, por('romper-solo'))}
    </div>
    <p class="d-nota">Los prompts de cada ronda están en <a href="${esc(pe.rondasUrl)}">la página del proyecto</a>.</p>
    ${objetivos(e, pe)}
    ${fallas(e, pe)}
    ${bitacora(e, pe)}
  </article>`;
}

// La T: cada etapa con taller se enciende según la parte de sus rondas que ya está hecha.
function encenderT() {
  const svg = document.querySelector('#t-marca svg');
  if (!svg) return;
  const etapas = {};
  for (const e of T.estaciones) {
    const pe = PE.get(e.id);
    if (!pe) continue;
    const x = etapas[pe.etapa] || (etapas[pe.etapa] = { hechas: 0, total: 0 });
    x.hechas += e.rondas.filter((r) => r.estado === 'hecha').length + e.rondas.filter((r) => r.estado === 'en_curso').length * 0.25;
    x.total += 4;
  }
  svg.querySelectorAll('[data-stage]').forEach((g) => {
    const x = etapas[g.getAttribute('data-stage')];
    const f = x ? x.hechas / x.total : 0;
    const label = g.getAttribute('data-kind') === 'label';
    g.style.transition = 'opacity .4s ease';
    g.style.opacity = label ? (x ? '1' : g.getAttribute('data-dim')) : String(0.16 + 0.84 * f);
  });
}

function pintar() {
  const abiertos = new Set([...document.querySelectorAll('#t-estaciones details[open]')].map((d) => d.dataset.id));
  $('t-estaciones').innerHTML = T.estaciones.filter((e) => PE.has(e.id)).sort((a, b) => PE.get(a.id).num - PE.get(b.id).num).map(estacion).join('');
  abiertos.forEach((id) => { const d = document.querySelector(`#t-estaciones details[data-id="${id}"]`); if (d) d.open = true; });
  const todas = T.estaciones.filter((e) => PE.has(e.id));
  const st = (k, v) => { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
  st('rondas', `${todas.reduce((n, e) => n + e.rondas.filter((r) => r.estado === 'hecha').length, 0)}/${todas.length * 4}`);
  st('fallas', String(todas.reduce((n, e) => n + e.fallas.filter((f) => !f.rendido).length, 0)));
  st('bitacora', String(todas.reduce((n, e) => n + e.bitacora.length, 0)));
  const ultima = todas.map((e) => resumenEstacion(e).ultima).filter(Boolean).sort().pop();
  st('ultima', ultima ? corta(ultima) : '—');
  encenderT();
  const h = $('t-hist-l');
  $('t-hist').hidden = !T.importaciones.length;
  h.innerHTML = T.importaciones.map((i) => `<li>${esc(cuando(i.fecha))} · estación ${PE.get(i.estacion) ? PE.get(i.estacion).num : esc(i.estacion)} · ${i.nuevas} ${i.nuevas === 1 ? 'cosa nueva' : 'cosas nuevas'}, ${i.cambios} ${i.cambios === 1 ? 'cambio' : 'cambios'}</li>`).join('');
}

// ---------------------------------------------------------------- importar
function mostrar(html, tipo) {
  const r = $('t-res');
  r.hidden = false;
  r.className = `d-card t-res t-res-${tipo}`;
  r.innerHTML = html;
}

export function importarTexto(texto) {
  let x;
  try { x = JSON.parse(texto); } catch (err) {
    mostrar(`<h3>No es un JSON válido</h3><p class="d-txt">${esc(err.message)}. Revisa que copiaste el archivo completo, de la primera <code>{</code> a la última <code>}</code>.</p>`, 'mal');
    return false;
  }
  const tipo = queEs(x);
  if (tipo === 'respaldo' || tipo === 'tablero') {
    if (!window.confirm('Este archivo es un respaldo completo del tablero. ¿Reemplazar el tablero de este navegador con él?')) return false;
    try { T = almacen.reemplazar(tipo === 'respaldo' ? x.tablero : x); } catch (err) { mostrar(`<h3>No se pudo restaurar</h3><p class="d-txt">${esc(err.message)}</p>`, 'mal'); return false; }
    pintar();
    mostrar('<h3>Respaldo restaurado</h3><p class="d-txt">Tu tablero quedó como en el archivo.</p>', 'ok');
    avisar('Respaldo restaurado');
    return true;
  }
  let r;
  try { r = opsDeProgreso(T, x, P); } catch (err) { mostrar(`<h3>No se pudo importar</h3><p class="d-txt">${esc(err.message)}</p>`, 'mal'); return false; }
  const pe = PE.get(r.estacion);
  const avisos = r.avisos.length ? `<p class="d-nota">Ojo: ${r.avisos.map(esc).join('; ')}.</p>` : '';
  if (!r.ops.length) {
    mostrar(`<h3>Nada nuevo</h3><p class="d-txt">Tu tablero ya tenía todo lo de este <code>progreso.json</code> de la estación ${pe.num}, ${esc(pe.titulo)}.</p>${avisos}`, 'ok');
    return true;
  }
  if (!cambiar(r.ops)) { mostrar('<h3>No se pudo importar</h3><p class="d-txt">El archivo tiene algo que el tablero no acepta. Revisa que el JSON siga el formato del <code>CLAUDE.md</code> del kit.</p>', 'mal'); return false; }
  const e = T.estaciones.find((y) => y.id === r.estacion);
  const estados = e.rondas.map((y) => `<li><b>${esc(RONDA[y.id].nombre)}:</b> ${ESTADO_TXT[y.estado].toLowerCase()}</li>`).join('');
  mostrar(`<h3>Listo: estación ${pe.num}, ${esc(pe.titulo)}</h3><p class="d-txt">Entraron ${r.nuevas} ${r.nuevas === 1 ? 'cosa nueva' : 'cosas nuevas'} y hubo ${r.cambios} ${r.cambios === 1 ? 'cambio' : 'cambios'}. Así quedaron las rondas:</p><ul class="t-res-l">${estados}</ul>${avisos}<p class="d-nota"><a href="#est-${esc(r.estacion)}">Ver la estación en el tablero ↑</a></p>`, 'ok');
  avisar('Progreso importado');
  return true;
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', (ev) => {
  const b = ev.target.closest && ev.target.closest('[data-acc]');
  if (!b || b.tagName === 'FORM') return;
  if (b.dataset.acc === 'estado') {
    const { est, ronda: r, valor } = b.dataset;
    cambiar(opsEstado(T, est, r, valor), `${RONDA[r].nombre}: ${ESTADO_TXT[valor].toLowerCase()}`);
    const nuevo = document.querySelector(`[data-acc="estado"][data-est="${est}"][data-ronda="${r}"][data-valor="${valor}"]`);
    if (nuevo) nuevo.focus();
  } else if (b.dataset.acc === 'quitar') {
    if (!window.confirm('¿Quitar esta entrada de tu tablero? Si viene del kit, vuelve a aparecer cuando importes otra vez su progreso.json.')) return;
    cambiar([{ op: 'remove', path: ['estaciones', `#${b.dataset.est}`, b.dataset.lista, `#${b.dataset.item}`] }], 'Quitado');
  }
});

document.addEventListener('submit', (ev) => {
  const f = ev.target;
  if (!f.matches || !f.matches('form.t-add')) return;
  ev.preventDefault();
  const d = new FormData(f), est = f.dataset.est, ahora = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (f.dataset.acc === 'nota') {
    const v = { id: nuevoId('b'), fecha: ahora, ronda: d.get('ronda'), paso: d.get('paso') || '', hice: d.get('hice').trim(), medi: d.get('medi').trim(), sigue: d.get('sigue').trim(), origen: 'tablero' };
    if (!v.hice && !v.medi && !v.sigue) { avisar('Escribe al menos qué hiciste'); return; }
    cambiar([{ op: 'insert', path: ['estaciones', `#${est}`, 'bitacora'], value: v }], 'Nota agregada');
  } else if (f.dataset.acc === 'falla') {
    const v = { id: nuevoId('f'), falla: d.get('falla'), ronda: d.get('ronda'), inicio: null, fin: ahora, minutos: Math.max(0, Math.min(100000, +d.get('minutos') || 0)),
      pistas: Math.max(0, Math.min(999, Math.round(+d.get('pistas') || 0))), rendido: d.get('rendido') === 'on', aprendi: d.get('aprendi').trim(), origen: 'tablero' };
    const ops = [{ op: 'insert', path: ['estaciones', `#${est}`, 'fallas'], value: v }];
    const r = T.estaciones.find((x) => x.id === est).rondas.find((x) => x.id === v.ronda);
    if (r.estado === 'pendiente') ops.push(...opsEstado(T, est, v.ronda, 'en_curso'));
    cambiar(ops, 'Falla anotada');
  }
});

$('t-archivo').addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  if (file.size > 2_000_000) { mostrar('<h3>El archivo es muy grande</h3><p class="d-txt">Un progreso.json pesa unos pocos KB. ¿Elegiste el archivo correcto?</p>', 'mal'); return; }
  file.text().then((t) => { importarTexto(t); ev.target.value = ''; });
});
$('t-importar-pegado').addEventListener('click', () => {
  const t = $('t-pegado').value.trim();
  if (!t) { avisar('Pega primero el contenido del JSON'); return; }
  if (importarTexto(t)) $('t-pegado').value = '';
});
$('t-exportar').addEventListener('click', () => {
  const datos = { app: APP, exportado: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), tablero: almacen.leer() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `dojo-tablero-${datos.exportado.slice(0, 10)}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  avisar('Respaldo descargado');
});
$('t-borrar').addEventListener('click', () => {
  if (!window.confirm('¿Borrar tu tablero de este navegador? Todas las rondas vuelven a pendiente y se vacían la bitácora y las fallas. Si no tienes un respaldo, no se puede deshacer.')) return;
  T = almacen.borrar();
  pintar();
  avisar('Tablero borrado');
});
// otra pestaña cambió el tablero
window.addEventListener('storage', (ev) => { if (ev.key === 'dojo-tablero') { T = almacen.leer(); pintar(); } });

if (!almacen.persistente()) {
  const a = $('t-aviso');
  a.hidden = false;
  a.textContent = 'Este navegador no deja guardar datos (¿modo privado?): tu tablero se borra al cerrar la página. Descarga un respaldo antes de salir.';
}
pintar();
// un enlace a una estación (/tablero/#est-c01-datos): la tarjeta se dibuja después de cargar, así que se busca aquí
if (/^#est-[a-z0-9-]+$/.test(location.hash)) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
window.dojoTablero = { importarTexto, leer: () => almacen.leer() }; // para los chequeos (tools/check.mjs)
