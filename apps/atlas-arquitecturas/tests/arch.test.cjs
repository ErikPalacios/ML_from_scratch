// Pruebas del calculador ATLAS.Arch (SPEC §6, §9.2). Cuentas a mano en configs diminutas,
// anclas de ViT-B/16 y reglas prácticas que aparecen en la prosa.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/arch/primitives.js', 'js/arch/transformer.js', 'js/arch/vit.js', 'js/core/quantities.js'];
function load() {
  const ctx = vm.createContext({});
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return vm.runInContext('ATLAS', ctx);
}
const ATLAS = load();
const A = ATLAS.Arch;
const Q = ATLAS.Quantities;
const S = (sym, num, layout) => A.shape(sym, num, 'img', layout);
// Copia "plana" (los objetos del contexto vm tienen otro Array.prototype).
const J = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- primitivas
test('linear: forma, parámetros, MACs, otros y aritmética', () => {
  const x = S(['N', 'D'], [3, 4]);
  const r = A.linear(x, { dout: 5, doutSym: 'E' });
  assert.deepStrictEqual(J(r.out.num), [3, 5]);
  assert.deepStrictEqual(J(r.out.sym), ['N', 'E']);
  assert.strictEqual(r.params, 4 * 5 + 5);
  assert.strictEqual(r.macs, 3 * 4 * 5);
  assert.strictEqual(r.other, 3 * 5);                  // suma del sesgo
  assert.strictEqual(r.paramArith, '4·5 + 5 = 25');
  assert.strictEqual(r.macArith, '3·4·5 = 60');
  assert.strictEqual(r.paramFormula, 'D\\cdot E + E');
  assert.strictEqual(r.macFormula, 'N\\cdot D\\cdot E');
  const nb = A.linear(x, { dout: 5, bias: false });
  assert.strictEqual(nb.params, 20);
  assert.strictEqual(nb.other, 0);
});

test('conv2d: patchify y conv con padding', () => {
  const img = S(['H', 'W', 'C'], [8, 8, 3], 'grid');
  const r = A.conv2d(img, { k: 4, s: 4, cout: 6, coutSym: 'D', kSym: 'P', outSym: ['H/P', 'W/P'] });
  assert.deepStrictEqual(J(r.out.num), [2, 2, 6]);
  assert.strictEqual(r.out.layout, 'grid');
  assert.strictEqual(r.params, 4 * 4 * 3 * 6 + 6);      // 294
  assert.strictEqual(r.macs, 2 * 2 * 6 * 4 * 4 * 3);    // 1152
  assert.strictEqual(r.paramArith, '4·4·3·6 + 6 = 294');
  assert.ok(r.detail.patchify);
  const c = A.conv2d(S(['H', 'W', 'C'], [5, 5, 2], 'grid'), { k: 3, s: 1, p: 1, cout: 4 });
  assert.deepStrictEqual(J(c.out.num), [5, 5, 4]);
  assert.strictEqual(c.params, 3 * 3 * 2 * 4 + 4);
  assert.strictEqual(c.macs, 5 * 5 * 4 * 9 * 2);
  assert.throws(() => A.conv2d(S(['H', 'W', 'C'], [10, 10, 3], 'grid'), { k: 4, s: 4, cout: 2 }), /divisible/);
});

test('normas, activaciones y operaciones sin parámetros', () => {
  const x = S(['N', 'D'], [3, 4]);
  assert.strictEqual(A.layernorm(x).params, 8);
  assert.strictEqual(A.layernorm(x).macs, 0);
  assert.strictEqual(A.layernorm(x).other, 5 * 12);
  assert.strictEqual(A.layernorm(x).paramArith, '2·4 = 8');
  assert.strictEqual(A.rmsnorm(x).params, 4);
  assert.strictEqual(A.gelu(x).params, 0);
  assert.strictEqual(A.gelu(x).other, 8 * 12);
  assert.strictEqual(A.softmax(x).other, 5 * 12);
  assert.strictEqual(A.scale(x).other, 12);
  assert.strictEqual(A.residual_add(x, x).other, 12);
  assert.throws(() => A.residual_add(x, S(['N', 'D'], [3, 5])), /formas distintas/);
});

test('embeddings, CLS, concat, flatten, pool y cabeza', () => {
  const ids = A.shape(['N'], [3], 'txt', 'vec');
  const e = A.embedding_lookup(ids, { V: 10, D: 4 });
  assert.deepStrictEqual(J(e.out.num), [3, 4]);
  assert.strictEqual(e.params, 40);
  assert.strictEqual(e.macs, 0);
  const p = A.pos_embed_learned({ rows: 5, rowsSym: 'N+1', D: 4 });
  assert.strictEqual(p.params, 20);
  assert.deepStrictEqual(J(p.out.sym), ['N+1', 'D']);
  const x = S(['N', 'D'], [4, 6]);
  const c = A.cls_token(x);
  assert.deepStrictEqual(J(c.out.num), [5, 6]);
  assert.deepStrictEqual(J(c.out.sym), ['N+1', 'D']);
  assert.strictEqual(c.params, 6);
  const cat = A.concat_tokens(S(['T', 'D'], [2, 4]), S(['N', 'D'], [3, 4]));
  assert.deepStrictEqual(J(cat.out.num), [5, 4]);
  assert.strictEqual(cat.params, 0);
  assert.throws(() => A.concat_tokens(S(['T', 'D'], [2, 4]), S(['N', 'D'], [3, 5])), /anchos/);
  const fl = A.flatten(S(['h', 'w', 'D'], [2, 3, 4], 'grid'), { sym: ['N', 'D'] });
  assert.deepStrictEqual(J(fl.out.num), [6, 4]);
  const pc = A.pool_cls(S(['N+1', 'D'], [5, 4]));
  assert.deepStrictEqual(J(pc.out.num), [4]);
  assert.strictEqual(pc.out.layout, 'vec');
  const hd = A.classifier_head(pc.out, { K: 3 });
  assert.strictEqual(hd.prim, 'classifier_head');
  assert.strictEqual(hd.params, 4 * 3 + 3);
  assert.strictEqual(hd.macs, 12);
  assert.deepStrictEqual(J(hd.out.num), [3]);
});

test('atención elemental: split, scores, suma ponderada, merge', () => {
  const qkv = S(['N', '3D'], [3, 12]);
  const sp = A.split_heads(qkv, { h: 2, parts: 3 });
  assert.strictEqual(sp.out.length, 3);
  sp.out.forEach((t) => { assert.deepStrictEqual(J(t.num), [2, 3, 2]); assert.strictEqual(t.layout, 'heads'); });
  assert.deepStrictEqual(J(sp.out[0].sym), ['h', 'N', 'd_h']);
  assert.throws(() => A.split_heads(S(['N', 'D'], [3, 6]), { h: 4 }), /divisible/);
  const sc = A.attention_scores(sp.out[0], sp.out[1]);
  assert.deepStrictEqual(J(sc.out.num), [2, 3, 3]);
  assert.strictEqual(sc.macs, 2 * 3 * 3 * 2);            // h·N·N·d_h = N²·D = 36
  assert.strictEqual(sc.macs, 3 * 3 * 4);
  const ws = A.attention_weighted_sum(A.softmax(sc.out).out, sp.out[2]);
  assert.deepStrictEqual(J(ws.out.num), [2, 3, 2]);
  assert.strictEqual(ws.macs, 36);
  const mg = A.merge_heads(ws.out);
  assert.deepStrictEqual(J(mg.out.num), [3, 4]);
});

test('compuestas: mhsa, mlp y bloque pre-LN', () => {
  const x = S(['N', 'D'], [3, 4]);
  const at = A.mhsa(x, { h: 2 });
  assert.strictEqual(at.params, 4 * 16 + 4 * 4);                     // 4D² + 4D = 80
  assert.strictEqual(at.macs, 4 * 3 * 16 + 2 * 9 * 4);               // 4ND² + 2N²D = 264
  assert.strictEqual(at.paramFormula, '4D^2 + 4D');
  assert.strictEqual(A.mhsa(x, { h: 2, qkvBias: false }).params, 64 + 4);
  const ml = A.mlp(x, { Dmlp: 16 });
  assert.strictEqual(ml.params, 2 * 4 * 16 + 16 + 4);                // 148
  assert.strictEqual(ml.macs, 2 * 3 * 4 * 16);                       // 384
  const b = A.transformer_block(x, { h: 2, Dmlp: 16 });
  assert.strictEqual(b.params, 12 * 16 + 13 * 4);                    // 12D² + 13D = 244
  assert.strictEqual(b.macs, 12 * 3 * 16 + 2 * 9 * 4);               // 12ND² + 2N²D = 648
  assert.deepStrictEqual(J(b.out.num), [3, 4]);
  assert.strictEqual(b.paramArith, '8 + 80 + 8 + 148 = 244');
});

// ---------------------------------------------------------------- ViT-B/16 (anclas)
test('ViT-B/16 @224: 86,567,656 parámetros y 17,563,828,224 MACs', () => {
  const r = A.run('vit-b16-224');
  assert.strictEqual(r.totals.params, 86567656);
  assert.strictEqual(r.totals.macs, 17563828224);
  assert.strictEqual(r.totals.flops, 2 * 17563828224);
  const n = r.totals.byNode;
  assert.strictEqual(n['patch-embed'].params, 590592);
  assert.strictEqual(n['enc-layer'].params, 12 * 7087872);
  assert.strictEqual(n.cls.params, 768);
  assert.strictEqual(n['pos-embed'].params, 151296);
  assert.strictEqual(n['final-ln'].params, 1536);
  assert.strictEqual(n.head.params, 769000);
  assert.strictEqual(590592 + 12 * 7087872 + 768 + 151296 + 1536 + 769000, 86567656);
  assert.strictEqual(n['patch-embed'].macs, 196 * 768 * 768);
  assert.strictEqual(n.head.macs, 768 * 1000);
  assert.strictEqual(n['enc-layer'].macs, 12 * (197 * 12 * 768 * 768 + 2 * 197 * 197 * 768));
  assert.strictEqual(A.fmt.si(r.totals.macs), '17.56 G');
  assert.strictEqual(r.quantities.tokens, 197);
  assert.strictEqual(r.quantities.patches, 196);
});

test('ViT-B/16 @224: ids y formas de tensores (SPEC §13.1)', () => {
  const r = A.run('vit-b16-224');
  const want = {
    'x-img': [224, 224, 3], 'x-patch-grid': [14, 14, 768], 'x-patches': [196, 768], 'x-cls-cat': [197, 768],
    'e-pos': [197, 768], x0: [197, 768], 'h-ln1': [197, 768], qkv: [197, 2304], q: [12, 197, 64], k: [12, 197, 64],
    v: [12, 197, 64], scores: [12, 197, 197], 'scores-scaled': [12, 197, 197], attn: [12, 197, 197],
    'z-heads': [12, 197, 64], z: [197, 768], o: [197, 768], r1: [197, 768], 'h-ln2': [197, 768], u: [197, 3072],
    g: [197, 3072], f: [197, 768], 'x-out': [197, 768], 'x-ln': [197, 768], 'cls-out': [768], logits: [1000],
  };
  assert.deepStrictEqual(J(r.order), Object.keys(want));
  for (const [id, num] of Object.entries(want)) assert.deepStrictEqual(J(r.tensors[id].num), num, id);
  assert.strictEqual(A.fmt.shape(r.tensors.x0, 'sym'), '(N+1)×D');
  assert.strictEqual(A.fmt.shape(r.tensors.x0, 'num'), '197×768');
  assert.strictEqual(A.fmt.shape(r.tensors.q, 'sym'), 'h×(N+1)×d_h');
  assert.strictEqual(A.fmt.shapeTex(r.tensors.qkv), '(N{+}1)\\times 3D');
  assert.strictEqual(r.tensors['x-patches'].producer, 'patch-flatten');
  assert.strictEqual(r.tensors['x-img'].producer, null);
  assert.ok(r.tensors.qkv.perLayer);
  assert.ok(!r.tensors['x-out'].perLayer);
});

test('ViT: ops con path de nodos y el ejemplo de qkv de SPEC §6.7', () => {
  const r = A.run('vit-b16-224');
  const qkv = r.ops.find((o) => o.id === 'qkv');
  assert.deepStrictEqual(J(qkv.path), ['encoder', 'enc-layer', 'mhsa', 'qkv']);
  assert.strictEqual(qkv.prim, 'linear');
  assert.strictEqual(qkv.label, 'Proyección Q, K, V');
  assert.deepStrictEqual(J(qkv.in), ['h-ln1']);
  assert.deepStrictEqual(J(qkv.out), ['qkv']);
  assert.strictEqual(qkv.repeat, 12);
  assert.strictEqual(qkv.params, 1771776);
  assert.strictEqual(qkv.macs, 348585984);
  assert.strictEqual(qkv.other, 197 * 2304);
  assert.strictEqual(qkv.paramTex, 'D\\cdot 3D + 3D');
  assert.strictEqual(qkv.paramArith, '768·2304 + 2304 = 1,771,776');
  assert.strictEqual(qkv.macTex, '(N+1)\\cdot D\\cdot 3D');
  assert.strictEqual(qkv.macArith, '197·768·2304 = 348,585,984');
  assert.strictEqual(qkv.shapeTex, '(N{+}1)\\times D \\to (N{+}1)\\times 3D');
  const paths = Object.fromEntries(r.ops.map((o) => [o.id, o.path.join('>')]));
  assert.deepStrictEqual(paths, {
    'patch-embed': 'patch-embed>conv', 'patch-flatten': 'patch-embed>flatten', cls: 'cls', 'pos-embed': 'pos-embed',
    'add-pos': 'add-pos', ln1: 'encoder>enc-layer>ln1', qkv: 'encoder>enc-layer>mhsa>qkv',
    split: 'encoder>enc-layer>mhsa>split', scores: 'encoder>enc-layer>mhsa>scores', scale: 'encoder>enc-layer>mhsa>scale',
    softmax: 'encoder>enc-layer>mhsa>softmax', 'weighted-sum': 'encoder>enc-layer>mhsa>weighted-sum',
    merge: 'encoder>enc-layer>mhsa>merge', proj: 'encoder>enc-layer>mhsa>proj', res1: 'encoder>enc-layer>res1',
    ln2: 'encoder>enc-layer>ln2', fc1: 'encoder>enc-layer>mlp>fc1', gelu: 'encoder>enc-layer>mlp>gelu',
    fc2: 'encoder>enc-layer>mlp>fc2', res2: 'encoder>enc-layer>res2', 'final-ln': 'final-ln', 'pool-cls': 'pool-cls', head: 'head',
  });
});

// ---------------------------------------------------------------- consistencia del contrato
function children(r, parentPath) {
  // nodos hijos directos de un path (o de la raíz)
  const depth = parentPath.length;
  const out = new Set();
  for (const op of r.ops) {
    if (op.path.length <= depth) continue;
    if (parentPath.every((p, i) => op.path[i] === p)) out.add(op.path[depth]);
  }
  return Array.from(out);
}

test('totals.byNode: la suma de cada nivel es igual al total (todas las configs)', () => {
  for (const c of A.configs()) {
    const r = A.run(c.id);
    const t = r.totals;
    const check = (pp, want) => {
      const kids = children(r, pp);
      if (!kids.length) return;
      const sp = kids.reduce((s, k) => s + t.byNode[k].params, 0);
      const sm = kids.reduce((s, k) => s + t.byNode[k].macs, 0);
      assert.strictEqual(sp, want.params, c.id + ' params bajo ' + (pp.join('>') || 'raíz'));
      assert.strictEqual(sm, want.macs, c.id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
      kids.forEach((k) => check(pp.concat([k]), t.byNode[k]));
    };
    check([], t);
    const sumOps = r.ops.reduce((s, o) => s + o.params * o.repeat, 0);
    assert.strictEqual(sumOps, t.params);
    const byPrim = Object.values(t.byPrim).reduce((s, x) => s + x.macs, 0);
    assert.strictEqual(byPrim, t.macs);
    const byGroup = Object.values(t.byGroup).reduce((s, x) => s + x.params, 0);
    assert.strictEqual(byGroup, t.params);
    assert.strictEqual(t.flops, 2 * t.macs);
  }
});

test('resultado de run(): forma del contrato §6.7 y grafo coherente', () => {
  for (const c of A.configs()) {
    const r = A.run(c.id);
    assert.strictEqual(A.run(c.id), r, 'memoizado');
    for (const k of ['id', 'model', 'label', 'config', 'paper', 'tensors', 'order', 'ops', 'totals', 'quantities']) assert.ok(k in r, k);
    assert.strictEqual(r.order.length, Object.keys(r.tensors).length);
    for (const id of r.order) {
      const t = r.tensors[id];
      for (const k of ['id', 'sym', 'num', 'mod', 'layout', 'tex', 'label', 'producer', 'consumers', 'perLayer']) assert.ok(k in t, id + '.' + k);
      assert.strictEqual(t.sym.length, t.num.length);
      if (t.producer) assert.ok(r.ops.find((o) => o.id === t.producer).out.includes(id));
      t.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(id)));
    }
    for (const op of r.ops) {
      for (const k of ['id', 'prim', 'label', 'path', 'in', 'out', 'repeat', 'params', 'macs', 'other', 'paramTex', 'paramArith', 'macTex', 'macArith', 'shapeTex']) assert.ok(k in op, op.id + '.' + k);
      assert.ok(Number.isInteger(op.params) && Number.isInteger(op.macs));
      // la aritmética termina en el número del op
      if (op.params) assert.ok(op.paramArith.endsWith(A.fmt.int(op.params)), op.id + ' paramArith');
      if (op.macs) assert.ok(op.macArith.endsWith(A.fmt.int(op.macs)), op.id + ' macArith');
    }
    assert.ok(Number.isInteger(r.quantities.tokens));
  }
});

// ---------------------------------------------------------------- reglas prácticas (prosa)
test('regla: una capa = 12D² + 13D parámetros (D_mlp = 4D, con sesgos)', () => {
  for (const id of ['vit-s16-224', 'vit-b16-224', 'vit-l16-224', 'vit-h14-224', 'toy-n5-d8']) {
    const r = A.run(id), D = r.config.D;
    assert.strictEqual(r.config.Dmlp, 4 * D);
    assert.strictEqual(r.quantities.layerParams, 12 * D * D + 13 * D, id);
  }
  assert.strictEqual(A.run('vit-b16-224').quantities.layerParams, 7087872);
});

test('regla: scores (2N²D) y lineales (12ND²) de una capa se cruzan en N = 6D', () => {
  // juguete: D = 8 → N = 48
  const at = A.run('toy-n5-d8', { N: 48 }).quantities;
  assert.strictEqual(at.scoreMacsLayer, at.layerMacs - at.scoreMacsLayer);
  assert.strictEqual(at.crossoverN, 48);
  const below = A.run('toy-n5-d8', { N: 47 }).quantities, above = A.run('toy-n5-d8', { N: 49 }).quantities;
  assert.ok(below.scoreMacsLayer < below.layerMacs - below.scoreMacsLayer);
  assert.ok(above.scoreMacsLayer > above.layerMacs - above.scoreMacsLayer);
  // ViT-B: 6D = 4608 tokens; a 224 px (197 tokens) los lineales dominan
  const m = A.metrics('vit-b16-224');
  assert.strictEqual(m.crossoverN, 6 * 768);
  assert.strictEqual(m.crossoverNProj, 2 * 768);
  assert.ok(m.scoreMacs < m.linearMacs);
});

test('regla: MACs lineales = tokens × pesos lineales (≈ 1 MAC por parámetro y token)', () => {
  const r = A.run('vit-b16-224');
  const lin = r.ops.filter((o) => o.prim === 'linear');
  const macs = lin.reduce((s, o) => s + o.macs * o.repeat, 0);
  const weights = lin.reduce((s, o) => s + (o.params - o.detail.dout) * o.repeat, 0);
  assert.strictEqual(macs, 197 * weights);
  const perToken = r.totals.macs / 197;
  assert.ok(Math.abs(perToken / r.totals.params - 1) < 0.05, 'MACs por token ≈ parámetros');
});

// ---------------------------------------------------------------- juguete (transformer)
test('juguete: = torch.nn.TransformerEncoderLayer(8, 2, 32, norm_first=True)', () => {
  for (const id of ['toy-n5-d8', 'toy-n5-d8-causal']) {
    const r = A.run(id);
    assert.strictEqual(r.totals.params, 872);   // in_proj 216 + out_proj 72 + linear1 288 + linear2 264 + 2·16
    assert.strictEqual(r.totals.byNode.qkv.params, 8 * 24 + 24);
    assert.strictEqual(r.totals.byNode.proj.params, 8 * 8 + 8);
    assert.strictEqual(r.totals.byNode.fc1.params, 8 * 32 + 32);
    assert.strictEqual(r.totals.byNode.fc2.params, 32 * 8 + 8);
    assert.strictEqual(r.totals.byNode.ln1.params, 16);
    assert.strictEqual(r.totals.macs, 960 + 200 + 200 + 320 + 1280 + 1280);
    assert.deepStrictEqual(J(r.tensors.q.num), [2, 5, 4]);
    assert.deepStrictEqual(J(r.tensors.attn.num), [2, 5, 5]);
    assert.deepStrictEqual(J(r.tensors.u.num), [5, 32]);
    assert.deepStrictEqual(J(r.ops.find((o) => o.id === 'qkv').path), ['enc-layer', 'mhsa', 'qkv']);
  }
  const c = A.run('toy-n5-d8-causal');
  assert.strictEqual(c.quantities.usedScores, 2 * 15);
  assert.strictEqual(c.quantities.maskedScores, 2 * 10);
  assert.match(c.ops.find((o) => o.id === 'scale').label, /causal/);
  assert.deepStrictEqual(J(c.order), ['x0', 'h-ln1', 'qkv', 'q', 'k', 'v', 'scores', 'scores-scaled', 'attn', 'z-heads', 'z', 'o', 'r1', 'h-ln2', 'u', 'g', 'f', 'x-out']);
});

// ---------------------------------------------------------------- knobs y métricas
test('knobs: resolución 448 → ×4 tokens, ×16 scores, posición interpolada', () => {
  const base = A.run('vit-b16-224'), big = A.run('vit-b16-224', { res: 448 });
  assert.strictEqual(big.quantities.patches, 784);
  assert.strictEqual(big.quantities.tokens, 785);
  assert.strictEqual(big.totals.params - base.totals.params, (785 - 197) * 768);
  assert.strictEqual(big.quantities.scoreMacsLayer / base.quantities.scoreMacsLayer, (785 / 197) ** 2);
  assert.ok(big.notes.some((n) => /interpolad/.test(n)));
  assert.strictEqual(big.label, 'ViT-B/16 @ 448');
  // b16 @ 384 por knob = config vit-b16-384
  assert.strictEqual(A.run('vit-b16-224', { res: 384 }).totals.params, A.run('vit-b16-384').totals.params);
  assert.strictEqual(A.run('vit-b16-224', { P: 32 }).totals.macs, A.run('vit-b32-224').totals.macs);
  assert.throws(() => A.run('vit-b16-224', { res: 225 }), /divisible/);
  assert.throws(() => A.run('vit-b16-224', { D: 1024 }), /Knob inválido/);
  assert.throws(() => A.run('vit-b16-224', { res: -3 }), /entero positivo/);
  assert.throws(() => A.run('vit-z99'), /Configuración desconocida/);
});

test('metrics: memoria de atención, dtype y batch', () => {
  const m = A.metrics('vit-b16-224');
  assert.strictEqual(m.tokens, 197);
  assert.strictEqual(m.attnMem, 12 * 197 * 197 * 2);       // bf16, B = 1, una capa
  assert.strictEqual(m.attnMemAllLayers, 12 * m.attnMem);
  assert.strictEqual(A.metrics('vit-b16-224', { dtype: 'fp32', B: 8 }).attnMem, 12 * 197 * 197 * 4 * 8);
  assert.strictEqual(m.scoreMacs, 12 * 2 * 197 * 197 * 768);
  assert.ok(Math.abs(m.attnMacsShare - (12 * (4 * 197 * 768 * 768 + 2 * 197 * 197 * 768)) / m.macs) < 1e-12);
  assert.strictEqual(m.kvCache, null);
  assert.ok(m.actMem > 0);
  assert.strictEqual(A.metrics('toy-n5-d8-causal').kvCache, 2 * 1 * 5 * 8 * 2);
  assert.strictEqual(A.metrics('toy-n5-d8-causal', { ctx: 100, B: 4 }).kvCache, 2 * 1 * 100 * 8 * 2 * 4);
  assert.throws(() => A.metrics('vit-b16-224', { dtype: 'fp64' }), /dtype/);
});

// ---------------------------------------------------------------- formato, listas, cantidades
test('fmt', () => {
  assert.strictEqual(A.fmt.int(86567656), '86,567,656');
  assert.strictEqual(A.fmt.si(86567656), '86.6 M');
  assert.strictEqual(A.fmt.si(17563828224), '17.56 G');
  assert.strictEqual(A.fmt.si(1771776), '1.77 M');
  assert.strictEqual(A.fmt.si(872), '872');
  // Memoria en unidades decimales (1 KB = 1000 B), un solo formateador para toda la app.
  assert.strictEqual(A.fmt.bytes(2e6), '2.00 MB');
  assert.strictEqual(A.fmt.bytes(12 * 197 * 197 * 2), '931.4 KB');
  assert.strictEqual(A.fmt.bytes(86567656 * 2), '173.1 MB');
  assert.strictEqual(A.fmt.bytes(999960), '1.00 MB');
  assert.strictEqual(A.fmt.bytes(512), '512 B');
  assert.strictEqual(A.fmt.pct(0.1234), '12.3 %');
});

test('configs, models y primitives', () => {
  assert.deepStrictEqual(J(A.models()).sort(), ['transformer', 'vit']);
  const v = J(A.configs('vit'));
  assert.deepStrictEqual(v.map((c) => c.id), ['vit-b16-224', 'vit-s16-224', 'vit-l16-224', 'vit-h14-224', 'vit-b16-384', 'vit-b32-224']);
  assert.deepStrictEqual(v.filter((c) => c.canonical).map((c) => c.id), ['vit-b16-224']);
  assert.strictEqual(A.canonical('transformer'), 'toy-n5-d8');
  const ids = J(A.primitives()).map((p) => p.id);
  for (const id of ['linear', 'conv2d', 'layernorm', 'rmsnorm', 'gelu', 'embedding_lookup', 'pos_embed_learned', 'cls_token',
    'concat_tokens', 'split_heads', 'merge_heads', 'attention_scores', 'softmax', 'attention_weighted_sum', 'mhsa', 'mlp',
    'residual_add', 'transformer_block', 'pool_cls', 'classifier_head']) {
    assert.ok(ids.includes(id), id);
    assert.strictEqual(typeof A[id], 'function', id);
  }
  assert.throws(() => A.configs('nada'), /Modelo desconocido/);
});

test('Quantities: get, fill y keys', () => {
  const g = (k, o) => J(Q.get(k, o));
  assert.deepStrictEqual(g('vit-b16-224.params.total'), { value: 86567656, text: '86,567,656' });
  assert.strictEqual(Q.get('vit-b16-224.params.totalM').text, '86.6 M');
  assert.strictEqual(Q.get('vit-b16-224.macs.totalG').text, '17.56 G');
  assert.strictEqual(Q.get('vit-b16-224.flops.totalG').text, '35.13 G');
  assert.strictEqual(Q.get('vit-b16-224.macs.totalGMACs').text, '17.56 GMACs');
  assert.strictEqual(Q.get('vit-b16-224.flops.totalGFLOPs').text, '35.13 GFLOPs');
  assert.strictEqual(A.fmt.ops(17563828224), '17.56 GMACs');
  assert.strictEqual(A.fmt.ops(872), '872 MACs');
  assert.strictEqual(Q.get('vit-b16-224.tokens').text, '197');
  assert.strictEqual(Q.get('vit-b16-224.quantities.patches').text, '196');
  assert.strictEqual(Q.get('vit-b16-224.tensor.x0.shape').text, '197×768');
  assert.strictEqual(Q.get('vit-b16-224.tensor.x0.sym').text, '(N+1)×D');
  assert.strictEqual(Q.get('vit-b16-224.tensor.qkv.elements').text, '453,888');
  assert.strictEqual(Q.get('vit-b16-224.node.enc-layer.params').value, 12 * 7087872);
  assert.strictEqual(Q.get('vit-b16-224.op.qkv.paramArith').text, '768·2304 + 2304 = 1,771,776');
  assert.strictEqual(Q.get('vit-b16-224.cfg.D').text, '768');
  assert.strictEqual(Q.get('vit-l16-224.cfg.D').text, '1024');      // dimensiones sin separador (como en las formas)
  assert.strictEqual(Q.get('vit-b16-224.metrics.attnMem').text, '931.4 KB');
  assert.strictEqual(Q.get('vit-b16-224.metrics.paramMem').text, '173.1 MB');
  assert.strictEqual(Q.get('vit-b16-224.cfg.qkvBias').text, 'sí');
  assert.strictEqual(Q.get('vit-b16-224.metrics.attnMem').value, 12 * 197 * 197 * 2);
  assert.strictEqual(Q.get('tokens', { config: 'vit-b16-384' }).text, '577');
  assert.strictEqual(Q.get('vit-b16-224.no.existe'), null);
  assert.strictEqual(Q.get('tokens'), null);  // sin config por defecto
  const html = Q.fill('ViT-B/16 tiene {{vit-b16-224.params.total}} parámetros y {{tokens}} tokens; {{x.y}}', { config: 'vit-b16-224' });
  assert.strictEqual(html.split(';')[0], 'ViT-B/16 tiene 86,567,656 parámetros y 197 tokens');
  assert.match(html, /class="q-unknown" data-key="x.y"/);
  const keys = J(Q.keys('vit-b16-224'));
  for (const k of ['params.total', 'params.totalM', 'macs.totalG', 'tokens', 'tensor.x0.shape', 'node.mhsa.params', 'cfg.D', 'quantities.patches']) assert.ok(keys.includes(k), k);
  keys.forEach((k) => assert.ok(Q.get('vit-b16-224.' + k), k));
  assert.deepStrictEqual(J(Q.scan('a {{b.c}} d {{ e }}')), ['b.c', 'e']);
});
