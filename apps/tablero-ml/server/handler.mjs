/* La API del tablero: recibe un Request (Web standard) y devuelve un Response. La usan api/index.mjs (Vercel),
   tools/dev.mjs (tu Mac) y los tests. Rutas (todas bajo /api/):
     POST login {password}            GET session            POST logout
     GET  projects                    POST projects {project}             (crear o importar)
     GET  projects/<id>               PUT  projects/<id> {project, baseRev?}  DELETE projects/<id>
     POST projects/<id>/ops {ops}     GET  projects/<id>/resumen (markdown)   GET projects/<id>/historial
     GET  export                      (todos los proyectos, para respaldo)
   Para Claude Code, con `Authorization: Bearer $TABLERO_TOKEN` (también sirven con la cookie):
     GET  claude/<id>                 el resumen en markdown        GET claude/<id>.json  el proyecto
     POST claude/<id>/bitacora {fecha?, hice, medi, sigue, pasos?}
     POST claude/<id>/paso/<pasoId> {estado?, razon?, vuelta?, nota?, resultado?, comando?, archivo?, hito?, criterio?}
     POST claude/<id>/retomar {donde?, proximo?, paso?}
     POST claude/<id>/decision {que, contra?, porque, paso?}
   El token no puede crear, reemplazar ni borrar proyectos, ni borrar o reordenar pasos. */
import { applyOps } from '../web/js/shared/ops.mjs';
import { validateProject, isId, today as todayIn, nowIso, STATUS, VUELTA_STATUS, newId, DEFAULT_TZ } from '../web/js/shared/model.mjs';
import { buildSummary } from '../web/js/shared/summary.mjs';
import { migrate } from '../web/js/shared/migrate.mjs';
import { configProblems, whoIs, checkPassword, makeSession, sessionCookie, clearCookie, clientIp } from './auth.mjs';

const MAX_BODY = 1_000_000;
let TZ = DEFAULT_TZ;
const today = () => todayIn(TZ);
const LOGIN_WINDOW_S = 900;
const LOGIN_MAX_PER_IP = 10;
const LOGIN_MAX_ALL = 300;
// IPs que ya pasaron su límite: Fluid compute reusa la instancia, así un ataque en bucle no gasta comandos de Redis.
const blockedByStore = new WeakMap();

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const text = (status, body, type = 'text/markdown; charset=utf-8') => new Response(body, { status, headers: { ...BASE_HEADERS, 'Content-Type': type } });
const fail = (status, error, extra = {}) => json(status, { error, ...extra });

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }

async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'the body must be application/json');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, 'the body is larger than 1 MB');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'invalid JSON'); }
}

// Con cookie, una escritura solo vale si viene de esta misma página (SameSite=Strict ya lo cubre; esto es la segunda capa).
function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  let o;
  try { o = new URL(origin); } catch { throw new HttpError(403, 'invalid origin'); }
  if (o.host !== host) throw new HttpError(403, 'origin differs from the board');
}

// La ruta debajo de /api/. En Vercel llega en ?__route= (la pone el rewrite de vercel.json); en local, del pathname.
function routeOf(url) {
  const q = url.searchParams.get('__route');
  const r = q !== null ? q : url.pathname.replace(/^\/api\/?/, '');
  return r.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

// Lee, aplica y escribe con reintento: si otro escribió entre la lectura y la escritura, se vuelve a aplicar sobre lo nuevo.
async function mutate(store, id, makeOps, opts) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Math.random() * 20 * attempt));
    const cur = migrate(await store.get(id));
    if (!cur) throw new HttpError(404, `project «${id}» does not exist`);
    const ops = makeOps(cur);
    const res = applyOps(cur, ops, opts);
    if (!res.applied) return { project: cur, rejected: res.rejected };
    res.project.rev = cur.rev + 1;
    if (await store.put(res.project, cur.rev)) return { project: res.project, rejected: res.rejected };
  }
  throw new HttpError(409, 'the project changed too many times in a row; try again');
}

function listItem(p) {
  const steps = p.steps.filter((s) => s.status !== 'no_aplica');
  return {
    id: p.id, name: p.name, pattern: p.pattern, rev: p.rev, updatedAt: p.updatedAt, lastActivity: p.lastActivity,
    total: steps.length, hecho: steps.filter((s) => s.status === 'hecho').length,
    bloqueado: steps.filter((s) => s.status === 'bloqueado').length, next: p.resume.next.slice(0, 200),
  };
}

// ---------------------------------------------------------------- Claude Code: request bodies → ops
// Keys are accepted in English or in Spanish (the v1 CLAUDE.md used Spanish): status|estado, reason|razon, pass|vuelta,
// note|nota, result|resultado {name|nombre, value|valor, unit|unidad, note|nota, date|fecha}, command|comando {code|codigo,
// note|nota}, file|archivo {path|ruta, ref}, milestone|hito {id, status|estado}, criterion|criterio {id, ok, text|texto},
// calc {id, answer}.
const str = (v, max = 20000) => (v === undefined || v === null ? undefined : String(v).slice(0, max));
const pick = (o, ...keys) => { if (!o || typeof o !== 'object') return undefined; for (const k of keys) if (o[k] !== undefined) return o[k]; return undefined; };

function stepOps(cur, stepId, b) {
  const step = cur.steps.find((s) => s.id === stepId);
  if (!step) throw new HttpError(404, `step «${stepId}» does not exist; ids are in GET /api/claude/${cur.id}`);
  const P = ['steps', `#${stepId}`];
  const ops = [];
  const status = pick(b, 'status', 'estado');
  if (status !== undefined) {
    if (!STATUS.includes(status)) throw new HttpError(400, `status must be one of ${STATUS.join(', ')}`);
    ops.push({ op: 'set', path: [...P, 'status'], value: status });
  }
  const reason = pick(b, 'reason', 'razon');
  if (reason !== undefined) ops.unshift({ op: 'set', path: [...P, 'reason'], value: str(reason, 400) });
  const pass = pick(b, 'pass', 'vuelta');
  if (pass) {
    for (const [k, alias] of [['v1', 'p1'], ['v2', 'p2']]) {
      const v = pick(pass, k, alias);
      if (v === undefined) continue;
      if (!VUELTA_STATUS.includes(v)) throw new HttpError(400, `pass.${k} must be one of ${VUELTA_STATUS.join(', ')}`);
      ops.push({ op: 'set', path: [...P, 'vuelta', k], value: v });
    }
  }
  const note = pick(b, 'note', 'nota');
  if (note) {
    const add = `${step.notes.trim() ? '\n\n' : ''}[${today()} · Claude Code] ${str(note, 4000)}`;
    ops.push({ op: 'set', path: [...P, 'notes'], value: (step.notes.trim() + add).slice(-20000) });
  }
  const res = pick(b, 'result', 'resultado');
  if (res) ops.push({ op: 'insert', path: [...P, 'results'], value: { name: str(pick(res, 'name', 'nombre'), 160) || '', value: str(pick(res, 'value', 'valor'), 160) || '', unit: str(pick(res, 'unit', 'unidad'), 60) || '', note: str(pick(res, 'note', 'nota'), 400) || '', date: pick(res, 'date', 'fecha') || today() } });
  const cmd = pick(b, 'command', 'comando');
  if (cmd) ops.push({ op: 'insert', path: [...P, 'commands'], value: { code: str(pick(cmd, 'code', 'codigo'), 4000) || '', note: str(pick(cmd, 'note', 'nota'), 400) || '' } });
  const file = pick(b, 'file', 'archivo');
  if (file) ops.push({ op: 'insert', path: [...P, 'files'], value: { path: str(pick(file, 'path', 'ruta'), 400) || '', ref: str(file.ref, 160) || '' } });
  const ms = pick(b, 'milestone', 'hito');
  if (ms) {
    const h = step.hitos.find((x) => x.id === ms.id);
    if (!h) throw new HttpError(404, `step «${stepId}» has no milestone «${ms.id}»`);
    const st = pick(ms, 'status', 'estado');
    if (!STATUS.includes(st)) throw new HttpError(400, `milestone.status must be one of ${STATUS.join(', ')}`);
    ops.push({ op: 'set', path: [...P, 'hitos', `#${h.id}`, 'status'], value: st });
  }
  const crit = pick(b, 'criterion', 'criterio');
  if (crit) {
    const c = crit.id ? step.done.find((x) => x.id === crit.id) : null;
    const text = pick(crit, 'text', 'texto');
    if (c) ops.push({ op: 'set', path: [...P, 'done', `#${c.id}`, 'ok'], value: crit.ok !== false });
    else if (text) ops.push({ op: 'insert', path: [...P, 'done'], value: { text: str(text, 400), ok: crit.ok === true } });
    else throw new HttpError(404, `step «${stepId}» has no criterion «${crit.id}»`);
  }
  const calc = pick(b, 'calc', 'calculo');
  if (calc) {
    const c = step.calcs.find((x) => x.id === calc.id);
    if (!c) throw new HttpError(404, `step «${stepId}» has no calc «${calc.id}»`);
    ops.push({ op: 'set', path: [...P, 'calcs', `#${c.id}`, 'answer'], value: str(pick(calc, 'answer', 'respuesta'), 120) || '' });
  }
  if (!ops.length) throw new HttpError(400, 'no change in the request');
  // the status goes last, so the gate is evaluated with this request's answers already in
  const st = ops.findIndex((o) => o.path[2] === 'status');
  if (st >= 0) ops.push(ops.splice(st, 1)[0]);
  return ops;
}

function claudeOps(kind, cur, b, stepId) {
  if (kind === 'step') return stepOps(cur, stepId, b);
  if (kind === 'log') {
    const did = pick(b, 'did', 'hice'), measured = pick(b, 'measured', 'medi'), next = pick(b, 'next', 'sigue');
    if (!did && !measured && !next) throw new HttpError(400, 'a log entry needs did, measured or next');
    const steps = pick(b, 'steps', 'pasos');
    const ids = Array.isArray(steps) ? steps.filter((x) => cur.steps.some((s) => s.id === x)) : [];
    const date = pick(b, 'date', 'fecha');
    return [{ op: 'insert', path: ['sessions'], value: { id: newId('s'), date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today(), did: str(did) || '', measured: str(measured) || '', next: str(next) || '', stepIds: ids, source: 'claude' } }];
  }
  if (kind === 'resume') {
    const ops = [];
    const where = pick(b, 'where', 'donde'), next = pick(b, 'next', 'proximo'), step = pick(b, 'step', 'paso');
    if (where !== undefined) ops.push({ op: 'set', path: ['resume', 'where'], value: str(where) });
    if (next !== undefined) ops.push({ op: 'set', path: ['resume', 'next'], value: str(next) });
    if (step !== undefined) {
      if (step !== null && !cur.steps.some((s) => s.id === step)) throw new HttpError(404, `step «${step}» does not exist`);
      ops.push({ op: 'set', path: ['resume', 'nextStepId'], value: step });
    }
    if (!ops.length) throw new HttpError(400, 'resume needs where, next or step');
    return ops;
  }
  if (kind === 'decision') {
    const what = pick(b, 'what', 'que'), why = pick(b, 'why', 'porque'), against = pick(b, 'over', 'against', 'contra'), step = pick(b, 'step', 'paso');
    if (!what || !why) throw new HttpError(400, 'a decision needs what and why');
    if (step && !cur.steps.some((s) => s.id === step)) throw new HttpError(404, `step «${step}» does not exist`);
    return [{ op: 'insert', path: ['decisions'], value: { id: newId('d'), date: today(), stepId: step || null, what: str(what, 400), against: str(against, 400) || '', why: str(why), status: 'vigente' } }];
  }
  if (kind === 'var') {
    const v = cur.vars.find((x) => x.id === stepId);
    if (!v) throw new HttpError(404, `input «${stepId}» does not exist; ids are in the brief's «Sizing inputs»`);
    const value = pick(b, 'value', 'valor');
    if (value === undefined) throw new HttpError(400, 'an input needs value');
    return [{ op: 'set', path: ['vars', `#${v.id}`, 'value'], value: str(value, 60) }];
  }
  throw new HttpError(404, 'unknown route');
}

// ---------------------------------------------------------------- router
export async function handle(request, { env, store }) {
  try {
    TZ = env.TABLERO_TZ || DEFAULT_TZ;
    const url = new URL(request.url);
    const r = routeOf(url);
    const method = request.method.toUpperCase();
    const problems = configProblems(env);

    if (r[0] === 'session' && method === 'GET') {
      return json(200, { auth: !problems.length && whoIs(env, request) === 'web', store: store ? store.kind : null, problems: store ? problems : [...problems, 'the database is missing (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)'] });
    }
    if (problems.length) return fail(503, 'the board is not configured', { problems });
    if (!store) return fail(503, 'the database is missing', { problems: ['create the Upstash Redis database in the Vercel Marketplace and connect it to the project'] });

    if (r[0] === 'login' && method === 'POST') {
      checkOrigin(request);
      const ip = clientIp(request);
      if (!blockedByStore.has(store)) blockedByStore.set(store, new Map());
      const blocked = blockedByStore.get(store);
      const tooMany = () => json(429, { error: 'too many attempts; wait 15 minutes' }, { 'Retry-After': String(LOGIN_WINDOW_S) });
      if ((blocked.get(ip) || 0) > Date.now()) return tooMany();
      // primero el contador de la IP; el global solo cuenta intentos de IPs que siguen dentro de su límite
      if ((await store.hit(`login:${ip}`, LOGIN_WINDOW_S)) > LOGIN_MAX_PER_IP) {
        if (blocked.size > 5000) blocked.clear();
        blocked.set(ip, Date.now() + LOGIN_WINDOW_S * 1000);
        return tooMany();
      }
      if ((await store.hit('login:all', LOGIN_WINDOW_S)) > LOGIN_MAX_ALL) return tooMany();
      const b = await readJson(request);
      if (!checkPassword(env, b.password)) return fail(401, 'wrong password');
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(makeSession(env)) });
    }
    if (r[0] === 'logout' && method === 'POST') return json(200, { ok: true }, { 'Set-Cookie': clearCookie() });

    const who = whoIs(env, request);
    if (!who) return fail(401, 'sign in');
    if (who === 'web' && method !== 'GET') checkOrigin(request);
    const webOnly = () => { if (who !== 'web') throw new HttpError(403, 'this can only be done from the board'); };
    const pid = (s) => { if (!isId(s)) throw new HttpError(400, 'invalid project id'); return s; };

    // ---- proyectos
    if (r[0] === 'projects' && r.length === 1) {
      if (method === 'GET') return json(200, { projects: (await store.list()).map(migrate).map(listItem).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1)) });
      if (method === 'POST') {
        webOnly();
        const b = await readJson(request);
        const doc = b.project && typeof b.project === 'object' && !Array.isArray(b.project) ? migrate(b.project) : null;
        if (!doc || typeof doc !== 'object') throw new HttpError(400, 'missing project');
        doc.rev = 0;
        const errors = validateProject(doc);
        if (errors.length) return fail(422, 'the project is invalid', { errors });
        if (!(await store.put(doc, -1))) return fail(409, `a project with id «${doc.id}» already exists`);
        return json(201, { project: doc });
      }
    }
    if (r[0] === 'projects' && r.length >= 2) {
      const id = pid(r[1]);
      const sub = r[2];
      if (!sub && method === 'GET') {
        const p = migrate(await store.get(id));
        return p ? json(200, { project: p }) : fail(404, `project «${id}» does not exist`);
      }
      if (!sub && method === 'PUT') {
        webOnly();
        const b = await readJson(request);
        const doc = b.project && typeof b.project === 'object' && !Array.isArray(b.project) ? migrate(b.project) : null;
        if (!doc || doc.id !== id) throw new HttpError(400, 'project.id must match the route');
        const cur = migrate(await store.get(id));
        if (!cur) throw new HttpError(404, `project «${id}» does not exist`);
        if (Number.isInteger(b.baseRev) && b.baseRev !== cur.rev) return fail(409, 'the project changed since you opened it', { project: cur });
        doc.rev = cur.rev + 1;
        doc.updatedAt = nowIso();
        const errors = validateProject(doc);
        if (errors.length) return fail(422, 'the project is invalid', { errors });
        if (!(await store.put(doc, cur.rev))) return fail(409, 'the project changed while saving; try again');
        return json(200, { project: doc });
      }
      if (!sub && method === 'DELETE') {
        webOnly();
        return (await store.remove(id)) ? json(200, { ok: true }) : fail(404, `project «${id}» does not exist`);
      }
      if (sub === 'ops' && method === 'POST') {
        const b = await readJson(request);
        if (!Array.isArray(b.ops) || b.ops.length > 500) throw new HttpError(400, 'ops must be a list of up to 500');
        const out = await mutate(store, id, () => b.ops, { restricted: who === 'claude', tz: TZ });
        return json(200, out);
      }
      if (sub === 'resumen' && method === 'GET') {
        const p = migrate(await store.get(id));
        return p ? text(200, buildSummary(p, { tz: TZ })) : fail(404, `project «${id}» does not exist`);
      }
      if (sub === 'historial' && method === 'GET' && (r[3] === undefined || /^\d{1,2}$/.test(r[3]))) {
        webOnly();
        // la lista sin los proyectos (una respuesta de Vercel no puede pasar de 4.5 MB); cada versión, aparte
        if (r[3] !== undefined) {
          const p = await store.historyAt(id, Number(r[3]));
          return p ? json(200, { project: p }) : fail(404, 'that version no longer exists');
        }
        return json(200, { history: (await store.history(id)).map((p, i) => ({ i, rev: p.rev, updatedAt: p.updatedAt, steps: p.steps.length, sessions: p.sessions.length, decisions: p.decisions.length })) });
      }
    }
    if (r[0] === 'export' && method === 'GET') {
      webOnly();
      return json(200, { app: 'tablero-ml', exportedAt: nowIso(), projects: (await store.list()).map(migrate) }, { 'Content-Disposition': `attachment; filename="tablero-ml-${today()}.json"` });
    }

    // ---- Claude Code
    if (r[0] === 'claude' && r[1]) {
      const asJson = r[1].endsWith('.json');
      const id = pid(asJson ? r[1].slice(0, -5) : r[1]);
      if (r.length === 2 && method === 'GET') {
        const p = migrate(await store.get(id));
        if (!p) return fail(404, `project «${id}» does not exist`);
        return asJson ? json(200, { project: p }) : text(200, buildSummary(p, { tz: TZ }));
      }
      const KIND = { bitacora: 'log', log: 'log', paso: 'step', step: 'step', retomar: 'resume', resume: 'resume', decision: 'decision', variable: 'var', var: 'var' };
      if (method === 'POST' && KIND[r[2]]) {
        const kind = KIND[r[2]];
        if ((kind === 'step' || kind === 'var') && !r[3]) throw new HttpError(400, `missing id: /api/claude/<id>/${r[2]}/<id>`);
        const b = await readJson(request);
        if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'the body must be an object');
        const out = await mutate(store, id, (cur) => claudeOps(kind, cur, b, r[3]), { restricted: true, tz: TZ });
        if (out.rejected.length) return fail(422, 'not applied', { rejected: out.rejected });
        return json(200, { ok: true, rev: out.project.rev });
      }
    }
    return fail(404, 'unknown route');
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
    console.error('[api]', e);
    return fail(500, 'internal error');
  }
}
