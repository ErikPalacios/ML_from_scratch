# Cross-check del calculador (solo desarrollo)

Compara `ATLAS.Arch` con implementaciones de referencia en PyTorch, **sin descargar pesos**
(SPEC §9.3).

```sh
python3.13 -m venv .venv && .venv/bin/pip install -r crosscheck/requirements.txt
npm run crosscheck          # regenera expected/*.json y compara (sale con 1 si algo difiere)
node tools/crosscheck-compare.mjs --no-regen   # solo compara con los JSON versionados
```

- `vit.py`: timm `create_model(..., pretrained=False, num_classes=1000)` para cada config `vit-*`, y
  HF `ViTForImageClassification(ViTConfig(...))` como segunda referencia.
- `transformer.py`: `torch.nn.TransformerEncoderLayer(8, 2, 32, norm_first=True)` para `toy-n5-d8*`.
- `common.py`: conteo de parámetros, hooks de formas (sin batch; rejillas H×W×C) y FLOPs con
  `FlopCounterMode` (2 FLOPs por MAC de matmul/conv/sdpa; en CPU se registra la fórmula de sdpa que
  torch no trae para `_scaled_dot_product_flash_attention_for_cpu`).
- `expected/<configId>.json` se versiona; `tests/crosscheck.test.cjs` compara contra él sin Python.
- El mapeo id de tensor del calculador → módulo de PyTorch vive en cada `.py` (`shape_spec`, `SPEC`);
  los tensores que no pasan por un módulo están en `not_hooked` con el motivo.
