/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/rl-ppo.js
   Diagramas de PPO (SPEC §7.2, ids de §27.1), modelo `rl-ppo` (js/arch/robotlearn.js), config canónica ppo-mujoco (también
   ppo-anymal-isaac; ppo-atari comparte un tronco CNN entre actor y crítico y no entra en estas vistas: lo dice configsNote):
     ppo-overview   un anillo: arriba, el ROLLOUT (sin gradiente): la observación s_t de los N entornos → actor π_θ (μ, log σ) →
                    muestrear a → simulador (× N entornos) → recompensa al buffer, s_{t+1} vuelve (↻ × T pasos); el crítico V_φ
                    lee la misma s_t y guarda V(s_t). Abajo, la ACTUALIZACIÓN: buffer (T × N) → GAE → minibatches → pérdidas
                    (valor, PPO-clip, entropía) → pérdida total → ∇ a θ y φ (↻ × K épocas × m minibatches) → el rollout siguiente.
                    Abajo del todo, el cómputo de una iteración (rollout vs actualización) de ATLAS.Arch.metrics.
       clip         (se abre desde PPO-clip) r = exp(log π_θ − log π_old) → clip(r, 1 − ε, 1 + ε) → min(r·Â, clip(r)·Â) → −media
       gae          (se abre desde GAE) δ_t = r_t + γV(s_{t+1})(1 − done) − V(s_t) → Â_t = δ_t + γλ·Â_{t+1} (hacia atrás) →
                    R_t = Â_t + V(s_t)
   Notas, captions y recorridos con claves SIN prefijo ({{metrics.x}}, {{cfg.x}}): siguen la config dibujada.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'ppo-mujoco', CONFIGS = ['ppo-mujoco', 'ppo-anymal-isaac'];
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 'rl-ppo', section: 'diagrama', configs: CONFIGS, configsNote: 'Atari comparte un tronco CNN entre actor y crítico: se describe en la página' };
  // Subíndices estilo TeX en el html de notas y pasos ("π_θ", "V_φ", "s_{t+1}") → <sub>; no toca <code> ni las claves {{…}}
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-zθφ0-9]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };
  const OPLEG = { mlp: 'Redes: actor π_θ y crítico V_φ (MLP)', head: 'Pérdidas', tensorop: 'Operaciones sin parámetros (muestrear, GAE, minibatches)', io: 'Entorno, observación y buffer' };

  // ------------------------------------------------------------------ (a) vista general: el anillo rollout → actualización
  register(Object.assign({
    id: 'ppo-overview', model: 'rl-ppo', config: C, kind: 'arch', title: 'PPO — vista general',
    caption: 'Un ciclo de PPO en dos mitades. Arriba, el rollout, sin gradiente: N entornos en paralelo dan su observación s_t; el actor π_θ propone una gaussiana (media μ(s) y un log σ aprendido que no depende del estado) y se muestrea la acción; el simulador avanza un paso y devuelve la recompensa y s_{t+1}, que vuelve a entrar (T pasos). El crítico V_φ lee la misma s_t. Todo va al buffer: T × N transiciones. Abajo, la actualización: GAE convierte recompensas y valores en ventajas Â y retornos R; el lote se baraja en minibatches y cada uno pasa por tres pérdidas (PPO-clip para el actor, error cuadrático para el crítico, un bono de entropía); el gradiente de la pérdida total mueve θ y φ, K épocas sobre el MISMO lote. Después se tira el buffer y se vuelve a recolectar: on-policy. Las redes son chicas: el costo está en la cantidad de muestras.',
    grid: { w: 172, h: 113 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['actor', 'sample', 'envs', 'critic'], mobileFocusPad: 2, blankCrop: true,
    opLegend: OPLEG,
    modLegend: { act: 'Estado / acción del robot' },
    edgeLegend: { control: 'Gradiente (actualiza θ y φ) o datos de control' },
    legendText: { runs: 'Veces que corre por iteración', loop: 'Bucle: × T pasos en el rollout; × K épocas × m minibatches en la actualización', costSplit: 'Cómputo por iteración: ancho proporcional a los MACs (del calculador)' },
    groups: [
      { id: 'rollout', style: 'lane', tone: 'accent', label: 'Rollout: N × T = {{cfg.nEnvs}} × {{cfg.horizon}} pasos de entorno · sin gradiente', legend: 'Marco azul: recolectar (sin gradiente)', labelPos: 'bottom', labelDx: 70, x: 0.5, y: 0.5, w: 171, h: 51.5, hideInBlank: true },
      { id: 'update', style: 'lane', tone: 'warn', label: 'Actualización: K = {{cfg.epochs}} épocas × {{cfg.minibatches}} minibatches de M = {{metrics.minibatchSize}}', legend: 'Marco ámbar: actualizar (con gradiente)', labelPos: 'bottom', x: 0.5, y: 54.5, w: 171, h: 41, hideInBlank: true },
    ],
    nodes: [
      { id: 'actor', op: 'mlp', costOf: 'actor', label: 'Actor π_θ', sub: 'MLP → μ(s) · log σ', runs: '× N·T = {{metrics.samplesPerUpdate}}', x: 4, y: 7, w: 28, h: 16,
        tex: '\\pi_\\theta(a \\mid s) = \\mathcal{N}\\big(\\mu_\\theta(s),\\ \\mathrm{diag}(\\sigma^2)\\big)',
        note: 'La política: un MLP chico que da la media μ(s) de una gaussiana por articulación ({{metrics.actDim}} acciones); el desvío σ es un parámetro aparte que NO depende del estado (log σ en CleanRL; σ directo en <code>rsl_rl</code>). {{metrics.actorParams}} parámetros: corre una vez por entorno y por paso en el rollout, y otra vez (con gradiente) sobre cada minibatch.' },
      { id: 'sample', op: 'tensorop', shape: 'rect', ops: ['sample'], opsExact: true, label: 'Muestrear', sub: 'a ~ N(μ, σ²)', x: 44, y: 9, w: 24, h: 9,
        tex: 'a_t = \\mu_\\theta(s_t) + \\sigma \\odot \\xi,\\ \\ \\xi \\sim \\mathcal{N}(0, I)', note: 'La acción se SORTEA (exploración); se guarda su log-probabilidad log π_old(a|s), que en la actualización da el cociente r = π_θ / π_old. En evaluación se usa la media μ.' },
      { id: 'env-step', op: 'io', ops: ['env-step'], opsExact: true, parallel: 'cfg.nEnvs', label: 'Simulador', sub: 'N entornos en paralelo', subNum: '{{cfg.nEnvs}} entorno(s) · {{metrics.controlHz}} Hz', runs: '× T = {{cfg.horizon}} pasos', x: 80, y: 6, w: 32, h: 14,
        note: 'El entorno (MuJoCo en HalfCheetah; Isaac Gym con miles de robots en la GPU en <code>legged_gym</code>) aplica a durante un paso de control y devuelve r_t y s_{t+1}. No tiene parámetros: su costo es tiempo de simulación, no MACs de red. Con N entornos en paralelo, un paso del rollout da N transiciones.' },
      { id: 'envs', op: 'io', modality: 'act', label: 'Observación s_t', sub: 'N × d_obs', subNum: '{{cfg.nEnvs}} × {{tensor.obs.shape}}', x: 44, y: 26, w: 24, h: 9,
        note: 'Lo que ve la política: {{metrics.obsDim}} números por entorno (HalfCheetah: posiciones y velocidades articulares; ANYmal: propiocepción + 187 alturas del terreno alrededor del robot). La MISMA s_t entra al actor y al crítico.' },
      { id: 'critic', op: 'mlp', costOf: 'critic', label: 'Crítico V_φ', sub: 'MLP → V(s)', x: 44, y: 39, w: 24, h: 10,
        tex: 'V_\\phi(s_t) \\approx \\mathbb{E}\\big[\\textstyle\\sum_l \\gamma^l r_{t+l}\\big]', note: 'Estima cuánta recompensa futura (descontada con γ = {{metrics.gamma}}) espera desde s_t. Red aparte, del mismo tamaño que el actor en estas configs ({{metrics.criticParams}} parámetros). Solo sirve para entrenar: el robot despliega el actor.' },
      { id: 'buffer', op: 'io', style: 'store', ops: ['store'], opsExact: true, label: 'Buffer de rollout', sub: 'T × N transiciones\n(s, a, log π, r, V)\nse tira tras K épocas', subNum: '{{tensor.rollout.shape}} transiciones\n{{metrics.rolloutBufferBytes}} en fp32\nse tira tras K épocas', x: 131, y: 8, w: 24, h: 41,
        note: 'Las T × N = {{metrics.samplesPerUpdate}} transiciones de la iteración, en la memoria de la GPU (o la CPU): observación, acción, log π_old, recompensa, done y V(s). Ocupa {{metrics.rolloutBufferBytes}}. On-policy: después de la actualización se descarta entero.' },
      { id: 'gae', op: 'tensorop', shape: 'rect', costOf: 'gae', label: 'Ventajas (GAE)', sub: 'δ_t → Â_t · R_t = Â_t + V', expand: 'gae', x: 128, y: 61, w: 30, h: 11,
        tex: '\\hat A_t = \\textstyle\\sum_{l} (\\gamma\\lambda)^l\\, \\delta_{t+l},\\ \\ \\delta_t = r_t + \\gamma V(s_{t+1}) - V(s_t)', note: 'Una pasada hacia atrás por el buffer: la ventaja de cada paso (¿salió mejor de lo que el crítico esperaba?) con γ = {{metrics.gamma}}, λ = {{metrics.lambda}}, y el retorno objetivo del crítico R = Â + V. Sin parámetros. Ábrelo para ver la recursión.' },
      { id: 'minibatch', op: 'tensorop', shape: 'rect', costOf: 'minibatch', label: 'Minibatches', sub: 'barajar · M = N·T / m', subNum: 'barajar · M = {{metrics.minibatchSize}}', runs: '× K = {{cfg.epochs}} épocas', x: 88, y: 61, w: 28, h: 11,
        note: 'Cada época baraja las {{metrics.samplesPerUpdate}} muestras y las corta en {{cfg.minibatches}} minibatches de {{metrics.minibatchSize}}: {{metrics.gradStepsPerUpdate}} pasos de gradiente por iteración, cada muestra usada {{cfg.epochs}} veces (lo que PPO gana frente a un policy gradient de una pasada). Las ventajas se normalizan a media 0 y desvío 1: por minibatch en CleanRL (<code>norm_adv</code>), sobre el batch entero en <code>rsl_rl</code> v1.0.2 (<code>compute_returns</code>).' },
      { id: 'value-loss', op: 'head', costOf: 'value-loss', label: 'Pérdida del valor', sub: '(V_φ(s) − R)²', x: 44, y: 58, w: 26, h: 9,
        tex: 'L^{V} = \\tfrac{1}{M}\\textstyle\\sum (V_\\phi(s) - R)^2', note: 'Regresión del crítico hacia los retornos de GAE (CleanRL la recorta también con ε; c₁ = {{metrics.vfCoef}} la pesa en la total).' },
      { id: 'clip-loss', op: 'head', costOf: 'clip-loss', label: 'PPO-clip', sub: 'min(r·Â, clip(r)·Â)', expand: 'clip', x: 44, y: 70, w: 26, h: 9,
        tex: 'L^{CLIP} = \\tfrac{1}{M}\\textstyle\\sum \\min\\big(r\\hat A,\\ \\mathrm{clip}(r, 1-\\epsilon, 1+\\epsilon)\\hat A\\big),\\ \\ r = \\tfrac{\\pi_\\theta(a|s)}{\\pi_{\\theta_{old}}(a|s)}',
        note: 'El actor vuelve a correr sobre el minibatch (con gradiente) para dar log π_θ(a|s); el cociente con el log π_old guardado se recorta a 1 ± ε (ε = {{metrics.clipEps}}): pasos chicos sin la restricción de KL de TRPO. Ábrelo.' },
      { id: 'entropy', op: 'head', costOf: 'entropy', label: 'Entropía H[π_θ]', sub: 'bono: −c₂·H', x: 44, y: 82, w: 26, h: 9,
        tex: 'H = \\textstyle\\sum_j \\big(\\log \\sigma_j + \\tfrac12 \\log 2\\pi e\\big)', note: 'Premia que la política siga explorando. Con σ independiente del estado, la entropía de la gaussiana solo depende de log σ. c₂ = {{metrics.entCoef}} en esta config (el paper usa 0 en MuJoCo; <code>legged_gym</code>, 0.01).' },
      { id: 'total-loss', op: 'head', costOf: 'total-loss', label: 'Pérdida total', sub: '−L_clip + c₁L_V − c₂H', blankSub: 'una sola pérdida', x: 5, y: 67, w: 27, h: 13,
        tex: 'L = -L^{CLIP} + c_1 L^{V} - c_2 H', note: 'Una sola pérdida y un solo backward; con redes separadas, su gradiente mueve θ por el término de clip y la entropía, y φ por el del valor. Adam con lr = {{metrics.lr}}. Se repite por cada minibatch y época: {{metrics.gradStepsPerUpdate}} pasos por iteración.' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Cómputo por iteración (MACs)', x: 1, y: 98, w: 170, h: 14,
        costSplit: { segs: [
          { op: 'mlp', n: 'metrics.rolloutMacs', label: 'Rollout: actor + crítico, sin gradiente (× N·T)' },
          { op: 'head', n: 'metrics.updateMacs', label: 'Actualización: forward + backward (× K épocas)' },
        ], legendSegs: true, caption: '{{metrics.samplesPerUpdate}} muestras · {{metrics.gradStepsPerUpdate}} pasos de gradiente · total {{metrics.iterationMacs}} por iteración (sin el simulador)' },
        note: 'MACs de las redes por iteración, del calculador. El rollout corre el actor y el crítico una vez por muestra; la actualización, forward + backward ({{metrics.trainToForward}} × el forward: el backward cuesta ≈ 2×, menos el gradiente de la entrada en la 1.ª capa) K veces por muestra. El simulador no está contado: en MuJoCo sobre CPU suele ser lo que más tarda.' },
    ],
    edges: [
      { from: 'envs', to: 'actor', kind: 'data', tensor: 'obs', fromSide: 'left', toSide: 'right', toAt: 0.82, midX: 38, labelSide: 'below', labelSeg: 0, labelT: 0.5 },
      { from: 'envs', to: 'critic', kind: 'data', tensor: 'obs', fromSide: 'bottom', toSide: 'top', label: false },
      { from: 'actor', to: 'sample', kind: 'data', tensor: 'act-mean', fromAt: 0.36, toAt: 0.5, labelSide: 'above', labelT: 0.5, tag: 'μ, σ', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'sample', to: 'env-step', kind: 'data', tensor: 'action', toAt: 0.536, labelSide: 'above', labelT: 0.5 },
      { from: 'env-step', to: 'buffer', kind: 'data', tensor: 'reward', fromAt: 0.3, toAt: 0.06, labelSide: 'above', labelT: 0.5, tag: 'r_t', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'env-step', to: 'envs', kind: 'data', tensor: 'obs', fromSide: 'bottom', toSide: 'right', fromAt: 0.45, toAt: 0.5, label: false, loop: true, tag: 's_{t+1} · × T pasos', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 'sample', to: 'buffer', kind: 'data', tensor: 'logp', fromSide: 'top', toSide: 'top', fromAt: 0.5, toAt: 0.4, via: [[56, 2.6], [140.6, 2.6]], label: false, tag: 'a, log π_old(a|s)', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 'critic', to: 'buffer', kind: 'data', tensor: 'value', toAt: 0.88, labelSide: 'above', labelT: 0.5, tag: 'V(s_t)', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'buffer', to: 'gae', kind: 'data', tensor: 'rollout', fromSide: 'bottom', toSide: 'top', labelSide: 'right', labelT: 0.78 },
      { from: 'gae', to: 'minibatch', kind: 'data', tensor: 'advantages', labelSide: 'above', labelT: 0.5, tag: 'Â, R', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'minibatch', to: 'value-loss', kind: 'data', tensor: 'mb-ret', fromAt: 0.12, toAt: 0.5, midX: 80, label: false, tag: 'R', tagStyle: 'plain', tagSide: 'above', tagSeg: 2, tagT: 0.5 },
      { from: 'minibatch', to: 'clip-loss', kind: 'data', tensor: 'mb-adv', fromAt: 0.55, toAt: 0.5, midX: 78, labelSide: 'below', labelSeg: 2, labelT: 0.5 },
      { from: 'minibatch', to: 'entropy', kind: 'control', fromSide: 'bottom', toSide: 'right', fromAt: 0.5, toAt: 0.5, tag: 'H no depende de s', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 'value-loss', to: 'total-loss', kind: 'data', tensor: 'loss-value', toAt: 0.2, midX: 38, label: false },
      { from: 'clip-loss', to: 'total-loss', kind: 'data', tensor: 'loss-clip', toAt: 0.55, midX: 38, label: false },
      { from: 'entropy', to: 'total-loss', kind: 'data', tensor: 'loss-entropy', toAt: 0.88, midX: 38, label: false },
      { from: 'total-loss', to: 'actor', kind: 'control', fromSide: 'top', toSide: 'bottom', fromAt: 0.5, toAt: 0.536, loop: true, tag: '∇ actualiza θ · Adam · × K épocas × m', tagStyle: 'plain', tagSide: 'on', tagT: 0.42 },
      { from: 'value-loss', to: 'critic', kind: 'control', fromSide: 'top', toSide: 'bottom', fromAt: 0.5, toAt: 0.54, tag: '∇ φ', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (una iteración de PPO)', steps: [
        { nodes: ['envs', 'actor', 'sample'], edges: ['envs>actor', 'actor>sample'], tensors: ['obs', 'act-mean'],
          text: 'Paso t del rollout: la observación de cada entorno (<b>' + q('tensor.obs.shape') + '</b>) entra al actor, que da la media <b>' + q('tensor.act-mean.shape') + '</b>; con el log σ aprendido se sortea la acción. El actor: ' + q('metrics.actorParams') + ' parámetros, ' + q('metrics.actorMacs') + ' por observación.' },
        { nodes: ['env-step', 'buffer'], edges: ['sample>env-step', 'env-step>buffer', 'env-step>envs', 'sample>buffer'], tensors: ['action', 'reward', 'logp'],
          text: 'El simulador aplica la acción (<b>' + q('tensor.action.shape') + '</b>) y devuelve la recompensa y s_{t+1}; al buffer van a, log π_old y r. s_{t+1} vuelve a entrar: ' + q('cfg.horizon') + ' pasos con ' + q('cfg.nEnvs') + ' entorno(s).' },
        { nodes: ['critic', 'buffer'], edges: ['envs>critic', 'critic>buffer'], tensors: ['value'],
          text: 'El crítico lee la misma s_t y guarda V(s_t). Al final del rollout el buffer tiene <b>' + q('tensor.rollout.shape') + '</b> transiciones (' + q('metrics.samplesPerUpdate') + ' muestras, ' + q('metrics.rolloutBufferBytes') + ').' },
        { nodes: ['gae'], edges: ['buffer>gae', 'gae>minibatch'], tensors: ['rollout', 'advantages'],
          text: 'GAE (γ = ' + q('metrics.gamma') + ', λ = ' + q('metrics.lambda') + '): una ventaja y un retorno por transición, <b>' + q('tensor.advantages.shape') + '</b>, en una pasada hacia atrás.' },
        { expand: 'gae', nodes: ['ga-delta', 'ga-scan'], edges: ['ga-delta>ga-scan'], tensors: [],
          text: 'Por dentro: δ_t = r_t + γV(s_{t+1}) − V(s_t) y Â_t = δ_t + γλ·Â_{t+1}, del último paso al primero.' },
        { nodes: ['minibatch', 'value-loss', 'clip-loss', 'entropy'], edges: ['minibatch>value-loss', 'minibatch>clip-loss', 'minibatch>entropy'], tensors: ['mb-adv', 'mb-ret'],
          text: 'Se baraja y se corta en ' + q('cfg.minibatches') + ' minibatches de ' + q('metrics.minibatchSize') + ': para cada uno, el actor y el crítico vuelven a correr (con gradiente) y salen las tres pérdidas.' },
        { expand: 'clip', nodes: ['cl-ratio', 'cl-clip', 'cl-min'], edges: ['cl-ratio>cl-clip'], tensors: [],
          text: 'PPO-clip por dentro: r = exp(log π_θ − log π_old), recortado a 1 ± ε (ε = ' + q('metrics.clipEps') + '), y el mínimo con r·Â.' },
        { nodes: ['total-loss', 'actor', 'critic'], edges: ['value-loss>total-loss', 'clip-loss>total-loss', 'entropy>total-loss', 'total-loss>actor', 'value-loss>critic'], tensors: ['loss-clip', 'loss-value', 'loss-entropy'],
          text: 'Un backward de la pérdida total y un paso de Adam: ' + q('metrics.gradStepsPerUpdate') + ' pasos por iteración (' + q('cfg.epochs') + ' épocas × ' + q('cfg.minibatches') + ' minibatches). Después, el buffer se descarta y empieza otro rollout.' },
        { nodes: ['cost'], edges: [], tensors: [],
          text: 'Una iteración: ' + q('metrics.iterationMacs') + ' en las redes; la actualización es ' + q('metrics.updateShare') + ' de ese cómputo. Redes chicas, muchas muestras: el cuello de botella suele ser el simulador.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) PPO-clip por dentro (calc:false: elementwise, sin parámetros)
  // Ejemplo numérico de UNA muestra (A > 0): log π_θ = −1.84, log π_old = −2.10 → r = e^{0.26} = 1.2969 ≈ 1.30; ε = 0.2 → clip = 1.20;
  // Â = +0.80 → r·Â = 1.0375 ≈ 1.04 y clip(r)·Â = 0.96 → min = 0.96 (el término recortado: ∂/∂θ = 0 para esta muestra).
  // Con Â = −0.80 y el mismo r: −1.04 y −0.96 → min = −1.04 (sin recortar: el gradiente baja r).
  const K = (k) => '{{' + k + '}}';   // sin prefijo: sigue la config elegida en la vista general (MuJoCo o ANYmal)
  register(Object.assign({
    id: 'clip', model: 'rl-ppo', inheritConfig: C, calc: false, calcNote: 'Operaciones elemento a elemento sobre el minibatch (sin parámetros): los números son UNA muestra de ejemplo; M, ε y las formas de la config van en el texto.',
    kind: 'arch', title: 'PPO-clip por dentro', parent: 'ppo-overview', parentNode: 'clip-loss',
    caption: 'La pérdida de la política para un minibatch de M = ' + K('metrics.minibatchSize') + ' transiciones, muestra por muestra. El actor (con gradiente) vuelve a calcular log π_θ(a|s) de la acción guardada; con el log π_old del buffer sale el cociente r = π_θ / π_old (= 1 en el primer minibatch de la primera época). Se recorta a [1 − ε, 1 + ε] (ε = ' + K('metrics.clipEps') + '), los dos se multiplican por la ventaja y gana el MENOR: si el paso ya mejoró el objetivo más allá del recorte, esa muestra deja de empujar (gradiente 0). Ejemplo: r = 1.30 con Â = +0.80 → min(1.04, 0.96) = 0.96, el recortado. Con Â = −0.80 ganaría −1.04, sin recortar: el gradiente sigue y baja r.',
    grid: { w: 190, h: 40 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['cl-ratio', 'cl-clip', 'cl-surr'], mobileFocusPad: 1,
    opLegend: { mlp: 'Actor π_θ (corre con gradiente)', tensorop: 'Elemento a elemento (sin parámetros)', head: 'La pérdida (escalar)', io: 'Del buffer / del minibatch' },
    edgeLegend: { data: 'Una muestra del minibatch (valor de ejemplo en la etiqueta)' },
    nodes: [
      { id: 'cl-mb', op: 'io', modality: 'act', label: 'Minibatch', sub: 'M transiciones', x: 2, y: 4, w: 20, h: 9,
        note: 'M = ' + K('metrics.minibatchSize') + ' transiciones barajadas del buffer: observación s, acción a (la que se sorteó en el rollout), log π_old, ventaja y retorno.' },
      { id: 'cl-actor', op: 'mlp', label: 'Actor π_θ', sub: 'con gradiente', x: 28, y: 4, w: 22, h: 9,
        note: 'El MISMO actor del rollout, ahora con gradiente y con los θ que ya se movieron en los minibatches anteriores: la densidad gaussiana de la acción guardada, log N(a; μ_θ(s), σ²).' },
      { id: 'cl-old', op: 'io', label: 'log π_old(a|s)', sub: 'del buffer, fijo', x: 28, y: 18, w: 22, h: 9,
        note: 'El log-prob con el que se sorteó la acción en el rollout: queda fijo durante las ' + K('cfg.epochs') + ' épocas.' },
      { id: 'cl-ratio', op: 'tensorop', shape: 'rect', label: 'r = exp(Δ log π)', sub: 'r = π_θ / π_old', x: 64, y: 10, w: 24, h: 11,
        tex: 'r_t(\\theta) = \\exp\\big(\\log \\pi_\\theta(a_t|s_t) - \\log \\pi_{\\theta_{old}}(a_t|s_t)\\big)', note: 'El cociente de probabilidades nueva / vieja, en logaritmos (estable). r = 1: la política no cambió para esa acción; r > 1: la volvió más probable.' },
      { id: 'cl-clip', op: 'tensorop', shape: 'rect', label: 'clip(r, 1 − ε, 1 + ε)', sub: 'ε = 0.2 → [0.8, 1.2]', x: 92, y: 2, w: 28, h: 9,
        tex: '\\mathrm{clip}(r, 1-\\epsilon, 1+\\epsilon)', note: 'El cociente recortado a la banda. ε = ' + K('metrics.clipEps') + ' en esta config (0.1 × α en Atari).' },
      { id: 'cl-adv', op: 'io', label: 'Â (normalizada)', sub: 'media 0, desvío 1', x: 92, y: 27, w: 28, h: 9,
        note: 'La ventaja de GAE de cada transición, normalizada a media 0 y desvío 1 (CleanRL <code>norm_adv=True</code>, dentro del minibatch; <code>rsl_rl</code>, sobre el batch entero): la escala de la pérdida no depende de la de las recompensas.' },
      { id: 'cl-surr', op: 'tensorop', shape: 'rect', label: '× Â (las dos)', sub: 'r·Â  y  clip(r)·Â', x: 128, y: 10, w: 22, h: 11,
        note: 'Dos versiones del objetivo de policy gradient (el "surrogate" de TRPO): sin recortar y recortada.' },
      { id: 'cl-min', op: 'tensorop', shape: 'rect', label: 'min(·, ·)', sub: 'la cota pesimista', x: 162, y: 3, w: 20, h: 9,
        tex: '\\min\\big(r\\hat A,\\ \\mathrm{clip}(r)\\hat A\\big)', note: 'Gana el menor. Si es el recortado (r fuera de la banda Y el cambio ya mejoró el objetivo), la muestra no aporta gradiente. Si el cambio EMPEORÓ el objetivo, gana el sin recortar y el gradiente corrige.' },
      { id: 'cl-mean', op: 'head', label: '−media', sub: '→ L_clip', x: 162, y: 24, w: 20, h: 9,
        tex: 'L^{CLIP} = -\\tfrac{1}{M}\\textstyle\\sum_i \\min(\\cdot)', note: 'Promedio sobre las M muestras, con signo menos (se minimiza la pérdida = se maximiza el objetivo). Va a la pérdida total con la del valor y la entropía.' },
    ],
    edges: [
      { from: 'cl-mb', to: 'cl-actor', kind: 'data', tag: 's, a', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'cl-actor', to: 'cl-ratio', kind: 'data', toAt: 0.3, midX: 57, tag: '−1.84', tagStyle: 'plain', tagSide: 'above', tagSeg: 2, tagT: 0.5 },
      { from: 'cl-old', to: 'cl-ratio', kind: 'data', toAt: 0.75, midX: 57, tag: '−2.10', tagStyle: 'plain', tagSide: 'below', tagSeg: 2, tagT: 0.5 },
      { from: 'cl-ratio', to: 'cl-clip', kind: 'data', fromSide: 'top', toSide: 'left', fromAt: 0.5, toAt: 0.5, tag: 'r = 1.30', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 'cl-ratio', to: 'cl-surr', kind: 'data', toAt: 0.5, tag: '1.30', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'cl-clip', to: 'cl-surr', kind: 'data', fromSide: 'right', toSide: 'top', toAt: 0.5, tag: '1.20', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 },
      { from: 'cl-adv', to: 'cl-surr', kind: 'data', fromSide: 'right', toSide: 'bottom', toAt: 0.5, tag: '+0.80', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 },
      { from: 'cl-surr', to: 'cl-min', kind: 'data', fromSide: 'right', toSide: 'left', fromAt: 0.3, midX: 161, tag: '1.04 | 0.96', tagStyle: 'plain', tagSide: 'above', tagSeg: 0, tagT: 0.5 },
      { from: 'cl-min', to: 'cl-mean', kind: 'data', fromSide: 'bottom', toSide: 'top', tag: '0.96 · grad 0', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido: una muestra del minibatch', steps: [
        { nodes: ['cl-mb', 'cl-actor', 'cl-old', 'cl-ratio'], edges: ['cl-mb>cl-actor', 'cl-actor>cl-ratio', 'cl-old>cl-ratio'], tensors: [],
          text: 'El actor recalcula log π_θ(a|s) = −1.84 para la acción guardada; el buffer tiene log π_old = −2.10. r = e^{0.26} ≈ 1.30: la acción ya es 30 % más probable que en el rollout.' },
        { nodes: ['cl-clip', 'cl-adv', 'cl-surr'], edges: ['cl-ratio>cl-clip', 'cl-ratio>cl-surr', 'cl-clip>cl-surr', 'cl-adv>cl-surr'], tensors: [],
          text: 'Recortado a [0.8, 1.2]: 1.20. Con Â = +0.80: r·Â = 1.04 y clip(r)·Â = 0.96.' },
        { nodes: ['cl-min', 'cl-mean'], edges: ['cl-surr>cl-min', 'cl-min>cl-mean'], tensors: [],
          text: 'min = 0.96, el recortado: esta muestra ya no empuja (gradiente 0). Con Â = −0.80 ganaría −1.04 (sin recortar) y el gradiente bajaría r. Se promedian las M = ' + K('metrics.minibatchSize') + ' muestras, con signo menos.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) GAE por dentro (calc:false: una pasada hacia atrás, sin parámetros)
  // Ejemplo (γ = 0.99, λ = 0.95, γλ = 0.9405), los 3 últimos pasos de un episodio que termina: r = (0, 0, 1), V = (0.5, 0.6, 0.8):
  //   δ₂ = 1 − 0.8 = 0.200; δ₁ = 0.99·0.8 − 0.6 = 0.192; δ₀ = 0.99·0.6 − 0.5 = 0.094
  //   Â₂ = 0.200; Â₁ = 0.192 + 0.9405·0.200 = 0.380; Â₀ = 0.094 + 0.9405·0.3801 = 0.451; R = Â + V = (0.951, 0.980, 1.000)
  register(Object.assign({
    id: 'gae', model: 'rl-ppo', inheritConfig: C, calc: false, calcNote: 'Una pasada hacia atrás sobre el buffer (sin parámetros): los números son un ejemplo de 3 pasos; T × N y γ, λ de la config van en el texto.',
    kind: 'arch', title: 'GAE por dentro', parent: 'ppo-overview', parentNode: 'gae',
    caption: 'Generalized Advantage Estimation sobre el buffer de T × N = ' + K('tensor.rollout.shape') + ' transiciones. Primero el error TD de cada paso, δ_t = r_t + γ·V(s_{t+1}) − V(s_t) (cero de bootstrap si el episodio terminó; si el rollout se cortó, V del último estado). Después una recursión hacia atrás, del último paso al primero: la ventaja de cada paso es su δ más γλ veces la ventaja del paso siguiente, o sea la suma Σ (γλ)ˡ δ_{t+l}. El objetivo del crítico es R = Â + V(s_t). γ = ' + K('metrics.gamma') + ' descuenta el futuro; λ = ' + K('metrics.lambda') + ' elige cuánto confiar en el crítico (λ = 0: un paso, TD; λ = 1: Monte Carlo). Ejemplo: los 3 últimos pasos de un episodio, r = (0, 0, 1), V = (0.5, 0.6, 0.8).',
    grid: { w: 160, h: 44 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['ga-delta', 'ga-scan'], mobileFocusPad: 1,
    opLegend: { tensorop: 'Sin parámetros (elemento a elemento o recursión)', mlp: 'Crítico V_φ (sin gradiente aquí)', io: 'Del buffer / hacia la actualización' },
    edgeLegend: { data: 'Vectores de T × N (en la etiqueta, qué llevan)' },
    legendText: { runs: 'Veces que corre: una por paso, de atrás hacia adelante (Â_{t+1} entra al paso t)' },
    nodes: [
      { id: 'ga-buffer', op: 'io', style: 'store', label: 'Buffer', sub: 'r_t, V(s_t), done_t\nej. r = (0, 0, 1)\nV = (0.5, 0.6, 0.8)', x: 2, y: 4, w: 22, h: 17,
        note: 'De cada transición se usan la recompensa, el valor guardado y si el episodio terminó ahí. Las acciones y log-probs no intervienen.' },
      { id: 'ga-boot', op: 'mlp', label: 'V(s_T)', sub: 'crítico, última obs.', x: 32, y: 26, w: 22, h: 9,
        note: 'Para el último paso hace falta V del estado siguiente: el crítico corre una vez más sobre la última observación (bootstrap). Si ese entorno terminó, se multiplica por (1 − done) = 0.' },
      { id: 'ga-delta', op: 'tensorop', shape: 'rect', label: 'Error TD', sub: 'δ_t = r_t + γ(1 − d_t)V_{t+1} − V_t\nej. δ = (0.094, 0.192, 0.200)', x: 34, y: 6, w: 34, h: 13,
        tex: '\\delta_t = r_t + \\gamma\\,(1 - d_t)\\,V(s_{t+1}) - V(s_t)', note: '¿Cuánto mejor (o peor) salió el paso que lo que el crítico esperaba? Todos los t a la vez (vectorizado). Ejemplo: δ = (0.094, 0.192, 0.200).' },
      { id: 'ga-scan', op: 'tensorop', shape: 'rect', label: 'Recursión hacia atrás', sub: 'Â_t = δ_t + γλ(1 − d_t)Â_{t+1}\nej. Â = (0.451 ← 0.380 ← 0.200)', runs: '× T, de t = T − 1 a 0', x: 78, y: 6, w: 36, h: 13,
        tex: '\\hat A_t = \\delta_t + \\gamma\\lambda\\,(1 - d_t)\\,\\hat A_{t+1} = \\textstyle\\sum_{l\\ge 0} (\\gamma\\lambda)^l\\,\\delta_{t+l}', note: 'Un bucle de T pasos (en CleanRL: <code>lastgaelam = delta + gamma * gae_lambda * nextnonterminal * lastgaelam</code>), vectorizado sobre los N entornos. Ejemplo con γλ = 0.9405: Â₂ = 0.200, Â₁ = 0.380, Â₀ = 0.451.' },
      { id: 'ga-adv', op: 'io', label: 'Â', sub: 'T × N → minibatches', x: 124, y: 6, w: 32, h: 13, note: 'Las ventajas: a la pérdida PPO-clip (normalizadas: por minibatch en CleanRL, en el batch entero en <code>rsl_rl</code>).' },
      { id: 'ga-ret', op: 'tensorop', shape: 'add', label: 'R_t = Â_t + V_t', labelPos: 'left', x: 98, y: 27, w: 5, h: 5,
        tex: 'R_t = \\hat A_t + V(s_t)', note: 'El retorno con el que se entrena el crítico (el "TD(λ) return"). Ejemplo: R = (0.951, 0.980, 1.000).' },
      { id: 'ga-retout', op: 'io', label: 'R', sub: 'T × N → pérdida del valor\nej. R = (0.951, 0.980, 1.000)', x: 124, y: 23, w: 32, h: 13, note: 'Los retornos: objetivo de la pérdida del valor.' },
    ],
    edges: [
      { from: 'ga-buffer', to: 'ga-delta', kind: 'data', toAt: 0.5, fromAt: 0.5, tag: 'r, V, d', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ga-boot', to: 'ga-delta', kind: 'data', fromSide: 'top', toSide: 'bottom', fromAt: 0.5, toAt: 0.2647, tag: 'bootstrap', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'ga-delta', to: 'ga-scan', kind: 'data', tag: 'δ', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ga-scan', to: 'ga-adv', kind: 'data', tag: 'Â', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ga-scan', to: 'ga-ret', kind: 'data', fromSide: 'bottom', toSide: 'top', fromAt: 0.583, tag: 'Â', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'ga-buffer', to: 'ga-ret', kind: 'data', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.75, toAt: 0.5, via: [[18.5, 40.5], [100.5, 40.5]], tag: 'V', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.62 },
      { from: 'ga-ret', to: 'ga-retout', kind: 'data', tag: 'R', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido: los 3 últimos pasos de un episodio', steps: [
        { nodes: ['ga-buffer', 'ga-boot', 'ga-delta'], edges: ['ga-buffer>ga-delta', 'ga-boot>ga-delta'], tensors: [],
          text: 'r = (0, 0, 1), V = (0.5, 0.6, 0.8) y el episodio termina tras el último paso (V siguiente = 0). δ₂ = 1 − 0.8 = 0.200; δ₁ = 0.99·0.8 − 0.6 = 0.192; δ₀ = 0.99·0.6 − 0.5 = 0.094.' },
        { nodes: ['ga-scan', 'ga-adv'], edges: ['ga-delta>ga-scan', 'ga-scan>ga-adv'], tensors: [],
          text: 'De atrás hacia adelante con γλ = 0.9405: Â₂ = 0.200; Â₁ = 0.192 + 0.9405·0.200 = 0.380; Â₀ = 0.094 + 0.9405·0.380 = 0.451. El premio del final llega, descontado, a los pasos de antes.' },
        { nodes: ['ga-ret', 'ga-retout'], edges: ['ga-scan>ga-ret', 'ga-buffer>ga-ret', 'ga-ret>ga-retout'], tensors: [],
          text: 'R = Â + V = (0.951, 0.980, 1.000): el objetivo del crítico. En la config: ' + K('tensor.rollout.shape') + ' transiciones por iteración.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
