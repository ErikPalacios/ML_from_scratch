"""Utilidades compartidas del cross-check (SPEC §9.3). Solo desarrollo.

- Nunca descarga pesos: los modelos se construyen desde la config (HF_HUB_OFFLINE=1).
- Formas SIN batch (B=1) y rejillas channels-last (H×W×C), como el calculador.
- FLOPs con torch.utils.flop_counter.FlopCounterMode: cuenta matmuls/convs/sdpa a 2 FLOPs por MAC
  (sesgos, normas, softmax y activaciones no cuentan), igual que el número principal del calculador.
"""
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import torch  # noqa: E402
from torch.utils.flop_counter import FlopCounterMode, sdpa_flop_count  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED = os.path.join(HERE, "expected")


def n_params(module):
    return int(sum(p.numel() for p in module.parameters()))


def _cpu_sdpa_flop(query_shape, key_shape, value_shape, *args, out_shape=None, **kwargs):
    # Misma fórmula que torch usa para las variantes GPU de sdpa (2·(QKᵀ + A·V) MACs).
    return sdpa_flop_count(query_shape, key_shape, value_shape)


# En CPU, sdpa despacha a _scaled_dot_product_flash_attention_for_cpu, que FlopCounterMode no tiene
# registrado (lo contaría como 0). Se registra con la fórmula oficial de torch.
CUSTOM = {}
if hasattr(torch.ops.aten, "_scaled_dot_product_flash_attention_for_cpu"):
    CUSTOM[torch.ops.aten._scaled_dot_product_flash_attention_for_cpu] = _cpu_sdpa_flop


def count_flops(model, x, **kwargs):
    """Total de FLOPs y desglose por operador aten de un forward."""
    fcm = FlopCounterMode(display=False, custom_mapping=CUSTOM)
    with fcm, torch.no_grad():
        model(x, **kwargs)
    by_op = {str(k): int(v) for k, v in fcm.get_flop_counts().get("Global", {}).items()}
    return int(fcm.get_total_flops()), dict(sorted(by_op.items()))


def strip_batch(shape):
    shape = list(shape)
    assert shape[0] == 1, f"se esperaba B=1, recibí {shape}"
    return shape[1:]


def to_calc(shape, layout):
    """Forma de PyTorch → convención del calculador (sin batch; grid C×H×W → H×W×C)."""
    s = strip_batch(shape)
    if layout == "grid" and len(s) == 3:
        return [s[1], s[2], s[0]]
    return s


class ShapeRecorder:
    """Registra la forma de salida (o de entrada) de módulos por nombre."""

    def __init__(self, model, spec):
        # spec: {tensor_id: (module_name, 'out'|'in', layout)}
        self.spec = spec
        self.raw = {}
        self.handles = []
        mods = dict(model.named_modules())
        for tid, (name, where, layout) in spec.items():
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
        for tid, (name, where, layout) in self.spec.items():
            if tid in self.raw:
                out[tid] = to_calc(self.raw[tid], layout)
        return out

    def torch_info(self):
        return {tid: {"module": self.spec[tid][0], "hook": self.spec[tid][1], "torch_shape": self.raw[tid]}
                for tid in self.spec if tid in self.raw}


def write_expected(config_id, data):
    os.makedirs(EXPECTED, exist_ok=True)
    path = os.path.join(EXPECTED, f"{config_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, sort_keys=False)
        f.write("\n")
    print(f"  escrito {os.path.relpath(path, os.path.dirname(HERE))}", file=sys.stderr)


def versions():
    import importlib.metadata as md
    out = {"python": sys.version.split()[0], "torch": torch.__version__}
    for lib in ("timm", "transformers"):
        try:
            out[lib] = md.version(lib)
        except md.PackageNotFoundError:
            out[lib] = None
    return out
