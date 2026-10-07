// Pruebas del calculador ATLAS.Arch (SPEC §6, §9.2). Cuentas a mano en configs diminutas,
// anclas de ViT-B/16 y reglas prácticas que aparecen en la prosa.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/arch/primitives.js', 'js/arch/transformer.js', 'js/arch/vit.js', 'js/arch/resnet.js', 'js/arch/swin.js', 'js/arch/clip.js', 'js/core/quantities.js'];
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

test('totals.byPath: la suma de cada nivel es igual al total (todas las configs)', () => {
  // byPath (ruta completa) y no byNode: en CLIP y Swin hay ids de nodo repetidos en dos lugares.
  for (const c of A.configs()) {
    const r = A.run(c.id);
    const t = r.totals;
    const check = (pp, want) => {
      const kids = children(r, pp);
      if (!kids.length) return;
      const at = (k) => t.byPath[pp.concat([k]).join('>')];
      const sp = kids.reduce((s, k) => s + at(k).params, 0);
      const sm = kids.reduce((s, k) => s + at(k).macs, 0);
      assert.strictEqual(sp, want.params, c.id + ' params bajo ' + (pp.join('>') || 'raíz'));
      assert.strictEqual(sm, want.macs, c.id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
      kids.forEach((k) => check(pp.concat([k]), at(k)));
    };
    check([], t);
    // donde un id de nodo aparece en un solo lugar, byNode = byPath
    const places = {};
    for (const key of Object.keys(t.byPath)) { const id = key.split('>').pop(); (places[id] = places[id] || []).push(key); }
    for (const [id, keys] of Object.entries(places)) if (keys.length === 1) assert.deepStrictEqual(J(t.byNode[id]), J(t.byPath[keys[0]]), c.id + ' ' + id);
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
  assert.deepStrictEqual(J(A.models()).sort(), ['clip', 'resnet', 'swin', 'transformer', 'vit']);
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

// ================================================================ Fase 2: primitivas nuevas
test('F2 conv2d con floor, batchnorm2d, relu, maxpool2d, global_avg_pool', () => {
  assert.throws(() => A.conv2d(S(['H', 'W', 'C'], [8, 8, 2], 'grid'), { k: 1, s: 2, cout: 3 }), /divisible/);
  const cf = A.conv2d(S(['H', 'W', 'C'], [8, 8, 2], 'grid'), { k: 1, s: 2, cout: 3, floor: true, bias: false });
  assert.deepStrictEqual(J(cf.out.num), [4, 4, 3]);              // floor(7/2) + 1 = 4
  assert.strictEqual(cf.params, 2 * 3);
  assert.strictEqual(cf.macs, 4 * 4 * 3 * 2);
  const x = S(['h', 'w', 'C'], [2, 2, 3], 'grid');
  const bn = A.batchnorm2d(x);
  assert.strictEqual(bn.params, 6);                               // γ y β
  assert.strictEqual(bn.detail.buffers, 7);                       // media + varianza + contador
  assert.strictEqual(bn.other, 12 * 5);
  assert.strictEqual(bn.paramFormula, '2C');
  assert.strictEqual(A.relu(x).other, 12);
  const mp = A.maxpool2d(S(['H', 'W', 'C'], [4, 4, 2], 'grid'), { k: 3, s: 2, p: 1 });
  assert.deepStrictEqual(J(mp.out.num), [2, 2, 2]);               // floor((4 + 2 − 3)/2) + 1
  assert.strictEqual(mp.params + mp.macs, 0);
  assert.strictEqual(mp.other, 2 * 2 * 2 * 9);
  const gp = A.global_avg_pool(S(['h', 'w', 'C'], [2, 3, 4], 'grid'));
  assert.deepStrictEqual(J(gp.out.num), [4]);
  assert.strictEqual(gp.out.layout, 'vec');
  assert.strictEqual(gp.other, 24);
  // LayerNorm sobre 2C: la fórmula dice 4C (no '22C')
  assert.strictEqual(A.layernorm(S(['N', '2C'], [3, 4])).paramFormula, '4C');
});

test('F2 conv_bn y bottleneck (identidad y proyección con stride)', () => {
  const cb = A.conv_bn(S(['H', 'W', 'C'], [4, 4, 2], 'grid'), { k: 3, p: 1, cout: 3 });
  assert.strictEqual(cb.params, 3 * 3 * 2 * 3 + 2 * 3);           // conv sin sesgo + γ, β
  assert.strictEqual(cb.macs, 4 * 4 * 3 * 9 * 2);
  assert.deepStrictEqual(J(cb.out.num), [4, 4, 3]);
  const x = S(['H', 'W', 'C'], [4, 4, 8], 'grid');
  const id = A.bottleneck(x, { width: 2, cout: 8 });
  assert.strictEqual(id.detail.project, false);
  // C_in·w + 9w² + 4w² + 12w = 16 + 36 + 16 + 24
  assert.strictEqual(id.params, 92);
  assert.strictEqual(id.macs, 16 * 16 + 16 * 36 + 16 * 16);
  const pj = A.bottleneck(x, { width: 2, cout: 8, stride: 2 });
  assert.strictEqual(pj.detail.project, true);
  assert.deepStrictEqual(J(pj.out.num), [2, 2, 8]);
  assert.strictEqual(pj.params, 92 + 8 * 8 + 2 * 8);              // + proyección 1×1 y su BN
  assert.strictEqual(pj.macs, 16 * 16 + 4 * 36 + 4 * 16 + 4 * 64);
});

test('F2 ventanas: shift, partición, reverse y atención por ventana elemental', () => {
  const g = S(['H', 'W', 'C'], [4, 4, 2], 'grid');
  const sh = A.cyclic_shift(g, { s: 1 });
  assert.deepStrictEqual(J(sh.out.num), [4, 4, 2]);
  assert.strictEqual(sh.params + sh.macs + sh.other, 0);
  const wp = A.window_partition(g, { M: 2 });
  assert.deepStrictEqual(J(wp.out.num), [4, 4, 2]);               // nW = (4/2)², M² = 4
  assert.deepStrictEqual(J(wp.out.sym), ['nW', 'M²', 'C']);
  assert.strictEqual(wp.out.layout, 'windows');
  assert.throws(() => A.window_partition(S(['H', 'W', 'C'], [5, 5, 2], 'grid'), { M: 2 }), /divisible/);
  const rv = A.window_reverse(wp.out, { H: 4, W: 4, M: 2, outSym: ['H', 'W'] });
  assert.deepStrictEqual(J(rv.out.num), [4, 4, 2]);
  assert.strictEqual(rv.out.layout, 'grid');
  const qkv = A.linear(wp.out, { dout: 6, doutSym: '3C' });
  assert.strictEqual(qkv.macs, 4 * 4 * 2 * 6);
  const [q, k, v] = A.split_heads(qkv.out, { h: 1, parts: 3 }).out;
  assert.deepStrictEqual(J(q.num), [4, 1, 4, 2]);
  assert.strictEqual(q.layout, 'winheads');
  const sc = A.attention_scores(q, k);
  assert.deepStrictEqual(J(sc.out.num), [4, 1, 4, 4]);
  assert.strictEqual(sc.macs, 16 * 4 * 2);                        // H·W·M²·C
  assert.strictEqual(sc.macFormula, 'n_W\\cdot h\\cdot M^2\\cdot M^2\\cdot d_h');
  const rb = A.rel_pos_bias(sc.out, { M: 2, h: 1 });
  assert.strictEqual(rb.params, 9);                               // (2M − 1)²·h
  assert.strictEqual(rb.paramArith, '3·3·1 = 9');
  assert.strictEqual(rb.paramFormula, '(2M-1)^2\\cdot h');
  const mk = A.attn_mask(rb.out);
  assert.strictEqual(mk.params + mk.macs, 0);
  const ws = A.attention_weighted_sum(A.softmax(mk.out).out, v);
  assert.deepStrictEqual(J(ws.out.num), [4, 1, 4, 2]);
  assert.strictEqual(ws.macs, 16 * 4 * 2);
  const mg = A.merge_heads(ws.out, { Dsym: 'C' });
  assert.deepStrictEqual(J(mg.out.num), [4, 4, 2]);
  assert.strictEqual(mg.out.layout, 'windows');
});

test('F2 window_attention compuesta: 4C² + 4C + (2M−1)²h y 4HWC² + 2HW·M²·C', () => {
  const x = S(['H', 'W', 'C'], [4, 4, 4], 'grid');
  for (const shift of [0, 1]) {
    const w = A.window_attention(x, { M: 2, h: 2, shift });
    assert.strictEqual(w.params, 4 * 16 + 4 * 4 + 9 * 2);
    assert.strictEqual(w.macs, 4 * 16 * 16 + 2 * 16 * 4 * 4);
    assert.deepStrictEqual(J(w.out.num), [4, 4, 4]);
    assert.strictEqual(w.detail.parts.some((p) => p.prim === 'cyclic_shift'), shift > 0);
    assert.strictEqual(w.detail.parts.some((p) => p.prim === 'attn_mask'), shift > 0);
    assert.strictEqual(w.detail.windowScoreMacs * 16 / 4, w.detail.globalScoreMacs);   // global / ventana = HW/M²
  }
});

test('F2 patch merging: tokens ÷4, canales ×2, 8C + 8C² parámetros sin sesgo', () => {
  const x = S(['H', 'W', 'C'], [4, 4, 3], 'grid');
  const cc = A.patch_concat(x);
  assert.deepStrictEqual(J(cc.out.num), [2, 2, 12]);
  const pm = A.patch_merging(x);
  assert.deepStrictEqual(J(pm.out.num), [2, 2, 6]);
  assert.strictEqual(pm.params, 8 * 3 + 8 * 9);                   // LN(4C) + Linear 4C→2C sin sesgo
  assert.strictEqual(pm.macs, 2 * 2 * 12 * 6);
  assert.throws(() => A.patch_concat(S(['H', 'W', 'C'], [3, 4, 2], 'grid')), /par/);
});

test('F2 atención causal, pick_token, L2, batch, similitud, temperatura y pérdida contrastiva', () => {
  const x = S(['N', 'D'], [3, 4]);
  const cs = A.causal_self_attention(x, { h: 2 });
  const bi = A.mhsa(x, { h: 2 });
  assert.strictEqual(cs.params, bi.params);
  assert.strictEqual(cs.macs, bi.macs);                           // la máscara no cambia los conteos
  assert.strictEqual(cs.detail.used, 2 * 6);                      // h·N(N+1)/2
  assert.strictEqual(cs.detail.masked, 2 * 3);
  const cm = A.causal_mask(S(['h', 'T', 'T'], [2, 3, 3], 'heads'));
  assert.strictEqual(cm.params + cm.macs, 0);
  assert.strictEqual(cm.other, 18);
  assert.deepStrictEqual(J(A.pick_token(S(['T', 'D'], [5, 4])).out.num), [4]);
  const l2 = A.l2_normalize(A.shape(['E'], [4], 'img', 'vec'));
  assert.strictEqual(l2.params + l2.macs, 0);
  assert.strictEqual(l2.other, 12);
  const sb = A.stack_batch(A.shape(['E'], [4], 'img', 'vec'), { B: 5 });
  assert.deepStrictEqual(J(sb.out.num), [5, 4]);
  assert.deepStrictEqual(J(sb.out.sym), ['B', 'E']);
  const I = A.shape(['B', 'E'], [3, 4], 'img'), T = A.shape(['B', 'E'], [3, 4], 'txt');
  const sim = A.similarity_logits(I, T);
  assert.deepStrictEqual(J(sim.out.num), [3, 3]);
  assert.strictEqual(sim.out.layout, 'mat');
  assert.strictEqual(sim.macs, 3 * 3 * 4);                        // B·B·E
  assert.strictEqual(sim.macFormula, 'B\\cdot B\\cdot E');
  assert.throws(() => A.similarity_logits(I, A.shape(['B', 'E'], [3, 5])), /distintas/);
  const ls = A.logit_scale(sim.out);
  assert.strictEqual(ls.params, 1);
  const lo = A.contrastive_loss(ls.out);
  assert.deepStrictEqual(J(lo.out.num), [1]);
  assert.strictEqual(lo.detail.negatives, 2);
  assert.strictEqual(lo.params + lo.macs, 0);
  const ids = J(A.primitives()).map((p) => p.id);
  for (const id of ['batchnorm2d', 'relu', 'maxpool2d', 'global_avg_pool', 'conv_bn', 'bottleneck', 'cyclic_shift', 'window_partition',
    'window_reverse', 'rel_pos_bias', 'attn_mask', 'causal_mask', 'window_attention', 'patch_merging', 'causal_self_attention',
    'pick_token', 'l2_normalize', 'similarity_logits', 'logit_scale', 'contrastive_loss']) {
    assert.ok(ids.includes(id), id);
    assert.strictEqual(typeof A[id], 'function', id);
  }
});

// ================================================================ Fase 2: Swin
const SWIN_IDS_S1B2 = ['ln1', 'shift', 'win', 'qkv', 'q', 'k', 'v', 'scores', 'scaled', 'biased', 'masked', 'attn', 'z-heads', 'z', 'proj', 'unwin', 'unshift', 'r1', 'ln2', 'u', 'g', 'f'];

test('Swin-T @224: 28,288,354 parámetros (timm) y 4,490,566,656 MACs (paper, Tabla 1(a): 29M, 4.5G)', () => {
  const r = A.run('swin-t-224');
  assert.strictEqual(r.totals.params, 28288354);
  assert.strictEqual(r.totals.macs, 4490566656);
  assert.strictEqual(A.fmt.si(r.totals.macs), '4.49 G');
  // La Tabla 1(a) imprime 29M para Swin-T (28.29M exactos): se acepta ±1M respecto del valor impreso.
  assert.strictEqual(r.config.paperParamsM, 29);
  assert.ok(Math.abs(r.totals.params / 1e6 - r.config.paperParamsM) <= 1);
  assert.strictEqual(Math.round(r.totals.macs / 1e8) / 10, r.config.paperGFLOPs);   // los "FLOPs" del paper son MACs
  assert.strictEqual(r.quantities.tokens, 3136);
  const n = r.totals.byNode;
  assert.strictEqual(n['patch-embed'].params, 4 * 4 * 3 * 96 + 96 + 2 * 96);
  assert.strictEqual(n.head.params, 768 * 1000 + 1000);
  assert.strictEqual(n['w-msa'].params, 4 * 96 * 96 + 4 * 96 + 13 * 13 * 3);   // 37,755
  assert.strictEqual(n['w-msa'].params, n['sw-msa'].params);      // la máscara es un buffer
  assert.strictEqual(n.bias.params, 2 * 169 * 3);                 // los dos bloques del stage 1
  assert.strictEqual(n.merge1.params, 8 * 96 + 8 * 96 * 96);      // 74,496
  assert.strictEqual(r.quantities.biasParamsS1Block, 507);
  for (const id of ['swin-s-224', 'swin-b-224', 'swin-b-384']) {
    const x = A.run(id);
    assert.ok(Math.abs(x.totals.params / 1e6 - x.config.paperParamsM) <= 1, id + ' parámetros ≈ paper (±1M)');
    assert.ok(Math.abs(x.totals.macs / 1e9 / x.config.paperGFLOPs - 1) < 0.005, id + ' MACs ≈ "FLOPs" del paper (±0.5 %)');
  }
});

test('Swin-T: ids y formas de tensores (SPEC §14.1)', () => {
  const r = A.run('swin-t-224');
  const sh = (id) => J(r.tensors[id].num);
  assert.deepStrictEqual(sh('x-img'), [224, 224, 3]);
  assert.deepStrictEqual(sh('x-patch-grid'), [56, 56, 96]);
  assert.deepStrictEqual(sh('x-embed'), [56, 56, 96]);
  assert.deepStrictEqual(sh('s1-b1-win'), [64, 49, 96]);
  assert.deepStrictEqual(sh('s1-b1-q'), [64, 3, 49, 32]);
  assert.deepStrictEqual(sh('s1-b1-scores'), [64, 3, 49, 49]);
  assert.deepStrictEqual(sh('s1-b1-qkv'), [64, 49, 288]);
  assert.deepStrictEqual(sh('s1-b1-z'), [64, 49, 96]);
  assert.deepStrictEqual(sh('s1-b1-unwin'), [56, 56, 96]);
  assert.deepStrictEqual(sh('s1-b1-u'), [56, 56, 384]);
  for (const nm of SWIN_IDS_S1B2) assert.ok(r.tensors['s1-b2-' + nm], 's1-b2-' + nm);
  for (const nm of ['shift', 'masked', 'unshift']) assert.ok(!r.tensors['s1-b1-' + nm], 's1-b1-' + nm + ' no existe (bloque W-MSA)');
  assert.deepStrictEqual(sh('s1-out'), [56, 56, 96]);
  assert.deepStrictEqual(sh('m1-concat'), [28, 28, 384]);
  assert.deepStrictEqual(sh('m1-out'), [28, 28, 192]);
  assert.deepStrictEqual(sh('s2-out'), [28, 28, 192]);
  assert.deepStrictEqual(sh('s3-out'), [14, 14, 384]);
  assert.deepStrictEqual(sh('s4-out'), [7, 7, 768]);
  assert.deepStrictEqual(sh('x-ln'), [7, 7, 768]);
  assert.deepStrictEqual(sh('pooled'), [768]);
  assert.deepStrictEqual(sh('logits'), [1000]);
  assert.strictEqual(A.fmt.shape(r.tensors['s1-b1-win'], 'sym'), 'nW×M²×C');
  assert.strictEqual(A.fmt.shapeTex(r.tensors['s1-b1-win']), 'n_W\\times M^2\\times C');
  assert.strictEqual(A.fmt.shape(r.tensors['m1-out'], 'sym'), '(H/8)×(W/8)×2C');
  assert.strictEqual(r.tensors['s1-b1-scores'].layout, 'winheads');
  assert.strictEqual(r.order[0], 'x-img');
  assert.strictEqual(r.order[r.order.length - 1], 'logits');
});

test('Swin-T: paths del stage 1 (nodos de swin-block-pair / swin-wmsa / swin-swmsa) y de los stages 2–4', () => {
  const r = A.run('swin-t-224');
  const p = (id) => r.ops.find((o) => o.id === id).path.join('>');
  assert.strictEqual(p('patch-embed'), 'patch-embed>conv');
  assert.strictEqual(p('s1-b1-ln1'), 'stage1>w-ln1');
  assert.strictEqual(p('s1-b1-partition'), 'stage1>w-msa>partition');
  assert.strictEqual(p('s1-b1-bias'), 'stage1>w-msa>bias');
  assert.strictEqual(p('s1-b1-reverse'), 'stage1>w-msa>reverse');
  assert.strictEqual(p('s1-b1-fc1'), 'stage1>w-mlp>fc1');
  assert.strictEqual(p('s1-b1-res2'), 'stage1>w-res2');
  assert.strictEqual(p('s1-b2-shift'), 'stage1>sw-msa>shift');
  assert.strictEqual(p('s1-b2-mask'), 'stage1>sw-msa>mask');
  assert.strictEqual(p('s1-b2-unshift'), 'stage1>sw-msa>unshift');
  assert.strictEqual(p('s1-b2-res1'), 'stage1>sw-res1');
  assert.strictEqual(p('m1-concat'), 'merge1>concat');
  assert.strictEqual(p('m1-ln'), 'merge1>ln');
  assert.strictEqual(p('m1-reduce'), 'merge1>reduce');
  assert.strictEqual(p('m2-reduce'), 'merge2>m2-reduce');
  assert.strictEqual(p('s3-b1-qkv'), 'stage3>s3-w-msa');
  assert.strictEqual(p('s3-b2-fc2'), 'stage3>s3-sw-mlp');
  assert.strictEqual(p('final-ln'), 'final-ln');
  assert.strictEqual(p('pool'), 'pool');
  assert.strictEqual(p('head'), 'head');
  for (const op of r.ops) if (/^s[2-4]-/.test(op.id)) assert.ok(/^stage[2-4]$/.test(op.path[0]) && op.path.length === 2, op.id);
  assert.strictEqual(r.ops.find((o) => o.id === 's3-b1-qkv').repeat, 3);          // 6 bloques = 3 pares
  // byPath separa W-MSA y SW-MSA (byNode.qkv suma ambos)
  assert.strictEqual(r.totals.byNode.qkv.params, 2 * r.totals.byPath['stage1>w-msa>qkv'].params);
});

test('Swin: regla de timm — mapa ≤ ventana → una ventana y sin desplazamiento', () => {
  const r = A.run('swin-t-224');
  const s4 = r.config.stages[3];
  assert.strictEqual(s4.side, 7);
  assert.strictEqual(s4.windows, 1);
  assert.strictEqual(s4.shift, 0);
  for (const nm of ['shift', 'masked', 'unshift']) assert.ok(!r.tensors['s4-b2-' + nm], 's4-b2-' + nm);
  assert.ok(!r.ops.some((o) => o.id === 's4-b2-mask'));
  assert.deepStrictEqual(J(r.tensors['s4-b2-win'].num), [1, 49, 768]);
  assert.deepStrictEqual(J(r.config.stages.map((s) => s.shift)), [3, 3, 3, 0]);
  // Swin-B @384 (M = 12): 96, 48, 24, 12 → el stage 4 también sin shift
  assert.deepStrictEqual(J(A.run('swin-b-384').config.stages.map((s) => [s.side, s.M, s.shift])), [[96, 12, 6], [48, 12, 6], [24, 12, 6], [12, 12, 0]]);
  // M = 14 a 224: stage 3 (14×14) una ventana sin shift; stage 4 (7×7) ventana recortada a 7 (= timm)
  const m14 = A.run('swin-t-224', { M: 14 });
  assert.deepStrictEqual(J(m14.config.stages.map((s) => [s.M, s.shift])), [[14, 7], [14, 7], [14, 0], [7, 0]]);
  assert.strictEqual(m14.totals.params, 28338754);                // timm swin_tiny(window_size=14)
  assert.strictEqual(2 * m14.totals.macs, 9777727488);            // FlopCounterMode
  assert.strictEqual(m14.label, 'Swin-T @ 224 (M = 14)');
  const r448 = A.run('swin-t-224', { res: 448 });
  assert.strictEqual(r448.totals.params, 28288354);               // sin position embedding absoluto: no cambia
  assert.strictEqual(2 * r448.totals.macs, 35919925248);          // timm img_size=448
  assert.strictEqual(2 * A.run('swin-t-224', { res: 384, M: 12 }).totals.macs, 27987505152);
  assert.throws(() => A.run('swin-t-224', { res: 384 }), /múltiplo de la ventana/);
  assert.throws(() => A.run('swin-t-224', { D: 3 }), /Knob inválido/);
});

test('Swin: reglas de la prosa — atención por ventana lineal vs global cuadrática, merging, strides de ResNet', () => {
  const r = A.run('swin-t-224');
  const op = (id) => r.ops.find((o) => o.id === id);
  // QKᵀ de un bloque del stage 1 = (H·W)·M²·C; global = (H·W)²·C
  assert.strictEqual(op('s1-b1-scores').macs, 3136 * 49 * 96);
  assert.strictEqual(r.quantities.s1QkMacs, 3136 * 49 * 96);
  const m = A.metrics('swin-t-224');
  assert.strictEqual(m.s1ScoreMacs, 2 * 3136 * 49 * 96);          // QKᵀ + A·V
  assert.strictEqual(m.s1GlobalScoreMacs, 2 * 3136 * 3136 * 96);
  assert.strictEqual(m.s1GlobalToWindow, 64);                     // = HW/M² = nº de ventanas
  assert.strictEqual(m.s1GlobalToWindow, m.s1Windows);
  assert.deepStrictEqual(J(m.stages.map((s) => s.ratio)), [64, 16, 4, 1]);
  assert.strictEqual(op('s1-b1-scores').macs + op('s1-b1-weighted-sum').macs, m.s1ScoreMacs);
  assert.strictEqual(m.s1AttnMem, 64 * 3 * 49 * 49 * 2);          // bf16, B = 1
  assert.strictEqual(m.s1GlobalAttnMem, 3 * 3136 * 3136 * 2);
  assert.strictEqual(m.attnMem, m.s1AttnMem);                     // el mayor tensor de scores es el del stage 1
  assert.strictEqual(A.metrics('swin-t-224', { B: 4, dtype: 'fp32' }).s1AttnMem, 64 * 3 * 49 * 49 * 4 * 4);
  // ×4 tokens → ×4 MACs de scores con ventanas (lineal), ×16 con global (cuadrática)
  const big = A.metrics('swin-t-224', { res: 448 });
  assert.strictEqual(big.s1ScoreMacs / m.s1ScoreMacs, 4);
  assert.strictEqual(big.s1GlobalScoreMacs / m.s1GlobalScoreMacs, 16);
  // patch merging: tokens ÷4, canales ×2 en cada merge
  for (let k = 1; k <= 3; k++) {
    const a = r.tensors['s' + k + '-out'], b = r.tensors['m' + k + '-out'];
    assert.strictEqual(a.num[0] * a.num[1], 4 * b.num[0] * b.num[1]);
    assert.strictEqual(b.num[2], 2 * a.num[2]);
  }
  // los strides de Swin (4, 8, 16, 32) son los de C2…C5 de ResNet-50
  const rn = A.run('resnet50-224');
  for (let k = 1; k <= 4; k++) {
    assert.deepStrictEqual(J(r.tensors['s' + k + '-out'].num.slice(0, 2)), J(rn.tensors['c' + (k + 1)].num.slice(0, 2)), 'stage ' + k);
    assert.strictEqual(r.quantities['s' + k + 'Stride'], 4 * Math.pow(2, k - 1));
  }
});

// ================================================================ Fase 2: ResNet-50
test('ResNet-50 @224: 25,557,032 parámetros (torchvision) y C2…C5', () => {
  const r = A.run('resnet50-224');
  assert.strictEqual(r.totals.params, 25557032);
  assert.strictEqual(r.totals.macs, 4089184256);
  const sh = (id) => J(r.tensors[id].num);
  assert.deepStrictEqual(sh('stem-out'), [112, 112, 64]);
  assert.deepStrictEqual(sh('pool-out'), [56, 56, 64]);
  assert.deepStrictEqual(sh('c2'), [56, 56, 256]);
  assert.deepStrictEqual(sh('c3'), [28, 28, 512]);
  assert.deepStrictEqual(sh('c4'), [14, 14, 1024]);
  assert.deepStrictEqual(sh('c5'), [7, 7, 2048]);
  assert.deepStrictEqual(sh('pooled'), [2048]);
  assert.deepStrictEqual(sh('logits'), [1000]);
  const n = r.totals.byNode;
  assert.strictEqual(n.stem.params, 7 * 7 * 3 * 64 + 2 * 64);
  assert.strictEqual(n.stem.macs, 112 * 112 * 64 * 7 * 7 * 3);
  assert.strictEqual(n.head.params, 2048 * 1000 + 1000);
  assert.strictEqual(r.quantities.bnBuffers, 53173);              // = torchvision named_buffers()
  assert.strictEqual(r.ops.find((o) => o.id === 'l3-b2-conv2').repeat, 5);
  // bloque 1 de layer1: proyección sin stride (64 → 256)
  assert.deepStrictEqual(sh('l1-b1-down'), [56, 56, 256]);
  assert.deepStrictEqual(sh('l2-b1-conv2'), [28, 28, 128]);       // v1.5: el stride va en la 3×3
  assert.deepStrictEqual(sh('l2-b1-conv1'), [56, 56, 128]);
  assert.throws(() => A.run('resnet50-224', { res: 200 }), /múltiplo de 32/);
});

// ================================================================ Fase 2: CLIP
test('CLIP: parámetros = código de OpenAI / HF y diferencias con ViT', () => {
  const want = { 'clip-vit-b16': 149620737, 'clip-vit-b32': 151277313, 'clip-vit-l14': 427616513, 'clip-vit-l14-336': 427944193 };
  for (const [id, n] of Object.entries(want)) assert.strictEqual(A.run(id).totals.params, n, id);
  const r = A.run('clip-vit-b16'), p = r.totals.byPath;
  // torre de imagen = ViT-B/16 sin sesgo de patch (−768), + ln_pre (+1536), sin cabeza de 1000 clases
  assert.strictEqual(p['img-encoder'].params, 86567656 - 768 + 1536 - 769000);
  assert.strictEqual(p['txt-encoder'].params, 63165952);
  assert.strictEqual(p['img-proj'].params, 768 * 512);            // sin sesgo
  assert.strictEqual(p['txt-proj'].params, 512 * 512);
  assert.strictEqual(p.temperature.params, 1);
  assert.strictEqual(p['txt-encoder>tok-embed'].params, 49408 * 512);
  assert.strictEqual(p['txt-encoder>tok-embed'].macs, 0);
  assert.strictEqual(p['img-encoder>patch-embed'].params, 16 * 16 * 3 * 768);
  // ids compartidos entre torres: byNode suma las dos, byPath las separa
  assert.strictEqual(r.totals.byNode['enc-layer'].params, p['img-encoder>enc-layer'].params + p['txt-encoder>enc-layer'].params);
  assert.strictEqual(r.quantities.imgEncoderParams, p['img-encoder'].params);
  assert.ok(r.quantities.imgMacs > 5 * r.quantities.txtMacs, 'la torre de imagen domina los MACs');
});

test('CLIP: ids, formas y paths (SPEC §14.3)', () => {
  const r = A.run('clip-vit-b16');
  const sh = (id) => J(r.tensors[id].num);
  const want = {
    'i-img': [224, 224, 3], 'i-patch-grid': [14, 14, 768], 'i-patches': [196, 768], 'i-cls-cat': [197, 768], 'i-x0': [197, 768],
    'i-ln-pre': [197, 768], 'i-h-ln1': [197, 768], 'i-qkv': [197, 2304], 'i-scores': [12, 197, 197], 'i-attn': [12, 197, 197],
    'i-x-out': [197, 768], 'i-cls': [768], 'i-cls-ln': [768], 'i-emb': [512], 'i-emb-norm': [512],
    't-ids': [77], 't-tok': [77, 512], 't-x0': [77, 512], 't-h-ln1': [77, 512], 't-qkv': [77, 1536], 't-scores': [8, 77, 77],
    't-masked': [8, 77, 77], 't-attn': [8, 77, 77], 't-x-out': [77, 512], 't-ln-final': [77, 512], 't-eot': [512], 't-emb': [512],
    't-emb-norm': [512], 'img-batch': [32768, 512], 'txt-batch': [32768, 512], logits: [32768, 32768], loss: [1],
  };
  for (const [id, num] of Object.entries(want)) assert.deepStrictEqual(sh(id), num, id);
  assert.strictEqual(A.fmt.shape(r.tensors.logits, 'sym'), 'B×B');
  assert.strictEqual(A.fmt.shape(r.tensors['t-scores'], 'sym'), 'h×T×T');
  assert.strictEqual(r.tensors.logits.layout, 'mat');
  assert.ok(r.tensors.logits.batched && r.tensors['img-batch'].batched && !r.tensors['i-emb'].batched);
  for (const op of r.ops) {
    if (/^i-/.test(op.id)) assert.strictEqual(op.path[0], 'img-encoder', op.id);
    if (/^t-/.test(op.id)) assert.strictEqual(op.path[0], 'txt-encoder', op.id);
  }
  const p = (id) => r.ops.find((o) => o.id === id).path.join('>');
  assert.strictEqual(p('t-mask'), 'txt-encoder>enc-layer>mhsa>mask');
  assert.strictEqual(p('i-qkv'), 'img-encoder>enc-layer>mhsa>qkv');
  assert.strictEqual(p('i-ln-post'), 'img-encoder>ln-post');
  assert.strictEqual(p('t-pick-eot'), 'txt-encoder>pick-eot');
  assert.ok(!r.ops.some((o) => o.id === 'i-mask'), 'la torre de imagen es bidireccional');
  assert.strictEqual(r.ops.find((o) => o.id === 'i-qkv').repeat, 12);
  assert.strictEqual(p('similarity'), 'similarity');
  assert.strictEqual(p('temperature'), 'temperature');
  assert.strictEqual(p('loss'), 'loss');
  assert.deepStrictEqual(J(A.run('clip-vit-l14-336').tensors['i-x0'].num), [577, 1024]);
  assert.deepStrictEqual(J(A.run('clip-vit-l14').tensors['t-qkv'].num), [77, 2304]);
});

test('CLIP: el knob B solo cambia la parte conjunta; MACs por par (similitud B·E)', () => {
  const big = A.run('clip-vit-b16'), small = A.run('clip-vit-b16', { B: 8 }), one = A.run('clip-vit-b16', { B: 1 });
  assert.strictEqual(big.config.B, 32768);
  for (const id of big.order) {
    if (big.tensors[id].batched) continue;
    assert.deepStrictEqual(J(small.tensors[id].num), J(big.tensors[id].num), id);
  }
  assert.deepStrictEqual(J(small.tensors.logits.num), [8, 8]);
  assert.strictEqual(small.totals.params, big.totals.params);
  assert.strictEqual(small.totals.macs - one.totals.macs, 7 * 512);       // la fila crece con B
  const sim = big.ops.find((o) => o.id === 'similarity');
  assert.strictEqual(sim.macs, 32768 * 512);
  assert.strictEqual(sim.detail.batchMacs, 32768 * 32768 * 512);
  // PyTorch con batch B mide B × (total por par): ver crosscheck/expected/clip-*.json (batch_check)
  assert.strictEqual(4 * A.run('clip-vit-b16', { B: 4 }).totals.flops, 4 * 2 * (one.totals.macs - 512) + 2 * 16 * 512);
  assert.strictEqual(A.run('clip-vit-l14', { res: 336 }).totals.params, A.run('clip-vit-l14-336').totals.params);
  assert.strictEqual(A.run('clip-vit-b16', { P: 32 }).totals.macs, A.run('clip-vit-b32').totals.macs);
});

test('CLIP metrics: memoria de la matriz B×B, negativos por muestra, costo del lote', () => {
  const m = A.metrics('clip-vit-b16');
  assert.strictEqual(m.B, 32768);                                 // por defecto, el B de la config
  assert.strictEqual(m.negatives, 32767);
  assert.strictEqual(m.negativesPerSample, 32767);
  assert.strictEqual(m.logitsElements, 32768 * 32768);
  assert.strictEqual(m.logitsFp32Mem, 4294967296);
  assert.strictEqual(m.logitsBf16Mem, 2147483648);
  assert.strictEqual(m.logitsMem, m.logitsBf16Mem);
  assert.strictEqual(A.fmt.bytes(m.logitsFp32Mem), '4.29 GB');
  assert.strictEqual(m.logitsMacs, 32768 * 32768 * 512);
  assert.strictEqual(m.batchMacs, 32768 * A.run('clip-vit-b16').totals.macs);
  assert.ok(m.logitsMacsShare < 0.001, 'la matmul B×B es < 0.1 % del cómputo del lote');
  assert.strictEqual(m.kvCache, null);
  const s = A.metrics('clip-vit-b16', { B: 256, dtype: 'fp32' });
  assert.strictEqual(s.negatives, 255);
  assert.strictEqual(s.logitsMem, 256 * 256 * 4);
  // Las torres son por muestra (B = 1): el mayor tensor de scores es el de la imagen, sin × B.
  assert.strictEqual(m.attnMem, 12 * 197 * 197 * 2);
  assert.strictEqual(A.fmt.bytes(m.attnMem), '931.4 KB');
  assert.strictEqual(m.imgAttnMem, m.attnMem);
  assert.strictEqual(m.txtAttnMem, 8 * 77 * 77 * 2);
  assert.strictEqual(m.attnMemAllLayers, 12 * m.imgAttnMem + 12 * m.txtAttnMem);
  assert.strictEqual(s.attnMem, 12 * 197 * 197 * 4);               // no depende de B
  assert.strictEqual(s.attnMemBatch, 12 * 197 * 197 * 4 * 256);    // el lote entero, aparte
  const b32 = A.metrics('clip-vit-b32');
  assert.strictEqual(b32.imgAttnMem, 12 * 50 * 50 * 2);
  assert.strictEqual(b32.attnMem, b32.txtAttnMem);                 // en B/32 el mayor es el del texto
  assert.strictEqual(A.metrics('clip-vit-b16', { B: 8 }).actMem, m.actMem);   // por muestra
  assert.ok(A.metrics('clip-vit-b16', { B: 8 }).actMemBatch < m.actMemBatch);
});

// ================================================================ actMem (arreglo de la fase 1)
test('actMem: cada tensor guardado una vez, sin vistas, sin tablas de parámetros ni scores previos al softmax', () => {
  const N = 197, D = 768, h = 12, L = 12;
  const perLayer = N * D /* h-ln1 */ + 3 * N * D /* qkv */ + h * N * N /* attn */ + N * D /* z-heads */ + N * D /* o */ +
    N * D /* r1 */ + N * D /* h-ln2 */ + 4 * N * D /* u */ + 4 * N * D /* g */ + N * D /* f */ + N * D /* x-out */;
  const once = 224 * 224 * 3 /* x-img */ + 196 * D /* x-patch-grid */ + N * D /* x-cls-cat */ + N * D /* x0 */ + N * D /* x-ln */ + 1000;
  const m = A.metrics('vit-b16-224');
  assert.strictEqual(m.actMem, (once + L * perLayer) * 2);
  // no cuenta q/k/v (vistas de qkv), scores ni scores-scaled (temporales), e-pos (parámetro)
  assert.strictEqual(A.metrics('vit-b16-224', { B: 2, dtype: 'fp32' }).actMem, 2 * 2 * m.actMem);
  // Swin: las ventanas y los roll son vistas; CLIP: los tensores del lote no se multiplican por B
  const sw = A.metrics('swin-t-224');
  assert.ok(sw.actMem > 0);
  const c1 = A.metrics('clip-vit-b16', { B: 1 }), c2 = A.metrics('clip-vit-b16', { B: 2 });
  const joint = (B) => (2 * B * 512 + 2 * B * B + 1) * 2;          // img-batch, txt-batch, sims, logits, loss
  assert.strictEqual(c2.actMemBatch - joint(2), 2 * (c1.actMemBatch - joint(1)));
  // actMem de CLIP: las torres, una muestra (img-batch/txt-batch son vistas apiladas; sí cuentan sims, logits, loss)
  assert.strictEqual(c1.actMem, c1.actMemBatch - (2 * 1 * 1 + 1) * 2);
  assert.strictEqual(c2.actMem, c1.actMem);
});

test('Quantities: claves de Swin, CLIP y ResNet', () => {
  assert.strictEqual(Q.get('swin-t-224.params.total').text, '28,288,354');
  assert.strictEqual(Q.get('swin-t-224.tokens').text, '3,136');
  assert.strictEqual(Q.get('swin-t-224.tensor.s1-b1-win.shape').text, '64×49×96');
  assert.strictEqual(Q.get('swin-t-224.tensor.s1-b1-q.sym').text, 'nW×h×M²×d_h');
  assert.strictEqual(Q.get('swin-t-224.quantities.s1Windows').text, '64');
  assert.strictEqual(Q.get('swin-t-224.quantities.s4Windows').text, '1');
  assert.strictEqual(Q.get('swin-t-224.metrics.s1GlobalToWindow').text, '64');
  assert.strictEqual(Q.get('swin-t-224.metrics.s1ScoreMacs').text, '29,503,488');
  assert.strictEqual(Q.get('swin-t-224.metrics.s1GlobalAttnMem').text, '59.0 MB');
  assert.strictEqual(Q.get('swin-t-224.cfg.C').text, '96');
  assert.strictEqual(Q.get('swin-t-224.cfg.M').text, '7');
  assert.strictEqual(Q.get('swin-t-224.node.bias.params').text, '1,014');
  assert.strictEqual(Q.get('clip-vit-b16.cfg.E').text, '512');
  assert.strictEqual(Q.get('clip-vit-b16.cfg.Dt').text, '512');
  assert.strictEqual(Q.get('clip-vit-b16.cfg.T').text, '77');
  assert.strictEqual(Q.get('clip-vit-b16.cfg.B').text, '32,768');
  assert.strictEqual(Q.get('clip-vit-b16.metrics.negatives').text, '32,767');
  assert.strictEqual(Q.get('clip-vit-b16.metrics.logitsMem').text, '2.15 GB');
  assert.strictEqual(Q.get('clip-vit-b16.metrics.logitsFp32Mem').text, '4.29 GB');
  assert.strictEqual(Q.get('clip-vit-b16.tensor.logits.shape').text, '32768×32768');
  assert.strictEqual(Q.get('clip-vit-b16.node.img-encoder.params').text, '85,799,424');
  assert.strictEqual(Q.get('resnet50-224.tensor.c5.shape').text, '7×7×2048');
  for (const id of ['swin-t-224', 'clip-vit-b16', 'resnet50-224']) J(Q.keys(id)).forEach((k) => assert.ok(Q.get(id + '.' + k), id + '.' + k));
});

// ================================================================ Fase 2: etiquetas sin ambigüedad (práctica)
test('Swin y CLIP: etiqueta + símbolo de cada tensor identifican una sola forma; op.where nombra stage/bloque o torre', () => {
  for (const id of ['swin-t-224', 'swin-s-224', 'swin-b-384', 'clip-vit-b16', 'clip-vit-l14']) {
    const r = A.run(id);
    const by = {};
    for (const tid of r.order) {
      const t = r.tensors[tid];
      const k = t.label + '|' + String(t.tex).split('=')[0].trim();
      (by[k] = by[k] || new Set()).add(t.num.join('×'));
    }
    for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
  }
  const s = A.run('swin-t-224');
  assert.strictEqual(s.tensors['s2-b1-qkv'].label, 'Stage 2 · bloque 1 (W-MSA) · Q, K y V concatenados');
  assert.strictEqual(JSON.stringify(s.ops.find((o) => o.id === 's3-b2-qkv').where), JSON.stringify(['Stage 3', 'bloque 2 (SW-MSA)']));
  assert.ok(!/\(\(|\)\)/.test(s.ops.find((o) => o.id === 's4-b2-ln1').label), 'sin paréntesis dobles');
  const c = A.run('clip-vit-b16');
  assert.strictEqual(c.tensors['i-q'].label, 'Torre de imagen · Queries por cabeza');
  assert.strictEqual(c.tensors['t-q'].label, 'Torre de texto · Queries por cabeza');
  assert.strictEqual(JSON.stringify(c.ops.find((o) => o.id === 't-qkv').where), JSON.stringify(['Torre de texto']));
  assert.strictEqual(A.run('vit-b16-224').tensors.q.label, 'Queries por cabeza');   // ViT sin cambios
  assert.strictEqual(A.run('vit-b16-224').ops.find((o) => o.id === 'qkv').where, undefined);
});
