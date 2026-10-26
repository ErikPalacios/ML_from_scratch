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
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'el cuerpo debe ser application/json');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new HttpError(413, 'el cuerpo pesa más de 1 MB');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'JSON inválido'); }
}

// Con cookie, una escritura solo vale si viene de esta misma página (SameSite=Strict ya lo cubre; esto es la segunda capa).
function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  let o;
  try { o = new URL(origin); } catch { throw new HttpError(403, 'origen inválido'); }
  if (o.host !== host) throw new HttpError(403, 'origen distinto al del tablero');
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
    const cur = await store.get(id);
    if (!cur) throw new HttpError(404, `no existe el proyecto «${id}»`);
    const ops = makeOps(cur);
    const res = applyOps(cur, ops, opts);
    if (!res.applied) return { project: cur, rejected: res.rejected };
    res.project.rev = cur.rev + 1;
    if (await store.put(res.project, cur.rev)) return { project: res.project, rejected: res.rejected };
  }
  throw new HttpError(409, 'el proyecto cambió muchas veces seguidas; intenta de nuevo');
}

function listItem(p) {
  const steps = p.steps.filter((s) => s.status !== 'no_aplica');
  return {
    id: p.id, name: p.name, pattern: p.pattern, rev: p.rev, updatedAt: p.updatedAt, lastActivity: p.lastActivity,
    total: steps.length, hecho: steps.filter((s) => s.status === 'hecho').length,
    bloqueado: steps.filter((s) => s.status === 'bloqueado').length, next: p.resume.next.slice(0, 200),
  };
}

// ---------------------------------------------------------------- Claude Code: cuerpos en español → ops
const str = (v, max = 20000) => (v === undefined || v === null ? undefined : String(v).slice(0, max));

function stepOps(cur, stepId, b) {
  const step = cur.steps.find((s) => s.id === stepId);
  if (!step) throw new HttpError(404, `no existe el paso «${stepId}»; los ids están en GET /api/claude/${cur.id}`);
  const P = ['steps', `#${stepId}`];
  const ops = [];
  if (b.estado !== undefined) {
    if (!STATUS.includes(b.estado)) throw new HttpError(400, `estado debe ser uno de ${STATUS.join(', ')}`);
    ops.push({ op: 'set', path: [...P, 'status'], value: b.estado });
  }
  if (b.razon !== undefined) ops.push({ op: 'set', path: [...P, 'reason'], value: str(b.razon, 400) });
  if (b.vuelta) {
    for (const k of ['v1', 'v2']) if (b.vuelta[k] !== undefined) {
      if (!VUELTA_STATUS.includes(b.vuelta[k])) throw new HttpError(400, `vuelta.${k} debe ser uno de ${VUELTA_STATUS.join(', ')}`);
      ops.push({ op: 'set', path: [...P, 'vuelta', k], value: b.vuelta[k] });
    }
  }
  if (b.nota) {
    const add = `${step.notes.trim() ? '\n\n' : ''}[${today()} · Claude Code] ${str(b.nota, 4000)}`;
    ops.push({ op: 'set', path: [...P, 'notes'], value: (step.notes.trim() + add).slice(-20000) });
  }
  if (b.resultado) ops.push({ op: 'insert', path: [...P, 'results'], value: { name: str(b.resultado.nombre, 160) || '', value: str(b.resultado.valor, 160) || '', unit: str(b.resultado.unidad, 60) || '', note: str(b.resultado.nota, 400) || '', date: b.resultado.fecha || today() } });
  if (b.comando) ops.push({ op: 'insert', path: [...P, 'commands'], value: { code: str(b.comando.codigo, 4000) || '', note: str(b.comando.nota, 400) || '' } });
  if (b.archivo) ops.push({ op: 'insert', path: [...P, 'files'], value: { path: str(b.archivo.ruta, 400) || '', ref: str(b.archivo.ref, 160) || '' } });
  if (b.hito) {
    const h = step.hitos.find((x) => x.id === b.hito.id);
    if (!h) throw new HttpError(404, `el paso «${stepId}» no tiene el hito «${b.hito.id}»`);
    if (!STATUS.includes(b.hito.estado)) throw new HttpError(400, `hito.estado debe ser uno de ${STATUS.join(', ')}`);
    ops.push({ op: 'set', path: [...P, 'hitos', `#${h.id}`, 'status'], value: b.hito.estado });
  }
  if (b.criterio) {
    const c = b.criterio.id ? step.done.find((x) => x.id === b.criterio.id) : null;
    if (c) ops.push({ op: 'set', path: [...P, 'done', `#${c.id}`, 'ok'], value: b.criterio.ok !== false });
    else if (b.criterio.texto) ops.push({ op: 'insert', path: [...P, 'done'], value: { text: str(b.criterio.texto, 400), ok: b.criterio.ok === true } });
    else throw new HttpError(404, `el paso «${stepId}» no tiene el criterio «${b.criterio.id}»`);
  }
  if (!ops.length) throw new HttpError(400, 'no mandaste ningún cambio');
  return ops;
}

function claudeOps(kind, cur, b, stepId) {
  if (kind === 'paso') return stepOps(cur, stepId, b);
  if (kind === 'bitacora') {
    if (!b.hice && !b.medi && !b.sigue) throw new HttpError(400, 'la bitácora necesita al menos hice, medi o sigue');
    const pasos = Array.isArray(b.pasos) ? b.pasos.filter((x) => cur.steps.some((s) => s.id === x)) : [];
    return [{ op: 'insert', path: ['sessions'], value: { id: newId('s'), date: /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') ? b.fecha : today(), did: str(b.hice) || '', measured: str(b.medi) || '', next: str(b.sigue) || '', stepIds: pasos, source: 'claude' } }];
  }
  if (kind === 'retomar') {
    const ops = [];
    if (b.donde !== undefined) ops.push({ op: 'set', path: ['resume', 'where'], value: str(b.donde) });
    if (b.proximo !== undefined) ops.push({ op: 'set', path: ['resume', 'next'], value: str(b.proximo) });
    if (b.paso !== undefined) {
      if (b.paso !== null && !cur.steps.some((s) => s.id === b.paso)) throw new HttpError(404, `no existe el paso «${b.paso}»`);
      ops.push({ op: 'set', path: ['resume', 'nextStepId'], value: b.paso });
    }
    if (!ops.length) throw new HttpError(400, 'retomar necesita donde, proximo o paso');
    return ops;
  }
  if (kind === 'decision') {
    if (!b.que || !b.porque) throw new HttpError(400, 'la decisión necesita que y porque');
    if (b.paso && !cur.steps.some((s) => s.id === b.paso)) throw new HttpError(404, `no existe el paso «${b.paso}»`);
    return [{ op: 'insert', path: ['decisions'], value: { id: newId('d'), date: today(), stepId: b.paso || null, what: str(b.que, 400), against: str(b.contra, 400) || '', why: str(b.porque), status: 'vigente' } }];
  }
  throw new HttpError(404, 'ruta desconocida');
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
      return json(200, { auth: !problems.length && whoIs(env, request) === 'web', store: store ? store.kind : null, problems: store ? problems : [...problems, 'falta la base de datos (UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN)'] });
    }
    if (problems.length) return fail(503, 'el tablero no está configurado', { problems });
    if (!store) return fail(503, 'falta la base de datos', { problems: ['crea la base Upstash Redis en el Marketplace de Vercel y conéctala al proyecto'] });

    if (r[0] === 'login' && method === 'POST') {
      checkOrigin(request);
      const ip = clientIp(request);
      if (!blockedByStore.has(store)) blockedByStore.set(store, new Map());
      const blocked = blockedByStore.get(store);
      const tooMany = () => json(429, { error: 'demasiados intentos; espera 15 minutos' }, { 'Retry-After': String(LOGIN_WINDOW_S) });
      if ((blocked.get(ip) || 0) > Date.now()) return tooMany();
      // primero el contador de la IP; el global solo cuenta intentos de IPs que siguen dentro de su límite
      if ((await store.hit(`login:${ip}`, LOGIN_WINDOW_S)) > LOGIN_MAX_PER_IP) {
        if (blocked.size > 5000) blocked.clear();
        blocked.set(ip, Date.now() + LOGIN_WINDOW_S * 1000);
        return tooMany();
      }
      if ((await store.hit('login:all', LOGIN_WINDOW_S)) > LOGIN_MAX_ALL) return tooMany();
      const b = await readJson(request);
      if (!checkPassword(env, b.password)) return fail(401, 'contraseña incorrecta');
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(makeSession(env)) });
    }
    if (r[0] === 'logout' && method === 'POST') return json(200, { ok: true }, { 'Set-Cookie': clearCookie() });

    const who = whoIs(env, request);
    if (!who) return fail(401, 'inicia sesión');
    if (who === 'web' && method !== 'GET') checkOrigin(request);
    const webOnly = () => { if (who !== 'web') throw new HttpError(403, 'esto solo se hace desde la página del tablero'); };
    const pid = (s) => { if (!isId(s)) throw new HttpError(400, 'id de proyecto inválido'); return s; };

    // ---- proyectos
    if (r[0] === 'projects' && r.length === 1) {
      if (method === 'GET') return json(200, { projects: (await store.list()).map(listItem).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1)) });
      if (method === 'POST') {
        webOnly();
        const b = await readJson(request);
        const doc = b.project;
        if (!doc || typeof doc !== 'object') throw new HttpError(400, 'falta project');
        doc.rev = 0;
        const errors = validateProject(doc);
        if (errors.length) return fail(422, 'el proyecto no es válido', { errors });
        if (!(await store.put(doc, -1))) return fail(409, `ya existe un proyecto con id «${doc.id}»`);
        return json(201, { project: doc });
      }
    }
    if (r[0] === 'projects' && r.length >= 2) {
      const id = pid(r[1]);
      const sub = r[2];
      if (!sub && method === 'GET') {
        const p = await store.get(id);
        return p ? json(200, { project: p }) : fail(404, `no existe el proyecto «${id}»`);
      }
      if (!sub && method === 'PUT') {
        webOnly();
        const b = await readJson(request);
        const doc = b.project;
        if (!doc || doc.id !== id) throw new HttpError(400, 'project.id debe coincidir con la ruta');
        const cur = await store.get(id);
        if (!cur) throw new HttpError(404, `no existe el proyecto «${id}»`);
        if (Number.isInteger(b.baseRev) && b.baseRev !== cur.rev) return fail(409, 'el proyecto cambió desde que lo abriste', { project: cur });
        doc.rev = cur.rev + 1;
        doc.updatedAt = nowIso();
        const errors = validateProject(doc);
        if (errors.length) return fail(422, 'el proyecto no es válido', { errors });
        if (!(await store.put(doc, cur.rev))) return fail(409, 'el proyecto cambió mientras guardabas; intenta de nuevo');
        return json(200, { project: doc });
      }
      if (!sub && method === 'DELETE') {
        webOnly();
        return (await store.remove(id)) ? json(200, { ok: true }) : fail(404, `no existe el proyecto «${id}»`);
      }
      if (sub === 'ops' && method === 'POST') {
        const b = await readJson(request);
        if (!Array.isArray(b.ops) || b.ops.length > 500) throw new HttpError(400, 'ops debe ser una lista de hasta 500');
        const out = await mutate(store, id, () => b.ops, { restricted: who === 'claude', tz: TZ });
        return json(200, out);
      }
      if (sub === 'resumen' && method === 'GET') {
        const p = await store.get(id);
        return p ? text(200, buildSummary(p, { tz: TZ })) : fail(404, `no existe el proyecto «${id}»`);
      }
      if (sub === 'historial' && method === 'GET' && (r[3] === undefined || /^\d{1,2}$/.test(r[3]))) {
        webOnly();
        // la lista sin los proyectos (una respuesta de Vercel no puede pasar de 4.5 MB); cada versión, aparte
        if (r[3] !== undefined) {
          const p = await store.historyAt(id, Number(r[3]));
          return p ? json(200, { project: p }) : fail(404, 'esa versión ya no existe');
        }
        return json(200, { history: (await store.history(id)).map((p, i) => ({ i, rev: p.rev, updatedAt: p.updatedAt, steps: p.steps.length, sessions: p.sessions.length, decisions: p.decisions.length })) });
      }
    }
    if (r[0] === 'export' && method === 'GET') {
      webOnly();
      return json(200, { app: 'tablero-ml', exportedAt: nowIso(), projects: await store.list() }, { 'Content-Disposition': `attachment; filename="tablero-ml-${today()}.json"` });
    }

    // ---- Claude Code
    if (r[0] === 'claude' && r[1]) {
      const asJson = r[1].endsWith('.json');
      const id = pid(asJson ? r[1].slice(0, -5) : r[1]);
      if (r.length === 2 && method === 'GET') {
        const p = await store.get(id);
        if (!p) return fail(404, `no existe el proyecto «${id}»`);
        return asJson ? json(200, { project: p }) : text(200, buildSummary(p, { tz: TZ }));
      }
      if (method === 'POST' && ['bitacora', 'paso', 'retomar', 'decision'].includes(r[2])) {
        if (r[2] === 'paso' && !r[3]) throw new HttpError(400, 'falta el id del paso: /api/claude/<id>/paso/<pasoId>');
        const b = await readJson(request);
        if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'el cuerpo debe ser un objeto');
        const out = await mutate(store, id, (cur) => claudeOps(r[2], cur, b, r[3]), { restricted: true, tz: TZ });
        if (out.rejected.length) return fail(422, 'no se aplicó', { rejected: out.rejected });
        return json(200, { ok: true, rev: out.project.rev });
      }
    }
    return fail(404, 'ruta desconocida');
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message, e.extra);
    console.error('[api]', e);
    return fail(500, 'error interno');
  }
}
