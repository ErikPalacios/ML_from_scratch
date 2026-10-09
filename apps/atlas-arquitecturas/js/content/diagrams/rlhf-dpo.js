/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/rlhf-dpo.js
   Diagramas de SFT → RLHF (PPO) y DPO (SPEC §7.2, ids de §22.2), modelo `rlhf-dpo` (js/arch/finetune.js):
     rlhf-pipeline     las 3 etapas de InstructGPT en carriles: 1) SFT sobre demostraciones; 2) reward model (el SFT con una
                       cabeza D → 1) con pares de preferencia y Bradley–Terry; 3) PPO: la política genera, la referencia
                       (congelada), el reward model (congelado) y el crítico puntúan, y la actualización PPO (se abre en
                       ppo-step). Marcas congelado / entrena por modelo; las flechas punteadas dicen de dónde se inicializa cada
                       modelo. Config rlhf-llama3-8b (los 4 modelos, Llama 3 8B).
       ppo-step        un lote de PPO: prompts → la política genera → referencia, reward model y crítico leen prompt + respuesta →
                       KL por token contra la referencia → recompensa por token (−β·KL, + r_φ al final) → ventajas (GAE con el
                       crítico) → PPO-clip y la pérdida del crítico; el bucle "× épocas por lote" actualiza π_θ y V_ψ. Abajo, el
                       cómputo del paso (generación / puntuar / actualizar) de ATLAS.Arch.metrics.
     dpo-step          un paso de DPO (config dpo-llama3-8b; también dpo-llama3-8b-lora): (x, y_w, y_l) → política y referencia,
                       dos secuencias cada una → log-probs sumados → pérdida DPO; sin reward model, sin generar, sin crítico.
     memory-by-method  memoria de un paso por método (PPO 4 modelos, DPO 2, GRPO 2 + G respuestas): barras apiladas por rol, de
                       metrics de cada config, con líneas de 1–4 GPU de 80 GB. Vive en la sección "costo".
   Notas y captions con claves SIN prefijo ({{metrics.x}}, {{quantities.x}}): siguen la config dibujada; los recorridos usan
   la canónica (lo dicen).
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'rlhf-llama3-8b', CD = 'dpo-llama3-8b';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const qd = (k) => '{{' + CD + '.' + k + '}}';
  const PAGE = { page: 'rlhf-dpo', section: 'diagrama' };

  // ------------------------------------------------------------------ (a) el pipeline de RLHF
  ATLAS.registerDiagram(Object.assign({
    id: 'rlhf-pipeline', model: 'rlhf-dpo', config: C, configs: [C], configsNote: 'el pipeline es el de PPO; DPO y GRPO tienen sus vistas', kind: 'arch', title: 'RLHF: SFT → reward model → PPO',
    caption: 'Las tres etapas de InstructGPT, cada una con su dato y su pérdida. 1) SFT: el modelo base imita demostraciones escritas por personas. 2) Reward model: el SFT con una cabeza escalar aprende a puntuar respuestas a partir de pares "esta es mejor que esta" (Bradley–Terry). 3) PPO: la política genera respuestas, el reward model (congelado) las puntúa, la referencia (el SFT congelado) penaliza alejarse con un KL y el crítico estima el valor; la actualización recortada mueve la política. Flechas punteadas: de dónde parte cada modelo. Cada caja es un Llama 3 8B: en la etapa 3 hay cuatro a la vez.',
    grid: { w: 124, h: 85 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['policy', 'reference'], mobileFocusPad: 3,
    edgeLegend: { control: 'Inicializa (o copia) otro modelo; en PPO, el bucle de actualización' },
    legendText: { runs: 'Veces que se repite por lote de rollouts', loop: 'Bucle: se repite en cada lote' },
    groups: [
      { id: 'stage-sft', label: '1 · SFT: imitar demostraciones', hideInBlank: true, x: 1, y: 1, w: 122, h: 16 },
      { id: 'stage-rm', label: '2 · Reward model: aprender a preferir', hideInBlank: true, x: 1, y: 20, w: 122, h: 16 },
      { id: 'stage-ppo', label: '3 · PPO: optimizar la recompensa con KL a la referencia', hideInBlank: true, x: 1, y: 39, w: 122, h: 45 },
    ],
    nodes: [
      { id: 'demos', op: 'io', modality: 'txt', label: 'Demostraciones', sub: '(prompt, respuesta escrita)', x: 3, y: 6, w: 24, h: 8,
        note: 'Pares (prompt, respuesta) escritos por anotadores: ≈ 13 mil prompts en InstructGPT. Cada secuencia, T = {{quantities.T}} tokens en esta config.' },
      { id: 'sft', op: 'attn', style: 'block', costOf: 'policy', label: 'Modelo SFT', sub: 'base → SFT', train: 'trained', x: 38, y: 5, w: 26, h: 10,
        note: 'El modelo base (Llama 3 8B, {{metrics.policyParams}} parámetros) con fine-tuning supervisado: la pérdida next-token, solo sobre los tokens de la respuesta. Es el punto de partida de todo lo demás.' },
      { id: 'sft-loss', op: 'head', label: 'Cross-entropy', sub: 'next-token, solo la respuesta', x: 84, y: 6, w: 34, h: 8,
        tex: '\\mathcal{L}_{\\text{SFT}} = -\\textstyle\\sum_{t \\in y} \\log \\pi(y_t \\mid x, y_{<t})', note: 'La pérdida de siempre de un LLM, enmascarando el prompt.' },
      { id: 'pairs', op: 'io', modality: 'txt', label: 'Pares de preferencia', sub: '(x, y_w, y_l)', x: 3, y: 25, w: 24, h: 8,
        note: 'Para cada prompt, respuestas del SFT que un anotador ordena: y_w (elegida) ≻ y_l (rechazada). InstructGPT junta K = 4 a 9 respuestas por prompt y entrena con los K(K−1)/2 pares.' },
      { id: 'reward-model', op: 'attn', style: 'block', costOf: 'reward', label: 'Reward model r_φ', sub: 'SFT + cabeza D → 1', train: 'trained', x: 64, y: 24, w: 28, h: 10,
        note: 'El mismo transformer sin LM head, con una lineal D → 1 sobre el último token ({{metrics.rewardParams}} parámetros): una nota escalar por respuesta. Parte del SFT.' },
      { id: 'bt-loss', op: 'head', label: 'Bradley–Terry', sub: '−log σ(r_w − r_l)', x: 98, y: 25, w: 20, h: 8,
        tex: '\\mathcal{L} = -\\log \\sigma\\big(r_\\phi(x, y_w) - r_\\phi(x, y_l)\\big)', note: 'Solo importa la diferencia de las dos notas: la recompensa queda definida a menos de una constante.' },
      { id: 'prompts', op: 'io', modality: 'txt', label: 'Prompts', sub: 'sin respuesta', x: 3, y: 59, w: 18, h: 8,
        note: 'Solo prompts: las respuestas las genera la política en cada lote (B = {{quantities.B}} prompts por paso, T_r = {{quantities.Tr}} tokens de respuesta).' },
      { id: 'policy', op: 'attn', style: 'block', costOf: 'policy', label: 'Política π_θ', sub: 'genera y ~ π_θ(·|x)', train: 'trained', x: 28, y: 58, w: 26, h: 10,
        note: 'Parte del SFT y es lo único que se entrega al final. Genera {{metrics.generationTokensPerStep}} tokens por paso (rollout) y se actualiza con PPO.' },
      { id: 'reward', op: 'attn', style: 'block', costOf: 'reward', label: 'Reward model', sub: 'puntúa x + y', train: 'frozen', x: 64, y: 46, w: 28, h: 10,
        note: 'El de la etapa 2, congelado: una nota r_φ(x, y) por respuesta ({{metrics.rewardWeightBytes}} de pesos en bf16).' },
      { id: 'reference', op: 'attn', style: 'block', costOf: 'reference', label: 'Referencia π_ref', sub: 'el SFT, congelado', train: 'frozen', x: 64, y: 59, w: 28, h: 10,
        note: 'Una copia congelada del SFT: sus log-probs dan el KL por token que impide que la política se aleje (y "hackee" el reward model).' },
      { id: 'critic', op: 'attn', style: 'block', costOf: 'critic', label: 'Crítico V_ψ', sub: 'valor por token · parte del RM', train: 'trained', x: 64, y: 72, w: 28, h: 10,
        note: 'Estima el valor de cada prefijo para las ventajas (GAE); InstructGPT lo inicializa desde el reward model. Se entrena junto con la política ({{metrics.criticParams}} parámetros más con su optimizador).' },
      { id: 'ppo', op: 'head', label: 'Actualización PPO', sub: 'KL · GAE · clip', ops: ['kl', 'shaped-reward', 'gae', 'ppo-loss', 'value-loss'], opsExact: true, runs: '× {{quantities.ppoEpochs}} épocas', expand: 'ppo-step', x: 102, y: 58, w: 20, h: 12,
        note: 'KL por token contra la referencia, recompensa con penalización, ventajas con el crítico (GAE), la pérdida PPO-clip y la del crítico; {{quantities.ppoEpochs}} pasadas por lote. Ábrelo para ver el paso.' },
    ],
    edges: [
      { from: 'demos', to: 'sft', kind: 'data', tensor: 'ids', labelSide: 'above', labelT: 0.5 },
      { from: 'sft', to: 'sft-loss', kind: 'data', tensor: 'pol-logits', labelSide: 'above', labelT: 0.5 },
      { from: 'pairs', to: 'reward-model', kind: 'data', tensor: 'ids', labelSide: 'above', labelT: 0.35, tag: '× 2 (y_w, y_l)', tagStyle: 'plain', tagSide: 'below', tagT: 0.35 },
      { from: 'reward-model', to: 'bt-loss', kind: 'data', tensor: 'reward', label: false, tag: 'r_w, r_l', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'sft', to: 'reward-model', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.85, toAt: 0.6, tag: 'parte del SFT', tagBlank: 'inicializa', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 'sft', to: 'policy', kind: 'control', fromSide: 'left', toSide: 'top', fromAt: 0.8, toAt: 0.42, via: [[33, 13], [33, 18.5], [0.4, 18.5], [0.4, 53], [38.9, 53]], tag: 'π_θ y π_ref parten del SFT', tagBlank: 'inicializa', tagStyle: 'plain', tagSide: 'on', tagSeg: 4, tagT: 0.55 },
      { from: 'reward-model', to: 'reward', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.5, tag: 'copia congelada', tagStyle: 'plain', tagSide: 'on', tagT: 0.45 },
      { from: 'prompts', to: 'policy', kind: 'data', tensor: 'ids', label: false },
      { from: 'policy', to: 'reward', kind: 'data', tensor: 'ids', fromAt: 0.2, toAt: 0.5, label: false },
      { from: 'policy', to: 'reference', kind: 'data', tensor: 'ids', fromAt: 0.5, toAt: 0.5, label: false, tag: 'x + y', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'policy', to: 'critic', kind: 'data', tensor: 'ids', fromAt: 0.8, toAt: 0.5, label: false },
      { from: 'reward', to: 'ppo', kind: 'data', tensor: 'reward', toAt: 0.2, label: false, tag: 'r_φ', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.25 },
      { from: 'reference', to: 'ppo', kind: 'data', tensor: 'ref-logp', toAt: 0.5, label: false, tag: 'log π_ref', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.35 },
      { from: 'critic', to: 'ppo', kind: 'data', tensor: 'values', toAt: 0.8, label: false, tag: 'V', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.25 },
      { from: 'ppo', to: 'policy', kind: 'control', fromSide: 'top', toSide: 'top', fromAt: 0.5, toAt: 0.6, via: [[112, 42.5], [43.6, 42.5]], tag: 'actualiza π_θ (y V_ψ) · cada lote', tagBlank: 'actualiza · cada lote', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.85, loop: true },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido (RLHF con PPO, Llama 3 8B)', steps: [
        { nodes: ['demos', 'sft', 'sft-loss'], edges: ['demos>sft', 'sft>sft-loss'], tensors: ['ids', 'pol-logits'],
          text: 'Etapa 1: el modelo base ve demostraciones (secuencias de <b>' + q('tensor.ids.shape') + '</b> tokens) y aprende a imitarlas con la pérdida next-token: logits <b>' + q('tensor.pol-logits.shape') + '</b>.' },
        { nodes: ['pairs', 'reward-model', 'bt-loss'], edges: ['pairs>reward-model', 'reward-model>bt-loss', 'sft>reward-model'], tensors: ['ids', 'reward'],
          text: 'Etapa 2: el SFT con una cabeza D → 1 da UNA nota por respuesta (<b>' + q('tensor.reward.shape') + '</b>); con pares (y_w, y_l) aprende −log σ(r_w − r_l). ' + q('metrics.rewardParams') + ' parámetros.' },
        { nodes: ['prompts', 'policy'], edges: ['prompts>policy', 'sft>policy'], tensors: [],
          text: 'Etapa 3: la política (copia del SFT) genera respuestas para ' + q('quantities.B') + ' prompts: ' + q('metrics.generationTokensPerStep') + ' tokens por paso, uno a uno.' },
        { nodes: ['reward', 'reference', 'critic'], edges: ['policy>reward', 'policy>reference', 'policy>critic', 'reward-model>reward'], tensors: [],
          text: 'Tres modelos más leen prompt + respuesta: el reward model (congelado) da r_φ, la referencia (congelada) sus log-probs, el crítico un valor por token. En memoria: ' + q('metrics.modelsInMemory') + ' modelos, ' + q('metrics.totalTrainMemory') + ' con AdamW.' },
        { nodes: ['ppo', 'policy'], edges: ['reward>ppo', 'reference>ppo', 'critic>ppo', 'ppo>policy'], tensors: [],
          text: 'PPO: recompensa con penalización KL, ventajas con GAE y la pérdida recortada; ' + q('quantities.ppoEpochs') + ' épocas por lote y vuelta a generar. Ábrelo para el detalle.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) un paso de PPO
  ATLAS.registerDiagram(Object.assign({
    id: 'ppo-step', model: 'rlhf-dpo', config: C, configs: [C], configsNote: 'es el paso de PPO', kind: 'arch', title: 'Un paso de PPO en RLHF',
    parent: 'rlhf-pipeline', parentNode: 'ppo',
    caption: 'Un lote de PPO. La política genera la respuesta a cada prompt (rollout). La referencia, el reward model y el crítico leen prompt + respuesta. El KL por token contra la referencia se resta a la recompensa (r_φ llega solo en el último token); con los valores del crítico, GAE da la ventaja de cada token. La pérdida PPO-clip actualiza la política (sin alejarse más de 1 ± ε del paso anterior) y el crítico aprende los retornos; se repite unas épocas y se vuelve a generar. Abajo, dónde se va el cómputo del paso.',
    grid: { w: 134, h: 62 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['kl', 'shaped-reward', 'advantage', 'ppo-loss'], mobileFocusPad: 2, blankCrop: true,
    edgeLegend: { control: 'Bucle de actualización (cada lote)' },
    legendText: { runs: 'Veces que corre por paso', loop: 'Bucle: se repite en cada lote', costSplit: 'Cómputo por paso: ancho proporcional a los MACs (del calculador)' },
    nodes: [
      { id: 'prompts', op: 'io', modality: 'txt', label: 'Prompts', sub: 'B por paso', subNum: 'B = {{quantities.B}}', x: 1, y: 17, w: 14, h: 9, note: 'Un lote de {{quantities.B}} prompts de {{quantities.Tp}} tokens.' },
      { id: 'ppo-policy', op: 'attn', style: 'block', costOf: 'policy', label: 'Política π_θ', sub: 'genera T_r tokens\nluego log π_θ', subNum: 'genera {{quantities.Tr}} tokens\nluego log π_θ', train: 'trained', x: 20, y: 6, w: 22, h: 30,
        note: 'Genera T_r = {{quantities.Tr}} tokens por prompt ({{metrics.generationTokensPerStep}} por paso: un decode por token, {{metrics.rolloutMacs}}) y después calcula los log-probs "old" de la respuesta en una pasada.' },
      { id: 'ppo-reference', op: 'attn', style: 'block', costOf: 'reference', label: 'Referencia π_ref', sub: 'log π_ref', train: 'frozen', x: 54, y: 5, w: 24, h: 8, note: 'Un forward sobre prompt + respuesta: los log-probs de la referencia (congelada).' },
      { id: 'ppo-reward', op: 'attn', style: 'block', costOf: 'reward', label: 'Reward model', sub: 'r_φ(x, y)', train: 'frozen', x: 54, y: 17, w: 24, h: 8, note: 'Un forward: la nota escalar de la respuesta entera (el score del último token).' },
      { id: 'ppo-critic', op: 'attn', style: 'block', costOf: 'critic', label: 'Crítico V_ψ', sub: 'V por token', train: 'trained', x: 54, y: 29, w: 24, h: 8, note: 'Un forward: el valor estimado en cada posición de la respuesta.' },
      { id: 'kl', op: 'tensorop', shape: 'rect', label: 'KL por token', sub: 'log π_θ − log π_ref', ops: ['kl'], opsExact: true, x: 86, y: 5, w: 22, h: 8,
        tex: '\\mathrm{KL}_t = \\log \\pi_\\theta(y_t) - \\log \\pi_{\\text{ref}}(y_t)', note: 'El estimador k1 del KL, por token de la respuesta (sin parámetros).' },
      { id: 'shaped-reward', op: 'tensorop', shape: 'rect', label: 'Recompensa por token', sub: '−β·KL_t (+ r_φ al final)', ops: ['shaped-reward'], opsExact: true, x: 86, y: 17, w: 22, h: 8,
        tex: 'r_t = -\\beta\\,\\mathrm{KL}_t + [t = T]\\, r_\\phi(x, y)', note: 'La penalización KL en cada token y la nota del reward model solo en el último (β = {{quantities.beta}}).' },
      { id: 'advantage', op: 'tensorop', shape: 'rect', label: 'Ventajas (GAE)', sub: 'Â_t con V_ψ', ops: ['gae'], opsExact: true, x: 86, y: 29, w: 22, h: 8,
        tex: '\\hat A_t = \\textstyle\\sum_l (\\gamma\\lambda)^l \\delta_{t+l},\\; \\delta_t = r_t + \\gamma V(s_{t+1}) - V(s_t)', note: 'Generalized Advantage Estimation: cuánto mejor fue cada token que lo que el crítico esperaba.' },
      { id: 'ppo-loss', op: 'head', label: 'PPO-clip', sub: 'min(ρÂ, clip(ρ)·Â)', ops: ['ppo-loss'], opsExact: true, x: 113, y: 5, w: 20, h: 8,
        tex: '-\\min\\big(\\rho_t \\hat A_t,\\ \\mathrm{clip}(\\rho_t, 1-\\epsilon, 1+\\epsilon)\\hat A_t\\big),\\; \\rho_t = \\tfrac{\\pi_\\theta}{\\pi_{\\theta_{\\text{old}}}}', note: 'El cociente con la política "old" se recorta a 1 ± ε (ε = {{quantities.clipEps}}): pasos chicos y estables.' },
      { id: 'value-loss', op: 'head', label: 'Pérdida del crítico', sub: '(V − retorno)²', ops: ['value-loss'], opsExact: true, x: 113, y: 29, w: 20, h: 8, note: 'El crítico aprende los retornos (Â + V).' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Cómputo de un paso (MACs)', x: 1, y: 46, w: 132, h: 15,
        costSplit: { segs: [
          { op: 'attn', n: 'metrics.rolloutMacs', label: 'Generar las respuestas (rollout)' },
          { tone: 'once', n: 'metrics.scoringMacs', label: 'Puntuar: referencia, reward model, log-probs y valores "old"' },
          { op: 'conv', n: 'metrics.policyUpdateMacs', label: 'Actualizar la política (× {{quantities.ppoEpochs}} épocas)' },
          { op: 'fuse', n: 'metrics.criticUpdateMacs', label: 'Actualizar el crítico' },
        ], caption: 'total {{metrics.trainStepMacs}} por paso ({{quantities.B}} prompts); la generación es {{metrics.rolloutShare}} del cómputo, pero corre token a token (limitada por memoria)' },
        note: 'MACs de un paso, del calculador (forward + backward + recomputación con gradient checkpointing). La actualización domina el cómputo; el rollout pesa poco en MACs pero es lento en tiempo: se genera un token por vez.' },
    ],
    edges: [
      { from: 'prompts', to: 'ppo-policy', kind: 'data', tensor: 'ids', label: false, tag: 'x', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'ppo-policy', to: 'ppo-reference', kind: 'data', tensor: 'ids', fromAt: 0.1, toAt: 0.5, labelSide: 'above', labelT: 0.5 },
      { from: 'ppo-policy', to: 'ppo-reward', kind: 'data', tensor: 'ids', fromAt: 0.5, toAt: 0.5, label: false, tag: 'x + y', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'ppo-policy', to: 'ppo-critic', kind: 'data', tensor: 'ids', fromAt: 0.9, toAt: 0.5, label: false },
      { from: 'ppo-policy', to: 'kl', kind: 'data', tensor: 'pol-logp', fromSide: 'top', toSide: 'top', fromAt: 0.545, toAt: 0.5, via: [[32, 2.5], [97, 2.5]], label: false, tag: 'log π_θ', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.6 },
      { from: 'ppo-policy', to: 'ppo-loss', kind: 'data', tensor: 'pol-logp', fromSide: 'top', toSide: 'top', fromAt: 0.42, toAt: 0.5, via: [[29.2, 0.6], [123, 0.6]], label: false, tag: 'log π_θ (old)', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.86 },
      { from: 'ppo-reference', to: 'kl', kind: 'data', tensor: 'ref-logp', label: false },
      { from: 'ppo-reward', to: 'shaped-reward', kind: 'data', tensor: 'reward', label: false, tag: 'r_φ', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'kl', to: 'shaped-reward', kind: 'data', tensor: 'kl', fromSide: 'bottom', toSide: 'top', label: false },
      { from: 'shaped-reward', to: 'advantage', kind: 'data', tensor: 'rewards', fromSide: 'bottom', toSide: 'top', labelSide: 'right', labelT: 0.5 },
      { from: 'ppo-critic', to: 'advantage', kind: 'data', tensor: 'values', labelSide: 'below', labelT: 0.5 },
      { from: 'advantage', to: 'ppo-loss', kind: 'data', tensor: 'advantages', fromAt: 0.3, toSide: 'left', toAt: 0.5, midX: 110.5, labelSide: 'right', labelSeg: 1, labelT: 0.5 },
      { from: 'advantage', to: 'value-loss', kind: 'data', tensor: 'returns', fromAt: 0.7, toAt: 0.7, label: false },
      { from: 'ppo-loss', to: 'ppo-policy', kind: 'control', fromSide: 'right', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[133.6, 9], [133.6, 42.5], [31, 42.5]], tag: 'actualiza π_θ · × {{quantities.ppoEpochs}} épocas por lote', tagStyle: 'plain', tagSide: 'on', tagSeg: 2, tagT: 0.55, loop: true },
      { from: 'value-loss', to: 'ppo-critic', kind: 'control', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[123, 39.8], [66, 39.8]], tag: 'actualiza V_ψ', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (PPO, B = 8 prompts)', steps: [
        { nodes: ['prompts', 'ppo-policy'], edges: ['prompts>ppo-policy'], tensors: ['ids'],
          text: 'Rollout: para cada uno de los ' + q('quantities.B') + ' prompts la política genera ' + q('quantities.Tr') + ' tokens (' + q('metrics.generationTokensPerStep') + ' por paso), uno por vez.' },
        { nodes: ['ppo-reference', 'ppo-reward', 'ppo-critic'], edges: ['ppo-policy>ppo-reference', 'ppo-policy>ppo-reward', 'ppo-policy>ppo-critic'], tensors: ['ids'],
          text: 'Prompt + respuesta (<b>' + q('tensor.ids.shape') + '</b> tokens) pasan por la referencia, el reward model y el crítico: tres forwards de un 8B por secuencia.' },
        { nodes: ['kl', 'shaped-reward'], edges: ['ppo-policy>kl', 'ppo-reference>kl', 'kl>shaped-reward', 'ppo-reward>shaped-reward'], tensors: ['pol-logp', 'ref-logp', 'kl', 'rewards'],
          text: 'KL por token (<b>' + q('tensor.kl.shape') + '</b>) = log π_θ − log π_ref; la recompensa por token es −β·KL (β = ' + q('quantities.beta') + ') y r_φ se suma en el último.' },
        { nodes: ['advantage', 'ppo-critic'], edges: ['shaped-reward>advantage', 'ppo-critic>advantage'], tensors: ['rewards', 'values', 'advantages'],
          text: 'GAE con los valores del crítico (<b>' + q('tensor.values.shape') + '</b>): una ventaja por token, <b>' + q('tensor.advantages.shape') + '</b>.' },
        { nodes: ['ppo-loss', 'value-loss'], edges: ['advantage>ppo-loss', 'ppo-policy>ppo-loss', 'advantage>value-loss', 'ppo-loss>ppo-policy', 'value-loss>ppo-critic'], tensors: ['advantages', 'returns'],
          text: 'PPO-clip (ε = ' + q('quantities.clipEps') + ') actualiza la política y el crítico aprende los retornos: ' + q('quantities.ppoEpochs') + ' épocas sobre el mismo lote y se vuelve a generar.' },
        { nodes: ['cost'], edges: [], tensors: [],
          text: 'Un paso cuesta ' + q('metrics.trainStepMacs') + ': la actualización es ' + q('metrics.updateShare') + ', la generación ' + q('metrics.rolloutShare') + ' (pocos MACs, mucho tiempo: un token por vez).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) un paso de DPO
  ATLAS.registerDiagram(Object.assign({
    id: 'dpo-step', model: 'rlhf-dpo', config: CD, configs: [CD, 'dpo-llama3-8b-lora'], configsNote: 'es el paso de DPO', kind: 'arch', title: 'Un paso de DPO',
    caption: 'DPO entrena directamente con los pares de preferencia: la política y la referencia (congelada) calculan el log-prob de la respuesta elegida y de la rechazada (dos secuencias por par), y la pérdida empuja hacia arriba la diferencia β·[(log π_θ − log π_ref)(y_w) − (log π_θ − log π_ref)(y_l)]. Sin reward model, sin generar respuestas, sin crítico: dos modelos en memoria (uno con LoRA: la referencia es la base con los adaptadores apagados).',
    grid: { w: 100, h: 54 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['dpo-policy', 'dpo-reference'], mobileFocusPad: 2, blankCrop: true,
    edgeLegend: { control: 'El gradiente: solo actualiza la política' },
    legendText: { runs: 'Veces que corre por par', costSplit: 'Cómputo por paso: ancho proporcional a los MACs (del calculador)' },
    nodes: [
      { id: 'pairs', op: 'io', modality: 'txt', label: 'Par (x, y_w, y_l)', sub: 'B pares por paso', subNum: 'B = {{quantities.B}} pares', x: 1, y: 13, w: 18, h: 10,
        note: 'Un prompt con dos respuestas ya ordenadas por personas (o por otro modelo): ninguna se genera en el paso. Cada secuencia, T = {{quantities.T}} tokens.' },
      { id: 'dpo-policy', op: 'attn', style: 'block', costOf: 'policy', label: 'Política π_θ', sub: 'log π_θ(y_w), log π_θ(y_l)', train: 'trained', runs: '× 2 (y_w, y_l)', x: 26, y: 3, w: 35, h: 10,
        note: 'Dos forwards (elegida y rechazada; en la práctica, concatenadas en un lote) y la suma de los log-probs de los tokens de cada respuesta.' },
      { id: 'dpo-reference', op: 'attn', style: 'block', costOf: 'reference', label: 'Referencia π_ref', sub: 'log π_ref(y_w), log π_ref(y_l)', train: 'frozen', runs: '× 2 (y_w, y_l)', x: 26, y: 23, w: 35, h: 10,
        note: 'El modelo SFT congelado: los mismos dos log-probs, sin gradiente (con refOffload se precalculan una vez para todo el dataset). Con LoRA no ocupa memoria: es la base con los adaptadores apagados.' },
      { id: 'dpo-loss', op: 'head', label: 'Pérdida DPO', sub: '−log σ(β·(Δ_w − Δ_l))', ops: ['dpo-loss'], opsExact: true, x: 68, y: 12, w: 31, h: 12,
        tex: '-\\log \\sigma\\Big(\\beta \\big[\\log \\tfrac{\\pi_\\theta(y_w)}{\\pi_{\\text{ref}}(y_w)} - \\log \\tfrac{\\pi_\\theta(y_l)}{\\pi_{\\text{ref}}(y_l)}\\big]\\Big)',
        note: 'Bradley–Terry con la recompensa implícita β·log(π_θ/π_ref) (β = {{quantities.beta}}): el mismo óptimo que RLHF con KL, sin modelo de recompensa ni rollouts.' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Cómputo de un paso (MACs)', x: 1, y: 40, w: 97, h: 13,
        costSplit: { segs: [
          { tone: 'once', n: 'metrics.scoringMacs', label: 'Referencia: 2 forwards por par' },
          { op: 'conv', n: 'metrics.updateMacs', label: 'Política: forward + backward' },
        ], caption: 'total {{metrics.trainStepMacs}} por paso · {{metrics.modelsInMemory}} modelo(s) en memoria · sin generación' },
        note: 'MACs de un paso de DPO, del calculador. No hay rollout: todo el cómputo es "denso" (prefill), sin decodes token a token.' },
    ],
    notes: [
      { x: 68, y: 29, text: 'no hay: reward model · rollouts · crítico', cls: 'ink' },
    ],
    edges: [
      { from: 'pairs', to: 'dpo-policy', kind: 'data', tensor: 'ids', fromAt: 0.3, toAt: 0.5, labelSide: 'above', labelSeg: -1, labelT: 0.5, tag: '× 2', tagStyle: 'plain', tagSide: 'below', tagSeg: -1, tagT: 0.5 },
      { from: 'pairs', to: 'dpo-reference', kind: 'data', tensor: 'ids', fromAt: 0.7, toAt: 0.5, label: false, tag: '× 2', tagStyle: 'plain', tagSide: 'below', tagSeg: -1, tagT: 0.5 },
      { from: 'dpo-policy', to: 'dpo-loss', kind: 'data', tensor: 'pol-logp', fromAt: 0.5, toAt: 0.25, labelSide: 'above', labelSeg: 0, labelT: 0.5 },
      { from: 'dpo-reference', to: 'dpo-loss', kind: 'data', tensor: 'ref-logp', fromAt: 0.5, toAt: 0.75, labelSide: 'below', labelSeg: 0, labelT: 0.5 },
      { from: 'dpo-loss', to: 'dpo-policy', kind: 'control', fromSide: 'top', toSide: 'right', fromAt: 0.5, toAt: 0.2, via: [[83.5, 1], [64, 1], [64, 5]], tag: 'gradiente: solo π_θ', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (DPO, Llama 3 8B)', steps: [
        { nodes: ['pairs', 'dpo-policy', 'dpo-reference'], edges: ['pairs>dpo-policy', 'pairs>dpo-reference'], tensors: ['ids'],
          text: 'Cada par son dos secuencias de <b>' + qd('tensor.ids.shape') + '</b> tokens (prompt + respuesta); las dos pasan por la política y por la referencia.' },
        { nodes: ['dpo-policy', 'dpo-reference'], edges: ['dpo-policy>dpo-loss', 'dpo-reference>dpo-loss'], tensors: ['pol-logp', 'ref-logp'],
          text: 'Log-probs sumados sobre los tokens de la respuesta: <b>' + qd('tensor.pol-logp.shape') + '</b> números por modelo (y_w, y_l).' },
        { nodes: ['dpo-loss'], edges: ['dpo-loss>dpo-policy'], tensors: [],
          text: 'La pérdida (β = ' + qd('quantities.beta') + ') y su gradiente, solo para la política. ' + qd('metrics.modelsInMemory') + ' modelos en memoria, ' + qd('metrics.totalTrainMemory') + ', sin generar nada.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (d) memoria por método
  const ROLE_SEGS = [
    { n: 'metrics.policyWeightBytes', op: 'mlp', label: 'Política: pesos' },
    { n: ['metrics.policyGradBytes', 'metrics.policyOptimizerBytes'], op: 'conv', label: 'Política: gradientes + AdamW' },
    { n: 'metrics.referenceWeightBytes', op: 'norm', frozen: true, label: 'Referencia (congelada)' },
    { n: 'metrics.rewardWeightBytes', op: 'head', frozen: true, label: 'Reward model (congelado)' },
    { n: ['metrics.criticWeightBytes', 'metrics.criticGradBytes', 'metrics.criticOptimizerBytes'], op: 'fuse', label: 'Crítico: pesos + gradientes + AdamW' },
    { n: 'metrics.activationBytes', mod: 'img', label: 'Activaciones del update (≈)' },
  ];
  ATLAS.registerDiagram(Object.assign({
    id: 'memory-by-method', model: 'rlhf-dpo', config: C, configs: [C, CD, 'grpo-llama3-8b', 'dpo-llama3-8b-lora'], kind: 'arch', title: 'Memoria por método: PPO, DPO y GRPO',
    page: 'rlhf-dpo', section: 'costo',
    caption: 'Qué ocupa la memoria en un paso de alineación de Llama 3 8B (bf16, AdamW, gradient checkpointing, mismos B y T). PPO tiene cuatro modelos a la vez, dos de ellos entrenables con su optimizador; DPO y GRPO, dos (política y referencia). GRPO no tiene crítico pero procesa G respuestas por prompt: sus activaciones crecen con G. Líneas: 1 a 4 GPU de 80 GB (con ZeRO-3 ideal, sin contar comunicación).',
    grid: { w: 82, h: 24 }, direction: 'lr', maxCrossings: 0,
    legendText: { bars: 'Barras: memoria por método y rol, ancho proporcional a los bytes (del calculador); líneas rojas = 1, 2, 3 y 4 GPU de 80 GB' },
    nodes: [
      { id: 'memory-bars', op: 'io', label: 'Memoria por paso', x: 1, y: 1, w: 80, h: 22,
        bars: { unit: 'bytes', labelW: 14, totalW: 21, fits: true,
          lines: [{ v: 80e9, label: '80 GB' }, { v: 160e9, label: '2 × 80' }, { v: 240e9, label: '3 × 80' }, { v: 320e9, label: '4 × 80' }],
          addCur: 'esta: {{metrics.modelsInMemory}} modelo(s)',
          segs: ROLE_SEGS,
          rows: [
            { label: 'PPO · {{metrics.modelsInMemory}} modelos', config: C },
            { label: 'DPO · {{metrics.modelsInMemory}} modelos', config: CD },
            { label: 'GRPO · 2 + G = {{cfg.groupSize}}', config: 'grpo-llama3-8b' },
          ],
          caption: 'B = {{quantities.B}} · T = {{quantities.T}} · KV del rollout ({{metrics.kvCacheBytes}}): otra fase, cuenta el mayor' },
        note: 'Del calculador (ATLAS.Arch.metrics de cada config): pesos de cada rol en bf16, gradientes y AdamW de los entrenables (16 bytes por parámetro entrenable), activaciones del update (≈). Esta config: {{metrics.modelsInMemory}} modelo(s), {{metrics.totalTrainMemory}}, ≈ {{metrics.gpus80Needed}} GPU de 80 GB con ZeRO-3 ideal. DPO con LoRA: {{dpo-llama3-8b-lora.metrics.totalTrainMemory}} (la referencia es la base con los adaptadores apagados).' },
    ],
    edges: [],
    legend: 'auto',
  }, { page: 'rlhf-dpo', section: 'costo' }));
})(typeof window !== 'undefined' ? window : globalThis);
