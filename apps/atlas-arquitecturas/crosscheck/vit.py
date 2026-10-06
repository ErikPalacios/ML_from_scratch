"""Cross-check de ViT (SPEC §9.3, §13.1): timm VisionTransformer (y HF ViT como segunda referencia),
construidos SIN pesos. Escribe crosscheck/expected/<configId>.json.

Uso: .venv/bin/python crosscheck/vit.py [configId ...]
"""
import sys

import timm
import torch

from common import ShapeRecorder, count_flops, n_params, versions, write_expected

# configId → (nombre timm, kwargs del calculador). Debe coincidir con js/arch/vit.js.
CONFIGS = {
    "vit-b16-224": ("vit_base_patch16_224", dict(res=224, P=16, D=768, L=12, h=12, Dmlp=3072)),
    "vit-s16-224": ("vit_small_patch16_224", dict(res=224, P=16, D=384, L=12, h=6, Dmlp=1536)),
    "vit-l16-224": ("vit_large_patch16_224", dict(res=224, P=16, D=1024, L=24, h=16, Dmlp=4096)),
    "vit-h14-224": ("vit_huge_patch14_224", dict(res=224, P=14, D=1280, L=32, h=16, Dmlp=5120)),
    "vit-b16-384": ("vit_base_patch16_384", dict(res=384, P=16, D=768, L=12, h=12, Dmlp=3072)),
    "vit-b32-224": ("vit_base_patch32_224", dict(res=224, P=32, D=768, L=12, h=12, Dmlp=3072)),
}
K = 1000


def shape_spec(L):
    """tensor id del calculador → (módulo timm, 'out'|'in', layout). Capa 0 para los tensores por capa."""
    b = "blocks.0"
    return {
        "x-patch-grid": ("patch_embed.proj", "out", "grid"),
        "x-patches": ("patch_embed", "out", "seq"),
        "x0": ("pos_drop", "out", "seq"),
        "h-ln1": (f"{b}.norm1", "out", "seq"),
        "qkv": (f"{b}.attn.qkv", "out", "seq"),
        "q": (f"{b}.attn.q_norm", "out", "heads"),
        "k": (f"{b}.attn.k_norm", "out", "heads"),
        "attn": (f"{b}.attn.attn_drop", "out", "heads"),
        "z": (f"{b}.attn.norm", "out", "seq"),
        "o": (f"{b}.attn.proj", "out", "seq"),
        "r1": (f"{b}.norm2", "in", "seq"),
        "h-ln2": (f"{b}.norm2", "out", "seq"),
        "u": (f"{b}.mlp.fc1", "out", "seq"),
        "g": (f"{b}.mlp.act", "out", "seq"),
        "f": (f"{b}.mlp.fc2", "out", "seq"),
        "x-out": (f"blocks.{L - 1}", "out", "seq"),
        "x-ln": ("norm", "out", "seq"),
        "cls-out": ("fc_norm", "out", "vec"),
        "logits": ("head", "out", "vec"),
    }


NOT_HOOKED = {
    "x-cls-cat": "se forma dentro de VisionTransformer._pos_embed (torch.cat), sin módulo propio",
    "v": "sale de qkv.unbind dentro de Attention.forward; solo q y k pasan por un módulo (q_norm/k_norm)",
    "scores": "q @ k^T dentro de Attention.forward (sin módulo)",
    "scores-scaled": "timm escala q antes del producto (q * scale), no los scores; mismo resultado",
    "z-heads": "attn @ v dentro de Attention.forward (sin módulo)",
}


def params_by_node(model, L):
    blocks = model.blocks
    s = lambda f: int(sum(n_params(f(blk)) for blk in blocks))  # noqa: E731
    return {
        "patch-embed": n_params(model.patch_embed),
        "cls": int(model.cls_token.numel()),
        "pos-embed": int(model.pos_embed.numel()),
        "encoder": n_params(blocks),
        "enc-layer": n_params(blocks),
        "ln1": s(lambda b: b.norm1),
        "mhsa": s(lambda b: b.attn),
        "qkv": s(lambda b: b.attn.qkv),
        "proj": s(lambda b: b.attn.proj),
        "ln2": s(lambda b: b.norm2),
        "mlp": s(lambda b: b.mlp),
        "fc1": s(lambda b: b.mlp.fc1),
        "fc2": s(lambda b: b.mlp.fc2),
        "final-ln": n_params(model.norm),
        "head": n_params(model.head),
    }


def hf_reference(c):
    """Segunda referencia: HF ViTForImageClassification desde un ViTConfig en código (sin hub)."""
    from transformers import ViTConfig, ViTForImageClassification
    cfg = ViTConfig(hidden_size=c["D"], num_hidden_layers=c["L"], num_attention_heads=c["h"],
                    intermediate_size=c["Dmlp"], image_size=c["res"], patch_size=c["P"], num_channels=3,
                    num_labels=K, qkv_bias=True)
    m = ViTForImageClassification(cfg).eval()
    x = torch.zeros(1, 3, c["res"], c["res"])
    flops, _ = count_flops(m, x)
    ctor = (f"ViTForImageClassification(ViTConfig(hidden_size={c['D']}, num_hidden_layers={c['L']}, "
            f"num_attention_heads={c['h']}, intermediate_size={c['Dmlp']}, image_size={c['res']}, "
            f"patch_size={c['P']}, num_labels={K}, qkv_bias=True))")
    return {"lib": "transformers", "ctor": ctor, "params_total": n_params(m), "flops_total": flops}


def run(config_id):
    name, c = CONFIGS[config_id]
    ctor = f"timm.create_model('{name}', pretrained=False, num_classes={K})"
    model = timm.create_model(name, pretrained=False, num_classes=K).eval()
    x = torch.zeros(1, 3, c["res"], c["res"])

    # FLOPs con la atención fusionada por defecto (sdpa) …
    flops_fused, by_op_fused = count_flops(model, x)
    # … y con la atención explícita (q @ k^T, softmax, @ v) para poder enganchar `attn`.
    for blk in model.blocks:
        blk.attn.fused_attn = False
    rec = ShapeRecorder(model, shape_spec(c["L"]))
    flops, by_op = count_flops(model, x)
    rec.remove()

    shapes = {"x-img": [c["res"], c["res"], 3]}
    shapes.update(rec.shapes())
    shapes["e-pos"] = list(model.pos_embed.shape[1:])

    data = {
        "config_id": config_id,
        "model": "vit",
        "params_total": n_params(model),
        "params_by_module": {n: n_params(m) for n, m in model.named_children() if n_params(m)}
        | {"cls_token": int(model.cls_token.numel()), "pos_embed": int(model.pos_embed.numel())},
        "params_by_node": params_by_node(model, c["L"]),
        "shapes": shapes,
        "shapes_torch": rec.torch_info(),
        "not_hooked": NOT_HOOKED,
        "flops_total": flops,
        "flops_total_fused_sdpa": flops_fused,
        "flops_by_op": by_op,
        "flops_by_op_fused_sdpa": by_op_fused,
        "alt": {"hf": hf_reference(c)},
        "source": {"lib": "timm", "ctor": ctor, "versions": versions()},
        "notes": [
            "timm (como la cabeza de fine-tuning del paper) clasifica con LayerNorm final → token CLS → "
            "Linear(D, 1000); NO tiene la capa oculta 'pre-logits' (representation layer, tanh) de la cabeza "
            "de pre-entrenamiento del paper. El calculador sigue a timm.",
            "Formas sin batch (B=1); la rejilla x-patch-grid se reporta H×W×C (PyTorch: C×H×W).",
            "FlopCounterMode cuenta solo matmuls/convs/sdpa a 2 FLOPs por MAC; sesgos, LayerNorm, softmax, "
            "GELU y sumas no cuentan (el calculador los pone en 'otros').",
            "e-pos es la forma del parámetro model.pos_embed (sin batch).",
            "En CPU, sdpa despacha a aten._scaled_dot_product_flash_attention_for_cpu, que FlopCounterMode "
            "no registra (contaría 0): common.py lo registra con torch.utils.flop_counter.sdpa_flop_count.",
        ],
    }
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    ids = sys.argv[1:] or list(CONFIGS)
    for cid in ids:
        d = run(cid)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}  "
              f"(sdpa {d['flops_total_fused_sdpa']:,}; hf params {d['alt']['hf']['params_total']:,})")
