"""Cross-check de Swin (SPEC §9.3, §14.1): timm SwinTransformer construido SIN pesos.
Escribe crosscheck/expected/<configId>.json.

Uso: .venv/bin/python crosscheck/swin.py [configId ...]

Formas: timm trabaja en NHWC; las ventanas van en el eje del batch (nW·B), así que con B = 1 la
forma de PyTorch [nW, M², C] ya es la del calculador. Las salidas del MLP (B, H·W, C) se pasan a
H×W×C. La atención se fuerza explícita (fused_attn = False) para poder enganchar el softmax.
"""
import sys

import timm
import torch

from common import count_flops, n_params, versions, write_expected

# configId → (nombre timm, resolución, M). Debe coincidir con js/arch/swin.js.
CONFIGS = {
    "swin-t-224": ("swin_tiny_patch4_window7_224", 224, 7),
    "swin-s-224": ("swin_small_patch4_window7_224", 224, 7),
    "swin-b-224": ("swin_base_patch4_window7_224", 224, 7),
    "swin-b-384": ("swin_base_patch4_window12_384", 384, 12),
}
K = 1000


class Recorder:
    """Hooks por nombre de módulo. conv: 'nchw' | 'nhwc' | 'raw' (sin quitar batch) | 'seq2grid' | 'vec'."""

    def __init__(self, model, spec):
        self.spec, self.raw, self.handles = spec, {}, []
        mods = dict(model.named_modules())
        for tid, (name, where, conv, side) in spec.items():
            if name not in mods:
                raise KeyError(f"módulo '{name}' no existe (tensor {tid})")
            m = mods[name]
            if where == "out":
                def hook(mod, inp, out, tid=tid):
                    t = out[0] if isinstance(out, tuple) else out
                    self.raw.setdefault(tid, list(t.shape))
                self.handles.append(m.register_forward_hook(hook))
            else:
                def pre(mod, inp, tid=tid):
                    self.raw.setdefault(tid, list(inp[0].shape))
                self.handles.append(m.register_forward_pre_hook(pre))

    def remove(self):
        for h in self.handles:
            h.remove()

    def shapes(self):
        out = {}
        for tid, (name, where, conv, side) in self.spec.items():
            s = self.raw.get(tid)
            if s is None:
                continue
            if conv == "raw":
                out[tid] = s
                continue
            assert s[0] == 1, (tid, s)
            s = s[1:]
            if conv == "nchw":
                s = [s[1], s[2], s[0]]
            elif conv == "seq2grid":
                assert s[0] == side * side, (tid, s, side)
                s = [side, side, s[1]]
            out[tid] = s
        return out

    def torch_info(self):
        return {tid: {"module": self.spec[tid][0], "hook": self.spec[tid][1], "torch_shape": self.raw[tid]}
                for tid in self.spec if tid in self.raw}


def shape_spec(model, res):
    spec = {
        "x-patch-grid": ("patch_embed.proj", "out", "nchw", None),
        "x-embed": ("patch_embed.norm", "out", "nhwc", None),
    }
    for i, layer in enumerate(model.layers):
        k = i + 1
        side = res // (4 * 2 ** i)
        if i > 0:
            m = f"m{i}-"
            d = f"layers.{i}.downsample"
            spec[m + "concat"] = (f"{d}.norm", "in", "nhwc", None)
            spec[m + "ln"] = (f"{d}.norm", "out", "nhwc", None)
            spec[m + "out"] = (f"{d}.reduction", "out", "nhwc", None)
        for j in (1, 2):
            b = f"layers.{i}.blocks.{j - 1}"
            p = f"s{k}-b{j}-"
            spec.update({
                p + "ln1": (f"{b}.norm1", "out", "nhwc", None),
                p + "win": (f"{b}.attn", "in", "raw", None),
                p + "qkv": (f"{b}.attn.qkv", "out", "raw", None),
                p + "attn": (f"{b}.attn.softmax", "out", "raw", None),
                p + "z": (f"{b}.attn.proj", "in", "raw", None),
                p + "proj": (f"{b}.attn.proj", "out", "raw", None),
                p + "r1": (f"{b}.norm2", "in", "seq2grid", side),
                p + "ln2": (f"{b}.norm2", "out", "seq2grid", side),
                p + "u": (f"{b}.mlp.fc1", "out", "seq2grid", side),
                p + "g": (f"{b}.mlp.act", "out", "seq2grid", side),
                p + "f": (f"{b}.mlp.fc2", "out", "seq2grid", side),
            })
        spec[f"s{k}-b1-out"] = (f"layers.{i}.blocks.0", "out", "nhwc", None)
        spec[f"s{k}-out"] = (f"layers.{i}", "out", "nhwc", None)
    spec["x-ln"] = ("norm", "out", "nhwc", None)
    spec["pooled"] = ("head.global_pool", "out", "vec", None)
    spec["logits"] = ("head.fc", "out", "vec", None)
    return spec


NOT_HOOKED = {
    "s{k}-b{j}-shift / -unshift": "torch.roll dentro de SwinTransformerBlock._attn (sin módulo)",
    "s{k}-b{j}-q / -k / -v": "qkv.reshape(...).unbind(0) dentro de WindowAttention.forward",
    "s{k}-b{j}-scores / -scaled / -biased / -masked": "q @ kᵀ, + sesgo relativo y + máscara dentro de WindowAttention.forward; "
                                                       "timm escala q antes del producto (q * scale), no los scores: mismo resultado",
    "s{k}-b{j}-z-heads": "attn @ v dentro de WindowAttention.forward",
    "s{k}-b{j}-unwin": "window_reverse(...) es una función, no un módulo",
}


def params_by_node(model):
    L = model.layers
    blk = lambda i, j: L[i].blocks[j]  # noqa: E731
    s1 = [blk(0, 0), blk(0, 1)]
    p = {
        "patch-embed": n_params(model.patch_embed),
        "conv": n_params(model.patch_embed.proj),
        "norm": n_params(model.patch_embed.norm),
        "final-ln": n_params(model.norm),
        "head": n_params(model.head),
        # stage 1: nodos de swin-block-pair / swin-wmsa / swin-swmsa
        "w-ln1": n_params(s1[0].norm1), "w-msa": n_params(s1[0].attn), "w-ln2": n_params(s1[0].norm2), "w-mlp": n_params(s1[0].mlp),
        "sw-ln1": n_params(s1[1].norm1), "sw-msa": n_params(s1[1].attn), "sw-ln2": n_params(s1[1].norm2), "sw-mlp": n_params(s1[1].mlp),
        "qkv": sum(n_params(b.attn.qkv) for b in s1), "proj": sum(n_params(b.attn.proj) for b in s1),
        "bias": sum(int(b.attn.relative_position_bias_table.numel()) for b in s1),
        "fc1": sum(n_params(b.mlp.fc1) for b in s1), "fc2": sum(n_params(b.mlp.fc2) for b in s1),
        # merge1: nodos de swin-patch-merging
        "ln": n_params(L[1].downsample.norm), "reduce": n_params(L[1].downsample.reduction),
    }
    for i in range(4):
        p[f"stage{i + 1}"] = n_params(L[i].blocks)
        if i > 0:
            p[f"merge{i}"] = n_params(L[i].downsample)
    return p


def run(config_id):
    name, res, M = CONFIGS[config_id]
    ctor = f"timm.create_model('{name}', pretrained=False, num_classes={K})"
    model = timm.create_model(name, pretrained=False, num_classes=K).eval()
    for layer in model.layers:
        for b in layer.blocks:
            b.attn.fused_attn = False
    x = torch.zeros(1, 3, res, res)
    rec = Recorder(model, shape_spec(model, res))
    flops, by_op = count_flops(model, x)
    rec.remove()

    shapes = {"x-img": [res, res, 3]}
    shapes.update(rec.shapes())
    windows = []
    for i, layer in enumerate(model.layers):
        for j, b in enumerate(layer.blocks[:2]):
            windows.append({"stage": i + 1, "block": j + 1, "window_size": list(b.window_size), "shift_size": list(b.shift_size),
                            "bias_table": list(b.attn.relative_position_bias_table.shape),
                            "attn_mask": list(b.attn_mask.shape) if b.attn_mask is not None else None})

    data = {
        "config_id": config_id,
        "model": "swin",
        "params_total": n_params(model),
        "params_by_module": {n: n_params(m) for n, m in model.named_children() if n_params(m)},
        "params_by_node": params_by_node(model),
        "shapes": shapes,
        "shapes_torch": rec.torch_info(),
        "not_hooked": NOT_HOOKED,
        "windows": windows,
        "flops_total": flops,
        "flops_by_op": by_op,
        "source": {"lib": "timm", "ctor": ctor, "versions": versions()},
        "notes": [
            "Paper (Tabla 1): Swin-T 28M / 4.5G, Swin-S 50M / 8.7G, Swin-B 88M / 15.4G, Swin-B@384 88M / 47.0G. "
            "Esos 'FLOPs' del paper son MACs (convención fvcore): FlopCounterMode da 2 × MACs.",
            "Regla de timm (_calc_window_shift): si el lado del mapa de un stage es ≤ M, la ventana pasa a ser el mapa "
            "entero y el shift es 0 (stage 4 de Swin-T @224: 7×7 con M = 7; 'windows' lo muestra).",
            "La tabla de sesgo relativo ((2M−1)²×h por bloque) es parámetro; relative_position_index y attn_mask son "
            "buffers (no cuentan).",
            "FlopCounterMode cuenta solo matmuls/convs a 2 FLOPs por MAC; la suma del sesgo relativo, la máscara de "
            "SW-MSA, LayerNorm, softmax, GELU y los roll no cuentan (el calculador los pone en 'otros').",
            "Formas sin batch; rejillas H×W×C (timm ya usa NHWC); ventanas nW×M²×C.",
        ],
    }
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    ids = sys.argv[1:] or list(CONFIGS)
    for cid in ids:
        d = run(cid)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}")
