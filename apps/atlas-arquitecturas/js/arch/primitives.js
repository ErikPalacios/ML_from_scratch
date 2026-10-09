/* =============================================================================
   Atlas de Arquitecturas — js/arch/primitives.js
   ATLAS.Arch: la calculadora de arquitecturas (SPEC §6). Única fuente de números:
   formas, parámetros y MACs de cada primitiva; constructor de grafos; run(), metrics(),
   fmt, configs(), models(), primitives(). Sin DOM: se carga también en Node.

   Convenciones (SPEC §6.2):
   - Formas SIN batch, "tokens × canales" (N×D); imágenes H×W×C (channels-last; PyTorch usa C×H×W).
   - MACs = multiplica-acumula de matmuls/convs (m·n·k). FLOPs = 2 × MACs.
   - "otros (≈)" = estimación de operaciones elementwise (sesgos, normas, softmax, activaciones,
     sumas), excluida del número principal. Costos por elemento usados (≈, documentados):
     sesgo 1 · suma/residual 1 · escala 1 · LayerNorm 5 · RMSNorm 4 · softmax 5 · GELU 8.
   - Parámetros exactos, con sesgos cuando la implementación de referencia los tiene.

   Contrato de run(configId) = SPEC §6.7. Añadidos compatibles (no rompen el contrato):
   - op: también `node` (= último de path), `type` (paleta §3.1), `group` (embed|attn|mlp|norm|
     head|resid|act), `detail`, `batched` (CLIP: op de la parte conjunta). tensor: también `elements`
     y `batched` (ya incluye el batch B). totals: también `byGroup` y `byPath` (clave = path unido
     con '>', p. ej. 'txt-encoder>enc-layer': separa nodos que repiten id en dos lugares, como las
     dos torres de CLIP o W-MSA/SW-MSA de Swin); byNode[id] también trae `other`.
     Resultado: también `overrides` y `notes` (avisos, p. ej. interpolación de position embeddings).
   - run(configId, overrides?) acepta knobs (memoizado por configId + overrides).
   - metrics(configId, overrides) acepta además `B`, `dtype` ('fp32'|'fp16'|'bf16'|'fp8'|'int8') y
     `ctx` (largo para kvCache) dentro de overrides (no cambian la arquitectura, solo los bytes;
     salvo en un modelo que declare B como knob — CLIP —, donde B también cambia los tensores
     conjuntos y su valor por defecto es el de la config). attnMem/actMem/kvCache se devuelven como
     números (bytes) para esos B y dtype (por defecto B=1, bf16). kvCache = null en modelos sin
     máscara causal. attnMem = el mayor tensor de scores de una capa; attnMemAllLayers = todos.
     actMem (≈, entrenamiento) = cada tensor materializado del forward una vez por repetición de su
     op, SIN vistas/movimientos (split/merge de cabezas, flatten, partición de ventanas, roll),
     SIN tablas de parámetros (e-pos) y SIN los scores previos al softmax (QKᵀ, escalados, con
     sesgo o máscara: el backward no los guarda). Cada modelo puede añadir claves (def.metrics).
   - Primitivas extra `scale` (×1/√d_h), `add` (suma no residual), `flatten` (rejilla → secuencia).
   - Tensores extra respecto de SPEC §13.1 (añadidos, nada renombrado): `e-pos` (tabla de posición)
     y `scores-scaled` (salida del nodo `scale`). Ver la cabecera de js/arch/vit.js.
   - Fase 2 (Swin, ResNet, CLIP): batchnorm2d, relu, maxpool2d, global_avg_pool, conv_bn,
     bottleneck, cyclic_shift, window_partition, window_reverse, rel_pos_bias, attn_mask,
     causal_mask, window_attention, patch_concat, patch_merging, causal_self_attention, pick_token,
     l2_normalize, stack_batch, similarity_logits, logit_scale, contrastive_loss. Las primitivas de
     atención aceptan una dimensión delantera de ventanas (nW×…); layouts nuevos 'windows'
     (nW×M²×C), 'winheads' (nW×h×M²×d_h) y 'mat' (B×B). conv2d acepta `floor` (redondeo de PyTorch).
   - Fase 3 (DETR, Deformable DETR): frozen_batchnorm2d (γ, β y estadísticas congeladas = buffers),
     group_norm, sigmoid, sine_pos_encoding (PE 2-D seno/coseno, buffer), level_embed, add_level_embed,
     flatten_levels, learned_queries, zeros_init, split_qkv_heads (Q, K, V con largos distintos),
     multihead_attention y cross_attention (compuestas; Q de una secuencia, K/V de otra; posición opcional
     solo en Q y K), reference_points (rejilla de puntos de referencia por nivel), deform_sample
     (muestreo bilineal: 4 MACs por canal y punto), deform_weighted_sum (suma ponderada de los puntos
     muestreados), deformable_attention (compuesta: lineal en tokens, sin término N_q·N_k), ref_offset
     (suma inverse_sigmoid(ref) a la caja), box_mlp (compuesta), hungarian_cost (matriz Q×G),
     hungarian_match y set_prediction_loss (solo "otros"). conv_bn y bottleneck aceptan `frozenBN`
     (sin la opción, el resultado es exactamente el de la fase 2).
   - Fase 4 (Grounding DINO, YOLO-World, YOLOv8): silu, upsample_nearest, concat_channels, split_channels,
     adaptive_max_pool, layer_scale, subsentence_mask, sine_pos_1d, box_sine_embed, encoder_proposals,
     contrastive_logits (logits = query · token de texto, sin pesos), topk_select, gather_rows, transpose_scores,
     token_mask, text_guided_scores, max_over_text, maxsig_gate, head_modulate, region_text_similarity, scale_bias,
     dfl_decode, dist2bbox, merge_level_logits, offline_text_encoder (0 en el grafo online; costo en detail); compuestas conv_bn_act (Conv de Ultralytics), csp_bottleneck, c2f,
     sppf, max_sigmoid_attn, t_csp_layer, image_pooling_attn y bi_attention. Un '·' dentro de un símbolo se escribe
     \cdot en LaTeX. Ninguna cambia el resultado de las fases 1–3.
   - Fase 5 (SAM, SAM 2): conv_transpose2d (k = s), depthwise_conv2d, window_partition_pad / window_unpartition (ventanas con
     relleno y recorte, como SAM y Hiera), decomposed_rel_pos (posición relativa por eje de MViTv2: 2·(2S−1)·d_h parámetros),
     query_pool (Hiera), coord_grid, fourier_pe (PE aleatoria de SAM, G = buffer), append_pad_point, type_embed, learned_tokens,
     broadcast_embed, idle_params (parámetros del modelo que el forward no usa: sin tensores ni MACs), rope_2d, take_rows,
     grouped_linear (hipernetwork), hyper_dot, mask_select, pick_mask, upsample_bilinear, to_grid, split_tokens, repeat_rows,
     add_temporal_embed, pos_embed_grid, window_pos_embed y gate_embed. Ninguna cambia el resultado de las fases 1–4.
   - Fase 6 (LLM decoder: Llama 3, Llama 2, Mixtral): rope (RoPE 1-D por cabeza, θ configurable), split_gqa_heads (Q en h
     cabezas, K y V en G cabezas KV: GQA/MQA/MHA), mul (producto elementwise de SwiGLU), lm_head (Linear D → V sin sesgo),
     sample_token (última fila de los logits → siguiente token), kv_append (KV cache: filas pasadas + la nueva), moe_router,
     moe_topk, expert_linear (pesos de E expertos, MACs solo de las filas enrutadas), moe_combine; compuestas swiglu,
     gqa_attention, llama_block y moe_ffn. attention_scores y attention_weighted_sum aceptan además K/V con MENOS cabezas
     que Q (GQA: h divisible por G; cada cabeza KV la comparten h/G cabezas de query; MACs h·N_q·N_k·d_h, iguales que MHA):
     con las mismas cabezas el resultado es exactamente el de antes. NON_ARCH suma 'bandwidth', 'peakFlops' y 'hbmBytes'
     (entradas de hardware de metrics(), no knobs) y def.metrics recibe también `overrides`. Ninguna cambia las fases 1–5.
     Revisión de la fase 6: fmt.si y fmt.ops suman el prefijo P (10¹⁵): solo cambia el texto de valores ≥ 10¹⁵.
   - Fase 7 (VLM: LLaVA, Qwen2-VL): repeat_frames, patch_embed_3d (Conv3d de Qwen2-VL), flatten_nd, segment_rows (atención por
     segmento del ViT de Qwen2-VL en video), group_tokens (merge 2×2), splice_tokens (los tokens visuales reemplazan a <image>),
     mrope (M-RoPE) y mrope_ids; graph.has(id); importGraph(g, src, o) compone un modelo con el grafo de otro (el decoder de
     llm.js dentro del VLM) sin duplicar su constructor; preLnLayer acepta hSym, dhSym, DmlpSym, rope, outMeta y entradas con
     dimensiones delanteras (todas opcionales). Ninguna cambia el resultado de las fases 1–6.
   - Fase 8 (difusión: Stable Diffusion, DiT): timestep_embedding (sinusoidal del paso t, buffer; n valores → n·dim),
     concat_features (concatenar en la última dimensión: los dos textos de SDXL), label_embed (tabla K + 1
     con la clase nula de CFG), add_broadcast (vector por canal sumado a una rejilla: el tiempo en la U-Net), downsample2d
     (conv 3×3 stride 2, padding simétrico o el (0, 1, 0, 1) del VAE), geglu, adaln_zero (SiLU → Linear D → kD → k vectores),
     ada_modulate (x(1 + γ) + β), ada_gate (α ⊙ x), sincos_pos_2d (posición fija de DiT), unpatchify, latent_sample,
     latent_scale, add_noise (DDPM o flow), flow_target, cfg_combine, scheduler_step, mse_loss; compuestas resnet_block,
     upsample2d, geglu_ff, spatial_transformer y dit_block. layernorm acepta {affine: false} (0 parámetros, LayerNorm de DiT);
     symTexAtom convierte '²' en ^2 (solo 'M²' lo tenía, y va por SYM_TEX); resolve acepta 0 en los knobs que el modelo
     declare en def.zeroKnobs (cfg). Ninguna cambia el resultado de las fases 1–7 (verificado: run y metrics de todas las
     configs anteriores idénticos antes y después).
   - Fase 9 (VLA: OpenVLA, π0; movidas desde vla.js tras la fase 8, mismo contrato y mismos números): normalize_pixels
     ((x − μ)/σ por canal con las estadísticas de cada encoder), prefix_tokens (CLS + registros de DINOv2-reg4), broadcast_rows
     (un vector en R filas: el tiempo en cada acción), prefix_mask y block_causal_mask (máscaras de π0), ar_decode (los pasos de
     decode autorregresivo que faltan tras el prefill) y detokenize_actions (id → bin → centro → desnormalizar). No están en
     NOT_SAVED (como cuando vivían en vla.js): run y metrics de todas las configs, idénticos antes y después.
   - Fase 10 (LoRA / QLoRA, SFT / RLHF / DPO; modelos en js/arch/finetune.js): dropout (lora_dropout de PEFT), lora_a, lora_b,
     lora_scale y la compuesta lora_linear (A → B → ×α/r: parámetros r·(d_in + d_out), MACs N·r·(d_in + d_out); la rama congelada
     en detail), quant_storage(n, {bits, rows, dq}) (bytes de una matriz a 16 / 8 / 4 bits: int8 + absmax por fila, NF4 + absmax
     por bloque de 64 con o sin doble cuantización: 0.5 → 0.127 bits por parámetro; no es una op del grafo), scalar_head
     (D → 1: recompensa / valor), token_logprobs, kl_penalty (k1 / k3), shaped_reward, gae, group_advantage, ppo_clip_loss,
     value_loss, bt_loss y dpo_loss (solo "otros"). Fuera de NOT_SAVED. Ninguna cambia el resultado de las fases 1–9
     (verificado: run y metrics de las 56 configs anteriores idénticos antes y después).
   - Fase 11 (BERT, recuperación densa, ANN; modelos en js/arch/retrieval.js): tanh, mean_pool, pooler (compuesta: [CLS] → Linear →
     tanh), tied_decoder (decoder del MLM atado a los word embeddings: solo el sesgo V cuenta), mlm_head (compuesta), nsp_head,
     score_head (Linear D → 1 con sesgo: cross-encoder), cross_entropy, mlm_mask (15 %: 80 / 10 / 10), pair_tokens, dot_score,
     token_sim / max_reduce / sum_reduce y la compuesta maxsim (ColBERT), topk_scores, truncate_dim (Matryoshka), embed_index;
     ANN: flat_scan, hnsw_descent / hnsw_beam (≈), ivf_coarse (centroides = parámetros), ivf_residual, pq_lut, pq_scan y la
     contabilidad flat_bytes / hnsw_bytes / ivfpq_bytes (fórmulas verificadas con faiss 1.15.1). Graph helper postLnLayer (capa
     post-LN: BERT). OTHER suma tanh y max; NOT_SAVED suma embed_index y truncate_dim; symTexAtom escribe n_list / n_probe como
     n_{\mathrm{list}} (ningún símbolo anterior los tenía). Ninguna cambia el resultado de las fases 1–10 (verificado: run y
     metrics de las 65 configs anteriores idénticos antes y después).
   - Fase 12 (encoder-decoder: T5, Whisper; modelos en js/arch/encdec.js): conv1d (secuencia T×C, channels-last; front end de
     Whisper), t5RelativeBucket (port exacto de T5Attention._relative_position_bucket de HF, en float32), t5_rel_bias (sesgo de
     posición relativa por buckets: tabla aprendida n_buckets × h, se calcula en la capa 1 y la reusan todas), add_rel_bias (sumar
     el sesgo a los scores), pad_or_trim (audio a 30 s) y log_mel (STFT + banco mel + log: preprocesamiento, 0 MACs del modelo; su
     costo ≈ va en "otros"). SYM_TEX suma T_in, T_out y n_mels; NOT_SAVED suma t5_rel_bias, add_rel_bias y pad_or_trim (ningún
     modelo anterior los usa). Ninguna cambia el resultado de las fases 1–11 (verificado: run y metrics de las 75 configs
     anteriores idénticos antes y después).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // ------------------------------------------------------------------ formato
  function int(n) {
    if (n === null || n === undefined || !isFinite(n)) return String(n);
    const neg = n < 0;
    const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg ? '-' + s : s;
  }

  // si(n): 86.6 M · 17.56 G · 1.77 M · 590.6 K. decimals opcional fuerza los decimales.
  // Fase 6 (revisión): prefijo P (10¹⁵) para el prefill largo de un LLM (5.49 PMACs, no "5487.25 TMACs").
  // Fase 11 (revisión): prefijo E (10¹⁸) para el preentrenamiento de BERT (14.51 EMACs, no "14505.53 PMACs").
  function si(n, decimals) {
    const a = Math.abs(n);
    const units = [[1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, u] of units) {
      if (a >= v) {
        const x = n / v;
        const d = decimals !== undefined ? decimals : (v >= 1e9 ? 2 : (Math.abs(x) < 10 ? 2 : 1));
        return x.toFixed(d) + ' ' + u;
      }
    }
    return decimals !== undefined ? n.toFixed(decimals) : int(n);
  }

  // bytes(n): ÚNICO formateador de memoria de la app. Unidades DECIMALES (SI): 1 KB = 1000 B,
  // 1 MB = 10⁶ B, 1 GB = 10⁹ B, 1 TB = 10¹² B (como las fichas de GPU y los tamaños de checkpoint).
  // 931,416 → '931.4 KB' · 173,135,312 → '173.1 MB' · 2,000,000 → '2.00 MB' · 512 → '512 B'.
  // Dos decimales por debajo de 10 y uno por encima (≥ 3 cifras significativas).
  function bytes(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const a = Math.abs(n);
    const units = [[1e12, 'TB'], [1e9, 'GB'], [1e6, 'MB'], [1e3, 'KB']];
    for (const [v, u] of units) {
      if (a >= v) {
        const x = n / v;
        let s = x.toFixed(Math.abs(x) < 10 ? 2 : 1);
        // 999.96 KB → '1000.0 KB': sube de unidad.
        if (Math.abs(parseFloat(s)) >= 1000 && v < 1e12) { const y = n / (v * 1e3); s = y.toFixed(2); return s + ' ' + units[units.findIndex((w) => w[0] === v) - 1][1]; }
        return s + ' ' + u;
      }
    }
    return int(n) + ' B';
  }

  // ops(n, unit): cómputo con el prefijo pegado a la unidad, formato único de la app:
  // 17,563,828,224 → '17.56 GMACs' · ops(n, 'FLOPs') → '35.13 GFLOPs' · 872 → '872 MACs'.
  function ops(n, unit) {
    const u = unit || 'MACs';
    const s = si(n);
    const m = s.match(/^(.*) ([KMGTPE])$/);
    return m ? m[1] + ' ' + m[2] + u : s + ' ' + u;
  }

  // duration(ms) (fase 11): un tiempo en milisegundos con su unidad, 3 cifras significativas: 0.693 → '0.693 ms',
  // 36,842 → '36.8 s', 975,384 → '16.3 min', 2.7e7 → '7.5 h', 5.9e8 → '6.8 días'. Para cotas largas (codificar un corpus,
  // construir un índice) que en ms son ilegibles ('975,384 ms'). La unidad va en el texto (a diferencia de las métricas 'ms').
  function duration(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '—';
    const a = Math.abs(ms), p3 = (x) => (Math.abs(x) >= 1000 ? int(x) : String(Number(x.toPrecision(3))));
    if (a < 1000) return p3(ms) + ' ms';
    if (a < 60e3) return p3(ms / 1e3) + ' s';
    if (a < 3600e3) return p3(ms / 60e3) + ' min';
    if (a < 48 * 3600e3) return p3(ms / 3600e3) + ' h';
    return p3(ms / 86400e3) + ' días';
  }

  function pct(x, decimals) { return (x * 100).toFixed(decimals === undefined ? 1 : decimals) + ' %'; }
  // Porcentaje para prosa y tablas (fase 10, revisión): 1 decimal desde 1 %; por debajo de 1 % (y ≠ 0), 3 cifras
  // significativas — 0.000848 → '0.0848 %', 0.005196 → '0.520 %' (con 1 decimal serían '0.1 %' y '0.5 %': −18 % y −4 %).
  // Desde 1 % es idéntico a pct(x): 0.1234 → '12.3 %'. Lo usan quantities.js ({{metrics.…}} en %, node.….paramsPct), la
  // práctica (fMetric) y las tablas compare (blocks.js).
  function pctAuto(x) {
    const p = x * 100;
    if (p !== 0 && isFinite(p) && Math.abs(p) < 1) return p.toPrecision(3) + ' %';
    return pct(x);
  }

  // Símbolos: texto plano y LaTeX.
  const SYM_TEX = { D_mlp: 'D_{\\mathrm{mlp}}', d_h: 'd_h', 'P^2C': 'P^2C', nW: 'n_W', 'M²': 'M^2', D_t: 'D_t',
    // Fase 3 (Deformable DETR): h cabezas, L niveles, K puntos por cabeza y nivel (notación del paper, salvo h).
    'hLK·2': 'hLK\\cdot 2', K_cls: 'K_{\\mathrm{cls}}',
    // Fase 12 (T5, Whisper): largos de entrada y salida del encoder-decoder y bandas mel.
    T_in: 'T_{\\mathrm{in}}', T_out: 'T_{\\mathrm{out}}', n_mels: 'n_{\\mathrm{mels}}' };
  function symTexAtom(s) {
    s = String(s);
    if (SYM_TEX[s]) return SYM_TEX[s];
    // Fase 4: '·' dentro de un símbolo (H/8·W/8, las celdas de un nivel de YOLO) → \cdot. Ningún símbolo
    // anterior lo usa fuera de SYM_TEX (hLK·2), así que las fórmulas de las fases 1–3 no cambian.
    // Fase 8: '²' dentro de un símbolo (P²·8 de DiT) → ^2. El único símbolo anterior con '²' (M²) está en SYM_TEX.
    // Fase 11 (ANN): n_list / n_probe → n_{\mathrm{list}} (ningún símbolo anterior los tiene).
    return s.replace(/D_mlp/g, 'D_{\\mathrm{mlp}}').replace(/n_(list|probe)/g, 'n_{\\mathrm{$1}}').replace(/·/g, '\\cdot ').replace(/²/g, '^2');
  }
  const compound = (s) => /[+\-\/ ]/.test(String(s));
  // En una forma: (N+1)×D. En LaTeX de forma: (N{+}1)\times D.
  function symText(s) { s = String(s); return compound(s) ? '(' + s + ')' : s; }
  function symTexShape(s) {
    const t = symTexAtom(s).replace(/-/g, '{-}').replace(/\+/g, '{+}');
    return compound(s) ? '(' + t + ')' : t;
  }
  // En un producto de fórmula: (N+1)\cdot D.
  function symTexFactor(s) { const t = symTexAtom(s); return compound(s) ? '(' + t + ')' : t; }
  const texProd = (syms) => syms.map(symTexFactor).join('\\cdot ');
  // k·sym en LaTeX: 2·D → '2D'; 2·2C → '4C'; 2·64 → '128' (símbolos que empiezan por un entero).
  function texScale(k, sym) {
    const m = String(sym).match(/^(\d+)(.*)$/);
    if (m && !compound(sym)) return String(k * parseInt(m[1], 10)) + symTexAtom(m[2]);
    return k + symTexFactor(sym);
  }

  function shapeStr(t, mode) {
    if (!t) return '';
    if (mode === 'sym') return t.sym.map(symText).join('×');
    return t.num.join('×');
  }
  function shapeTex(t) { return t ? t.sym.map(symTexShape).join('\\times ') : ''; }

  // Aritmética con números reales: términos = productos de factores. '768·2304 + 2304 = 1,771,776'.
  const prod = (a) => a.reduce((x, y) => x * y, 1);
  function sumTerms(terms) { return terms.reduce((s, t) => s + prod(t), 0); }
  function arith(terms) {
    if (!terms.length) return '0';
    const total = sumTerms(terms);
    if (terms.length === 1 && terms[0].length === 1) return int(total);
    return terms.map((t) => t.join('·')).join(' + ') + ' = ' + int(total);
  }
  // Suma de subtotales (compuestas): '1,771,776 + 590,592 = 2,362,368'.
  function arithSum(values) {
    const v = values.filter((x) => x > 0);
    const total = v.reduce((a, b) => a + b, 0);
    if (v.length <= 1) return int(total);
    return v.map(int).join(' + ') + ' = ' + int(total);
  }

  const fmt = { int, si, ops, bytes, pct, pctAuto, duration, shape: shapeStr, shapeTex, symText, symTex: symTexShape };

  // ------------------------------------------------------------------ formas
  function shape(sym, num, mod, layout) {
    if (!Array.isArray(sym) || !Array.isArray(num) || sym.length !== num.length) {
      throw new Error('Forma inválida: sym y num deben ser arreglos del mismo largo.');
    }
    num.forEach((n) => { if (!Number.isInteger(n) || n <= 0) throw new Error('Forma inválida: dimensión ' + n + ' no es un entero positivo.'); });
    return { sym: sym.map(String), num: num.slice(), mod: mod || null, layout: layout || (num.length === 1 ? 'vec' : 'seq') };
  }
  const plain = (t) => ({ sym: t.sym.slice(), num: t.num.slice(), mod: t.mod, layout: t.layout });
  const elems = (t) => prod(t.num);

  // Costos elementwise por elemento (≈) para "otros".
  const OTHER = { bias: 1, add: 1, scale: 1, layernorm: 5, rmsnorm: 4, softmax: 5, gelu: 8,
    batchnorm: 5, relu: 1, mask: 1, l2norm: 3,
    // Fase 3: BN congelada = escala + desplazamiento; GroupNorm como LayerNorm; sigmoide; PE seno/coseno.
    frozenbn: 2, groupnorm: 5, sigmoid: 4, sinpos: 3,
    // Fase 4: SiLU (x·σ(x)) ≈ sigmoide + producto.
    silu: 4,
    // Fase 5: interpolación bilineal (4 vecinos) y bicúbica (16), rotación RoPE (q·cos + rot(q)·sin).
    bilinear: 4, bicubic: 16, rope: 3,
    // Fase 6: producto elementwise (SwiGLU: SiLU(gate) ⊙ up), top-k del router (≈ 1 comparación por logit).
    mul: 1, topk: 1,
    // Fase 11: tanh (pooler de BERT), máximo por fila (MaxSim de ColBERT).
    tanh: 5, max: 1 };

  // Resultado común de una primitiva.
  function result(prim, inputs, out, o) {
    const pTerms = o.paramTerms || [];
    const mTerms = o.macTerms || [];
    const params = o.params !== undefined ? o.params : sumTerms(pTerms);
    const macs = o.macs !== undefined ? o.macs : sumTerms(mTerms);
    const outs = Array.isArray(out) ? out : [out];
    const ins = inputs.filter(Boolean);
    const inTex = ins.map(shapeTex).join(',\\ ');
    const outTex = outs.map(shapeTex).join(',\\ ');
    return {
      prim, inputs: ins, out,
      params, macs, other: o.other || 0,
      paramFormula: o.paramTex || (params ? '' : '0'),
      macFormula: o.macTex || (macs ? '' : '0'),
      paramArith: o.paramArith || arith(pTerms),
      macArith: o.macArith || arith(mTerms),
      shapeTex: (inTex ? inTex + ' \\to ' : '\\to ') + outTex,
      detail: o.detail || {},
    };
  }

  // ------------------------------------------------------------------ primitivas
  // linear: última dimensión din → dout. o = {dout, doutSym, bias=true, mod?}
  function linear(x, o) {
    const bias = o.bias !== false;
    const din = x.num[x.num.length - 1], dinSym = x.sym[x.sym.length - 1];
    const rows = x.num.slice(0, -1), rowsSym = x.sym.slice(0, -1);
    const dout = o.dout, doutSym = o.doutSym || String(dout);
    const out = shape(rowsSym.concat([doutSym]), rows.concat([dout]), o.mod || x.mod, x.layout === 'vec' ? 'vec' : x.layout);
    const pTerms = [[din, dout]].concat(bias ? [[dout]] : []);
    return result('linear', [x], out, {
      paramTerms: pTerms,
      paramTex: texProd([dinSym, doutSym]) + (bias ? ' + ' + symTexFactor(doutSym) : ''),
      macTerms: [rows.concat([din, dout])],
      macTex: texProd(rowsSym.concat([dinSym, doutSym])),
      other: bias ? prod(rows) * dout * OTHER.bias : 0,
      detail: { din, dout, bias },
    });
  }

  // conv2d sobre H×W×C (channels-last). o = {k, s=k, p=0, cout, coutSym, kSym, outSym:[hs, ws], bias=true}
  function conv2d(x, o) {
    if (x.num.length !== 3) throw new Error('conv2d espera una entrada H×W×C.');
    const [H, W, C] = x.num, [, , Cs] = x.sym;
    const k = o.k, s = o.s || o.k, p = o.p || 0, bias = o.bias !== false;
    // o.floor: redondeo hacia abajo como PyTorch (ResNet: 7×7 s2 p3 sobre 224 → 112). Sin floor, exige divisibilidad.
    if (!o.floor && ((H + 2 * p - k) % s !== 0 || (W + 2 * p - k) % s !== 0)) {
      throw new Error('conv2d: la resolución ' + H + '×' + W + ' no es divisible por el stride ' + s + ' (con kernel ' + k + ').');
    }
    const Ho = Math.floor((H + 2 * p - k) / s) + 1, Wo = Math.floor((W + 2 * p - k) / s) + 1;
    const cout = o.cout, coutSym = o.coutSym || String(cout), kSym = o.kSym || String(k);
    const outSym = o.outSym || [String(Ho), String(Wo)];
    const out = shape([outSym[0], outSym[1], coutSym], [Ho, Wo, cout], o.mod || x.mod, 'grid');
    const kk = symTexFactor(kSym) + '^2';
    return result('conv2d', [x], out, {
      paramTerms: [[k, k, C, cout]].concat(bias ? [[cout]] : []),
      paramTex: kk + '\\cdot ' + symTexFactor(Cs) + '\\cdot ' + symTexFactor(coutSym) + (bias ? ' + ' + symTexFactor(coutSym) : ''),
      macTerms: [[Ho, Wo, cout, k, k, C]],
      macTex: o.macTex || (texProd([outSym[0], outSym[1], coutSym]) + '\\cdot ' + kk + '\\cdot ' + symTexFactor(Cs)),
      other: bias ? Ho * Wo * cout * OTHER.bias : 0,
      detail: { k, s, p, Ho, Wo, cin: C, cout, bias, patchify: k === s && p === 0 },
    });
  }

  function norm(prim, x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    const affine2 = prim === 'layernorm';
    // Fase 8 (DiT): o.affine === false → LayerNorm sin γ ni β (elementwise_affine = False; la escala y el desplazamiento
    // los pone adaLN): 0 parámetros. Sin la opción, el resultado es exactamente el de antes.
    if (o && o.affine === false) {
      return result(prim, [x], plain(x), { params: 0, paramTex: '0\\ (\\text{sin }\\gamma,\\beta)', other: elems(x) * OTHER[prim], detail: { D, eps: o.eps || null, affine: false } });
    }
    return result(prim, [x], plain(x), {
      paramTerms: affine2 ? [[2, D]] : [[D]],
      paramTex: affine2 ? texScale(2, Ds) : symTexFactor(Ds),
      other: elems(x) * OTHER[prim],
      detail: { D, eps: (o && o.eps) || null },
    });
  }
  const layernorm = (x, o) => norm('layernorm', x, o);   // γ y β: 2D
  const rmsnorm = (x, o) => norm('rmsnorm', x, o);       // solo γ: D

  function elementwise(prim, x, cost, o) {
    return result(prim, [x], plain(x), { other: elems(x) * cost, detail: Object.assign({}, o || {}) });
  }
  const gelu = (x) => elementwise('gelu', x, OTHER.gelu);
  const softmax = (x) => elementwise('softmax', x, OTHER.softmax);
  // scale: multiplica por un escalar (1/√d_h). o.causal: además aplica la máscara causal.
  const scale = (x, o) => elementwise('scale', x, OTHER.scale, o);

  function add(a, b, prim) {
    if (shapeStr(a) !== shapeStr(b)) throw new Error('Suma con formas distintas: ' + shapeStr(a) + ' y ' + shapeStr(b) + '.');
    return result(prim || 'add', [a, b], plain(a), { other: elems(a) * OTHER.add });
  }
  const residual_add = (a, b) => add(a, b, 'residual_add');

  // embedding_lookup: ids (N) → N×D. o = {V, D, Vsym='V', Dsym='D'}
  function embedding_lookup(ids, o) {
    const N = ids.num[0], Ns = ids.sym[0];
    const out = shape([Ns, o.Dsym || 'D'], [N, o.D], o.mod || ids.mod || 'txt', 'seq');
    return result('embedding_lookup', [ids], out, {
      paramTerms: [[o.V, o.D]], paramTex: texProd([o.Vsym || 'V', o.Dsym || 'D']),
      detail: { V: o.V, D: o.D },
    });
  }

  // pos_embed_learned: la tabla aprendida rows×D (sin entrada de datos). o = {rows, rowsSym, D, Dsym, mod}
  function pos_embed_learned(o) {
    const out = shape([o.rowsSym, o.Dsym || 'D'], [o.rows, o.D], o.mod, 'seq');
    return result('pos_embed_learned', [], out, {
      paramTerms: [[o.rows, o.D]], paramTex: texProd([o.rowsSym, o.Dsym || 'D']),
      detail: { rows: o.rows, D: o.D, interpolatedFrom: o.interpolatedFrom || null },
    });
  }

  // cls_token: antepone un vector aprendido: N×D → (N+1)×D.
  function cls_token(x, o) {
    const [N, D] = x.num, [Ns, Ds] = x.sym;
    const outSym = (o && o.outSym) || (Ns + '+1');
    const out = shape([outSym, Ds], [N + 1, D], x.mod, 'seq');
    return result('cls_token', [x], out, { paramTerms: [[D]], paramTex: symTexFactor(Ds), detail: { D } });
  }

  // concat_tokens: concatena a lo largo de los tokens. o.sym = símbolo del largo resultante.
  function concat_tokens(a, b, o) {
    if (a.num[1] !== b.num[1]) throw new Error('concat_tokens: anchos distintos (' + a.num[1] + ' y ' + b.num[1] + ').');
    const sym = (o && o.sym) || (a.sym[0] + '+' + b.sym[0]);
    const out = shape([sym, a.sym[1]], [a.num[0] + b.num[0], a.num[1]], (o && o.mod) || a.mod, 'seq');
    return result('concat_tokens', [a, b], out, {});
  }

  // flatten: rejilla h×w×C → secuencia (h·w)×C. o.sym = [símbolo de tokens, símbolo de canales]
  function flatten(x, o) {
    const [h, w, c] = x.num;
    const sym = (o && o.sym) || [x.sym[0] + '·' + x.sym[1], x.sym[2]];
    return result('flatten', [x], shape(sym, [h * w, c], x.mod, 'seq'), {});
  }

  // Las primitivas de atención aceptan dimensiones delanteras opcionales (ventanas de Swin: nW×…):
  // split_heads nW×N×3D → 3 × [nW×h×N×d_h]; con entrada 2-D el resultado es el de siempre.
  // split_heads: N×(parts·D) → parts × [h×N×d_h]. o = {h, parts=1, hSym='h', dhSym='d_h'}
  function split_heads(x, o) {
    const parts = o.parts || 1, h = o.h;
    const nd = x.num.length;
    const lead = x.num.slice(0, nd - 2), leadSym = x.sym.slice(0, nd - 2);
    const N = x.num[nd - 2], W = x.num[nd - 1], Ns = x.sym[nd - 2];
    if (W % parts !== 0) throw new Error('split_heads: ' + W + ' no es divisible en ' + parts + ' partes.');
    const D = W / parts;
    if (D % h !== 0) throw new Error('split_heads: D = ' + D + ' no es divisible por h = ' + h + '.');
    const dh = D / h;
    const mk = () => shape(leadSym.concat([o.hSym || 'h', Ns, o.dhSym || 'd_h']), lead.concat([h, N, dh]), x.mod, lead.length ? 'winheads' : 'heads');
    const outs = Array.from({ length: parts }, mk);
    return result('split_heads', [x], parts === 1 ? outs[0] : outs, { detail: { h, dh, parts } });
  }

  // merge_heads: h×N×d_h → N×D (concatenar cabezas). Con ventanas: nW×h×N×d_h → nW×N×D.
  function merge_heads(z, o) {
    const nd = z.num.length;
    const lead = z.num.slice(0, nd - 3), leadSym = z.sym.slice(0, nd - 3);
    const h = z.num[nd - 3], N = z.num[nd - 2], dh = z.num[nd - 1];
    return result('merge_heads', [z], shape(leadSym.concat([z.sym[nd - 2], (o && o.Dsym) || 'D']), lead.concat([N, h * dh]), z.mod, lead.length ? 'windows' : 'seq'), { detail: { h, dh } });
  }

  // attention_scores: Q (h×Nq×d_h) · Kᵀ (h×d_h×Nk) → h×Nq×Nk. MACs h·Nq·Nk·d_h (= Nq·Nk·D).
  // Con ventanas: nW×h×M²×d_h → nW×h×M²×M², MACs nW·h·M²·M²·d_h (= H·W·M²·C).
  function attention_scores(q, k) {
    const nd = q.num.length;
    const lead = q.num.slice(0, nd - 3), leadSym = q.sym.slice(0, nd - 3);
    const [h, Nq, dh] = q.num.slice(nd - 3), Nk = k.num[nd - 2];
    // Fase 6 (GQA): K puede tener G cabezas con h divisible por G; cada cabeza de K la usan h/G cabezas de Q.
    const hk = k.num[nd - 3];
    if (k.num.length !== nd || !(hk > 0 && h % hk === 0) || k.num[nd - 1] !== dh || lead.some((v, i) => k.num[i] !== v)) throw new Error('attention_scores: Q y K con cabezas o d_h distintos.');
    const qs = q.sym.slice(nd - 3);
    const out = shape(leadSym.concat([qs[0], qs[1], k.sym[nd - 2]]), lead.concat([h, Nq, Nk]), q.mod, lead.length ? 'winheads' : 'heads');
    return result('attention_scores', [q, k], out, {
      macTerms: [lead.concat([h, Nq, Nk, dh])], macTex: texProd(leadSym.concat([qs[0], qs[1], k.sym[nd - 2], qs[2]])),
      detail: Object.assign({ h, Nq, Nk, dh, note: 'h·N·N·d_h = N²·D' }, lead.length ? { windows: prod(lead) } : {},
        hk !== h ? { kvHeads: hk, groups: h / hk, note: 'GQA: cada cabeza de K la comparten h/G cabezas de Q; MACs h·N_q·N_k·d_h, como MHA' } : {}),
    });
  }

  // attention_weighted_sum: A (h×Nq×Nk) · V (h×Nk×d_h) → h×Nq×d_h.
  function attention_weighted_sum(a, v) {
    const nd = a.num.length;
    const lead = a.num.slice(0, nd - 3), leadSym = a.sym.slice(0, nd - 3);
    const [h, Nq, Nk] = a.num.slice(nd - 3), dh = v.num[nd - 1];
    const hv = v.num[nd - 3];   // fase 6 (GQA): V con G cabezas, h divisible por G
    if (v.num.length !== nd || !(hv > 0 && h % hv === 0) || v.num[nd - 2] !== Nk) throw new Error('attention_weighted_sum: A y V incompatibles.');
    const as = a.sym.slice(nd - 3);
    const out = shape(leadSym.concat([as[0], as[1], v.sym[nd - 1]]), lead.concat([h, Nq, dh]), a.mod, lead.length ? 'winheads' : 'heads');
    return result('attention_weighted_sum', [a, v], out, {
      macTerms: [lead.concat([h, Nq, Nk, dh])], macTex: texProd(leadSym.concat([as[0], as[1], as[2], v.sym[nd - 1]])),
      detail: Object.assign({ h, Nq, Nk, dh }, hv !== h ? { kvHeads: hv, groups: h / hv } : {}),
    });
  }

  // pool_cls: (N+1)×D → D (fila 0).
  // o.sym (opcional): símbolo de la salida cuando el vector cambia de nombre sin cambiar de tamaño (ANN: q de d = D dimensiones).
  function pool_cls(x, o) {
    return result('pool_cls', [x], shape([(o && o.sym) || x.sym[1]], [x.num[1]], x.mod, 'vec'), {});
  }

  // classifier_head: D → K (lineal sobre un vector).
  function classifier_head(x, o) {
    const r = linear(x, { dout: o.K, doutSym: o.Ksym || 'K', bias: o.bias !== false, mod: x.mod });
    r.prim = 'classifier_head';
    return r;
  }

  // ---- Fase 2 (Swin, ResNet, CLIP): primitivas elementales ------------------------------
  // batchnorm2d: γ y β por canal (2C parámetros). Media y varianza móviles (y el contador) son buffers.
  function batchnorm2d(x) {
    const C = x.num[x.num.length - 1], Cs = x.sym[x.sym.length - 1];
    return result('batchnorm2d', [x], plain(x), {
      paramTerms: [[2, C]], paramTex: texScale(2, Cs), other: elems(x) * OTHER.batchnorm,
      detail: { C, buffers: 2 * C + 1, note: 'running_mean y running_var (2C) + num_batches_tracked: buffers, no parámetros' },
    });
  }
  const relu = (x) => elementwise('relu', x, OTHER.relu);

  // maxpool2d: ventana k×k, stride s, padding p; redondeo hacia abajo (PyTorch). o = {k, s=k, p=0, outSym}
  function maxpool2d(x, o) {
    const [H, W, C] = x.num, k = o.k, s = o.s || o.k, p = o.p || 0;
    const Ho = Math.floor((H + 2 * p - k) / s) + 1, Wo = Math.floor((W + 2 * p - k) / s) + 1;
    const os = o.outSym || [String(Ho), String(Wo)];
    return result('maxpool2d', [x], shape([os[0], os[1], x.sym[2]], [Ho, Wo, C], x.mod, 'grid'), {
      other: Ho * Wo * C * k * k, detail: { k, s, p, Ho, Wo },
    });
  }

  // global_avg_pool: H×W×C → C (promedio espacial; ≈ 1 suma por elemento).
  function global_avg_pool(x) {
    const [H, W, C] = x.num;
    return result('global_avg_pool', [x], shape([x.sym[2]], [C], x.mod, 'vec'), { other: H * W * C, detail: { H, W, C } });
  }

  // cyclic_shift (Swin): torch.roll de la rejilla H×W×C por −⌊M/2⌋ en filas y columnas (o +⌊M/2⌋ si inverse).
  // Mueve tokens, no calcula: 0 parámetros, 0 MACs.
  function cyclic_shift(x, o) {
    return result('cyclic_shift', [x], plain(x), { detail: { shift: o.s, inverse: !!o.inverse } });
  }

  // window_partition (Swin): H×W×C → nW×M²×C, nW = (H/M)·(W/M) ventanas de M×M tokens.
  // o = {M, nWSym='nW', tokSym='M²'}
  function window_partition(x, o) {
    const [H, W, C] = x.num, M = o.M;
    if (H % M !== 0 || W % M !== 0) throw new Error('window_partition: la rejilla ' + H + '×' + W + ' no es divisible por la ventana M = ' + M + '.');
    const nW = (H / M) * (W / M);
    return result('window_partition', [x], shape([o.nWSym || 'nW', o.tokSym || 'M²', x.sym[2]], [nW, M * M, C], x.mod, 'windows'), {
      detail: { M, nW, H, W },
    });
  }

  // window_reverse (Swin): nW×M²×C → H×W×C (inversa de window_partition). o = {H, W, M, outSym:[hs, ws]}
  function window_reverse(x, o) {
    const [nW, MM, C] = x.num;
    if (nW * MM !== o.H * o.W) throw new Error('window_reverse: ' + nW + '×' + MM + ' tokens no llenan una rejilla ' + o.H + '×' + o.W + '.');
    return result('window_reverse', [x], shape([o.outSym[0], o.outSym[1], x.sym[2]], [o.H, o.W, C], x.mod, 'grid'), { detail: { M: o.M, nW } });
  }

  // rel_pos_bias (Swin): scores + B, con B tomado de una tabla aprendida (2M−1)²×h (parámetro) mediante
  // un índice de posición relativa M²×M² (buffer). Suma elementwise.
  function rel_pos_bias(x, o) {
    const M = o.M, h = o.h, Ms = o.Msym || 'M', hs = o.hSym || 'h';
    const t = '(2' + Ms + '-1)^2';
    return result('rel_pos_bias', [x], plain(x), {
      paramTerms: [[2 * M - 1, 2 * M - 1, h]], paramTex: t + '\\cdot ' + symTexFactor(hs),
      other: elems(x) * OTHER.add, detail: { M, h, table: [(2 * M - 1) * (2 * M - 1), h], index: [M * M, M * M] },
    });
  }

  // attn_mask (Swin, SW-MSA): suma una máscara fija nW×M²×M² (0 / −100) que impide atender entre
  // regiones que el desplazamiento cíclico juntó en la misma ventana. Buffer: 0 parámetros.
  function attn_mask(x) {
    return result('attn_mask', [x], plain(x), { other: elems(x) * OTHER.mask, detail: { note: 'máscara = buffer (no parámetro)' } });
  }

  // causal_mask: pone −∞ sobre el triángulo superior de los scores (texto de CLIP, decoders).
  // No cambia parámetros ni MACs: una implementación ingenua calcula igual los N² scores.
  function causal_mask(x) {
    const N = x.num[x.num.length - 1], rows = x.num[x.num.length - 2];
    const heads = elems(x) / (N * rows);
    return result('causal_mask', [x], plain(x), {
      other: elems(x) * OTHER.mask,
      detail: { used: heads * rows * (rows + 1) / 2, masked: heads * rows * (rows - 1) / 2 },
    });
  }

  // patch_concat (Swin, patch merging): concatena los 2×2 vecinos: H×W×C → H/2×W/2×4C. o.outSym = [hs, ws, cs]
  function patch_concat(x, o) {
    const [H, W, C] = x.num;
    if (H % 2 !== 0 || W % 2 !== 0) throw new Error('patch_concat: la rejilla ' + H + '×' + W + ' no es par.');
    const os = (o && o.outSym) || [x.sym[0] + '/2', x.sym[1] + '/2', '4' + x.sym[2]];
    return result('patch_concat', [x], shape(os, [H / 2, W / 2, 4 * C], x.mod, 'grid'), { detail: { H, W, C } });
  }

  // pick_token: toma una fila de una secuencia T×D → D (CLIP texto: el token EOT). o.index = descripción
  function pick_token(x, o) {
    return result('pick_token', [x], shape([x.sym[x.sym.length - 1]], [x.num[x.num.length - 1]], x.mod, 'vec'), { detail: { index: (o && o.index) || null } });
  }

  // l2_normalize: x / ‖x‖₂ por fila (≈ 3 ops por elemento). Sin parámetros.
  function l2_normalize(x) {
    return result('l2_normalize', [x], plain(x), { other: elems(x) * OTHER.l2norm });
  }

  // stack_batch: apila B vectores de una muestra: E → B×E (el resto del grafo es por muestra).
  function stack_batch(x, o) {
    const out = shape([o.Bsym || 'B', x.sym[0]], [o.B, x.num[0]], x.mod, 'seq');
    return result('stack_batch', [x], out, { detail: { B: o.B } });
  }

  // similarity_logits (CLIP): I (B×E) · Tᵀ (E×B) → B×B. MACs B·B·E.
  function similarity_logits(a, b) {
    const [B1, E] = a.num, [B2, E2] = b.num;
    if (E !== E2) throw new Error('similarity_logits: dimensiones de embedding distintas (' + E + ' y ' + E2 + ').');
    const out = shape([a.sym[0], b.sym[0]], [B1, B2], null, 'mat');
    return result('similarity_logits', [a, b], out, {
      macTerms: [[B1, B2, E]], macTex: texProd([a.sym[0], b.sym[0], a.sym[1]]), detail: { B: B1, E },
    });
  }

  // logit_scale (CLIP): multiplica por e^t, con t un escalar aprendido (1 parámetro; init 1/0.07, tope 100).
  function logit_scale(x) {
    return result('logit_scale', [x], plain(x), { paramTerms: [[1]], paramTex: '1', other: elems(x) * OTHER.scale, detail: { init: 1 / 0.07, max: 100 } });
  }

  // contrastive_loss (CLIP, InfoNCE simétrica): ½·[CE por filas (imagen→texto) + CE por columnas
  // (texto→imagen)], etiquetas = la diagonal. B×B → escalar. Solo "otros": 2 softmax de B² + 2B.
  function contrastive_loss(x) {
    const B = x.num[0];
    return result('contrastive_loss', [x], shape(['1'], [1], null, 'vec'), {
      other: 2 * B * B * OTHER.softmax + 2 * B, detail: { B, negatives: B - 1 },
    });
  }

  // ---- Fase 3 (DETR, Deformable DETR): primitivas elementales -----------------------------
  // frozen_batchnorm2d (DETR y Deformable DETR, código oficial y HF): BatchNorm con γ, β, media y varianza
  // CONGELADAS, guardadas como buffers (4C): 0 parámetros. En inferencia es x·escala + desplazamiento.
  function frozen_batchnorm2d(x) {
    const C = x.num[x.num.length - 1];
    return result('frozen_batchnorm2d', [x], plain(x), {
      params: 0, other: elems(x) * OTHER.frozenbn,
      detail: { C, buffers: 4 * C, affine: 2 * C, note: 'γ, β, running_mean y running_var son buffers (4C): 0 parámetros; una BatchNorm normal tendría 2C parámetros' },
    });
  }

  // group_norm: γ y β por canal (2C parámetros); normaliza por grupos de canales. o.groups (32 en Deformable DETR).
  function group_norm(x, o) {
    const C = x.num[x.num.length - 1], Cs = x.sym[x.sym.length - 1];
    return result('group_norm', [x], plain(x), {
      paramTerms: [[2, C]], paramTex: texScale(2, Cs), other: elems(x) * OTHER.groupnorm, detail: { C, groups: (o && o.groups) || 32 },
    });
  }

  // sigmoid: elementwise (cajas normalizadas a [0, 1], puntos de referencia).
  const sigmoid = (x) => elementwise('sigmoid', x, OTHER.sigmoid);

  // sine_pos_encoding (DETR): codificación posicional 2-D FIJA (seno/coseno de y y de x, D/2 canales por
  // eje, temperatura 10,000, coordenadas normalizadas a [0, 2π]). Buffer calculado: 0 parámetros.
  // Sin entrada de datos (solo depende del tamaño de la rejilla). o = {H, W} o {levels:[[H,W],…]}, D,
  // rowsSym='N', Dsym='D'. Con varios niveles (Deformable DETR) devuelve los niveles concatenados.
  function sine_pos_encoding(o) {
    const lv = o.levels || [[o.H, o.W]];
    const rows = lv.reduce((s, hw) => s + hw[0] * hw[1], 0);
    const out = shape([o.rowsSym || 'N', o.Dsym || 'D'], [rows, o.D], o.mod || 'img', 'seq');
    return result('sine_pos_encoding', [], out, {
      other: rows * o.D * OTHER.sinpos,
      detail: { levels: lv.map((x) => x.slice()), D: o.D, perAxis: o.D / 2, temperature: o.temperature || 10000, normalize: o.normalize !== false, buffer: true,
        note: 'PE(y, x) = [sin/cos(y/T^{2i/(D/2)}), sin/cos(x/T^{2i/(D/2)})]: buffer, no parámetro' },
    });
  }

  // level_embed (Deformable DETR): tabla aprendida L×D, un vector por nivel de la pirámide (se suma a la PE).
  function level_embed(o) {
    const out = shape([o.Lsym || 'L', o.Dsym || 'D'], [o.L, o.D], o.mod || 'img', 'seq');
    return result('level_embed', [], out, { paramTerms: [[o.L, o.D]], paramTex: texProd([o.Lsym || 'L', o.Dsym || 'D']), detail: { L: o.L, D: o.D } });
  }

  // add_level_embed: PE (N×D, niveles concatenados) + el vector de su nivel (tabla L×D) → N×D.
  function add_level_embed(pos, table, o) {
    if (pos.num[1] !== table.num[1]) throw new Error('add_level_embed: anchos distintos.');
    return result('add_level_embed', [pos, table], plain(pos), { other: elems(pos) * OTHER.add, detail: { levels: (o && o.levels) || null } });
  }

  // flatten_levels (Deformable DETR): aplana y concatena las rejillas de cada nivel: Σ H_l·W_l × C.
  function flatten_levels(grids, o) {
    const C = grids[0].num[2];
    grids.forEach((g) => { if (g.num[2] !== C) throw new Error('flatten_levels: canales distintos entre niveles.'); });
    const rows = grids.reduce((s, g) => s + g.num[0] * g.num[1], 0);
    return result('flatten_levels', grids, shape((o && o.sym) || ['N', grids[0].sym[2]], [rows, C], grids[0].mod, 'seq'), {
      detail: { levels: grids.map((g) => [g.num[0], g.num[1]]), tokens: grids.map((g) => g.num[0] * g.num[1]) },
    });
  }

  // learned_queries (DETR): Q vectores aprendidos ("object queries" = query_pos, Q×D). o.split (Deformable
  // DETR): una tabla Q×2D que se parte en query_pos y tgt (dos salidas Q×D). Sin entrada de datos.
  function learned_queries(o) {
    const Qs = o.Qsym || 'Q', Ds = o.Dsym || 'D';
    const mk = () => shape([Qs, Ds], [o.Q, o.D], o.mod || 'qry', 'seq');
    const split = !!o.split;
    return result('learned_queries', [], split ? [mk(), mk()] : mk(), {
      paramTerms: [[o.Q, split ? 2 * o.D : o.D]], paramTex: split ? symTexFactor(Qs) + '\\cdot ' + texScale(2, Ds) : texProd([Qs, Ds]),
      detail: { Q: o.Q, D: o.D, split },
    });
  }

  // zeros_init (DETR): la entrada del decoder empieza en ceros (Q×D); la identidad de cada query está
  // en query_pos, que se suma en cada capa. 0 parámetros.
  function zeros_init(o) {
    return result('zeros_init', [], shape([o.rowsSym || 'Q', o.Dsym || 'D'], [o.rows, o.D], o.mod || 'qry', 'seq'), { detail: { rows: o.rows, D: o.D } });
  }

  // split_qkv_heads: Q (N_q×D), K y V (N_k×D) ya proyectados → h×N_q×d_h, h×N_k×d_h, h×N_k×d_h.
  // A diferencia de split_heads, Q y K/V pueden tener largos distintos (cross-attention).
  function split_qkv_heads(q, k, v, o) {
    const h = o.h;
    if (q.num[1] !== k.num[1] || k.num[1] !== v.num[1]) throw new Error('split_qkv_heads: Q, K y V con anchos distintos.');
    if (k.num[0] !== v.num[0]) throw new Error('split_qkv_heads: K y V deben tener el mismo largo.');
    if (q.num[1] % h !== 0) throw new Error('split_qkv_heads: D = ' + q.num[1] + ' no es divisible por h = ' + h + '.');
    const dh = q.num[1] / h;
    const mk = (x) => shape([o.hSym || 'h', x.sym[0], o.dhSym || 'd_h'], [h, x.num[0], dh], x.mod, 'heads');
    return result('split_qkv_heads', [q, k, v], [mk(q), mk(k), mk(v)], { detail: { h, dh, Nq: q.num[0], Nk: k.num[0] } });
  }

  // reference_points (Deformable DETR, encoder): el centro normalizado de cada token de cada nivel, repetido
  // para los L niveles (N×L×2). Calculado, sin parámetros ni MACs. o = {levels:[[H,W],…], rowsSym, Lsym}
  function reference_points(o) {
    const lv = o.levels, L = lv.length;
    const rows = lv.reduce((s, hw) => s + hw[0] * hw[1], 0);
    return result('reference_points', [], shape([o.rowsSym || 'N', o.Lsym || 'L', '2'], [rows, L, 2], o.mod || 'img', 'seq'), {
      other: rows * L * 2 * 2, detail: { levels: lv.map((x) => x.slice()) },
    });
  }

  // deform_sample (Deformable DETR): para cada query, cabeza, nivel y punto, interpola bilinealmente el
  // value (4 vecinos) en ref + Δ. value N_v×D, offsets N_q×(hLK·2) [, ref] → h×N_q×LK×d_h.
  // MACs 4·h·N_q·L·K·d_h (4 multiplica-acumula por canal y punto); las coordenadas y los 4 pesos
  // bilineales por punto van a "otros". FlopCounterMode NO lo cuenta (grid_sample): analítico.
  function deform_sample(value, offsets, ref, o) {
    const h = o.h, L = o.L, K = o.K, D = value.num[1], Nq = offsets.num[0];
    if (D % h !== 0) throw new Error('deform_sample: D no es divisible por h.');
    if (offsets.num[1] !== h * L * K * 2) throw new Error('deform_sample: los offsets deben tener h·L·K·2 = ' + (h * L * K * 2) + ' canales.');
    const dh = D / h, Qs = offsets.sym[0];
    const out = shape([o.hSym || 'h', Qs, 'LK', 'd_h'], [h, Nq, L * K, dh], offsets.mod, 'heads');
    return result('deform_sample', [value, offsets, ref], out, {
      macTerms: [[4, h, Nq, L, K, dh]], macTex: '4\\,' + texProd(['h', Qs]) + '\\cdot LK\\cdot d_h',
      other: h * Nq * L * K * 10,
      detail: { h, L, K, dh, Nq, Nv: value.num[0], samples: h * L * K, note: 'bilineal: 4 vecinos por punto; sin término N_q·N_v' },
    });
  }

  // deform_weighted_sum: Σ_{l,k} A·v(muestra) por cabeza y concatena: h×N_q×LK×d_h, pesos N_q×hLK → N_q×D.
  // MACs h·N_q·L·K·d_h (= N_q·LK·D), el análogo de A·V pero con LK = 16 claves en vez de N.
  function deform_weighted_sum(sampled, weights, o) {
    const [h, Nq, LK, dh] = sampled.num;
    if (weights.num[0] !== Nq || weights.num[1] !== h * LK) throw new Error('deform_weighted_sum: pesos incompatibles (' + weights.num.join('×') + ').');
    const out = shape([sampled.sym[1], (o && o.Dsym) || 'D'], [Nq, h * dh], sampled.mod, 'seq');
    return result('deform_weighted_sum', [sampled, weights], out, {
      macTerms: [[h, Nq, LK, dh]], macTex: texProd(['h', sampled.sym[1]]) + '\\cdot LK\\cdot d_h', detail: { h, Nq, LK, dh },
    });
  }

  // ref_offset (Deformable DETR): caja = MLP(hs) + inverse_sigmoid(ref) en (cx, cy) antes de la sigmoide.
  function ref_offset(x, ref) {
    return result('ref_offset', [x, ref], plain(x), { other: ref.num[0] * ref.num[1] * 5, detail: { note: 'Δ + σ⁻¹(ref) en cx, cy' } });
  }

  // hungarian_cost (DETR, solo entrenamiento): matriz de costos Q×G entre predicciones y objetos reales:
  // C = λ_cls·(−p̂(c)) + λ_L1·‖b − b̂‖₁ + λ_giou·(−GIoU). Sin parámetros ni MACs ("otros" ≈).
  // o = {wCls, wL1, wGiou, focal}
  function hungarian_cost(logits, boxes, gtLabels, gtBoxes, o) {
    const Q = logits.num[0], C = logits.num[1], G = gtBoxes.num[0];
    o = o || {};
    const out = shape([logits.sym[0], gtBoxes.sym[0]], [Q, G], null, 'seq');
    return result('hungarian_cost', [logits, boxes, gtLabels, gtBoxes], out, {
      other: Q * C * OTHER.softmax + Q * G * 45,
      detail: { Q, G, classes: C, entries: Q * G, wCls: o.wCls, wL1: o.wL1, wGiou: o.wGiou, focal: !!o.focal },
    });
  }

  // hungarian_match: asignación uno a uno de costo mínimo (scipy linear_sum_assignment): G pares
  // (query, objeto); las Q − G queries restantes → "no object" (∅). ≈ Q·G·min(Q, G) operaciones.
  function hungarian_match(cost) {
    const [Q, G] = cost.num;
    return result('hungarian_match', [cost], shape([cost.sym[1], '2'], [G, 2], null, 'seq'), {
      other: Q * G * Math.min(Q, G), detail: { Q, G, matched: G, unmatched: Q - G },
    });
  }

  // set_prediction_loss (DETR): CE de clase sobre las Q queries (∅ con peso eos) + L1 + GIoU sobre las G
  // emparejadas. o = {wCe, wL1, wGiou, eos, focal}. → escalar. Solo "otros".
  function set_prediction_loss(logits, boxes, assign, gtLabels, gtBoxes, o) {
    const Q = logits.num[0], C = logits.num[1], G = gtBoxes.num[0];
    o = o || {};
    return result('set_prediction_loss', [logits, boxes, assign, gtLabels, gtBoxes], shape(['1'], [1], null, 'vec'), {
      other: Q * C * OTHER.softmax + G * 45,
      detail: { Q, G, wCe: o.wCe, wL1: o.wL1, wGiou: o.wGiou, eos: o.eos, focal: !!o.focal },
    });
  }

  // ---- Fase 4 (Grounding DINO, YOLO-World, YOLOv8): primitivas elementales ----------------
  // silu: x·σ(x), la activación de los Conv de YOLOv8 (≈ 4 ops por elemento).
  const silu = (x) => elementwise('silu', x, OTHER.silu);

  // upsample_nearest (YOLO, PAN top-down): H×W×C → sH×sW×C copiando cada píxel. Sin parámetros ni MACs.
  // o = {s=2, outSym:[hs, ws]}
  function upsample_nearest(x, o) {
    o = o || {};
    const s = o.s || 2, [H, W, C] = x.num;
    const os = o.outSym || [x.sym[0] + '·' + s, x.sym[1] + '·' + s];
    return result('upsample_nearest', [x], shape([os[0], os[1], x.sym[2]], [H * s, W * s, C], x.mod, 'grid'), { detail: { s, mode: 'nearest' } });
  }

  // concat_channels: concatena rejillas del mismo H×W a lo largo de los canales. o.mult[i] = cuántas veces
  // cuenta la entrada i (C2f concatena las n salidas de sus bottlenecks; el grafo muestra una). o.sym = símbolo.
  function concat_channels(list, o) {
    o = o || {};
    const mult = o.mult || list.map(() => 1);
    const [H, W] = list[0].num;
    list.forEach((t) => { if (t.num.length !== 3 || t.num[0] !== H || t.num[1] !== W) throw new Error('concat_channels: rejillas de distinto tamaño (' + shapeStr(list[0]) + ' y ' + shapeStr(t) + ').'); });
    const C = list.reduce((s, t, i) => s + t.num[2] * mult[i], 0);
    return result('concat_channels', list, shape([list[0].sym[0], list[0].sym[1], o.sym || String(C)], [H, W, C], o.mod || list[0].mod, 'grid'), {
      detail: { parts: list.map((t, i) => t.num[2] * mult[i]), mult: mult.slice() },
    });
  }

  // split_channels (C2f: chunk(2, 1)): H×W×C → parts × [H×W×C/parts]. Vista: sin costo.
  function split_channels(x, o) {
    o = o || {};
    const parts = o.parts || 2, [H, W, C] = x.num;
    if (C % parts !== 0) throw new Error('split_channels: ' + C + ' canales no se dividen en ' + parts + ' partes.');
    const c = C / parts;
    const outs = Array.from({ length: parts }, () => shape([x.sym[0], x.sym[1], o.sym || String(c)], [H, W, c], x.mod, 'grid'));
    return result('split_channels', [x], outs, { detail: { parts, c } });
  }

  // adaptive_max_pool (YOLO-World, image-pooling attention): H×W×C → k×k×C (máximo por región). ≈ 1 op por elemento.
  function adaptive_max_pool(x, o) {
    const k = (o && o.k) || 3, [H, W, C] = x.num;
    return result('adaptive_max_pool', [x], shape([String(k), String(k), x.sym[2]], [k, k, C], x.mod, 'grid'), { other: H * W * C, detail: { k, H, W } });
  }

  // layer_scale (Grounding DINO, fusión): γ ⊙ x con γ ∈ ℝ^D aprendido (init 1e-4). D parámetros.
  function layer_scale(x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    return result('layer_scale', [x], plain(x), { paramTerms: [[D]], paramTex: symTexFactor(Ds), other: elems(x), detail: { D, init: (o && o.init) || 1e-4 } });
  }

  // subsentence_mask (Grounding DINO): a partir de los ids (T) y de los tokens especiales ([CLS], [SEP], '.', '?')
  // arma la máscara T×T de sub-oraciones (cada nombre de categoría solo se atiende a sí mismo) y los position
  // ids reiniciados en cada frase. Calculada, sin parámetros ni MACs. → [máscara T×T, position ids T]
  function subsentence_mask(ids, o) {
    const T = ids.num[0], Ts = ids.sym[0];
    return result('subsentence_mask', [ids], [shape([Ts, Ts], [T, T], 'txt', 'mat'), shape([Ts], [T], 'txt', 'vec')], {
      other: T * T, detail: { T, special: (o && o.special) || ['[CLS]', '[SEP]', '.', '?'] },
    });
  }

  // sine_pos_1d (Grounding DINO, texto del feature enhancer): PE seno/coseno de los position ids → T×D. Buffer.
  function sine_pos_1d(o) {
    const out = shape([o.rowsSym || 'T', o.Dsym || 'D'], [o.rows, o.D], o.mod || 'txt', 'seq');
    return result('sine_pos_1d', [], out, { other: o.rows * o.D * OTHER.sinpos, detail: { rows: o.rows, D: o.D, temperature: o.temperature || 10000, buffer: true } });
  }

  // box_sine_embed (Grounding DINO, decoder): PE seno/coseno de cada coordenada de la caja de referencia
  // (cx, cy, w, h), D/2 canales por coordenada: Q×4 → Q×2D. Sin parámetros (la proyección es un MLP aparte).
  function box_sine_embed(boxes, o) {
    const [Q, c] = boxes.num, D = o.D, per = D / 2;
    return result('box_sine_embed', [boxes], shape([boxes.sym[0], o.outSym || '2D'], [Q, c * per], boxes.mod, 'seq'), {
      other: Q * c * per * OTHER.sinpos, detail: { coords: c, perCoord: per, temperature: 10000 },
    });
  }

  // encoder_proposals (Grounding DINO / DINO two-stage): una caja ancla por token de la memoria (centro del
  // token, lado 0.05·2^l en el nivel l), en logit. Calculada: N×4, sin parámetros ni MACs.
  function encoder_proposals(o) {
    const lv = o.levels, rows = lv.reduce((s, hw) => s + hw[0] * hw[1], 0);
    return result('encoder_proposals', [], shape([o.rowsSym || 'N', '4'], [rows, 4], o.mod || 'img', 'seq'), { other: rows * 4 * 3, detail: { levels: lv.map((x) => x.slice()), wh: '0.05·2^l' } });
  }

  // contrastive_logits (Grounding DINO): logits por token de texto = q · tᵀ (sin parámetros):
  // N_q×D, T×D → N_q×T. MACs N_q·T·D. o.pad = largo máximo del texto (HF rellena hasta 256 con −∞).
  function contrastive_logits(q, t, o) {
    if (q.num[1] !== t.num[1]) throw new Error('contrastive_logits: anchos distintos (' + q.num[1] + ' y ' + t.num[1] + ').');
    const [Nq, D] = q.num, T = t.num[0];
    return result('contrastive_logits', [q, t], shape([q.sym[0], t.sym[0]], [Nq, T], q.mod, 'seq'), {
      macTerms: [[Nq, T, D]], macTex: texProd([q.sym[0], t.sym[0], q.sym[1]]), other: Nq * T * OTHER.mask,
      detail: { Nq, T, D, padTo: (o && o.pad) || null, note: 'sin pesos: la "clase" es un token del prompt' },
    });
  }

  // topk_select (Grounding DINO, query selection guiada por lenguaje): para cada token de imagen, su máxima
  // similitud con los T tokens de texto; se quedan los índices de los K mejores. N×T → K (índices).
  function topk_select(scores, o) {
    const [N, T] = scores.num, K = o.k;
    if (K > N) throw new Error('topk_select: K = ' + K + ' es mayor que los ' + N + ' candidatos.');
    return result('topk_select', [scores], shape([o.kSym || 'Q'], [K], scores.mod, 'vec'), { other: N * T + N, detail: { N, T, K, reduce: 'max sobre el texto' } });
  }

  // gather_rows: toma K filas (índices) de una tabla N×C → K×C. Sin costo.
  function gather_rows(x, idx, o) {
    const out = shape([idx.sym[0], (o && o.Csym) || x.sym[1]], [idx.num[0], x.num[1]], (o && o.mod) || x.mod, 'seq');
    return result('gather_rows', [x, idx], out, { detail: { from: x.num[0], rows: idx.num[0] } });
  }

  // transpose_scores (Grounding DINO, fusión): la misma matriz de scores vista desde el otro lado:
  // h×N_a×N_b → h×N_b×N_a. Sin costo (el t2i reutiliza los scores del i2t).
  function transpose_scores(x) {
    const nd = x.num.length;
    const num = x.num.slice(), sym = x.sym.slice();
    [num[nd - 1], num[nd - 2]] = [num[nd - 2], num[nd - 1]];
    [sym[nd - 1], sym[nd - 2]] = [sym[nd - 2], sym[nd - 1]];
    return result('transpose_scores', [x], shape(sym, num, x.mod, x.layout), { detail: { note: 'misma matriz, transpuesta' } });
  }

  // token_mask: suma una máscara aditiva a los scores (0 / −∞): sub-oraciones del texto o tokens de relleno.
  function token_mask(x, o) {
    return result('token_mask', [x], plain(x), { other: elems(x) * OTHER.mask, detail: { kind: (o && o.kind) || 'tokens' } });
  }

  // text_guided_scores (YOLO-World, max-sigmoid attention): por cabeza, el producto de cada píxel con cada
  // embedding de texto: H×W×E, V×E → n_h×(H·W)×V. MACs H·W·V·E (E = n_h·c_h).
  function text_guided_scores(x, guide, o) {
    const [H, W, E] = x.num, V = guide.num[0], nh = o.nh;
    if (guide.num[1] !== E) throw new Error('text_guided_scores: el texto tiene ' + guide.num[1] + ' canales y la imagen ' + E + '.');
    if (E % nh !== 0) throw new Error('text_guided_scores: ' + E + ' canales no se dividen en ' + nh + ' cabezas.');
    const hw = o.hwSym || (x.sym[0] + '·' + x.sym[1]);
    return result('text_guided_scores', [x, guide], shape([o.nhSym || String(nh), hw, guide.sym[0]], [nh, H * W, V], x.mod, 'heads'), {
      macTerms: [[H, W, V, E]], macTex: texProd([x.sym[0], x.sym[1], guide.sym[0], x.sym[2]]), detail: { nh, hc: E / nh, V },
    });
  }

  // max_over_text (YOLO-World): máximo sobre las V clases: n_h×HW×V → n_h×HW. ≈ 1 op por elemento.
  function max_over_text(x) {
    const nd = x.num.length;
    return result('max_over_text', [x], shape(x.sym.slice(0, nd - 1), x.num.slice(0, nd - 1), x.mod, 'seq'), { other: elems(x), detail: { over: x.num[nd - 1] } });
  }

  // maxsig_gate (YOLO-World): peso por cabeza y píxel = σ(max/√c_h + b_h). n_h parámetros (un sesgo por cabeza).
  function maxsig_gate(x, o) {
    const nh = o.nh;
    return result('maxsig_gate', [x], plain(x), { paramTerms: [[nh]], paramTex: 'n_h', other: elems(x) * (2 + OTHER.sigmoid), detail: { nh, hc: o.hc || null } });
  }

  // head_modulate (YOLO-World): multiplica los canales de cada cabeza por su peso: H×W×C, n_h×HW → H×W×C.
  function head_modulate(x, gate, o) {
    if (gate.num[1] !== x.num[0] * x.num[1]) throw new Error('head_modulate: el peso no tiene un valor por píxel.');
    return result('head_modulate', [x, gate], plain(x), { other: elems(x), detail: { nh: gate.num[0], hc: x.num[2] / gate.num[0], nhCheck: o && o.nh } });
  }

  // region_text_similarity (YOLO-World, cabeza contrastiva región-texto): coseno entre el embedding de
  // cada píxel (H×W×E) y cada embedding de texto (V×E), ambos normalizados L2: → (H·W)×V. MACs H·W·V·E.
  function region_text_similarity(x, vocab, o) {
    const [H, W, E] = x.num, V = vocab.num[0];
    if (vocab.num[1] !== E) throw new Error('region_text_similarity: el texto tiene ' + vocab.num[1] + ' canales y la imagen ' + E + '.');
    const hw = (o && o.hwSym) || (x.sym[0] + '·' + x.sym[1]);
    return result('region_text_similarity', [x, vocab], shape([hw, vocab.sym[0]], [H * W, V], x.mod, 'seq'), {
      macTerms: [[H, W, V, E]], macTex: texProd([x.sym[0], x.sym[1], vocab.sym[0], x.sym[2]]),
      other: (H * W + V) * E * OTHER.l2norm, detail: { E, V, normalized: true },
    });
  }

  // scale_bias (YOLO-World, ContrastiveHead): logits·e^s + b, con s (init log 1/0.07) y b (init −10) aprendidos: 2 parámetros.
  function scale_bias(x) {
    return result('scale_bias', [x], plain(x), { paramTerms: [[2]], paramTex: '2', other: 2 * elems(x), detail: { scaleInit: 'log(1/0.07)', biasInit: -10 } });
  }

  // dfl_decode (YOLOv8, Distribution Focal Loss): cada lado de la caja es una distribución sobre R = 16
  // bins; softmax y esperanza con una conv 1×1 de pesos FIJOS 0…R−1 (R parámetros, requires_grad = False).
  // Entradas: los mapas por nivel h×w×4R → A×4 (distancias l, t, r, b), A = Σ h·w anclas. MACs A·4·R.
  function dfl_decode(levels, o) {
    const R = (o && o.R) || 16;
    const A = levels.reduce((s, t) => s + t.num[0] * t.num[1], 0);
    levels.forEach((t) => { if (t.num[2] !== 4 * R) throw new Error('dfl_decode: cada nivel debe tener 4·R = ' + (4 * R) + ' canales.'); });
    return result('dfl_decode', levels, shape([(o && o.Asym) || 'A', '4'], [A, 4], levels[0].mod, 'seq'), {
      paramTerms: [[R]], paramTex: 'R', macTerms: [[A, 4, R]], macTex: 'A\\cdot 4\\cdot R', other: A * 4 * R * OTHER.softmax,
      detail: { R, A, frozen: true, note: 'pesos fijos 0…R−1: cuentan en parameters() pero no se entrenan' },
    });
  }

  // dist2bbox (YOLOv8): distancias (l, t, r, b) + centro del ancla, × stride → caja xyxy. A×4 → A×4 (≈ 3 ops).
  function dist2bbox(d) {
    return result('dist2bbox', [d], plain(d), { other: elems(d) * 3, detail: { note: 'anclas = centros de las celdas (sin cajas ancla)' } });
  }

  // merge_level_logits (YOLO): concatena los logits de los niveles (h·w filas cada uno) y aplica la sigmoide:
  // → A×K (o A×V). Entradas 2-D (filas×clases) o rejillas h×w×K.
  function merge_level_logits(levels, o) {
    const K = levels[0].num[levels[0].num.length - 1];
    const rows = levels.reduce((s, t) => s + elems(t) / t.num[t.num.length - 1], 0);
    return result('merge_level_logits', levels, shape([(o && o.Asym) || 'A', (o && o.Ksym) || levels[0].sym[levels[0].sym.length - 1]], [rows, K], levels[0].mod, 'seq'), {
      other: rows * K * OTHER.sigmoid, detail: { rows, K },
    });
  }

  // offline_text_encoder (YOLO-World, "prompt-then-detect"): el codificador de texto (CLIP) convierte los V
  // prompts del vocabulario en V embeddings UNA vez, fuera de la inferencia: en el grafo online cuesta 0
  // parámetros y 0 MACs; su costo real va en detail (params, macsPerPrompt, macs = V·macsPerPrompt).
  // prompts V×T_clip (ids) → V×E. o = {E, Esym, model, params, macsPerPrompt}
  function offline_text_encoder(prompts, o) {
    const V = prompts.num[0];
    return result('offline_text_encoder', [prompts], shape([prompts.sym[0], o.Esym || String(o.E)], [V, o.E], 'txt', 'seq'), {
      params: 0, macs: 0,
      detail: { offline: true, model: o.model || null, params: o.params || 0, macsPerPrompt: o.macsPerPrompt || 0, macs: V * (o.macsPerPrompt || 0), V, T: prompts.num[1],
        note: 'se ejecuta una vez por vocabulario (offline); su costo no entra en los totales online' },
    });
  }

  // ---- Fase 5 (SAM, SAM 2): primitivas elementales ----------------------------------------
  // conv_transpose2d (decoder de SAM, upscaling): kernel k, stride s = k (sin solapamiento): H×W×C_in →
  // (H·s)×(W·s)×C_out. Parámetros k²·C_in·C_out + C_out; MACs H·W·k²·C_in·C_out (cada píxel de ENTRADA
  // reparte C_in·C_out MACs en sus k² salidas; = H_o·W_o·C_in·C_out cuando k = s). o = {k=2, cout, coutSym, outSym, bias=true}
  function conv_transpose2d(x, o) {
    if (x.num.length !== 3) throw new Error('conv_transpose2d espera una entrada H×W×C.');
    const [H, W, C] = x.num, Cs = x.sym[2], k = o.k || 2, s = o.s || k, bias = o.bias !== false;
    const Ho = (H - 1) * s + k, Wo = (W - 1) * s + k;
    const cout = o.cout, coutSym = o.coutSym || String(cout);
    const os = o.outSym || [String(Ho), String(Wo)];
    return result('conv_transpose2d', [x], shape([os[0], os[1], coutSym], [Ho, Wo, cout], o.mod || x.mod, 'grid'), {
      paramTerms: [[k, k, C, cout]].concat(bias ? [[cout]] : []),
      paramTex: symTexFactor(String(k)) + '^2\\cdot ' + symTexFactor(Cs) + '\\cdot ' + symTexFactor(coutSym) + (bias ? ' + ' + symTexFactor(coutSym) : ''),
      macTerms: [[H, W, k, k, C, cout]],
      macTex: texProd([x.sym[0], x.sym[1]]) + '\\cdot ' + k + '^2\\cdot ' + symTexFactor(Cs) + '\\cdot ' + symTexFactor(coutSym),
      other: bias ? Ho * Wo * cout * OTHER.bias : 0,
      detail: { k, s, Ho, Wo, cin: C, cout, bias, transposed: true },
    });
  }

  // depthwise_conv2d (fuser del memory encoder de SAM 2, bloque ConvNeXt): un filtro k×k por canal (groups = C),
  // stride 1, padding p: H×W×C → H×W×C. Parámetros k²·C + C; MACs H·W·C·k² (sin el factor C_in de una conv densa).
  function depthwise_conv2d(x, o) {
    const [H, W, C] = x.num, Cs = x.sym[2], k = o.k, p = o.p !== undefined ? o.p : Math.floor(k / 2), bias = o.bias !== false;
    const Ho = H + 2 * p - k + 1, Wo = W + 2 * p - k + 1;
    if (Ho !== H || Wo !== W) throw new Error('depthwise_conv2d: el calculador solo modela padding "same" (p = ⌊k/2⌋).');
    return result('depthwise_conv2d', [x], plain(x), {
      paramTerms: [[k, k, C]].concat(bias ? [[C]] : []),
      paramTex: k + '^2\\cdot ' + symTexFactor(Cs) + (bias ? ' + ' + symTexFactor(Cs) : ''),
      macTerms: [[H, W, C, k, k]], macTex: texProd([x.sym[0], x.sym[1], Cs]) + '\\cdot ' + k + '^2',
      other: bias ? H * W * C * OTHER.bias : 0, detail: { k, p, groups: C, depthwise: true },
    });
  }

  // window_partition_pad (SAM y Hiera): como window_partition, pero RELLENA con ceros hasta un múltiplo de M
  // (F.pad de HF / oficial): H×W×C → nW×M²×C con nW = ⌈H/M⌉·⌈W/M⌉. Los tokens de relleno también pasan por
  // qkv, la atención y la proyección (cuestan MACs). o = {M, nWSym, tokSym}
  function window_partition_pad(x, o) {
    const [H, W, C] = x.num, M = o.M;
    const Hp = Math.ceil(H / M) * M, Wp = Math.ceil(W / M) * M, nW = (Hp / M) * (Wp / M);
    return result('window_partition_pad', [x], shape([o.nWSym || String(nW), o.tokSym || String(M * M), x.sym[2]], [nW, M * M, C], x.mod, 'windows'), {
      detail: { M, nW, H, W, Hp, Wp, padTokens: Hp * Wp - H * W, note: Hp * Wp > H * W ? 'relleno de ' + H + '×' + W + ' a ' + Hp + '×' + Wp : 'sin relleno' },
    });
  }

  // window_unpartition (SAM y Hiera): nW×M²×C → H×W×C, recortando el relleno. o = {H, W, M, outSym:[hs, ws]}
  function window_unpartition(x, o) {
    const [nW, MM, C] = x.num, M = o.M;
    if (MM !== M * M) throw new Error('window_unpartition: ventanas de ' + MM + ' tokens no son de ' + M + '×' + M + '.');
    if (nW !== Math.ceil(o.H / M) * Math.ceil(o.W / M)) throw new Error('window_unpartition: ' + nW + ' ventanas no cubren una rejilla ' + o.H + '×' + o.W + ' con M = ' + M + '.');
    const os = o.outSym || [String(o.H), String(o.W)];
    return result('window_unpartition', [x], shape([os[0], os[1], x.sym[2]], [o.H, o.W, C], x.mod, 'grid'), { detail: { M, nW, crop: nW * MM - o.H * o.W } });
  }

  // decomposed_rel_pos (SAM, de MViTv2): sesgo de posición relativa DESCOMPUESTO por eje. Tablas aprendidas
  // R_h, R_w de (2S−1)×d_h (S = lado de la ventana, o del mapa en un bloque global); bias[y,x,y',x'] =
  // q_{yx}·R_h[y−y'] + q_{yx}·R_w[x−x'] (dos einsum) y se suma a los scores. Parámetros 2·(2S−1)·d_h;
  // MACs 2·nW·h·S²·S·d_h (las dos einsum: cada query contra S filas y S columnas, no S²). Entradas: scores, Q.
  // o = {S, Ssym='S'}
  function decomposed_rel_pos(scores, q, o) {
    const nd = q.num.length, S = o.S, Ss = o.Ssym || String(S);
    const lead = q.num.slice(0, nd - 3), leadSym = q.sym.slice(0, nd - 3);
    const [h, N, dh] = q.num.slice(nd - 3);
    if (N !== S * S) throw new Error('decomposed_rel_pos: ' + N + ' queries no forman una rejilla ' + S + '×' + S + '.');
    const dhs = q.sym[nd - 1], hs = q.sym[nd - 3];
    return result('decomposed_rel_pos', [scores, q], plain(scores), {
      paramTerms: [[2, 2 * S - 1, dh]], paramTex: '2\\,(2' + symTexFactor(Ss) + '-1)\\,' + symTexFactor(dhs),
      macTerms: [[2].concat(lead, [h, N, S, dh])], macTex: '2\\,' + texProd(leadSym.concat([hs, q.sym[nd - 2], Ss, dhs])),
      other: elems(scores) * OTHER.add + 2 * prod(lead) * h * N * S,
      detail: { S, h, dh, tables: [[2 * S - 1, dh], [2 * S - 1, dh]], perTable: (2 * S - 1) * dh, windows: prod(lead) || 1,
        fullTableIfNotDecomposed: (2 * S - 1) * (2 * S - 1) * dh, note: 'q·R_h y q·R_w (einsum) y suma a los scores; sin la tabla 2-D (2S−1)² de Swin' },
    });
  }

  // query_pool (Hiera, primer bloque de los stages 2–4): max-pool 2×2 de las queries DENTRO de cada ventana:
  // nW×h×M²×d_h → nW×h×(M/2)²×d_h. Las keys y values no se reducen: QKᵀ es (M/2)²×M² por ventana. ≈ 1 op por elemento.
  function query_pool(q, o) {
    const nd = q.num.length, s = (o && o.s) || 2;
    const lead = q.num.slice(0, nd - 3), leadSym = q.sym.slice(0, nd - 3);
    const [h, N, dh] = q.num.slice(nd - 3), M = Math.round(Math.sqrt(N));
    if (M * M !== N || M % s !== 0) throw new Error('query_pool: ' + N + ' tokens por ventana no se reducen con stride ' + s + '.');
    const m = M / s;
    return result('query_pool', [q], shape(leadSym.concat([q.sym[nd - 3], (o && o.tokSym) || String(m * m), q.sym[nd - 1]]), lead.concat([h, m * m, dh]), q.mod, q.layout), {
      other: elems(q), detail: { s, M, m, kind: 'max' },
    });
  }

  // coord_grid (SAM, PE densa): centros normalizados de una rejilla h×w ((i+½)/h, (j+½)/w): h×w×2. Calculado.
  function coord_grid(o) {
    const os = o.sym || [String(o.H), String(o.W)];
    return result('coord_grid', [], shape([os[0], os[1], '2'], [o.H, o.W, 2], o.mod || 'img', 'grid'), { other: o.H * o.W * 4, detail: { H: o.H, W: o.W } });
  }

  // fourier_pe (SAM, PositionEmbeddingRandom): coordenadas en [0,1]² → 2·c − 1 → (·) G (matriz gaussiana 2×F
  // FIJA: buffer en el oficial) → [sin(2π·), cos(2π·)]: …×2 → …×2F. MACs filas·2·F (el producto por G);
  // sin/cos en "otros". o = {F=128, Dsym}
  function fourier_pe(x, o) {
    const F = (o && o.F) || 128, nd = x.num.length;
    if (x.num[nd - 1] !== 2) throw new Error('fourier_pe espera coordenadas (…×2).');
    const rows = elems(x) / 2, rowsSym = x.sym.slice(0, nd - 1);
    const out = shape(rowsSym.concat([(o && o.Dsym) || String(2 * F)]), x.num.slice(0, nd - 1).concat([2 * F]), x.mod, x.layout);
    return result('fourier_pe', [x], out, {
      macTerms: [x.num.slice(0, nd - 1).concat([2, F])], macTex: texProd(rowsSym) + '\\cdot 2\\cdot ' + F,
      other: rows * (4 + 2 * F * OTHER.sinpos), detail: { F, gaussian: [2, F], buffer: true, note: 'G ~ N(0, 1) fija (registrada como buffer en el código oficial)' },
    });
  }

  // append_pad_point (SAM, prompt encoder): sin caja, se añade un punto de relleno (etiqueta −1, "not a point"):
  // P×2 → (P+1)×2. Sin costo. o.sym = símbolo del largo resultante.
  function append_pad_point(x, o) {
    return result('append_pad_point', [x], shape([(o && o.sym) || (x.sym[0] + '+1'), x.sym[1]], [x.num[0] + 1, x.num[1]], x.mod, 'seq'), { detail: { padLabel: -1 } });
  }

  // type_embed (SAM, prompt encoder): suma a cada token disperso el embedding aprendido de su tipo (punto
  // positivo, negativo, esquina superior-izquierda / inferior-derecha de la caja, "not a point"). Tabla rows×D.
  // o = {rows, D, Dsym}
  function type_embed(x, o) {
    const Ds = o.Dsym || x.sym[x.sym.length - 1];
    return result('type_embed', [x], plain(x), {
      paramTerms: [[o.rows, o.D]], paramTex: o.rows + '\\cdot ' + symTexFactor(Ds), other: elems(x) * OTHER.add, detail: { rows: o.rows, D: o.D, kinds: o.kinds || null },
    });
  }

  // learned_tokens (decoder de SAM): tokens de salida aprendidos (IoU, máscaras, objeto en SAM 2): tabla rows×D.
  function learned_tokens(o) {
    const out = shape([o.rowsSym || String(o.rows), o.Dsym || 'D'], [o.rows, o.D], o.mod || 'qry', 'seq');
    return result('learned_tokens', [], out, { paramTerms: [[o.rows, o.D]], paramTex: texProd([o.rowsSym || String(o.rows), o.Dsym || 'D']), detail: { rows: o.rows, D: o.D, kinds: o.kinds || null } });
  }

  // broadcast_embed (SAM, "no-mask"): un vector aprendido (D parámetros) repetido en cada posición h×w×D.
  function broadcast_embed(o) {
    const os = o.sym || [String(o.H), String(o.W), o.Dsym || 'D'];
    return result('broadcast_embed', [], shape(os, [o.H, o.W, o.D], o.mod || 'img', 'grid'), { paramTerms: [[o.D]], paramTex: symTexFactor(os[2]), detail: { D: o.D, H: o.H, W: o.W } });
  }

  // idle_params: parámetros del modelo que ESTE forward no usa (p. ej. las convs del prompt de máscara cuando
  // no hay máscara de entrada). Cuentan en el total del modelo (= sum(p.numel())), 0 MACs, sin tensores.
  // o = {paramTerms | params, paramTex, what}
  function idle_params(o) {
    return result('idle_params', [], [], {
      paramTerms: o.paramTerms, params: o.paramTerms ? undefined : o.params, paramTex: o.paramTex,
      detail: { idle: true, what: o.what || null, note: 'parámetros sin uso en este forward (se usan con otro tipo de prompt o de frame)' },
    });
  }

  // rope_2d (SAM 2, memory attention): RoPE axial 2-D sobre Q o K (rotación por pares con cos/sin de la fila
  // y la columna del token). Sin parámetros ni MACs de matmul: ≈ 3 ops por elemento rotado. o.exclude = filas
  // finales sin rotar (los tokens de punteros de objeto en la cross-attention), o.repeat = la rejilla se repite
  // (K de varias memorias: rope_k_repeat).
  function rope_2d(x, o) {
    o = o || {};
    const nd = x.num.length, rows = x.num[nd - 2], ex = o.exclude || 0;
    const per = elems(x) / rows;
    return result('rope_2d', [x], plain(x), { other: (rows - ex) * per * OTHER.rope, detail: { rotated: rows - ex, excluded: ex, repeat: o.repeat || 1, theta: o.theta || 10000 } });
  }

  // take_rows: filas [start, start + count) de una secuencia (vista). o.vec: con count = 1 devuelve un vector.
  function take_rows(x, o) {
    const n = o.count, D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    if (o.start + n > x.num[0]) throw new Error('take_rows: filas fuera de rango.');
    const out = o.vec && n === 1 ? shape([Ds], [D], o.mod || x.mod, 'vec') : shape([o.sym || String(n), Ds], [n, D], o.mod || x.mod, 'seq');
    return result('take_rows', [x], out, { detail: { start: o.start, count: n } });
  }

  // grouped_linear (decoder de SAM, hipernetwork): una capa Linear DISTINTA por fila (cada token de máscara
  // tiene su MLP): R×D_in → R×D_out. Parámetros R·(D_in·D_out + D_out); MACs R·D_in·D_out.
  function grouped_linear(x, o) {
    const [R, din] = x.num, [Rs, dinSym] = x.sym, dout = o.dout, doutSym = o.doutSym || String(dout), bias = o.bias !== false;
    return result('grouped_linear', [x], shape([Rs, doutSym], [R, dout], o.mod || x.mod, 'seq'), {
      paramTerms: [[R, din, dout]].concat(bias ? [[R, dout]] : []),
      paramTex: symTexFactor(Rs) + '\\,(' + texProd([dinSym, doutSym]) + (bias ? ' + ' + symTexFactor(doutSym) : '') + ')',
      macTerms: [[R, din, dout]], macTex: texProd([Rs, dinSym, doutSym]),
      other: bias ? R * dout : 0, detail: { groups: R, din, dout, bias },
    });
  }

  // hyper_dot (decoder de SAM): máscara k = (salida de la hipernetwork k) · (embedding ampliado en cada píxel):
  // K×c, H×W×c → K×H×W. MACs K·c·H·W.
  function hyper_dot(hyper, up) {
    const [K, c] = hyper.num, [H, W, c2] = up.num;
    if (c !== c2) throw new Error('hyper_dot: canales distintos (' + c + ' y ' + c2 + ').');
    return result('hyper_dot', [hyper, up], shape([hyper.sym[0], up.sym[0], up.sym[1]], [K, H, W], 'img', 'grid'), {
      macTerms: [[K, c, H, W]], macTex: texProd([hyper.sym[0], hyper.sym[1], up.sym[0], up.sym[1]]), detail: { K, c, H, W },
    });
  }

  // mask_select (decoder de SAM): multimask → las 3 máscaras de ambigüedad (tokens 1–3) o la única (token 0).
  // K×H×W → n×H×W (o vector K → n). Vista. o = {start, count}
  function mask_select(x, o) {
    const n = o.count;
    const out = x.num.length === 1 ? shape([String(n)], [n], x.mod, 'vec') : shape([String(n)].concat(x.sym.slice(1)), [n].concat(x.num.slice(1)), x.mod, x.layout);
    return result('mask_select', [x], out, { detail: { start: o.start, count: n } });
  }

  // pick_mask (SAM 2): la máscara con mayor IoU predicho (argmax) como rejilla h×w×1. Entradas: máscaras n×h×w, IoU n.
  function pick_mask(masks, iou) {
    const [n, H, W] = masks.num;
    return result('pick_mask', [masks, iou], shape([masks.sym[1], masks.sym[2], '1'], [H, W, 1], masks.mod, 'grid'), { other: n, detail: { from: n, rule: 'argmax del IoU predicho' } });
  }

  // upsample_bilinear (SAM 2): interpolación bilineal de una rejilla a H×W (≈ 4 ops por salida). o = {H, W, outSym}
  function upsample_bilinear(x, o) {
    const os = o.outSym || [String(o.H), String(o.W)];
    return result('upsample_bilinear', [x], shape([os[0], os[1], x.sym[2]], [o.H, o.W, x.num[2]], x.mod, 'grid'), { other: o.H * o.W * x.num[2] * OTHER.bilinear, detail: { from: [x.num[0], x.num[1]], mode: 'bilinear' } });
  }

  // to_grid: secuencia (h·w)×C → rejilla h×w×C (inversa de flatten; vista). o = {H, W, sym:[hs, ws]}
  function to_grid(x, o) {
    if (x.num[0] !== o.H * o.W) throw new Error('to_grid: ' + x.num[0] + ' tokens no forman una rejilla ' + o.H + '×' + o.W + '.');
    const os = o.sym || [String(o.H), String(o.W)];
    return result('to_grid', [x], shape([os[0], os[1], x.sym[1]], [o.H, o.W, x.num[1]], x.mod, 'grid'), {});
  }

  // split_tokens (SAM 2, punteros de objeto): cada vector de D se parte en p tokens de D/p: R×D → (p·R)×(D/p). Vista.
  function split_tokens(x, o) {
    const [R, D] = x.num, p = o.parts;
    if (D % p !== 0) throw new Error('split_tokens: ' + D + ' no se divide en ' + p + ' partes.');
    return result('split_tokens', [x], shape([o.sym || (p + '·' + x.sym[0]), o.dSym || String(D / p)], [p * R, D / p], x.mod, 'seq'), { detail: { parts: p } });
  }

  // repeat_rows (SAM 2): repite cada fila k veces (repeat_interleave): R×c → (k·R)×c. Vista expandida.
  function repeat_rows(x, o) {
    const k = o.k;
    return result('repeat_rows', [x], shape([o.sym || (k + '·' + x.sym[0]), x.sym[1]], [k * x.num[0], x.num[1]], x.mod, 'seq'), { detail: { k } });
  }

  // add_temporal_embed (SAM 2, banco de memoria): a la PE espacial de cada memoria se le suma el vector aprendido de
  // su distancia temporal (tabla rows×D: una fila por posición del FIFO; los frames con prompt usan la última).
  function add_temporal_embed(pos, o) {
    return result('add_temporal_embed', [pos], plain(pos), {
      paramTerms: [[o.rows, o.D]], paramTex: (o.rowsTex || String(o.rows)) + '\\cdot ' + symTexFactor(o.Dsym || String(o.D)), other: elems(pos) * OTHER.add,
      detail: { rows: o.rows, D: o.D, frames: o.frames || null },
    });
  }

  // pos_embed_grid (SAM, ViT): posición absoluta aprendida como rejilla h×w×D (sin CLS): h·w·D parámetros.
  function pos_embed_grid(o) {
    const os = o.sym || [String(o.H), String(o.W), o.Dsym || 'D'];
    return result('pos_embed_grid', [], shape(os, [o.H, o.W, o.D], o.mod || 'img', 'grid'), {
      paramTerms: [[o.H, o.W, o.D]], paramTex: texProd(os), detail: { H: o.H, W: o.W, D: o.D },
    });
  }

  // window_pos_embed (Hiera de SAM 2, "windowed positional embedding"): una tabla de fondo b×b×C interpolada
  // (bicúbica) al mapa h×w + una tabla de ventana w0×w0×C repetida en mosaico. Parámetros C·(b² + w0²).
  function window_pos_embed(o) {
    const os = o.sym || [String(o.H), String(o.W), o.Csym || 'C'];
    return result('window_pos_embed', [], shape(os, [o.H, o.W, o.C], o.mod || 'img', 'grid'), {
      paramTerms: [[o.C, o.bkg, o.bkg], [o.C, o.win, o.win]], paramTex: symTexFactor(os[2]) + '\\,(' + o.bkg + '^2 + ' + o.win + '^2)',
      other: o.H * o.W * o.C * (OTHER.bicubic + OTHER.add), detail: { bkg: o.bkg, win: o.win, interp: 'bicubic', tile: o.H / o.win },
    });
  }

  // gate_embed (SAM 2, oclusión): x·λ + (1 − λ)·e, con λ = [objeto visible] y e un vector aprendido (D): si el
  // objeto no aparece, el puntero (o la memoria) se reemplaza por (o se le suma) un embedding de "no objeto".
  function gate_embed(x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    return result('gate_embed', [x], plain(x), { paramTerms: [[D]], paramTex: symTexFactor(Ds), other: 3 * elems(x), detail: { D, mode: (o && o.mode) || 'replace' } });
  }

  // ---- Fase 6 (LLM decoder: Llama, Mixtral): primitivas elementales -----------------------
  // rope (RoPE 1-D, Su et al. 2021): rota cada par de canales (2i, 2i+1) de cada cabeza por el ángulo m·θ_i, con
  // θ_i = base^(−2i/d_h) y m la posición del token. Sin parámetros (cos/sin son buffers) ni MACs de matmul: ≈ 3 ops
  // por elemento (q·cos + rot(q)·sin). La forma no cambia. o = {theta=10000, pos0=0 (posición del primer token; en
  // decode = ctx − 1), positions}
  function rope(x, o) {
    o = o || {};
    const nd = x.num.length, dh = x.num[nd - 1], rows = x.num[nd - 2];
    if (dh % 2 !== 0) throw new Error('rope: d_h = ' + dh + ' debe ser par (rota pares de canales).');
    return result('rope', [x], plain(x), {
      other: elems(x) * OTHER.rope,
      detail: { theta: o.theta || 10000, dh, pairs: dh / 2, positions: rows, pos0: o.pos0 || 0, scaling: o.scaling || null,
        note: 'q_m·k_n depende solo de m − n: la posición relativa entra en el producto punto, sin tabla aprendida' },
    });
  }

  // split_gqa_heads (GQA): Q (N×h·d_h) → h×N×d_h; K y V (S×G·d_h) → G×S×d_h. G cabezas KV, h divisible por G (cada
  // cabeza KV la comparten h/G cabezas de query). G = h es MHA; G = 1 es MQA. Reshape + transpose: sin costo.
  // o = {h, G, hSym='h', gSym='G', dhSym='d_h'}
  function split_gqa_heads(q, k, v, o) {
    const h = o.h, G = o.G;
    if (!(G > 0) || h % G !== 0) throw new Error('split_gqa_heads: h = ' + h + ' no es divisible por G = ' + G + ' cabezas KV.');
    if (q.num[1] % h !== 0) throw new Error('split_gqa_heads: el ancho de Q (' + q.num[1] + ') no es divisible por h = ' + h + '.');
    const dh = q.num[1] / h;
    if (k.num[1] !== G * dh || v.num[1] !== G * dh) throw new Error('split_gqa_heads: K y V deben tener G·d_h = ' + (G * dh) + ' canales.');
    if (k.num[0] !== v.num[0]) throw new Error('split_gqa_heads: K y V deben tener el mismo largo.');
    const mk = (x, n, ns) => shape([ns, x.sym[0], o.dhSym || 'd_h'], [n, x.num[0], dh], x.mod, 'heads');
    const hs = o.hSym || 'h', gs = o.gSym || 'G';
    return result('split_gqa_heads', [q, k, v], [mk(q, h, hs), mk(k, G, gs), mk(v, G, gs)], {
      detail: { h, G, dh, groups: h / G, kind: G === h ? 'MHA' : (G === 1 ? 'MQA' : 'GQA') },
    });
  }

  // mul: producto elementwise de dos tensores de la misma forma (SwiGLU: SiLU(gate) ⊙ up). 1 op por elemento.
  function mul(a, b) {
    if (shapeStr(a) !== shapeStr(b)) throw new Error('Producto elementwise con formas distintas: ' + shapeStr(a) + ' y ' + shapeStr(b) + '.');
    return result('mul', [a, b], plain(a), { other: elems(a) * OTHER.mul });
  }

  // lm_head: Linear D → V sin sesgo sobre cada fila (logits del vocabulario). o = {V, Vsym='V', tied=false}
  // Con embeddings atados (tied) la matriz es la del embedding: 0 parámetros propios (los MACs no cambian).
  function lm_head(x, o) {
    const r = linear(x, { dout: o.V, doutSym: o.Vsym || 'V', bias: false, mod: x.mod });
    r.prim = 'lm_head';
    if (o.tied) { r.params = 0; r.paramFormula = '0\\ (\\text{atada al embedding})'; r.paramArith = '0'; }
    r.detail = Object.assign({}, r.detail, { tied: !!o.tied });
    return r;
  }

  // sample_token: la última fila de los logits (T×V) → softmax con temperatura → siguiente id (greedy, top-k o top-p).
  // Sin parámetros ni MACs; ≈ softmax de V más una pasada de selección. → vector de 1.
  function sample_token(logits, o) {
    const V = logits.num[logits.num.length - 1];
    return result('sample_token', [logits], shape(['1'], [1], logits.mod, 'vec'), {
      other: V * (OTHER.softmax + 1), detail: { V, row: 'última', strategy: (o && o.strategy) || 'greedy / top-k / top-p' },
    });
  }

  // kv_append (KV cache, decode): concatena las filas guardadas (G×P×d_h) y la(s) nueva(s) (G×n×d_h) → G×(P+n)×d_h.
  // Mover datos: 0 parámetros, 0 MACs. o.sym = símbolo del largo resultante.
  function kv_append(past, nw, o) {
    const nd = past.num.length;
    if (nw.num.length !== nd || past.num[nd - 1] !== nw.num[nd - 1] || past.num[nd - 3] !== nw.num[nd - 3]) throw new Error('kv_append: la caché y la fila nueva no coinciden en cabezas o d_h.');
    const P = past.num[nd - 2], n = nw.num[nd - 2];
    const sym = past.sym.slice(); sym[nd - 2] = (o && o.sym) || (past.sym[nd - 2] + '+' + nw.sym[nd - 2]);
    const num = past.num.slice(); num[nd - 2] = P + n;
    return result('kv_append', [past, nw], shape(sym, num, past.mod, past.layout), { detail: { past: P, added: n, total: P + n } });
  }

  // moe_router (Mixtral): Linear D → E sin sesgo: un logit por experto y por token.
  function moe_router(x, o) {
    const r = linear(x, { dout: o.E, doutSym: o.Esym || 'E', bias: false, mod: x.mod });
    r.prim = 'moe_router';
    r.detail = Object.assign({}, r.detail, { E: o.E });
    return r;
  }

  // moe_topk (Mixtral): softmax sobre los E logits, se quedan los k mayores y sus pesos se renormalizan a suma 1
  // (equivale a softmax sobre los k logits elegidos). T×E → pesos T×k y ids T×k. Solo "otros".
  function moe_topk(logits, o) {
    const [T, E] = logits.num, k = o.k;
    if (!(k > 0 && k <= E)) throw new Error('moe_topk: k = ' + k + ' debe estar entre 1 y E = ' + E + '.');
    const mk = () => shape([logits.sym[0], String(k)], [T, k], logits.mod, 'seq');
    return result('moe_topk', [logits], [mk(), mk()], {
      other: T * E * (OTHER.softmax + OTHER.topk) + T * k, detail: { E, k, renorm: true, note: 'softmax → top-k → renormalizar (= softmax de los k logits elegidos)' },
    });
  }

  // expert_linear (MoE): las S filas enrutadas (S = k·T pares token-experto) pasan por el Linear de SU experto.
  // Parámetros = los E expertos (E·D_in·D_out; todos ocupan memoria); MACs = solo las filas enrutadas, S·D_in·D_out
  // (cada token paga k expertos, no E). o = {E, Esym='E', dout, doutSym}
  function expert_linear(x, o) {
    const [S, din] = x.num, [Ss, dinSym] = x.sym, dout = o.dout, doutSym = o.doutSym || String(dout);
    const Es = o.Esym || 'E';
    return result('expert_linear', [x], shape([Ss, doutSym], [S, dout], o.mod || x.mod, 'seq'), {
      paramTerms: [[o.E, din, dout]], paramTex: texProd([Es, dinSym, doutSym]),
      macTerms: [[S, din, dout]], macTex: texProd([Ss, dinSym, doutSym]),
      detail: { E: o.E, din, dout, rows: S, note: 'pesos de los E expertos; MACs solo de las filas enrutadas' },
    });
  }

  // moe_combine (MoE): suma ponderada por token de las k salidas de experto: (k·T)×D, pesos T×k → T×D.
  // Elementwise (k productos y sumas por canal): "otros", sin MACs de matmul.
  function moe_combine(y, w, o) {
    const [S, D] = y.num, [T, k] = w.num;
    if (S !== T * k) throw new Error('moe_combine: ' + S + ' filas no son k·T = ' + (k * T) + '.');
    return result('moe_combine', [y, w], shape([w.sym[0], y.sym[1]], [T, D], y.mod, 'seq'), {
      other: 2 * S * D, detail: { k, T, D, note: 'y = Σ_j p_j · Experto_j(x) sobre los k expertos elegidos' },
    });
  }


  // ---- Fase 7 (VLM: LLaVA, Qwen2-VL): primitivas elementales ------------------------------
  // repeat_frames (Qwen2-VL): una imagen se repite k veces en el eje temporal para llenar el parche temporal de k frames
  // (temporal_patch_size = 2): H×W×C → k×H×W×C. Copia de datos: sin parámetros ni MACs. o = {k, sym}
  function repeat_frames(x, o) {
    const k = o.k;
    return result('repeat_frames', [x], shape([o.sym || String(k)].concat(x.sym), [k].concat(x.num), x.mod, 'grid'), { detail: { k, note: 'la imagen se duplica para llenar el parche temporal' } });
  }

  // patch_embed_3d (Qwen2-VL): Conv3d con kernel = stride = k_t×P×P sobre F×H×W×C (sin sesgo en Qwen2-VL):
  // → (F/k_t)×(H/P)×(W/P)×D. Parámetros k_t·P²·C·D; MACs (F/k_t)(H/P)(W/P)·D·k_t·P²·C (= un Linear de k_t·P²·C → D por
  // parche 3-D). o = {kt, k, cout, coutSym, kSym='P', outSym:[ts, hs, ws], bias=false, squeeze (si F/k_t = 1, salida H/P×W/P×D)}
  function patch_embed_3d(x, o) {
    if (x.num.length !== 4) throw new Error('patch_embed_3d espera una entrada F×H×W×C.');
    const [F, H, W, C] = x.num, Cs = x.sym[3], kt = o.kt, k = o.k, bias = !!o.bias;
    if (F % kt !== 0) throw new Error('patch_embed_3d: F = ' + F + ' frames no es múltiplo del parche temporal k_t = ' + kt + '.');
    if (H % k !== 0 || W % k !== 0) throw new Error('patch_embed_3d: la imagen ' + H + '×' + W + ' no es divisible por el parche P = ' + k + '.');
    const To = F / kt, Ho = H / k, Wo = W / k, cout = o.cout, cs = o.coutSym || String(cout);
    const os = o.outSym || [String(To), String(Ho), String(Wo)];
    const sq = o.squeeze && To === 1;
    const out = sq ? shape([os[1], os[2], cs], [Ho, Wo, cout], o.mod || x.mod, 'grid') : shape([os[0], os[1], os[2], cs], [To, Ho, Wo, cout], o.mod || x.mod, 'grid');
    const kk = 'k_t\\,' + symTexFactor(o.kSym || 'P') + '^2\\,' + symTexFactor(Cs);
    return result('patch_embed_3d', [x], out, {
      paramTerms: [[kt, k, k, C, cout]].concat(bias ? [[cout]] : []),
      paramTex: kk + '\\,' + symTexFactor(cs) + (bias ? ' + ' + symTexFactor(cs) : ''),
      macTerms: [[To, Ho, Wo, cout, kt, k, k, C]],
      macTex: o.macTex || (texProd(sq ? [os[1], os[2], cs] : [os[0], os[1], os[2], cs]) + '\\cdot ' + kk),
      other: bias ? To * Ho * Wo * cout : 0,
      detail: { kt, k, To, Ho, Wo, cin: C, cout, bias, patchDim: kt * k * k * C, note: 'Conv3d k = s = k_t×P×P: un Linear de k_t·P²·C → D sobre cada parche 3-D' },
    });
  }

  // flatten_nd: rejilla (t×)h×w×C → secuencia (t·h·w)×C (todas las dimensiones delanteras; vista). o.sym = [tokens, canales]
  function flatten_nd(x, o) {
    const nd = x.num.length, c = x.num[nd - 1];
    const n = prod(x.num.slice(0, nd - 1));
    const sym = (o && o.sym) || [x.sym.slice(0, nd - 1).join('·'), x.sym[nd - 1]];
    return result('flatten', [x], shape(sym, [n, c], x.mod, 'seq'), { detail: { from: x.num.slice() } });
  }

  // segment_rows: secuencia (k·R)×C → k×R×C (vista): k segmentos independientes (Qwen2-VL: la atención del ViT no cruza
  // de un par de frames a otro; cu_seqlens). o = {k, sym:[ks, rs]}
  function segment_rows(x, o) {
    const [S, C] = x.num, k = o.k;
    if (S % k !== 0) throw new Error('segment_rows: ' + S + ' filas no se dividen en ' + k + ' segmentos.');
    const sy = o.sym || [String(k), String(S / k)];
    return result('segment_rows', [x], shape([sy[0], sy[1], x.sym[1]], [k, S / k, C], x.mod, 'windows'), { detail: { segments: k, rows: S / k } });
  }

  // group_tokens (merger de Qwen2-VL): cada k filas consecutivas (los 2×2 parches vecinos, que el procesador ya dejó
  // juntos) se concatenan en una: R×C → (R/k)×(k·C). Vista (reshape): sin parámetros ni MACs. o = {k, sym, dSym}
  function group_tokens(x, o) {
    const [R, C] = x.num, k = o.k;
    if (R % k !== 0) throw new Error('group_tokens: ' + R + ' filas no se agrupan de a ' + k + '.');
    return result('group_tokens', [x], shape([o.sym || (x.sym[0] + '/' + k), o.dSym || (k + x.sym[1])], [R / k, k * C], x.mod, 'seq'), { detail: { k, note: 'reshape: los k vecinos se concatenan en el canal' } });
  }

  // splice_tokens (VLM): los tokens visuales (N_img×D, de `copies` imágenes) reemplazan al marcador <image> en el prompt:
  // T×D (texto) y N_img×D → (N+T)×D con N = copies·N_img. Mover datos: sin parámetros ni MACs. o = {copies=1, sym, at}
  function splice_tokens(text, vis, o) {
    o = o || {};
    if (text.num[1] !== vis.num[1]) throw new Error('splice_tokens: anchos distintos (' + text.num[1] + ' y ' + vis.num[1] + '): falta el proyector.');
    const n = (o.copies || 1) * vis.num[0];
    return result('splice_tokens', [text, vis], shape([o.sym || ('N+' + text.sym[0]), text.sym[1]], [n + text.num[0], text.num[1]], 'txt', 'seq'), {
      detail: { visual: n, text: text.num[0], copies: o.copies || 1, at: o.at || 'posición del marcador <image>' },
    });
  }

  // mrope (Qwen2-VL, M-RoPE): RoPE con 3 ids de posición por token (t, h, w): las d_h/2 frecuencias se reparten en
  // secciones (mrope_section [16, 24, 24]) y cada sección rota con el id de su eje. Texto: t = h = w (= RoPE 1-D).
  // Sin parámetros ni MACs; mismo costo elementwise que RoPE. o = {theta, sections}
  function mrope(x, o) {
    o = o || {};
    const nd = x.num.length, dh = x.num[nd - 1], sec = o.sections || [];
    if (dh % 2 !== 0) throw new Error('mrope: d_h = ' + dh + ' debe ser par.');
    if (sec.length && sec.reduce((a, b) => a + b, 0) !== dh / 2) throw new Error('mrope: las secciones ' + sec.join('+') + ' no suman d_h/2 = ' + dh / 2 + '.');
    return result('mrope', [x], plain(x), {
      other: elems(x) * OTHER.rope,
      detail: { theta: o.theta || 10000, dh, pairs: dh / 2, sections: sec.slice(), axes: ['t', 'h', 'w'],
        note: 'cada sección de frecuencias rota con el id de su eje (t, h, w); en el texto los tres ids son iguales' },
    });
  }

  // mrope_ids (Qwen2-VL): los ids de posición (t, h, w) de cada token del prompt: 3×S enteros (buffer calculado de la
  // estructura del prompt y la rejilla de la imagen; sin parámetros ni MACs). o = {S, sym, span}
  function mrope_ids(o) {
    return result('mrope_ids', [], shape(['3', o.sym || String(o.S)], [3, o.S], 'txt', 'seq'), { detail: { span: o.span || null, note: o.note || '' } });
  }

  // ---- Fase 8 (difusión: Stable Diffusion, DiT): primitivas elementales ---------------------
  // GroupNorm (group_norm, fase 3), SiLU (silu, fase 4), upsample_nearest (fase 4), concat_channels (fase 4), split_channels,
  // flatten y to_grid ya existen; aquí solo lo nuevo.
  // timestep_embedding (DDPM / DiT): el paso t (un escalar) → vector sinusoidal de `dim` canales: [cos(t·ω_i); sin(t·ω_i)] con
  // ω_i = maxPeriod^(−i/(dim/2 − shift)). Buffer calculado: 0 parámetros, 0 MACs. o = {dim, sym, flip=true (cos primero),
  // shift=0 (diffusers: freq_shift / downscale_freq_shift), maxPeriod=10000, mod}
  // Con n valores de entrada (un vector de n: los 6 "time ids" de tamaño y recorte de SDXL) la salida es n·dim (cada valor
  // con su sinusoide, concatenadas), como add_time_proj de diffusers; con n = 1 es un vector de dim.
  function timestep_embedding(t, o) {
    const dim = o.dim, n = t.num.length === 1 ? t.num[0] : 1;
    if (dim % 2 !== 0) throw new Error('timestep_embedding: dim = ' + dim + ' debe ser par (mitad seno, mitad coseno).');
    return result('timestep_embedding', [t], shape([o.sym || String(n * dim)], [n * dim], o.mod || null, 'vec'), {
      other: n * dim * OTHER.sinpos,
      detail: { dim, values: n, flipSinToCos: o.flip !== false, shift: o.shift || 0, maxPeriod: o.maxPeriod || 10000, buffer: true,
        note: 'sin/cos de t·ω_i (como la PE del Transformer, pero sobre el paso t): sin parámetros' },
    });
  }

  // concat_features: concatena en la última dimensión (canales / features) tensores con las mismas dimensiones delanteras:
  // T×D₁, T×D₂ → T×(D₁ + D₂) (SDXL: los dos encoders de texto; el vector de tiempo + el texto agrupado). Vista: sin costo.
  // o = {sym}
  function concat_features(list, o) {
    const nd = list[0].num.length, lead = list[0].num.slice(0, nd - 1);
    list.forEach((t) => { if (t.num.length !== nd || t.num.slice(0, nd - 1).some((v, i) => v !== lead[i])) throw new Error('concat_features: formas incompatibles (' + list.map(shapeStr).join(', ') + ').'); });
    const W = list.reduce((s, t) => s + t.num[nd - 1], 0);
    return result('concat_features', list, shape(list[0].sym.slice(0, nd - 1).concat([(o && o.sym) || list.map((t) => t.sym[nd - 1]).join('+')]), lead.concat([W]), (o && o.mod) || list[0].mod, list[0].layout), {
      detail: { parts: list.map((t) => t.num[nd - 1]) },
    });
  }

  // label_embed (DiT): la clase y (un id) → vector D de una tabla aprendida de K + 1 filas (la fila extra es la clase
  // "nula" de classifier-free guidance: con probabilidad 0.1 se reemplaza la etiqueta por ella al entrenar). o = {K, D, Ksym,
  // Dsym, nullClass=true}
  function label_embed(y, o) {
    const rows = o.K + (o.nullClass === false ? 0 : 1), Ks = o.Ksym || 'K', Ds = o.Dsym || 'D';
    const rowsTex = o.nullClass === false ? symTexFactor(Ks) : '(' + symTexAtom(Ks) + '+1)';
    return result('label_embed', [y], shape([Ds], [o.D], o.mod || null, 'vec'), {
      paramTerms: [[rows, o.D]], paramTex: rowsTex + '\\cdot ' + symTexFactor(Ds),
      detail: { K: o.K, rows, D: o.D, nullClass: o.nullClass !== false, note: 'tabla de K + 1 filas: la última es la clase nula (∅) de CFG' },
    });
  }

  // add_broadcast: rejilla h×w×C + vector C (un valor por canal, el mismo en cada posición) → h×w×C. U-Net: la proyección
  // del embedding del tiempo se suma así a cada bloque ResNet. 1 op por elemento.
  function add_broadcast(x, v) {
    const C = x.num[x.num.length - 1];
    if (v.num.length !== 1 || v.num[0] !== C) throw new Error('add_broadcast: el vector (' + shapeStr(v) + ') no tiene los ' + C + ' canales de la rejilla.');
    return result('add_broadcast', [x, v], plain(x), { other: elems(x) * OTHER.add, detail: { C, note: 'el mismo vector en cada posición (broadcast)' } });
  }

  // downsample2d (U-Net y VAE): conv 3×3 con stride 2: H×W×C → H/2×W/2×C_out. pad 'sym' = padding 1 (U-Net de SD,
  // downsample_padding = 1); 'asym' = relleno (0, 1, 0, 1) a la derecha y abajo y padding 0 (encoder del VAE). Mismo
  // tamaño de salida y mismos MACs: (H/2)(W/2)·C_out·9·C. o = {cout, coutSym, pad='sym', outSym:[hs, ws], bias=true}
  function downsample2d(x, o) {
    if (x.num.length !== 3) throw new Error('downsample2d espera una entrada H×W×C.');
    const [H, W, C] = x.num, Cs = x.sym[2], bias = o.bias !== false;
    if (H % 2 !== 0 || W % 2 !== 0) throw new Error('downsample2d: la rejilla ' + H + '×' + W + ' no es par.');
    const Ho = H / 2, Wo = W / 2, cout = o.cout || C, cs = o.coutSym || (o.cout ? String(cout) : Cs);
    const os = o.outSym || [x.sym[0] + '/2', x.sym[1] + '/2'];
    return result('downsample2d', [x], shape([os[0], os[1], cs], [Ho, Wo, cout], o.mod || x.mod, 'grid'), {
      paramTerms: [[3, 3, C, cout]].concat(bias ? [[cout]] : []),
      paramTex: '3^2\\cdot ' + symTexFactor(Cs) + '\\cdot ' + symTexFactor(cs) + (bias ? ' + ' + symTexFactor(cs) : ''),
      macTerms: [[Ho, Wo, cout, 3, 3, C]], macTex: texProd([os[0], os[1], cs]) + '\\cdot 3^2\\cdot ' + symTexFactor(Cs),
      other: bias ? Ho * Wo * cout * OTHER.bias : 0,
      detail: { k: 3, s: 2, pad: o.pad || 'sym', Ho, Wo, cin: C, cout, bias,
        note: (o.pad === 'asym' ? 'relleno (0, 1, 0, 1) y padding 0' : 'padding 1') + ': conv 3×3 con stride 2 (la resolución se divide entre 2)' },
    });
  }

  // geglu (FFN de los bloques transformer de SD; Shazeer 2020): la proyección de entrada da 2F canales que se parten en dos
  // mitades: valor ⊙ GELU(compuerta) → N×F. La mitad de canales a la salida. Sin parámetros (los tiene el Linear de antes).
  function geglu(x, o) {
    const nd = x.num.length, W = x.num[nd - 1];
    if (W % 2 !== 0) throw new Error('geglu: ' + W + ' canales no se parten en dos mitades.');
    const F = W / 2, sym = x.sym.slice(0, nd - 1).concat([(o && o.outSym) || String(F)]);
    return result('geglu', [x], shape(sym, x.num.slice(0, nd - 1).concat([F]), x.mod, x.layout), {
      other: elems(x) / 2 * (OTHER.gelu + OTHER.mul),
      detail: { F, note: 'h, g = chunk(xW + b, 2): salida h ⊙ GELU(g) (diffusers GEGLU)' },
    });
  }

  // adaln_zero (DiT, adaLN-Zero): del vector de condición c (D) → SiLU → Linear D → k·D (con sesgo) → k vectores de D
  // (k = 6 en cada bloque: γ1, β1, α1, γ2, β2, α2 — en el orden de diffusers / el código oficial: shift, scale, gate de la
  // atención y del MLP; k = 2 en la capa final: β, γ). "Zero": el Linear se inicializa en ceros, así cada bloque empieza
  // como la identidad (α = 0). Parámetros D·kD + kD; MACs D·kD (una fila: c es un vector). o = {k, outSyms}
  function adaln_zero(c, o) {
    if (c.num.length !== 1) throw new Error('adaln_zero espera el vector de condición c (D).');
    const D = c.num[0], Ds = c.sym[0], k = o.k;
    const outs = Array.from({ length: k }, () => shape([Ds], [D], c.mod, 'vec'));
    return result('adaln_zero', [c], outs, {
      paramTerms: [[D, k, D], [k, D]], paramTex: symTexFactor(Ds) + '\\cdot ' + texScale(k, Ds) + ' + ' + texScale(k, Ds),
      macTerms: [[D, k, D]], macTex: symTexFactor(Ds) + '\\cdot ' + texScale(k, Ds),
      other: D * OTHER.silu + k * D * OTHER.bias,
      detail: { k, D, zeroInit: true, note: 'SiLU → Linear D → kD (inicializado en ceros) → k vectores' },
    });
  }

  // ada_modulate (DiT): x ⊙ (1 + γ) + β con γ (scale) y β (shift) vectores de D, iguales para todos los tokens. Entradas x,
  // β, γ. ≈ 3 ops por elemento. Sin parámetros (γ y β salen del adaLN).
  function ada_modulate(x, shift, scl) {
    const D = x.num[x.num.length - 1];
    [shift, scl].forEach((v) => { if (v.num.length !== 1 || v.num[0] !== D) throw new Error('ada_modulate: β y γ deben ser vectores de ' + D + '.'); });
    return result('ada_modulate', [x, shift, scl], plain(x), { other: 3 * elems(x), detail: { D, note: 'x·(1 + γ) + β (modulate de DiT)' } });
  }

  // ada_gate (DiT): α ⊙ x (α vector de D, el mismo para cada token) antes de la suma residual; con α = 0 (adaLN-Zero) la
  // rama no aporta nada al inicio. 1 op por elemento.
  function ada_gate(x, alpha) {
    const D = x.num[x.num.length - 1];
    if (alpha.num.length !== 1 || alpha.num[0] !== D) throw new Error('ada_gate: α debe ser un vector de ' + D + '.');
    return result('ada_gate', [x, alpha], plain(x), { other: elems(x), detail: { D, note: 'α ⊙ rama (α = 0 al inicio: el bloque empieza como la identidad)' } });
  }

  // sincos_pos_2d (DiT, como MAE): tabla FIJA N×D de senos y cosenos de la fila y la columna de cada parche (D/2 canales por
  // eje). Buffer calculado: 0 parámetros (el código oficial de DiT la guarda como nn.Parameter con requires_grad = False:
  // ver la nota del modelo). o = {gh, gw, D, rowsSym='N', Dsym='D'}
  function sincos_pos_2d(o) {
    const rows = o.gh * o.gw;
    return result('sincos_pos_2d', [], shape([o.rowsSym || 'N', o.Dsym || 'D'], [rows, o.D], o.mod || 'lat', 'seq'), {
      other: rows * o.D * OTHER.sinpos,
      detail: { grid: [o.gh, o.gw], D: o.D, perAxis: o.D / 2, buffer: true, note: 'sin/cos 2-D fijos (MAE): no se aprenden' },
    });
  }

  // unpatchify (DiT): N×(P²·C) → (h·P)×(w·P)×C: cada token vuelve a ser un parche P×P×C de la rejilla. Vista. o = {gh, gw, P,
  // outSym:[hs, ws, cs]}
  function unpatchify(x, o) {
    const [N, W] = x.num, P = o.P;
    if (N !== o.gh * o.gw) throw new Error('unpatchify: ' + N + ' tokens no forman una rejilla ' + o.gh + '×' + o.gw + '.');
    if (W % (P * P) !== 0) throw new Error('unpatchify: ' + W + ' canales no son P²·C con P = ' + P + '.');
    const C = W / (P * P), os = o.outSym || [String(o.gh * P), String(o.gw * P), String(C)];
    return result('unpatchify', [x], shape(os, [o.gh * P, o.gw * P, C], x.mod, 'grid'), { detail: { P, C, grid: [o.gh, o.gw] } });
  }

  // latent_sample (VAE, DiagonalGaussianDistribution): los 2c momentos (media y log-varianza) → z = μ + σ·ε, c canales.
  // ≈ 4 ops por elemento de salida (exp, ×, +). o = {sym, mode} (mode = 'sample' | 'mean')
  function latent_sample(m, o) {
    const nd = m.num.length, W = m.num[nd - 1];
    if (W % 2 !== 0) throw new Error('latent_sample: ' + W + ' canales no son media + log-varianza.');
    const c = W / 2, sym = m.sym.slice(0, nd - 1).concat([(o && o.sym) || String(c)]);
    const out = shape(sym, m.num.slice(0, nd - 1).concat([c]), (o && o.mod) || m.mod, m.layout);
    return result('latent_sample', [m], out, { other: elems(out) * 4, detail: { c, mode: (o && o.mode) || 'sample', note: 'μ, log σ² = chunk(momentos, 2); z = μ + σ·ε' } });
  }

  // latent_scale (SD): z·s al codificar (s = scaling_factor, 0.18215 en SD 1.x: deja los latentes con varianza ≈ 1) o z/s
  // antes del decoder (inverse). 1 op por elemento. o = {factor, inverse}
  function latent_scale(x, o) {
    return result('latent_scale', [x], plain(x), { other: elems(x) * OTHER.scale, detail: { factor: o.factor, inverse: !!o.inverse } });
  }

  // add_noise (entrenamiento): DDPM x_t = √ᾱ_t·x₀ + √(1 − ᾱ_t)·ε (kind 'ddpm'); flow matching / rectified flow
  // x_t = (1 − t)·x₀ + t·ε (kind 'flow'). Entradas x₀, ε, t. ≈ 3 ops por elemento. Sin parámetros.
  function add_noise(x0, eps, t, o) {
    if (shapeStr(x0) !== shapeStr(eps)) throw new Error('add_noise: x₀ y ε con formas distintas.');
    const kind = (o && o.kind) || 'ddpm';
    return result('add_noise', [x0, eps, t], plain(x0), {
      other: 3 * elems(x0),
      detail: { kind, formula: kind === 'flow' ? 'x_t = (1 − t)·x₀ + t·ε' : 'x_t = √ᾱ_t·x₀ + √(1 − ᾱ_t)·ε' },
    });
  }

  // flow_target (flow matching, rectified flow): la velocidad objetivo v = ε − x₀ (derivada de x_t respecto de t). 1 op por elemento.
  function flow_target(x0, eps) {
    if (shapeStr(x0) !== shapeStr(eps)) throw new Error('flow_target: x₀ y ε con formas distintas.');
    return result('flow_target', [x0, eps], plain(x0), { other: elems(x0), detail: { formula: 'v = ε − x₀' } });
  }

  // cfg_combine (classifier-free guidance): ε̂ = ε_u + w·(ε_c − ε_u) con las predicciones sin y con condición (las dos mitades
  // del lote duplicado). ≈ 3 ops por elemento. o = {w}
  function cfg_combine(eu, ec, o) {
    if (shapeStr(eu) !== shapeStr(ec)) throw new Error('cfg_combine: predicciones con formas distintas.');
    return result('cfg_combine', [eu, ec], plain(ec), { other: 3 * elems(ec), detail: { w: (o && o.w) || 7.5, formula: 'ε̂ = ε_u + w·(ε_c − ε_u)' } });
  }

  // scheduler_step (muestreo): un paso del sampler de x_t a x_{t−1} con la predicción del modelo. DDIM (η = 0):
  // x̂₀ = (x_t − √(1−ᾱ_t)·ε̂)/√ᾱ_t, x_{t−1} = √ᾱ_{t−1}·x̂₀ + √(1−ᾱ_{t−1})·ε̂; Euler (flow): x_{t−Δ} = x_t − Δt·v̂.
  // Elementwise (≈ 6 ops por elemento con DDIM, 2 con Euler). Sin parámetros. o = {kind='ddim', steps}
  function scheduler_step(x, pred, o) {
    if (shapeStr(x) !== shapeStr(pred)) throw new Error('scheduler_step: x_t y la predicción con formas distintas.');
    const kind = (o && o.kind) || 'ddim';
    return result('scheduler_step', [x, pred], plain(x), { other: (kind === 'euler' ? 2 : 6) * elems(x), detail: { kind, steps: (o && o.steps) || null } });
  }

  // mse_loss: ‖pred − objetivo‖² promediado → escalar (≈ 3 ops por elemento). o.target = descripción.
  function mse_loss(pred, target, o) {
    if (shapeStr(pred) !== shapeStr(target)) throw new Error('mse_loss: predicción y objetivo con formas distintas.');
    return result('mse_loss', [pred, target], shape(['1'], [1], null, 'vec'), { other: 3 * elems(pred), detail: { target: (o && o.target) || null } });
  }

  // ---- compuestas (para fórmulas, tablas y pruebas; los modelos usan las elementales en el grafo)
  function composite(prim, x, parts, out, o) {
    return {
      prim, inputs: [x], out,
      params: parts.reduce((s, p) => s + p.params, 0),
      macs: parts.reduce((s, p) => s + p.macs, 0),
      other: parts.reduce((s, p) => s + p.other, 0),
      paramFormula: o.paramTex, macFormula: o.macTex,
      paramArith: arithSum(parts.map((p) => p.params)),
      macArith: arithSum(parts.map((p) => p.macs)),
      shapeTex: shapeTex(x) + ' \\to ' + shapeTex(out),
      detail: Object.assign({ parts: parts.map((p) => ({ prim: p.prim, params: p.params, macs: p.macs, other: p.other })) }, o.detail || {}),
    };
  }

  // mhsa: qkv → split → scores → scale → softmax → ·V → merge → proj. o = {h, qkvBias, projBias, Dsym}
  function mhsa(x, o) {
    const D = x.num[1], Ds = (o && o.Dsym) || x.sym[1], Ns = x.sym[0];
    const qkv = linear(x, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false });
    const sp = split_heads(qkv.out, { h: o.h, parts: 3 });
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k);
    const sl = scale(sc.out);
    const sm = softmax(sl.out);
    const ws = attention_weighted_sum(sm.out, v);
    const mg = merge_heads(ws.out, { Dsym: Ds });
    const pj = linear(mg.out, { dout: D, doutSym: Ds, bias: o.projBias !== false });
    const nb = (o.qkvBias !== false ? 3 : 0) + (o.projBias !== false ? 1 : 0);
    const n = symTexFactor(Ns), d = symTexFactor(Ds);
    return composite('mhsa', x, [qkv, sp, sc, sl, sm, ws, mg, pj], pj.out, {
      paramTex: '4' + d + '^2' + (nb ? ' + ' + (nb === 1 ? '' : nb) + d : ''),
      macTex: '4\\,' + n + '\\,' + d + '^2 + 2\\,' + n + '^2\\,' + d,
      detail: { h: o.h, dh: D / o.h },
    });
  }

  // mlp: fc1 (D → D_mlp) → GELU → fc2 (D_mlp → D). o = {Dmlp, DmlpSym='D_mlp', bias=true}
  function mlp(x, o) {
    const D = x.num[1], Ds = x.sym[1], Ms = o.DmlpSym || 'D_mlp', bias = o.bias !== false;
    const fc1 = linear(x, { dout: o.Dmlp, doutSym: Ms, bias });
    const act = gelu(fc1.out);
    const fc2 = linear(act.out, { dout: D, doutSym: Ds, bias });
    const d = symTexFactor(Ds), m = symTexFactor(Ms), n = symTexFactor(x.sym[0]);
    return composite('mlp', x, [fc1, act, fc2], fc2.out, {
      paramTex: '2\\,' + d + '\\,' + m + (bias ? ' + ' + m + ' + ' + d : ''),
      macTex: '2\\,' + n + '\\,' + d + '\\,' + m,
    });
  }

  // transformer_block (pre-LN): x + MHSA(LN(x)); luego + MLP(LN(·)).
  function transformer_block(x, o) {
    const ln1 = layernorm(x);
    const at = mhsa(ln1.out, o);
    const r1 = residual_add(x, at.out);
    const ln2 = layernorm(r1.out);
    const ml = mlp(ln2.out, o);
    const r2 = residual_add(r1.out, ml.out);
    const d = symTexFactor(x.sym[1]), m = symTexFactor(o.DmlpSym || 'D_mlp'), n = symTexFactor(x.sym[0]);
    const r = composite('transformer_block', x, [ln1, at, r1, ln2, ml, r2], r2.out, {
      paramTex: '4' + d + '^2 + 2\\,' + d + '\\,' + m + ' + ' + m + ' + 9' + d,
      macTex: n + '\\,(4' + d + '^2 + 2\\,' + d + '\\,' + m + ') + 2\\,' + n + '^2\\,' + d,
      detail: { note: 'Con D_mlp = 4D y todos los sesgos: 12D² + 13D parámetros.' },
    });
    return r;
  }

  // ---- Fase 2: compuestas ---------------------------------------------------------------
  // conv_bn: conv (sin sesgo) → BatchNorm (→ ReLU). o = opciones de conv2d + {relu=true}. Redondeo floor.
  // o.frozenBN (fase 3, DETR): la BN es frozen_batchnorm2d (buffers): solo cuentan los pesos de la conv.
  function conv_bn(x, o) {
    const cv = conv2d(x, Object.assign({ floor: true, s: 1 }, o, { bias: false }));   // stride 1 por defecto (no el de patchify)
    const bn = o.frozenBN ? frozen_batchnorm2d(cv.out) : batchnorm2d(cv.out);
    const parts = [cv, bn];
    if (o.relu !== false) parts.push(relu(bn.out));
    return composite('conv_bn', x, parts, parts[parts.length - 1].out, {
      paramTex: o.frozenBN ? 'k^2\\,C_{in}\\,C_{out}' : 'k^2\\,C_{in}\\,C_{out} + 2C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}',
      detail: Object.assign({ k: o.k, s: o.s || 1, relu: o.relu !== false }, o.frozenBN ? { frozenBN: true } : {}),
    });
  }

  // bottleneck (ResNet-50, torchvision v1.5: el stride va en la 3×3):
  //   1×1 (C_in→w) → BN → ReLU → 3×3 s (w→w) → BN → ReLU → 1×1 (w→4w) → BN, + atajo, → ReLU.
  //   Atajo = identidad, o proyección 1×1 s (C_in→4w) + BN cuando cambian canales o resolución.
  // o = {width, cout=4·width, stride=1, project}
  // o.frozenBN (fase 3): todas sus BN congeladas (buffers), como el backbone de DETR.
  function bottleneck(x, o) {
    const w = o.width, cout = o.cout || 4 * w, s = o.stride || 1;
    const project = o.project !== undefined ? o.project : (s !== 1 || x.num[2] !== cout);
    const fz = o.frozenBN ? { frozenBN: true } : {};
    const a = conv_bn(x, Object.assign({ k: 1, cout: w }, fz));
    const b = conv_bn(a.out, Object.assign({ k: 3, s, p: 1, cout: w }, fz));
    const c = conv_bn(b.out, Object.assign({ k: 1, cout, relu: false }, fz));
    const parts = [a, b, c];
    let sc = x;
    if (project) { const d = conv_bn(x, Object.assign({ k: 1, s, cout, relu: false }, fz)); parts.push(d); sc = d.out; }
    const ad = residual_add(sc, c.out);
    const r = relu(ad.out);
    parts.push(ad, r);
    return composite('bottleneck', x, parts, r.out, {
      paramTex: o.frozenBN ? 'C_{in}w + 9w^2 + 4w^2' + (project ? ' + 4w\\,C_{in}' : '')
        : 'C_{in}w + 9w^2 + 4w^2 + 2(6w)' + (project ? ' + 4w\\,C_{in} + 8w' : ''),
      macTex: 'H\\,W\\,C_{in}w + H_o W_o (9w^2 + 4w^2)' + (project ? ' + H_o W_o\\,4w\\,C_{in}' : ''),
      detail: Object.assign({ width: w, cout, stride: s, project }, fz),
    });
  }

  // window_attention (Swin W-MSA / SW-MSA) sobre una rejilla H×W×C:
  //   [shift] → partición nW×M²×C → qkv → cabezas → QKᵀ → escala → + sesgo relativo → [máscara] →
  //   softmax → ·V → concatenar → proyección → revertir partición → [unshift].
  // o = {M, h, shift=0, qkvBias=true, projBias=true}
  // Parámetros 4C² + 4C + (2M−1)²·h. MACs H·W·4C² + 2·H·W·M²·C (vs 2·(HW)²·C de la atención global).
  function window_attention(x, o) {
    const [H, W, C] = x.num, M = o.M;
    const parts = [];
    let t = x;
    if (o.shift) { const sh = cyclic_shift(t, { s: o.shift }); parts.push(sh); t = sh.out; }
    const wp = window_partition(t, { M }); parts.push(wp);
    const qkv = linear(wp.out, { dout: 3 * C, doutSym: '3' + x.sym[2], bias: o.qkvBias !== false }); parts.push(qkv);
    const sp = split_heads(qkv.out, { h: o.h, parts: 3 }); parts.push(sp);
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k); parts.push(sc);
    const sl = scale(sc.out); parts.push(sl);
    const bi = rel_pos_bias(sl.out, { M, h: o.h }); parts.push(bi);
    let pre = bi.out;
    if (o.shift) { const mk = attn_mask(pre); parts.push(mk); pre = mk.out; }
    const sm = softmax(pre); parts.push(sm);
    const ws = attention_weighted_sum(sm.out, v); parts.push(ws);
    const mg = merge_heads(ws.out, { Dsym: x.sym[2] }); parts.push(mg);
    const pj = linear(mg.out, { dout: C, doutSym: x.sym[2], bias: o.projBias !== false }); parts.push(pj);
    const rv = window_reverse(pj.out, { H, W, M, outSym: [x.sym[0], x.sym[1]] }); parts.push(rv);
    let out = rv.out;
    if (o.shift) { const us = cyclic_shift(out, { s: o.shift, inverse: true }); parts.push(us); out = us.out; }
    return composite('window_attention', x, parts, out, {
      paramTex: '4C^2 + 4C + (2M-1)^2 h', macTex: '4\\,HW\\,C^2 + 2\\,HW\\,M^2\\,C',
      detail: { M, h: o.h, shift: o.shift || 0, nW: (H / M) * (W / M), globalScoreMacs: 2 * H * W * H * W * C, windowScoreMacs: 2 * H * W * M * M * C },
    });
  }

  // patch_merging (Swin): concat 2×2 (H×W×C → H/2×W/2×4C) → LayerNorm(4C) → Linear 4C→2C SIN sesgo.
  // Parámetros 8C + 8C². Los tokens bajan ×4 y los canales suben ×2.
  function patch_merging(x, o) {
    const C = x.num[2];
    const cc = patch_concat(x, o);
    const ln = layernorm(cc.out);
    const rd = linear(ln.out, { dout: 2 * C, doutSym: (o && o.coutSym) || ('2' + x.sym[2]), bias: false });
    return composite('patch_merging', x, [cc, ln, rd], rd.out, {
      paramTex: '8C + 8C^2', macTex: '\\tfrac{H}{2}\\tfrac{W}{2}\\cdot 4C\\cdot 2C',
    });
  }

  // causal_self_attention: MHSA con máscara causal. Mismos parámetros y MACs que la bidireccional:
  // la máscara es una operación sobre el tensor de scores (solo "otros").
  function causal_self_attention(x, o) {
    const D = x.num[1], Ds = (o && o.Dsym) || x.sym[1];
    const qkv = linear(x, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false });
    const sp = split_heads(qkv.out, { h: o.h, parts: 3 });
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k);
    const sl = scale(sc.out);
    const mk = causal_mask(sl.out);
    const sm = softmax(mk.out);
    const ws = attention_weighted_sum(sm.out, v);
    const mg = merge_heads(ws.out, { Dsym: Ds });
    const pj = linear(mg.out, { dout: D, doutSym: Ds, bias: o.projBias !== false });
    const ref = mhsa(x, o);
    return composite('causal_self_attention', x, [qkv, sp, sc, sl, mk, sm, ws, mg, pj], pj.out, {
      paramTex: ref.paramFormula, macTex: ref.macFormula, detail: { h: o.h, dh: D / o.h, used: mk.detail.used, masked: mk.detail.masked },
    });
  }

  // ---- Fase 3: compuestas -------------------------------------------------------------------
  // multihead_attention (nn.MultiheadAttention de DETR): Q, K y V con entradas propias y largos N_q, N_k.
  //   [+ posición en Q y en K, nunca en V] → W_Q, W_K, W_V → cabezas → QKᵀ → escala → softmax → ·V →
  //   concatenar → W_O. o = {h, bias=true, Dsym, qPos, kPos (formas), prim}
  // Parámetros 4D² + 4D. MACs 2·N_q·D² + 2·N_k·D² + 2·N_q·N_k·D (= 4ND² + 2N²D si N_q = N_k = N).
  function multihead_attention(qIn, kIn, vIn, o) {
    o = o || {};
    const D = qIn.num[1], Ds = o.Dsym || qIn.sym[1], bias = o.bias !== false;
    const parts = [];
    let qx = qIn, kx = kIn;
    if (o.qPos) { const a = add(qIn, o.qPos); parts.push(a); qx = a.out; }
    if (o.kPos) {
      if (kIn === qIn && o.kPos === o.qPos) kx = qx;            // q = k = x + pos: una sola suma
      else { const a = add(kIn, o.kPos); parts.push(a); kx = a.out; }
    }
    const qp = linear(qx, { dout: D, doutSym: Ds, bias });
    const kp = linear(kx, { dout: D, doutSym: Ds, bias });
    const vp = linear(vIn, { dout: D, doutSym: Ds, bias });
    const sp = split_qkv_heads(qp.out, kp.out, vp.out, { h: o.h });
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k);
    const sl = scale(sc.out);
    const sm = softmax(sl.out);
    const ws = attention_weighted_sum(sm.out, v);
    const mg = merge_heads(ws.out, { Dsym: Ds });
    const pj = linear(mg.out, { dout: D, doutSym: Ds, bias });
    parts.push(qp, kp, vp, sp, sc, sl, sm, ws, mg, pj);
    const n = symTexFactor(qIn.sym[0]), m = symTexFactor(kIn.sym[0]), d = symTexFactor(Ds);
    const self = qIn.sym[0] === kIn.sym[0] && qIn.num[0] === kIn.num[0];
    const r = composite(o.prim || 'multihead_attention', qIn, parts, pj.out, {
      paramTex: '4' + d + '^2' + (bias ? ' + 4' + d : ''),
      macTex: self ? '4\\,' + n + '\\,' + d + '^2 + 2\\,' + n + '^2\\,' + d
        : '2\\,' + n + '\\,' + d + '^2 + 2\\,' + m + '\\,' + d + '^2 + 2\\,' + n + '\\,' + m + '\\,' + d,
      detail: { h: o.h, dh: D / o.h, Nq: qIn.num[0], Nk: kIn.num[0], scoreMacs: sc.macs + ws.macs, posQ: !!o.qPos, posK: !!o.kPos, posV: false },
    });
    r.inputs = [qIn, kIn, vIn, o.qPos, o.kPos].filter((t, i, a) => t && a.indexOf(t) === i);
    return r;
  }

  // cross_attention (decoder de DETR): Q de las queries (N_q = Q filas), K y V de la memoria del encoder
  // (N_k = N filas, largo distinto). o.qPos = query_pos, o.kPos = PE de la memoria (V sin posición).
  function cross_attention(xq, mem, o) {
    return multihead_attention(xq, mem, mem, Object.assign({}, o, { prim: 'cross_attention' }));
  }

  // deformable_attention (Deformable DETR, MSDeformAttn): cada query mira solo h·L·K puntos muestreados
  // alrededor de su punto de referencia en los L niveles (K por cabeza y nivel), no las N_v claves.
  //   [q + pos] → Δ = Linear(D → hLK·2), A = softmax_{LK}(Linear(D → hLK)); V = Linear(D → D) sobre el
  //   value; muestreo bilineal de V en ref + Δ; Σ A·V muestreado; W_O.
  // o = {h, L, K, qPos, ref (forma), Dsym}. Parámetros D·3hLK + 3hLK + 2D² + 2D.
  // MACs N_q·D·3hLK + N_v·D² + N_q·D² + 5·N_q·hLK·d_h: LINEAL en tokens (sin término N_q·N_v).
  function deformable_attention(xq, valueIn, o) {
    const D = xq.num[1], Ds = o.Dsym || xq.sym[1], h = o.h, L = o.L, K = o.K, S = h * L * K;
    const parts = [];
    let q = xq;
    if (o.qPos) { const a = add(xq, o.qPos); parts.push(a); q = a.out; }
    const vp = linear(valueIn, { dout: D, doutSym: Ds });
    const off = linear(q, { dout: 2 * S, doutSym: 'hLK·2' });
    const aw = linear(q, { dout: S, doutSym: 'hLK' });
    const sm = softmax(aw.out);
    const smp = deform_sample(vp.out, off.out, o.ref || null, { h, L, K });
    const ws = deform_weighted_sum(smp.out, sm.out, { Dsym: Ds });
    const pj = linear(ws.out, { dout: D, doutSym: Ds });
    parts.push(vp, off, aw, sm, smp, ws, pj);
    const n = symTexFactor(xq.sym[0]), m = symTexFactor(valueIn.sym[0]), d = symTexFactor(Ds);
    const r = composite('deformable_attention', xq, parts, pj.out, {
      paramTex: d + '\\cdot 3hLK + 3hLK + 2' + d + '^2 + 2' + d,
      macTex: n + '\\,' + d + '\\cdot 3hLK + ' + m + '\\,' + d + '^2 + ' + n + '\\,' + d + '^2 + 5\\,' + n + '\\,hLK\\,d_h',
      detail: { h, L, K, samples: S, Nq: xq.num[0], Nv: valueIn.num[0], samplingMacs: smp.macs + ws.macs,
        denseScoreMacs: 2 * xq.num[0] * valueIn.num[0] * D, note: 'sin término N_q·N_v: cada query lee hLK puntos' },
    });
    r.inputs = [xq, valueIn, o.qPos, o.ref].filter((t, i, a) => t && a.indexOf(t) === i);
    return r;
  }

  // box_mlp (DETR): MLP de 3 capas D → D → D → 4 con ReLU entre capas, + sigmoide: (cx, cy, w, h) en [0, 1].
  // o = {layers=3, hidden=D, out=4}. Parámetros 2(D² + D) + 4D + 4 con 3 capas.
  function box_mlp(x, o) {
    o = o || {};
    const n = o.layers || 3, D = x.num[x.num.length - 1], Hd = o.hidden || D, out = o.out || 4;
    const parts = [];
    let t = x;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const l = linear(t, { dout: last ? out : Hd, doutSym: last ? String(out) : x.sym[x.sym.length - 1] });
      parts.push(l); t = l.out;
      if (!last) { const a = relu(t); parts.push(a); t = a.out; }
    }
    const sg = sigmoid(t); parts.push(sg);
    const d = symTexFactor(x.sym[x.sym.length - 1]), q = symTexFactor(x.sym[0]);
    return composite('box_mlp', x, parts, sg.out, {
      paramTex: (n - 1) + '(' + d + '^2 + ' + d + ') + ' + out + d + ' + ' + out,
      macTex: q + '\\,(' + (n - 1) + d + '^2 + ' + out + d + ')',
      detail: { layers: n, hidden: Hd, out },
    });
  }

  // ---- Fase 4: compuestas -------------------------------------------------------------------
  // conv_bn_act (el `Conv` de Ultralytics): conv k×k SIN sesgo → BatchNorm → SiLU (act 'silu') o nada
  // (act 'none'). Padding k/2 ("same" con stride 1). o = {k, s=1, cout, coutSym, outSym, act='silu'}
  function conv_bn_act(x, o) {
    const k = o.k, s = o.s || 1, act = o.act === undefined ? 'silu' : o.act;
    const co = { k, s, p: o.p !== undefined ? o.p : Math.floor(k / 2), cout: o.cout, floor: true, bias: false };
    if (o.coutSym) co.coutSym = o.coutSym;
    if (o.outSym) co.outSym = o.outSym;
    const cv = conv2d(x, co);
    const bn = batchnorm2d(cv.out);
    const parts = [cv, bn];
    if (act === 'silu') parts.push(silu(bn.out));
    return composite('conv_bn_act', x, parts, parts[parts.length - 1].out, {
      paramTex: 'k^2\\,C_{in}\\,C_{out} + 2C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}', detail: { k, s, act },
    });
  }

  // csp_bottleneck (el `Bottleneck` de C2f, e = 1): conv 3×3 → conv 3×3 (C → C), + atajo si shortcut.
  // Parámetros 18C² + 4C; MACs 18·H·W·C².
  function csp_bottleneck(x, o) {
    const C = x.num[2], g = [x.sym[0], x.sym[1]];
    const a = conv_bn_act(x, { k: 3, cout: C, coutSym: x.sym[2], outSym: g });
    const b = conv_bn_act(a.out, { k: 3, cout: C, coutSym: x.sym[2], outSym: g });
    const parts = [a, b];
    let out = b.out;
    if (o && o.shortcut) { const r = residual_add(x, b.out); parts.push(r); out = r.out; }
    return composite('csp_bottleneck', x, parts, out, { paramTex: '18C^2 + 4C', macTex: '18\\,H\\,W\\,C^2', detail: { shortcut: !!(o && o.shortcut) } });
  }

  // c2f (YOLOv8): cv1 1×1 (C_in → 2c) → partir en dos mitades c → n bottlenecks encadenados sobre la
  // segunda → concatenar las 2 + n salidas ((2+n)c) → cv2 1×1 → C_out. c = e·C_out (e = 0.5).
  // o = {cout, coutSym, n, shortcut, e=0.5}
  function c2f(x, o) {
    const n = o.n, c = Math.round(o.cout * (o.e || 0.5)), g = [x.sym[0], x.sym[1]];
    const cv1 = conv_bn_act(x, { k: 1, cout: 2 * c, outSym: g });
    const sp = split_channels(cv1.out, { parts: 2 });
    const parts = [cv1, sp];
    let y = sp.out[1];
    for (let i = 0; i < n; i++) { const b = csp_bottleneck(y, { shortcut: o.shortcut }); parts.push(b); y = b.out; }
    const cat = concat_channels([sp.out[0], sp.out[1], y], { mult: [1, 1, n] });
    const cv2 = conv_bn_act(cat.out, { k: 1, cout: o.cout, coutSym: o.coutSym, outSym: g });
    parts.push(cat, cv2);
    return composite('c2f', x, parts, cv2.out, {
      paramTex: '2c\\,C_{in} + 4c + n\\,(18c^2 + 4c) + (2{+}n)\\,c\\,C_{out} + 2C_{out}',
      macTex: 'H\\,W\\,[\\,2c\\,C_{in} + 18\\,n\\,c^2 + (2{+}n)\\,c\\,C_{out}\\,]', detail: { n, c, shortcut: !!o.shortcut },
    });
  }

  // sppf (YOLOv8): cv1 1×1 (C → C/2) → 3 max-pool 5×5 encadenados (stride 1) → concatenar 4 mapas → cv2 1×1 → C_out.
  // Equivale a SPP con pools 5, 9 y 13. o = {cout, coutSym, k=5, cv1Act='none'} (Ultralytics 8.4: cv1 sin activación).
  function sppf(x, o) {
    const C = x.num[2], c = C / 2, k = o.k || 5, g = [x.sym[0], x.sym[1]];
    const cv1 = conv_bn_act(x, { k: 1, cout: c, outSym: g, act: o.cv1Act || 'none' });
    const parts = [cv1];
    let y = cv1.out;
    for (let i = 0; i < 3; i++) { const p = maxpool2d(y, { k, s: 1, p: Math.floor(k / 2), outSym: g }); parts.push(p); y = p.out; }
    const cat = concat_channels([cv1.out, y], { mult: [1, 3] });
    const cv2 = conv_bn_act(cat.out, { k: 1, cout: o.cout, coutSym: o.coutSym, outSym: g });
    parts.push(cat, cv2);
    return composite('sppf', x, parts, cv2.out, {
      paramTex: 'C\\,\\tfrac{C}{2} + C + 2C\\,C_{out} + 2C_{out}', macTex: 'H\\,W\\,(\\tfrac{C^2}{2} + 2C\\,C_{out})', detail: { k, pools: [k, 2 * k - 1, 3 * k - 2] },
    });
  }

  // max_sigmoid_attn (YOLO-World, dentro del T-CSPLayer): el texto guía a la imagen.
  //   [conv 1×1 C → E si C ≠ E] · g = Linear(512 → E) sobre los V embeddings · scores píxel × clase por
  //   cabeza (H·W·V·E MACs) · máximo sobre las V clases · σ(·/√c_h + b_h) · conv 3×3 (C → C_out, BN, sin
  //   activación) · cada cabeza de la salida × su peso. o = {nh, ec, cout, gc=512}
  function max_sigmoid_attn(x, guide, o) {
    const C = x.num[2], E = o.ec, nh = o.nh, g = [x.sym[0], x.sym[1]];
    const parts = [];
    let emb = x;
    if (C !== E) { const ec = conv_bn_act(x, { k: 1, cout: E, outSym: g, act: 'none' }); parts.push(ec); emb = ec.out; }
    const gl = linear(guide, { dout: E, doutSym: String(E) });
    const sc = text_guided_scores(emb, gl.out, { nh });
    const mx = max_over_text(sc.out);
    const gt = maxsig_gate(mx.out, { nh, hc: E / nh });
    const pj = conv_bn_act(x, { k: 3, cout: o.cout || C, outSym: g, act: 'none' });
    const md = head_modulate(pj.out, gt.out, { nh });
    parts.push(gl, sc, mx, gt, pj, md);
    const r = composite('max_sigmoid_attn', x, parts, md.out, {
      paramTex: '512E + E + n_h + 9\\,C\\,C_{out} + 2C_{out}' + (C !== E ? ' + C\\,E + 2E' : ''),
      macTex: 'V\\cdot 512\\cdot E + H\\,W\\,V\\,E + 9\\,H\\,W\\,C\\,C_{out}' + (C !== E ? ' + H\\,W\\,C\\,E' : ''),
      detail: { nh, ec: E, V: guide.num[0], hc: E / nh, embedConv: C !== E },
    });
    r.inputs = [x, guide];
    return r;
  }

  // t_csp_layer (YOLO-World, `C2fAttn`): un C2f cuya última rama es la max-sigmoid attention guiada por texto:
  // cv1 → dos mitades c → n bottlenecks (sin atajo) → atención sobre la última salida → concatenar (3+n)c → cv2.
  // o = {cout, coutSym, n, ec, nh, e=0.5}
  function t_csp_layer(x, guide, o) {
    const n = o.n, c = Math.round(o.cout * (o.e || 0.5)), g = [x.sym[0], x.sym[1]];
    const cv1 = conv_bn_act(x, { k: 1, cout: 2 * c, outSym: g });
    const sp = split_channels(cv1.out, { parts: 2 });
    const parts = [cv1, sp];
    let y = sp.out[1];
    for (let i = 0; i < n; i++) { const b = csp_bottleneck(y, { shortcut: !!o.shortcut }); parts.push(b); y = b.out; }
    const at = max_sigmoid_attn(y, guide, { nh: o.nh, ec: o.ec });
    const cat = concat_channels([sp.out[0], sp.out[1], y, at.out], { mult: [1, 1, n, 1] });
    const cv2 = conv_bn_act(cat.out, { k: 1, cout: o.cout, coutSym: o.coutSym, outSym: g });
    parts.push(at, cat, cv2);
    const r = composite('t_csp_layer', x, parts, cv2.out, {
      paramTex: '\\text{C2f}(n) + c\\,C_{out} + \\text{max-sigmoid}', macTex: 'H\\,W\\,[\\,2c\\,C_{in} + 18\\,n\\,c^2 + 9c^2 + (3{+}n)\\,c\\,C_{out}\\,] + H\\,W\\,V\\,E + 512\\,V\\,E',
      detail: { n, c, ec: o.ec, nh: o.nh, V: guide.num[0] },
    });
    r.inputs = [x, guide];
    return r;
  }

  // image_pooling_attn (YOLO-World v1, I-Pooling attention): el texto se actualiza con la imagen.
  //   Por nivel: conv 1×1 (C_l → E, con sesgo) y max-pool adaptativo a k×k → 3·k² = 27 "tokens de imagen".
  //   q = Linear(LN(texto)) (512 → E), k y v = Linear(LN(tokens)) (E → E), atención multi-cabeza V×27,
  //   salida Linear(E → 512) + residual. o = {ec=256, nh=8, k=3}
  function image_pooling_attn(feats, text, o) {
    o = o || {};
    const E = o.ec || 256, nh = o.nh || 8, k = o.k || 3, ct = text.num[1];
    const parts = [];
    const pooled = feats.map((f) => {
      const pj = conv2d(f, { k: 1, cout: E, coutSym: String(E), outSym: [f.sym[0], f.sym[1]] });
      const pl = adaptive_max_pool(pj.out, { k });
      parts.push(pj, pl);
      return pl.out;
    });
    const tok = flatten_levels(pooled, { sym: [String(feats.length * k * k), String(E)] });
    const qn = layernorm(text), qp = linear(qn.out, { dout: E, doutSym: String(E) });
    const kn = layernorm(tok.out), kp = linear(kn.out, { dout: E, doutSym: String(E) });
    const vn = layernorm(tok.out), vp = linear(vn.out, { dout: E, doutSym: String(E) });
    const sp = split_qkv_heads(qp.out, kp.out, vp.out, { h: nh, hSym: String(nh), dhSym: String(E / nh) });
    const sc = attention_scores(sp.out[0], sp.out[1]);
    const sl = scale(sc.out);
    const sm = softmax(sl.out);
    const ws = attention_weighted_sum(sm.out, sp.out[2]);
    const mg = merge_heads(ws.out, { Dsym: String(E) });
    const pr = linear(mg.out, { dout: ct, doutSym: text.sym[1] });
    const rs = residual_add(text, pr.out);
    parts.push(tok, qn, qp, kn, kp, vn, vp, sp, sc, sl, sm, ws, mg, pr, rs);
    const r = composite('image_pooling_attn', text, parts, rs.out, {
      paramTex: '\\textstyle\\sum_l (C_l E + E) + 2\\cdot 512 + 512E + E + 2(2E + E^2 + E) + E\\cdot 512 + 512',
      macTex: '\\textstyle\\sum_l H_lW_l C_l E + 2\\cdot 512\\,V\\,E + 2\\cdot 27E^2 + 2\\cdot 27\\,V\\,E',
      detail: { ec: E, nh, k, tokens: feats.length * k * k, V: text.num[0] },
    });
    r.inputs = feats.concat([text]);
    return r;
  }

  // bi_attention (Grounding DINO, fusión del feature enhancer): atención cruzada BIDIRECCIONAL imagen ↔ texto
  // con UNA sola matriz de scores. Q de la imagen y K del texto (D → E, E = D_mlp/2 = 1024, h = 4 cabezas),
  // values de los dos lados; imagen→texto usa softmax sobre T, texto→imagen la transpuesta con softmax
  // sobre N. Parámetros 6DE + 4E + 2D. MACs 3NDE + 3TDE + 3NTE. o = {E, h}
  function bi_attention(img, txt, o) {
    const E = o.E, h = o.h, D = img.num[1];
    const qi = linear(img, { dout: E, doutSym: String(E) }), kt = linear(txt, { dout: E, doutSym: String(E) });
    const vi = linear(img, { dout: E, doutSym: String(E) }), vt = linear(txt, { dout: E, doutSym: String(E) });
    const sp = split_qkv_heads(qi.out, kt.out, vt.out, { h, hSym: String(h), dhSym: String(E / h) });
    const svi = split_heads(vi.out, { h, hSym: String(h), dhSym: String(E / h) });
    const sc = attention_scores(sp.out[0], sp.out[1]);
    const sl = scale(sc.out);
    const smI = softmax(sl.out);
    const wsI = attention_weighted_sum(smI.out, sp.out[2]);
    const tr = transpose_scores(sl.out);
    const smT = softmax(tr.out);
    const wsT = attention_weighted_sum(smT.out, svi.out);
    const mI = merge_heads(wsI.out, { Dsym: String(E) }), mT = merge_heads(wsT.out, { Dsym: String(E) });
    const oI = linear(mI.out, { dout: D, doutSym: img.sym[1] }), oT = linear(mT.out, { dout: D, doutSym: txt.sym[1] });
    const r = composite('bi_attention', img, [qi, kt, vi, vt, sp, svi, sc, sl, smI, wsI, tr, smT, wsT, mI, mT, oI, oT], oI.out, {
      paramTex: '6DE + 4E + 2D', macTex: '3NDE + 3TDE + 3NTE',
      detail: { E, h, dh: E / h, N: img.num[0], T: txt.num[0], scoreMacs: sc.macs, outText: oT.out },
    });
    r.inputs = [img, txt];
    return r;
  }

  // ---- Fase 6: compuestas -------------------------------------------------------------------
  // swiglu (FFN de Llama/Mixtral, Shazeer 2020): down(SiLU(x·W_gate) ⊙ (x·W_up)), sin sesgos.
  // Parámetros 3·D·D_mlp; MACs 3·N·D·D_mlp. o = {Dmlp, DmlpSym='D_mlp'}
  function swiglu(x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1], Ms = o.DmlpSym || 'D_mlp';
    const g = linear(x, { dout: o.Dmlp, doutSym: Ms, bias: false });
    const u = linear(x, { dout: o.Dmlp, doutSym: Ms, bias: false });
    const a = silu(g.out);
    const m = mul(a.out, u.out);
    const d = linear(m.out, { dout: D, doutSym: Ds, bias: false });
    const dd = symTexFactor(Ds), mm = symTexFactor(Ms), n = symTexFactor(x.sym[0]);
    return composite('swiglu', x, [g, u, a, m, d], d.out, {
      paramTex: '3\\,' + dd + '\\,' + mm, macTex: '3\\,' + n + '\\,' + dd + '\\,' + mm,
      detail: { Dmlp: o.Dmlp, note: 'Tres matrices (gate, up, down) en vez de dos: Llama usa D_mlp ≈ 8D/3·(redondeo) para igualar parámetros con un MLP 4D.' },
    });
  }

  // gqa_attention (Llama): W_Q (D → h·d_h), W_K y W_V (D → G·d_h), RoPE en Q y K, QKᵀ/√d_h + máscara causal, softmax,
  // ·V, W_O (h·d_h → D); sin sesgos. G = cabezas KV (G = h: MHA; G = 1: MQA). o = {h, G, theta}
  // Parámetros 2D·h·d_h + 2D·G·d_h (= 2D² + 2D·G·d_h con h·d_h = D). MACs N(2D² + 2D·G·d_h) + 2N²D (máscara sin ahorro).
  function gqa_attention(x, o) {
    const D = x.num[1], Ds = x.sym[1], h = o.h, G = o.G, dh = o.dh || D / h;
    const q = linear(x, { dout: h * dh, doutSym: Ds, bias: false });
    const k = linear(x, { dout: G * dh, doutSym: 'G·d_h', bias: false });
    const v = linear(x, { dout: G * dh, doutSym: 'G·d_h', bias: false });
    const sp = split_gqa_heads(q.out, k.out, v.out, { h, G });
    const rq = rope(sp.out[0], { theta: o.theta }), rk = rope(sp.out[1], { theta: o.theta });
    const sc = attention_scores(rq.out, rk.out);
    const sl = scale(sc.out);
    const mk = causal_mask(sl.out);
    const sm = softmax(mk.out);
    const ws = attention_weighted_sum(sm.out, sp.out[2]);
    const mg = merge_heads(ws.out, { Dsym: Ds });
    const pj = linear(mg.out, { dout: D, doutSym: Ds, bias: false });
    const d = symTexFactor(Ds), n = symTexFactor(x.sym[0]);
    return composite('gqa_attention', x, [q, k, v, sp, rq, rk, sc, sl, mk, sm, ws, mg, pj], pj.out, {
      paramTex: '2' + d + '^2 + 2\\,' + d + '\\,G\\,d_h', macTex: n + '\\,(2' + d + '^2 + 2\\,' + d + '\\,G\\,d_h) + 2\\,' + n + '^2\\,' + d,
      detail: { h, G, dh, groups: h / G, kind: G === h ? 'MHA' : (G === 1 ? 'MQA' : 'GQA'), kvPerToken: 2 * G * dh },
    });
  }

  // llama_block (pre-norm con RMSNorm): x + Attn(RMSNorm(x)); luego + SwiGLU(RMSNorm(·)).
  // Parámetros 2D² + 2D·G·d_h + 3D·D_mlp + 2D. o = {h, G, Dmlp, theta}
  function llama_block(x, o) {
    const n1 = rmsnorm(x);
    const at = gqa_attention(n1.out, o);
    const r1 = residual_add(x, at.out);
    const n2 = rmsnorm(r1.out);
    const ff = swiglu(n2.out, o);
    const r2 = residual_add(r1.out, ff.out);
    const d = symTexFactor(x.sym[1]), n = symTexFactor(x.sym[0]);
    return composite('llama_block', x, [n1, at, r1, n2, ff, r2], r2.out, {
      paramTex: '2' + d + '^2 + 2\\,' + d + '\\,G\\,d_h + 3\\,' + d + '\\,D_{\\mathrm{mlp}} + 2' + d,
      macTex: n + '\\,(2' + d + '^2 + 2\\,' + d + '\\,G\\,d_h + 3\\,' + d + '\\,D_{\\mathrm{mlp}}) + 2\\,' + n + '^2\\,' + d,
      detail: { note: 'Sin sesgos; dos RMSNorm (solo γ, D parámetros cada una).' },
    });
  }

  // moe_ffn (Mixtral): router D → E, top-k, cada token pasa por k expertos SwiGLU y se combinan con los pesos del router.
  // Parámetros D·E + 3·E·D·D_mlp; MACs N·D·E + 3·k·N·D·D_mlp (solo los k expertos activos de cada token).
  // o = {E, k, Dmlp}
  function moe_ffn(x, o) {
    const D = x.num[1], Ds = x.sym[1], Ms = o.DmlpSym || 'D_mlp', k = o.k;
    const rs = String(k) + x.sym[0];
    const rt = moe_router(x, { E: o.E });
    const tk = moe_topk(rt.out, { k });
    const dp = repeat_rows(x, { k, sym: rs });
    const g = expert_linear(dp.out, { E: o.E, dout: o.Dmlp, doutSym: Ms });
    const u = expert_linear(dp.out, { E: o.E, dout: o.Dmlp, doutSym: Ms });
    const a = silu(g.out);
    const m = mul(a.out, u.out);
    const dn = expert_linear(m.out, { E: o.E, dout: D, doutSym: Ds });
    const cb = moe_combine(dn.out, tk.out[0]);
    const d = symTexFactor(Ds), n = symTexFactor(x.sym[0]);
    return composite('moe_ffn', x, [rt, tk, dp, g, u, a, m, dn, cb], cb.out, {
      paramTex: d + '\\,E + 3\\,E\\,' + d + '\\,D_{\\mathrm{mlp}}', macTex: n + '\\,' + d + '\\,E + 3\\,k\\,' + n + '\\,' + d + '\\,D_{\\mathrm{mlp}}',
      detail: { E: o.E, k, activeExpertParams: 3 * k * D * o.Dmlp, totalExpertParams: 3 * o.E * D * o.Dmlp },
    });
  }

  // ---- Fase 8: compuestas -------------------------------------------------------------------
  // resnet_block (U-Net de SD y VAE; ResnetBlock2D de diffusers): GN → SiLU → conv 3×3 (C_in → C_out) → [+ Linear(SiLU(e))
  // por canal: el tiempo] → GN → SiLU → conv 3×3 (C_out → C_out) → + atajo (identidad, o conv 1×1 si C_in ≠ C_out).
  // o = {cout, coutSym, temb (forma del embedding del tiempo, E; null en el VAE), groups=32}
  // Parámetros 9C_in·C_out + 9C_out² + E·C_out (+ C_in·C_out del atajo) + sesgos y GN; MACs HW(9C_in·C_out + 9C_out² [+ C_in·C_out]) + E·C_out.
  function resnet_block(x, o) {
    const [, , C] = x.num, cout = o.cout || C, cs = o.coutSym || (o.cout ? String(cout) : x.sym[2]);
    const g1 = group_norm(x, { groups: o.groups || 32 });
    const a1 = silu(g1.out);
    const c1 = conv2d(a1.out, { k: 3, s: 1, p: 1, cout, coutSym: cs, outSym: [x.sym[0], x.sym[1]] });
    const parts = [g1, a1, c1];
    let h = c1.out;
    if (o.temb) {
      const ta = silu(o.temb);
      const tp = linear(ta.out, { dout: cout, doutSym: cs });
      const ad = add_broadcast(h, tp.out);
      parts.push(ta, tp, ad);
      h = ad.out;
    }
    const g2 = group_norm(h, { groups: o.groups || 32 });
    const a2 = silu(g2.out);
    const c2 = conv2d(a2.out, { k: 3, s: 1, p: 1, cout, coutSym: cs, outSym: [x.sym[0], x.sym[1]] });
    parts.push(g2, a2, c2);
    let sk = x;
    if (cout !== C) { const sc = conv2d(x, { k: 1, cout, coutSym: cs, outSym: [x.sym[0], x.sym[1]] }); parts.push(sc); sk = sc.out; }
    const rs = residual_add(sk, c2.out);
    parts.push(rs);
    const r = composite('resnet_block', x, parts, rs.out, {
      paramTex: '9\\,C_{in}C_{out} + 9\\,C_{out}^2' + (o.temb ? ' + E\\,C_{out}' : '') + (cout !== C ? ' + C_{in}C_{out}' : '') + ' + \\ldots',
      macTex: 'HW\\,(9\\,C_{in}C_{out} + 9\\,C_{out}^2' + (cout !== C ? ' + C_{in}C_{out}' : '') + ')' + (o.temb ? ' + E\\,C_{out}' : ''),
      detail: { cin: C, cout, temb: !!o.temb, shortcut: cout !== C ? 'conv 1×1' : 'identidad' },
    });
    if (o.temb) r.inputs = [x, o.temb];
    return r;
  }

  // upsample2d (U-Net y VAE): vecino más cercano ×2 → conv 3×3 (padding 1): H×W×C → 2H×2W×C. Parámetros 9C² + C; MACs 4HW·9C².
  function upsample2d(x, o) {
    o = o || {};
    const C = x.num[2], cs = o.coutSym || x.sym[2];
    const up = upsample_nearest(x, { s: 2, outSym: o.outSym });
    const cv = conv2d(up.out, { k: 3, s: 1, p: 1, cout: o.cout || C, coutSym: cs, outSym: [up.out.sym[0], up.out.sym[1]] });
    return composite('upsample2d', x, [up, cv], cv.out, { paramTex: '9C^2 + C', macTex: '4HW\\cdot 9C^2', detail: { mode: 'nearest ×2 + conv 3×3' } });
  }

  // geglu_ff (FeedForward de SD): Linear D → 2F (con sesgo) → GEGLU (F) → Linear F → D (con sesgo). Con F = 4D:
  // 12D² + 9D parámetros y 12·N·D² MACs (una matriz más ancha que un MLP 4D: 8D en la entrada).
  function geglu_ff(x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1], F = o.F || 4 * D, Fs = o.Fsym || '4' + Ds;
    const p = linear(x, { dout: 2 * F, doutSym: o.F2sym || '8' + Ds });
    const g = geglu(p.out, { outSym: Fs });
    const q = linear(g.out, { dout: D, doutSym: Ds });
    const d = symTexFactor(Ds), n = symTexFactor(x.sym[0]);
    return composite('geglu_ff', x, [p, g, q], q.out, { paramTex: '12' + d + '^2 + 9' + d, macTex: '12\\,' + n + '\\,' + d + '^2', detail: { F } });
  }

  // spatial_transformer (Transformer2DModel de SD 1.x con un BasicTransformerBlock): GN → proj_in (conv 1×1) → tokens →
  // [LN → self-attn → +] → [LN → cross-attn (K, V del texto) → +] → [LN → FF GEGLU → +] → rejilla → proj_out (conv 1×1) → + x.
  // Atención sin sesgo en Q, K, V (con sesgo en la salida). o = {h, text (forma T×D_t)}
  // Parámetros 20C² + 2·D_t·C + 21C; MACs N(18C² + 2·T·...): ver el detalle de las partes.
  function spatial_transformer(x, o) {
    const [H, W, C] = x.num, cs = x.sym[2], ts = x.sym[0] + '·' + x.sym[1];
    const gn = group_norm(x, { groups: 32 });
    const pi = conv2d(gn.out, { k: 1, cout: C, coutSym: cs, outSym: [x.sym[0], x.sym[1]] });
    const fl = flatten(pi.out, { sym: [ts, cs] });
    // atención de diffusers (Attention): W_Q, W_K, W_V sin sesgo; W_O con sesgo. kv = el mismo x (self) o el texto (cross).
    const att = (xq, xkv) => {
      const q = linear(xq, { dout: C, doutSym: cs, bias: false });
      const k = linear(xkv, { dout: C, doutSym: cs, bias: false });
      const v = linear(xkv, { dout: C, doutSym: cs, bias: false });
      const sp = split_qkv_heads(q.out, k.out, v.out, { h: o.h });
      const sc = attention_scores(sp.out[0], sp.out[1]);
      const sl = scale(sc.out);
      const sm = softmax(sl.out);
      const ws = attention_weighted_sum(sm.out, sp.out[2]);
      const mg = merge_heads(ws.out, { Dsym: cs });
      const pj = linear(mg.out, { dout: C, doutSym: cs });
      return { parts: [q, k, v, sp, sc, sl, sm, ws, mg, pj], out: pj.out };
    };
    const ln1 = layernorm(fl.out);
    const sa = att(ln1.out, ln1.out);
    const r1 = residual_add(fl.out, sa.out);
    const ln2 = layernorm(r1.out);
    const ca = att(ln2.out, o.text);
    const r2 = residual_add(r1.out, ca.out);
    const ln3 = layernorm(r2.out);
    const ff = geglu_ff(ln3.out, {});
    const r3 = residual_add(r2.out, ff.out);
    const tg = to_grid(r3.out, { H, W, sym: [x.sym[0], x.sym[1]] });
    const po = conv2d(tg.out, { k: 1, cout: C, coutSym: cs, outSym: [x.sym[0], x.sym[1]] });
    const rs = residual_add(x, po.out);
    const r = composite('spatial_transformer', x, [gn, pi, fl, ln1].concat(sa.parts, [r1, ln2], ca.parts, [r2, ln3, ff, r3, tg, po, rs]), rs.out, {
      paramTex: '20C^2 + 2\\,D_t\\,C + 21C', macTex: 'N\\,(20C^2 + 2NC + 2TC) + 2\\,T\\,D_t\\,C',
      detail: { h: o.h, tokens: H * W, T: o.text.num[0], note: 'GN → conv 1×1 → [self-attn, cross-attn, FF GEGLU] con LN y residuales → conv 1×1 → + x' },
    });
    r.inputs = [x, o.text];
    return r;
  }

  // dit_block (DiT, adaLN-Zero): (γ1, β1, α1, γ2, β2, α2) = adaLN(c); x += α1 ⊙ Attn(LN(x)·(1 + γ1) + β1);
  // x += α2 ⊙ MLP(LN(x)·(1 + γ2) + β2). LayerNorm SIN parámetros. Parámetros 18D² + 15D (atención 4D² + 4D, MLP 8D² + 5D,
  // adaLN 6D² + 6D); MACs N·12D² + 2N²D + 6D². o = {h, Dmlp}
  function dit_block(x, c, o) {
    const D = x.num[1], Ds = x.sym[1], n = symTexFactor(x.sym[0]), d = symTexFactor(Ds);
    const ad = adaln_zero(c, { k: 6 });
    const [sa, sc1, ga, sm, sc2, gm] = ad.out;
    const n1 = layernorm(x, { affine: false });
    const m1 = ada_modulate(n1.out, sa, sc1);
    const at = mhsa(m1.out, { h: o.h });
    const g1 = ada_gate(at.out, ga);
    const r1 = residual_add(x, g1.out);
    const n2 = layernorm(r1.out, { affine: false });
    const m2 = ada_modulate(n2.out, sm, sc2);
    const ml = mlp(m2.out, { Dmlp: o.Dmlp || 4 * D, DmlpSym: o.DmlpSym || '4' + Ds });
    const g2 = ada_gate(ml.out, gm);
    const r2 = residual_add(r1.out, g2.out);
    const r = composite('dit_block', x, [ad, n1, m1, at, g1, r1, n2, m2, ml, g2, r2], r2.out, {
      paramTex: '18' + d + '^2 + 15' + d, macTex: n + '\\cdot 12' + d + '^2 + 2\\,' + n + '^2' + d + ' + 6' + d + '^2',
      detail: { h: o.h, note: 'adaLN-Zero: 6 vectores por bloque; LayerNorm sin γ ni β' },
    });
    r.inputs = [x, c];
    return r;
  }

  // ---- Fase 9 (VLA: OpenVLA, π0) -------------------------------------------------------------
  // Movidas desde js/arch/vla.js (donde vivían por la concurrencia de la fase 8): mismo contrato y mismos números. paramArith /
  // macArith por defecto = el entero (no hay términos).
  function vlaResult(prim, inputs, out, o) {
    const params = o.params || 0, macs = o.macs || 0;
    return result(prim, inputs, out, Object.assign({}, o, { params, macs, paramArith: o.paramArith || int(params), macArith: o.macArith || int(macs) }));
  }
  // normalize_pixels: (x − μ)/σ por canal con la media y desviación de CADA encoder (OpenVLA normaliza dos veces la misma
  // imagen: estadísticas de DINOv2 / ImageNet y de SigLIP). 2 ops por elemento. o = {stats}
  function normalize_pixels(x, o) {
    return vlaResult('normalize_pixels', [x], plain(x), { other: 2 * elems(x), detail: { stats: (o && o.stats) || null } });
  }
  // prefix_tokens: antepone k vectores aprendidos (CLS + registros de DINOv2-reg4): N×D → (N+k)×D, k·D parámetros. o = {k, sym}
  function prefix_tokens(x, o) {
    const [N, D] = x.num, [Ns, Ds] = x.sym, k = o.k;
    return vlaResult('prefix_tokens', [x], shape([o.sym || Ns + '+' + k, Ds], [N + k, D], x.mod, 'seq'), {
      params: k * D, paramTex: k + symTexShape(Ds), paramArith: k + '·' + D + ' = ' + int(k * D),
      detail: { k, cls: 1, registers: k - 1, note: 'CLS + registros (Darcet et al. 2024, "Vision Transformers Need Registers"): sin position embedding (no_embed_class)' },
    });
  }
  // broadcast_rows: un vector D → R×D (la misma fila R veces: el embedding del tiempo en cada token de acción). Vista. o = {rows, sym, mod}
  function broadcast_rows(v, o) {
    return vlaResult('broadcast_rows', [v], shape([o.sym || String(o.rows), v.sym[0]], [o.rows, v.num[0]], o.mod || v.mod, 'seq'), { detail: { rows: o.rows } });
  }
  // prefix_mask: máscara del prefijo de π0 (imágenes + texto se ven todos con todos; el relleno del texto se enmascara).
  function prefix_mask(x, o) {
    return vlaResult('prefix_mask', [x], plain(x), { other: elems(x), detail: Object.assign({ kind: 'bidireccional (prefix-LM) + relleno', note: 'make_attn_mask con ar_mask = 0 en todo el prefijo' }, o || {}) });
  }
  // block_causal_mask: máscara por bloques del sufijo de π0 (filas = 1 + H_a queries; columnas = prefijo + sufijo). El estado
  // ve el prefijo y a sí mismo; las acciones ven el prefijo, el estado y todas las acciones. MACs: los mismos (se cuentan las
  // entradas enmascaradas, como la atención eager).
  function block_causal_mask(x, o) {
    return vlaResult('block_causal_mask', [x], plain(x), { other: elems(x), detail: Object.assign({ blocks: ['prefijo (imágenes + texto)', 'estado', 'acciones'] }, o || {}) });
  }
  // ar_decode: los k pasos de decode autorregresivo que faltan (cada uno = el decoder sobre 1 token nuevo leyendo la KV cache).
  // Sin parámetros propios (usa los del LLM); MACs = Σ de los pasos. o = {steps: [{ctx, macs}], sym, mod, macTex, other}
  function ar_decode(x, o) {
    const steps = o.steps || [];
    const macs = steps.reduce((s, z) => s + z.macs, 0);
    return vlaResult('ar_decode', [x], shape([o.sym || 'd_a'], [steps.length + 1], o.mod || 'act', 'vec'), {
      macs, macTex: o.macTex || '\\textstyle\\sum_{k=1}^{d_a-1} \\mathrm{MACs}_{\\mathrm{decode}}(\\mathrm{ctx} = N{+}T{+}k)',
      macArith: steps.length > 1 ? steps.map((z) => int(z.macs)).join(' + ') + ' = ' + int(macs) : int(macs),
      other: o.other || 0, detail: { steps: steps.map((z) => Object.assign({}, z)), note: 'el 1.er token sale del prefill; los demás, uno por paso de decode' },
    });
  }
  // detokenize_actions: id → bin (V_tok − id) → centro del bin en [−1, 1] → desnormalizar con q01 / q99. ≈ 4 ops por dimensión.
  function detokenize_actions(ids, o) {
    return vlaResult('detokenize_actions', [ids], shape(ids.sym.slice(), ids.num.slice(), 'act', 'vec'), {
      other: 4 * elems(ids), detail: Object.assign({ formula: 'a = ½(c_b + 1)(q99 − q01) + q01, c_b = centro del bin b' }, o || {}),
    });
  }

  // ---- Fase 10 (LoRA / QLoRA, SFT / RLHF / DPO) ------------------------------------------------
  // Lo que entrena un adaptador LoRA (Hu et al., ICLR 2022, arXiv:2106.09685): y = W₀x + (α/r)·B·A·x, con W₀ (d_out × d_in)
  // CONGELADA, A (r × d_in) y B (d_out × r) entrenables; B empieza en 0 (ΔW = 0 al inicio). Parámetros entrenables
  // r·(d_in + d_out); MACs extra N·r·(d_in + d_out). Tras entrenar se fusiona W = W₀ + (α/r)·BA: cero costo en inferencia.
  // dropout: máscara de Bernoulli y escala 1/(1 − p) (≈ 2 ops por elemento). PEFT lo aplica a la ENTRADA de cada adaptador
  // (lora_dropout; con p = 0 es nn.Identity y no copia nada). o = {p}
  function dropout(x, o) {
    const p = (o && o.p) || 0;
    return result('dropout', [x], plain(x), { other: 2 * elems(x), detail: { p, note: 'PEFT: un dropout por adaptador sobre su entrada; con p = 0 es la identidad' } });
  }
  // lora_a: A, Linear d_in → r sin sesgo (entrenable; PEFT la inicia Kaiming-uniforme, el paper gaussiana). o = {r, rSym='r'}
  function lora_a(x, o) {
    const r = linear(x, { dout: o.r, doutSym: o.rSym || 'r', bias: false });
    r.prim = 'lora_a';
    r.detail = Object.assign({}, r.detail, { r: o.r, trainable: true, init: 'Kaiming-uniforme (PEFT, init_lora_weights = True) · gaussiana (paper)' });
    return r;
  }
  // lora_b: B, Linear r → d_out sin sesgo (entrenable; empieza en CERO: el modelo arranca igual al base). o = {dout, doutSym}
  function lora_b(x, o) {
    const r = linear(x, { dout: o.dout, doutSym: o.doutSym || String(o.dout), bias: false });
    r.prim = 'lora_b';
    r.detail = Object.assign({}, r.detail, { trainable: true, init: 'ceros (ΔW = BA = 0 al empezar)' });
    return r;
  }
  // lora_scale: multiplica por α/r (escalar fijo, no se entrena). o = {alpha, r}
  function lora_scale(x, o) {
    return result('lora_scale', [x], plain(x), { other: elems(x) * OTHER.scale, detail: { alpha: o.alpha, r: o.r, scaling: o.alpha / o.r } });
  }
  // lora_linear (compuesta): el camino del adaptador A → B → ×α/r sobre x (N×d_in) → ΔW·x (N×d_out). SOLO cuenta lo
  // entrenable: parámetros r·(d_in + d_out), MACs N·r·(d_in + d_out). La rama congelada W₀x (d_in·d_out parámetros,
  // N·d_in·d_out MACs) va en detail.frozenParams / frozenMacs; mergedParams = d_in·d_out (tras fusionar no queda nada extra).
  // o = {dout, doutSym, r, alpha, rSym}
  function lora_linear(x, o) {
    const din = x.num[x.num.length - 1], dinSym = x.sym[x.sym.length - 1];
    const rows = prod(x.num.slice(0, -1));
    const a = lora_a(x, { r: o.r, rSym: o.rSym });
    const b = lora_b(a.out, { dout: o.dout, doutSym: o.doutSym });
    const s = lora_scale(b.out, { alpha: o.alpha, r: o.r });
    const rs = symTexFactor(o.rSym || 'r'), di = symTexFactor(dinSym), dout = symTexFactor(o.doutSym || String(o.dout));
    const n = x.sym.slice(0, -1).map(symTexFactor).join('\\,');
    const r = composite('lora_linear', x, [a, b, s], s.out, {
      paramTex: rs + '\\,(' + di + ' + ' + dout + ')', macTex: (n ? n + '\\,' : '') + rs + '\\,(' + di + ' + ' + dout + ')',
      detail: { r: o.r, alpha: o.alpha, scaling: o.alpha / o.r, din, dout: o.dout, frozenParams: din * o.dout, frozenMacs: rows * din * o.dout,
        mergedParams: din * o.dout, trainableParams: o.r * (din + o.dout),
        note: 'y = W₀x + (α/r)·B(Ax); W₀ congelada. Tras entrenar: W = W₀ + (α/r)·BA (misma forma, sin costo extra en inferencia).' },
    });
    r.paramArith = o.r + '·(' + din + ' + ' + o.dout + ') = ' + int(r.params);
    r.macArith = (rows > 1 ? rows + '·' : '') + o.r + '·(' + din + ' + ' + o.dout + ') = ' + int(r.macs);
    return r;
  }
  // quant_storage: bytes de guardar n pesos de UNA matriz a `bits` (contabilidad, no es una op del grafo). → {bytes, dataBytes,
  // constBytes, bitsPerParam, constBitsPerParam, detail}. o = {bits: 32|16|8|4, rows (d_out, para int8), block = 64,
  // absmaxBits = 32, dq = false, dqBits = 8, dqBlock = 256}
  // - 32 / 16 bits: n·bits/8, sin constantes.
  // - 8 bits (LLM.int8 de bitsandbytes, Dettmers et al. 2022, arXiv:2208.07339): int8 por elemento + un absmax fp32 por FILA
  //   de salida (SCB): n + 4·rows.
  // - 4 bits (NF4 de QLoRA, Dettmers et al., NeurIPS 2023, arXiv:2305.14314, §3; bitsandbytes quantize_4bit): 4 bits por
  //   elemento + un absmax por bloque de 64. Sin doble cuantización: absmax fp32 → 32/64 = 0.5 bits por parámetro. Con doble
  //   cuantización (compress_statistics): los absmax se guardan en 8 bits (bloques de 256, menos su media: 1 offset fp32 por
  //   matriz) + 1 absmax fp32 por bloque de 256 → 8/64 + 32/(64·256) = 0.127 bits por parámetro (paper: "from 0.5 to 0.127").
  //   No cuenta los códigos (16 valores NF4 y el mapa dinámico de 256): son tablas compartidas, no por matriz.
  function quant_storage(n, o) {
    o = o || {};
    const bits = o.bits || 16;
    if (!(Number.isInteger(n) && n > 0)) throw new Error('quant_storage: n debe ser un entero positivo.');
    let dataBytes, constBytes = 0, detail;
    if (bits === 16 || bits === 32) {
      dataBytes = n * bits / 8;
      detail = { scheme: bits === 16 ? 'bf16' : 'fp32' };
    } else if (bits === 8) {
      if (!o.rows) throw new Error('quant_storage: con 8 bits hace falta rows (filas de salida: un absmax por fila).');
      dataBytes = n;
      constBytes = 4 * o.rows;
      detail = { scheme: 'LLM.int8 (int8 + absmax fp32 por fila)', rows: o.rows };
    } else if (bits === 4) {
      const block = o.block || 64, ab = o.absmaxBits || 32;
      const blocks = Math.ceil(n / block);
      dataBytes = Math.ceil(n / 2);
      if (o.dq) {
        const qb = o.dqBits || 8, b2 = o.dqBlock || 256;
        const blocks2 = Math.ceil(blocks / b2);
        constBytes = blocks * qb / 8 + blocks2 * 4 + 4;
        detail = { scheme: 'NF4 + doble cuantización', block, blocks, absmaxBits: qb, dqBlock: b2, blocks2, offsetBytes: 4 };
      } else {
        constBytes = blocks * ab / 8;
        detail = { scheme: 'NF4', block, blocks, absmaxBits: ab };
      }
    } else {
      throw new Error('quant_storage: bits debe ser 4, 8, 16 o 32 (recibí ' + bits + ').');
    }
    return { n, bits, dataBytes, constBytes, bytes: dataBytes + constBytes, bitsPerParam: 8 * (dataBytes + constBytes) / n, constBitsPerParam: 8 * constBytes / n, detail };
  }
  // scalar_head: Linear D → 1 sin sesgo sobre cada fila (cabeza de recompensa o de valor: LlamaForSequenceClassification con
  // num_labels = 1, `score`). Parámetros D; MACs N·D. o = {role}
  function scalar_head(x, o) {
    const r = linear(x, { dout: 1, doutSym: '1', bias: false });
    r.prim = 'scalar_head';
    r.detail = Object.assign({}, r.detail, { role: (o && o.role) || null });
    return r;
  }
  // token_logprobs: log-softmax sobre V y tomar el log-prob del token real en cada una de las `rows` posiciones de la respuesta
  // (logits T×V → rows). o.sum: además suma por secuencia (DPO: un log π(y|x) por secuencia) → vector de 1. ≈ 5·rows·V "otros".
  // o = {rows, sym, sum}
  function token_logprobs(logits, o) {
    const V = logits.num[logits.num.length - 1], rows = o.rows;
    const out = o.sum ? shape(['1'], [1], logits.mod, 'vec') : shape([o.sym || String(rows)], [rows], logits.mod, 'vec');
    return result('token_logprobs', [logits], out, { other: rows * (V * OTHER.softmax + 1) + (o.sum ? rows : 0), detail: { V, rows, sum: !!o.sum } });
  }
  // kl_penalty: KL por token entre la política y la referencia a partir de los log-probs muestreados. o.estimator: 'k1'
  // (log π − log π_ref: InstructGPT / TRL PPO) o 'k3' (π_ref/π − log(π_ref/π) − 1, sin sesgo y ≥ 0: GRPO, Schulman 2020).
  function kl_penalty(logp, ref, o) {
    const est = (o && o.estimator) || 'k1';
    return result('kl_penalty', [logp, ref], plain(logp), { other: elems(logp) * (est === 'k3' ? 4 : 1), detail: { estimator: est, beta: (o && o.beta) || null } });
  }
  // shaped_reward: r_t = −β·KL_t en cada token y + r_φ(x, y) en el último (InstructGPT §3.5; TRL PPO). o = {beta}
  function shaped_reward(kl, reward, o) {
    return result('shaped_reward', [kl, reward], plain(kl), { other: 2 * elems(kl) + 1, detail: { beta: (o && o.beta) || null } });
  }
  // gae: ventajas con GAE (Schulman et al. 2016, arXiv:1506.02438): δ_t = r_t + γV_{t+1} − V_t, Â_t = Σ (γλ)^k δ_{t+k};
  // retornos = Â + V. → [ventajas, retornos] (rows cada uno). o = {gamma, lambda}
  function gae(rewards, values, o) {
    const n = rewards.num[0], s = rewards.sym[0];
    return result('gae', [rewards, values], [shape([s], [n], rewards.mod, 'vec'), shape([s], [n], rewards.mod, 'vec')], {
      other: 6 * n, detail: { gamma: o && o.gamma != null ? o.gamma : null, lambda: o && o.lambda != null ? o.lambda : null },
    });
  }
  // group_advantage (GRPO, Shao et al. 2024, arXiv:2402.03300): Â_i = (r_i − media(r)) / std(r) sobre las G respuestas del
  // mismo prompt (sin crítico). ≈ 4 ops por respuesta.
  function group_advantage(rewards, o) {
    return result('group_advantage', [rewards], plain(rewards), { other: 4 * elems(rewards), detail: { G: rewards.num[0] } });
  }
  // ppo_clip_loss: −E[min(ρ_t Â_t, clip(ρ_t, 1 − ε, 1 + ε) Â_t)], ρ_t = exp(log π − log π_old) (Schulman et al. 2017,
  // arXiv:1707.06347). → escalar. o = {eps, kind: 'ppo'|'grpo'}
  function ppo_clip_loss(logp, adv, o) {
    const ins = [logp, adv].concat(o && o.kl ? [o.kl] : []);
    return result('ppo_clip_loss', ins, shape(['1'], [1], logp.mod, 'vec'), { other: 8 * elems(logp), detail: { eps: (o && o.eps) || 0.2, kind: (o && o.kind) || 'ppo' } });
  }
  // value_loss: ½·máx((V − R)², (clip(V, V_old ± ε) − R)²) promediado (crítico de PPO). → escalar. o = {eps}
  function value_loss(values, returns, o) {
    return result('value_loss', [values, returns], shape(['1'], [1], values.mod, 'vec'), { other: 6 * elems(returns), detail: { eps: (o && o.eps) || 0.2 } });
  }
  // bt_loss: Bradley-Terry del modelo de recompensa: P(y_w ≻ y_l) = σ(r_w − r_l); pérdida −log σ(r_w − r_l). → escalar.
  function bt_loss(rw, rl) {
    return result('bt_loss', [rw, rl], shape(['1'], [1], rw.mod, 'vec'), { other: 4, detail: { formula: '−log σ(r_w − r_l)' } });
  }
  // dpo_loss (Rafailov et al., NeurIPS 2023, arXiv:2305.18290, ec. 7): −log σ(β·[(log π(y_w) − log π_ref(y_w)) −
  // (log π(y_l) − log π_ref(y_l))]). Entradas: log-probs por secuencia (elegida, rechazada) de la política y de la referencia.
  function dpo_loss(pi, ref, o) {
    return result('dpo_loss', [pi, ref], shape(['1'], [1], pi.mod, 'vec'), { other: 8, detail: { beta: (o && o.beta) || 0.1 } });
  }

  // ---- Fase 11 (BERT, recuperación densa, ANN; modelos en js/arch/retrieval.js) ----------------------------------------
  // tanh (pooler de BERT): ≈ 5 ops por elemento en "otros".
  const tanh = (x) => elementwise('tanh', x, OTHER.tanh);
  // mean_pool (Sentence-BERT; all-MiniLM-L6-v2 usa pooling_mode_mean_tokens): Σ_t m_t·x_t / Σ_t m_t sobre las T filas
  // (m = máscara de atención; sin relleno, todas 1): T×D → D. Sin parámetros ni MACs: ≈ 2·T·D + D "otros".
  function mean_pool(x, o) {
    const T = x.num[0], D = x.num[1];
    return result('mean_pool', [x], shape([(o && o.sym) || x.sym[1]], [D], x.mod, 'vec'), {
      other: 2 * T * D + D, detail: { T, D, note: 'promedio de los T vectores de token (con la máscara de atención: el relleno no cuenta)' },
    });
  }
  // pooler (compuesta; BertPooler de HF): tanh(W·h_[CLS] + b), D → D sobre la fila 0. En el grafo: pool_cls → linear → tanh.
  function pooler(x) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1], d = symTexFactor(Ds);
    const c = pool_cls(x), l = linear(c.out, { dout: D, doutSym: Ds }), t = tanh(l.out);
    return composite('pooler', x, [c, l, t], t.out, { paramTex: d + '^2 + ' + d, macTex: d + '^2', detail: { D, note: 'solo la fila [CLS]: D² MACs, no T·D²' } });
  }
  // tied_decoder (decoder del MLM de BERT): logits = h·E_tokᵀ + b. La matriz es la tabla de word embeddings (pesos ATADOS:
  // ya contados en el embedding) y solo el sesgo de V es propio. Parámetros V; MACs T·D·V. o = {V, Vsym = 'V', tiedWith}
  function tied_decoder(x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    const rows = x.num.slice(0, -1), rowsSym = x.sym.slice(0, -1);
    const V = o.V, Vs = o.Vsym || 'V';
    return result('tied_decoder', [x], shape(rowsSym.concat([Vs]), rows.concat([V]), x.mod, x.layout), {
      paramTerms: [[V]], paramTex: symTexFactor(Vs) + '\\ (\\text{sesgo; } W = E_{\\mathrm{tok}}^{\\top}\\text{, atada})',
      macTerms: [rows.concat([D, V])], macTex: texProd(rowsSym.concat([Ds, Vs])), other: prod(rows) * V * OTHER.bias,
      detail: { V, D, tied: o.tiedWith || 'word embeddings', tiedParams: V * D, note: 'pesos atados a la tabla de tokens: no se cuentan dos veces' },
    });
  }
  // mlm_head (compuesta; BertLMPredictionHead): dense D → D → GELU → LayerNorm → tied_decoder (D → V, sesgo V).
  // Parámetros D² + D + 2D + V; MACs T·D² + T·D·V. o = {V, Vsym}
  function mlm_head(x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1], d = symTexFactor(Ds), v = symTexFactor(o.Vsym || 'V');
    const n = x.sym.slice(0, -1).map(symTexFactor).join('\\,');
    const dn = linear(x, { dout: D, doutSym: Ds }), gl = gelu(dn.out), ln = layernorm(gl.out), dec = tied_decoder(ln.out, o);
    return composite('mlm_head', x, [dn, gl, ln, dec], dec.out, {
      paramTex: d + '^2 + 3' + d + ' + ' + v, macTex: n + '\\,' + d + '^2 + ' + n + '\\,' + d + '\\,' + v,
      detail: { V: o.V, note: 'el decoder comparte la matriz con los word embeddings; solo su sesgo es nuevo' },
    });
  }
  // nsp_head (BERT, next sentence prediction): Linear D → 2 sobre la salida del pooler. Parámetros 2D + 2.
  function nsp_head(x) {
    const r = linear(x, { dout: 2, doutSym: '2' });
    r.prim = 'nsp_head';
    r.detail = Object.assign({}, r.detail, { classes: ['IsNext', 'NotNext'] });
    return r;
  }
  // score_head (cross-encoder; BertForSequenceClassification con num_labels = 1): Linear D → 1 CON sesgo sobre la salida del
  // pooler → un escalar de relevancia. Parámetros D + 1. (scalar_head, de la fase 10, es la versión sin sesgo del reward model.)
  function score_head(x) {
    const r = linear(x, { dout: 1, doutSym: '1' });
    r.prim = 'score_head';
    r.detail = Object.assign({}, r.detail, { note: 'relevancia del par (query, documento): un número, sin softmax' });
    return r;
  }
  // cross_entropy: −log softmax(logits)[etiqueta] promediado sobre `rows` posiciones (MLM: solo los tokens elegidos; NSP: 1).
  // → escalar. Solo "otros": rows·(5·C + 1). Entradas: logits (…×C) y etiquetas. o = {rows}
  function cross_entropy(logits, labels, o) {
    const C = logits.num[logits.num.length - 1], rows = (o && o.rows) || prod(logits.num.slice(0, -1)) || 1;
    return result('cross_entropy', [logits, labels], shape(['1'], [1], logits.mod, 'vec'), { other: rows * (C * OTHER.softmax + 1), detail: { C, rows } });
  }
  // dot_score: producto punto de un vector q (D) contra M vectores (M×D) → M (o contra uno, D → 1). MACs M·D. Con vectores
  // normalizados (l2_normalize antes) es el coseno. o = {metric: 'ip' | 'cos'}
  function dot_score(q, X, o) {
    const D = q.num[q.num.length - 1], Ds = q.sym[q.sym.length - 1];
    if (X.num[X.num.length - 1] !== D) throw new Error('dot_score: dimensiones distintas (' + D + ' y ' + X.num[X.num.length - 1] + ').');
    const one = X.num.length === 1;
    const M = one ? 1 : prod(X.num.slice(0, -1)), Ms = one ? '1' : X.sym.slice(0, -1).join('·');
    return result('dot_score', [q, X], shape([Ms], [M], q.mod, 'vec'), {
      macTerms: [one ? [D] : [M, D]], macTex: one ? symTexFactor(Ds) : texProd([Ms, Ds]),
      detail: { M, D, metric: (o && o.metric) || 'ip', note: 'un producto punto de D MACs por vector comparado' },
    });
  }
  // token_sim (ColBERT, interacción tardía): similitud de cada token de la query con cada token del documento:
  // T_q×D, T_d×D → T_q×T_d. MACs T_q·T_d·D (sin parámetros).
  function token_sim(q, d) {
    if (q.num[1] !== d.num[1]) throw new Error('token_sim: dimensiones distintas (' + q.num[1] + ' y ' + d.num[1] + ').');
    return result('token_sim', [q, d], shape([q.sym[0], d.sym[0]], [q.num[0], d.num[0]], q.mod, 'mat'), {
      macTerms: [[q.num[0], d.num[0], q.num[1]]], macTex: texProd([q.sym[0], d.sym[0], q.sym[1]]), detail: { Tq: q.num[0], Td: d.num[0], D: q.num[1] },
    });
  }
  // max_reduce: máximo por fila R×C → R (ColBERT: el mejor token del documento para cada token de la query). ≈ R·C comparaciones.
  function max_reduce(x) {
    return result('max_reduce', [x], shape([x.sym[0]], [x.num[0]], x.mod, 'vec'), { other: elems(x) * OTHER.max, detail: { over: x.num[1] } });
  }
  // sum_reduce: suma de un vector R → 1 (ColBERT: Σ sobre los tokens de la query). R − 1 sumas (≈ R).
  function sum_reduce(x) {
    return result('sum_reduce', [x], shape(['1'], [1], x.mod, 'vec'), { other: elems(x) * OTHER.add, detail: { over: elems(x) } });
  }
  // maxsim (compuesta, ColBERT, Khattab & Zaharia 2020, ec. 3): s(q, d) = Σ_i máx_j q_i·d_jᵀ. MACs T_q·T_d·D.
  function maxsim(q, d) {
    const s = token_sim(q, d), m = max_reduce(s.out), u = sum_reduce(m.out);
    return composite('maxsim', q, [s, m, u], u.out, { paramTex: '0', macTex: texProd([q.sym[0], d.sym[0], q.sym[1]]), detail: { Tq: q.num[0], Td: d.num[0] } });
  }
  // topk_scores: los k mayores de N puntajes → k índices (heap / argpartition: ≈ N comparaciones, sin MACs). o = {k, kSym = 'k'}
  function topk_scores(x, o) {
    const N = elems(x), k = o.k;
    if (k > N) throw new Error('topk_scores: k = ' + k + ' es mayor que los ' + N + ' candidatos.');
    return result('topk_scores', [x], shape([o.kSym || 'k'], [k], x.mod, 'vec'), { other: N * OTHER.topk, detail: { N, k } });
  }
  // truncate_dim (Matryoshka, Kusupati et al., NeurIPS 2022, arXiv:2205.13147): quedarse con las primeras dim coordenadas
  // (…×D → …×dim). Sin costo (una vista). o = {dim, dimSym = 'dim'}
  function truncate_dim(x, o) {
    const D = x.num[x.num.length - 1];
    if (!(o.dim >= 1 && o.dim <= D)) throw new Error('truncate_dim: dim = ' + o.dim + ' debe estar entre 1 y ' + D + '.');
    return result('truncate_dim', [x], shape(x.sym.slice(0, -1).concat([o.dimSym || 'dim']), x.num.slice(0, -1).concat([o.dim]), x.mod, x.layout), { detail: { from: D, to: o.dim } });
  }
  // embed_index: el índice offline = los vectores de los N documentos guardados (x es el de UN documento: D o T_d×D) →
  // N×(…). Sin parámetros ni MACs (el costo de codificar está en el encoder × N); detail.bytes a `bits` por número.
  // o = {N, Nsym = 'N', bits = 32}
  function embed_index(x, o) {
    const bits = o.bits || 32, n = o.N * elems(x);
    return result('embed_index', [x], shape([o.Nsym || 'N'].concat(x.sym), [o.N].concat(x.num), x.mod, x.num.length ? 'seq' : 'vec'), {
      detail: { N: o.N, bits, values: n, bytes: n * bits / 8, note: 'offline: se calcula una vez por documento y se guarda' },
    });
  }
  // mlm_mask (BERT, Devlin et al. 2019, §3.1 y create_pretraining_data.py): elige ≈ 15 % de las posiciones (o.predictions; el README
  // de google-research/bert: max_predictions_per_seq ≈ max_seq_length·masked_lm_prob, 20 con 128); de ellas 80 % → [MASK], 10 % → un
  // token al azar y 10 % quedan igual. ids (T) → [ids de entrada (T), etiquetas (T: el id original en las elegidas, −100 / ignoradas
  // en el resto)]. Solo "otros" (≈ 2T: sorteo y reemplazo). o = {rate = 0.15, predictions}
  function mlm_mask(ids, o) {
    const T = ids.num[0], rate = (o && o.rate) || 0.15, n = (o && o.predictions) || Math.ceil(rate * T);
    return result('mlm_mask', [ids], [plain(ids), plain(ids)], {
      other: 2 * T, detail: { rate, predictions: n, mask: 0.8, random: 0.1, keep: 0.1, note: '80 % [MASK] · 10 % token al azar · 10 % sin cambio' },
    });
  }
  // pair_tokens (cross-encoder): arma la entrada de un par: [CLS] query [SEP] documento [SEP]. q (T_q, con su [CLS] y [SEP]) y
  // un candidato del top-k (cand: k ids de documento) → T_q + T_d − 1 ids (el [CLS] del documento sobra). Sin costo; se repite por
  // cada uno de los k pares. o = {Td, T?, sym = 'T_q+T_d-1'}: T (opcional) = largo del par ya truncado a las posiciones del
  // cross-encoder (512: se recorta el documento, truncation = 'only_second' de HF / CrossEncoder con max_length 512).
  function pair_tokens(q, cand, o) {
    const T = o.T != null ? o.T : q.num[0] + o.Td - 1;
    return result('pair_tokens', [q, cand], shape([o.sym || 'T_q+T_d-1'], [T], q.mod, 'vec'), { detail: { Tq: q.num[0], Td: o.Td, note: '[CLS] query [SEP] documento [SEP]' } });
  }
  // ---- ANN (contabilidad de costo de búsqueda; FAISS 1.15: Johnson et al., arXiv:1702.08734; Douze et al., arXiv:2401.08281) ----
  // flat_scan (IndexFlatIP / IndexFlatL2): q (d) contra los N vectores (N×d) → N distancias. MACs N·d, N distancias exactas.
  // L2 vía BLAS: ‖q‖² + ‖x‖² − 2q·x (FAISS recalcula ‖x‖² en cada búsqueda: + N·d "otros"). o = {metric: 'ip' | 'l2'}
  function flat_scan(q, X, o) {
    const r = dot_score(q, X, o);
    const l2 = o && o.metric === 'l2';
    r.prim = 'flat_scan';
    r.other = l2 ? X.num[0] * X.num[1] + 2 * X.num[0] : 0;
    r.detail = Object.assign({}, r.detail, { distances: X.num[0], exact: true, metric: l2 ? 'l2' : 'ip' });
    return r;
  }
  // Niveles de HNSW sobre el 0 (Malkov & Yashunin, TPAMI 2020, arXiv:1603.09320): el nivel de cada nodo sigue una geométrica con
  // m_L = 1/ln M (P(nivel ≥ l) = M^−l; FAISS: assign_probas con levelMult = 1/ln M) → el nivel máximo esperado es ≈ log_M N.
  const hnswLevels = (N, M) => Math.max(0, Math.floor(Math.log(N) / Math.log(M)));
  // hnsw_descent: búsqueda voraz por los niveles superiores (ef = 1): ≈ un salto por nivel, cada uno compara ≤ M vecinos →
  // ≈ niveles·M distancias (≈; cota de orden). → el punto de entrada al nivel 0. o = {N, M}
  function hnsw_descent(q, X, o) {
    const d = q.num[0], ds = q.sym[0], lv = hnswLevels(o.N, o.M), dist = lv * o.M;
    return result('hnsw_descent', [q, X], shape(['1'], [1], q.mod, 'vec'), {
      macTerms: dist ? [[lv, o.M, d]] : [], macTex: dist ? '\\lfloor\\log_M N\\rfloor\\cdot M\\cdot ' + symTexFactor(ds) : '0', other: dist,
      detail: { levels: lv, distances: dist, estimate: true, note: '≈: voraz, ~1 salto por nivel de ≤ M vecinos; el costo real depende de los datos' },
    });
  }
  // hnsw_beam: búsqueda en el nivel 0 con una lista de ef candidatos (efSearch): cada candidato expandido revisa ≤ 2M vecinos →
  // ≈ ef·2M distancias (≈, ESTIMACIÓN, no cota: los ya visitados no se recalculan, pero la búsqueda puede expandir más de ef nodos;
  // medido con FAISS 1.15 sobre datos sintéticos: 0.44–1.02× esta estimación). → ef candidatos ordenados. o = {ef, M, efSym = 'ef'}
  function hnsw_beam(q, entry, X, links, o) {
    const d = q.num[0], ds = q.sym[0], dist = o.ef * 2 * o.M;
    return result('hnsw_beam', [q, entry, X, links], shape([o.efSym || 'ef'], [o.ef], q.mod, 'vec'), {
      macTerms: [[o.ef, 2 * o.M, d]], macTex: symTexFactor(o.efSym || 'ef') + '\\cdot 2M\\cdot ' + symTexFactor(ds), other: dist * OTHER.topk,
      detail: { ef: o.ef, M: o.M, distances: dist, estimate: true, note: '≈ estimación: ef expansiones × 2M vecinos del nivel 0 (los visitados se saltan; medido 0.44–1.02×)' },
    });
  }
  // ivf_coarse: cuantizador grueso del IVF: q contra los n_list centroides de k-means (n_list×d, aprendidos: son sus parámetros) →
  // n_list distancias. Plano: MACs n_list·d. Con un HNSW sobre los centroides (o.hnsw = {M, ef, efSym = 'ef'}; FAISS IVF…_HNSW32):
  // ≈ (niveles·M + ef·2M)·d y la salida son los ef centroides candidatos del HNSW (no las n_list distancias: solo se calculan ~ef·2M).
  // o = {nlist, nlistSym = 'n_list', hnsw}
  function ivf_coarse(q, o) {
    const d = q.num[0], ds = q.sym[0], ls = o.nlistSym || 'n_list';
    const h = o.hnsw;
    const dist = h ? hnswLevels(o.nlist, h.M) * h.M + h.ef * 2 * h.M : o.nlist;
    const out = h ? shape([h.efSym || 'ef'], [h.ef], q.mod, 'vec') : shape([ls], [o.nlist], q.mod, 'vec');
    return result('ivf_coarse', [q], out, {
      paramTerms: [[o.nlist, d]], paramTex: texProd([ls, ds]),
      macTerms: [[dist, d]], macTex: h ? '(\\lfloor\\log_M n_{\\mathrm{list}}\\rfloor M + ef\\cdot 2M)\\cdot ' + symTexFactor(ds) : texProd([ls, ds]),
      other: dist,
      detail: { nlist: o.nlist, distances: dist, quantizer: h ? 'HNSW' + h.M : 'flat', estimate: !!h, note: h ? '≈: búsqueda HNSW sobre los centroides (solo se calculan ~' + int(dist) + ' de ' + int(o.nlist) + ' distancias)' : 'k-means: n_list centroides de d floats' },
    });
  }
  // ivf_residual: el residuo q − c_i contra cada una de las n_probe listas elegidas (IVFPQ by_residual = True, el default de FAISS)
  // → n_probe×d. Solo "otros" (restas). o = {nprobe, nprobeSym = 'n_probe'}
  function ivf_residual(q, probe, o) {
    const d = q.num[0];
    return result('ivf_residual', [q, probe], shape([o.nprobeSym || 'n_probe', q.sym[0]], [o.nprobe, d], q.mod, 'seq'), { other: o.nprobe * d, detail: { nprobe: o.nprobe } });
  }
  // pq_lut: tablas de la distancia asimétrica (ADC, Jégou et al., TPAMI 2011): para cada lista elegida, la distancia de cada
  // sub-vector del residuo a los k_s = 2^nbits centroides de su sub-espacio → n_probe×m×k_s. Parámetros: los codebooks de PQ
  // (m·k_s·d/m = k_s·d floats). MACs: con la tabla precalculada de FAISS (use_precomputed_table, si cabe en 2 GB: n_list·m·k_s
  // floats) solo el término q·c de la query, k_s·d; sin ella, n_probe·k_s·d. o = {m, nbits, nprobe, precomputed, nprobeSym}
  function pq_lut(r, o) {
    const d = r.num[r.num.length - 1], ds = r.sym[r.sym.length - 1], ks = Math.pow(2, o.nbits);
    if (d % o.m !== 0) throw new Error('pq_lut: d = ' + d + ' no es divisible por m = ' + o.m + '.');
    const pre = !!o.precomputed, np = o.nprobe;
    return result('pq_lut', [r], shape([o.nprobeSym || 'n_probe', 'm', 'k_s'], [np, o.m, ks], r.mod, 'seq'), {
      paramTerms: [[ks, d]], paramTex: 'k_s\\cdot ' + symTexFactor(ds),
      macTerms: [pre ? [ks, d] : [np, ks, d]], macTex: pre ? 'k_s\\cdot ' + symTexFactor(ds) : texProd([o.nprobeSym || 'n_probe', 'k_s', ds]),
      other: np * o.m * ks * (pre ? 2 : 1),
      detail: { m: o.m, nbits: o.nbits, ksub: ks, dsub: d / o.m, precomputed: pre, note: pre ? 'tabla precalculada: por lista solo se suman términos guardados' : 'una tabla por lista elegida' },
    });
  }
  // pq_scan: recorrer los códigos de las n_probe listas: cada código son m bytes (nbits = 8) → m lecturas de la tabla + m sumas,
  // sin MACs. → una distancia aproximada por vector recorrido. o = {scanned, sym}
  function pq_scan(lut, codes, o) {
    const m = lut.num[1];
    return result('pq_scan', [lut, codes], shape([o.sym || 'n_scan'], [o.scanned], lut.mod, 'vec'), {
      other: o.scanned * m * 2, detail: { scanned: o.scanned, lookupsPerCode: m, distances: o.scanned, note: 'ADC: m consultas a la tabla por código; 0 MACs' },
    });
  }
  // Contabilidad de bytes de índices (no son ops del grafo; como quant_storage). Fórmulas verificadas con faiss 1.15.1
  // (serialize_index; crosscheck/retrieval.py ann_checks).
  // flat_bytes: N·d·bits/8 (IndexFlat fp32; 16 / 8 bits = IndexScalarQuantizer fp16 / SQ8, que añade 2·d floats de rango).
  function flat_bytes(o) {
    const bits = o.bits || 32, vectors = o.N * o.d * bits / 8, sq = bits < 32 && bits !== 16 ? 2 * o.d * 4 : 0;
    return { vectors, sqTrained: sq, total: vectors + sq, perVector: o.d * bits / 8 };
  }
  // hnsw_bytes (IndexHNSWFlat / HNSWSQ): vectores N·d·bits/8 + enlaces int32: el nivel 0 tiene 2M por nodo y cada nivel superior
  // M; con P(nivel ≥ l) = M^−l, la ESPERANZA es N·(2M + M/(M − 1)) enlaces (≈) + levels (int32 por nodo) + offsets (size_t,
  // N + 1). Regla del wiki de FAISS ("Guidelines to choose an index"): (d·4 + M·2·4) bytes por vector.
  function hnsw_bytes(o) {
    const bits = o.bits || 32, M = o.M, N = o.N;
    const vectors = N * o.d * bits / 8, linksPerVector = 2 * M + M / (M - 1);
    const links = Math.round(4 * N * linksPerVector), levels = 4 * N, offsets = 8 * (N + 1);
    return { vectors, links, levels, offsets, total: vectors + links + levels + offsets, linksPerVector, wiki: N * (o.d * 4 + M * 2 * 4), estimate: true };
  }
  // ivfpq_bytes (IndexIVFPQ): códigos N·m·nbits/8 + ids de 64 bits en las listas invertidas (8·N) + centroides n_list·d fp32 +
  // codebooks de PQ k_s·d fp32 + tamaños de lista (8·n_list). precomputedTable (en RAM, no se serializa): n_list·m·k_s floats si
  // cabe en 2 GB (precomputed_table_max_bytes de FAISS). Con cuantizador HNSW (o.coarseM): + los enlaces del HNSW de los centroides.
  function ivfpq_bytes(o) {
    const ks = Math.pow(2, o.nbits), N = o.N;
    const codes = N * o.m * o.nbits / 8, ids = 8 * N, centroids = o.nlist * o.d * 4, codebooks = ks * o.d * 4, listSizes = 8 * o.nlist;
    const coarseLinks = o.coarseM ? hnsw_bytes({ N: o.nlist, d: o.d, M: o.coarseM }).links + 12 * o.nlist + 8 : 0;
    const pt = o.nlist * o.m * ks * 4;
    return { codes, ids, centroids, codebooks, listSizes, coarseLinks, total: codes + ids + centroids + codebooks + listSizes + coarseLinks,
      precomputedTable: pt <= 2147483648 ? pt : 0, precomputedFits: pt <= 2147483648, perVector: o.m * o.nbits / 8 + 8 };
  }

  // ---- Fase 12 (encoder-decoder: T5, Whisper; modelos en js/arch/encdec.js) -------------------------------------------
  // conv1d sobre una secuencia T×C (channels-last; PyTorch Conv1d usa C×T). Front end de Whisper: dos convs k = 3 con
  // padding 1, la segunda con stride 2 (3,000 → 1,500 frames). o = {k, s=1, p=0, cout, coutSym, kSym, outSym, bias=true}.
  // T_o = ⌊(T + 2p − k)/s⌋ + 1 (redondeo de PyTorch). Parámetros k·C_in·C_out + C_out; MACs T_o·C_out·k·C_in.
  function conv1d(x, o) {
    if (x.num.length !== 2) throw new Error('conv1d espera una entrada T×C.');
    const [T, C] = x.num, Cs = x.sym[1];
    const k = o.k, s = o.s || 1, p = o.p || 0, bias = o.bias !== false;
    if (T + 2 * p < k) throw new Error('conv1d: la secuencia (' + T + ' + 2·' + p + ') es más corta que el kernel ' + k + '.');
    const To = Math.floor((T + 2 * p - k) / s) + 1;
    const cout = o.cout, coutSym = o.coutSym || String(cout), kSym = o.kSym || String(k), outSym = o.outSym || String(To);
    const out = shape([outSym, coutSym], [To, cout], o.mod || x.mod, 'seq');
    return result('conv1d', [x], out, {
      paramTerms: [[k, C, cout]].concat(bias ? [[cout]] : []),
      paramTex: texProd([kSym, Cs, coutSym]) + (bias ? ' + ' + symTexFactor(coutSym) : ''),
      macTerms: [[To, cout, k, C]], macTex: texProd([outSym, coutSym, kSym, Cs]),
      other: bias ? To * cout * OTHER.bias : 0,
      detail: { k, s, p, T, To, cin: C, cout, bias },
    });
  }

  // t5RelativeBucket: bucket de una posición relativa (memoria − query), port EXACTO de T5Attention._relative_position_bucket
  // de HF (Mesh TF): la mitad de los buckets son distancias exactas (0 … max_exact − 1) y la otra mitad crece en escala
  // logarítmica hasta max_distance; todo lo que está más lejos cae en el último. Bidireccional (encoder): la mitad de los
  // buckets para cada signo. Unidireccional (decoder): solo el pasado (las posiciones futuras van al bucket 0, y la máscara
  // causal las anula). HF calcula el logaritmo en float32: Math.fround lo imita (con 32 buckets y distancia máxima 128 da lo
  // mismo que float64 en −2,000…2,000; crosscheck/encdec.py lo compara bucket por bucket con HF).
  function t5RelativeBucket(rel, bidirectional, numBuckets, maxDistance) {
    const f = Math.fround;
    let nb = numBuckets, ret = 0, n;
    if (bidirectional) { nb = Math.floor(nb / 2); ret += rel > 0 ? nb : 0; n = Math.abs(rel); } else n = -Math.min(rel, 0);
    const maxExact = Math.floor(nb / 2);
    if (n < maxExact) return ret + n;
    const lg = f(f(Math.log(f(n / maxExact))) / f(Math.log(maxDistance / maxExact)));
    const v = maxExact + Math.trunc(f(lg * (nb - maxExact)));
    return ret + Math.min(v, nb - 1);
  }

  // t5_rel_bias (T5): sesgo de posición relativa B[i][q][k] = tabla[bucket(k − q)][i]. Tabla aprendida n_buckets × h (un
  // escalar por bucket y cabeza, sin MACs: es un lookup); se calcula UNA vez por stack (en la capa 1) y la reusan las L capas.
  // T5 no usa embeddings de posición absolutos: esto es toda la información de posición. o = {h, Tq, Tk, qSym, kSym, hSym='h',
  // buckets=32, maxDistance=128, bidirectional, pos0=0 (posición de la primera query: en decode, la del token nuevo)}.
  function t5_rel_bias(o) {
    const nbk = o.buckets || 32, md = o.maxDistance || 128, bi = !!o.bidirectional, pos0 = o.pos0 || 0;
    const out = shape([o.hSym || 'h', o.qSym, o.kSym], [o.h, o.Tq, o.Tk], o.mod || 'txt', 'heads');
    const used = new Set();
    for (let rel = -(pos0 + o.Tq - 1); rel <= o.Tk - 1 - pos0; rel++) used.add(t5RelativeBucket(rel, bi, nbk, md));
    return result('t5_rel_bias', [], out, {
      paramTerms: [[nbk, o.h]], paramTex: texProd([String(nbk), o.hSym || 'h']),
      other: o.Tq * o.Tk * 2,
      detail: { buckets: nbk, maxDistance: md, bidirectional: bi, bucketsUsed: used.size, exact: Math.floor((bi ? nbk / 2 : nbk) / 2),
        note: 'bucket(k − q): distancias chicas exactas, grandes en escala log hasta ' + md + '; un escalar por cabeza, sumado a QKᵀ' },
    });
  }
  // add_rel_bias (T5): scores + sesgo relativo (h×T_q×T_k), antes del softmax. T5 NO divide por √d_h (lo absorbe la init).
  const add_rel_bias = (scores, bias) => add(scores, bias, 'add_rel_bias');

  // pad_or_trim (Whisper): el audio (S muestras a 16 kHz) se rellena con ceros o se corta a 30 s = 480,000 muestras: el
  // encoder SIEMPRE ve 30 s. Sin parámetros ni MACs. o = {to, sym}
  function pad_or_trim(x, o) {
    const n = x.num[0];
    return result('pad_or_trim', [x], shape([o.sym || String(o.to)], [o.to], x.mod, 'vec'), {
      other: Math.max(0, o.to - n), detail: { from: n, to: o.to, padded: Math.max(0, o.to - n), trimmed: Math.max(0, n - o.to) },
    });
  }

  // log_mel (Whisper): STFT (ventana Hann de n_fft = 400 muestras = 25 ms, hop 160 = 10 ms) → |·|² → banco de n_mels filtros
  // mel → log10 → recorte a 8 dB del máximo y escala. Frames = S/hop (HF descarta el último frame del STFT): 480,000 / 160 =
  // 3,000. Es PREPROCESAMIENTO (el feature extractor, en NumPy): 0 MACs del modelo; su costo ≈ va en "otros" (FFT ≈ 5·n_fft·log₂
  // n_fft, potencia, filtros (n_fft/2 + 1)·n_mels, log). o = {nMels, nFft=400, hop=160, sr=16000, framesSym, melSym='n_mels'}
  function log_mel(x, o) {
    const nFft = o.nFft || 400, hop = o.hop || 160, sr = o.sr || 16000, bins = nFft / 2 + 1;
    const frames = Math.floor(x.num[0] / hop);
    const out = shape([o.framesSym || String(frames), o.melSym || 'n_mels'], [frames, o.nMels], o.mod || x.mod || 'aud', 'seq');
    const perFrame = Math.round(5 * nFft * Math.log2(nFft)) + 3 * bins + bins * o.nMels + 2 * o.nMels;
    return result('log_mel', [x], out, {
      other: frames * perFrame,
      detail: { sr, nFft, hop, winMs: 1000 * nFft / sr, hopMs: 1000 * hop / sr, frames, nMels: o.nMels, bins, melFilterMacs: frames * bins * o.nMels,
        note: 'preprocesamiento fuera del modelo (feature extractor): no cuenta en los MACs del forward' },
    });
  }

  const PRIMS = {
    linear, conv2d, layernorm, rmsnorm, gelu, embedding_lookup, pos_embed_learned, cls_token,
    concat_tokens, flatten, split_heads, merge_heads, attention_scores, scale, softmax,
    attention_weighted_sum, mhsa, mlp, add, residual_add, transformer_block, pool_cls, classifier_head,
    // Fase 2
    batchnorm2d, relu, maxpool2d, global_avg_pool, conv_bn, bottleneck, cyclic_shift, window_partition,
    window_reverse, rel_pos_bias, attn_mask, causal_mask, window_attention, patch_concat, patch_merging,
    causal_self_attention, pick_token, l2_normalize, stack_batch, similarity_logits, logit_scale, contrastive_loss,
    // Fase 3
    frozen_batchnorm2d, group_norm, sigmoid, sine_pos_encoding, level_embed, add_level_embed, flatten_levels,
    learned_queries, zeros_init, split_qkv_heads, reference_points, deform_sample, deform_weighted_sum, ref_offset,
    hungarian_cost, hungarian_match, set_prediction_loss, multihead_attention, cross_attention, deformable_attention, box_mlp,
    // Fase 4
    silu, upsample_nearest, concat_channels, split_channels, adaptive_max_pool, layer_scale, subsentence_mask, sine_pos_1d,
    box_sine_embed, encoder_proposals, contrastive_logits, topk_select, gather_rows, transpose_scores, token_mask,
    text_guided_scores, max_over_text, maxsig_gate, head_modulate, region_text_similarity, scale_bias, dfl_decode, dist2bbox,
    merge_level_logits, offline_text_encoder, conv_bn_act, csp_bottleneck, c2f, sppf, max_sigmoid_attn, t_csp_layer, image_pooling_attn, bi_attention,
    // Fase 5
    conv_transpose2d, depthwise_conv2d, window_partition_pad, window_unpartition, decomposed_rel_pos, query_pool, coord_grid, fourier_pe,
    append_pad_point, type_embed, learned_tokens, broadcast_embed, idle_params, rope_2d, take_rows, grouped_linear, hyper_dot, mask_select,
    pick_mask, upsample_bilinear, to_grid, split_tokens, repeat_rows, add_temporal_embed, pos_embed_grid, window_pos_embed, gate_embed,
    // Fase 6
    rope, split_gqa_heads, mul, lm_head, sample_token, kv_append, moe_router, moe_topk, expert_linear, moe_combine,
    swiglu, gqa_attention, llama_block, moe_ffn,
    // Fase 7
    repeat_frames, patch_embed_3d, flatten_nd, segment_rows, group_tokens, splice_tokens, mrope, mrope_ids,
    // Fase 8
    timestep_embedding, concat_features, label_embed, add_broadcast, downsample2d, geglu, adaln_zero, ada_modulate, ada_gate, sincos_pos_2d, unpatchify,
    latent_sample, latent_scale, add_noise, flow_target, cfg_combine, scheduler_step, mse_loss,
    resnet_block, upsample2d, geglu_ff, spatial_transformer, dit_block,
    // Fase 9
    normalize_pixels, prefix_tokens, broadcast_rows, prefix_mask, block_causal_mask, ar_decode, detokenize_actions,
    // Fase 10
    dropout, lora_a, lora_b, lora_scale, lora_linear, quant_storage, scalar_head, token_logprobs, kl_penalty, shaped_reward, gae,
    group_advantage, ppo_clip_loss, value_loss, bt_loss, dpo_loss,
    // Fase 11
    tanh, mean_pool, pooler, tied_decoder, mlm_head, nsp_head, score_head, cross_entropy, dot_score, token_sim, max_reduce, sum_reduce,
    maxsim, topk_scores, truncate_dim, embed_index, mlm_mask, pair_tokens, flat_scan, hnsw_descent, hnsw_beam, ivf_coarse, ivf_residual, pq_lut, pq_scan,
    flat_bytes, hnsw_bytes, ivfpq_bytes,
    // Fase 12
    conv1d, t5RelativeBucket, t5_rel_bias, add_rel_bias, pad_or_trim, log_mel,
  };

  // Tabla genérica de fórmulas (ref-formas). Símbolos de SPEC §6.2.
  const PRIM_INFO = [
    { id: 'linear', name: 'Linear', paramTex: 'D_{in}\\,D_{out} + D_{out}', macTex: 'N\\,D_{in}\\,D_{out}', outTex: 'N\\times D_{in} \\to N\\times D_{out}', note: 'El sesgo (+D_out) solo si la capa lo tiene. Es la mayoría de los MACs de un transformer.' },
    { id: 'conv2d', name: 'Conv2d', paramTex: 'k^2\\,C_{in}\\,C_{out} + C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}', outTex: 'H\\times W\\times C_{in} \\to H_o\\times W_o\\times C_{out}', note: 'Patchify = conv con k = s = P: H_o = H/P. Equivale a un Linear sobre cada parche aplanado (P²C → D).' },
    { id: 'layernorm', name: 'LayerNorm', paramTex: '2D', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'γ y β por canal. Sin MACs; ≈ 5 ops por elemento en "otros".' },
    { id: 'rmsnorm', name: 'RMSNorm', paramTex: 'D', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'Solo γ (sin centrar ni β).' },
    { id: 'gelu', name: 'GELU', paramTex: '0', macTex: '0', outTex: 'N\\times D_{\\mathrm{mlp}} \\to N\\times D_{\\mathrm{mlp}}', note: 'Elementwise; ≈ 8 ops por elemento (aprox. tanh) en "otros".' },
    { id: 'embedding_lookup', name: 'Embedding lookup', paramTex: 'V\\,D', macTex: '0', outTex: 'N \\to N\\times D', note: 'Indexar una tabla: parámetros sí, MACs no.' },
    { id: 'pos_embed_learned', name: 'Position embedding aprendido', paramTex: '(N{+}1)\\,D', macTex: '0', outTex: '\\to (N{+}1)\\times D', note: 'Tabla aprendida (parámetro). Si cambia la resolución, se interpola y cambia su tamaño. Un PE sinusoidal fijo es buffer, no parámetro.' },
    { id: 'cls_token', name: 'Token CLS', paramTex: 'D', macTex: '0', outTex: 'N\\times D \\to (N{+}1)\\times D', note: 'Un vector aprendido que se antepone a la secuencia.' },
    { id: 'concat_tokens', name: 'Concatenar tokens', paramTex: '0', macTex: '0', outTex: 'N_a\\times D,\\ N_b\\times D \\to (N_a{+}N_b)\\times D', note: 'Sin parámetros.' },
    { id: 'flatten', name: 'Aplanar rejilla', paramTex: '0', macTex: '0', outTex: 'h\\times w\\times D \\to hw\\times D', note: 'Reshape: la rejilla de parches se vuelve secuencia.' },
    { id: 'split_heads', name: 'Separar en cabezas', paramTex: '0', macTex: '0', outTex: 'N\\times 3D \\to 3\\times(h\\times N\\times d_h)', note: 'Reshape + transpose; d_h = D/h.' },
    { id: 'attention_scores', name: 'Scores QKᵀ', paramTex: '0', macTex: 'h\\,N^2\\,d_h = N^2 D', outTex: 'h\\times N\\times d_h \\to h\\times N\\times N', note: 'Cuadrático en N: el término que domina a alta resolución.' },
    { id: 'scale', name: 'Escala 1/√d_h', paramTex: '0', macTex: '0', outTex: 'h\\times N\\times N \\to h\\times N\\times N', note: 'Elementwise. La máscara causal (si la hay) se aplica aquí.' },
    { id: 'softmax', name: 'Softmax', paramTex: '0', macTex: '0', outTex: 'h\\times N\\times N \\to h\\times N\\times N', note: 'Por fila; ≈ 5 ops por elemento en "otros".' },
    { id: 'attention_weighted_sum', name: 'Suma ponderada A·V', paramTex: '0', macTex: 'h\\,N^2\\,d_h = N^2 D', outTex: 'h\\times N\\times N,\\ h\\times N\\times d_h \\to h\\times N\\times d_h', note: 'Igual costo que QKᵀ.' },
    { id: 'merge_heads', name: 'Concatenar cabezas', paramTex: '0', macTex: '0', outTex: 'h\\times N\\times d_h \\to N\\times D', note: 'Transpose + reshape.' },
    { id: 'mhsa', name: 'Multi-head self-attention', paramTex: '4D^2 + 4D', macTex: '4ND^2 + 2N^2D', outTex: 'N\\times D \\to N\\times D', note: 'Proyecciones (4ND²) + scores y suma ponderada (2N²D). Las cabezas no cambian el conteo.' },
    { id: 'mlp', name: 'MLP (FFN)', paramTex: '2D\\,D_{\\mathrm{mlp}} + D_{\\mathrm{mlp}} + D', macTex: '2N\\,D\\,D_{\\mathrm{mlp}}', outTex: 'N\\times D \\to N\\times D', note: 'Con D_mlp = 4D: 8D² + 5D parámetros y 8ND² MACs.' },
    { id: 'residual_add', name: 'Suma residual', paramTex: '0', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'Elementwise, sin parámetros.' },
    { id: 'transformer_block', name: 'Bloque transformer (pre-LN)', paramTex: '4D^2 + 2D\\,D_{\\mathrm{mlp}} + D_{\\mathrm{mlp}} + 9D', macTex: 'N(4D^2 + 2D\\,D_{\\mathrm{mlp}}) + 2N^2D', outTex: 'N\\times D \\to N\\times D', note: 'Con D_mlp = 4D: 12D² + 13D parámetros y 12ND² + 2N²D MACs. Los dos términos se igualan en N = 6D.' },
    { id: 'pool_cls', name: 'Pooling CLS', paramTex: '0', macTex: '0', outTex: '(N{+}1)\\times D \\to D', note: 'Toma la fila del token CLS.' },
    { id: 'classifier_head', name: 'Cabeza de clasificación', paramTex: 'D\\,K + K', macTex: 'D\\,K', outTex: 'D \\to K', note: 'Un Linear sobre el vector del CLS.' },
    // Fase 2 (Swin, ResNet, CLIP)
    { id: 'batchnorm2d', name: 'BatchNorm', paramTex: '2C', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'γ y β por canal; media y varianza móviles son buffers. En inferencia se funde con la conv anterior.' },
    { id: 'relu', name: 'ReLU', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'max(0, x); 1 op por elemento en "otros".' },
    { id: 'maxpool2d', name: 'Max pooling', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H_o\\times W_o\\times C', note: 'ResNet: 3×3, stride 2, padding 1 (112 → 56).' },
    { id: 'global_avg_pool', name: 'Global average pooling', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to C', note: 'Promedio espacial: Swin y ResNet clasifican así (no hay token CLS).' },
    { id: 'conv_bn', name: 'Conv + BN (+ ReLU)', paramTex: 'k^2\\,C_{in}\\,C_{out} + 2C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}', outTex: 'H\\times W\\times C_{in} \\to H_o\\times W_o\\times C_{out}', note: 'La conv no lleva sesgo: el β de la BN lo hace redundante.' },
    { id: 'bottleneck', name: 'Bloque bottleneck (ResNet-50)', paramTex: 'C_{in}w + 13w^2 + 12w\;(+\\,4wC_{in} + 8w)', macTex: 'HWC_{in}w + H_oW_o\\,13w^2\;(+\\,H_oW_o\\,4wC_{in})', outTex: 'H\\times W\\times C_{in} \\to H_o\\times W_o\\times 4w', note: '1×1 reduce a w, 3×3 (con el stride), 1×1 expande a 4w; atajo identidad o proyección 1×1 + BN (entre paréntesis).' },
    { id: 'cyclic_shift', name: 'Desplazamiento cíclico', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'torch.roll por ⌊M/2⌋: las ventanas del bloque siguiente cruzan los bordes de las anteriores.' },
    { id: 'window_partition', name: 'Partición en ventanas', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to n_W\\times M^2\\times C', note: 'n_W = HW/M². Las ventanas se procesan como un lote.' },
    { id: 'window_reverse', name: 'Revertir ventanas', paramTex: '0', macTex: '0', outTex: 'n_W\\times M^2\\times C \\to H\\times W\\times C', note: 'Inversa de la partición.' },
    { id: 'rel_pos_bias', name: 'Sesgo de posición relativa', paramTex: '(2M-1)^2\\,h', macTex: '0', outTex: 'n_W\\times h\\times M^2\\times M^2 \\to \\text{igual}', note: 'Tabla aprendida (parámetro) indexada por un índice M²×M² (buffer); se suma a los scores.' },
    { id: 'attn_mask', name: 'Máscara de SW-MSA', paramTex: '0', macTex: '0', outTex: 'n_W\\times h\\times M^2\\times M^2 \\to \\text{igual}', note: 'Tras el desplazamiento, una ventana junta regiones no vecinas: la máscara (buffer, −100) les impide atenderse.' },
    { id: 'causal_mask', name: 'Máscara causal', paramTex: '0', macTex: '0', outTex: 'h\\times T\\times T \\to h\\times T\\times T', note: 'El token t solo atiende a 1…t. No cambia parámetros ni MACs.' },
    { id: 'window_attention', name: 'Atención por ventanas (W-MSA / SW-MSA)', paramTex: '4C^2 + 4C + (2M-1)^2 h', macTex: '4HW\\,C^2 + 2HW\\,M^2 C', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'Lineal en los tokens HW (vs 2(HW)²C de la global): el ahorro es HW/M².' },
    { id: 'patch_merging', name: 'Patch merging', paramTex: '8C + 8C^2', macTex: '\\tfrac{HW}{4}\\cdot 4C\\cdot 2C', outTex: 'H\\times W\\times C \\to \\tfrac{H}{2}\\times\\tfrac{W}{2}\\times 2C', note: 'Concat 2×2 → LayerNorm(4C) → Linear 4C→2C sin sesgo: tokens ÷4, canales ×2 (como un stride 2).' },
    { id: 'causal_self_attention', name: 'Self-attention causal', paramTex: '4D^2 + 4D', macTex: '4ND^2 + 2N^2D', outTex: 'N\\times D \\to N\\times D', note: 'Mismos conteos que la bidireccional; la máscara solo cambia qué scores se usan.' },
    { id: 'pick_token', name: 'Tomar un token', paramTex: '0', macTex: '0', outTex: 'T\\times D \\to D', note: 'CLIP texto: la fila del token EOT.' },
    { id: 'l2_normalize', name: 'Normalización L2', paramTex: '0', macTex: '0', outTex: 'E \\to E', note: 'x/‖x‖: el producto punto pasa a ser similitud coseno.' },
    { id: 'similarity_logits', name: 'Matriz de similitud', paramTex: '0', macTex: 'B^2 E', outTex: 'B\\times E,\\ B\\times E \\to B\\times B', note: 'I·Tᵀ: B² pares; la diagonal son los positivos y el resto B−1 negativos por fila.' },
    { id: 'logit_scale', name: 'Temperatura aprendida', paramTex: '1', macTex: '0', outTex: 'B\\times B \\to B\\times B', note: 'Multiplica por e^t (init 1/0.07, tope 100).' },
    { id: 'contrastive_loss', name: 'Pérdida contrastiva (InfoNCE simétrica)', paramTex: '0', macTex: '0', outTex: 'B\\times B \\to 1', note: 'Promedio de la CE por filas (imagen→texto) y por columnas (texto→imagen).' },
    // Fase 3 (DETR, Deformable DETR)
    { id: 'frozen_batchnorm2d', name: 'BatchNorm congelada (FrozenBN)', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'γ, β, media y varianza fijas, guardadas como buffers (4C): el backbone de DETR no las entrena. Una BatchNorm normal tendría 2C parámetros.' },
    { id: 'group_norm', name: 'GroupNorm', paramTex: '2C', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'Normaliza por grupos de canales (32 en Deformable DETR); no depende del batch.' },
    { id: 'sigmoid', name: 'Sigmoide', paramTex: '0', macTex: '0', outTex: 'Q\\times 4 \\to Q\\times 4', note: 'Cajas (cx, cy, w, h) normalizadas a [0, 1].' },
    { id: 'sine_pos_encoding', name: 'Posición 2-D seno/coseno', paramTex: '0', macTex: '0', outTex: '\\to N\\times D', note: 'D/2 canales para y y D/2 para x (temperatura 10,000). Fija: buffer, no parámetro. DETR la suma a Q y K en cada atención, nunca a V.' },
    { id: 'level_embed', name: 'Embedding de nivel', paramTex: 'L\\,D', macTex: '0', outTex: '\\to L\\times D', note: 'Un vector aprendido por nivel de la pirámide: le dice a la atención de qué escala viene cada token.' },
    { id: 'add_level_embed', name: 'Suma del embedding de nivel', paramTex: '0', macTex: '0', outTex: 'N\\times D,\\ L\\times D \\to N\\times D', note: 'Cada token recibe el vector de su nivel.' },
    { id: 'flatten_levels', name: 'Aplanar niveles', paramTex: '0', macTex: '0', outTex: '\\{H_l\\times W_l\\times D\\} \\to (\\textstyle\\sum_l H_lW_l)\\times D', note: 'Concatena los tokens de todos los niveles en una sola secuencia.' },
    { id: 'learned_queries', name: 'Object queries aprendidas', paramTex: 'Q\\,D', macTex: '0', outTex: '\\to Q\\times D', note: 'Q vectores aprendidos (query_pos): cada uno es un "slot" que terminará respondiendo por un objeto o por ∅. Deformable DETR aprende Q×2D (query_pos y la entrada).' },
    { id: 'zeros_init', name: 'Entrada del decoder en ceros', paramTex: '0', macTex: '0', outTex: '\\to Q\\times D', note: 'DETR arranca el decoder en ceros; la identidad de cada query entra por query_pos en cada capa.' },
    { id: 'split_qkv_heads', name: 'Separar Q, K, V en cabezas', paramTex: '0', macTex: '0', outTex: 'N_q\\times D,\\ N_k\\times D \\to h\\times N_q\\times d_h,\\ h\\times N_k\\times d_h', note: 'Como split_heads, pero Q y K/V pueden tener largos distintos (cross-attention).' },
    { id: 'multihead_attention', name: 'Multi-head attention (Q, K, V separados)', paramTex: '4D^2 + 4D', macTex: '2N_qD^2 + 2N_kD^2 + 2N_qN_kD', outTex: 'N_q\\times D,\\ N_k\\times D \\to N_q\\times D', note: 'nn.MultiheadAttention. En DETR la posición se suma a Q y a K, nunca a V.' },
    { id: 'cross_attention', name: 'Cross-attention', paramTex: '4D^2 + 4D', macTex: '2QD^2 + 2ND^2 + 2QND', outTex: 'Q\\times D,\\ N\\times D \\to Q\\times D', note: 'Q desde las queries del decoder, K y V desde la memoria del encoder (largos distintos): los scores son h×Q×N.' },
    { id: 'reference_points', name: 'Puntos de referencia', paramTex: '0', macTex: '0', outTex: '\\to N\\times L\\times 2', note: 'Encoder de Deformable DETR: el centro normalizado de cada token, en cada nivel. En el decoder salen de Linear(D → 2) + sigmoide sobre query_pos.' },
    { id: 'deform_sample', name: 'Muestreo bilineal (deformable)', paramTex: '0', macTex: '4\\,h\\,N_q\\,LK\\,d_h', outTex: 'N_v\\times D,\\ N_q\\times hLK{\\cdot}2 \\to h\\times N_q\\times LK\\times d_h', note: 'Interpola el value en ref + Δ (4 vecinos por punto). grid_sample: FlopCounterMode no lo cuenta (MACs analíticos).' },
    { id: 'deform_weighted_sum', name: 'Suma ponderada de las muestras', paramTex: '0', macTex: 'h\\,N_q\\,LK\\,d_h', outTex: 'h\\times N_q\\times LK\\times d_h \\to N_q\\times D', note: 'El análogo de A·V con LK = 16 claves por cabeza en vez de N.' },
    { id: 'deformable_attention', name: 'Atención deformable multi-escala', paramTex: 'D\\cdot 3hLK + 3hLK + 2D^2 + 2D', macTex: 'N_qD\\cdot 3hLK + N_vD^2 + N_qD^2 + 5N_q\\,hLK\\,d_h', outTex: 'N_q\\times D,\\ N_v\\times D \\to N_q\\times D', note: 'Offsets (hLK·2) y pesos (hLK) salen de la query; cada query lee hLK puntos: lineal en tokens, sin término N_q·N_v.' },
    { id: 'ref_offset', name: 'Caja relativa a la referencia', paramTex: '0', macTex: '0', outTex: 'Q\\times 4,\\ Q\\times 2 \\to Q\\times 4', note: 'Deformable DETR predice la caja como Δ + σ⁻¹(ref) antes de la sigmoide.' },
    { id: 'box_mlp', name: 'Cabeza de cajas (MLP 3 capas)', paramTex: '2(D^2 + D) + 4D + 4', macTex: 'Q\\,(2D^2 + 4D)', outTex: 'Q\\times D \\to Q\\times 4', note: 'D → D → D → 4 con ReLU y sigmoide final: (cx, cy, w, h) normalizados.' },
    { id: 'hungarian_cost', name: 'Matriz de costos del matching', paramTex: '0', macTex: '0', outTex: 'Q\\times (K{+}1),\\ Q\\times 4,\\ G \\to Q\\times G', note: 'C = λ_cls(−p̂(c)) + λ_L1‖b − b̂‖₁ + λ_giou(−GIoU) para cada par (query, objeto). Solo entrenamiento.' },
    { id: 'hungarian_match', name: 'Matching húngaro', paramTex: '0', macTex: '0', outTex: 'Q\\times G \\to G\\times 2', note: 'Asignación uno a uno de costo mínimo: G queries emparejadas, Q − G → ∅. Por eso DETR no necesita NMS.' },
    { id: 'set_prediction_loss', name: 'Pérdida de conjunto', paramTex: '0', macTex: '0', outTex: '\\to 1', note: 'CE de clase sobre las Q queries (∅ con peso reducido) + L1 + GIoU sobre las emparejadas.' },
    // Fase 4 (Grounding DINO, YOLO-World, YOLOv8)
    { id: 'silu', name: 'SiLU', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'x·σ(x): la activación de los Conv de YOLOv8; ≈ 4 ops por elemento en "otros".' },
    { id: 'upsample_nearest', name: 'Upsample ×2 (nearest)', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to 2H\\times 2W\\times C', note: 'Copia cada píxel 2×2: el camino top-down del PAN sube de resolución sin aprender nada.' },
    { id: 'concat_channels', name: 'Concatenar canales', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C_a,\\ H\\times W\\times C_b \\to H\\times W\\times (C_a{+}C_b)', note: 'Une mapas de la misma resolución (lateral del FPN/PAN, ramas de C2f).' },
    { id: 'split_channels', name: 'Partir canales', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times 2c \\to 2\\times(H\\times W\\times c)', note: 'chunk(2): C2f procesa una mitad y deja pasar la otra.' },
    { id: 'adaptive_max_pool', name: 'Max-pool adaptativo', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to k\\times k\\times C', note: 'YOLO-World: cada nivel se resume en 3×3 = 9 "tokens de imagen" para actualizar el texto.' },
    { id: 'layer_scale', name: 'Layer scale γ', paramTex: 'D', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'γ ⊙ Δ con γ aprendido (init 1e-4): la fusión de Grounding DINO arranca casi apagada y se enciende al entrenar.' },
    { id: 'subsentence_mask', name: 'Máscara de sub-oraciones', paramTex: '0', macTex: '0', outTex: 'T \\to T\\times T,\\ T', note: 'Grounding DINO: los tokens de una categoría solo se atienden entre sí (y los position ids se reinician en cada frase).' },
    { id: 'sine_pos_1d', name: 'Posición 1-D seno/coseno', paramTex: '0', macTex: '0', outTex: '\\to T\\times D', note: 'Para los tokens de texto del feature enhancer (de los position ids). Buffer, no parámetro.' },
    { id: 'box_sine_embed', name: 'PE seno/coseno de la caja', paramTex: '0', macTex: '0', outTex: 'Q\\times 4 \\to Q\\times 2D', note: 'D/2 canales por coordenada (cx, cy, w, h); un MLP la lleva a query_pos (D). Es la parte posicional de las queries de Grounding DINO / DINO.' },
    { id: 'encoder_proposals', name: 'Cajas ancla del encoder', paramTex: '0', macTex: '0', outTex: '\\to N\\times 4', note: 'Una caja por token (centro del token, lado 0.05·2^l): el MLP de cajas predice un ajuste sobre ella.' },
    { id: 'contrastive_logits', name: 'Logits contrastivos (por token de texto)', paramTex: '0', macTex: 'N_q\\,T\\,D', outTex: 'N_q\\times D,\\ T\\times D \\to N_q\\times T', note: 'La cabeza de clase sin pesos de Grounding DINO: cada logit es query · token de texto. Las "clases" son lo que diga el prompt.' },
    { id: 'topk_select', name: 'Top-K por similitud con el texto', paramTex: '0', macTex: '0', outTex: 'N\\times T \\to Q', note: 'Query selection guiada por lenguaje: máximo sobre los T tokens y los Q = 900 mejores tokens de imagen.' },
    { id: 'gather_rows', name: 'Tomar filas', paramTex: '0', macTex: '0', outTex: 'N\\times C,\\ Q \\to Q\\times C', note: 'Indexar: sin parámetros ni MACs.' },
    { id: 'transpose_scores', name: 'Transponer scores', paramTex: '0', macTex: '0', outTex: 'h\\times N\\times T \\to h\\times T\\times N', note: 'La fusión de Grounding DINO calcula QKᵀ una vez y la usa en los dos sentidos.' },
    { id: 'token_mask', name: 'Máscara de atención por tokens', paramTex: '0', macTex: '0', outTex: 'h\\times T\\times T \\to \\text{igual}', note: 'Suma 0 / −∞: sub-oraciones del prompt o tokens de relleno.' },
    { id: 'text_guided_scores', name: 'Scores píxel × clase (max-sigmoid)', paramTex: '0', macTex: 'H\\,W\\,V\\,E', outTex: 'H\\times W\\times E,\\ V\\times E \\to n_h\\times HW\\times V', note: 'YOLO-World: producto de cada píxel con cada embedding de texto, por cabeza.' },
    { id: 'max_over_text', name: 'Máximo sobre las clases', paramTex: '0', macTex: '0', outTex: 'n_h\\times HW\\times V \\to n_h\\times HW', note: 'Cada píxel se queda con su clase más parecida (por cabeza).' },
    { id: 'maxsig_gate', name: 'Compuerta σ(max/√c_h + b)', paramTex: 'n_h', macTex: '0', outTex: 'n_h\\times HW \\to n_h\\times HW', note: 'Un sesgo por cabeza; la sigmoide da un peso en (0, 1) por píxel.' },
    { id: 'head_modulate', name: 'Modular por cabeza', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C,\\ n_h\\times HW \\to H\\times W\\times C', note: 'Los canales de cada cabeza se multiplican por su peso: el texto enciende o apaga regiones.' },
    { id: 'region_text_similarity', name: 'Similitud región-texto', paramTex: '0', macTex: 'H\\,W\\,V\\,E', outTex: 'H\\times W\\times E,\\ V\\times E \\to HW\\times V', note: 'YOLO-World: coseno (L2 de los dos lados) entre el embedding de cada celda y cada clase del vocabulario.' },
    { id: 'scale_bias', name: 'Escala y sesgo aprendidos', paramTex: '2', macTex: '0', outTex: 'HW\\times V \\to HW\\times V', note: 'logits·e^s + b (init s = log 1/0.07, b = −10): la ContrastiveHead de YOLO-World.' },
    { id: 'dfl_decode', name: 'DFL: distribución → distancia', paramTex: 'R', macTex: 'A\\cdot 4\\cdot R', outTex: '\\{h_l\\times w_l\\times 4R\\} \\to A\\times 4', note: 'Cada lado de la caja es una softmax sobre R = 16 bins; la esperanza es una conv 1×1 de pesos fijos 0…R−1.' },
    { id: 'dist2bbox', name: 'Distancias → caja', paramTex: '0', macTex: '0', outTex: 'A\\times 4 \\to A\\times 4', note: '(l, t, r, b) desde el centro de cada celda, × stride. Anchor-free: sin cajas ancla.' },
    { id: 'merge_level_logits', name: 'Unir niveles + sigmoide', paramTex: '0', macTex: '0', outTex: '\\{h_lw_l\\times K\\} \\to A\\times K', note: 'A = Σ h_l·w_l = 8,400 celdas a 640×640. Después va el NMS (fuera del modelo).' },
    { id: 'offline_text_encoder', name: 'Codificador de texto offline', paramTex: '0\\ (\\text{online})', macTex: '0\\ (\\text{online})', outTex: 'V\\times 77 \\to V\\times 512', note: 'YOLO-World: CLIP codifica el vocabulario una vez y los embeddings quedan como pesos; en inferencia no corre (su costo offline va aparte).' },
    { id: 'conv_bn_act', name: 'Conv + BN + SiLU (Conv de YOLO)', paramTex: 'k^2\\,C_{in}\\,C_{out} + 2C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}', outTex: 'H\\times W\\times C_{in} \\to H_o\\times W_o\\times C_{out}', note: 'Sin sesgo (lo absorbe β de la BN); padding k/2. En inferencia la BN se funde en la conv.' },
    { id: 'csp_bottleneck', name: 'Bottleneck de C2f', paramTex: '18C^2 + 4C', macTex: '18\\,HWC^2', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'Dos convs 3×3 sin cambiar canales; atajo en el backbone, sin atajo en el neck.' },
    { id: 'c2f', name: 'C2f (CSP con 2 convs)', paramTex: '2cC_{in} + 4c + n(18c^2 + 4c) + (2{+}n)cC_{out} + 2C_{out}', macTex: 'HW[2cC_{in} + 18nc^2 + (2{+}n)cC_{out}]', outTex: 'H\\times W\\times C_{in} \\to H\\times W\\times C_{out}', note: 'Parte en dos, encadena n bottlenecks sobre una mitad y concatena TODAS las salidas intermedias (gradiente por muchos caminos).' },
    { id: 'sppf', name: 'SPPF', paramTex: 'C\\tfrac{C}{2} + C + 2CC_{out} + 2C_{out}', macTex: 'HW(\\tfrac{C^2}{2} + 2CC_{out})', outTex: 'H\\times W\\times C \\to H\\times W\\times C_{out}', note: '3 max-pool 5×5 encadenados = campos de 5, 9 y 13: contexto multi-escala casi gratis.' },
    { id: 'max_sigmoid_attn', name: 'Max-sigmoid attention', paramTex: '512E + E + n_h + 9CC_{out} + 2C_{out}', macTex: '512VE + HWVE + 9HWCC_{out}', outTex: 'H\\times W\\times C,\\ V\\times 512 \\to H\\times W\\times C_{out}', note: 'YOLO-World: peso por píxel = σ(máx. similitud con las clases); multiplica la salida de una conv 3×3.' },
    { id: 't_csp_layer', name: 'T-CSPLayer (C2f guiado por texto)', paramTex: '\\text{C2f} + cC_{out} + \\text{max-sigmoid}', macTex: '\\text{C2f} + 9HWc^2 + HWVE + 512VE', outTex: 'H\\times W\\times C_{in},\\ V\\times 512 \\to H\\times W\\times C_{out}', note: 'El C2f del neck con una rama extra de max-sigmoid attention: el vocabulario entra en la RepVL-PAN.' },
    { id: 'image_pooling_attn', name: 'Image-pooling attention', paramTex: '\\textstyle\\sum_l C_lE + \\ldots', macTex: '\\textstyle\\sum_l H_lW_lC_lE + 4VE\\cdot 128 + \\ldots', outTex: '\\{H_l\\times W_l\\times C_l\\},\\ V\\times 512 \\to V\\times 512', note: 'YOLO-World v1: cada embedding de texto atiende a 27 tokens de imagen (3×3 por nivel) y se actualiza (residual). La v2 la quitó.' },
    { id: 'bi_attention', name: 'Atención bidireccional imagen ↔ texto', paramTex: '6DE + 4E + 2D', macTex: '3NDE + 3TDE + 3NTE', outTex: 'N\\times D,\\ T\\times D \\to N\\times D,\\ T\\times D', note: 'Fusión del feature enhancer de Grounding DINO: una matriz de scores N×T por cabeza, softmax por filas (imagen→texto) y por columnas (texto→imagen).' },
    // Fase 5 (SAM, SAM 2)
    { id: 'conv_transpose2d', name: 'ConvTranspose2d (k = s)', paramTex: 'k^2\\,C_{in}\\,C_{out} + C_{out}', macTex: 'H\\,W\\,k^2\\,C_{in}\\,C_{out}', outTex: 'H\\times W\\times C_{in} \\to kH\\times kW\\times C_{out}', note: 'Upscaling del decoder de SAM (×2 dos veces: de 64×64 a 256×256). Con k = s no hay solapamiento: cada píxel de entrada pinta un bloque k×k.' },
    { id: 'depthwise_conv2d', name: 'Conv depthwise', paramTex: 'k^2 C + C', macTex: 'H\\,W\\,C\\,k^2', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'Un filtro por canal (groups = C): C veces más barata que una conv densa. Bloque ConvNeXt del memory encoder de SAM 2.' },
    { id: 'window_partition_pad', name: 'Partición en ventanas (con relleno)', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to n_W\\times M^2\\times C', note: 'Rellena con ceros hasta múltiplo de M: 64×64 con M = 14 → 70×70 = 25 ventanas (4,900 tokens, 20 % más que 4,096). El relleno también cuesta MACs.' },
    { id: 'window_unpartition', name: 'Deshacer ventanas (recortar)', paramTex: '0', macTex: '0', outTex: 'n_W\\times M^2\\times C \\to H\\times W\\times C', note: 'Inversa de la partición: reordena y recorta el relleno.' },
    { id: 'decomposed_rel_pos', name: 'Posición relativa descompuesta', paramTex: '2\\,(2S-1)\\,d_h', macTex: '2\\,h\\,S^2\\cdot S\\,d_h', outTex: 'h\\times S^2\\times S^2 \\to h\\times S^2\\times S^2', note: 'SAM (de MViTv2): q·R_h[Δy] + q·R_w[Δx] sumado a los scores. Tablas por eje de (2S−1)×d_h: S = 14 en bloques con ventanas, S = 64 en los globales.' },
    { id: 'query_pool', name: 'Q-pooling (Hiera)', paramTex: '0', macTex: '0', outTex: 'h\\times M^2\\times d_h \\to h\\times (M/2)^2\\times d_h', note: 'Max-pool 2×2 de las queries en el primer bloque de cada stage: la salida tiene ¼ de los tokens; K y V no se reducen.' },
    { id: 'coord_grid', name: 'Rejilla de coordenadas', paramTex: '0', macTex: '0', outTex: '\\to h\\times w\\times 2', note: 'Centros normalizados de cada celda de la rejilla del embedding (para la PE densa de SAM).' },
    { id: 'fourier_pe', name: 'PE de Fourier aleatoria', paramTex: '0', macTex: 'N\\cdot 2\\cdot F', outTex: 'N\\times 2 \\to N\\times 2F', note: 'SAM: [sin, cos](2π·(2c − 1)·G) con G 2×128 gaussiana FIJA (buffer). Codifica igual clics, esquinas de caja y la rejilla de la imagen.' },
    { id: 'append_pad_point', name: 'Punto de relleno', paramTex: '0', macTex: '0', outTex: 'P\\times 2 \\to (P{+}1)\\times 2', note: 'Sin caja, SAM añade un punto "not a point" (etiqueta −1): P clics dan P + 1 tokens dispersos.' },
    { id: 'type_embed', name: 'Embedding de tipo de prompt', paramTex: '5D', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'Suma el vector aprendido del tipo: punto positivo, negativo, esquina 1 y 2 de la caja, o "not a point".' },
    { id: 'learned_tokens', name: 'Tokens de salida aprendidos', paramTex: 'R\\,D', macTex: '0', outTex: '\\to R\\times D', note: 'SAM: 1 token de IoU + 4 de máscara; SAM 2 añade el de objeto (oclusión).' },
    { id: 'broadcast_embed', name: 'Embedding repetido', paramTex: 'D', macTex: '0', outTex: '\\to h\\times w\\times D', note: 'SAM sin máscara de entrada: el "no-mask embedding" aprendido se suma en cada posición del embedding de imagen.' },
    { id: 'idle_params', name: 'Parámetros sin uso en este forward', paramTex: 'n', macTex: '0', outTex: '—', note: 'Cuentan en el total del modelo pero no corren en este tipo de frame/prompt (p. ej. las convs del prompt de máscara).' },
    { id: 'rope_2d', name: 'RoPE 2-D', paramTex: '0', macTex: '0', outTex: 'N\\times d \\to N\\times d', note: 'SAM 2, memory attention: rota pares de canales según la fila y la columna del token. Sin parámetros ni MACs de matmul.' },
    { id: 'take_rows', name: 'Tomar filas', paramTex: '0', macTex: '0', outTex: 'N\\times D \\to n\\times D', note: 'Vista: separa el token de IoU, los de máscara, el de objeto.' },
    { id: 'grouped_linear', name: 'Linear por token (pesos distintos)', paramTex: 'R\\,(D_{in}D_{out} + D_{out})', macTex: 'R\\,D_{in}\\,D_{out}', outTex: 'R\\times D_{in} \\to R\\times D_{out}', note: 'Hipernetwork de SAM: cada uno de los 4 tokens de máscara tiene su propio MLP.' },
    { id: 'hyper_dot', name: 'Producto hipernetwork · embedding', paramTex: '0', macTex: 'K\\,c\\,H\\,W', outTex: 'K\\times c,\\ H\\times W\\times c \\to K\\times H\\times W', note: 'Máscara k(x, y) = w_k · e(x, y): los pesos los genera el token de máscara (una "conv 1×1 dinámica").' },
    { id: 'mask_select', name: 'Selección de máscaras', paramTex: '0', macTex: '0', outTex: '4\\times H\\times W \\to 3\\times H\\times W', note: 'multimask: tokens 1–3 (ambigüedad: parte, objeto, todo); si no, el token 0.' },
    { id: 'pick_mask', name: 'Mejor máscara (argmax IoU)', paramTex: '0', macTex: '0', outTex: '3\\times h\\times w \\to h\\times w\\times 1', note: 'SAM 2 en video: se queda con la máscara de mayor IoU predicho para la salida, la memoria y el puntero.' },
    { id: 'upsample_bilinear', name: 'Interpolación bilineal', paramTex: '0', macTex: '0', outTex: 'h\\times w\\times C \\to H\\times W\\times C', note: 'Sin MACs de matmul (≈ 4 ops por salida, en "otros").' },
    { id: 'to_grid', name: 'Secuencia → rejilla', paramTex: '0', macTex: '0', outTex: 'hw\\times C \\to h\\times w\\times C', note: 'Vista (inversa de flatten).' },
    { id: 'split_tokens', name: 'Partir vectores en tokens', paramTex: '0', macTex: '0', outTex: 'R\\times D \\to pR\\times D/p', note: 'SAM 2: cada puntero de objeto (256) se vuelve 4 tokens de 64, el ancho de la memoria.' },
    { id: 'repeat_rows', name: 'Repetir filas', paramTex: '0', macTex: '0', outTex: 'R\\times c \\to kR\\times c', note: 'Vista expandida (repeat_interleave).' },
    { id: 'add_temporal_embed', name: 'Embedding temporal de la memoria', paramTex: 'n_{mem}\\,D_m', macTex: '0', outTex: 'N\\times D_m \\to N\\times D_m', note: 'SAM 2: un vector aprendido por posición del FIFO de memorias (num_maskmem = 7 filas de 64).' },
    { id: 'pos_embed_grid', name: 'Posición absoluta (rejilla)', paramTex: 'h\\,w\\,D', macTex: '0', outTex: '\\to h\\times w\\times D', note: 'SAM: 64×64×1280 aprendida (5.2 M parámetros en ViT-H); sin token CLS.' },
    { id: 'window_pos_embed', name: 'Posición por ventanas (Hiera)', paramTex: 'C\\,(b^2 + w_0^2)', macTex: '0', outTex: '\\to h\\times w\\times C', note: 'Fondo b×b interpolado + tabla de una ventana repetida en mosaico (Bolya et al. 2023).' },
    { id: 'gate_embed', name: 'Embedding de "no objeto"', paramTex: 'D', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'SAM 2: si el objeto está ocluido, el puntero pasa a ser un vector aprendido y la memoria recibe un embedding de oclusión.' },
    // Fase 6 (LLM decoder: Llama 3, Llama 2, Mixtral)
    { id: 'rope', name: 'RoPE (posición rotatoria)', paramTex: '0', macTex: '0', outTex: 'h\\times T\\times d_h \\to h\\times T\\times d_h', note: 'Rota cada par de canales de cada cabeza por m·θ_i (θ_i = base^{−2i/d_h}; base 500,000 en Llama 3): q_m·k_n solo depende de m − n. Sin parámetros; se aplica a Q y K, nunca a V.' },
    { id: 'split_gqa_heads', name: 'Separar en cabezas (GQA)', paramTex: '0', macTex: '0', outTex: 'T\\times hd_h,\\ T\\times Gd_h \\to h\\times T\\times d_h,\\ G\\times T\\times d_h', note: 'Q en h cabezas; K y V en G cabezas KV, cada una compartida por h/G cabezas de query (G = h: MHA; G = 1: MQA).' },
    { id: 'mul', name: 'Producto elementwise', paramTex: '0', macTex: '0', outTex: 'N\\times D_{\\mathrm{mlp}} \\to N\\times D_{\\mathrm{mlp}}', note: 'SwiGLU: SiLU(gate) ⊙ up, la compuerta multiplicativa.' },
    { id: 'lm_head', name: 'LM head', paramTex: 'D\\,V', macTex: 'T\\,D\\,V', outTex: 'T\\times D \\to T\\times V', note: 'Linear sin sesgo al vocabulario (en Llama 3 8B, V = 128,256: 525 M parámetros). Con embeddings atados comparte la matriz del embedding. En decode solo corre sobre 1 fila.' },
    { id: 'sample_token', name: 'Muestrear el siguiente token', paramTex: '0', macTex: '0', outTex: 'T\\times V \\to 1', note: 'La última fila de los logits → softmax con temperatura → greedy, top-k o top-p. El token elegido es la entrada del siguiente paso de decode.' },
    { id: 'kv_append', name: 'Añadir a la KV cache', paramTex: '0', macTex: '0', outTex: 'G\\times (S{-}1)\\times d_h,\\ G\\times 1\\times d_h \\to G\\times S\\times d_h', note: 'Decode: la K y la V del token nuevo se agregan a las guardadas; la atención lee las S filas. Crece 2·L·G·d_h·bytes por token.' },
    { id: 'moe_router', name: 'Router MoE', paramTex: 'D\\,E', macTex: 'T\\,D\\,E', outTex: 'T\\times D \\to T\\times E', note: 'Linear sin sesgo: un logit por experto (E = 8 en Mixtral).' },
    { id: 'moe_topk', name: 'Top-k del router', paramTex: '0', macTex: '0', outTex: 'T\\times E \\to T\\times k,\\ T\\times k', note: 'Softmax, los k mayores (k = 2 en Mixtral) y sus pesos renormalizados. Entrenar con una pérdida auxiliar de balanceo evita que todo vaya a pocos expertos.' },
    { id: 'expert_linear', name: 'Linear por experto', paramTex: 'E\\,D_{in}\\,D_{out}', macTex: 'kT\\,D_{in}\\,D_{out}', outTex: 'kT\\times D_{in} \\to kT\\times D_{out}', note: 'Memoria: los E expertos. Cómputo: solo las kT filas enrutadas (cada token paga k expertos, no E).' },
    { id: 'moe_combine', name: 'Combinar expertos', paramTex: '0', macTex: '0', outTex: 'kT\\times D,\\ T\\times k \\to T\\times D', note: 'y = Σ_j p_j·Experto_j(x): suma ponderada por los pesos del router.' },
    { id: 'swiglu', name: 'FFN SwiGLU', paramTex: '3D\\,D_{\\mathrm{mlp}}', macTex: '3T\\,D\\,D_{\\mathrm{mlp}}', outTex: 'T\\times D \\to T\\times D', note: 'down(SiLU(xW_gate) ⊙ xW_up), sin sesgos: tres matrices. Llama 3 8B: D_mlp = 14,336 = 3.5D.' },
    { id: 'gqa_attention', name: 'Atención GQA (Llama)', paramTex: '2D^2 + 2D\\,G\\,d_h', macTex: 'T(2D^2 + 2D\\,G\\,d_h) + 2T^2D', outTex: 'T\\times D \\to T\\times D', note: 'W_Q y W_O de D×D; W_K y W_V de D×G·d_h. Con G = 8 de 32, K y V (y la KV cache) son 4× más chicas que en MHA; los MACs de QKᵀ y A·V no cambian.' },
    { id: 'llama_block', name: 'Bloque decoder (Llama)', paramTex: '2D^2 + 2D\\,G\\,d_h + 3D\\,D_{\\mathrm{mlp}} + 2D', macTex: 'T(2D^2 + 2D\\,G\\,d_h + 3D\\,D_{\\mathrm{mlp}}) + 2T^2D', outTex: 'T\\times D \\to T\\times D', note: 'Pre-norm con RMSNorm, atención GQA con RoPE, FFN SwiGLU, sin sesgos. Llama 3 8B: 218 M parámetros por bloque, 81 % en la FFN.' },
    { id: 'moe_ffn', name: 'FFN MoE (Mixtral)', paramTex: 'D\\,E + 3E\\,D\\,D_{\\mathrm{mlp}}', macTex: 'T\\,D\\,E + 3kT\\,D\\,D_{\\mathrm{mlp}}', outTex: 'T\\times D \\to T\\times D', note: 'E expertos SwiGLU y un router top-k: parámetros ∝ E, cómputo por token ∝ k. Mixtral 8×7B: 46.7 B totales, 12.9 B activos por token.' },
    // Fase 7 (VLM: LLaVA, Qwen2-VL)
    { id: 'repeat_frames', name: 'Repetir la imagen en el tiempo', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to 2\\times H\\times W\\times C', note: 'Qwen2-VL: el parche es de 2 frames (temporal_patch_size = 2); una imagen se duplica para usar el mismo patchify que el video.' },
    { id: 'patch_embed_3d', name: 'Patch embedding 3-D (Conv3d)', paramTex: 'k_t\\,P^2\\,C\\,D', macTex: '\\tfrac{F}{k_t}\\tfrac{H}{P}\\tfrac{W}{P}\\,D\\,k_t\\,P^2\\,C', outTex: 'F\\times H\\times W\\times C \\to \\tfrac{F}{k_t}\\times \\tfrac{H}{P}\\times \\tfrac{W}{P}\\times D', note: 'Kernel = stride = 2×14×14: cada parche 3-D (2 frames × 14 × 14 × 3 = 1,176 números) pasa por un Linear a D. Sin sesgo en Qwen2-VL.' },
    { id: 'group_tokens', name: 'Agrupar 2×2 parches (merger)', paramTex: '0', macTex: '0', outTex: 'N_p\\times D_v \\to \\tfrac{N_p}{4}\\times 4D_v', note: 'Qwen2-VL: los 4 parches vecinos de cada bloque 2×2 se concatenan en un vector de 4D_v; el MLP del merger lo lleva al ancho del LLM. 4× menos tokens visuales.' },
    { id: 'splice_tokens', name: 'Insertar los tokens visuales en el prompt', paramTex: '0', macTex: '0', outTex: 'T\\times D,\\ N\\times D \\to (N{+}T)\\times D', note: 'Los N tokens visuales (ya proyectados al ancho D del LLM) reemplazan al marcador <image>: para el LLM son tokens más del prompt.' },
    { id: 'mrope', name: 'M-RoPE (RoPE multimodal)', paramTex: '0', macTex: '0', outTex: 'h\\times S\\times d_h \\to h\\times S\\times d_h', note: 'Qwen2-VL: cada token tiene 3 ids (t, h, w); las d_h/2 frecuencias se reparten en secciones (16, 24, 24) y cada una rota con el id de su eje. En el texto los tres ids son iguales: es RoPE 1-D.' },
    { id: 'mrope_ids', name: 'Ids de posición (t, h, w)', paramTex: '0', macTex: '0', outTex: '\\to 3\\times S', note: 'Texto: t = h = w = posición; imagen: t fijo, h y w = fila y columna en la rejilla de tokens (tras el merge 2×2). El texto que sigue continúa desde el máximo + 1.' },
    // Fase 8 (difusión: Stable Diffusion, DiT)
    { id: 'timestep_embedding', name: 'Embedding sinusoidal del paso t', paramTex: '0', macTex: '0', outTex: '1 \\to C', note: 'El paso de ruido t (un número) → [cos(tω_i); sin(tω_i)], como la PE del Transformer pero sobre t. Buffer: luego un MLP (C → 4C en SD, 256 → D en DiT) lo vuelve aprendido.' },
    { id: 'concat_features', name: 'Concatenar features', paramTex: '0', macTex: '0', outTex: 'T\\times D_1,\\ T\\times D_2 \\to T\\times (D_1{+}D_2)', note: 'SDXL: los 77 vectores de los dos encoders de texto (768 + 1280) se pegan en uno de 2,048 por token: la cross-attention ve un solo texto más ancho.' },
    { id: 'label_embed', name: 'Embedding de clase (con clase nula)', paramTex: '(K{+}1)\\,D', macTex: '0', outTex: '1 \\to D', note: 'DiT: una fila por clase de ImageNet más la clase nula ∅: al entrenar, el 10 % de las etiquetas se cambia por ∅ y así el mismo modelo sirve con y sin condición (classifier-free guidance).' },
    { id: 'add_broadcast', name: 'Suma por canal (broadcast)', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C,\\ C \\to H\\times W\\times C', note: 'U-Net: la proyección del embedding del tiempo (un vector de C) se suma a cada posición del mapa: así cada bloque ResNet sabe en qué paso de ruido está.' },
    { id: 'downsample2d', name: 'Downsample (conv 3×3, stride 2)', paramTex: '9\\,C_{in}C_{out} + C_{out}', macTex: '\\tfrac{H}{2}\\tfrac{W}{2}\\,C_{out}\\,9\\,C_{in}', outTex: 'H\\times W\\times C \\to \\tfrac{H}{2}\\times \\tfrac{W}{2}\\times C', note: 'Baja la resolución a la mitad con una conv aprendida (no max-pool). El encoder del VAE rellena (0, 1, 0, 1) en vez de padding 1: mismo tamaño y mismos MACs.' },
    { id: 'upsample2d', name: 'Upsample (vecino ×2 + conv 3×3)', paramTex: '9C^2 + C', macTex: '4HW\\cdot 9C^2', outTex: 'H\\times W\\times C \\to 2H\\times 2W\\times C', note: 'Repetir cada píxel 2×2 y suavizar con una conv 3×3 (evita el patrón de tablero de una conv transpuesta). La conv corre a la resolución NUEVA: 4× más cara que a la vieja.' },
    { id: 'resnet_block', name: 'Bloque ResNet con tiempo (U-Net / VAE)', paramTex: '9C_{in}C_{out} + 9C_{out}^2 + E\\,C_{out} + \\ldots', macTex: 'HW(9C_{in}C_{out} + 9C_{out}^2) + E\\,C_{out}', outTex: 'H\\times W\\times C_{in} \\to H\\times W\\times C_{out}', note: 'GN → SiLU → conv 3×3 → + Linear(SiLU(e_t)) por canal → GN → SiLU → conv 3×3, + atajo (conv 1×1 si cambian los canales). En el VAE no hay tiempo (E = 0).' },
    { id: 'geglu', name: 'GEGLU (compuerta)', paramTex: '0', macTex: '0', outTex: 'N\\times 2F \\to N\\times F', note: 'h, g = mitades de la proyección; salida h ⊙ GELU(g). Como SwiGLU pero con GELU y una sola matriz de entrada de doble ancho.' },
    { id: 'geglu_ff', name: 'FFN GEGLU (SD)', paramTex: '12D^2 + 9D', macTex: '12\\,N\\,D^2', outTex: 'N\\times D \\to N\\times D', note: 'Linear D → 8D (con sesgo) → GEGLU (4D) → Linear 4D → D. 1.5× los parámetros de un MLP 4D.' },
    { id: 'spatial_transformer', name: 'Bloque transformer de la U-Net (SD)', paramTex: '20C^2 + 2D_tC + 21C', macTex: 'N(20C^2 + 2NC + 2TC) + 2TD_tC', outTex: 'H\\times W\\times C,\\ T\\times D_t \\to H\\times W\\times C', note: 'GN → conv 1×1 → tokens → self-attention → cross-attention (Q de la imagen, K y V del texto) → FF GEGLU → rejilla → conv 1×1 → + x. El término 2N²C (self-attn) domina a 64×64: N = 4,096 tokens.' },
    { id: 'adaln_zero', name: 'adaLN-Zero (modulación)', paramTex: 'D\\cdot 6D + 6D', macTex: 'D\\cdot 6D', outTex: 'D \\to 6\\times D', note: 'DiT: SiLU(c) → Linear D → 6D, inicializado en CEROS → (β, γ, α) para la atención y para el MLP. Con α = 0 cada bloque empieza siendo la identidad. Un tercio de los parámetros del bloque.' },
    { id: 'ada_modulate', name: 'Modulación x(1 + γ) + β', paramTex: '0', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'La LayerNorm de DiT no tiene γ, β propios: los pone la condición (tiempo + clase), los mismos para todos los tokens de la imagen.' },
    { id: 'ada_gate', name: 'Compuerta α (residual)', paramTex: '0', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'α ⊙ rama antes de sumarla al residual. α = 0 al inicio (adaLN-Zero).' },
    { id: 'dit_block', name: 'Bloque DiT (adaLN-Zero)', paramTex: '18D^2 + 15D', macTex: 'N\\cdot 12D^2 + 2N^2D + 6D^2', outTex: 'N\\times D,\\ D \\to N\\times D', note: 'Un bloque ViT pre-LN cuya LayerNorm se modula con la condición: 12D² + 9D del ViT − 4D (LN sin parámetros) + 6D² + 6D del adaLN. DiT-XL: D = 1,152, 28 bloques.' },
    { id: 'sincos_pos_2d', name: 'Posición sin/cos 2-D (fija)', paramTex: '0', macTex: '0', outTex: '\\to N\\times D', note: 'DiT (como MAE): senos y cosenos de la fila y la columna de cada parche; no se aprende.' },
    { id: 'unpatchify', name: 'Unpatchify', paramTex: '0', macTex: '0', outTex: 'N\\times P^2C \\to I\\times I\\times C', note: 'Cada token vuelve a ser su parche P×P×C en la rejilla del latente (la inversa del patchify).' },
    { id: 'latent_sample', name: 'Muestreo del latente (VAE)', paramTex: '0', macTex: '0', outTex: 'h\\times w\\times 2c \\to h\\times w\\times c', note: 'El encoder da media y log-varianza por posición y canal; z = μ + σ·ε.' },
    { id: 'latent_scale', name: 'Escala del latente', paramTex: '0', macTex: '0', outTex: 'h\\times w\\times c \\to h\\times w\\times c', note: 'SD 1.x: z·0.18215 al codificar (latentes con varianza ≈ 1) y z/0.18215 antes del decoder.' },
    { id: 'add_noise', name: 'Agregar ruido (forward)', paramTex: '0', macTex: '0', outTex: 'x_0,\\ \\varepsilon,\\ t \\to x_t', note: 'DDPM: x_t = √ᾱ_t·x₀ + √(1 − ᾱ_t)·ε, en un solo paso para cualquier t. Flow matching: x_t = (1 − t)·x₀ + t·ε (línea recta).' },
    { id: 'flow_target', name: 'Velocidad objetivo', paramTex: '0', macTex: '0', outTex: 'x_0,\\ \\varepsilon \\to v', note: 'Flow matching (rectified flow): v = ε − x₀, constante a lo largo de la recta; el modelo la predice y se muestrea con pasos de Euler.' },
    { id: 'cfg_combine', name: 'Classifier-free guidance', paramTex: '0', macTex: '0', outTex: '\\varepsilon_u,\\ \\varepsilon_c \\to \\hat\\varepsilon', note: 'ε̂ = ε_u + w(ε_c − ε_u), w = 7.5 en SD. Necesita las dos predicciones: duplica el lote de cada paso.' },
    { id: 'scheduler_step', name: 'Paso del sampler', paramTex: '0', macTex: '0', outTex: 'x_t,\\ \\hat\\varepsilon \\to x_{t-1}', note: 'DDIM: estima x̂₀ con ε̂ y vuelve a mezclar con el ruido del paso siguiente. Elementwise: el costo está en la red, que corre una vez por paso (×2 con CFG).' },
    { id: 'mse_loss', name: 'Pérdida MSE', paramTex: '0', macTex: '0', outTex: '\\hat y,\\ y \\to 1', note: 'Difusión = regresión: ‖ε̂ − ε‖² (DDPM, L_simple) o ‖v̂ − v‖² (flow matching).' },
    // Fase 9 (VLA)
    { id: 'normalize_pixels', name: 'Normalizar píxeles', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'OpenVLA normaliza la misma imagen dos veces: con las estadísticas de DINOv2 y con las de SigLIP.' },
    { id: 'prefix_tokens', name: 'CLS + registros', paramTex: 'kD', macTex: '0', outTex: 'N\\times D \\to (N{+}k)\\times D', note: 'DINOv2-reg4: 1 CLS + 4 registros (k = 5), sin posición; se descartan a la salida.' },
    { id: 'broadcast_rows', name: 'Repetir un vector en R filas', paramTex: '0', macTex: '0', outTex: 'D \\to R\\times D', note: 'π0: el embedding del tiempo τ se copia en cada una de las H_a filas de acción.' },
    { id: 'prefix_mask', name: 'Máscara del prefijo', paramTex: '0', macTex: '0', outTex: 'h\\times S\\times S \\to h\\times S\\times S', note: 'π0: imágenes + texto se atienden entre sí (bidireccional); el relleno se enmascara.' },
    { id: 'block_causal_mask', name: 'Máscara por bloques', paramTex: '0', macTex: '0', outTex: 'h\\times (1{+}H_a)\\times S \\to \\cdot', note: 'π0: estado → prefijo + estado; acciones → todo. Los MACs no bajan: se cuentan las entradas enmascaradas.' },
    { id: 'ar_decode', name: 'Decode autorregresivo', paramTex: '0', macTex: '\\sum_k \\mathrm{decode}(\\mathrm{ctx}_k)', outTex: '1 \\to d_a', note: 'OpenVLA: 7 tokens de acción = 1 prefill + 6 pasos de decode, cada uno leyendo todos los pesos del LLM (≈ 13.2 GB en bf16).' },
    { id: 'detokenize_actions', name: 'Tokens → acción continua', paramTex: '0', macTex: '0', outTex: 'd_a \\to d_a', note: 'id → bin (32,000 − id) → centro del bin → desnormalizar con los cuantiles 1 % / 99 % del dataset.' },
    // Fase 10 (LoRA / QLoRA, RLHF / DPO)
    { id: 'lora_linear', name: 'Adaptador LoRA', paramTex: 'r\\,(d_{in} + d_{out})', macTex: 'N\\,r\\,(d_{in} + d_{out})', outTex: 'N\\times d_{in} \\to N\\times d_{out}', note: 'y = W₀x + (α/r)·B(Ax): W₀ congelada; solo A (r×d_in) y B (d_out×r) se entrenan. B empieza en 0. Tras fusionar W₀ + (α/r)BA no queda costo extra.' },
    { id: 'lora_a', name: 'LoRA A (bajada a r)', paramTex: 'r\\,d_{in}', macTex: 'N\\,d_{in}\\,r', outTex: 'N\\times d_{in} \\to N\\times r', note: 'Entrenable, sin sesgo; PEFT la inicia Kaiming-uniforme.' },
    { id: 'lora_b', name: 'LoRA B (subida a d_out)', paramTex: 'd_{out}\\,r', macTex: 'N\\,r\\,d_{out}', outTex: 'N\\times r \\to N\\times d_{out}', note: 'Entrenable, sin sesgo, empieza en cero: el modelo arranca idéntico al base.' },
    { id: 'lora_scale', name: 'Escala α/r', paramTex: '0', macTex: '0', outTex: 'N\\times d_{out} \\to N\\times d_{out}', note: 'Escalar fijo: con α = 2r, ×2. rsLoRA propone α/√r.' },
    { id: 'dropout', name: 'Dropout', paramTex: '0', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'PEFT aplica lora_dropout a la entrada de CADA adaptador: con p > 0 es una copia más que el backward guarda.' },
    { id: 'quant_storage', name: 'Almacenamiento cuantizado', paramTex: '0', macTex: '0', outTex: 'n \\to \\text{bytes}', note: 'NF4: 4 bits + absmax fp32 por bloque de 64 (0.5 bit/param); con doble cuantización 8/64 + 32/(64·256) ≈ 0.127. int8: + absmax por fila.' },
    { id: 'scalar_head', name: 'Cabeza escalar (recompensa / valor)', paramTex: 'D', macTex: 'N\\,D', outTex: 'N\\times D \\to N\\times 1', note: 'El LM head (D → V) se cambia por D → 1: el reward model lee el último token; el crítico, todos.' },
    { id: 'token_logprobs', name: 'Log-probs por token', paramTex: '0', macTex: '0', outTex: 'T\\times V \\to T_r', note: 'log-softmax sobre V y tomar el del token real en cada posición de la respuesta.' },
    { id: 'kl_penalty', name: 'Penalización KL', paramTex: '0', macTex: '0', outTex: 'T_r,\\ T_r \\to T_r', note: 'k1 = log π − log π_ref (PPO); k3 = π_ref/π − log(π_ref/π) − 1 (GRPO): ≥ 0 y sin sesgo.' },
    { id: 'shaped_reward', name: 'Recompensa con KL', paramTex: '0', macTex: '0', outTex: 'T_r,\\ 1 \\to T_r', note: 'r_t = −β·KL_t y, en el último token, + r_φ(x, y).' },
    { id: 'gae', name: 'GAE', paramTex: '0', macTex: '0', outTex: 'T_r,\\ T_r \\to T_r,\\ T_r', note: 'δ_t = r_t + γV_{t+1} − V_t; Â_t = Σ (γλ)^k δ_{t+k}; retornos = Â + V. Necesita el crítico.' },
    { id: 'group_advantage', name: 'Ventaja por grupo (GRPO)', paramTex: '0', macTex: '0', outTex: 'n_G \\to n_G', note: 'Â_i = (r_i − media)/std de las n_G respuestas al mismo prompt (la G de GRPO; en las formas, G son las cabezas KV): reemplaza al crítico.' },
    { id: 'ppo_clip_loss', name: 'Pérdida PPO-clip', paramTex: '0', macTex: '0', outTex: '\\to 1', note: '−min(ρÂ, clip(ρ, 1 − ε, 1 + ε)Â), ρ = π/π_old, ε = 0.2.' },
    { id: 'value_loss', name: 'Pérdida del crítico', paramTex: '0', macTex: '0', outTex: '\\to 1', note: '½·máx((V − R)², (V_clip − R)²).' },
    { id: 'bt_loss', name: 'Pérdida Bradley-Terry', paramTex: '0', macTex: '0', outTex: 'r_w,\\ r_l \\to 1', note: 'P(y_w ≻ y_l) = σ(r_w − r_l); pérdida −log σ(r_w − r_l). Solo importa la diferencia.' },
    { id: 'dpo_loss', name: 'Pérdida DPO', paramTex: '0', macTex: '0', outTex: '\\to 1', note: '−log σ(β[(log π − log π_ref)(y_w) − (log π − log π_ref)(y_l)]): la recompensa implícita es β·log(π/π_ref).' },
    // Fase 11 (BERT, recuperación densa, ANN)
    { id: 'mlm_mask', name: 'Enmascarado del MLM', paramTex: '0', macTex: '0', outTex: 'T \\to T,\\ T', note: '15 % de las posiciones: 80 % [MASK], 10 % token al azar, 10 % igual. La pérdida solo mira esas posiciones.' },
    { id: 'pair_tokens', name: 'Armar el par (cross-encoder)', paramTex: '0', macTex: '0', outTex: 'T_q,\\ T_d \\to T_q{+}T_d{-}1', note: '[CLS] query [SEP] documento [SEP]: el modelo lee los dos textos juntos (atención cruzada entre ambos). Si pasa de 512 tokens, se recorta el documento (truncation only_second).' },
    { id: 'pooler', name: 'Pooler de BERT', paramTex: 'D^2 + D', macTex: 'D^2', outTex: 'T\\times D \\to D', note: 'tanh(W·h_[CLS] + b): solo la fila [CLS]. Lo usan NSP y la cabeza de clasificación; DPR y Sentence-BERT no.' },
    { id: 'tanh', name: 'tanh', paramTex: '0', macTex: '0', outTex: 'D \\to D', note: 'Elementwise; ≈ 5 ops por elemento en "otros".' },
    { id: 'mean_pool', name: 'Mean pooling', paramTex: '0', macTex: '0', outTex: 'T\\times D \\to D', note: 'Promedio de los vectores de token con la máscara de atención (Sentence-BERT). Alternativa: tomar [CLS] (DPR).' },
    { id: 'tied_decoder', name: 'Decoder atado del MLM', paramTex: 'V', macTex: 'T\\,D\\,V', outTex: 'T\\times D \\to T\\times V', note: 'La matriz es la tabla de word embeddings (pesos atados): solo el sesgo de V es nuevo. Es la matmul más cara de la cabeza.' },
    { id: 'mlm_head', name: 'Cabeza MLM', paramTex: 'D^2 + 3D + V', macTex: 'T\\,D^2 + T\\,D\\,V', outTex: 'T\\times D \\to T\\times V', note: 'dense → GELU → LayerNorm → decoder atado. HF calcula los logits de las T posiciones; la pérdida usa solo el 15 % elegido.' },
    { id: 'nsp_head', name: 'Cabeza NSP', paramTex: '2D + 2', macTex: '2D', outTex: 'D \\to 2', note: 'Next sentence prediction sobre la salida del pooler: IsNext / NotNext. RoBERTa la quita sin perder calidad.' },
    { id: 'score_head', name: 'Cabeza de puntaje (cross-encoder)', paramTex: 'D + 1', macTex: 'D', outTex: 'D \\to 1', note: 'Linear D → 1 con sesgo sobre el pooler: la relevancia del par (query, documento).' },
    { id: 'cross_entropy', name: 'Cross-entropy', paramTex: '0', macTex: '0', outTex: 'R\\times C \\to 1', note: '−log softmax en la clase correcta, promediada sobre las R filas que tienen etiqueta.' },
    { id: 'dot_score', name: 'Producto punto (score)', paramTex: '0', macTex: 'M\\,D', outTex: 'D,\\ M\\times D \\to M', note: 'q·d por cada vector comparado; con vectores normalizados es el coseno. Contra todo el corpus: N·D MACs por query.' },
    { id: 'token_sim', name: 'Similitud token a token', paramTex: '0', macTex: 'T_q\\,T_d\\,D', outTex: 'T_q\\times D,\\ T_d\\times D \\to T_q\\times T_d', note: 'ColBERT: cada token de la query contra cada token del documento.' },
    { id: 'max_reduce', name: 'Máximo por fila', paramTex: '0', macTex: '0', outTex: 'R\\times C \\to R', note: 'MaxSim: el mejor token del documento para cada token de la query.' },
    { id: 'sum_reduce', name: 'Suma', paramTex: '0', macTex: '0', outTex: 'R \\to 1', note: 'Σ sobre los tokens de la query.' },
    { id: 'maxsim', name: 'MaxSim (interacción tardía)', paramTex: '0', macTex: 'T_q\\,T_d\\,D', outTex: 'T_q\\times D,\\ T_d\\times D \\to 1', note: 's(q, d) = Σ_i máx_j q_i·d_j. Los vectores del documento se precalculan; el costo es por par.' },
    { id: 'topk_scores', name: 'Top-k', paramTex: '0', macTex: '0', outTex: 'N \\to k', note: 'Los k mayores puntajes (heap / argpartition: ≈ N comparaciones).' },
    { id: 'truncate_dim', name: 'Truncar dimensión', paramTex: '0', macTex: '0', outTex: 'D \\to dim', note: 'Matryoshka: quedarse con las primeras dim coordenadas (solo sirve si el modelo se entrenó así).' },
    { id: 'embed_index', name: 'Índice de embeddings', paramTex: '0', macTex: '0', outTex: 'D \\to N\\times D', note: 'Offline: N vectores guardados a bits por número: N·D·bits/8 bytes.' },
    { id: 'flat_scan', name: 'Búsqueda exacta (flat)', paramTex: '0', macTex: 'N\\,d', outTex: 'd,\\ N\\times d \\to N', note: 'Fuerza bruta: N distancias exactas por query; lee los N·d números del índice.' },
    { id: 'hnsw_descent', name: 'HNSW: descenso por niveles', paramTex: '0', macTex: '\\approx \\lfloor\\log_M N\\rfloor\\,M\\,d', outTex: 'd \\to 1', note: 'Voraz por los niveles superiores (pocos nodos, enlaces largos) hasta el punto de entrada del nivel 0.' },
    { id: 'hnsw_beam', name: 'HNSW: búsqueda en el nivel 0', paramTex: '0', macTex: '\\approx ef\\cdot 2M\\cdot d', outTex: 'd \\to ef', note: 'Lista de ef candidatos; cada expansión revisa ≤ 2M vecinos. Más ef = más recall y más distancias. ef·2M es una estimación, no una cota: medido con FAISS, 0.44–1.02×.' },
    { id: 'ivf_coarse', name: 'IVF: cuantizador grueso', paramTex: 'n_{\\mathrm{list}}\\,d', macTex: 'n_{\\mathrm{list}}\\,d', outTex: 'd \\to n_{\\mathrm{list}}', note: 'q contra los n_list centroides de k-means; se recorren solo las n_probe listas más cercanas. Con un HNSW sobre los centroides (escala de mil millones): ≈ (⌊log_M n_list⌋·M + ef·2M)·d MACs y salen los ef centroides candidatos.' },
    { id: 'ivf_residual', name: 'IVF: residuo', paramTex: '0', macTex: '0', outTex: 'd \\to n_{\\mathrm{probe}}\\times d', note: 'q − c_i para cada lista elegida (PQ codifica residuos).' },
    { id: 'pq_lut', name: 'PQ: tablas ADC', paramTex: 'k_s\\,d', macTex: 'k_s\\,d', outTex: '\\to n_{\\mathrm{probe}}\\times m\\times k_s', note: 'Distancia de cada sub-vector a los k_s = 2^nbits centroides de su sub-espacio; los codebooks (k_s·d floats) son los parámetros.' },
    { id: 'pq_scan', name: 'PQ: recorrer códigos (ADC)', paramTex: '0', macTex: '0', outTex: '\\to n_{\\mathrm{probe}}N/n_{\\mathrm{list}}', note: 'Cada código: m consultas a la tabla y m sumas, sin MACs. Lee m bytes (+ 8 del id) por vector.' },
    { id: 'conv1d', name: 'Conv1d', paramTex: 'k\\,C_{in}\\,C_{out} + C_{out}', macTex: 'T_o\\,C_{out}\\,k\\,C_{in}', outTex: 'T\\times C_{in} \\to T_o\\times C_{out}', note: 'Convolución sobre el tiempo (T_o = ⌊(T + 2p − k)/s⌋ + 1). Front end de Whisper: k = 3, la segunda con stride 2: 3,000 frames mel → 1,500 posiciones.' },
    { id: 't5_rel_bias', name: 'Sesgo de posición relativa (T5)', paramTex: 'n_b\\,h', macTex: '0', outTex: '\\to h\\times T_q\\times T_k', note: 'Tabla aprendida de n_b = 32 buckets × h cabezas: un escalar por (bucket(k − q), cabeza) sumado a QKᵀ. Buckets exactos para distancias chicas y logarítmicos hasta 128. Una tabla por stack, calculada en la capa 1.' },
    { id: 'add_rel_bias', name: 'Sumar el sesgo relativo', paramTex: '0', macTex: '0', outTex: 'h\\times T_q\\times T_k \\to h\\times T_q\\times T_k', note: 'scores + B antes del softmax (T5 no escala por 1/√d_h).' },
    { id: 'pad_or_trim', name: 'Rellenar o cortar a 30 s', paramTex: '0', macTex: '0', outTex: 'S \\to 480000', note: 'Whisper siempre procesa ventanas de 30 s (480,000 muestras a 16 kHz): el audio corto se rellena con ceros.' },
    { id: 'log_mel', name: 'Espectrograma log-Mel', paramTex: '0', macTex: '0', outTex: 'S \\to (S/160)\\times n_{\\mathrm{mels}}', note: 'STFT (25 ms, hop 10 ms) + banco de filtros mel + log: 100 frames por segundo, 3,000 por ventana. Preprocesamiento: fuera de los MACs del modelo.' },
  ];
  function primitives() { return PRIM_INFO.map((p) => Object.assign({}, p)); }

  // ------------------------------------------------------------------ grafo
  function graph(cfg) {
    const tensors = {}, order = [], ops = [], opIds = new Set();

    function addTensor(id, sh, meta, producer) {
      if (!id || typeof id !== 'string') throw new Error('Tensor sin id.');
      if (tensors[id]) throw new Error('Tensor "' + id + '" definido dos veces.');
      meta = meta || {};
      tensors[id] = {
        id, sym: sh.sym.slice(), num: sh.num.slice(), mod: sh.mod, layout: sh.layout,
        tex: meta.tex || id, label: meta.label || id, producer: producer || null, consumers: [],
        perLayer: !!meta.perLayer, elements: elems(sh),
      };
      if (meta.note) tensors[id].note = meta.note;
      if (meta.batched) tensors[id].batched = true;   // ya incluye el batch B (CLIP: parte conjunta)
      order.push(id);
      return Object.assign(plain(sh), { id });
    }

    return {
      cfg,
      input(id, sh, meta) { return addTensor(id, sh, meta, null); },
      tensor(id) { const t = tensors[id]; if (!t) throw new Error('Tensor desconocido: ' + id); return Object.assign(plain(t), { id }); },
      has(id) { return !!tensors[id]; },   // fase 7 (importGraph)
      // op(id, resultadoDePrimitiva, {path|node, out, outMeta, label, repeat, paramRepeat?, type, group, in?})
      // paramRepeat (fase 7): cuántas copias DISTINTAS de los pesos hay (por defecto = repeat). Difiere cuando la misma
      // op corre varias veces con pesos compartidos: la torre de visión de LLaVA con `images` > 1 corre images veces
      // (MACs × repeat) pero sus pesos existen una sola vez (parámetros × paramRepeat).
      op(id, res, o) {
        o = o || {};
        if (opIds.has(id)) throw new Error('Operación "' + id + '" definida dos veces.');
        opIds.add(id);
        const path = o.path ? o.path.slice() : (o.node ? [o.node] : [id]);
        const ins = o.in || res.inputs.filter((h) => h && h.id).map((h) => h.id);
        ins.forEach((tid) => { if (!tensors[tid]) throw new Error('Op "' + id + '": entrada desconocida "' + tid + '".'); });
        const outsSh = Array.isArray(res.out) ? res.out : [res.out];
        const outIds = Array.isArray(o.out) ? o.out : [o.out || id];
        if (outIds.length !== outsSh.length) throw new Error('Op "' + id + '": ' + outsSh.length + ' salidas y ' + outIds.length + ' ids.');
        const metas = Array.isArray(o.outMeta) ? o.outMeta : [o.outMeta || {}];
        const handles = outIds.map((tid, i) => addTensor(tid, outsSh[i], metas[i] || {}, id));
        ins.forEach((tid) => tensors[tid].consumers.push(id));
        ops.push({
          id, prim: res.prim, label: o.label || id, path, node: path[path.length - 1],
          in: ins, out: outIds, repeat: o.repeat || 1, paramRepeat: o.paramRepeat != null ? o.paramRepeat : (o.repeat || 1),
          params: res.params, macs: res.macs, other: res.other,
          paramTex: o.paramTex || res.paramFormula, paramArith: res.paramArith,
          macTex: o.macTex || res.macFormula, macArith: res.macArith,
          shapeTex: res.shapeTex, type: o.type || 'tensorop', group: o.group || 'other',
          detail: res.detail || {},
        });
        if (o.batched) ops[ops.length - 1].batched = true;   // sus MACs ya incluyen el batch B
        // where: contexto para mostrar (de lo general a lo particular), p. ej. ['Stage 2', 'bloque 1 (W-MSA)']
        // o ['Torre de texto']; lo usa la práctica para nombrar sin ambigüedad. No cambia ningún número.
        if (Array.isArray(o.where) && o.where.length) ops[ops.length - 1].where = o.where.slice();
        return handles.length === 1 ? handles[0] : handles;
      },
      _data() { return { tensors, order, ops }; },
    };
  }

  // Bloque pre-LN reutilizable (ViT, transformer de juguete, torres de CLIP). Ids de SPEC §13.1/13.2.
  // prefix = path de nodos que contiene la capa (p. ej. ['encoder','enc-layer']).
  // o = {L, h, Dmlp, qkvBias, projBias, mlpBias, causal, outId='x-out',
  //      tid='' (prefijo de ids de tensor: 'i-' → 'i-h-ln1'), oid='' (prefijo de ids de op),
  //      maskOp (máscara causal como op propia, nodo 'mask', tensor '<tid>masked'), actLabel,
  //      where (contexto de las ops, p. ej. ['Torre de imagen']), labelPrefix (prefijo de las etiquetas
  //      de tensor, p. ej. 'Torre de imagen · ')}
  // Sin tid/oid/maskOp/where/labelPrefix el resultado es exactamente el de la fase 1.
  // Fase 7 (VLM), todas opcionales y sin efecto si se omiten: hSym / dhSym / DmlpSym (símbolos de las cabezas, d_h y el
  // MLP: la torre de visión de un VLM usa h_v, d_v y 4D_v para no chocar con los del LLM), rope (función ({op, T, at, L},
  // q, k) → [q', k'] que inserta la rotación entre split y scores: RoPE 2-D del ViT de Qwen2-VL), outMeta (metadatos del
  // tensor de salida) y entradas con dimensiones delanteras (segmentos × N × D: atención por segmento, como las ventanas).
  // paramL (opcional): copias distintas de los pesos (op.paramRepeat) cuando L cuenta además ejecuciones con pesos
  // compartidos (LLaVA con images > 1: L = capas × imágenes, paramL = capas). Por defecto = L.
  function preLnLayer(g, x, o) {
    const P = o.prefix || ['enc-layer'];
    const rep = o.L || 1;
    const prep = o.paramL || rep;
    const L = (meta) => Object.assign({ perLayer: true }, meta);
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    const at = P.concat(['mhsa']), ml = P.concat(['mlp']);
    const T = (n) => (o.tid || '') + n, O = (n) => (o.oid || '') + n;
    const pre = o.labelPrefix || '';
    const tag = (m) => (pre && m && m.label ? Object.assign({}, m, { label: pre + m.label }) : m);
    const op = (id, res, path, extra) => {
      const e = Object.assign({ path, repeat: rep, paramRepeat: prep }, extra);
      if (o.where) e.where = o.where;
      if (pre && e.outMeta) e.outMeta = Array.isArray(e.outMeta) ? e.outMeta.map(tag) : tag(e.outMeta);
      return g.op(O(id), res, e);
    };
    const sepMask = !!o.maskOp;

    const hln1 = op('ln1', layernorm(x), P.concat(['ln1']), { out: T('h-ln1'), label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada (LN 1)', tex: '\\mathrm{LN}_1(x)' }) });
    const qkv = op('qkv', linear(hln1, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false }), at.concat(['qkv']), { out: T('qkv'), label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }) });
    let [q, k, v] = op('split', split_heads(qkv, { h: o.h, parts: 3, hSym: o.hSym, dhSym: o.dhSym }), at.concat(['split']), {
      out: [T('q'), T('k'), T('v')], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Queries por cabeza', tex: 'Q' }), L({ label: 'Keys por cabeza', tex: 'K' }), L({ label: 'Values por cabeza', tex: 'V' })],
    });
    if (o.rope) [q, k] = o.rope({ op, T, at, L }, q, k);
    const sc = op('scores', attention_scores(q, k), at.concat(['scores']), { out: T('scores'), label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const inScale = !!o.causal && !sepMask;
    let ss = op('scale', scale(sc, { causal: inScale }), at.concat(['scale']), {
      out: T('scores-scaled'), label: inScale ? 'Escala 1/√d_h + máscara causal' : 'Escala 1/√d_h', type: 'attn', group: 'attn',
      outMeta: L({ label: inScale ? 'Scores escalados y enmascarados' : 'Scores escalados', tex: inScale ? 'QK^\\top/\\sqrt{d_h} + M' : 'QK^\\top/\\sqrt{d_h}' }),
    });
    if (sepMask) {
      ss = op('mask', causal_mask(ss), at.concat(['mask']), {
        out: T('masked'), label: 'Máscara causal', type: 'attn', group: 'attn',
        outMeta: L({ label: 'Scores enmascarados (−∞ sobre el futuro)', tex: 'QK^\\top/\\sqrt{d_h} + M_{\\mathrm{causal}}' }),
      });
    }
    const a = op('softmax', softmax(ss), at.concat(['softmax']), { out: T('attn'), label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', attention_weighted_sum(a, v), at.concat(['weighted-sum']), { out: T('z-heads'), label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', merge_heads(zh, { Dsym: Ds }), at.concat(['merge']), { out: T('z'), label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    const ov = op('proj', linear(z, { dout: D, doutSym: Ds, bias: o.projBias !== false }), at.concat(['proj']), { out: T('o'), label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'Salida de la atención', tex: 'O = ZW_O' }) });
    const r1 = op('res1', residual_add(x, ov), P.concat(['res1']), { out: T('r1'), label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: "x'" }) });
    const hln2 = op('ln2', layernorm(r1), P.concat(['ln2']), { out: T('h-ln2'), label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada (LN 2)', tex: "\\mathrm{LN}_2(x')" }) });
    const u = op('fc1', linear(hln2, { dout: o.Dmlp, doutSym: o.DmlpSym || 'D_mlp', bias: o.mlpBias !== false }), ml.concat(['fc1']), { out: T('u'), label: 'MLP: capa 1 (expansión)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Capa oculta del MLP', tex: 'U = \\mathrm{LN}_2(x\')W_1 + b_1' }) });
    const gg = op('gelu', gelu(u), ml.concat(['gelu']), { out: T('g'), label: o.actLabel || 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Activación', tex: o.actTex || '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', linear(gg, { dout: D, doutSym: Ds, bias: o.mlpBias !== false }), ml.concat(['fc2']), { out: T('f'), label: 'MLP: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Salida del MLP', tex: 'F' }) });
    // res2 produce x_ℓ; tras la última de las L repeticiones es x_L (de ahí el id 'x-out').
    return op('res2', residual_add(r1, f), P.concat(['res2']), {
      out: o.outId || T('x-out'), label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: o.outMeta || { label: 'Salida del encoder (x_L)', tex: 'x_L', perLayer: false, note: 'Salida de cada capa x_ℓ; tras la capa L es x_L.' },
    });
  }


  // postLnLayer (fase 11, BERT): capa POST-LN, como el Transformer original y BERT: x → MHSA → r1 = x + O → LN₁ → MLP →
  // r2 = LN₁ + F → LN₂ (la salida). Mismos ids de op y de nodo que preLnLayer (qkv, split, scores, scale, softmax, weighted-sum,
  // merge, proj bajo mhsa; fc1, gelu, fc2 bajo mlp; res1, ln1, res2, ln2) y de tensor (qkv, q, k, v, scores, scores-scaled,
  // attn, z-heads, z, o, r1, h-ln1, u, g, f) más r2 (antes de LN₂) y la salida o.outId (por defecto <tid>x-out). OJO: aquí
  // h-ln1 = LN₁(x + O) (la entrada del MLP), no LN₁(x). HF BertSelfAttention tiene W_Q, W_K, W_V separadas: el conteo es el
  // mismo que la qkv fusionada (3·(D² + D)). o = {prefix, L, h, Dmlp, DmlpSym, qkvBias, projBias, mlpBias, tid, oid, where,
  // labelPrefix, outMeta, paramL (copias de los pesos; 0 = pesos compartidos con otra torre), hSym, dhSym}
  function postLnLayer(g, x, o) {
    const P = o.prefix || ['enc-layer'];
    const rep = o.L || 1;
    const prep = o.paramL != null ? o.paramL : rep;
    const L = (meta) => Object.assign({ perLayer: true }, meta);
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    const at = P.concat(['mhsa']), ml = P.concat(['mlp']);
    const T = (n) => (o.tid || '') + n, O = (n) => (o.oid || '') + n;
    const pre = o.labelPrefix || '';
    const tag = (m) => (pre && m && m.label ? Object.assign({}, m, { label: pre + m.label }) : m);
    const op = (id, res, path, extra) => {
      const e = Object.assign({ path, repeat: rep, paramRepeat: prep }, extra);
      if (o.where) e.where = o.where;
      if (pre && e.outMeta) e.outMeta = Array.isArray(e.outMeta) ? e.outMeta.map(tag) : tag(e.outMeta);
      return g.op(O(id), res, e);
    };
    const qkv = op('qkv', linear(x, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false }), at.concat(['qkv']), { out: T('qkv'), label: 'Proyección Q, K, V (W_Q, W_K, W_V)', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\;K\;V]' }) });
    const [q, k, v] = op('split', split_heads(qkv, { h: o.h, parts: 3, hSym: o.hSym, dhSym: o.dhSym }), at.concat(['split']), {
      out: [T('q'), T('k'), T('v')], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Queries por cabeza', tex: 'Q' }), L({ label: 'Keys por cabeza', tex: 'K' }), L({ label: 'Values por cabeza', tex: 'V' })],
    });
    const sc = op('scores', attention_scores(q, k), at.concat(['scores']), { out: T('scores'), label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const ss = op('scale', scale(sc), at.concat(['scale']), { out: T('scores-scaled'), label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const a = op('softmax', softmax(ss), at.concat(['softmax']), { out: T('attn'), label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', attention_weighted_sum(a, v), at.concat(['weighted-sum']), { out: T('z-heads'), label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', merge_heads(zh, { Dsym: Ds }), at.concat(['merge']), { out: T('z'), label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    const ov = op('proj', linear(z, { dout: D, doutSym: Ds, bias: o.projBias !== false }), at.concat(['proj']), { out: T('o'), label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'Salida de la atención', tex: 'O = ZW_O' }) });
    const r1 = op('res1', residual_add(x, ov), P.concat(['res1']), { out: T('r1'), label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención (antes de LN 1)', tex: 'x + O' }) });
    const h1 = op('ln1', layernorm(r1), P.concat(['ln1']), { out: T('h-ln1'), label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'Tras LayerNorm 1 (entrada del MLP)', tex: "x' = \\mathrm{LN}_1(x + O)" }) });
    const u = op('fc1', linear(h1, { dout: o.Dmlp, doutSym: o.DmlpSym || 'D_mlp', bias: o.mlpBias !== false }), ml.concat(['fc1']), { out: T('u'), label: 'MLP: capa 1 (expansión)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Capa oculta del MLP', tex: "U = x'W_1 + b_1" }) });
    const gg = op('gelu', gelu(u), ml.concat(['gelu']), { out: T('g'), label: 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Activación', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', linear(gg, { dout: D, doutSym: Ds, bias: o.mlpBias !== false }), ml.concat(['fc2']), { out: T('f'), label: 'MLP: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Salida del MLP', tex: 'F' }) });
    const r2 = op('res2', residual_add(h1, f), P.concat(['res2']), { out: T('r2'), label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "x' + MLP (antes de LN 2)", tex: "x' + F" }) });
    return op('ln2', layernorm(r2), P.concat(['ln2']), {
      out: o.outId || T('x-out'), label: 'LayerNorm 2 (post-LN)', type: 'norm', group: 'norm',
      outMeta: o.outMeta || { label: 'Salida del encoder (x_L)', tex: "x_L = \\mathrm{LN}_2(x' + F)", perLayer: false, note: 'Salida de cada capa x_ℓ; tras la capa L es x_L.' },
    });
  }

  // importGraph (fase 7): compone un modelo con el grafo de OTRO (p. ej. el decoder de js/arch/llm.js dentro de un VLM) sin
  // duplicar su constructor: copia las ops de src = otroGrafo._data() (o un resultado de run) con sus números, etiquetas,
  // fórmulas y repeticiones. o = {
  //   skip: [opIds] que no se importan; inputs: {idOrigen: idDestino} (tensores que ya existen en g);
  //   opId(id), tensorId(id): renombrar; path(p), where(w): nuevo path / contexto; sym: {símbolo: nuevo} en las formas;
  //   tex(s): reescribe fórmulas TeX (mismo cambio de símbolos); label(l): etiqueta de cada tensor importado;
  //   replace(op, ins): null o {res, in?, label?} para cambiar una op (sesgos de Qwen2, M-RoPE…) }
  // Las entradas sin productor que no estén en `inputs` se crean con g.input. Devuelve {idOrigen: handle} de las salidas.
  function importGraph(g, src, o) {
    o = o || {};
    const skip = new Set(o.skip || []);
    const imap = o.inputs || {};
    const tid = (id) => (imap[id] !== undefined ? imap[id] : (o.tensorId ? o.tensorId(id) : id));
    const sm = o.sym || {};
    const msym = (s) => (sm[s] !== undefined ? sm[s] : s);
    const mshape = (t) => shape(t.sym.map(msym), t.num.slice(), t.mod, t.layout);
    const tex = o.tex || ((s) => s);
    const lab = o.label || ((l) => l);
    const meta = (t) => {
      const m = { label: lab(t.label), tex: t.tex, perLayer: t.perLayer };
      if (t.note) m.note = t.note;
      if (t.batched) m.batched = true;
      return m;
    };
    const handles = {};
    for (const op of src.ops) {
      if (skip.has(op.id)) continue;
      const ins = op.in.map((id) => {
        const nid = tid(id);
        if (!g.has(nid)) g.input(nid, mshape(src.tensors[id]), meta(src.tensors[id]));
        return nid;
      });
      const outIds = op.out.map(tid);
      const rp = o.replace ? o.replace(op, ins.map((id) => g.tensor(id))) : null;
      let res;
      if (rp) res = rp.res;
      else {
        const outs = op.out.map((id) => mshape(src.tensors[id]));
        res = { prim: op.prim, inputs: [], out: outs.length === 1 ? outs[0] : outs, params: op.params, macs: op.macs, other: op.other,
          paramFormula: tex(op.paramTex), macFormula: tex(op.macTex), paramArith: op.paramArith, macArith: op.macArith,
          shapeTex: tex(op.shapeTex), detail: op.detail };
      }
      const e = { path: o.path ? o.path(op.path.slice()) : op.path.slice(), in: (rp && rp.in) || ins, out: outIds.length === 1 ? outIds[0] : outIds,
        outMeta: op.out.map((id) => meta(src.tensors[id])), label: (rp && rp.label) || op.label, repeat: op.repeat, paramRepeat: op.paramRepeat, type: op.type, group: op.group };
      if (outIds.length === 1) e.outMeta = e.outMeta[0];
      const w = o.where ? o.where((op.where || []).slice()) : op.where;
      if (w && w.length) e.where = w;
      if (op.batched) e.batched = true;
      const h = g.op(o.opId ? o.opId(op.id) : op.id, res, e);
      (Array.isArray(h) ? h : [h]).forEach((x, i) => { handles[op.out[i]] = x; });
    }
    return handles;
  }

  // ------------------------------------------------------------------ modelos y configs
  const models = {};          // id → definición
  const configIndex = {};     // configId → modelId
  const memo = {};

  function defineModel(def) {
    if (!def || !def.id) throw new Error('defineModel: falta id.');
    if (models[def.id]) throw new Error('defineModel: el modelo "' + def.id + '" ya existe.');
    for (const cid of Object.keys(def.configs || {})) {
      if (configIndex[cid]) throw new Error('defineModel: la config "' + cid + '" ya existe.');
      configIndex[cid] = def.id;
    }
    models[def.id] = def;
  }

  function modelOf(configId) {
    const m = configIndex[configId];
    if (!m) throw new Error('Configuración desconocida: "' + configId + '".');
    return models[m];
  }

  // Fase 6: 'bandwidth', 'peakFlops' y 'hbmBytes' son entradas de hardware de metrics() (cotas ≈ de tokens/s y memoria).
  const NON_ARCH = ['B', 'dtype', 'ctx', 'bandwidth', 'peakFlops', 'hbmBytes'];   // no cambian la arquitectura (solo bytes)…
  // …salvo que el modelo los declare como knob (CLIP: B cambia los tensores conjuntos B×E y B×B).
  const nonArch = (def) => NON_ARCH.filter((k) => !(def.knobs && k in def.knobs));

  function resolve(configId, overrides) {
    const def = modelOf(configId);
    const base = Object.assign({}, def.configs[configId]);
    const ov = Object.assign({}, overrides || {});
    nonArch(def).forEach((k) => delete ov[k]);
    for (const key of Object.keys(ov)) {
      if (!def.knobs || !(key in def.knobs)) throw new Error('Knob inválido "' + key + '" para el modelo "' + def.id + '". Válidos: ' + Object.keys(def.knobs || {}).join(', ') + '.');
      const v = ov[key];
      // Fase 8: def.zeroKnobs = knobs que aceptan 0 (cfg: 0 = sin classifier-free guidance). El resto, enteros positivos.
      const zero = Array.isArray(def.zeroKnobs) && def.zeroKnobs.indexOf(key) >= 0;
      if (!Number.isInteger(v) || v < (zero ? 0 : 1)) throw new Error('Knob "' + key + '": el valor debe ser un entero ' + (zero ? 'no negativo' : 'positivo') + ' (recibí ' + v + ').');
    }
    const cfg = def.applyKnobs ? def.applyKnobs(base, ov) : Object.assign(base, ov);
    return def.resolve ? def.resolve(cfg) : cfg;
  }

  function memoKey(configId, overrides) {
    const ov = Object.assign({}, overrides || {});
    nonArch(modelOf(configId)).forEach((k) => delete ov[k]);
    return configId + '|' + Object.keys(ov).sort().map((k) => k + '=' + ov[k]).join(',');
  }

  // Copias de los pesos de una op (op.paramRepeat; por defecto op.repeat). Los totales de parámetros usan esto; los MACs,
  // op.repeat. Úsalo en la UI en vez de params × repeat.
  function paramRep(op) { return op && op.paramRepeat != null ? op.paramRepeat : (op && op.repeat) || 1; }

  function run(configId, overrides) {
    const key = memoKey(configId, overrides);
    if (memo[key]) return memo[key];
    const def = modelOf(configId);
    const cfg = resolve(configId, overrides);
    const g = def.build(cfg, A);   // build(cfg, A) crea su grafo con A.graph(cfg) y lo devuelve (SPEC §6.4)
    if (!g || typeof g._data !== 'function') throw new Error('El modelo "' + def.id + '" no devolvió un grafo en build().');
    const { tensors, order, ops } = g._data();

    // byPath: como byNode pero con la ruta completa ('img-encoder>enc-layer'): distingue nodos con el
    // mismo id en dos lugares (las dos torres de CLIP; W-MSA y SW-MSA de Swin, que comparten 'qkv', …).
    const totals = { params: 0, macs: 0, flops: 0, other: 0, byNode: {}, byPath: {}, byPrim: {}, byGroup: {} };
    const bump = (map, k, op) => {
      const e = map[k] || (map[k] = { params: 0, macs: 0, other: 0 });
      e.params += op.params * paramRep(op); e.macs += op.macs * op.repeat; e.other += op.other * op.repeat;
    };
    for (const op of ops) {
      totals.params += op.params * paramRep(op);
      totals.macs += op.macs * op.repeat;
      totals.other += op.other * op.repeat;
      new Set(op.path).forEach((n) => bump(totals.byNode, n, op));
      op.path.forEach((n, i) => bump(totals.byPath, op.path.slice(0, i + 1).join('>'), op));
      bump(totals.byPrim, op.prim, op);
      bump(totals.byGroup, op.group, op);
    }
    totals.flops = 2 * totals.macs;

    const r = {
      id: configId, model: def.id, label: cfg.label || configId, config: cfg, paper: def.paper || null,
      overrides: Object.assign({}, overrides || {}),
      tensors, order, ops, totals, quantities: {}, notes: (cfg._notes || []).slice(),
    };
    delete cfg._notes;
    r.quantities = Object.assign({}, def.quantities ? def.quantities(cfg, r) : {});
    if (r.quantities.tokens === undefined && cfg.tokens !== undefined) r.quantities.tokens = cfg.tokens;
    memo[key] = r;
    return r;
  }

  const DTYPE_BYTES = { fp32: 4, tf32: 4, fp16: 2, bf16: 2, fp8: 1, int8: 1 };

  // Tensores que NO cuentan como activaciones guardadas en actMem: vistas y movimientos de datos
  // (reshape/permute/roll: no los guarda el backward), tablas de parámetros (no son activaciones) y
  // los scores previos al softmax (temporales: el backward de softmax usa su salida A; el de QKᵀ, Q y K).
  const NOT_SAVED = {
    split_heads: 1, merge_heads: 1, flatten: 1, window_partition: 1, window_reverse: 1, cyclic_shift: 1,
    pool_cls: 1, pick_token: 1, stack_batch: 1, pos_embed_learned: 1,
    attention_scores: 1, scale: 1, rel_pos_bias: 1, attn_mask: 1, causal_mask: 1,
    // Fase 3: vistas (split_qkv_heads, flatten_levels), tablas de parámetros (learned_queries, level_embed) y
    // tensores constantes calculados (PE seno/coseno, ceros, puntos de referencia del encoder).
    split_qkv_heads: 1, flatten_levels: 1, learned_queries: 1, level_embed: 1, sine_pos_encoding: 1, zeros_init: 1, reference_points: 1,
    // Fase 4: vistas (split_channels, transpose_scores), constantes calculadas (máscara de sub-oraciones, PE 1-D, cajas
    // ancla) y scores previos a la reducción / al softmax (token_mask, text_guided_scores: el max solo guarda índices).
    split_channels: 1, transpose_scores: 1, subsentence_mask: 1, sine_pos_1d: 1, encoder_proposals: 1, token_mask: 1, text_guided_scores: 1,
    // Fase 5: vistas y movimientos (ventanas con relleno, filas, rejilla, punteros partidos, repetición, selección), tablas de
    // parámetros y constantes (tokens aprendidos, posición absoluta y por ventanas, rejilla de coordenadas, no-mask
    // repetido) y el sesgo descompuesto previo al softmax.
    window_partition_pad: 1, window_unpartition: 1, decomposed_rel_pos: 1, take_rows: 1, to_grid: 1, split_tokens: 1, repeat_rows: 1,
    mask_select: 1, learned_tokens: 1, pos_embed_grid: 1, window_pos_embed: 1, coord_grid: 1, broadcast_embed: 1, append_pad_point: 1,
    // Fase 6: vista de cabezas (GQA), concatenación con la KV cache (inferencia) y el id muestreado.
    split_gqa_heads: 1, kv_append: 1, sample_token: 1,
    // Fase 7: vistas (repetir la imagen en el tiempo, segmentos, agrupar 2×2) y los ids de posición de M-RoPE (constante).
    repeat_frames: 1, segment_rows: 1, group_tokens: 1, mrope_ids: 1,
    // Fase 8: constantes calculadas (embedding sinusoidal del paso, posición sin/cos 2-D) y la vista unpatchify.
    timestep_embedding: 1, sincos_pos_2d: 1, unpatchify: 1, concat_features: 1,
    // Fase 11: el índice offline de embeddings (N vectores guardados: no es una activación del forward) y la vista truncate_dim.
    embed_index: 1, truncate_dim: 1,
    // Fase 12: el sesgo relativo de T5 (constante por stack, calculado de la tabla), los scores con sesgo (previos al softmax)
    // y el audio rellenado (entrada cruda).
    t5_rel_bias: 1, add_rel_bias: 1, pad_or_trim: 1,
  };

  // metrics: números derivados para el explorador de escala y el "¿qué pasa si…?" (SPEC §6.5).
  function metrics(configId, overrides) {
    const ov = overrides || {};
    const dtype = ov.dtype || 'bf16';
    if (!DTYPE_BYTES[dtype]) throw new Error('dtype desconocido: "' + dtype + '". Válidos: ' + Object.keys(DTYPE_BYTES).join(', ') + '.');
    if (ov.B !== undefined && (!Number.isInteger(ov.B) || ov.B <= 0)) throw new Error('B debe ser un entero positivo.');
    const def = modelOf(configId);
    const r = run(configId, ov);
    const cfg = r.config, t = r.totals;
    // B por defecto 1; en modelos con knob B (CLIP) el de la config (32,768).
    const B = ov.B !== undefined ? ov.B : (def.knobs && 'B' in def.knobs && cfg.B ? cfg.B : 1);
    const by = bytesOf(dtype);
    const opById = {};
    r.ops.forEach((op) => { opById[op.id] = op; });
    const isScore = (op) => op.prim === 'attention_scores' || op.prim === 'attention_weighted_sum';
    const scoreMacs = r.ops.filter(isScore).reduce((s, op) => s + op.macs * op.repeat, 0);
    const attnMacs = (t.byGroup.attn || { macs: 0 }).macs;
    // Lineales dentro de las capas (proyecciones de atención + MLP).
    const linearMacs = r.ops.filter((op) => op.prim === 'linear' && (op.group === 'attn' || op.group === 'mlp'))
      .reduce((s, op) => s + op.macs * op.repeat, 0);
    // Tensores de scores h×N×N (uno por op attention_scores): el mayor de una capa, y todos.
    const scoreTs = r.ops.filter((op) => op.prim === 'attention_scores').map((op) => ({ t: r.tensors[op.out[0]], rep: op.repeat }));
    const attnMemLayer = scoreTs.reduce((m, x) => Math.max(m, x.t.elements), 0) * by * B;
    const attnMemAll = scoreTs.reduce((s, x) => s + x.t.elements * x.rep, 0) * by * B;
    const layers = cfg.L || 1;
    // Activaciones (≈, entrenamiento): cada tensor materializado del forward, una vez por repetición de
    // la op que lo produce; sin vistas, sin tablas de parámetros ni scores previos al softmax (NOT_SAVED).
    let actElems = 0, actElemsBatched = 0;
    for (const id of r.order) {
      const x = r.tensors[id];
      const prod = x.producer ? opById[x.producer] : null;
      if (prod && NOT_SAVED[prod.prim]) continue;
      const n = x.elements * (prod ? prod.repeat : 1);
      if (x.batched) actElemsBatched += n; else actElems += n;
    }
    const out = {
      id: configId, overrides: Object.assign({}, ov), B, dtype, bytesPerElement: by,
      tokens: r.quantities.tokens,
      params: t.params, macs: t.macs, flops: t.flops, other: t.other,
      attnMacs, attnMacsShare: t.macs ? attnMacs / t.macs : 0,
      scoreMacs, scoreMacsShare: t.macs ? scoreMacs / t.macs : 0,
      linearMacs,
      attnMem: attnMemLayer,                    // bytes: el mayor tensor de scores de UNA capa, ×B (FlashAttention no lo materializa)
      attnMemAllLayers: attnMemAll,             // si se guardan los de todas las capas (entrenamiento sin recomputar)
      actMem: (actElems * B + actElemsBatched) * by,  // ≈ entrenamiento: activaciones guardadas del forward
      actMemPerSample: actElems * by,           // lo mismo para una muestra, sin los tensores del lote (CLIP)
      paramMem: t.params * by,
      kvCache: null,
    };
    if (cfg.D && cfg.Dmlp) {
      // Por capa: scores (2N²D) vs lineales (N(4D² + 2D·D_mlp)) → se cruzan en N = 2D + D_mlp (= 6D si D_mlp = 4D).
      out.crossoverN = 2 * cfg.D + cfg.Dmlp;
      out.crossoverNProj = 2 * cfg.D;          // solo contra las proyecciones Q, K, V, O
      out.scoreToLinear = out.tokens / out.crossoverN;
    }
    if (cfg.causal && cfg.D) {
      const ctx = ov.ctx || out.tokens;
      out.kvCache = 2 * layers * ctx * cfg.D * by * B;  // K y V de cada capa
    }
    if (def.metrics) Object.assign(out, def.metrics(cfg, r, { B, by, dtype, actMemPerSample: out.actMemPerSample, actMemBatch: out.actMem, overrides: Object.assign({}, ov) }));
    return out;
  }
  function bytesOf(dtype) { return DTYPE_BYTES[dtype]; }

  function configs(model) {
    const out = [];
    for (const mid of Object.keys(models)) {
      if (model && mid !== model) continue;
      const def = models[mid];
      for (const cid of Object.keys(def.configs)) {
        const c = def.configs[cid];
        out.push({ id: cid, label: c.label || cid, model: mid, canonical: !!c.canonical });
      }
    }
    if (model && !models[model]) throw new Error('Modelo desconocido: "' + model + '".');
    return out;
  }

  function model(id) { const d = models[id]; if (!d) throw new Error('Modelo desconocido: "' + id + '".'); return d; }

  const A = Object.assign(ATLAS.Arch || {}, PRIMS, {
    shape, graph, preLnLayer, postLnLayer, importGraph, defineModel, run, metrics, resolve, fmt, primitives, paramRep,
    configs, models: () => Object.keys(models), model, hasConfig: (id) => !!configIndex[id],
    canonical: (mid) => { const c = configs(mid).find((x) => x.canonical); return c ? c.id : null; },
    DTYPE_BYTES: Object.assign({}, DTYPE_BYTES), OTHER_COST: Object.assign({}, OTHER),
    _clearMemo: () => { for (const k of Object.keys(memo)) delete memo[k]; },
  });
  ATLAS.Arch = A;
})(typeof window !== 'undefined' ? window : globalThis);
