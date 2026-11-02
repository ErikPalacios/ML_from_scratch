"""Cross-check de ResNet-50 (SPEC §9.3, §14.2): torchvision resnet50(weights=None).
Escribe crosscheck/expected/resnet50-224.json.

Uso: .venv/bin/python crosscheck/resnet.py
"""
import torch
import torchvision

from common import ShapeRecorder, count_flops, n_params, versions, write_expected

CONFIGS = {"resnet50-224": 224}
K = 1000


def shape_spec(model):
    spec = {
        "stem-conv": ("conv1", "out", "grid"),
        "stem-bn": ("bn1", "out", "grid"),
        "stem-out": ("relu", "out", "grid"),          # model.relu solo se usa en el stem
        "pool-out": ("maxpool", "out", "grid"),
        "c2": ("layer1", "out", "grid"),
        "c3": ("layer2", "out", "grid"),
        "c4": ("layer3", "out", "grid"),
        "c5": ("layer4", "out", "grid"),
        "logits": ("fc", "out", "vec"),
    }
    for k in range(1, 5):
        b1, b2, p1, p2 = f"layer{k}.0", f"layer{k}.1", f"l{k}-b1-", f"l{k}-b2-"
        spec.update({
            p1 + "conv1": (f"{b1}.conv1", "out", "grid"), p1 + "bn1": (f"{b1}.bn1", "out", "grid"),
            p1 + "conv2": (f"{b1}.conv2", "out", "grid"), p1 + "bn2": (f"{b1}.bn2", "out", "grid"),
            p1 + "conv3": (f"{b1}.conv3", "out", "grid"), p1 + "bn3": (f"{b1}.bn3", "out", "grid"),
            p1 + "down": (f"{b1}.downsample.0", "out", "grid"), p1 + "down-bn": (f"{b1}.downsample.1", "out", "grid"),
            p1 + "out": (b1, "out", "grid"),
            p2 + "conv1": (f"{b2}.conv1", "out", "grid"), p2 + "conv2": (f"{b2}.conv2", "out", "grid"),
            p2 + "conv3": (f"{b2}.conv3", "out", "grid"),
        })
    return spec


NOT_HOOKED = {
    "l{k}-b{j}-relu1/relu2/add": "Bottleneck reutiliza un solo self.relu (3 llamadas) y la suma es `out += identity`",
    "pooled": "se toma de avgpool (1×1×2048) aplanado: la forma del calculador es el vector 2048",
}


def params_by_node(model):
    p = {
        "stem": n_params(model.conv1) + n_params(model.bn1),
        "stem-conv": n_params(model.conv1), "stem-bn": n_params(model.bn1),
        "head": n_params(model.fc),
    }
    for k in range(1, 5):
        layer = getattr(model, f"layer{k}")
        p[f"layer{k}"] = n_params(layer)
        p[f"l{k}-b1"] = n_params(layer[0])
        p[f"l{k}-b2"] = sum(n_params(b) for b in list(layer)[1:])
    return p


def run(config_id):
    res = CONFIGS[config_id]
    ctor = "torchvision.models.resnet50(weights=None)"
    model = torchvision.models.resnet50(weights=None).eval()
    x = torch.zeros(1, 3, res, res)
    rec = ShapeRecorder(model, shape_spec(model))
    pooled = {}

    def pool_hook(mod, inp, out):
        pooled.setdefault("s", list(out.shape))   # sin return: no reemplaza la salida
    h = model.avgpool.register_forward_hook(pool_hook)
    flops, by_op = count_flops(model, x)
    rec.remove()
    h.remove()
    shapes = {"x-img": [res, res, 3]}
    shapes.update(rec.shapes())
    s = pooled["s"]
    assert s[0] == 1 and s[2] == 1 and s[3] == 1
    shapes["pooled"] = [s[1]]
    bn_buffers = sum(int(b.numel()) for n, b in model.named_buffers())
    data = {
        "config_id": config_id,
        "model": "resnet",
        "params_total": n_params(model),
        "params_by_module": {n: n_params(m) for n, m in model.named_children() if n_params(m)},
        "params_by_node": params_by_node(model),
        "buffers_total": bn_buffers,
        "shapes": shapes,
        "shapes_torch": rec.torch_info(),
        "not_hooked": NOT_HOOKED,
        "flops_total": flops,
        "flops_by_op": by_op,
        "source": {"lib": "torchvision", "ctor": ctor, "versions": versions()},
        "notes": [
            "torchvision implementa ResNet v1.5: en los bloques que bajan resolución el stride 2 va en la conv 3×3 "
            "(el paper original lo ponía en la primera 1×1). Mismos parámetros; algo más de cómputo (≈ 4.1 GMACs "
            "vs los 3.8 × 10⁹ 'FLOPs' de la Tabla 1 del paper, que también son multiply-adds).",
            "Convs sin sesgo; BatchNorm: γ y β son parámetros; running_mean, running_var y num_batches_tracked son "
            "buffers (buffers_total).",
            "FlopCounterMode cuenta solo convs y el fc a 2 FLOPs por MAC; BN, ReLU, max-pool, sumas y el average "
            "pooling no cuentan (el calculador los pone en 'otros').",
            "Formas sin batch; rejillas H×W×C (PyTorch: C×H×W).",
        ],
    }
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    for cid in CONFIGS:
        d = run(cid)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}")
