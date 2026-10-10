// Pruebas de la fase 13 (recomendación y árboles: js/arch/recsys.js, js/arch/trees.js + primitivas nuevas de primitives.js).
// Cuentas a mano, totales exactos de las referencias (crosscheck/recsys.py en meta; crosscheck/trees.py con modelos reales),
// formas y comportamiento de los knobs.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ARCH = Array.from(html.matchAll(/<script src="(js\/arch\/[^"]+)"/g), (m) => m[1]);
function load(files) {
  const ctx = vm.createContext({});
  for (const f of ['js/core/registry.js'].concat(files, ['js/core/quantities.js'])) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return vm.runInContext('ATLAS', ctx);
}
const ATLAS = load(ARCH);
const A = ATLAS.Arch;
const J = (x) => JSON.parse(JSON.stringify(x));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const TT = ['two-tower-base', 'two-tower-small', 'two-tower-no-ids'];
const DL = ['dlrm-criteo-kaggle', 'dlrm-mlperf', 'dlrm-dcnv2', 'wide-and-deep'];
const GB = ['xgboost-500-d6', 'lightgbm-500-l31', 'xgboost-2000-d8', 'catboost-oblivious-d6'];
const KAGGLE = [1460, 583, 10131227, 2202608, 305, 24, 12517, 633, 3, 93145, 5683, 8351593, 3194, 27, 14992, 5461306, 10, 5652, 2173, 4, 7046547, 18, 15, 286181, 105, 142572];
const TB = [40000000, 39060, 17295, 7424, 20265, 3, 7122, 1543, 63, 40000000, 3067956, 405282, 10, 2209, 11938, 155, 4, 976, 14, 40000000, 40000000, 40000000, 590152, 12973, 108, 36];
const GENERIC = new Set(['B', 'bytesPerElement', 'tokens', 'params', 'macs', 'flops', 'other', 'attnMacs', 'attnMacsShare', 'scoreMacs', 'scoreMacsShare',
  'linearMacs', 'attnMem', 'attnMemAllLayers', 'actMem', 'actMemPerSample', 'paramMem']);
const lin = (a, b) => a * b + b;
const mlpP = (s) => sum(s.slice(1).map((n, i) => lin(s[i], n)));
const mlpM = (s) => sum(s.slice(1).map((n, i) => s[i] * n));

// ---------------------------------------------------------------- primitivas
test('F13 embedding_bag / embedding_tables: parámetros, 0 MACs, sumas en "otros", lookups y bytes', () => {
  const ids = A.shape(['n'], [50], 'txt', 'vec');
  const bag = A.embedding_bag(ids, { rows: 1000, D: 64, mode: 'mean' });
  assert.deepStrictEqual([J(bag.out.num), bag.params, bag.macs, bag.other, bag.detail.lookups, bag.detail.bytesRead32], [[64], 64000, 0, 49 * 64 + 64, 50, 50 * 64 * 4]);
  const one = A.embedding_bag(A.shape(['1'], [1], 'txt', 'vec'), { rows: 10, D: 8 });
  assert.deepStrictEqual([one.other, one.detail.lookups], [0, 1]);
  const t = A.embedding_tables(A.shape(['n_s'], [3], 'txt', 'vec'), { rows: [5, 7, 9], D: 4 });
  assert.deepStrictEqual([J(t.out.num), t.params, t.macs, t.other, t.detail.totalRows, t.detail.maxRows], [[3, 4], 21 * 4, 0, 0, 21, 9]);
  const c = A.embedding_tables(A.shape(['4'], [4], 'txt', 'vec'), { rows: [250, 100, 8, 24], D: 16, concat: true });
  assert.deepStrictEqual([J(c.out.num), c.params], [[64], 382 * 16]);
  const mh = A.embedding_tables(A.shape(['L_hot'], [6], 'txt', 'vec'), { rows: [5, 7], D: 4, hots: [2, 4] });
  assert.deepStrictEqual([mh.detail.lookups, mh.other, mh.detail.bytesRead32], [6, (6 - 2) * 4, 6 * 4 * 4]);
  assert.throws(() => A.embedding_tables(ids, { rows: [1, 2], D: 4, hots: [1] }), /multi-hot/);
});

test('F13 interacción de DLRM: stack_rows, pairwise_dot (bmm entero), tril_select, flatten_vec', () => {
  const d = A.shape(['d'], [16], 'lat', 'vec'), E = A.shape(['n_s', 'd'], [26, 16], 'txt', 'seq');
  const T = A.stack_rows([d, E], { sym: 'n_s+1' });
  assert.deepStrictEqual([J(T.out.num), J(T.out.sym)], [[27, 16], ['n_s+1', 'd']]);
  const Z = A.pairwise_dot(T.out);
  assert.deepStrictEqual([J(Z.out.num), Z.macs, Z.detail.pairs, Z.detail.usefulMacs, Z.out.layout], [[27, 27], 27 * 27 * 16, 351, 351 * 16, 'mat']);
  const P = A.tril_select(Z.out, { sym: 'n_pairs' });
  assert.deepStrictEqual([J(P.out.num), P.macs, P.params], [[351], 0, 0]);
  assert.deepStrictEqual(J(A.flatten_vec(T.out).out.num), [27 * 16]);
  assert.throws(() => A.stack_rows([d, A.shape(['n', 'e'], [2, 8], 'txt', 'seq')]), /anchos/);
});

test('F13 DCN v2: cross_mix y cross_layer de bajo rango y de rango completo (Wang et al. 2021, ec. 1)', () => {
  const x = A.shape(['n'], [3456], 'txt', 'vec');
  const m = A.cross_mix(x, x, x);
  assert.deepStrictEqual([m.params, m.macs, m.other], [3456, 0, 3 * 3456]);
  const lr = A.cross_layer(x, x, { r: 512 });
  assert.deepStrictEqual([lr.params, lr.macs], [2 * 3456 * 512 + 3456, 2 * 3456 * 512]);
  const fr = A.cross_layer(x, x);
  assert.deepStrictEqual([fr.params, fr.macs], [3456 * 3456 + 3456, 3456 * 3456]);
  assert.throws(() => A.cross_mix(x, A.shape(['m'], [5], 'txt', 'vec'), x), /formas/);
});

test('F13 logq_correct y primitivas de árboles (a mano)', () => {
  const L = A.shape(['B', 'B'], [4, 4], null, 'mat'), q = A.shape(['B'], [4], 'txt', 'vec');
  const lq = A.logq_correct(L, q, { tau: 0.05 });
  assert.deepStrictEqual([J(lq.out.num), lq.params, lq.macs, lq.other], [[4, 4], 0, 0, 32]);
  // filas recorridas por los histogramas (con la resta padre − hermano)
  assert.strictEqual(A.treeHistRows({ kind: 'depthwise', N: 1000, depth: 6 }), 1000 * 3.5);
  assert.strictEqual(A.treeHistRows({ kind: 'leafwise', N: 1024, leaves: 32 }), 1024 * 3.5);
  assert.deepStrictEqual(J(A.treeSplitEvals({ kind: 'depthwise', depth: 6, F: 10, bins: 256 })), { nodes: 63, evals: 63 * 10 * 256 });
  assert.deepStrictEqual(J(A.treeSplitEvals({ kind: 'leafwise', leaves: 31, F: 10, bins: 255 })), { nodes: 61, evals: 61 * 10 * 255 });
  const s = A.shape(['3'], [3], 'lat', 'vec');
  assert.strictEqual(A.grow_tree(s, { internal: 63, leaves: 64 }).params, 127);
  assert.strictEqual(A.grow_tree(s, { internal: 63, leaves: 64, oblivious: true, depth: 6 }).params, 70);
  const X = A.shape(['N', 'F'], [100, 10], 'lat', 'seq'), g = A.shape(['N'], [100], 'lat', 'vec');
  const h = A.histogram_build(X, g, g, { rows: 350, F: 10, bins: 257, nodes: 63 });
  assert.deepStrictEqual([J(h.out.num), h.macs, h.other], [[10, 257, 2], 0, 2 * 350 * 10]);
  assert.deepStrictEqual([A.quantize_bins(X, { bins: 256 }).other, A.tree_predict(A.shape(['F'], [10], 'lat', 'vec'), { K: 500, comparisons: 3000 }).other], [100 * 10 * 8, 3000]);
  assert.strictEqual(A.leaf_sum(A.shape(['K'], [500], 'lat', 'vec'), { base: true }).params, 1);
  // bytes del modelo por formato (≈, verificados con modelos reales en crosscheck/trees.py)
  assert.strictEqual(A.tree_bytes({ format: 'xgb-ubj', nodes: 63500, K: 500 }).bytes, 34 * 63500 + 660 * 500 + 830);
  assert.strictEqual(A.tree_bytes({ format: 'lgb-text', leaves: 15500, K: 500, F: 100 }).bytes, 88 * 15500 + 160 * 500 + 70 * 100 + 6000);   // ± 3 % en 16 modelos
  assert.strictEqual(A.tree_bytes({ format: 'cb-cbm', K: 500, depth: 6, F: 100 }).bytes, 500 * (16 * 64 + 17 * 6) + 88 * 100);
  assert.throws(() => A.tree_bytes({ format: 'onnx' }), /formato/);
  for (const id of ['embedding_bag', 'embedding_tables', 'pairwise_dot', 'cross_layer', 'logq_correct', 'histogram_build', 'split_find', 'grow_tree', 'tree_predict']) {
    assert.ok(A.primitives().some((p) => p.id === id), 'falta ' + id + ' en primitives()');
  }
});

test('F13 símbolos nuevos en LaTeX (subíndices en \\mathrm) sin tocar los anteriores', () => {
  assert.strictEqual(A.fmt.symTex('N_items'), 'N_{\\mathrm{items}}');
  assert.strictEqual(A.fmt.symTex('d+n_pairs'), '(d{+}n_{\\mathrm{pairs}})');
  assert.strictEqual(A.fmt.symTex('n_s+1'), '(n_s{+}1)');
  assert.strictEqual(A.fmt.symTex('D_mlp'), 'D_{\\mathrm{mlp}}');
  assert.strictEqual(A.fmt.symTex('n_list'), 'n_{\\mathrm{list}}');
  assert.strictEqual(A.fmt.symTex('d_v'), 'd_v');   // símbolo de vlm.js: intacto
});

// ---------------------------------------------------------------- DLRM
test('F13 DLRM Criteo Kaggle: parámetros, MACs y formas a mano (bench/dlrm_s_criteo_kaggle.sh)', () => {
  const r = A.run('dlrm-criteo-kaggle');
  assert.strictEqual(sum(KAGGLE), 33762577);
  const bot = [13, 512, 256, 64, 16], top = [367, 512, 256, 1];
  assert.strictEqual(r.totals.params, 33762577 * 16 + mlpP(bot) + mlpP(top));
  assert.strictEqual(r.totals.params, 540677217);
  assert.strictEqual(r.totals.macs, mlpM(bot) + 27 * 27 * 16 + mlpM(top));
  assert.strictEqual(r.totals.macs, 486032);
  assert.deepStrictEqual(['feats', 'gram', 'pairs', 'top-in', 'bot-out', 'emb', 'logit', 'ctr'].map((t) => J(r.tensors[t].num)), [[27, 16], [27, 27], [351], [367], [16], [26, 16], [1], [1]]);
  assert.strictEqual(r.config.topIn, 27 * 26 / 2 + 16);   // num_int de dlrm_s_pytorch.py
  const m = A.metrics('dlrm-criteo-kaggle', {});
  assert.strictEqual(m.lookupBytesPerSample, 26 * 16 * 4);
  assert.strictEqual(m.interactionMacsUseful, 351 * 16);
  assert.ok(m.embeddingParamsShare > 0.999);
  assert.strictEqual(m.embeddingBytes, 33762577 * 16 * 4);
  assert.strictEqual(m.rankingMacsPerRequest, 500 * 486032);
  assert.ok(Math.abs(m.ridgePoint - 989e12 / 3.35e12) < 1e-9);
});

test('F13 DLRM MLPerf y DCN v2: tablas de Criteo 1TB con tope 40M, multi-hot 214, cruces de rango 512', () => {
  assert.strictEqual(sum(TB), 204184588);
  const bot = [13, 512, 256, 128];
  const mp = A.run('dlrm-mlperf');
  assert.strictEqual(mp.totals.params, sum(TB) * 128 + mlpP(bot) + mlpP([479, 1024, 1024, 512, 256, 1]));
  assert.strictEqual(mp.totals.params, 26137996161);
  assert.strictEqual(mp.totals.macs, mlpM(bot) + 27 * 27 * 128 + mlpM([479, 1024, 1024, 512, 256, 1]));
  const dc = A.run('dlrm-dcnv2');
  const cross = 3 * (2 * 3456 * 512 + 3456);
  assert.strictEqual(dc.totals.params, sum(TB) * 128 + mlpP(bot) + cross + mlpP([3456, 1024, 1024, 512, 256, 1]));
  assert.strictEqual(dc.totals.params, 26151671809);
  assert.strictEqual(dc.totals.macs, mlpM(bot) + 3 * 2 * 3456 * 512 + mlpM([3456, 1024, 1024, 512, 256, 1]));
  assert.deepStrictEqual([J(dc.tensors['sparse-ids'].num), J(dc.tensors.x0.num), J(dc.tensors['c-low'].num), J(dc.tensors['top-in'].num)], [[214], [3456], [512], [3456]]);
  const m = A.metrics('dlrm-dcnv2', {});
  assert.deepStrictEqual([m.lookupsPerSample, m.lookupBytesPerSample, m.interactionParams, m.gpusToHoldTables], [214, 214 * 128 * 4, cross, 2]);
  assert.strictEqual(m.B, 65536);   // lote global de MLPerf v3 (B por defecto = el de la config)
});

test('F13 Wide & Deep: parte wide (un peso por valor) + deep 845-1024-512-256-1', () => {
  const r = A.run('wide-and-deep');
  const deep = [26 * 32 + 13, 1024, 512, 256, 1];
  assert.strictEqual(r.totals.params, 33762577 * 1 + 33762577 * 32 + mlpP(deep));
  assert.strictEqual(r.totals.macs, mlpM(deep));
  assert.deepStrictEqual(['w-emb', 'wide-logit', 'e-flat', 'top-in', 'deep-logit', 'logit'].map((t) => J(r.tensors[t].num)), [[26, 1], [1], [832], [845], [1], [1]]);
  const m = A.metrics('wide-and-deep', {});
  assert.deepStrictEqual([m.wideParams, m.deepEmbeddingParams, m.lookupsPerSample], [33762577, 33762577 * 32, 52]);
});

test('F13 DLRM knobs: dim, maxRows (tope), bits (solo bytes), k; errores en español', () => {
  const base = A.run('dlrm-criteo-kaggle');
  const d32 = A.run('dlrm-criteo-kaggle', { dim: 32 });
  assert.deepStrictEqual([J(d32.tensors['bot-out'].num), J(d32.tensors['top-in'].num)], [[32], [32 + 351]]);
  const cap = A.run('dlrm-criteo-kaggle', { maxRows: 1000000 });
  assert.strictEqual(cap.config.totalRows, sum(KAGGLE.map((n) => Math.min(n, 1000000))));
  assert.ok(cap.notes.some((n) => /recortadas/.test(n)));
  const b8 = A.metrics('dlrm-criteo-kaggle', { bits: 8 });
  assert.strictEqual(A.run('dlrm-criteo-kaggle', { bits: 8 }).totals.params, base.totals.params);
  assert.deepStrictEqual([b8.embeddingBytes, b8.lookupBytesPerSample], [33762577 * 16, 26 * 16]);
  assert.strictEqual(A.metrics('dlrm-criteo-kaggle', { k: 1000 }).rankingMacsPerRequest, 1000 * base.totals.macs);
  assert.throws(() => A.run('dlrm-criteo-kaggle', { bits: 12 }), /bits/);
  // memoria (tablas, ≈ 0.25 op/B) vs MLP: la intensidad TOTAL depende del MLP
  const m = A.metrics('dlrm-criteo-kaggle', {});
  assert.strictEqual(m.embeddingIntensity, 0.25);
  assert.strictEqual(m.arithmeticIntensity, 2 * base.totals.macs / (26 * 16 * 4));
});

// ---------------------------------------------------------------- two-tower
test('F13 two-tower: parámetros a mano, tabla de ítems compartida (una vez), torres, logits por par y fuerza bruta', () => {
  const r = A.run('two-tower-base');
  const cats = (250 + 100 + 8 + 24) * 16 + (1000 + 100 + 32 + 64) * 16;
  const user = mlpP([192, 256, 128, 64]), item = mlpP([128, 256, 128, 64]);
  assert.strictEqual(r.totals.params, 10000000 * 64 + 2000000 * 64 + cats + user + item);
  assert.strictEqual(r.totals.params, 768189984);
  assert.strictEqual(r.totals.byPath['user-tower>hist-embed'].params, 0);
  assert.strictEqual(r.totals.byPath['item-tower>id-embed'].params, 2000000 * 64);
  const towers = mlpM([192, 256, 128, 64]) + mlpM([128, 256, 128, 64]);
  assert.strictEqual(r.totals.macs, towers + 64 + 4096 * 64 + 2000000 * 64);   // torres + u·v + una fila del lote + búsqueda
  assert.deepStrictEqual(['u-in', 'v-in', 'u', 'v', 'U', 'logits', 'index', 'item-scores', 'topk-ids'].map((t) => J(r.tensors[t].num)),
    [[192], [128], [64], [64], [4096, 64], [4096, 4096], [2000000, 64], [2000000], [500]]);
  assert.ok(r.tensors.logits.batched && r.ops.find((o) => o.id === 'inbatch-logits').detail.perPair);
  const m = A.metrics('two-tower-base', {});
  assert.deepStrictEqual([m.inBatchLogitsMacs, m.bruteForceMacs, m.indexBytes, m.inBatchNegatives], [4096 * 4096 * 64, 2000000 * 64, 2000000 * 64 * 4, 4095]);
  assert.strictEqual(m.lookupsPerExample, 1 + 50 + 4 + 1 + 4);
  assert.strictEqual(m.lookupBytesPerExample, (1 + 50 + 1) * 64 * 4 + 8 * 16 * 4);
  assert.ok(m.embeddingParamsShare > 0.999);
});

test('F13 two-tower knobs: hist = 0, B, dim, nItems, idBuckets, idDim; sin ids (arranque en frío)', () => {
  const h0 = A.run('two-tower-base', { hist: 0 });
  assert.ok(!h0.tensors['u-hist-emb'] && h0.tensors['u-in'].num[0] === 128);
  const b = A.run('two-tower-base', { B: 256 });
  assert.deepStrictEqual(J(b.tensors.logits.num), [256, 256]);
  const d = A.run('two-tower-base', { dim: 128 });
  assert.deepStrictEqual([J(d.tensors.u.num), J(d.tensors.index.num)], [[128], [2000000, 128]]);
  assert.strictEqual(A.run('two-tower-base', { nItems: 100000 }).totals.byPath['item-tower>id-embed'].params, 100000 * 64);
  assert.strictEqual(A.run('two-tower-base', { idBuckets: 1000000 }).totals.byPath['user-tower>id-embed'].params, 1000000 * 64);
  assert.deepStrictEqual(J(A.run('two-tower-base', { idDim: 32 }).tensors['u-in'].num), [32 + 32 + 64]);
  const no = A.run('two-tower-no-ids');
  assert.ok(!no.tensors['u-id-emb'] && !no.tensors['v-id-emb'] && !no.tensors['u-hist-emb']);
  assert.strictEqual(no.totals.params, 382 * 16 + 1196 * 16 + mlpP([64, 256, 128, 64]) * 2);
  assert.ok(A.run('two-tower-no-ids', { idBuckets: 100 }).notes.some((n) => /no usa ids/.test(n)));
  assert.throws(() => A.run('two-tower-small', { k: 1000, nItems: 500 }), /k = 1000/);
  assert.strictEqual(A.run('two-tower-small').totals.params, 1000000 * 64 + 100000 * 64 + 382 * 16 + 1196 * 16 + mlpP([192, 256, 128, 64]) + mlpP([128, 256, 128, 64]));
});

// ---------------------------------------------------------------- GBDT
test('F13 GBDT: parámetros (umbrales + hojas + base), 0 MACs, formas y costos de entrenamiento a mano', () => {
  const x = A.run('xgboost-500-d6');
  assert.deepStrictEqual([x.totals.params, x.totals.macs, x.totals.flops], [500 * 127 + 1, 0, 0]);
  assert.deepStrictEqual(['X', 'Xb', 'g', 'hist', 'tree', 'leaf-ids', 'y-hat'].map((t) => J(x.tensors[t].num)), [[1000000, 100], [1000000, 100], [1000000], [100, 257, 2], [127], [500], [1]]);
  const m = A.metrics('xgboost-500-d6', {});
  assert.deepStrictEqual([m.nodes, m.leaves, m.comparisonsPerPrediction, m.modelBytes], [63500, 32000, 3000, 34 * 63500 + 660 * 500 + 830]);
  assert.strictEqual(m.histogramAddsPerTree, 2 * 1000000 * 3.5 * 100);
  assert.strictEqual(m.splitEvalsPerTree, 63 * 100 * 257);
  assert.ok(m.histogramShareTrain > 0.9, 'el histograma domina el entrenamiento');
  assert.deepStrictEqual([m.measuredNodes, m.measuredLeaves], [61942, 31221]);   // modelo real (crosscheck, N = 50,000)
  assert.ok(m.measuredFullShare < 1 && m.measuredFullShare > 0.9);
  const lg = A.metrics('lightgbm-500-l31', {});
  assert.deepStrictEqual([A.run('lightgbm-500-l31').totals.params, lg.leavesPerTree, lg.comparisonsPerPrediction, lg.comparisonsMax, lg.comparisonsMeasured], [500 * 61, 31, 500 * 5, 500 * 30, Math.round(500 * 7.847548)]);
  const cbm = A.metrics('catboost-oblivious-d6', {});
  assert.deepStrictEqual([A.run('catboost-oblivious-d6').totals.params, cbm.paramsPerTree, cbm.comparisonsPerPrediction], [500 * 70 + 1, 70, 3000]);
  assert.strictEqual(A.run('xgboost-2000-d8').totals.params, 2000 * 511 + 1);
});

test('F13 GBDT knobs: nTrees, depth, leaves (solo leaf-wise), N, F, bins; max_depth limita las hojas de LightGBM', () => {
  assert.strictEqual(A.run('xgboost-500-d6', { nTrees: 100 }).totals.params, 100 * 127 + 1);
  assert.strictEqual(A.run('xgboost-500-d6', { depth: 3 }).totals.params, 500 * 15 + 1);
  assert.deepStrictEqual(J(A.run('xgboost-500-d6', { F: 10, bins: 64 }).tensors.hist.num), [10, 65, 2]);
  assert.ok(A.run('xgboost-500-d6', { leaves: 63 }).notes.some((n) => /leaf-wise|hojas/.test(n)));
  assert.strictEqual(A.run('lightgbm-500-l31', { leaves: 127 }).totals.params, 500 * 253);
  const capped = A.run('lightgbm-500-l31', { depth: 4 });
  assert.deepStrictEqual([capped.config.leavesPerTree, capped.totals.params], [16, 500 * 31]);
  assert.strictEqual(A.metrics('xgboost-500-d6', { N: 10000000 }).histogramAddsPerTree, 2 * 10000000 * 3.5 * 100);
  // con knobs de forma del árbol, lo medido no aplica
  assert.strictEqual(A.metrics('xgboost-500-d6', { depth: 4 }).measuredNodes, undefined);
  assert.throws(() => A.run('xgboost-500-d6', { depth: 0 }), /depth/);
});

test('F13 todas las configs: run y metrics sin NaN, units para cada métrica numérica, canónicas de SPEC §25', () => {
  assert.deepStrictEqual(['two-tower', 'dlrm', 'gbdt'].map((m) => A.canonical(m)), ['two-tower-base', 'dlrm-criteo-kaggle', 'xgboost-500-d6']);
  for (const id of TT.concat(DL, GB)) {
    const r = A.run(id), m = A.metrics(id, {});
    assert.ok(Number.isInteger(r.totals.params) && Number.isFinite(r.totals.macs), id);
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), id + ' ' + k + ' = ' + v);
    }
    // cada métrica numérica propia del modelo tiene unidad (las genéricas de ATLAS.Arch.metrics no la necesitan)
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && !GENERIC.has(k)) assert.ok(m.units[k], id + ': ' + k + ' sin unidad');
    assert.ok(r.order.length >= 9, id + ' con pocos tensores');
    assert.ok(r.config.source && r.config.label, id + ' sin fuente');
  }
});

// ---------------------------------------------------------------- revisión de la fase 13
test('F13 revisión GBDT: oblivious = d cortes + 2^d hojas; camino leaf-wise no es cota; 1 byte por celda con max_bin 256; lgb-text', () => {
  const cb = A.metrics('catboost-oblivious-d6', {});
  assert.deepStrictEqual([cb.nodesPerTree, cb.paramsPerTree, cb.internalNodes, cb.nodes, cb.measuredNodes, cb.measuredFullShare], [70, 70, 500 * 6, 500 * 70, 35000, 1]);
  assert.deepStrictEqual(J(A.run('catboost-oblivious-d6').tensors.tree.num), [70]);
  // leaf-wise: el camino balanceado (K·⌈log₂ L⌉) queda ENTRE los dos medidos (objetivo lineal arriba, no lineal abajo)
  const lg = A.metrics('lightgbm-500-l31', {});
  assert.ok(lg.comparisonsMeasuredNonlinear < lg.comparisonsPerPrediction && lg.comparisonsPerPrediction < lg.comparisonsMeasured, JSON.stringify([lg.comparisonsMeasuredNonlinear, lg.comparisonsMeasured]));
  assert.ok(lg.comparisonsMeasuredNonlinear >= 500 && lg.comparisonsMeasured <= lg.comparisonsMax);   // las cotas reales: K ≤ camino ≤ K·(L − 1)
  assert.strictEqual(A.metrics('lightgbm-500-l31', { leaves: 63 }).comparisonsMeasuredNonlinear, undefined);
  // índice de bin: XGBoost max_bin 256 → 1 byte (aunque el histograma tenga 257 entradas); CatBoost 254 bordes → 255 bins → 1 byte
  const x = A.metrics('xgboost-500-d6', {});
  assert.strictEqual(x.binnedDataBytes, 1000000 * 100);
  assert.strictEqual(A.run('xgboost-500-d6').ops.find((o) => o.id === 'binning').detail.bytes, 1000000 * 100);
  assert.strictEqual(A.metrics('catboost-oblivious-d6', {}).binnedDataBytes, 1000000 * 100);
  // lgb-text: el knob leaves mueve el tamaño ≈ 88 B por hoja
  const l63 = A.metrics('lightgbm-500-l31', { leaves: 63 }), l31 = A.metrics('lightgbm-500-l31', { leaves: 31 });
  assert.strictEqual(l63.modelBytes - l31.modelBytes, 88 * 500 * 32);
});

test('F13 revisión recsys: punto de quiebre (≤ 5 %), DCN de rango ≥ D/2, MLPerf medido vs cota de entrenamiento, lookups por request', () => {
  const dc = A.metrics('dlrm-dcnv2', {});
  assert.ok(Math.abs(dc.arithmeticIntensity / dc.ridgePoint - 1) < 0.05);
  assert.strictEqual(dc.bound, '≈ en el punto de quiebre');
  assert.deepStrictEqual(['dlrm-criteo-kaggle', 'dlrm-mlperf', 'wide-and-deep'].map((id) => A.metrics(id, {}).bound), ['cómputo', 'cómputo', 'cómputo']);
  assert.strictEqual(A.metrics('dlrm-dcnv2', { bits: 16 }).bound, 'cómputo');
  assert.strictEqual(dc.crossParamsFullRank, 3 * (3456 * 3456 + 3456));
  assert.ok(A.run('dlrm-dcnv2', { dim: 32 }).notes.some((n) => /ya no ahorra/.test(n)));
  assert.ok(!A.run('dlrm-dcnv2', { dim: 64 }).notes.some((n) => /ya no ahorra/.test(n)));
  // MLPerf: entrenamiento con su propia arquitectura, por GPU (≈ 321× en H100, ≈ 101× en A100)
  const mp = A.metrics('dlrm-mlperf', {});
  assert.strictEqual(mp.measuredTrainPerGpu, 1671168 / 8);
  assert.ok(Math.abs(mp.trainCeilingVsMeasuredH100 - 321) < 1 && Math.abs(mp.trainCeilingVsMeasuredA100 - 101.3) < 0.5, mp.trainCeilingVsMeasuredH100 + ' ' + mp.trainCeilingVsMeasuredA100);
  assert.strictEqual(A.metrics('dlrm-mlperf', { bits: 16 }).measuredTrainPerGpu, undefined);
  assert.strictEqual(A.metrics('dlrm-criteo-kaggle', {}).measuredTrainPerGpu, undefined);
  assert.match(A.recsys.measured.source, /sin tope \(91\.10 GiB/i);
  // W&D a 4 bits: bytes enteros
  assert.ok(Number.isInteger(A.metrics('wide-and-deep', { bits: 4 }).embeddingBytes));
  // two-tower: un request lee solo la torre de usuario (55 filas, 13,312 B); el par de entrenamiento, 60
  const t = A.metrics('two-tower-base', {});
  assert.deepStrictEqual([t.userLookupsPerRequest, t.userLookupBytesPerRequest, t.lookupsPerExample], [55, (1 + 50) * 64 * 4 + 4 * 16 * 4, 60]);
  assert.strictEqual(t.userTowerParamsWithShared, t.userTowerParams + 2000000 * 64);
  assert.strictEqual(A.metrics('two-tower-base', { hist: 0 }).userTowerParamsWithShared, A.metrics('two-tower-base', { hist: 0 }).userTowerParams);
  assert.ok(A.metrics('two-tower-base', { k: 1000 }).topkOps > t.topkOps);
});

test('F13 revisión: pctAuto no imprime 100.0 % para una fracción < 1', () => {
  assert.strictEqual(A.fmt.pctAuto(0.99979), '99.979 %');
  assert.strictEqual(A.fmt.pctAuto(1), '100.0 %');
  assert.strictEqual(A.fmt.pctAuto(0.5), '50.0 %');
  assert.strictEqual(A.fmt.pctAuto(0.9994), '99.9 %');
  assert.strictEqual(A.fmt.pctAuto(0.00848), '0.848 %');
  assert.deepStrictEqual([A.fmt.pct(0.99979), A.fmt.pct(1), A.fmt.pct(0.0002), A.fmt.pct(0), A.fmt.pct(0.123), A.fmt.pct(0.99979, 1)], ['99.979 %', '100.0 %', '0.020 %', '0.0 %', '12.3 %', '100.0 %']);
});
