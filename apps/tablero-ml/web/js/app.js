/* ML Project Board: hash router, views and events (production mode, English UI).
   Routes: #/ (projects) · #/login · #/new · #/p/<id> (map) · #/p/<id>/sizing · #/p/<id>/log · #/p/<id>/decisions
           #/p/<id>/settings · #/p/<id>/step/<stepId>   (v1 links with /paso/, /bitacora, /decisiones, /proyecto still work)
   Every change goes through sync.commit(ops): it shows at once, is kept in the browser and is sent to the server. */
import * as sync from './sync.js';
import { esc, rich, icon, safeHref, isExternal, days, daysText, daysLevel, fmtDate, toast, dialog, confirmDlg, copyText, download, todayLocal } from './lib.js';
import { mapHtml, layoutMap } from './map.js';
import { STATUS, STATUS_LABEL, VUELTA_STATUS, TRAMOS, TRAMO_LABEL, SPEED_LABEL, VAR_KINDS, progress, validateProject, isId, isVarId, nowIso } from './shared/model.mjs';
import { evaluateProject, fmtNum, parse, varsOf } from './shared/calc.mjs';
import { T } from './shared/templates.mjs';
import { projectFromTemplate, addableSteps, stepFromTemplate, uniqueStepId, slugify } from './shared/factory.mjs';
import { buildSummary, gateText } from './shared/summary.mjs';
import { seedC01 } from './shared/seed-c01.mjs';

const app = document.getElementById('app');
const ui = { editing: null, editSteps: false, newPattern: 'sincrono', fx: new Set() };
let route = { name: 'home' };
let deferredRender = false;

// ---------------------------------------------------------------- router
const TAB_ALIAS = { bitacora: 'log', decisiones: 'decisions', proyecto: 'settings' };
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'login' || parts[0] === 'entrar') return { name: 'login' };
  if (parts[0] === 'new' || parts[0] === 'nuevo') return { name: 'new' };
  if (parts[0] === 'p' && parts[1]) {
    const id = parts[1];
    if ((parts[2] === 'step' || parts[2] === 'paso') && parts[3]) return { name: 'step', id, stepId: parts[3] };
    const tab = TAB_ALIAS[parts[2]] || parts[2];
    if (['sizing', 'log', 'decisions', 'settings'].includes(tab)) return { name: 'project', id, tab };
    return { name: 'project', id, tab: 'map' };
  }
  return { name: 'home' };
}
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const stepHref = (p, s) => `#/p/${esc(p.id)}/step/${esc(s.id)}`;

window.addEventListener('hashchange', async () => {
  const prev = route;
  route = parseRoute();
  ui.editing = null;
  if (!(prev.name === route.name && prev.id === route.id && route.name === 'project')) ui.editSteps = false;
  await enterRoute();
  if (!(prev.name === 'step' && route.name === 'step' && prev.stepId === route.stepId)) window.scrollTo(0, 0);
});

async function enterRoute() {
  if (sync.syncState().auth === false && route.name !== 'login') { location.hash = '#/login'; return; }
  render();
  try {
    if (route.name === 'home') { await sync.loadList(); ui.listLoaded = true; }
    if (route.id) await sync.loadProject(route.id);
  } catch (e) { handleError(e); }
  render();
}

function handleError(e) {
  if (e instanceof sync.AuthError) { location.hash = '#/login'; return; }
  if (e && e.status === 404 && route.id) { toast(`Project «${route.id}» does not exist.`, 'error'); location.hash = '#/'; return; }
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
  const txt = s.status === 'saving' ? 'Saving…'
    : s.status === 'offline' ? (s.pending ? `Offline · ${s.pending} unsynced` : 'Offline · local copy')
    : s.status === 'error' ? `Error: ${s.error || 'not saved'}`
    : s.pending ? `${s.pending} unsynced` : 'Saved';
  bar.dataset.s = s.status;
  bar.innerHTML = `<i></i><b>${esc(txt)}</b>`;
  bar.title = txt;
  const p = route.id ? sync.getProject(route.id) : null;
  document.getElementById('bar-title').textContent = p ? p.name : '';
  document.getElementById('logout').hidden = s.auth === false || route.name === 'login';
  document.title = p ? `${p.name} · ML Board` : 'ML Board';
}

sync.onChange((what) => {
  if (what === 'status') { renderBar(); return; }
  if (what === 'auth') { location.hash = '#/login'; return; }
  if (what && what.rejected) {
    toast(`${what.rejected.length} change(s) rejected: ${what.rejected[0].error}`, 'error', 8000);
    return;
  }
  if (typeof what === 'string' && what.startsWith('project:') && route.id === what.slice(8)) render();
});

// ---------------------------------------------------------------- login
function viewLogin() {
  const problems = ui.problems || [];
  return `<section class="login card">
    <img src="/icon.svg" alt="">
    <h1>ML Project Board</h1>
    <p class="muted">Private. Sign in with the password stored in Vercel as <code>APP_PASSWORD</code>.</p>
    ${problems.length ? `<div class="banner banner--error"><b>Configuration missing:</b><ul>${problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <form data-form="login">
      <label class="f">Password<input type="password" name="password" autocomplete="current-password" required data-autofocus></label>
      <button class="btn btn--primary" type="submit">Sign in</button>
      <p class="small" id="login-msg" role="alert"></p>
    </form>
  </section>`;
}

// ---------------------------------------------------------------- projects
function viewHome() {
  const list = sync.cachedList();
  const s = sync.syncState();
  const hasC01 = list.some((p) => p.id === 'c01');
  const cards = list.map((p) => {
    const d = days(p.lastActivity);
    const pct = p.total ? Math.round((p.hecho / p.total) * 100) : 0;
    const pat = T.PATTERNS[p.pattern];
    return `<a class="card pcard" href="#/p/${esc(p.id)}">
      <div class="row"><span class="chip">${esc(pat ? pat.name : p.pattern)}</span>${p.bloqueado ? `<span class="chip chip--bloqueado">${p.bloqueado} blocked</span>` : ''}</div>
      <h2>${esc(p.name)}</h2>
      <div class="pbar" aria-label="${p.hecho} of ${p.total} steps done"><i style="width:${pct}%"></i></div>
      <div class="row small"><span>${p.hecho}/${p.total} steps done</span><span class="grow"></span><span class="days" data-l="${daysLevel(d)}">${icon('clock')} ${daysText(d)}</span></div>
      ${p.next ? `<p class="small"><b>Next:</b> ${esc(p.next)}</p>` : ''}
    </a>`;
  }).join('');
  return `<div class="phead"><div><h1>Projects</h1></div>
    <div class="row"><a class="btn btn--primary" href="#/new">${icon('plus')} New project</a>
      <button class="btn" data-act="import">${icon('upload')} Import JSON</button>
      <button class="btn" data-act="export-all" ${list.length ? '' : 'disabled'}>${icon('download')} Export all</button></div></div>
    ${s.status === 'offline' ? '<div class="banner">Offline: showing the last copy saved on this device.</div>' : ''}
    ${list.length ? `<div class="cards">${cards}</div>` : !ui.listLoaded ? '<div class="card empty"><p class="muted">Loading…</p></div>' : '<div class="card empty"><h2>No projects yet</h2><p class="muted">Create one from a design pattern, or load C01 as it stands in Caso1.</p></div>'}
    ${hasC01 || !ui.listLoaded ? '' : `<div class="card" style="margin-top:12px"><h2>Load C01 (Caso1)</h2><p>Creates <b>C01 · Image Classification API (Caso1)</b> with its current state: PLAN milestones 0–10 mapped to the 13 steps, LAB_LOG measurements, decisions, work log and the sizing inputs from DESIGN.md.</p>
      <button class="btn btn--primary" data-act="seed-c01">${icon('play')} Load C01</button></div>`}
    <input type="file" id="import-file" accept="application/json,.json" hidden>`;
}

// ---------------------------------------------------------------- new project
function viewNew() {
  const pats = T.ORDER.map((id) => {
    const p = T.PATTERNS[id];
    const steps = T.STEPS[id];
    const calcs = steps.reduce((n, s) => n + (s.calcs || []).length, 0);
    return `<button type="button" class="card pat" data-act="pick-pattern" data-v="${id}" aria-pressed="${ui.newPattern === id}">
      <h3>${esc(p.name)}</h3>
      <span class="small">Reference ${esc(p.case.toUpperCase())}${p.cases.length > 1 ? ` (also ${esc(p.cases.filter((c) => c !== p.case).map((c) => c.toUpperCase()).join(', '))})` : ''} · ${steps.length} steps · ${calcs} sizing calcs</span>
      <span class="small">${esc(p.summary)}</span>
    </button>`;
  }).join('');
  const sel = T.PATTERNS[ui.newPattern];
  const steps = T.STEPS[ui.newPattern];
  return `<div class="crumbs"><a href="#/">${icon('back')} Projects</a></div>
  <h1>New project</h1>
  <form data-form="new" class="stack">
    <div class="card"><div class="grid2">
      <label class="f span2">Name<input type="text" name="name" required maxlength="160" placeholder="C14 · Demand forecasting" data-autofocus data-slug-src></label>
      <label class="f">ID (URL and API)<input type="text" name="id" maxlength="40" pattern="[a-z0-9][a-z0-9-]{0,39}" placeholder="derived from the name" data-slug-dst class="mono"></label>
      <label class="f">Repo or folder<input type="text" name="repo" maxlength="400" placeholder="~/Documents/ProyectosPortafolio/Caso14" class="mono"></label>
      <label class="f span2">Goal (one line)<input type="text" name="goal" maxlength="400"></label>
    </div></div>
    <div><h2>Design pattern</h2><p class="muted">Sets the mandatory steps and their entry-gate sizing. You can add, remove and reorder steps later.</p>
      <div class="patterns">${pats}</div></div>
    <div class="card"><h2>${esc(sel.name)} · ${steps.length} steps</h2>
      ${sel.removed.length ? `<p class="small"><b>Not in this pattern (vs C01):</b> ${sel.removed.map((r) => `${esc(T.STATIONS.find((s) => s.id === r.id)?.title || r.id)} — ${esc(r.why)}`).join(' · ')}</p>` : ''}
      <ol class="pat">${steps.map((s) => `<li class="ln-${s.speed}"><b>${esc(s.title)}</b>${(s.calcs || []).length ? ` <span class="chip chip--gate">${s.calcs.length} calcs</span>` : ''}${s.status === 'nuevo' ? ' <span class="chip chip--line">pattern-specific</span>' : s.status === 'cambia' ? ' <span class="chip">differs from C01</span>' : ''}</li>`).join('')}</ol>
      <div class="links">${sel.links.map(linkHtml).join('')}</div>
    </div>
    <div class="row row--end"><a class="btn" href="#/">Cancel</a><button class="btn btn--primary" type="submit">${icon('plus')} Create project</button></div>
  </form>`;
}

// ---------------------------------------------------------------- project
function projectOr404() {
  const p = sync.getProject(route.id);
  if (!p) return { html: '<div class="card empty"><h2>Loading…</h2><p class="muted">Offline and never opened on this device: no local copy to show.</p><a class="btn" href="#/">Back to projects</a></div>' };
  return { p };
}

function viewProject() {
  const { p, html } = projectOr404();
  if (!p) return html;
  const ev = evaluateProject(p);
  const pat = T.PATTERNS[p.pattern];
  const tab = route.tab;
  const openVars = (p.vars || []).filter((v) => !String(v.value).trim()).length;
  const tabs = [['map', 'Map', 'map'], ['sizing', `Sizing${openVars ? ` (${openVars} unset)` : ''}`, 'calc'], ['log', `Work log (${p.sessions.length})`, 'log'], ['decisions', `Decisions (${p.decisions.length})`, 'scale'], ['settings', 'Settings', 'gear']];
  const base = `#/p/${esc(p.id)}`;
  let body = '';
  if (tab === 'sizing') body = tabSizing(p, ev);
  else if (tab === 'log') body = tabLog(p);
  else if (tab === 'decisions') body = tabDecisions(p);
  else if (tab === 'settings') body = tabSettings(p);
  else body = tabMap(p, ev);
  return `<div class="crumbs"><a href="#/">${icon('back')} Projects</a></div>
  <div class="phead"><div><h1>${esc(p.name)}</h1>
    <div class="row small"><span class="chip">${esc(pat ? pat.name : p.pattern)}</span>${p.repo ? `<code>${esc(p.repo)}</code>` : ''}<span>Pass ${p.vueltaActual} (${p.vueltaActual === 2 ? 'solo' : 'guided'})</span></div></div>
    <div class="row"><button class="btn btn--primary" data-act="summary">${icon('doc')} Resume brief</button><button class="btn" data-act="session-new">${icon('log')} Log session</button></div></div>
  ${statusPanel(p, ev)}
  <nav class="tabs" aria-label="Project sections">${tabs.map(([id, label, ic]) => `<a href="${id === 'map' ? base : `${base}/${id}`}" ${tab === id ? 'aria-current="page"' : ''}>${icon(ic)} ${esc(label)}</a>`).join('')}</nav>
  ${body}
  <p class="footer">Revision ${p.rev} · updated ${fmtDate(p.updatedAt)}</p>`;
}

function statusPanel(p, ev) {
  const d = days(p.lastActivity);
  const pr = progress(p);
  const next = p.steps.find((s) => s.id === p.resume.nextStepId);
  const blocked = p.steps.filter((s) => s.status === 'bloqueado');
  const doing = p.steps.filter((s) => s.status === 'en_curso');
  const gated = p.steps.filter((s) => s.status !== 'no_aplica' && s.calcs.length);
  const met = gated.filter((s) => ev.gates[s.id].met).length;
  const last = [...p.sessions].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const stepLink = (s) => `<a href="${stepHref(p, s)}">${esc(s.title)}</a>`;
  const editing = ui.editing === 'resume';
  const left = editing ? `<form data-form="resume">
      <label class="f">Where I left off<textarea name="where" rows="4" data-autofocus>${esc(p.resume.where)}</textarea></label>
      <label class="f">Next action<textarea name="next" rows="3">${esc(p.resume.next)}</textarea></label>
      <label class="f">Step on the map<select name="nextStepId"><option value="">(none)</option>${p.steps.map((s, i) => `<option value="${esc(s.id)}" ${s.id === p.resume.nextStepId ? 'selected' : ''}>${i + 1}. ${esc(s.title)}</option>`).join('')}</select></label>
      <div class="row row--end"><button class="btn" type="button" data-act="cancel-edit">Cancel</button><button class="btn btn--primary" type="submit">Save</button></div>
    </form>`
    : `<div class="rblock"><div class="k">Where I left off</div><div class="rtext">${rich(p.resume.where)}</div></div>
      <div class="rblock"><div class="k">Next action</div><div class="rtext">${rich(p.resume.next)}</div>
        ${next ? `<p class="small" style="margin-top:6px">${icon('flag')} ${stepLink(next)} · entry gate ${esc(gateText(ev.gates[next.id]))}</p>` : ''}</div>
      <div class="row" style="margin-top:10px"><button class="btn btn--sm" data-act="edit-resume">${icon('edit')} Edit</button></div>`;
  return `<section class="card resume" aria-label="Status">
    <div><h2>${icon('play')} Status</h2>${left}</div>
    <div class="stack">
      <div class="stats">
        <div class="stat" data-l="${daysLevel(d)}"><b>${d ?? '—'}</b><span>${d === 1 ? 'day' : 'days'} idle</span></div>
        <div class="stat"><b>${pr.hecho}/${pr.total}</b><span>steps done</span></div>
        <div class="stat"><b>${met}/${gated.length}</b><span>entry gates met</span></div>
      </div>
      <div><div class="k">Open blockers</div>${blocked.length ? `<ul class="mini">${blocked.map((s) => `<li>${icon('alert')} <span>${stepLink(s)}: ${esc(s.reason || 'no reason given')}</span></li>`).join('')}</ul>` : '<p class="small">None.</p>'}</div>
      <div><div class="k">In progress</div>${doing.length ? `<ul class="mini">${doing.map((s) => `<li>◎ ${stepLink(s)}</li>`).join('')}</ul>` : '<p class="small">Nothing in progress.</p>'}</div>
      <div><div class="k">Last session</div>${last ? `<p class="small"><b>${fmtDate(last.date)}</b>${last.source === 'claude' ? ' <span class="chip chip--claude">Claude Code</span>' : ''}${last.next ? ` · Next: ${rich(last.next)}` : last.did ? ` · ${rich(last.did)}` : ''}</p>` : '<p class="small">No sessions yet.</p>'}</div>
    </div>
  </section>`;
}

function tabMap(p, ev) {
  if (ui.editSteps) {
    return `<div class="row" style="margin-bottom:10px"><h2 class="grow" style="margin:0">Edit steps</h2><button class="btn btn--primary" data-act="edit-steps-done">${icon('check')} Done</button></div>
    <div class="edit-steps">${p.steps.map((s, i) => `<div class="erow ln-${s.speed}"><span class="dotmini"></span><span class="grow">${i + 1}. ${esc(s.title)} <span class="small">· ${TRAMO_LABEL[s.tramo]}</span></span>
      <button class="btn btn--sm btn--icon" data-act="step-move" data-id="${esc(s.id)}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up')}</button>
      <button class="btn btn--sm btn--icon" data-act="step-move" data-id="${esc(s.id)}" data-d="1" ${i === p.steps.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down')}</button>
      <button class="btn btn--sm btn--icon btn--danger" data-act="step-remove" data-id="${esc(s.id)}" aria-label="Remove">${icon('trash')}</button></div>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="step-add">${icon('plus')} Add step</button></div>`;
  }
  return `${mapHtml(p, ev)}
  <div class="row" style="margin-top:12px"><button class="btn" data-act="edit-steps">${icon('edit')} Add, remove or reorder steps</button></div>`;
}

// Sizing sheet: every input of the project and every entry-gate calc, by step.
function tabSizing(p, ev) {
  const P = (...k) => esc(JSON.stringify(['vars', ...k]));
  const used = new Set();
  for (const s of p.steps) for (const c of s.calcs) { try { varsOf(parse(c.expr), used); if (c.check) varsOf(parse(c.check.expr), used); } catch {} }
  const kinds = VAR_KINDS.filter((k) => p.vars.some((v) => v.kind === k));
  const rows = (k) => p.vars.filter((v) => v.kind === k).map((v) => `<tr>
      <td><b>${esc(v.label)}</b><br><code>${esc(v.id)}</code>${used.has(v.id) ? '' : ' <span class="small">unused</span>'}</td>
      <td><input type="text" inputmode="decimal" value="${esc(v.value)}" placeholder="${esc(v.ref ? `ref ${v.ref}` : '')}" data-bind='${P(`#${v.id}`, 'value')}' aria-label="${esc(v.label)}"> <span class="calc__unit">${esc(v.unit)}</span></td>
      <td class="src small">${rich(v.source)}${v.ref ? ` · reference: <code>${esc(v.ref)}</code>` : ''}</td>
      <td><button class="btn btn--sm btn--icon btn--ghost btn--danger" data-act="var-del" data-id="${esc(v.id)}" aria-label="Remove">${icon('trash')}</button></td></tr>`).join('');
  const steps = p.steps.filter((s) => s.calcs.length);
  return `<div class="stack">
  <section class="card"><h2>${icon('calc')} Inputs</h2>
    <p class="small">Requirements, assumptions and benchmarks for this system. Every entry-gate calc reads from here; a calc's result becomes an input for later steps.</p>
    ${p.vars.length ? `<div class="tablewrap"><table class="vars"><thead><tr><th>Variable</th><th>Value</th><th>Source</th><th></th></tr></thead>
      ${kinds.map((k) => `<tbody><tr><th colspan="4">${esc(k)}</th></tr>${rows(k)}</tbody>`).join('')}</table></div>` : '<p class="small">No inputs.</p>'}
    <div class="row" style="margin-top:10px"><button class="btn btn--sm" data-act="var-new">${icon('plus')} Add input</button></div>
  </section>
  <section class="card"><h2>${icon('lock')} Entry gates</h2>
    ${steps.length ? `<ul class="mini">${steps.map((s) => {
      const g = ev.gates[s.id];
      const st = s.status === 'no_aplica' ? 'chip' : g.met ? 'chip chip--hecho' : g.waived ? 'chip chip--waived' : 'chip chip--gate';
      return `<li><span class="${st}">${esc(s.status === 'no_aplica' ? 'N/A' : gateText(g))}</span> <a href="${stepHref(p, s)}">${esc(s.title)}</a> <span class="small">${s.calcs.map((c) => esc(c.label)).join(' · ')}</span></li>`;
    }).join('')}</ul>` : '<p class="small">No calcs.</p>'}
  </section></div>`;
}

function tabLog(p) {
  const list = [...p.sessions].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  const stepTitle = (id) => (p.steps.find((s) => s.id === id) || { title: id }).title;
  return `<div class="row" style="margin-bottom:10px"><p class="muted grow" style="margin:0">One entry per working session: what you did, what you measured, what's next. Claude Code writes here with its token.</p>
    <button class="btn btn--primary" data-act="session-new">${icon('plus')} Log session</button></div>
  ${list.length ? `<ol class="log">${list.map((s) => `<li><div class="card">
    <div class="row"><b class="grow">${fmtDate(s.date)}</b>${s.source === 'claude' ? '<span class="chip chip--claude">Claude Code</span>' : s.source === 'import' ? '<span class="chip">imported</span>' : ''}
      <button class="btn btn--sm btn--icon btn--ghost" data-act="session-edit" data-id="${esc(s.id)}" aria-label="Edit">${icon('edit')}</button>
      <button class="btn btn--sm btn--icon btn--ghost btn--danger" data-act="session-del" data-id="${esc(s.id)}" aria-label="Delete">${icon('trash')}</button></div>
    <dl>${s.did ? `<dt>Did</dt><dd>${rich(s.did)}</dd>` : ''}${s.measured ? `<dt>Measured</dt><dd>${rich(s.measured)}</dd>` : ''}${s.next ? `<dt>Next</dt><dd>${rich(s.next)}</dd>` : ''}</dl>
    ${s.stepIds.length ? `<div class="row" style="margin-top:8px">${s.stepIds.map((id) => `<a class="chip" href="#/p/${esc(p.id)}/step/${esc(id)}">${esc(stepTitle(id))}</a>`).join('')}</div>` : ''}
  </div></li>`).join('')}</ol>` : '<div class="card empty"><p>No sessions yet.</p></div>'}`;
}

function tabDecisions(p) {
  const list = [...p.decisions].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  return `<div class="row" style="margin-bottom:10px"><p class="muted grow" style="margin:0">Architecture decision records: what you chose, over what, and why.</p>
    <button class="btn btn--primary" data-act="decision-new">${icon('plus')} New decision</button></div>
  ${list.length ? `<ol class="log">${list.map((d) => decisionCard(p, d)).join('')}</ol>` : '<div class="card empty"><p>No decisions yet.</p></div>'}`;
}

function decisionCard(p, d) {
  const s = p.steps.find((x) => x.id === d.stepId);
  return `<li><div class="card">
    <div class="row"><b class="grow">${rich(d.what)}</b>${d.status === 'revisada' ? '<span class="chip">superseded</span>' : ''}
      <button class="btn btn--sm btn--icon btn--ghost" data-act="decision-edit" data-id="${esc(d.id)}" aria-label="Edit">${icon('edit')}</button>
      <button class="btn btn--sm btn--icon btn--ghost btn--danger" data-act="decision-del" data-id="${esc(d.id)}" aria-label="Delete">${icon('trash')}</button></div>
    <dl>${d.against ? `<dt>Over</dt><dd>${rich(d.against)}</dd>` : ''}<dt>Why</dt><dd>${rich(d.why)}</dd></dl>
    <p class="small" style="margin:8px 0 0">${fmtDate(d.date)}${s ? ` · <a href="${stepHref(p, s)}">${esc(s.title)}</a>` : ''}</p>
  </div></li>`;
}

function tabSettings(p) {
  const pat = T.PATTERNS[p.pattern];
  const missing = (T.STEPS[p.pattern] || []).filter((t) => !p.steps.some((s) => (s.base || s.id) === t.id));
  const origin = location.origin;
  const P = (s) => `["${s}"]`;
  const curl = `curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" ${origin}/api/claude/${p.id}`;
  return `<div class="stack">
  <div class="card"><h2>Project</h2><div class="grid2">
    <label class="f span2">Name<input type="text" maxlength="160" value="${esc(p.name)}" data-bind='${P('name')}'></label>
    <label class="f">Repo or folder<input type="text" class="mono" maxlength="400" value="${esc(p.repo)}" data-bind='${P('repo')}'></label>
    <label class="f">Goal<input type="text" maxlength="400" value="${esc(p.goal)}" data-bind='${P('goal')}'></label>
  </div>
  <div class="k" style="margin-top:4px">Current pass</div>
  <div class="seg" style="margin-top:6px">${[1, 2].map((v) => `<button data-act="set" data-path='["vueltaActual"]' data-value="${v}" aria-pressed="${p.vueltaActual === v}">Pass ${v} · ${v === 1 ? 'guided' : 'solo'}</button>`).join('')}</div>
  </div>
  <div class="card"><h2>Pattern: ${esc(pat ? pat.name : p.pattern)}</h2><p>${esc(pat ? pat.summary : '')}</p>
    ${missing.length ? `<p>Missing ${missing.length} step(s) of this pattern: ${missing.map((t) => esc(t.title)).join(', ')}.</p><button class="btn" data-act="add-missing">${icon('plus')} Add missing steps</button>` : '<p class="small">All pattern steps present.</p>'}
    <div class="links" style="margin-top:10px">${pat ? pat.links.map(linkHtml).join('') : ''}</div></div>
  <div class="card"><h2>${icon('terminal')} Claude Code</h2>
    <p>Claude Code sessions read and update this project with their own token (<code>API_TOKEN</code> in Vercel; locally in a git-ignored <code>.env</code>). The CLAUDE.md text is in the board's README.</p>
    <pre class="cmd">${esc(curl)}</pre>
    <div class="row" style="margin-top:8px"><button class="btn btn--sm" data-act="copy" data-text="${esc(curl)}">${icon('copy')} Copy</button></div>
    <p class="small" style="margin-top:8px">Step ids: ${p.steps.map((s) => `<code>${esc(s.id)}</code>`).join(' ')}</p></div>
  <div class="card"><h2>Backup</h2><p>The server keeps a copy of each version (at most one every 10 minutes, the last 30). You can also export the project as JSON.</p>
    <div class="row"><button class="btn" data-act="export-one">${icon('download')} Export project</button><button class="btn" data-act="history">${icon('clock')} Version history</button><button class="btn" data-act="import">${icon('upload')} Import JSON</button></div></div>
  <div class="card"><h2>Delete</h2><p class="small">Kept for 30 days in the server's trash; restore it from a JSON backup.</p><button class="btn btn--danger" data-act="project-delete">${icon('trash')} Delete project</button></div>
  <input type="file" id="import-file" accept="application/json,.json" hidden>
  </div>`;
}

// ---------------------------------------------------------------- step
const LISTS = {
  hitos: { title: 'Milestones', icon: 'flag', add: 'Add milestone', empty: 'No milestones.',
    fields: [{ k: 'text', label: 'Milestone', req: true }, { k: 'status', label: 'Status', type: 'select', options: STATUS.map((s) => [s, STATUS_LABEL[s]]) }, { k: 'done', label: 'Done when', type: 'textarea' }],
    view: (h) => `<div class="grow"><div class="row"><b class="grow">${rich(h.text)}</b><span class="chip chip--${h.status}">${STATUS_LABEL[h.status]}</span></div>${h.done ? `<p class="small" style="margin-top:4px">Done when: ${rich(h.done)}</p>` : ''}</div>` },
  done: { title: 'Definition of Done', icon: 'check', add: 'Add criterion', empty: 'No criteria.',
    fields: [{ k: 'text', label: 'Criterion', type: 'textarea', req: true }] },
  results: { title: 'Measurements', icon: 'scale', add: 'Add measurement', empty: 'No measurements yet. Record every number with its unit, date and conditions.',
    fields: [{ k: 'name', label: 'Metric', req: true }, { k: 'value', label: 'Value', req: true }, { k: 'unit', label: 'Unit (ms, req/s, MB, %…)' }, { k: 'date', label: 'Date', type: 'date' }, { k: 'note', label: 'Conditions / command', type: 'textarea', span: true }],
    view: (r) => `<div class="grow res"><span>${rich(r.name)}</span><span class="res__v">${esc(r.value)} <small>${esc(r.unit)}</small></span>${r.note || r.date ? `<span class="small" style="grid-column:1/-1">${r.date ? fmtDate(r.date) : ''}${r.note && r.date ? ' · ' : ''}${rich(r.note)}</span>` : ''}</div>` },
  commands: { title: 'Runbook', icon: 'terminal', add: 'Add command', empty: 'No commands.',
    fields: [{ k: 'code', label: 'Command', type: 'mono', req: true }, { k: 'note', label: 'Purpose', type: 'textarea' }],
    view: (c) => `<div class="grow"><pre class="cmd">${esc(c.code)}</pre>${c.note ? `<p class="small" style="margin-top:4px">${rich(c.note)}</p>` : ''}</div>`,
    extra: (c) => `<button class="btn btn--sm btn--icon btn--ghost" data-act="copy" data-text="${esc(c.code)}" aria-label="Copy">${icon('copy')}</button>` },
  files: { title: 'Artifacts & commits', icon: 'doc', add: 'Add artifact', empty: 'No artifacts.',
    fields: [{ k: 'path', label: 'Path or file', req: true, mono: true }, { k: 'ref', label: 'Commit, branch or state' }],
    view: (f) => `<div class="grow"><code>${esc(f.path)}</code>${f.ref ? ` <span class="small">${rich(f.ref)}</span>` : ''}</div>` },
  links: { title: 'References', icon: 'book', add: 'Add link', empty: 'No links.',
    fields: [{ k: 'label', label: 'Label', req: true }, { k: 'href', label: 'URL (https://…)', req: true, mono: true }],
    view: (l) => `<div class="grow links">${linkHtml(l)}</div>` },
  calcs: { title: 'Custom calc', icon: 'calc', add: 'Add calc', empty: '',
    fields: [{ k: 'label', label: 'Label', req: true }, { k: 'out', label: 'Output variable (snake_case)', req: true, mono: true }, { k: 'expr', label: 'Formula (inputs by name; ceil, max, min, ceilto…)', type: 'mono', req: true }, { k: 'unit', label: 'Unit' }, { k: 'tol', label: 'Tolerance (0 = exact, 0.02 = 2 %)' }, { k: 'why', label: 'Drives which decision', type: 'textarea' }] },
};

function linkHtml(l) {
  const href = safeHref(l.href);
  const ext = isExternal(href);
  return `<a href="${esc(href)}" ${ext ? 'target="_blank" rel="noopener noreferrer"' : ''}>${icon(/^(Hoja|Sheet)/.test(l.label) ? 'doc' : 'book')}<span>${esc(l.label)}</span>${ext ? icon('ext') : ''}</a>`;
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

function itemForm(path, key, item) {
  const L = LISTS[key];
  return `<form class="form" data-form="item" data-path='${esc(JSON.stringify(path))}' data-id="${item ? esc(item.id) : ''}" data-list="${key}">
    <div class="grid2">${L.fields.map((f) => fieldHtml(f, item ? item[f.k] : f.k === 'status' ? 'pendiente' : f.k === 'tol' ? '0.02' : '')).join('')}</div>
    <div class="row row--end"><button class="btn" type="button" data-act="cancel-edit">Cancel</button><button class="btn btn--primary" type="submit">Save</button></div>
  </form>`;
}

function listSection(p, s, key) {
  const L = LISTS[key];
  const items = s[key];
  const path = ['steps', `#${s.id}`, key];
  const jpath = JSON.stringify(path);
  const editKey = (id) => `${s.id}:${key}:${id}`;
  const row = (it) => {
    if (ui.editing === editKey(it.id)) return `<li>${itemForm(path, key, it)}</li>`;
    const acts = `<span class="item__acts">${L.extra ? L.extra(it) : ''}<button class="btn btn--sm btn--icon btn--ghost" data-act="item-edit" data-key="${esc(editKey(it.id))}" aria-label="Edit">${icon('edit')}</button><button class="btn btn--sm btn--icon btn--ghost btn--danger" data-act="item-del" data-path='${esc(jpath)}' data-id="${esc(it.id)}" aria-label="Delete">${icon('trash')}</button></span>`;
    if (key === 'done') {
      return `<li class="item ${it.ok ? 'item--ok' : ''}"><input type="checkbox" class="check" ${it.ok ? 'checked' : ''} data-act="toggle-done" data-path='${esc(JSON.stringify(['steps', `#${s.id}`, 'done', `#${it.id}`, 'ok']))}' aria-label="Met"><div class="grow item__text">${rich(it.text)}</div>${acts}</li>`;
    }
    return `<li class="item">${L.view(it)}${acts}</li>`;
  };
  const count = key === 'done' ? `${items.filter((d) => d.ok).length}/${items.length}` : key === 'hitos' ? `${items.filter((h) => h.status === 'hecho').length}/${items.length}` : items.length;
  return `<section class="sec card"><h2>${icon(L.icon)} ${L.title} <span class="count">${items.length ? count : ''}</span></h2>
    ${items.length || ui.editing === editKey('new') ? `<ul class="items">${items.map(row).join('')}${ui.editing === editKey('new') ? `<li>${itemForm(path, key, null)}</li>` : ''}</ul>` : `<p class="small">${L.empty}</p>`}
    ${ui.editing === editKey('new') ? '' : `<div class="row" style="margin-top:10px"><button class="btn btn--sm" data-act="item-edit" data-key="${esc(editKey('new'))}">${icon('plus')} ${L.add}</button></div>`}
  </section>`;
}

const CALC_CHIP = {
  ok: ['chip chip--hecho', '✓ matches'], revealed: ['chip chip--revealed', 'revealed'], wrong: ['chip chip--wrong', '✗ off'],
  todo: ['chip', 'to do'], blocked: ['chip chip--bloqueado', 'blocked'], error: ['chip chip--wrong', 'formula error'],
};

function gateSection(p, s, ev) {
  if (s.status === 'no_aplica' && !s.calcs.length) return '';
  const g = ev.gates[s.id];
  const state = !s.calcs.length ? 'met' : g.met ? 'met' : g.waived ? 'waived' : 'open';
  const varById = Object.fromEntries((p.vars || []).map((v) => [v.id, v]));
  const producer = {};
  p.steps.forEach((st) => st.calcs.forEach((c) => { if (c.out) producer[c.out] = { step: st, calc: c }; }));
  // An input is shown with its value only if it is a project input or a calc you already matched or revealed.
  const known = (n) => {
    if (varById[n]) return n in ev.env;
    const pr = producer[n];
    if (!pr) return false;
    const r = ev.calcs[`${pr.step.id}/${pr.calc.id}`];
    return !!r && (r.status === 'ok' || r.status === 'revealed');
  };
  const calcRow = (c) => {
    const r = ev.calcs[`${s.id}/${c.id}`] || { status: 'error' };
    const key = `${s.id}/${c.id}`;
    let names = [];
    try { names = [...varsOf(parse(c.expr))]; } catch {}
    const inputs = names.map((n) => {
      const v = varById[n];
      const pr = producer[n];
      const from = !v && pr && pr.step.id !== s.id ? ` (from ${esc(pr.step.title)})` : '';
      if (!(n in ev.env)) return `<span class="miss">${esc(n)} = unset${from}</span>`;
      if (!known(n)) return `<span class="miss">${esc(n)} = ? — do «${esc(pr ? pr.calc.label : n)}» first${from}</span>`;
      return `${esc(n)} = ${esc(fmtNum(ev.env[n]))}${v && v.unit ? ' ' + esc(v.unit) : pr && pr.calc.unit ? ' ' + esc(pr.calc.unit) : ''}${from}`;
    });
    const [cls, txt] = CALC_CHIP[r.status] || CALC_CHIP.error;
    const ap = esc(JSON.stringify(['steps', `#${s.id}`, 'calcs', `#${c.id}`, 'answer']));
    const showFx = ui.fx.has(key);
    const blocked = r.status === 'blocked' || r.status === 'error';
    const shown = r.status === 'revealed' || r.status === 'ok';
    return `<li class="calc">
      <div class="calc__head"><b>${esc(c.label)}</b><span class="${cls}">${txt}</span>${c.revealed && r.status === 'ok' ? '<span class="chip chip--revealed">was revealed</span>' : ''}<span class="small"><code>${esc(c.out || c.id)}</code></span></div>
      ${c.why ? `<p class="calc__why">${rich(c.why)}</p>` : ''}
      ${inputs.length ? `<div class="calc__in">${inputs.join(' · ')}</div>` : ''}
      <div class="calc__row">
        <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="your result" value="${esc(c.answer)}" data-bind='${ap}' data-calc ${blocked ? 'disabled' : ''} aria-label="${esc(`Your result for ${c.label}`)}">
        <span class="calc__unit">${esc(c.unit)}</span>
        <button class="btn btn--sm btn--ghost" data-act="fx" data-key="${esc(key)}" aria-pressed="${showFx}">${icon('fx')} Formula</button>
        ${shown ? `<span class="calc__val">= ${esc(fmtNum(r.value))} ${esc(c.unit)}</span>` : blocked ? '' : `<button class="btn btn--sm btn--ghost" data-act="reveal" data-calc="${esc(c.id)}">${icon('eye')} Reveal</button>`}
      </div>
      ${showFx ? `<div class="calc__fx">${esc(c.out || c.id)} = ${esc(c.expr)}${c.tol ? ` · tolerance ±${esc(String(Math.round(c.tol * 1000) / 10))} %` : ' · exact'}${r.error ? ` · ${esc(r.error)}` : ''}</div>` : ''}
      ${r.check && (r.status === 'ok' || r.status === 'revealed') ? `<div class="calc__check" data-ok="${r.check.ok}">${r.check.ok ? '✓' : '✗'} ${esc(r.check.label)}</div>` : r.check ? `<div class="calc__check">Check: ${esc(r.check.label)}</div>` : ''}
      ${c.ref ? `<p class="small" style="margin:6px 0 0"><a href="${esc(safeHref(c.ref.startsWith('#') ? T.COURSE_URL + c.ref : c.ref))}" target="_blank" rel="noopener noreferrer">${icon('book')} Course · ${esc(c.ref.replace(/^#/, '').replace('.', ' · '))}</a></p>` : ''}
    </li>`;
  };
  const head = !s.calcs.length ? 'No sizing required for this step.'
    : g.met ? `Met: ${g.done} matched${g.revealed ? `, ${g.revealed} revealed` : ''}.`
    : `${g.need - g.done - g.revealed} of ${g.need} calcs left${g.failedChecks ? `, ${g.failedChecks} check(s) failing` : ''}${g.blocked ? ` · ${g.blocked} blocked on unset inputs` : ''}. The step can't move to In progress or Done until the gate is met or waived.`;
  const custom = ui.editing === `${s.id}:calcs:new` ? itemForm(['steps', `#${s.id}`, 'calcs'], 'calcs', null) : '';
  return `<section class="sec card gate" data-state="${state}"><h2>${icon(state === 'open' ? 'lock' : 'unlock')} Entry gate <span class="count">${s.calcs.length ? `${g.done + g.revealed}/${g.need}` : ''}</span></h2>
    <p class="small">${head}</p>
    ${s.gate.waived ? `<div class="banner"><b>Waiver on file</b>${s.gate.at ? ` (${esc(fmtDate(s.gate.at))})` : ''}: ${rich(s.gate.reason)} <button class="btn btn--sm" data-act="waiver-revoke">Revoke</button></div>` : ''}
    ${s.calcs.length ? `<ul class="calcs">${s.calcs.map(calcRow).join('')}</ul>` : ''}
    ${custom}
    <div class="row" style="margin-top:10px">${custom ? '' : `<button class="btn btn--sm" data-act="item-edit" data-key="${esc(`${s.id}:calcs:new`)}">${icon('plus')} Add calc</button>`}
      ${state === 'open' && !s.gate.waived ? '<button class="btn btn--sm" data-act="waiver">File waiver</button>' : ''}
      <a class="btn btn--sm btn--ghost" href="#/p/${esc(p.id)}/sizing">${icon('calc')} Inputs</a></div>
  </section>`;
}

function viewStep() {
  const { p, html } = projectOr404();
  if (!p) return html;
  const i = p.steps.findIndex((s) => s.id === route.stepId);
  if (i < 0) return `<div class="card empty"><h2>This step no longer exists</h2><a class="btn" href="#/p/${esc(p.id)}">Back to the map</a></div>`;
  const ev = evaluateProject(p);
  const s = p.steps[i];
  const prev = p.steps[i - 1], next = p.steps[i + 1];
  const P = (...k) => esc(JSON.stringify(['steps', `#${s.id}`, ...k]));
  const decisions = p.decisions.filter((d) => d.stepId === s.id);
  const isNext = p.resume.nextStepId === s.id;
  const open = ev.gates[s.id] && ev.gates[s.id].open && s.calcs.length;
  const PASS = { pendiente: 'To do', en_curso: 'In progress', hecho: 'Done' };
  const locked = (st) => open && (st === 'en_curso' || st === 'hecho') && s.status !== st;
  return `<div class="crumbs"><a href="#/p/${esc(p.id)}">${icon('back')} ${esc(p.name)}</a></div>
  <header class="shead ln-${s.speed}">
    <div class="row small"><span class="k">Step ${i + 1} of ${p.steps.length}</span><span class="chip chip--line">${TRAMO_LABEL[s.tramo]} · ${SPEED_LABEL[s.speed]}</span>${isNext ? '<span class="chip chip--next">Next action</span>' : ''}</div>
    <h1>${esc(s.title)}</h1>
    ${s.note ? `<p>${rich(s.note)}</p>` : ''}
  </header>
  <section class="card">
    <div class="k">Status</div>
    <div class="seg" style="margin:6px 0 10px">${STATUS.map((st) => `<button class="st-${st}" data-act="step-status" data-v="${st}" aria-pressed="${s.status === st}" ${locked(st) ? 'title="Entry gate open"' : ''}>${locked(st) ? icon('lock') + ' ' : ''}${STATUS_LABEL[st]}</button>`).join('')}</div>
    ${s.status === 'no_aplica' || s.status === 'bloqueado' || s.reason ? `<label class="f">${s.status === 'bloqueado' ? 'Blocked by' : s.status === 'no_aplica' ? 'Why N/A' : 'Reason'}<input type="text" maxlength="400" value="${esc(s.reason)}" data-bind='${P('reason')}'></label>` : ''}
    <div class="grid2">
      <div><div class="k">Pass 1 · guided</div><div class="seg" style="margin-top:6px">${VUELTA_STATUS.map((v) => `<button class="st-${v}" data-act="set" data-path='${P('vuelta', 'v1')}' data-value='"${v}"' aria-pressed="${s.vuelta.v1 === v}">${PASS[v]}</button>`).join('')}</div></div>
      <div><div class="k">Pass 2 · solo</div><div class="seg" style="margin-top:6px">${VUELTA_STATUS.map((v) => `<button class="st-${v}" data-act="set" data-path='${P('vuelta', 'v2')}' data-value='"${v}"' aria-pressed="${s.vuelta.v2 === v}">${PASS[v]}</button>`).join('')}</div></div>
    </div>
    <div class="row" style="margin-top:12px">${isNext ? '' : `<button class="btn btn--sm" data-act="make-next">${icon('flag')} Set as next action</button>`}<button class="btn btn--sm" data-act="session-new" data-step="${esc(s.id)}">${icon('log')} Log session on this step</button></div>
    ${s.inputs.length || s.outputs.length ? `<div class="grid2" style="margin-top:12px">
      <div><div class="k">Inputs</div><ul class="mini">${s.inputs.map((x) => `<li>→ ${rich(x)}</li>`).join('') || '<li class="small">—</li>'}</ul></div>
      <div><div class="k">Outputs</div><ul class="mini">${s.outputs.map((x) => `<li>← ${rich(x)}</li>`).join('') || '<li class="small">—</li>'}</ul></div></div>` : ''}
  </section>
  ${gateSection(p, s, ev)}
  ${listSection(p, s, 'done')}
  ${listSection(p, s, 'hitos')}
  ${listSection(p, s, 'results')}
  <section class="sec card"><h2>${icon('edit')} Notes</h2>
    <textarea rows="8" data-bind='${P('notes')}' placeholder="Calculations, results, incidents…">${esc(s.notes)}</textarea></section>
  ${listSection(p, s, 'commands')}
  ${listSection(p, s, 'files')}
  <section class="sec card"><h2>${icon('scale')} Decisions <span class="count">${decisions.length || ''}</span></h2>
    ${decisions.length ? `<ol class="log">${decisions.map((d) => decisionCard(p, d)).join('')}</ol>` : '<p class="small">No decisions on this step.</p>'}
    <div class="row" style="margin-top:10px"><button class="btn btn--sm" data-act="decision-new" data-step="${esc(s.id)}">${icon('plus')} New decision</button></div></section>
  ${listSection(p, s, 'links')}
  <section class="sec card"><h2>Title and placement</h2><div class="grid2">
    <label class="f span2">Title<input type="text" maxlength="160" value="${esc(s.title)}" data-bind='${P('title')}'></label>
    <label class="f">Stage<select data-act-change="set" data-path='${P('tramo')}'>${TRAMOS.map((t) => `<option value="${t}" ${t === s.tramo ? 'selected' : ''}>${TRAMO_LABEL[t]}</option>`).join('')}</select></label>
    <label class="f">Line (cadence)<select data-act-change="set" data-path='${P('speed')}'>${Object.keys(SPEED_LABEL).map((t) => `<option value="${t}" ${t === s.speed ? 'selected' : ''}>${SPEED_LABEL[t]}</option>`).join('')}</select></label>
  </div></section>
  <nav class="stepnav">${prev ? `<a class="btn" href="${stepHref(p, prev)}">${icon('back')} ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="btn" href="${stepHref(p, next)}">${esc(next.title)} ${icon('next')}</a>` : ''}</nav>`;
}

// ---------------------------------------------------------------- changes
function commit(ops) {
  const p = sync.getProject(route.id);
  if (!p) return false;
  const rejected = sync.commit(p.id, ops);
  if (rejected.length) { toast(rejected[0].error, 'error', 7000); return false; }
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
  // calc answers and inputs are checked on Enter or when you leave the field, not while you type
  if (el.hasAttribute('data-calc') || el.closest('.vars')) return;
  bindTimers.set(el, setTimeout(() => commitBind(el), 900));
});
app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('input[data-bind]')) { e.preventDefault(); e.target.blur(); }
});
app.addEventListener('change', (e) => {
  const el = e.target.closest('[data-bind]');
  if (el) { commitBind(el); if (el.hasAttribute('data-calc') || el.closest('.vars')) setTimeout(render, 0); return; }
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
    msg.textContent = 'Signing in…';
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
    if (value.date === '') delete value.date;
    if (key === 'calcs') {
      try { parse(value.expr); } catch (err) { toast(`Formula: ${err.message}`, 'error'); return; }
      if (!isVarId(value.out)) { toast('Output variable: snake_case, starting with a letter.', 'error'); return; }
      const tol = Number(value.tol || 0);
      if (!(tol >= 0 && tol <= 1)) { toast('Tolerance is a fraction between 0 and 1.', 'error'); return; }
      value.tol = tol;
    }
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
    if (!(await confirmDlg('Delete this item?', 'The server keeps earlier versions in the version history.', 'Delete', true))) return;
    commit([{ op: 'remove', path: [...JSON.parse(el.dataset.path), `#${el.dataset.id}`] }]);
  },
  'toggle-done': (el) => { commit([{ op: 'set', path: JSON.parse(el.dataset.path), value: el.checked }]); },
  set: (el) => { commit([{ op: 'set', path: JSON.parse(el.dataset.path), value: JSON.parse(el.dataset.value) }]); },
  fx: (el) => { const k = el.dataset.key; if (ui.fx.has(k)) ui.fx.delete(k); else ui.fx.add(k); render(); },
  reveal: async (el) => {
    if (!(await confirmDlg('Reveal the answer?', 'It counts toward the gate but stays recorded as revealed in the brief.', 'Reveal'))) return;
    commit([{ op: 'set', path: stepPath('calcs', `#${el.dataset.calc}`, 'revealed'), value: true }]);
  },
  waiver: async () => {
    const r = await dialog({
      title: 'File a waiver',
      body: '<p class="small">The step can start without its sizing. The waiver and its reason stay on the step and in the brief.</p><label class="f">Reason<input type="text" name="reason" maxlength="400" required data-autofocus></label>',
      actions: [{ label: 'Cancel', value: false }, { label: 'File waiver', value: true, primary: true }],
      onOpen: (d) => d.querySelector('input').focus(),
    });
    if (!r || !r.value || !r.data.reason.trim()) return;
    commit([{ op: 'set', path: stepPath('gate'), value: { waived: true, reason: r.data.reason.trim(), at: nowIso() } }]);
  },
  'waiver-revoke': () => { commit([{ op: 'set', path: stepPath('gate'), value: { waived: false, reason: '', at: '' } }]); },
  'step-status': async (el) => {
    const v = el.dataset.v;
    const s = cur().steps.find((x) => x.id === route.stepId);
    const ops = [];
    if ((v === 'no_aplica' || v === 'bloqueado') && !s.reason.trim()) {
      const r = await dialog({
        title: v === 'no_aplica' ? 'Why N/A?' : 'Blocked by?',
        body: `<label class="f">${v === 'no_aplica' ? 'Shown on the map and in the brief.' : 'Shown as an open blocker in Status.'}<input type="text" name="reason" maxlength="400" required data-autofocus></label>`,
        actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }],
        onOpen: (d) => d.querySelector('input').focus(),
      });
      if (!r || !r.value || !r.data.reason.trim()) return;
      ops.push({ op: 'set', path: stepPath('reason'), value: r.data.reason.trim() });
    }
    ops.push({ op: 'set', path: stepPath('status'), value: v });
    commit(ops);
  },
  'make-next': () => { commit([{ op: 'set', path: ['resume', 'nextStepId'], value: route.stepId }]); toast('Set as next action. Describe it in Status.'); },
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
    if (!(await confirmDlg(`Remove «${s.title}»?`, keep ? 'It has notes, milestones or measurements: they are lost. If it just does not apply, mark it N/A with a reason instead.' : 'If it just does not apply, you can mark it N/A with a reason instead.', 'Remove', true))) return;
    commit([{ op: 'remove', path: ['steps', `#${s.id}`] }]);
  },
  'step-add': () => addStepDialog(),
  'add-missing': () => {
    const p = cur();
    const tpl = T.STEPS[p.pattern];
    const ops = [];
    tpl.forEach((t, i) => { if (!p.steps.some((s) => (s.base || s.id) === t.id)) ops.push({ op: 'insert', path: ['steps'], value: stepFromTemplate(t, uniqueStepId(p, t.id)), index: Math.min(i, p.steps.length + ops.length) }); });
    if (commit(ops)) toast(`Added ${ops.length} step(s).`);
  },
  'var-new': () => varDialog(),
  'var-del': async (el) => { if (await confirmDlg(`Remove input «${el.dataset.id}»?`, 'Calcs that read it become blocked.', 'Remove', true)) commit([{ op: 'remove', path: ['vars', `#${el.dataset.id}`] }]); },
  summary: () => summaryDialog(),
  'session-new': (el) => sessionDialog(null, el.dataset.step),
  'session-edit': (el) => sessionDialog(cur().sessions.find((s) => s.id === el.dataset.id)),
  'session-del': async (el) => { if (await confirmDlg('Delete this session?', 'It is removed from the work log.', 'Delete', true)) commit([{ op: 'remove', path: ['sessions', `#${el.dataset.id}`] }]); },
  'decision-new': (el) => decisionDialog(null, el.dataset.step),
  'decision-edit': (el) => decisionDialog(cur().decisions.find((d) => d.id === el.dataset.id)),
  'decision-del': async (el) => { if (await confirmDlg('Delete this decision?', 'If it no longer holds, mark it superseded and record the new one instead.', 'Delete', true)) commit([{ op: 'remove', path: ['decisions', `#${el.dataset.id}`] }]); },
  copy: async (el) => { toast((await copyText(el.dataset.text)) ? 'Copied.' : 'Copy failed.'); },
  'pick-pattern': (el) => {
    const f = app.querySelector('form[data-form="new"]');
    const keep = f ? Object.fromEntries(new FormData(f).entries()) : {};
    ui.newPattern = el.dataset.v;
    render();
    const f2 = app.querySelector('form[data-form="new"]');
    for (const [k, v] of Object.entries(keep)) if (f2.elements[k]) f2.elements[k].value = v;
  },
  'seed-c01': async () => {
    try { await sync.createProject(seedC01()); toast('C01 loaded.'); go('#/p/c01'); }
    catch (e) { e.status === 409 ? go('#/p/c01') : handleError(e); }
  },
  import: () => app.querySelector('#import-file').click(),
  'export-all': async () => {
    try { const data = await sync.exportAll(); download(`ml-board-${todayLocal()}.json`, JSON.stringify(data, null, 1)); }
    catch (e) { handleError(e); }
  },
  'export-one': () => { const p = cur(); download(`${p.id}-${todayLocal()}.json`, JSON.stringify({ app: 'tablero-ml', exportedAt: new Date().toISOString(), projects: [p] }, null, 1)); },
  history: () => historyDialog(),
  'project-delete': async () => {
    const p = cur();
    if (!(await confirmDlg(`Delete «${p.name}»?`, 'It is removed from all your devices. Export it first.', 'Delete', true))) return;
    try { await sync.deleteProject(p.id); toast('Project deleted.'); go('#/'); } catch (e) { handleError(e); }
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

// ---------------------------------------------------------------- dialogs
function summaryDialog() {
  const md = buildSummary(cur());
  dialog({
    title: 'Resume brief',
    body: `<p class="small">Paste it at the start of a Claude Code session. Claude Code can also read it with <code>GET /api/claude/${esc(cur().id)}</code>.</p><pre class="md">${esc(md)}</pre>`,
    actions: [{ label: `${icon('download')} Download .md`, value: 'dl', type: 'button' }, { label: `${icon('copy')} Copy`, value: 'copy', primary: true, type: 'button' }],
    onOpen: (d) => {
      d.querySelector('[data-i="0"]').addEventListener('click', () => download(`brief-${cur().id}-${todayLocal()}.md`, md, 'text/markdown'));
      d.querySelector('[data-i="1"]').addEventListener('click', async () => toast((await copyText(md)) ? 'Brief copied.' : 'Copy failed.'));
    },
  });
}

async function varDialog() {
  const r = await dialog({
    title: 'Add input',
    body: `<div class="grid2">
      <label class="f">Variable (snake_case)<input type="text" name="id" class="mono" maxlength="40" required data-autofocus spellcheck="false" autocapitalize="off"></label>
      <label class="f">Label<input type="text" name="label" maxlength="160" required></label>
      <label class="f">Value<input type="text" name="value" maxlength="60" inputmode="decimal"></label>
      <label class="f">Unit<input type="text" name="unit" maxlength="60"></label>
      <label class="f">Kind<select name="kind">${VAR_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('')}</select></label>
      <label class="f">Source<input type="text" name="source" maxlength="400"></label></div>`,
    actions: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, primary: true }],
    onOpen: (d) => d.querySelector('input').focus(),
  });
  if (!r || !r.value) return;
  const d = r.data;
  if (!isVarId(d.id)) { toast('Variable: snake_case, starting with a letter (≤ 40).', 'error'); return; }
  if (cur().vars.some((v) => v.id === d.id)) { toast(`«${d.id}» already exists.`, 'error'); return; }
  commit([{ op: 'insert', path: ['vars'], value: { id: d.id, label: d.label.trim(), value: d.value.trim(), unit: d.unit.trim(), kind: d.kind, source: d.source.trim() } }]);
}

async function sessionDialog(s, stepId) {
  const p = cur();
  const sel = new Set(s ? s.stepIds : stepId ? [stepId] : p.resume.nextStepId ? [p.resume.nextStepId] : []);
  const r = await dialog({
    title: s ? 'Edit session' : 'Log session',
    body: `<div class="grid2">
      <label class="f">Date<input type="date" name="date" value="${esc(s ? s.date : todayLocal())}" required></label><span></span>
      <label class="f span2">Did<textarea name="did" rows="3" data-autofocus>${esc(s ? s.did : '')}</textarea></label>
      <label class="f span2">Measured (with units)<textarea name="measured" rows="2">${esc(s ? s.measured : '')}</textarea></label>
      <label class="f span2">Next<textarea name="next" rows="2">${esc(s ? s.next : '')}</textarea></label>
    </div>
    <div class="k">Steps touched</div>
    <div class="row" style="margin:6px 0 10px">${p.steps.map((x) => `<label class="chip" style="cursor:pointer"><input type="checkbox" name="step:${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''}> ${esc(x.title)}</label>`).join('')}</div>
    ${s ? '' : '<label class="row small"><input type="checkbox" name="updateNext" checked> Use «Next» as the next action in Status</label>'}`,
    actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }],
    onOpen: (d) => d.querySelector('textarea').focus(),
  });
  if (!r || !r.value) return;
  const d = r.data;
  if (!d.did.trim() && !d.measured.trim() && !d.next.trim()) { toast('Write at least what you did, measured or what is next.', 'error'); return; }
  const value = { date: d.date || todayLocal(), did: d.did.trim(), measured: d.measured.trim(), next: d.next.trim(), stepIds: p.steps.filter((x) => d[`step:${x.id}`]).map((x) => x.id), source: s ? s.source : 'web' };
  const ops = s ? [{ op: 'set', path: ['sessions', `#${s.id}`], value: { ...s, ...value } }] : [{ op: 'insert', path: ['sessions'], value }];
  if (!s && d.updateNext && value.next) ops.push({ op: 'set', path: ['resume', 'next'], value: value.next });
  if (commit(ops)) toast(s ? 'Session updated.' : 'Session logged.');
}

async function decisionDialog(dc, stepId) {
  const p = cur();
  const sid = dc ? dc.stepId : stepId || null;
  const r = await dialog({
    title: dc ? 'Edit decision' : 'New decision',
    body: `<div class="grid2">
      <label class="f span2">Decision<input type="text" name="what" maxlength="400" value="${esc(dc ? dc.what : '')}" required data-autofocus></label>
      <label class="f span2">Over (rejected alternative)<input type="text" name="against" maxlength="400" value="${esc(dc ? dc.against : '')}"></label>
      <label class="f span2">Why<textarea name="why" rows="3" required>${esc(dc ? dc.why : '')}</textarea></label>
      <label class="f">Step<select name="stepId"><option value="">(whole project)</option>${p.steps.map((x) => `<option value="${esc(x.id)}" ${x.id === sid ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>
      <label class="f">Date<input type="date" name="date" value="${esc(dc ? dc.date : todayLocal())}"></label>
      ${dc ? `<label class="f">State<select name="status"><option value="vigente" ${dc.status === 'vigente' ? 'selected' : ''}>In force</option><option value="revisada" ${dc.status === 'revisada' ? 'selected' : ''}>Superseded</option></select></label>` : ''}
    </div>`,
    actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }],
    onOpen: (d) => d.querySelector('input').focus(),
  });
  if (!r || !r.value) return;
  const d = r.data;
  if (!d.what.trim() || !d.why.trim()) { toast('A decision needs what and why.', 'error'); return; }
  const value = { date: d.date || todayLocal(), stepId: d.stepId || null, what: d.what.trim(), against: d.against.trim(), why: d.why.trim(), status: d.status || (dc ? dc.status : 'vigente') };
  if (commit(dc ? [{ op: 'set', path: ['decisions', `#${dc.id}`], value: { ...dc, ...value } }] : [{ op: 'insert', path: ['decisions'], value }])) toast('Decision saved.');
}

async function addStepDialog() {
  const p = cur();
  const groups = addableSteps(p);
  const all = groups.flatMap((g) => g.items);
  const r = await dialog({
    title: 'Add step',
    body: `${groups.map((g) => `<h3 style="margin-top:6px">${esc(g.label)}</h3><div class="pick">${g.items.map((t) => `<button value="v:${all.indexOf(t)}">${esc(t.title)}<small>${esc((t.note || '').slice(0, 140))}${(t.note || '').length > 140 ? '…' : ''}</small></button>`).join('')}</div>`).join('')}
      <h3 style="margin-top:14px">Custom step</h3>
      <div class="grid2"><label class="f span2">Title<input type="text" name="title" maxlength="160"></label>
      <label class="f">Stage<select name="tramo">${TRAMOS.map((t) => `<option value="${t}">${TRAMO_LABEL[t]}</option>`).join('')}</select></label>
      <label class="f">After<select name="after">${p.steps.map((s, i) => `<option value="${i}" ${i === p.steps.length - 1 ? 'selected' : ''}>${i + 1}. ${esc(s.title)}</option>`).join('')}</select></label></div>`,
    actions: [{ label: 'Cancel', value: false }, { label: 'Add custom step', value: 'own', primary: true }],
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
    if (!r.data.title.trim()) { toast('A custom step needs a title.', 'error'); return; }
    step = { id: uniqueStepId(p, slugify(r.data.title)), base: null, title: r.data.title.trim(), tramo: r.data.tramo, speed: 'nuevo' };
    index = Number(r.data.after) + 1;
  } else return;
  if (commit([{ op: 'insert', path: ['steps'], value: step, index }])) toast(`Added «${step.title}».`);
}

async function historyDialog() {
  const p = cur();
  let hist;
  try { hist = (await sync.history(p.id)).history; } catch (e) { handleError(e); return; }
  const r = await dialog({
    title: 'Version history',
    body: hist.length ? `<p class="small">The server keeps a copy before each change, at most one every 10 minutes. Restoring replaces the current version (which is kept too).</p>
      <div class="pick">${hist.map((h) => `<button value="v:${h.i}">Revision ${h.rev} · ${esc(new Date(h.updatedAt).toLocaleString('en-US'))}<small>${h.steps} steps · ${h.sessions} sessions · ${h.decisions} decisions</small></button>`).join('')}</div>`
      : '<p>No earlier versions yet.</p>',
  });
  if (!r || typeof r.value !== 'string' || !r.value.startsWith('v:')) return;
  const h = hist.find((x) => x.i === Number(r.value.slice(2)));
  if (!(await confirmDlg('Restore this version?', `Back to revision ${h.rev}. Later changes are replaced.`, 'Restore', true))) return;
  try {
    const { project: old } = await sync.historyAt(p.id, h.i);
    await sync.replaceProject({ ...sync.upgrade(old), rev: p.rev }, sync.baseRev(p.id));
    toast('Version restored.'); render();
  } catch (e) { e.status === 409 ? toast('The project changed meanwhile (Claude Code?). Reload and try again.', 'error', 7000) : handleError(e); }
}

// ---------------------------------------------------------------- create and import
async function createFromForm(data) {
  const name = (data.name || '').trim();
  const id = (data.id || '').trim() || slugify(name);
  if (!name) { toast('Name it.', 'error'); return; }
  if (!isId(id)) { toast('ID: lowercase letters, digits and dashes (max 40).', 'error'); return; }
  const p = projectFromTemplate({ id, name, pattern: ui.newPattern, repo: (data.repo || '').trim(), goal: (data.goal || '').trim() });
  try { await sync.createProject(p); toast('Project created.'); go(`#/p/${id}`); }
  catch (e) { if (e instanceof sync.NetError) toast('Creating a project needs a connection.', 'error'); else if (e.status === 409) toast(`A project with id «${id}» already exists.`, 'error'); else handleError(e); }
}

async function importFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Not a JSON file.', 'error'); return; }
  const projects = (Array.isArray(data.projects) ? data.projects : data.project ? [data.project] : data.id && data.steps ? [data] : []).map((p) => sync.upgrade(p));
  if (!projects.length) { toast('No projects in this file.', 'error'); return; }
  let created = 0, replaced = 0, skipped = 0;
  for (const p of projects) {
    const errors = validateProject({ ...p, rev: 0 });
    if (errors.length) { toast(`«${p.name || p.id}» is invalid: ${errors[0]}`, 'error', 8000); skipped++; continue; }
    try { await sync.createProject({ ...p, rev: 0 }); created++; }
    catch (e) {
      if (e.status !== 409) { handleError(e); return; }
      if (await confirmDlg(`«${p.name}» already exists`, 'Replace it with the version in the file? The current one stays in the version history.', 'Replace', true)) {
        const current = await sync.loadProject(p.id);
        try { await sync.replaceProject({ ...p, rev: current.rev }, current.rev); replaced++; }
        catch (e2) { if (e2.status === 409) { toast(`«${p.name}» changed during the import; try again.`, 'error', 7000); skipped++; } else throw e2; }
      } else skipped++;
    }
  }
  toast(`Import: ${created} new, ${replaced} replaced, ${skipped} skipped.`, 'info', 6000);
  if (route.name === 'home') await enterRoute(); else render();
}

// ---------------------------------------------------------------- boot
function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('tml:theme') || 'auto'; } catch {}
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
  const btn = document.getElementById('theme');
  btn.title = btn.ariaLabel = `Theme: ${{ auto: 'system', light: 'light', dark: 'dark' }[t]}`;
}
document.getElementById('theme').addEventListener('click', () => {
  let t = 'auto';
  try { t = localStorage.getItem('tml:theme') || 'auto'; } catch {}
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[t];
  try { localStorage.setItem('tml:theme', next); } catch {}
  applyTheme();
});
document.getElementById('logout').addEventListener('click', async () => {
  if (sync.syncState().pending && !(await confirmDlg('Unsynced changes', 'Signing out now loses them. Sign out anyway?', 'Sign out', true))) return;
  await sync.logout();
  location.hash = '#/login';
});

async function boot() {
  applyTheme();
  if ('serviceWorker' in navigator) {
    // A new deploy installs a new service worker; when it takes control the page reloads to use the new files
    // (if you are typing, it waits until you leave the field; pending changes are already in the browser).
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
    if (!s.auth) { route = { name: 'login' }; if (location.hash !== '#/login') history.replaceState(null, '', '#/login'); render(); return; }
    if (route.name === 'login') { route = { name: 'home' }; history.replaceState(null, '', '#/'); }
  } catch (e) {
    if (!(e instanceof sync.NetError)) { toast(e.message, 'error'); }
  }
  await enterRoute();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && route.id && !sync.hasPending(route.id)) sync.loadProject(route.id).catch(() => {});
    if (document.visibilityState === 'hidden') sync.flush();
  });
}
boot();
