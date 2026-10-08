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
- Las configs de cada script (`CONFIGS`, `LLAVA`, `QWEN`) deben coincidir con las de `js/arch/<modelo>.js`.
- `common.py`: conteo de parámetros, hooks de formas (sin batch; rejillas H×W×C) y FLOPs con
  `FlopCounterMode` (2 FLOPs por MAC de matmul/conv/sdpa; en CPU se registra la fórmula de sdpa que
  torch no trae para `_scaled_dot_product_flash_attention_for_cpu`).
- `expected/<configId>.json` se versiona; `tests/crosscheck.test.cjs` compara contra él sin Python.
- El mapeo id de tensor del calculador → módulo de PyTorch vive en cada `.py` (`shape_spec`, `SPEC`);
  los tensores que no pasan por un módulo están en `not_hooked` con el motivo.
