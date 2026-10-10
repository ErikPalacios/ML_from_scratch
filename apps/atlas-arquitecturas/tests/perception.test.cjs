// Pruebas de la fase 14 (percepción: js/arch/perception.js + primitivas nuevas de primitives.js). Cuentas a mano, totales exactos de
// las referencias (crosscheck/perception.py: HF en meta, PointNet transcrito, llamadas reales del Kalman) y comportamiento de los knobs.
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
const op = (r, id) => r.ops.find((o) => o.id === id);
const BT = ['bytetrack-mot17', 'sort', 'bytetrack-ultralytics'];
const DP = ['depth-anything-v2-small', 'depth-anything-v2-base', 'depth-anything-v2-large', 'dpt-large'];
const PN = ['pointnet-cls', 'pointnet-seg', 'pointnet-cls-no-tnet', 'pointnet2-ssg-cls'];
// conv 1×1 / fc del código oficial de PointNet: pesos + sesgo + BN (β, γ).
const pc = (cin, cout, bn = true) => cin * cout + cout + (bn ? 2 * cout : 0);

// ---------------------------------------------------------------- primitivas
test('F14 Kalman: costo por track a mano (ByteTrack oficial, Ultralytics, SORT/filterpy)', () => {
  const n = 8, m = 4;
  const off = A.kalmanCost('dense-cholesky', n, m), ul = A.kalmanCost('slice-lu', n, m), so = A.kalmanCost('filterpy-joseph', 7, 4);
  // predict: x·Fᵀ (n²) + F·P·Fᵀ (2n³)
  assert.strictEqual(off.predict, 8 * 8 + 2 * 8 * 8 * 8);
  assert.strictEqual(off.predict, 1088);
  assert.strictEqual(ul.predict, 1088);
  assert.strictEqual(so.predict, 49 + 2 * 343);
  // update oficial: H·x 32 + H·P·Hᵀ (256 + 128) + P·Hᵀ 256 + Cholesky 4·15/6 = 10 + cho_solve 8 lados × 4·3 = 96 + y·Kᵀ 32 + K·S·Kᵀ (128 + 256)
  assert.strictEqual(off.update, 32 + 384 + 256 + 10 + 96 + 32 + 384);
  assert.strictEqual(off.update, 1194);
  // Ultralytics: LU 3·4·7/6 = 14 + 8 lados × 12 + 32 + 384
  assert.strictEqual(ul.update, 14 + 96 + 32 + 384);
  // filterpy (Joseph): 196 + 28 + 112 + (14 + 4·12) + 112 + 28 + 196 + 2·343 + (112 + 196)
  assert.strictEqual(so.update, 196 + 28 + 112 + 62 + 112 + 28 + 196 + 686 + 308);
  assert.strictEqual(so.update, 1728);
  assert.throws(() => A.kalmanCost('x', 8, 4), /desconocida/);
  const mean = A.shape(['T', '8'], [5, 8], 'qry', 'seq'), cov = A.shape(['T', '8', '8'], [5, 8, 8], 'qry', 'seq');
  const p = A.kalman_predict(mean, cov, { impl: 'dense-cholesky', m: 4 });
  assert.deepStrictEqual([J(p.out[0].num), J(p.out[1].num), p.macs, p.params], [[5, 8], [5, 8, 8], 5 * 1088, 0]);
  const u = A.kalman_update(mean, cov, [], { impl: 'slice-lu', m: 4, U: 3 });
  assert.deepStrictEqual([J(u.out.num), u.macs], [[3, 8], 3 * 526]);
});

test('F14 IoU, costo, asignación y separación por score: formas y "otros" (≈) sin MACs', () => {
  const t = A.shape(['T', '8'], [6, 8], 'qry', 'seq'), d = A.shape(['D', '5'], [4, 5], 'qry', 'seq');
  const iou = A.iou_matrix(t, d);
  assert.deepStrictEqual([J(iou.out.num), iou.macs, iou.other], [[6, 4], 0, 12 * 24 + 7 * 6 + 3 * 10]);
  assert.strictEqual(A.assoc_cost(iou.out, { fuse: true }).other, 24 * 4);
  assert.strictEqual(A.assoc_cost(iou.out, {}).other, 24);
  const la = A.linear_assignment(iou.out, { n: 10, matches: 4 });
  assert.deepStrictEqual([J(la.out.num), la.other, la.macs], [[4, 2], 1000, 0]);
  const sp = A.split_score(A.shape(['n', '5'], [10, 5], 'qry', 'seq'), { nHigh: 7, nLow: 3, keepLow: true });
  assert.deepStrictEqual(J(sp.out.map((x) => x.num)), [[7, 5], [3, 5]]);
});

test('F14 primitivas de DPT: readout, resample, rcu, layer_taps', () => {
  const x = A.shape(['N+1', 'D'], [577, 1024], 'img', 'seq');
  const ig = A.readout(x, { mode: 'ignore' }), pr = A.readout(x, { mode: 'project' }), ad = A.readout(x, { mode: 'add' });
  assert.deepStrictEqual([J(ig.out.num), ig.params, ig.macs], [[576, 1024], 0, 0]);
  assert.deepStrictEqual([pr.params, pr.macs], [2048 * 1024 + 1024, 576 * 2048 * 1024]);
  assert.strictEqual(ad.other, 576 * 1024);
  const g = A.shape(['h', 'w', 'C'], [37, 37, 48], 'img', 'grid');
  const up4 = A.resample(g, { factor: 4 }), id = A.resample(g, { factor: 1 }), dn = A.resample(A.shape(['h', 'w', 'C'], [37, 37, 384], 'img', 'grid'), { factor: 0.5 });
  assert.deepStrictEqual([J(up4.out.num), up4.params, up4.macs, up4.prim, up4.detail.kind], [[148, 148, 48], 16 * 48 * 48 + 48, 37 * 37 * 16 * 48 * 48, 'resample', 'conv-transpose']);
  assert.deepStrictEqual([J(id.out.num), id.params, id.macs], [[37, 37, 48], 0, 0]);
  assert.deepStrictEqual([J(dn.out.num), dn.params, dn.macs], [[19, 19, 384], 9 * 384 * 384 + 384, 19 * 19 * 384 * 9 * 384]);
  const rc = A.rcu(A.shape(['h', 'w', 'F'], [37, 37, 64], 'img', 'grid'));
  assert.deepStrictEqual([rc.params, rc.macs], [2 * (9 * 64 * 64 + 64), 2 * 37 * 37 * 9 * 64 * 64]);
  const tp = A.layer_taps(x, { layers: [3, 6, 9, 12] });
  assert.strictEqual(tp.out.length, 4);
});

test('F14 primitivas de PointNet: MLP compartido, max-pool simétrico, T-Net, FPS / ball query', () => {
  const pts = A.shape(['N', '3'], [1024, 3], 'lat', 'seq');
  const m = A.point_mlp(pts, { cout: 64 });
  assert.deepStrictEqual([J(m.out.num), m.params, m.macs], [[1024, 64], pc(3, 64), 1024 * 3 * 64]);
  const nb = A.point_mlp(pts, { cout: 40, bn: false, relu: false });
  assert.strictEqual(nb.params, 3 * 40 + 40);
  const mp = A.max_pool_points(A.shape(['N', '1024'], [1024, 1024], 'lat', 'seq'));
  assert.deepStrictEqual([J(mp.out.num), mp.other, mp.detail.criticalMax], [[1024], 1023 * 1024, 1024]);
  const grp = A.max_pool_points(A.shape(['S', 'k', 'C'], [512, 32, 128], 'lat', 'seq'));
  assert.deepStrictEqual([J(grp.out.num), grp.other], [[512, 128], 512 * 31 * 128]);
  const tn = A.tnet_transform(A.shape(['256'], [256], 'lat', 'vec'), { K: 64 });
  assert.deepStrictEqual([J(tn.out.num), tn.params, tn.macs], [[64, 64], 256 * 4096 + 4096, 256 * 4096]);
  assert.strictEqual(A.point_transform(A.shape(['N', '64'], [1024, 64], 'lat', 'seq'), tn.out).macs, 1024 * 64 * 64);
  assert.strictEqual(A.fps_sample(pts, { S: 512 }).other, 10 * 512 * 1024);
  const ctr = A.shape(['S', '3'], [512, 3], 'lat', 'seq');
  assert.deepStrictEqual(J(A.ball_query(pts, ctr, { k: 32, r: 0.2 }).out.num), [512, 32]);
  const cg = A.concat_global(A.shape(['N', '64'], [10, 64], 'lat', 'seq'), A.shape(['1024'], [1024], 'lat', 'vec'));
  assert.deepStrictEqual(J(cg.out.num), [10, 1088]);
  const pp = A.concat_global(A.shape(['S', '3'], [128, 3], 'lat', 'seq'), A.shape(['S', '256'], [128, 256], 'lat', 'seq'));
  assert.deepStrictEqual(J(pp.out.num), [128, 259]);
});

test('F14 cada primitiva nueva tiene su ficha en primitives() (ref-formas)', () => {
  const ids = new Set(A.primitives().map((p) => p.id));
  for (const p of ['kalman_predict', 'kalman_update', 'iou_matrix', 'assoc_cost', 'linear_assignment', 'split_score', 'track_manage', 'layer_taps', 'readout', 'resample',
    'rcu', 'point_mlp', 'max_pool_points', 'point_transform', 'tnet_transform', 'concat_global', 'fps_sample', 'ball_query', 'group_points']) assert.ok(ids.has(p), p);
});

// ---------------------------------------------------------------- tracking
test('F14 bytetrack-mot17: detector YOLOX-X, tracker sin parámetros, Kalman exacto y asociaciones', () => {
  const r = A.run('bytetrack-mot17'), m = A.metrics('bytetrack-mot17');
  assert.strictEqual(A.canonical('bytetrack'), 'bytetrack-mot17');
  assert.strictEqual(r.totals.params, 98995378);
  assert.strictEqual(r.totals.byNode.tracker.params, 0);
  assert.strictEqual(r.totals.byNode.detector.macs, 395135280000);
  // 50 tracks predichos, 40 + 10 corregidos
  assert.strictEqual(r.totals.byNode.tracker.macs, 50 * 1088 + 50 * 1194);
  assert.deepStrictEqual(['frame', 'dets', 'dets-high', 'dets-low', 'pred-mean', 'pred-cov', 'iou-1', 'matches-1', 'iou-2', 'matches-2', 'track-mean-new'].map((id) => r.tensors[id].num.join('×')),
    ['800×1440×3', '50×5', '40×5', '10×5', '50×8', '50×8×8', '50×40', '40×2', '10×10', '10×2', '50×8']);
  assert.deepStrictEqual([m.assignN1, m.assignN2, m.assignOps], [90, 20, 90 ** 3 + 20 ** 3]);
  assert.deepStrictEqual([m.trackHigh, m.trackLow, m.newTrackThresh, m.matchThresh, m.matchThresh2, m.trackBuffer, m.framesLost, m.secondsLost], [0.6, 0.1, 0.7, 0.9, 0.5, 30, 30, 1]);
  assert.ok(m.trackerShare < 1e-5, 'el tracker es ≪ 1 % del detector');
  assert.strictEqual(m.kalmanBytesPerTrack, (8 + 64) * 8);
  assert.strictEqual(m.iouPairs, 50 * 40 + 10 * 10);
  // track_buffer oficial escala con los fps (int(fps/30·30)); Ultralytics no.
  assert.strictEqual(A.metrics('bytetrack-mot17', { fps: 14 }).framesLost, 14);
  assert.strictEqual(A.metrics('bytetrack-ultralytics', { fps: 14 }).framesLost, 30);
  assert.strictEqual(A.metrics('bytetrack-ultralytics', { fps: 14 }).secondsLost, 30 / 14);
});

test('F14 sort y bytetrack-ultralytics: sin segunda pasada en SORT; detector YOLOv8-L del calculador', () => {
  const s = A.run('sort'), u = A.run('bytetrack-ultralytics');
  assert.ok(!op(s, 'iou-2') && !s.tensors['dets-low'], 'SORT descarta las detecciones bajas');
  assert.strictEqual(s.totals.byNode.tracker.macs, 50 * 735 + 40 * 1728);
  assert.strictEqual(A.metrics('sort').assignN1, 50);
  assert.strictEqual(A.metrics('sort').framesLost, 1);
  const y8 = A.run('yolov8l-640').totals;
  assert.deepStrictEqual([u.totals.params, u.totals.byNode.detector.macs], [y8.params, y8.macs]);
  assert.strictEqual(u.totals.byNode.tracker.macs, 50 * 1088 + 50 * 526);
  // lowPct = 0 → sin detecciones bajas: no hay segunda asociación y la nota lo dice
  const z = A.run('bytetrack-mot17', { lowPct: 0 });
  assert.ok(!op(z, 'iou-2'));
  assert.ok(z.notes.some((n) => /sin segunda asociación/.test(n)));
  assert.throws(() => A.run('bytetrack-mot17', { lowPct: 101 }), /0 a 100/);
  // escala: más detecciones → la asignación O(n³) crece más rápido que el Kalman, y todo sigue ≪ 1 % del detector
  const sc = A.metrics('bytetrack-mot17').nDetScaling;
  assert.ok(sc.every((x, i) => !i || x.assignOps > sc[i - 1].assignOps));
  assert.ok(sc[sc.length - 1].trackerShare < 0.01);
});

// ---------------------------------------------------------------- profundidad
test('F14 Depth Anything V2 / DPT: parámetros = HF, reparto encoder vs cabeza, escalas y formas', () => {
  const exp = { 'depth-anything-v2-small': 24785089, 'depth-anything-v2-base': 97470785, 'depth-anything-v2-large': 335315649, 'dpt-large': 343030465 };
  for (const id of DP) assert.strictEqual(A.run(id).totals.params, exp[id], id);
  const r = A.run('depth-anything-v2-small'), m = A.metrics('depth-anything-v2-small');
  assert.strictEqual(A.canonical('depth'), 'depth-anything-v2-small');
  // encoder = backbone de HF (DINOv2-S: 22,056,576), cabeza = neck + head (2,700,768 + 27,745)
  assert.deepStrictEqual([m.encoderParams, m.decoderParams], [22056576, 2700768 + 27745]);
  assert.strictEqual(op(r, 'patch-embed').params, 14 * 14 * 3 * 384 + 384);
  assert.deepStrictEqual(['x-patch-grid', 'tap-1', 'rs-1', 'rs-2', 'rs-3', 'rs-4', 'feat-4', 'fused-4', 'fused-1', 'hd-c1', 'hd-up', 'depth'].map((id) => r.tensors[id].num.join('×')),
    ['37×37×384', '1370×384', '148×148×48', '74×74×96', '37×37×192', '19×19×384', '19×19×64', '37×37×64', '296×296×64', '296×296×32', '518×518×32', '518×518']);
  assert.deepStrictEqual(J(m.scales.map((s) => s.size)), [148, 74, 37, 19]);
  assert.deepStrictEqual(J(m.taps), [3, 6, 9, 12]);
  // DPT-Large (P = 16): las 4 escalas son 1/4, 1/8, 1/16, 1/32
  assert.deepStrictEqual(J(A.metrics('dpt-large').scales.map((s) => s.stride)), [4, 8, 16, 32]);
  assert.deepStrictEqual(J(A.metrics('depth-anything-v2-large').taps), [5, 12, 18, 24]);
  // la cabeza no es chica: ≈ 19 % de los MACs de DA-S a 518
  assert.ok(m.decoderMacsShare > 0.15 && m.decoderMacsShare < 0.25, m.decoderMacsShare);
  assert.strictEqual(m.decoderMacs + m.encoderMacs, r.totals.macs);
  // idle: mask token (D) y la RCU 1 de la primera fusión
  assert.strictEqual(op(r, 'idle-mask-token').params, 384);
  assert.strictEqual(op(r, 'fuse-4-idle').params, 2 * (9 * 64 * 64 + 64));
  // la LayerNorm de los taps se cuenta una vez
  assert.strictEqual(r.totals.byNode.taps.params, 2 * 384);
});

test('F14 depth: knob res (tabla de posición fija, interpolada), errores y cotas ≈ de hardware', () => {
  const a = A.run('depth-anything-v2-small'), b = A.run('depth-anything-v2-small', { res: 364 });
  assert.strictEqual(b.totals.params, a.totals.params);
  assert.ok(b.notes.some((n) => /interpolados/.test(n)));
  assert.strictEqual(b.tensors.depth.num.join('×'), '364×364');
  assert.strictEqual(b.tensors['rs-4'].num.join('×'), '13×13×384');
  assert.throws(() => A.run('depth-anything-v2-small', { res: 500 }), /múltiplo/);
  assert.throws(() => A.run('dpt-large', { res: 400 }), /par/);
  const m = A.metrics('depth-anything-v2-small');
  assert.ok(m.msOrin > m.msH100 && m.fpsOrin < m.fpsH100);
  assert.ok(m.resScaling.length >= 4 && m.resScaling.every((x, i, s) => !i || x.macs > s[i - 1].macs));
});

// ---------------------------------------------------------------- PointNet
test('F14 PointNet: parámetros del código oficial (BN incluida) y reparto de las T-Nets', () => {
  const tin = pc(3, 64) + pc(64, 128) + pc(128, 1024) + pc(1024, 512) + pc(512, 256) + (256 * 9 + 9);
  const tf = pc(64, 64) + pc(64, 128) + pc(128, 1024) + pc(1024, 512) + pc(512, 256) + (256 * 4096 + 4096);
  const trunk = pc(3, 64) + pc(64, 64) + pc(64, 64) + pc(64, 128) + pc(128, 1024);
  const head = pc(1024, 512) + pc(512, 256) + pc(256, 40, false);
  const r = A.run('pointnet-cls'), m = A.metrics('pointnet-cls');
  assert.strictEqual(A.canonical('pointnet'), 'pointnet-cls');
  assert.deepStrictEqual([tin, tf], [803081, 1857344]);
  assert.strictEqual(r.totals.params, tin + tf + trunk + head);
  assert.strictEqual(r.totals.params, 3480049);
  assert.deepStrictEqual([m.inputTnetParams, m.featureTnetParams], [tin, tf]);
  assert.ok(m.tnetParamsShare > 0.76 && m.tnetParamsShare < 0.77);
  assert.strictEqual(A.run('pointnet-cls-no-tnet').totals.params, trunk + head);
  assert.strictEqual(A.run('pointnet-cls', { tnet: 0 }).totals.params, trunk + head);
  const seg = pc(3, 64) + pc(64, 64) + pc(64, 64) + pc(64, 128) + pc(128, 1024) + pc(1088, 512) + pc(512, 256) + pc(256, 128) + pc(128, 128) + pc(128, 50, false);
  assert.strictEqual(A.run('pointnet-seg').totals.params, tin + tf + seg);
  assert.strictEqual(A.run('pointnet-seg').tensors.concat.num.join('×'), '2048×1088');
});

test('F14 PointNet: MACs por punto vs max-pool, puntos críticos, knob N', () => {
  const r = A.run('pointnet-cls-no-tnet'), m = A.metrics('pointnet-cls-no-tnet');
  const perPoint = 3 * 64 + 64 * 64 + 64 * 64 + 64 * 128 + 128 * 1024;
  assert.strictEqual(m.macsPerPoint, perPoint);
  assert.strictEqual(m.perPointMacs, 1024 * perPoint);
  assert.strictEqual(m.globalMacs, 1024 * 512 + 512 * 256 + 256 * 40);
  assert.strictEqual(m.maxpoolOps, 1023 * 1024);
  assert.ok(m.maxpoolShare < 0.01);
  assert.strictEqual(m.criticalPointsMax, 1024);
  assert.strictEqual(A.metrics('pointnet-cls', { N: 512 }).criticalPointsMax, 512);
  assert.strictEqual(A.run('pointnet-cls', { N: 2048 }).tensors.h5.num.join('×'), '2048×1024');
  assert.strictEqual(A.metrics('pointnet-cls').orthoRegMacs, 64 ** 3);
  assert.ok(m.nScaling.every((x, i, s) => !i || x.macs > s[i - 1].macs));
});

test('F14 PointNet++ SSG: parámetros, formas de las SA y costo ≈ de FPS / ball query', () => {
  const r = A.run('pointnet2-ssg-cls'), m = A.metrics('pointnet2-ssg-cls');
  const sa1 = pc(3, 64) + pc(64, 64) + pc(64, 128), sa2 = pc(131, 128) + pc(128, 128) + pc(128, 256), sa3 = pc(259, 256) + pc(256, 512) + pc(512, 1024);
  const head = pc(1024, 512) + pc(512, 256) + pc(256, 40, false);
  assert.strictEqual(r.totals.params, sa1 + sa2 + sa3 + head);
  assert.strictEqual(r.totals.params, 1475688);
  assert.deepStrictEqual(['sa1-xyz', 'sa1-grouped', 'sa1-out', 'sa2-grouped', 'sa2-out', 'sa3-grouped', 'global'].map((id) => r.tensors[id].num.join('×')),
    ['512×3', '512×32×3', '512×128', '128×64×131', '128×256', '128×259', '1024']);
  assert.strictEqual(m.fpsOps, 10 * (512 * 1024 + 128 * 512));
  assert.strictEqual(m.ballQueryOps, 9 * (512 * 1024 + 128 * 512));
  assert.throws(() => A.run('pointnet2-ssg-cls', { tnet: 1 }), /solo aplica/);
  assert.throws(() => A.run('pointnet2-ssg-cls', { N: 256 }), /centros/);
});

// ---------------------------------------------------------------- integración
test('F14 run / metrics de todas las configs nuevas, cantidades en prosa y crosscheck JSON presente', () => {
  for (const id of BT.concat(DP, PN)) {
    const r = A.run(id), m = A.metrics(id);
    assert.ok(r.totals.params > 0 && r.totals.macs > 0, id);
    assert.ok(m.units && typeof m.units === 'object', id);
    assert.ok(fs.existsSync(path.join(ROOT, 'crosscheck', 'expected', id + '.json')), id);
    // byNode suma lo mismo que el total en los nodos raíz
    const roots = new Set(r.ops.map((o) => o.path[0]));
    assert.strictEqual(sum([...roots].map((k) => r.totals.byNode[k].macs)), r.totals.macs, id);
  }
  const Q = ATLAS.Quantities;
  assert.ok(Q.get('bytetrack-mot17.metrics.trackerShare').text.endsWith('%'));
  assert.strictEqual(Q.get('pointnet-cls.params.total').text, '3,480,049');
  assert.strictEqual(Q.get('bytetrack-mot17.metrics.matchThresh').text, '0.9');
  assert.ok(Q.get('depth-anything-v2-small.metrics.decoderMacs').text.includes('MACs'));
});
