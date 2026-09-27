// Tests del motor numérico de Transformer Lab (node --test tests/).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const f of ['tensor', 'tokenizer', 'model', 'optim', 'trainer']) {
  require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
}
const TL = globalThis.TL;
const { Mat } = TL;

// ------------------------------------------------------------------ utilidades de test
function naiveMatmul(A, B) {
  assert.equal(A.c, B.r, 'matmul: dimensiones');
  const C = new Mat(A.r, B.c);
  for (let i = 0; i < A.r; i++) {
    for (let j = 0; j < B.c; j++) {
      let s = 0;
      for (let k = 0; k < A.c; k++) s += A.get(i, k) * B.get(k, j);
      C.set(i, j, s);
    }
  }
  return C;
}
function closeNum(a, b, tol) {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}
function assertClose(A, B, tol, msg) {
  tol = tol === undefined ? 1e-9 : tol;
  assert.ok(A instanceof Mat && B instanceof Mat, (msg || '') + ': se esperaban Mat');
  assert.deepEqual([A.r, A.c], [B.r, B.c], (msg || '') + ': formas distintas');
  for (let k = 0; k < A.d.length; k++) {
    if (!closeNum(A.d[k], B.d[k], tol)) {
      assert.fail((msg || '') + ': difiere en ' + Math.floor(k / A.c) + ',' + (k % A.c) + ': ' + A.d[k] + ' vs ' + B.d[k]);
    }
  }
}
const GC = Math.sqrt(2 / Math.PI);
const actF = {
  relu: (x) => Math.max(0, x),
  gelu: (x) => 0.5 * x * (1 + Math.tanh(GC * (x + 0.044715 * x ** 3))),
};
const actD = {
  relu: (x) => (x > 0 ? 1 : 0),
  gelu: (x) => {
    const u = GC * (x + 0.044715 * x ** 3);
    const th = Math.tanh(u);
    return 0.5 * (1 + th) + 0.5 * x * (1 - th * th) * GC * (1 + 3 * 0.044715 * x * x);
  },
};
function softmaxRows(X) {
  const P = new Mat(X.r, X.c);
  for (let i = 0; i < X.r; i++) {
    let mx = -Infinity;
    for (let j = 0; j < X.c; j++) mx = Math.max(mx, X.get(i, j));
    let s = 0;
    for (let j = 0; j < X.c; j++) s += X.get(i, j) === -Infinity ? 0 : Math.exp(X.get(i, j) - mx);
    for (let j = 0; j < X.c; j++) P.set(i, j, X.get(i, j) === -Infinity ? 0 : Math.exp(X.get(i, j) - mx) / s);
  }
  return P;
}
function layerNormRef(X, g, b, eps) {
  const T = X.r, d = X.c;
  const Y = new Mat(T, d), xhat = new Mat(T, d), mu = new Mat(T, 1), sig = new Mat(T, 1), vr = new Mat(T, 1);
  for (let t = 0; t < T; t++) {
    let m = 0;
    for (let j = 0; j < d; j++) m += X.get(t, j);
    m /= d;
    let v = 0;
    for (let j = 0; j < d; j++) v += (X.get(t, j) - m) ** 2;
    v /= d;
    const s = Math.sqrt(v + eps);
    mu.d[t] = m; vr.d[t] = v; sig.d[t] = s;
    for (let j = 0; j < d; j++) {
      xhat.set(t, j, (X.get(t, j) - m) / s);
      Y.set(t, j, g.d[j] * xhat.get(t, j) + b.d[j]);
    }
  }
  return { Y, xhat, mu, sig, vr };
}

const CORE_DIR = path.join(__dirname, '..', 'js', 'core');
void CORE_DIR;

// ------------------------------------------------------------------ Mat
test('Mat: construcción, acceso y utilidades', () => {
  const A = Mat.from2D([[1, 2, 3], [4, 5, 6]]);
  assert.deepEqual(A.shape(), [2, 3]);
  assert.equal(A.get(1, 2), 6);
  assert.ok(A.d instanceof Float64Array);
  const B = A.clone();
  B.set(0, 0, 99);
  assert.equal(A.get(0, 0), 1, 'clone no comparte memoria');
  assert.deepEqual(Array.from(A.row(1)), [4, 5, 6]);
  const r = A.row(0); r[0] = 42; assert.equal(A.get(0, 0), 1, 'row devuelve copia');
  assert.deepEqual(A.toArray(), [[1, 2, 3], [4, 5, 6]]);
  const W = Mat.from2D([[-Infinity, -3, 2], [Infinity, 1, 0.5]]);
  assert.equal(W.maxAbs(), 3);
  assert.equal(W.min(), -3);
  assert.equal(W.max(), 2);
  assert.ok(closeNum(Mat.from2D([[3, 4]]).frob(), 5, 1e-15));
  assert.deepEqual(Mat.zeros(2, 2).toArray(), [[0, 0], [0, 0]]);
  assert.deepEqual(Mat.ones(1, 2).toArray(), [[1, 1]]);
  assert.deepEqual(Mat.eye(2).toArray(), [[1, 0], [0, 1]]);
  assert.deepEqual(Mat.fromRow([1, 2]).shape(), [1, 2]);
  assert.throws(() => new Mat(2, 2, [1, 2, 3]));
});

test('Mat: álgebra (resultados nuevos, sin mutar entradas)', () => {
  const A = Mat.from2D([[1, 2], [3, 4], [5, 6]]);
  const B = Mat.from2D([[1, 0, -1], [2, 1, 0]]);
  const A0 = A.clone(), B0 = B.clone();
  const C = Mat.matmul(A, B);
  assert.deepEqual(C.toArray(), [[5, 2, -1], [11, 4, -3], [17, 6, -5]]);
  assertClose(Mat.matmulAT(Mat.transpose(A), B), C, 0);
  assertClose(Mat.matmulBT(A, Mat.transpose(B)), C, 0);
  assert.deepEqual(Mat.transpose(A).toArray(), [[1, 3, 5], [2, 4, 6]]);
  assert.deepEqual(Mat.add(A, A).toArray(), [[2, 4], [6, 8], [10, 12]]);
  assert.deepEqual(Mat.sub(A, A).toArray(), [[0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(Mat.mul(A, A).toArray(), [[1, 4], [9, 16], [25, 36]]);
  assert.deepEqual(Mat.scale(A, -2).toArray(), [[-2, -4], [-6, -8], [-10, -12]]);
  assert.deepEqual(Mat.addRowVec(A, Mat.fromRow([10, 20])).toArray(), [[11, 22], [13, 24], [15, 26]]);
  assert.deepEqual(Mat.sumRows(A).toArray(), [[9, 12]]);
  assert.deepEqual(Mat.sumCols(A).toArray(), [[3], [7], [11]]);
  assert.deepEqual(Mat.meanCols(A).toArray(), [[1.5], [3.5], [5.5]]);
  assert.deepEqual(Mat.map(A, (x) => x * 10).toArray(), [[10, 20], [30, 40], [50, 60]]);
  assert.deepEqual(Mat.map2(A, A, (x, y) => x - y + 1).toArray(), [[1, 1], [1, 1], [1, 1]]);
  const S = Mat.sliceCols(B, 1, 3);
  assert.deepEqual(S.toArray(), [[0, -1], [1, 0]]);
  assert.deepEqual(Mat.concatCols([Mat.sliceCols(B, 0, 1), S]).toArray(), B.toArray());
  assert.deepEqual(Mat.sliceRows(A, 1, 3).toArray(), [[3, 4], [5, 6]]);
  assertClose(A, A0, 0); assertClose(B, B0, 0);
  assert.throws(() => Mat.matmul(A, A));
  assert.throws(() => Mat.add(A, B));
});

test('Mat: softmax por filas con −∞, one-hot y gatherRows', () => {
  const X = Mat.from2D([[0, -Infinity, -Infinity], [1, 2, 3], [1000, 1000, -Infinity]]);
  const P = Mat.rowSoftmax(X);
  assert.deepEqual(P.row(0).slice(), Float64Array.from([1, 0, 0]));
  const e = [Math.exp(-2), Math.exp(-1), 1], s = e[0] + e[1] + e[2];
  for (let j = 0; j < 3; j++) assert.ok(closeNum(P.get(1, j), e[j] / s, 1e-15));
  assert.ok(closeNum(P.get(2, 0), 0.5, 1e-15) && P.get(2, 2) === 0, 'estable numéricamente');
  const parts = Mat.softmaxParts(X);
  assert.deepEqual(Array.from(parts.rowMax.d), [0, 3, 1000]);
  const oh = Mat.oneHot([2, 0], 3);
  assert.deepEqual(oh.toArray(), [[0, 0, 1], [1, 0, 0]]);
  const E = Mat.from2D([[1, 1], [2, 2], [3, 3]]);
  assert.deepEqual(Mat.gatherRows(E, [2, 0, 2]).toArray(), [[3, 3], [1, 1], [3, 3]]);
  assertClose(Mat.gatherRows(E, [2, 0]), Mat.matmul(oh, E), 0);
});

test('PRNG: mulberry32 determinista y randn razonable', () => {
  const a = TL.rng(123), b = TL.rng(123), c = TL.rng(124);
  const xa = [a(), a(), a()], xb = [b(), b(), b()];
  assert.deepEqual(xa, xb);
  assert.notDeepEqual(xa, [c(), c(), c()]);
  const g = TL.rng(7);
  let m = 0, v = 0;
  const n = 20000;
  const xs = [];
  for (let i = 0; i < n; i++) { const x = TL.randn(g); xs.push(x); m += x; }
  m /= n;
  for (const x of xs) v += (x - m) ** 2;
  v /= n;
  assert.ok(Math.abs(m) < 0.05, 'media ≈ 0');
  assert.ok(Math.abs(v - 1) < 0.05, 'varianza ≈ 1');
  const r = TL.rng(5);
  for (let i = 0; i < 1000; i++) { const x = r(); assert.ok(x >= 0 && x < 1); }
  // estado para snapshots
  const st = r.getState(); const n1 = r(); r.setState(st); assert.equal(r(), n1);
  const M = Mat.randn(3, 4, 0.5, TL.rng(1));
  assert.deepEqual(M.shape(), [3, 4]);
  assertClose(M, Mat.randn(3, 4, 0.5, TL.rng(1)), 0);
});

// ------------------------------------------------------------------ Tokenizador
test('Tokenizador: corpus por defecto (modo palabra)', () => {
  const tok = TL.Tokenizer.build(TL.Trainer.DEFAULT_CORPUS, 'word', 8);
  assert.deepEqual(tok.vocab, ['<s>', 'el', 'gato', 'come', 'pescado', '.', 'perro', 'carne', 'la', 'niña', 'bebe', 'leche',
    'niño', 'agua', 'duerme', 'en', 'casa', 'jardín', 'lee', 'un', 'libro', 'cuento']);
  assert.equal(tok.stoi['gato'], 2);
  assert.equal(tok.sentences.length, 8);
  const s0 = tok.sentences[0];
  assert.equal(s0.text, 'el gato come pescado .');
  assert.deepEqual(s0.tokens, ['<s>', 'el', 'gato', 'come', 'pescado', '.']);
  assert.deepEqual(s0.inputTokens, ['<s>', 'el', 'gato', 'come', 'pescado']);
  assert.deepEqual(s0.targetTokens, ['el', 'gato', 'come', 'pescado', '.']);
  assert.deepEqual(s0.inputIds, [0, 1, 2, 3, 4]);
  assert.deepEqual(s0.targetIds, [1, 2, 3, 4, 5]);
  assert.equal(s0.T, 5);
  assert.equal(tok.sentences[5].T, 7);
  assert.equal(tok.decode(s0.ids), 'el gato come pescado.');
  const enc = tok.encode('El gato come');
  assert.deepEqual(enc.ids, [1, 2, 3]);
  assert.deepEqual(enc.unknown, []);
  const bad = tok.encode('el dragón come');
  assert.deepEqual(bad.unknown, ['dragón']);
  assert.match(tok.unknownMessage(bad.unknown), /desconocido.*dragón.*vocabulario/);
  assert.equal(tok.display('gato'), 'gato');
});

test('Tokenizador: puntuación, minúsculas y decode', () => {
  const tok = TL.Tokenizer.build('¿Hola, Mundo? ¡Sí!', 'word', 16);
  assert.deepEqual(tok.split('¿Hola, Mundo? ¡Sí!'), ['¿', 'hola', ',', 'mundo', '?', '¡', 'sí', '!']);
  assert.equal(tok.decode(tok.sentences[0].ids), '¿hola, mundo? ¡sí!');
});

test('Tokenizador: modo carácter y truncado a maxLen + 1', () => {
  const tok = TL.Tokenizer.build(TL.Trainer.DEFAULT_CORPUS, 'char', 8);
  assert.equal(tok.mode, 'char');
  assert.equal(tok.vocab[0], '<s>');
  assert.ok(tok.vocab.includes(' '));
  assert.equal(tok.display(' '), '␣');
  const s0 = tok.sentences[0];
  assert.equal(s0.tokens.length, 9, 'truncado a maxLen + 1');
  assert.deepEqual(s0.tokens, ['<s>', 'e', 'l', ' ', 'g', 'a', 't', 'o', ' ']);
  assert.equal(s0.T, 8);
  assert.equal(tok.decode(s0.ids), 'el gato ');
  const tw = TL.Tokenizer.build(TL.Trainer.DEFAULT_CORPUS, 'word', 3);
  for (const s of tw.sentences) {
    assert.ok(s.tokens.length <= 4);
    assert.ok(s.T <= 3);
    assert.equal(s.inputIds.length, s.T);
    assert.equal(s.targetIds.length, s.T);
  }
  assert.deepEqual(tw.sentences[0].tokens, ['<s>', 'el', 'gato', 'come']);
  assert.equal(tw.vocab.length, 22, 'el vocabulario usa las frases completas');
  assert.throws(() => TL.Tokenizer.build('   \n  ', 'word', 8), /vacío/);
});

// ------------------------------------------------------------------ Modelo: creación
test('Modelo: parámetros, orden, metadatos y validación', () => {
  const s = TL.Trainer.createSession({});
  const m = s.model;
  const d = 8, dff = 32, V = 22;
  assert.deepEqual(m.order, ['E', 'L0.ln1.g', 'L0.ln1.b', 'L0.Wq', 'L0.Wk', 'L0.Wv', 'L0.Wo', 'L0.ln2.g', 'L0.ln2.b',
    'L0.W1', 'L0.b1', 'L0.W2', 'L0.b2', 'lnf.g', 'lnf.b', 'Wout']);
  const shapes = { E: [V, d], 'L0.Wq': [d, d], 'L0.W1': [d, dff], 'L0.b1': [1, dff], 'L0.W2': [dff, d], Wout: [d, V], 'lnf.g': [1, d] };
  for (const k in shapes) assert.deepEqual(m.params[k].shape(), shapes[k], k);
  for (const k of m.order) {
    const pm = m.paramMeta[k];
    assert.ok(pm.tex && pm.desc && pm.init && pm.block && pm.rowAxis && pm.colAxis, 'metadatos de ' + k);
  }
  assert.equal(m.paramMeta['L0.Wq'].tex, 'W_Q');
  assert.equal(m.paramMeta['L0.Wq'].block, 'L0.qkv');
  assert.deepEqual(Array.from(m.params['L0.ln1.g'].d), new Array(d).fill(1));
  const cp = TL.Model.countParams(m);
  assert.equal(cp.total, Object.values(cp.byName).reduce((a, b) => a + b, 0));
  assert.equal(cp.byName.E, V * d);
  const m2 = TL.Model.create({ nLayers: 2, posEnc: 'learned' }, s.tok.vocab);
  assert.equal(m2.paramMeta['L1.Wq'].tex, 'W_Q^{[2]}');
  assert.deepEqual(m2.params.P.shape(), [8, 8]);
  assert.equal(m2.order[1], 'P');
  assert.throws(() => TL.Model.create({ dModel: 8, nHeads: 3 }, s.tok.vocab), /h = 3 debe dividir a d = 8/);
  assert.throws(() => TL.Model.create({ activation: 'tanh' }, s.tok.vocab), /activación/);
  // determinismo por semilla
  const a = TL.Model.create({ seed: 5 }, s.tok.vocab), b = TL.Model.create({ seed: 5 }, s.tok.vocab);
  assertClose(a.params.E, b.params.E, 0);
});

test('Modelo: PE sinusoidal y máscara causal', () => {
  const pe = TL.Model._internal.sinusoidalPE(8, 8);
  assert.ok(closeNum(pe.get(3, 0), Math.sin(3), 1e-15));
  assert.ok(closeNum(pe.get(3, 1), Math.cos(3), 1e-15));
  assert.ok(closeNum(pe.get(3, 4), Math.sin(3 / Math.pow(10000, 4 / 8)), 1e-15));
  assert.ok(closeNum(pe.get(3, 5), Math.cos(3 / Math.pow(10000, 4 / 8)), 1e-15));
  const M = TL.Model._internal.causalMask(3);
  assert.deepEqual(M.toArray(), [[0, -Infinity, -Infinity], [0, 0, -Infinity], [0, 0, 0]]);
});

test('Modelo: forward (formas, probabilidades y causalidad)', () => {
  const s = TL.Trainer.createSession({});
  const sen = s.tok.sentences[0];
  const f = TL.Model.forward(s.model, sen.inputIds, sen.targetIds, { trace: false });
  assert.deepEqual(f.probs.shape(), [5, 22]);
  assert.deepEqual(f.logits.shape(), [5, 22]);
  for (let t = 0; t < 5; t++) {
    let sum = 0;
    for (let j = 0; j < 22; j++) sum += f.probs.get(t, j);
    assert.ok(closeNum(sum, 1, 1e-12));
  }
  assert.equal(f.attn.length, 1);
  assert.equal(f.attn[0].length, 2);
  const A = f.attn[0][1];
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) assert.equal(A.get(i, j), 0, 'no mira al futuro');
  assert.equal(f.steps.length, 0);
  assert.ok(closeNum(f.loss, TL.Model.loss(s.model, sen.inputIds, sen.targetIds), 0));
  // causalidad: cambiar el último token no altera las predicciones anteriores
  const ids2 = sen.inputIds.slice(); ids2[4] = 7;
  const f2 = TL.Model.forward(s.model, ids2, null, {});
  for (let t = 0; t < 4; t++) for (let j = 0; j < 22; j++) assert.ok(closeNum(f.probs.get(t, j), f2.probs.get(t, j), 1e-13));
  assert.equal(f2.loss, null);
  assert.throws(() => TL.Model.backward(s.model, f2.cache, {}), /targetIds/);
});

// ------------------------------------------------------------------ Comprobación de gradientes
function minAbsPreact(model, ids) {
  const f = TL.Model.forward(model, ids, null, {});
  let m = Infinity;
  for (const L of f.cache.layers) for (const x of L.U.d) m = Math.min(m, Math.abs(x));
  return m;
}

// Comprobación completa de TODOS los parámetros con diferencias centrales.
function fullGradCheck(s, sIdx, opts) {
  opts = opts || {};
  const perParam = opts.perParam || 6;
  const h = opts.h || 1e-5;
  const model = s.model;
  const sen = s.tok.sentences[sIdx];
  const f = TL.Model.forward(model, sen.inputIds, sen.targetIds, {});
  const grads = TL.Model.backward(model, f.cache, {}).grads;
  assert.deepEqual(Object.keys(grads).sort(), model.order.slice().sort(), 'hay gradiente para cada parámetro');
  const rng = TL.rng(99);
  let worst = 0, count = 0;
  for (const name of model.order) {
    const P = model.params[name], G = grads[name];
    assert.deepEqual(G.shape(), P.shape(), 'forma del gradiente de ' + name);
    const gmax = G.maxAbs();
    assert.ok(gmax > 0, 'gradiente no nulo para ' + name);
    const cand = [];
    for (let k = 0; k < G.d.length; k++) if (Math.abs(G.d[k]) >= 1e-3 * gmax) cand.push(k);
    const picks = new Set([cand.reduce((a, k) => (Math.abs(G.d[k]) > Math.abs(G.d[a]) ? k : a), cand[0])]);
    while (picks.size < Math.min(perParam, cand.length)) picks.add(cand[Math.floor(rng() * cand.length)]);
    for (const k of picks) {
      const old = P.d[k];
      P.d[k] = old + h; const lp = TL.Model.loss(model, sen.inputIds, sen.targetIds);
      P.d[k] = old - h; const lm = TL.Model.loss(model, sen.inputIds, sen.targetIds);
      P.d[k] = old;
      const num = (lp - lm) / (2 * h), an = G.d[k];
      const rel = Math.abs(an - num) / Math.max(Math.abs(an), Math.abs(num));
      worst = Math.max(worst, rel);
      count++;
      assert.ok(rel < 1e-5, name + '[' + k + ']: analítico ' + an + ' vs numérico ' + num + ' (relErr ' + rel.toExponential(2) + ')');
    }
  }
  return { worst, count };
}

const GC_CONFIGS = [
  { label: 'por defecto (ReLU, lejos de los quiebres)', cfg: {}, relu: true },
  { label: 'por defecto con GELU', cfg: { activation: 'gelu' } },
  { label: 'GELU + posición aprendida', cfg: { activation: 'gelu', posEnc: 'learned' } },
  { label: 'N = 2 capas, h = 4 cabezas', cfg: { activation: 'gelu', nLayers: 2, nHeads: 4 } },
  { label: 'N = 2, ReLU, posición aprendida', cfg: { nLayers: 2, posEnc: 'learned' }, relu: true },
  { label: 'h = 1 cabeza', cfg: { activation: 'gelu', nHeads: 1 } },
  { label: 'recorte activado (clip = 0.05)', cfg: { activation: 'gelu' }, optim: { clip: 0.05 } },
  { label: 'modo carácter', cfg: { activation: 'gelu', dModel: 12, nHeads: 3, dFF: 24 }, tokMode: 'char' },
];

for (const C of GC_CONFIGS) {
  test('Gradientes (diferencias centrales, todos los parámetros): ' + C.label, () => {
    const s = TL.Trainer.createSession({ cfg: C.cfg, optim: C.optim, tokMode: C.tokMode });
    // unos pasos de entrenamiento para salir de la inicialización (γ ≠ 1, β ≠ 0, …)
    TL.Trainer.trainSteps(s, 12);
    let checked = 0;
    for (let i = 0; i < s.tok.sentences.length && checked < 2; i++) {
      if (C.relu && minAbsPreact(s.model, s.tok.sentences[i].inputIds) < 1e-3) continue; // lejos de los quiebres de ReLU
      const r = fullGradCheck(s, i);
      assert.ok(r.count >= s.model.order.length);
      checked++;
    }
    assert.equal(checked, 2, 'se comprobaron dos frases');
    // TL.Trainer.gradCheck (API pública)
    const idx = C.relu ? s.tok.sentences.findIndex((x) => minAbsPreact(s.model, x.inputIds) >= 1e-3) : 1;
    const rows = TL.Trainer.gradCheck(s, idx, { perParam: 3, h: 1e-5 });
    assert.deepEqual([...new Set(rows.map((r) => r.name))], s.model.order);
    for (const r of rows) {
      assert.ok(Number.isInteger(r.i) && Number.isInteger(r.j));
      assert.ok(r.relErr < 1e-5, r.name + ' relErr ' + r.relErr);
    }
  });
}

// ------------------------------------------------------------------ Contrato de la traza
const BLOCKS_GLOBAL = new Set(['tokens', 'embed', 'posenc', 'lnf', 'logits', 'softmax_out', 'loss', 'optim']);
const BLOCKS_LAYER = ['ln1', 'qkv', 'split', 'scores', 'scale', 'mask', 'softmax', 'context', 'concat', 'proj', 'res1', 'ln2', 'ffn1', 'act', 'ffn2', 'res2'];
const KINDS = new Set(['tokenize', 'lookup', 'add', 'layernorm', 'matmul', 'split', 'concat', 'scale', 'mask', 'softmax', 'activation',
  'crossentropy', 'grad_ce', 'grad_softmax', 'grad_mask', 'grad_layernorm', 'grad_activation', 'grad_lookup', 'sumrows',
  'residual_split', 'accumulate', 'gradnorm', 'update']);
const ROLES = new Set(['act', 'param', 'grad', 'const', 'prob', 'onehot', 'mask', 'scalar']);
const AXES = new Set(['T', 'V', 'd', 'dk', 'dff', '1', 'maxLen']);

function expectedTpls(cfg, nParams) {
  const L = ['data.tokenize', 'fwd.embed', 'fwd.posenc'];
  for (let l = 0; l < cfg.nLayers; l++) {
    L.push('fwd.ln1', 'fwd.attn.q', 'fwd.attn.k', 'fwd.attn.v', 'fwd.attn.split');
    for (let h = 0; h < cfg.nHeads; h++) L.push('fwd.attn.scores', 'fwd.attn.scale', 'fwd.attn.mask', 'fwd.attn.softmax', 'fwd.attn.context');
    L.push('fwd.attn.concat', 'fwd.attn.proj', 'fwd.res1', 'fwd.ln2', 'fwd.ffn1', 'fwd.act', 'fwd.ffn2', 'fwd.res2');
  }
  L.push('fwd.lnf', 'fwd.logits', 'fwd.softmax_out', 'loss.ce', 'bwd.ce', 'bwd.logits.dW', 'bwd.logits.dX', 'bwd.lnf');
  for (let l = cfg.nLayers - 1; l >= 0; l--) {
    L.push('bwd.res2', 'bwd.ffn2.dW', 'bwd.ffn2.db', 'bwd.ffn2.dX', 'bwd.act', 'bwd.ffn1.dW', 'bwd.ffn1.db', 'bwd.ffn1.dX',
      'bwd.ln2', 'bwd.res2.merge', 'bwd.res1', 'bwd.attn.proj.dW', 'bwd.attn.proj.dX', 'bwd.attn.concat');
    for (let h = 0; h < cfg.nHeads; h++) {
      L.push('bwd.attn.context.dA', 'bwd.attn.context.dV', 'bwd.attn.softmax', 'bwd.attn.mask', 'bwd.attn.scale',
        'bwd.attn.scores.dQ', 'bwd.attn.scores.dK');
    }
    L.push('bwd.attn.split', 'bwd.attn.q.dW', 'bwd.attn.k.dW', 'bwd.attn.v.dW', 'bwd.attn.q.dX', 'bwd.attn.k.dX',
      'bwd.attn.v.dX', 'bwd.attn.dH', 'bwd.ln1', 'bwd.res1.merge');
  }
  L.push('bwd.posenc', 'bwd.embed', 'upd.gradnorm');
  for (let i = 0; i < nParams; i++) L.push('upd.param');
  return L;
}

// Sustitución independiente símbolo → número para comprobar step.dims.
function substDims(sym, env) {
  return sym.replace(/T_\{\\max\}|d_\{ff\}|d_k|\\[A-Za-z]+|[TdVh]/g, (m) => {
    if (m[0] === '\\') return m;
    return String({ 'T_{\\max}': env.maxLen, 'd_{ff}': env.dff, d_k: env.dk, T: env.T, d: env.d, V: env.V, h: env.h }[m]);
  });
}

function recompute(st, ctx) {
  const I = st.inputs, O = st.outputs, a = st.aux;
  const m = (r) => r.mat;
  const tol = 1e-9;
  switch (st.kind) {
    case 'tokenize':
      assert.deepEqual(Array.from(O[0].mat.d), a.inputIds);
      assert.deepEqual(a.tokens.slice(0, -1), a.inputTokens);
      assert.deepEqual(a.tokens.slice(1), a.targetTokens);
      break;
    case 'lookup': {
      const oh = m(I[0]);
      for (let t = 0; t < oh.r; t++) for (let v = 0; v < oh.c; v++) assert.equal(oh.get(t, v), v === a.ids[t] ? 1 : 0);
      assertClose(naiveMatmul(oh, m(I[1])), m(O[0]), tol, st.id);
      break;
    }
    case 'add': {
      const B = a.broadcast ? null : m(I[1]);
      assertClose(B ? Mat.map2(m(I[0]), B, (x, y) => x + y) : Mat.addRowVec(m(I[0]), m(I[1])), m(O[0]), tol, st.id);
      if (st.tpl === 'fwd.posenc' && a.posEnc === 'sinusoidal') {
        const pe = m(I[1]);
        for (let p = 0; p < pe.r; p++) for (let j = 0; j < pe.c; j++) {
          const ang = p / Math.pow(10000, (j - (j % 2)) / pe.c);
          assert.ok(closeNum(pe.get(p, j), j % 2 ? Math.cos(ang) : Math.sin(ang), 1e-12));
        }
      }
      break;
    }
    case 'accumulate': {
      let S = m(I[0]);
      for (let i = 1; i < I.length; i++) S = Mat.map2(S, m(I[i]), (x, y) => x + y);
      assertClose(S, m(O[0]), tol, st.id);
      break;
    }
    case 'layernorm': {
      const r = layerNormRef(m(I[0]), m(I[1]), m(I[2]), a.eps);
      assertClose(r.Y, m(O[0]), tol, st.id);
      assertClose(r.mu, a.mu, tol, st.id + ' μ');
      assertClose(r.vr, a.var, tol, st.id + ' var');
      assertClose(r.sig, a.sigma, tol, st.id + ' σ');
      assertClose(r.xhat, a.xhat, tol, st.id + ' x̂');
      break;
    }
    case 'matmul': {
      assert.equal(a.a, 0); assert.equal(a.b, 1);
      let C = naiveMatmul(m(I[a.a]), m(I[a.b]));
      if (a.bias !== null) C = Mat.addRowVec(C, m(I[a.bias]));
      assertClose(C, m(O[0]), tol, st.id);
      assert.equal(st.flops, m(I[0]).r * m(I[0]).c * m(I[1]).c);
      break;
    }
    case 'split': {
      for (const g of a.groups) {
        const X = m(I[g.input]);
        assert.equal(g.outputs.length, a.nHeads);
        g.outputs.forEach((oi, h) => {
          assert.equal(O[oi].colOffset, h * a.dK);
          assertClose(Mat.sliceCols(X, h * a.dK, (h + 1) * a.dK), m(O[oi]), 0, st.id);
        });
      }
      assert.equal(O.length, a.groups.length * a.nHeads);
      break;
    }
    case 'concat': {
      for (const g of a.groups) {
        assert.equal(g.inputs.length, a.nHeads);
        g.inputs.forEach((ii, h) => assert.equal(I[ii].colOffset, h * a.dK));
        assertClose(Mat.concatCols(g.inputs.map((ii) => m(I[ii]))), m(O[g.output]), 0, st.id);
      }
      break;
    }
    case 'scale':
      assert.ok(closeNum(a.factor, 1 / Math.sqrt(ctx.env.dk), 1e-15));
      assertClose(Mat.map(m(I[0]), (x) => x * a.factor), m(O[0]), tol, st.id);
      break;
    case 'mask': {
      const Mk = m(I[1]);
      for (let i = 0; i < Mk.r; i++) for (let j = 0; j < Mk.c; j++) assert.equal(Mk.get(i, j), j <= i ? 0 : -Infinity);
      assertClose(Mat.map2(m(I[0]), Mk, (x, y) => x + y), m(O[0]), tol, st.id);
      break;
    }
    case 'softmax': {
      const X = m(I[0]);
      assertClose(softmaxRows(X), m(O[0]), tol, st.id);
      for (let i = 0; i < X.r; i++) {
        let mx = -Infinity, s = 0;
        for (let j = 0; j < X.c; j++) mx = Math.max(mx, X.get(i, j));
        assert.ok(closeNum(a.rowMax.d[i], mx, tol));
        for (let j = 0; j < X.c; j++) {
          const e = X.get(i, j) === -Infinity ? 0 : Math.exp(X.get(i, j) - mx);
          assert.ok(closeNum(a.exps.get(i, j), e, tol));
          s += e;
        }
        assert.ok(closeNum(a.rowSum.d[i], s, tol));
      }
      assert.equal(a.attention, st.tpl === 'fwd.attn.softmax');
      assert.deepEqual(a.queryLabels, ctx.tok);
      assert.deepEqual(a.keyLabels, a.attention ? ctx.tok : ctx.vocab);
      break;
    }
    case 'activation':
      assert.equal(a.fn, ctx.cfg.activation);
      assertClose(Mat.map(m(I[0]), actF[a.fn]), m(O[0]), tol, st.id);
      break;
    case 'crossentropy': {
      const P = m(I[0]), Y = m(I[1]);
      let s = 0;
      for (let t = 0; t < P.r; t++) {
        for (let v = 0; v < P.c; v++) assert.equal(Y.get(t, v), v === a.targetIds[t] ? 1 : 0);
        const lt = -Math.log(P.get(t, a.targetIds[t]));
        assert.ok(closeNum(a.perToken.d[t], lt, tol));
        assert.ok(closeNum(a.pTarget.d[t], P.get(t, a.targetIds[t]), tol));
        s += lt;
      }
      assert.deepEqual(m(O[0]).shape(), [1, 1]);
      assert.ok(closeNum(m(O[0]).d[0], s / P.r, tol));
      assert.equal(O[0].role, 'scalar');
      break;
    }
    case 'grad_ce':
      assert.equal(a.T, m(I[0]).r);
      assertClose(Mat.map2(m(I[0]), m(I[1]), (p, y) => (p - y) / a.T), m(O[0]), tol, st.id);
      break;
    case 'grad_softmax': {
      const A = m(I[0]), dA = m(I[1]);
      const out = new Mat(A.r, A.c);
      for (let i = 0; i < A.r; i++) {
        let s = 0;
        for (let j = 0; j < A.c; j++) s += dA.get(i, j) * A.get(i, j);
        assert.ok(closeNum(a.rowDot.d[i], s, tol));
        for (let j = 0; j < A.c; j++) out.set(i, j, A.get(i, j) * (dA.get(i, j) - s));
      }
      assertClose(out, m(O[0]), tol, st.id);
      break;
    }
    case 'grad_mask':
      assertClose(Mat.map2(m(I[0]), m(I[1]), (x, mk) => (mk === -Infinity ? 0 : x)), m(O[0]), tol, st.id);
      break;
    case 'grad_activation': {
      const deriv = Mat.map(m(I[1]), actD[a.fn]);
      assertClose(deriv, a.deriv, tol, st.id + ' f\'');
      assertClose(Mat.map2(m(I[0]), deriv, (x, y) => x * y), m(O[0]), tol, st.id);
      break;
    }
    case 'grad_layernorm': {
      const dY = m(I[0]), X = m(I[1]), g = m(I[2]);
      const T = X.r, d = X.c;
      const r = layerNormRef(X, g, Mat.zeros(1, d), a.eps);
      assertClose(r.xhat, a.xhat, tol, st.id + ' x̂');
      assertClose(r.sig, a.sigma, tol, st.id + ' σ');
      assertClose(r.mu, a.mu, tol, st.id + ' μ');
      const dx = new Mat(T, d), dxh = new Mat(T, d), dg = new Mat(1, d), db = new Mat(1, d);
      for (let t = 0; t < T; t++) {
        let m1 = 0, m2 = 0;
        for (let j = 0; j < d; j++) {
          dxh.set(t, j, dY.get(t, j) * g.d[j]);
          m1 += dxh.get(t, j) / d;
          m2 += dxh.get(t, j) * r.xhat.get(t, j) / d;
          dg.d[j] += dY.get(t, j) * r.xhat.get(t, j);
          db.d[j] += dY.get(t, j);
        }
        for (let j = 0; j < d; j++) dx.set(t, j, (dxh.get(t, j) - m1 - r.xhat.get(t, j) * m2) / r.sig.d[t]);
      }
      assertClose(dxh, a.dxhat, tol, st.id + ' dx̂');
      assertClose(dx, m(O[0]), tol, st.id + ' dX');
      assertClose(dg, m(O[1]), tol, st.id + ' dγ');
      assertClose(db, m(O[2]), tol, st.id + ' dβ');
      break;
    }
    case 'grad_lookup': {
      const ohT = m(I[0]);
      for (let v = 0; v < ohT.r; v++) for (let t = 0; t < ohT.c; t++) assert.equal(ohT.get(v, t), v === a.ids[t] ? 1 : 0);
      assertClose(naiveMatmul(ohT, m(I[1])), m(O[0]), tol, st.id);
      break;
    }
    case 'sumrows': {
      const X = m(I[0]);
      const s = new Mat(1, X.c);
      for (let i = 0; i < X.r; i++) for (let j = 0; j < X.c; j++) s.d[j] += X.get(i, j);
      assertClose(s, m(O[0]), tol, st.id);
      break;
    }
    case 'residual_split':
      assert.equal(a.branches.length, O.length);
      for (const o of O) assertClose(m(I[0]), m(o), 0, st.id);
      break;
    case 'gradnorm': {
      let s = 0;
      for (const n of a.norms) s += n.norm * n.norm;
      assert.ok(closeNum(Math.sqrt(s), a.total, 1e-12));
      const expected = a.clip > 0 && a.total > a.clip ? a.clip / a.total : 1;
      assert.ok(closeNum(a.factor, expected, 1e-15));
      assert.deepEqual(a.norms.map((n) => n.name), ctx.order);
      ctx.gradnorm = a;
      break;
    }
    case 'update': {
      const th = m(I[0]), g = m(I[1]);
      assert.equal(a.lr, ctx.opt.lr);
      if (a.optimizer === 'adam') {
        const mm = m(I[2]), vv = m(I[3]);
        const mN = Mat.map2(mm, g, (x, y) => a.beta1 * x + (1 - a.beta1) * y);
        const vN = Mat.map2(vv, g, (x, y) => a.beta2 * x + (1 - a.beta2) * y * y);
        const mh = Mat.map(mN, (x) => x / (1 - Math.pow(a.beta1, a.t)));
        const vh = Mat.map(vN, (x) => x / (1 - Math.pow(a.beta2, a.t)));
        const up = Mat.map2(mh, vh, (x, y) => (a.lr * x) / (Math.sqrt(y) + a.eps));
        assertClose(mN, m(O[1]), tol, st.id + ' m');
        assertClose(vN, m(O[2]), tol, st.id + ' v');
        assertClose(mh, a.mhat, tol, st.id + ' m̂');
        assertClose(vh, a.vhat, tol, st.id + ' v̂');
        assertClose(Mat.map2(th, up, (x, y) => x - y), m(O[0]), tol, st.id + ' θ');
      } else {
        assertClose(Mat.map2(th, g, (x, y) => x - a.lr * y), m(O[0]), tol, st.id + ' θ');
      }
      assertClose(Mat.map2(m(O[0]), th, (x, y) => x - y), a.delta, tol, st.id + ' Δ');
      // el gradiente usado = gradiente del backward × factor de recorte
      assertClose(Mat.map(ctx.grads[a.name], (x) => x * ctx.gradnorm.factor), g, tol, st.id + ' g');
      break;
    }
    default:
      assert.fail('kind sin comprobar: ' + st.kind);
  }
}

function checkTrace(opts) {
  const s = TL.Trainer.createSession(opts);
  if (opts.pretrain) TL.Trainer.trainSteps(s, opts.pretrain);
  const sIdx = opts.sentence || 0;
  const sen = s.tok.sentences[sIdx];
  const cfg = s.model.cfg;
  const model = s.model;
  // gradientes sin traza con los parámetros previos a la actualización
  const fU = TL.Model.forward(model, sen.inputIds, sen.targetIds, { trace: false });
  const gU = TL.Model.backward(model, fU.cache, { trace: false }).grads;
  const paramsBefore = {};
  for (const n of model.order) paramsBefore[n] = model.params[n].clone();
  const optT = s.opt.t;
  const tr = TL.Trainer.traceIteration(s, sIdx);
  const steps = tr.steps;
  assert.ok(closeNum(tr.loss, fU.loss, 0), 'la traza no altera la pérdida');
  assert.equal(s.opt.t, optT + 1);
  assert.equal(tr.iter, s.iter);
  assert.equal(s.history[s.history.length - 1].loss, tr.loss);

  // 1) secuencia de plantillas
  assert.deepEqual(steps.map((x) => x.tpl), expectedTpls(cfg, model.order.length));
  // 2) ids únicos
  assert.equal(new Set(steps.map((x) => x.id)).size, steps.length, 'ids únicos');
  const env = { T: sen.T, d: cfg.dModel, dk: cfg.dModel / cfg.nHeads, dff: cfg.dFF, V: model.vocab.length, h: cfg.nHeads, maxLen: cfg.maxLen };
  const tok = sen.inputTokens.map(s.tok.display);
  const vocab = model.vocab.map(s.tok.display);
  const axisSize = { T: env.T, V: env.V, d: env.d, dk: env.dk, dff: env.dff, 1: 1, maxLen: env.maxLen };
  const ctx = { env, tok, vocab, cfg, order: model.order, opt: s.opt, grads: gU };
  const seenMats = new Set();
  const byTex = new Map();
  const updates = [];
  const multi = cfg.nLayers > 1;
  for (const st of steps) {
    // 3) campos obligatorios
    for (const k of ['id', 'tpl', 'phase', 'block', 'kind', 'title', 'formula', 'dimsSym', 'dims']) {
      assert.equal(typeof st[k], 'string', st.id + '.' + k);
      assert.ok(st[k].length > 0 || (k === 'dims' && false), st.id + '.' + k + ' vacío');
    }
    assert.ok(['data', 'forward', 'loss', 'backward', 'update'].includes(st.phase), st.id);
    assert.ok(KINDS.has(st.kind), st.id + ' kind ' + st.kind);
    assert.ok(st.layer === null || (Number.isInteger(st.layer) && st.layer >= 0 && st.layer < cfg.nLayers), st.id + ' layer');
    assert.ok(st.head === null || (Number.isInteger(st.head) && st.head >= 0 && st.head < cfg.nHeads), st.id + ' head');
    assert.ok(Array.isArray(st.inputs) && Array.isArray(st.outputs) && st.aux && typeof st.aux === 'object', st.id);
    assert.ok(st.flops === null || (typeof st.flops === 'number' && st.flops > 0), st.id + ' flops');
    if (st.kind === 'matmul') assert.ok(st.flops > 0, st.id + ' flops en matmul');
    // fase coherente con la plantilla
    const expPhase = { data: 'data', fwd: 'forward', loss: 'loss', bwd: 'backward', upd: 'update' }[st.tpl.split('.')[0]];
    assert.equal(st.phase, expPhase, st.id + ' fase');
    // bloque del diagrama
    if (st.layer !== null && st.phase !== 'update') {
      const [pre, b] = st.block.split('.');
      assert.equal(pre, 'L' + st.layer, st.id + ' bloque de capa');
      assert.ok(BLOCKS_LAYER.includes(b), st.id + ' bloque ' + st.block);
    } else {
      assert.ok(BLOCKS_GLOBAL.has(st.block), st.id + ' bloque ' + st.block);
    }
    if (st.phase === 'update') assert.equal(st.block, 'optim');
    // títulos concretos en español
    if (st.layer !== null) assert.ok(st.title.startsWith('Capa ' + (st.layer + 1) + ' · '), st.id + ' título: ' + st.title);
    if (st.head !== null) assert.ok(st.title.includes('Cabeza ' + (st.head + 1) + ' · '), st.id + ' título: ' + st.title);
    if (st.head !== null) assert.ok(st.id.includes('.h' + st.head + '.'), st.id);
    // notación: superíndice de capa solo con N > 1
    const layerSup = st.formula.match(/([A-Za-z]'?|\})\^\{\[\d+\]/g) || [];
    if (!multi) {
      for (const m of st.formula.matchAll(/(.)\^\{\[(\d+)\]/g)) assert.equal(m[1], 'X', st.id + ': superíndice de capa inesperado en ' + st.formula);
    } else if (st.layer !== null && st.phase !== 'update') {
      assert.ok(st.formula.includes('^{[' + (st.layer + 1) + ']') || layerSup.length > 0, st.id + ': falta superíndice de capa');
    }
    if (st.phase === 'backward') assert.ok(st.formula.includes('\\mathrm{d}'), st.id + ': notación \\mathrm{d}');
    // 4) dims: sustitución de dimsSym y formas reales
    if (st.kind !== 'tokenize' && st.kind !== 'gradnorm') assert.equal(st.dims, substDims(st.dimsSym, env), st.id + ' dims');
    const shapes = st.inputs.concat(st.outputs).map((r) => r.mat.r + 'x' + r.mat.c);
    const pairs = [...st.dims.matchAll(/\((\d+)\\times (\d+)\)/g)].map((m) => m[1] + 'x' + m[2]);
    const symPairs = [...st.dimsSym.matchAll(/\(([^()]+?)\\times ([^()]+?)\)/g)];
    if (st.kind !== 'gradnorm') {
      assert.ok(pairs.length > 0, st.id + ' dims sin formas');
      assert.equal(pairs.length, symPairs.length, st.id + ' dims/dimsSym');
      for (const p of pairs) assert.ok(shapes.includes(p), st.id + ': ' + p + ' no está entre ' + shapes.join(','));
      assert.equal(pairs[pairs.length - 1], st.outputs[st.outputs.length - 1].mat.r + 'x' + st.outputs[st.outputs.length - 1].mat.c,
        st.id + ': la última forma de dims es la salida');
    }
    // 5) TensorRefs
    const keys = new Set();
    for (const r of st.inputs.concat(st.outputs)) {
      assert.ok(/^[A-Za-z0-9_]+$/.test(r.key), st.id + ' key ASCII: ' + r.key);
      assert.ok(!keys.has(r.key), st.id + ' key repetida ' + r.key);
      keys.add(r.key);
      assert.ok(typeof r.tex === 'string' && r.tex.length && typeof r.label === 'string' && r.label.length, st.id + ' ' + r.key);
      assert.ok(r.mat instanceof Mat, st.id + ' ' + r.key + ' mat');
      assert.ok(!seenMats.has(r.mat), st.id + ' ' + r.key + ': cada mat es un clon propio');
      seenMats.add(r.mat);
      for (const n of model.order) assert.notEqual(r.mat, model.params[n]);
      assert.ok(ROLES.has(r.role), st.id + ' rol ' + r.role);
      assert.ok(AXES.has(r.rowAxis) && AXES.has(r.colAxis), st.id + ' ejes');
      assert.equal(r.mat.r, axisSize[r.rowAxis], st.id + ' ' + r.key + ' eje de filas ' + r.rowAxis);
      assert.equal(r.mat.c, axisSize[r.colAxis], st.id + ' ' + r.key + ' eje de columnas ' + r.colAxis);
      assert.ok(r.rowLabels === null || r.rowLabels.length === r.mat.r, st.id + ' rowLabels');
      assert.ok(r.colLabels === null || r.colLabels.length === r.mat.c, st.id + ' colLabels');
      for (const [ax, lab] of [[r.rowAxis, r.rowLabels], [r.colAxis, r.colLabels]]) {
        if (ax === 'T') assert.deepEqual(lab, tok, st.id + ' ' + r.key + ' etiquetas T');
        else if (ax === 'V') assert.deepEqual(lab, vocab, st.id + ' ' + r.key + ' etiquetas V');
        else assert.equal(lab, null, st.id + ' ' + r.key + ' etiquetas de ' + ax);
      }
      assert.ok(Number.isInteger(r.colOffset) && r.colOffset >= 0);
      if (r.colAxis === 'dk') assert.equal(r.colOffset % env.dk, 0);
      if (/grad/.test(st.kind) || st.phase === 'backward') {
        if (r.tex.startsWith('\\mathrm{d}')) assert.equal(r.role, 'grad', st.id + ' ' + r.key + ' rol grad');
      }
      if (r.tex.includes('^{\\top}') || /\]\\top\}/.test(r.tex)) assert.ok(/T$/.test(r.key), st.id + ' clave de traspuesta ' + r.key);
      // coherencia entre pasos: el mismo nombre LaTeX siempre es el mismo tensor
      if (byTex.has(r.tex)) assertClose(byTex.get(r.tex), r.mat, 0, st.id + ': ' + r.tex + ' cambia entre pasos');
      else byTex.set(r.tex, r.mat);
    }
    // 6) recomputación de cada salida
    recompute(st, ctx);
    if (st.kind === 'update') updates.push(st.aux.name);
  }
  assert.deepEqual(updates, model.order, 'un paso de actualización por parámetro, en orden');
  // los parámetros de la traza (antes) coinciden con los previos y la sesión quedó actualizada
  for (const st of steps.filter((x) => x.kind === 'update')) {
    assertClose(st.inputs[0].mat, paramsBefore[st.aux.name], 0, 'θ antes');
    assertClose(st.outputs[0].mat, model.params[st.aux.name], 0, 'θ después');
  }
  return { s, steps, gU };
}

const TRACE_CONFIGS = [
  { label: 'por defecto', o: {}, expectSteps: 91 },
  { label: 'N = 2, h = 4, GELU, posición aprendida, SGD', o: { cfg: { nLayers: 2, nHeads: 4, activation: 'gelu', posEnc: 'learned' }, optim: { type: 'sgd' }, sentence: 5 } },
  { label: 'h = 1, recorte fuerte', o: { cfg: { nHeads: 1 }, optim: { clip: 0.01 }, pretrain: 3, sentence: 2 } },
  { label: 'modo carácter', o: { tokMode: 'char', cfg: { maxLen: 6 } } },
  { label: 'N = 3', o: { cfg: { nLayers: 3 }, pretrain: 5, sentence: 6 } },
];
for (const C of TRACE_CONFIGS) {
  test('Traza (contrato §5/§6, recomputación de todas las salidas): ' + C.label, () => {
    const { steps, s } = checkTrace(C.o);
    if (C.expectSteps) assert.equal(steps.length, C.expectSteps);
    if (C.o.optim && C.o.optim.clip === 0.01) {
      const gn = steps.find((x) => x.kind === 'gradnorm');
      assert.ok(gn.aux.factor < 1 && gn.aux.clipped, 'el recorte está activo');
      assert.ok(steps.find((x) => x.kind === 'update').inputs[1].tex.startsWith('c\\,'));
    }
    assert.ok(s.iter >= 1);
  });
}

test('Traza: ejemplos concretos de títulos, fórmulas, dims y etiquetas', () => {
  const s = TL.Trainer.createSession({});
  const { steps } = TL.Trainer.traceIteration(s, 0);
  const byId = Object.fromEntries(steps.map((x) => [x.id, x]));
  const sc = byId['fwd.L0.attn.h1.scores'];
  assert.equal(sc.tpl, 'fwd.attn.scores');
  assert.equal(sc.block, 'L0.scores');
  assert.equal(sc.title, 'Capa 1 · Cabeza 2 · Puntuaciones Q·Kᵀ');
  assert.equal(sc.formula, 'S_2 = Q_2\\,K_2^{\\top}');
  assert.equal(sc.dimsSym, '(T\\times d_k)\\cdot(d_k\\times T)\\to(T\\times T)');
  assert.equal(sc.dims, '(5\\times 4)\\cdot(4\\times 5)\\to(5\\times 5)');
  assert.equal(sc.flops, 5 * 4 * 5);
  assert.equal(sc.inputs[1].key, 'K_2T');
  assert.equal(sc.inputs[1].tex, 'K_2^{\\top}');
  assert.deepEqual(sc.inputs[1].mat.shape(), [4, 5]);
  assert.equal(sc.inputs[0].colOffset, 4);
  assert.deepEqual(sc.outputs[0].rowLabels, ['<s>', 'el', 'gato', 'come', 'pescado']);
  assert.deepEqual(sc.outputs[0].colLabels, ['<s>', 'el', 'gato', 'come', 'pescado']);
  const dwq = byId['bwd.L0.attn.q.dW'];
  assert.equal(dwq.formula, '\\mathrm{d}W_Q = H^{\\top}\\,\\mathrm{d}Q');
  assert.equal(dwq.block, 'L0.qkv');
  assert.equal(byId['bwd.L0.attn.h0.scores.dQ'].block, 'L0.scores');
  assert.equal(byId['data.tokenize'].phase, 'data');
  assert.equal(byId['data.tokenize'].aux.text, 'el gato come pescado .');
  assert.deepEqual(byId['data.tokenize'].aux.vocab, s.tok.vocab);
  assert.equal(byId['fwd.embed'].inputs[0].role, 'onehot');
  assert.deepEqual(byId['fwd.logits'].outputs[0].colLabels, s.tok.vocab);
  assert.equal(byId['fwd.L0.attn.h0.softmax'].outputs[0].role, 'prob');
  assert.equal(byId['upd.param.L0.Wq'].aux.name, 'L0.Wq');
  assert.equal(byId['upd.param.L0.Wq'].layer, 0);
  assert.equal(byId['upd.param.E'].inputs[0].rowLabels.length, 22);
  // superíndices con varias capas
  const s2 = TL.Trainer.createSession({ cfg: { nLayers: 2 } });
  const st2 = TL.Trainer.traceIteration(s2, 0).steps;
  const q2 = st2.find((x) => x.id === 'fwd.L1.attn.q');
  assert.equal(q2.formula, 'Q^{[2]} = H^{[2]}\\,W_Q^{[2]}');
  assert.equal(q2.title.startsWith('Capa 2 · '), true);
  const k2 = st2.find((x) => x.id === 'fwd.L1.attn.h0.scores');
  assert.equal(k2.inputs[1].tex, 'K_1^{[2]\\top}');
  const r2 = st2.find((x) => x.id === 'fwd.L1.res2');
  assert.equal(r2.formula, 'X^{[2]} = R^{[2]} + F^{[2]}');
});

test('Traza: gradientes trazados = gradientes sin traza', () => {
  for (const cfg of [{}, { nLayers: 2, nHeads: 4, activation: 'gelu', posEnc: 'learned' }]) {
    const s = TL.Trainer.createSession({ cfg });
    TL.Trainer.trainSteps(s, 5);
    const sen = s.tok.sentences[3];
    const f1 = TL.Model.forward(s.model, sen.inputIds, sen.targetIds, { trace: false });
    const g1 = TL.Model.backward(s.model, f1.cache, { trace: false });
    const f2 = TL.Model.forward(s.model, sen.inputIds, sen.targetIds, { trace: true });
    const g2 = TL.Model.backward(s.model, f2.cache, { trace: true });
    assert.equal(f1.loss, f2.loss);
    assert.equal(g1.steps.length, 0);
    assert.ok(g2.steps.length > 0);
    for (const n of s.model.order) assertClose(g1.grads[n], g2.grads[n], 0, n);
    // y coinciden con las salidas de los pasos de la traza
    const out = (tpl, key) => g2.steps.find((x) => x.tpl === tpl).outputs.find((o) => o.key === key).mat;
    assertClose(out('bwd.logits.dW', 'dW_out'), g1.grads.Wout, 0);
    assertClose(out('bwd.embed', 'dE'), g1.grads.E, 0);
  }
});

// ------------------------------------------------------------------ Optimizadores
test('Optimizador: SGD (θ ← θ − η g) y recorte por norma global', () => {
  const s = TL.Trainer.createSession({ optim: { type: 'sgd', clip: 0 } });
  assert.equal(s.opt.lr, 0.1, 'lr por defecto de SGD');
  const model = s.model;
  const g = {};
  const rng = TL.rng(3);
  for (const n of model.order) g[n] = Mat.randn(model.params[n].r, model.params[n].c, 0.1, rng);
  const before = {};
  for (const n of model.order) before[n] = model.params[n].clone();
  const r = TL.Optim.step(s.opt, model, g, { trace: false });
  assert.equal(r.clipFactor, 1);
  assert.equal(r.steps.length, 0);
  let tot = 0;
  for (const n of model.order) {
    assertClose(model.params[n], Mat.map2(before[n], g[n], (x, y) => x - 0.1 * y), 1e-15, n);
    tot += g[n].frob() ** 2;
    assert.ok(closeNum(r.norms[n], g[n].frob(), 1e-12));
  }
  assert.ok(closeNum(r.gradNorm, Math.sqrt(tot), 1e-12));
  // con recorte: todos los gradientes se escalan por c = clip/‖g‖
  const opt2 = TL.Optim.create({ type: 'sgd', lr: 0.5, clip: 0.1 });
  const b2 = {};
  for (const n of model.order) b2[n] = model.params[n].clone();
  const r2 = TL.Optim.step(opt2, model, g, {});
  const c = 0.1 / Math.sqrt(tot);
  assert.ok(closeNum(r2.clipFactor, c, 1e-12));
  for (const n of model.order) assertClose(model.params[n], Mat.map2(b2[n], g[n], (x, y) => x - 0.5 * c * y), 1e-14, n);
  // los gradientes de entrada no se modifican
  const g0 = g.E.clone();
  TL.Optim.step(opt2, model, g, {});
  assertClose(g.E, g0, 0);
});

test('Optimizador: Adam con corrección de sesgo (t = 1, 2, 3)', () => {
  const s = TL.Trainer.createSession({ optim: { clip: 0 } });
  const model = s.model;
  const opt = s.opt;
  assert.deepEqual([opt.type, opt.lr, opt.beta1, opt.beta2, opt.eps], ['adam', 0.01, 0.9, 0.999, 1e-8]);
  const rng = TL.rng(11);
  const name = 'L0.Wq';
  let m = new Float64Array(64), v = new Float64Array(64);
  const theta = model.params[name].clone();
  for (let t = 1; t <= 3; t++) {
    const g = {};
    for (const n of model.order) g[n] = Mat.randn(model.params[n].r, model.params[n].c, 0.3, rng);
    const prev = model.params[name].clone();
    const tr = TL.Optim.step(opt, model, g, { trace: t === 2 });
    assert.equal(opt.t, t);
    for (let k = 0; k < 64; k++) {
      const gk = g[name].d[k];
      m[k] = 0.9 * m[k] + 0.1 * gk;
      v[k] = 0.999 * v[k] + 0.001 * gk * gk;
      const mh = m[k] / (1 - 0.9 ** t), vh = v[k] / (1 - 0.999 ** t);
      theta.d[k] -= 0.01 * mh / (Math.sqrt(vh) + 1e-8);
    }
    assertClose(model.params[name], theta, 1e-12, 'θ en t=' + t);
    if (t === 1) {
      // en t = 1, m̂ = g y v̂ = g² ⇒ el paso es η·g/(|g|+ε) ≈ η·signo(g)
      for (let k = 0; k < 64; k++) {
        const step = prev.d[k] - model.params[name].d[k];
        assert.ok(closeNum(step, 0.01 * Math.sign(g[name].d[k]), 1e-6), 'paso ' + step);
      }
    }
    if (t === 2) {
      assert.equal(tr.steps.length, 1 + model.order.length);
      const up = tr.steps.find((x) => x.aux.name === name);
      assert.equal(up.aux.t, 2);
      assert.equal(up.inputs.length, 4);
      assert.equal(up.outputs.length, 3);
      assertClose(up.outputs[1].mat, new Mat(8, 8, m.slice()), 1e-14, 'm');
      assertClose(up.outputs[2].mat, new Mat(8, 8, v.slice()), 1e-14, 'v');
    }
  }
});

// ------------------------------------------------------------------ Entrenamiento
test('Entrenamiento: convergencia y continuaciones que dependen del sujeto', () => {
  const s = TL.Trainer.createSession({});
  const V = s.tok.vocab.length;
  const l0 = TL.Trainer.evaluate(s).loss;
  assert.ok(Math.abs(l0 - Math.log(V)) < 0.5, 'pérdida inicial ≈ ln V (' + l0 + ' vs ' + Math.log(V) + ')');
  const r = TL.Trainer.trainSteps(s, 200);
  assert.equal(r.losses.length, 200);
  assert.equal(s.iter, 200);
  assert.equal(s.history.length, 200);
  const l200 = TL.Trainer.evaluate(s).loss;
  TL.Trainer.trainSteps(s, 200);
  const ev = TL.Trainer.evaluate(s);
  const l400 = ev.loss;
  assert.ok(l200 < 0.5 * l0, 'tras 200 iteraciones: ' + l200);
  assert.ok(l400 < 0.5 * l0 && l400 <= l200 + 0.02, 'tras 400 iteraciones: ' + l400);
  assert.equal(ev.perSentence.length, 8);
  assert.ok(Object.keys(s.lastGradNorms).length === s.model.order.length);
  const pNext = (prompt, word) => {
    const ids = [0].concat(s.tok.encode(prompt).ids);
    const f = TL.Model.forward(s.model, ids, null, {});
    return f.probs.get(ids.length - 1, s.tok.stoi[word]);
  };
  const pg = pNext('el gato come', 'pescado'), pp = pNext('el perro come', 'carne');
  assert.ok(pg > 0.8, 'p(pescado | el gato come) = ' + pg);
  assert.ok(pp > 0.8, 'p(carne | el perro come) = ' + pp);
  assert.ok(pNext('la niña bebe', 'leche') > 0.8);
  assert.ok(pNext('el niño bebe', 'agua') > 0.8);
  // predict
  const pr = TL.Trainer.predict(s, 0);
  assert.deepEqual(pr.probs.shape(), [5, V]);
  assert.ok(pr.probs.get(3, s.tok.stoi.pescado) > 0.8);
  assert.deepEqual(pr.inputTokens, ['<s>', 'el', 'gato', 'come', 'pescado']);
  assert.equal(pr.attn[0].length, 2);
  // la atención en la posición de «come» mira hacia atrás (a «gato»), no solo a sí misma
  let back = 0;
  for (const A of pr.attn[0]) back = Math.max(back, A.get(3, 2));
  assert.ok(back > 0.2, 'alguna cabeza atiende a «gato» desde «come»: ' + back);
});

test('Generación: «el gato come» → «pescado .» tras entrenar; errores y ventana deslizante', () => {
  const s = TL.Trainer.createSession({});
  TL.Trainer.trainSteps(s, 400);
  const g = TL.Trainer.generate(s, 'el gato come');
  assert.equal(g.ok, true);
  assert.deepEqual(g.tokens, ['<s>', 'el', 'gato', 'come', 'pescado', '.']);
  assert.equal(g.text, 'el gato come pescado.');
  assert.equal(g.steps.length, 2);
  const st = g.steps[0];
  assert.deepEqual(st.context, ['<s>', 'el', 'gato', 'come']);
  assert.equal(st.chosenToken, 'pescado');
  assert.equal(st.probs.length, s.tok.vocab.length);
  assert.ok(Math.abs(st.probs.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(st.top[0].token, 'pescado');
  assert.ok(st.top.length === 10 && st.top[0].p >= st.top[1].p);
  assert.equal(st.attn.length, 1);
  assert.deepEqual(st.attn[0][0].shape(), [4, 4]);
  const g2 = TL.Trainer.generate(s, 'el perro come');
  assert.deepEqual(g2.tokens.slice(-2), ['carne', '.']);
  // tokens desconocidos → error claro en español
  const bad = TL.Trainer.generate(s, 'el dragón vuela');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /desconocidos: «dragón», «vuela».*vocabulario/);
  // muestreo con semilla: reproducible
  const a1 = TL.Trainer.generate(s, 'el', { greedy: false, temperature: 1.5, seed: 3, maxNew: 6 });
  const a2 = TL.Trainer.generate(s, 'el', { greedy: false, temperature: 1.5, seed: 3, maxNew: 6 });
  assert.deepEqual(a1.tokens, a2.tokens);
  // ventana deslizante: el contexto nunca supera maxLen
  const long = TL.Trainer.generate(s, 'el gato duerme en la casa el gato', { maxNew: 5 });
  assert.equal(long.ok, true);
  for (const x of long.steps) assert.ok(x.context.length <= s.cfg.maxLen);
  assert.ok(long.steps.length >= 1);
  // temperatura alta aplana la distribución
  const hot = TL.Trainer.generate(s, 'el gato come', { temperature: 5, maxNew: 1 });
  assert.ok(hot.steps[0].probs[s.tok.stoi.pescado] < st.probs[s.tok.stoi.pescado]);
});

test('Sesión: snapshot/restore reproduce el entrenamiento exactamente', () => {
  const s = TL.Trainer.createSession({});
  TL.Trainer.trainSteps(s, 7);
  const snap = TL.Trainer.snapshot(s);
  const r1 = TL.Trainer.trainSteps(s, 10).losses;
  const p1 = s.model.params.Wout.clone();
  TL.Trainer.restore(s, snap);
  assert.equal(s.iter, 7);
  assert.equal(s.history.length, 7);
  assert.equal(s.opt.t, 7);
  const r2 = TL.Trainer.trainSteps(s, 10).losses;
  assert.deepEqual(r1, r2);
  assertClose(s.model.params.Wout, p1, 0);
  // el snapshot es una copia profunda
  TL.Trainer.restore(s, snap);
  s.model.params.E.d[0] += 1;
  TL.Trainer.restore(s, snap);
  assert.equal(s.model.params.E.d[0], snap.params.E[0]);
});

test('Sesión: configuración inválida y setHyper', () => {
  assert.throws(() => TL.Trainer.createSession({ cfg: { dModel: 10, nHeads: 4 } }), /debe dividir/);
  assert.throws(() => TL.Trainer.createSession({ corpus: '' }), /vacío/);
  const s = TL.Trainer.createSession({ batchSize: 2 });
  assert.equal(s.batchSize, 2);
  TL.Trainer.setHyper(s, { lr: 0.003 });
  assert.equal(s.opt.lr, 0.003);
  TL.Trainer.setHyper(s, { type: 'sgd', lr: 0.2 });
  assert.equal(s.opt.type, 'sgd');
  TL.Trainer.trainSteps(s, 3);
  assert.equal(s.iter, 3);
});

test('Mapa de dimensiones (shapeTable)', () => {
  for (const cfg of [{}, { nLayers: 2, nHeads: 4, posEnc: 'learned' }]) {
    const s = TL.Trainer.createSession({ cfg });
    const m = s.model;
    const rows = TL.Model.shapeTable(m, 5);
    const env = { T: 5, d: m.cfg.dModel, dk: m.cfg.dModel / m.cfg.nHeads, dff: m.cfg.dFF, V: m.vocab.length, h: m.cfg.nHeads, maxLen: m.cfg.maxLen };
    for (const r of rows) {
      assert.ok(r.group && r.tex && r.sym && r.desc, JSON.stringify(r));
      assert.equal(substDims('(' + r.sym + ')', env), '(' + r.shape[0] + '\\times ' + r.shape[1] + ')', r.tex);
    }
    const groups = [...new Set(rows.map((r) => r.group))];
    for (const g of ['Datos', 'Embeddings', 'Capa 1 · Atención', 'Capa 1 · FFN', 'Salida', 'Pérdida', 'Gradientes · Salida', 'Gradientes · Embeddings']) {
      assert.ok(groups.includes(g), 'grupo ' + g);
    }
    for (let l = 1; l <= m.cfg.nLayers; l++) assert.ok(groups.includes('Gradientes · Capa ' + l + ' · Atención'));
    const find = (tex) => rows.find((r) => r.tex === tex);
    assert.deepEqual(find('E').shape, [m.vocab.length, m.cfg.dModel]);
    assert.deepEqual(find('\\mathrm{logits}').shape, [5, m.vocab.length]);
    assert.deepEqual(find('\\mathcal{L}').shape, [1, 1]);
    const multi = m.cfg.nLayers > 1;
    assert.deepEqual(find(multi ? 'A_1^{[1]}' : 'A_1').shape, [5, 5]);
    assert.deepEqual(find(multi ? 'U^{[1]}' : 'U').shape, [5, m.cfg.dFF]);
    assert.ok(rows.length > 40);
  }
});

// ------------------------------------------------------------------ Rendimiento
test('Rendimiento: ≥ 200 iteraciones/s sin traza (lote 4) y traza < 50 ms', () => {
  const s = TL.Trainer.createSession({});
  TL.Trainer.trainSteps(s, 30); // calentamiento del JIT
  const t0 = process.hrtime.bigint();
  TL.Trainer.trainSteps(s, 300);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const itps = 300 / (ms / 1000);
  assert.ok(itps >= 200, 'iteraciones/s = ' + itps.toFixed(0));
  for (let i = 0; i < 3; i++) TL.Trainer.traceIteration(s, i);
  const t1 = process.hrtime.bigint();
  const n = 20;
  for (let i = 0; i < n; i++) TL.Trainer.traceIteration(s, i % 8);
  const msTrace = Number(process.hrtime.bigint() - t1) / 1e6 / n;
  assert.ok(msTrace < 50, 'traceIteration = ' + msTrace.toFixed(2) + ' ms');
  console.log('# rendimiento: ' + itps.toFixed(0) + ' it/s sin traza (lote 4), traceIteration ' + msTrace.toFixed(2) + ' ms');
});
