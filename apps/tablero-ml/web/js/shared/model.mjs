/* Data model of the board: a project is one JSON document. Shared by the browser and the Vercel Function
   (api/index.mjs), so both validate with the same rules.
   - validateProject(doc) returns a list of errors (empty = valid) and never mutates the document.
   - Every array of objects has an `id`: ops (ops.mjs) address elements by id, not by position.
   - v2 (production mode): project `vars`, per-step `calcs` (entry gate), `gate` (waiver), `inputs`/`outputs`.
     migrate.mjs upgrades v1 documents. Enum values stay as stored in v1 (Spanish ids); labels are English. */

export const SCHEMA_VERSION = 2;

export const STATUS = ['pendiente', 'en_curso', 'hecho', 'bloqueado', 'no_aplica'];
export const STATUS_LABEL = { pendiente: 'To do', en_curso: 'In progress', hecho: 'Done', bloqueado: 'Blocked', no_aplica: 'N/A' };
export const VUELTA_STATUS = ['pendiente', 'en_curso', 'hecho'];
export const TRAMOS = ['diseno', 'datos', 'modelo', 'release', 'operacion'];
export const TRAMO_LABEL = { diseno: 'Design', datos: 'Data', modelo: 'Model', release: 'Release', operacion: 'Operations' };
export const SPEEDS = ['diseno', 'semanas', 'dias', 'ms', 'continuo', 'nuevo'];
export const SPEED_LABEL = { diseno: 'design', semanas: 'weeks', dias: 'days', ms: 'milliseconds', continuo: 'continuous', nuevo: 'pattern-specific' };
export const VAR_KINDS = ['requirement', 'assumption', 'benchmark', 'measured'];

export const PATTERNS = ['sincrono', 'batch', 'asincrono', 'llm', 'hibrido', 'streaming', 'edge'];

// Límites: un proyecto cabe de sobra en un valor de Redis y en localStorage.
export const LIMITS = {
  idLen: 40, title: 160, short: 400, text: 20000, code: 4000, url: 1000,
  steps: 60, items: 200, sessions: 1000, decisions: 500, vars: 200, docBytes: 900000,
};

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const VAR_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const isId = (s) => typeof s === 'string' && ID_RE.test(s);
export const isVarId = (s) => typeof s === 'string' && VAR_RE.test(s);

// Ids cortos y legibles para elementos nuevos (no hace falta que sean globales: basta con que no choquen en su arreglo).
export function newId(prefix = 'x') {
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36).slice(-4)}${r}`.slice(0, LIMITS.idLen);
}

// Fechas de calendario en la zona horaria de quien usa el tablero: en el navegador, la del sistema; en el servidor,
// TABLERO_TZ (por defecto America/Mexico_City, UTC−6 todo el año). Así una sesión de las 21:00 no cae en el día siguiente.
export const DEFAULT_TZ = 'America/Mexico_City';
export function localDate(d = new Date(), tz) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const today = (tz) => localDate(new Date(), tz);
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// Paso vacío con los campos que espera la UI. `seed` trae lo que venga de una plantilla.
export function emptyStep(seed = {}) {
  return {
    id: seed.id || newId('p'),
    base: seed.base ?? null,
    title: seed.title || 'Paso nuevo',
    tramo: TRAMOS.includes(seed.tramo) ? seed.tramo : 'release',
    speed: SPEEDS.includes(seed.speed) ? seed.speed : 'nuevo',
    question: seed.question || '',
    note: seed.note || '',
    status: seed.status || 'pendiente',
    reason: seed.reason || '',
    vuelta: { v1: 'pendiente', v2: 'pendiente', ...(seed.vuelta || {}) },
    inputs: seed.inputs || [],
    outputs: seed.outputs || [],
    calcs: (seed.calcs || []).map((c) => fillCalc(c)),
    gate: { waived: false, reason: '', at: '', ...(seed.gate || {}) },
    notes: seed.notes || '',
    done: (seed.done || []).map((d, i) => (typeof d === 'string' ? { id: `c${i + 1}`, text: d, ok: false } : d)),
    hitos: seed.hitos || [],
    results: seed.results || [],
    commands: seed.commands || [],
    files: seed.files || [],
    links: seed.links || [],
    updatedAt: seed.updatedAt || nowIso(),
  };
}

export function emptyProject({ id, name, pattern = 'sincrono', steps = [] }) {
  const t = nowIso();
  return {
    v: SCHEMA_VERSION, id, name, pattern, repo: '', goal: '', vueltaActual: 1,
    createdAt: t, updatedAt: t, lastActivity: t, rev: 0,
    resume: { where: '', next: '', nextStepId: null },
    vars: [], steps, sessions: [], decisions: [],
  };
}

// ---------------------------------------------------------------- validación
// Cada regla describe un objeto: campo → [tipo, opciones]. Campos desconocidos son error.
const S = (max) => ['string', { max }];
const E = (values) => ['enum', { values }];
const ARR = (item, max) => ['array', { item, max }];
const OBJ = (shape) => ['object', { shape }];
const NUL = (t) => [t[0], { ...t[1], nullable: true }];

const ITEM_ID = ['id', {}];
const NUM = (min, max) => ['num', { min, max }];
const SHAPES = {};
SHAPES.criterion = { id: ITEM_ID, text: S(LIMITS.short), ok: ['boolean', {}] };
SHAPES.hito = { id: ITEM_ID, text: S(LIMITS.title), status: E(STATUS), done: S(LIMITS.short) };
SHAPES.result = { id: ITEM_ID, name: S(LIMITS.title), value: S(LIMITS.title), unit: S(60), date: ['date', { optional: true }], note: S(LIMITS.short) };
SHAPES.command = { id: ITEM_ID, code: S(LIMITS.code), note: S(LIMITS.short) };
SHAPES.file = { id: ITEM_ID, path: S(LIMITS.short), ref: S(LIMITS.title) };
SHAPES.link = { id: ITEM_ID, label: S(LIMITS.title), href: ['url', {}] };
SHAPES.vuelta = { v1: E(VUELTA_STATUS), v2: E(VUELTA_STATUS) };
SHAPES.check = { expr: S(400), label: S(LIMITS.title) };
SHAPES.calc = {
  id: ITEM_ID, label: S(LIMITS.title), out: S(LIMITS.idLen), expr: S(400), unit: S(60), tol: NUM(0, 1), why: S(LIMITS.short),
  check: NUL(OBJ(SHAPES.check)), ref: S(LIMITS.url), answer: S(120), revealed: ['boolean', {}], note: S(LIMITS.short),
};
SHAPES.gate = { waived: ['boolean', {}], reason: S(LIMITS.short), at: S(30) };
SHAPES.var = { id: ['varid', {}], label: S(LIMITS.title), unit: S(60), value: S(60), kind: E(VAR_KINDS), source: S(LIMITS.short), ref: S(60), note: S(LIMITS.short) };
SHAPES.step = {
  id: ITEM_ID, base: NUL(S(LIMITS.idLen)), title: S(LIMITS.title), tramo: E(TRAMOS), speed: E(SPEEDS),
  question: S(LIMITS.short), note: S(LIMITS.text), status: E(STATUS), reason: S(LIMITS.short),
  vuelta: OBJ(SHAPES.vuelta), inputs: ['array', { item: S(LIMITS.short), max: 30 }], outputs: ['array', { item: S(LIMITS.short), max: 30 }],
  calcs: ARR(SHAPES.calc, 40), gate: OBJ(SHAPES.gate), notes: S(LIMITS.text),
  done: ARR(SHAPES.criterion, LIMITS.items), hitos: ARR(SHAPES.hito, LIMITS.items),
  results: ARR(SHAPES.result, LIMITS.items), commands: ARR(SHAPES.command, LIMITS.items),
  files: ARR(SHAPES.file, LIMITS.items), links: ARR(SHAPES.link, LIMITS.items),
  updatedAt: ['iso', {}],
};
SHAPES.session = {
  id: ITEM_ID, date: ['date', {}], did: S(LIMITS.text), measured: S(LIMITS.text), next: S(LIMITS.text),
  stepIds: ['array', { item: ['id', {}], max: LIMITS.steps }], source: E(['web', 'claude', 'import']),
};
SHAPES.decision = {
  id: ITEM_ID, date: ['date', {}], stepId: NUL(S(LIMITS.idLen)), what: S(LIMITS.short), against: S(LIMITS.short),
  why: S(LIMITS.text), status: E(['vigente', 'revisada']),
};
SHAPES.resume = { where: S(LIMITS.text), next: S(LIMITS.text), nextStepId: NUL(S(LIMITS.idLen)) };
SHAPES.project = {
  v: ['int', { min: 1, max: SCHEMA_VERSION }], id: ITEM_ID, name: S(LIMITS.title), pattern: E(PATTERNS),
  repo: S(LIMITS.short), goal: S(LIMITS.short), vueltaActual: ['int', { min: 1, max: 2 }],
  createdAt: ['iso', {}], updatedAt: ['iso', {}], lastActivity: ['iso', {}], rev: ['int', { min: 0, max: 1e12 }],
  resume: OBJ(SHAPES.resume), vars: ARR(SHAPES.var, LIMITS.vars),
  steps: ARR(SHAPES.step, LIMITS.steps), sessions: ARR(SHAPES.session, LIMITS.sessions), decisions: ARR(SHAPES.decision, LIMITS.decisions),
};

function check(value, rule, path, errors) {
  const [type, o] = rule;
  if (value === undefined) { if (!o.optional) errors.push(`${path}: missing`); return; }
  if (value === null) { if (!o.nullable) errors.push(`${path}: cannot be null`); return; }
  switch (type) {
    case 'string': if (typeof value !== 'string') errors.push(`${path}: must be a string`); else if (value.length > o.max) errors.push(`${path}: longer than ${o.max} characters`); break;
    case 'id': if (!isId(value)) errors.push(`${path}: invalid id (lowercase, digits and dashes, ≤ 40)`); break;
    case 'varid': if (!isVarId(value)) errors.push(`${path}: invalid variable name (snake_case, ≤ 40)`); break;
    case 'enum': if (!o.values.includes(value)) errors.push(`${path}: must be one of ${o.values.join(', ')}`); break;
    case 'boolean': if (typeof value !== 'boolean') errors.push(`${path}: must be true or false`); break;
    case 'int': if (!Number.isInteger(value) || value < o.min || value > o.max) errors.push(`${path}: integer between ${o.min} and ${o.max}`); break;
    case 'num': if (typeof value !== 'number' || !Number.isFinite(value) || value < o.min || value > o.max) errors.push(`${path}: number between ${o.min} and ${o.max}`); break;
    case 'date': if (typeof value !== 'string' || !DATE_RE.test(value)) errors.push(`${path}: date YYYY-MM-DD`); break;
    case 'iso': if (typeof value !== 'string' || !ISO_RE.test(value)) errors.push(`${path}: ISO date-time in UTC`); break;
    case 'url':
      if (typeof value !== 'string' || value.length > LIMITS.url || !/^(https?:\/\/|#|\/)/.test(value)) errors.push(`${path}: http(s) link, /path or #anchor`);
      break;
    case 'object': checkShape(value, o.shape, path, errors); break;
    case 'array': {
      if (!Array.isArray(value)) { errors.push(`${path}: must be a list`); break; }
      if (value.length > o.max) errors.push(`${path}: more than ${o.max} items`);
      const ids = new Set();
      value.forEach((v, i) => {
        const p = `${path}[${i}]`;
        if (Array.isArray(o.item)) check(v, o.item, p, errors);
        else {
          checkShape(v, o.item, p, errors);
          if (v && typeof v === 'object') { if (ids.has(v.id)) errors.push(`${p}: duplicate id «${v.id}»`); ids.add(v.id); }
        }
      });
      break;
    }
    default: errors.push(`${path}: unknown rule`);
  }
}

function checkShape(obj, shape, path, errors) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errors.push(`${path}: must be an object`); return; }
  for (const k of Object.keys(obj)) if (!Object.hasOwn(shape, k)) errors.push(`${path}.${k}: unknown field`);
  for (const [k, rule] of Object.entries(shape)) check(obj[k], rule, `${path}.${k}`, errors);
}

export function validateProject(doc) {
  const errors = [];
  checkShape(doc, SHAPES.project, 'project', errors);
  if (!errors.length) {
    const stepIds = new Set(doc.steps.map((s) => s.id));
    if (doc.resume.nextStepId && !stepIds.has(doc.resume.nextStepId)) errors.push('project.resume.nextStepId: not a step of this project');
    doc.steps.forEach((s, i) => {
      if (s.status === 'no_aplica' && !s.reason.trim()) errors.push(`project.steps[${i}].reason: N/A needs a reason`);
      if (s.gate.waived && !s.gate.reason.trim()) errors.push(`project.steps[${i}].gate.reason: a waiver needs a reason`);
    });
    const bytes = JSON.stringify(doc).length;
    if (bytes > LIMITS.docBytes) errors.push(`project: ${bytes} bytes (max ${LIMITS.docBytes})`);
  }
  return errors.slice(0, 20);
}

// La forma de un elemento según el arreglo donde vive (lo usa ops.mjs para completar campos que falten).
export const ITEM_KIND = {
  steps: 'step', done: 'criterion', calcs: 'calc', vars: 'var', hitos: 'hito', results: 'result', commands: 'command', files: 'file', links: 'link',
  sessions: 'session', decisions: 'decision',
};

// Completa un elemento nuevo con valores vacíos para que siempre cumpla su forma.
export function fillItem(kind, item, opts = {}) {
  const base = {
    criterion: { text: '', ok: false },
    hito: { text: '', status: 'pendiente', done: '' },
    result: { name: '', value: '', unit: '', note: '' },
    command: { code: '', note: '' },
    file: { path: '', ref: '' },
    link: { label: '', href: '#' },
    session: { date: today(opts.tz), did: '', measured: '', next: '', stepIds: [], source: 'web' },
    decision: { date: today(opts.tz), stepId: null, what: '', against: '', why: '', status: 'vigente' },
  }[kind];
  if (kind === 'step') return emptyStep(item);
  if (kind === 'calc') return fillCalc(item);
  if (kind === 'var') return { label: '', unit: '', value: '', kind: 'assumption', source: '', ref: '', note: '', ...item };
  return { id: item.id || newId(kind[0]), ...base, ...item };
}

export function fillCalc(c) {
  return { id: c.id || newId('k'), label: '', out: '', expr: '0', unit: '', tol: 0.02, why: '', check: null, ref: '', answer: '', revealed: false, note: '', ...c };
}

// Días de calendario entre la última actividad y hoy (para «días sin moverle»): ayer a las 23:00 cuenta como 1.
export function daysSince(iso, now = Date.now(), tz) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const a = Date.parse(localDate(new Date(t), tz));
  const b = Date.parse(localDate(new Date(now), tz));
  return Math.max(0, Math.round((b - a) / 86400000));
}

// Progreso: los pasos «no aplica» no cuentan.
export function progress(project) {
  const steps = project.steps.filter((s) => s.status !== 'no_aplica');
  const n = steps.length;
  const count = (f) => steps.filter(f).length;
  return {
    total: n,
    hecho: count((s) => s.status === 'hecho'),
    enCurso: count((s) => s.status === 'en_curso'),
    bloqueado: count((s) => s.status === 'bloqueado'),
    v1: count((s) => s.vuelta.v1 === 'hecho'),
    v2: count((s) => s.vuelta.v2 === 'hecho'),
    noAplica: project.steps.length - n,
  };
}
