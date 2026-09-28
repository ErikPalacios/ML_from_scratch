/* =============================================================================
   Ronda de Diseño ML — js/core/store.js
   Estado del usuario (progreso, práctica, flashcards, preferencias, checklists)
   con persistencia en dos niveles (SPEC §4.4):
     1) localStorage 'msd.v1', siempre (cada acceso con try/catch; si falla, solo memoria);
     2) dentro de un Artifact de claude.ai: base de datos privada del usuario
        (data/users/<uid>/state + subcolección attempts), con fusión por updatedAt.
   Sin DOM al cargar: también se carga en Node (tests/store.test.cjs).
   Todas las marcas de tiempo salen de Date.now() (los tests lo controlan).
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  const KEY = 'msd.v1';
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const LEITNER_DAYS = [0, 1, 3, 7, 16];   // intervalo de cada caja de Leitner (días)
  const MAX_TEXT = 100000;                 // tope de texto por intento (≪ 256 KiB por documento)
  const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,150}$/;   // segmento válido de ruta en la db
  const PREF_DEFAULTS = { theme: 'system', solutionRevealed: {} };
  // Tiempos (configurables solo para los tests): escritura local, pausa antes de sincronizar,
  // y espera máxima para no posponer la sincronización indefinidamente mientras se escribe.
  const cfg = { localDelay: 250, syncDelay: 2000, maxWait: 15000 };

  const now = () => Date.now();
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const int = (x, d, lo, hi) => Math.min(hi, Math.max(lo, Math.round(num(x, d))));
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const logErr = (e) => { try { if (root.console) root.console.error(e); } catch (_) { /* nada */ } };

  // ------------------------------------------------------------------ forma del estado
  function emptyState() {
    return {
      v: 1,
      updatedAt: 0,
      progress: { updatedAt: 0, sections: {}, pages: {} },   // sections['m01.framework'] = {read, at}; pages.m01 = {completed, at, visitedAt}
      flash: { updatedAt: 0, cards: {} },                      // cards[id] = {box, due, seen, lapses, last}
      prefs: { updatedAt: 0, values: {} },                     // values[key] = {v, at} (fusión por clave)
      checklists: { updatedAt: 0, items: {} },                 // items['c01|checklist|item'] = {on, at}
      lastLocation: { updatedAt: 0, hash: '' },
      tomb: {},                                                // intentos borrados: id → ts (evita que "resuciten" al fusionar)
      attempts: {},                                            // id → intento (borradores y terminados)
    };
  }

  function sanitizeAttempt(a, key) {
    if (!isObj(a) || typeof a.caseId !== 'string' || !a.caseId) return null;
    const id = typeof a.id === 'string' ? a.id : key;
    if (typeof id !== 'string' || !ID_RE.test(id) || id === '.' || id === '..') return null;
    const out = Object.assign(clone(a), {
      id,
      caseId: a.caseId,
      status: a.status === 'done' ? 'done' : 'draft',
      text: typeof a.text === 'string' ? a.text.slice(0, MAX_TEXT) : '',
      elapsedSec: Math.max(0, num(a.elapsedSec, 0)),
      running: !!a.running,
      resumedAt: typeof a.resumedAt === 'number' && isFinite(a.resumedAt) ? a.resumedAt : null,
      createdAt: num(a.createdAt, 0),
      updatedAt: num(a.updatedAt, 0),
    });
    if (typeof a.finishedAt !== 'number') delete out.finishedAt;
    if (!isObj(a.rubric)) delete out.rubric;
    if (!isObj(a.score)) delete out.score;
    return out;
  }

  // Normaliza cualquier objeto (localStorage, db, importación) a un estado válido; descarta lo inválido.
  function sanitize(raw) {
    const s = emptyState();
    if (!isObj(raw)) return s;
    s.updatedAt = num(raw.updatedAt, 0);

    const pr = isObj(raw.progress) ? raw.progress : {};
    s.progress.updatedAt = num(pr.updatedAt, 0);
    if (isObj(pr.sections)) {
      for (const [k, e] of Object.entries(pr.sections)) if (isObj(e)) s.progress.sections[k] = { read: !!e.read, at: num(e.at, 0) };
    }
    if (isObj(pr.pages)) {
      for (const [k, e] of Object.entries(pr.pages)) {
        if (isObj(e)) s.progress.pages[k] = { completed: !!e.completed, at: num(e.at, 0), visitedAt: num(e.visitedAt, 0) };
      }
    }

    const fl = isObj(raw.flash) ? raw.flash : {};
    s.flash.updatedAt = num(fl.updatedAt, 0);
    if (isObj(fl.cards)) {
      for (const [k, c] of Object.entries(fl.cards)) {
        if (!isObj(c)) continue;
        s.flash.cards[k] = {
          box: int(c.box, 0, 0, 4), due: num(c.due, 0), seen: int(c.seen, 0, 0, 1e9),
          lapses: int(c.lapses, 0, 0, 1e9), last: typeof c.last === 'number' ? c.last : null,
        };
      }
    }

    const pf = isObj(raw.prefs) ? raw.prefs : {};
    s.prefs.updatedAt = num(pf.updatedAt, 0);
    if (isObj(pf.values)) {
      for (const [k, e] of Object.entries(pf.values)) if (isObj(e) && 'v' in e) s.prefs.values[k] = { v: clone(e.v), at: num(e.at, 0) };
    }

    const ck = isObj(raw.checklists) ? raw.checklists : {};
    s.checklists.updatedAt = num(ck.updatedAt, 0);
    if (isObj(ck.items)) {
      for (const [k, e] of Object.entries(ck.items)) if (isObj(e)) s.checklists.items[k] = { on: !!e.on, at: num(e.at, 0) };
    }

    const ll = isObj(raw.lastLocation) ? raw.lastLocation : {};
    s.lastLocation = { updatedAt: num(ll.updatedAt, 0), hash: typeof ll.hash === 'string' && /^(#[A-Za-z0-9._~-]*)?$/.test(ll.hash) ? ll.hash : '' };

    if (isObj(raw.tomb)) for (const [k, t] of Object.entries(raw.tomb)) if (typeof t === 'number') s.tomb[k] = t;

    if (isObj(raw.attempts)) {
      for (const [k, a] of Object.entries(raw.attempts)) {
        const x = sanitizeAttempt(a, k);
        if (x) s.attempts[x.id] = x;
      }
    }
    return s;
  }

  // ------------------------------------------------------------------ fusión (db ↔ local, importación)
  // Mapas: unión; en conflicto gana la entrada más reciente. Intentos: gana updatedAt mayor;
  // las lápidas (tomb) eliminan intentos no editados después del borrado.
  function mergeMap(dst, src, newer) {
    for (const [k, b] of Object.entries(src)) {
      const a = dst[k];
      if (!a || newer(a, b)) dst[k] = clone(b);
    }
  }

  function mergeInto(base, inc) {
    const out = clone(base);
    mergeMap(out.progress.sections, inc.progress.sections, (a, b) => b.at > a.at);
    for (const [k, b] of Object.entries(inc.progress.pages)) {
      const a = out.progress.pages[k];
      if (!a) { out.progress.pages[k] = clone(b); continue; }
      if (b.at > a.at) { a.completed = b.completed; a.at = b.at; }
      a.visitedAt = Math.max(a.visitedAt, b.visitedAt);
    }
    out.progress.updatedAt = Math.max(base.progress.updatedAt, inc.progress.updatedAt);

    mergeMap(out.flash.cards, inc.flash.cards, (a, b) => (b.last || 0) > (a.last || 0) || ((b.last || 0) === (a.last || 0) && b.seen > a.seen));
    out.flash.updatedAt = Math.max(base.flash.updatedAt, inc.flash.updatedAt);

    mergeMap(out.prefs.values, inc.prefs.values, (a, b) => b.at > a.at);
    out.prefs.updatedAt = Math.max(base.prefs.updatedAt, inc.prefs.updatedAt);

    mergeMap(out.checklists.items, inc.checklists.items, (a, b) => b.at > a.at);
    out.checklists.updatedAt = Math.max(base.checklists.updatedAt, inc.checklists.updatedAt);

    if (inc.lastLocation.updatedAt > out.lastLocation.updatedAt) out.lastLocation = clone(inc.lastLocation);

    for (const [k, t] of Object.entries(inc.tomb)) out.tomb[k] = Math.max(out.tomb[k] || 0, t);
    mergeMap(out.attempts, inc.attempts, (a, b) => b.updatedAt > a.updatedAt);
    for (const [id, t] of Object.entries(out.tomb)) {
      const a = out.attempts[id];
      if (a && a.updatedAt <= t) delete out.attempts[id];
    }
    // Un solo borrador abierto por caso: se queda el más reciente.
    const draftByCase = {};
    for (const a of Object.values(out.attempts)) {
      if (a.status !== 'draft') continue;
      const prev = draftByCase[a.caseId];
      if (!prev) { draftByCase[a.caseId] = a; continue; }
      const loser = prev.updatedAt >= a.updatedAt ? a : prev;
      draftByCase[a.caseId] = loser === a ? prev : a;
      delete out.attempts[loser.id];
      out.tomb[loser.id] = Math.max(out.tomb[loser.id] || 0, loser.updatedAt);
    }
    out.updatedAt = Math.max(base.updatedAt, inc.updatedAt);
    return out;
  }

  // ------------------------------------------------------------------ estado en memoria + localStorage
  let state = emptyState();
  let localAvailable = false;   // localStorage accesible al cargar
  let localWriteOK = true;      // la última escritura local funcionó
  let localTimer = null;
  const listeners = new Set();
  const statusListeners = new Set();
  let lastStatus = null;

  function getLS() { try { return root.localStorage || null; } catch (e) { return null; } }

  function loadLocal() {
    const ls = getLS();
    if (!ls) return;
    let raw = null;
    try {
      raw = ls.getItem(KEY);
      ls.setItem(KEY + '.probe', '1');
      ls.removeItem(KEY + '.probe');
      localAvailable = true;
    } catch (e) { localAvailable = false; return; }
    if (!raw) return;
    try { state = sanitize(JSON.parse(raw)); }
    catch (e) {
      // JSON corrupto: se guarda una copia para no perderlo al sobrescribir.
      try { ls.setItem(KEY + '.corrupto', raw); } catch (_) { /* nada */ }
      state = emptyState();
    }
  }

  function scheduleLocal() {
    hookPageLifecycle();
    if (!localAvailable || localTimer) return;
    localTimer = setTimeout(flushLocal, cfg.localDelay);
  }

  function flushLocal() {
    if (localTimer) { clearTimeout(localTimer); localTimer = null; }
    if (!localAvailable) return;
    const ls = getLS();
    let ok = false;
    try {
      if (ls) {
        // Otra pestaña pudo escribir desde nuestra última lectura: fusionar antes de sobrescribir
        // (las lápidas mantienen borrado lo borrado; los timestamps por clave deciden los conflictos).
        let cur = null;
        try { const raw = ls.getItem(KEY); if (raw) cur = sanitize(JSON.parse(raw)); } catch (_) { cur = null; }
        if (cur) {
          const before = JSON.stringify(state);
          state = mergeInto(state, cur);
          if (JSON.stringify(state) !== before) notify('remote');
        }
        ls.setItem(KEY, JSON.stringify(state));
        ok = true;
      }
    } catch (e) { ok = false; }
    if (ok !== localWriteOK) { localWriteOK = ok; emitStatus(); }
  }

  // Al ocultar/cerrar la página se vacían las escrituras pendientes (se engancha la primera vez que hay una).
  let hooked = false;
  function hookPageLifecycle() {
    if (hooked) return;
    hooked = true;
    try {
      if (typeof root.addEventListener === 'function') {
        root.addEventListener('pagehide', flushAll);
        root.addEventListener('beforeunload', flushLocal);
      }
      const doc = root.document;
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') flushAll(); });
      }
    } catch (e) { /* entorno sin eventos (Node) */ }
  }

  function flushAll() {
    flushLocal();
    if (!remote || remote.dead) return;
    for (const [key, d] of remote.docs) {
      if (d.dirty && !d.writing && !d.disabled) { if (d.timer) clearTimeout(d.timer); d.timer = null; flushDoc(key); }
    }
  }

  function backend() {
    if (remote && !remote.dead) return 'account';
    return localAvailable && localWriteOK ? 'local' : 'memory';
  }

  function emitStatus() {
    const s = backend();
    if (s === lastStatus) return;
    lastStatus = s;
    for (const fn of Array.from(statusListeners)) { try { fn(s); } catch (e) { logErr(e); } }
  }

  function notify(kind) {
    for (const fn of Array.from(listeners)) { try { fn(kind); } catch (e) { logErr(e); } }
  }

  // Tras cada mutación: persistir (local + remoto) y avisar a los suscriptores.
  function commit(kind, remoteKeys) {
    state.updatedAt = now();
    scheduleLocal();
    (remoteKeys || ['main']).forEach(scheduleRemote);
    notify(kind);
  }

  // ------------------------------------------------------------------ sincronización con la cuenta (Artifact)
  let remote = null;   // { mainRef, col, docs: Map(key → {timer, dirty, writing, last, disabled, retried, parked, firstDirty}), dead }

  function mainUpdatedAt(s) {
    let t = Math.max(s.progress.updatedAt, s.flash.updatedAt, s.prefs.updatedAt, s.checklists.updatedAt, s.lastLocation.updatedAt);
    for (const v of Object.values(s.tomb)) t = Math.max(t, v);
    return t;
  }
  function mainBody(s) {
    return { v: 1, updatedAt: mainUpdatedAt(s), progress: s.progress, flash: s.flash, prefs: s.prefs, checklists: s.checklists, lastLocation: s.lastLocation, tomb: s.tomb };
  }
  function attemptBody(a) { return clone(a); }
  const attemptKey = (id) => 'a:' + id;

  function docEntry(key) {
    let d = remote.docs.get(key);
    if (!d) { d = { timer: null, dirty: false, writing: false, last: undefined, disabled: false, retried: false, parked: false, firstDirty: 0 }; remote.docs.set(key, d); }
    return d;
  }

  function scheduleRemote(key) {
    if (!remote || remote.dead) return;
    const d = docEntry(key);
    if (d.disabled) return;
    const t = now();
    if (!d.dirty) d.firstDirty = t;
    d.dirty = true;
    d.parked = false;
    d.retried = false;
    // Coalescencia: se escribe ≥ syncDelay después del último cambio, salvo que ya lleve maxWait esperando.
    if (d.timer) {
      if (t - d.firstDirty >= cfg.maxWait) return;
      clearTimeout(d.timer);
    }
    d.timer = setTimeout(() => flushDoc(key), cfg.syncDelay);
  }

  async function flushDoc(key) {
    const r = remote;
    if (!r || r.dead) return;
    const d = r.docs.get(key);
    if (!d || d.disabled) return;
    d.timer = null;
    if (d.writing || !d.dirty) return;   // una escritura a la vez por documento; la actual reprograma al terminar
    d.dirty = false;
    let body = null;
    let ref;
    try {
      if (key === 'main') { body = mainBody(state); ref = r.mainRef; }
      else {
        const id = key.slice(2);
        const a = state.attempts[id];
        body = a ? attemptBody(a) : null;
        ref = r.col.doc(id);
      }
    } catch (e) { d.disabled = true; return; }   // ruta inválida (no debería pasar: ids validados)
    const json = body ? JSON.stringify(body) : null;
    if (json === d.last) return;                       // nada cambió desde la última escritura
    if (body === null && d.last == null) return;       // borrado de algo que nunca estuvo en la db
    d.writing = true;
    try {
      if (body) await ref.set(JSON.parse(json)); else await ref.delete();
      d.last = json;
      d.retried = false;
    } catch (e) {
      onWriteError(e, key, d);
    } finally {
      d.writing = false;
      if (!r.dead && d.dirty && !d.timer && !d.disabled && !d.parked) d.timer = setTimeout(() => flushDoc(key), cfg.syncDelay);
    }
  }

  function onWriteError(e, key, d) {
    const code = e && e.code;
    d.dirty = true;
    if (code === 'invalid_argument' || code === 'transform_error' || code === 'quota_exceeded') {
      // Reintentar no sirve: se deja de sincronizar este documento; lo local sigue guardando.
      d.disabled = true;
      d.dirty = false;
      if (key === 'main') degrade();
    } else if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      degrade();
    } else if (!d.retried) {
      // unavailable (o código desconocido): un reintento tras 1–3 s aleatorios.
      d.retried = true;
      d.timer = setTimeout(() => flushDoc(key), 1000 + Math.random() * 2000);
    } else {
      d.parked = true;   // queda pendiente: se reintenta con el próximo cambio
    }
  }

  function degrade() {
    if (!remote) return;
    remote.dead = true;
    for (const d of remote.docs.values()) if (d.timer) clearTimeout(d.timer);
    remote = null;
    emitStatus();
  }

  function startRemote() {
    const c = root.claude;
    if (!c || typeof c.use !== 'function') return;
    let pDb, pUser;
    try { pDb = c.use('db'); pUser = c.use('user'); } catch (e) { return; }
    Promise.all([pDb, pUser]).then(async ([db, user]) => {
      if (!db || !user || typeof user.id !== 'function') return;
      const uid = await user.id();
      if (!uid || typeof uid !== 'string') return;
      const mainRef = db.doc('data/users/' + uid + '/state');
      const col = mainRef.collection('attempts');
      const readOnce = async (fn) => {
        try { return await fn(); }
        catch (e) {
          if (e && e.code === 'unavailable') { await new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000)); return fn(); }
          throw e;
        }
      };
      const snap = await readOnce(() => mainRef.get());
      const qs = await readOnce(() => col.get());
      const remoteMain = snap && snap.exists ? (snap.data() || {}) : null;
      const remoteAttempts = {};
      for (const ds of (qs && qs.docs) || []) {
        if (!ds.exists) continue;
        const a = sanitizeAttempt(ds.data(), ds.id);
        if (a) remoteAttempts[a.id] = a;
      }
      const rs = sanitize(Object.assign({}, remoteMain || {}, { v: 1, attempts: remoteAttempts }));
      const before = JSON.stringify(state);
      state = mergeInto(state, rs);

      remote = { mainRef, col, docs: new Map(), dead: false };
      // Lo que ya está en la db cuenta como "escrito": solo se reescribe lo que cambió.
      docEntry('main').last = remoteMain ? JSON.stringify(mainBody(rs)) : null;
      for (const a of Object.values(rs.attempts)) docEntry(attemptKey(a.id)).last = JSON.stringify(attemptBody(a));
      scheduleRemote('main');
      for (const id of Object.keys(state.attempts)) scheduleRemote(attemptKey(id));
      for (const id of Object.keys(state.tomb)) if (rs.attempts[id]) scheduleRemote(attemptKey(id));
      emitStatus();
      if (JSON.stringify(state) !== before) { scheduleLocal(); notify('remote'); }
    }).catch((e) => {
      // Sin acceso a la db (revocado, sin permisos, etc.): se sigue con el guardado local.
      if (remote) degrade();
      if (e && e.code && root.console && root.console.warn) root.console.warn('[store] sincronización desactivada: ' + e.code);
    });
  }

  // ------------------------------------------------------------------ API: progreso
  const secKey = (pageId, sectionId) => pageId + '.' + sectionId;
  const ckKey = (pageId, listId, itemId) => pageId + '|' + listId + '|' + itemId;

  function isSectionRead(pageId, sectionId) {
    const e = state.progress.sections[secKey(pageId, sectionId)];
    return !!(e && e.read);
  }

  function setSectionRead(pageId, sectionId, read) {
    const k = secKey(pageId, sectionId);
    const cur = state.progress.sections[k];
    if (!!(cur && cur.read) === !!read) return;
    const t = now();
    state.progress.sections[k] = { read: !!read, at: t };
    state.progress.updatedAt = t;
    commit('progress');
  }

  function pageEntry(pageId) {
    return state.progress.pages[pageId] || (state.progress.pages[pageId] = { completed: false, at: 0, visitedAt: 0 });
  }

  function getPageSafe(id) {
    try { return typeof MSD.getPage === 'function' ? MSD.getPage(id) : null; } catch (e) { return null; }
  }

  function pageProgress(pageId) {
    const page = getPageSafe(pageId);
    const secs = page && Array.isArray(page.sections) ? page.sections : [];
    let read = 0;
    for (const s of secs) if (s && isSectionRead(pageId, s.id)) read++;
    const total = secs.length;
    const p = state.progress.pages[pageId];
    const completed = !!(p && p.completed);
    return { read, total, pct: total ? Math.round((read / total) * 100) : (completed ? 100 : 0), completed };
  }

  function setPageCompleted(pageId, completed) {
    const p = pageEntry(pageId);
    if (p.completed === !!completed) return;
    const t = now();
    p.completed = !!completed;
    p.at = t;
    state.progress.updatedAt = t;
    commit('progress');
  }

  function hasDoneAttempt(caseId) {
    for (const a of Object.values(state.attempts)) if (a.caseId === caseId && a.status === 'done') return true;
    return false;
  }

  // Estado de una página para el "uptime strip": done | progress | ready | soon.
  function pageState(pageId) {
    const page = getPageSafe(pageId);
    const pr = pageProgress(pageId);
    if (pr.completed) return 'done';
    if (!page || !page.ready) return 'soon';
    if (pr.read > 0 || hasDoneAttempt(pageId)) return 'progress';
    return 'ready';
  }

  function courseOrderSafe() {
    try { if (typeof MSD.courseOrder === 'function') return MSD.courseOrder(); } catch (e) { /* nada */ }
    return [];
  }

  function courseProgress() {
    const ids = courseOrderSafe();
    let done = 0, inProgress = 0, ready = 0;
    for (const id of ids) {
      const st = pageState(id);
      if (st === 'done') done++;
      if (st === 'progress') inProgress++;
      const page = getPageSafe(id);
      if (page && page.ready) ready++;
    }
    const total = ids.length;
    return { done, inProgress, ready, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function markVisited(pageId) {
    if (typeof pageId !== 'string' || !pageId) return;
    const t = now();
    pageEntry(pageId).visitedAt = t;
    state.progress.updatedAt = t;
    commit('visit');
  }

  function getChecklist(pageId, listId) {
    const prefix = pageId + '|' + listId + '|';
    const out = {};
    for (const [k, e] of Object.entries(state.checklists.items)) if (e.on && k.startsWith(prefix)) out[k.slice(prefix.length)] = true;
    return out;
  }

  function setChecklistItem(pageId, listId, itemId, on) {
    const k = ckKey(pageId, listId, itemId);
    const cur = state.checklists.items[k];
    if (!!(cur && cur.on) === !!on) return;
    const t = now();
    state.checklists.items[k] = { on: !!on, at: t };
    state.checklists.updatedAt = t;
    commit('checklist');
  }

  function lastLocation() { return state.lastLocation.hash || ''; }
  function setLastLocation(hash) {
    const h = typeof hash === 'string' ? (hash.charAt(0) === '#' ? hash : '#' + hash) : '';
    if (!/^#[A-Za-z0-9._~-]*$/.test(h) || h === state.lastLocation.hash) return;
    state.lastLocation = { updatedAt: now(), hash: h };
    commit('location');
  }

  // ------------------------------------------------------------------ API: práctica
  function copyAttempt(a) { return a ? clone(a) : null; }
  function newAttemptId(caseId) {
    return 'a-' + String(caseId).replace(/[^A-Za-z0-9_-]/g, '') + '-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }
  function findDraft(caseId) {
    let best = null;
    for (const a of Object.values(state.attempts)) {
      if (a.caseId === caseId && a.status === 'draft' && (!best || a.updatedAt > best.updatedAt)) best = a;
    }
    return best;
  }
  function commitAttempt(id, alsoMain) {
    commit('practice', alsoMain ? [attemptKey(id), 'main'] : [attemptKey(id)]);
  }
  function createDraft(caseId) {
    const t = now();
    const d = { id: newAttemptId(caseId), caseId, status: 'draft', text: '', elapsedSec: 0, running: false, resumedAt: null, createdAt: t, updatedAt: t };
    state.attempts[d.id] = d;
    return d;
  }

  function getDraft(caseId) { return copyAttempt(findDraft(caseId)); }

  function startDraft(caseId) {
    let d = findDraft(caseId);
    if (!d) { d = createDraft(caseId); commitAttempt(d.id); }
    return copyAttempt(d);
  }

  const PROTECTED = ['id', 'caseId', 'status', 'createdAt', 'updatedAt', 'finishedAt'];
  function updateDraft(caseId, patch) {
    let d = findDraft(caseId);
    let changed = false;
    if (!d) { d = createDraft(caseId); changed = true; }
    for (const k of Object.keys(isObj(patch) ? patch : {})) {
      if (PROTECTED.indexOf(k) >= 0) continue;
      let v = patch[k];
      if (k === 'text') v = String(v == null ? '' : v).slice(0, MAX_TEXT);
      else if (k === 'elapsedSec') v = Math.max(0, num(v, 0));
      else if (k === 'running') v = !!v;
      else if (k === 'resumedAt') v = typeof v === 'number' && isFinite(v) ? v : null;
      if (v === undefined) continue;
      if (JSON.stringify(d[k]) !== JSON.stringify(v)) { d[k] = clone(v); changed = true; }
    }
    if (changed) { d.updatedAt = now(); commitAttempt(d.id); }
    return copyAttempt(d);
  }

  function finishAttempt(caseId, result) {
    const r = isObj(result) ? result : {};
    const d = findDraft(caseId) || createDraft(caseId);
    const t = now();
    if (d.running && typeof d.resumedAt === 'number') d.elapsedSec += Math.max(0, (t - d.resumedAt) / 1000);
    d.elapsedSec = Math.round(d.elapsedSec);
    d.running = false;
    d.resumedAt = null;
    d.status = 'done';
    d.finishedAt = t;
    d.updatedAt = t;
    if (r.rubric !== undefined) d.rubric = clone(r.rubric);
    if (r.score !== undefined) d.score = clone(r.score);
    commitAttempt(d.id);
    return copyAttempt(d);
  }

  function saveRubric(attemptId, rubric, score) {
    const a = state.attempts[attemptId];
    if (!a) return null;
    if (rubric !== undefined) a.rubric = clone(rubric);
    if (score !== undefined) a.score = clone(score);
    a.updatedAt = now();
    commitAttempt(a.id);
    return copyAttempt(a);
  }

  function removeAttempt(a) {
    delete state.attempts[a.id];
    state.tomb[a.id] = now();
    commitAttempt(a.id, true);
  }

  function discardDraft(caseId) {
    const d = findDraft(caseId);
    if (d) removeAttempt(d);
  }

  function deleteAttempt(attemptId) {
    const a = state.attempts[attemptId];
    if (a) removeAttempt(a);
  }

  // listAttempts(caseId?, {includeDrafts}?) o listAttempts({includeDrafts}) — más recientes primero.
  function listAttempts(caseId, opts) {
    if (isObj(caseId)) { opts = caseId; caseId = undefined; }
    const withDrafts = !!(opts && opts.includeDrafts);
    const when = (a) => a.finishedAt || a.updatedAt || a.createdAt || 0;
    return Object.values(state.attempts)
      .filter((a) => (!caseId || a.caseId === caseId) && (withDrafts || a.status === 'done'))
      .sort((a, b) => when(b) - when(a))
      .map(copyAttempt);
  }

  // ------------------------------------------------------------------ API: flashcards (Leitner)
  function cardState(cardId) {
    const c = state.flash.cards[cardId];
    return c ? Object.assign({}, c) : { box: 0, due: now(), seen: 0, lapses: 0, last: null };
  }

  // again → caja 0, vence ya · hard → misma caja, +1 día (caja 0: +10 min) · good → caja+1 con su intervalo.
  function gradeCard(cardId, grade) {
    if (typeof cardId !== 'string' || ['again', 'hard', 'good'].indexOf(grade) < 0) return cardState(cardId);
    const t = now();
    const prev = cardState(cardId);
    let box = prev.box;
    let lapses = prev.lapses;
    let due;
    if (grade === 'again') { if (prev.box > 0) lapses++; box = 0; due = t; }
    else if (grade === 'hard') { due = box === 0 ? t + 10 * MIN : t + DAY; }
    else { box = Math.min(4, box + 1); due = t + LEITNER_DAYS[box] * DAY; }
    const next = { box, due, seen: prev.seen + 1, lapses, last: t };
    state.flash.cards[cardId] = next;
    state.flash.updatedAt = t;
    commit('flash');
    return Object.assign({}, next);
  }

  function dueCards(cardIds) {
    const t = now();
    return (Array.isArray(cardIds) ? cardIds : []).filter((id) => {
      const c = state.flash.cards[id];
      return !c || c.due <= t;
    });
  }

  // Extra (no en el contrato mínimo): conteo por caja y vencidas, para estadísticas.
  function flashStats(cardIds) {
    const ids = Array.isArray(cardIds) ? cardIds : [];
    const boxes = [0, 0, 0, 0, 0];
    let seen = 0;
    for (const id of ids) {
      const c = state.flash.cards[id];
      boxes[c ? c.box : 0]++;
      if (c && c.seen > 0) seen++;
    }
    return { total: ids.length, due: dueCards(ids).length, seen, boxes };
  }

  // ------------------------------------------------------------------ API: preferencias
  function pref(key) {
    const e = state.prefs.values[key];
    const v = e ? e.v : PREF_DEFAULTS[key];
    return v !== null && typeof v === 'object' ? clone(v) : v;
  }

  function setPref(key, value) {
    if (typeof key !== 'string' || !key) return;
    const v = value === undefined ? null : clone(value);
    const cur = state.prefs.values[key];
    if (cur && JSON.stringify(cur.v) === JSON.stringify(v)) return;
    const t = now();
    state.prefs.values[key] = { v, at: t };
    state.prefs.updatedAt = t;
    commit('prefs');
  }

  // ------------------------------------------------------------------ API: portabilidad
  function exportJSON() {
    return JSON.stringify({ app: 'ronda-diseno-ml', v: 1, exportedAt: new Date(now()).toISOString(), state }, null, 2);
  }

  function importJSON(str) {
    let data;
    try { data = JSON.parse(String(str == null ? '' : str)); }
    catch (e) { return { ok: false, error: 'El texto no es JSON válido. Pega el respaldo completo, desde la primera { hasta la última }.' }; }
    if (!isObj(data)) return { ok: false, error: 'Se esperaba un objeto JSON (el respaldo empieza con {).' };
    const raw = isObj(data.state) ? data.state : data;
    if (raw.v !== 1) return { ok: false, error: 'No parece un respaldo de Ronda de Diseño ML (falta "v": 1).' };
    const known = ['progress', 'flash', 'prefs', 'checklists', 'lastLocation', 'attempts'];
    if (!known.some((k) => k in raw)) return { ok: false, error: 'El respaldo no contiene progreso reconocible.' };
    for (const k of known) if (k in raw && !isObj(raw[k])) return { ok: false, error: 'Formato inválido en "' + k + '".' };
    const inc = sanitize(raw);
    state = mergeInto(state, inc);
    state.updatedAt = Math.max(state.updatedAt, now());
    scheduleLocal();
    if (remote) {
      scheduleRemote('main');
      for (const id of Object.keys(state.attempts)) scheduleRemote(attemptKey(id));
      for (const id of Object.keys(state.tomb)) scheduleRemote(attemptKey(id));
    }
    notify('import');
    return {
      ok: true,
      sections: Object.values(inc.progress.sections).filter((e) => e.read).length,
      attempts: Object.keys(inc.attempts).length,
      cards: Object.keys(inc.flash.cards).length,
    };
  }

  // ------------------------------------------------------------------ suscripciones
  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function onStatus(fn) {
    if (typeof fn !== 'function') return () => {};
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  }

  // ------------------------------------------------------------------ arranque
  loadLocal();
  // Otra pestaña de la app guardó: se fusiona aquí para que la próxima escritura no pise lo suyo.
  try {
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('storage', (e) => {
        if (!e || e.key !== KEY || !e.newValue) return;
        try {
          const before = JSON.stringify(state);
          state = mergeInto(state, sanitize(JSON.parse(e.newValue)));
          if (JSON.stringify(state) !== before) notify('remote');
        } catch (_) { /* valor ajeno o corrupto: se ignora */ }
      });
    }
  } catch (e) { /* Node */ }
  lastStatus = backend();
  startRemote();

  MSD.store = {
    subscribe,
    getState: () => clone(state),
    // progreso
    isSectionRead, setSectionRead, pageProgress, setPageCompleted, courseProgress, pageState, markVisited,
    getChecklist, setChecklistItem, lastLocation, setLastLocation,
    // práctica
    getDraft, startDraft, updateDraft, finishAttempt, saveRubric, discardDraft, listAttempts, deleteAttempt,
    // flashcards
    cardState, gradeCard, dueCards, flashStats,
    // preferencias
    pref, setPref,
    // portabilidad y estado del guardado
    exportJSON, importJSON, backend, onStatus,
    flush: flushAll,
    LEITNER_DAYS: LEITNER_DAYS.slice(),
    _configure(o) { Object.assign(cfg, o || {}); },   // solo para tests
  };
})(typeof window !== 'undefined' ? window : globalThis);
