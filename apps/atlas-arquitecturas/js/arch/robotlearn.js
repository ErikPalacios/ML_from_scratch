/* =============================================================================
   Atlas de Arquitecturas — js/arch/robotlearn.js
   Fase 15 (SPEC §27). Tesis: dos maneras de obtener la política de un robot.
     `rl-ppo`    (página rl-ppo):    RL on-policy con PPO (recorte del ratio + GAE) — prueba y error contra una recompensa.
     `imitation` (página imitation): imitar demostraciones — BC (una acción), ACT (chunks de acciones con un transformer +
                                     CVAE) y Diffusion Policy (denoising de secuencias de acciones, multimodal).
   Cargar DESPUÉS de perception.js (roofline: Jetson AGX Orin y H100). Contrato de ids completo: scratchpad build15/arch-ids.md
   (resumido aquí). Cross-check: crosscheck/robotlearn.py (módulos transcritos del código oficial en el dispositivo meta o en CPU,
   torchvision ResNet-18, iteraciones de PPO reales bajo FlopCounterMode, GAE y la pérdida recortada contra numpy).

   ---------------------------------------------------------------- rl-ppo (grafo = UN paso de entorno para UNA observación)
   Configs: ppo-mujoco (canónica; HalfCheetah, CleanRL ppo_continuous_action.py = PPO paper Tabla 3), ppo-atari (Breakout,
   Nature-CNN compartida de CleanRL ppo_atari.py con los hiperparámetros de la Tabla 5), ppo-anymal-isaac (legged_gym +
   rsl_rl v1.0.2). Knobs: nEnvs, horizon (T), epochs (K), minibatches, hidden (ancho de la 1.ª capa oculta; el resto en
   proporción). totals = actor + crítico (+ tronco) sobre UNA observación: lo que corre en cada paso del rollout. El costo de una
   iteración completa (rollout + K épocas de forward + backward) está en metrics(): exacto, verificado con FlopCounterMode sobre
   una iteración real de cada implementación (crosscheck).
   Ops (path): [atari] trunk-conv1 … trunk-relu4 (trunk › …) obs → features · actor-fc{i} / actor-act{i} (actor › fc{i} / act{i})
   → a-h{i}, a-z{i} · actor-mean (actor › mean) → act-mean | actor-logits (actor › logits) → act-logits · log-std (actor › log-std)
   → act-std · sample → action, logp · critic-fc{i} / critic-act{i} (critic › …) → c-h{i}, c-z{i} · critic-value (critic › value)
   → value · env-step → reward · store (buffer) → rollout (T×N) · gae › {unpack → rewards, values, dones; bootstrap → last-value;
   td-error → deltas; gae-scan → advantages; returns → returns; [rsl_rl: adv-norm sobre el lote]} · update › minibatch › {select →
   mb-obs, mb-action, mb-logp-old, mb-adv(-raw), mb-ret; [CleanRL: adv-norm → mb-adv]} · update › clip-loss › {new-logp, ratio, clip,
   surr, surr-min, clip-mean → loss-clip} · value-loss / entropy / total-loss (update › …) → loss-value, loss-entropy, loss.

   ---------------------------------------------------------------- imitation (grafo = UNA inferencia de la política)
   Configs: act-aloha (canónica, inferencia: z = 0), act-aloha-train (forward de ENTRENAMIENTO con el encoder CVAE y las pérdidas;
   DESVIACIÓN aditiva de §27: una config aparte, como sd15-train, para la vista act-cvae), diffusion-policy-cnn,
   diffusion-policy-transformer, bc-mlp. Knobs: chunk (k / T_p), cams, steps (pasos de denoising, solo DP), res (alto de la
   imagen que entra al backbone; ancho = 4·res/3).
   Backbone ResNet-18 (torchvision; ids bb-*): una cámara por pasada (op.repeat = cámaras × pasos de observación); los pesos
   existen una vez (ACT: el código usa self.backbones[0] para todas las cámaras) o una vez por cámara (DP, BC: op.paramRepeat).
   Normalización: FrozenBatchNorm2d en ACT y BC (γ, β y estadísticas = buffers: 0 parámetros); GroupNorm(C/16, C) en DP.
   ACT (tonyzhaozh/act, detr/models/detr_vae.py + transformer.py): input-proj 1×1 512 → D por cámara, PE seno 2-D (buffer),
   cámaras concatenadas a lo ancho → N_img = cams·h·w tokens; + 2 tokens (latente z proyectado, articulaciones proyectadas) con su
   posición aprendida (2×D); encoder post-LN de 4 capas (DETR); decoder de 7 capas con k queries aprendidas (tgt = 0);
   return_intermediate_dec = True y el código toma hs[0]: la salida de la PRIMERA capa del decoder alimenta las cabezas (las otras
   6 se calculan y se tiran: metrics().deadDecoderMacs); cabezas action (D → 14) e is_pad (D → 1); temporal ensembling.
   Diffusion Policy (real-stanford/diffusion_policy + robomimic 0.2.0): por cámara ResNet-18 (GroupNorm) → conv 1×1 512 → 32 →
   spatial softmax → 32×2 → Linear 64 → 64 → ReLU; 64·cams + 2 (pose del efector) por paso de observación; CNN: global_cond =
   T_o·130 = 260, cond = 128 (paso de difusión) + 260 = 388; ConditionalUnet1D down_dims [256, 512, 1024], kernel 5, GroupNorm 8,
   FiLM (escala + sesgo), Mish; Transformer: TransformerForDiffusion n_emb 256, 8 capas, 4 cabezas, causal, cond = [t; obs].
   La red de ruido corre `steps` veces (op.repeat), el encoder de observación una vez por inferencia.
   BC (CNNMLP del repo de ACT): un ResNet-18 por cámara (FrozenBN) → 3 convs 5×5 (512 → 128 → 64 → 32, sin activación) → 768 por
   cámara → MLP (768·cams + 14) → 1024 → 1024 → 14·k; action_head Linear 1000 → 14 existe y no se usa (idle).

   ---------------------------------------------------------------- hardware (≈)
   Jetson AGX Orin 64GB y H100 SXM de perception.js / vla.js. Roofline sin overheads: ms = máx(2·MACs/pico, bytes/ancho de banda),
   bytes = pesos en fp16 + activaciones (bf16) escritas y leídas una vez. Son techos: lo medido siempre es más lento.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel || !A.film || !A.rollout_store) throw new Error('robotlearn.js necesita js/arch/primitives.js (fase 15) antes.');
  if (!A.perception || !A.perception.roof) throw new Error('robotlearn.js necesita perception.js antes (roofline Orin / H100).');
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);
  const HW = A.perception.hardware();
  const ORIN = HW.find((h) => h.id === 'orin'), H100 = HW.find((h) => h.id === 'h100');
  const roof = A.perception.roof;
  // Resultado "externo" con la forma de una primitiva (vistas propias del modelo: concatenar cámaras, ceros del latente…).
  function ext(prim, inputs, out, o) {
    o = o || {};
    const outs = Array.isArray(out) ? out : [out];
    const inTex = inputs.filter(Boolean).map(A.fmt.shapeTex).join(',\\ '), outTex = outs.map(A.fmt.shapeTex).join(',\\ ');
    return { prim, inputs: inputs.filter(Boolean), out, params: o.params || 0, macs: o.macs || 0, other: o.other || 0,
      paramFormula: o.paramTex || '0', macFormula: o.macTex || '0', paramArith: fint(o.params || 0), macArith: fint(o.macs || 0),
      shapeTex: (inTex ? inTex + ' \\to ' : '\\to ') + outTex, detail: o.detail || {} };
  }
  // Las tablas de escala llaman a run()/metrics() con otros knobs: sin la guarda, cada llamada armaría su propia tabla.
  let scaling = false;
  function guarded(fn) { if (scaling) return null; scaling = true; try { return fn(); } finally { scaling = false; } }
  const archOverrides = (r, model) => {
    const out = {};
    Object.keys(r.overrides || {}).forEach((k) => { if (k in A.model(model).knobs) out[k] = r.overrides[k]; });
    return out;
  };
  const sumOps = (r, pred, key) => r.ops.filter(pred).reduce((s, o) => s + o[key || 'macs'] * o.repeat, 0);

  // ============================================================== rl-ppo
  const PPO_SRC = 'Schulman et al., Proximal Policy Optimization Algorithms, arXiv:1707.06347 (2017); ';
  const RL_CONFIGS = {
    'ppo-mujoco': { label: 'PPO · MuJoCo HalfCheetah (MLP 64-64 tanh)', canonical: true, impl: 'cleanrl', env: 'HalfCheetah-v4', sim: 'MuJoCo',
      net: 'mlp', obsDim: 17, actDim: 6, discrete: false, actorHidden: [64, 64], criticHidden: [64, 64], act: 'tanh', stdParam: 'log-std',
      nEnvs: 1, horizon: 2048, epochs: 10, minibatches: 32, gamma: 0.99, lambda: 0.95, clipEps: 0.2, lr: 3e-4, entCoef: 0, vfCoef: 0.5, maxGradNorm: 0.5,
      budget: 1000000, dt: 0.05,
      source: PPO_SRC + '§6.1 y Tabla 3 (MLP de 2 capas de 64 con tanh, gaussiana con desviación variable, política y valor sin compartir parámetros, sin entropía; T = 2048, Adam 3e-4, 10 épocas, minibatch 64, γ 0.99, λ 0.95; ε = 0.2, la mejor de la Tabla 1; 1 M pasos). Implementación: CleanRL cleanrl/ppo_continuous_action.py (Agent: crítico 64-64 tanh → 1, actor 64-64 tanh → d_a, actor_logstd 1×d_a; num_envs 1, num_steps 2048, num_minibatches 32, update_epochs 10, vf_coef 0.5, clip_vloss, max_grad_norm 0.5). HalfCheetah-v4: obs 17, acción 6, dt 0.05 s (gymnasium 1.4.0 + mujoco 3.15.0).' },
    'ppo-atari': { label: 'PPO · Atari Breakout (Nature-CNN compartida)', impl: 'cleanrl', env: 'BreakoutNoFrameskip-v4', sim: 'ALE',
      net: 'nature-cnn', obsH: 84, obsW: 84, frames: 4, actDim: 4, discrete: true, fc: 512, act: 'relu',
      nEnvs: 8, horizon: 128, epochs: 3, minibatches: 4, gamma: 0.99, lambda: 0.95, clipEps: 0.1, lr: 2.5e-4, entCoef: 0.01, vfCoef: 1, maxGradNorm: 0.5,
      annealed: true, budget: 10000000, dt: 4 / 60, epochsCleanRL: 4,
      source: PPO_SRC + 'Tabla 5 (8 actores × 128 pasos, 3 épocas, minibatch 32 × 8 = 256, ε = 0.1·α y Adam 2.5e-4·α con α de 1 a 0, c₁ = 1, c₂ = 0.01, γ 0.99, λ 0.95; 40 M frames = 10 M pasos con frameskip 4). Red: Nature-CNN (Mnih et al. 2015) compartida por actor y crítico como CleanRL cleanrl/ppo_atari.py (conv 8×8/4 → 32, 4×4/2 → 64, 3×3/1 → 64, fc 3136 → 512; cabezas 512 → |A| y 512 → 1); el paper dice "la misma arquitectura que [Mni+16]". CleanRL usa update_epochs = 4: el calculador sigue al paper (3). BreakoutNoFrameskip-v4: |A| = 4 (ale-py 0.12.1), obs 84×84 en gris con 4 frames apilados.' },
    'ppo-anymal-isaac': { label: 'PPO · ANYmal C en terreno irregular (Isaac Gym, 4,096 entornos)', impl: 'rsl_rl', env: 'anymal_c_rough', sim: 'Isaac Gym (PhysX, GPU)',
      net: 'mlp', obsDim: 235, actDim: 12, discrete: false, actorHidden: [512, 256, 128], criticHidden: [512, 256, 128], act: 'elu', stdParam: 'std',
      nEnvs: 4096, horizon: 24, epochs: 5, minibatches: 4, gamma: 0.99, lambda: 0.95, clipEps: 0.2, lr: 1e-3, adaptiveLr: true, desiredKl: 0.01, entCoef: 0.01, vfCoef: 1, maxGradNorm: 1,
      maxIterations: 1500, dt: 0.02, paperMinutes: 20, paperGpu: 'RTX A6000',
      source: 'Rudin et al., Learning to Walk in Minutes Using Massively Parallel Deep RL, CoRL 2021, arXiv:2109.11978 (Tabla 3 del apéndice A.4: batch 98,304 = 4096 × 24, minibatch 24,576, 5 épocas, ε 0.2, c₂ 0.01, γ 0.99, λ 0.95, KL deseada 0.01 con lr adaptativo; "1500 policy updates in under 20 minutes", i9-11900k + RTX A6000). Código: leggedrobotics/legged_gym legged_robot_config.py (num_envs 4096, num_observations 235 = 48 de propiocepción + 187 alturas 17×11, num_actions 12, actor y crítico 512-256-128 ELU, init_noise_std 1.0, num_steps_per_env 24, max_iterations 1500, sim dt 0.005 × decimation 4 = 50 Hz) + rsl_rl v1.0.2 (ActorCritic con std aprendida, no log-std; RolloutStorage).' },
  };

  function rlApply(c, ov) {
    const notes = [];
    ['nEnvs', 'horizon', 'epochs', 'minibatches'].forEach((k) => { if (ov[k] !== undefined) { c[k] = ov[k]; notes.push(k + ' = ' + ov[k] + ' (what-if)'); } });
    if (ov.hidden !== undefined) {
      const h = ov.hidden;
      if (c.net === 'mlp') {
        const base = c.actorHidden[0];
        const scale = (arr) => arr.map((x) => { const v = x * h / base; if (!Number.isInteger(v)) throw new Error('hidden = ' + h + ': las capas ' + arr.join('-') + ' no escalan a enteros con la 1.ª capa en ' + h + '.'); return v; });
        c.actorHidden = scale(c.actorHidden); c.criticHidden = scale(c.criticHidden);
      } else c.fc = h;
      notes.push('hidden = ' + h + ' (what-if: ' + (c.net === 'mlp' ? 'capas ' + c.actorHidden.join('-') : 'fc del tronco ' + h) + ')');
    }
    c._notes = notes;
    return c;
  }
  function rlResolve(c) {
    const W = 'PPO: ';
    c.samples = c.nEnvs * c.horizon;
    if (c.samples % c.minibatches !== 0) throw new Error(W + 'N·T = ' + c.samples + ' muestras no se dividen en ' + c.minibatches + ' minibatches iguales.');
    c.M = c.samples / c.minibatches;
    c.obsElems = c.net === 'nature-cnn' ? c.obsH * c.obsW * c.frames : c.obsDim;
    if (c.net === 'nature-cnn') c.obsDim = c.obsElems;
    // CleanRL: num_iterations = total_timesteps // batch_size; legged_gym: max_iterations.
    c.iterations = c.maxIterations || Math.floor(c.budget / c.samples);
    c.budgetSteps = c.iterations * c.samples;
    c.controlHz = 1 / c.dt;
    c.tokens = c.samples;
    // Valor del knob `hidden` en la config resuelta: ancho de la 1.ª capa oculta (MLP) o de la fc del tronco (Atari).
    c.hidden = c.net === 'mlp' ? c.actorHidden[0] : c.fc;
    return c;
  }

  // MLP de la política o del crítico (Linear + activación por capa oculta). Devuelve la salida de la última activación.
  function mlpOps(g, x, root, hidden, actName, pre, where) {
    const actFn = actName === 'tanh' ? A.tanh : actName === 'elu' ? A.elu : A.relu;
    const actLab = actName === 'tanh' ? 'tanh' : actName === 'elu' ? 'ELU' : 'ReLU';
    let h = x;
    hidden.forEach((w, i) => {
      const n = i + 1, ds = 'h_' + n;
      const lin = g.op(root + '-fc' + n, A.linear(h, { dout: w, doutSym: ds }), { path: [root, 'fc' + n], out: pre + '-h' + n, where,
        label: 'Linear ' + h.num[h.num.length - 1] + ' → ' + w, type: 'mlp', group: 'mlp', outMeta: { label: where[0] + ': capa oculta ' + n + ' (antes de la activación)', tex: pre + '_{' + n + '}' } });
      h = g.op(root + '-act' + n, actFn(lin), { path: [root, 'act' + n], out: pre + '-z' + n, where,
        label: actLab, type: 'mlp', group: 'act', outMeta: { label: where[0] + ': capa oculta ' + n + ' (' + actLab + ')', tex: '\\sigma(' + pre + '_{' + n + '})' } });
    });
    return h;
  }

  function rlBuild(c) {
    const g = A.graph(c);
    const cont = !c.discrete;
    let obs, feat;
    if (c.net === 'nature-cnn') {
      obs = g.input('obs', shp(['84', '84', '4'], [c.obsH, c.obsW, c.frames], 'img', 'grid'), { label: 'Observación: 4 frames de 84×84 en gris apilados', tex: 's_t' });
      const WT = ['Tronco compartido (Nature-CNN)'];
      const conv = (id, x, k, s, cout, out, lab) => g.op('trunk-' + id, A.conv2d(x, { k, s, cout, bias: true }), { path: ['trunk', id], out, where: WT, label: lab, type: 'conv', group: 'embed',
        outMeta: { label: 'Tronco: ' + lab, tex: out } });
      const rl = (id, x, out) => g.op('trunk-' + id, A.relu(x), { path: ['trunk', id], out, where: WT, label: 'ReLU', type: 'mlp', group: 'act', outMeta: { label: 'Tronco: ReLU', tex: '\\mathrm{ReLU}' } });
      let x = conv('conv1', obs, 8, 4, 32, 't-c1', 'Conv 8×8, stride 4 → 32');
      x = rl('relu1', x, 't-a1');
      x = conv('conv2', x, 4, 2, 64, 't-c2', 'Conv 4×4, stride 2 → 64');
      x = rl('relu2', x, 't-a2');
      x = conv('conv3', x, 3, 1, 64, 't-c3', 'Conv 3×3, stride 1 → 64');
      x = rl('relu3', x, 't-a3');
      x = g.op('trunk-flatten', A.flatten_vec(x, { sym: '7·7·64' }), { path: ['trunk', 'flatten'], out: 't-flat', where: WT, label: 'Aplanar 7×7×64 → 3136', type: 'tensorop', group: 'embed', outMeta: { label: 'Tronco: rasgos aplanados', tex: '\\mathrm{vec}' } });
      x = g.op('trunk-fc', A.linear(x, { dout: c.fc, doutSym: 'h' }), { path: ['trunk', 'fc'], out: 't-fc', where: WT, label: 'Linear 3136 → ' + c.fc, type: 'mlp', group: 'mlp', outMeta: { label: 'Tronco: fc', tex: 'W_{fc}x' } });
      feat = g.op('trunk-relu4', A.relu(x), { path: ['trunk', 'relu4'], out: 'features', where: WT, label: 'ReLU', type: 'mlp', group: 'act', outMeta: { label: 'Rasgos compartidos por actor y crítico', tex: 'f(s_t)' } });
    } else {
      obs = g.input('obs', shp(['d_obs'], [c.obsDim], 'lat', 'vec'), { label: 'Observación del entorno (estado: ' + c.obsDim + ' números)', tex: 's_t' });
    }
    const WA = ['Actor π_θ'], WC = ['Crítico V_φ'];
    let mean = null, logits = null, std = null;
    if (c.net === 'mlp') {
      const za = mlpOps(g, obs, 'actor', c.actorHidden, c.act, 'a', WA);
      mean = g.op('actor-mean', A.linear(za, { dout: c.actDim, doutSym: 'd_a' }), { path: ['actor', 'mean'], out: 'act-mean', where: WA,
        label: 'Linear → μ (media de la acción, ' + c.actDim + ')', type: 'head', group: 'head', outMeta: { label: 'Media de la acción μ_θ(s)', tex: '\\mu_\\theta(s)' } });
    } else {
      logits = g.op('actor-logits', A.linear(feat, { dout: c.actDim, doutSym: '|A|' }), { path: ['actor', 'logits'], out: 'act-logits', where: WA,
        label: 'Linear ' + c.fc + ' → |A| = ' + c.actDim + ' (logits)', type: 'head', group: 'head', outMeta: { label: 'Logits de las ' + c.actDim + ' acciones discretas', tex: 'z_\\theta(s)' } });
    }
    if (cont) {
      std = g.op('log-std', A.policy_std({ d: c.actDim, sym: 'd_a', param: c.stdParam, mod: 'act' }), { path: ['actor', 'log-std'], out: 'act-std', where: WA,
        label: c.stdParam === 'std' ? 'σ aprendida (vector, no depende del estado)' : 'log σ aprendido (vector, no depende del estado)', type: 'embed', group: 'embed',
        outMeta: { label: 'Desviación de la acción σ (la misma para todo estado)', tex: '\\sigma' } });
    }
    const [action, logp] = g.op('sample', cont ? A.gaussian_sample(mean, std) : A.categorical_sample(logits), { path: ['sample'], out: ['action', 'logp'],
      label: cont ? 'Muestrear a ~ N(μ, σ²) y guardar log π(a|s)' : 'Muestrear a ~ Categorical(softmax(z)) y guardar log π(a|s)', type: 'head', group: 'head',
      outMeta: [{ label: cont ? 'Acción continua (' + c.actDim + ')' : 'Acción discreta (un id de ' + c.actDim + ')', tex: 'a_t' }, { label: 'log π_θold(a_t|s_t) (para el ratio)', tex: '\\log\\pi_{\\theta_{old}}' }] });
    let zc;
    if (c.net === 'mlp') zc = mlpOps(g, obs, 'critic', c.criticHidden, c.act, 'c', WC);
    const value = g.op('critic-value', A.linear(c.net === 'mlp' ? zc : feat, { dout: 1, doutSym: '1' }), { path: ['critic', 'value'], out: 'value', where: WC,
      label: 'Linear → V(s) (un número)', type: 'head', group: 'head', outMeta: { label: 'Valor estimado del estado V_φ(s)', tex: 'V_\\phi(s_t)' } });
    const reward = g.op('env-step', A.env_step(action, { sim: c.sim, dt: c.dt }), { path: ['env-step'], out: 'reward',
      label: 'Paso del entorno (' + c.sim + '): aplica a_t, devuelve r_t y s_{t+1}', type: 'tensorop', group: 'other', outMeta: { label: 'Recompensa del paso', tex: 'r_t' } });
    const roll = g.op('store', A.rollout_store([obs, action, logp, value, reward], { T: c.horizon, N: c.nEnvs, fields: bufferFields(c).map((f) => f.name), mod: 'lat' }), { path: ['buffer'], out: 'rollout',
      label: 'Buffer: N = ' + fint(c.nEnvs) + ' entornos × T = ' + fint(c.horizon) + ' pasos', type: 'tensorop', group: 'other', outMeta: { label: 'Rollout (s, a, log π, V, r, done) por paso y entorno', tex: '\\mathcal{D}' } });
    // ---- GAE (vista `gae`): gae › unpack / bootstrap / td-error / gae-scan / returns [/ adv-norm en rsl_rl]. Sin MACs; "otros"
    // ≈ 4 + 3 + 1 = 8 por celda (δ: 4, recursión: 3, retorno: 1). El costo del crítico sobre s_T está en metrics().bootstrapMacs.
    const WG = ['GAE (γ = ' + c.gamma + ', λ = ' + c.lambda + ')'];
    const TN = () => shp(['T', 'N'], [c.horizon, c.nEnvs], 'lat', 'mat');
    const nT = c.samples, rsl = c.impl === 'rsl_rl';
    const [rews, vals, dns] = g.op('gae-unpack', ext('rollout_fields', [roll], [TN(), TN(), TN()], { detail: { note: 'vista: las columnas r, V y done del buffer' } }), {
      path: ['gae', 'unpack'], out: ['rewards', 'values', 'dones'], where: WG, label: 'Leer r_t, V(s_t) y done_t del buffer (T×N)', type: 'tensorop', group: 'other',
      outMeta: [{ label: 'Recompensas r_t (T×N)', tex: 'r_t' }, { label: 'Valores guardados V(s_t) (T×N)', tex: 'V_t' }, { label: 'Fin de episodio d_t (T×N)', tex: 'd_t' }] });
    const trunkNote = c.net === 'nature-cnn' ? ' (y el tronco)' : '';
    const lastV = g.op('bootstrap', ext('bootstrap_value', [value], shp(['N'], [c.nEnvs], 'lat', 'vec'), { detail: { note: 'V(s_T) de cada entorno: el crítico' + trunkNote + ' sobre la observación que sigue al último paso; su costo, N × (crítico' + trunkNote + '), está en metrics().bootstrapMacs' } }), {
      path: ['gae', 'bootstrap'], out: 'last-value', where: WG, label: 'Bootstrap: V(s_T) con el crítico (una vez por entorno)', type: 'tensorop', group: 'other',
      outMeta: { label: 'Valor del estado que sigue al último paso (N)', tex: 'V(s_T)' } });
    const delta = g.op('td-error', ext('td_error', [rews, vals, dns, lastV], TN(), { other: 4 * nT, detail: { gamma: c.gamma, formula: 'δ_t = r_t + γ(1 − d_{t+1})V_{t+1} − V_t' } }), {
      path: ['gae', 'td-error'], out: 'deltas', where: WG, label: 'Error TD: δ_t = r_t + γ·V_{t+1}·(1 − d) − V_t', type: 'tensorop', group: 'other', outMeta: { label: 'Errores TD δ_t (T×N)', tex: '\\delta_t' } });
    const advRaw = g.op('gae-scan', ext('gae_scan', [delta, dns], TN(), { other: 3 * nT, detail: { gamma: c.gamma, lambda: c.lambda, formula: 'Â_t = δ_t + γλ(1 − d_{t+1})Â_{t+1}, hacia atrás en t' } }), {
      path: ['gae', 'gae-scan'], out: rsl ? 'adv-raw' : 'advantages', where: WG, label: 'Recursión hacia atrás: Â_t = δ_t + γλ·Â_{t+1}', type: 'tensorop', group: 'other',
      outMeta: { label: rsl ? 'Ventajas Â_t (sin normalizar)' : 'Ventajas Â_t', tex: '\\hat A_t' } });
    const ret = g.op('returns', ext('gae_returns', [advRaw, vals], TN(), { other: nT, detail: { formula: 'R_t = Â_t + V_t' } }), {
      path: ['gae', 'returns'], out: 'returns', where: WG, label: 'Retornos: R_t = Â_t + V_t', type: 'tensorop', group: 'other', outMeta: { label: 'Retornos R_t = Â_t + V_t (objetivo del crítico)', tex: 'R_t' } });
    // Normalización de ventajas: rsl_rl (v1.0.2 rollout_storage.py compute_returns) sobre TODO el lote; CleanRL por minibatch (norm_adv).
    const adv = rsl ? g.op('adv-norm', ext('normalize_adv', [advRaw], TN(), { other: 4 * nT, detail: { scope: 'lote', note: '(Â − media)/(desvío + 1e-8) sobre las N·T muestras (rsl_rl compute_returns)' } }), {
      path: ['gae', 'adv-norm'], out: 'advantages', where: WG, label: 'Normalizar Â en todo el lote (media 0, desvío 1)', type: 'tensorop', group: 'other',
      outMeta: { label: 'Ventajas Â_t (normalizadas en el lote)', tex: '\\hat A_t' } }) : advRaw;
    const WU = ['Actualización (K = ' + c.epochs + ' épocas × ' + c.minibatches + ' minibatches)'];
    // ---- minibatch (M muestras del lote aplanado) y la pérdida recortada por dentro (vista `clip`): update › clip-loss › …
    const M = c.M, vM = (mod) => shp(['M'], [M], mod || 'lat', 'vec');
    const mbObs = c.net === 'nature-cnn' ? shp(['M', '84·84·4'], [M, c.obsElems], 'img', 'seq') : shp(['M', 'd_obs'], [M, c.obsDim], 'lat', 'seq');
    const mbAct = c.discrete ? vM('act') : shp(['M', 'd_a'], [M, c.actDim], 'act', 'seq');
    const [mbO, mbAc, mbLo, mbAraw, mbR] = g.op('minibatch', ext('minibatch_select', [roll, adv, ret], [mbObs, mbAct, vM(), vM(), vM()], { detail: { M, from: nT, note: 'M = N·T / ' + c.minibatches + ': índices barajados, sin reemplazo dentro de la época' } }), {
      path: ['update', 'minibatch', 'select'], out: ['mb-obs', 'mb-action', 'mb-logp-old', rsl ? 'mb-adv' : 'mb-adv-raw', 'mb-ret'], where: WU,
      label: 'Minibatch de M = ' + fint(M) + ' muestras (índices barajados)', type: 'tensorop', group: 'other',
      outMeta: [{ label: 'Observaciones del minibatch', tex: 's' }, { label: 'Acciones guardadas en el rollout', tex: 'a' }, { label: 'log π_old guardado en el rollout', tex: '\\log\\pi_{old}' },
        { label: rsl ? 'Ventajas del minibatch (ya normalizadas en el lote)' : 'Ventajas del minibatch (sin normalizar)', tex: '\\hat A' }, { label: 'Retornos del minibatch', tex: 'R' }] });
    const mbA = rsl ? mbAraw : g.op('adv-norm', ext('normalize_adv', [mbAraw], vM(), { other: 4 * M, detail: { scope: 'minibatch', note: '(Â − media)/(desvío + 1e-8) dentro del minibatch (CleanRL norm_adv = True)' } }), {
      path: ['update', 'minibatch', 'adv-norm'], out: 'mb-adv', where: WU, label: 'Normalizar Â en el minibatch (media 0, desvío 1)', type: 'tensorop', group: 'other',
      outMeta: { label: 'Ventajas del minibatch (normalizadas)', tex: '\\hat A' } });
    const WCL = WU.concat(['PPO-clip']);
    const cop = (id, res, out, extra) => g.op(id, res, Object.assign({ path: ['update', 'clip-loss', id], out, where: WCL }, extra));
    const mbLp = cop('new-logp', ext('policy_logprob', [mbO, mbAc], vM(), { detail: { note: 'el actor con gradiente sobre las M observaciones; sus MACs (forward + backward) están en metrics().updateMacs, no en este grafo de un paso' } }), 'mb-logp',
      { label: 'Actor con gradiente: log π_θ(a|s) de la acción guardada', type: 'mlp', group: 'mlp', outMeta: { label: 'log π_θ(a|s) con los θ actuales', tex: '\\log\\pi_\\theta' } });
    const rat = cop('ratio', ext('ppo_ratio', [mbLp, mbLo], vM(), { other: 2 * M, detail: { formula: 'r = exp(log π_θ − log π_old)' } }), 'mb-ratio',
      { label: 'r = exp(log π_θ − log π_old)', type: 'tensorop', group: 'other', outMeta: { label: 'Cociente r_t(θ) = π_θ / π_old', tex: 'r_t(\\theta)' } });
    const ratc = cop('clip', ext('clamp', [rat], vM(), { other: 2 * M, detail: { lo: 1 - c.clipEps, hi: 1 + c.clipEps } }), 'mb-ratio-clip',
      { label: 'clip(r, 1 − ' + c.clipEps + ', 1 + ' + c.clipEps + ')', type: 'tensorop', group: 'other', outMeta: { label: 'Cociente recortado', tex: '\\mathrm{clip}(r, 1\\pm\\epsilon)' } });
    const [s1, s2] = cop('surr', ext('ppo_surrogates', [rat, ratc, mbA], [vM(), vM()], { other: 2 * M }), ['surr1', 'surr2'],
      { label: 'r·Â y clip(r)·Â', type: 'tensorop', group: 'other', outMeta: [{ label: 'Surrogate sin recortar r·Â', tex: 'r\\hat A' }, { label: 'Surrogate recortado clip(r)·Â', tex: '\\mathrm{clip}(r)\\hat A' }] });
    const smin = cop('surr-min', ext('elementwise_min', [s1, s2], vM(), { other: M }), 'surr-min',
      { label: 'min de los dos (cota pesimista)', type: 'tensorop', group: 'other', outMeta: { label: 'min(r·Â, clip(r)·Â) por muestra', tex: '\\min(\\cdot)' } });
    const lc = cop('clip-mean', ext('mean', [smin], shp(['1'], [1], 'lat', 'vec'), { other: M }), 'loss-clip',
      { label: '−media sobre el minibatch', type: 'head', group: 'head', outMeta: { label: 'Pérdida de la política (−L^CLIP)', tex: '-L^{CLIP}' } });
    const lv = g.op('value-loss', A.value_loss(mbR, mbR, { eps: c.clipEps }), { path: ['update', 'value-loss'], in: ['mb-ret'], out: 'loss-value', where: WU,
      label: 'Pérdida del crítico (V − R)², recortada', type: 'head', group: 'head', outMeta: { label: 'Pérdida del valor L^V', tex: 'L^{V}' } });
    const le = g.op('entropy', A.policy_entropy(cont ? std : logits, { kind: cont ? 'gaussian' : 'categorical' }), { path: ['update', 'entropy'], out: 'loss-entropy', where: WU,
      label: 'Entropía de π (bono de exploración)', type: 'head', group: 'head', outMeta: { label: 'Entropía H[π]', tex: 'H[\\pi_\\theta]' } });
    g.op('total-loss', A.loss_sum([lc, lv, le], { coefs: [1, c.vfCoef, -c.entCoef], formula: 'L = −L^CLIP + c₁L^V − c₂H' }), { path: ['update', 'total-loss'], out: 'loss', where: WU,
      label: 'L = −L^CLIP + ' + c.vfCoef + '·L^V − ' + c.entCoef + '·H → backward → Adam', type: 'head', group: 'head', outMeta: { label: 'Pérdida total (un paso de gradiente por minibatch)', tex: 'L' } });
    return g;
  }

  // Campos del buffer de cada implementación (float32 salvo los dones de rsl_rl, en bytes).
  function bufferFields(c) {
    const f = (name, per, bytes) => ({ name, per, bytes: bytes || 4 });
    const obs = f('obs', c.obsElems), act = f('actions', c.discrete ? 1 : c.actDim);
    if (c.impl === 'rsl_rl') return [obs, f('rewards', 1), act, f('dones', 1, 1), f('actions_log_prob', 1), f('values', 1), f('returns', 1), f('advantages', 1), f('mu', c.actDim), f('sigma', c.actDim)];
    return [obs, act, f('logprobs', 1), f('rewards', 1), f('dones', 1), f('values', 1), f('advantages', 1), f('returns', 1)];
  }

  function rlParts(c, r) {
    const n = r.totals.byNode, z = { params: 0, macs: 0 };
    const actor = n.actor || z, critic = n.critic || z, trunk = n.trunk || z;
    const step = r.totals.macs;
    // Primera capa: no hay gradiente respecto de la entrada (la observación no lo pide). MLP: actor-fc1 y critic-fc1 leen s_t.
    const first = c.net === 'nature-cnn' ? r.ops.find((o) => o.id === 'trunk-conv1').macs : r.ops.find((o) => o.id === 'actor-fc1').macs + r.ops.find((o) => o.id === 'critic-fc1').macs;
    const train = 3 * step - first, bwd = 2 * step - first;
    const boot = c.nEnvs * (critic.macs + trunk.macs);
    const rollout = c.samples * step + boot;
    const update = c.epochs * c.samples * train;
    const buf = bufferFields(c);
    const bufBytes = c.samples * buf.reduce((s, x) => s + x.per * x.bytes, 0);
    return { actor, critic, trunk, step, first, train, bwd, boot, rollout, update, iteration: rollout + update, buf, bufBytes };
  }
  function rlQuantities(c, r) {
    const p = rlParts(c, r);
    return { tokens: c.samples, samplesPerUpdate: c.samples, minibatchSize: c.M, gradStepsPerUpdate: c.epochs * c.minibatches, actorParams: p.actor.params, criticParams: p.critic.params,
      trunkParams: p.trunk.params, stepMacs: p.step, trainMacsPerSample: p.train, updateMacs: p.update, rolloutMacs: p.rollout, iterations: c.iterations, rolloutBufferBytes: p.bufBytes };
  }
  function rlMetrics(c, r, o) {
    const p = rlParts(c, r), t = r.totals;
    const actorDeploy = p.actor.macs + p.trunk.macs, actorParams = p.actor.params + p.trunk.params;
    const dep = roof(actorDeploy, actorParams, 0, ORIN, 1), depH = roof(actorDeploy, actorParams, 0, H100, 1);
    const inf = roof(p.step, t.params, 0, H100, c.nEnvs);
    const out = {
      impl: c.impl, env: c.env, sim: c.sim, obsDim: c.obsDim, actDim: c.actDim, discrete: c.discrete, nEnvs: c.nEnvs, horizon: c.horizon, epochs: c.epochs, minibatches: c.minibatches,
      minibatchSize: c.M, samplesPerUpdate: c.samples, gradStepsPerUpdate: c.epochs * c.minibatches, sampleReuse: c.epochs,
      actorParams: p.actor.params, criticParams: p.critic.params, trunkParams: p.trunk.params, totalParams: t.params,
      actorMacs: p.actor.macs, criticMacs: p.critic.macs, trunkMacs: p.trunk.macs, stepMacs: p.step, stepFlops: 2 * p.step, firstLayerMacs: p.first,
      bootstrapMacs: p.boot, rolloutMacs: p.rollout, trainMacsPerSample: p.train, backwardMacsPerSample: p.bwd, trainToForward: p.train / p.step,
      updateMacs: p.update, iterationMacs: p.iteration, iterationFlops: 2 * p.iteration, updateShare: p.update / p.iteration,
      rolloutBufferBytes: p.bufBytes, bufferFields: p.buf.map((f) => f.name), bufferBytesPerSample: p.bufBytes / c.samples,
      paramBytes: 4 * t.params, adamBytes: 8 * t.params, gradBytes: 4 * t.params,
      iterations: c.iterations, budgetSteps: c.budgetSteps, budgetMacs: c.iterations * p.iteration, budgetFlops: 2 * c.iterations * p.iteration,
      gamma: c.gamma, lambda: c.lambda, clipEps: c.clipEps, lr: c.lr, entCoef: c.entCoef, vfCoef: c.vfCoef, controlHz: c.controlHz, dt: c.dt,
      policyMsOrin: dep.ms, policyHzOrin: dep.fps, policyBoundOrin: dep.bound, policyMsH100: depH.ms,
      rolloutInferMsH100: inf.ms, estimate: true, hardwareSource: ORIN.source + ' · ' + H100.source,
      units: RL_UNITS,
    };
    if (c.paperMinutes) Object.assign(out, { paperMinutes: c.paperMinutes, paperUpdates: c.maxIterations, paperGpu: c.paperGpu,
      stepsPerSecondCited: c.samples * c.maxIterations / (60 * c.paperMinutes), paperSource: 'Rudin et al. 2021, §4 y nota 2: 1500 actualizaciones en menos de 20 minutos (RTX A6000)' });
    if (c.epochsCleanRL) out.epochsCleanRL = c.epochsCleanRL;
    if (c.desiredKl) out.desiredKl = c.desiredKl;
    const arch = archOverrides(r, 'rl-ppo');
    const row = (ov) => { const rr = A.run(r.id, Object.assign({}, arch, ov)), pp = rlParts(rr.config, rr);
      return { nEnvs: rr.config.nEnvs, horizon: rr.config.horizon, samplesPerUpdate: rr.config.samples, minibatchSize: rr.config.M, totalParams: rr.totals.params, stepMacs: pp.step,
        rolloutMacs: pp.rollout, updateMacs: pp.update, rolloutBufferBytes: pp.bufBytes }; };
    out.nEnvsScaling = guarded(() => [1, 8, 64, 512, 4096].filter((n) => (n * c.horizon) % c.minibatches === 0).map((n) => row({ nEnvs: n })));
    const hs = c.net === 'mlp' ? [c.actorHidden[0] / 2, c.actorHidden[0], 2 * c.actorHidden[0], 4 * c.actorHidden[0]] : [256, 512, 1024];
    out.hiddenScaling = guarded(() => hs.filter((h) => Number.isInteger(h)).map((h) => Object.assign({ hidden: h }, row({ hidden: h }))));
    return out;
  }
  const RL_UNITS = {
    obsDim: 'count', actDim: 'count', nEnvs: 'count', horizon: 'count', epochs: 'count', minibatches: 'count', minibatchSize: 'count', samplesPerUpdate: 'count',
    gradStepsPerUpdate: 'count', sampleReuse: 'count', actorParams: 'params', criticParams: 'params', trunkParams: 'params', totalParams: 'params',
    actorMacs: 'macs', criticMacs: 'macs', trunkMacs: 'macs', stepMacs: 'macs', stepFlops: 'count', firstLayerMacs: 'macs', bootstrapMacs: 'macs', rolloutMacs: 'macs',
    trainMacsPerSample: 'macs', backwardMacsPerSample: 'macs', trainToForward: 'ratio', updateMacs: 'macs', iterationMacs: 'macs', iterationFlops: 'count', updateShare: 'pct',
    rolloutBufferBytes: 'bytes', bufferBytesPerSample: 'bytes', paramBytes: 'bytes', adamBytes: 'bytes', gradBytes: 'bytes', iterations: 'count', budgetSteps: 'count',
    budgetMacs: 'macs', budgetFlops: 'count', gamma: 'ratio', lambda: 'ratio', clipEps: 'ratio', lr: 'ratio', entCoef: 'ratio', vfCoef: 'ratio', controlHz: 'ratio', dt: 'ratio',
    policyMsOrin: 'ms', policyHzOrin: 'ratio', policyMsH100: 'ms', rolloutInferMsH100: 'ms', paperMinutes: 'count', paperUpdates: 'count', stepsPerSecondCited: 'count',
    epochsCleanRL: 'count', desiredKl: 'ratio',
  };

  A.defineModel({
    id: 'rl-ppo',
    label: 'RL on-policy: PPO (actor-crítico, GAE)',
    paper: { title: 'Proximal Policy Optimization Algorithms', authors: 'Schulman et al.', venue: 'arXiv', year: 2017, arxiv: '1707.06347',
      note: 'GAE: Schulman et al., ICLR 2016, arXiv:1506.02438. TRPO: Schulman et al., ICML 2015, arXiv:1502.05477. Legged gym: Rudin et al., CoRL 2021, arXiv:2109.11978. Implementaciones: CleanRL (Huang et al., JMLR 2022) y rsl_rl v1.0.2.' },
    configs: RL_CONFIGS,
    knobs: { nEnvs: [1, 8, 64, 512, 4096], horizon: [16, 24, 128, 512, 2048], epochs: [1, 3, 5, 10], minibatches: [1, 4, 32], hidden: [32, 64, 128, 256, 512] },
    hardware: HW.map((h) => Object.assign({}, h)),
    applyKnobs: rlApply,
    resolve: rlResolve,
    build: rlBuild,
    quantities: rlQuantities,
    metrics: rlMetrics,
  });

  // Funciones numéricas (verificadas contra numpy y el código de CleanRL / rsl_rl en crosscheck/robotlearn.py; tolerancia 1e-9).
  // gae: rewards, values y dones [T][N] (dones[t] = 1 si el episodio terminó al LLEGAR al paso t, como `dones` de CleanRL),
  // lastValue y lastDone [N] (bootstrap del paso T). Devuelve {advantages, returns} [T][N].
  function gae(rewards, values, dones, lastValue, lastDone, gamma, lambda) {
    const T = rewards.length, N = rewards[0].length;
    const adv = Array.from({ length: T }, () => new Array(N).fill(0));
    const last = new Array(N).fill(0);
    for (let t = T - 1; t >= 0; t--) {
      for (let i = 0; i < N; i++) {
        const nonterm = t === T - 1 ? 1 - lastDone[i] : 1 - dones[t + 1][i];
        const nextV = t === T - 1 ? lastValue[i] : values[t + 1][i];
        const delta = rewards[t][i] + gamma * nextV * nonterm - values[t][i];
        last[i] = delta + gamma * lambda * nonterm * last[i];
        adv[t][i] = last[i];
      }
    }
    return { advantages: adv, returns: adv.map((row, t) => row.map((a, i) => a + values[t][i])) };
  }
  // clipObjective: pérdida de la política de PPO (lo que se MINIMIZA): mean(max(−Â·r, −Â·clip(r, 1 − ε, 1 + ε))) = −L^CLIP.
  // perSample: el término de cada muestra; clipFrac: fracción con |r − 1| > ε; zeroGrad: fracción donde el gradiente es 0 (el
  // término recortado gana el máximo con r fuera de la banda).
  function clipObjective(ratio, adv, eps) {
    const per = ratio.map((r, i) => Math.max(-adv[i] * r, -adv[i] * Math.min(Math.max(r, 1 - eps), 1 + eps)));
    const clipped = ratio.filter((r) => Math.abs(r - 1) > eps).length;
    const zero = ratio.filter((r, i) => (adv[i] > 0 && r > 1 + eps) || (adv[i] < 0 && r < 1 - eps)).length;
    return { loss: per.reduce((s, x) => s + x, 0) / per.length, perSample: per, clipFrac: clipped / ratio.length, zeroGradFrac: zero / ratio.length };
  }
  // valueLoss: crítico de CleanRL con clip_vloss (vf = 0.5) o de rsl_rl (sin el ½): coef·mean(max((V − R)², (V_old + clip(V − V_old, ±ε) − R)²)).
  function valueLoss(newV, oldV, returns, eps, half) {
    const per = newV.map((v, i) => { const vc = oldV[i] + Math.min(Math.max(v - oldV[i], -eps), eps); return Math.max((v - returns[i]) ** 2, (vc - returns[i]) ** 2); });
    return (half ? 0.5 : 1) * per.reduce((s, x) => s + x, 0) / per.length;
  }
  // normalizeAdv: (Â − media)/(desviación + 1e-8) con la desviación muestral (torch.std, n − 1), como CleanRL y rsl_rl.
  function normalizeAdv(adv) {
    const n = adv.length, m = adv.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(adv.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
    return adv.map((x) => (x - m) / (sd + 1e-8));
  }
  // ppoUpdateCost: costo de una iteración de PPO (MACs) a partir del forward por observación (stepMacs), los MACs de las capas que
  // leen la observación (sin gradiente de entrada) y los MACs del crítico (+ tronco) del bootstrap. Exacto para MLP/CNN sin capas
  // con gradiente de entrada nulo en el medio (verificado con FlopCounterMode en el crosscheck).
  function ppoUpdateCost(o) {
    const train = 3 * o.stepMacs - o.firstMacs, rollout = o.nEnvs * o.horizon * o.stepMacs + o.nEnvs * o.bootMacs;
    const update = o.epochs * o.nEnvs * o.horizon * train;
    return { trainMacsPerSample: train, rolloutMacs: rollout, updateMacs: update, iterationMacs: rollout + update };
  }

  // ============================================================== imitation
  // ResNet-18 de torchvision (BasicBlock, [2, 2, 2, 2]) como ops elementales, sin avgpool ni fc. o = {base: path, norm: 'frozen'|'group',
  // rep, prep, where}. Devuelve la salida de layer4 (c5).
  const ceilSym = (H, d, s) => (H % d === 0 ? s + '/' + d : '⌈' + s + '/' + d + '⌉');
  function r18Ops(g, x, c, o) {
    const B = o.base, rep = o.rep, prep = o.prep, where = o.where;
    const op = (id, res, path, extra) => g.op('bb-' + id, res, Object.assign({ path: B.concat(path), out: 'bb-' + id, repeat: rep, paramRepeat: prep, where }, extra));
    const nm = (t) => (o.norm === 'group' ? A.group_norm(t, { groups: t.num[2] / 16 }) : A.frozen_batchnorm2d(t));
    const nLab = o.norm === 'group' ? 'GroupNorm (C/16 grupos)' : 'FrozenBatchNorm';
    const H = c.H, W = c.W;
    const sz = (d) => [ceilSym(H, d, 'H'), ceilSym(W, d, 'W')];
    const L = (m) => Object.assign({}, m, { label: 'Backbone · ' + m.label });
    const conv = (t, k, s, p, cout, d) => A.conv2d(t, { k, s, p, cout, coutSym: String(cout), bias: false, floor: true, outSym: sz(d) });
    let h = op('stem-conv', conv(x, 7, 2, 3, 64, 2), ['stem', 'conv'], { label: 'Conv 7×7, stride 2 (sin sesgo)', type: 'conv', group: 'embed', outMeta: L({ label: 'stem: conv 7×7', tex: 'W*x' }) });
    h = op('stem-norm', nm(h), ['stem', 'norm'], { label: nLab, type: 'norm', group: 'norm', outMeta: L({ label: 'stem: normalizada', tex: '\\mathrm{N}' }) });
    h = op('stem-relu', A.relu(h), ['stem', 'relu'], { label: 'ReLU', type: 'tensorop', group: 'act', outMeta: L({ label: 'salida del stem (stride 2)', tex: 'h_{stem}' }) });
    h = g.op('bb-maxpool', A.maxpool2d(h, { k: 3, s: 2, p: 1, outSym: sz(4) }), { path: B.concat(['maxpool']), out: 'bb-pool', repeat: rep, paramRepeat: prep, where,
      label: 'Max pooling 3×3, stride 2', type: 'tensorop', group: 'embed', outMeta: L({ label: 'entrada de layer1 (stride 4)', tex: 'h_0' }) });
    const widths = [64, 128, 256, 512];
    let d = 4;
    for (let k = 1; k <= 4; k++) {
      const w = widths[k - 1];
      for (let j = 1; j <= 2; j++) {
        const s = k > 1 && j === 1 ? 2 : 1;
        if (s === 2) d *= 2;
        const P = ['layer' + k, 'l' + k + '-b' + j], pre = 'l' + k + '-b' + j + '-';
        const lb = 'layer' + k + ' · bloque ' + j + ': ';
        let y = op(pre + 'conv1', conv(h, 3, s, 1, w, d), P.concat(['conv1']), { label: 'Conv 3×3' + (s > 1 ? ', stride 2' : '') + ' → ' + w, type: 'conv', group: 'embed', outMeta: L({ label: lb + 'conv 1', tex: 'W_1*h' }) });
        y = op(pre + 'norm1', nm(y), P.concat(['norm1']), { label: nLab, type: 'norm', group: 'norm', outMeta: L({ label: lb + 'norma 1', tex: '\\mathrm{N}' }) });
        y = op(pre + 'relu1', A.relu(y), P.concat(['relu1']), { label: 'ReLU', type: 'tensorop', group: 'act', outMeta: L({ label: lb + 'ReLU 1', tex: '\\mathrm{ReLU}' }) });
        y = op(pre + 'conv2', conv(y, 3, 1, 1, w, d), P.concat(['conv2']), { label: 'Conv 3×3 → ' + w, type: 'conv', group: 'embed', outMeta: L({ label: lb + 'conv 2', tex: 'W_2*\\cdot' }) });
        y = op(pre + 'norm2', nm(y), P.concat(['norm2']), { label: nLab, type: 'norm', group: 'norm', outMeta: L({ label: lb + 'norma 2', tex: '\\mathrm{N}' }) });
        let sc = h;
        if (s === 2) {
          sc = op(pre + 'down', conv(h, 1, 2, 0, w, d), P.concat(['down']), { label: 'Atajo: conv 1×1, stride 2 (proyección)', type: 'conv', group: 'embed', outMeta: L({ label: lb + 'atajo proyectado', tex: 'W_s*h' }) });
          sc = op(pre + 'down-norm', nm(sc), P.concat(['down-norm']), { label: nLab + ' del atajo', type: 'norm', group: 'norm', outMeta: L({ label: lb + 'atajo normalizado', tex: '\\mathrm{N}(W_s*h)' }) });
        }
        y = op(pre + 'add', A.residual_add(sc, y), P.concat(['add']), { label: 'Suma residual', type: 'tensorop', group: 'resid', outMeta: L({ label: lb + 'F(h) + atajo', tex: 'F(h)+h' }) });
        const last = j === 2;
        h = g.op('bb-' + pre + 'relu2', A.relu(y), { path: B.concat(P.concat(['relu2'])), out: last ? 'c' + (k + 1) : 'bb-' + pre + 'relu2', repeat: rep, paramRepeat: prep, where,
          label: 'ReLU', type: 'tensorop', group: 'resid', outMeta: L(last ? { label: 'C' + (k + 1) + ' (salida de layer' + k + ', stride ' + d + ')', tex: 'C_' + (k + 1) } : { label: lb + 'salida', tex: 'h' }) });
      }
    }
    return h;
  }

  // ---- atención multi-cabeza y capas (post-LN de DETR / ACT; pre-LN de nn.TransformerDecoderLayer de DP-T)
  function mhaOps(g, s) {
    const { pre, P, rep, where, tl } = s;
    const L = (m) => Object.assign({ perLayer: rep > 1 }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, paramRepeat: s.prep != null ? s.prep : rep, where }, extra));
    const D = s.qIn.num[1];
    const qp = op('q-proj', A.linear(s.qIn, { dout: D, doutSym: 'D' }), 'q-proj', { out: pre + 'qp', label: 'Proyección W_Q' + (s.qNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'Q proyectada', tex: 'Q' }) });
    const kp = op('k-proj', A.linear(s.kIn, { dout: D, doutSym: 'D' }), 'k-proj', { out: pre + 'kp', label: 'Proyección W_K' + (s.kNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'K proyectada', tex: 'K' }) });
    const vp = op('v-proj', A.linear(s.vIn, { dout: D, doutSym: 'D' }), 'v-proj', { out: pre + 'vp', label: 'Proyección W_V' + (s.vNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'V proyectada', tex: 'V' }) });
    const [q, k, v] = op('split', A.split_qkv_heads(qp, kp, vp, { h: s.h }), 'split', { out: [pre + 'q', pre + 'k', pre + 'v'], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Queries por cabeza', tex: 'Q' }), L({ label: 'Keys por cabeza', tex: 'K' }), L({ label: 'Values por cabeza', tex: 'V' })] });
    const sc = op('scores', A.attention_scores(q, k), 'scores', { out: pre + 'scores', label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const ss = op('scale', A.scale(sc, { causal: !!s.causal }), 'scale', { out: pre + 'scores-scaled', label: s.causal ? 'Escala 1/√d_h + máscara causal' : 'Escala 1/√d_h', type: 'attn', group: 'attn',
      outMeta: L({ label: s.causal ? 'Scores escalados y enmascarados' : 'Scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const a = op('softmax', A.softmax(ss), 'softmax', { out: pre + 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), 'weighted-sum', { out: pre + 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: 'D' }), 'merge', { out: pre + 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    return op('proj', A.linear(z, { dout: D, doutSym: 'D' }), 'proj', { out: pre + 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'Salida de la atención', tex: 'O' }) });
  }
  function ffnOps(g, x, s) {
    const { pre, P, rep, where, tl } = s;
    const L = (m) => Object.assign({ perLayer: rep > 1 }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat(['ffn', node]), repeat: rep, paramRepeat: s.prep != null ? s.prep : rep, where }, extra));
    const gelu = s.act === 'gelu';
    const u = op('fc1', A.linear(x, { dout: s.Dmlp, doutSym: 'D_mlp' }), 'fc1', { out: pre + 'u', label: 'FFN: capa 1 (expansión a ' + s.Dmlp + ')', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta de la FFN', tex: 'U' }) });
    const gg = op(gelu ? 'gelu' : 'relu', gelu ? A.gelu(u) : A.relu(u), gelu ? 'gelu' : 'relu', { out: pre + 'g', label: gelu ? 'GELU' : 'ReLU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación', tex: gelu ? '\\mathrm{GELU}(U)' : '\\mathrm{ReLU}(U)' }) });
    return op('fc2', A.linear(gg, { dout: x.num[1], doutSym: 'D' }), 'fc2', { out: pre + 'f', label: 'FFN: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida de la FFN', tex: 'F' }) });
  }
  // Capa del encoder post-LN (DETR / ACT): Q y K desde x + pos, V desde x. pre = prefijo de ids ('e-' o 'ce-').
  function postEncLayer(g, x, pos, s) {
    const P = s.P, rep = s.rep, pre = s.pre, tl = s.tl;
    const L = (m) => Object.assign({ perLayer: rep > 1 }, m, { label: tl + m.label });
    const op = (id, res, path, extra) => g.op(pre + id, res, Object.assign({ path, repeat: rep, where: s.where }, extra));
    const qk = op('add-pos', A.add(x, pos), P.concat(['add-pos']), { out: pre + 'qk-in', label: 'Suma de posición (solo para Q y K)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'entrada de Q y K (x + pos)', tex: 'x + p' }) });
    const o = mhaOps(g, { pre, P: P.concat(['self-attn']), rep, where: s.where, tl: tl + 'self-attention · ', h: s.h, qIn: qk, kIn: qk, vIn: x, qNote: ' (desde x + pos)', kNote: ' (desde x + pos)', vNote: ' (desde x)' });
    const r1 = op('res1', A.residual_add(x, o), P.concat(['res1']), { out: pre + 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: 'x + O' }) });
    const n1 = op('ln1', A.layernorm(r1), P.concat(['ln1']), { out: pre + 'ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "x'" }) });
    const f = ffnOps(g, n1, { pre, P, rep, where: s.where, tl: tl + 'FFN · ', Dmlp: s.Dmlp });
    const r2 = op('res2', A.residual_add(n1, f), P.concat(['res2']), { out: pre + 'r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "x' + FFN", tex: "x' + F" }) });
    return op('ln2', A.layernorm(r2), P.concat(['ln2']), { out: s.outId, label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm', outMeta: s.outMeta });
  }
  // Capa del decoder post-LN (DETR / ACT): self-attention de las queries, cross-attention a la memoria, FFN.
  function postDecLayer(g, tgt, qpos, memory, pos, s) {
    const P = ['decoder', 'dec-layer'], rep = s.rep, tl = 'Decoder · ', WL = ['Decoder'];
    const L = (m, pre) => Object.assign({ perLayer: rep > 1 }, m, { label: (pre || tl) + m.label });
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: rep, where: WL }, extra));
    const qk = op('d-add-qpos', A.add(tgt, qpos), P.concat(['add-qpos']), { out: 'd-qk-in', label: 'Suma de query_pos (Q y K de la self-attention)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'self-attention · entrada de Q y K', tex: 't + q_{pos}' }) });
    const so = mhaOps(g, { pre: 'd-self-', P: P.concat(['self-attn']), rep, where: ['Decoder', 'self-attention'], tl: tl + 'self-attention · ', h: s.h, qIn: qk, kIn: qk, vIn: tgt });
    const r1 = op('d-res1', A.residual_add(tgt, so), P.concat(['res1']), { out: 'd-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'tgt + self-attention', tex: 't + O' }) });
    const n1 = op('d-ln1', A.layernorm(r1), P.concat(['ln1']), { out: 'd-ln1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "t'" }) });
    const C = P.concat(['cross-attn']), tc = tl + 'cross-attention · ', WC = ['Decoder', 'cross-attention'];
    const cq = op('d-cross-add-qpos', A.add(n1, qpos), C.concat(['add-qpos']), { out: 'd-cross-q-in', where: WC, label: 'Suma de query_pos (Q de la cross-attention)', type: 'tensorop', group: 'embed', outMeta: L({ label: "entrada de Q (t' + query_pos)", tex: "t' + q_{pos}" }, tc) });
    const ck = op('d-cross-add-pos', A.add(memory, pos), C.concat(['add-pos']), { out: 'd-cross-k-in', where: WC, label: 'Suma de posición a la memoria (solo para K)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'entrada de K (memoria + pos)', tex: 'M + p' }, tc) });
    const co = mhaOps(g, { pre: 'd-cross-', P: C, rep, where: WC, tl: tc, h: s.h, qIn: cq, kIn: ck, vIn: memory, qNote: ' (desde las queries)', kNote: ' (desde la memoria + pos)', vNote: ' (desde la memoria)' });
    const r2 = op('d-res2', A.residual_add(n1, co), P.concat(['res2']), { out: 'd-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "t' + cross-attention", tex: "t' + O" }) });
    const n2 = op('d-ln2', A.layernorm(r2), P.concat(['ln2']), { out: 'd-ln2', label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 2', tex: "t''" }) });
    const f = ffnOps(g, n2, { pre: 'd-', P, rep, where: ['Decoder', 'FFN'], tl: tl + 'FFN · ', Dmlp: s.Dmlp });
    const r3 = op('d-res3', A.residual_add(n2, f), P.concat(['res3']), { out: 'd-r3', label: 'Residual 3', type: 'tensorop', group: 'resid', outMeta: L({ label: "t'' + FFN", tex: "t'' + F" }) });
    return op('d-ln3', A.layernorm(r3), P.concat(['ln3']), { out: 'd-out', label: 'LayerNorm 3 (post-LN)', type: 'norm', group: 'norm',
      outMeta: { label: 'Decoder · salida de cada capa', tex: 't_\\ell', perLayer: false, note: 'Salida de cada capa del decoder (entrada de la siguiente). Con return_intermediate_dec cada una pasa por dec-norm y el código usa la de la capa 1.' } });
  }
  // Parámetros de una capa post-LN del encoder (MHA 4D² + 4D, FFN 2·D·F + F + D, 2 LayerNorm): para el CVAE sin uso en inferencia.
  const encLayerParams = (D, F) => 4 * D * D + 4 * D + 2 * D * F + F + D + 4 * D;

  const ACT_SRC = 'Zhao et al., Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware (ACT / ALOHA), RSS 2023, arXiv:2304.13705 (Tabla III: lr 1e-5, batch 8, 4 capas de encoder, 7 de decoder, FFN 3200, D 512, 8 cabezas, chunk 100, β 10, dropout 0.1; §IV-B: 4 cámaras 480×640 → 15×20×512 cada una, 1202 tokens, 14 articulaciones, ~80 M parámetros, ~0.01 s de inferencia en una RTX 2080 Ti; 50 Hz). Código tonyzhaozh/act (742c753): imitate_episodes.py (enc_layers 4, dec_layers 7, nheads 8, state_dim 14, backbone resnet18; temporal ensembling k = 0.01), README (--kl_weight 10 --chunk_size 100 --hidden_dim 512 --dim_feedforward 3200), detr/models/detr_vae.py (UN backbone para todas las cámaras: self.backbones[0]; latent_dim 32; CVAE con cls, proyecciones de acción y articulaciones, encoder de enc_layers capas), transformer.py (post-LN, ReLU, return_intermediate_dec), backbone.py (resnet18 con FrozenBatchNorm2d, sin fc).';
  const DP_SRC = 'Chi et al., Diffusion Policy: Visuomotor Policy Learning via Action Diffusion, RSS 2023 / IJRR 2024, arXiv:2303.04137; repo real-stanford/diffusion_policy (5ba07ac): ';
  const IM_BASE = { cams: 4, res: 480, actionDim: 14, stateDim: 14, controlHz: 50 };
  const IM_CONFIGS = {
    'act-aloha': Object.assign({}, IM_BASE, { label: 'ACT · ALOHA (4 cámaras 480×640, chunk 100)', canonical: true, family: 'act', train: false, D: 512, h: 8, Dmlp: 3200, Lenc: 4, Ldec: 7,
      latent: 32, chunk: 100, klWeight: 10, temporalAgg: true, ensembleM: 0.01, norm: 'frozen', sharedBackbone: true, demos: 50, episodeSteps: [400, 700], batch: 8, paperParamsM: 80, paperLatencyMs: 10, source: ACT_SRC }),
    'act-aloha-train': Object.assign({}, IM_BASE, { label: 'ACT · ALOHA, paso de entrenamiento (con el encoder CVAE)', family: 'act', train: true, D: 512, h: 8, Dmlp: 3200, Lenc: 4, Ldec: 7,
      latent: 32, chunk: 100, klWeight: 10, temporalAgg: true, ensembleM: 0.01, norm: 'frozen', sharedBackbone: true, demos: 50, episodeSteps: [400, 700], batch: 8, paperParamsM: 80, paperLatencyMs: 10,
      source: ACT_SRC + ' Forward de entrenamiento: el encoder CVAE lee [CLS; articulaciones; k acciones] y predice μ, log σ² de z (32); L = L1 + β·KL.' }),
    'diffusion-policy-cnn': { label: 'Diffusion Policy · CNN (U-Net 1-D, Push-T real, 2 cámaras)', family: 'dp-cnn', cams: 2, res: 216, rawH: 240, rawW: 320, actionDim: 2, lowDim: 2, controlHz: 10,
      obsSteps: 2, chunk: 16, executed: 8, steps: 8, trainSteps: 100, scheduler: 'DDIM', betaSchedule: 'squaredcos_cap_v2', tEmbed: 128, downDims: [256, 512, 1024], kernel: 5, groups: 8,
      kp: 32, camFeat: 64, norm: 'group', sharedBackbone: false, demos: 136, batch: 64, paperDParamsM: 67, paperVParamsM: 22, paperSteps: 16, paperExecuted: 6, paperLatencyMs: 100, paperLatencySteps: 10,
      source: DP_SRC + 'diffusion_policy/config/train_diffusion_unet_real_hybrid_workspace.yaml (horizon 16, n_obs_steps 2, n_action_steps 8, DDIMScheduler con 100 pasos de entrenamiento y num_inference_steps 8, crop 216×288, diffusion_step_embed_dim 128, down_dims [256, 512, 1024], kernel_size 5, n_groups 8, cond_predict_scale, obs_encoder_group_norm) + task/real_pusht_image.yaml (camera_1 y camera_3 de 240×320, robot_eef_pose 2, acción 2); model/diffusion/conditional_unet1d.py; encoder de robomimic 0.2.0 (VisualCore: ResNet18Conv + SpatialSoftmax num_kp 32 + Linear 64 → 64, ReLU de ObservationEncoder). Paper: Tabla 7 (Real Push-T: T_o 2, T_a 6, T_p 16, 67 M de difusión + 22 M de visión, DDIM 16 pasos), §3.4 (10 pasos DDIM → 0.1 s en una RTX 3080), control a 10 Hz.' },
    'diffusion-policy-transformer': { label: 'Diffusion Policy · Transformer (8 capas, n_emb 256)', family: 'dp-transformer', cams: 2, res: 216, rawH: 240, rawW: 320, actionDim: 2, lowDim: 2, controlHz: 10,
      obsSteps: 2, chunk: 16, executed: 8, steps: 8, trainSteps: 100, scheduler: 'DDIM', betaSchedule: 'squaredcos_cap_v2', D: 256, h: 4, Ldec: 8, Dmlp: 1024, causal: true,
      kp: 32, camFeat: 64, norm: 'group', sharedBackbone: false, demos: 136, batch: 64, paperDParamsM: 80, paperEmb: 768, paperSteps: 16,
      source: DP_SRC + 'diffusion_policy/config/train_diffusion_transformer_real_hybrid_workspace.yaml (n_layer 8, n_head 4, n_emb 256, n_cond_layers 0 → MLP 256 → 1024 → 256 con Mish, causal_attn, time_as_cond, obs_as_cond; mismo encoder y DDIM 8 pasos); model/diffusion/transformer_for_diffusion.py (nn.TransformerDecoderLayer pre-LN, GELU, FFN 4·n_emb). Paper Tabla 8 (Real Push-T: 8 capas, emb 768, 80 M): no coincide con el YAML; el calculador sigue al YAML.' },
    'bc-mlp': Object.assign({}, IM_BASE, { label: 'BC · ConvMLP (línea base del paper de ACT, 4 cámaras)', family: 'bc', chunk: 1, norm: 'frozen', sharedBackbone: false, hidden: 1024,
      source: 'Línea base BC-ConvMLP de Zhao et al. 2023 (§V, "la más simple y más usada"): CNNMLP de tonyzhaozh/act detr/models/detr_vae.py (un ResNet-18 POR cámara con FrozenBatchNorm2d; down_proj por cámara Conv2d 5×5 512 → 128 → 64 → 32 sin activaciones: 15×20 → 3×8 = 768; mlp(768·cams + 14, 1024, 14, hidden_depth 2) con ReLU; action_head Linear(1000, 14) definido y sin uso). Con chunking (Fig. 6a del paper) la salida pasa a k·14.' }),
  };

  function imApply(c, ov) {
    const notes = [];
    if (ov.chunk !== undefined) { c.chunk = ov.chunk; notes.push('chunk = ' + ov.chunk + ' (what-if)'); }
    if (ov.cams !== undefined) { c.cams = ov.cams; notes.push('cams = ' + ov.cams + ' (what-if)'); }
    if (ov.res !== undefined) { c.res = ov.res; notes.push('res = ' + ov.res + ' (what-if: imagen de ' + ov.res + '×' + Math.round(4 * ov.res / 3) + ')'); }
    if (ov.steps !== undefined) {
      if (!/^dp/.test(c.family)) throw new Error('El knob steps (pasos de denoising) solo aplica a Diffusion Policy.');
      if (ov.steps > c.trainSteps) throw new Error('steps = ' + ov.steps + ': DDIM no puede usar más pasos que los ' + c.trainSteps + ' de entrenamiento.');
      c.steps = ov.steps; notes.push('steps = ' + ov.steps + ' (what-if)');
    }
    c._notes = notes;
    return c;
  }
  function imResolve(c) {
    const W = 'Imitation: ';
    if ((4 * c.res) % 3 !== 0) throw new Error(W + 'res = ' + c.res + ' no da un ancho entero con aspecto 4:3 (usa un múltiplo de 3).');
    c.H = c.res; c.W = 4 * c.res / 3;
    if (c.H < 64) throw new Error(W + 'la resolución mínima es 64.');
    // Mapa de layer4 (stride 32 con redondeo hacia arriba de las convs 3×3 s2 p1 y del maxpool).
    const down = (n) => Math.floor((n + 2 - 3) / 2) + 1;
    const after = (n) => { let x = Math.floor((n + 6 - 7) / 2) + 1; x = down(x); for (let i = 0; i < 3; i++) x = down(x); return x; };
    c.fh = after(c.H); c.fw = after(c.W);
    if (c.family === 'act') {
      c.Nimg = c.cams * c.fh * c.fw; c.N = c.Nimg + 2; c.tokens = c.N; c.dh = c.D / c.h; c.executed = c.temporalAgg ? 1 : c.chunk;
      if (c.D % c.h !== 0) throw new Error(W + 'D no es divisible por h.');
    } else if (c.family === 'bc') {
      const d5 = (n) => n - 4;
      c.ph = d5(d5(d5(c.fh))); c.pw = d5(d5(d5(c.fw)));
      if (c.ph < 1 || c.pw < 1) throw new Error(W + 'la imagen es muy chica para las tres convs 5×5 del CNNMLP (mapa ' + c.fh + '×' + c.fw + ').');
      c.camFlat = 32 * c.ph * c.pw; c.mlpIn = c.camFlat * c.cams + c.stateDim; c.executed = c.chunk; c.tokens = 1;
    } else {
      if (c.executed + c.obsSteps - 1 > c.chunk) throw new Error(W + 'chunk T_p = ' + c.chunk + ' < T_o − 1 + T_a = ' + (c.obsSteps - 1 + c.executed) + ' (las acciones ejecutadas no caben).');
      if (c.family === 'dp-cnn' && c.chunk % 4 !== 0) throw new Error(W + 'la U-Net 1-D baja dos veces ×2: T_p = ' + c.chunk + ' debe ser múltiplo de 4.');
      c.obsFeat = c.camFeat * c.cams + c.lowDim; c.globalCond = c.obsFeat * c.obsSteps; c.tokens = c.chunk;
      if (c.family === 'dp-cnn') c.condDim = c.tEmbed + c.globalCond;
      else { c.dh = c.D / c.h; c.condTokens = 1 + c.obsSteps; }
    }
    c.inferenceHz = c.controlHz / c.executed;
    return c;
  }

  function imBuild(c) {
    const g = A.graph(c);
    if (c.family === 'act') return actBuild(c, g);
    if (c.family === 'bc') return bcBuild(c, g);
    return dpBuild(c, g);
  }

  function actBuild(c, g) {
    const cams = c.cams, k = c.chunk, D = c.D;
    const WB = ['Backbone ResNet-18 (compartido por las ' + cams + ' cámaras)'];
    const img = g.input('img', shp(['H', 'W', '3'], [c.H, c.W, 3], 'img', 'grid'), { label: 'Imagen de UNA cámara (' + c.H + '×' + c.W + '; hay ' + cams + ')', tex: 'I_c' });
    const nimg = g.op('normalize', A.normalize_pixels(img, { stats: 'ImageNet' }), { path: ['normalize'], out: 'img-norm', repeat: cams, paramRepeat: 1, label: 'Normalizar (media y desviación de ImageNet)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Imagen normalizada', tex: '(I - \\mu)/\\sigma' } });
    const c5 = r18Ops(g, nimg, c, { base: ['backbone'], norm: 'frozen', rep: cams, prep: 1, where: WB });
    const hw = [ceilSym(c.H, 32, 'H'), ceilSym(c.W, 32, 'W')];
    const feat = g.op('input-proj', A.conv2d(c5, { k: 1, cout: D, coutSym: 'D', bias: true, outSym: hw }), { path: ['input-proj'], out: 'feat', repeat: cams, paramRepeat: 1,
      label: 'Conv 1×1: 512 → D = ' + D + ' (por cámara)', type: 'conv', group: 'embed', outMeta: { label: 'Rasgos de una cámara (' + c.fh + '×' + c.fw + '×' + D + ')', tex: 'F_c' } });
    const fseq = g.op('cam-flatten', A.flatten(feat, { sym: ['H/32·W/32', 'D'] }), { path: ['cam-concat'], out: 'feat-seq', repeat: cams, paramRepeat: 1, label: 'Aplanar la rejilla', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Tokens de una cámara', tex: 'F_c' } });
    const posc = g.op('pos-enc', A.sine_pos_encoding({ H: c.fh, W: c.fw, D, rowsSym: 'H/32·W/32' }), { path: ['pos-enc'], out: 'pos-cam', repeat: cams, paramRepeat: 1,
      label: 'PE seno/coseno 2-D (buffer)', type: 'embed', group: 'embed', outMeta: { label: 'Posición 2-D de una cámara', tex: 'p_c' } });
    const catOut = [shp(['N_img', 'D'], [c.Nimg, D], 'img', 'seq'), shp(['N_img', 'D'], [c.Nimg, D], 'img', 'seq')];
    const [itok, ipos] = g.op('cam-concat', ext('concat_cameras', [fseq, posc], catOut, { detail: { cams, note: 'torch.cat(…, axis=3): las cámaras se pegan a lo ANCHO (' + c.fh + '×' + cams * c.fw + ') y se aplanan' } }), {
      path: ['cam-concat'], out: ['img-tokens', 'img-pos'], label: 'Concatenar las ' + cams + ' cámaras a lo ancho → ' + fint(c.Nimg) + ' tokens', type: 'tensorop', group: 'embed',
      outMeta: [{ label: 'Tokens de imagen de todas las cámaras', tex: 'F' }, { label: 'Posiciones de esos tokens', tex: 'p' }] });
    const qpos = g.input('qpos', shp(['14'], [c.stateDim], 'act', 'vec'), { label: 'Posición de las 14 articulaciones (2 brazos × 7)', tex: 'q_t' });
    const prop = g.op('proprio-proj', A.linear(qpos, { dout: D, doutSym: 'D' }), { path: ['proprio-proj'], out: 'proprio-tok', label: 'Linear 14 → D (articulaciones)', type: 'embed', group: 'embed',
      outMeta: { label: 'Token de las articulaciones', tex: 'W_q q_t' } });
    let z;
    if (c.train) z = cvaeOps(g, c, qpos);
    else z = g.op('latent-z', ext('zeros_init', [], shp(['d_z'], [c.latent], 'lat', 'vec'), { detail: { note: 'en inferencia z = 0: la media del prior N(0, I)' } }), { path: ['latent'], out: 'z',
      label: 'z = 0 (inferencia: la media del prior)', type: 'tensorop', group: 'embed', outMeta: { label: 'Variable de estilo z (32; ceros en inferencia)', tex: 'z' } });
    const ztok = g.op('latent-proj', A.linear(z, { dout: D, doutSym: 'D' }), { path: ['latent-proj'], out: 'latent-tok', label: 'Linear 32 → D (latente)', type: 'embed', group: 'embed',
      outMeta: { label: 'Token del latente z', tex: 'W_z z' } });
    const epos = g.op('extra-pos', A.pos_embed_learned({ rows: 2, rowsSym: '2', D, mod: 'lat' }), { path: ['extra-pos'], out: 'extra-pos', label: 'Posición aprendida de los 2 tokens extra', type: 'embed', group: 'embed',
      outMeta: { label: 'Posición de [z; articulaciones] (aprendida)', tex: 'p_{extra}' } });
    if (!c.train) g.op('cvae-idle', A.idle_params({ paramTerms: [[D], [14, D], [D], [14, D], [D], [D, 2 * c.latent], [2 * c.latent], [c.Lenc, encLayerParams(D, c.Dmlp)]],
      paramTex: 'D + 2(14D + D) + 2Dd_z + 2d_z + L_{enc}(\\ldots)', what: 'encoder CVAE de ACT (cls, proyecciones de acción y articulaciones, ' + c.Lenc + ' capas, latent_proj): solo se usa al entrenar' }), {
      path: ['cvae'], out: [], in: [], label: 'Sin uso en inferencia: el encoder CVAE', type: 'embed', group: 'embed' });
    const src = g.op('tokens', A.stack_rows([ztok, prop, itok], { sym: 'N', mod: 'img' }), { path: ['tokens'], out: 'src', label: 'Secuencia del encoder: [z; articulaciones; ' + fint(c.Nimg) + ' tokens de imagen]', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Entrada del encoder (' + fint(c.N) + ' tokens)', tex: 'X' } });
    const spos = g.op('tokens-pos', A.concat_tokens(epos, ipos, { sym: 'N' }), { path: ['tokens'], out: 'src-pos', label: 'Posiciones de los N tokens', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Posición de cada token del encoder', tex: 'P' } });
    const mem = postEncLayer(g, src, spos, { P: ['encoder', 'enc-layer'], rep: c.Lenc, pre: 'e-', tl: 'Encoder · ', where: ['Encoder'], h: c.h, Dmlp: c.Dmlp, outId: 'memory',
      outMeta: { label: 'Memoria del encoder (salida de la capa ' + c.Lenc + ')', tex: 'M', perLayer: false, note: 'Salida de cada capa; tras la última es la memoria que leen K y V del decoder.' } });
    const qp = g.op('query-embed', A.learned_queries({ Q: k, D, Qsym: 'k' }), { path: ['queries'], out: 'query-pos', label: 'k = ' + k + ' queries aprendidas (una por acción del chunk)', type: 'embed', group: 'embed',
      outMeta: { label: 'Queries de posición (k×D)', tex: 'q_{pos}' } });
    const t0 = g.op('tgt-init', A.zeros_init({ rows: k, rowsSym: 'k', D }), { path: ['queries'], out: 'tgt0', label: 'Entrada del decoder = ceros', type: 'tensorop', group: 'embed',
      outMeta: { label: 'tgt inicial (ceros)', tex: 't_0' } });
    const dout = postDecLayer(g, t0, qp, mem, spos, { rep: c.Ldec, h: c.h, Dmlp: c.Dmlp });
    const hs = g.op('dec-norm', A.layernorm(dout), { path: ['dec-norm'], out: 'hs', label: 'LayerNorm del decoder (el código usa la salida de la capa 1)', type: 'norm', group: 'norm',
      outMeta: { label: 'Salida del decoder (k×D)', tex: 'h', note: 'return_intermediate_dec = True y hs[0]: las cabezas leen la salida (normalizada) de la PRIMERA capa; las otras ' + (c.Ldec - 1) + ' se calculan y no se usan.' } });
    const acts = g.op('action-head', A.linear(hs, { dout: c.actionDim, doutSym: '14' }), { path: ['action-head'], out: 'actions', label: 'Linear D → 14: el chunk de k acciones', type: 'head', group: 'head',
      outMeta: { label: 'Chunk de k = ' + k + ' acciones (posiciones objetivo de las 14 articulaciones)', tex: '\\hat a_{t:t+k}' } });
    g.op('is-pad-head', A.linear(hs, { dout: 1, doutSym: '1' }), { path: ['is-pad-head'], out: 'is-pad', label: 'Linear D → 1: ¿relleno? (pasado el fin del episodio)', type: 'head', group: 'head',
      outMeta: { label: 'Logit de relleno por acción', tex: '\\widehat{pad}' } });
    if (c.train) {
      const aseq = g.tensor('action-seq');
      const l1 = g.op('l1-loss', A.l1_loss(acts, aseq), { path: ['loss', 'l1'], out: 'loss-l1', label: 'L1 entre el chunk predicho y el demostrado (sin el relleno)', type: 'head', group: 'head', outMeta: { label: 'Pérdida de reconstrucción L1', tex: 'L_{rec}' } });
      const kl = g.op('kl-loss', A.kl_gaussian(g.tensor('mu'), g.tensor('logvar')), { path: ['loss', 'kl'], out: 'loss-kl', label: 'KL(q(z|a, q) ‖ N(0, I))', type: 'head', group: 'head', outMeta: { label: 'Pérdida KL del CVAE', tex: 'L_{reg}' } });
      g.op('total-loss', A.loss_sum([l1, kl], { coefs: [1, c.klWeight], formula: 'L = L1 + β·KL' }), { path: ['loss', 'total'], out: 'loss', label: 'L = L1 + β·KL (β = ' + c.klWeight + ')', type: 'head', group: 'head',
        outMeta: { label: 'Pérdida total', tex: 'L' } });
    } else {
      g.op('ensemble', A.temporal_ensemble(acts, { m: c.ensembleM }), { path: ['ensemble'], out: 'action', label: 'Temporal ensembling: promedio exp(−' + c.ensembleM + '·i) de los chunks que cubren t', type: 'tensorop', group: 'head',
        outMeta: { label: 'Acción que se envía al robot (14)', tex: 'a_t' } });
    }
    return g;
  }
  // CVAE de ACT (solo act-aloha-train): [CLS; articulaciones; k acciones] → encoder de L_enc capas → CLS → μ, log σ² → z.
  function cvaeOps(g, c, qpos) {
    const D = c.D, k = c.chunk, WV = ['Encoder CVAE (solo entrenamiento)'];
    const aseq = g.input('action-seq', shp(['k', '14'], [k, c.actionDim], 'act', 'seq'), { label: 'Chunk demostrado: las k acciones siguientes del dataset', tex: 'a_{t:t+k}' });
    const cls = g.op('cvae-cls', A.learned_tokens({ rows: 1, rowsSym: '1', D, kinds: ['CLS'] }), { path: ['cvae', 'cvae-in'], out: 'cvae-cls-tok', where: WV, label: 'Token [CLS] aprendido', type: 'embed', group: 'embed',
      outMeta: { label: '[CLS] del CVAE', tex: 'x_{cls}' } });
    const qt = g.op('cvae-qpos-proj', A.linear(qpos, { dout: D, doutSym: 'D' }), { path: ['cvae', 'cvae-in'], out: 'cvae-qpos-tok', where: WV, label: 'Linear 14 → D (articulaciones)', type: 'embed', group: 'embed',
      outMeta: { label: 'Token de articulaciones del CVAE', tex: 'W q_t' } });
    const at = g.op('cvae-action-proj', A.linear(aseq, { dout: D, doutSym: 'D' }), { path: ['cvae', 'cvae-in'], out: 'cvae-action-tok', where: WV, label: 'Linear 14 → D (cada acción del chunk)', type: 'embed', group: 'embed',
      outMeta: { label: 'Tokens de las k acciones', tex: 'W a' } });
    const x = g.op('cvae-concat', A.stack_rows([cls, qt, at], { sym: 'k+2', mod: 'act' }), { path: ['cvae', 'cvae-in'], out: 'cvae-in', where: WV, label: '[CLS; articulaciones; k acciones]', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Entrada del encoder CVAE (k + 2 tokens)', tex: 'X_{cvae}' } });
    const pos = g.op('cvae-pos', A.sine_pos_1d({ rows: k + 2, rowsSym: 'k+2', D, mod: 'act' }), { path: ['cvae', 'cvae-in'], out: 'cvae-pos', where: WV, label: 'PE seno/coseno 1-D (buffer)', type: 'embed', group: 'embed',
      outMeta: { label: 'Posición de los k + 2 tokens', tex: 'p' } });
    const out = postEncLayer(g, x, pos, { P: ['cvae', 'cvae-encoder', 'enc-layer'], rep: c.Lenc, pre: 'ce-', tl: 'Encoder CVAE · ', where: WV, h: c.h, Dmlp: c.Dmlp, outId: 'cvae-out',
      outMeta: { label: 'Salida del encoder CVAE', tex: 'H', perLayer: false } });
    const clsOut = g.op('cvae-take-cls', A.take_rows(out, { start: 0, count: 1, vec: true }), { path: ['cvae', 'latent-head'], out: 'cvae-cls-out', where: WV, label: 'Tomar la salida del [CLS]', type: 'tensorop', group: 'head',
      outMeta: { label: 'Resumen del chunk ([CLS])', tex: 'h_{cls}' } });
    const info = g.op('latent-head', A.linear(clsOut, { dout: 2 * c.latent, doutSym: '2d_z' }), { path: ['cvae', 'latent-head'], out: 'latent-info', where: WV, label: 'Linear D → 2·32 (μ y log σ²)', type: 'head', group: 'head',
      outMeta: { label: 'μ y log σ² concatenados', tex: '[\\mu;\\log\\sigma^2]' } });
    const lat = shp(['d_z'], [c.latent], 'lat', 'vec');
    const [mu, lv] = g.op('latent-split', ext('split_channels', [info], [lat, lat], { detail: { parts: [c.latent, c.latent] } }), { path: ['cvae', 'latent-head'], out: ['mu', 'logvar'], where: WV,
      label: 'Partir en μ y log σ²', type: 'tensorop', group: 'head', outMeta: [{ label: 'Media de z', tex: '\\mu' }, { label: 'Log-varianza de z', tex: '\\log\\sigma^2' }] });
    return g.op('reparam', A.reparameterize(mu, lv), { path: ['cvae', 'reparam'], out: 'z', where: WV, label: 'z = μ + σ·ε (reparametrización)', type: 'tensorop', group: 'head',
      outMeta: { label: 'Variable de estilo z (32)', tex: 'z' } });
  }

  // Encoder de observación de Diffusion Policy (robomimic VisualCore por cámara) → obs-cond / obs-tokens.
  function dpObsOps(g, c) {
    const per = c.cams * c.obsSteps, WO = ['Encoder de observación (ResNet-18 por cámara)'];
    const P = ['obs-encoder'];
    const img = g.input('img', shp(['H', 'W', '3'], [c.H, c.W, 3], 'img', 'grid'), { label: 'Imagen de una cámara, recorte central ' + c.H + '×' + c.W + ' (cámaras ' + c.rawH + '×' + c.rawW + ')', tex: 'I' });
    const nimg = g.op('normalize', A.normalize_pixels(img, { stats: 'min-max a [−1, 1]' }), { path: P.concat(['normalize']), out: 'img-norm', repeat: per, paramRepeat: c.cams, where: WO,
      label: 'Normalizar a [−1, 1]', type: 'tensorop', group: 'embed', outMeta: { label: 'Imagen normalizada', tex: 'I' } });
    const c5 = r18Ops(g, nimg, c, { base: P.concat(['backbone']), norm: 'group', rep: per, prep: c.cams, where: WO });
    const o = (id, res, node, extra) => g.op(id, res, Object.assign({ path: P.concat([node]), repeat: per, paramRepeat: c.cams, where: WO }, extra));
    const kl = o('kp-conv', A.conv2d(c5, { k: 1, cout: c.kp, coutSym: 'K', bias: true, outSym: [ceilSym(c.H, 32, 'H'), ceilSym(c.W, 32, 'W')] }), 'kp-conv', { out: 'kp-logits', label: 'Conv 1×1: 512 → K = ' + c.kp + ' mapas', type: 'conv', group: 'embed',
      outMeta: { label: 'Un mapa por keypoint', tex: 'S' } });
    const kps = o('spatial-softmax', A.spatial_softmax(kl), 'spatial-softmax', { out: 'keypoints', label: 'Spatial softmax → (x, y) esperado de cada mapa', type: 'attn', group: 'attn',
      outMeta: { label: 'K keypoints (x, y)', tex: '\\mathbb{E}[x, y]' } });
    const kf = o('kp-flatten', A.flatten_vec(kps, { sym: '2K' }), 'kp-linear', { out: 'kp-flat', label: 'Aplanar K×2 → 64', type: 'tensorop', group: 'embed', outMeta: { label: 'Keypoints aplanados', tex: 'k' } });
    const kp = o('kp-linear', A.linear(kf, { dout: c.camFeat, doutSym: '64' }), 'kp-linear', { out: 'cam-feat-pre', label: 'Linear 64 → 64', type: 'mlp', group: 'mlp', outMeta: { label: 'Rasgo de la cámara', tex: 'Wk' } });
    const cf = o('kp-relu', A.relu(kp), 'kp-relu', { out: 'cam-feat', label: 'ReLU', type: 'mlp', group: 'act', outMeta: { label: 'Rasgo de una cámara en un paso (64)', tex: 'f_c' } });
    const eef = g.input('eef-pose', shp(['2'], [c.lowDim], 'act', 'vec'), { label: 'Pose del efector (x, y) en un paso de observación', tex: 'q' });
    if (c.family === 'dp-cnn') {
      return g.op('obs-concat', ext('concat_features', [cf, eef], shp(['T_o·130'], [c.globalCond], 'lat', 'vec'), { detail: { cams: c.cams, steps: c.obsSteps, per: c.obsFeat } }), { path: ['obs-concat'], out: 'obs-cond',
        label: 'Concatenar cámaras + pose de los T_o = ' + c.obsSteps + ' pasos → ' + c.globalCond, type: 'tensorop', group: 'embed', outMeta: { label: 'Condición global de la observación (' + c.globalCond + ')', tex: 'O_t' } });
    }
    return g.op('obs-concat', ext('concat_features', [cf, eef], shp(['T_o', '130'], [c.obsSteps, c.obsFeat], 'lat', 'seq'), { detail: { cams: c.cams, steps: c.obsSteps, per: c.obsFeat } }), { path: ['obs-concat'], out: 'obs-tokens',
      label: 'Concatenar cámaras + pose: un token por paso de observación', type: 'tensorop', group: 'embed', outMeta: { label: 'Observación: T_o × ' + c.obsFeat, tex: 'O_t' } });
  }

  // Bloque residual condicionado de la U-Net 1-D (ConditionalResidualBlock1D): conv → GN → Mish → FiLM → conv → GN → Mish + atajo.
  function resBlock(g, x, cond, cout, pre, P, c, outId) {
    const rep = c.steps, WU = ['U-Net 1-D (red de ruido, × ' + c.steps + ' pasos)'];
    const cin = x.num[1];
    // Los pesos existen una vez: la red corre `steps` veces con los mismos (paramRepeat 1).
    const o = (id, res, node, extra) => g.op(pre + '-' + id, res, Object.assign({ path: P.concat([node]), out: pre + '-' + id, repeat: rep, paramRepeat: 1, where: WU }, extra));
    const L = (lab, tex) => ({ label: 'U-Net · ' + pre + ': ' + lab, tex, perLayer: rep > 1 });
    const cs = String(cout), ts = x.sym[0];
    let y = o('conv1', A.conv1d(x, { k: c.kernel, p: (c.kernel - 1) / 2, cout, coutSym: cs, outSym: ts }), 'conv1', { label: 'Conv1d k = ' + c.kernel + ': ' + cin + ' → ' + cout, type: 'conv', group: 'embed', outMeta: L('conv 1', 'W_1*x') });
    y = o('gn1', A.group_norm(y, { groups: c.groups }), 'gn1', { label: 'GroupNorm (' + c.groups + ' grupos)', type: 'norm', group: 'norm', outMeta: L('GroupNorm 1', '\\mathrm{GN}') });
    y = o('mish1', A.mish(y), 'mish1', { label: 'Mish', type: 'mlp', group: 'act', outMeta: L('Mish 1', '\\mathrm{Mish}') });
    const cm = o('cond-mish', A.mish(cond), 'film', { label: 'Mish de la condición', type: 'mlp', group: 'act', outMeta: L('condición activada', '\\mathrm{Mish}(c)') });
    const gb = o('film-lin', A.linear(cm, { dout: 2 * cout, doutSym: '2·' + cs }), 'film', { label: 'Linear ' + cond.num[0] + ' → 2·' + cout + ' (escala y sesgo FiLM)', type: 'mlp', group: 'mlp', outMeta: L('γ y β de FiLM', '[\\gamma;\\beta]') });
    y = o('film', A.film(y, gb), 'film', { label: 'FiLM: γ ⊙ h + β', type: 'tensorop', group: 'resid', outMeta: L('modulada por la condición', '\\gamma\\odot h+\\beta') });
    y = o('conv2', A.conv1d(y, { k: c.kernel, p: (c.kernel - 1) / 2, cout, coutSym: cs, outSym: ts }), 'conv2', { label: 'Conv1d k = ' + c.kernel + ': ' + cout + ' → ' + cout, type: 'conv', group: 'embed', outMeta: L('conv 2', 'W_2*h') });
    y = o('gn2', A.group_norm(y, { groups: c.groups }), 'gn2', { label: 'GroupNorm (' + c.groups + ' grupos)', type: 'norm', group: 'norm', outMeta: L('GroupNorm 2', '\\mathrm{GN}') });
    y = o('mish2', A.mish(y), 'mish2', { label: 'Mish', type: 'mlp', group: 'act', outMeta: L('Mish 2', '\\mathrm{Mish}') });
    let sc = x;
    if (cin !== cout) sc = o('res-conv', A.conv1d(x, { k: 1, cout, coutSym: cs, outSym: ts }), 'res-conv', { label: 'Atajo: Conv1d 1×1 ' + cin + ' → ' + cout, type: 'conv', group: 'embed', outMeta: L('atajo proyectado', 'W_s x') });
    return o('add', A.residual_add(y, sc), 'add', Object.assign({ label: 'Suma residual', type: 'tensorop', group: 'resid', outMeta: L('salida del bloque', 'h + x') }, outId ? { out: outId } : {}));
  }

  function dpBuild(c, g) {
    const obsc = dpObsOps(g, c);
    const rep = c.steps, Tp = c.chunk;
    const noisy = g.input('noisy-actions', shp(['T_p', 'd_a'], [Tp, c.actionDim], 'act', 'seq'), { label: 'Acciones con ruido A^k (al inicio, ruido gaussiano puro)', tex: 'A^k_t' });
    const kstep = g.input('k-step', shp(['1'], [1], 'lat', 'vec'), { label: 'Paso de denoising k', tex: 'k' });
    let eps;
    if (c.family === 'dp-cnn') eps = unetOps(g, c, noisy, kstep, obsc);
    else eps = dpTransformerOps(g, c, noisy, kstep, obsc);
    const den = g.op('ddim-step', A.scheduler_step(noisy, eps, { kind: 'ddim', steps: c.steps }), { path: ['ddim-step'], out: 'denoised', repeat: rep, paramRepeat: 1,
      label: 'Paso DDIM: A^{k−1} = f(A^k, ε̂) (× ' + c.steps + ' pasos)', type: 'tensorop', group: 'resid', outMeta: { label: 'Acciones con menos ruido (tras el último paso: A⁰)', tex: 'A^{k-1}_t' } });
    g.op('execute', A.execute_actions(den, { start: c.obsSteps - 1, count: c.executed }), { path: ['execute'], out: 'action-exec', label: 'Ejecutar T_a = ' + c.executed + ' de las T_p = ' + Tp + ' (receding horizon)', type: 'tensorop', group: 'head',
      outMeta: { label: 'Acciones que se ejecutan antes de volver a observar', tex: 'A_t[T_o−1 : T_o−1+T_a]' } });
    return g;
  }

  function unetOps(g, c, noisy, kstep, obsc) {
    const rep = c.steps, WU = ['U-Net 1-D (red de ruido, × ' + c.steps + ' pasos)'];
    const o = (id, res, path, extra) => g.op(id, res, Object.assign({ path: ['unet'].concat(path), out: id, repeat: rep, paramRepeat: 1, where: WU }, extra));
    const te = c.tEmbed;
    let t = o('t-sin', A.timestep_embedding(kstep, { dim: te, flip: false, sym: String(te) }), ['time-embed', 'sin'], { label: 'Embedding sinusoidal del paso k (' + te + ')', type: 'embed', group: 'embed', outMeta: { label: 'sin/cos del paso k', tex: '\\mathrm{PE}(k)' } });
    t = o('t-fc1', A.linear(t, { dout: 4 * te, doutSym: String(4 * te) }), ['time-embed', 'fc1'], { label: 'Linear ' + te + ' → ' + 4 * te, type: 'mlp', group: 'mlp', outMeta: { label: 'tiempo: capa oculta', tex: 'W_1' } });
    t = o('t-mish', A.mish(t), ['time-embed', 'mish'], { label: 'Mish', type: 'mlp', group: 'act', outMeta: { label: 'tiempo: Mish', tex: '\\mathrm{Mish}' } });
    t = o('t-fc2', A.linear(t, { dout: te, doutSym: String(te) }), ['time-embed', 'fc2'], { out: 't-emb', label: 'Linear ' + 4 * te + ' → ' + te, type: 'mlp', group: 'mlp', outMeta: { label: 'Embedding del paso de difusión', tex: 'e_k' } });
    const cond = o('cond-cat', A.concat_features([t, obsc], { sym: 'c' }), ['cond'], { out: 'cond', label: 'Condición = [e_k; O_t] (' + te + ' + ' + c.globalCond + ' = ' + c.condDim + ')', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Condición de FiLM (' + c.condDim + ')', tex: 'c = [e_k; O_t]' } });
    let x = noisy;
    const skips = [];
    const dd = c.downDims;
    const Ts = ['T_p', 'T_p/2', 'T_p/4', 'T_p/8'];
    dd.forEach((w, i) => {
      const lv = 'down-' + (i + 1), pre = 'd' + (i + 1);
      x = resBlock(g, x, cond, w, pre + '-r1', ['unet', lv, 'r1'], c);
      // Salida del nivel (= el skip, antes de bajar): d1-out T_p×256, d2-out T_p/2×512, d3-out T_p/4×1024.
      x = resBlock(g, x, cond, w, pre + '-r2', ['unet', lv, 'r2'], c, pre + '-out');
      skips.push(x);
      if (i < dd.length - 1) x = o(pre + '-down', A.conv1d(x, { k: 3, s: 2, p: 1, cout: w, coutSym: String(w), outSym: Ts[i + 1] }), [lv, 'down'], { label: 'Conv1d k3 s2: bajar ×2 el largo', type: 'conv', group: 'embed',
        outMeta: { label: 'U-Net · ' + lv + ': secuencia a la mitad', tex: '\\downarrow' } });
    });
    const mid = dd[dd.length - 1];
    x = resBlock(g, x, cond, mid, 'm-r1', ['unet', 'mid', 'r1'], c);
    x = resBlock(g, x, cond, mid, 'm-r2', ['unet', 'mid', 'r2'], c, 'm-out');
    // Subida: en cada nivel se concatena el skip del mismo largo (el último de bajada primero; el skip del nivel 1 no se usa).
    const ups = dd.slice(0, -1).reverse();
    ups.forEach((w, i) => {
      const lv = 'up-' + (i + 1), pre = 'u' + (i + 1);
      const sk = skips[skips.length - 1 - i];
      x = o(pre + '-cat', A.concat_features([x, sk], { sym: String(x.num[1] + sk.num[1]) }), [lv, 'cat'], { label: 'Concatenar el skip (' + x.num[1] + ' + ' + sk.num[1] + ' canales)', type: 'tensorop', group: 'resid',
        outMeta: { label: 'U-Net · ' + lv + ': con el skip', tex: '[h; s]' } });
      x = resBlock(g, x, cond, w, pre + '-r1', ['unet', lv, 'r1'], c);
      x = resBlock(g, x, cond, w, pre + '-r2', ['unet', lv, 'r2'], c);
      const Tn = x.num[0] * 2;
      x = o(pre + '-up', A.conv_transpose1d(x, { k: 4, s: 2, p: 1, cout: w, coutSym: String(w), outSym: Ts[dd.length - 2 - i] || String(Tn) }), [lv, 'up'], { out: pre + '-out', label: 'ConvTranspose1d k4 s2: subir ×2 el largo', type: 'conv', group: 'embed',
        outMeta: { label: 'U-Net · ' + lv + ': secuencia al doble', tex: '\\uparrow' } });
    });
    const d0 = dd[0];
    x = o('final-conv', A.conv1d(x, { k: c.kernel, p: (c.kernel - 1) / 2, cout: d0, coutSym: String(d0), outSym: 'T_p' }), ['final', 'conv'], { label: 'Conv1d k = ' + c.kernel + ' ' + d0 + ' → ' + d0, type: 'conv', group: 'embed', outMeta: { label: 'U-Net · final: conv', tex: 'W*h' } });
    x = o('final-gn', A.group_norm(x, { groups: c.groups }), ['final', 'gn'], { label: 'GroupNorm', type: 'norm', group: 'norm', outMeta: { label: 'U-Net · final: GroupNorm', tex: '\\mathrm{GN}' } });
    x = o('final-mish', A.mish(x), ['final', 'mish'], { label: 'Mish', type: 'mlp', group: 'act', outMeta: { label: 'U-Net · final: Mish', tex: '\\mathrm{Mish}' } });
    return o('final-out', A.conv1d(x, { k: 1, cout: c.actionDim, coutSym: 'd_a', outSym: 'T_p' }), ['final', 'out'], { out: 'eps', label: 'Conv1d 1×1 ' + d0 + ' → d_a = ' + c.actionDim, type: 'head', group: 'head',
      outMeta: { label: 'Ruido predicho ε̂_θ(A^k, k, O_t)', tex: '\\hat\\epsilon_\\theta' } });
  }

  // TransformerForDiffusion (time_as_cond, obs_as_cond, n_cond_layers = 0): memoria = MLP([e_k; O_t] + pos), decoder pre-LN causal.
  function dpTransformerOps(g, c, noisy, kstep, obs) {
    const rep = c.steps, D = c.D, WT = ['Transformer de difusión (× ' + c.steps + ' pasos)'];
    const o = (id, res, path, extra) => g.op(id, res, Object.assign({ path: ['transformer'].concat(path), out: id, repeat: rep, paramRepeat: 1, where: WT }, extra));
    const t = o('t-sin', A.timestep_embedding(kstep, { dim: D, flip: false, sym: 'D' }), ['cond', 'time'], { label: 'Embedding sinusoidal del paso k (' + D + ')', type: 'embed', group: 'embed', outMeta: { label: 'Token del paso de difusión', tex: 'e_k' } });
    const xe = o('input-emb', A.linear(noisy, { dout: D, doutSym: 'D' }), ['input-emb'], { out: 'x-emb', label: 'Linear d_a → D (cada acción ruidosa es un token)', type: 'embed', group: 'embed', outMeta: { label: 'Tokens de acción', tex: 'W A^k' } });
    const pe = o('pos-emb', A.pos_embed_learned({ rows: c.chunk, rowsSym: 'T_p', D, mod: 'act' }), ['input-emb'], { label: 'Posición aprendida de las T_p acciones', type: 'embed', group: 'embed', outMeta: { label: 'Posición de los tokens de acción', tex: 'p' } });
    const x0 = o('add-pos', A.add(xe, pe), ['input-emb'], { out: 'x0', label: 'Suma de posición', type: 'tensorop', group: 'embed', outMeta: { label: 'Entrada del decoder', tex: 'x_0' } });
    const co = o('cond-obs-emb', A.linear(obs, { dout: D, doutSym: 'D' }), ['cond', 'obs-emb'], { label: 'Linear ' + c.obsFeat + ' → D (un token por paso de observación)', type: 'embed', group: 'embed', outMeta: { label: 'Tokens de observación', tex: 'W O_t' } });
    const ct = o('cond-cat', A.stack_rows([t, co], { sym: '1+T_o', mod: 'lat' }), ['cond', 'cat'], { out: 'cond-tok', label: '[e_k; O_t]: ' + c.condTokens + ' tokens de condición', type: 'tensorop', group: 'embed', outMeta: { label: 'Tokens de condición', tex: 'C' } });
    const cp = o('cond-pos', A.pos_embed_learned({ rows: c.condTokens, rowsSym: '1+T_o', D, mod: 'lat' }), ['cond', 'cat'], { label: 'Posición aprendida de la condición', type: 'embed', group: 'embed', outMeta: { label: 'Posición de la condición', tex: 'p_c' } });
    const cx = o('cond-add-pos', A.add(ct, cp), ['cond', 'cat'], { label: 'Suma de posición', type: 'tensorop', group: 'embed', outMeta: { label: 'Condición con posición', tex: 'C + p_c' } });
    let m = o('cond-fc1', A.linear(cx, { dout: 4 * D, doutSym: '4D' }), ['cond', 'mlp'], { label: 'Linear D → 4D', type: 'mlp', group: 'mlp', outMeta: { label: 'Encoder de la condición: capa oculta', tex: 'W_1' } });
    m = o('cond-mish', A.mish(m), ['cond', 'mlp'], { label: 'Mish', type: 'mlp', group: 'act', outMeta: { label: 'Encoder de la condición: Mish', tex: '\\mathrm{Mish}' } });
    const mem = o('cond-fc2', A.linear(m, { dout: D, doutSym: 'D' }), ['cond', 'mlp'], { out: 'memory', label: 'Linear 4D → D', type: 'mlp', group: 'mlp', outMeta: { label: 'Memoria (' + c.condTokens + ' tokens)', tex: 'M' } });
    // Capas pre-LN de nn.TransformerDecoderLayer (norm_first): repeat = pasos × capas.
    const R = rep * c.Ldec, P = ['transformer', 'decoder', 'dec-layer'], WL = ['Decoder'];
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path: P.concat(path), repeat: R, paramRepeat: c.Ldec, where: WL }, extra));
    const Lm = (lab, tex) => ({ label: 'Decoder · ' + lab, tex, perLayer: true });
    const n1 = op('d-ln1', A.layernorm(x0), ['ln1'], { out: 'd-ln1', label: 'LayerNorm 1 (pre-LN)', type: 'norm', group: 'norm', outMeta: Lm('LN 1', '\\mathrm{LN}_1(x)') });
    const so = mhaOps(g, { pre: 'd-self-', P: P.concat(['self-attn']), rep: R, prep: c.Ldec, where: ['Decoder', 'self-attention causal'], tl: 'Decoder · self-attention · ', h: c.h, qIn: n1, kIn: n1, vIn: n1, causal: true });
    const r1 = op('d-res1', A.residual_add(x0, so), ['res1'], { out: 'd-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: Lm('x + self-attention', "x'") });
    const n2 = op('d-ln2', A.layernorm(r1), ['ln2'], { out: 'd-ln2', label: 'LayerNorm 2 (pre-LN)', type: 'norm', group: 'norm', outMeta: Lm('LN 2', "\\mathrm{LN}_2(x')") });
    const xo = mhaOps(g, { pre: 'd-cross-', P: P.concat(['cross-attn']), rep: R, prep: c.Ldec, where: ['Decoder', 'cross-attention'], tl: 'Decoder · cross-attention · ', h: c.h, qIn: n2, kIn: mem, vIn: mem, causal: true,
      qNote: ' (desde las acciones)', kNote: ' (desde la condición)', vNote: ' (desde la condición)' });
    const r2 = op('d-res2', A.residual_add(r1, xo), ['res2'], { out: 'd-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: Lm("x' + cross-attention", "x''") });
    const n3 = op('d-ln3', A.layernorm(r2), ['ln3'], { out: 'd-ln3', label: 'LayerNorm 3 (pre-LN)', type: 'norm', group: 'norm', outMeta: Lm('LN 3', "\\mathrm{LN}_3(x'')") });
    const f = ffnOps(g, n3, { pre: 'd-', P, rep: R, prep: c.Ldec, where: ['Decoder', 'FFN'], tl: 'Decoder · FFN · ', Dmlp: c.Dmlp, act: 'gelu' });
    const xo3 = op('d-res3', A.residual_add(r2, f), ['res3'], { out: 'd-out', label: 'Residual 3', type: 'tensorop', group: 'resid', outMeta: { label: 'Decoder · salida de cada capa', tex: 'x_\\ell', perLayer: false } });
    const xf = o('ln-f', A.layernorm(xo3), ['ln-f'], { out: 'x-ln', label: 'LayerNorm final', type: 'norm', group: 'norm', outMeta: { label: 'Salida normalizada', tex: '\\mathrm{LN}(x_L)' } });
    return o('head', A.linear(xf, { dout: c.actionDim, doutSym: 'd_a' }), ['head'], { out: 'eps', label: 'Linear D → d_a = ' + c.actionDim, type: 'head', group: 'head', outMeta: { label: 'Ruido predicho ε̂_θ', tex: '\\hat\\epsilon_\\theta' } });
  }

  function bcBuild(c, g) {
    const cams = c.cams, WB = ['ResNet-18 por cámara'];
    const img = g.input('img', shp(['H', 'W', '3'], [c.H, c.W, 3], 'img', 'grid'), { label: 'Imagen de UNA cámara (' + c.H + '×' + c.W + '; hay ' + cams + ')', tex: 'I_c' });
    const nimg = g.op('normalize', A.normalize_pixels(img, { stats: 'ImageNet' }), { path: ['normalize'], out: 'img-norm', repeat: cams, paramRepeat: cams, label: 'Normalizar (ImageNet)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Imagen normalizada', tex: 'I' } });
    const c5 = r18Ops(g, nimg, c, { base: ['backbone'], norm: 'frozen', rep: cams, prep: cams, where: WB });
    const o = (id, res, path, extra) => g.op(id, res, Object.assign({ path, out: id, repeat: cams, paramRepeat: cams, where: ['Proyección por cámara'] }, extra));
    let x = c5;
    [128, 64, 32].forEach((w, i) => {
      x = o('down-conv' + (i + 1), A.conv2d(x, { k: 5, s: 1, cout: w, coutSym: String(w), bias: true }), ['down-proj', 'conv' + (i + 1)], { label: 'Conv 5×5 → ' + w + ' (sin activación)', type: 'conv', group: 'embed',
        outMeta: { label: 'Proyección ' + (i + 1) + ' (' + x.num[0] + '×' + x.num[1] + ' → ' + (x.num[0] - 4) + '×' + (x.num[1] - 4) + ')', tex: 'W_' + (i + 1) + '*x' } });
    });
    const fl = o('cam-flat', A.flatten_vec(x, { sym: String(c.camFlat) }), ['down-proj', 'flatten'], { label: 'Aplanar ' + c.ph + '×' + c.pw + '×32 → ' + c.camFlat, type: 'tensorop', group: 'embed', outMeta: { label: 'Rasgo de una cámara (' + c.camFlat + ')', tex: 'f_c' } });
    const qpos = g.input('qpos', shp(['14'], [c.stateDim], 'act', 'vec'), { label: 'Posición de las 14 articulaciones', tex: 'q_t' });
    const cat = g.op('concat', ext('concat_features', [fl, qpos], shp([String(c.mlpIn)], [c.mlpIn], 'lat', 'vec'), { detail: { cams } }), { path: ['concat'], out: 'mlp-in', label: 'Concatenar ' + cams + ' cámaras × ' + c.camFlat + ' + 14 articulaciones', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Entrada del MLP (' + fint(c.mlpIn) + ')', tex: '[f; q_t]' } });
    let h = g.op('mlp-fc1', A.linear(cat, { dout: c.hidden, doutSym: String(c.hidden) }), { path: ['mlp', 'fc1'], out: 'mlp-h1', label: 'Linear ' + fint(c.mlpIn) + ' → ' + c.hidden, type: 'mlp', group: 'mlp', outMeta: { label: 'MLP: capa 1', tex: 'W_1x' } });
    h = g.op('mlp-relu1', A.relu(h), { path: ['mlp', 'relu1'], out: 'mlp-a1', label: 'ReLU', type: 'mlp', group: 'act', outMeta: { label: 'MLP: ReLU 1', tex: '\\mathrm{ReLU}' } });
    h = g.op('mlp-fc2', A.linear(h, { dout: c.hidden, doutSym: String(c.hidden) }), { path: ['mlp', 'fc2'], out: 'mlp-h2', label: 'Linear ' + c.hidden + ' → ' + c.hidden, type: 'mlp', group: 'mlp', outMeta: { label: 'MLP: capa 2', tex: 'W_2h' } });
    h = g.op('mlp-relu2', A.relu(h), { path: ['mlp', 'relu2'], out: 'mlp-a2', label: 'ReLU', type: 'mlp', group: 'act', outMeta: { label: 'MLP: ReLU 2', tex: '\\mathrm{ReLU}' } });
    g.op('mlp-fc3', A.linear(h, { dout: c.actionDim * c.chunk, doutSym: c.chunk > 1 ? 'k·14' : '14' }), { path: ['mlp', 'fc3'], out: 'action', label: 'Linear ' + c.hidden + ' → ' + (c.chunk > 1 ? c.chunk + '·14' : '14') + ' (acción)', type: 'head', group: 'head',
      outMeta: { label: c.chunk > 1 ? 'Chunk de ' + c.chunk + ' acciones aplanado' : 'La acción del paso (14)', tex: 'a_t' } });
    g.op('action-head-idle', A.idle_params({ paramTerms: [[1000, c.actionDim], [c.actionDim]], paramTex: '1000\\cdot 14 + 14', what: 'action_head = nn.Linear(1000, 14) de CNNMLP: definido en __init__ y nunca usado en forward' }), {
      path: ['idle'], out: [], in: [], label: 'Sin uso: action_head (Linear 1000 → 14)', type: 'head', group: 'head' });
    return g;
  }

  // ---- números derivados de imitation
  // Activaciones de inferencia (≈, bytes bf16): las del actMem genérico SIN las matrices de atención (como perception.js: en
  // inferencia FlashAttention no las materializa).
  function inferAct(r, o) {
    const att = r.ops.filter((x) => x.prim === 'softmax').reduce((s, x) => s + r.tensors[x.out[0]].elements * x.repeat, 0);
    return Math.max(0, (o.actMemPerSample / o.by - att) * 2);
  }
  function imParts(c, r) {
    const n = r.totals.byNode, z = { params: 0, macs: 0 };
    const nd = (k) => n[k] || z;
    const sum = (keys) => keys.reduce((s, k) => ({ params: s.params + nd(k).params, macs: s.macs + nd(k).macs }), { params: 0, macs: 0 });
    const t = r.totals;
    if (c.family === 'act') {
      const vision = sum(['normalize', 'backbone', 'input-proj']);
      const cvae = nd('cvae');
      const head = sum(['action-head', 'is-pad-head']);
      const enc = nd('encoder'), dec = nd('decoder');
      const policy = { params: t.params - vision.params - cvae.params - head.params, macs: t.macs - vision.macs - cvae.macs - head.macs };
      const perDec = dec.macs / c.Ldec;
      return { vision, cvae, head, policy, enc, dec, deadDec: perDec * (c.Ldec - 1), stepMacs: null };
    }
    if (c.family === 'bc') {
      const vision = sum(['normalize', 'backbone', 'down-proj']);
      const mlp = nd('mlp');
      return { vision, cvae: z, head: { params: (r.ops.find((o) => o.id === 'mlp-fc3') || {}).params || 0, macs: (r.ops.find((o) => o.id === 'mlp-fc3') || {}).macs || 0 }, policy: mlp, idle: nd('idle') };
    }
    const vision = sum(['obs-encoder', 'obs-concat']);
    const net = c.family === 'dp-cnn' ? nd('unet') : nd('transformer');
    const head = c.family === 'dp-cnn' ? nd('final') : nd('head');
    return { vision, cvae: z, head, policy: net, stepMacs: net.macs / c.steps, denoise: net.macs + nd('ddim-step').macs };
  }
  function imQuantities(c, r) {
    const p = imParts(c, r);
    const q = { tokens: c.tokens, cams: c.cams, chunk: c.chunk, H: c.H, W: c.W, fh: c.fh, fw: c.fw, visionParams: p.vision.params, policyParams: p.policy.params, cvaeParams: p.cvae.params,
      visionMacs: p.vision.macs, policyMacs: p.policy.macs, executed: c.executed, inferenceHz: c.inferenceHz };
    if (c.family === 'act') Object.assign(q, { Nimg: c.Nimg, N: c.N, encoderMacs: p.enc.macs, decoderMacs: p.dec.macs, deadDecoderMacs: p.deadDec });
    if (/^dp/.test(c.family)) Object.assign(q, { steps: c.steps, stepMacs: p.stepMacs, globalCond: c.globalCond, obsFeat: c.obsFeat });
    if (c.family === 'dp-cnn') q.condDim = c.condDim;
    if (c.family === 'bc') Object.assign(q, { mlpIn: c.mlpIn, camFlat: c.camFlat });
    return q;
  }
  function imMetrics(c, r, o) {
    const p = imParts(c, r), t = r.totals;
    const act = inferAct(r, o);
    const hw = [ORIN, H100].map((h) => { const x = roof(t.macs, t.params, act, h, 1); return { id: h.id, label: h.label, ms: x.ms, hz: x.fps, bound: x.bound, estimate: true }; });
    const out = {
      family: c.family, cams: c.cams, res: c.H, W: c.W, chunk: c.chunk, actionDim: c.actionDim, executed: c.executed,
      visionParams: p.vision.params, policyParams: p.policy.params, cvaeParams: p.cvae.params, headParams: p.head.params, totalParams: t.params,
      visionMacs: p.vision.macs, policyMacs: p.policy.macs, macsPerInference: t.macs, flopsPerInference: 2 * t.macs, visionMacsShare: p.vision.macs / t.macs,
      actionsPerInference: c.family === 'act' ? c.chunk : c.family === 'bc' ? c.chunk : c.chunk, controlHz: c.controlHz, inferenceHz: c.inferenceHz,
      macsPerSecond: t.macs * c.inferenceHz,
      msOrin: hw[0].ms, msH100: hw[1].ms, maxHzOrin: hw[0].hz, maxHzH100: hw[1].hz, boundOrin: hw[0].bound, boundH100: hw[1].bound,
      fitsControlOrin: hw[0].ms <= 1000 / c.inferenceHz, hardware: hw, hardwareSource: ORIN.source + ' · ' + H100.source, estimate: true,
      units: IM_UNITS,
    };
    if (c.family === 'act') Object.assign(out, { tokens: c.N, imageTokens: c.Nimg, encoderMacs: p.enc.macs, decoderMacs: p.dec.macs, deadDecoderMacs: p.deadDec, deadDecoderShare: p.deadDec / t.macs,
      decoderLayersUsed: 1, decoderLayers: c.Ldec, encoderLayers: c.Lenc, klWeight: c.klWeight, latentDim: c.latent, ensembleM: c.ensembleM, temporalAgg: c.temporalAgg,
      inferenceHzTE: c.controlHz, fitsControlTEOrin: hw[0].ms <= 1000 / c.controlHz, fitsControlNoTEOrin: hw[0].ms <= 1000 * c.chunk / c.controlHz,
      inferenceHzNoTE: c.controlHz / c.chunk, macsPerSecondNoTE: t.macs * c.controlHz / c.chunk, paperParamsM: c.paperParamsM, paperLatencyMs: c.paperLatencyMs,
      demos: c.demos, batch: c.batch, episodeStepsMin: c.episodeSteps[0], episodeStepsMax: c.episodeSteps[1] });
    if (/^dp/.test(c.family)) Object.assign(out, { steps: c.steps, trainSteps: c.trainSteps, stepMacs: p.stepMacs, denoiseMacs: p.policy.macs, denoiseShare: p.policy.macs / t.macs,
      obsSteps: c.obsSteps, obsFeat: c.obsFeat, globalCond: c.globalCond, paperDParamsM: c.paperDParamsM, paperSteps: c.paperSteps, demos: c.demos, batch: c.batch });
    if (c.family === 'dp-cnn') Object.assign(out, { condDim: c.condDim, paperVParamsM: c.paperVParamsM, paperExecuted: c.paperExecuted, paperLatencyMs: c.paperLatencyMs, paperLatencySteps: c.paperLatencySteps });
    if (c.family === 'dp-transformer') out.paperEmb = c.paperEmb;
    if (c.family === 'bc') Object.assign(out, { idleParams: p.idle.params, mlpIn: c.mlpIn });
    const arch = archOverrides(r, 'imitation');
    const row = (ov) => { const rr = A.run(r.id, Object.assign({}, arch, ov)), m = rr.totals, cc = rr.config;
      const x = roof(m.macs, m.params, inferAct(rr, { actMemPerSample: A.metrics(r.id, Object.assign({}, arch, ov)).actMemPerSample, by: 2 }), ORIN, 1);
      return { macsPerInference: m.macs, inferenceHz: cc.inferenceHz, macsPerSecond: m.macs * cc.inferenceHz, msOrin: x.ms }; };
    if (/^dp/.test(c.family)) out.stepsScaling = guarded(() => [1, 4, 8, 16, 100].filter((s) => s <= c.trainSteps).map((s) => Object.assign({ steps: s }, row({ steps: s }))));
    const chunks = c.family === 'act' ? [1, 10, 50, 100, 200] : c.family === 'bc' ? [1, 10, 50, 100] : [8, 16, 32, 64];
    out.chunkScaling = guarded(() => chunks.map((k) => { try { return Object.assign({ chunk: k }, row({ chunk: k })); } catch (e) { return null; } }).filter(Boolean));
    out.camsScaling = guarded(() => [1, 2, 3, 4].map((n) => Object.assign({ cams: n }, row({ cams: n }))));
    return out;
  }
  const IM_UNITS = {
    cams: 'count', res: 'count', W: 'count', chunk: 'count', actionDim: 'count', executed: 'count', visionParams: 'params', policyParams: 'params', cvaeParams: 'params', headParams: 'params',
    totalParams: 'params', visionMacs: 'macs', policyMacs: 'macs', macsPerInference: 'macs', flopsPerInference: 'count', visionMacsShare: 'pct', actionsPerInference: 'count',
    controlHz: 'ratio', inferenceHz: 'ratio', macsPerSecond: 'count', msOrin: 'ms', msH100: 'ms', maxHzOrin: 'ratio', maxHzH100: 'ratio',
    tokens: 'count', imageTokens: 'count', encoderMacs: 'macs', decoderMacs: 'macs', deadDecoderMacs: 'macs', deadDecoderShare: 'pct', decoderLayersUsed: 'count', decoderLayers: 'count',
    encoderLayers: 'count', inferenceHzTE: 'ratio', klWeight: 'ratio', latentDim: 'count', ensembleM: 'ratio', inferenceHzNoTE: 'ratio', macsPerSecondNoTE: 'count', paperParamsM: 'ratio', paperLatencyMs: 'ms',
    demos: 'count', batch: 'count', episodeStepsMin: 'count', episodeStepsMax: 'count', steps: 'count', trainSteps: 'count', stepMacs: 'macs', denoiseMacs: 'macs', denoiseShare: 'pct',
    obsSteps: 'count', obsFeat: 'count', globalCond: 'count', condDim: 'count', paperDParamsM: 'ratio', paperVParamsM: 'ratio', paperSteps: 'count', paperExecuted: 'count',
    paperLatencySteps: 'count', paperEmb: 'count', idleParams: 'params', mlpIn: 'count',
  };

  A.defineModel({
    id: 'imitation',
    label: 'Imitation learning: BC, ACT y Diffusion Policy',
    paper: { title: 'Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware (ACT)', authors: 'Zhao et al.', venue: 'RSS 2023', year: 2023, arxiv: '2304.13705',
      note: 'Diffusion Policy: Chi et al., RSS 2023 / IJRR 2024, arXiv:2303.04137. DAgger: Ross et al., AISTATS 2011, arXiv:1011.0686. BC: Pomerleau, ALVINN, NeurIPS 1989.' },
    configs: IM_CONFIGS,
    knobs: { chunk: [1, 10, 16, 50, 100], cams: [1, 2, 3, 4], steps: [1, 4, 8, 16, 100], res: [96, 216, 240, 432, 480] },
    hardware: HW.map((h) => Object.assign({}, h)),
    applyKnobs: imApply,
    resolve: imResolve,
    build: imBuild,
    quantities: imQuantities,
    metrics: imMetrics,
  });

  A.robotlearn = { gae, clipObjective, valueLoss, normalizeAdv, ppoUpdateCost, bufferFields: (id) => bufferFields(A.run(id).config), encLayerParams, hardware: () => HW.map((h) => Object.assign({}, h)) };
})(typeof window !== 'undefined' ? window : globalThis);
