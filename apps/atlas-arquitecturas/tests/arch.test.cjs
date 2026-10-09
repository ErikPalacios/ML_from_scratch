// Pruebas del calculador ATLAS.Arch (SPEC §6, §9.2). Cuentas a mano en configs diminutas,
// anclas de ViT-B/16 y reglas prácticas que aparecen en la prosa.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['js/arch/primitives.js', 'js/arch/transformer.js', 'js/arch/vit.js', 'js/arch/resnet.js', 'js/arch/swin.js', 'js/arch/clip.js', 'js/arch/detr.js', 'js/core/quantities.js'];
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
  assert.deepStrictEqual(J(A.models()).sort(), ['clip', 'deformable-detr', 'detr', 'resnet', 'swin', 'transformer', 'vit']);
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

// ================================================================ Fase 3: DETR y Deformable DETR
test('F3 frozen_batchnorm2d, group_norm, sigmoid y conv_bn/bottleneck con frozenBN (sin la opción: igual que la fase 2)', () => {
  const x = S(['H', 'W', 'C'], [4, 4, 8], 'grid');
  const f = A.frozen_batchnorm2d(x);
  assert.strictEqual(f.params, 0);
  assert.strictEqual(f.detail.buffers, 4 * 8);                // γ, β, media y varianza: buffers
  assert.strictEqual(f.other, 4 * 4 * 8 * 2);
  assert.strictEqual(A.group_norm(x, { groups: 4 }).params, 16);
  assert.strictEqual(A.sigmoid(S(['Q', '4'], [3, 4])).other, 12 * 4);
  const img = S(['H', 'W', 'C'], [8, 8, 3], 'grid');
  const a = A.conv_bn(img, { k: 3, p: 1, cout: 4 }), b = A.conv_bn(img, { k: 3, p: 1, cout: 4, frozenBN: true });
  assert.strictEqual(a.params, 9 * 3 * 4 + 8);
  assert.strictEqual(b.params, 9 * 3 * 4);
  assert.strictEqual(a.macs, b.macs);
  assert.strictEqual(a.detail.frozenBN, undefined);          // sin la opción el resultado no cambia
  const y = S(['H', 'W', 'C'], [8, 8, 16], 'grid');
  const n = A.bottleneck(y, { width: 4, cout: 16, stride: 2, project: true });
  const fz = A.bottleneck(y, { width: 4, cout: 16, stride: 2, project: true, frozenBN: true });
  assert.strictEqual(n.params - fz.params, 2 * (4 + 4 + 16 + 16));   // γ, β de las 4 BN
  assert.strictEqual(n.macs, fz.macs);
  assert.strictEqual(n.paramFormula, 'C_{in}w + 9w^2 + 4w^2 + 2(6w) + 4w\\,C_{in} + 8w');
});

test('F3 PE seno/coseno, niveles, queries, ceros, split_qkv_heads con largos distintos y puntos de referencia', () => {
  const p = A.sine_pos_encoding({ H: 2, W: 3, D: 8 });
  assert.deepStrictEqual(J(p.out.num), [6, 8]);
  assert.strictEqual(p.params, 0);
  assert.ok(p.detail.buffer);
  assert.strictEqual(p.detail.perAxis, 4);
  assert.deepStrictEqual(J(A.sine_pos_encoding({ levels: [[2, 3], [1, 2]], D: 8 }).out.num), [8, 8]);
  assert.strictEqual(A.level_embed({ L: 4, D: 8 }).params, 32);
  const g1 = S(['h', 'w', 'D'], [2, 3, 8], 'grid'), g2 = S(['h', 'w', 'D'], [1, 2, 8], 'grid');
  assert.deepStrictEqual(J(A.flatten_levels([g1, g2]).out.num), [8, 8]);
  const lq = A.learned_queries({ Q: 5, D: 8 });
  assert.strictEqual(lq.params, 40);
  assert.strictEqual(lq.out.mod, 'qry');
  const ls = A.learned_queries({ Q: 5, D: 8, split: true });
  assert.strictEqual(ls.params, 80);
  assert.strictEqual(ls.out.length, 2);
  assert.strictEqual(A.zeros_init({ rows: 5, D: 8 }).params, 0);
  const q = S(['Q', 'D'], [3, 8]), k = S(['N', 'D'], [5, 8]);
  const sp = A.split_qkv_heads(q, k, k, { h: 2 });
  assert.deepStrictEqual(J(sp.out.map((t) => t.num)), [[2, 3, 4], [2, 5, 4], [2, 5, 4]]);
  assert.throws(() => A.split_qkv_heads(q, k, q, { h: 2 }), /mismo largo/);
  assert.throws(() => A.split_qkv_heads(q, k, k, { h: 3 }), /divisible/);
  assert.deepStrictEqual(J(A.reference_points({ levels: [[2, 3], [1, 2]] }).out.num), [8, 2, 2]);
});

test('F3 multihead_attention y cross_attention: 4D² + 4D; 2N_qD² + 2N_kD² + 2N_qN_kD; posición solo en Q y K', () => {
  const x = S(['N', 'D'], [5, 4]);
  const self = A.multihead_attention(x, x, x, { h: 2 });
  const ref = A.mhsa(x, { h: 2 });
  assert.strictEqual(self.params, ref.params);
  assert.strictEqual(self.macs, ref.macs);
  assert.strictEqual(self.macFormula, ref.macFormula);
  const q = S(['Q', 'D'], [3, 4]);
  const c = A.cross_attention(q, x, { h: 2 });
  assert.strictEqual(c.prim, 'cross_attention');
  assert.strictEqual(c.params, 4 * (16 + 4));
  assert.strictEqual(c.macs, 2 * 3 * 16 + 2 * 5 * 16 + 2 * 3 * 5 * 4);   // 376
  assert.deepStrictEqual(J(c.out.num), [3, 4]);
  assert.strictEqual(c.macFormula, '2\\,Q\\,D^2 + 2\\,N\\,D^2 + 2\\,Q\\,N\\,D');
  // scores h×Q×N
  const sc = c.detail.parts.find((p) => p.prim === 'attention_scores');
  assert.strictEqual(sc.macs, 2 * 3 * 5 * 2);
  // posición: solo sumas ("otros"), no cambia parámetros ni MACs; q = k = x + pos se suma una vez
  const pos = S(['N', 'D'], [5, 4]);
  const sp = A.multihead_attention(x, x, x, { h: 2, qPos: pos, kPos: pos });
  assert.strictEqual(sp.macs, self.macs);
  assert.strictEqual(sp.other - self.other, 5 * 4);
  assert.ok(sp.detail.posQ && sp.detail.posK && !sp.detail.posV);
  const cp = A.cross_attention(q, x, { h: 2, qPos: S(['Q', 'D'], [3, 4]), kPos: pos });
  assert.strictEqual(cp.other - c.other, 3 * 4 + 5 * 4);
});

test('F3 deformable_attention: D·3hLK + 3hLK + 2D² + 2D parámetros, MACs lineales en tokens (sin N_q·N_v)', () => {
  const q = S(['Q', 'D'], [3, 4]), v = S(['N', 'D'], [7, 4]);
  const d = A.deformable_attention(q, v, { h: 2, L: 2, K: 1 });   // hLK = 4
  assert.strictEqual(d.params, 4 * 12 + 12 + 2 * 16 + 2 * 4);     // 100
  // value 7·16 + offsets 3·4·8 + pesos 3·4·4 + muestreo 4·2·3·2·1·2 + suma 2·3·2·2 + salida 3·16
  assert.strictEqual(d.macs, 112 + 96 + 48 + 96 + 24 + 48);       // 424
  assert.strictEqual(d.detail.samplingMacs, 96 + 24);             // 5·N_q·hLK·d_h
  const smp = A.deform_sample(A.linear(v, { dout: 4 }).out, S(['Q', 'hLK·2'], [3, 8]), null, { h: 2, L: 2, K: 1 });
  assert.deepStrictEqual(J(smp.out.num), [2, 3, 2, 2]);
  assert.strictEqual(smp.macArith, '4·2·3·2·1·2 = 96');
  assert.throws(() => A.deform_sample(v, S(['Q', 'x'], [3, 6]), null, { h: 2, L: 2, K: 1 }), /h·L·K·2/);
  // duplicar N_v solo duplica la proyección del value (no hay término N_q·N_v)
  const d2 = A.deformable_attention(q, S(['N', 'D'], [14, 4]), { h: 2, L: 2, K: 1 });
  assert.strictEqual(d2.macs - d.macs, 7 * 16);
  // duplicar N_q (= N_v, encoder) duplica todo: lineal
  const e1 = A.deformable_attention(v, v, { h: 2, L: 2, K: 1 }), e2 = A.deformable_attention(S(['N', 'D'], [14, 4]), S(['N', 'D'], [14, 4]), { h: 2, L: 2, K: 1 });
  assert.strictEqual(e2.macs, 2 * e1.macs);
  assert.strictEqual(e1.detail.denseScoreMacs, 2 * 7 * 7 * 4);
});

test('F3 box_mlp, ref_offset, matching húngaro y pérdida: Q×G, G×2, escalar, sin parámetros ni MACs', () => {
  const hs = S(['Q', 'D'], [5, 4]);
  const b = A.box_mlp(hs);
  assert.strictEqual(b.params, 2 * (16 + 4) + 16 + 4);
  assert.strictEqual(b.macs, 5 * (2 * 16 + 16));
  assert.deepStrictEqual(J(b.out.num), [5, 4]);
  assert.strictEqual(A.ref_offset(S(['Q', '4'], [5, 4]), S(['Q', '2'], [5, 2])).params, 0);
  const lg = S(['Q', 'K+1'], [5, 3]), bx = S(['Q', '4'], [5, 4]), gl = A.shape(['G'], [2], null, 'vec'), gb = S(['G', '4'], [2, 4]);
  const c = A.hungarian_cost(lg, bx, gl, gb, { wCls: 1, wL1: 5, wGiou: 2 });
  assert.deepStrictEqual(J(c.out.num), [5, 2]);
  assert.deepStrictEqual(J(c.out.sym), ['Q', 'G']);
  assert.strictEqual(c.params + c.macs, 0);
  const m = A.hungarian_match(c.out);
  assert.deepStrictEqual(J(m.out.num), [2, 2]);
  assert.strictEqual(m.detail.unmatched, 3);
  assert.deepStrictEqual(J(A.set_prediction_loss(lg, bx, m.out, gl, gb, {}).out.num), [1]);
  const ids = J(A.primitives()).map((p) => p.id);
  for (const id of ['frozen_batchnorm2d', 'sine_pos_encoding', 'learned_queries', 'split_qkv_heads', 'multihead_attention', 'cross_attention',
    'deform_sample', 'deform_weighted_sum', 'deformable_attention', 'box_mlp', 'hungarian_cost', 'hungarian_match', 'set_prediction_loss']) {
    assert.ok(ids.includes(id), id);
    assert.strictEqual(typeof A[id], 'function', id);
  }
});

test('DETR-R50 @800×1216: 41,524,768 parámetros (HF = oficial, FrozenBN) y 91,932,364,800 MACs', () => {
  const r = A.run('detr-r50-800x1216');
  const t = r.totals, n = t.byNode, D = 256, Dm = 2048;
  assert.strictEqual(t.params, 41524768);
  assert.strictEqual(t.macs, 91932364800);
  // backbone: solo las convs (25,557,032 de torchvision − fc 2,049,000 − γ/β 53,120)
  assert.strictEqual(n.backbone.params, 25557032 - 2049000 - 53120);
  assert.strictEqual(n['input-proj'].params, 2048 * D + D);
  assert.strictEqual(n.queries.params, 100 * D);
  assert.strictEqual(n['class-head'].params, D * 92 + 92);
  assert.strictEqual(n['box-head'].params, 2 * (D * D + D) + 4 * D + 4);
  assert.strictEqual(n['dec-norm'].params, 2 * D);
  // capa del encoder (post-LN): 4D² + 4D + 2D·D_mlp + D_mlp + D + 2·2D
  const enc = 4 * D * D + 4 * D + 2 * D * Dm + Dm + D + 4 * D;
  assert.strictEqual(enc, 1315072);
  assert.strictEqual(n.encoder.params, 6 * enc);
  // capa del decoder: dos atenciones + FFN + 3 LayerNorm
  const dec = 2 * (4 * D * D + 4 * D) + 2 * D * Dm + Dm + D + 6 * D;
  assert.strictEqual(n.decoder.params, 6 * dec);
  const q = r.quantities;
  assert.strictEqual(q.trainableParams, 41302368);            // lo que imprime el código oficial (conv1 y layer1 congelados)
  assert.strictEqual(q.frozenParamsOfficial, 9408 + 212992);
  assert.strictEqual(q.bnBuffers, 4 * 26560);                  // = buffers_total de HF
  assert.strictEqual(q.paramsWithTrainableBN, 41524768 + 53120);
  assert.strictEqual(q.auxHeadsMacs, 5 * (100 * D * 92 + 100 * (2 * D * D + 4 * D)));
  // flag frozenBN = false: γ y β como parámetros (+53,120, el conteo de torchvision)
  const def = A.model('detr');
  const cfg = def.resolve(Object.assign({}, def.configs['detr-r50-800x1216'], { frozenBN: false }));
  const ops = def.build(cfg, A)._data().ops;
  assert.strictEqual(ops.reduce((s, o) => s + o.params * o.repeat, 0), 41524768 + 53120);
  // 640×640: mismos parámetros (la PE es fija), 400 tokens
  const s = A.run('detr-r50-640');
  assert.strictEqual(s.totals.params, 41524768);
  assert.strictEqual(s.quantities.tokens, 400);
  assert.strictEqual(s.totals.macs, 38560153600);
});

test('DETR: ids y formas de SPEC §15.1 (tensores, nodos y paths)', () => {
  const r = A.run('detr-r50-800x1216');
  const sh = (id) => r.tensors[id].num.join('×');
  const want = { 'x-img': '800×1216×3', c5: '25×38×2048', proj: '25×38×256', 'memory-in': '950×256', pos: '950×256',
    'e-q': '8×950×32', 'e-k': '8×950×32', 'e-v': '8×950×32', 'e-scores': '8×950×950', 'e-attn': '8×950×950', memory: '950×256',
    'query-pos': '100×256', tgt0: '100×256', 'd-self-scores': '8×100×100', 'd-cross-scores': '8×100×950', 'd-cross-q': '8×100×32',
    'd-cross-k': '8×950×32', 'd-cross-attn': '8×100×950', hs: '100×256', logits: '100×92', boxes: '100×4', cost: '100×7',
    assignment: '7×2', loss: '1' };
  for (const [id, s] of Object.entries(want)) assert.strictEqual(sh(id), s, id);
  assert.deepStrictEqual(J(r.tensors['d-cross-scores'].sym), ['h', 'Q', 'N']);
  assert.deepStrictEqual(J(r.tensors.cost.sym), ['Q', 'G']);
  assert.deepStrictEqual(J(r.tensors.logits.sym), ['Q', 'K+1']);
  assert.strictEqual(r.tensors['query-pos'].mod, 'qry');
  const n = r.totals.byNode, p = r.totals.byPath;
  for (const id of ['backbone', 'input-proj', 'pos-enc', 'flatten', 'encoder', 'enc-layer', 'queries', 'decoder', 'dec-layer', 'dec-norm',
    'class-head', 'box-head', 'matching', 'loss']) assert.ok(n[id], 'nodo ' + id);
  for (const id of ['self-attn', 'res1', 'ln1', 'ffn', 'res2', 'ln2', 'add-pos']) assert.ok(p['encoder>enc-layer>' + id], 'enc-layer › ' + id);
  for (const id of ['self-attn', 'res1', 'ln1', 'cross-attn', 'res2', 'ln2', 'ffn', 'res3', 'ln3', 'add-qpos']) assert.ok(p['decoder>dec-layer>' + id], 'dec-layer › ' + id);
  for (const at of ['encoder>enc-layer>self-attn', 'decoder>dec-layer>self-attn', 'decoder>dec-layer>cross-attn']) {
    for (const id of ['q-proj', 'k-proj', 'v-proj', 'split', 'scores', 'scale', 'softmax', 'weighted-sum', 'merge', 'proj']) assert.ok(p[at + '>' + id], at + ' › ' + id);
  }
  const op = (id) => r.ops.find((o) => o.id === id);
  // la posición entra a Q y K, nunca a V; en la cross-attention Q viene de las queries y K/V de la memoria
  assert.deepStrictEqual(J(op('e-q-proj').in), ['e-qk-in']);
  assert.deepStrictEqual(J(op('e-k-proj').in), ['e-qk-in']);
  assert.deepStrictEqual(J(op('e-v-proj').in), ['memory-in']);
  assert.deepStrictEqual(J(op('e-add-pos').in), ['memory-in', 'pos']);
  assert.deepStrictEqual(J(op('d-self-v-proj').in), ['tgt0']);
  assert.deepStrictEqual(J(op('d-cross-q-proj').in), ['d-cross-q-in']);
  assert.deepStrictEqual(J(op('d-cross-add-qpos').in), ['d-ln1', 'query-pos']);
  assert.deepStrictEqual(J(op('d-cross-k-proj').in), ['d-cross-k-in']);
  assert.deepStrictEqual(J(op('d-cross-add-pos').in), ['memory', 'pos']);
  assert.deepStrictEqual(J(op('d-cross-v-proj').in), ['memory']);
  assert.strictEqual(op('e-scores').repeat, 6);
  assert.strictEqual(op('d-cross-scores').repeat, 6);
  assert.strictEqual(op('class-head').repeat, 1);
  assert.deepStrictEqual(J(op('e-q-proj').path), ['encoder', 'enc-layer', 'self-attn', 'q-proj']);
  assert.deepStrictEqual(J(op('d-cross-k-proj').path), ['decoder', 'dec-layer', 'cross-attn', 'k-proj']);
  assert.deepStrictEqual(J(op('match-cost').path), ['matching']);
  // post-LN: la LayerNorm va DESPUÉS de cada residual
  assert.deepStrictEqual(J(op('e-ln1').in), ['e-r1']);
  assert.deepStrictEqual(J(op('e-ln2').out), ['memory']);
  assert.deepStrictEqual(J(op('d-ln3').out), ['d-out']);
  assert.deepStrictEqual(J(op('dec-norm').in), ['d-out']);
  // sin parámetros: PE, ceros, matching y pérdida
  for (const id of ['pos-enc', 'tgt-init', 'match-cost', 'match-assign', 'loss']) assert.strictEqual(op(id).params + op(id).macs, 0, id);
  assert.deepStrictEqual(J(r.ops.find((o) => o.id === 'l2-b1').where), ['Backbone (ResNet-50)']);
  assert.deepStrictEqual(J(op('d-cross-scores').where), ['Decoder', 'cross-attention']);
  assert.strictEqual(r.tensors['d-cross-q'].label, 'Decoder · cross-attention · Queries por cabeza');
  assert.strictEqual(r.tensors['e-q'].label, 'Encoder · self-attention · Queries por cabeza');
});

test('DETR metrics: scores del encoder vs cross/self del decoder, memoria 950×950 y escala con la resolución', () => {
  const m = A.metrics('detr-r50-800x1216');
  const N = 950, Q = 100, D = 256;
  assert.strictEqual(m.encScoreMacsLayer, 2 * N * N * D);
  assert.strictEqual(m.decCrossScoreMacsLayer, 2 * Q * N * D);
  assert.strictEqual(m.decSelfScoreMacsLayer, 2 * Q * Q * D);
  assert.strictEqual(m.encScoreMacs + m.decCrossScoreMacs + m.decSelfScoreMacs, m.scoreMacs);   // = los MACs de QKᵀ + A·V del grafo
  assert.strictEqual(m.encToCrossScore, N / Q);
  assert.strictEqual(m.encAttnMem, 8 * N * N * 2);              // 14.44 MB en bf16, una capa
  assert.strictEqual(m.attnMem, m.encAttnMem);                  // el mayor tensor de scores es el del encoder
  assert.strictEqual(m.encAttnFp32Mem, 8 * N * N * 4);
  assert.strictEqual(m.decCrossAttnMem, 8 * Q * N * 2);
  assert.strictEqual(m.backboneMacs + m.inputProjMacs + m.encoderMacs + m.decoderMacs + m.headMacs, m.macs);
  // encoder ∝ (HW/32²)²: duplicar el lado → tokens ×4, scores ×16
  const s = (H, W) => m.scaling.find((x) => x.H === H && x.W === W);
  assert.strictEqual(s(1024, 1024).tokens, 4 * s(512, 512).tokens);
  assert.strictEqual(s(1024, 1024).encScoreMacs, 16 * s(512, 512).encScoreMacs);
  assert.strictEqual(s(1024, 1024).decCrossScoreMacs, 4 * s(512, 512).decCrossScoreMacs);
  assert.strictEqual(s(800, 1216).macs, m.macs);
  assert.strictEqual(m.encScoreMacs2x, 16 * m.encScoreMacs);
  // knobs
  assert.strictEqual(A.run('detr-r50-800x1216', { res: 1024 }).quantities.tokens, 1024);
  assert.strictEqual(A.run('detr-r50-800x1216', { Q: 300 }).totals.byNode.queries.params, 300 * D);
  assert.strictEqual(A.run('detr-r50-800x1216', { G: 20 }).tensors.cost.num.join('×'), '100×20');
  assert.throws(() => A.run('detr-r50-800x1216', { H: 810 }), /múltiplo de 32/);
  assert.throws(() => A.run('detr-r50-800x1216', { G: 200 }), /G ≤ Q/);
  assert.strictEqual(A.run('detr-r50-640', { res: 800 }).label, 'DETR-R50 @ 800×800');
});

test('Deformable DETR-R50: 40,069,665 parámetros, 4 niveles (20,197 tokens) y 187,717,110,784 MACs', () => {
  const r = A.run('deformable-detr-r50');
  const t = r.totals, n = t.byNode, q = r.quantities, D = 256;
  assert.strictEqual(t.params, 40069665);
  assert.strictEqual(t.macs, 187717110784);
  assert.deepStrictEqual([q.l1Tokens, q.l2Tokens, q.l3Tokens, q.l4Tokens], [15200, 3800, 950, 247]);
  assert.strictEqual(q.tokens, 20197);
  assert.strictEqual(r.tensors['src-l4'].num.join('×'), '13×19×256');   // conv 3×3 s2 sobre C5 (25×38)
  assert.strictEqual(n['input-proj'].params, (512 + 1024 + 2048) * D + 3 * D + 9 * 2048 * D + D + 4 * 2 * D);
  assert.strictEqual(q.msdaParams, D * 3 * 128 + 3 * 128 + 2 * D * D + 2 * D);   // 230,272
  assert.strictEqual(n.queries.params, 300 * 2 * D);
  assert.strictEqual(n['class-head'].params, D * 91 + 91);
  assert.strictEqual(q.trainableParams, 40069665 - 222400);
  const sh = (id) => r.tensors[id].num.join('×');
  assert.strictEqual(sh('e-offsets'), '20197×256');
  assert.strictEqual(sh('e-aw'), '20197×128');
  assert.strictEqual(sh('e-sampled'), '8×20197×16×32');
  assert.strictEqual(sh('e-ref'), '20197×4×2');
  assert.strictEqual(sh('d-cross-sampled'), '8×300×16×32');
  assert.strictEqual(sh('d-cross-value'), '20197×256');
  assert.strictEqual(sh('d-self-scores'), '8×300×300');
  assert.strictEqual(sh('logits'), '300×91');
  // ninguna atención densa en el encoder ni en la cross-attention: solo la self-attention del decoder tiene scores
  assert.deepStrictEqual(J(r.ops.filter((o) => o.prim === 'attention_scores').map((o) => o.id)), ['d-self-scores']);
  const m = A.metrics('deformable-detr-r50');
  assert.strictEqual(m.encSamplingMacsLayer, 5 * 20197 * 128 * 32);
  assert.strictEqual(m.samplingMacs, t.byPrim.deform_sample.macs + t.byPrim.deform_weighted_sum.macs);
  assert.strictEqual(m.denseEncAttnMem, 8 * 20197 * 20197 * 2);  // 6.53 GB por capa si fuera densa
  assert.strictEqual(m.denseEncScoreMacsLayer, 2 * 20197 * 20197 * D);
  assert.strictEqual(m.crossoverN, null);
  // lineal en tokens: el muestreo del encoder escala como N
  const s1 = m.scaling.find((x) => x.H === 512), s2 = m.scaling.find((x) => x.H === 1024 && x.W === 1024);
  assert.strictEqual(s2.encSamplingMacs / s1.encSamplingMacs, s2.tokens / s1.tokens);
  assert.ok(s2.denseEncScoreMacs / s1.denseEncScoreMacs > 15);
  assert.strictEqual(A.run('deformable-detr-r50', { points: 8 }).quantities.samples, 8 * 4 * 8);
});

test('DETR y Deformable DETR: etiqueta + símbolo identifican una forma; Quantities resuelve todas sus claves', () => {
  for (const id of ['detr-r50-800x1216', 'detr-r50-640', 'deformable-detr-r50']) {
    const r = A.run(id);
    const by = {};
    for (const tid of r.order) {
      const t = r.tensors[tid];
      const k = t.label + '|' + String(t.tex).split('=')[0].trim();
      (by[k] = by[k] || new Set()).add(t.num.join('×'));
    }
    for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
    J(Q.keys(id)).forEach((k) => assert.ok(Q.get(id + '.' + k), id + '.' + k));
  }
  assert.strictEqual(Q.get('detr-r50-800x1216.params.total').text, '41,524,768');
  assert.strictEqual(Q.get('detr-r50-800x1216.tensor.d-cross-scores.shape').text, '8×100×950');
  assert.strictEqual(Q.get('detr-r50-800x1216.tensor.memory-in.sym').text, 'N×D');
  assert.strictEqual(Q.get('detr-r50-800x1216.metrics.encAttnMem').text, '14.4 MB');
  assert.strictEqual(Q.get('detr-r50-800x1216.quantities.trainableParams').text, '41,302,368');
  assert.strictEqual(Q.get('deformable-detr-r50.metrics.denseEncAttnMem').text, '6.53 GB');
  assert.strictEqual(Q.get('deformable-detr-r50.tokens').text, '20,197');
  assert.strictEqual(A.canonical('detr'), 'detr-r50-800x1216');
  assert.strictEqual(A.canonical('deformable-detr'), 'deformable-detr-r50');
});

// ---------------------------------------------------------------- fase 4 (Grounding DINO, YOLO-World, YOLOv8)
// Contexto propio con los modelos de la fase 4 (el de arriba no los carga: su lista de modelos queda fija).
const ATLAS4 = (function () {
  const ctx = vm.createContext({});
  for (const f of FILES.filter((x) => x !== 'js/core/quantities.js').concat(['js/arch/grounding-dino.js', 'js/arch/yolo-world.js', 'js/core/quantities.js'])) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('ATLAS', ctx);
})();
const A4 = ATLAS4.Arch, Q4 = ATLAS4.Quantities;
const G = (sym, num) => A4.shape(sym, num, 'img', 'grid');
const Sq = (sym, num) => A4.shape(sym, num, 'txt', 'seq');

test('F4 los modelos nuevos no cambian ningún resultado de las fases 1–3', () => {
  for (const c of A.configs()) {
    const a = A.run(c.id).totals, b = A4.run(c.id).totals;
    assert.deepStrictEqual([b.params, b.macs, b.other], [a.params, a.macs, a.other], c.id);
  }
  assert.deepStrictEqual(J(A4.models()).sort(), ['clip', 'deformable-detr', 'detr', 'grounding-dino', 'resnet', 'swin', 'transformer', 'vit', 'yolo-world', 'yolov8']);
  assert.deepStrictEqual([A4.canonical('grounding-dino'), A4.canonical('yolo-world'), A4.canonical('yolov8')], ['grounding-dino-t', 'yolo-world-l-640', 'yolov8l-640']);
  // '·' dentro de un símbolo → \cdot en LaTeX; hLK·2 sigue por su tabla
  assert.strictEqual(A4.fmt.shapeTex(A4.shape(['H/8·W/8', 'V'], [6400, 80])), '(H/8\\cdot W/8)\\times V');
  assert.strictEqual(A4.fmt.shapeTex(A4.shape(['Q', 'hLK·2'], [3, 8])), 'Q\\times hLK\\cdot 2');
});

test('F4 primitivas de YOLO: SiLU, upsample, concat/split de canales, Conv-BN-SiLU, bottleneck, C2f y SPPF', () => {
  const x = G(['H', 'W', 'C'], [4, 4, 8]);
  assert.strictEqual(A4.silu(x).other, 4 * 4 * 8 * 4);
  const u = A4.upsample_nearest(x, { outSym: ['2H', '2W'] });
  assert.deepStrictEqual(J(u.out.num), [8, 8, 8]);
  assert.strictEqual(u.params + u.macs, 0);
  const cc = A4.concat_channels([x, G(['H', 'W', 'c'], [4, 4, 3])], { mult: [1, 2] });
  assert.deepStrictEqual(J(cc.out.num), [4, 4, 14]);
  assert.throws(() => A4.concat_channels([x, G(['h', 'w', 'C'], [2, 2, 8])]), /distinto tamaño/);
  const sp = A4.split_channels(x, { parts: 2 });
  assert.deepStrictEqual(J(sp.out.map((t) => t.num)), [[4, 4, 4], [4, 4, 4]]);
  const cb = A4.conv_bn_act(x, { k: 3, cout: 6 });
  assert.strictEqual(cb.params, 9 * 8 * 6 + 2 * 6);              // conv sin sesgo + γ, β
  assert.strictEqual(cb.macs, 4 * 4 * 6 * 9 * 8);
  assert.deepStrictEqual(J(cb.out.num), [4, 4, 6]);                // padding k/2
  assert.deepStrictEqual(J(A4.conv_bn_act(x, { k: 3, s: 2, cout: 6 }).out.num), [2, 2, 6]);
  assert.strictEqual(A4.conv_bn_act(x, { k: 1, cout: 6, act: 'none' }).detail.parts.length, 2);
  const b = A4.csp_bottleneck(x, { shortcut: true });
  assert.strictEqual(b.params, 18 * 64 + 4 * 8);                   // 18C² + 4C
  assert.strictEqual(b.macs, 18 * 16 * 64);
  assert.strictEqual(A4.csp_bottleneck(x, { shortcut: false }).params, b.params);
  // C2f(16 → 16, n = 2): cv1 16·16 + 32 · 2 bottlenecks (8 canales) · cv2 (2+2)·8 → 16
  const y = G(['H', 'W', 'C'], [8, 8, 16]);
  const c = A4.c2f(y, { cout: 16, n: 2, shortcut: true });
  assert.strictEqual(c.params, (16 * 16 + 32) + 2 * (18 * 64 + 32) + (32 * 16 + 32));
  assert.strictEqual(c.macs, 64 * (16 * 16 + 2 * 18 * 64 + 32 * 16));
  assert.deepStrictEqual(J(c.out.num), [8, 8, 16]);
  // SPPF(16 → 16): cv1 16 → 8 (BN), 3 max-pool 5×5, concat 32, cv2 32 → 16
  const s = A4.sppf(y, { cout: 16 });
  assert.strictEqual(s.params, (16 * 8 + 16) + (32 * 16 + 32));
  assert.strictEqual(s.macs, 64 * (16 * 8 + 32 * 16));
  assert.deepStrictEqual(J(s.detail.pools), [5, 9, 13]);
});

test('F4 primitivas de YOLO-World: max-sigmoid, T-CSPLayer, image-pooling attention, similitud región-texto, DFL', () => {
  const x = G(['H', 'W', 'c'], [4, 4, 8]), voc = Sq(['V', '512'], [5, 512]);
  const g = A4.text_guided_scores(x, Sq(['V', '8'], [5, 8]), { nh: 2 });
  assert.deepStrictEqual(J(g.out.num), [2, 16, 5]);
  assert.strictEqual(g.macs, 16 * 5 * 8);                          // H·W·V·E
  assert.throws(() => A4.text_guided_scores(x, Sq(['V', '6'], [5, 6]), { nh: 2 }), /canales/);
  assert.deepStrictEqual(J(A4.max_over_text(g.out).out.num), [2, 16]);
  assert.strictEqual(A4.maxsig_gate(A4.max_over_text(g.out).out, { nh: 2 }).params, 2);
  assert.deepStrictEqual(J(A4.head_modulate(x, A4.shape(['2', 'HW'], [2, 16]), { nh: 2 }).out.num), [4, 4, 8]);
  // max-sigmoid con C = E (sin conv de embedding): Linear 512 → 8 + n_h + conv 3×3 (8 → 8, BN)
  const ms = A4.max_sigmoid_attn(x, voc, { nh: 2, ec: 8 });
  assert.strictEqual(ms.params, (512 * 8 + 8) + 2 + (9 * 64 + 16));
  assert.strictEqual(ms.macs, 5 * 512 * 8 + 16 * 5 * 8 + 16 * 9 * 64);
  assert.strictEqual(A4.max_sigmoid_attn(x, voc, { nh: 2, ec: 4 }).detail.embedConv, true);
  // T-CSPLayer(16 → 16, n = 1, E = 8): C2f + c·C_out extra en cv2 + max-sigmoid
  const y = G(['H', 'W', 'C'], [4, 4, 16]);
  const t = A4.t_csp_layer(y, voc, { cout: 16, n: 1, ec: 8, nh: 2 });
  const c2 = A4.c2f(y, { cout: 16, n: 1, shortcut: false });
  assert.strictEqual(t.params - c2.params, 8 * 16 + ms.params);
  assert.strictEqual(t.macs - c2.macs, 16 * 8 * 16 + ms.macs);
  assert.deepStrictEqual(J(t.inputs.map((z) => z.num)), [[4, 4, 16], [5, 512]]);
  // image-pooling attention: 2 niveles → 18 tokens; q de 512 → E, k y v E → E, salida E → 512
  const f1 = G(['h', 'w', '8'], [6, 6, 8]), f2 = G(['h', 'w', '16'], [3, 3, 16]);
  const ip = A4.image_pooling_attn([f1, f2], voc, { ec: 8, nh: 2, k: 3 });
  assert.strictEqual(ip.detail.tokens, 18);
  assert.strictEqual(ip.params, (8 * 8 + 8) + (16 * 8 + 8) + (2 * 512 + 512 * 8 + 8) + 2 * (2 * 8 + 64 + 8) + (8 * 512 + 512));
  assert.strictEqual(ip.macs, 36 * 8 * 8 + 9 * 16 * 8 + 5 * 512 * 8 + 2 * 18 * 64 + 2 * 5 * 18 * 8 + 5 * 8 * 512);
  assert.deepStrictEqual(J(ip.out.num), [5, 512]);
  // similitud región-texto (coseno) y escala/sesgo de la ContrastiveHead
  const rs = A4.region_text_similarity(G(['h', 'w', 'E'], [2, 3, 4]), Sq(['V', 'E'], [5, 4]));
  assert.deepStrictEqual(J(rs.out.num), [6, 5]);
  assert.strictEqual(rs.macs, 6 * 5 * 4);
  assert.strictEqual(A4.scale_bias(rs.out).params, 2);
  // DFL: 3 niveles con 4R canales → A×4, R pesos fijos, A·4·R MACs
  const d = A4.dfl_decode([G(['a', 'b', '4R'], [2, 2, 64]), G(['a', 'b', '4R'], [1, 1, 64])], { R: 16 });
  assert.deepStrictEqual(J(d.out.num), [5, 4]);
  assert.strictEqual(d.params, 16);
  assert.strictEqual(d.macs, 5 * 4 * 16);
  assert.ok(d.detail.frozen);
  assert.throws(() => A4.dfl_decode([G(['a', 'b', 'c'], [2, 2, 60])], { R: 16 }), /4·R/);
  assert.strictEqual(A4.dist2bbox(d.out).params, 0);
  assert.deepStrictEqual(J(A4.merge_level_logits([Sq(['n', 'V'], [4, 5]), G(['a', 'b', 'V'], [1, 1, 5])]).out.num), [5, 5]);
  // codificador de texto offline: 0 en el grafo, costo en detail
  const te = A4.offline_text_encoder(Sq(['V', '77'], [5, 77]), { E: 512, params: 10, macsPerPrompt: 7 });
  assert.deepStrictEqual([te.params, te.macs, te.detail.macs, te.detail.params], [0, 0, 35, 10]);
  assert.deepStrictEqual(J(te.out.num), [5, 512]);
});

test('F4 primitivas de Grounding DINO: fusión bidireccional, logits contrastivos, top-K, máscara de sub-oraciones, PE de cajas', () => {
  const img = Sq(['N', 'D'], [6, 4]), txt = Sq(['T', 'D'], [3, 4]);
  const bi = A4.bi_attention(img, txt, { E: 8, h: 2 });
  assert.strictEqual(bi.params, 6 * 4 * 8 + 4 * 8 + 2 * 4);       // 6DE + 4E + 2D
  assert.strictEqual(bi.macs, 3 * 6 * 4 * 8 + 3 * 3 * 4 * 8 + 3 * 6 * 3 * 8);   // 3NDE + 3TDE + 3NTE
  assert.strictEqual(bi.detail.scoreMacs, 6 * 3 * 8);              // UNA matriz de scores (h·N·T·d = N·T·E)
  assert.deepStrictEqual(J(bi.out.num), [6, 4]);
  assert.deepStrictEqual(J(bi.detail.outText.num), [3, 4]);
  assert.deepStrictEqual(J(A4.transpose_scores(A4.shape(['h', 'N', 'T'], [2, 6, 3], 'img', 'heads')).out.num), [2, 3, 6]);
  const lg = A4.contrastive_logits(Sq(['Q', 'D'], [5, 4]), txt, { pad: 256 });
  assert.deepStrictEqual(J(lg.out.num), [5, 3]);
  assert.strictEqual(lg.macs, 5 * 3 * 4);
  assert.strictEqual(lg.params, 0);
  assert.strictEqual(lg.detail.padTo, 256);
  assert.throws(() => A4.contrastive_logits(Sq(['Q', 'E'], [5, 5]), txt), /anchos/);
  const tk = A4.topk_select(Sq(['N', 'T'], [6, 3]), { k: 2 });
  assert.deepStrictEqual(J(tk.out.num), [2]);
  assert.throws(() => A4.topk_select(Sq(['N', 'T'], [6, 3]), { k: 7 }), /mayor/);
  assert.deepStrictEqual(J(A4.gather_rows(Sq(['N', '4'], [6, 4]), tk.out).out.num), [2, 4]);
  const [m, pid] = A4.subsentence_mask(A4.shape(['T'], [5], 'txt', 'vec')).out;
  assert.deepStrictEqual([J(m.num), J(pid.num)], [[5, 5], [5]]);
  assert.deepStrictEqual(J(A4.sine_pos_1d({ rows: 5, D: 8 }).out.num), [5, 8]);
  const pe = A4.box_sine_embed(Sq(['Q', '4'], [3, 4]), { D: 8 });
  assert.deepStrictEqual(J(pe.out.num), [3, 16]);                 // 4 coordenadas × D/2
  assert.deepStrictEqual(J(A4.encoder_proposals({ levels: [[2, 3], [1, 2]] }).out.num), [8, 4]);
  assert.strictEqual(A4.layer_scale(img).params, 4);
  assert.strictEqual(A4.token_mask(A4.shape(['h', 'T', 'T'], [2, 3, 3], 'txt', 'heads')).other, 18);
  const ids = J(A4.primitives()).map((p) => p.id);
  for (const id of ['silu', 'upsample_nearest', 'concat_channels', 'split_channels', 'adaptive_max_pool', 'layer_scale', 'subsentence_mask',
    'sine_pos_1d', 'box_sine_embed', 'encoder_proposals', 'contrastive_logits', 'topk_select', 'gather_rows', 'transpose_scores', 'token_mask',
    'text_guided_scores', 'max_over_text', 'maxsig_gate', 'head_modulate', 'region_text_similarity', 'scale_bias', 'dfl_decode', 'dist2bbox',
    'merge_level_logits', 'offline_text_encoder', 'conv_bn_act', 'csp_bottleneck', 'c2f', 'sppf', 'max_sigmoid_attn', 't_csp_layer',
    'image_pooling_attn', 'bi_attention']) {
    assert.ok(ids.includes(id), id);
    assert.strictEqual(typeof A4[id], 'function', id);
  }
});

test('Grounding DINO-T @896×1344: 172,249,090 parámetros (HF − LayerNorm sin uso) y 459,478,198,272 MACs, por bloque', () => {
  const r = A4.run('grounding-dino-t'), t = r.totals, n = t.byNode, q = r.quantities;
  assert.strictEqual(t.params, 172249090);
  assert.strictEqual(q.paramsHF, 172250626);                       // HF cuenta swin.layernorm (1,536), que no se usa
  assert.strictEqual(t.macs, 459478198272);
  assert.strictEqual(t.flops, 2 * t.macs);
  // por bloque (= HF, crosscheck/expected/grounding-dino-t.json)
  assert.deepStrictEqual([n['img-backbone'].params, n['img-proj'].params, n['txt-backbone'].params, n['txt-proj'].params, n.enhancer.params,
    n['query-select'].params, n.decoder.params, n['dec-norm'].params, n['box-head'].params, n['contrastive-head'].params],
  [27520506, 2117632, 108891648, 196864, 21905664, 429316, 11054336, 512, 132612, 0]);
  // Swin-T sin cabeza ni LayerNorm final, con las 3 LayerNorm de salida: 28,288,354 − 769,000 − 1,536 + 2·(192 + 384 + 768)
  assert.strictEqual(n['img-backbone'].params, 28288354 - 769000 - 1536 + 2 * (192 + 384 + 768));
  // BERT-base sin pooler: embeddings + 12 capas
  assert.strictEqual(n['txt-backbone'].params, 30522 * 768 + 512 * 768 + 2 * 768 + 2 * 768 + 12 * (4 * 768 * 768 + 4 * 768 + 2 * 768 * 3072 + 3072 + 768 + 4 * 768));
  assert.strictEqual(q.bertPoolerParams, 768 * 768 + 768);
  // niveles y tokens: 112×168 + 56×84 + 28×42 + 14×21
  assert.deepStrictEqual([q.l1Tokens, q.l2Tokens, q.l3Tokens, q.l4Tokens], [18816, 4704, 1176, 294]);
  assert.strictEqual(q.tokens, 24990);
  // capa del enhancer: fusión (E = 1024, h/2 = 4) + texto (h/2, FFN 1024) + imagen deformable (FFN 2048)
  const D = 256, E = 1024;
  assert.strictEqual(q.fusionLayerParams, 6 * D * E + 4 * E + 2 * D + 2 * D + 2 * 2 * D);   // bi-atención + γ_v, γ_t + 2 LayerNorm
  assert.strictEqual(q.enhLayerParams * 6, n.enhancer.params);
  assert.strictEqual(t.byPath['enhancer>enh-layer>img-self'].params, 6 * (D * 3 * 128 + 3 * 128 + 2 * D * D + 2 * D));
  // pesos compartidos: el refinamiento de cajas del decoder usa los de box-head; query_pos: un MLP, MACs × 6
  assert.deepStrictEqual(J(r.ops.filter((o) => o.path.includes('box-refine') && o.params).map((o) => o.id)), []);
  const rf = r.ops.find((o) => o.id === 'd-refine-fc1');
  assert.strictEqual(rf.detail.sharedWith, 'box-head');
  assert.strictEqual(rf.detail.paramsIfNotShared, D * D + D);
  const rh = r.ops.find((o) => o.id === 'd-ref-fc1');
  assert.strictEqual(rh.repeat, 1);
  assert.strictEqual(rh.params, 512 * D + D);
  assert.strictEqual(rh.macs, 6 * 900 * 512 * D);
  assert.ok(rh.macArith.startsWith('6·(900·512·256)'));
  // las cabezas de las 5 capas intermedias y encoder_logits (que HF calcula en cada forward) quedan fuera
  assert.strictEqual(q.auxHeadsMacs, 5 * (900 * (2 * D * D + 4 * D) + 900 * 16 * D));
  assert.strictEqual(q.encoderLogitsMacs, 900 * 16 * D);
});

test('Grounding DINO: ids y formas de SPEC §16.1 (nodos, prefijos i-/t-/q-, logits Q×T, boxes Q×4)', () => {
  const r = A4.run('grounding-dino-t');
  const sh = (id) => r.tensors[id].num.join('×');
  for (const node of ['img-backbone', 'img-proj', 'txt-input', 'txt-backbone', 'txt-proj', 'enhancer', 'query-select', 'decoder', 'contrastive-head', 'box-head', 'matching', 'loss']) {
    assert.ok(r.ops.some((o) => o.path[0] === node), node);
  }
  for (const node of ['img-self', 'txt-self', 'i2t', 't2i', 'img-ffn', 'txt-ffn']) assert.ok(r.ops.some((o) => o.path[0] === 'enhancer' && o.path[1] === 'enh-layer' && o.path[2] === node), node);
  for (const node of ['self-attn', 'txt-cross', 'img-cross', 'ffn']) assert.ok(r.ops.some((o) => o.path[0] === 'decoder' && o.path[1] === 'dec-layer' && o.path[2] === node), node);
  for (const id of r.order) {
    if (/^(gt-|cost|assignment|loss|logits|boxes|hs$|box-)/.test(id)) continue;
    assert.ok(/^[itq]-/.test(id), 'prefijo de flujo: ' + id);
  }
  assert.strictEqual(sh('i-img'), '896×1344×3');
  assert.strictEqual(sh('i-patch-grid'), '224×336×96');
  assert.deepStrictEqual([sh('i-c3'), sh('i-c4'), sh('i-c5')], ['112×168×192', '56×84×384', '28×42×768']);
  assert.strictEqual(sh('i-src-l4'), '14×21×256');
  assert.strictEqual(sh('i-mem-in'), '24990×256');
  assert.strictEqual(sh('t-bert-out'), '16×768');
  assert.strictEqual(sh('t-feat'), '16×256');
  assert.strictEqual(sh('i-enh-fus-scores'), '4×24990×16');       // h/2 × N × T: la única matriz de la fusión
  assert.strictEqual(sh('t-enh-t2i-scores'), '4×16×24990');
  assert.strictEqual(sh('i-enh-i2t-q'), '24990×1024');
  assert.strictEqual(sh('t-enh-self-scores'), '4×16×16');
  assert.strictEqual(sh('i-enh-sampled'), '8×24990×16×32');
  assert.strictEqual(sh('q-enc-logits'), '24990×16');
  assert.strictEqual(sh('q-topk'), '900');
  assert.deepStrictEqual([sh('q-ref0'), sh('q-tgt0'), sh('q-ref-pe'), sh('q-pos')], ['900×4', '900×256', '900×512', '900×256']);
  assert.strictEqual(sh('q-self-scores'), '8×900×900');
  assert.strictEqual(sh('q-txt-scores'), '8×900×16');
  assert.strictEqual(sh('q-img-sampled'), '8×900×16×32');
  assert.strictEqual(sh('logits'), '900×16');
  assert.strictEqual(sh('boxes'), '900×4');
  assert.deepStrictEqual(J(r.tensors.logits.sym), ['Q', 'T']);
  assert.deepStrictEqual(J(r.tensors['i-enh-fus-scores'].sym), ['h/2', 'N', 'T']);
  // la cabeza de clase no tiene pesos: los logits son queries × tokens del prompt
  assert.strictEqual(r.ops.find((o) => o.id === 'contrastive-head').params, 0);
  // where en cada op de las capas (la práctica nombra por contexto)
  r.ops.filter((o) => o.repeat > 1).forEach((o) => assert.ok(Array.isArray(o.where) && o.where.length, o.id));
});

test('Grounding DINO: knobs T, Q y resolución; errores en español', () => {
  const base = A4.run('grounding-dino-t');
  const t64 = A4.run('grounding-dino-t', { T: 64 });
  assert.strictEqual(t64.totals.params, base.totals.params);       // T no cambia parámetros
  assert.ok(t64.totals.macs > base.totals.macs);
  assert.strictEqual(t64.tensors.logits.num.join('×'), '900×64');
  assert.ok(t64.notes.some((s) => /T = 64/.test(s)));
  const q300 = A4.run('grounding-dino-t', { Q: 300 });
  assert.strictEqual(base.totals.params - q300.totals.params, 600 * 256);   // tabla de contenido Q×D
  const r = A4.run('grounding-dino-t', { res: 448 });
  assert.strictEqual(r.quantities.tokens, 56 * 56 + 28 * 28 + 14 * 14 + 7 * 7);
  assert.strictEqual(r.totals.params, base.totals.params);
  assert.throws(() => A4.run('grounding-dino-t', { H: 800 }), /múltiplos de 224/);
  assert.throws(() => A4.run('grounding-dino-t', { T: 300 }), /máximo es 256/);
  assert.strictEqual(A4.run('grounding-dino-t', { res: 224 }).quantities.tokens, 28 * 28 + 14 * 14 + 7 * 7 + 4 * 4);   // 7/2 → 4 (stride 64, redondeo hacia arriba)
  assert.throws(() => A4.run('grounding-dino-t', { res: 224, Q: 2000 }), /para elegirlas/);
  assert.throws(() => A4.run('grounding-dino-t', { B: 2, nada: 1 }), /Knob inválido/);
});

test('Grounding DINO metrics: texto por imagen, fusión, memoria de scores con nombre y comparación con YOLOv8-L y DETR', () => {
  const m = A4.metrics('grounding-dino-t'), r = A4.run('grounding-dino-t'), n = r.totals.byNode;
  const N = 24990, T = 16, Q = 900;
  assert.strictEqual(m.textEncoderMacs, n['txt-backbone'].macs + n['txt-proj'].macs);
  assert.strictEqual(m.textEncoderParams, 108891648 + 196864);
  assert.strictEqual(m.fusionAttnEntries, 4 * N * T);
  assert.strictEqual(m.fusionAttnMem, 4 * N * T * 2);
  assert.strictEqual(m.fusionScoreMacsLayer, 3 * N * T * 1024);
  assert.strictEqual(m.fusionMacs, 6 * (3 * N * 256 * 1024 + 3 * T * 256 * 1024 + 3 * N * T * 1024));   // 3NDE + 3TDE + 3NTE por capa
  assert.strictEqual(m.fusionMacs, 6 * A4.bi_attention(A4.shape(['N', 'D'], [N, 256]), A4.shape(['T', 'D'], [T, 256]), { E: 1024, h: 4 }).macs);
  assert.strictEqual(m.decSelfAttnMem, 8 * Q * Q * 2);
  assert.strictEqual(m.denseEncAttnMem, 8 * N * N * 2);
  assert.strictEqual(m.samplingMacs, 6 * 5 * N * 128 * 32 + 6 * 5 * Q * 128 * 32);
  assert.strictEqual(m.logitsElements, Q * T);
  assert.strictEqual(m.logitsPaddedElements, Q * 256);
  assert.strictEqual(m.attnMem, null);                             // no hay una matriz h×N×N
  assert.strictEqual(m.yolov8Macs, A4.run('yolov8l-640').totals.macs);
  assert.strictEqual(m.detrMacs, A4.run('detr-r50-800x1216').totals.macs);
  assert.ok(m.macsVsYolov8 > 5 && m.macsVsYolov8 < 6);
  const t256 = m.textScaling.find((x) => x.T === 256);
  assert.strictEqual(t256.textEncoderMacs, m.textEncoderMacsMaxT);
  assert.ok(m.scaling.every((s) => s.macs > 0));
  assert.strictEqual(m.units.macsVsYolov8, 'ratio');
});

test('YOLOv8-L @640: 43,691,520 parámetros y 82,574,259,200 MACs (Ultralytics: 43.7M, 165.2 GFLOPs = 2 × MACs)', () => {
  const r = A4.run('yolov8l-640'), t = r.totals, n = t.byNode, q = r.quantities;
  assert.strictEqual(t.params, 43691520);
  assert.strictEqual(t.macs, 82574259200);
  assert.deepStrictEqual([n.backbone.params, n.neck.params, n['head-box'].params, n['head-cls'].params], [19808576, 18238464, 861136, 4783344]);
  assert.strictEqual(q.dflParams, 16);
  assert.strictEqual(q.tokens, 80 * 80 + 40 * 40 + 20 * 20);
  const sh = (id) => r.tensors[id].num.join('×');
  assert.deepStrictEqual([sh('c3'), sh('c4'), sh('c5')], ['80×80×256', '40×40×512', '20×20×512']);
  assert.deepStrictEqual([sh('p3'), sh('p4'), sh('p5')], ['80×80×256', '40×40×512', '20×20×512']);
  assert.deepStrictEqual([sh('boxes-p3'), sh('logits-p3'), sh('box-dist'), sh('scores')], ['80×80×64', '80×80×80', '8400×4', '8400×80']);
  // C2f del stage 3 (256 → 256, n = 6, con atajo): c = 128
  const c2f = r.ops.find((o) => o.id === 's3-c2f');
  assert.strictEqual(c2f.params, (256 * 256 + 512) + 6 * (18 * 128 * 128 + 4 * 128) + (8 * 128 * 256 + 512));
  const m = A4.metrics('yolov8l-640');
  assert.strictEqual(m.backboneMacs + m.neckMacs + m.headMacs, t.macs);
  assert.strictEqual(m.logitsElements, 8400 * 80);
  assert.strictEqual(A4.run('yolov8l-640', { res: 1280 }).quantities.tokens, 4 * 8400);
  assert.throws(() => A4.run('yolov8l-640', { res: 600 }), /múltiplo de 32/);
});

test('YOLO-World-L @640: 47,553,970 parámetros (sin CLIP) y 88,479,110,144 MACs; texto offline y vocabulario V', () => {
  const r = A4.run('yolo-world-l-640'), t = r.totals, n = t.byNode, q = r.quantities, by = t.byPath;
  assert.strictEqual(t.params, 47553970);
  assert.strictEqual(t.macs, 88479110144);
  assert.deepStrictEqual([n.backbone.params, n.neck.params, n['head-box'].params, n['head-text'].params], [19808576, 21767836, 861136, 5116422]);
  assert.strictEqual(n.backbone.params, A4.run('yolov8l-640').totals.byNode.backbone.params);   // mismo backbone que YOLOv8-L
  assert.strictEqual(by['neck>img-pool-attn'].params, 724992);
  assert.strictEqual(q.v2Params, 46832050);                      // yolov8l-worldv2: sin image-pooling attention, BN en la cabeza
  assert.strictEqual(q.contrastiveHeadParams, 3 * 2);
  // T-CSPLayer del top-down P4 (1024 → 512, n = 3, E = 256, 8 cabezas): el C2f + 256·512 de cv2 + max-sigmoid
  assert.strictEqual(by['neck>td-p4>t-csp'].params, 5576456);
  assert.strictEqual(by['neck>td-p4>t-csp>max-sigmoid'].params, (512 * 256 + 256) + 8 + (9 * 256 * 256 + 512));
  // codificador de texto: 0 en el grafo online, costo en detail y en metrics (CLIP ViT-B/32 de js/arch/clip.js)
  const te = r.ops.find((o) => o.id === 'txt-encoder');
  assert.deepStrictEqual([te.params, te.macs], [0, 0]);
  const clip = A4.run('clip-vit-b32').totals.byNode;
  assert.strictEqual(te.detail.params, clip['txt-encoder'].params + clip['txt-proj'].params);
  assert.strictEqual(te.detail.macs, 80 * (clip['txt-encoder'].macs + clip['txt-proj'].macs));
  const sh = (id) => r.tensors[id].num.join('×');
  assert.deepStrictEqual([sh('vocab'), sh('vocab-upd'), sh('obj-emb-p3'), sh('logits-p3'), sh('logits-p5'), sh('scores')], ['80×512', '80×512', '80×80×512', '6400×80', '400×80', '8400×80']);
  assert.deepStrictEqual([sh('td3-tg-scores'), sh('bu5-tg-scores'), sh('ipa-tokens'), sh('ipa-scores')], ['4×6400×80', '8×400×80', '27×256', '8×80×27']);
  // la cabeza usa el vocabulario ORIGINAL; el bottom-up, el actualizado por la image-pooling attention
  assert.ok(r.ops.find((o) => o.id === 'ht-p3-sim').in.includes('vocab'));
  assert.ok(r.ops.find((o) => o.id === 'bu4-tg-guide').in.includes('vocab-upd'));
  assert.ok(r.ops.find((o) => o.id === 'td4-tg-guide').in.includes('vocab'));
  // V: los parámetros no cambian y los MACs son lineales en V
  const m1 = A4.run('yolo-world-l-640', { V: 1 }).totals, m20 = A4.run('yolo-world-l-640', { V: 20 }).totals;
  assert.strictEqual(m20.params, t.params);
  assert.strictEqual((t.macs - m20.macs) / 60, (m20.macs - m1.macs) / 19);
  const perV = (t.macs - m20.macs) / 60;
  assert.strictEqual(perV, 512 * (256 + 128 + 256 + 256) + (1600 * 256 + 6400 * 128 + 1600 * 256 + 400 * 256) + 2 * 512 * 256 + 2 * 27 * 256 + 8400 * 512);
});

test('YOLO-World metrics: CLIP offline una vez por vocabulario vs costo online; fusión; logits por nivel; comparación', () => {
  const m = A4.metrics('yolo-world-l-640'), r = A4.run('yolo-world-l-640');
  assert.strictEqual(m.onlineTextMacs, 0);
  assert.strictEqual(m.vocabTextMacs, 80 * m.promptTextMacs);
  assert.strictEqual(m.textEncoderParams, A4.run('clip-vit-b32').totals.byNode['txt-encoder'].params + A4.run('clip-vit-b32').totals.byNode['txt-proj'].params);
  assert.ok(m.vocabTextToOnline > 2 && m.vocabTextToOnline < 3);   // codificar 80 clases cuesta ≈ 2.7 imágenes, pero una sola vez
  assert.strictEqual(m.fusionMacs, m.maxSigmoidMacs + m.ipaMacs);
  assert.deepStrictEqual([m.logitsP3Elements, m.logitsP4Elements, m.logitsP5Elements, m.logitsElements], [6400 * 80, 1600 * 80, 400 * 80, 8400 * 80]);
  assert.strictEqual(m.deltaParamsVsYolov8, r.totals.params - 43691520);
  assert.strictEqual(m.gdinoTextMacs, A4.metrics('grounding-dino-t').textEncoderMacs);
  assert.ok(m.gdinoToYoloWorldMacs > 5);
  assert.deepStrictEqual(J(m.vocabScaling.map((x) => x.V)), [1, 20, 80, 365, 1203]);
  assert.strictEqual(m.units.vocabTextToOnline, 'ratio');
});

test('F4 etiqueta + símbolo identifican una forma; byPath suma; aritmética; Quantities resuelve todas las claves', () => {
  for (const id of ['grounding-dino-t', 'yolov8l-640', 'yolo-world-l-640']) {
    const r = A4.run(id), t = r.totals;
    const by = {};
    for (const tid of r.order) {
      const x = r.tensors[tid];
      const k = x.label + '|' + String(x.tex).split('=')[0].trim();
      (by[k] = by[k] || new Set()).add(x.num.join('×'));
    }
    for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
    assert.strictEqual(r.ops.reduce((s, o) => s + o.params * o.repeat, 0), t.params);
    assert.strictEqual(Object.values(t.byPrim).reduce((s, x) => s + x.macs, 0), t.macs);
    const check = (pp, want) => {
      const kids = children(r, pp);
      if (!kids.length) return;
      const at = (k) => t.byPath[pp.concat([k]).join('>')];
      assert.strictEqual(kids.reduce((s, k) => s + at(k).params, 0), want.params, id + ' params bajo ' + (pp.join('>') || 'raíz'));
      assert.strictEqual(kids.reduce((s, k) => s + at(k).macs, 0), want.macs, id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
      kids.forEach((k) => check(pp.concat([k]), at(k)));
    };
    check([], t);
    assert.strictEqual(A4.run(id), r, 'memoizado');
    for (const tid of r.order) {
      const x = r.tensors[tid];
      if (x.producer) assert.ok(r.ops.find((o) => o.id === x.producer).out.includes(tid));
      x.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(tid)));
    }
    for (const op of r.ops) {
      if (op.params) assert.ok(op.paramArith.endsWith(A4.fmt.int(op.params)), id + ' ' + op.id + ' paramArith');
      if (op.macs) assert.ok(op.macArith.endsWith(A4.fmt.int(op.macs)), id + ' ' + op.id + ' macArith');
      assert.ok(!/undefined|NaN/.test(op.paramTex + op.macTex + op.shapeTex), id + ' ' + op.id + ' tex');
    }
    J(Q4.keys(id)).forEach((k) => assert.ok(Q4.get(id + '.' + k), id + '.' + k));
  }
  assert.strictEqual(Q4.get('grounding-dino-t.params.total').text, '172,249,090');
  assert.strictEqual(Q4.get('grounding-dino-t.metrics.fusionAttnMem').text, '3.20 MB');
  assert.strictEqual(Q4.get('yolo-world-l-640.metrics.vocabTextToOnline').text, '2.69');
  assert.strictEqual(Q4.get('yolov8l-640.tensor.logits-p3.sym').text, '(H/8)×(W/8)×K');
});

// ---------------------------------------------------------------- fase 5 (SAM, SAM 2)
// Contexto propio con todos los modelos hasta la fase 5 (los de arriba no cargan sam.js).
const ATLAS5 = (function () {
  const ctx = vm.createContext({});
  for (const f of FILES.filter((x) => x !== 'js/core/quantities.js').concat(['js/arch/grounding-dino.js', 'js/arch/yolo-world.js', 'js/arch/sam.js', 'js/core/quantities.js'])) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('ATLAS', ctx);
})();
const A5 = ATLAS5.Arch, Q5 = ATLAS5.Quantities;
const G5 = (sym, num) => A5.shape(sym, num, 'img', 'grid');
const S5 = (sym, num, layout) => A5.shape(sym, num, 'img', layout || 'seq');

test('F5 los modelos nuevos no cambian ningún resultado de las fases 1–4', () => {
  for (const c of A4.configs()) {
    const a = A4.run(c.id).totals, b = A5.run(c.id).totals;
    assert.deepStrictEqual([b.params, b.macs, b.other], [a.params, a.macs, a.other], c.id);
  }
  assert.deepStrictEqual(J(A5.models()).sort(), ['clip', 'deformable-detr', 'detr', 'grounding-dino', 'resnet', 'sam', 'sam2', 'swin', 'transformer', 'vit', 'yolo-world', 'yolov8']);
  assert.deepStrictEqual([A5.canonical('sam'), A5.canonical('sam2')], ['sam-vit-h-1024', 'sam2-hiera-l']);
  assert.deepStrictEqual(J(A5.configs('sam').map((c) => c.id)), ['sam-vit-h-1024', 'sam-vit-l-1024', 'sam-vit-b-1024']);
  assert.deepStrictEqual(J(A5.configs('sam2').map((c) => c.id)), ['sam2-hiera-l', 'sam2-hiera-bplus', 'sam2-hiera-s', 'sam2-hiera-t']);
});

test('F5 primitivas: ConvTranspose, depthwise, ventanas con relleno, posición relativa descompuesta, q-pooling', () => {
  // ConvTranspose 2×2 stride 2: 3×4×8 → 6×8×2; parámetros 4·8·2 + 2; MACs H·W·k²·Cin·Cout (por píxel de entrada)
  const ct = A5.conv_transpose2d(G5(['h', 'w', '8'], [3, 4, 8]), { k: 2, cout: 2, coutSym: '2' });
  assert.deepStrictEqual(J(ct.out.num), [6, 8, 2]);
  assert.strictEqual(ct.params, 4 * 8 * 2 + 2);
  assert.strictEqual(ct.macs, 3 * 4 * 4 * 8 * 2);
  assert.strictEqual(ct.macs, 6 * 8 * 8 * 2);               // = H_o·W_o·Cin·Cout con k = s
  // depthwise 7×7 sobre 5×5×4: 49·4 + 4 parámetros, H·W·C·49 MACs (sin el factor C_in)
  const dw = A5.depthwise_conv2d(G5(['h', 'w', 'C'], [5, 5, 4]), { k: 7 });
  assert.deepStrictEqual([dw.params, dw.macs], [49 * 4 + 4, 25 * 4 * 49]);
  assert.throws(() => A5.depthwise_conv2d(G5(['h', 'w', 'C'], [5, 5, 4]), { k: 7, p: 0 }), /same/);
  // 64×64 con M = 14 → relleno a 70×70: 25 ventanas de 196 (4,900 tokens); unpartition recorta
  const x = G5(['H/16', 'W/16', 'D'], [64, 64, 8]);
  const wp = A5.window_partition_pad(x, { M: 14 });
  assert.deepStrictEqual(J(wp.out.num), [25, 196, 8]);
  assert.deepStrictEqual([wp.detail.Hp, wp.detail.padTokens], [70, 4900 - 4096]);
  assert.deepStrictEqual(J(A5.window_unpartition(wp.out, { H: 64, W: 64, M: 14 }).out.num), [64, 64, 8]);
  assert.throws(() => A5.window_unpartition(wp.out, { H: 64, W: 64, M: 7 }), /7×7/);
  // posición relativa descompuesta: tablas (2S−1)×d_h por eje; MACs 2·nW·h·S²·S·d_h
  const q = A5.shape(['nW', 'h', 'M²', 'd_h'], [25, 2, 196, 5], 'img', 'winheads');
  const sc = A5.shape(['nW', 'h', 'M²', 'M²'], [25, 2, 196, 196], 'img', 'winheads');
  const rp = A5.decomposed_rel_pos(sc, q, { S: 14, Ssym: 'M' });
  assert.strictEqual(rp.params, 2 * 27 * 5);
  assert.strictEqual(rp.macs, 2 * 25 * 2 * 196 * 14 * 5);
  assert.strictEqual(rp.paramFormula, '2\\,(2M-1)\\,d_h');
  assert.ok(rp.detail.fullTableIfNotDecomposed > rp.params / 2);   // (2S−1)² vs 2·(2S−1)
  assert.throws(() => A5.decomposed_rel_pos(sc, q, { S: 13 }), /rejilla/);
  // q-pooling: 64 queries por ventana → 16 (K y V no cambian)
  const qp = A5.query_pool(A5.shape(['nW', 'h', '64', 'd_h'], [4, 2, 64, 3], 'img', 'winheads'), {});
  assert.deepStrictEqual(J(qp.out.num), [4, 2, 16, 3]);
  assert.strictEqual(qp.macs, 0);
  assert.throws(() => A5.query_pool(A5.shape(['h', '9', 'd'], [1, 9, 3], 'img', 'heads'), {}), /stride/);
});

test('F5 primitivas del prompt y del decoder: Fourier, relleno, tipos, tokens, hipernetwork, selección', () => {
  const pts = S5(['P', '2'], [3, 2]);
  const pad = A5.append_pad_point(pts, { sym: 'P+1' });
  assert.deepStrictEqual(J(pad.out.num), [4, 2]);
  const fp = A5.fourier_pe(pad.out, { F: 128, Dsym: 'C' });
  assert.deepStrictEqual([J(fp.out.num), fp.params, fp.macs], [[4, 256], 0, 4 * 2 * 128]);   // G 2×128 = buffer
  const grid = A5.coord_grid({ H: 4, W: 4 });
  assert.deepStrictEqual(J(A5.fourier_pe(grid.out, { F: 8 }).out.num), [4, 4, 16]);
  assert.strictEqual(A5.fourier_pe(grid.out, { F: 8 }).macs, 16 * 2 * 8);
  assert.strictEqual(A5.type_embed(fp.out, { rows: 5, D: 256 }).params, 5 * 256);
  assert.strictEqual(A5.learned_tokens({ rows: 5, D: 256 }).params, 1280);
  assert.deepStrictEqual(J(A5.broadcast_embed({ H: 4, W: 4, D: 8 }).out.num), [4, 4, 8]);
  assert.strictEqual(A5.broadcast_embed({ H: 4, W: 4, D: 8 }).params, 8);
  const idle = A5.idle_params({ paramTerms: [[2, 2, 1, 4], [4]], what: 'x' });
  assert.deepStrictEqual([idle.params, idle.macs, J(idle.out)], [20, 0, []]);
  assert.strictEqual(idle.paramArith, '2·2·1·4 + 4 = 20');
  // RoPE: sin parámetros ni MACs; excluye los tokens finales (punteros)
  const rk = A5.rope_2d(A5.shape(['1', 'N_m', 'C'], [1, 10, 4], 'img', 'heads'), { exclude: 2 });
  assert.deepStrictEqual([rk.params, rk.macs, rk.other, rk.detail.rotated], [0, 0, 8 * 4 * 3, 8]);
  // hipernetwork: un Linear distinto por token: R·(D_in·D_out + D_out)
  const gl = A5.grouped_linear(S5(['4', 'C'], [4, 8]), { dout: 2, doutSym: 'C/4' });
  assert.deepStrictEqual([gl.params, gl.macs], [4 * (8 * 2 + 2), 4 * 8 * 2]);
  const hd = A5.hyper_dot(S5(['4', 'c'], [4, 2]), G5(['h', 'w', 'c'], [3, 5, 2]));
  assert.deepStrictEqual([J(hd.out.num), hd.macs], [[4, 3, 5], 4 * 2 * 3 * 5]);
  assert.throws(() => A5.hyper_dot(S5(['4', 'c'], [4, 3]), G5(['h', 'w', 'c'], [3, 5, 2])), /canales/);
  assert.deepStrictEqual(J(A5.mask_select(hd.out, { start: 1, count: 3 }).out.num), [3, 3, 5]);
  assert.deepStrictEqual(J(A5.mask_select(A5.shape(['4'], [4]), { start: 1, count: 3 }).out.num), [3]);
  assert.deepStrictEqual(J(A5.pick_mask(A5.mask_select(hd.out, { start: 1, count: 3 }).out, A5.shape(['3'], [3])).out.num), [3, 5, 1]);
  assert.deepStrictEqual(J(A5.take_rows(S5(['7', 'C'], [7, 8]), { start: 0, count: 1, vec: true }).out.num), [8]);
  assert.throws(() => A5.take_rows(S5(['7', 'C'], [7, 8]), { start: 5, count: 4 }), /rango/);
  assert.deepStrictEqual(J(A5.to_grid(S5(['N', 'C'], [12, 2]), { H: 3, W: 4 }).out.num), [3, 4, 2]);
  assert.deepStrictEqual(J(A5.split_tokens(S5(['16', 'C'], [16, 256]), { parts: 4 }).out.num), [64, 64]);
  assert.deepStrictEqual(J(A5.repeat_rows(S5(['16', '64'], [16, 64]), { k: 4 }).out.num), [64, 64]);
  assert.strictEqual(A5.add_temporal_embed(S5(['7·N', '64'], [28, 64]), { rows: 7, D: 64 }).params, 448);
  assert.strictEqual(A5.pos_embed_grid({ H: 64, W: 64, D: 1280 }).params, 5242880);
  assert.strictEqual(A5.window_pos_embed({ H: 16, W: 16, C: 144, bkg: 7, win: 8 }).params, 144 * (49 + 64));
  assert.strictEqual(A5.gate_embed(S5(['N', '64'], [4, 64])).params, 64);
  assert.deepStrictEqual(J(A5.upsample_bilinear(G5(['h', 'w', '1'], [4, 4, 1]), { H: 16, W: 16 }).out.num), [16, 16, 1]);
  const ids = J(A5.primitives()).map((p) => p.id);
  for (const id of ['conv_transpose2d', 'depthwise_conv2d', 'window_partition_pad', 'window_unpartition', 'decomposed_rel_pos', 'query_pool', 'coord_grid',
    'fourier_pe', 'append_pad_point', 'type_embed', 'learned_tokens', 'broadcast_embed', 'idle_params', 'rope_2d', 'take_rows', 'grouped_linear', 'hyper_dot',
    'mask_select', 'pick_mask', 'upsample_bilinear', 'to_grid', 'split_tokens', 'repeat_rows', 'add_temporal_embed', 'pos_embed_grid', 'window_pos_embed', 'gate_embed']) {
    assert.ok(ids.includes(id), id);
    assert.strictEqual(typeof A5[id], 'function', id);
  }
});

test('SAM ViT-H @1024: 641,090,608 parámetros (oficial = HF − 256) y 2,982,353,766,912 MACs, por bloque', () => {
  const r = A5.run('sam-vit-h-1024'), t = r.totals, n = t.byNode, q = r.quantities;
  assert.strictEqual(t.params, 641090608);
  assert.strictEqual(q.paramsHF, 641090864);                 // HF: matriz gaussiana 2×128 como Parameter
  assert.strictEqual(t.macs, 2982353766912);
  assert.deepStrictEqual([n['img-encoder'].params, n['prompt-enc'].params, n['mask-decoder'].params], [637026048, 6220, 4058340]);
  // bloque: 12D² + 13D (qkv con sesgo, proj, 2 LN, MLP 4D) + tablas relativas 2·(2S−1)·d_h
  const D = 1280, dh = 80;
  assert.strictEqual(q.winBlockParams, 12 * D * D + 13 * D + 2 * 27 * dh);
  assert.strictEqual(q.globalBlockParams, 12 * D * D + 13 * D + 2 * 127 * dh);
  assert.deepStrictEqual([q.relPosWinParams, q.relPosGlobalParams], [4320, 20320]);
  assert.deepStrictEqual([q.Lw, q.Lg, q.nW, q.padTokens], [28, 4, 25, 4900]);
  assert.strictEqual(q.posEmbedParams, 64 * 64 * 1280);
  // decoder: la parte cara son las cross-attention sobre los 4,096 tokens; el upscaling y el producto son pequeños
  assert.strictEqual(q.decoderMacsPerPrompt, 1812351488);
  assert.strictEqual(q.dotMacs, 4 * 32 * 256 * 256);
  assert.strictEqual(r.ops.find((o) => o.id === 'md-out-tokens').params, 5 * 256);
  // las otras dos configs: mismo decoder y prompt encoder
  for (const [id, p] of [['sam-vit-l-1024', 312342832], ['sam-vit-b-1024', 93735472]]) {
    const s = A5.run(id);
    assert.strictEqual(s.totals.params, p, id);
    assert.deepStrictEqual([s.totals.byNode['prompt-enc'].params, s.totals.byNode['mask-decoder'].params], [6220, 4058340], id);
  }
});

test('SAM: ids y formas de SPEC §17.1 (nodos, tensores, paths) y parámetros sin uso del prompt de máscara', () => {
  const r = A5.run('sam-vit-h-1024');
  const shape = (id) => r.tensors[id].num.join('×');
  for (const [id, s] of [['x-img', '1024×1024×3'], ['patches', '64×64×1280'], ['enc-out', '64×64×1280'], ['img-emb', '64×64×256'], ['sparse', '2×256'],
    ['dense', '64×64×256'], ['tokens', '7×256'], ['up-emb', '256×256×32'], ['masks', '3×256×256'], ['iou', '3'], ['w-win', '25×196×1280'], ['g-scores', '16×4096×4096'],
    ['tw-t2i-scores', '8×7×4096'], ['tw-i2t-scores', '8×4096×7'], ['hyper-in', '4×32'], ['masks-all', '4×256×256']]) assert.strictEqual(shape(id), s, id);
  assert.deepStrictEqual(J(r.tensors.tokens.sym), ['5+P+1', 'C']);
  assert.deepStrictEqual(J(r.tensors.sparse.sym), ['P+1', 'C']);
  const top = new Set(r.ops.map((o) => o.path[0]));
  assert.deepStrictEqual([...top].sort(), ['img-encoder', 'mask-decoder', 'prompt-enc']);
  const kids = (p) => J(children(r, p)).sort();
  assert.deepStrictEqual(kids(['img-encoder']), ['global-blocks', 'neck', 'patch-embed', 'pos-embed', 'win-blocks']);
  for (const k of ['tokens', 'two-way', 'final-attn', 'upscale', 'hypernet', 'dot', 'iou-head']) assert.ok(kids(['mask-decoder']).includes(k), k);
  assert.deepStrictEqual(kids(['mask-decoder', 'two-way']), ['img2tok', 'mlp', 'tok-self', 'tok2img']);
  assert.ok(kids(['prompt-enc']).includes('mask-in'));
  // repeticiones: 28 bloques con ventanas, 4 globales, 2 capas two-way
  assert.strictEqual(r.ops.find((o) => o.id === 'w-qkv').repeat, 28);
  assert.strictEqual(r.ops.find((o) => o.id === 'g-qkv').repeat, 4);
  assert.strictEqual(r.ops.find((o) => o.id === 'tw-fc1').repeat, 2);
  // el prompt de máscara existe pero no corre sin máscara de entrada: params sí, MACs y tensores no
  const idle = r.ops.find((o) => o.id === 'mask-embed-idle');
  assert.deepStrictEqual([idle.params, idle.macs, J(idle.out), J(idle.in)], [4684, 0, [], []]);
  assert.strictEqual(r.quantities.maskEmbedParams, 4684);
  // cross-attention del decoder con el ancho interno C/2 = 128 (downsample ×2)
  assert.deepStrictEqual(J(r.tensors['tw-t2i-kp'].sym), ['N', 'C/2']);
  assert.strictEqual(r.ops.find((o) => o.id === 'tw-t2i-k-proj').params, 256 * 128 + 128);
});

test('SAM: knobs P, masks, maskIn y resolución; errores en español', () => {
  const base = A5.run('sam-vit-h-1024');
  const p3 = A5.run('sam-vit-h-1024', { P: 3 });
  assert.deepStrictEqual([p3.tensors.sparse.num[0], p3.tensors.tokens.num[0]], [4, 9]);
  assert.strictEqual(p3.totals.params, base.totals.params);
  assert.strictEqual(p3.quantities.encoderMacs, base.quantities.encoderMacs);      // codificar una vez
  assert.ok(p3.quantities.decoderMacsPerPrompt > base.quantities.decoderMacsPerPrompt);
  const m1 = A5.run('sam-vit-h-1024', { masks: 1 });
  assert.deepStrictEqual([m1.tensors.masks.num.join('×'), m1.tensors.iou.num.join('×')], ['1×256×256', '1']);
  assert.strictEqual(m1.totals.macs, base.totals.macs);                            // las 4 máscaras se calculan igual
  const mi = A5.run('sam-vit-h-1024', { maskIn: 1 });
  assert.strictEqual(mi.totals.params, base.totals.params);                       // mismos pesos: cambia qué rama corre
  assert.deepStrictEqual(J(mi.tensors['mask-input'].num), [256, 256, 1]);
  assert.strictEqual(mi.tensors.dense.producer, 'me-conv3');
  assert.strictEqual(mi.ops.find((o) => o.id === 'no-mask-idle').params, 256);
  const r5 = A5.run('sam-vit-h-1024', { res: 512 });
  assert.strictEqual(r5.totals.params, base.totals.params - 1280 * (4096 - 1024) - 4 * 2 * (127 - 63) * 80);
  assert.ok(r5.notes.some((s) => /Resolución 512/.test(s)));
  assert.deepStrictEqual([r5.config.nW, r5.config.padTokens], [9, 9 * 196]);
  assert.throws(() => A5.run('sam-vit-h-1024', { masks: 2 }), /masks debe ser 1/);
  assert.throws(() => A5.run('sam-vit-h-1024', { res: 1000 }), /divisible/);
  assert.throws(() => A5.run('sam-vit-h-1024', { boxes: 1 }), /Knob inválido/);
});

test('SAM metrics: codificar una vez, decodificar por prompt; ventanas vs global por bloque', () => {
  const m = A5.metrics('sam-vit-h-1024', {});
  assert.strictEqual(m.encoderMacs, 2980541415424);
  assert.strictEqual(m.decoderMacsPerPrompt, 1812351488);
  assert.ok(Math.abs(m.encoderToDecoder - 1644.57) < 0.01);
  assert.strictEqual(m.breakEvenPrompts, 1645);                                      // entero: = quantities.breakEvenPrompts
  assert.strictEqual(m.breakEvenPrompts, A5.run('sam-vit-h-1024').quantities.breakEvenPrompts);
  assert.ok(m.encoderMacsShare > 0.99);
  assert.strictEqual(m.imgEmbMem, 64 * 64 * 256 * 2);
  assert.strictEqual(m.winAttnMem, 25 * 16 * 196 * 196 * 2);
  assert.strictEqual(m.globalAttnMem, 16 * 4096 * 4096 * 2);
  assert.strictEqual(m.attnMem, m.globalAttnMem);                                  // el mayor tensor de scores
  assert.ok(m.globalToWinScoreMacs > 16 && m.globalToWinScoreMacs < 17);
  assert.ok(Math.abs(m.padOverhead - 804 / 4096) < 1e-12);
  assert.strictEqual(m.decoderMacsWithBox, A5.run('sam-vit-h-1024', { P: 2 }).quantities.decoderMacsPerPrompt);
  assert.deepStrictEqual(J(m.promptScaling.map((x) => x.tokens)), [7, 8, 11, 16]);
  assert.ok(m.promptScaling.every((x, i, a) => i === 0 || x.decoderMacs > a[i - 1].decoderMacs));
  assert.strictEqual(m.units.breakEvenPrompts, 'count');
  assert.strictEqual(Q5.get('sam-vit-h-1024.metrics.breakEvenPrompts').text, '1,645');
  assert.strictEqual(Q5.get('sam-vit-h-1024.metrics.encoderToDecoder').text, '1,645');           // cociente ≥ 1000: entero redondeado
  // reparto del encoder: ventanas + globales + patch embed/posición + neck = encoder
  assert.strictEqual(m.winBlocksMacs + m.globalBlocksMacs + m.patchEmbedMacs + m.neckMacs, m.encoderMacs);
  assert.strictEqual(m.winBlocksMacs, 28 * m.winBlockMacs);
  const b = A5.metrics('sam-vit-b-1024', {});
  assert.ok(b.encoderMacsVsVitH > 0.15 && b.encoderMacsVsVitH < 0.17);
  assert.strictEqual(b.decoderMacsPerPrompt, m.decoderMacsPerPrompt);              // mismo decoder
  // bf16 por defecto; fp32 duplica los bytes
  assert.strictEqual(A5.metrics('sam-vit-h-1024', { dtype: 'fp32' }).globalAttnMem, 2 * m.globalAttnMem);
});

test('SAM 2 Hiera-L: 224,446,642 parámetros (HF Sam2VideoModel = oficial) y 1,221,837,227,776 MACs por frame (7 memorias, 16 punteros)', () => {
  const r = A5.run('sam2-hiera-l'), t = r.totals, n = t.byNode, q = r.quantities;
  assert.strictEqual(t.params, 224446642);
  assert.strictEqual(t.macs, 1221837227776);
  assert.strictEqual(q.hieraFpnParams, 212703280);                                  // HF vision_encoder
  assert.strictEqual(n['memory-attn'].params, 5922304 + 2 * 256);                   // + no_mem_embed y no_mem_pos_enc (sin uso)
  assert.strictEqual(n['memory-encoder'].params, 1384608 + 64);                     // + embedding de oclusión espacial
  assert.strictEqual(n['mask-decoder'].params + n.occlusion.params, 4215109);
  assert.deepStrictEqual([q.nMem, q.ptrs, q.Nm, q.memTokens, q.ptrTokens], [7, 16, 28736, 28672, 64]);
  for (const [id, p] of [['sam2-hiera-bplus', 80850178], ['sam2-hiera-s', 46060354], ['sam2-hiera-t', 38962498]]) assert.strictEqual(A5.run(id).totals.params, p, id);
  // Hiera-L: stages [2, 6, 36, 4], ventanas [8, 4, 16, 8]; los 3 bloques globales caen en el stage 3
  const st = r.config.stages;
  assert.deepStrictEqual(J(st.map((s) => [s.side, s.C, s.h, s.globalBlocks])), [[256, 144, 2, 0], [128, 288, 4, 0], [64, 576, 8, 3], [32, 1152, 16, 0]]);
  assert.deepStrictEqual(J(st[2].groups.map((g) => [g.kind, g.rep, g.ws])), [['q', 1, 4], ['w', 32, 16], ['g', 3, 0]]);
  // q-pooling: ventanas de 4×4 del stage 2 → 2×2 en la salida; las queries bajan ×4, las keys no
  assert.deepStrictEqual([r.tensors['h3-q-q-pooled'].num.join('×'), r.tensors['h3-q-k'].num.join('×')], ['1024×8×4×72', '1024×8×16×72']);
  assert.strictEqual(r.tensors['ma-cross-scores'].num.join('×'), '1×4096×28736');
  assert.strictEqual(r.tensors.tokens.num.join('×'), '8×256');                       // 6 de salida + punto vacío + relleno
  assert.deepStrictEqual(J(r.tensors.memory.sym), ['7·N+4·16', '64']);
});

test('SAM 2: ids de SPEC §17.2, knobs memFrames y ptrs, errores', () => {
  const r = A5.run('sam2-hiera-l');
  const top = new Set(r.ops.map((o) => o.path[0]));
  for (const k of ['img-encoder', 'fpn', 'memory-attn', 'prompt-enc', 'mask-decoder', 'occlusion', 'memory-encoder', 'memory-bank', 'obj-ptrs']) assert.ok(top.has(k), k);
  assert.ok(['self-attn', 'cross-mem', 'mlp'].every((k) => children(r, ['memory-attn']).includes(k)));
  assert.strictEqual(r.ops.find((o) => o.id === 'ma-cross-k-proj').repeat, 4);
  assert.strictEqual(r.ops.find((o) => o.id === 'ma-cross-k-proj').params, 64 * 256 + 256);
  for (const id of ['x-img', 'fpn-s16', 'pix-mem', 'masks', 'iou', 'obj-score', 'obj-ptr', 'mem-out', 'memory']) assert.ok(r.tensors[id], id);
  const n2 = A5.run('sam2-hiera-l', { memFrames: 2 });
  assert.strictEqual(n2.totals.params, r.totals.params - 4 * 64);                     // num_maskmem 7 → 3
  assert.strictEqual(n2.config.Nm, 3 * 4096 + 64);
  assert.ok(n2.notes.some((s) => /num_maskmem = 3/.test(s)));
  const p4 = A5.run('sam2-hiera-l', { ptrs: 4 });
  assert.strictEqual(p4.totals.params, r.totals.params);
  assert.strictEqual(p4.config.Nm, 7 * 4096 + 16);
  // la memory attention crece lineal en los tokens de memoria (las proyecciones de K y V y los scores)
  const d = (a, b) => a.quantities.memAttnMacs - b.quantities.memAttnMacs;
  const perTok = 4 * (2 * 64 * 256 + 2 * 4096 * 256);
  assert.strictEqual(d(r, n2), 4 * 4096 * perTok);
  assert.strictEqual(d(r, p4), 48 * perTok + 12 * 256 * 64);                          // + la proyección temporal de 12 punteros
  assert.ok(A5.run('sam2-hiera-l', { ptrs: 20 }).notes.some((s) => /max_obj_ptrs_in_encoder/.test(s)));
  assert.throws(() => A5.run('sam2-hiera-l', { res: 1000 }), /múltiplo de 32/);
  assert.throws(() => A5.run('sam2-hiera-l', { P: 1 }), /Knob inválido/);
});

test('SAM 2 metrics: costo por frame con N memorias, banco de memoria en bytes, comparación con SAM ViT-H', () => {
  const m = A5.metrics('sam2-hiera-l', {});
  assert.strictEqual(m.frameMacs, 1221837227776);
  assert.strictEqual(m.imgEncoderMacs + m.memAttnMacs + m.memEncoderMacs + m.decoderMacs + m.objPtrMacs, m.frameMacs);
  assert.strictEqual(m.memTokens, 28736);
  assert.strictEqual(m.memPerFrameMem, 4096 * 64 * 2);
  assert.strictEqual(m.memoryBankMem, 2 * 7 * 4096 * 64 * 2 + 16 * 256 * 2);
  assert.strictEqual(m.memCrossAttnMem, 4096 * 28736 * 2);
  assert.strictEqual(m.memToImgEmb, 0.25);
  assert.strictEqual(m.firstFrameMacs, m.frameMacs - m.memAttnMacs);
  assert.ok(m.frameVsSamH > 0.4 && m.frameVsSamH < 0.42);
  assert.strictEqual(m.crossoverN, null);
  assert.deepStrictEqual(J(m.memScaling.map((x) => x.memTokens)), [2, 3, 5, 7, 9].map((k) => k * 4096 + 64));
  assert.ok(m.memScaling.every((x, i, a) => i === 0 || x.macs > a[i - 1].macs));
  assert.deepStrictEqual(J(m.stages.map((s) => s.globalBlocks)), [0, 0, 3, 0]);
  assert.strictEqual(m.hieraMacs + m.fpnMacs + m.hiresMacs, m.imgEncoderMacs);
  // stages[]: ventanas con relleno, igual que las ops (B+ stage 3: 64 → 70 con ventanas de 14, 25 ventanas)
  for (const id of ['sam2-hiera-l', 'sam2-hiera-bplus', 'sam2-hiera-s', 'sam2-hiera-t']) {
    const R2 = A5.run(id), m2 = A5.metrics(id, {});
    for (const s of m2.stages) {
      const ops = R2.ops.filter((o) => o.id === 'h' + s.k + '-w-scores' || o.id === 'h' + s.k + '-w-weighted-sum');
      if (ops.length) assert.strictEqual(s.winScoreMacs, ops.reduce((a, o) => a + o.macs, 0), id + ' stage ' + s.k);
    }
  }
  assert.strictEqual(A5.metrics('sam2-hiera-bplus', {}).stages[2].winScoreMacs, 2 * 25 * Math.pow(14, 4) * 448);
  assert.strictEqual(m.units.memoryBankMem, 'bytes');
  // por objeto seguido: todo menos el codificador de imagen (compartido entre objetos)
  assert.strictEqual(m.perObjectMacs, m.memAttnMacs + m.decoderMacs + m.memEncoderMacs + m.objPtrMacs);
  assert.strictEqual(m.objScaling[3].macs, m.imgEncoderMacs + 8 * m.perObjectMacs);
  assert.strictEqual(m.units.perObjectMacs, 'macs');
  // métricas con unidad 'macs' en prosa: formato único fmt.ops
  assert.strictEqual(Q5.get('sam2-hiera-l.metrics.perObjectMacs').text, '310.43 GMACs');
  assert.strictEqual(Q5.get('sam-vit-h-1024.metrics.decoderMacsPerPrompt').text, '1.81 GMACs');
  assert.strictEqual(Q5.get('sam-vit-h-1024.metrics.encoderParams').text, '637,026,048');
});

test('F5 etiqueta + símbolo identifican una forma; byPath suma; aritmética; Quantities resuelve todas las claves', () => {
  for (const id of ['sam-vit-h-1024', 'sam-vit-b-1024', 'sam2-hiera-l', 'sam2-hiera-t']) {
    for (const ov of [{}, id.startsWith('sam2') ? { memFrames: 2 } : { maskIn: 1 }]) {
      const r = A5.run(id, ov), t = r.totals;
      const by = {};
      for (const tid of r.order) {
        const x = r.tensors[tid];
        const k = x.label + '|' + String(x.tex).split('=')[0].trim();
        (by[k] = by[k] || new Set()).add(x.num.join('×'));
      }
      for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
      assert.strictEqual(r.ops.reduce((s, o) => s + o.params * o.repeat, 0), t.params);
      assert.strictEqual(Object.values(t.byPrim).reduce((s, x) => s + x.macs, 0), t.macs);
      const check = (pp, want) => {
        const kids = children(r, pp);
        if (!kids.length) return;
        const at = (k) => t.byPath[pp.concat([k]).join('>')];
        assert.strictEqual(kids.reduce((s, k) => s + at(k).params, 0), want.params, id + ' params bajo ' + (pp.join('>') || 'raíz'));
        assert.strictEqual(kids.reduce((s, k) => s + at(k).macs, 0), want.macs, id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
        kids.forEach((k) => check(pp.concat([k]), at(k)));
      };
      check([], t);
      for (const tid of r.order) {
        const x = r.tensors[tid];
        if (x.producer) assert.ok(r.ops.find((o) => o.id === x.producer).out.includes(tid));
        x.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(tid)));
      }
      for (const op of r.ops) {
        if (op.params) assert.ok(op.paramArith.endsWith(A5.fmt.int(op.params)), id + ' ' + op.id + ' paramArith');
        if (op.macs) assert.ok(op.macArith.endsWith(A5.fmt.int(op.macs)), id + ' ' + op.id + ' macArith');
        assert.ok(!/undefined|NaN/.test(op.paramTex + op.macTex + op.shapeTex), id + ' ' + op.id + ' tex');
        assert.ok(Array.isArray(op.where) && op.where.length, id + ' ' + op.id + ' sin where');
      }
    }
    assert.strictEqual(A5.run(id), A5.run(id), 'memoizado');
    J(Q5.keys(id)).forEach((k) => assert.ok(Q5.get(id + '.' + k), id + '.' + k));
  }
  assert.strictEqual(Q5.get('sam-vit-h-1024.params.total').text, '641,090,608');
  assert.strictEqual(Q5.get('sam-vit-h-1024.tensor.tokens.sym').text, '(5+P+1)×C');
  assert.strictEqual(Q5.get('sam2-hiera-l.params.total').text, '224,446,642');
  assert.strictEqual(Q5.get('sam2-hiera-l.metrics.memoryBankMem').text, '7.35 MB');
});

// ---------------------------------------------------------------- fase 6 (LLM decoder: Llama 3, Llama 2, Mixtral)
// Contexto propio con todos los modelos hasta la fase 6.
const ATLAS6 = (function () {
  const ctx = vm.createContext({});
  for (const f of FILES.filter((x) => x !== 'js/core/quantities.js').concat(['js/arch/grounding-dino.js', 'js/arch/yolo-world.js', 'js/arch/sam.js', 'js/arch/llm.js', 'js/core/quantities.js'])) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('ATLAS', ctx);
})();
const A6 = ATLAS6.Arch, Q6 = ATLAS6.Quantities;
const S6 = (sym, num, layout) => A6.shape(sym, num, 'txt', layout || 'seq');
const LLM = ['llama3-8b', 'llama3-70b', 'llama2-7b', 'mixtral-8x7b'];
const LLM_DEC = ['llama3-8b-decode', 'mixtral-8x7b-decode'];   // configs de decode (revisión de la fase 6)

test('F6 el modelo llm y las primitivas nuevas no cambian ningún resultado de las fases 1–5', () => {
  for (const c of A5.configs()) {
    const a = A5.run(c.id).totals, b = A6.run(c.id).totals;
    assert.deepStrictEqual([b.params, b.macs, b.other], [a.params, a.macs, a.other], c.id);
    const ma = A5.metrics(c.id, {}), mb = A6.metrics(c.id, {});
    assert.deepStrictEqual([mb.attnMem, mb.actMem, mb.kvCache], [ma.attnMem, ma.actMem, ma.kvCache], c.id + ' metrics');
  }
  assert.ok(J(A6.models()).includes('llm'));
  assert.strictEqual(A6.canonical('llm'), 'llama3-8b');
  assert.deepStrictEqual(J(A6.configs('llm').map((c) => c.id)), LLM.concat(LLM_DEC));
  // MHA sin cambios: attention_scores con las mismas cabezas da el mismo detail de siempre (sin kvHeads)
  const q = A6.shape(['h', 'N', 'd_h'], [2, 5, 4], 'txt', 'heads');
  assert.strictEqual(A6.attention_scores(q, q).detail.kvHeads, undefined);
});

test('F6 primitivas: RoPE, cabezas GQA/MQA/MHA, scores y A·V con K/V compartidas, SwiGLU, LM head, KV cache', () => {
  // RoPE: sin parámetros ni MACs; ≈ 3 ops por elemento; d_h par
  const qh = A6.shape(['h', 'T', 'd_h'], [4, 6, 8], 'txt', 'heads');
  const rp = A6.rope(qh, { theta: 500000 });
  assert.deepStrictEqual([rp.params, rp.macs, rp.other, J(rp.out.num), rp.detail.pairs, rp.detail.theta], [0, 0, 4 * 6 * 8 * 3, [4, 6, 8], 4, 500000]);
  assert.throws(() => A6.rope(A6.shape(['h', 'T', 'd'], [1, 2, 3], 'txt', 'heads')), /par/);
  // split GQA: h = 8 cabezas de Q, G = 2 de K/V (grupos de 4); MQA (G = 1) y MHA (G = h)
  const q = S6(['T', 'D'], [5, 32]), k = S6(['T', 'G·d_h'], [5, 8]), v = S6(['T', 'G·d_h'], [5, 8]);
  const sp = A6.split_gqa_heads(q, k, v, { h: 8, G: 2 });
  assert.deepStrictEqual(J(sp.out.map((x) => x.num)), [[8, 5, 4], [2, 5, 4], [2, 5, 4]]);
  assert.deepStrictEqual(J(sp.out.map((x) => x.sym)), [['h', 'T', 'd_h'], ['G', 'T', 'd_h'], ['G', 'T', 'd_h']]);
  assert.deepStrictEqual([sp.detail.groups, sp.detail.kind], [4, 'GQA']);
  assert.strictEqual(A6.split_gqa_heads(q, S6(['T', 'd_h'], [5, 4]), S6(['T', 'd_h'], [5, 4]), { h: 8, G: 1 }).detail.kind, 'MQA');
  assert.strictEqual(A6.split_gqa_heads(q, S6(['T', 'D'], [5, 32]), S6(['T', 'D'], [5, 32]), { h: 8, G: 8 }).detail.kind, 'MHA');
  assert.throws(() => A6.split_gqa_heads(q, k, v, { h: 8, G: 3 }), /divisible/);
  assert.throws(() => A6.split_gqa_heads(q, S6(['T', 'x'], [5, 12]), v, { h: 8, G: 2 }), /G·d_h/);
  // scores y A·V: MACs h·T·S·d_h (los mismos que MHA); la cabeza KV g sirve a h/G cabezas de query
  const sc = A6.attention_scores(sp.out[0], sp.out[1]);
  assert.deepStrictEqual([J(sc.out.num), sc.macs, sc.detail.kvHeads, sc.detail.groups], [[8, 5, 5], 8 * 5 * 5 * 4, 2, 4]);
  const ws = A6.attention_weighted_sum(A6.softmax(sc.out).out, sp.out[2]);
  assert.deepStrictEqual([J(ws.out.num), ws.macs, ws.detail.groups], [[8, 5, 4], 8 * 5 * 5 * 4, 4]);
  assert.throws(() => A6.attention_scores(sp.out[0], A6.shape(['G', 'T', 'd_h'], [3, 5, 4], 'txt', 'heads')), /cabezas/);
  // SwiGLU: 3 matrices sin sesgo; mul = 1 op por elemento
  const x = S6(['T', 'D'], [5, 32]);
  const sw = A6.swiglu(x, { Dmlp: 48 });
  assert.deepStrictEqual([sw.params, sw.macs, J(sw.out.num)], [3 * 32 * 48, 3 * 5 * 32 * 48, [5, 32]]);
  assert.strictEqual(A6.mul(S6(['T', 'F'], [5, 48]), S6(['T', 'F'], [5, 48])).other, 5 * 48);
  assert.throws(() => A6.mul(S6(['T', 'F'], [5, 48]), S6(['T', 'F'], [5, 47])), /formas distintas/);
  // LM head: D·V sin sesgo; atada al embedding = 0 parámetros propios, mismos MACs
  const lm = A6.lm_head(x, { V: 100 });
  assert.deepStrictEqual([lm.prim, lm.params, lm.macs, J(lm.out.sym)], ['lm_head', 3200, 5 * 32 * 100, ['T', 'V']]);
  assert.deepStrictEqual([A6.lm_head(x, { V: 100, tied: true }).params, A6.lm_head(x, { V: 100, tied: true }).macs], [0, 16000]);
  const st = A6.sample_token(lm.out, {});
  assert.deepStrictEqual([J(st.out.num), st.params, st.macs], [[1], 0, 0]);
  // KV cache: (S−1) filas guardadas + 1 nueva
  const kv = A6.kv_append(A6.shape(['G', 'ctx-1', 'd_h'], [2, 9, 4], 'txt', 'heads'), A6.shape(['G', '1', 'd_h'], [2, 1, 4], 'txt', 'heads'), { sym: 'ctx' });
  assert.deepStrictEqual([J(kv.out.num), J(kv.out.sym), kv.params, kv.macs], [[2, 10, 4], ['G', 'ctx', 'd_h'], 0, 0]);
  assert.throws(() => A6.kv_append(A6.shape(['G', 'S', 'd'], [2, 9, 4], 'txt', 'heads'), A6.shape(['G', '1', 'd'], [3, 1, 4], 'txt', 'heads')), /cabezas/);
});

test('F6 compuestas: gqa_attention 2D² + 2D·G·d_h, llama_block, moe_ffn (parámetros ∝ E, MACs ∝ k)', () => {
  const D = 32, T = 5, h = 8, G = 2, dh = 4, F = 48;
  const x = S6(['T', 'D'], [T, D]);
  const at = A6.gqa_attention(x, { h, G });
  assert.strictEqual(at.params, 2 * D * D + 2 * D * G * dh);
  assert.strictEqual(at.macs, T * (2 * D * D + 2 * D * G * dh) + 2 * T * T * D);
  assert.strictEqual(at.detail.kvPerToken, 2 * G * dh);
  const mha = A6.gqa_attention(x, { h, G: h });
  assert.strictEqual(mha.params, 4 * D * D);                       // G = h: igual que MHA sin sesgos
  assert.strictEqual(mha.macs - at.macs, T * 2 * D * (h - G) * dh); // solo cambian W_K y W_V
  const bl = A6.llama_block(x, { h, G, Dmlp: F });
  assert.strictEqual(bl.params, 2 * D * D + 2 * D * G * dh + 3 * D * F + 2 * D);
  assert.strictEqual(bl.macs, T * (2 * D * D + 2 * D * G * dh + 3 * D * F) + 2 * T * T * D);
  // MoE: router D·E + 3·E·D·F parámetros; MACs T·D·E + 3·k·T·D·F
  const E = 8, k = 2;
  const mo = A6.moe_ffn(x, { E, k, Dmlp: F });
  assert.strictEqual(mo.params, D * E + 3 * E * D * F);
  assert.strictEqual(mo.macs, T * D * E + 3 * k * T * D * F);
  assert.deepStrictEqual([mo.detail.activeExpertParams, mo.detail.totalExpertParams], [3 * k * D * F, 3 * E * D * F]);
  const el = A6.expert_linear(S6(['2T', 'D'], [10, D]), { E, dout: F, doutSym: 'D_mlp' });
  assert.deepStrictEqual([el.params, el.macs, el.paramArith], [E * D * F, 10 * D * F, '8·32·48 = 12,288']);
  const tk = A6.moe_topk(S6(['T', 'E'], [T, E]), { k });
  assert.deepStrictEqual(J(tk.out.map((o) => o.num)), [[T, k], [T, k]]);
  assert.throws(() => A6.moe_topk(S6(['T', 'E'], [T, E]), { k: 9 }), /entre 1 y E/);
  assert.throws(() => A6.moe_combine(S6(['2T', 'D'], [9, D]), S6(['T', 'k'], [T, k])), /k·T/);
  const ids = J(A6.primitives()).map((p) => p.id);
  for (const id of ['rope', 'split_gqa_heads', 'mul', 'lm_head', 'sample_token', 'kv_append', 'moe_router', 'moe_topk', 'expert_linear', 'moe_combine',
    'swiglu', 'gqa_attention', 'llama_block', 'moe_ffn']) {
    assert.ok(ids.includes(id), id);
    assert.strictEqual(typeof A6[id], 'function', id);
  }
});

test('Llama 3 8B: 8,030,261,248 parámetros (HF = 8.03B) y 16,469,052,096,512 MACs de prefill con T = 2048, por bloque', () => {
  const r = A6.run('llama3-8b'), t = r.totals, n = t.byNode, q = r.quantities, c = r.config;
  const D = 4096, L = 32, h = 32, G = 8, dh = 128, F = 14336, V = 128256, T = 2048;
  assert.strictEqual(t.params, 8030261248);
  assert.strictEqual(q.layerParams, 2 * D * D + 2 * D * G * dh + 3 * D * F + 2 * D);    // 218,112,000
  assert.strictEqual(q.layerParams, 218112000);
  assert.deepStrictEqual([n.embed.params, n['lm-head'].params, n['final-norm'].params], [V * D, V * D, D]);
  assert.strictEqual(t.params, L * q.layerParams + 2 * V * D + D);
  assert.deepStrictEqual([q.qProjParamsLayer, q.kProjParamsLayer, q.vProjParamsLayer, q.oProjParamsLayer], [D * D, D * G * dh, D * G * dh, D * D]);
  assert.strictEqual(q.ffnParamsLayer, 3 * D * F);
  // MACs: T·(L·(lineales por token) + D·V) + L·2·h·T²·d_h (QKᵀ y A·V completos: la máscara no divide el conteo)
  assert.strictEqual(t.macs, T * (L * (2 * D * D + 2 * D * G * dh + 3 * D * F) + D * V) + L * 2 * h * T * T * dh);
  assert.strictEqual(t.macs, 16469052096512);
  assert.strictEqual(t.flops, 32938104193024);                // = FlopCounterMode de HF (crosscheck/expected/llama3-8b.json)
  assert.deepStrictEqual([c.T, c.ctx, c.B, c.bits, c.G, c.nKV, c.groupSize, c.attnKind, c.Dkv], [2048, 4096, 1, 16, 8, 8, 4, 'GQA', 1024]);
  // dónde viven los 8B: FFN 70 %, atención 17 %, embedding + LM head 13 %
  const m = A6.metrics('llama3-8b', {});
  assert.ok(Math.abs(m.ffnParamsShare - 0.702) < 0.001 && Math.abs(m.attnParamsShare - 0.167) < 0.001 && Math.abs(m.embedParamsShare - 0.131) < 0.001);
  assert.ok(Math.abs(m.ffnParamsShare + m.attnParamsShare + m.embedParamsShare + m.normParamsShare - 1) < 1e-12);
});

test('Llama 3 70B, Llama 2 7B y Mixtral 8×7B: parámetros = HF; Mixtral 12,879,925,248 activos de 46,702,792,704', () => {
  const p = (id) => A6.run(id).totals.params;
  assert.deepStrictEqual(LLM.map(p), [8030261248, 70553706496, 6738415616, 46702792704]);
  const l2 = A6.run('llama2-7b');
  assert.deepStrictEqual([l2.config.attnKind, l2.config.G, l2.config.V], ['MHA', 32, 32000]);
  assert.strictEqual(l2.quantities.layerParams, 4 * 4096 * 4096 + 3 * 4096 * 11008 + 2 * 4096);
  const mx = A6.run('mixtral-8x7b'), q = mx.quantities, D = 4096, F = 14336, L = 32;
  assert.strictEqual(q.expertParams, 3 * D * F);
  assert.strictEqual(q.routerParams, L * D * 8);
  assert.strictEqual(q.activeParams, 12879925248);
  assert.strictEqual(q.activeParams, mx.totals.params - 6 * L * 3 * D * F);
  assert.deepStrictEqual([mx.config.nExperts, mx.config.topK, mx.config.E, mx.config.topk], [8, 2, 8, 2]);
  // MACs por token del FFN MoE: router + 2 expertos (no 8)
  assert.strictEqual(mx.totals.byNode.ffn.macs, 2048 * L * (D * 8 + 2 * 3 * D * F));
  const m = A6.metrics('mixtral-8x7b', {});
  assert.ok(Math.abs(m.activeParamsShare - 0.2758) < 0.001);
  assert.ok(m.expertsParamsShare > 0.96);
});

test('llm: ids y formas de SPEC §18.1 (nodos, tensores, paths) en prefill; MoE en Mixtral', () => {
  const r = A6.run('llama3-8b'), n = r.totals.byNode;
  const T = 2048;
  for (const id of ['embed', 'blocks', 'block', 'final-norm', 'lm-head', 'sample', 'norm1', 'attn', 'res1', 'norm2', 'ffn', 'res2',
    'q-proj', 'k-proj', 'v-proj', 'rope', 'split', 'scores', 'mask', 'scale', 'softmax', 'weighted-sum', 'merge', 'o-proj',
    'gate-proj', 'up-proj', 'silu', 'mul', 'down-proj']) assert.ok(n[id], 'nodo ' + id);
  const sh = (id) => r.tensors[id].num.join('×');
  const want = { ids: '2048', x0: T + '×4096', 'h-norm1': T + '×4096', q: T + '×4096', k: T + '×1024', v: T + '×1024', 'q-rope': '32×2048×128', 'k-rope': '8×2048×128',
    scores: '32×2048×2048', attn: '32×2048×2048', z: T + '×4096', o: T + '×4096', r1: T + '×4096', 'h-norm2': T + '×4096', gate: T + '×14336', up: T + '×14336',
    act: T + '×14336', prod: T + '×14336', f: T + '×4096', 'x-out': T + '×4096', 'x-norm': T + '×4096', logits: T + '×128256', 'next-token': '1',
    'q-heads': '32×2048×128', 'k-heads': '8×2048×128', 'v-heads': '8×2048×128', 'scores-scaled': '32×2048×2048', masked: '32×2048×2048', 'z-heads': '32×2048×128' };
  for (const [id, s] of Object.entries(want)) assert.strictEqual(sh(id), s, id);
  assert.deepStrictEqual(J(r.tensors.k.sym), ['T', 'G·d_h']);
  assert.deepStrictEqual(J(r.tensors['k-rope'].sym), ['G', 'T', 'd_h']);
  assert.deepStrictEqual(J(r.tensors.logits.sym), ['T', 'V']);
  const op = (id) => r.ops.find((o) => o.id === id);
  assert.deepStrictEqual(J(op('q-proj').path), ['blocks', 'block', 'attn', 'q-proj']);
  assert.deepStrictEqual(J(op('rope-k').path), ['blocks', 'block', 'attn', 'rope']);
  assert.deepStrictEqual(J(op('gate-proj').path), ['blocks', 'block', 'ffn', 'gate-proj']);
  assert.deepStrictEqual(J(op('norm1').path), ['blocks', 'block', 'norm1']);
  assert.deepStrictEqual([op('q-proj').repeat, op('embed').repeat, op('lm-head').repeat], [32, 1, 1]);
  assert.deepStrictEqual(J(op('scores').in), ['q-rope', 'k-rope']);
  assert.deepStrictEqual(J(op('weighted-sum').in), ['attn', 'v-heads']);
  assert.strictEqual(op('mask').prim, 'causal_mask');
  // Mixtral: router, top-k, expertos (filas enrutadas 2T), combine
  const mx = A6.run('mixtral-8x7b'), mn = mx.totals.byNode;
  for (const id of ['router', 'topk', 'experts', 'combine', 'dispatch', 'gate-proj', 'down-proj']) assert.ok(mn[id], 'Mixtral nodo ' + id);
  const ms = (id) => mx.tensors[id].num.join('×');
  assert.deepStrictEqual(['router-logits', 'topk-weights', 'x-routed', 'gate', 'expert-out', 'f'].map(ms), ['2048×8', '2048×2', '4096×4096', '4096×14336', '4096×4096', '2048×4096']);
  assert.deepStrictEqual(J(mx.tensors.gate.sym), ['2T', 'D_mlp']);
  assert.deepStrictEqual(J(mx.ops.find((o) => o.id === 'gate-proj').path), ['blocks', 'block', 'ffn', 'experts', 'gate-proj']);
  assert.strictEqual(mn.experts.params, 32 * 8 * 3 * 4096 * 14336);
});

test('llm decode: 1 token, la atención lee ctx filas de la KV cache; MACs = lineales por token + 2·L·h·ctx·d_h', () => {
  const d = A6.run('llama3-8b', { decode: 1 }), p = A6.run('llama3-8b');
  const L = 32, h = 32, dh = 128, ctx = 4096;
  assert.strictEqual(d.config.Tq, 1);
  assert.match(d.label, /decode \(ctx = 4,096\)/);
  const sh = (id) => d.tensors[id].num.join('×');
  assert.deepStrictEqual(['ids', 'x0', 'q', 'k', 'q-rope', 'k-rope', 'k-past', 'k-ctx', 'v-ctx', 'scores', 'attn', 'z', 'logits'].map(sh),
    ['1', '1×4096', '1×4096', '1×1024', '32×1×128', '8×1×128', '8×4095×128', '8×4096×128', '8×4096×128', '32×1×4096', '32×1×4096', '1×4096', '1×128256']);
  assert.deepStrictEqual(J(d.tensors['k-ctx'].sym), ['G', 'ctx', 'd_h']);
  assert.ok(!d.ops.some((o) => o.id === 'mask'), 'sin máscara en decode');
  assert.deepStrictEqual(J(d.ops.find((o) => o.id === 'kv-append-k').path), ['blocks', 'block', 'attn', 'kv-cache']);
  assert.strictEqual(d.totals.params, p.totals.params);
  const lin = (p.totals.macs - L * 2 * h * 2048 * 2048 * dh) / 2048;
  assert.strictEqual(d.totals.macs, lin + 2 * L * h * ctx * dh);
  assert.strictEqual(d.totals.flops, 17156800512);           // = HF con DynamicCache (override_checks del JSON)
  assert.strictEqual(p.quantities.decodeMacsPerToken, d.totals.macs);
  assert.strictEqual(p.quantities.decodeLinearMacs, lin);
  for (const id of LLM) {
    const pr = A6.run(id), dc = A6.run(id, { decode: 1, ctx: 8192 });
    assert.strictEqual(A6.run(id, { ctx: 8192 }).quantities.decodeMacsPerToken, dc.totals.macs, id);
    assert.strictEqual(pr.quantities.prefillMacs, pr.totals.macs, id);
    assert.strictEqual(dc.quantities.prefillMacs, pr.totals.macs, id + ' prefill analítico desde el grafo decode');
  }
  assert.throws(() => A6.run('llama3-8b', { decode: 1, ctx: 1 }), /ctx debe ser ≥ 2/);
  assert.throws(() => A6.run('llama3-8b', { decode: 2 }), /decode debe ser 1/);
});

test('llm configs de decode: llama3-8b-decode y mixtral-8x7b-decode = el modelo con decode = 1 (formas, MACs y métricas)', () => {
  for (const [dc, of] of [['llama3-8b-decode', 'llama3-8b'], ['mixtral-8x7b-decode', 'mixtral-8x7b']]) {
    const d = A6.run(dc), ref = A6.run(of, { decode: 1 });
    assert.strictEqual(d.config.decode, 1);
    assert.strictEqual(d.config.decodeOf, of);
    assert.strictEqual(d.config.canonical, false);
    assert.deepStrictEqual([d.totals.params, d.totals.macs], [ref.totals.params, ref.totals.macs], dc);
    for (const tid of ref.order) assert.strictEqual(d.tensors[tid].num.join('×'), ref.tensors[tid].num.join('×'), dc + ' ' + tid);
    assert.match(d.label, /· decode \(ctx = 4,096\)$/);
    assert.ok(!/decode.*decode/.test(d.label), d.label);
    // métricas = las de la config de prefill (el prefill se corre en decodeOf)
    const md = A6.metrics(dc, {}), mp = A6.metrics(of, {});
    for (const k of ['prefillMacs', 'decodeMacsPerToken', 'weightBytes', 'kvCacheBytes', 'decodeTokPerSecUpperBound', 'arithmeticIntensityPrefill', 'maxBatchInHbm']) assert.strictEqual(md[k], mp[k], dc + ' ' + k);
    assert.strictEqual(A6.metrics(dc, { ctx: 8192, bits: 4 }).decodeTokPerSecUpperBound, A6.metrics(of, { ctx: 8192, bits: 4 }).decodeTokPerSecUpperBound);
  }
  const d = A6.run('llama3-8b-decode');
  assert.deepStrictEqual(['q', 'k-past', 'k-ctx', 'scores', 'logits'].map((id) => d.tensors[id].num.join('×')), ['1×4096', '8×4095×128', '8×4096×128', '32×1×4096', '1×128256']);
  assert.strictEqual(d.totals.flops, 17156800512);                         // = HF con DynamicCache
  assert.strictEqual(A6.run('llama3-8b-decode', { ctx: 8192 }).tensors['k-ctx'].num.join('×'), '8×8192×128');
  assert.strictEqual(A6.canonical('llm'), 'llama3-8b');
});

test('llm knobs: nKV (MHA/GQA/MQA what-if), T, bits, ctx más allá del entrenamiento; errores en español', () => {
  const base = A6.run('llama3-8b');
  const mha = A6.run('llama3-8b', { nKV: 32 }), mqa = A6.run('llama3-8b', { nKV: 1 });
  assert.strictEqual(mha.totals.params - base.totals.params, 32 * 2 * 4096 * (4096 - 1024));
  assert.deepStrictEqual([mha.totals.params, mqa.totals.params], [8835567616, 7795380224]);     // = HF con num_key_value_heads = 32 / 1
  assert.deepStrictEqual([mha.config.attnKind, mqa.config.attnKind], ['MHA', 'MQA']);
  assert.match(mha.label, /MHA \(n_kv = 32\)/);
  assert.ok(mha.notes.some((x) => /What-if/.test(x)));
  // la KV cache escala con G; los MACs de QKᵀ y A·V no
  const km = (ov) => A6.metrics('llama3-8b', ov).kvBytesPerToken;
  assert.deepStrictEqual([km({ nKV: 32 }), km({}), km({ nKV: 1 })], [524288, 131072, 16384]);
  const sc = (r) => r.ops.filter((o) => o.prim === 'attention_scores' || o.prim === 'attention_weighted_sum').reduce((s, o) => s + o.macs * o.repeat, 0);
  assert.strictEqual(sc(mha), sc(base));
  assert.strictEqual(A6.run('llama3-8b', { T: 64 }).totals.flops, 962743762944);   // = HF con T = 64
  assert.throws(() => A6.run('llama3-8b', { nKV: 5 }), /no divide/);
  assert.throws(() => A6.run('llama3-8b', { bits: 3 }), /bits debe ser 4, 8, 16 o 32/);
  assert.throws(() => A6.run('llama3-8b', { res: 224 }), /Knob inválido/);
  assert.ok(A6.run('llama3-8b', { ctx: 131072 }).notes.some((x) => /131,072 con escalado de RoPE/.test(x)));
  assert.ok(A6.run('llama2-7b', { T: 8192 }).notes.some((x) => /supera el contexto de entrenamiento/.test(x)));
  // bits no cambia la arquitectura (mismos params y MACs), solo los bytes
  assert.deepStrictEqual([A6.run('llama3-8b', { bits: 4 }).totals.params, A6.run('llama3-8b', { bits: 4 }).totals.macs], [base.totals.params, base.totals.macs]);
});

test('llm metrics: KV cache, pesos por bits, intensidad aritmética prefill ≫ ridge ≫ decode, cotas de tokens/s (≈)', () => {
  const m = A6.metrics('llama3-8b', {});
  const L = 32, G = 8, dh = 128;
  assert.strictEqual(m.kvBytesPerToken, 2 * L * G * dh * 2);                 // 131,072 B = 128 KiB por token en bf16
  assert.strictEqual(m.kvCacheBytes, 131072 * 4096);
  assert.strictEqual(m.kvCache, m.kvCacheBytes);
  assert.strictEqual(m.kvCacheBytesMHA, 4 * m.kvCacheBytes);
  assert.strictEqual(m.kvSavingVsMHA, 4);
  assert.strictEqual(A6.metrics('llama3-8b', { ctx: 8192, B: 8 }).kvCacheBytes, 131072 * 8192 * 8);
  assert.strictEqual(A6.metrics('llama3-8b', { kvBits: 8 }).kvBytesPerToken, 65536);
  assert.strictEqual(A6.metrics('llama3-8b', { bits: 8 }).kvBytesPerToken, 131072);     // bits = solo los pesos
  assert.strictEqual(A6.metrics('llama2-7b', {}).kvBytesPerToken, 524288);   // MHA: 4× Llama 3 8B
  // pesos INT-k realistas: solo las lineales de los bloques a k bits; embedding, LM head y normas en 16 (GPTQ/AWQ)
  const lin = 6979321856, unq = 8030261248 - lin;      // 32·218,112,000 − normas; 2·128,256·4096 + 65·4096
  assert.deepStrictEqual([m.quantizedParams, m.unquantizedParams], [lin, unq]);
  assert.deepStrictEqual([m.weightBytes, m.weightBytes16, m.weightBytes8, m.weightBytes4], [2 * 8030261248, 2 * 8030261248, lin + 2 * unq, lin / 2 + 2 * unq]);
  const m4 = A6.metrics('llama3-8b', { bits: 4 });
  assert.strictEqual(m4.weightBytes, 5591539712);                                   // ≈ 5.6 GB, no 4.02 GB = P/2
  assert.deepStrictEqual([m4.quantizedLinearBytes, m4.unquantizedBytes], [lin / 2, 2 * unq]);
  assert.strictEqual(m4.kvBytesPerToken, 131072);                                   // KV sigue en bf16 (kvBits = 16)
  assert.strictEqual(m4.decodeWeightBytesRead, lin / 2 + 2 * (unq - 525336576) + 4096 * 2);
  assert.ok(Math.abs(m4.decodeTokPerSecUpperBound - 659.74) < 0.01, String(m4.decodeTokPerSecUpperBound));   // ≈ 3.1× los 215 de bf16
  assert.strictEqual(m4.maxBatchInHbm, Math.floor((80e9 - 5591539712) / (131072 * 4096)));
  // kvBits: KV a 8 bits; pesos sin cambio
  const k8 = A6.metrics('llama3-8b', { kvBits: 8 });
  assert.deepStrictEqual([k8.kvCacheBytes, k8.weightBytes, k8.decodeKvBytesRead], [65536 * 4096, 2 * 8030261248, 65536 * 4096]);
  assert.strictEqual(k8.maxBatchInHbm, Math.floor((80e9 - 2 * 8030261248) / (65536 * 4096)));
  assert.deepStrictEqual(J(m4.kvBitsScaling.map((x) => x.kvBytesPerToken)), [131072, 65536, 32768]);
  assert.deepStrictEqual(J(m.bitsScaling.map((x) => x.weightBytes)), [m.weightBytes16, m.weightBytes8, m.weightBytes4]);
  assert.ok(m.bitsScaling.every((x) => x.kvCacheBytes === m.kvCacheBytes));
  assert.strictEqual(m.bitsScaling[2].tokPerSec, m4.decodeTokPerSecUpperBound);
  assert.throws(() => A6.run('llama3-8b', { kvBits: 3 }), /kvBits debe ser 4, 8, 16 o 32/);
  // ¿cabe en la HBM? pesos + KV de ctx × B; B = 256 con 4096 tokens no cabe en 80 GB (máx. 119)
  assert.deepStrictEqual([m.kvPlusWeightsBytes, m.fitsInHbm, m.hbmHeadroomBytes], [m.weightBytes + m.kvCacheBytes, true, 80e9 - m.weightBytes - m.kvCacheBytes]);
  const m256 = A6.metrics('llama3-8b', { B: 256 });
  assert.strictEqual(m256.fitsInHbm, false);
  assert.ok(m256.hbmHeadroomBytes < 0);
  assert.deepStrictEqual(J(m.batchScaling.map((x) => x.fitsInHbm)), [true, true, true, true, false, false]);
  assert.strictEqual(A6.metrics('llama3-70b', {}).fitsInHbm, false);
  // Mixtral a 4 bits: router en 16 bits; activos = sin los 6 expertos que no usa un token
  const x4 = A6.metrics('mixtral-8x7b', { bits: 4 }), xq = A6.run('mixtral-8x7b').quantities;
  assert.strictEqual(x4.unquantizedParams, xq.embedParams + xq.lmHeadParams + xq.normParams + xq.routerParams);
  assert.strictEqual(x4.activeWeightBytes, (x4.quantizedParams - 6 * 32 * xq.expertParams) / 2 + 2 * x4.unquantizedParams);
  // bytes por paso de decode (B = 1) = pesos menos la tabla de embedding + 1 fila + KV leída
  const q = A6.run('llama3-8b').quantities;
  assert.strictEqual(m.decodeBytesPerStep, (8030261248 - q.embedParams) * 2 + 4096 * 2 + 131072 * 4096);
  assert.strictEqual(m.decodeKvBytesRead, 131072 * 4096);
  // intensidad: decode ≈ 1 FLOP/B (memoria), prefill ≈ 2000 FLOP/B (cómputo); ridge H100 ≈ 295
  assert.ok(m.arithmeticIntensityDecode > 1 && m.arithmeticIntensityDecode < 1.2, String(m.arithmeticIntensityDecode));
  assert.ok(m.arithmeticIntensityPrefill > 2000, String(m.arithmeticIntensityPrefill));
  assert.ok(Math.abs(m.ridgePoint - 989 / 3.35) < 1e-9);
  assert.deepStrictEqual([m.decodeBound, m.prefillBound], ['memoria', 'cómputo']);
  // cota de decode con B = 1 = bandwidth / bytes (limitada por memoria); el doble de ancho de banda, el doble de tokens/s
  assert.ok(Math.abs(m.decodeTokPerSecUpperBound - 3.35e12 / m.decodeBytesPerStep) < 1e-9);
  const m2 = A6.metrics('llama3-8b', { bandwidth: 6.7e12 });
  assert.ok(Math.abs(m2.decodeTokPerSecUpperBound / m.decodeTokPerSecUpperBound - 2) < 1e-12);
  assert.strictEqual(m2.bandwidth, 6.7e12);
  assert.throws(() => A6.metrics('llama3-8b', { bandwidth: -1 }), /bandwidth debe ser un número positivo/);
  // batch: la intensidad de decode crece con B (los pesos se leen una vez por paso)
  const bs = m.batchScaling;
  assert.ok(bs.every((x, i) => i === 0 || x.intensity > bs[i - 1].intensity));
  assert.ok(bs.every((x, i) => i === 0 || x.tokPerSec > bs[i - 1].tokPerSec));
  assert.strictEqual(A6.metrics('llama3-8b', { B: 32 }).arithmeticIntensityDecode, bs.find((x) => x.B === 32).intensity);
  // ctx: la KV leída crece y los tokens/s bajan
  assert.ok(m.ctxScaling.every((x, i) => i === 0 || x.tokPerSec < m.ctxScaling[i - 1].tokPerSec));
  // memoria: secuencias de 4096 tokens que caben en 80 GB después de los pesos; 70B en bf16 no cabe en una GPU
  assert.strictEqual(m.maxBatchInHbm, Math.floor((80e9 - 2 * 8030261248) / (131072 * 4096)));
  assert.strictEqual(A6.metrics('llama3-70b', {}).maxBatchInHbm, 0);
  // causal: el trabajo útil de QKᵀ y A·V es T(T+1)/2 de las T² entradas
  assert.ok(Math.abs(m.prefillScoreMacsCausal / m.prefillScoreMacs - 2049 / 4096) < 1e-12);
  assert.strictEqual(m.prefillMacsLastLogits, m.prefillMacs - 2047 * 4096 * 128256);
  // "2 FLOPs por parámetro y token" (más los scores con ctx = 4096; la tabla de embedding no calcula)
  assert.ok(m.decodeFlopsPerParam > 1.8 && m.decodeFlopsPerParam < 2.2);
  assert.strictEqual(2 * m.decodeLinearMacs, 2 * (8030261248 - q.embedParams - 65 * 4096));   // lineales = 1 MAC por peso (sin normas)
  // cruce scores vs lineales: T = D + G·d_h + 1.5·D_mlp
  assert.strictEqual(m.crossoverN, 4096 + 1024 + 1.5 * 14336);
  // Mixtral: decode lee solo 2 expertos por capa con B = 1; con B = 8 casi todos
  const mx = A6.metrics('mixtral-8x7b', {}), mq = A6.run('mixtral-8x7b').quantities;
  assert.strictEqual(mx.decodeExpertsReadPerLayer, 2);
  assert.ok(A6.metrics('mixtral-8x7b', { B: 8 }).decodeExpertsReadPerLayer > 7);
  assert.strictEqual(mx.decodeWeightBytesRead, (mq.activeParams - mq.embedParams) * 2 + 4096 * 2);
  // quantities y metrics usan el mismo modelo de costo
  for (const id of LLM.concat(LLM_DEC)) for (const ov of [{}, { B: 8, ctx: 8192, bits: 8 }, { bits: 4, kvBits: 8 }]) {
    const mm = A6.metrics(id, ov), qq = A6.run(id, ov).quantities;
    for (const k of ['kvCacheBytes', 'weightBytes', 'decodeMacsPerToken', 'decodeBytesPerStep', 'prefillBytes', 'arithmeticIntensityDecode', 'arithmeticIntensityPrefill', 'decodeTokPerSecUpperBound', 'prefillMacs']) {
      assert.ok(Math.abs(mm[k] - qq[k]) <= 1e-9 * Math.abs(mm[k]), id + ' ' + JSON.stringify(ov) + ' ' + k + ': ' + mm[k] + ' vs ' + qq[k]);
    }
  }
});

test('llm metrics: unidades conocidas por la práctica, toda …Macs con unidad; Quantities formatea bytes y MACs', () => {
  const allowed = ['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'];
  for (const id of LLM) {
    const m = A6.metrics(id, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(allowed.includes(u), id + ' ' + k + ': ' + u);
    for (const k of Object.keys(m)) {
      if (typeof m[k] !== 'number') continue;
      if (/Macs$|Bytes|Params$|PerSec|Intensity/.test(k) && !/^(attnMacs|scoreMacs)$/.test(k)) assert.ok(m.units[k], id + ' ' + k + ' sin unidad');
      assert.ok(isFinite(m[k]), id + ' ' + k);
    }
  }
  assert.strictEqual(Q6.get('llama3-8b.metrics.kvBytesPerToken').text, '131.1 KB');
  assert.strictEqual(Q6.get('llama3-8b.metrics.kvCacheBytes').text, '536.9 MB');
  assert.strictEqual(Q6.get('llama3-8b.metrics.weightBytes').text, '16.1 GB');
  assert.strictEqual(Q6.get('llama3-8b.metrics.decodeMacsPerToken').text, '8.58 GMACs');
  assert.strictEqual(Q6.get('llama3-8b.metrics.kvSavingVsMHA').text, '4');
  assert.strictEqual(Q6.get('llama3-8b.params.total').text, '8,030,261,248');
  assert.strictEqual(Q6.get('mixtral-8x7b.activeParams').text, '12,879,925,248');
  assert.strictEqual(Q6.get('llama3-8b.tensor.k.sym').text, 'T×G·d_h');
  assert.strictEqual(Q6.get('llama3-8b.cfg.G').text, '8');
});

test('F6 etiqueta + símbolo identifican una forma; byPath suma; aritmética; where; Quantities resuelve todas las claves', () => {
  for (const id of LLM.concat(LLM_DEC)) {
    for (const ov of [{}, { decode: 1 }, { nKV: 1 }]) {
      const r = A6.run(id, ov), t = r.totals;
      const by = {};
      for (const tid of r.order) {
        const x = r.tensors[tid];
        const k = x.label + '|' + String(x.tex).split('=')[0].trim();
        (by[k] = by[k] || new Set()).add(x.num.join('×'));
      }
      for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
      assert.strictEqual(r.ops.reduce((s, o) => s + o.params * o.repeat, 0), t.params);
      assert.strictEqual(Object.values(t.byPrim).reduce((s, x) => s + x.macs, 0), t.macs);
      const check = (pp, want) => {
        const kids = children(r, pp);
        if (!kids.length) return;
        const at = (k) => t.byPath[pp.concat([k]).join('>')];
        assert.strictEqual(kids.reduce((s, k) => s + at(k).params, 0), want.params, id + ' params bajo ' + (pp.join('>') || 'raíz'));
        assert.strictEqual(kids.reduce((s, k) => s + at(k).macs, 0), want.macs, id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
        kids.forEach((k) => check(pp.concat([k]), at(k)));
      };
      check([], t);
      for (const tid of r.order) {
        const x = r.tensors[tid];
        if (x.producer) assert.ok(r.ops.find((o) => o.id === x.producer).out.includes(tid));
        x.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(tid)));
      }
      for (const op of r.ops) {
        if (op.params) assert.ok(op.paramArith.endsWith(A6.fmt.int(op.params)), id + ' ' + op.id + ' paramArith');
        if (op.macs) assert.ok(op.macArith.endsWith(A6.fmt.int(op.macs)), id + ' ' + op.id + ' macArith');
        assert.ok(!/undefined|NaN/.test(op.paramTex + op.macTex + op.shapeTex), id + ' ' + op.id + ' tex');
        assert.ok(Array.isArray(op.where) && op.where.length, id + ' ' + op.id + ' sin where');
      }
    }
    assert.strictEqual(A6.run(id), A6.run(id), 'memoizado');
    J(Q6.keys(id)).forEach((k) => assert.ok(Q6.get(id + '.' + k), id + '.' + k));
  }
});

// ---------------------------------------------------------------- fase 7 (VLM: LLaVA-1.5, Qwen2-VL)
// Contexto propio con todos los modelos hasta la fase 7 (vlm.js compone el decoder de llm.js: va después).
const ATLAS7 = (function () {
  const ctx = vm.createContext({});
  for (const f of FILES.filter((x) => x !== 'js/core/quantities.js').concat(['js/arch/grounding-dino.js', 'js/arch/yolo-world.js', 'js/arch/sam.js', 'js/arch/llm.js', 'js/arch/vlm.js', 'js/core/quantities.js'])) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('ATLAS', ctx);
})();
const A7 = ATLAS7.Arch, Q7 = ATLAS7.Quantities;
const LLAVA = ['llava15-7b', 'llava15-13b'], QWEN = ['qwen2-vl-7b', 'qwen2-vl-2b', 'qwen2-vl-72b'];
const S7 = (sym, num, mod, layout) => A7.shape(sym, num, mod || 'img', layout || 'seq');

test('F7 los modelos llava / qwen2-vl y las primitivas nuevas no cambian ningún resultado de las fases 1–6', () => {
  for (const c of A6.configs()) {
    const a = A6.run(c.id).totals, b = A7.run(c.id).totals;
    assert.deepStrictEqual([b.params, b.macs, b.other], [a.params, a.macs, a.other], c.id);
    const ma = A6.metrics(c.id, {}), mb = A7.metrics(c.id, {});
    assert.deepStrictEqual([mb.attnMem, mb.actMem, mb.kvCache, mb.decodeMacsPerToken], [ma.attnMem, ma.actMem, ma.kvCache, ma.decodeMacsPerToken], c.id + ' metrics');
  }
  assert.ok(J(A7.models()).includes('llava') && J(A7.models()).includes('qwen2-vl'));
  assert.strictEqual(A7.canonical('llava'), 'llava15-7b');
  assert.strictEqual(A7.canonical('qwen2-vl'), 'qwen2-vl-7b');
  assert.deepStrictEqual(J(A7.configs('llava').map((c) => c.id)), LLAVA);
  assert.deepStrictEqual(J(A7.configs('qwen2-vl').map((c) => c.id)), QWEN);
  // preLnLayer sin las opciones nuevas: la capa de ViT de siempre (símbolos h, d_h, D_mlp)
  const r = A7.run('vit-b16-224');
  assert.deepStrictEqual(J(r.tensors.q.sym), ['h', 'N+1', 'd_h']);
  assert.deepStrictEqual(J(r.tensors.u.sym), ['N+1', 'D_mlp']);
});

test('F7 primitivas: repeat_frames, patch_embed_3d, flatten_nd, segment_rows, group_tokens, splice_tokens, mrope, mrope_ids', () => {
  // imagen 28×42×3 → 2 frames → Conv3d 2×14×14 a D = 8: 2·3 parches, k_t·P²·C·D parámetros sin sesgo
  const img = S7(['H', 'W', 'C'], [28, 42, 3], 'img', 'grid');
  const fr = A7.repeat_frames(img, { k: 2, sym: '2' });
  assert.deepStrictEqual([J(fr.out.num), J(fr.out.sym), fr.params, fr.macs], [[2, 28, 42, 3], ['2', 'H', 'W', 'C'], 0, 0]);
  const pe = A7.patch_embed_3d(fr.out, { kt: 2, k: 14, cout: 8, coutSym: 'D_v', outSym: ['F/2', 'H/P', 'W/P'], squeeze: true });
  assert.deepStrictEqual([J(pe.out.num), J(pe.out.sym), pe.params, pe.macs, pe.detail.patchDim], [[2, 3, 8], ['H/P', 'W/P', 'D_v'], 2 * 14 * 14 * 3 * 8, 6 * 8 * 2 * 14 * 14 * 3, 1176]);
  assert.ok(pe.paramArith.endsWith(A7.fmt.int(pe.params)) && pe.macArith.endsWith(A7.fmt.int(pe.macs)));
  // video de 4 frames: 2 parches temporales (sin squeeze)
  const vid = A7.patch_embed_3d(S7(['F', 'H', 'W', 'C'], [4, 28, 28, 3], 'img', 'grid'), { kt: 2, k: 14, cout: 8, squeeze: true });
  assert.deepStrictEqual(J(vid.out.num), [2, 2, 2, 8]);
  assert.throws(() => A7.patch_embed_3d(S7(['F', 'H', 'W', 'C'], [3, 28, 28, 3], 'img', 'grid'), { kt: 2, k: 14, cout: 8 }), /múltiplo/);
  assert.throws(() => A7.patch_embed_3d(fr.out.num ? S7(['F', 'H', 'W', 'C'], [2, 30, 28, 3], 'img', 'grid') : null, { kt: 2, k: 14, cout: 8 }), /divisible/);
  const fl = A7.flatten_nd(vid.out, { sym: ['N_p', 'D_v'] });
  assert.deepStrictEqual([fl.prim, J(fl.out.num)], ['flatten', [8, 8]]);
  const sg = A7.segment_rows(fl.out, { k: 2, sym: ['F/2', 'H/P·W/P'] });
  assert.deepStrictEqual([J(sg.out.num), sg.out.layout], [[2, 4, 8], 'windows']);
  assert.throws(() => A7.segment_rows(fl.out, { k: 3 }), /segmentos/);
  // atención por segmento: scores 2×h×4×4 (sin término entre segmentos)
  const qh = A7.split_heads(A7.linear(sg.out, { dout: 24, bias: false }).out, { h: 2, parts: 3 }).out;
  assert.strictEqual(A7.attention_scores(qh[0], qh[1]).macs, 2 * 2 * 4 * 4 * 4);
  // merge 2×2: R×C → R/4 × 4C (vista)
  const gp = A7.group_tokens(fl.out, { k: 4, sym: 'N', dSym: '4D_v' });
  assert.deepStrictEqual([J(gp.out.num), J(gp.out.sym), gp.params, gp.macs], [[2, 32], ['N', '4D_v'], 0, 0]);
  assert.throws(() => A7.group_tokens(S7(['R', 'C'], [6, 8]), { k: 4 }), /agrupan/);
  // splice: T×D + copies·N×D → (N+T)×D; anchos distintos = falta el proyector
  const te = S7(['T', 'D'], [5, 16], 'txt'), vt = S7(['N_p', 'D'], [9, 16]);
  const sp = A7.splice_tokens(te, vt, { copies: 2, sym: 'N+T' });
  assert.deepStrictEqual([J(sp.out.num), J(sp.out.sym), sp.detail.visual, sp.params, sp.macs], [[23, 16], ['N+T', 'D'], 18, 0, 0]);
  assert.throws(() => A7.splice_tokens(te, S7(['N', 'D_v'], [9, 8])), /proyector/);
  // M-RoPE: secciones que suman d_h/2; mismo costo que RoPE
  const hq = S7(['h', 'S', 'd_h'], [2, 7, 128], 'txt', 'heads');
  const mr = A7.mrope(hq, { theta: 1e6, sections: [16, 24, 24] });
  assert.deepStrictEqual([mr.params, mr.macs, mr.other, J(mr.detail.sections)], [0, 0, A7.rope(hq, {}).other, [16, 24, 24]]);
  assert.throws(() => A7.mrope(hq, { sections: [16, 24, 23] }), /suman/);
  const ids = A7.mrope_ids({ S: 7, sym: 'N+T', span: 5 });
  assert.deepStrictEqual([J(ids.out.num), J(ids.out.sym), ids.detail.span], [[3, 7], ['3', 'N+T'], 5]);
});

test('F7 importGraph: el decoder de llm.js dentro de otro grafo, con los mismos números; preLnLayer con símbolos y RoPE', () => {
  const def = A7.model('llm');
  const cf = def.resolve(Object.assign({}, def.configs['llama2-7b'], { T: 16, label: 'x' }));
  const src = def.build(cf, A7)._data();
  const g = A7.graph({});
  g.input('prompt', S7(['S', 'D'], [16, 4096], 'txt'));
  A7.importGraph(g, src, { skip: ['embed'], inputs: { x0: 'prompt' }, sym: { T: 'S' }, path: (p) => ['llm'].concat(p) });
  const d = g._data();
  const want = src.ops.filter((o) => o.id !== 'embed');
  assert.strictEqual(d.ops.length, want.length);
  assert.strictEqual(d.ops.reduce((s, o) => s + o.params * o.repeat, 0), want.reduce((s, o) => s + o.params * o.repeat, 0));
  assert.strictEqual(d.ops.reduce((s, o) => s + o.macs * o.repeat, 0), want.reduce((s, o) => s + o.macs * o.repeat, 0));
  assert.deepStrictEqual(J(d.tensors.q.sym), ['S', 'D']);
  assert.deepStrictEqual(J(d.ops.find((o) => o.id === 'q-proj').path), ['llm', 'blocks', 'block', 'attn', 'q-proj']);
  assert.deepStrictEqual(J(d.ops.find((o) => o.id === 'norm1').in), ['prompt']);
  // preLnLayer con hSym/dhSym/DmlpSym, rope y entrada con segmentos
  const g2 = A7.graph({});
  const x = g2.input('x', S7(['k', 'N', 'D_v'], [2, 4, 8]));
  let roped = 0;
  A7.preLnLayer(g2, x, { prefix: ['enc'], L: 3, h: 2, Dmlp: 32, hSym: 'h_v', dhSym: 'd_v', DmlpSym: '4D_v', tid: 'v-', oid: 'v-',
    rope: (hp, q, k) => { roped++; return [hp.op('rq', A7.rope_2d(q), hp.at.concat(['rope2d']), { out: hp.T('q-rope') }), hp.op('rk', A7.rope_2d(k), hp.at.concat(['rope2d']), { out: hp.T('k-rope') })]; } });
  const d2 = g2._data();
  assert.strictEqual(roped, 1);
  assert.deepStrictEqual(J(d2.tensors['v-q'].sym), ['k', 'h_v', 'N', 'd_v']);
  assert.deepStrictEqual(J(d2.tensors['v-u'].sym), ['k', 'N', '4D_v']);
  assert.deepStrictEqual(J(d2.ops.find((o) => o.id === 'v-scores').in), ['v-q-rope', 'v-k-rope']);
  assert.strictEqual(d2.ops.find((o) => o.id === 'v-scores').macs, 2 * 2 * 4 * 4 * 4);
});

test('F7 LLaVA-1.5: anclas de HF (params exactos), penúltima capa, proyector, prompt 576 + T, y el LLM = el de llm.js', () => {
  const r = A7.run('llava15-7b'), q = r.quantities, n = r.totals.byNode;
  assert.strictEqual(r.totals.params, 7063427072);
  assert.strictEqual(r.totals.flops, 9078220357632);
  assert.strictEqual(A7.run('llava15-13b').totals.params, 13351494656);
  // torre CLIP ViT-L/14 @ 336 (a mano): conv sin sesgo + CLS + posición 577·1024 + ln_pre + 24 capas de 12D² + 13D + ln_post
  const D = 1024, layer = 12 * D * D + 13 * D;
  assert.strictEqual(q.visionParams, 14 * 14 * 3 * D + D + 577 * D + 2 * D + 24 * layer + 2 * D);
  assert.strictEqual(q.visionParams, 303507456);
  assert.strictEqual(n['last-layer'].params, layer);
  assert.strictEqual(q.projectorParams, (1024 * 4096 + 4096) + (4096 * 4096 + 4096));
  // el LLM es Llama 2 7B (llm.js) con 64 filas más de vocabulario en embedding y LM head
  assert.strictEqual(q.llmParams, A7.run('llama2-7b').totals.params + 2 * 64 * 4096);
  assert.strictEqual(q.llmPrefillMacs, A7.run('llama2-7b', { T: 640 }).totals.macs + 640 * 4096 * 64);
  // formas
  const sh = (id) => J(r.tensors[id].num).join('×');
  assert.deepStrictEqual(['pixels', 'v-patch-grid', 'v-x-out', 'vis-feats', 'vis-tokens', 'text-emb', 'prompt', 'logits'].map(sh),
    ['336×336×3', '24×24×1024', '577×1024', '576×1024', '576×4096', '64×4096', '640×4096', '640×32064']);
  assert.deepStrictEqual(J(r.tensors.prompt.sym), ['N+T', 'D']);
  assert.deepStrictEqual(J(r.tensors.q.sym), ['N+T', 'D']);
  assert.deepStrictEqual(J(r.tensors['v-q'].sym), ['h_v', 'N_p+1', 'd_v']);
  assert.deepStrictEqual([q.visualTokens, q.textTokens, q.promptTokens, q.featureLayer], [576, 64, 640, 23]);
  // la capa 24 y ln_post: se cuentan (HF los corre) pero sus salidas no van a ningún lado
  assert.deepStrictEqual(J(r.tensors['v-cls-ln'].consumers), []);
  assert.deepStrictEqual(J(r.tensors['v-x-out'].consumers).sort(), ['select-layer', 'vis-last-layer'].sort());
  assert.strictEqual(r.ops.find((o) => o.id === 'vis-ln1').repeat, 23);
  assert.strictEqual(q.visionMacsDiscarded, n['last-layer'].macs);
  assert.strictEqual(q.visionMacsUsed + q.visionMacsDiscarded, q.visionMacs);
  // knobs: 2 imágenes = torre y proyector ×2, prompt 1152 + T; T cambia solo el LLM
  const r2 = A7.run('llava15-7b', { images: 2 });
  assert.deepStrictEqual([r2.config.N, r2.tensors.prompt.num[0], r2.quantities.visionMacs], [1152, 1216, 2 * q.visionMacs]);
  // revisión F7: los pesos de la torre y del proyector son los MISMOS para cada imagen: parámetros × 1, MACs × images
  for (const [cid, P] of [['llava15-7b', 7063427072], ['llava15-13b', 13351494656]]) {
    const r1 = A7.run(cid);
    for (const images of [2, 4]) {
      const ri = A7.run(cid, { images }), m = A7.metrics(cid, { images });
      assert.strictEqual(ri.totals.params, P, cid + ' images=' + images);
      assert.deepStrictEqual(['vision-encoder', 'projector', 'enc-layer', 'last-layer', 'llm'].map((k) => ri.totals.byNode[k].params),
        ['vision-encoder', 'projector', 'enc-layer', 'last-layer', 'llm'].map((k) => r1.totals.byNode[k].params), cid + ' byNode');
      assert.strictEqual(ri.totals.byPath['vision-encoder>enc-layer>mhsa>qkv'].params, r1.totals.byPath['vision-encoder>enc-layer>mhsa>qkv'].params);
      assert.deepStrictEqual([m.totalParams, m.visionParams, m.projectorParams, m.weightBytes], [P, 303507456, r1.quantities.projectorParams, 2 * P]);
      assert.strictEqual(ri.quantities.visionMacs, images * r1.quantities.visionMacs);
      assert.strictEqual(ri.ops.find((o) => o.id === 'vis-qkv').repeat, 23 * images);
      assert.strictEqual(ri.ops.find((o) => o.id === 'vis-qkv').paramRepeat, 23);
      assert.strictEqual(ri.ops.find((o) => o.id === 'proj-fc1').paramRepeat, 1);
    }
  }
  assert.strictEqual(A7.paramRep({ repeat: 5 }), 5);
  assert.strictEqual(A7.paramRep({ repeat: 5, paramRepeat: 1 }), 1);
  assert.strictEqual(A7.run('llava15-7b', { T: 256 }).quantities.visionMacs, q.visionMacs);
  assert.match(A7.run('llava15-7b', { T: 4000 }).notes.join(' '), /contexto/);
});

test('F7 Qwen2-VL: anclas de HF, patchify 3-D, merger 2×2, M-RoPE, Qwen2 con sesgo en QKV, tokens dinámicos y video', () => {
  const r = A7.run('qwen2-vl-7b'), q = r.quantities, n = r.totals.byNode;
  assert.deepStrictEqual([r.totals.params, r.totals.flops], [8291375616, 19298051809280]);
  assert.strictEqual(A7.run('qwen2-vl-2b').totals.params, 2208985600);
  assert.strictEqual(A7.run('qwen2-vl-72b').totals.params, 73405560320);
  // ViT ≈ 675M (paper): patchify + 32 bloques + merger (a mano)
  const Dv = 1280, blk = 2 * Dv + (Dv * 3 * Dv + 3 * Dv) + (Dv * Dv + Dv) + 2 * Dv + (Dv * 4 * Dv + 4 * Dv) + (4 * Dv * Dv + Dv);
  const merger = 2 * Dv + (4 * Dv * 4 * Dv + 4 * Dv) + (4 * Dv * 3584 + 3584);
  assert.strictEqual(n.patchify.params, 2 * 14 * 14 * 3 * Dv);
  assert.strictEqual(n['vision-encoder'].params, 32 * blk);
  assert.strictEqual(n.merger.params, merger);
  assert.strictEqual(q.visualModuleParams, 675759104);
  // Qwen2: sesgo en Q, K, V (no en O)
  const op = (id) => r.ops.find((o) => o.id === id);
  assert.deepStrictEqual([op('q-proj').params, op('k-proj').params, op('o-proj').params], [3584 * 3584 + 3584, 3584 * 512 + 512, 3584 * 3584]);
  assert.deepStrictEqual([op('rope-q').prim, J(op('rope-q').in)], ['mrope', ['q-heads', 'pos-ids']]);
  // 2B: embeddings atados → LM head sin parámetros propios
  assert.strictEqual(A7.run('qwen2-vl-2b').totals.byNode['lm-head'].params, 0);
  // formas: 812×812 → 58×58 = 3,364 parches → 841 tokens; prompt 841 + 64
  const sh = (rr, id) => J(rr.tensors[id].num).join('×');
  assert.deepStrictEqual(['v-frames', 'v-patch-grid', 'v-patches', 'v-scores', 'vis-feats', 'v-grouped', 'vis-tokens', 'pos-ids', 'prompt', 'k', 'logits'].map((id) => sh(r, id)),
    ['2×812×812×3', '58×58×1280', '3364×1280', '16×3364×3364', '3364×1280', '841×5120', '841×3584', '3×905', '905×3584', '905×512', '905×152064']);
  assert.deepStrictEqual([q.visualTokens, q.patches, q.posSpan, q.imagePosSpan], [841, 3364, 64 + 29, 29]);
  // tokens = (H/28)(W/28): no cuadradas; múltiplos de 28 obligatorios; límites de píxeles
  const r2 = A7.run('qwen2-vl-7b', { H: 448, W: 672 });
  assert.deepStrictEqual([r2.config.N, sh(r2, 'v-patch-grid'), r2.config.posSpan], [16 * 24, '32×48×1280', 64 + 24]);
  assert.throws(() => A7.run('qwen2-vl-7b', { H: 500 }), /múltiplos de 28.*504×812/);
  assert.throws(() => A7.run('qwen2-vl-7b', { H: 28, W: 28 }), /min_pixels/);
  assert.throws(() => A7.run('qwen2-vl-7b', { frames: 3 }), /par/);
  // video de 4 frames: 2 parches temporales, atención por par de frames (segmentos), el LLM ve 2·841 tokens
  const v = A7.run('qwen2-vl-7b', { frames: 4 });
  assert.deepStrictEqual([sh(v, 'pixels'), sh(v, 'v-patch-grid'), sh(v, 'v-x-seg'), sh(v, 'v-scores'), sh(v, 'vis-feats'), v.config.N],
    ['4×812×812×3', '2×58×58×1280', '2×3364×1280', '2×16×3364×3364', '6728×1280', 1682]);
  assert.strictEqual(v.ops.find((o) => o.id === 'vis-scores').macs, 2 * 3364 * 3364 * 1280);
  assert.strictEqual(v.totals.flops, 2 * v.totals.macs);
  // smart_resize (Python round: mitad al par) y el conteo de tokens
  const sr = A7.vlm.smartResize;
  assert.deepStrictEqual(J([sr(812, 812), sr(480, 640), sr(70, 70), sr(37, 50), sr(4000, 3000)]),
    [{ H: 812, W: 812 }, { H: 476, W: 644 }, { H: 56, W: 56 }, { H: 56, W: 84 }, { H: 4004, W: 2996 }]);
  assert.deepStrictEqual([A7.vlm.pyRound(2.5), A7.vlm.pyRound(3.5), A7.vlm.pyRound(2.4)], [2, 4, 2]);
  assert.strictEqual(A7.vlm.qwenTokens(476, 644).tokens, 17 * 23);
  // max(factor, …) en la rama de max_pixels (HF): sin él, el lado corto sería 0
  assert.deepStrictEqual(J(sr(5600, 28, { minPixels: 784, maxPixels: 7840 })), { H: 1232, W: 28 });
  // cantidades con nombre de la prosa (alto × ancho; HF smart_resize, verificado en crosscheck/vlm.py)
  const nq = A7.run('qwen2-vl-2b').quantities;
  assert.deepStrictEqual(J(['720p', '1080p', '1080pBudget', '4k', '4kBudget', 'A4', 'A4Budget', 'A4Low', 'RobotView'].map((k) => [nq['tokens' + k], nq['patches' + k], nq['resized' + k]])), [
    [1196, 4784, '728×1288'], [2691, 10764, '1092×1932'], [1222, 4888, '728×1316'], [10549, 42196, '2156×3836'], [1222, 4888, '728×1316'],
    [11125, 44500, '3500×2492'], [1260, 5040, '1176×840'], [247, 988, '532×364'], [391, 1564, '476×644']]);
  assert.deepStrictEqual([nq.grid720p, nq.tokensRobot3], ['26×46', 1173]);
  assert.strictEqual(A7.run('qwen2-vl-72b').quantities.tokens4k, nq.tokens4k);
  const lq = A7.run('llava15-7b').quantities;
  assert.deepStrictEqual([lq.anyresTokens336, lq.anyresTokens640x480, lq.anyresTokens480x640, lq.anyresTokens672], [1176, 2352, 2340, 2928]);
});

test('F7 métricas: unidades conocidas, tokens y reparto del prefill, KV por imagen, roofline ≈, listas de escala', () => {
  const OK = ['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'];
  for (const id of LLAVA.concat(QWEN)) {
    const m = A7.metrics(id, {}), q = A7.run(id).quantities;
    for (const [k, u] of Object.entries(m.units)) assert.ok(OK.includes(u), id + ' ' + k + ': ' + u);
    for (const k of ['visualTokens', 'textTokens', 'promptTokens', 'visualShare', 'visionParams', 'projectorParams', 'llmParams', 'visionMacs', 'projectorMacs',
      'llmPrefillMacs', 'prefillShareFromImage', 'kvBytesPerImage', 'kvBytesPerToken', 'ttftMs', 'decodeMacsPerToken']) {
      assert.strictEqual(typeof m[k], 'number', id + ' ' + k);
      assert.ok(m.units[k], id + ' ' + k + ' sin unidad');
    }
    assert.strictEqual(m.visionParams + m.projectorParams + m.llmParams, m.totalParams, id);
    assert.strictEqual(m.visionMacs + m.projectorMacs + m.llmPrefillMacs, m.prefillMacs, id);
    assert.strictEqual(m.llmMacsFromImage + m.llmMacsTextOnly, m.llmPrefillMacs, id);
    assert.ok(m.prefillShareFromImage > 0.85 && m.prefillShareFromImage < 1, id + ' ' + m.prefillShareFromImage);
    assert.strictEqual(m.visualShare, q.visualTokens / q.promptTokens);
    assert.strictEqual(m.kvBytesPerImage, m.visualTokensPerImage * m.kvBytesPerToken);
    assert.ok(m.ttftMs > m.ttftTextOnlyMs && m.ttftBound === 'cómputo', id);
    assert.ok(m.decodeTokPerSecUpperBound > 0 && isFinite(m.decodeTokPerSecUpperBound));
    Object.keys(m).filter((k) => typeof m[k] === 'number' && /Macs$/.test(k)).forEach((k) => assert.strictEqual(m.units[k], 'macs', id + ' ' + k));
  }
  const l = A7.metrics('llava15-7b', {}), qw = A7.metrics('qwen2-vl-7b', {});
  // KV de LLaVA 7B (MHA, 32 capas): 2·32·32·128·2 B = 512 KiB por token → 576 tokens = 302 MB por imagen
  assert.deepStrictEqual([l.kvBytesPerToken, l.kvBytesPerImage], [524288, 576 * 524288]);
  assert.deepStrictEqual([qw.kvBytesPerToken, qw.kvBytesPerImage], [57344, 841 * 57344]);    // Qwen2 7B: GQA con 4 KV
  // decode tras el prompt = un paso del decoder de llm.js con ctx = N + T + 1 (la imagen ya está en la KV cache)
  assert.strictEqual(l.decodeMacsPerToken, A7.run('llama2-7b', { decode: 1, ctx: 641 }).totals.macs + 4096 * 64);
  // listas
  assert.deepStrictEqual(J(l.imagesScaling.map((x) => x.visualTokens)), [576, 1152, 2304, 4608]);
  assert.ok(l.imagesScaling.every((x, i, a) => !i || x.prefillMacs > a[i - 1].prefillMacs));
  assert.deepStrictEqual(J(l.anyresTokensAt.slice(0, 2).map((x) => [x.tokens, x.tokensPaper])), [[1176, 1728], [2928, 2880]]);
  assert.ok(l.fixedTokensAt.every((x) => x.visualTokens === 576));
  assert.deepStrictEqual(J(qw.tokensAt.map((x) => x.visualTokens)), [64, 256, 576, 841, 1296, 2304, 16 * 29, 29 * 16]);
  assert.deepStrictEqual(J(qw.framesScaling.map((x) => x.visualTokens)), [841, 1682, 3364, 6728]);
  assert.deepStrictEqual(J(qw.textScaling.map((x) => x.promptTokens)), [857, 905, 1097, 1865]);
  // Quantities: claves de la fase 7 en prosa
  assert.strictEqual(Q7.get('llava15-7b.quantities.visualTokens').value, 576);
  assert.strictEqual(Q7.get('qwen2-vl-7b.tensor.prompt.sym').text, '(N+T)×D');
  assert.strictEqual(Q7.get('qwen2-vl-7b.tensor.v-grouped.shape').text, '841×5120');
  assert.strictEqual(Q7.get('llava15-7b.params.total').text, '7,063,427,072');
});

test('F7 etiqueta + símbolo identifican una forma; byPath suma; aritmética; where; Quantities resuelve todas las claves', () => {
  const cases = LLAVA.map((id) => [id, [{}, { images: 2 }]]).concat(QWEN.map((id) => [id, [{}, { frames: 4 }, { H: 448, W: 672 }]]));
  for (const [id, ovs] of cases) {
    for (const ov of ovs) {
      const r = A7.run(id, ov), t = r.totals;
      const by = {};
      for (const tid of r.order) {
        const x = r.tensors[tid];
        const k = x.label + '|' + String(x.tex).split('=')[0].trim();
        (by[k] = by[k] || new Set()).add(x.num.join('×'));
      }
      for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
      // parámetros × paramRepeat (pesos compartidos entre imágenes), MACs × repeat
      assert.strictEqual(r.ops.reduce((s, o) => s + o.params * A7.paramRep(o), 0), t.params);
      assert.strictEqual(r.ops.reduce((s, o) => s + o.macs * o.repeat, 0), t.macs);
      assert.strictEqual(Object.values(t.byPrim).reduce((s, x) => s + x.macs, 0), t.macs);
      const check = (pp, want) => {
        const kids = children(r, pp);
        if (!kids.length) return;
        const at = (k) => t.byPath[pp.concat([k]).join('>')];
        assert.strictEqual(kids.reduce((s, k) => s + at(k).params, 0), want.params, id + ' params bajo ' + (pp.join('>') || 'raíz'));
        assert.strictEqual(kids.reduce((s, k) => s + at(k).macs, 0), want.macs, id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
        kids.forEach((k) => check(pp.concat([k]), at(k)));
      };
      check([], t);
      for (const tid of r.order) {
        const x = r.tensors[tid];
        if (x.producer) assert.ok(r.ops.find((o) => o.id === x.producer).out.includes(tid));
        x.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(tid)));
      }
      for (const o of r.ops) {
        if (o.params) assert.ok(o.paramArith.endsWith(A7.fmt.int(o.params)), id + ' ' + o.id + ' paramArith');
        if (o.macs) assert.ok(o.macArith.endsWith(A7.fmt.int(o.macs)), id + ' ' + o.id + ' macArith');
        assert.ok(!/undefined|NaN/.test(o.paramTex + o.macTex + o.shapeTex), id + ' ' + o.id + ' tex');
        assert.ok(Array.isArray(o.where) && o.where.length, id + ' ' + o.id + ' sin where');
        // el decoder importado no conserva una T aislada en sus fórmulas (T → N+T)
        if (o.path[0] === 'llm' || o.path[0] === 'lm-head') {
          const tx = (o.macTex + ' ' + o.shapeTex).replace(/\(N(\{\+\}|\+)T\)/g, '');
          assert.ok(!/(^|[^A-Za-z\\{_])T(?![A-Za-z_])/.test(tx), id + ' ' + o.id + ': ' + o.macTex + ' | ' + o.shapeTex);
          assert.ok(/N\{\+\}T/.test(o.shapeTex) || !/T/.test(o.shapeTex), id + ' ' + o.id + ' shapeTex');
        }
      }
      // etiquetas con contexto: visión, proyector/merger, LLM
      for (const tid of r.order) {
        const x = r.tensors[tid], p = x.producer && r.ops.find((o) => o.id === x.producer);
        if (p && p.path[0] === 'vision-encoder' && /^v-/.test(tid)) assert.match(x.label, /^Visión · /, id + ' ' + tid);
        if (p && p.path[0] === 'llm') assert.match(x.label, /^LLM · /, id + ' ' + tid);
      }
    }
    assert.strictEqual(A7.run(id), A7.run(id), 'memoizado');
    J(Q7.keys(id)).forEach((k) => assert.ok(Q7.get(id + '.' + k), id + '.' + k));
  }
});

// ---------------------------------------------------------------- fase 8: difusión (Stable Diffusion, SDXL, DiT)
// Contexto con todos los modelos hasta la fase 8 (diffusion.js compone el encoder de texto de clip.js y usa el hardware de llm.js).
const ATLAS8 = (function () {
  const ctx = vm.createContext({});
  for (const f of FILES.filter((x) => x !== 'js/core/quantities.js').concat(['js/arch/grounding-dino.js', 'js/arch/yolo-world.js', 'js/arch/sam.js', 'js/arch/llm.js', 'js/arch/vlm.js',
    'js/arch/diffusion.js', 'js/core/quantities.js'])) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('ATLAS', ctx);
})();
const A8 = ATLAS8.Arch, Q8 = ATLAS8.Quantities;
const SD = ['sd15-unet', 'sd15-train', 'sdxl-unet'], DITS = ['dit-xl2-256', 'dit-xl2-512', 'dit-xl4-256', 'dit-xl8-256', 'dit-b2-256', 'dit-xl2-256-fm'];
const S8 = (sym, num, mod, layout) => A8.shape(sym, num, mod || 'lat', layout || 'seq');

test('F8 los modelos stable-diffusion / dit y las primitivas nuevas no cambian ningún resultado de las fases 1–7', () => {
  for (const c of A7.configs()) {
    const a = A7.run(c.id), b = A8.run(c.id);
    assert.deepStrictEqual([b.totals.params, b.totals.macs, b.totals.other], [a.totals.params, a.totals.macs, a.totals.other], c.id);
    assert.deepStrictEqual(J(b.ops.map((o) => [o.id, o.paramTex, o.macTex, o.shapeTex])), J(a.ops.map((o) => [o.id, o.paramTex, o.macTex, o.shapeTex])), c.id + ' fórmulas');
    const ma = A7.metrics(c.id, {}), mb = A8.metrics(c.id, {});
    assert.deepStrictEqual([mb.attnMem, mb.actMem, mb.kvCache, mb.decodeMacsPerToken], [ma.attnMem, ma.actMem, ma.kvCache, ma.decodeMacsPerToken], c.id + ' metrics');
  }
  assert.deepStrictEqual(J(A8.configs('stable-diffusion').map((c) => c.id)), SD);
  assert.deepStrictEqual(J(A8.configs('dit').map((c) => c.id)), DITS);
  assert.strictEqual(A8.canonical('stable-diffusion'), 'sd15-unet');
  assert.strictEqual(A8.canonical('dit'), 'dit-xl2-256');
  // knobs: 0 solo donde el modelo lo declara (cfg); el resto sigue exigiendo enteros positivos
  assert.throws(() => A8.run('vit-b16-224', { res: 0 }), /entero positivo/);
  assert.throws(() => A8.run('sd15-unet', { steps: 0 }), /entero positivo/);
  assert.doesNotThrow(() => A8.run('sd15-unet', { cfg: 0 }));
  assert.throws(() => A8.run('sd15-unet', { cfg: -1 }), /no negativo/);
});

test('F8 primitivas: tiempo, clase, broadcast, downsample, GEGLU, adaLN-Zero, posición 2-D, unpatchify, latente, ruido, CFG, sampler', () => {
  const t = S8(['1'], [1], null, 'vec');
  const te = A8.timestep_embedding(t, { dim: 8, sym: 'C' });
  assert.deepStrictEqual([J(te.out.num), J(te.out.sym), te.params, te.macs, te.other], [[8], ['C'], 0, 0, 8 * 3]);
  assert.deepStrictEqual(J(A8.timestep_embedding(S8(['6'], [6], null, 'vec'), { dim: 4 }).out.num), [24]);   // 6 time ids de SDXL
  assert.throws(() => A8.timestep_embedding(t, { dim: 7 }), /par/);
  const cf = A8.concat_features([S8(['T', 'D_1'], [5, 3], 'txt'), S8(['T', 'D_2'], [5, 4], 'txt')]);
  assert.deepStrictEqual([J(cf.out.num), J(cf.out.sym), cf.params], [[5, 7], ['T', 'D_1+D_2'], 0]);
  assert.throws(() => A8.concat_features([S8(['T', 'D'], [5, 3]), S8(['T', 'D'], [4, 3])]), /incompatibles/);
  const le = A8.label_embed(t, { K: 10, D: 4 });
  assert.deepStrictEqual([J(le.out.num), le.params, le.paramFormula], [[4], 11 * 4, '(K+1)\\cdot D']);
  assert.strictEqual(A8.label_embed(t, { K: 10, D: 4, nullClass: false }).params, 40);
  const gr = S8(['h', 'w', 'C'], [2, 3, 4], 'lat', 'grid');
  const ab = A8.add_broadcast(gr, S8(['C'], [4], null, 'vec'));
  assert.deepStrictEqual([J(ab.out.num), ab.params, ab.macs, ab.other], [[2, 3, 4], 0, 0, 24]);
  assert.throws(() => A8.add_broadcast(gr, S8(['C'], [5], null, 'vec')), /canales/);
  const ds = A8.downsample2d(S8(['H', 'W', 'C'], [8, 8, 3], 'lat', 'grid'), { cout: 5, coutSym: 'C_o' });
  assert.deepStrictEqual([J(ds.out.num), J(ds.out.sym), ds.params, ds.macs], [[4, 4, 5], ['H/2', 'W/2', 'C_o'], 9 * 3 * 5 + 5, 4 * 4 * 5 * 9 * 3]);
  const da = A8.downsample2d(S8(['H', 'W', 'C'], [8, 8, 3], 'lat', 'grid'), { cout: 5, pad: 'asym' });
  assert.deepStrictEqual([da.params, da.macs, da.detail.pad], [ds.params, ds.macs, 'asym']);
  assert.throws(() => A8.downsample2d(S8(['H', 'W', 'C'], [7, 8, 3], 'lat', 'grid'), { cout: 5 }), /no es par/);
  const gg = A8.geglu(S8(['N', '8C'], [3, 8]), { outSym: '4C' });
  assert.deepStrictEqual([J(gg.out.num), J(gg.out.sym), gg.params, gg.other], [[3, 4], ['N', '4C'], 0, 12 * 9]);
  const c = S8(['D'], [4], null, 'vec');
  const ad = A8.adaln_zero(c, { k: 6 });
  assert.deepStrictEqual([ad.out.length, J(ad.out[0].num), ad.params, ad.macs, ad.paramFormula], [6, [4], 4 * 24 + 24, 4 * 24, 'D\\cdot 6D + 6D']);
  const x = S8(['N', 'D'], [3, 4]);
  assert.deepStrictEqual([A8.ada_modulate(x, ad.out[0], ad.out[1]).other, A8.ada_gate(x, ad.out[2]).other], [36, 12]);
  assert.throws(() => A8.ada_modulate(x, S8(['E'], [5], null, 'vec'), ad.out[1]), /vectores/);
  assert.deepStrictEqual([A8.layernorm(x, { affine: false }).params, A8.layernorm(x).params], [0, 8]);
  const pe = A8.sincos_pos_2d({ gh: 3, gw: 3, D: 8 });
  assert.deepStrictEqual([J(pe.out.num), pe.params, pe.detail.buffer], [[9, 8], 0, true]);
  const up = A8.unpatchify(S8(['N', 'P²·3'], [4, 12]), { gh: 2, gw: 2, P: 2, outSym: ['I', 'I', '3'] });
  assert.deepStrictEqual([J(up.out.num), up.params], [[4, 4, 3], 0]);
  assert.throws(() => A8.unpatchify(S8(['N', 'X'], [5, 12]), { gh: 2, gw: 2, P: 2 }), /rejilla/);
  const mo = S8(['h', 'w', '8'], [2, 2, 8], 'lat', 'grid');
  assert.deepStrictEqual(J(A8.latent_sample(mo, { sym: '4' }).out.num), [2, 2, 4]);
  const z = A8.latent_sample(mo, { sym: '4' }).out;
  assert.deepStrictEqual([A8.latent_scale(z, { factor: 0.18215 }).other, A8.add_noise(z, z, t, {}).other, A8.flow_target(z, z).other, A8.cfg_combine(z, z, { w: 7.5 }).other], [16, 48, 16, 48]);
  assert.match(A8.add_noise(z, z, t, { kind: 'flow' }).detail.formula, /1 − t/);
  assert.deepStrictEqual([A8.scheduler_step(z, z, {}).other, A8.scheduler_step(z, z, { kind: 'euler' }).other], [96, 32]);
  assert.deepStrictEqual(J(A8.mse_loss(z, z).out.num), [1]);
  assert.throws(() => A8.mse_loss(z, mo), /formas distintas/);
  // '²' en un símbolo → ^2 en LaTeX (M² sigue por SYM_TEX)
  assert.strictEqual(A8.fmt.symTex('P²·8'), 'P^2\\cdot 8');
  assert.strictEqual(A8.fmt.symTex('M²'), 'M^2');
});

test('F8 compuestas a mano: resnet_block (con tiempo y atajo), upsample2d, geglu_ff 12D² + 9D, spatial_transformer 20C² + 2D_tC + 21C, dit_block 18D² + 15D', () => {
  const x = S8(['H', 'W', 'C'], [4, 4, 4], 'lat', 'grid'), e = S8(['E'], [8], null, 'vec');
  const rb = A8.resnet_block(x, { cout: 6, temb: e });
  // GN 2·4 + conv1 9·4·6 + 6 + tiempo 8·6 + 6 + GN 2·6 + conv2 9·36 + 6 + atajo 4·6 + 6
  assert.strictEqual(rb.params, 8 + 222 + 54 + 12 + 330 + 30);
  assert.strictEqual(rb.macs, 16 * 216 + 48 + 16 * 324 + 16 * 24);
  assert.deepStrictEqual(J(rb.out.num), [4, 4, 6]);
  assert.strictEqual(A8.resnet_block(x, { cout: 4 }).params, 8 + (9 * 16 + 4) + 8 + (9 * 16 + 4));   // VAE: sin tiempo ni atajo
  const u2 = A8.upsample2d(S8(['h', 'w', 'C'], [2, 2, 3], 'lat', 'grid'));
  assert.deepStrictEqual([J(u2.out.num), u2.params, u2.macs], [[4, 4, 3], 9 * 9 + 3, 16 * 81]);
  const ff = A8.geglu_ff(S8(['N', 'D'], [3, 4]), {});
  assert.deepStrictEqual([ff.params, ff.macs], [12 * 16 + 9 * 4, 12 * 3 * 16]);
  const st = A8.spatial_transformer(S8(['h', 'w', 'C'], [2, 2, 32], 'lat', 'grid'), { h: 4, text: S8(['T', 'D_t'], [5, 16], 'txt') });
  assert.strictEqual(st.params, 20 * 1024 + 2 * 16 * 32 + 21 * 32);
  assert.strictEqual(st.macs, 4 * (20 * 1024 + 2 * 4 * 32 + 2 * 5 * 32) + 2 * 5 * 16 * 32);
  const db = A8.dit_block(S8(['N', 'D'], [3, 8]), S8(['D'], [8], null, 'vec'), { h: 2 });
  assert.deepStrictEqual([db.params, db.macs], [18 * 64 + 15 * 8, 3 * 12 * 64 + 2 * 9 * 8 + 6 * 64]);
});

test('F8 Stable Diffusion 1.5: anclas de diffusers (U-Net 859,520,964, VAE, CLIP), MACs por componente, ids y formas', () => {
  const r = A8.run('sd15-unet'), n = r.totals.byNode, q = r.quantities;
  assert.deepStrictEqual([n.unet.params, n['text-encoder'].params, n['vae-encoder'].params, n['vae-decoder'].params, r.totals.params],
    [859520964, 123060480, 34163664, 49490199, 1066235307]);
  assert.deepStrictEqual([n.unet.macs, n['text-encoder'].macs, n['vae-decoder'].macs, n['vae-encoder'].macs], [401636720640, 6649251840, 1257259466752, 0]);
  assert.strictEqual(A8.run('sd15-train').totals.byNode['vae-encoder'].macs, 558329233408);
  // el texto es la torre de texto de clip-vit-l14 (mismos parámetros y MACs, sin la proyección)
  const cl = A8.run('clip-vit-l14').totals.byNode['txt-encoder'];
  assert.deepStrictEqual([n['text-encoder'].params, n['text-encoder'].macs], [cl.params, cl.macs]);
  // reglas de la prosa: bloque transformer = 20C² + 2·D_t·C + 21C; 22 ResNet, 16 transformers, 12 skips
  const C = 320;
  assert.strictEqual(r.totals.byPath['unet>down-1>d1-attn1'].params, 20 * C * C + 2 * 768 * C + 21 * C);
  assert.deepStrictEqual([q.nResnets, q.nTransformers, q.nSkips], [22, 16, 12]);
  // niveles: down-k en H/8/2^(k−1); atención en los 3 primeros niveles y el medio
  const T = (id) => J(r.tensors[id].num), Y = (id) => J(r.tensors[id].sym);
  assert.deepStrictEqual([T('z-t'), T('h-in'), T('d1-down-out'), T('d3-attn2-out'), T('d4-res2-out'), T('mid-res2-out'), T('eps-hat'), T('image'), T('text-emb')],
    [[64, 64, 4], [64, 64, 320], [32, 32, 320], [16, 16, 1280], [8, 8, 1280], [8, 8, 1280], [64, 64, 4], [512, 512, 3], [77, 768]]);
  assert.deepStrictEqual([T('d1-attn1-sa-scores'), T('d1-attn1-ca-scores'), T('mid-attn-sa-scores'), T('u1-cat1'), T('u2-cat3'), T('u4-attn3-out')],
    [[8, 4096, 4096], [8, 4096, 77], [8, 64, 64], [8, 8, 2560], [16, 16, 1920], [64, 64, 320]]);
  assert.deepStrictEqual([Y('z-t'), Y('h-in'), Y('d1-attn1-x0'), Y('d1-attn1-ca-scores'), Y('d1-attn1-ff-h'), Y('u1-cat1'), Y('d2-attn1-sa-qh'), Y('text-emb'), Y('t-q')],
    [['H/8', 'W/8', '4'], ['H/8', 'W/8', 'C'], ['H/8·W/8', 'C'], ['h', 'H/8·W/8', 'T'], ['H/8·W/8', '8C'], ['H/64', 'W/64', '4C+4C'], ['h', 'H/16·W/16', '2C/h'], ['T', 'D_t'], ['h_t', 'T', 'd_t']]);
  assert.ok(!r.ops.find((o) => o.id === 'd4-attn1') && !r.tensors['u1-attn1-out'], 'down-4 / up-1 sin atención');
  // nodos de SPEC §20.1 (paths)
  const P = (id) => J(r.ops.find((o) => o.id === id).path);
  assert.deepStrictEqual([P('conv-in'), P('temb-fc1'), P('d1-res1-gn1'), P('d1-res1-time-proj'), P('d2-res1-skip'), P('d1-attn1-norm1'), P('d1-attn1-sa-scores'),
    P('d1-attn1-ca-k'), P('d1-attn1-ff-geglu'), P('d1-down'), P('u1-cat1'), P('u1-up-conv'), P('conv-out'), P('scheduler-step'), P('cfg-combine'), P('vd-conv-out'), P('t-qkv')],
  [['unet', 'conv-in'], ['unet', 'time-embed', 'fc1'], ['unet', 'down-1', 'd1-res1', 'gn1'], ['unet', 'down-1', 'd1-res1', 'time-proj'], ['unet', 'down-2', 'd2-res1', 'skip'],
    ['unet', 'down-1', 'd1-attn1', 'norm1'], ['unet', 'down-1', 'd1-attn1', 'self-attn', 'scores'], ['unet', 'down-1', 'd1-attn1', 'cross-attn', 'k'],
    ['unet', 'down-1', 'd1-attn1', 'ff-geglu', 'geglu'], ['unet', 'down-1', 'd1-down'], ['unet', 'up-1', 'u1-res1', 'cat'], ['unet', 'up-1', 'u1-up', 'conv'],
    ['unet', 'conv-out', 'conv'], ['scheduler', 'step'], ['scheduler', 'cfg'], ['vae-decoder', 'vd-conv-out', 'conv'], ['text-encoder', 'enc-layer', 'mhsa', 'qkv']]);
  // cross-attention: K y V del texto (77 × 768 → C)
  assert.deepStrictEqual(J(r.ops.find((o) => o.id === 'd1-attn1-ca-k').in), ['text-emb']);
  assert.strictEqual(r.ops.find((o) => o.id === 'd1-attn1-ca-k').params, 768 * 320);
  // los skips: el último tensor de cada bloque de bajada, consumido por el nivel espejo
  assert.deepStrictEqual(J(r.config.skipMap.map((s) => s.tensor)), ['d4-res2-out', 'd4-res1-out', 'd3-down-out', 'd3-attn2-out', 'd3-attn1-out', 'd2-down-out',
    'd2-attn2-out', 'd2-attn1-out', 'd1-down-out', 'd1-attn2-out', 'd1-attn1-out', 'h-in']);
  assert.deepStrictEqual(J(r.tensors['d1-attn2-out'].consumers), ['d1-down', 'u4-cat1']);
});

test('F8 SD: knobs res, steps, cfg (0/1), B y train; config de entrenamiento; errores en español', () => {
  const r = A8.run('sd15-unet'), t = A8.run('sd15-train');
  assert.strictEqual(t.totals.params, r.totals.params);
  assert.strictEqual(t.totals.byNode.unet.macs, r.totals.byNode.unet.macs);
  assert.deepStrictEqual(J(['image', 'z0', 'eps', 'z-t', 'eps-hat', 'loss'].map((id) => t.tensors[id].num)), [[512, 512, 3], [64, 64, 4], [64, 64, 4], [64, 64, 4], [64, 64, 4], [1]]);
  assert.deepStrictEqual(J(t.ops.find((o) => o.id === 'add-noise').in), ['z0', 'eps', 'timestep']);
  assert.strictEqual(t.ops.find((o) => o.id === 'vae-decoder-idle').params, 49490199);
  assert.strictEqual(A8.run('sd15-unet', { train: 1 }).totals.macs, t.totals.macs);
  // cfg = 0: sin la op de CFG ni la predicción sin texto; el grafo de la red no cambia
  const n0 = A8.run('sd15-unet', { cfg: 0 });
  assert.ok(!n0.tensors['eps-uncond'] && !n0.ops.find((o) => o.id === 'cfg-combine'));
  assert.strictEqual(n0.totals.macs, r.totals.macs);
  assert.deepStrictEqual(J(A8.run('sd15-unet', { steps: 20 }).ops.map((o) => o.id)), J(r.ops.map((o) => o.id)));
  // res: latente res/8, el número de tokens del primer nivel ∝ res²
  const r7 = A8.run('sd15-unet', { res: 768 });
  assert.deepStrictEqual([J(r7.tensors['z-t'].num), r7.config.tokens, J(r7.tensors['d1-attn1-sa-scores'].num)], [[96, 96, 4], 9216, [8, 9216, 9216]]);
  assert.match(r7.label, /@ 768/);
  assert.ok(r7.notes.some((x) => /se entrenó a 512/.test(x)));
  assert.throws(() => A8.run('sd15-unet', { res: 500 }), /múltiplo de 64/);
  assert.throws(() => A8.run('sd15-unet', { cfg: 2 }), /cfg debe ser 0/);
  assert.throws(() => A8.run('sd15-unet', { foo: 1 }), /Knob inválido/);
  // schedule de SD (scaled_linear 0.00085 → 0.012) y pasos de DDIM / PNDM (cross-check con diffusers en el JSON)
  const ab = A8.diffusion.alphasCumprod('scaled_linear', 1000, 0.00085, 0.012);
  assert.ok(Math.abs(ab[0] - 0.99915) < 1e-12 && Math.abs(ab[999] - 0.004660) < 1e-5);
  assert.deepStrictEqual(J(A8.diffusion.ddimTimesteps(10)), [901, 801, 701, 601, 501, 401, 301, 201, 101, 1]);
  assert.strictEqual(A8.diffusion.pndmNfe(50), 51);
  const sch = A8.diffusion.schedule('dit-xl2-256');
  assert.strictEqual(sch.kind, 'linear');
  assert.ok(Math.abs(sch.alphasCumprod[0] - 0.9999) < 1e-12);
});

test('F8 SDXL: U-Net 2,567,463,684 (3 niveles, transformers ×2 / ×10, d_h = 64), dos encoders de texto (penúltima capa), micro-condicionamiento', () => {
  const r = A8.run('sdxl-unet'), n = r.totals.byNode;
  assert.deepStrictEqual([n.unet.params, n.te1.params, n.te2.params, n['text-encoder'].params, r.totals.params], [2567463684, 123060480, 694659840, 817720320, 3468837867]);
  assert.deepStrictEqual([n.unet.macs, n['text-encoder'].macs, n['vae-decoder'].macs], [3380618199040, 55580805120, 5235196297216]);
  const T = (id) => J(r.tensors[id].num);
  assert.deepStrictEqual([T('z-t'), T('text-emb'), T('te1-hidden'), T('te2-hidden'), T('text-pooled'), T('add-in'), T('temb-total'), T('d2-attn1-sa-scores'), T('d3-attn1-ca-scores'), T('image')],
    [[128, 128, 4], [77, 2048], [77, 768], [77, 1280], [1280], [2816], [1280], [10, 4096, 4096], [20, 1024, 77], [1024, 1024, 3]]);
  assert.ok(!r.ops.find((o) => /^d1-attn/.test(o.id)), 'sin atención en el primer nivel (128×128)');
  assert.deepStrictEqual([r.ops.find((o) => o.id === 'd2-attn1-norm1').repeat, r.ops.find((o) => o.id === 'd3-attn1-norm1').repeat, r.ops.find((o) => o.id === 'mid-attn-norm1').repeat], [2, 10, 10]);
  assert.strictEqual(r.ops.find((o) => o.id === 'te1-enc-layer') === undefined, true);
  assert.deepStrictEqual([r.ops.find((o) => o.id === 'te1-qkv').repeat, r.ops.find((o) => o.id === 'te2-qkv').repeat], [11, 31]);
  assert.deepStrictEqual(J(r.ops.find((o) => o.id === 'text-concat').in), ['te1-hidden', 'te2-hidden']);
  assert.deepStrictEqual(J(r.tensors['d2-attn1-sa-qh'].sym), ['2C/d_h', 'H/16·W/16', 'd_h']);
  assert.strictEqual(r.config.skipMap.length, 9);
});

test('F8 DiT: anclas (XL/2 674,834,720 = oficial sin la posición fija; diffusers 749,826,464), 118.6 «Gflops» del paper = MACs, adaLN-Zero, patch y resolución', () => {
  const r = A8.run('dit-xl2-256'), q = r.quantities, D = 1152, L = 28;
  assert.deepStrictEqual([r.totals.params, q.officialParams, q.diffusersParams, r.totals.macs, q.diffusersMacs], [674834720, 675129632, 749826464, 118621421568, 118666838016]);
  assert.ok(Math.abs(r.totals.macs / 118.6e9 - 1) < 0.0005, 'los 118.6 «Gflops» de la Tabla 4 son GMACs');
  assert.strictEqual(q.blockParams, 18 * D * D + 15 * D);
  assert.strictEqual(q.adalnParamsBlock, 6 * D * D + 6 * D);
  assert.strictEqual(r.ops.find((o) => o.id === 'adaln').repeat, L);
  assert.deepStrictEqual([r.totals.byNode.adaln.params, r.totals.byNode['adaln-final'].params, q.adalnParams], [L * (6 * D * D + 6 * D), D * 2 * D + 2 * D, L * (6 * D * D + 6 * D) + D * 2 * D + 2 * D]);
  assert.deepStrictEqual([q.tEmbedParams, q.yEmbedParams], [256 * D + D + D * D + D, 1001 * D]);
  assert.strictEqual(r.ops.find((o) => o.id === 'norm1').params, 0);
  const T = (id) => J(r.tensors[id].num), Y = (id) => J(r.tensors[id].sym);
  assert.deepStrictEqual([T('x-t'), T('x-patch-grid'), T('h0'), T('c'), T('gamma1'), T('scores'), T('u'), T('h-final'), T('out'), T('eps-hat'), T('sigma')],
    [[32, 32, 4], [16, 16, 1152], [256, 1152], [1152], [1152], [16, 256, 256], [256, 4608], [256, 32], [32, 32, 8], [32, 32, 4], [32, 32, 4]]);
  assert.deepStrictEqual([Y('x-t'), Y('x-patch-grid'), Y('h0'), Y('h-final'), Y('out'), Y('beta1')], [['I', 'I', '4'], ['I/P', 'I/P', 'D'], ['N', 'D'], ['N', 'P²·8'], ['I', 'I', '8'], ['D']]);
  const P = (id) => J(r.ops.find((o) => o.id === id).path);
  assert.deepStrictEqual([P('patchify'), P('pos-embed'), P('adaln'), P('modulate1'), P('qkv'), P('gate1'), P('fc1'), P('gate2'), P('res2'), P('final-adaln'), P('final-linear'), P('unpatchify'), P('split-out'), P('temb-fc1'), P('y-embed'), P('cond')],
    [['patchify', 'conv'], ['pos-embed', 'table'], ['blocks', 'block', 'adaln'], ['blocks', 'block', 'modulate1'], ['blocks', 'block', 'attn', 'qkv'], ['blocks', 'block', 'gate1'],
      ['blocks', 'block', 'mlp', 'fc1'], ['blocks', 'block', 'gate2'], ['blocks', 'block', 'res2'], ['final-layer', 'adaln-final'], ['final-layer', 'linear'], ['unpatchify'], ['out'], ['t-embed', 'fc1'], ['y-embed'], ['cond']]);
  assert.deepStrictEqual(J(r.ops.find((o) => o.id === 'adaln').out), ['beta1', 'gamma1', 'alpha1', 'beta2', 'gamma2', 'alpha2']);
  // patch: tokens ÷4 por cada ×2 del patch; los parámetros casi no cambian (solo el patchify y el Linear final)
  const tok = DITS.slice(0, 4).map((id) => A8.run(id).config.N);
  assert.deepStrictEqual(J(tok), [256, 1024, 64, 16]);
  assert.deepStrictEqual(J(['dit-xl4-256', 'dit-xl8-256', 'dit-b2-256', 'dit-xl2-512'].map((id) => A8.run(id).totals.params)), [675000704, 675664640, 130315808, 674834720]);
  assert.deepStrictEqual(J(['dit-xl4-256', 'dit-xl8-256', 'dit-b2-256', 'dit-xl2-512'].map((id) => A8.run(id).totals.macs)), [29043671040, 7392411648, 23005102080, 524538298368]);
  assert.strictEqual(A8.run('dit-xl2-256', { patch: 4 }).totals.macs, A8.run('dit-xl4-256').totals.macs);
  assert.strictEqual(A8.run('dit-xl2-256', { res: 1024 }).config.N, 4096);
  assert.throws(() => A8.run('dit-xl2-256', { patch: 3 }), /divisible/);
  // flow matching: la red bajo el nodo `model`, salida v̂ de 4 canales, objetivo v = ε − x₀
  const f = A8.run('dit-xl2-256-fm');
  assert.deepStrictEqual([J(f.tensors['v-hat'].num), J(f.tensors['v-target'].num), J(f.tensors.loss.num)], [[32, 32, 4], [32, 32, 4], [1]]);
  assert.deepStrictEqual(J(f.ops.find((o) => o.id === 'interp').in), ['x0', 'eps', 'timestep']);
  assert.deepStrictEqual(J(f.ops.find((o) => o.id === 'qkv').path), ['model', 'blocks', 'block', 'attn', 'qkv']);
  assert.deepStrictEqual(J(f.ops.find((o) => o.id === 'loss').in), ['v-hat', 'v-target']);
  assert.strictEqual(f.totals.byNode.model.params, f.totals.params);
  assert.strictEqual(f.totals.params, r.totals.params - (D * 32 + 32) + (D * 16 + 16));
});

test('F8 métricas: unidades conocidas, costo por imagen (pasos × NFE × CFG + texto + VAE), reparto, atención por nivel, roofline ≈, listas', () => {
  const OK = ['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'];
  for (const id of SD.concat(DITS)) {
    const m = A8.metrics(id, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(OK.includes(u), id + ' ' + k + ': ' + u);
    Object.keys(m).filter((k) => typeof m[k] === 'number' && /Macs$/.test(k)).forEach((k) => assert.strictEqual(m.units[k], 'macs', id + ' ' + k));
    Object.keys(m).filter((k) => typeof m[k] === 'number' && /Params$/.test(k)).forEach((k) => assert.strictEqual(m.units[k], 'params', id + ' ' + k));
    assert.strictEqual(m.compressionFactor, 48, id);
    assert.ok(m.samplingMs > 0 && m.imagesPerSecUpperBound > 0 && isFinite(m.msPerImage), id);
  }
  const m = A8.metrics('sd15-unet', {});
  assert.deepStrictEqual([m.steps, m.nfePerStep, m.nfe, m.textPasses, m.latentShape, m.latentTokens], [50, 2, 100, 2, '64×64×4', 4096]);
  assert.strictEqual(m.samplingMacs, 100 * m.unetMacs + 2 * m.textEncoderMacs + m.vaeDecoderMacs);
  assert.strictEqual(A8.metrics('sd15-unet', { cfg: 0 }).samplingMacs, 50 * m.unetMacs + m.textEncoderMacs + m.vaeDecoderMacs);
  assert.ok(m.denoiserSamplingShare > 0.96 && m.vaeDecoderShare < 0.04);
  assert.deepStrictEqual([m.unetParams + m.vaeParams + m.textEncoderParams, m.totalParams], [1066235307, 1066235307]);
  // atención: por nivel suma al total de la U-Net (más conv-in, tiempo y conv-out); 8 cabezas × 4096² en bf16 = 268 MB por bloque
  const lv = m.attnByLevel;
  assert.deepStrictEqual(J(lv.map((x) => x.level)), ['down-1', 'down-2', 'down-3', 'down-4', 'mid', 'up-1', 'up-2', 'up-3', 'up-4']);
  const rest = ['conv-in', 'time-embed', 'conv-out'].reduce((s, k) => s + A8.run('sd15-unet').totals.byPath['unet>' + k].macs, 0);
  assert.strictEqual(lv.reduce((s, x) => s + x.macs, 0) + rest, m.unetMacs);
  assert.deepStrictEqual([lv[0].tokens, lv[3].hasAttention, lv[5].hasAttention, m.selfAttnTokens, m.selfAttnScoreBytes], [4096, false, false, 4096, 8 * 4096 * 4096 * 2]);
  assert.ok(lv[0].attnShareOfLevel > lv[1].attnShareOfLevel, 'la atención pesa más en el nivel de 64×64');
  // crecimiento con la resolución: superlineal en píxeles (la self-attention es cuadrática en tokens)
  const rs = m.resScaling;
  assert.deepStrictEqual(J(rs.map((x) => x.tokensL1)), [1024, 4096, 9216, 16384]);
  assert.ok(rs[3].unetMacsVsBase > 4 && rs.every((x, i) => !i || x.selfScoreShareUnet > rs[i - 1].selfScoreShareUnet));
  assert.deepStrictEqual(J(m.attnShareAt.map((x) => x.res)), [256, 512, 768, 1024]);
  // pasos: lineal; CFG: ×2 en la red
  const ss = m.stepsScaling;
  assert.ok(Math.abs((ss[4].samplingMacs - ss[3].samplingMacs) - 50 * 2 * m.unetMacs) < 1);
  assert.deepStrictEqual(J(m.cfgScaling.map((x) => x.nfe)), [50, 100]);
  // roofline ≈: suma de componentes; la U-Net con CFG a B = 1 ya está limitada por cómputo
  assert.ok(Math.abs(m.samplingMs - (50 * m.unetNfeMs + m.textEncoderMs + m.vaeDecodeMs)) < 1e-9);
  assert.strictEqual(m.unetBound, 'cómputo');
  assert.strictEqual(m.ridgePoint, 989e12 / 3.35e12);
  assert.ok(A8.metrics('sd15-unet', { B: 4 }).msPerImage < m.msPerImage + 1e-9);
  assert.ok(A8.metrics('sd15-unet', { peakFlops: 989e12 / 2 }).samplingMs > m.samplingMs);
  // DiT: 250 pasos DDPM × 2 (CFG) + decoder del VAE a 256
  const d = A8.metrics('dit-xl2-256', {});
  assert.strictEqual(d.samplingMacs, 500 * d.ditMacs + d.vaeDecoderMacs);
  assert.deepStrictEqual([d.paperGflops, d.latentTokens, d.vaeDecoderMacs], [118.6, 256, 311093641216]);
  assert.ok(Math.abs(d.adalnParamsShareBlock - 1 / 3) < 0.001);
  assert.deepStrictEqual(J(d.patchScaling.map((x) => x.tokens)), [256, 64, 16]);
  assert.deepStrictEqual(J(d.resScaling.map((x) => x.tokens)), [256, 1024, 4096]);
  assert.ok(d.resScaling.every((x, i, a) => !i || x.scoreShareDit > a[i - 1].scoreShareDit));
  // Quantities: claves de la fase 8 en prosa
  assert.strictEqual(Q8.get('sd15-unet.scaling').text, '0.18215');
  assert.strictEqual(Q8.get('sd15-unet.metrics.samplingMacs').text, A8.fmt.ops(m.samplingMacs));
  assert.strictEqual(Q8.get('sd15-unet.metrics.attnShareUnet').text, A8.fmt.pct(m.attnShareUnet));
  assert.strictEqual(Q8.get('dit-xl2-256.paperGflops').text, '118.6');
  assert.strictEqual(Q8.get('sd15-unet.tensor.d1-attn1-sa-scores.shape').text, '8×4096×4096');
});

test('F8 etiqueta + símbolo identifican una forma; byPath suma; aritmética; where; Quantities resuelve todas las claves', () => {
  const cases = [['sd15-unet', [{}, { cfg: 0 }, { res: 768 }]], ['sd15-train', [{}]], ['sdxl-unet', [{}]]].concat(DITS.map((id) => [id, [{}]]));
  for (const [id, ovs] of cases) {
    for (const ov of ovs) {
      const r = A8.run(id, ov), t = r.totals;
      const by = {};
      for (const tid of r.order) {
        const x = r.tensors[tid];
        const k = x.label + '|' + String(x.tex).split('=')[0].trim();
        (by[k] = by[k] || new Set()).add(x.num.join('×'));
      }
      for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
      assert.strictEqual(r.ops.reduce((s, o) => s + o.params * A8.paramRep(o), 0), t.params);
      assert.strictEqual(r.ops.reduce((s, o) => s + o.macs * o.repeat, 0), t.macs);
      const check = (pp, want) => {
        const kids = children(r, pp);
        if (!kids.length) return;
        const at = (k) => t.byPath[pp.concat([k]).join('>')];
        assert.strictEqual(kids.reduce((s, k) => s + at(k).params, 0), want.params, id + ' params bajo ' + (pp.join('>') || 'raíz'));
        assert.strictEqual(kids.reduce((s, k) => s + at(k).macs, 0), want.macs, id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
        kids.forEach((k) => check(pp.concat([k]), at(k)));
      };
      check([], t);
      for (const tid of r.order) {
        const x = r.tensors[tid];
        if (x.producer) assert.ok(r.ops.find((o) => o.id === x.producer).out.includes(tid));
        x.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(tid)));
      }
      for (const o of r.ops) {
        if (o.params && o.prim !== 'idle_params') assert.ok(o.paramArith.endsWith(A8.fmt.int(o.params)), id + ' ' + o.id + ' paramArith');
        if (o.macs) assert.ok(o.macArith.endsWith(A8.fmt.int(o.macs)), id + ' ' + o.id + ' macArith');
        assert.ok(!/undefined|NaN|null/.test(o.paramTex + o.macTex + o.shapeTex + o.label), id + ' ' + o.id + ' tex');
        assert.ok(Array.isArray(o.where) && o.where.length, id + ' ' + o.id + ' sin where');
      }
      // el encoder de texto importado no conserva h / d_h / D_mlp (son h_t, d_t, 4D_t: h es la de la U-Net)
      for (const o of r.ops.filter((x) => x.path[0] === 'text-encoder' && !/^te\d/.test(x.id))) {
        assert.ok(!/(^|[^A-Za-z\\{_])h(?![A-Za-z_])|d_h|mathrm\{mlp\}/.test(o.macTex + o.paramTex + o.shapeTex), id + ' ' + o.id + ': ' + o.macTex);
      }
    }
    assert.strictEqual(A8.run(id), A8.run(id), 'memoizado');
    J(Q8.keys(id)).forEach((k) => assert.ok(Q8.get(id + '.' + k), id + '.' + k));
  }
});

test('F8 revisión: blockParams en flow matching, costo de los bloques por imagen, pasadas secuenciales, frecuencias y ms con decimales', () => {
  const d = A8.metrics('dit-xl2-256', {}), fm = A8.metrics('dit-xl2-256-fm', {});
  assert.strictEqual(d.blockParams, 23905152);
  assert.strictEqual(fm.blockParams, d.blockParams);
  assert.ok(Math.abs(fm.adalnParamsShareBlock - d.adalnParamsShareBlock) < 1e-12);
  assert.strictEqual(d.blocksMacs, 28 * d.blockMacs);
  assert.strictEqual(d.blocksSamplingMacs, d.nfe * d.blocksMacs);
  assert.strictEqual(d.denoiserSamplingMacs, 500 * d.ditMacs);
  assert.ok(Math.abs(d.samplingMacs / 1e12 - 59.62) < 0.005);
  for (const [id, steps] of [['sd15-unet', 50], ['dit-xl2-256', 250]]) {
    const m = A8.metrics(id, {});
    assert.strictEqual(m.sequentialPasses, steps, id);
    assert.strictEqual(m.nfe, 2 * steps, id);
    assert.strictEqual(A8.metrics(id, { cfg: 0 }).sequentialPasses, steps, id + ' sin CFG');
  }
  assert.strictEqual(A8.metrics('sd15-unet', {}).freqCount, 160);
  assert.strictEqual(d.freqCount, 128);
  assert.match(A8.run('sd15-unet').ops.find((o) => o.id === 'temb-freq').label, /320 canales: cos y sin de 160 frecuencias/);
  // 'ms': 3 cifras significativas, sin la unidad (la prosa escribe ' ms')
  for (const k of ['unetNfeMs', 'vaeDecodeMs', 'textEncoderMs', 'samplingMs', 'msPerImage']) assert.strictEqual(A8.metrics('sd15-unet', {}).units[k], 'ms', k);
  assert.strictEqual(Q8.get('sd15-unet.metrics.unetNfeMs').text, '1.62');
  assert.strictEqual(Q8.get('sd15-unet.metrics.vaeDecodeMs').text, '2.54');
  assert.strictEqual(Q8.get('sd15-unet.metrics.msPerImage').text, '83.8');
  assert.strictEqual(Q8.get('dit-xl2-256.metrics.msPerImage').text, '121');
  assert.strictEqual(Q8.get('dit-xl2-256.metrics.ditNfeMs').text, '0.48');
});

// ================================================================ FASE 9 (VLA: OpenVLA, π0; ayudas de RT-2) — bloque del agente arch
// Contexto con todos los modelos hasta la fase 9 (vla.js compone el decoder de llm.js: va después de llm.js / vlm.js / diffusion.js).
const ATLAS9 = (function () {
  const ctx = vm.createContext({});
  for (const f of FILES.filter((x) => x !== 'js/core/quantities.js').concat(['js/arch/grounding-dino.js', 'js/arch/yolo-world.js', 'js/arch/sam.js', 'js/arch/llm.js', 'js/arch/vlm.js',
    'js/arch/diffusion.js', 'js/arch/vla.js', 'js/core/quantities.js'])) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('ATLAS', ctx);
})();
const A9 = ATLAS9.Arch, Q9 = ATLAS9.Quantities;
const VLA9 = ['openvla-7b', 'pi0', 'pi0-1cam'];
const S9 = (sym, num, mod, layout) => A9.shape(sym, num, mod || 'act', layout || 'seq');

test('F9 los modelos openvla / pi0 no cambian ningún resultado de las fases 1–8', () => {
  for (const c of A8.configs()) {
    const a = A8.run(c.id), b = A9.run(c.id);
    assert.deepStrictEqual([b.totals.params, b.totals.macs, b.totals.other], [a.totals.params, a.totals.macs, a.totals.other], c.id);
    const ma = A8.metrics(c.id, {}), mb = A9.metrics(c.id, {});
    assert.deepStrictEqual([mb.attnMem, mb.actMem, mb.kvCache], [ma.attnMem, ma.actMem, ma.kvCache], c.id + ' metrics');
  }
  assert.ok(J(A9.models()).includes('openvla') && J(A9.models()).includes('pi0') && !J(A9.models()).includes('rt2'));
  assert.deepStrictEqual(J(A9.configs('openvla').map((c) => c.id)), ['openvla-7b']);
  assert.deepStrictEqual(J(A9.configs('pi0').map((c) => c.id)), ['pi0', 'pi0-1cam']);
  assert.deepStrictEqual([A9.canonical('openvla'), A9.canonical('pi0')], ['openvla-7b', 'pi0']);
  assert.deepStrictEqual(J(A9.vla.primitives().map((p) => p.id)), ['normalize_pixels', 'prefix_tokens', 'broadcast_rows', 'prefix_mask', 'block_causal_mask', 'ar_decode', 'detokenize_actions']);
});

test('F9 primitivas locales de vla.js: prefix_tokens, broadcast_rows, máscaras, ar_decode, detokenize_actions', () => {
  const P9 = A9.vla.prims;
  const pt = P9.prefix_tokens(S9(['N_p', 'D_d'], [4, 8], 'img'), { k: 5, sym: 'N_p+5' });
  assert.deepStrictEqual([J(pt.out.num), J(pt.out.sym), pt.params, pt.macs, pt.paramArith], [[9, 8], ['N_p+5', 'D_d'], 40, 0, '5·8 = 40']);
  const br = P9.broadcast_rows(S9(['D_a'], [6], 'act', 'vec'), { rows: 3, sym: 'H_a' });
  assert.deepStrictEqual([J(br.out.num), J(br.out.sym), br.params, br.macs], [[3, 6], ['H_a', 'D_a'], 0, 0]);
  const sc = S9(['h', '1+H_a', 'S'], [2, 4, 9], 'act', 'heads');
  for (const m of [P9.prefix_mask(sc), P9.block_causal_mask(sc)]) assert.deepStrictEqual([J(m.out.num), m.params, m.macs, m.other], [[2, 4, 9], 0, 0, 72]);
  const ad = P9.ar_decode(S9(['1'], [1], 'txt', 'vec'), { steps: [{ ctx: 5, macs: 10 }, { ctx: 6, macs: 11 }], sym: 'd_a' });
  assert.deepStrictEqual([J(ad.out.num), ad.macs, ad.params, ad.macArith], [[3], 21, 0, '10 + 11 = 21']);
  const dt = P9.detokenize_actions(S9(['d_a'], [7], 'act', 'vec'), {});
  assert.deepStrictEqual([J(dt.out.num), dt.out.mod, dt.params, dt.macs], [[7], 'act', 0, 0]);
  const nz = P9.normalize_pixels(S9(['H', 'W', 'C'], [2, 2, 3], 'img', 'grid'), {});
  assert.deepStrictEqual([J(nz.out.num), nz.other], [[2, 2, 3], 24]);
});

test('F9 OpenVLA 7B: 7,541,237,184 parámetros (= el checkpoint) y cada parte contada a mano', () => {
  const r = A9.run('openvla-7b'), t = r.totals, by = t.byPath, c = r.config;
  assert.strictEqual(t.params, 15082474368 / 2);       // model.safetensors.index.json: total_size en bf16 / 2
  // DINOv2 ViT-L/14 reg4 a 224: conv 14·14·3·1024 + 1024, pos 256·1024, CLS + 4 registros, 24 capas con LayerScale (12D² + 15D), norma final 2D
  const D = 1024, blk = 12 * D * D + 15 * D;
  assert.strictEqual(t.byNode.dinov2.params, 14 * 14 * 3 * D + D + 256 * D + 5 * D + 24 * blk + 2 * D);
  assert.strictEqual(by['dinov2>enc-layer'].params, 23 * blk);
  // SigLIP So400m/14: MLP 4304 (no 4·1152), 27 capas sin LayerScale; norma final + attention pooling MAP sin uso (15,238,352)
  const Ds = 1152, M = 4304, sblk = 4 * Ds * Ds + 2 * Ds * M + M + 9 * Ds;
  assert.strictEqual(t.byNode.siglip.params, 14 * 14 * 3 * Ds + Ds + 256 * Ds + 27 * sblk + 2 * Ds + 15238352);
  // proyector fused-gelu-mlp: TRES lineales 2176 → 8704 → 4096 → 4096
  assert.strictEqual(t.byNode.projector.params, 2176 * 8704 + 8704 + 8704 * 4096 + 4096 + 4096 * 4096 + 4096);
  assert.deepStrictEqual(J(r.ops.filter((o) => o.path[0] === 'projector' && o.prim === 'linear').map((o) => o.id)), ['proj-fc1', 'proj-fc2', 'proj-fc3']);
  // Llama 2 7B con vocab 32,064 = el de llm.js + 2·64·D
  assert.strictEqual(t.byNode.llm.params + t.byNode['lm-head'].params + t.byNode.embed.params, A9.run('llama2-7b').totals.params + 2 * 64 * 4096);
  const m = A9.metrics('openvla-7b', {});
  assert.deepStrictEqual([m.idleParams, m.visionParamsUsed + m.idleParams, m.dinoParams, m.siglipParams], [2 * D + 2 * Ds + 15238352, m.visionParams, 303230976, 427680704]);
  // formas clave
  const sh = (id) => J(r.tensors[id].num).join('×');
  assert.deepStrictEqual(['d-x0', 'd-feats', 's-feats', 'vis-feats', 'proj-h1', 'vis-tokens', 'prompt', 'logits', 'action-tokens', 'action'].map(sh),
    ['261×1024', '256×1024', '256×1152', '256×2176', '256×8704', '256×4096', '278×4096', '278×32064', '7', '7']);
  assert.deepStrictEqual([c.N, c.T, c.S, c.Dv, c.actionTokenFirst, c.actionTokenLast], [256, 22, 278, 2176, 31744, 31999]);
  assert.deepStrictEqual(J(r.tensors.prompt.sym), ['N+T', 'D']);
});

test('F9 OpenVLA: MACs por acción = prefill + 6 pasos de decode del Llama de llm.js; la última capa de cada torre se calcula', () => {
  const r = A9.run('openvla-7b'), t = r.totals, m = A9.metrics('openvla-7b', {});
  const V64 = 4096 * 64;   // la fila extra del LM head por las 64 entradas de vocab (32,064 vs 32,000)
  assert.strictEqual(m.llmPrefillMacs, A9.run('llama2-7b', { T: 278 }).totals.macs + 278 * V64);
  for (let k = 1; k <= 6; k++) assert.strictEqual(r.ops.find((o) => o.id === 'ar-decode').detail.steps[k - 1].macs, A9.run('llama2-7b', { decode: 1, ctx: 278 + k }).totals.macs + V64);
  assert.strictEqual(m.decodeMacsPerToken, A9.run('llama2-7b', { decode: 1, ctx: 279 }).totals.macs + V64);
  assert.strictEqual(m.macsPerAction, t.macs);
  assert.strictEqual(t.macs, m.prefillMacs + m.decodeMacsTotal);
  assert.strictEqual(m.prefillMacs, m.visionMacs + m.projectorMacs + m.llmPrefillMacs);
  // torres: DINOv2 corre 24 capas sobre 261 tokens, SigLIP 27 sobre 256 (la última de cada una se descarta)
  const vit = (N, Dw, Dm) => N * (4 * Dw * Dw + 2 * Dw * Dm) + 2 * N * N * Dw;
  assert.strictEqual(m.dinoMacs, 256 * 1024 * 588 + 24 * vit(261, 1024, 4096));
  assert.strictEqual(m.siglipMacs, 256 * 1152 * 588 + 27 * vit(256, 1152, 4304));
  assert.strictEqual(m.visionMacsDiscarded, vit(261, 1024, 4096) + vit(256, 1152, 4304));
  assert.strictEqual(m.projectorMacs, 256 * (2176 * 8704 + 8704 * 4096 + 4096 * 4096));
  assert.deepStrictEqual([m.kvBytesPerToken, m.actionTokensPerStep, m.decodeSteps, m.visualTokens], [2 * 32 * 32 * 128 * 2, 7, 6, 256]);
  // T: knob
  const r64 = A9.run('openvla-7b', { T: 64 });
  assert.deepStrictEqual([r64.config.S, J(r64.tensors.logits.num)], [320, [320, 32064]]);
  assert.throws(() => A9.run('openvla-7b', { T: 1 }), /BOS/);
  assert.throws(() => A9.run('openvla-7b', { H: 50 }), /Knob inválido/);
  // res (what-if: tablas de posición interpoladas a (res/14)² filas), images (mismos pesos, MACs × images), da (tokens por paso)
  const r448 = A9.run('openvla-7b', { res: 448 }), mi = A9.metrics('openvla-7b', { images: 2 }), md = A9.metrics('openvla-7b', { da: 4 });
  assert.deepStrictEqual([r448.config.Np, r448.totals.params - r.totals.params, J(r448.tensors['d-x0'].num)], [1024, 768 * (1024 + 1152), [1029, 1024]]);
  assert.deepStrictEqual([mi.visualTokens, mi.totalParams, mi.visionMacs, mi.projectorMacs], [512, m.totalParams, 2 * m.visionMacs, 2 * m.projectorMacs]);
  assert.deepStrictEqual(J(A9.run('openvla-7b', { images: 2 }).tensors['vis-tokens'].num), [256, 4096]);   // formas por imagen
  assert.deepStrictEqual([md.decodeSteps, md.actionTokensPerStep, md.prefillMacs, J(A9.run('openvla-7b', { da: 4 }).tensors.action.num)], [3, 4, m.prefillMacs, [4]]);
  assert.throws(() => A9.run('openvla-7b', { res: 230 }), /múltiplo/);
});

test('F9 π0: 3,238,048,528 parámetros (PaliGemma 3B + experto gemma_300m + proyecciones) y formas de la atención conjunta', () => {
  const r = A9.run('pi0'), t = r.totals, c = r.config, m = A9.metrics('pi0', {});
  // experto: 18 × (q 1024·2048 + k, v 2·1024·256 + o 2048·1024 + FFN 3·1024·4096 + 2 RMSNorm) + norma final
  const ex = 18 * (1024 * 2048 + 2 * 1024 * 256 + 2048 * 1024 + 3 * 1024 * 4096 + 2 * 1024) + 1024;
  assert.deepStrictEqual([m.expertParams, ex], [311464960, 311464960]);
  const proj = 2 * (32 * 1024 + 1024) + (2048 * 1024 + 1024) + (1024 * 1024 + 1024) + (1024 * 32 + 32);
  assert.strictEqual(m.actionProjParams, proj);
  // Gemma 2B (MQA, d_h 256, GeGLU 16,384, vocab 257,152 atado) y SigLIP So400m + head 1152 → 2048
  const gem = 257152 * 2048 + 18 * (2048 * 2048 + 2 * 2048 * 256 + 2048 * 2048 + 3 * 2048 * 16384 + 2 * 2048) + 2048;
  assert.strictEqual(m.gemmaParams, gem);
  assert.strictEqual(m.imgProjParams, 1152 * 2048 + 2048);
  assert.deepStrictEqual([m.paligemmaParams, t.params], [2923335408, 3238048528]);
  assert.strictEqual(t.params, m.paligemmaParams + m.expertParams + m.actionProjParams);
  // cámaras: los pesos de SigLIP no cambian con cams
  assert.strictEqual(A9.run('pi0-1cam').totals.params, t.params);
  const sh = (id) => J(r.tensors[id].num).join('×');
  assert.deepStrictEqual(['img-tokens', 'prefix', 'k-rope', 'suffix', 'a-q', 'a-k', 'a-k-all', 'a-scores', 'a-z', 'velocity', 'action-chunk'].map(sh),
    ['256×2048', '816×2048', '1×816×256', '51×1024', '51×2048', '51×256', '1×867×256', '8×51×867', '51×2048', '50×32', '50×32']);
  assert.deepStrictEqual(J(r.tensors['a-scores'].sym), ['h', '1+H_a', 'N+T+1+H_a']);
  assert.deepStrictEqual([c.N, c.T, c.S, c.suffix, c.ctx, c.Ha, c.steps], [768, 48, 816, 51, 867, 50, 10]);
  // el experto lee la KV del prefijo: sus kv_append consumen k-rope y v-heads de Gemma
  assert.deepStrictEqual(J(r.ops.find((o) => o.id === 'ae-kv-k').in), ['k-rope', 'a-k-rope']);
  assert.deepStrictEqual(J(r.ops.find((o) => o.id === 'ae-kv-v').in), ['v-heads', 'a-v-heads']);
  assert.strictEqual(r.ops.find((o) => o.id === 'gelu').prim, 'gelu');
  assert.strictEqual(r.ops.find((o) => o.id === 'mask').prim, 'prefix_mask');
  assert.ok(!r.ops.some((o) => o.id === 'silu' || o.id === 'lm-head'));
});

test('F9 π0: MACs por chunk = prefijo una vez + pasos × paso de flow (contado a mano); knobs cams, H, steps, T', () => {
  const m = A9.metrics('pi0', {}), t = A9.run('pi0').totals;
  const sig = 256 * 1152 * 588 + 27 * (256 * (4 * 1152 * 1152 + 2 * 1152 * 4304) + 2 * 256 * 256 * 1152) + 256 * 1152 * 2048;
  assert.strictEqual(m.visionMacs, 3 * sig);
  const S = 816, gl = S * (2048 * 2048 + 2 * 2048 * 256 + 2048 * 2048 + 3 * 2048 * 16384) + 2 * 8 * S * S * 256;
  assert.strictEqual(m.gemmaPrefixMacs, 18 * gl);
  const R = 51, K = 867, el = R * (1024 * 2048 + 2 * 1024 * 256 + 2048 * 1024 + 3 * 1024 * 4096) + 2 * 8 * R * K * 256;
  const pr = 32 * 1024 + 50 * 32 * 1024 + 50 * 2048 * 1024 + 50 * 1024 * 1024 + 50 * 1024 * 32;
  assert.strictEqual(m.flowStepMacs, 18 * el + pr);
  assert.strictEqual(m.macsPerChunk, m.prefixMacs + 10 * m.flowStepMacs);
  assert.strictEqual(t.macs, m.macsPerChunk);
  assert.strictEqual(m.macsPerAction, m.macsPerChunk / 50);
  assert.deepStrictEqual([m.kvBytesPerToken, m.prefixKvBytes, m.prefixTokens, m.suffixTokens, m.kvRows], [18432, 816 * 18432, 816, 51, 867]);
  // steps solo cambia la repetición del sufijo; cams y T el prefijo; H el sufijo
  const at = (ov) => A9.metrics('pi0', ov);
  assert.strictEqual(at({ steps: 5 }).macsPerChunk, m.prefixMacs + 5 * m.flowStepMacs);
  assert.strictEqual(at({ steps: 5 }).totalParams, m.totalParams);
  assert.strictEqual(at({ cams: 1 }).macsPerChunk, A9.metrics('pi0-1cam', {}).macsPerChunk);
  assert.deepStrictEqual([at({ H: 25 }).suffixTokens, J(A9.run('pi0', { H: 25 }).tensors.velocity.num)], [26, [25, 32]]);
  assert.strictEqual(at({ T: 16 }).prefixTokens, 784);
  assert.ok(A9.run('pi0', { H: 25 }).notes.some((n) => /reentrenar/.test(n)));
  assert.throws(() => A9.run('pi0', { cams: 9 }), /cams/);
  assert.throws(() => A9.run('pi0', { res: 448 }), /Knob inválido/);
  assert.deepStrictEqual(J(m.stepsScaling.map((x) => x.steps)), [1, 5, 10, 20]);
  assert.ok(m.stepsScaling.every((x, i, a) => !i || x.macsPerChunk > a[i - 1].macsPerChunk));
  assert.deepStrictEqual(J(m.camsScaling.map((x) => x.prefixTokens)), [304, 560, 816]);
});

test('F9 roofline (≈) por GPU: hardware citado, segmentos que suman, H100 > RTX 4090 > Orin; units conocidas', () => {
  const hw = J(A9.vla.hardware());
  assert.deepStrictEqual(hw.map((h) => [h.id, h.bandwidth, h.peakFlops]), [['h100', 3.35e12, 989e12], ['rtx4090', 1008e9, 165.2e12], ['orin', 204.8e9, 42.5e12]]);
  assert.ok(hw.every((h) => typeof h.source === 'string' && h.source.length > 40));
  const o = A9.metrics('openvla-7b', {}), p = A9.metrics('pi0', {});
  for (const m of [o, p]) {
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'].includes(u), k + ': ' + u);
    Object.keys(m).filter((k) => typeof m[k] === 'number' && /Macs$/.test(k)).forEach((k) => assert.strictEqual(m.units[k], 'macs', k));
    Object.keys(m).filter((k) => typeof m[k] === 'number' && /Ms(H100|Rtx4090|Orin)?$/.test(k)).forEach((k) => assert.strictEqual(m.units[k], 'ms', k));
  }
  assert.ok(o.hzH100 > o.hzRtx4090 && o.hzRtx4090 > o.hzOrin);
  assert.ok(Math.abs(o.actionMsRtx4090 - (o.visionMsRtx4090 + o.prefillMsRtx4090 + o.hardware[1].decodeTotalMs)) < 1e-9);
  assert.ok(Math.abs(o.hzRtx4090 - 1000 / o.actionMsRtx4090) < 1e-9);
  assert.strictEqual(o.decodeBound, 'memoria');   // un token: leer los 13.5 GB de pesos domina
  assert.ok(p.chunkHzH100 > p.chunkHzRtx4090 && p.chunkHzRtx4090 > p.chunkHzOrin);
  assert.ok(Math.abs(p.chunkMsRtx4090 - (p.imageMsRtx4090 + p.prefixMsRtx4090 + p.flowMsRtx4090)) < 1e-9);
  assert.strictEqual(p.flowBound, 'memoria');
  // la cota de roofline queda por debajo de lo medido en el paper (73 ms en RTX 4090): es una cota, ≈
  assert.ok(p.chunkMsRtx4090 < p.paperOnboardMs);
  assert.deepStrictEqual(J(p.chunkRates.map((x) => [x.controlHz, x.executed, x.intervalMs])), [[50, 25, 500], [20, 16, 800]]);
  // hardware propio por overrides
  assert.ok(A9.metrics('pi0', { peakFlops: 989e12 / 2 }).chunkMs > p.chunkMs);
  assert.throws(() => A9.metrics('pi0', { bandwidth: -1 }), /positivo/);
});

test('F9 ayudas: tokens de RT-2, tokenizador de acciones de OpenVLA (ids 31,744–31,999) y máscara de π0', () => {
  const V = A9.vla;
  assert.deepStrictEqual(J(V.rt2Tokens({ hz: 3 })), { dims: 7, terminate: 1, bins: 256, tokensPerStep: 8, bitsPerDim: 8, valuesPerStep: Math.pow(256, 7), hz: 3, tokensPerSecond: 24, msPerStep: 1000 / 3, msPerToken: 1000 / 24 });
  const d = V.discretize(0.003, { bins: 256 });
  assert.deepStrictEqual([d.bin, d.width], [128, 2 / 256]);
  assert.ok(Math.abs(d.error) <= d.width / 2);
  assert.strictEqual(V.binCenter(0), -1 + 1 / 256);
  // np.digitize sobre linspace(−1, 1, 256): −1 → bin 1 (id 31,999), 1 → bin 256 (id 31,744)
  assert.deepStrictEqual(J(V.openvlaTokenize(-1)), { bin: 1, id: 31999 });
  assert.deepStrictEqual(J(V.openvlaTokenize(1)), { bin: 256, id: 31744 });
  assert.deepStrictEqual(J(V.openvlaTokenize(5)), { bin: 256, id: 31744 });   // se recorta a [−1, 1]
  assert.strictEqual(V.openvlaDetokenize(31744).center, V.openvlaDetokenize(31745).center);   // 255 centros: bins 255 y 256 iguales
  assert.ok(Math.abs(V.openvlaDetokenize(31999).center - (-1 + 1 / 255)) < 1e-12);
  for (const x of [-0.9, -0.31, 0, 0.42, 0.97]) assert.ok(Math.abs(V.openvlaDetokenize(V.openvlaTokenize(x).id).center - x) <= 1 / 255 + 1e-12, String(x));
  const mk = V.pi0Mask({ cams: 3, T: 48, H: 50 });
  assert.deepStrictEqual(J(mk.groups.map((g) => [g.id, g.to - g.from])), [['image-1', 256], ['image-2', 256], ['image-3', 256], ['language', 48], ['state', 1], ['actions', 50]]);
  assert.strictEqual(mk.total, 867);
  const ix = (id) => mk.groups.findIndex((g) => g.id === id);
  assert.ok(mk.matrix[ix('image-1')][ix('language')] && mk.matrix[ix('language')][ix('image-3')]);   // prefijo bidireccional
  assert.ok(!mk.matrix[ix('language')][ix('state')] && !mk.matrix[ix('state')][ix('actions')]);
  assert.ok(mk.matrix[ix('state')][ix('state')] && mk.matrix[ix('actions')][ix('state')] && mk.matrix[ix('actions')][ix('image-2')]);
  assert.ok(mk.canAttend(866, 0) && !mk.canAttend(816, 817) && mk.canAttend(817, 816));
});

test('F9 etiqueta + símbolo identifican una forma; byPath suma; aritmética; where; Quantities resuelve todas las claves', () => {
  const cases = [['openvla-7b', [{}, { T: 64 }, { res: 336, images: 2, da: 4 }]], ['pi0', [{}, { cams: 2, H: 25, steps: 5, T: 16 }]], ['pi0-1cam', [{}]]];
  for (const [id, ovs] of cases) {
    for (const ov of ovs) {
      const r = A9.run(id, ov), t = r.totals;
      const by = {};
      for (const tid of r.order) {
        const x = r.tensors[tid];
        const k = x.label + '|' + String(x.tex).split('=')[0].trim();
        (by[k] = by[k] || new Set()).add(x.num.join('×'));
      }
      for (const [k, v] of Object.entries(by)) assert.strictEqual(v.size, 1, id + ': "' + k + '" tiene ' + [...v].join(' y '));
      assert.strictEqual(r.ops.reduce((s, o) => s + o.params * A9.paramRep(o), 0), t.params);
      assert.strictEqual(r.ops.reduce((s, o) => s + o.macs * o.repeat, 0), t.macs);
      const check = (pp, want) => {
        const kids = children(r, pp);
        if (!kids.length) return;
        const at = (k) => t.byPath[pp.concat([k]).join('>')];
        assert.strictEqual(kids.reduce((s, k) => s + at(k).params, 0), want.params, id + ' params bajo ' + (pp.join('>') || 'raíz'));
        assert.strictEqual(kids.reduce((s, k) => s + at(k).macs, 0), want.macs, id + ' MACs bajo ' + (pp.join('>') || 'raíz'));
        kids.forEach((k) => check(pp.concat([k]), at(k)));
      };
      check([], t);
      for (const tid of r.order) {
        const x = r.tensors[tid];
        if (x.producer) assert.ok(r.ops.find((o) => o.id === x.producer).out.includes(tid));
        x.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(tid)));
      }
      for (const o of r.ops) {
        if (o.params && o.prim !== 'idle_params') assert.ok(o.paramArith.endsWith(A9.fmt.int(o.params)), id + ' ' + o.id + ' paramArith');
        if (o.macs) assert.ok(o.macArith.endsWith(A9.fmt.int(o.macs)), id + ' ' + o.id + ' macArith');
        assert.ok(!/undefined|NaN|null/.test(o.paramTex + o.macTex + o.shapeTex + o.label), id + ' ' + o.id + ' tex');
        assert.ok(Array.isArray(o.where) && o.where.length, id + ' ' + o.id + ' sin where');
      }
      // nodos raíz de la vista overview (SPEC §21)
      const roots = new Set(r.ops.map((o) => o.path[0]));
      const want = r.model === 'openvla' ? ['dinov2', 'siglip', 'concat', 'projector', 'embed', 'merge', 'llm', 'lm-head', 'action-tokens', 'detokenize']
        : ['siglip', 'language', 'gemma', 'state', 'noisy-actions', 't-embed', 'action-expert', 'velocity', 'euler'];
      assert.deepStrictEqual(J([...roots].sort()), want.slice().sort(), id + ' nodos raíz');
    }
    assert.strictEqual(A9.run(id), A9.run(id), 'memoizado');
    J(Q9.keys(id)).forEach((k) => assert.ok(Q9.get(id + '.' + k), id + '.' + k));
  }
  assert.strictEqual(Q9.get('openvla-7b.params.total').text, '7,541,237,184');
  assert.strictEqual(Q9.get('pi0.params.total').text, '3,238,048,528');
  assert.strictEqual(Q9.get('pi0.tensor.a-scores.shape').text, '8×51×867');
  assert.strictEqual(Q9.get('pi0.tensor.a-scores.sym').text, 'h×(1+H_a)×(N+T+1+H_a)');
  assert.strictEqual(Q9.get('openvla-7b.quantities.actionTokenFirst').text, '31,744');
  assert.strictEqual(Q9.get('pi0.metrics.macsPerChunk').text, A9.fmt.ops(A9.metrics('pi0', {}).macsPerChunk));
  assert.strictEqual(Q9.get('openvla-7b.metrics.hzRtx4090').text, String(Number(A9.metrics('openvla-7b', {}).hzRtx4090.toPrecision(3))));
});
// ================================================================ fin del bloque de la fase 9
