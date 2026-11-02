// Pruebas de la fase 15 (aprendizaje de políticas: js/arch/robotlearn.js + primitivas nuevas de primitives.js). Cuentas a mano,
// totales exactos de las referencias (crosscheck/robotlearn.py: CleanRL / rsl_rl / ACT / Diffusion Policy transcritos, torchvision
// ResNet-18, iteraciones reales de PPO bajo FlopCounterMode) y comportamiento de los knobs.
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
const shape = (r, id) => r.tensors[id].num.join('×');
const RL = ['ppo-mujoco', 'ppo-atari', 'ppo-anymal-isaac'];
const IM = ['act-aloha', 'act-aloha-train', 'diffusion-policy-cnn', 'diffusion-policy-transformer', 'bc-mlp'];
const lin = (i, o) => i * o + o;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---------------------------------------------------------------- primitivas
test('F15 cada primitiva nueva tiene su ficha en primitives() (ref-formas)', () => {
  const ids = new Set(A.primitives().map((p) => p.id));
  for (const p of ['elu', 'mish', 'policy_std', 'gaussian_sample', 'categorical_sample', 'env_step', 'rollout_store', 'td_error', 'gae_scan', 'minibatch_select',
    'policy_entropy', 'loss_sum', 'conv_transpose1d', 'film', 'spatial_softmax', 'reparameterize', 'kl_gaussian', 'l1_loss', 'temporal_ensemble', 'execute_actions']) assert.ok(ids.has(p), p);
});

test('F15 primitivas: ConvTranspose1d (k4 s2 p1 duplica T), FiLM, spatial softmax, desviación de la política', () => {
  const x = A.shape(['4', '1024'], [4, 1024], 'act', 'seq');
  const up = A.conv_transpose1d(x, { k: 4, s: 2, p: 1, cout: 512 });
  assert.deepStrictEqual(J(up.out.num), [8, 512]);
  assert.strictEqual(up.params, 4 * 1024 * 512 + 512);
  // convención de FlopCounterMode: cada posición de ENTRADA reparte C_in·C_out MACs en k salidas
  assert.strictEqual(up.macs, 4 * 4 * 1024 * 512);
  const h = A.shape(['16', '256'], [16, 256], 'act', 'seq');
  assert.strictEqual(A.film(h, A.shape(['512'], [512], 'lat', 'vec')).other, 2 * 16 * 256);
  assert.throws(() => A.film(h, A.shape(['256'], [256], 'lat', 'vec')), /2·256/);
  const ss = A.spatial_softmax(A.shape(['7', '9', '32'], [7, 9, 32], 'img', 'grid'));
  assert.deepStrictEqual(J(ss.out.num), [32, 2]);
  assert.strictEqual(ss.params, 0);
  assert.strictEqual(A.policy_std({ d: 6 }).params, 6);
  assert.strictEqual(A.policy_std({ d: 12, param: 'std' }).params, 12);
  assert.strictEqual(A.temporal_ensemble(A.shape(['k', '14'], [100, 14], 'act', 'seq')).out.num[0], 14);
  assert.throws(() => A.execute_actions(A.shape(['16', '2'], [16, 2], 'act', 'seq'), { start: 1, count: 16 }), /no caben/);
});

// ---------------------------------------------------------------- rl-ppo
test('F15 ppo-mujoco: MLP 64-64 tanh separados (PPO Tabla 3 / CleanRL), parámetros y MACs a mano', () => {
  const r = A.run('ppo-mujoco'), m = A.metrics('ppo-mujoco');
  assert.strictEqual(A.canonical('rl-ppo'), 'ppo-mujoco');
  const actor = lin(17, 64) + lin(64, 64) + lin(64, 6) + 6;   // + log σ
  const critic = lin(17, 64) + lin(64, 64) + lin(64, 1);
  assert.deepStrictEqual([m.actorParams, m.criticParams, r.totals.params], [actor, critic, actor + critic]);
  assert.deepStrictEqual([actor, critic, r.totals.params], [5708, 5377, 11085]);
  assert.strictEqual(m.actorMacs, 17 * 64 + 64 * 64 + 64 * 6);
  assert.strictEqual(m.stepMacs, r.totals.macs);
  assert.strictEqual(r.totals.macs, 10816);
  // hiperparámetros: T 2048, 10 épocas, minibatch 64 (32 minibatches), γ 0.99, λ 0.95, ε 0.2, Adam 3e-4
  assert.deepStrictEqual([m.horizon, m.nEnvs, m.epochs, m.minibatches, m.minibatchSize, m.gamma, m.lambda, m.clipEps, m.lr, m.entCoef],
    [2048, 1, 10, 32, 64, 0.99, 0.95, 0.2, 3e-4, 0]);
  assert.deepStrictEqual([m.samplesPerUpdate, m.gradStepsPerUpdate, m.sampleReuse], [2048, 320, 10]);
  // 1 M pasos de CleanRL: 1e6 // 2048 = 488 iteraciones
  assert.deepStrictEqual([m.iterations, m.budgetSteps], [488, 488 * 2048]);
  assert.deepStrictEqual([m.obsDim, m.actDim, m.controlHz], [17, 6, 20]);
});

test('F15 PPO: costo de una iteración (exacto contra FlopCounterMode sobre una iteración real de CleanRL / rsl_rl)', () => {
  for (const id of RL) {
    const m = A.metrics(id);
    const exp = JSON.parse(fs.readFileSync(path.join(ROOT, 'crosscheck', 'expected', id + '.json'), 'utf8'));
    for (const k of ['rolloutMacs', 'updateMacs', 'trainMacsPerSample', 'rolloutBufferBytes']) assert.strictEqual(m[k], exp.metrics_checks[k], id + ' ' + k);
    // forward + backward = 3·forward − la 1.ª capa (no hay gradiente de la observación): un poco menos de 3×
    assert.strictEqual(m.trainMacsPerSample, 3 * m.stepMacs - m.firstLayerMacs, id);
    assert.ok(m.trainToForward < 3 && m.trainToForward > 2.5, id);
    assert.strictEqual(m.updateMacs, m.epochs * m.samplesPerUpdate * m.trainMacsPerSample, id);
    assert.strictEqual(m.iterationMacs, m.rolloutMacs + m.updateMacs, id);
    const f = A.robotlearn.ppoUpdateCost({ stepMacs: m.stepMacs, firstMacs: m.firstLayerMacs, bootMacs: m.criticMacs + m.trunkMacs, nEnvs: m.nEnvs, horizon: m.horizon, epochs: m.epochs });
    assert.deepStrictEqual([f.rolloutMacs, f.updateMacs, f.iterationMacs], [m.rolloutMacs, m.updateMacs, m.iterationMacs], id);
  }
});

test('F15 ppo-atari: Nature-CNN compartida (CleanRL), hiperparámetros de la Tabla 5 y buffer dominado por las observaciones', () => {
  const r = A.run('ppo-atari'), m = A.metrics('ppo-atari');
  const trunk = (8 * 8 * 4 * 32 + 32) + (4 * 4 * 32 * 64 + 64) + (3 * 3 * 64 * 64 + 64) + lin(3136, 512);
  assert.deepStrictEqual([m.trunkParams, m.actorParams, m.criticParams], [trunk, lin(512, 4), lin(512, 1)]);
  assert.strictEqual(r.totals.params, 1686693);
  assert.deepStrictEqual(['t-c1', 't-c2', 't-c3', 't-flat', 'features'].map((t) => shape(r, t)), ['20×20×32', '9×9×64', '7×7×64', '3136', '512']);
  assert.deepStrictEqual([m.nEnvs, m.horizon, m.epochs, m.minibatchSize, m.clipEps, m.entCoef, m.vfCoef, m.epochsCleanRL], [8, 128, 3, 256, 0.1, 0.01, 1, 4]);
  assert.strictEqual(m.iterations, Math.floor(10e6 / 1024));
  // obs float32 4×84×84 + 7 escalares por muestra (acción discreta = 1)
  assert.strictEqual(m.rolloutBufferBytes, 1024 * (84 * 84 * 4 + 7) * 4);
  assert.strictEqual(r.config.hidden, 512);
});

test('F15 ppo-anymal-isaac: legged_gym + rsl_rl v1.0.2 (235 → 512-256-128 ELU → 12, σ directa, 4096 × 24)', () => {
  const m = A.metrics('ppo-anymal-isaac');
  const mlp = (o) => lin(235, 512) + lin(512, 256) + lin(256, 128) + lin(128, o);
  assert.deepStrictEqual([m.actorParams, m.criticParams], [mlp(12) + 12, mlp(1)]);
  assert.deepStrictEqual([m.samplesPerUpdate, m.minibatchSize, m.gradStepsPerUpdate, m.iterations], [98304, 24576, 20, 1500]);
  assert.deepStrictEqual([m.controlHz, m.desiredKl, m.paperMinutes, m.paperUpdates], [50, 0.01, 20, 1500]);
  assert.strictEqual(m.stepsPerSecondCited, 98304 * 1500 / 1200);
  // rsl_rl RolloutStorage: obs, rewards, actions, dones (byte), log π, values, returns, advantages, mu, sigma
  assert.strictEqual(m.bufferBytesPerSample, 235 * 4 + 4 + 12 * 4 + 1 + 4 * 4 + 2 * 12 * 4);
  assert.ok(m.updateShare > 0.9);
});

test('F15 rl-ppo: ids del grafo (vista ppo-overview, gae y clip) y normalización de ventajas por implementación', () => {
  const r = A.run('ppo-mujoco');
  for (const t of ['obs', 'act-mean', 'act-std', 'action', 'logp', 'value', 'reward', 'rollout', 'rewards', 'values', 'dones', 'last-value', 'deltas', 'advantages', 'returns',
    'mb-obs', 'mb-action', 'mb-logp-old', 'mb-adv-raw', 'mb-adv', 'mb-ret', 'mb-logp', 'mb-ratio', 'mb-ratio-clip', 'surr1', 'surr2', 'surr-min', 'loss-clip', 'loss-value', 'loss-entropy', 'loss'])
    assert.ok(r.tensors[t], 'falta el tensor ' + t);
  assert.deepStrictEqual(['rollout', 'deltas', 'advantages', 'last-value', 'mb-obs', 'mb-action', 'mb-ratio', 'loss'].map((t) => shape(r, t)), ['2048×1', '2048×1', '2048×1', '1', '64×17', '64×6', '64', '1']);
  for (const n of ['actor', 'critic', 'sample', 'env-step', 'buffer', 'gae', 'update', 'minibatch', 'clip-loss', 'value-loss', 'entropy', 'total-loss']) assert.ok(r.totals.byNode[n], 'falta el nodo ' + n);
  assert.deepStrictEqual(J(r.ops.filter((o) => o.path[0] === 'gae').map((o) => o.path[1])), ['unpack', 'bootstrap', 'td-error', 'gae-scan', 'returns']);
  assert.deepStrictEqual(J(r.ops.filter((o) => o.path[1] === 'clip-loss').map((o) => o.path[2])), ['new-logp', 'ratio', 'clip', 'surr', 'surr-min', 'clip-mean']);
  // el ciclo de PPO no tiene parámetros ni MACs en el grafo de un paso (su costo está en metrics)
  for (const n of ['buffer', 'gae', 'update']) assert.deepStrictEqual([r.totals.byNode[n].params, r.totals.byNode[n].macs], [0, 0], n);
  assert.strictEqual(r.totals.byNode.actor.params + r.totals.byNode.critic.params, r.totals.params);
  // CleanRL normaliza por minibatch; rsl_rl sobre todo el lote (rollout_storage.py compute_returns)
  assert.deepStrictEqual(J(op(r, 'adv-norm').path), ['update', 'minibatch', 'adv-norm']);
  const ra = A.run('ppo-anymal-isaac');
  assert.deepStrictEqual(J(op(ra, 'adv-norm').path), ['gae', 'adv-norm']);
  assert.ok(ra.tensors['adv-raw'] && !ra.tensors['mb-adv-raw']);
  assert.strictEqual(shape(A.run('ppo-atari'), 'mb-action'), '256');
});

test('F15 knobs de rl-ppo: nEnvs, horizon, epochs, minibatches y hidden', () => {
  const m = A.metrics('ppo-anymal-isaac', { nEnvs: 512 });
  assert.deepStrictEqual([m.samplesPerUpdate, m.minibatchSize], [512 * 24, 512 * 24 / 4]);
  const h = A.run('ppo-anymal-isaac', { hidden: 256 }).config;
  assert.deepStrictEqual(J(h.actorHidden), [256, 128, 64]);
  assert.strictEqual(h.hidden, 256);
  assert.strictEqual(A.metrics('ppo-mujoco', { hidden: 128 }).actorParams, lin(17, 128) + lin(128, 128) + lin(128, 6) + 6);
  assert.strictEqual(A.metrics('ppo-mujoco', { epochs: 3 }).gradStepsPerUpdate, 3 * 32);
  assert.throws(() => A.run('ppo-mujoco', { nEnvs: 1, horizon: 24, minibatches: 32 }), /minibatches/);
  assert.throws(() => A.run('ppo-anymal-isaac', { hidden: 33 }), /enteros/);
  // la memoria del buffer escala con N·T
  const b1 = A.metrics('ppo-anymal-isaac').rolloutBufferBytes, b2 = A.metrics('ppo-anymal-isaac', { nEnvs: 512 }).rolloutBufferBytes;
  assert.strictEqual(b1 / b2, 8);
  const ns = A.metrics('ppo-mujoco').nEnvsScaling;
  assert.ok(ns.length >= 4 && ns.every((x) => x.samplesPerUpdate === x.nEnvs * 2048));
});

test('F15 GAE y pérdidas: funciones contra la recursión a mano, λ = 0 (TD) y λ = 1 (Monte Carlo)', () => {
  const R = A.robotlearn;
  const rew = [[1], [0], [2]], val = [[0.5], [0.2], [0.1]], dn = [[0], [0], [0]];
  const g = R.gae(rew, val, dn, [0.3], [0], 0.9, 0.8);
  const d2 = 2 + 0.9 * 0.3 - 0.1, d1 = 0 + 0.9 * 0.1 - 0.2, d0 = 1 + 0.9 * 0.2 - 0.5;
  const a2 = d2, a1 = d1 + 0.72 * a2, a0 = d0 + 0.72 * a1;
  assert.ok([a0, a1, a2].every((x, t) => near(g.advantages[t][0], x)));
  assert.ok(near(g.returns[0][0], a0 + 0.5));
  // λ = 0: δ_t; λ = 1 (γ = 1): suma de recompensas + bootstrap − V
  assert.ok(near(R.gae(rew, val, dn, [0.3], [0], 0.9, 0).advantages[1][0], d1));
  assert.ok(near(R.gae(rew, val, dn, [0.3], [0], 1, 1).advantages[0][0], 1 + 0 + 2 + 0.3 - 0.5));
  // un done corta el bootstrap: dones[t + 1] = 1 → Â_t = r_t − V_t
  assert.ok(near(R.gae(rew, val, [[0], [0], [1]], [0.3], [0], 0.9, 0.8).advantages[1][0], 0 - 0.2));
  // clip: A > 0 con r > 1 + ε → término recortado, gradiente 0; A < 0 con r > 1 + ε → sin recortar
  const c = R.clipObjective([1.3, 1.3, 0.9], [0.8, -0.8, 1], 0.2);
  assert.ok(near(c.perSample[0], -0.8 * 1.2) && near(c.perSample[1], 0.8 * 1.3) && near(c.perSample[2], -0.9));
  assert.ok(near(c.clipFrac, 2 / 3) && near(c.zeroGradFrac, 1 / 3));
  assert.ok(near(R.valueLoss([1.5], [1], [2], 0.2, true), 0.5 * Math.max(0.25, 0.64)));
  const z = R.normalizeAdv([1, 2, 3]);
  assert.ok(near(sum(z), 0) && near(z[2], 1 / (1 + 1e-8)));
});

// ---------------------------------------------------------------- imitation
test('F15 act-aloha: ACT como se publicó (4 cámaras 480×640, 1202 tokens, 4 + 7 capas, D 512, FFN 3200, chunk 100)', () => {
  const r = A.run('act-aloha'), m = A.metrics('act-aloha');
  assert.strictEqual(A.canonical('imitation'), 'act-aloha');
  assert.deepStrictEqual(['img', 'c5', 'feat', 'img-tokens', 'src', 'memory', 'query-pos', 'd-out', 'hs', 'actions', 'action', 'z'].map((t) => shape(r, t)),
    ['480×640×3', '15×20×512', '15×20×512', '1200×512', '1202×512', '1202×512', '100×512', '100×512', '100×512', '100×14', '14', '32']);
  assert.strictEqual(r.totals.params, 83923087);
  assert.strictEqual(r.totals.macs, 80182834176);
  // un solo backbone para las 4 cámaras (self.backbones[0]): pesos una vez, MACs × 4
  const bb = op(r, 'bb-stem-conv');
  assert.deepStrictEqual([bb.repeat, bb.paramRepeat], [4, 1]);
  // ResNet-18 sin fc con FrozenBatchNorm (γ, β = buffers): 11,176,512 − 9,600 de BN; + input_proj 512 → 512
  assert.strictEqual(r.totals.byNode.backbone.params, 11176512 - 9600);
  assert.strictEqual(r.totals.byNode['input-proj'].params, lin(512, 512));
  // el decoder corre 7 capas pero las cabezas leen la salida de la 1.ª (hs[0])
  assert.deepStrictEqual([m.decoderLayers, m.decoderLayersUsed], [7, 1]);
  assert.ok(near(m.deadDecoderMacs, m.decoderMacs * 6 / 7, 1e-12));
  assert.deepStrictEqual([m.chunk, m.executed, m.actionsPerInference, m.controlHz, m.inferenceHz, m.inferenceHzTE, m.inferenceHzNoTE], [100, 1, 100, 50, 50, 50, 0.5]);
  assert.deepStrictEqual([m.latentDim, m.klWeight, m.tokens, m.paperParamsM, m.paperLatencyMs], [32, 10, 1202, 80, 10]);
  assert.strictEqual(m.cvaeParams, r.totals.byNode.cvae.params);
  assert.strictEqual(m.visionParams + m.policyParams + m.cvaeParams + m.headParams, m.totalParams);
  assert.strictEqual(m.visionMacs + m.policyMacs + r.totals.byNode['action-head'].macs + r.totals.byNode['is-pad-head'].macs, m.macsPerInference);
  assert.ok(m.fitsControlTEOrin && m.msOrin < 20);
});

test('F15 act-aloha-train: el encoder CVAE corre al entrenar (mismos parámetros, más MACs) y da μ, log σ², z', () => {
  const r = A.run('act-aloha-train'), ri = A.run('act-aloha');
  assert.strictEqual(r.totals.params, ri.totals.params);
  assert.strictEqual(r.totals.macs, 81990959104);
  assert.deepStrictEqual(['action-seq', 'cvae-in', 'cvae-out', 'cvae-cls-out', 'mu', 'logvar', 'z', 'loss-l1', 'loss-kl', 'loss'].map((t) => shape(r, t)),
    ['100×14', '102×512', '102×512', '512', '32', '32', '32', '1', '1', '1']);
  assert.strictEqual(op(r, 'ce-q-proj').repeat, 4);
  assert.ok(!r.tensors.action, 'al entrenar no hay temporal ensembling');
  assert.strictEqual(r.totals.byNode.cvae.params, ri.totals.byNode.cvae.params);
});

test('F15 diffusion-policy-cnn: YAML real_hybrid (T_o 2, T_p 16, T_a 8, DDIM 8 de 100), U-Net [256, 512, 1024] y encoder GroupNorm', () => {
  const r = A.run('diffusion-policy-cnn'), m = A.metrics('diffusion-policy-cnn');
  assert.deepStrictEqual(['img', 'c5', 'kp-logits', 'keypoints', 'cam-feat', 'obs-cond', 't-emb', 'cond', 'noisy-actions', 'd1-out', 'd2-out', 'd3-out', 'm-out', 'u1-out', 'u2-out', 'eps', 'denoised', 'action-exec'].map((t) => shape(r, t)),
    ['216×288×3', '7×9×512', '7×9×32', '32×2', '64', '260', '128', '388', '16×2', '16×256', '8×512', '4×1024', '4×1024', '8×512', '16×256', '16×2', '16×2', '8×2']);
  assert.strictEqual(r.totals.params, 89102530);
  assert.strictEqual(m.policyParams, 66708354);
  assert.strictEqual(m.visionParams, 22394176);
  // la red de ruido corre `steps` veces con los mismos pesos; el encoder, una vez por cámara y paso de observación
  const u = op(r, 'd1-r1-conv1'), e = op(r, 'bb-stem-conv');
  assert.deepStrictEqual([u.repeat, u.paramRepeat, e.repeat, e.paramRepeat], [8, 1, 4, 2]);
  assert.strictEqual(m.denoiseMacs, 8 * m.stepMacs);
  assert.deepStrictEqual([m.steps, m.trainSteps, m.obsSteps, m.chunk, m.executed, m.condDim, m.controlHz, m.inferenceHz], [8, 100, 2, 16, 8, 388, 10, 1.25]);
  assert.deepStrictEqual([m.paperDParamsM, m.paperVParamsM, m.paperSteps], [67, 22, 16]);
  // más pasos de denoising: solo crece la U-Net
  const m16 = A.metrics('diffusion-policy-cnn', { steps: 16 });
  assert.strictEqual(m16.stepMacs, m.stepMacs);
  assert.strictEqual(m16.visionMacs, m.visionMacs);
  assert.strictEqual(m16.policyMacs, 2 * m.policyMacs);
  assert.throws(() => A.run('diffusion-policy-cnn', { steps: 200 }), /100/);
  assert.throws(() => A.run('diffusion-policy-cnn', { chunk: 10 }), /múltiplo de 4/);
  assert.throws(() => A.run('act-aloha', { steps: 4 }), /Diffusion Policy/);
});

test('F15 roofline de Diffusion Policy: los pesos de la red de ruido se releen en cada paso de denoising (no caben en caché)', () => {
  const HWs = A.robotlearn.hardware(), orin = HWs.find((h) => h.id === 'orin'), h100 = HWs.find((h) => h.id === 'h100');
  for (const id of ['diffusion-policy-cnn', 'diffusion-policy-transformer']) for (const steps of [1, 8, 16, 100]) {
    const m = A.metrics(id, { steps });
    // piso de memoria: visión una vez + steps × red de ruido, en bf16
    const wBytes = 2 * (m.visionParams + steps * m.policyParams);
    assert.ok(m.msOrin >= 1000 * wBytes / orin.bandwidth * (1 - 1e-12), id + ' steps ' + steps + ': ' + m.msOrin);
    assert.ok(m.msH100 >= 1000 * wBytes / h100.bandwidth * (1 - 1e-12), id + ' steps ' + steps + ': ' + m.msH100);
  }
  // el piso del reviewer: U-Net 100 pasos ≥ 2 bytes · 100 · 66.7 M / 204.8 GB/s ≈ 65 ms
  const d100 = A.metrics('diffusion-policy-cnn', { steps: 100 });
  assert.ok(d100.msOrin >= 1000 * 2 * 100 * d100.policyParams / orin.bandwidth);
  const d = A.metrics('diffusion-policy-cnn');
  assert.ok(d.msOrin > 6.2 && d.msOrin < 6.4, 'DP-CNN Orin ≈ 6.3 ms: ' + d.msOrin);
  assert.ok(d100.msOrin > 60 && d100.msOrin < 70, 'DP-CNN 100 pasos ≈ 67 ms: ' + d100.msOrin);
  assert.ok(d100.msOrin / d.msOrin > 10, 'la latencia escala con los pasos');
  // la tabla de escalado usa la misma regla que metrics()
  for (const row of d.stepsScaling) assert.ok(near(row.msOrin, A.metrics('diffusion-policy-cnn', { steps: row.steps }).msOrin, 1e-12), 'stepsScaling ' + row.steps);
  for (const row of d.chunkScaling) assert.ok(near(row.msOrin, A.metrics('diffusion-policy-cnn', { chunk: row.chunk }).msOrin, 1e-12), 'chunkScaling ' + row.chunk);
  for (const row of d.camsScaling) assert.ok(near(row.msOrin, A.metrics('diffusion-policy-cnn', { cams: row.cams }).msOrin, 1e-12), 'camsScaling ' + row.cams);
  // actionsPerInference es el chunk PREDICHO; executed, lo que se ejecuta
  assert.deepStrictEqual([d.actionsPerInference, d.executed], [16, 8]);
});

test('F15 diffusion-policy-transformer y bc-mlp: tamaños del YAML y de CNNMLP', () => {
  const t = A.metrics('diffusion-policy-transformer');
  assert.deepStrictEqual([t.totalParams, t.policyParams, t.visionParams], [31387458, 8993282, 22394176]);
  assert.strictEqual(shape(A.run('diffusion-policy-transformer'), 'memory'), '3×256');
  const r = A.run('bc-mlp'), b = A.metrics('bc-mlp');
  assert.strictEqual(r.totals.params, 56485196);
  // un ResNet-18 POR cámara; MLP (768·4 + 14) → 1024 → 1024 → 14; action_head Linear(1000, 14) sin uso
  assert.strictEqual(op(r, 'bb-stem-conv').paramRepeat, 4);
  assert.strictEqual(b.mlpIn, 768 * 4 + 14);
  assert.strictEqual(b.policyParams, lin(3086, 1024) + lin(1024, 1024) + lin(1024, 14));
  assert.strictEqual(b.idleParams, lin(1000, 14));
  assert.ok(b.visionMacsShare > 0.999);
  assert.strictEqual(A.metrics('bc-mlp', { chunk: 10 }).actionsPerInference, 10);
  assert.throws(() => A.run('bc-mlp', { res: 240 }), /muy chica/);
});

test('F15 run / metrics de todas las configs nuevas, cantidades en prosa y crosscheck JSON presente', () => {
  for (const id of RL.concat(IM)) {
    const r = A.run(id), m = A.metrics(id);
    assert.ok(r.totals.params > 0 && r.totals.macs > 0, id);
    assert.ok(m.units && typeof m.units === 'object', id);
    assert.ok(fs.existsSync(path.join(ROOT, 'crosscheck', 'expected', id + '.json')), id);
    const roots = new Set(r.ops.map((o) => o.path[0]));
    assert.strictEqual(sum([...roots].map((k) => r.totals.byNode[k].macs)), r.totals.macs, id);
    for (const [k, u] of Object.entries(m.units)) if (k in m && u !== 'ratio') assert.ok(m[k] == null || typeof m[k] === 'number' || typeof m[k] === 'boolean', id + ' ' + k);
  }
  const Q = ATLAS.Quantities;
  assert.strictEqual(Q.get('ppo-mujoco.params.total').text, '11,085');
  assert.strictEqual(Q.get('ppo-mujoco.cfg.hidden').text, '64');
  assert.ok(Q.get('ppo-mujoco.metrics.updateMacs').text.includes('MACs'));
  assert.strictEqual(Q.get('act-aloha.metrics.tokens').text, '1,202');
  assert.strictEqual(Q.get('diffusion-policy-cnn.tensor.d3-out.shape').text, '4×1024');
  // claves que leen la página rl-ppo (build15/rl-needs.md) y la de imitation
  const mr = A.metrics('ppo-mujoco');
  for (const k of ['actorParams', 'criticParams', 'actorMacs', 'stepMacs', 'samplesPerUpdate', 'minibatchSize', 'gradStepsPerUpdate', 'sampleReuse', 'updateMacs', 'rolloutMacs',
    'rolloutBufferBytes', 'iterations', 'budgetSteps', 'obsDim', 'actDim', 'gamma', 'lambda', 'clipEps', 'controlHz', 'trainToForward', 'iterationMacs', 'updateShare', 'lr', 'entCoef', 'vfCoef'])
    assert.ok(k in mr, k);
  assert.ok('stepsPerSecondCited' in A.metrics('ppo-anymal-isaac'));
  const ma = A.metrics('act-aloha');
  for (const k of ['visionMacs', 'policyMacs', 'macsPerInference', 'chunk', 'executed', 'controlHz', 'inferenceHz', 'inferenceHzTE', 'inferenceHzNoTE', 'deadDecoderMacs', 'decoderLayersUsed',
    'msOrin', 'msH100', 'maxHzOrin', 'visionMacsShare', 'tokens', 'latentDim', 'klWeight', 'fitsControlTEOrin', 'cvaeParams', 'headParams', 'actionsPerInference']) assert.ok(k in ma, k);
  const md = A.metrics('diffusion-policy-cnn');
  for (const k of ['steps', 'stepMacs', 'denoiseMacs', 'obsSteps', 'trainSteps', 'condDim', 'stepsScaling', 'chunkScaling']) assert.ok(k in md, k);
});

test('F15 cada config tiene al menos un valor de knob válido distinto de su base (steps solo en Diffusion Policy)', () => {
  for (const model of ['rl-ppo', 'imitation']) {
    const knobs = A.model(model).knobs;
    for (const { id } of A.configs(model)) {
      const cfg = A.run(id).config;
      for (const k of Object.keys(knobs)) {
        const ok = knobs[k].filter((v) => v !== cfg[k] && (() => { try { A.metrics(id, { [k]: v }); return true; } catch (e) { return false; } })());
        if (k === 'steps' && !/^dp/.test(cfg.family)) { assert.strictEqual(ok.length, 0, id); continue; }
        assert.ok(ok.length >= 1, id + ': ningún valor válido de ' + k);
      }
    }
  }
});
