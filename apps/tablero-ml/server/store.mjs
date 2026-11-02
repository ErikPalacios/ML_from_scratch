/* Dónde viven los proyectos.
   - En Vercel: Upstash Redis por su API REST (fetch, sin dependencias). Lee UPSTASH_REDIS_REST_URL/TOKEN o, si la
     integración del Marketplace los creó con el nombre viejo, KV_REST_API_URL/TOKEN.
   - En tu Mac (tools/dev.mjs) y en los tests: un store en memoria que puede guardarse en un archivo JSON.
   Las dos versiones cumplen la misma interfaz:
     get(id) → proyecto | null          list() → [proyecto]
     put(doc, expectedRev) → true | false (false = otro escribió primero; expectedRev -1 = crear)
     remove(id) → bool (queda 30 días en la papelera)      hit(key, ttlS) → cuántas veces en la ventana
     history(id) → [proyecto] (copias de al menos cada 10 min, las últimas 30) */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const P = 'tml:';
const K = {
  doc: (id) => `${P}p:${id}`, rev: (id) => `${P}r:${id}`, hist: (id) => `${P}h:${id}`, histTs: (id) => `${P}hts:${id}`,
  trash: (id) => `${P}trash:${id}`, ids: `${P}ids`, hit: (k) => `${P}hit:${k}`,
};
const HIST_KEEP = 30;
const HIST_EVERY_S = 600;
const TRASH_TTL_S = 30 * 86400;

// Escritura condicional y atómica: solo escribe si la revisión guardada es la esperada. Antes de pisar, guarda una
// copia en el historial si la última copia tiene más de 10 minutos.
const PUT_LUA = `
local r = redis.call('GET', KEYS[2])
local cur = tonumber(r or '-1')
if cur ~= tonumber(ARGV[1]) then return 0 end
if r and redis.call('SET', KEYS[4], '1', 'NX', 'EX', ${HIST_EVERY_S}) then
  local old = redis.call('GET', KEYS[1])
  if old then redis.call('LPUSH', KEYS[3], old); redis.call('LTRIM', KEYS[3], 0, ${HIST_KEEP - 1}) end
end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
redis.call('SADD', KEYS[5], ARGV[4])
return 1`;

export function redisStore({ url, token, fetchImpl = fetch }) {
  const base = url.replace(/\/+$/, '');
  async function call(path, body) {
    const res = await fetchImpl(base + path, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let data;
    try { data = await res.json(); } catch { throw new Error(`Redis respondió ${res.status} sin JSON`); }
    if (!res.ok && !Array.isArray(data)) throw new Error(`Redis ${res.status}: ${data && data.error ? data.error : 'error'}`);
    return data;
  }
  const cmd = async (...args) => { const d = await call('', args); if (d.error) throw new Error('Redis: ' + d.error); return d.result; };
  const pipeline = async (cmds) => {
    const d = await call('/pipeline', cmds);
    return d.map((x) => { if (x.error) throw new Error('Redis: ' + x.error); return x.result; });
  };
  const parse = (s) => (s ? JSON.parse(s) : null);
  return {
    kind: 'redis',
    async get(id) { return parse(await cmd('GET', K.doc(id))); },
    async list() {
      const ids = (await cmd('SMEMBERS', K.ids)) || [];
      if (!ids.length) return [];
      const docs = await cmd('MGET', ...ids.map(K.doc));
      return docs.map(parse).filter(Boolean);
    },
    async put(doc, expectedRev) {
      const ok = await cmd('EVAL', PUT_LUA, '5', K.doc(doc.id), K.rev(doc.id), K.hist(doc.id), K.histTs(doc.id), K.ids,
        String(expectedRev), JSON.stringify(doc), String(doc.rev), doc.id);
      return ok === 1;
    },
    async remove(id) {
      const cur = await cmd('GET', K.doc(id));
      if (!cur) return false;
      // el historial se borra: un proyecto nuevo con el mismo id no debe heredar las versiones del anterior
      await pipeline([['SET', K.trash(id), cur, 'EX', String(TRASH_TTL_S)], ['DEL', K.doc(id), K.rev(id), K.histTs(id), K.hist(id)], ['SREM', K.ids, id]]);
      return true;
    },
    async hit(key, ttlS) {
      const [n] = await pipeline([['INCR', K.hit(key)], ['EXPIRE', K.hit(key), String(ttlS), 'NX']]);
      return n;
    },
    async history(id) { return ((await cmd('LRANGE', K.hist(id), '0', String(HIST_KEEP - 1))) || []).map(parse); },
    async historyAt(id, i) { return parse(await cmd('LINDEX', K.hist(id), String(i))); },
  };
}

export function memoryStore({ file } = {}) {
  let db = { docs: {}, rev: {}, hist: {}, histTs: {}, trash: {}, hits: {} };
  if (file && existsSync(file)) db = { ...db, ...JSON.parse(readFileSync(file, 'utf8')) };
  const save = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(db));
  };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  return {
    kind: file ? 'archivo local' : 'memoria',
    async get(id) { return clone(db.docs[id]); },
    async list() { return Object.values(db.docs).map(clone); },
    async put(doc, expectedRev) {
      const cur = doc.id in db.rev ? db.rev[doc.id] : -1;
      if (cur !== expectedRev) return false;
      const now = Date.now();
      if (db.docs[doc.id] && (!db.histTs[doc.id] || now - db.histTs[doc.id] > HIST_EVERY_S * 1000)) {
        db.histTs[doc.id] = now;
        db.hist[doc.id] = [clone(db.docs[doc.id]), ...(db.hist[doc.id] || [])].slice(0, HIST_KEEP);
      }
      db.docs[doc.id] = clone(doc);
      db.rev[doc.id] = doc.rev;
      save();
      return true;
    },
    async remove(pid) {
      if (!db.docs[pid]) return false;
      db.trash[pid] = db.docs[pid];
      delete db.docs[pid]; delete db.rev[pid]; delete db.histTs[pid]; delete db.hist[pid];
      save();
      return true;
    },
    async hit(key, ttlS) {
      const now = Date.now();
      const h = db.hits[key];
      if (!h || h.until < now) db.hits[key] = { n: 0, until: now + ttlS * 1000 };
      db.hits[key].n++;
      return db.hits[key].n;
    },
    async history(pid) { return (db.hist[pid] || []).map(clone); },
    async historyAt(pid, i) { return clone((db.hist[pid] || [])[i]); },
  };
}

// El store según el entorno: Redis si hay credenciales; si no, null (la API responde 503 con la explicación).
export function storeFromEnv(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return redisStore({ url, token });
  return null;
}
