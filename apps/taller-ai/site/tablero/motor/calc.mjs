/* Sizing engine: entry-gate calculations. Shared by the browser and the API.
   - A project has `vars` (requirements, assumptions, benchmarks) and each step has `calcs` with a formula.
   - The engineer types their own answer; the engine recomputes the formula and checks it within `tol`.
   - A calc's output becomes a variable for later calcs (always the engine's value, so the chain stays consistent).
   - A step's entry gate is met when every calc is matched or revealed and every acceptance check passes,
     or when a waiver with a reason is on file.
   The expression language is tiny and safe (no eval; the CSP forbids it anyway):
     numbers, variables, + - * / ^, parentheses, ceil floor round min max abs sqrt log10 log2 ln ceilto(x, step),
     and in checks: < <= > >= == && ||. */

const FUNCS = {
  ceil: (x) => Math.ceil(x - 1e-9), floor: (x) => Math.floor(x + 1e-9), round: Math.round, abs: Math.abs, sqrt: Math.sqrt,
  log10: Math.log10, log2: Math.log2, ln: Math.log, min: Math.min, max: Math.max,
  ceilto: (x, s) => Math.ceil(x / s - 1e-9) * s,
};

function tokenize(src) {
  const out = [];
  const s = String(src);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    const op = /^(<=|>=|==|&&|\|\||[-+*/^(),<>])/.exec(s.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw new Error(`unexpected «${c}» in formula`);
  }
  return out;
}

// Precedence climbing. Returns an AST of { n } | { v } | { f, a: [] } | { o, l, r } | { u, x }.
export function parse(src) {
  if (String(src).length > 400) throw new Error('formula too long');
  const tk = tokenize(src);
  let p = 0;
  const peek = () => tk[p];
  const eat = (v) => { const t = tk[p]; if (!t || t.v !== v) throw new Error(`expected «${v}»`); p++; };
  const BIN = { '||': 1, '&&': 2, '<': 3, '<=': 3, '>': 3, '>=': 3, '==': 3, '+': 4, '-': 4, '*': 5, '/': 5, '^': 7 };
  function primary() {
    const t = tk[p++];
    if (!t) throw new Error('formula ends too early');
    if (t.t === 'num') return { n: t.v };
    if (t.t === 'id') {
      if (peek() && peek().v === '(') {
        if (!FUNCS[t.v]) throw new Error(`unknown function «${t.v}»`);
        p++;
        const a = [];
        if (peek() && peek().v !== ')') { a.push(expr(0)); while (peek() && peek().v === ',') { p++; a.push(expr(0)); } }
        eat(')');
        return { f: t.v, a };
      }
      return { v: t.v };
    }
    if (t.v === '(') { const e = expr(0); eat(')'); return e; }
    if (t.v === '-') return { u: '-', x: expr(6) };
    if (t.v === '+') return expr(6);
    throw new Error(`unexpected «${t.v}»`);
  }
  function expr(min) {
    let l = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in BIN) || BIN[t.v] < min) return l;
      p++;
      const prec = BIN[t.v];
      const r = expr(t.v === '^' ? prec : prec + 1);
      l = { o: t.v, l, r };
    }
  }
  const ast = expr(0);
  if (p !== tk.length) throw new Error(`unexpected «${tk[p].v}»`);
  return ast;
}

export function varsOf(ast, out = new Set()) {
  if (ast.v) out.add(ast.v);
  if (ast.a) ast.a.forEach((x) => varsOf(x, out));
  if (ast.l) { varsOf(ast.l, out); varsOf(ast.r, out); }
  if (ast.x) varsOf(ast.x, out);
  return out;
}

export function evaluate(ast, env) {
  if ('n' in ast) return ast.n;
  if (ast.v) { if (!(ast.v in env)) throw new Missing(ast.v); return env[ast.v]; }
  if (ast.f) return FUNCS[ast.f](...ast.a.map((x) => evaluate(x, env)));
  if (ast.u) return -evaluate(ast.x, env);
  const l = evaluate(ast.l, env), r = evaluate(ast.r, env);
  switch (ast.o) {
    case '+': return l + r; case '-': return l - r; case '*': return l * r; case '/': return l / r; case '^': return l ** r;
    case '<': return l < r; case '<=': return l <= r + 1e-9; case '>': return l > r; case '>=': return l >= r - 1e-9;
    case '==': return Math.abs(l - r) < 1e-9; case '&&': return l && r; case '||': return l || r;
  }
  throw new Error('bad expression');
}
class Missing extends Error { constructor(v) { super(`needs ${v}`); this.v = v; } }

// "1,692" · "≈ 25 ms" · "1.7e3" · "42 %" → numbers to try (a % answer is also tried as a fraction).
export function parseAnswer(s) {
  const t = String(s || '').replace(/[,\s≈~]/g, '');
  const m = /^[-+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(t);
  if (!m) return null;
  const n = Number(m[0]);
  return /%/.test(t) ? [n, n / 100] : [n];
}

export function matches(answer, expected, tol) {
  const cands = parseAnswer(answer);
  if (!cands || !Number.isFinite(expected)) return false;
  const isInt = Math.abs(expected - Math.round(expected)) < 1e-9;
  const t = tol > 0 ? tol : isInt ? 0 : 0.01;
  return cands.some((a) => (t === 0 ? Math.abs(a - expected) < 1e-9 : Math.abs(a - expected) <= t * Math.max(Math.abs(expected), 1e-12)));
}

export const numOf = (s) => { const c = parseAnswer(s); return c ? c[0] : null; };

// Evaluates every calc of the project in step order. Returns per-calc results and per-step gates.
//   calc result: { status: 'blocked' | 'todo' | 'ok' | 'wrong' | 'revealed' | 'error', value, missing[], check: null | { ok, label } }
export function evaluateProject(project) {
  const env = {};
  const varIssues = {};
  for (const v of project.vars || []) {
    const n = numOf(v.value);
    if (n !== null) env[v.id] = n;
  }
  const calcs = {};
  const gates = {};
  for (const s of project.steps) {
    let need = 0, done = 0, revealed = 0, failedChecks = 0, blocked = 0;
    for (const c of s.calcs || []) {
      const key = `${s.id}/${c.id}`;
      const r = { status: 'todo', value: null, missing: [], check: null };
      try {
        const val = evaluate(parse(c.expr), env);
        if (!Number.isFinite(val)) throw new Error('result is not a finite number');
        r.value = val;
        if (c.out) env[c.out] = val;
        if (matches(c.answer, val, c.tol)) r.status = 'ok';
        else if (c.revealed) r.status = 'revealed';
        else if (String(c.answer || '').trim()) r.status = 'wrong';
        if (c.check && c.check.expr) {
          try { r.check = { ok: !!evaluate(parse(c.check.expr), env), label: c.check.label }; } catch (e) { r.check = { ok: false, label: c.check.label, error: e.message }; }
        }
      } catch (e) {
        if (e instanceof Missing) { r.status = 'blocked'; r.missing = [e.v]; } else { r.status = 'error'; r.error = e.message; }
      }
      calcs[key] = r;
      need++;
      if (r.status === 'ok') done++;
      if (r.status === 'revealed') revealed++;
      if (r.status === 'blocked') blocked++;
      if (r.check && !r.check.ok) failedChecks++;
    }
    const met = need === done + revealed && failedChecks === 0;
    gates[s.id] = { need, done, revealed, blocked, failedChecks, met, waived: !!(s.gate && s.gate.waived), open: !met && !(s.gate && s.gate.waived) };
  }
  return { calcs, gates, env, varIssues };
}

// Formats a computed value for display next to its unit.
export function fmtNum(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a !== 0 && a < 0.01) return x.toPrecision(2);
  if (a >= 1000) return Math.round(x).toLocaleString('en-US');
  if (Number.isInteger(x)) return String(x);
  return Number(x.toPrecision(a >= 100 ? 4 : 3)).toLocaleString('en-US', { maximumFractionDigits: 4 });
}
