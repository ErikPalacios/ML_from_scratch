"""Cross-check del bloque de juguete (SPEC §13.2): torch.nn.TransformerEncoderLayer pre-LN.
Escribe crosscheck/expected/toy-n5-d8.json y toy-n5-d8-causal.json.

Uso: .venv/bin/python crosscheck/transformer.py
"""
import torch
from torch import nn

from common import ShapeRecorder, count_flops, n_params, versions, write_expected

CONFIGS = {
    "toy-n5-d8": dict(N=5, D=8, h=2, Dmlp=32, causal=False),
    "toy-n5-d8-causal": dict(N=5, D=8, h=2, Dmlp=32, causal=True),
}

SPEC = {
    "h-ln1": ("norm1", "out", "seq"),
    "o": ("self_attn", "out", "seq"),
    "r1": ("norm2", "in", "seq"),
    "h-ln2": ("norm2", "out", "seq"),
    "u": ("linear1", "out", "seq"),
    "g": ("activation", "out", "seq"),
    "f": ("linear2", "out", "seq"),
}

NOT_HOOKED = {
    "qkv": "nn.MultiheadAttention usa in_proj_weight de forma funcional (sin módulo Linear)",
    "q": "dentro de F.multi_head_attention_forward",
    "k": "dentro de F.multi_head_attention_forward",
    "v": "dentro de F.multi_head_attention_forward",
    "scores": "dentro de scaled_dot_product_attention",
    "scores-scaled": "dentro de scaled_dot_product_attention",
    "attn": "el bloque llama a self_attn con need_weights=False",
    "z-heads": "dentro de scaled_dot_product_attention",
    "z": "dentro de F.multi_head_attention_forward (antes de out_proj)",
}


def run(config_id):
    c = CONFIGS[config_id]
    torch.manual_seed(0)
    ctor = (f"torch.nn.TransformerEncoderLayer(d_model={c['D']}, nhead={c['h']}, dim_feedforward={c['Dmlp']}, "
            "dropout=0.0, activation=nn.GELU(), batch_first=True, norm_first=True)")
    layer = nn.TransformerEncoderLayer(d_model=c["D"], nhead=c["h"], dim_feedforward=c["Dmlp"], dropout=0.0,
                                       activation=nn.GELU(), batch_first=True, norm_first=True)
    # train() con dropout 0: evita el "fast path" fusionado (que FlopCounterMode no desglosa).
    layer.train()
    x = torch.zeros(1, c["N"], c["D"])
    kwargs = {}
    if c["causal"]:
        kwargs = dict(src_mask=nn.Transformer.generate_square_subsequent_mask(c["N"]), is_causal=True)

    rec = ShapeRecorder(layer, SPEC)
    out = {}

    def final(mod, inp, o):
        out["x-out"] = list(o.shape)
    hfin = layer.register_forward_hook(final)
    flops, by_op = count_flops(layer, x, **kwargs)
    rec.remove()
    hfin.remove()

    shapes = {"x0": [c["N"], c["D"]]}
    shapes.update(rec.shapes())
    shapes["x-out"] = out["x-out"][1:]

    data = {
        "config_id": config_id,
        "model": "transformer",
        "params_total": n_params(layer),
        "params_by_module": {n: n_params(m) for n, m in layer.named_children() if n_params(m)},
        "params_by_node": {
            "enc-layer": n_params(layer),
            "ln1": n_params(layer.norm1),
            "mhsa": n_params(layer.self_attn),
            "qkv": int(layer.self_attn.in_proj_weight.numel() + layer.self_attn.in_proj_bias.numel()),
            "proj": n_params(layer.self_attn.out_proj),
            "ln2": n_params(layer.norm2),
            "mlp": n_params(layer.linear1) + n_params(layer.linear2),
            "fc1": n_params(layer.linear1),
            "fc2": n_params(layer.linear2),
        },
        "shapes": shapes,
        "shapes_torch": rec.torch_info(),
        "not_hooked": NOT_HOOKED,
        "flops_total": flops,
        "flops_by_op": by_op,
        "source": {"lib": "torch", "ctor": ctor, "versions": versions()},
        "notes": [
            "Pre-LN (norm_first=True), sesgos en in_proj, out_proj y MLP: 12D² + 13D = 872 parámetros con D = 8.",
            "La máscara causal no cambia parámetros ni FLOPs contados (sdpa cuenta los N² scores completos).",
            "FlopCounterMode cuenta solo matmuls/sdpa a 2 FLOPs por MAC.",
            "En CPU, sdpa despacha a aten._scaled_dot_product_flash_attention_for_cpu, que FlopCounterMode "
            "no registra (contaría 0): common.py lo registra con torch.utils.flop_counter.sdpa_flop_count.",
        ],
    }
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    for cid in CONFIGS:
        d = run(cid)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}")
