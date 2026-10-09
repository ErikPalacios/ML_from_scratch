# Cross-check del calculador (solo desarrollo)

Compara `ATLAS.Arch` con implementaciones de referencia en PyTorch, **sin descargar pesos**
(SPEC §9.3).

```sh
python3.13 -m venv .venv && .venv/bin/pip install -r crosscheck/requirements.txt
npm run crosscheck          # regenera expected/*.json y compara (sale con 1 si algo difiere)
node tools/crosscheck-compare.mjs --no-regen   # solo compara con los JSON versionados
```

Scripts y configs (cada uno escribe `expected/<configId>.json`):

- `vit.py`: timm `create_model(..., pretrained=False, num_classes=1000)` para cada config `vit-*`, y
  HF `ViTForImageClassification(ViTConfig(...))` como segunda referencia.
- `transformer.py`: `torch.nn.TransformerEncoderLayer(8, 2, 32, norm_first=True)` para `toy-n5-d8*`.
- `swin.py` (fase 2): timm `SwinTransformer` sin pesos para `swin-t-224` (`swin_tiny_patch4_window7_224`),
  `swin-s-224` (`swin_small_…_224`), `swin-b-224` (`swin_base_…_224`) y `swin-b-384`
  (`swin_base_patch4_window12_384`, M = 12). Atención explícita (`fused_attn = False`) para enganchar
  el softmax; las ventanas van en el eje del batch, así que con B = 1 la forma [nW, M², C] ya es la
  del calculador. El JSON registra ventana y shift de cada bloque (`windows`): la regla de timm de una
  sola ventana sin shift cuando el lado del mapa no supera M (stage 4 a 224 con M = 7; a 384 con M = 12).
- `resnet.py` (fase 2): torchvision `resnet50(weights=None)` para `resnet50-224` (v1.5: stride en la
  3×3 del bottleneck; BatchNorm cuenta γ y β, las running stats son buffers).
- `clip.py` (fase 2): HF `transformers.CLIPModel._from_config(CLIPConfig(...))` construido en código
  (sin hub, sin pesos; QuickGELU, atención `eager`) para `clip-vit-b16`, `clip-vit-b32`, `clip-vit-l14`
  y `clip-vit-l14-336`. El calculador cuenta por par imagen-texto: la referencia corre con B = 1
  (`calc_overrides: {B: 1}` en el JSON) y una segunda pasada con B = 4 (`batch_check`) verifica
  B × (totales) = PyTorch.
- `detr.py` (fase 3): HF `DetrForObjectDetection._from_config(DetrConfig(...))` para `detr-r50-800x1216` y
  `detr-r50-640`, y `DeformableDetrForObjectDetection._from_config(DeformableDetrConfig(...))` para
  `deformable-detr-r50`, construidos en código (backbone timm `resnet50` con `use_pretrained_backbone=False`,
  atención `eager`, sin hub). La BatchNorm del backbone es `FrozenBatchNorm2d` en HF y en el código oficial
  (γ, β, media y varianza = buffers): el mismo conteo de parámetros; el JSON trae además
  `params_official_trainable` (el oficial congela conv1 y layer1). DETR con `auxiliary_loss=False` (cabezas
  solo sobre la salida final): FLOPs exactos. Deformable DETR: FlopCounterMode no cuenta `grid_sample` ni la
  suma ponderada de las muestras, así que `flops_sampling_analytic` (5·N_q·h·L·K·d_h MACs por llamada, con las
  formas reales de cada llamada) se suma y las cabezas de las 5 capas intermedias (`flops_aux_heads_torch`,
  HF las aplica en cada forward) se restan: `flops_total = flops_counted_torch − aux + analítico`.
- `grounding_dino.py` (fase 4): HF `GroundingDinoForObjectDetection._from_config(GroundingDinoConfig())` para
  `grounding-dino-t` (896×1344, T = 16) y el mismo modelo a 672×672 y 448×448 (`grounding-dino-t-672`, `-448`, para
  comparar con YOLO-World-L @ 640 a escala parecida): Swin-T (`SwinConfig` por defecto, out_indices [2, 3, 4]) y BERT-base
  (`BertConfig` por defecto) SIN pesos, sin hub y sin tokenizer (los ids del prompt se arman con los ids especiales
  de BERT). `params_total` = HF − 1,536 (la `swin.layernorm` de SwinBackbone que el forward no usa;
  `params_total_hf_raw` guarda el crudo). FLOPs: + muestreo deformable analítico (12 llamadas) − cabezas de las 5
  capas intermedias − `encoder_logits` (solo pérdida). `flops_by_node` compara cada bloque (backbone de imagen,
  proyección, BERT, enhancer, query selection, decoder, cabezas) y `override_checks` repite con T = 64;
  `swin_windows` registra ventana y shift de cada bloque (SwinBackbone usa always_partition).
- `yolo_world.py` (fase 4): Ultralytics 8.4.174 desde los YAML del paquete: `DetectionModel('yolov8l.yaml')` para
  `yolov8l-640` y `WorldModel('yolov8l-world.yaml')` para `yolo-world-l-640`, sin pesos, sin CLIP (clip_model =
  None; los V embeddings se pasan normalizados a mano) y sin red (YOLO_CONFIG_DIR temporal, YOLO_OFFLINE=1;
  verificado con un proxy inválido). Exactos: parámetros (incluidos los 16 pesos fijos de la DFL), FLOPs, por bloque
  (`flops_by_node`) y por operador aten (`flops_by_op_groups`). YOLO-World: `override_checks` con V = 20 y `v2`
  (`yolov8l-worldv2.yaml`: sin image-pooling attention, BNContrastiveHead) ↔ `quantities.v2Params`.
- `sam.py` (fase 5): HF `SamModel._from_config(SamConfig(vision_config=...))` para `sam-vit-h-1024`, `sam-vit-l-1024` y
  `sam-vit-b-1024` (hiperparámetros de `build_sam.py` oficial) y `Sam2VideoModel._from_config(Sam2VideoConfig(...))` para
  `sam2-hiera-l`, `-bplus`, `-s` y `-t` (Hiera de `configs/sam2.1/*.yaml`), sin hub ni pesos, atención eager. SAM: 1 clic sin
  caja (+ punto de relleno), sin máscara de entrada, multimask; `params_total` = HF − 256 (la matriz gaussiana 2×128 de la PE
  de Fourier es Parameter en HF y buffer en el oficial); `override_checks` en ViT-B con P = 3, masks = 1 y maskIn = 1; el JSON
  registra ventanas con relleno (`sam_windows`: 64 → 70, 25 ventanas) y tablas relativas (`rel_pos_tables`). SAM 2: UN frame
  de seguimiento en régimen estacionario (frame 20 de una sesión de 21: frame 0 con prompt, 1…19 seguidos; 7 memorias de
  64×64×64 + 16 punteros = 28,736 tokens de memoria), medido por fases (`get_image_features`, `_run_single_frame_inference`,
  `_encode_new_memory`). HF `Sam2MultiScaleAttention` calcula un producto (query·scale)@keyᵀ que descarta (el oficial no):
  se mide con pre-hooks y se resta (`flops_hf_dead_matmul`; en Hiera-T se verifica con un forward parcheado,
  `dead_matmul_check`). `hiera_blocks` registra ancho, ventana, q-pooling y cabezas de cada bloque; `override_checks` en
  Hiera-T con memFrames = 3 y ptrs = 8 (otro modelo: num_maskmem = 4). Parámetros y FLOPs exactos (diferencia 0).
- `llm.py` (fase 6): HF `LlamaForCausalLM(LlamaConfig(...))` para `llama3-8b`, `llama3-70b` y `llama2-7b`, y
  `MixtralForCausalLM(MixtralConfig(...))` para `mixtral-8x7b`, construidos en código **en el dispositivo meta** (sin pesos
  ni memoria, sin hub; dimensiones de los `config.json` de HF y de los papers). Parámetros exactos y FLOPs con
  `FlopCounterMode` sobre tensores meta con **todas** las capas (no se extrapola): prefill de T = 2048 tokens (logits T×V,
  como HF sin `logits_to_keep`) y `override_checks` con T = 64 (también con sdpa: la fórmula de sdpa de torch no tiene término
  causal, mismo total), un paso de decode con una `DynamicCache` de ctx − 1 = 4,095 filas meta (`{decode: 1, ctx: 4096}`) y, en
  Llama 3 8B, los what-if `nKV = 32` (MHA) y `nKV = 1` (MQA) con otro `num_key_value_heads`. Los tensores meta no permiten
  construir la máscara causal (`.item()`): se pasa una máscara 4-D de ceros ya armada (no cambia FLOPs). Formas: hooks de
  módulos + parches de `apply_rotary_pos_emb` (q/k por cabeza antes y después de RoPE), `output_attentions` (A) y la caché
  (V por cabeza, K/V de todo el contexto en decode). Mixtral con `experts_implementation = 'batched_mm'` (bmm sobre las 2T
  filas enrutadas, funciona en meta); `moe_impl_check` verifica en un Mixtral diminuto con pesos reales que la implementación
  eager (bucle por experto) da los mismos FLOPs y que `grouped_mm` no se cuenta. `metrics_checks`: bytes de la KV cache por
  token medidos en la `DynamicCache` (bf16) y parámetros activos de Mixtral (total − 6/8 de los expertos).
- `vlm.py` (fase 7): HF `LlavaForConditionalGeneration(LlavaConfig(vision_config=CLIPVisionConfig(...), text_config=LlamaConfig(...)))`
  para `llava15-7b` y `llava15-13b`, y `Qwen2VLForConditionalGeneration(Qwen2VLConfig(text_config=..., vision_config=...))` para
  `qwen2-vl-7b`, `qwen2-vl-2b` (embeddings atados) y `qwen2-vl-72b`, construidos en código **en el dispositivo meta** (sin pesos
  ni hub; dimensiones de los `config.json` de llava-hf y Qwen). Parámetros y FLOPs exactos con `FlopCounterMode` sobre todas las
  capas (visión, proyector/merger, LLM y LM head; atención eager). LLaVA: 1 imagen de 336×336 (576 tokens) + T = 64; HF corre
  las 24 capas de CLIP y toma `hidden_states[−2]` sin el CLS, así que la capa 24 y `post_layernorm` se cuentan (el calculador
  las tiene como `vis-last-layer` / `ln-post`); `override_checks` con T = 256 e `images = 2`; `anyres_checks`: tokens de
  LLaVA-NeXT con `LlavaNextProcessor._get_number_of_features` ↔ `ATLAS.Arch.vlm.llavaNextTokens`. Qwen2-VL: imagen de
  812×812 (3,364 parches → 841 tokens) + T = 64; `override_checks` (7B) con 448×672, 1344×1344, T = 256 y un video de 4 frames
  (`pixel_values_videos`, atención del ViT por par de frames); `smart_resize_checks`: `smart_resize` del procesador ↔
  `ATLAS.Arch.vlm.smartResize`. Parches para meta que no cambian FLOPs: `torch_compilable_check` (cuenta de marcadores con
  `.item()`) → no-op, los ids de posición del ViT se calculan en CPU y se mueven a meta, máscara 4-D de ceros y `position_ids`
  dados (Qwen2-VL: 3×1×S, cuya forma 3×S se verifica en `rotary_emb`). `metrics_checks`: bytes de KV por token (DynamicCache,
  bf16), tokens visuales, parámetros del proyector / merger y del módulo `visual`.
- `diffusion.py` (fase 8): diffusers 0.41.0 `UNet2DConditionModel(**unet_config)`, `AutoencoderKL(**vae_config)` y
  `DiTTransformer2DModel(...)`, y transformers `CLIPTextModel` / `CLIPTextModelWithProjection(CLIPTextConfig(...))`, construidos en código
  **en el dispositivo meta** (sin pesos ni hub; hiperparámetros copiados de los `config.json` de stable-diffusion-v1-5,
  stable-diffusion-xl-base-1.0 y facebook/DiT-XL-2-256 / -512, citados en el script), atención eager (`AttnProcessor`: baddbmm + bmm).
  Stable Diffusion (`sd15-unet`, `sdxl-unet`): el grafo es UN paso de muestreo = encoder(es) de texto (77 tokens) + U-Net (1 NFE, B = 1)
  + decoder del VAE, medidos por separado y sumados; `sd15-train` = texto + encoder del VAE + U-Net. Parámetros = el checkpoint entero.
  `override_checks` con otras resoluciones; `metrics_checks` por componente; `schedule_checks`: `alphas_cumprod` del DDIMScheduler de SD,
  pasos de DDIM (leading, steps_offset 1) y evaluaciones de PNDM (n + 1) ↔ `ATLAS.Arch.diffusion`. DiT (`dit-xl2-256`, `-512`, `-xl4-256`,
  `-xl8-256`, `-b2-256`, `-xl2-256-fm`): diffusers duplica el embedder de tiempo + clase en cada bloque (y lo corre L + 1 veces); el JSON
  resta las copias medidas por módulo (`params_total_diffusers_raw`, `flops_duplicated_embedders`) y queda la arquitectura del código
  oficial (facebookresearch/DiT): 674,834,720 parámetros para XL/2 (+ la posición sin/cos, `nn.Parameter` congelado en el oficial =
  675,129,632, los «675M» del paper) y 118.62 GMACs (los «118.6 Gflops» de la Tabla 4 son MACs). Parámetros y FLOPs exactos (diferencia 0).
- `vla.py` (fase 9): todo **en el dispositivo meta**, sin dependencias nuevas. **OpenVLA** (`openvla-7b`): el `modeling_prismatic.py`
  del checkpoint (openvla/openvla-7b, rev. 47a0ec7) exige timm 0.9.x y transformers 4.40, así que no se usa `trust_remote_code`: se
  rearma con las mismas piezas — `timm.create_model` de los dos `timm_model_ids` (DINOv2 ViT-L/14 reg4 + SigLIP So400m/14,
  `pretrained=False, num_classes=0, img_size=224`), un forward que copia `get_intermediate_layers(n = {L − 2})` de timm 0.9.16 (corre
  TODOS los bloques y devuelve el penúltimo sin prefijos: la última capa se calcula y se descarta), el `PrismaticProjector` fused
  (3 lineales) y `LlamaForCausalLM` con vocab 32,064; parches insertados después de `<BOS>`. `sum(p.numel())` = 7,541,237,184 =
  `total_size / 2` del `model.safetensors.index.json` (bf16): exacto contra el checkpoint. FLOPs = prefill (T = 22) + los 6 pasos de
  decode con `DynamicCache` (una acción = 7 tokens); `override_checks` con T = 8 y 64. **π0** (`pi0`, `pi0-1cam`): como el port oficial
  de PyTorch de openpi (main @ 215abfb, `models_pytorch/gemma_pytorch.py`, `pi0_pytorch.py`): `PaliGemmaForConditionalGeneration`
  (SigLIP con intermediate 4304, projection_dim 2048, vocab 257,152) + `GemmaModel` del experto (gemma_300m, `embed_tokens = None`) +
  las 5 lineales de `pi0.py`; un chunk = prefijo una vez (cámaras × 256 + 48 tokens por Gemma 2B, deja la KV cache) + 10 pasos del
  sufijo (1 + 50 tokens) por el experto leyendo esa caché (recortada tras cada paso). `override_checks` (pi0) con 5 pasos, H = 25,
  T = 16 y 2 cámaras. `metrics_checks`: parámetros por parte, KV por token (18,432 B: MQA con d_h 256), MACs de prefijo / paso / chunk.
  Parámetros y FLOPs exactos (diferencia 0) en las 3 configs.
- `finetune.py` (fase 10): HF `LlamaForCausalLM` / `LlamaForSequenceClassification(num_labels=1)` (Llama 3 8B) **en el dispositivo meta**
  + peft 0.21.2 `get_peft_model(LoraConfig(r, lora_alpha, lora_dropout, target_modules))` para `lora-llama3-8b-r16`, `-r16-qv`, `-r64`,
  `qlora-llama3-8b-r16` y `full-ft-llama3-8b`: parámetros exactos (= `print_trainable_parameters`, guardado en el JSON), FLOPs del forward
  y del **paso de entrenamiento** (forward en modo train + `loss.backward()` bajo `FlopCounterMode`: dX y dW que autograd calcula de
  verdad), con gradient checkpointing reentrante (`metrics_override_checks`; el default de HF 5, no reentrante, queda registrado) y con
  T = 512; `override_checks` con r = 8 y targets 4 / 2. **QLoRA**: bitsandbytes no corre en macOS (sin CUDA): los bytes NF4 + doble
  cuantización se cuentan sobre las `nn.Linear` reales de los bloques con las reglas de `quantize_4bit` (`nf4_accounting`: 0.5 → 0.127
  bits por parámetro de constantes, QLoRA §3). `activation_checks`: bytes que guarda el backward por token y capa, **medidos** con
  `torch.autograd.graph.saved_tensors_hooks` en un Llama diminuto real (CPU, bf16, sdpa) = `ATLAS.Arch.finetune.activationPerTokenLayer`.
  RLHF: `rlhf-llama3-8b` (PPO: política + referencia + reward model + crítico), `dpo-llama3-8b` (batch 2: elegida + rechazada),
  `grpo-llama3-8b` (batch G = 8), `ppo-llama3-8b-lora` y `dpo-llama3-8b-lora` (la referencia = el mismo `PeftModel` en
  `disable_adapter()`): un modelo HF por rol, FLOPs del forward por rol y costo de un update de la política (y del crítico) por
  secuencia medido con `loss.backward()`. `loss_checks`: Bradley-Terry, DPO (forma "sigmoid" de TRL), PPO-clip, KL k1 / k3, ventaja de
  GRPO y GAE en torch float64 ↔ `ATLAS.Arch.finetune` (tolerancia 1e-9). Todo exacto (diferencia 0).
- `retrieval.py` (fase 11) + `faiss_ann.py`: **BERT** (`bert-base`, `bert-large`): HF `BertForPreTraining(BertConfig(...))` en el dispositivo
  **meta**; el decoder del MLM está atado a `word_embeddings` (`tied_decoder: true` en el JSON), así que `sum(p.numel())` lo cuenta una vez;
  FLOPs por módulo (`flops_by_node`: encoder, pooler, cabeza MLM sobre las T posiciones como HF, NSP), `override_checks` con T = 512 y
  `metrics_checks` del reparto de parámetros. Atención eager y sin máscara (una secuencia sin relleno); `qkv` = la salida de `query` con el
  ancho ×3 (HF tiene W_Q, W_K, W_V separadas). **Recuperación**: `DPRQuestionEncoder` / `DPRContextEncoder(DPRConfig())` (se llama al
  `DPREncoder` interno: el forward público arma una máscara con `.item()`, imposible en meta) para `dpr-bert-base`; `BertModel` de
  all-MiniLM-L6-v2 (con pooler: el forward lo calcula aunque mean pooling no lo use) + mean pooling + normalizar para `sbert-minilm`;
  `BertForSequenceClassification(num_labels = 1)` para `cross-encoder-minilm` y para el rerank (batch de k pares); `BertModel(bert-base)` +
  `nn.Linear(768, 128, bias=False)` para `colbert-v2`. La búsqueda exacta (E·q con E de N×dim meta), el top-k y MaxSim corren en torch meta
  dentro de FlopCounterMode (los productos contra la query se escriben como matriz × (d×1): FlopCounterMode no cuenta `mv`).
  **ANN** (`hnsw-1m-768`, `ivfpq-1m-768`, `flat-1m-768`, `ivfpq-1b-768`): encoder de queries de DPR en meta + la búsqueda en torch meta (flat:
  X·q; IVF: centroides y tablas ADC); HNSW usa la estimación ≈ del calculador (no hay forma "exacta"). `faiss_ann.py` corre faiss-cpu 1.15.1 en un
  **proceso aparte** (torch y faiss traen cada uno su libomp y no conviven en macOS): atributos a tamaño real sin entrenar (`nb_neighbors(0)`
  = 2M, `code_size`, codebooks de PQ) e índices REALES chicos (N = 20,000, d = 64): `ann_checks` compara `A.flat_bytes / hnsw_bytes /
  ivfpq_bytes` con los arreglos internos y `serialize_index` (enlaces de HNSW = esperanza N·(2M + M/(M−1)): 1 %), y `range_checks` las
  distancias por query medidas (`hnsw_stats.ndis`: 0.44–1.02× la estimación del calculador, que no es una cota; `indexIVF_stats.ndis` ≈ n_probe·N/n_list). Parámetros
  y FLOPs exactos (diferencia 0) en las 10 configs.
- `encdec.py` (fase 12): **T5** (`t5-small`, `t5-base`, `t5-large`, `flan-t5-base`) con HF `T5ForConditionalGeneration(T5Config(...))` y
  **Whisper** (`whisper-tiny` … `whisper-large-v3`, `distil-whisper-large-v3`) con `WhisperForConditionalGeneration(WhisperConfig(...))`, en el
  dispositivo **meta**, atención eager. Forward con teacher forcing (T5: T_in = 512, T_out = 114; Whisper: 3,000 frames mel, T_out = 128):
  `flops_by_node` (encoder, decoder, LM head, cross-attention, convs), `flops_by_op_groups` (mm / bmm / convolution), formas por hooks en la
  capa 0 de cada stack + un parche de `eager_attention_forward` (Q, K, V por cabeza, scores, sesgo relativo), `override_checks` (T5: T_in 128 /
  T_out 32; Whisper: 5 s de audio = mismos FLOPs por el relleno a 30 s, T_out 448) y `metrics_checks` de bytes de la KV cache leídos de la
  `EncoderDecoderCache` de HF (self y cross, bf16). Configs de decode (`t5-base-decode`, `whisper-small-decode`): un paso con la caché
  propia de T_out − 1 filas y la cross ya llena (`is_updated = True`: W_K y W_V de la cross no corren). `bucket_checks` (en t5-base):
  `T5Attention._relative_position_bucket` de HF en CPU para −600 … 600 (bidireccional y causal) ↔ `A.t5RelativeBucket`. Mel:
  `WhisperFeatureExtractor(feature_size = n_mels)` sobre 30 s y 5 s de ceros (3,000 frames en los dos). Dos convenciones explícitas: flan-t5-base
  desata `lm_head` a mano (transformers 5.x fuerza `tie_word_embeddings = True` en T5Config; el checkpoint real trae lm_head ≠ shared y HF no
  los ata al cargar) y Whisper excluye de `params_total` la posición sinusoidal del encoder (HF la guarda como `nn.Embedding` congelado;
  OpenAI la registra como buffer): `params_total_hf_raw` ↔ `quantities.paramsHF`. Parámetros y FLOPs exactos (diferencia 0) en las 12 configs.
- Las configs de cada script (`CONFIGS`, `LLAVA`, `QWEN`, `SD15_UNET`, `SDXL_UNET`, `DIT`, `OVLA`, `PI0`, `LORA`, `RL`, `BERT`, `RET`, `ANN`, `T5`, `WH`) deben coincidir con las de `js/arch/<modelo>.js`.
- `common.py`: conteo de parámetros, hooks de formas (sin batch; rejillas H×W×C) y FLOPs con
  `FlopCounterMode` (2 FLOPs por MAC de matmul/conv/sdpa; en CPU se registra la fórmula de sdpa que
  torch no trae para `_scaled_dot_product_flash_attention_for_cpu`).
- `expected/<configId>.json` se versiona; `tests/crosscheck.test.cjs` compara contra él sin Python.
- El mapeo id de tensor del calculador → módulo de PyTorch vive en cada `.py` (`shape_spec`, `SPEC`);
  los tensores que no pasan por un módulo están en `not_hooked` con el motivo.
