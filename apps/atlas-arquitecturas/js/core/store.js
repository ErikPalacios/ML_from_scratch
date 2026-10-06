/* =============================================================================
   Atlas de Arquitecturas — js/core/store.js
   Basado en apps/ml-system-design/js/core/store.js.
   Estado del usuario (progreso, flashcards, práctica: drills y diagramas en blanco,
   preferencias, checklists) con persistencia en dos niveles (SPEC §4.4):
     1) localStorage 'atlas.v1', siempre (cada acceso con try/catch; si falla, solo memoria);
     2) dentro de un Artifact de claude.ai: base de datos privada del usuario
        (data/users/<uid>/state + data/users/<uid>/practice), con fusión por timestamps.
   Sin DOM al cargar: también se carga en Node (tests/store.test.cjs).
   Todas las marcas de tiempo salen de Date.now() (los tests lo controlan).
   Diferencias con la Ronda: no hay intentos/borradores/rúbrica; se agregan
   drillResult/drillStats (drills de formas, what-if, diagramas en blanco) y
   blankDiagram/setBlankSlot. La práctica vive en su propio documento ('practice')
   para que responder drills no reescriba el documento principal.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const KEY = 'atlas.v1';
  const APP_ID = 'atlas-arquitecturas';
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const LEITNER_DAYS = [0, 1, 3, 7, 16];   // intervalo de cada caja de Leitner (días)
  const MAX_LOG = 400;                     // historial de respuestas de drills (para la racha)
  const MAX_ANSWER = 200;                  // tope de la respuesta guardada por drill
  const ID_RE = /^[A-Za-z0-9_\-.~:@+>|]{1,200}$/;   // ids de drills / diagramas / slots
  const PREF_DEFAULTS = { theme: 'system', legendOpen: true, showNumbers: true };
  // Valores válidos de las preferencias conocidas (las demás claves se aceptan tal cual).
  const PREF_OK = {
    theme: (v) => v === 'system' || v === 'light' || v === 'dark',
    legendOpen: (v) => typeof v === 'boolean',
    showNumbers: (v) => typeof v === 'boolean',
  };
  const prefOk = (k, v) => !PREF_OK[k] || PREF_OK[k](v);
  // Tiempos (configurables solo para los tests): escritura local, pausa antes de sincronizar,
  // y espera máxima para no posponer la sincronización indefinidamente.
  const cfg = { localDelay: 250, syncDelay: 2000, maxWait: 15000 };

  const now = () => Date.now();
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const int = (x, d, lo, hi) => Math.min(hi, Math.max(lo, Math.round(num(x, d))));
  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const logErr = (e) => { try { if (root.console) root.console.error(e); } catch (_) { /* nada */ } };
  const validId = (s) => typeof s === 'string' && ID_RE.test(s);

  // ------------------------------------------------------------------ forma del estado
  function emptyState() {
    return {
      v: 1,
      updatedAt: 0,
      progress: { updatedAt: 0, sections: {}, pages: {} },   // sections['vit.diagrama'] = {read, at}; pages.vit = {completed, at, visitedAt}
      flash: { updatedAt: 0, cards: {} },                      // cards[id] = {box, due, seen, lapses, last}
      prefs: { updatedAt: 0, values: {} },                     // values[key] = {v, at} (fusión por clave)
      checklists: { updatedAt: 0, items: {} },                 // items['vit|checklist|item'] = {on, at}
      lastLocation: { updatedAt: 0, hash: '' },
      drills: { updatedAt: 0, items: {}, log: [] },            // items[drillId] = {seen, ok, lastOk, answer, lastAt}; log = [{id, ok, at}]
      blank: { updatedAt: 0, items: {} },                      // items[diagramId] = {slots:{slotId:{v, at}}, checked:{v, at}}
    };
  }

  function sanitizeDrillItem(e) {
    if (!isObj(e)) return null;
    return {
      seen: int(e.seen, 0, 0, 1e9), ok: int(e.ok, 0, 0, 1e9), lastOk: !!e.lastOk,
      answer: typeof e.answer === 'string' ? e.answer.slice(0, MAX_ANSWER) : '',
      lastAt: num(e.lastAt, 0),
    };
  }

  function sanitizeBlankItem(e) {
    if (!isObj(e)) return null;
    const out = { slots: {}, checked: { v: null, at: 0 } };
    if (isObj(e.slots)) {
      for (const [k, s] of Object.entries(e.slots)) {
        if (!validId(k) || !isObj(s)) continue;
        out.slots[k] = { v: typeof s.v === 'string' && s.v.length <= MAX_ANSWER ? s.v : null, at: num(s.at, 0) };
      }
    }
    if (isObj(e.checked)) {
      const c = e.checked.v;
      out.checked = {
        v: isObj(c) ? { at: num(c.at, 0), ok: int(c.ok, 0, 0, 1e6), total: int(c.total, 0, 0, 1e6) } : null,
        at: num(e.checked.at, 0),
      };
    }
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
      for (const [k, e] of Object.entries(pf.values)) if (isObj(e) && 'v' in e && prefOk(k, e.v)) s.prefs.values[k] = { v: clone(e.v), at: num(e.at, 0) };
    }

    const ck = isObj(raw.checklists) ? raw.checklists : {};
    s.checklists.updatedAt = num(ck.updatedAt, 0);
    if (isObj(ck.items)) {
      for (const [k, e] of Object.entries(ck.items)) if (isObj(e)) s.checklists.items[k] = { on: !!e.on, at: num(e.at, 0) };
    }

    const ll = isObj(raw.lastLocation) ? raw.lastLocation : {};
    s.lastLocation = { updatedAt: num(ll.updatedAt, 0), hash: typeof ll.hash === 'string' && /^(#[A-Za-z0-9._~-]*)?$/.test(ll.hash) ? ll.hash : '' };

    const dr = isObj(raw.drills) ? raw.drills : {};
    s.drills.updatedAt = num(dr.updatedAt, 0);
    if (isObj(dr.items)) {
      for (const [k, e] of Object.entries(dr.items)) { const x = validId(k) ? sanitizeDrillItem(e) : null; if (x) s.drills.items[k] = x; }
    }
    if (Array.isArray(dr.log)) {
      s.drills.log = dr.log.filter((e) => isObj(e) && validId(e.id) && typeof e.at === 'number' && isFinite(e.at))
        .map((e) => ({ id: e.id, ok: !!e.ok, at: e.at })).slice(-MAX_LOG);
    }

    const bl = isObj(raw.blank) ? raw.blank : {};
    s.blank.updatedAt = num(bl.updatedAt, 0);
    if (isObj(bl.items)) {
      for (const [k, e] of Object.entries(bl.items)) { const x = validId(k) ? sanitizeBlankItem(e) : null; if (x) s.blank.items[k] = x; }
    }
    return s;
  }

  // ------------------------------------------------------------------ fusión (db ↔ local, pestañas, importación)
  // Mapas: unión; en conflicto gana la entrada más reciente.
  function mergeMap(dst, src, newer) {
    for (const [k, b] of Object.entries(src)) {
      const a = dst[k];
      if (!a || newer(a, b)) dst[k] = clone(b);
    }
  }

  function mergeLog(a, b) {
    const seen = new Set();
    const out = [];
    for (const e of a.concat(b)) {
      const k = e.id + '@' + e.at;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
    out.sort((x, y) => x.at - y.at);
    return out.slice(-MAX_LOG);
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

    mergeMap(out.drills.items, inc.drills.items, (a, b) => b.lastAt > a.lastAt || (b.lastAt === a.lastAt && b.seen > a.seen));
    out.drills.log = mergeLog(out.drills.log, inc.drills.log);
    out.drills.updatedAt = Math.max(base.drills.updatedAt, inc.drills.updatedAt);

    for (const [k, b] of Object.entries(inc.blank.items)) {
      const a = out.blank.items[k];
      if (!a) { out.blank.items[k] = clone(b); continue; }
      mergeMap(a.slots, b.slots, (x, y) => y.at > x.at);
      if (b.checked.at > a.checked.at) a.checked = clone(b.checked);
    }
    out.blank.updatedAt = Math.max(base.blank.updatedAt, inc.blank.updatedAt);

    out.updatedAt = Math.max(base.updatedAt, inc.updatedAt);
    return out;
  }

  // Qué áreas cambiaron entre dos estados (para avisar con el tipo concreto, no con un 'remote' genérico):
  // una pestaña que solo desplazó la página (lastLocation) o visitó otra (visitedAt) no obliga a
  // volver a pintar nada aquí.
  const J = (x) => JSON.stringify(x);
  function completedOnly(pages) {
    const o = {};
    for (const k of Object.keys(pages).sort()) if (pages[k].completed || pages[k].at) o[k] = [pages[k].completed, pages[k].at];   // sin marcar = ausente
    return o;
  }
  function changedKinds(a, b) {
    const k = [];
    if (J(a.progress.sections) !== J(b.progress.sections) || J(completedOnly(a.progress.pages)) !== J(completedOnly(b.progress.pages))) k.push('progress');
    else if (J(a.progress.pages) !== J(b.progress.pages)) k.push('visit');
    if (J(a.flash.cards) !== J(b.flash.cards)) k.push('flash');
    if (J(a.prefs.values) !== J(b.prefs.values)) k.push('prefs');
    if (J(a.checklists.items) !== J(b.checklists.items)) k.push('checklist');
    if (J(a.drills.items) !== J(b.drills.items) || J(a.drills.log) !== J(b.drills.log)) k.push('drill');
    if (J(a.blank.items) !== J(b.blank.items)) k.push('blank');
    if (J(a.lastLocation) !== J(b.lastLocation)) k.push('location');
    return k;
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
        // (los timestamps por clave deciden los conflictos).
        let cur = null;
        try { const raw = ls.getItem(KEY); if (raw) cur = sanitize(JSON.parse(raw)); } catch (_) { cur = null; }
        if (cur) {
          const before = state;
          state = mergeInto(state, cur);
          changedKinds(before, state).forEach((k) => notify(k, 'tab'));
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
      if (d.soft && !d.disabled) { d.soft = false; d.dirty = true; }
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

  // fn(kind, source): source = 'local' (esta pestaña), 'tab' (otra pestaña) o 'account' (la db).
  function notify(kind, source) {
    for (const fn of Array.from(listeners)) { try { fn(kind, source || 'local'); } catch (e) { logErr(e); } }
  }

  // Tras cada mutación: persistir (local + remoto) y avisar a los suscriptores.
  // remoteKeys = [] (visitas y última ubicación): no programa una escritura en la cuenta; el cambio
  // viaja con la próxima escritura real del documento o al ocultar/cerrar la página (flushAll).
  function commit(kind, remoteKeys) {
    state.updatedAt = now();
    scheduleLocal();
    if (remoteKeys && !remoteKeys.length) markSoft('main');
    (remoteKeys || ['main']).forEach(scheduleRemote);
    notify(kind);
  }
  function markSoft(key) {
    if (!remote || remote.dead || !BODY[key]) return;
    docEntry(key).soft = true;
  }

  // ------------------------------------------------------------------ sincronización con la cuenta (Artifact)
  // Dos documentos: 'main' (progreso, flashcards, preferencias, checklists, última ubicación) y
  // 'practice' (drills y diagramas en blanco). Una escritura a la vez por documento.
  let remote = null;   // { refs:{main, practice}, docs: Map(key → {timer, dirty, writing, last, disabled, retried, parked, firstDirty}), dead }

  function mainBody(s) {
    const t = Math.max(s.progress.updatedAt, s.flash.updatedAt, s.prefs.updatedAt, s.checklists.updatedAt, s.lastLocation.updatedAt);
    return { v: 1, updatedAt: t, progress: s.progress, flash: s.flash, prefs: s.prefs, checklists: s.checklists, lastLocation: s.lastLocation };
  }
  function practiceBody(s) {
    return { v: 1, updatedAt: Math.max(s.drills.updatedAt, s.blank.updatedAt), drills: s.drills, blank: s.blank };
  }
  const BODY = { main: mainBody, practice: practiceBody };

  function docEntry(key) {
    let d = remote.docs.get(key);
    if (!d) { d = { timer: null, dirty: false, writing: false, last: undefined, disabled: false, retried: false, parked: false, firstDirty: 0 }; remote.docs.set(key, d); }
    return d;
  }

  function scheduleRemote(key) {
    if (!remote || remote.dead || !BODY[key]) return;
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
    d.soft = false;                      // lo "suave" (visitas, ubicación) va incluido en esta escritura
    let json;
    try { json = JSON.stringify(BODY[key](state)); } catch (e) { d.disabled = true; return; }
    if (json === d.last) return;                       // nada cambió desde la última escritura
    d.writing = true;
    try {
      await r.refs[key].set(JSON.parse(json));
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
      const refs = { main: db.doc('data/users/' + uid + '/state'), practice: db.doc('data/users/' + uid + '/practice') };
      const readOnce = async (fn) => {
        try { return await fn(); }
        catch (e) {
          if (e && e.code === 'unavailable') { await new Promise((res) => setTimeout(res, 1000 + Math.random() * 2000)); return fn(); }
          throw e;
        }
      };
      const snapMain = await readOnce(() => refs.main.get());
      const snapPrac = await readOnce(() => refs.practice.get());
      const remoteMain = snapMain && snapMain.exists ? (snapMain.data() || {}) : null;
      const remotePrac = snapPrac && snapPrac.exists ? (snapPrac.data() || {}) : null;
      const rs = sanitize(Object.assign({}, remotePrac || {}, remoteMain || {}, { v: 1 }));
      const before = JSON.stringify(state);
      state = mergeInto(state, rs);

      remote = { refs, docs: new Map(), dead: false };
      // Lo que ya está en la db cuenta como "escrito": solo se reescribe lo que cambió.
      docEntry('main').last = remoteMain ? JSON.stringify(mainBody(rs)) : null;
      docEntry('practice').last = remotePrac ? JSON.stringify(practiceBody(rs)) : null;
      scheduleRemote('main');
      scheduleRemote('practice');
      emitStatus();
      if (JSON.stringify(state) !== before) { scheduleLocal(); notify('remote', 'account'); }
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
    try { return typeof ATLAS.getPage === 'function' ? ATLAS.getPage(id) : null; } catch (e) { return null; }
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

  // Drills respondidos de una página de modelo (prefijo '<pageId>:' o '<pageId>.'): cuentan como "en curso".
  function hasDrills(pageId) {
    const a = pageId + ':', b = pageId + '.';
    for (const k of Object.keys(state.drills.items)) if (k.startsWith(a) || k.startsWith(b)) return true;
    return false;
  }

  // Estado de una página para la tira de familias: done | progress | ready | soon.
  function pageState(pageId) {
    const page = getPageSafe(pageId);
    const pr = pageProgress(pageId);
    if (pr.completed) return 'done';
    if (!page || !page.ready) return 'soon';
    if (pr.read > 0 || hasDrills(pageId)) return 'progress';
    return 'ready';
  }

  function courseOrderSafe() {
    try { if (typeof ATLAS.courseOrder === 'function') return ATLAS.courseOrder(); } catch (e) { /* nada */ }
    return [];
  }

  // Cuenta las páginas de modelo + repaso-atencion (no el mapa ni las referencias): SPEC §4.4.
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
    commit('visit', []);
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
    commit('location', []);
  }

  // ------------------------------------------------------------------ API: práctica (drills)
  // drillResult(drillId, {ok, answer}) — drills de formas, what-if y diagramas en blanco.
  // Convención de ids (la decide practice.js): '<pageId>:<tipo>:<…>' para poder filtrar por modelo.
  function drillResult(drillId, result) {
    if (!validId(drillId)) return null;
    const r = isObj(result) ? result : {};
    const t = now();
    const prev = state.drills.items[drillId] || { seen: 0, ok: 0, lastOk: false, answer: '', lastAt: 0 };
    const ok = !!r.ok;
    const next = {
      seen: prev.seen + 1, ok: prev.ok + (ok ? 1 : 0), lastOk: ok,
      answer: typeof r.answer === 'string' ? r.answer.slice(0, MAX_ANSWER) : (r.answer == null ? '' : String(r.answer).slice(0, MAX_ANSWER)),
      lastAt: t,
    };
    state.drills.items[drillId] = next;
    state.drills.log.push({ id: drillId, ok, at: t });
    if (state.drills.log.length > MAX_LOG) state.drills.log = state.drills.log.slice(-MAX_LOG);
    state.drills.updatedAt = t;
    commit('drill', ['practice']);
    return Object.assign({}, next);
  }

  function drillState(drillId) {
    const e = state.drills.items[drillId];
    return e ? Object.assign({}, e) : null;
  }

  // drillStats(prefix?) → {seen, ok, streak, lastAt, drills} — seen/ok suman todas las respuestas;
  // streak = respuestas correctas seguidas (las más recientes) dentro del prefijo; drills = ids distintos.
  function drillStats(prefix) {
    const p = typeof prefix === 'string' ? prefix : '';
    let seen = 0, ok = 0, lastAt = 0, drills = 0;
    for (const [k, e] of Object.entries(state.drills.items)) {
      if (p && !k.startsWith(p)) continue;
      drills++;
      seen += e.seen;
      ok += e.ok;
      lastAt = Math.max(lastAt, e.lastAt);
    }
    let streak = 0;
    for (let i = state.drills.log.length - 1; i >= 0; i--) {
      const e = state.drills.log[i];
      if (p && !e.id.startsWith(p)) continue;
      if (!e.ok) break;
      streak++;
    }
    return { seen, ok, streak, lastAt: lastAt || null, drills };
  }

  // ------------------------------------------------------------------ API: diagramas en blanco
  function blankEntry(diagramId) {
    return state.blank.items[diagramId] || (state.blank.items[diagramId] = { slots: {}, checked: { v: null, at: 0 } });
  }

  // blankDiagram(diagramId) → {filled:{slotId:answerId}, checkedAt?, result?}
  function blankDiagram(diagramId) {
    const e = state.blank.items[diagramId];
    const out = { filled: {} };
    if (!e) return out;
    for (const [k, s] of Object.entries(e.slots)) if (s.v != null) out.filled[k] = s.v;
    if (e.checked.v) { out.checkedAt = e.checked.v.at; out.result = { ok: e.checked.v.ok, total: e.checked.v.total }; }
    return out;
  }

  function setBlankSlot(diagramId, slotId, answerId) {
    if (!validId(diagramId) || !validId(slotId)) return;
    const v = answerId == null ? null : String(answerId).slice(0, MAX_ANSWER);
    const e = state.blank.items[diagramId];
    const cur = e && e.slots[slotId];
    if ((cur ? cur.v : null) === v) return;
    const t = now();
    blankEntry(diagramId).slots[slotId] = { v, at: t };
    state.blank.updatedAt = t;
    commit('blank', ['practice']);
  }

  // Extras (no en el contrato mínimo): marca "Comprobar" y reinicio de un diagrama en blanco.
  function checkBlankDiagram(diagramId, result) {
    if (!validId(diagramId)) return;
    const r = isObj(result) ? result : {};
    const t = now();
    blankEntry(diagramId).checked = { v: { at: t, ok: int(r.ok, 0, 0, 1e6), total: int(r.total, 0, 0, 1e6) }, at: t };
    state.blank.updatedAt = t;
    commit('blank', ['practice']);
  }

  function resetBlankDiagram(diagramId) {
    const e = state.blank.items[diagramId];
    if (!e) return;
    const t = now();
    for (const k of Object.keys(e.slots)) e.slots[k] = { v: null, at: t };
    e.checked = { v: null, at: t };
    state.blank.updatedAt = t;
    commit('blank', ['practice']);
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
    if (!prefOk(key, v)) return;
    const cur = state.prefs.values[key];
    if (cur && JSON.stringify(cur.v) === JSON.stringify(v)) return;
    const t = now();
    state.prefs.values[key] = { v, at: t };
    state.prefs.updatedAt = t;
    commit('prefs');
  }

  // ------------------------------------------------------------------ API: portabilidad
  function exportJSON() {
    return JSON.stringify({ app: APP_ID, v: 1, exportedAt: new Date(now()).toISOString(), state }, null, 2);
  }

  function importJSON(str) {
    let data;
    try { data = JSON.parse(String(str == null ? '' : str)); }
    catch (e) { return { ok: false, error: 'El texto no es JSON válido. Pega el respaldo completo, desde la primera { hasta la última }.' }; }
    if (!isObj(data)) return { ok: false, error: 'Se esperaba un objeto JSON (el respaldo empieza con {).' };
    if (typeof data.app === 'string' && data.app !== APP_ID) return { ok: false, error: 'Este respaldo es de otra app ("' + data.app + '"), no del Atlas de Arquitecturas.' };
    const raw = isObj(data.state) ? data.state : data;
    if (raw.v !== 1) return { ok: false, error: 'No parece un respaldo del Atlas de Arquitecturas (falta "v": 1).' };
    const known = ['progress', 'flash', 'prefs', 'checklists', 'lastLocation', 'drills', 'blank'];
    if (!known.some((k) => k in raw)) return { ok: false, error: 'El respaldo no contiene progreso reconocible.' };
    for (const k of known) if (k in raw && !isObj(raw[k])) return { ok: false, error: 'Formato inválido en "' + k + '".' };
    const inc = sanitize(raw);
    state = mergeInto(state, inc);
    state.updatedAt = Math.max(state.updatedAt, now());
    scheduleLocal();
    if (remote) { scheduleRemote('main'); scheduleRemote('practice'); }
    notify('import');
    return {
      ok: true,
      sections: Object.values(inc.progress.sections).filter((e) => e.read).length,
      cards: Object.keys(inc.flash.cards).length,
      drills: Object.keys(inc.drills.items).length,
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
          const before = state;
          state = mergeInto(state, sanitize(JSON.parse(e.newValue)));
          changedKinds(before, state).forEach((k) => notify(k, 'tab'));
        } catch (_) { /* valor ajeno o corrupto: se ignora */ }
      });
    }
  } catch (e) { /* Node */ }
  lastStatus = backend();
  startRemote();

  ATLAS.store = {
    subscribe,
    getState: () => clone(state),
    // progreso
    isSectionRead, setSectionRead, pageProgress, setPageCompleted, courseProgress, pageState, markVisited,
    getChecklist, setChecklistItem, lastLocation, setLastLocation,
    // práctica
    drillResult, drillStats, drillState, blankDiagram, setBlankSlot, checkBlankDiagram, resetBlankDiagram,
    // compatibilidad con código forkeado de la Ronda: el Atlas no guarda intentos con reloj
    listAttempts: () => [],
    // flashcards
    cardState, gradeCard, dueCards, flashStats,
    // preferencias
    pref, setPref,
    // portabilidad y estado del guardado
    exportJSON, importJSON, backend, onStatus,
    flush: flushAll,
    KEY,
    LEITNER_DAYS: LEITNER_DAYS.slice(),
    _configure(o) { Object.assign(cfg, o || {}); },   // solo para tests
  };
})(typeof window !== 'undefined' ? window : globalThis);
