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
  `grounding-dino-t` (896×1344, T = 16): Swin-T (`SwinConfig` por defecto, out_indices [2, 3, 4]) y BERT-base
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
- Las configs de cada script (`CONFIGS`) deben coincidir con las de `js/arch/<modelo>.js`.
- `common.py`: conteo de parámetros, hooks de formas (sin batch; rejillas H×W×C) y FLOPs con
  `FlopCounterMode` (2 FLOPs por MAC de matmul/conv/sdpa; en CPU se registra la fórmula de sdpa que
  torch no trae para `_scaled_dot_product_flash_attention_for_cpu`).
- `expected/<configId>.json` se versiona; `tests/crosscheck.test.cjs` compara contra él sin Python.
- El mapeo id de tensor del calculador → módulo de PyTorch vive en cada `.py` (`shape_spec`, `SPEC`);
  los tensores que no pasan por un módulo están en `not_hooked` con el motivo.
