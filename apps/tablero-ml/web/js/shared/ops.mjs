/* Operaciones sobre un proyecto. Todo cambio (desde la web, sin conexión o desde Claude Code) es una lista de ops;
   el servidor las aplica sobre la versión más nueva, así dos lugares que editan cosas distintas no se pisan.
   Una ruta es una lista de segmentos: un nombre de campo o «#id» para un elemento de un arreglo.
     { op: 'set',    path: ['steps', '#serving', 'status'], value: 'hecho' }
     { op: 'insert', path: ['steps', '#serving', 'results'], value: { name: 'p99', value: '41', unit: 'ms' }, index?: 0 }
     { op: 'remove', path: ['steps', '#serving', 'results', '#r-1'] }
     { op: 'move',   path: ['steps', '#serving'], index: 3 }
   Cada op se aplica sola: si deja el proyecto inválido se descarta y se reporta, y las demás siguen. */
import { validateProject, fillItem, ITEM_KIND, nowIso, LIMITS } from './model.mjs';
import { evaluateProject } from './calc.mjs';

const PROTECTED = new Set(['id', 'v', 'rev', 'createdAt', 'updatedAt', 'lastActivity']);
const clone = (x) => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

function seg(s) {
  if (typeof s !== 'string' || !s || s.length > LIMITS.idLen + 1) throw new Error('invalid path segment');
  if (s === '__proto__' || s === 'constructor' || s === 'prototype') throw new Error('forbidden path segment');
  return s;
}

// Devuelve { parent, key } donde parent[key] es el destino. Con «#id» el key es la posición en el arreglo.
function resolve(doc, path) {
  if (!Array.isArray(path) || !path.length || path.length > 6) throw new Error('invalid path');
  let node = doc;
  for (let i = 0; i < path.length - 1; i++) node = step(node, seg(path[i]));
  const last = seg(path[path.length - 1]);
  if (last.startsWith('#')) {
    if (!Array.isArray(node)) throw new Error(`«${last}» is not in a list`);
    const idx = node.findIndex((x) => x && x.id === last.slice(1));
    if (idx < 0) throw new Error(`${last} does not exist`);
    return { parent: node, key: idx };
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`«${last}» is not a field`);
  if (!Object.prototype.hasOwnProperty.call(node, last)) throw new Error(`unknown field «${last}»`);
  return { parent: node, key: last };
}

function step(node, s) {
  if (s.startsWith('#')) {
    if (!Array.isArray(node)) throw new Error(`«${s}» is not in a list`);
    const hit = node.find((x) => x && x.id === s.slice(1));
    if (!hit) throw new Error(`${s} does not exist`);
    return hit;
  }
  if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, s)) throw new Error(`unknown field «${s}»`);
  return node[s];
}

function applyOne(doc, o, opts) {
  if (!o || typeof o !== 'object') throw new Error('invalid op');
  const path = o.path;
  const top = path && path[0];
  if (opts.restricted) {
    // El token de Claude Code no borra ni reordena pasos, bitácora ni decisiones, y no reemplaza arreglos enteros.
    if ((o.op === 'remove' || o.op === 'move') && ['steps', 'sessions', 'decisions'].includes(top) && path.length === 2) throw new Error('the token cannot delete or move steps, sessions or decisions');
    if (o.op === 'set' && path.length === 1 && Array.isArray(doc[top])) throw new Error('the token cannot replace whole lists');
    if (o.op === 'set' && path.length === 2 && ['steps', 'sessions', 'decisions'].includes(top)) throw new Error('the token cannot replace a whole step, session or decision; set its fields');
    // Waivers, revealed answers and the calcs themselves are the engineer's call, made on the board: the token
    // may only fill in an answer (`steps/#id/calcs/#calc/answer`) or a note.
    if (top === 'steps' && (path.includes('gate') || path[2] === 'calcs') && !(o.op === 'set' && path[2] === 'calcs' && path.length === 5 && ['answer', 'note'].includes(path[4]))) {
      throw new Error('waivers, revealed answers and calc definitions can only be changed on the board');
    }
    if (top === 'vars' && o.op !== 'set') throw new Error('the token can only set variable values');
  }
  switch (o.op) {
    case 'set': {
      const { parent, key } = resolve(doc, path);
      if (typeof key === 'string' && PROTECTED.has(key)) throw new Error(`«${key}» cannot be changed with an op`);
      let value = clone(o.value);
      if (typeof key === 'number') {
        // reemplaza un elemento completo: conserva su id
        if (!value || typeof value !== 'object') throw new Error('the item must be an object');
        value.id = parent[key].id;
      }
      parent[key] = value;
      break;
    }
    case 'insert': {
      const { parent, key } = resolve(doc, path);
      const arr = parent[key];
      if (!Array.isArray(arr) || typeof key !== 'string') throw new Error('insert needs a path to a list');
      const kind = ITEM_KIND[key];
      let item = o.value;
      if (kind) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('the item must be an object');
        item = fillItem(kind, clone(item), opts);
        if (arr.some((x) => x.id === item.id)) throw new Error(`#${item.id} already exists`);
      } else item = clone(item);
      const idx = Number.isInteger(o.index) ? Math.max(0, Math.min(arr.length, o.index)) : arr.length;
      arr.splice(idx, 0, item);
      break;
    }
    case 'remove': {
      const { parent, key } = resolve(doc, path);
      if (typeof key !== 'number') throw new Error('remove needs «#id» at the end of the path');
      const [gone] = parent.splice(key, 1);
      if (top === 'steps' && path.length === 2 && doc.resume.nextStepId === gone.id) doc.resume.nextStepId = null;
      break;
    }
    case 'move': {
      const { parent, key } = resolve(doc, path);
      if (typeof key !== 'number') throw new Error('move needs «#id» at the end of the path');
      if (!Number.isInteger(o.index)) throw new Error('move needs an index');
      const [item] = parent.splice(key, 1);
      parent.splice(Math.max(0, Math.min(parent.length, o.index)), 0, item);
      break;
    }
    default: throw new Error(`unknown op «${o.op}»`);
  }
}

// Entry gate: a step only moves to «in progress» or «done» when its calcs are matched (or revealed) and its checks pass,
// or when a waiver with a reason is on file.
function gateError(doc, o) {
  if (o.op !== 'set' || o.path[0] !== 'steps' || o.path.length !== 3 || o.path[2] !== 'status') return null;
  if (o.value !== 'en_curso' && o.value !== 'hecho') return null;
  const id = String(o.path[1]).slice(1);
  const g = evaluateProject(doc).gates[id];
  if (!g || !g.open) return null;
  const parts = [];
  if (g.need - g.done - g.revealed) parts.push(`${g.need - g.done - g.revealed} of ${g.need} calcs missing or wrong`);
  if (g.failedChecks) parts.push(`${g.failedChecks} check(s) failing`);
  return `Entry gate not met: ${parts.join(', ')}. Finish the sizing or file a waiver.`;
}

// Aplica las ops sobre una copia. Devuelve el proyecto nuevo, cuántas entraron y cuáles se rechazaron (con su motivo).
export function applyOps(project, ops, opts = {}) {
  if (!Array.isArray(ops)) throw new Error('ops must be a list');
  if (ops.length > 500) throw new Error('at most 500 ops per request');
  let doc = clone(project);
  const rejected = [];
  let applied = 0;
  const now = opts.now || nowIso();
  ops.forEach((o, index) => {
    const next = clone(doc);
    try {
      applyOne(next, o, opts);
      const ge = gateError(next, o);
      if (ge) throw new Error(ge);
      if (o.path[0] === 'steps' && o.path.length >= 2 && String(o.path[1]).startsWith('#')) {
        const s = next.steps.find((x) => x.id === o.path[1].slice(1));
        if (s) s.updatedAt = now;
      }
      const errors = validateProject(next);
      if (errors.length) throw new Error(errors.join('; '));
      doc = next;
      applied++;
    } catch (e) {
      rejected.push({ index, op: o && o.op, path: o && o.path, error: String(e.message || e) });
    }
  });
  if (applied) { doc.updatedAt = now; doc.lastActivity = now; }
  return { project: doc, applied, rejected };
}
