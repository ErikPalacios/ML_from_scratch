/* Tablero de proyectos ML: router por hash, vistas y eventos.
   Rutas: #/ (proyectos) · #/entrar · #/nuevo · #/p/<id> (mapa) · #/p/<id>/bitacora · #/p/<id>/decisiones
          #/p/<id>/proyecto · #/p/<id>/paso/<pasoId>
   Todo cambio pasa por sync.commit(ops): se ve al instante, se guarda en el navegador y se manda al servidor. */
import * as sync from './sync.js';
import { esc, rich, icon, safeHref, isExternal, days, daysText, daysLevel, fmtDate, toast, dialog, confirmDlg, copyText, download, todayLocal } from './lib.js';
import { mapHtml, layoutMap } from './map.js';
import { STATUS, STATUS_LABEL, VUELTA_STATUS, TRAMOS, TRAMO_LABEL, SPEED_LABEL, progress, validateProject, isId } from './shared/model.mjs';
import { T } from './shared/templates.mjs';
import { projectFromTemplate, addableSteps, stepFromTemplate, uniqueStepId, slugify } from './shared/factory.mjs';
import { buildSummary } from './shared/summary.mjs';
import { seedC01 } from './shared/seed-c01.mjs';

const app = document.getElementById('app');
const ui = { editing: null, editSteps: false, newPattern: 'sincrono', offlineNoData: false };
let route = { name: 'home' };
let deferredRender = false;

// ---------------------------------------------------------------- router
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'entrar') return { name: 'login' };
  if (parts[0] === 'nuevo') return { name: 'new' };
  if (parts[0] === 'p' && parts[1]) {
    const id = parts[1];
    if (parts[2] === 'paso' && parts[3]) return { name: 'step', id, stepId: parts[3] };
    if (['bitacora', 'decisiones', 'proyecto'].includes(parts[2])) return { name: 'project', id, tab: parts[2] };
    return { name: 'project', id, tab: 'mapa' };
  }
  return { name: 'home' };
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

window.addEventListener('hashchange', async () => {
  const prev = route;
  route = parseRoute();
  ui.editing = null;
  if (!(prev.name === route.name && prev.id === route.id && route.name === 'project')) ui.editSteps = false;
  await enterRoute();
  if (!(prev.name === 'step' && route.name === 'step' && prev.stepId === route.stepId)) window.scrollTo(0, 0);
});

async function enterRoute() {
  if (sync.syncState().auth === false && route.name !== 'login') { location.hash = '#/entrar'; return; }
  render();
  try {
    if (route.name === 'home') { await sync.loadList(); ui.listLoaded = true; }
    if (route.id) await sync.loadProject(route.id);
  } catch (e) { handleError(e); }
  render();
}

function handleError(e) {
  if (e instanceof sync.AuthError) { location.hash = '#/entrar'; return; }
  if (e && e.status === 404 && route.id) { toast(`No existe el proyecto «${route.id}».`, 'error'); location.hash = '#/'; return; }
  toast(e.message || String(e), 'error', 6000);
}

// ---------------------------------------------------------------- render
function render() {
  const a = document.activeElement;
  if (a && a.matches && a.matches('[data-bind]') && app.contains(a)) { deferredRender = true; return; }
  deferredRender = false;
  renderBar();
  let html = '';
  if (route.name === 'login') html = viewLogin();
  else if (route.name === 'new') html = viewNew();
  else if (route.name === 'project') html = viewProject();
  else if (route.name === 'step') html = viewStep();
  else html = viewHome();
  app.innerHTML = html;
  const map = app.querySelector('.map');
  if (map) { layoutMap(app); mapObserver.observe(map); }
  const focus = app.querySelector('[data-autofocus]');
  if (focus) focus.focus();
}
const mapObserver = new ResizeObserver(() => layoutMap(app));
if (document.fonts) document.fonts.ready.then(() => layoutMap(app));
app.addEventListener('focusout', () => { setTimeout(() => { if (deferredRender) render(); }, 0); });

function renderBar() {
  const s = sync.syncState();
  const bar = document.getElementById('sync');
  const txt = s.status === 'saving' ? 'Guardando…'
    : s.status === 'offline' ? (s.pending ? `Sin conexión · ${s.pending} sin subir` : 'Sin conexión · copia local')
    : s.status === 'error' ? `Error: ${s.error || 'no se guardó'}`
    : s.pending ? `${s.pending} sin subir` : 'Guardado';
  bar.dataset.s = s.status;
  bar.innerHTML = `<i></i><b>${esc(txt)}</b>`;
  bar.title = txt;
  const p = route.id ? sync.getProject(route.id) : null;
  document.getElementById('bar-title').textContent = p ? p.name : '';
  document.getElementById('logout').hidden = s.auth === false || route.name === 'login';
  document.title = p ? `${p.name} · Tablero ML` : 'Tablero ML';
}

sync.onChange((what) => {
  if (what === 'status') { renderBar(); return; }
  if (what === 'auth') { location.hash = '#/entrar'; return; }
  if (what && what.rejected) {
    toast(`${what.rejected.length} cambio(s) no se pudieron aplicar: ${what.rejected[0].error}`, 'error', 8000);
    return;
  }
  if (typeof what === 'string' && what.startsWith('project:') && route.id === what.slice(8)) render();
});

// ---------------------------------------------------------------- vistas: entrar
function viewLogin() {
  const problems = ui.problems || [];
  return `<section class="login card">
    <img src="/icon.svg" alt="">
    <h1>Tablero de proyectos ML</h1>
    <p class="muted">Es privado: escribe la contraseña que guardaste en Vercel como <code>APP_PASSWORD</code>.</p>
    ${problems.length ? `<div class="banner banner--error"><b>Falta configurar:</b><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <form data-form="login">
      <label class="f">Contraseña<input type="password" name="password" autocomplete="current-password" required data-autofocus></label>
      <button class="btn btn--primary" type="submit">Entrar</button>
      <p class="small" id="login-msg" role="alert"></p>
    </form>
  </section>`;
}

// ---------------------------------------------------------------- vistas: proyectos
function viewHome() {
  const list = sync.cachedList();
  const s = sync.syncState();
  const hasC01 = list.some((p) => p.id === 'c01');
  const cards = list.map((p) => {
    const d = days(p.lastActivity);
    const pct = p.total ? Math.round((p.hecho / p.total) * 100) : 0;
    const pat = T.PATTERNS[p.pattern];
    return `<a class="card pcard" href="#/p/${esc(p.id)}">
      <div class="row"><span class="chip">${esc(pat ? pat.name : p.pattern)}</span>${p.bloqueado ? `<span class="chip chip--bloqueado">${p.bloqueado} bloqueado${p.bloqueado > 1 ? 's' : ''}</span>` : ''}</div>
      <h2>${esc(p.name)}</h2>
      <div class="pbar" aria-label="${p.hecho} de ${p.total} pasos hechos"><i style="width:${pct}%"></i></div>
      <div class="row small"><span>${p.hecho}/${p.total} pasos hechos</span><span class="grow"></span><span class="days" data-l="${daysLevel(d)}">${icon('clock')} ${daysText(d)}</span></div>
      ${p.next ? `<p class="small"><b>Próximo:</b> ${esc(p.next)}</p>` : ''}
    </a>`;
  }).join('');
  return `<div class="phead"><div><h1>Tus proyectos</h1><p class="muted">Cada proyecto es un mapa del dato al monitoreo. Abre uno para ver dónde te quedaste.</p></div>
    <div class="row"><a class="btn btn--primary" href="#/nuevo">${icon('plus')} Nuevo proyecto</a>
      <button class="btn" data-act="import">${icon('upload')} Importar JSON</button>
      <button class="btn" data-act="export-all" ${list.length ? '' : 'disabled'}>${icon('download')} Exportar todo</button></div></div>
    ${s.status === 'offline' ? '<div class="banner">Sin conexión: ves la última copia guardada en este dispositivo.</div>' : ''}
    ${list.length ? `<div class="cards">${cards}</div>` : !ui.listLoaded ? '<div class="card empty"><p class="muted">Cargando…</p></div>' : `<div class="card empty"><h2>Todavía no hay proyectos</h2><p class="muted">Empieza con tu C01 tal como está en Caso1, o crea uno nuevo eligiendo su patrón.</p></div>`}
    ${hasC01 || !ui.listLoaded ? '' : `<div class="card" style="margin-top:12px"><h2>Precargar el C01</h2><p>Crea el proyecto <b>C01 · API de clasificación (Caso1)</b> con tu estado real: los hitos 0–10 del PLAN acomodados en las 12 estaciones, las mediciones del LAB_LOG, las decisiones y las dos sesiones que ya hiciste. El próximo paso queda en el hito 1, paso 1.4.</p>
      <button class="btn btn--primary" data-act="seed-c01">${icon('play')} Precargar el C01</button></div>`}
    <input type="file" id="import-file" accept="application/json,.json" hidden>`;
}

// ---------------------------------------------------------------- vistas: nuevo proyecto
function viewNew() {
  const pats = T.ORDER.map((id) => {
    const p = T.PATTERNS[id];
    const steps = T.STEPS[id];
    return `<button type="button" class="card pat" data-act="pick-pattern" data-v="${id}" aria-pressed="${ui.newPattern === id}">
      <h3>${esc(p.name)}</h3>
      <span class="small">Como el ${esc(p.case.toUpperCase())}${p.cases.length > 1 ? ` (también ${esc(p.cases.filter((c) => c !== p.case).map((c) => c.toUpperCase()).join(', '))})` : ''} · ${steps.length} pasos</span>
      <span class="small">${esc(p.summary.split('. ').slice(0, 2).join('. '))}${p.summary.split('. ').length > 2 ? '.' : ''}</span>
    </button>`;
  }).join('');
  const sel = T.PATTERNS[ui.newPattern];
  const steps = T.STEPS[ui.newPattern];
  return `<div class="crumbs"><a href="#/">${icon('back')} Proyectos</a></div>
  <h1>Nuevo proyecto</h1>
  <form data-form="new" class="stack">
    <div class="card"><div class="grid2">
      <label class="f span2">Nombre<input type="text" name="name" required maxlength="160" placeholder="C14 · Pronóstico de demanda" data-autofocus data-slug-src></label>
      <label class="f">Id (para la URL y la API)<input type="text" name="id" maxlength="40" pattern="[a-z0-9][a-z0-9-]{0,39}" placeholder="se arma del nombre" data-slug-dst class="mono"></label>
      <label class="f">Repo o carpeta (opcional)<input type="text" name="repo" maxlength="400" placeholder="~/Documents/ProyectosPortafolio/Caso14" class="mono"></label>
      <label class="f span2">Meta en una línea (opcional)<input type="text" name="goal" maxlength="400"></label>
    </div></div>
    <div><h2>Patrón de diseño</h2><p class="muted">El patrón decide qué pasos son obligatorios, del dato al monitoreo. Salen del curso y de la hoja «Del dato a producción»; después puedes agregar, quitar y reordenar.</p>
      <div class="patterns">${pats}</div></div>
    <div class="card"><h2>${esc(sel.name)}: los ${steps.length} pasos</h2>
      <p>${esc(sel.summary)}</p>
      ${sel.removed.length ? `<p class="small"><b>Frente al C01 desaparecen:</b> ${sel.removed.map((r) => `${esc(T.STATIONS.find((s) => s.id === r.id)?.title || r.id)} (${esc(r.why)})`).join(' · ')}</p>` : ''}
      <ol class="pat">${steps.map((s) => `<li class="ln-${s.speed}"><b>${esc(s.title)}</b>${s.status === 'nuevo' ? ' <span class="chip chip--line">propio del patrón</span>' : s.status === 'cambia' ? ' <span class="chip">cambia</span>' : ''}</li>`).join('')}</ol>
      <div class="links">${sel.links.map(linkHtml).join('')}</div>
    </div>
    <div class="row row--end"><a class="btn" href="#/">Cancelar</a><button class="btn btn--primary" type="submit">${icon('plus')} Crear proyecto</button></div>
  </form>`;
}

// ---------------------------------------------------------------- vistas: proyecto
function projectOr404() {
  const p = sync.getProject(route.id);
  if (!p) return { html: `<div class="card empty"><h2>Cargando…</h2><p class="muted">Si no hay conexión y nunca abriste este proyecto en este dispositivo, no hay copia que mostrar.</p><a class="btn" href="#/">Volver a proyectos</a></div>` };
  return { p };
}

function viewProject() {
  const { p, html } = projectOr404();
  if (!p) return html;
  const pat = T.PATTERNS[p.pattern];
  const tab = route.tab;
  const tabs = [['mapa', 'Mapa', 'map'], ['bitacora', `Bitácora (${p.sessions.length})`, 'log'], ['decisiones', `Decisiones (${p.decisions.length})`, 'scale'], ['proyecto', 'Proyecto', 'gear']];
  const base = `#/p/${esc(p.id)}`;
  let body = '';
  if (tab === 'bitacora') body = tabLog(p);
  else if (tab === 'decisiones') body = tabDecisions(p);
  else if (tab === 'proyecto') body = tabSettings(p);
  else body = tabMap(p);
  return `<div class="crumbs"><a href="#/">${icon('back')} Proyectos</a></div>
  <div class="phead"><div><h1>${esc(p.name)}</h1>
    <div class="row small"><span class="chip">${esc(pat ? pat.name : p.pattern)}</span>${p.repo ? `<code>${esc(p.repo)}</code>` : ''}<span>Vuelta ${p.vueltaActual} (${p.vueltaActual === 2 ? 'solo' : 'guiada'})</span></div></div>
    <div class="row"><button class="btn btn--primary" data-act="summary">${icon('doc')} Resumen para retomar</button><button class="btn" data-act="session-new">${icon('log')} Registrar sesión</button></div></div>
  ${resumePanel(p)}
  <nav class="tabs" aria-label="Secciones del proyecto">${tabs.map(([id, label, ic]) => `<a href="${id === 'mapa' ? base : `${base}/${id}`}" ${tab === id ? 'aria-current="page"' : ''}>${icon(ic)} ${esc(label)}</a>`).join('')}</nav>
  ${body}
  <p class="footer">Revisión ${p.rev} · actualizado ${fmtDate(p.updatedAt)}</p>`;
}

function resumePanel(p) {
  const d = days(p.lastActivity);
  const pr = progress(p);
  const next = p.steps.find((s) => s.id === p.resume.nextStepId);
  const blocked = p.steps.filter((s) => s.status === 'bloqueado');
  const doing = p.steps.filter((s) => s.status === 'en_curso');
  const last = [...p.sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const stepLink = (s) => `<a href="#/p/${esc(p.id)}/paso/${esc(s.id)}">${esc(s.title)}</a>`;
  const editing = ui.editing === 'resume';
  const left = editing ? `<form data-form="resume">
      <label class="f">Dónde me quedé<textarea name="where" rows="4" data-autofocus>${esc(p.resume.where)}</textarea></label>
      <label class="f">Próximo paso concreto<textarea name="next" rows="3">${esc(p.resume.next)}</textarea></label>
      <label class="f">Paso del mapa<select name="nextStepId"><option value="">(ninguno)</option>${p.steps.map((s, i) => `<option value="${esc(s.id)}" ${s.id === p.resume.nextStepId ? 'selected' : ''}>${i + 1}. ${esc(s.title)}</option>`).join('')}</select></label>
      <div class="row row--end"><button class="btn" type="button" data-act="cancel-edit">Cancelar</button><button class="btn btn--primary" type="submit">Guardar</button></div>
    </form>`
    : `<div class="rblock"><div class="k">Dónde me quedé</div><div class="rtext">${rich(p.resume.where)}</div></div>
      <div class="rblock"><div class="k">Próximo paso concreto</div><div class="rtext">${rich(p.resume.next)}</div>
        ${next ? `<p class="small" style="margin-top:6px">${icon('flag')} En el mapa: ${stepLink(next)}</p>` : ''}</div>
      <div class="row" style="margin-top:10px"><button class="btn btn--sm" data-act="edit-resume">${icon('edit')} Editar</button></div>`;
  return `<section class="card resume" aria-label="Retomar">
    <div><h2>${icon('play')} Retomar</h2>${left}</div>
    <div class="stack">
      <div class="stats">
        <div class="stat" data-l="${daysLevel(d)}"><b>${d ?? '—'}</b><span>${d === 1 ? 'día' : 'días'} sin moverle</span></div>
        <div class="stat"><b>${pr.hecho}/${pr.total}</b><span>pasos hechos</span></div>
        <div class="stat"><b>${pr.v1} · ${pr.v2}</b><span>hechos en V1 · V2</span></div>
      </div>
      <div><div class="k">Bloqueos abiertos</div>${blocked.length ? `<ul class="mini">${blocked.map((s) => `<li>${icon('alert')} <span>${stepLink(s)}: ${esc(s.reason || 'sin razón escrita')}</span></li>`).join('')}</ul>` : '<p class="small">Ninguno.</p>'}</div>
      <div><div class="k">En curso</div>${doing.length ? `<ul class="mini">${doing.map((s) => `<li>◎ ${stepLink(s)}</li>`).join('')}</ul>` : '<p class="small">Nada en curso.</p>'}</div>
      <div><div class="k">Última sesión</div>${last ? `<p class="small"><b>${fmtDate(last.date)}</b>${last.source === 'claude' ? ' <span class="chip chip--claude">Claude Code</span>' : ''}${last.next ? ` · Sigue: ${rich(last.next)}` : last.did ? ` · ${rich(last.did)}` : ''}</p>` : '<p class="small">Sin sesiones todavía.</p>'}</div>
    </div>
  </section>`;
}

function tabMap(p) {
  if (ui.editSteps) {
    return `<div class="row" style="margin-bottom:10px"><h2 class="grow" style="margin:0">Editar pasos</h2><button class="btn btn--primary" data-act="edit-steps-done">${icon('check')} Listo</button></div>
    <p class="muted">Reordena con las flechas, quita lo que no aplique (o márcalo «no aplica» con su razón) y agrega pasos del curso o propios.</p>
    <div class="edit-steps">${p.steps.map((s, i) => `<div class="erow ln-${s.speed}"><span class="dotmini"></span><span class="grow">${i + 1}. ${esc(s.title)} <span class="small">· ${TRAMO_LABEL[s.tramo]}</span></span>
      <button class="btn btn--sm btn--icon" data-act="step-move" data-id="${esc(s.id)}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${icon('up')}</button>
      <button class="btn btn--sm btn--icon" data-act="step-move" data-id="${esc(s.id)}" data-d="1" ${i === p.steps.length - 1 ? 'disabled' : ''} aria-label="Bajar">${icon('down')}</button>
      <button class="btn btn--sm btn--icon btn--danger" data-act="step-remove" data-id="${esc(s.id)}" aria-label="Quitar">${icon('trash')}</button></div>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="step-add">${icon('plus')} Agregar paso</button></div>`;
  }
  return `${mapHtml(p)}
  <div class="row" style="margin-top:12px"><button class="btn" data-act="edit-steps">${icon('edit')} Agregar, quitar o reordenar pasos</button></div>`;
}

function tabLog(p) {
  const list = [...p.sessions].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  const stepTitle = (id) => (p.steps.find((s) => s.id === id) || { title: id }).title;
  return `<div class="row" style="margin-bottom:10px"><p class="muted grow" style="margin:0">Una entrada por sesión de trabajo: qué hiciste, qué mediste y qué sigue. Claude Code también escribe aquí con su token.</p>
    <button class="btn btn--primary" data-act="session-new">${icon('plus')} Registrar sesión</button></div>
  ${list.length ? `<ol class="log">${list.map((s) => `<li><div class="card">
    <div class="row"><b class="grow">${fmtDate(s.date)}</b>${s.source === 'claude' ? '<span class="chip chip--claude">Claude Code</span>' : s.source === 'import' ? '<span class="chip">precargada</span>' : ''}
      <button class="btn btn--sm btn--icon btn--ghost" data-act="session-edit" data-id="${esc(s.id)}" aria-label="Editar">${icon('edit')}</button>
      <button class="btn btn--sm btn--icon btn--ghost btn--danger" data-act="session-del" data-id="${esc(s.id)}" aria-label="Borrar">${icon('trash')}</button></div>
    <dl>${s.did ? `<dt>Hice</dt><dd>${rich(s.did)}</dd>` : ''}${s.measured ? `<dt>Medí</dt><dd>${rich(s.measured)}</dd>` : ''}${s.next ? `<dt>Sigue</dt><dd>${rich(s.next)}</dd>` : ''}</dl>
    ${s.stepIds.length ? `<div class="row" style="margin-top:8px">${s.stepIds.map((id) => `<a class="chip" href="#/p/${esc(p.id)}/paso/${esc(id)}">${esc(stepTitle(id))}</a>`).join('')}</div>` : ''}
  </div></li>`).join('')}</ol>` : '<div class="card empty"><p>Todavía no hay sesiones. Al terminar de trabajar, registra una: es lo primero que lees al volver.</p></div>'}`;
}

function tabDecisions(p) {
  const list = [...p.decisions].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  return `<div class="row" style="margin-bottom:10px"><p class="muted grow" style="margin:0">Qué elegiste, contra qué y por qué. En la entrevista te preguntan justo esto.</p>
    <button class="btn btn--primary" data-act="decision-new">${icon('plus')} Agregar decisión</button></div>
  ${list.length ? `<ol class="log">${list.map((d) => decisionCard(p, d)).join('')}</ol>` : '<div class="card empty"><p>Sin decisiones todavía.</p></div>'}`;
}

function decisionCard(p, d) {
  const s = p.steps.find((x) => x.id === d.stepId);
  return `<li><div class="card">
    <div class="row"><b class="grow">${rich(d.what)}</b>${d.status === 'revisada' ? '<span class="chip">revisada</span>' : ''}
      <button class="btn btn--sm btn--icon btn--ghost" data-act="decision-edit" data-id="${esc(d.id)}" aria-label="Editar">${icon('edit')}</button>
      <button class="btn btn--sm btn--icon btn--ghost btn--danger" data-act="decision-del" data-id="${esc(d.id)}" aria-label="Borrar">${icon('trash')}</button></div>
    <dl>${d.against ? `<dt>Contra</dt><dd>${rich(d.against)}</dd>` : ''}<dt>Por qué</dt><dd>${rich(d.why)}</dd></dl>
    <p class="small" style="margin:8px 0 0">${fmtDate(d.date)}${s ? ` · <a href="#/p/${esc(p.id)}/paso/${esc(s.id)}">${esc(s.title)}</a>` : ''}</p>
  </div></li>`;
}

function tabSettings(p) {
  const pat = T.PATTERNS[p.pattern];
  const missing = (T.STEPS[p.pattern] || []).filter((t) => !p.steps.some((s) => (s.base || s.id) === t.id));
  const origin = location.origin;
  const P = (s) => `["${s}"]`;
  return `<div class="stack">
  <div class="card"><h2>Datos del proyecto</h2><div class="grid2">
    <label class="f span2">Nombre<input type="text" maxlength="160" value="${esc(p.name)}" data-bind='${P('name')}'></label>
    <label class="f">Repo o carpeta<input type="text" class="mono" maxlength="400" value="${esc(p.repo)}" data-bind='${P('repo')}'></label>
    <label class="f">Meta en una línea<input type="text" maxlength="400" value="${esc(p.goal)}" data-bind='${P('goal')}'></label>
  </div>
  <div class="k" style="margin-top:4px">Vuelta actual</div>
  <div class="seg" style="margin-top:6px">${[1, 2].map((v) => `<button data-act="set" data-path='["vueltaActual"]' data-value="${v}" aria-pressed="${p.vueltaActual === v}">Vuelta ${v} · ${v === 1 ? 'guiada' : 'solo'}</button>`).join('')}</div>
  </div>
  <div class="card"><h2>Patrón: ${esc(pat ? pat.name : p.pattern)}</h2><p>${esc(pat ? pat.summary : '')}</p>
    ${missing.length ? `<p>Le faltan ${missing.length} paso(s) del patrón: ${missing.map((t) => esc(t.title)).join(', ')}.</p><button class="btn" data-act="add-missing">${icon('plus')} Agregar los que faltan</button>` : '<p class="small">Tiene todos los pasos de su patrón.</p>'}
    <div class="links" style="margin-top:10px">${pat ? pat.links.map(linkHtml).join('') : ''}</div></div>
  <div class="card"><h2>${icon('terminal')} Conectar con Claude Code</h2>
    <p>Las sesiones de Claude Code leen y actualizan este proyecto con su propio token (<code>API_TOKEN</code> en Vercel; en tu Mac, en un <code>.env</code> que git ignora). El texto para el <code>CLAUDE.md</code> del repo está en el README del tablero.</p>
    <pre class="cmd">curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" ${esc(origin)}/api/claude/${esc(p.id)}</pre>
    <div class="row" style="margin-top:8px"><button class="btn btn--sm" data-act="copy" data-text="${esc(`curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" ${origin}/api/claude/${p.id}`)}">${icon('copy')} Copiar</button></div>
    <p class="small" style="margin-top:8px">Ids de los pasos: ${p.steps.map((s) => `<code>${esc(s.id)}</code>`).join(' ')}</p></div>
  <div class="card"><h2>Respaldo</h2><p>El servidor guarda una copia de cada versión (al menos cada 10 minutos, las últimas 30). Además puedes bajar el proyecto en JSON.</p>
    <div class="row"><button class="btn" data-act="export-one">${icon('download')} Exportar este proyecto</button><button class="btn" data-act="history">${icon('clock')} Versiones guardadas</button><button class="btn" data-act="import">${icon('upload')} Importar JSON</button></div></div>
  <div class="card"><h2>Borrar</h2><p class="small">Queda 30 días en la papelera del servidor; para recuperarlo, impórtalo desde un respaldo.</p><button class="btn btn--danger" data-act="project-delete">${icon('trash')} Borrar el proyecto</button></div>
  <input type="file" id="import-file" accept="application/json,.json" hidden>
  </div>`;
}

// ---------------------------------------------------------------- vistas: paso
const LISTS = {
  hitos: { title: 'Hitos del proyecto', icon: 'flag', add: 'Agregar hito', empty: 'Sin hitos en este paso.',
    fields: [{ k: 'text', label: 'Hito', req: true }, { k: 'status', label: 'Estado', type: 'select', options: STATUS.map((s) => [s, STATUS_LABEL[s]]) }, { k: 'done', label: 'Hecho cuando…', type: 'textarea' }],
    view: (h) => `<div class="grow"><div class="row"><b class="grow">${rich(h.text)}</b><span class="chip chip--${h.status}">${STATUS_LABEL[h.status]}</span></div>${h.done ? `<p class="small" style="margin-top:4px">Hecho cuando: ${rich(h.done)}</p>` : ''}</div>` },
  done: { title: 'Criterios de hecho', icon: 'check', add: 'Agregar criterio', empty: 'Sin criterios.',
    fields: [{ k: 'text', label: 'Criterio', type: 'textarea', req: true }] },
  results: { title: 'Resultados medidos', icon: 'scale', add: 'Agregar resultado', empty: 'Sin resultados todavía. Anota cada número con su unidad y su fecha.',
    fields: [{ k: 'name', label: 'Qué mediste', req: true }, { k: 'value', label: 'Valor', req: true }, { k: 'unit', label: 'Unidad (ms, req/s, MB, %…)' }, { k: 'date', label: 'Fecha', type: 'date' }, { k: 'note', label: 'Nota (comando, condiciones)', type: 'textarea', span: true }],
    view: (r) => `<div class="grow res"><span>${rich(r.name)}</span><span class="res__v">${esc(r.value)} <small>${esc(r.unit)}</small></span>${r.note || r.date ? `<span class="small" style="grid-column:1/-1">${r.date ? fmtDate(r.date) : ''}${r.note && r.date ? ' · ' : ''}${rich(r.note)}</span>` : ''}</div>` },
  commands: { title: 'Comandos para verificar', icon: 'terminal', add: 'Agregar comando', empty: 'Sin comandos.',
    fields: [{ k: 'code', label: 'Comando', type: 'mono', req: true }, { k: 'note', label: 'Para qué', type: 'textarea' }],
    view: (c) => `<div class="grow"><pre class="cmd">${esc(c.code)}</pre>${c.note ? `<p class="small" style="margin-top:4px">${rich(c.note)}</p>` : ''}</div>`,
    extra: (c) => `<button class="btn btn--sm btn--icon btn--ghost" data-act="copy" data-text="${esc(c.code)}" aria-label="Copiar">${icon('copy')}</button>` },
  files: { title: 'Archivos y commits', icon: 'doc', add: 'Agregar archivo o commit', empty: 'Sin archivos.',
    fields: [{ k: 'path', label: 'Ruta o archivo', req: true, mono: true }, { k: 'ref', label: 'Commit, rama o estado' }],
    view: (f) => `<div class="grow"><code>${esc(f.path)}</code>${f.ref ? ` <span class="small">${rich(f.ref)}</span>` : ''}</div>` },
  links: { title: 'Curso y cheat sheets', icon: 'book', add: 'Agregar enlace', empty: 'Sin enlaces.',
    fields: [{ k: 'label', label: 'Texto', req: true }, { k: 'href', label: 'URL (https://…)', req: true, mono: true }],
    view: (l) => `<div class="grow links">${linkHtml(l)}</div>` },
};

function linkHtml(l) {
  const href = safeHref(l.href);
  const ext = isExternal(href);
  return `<a href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener noreferrer"' : ''}>${icon(l.label.startsWith('Hoja') ? 'doc' : 'book')}<span>${esc(l.label)}</span>${ext ? icon('ext') : ''}</a>`;
}

function fieldHtml(f, value) {
  const name = `name="${f.k}"`;
  const req = f.req ? 'required' : '';
  const v = value ?? '';
  let input;
  if (f.type === 'select') input = `<select ${name}>${f.options.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'textarea') input = `<textarea ${name} rows="3" ${req}>${esc(v)}</textarea>`;
  else if (f.type === 'mono') input = `<textarea ${name} rows="3" class="mono" ${req} spellcheck="false" autocapitalize="off">${esc(v)}</textarea>`;
  else if (f.type === 'date') input = `<input type="date" ${name} value="${esc(v || todayLocal())}">`;
  else input = `<input type="text" ${name} value="${esc(v)}" ${req} ${f.mono ? 'class="mono" spellcheck="false" autocapitalize="off"' : ''}>`;
  return `<label class="f ${f.span || f.type === 'textarea' || f.type === 'mono' ? 'span2' : ''}">${esc(f.label)}${input}</label>`;
}

function listSection(p, s, key) {
  const L = LISTS[key];
  const items = s[key];
  const path = JSON.stringify(['steps', `#${s.id}`, key]);
  const editKey = (id) => `${s.id}:${key}:${id}`;
  const form = (item) => `<li><form class="form" data-form="item" data-path='${esc(path)}' data-id="${item ? esc(item.id) : ''}" data-list="${key}">
    <div class="grid2">${L.fields.map((f) => fieldHtml(f, item ? item[f.k] : f.k === 'status' ? 'pendiente' : '')).join('')}</div>
    <div class="row row--end"><button class="btn" type="button" data-act="cancel-edit">Cancelar</button><button class="btn btn--primary" type="submit">Guardar</button></div>
  </form></li>`;
  const row = (it) => {
    if (ui.editing === editKey(it.id)) return form(it);
    const acts = `<span class="item__acts">${L.extra ? L.extra(it) : ''}<button class="btn btn--sm btn--icon btn--ghost" data-act="item-edit" data-key="${esc(editKey(it.id))}" aria-label="Editar">${icon('edit')}</button><button class="btn btn--sm btn--icon btn--ghost btn--danger" data-act="item-del" data-path='${esc(path)}' data-id="${esc(it.id)}" aria-label="Borrar">${icon('trash')}</button></span>`;
    if (key === 'done') {
      return `<li class="item ${it.ok ? 'item--ok' : ''}"><input type="checkbox" class="check" ${it.ok ? 'checked' : ''} data-act="toggle-done" data-path='${esc(JSON.stringify(['steps', `#${s.id}`, 'done', `#${it.id}`, 'ok']))}' aria-label="Cumplido"><div class="grow item__text">${rich(it.text)}</div>${acts}</li>`;
    }
    return `<li class="item">${L.view(it)}${acts}</li>`;
  };
  const count = key === 'done' ? `${items.filter((d) => d.ok).length}/${items.length}` : key === 'hitos' ? `${items.filter((h) => h.status === 'hecho').length}/${items.length}` : items.length;
  return `<section class="sec card"><h2>${icon(L.icon)} ${L.title} <span class="count">${items.length ? count : ''}</span></h2>
    ${items.length || ui.editing === editKey('new') ? `<ul class="items">${items.map(row).join('')}${ui.editing === editKey('new') ? form(null) : ''}</ul>` : `<p class="small">${L.empty}</p>`}
    ${ui.editing === editKey('new') ? '' : `<div class="row" style="margin-top:10px"><button class="btn btn--sm" data-act="item-edit" data-key="${esc(editKey('new'))}">${icon('plus')} ${L.add}</button></div>`}
  </section>`;
}

function viewStep() {
  const { p, html } = projectOr404();
  if (!p) return html;
  const i = p.steps.findIndex((s) => s.id === route.stepId);
  if (i < 0) return `<div class="card empty"><h2>Ese paso ya no existe</h2><a class="btn" href="#/p/${esc(p.id)}">Volver al mapa</a></div>`;
  const s = p.steps[i];
  const prev = p.steps[i - 1], next = p.steps[i + 1];
  const P = (...k) => esc(JSON.stringify(['steps', `#${s.id}`, ...k]));
  const tpl = s.base ? (T.STEPS[p.pattern] || []).find((t) => t.id === s.base) || T.STATIONS.find((t) => t.id === s.base) : null;
  const decisions = p.decisions.filter((d) => d.stepId === s.id);
  const isNext = p.resume.nextStepId === s.id;
  return `<div class="crumbs"><a href="#/p/${esc(p.id)}">${icon('back')} ${esc(p.name)}</a></div>
  <header class="shead ln-${s.speed}">
    <div class="row small"><span class="k">Paso ${i + 1} de ${p.steps.length}</span><span class="chip chip--line">${TRAMO_LABEL[s.tramo]} · ${SPEED_LABEL[s.speed]}</span>${isNext ? '<span class="chip chip--next">Próximo paso</span>' : ''}</div>
    <h1>${esc(s.title)}</h1>
    ${s.question ? `<p class="question">${rich(s.question)}</p>` : ''}
  </header>
  <section class="card">
    <div class="k">Estado</div>
    <div class="seg" style="margin:6px 0 10px">${STATUS.map((st) => `<button class="st-${st}" data-act="step-status" data-v="${st}" aria-pressed="${s.status === st}">${STATUS_LABEL[st]}</button>`).join('')}</div>
    ${s.status === 'no_aplica' || s.status === 'bloqueado' || s.reason ? `<label class="f">${s.status === 'bloqueado' ? 'Qué lo bloquea' : s.status === 'no_aplica' ? 'Por qué no aplica' : 'Razón'}<input type="text" maxlength="400" value="${esc(s.reason)}" data-bind='${P('reason')}'></label>` : ''}
    <div class="grid2">
      <div><div class="k">Vuelta 1 · guiada</div><div class="seg" style="margin-top:6px">${VUELTA_STATUS.map((v) => `<button class="st-${v}" data-act="set" data-path='${P('vuelta', 'v1')}' data-value='"${v}"' aria-pressed="${s.vuelta.v1 === v}">${STATUS_LABEL[v]}</button>`).join('')}</div></div>
      <div><div class="k">Vuelta 2 · solo</div><div class="seg" style="margin-top:6px">${VUELTA_STATUS.map((v) => `<button class="st-${v}" data-act="set" data-path='${P('vuelta', 'v2')}' data-value='"${v}"' aria-pressed="${s.vuelta.v2 === v}">${STATUS_LABEL[v]}</button>`).join('')}</div></div>
    </div>
    <div class="row" style="margin-top:12px">${isNext ? '' : `<button class="btn btn--sm" data-act="make-next">${icon('flag')} Marcar como próximo paso</button>`}<button class="btn btn--sm" data-act="session-new" data-step="${esc(s.id)}">${icon('log')} Registrar sesión en este paso</button></div>
  </section>
  ${s.note || (tpl && tpl.artifact) ? `<details class="about sec" ${s.status === 'pendiente' && !s.notes ? 'open' : ''}><summary>Qué es este paso${s.base && s.base !== s.id ? '' : ''}</summary><p style="margin-top:8px">${rich(s.note)}</p>${tpl && tpl.artifact ? `<p class="small"><b>Lo que sale de aquí:</b> ${rich(tpl.artifact)}</p>` : ''}</details>` : ''}
  ${listSection(p, s, 'hitos')}
  ${listSection(p, s, 'done')}
  ${listSection(p, s, 'results')}
  <section class="sec card"><h2>${icon('edit')} Notas</h2><p class="small">Cálculos, resultados, comandos, lo que se rompió. Se guarda solo mientras escribes.</p>
    <textarea rows="8" data-bind='${P('notes')}' placeholder="Escribe aquí…">${esc(s.notes)}</textarea></section>
  ${listSection(p, s, 'commands')}
  ${listSection(p, s, 'files')}
  ${listSection(p, s, 'links')}
  <section class="sec card"><h2>${icon('scale')} Decisiones de este paso <span class="count">${decisions.length || ''}</span></h2>
    ${decisions.length ? `<ol class="log">${decisions.map((d) => decisionCard(p, d)).join('')}</ol>` : '<p class="small">Sin decisiones en este paso.</p>'}
    <div class="row" style="margin-top:10px"><button class="btn btn--sm" data-act="decision-new" data-step="${esc(s.id)}">${icon('plus')} Agregar decisión</button></div></section>
  <section class="sec card"><h2>Título y ubicación</h2><div class="grid2">
    <label class="f span2">Título<input type="text" maxlength="160" value="${esc(s.title)}" data-bind='${P('title')}'></label>
    <label class="f">Tramo<select data-act-change="set" data-path='${P('tramo')}'>${TRAMOS.map((t) => `<option value="${t}" ${t === s.tramo ? 'selected' : ''}>${TRAMO_LABEL[t]}</option>`).join('')}</select></label>
    <label class="f">Línea (ritmo)<select data-act-change="set" data-path='${P('speed')}'>${Object.keys(SPEED_LABEL).map((t) => `<option value="${t}" ${t === s.speed ? 'selected' : ''}>${SPEED_LABEL[t]}</option>`).join('')}</select></label>
  </div></section>
  <nav class="stepnav">${prev ? `<a class="btn" href="#/p/${esc(p.id)}/paso/${esc(prev.id)}">${icon('back')} ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn" href="#/p/${esc(p.id)}/paso/${esc(next.id)}">${esc(next.title)} ${icon('next')}</a>` : ''}</nav>`;
}

// ---------------------------------------------------------------- cambios
function commit(ops) {
  const p = sync.getProject(route.id);
  if (!p) return false;
  const rejected = sync.commit(p.id, ops);
  if (rejected.length) { toast(rejected[0].error, 'error', 6000); return false; }
  return true;
}
const cur = () => sync.getProject(route.id);
const stepPath = (...k) => ['steps', `#${route.stepId}`, ...k];

const bindTimers = new Map();
function commitBind(el) {
  clearTimeout(bindTimers.get(el));
  bindTimers.delete(el);
  const path = JSON.parse(el.dataset.bind);
  const p = cur();
  if (!p) return;
  let node = p;
  try { for (const k of path) node = k.startsWith('#') ? node.find((x) => x.id === k.slice(1)) : node[k]; } catch { node = undefined; }
  if (node === el.value) return;
  if (path.length === 1 && path[0] === 'name' && !el.value.trim()) return;
  commit([{ op: 'set', path, value: el.value }]);
}
app.addEventListener('input', (e) => {
  const el = e.target.closest('[data-bind]');
  if (!el) {
    const src = e.target.closest('[data-slug-src]');
    if (src) { const dst = app.querySelector('[data-slug-dst]'); if (dst && !dst.dataset.touched) dst.value = slugify(src.value); }
    if (e.target.closest('[data-slug-dst]')) e.target.dataset.touched = '1';
    return;
  }
  clearTimeout(bindTimers.get(el));
  bindTimers.set(el, setTimeout(() => commitBind(el), 900));
});
app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-bind]');
  if (el) { commitBind(el); return; }
  const sel = e.target.closest('[data-act-change="set"]');
  if (sel) { commit([{ op: 'set', path: JSON.parse(sel.dataset.path), value: sel.value }]); return; }
  if (e.target.id === 'import-file') importFile(e.target);
});

app.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const kind = form.dataset.form;
  if (kind === 'login') {
    const msg = form.querySelector('#login-msg');
    msg.textContent = 'Entrando…';
    try { await sync.login(data.password); location.hash = '#/'; }
    catch (err) { msg.textContent = err.message; }
    return;
  }
  if (kind === 'new') return createFromForm(data);
  if (kind === 'resume') {
    ui.editing = null;
    commit([{ op: 'set', path: ['resume', 'where'], value: data.where }, { op: 'set', path: ['resume', 'next'], value: data.next }, { op: 'set', path: ['resume', 'nextStepId'], value: data.nextStepId || null }]);
    render();
    return;
  }
  if (kind === 'item') {
    const path = JSON.parse(form.dataset.path);
    const key = form.dataset.list;
    const value = {};
    for (const f of LISTS[key].fields) value[f.k] = (data[f.k] ?? '').trim();
    if (value.date === '') delete value.date; // una fecha borrada queda sin fecha (el campo es opcional)
    const id = form.dataset.id;
    const p = cur();
    let ok;
    if (id) {
      let arr = p; for (const k of path) arr = k.startsWith('#') ? arr.find((x) => x.id === k.slice(1)) : arr[k];
      const old = arr.find((x) => x.id === id);
      const merged = { ...old, ...value };
      if (!('date' in value) && 'date' in merged && key === 'results') delete merged.date;
      ok = commit([{ op: 'set', path: [...path, `#${id}`], value: merged }]);
    } else ok = commit([{ op: 'insert', path, value }]);
    if (ok) { ui.editing = null; render(); }
  }
});

const ACTIONS = {
  'cancel-edit': () => { ui.editing = null; render(); },
  'edit-resume': () => { ui.editing = 'resume'; render(); },
  'item-edit': (el) => { ui.editing = el.dataset.key; render(); },
  'item-del': async (el) => {
    if (!(await confirmDlg('¿Borrar este elemento?', 'No se puede deshacer desde aquí (el servidor guarda versiones anteriores).', 'Borrar', true))) return;
    commit([{ op: 'remove', path: [...JSON.parse(el.dataset.path), `#${el.dataset.id}`] }]);
  },
  'toggle-done': (el) => { commit([{ op: 'set', path: JSON.parse(el.dataset.path), value: el.checked }]); },
  set: (el) => { commit([{ op: 'set', path: JSON.parse(el.dataset.path), value: JSON.parse(el.dataset.value) }]); },
  'step-status': async (el) => {
    const v = el.dataset.v;
    const s = cur().steps.find((x) => x.id === route.stepId);
    const ops = [];
    if ((v === 'no_aplica' || v === 'bloqueado') && !s.reason.trim()) {
      const r = await dialog({
        title: v === 'no_aplica' ? '¿Por qué no aplica?' : '¿Qué lo bloquea?',
        body: `<label class="f">${v === 'no_aplica' ? 'La razón queda escrita en el mapa y en el resumen.' : 'Así lo ves en «Retomar» como bloqueo abierto.'}<input type="text" name="reason" maxlength="400" required data-autofocus></label>`,
        actions: [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, primary: true }],
        onOpen: (d) => d.querySelector('input').focus(),
      });
      if (!r || !r.value || !r.data.reason.trim()) return;
      ops.push({ op: 'set', path: stepPath('reason'), value: r.data.reason.trim() });
    }
    ops.push({ op: 'set', path: stepPath('status'), value: v });
    commit(ops);
  },
  'make-next': () => { commit([{ op: 'set', path: ['resume', 'nextStepId'], value: route.stepId }]); toast('Quedó como próximo paso. Escribe qué sigue en «Retomar».'); },
  'edit-steps': () => { ui.editSteps = true; render(); },
  'edit-steps-done': () => { ui.editSteps = false; render(); },
  'step-move': (el) => {
    const p = cur();
    const i = p.steps.findIndex((s) => s.id === el.dataset.id);
    commit([{ op: 'move', path: ['steps', `#${el.dataset.id}`], index: i + Number(el.dataset.d) }]);
  },
  'step-remove': async (el) => {
    const s = cur().steps.find((x) => x.id === el.dataset.id);
    const keep = s.notes || s.results.length || s.hitos.length || s.files.length;
    if (!(await confirmDlg(`¿Quitar «${s.title}»?`, keep ? 'Tiene notas, hitos o resultados: se pierden. Si solo no aplica a este proyecto, mejor márcalo «No aplica» con su razón.' : 'Si solo no aplica, también puedes marcarlo «No aplica» con su razón.', 'Quitar', true))) return;
    commit([{ op: 'remove', path: ['steps', `#${s.id}`] }]);
  },
  'step-add': () => addStepDialog(),
  'add-missing': () => {
    const p = cur();
    const tpl = T.STEPS[p.pattern];
    const ops = [];
    tpl.forEach((t, i) => { if (!p.steps.some((s) => (s.base || s.id) === t.id)) ops.push({ op: 'insert', path: ['steps'], value: stepFromTemplate(t, uniqueStepId(p, t.id)), index: Math.min(i, p.steps.length + ops.length) }); });
    if (commit(ops)) toast(`Agregué ${ops.length} paso(s).`);
  },
  summary: () => summaryDialog(),
  'session-new': (el) => sessionDialog(null, el.dataset.step),
  'session-edit': (el) => sessionDialog(cur().sessions.find((s) => s.id === el.dataset.id)),
  'session-del': async (el) => { if (await confirmDlg('¿Borrar esta sesión?', 'Se quita de la bitácora.', 'Borrar', true)) commit([{ op: 'remove', path: ['sessions', `#${el.dataset.id}`] }]); },
  'decision-new': (el) => decisionDialog(null, el.dataset.step),
  'decision-edit': (el) => decisionDialog(cur().decisions.find((d) => d.id === el.dataset.id)),
  'decision-del': async (el) => { if (await confirmDlg('¿Borrar esta decisión?', 'Si cambiaste de opinión, mejor márcala «revisada» y agrega la nueva.', 'Borrar', true)) commit([{ op: 'remove', path: ['decisions', `#${el.dataset.id}`] }]); },
  copy: async (el) => { toast((await copyText(el.dataset.text)) ? 'Copiado.' : 'No se pudo copiar.'); },
  'pick-pattern': (el) => {
    const f = app.querySelector('form[data-form="new"]');
    const keep = f ? Object.fromEntries(new FormData(f).entries()) : {};
    ui.newPattern = el.dataset.v;
    render();
    const f2 = app.querySelector('form[data-form="new"]');
    for (const [k, v] of Object.entries(keep)) if (f2.elements[k]) f2.elements[k].value = v;
  },
  'seed-c01': async () => {
    try { await sync.createProject(seedC01()); toast('C01 precargado.'); go('#/p/c01'); }
    catch (e) { e.status === 409 ? go('#/p/c01') : handleError(e); }
  },
  import: () => app.querySelector('#import-file').click(),
  'export-all': async () => {
    try { const data = await sync.exportAll(); download(`tablero-ml-${todayLocal()}.json`, JSON.stringify(data, null, 1)); }
    catch (e) { handleError(e); }
  },
  'export-one': () => { const p = cur(); download(`${p.id}-${todayLocal()}.json`, JSON.stringify({ app: 'tablero-ml', exportedAt: new Date().toISOString(), projects: [p] }, null, 1)); },
  history: () => historyDialog(),
  'project-delete': async () => {
    const p = cur();
    if (!(await confirmDlg(`¿Borrar «${p.name}»?`, 'Se quita de todos tus dispositivos. Antes conviene exportarlo.', 'Borrar', true))) return;
    try { await sync.deleteProject(p.id); toast('Proyecto borrado.'); go('#/'); } catch (e) { handleError(e); }
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !app.contains(el)) return;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') { ACTIONS[el.dataset.act](el, e); return; }
  e.preventDefault();
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});

// ---------------------------------------------------------------- diálogos
function summaryDialog() {
  const md = buildSummary(cur());
  dialog({
    title: 'Resumen para retomar',
    body: `<p class="small">Pégalo al empezar una sesión con Claude Code. Claude Code también lo lee solo con <code>GET /api/claude/${esc(cur().id)}</code>.</p><pre class="md">${esc(md)}</pre>`,
    actions: [{ label: `${icon('download')} Descargar .md`, value: 'dl', type: 'button' }, { label: `${icon('copy')} Copiar`, value: 'copy', primary: true, type: 'button' }],
    onOpen: (d) => {
      d.querySelector('[data-i="0"]').addEventListener('click', () => download(`retomar-${cur().id}-${todayLocal()}.md`, md, 'text/markdown'));
      d.querySelector('[data-i="1"]').addEventListener('click', async () => toast((await copyText(md)) ? 'Resumen copiado.' : 'No se pudo copiar.'));
    },
  });
}

async function sessionDialog(s, stepId) {
  const p = cur();
  const sel = new Set(s ? s.stepIds : stepId ? [stepId] : p.resume.nextStepId ? [p.resume.nextStepId] : []);
  const r = await dialog({
    title: s ? 'Editar sesión' : 'Registrar sesión',
    body: `<div class="grid2">
      <label class="f">Fecha<input type="date" name="date" value="${esc(s ? s.date : todayLocal())}" required></label><span></span>
      <label class="f span2">Qué hice<textarea name="did" rows="3" data-autofocus>${esc(s ? s.did : '')}</textarea></label>
      <label class="f span2">Qué medí (con unidades)<textarea name="measured" rows="2">${esc(s ? s.measured : '')}</textarea></label>
      <label class="f span2">Qué sigue<textarea name="next" rows="2">${esc(s ? s.next : '')}</textarea></label>
    </div>
    <div class="k">Pasos que tocaste</div>
    <div class="row" style="margin:6px 0 10px">${p.steps.map((x) => `<label class="chip" style="cursor:pointer"><input type="checkbox" name="step:${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''}> ${esc(x.title)}</label>`).join('')}</div>
    ${s ? '' : '<label class="row small"><input type="checkbox" name="updateNext" checked> Usar «Qué sigue» como el próximo paso de «Retomar»</label>'}`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, primary: true }],
    onOpen: (d) => d.querySelector('textarea').focus(),
  });
  if (!r || !r.value) return;
  const d = r.data;
  if (!d.did.trim() && !d.measured.trim() && !d.next.trim()) { toast('Escribe al menos qué hiciste, qué mediste o qué sigue.', 'error'); return; }
  const value = { date: d.date || todayLocal(), did: d.did.trim(), measured: d.measured.trim(), next: d.next.trim(), stepIds: p.steps.filter((x) => d[`step:${x.id}`]).map((x) => x.id), source: s ? s.source : 'web' };
  const ops = s ? [{ op: 'set', path: ['sessions', `#${s.id}`], value: { ...s, ...value } }] : [{ op: 'insert', path: ['sessions'], value }];
  if (!s && d.updateNext && value.next) ops.push({ op: 'set', path: ['resume', 'next'], value: value.next });
  if (commit(ops)) toast(s ? 'Sesión actualizada.' : 'Sesión registrada.');
}

async function decisionDialog(dc, stepId) {
  const p = cur();
  const sid = dc ? dc.stepId : stepId || null;
  const r = await dialog({
    title: dc ? 'Editar decisión' : 'Agregar decisión',
    body: `<div class="grid2">
      <label class="f span2">Qué elegí<input type="text" name="what" maxlength="400" value="${esc(dc ? dc.what : '')}" required data-autofocus></label>
      <label class="f span2">Contra qué (la alternativa descartada)<input type="text" name="against" maxlength="400" value="${esc(dc ? dc.against : '')}"></label>
      <label class="f span2">Por qué<textarea name="why" rows="3" required>${esc(dc ? dc.why : '')}</textarea></label>
      <label class="f">Paso<select name="stepId"><option value="">(todo el proyecto)</option>${p.steps.map((x) => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
      <label class="f">Fecha<input type="date" name="date" value="${esc(dc ? dc.date : todayLocal())}"></label>
      ${dc ? `<label class="f">Estado<select name="status"><option value="vigente" ${dc.status === 'vigente' ? 'selected' : ''}>Vigente</option><option value="revisada" ${dc.status === 'revisada' ? 'selected' : ''}>Revisada (ya no vale)</option></select></label>` : ''}
    </div>`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, primary: true }],
    onOpen: (d) => d.querySelector('input').focus(),
  });
  if (!r || !r.value) return;
  const d = r.data;
  if (!d.what.trim() || !d.why.trim()) { toast('La decisión necesita qué elegiste y por qué.', 'error'); return; }
  const value = { date: d.date || todayLocal(), stepId: d.stepId || null, what: d.what.trim(), against: d.against.trim(), why: d.why.trim(), status: d.status || (dc ? dc.status : 'vigente') };
  if (commit(dc ? [{ op: 'set', path: ['decisions', `#${dc.id}`], value: { ...dc, ...value } }] : [{ op: 'insert', path: ['decisions'], value }])) toast('Decisión guardada.');
}

async function addStepDialog() {
  const p = cur();
  const groups = addableSteps(p);
  const all = groups.flatMap((g) => g.items);
  const r = await dialog({
    title: 'Agregar paso',
    body: `${groups.map((g) => `<h3 style="margin-top:6px">${esc(g.label)}</h3><div class="pick">${g.items.map((t) => `<button value="v:${all.indexOf(t)}">${esc(t.title)}<small>${esc((t.note || t.question || '').slice(0, 140))}${(t.note || '').length > 140 ? '…' : ''}</small></button>`).join('')}</div>`).join('')}
      <h3 style="margin-top:14px">Paso propio</h3>
      <div class="grid2"><label class="f span2">Título<input type="text" name="title" maxlength="160"></label>
      <label class="f">Tramo<select name="tramo">${TRAMOS.map((t) => `<option value="${t}">${TRAMO_LABEL[t]}</option>`).join('')}</select></label>
      <label class="f">Después de<select name="after">${p.steps.map((s, i) => `<option value="${i}" ${i === p.steps.length - 1 ? 'selected' : ''}>${i + 1}. ${esc(s.title)}</option>`).join('')}</select></label></div>`,
    actions: [{ label: 'Cancelar', value: false }, { label: 'Agregar paso propio', value: 'own', primary: true }],
  });
  if (!r) return;
  let step, index;
  if (typeof r.value === 'string' && r.value.startsWith('v:')) {
    const t = all[Number(r.value.slice(2))];
    step = stepFromTemplate(t, uniqueStepId(p, t.id));
    const base = T.STEPS[p.pattern] || [];
    const order = base.findIndex((x) => x.id === t.id);
    index = order >= 0 ? Math.min(order, p.steps.length) : p.steps.length;
  } else if (r.value === 'own') {
    if (!r.data.title.trim()) { toast('El paso propio necesita un título.', 'error'); return; }
    step = { id: uniqueStepId(p, slugify(r.data.title)), base: null, title: r.data.title.trim(), tramo: r.data.tramo, speed: 'nuevo' };
    index = Number(r.data.after) + 1;
  } else return;
  if (commit([{ op: 'insert', path: ['steps'], value: step, index }])) toast(`Agregué «${step.title}».`);
}

async function historyDialog() {
  const p = cur();
  let hist;
  try { hist = (await sync.history(p.id)).history; } catch (e) { handleError(e); return; }
  const r = await dialog({
    title: 'Versiones guardadas',
    body: hist.length ? `<p class="small">El servidor guarda una copia antes de cambiar el proyecto, como mucho una cada 10 minutos. Restaurar reemplaza la versión actual (que también queda guardada).</p>
      <div class="pick">${hist.map((h) => `<button value="v:${h.i}">Revisión ${h.rev} · ${esc(new Date(h.updatedAt).toLocaleString('es'))}<small>${h.steps} pasos · ${h.sessions} sesiones · ${h.decisions} decisiones</small></button>`).join('')}</div>`
      : '<p>Todavía no hay versiones anteriores.</p>',
  });
  if (!r || typeof r.value !== 'string' || !r.value.startsWith('v:')) return;
  const h = hist.find((x) => x.i === Number(r.value.slice(2)));
  if (!(await confirmDlg('¿Restaurar esta versión?', `Vuelve a la revisión ${h.rev}. Lo que cambiaste después se reemplaza.`, 'Restaurar', true))) return;
  try {
    const { project: old } = await sync.historyAt(p.id, h.i);
    await sync.replaceProject({ ...old, rev: p.rev }, sync.baseRev(p.id));
    toast('Versión restaurada.'); render();
  } catch (e) { e.status === 409 ? toast('El proyecto cambió mientras tanto (¿Claude Code?). Recarga y vuelve a intentarlo.', 'error', 7000) : handleError(e); }
}

// ---------------------------------------------------------------- crear e importar
async function createFromForm(data) {
  const name = (data.name || '').trim();
  const id = (data.id || '').trim() || slugify(name);
  if (!name) { toast('Ponle un nombre.', 'error'); return; }
  if (!isId(id)) { toast('El id solo lleva minúsculas, números y guiones (máximo 40).', 'error'); return; }
  const p = projectFromTemplate({ id, name, pattern: ui.newPattern, repo: (data.repo || '').trim(), goal: (data.goal || '').trim() });
  try { await sync.createProject(p); toast('Proyecto creado.'); go(`#/p/${id}`); }
  catch (e) { if (e instanceof sync.NetError) toast('Para crear un proyecto necesitas conexión.', 'error'); else if (e.status === 409) toast(`Ya existe un proyecto con id «${id}».`, 'error'); else handleError(e); }
}

async function importFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('El archivo no es JSON.', 'error'); return; }
  const projects = Array.isArray(data.projects) ? data.projects : data.project ? [data.project] : data.id && data.steps ? [data] : [];
  if (!projects.length) { toast('No encontré proyectos en el archivo.', 'error'); return; }
  let created = 0, replaced = 0, skipped = 0;
  for (const p of projects) {
    const errors = validateProject({ ...p, rev: 0 });
    if (errors.length) { toast(`«${p.name || p.id}» no es válido: ${errors[0]}`, 'error', 8000); skipped++; continue; }
    try { await sync.createProject({ ...p, rev: 0 }); created++; }
    catch (e) {
      if (e.status !== 409) { handleError(e); return; }
      if (await confirmDlg(`«${p.name}» ya existe`, '¿Lo reemplazo con la versión del archivo? La actual queda en las versiones guardadas.', 'Reemplazar', true)) {
        const current = await sync.loadProject(p.id);
        try { await sync.replaceProject({ ...p, rev: current.rev }, current.rev); replaced++; }
        catch (e2) { if (e2.status === 409) { toast(`«${p.name}» cambió mientras importabas; vuelve a intentarlo.`, 'error', 7000); skipped++; } else throw e2; }
      } else skipped++;
    }
  }
  toast(`Importación: ${created} nuevo(s), ${replaced} reemplazado(s), ${skipped} omitido(s).`, 'info', 6000);
  if (route.name === 'home') await enterRoute(); else render();
}

// ---------------------------------------------------------------- arranque
function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('tml:theme') || 'auto'; } catch {}
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  const btn = document.getElementById('theme');
  btn.title = btn.ariaLabel = `Tema: ${{ auto: 'automático', light: 'claro', dark: 'oscuro' }[t]}`;
}
document.getElementById('theme').addEventListener('click', () => {
  let t = 'auto';
  try { t = localStorage.getItem('tml:theme') || 'auto'; } catch {}
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[t];
  try { localStorage.setItem('tml:theme', next); } catch {}
  applyTheme();
});
document.getElementById('logout').addEventListener('click', async () => {
  if (sync.syncState().pending && !(await confirmDlg('Hay cambios sin subir', 'Si sales ahora se pierden. ¿Salir igual?', 'Salir', true))) return;
  await sync.logout();
  location.hash = '#/entrar';
});

async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator) {
    // Un deploy nuevo instala otro service worker; cuando toma el control, se recarga para usar los archivos nuevos
    // (si estás escribiendo, espera a que salgas del campo; lo pendiente ya está guardado en el navegador).
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      const reload = () => { sync.flush().finally(() => location.reload()); };
      const a = document.activeElement;
      if (a && a.matches && a.matches('input, textarea')) a.addEventListener('blur', reload, { once: true }); else reload();
    });
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  sync.startBackgroundSync();
  route = parseRoute();
  try {
    const s = await sync.session();
    ui.problems = s.problems || [];
    if (!s.auth) { route = { name: 'login' }; if (location.hash !== '#/entrar') history.replaceState(null, '', '#/entrar'); render(); return; }
    if (route.name === 'login') { route = { name: 'home' }; history.replaceState(null, '', '#/'); }
  } catch (e) {
    if (!(e instanceof sync.NetError)) { toast(e.message, 'error'); }
    // sin red: se trabaja con la copia local
  }
  await enterRoute();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && route.id && !sync.hasPending(route.id)) sync.loadProject(route.id).catch(() => {});
    if (document.visibilityState === 'hidden') sync.flush();
  });
}
boot();
