/* =============================================================================
   Atlas de Arquitecturas — js/arch/finetune.js
   Modelos `lora` (página `lora`) y `rlhf-dpo` (página `rlhf-dpo`); contrato SPEC §22. Tesis: adaptar un modelo preentrenado
   es un problema de MEMORIA y de DATOS, no de arquitectura: LoRA cambia QUÉ se entrena (un delta de rango r), QLoRA CÓMO se
   guarda la base congelada (NF4 de 4 bits), SFT / RLHF / DPO QUÉ señal entrena (demostraciones → preferencias). El calculador
   cuenta parámetros entrenables, memoria (pesos / gradientes / optimizador / activaciones) y MACs por paso de entrenamiento
   sobre el decoder de F6 (js/arch/llm.js, Llama 3 8B), que se COMPONE con A.importGraph (como vlm.js / vla.js): nada se duplica.
   Cargar DESPUÉS de llm.js (y de vla.js, por orden de carga).
   - LoRA: Hu et al., LoRA: Low-Rank Adaptation of Large Language Models, ICLR 2022, arXiv:2106.09685 (§4: h = W₀x + BAx,
     escala α/r, B = 0 al inicio; §7.1 / Tabla 5: W_q y W_v). Implementación de referencia: HF peft 0.21.2 (LoraConfig,
     get_peft_model; lora_dropout aplicado a la entrada de cada adaptador; autocast_adapter_dtype = True → adaptadores en fp32
     si la base es bf16).
   - QLoRA: Dettmers et al., QLoRA: Efficient Finetuning of Quantized LLMs, NeurIPS 2023, arXiv:2305.14314 (§3: NF4, bloques
     de 64; doble cuantización: 8 bits por absmax en bloques de 256 → 0.127 bits por parámetro; optimizadores paginados).
     bitsandbytes NO corre en este Mac: la contabilidad NF4 sale del paper y del código (bitsandbytes.functional.quantize_4bit:
     absmax fp32 por bloque de 64; con compress_statistics, absmax − media → 8 bits por bloque de 256 + absmax fp32 de 2.º nivel
     + 1 offset fp32 por matriz); ver primitives.quant_storage.
   - Memoria del entrenamiento con Adam en precisión mixta: Rajbhandari et al., ZeRO, SC 2020, arXiv:1910.02054, §3.1: 2Ψ (pesos
     fp16) + 2Ψ (gradientes fp16) + 12Ψ (copia fp32 + m + v) = 16Ψ bytes. Adam de 8 bits: Dettmers et al., 8-bit Optimizers via
     Block-wise Quantization, ICLR 2022, arXiv:2110.02861 (m y v en 8 bits: 2 bytes por parámetro + constantes por bloque < 1 %).
   - Activaciones: método de Korthikanti et al., Reducing Activation Recomputation in Large Transformer Models, MLSys 2023,
     arXiv:2205.05198, §4 (contar los tensores que el backward guarda por capa: 34·s·b·h + 5·a·s²·b bytes en su GPT con dropout,
     MLP 4h y atención sin fusionar), ADAPTADO a Llama (RMSNorm, SwiGLU, GQA, sin dropout) con FlashAttention-2 (GQA nativa,
     sin matrices T×T). ≈: ver "activaciones" abajo.
   - RLHF: Ouyang et al., InstructGPT, NeurIPS 2022, arXiv:2203.02155 (SFT → RM con pares → PPO con KL a la referencia);
     Christiano et al. 2017, arXiv:1706.03741; Stiennon et al. 2020, arXiv:2009.01325; PPO: Schulman et al. 2017,
     arXiv:1707.06347; GAE: Schulman et al. 2016, arXiv:1506.02438. DPO: Rafailov et al., NeurIPS 2023, arXiv:2305.18290 (ec. 7).
     GRPO: Shao et al., DeepSeekMath, arXiv:2402.03300 (§4.1: sin crítico, ventaja = recompensa normalizada en el grupo de G
     salidas, KL k3 en la pérdida; G = 64 y β = 0.04 en el paper). Implementación de referencia de los pasos: TRL (PPOTrainer:
     política + referencia + reward model + crítico AutoModelForSequenceClassification con num_labels = 1; DPOTrainer: forward
     concatenado elegida + rechazada; con PEFT la referencia = la política con los adaptadores apagados).
   Cross-check: crosscheck/finetune.py (HF LlamaForCausalLM / LlamaForSequenceClassification en el dispositivo META + peft
   get_peft_model(LoraConfig(...)): parámetros EXACTOS (= print_trainable_parameters), FLOPs del forward y del paso completo
   (forward + backward, con y sin gradient checkpointing) con FlopCounterMode; pérdidas DPO / Bradley-Terry / PPO-clip / GRPO /
   GAE / KL contra una referencia en torch float64).

   ---------------------------------------------------------------- convenciones y símbolos
   Formas sin batch: UNA secuencia de T tokens (B = secuencias por paso, solo en metrics). Símbolos de F6 (D, L, h, G, d_h,
   D_mlp, V, D_kv = G·d_h) + r (rango), α (escala; α/r), d_in / d_out de cada matriz adaptada, T_p / T_r (prompt / respuesta del
   RLHF: T = T_p + T_r, mitad y mitad), G (GRPO: respuestas por prompt = knob y cfg `groupSize`; cfg.G y el símbolo G de las formas del decoder siguen siendo las
   cabezas KV de F6, 8). Knobs = enteros (primitives.resolve solo acepta enteros):
   - targets = matrices adaptadas por bloque: 2 = W_Q, W_V (paper de LoRA) · 4 = W_Q, W_K, W_V, W_O ('attn') · 7 = las 7 lineales
     (q, k, v, o, gate, up, down: 'all', recetas QLoRA / PEFT). La SPEC dice 'qv' | 'attn' | 'all': metrics().targetsName.
   - optimizer = bytes de ESTADO del optimizador por parámetro entrenable (sin la copia maestra): 8 = AdamW (m, v en fp32) ·
     2 = AdamW 8-bit (bitsandbytes) · 4 = SGD con momentum (fp32) · 0 = SGD sin momentum. La SPEC dice 'adamw' | 'adamw8bit' |
     'sgd': metrics().optimizerName. A.finetune.OPTIMIZERS = etiquetas.
   - bits (16 | 8 | 4) = bits de la base CONGELADA (como llm.js: solo las 7 lineales de cada bloque; embedding, LM head y
     RMSNorm quedan en bf16). 4 bits = NF4 con doble cuantización (cfg.dq = 1, QLoRA); 8 = LLM.int8.
   - gradCkpt (0 | 1), lora (0 | 1), refOffload (0 | 1): aceptan 0 (def.zeroKnobs).
   Bytes por parámetro ENTRENABLE (pesos + gradientes + optimizador): full FT bf16 en precisión mixta = 2 + 2 + (4 maestra + 8 m, v)
   = 16 (ZeRO §3.1); LoRA con PEFT (adaptadores fp32, autocast_adapter_dtype) = 4 + 4 + 8 = 16, sin copia maestra (ya son fp32);
   QLoRA (qlora.py castea los adaptadores a bf16; paged AdamW 32-bit) = 2 + 2 + 8 = 12. cfg.trainBits (32 | 16) y cfg.master (0 | 1).
   Base congelada: 2 bytes por parámetro (bf16) o quant_storage(n, bits) por matriz. GPUs: 24 / 48 / 80 GB DECIMALES (24e9…;
   las tarjetas tienen GiB: la cota queda conservadora ≈ 7 %), sin el contexto CUDA ni la fragmentación (≈ 0.5–1 GB más).

   MACs de un paso de entrenamiento (por secuencia; FLOPs = 2·MACs). EXACTO contra FlopCounterMode (forward + loss.backward()):
   - forward = el grafo (incluye los adaptadores: N·r·(d_in + d_out) por matriz y token).
   - backward = por cada matmul, un gradiente por operando que lo necesita: Linear → dX (si la entrada requiere gradiente) +
     dW (si W se entrena), cada uno = los MACs del forward; QKᵀ y A·V → un matmul por operando que requiere gradiente. Se
     propaga requires_grad por el grafo: en full FT todo (embedding entrenable → la entrada de la capa 1 también), backward =
     2 × forward EXACTO. En LoRA las W₀ congeladas NO calculan dW pero SÍ dX (el gradiente tiene que llegar a los adaptadores
     de las capas de abajo) → backward ≈ 1 × forward: la regla "≈ 4·N_base + 6·N_adapter FLOPs por token" (vs 6·N en full FT).
     Borde exacto: en la capa 1 la entrada (embedding congelado) no requiere gradiente → las lineales que leen h-norm1 no calculan
     dX (y con targets = 2 tampoco se calcula dK en la capa 1).
   - gradCkpt = 1 (por capa del decoder): + 1 forward de los L bloques (recomputación completa = use_reentrant = True), y la
     entrada de la capa 1 pasa a requerir gradiente (HF / PEFT llaman enable_input_require_grads) → en LoRA la capa 1 también
     calcula esos dX. El modo por defecto de HF 5 (use_reentrant = False) corta la recomputación en el último tensor guardado:
     no recalcula la B del adaptador de W_down (−L·T·r·D MACs, < 0.03 %; el JSON lo registra).
   - trainStepMacsRule = la regla de bolsillo: (3 (full) | 2 (LoRA)) · (N − embedding) · tokens + 3 · N_adapter · tokens.

   Activaciones (bytes por token y por capa, bf16; lo que el backward GUARDA en HF con SDPA / FlashAttention y GQA nativa — nunca
   las matrices T×T; el conteo es el de Korthikanti et al. §4 adaptado; activationPerTokenLayer, EXACTO contra lo medido con
   saved_tensors_hooks en un Llama diminuto real: crosscheck activation_checks):
     siempre: 2 RMSNorm × (copia fp32 de la entrada 4D + rstd 4) · Q 2D + K 2D_kv + V 2D_kv + salida 2D (z es una vista) + lse 4h ·
              gate, SiLU(gate), up 3·2D_mlp
     + la salida bf16 de cada RMSNorm (2·2D) si γ se entrena (full FT) · h-norm1 2D si W_Q/W_K/W_V (o su adaptador con p = 0) la
       necesita · h-norm2 2D si W_gate/W_up · prod 2D_mlp si W_down: en full FT (dW) siempre; en LoRA con p = 0, si la matriz tiene
       adaptador (A guarda su entrada); con p > 0, en cambio, CADA adaptador guarda su copia con dropout (2·d_in) + la máscara
       (1 byte por elemento en CUDA; 2 en CPU): PEFT usa un dropout por adaptador — con las 7 matrices ≈ +117 KB por token y
       capa, del orden de la base · + 2r por adaptador (la salida de A).
     Full FT, Llama 3 8B: 200,840 B por token y capa. Fuera de las capas (por token): RMSNorm final 4D + 4 (+ 2D + la entrada del
     LM head 2D + ids 8 en full FT) + cos/sin 4·d_h; logits: T·V·6 (logits bf16 vivos + el log-softmax fp32 que guarda la
     cross-entropy de HF; medido) — 1.58 GB a T = 2048.
     gradCkpt: L·T·D·2 (la entrada de cada capa) + UNA capa recomputada (T · bytes por token y capa) + lo de fuera + logits.
     Sin contar: buffers temporales del backward, kernels fusionados que ahorran (Liger: RMSNorm y cross-entropy por bloques),
     la capa 1 (guarda algo menos en LoRA) ni la copia fp32 de la entrada que hace PEFT con adaptadores fp32 sin autocast (≈).
     Atención eager (sin SDPA): + L·h·T²·2 bytes (las probabilidades): metrics().attnScoresBytesEager, aparte.

   ---------------------------------------------------------------- modelo `lora` (configs)
   lora-llama3-8b-r16 (canónica: r 16, α 32, las 7 lineales, dropout 0.05, base bf16) · lora-llama3-8b-r16-qv (targets 2) ·
   lora-llama3-8b-r64 (r 64, α 128: misma escala α/r = 2) · qlora-llama3-8b-r16 (base NF4 + doble cuantización, adaptadores bf16)
   · full-ft-llama3-8b (todo entrenable, bf16 en precisión mixta con copia maestra fp32). Por defecto B = 1, T = 2048, AdamW,
   sin gradient checkpointing. Knobs: r [4, 8, 16, 32, 64, 128], targets [2, 4, 7], bits [16, 8, 4], B [1, 2, 4, 8, 16],
   T [512, 1024, 2048, 4096, 8192], optimizer [8, 2, 4, 0], gradCkpt [0, 1]. full-ft no acepta r / targets / bits < 16.
   Grafo = UN forward de entrenamiento de T tokens: el decoder de llm.js (sin `sample`) con, en cada matriz adaptada X:
     op X-proj (W₀ congelada; path … › X-proj › w-frozen) → tensor X-base · [X-lora-dropout (› dropout) → X-drop] ·
     X-lora-a (› lora-a, lora_a: d_in → r) → X-lora-a · X-lora-b (› lora-b, lora_b: r → d_out) → X-lora-b · X-lora-scale
     (› scale, ×α/r) → X-lora-delta · X-lora-sum (› sum: W₀x + ΔWx) → el tensor ORIGINAL de F6 (q, k, v, o, gate, up, f).
   X ∈ {q, k, v, o, gate, up, down}: ops q-proj, k-proj, v-proj, o-proj, gate-proj, up-proj, down-proj (ids de F6); tensores nuevos
   q-base q-drop q-lora-a q-lora-b q-lora-delta (y k-…, v-…, o-…, gate-…, up-…, down-…; down-lora-sum → f). Matrices sin
   adaptador: la op de F6 tal cual. Ids de F6 sin cambios: ids, x0, h-norm1, …, x-out, x-norm, logits.
   Vista `lora-overview` (SPEC §22.1): x = la entrada (p. ej. h-norm1 para W_Q), w-frozen, lora-a, lora-b, scale, sum, y (= q);
   paths de una matriz: blocks › block › attn › q-proj › {w-frozen, dropout, lora-a, lora-b, scale, sum}. `lora-placement`: los
   nodos de F6 q-proj … down-proj (byPath …>q-proj>lora-a dice si tiene adaptador; quantities.adapted = lista). `qlora-memory`:
   metrics().memoryBreakdown.

   ---------------------------------------------------------------- modelo `rlhf-dpo` (configs)
   rlhf-llama3-8b (canónica, PPO: política entrenable + referencia congelada + reward model congelado (cabeza D → 1) + crítico
   entrenable (cabeza D → 1); los 4 = Llama 3 8B) · dpo-llama3-8b (política + referencia) · grpo-llama3-8b (política +
   referencia; sin crítico; G = 8 respuestas por prompt, el default de TRL; recompensa de un verificador: 0 parámetros) ·
   dpo-llama3-8b-lora (DPO con LoRA r 16 en las 7 lineales: la referencia ES la base con los adaptadores apagados → no ocupa
   memoria) · ppo-llama3-8b-lora (PPO con LoRA r 16 en la política y el crítico; la referencia = la base de la política sin
   adaptadores; reward model aparte). Por defecto B = 8 (prompts o pares por paso), T = 1024 (T_p = T_r = 512), gradient checkpointing, AdamW.
   Knobs: B [1, 4, 8, 16, 32], T [512, 1024, 2048], groupSize [4, 8, 16, 64] (G de GRPO; cfg.groupSize — cfg.G sigue
   siendo las 8 cabezas KV de F6), lora [0, 1], refOffload [0, 1] (la
   referencia fuera de la GPU: log-probs precalculados en DPO — precompute_ref_log_probs — o en CPU en PPO / GRPO; el cómputo
   no desaparece, en DPO sale del paso), gradCkpt [0, 1] (añadido).
   Grafo = lo que se calcula con forward POR PROMPT (por par en DPO): cada rol es el decoder de llm.js importado con prefijo
   (ops y tensores pol-…, ref-…, rm-…, cr-…; path [rol, …de F6]; where ['Política π_θ …']):
     PPO: ids (T) → policy (pol-…, logits T×V) › logprobs (pol-logprobs → pol-logp, T_r) · reference (ref-… → ref-logp) ·
          reward (rm-…, SIN LM head: rm-score (› score-head, scalar_head) → reward-scores T×1 · rm-pool (› pool) → reward (1)) ·
          critic (cr-…: cr-value-head (› value-head) → critic-values T×1 · cr-take (› take) → values T_r×1) · kl (kl_penalty k1 →
          kl, T_r) · shaped-reward (› shaped-reward → rewards T_r) · gae (advantage › gae → advantages, returns) · ppo-loss
          (ppo_clip_loss → loss-policy) · value-loss (→ loss-value).
     DPO: ids (T, por secuencia: elegida y rechazada) → policy y reference con repeat × 2 (paramRepeat L: los pesos son UNO) ›
          logprobs (suma por secuencia → pol-logp / ref-logp, 2 = [y_w, y_l]) · dpo-loss (→ loss). Con LoRA la referencia tiene
          paramRepeat 0 (comparte los pesos de la base).
     GRPO: ids (T, por respuesta) → policy y reference × G › logprobs (T_r por respuesta) · rewards (entrada, G) · advantage ›
          group-adv (group_advantage → advantages, G) · kl (k3) · grpo-loss.
   totals.params = pesos DISTINTOS en memoria (PPO: 4 modelos = 2·8,030,261,248 + 2·7,504,928,768); totals.macs = el forward
   por prompt (por par). La generación (rollout) no está en el grafo: metrics() la cuenta con llm.js (prefill de T_p con
   logits solo de la última fila, como generate, + T_r − 1 pasos de decode con ctx = T_p + k).

   ---------------------------------------------------------------- metrics() (unidades en metrics.units)
   `lora` — params: trainableParams (= Σ r·(d_in + d_out) por matriz adaptada; full FT = todos), allParams (base + adaptadores,
     = "all params" de PEFT), baseParams, mergedParams (= base: tras fusionar no queda nada), adapterParamsPerLayer;
     pct: trainableShare (trainable / all, = el trainable% de PEFT); bytes: adapterBytes, baseWeightBytes, trainableWeightBytes,
     gradBytes, masterBytes, optimizerStateBytes, optimizerBytes (= maestra + estados), activationBytes (con el gradCkpt de la
     config), activationBytesNoCkpt, activationBytesCkpt, activationBytesPerTokenLayer, loraDropoutBytesPerTokenLayer,
     logitsBytes, attnScoresBytesEager, totalTrainMemory, baseWeightBytes16 / 8 / 4, baseWeightBytes4NoDQ, quantConstBytes;
     ratio: trainableSharePct (= 100·trainableShare, en %, para la prosa: 3 cifras → 0.520 / 0.0848), trainStepMacsVsFullFt
     (trainStepMacs / el del full FT con los mismos B, T y gradCkpt), bytesPerTrainableParam, quantBitsPerParam (bits por parámetro de las lineales cuantizadas), quantConstBitsPerParam
     (0.5 sin DQ → 0.127 con DQ), memoryVsFullFt; macs: forwardMacs, backwardMacs, backwardInputGradMacs, backwardWeightGradMacs,
     recomputeMacs, trainStepMacs (= B·(forward + backward + recompute)), …PerSeq, trainStepMacsRule, adapterMacsPerToken
     (costo por token de NO fusionar en inferencia), macsPerToken; count: tokensPerStep, r, alpha, targetsCount, B, T; booleanos
     fitsOn24 / fitsOn48 / fitsOn80; textos targetsName, optimizerName, method; listas memoryBreakdown [{id, label, bytes}],
     gpus [{id, label, bytes, fits}], methods [{id, label, configId, …bytes, total, fits…}] (full FT / LoRA / QLoRA con los mismos
     B, T, optimizer y gradCkpt), rankScaling [{r, trainableParams, trainableShare, adapterBytes, totalTrainMemory}],
     targetsScaling, seqScaling [{T, activationBytes, activationBytesCkpt, totalTrainMemory}].
   `rlhf-dpo` — count: modelsInMemory, generationTokensPerStep (PPO B·T_r, GRPO B·G·T_r, DPO 0), sequencesPerStep, tokensPerStep,
     groupSize, B, T, Tp, Tr, ppoEpochs, gpus80Needed (⌈total / 80 GB⌉: ZeRO-3 ideal, ≈); params: trainableParams, totalParams, policyParams,
     referenceParams, rewardParams, criticParams; bytes: weightBytes, gradBytes, optimizerBytes, activationBytes, kvCacheBytes
     (rollout), totalTrainMemory, policyWeightBytes, referenceWeightBytes, rewardWeightBytes, criticWeightBytes,
     policyOptimizerBytes, criticOptimizerBytes, policyGradBytes, criticGradBytes; macs: rolloutMacs, referenceMacs, rewardMacs,
     criticForwardMacs, policyForwardMacs (log-probs "old" de PPO), scoringMacs, policyUpdateMacs, criticUpdateMacs,
     updateMacs, trainStepMacs, rolloutMacsPerSeq, referencePrecomputeMacs; pct: rolloutShare, updateShare, scoringShare;
     booleanos fitsOn24 / 48 / 80; listas roles [{id, label, params, trainableParams, weightBytes, gradBytes, optimizerBytes,
     activationBytes, inMemory, trainable}], flopsSplit [{id, label, macs}], memoryByRole [{id, label, bytes}], methods [{id,
     configId, label, modelsInMemory, totalTrainMemory, generationTokensPerStep, trainStepMacs, roles…}] (PPO / DPO / GRPO con
     los mismos B, T, lora).

   ---------------------------------------------------------------- desviaciones respecto de SPEC §22 (nada renombrado)
   - Knobs enteros (resolve no acepta textos): targets 2 | 4 | 7 (= 'qv' | 'attn' | 'all'), optimizer 8 | 2 | 4 | 0 (bytes de
     estado = 'adamw' | 'adamw8bit' | 'sgd' con momentum | SGD sin momentum); metrics().targetsName / optimizerName dan el texto.
   - trainStepFlops → trainStepMacs (unidad 'macs' de la app; FLOPs = 2×). La regla de la SPEC (≈ 6N vs ≈ 4N_base + 6N_adapter
     FLOPs por token) = trainStepMacsRule (3N vs 2N_base + 3N_adapter MACs); el exacto sale del grafo (ver arriba).
   - Knob G de GRPO (SPEC) → groupSize (cfg.groupSize, metrics().groupSize; símbolo G en la prosa y en el tensor `rewards`): cfg.G
     queda como las cabezas KV de F6 (8), que el decoder importado usa. Config añadida ppo-llama3-8b-lora; métricas añadidas
     trainableSharePct (en %, unidad 'ratio' para tener 3 cifras: 0.0848) y trainStepMacsVsFullFt.
   - fitsOn (24 / 48 / 80 GB) = tres booleanos fitsOn24 / fitsOn48 / fitsOn80 + la lista gpus.
   - Nodos añadidos: `dropout` (lora_dropout de PEFT) dentro de cada matriz adaptada; x / y de lora-overview son tensores de F6
     (h-norm1 → q para W_Q, etc.), no ids nuevos. RLHF: nodos raíz policy, reference, reward, critic, kl, shaped-reward, advantage,
     ppo-loss, value-loss (PPO) · policy, reference, dpo-loss (DPO) · policy, reference, advantage, kl, grpo-loss (GRPO); dentro
     de cada rol, los de F6 (embed, blocks › block › …, final-norm, lm-head) + logprobs / score-head / pool / value-head / take.
   - GRPO sin reward model (verificador, como DeepSeek-R1 / RLVR; la SPEC dice "policy + reference"); DeepSeekMath sí usaba
     un reward model: súmalo con la fila reward de PPO. Knob gradCkpt añadido a rlhf-dpo; config ppoEpochs = 4 (TRL
     num_ppo_epochs); T_p = T_r = T/2.
   - LoRA α de r64 = 128 (misma α/r que la canónica; QLoRA usó r 64, α 16). dropout 0.05 (recetas; el default de PEFT es 0.0;
     QLoRA: 0.1 hasta 13B, 0.05 en 33B / 65B). QLoRA con r 16 y α 32 (como la canónica; el paper usa r 64 en todas las capas).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('finetune.js necesita js/arch/primitives.js antes.');
  if (!A.hasConfig || !A.hasConfig('llama3-8b')) throw new Error('finetune.js necesita js/arch/llm.js antes (compone su decoder).');
  ['lora_a', 'lora_b', 'lora_scale', 'lora_linear', 'quant_storage', 'scalar_head', 'token_logprobs', 'kl_penalty', 'gae', 'dpo_loss'].forEach((id) => {
    if (typeof A[id] !== 'function') throw new Error('finetune.js necesita la primitiva ' + id + ' de js/arch/primitives.js.');
  });
  const LLMDEF = A.model('llm');
  const fint = (n) => A.fmt.int(n);
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);

  // ------------------------------------------------------------------ constantes
  const GPUS = [
    { id: 'gpu24', key: 24, label: '24 GB (RTX 4090, A10)', bytes: 24e9 },
    { id: 'gpu48', key: 48, label: '48 GB (L40S, RTX 6000 Ada, A6000)', bytes: 48e9 },
    { id: 'gpu80', key: 80, label: '80 GB (A100 / H100)', bytes: 80e9 },
  ];
  const OPTIMIZERS = {
    8: { id: 'adamw', label: 'AdamW (m y v en fp32)', bytes: 8 },
    2: { id: 'adamw8bit', label: 'AdamW 8-bit (bitsandbytes)', bytes: 2 },
    4: { id: 'sgd', label: 'SGD con momentum (fp32)', bytes: 4 },
    0: { id: 'sgd-plain', label: 'SGD sin momentum', bytes: 0 },
  };
  // Las 7 lineales de un bloque Llama (ids de F6) y sus dimensiones.
  const LINEARS = [
    { id: 'q', op: 'q-proj', out: 'q', din: 'D', dout: 'Dq', dinSym: 'D', doutSym: 'D', W: 'W_Q', Wtex: 'W_Q', where: 'atención', peft: 'q_proj' },
    { id: 'k', op: 'k-proj', out: 'k', din: 'D', dout: 'Dkv', dinSym: 'D', doutSym: 'G·d_h', W: 'W_K', Wtex: 'W_K', where: 'atención', peft: 'k_proj' },
    { id: 'v', op: 'v-proj', out: 'v', din: 'D', dout: 'Dkv', dinSym: 'D', doutSym: 'G·d_h', W: 'W_V', Wtex: 'W_V', where: 'atención', peft: 'v_proj' },
    { id: 'o', op: 'o-proj', out: 'o', din: 'Dq', dout: 'D', dinSym: 'D', doutSym: 'D', W: 'W_O', Wtex: 'W_O', where: 'atención', peft: 'o_proj' },
    { id: 'gate', op: 'gate-proj', out: 'gate', din: 'D', dout: 'Dmlp', dinSym: 'D', doutSym: 'D_mlp', W: 'W_gate', Wtex: 'W_{\\mathrm{gate}}', where: 'FFN', peft: 'gate_proj' },
    { id: 'up', op: 'up-proj', out: 'up', din: 'D', dout: 'Dmlp', dinSym: 'D', doutSym: 'D_mlp', W: 'W_up', Wtex: 'W_{\\mathrm{up}}', where: 'FFN', peft: 'up_proj' },
    { id: 'down', op: 'down-proj', out: 'f', din: 'Dmlp', dout: 'D', dinSym: 'D_mlp', doutSym: 'D', W: 'W_down', Wtex: 'W_{\\mathrm{down}}', where: 'FFN', peft: 'down_proj' },
  ];
  const LIN_BY_OP = Object.fromEntries(LINEARS.map((l) => [l.op, l]));
  const TARGETS = { 2: ['q', 'v'], 4: ['q', 'k', 'v', 'o'], 7: ['q', 'k', 'v', 'o', 'gate', 'up', 'down'] };
  const TARGET_NAMES = { 2: 'qv', 4: 'attn', 7: 'all' };
  const TARGET_LABELS = { 2: 'W_Q y W_V', 4: 'atención (W_Q, W_K, W_V, W_O)', 7: 'las 7 lineales (atención + FFN)' };
  // Prims con matmul de pesos (backward: dX si la entrada requiere gradiente + dW si se entrena) y matmuls de activaciones.
  const WEIGHT_MM = new Set(['linear', 'lm_head', 'lora_a', 'lora_b', 'scalar_head']);
  const ACT_MM = new Set(['attention_scores', 'attention_weighted_sum']);

  // ------------------------------------------------------------------ el decoder de llm.js
  const llmMemo = {};
  function llmData(base, T) {
    const key = base + '|' + T;
    if (!llmMemo[key]) {
      const b = Object.assign({}, LLMDEF.configs[base], { T, ctx: T, B: 1, bits: 16, kvBits: 16, decode: 0, canonical: false });
      delete b.decodeOf;
      b._notes = [];
      const cf = LLMDEF.resolve(b);
      llmMemo[key] = { cfg: cf, data: LLMDEF.build(cf, A)._data() };
    }
    return llmMemo[key];
  }
  const dimOf = (c, k) => ({ D: c.D, Dq: c.h * c.dh, Dkv: c.G * c.dh, Dmlp: c.Dmlp })[k];

  // Importa el decoder de F6 (sin `sample`) en g. o = {prefix, path: [rol], where: [..], label (prefijo), head: 'lm' | 'score',
  // S (secuencias: repeat × S), share (pesos compartidos con otro rol: paramRepeat 0), lora: {r, alpha, p, targets} | null}.
  // Devuelve el id (con prefijo) de la salida final (logits o x-norm).
  function importDecoder(g, c, o) {
    const src = llmData(c.base, c.T).data;
    const P = (id) => (o.prefix || '') + id;
    const S = o.S || 1;
    const tmapBase = (id) => (id === 'ids' ? (o.idsId || 'ids') : P(id));
    for (const op0 of src.ops) {
      if (op0.id === 'sample') continue;
      if (o.head === 'score' && op0.id === 'lm-head') continue;
      const op = Object.assign({}, op0, { repeat: op0.repeat * S, paramRepeat: o.share ? 0 : op0.paramRepeat });
      const lin = o.lora && LIN_BY_OP[op.id] && o.lora.targets.includes(LIN_BY_OP[op.id].id) ? LIN_BY_OP[op.id] : null;
      let tensors = src.tensors, tmap = tmapBase, label = (l) => (o.label || '') + l;
      if (lin) {
        const t0 = src.tensors[lin.out];
        tensors = Object.assign({}, src.tensors);
        tensors[lin.out] = Object.assign({}, t0, { label: 'Bloque · ' + lin.where + ' · ' + lin.W + ' · rama congelada W₀x', tex: 'xW_{0}' + (lin.id === 'q' ? '^{Q}' : lin.id === 'k' ? '^{K}' : lin.id === 'v' ? '^{V}' : lin.id === 'o' ? '^{O}' : '^{\\mathrm{' + lin.id + '}}') });
        tmap = (id) => (id === lin.out ? P(lin.id + '-base') : tmapBase(id));
      }
      A.importGraph(g, { ops: [op], tensors }, {
        tensorId: tmap, opId: P,
        path: (p) => (o.path || []).concat(lin ? p.concat(['w-frozen']) : p),
        where: (w) => (o.where || []).concat(w),
        label,
      });
      if (lin) addAdapter(g, c, o, op, lin, P, tmapBase(op.in[0]), src.tensors[lin.out]);
    }
    return o.head === 'score' ? P('x-norm') : P('logits');
  }

  // Adaptador LoRA de una matriz: [dropout] → A → B → ×α/r → W₀x + ΔWx (= el tensor original de F6).
  function addAdapter(g, c, o, op, lin, P, xinId, tOut) {
    const L = o.lora, pp = (o.path || []).concat(op.path);
    const W = (o.where || []).concat(op.where || []).concat(['adaptador LoRA de ' + lin.W + ' (r = ' + L.r + ', α = ' + L.alpha + ')']);
    const rep = { repeat: op.repeat, paramRepeat: op.paramRepeat };
    const pre = (o.label || '') + 'Bloque · ' + lin.where + ' · ' + lin.W + ' · ';
    const meta = (lab, tex) => ({ label: pre + lab, tex, perLayer: true });
    const grp = op.group;
    let xa = g.tensor(xinId);
    if (L.p > 0) {
      xa = g.op(P(lin.id + '-lora-dropout'), A.dropout(xa, { p: L.p }), Object.assign({ path: pp.concat(['dropout']), out: P(lin.id + '-drop'), where: W,
        label: 'Dropout de la entrada del adaptador (p = ' + L.p + ')', type: 'tensorop', group: grp, outMeta: meta('entrada del adaptador con dropout (p = ' + L.p + ')', '\\mathrm{drop}(x)') }, rep));
    }
    const a = g.op(P(lin.id + '-lora-a'), A.lora_a(xa, { r: L.r }), Object.assign({ path: pp.concat(['lora-a']), out: P(lin.id + '-lora-a'), where: W,
      label: 'LoRA A de ' + lin.W + ' (' + lin.dinSym + ' → r = ' + L.r + ', entrenable)', type: 'embed', group: grp, outMeta: meta('A·x (bajada a r = ' + L.r + ')', 'Ax') }, rep));
    const b = g.op(P(lin.id + '-lora-b'), A.lora_b(a, { dout: dimOf(c, lin.dout), doutSym: lin.doutSym }), Object.assign({ path: pp.concat(['lora-b']), out: P(lin.id + '-lora-b'), where: W,
      label: 'LoRA B de ' + lin.W + ' (r → ' + lin.doutSym + ', entrenable, empieza en 0)', type: 'embed', group: grp, outMeta: meta('B·A·x (subida a ' + lin.doutSym + ')', 'BAx') }, rep));
    const s = g.op(P(lin.id + '-lora-scale'), A.lora_scale(b, { alpha: L.alpha, r: L.r }), Object.assign({ path: pp.concat(['scale']), out: P(lin.id + '-lora-delta'), where: W,
      label: 'Escala α/r = ' + L.alpha + '/' + L.r + ' = ' + (L.alpha / L.r), type: 'tensorop', group: grp, outMeta: meta('ΔW·x = (α/r)·B·A·x', '\\tfrac{\\alpha}{r}BAx') }, rep));
    const lab = (o.label || '') + tOut.label;
    g.op(P(lin.id + '-lora-sum'), A.add(g.tensor(P(lin.id + '-base')), s), Object.assign({ path: pp.concat(['sum']), out: P(lin.out), where: W,
      label: 'W₀x + ΔWx (salida de ' + lin.W + ' adaptada)', type: 'tensorop', group: grp, outMeta: { label: lab, tex: tOut.tex, perLayer: tOut.perLayer } }, rep));
  }

  // ------------------------------------------------------------------ costo de un paso (por secuencia)
  // ops: las de UN rol (o todo el modelo); trainable(op) → bool; ckpt: gradient checkpointing por capa. Propaga requires_grad
  // por el grafo (capa 1 y capas 2..L por separado) y suma los matmuls del backward. Devuelve MACs POR SECUENCIA.
  function seqCost(ops, o) {
    const S = o.S || 1, L = o.L;
    const isLayer = (op) => op.path.indexOf('blocks') >= 0;
    const rg = {};
    const pre = [], layer = [], post = [];
    ops.forEach((op) => { (isLayer(op) ? layer : layer.length ? post : pre).push(op); });
    let fwd = 0, ig = 0, wg = 0;
    const per = (op) => op.repeat / S / (isLayer(op) ? L : 1);   // = 1 (ops importadas con repeat = L·S)
    ops.forEach((op) => { fwd += op.macs * per(op) * (isLayer(op) ? L : 1); });
    const evalOp = (op) => {
      const ins = op.in.map((t) => !!rg[t]);
      const tr = !!o.trainable(op);
      let i = 0, w = 0;
      if (WEIGHT_MM.has(op.prim)) { i = ins[0] ? op.macs : 0; w = tr ? op.macs : 0; }
      else if (ACT_MM.has(op.prim)) i = ins.reduce((s, x) => s + (x ? op.macs : 0), 0);
      const out = ins.some(Boolean) || tr;
      // separar cabezas (split: [q, k, v] → [q-heads, k-heads, v-heads]): cada salida depende SOLO de su entrada
      if (op.prim === 'split_gqa_heads' && op.in.length === op.out.length) op.out.forEach((t, j) => { rg[t] = ins[j] || tr; });
      else op.out.forEach((t) => { rg[t] = out; });
      return [i, w];
    };
    pre.forEach((op) => { const [i, w] = evalOp(op); ig += i; wg += w; });
    let rec = 0, first = [0, 0], steady = [0, 0];
    if (layer.length) {
      const produced = new Set(layer.flatMap((op) => op.out));
      const ext = Array.from(new Set(layer.flatMap((op) => op.in).filter((t) => !produced.has(t))));
      if (o.ckpt && o.trainableRole) ext.forEach((t) => { rg[t] = true; });   // enable_input_require_grads
      const pass = () => layer.reduce((acc, op) => { const [i, w] = evalOp(op); return [acc[0] + i, acc[1] + w]; }, [0, 0]);
      first = pass();
      const outT = layer[layer.length - 1].out[0];
      ext.forEach((t) => { rg[t] = rg[t] || rg[outT]; });
      steady = pass();
      ig += first[0] + (L - 1) * steady[0];
      wg += first[1] + (L - 1) * steady[1];
      if (o.ckpt) rec = layer.reduce((s, op) => s + op.macs, 0) * L;
    }
    post.forEach((op) => { const [i, w] = evalOp(op); ig += i; wg += w; });
    const bwd = ig + wg;
    return { fwd, bwd, ig, wg, rec, total: fwd + bwd + rec, firstLayer: first[0] + first[1], steadyLayer: steady[0] + steady[1] };
  }

  // ------------------------------------------------------------------ memoria
  // Pesos: congelados (bits de la base: las lineales de los bloques con quant_storage; el resto en bf16) y entrenables.
  function weightMemory(ops, c, trainable) {
    let frozenParams = 0, frozenBytes = 0, trainParams = 0, quantParams = 0, quantBytes = 0, quantConst = 0;
    ops.forEach((op) => {
      const k = A.paramRep(op), n = op.params * k;
      if (!n) return;
      if (trainable(op)) { trainParams += n; return; }
      frozenParams += n;
      const isQ = op.prim === 'linear' && op.path.indexOf('blocks') >= 0;
      if (c.bits < 16 && isQ) {
        const q = A.quant_storage(op.params, { bits: c.bits, rows: op.detail.dout, dq: c.dq === 1 });
        frozenBytes += q.bytes * k; quantParams += n; quantBytes += q.bytes * k; quantConst += q.constBytes * k;
      } else {
        frozenBytes += 2 * n;
        if (op.prim === 'linear' && op.path.indexOf('blocks') >= 0) { quantParams += n; quantBytes += 2 * n; }
      }
    });
    return { frozenParams, frozenBytes, trainParams, quantParams, quantBytes, quantConst };
  }
  function trainState(n, c) {
    const wb = c.trainBits / 8;
    const weights = n * wb, grads = n * wb, master = c.master ? 4 * n : 0, states = n * c.optimizer;
    return { weights, grads, master, states, optimizer: master + states, total: weights + grads + master + states };
  }
  // Activaciones por secuencia (bytes). o = {full, adapted: [ids], p, ckpt, lmHead}
  // Bytes que el backward guarda por token y por capa (bf16), tal como lo hace HF (verificado EXACTO con
  // torch.autograd.graph.saved_tensors_hooks en un Llama diminuto con pesos reales: crosscheck/finetune.py, activation_checks).
  // o = {D, Dkv, F, h, r, full, adapted: [ids], p, maskBytes = 1}. maskBytes: la máscara del dropout (bool de 1 byte en CUDA,
  // native_dropout; en CPU es del dtype de la entrada: 2).
  function activationPerTokenLayer(o) {
    const D = o.D, Dkv = o.Dkv, F = o.F, mb = o.maskBytes != null ? o.maskBytes : 1;
    const ad = new Set(o.adapted || []);
    const needs = (ids) => ids.some((x) => o.full || (ad.has(x) && !(o.p > 0)));
    const parts = {
      norms: 2 * (4 * D + 4) + (o.full ? 2 * 2 * D : 0),          // RMSNorm de HF: copia fp32 de la entrada + rstd (+ la salida bf16 si γ se entrena)
      attnInput: needs(['q', 'k', 'v']) ? 2 * D : 0,              // h-norm1 (la guardan W_Q/W_K/W_V o sus adaptadores)
      attention: 2 * D + 2 * Dkv + 2 * Dkv + 2 * D + 4 * o.h,     // SDPA / FlashAttention: Q, K, V, salida (= z) y logsumexp fp32
      ffnInput: needs(['gate', 'up']) ? 2 * D : 0,                // h-norm2
      swiglu: 3 * 2 * F,                                          // gate (SiLU), SiLU(gate) y up (el producto)
      downInput: needs(['down']) ? 2 * F : 0,                     // prod
      adapters: o.full ? 0 : ad.size * 2 * (o.r || 0),            // salida de cada A (r)
      dropout: o.full || !(o.p > 0) ? 0 : LINEARS.filter((l) => ad.has(l.id)).reduce((s, l) => s + (2 + mb) * ({ D, Dq: D, Dmlp: F })[l.din], 0),
    };
    return Object.assign({ total: Object.values(parts).reduce((s, x) => s + x, 0) }, parts);
  }
  // Activaciones por secuencia (bytes). o = {full, adapted, p, ckpt, lmHead}
  function activationModel(c, o) {
    const D = c.D, Dkv = c.G * c.dh, L = c.L, T = c.T;
    const pl = activationPerTokenLayer({ D, Dkv, F: c.Dmlp, h: c.h, r: c.r, full: o.full, adapted: o.adapted, p: o.p });
    const perTokenLayer = pl.total;
    // fuera de las capas, por token: RMSNorm final (+ su salida si γ se entrena) + la entrada del LM head y los ids si se entrena
    // + cos/sin de RoPE (una vez) ; logits: los bf16 vivos (2) + el log-softmax fp32 que guarda la cross-entropy (4) = 6·V
    const nonLayer = T * ((4 * D + 4) + (o.full ? 2 * D + 2 * D + 8 : 0) + 4 * c.dh);
    const logits = o.lmHead ? T * c.V * 6 : 0;
    const noCkpt = T * L * perTokenLayer + nonLayer + logits;
    const ckpt = L * T * D * 2 + T * perTokenLayer + nonLayer + logits;
    return { perTokenLayer, parts: pl, dropBytes: pl.dropout, nonLayer, logits, noCkpt, ckpt, value: o.ckpt ? ckpt : noCkpt, attnEager: L * c.h * T * T * 2 };
  }
  const fitsList = (bytes) => GPUS.map((gp) => ({ id: gp.id, label: gp.label, bytes: gp.bytes, fits: bytes <= gp.bytes }));

  // ================================================================== modelo `lora`
  const LORA_SRC = 'Hu et al. 2022 (LoRA, ICLR 2022, arXiv:2106.09685) §4; HF peft 0.21.2 (LoraConfig(r, lora_alpha, lora_dropout, target_modules), get_peft_model); base = Llama 3 8B de js/arch/llm.js (config.json de meta-llama/Meta-Llama-3-8B). ';
  const LORA_BASE = { base: 'llama3-8b', T: 2048, B: 1, r: 16, alpha: 32, targets: 7, p: 0.05, bits: 16, dq: 1, optimizer: 8, gradCkpt: 0, full: 0, trainBits: 32, master: 0, causal: false };
  const LORA = {
    'lora-llama3-8b-r16': Object.assign({}, LORA_BASE, { label: 'LoRA r = 16 · Llama 3 8B (las 7 lineales)', canonical: true,
      source: LORA_SRC + 'r = 16, α = 32 (α/r = 2), lora_dropout = 0.05 (recetas; default de PEFT 0.0), target_modules = las 7 lineales de cada bloque (q, k, v, o, gate, up, down: las de QLoRA §4 "all linear layers"). Adaptadores en fp32 (autocast_adapter_dtype de PEFT), base bf16.' }),
    'lora-llama3-8b-r16-qv': Object.assign({}, LORA_BASE, { label: 'LoRA r = 16 · Llama 3 8B (solo W_Q y W_V)', targets: 2,
      source: LORA_SRC + 'Solo W_Q y W_V, como en el paper de LoRA (§7.1, Tabla 5: con un presupuesto fijo, adaptar W_q y W_v es lo mejor en GPT-3); r = 16, α = 32.' }),
    'lora-llama3-8b-r64': Object.assign({}, LORA_BASE, { label: 'LoRA r = 64 · Llama 3 8B (las 7 lineales)', r: 64, alpha: 128,
      source: LORA_SRC + 'r = 64 (el rango de QLoRA §5), α = 128 para mantener α/r = 2 (QLoRA usó α = 16); las 7 lineales.' }),
    'qlora-llama3-8b-r16': Object.assign({}, LORA_BASE, { label: 'QLoRA r = 16 · Llama 3 8B (base NF4 + doble cuantización)', bits: 4, dq: 1, trainBits: 16,
      source: 'Dettmers et al. 2023 (QLoRA, NeurIPS 2023, arXiv:2305.14314) §3: base en NF4 (bloques de 64) con doble cuantización (absmax en 8 bits, bloques de 256 → 0.127 bits por parámetro), cómputo en bf16, adaptadores LoRA en bf16 (qlora.py), paged AdamW 32-bit. Solo las lineales de los bloques se cuantizan (bitsandbytes Linear4bit; embedding y lm_head en bf16). r = 16, α = 32 en las 7 lineales (el paper: r = 64, α = 16).' }),
    'full-ft-llama3-8b': Object.assign({}, LORA_BASE, { label: 'Fine-tuning completo · Llama 3 8B', full: 1, r: 0, alpha: 0, targets: 0, p: 0, trainBits: 16, master: 1,
      source: 'Contraste: todos los parámetros entrenables, bf16 en precisión mixta con copia maestra fp32 y Adam (ZeRO, Rajbhandari et al., SC 2020, arXiv:1910.02054, §3.1: 2Ψ + 2Ψ + 12Ψ = 16Ψ bytes). Base = Llama 3 8B de js/arch/llm.js.' }),
  };
  const LORA_KNOBS = { r: [4, 8, 16, 32, 64, 128], targets: [2, 4, 7], bits: [16, 8, 4], B: [1, 2, 4, 8, 16], T: [512, 1024, 2048, 4096, 8192], optimizer: [8, 2, 4, 0], gradCkpt: [0, 1] };

  function loraApply(c, ov) {
    const notes = [];
    const full = c.full === 1;
    if (full) {
      ['r', 'targets'].forEach((k) => { if (ov[k] !== undefined) throw new Error(c.label + ': el fine-tuning completo no tiene adaptadores (el knob ' + k + ' solo existe en las configs LoRA / QLoRA).'); });
      if (ov.bits !== undefined && ov.bits !== 16) throw new Error(c.label + ': no se pueden entrenar pesos cuantizados a ' + ov.bits + ' bits (bits < 16 solo para la base congelada de LoRA / QLoRA).');
    }
    if (ov.r !== undefined) { if (ov.r !== c.r) { c.alpha = c.alpha * ov.r / c.r; c.label += ' · r = ' + ov.r; notes.push('What-if r = ' + ov.r + ': α escala igual (α/r = ' + (c.alpha / ov.r) + ' como en la config).'); } c.r = ov.r; }
    if (ov.targets !== undefined) {
      if (!TARGETS[ov.targets]) throw new Error(c.label + ': targets debe ser 2 (W_Q, W_V), 4 (atención) o 7 (las 7 lineales) (recibí ' + ov.targets + ').');
      if (ov.targets !== c.targets) c.label += ' · ' + TARGET_LABELS[ov.targets];
      c.targets = ov.targets;
    }
    if (ov.bits !== undefined) {
      if ([16, 8, 4].indexOf(ov.bits) < 0) throw new Error(c.label + ': bits debe ser 16, 8 o 4 (recibí ' + ov.bits + ').');
      if (ov.bits !== c.bits) c.label += ' · base a ' + ov.bits + ' bits';
      c.bits = ov.bits;
    }
    if (ov.optimizer !== undefined) {
      if (!OPTIMIZERS[ov.optimizer]) throw new Error(c.label + ': optimizer debe ser 8 (AdamW), 2 (AdamW 8-bit), 4 (SGD con momentum) o 0 (SGD) (recibí ' + ov.optimizer + ').');
      if (ov.optimizer !== c.optimizer) c.label += ' · ' + OPTIMIZERS[ov.optimizer].label;
      c.optimizer = ov.optimizer;
    }
    if (ov.gradCkpt !== undefined) {
      if (ov.gradCkpt !== 0 && ov.gradCkpt !== 1) throw new Error(c.label + ': gradCkpt debe ser 0 o 1.');
      if (ov.gradCkpt !== c.gradCkpt) c.label += ov.gradCkpt ? ' · gradient checkpointing' : ' · sin gradient checkpointing';
      c.gradCkpt = ov.gradCkpt;
    }
    ['B', 'T'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    if (c.T > 8192) notes.push('T = ' + fint(c.T) + ' supera el contexto de entrenamiento de Llama 3 (8,192): el conteo es válido.');
    c._notes = notes;
    return c;
  }
  function loraResolve(c) {
    const b = LLMDEF.configs[c.base];
    ['D', 'L', 'h', 'G', 'dh', 'Dmlp', 'V', 'ctxMax', 'ropeTheta', 'eps'].forEach((k) => { c[k] = b[k]; });
    c.Dq = c.h * c.dh; c.Dkv = c.G * c.dh;
    c.method = c.full === 1 ? 'full' : (c.bits < 16 ? 'qlora' : 'lora');
    c.adapted = c.full === 1 ? [] : TARGETS[c.targets].slice();
    c.scaling = c.full === 1 ? 0 : c.alpha / c.r;
    c.tokens = c.T;
    c.targetsName = c.full === 1 ? 'full' : TARGET_NAMES[c.targets];
    return c;
  }
  function loraBuild(c, A) {
    const g = A.graph(c);
    g.input('ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Tokens · ids de una secuencia de entrenamiento (T tokens)', tex: 't_{1..T}' });
    importDecoder(g, c, { lora: c.full === 1 ? null : { r: c.r, alpha: c.alpha, p: c.p, targets: c.adapted } });
    return g;
  }
  const loraTrainable = (c) => (op) => (c.full === 1 ? op.params > 0 : op.prim === 'lora_a' || op.prim === 'lora_b');

  // Parámetros de los adaptadores por matriz (con la compuesta lora_linear: r·(d_in + d_out)).
  function adapterTable(c) {
    return LINEARS.map((l) => {
      const din = dimOf(c, l.din), dout = dimOf(c, l.dout);
      const on = c.adapted.indexOf(l.id) >= 0;
      const ll = on ? A.lora_linear(shp(['T', l.dinSym], [c.T, din], 'txt', 'seq'), { dout, doutSym: l.doutSym, r: c.r, alpha: c.alpha }) : null;
      return { id: l.id, op: l.op, W: l.W, peft: l.peft, din, dout, adapted: on, params: on ? ll.params : 0, perLayerMacsPerToken: on ? ll.params : 0, frozenParams: din * dout };
    });
  }
  function loraQuantities(c, r) {
    const t = r.totals, tab = adapterTable(c);
    const tr = r.ops.filter(loraTrainable(c)).reduce((s, op) => s + op.params * A.paramRep(op), 0);
    const perLayer = tab.reduce((s, x) => s + x.params, 0);
    const q = {
      tokens: c.T, T: c.T, B: c.B, r: c.r, alpha: c.alpha, scaling: c.scaling, dropout: c.p, bits: c.bits, targets: c.targets, targetsCount: c.adapted.length,
      D: c.D, L: c.L, h: c.h, G: c.G, dh: c.dh, Dkv: c.Dkv, Dmlp: c.Dmlp, V: c.V,
      allParams: t.params, trainableParams: tr, baseParams: t.params - (c.full === 1 ? 0 : tr), mergedParams: t.params - (c.full === 1 ? 0 : tr),
      adapterParamsPerLayer: c.full === 1 ? 0 : perLayer, adapterParamsFormula: c.full === 1 ? 0 : c.r * tab.filter((x) => x.adapted).reduce((s, x) => s + x.din + x.dout, 0) * c.L,
      adapterMacsPerToken: c.full === 1 ? 0 : perLayer * c.L,
    };
    tab.forEach((x) => { q[x.id + 'AdapterParams'] = x.params; q[x.id + 'Din'] = x.din; q[x.id + 'Dout'] = x.dout; });
    return q;
  }
  function loraCore(c, r) {
    const tr = loraTrainable(c);
    const sc = seqCost(r.ops, { S: 1, L: c.L, trainable: tr, ckpt: c.gradCkpt === 1, trainableRole: true });
    const wm = weightMemory(r.ops, c, tr);
    const st = trainState(wm.trainParams, c);
    const act = activationModel(c, { full: c.full === 1, adapted: c.adapted, p: c.p, ckpt: c.gradCkpt === 1, lmHead: true });
    const B = c.B;
    const baseWeightBytes = wm.frozenBytes;
    const activationBytes = B * act.value;
    const total = baseWeightBytes + st.total + activationBytes;
    return { sc, wm, st, act, B, baseWeightBytes, activationBytes, total };
  }
  function loraMetrics(c, r, o) {
    const q = r.quantities, k = loraCore(c, r), B = k.B, sc = k.sc;
    const all = r.totals.params, trn = k.wm.trainParams;
    const embed = r.totals.byNode.embed ? r.totals.byNode.embed.params : 0;
    const ruleCoef = c.full === 1 ? 3 : 2;
    const rule = B * c.T * (ruleCoef * (all - trn * (c.full === 1 ? 0 : 1) - embed) + (c.full === 1 ? 0 : 3 * trn));
    // misma base a 16 / 8 / 4 bits (con y sin doble cuantización a 4)
    // la base sola (sin los adaptadores) guardada a 16 / 8 / 4 bits, sea cual sea el método
    const baseOps = r.ops.filter((op) => op.prim !== 'lora_a' && op.prim !== 'lora_b');
    const wq = (bits, dq) => weightMemory(baseOps, Object.assign({}, c, { bits, dq: dq ? 1 : 0 }), () => false);
    const w4 = wq(4, true), w4n = wq(4, false), w8 = wq(8, false);
    const quantParams = k.wm.quantParams;
    const out = {
      method: c.method, targetsName: c.targetsName, optimizerName: OPTIMIZERS[c.optimizer].id,
      r: c.r, alpha: c.alpha, targetsCount: c.adapted.length, B, T: c.T, tokensPerStep: B * c.T,
      trainableParams: trn, allParams: all, baseParams: k.wm.frozenParams, mergedParams: all - (c.full === 1 ? 0 : trn), adapterParamsPerLayer: q.adapterParamsPerLayer,
      trainableShare: trn / all, trainableSharePct: 100 * trn / all,
      adapterBytes: c.full === 1 ? 0 : k.st.weights, trainableWeightBytes: k.st.weights, baseWeightBytes: c.full === 1 ? k.st.weights : k.baseWeightBytes,
      gradBytes: k.st.grads, masterBytes: k.st.master, optimizerStateBytes: k.st.states, optimizerBytes: k.st.optimizer,
      activationBytes: k.activationBytes, activationBytesNoCkpt: B * k.act.noCkpt, activationBytesCkpt: B * k.act.ckpt,
      activationBytesPerTokenLayer: k.act.perTokenLayer, loraDropoutBytesPerTokenLayer: k.act.dropBytes, logitsBytes: B * k.act.logits,
      attnScoresBytesEager: B * k.act.attnEager,
      totalTrainMemory: k.total, bytesPerTrainableParam: trn ? k.st.total / trn : 0,
      fitsOn24: k.total <= 24e9, fitsOn48: k.total <= 48e9, fitsOn80: k.total <= 80e9,
      baseWeightBytes16: wq(16, false).frozenBytes, baseWeightBytes8: w8.frozenBytes, baseWeightBytes4: w4.frozenBytes, baseWeightBytes4NoDQ: w4n.frozenBytes,
      quantConstBytes: k.wm.quantConst,
      quantBitsPerParam: c.bits < 16 && quantParams ? 8 * k.wm.quantBytes / quantParams : 16,
      quantConstBitsPerParam: c.bits < 16 && quantParams ? 8 * k.wm.quantConst / quantParams : 0,
      forwardMacsPerSeq: sc.fwd, backwardMacsPerSeq: sc.bwd, recomputeMacsPerSeq: sc.rec, trainStepMacsPerSeq: sc.total,
      backwardInputGradMacsPerSeq: sc.ig, backwardWeightGradMacsPerSeq: sc.wg,
      forwardMacs: B * sc.fwd, backwardMacs: B * sc.bwd, backwardInputGradMacs: B * sc.ig, backwardWeightGradMacs: B * sc.wg, recomputeMacs: B * sc.rec,
      trainStepMacs: B * sc.total, trainStepMacsRule: rule, macsPerToken: sc.total / c.T, backwardToForward: sc.bwd / sc.fwd,
      adapterMacsPerToken: q.adapterMacsPerToken,
      gpus: fitsList(k.total), units: FT_UNITS,
      // las genéricas de ATLAS.Arch.metrics, con la contabilidad de este modelo (no la de "todo tensor materializado")
      actMem: k.activationBytes, actMemPerSample: k.activationBytes / B, paramMem: k.baseWeightBytes + k.st.weights,
    };
    out.memoryBreakdown = [
      { id: 'base', label: c.full === 1 ? 'Pesos (bf16, entrenables)' : 'Base congelada (' + (c.bits === 4 ? 'NF4' + (c.dq ? ' + DQ' : '') : c.bits === 8 ? 'int8' : 'bf16') + ')', bytes: c.full === 1 ? k.st.weights : k.baseWeightBytes },
      { id: 'adapters', label: 'Adaptadores LoRA (' + (c.trainBits === 32 ? 'fp32' : 'bf16') + ')', bytes: c.full === 1 ? 0 : k.st.weights },
      { id: 'grads', label: 'Gradientes', bytes: k.st.grads },
      { id: 'optimizer', label: 'Optimizador (' + OPTIMIZERS[c.optimizer].label + (c.master ? ' + copia maestra fp32' : '') + ')', bytes: k.st.optimizer },
      { id: 'activations', label: 'Activaciones' + (c.gradCkpt ? ' (gradient checkpointing)' : ''), bytes: k.activationBytes - B * k.act.logits },
      { id: 'logits', label: 'Logits + log-softmax de la pérdida', bytes: B * k.act.logits },
    ];
    // Comparaciones (mismos B, T, optimizer y gradCkpt): full FT / LoRA / QLoRA, rango, matrices, largo.
    const same = { B, T: c.T, optimizer: c.optimizer, gradCkpt: c.gradCkpt };
    const row = (id, ov) => {
      const rr = A.run(id, ov), kk = loraCore(rr.config, rr);
      return { configId: id, label: rr.config.label, trainableParams: kk.wm.trainParams, baseWeightBytes: rr.config.full === 1 ? kk.st.weights : kk.baseWeightBytes, adapterBytes: rr.config.full === 1 ? 0 : kk.st.weights,
        gradBytes: kk.st.grads, optimizerBytes: kk.st.optimizer, activationBytes: kk.activationBytes, totalTrainMemory: kk.total, trainStepMacs: B * kk.sc.total,
        fitsOn24: kk.total <= 24e9, fitsOn48: kk.total <= 48e9, fitsOn80: kk.total <= 80e9 };
    };
    out.methods = [['full', 'full-ft-llama3-8b', same], ['lora', 'lora-llama3-8b-r16', same], ['qlora', 'qlora-llama3-8b-r16', same]].map(([id, cid, ov]) => Object.assign({ id }, row(cid, ov)));
    const fullTotal = out.methods[0].totalTrainMemory;
    out.memoryVsFullFt = k.total / fullTotal;
    out.trainStepMacsVsFullFt = out.trainStepMacs / out.methods[0].trainStepMacs;
    if (c.full !== 1) {
      const base = { B, T: c.T, optimizer: c.optimizer, gradCkpt: c.gradCkpt, bits: c.bits, targets: c.targets };
      out.rankScaling = [4, 8, 16, 32, 64, 128].map((rk) => { const x = row(r.id, Object.assign({}, base, { r: rk })); return { r: rk, trainableParams: x.trainableParams, trainableShare: x.trainableParams / (all - trn + x.trainableParams), adapterBytes: x.adapterBytes, totalTrainMemory: x.totalTrainMemory }; });
      out.targetsScaling = [2, 4, 7].map((tg) => { const x = row(r.id, Object.assign({}, base, { targets: tg })); return { targets: tg, name: TARGET_NAMES[tg], trainableParams: x.trainableParams, activationBytes: x.activationBytes, totalTrainMemory: x.totalTrainMemory }; });
    }
    const sb = { B, optimizer: c.optimizer };
    if (c.full !== 1) Object.assign(sb, { bits: c.bits, targets: c.targets, r: c.r });
    out.seqScaling = [512, 1024, 2048, 4096, 8192].map((T) => {
      const r0 = A.run(r.id, Object.assign({}, sb, { T, gradCkpt: 0 })), r1 = A.run(r.id, Object.assign({}, sb, { T, gradCkpt: 1 }));
      const k0 = loraCore(r0.config, r0), k1 = loraCore(r1.config, r1);
      return { T, activationBytes: k0.activationBytes, activationBytesCkpt: k1.activationBytes, totalTrainMemory: k0.total, totalTrainMemoryCkpt: k1.total };
    });
    return out;
  }

  // ================================================================== modelo `rlhf-dpo`
  const RL_BASE = { base: 'llama3-8b', T: 1024, B: 8, groupSize: 8, lora: 0, refOffload: 0, gradCkpt: 1, optimizer: 8, bits: 16, dq: 0, r: 16, alpha: 32, p: 0.05,
    ppoEpochs: 4, klCoef: 0.05, clipEps: 0.2, gamma: 1, lam: 0.95, beta: 0.1, causal: false };
  const RL = {
    'rlhf-llama3-8b': Object.assign({}, RL_BASE, { label: 'RLHF con PPO · Llama 3 8B (política + referencia + reward model + crítico)', method: 'ppo', canonical: true,
      source: 'Ouyang et al. 2022 (InstructGPT, NeurIPS 2022, arXiv:2203.02155) §3.5: PPO con penalización KL por token contra la política SFT y un crítico; Schulman et al. 2017 (PPO, arXiv:1707.06347); GAE (arXiv:1506.02438). Pasos y defaults de TRL PPOTrainer (num_ppo_epochs 4, kl_coef 0.05, cliprange 0.2, γ = 1, λ = 0.95; reward y crítico = AutoModelForSequenceClassification con num_labels = 1). Los cuatro modelos = Llama 3 8B de js/arch/llm.js.' }),
    'dpo-llama3-8b': Object.assign({}, RL_BASE, { label: 'DPO · Llama 3 8B (política + referencia)', method: 'dpo', gradCkpt: 1,
      source: 'Rafailov et al. 2023 (DPO, NeurIPS 2023, arXiv:2305.18290), ec. 7: pérdida sobre pares (x, y_w, y_l) con la política y la referencia congelada; β = 0.1 (TRL DPOConfig). Forward concatenado elegida + rechazada (TRL concatenated_forward).' }),
    'grpo-llama3-8b': Object.assign({}, RL_BASE, { label: 'GRPO · Llama 3 8B (política + referencia, sin crítico)', method: 'grpo', beta: 0.04,
      source: 'Shao et al. 2024 (DeepSeekMath, arXiv:2402.03300) §4.1: G salidas por pregunta, ventaja = recompensa normalizada en el grupo (sin crítico), KL k3 en la pérdida con β = 0.04 (el paper usa G = 64; aquí G = 8, el num_generations de TRL GRPOConfig). Recompensa de un verificador (0 parámetros, como DeepSeek-R1 / RLVR).' }),
    'ppo-llama3-8b-lora': Object.assign({}, RL_BASE, { label: 'RLHF con PPO + LoRA r = 16 · Llama 3 8B (la referencia = la base de la política sin adaptadores)', method: 'ppo', lora: 1,
      source: 'PPO (InstructGPT, arXiv:2203.02155; TRL PPOTrainer) con LoRA r = 16, α = 32 en las 7 lineales de la política y del crítico: la referencia es la base de la política con los adaptadores apagados (no ocupa memoria); el reward model sigue congelado aparte; el crítico = su base congelada + adaptadores + la cabeza de valor entrenable.' }),
    'dpo-llama3-8b-lora': Object.assign({}, RL_BASE, { label: 'DPO con LoRA r = 16 · Llama 3 8B (la referencia = la base sin adaptadores)', method: 'dpo', lora: 1,
      source: 'DPO (arXiv:2305.18290) con LoRA r = 16, α = 32 en las 7 lineales: con un modelo PEFT y ref_model = None, TRL usa como referencia la misma base con los adaptadores apagados (disable_adapter): un solo juego de pesos.' }),
  };
  const RL_KNOBS = { B: [1, 4, 8, 16, 32], T: [512, 1024, 2048], groupSize: [4, 8, 16, 64], lora: [0, 1], refOffload: [0, 1], gradCkpt: [0, 1] };
  const ROLE_LABEL = {
    policy: 'Política π_θ (entrenable)', reference: 'Referencia π_ref (congelada)', reward: 'Reward model r_φ (congelado, cabeza D → 1)', critic: 'Crítico V_ψ (entrenable, cabeza D → 1)',
  };
  const ROLE_SHORT = { policy: 'Política', reference: 'Referencia', reward: 'Reward model', critic: 'Crítico' };
  const ROLE_PREFIX = { policy: 'pol-', reference: 'ref-', reward: 'rm-', critic: 'cr-' };

  function rlApply(c, ov) {
    const notes = [];
    ['B', 'T'].forEach((k) => { if (ov[k] !== undefined) c[k] = ov[k]; });
    if (c.T % 2 !== 0) throw new Error(c.label + ': T debe ser par (T_p = T_r = T/2).');
    if (ov.groupSize !== undefined) {
      if (c.method !== 'grpo') throw new Error(c.label + ': groupSize (G, respuestas por prompt) solo existe en GRPO.');
      if (ov.groupSize < 2) throw new Error(c.label + ': groupSize (G) debe ser ≥ 2 (la ventaja se normaliza dentro del grupo).');
      if (ov.groupSize !== c.groupSize) c.label += ' · G = ' + ov.groupSize;
      c.groupSize = ov.groupSize;
    }
    [['lora', ' · con LoRA', ' · sin LoRA'], ['refOffload', ' · referencia fuera de la GPU', ' · referencia en la GPU'], ['gradCkpt', ' · gradient checkpointing', ' · sin gradient checkpointing']].forEach(([k, on, off]) => {
      if (ov[k] === undefined) return;
      if (ov[k] !== 0 && ov[k] !== 1) throw new Error(c.label + ': ' + k + ' debe ser 0 o 1.');
      if (ov[k] !== c[k]) c.label += ov[k] ? on : off;
      c[k] = ov[k];
    });
    if (c.refOffload && c.lora) notes.push('Con LoRA la referencia ya no ocupa memoria (es la base con los adaptadores apagados): refOffload no cambia nada.');
    c._notes = notes;
    return c;
  }
  function rlResolve(c) {
    const b = LLMDEF.configs[c.base];
    ['D', 'L', 'h', 'G', 'dh', 'Dmlp', 'V', 'ctxMax', 'ropeTheta', 'eps'].forEach((k) => { c[k] = b[k]; });   // G = cabezas KV (F6)
    c.Dkv = b.G * b.dh; c.Dq = b.h * b.dh;
    c.Tp = c.T / 2; c.Tr = c.T - c.Tp;
    c.roles = c.method === 'ppo' ? ['policy', 'reference', 'reward', 'critic'] : ['policy', 'reference'];
    c.trainableRoles = c.method === 'ppo' ? ['policy', 'critic'] : ['policy'];
    c.seqs = c.method === 'dpo' ? 2 : (c.method === 'grpo' ? c.groupSize : 1);   // secuencias por prompt (por par en DPO)
    c.adapted = c.lora ? TARGETS[7].slice() : [];
    c.trainBits = c.lora ? 32 : 16; c.master = c.lora ? 0 : 1;
    c.tokens = c.T;
    return c;
  }

  function rlBuild(c, A) {
    const g = A.graph(c);
    const lv = c, S = c.seqs;
    const perSeq = c.method === 'dpo' ? ' (por secuencia: elegida y_w y rechazada y_l)' : c.method === 'grpo' ? ' (por respuesta: G = ' + c.groupSize + ' por prompt)' : '';
    g.input('ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Secuencia · prompt + respuesta (T = T_p + T_r = ' + c.Tp + ' + ' + c.Tr + ')' + perSeq, tex: '(x,\\,y)' });
    const roleOpt = (role) => ({
      prefix: ROLE_PREFIX[role], path: [role], where: [ROLE_LABEL[role]], label: ROLE_SHORT[role] + ' · ', S,
      head: role === 'reward' || role === 'critic' ? 'score' : 'lm',
      share: role === 'reference' && c.lora === 1,
      lora: c.lora === 1 && (role === 'policy' || role === 'critic') ? { r: c.r, alpha: c.alpha, p: c.p, targets: c.adapted } : null,
    });
    const rows = { start: c.Tp - 1, count: c.Tr };
    const lp = (role) => {
      const pre = ROLE_PREFIX[role], lg = importDecoder(g, lv, roleOpt(role));
      const sum = c.method === 'dpo';
      return g.op(pre + 'logprobs', A.token_logprobs(g.tensor(lg), { rows: c.Tr, sym: 'T_r', sum }), {
        path: [role, 'logprobs'], out: pre + 'logp', repeat: sum ? 1 : S, where: [ROLE_LABEL[role]],
        label: 'Log-probs de los ' + c.Tr + ' tokens de la respuesta' + (sum ? ' (suma por secuencia: y_w, y_l)' : ''), type: 'head', group: 'head',
        outMeta: { label: ROLE_SHORT[role] + ' · log-probs ' + (sum ? 'por secuencia (log π(y|x) de y_w y de y_l)' : 'por token de la respuesta'), tex: sum ? '\\log ' + (role === 'policy' ? '\\pi_\\theta' : '\\pi_{\\mathrm{ref}}') + '(y\\mid x)' : '\\log ' + (role === 'policy' ? '\\pi_\\theta' : '\\pi_{\\mathrm{ref}}') + '(y_t\\mid x, y_{<t})' },
      });
    };
    if (c.method === 'dpo') {
      // el resultado de token_logprobs con sum es 1 por secuencia; las 2 secuencias (y_w, y_l) → vector de 2
      const pl = lpDpo(g, c, lv, roleOpt, 'policy'), rl = lpDpo(g, c, lv, roleOpt, 'reference');
      g.op('dpo-loss', A.dpo_loss(pl, rl, { beta: c.beta }), { path: ['dpo-loss'], out: 'loss', where: ['Pérdida DPO'], label: 'Pérdida DPO: −log σ(β·[(log π − log π_ref)(y_w) − (log π − log π_ref)(y_l)]), β = ' + c.beta, type: 'head', group: 'head',
        outMeta: { label: 'Pérdida DPO del par', tex: '\\mathcal{L}_{\\mathrm{DPO}}' } });
      return g;
    }
    const pol = lp('policy'), ref = lp('reference');
    if (c.method === 'ppo') {
      // reward model: última posición de la cabeza escalar
      const rx = importDecoder(g, lv, roleOpt('reward'));
      const rs = g.op('rm-score', A.scalar_head(g.tensor(rx), { role: 'recompensa' }), { path: ['reward', 'score-head'], out: 'reward-scores', where: [ROLE_LABEL.reward], label: 'Cabeza de recompensa (score: D → 1, sin sesgo)', type: 'head', group: 'head',
        outMeta: { label: 'Reward model · score por posición', tex: 'h\\,w_r' } });
      const rw = g.op('rm-pool', A.pick_token(rs, { index: 'último token (sin relleno)' }), { path: ['reward', 'pool'], out: 'reward', where: [ROLE_LABEL.reward], label: 'Tomar el score del último token', type: 'tensorop', group: 'head',
        outMeta: { label: 'Recompensa escalar r_φ(x, y)', tex: 'r_\\phi(x,y)' } });
      const cx = importDecoder(g, lv, roleOpt('critic'));
      const cv = g.op('cr-value-head', A.scalar_head(g.tensor(cx), { role: 'valor' }), { path: ['critic', 'value-head'], out: 'critic-values', where: [ROLE_LABEL.critic], label: 'Cabeza de valor (score: D → 1, sin sesgo)', type: 'head', group: 'head',
        outMeta: { label: 'Crítico · valor por posición', tex: 'V_\\psi(s_t)' } });
      const vals = g.op('cr-take', A.take_rows(cv, Object.assign({ sym: 'T_r' }, rows)), { path: ['critic', 'take'], out: 'values', where: [ROLE_LABEL.critic], label: 'Valores de las posiciones de la respuesta', type: 'tensorop', group: 'head',
        outMeta: { label: 'Crítico · valores de la respuesta', tex: 'V_t' } });
      const kl = g.op('kl', A.kl_penalty(pol, ref, { estimator: 'k1', beta: c.klCoef }), { path: ['kl'], out: 'kl', where: ['Penalización KL'], label: 'KL por token: log π_θ − log π_ref (k1)', type: 'head', group: 'head',
        outMeta: { label: 'KL por token contra la referencia', tex: '\\log\\tfrac{\\pi_\\theta}{\\pi_{\\mathrm{ref}}}' } });
      const sr = g.op('shaped-reward', A.shaped_reward(kl, rw, { beta: c.klCoef }), { path: ['shaped-reward'], out: 'rewards', where: ['Recompensa con KL'], label: 'r_t = −β·KL_t (+ r_φ en el último token), β = ' + c.klCoef, type: 'head', group: 'head',
        outMeta: { label: 'Recompensa por token (con la penalización KL)', tex: 'r_t' } });
      const [adv, ret] = g.op('gae', A.gae(sr, vals, { gamma: c.gamma, lambda: c.lam }), { path: ['advantage', 'gae'], out: ['advantages', 'returns'], where: ['Ventajas (GAE)'], label: 'GAE (γ = ' + c.gamma + ', λ = ' + c.lam + ')', type: 'head', group: 'head',
        outMeta: [{ label: 'Ventajas por token (GAE)', tex: '\\hat A_t' }, { label: 'Retornos por token (Â + V)', tex: '\\hat R_t' }] });
      g.op('ppo-loss', A.ppo_clip_loss(pol, adv, { eps: c.clipEps }), { path: ['ppo-loss'], out: 'loss-policy', where: ['Pérdida PPO-clip'], label: 'PPO-clip: −min(ρÂ, clip(ρ, 1 ± ε)Â), ε = ' + c.clipEps, type: 'head', group: 'head',
        outMeta: { label: 'Pérdida de la política (PPO-clip)', tex: '\\mathcal{L}^{\\mathrm{CLIP}}' } });
      g.op('value-loss', A.value_loss(vals, ret, { eps: c.clipEps }), { path: ['value-loss'], out: 'loss-value', where: ['Pérdida del crítico'], label: 'Pérdida del crítico (MSE con clip)', type: 'head', group: 'head',
        outMeta: { label: 'Pérdida del crítico', tex: '\\mathcal{L}^{V}' } });
      return g;
    }
    // GRPO
    const rw = g.input('rewards', shp(['G'], [c.groupSize], 'txt', 'vec'), { label: 'Recompensas de las G respuestas del prompt (verificador: 0 parámetros)', tex: 'r_{1..G}' });
    const adv = g.op('group-adv', A.group_advantage(rw), { path: ['advantage', 'group-adv'], out: 'advantages', where: ['Ventaja por grupo'], label: 'Â_i = (r_i − media) / std sobre las G respuestas', type: 'head', group: 'head',
      outMeta: { label: 'Ventajas normalizadas en el grupo', tex: '\\hat A_i' } });
    const kl = g.op('kl', A.kl_penalty(pol, ref, { estimator: 'k3', beta: c.beta }), { path: ['kl'], out: 'kl', repeat: S, where: ['Penalización KL'], label: 'KL por token k3 = π_ref/π − log(π_ref/π) − 1', type: 'head', group: 'head',
      outMeta: { label: 'KL por token contra la referencia (k3)', tex: '\\mathbb{D}_{\\mathrm{KL}}^{(k3)}' } });
    g.op('grpo-loss', A.ppo_clip_loss(pol, adv, { eps: c.clipEps, kind: 'grpo', kl }), { path: ['grpo-loss'], out: 'loss', where: ['Pérdida GRPO'], label: 'GRPO: PPO-clip con Â del grupo + β·KL (β = ' + c.beta + ')', type: 'head', group: 'head',
      outMeta: { label: 'Pérdida GRPO del prompt', tex: '\\mathcal{L}_{\\mathrm{GRPO}}' } });
    return g;
  }
  // DPO: log-probs sumados por secuencia de las 2 secuencias (y_w, y_l) → vector de 2.
  function lpDpo(g, c, lv, roleOpt, role) {
    const pre = ROLE_PREFIX[role], lg = importDecoder(g, lv, roleOpt(role));
    const res = A.token_logprobs(g.tensor(lg), { rows: c.Tr, sym: 'T_r', sum: true });
    res.out = shp(['2'], [2], 'txt', 'vec');
    res.other *= 2;
    return g.op(pre + 'logprobs', res, { path: [role, 'logprobs'], out: pre + 'logp', where: [ROLE_LABEL[role]],
      label: 'log π(y|x) de y_w y de y_l: suma de los log-probs de los ' + c.Tr + ' tokens de cada respuesta', type: 'head', group: 'head',
      outMeta: { label: ROLE_SHORT[role] + ' · log-probs por secuencia (y_w, y_l)', tex: '\\log ' + (role === 'policy' ? '\\pi_\\theta' : '\\pi_{\\mathrm{ref}}') + '(y\\mid x)' } });
  }

  // ---- costo y memoria por rol
  function rlRoles(c, r) {
    const S = c.seqs;
    return c.roles.map((role) => {
      const ops = r.ops.filter((op) => op.path[0] === role);
      const trainableRole = c.trainableRoles.indexOf(role) >= 0;
      const tr = (op) => trainableRole && (c.lora ? (op.prim === 'lora_a' || op.prim === 'lora_b' || op.prim === 'scalar_head') : op.params > 0);
      const sc = seqCost(ops, { S, L: c.L, trainable: tr, ckpt: trainableRole && c.gradCkpt === 1, trainableRole });
      const wm = weightMemory(ops, c, tr);
      const st = trainState(wm.trainParams, c);
      const offloaded = role === 'reference' && c.refOffload === 1;
      const weightBytes = offloaded ? 0 : wm.frozenBytes + st.weights;
      const act = trainableRole ? activationModel(c, { full: !c.lora, adapted: c.lora ? c.adapted : [], p: c.p, ckpt: c.gradCkpt === 1, lmHead: role === 'policy' }) : null;
      const params = ops.reduce((s, op) => s + op.params * A.paramRep(op), 0);
      return { id: role, label: ROLE_LABEL[role], trainable: trainableRole, params, trainableParams: wm.trainParams, frozenParams: wm.frozenParams,
        weightBytes, gradBytes: st.grads, optimizerBytes: st.optimizer, stateBytes: st, activationPerSeq: act ? act.value : 0, act,
        inMemory: !offloaded && params > 0, sc, shared: params === 0 };
    });
  }
  // MACs de generar T_r tokens después de un prompt de T_p (llm.js): prefill con logits solo de la última fila (generate,
  // logits_to_keep = 1) + T_r − 1 pasos de decode con ctx = T_p + k. Con LoRA sin fusionar: + los adaptadores por token.
  function rolloutPerSeq(c) {
    const q = A.run(c.base, { T: c.Tp }).quantities;
    const pre = q.prefillMacs - (c.Tp - 1) * c.D * c.V;
    const n = c.Tr - 1;
    const dec = n * q.decodeLinearMacs + 2 * c.L * c.h * c.dh * (n * c.Tp + n * (n + 1) / 2);
    const lora = c.lora ? (c.Tp + n) * c.L * TARGETS[7].reduce((s, id) => { const l = LINEARS.find((x) => x.id === id); return s + c.r * (dimOf(c, l.din) + dimOf(c, l.dout)); }, 0) : 0;
    return { prefill: pre, decode: dec, lora, total: pre + dec + lora, kvBytesPerToken: q.kvBytesPerToken };
  }
  function rlCore(c, r) {
    const roles = rlRoles(c, r), by = Object.fromEntries(roles.map((x) => [x.id, x]));
    const B = c.B, S = c.seqs, nSeq = B * S;
    const ro = c.method === 'dpo' ? null : rolloutPerSeq(c);
    const rolloutMacs = ro ? nSeq * ro.total : 0;
    const f = (id) => (by[id] ? by[id].sc.fwd : 0);
    const upd = (id) => (by[id] ? by[id].sc.total : 0);
    const referenceMacs = c.method === 'dpo' && c.refOffload ? 0 : nSeq * f('reference');
    const rewardMacs = nSeq * f('reward');
    const criticForwardMacs = c.method === 'ppo' ? nSeq * f('critic') : 0;
    const policyForwardMacs = c.method === 'ppo' ? nSeq * f('policy') : 0;     // log-probs "old" (TRL recalcula con un forward)
    const epochs = c.method === 'ppo' ? c.ppoEpochs : 1;
    const policyUpdateMacs = epochs * nSeq * upd('policy');
    const criticUpdateMacs = c.method === 'ppo' ? epochs * nSeq * upd('critic') : 0;
    const scoringMacs = referenceMacs + rewardMacs + criticForwardMacs + policyForwardMacs;
    const trainStepMacs = rolloutMacs + scoringMacs + policyUpdateMacs + criticUpdateMacs;
    // memoria: pesos + gradientes + optimizador + máx(activaciones del update, KV cache del rollout)
    const weightBytes = roles.reduce((s, x) => s + x.weightBytes, 0);
    const gradBytes = roles.reduce((s, x) => s + x.gradBytes, 0);
    const optimizerBytes = roles.reduce((s, x) => s + x.optimizerBytes, 0);
    const activationBytes = nSeq * roles.reduce((s, x) => s + x.activationPerSeq, 0);
    const kvCacheBytes = ro ? nSeq * c.T * ro.kvBytesPerToken : 0;
    const total = weightBytes + gradBytes + optimizerBytes + Math.max(activationBytes, kvCacheBytes);
    return { roles, by, B, S, nSeq, ro, rolloutMacs, referenceMacs, rewardMacs, criticForwardMacs, policyForwardMacs, policyUpdateMacs, criticUpdateMacs, scoringMacs, trainStepMacs,
      weightBytes, gradBytes, optimizerBytes, activationBytes, kvCacheBytes, total, epochs };
  }
  function rlQuantities(c, r) {
    const roles = rlRoles(c, r);
    const q = { tokens: c.T, T: c.T, Tp: c.Tp, Tr: c.Tr, B: c.B, groupSize: c.method === 'grpo' ? c.groupSize : 0, seqs: c.seqs, L: c.L, D: c.D, V: c.V,
      beta: c.method === 'ppo' ? c.klCoef : c.beta, clipEps: c.clipEps, ppoEpochs: c.method === 'ppo' ? c.ppoEpochs : 0, totalParams: r.totals.params,
      modelsInMemory: roles.filter((x) => x.inMemory).length };
    roles.forEach((x) => { q[x.id + 'Params'] = x.params; q[x.id + 'TrainableParams'] = x.trainableParams; });
    q.trainableParams = roles.reduce((s, x) => s + x.trainableParams, 0);
    return q;
  }
  function rlMetrics(c, r) {
    const k = rlCore(c, r);
    const out = {
      method: c.method, B: c.B, T: c.T, Tp: c.Tp, Tr: c.Tr, groupSize: c.method === 'grpo' ? c.groupSize : 0, ppoEpochs: c.method === 'ppo' ? c.ppoEpochs : 0,
      sequencesPerStep: k.nSeq, tokensPerStep: k.nSeq * c.T,
      generationTokensPerStep: c.method === 'dpo' ? 0 : k.nSeq * c.Tr,
      modelsInMemory: k.roles.filter((x) => x.inMemory).length,
      trainableParams: k.roles.reduce((s, x) => s + x.trainableParams, 0), totalParams: r.totals.params,
      weightBytes: k.weightBytes, gradBytes: k.gradBytes, optimizerBytes: k.optimizerBytes, activationBytes: k.activationBytes, kvCacheBytes: k.kvCacheBytes,
      totalTrainMemory: k.total, fitsOn24: k.total <= 24e9, fitsOn48: k.total <= 48e9, fitsOn80: k.total <= 80e9, gpus80Needed: Math.ceil(k.total / 80e9),
      rolloutMacs: k.rolloutMacs, rolloutMacsPerSeq: k.ro ? k.ro.total : 0, referenceMacs: k.referenceMacs, rewardMacs: k.rewardMacs, criticForwardMacs: k.criticForwardMacs,
      policyForwardMacs: k.policyForwardMacs, scoringMacs: k.scoringMacs, policyUpdateMacs: k.policyUpdateMacs, criticUpdateMacs: k.criticUpdateMacs,
      updateMacs: k.policyUpdateMacs + k.criticUpdateMacs, trainStepMacs: k.trainStepMacs,
      referencePrecomputeMacs: c.method === 'dpo' && c.refOffload ? k.nSeq * k.by.reference.sc.fwd : 0,
      rolloutShare: k.rolloutMacs / k.trainStepMacs, scoringShare: k.scoringMacs / k.trainStepMacs, updateShare: (k.policyUpdateMacs + k.criticUpdateMacs) / k.trainStepMacs,
      policyTrainStepMacsPerSeq: k.by.policy.sc.total, policyForwardMacsPerSeq: k.by.policy.sc.fwd,
      gpus: fitsList(k.total), units: FT_UNITS,
      actMem: k.activationBytes, actMemPerSample: k.activationBytes / c.B, paramMem: k.weightBytes,
    };
    ['policy', 'reference', 'reward', 'critic'].forEach((id) => {
      const x = k.by[id];
      out[id + 'Params'] = x ? x.params : 0;
      out[id + 'WeightBytes'] = x ? x.weightBytes : 0;
      if (id === 'policy' || id === 'critic') { out[id + 'OptimizerBytes'] = x ? x.optimizerBytes : 0; out[id + 'GradBytes'] = x ? x.gradBytes : 0; }
    });
    if (k.by.critic) out.criticTrainStepMacsPerSeq = k.by.critic.sc.total;
    out.roles = k.roles.map((x) => ({ id: x.id, label: x.label, params: x.params, trainableParams: x.trainableParams, weightBytes: x.weightBytes, gradBytes: x.gradBytes,
      optimizerBytes: x.optimizerBytes, activationBytes: k.nSeq * x.activationPerSeq, inMemory: x.inMemory, trainable: x.trainable }));
    out.flopsSplit = [
      { id: 'rollout', label: 'Generación (rollout)', macs: k.rolloutMacs },
      { id: 'reference', label: 'Forward de la referencia', macs: k.referenceMacs },
      { id: 'reward', label: 'Forward del reward model', macs: k.rewardMacs },
      { id: 'old', label: 'Forward de la política y del crítico (log-probs y valores "old")', macs: k.policyForwardMacs + k.criticForwardMacs },
      { id: 'policy-update', label: 'Update de la política (forward + backward' + (c.gradCkpt ? ' + recomputación' : '') + (k.epochs > 1 ? ', × ' + k.epochs + ' épocas' : '') + ')', macs: k.policyUpdateMacs },
      { id: 'critic-update', label: 'Update del crítico', macs: k.criticUpdateMacs },
    ];
    out.memoryByRole = k.roles.map((x) => ({ id: x.id, label: x.label, bytes: x.weightBytes + x.gradBytes + x.optimizerBytes }))
      .concat([{ id: 'activations', label: 'Activaciones del update', bytes: k.activationBytes }, { id: 'kv-cache', label: 'KV cache del rollout', bytes: k.kvCacheBytes }]);
    const same = { B: c.B, T: c.T, lora: c.lora, gradCkpt: c.gradCkpt };
    out.methods = [['ppo', 'rlhf-llama3-8b'], ['dpo', 'dpo-llama3-8b'], ['grpo', 'grpo-llama3-8b']].map(([id, cid]) => {
      const rr = A.run(cid, same), kk = rlCore(rr.config, rr);
      return { id, configId: cid, label: rr.config.label, modelsInMemory: kk.roles.filter((x) => x.inMemory).length, totalTrainMemory: kk.total, weightBytes: kk.weightBytes,
        optimizerBytes: kk.optimizerBytes, gradBytes: kk.gradBytes, activationBytes: kk.activationBytes, kvCacheBytes: kk.kvCacheBytes,
        generationTokensPerStep: id === 'dpo' ? 0 : kk.nSeq * rr.config.Tr, trainStepMacs: kk.trainStepMacs, rolloutMacs: kk.rolloutMacs,
        roles: kk.roles.map((x) => ({ id: x.id, bytes: x.weightBytes + x.gradBytes + x.optimizerBytes, inMemory: x.inMemory })) };
    });
    return out;
  }

  // ------------------------------------------------------------------ unidades (las que la práctica sabe formatear)
  const FT_UNITS = {
    trainableParams: 'params', allParams: 'params', baseParams: 'params', mergedParams: 'params', adapterParamsPerLayer: 'params', totalParams: 'params',
    policyParams: 'params', referenceParams: 'params', rewardParams: 'params', criticParams: 'params',
    trainableShare: 'pct', rolloutShare: 'pct', scoringShare: 'pct', updateShare: 'pct',
    adapterBytes: 'bytes', trainableWeightBytes: 'bytes', baseWeightBytes: 'bytes', gradBytes: 'bytes', masterBytes: 'bytes', optimizerStateBytes: 'bytes', optimizerBytes: 'bytes',
    activationBytes: 'bytes', activationBytesNoCkpt: 'bytes', activationBytesCkpt: 'bytes', activationBytesPerTokenLayer: 'bytes', loraDropoutBytesPerTokenLayer: 'bytes',
    logitsBytes: 'bytes', attnScoresBytesEager: 'bytes', totalTrainMemory: 'bytes', baseWeightBytes16: 'bytes', baseWeightBytes8: 'bytes', baseWeightBytes4: 'bytes',
    baseWeightBytes4NoDQ: 'bytes', quantConstBytes: 'bytes', weightBytes: 'bytes', kvCacheBytes: 'bytes',
    policyWeightBytes: 'bytes', referenceWeightBytes: 'bytes', rewardWeightBytes: 'bytes', criticWeightBytes: 'bytes',
    policyOptimizerBytes: 'bytes', criticOptimizerBytes: 'bytes', policyGradBytes: 'bytes', criticGradBytes: 'bytes',
    bytesPerTrainableParam: 'ratio', quantBitsPerParam: 'ratio', quantConstBitsPerParam: 'ratio', memoryVsFullFt: 'ratio', trainStepMacsVsFullFt: 'ratio', trainableSharePct: 'ratio', backwardToForward: 'ratio',
    forwardMacs: 'macs', backwardMacs: 'macs', backwardInputGradMacs: 'macs', backwardWeightGradMacs: 'macs', recomputeMacs: 'macs', trainStepMacs: 'macs',
    trainStepMacsRule: 'macs', macsPerToken: 'macs', adapterMacsPerToken: 'macs',
    forwardMacsPerSeq: 'macs', backwardMacsPerSeq: 'macs', recomputeMacsPerSeq: 'macs', trainStepMacsPerSeq: 'macs', backwardInputGradMacsPerSeq: 'macs', backwardWeightGradMacsPerSeq: 'macs',
    rolloutMacs: 'macs', rolloutMacsPerSeq: 'macs', referenceMacs: 'macs', rewardMacs: 'macs', criticForwardMacs: 'macs', policyForwardMacs: 'macs', scoringMacs: 'macs',
    policyUpdateMacs: 'macs', criticUpdateMacs: 'macs', updateMacs: 'macs', referencePrecomputeMacs: 'macs', policyTrainStepMacsPerSeq: 'macs', policyForwardMacsPerSeq: 'macs',
    criticTrainStepMacsPerSeq: 'macs',
    r: 'count', alpha: 'count', targetsCount: 'count', B: 'count', T: 'count', Tp: 'count', Tr: 'count', groupSize: 'count', ppoEpochs: 'count', tokensPerStep: 'count',
    sequencesPerStep: 'count', generationTokensPerStep: 'count', modelsInMemory: 'count', gpus80Needed: 'count',
    attnMacs: 'macs', scoreMacs: 'macs', linearMacs: 'macs',   // genéricas de ATLAS.Arch.metrics
  };

  // ------------------------------------------------------------------ fórmulas numéricas (viz, práctica y cross-check)
  const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
  const logSigmoid = (x) => (x >= 0 ? -Math.log1p(Math.exp(-x)) : x - Math.log1p(Math.exp(x)));
  // Bradley-Terry: P(y_w ≻ y_l) = σ(r_w − r_l); pérdida −log σ(r_w − r_l).
  function bradleyTerry(rw, rl) { const d = rw - rl; return { margin: d, prob: sigmoid(d), loss: -logSigmoid(d) }; }
  // DPO (ec. 7): o = {piChosen, piRejected, refChosen, refRejected, beta}: log-probs por secuencia.
  function dpoLoss(o) {
    const beta = o.beta != null ? o.beta : 0.1;
    const rc = beta * (o.piChosen - o.refChosen), rr = beta * (o.piRejected - o.refRejected);
    const z = rc - rr;
    return { rewardChosen: rc, rewardRejected: rr, margin: z, prob: sigmoid(z), loss: -logSigmoid(z), gradScale: beta * sigmoid(-z) };
  }
  // PPO-clip por token: −min(ρÂ, clip(ρ, 1 − ε, 1 + ε)Â), ρ = exp(logp − oldLogp).
  function ppoClip(o) {
    const eps = o.eps != null ? o.eps : 0.2, rho = Math.exp(o.logp - o.oldLogp), A0 = o.adv;
    const clipped = Math.min(Math.max(rho, 1 - eps), 1 + eps);
    return { ratio: rho, clippedRatio: clipped, loss: -Math.min(rho * A0, clipped * A0), clipped: rho * A0 > clipped * A0 };
  }
  // KL por token desde log-probs muestreados: k1 = log π − log π_ref; k3 = e^{log π_ref − log π} − (log π_ref − log π) − 1.
  function klEstimators(logp, refLogp) { const d = refLogp - logp; return { k1: logp - refLogp, k3: Math.exp(d) - d - 1 }; }
  // GRPO: Â_i = (r_i − media) / (std + 1e-4); std con corrección de Bessel (torch.std por defecto, como TRL).
  function grpoAdvantages(rewards, o) {
    const n = rewards.length, m = rewards.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(rewards.reduce((s, x) => s + (x - m) * (x - m), 0) / (n - 1));
    const e = o && o.eps != null ? o.eps : 1e-4;
    return rewards.map((x) => (x - m) / (sd + e));
  }
  // GAE: δ_t = r_t + γV_{t+1} − V_t (V_T = 0), Â_t = δ_t + γλÂ_{t+1}; retornos = Â + V.
  function gaeCompute(rewards, values, o) {
    const g = o && o.gamma != null ? o.gamma : 1, l = o && o.lambda != null ? o.lambda : 0.95;
    const n = rewards.length, adv = new Array(n).fill(0);
    let last = 0;
    for (let t = n - 1; t >= 0; t--) {
      const next = t + 1 < n ? values[t + 1] : 0;
      const delta = rewards[t] + g * next - values[t];
      last = delta + g * l * last;
      adv[t] = last;
    }
    return { advantages: adv, returns: adv.map((a, t) => a + values[t]) };
  }
  // Bits por parámetro de NF4 (con / sin doble cuantización) para una matriz de n pesos.
  const nf4 = (n, dq) => A.quant_storage(n, { bits: 4, dq: !!dq });

  A.finetune = {
    OPTIMIZERS: JSON.parse(JSON.stringify(OPTIMIZERS)), TARGETS: JSON.parse(JSON.stringify(TARGETS)), TARGET_NAMES: Object.assign({}, TARGET_NAMES), TARGET_LABELS: Object.assign({}, TARGET_LABELS),
    LINEARS: LINEARS.map((l) => Object.assign({}, l)), GPUS: GPUS.map((x) => Object.assign({}, x)),
    bradleyTerry, dpoLoss, ppoClip, klEstimators, grpoAdvantages, gae: gaeCompute, nf4, sigmoid, logSigmoid, activationPerTokenLayer,
    seqCost: (configId, ov) => { const r = A.run(configId, ov); return r.model === 'lora' ? loraCore(r.config, r).sc : rlRoles(r.config, r).map((x) => ({ id: x.id, sc: x.sc })); },
  };

  A.defineModel({
    id: 'lora',
    label: 'LoRA / QLoRA / fine-tuning completo (Llama 3 8B)',
    paper: { title: 'LoRA: Low-Rank Adaptation of Large Language Models', authors: 'Hu, Shen, Wallis, Allen-Zhu, Li, Wang, Wang, Chen', venue: 'ICLR 2022', year: 2022, arxiv: '2106.09685',
      note: 'QLoRA: Dettmers, Pagnoni, Holtzman, Zettlemoyer, NeurIPS 2023, arXiv:2305.14314. ZeRO (memoria de Adam en precisión mixta): Rajbhandari et al., SC 2020, arXiv:1910.02054. Activaciones: Korthikanti et al., MLSys 2023, arXiv:2205.05198. Adam 8-bit: Dettmers et al., ICLR 2022, arXiv:2110.02861.' },
    configs: LORA,
    knobs: LORA_KNOBS,
    zeroKnobs: ['optimizer', 'gradCkpt'],
    applyKnobs: loraApply, resolve: loraResolve, build: loraBuild, quantities: loraQuantities, metrics: loraMetrics,
  });

  A.defineModel({
    id: 'rlhf-dpo',
    label: 'SFT → RLHF (PPO), DPO y GRPO (Llama 3 8B)',
    paper: { title: 'Training language models to follow instructions with human feedback', authors: 'Ouyang, Wu, Jiang et al. (OpenAI)', venue: 'NeurIPS 2022', year: 2022, arxiv: '2203.02155',
      note: 'DPO: Rafailov et al., NeurIPS 2023, arXiv:2305.18290. PPO: Schulman et al. 2017, arXiv:1707.06347. GAE: Schulman et al., ICLR 2016, arXiv:1506.02438. GRPO: Shao et al. 2024 (DeepSeekMath), arXiv:2402.03300. Preferencias humanas: Christiano et al., NeurIPS 2017, arXiv:1706.03741; Stiennon et al., NeurIPS 2020, arXiv:2009.01325.' },
    configs: RL,
    knobs: RL_KNOBS,
    zeroKnobs: ['lora', 'refOffload', 'gradCkpt'],
    applyKnobs: rlApply, resolve: rlResolve, build: rlBuild, quantities: rlQuantities, metrics: rlMetrics,
  });
})(typeof window !== 'undefined' ? window : globalThis);
