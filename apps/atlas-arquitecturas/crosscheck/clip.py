"""Cross-check de CLIP (SPEC §9.3, §14.3): HF transformers.CLIPModel(CLIPConfig(...)) construido en
código (sin hub, sin pesos). Escribe crosscheck/expected/<configId>.json.

Uso: .venv/bin/python crosscheck/clip.py [configId ...]

Convención del calculador: totales POR PAR imagen-texto (la matriz de similitud cuenta B·E por par).
Con batch B, PyTorch mide B × (totales del calculador con ese B): se verifica con B = 1 (registro
principal, calc_overrides {B: 1}) y con B = 4 (batch_check).
"""
import sys

import torch
from transformers import CLIPConfig, CLIPModel

from common import ShapeRecorder, count_flops, n_params, versions, write_expected

TXT_B = dict(hidden_size=512, intermediate_size=2048, num_hidden_layers=12, num_attention_heads=8)
TXT_L = dict(hidden_size=768, intermediate_size=3072, num_hidden_layers=12, num_attention_heads=12)
# configId → (vision_config, text_config, projection_dim). Debe coincidir con js/arch/clip.js.
CONFIGS = {
    "clip-vit-b16": (dict(hidden_size=768, intermediate_size=3072, num_hidden_layers=12, num_attention_heads=12, image_size=224, patch_size=16), TXT_B, 512),
    "clip-vit-b32": (dict(hidden_size=768, intermediate_size=3072, num_hidden_layers=12, num_attention_heads=12, image_size=224, patch_size=32), TXT_B, 512),
    "clip-vit-l14": (dict(hidden_size=1024, intermediate_size=4096, num_hidden_layers=24, num_attention_heads=16, image_size=224, patch_size=14), TXT_L, 768),
    "clip-vit-l14-336": (dict(hidden_size=1024, intermediate_size=4096, num_hidden_layers=24, num_attention_heads=16, image_size=336, patch_size=14), TXT_L, 768),
}
COMMON_TXT = dict(vocab_size=49408, max_position_embeddings=77, hidden_act="quick_gelu")
COMMON_IMG = dict(num_channels=3, hidden_act="quick_gelu")
T = 77


def build(config_id):
    vc, tc, E = CONFIGS[config_id]
    cfg = CLIPConfig(text_config=dict(tc, **COMMON_TXT), vision_config=dict(vc, **COMMON_IMG), projection_dim=E)
    model = CLIPModel._from_config(cfg, attn_implementation="eager").eval()
    ctor = (f"CLIPModel._from_config(CLIPConfig(text_config={dict(tc, **COMMON_TXT)}, vision_config={dict(vc, **COMMON_IMG)}, "
            f"projection_dim={E}), attn_implementation='eager')")
    return model, vc, tc, E, ctor


def shape_spec(Li, Lt):
    v, t = "vision_model", "text_model"
    vl, tl = f"{v}.encoder.layers.0", f"{t}.encoder.layers.0"
    return {
        "i-patch-grid": (f"{v}.embeddings.patch_embedding", "out", "grid"),
        "i-x0": (f"{v}.pre_layrnorm", "in", "seq"),
        "i-ln-pre": (f"{v}.pre_layrnorm", "out", "seq"),
        "i-h-ln1": (f"{vl}.layer_norm1", "out", "seq"),
        "i-z": (f"{vl}.self_attn.out_proj", "in", "seq"),
        "i-o": (f"{vl}.self_attn.out_proj", "out", "seq"),
        "i-r1": (f"{vl}.layer_norm2", "in", "seq"),
        "i-h-ln2": (f"{vl}.layer_norm2", "out", "seq"),
        "i-u": (f"{vl}.mlp.fc1", "out", "seq"),
        "i-g": (f"{vl}.mlp.activation_fn", "out", "seq"),
        "i-f": (f"{vl}.mlp.fc2", "out", "seq"),
        "i-x-out": (f"{v}.encoder.layers.{Li - 1}", "out", "seq"),
        "i-cls": (f"{v}.post_layernorm", "in", "vec"),
        "i-cls-ln": (f"{v}.post_layernorm", "out", "vec"),
        "i-emb": ("visual_projection", "out", "vec"),
        "t-tok": (f"{t}.embeddings.token_embedding", "out", "seq"),
        "t-x0": (f"{t}.embeddings", "out", "seq"),
        "t-h-ln1": (f"{tl}.layer_norm1", "out", "seq"),
        "t-z": (f"{tl}.self_attn.out_proj", "in", "seq"),
        "t-o": (f"{tl}.self_attn.out_proj", "out", "seq"),
        "t-r1": (f"{tl}.layer_norm2", "in", "seq"),
        "t-h-ln2": (f"{tl}.layer_norm2", "out", "seq"),
        "t-u": (f"{tl}.mlp.fc1", "out", "seq"),
        "t-g": (f"{tl}.mlp.activation_fn", "out", "seq"),
        "t-f": (f"{tl}.mlp.fc2", "out", "seq"),
        "t-x-out": (f"{t}.encoder.layers.{Lt - 1}", "out", "seq"),
        "t-ln-final": (f"{t}.final_layer_norm", "out", "seq"),
        "t-eot": ("text_projection", "in", "vec"),
        "t-emb": ("text_projection", "out", "vec"),
    }


NOT_HOOKED = {
    "i-qkv / t-qkv": "HF separa q_proj, k_proj y v_proj (3 × (D² + D)): mismos parámetros y MACs que el qkv fusionado del calculador "
                     "(params_by_path …>qkv = suma de los tres)",
    "i-q / i-k / i-v": "q_proj(x).view(...).transpose(1, 2) dentro de CLIPAttention (sin módulo con esa forma)",
    "i-scores / i-scores-scaled / t-masked": "torch.matmul(q, kᵀ) · scaling (+ máscara causal en texto) dentro de eager_attention_forward",
    "i-attn / t-attn": "se toman de output_attentions=True (pesos tras el softmax)",
    "i-cls-cat / i-patches": "torch.cat / flatten dentro de CLIPVisionEmbeddings.forward",
    "img-batch / txt-batch / logits": "salidas image_embeds, text_embeds y logits_per_image del modelo",
}


def params_by_path(model):
    vm, tm = model.vision_model, model.text_model
    vl, tl = vm.encoder.layers, tm.encoder.layers
    s = lambda layers, f: int(sum(n_params(f(b)) for b in layers))  # noqa: E731
    qkv = lambda b: n_params(b.self_attn.q_proj) + n_params(b.self_attn.k_proj) + n_params(b.self_attn.v_proj)  # noqa: E731
    return {
        "img-encoder": n_params(vm),
        "img-encoder>patch-embed": n_params(vm.embeddings.patch_embedding),
        "img-encoder>cls": int(vm.embeddings.class_embedding.numel()),
        "img-encoder>pos-embed": n_params(vm.embeddings.position_embedding),
        "img-encoder>ln-pre": n_params(vm.pre_layrnorm),
        "img-encoder>enc-layer": n_params(vl),
        "img-encoder>enc-layer>mhsa": s(vl, lambda b: b.self_attn),
        "img-encoder>enc-layer>mhsa>qkv": int(sum(qkv(b) for b in vl)),
        "img-encoder>enc-layer>mhsa>proj": s(vl, lambda b: b.self_attn.out_proj),
        "img-encoder>enc-layer>mlp": s(vl, lambda b: b.mlp),
        "img-encoder>ln-post": n_params(vm.post_layernorm),
        "img-proj": n_params(model.visual_projection),
        "txt-encoder": n_params(tm),
        "txt-encoder>tok-embed": n_params(tm.embeddings.token_embedding),
        "txt-encoder>pos-embed": n_params(tm.embeddings.position_embedding),
        "txt-encoder>enc-layer": n_params(tl),
        "txt-encoder>enc-layer>mhsa": s(tl, lambda b: b.self_attn),
        "txt-encoder>enc-layer>mhsa>qkv": int(sum(qkv(b) for b in tl)),
        "txt-encoder>enc-layer>mlp": s(tl, lambda b: b.mlp),
        "txt-encoder>ln-final": n_params(tm.final_layer_norm),
        "txt-proj": n_params(model.text_projection),
        "temperature": int(model.logit_scale.numel()),
    }


def inputs(B, res):
    return dict(input_ids=torch.zeros(B, T, dtype=torch.long), pixel_values=torch.zeros(B, 3, res, res))


def forward_flops(model, kw):
    from torch.utils.flop_counter import FlopCounterMode
    from common import CUSTOM
    fcm = FlopCounterMode(display=False, custom_mapping=CUSTOM)
    with fcm, torch.no_grad():
        out = model(**kw, output_attentions=True)
    by_op = {str(k): int(v) for k, v in fcm.get_flop_counts().get("Global", {}).items()}
    return int(fcm.get_total_flops()), dict(sorted(by_op.items())), out


def run(config_id):
    model, vc, tc, E, ctor = build(config_id)
    res, Li, Lt = vc["image_size"], vc["num_hidden_layers"], tc["num_hidden_layers"]
    rec = ShapeRecorder(model, shape_spec(Li, Lt))
    flops, by_op, out = forward_flops(model, inputs(1, res))
    rec.remove()
    shapes = {"i-img": [res, res, 3], "t-ids": [T]}
    shapes.update(rec.shapes())
    shapes["i-attn"] = list(out.vision_model_output.attentions[0].shape[1:])
    shapes["t-attn"] = list(out.text_model_output.attentions[0].shape[1:])
    shapes["i-e-pos"] = list(model.vision_model.embeddings.position_embedding.weight.shape)
    shapes["t-e-pos"] = list(model.text_model.embeddings.position_embedding.weight.shape)
    shapes["img-batch"] = list(out.image_embeds.shape)
    shapes["txt-batch"] = list(out.text_embeds.shape)
    shapes["logits"] = list(out.logits_per_image.shape)

    B4 = 4
    flops4, by_op4, out4 = forward_flops(model, inputs(B4, res))
    batch_check = {
        "B": B4, "flops_total": flops4, "flops_by_op": by_op4,
        "shapes": {"img-batch": list(out4.image_embeds.shape), "txt-batch": list(out4.text_embeds.shape),
                   "logits": list(out4.logits_per_image.shape)},
    }

    data = {
        "config_id": config_id,
        "model": "clip",
        "calc_overrides": {"B": 1},
        "params_total": n_params(model),
        "params_by_module": {n: n_params(m) for n, m in model.named_children() if n_params(m)}
        | {"logit_scale": int(model.logit_scale.numel())},
        "params_by_path": params_by_path(model),
        "shapes": shapes,
        "shapes_torch": rec.torch_info(),
        "not_hooked": NOT_HOOKED,
        "flops_total": flops,
        "flops_by_op": by_op,
        "batch_check": batch_check,
        "source": {"lib": "transformers", "ctor": ctor, "versions": versions()},
        "notes": [
            "Construido en código (sin hub ni pesos). Los parámetros coinciden con los del código original de OpenAI "
            "(clip.model.CLIP): conv1 sin sesgo, class_embedding, ln_pre, ln_post, proj y text_projection como matrices "
            "sin sesgo, logit_scale (1 parámetro). OpenAI fusiona Q, K, V (nn.MultiheadAttention.in_proj); HF los separa: "
            "mismos conteos.",
            "Activación QuickGELU (x·σ(1.702x)) como en los pesos originales; no cambia parámetros ni MACs.",
            "Totales del calculador POR PAR: la matriz de similitud cuenta B·E MACs por par. Con batch B, PyTorch mide "
            "B·(torres) + B²·E = B × (total del calculador con ese B): registro principal con B = 1 y batch_check con B = 4.",
            "La máscara causal del texto no cambia los FLOPs contados (eager calcula los T² scores completos).",
            "FlopCounterMode cuenta solo matmuls/convs a 2 FLOPs por MAC; normas, softmax, QuickGELU, la normalización "
            "L2, e^t y la pérdida no cuentan (el calculador los pone en 'otros').",
            "El paper no da una tabla de FLOPs por modelo; Tabla 20 da las arquitecturas (anchos, capas, cabezas, E).",
        ],
    }
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    ids = sys.argv[1:] or list(CONFIGS)
    for cid in ids:
        d = run(cid)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}  (B=4: {d['batch_check']['flops_total']:,})")
