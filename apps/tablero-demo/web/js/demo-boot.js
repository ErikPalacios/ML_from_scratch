/* Demo backend: replaces the network with a tiny «server» that lives in this browser (localStorage).
   Same shared engine as production (ops, gate, validation), so the demo behaves like the real board.
   Edits stay in this browser; the banner's «Reset demo» wipes them. Nothing is ever sent anywhere. */
import { applyOps } from './shared/ops.mjs';
import { migrate } from './shared/migrate.mjs';
import { validateProject, nowIso } from './shared/model.mjs';
import { seedDemo } from './seed-demo.mjs';

const KEY = 'tml-demo:db';
const MAX_PROJECTS = 8;
const TZ = 'America/Mexico_City';
let memory = null; // fallback when localStorage is not available

const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, data: { error, ...extra } });

function load() {
  if (memory) return memory;
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.projects && typeof d.projects === 'object') return d;
  } catch { /* first visit or blocked storage */ }
  const seed = seedDemo();
  return save({ projects: { [seed.id]: seed } });
}
function save(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); memory = null; } catch { memory = db; }
  return db;
}

function listItem(p) {
  const steps = p.steps.filter((s) => s.status !== 'no_aplica');
  return {
    id: p.id, name: p.name, pattern: p.pattern, rev: p.rev, updatedAt: p.updatedAt, lastActivity: p.lastActivity,
    total: steps.length, hecho: steps.filter((s) => s.status === 'hecho').length,
    bloqueado: steps.filter((s) => s.status === 'bloqueado').length, next: p.resume.next.slice(0, 200),
  };
}

async function demoApi(method, path, body) {
  const r = path.split('/').filter(Boolean);
  const db = load();
  if (r[0] === 'session') return { auth: true, store: 'demo', problems: [] };
  if (r[0] === 'login' || r[0] === 'logout') return { ok: true };

  if (r[0] === 'export') return { app: 'tablero-ml-demo', exportedAt: nowIso(), projects: Object.values(db.projects).map(migrate) };

  if (r[0] === 'projects' && r.length === 1) {
    if (method === 'GET') return { projects: Object.values(db.projects).map(migrate).map(listItem).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1)) };
    if (method === 'POST') {
      const doc = body && body.project && typeof body.project === 'object' ? migrate(body.project) : null;
      if (!doc) throw fail(400, 'missing project');
      doc.rev = 0;
      const errors = validateProject(doc);
      if (errors.length) throw fail(422, 'the project is invalid', { errors });
      if (db.projects[doc.id]) throw fail(409, `a project with id «${doc.id}» already exists`);
      if (Object.keys(db.projects).length >= MAX_PROJECTS) throw fail(409, `the demo keeps up to ${MAX_PROJECTS} projects; delete one first`);
      db.projects[doc.id] = doc;
      save(db);
      return { project: doc };
    }
  }
  if (r[0] === 'projects' && r.length >= 2) {
    const id = r[1];
    const cur = db.projects[id] ? migrate(db.projects[id]) : null;
    const sub = r[2];
    if (!cur) throw fail(404, `project «${id}» does not exist`);
    if (!sub && method === 'GET') return { project: cur };
    if (!sub && method === 'PUT') {
      const doc = body && body.project ? migrate(body.project) : null;
      if (!doc || doc.id !== id) throw fail(400, 'project.id must match the route');
      if (Number.isInteger(body.baseRev) && body.baseRev !== cur.rev) throw fail(409, 'the project changed since you opened it', { project: cur });
      doc.rev = cur.rev + 1;
      doc.updatedAt = nowIso();
      const errors = validateProject(doc);
      if (errors.length) throw fail(422, 'the project is invalid', { errors });
      db.projects[id] = doc;
      save(db);
      return { project: doc };
    }
    if (!sub && method === 'DELETE') { delete db.projects[id]; save(db); return { ok: true }; }
    if (sub === 'ops' && method === 'POST') {
      if (!body || !Array.isArray(body.ops) || body.ops.length > 500) throw fail(400, 'ops must be a list of up to 500');
      const res = applyOps(cur, body.ops, { tz: TZ });
      if (!res.applied) return { project: cur, rejected: res.rejected };
      res.project.rev = cur.rev + 1;
      db.projects[id] = res.project;
      save(db);
      return { project: res.project, rejected: res.rejected };
    }
    if (sub === 'historial' && method === 'GET') return r[3] === undefined ? { history: [] } : (() => { throw fail(404, 'the demo keeps no version history'); })();
  }
  throw fail(404, 'unknown route');
}

window.TABLERO_API = demoApi;
export { demoApi };
