/* Datos del tablero en el navegador: una copia local para leer sin conexión y una cola de cambios.
   - localStorage guarda, por proyecto, la última versión del servidor («base») y las ops que todavía no se mandaron.
   - Lo que ves es base + ops pendientes (applyOps), así un cambio se ve al instante aunque no haya red.
   - Al volver la red (o cada 30 s) se mandan las ops; el servidor las aplica sobre su versión más nueva.
     Si mientras tanto Claude Code cambió otra cosa, no se pisa: cada op toca solo su campo. */
import { applyOps } from './shared/ops.mjs';
import { newId, ITEM_KIND } from './shared/model.mjs';
import { migrate } from './shared/migrate.mjs';

// v1 copies (cached or imported) are upgraded to v2 before use.
export const upgrade = (doc) => migrate(doc);

const MAX_BATCH_CHARS = 400000; // el servidor acepta hasta 1 MB por envío

// Un elemento nuevo recibe su id al entrar a la cola: así base + pendientes da siempre el mismo resultado
// (editar o borrar un resultado que todavía no se subió funciona) y un reenvío falla con «ya existe» en vez de duplicar.
function withIds(ops) {
  return ops.map((o) => {
    if (o.op !== 'insert' || !o.value || typeof o.value !== 'object' || o.value.id) return o;
    const kind = ITEM_KIND[o.path[o.path.length - 1]];
    return kind ? { ...o, value: { ...o.value, id: newId(kind === 'step' ? 'p' : kind[0]) } } : o;
  });
}

// Mientras escribes, cada pausa guarda el texto completo del campo: si el último cambio pendiente es un `set`
// en la misma ruta, se reemplaza en vez de sumar otro (una nota larga escrita sin red no llena la cola).
function compact(pending, ops) {
  const out = pending.slice();
  for (const o of ops) {
    const last = out[out.length - 1];
    if (o.op === 'set' && last && last.op === 'set' && JSON.stringify(last.path) === JSON.stringify(o.path)) out[out.length - 1] = o;
    else out.push(o);
  }
  return out;
}

// Lote que cabe en un envío: hasta 500 ops y ≈ 400 KB.
function batchOf(pending) {
  let chars = 0, n = 0;
  for (const o of pending) {
    const c = JSON.stringify(o).length;
    if (n && (n >= 500 || chars + c > MAX_BATCH_CHARS)) break;
    chars += c; n++;
  }
  return pending.slice(0, n);
}

const KEY = { list: 'tml:list', proj: (id) => `tml:p:${id}`, ids: 'tml:ids' };
const listeners = new Set();
const state = { status: 'ok', pending: 0, lastSync: null, error: null, auth: null };
const views = new Map(); // id → proyecto visible (base + pendientes)
let flushTimer = null;
let flushing = null;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const remove = (k) => { try { localStorage.removeItem(k); } catch {} };

export const syncState = () => ({ ...state });
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) fn(what); }
function setStatus(s, error = null) {
  state.status = s; state.error = error;
  state.pending = countPending();
  emit('status');
}

// ---------------------------------------------------------------- HTTP
export class AuthError extends Error {}
export class NetError extends Error {}
async function api(method, path, body) {
  let res;
  try {
    res = await fetch('/api/' + path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new NetError('sin conexión'); }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (res.status === 401) { state.auth = false; throw new AuthError(data.error || 'inicia sesión'); }
  if (!res.ok) { const e = new Error((data && data.error) || `error ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}
export const session = () => api('GET', 'session');
export async function login(password) { await api('POST', 'login', { password }); state.auth = true; }
export async function logout() {
  try { await api('POST', 'logout', {}); } catch {}
  clearLocal();
  state.auth = false;
}

// ---------------------------------------------------------------- copia local
function entry(id) { return read(KEY.proj(id)); }
function saveEntry(id, e) {
  if (!write(KEY.proj(id), e)) setStatus('error', 'el navegador no dejó guardar la copia local');
  const ids = new Set(read(KEY.ids) || []); ids.add(id); write(KEY.ids, [...ids]);
}
function countPending() { return (read(KEY.ids) || []).reduce((n, id) => n + ((entry(id) || {}).pending || []).length, 0); }
export function clearLocal() {
  for (const id of read(KEY.ids) || []) remove(KEY.proj(id));
  remove(KEY.ids); remove(KEY.list);
  views.clear();
}

function computeView(id) {
  const e = entry(id);
  if (!e || !e.base) { views.delete(id); return null; }
  if (!(e.base.v >= 2)) { e.base = migrate(e.base); saveEntry(id, e); }
  const v = e.pending && e.pending.length ? applyOps(e.base, e.pending).project : e.base;
  views.set(id, v);
  return v;
}
export const getProject = (id) => (views.has(id) ? views.get(id) : computeView(id));
export const cachedList = () => read(KEY.list) || [];
export const hasPending = (id) => ((entry(id) || {}).pending || []).length > 0;

// Lista de proyectos: de la red si se puede; si no, la copia.
export async function loadList() {
  try {
    const { projects } = await api('GET', 'projects');
    write(KEY.list, projects);
    if (state.status === 'offline') setStatus('ok');
    return projects;
  } catch (e) {
    if (e instanceof NetError) { setStatus('offline'); return cachedList(); }
    throw e;
  }
}

// Proyecto: la copia al instante (si hay) y después la versión del servidor con las ops pendientes encima.
export async function loadProject(id) {
  try {
    const { project } = await api('GET', `projects/${encodeURIComponent(id)}`);
    const e = entry(id) || { pending: [] };
    e.base = project;
    saveEntry(id, e);
    computeView(id);
    state.lastSync = Date.now();
    if (state.status === 'offline') setStatus('ok');
    if (e.pending.length) scheduleFlush(0);
    emit('project:' + id);
    return getProject(id);
  } catch (err) {
    if (err instanceof NetError) { setStatus('offline'); return getProject(id); }
    if (err.status === 404) { remove(KEY.proj(id)); views.delete(id); }
    throw err;
  }
}

// Un cambio: se guarda en la cola, se ve al instante y se manda poco después.
export function commit(id, rawOps) {
  const e = entry(id);
  if (!e || !e.base) throw new Error('proyecto sin copia local');
  const ops = withIds(rawOps);
  const preview = applyOps(getProject(id), ops);
  if (preview.rejected.length) return preview.rejected;
  e.pending = compact(e.pending || [], ops);
  saveEntry(id, e);
  views.set(id, applyOps(e.base, e.pending).project);
  state.pending = countPending();
  emit('project:' + id);
  scheduleFlush(700);
  return [];
}

export function scheduleFlush(ms = 700) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flush(); }, ms);
}

export async function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const id of read(KEY.ids) || []) {
      const e = entry(id);
      if (!e || !e.pending || !e.pending.length) continue;
      const sent = batchOf(e.pending);
      setStatus('saving');
      try {
        const out = await api('POST', `projects/${encodeURIComponent(id)}/ops`, { ops: sent });
        const now = entry(id) || e;
        now.base = out.project;
        now.pending = (now.pending || []).slice(sent.length);
        saveEntry(id, now);
        computeView(id);
        state.lastSync = Date.now();
        emit('project:' + id);
        if (out.rejected && out.rejected.length) emit({ rejected: out.rejected, id });
      } catch (err) {
        if (err instanceof NetError) { setStatus('offline'); return; }
        if (err instanceof AuthError) { setStatus('error', 'tu sesión terminó'); emit('auth'); return; }
        if (err.status === 404) { remove(KEY.proj(id)); views.delete(id); emit('project:' + id); continue; }
        if (err.status === 400 || err.status === 413) {
          // un lote que el servidor nunca va a aceptar no debe trabar la cola para siempre: se descarta y se avisa
          const now = entry(id) || e;
          now.pending = (now.pending || []).slice(sent.length);
          saveEntry(id, now);
          computeView(id);
          emit({ rejected: [{ error: `el servidor rechazó ${sent.length} cambio(s): ${err.message}` }], id });
          emit('project:' + id);
          continue;
        }
        setStatus('error', err.message);
        return;
      }
    }
    setStatus('ok');
  })().finally(() => { flushing = null; });
  return flushing;
}

// ---------------------------------------------------------------- proyectos completos (necesitan red)
export async function createProject(project) {
  const { project: p } = await api('POST', 'projects', { project });
  saveEntry(p.id, { base: p, pending: [] });
  computeView(p.id);
  return p;
}
// Reemplazar un proyecto completo (importar encima, restaurar una versión). `baseRev` es la revisión que viste: si el
// servidor tiene otra (por ejemplo, Claude Code escribió mientras tanto), responde 409 y no se pisa nada.
export async function replaceProject(project, baseRev) {
  await flush();
  const before = ((entry(project.id) || {}).pending || []).length;
  const { project: p } = await api('PUT', `projects/${encodeURIComponent(project.id)}`, { project, baseRev });
  const later = ((entry(p.id) || {}).pending || []).slice(before); // lo que escribiste mientras se mandaba
  saveEntry(p.id, { base: p, pending: later });
  computeView(p.id);
  emit('project:' + p.id);
  return p;
}
export async function deleteProject(id) {
  await api('DELETE', `projects/${encodeURIComponent(id)}`);
  remove(KEY.proj(id));
  views.delete(id);
  const ids = (read(KEY.ids) || []).filter((x) => x !== id); write(KEY.ids, ids);
  write(KEY.list, cachedList().filter((p) => p.id !== id));
}
export const exportAll = () => api('GET', 'export');
export const history = (id) => api('GET', `projects/${encodeURIComponent(id)}/historial`);
export const historyAt = (id, i) => api('GET', `projects/${encodeURIComponent(id)}/historial/${i}`);
export const baseRev = (id) => { const e = entry(id); return e && e.base ? e.base.rev : undefined; };

// La red volvió o la pestaña volvió a primer plano: manda lo pendiente.
export function startBackgroundSync() {
  window.addEventListener('online', () => { setStatus('ok'); flush(); });
  window.addEventListener('offline', () => setStatus('offline'));
  setInterval(() => { if (countPending()) flush(); }, 30000);
  state.pending = countPending();
  if (!navigator.onLine) setStatus('offline');
}
