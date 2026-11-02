"""Cross-check de YOLOv8-L y YOLO-World-L (SPEC §9.3, §16.2): Ultralytics construido desde los YAML que trae el
paquete (`yolov8l.yaml`, `yolov8l-world.yaml`; `yolov8l-worldv2.yaml` solo para anotar la diferencia v1 ↔ v2),
SIN pesos, SIN CLIP y sin red: DetectionModel / WorldModel(cfg) y los V embeddings del vocabulario se ponen a mano
(txt_feats normalizados), sin correr el codificador de texto. Escribe crosscheck/expected/{yolov8l-640,
yolo-world-l-640}.json.

Uso: .venv/bin/python crosscheck/yolo_world.py [configId ...]

- Ultralytics escribe un settings.json al importarse: se apunta YOLO_CONFIG_DIR a un directorio temporal y
  YOLO_OFFLINE=1 (nada de chequeos en línea). Construir desde YAML no descarga nada (verificado con un proxy roto).
- Parámetros: sum(p.numel()) del modelo (incluye los 16 pesos fijos de la DFL; YOLO-World sin el codificador de texto).
- FLOPs: FlopCounterMode (2 por MAC de convs, Linear y einsum/bmm), forward en eval con la decodificación (DFL).
"""
import os
import sys
import tempfile

os.environ.setdefault("YOLO_CONFIG_DIR", tempfile.mkdtemp(prefix="ultralytics-cfg-"))
os.environ.setdefault("YOLO_OFFLINE", "1")

import torch  # noqa: E402
from torch.utils.flop_counter import FlopCounterMode  # noqa: E402

import ultralytics  # noqa: E402
from ultralytics.nn.tasks import DetectionModel, WorldModel  # noqa: E402

from common import n_params, versions, write_expected  # noqa: E402

# configId → (tipo, YAML, resolución, V). Debe coincidir con js/arch/yolo-world.js.
CONFIGS = {
    "yolov8l-640": ("yolov8", "yolov8l.yaml", 640, None),
    "yolo-world-l-640": ("world", "yolov8l-world.yaml", 640, 80),
}
V_CHECK = 20          # segunda pasada de YOLO-World con otro tamaño de vocabulario
LEVELS = ("p3", "p4", "p5")


def nchw(s):
    assert s[0] == 1, s
    return [s[2], s[3], s[1]]


def seq(s):
    assert s[0] == 1, s
    return s[1:]


def vhw(s):             # ContrastiveHead: [1, V, h, w] → (h·w)×V
    assert s[0] == 1, s
    return [s[2] * s[3], s[1]]


def detect_out(s):      # [1, 4 + K, A] → boxes A×4
    return [s[2], 4]


class Recorder:
    def __init__(self, spec):
        self.spec, self.raw, self.handles = spec, {}, []
        for tid, (m, where, fn) in spec.items():
            if where == "out":
                def hook(_m, inp, out, tid=tid):
                    t = out[0] if isinstance(out, (tuple, list)) else out
                    self.raw.setdefault(tid, list(t.shape))
                self.handles.append(m.register_forward_hook(hook))
            else:
                def pre(_m, args, tid=tid):
                    a = args[0]
                    self.raw.setdefault(tid, list((a[0] if isinstance(a, (list, tuple)) else a).shape))
                self.handles.append(m.register_forward_pre_hook(pre))

    def remove(self):
        for h in self.handles:
            h.remove()

    def shapes(self):
        return {tid: self.spec[tid][2](self.raw[tid]) for tid in self.spec if tid in self.raw}

    def torch_info(self):
        return {tid: {"module": type(self.spec[tid][0]).__name__, "hook": self.spec[tid][1], "torch_shape": self.raw[tid]} for tid in self.spec if tid in self.raw}


def build(kind, yaml):
    if kind == "world":
        model = WorldModel(yaml, verbose=False)
        ctor = f"WorldModel('{yaml}', verbose=False)  # sin pesos; clip_model = None (no se llama set_classes)"
        assert model.clip_model is None
    else:
        model = DetectionModel(yaml, verbose=False)
        ctor = f"DetectionModel('{yaml}', verbose=False)  # sin pesos"
    return model.eval().requires_grad_(False), ctor


def layer_index(model, world):
    """Índices de los módulos del YAML (v1: la image-pooling attention es el 16 y corre todo el bottom-up en +1)."""
    o = 1 if world else 0
    return {"bb": range(0, 10), "neck": range(10, 22 + o), "td4": 12, "td3": 15, "ipa": 16 if world else None,
            "bu4-down": 16 + o, "bu4": 18 + o, "bu5-down": 19 + o, "bu5": 21 + o, "head": 22 + o}


def spec_for(model, world):
    mm, ix = model.model, layer_index(model, world)
    s = {"stem-out": (mm[0], "out", nchw), "s2-down": (mm[1], "out", nchw), "s2-out": (mm[2], "out", nchw), "s3-down": (mm[3], "out", nchw),
         "c3": (mm[4], "out", nchw), "s4-down": (mm[5], "out", nchw), "c4": (mm[6], "out", nchw), "s5-down": (mm[7], "out", nchw),
         "s5-out": (mm[8], "out", nchw), "c5": (mm[9], "out", nchw),
         "td4-up": (mm[10], "out", nchw), "td4-cat": (mm[11], "out", nchw), "p4-td": (mm[12], "out", nchw),
         "td3-up": (mm[13], "out", nchw), "td3-cat": (mm[14], "out", nchw), "p3": (mm[15], "out", nchw),
         "bu4-down": (mm[ix["bu4-down"]], "out", nchw), "bu4-cat": (mm[ix["bu4-down"] + 1], "out", nchw), "p4": (mm[ix["bu4"]], "out", nchw),
         "bu5-down": (mm[ix["bu5-down"]], "out", nchw), "bu5-cat": (mm[ix["bu5-down"] + 1], "out", nchw), "p5": (mm[ix["bu5"]], "out", nchw)}
    head = mm[ix["head"]]
    for i, lvl in enumerate(LEVELS):
        s[f"hb-{lvl}-h1"] = (head.cv2[i][0], "out", nchw)
        s[f"hb-{lvl}-h2"] = (head.cv2[i][1], "out", nchw)
        s[f"boxes-{lvl}"] = (head.cv2[i][2], "out", nchw)
        if world:
            s[f"ht-{lvl}-h1"] = (head.cv3[i][0], "out", nchw)
            s[f"ht-{lvl}-h2"] = (head.cv3[i][1], "out", nchw)
            s[f"obj-emb-{lvl}"] = (head.cv3[i][2], "out", nchw)
            s[f"logits-{lvl}"] = (head.cv4[i], "out", vhw)
        else:
            s[f"hc-{lvl}-h1"] = (head.cv3[i][0], "out", nchw)
            s[f"hc-{lvl}-h2"] = (head.cv3[i][1], "out", nchw)
            s[f"logits-{lvl}"] = (head.cv3[i][2], "out", nchw)
    s["box-dist"] = (head.dfl, "out", lambda x: [x[2], x[1]])
    s["boxes"] = (head, "out", detect_out)
    if world:
        for L, i in (("td4", 12), ("td3", 15), ("bu4", ix["bu4"]), ("bu5", ix["bu5"])):
            c = mm[i]
            s.update({f"{L}-tcsp-cv1": (c.cv1, "out", nchw), f"{L}-tcsp-m": (c.m[0], "out", nchw), f"{L}-tg-guide": (c.attn.gl, "out", seq),
                      f"{L}-tg-proj": (c.attn.proj_conv, "out", nchw), f"{L}-tg-out": (c.attn, "out", nchw), f"{L}-tcsp-cat": (c.cv2, "in", nchw)})
        ipa = mm[ix["ipa"]]
        for j, lvl in enumerate(LEVELS):
            s[f"ipa-{lvl}-proj"] = (ipa.projections[j], "out", nchw)
            s[f"ipa-{lvl}-pool"] = (ipa.im_pools[j], "out", nchw)
        s.update({"ipa-q-ln": (ipa.query[0], "out", seq), "ipa-q": (ipa.query, "out", seq), "ipa-k-ln": (ipa.key[0], "out", seq), "ipa-k": (ipa.key, "out", seq),
                  "ipa-v-ln": (ipa.value[0], "out", seq), "ipa-v": (ipa.value, "out", seq), "ipa-z": (ipa.proj, "in", seq), "ipa-o": (ipa.proj, "out", seq),
                  "vocab-upd": (ipa, "out", seq)})
    return s


def flops_by_module(counts, root, idx):
    return int(sum(sum(v.values()) for k, v in counts.items() if k in {f"{root}.model.{i}" for i in idx}))


def run(config_id, kind, yaml, res, V):
    world = kind == "world"
    model, ctor = build(kind, yaml)
    mm, ix = model.model, layer_index(model, world)
    head = mm[ix["head"]]
    rec = Recorder(spec_for(model, world))
    x = torch.zeros(1, 3, res, res)
    kw = {}
    if world:
        txt = torch.nn.functional.normalize(torch.randn(1, V, 512), dim=-1)
        kw = {"txt_feats": txt}
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = model(x, **kw)            # __call__ → forward → predict: el módulo raíz queda en la pila de FlopCounterMode
    rec.remove()
    counts = fcm.get_flop_counts()
    flops = int(fcm.get_total_flops())
    root = type(model).__name__
    shapes = {"x-img": [res, res, 3]}
    shapes.update(rec.shapes())
    y = out[0] if isinstance(out, (tuple, list)) else out
    A = y.shape[2]
    shapes["scores"] = [A, y.shape[1] - 4]
    if world:
        shapes["vocab"] = [V, 512]
        for L, i in (("td4", 12), ("td3", 15), ("bu4", ix["bu4"]), ("bu5", ix["bu5"])):
            a = mm[i].attn
            h, w = shapes[f"{L}-tg-out"][:2]
            shapes[f"{L}-tg-scores"] = [a.nh, h * w, V]
            shapes[f"{L}-tg-max"] = [a.nh, h * w]
        shapes["ipa-tokens"] = [3 * 9, mm[ix["ipa"]].ec]
        shapes["ipa-scores"] = [mm[ix["ipa"]].nh, V, 27]
    hd = f"{root}.model.{ix['head']}"
    head_flops = int(sum(counts.get(hd, {}).values()))
    box_flops = int(sum(sum(v.values()) for k, v in counts.items() if k.startswith(hd + ".cv2.") and k.count(".") == hd.count(".") + 2)) \
        + int(sum(counts.get(hd + ".dfl", {}).values()))
    by_node_flops = {
        "backbone": flops_by_module(counts, root, ix["bb"]),
        "neck": flops_by_module(counts, root, ix["neck"]),
        "head-box": box_flops,
        ("head-text" if world else "head-cls"): head_flops - box_flops,
    }
    by_node = {
        "backbone": int(sum(n_params(mm[i]) for i in ix["bb"])), "neck": int(sum(n_params(mm[i]) for i in ix["neck"])),
        "head-box": n_params(head.cv2) + n_params(head.dfl),
        ("head-text" if world else "head-cls"): n_params(head.cv3) + (n_params(head.cv4) if world else 0),
    }
    by_path = {"backbone>sppf": n_params(mm[9]), "backbone>stage3>c2f": n_params(mm[4]), "head-box>dfl": n_params(head.dfl)}
    if world:
        for L, node, i in (("td4", "td-p4", 12), ("td3", "td-p3", 15), ("bu4", "bu-p4", ix["bu4"]), ("bu5", "bu-p5", ix["bu5"])):
            by_path[f"neck>{node}>t-csp"] = n_params(mm[i])
            by_path[f"neck>{node}>t-csp>max-sigmoid"] = n_params(mm[i].attn)
        by_path["neck>img-pool-attn"] = n_params(mm[ix["ipa"]])
        for i, lvl in enumerate(LEVELS):
            by_path[f"head-text>{lvl}>scale"] = n_params(head.cv4[i])
    else:
        for node, i in (("td-p4", 12), ("td-p3", 15), ("bu-p4", ix["bu4"]), ("bu-p5", ix["bu5"])):
            by_path[f"neck>{node}>c2f"] = n_params(mm[i])
    v2 = None
    if world:
        m2, _ = build("world", yaml.replace("-world", "-worldv2"))
        v2 = {"yaml": yaml.replace("-world", "-worldv2"), "params_total": n_params(m2),
              "image_pooling_attn_params": n_params(mm[ix["ipa"]]),
              "contrastive_head": type(m2.model[-1].cv4[0]).__name__,
              "note": "v2: sin ImagePoolingAttn y con BNContrastiveHead (BatchNorm2d(512) en el embedding de la región: +1,024 por nivel; "
                      "la v1 usa ContrastiveHead con L2 + logit_scale y bias). quantities.v2Params del calculador = este número."}
    notes = [
        f"Ultralytics {ultralytics.__version__} construido desde el YAML incluido en el paquete ({yaml}, escala l: depth 1.0, width 1.0, "
        "max_channels 512 → canales 64, 128, 256, 512, 512), sin pesos y sin red (verificado con un proxy inválido).",
        "Parámetros = sum(p.numel()): incluye los 16 pesos FIJOS de la DFL (conv 1×1 0…15, requires_grad = False) y las BatchNorm "
        "(γ, β; la BN no se fusiona con la conv porque no se llama a fuse()).",
        "FLOPs = FlopCounterMode en eval (2 por MAC de convs, Linear y einsum/bmm), incluida la conv de la DFL al decodificar; el NMS "
        "va fuera del modelo. Ultralytics reporta 'GFLOPs' con thop = 2 × MACs: 165.1 a 640 para YOLOv8-L.",
        "Ultralytics 8.4: SPPF.cv1 sin activación (act=False); el YOLOv8 original (8.0) la tenía. No cambia parámetros ni MACs.",
    ]
    if world:
        notes += [
            "YOLO-World: el codificador de texto (CLIP ViT-B/32) NO se construye: clip_model = None y los V embeddings (txt_feats, "
            "normalizados L2) se pasan a predict(). Así se cuenta el detector online; el costo de CLIP lo pone el calculador desde "
            "js/arch/clip.js (offline, una vez por vocabulario).",
            "Ultralytics ↔ oficial (AILab-CVC/YOLO-World, mmyolo): C2fAttn = MaxSigmoidCSPLayerWithTwoConv (T-CSPLayer) y "
            "ImagePoolingAttn = ImagePoolingAttentionModule (3×3 por nivel desde P3, P4 top-down y C5). En los dos la cabeza usa el texto "
            "ORIGINAL (el neck no devuelve el actualizado) y los T-CSPLayers del bottom-up el actualizado. En la escala L la guía de texto "
            "tiene 256/128/256/256 canales y 8/4/8/8 cabezas (P5 recortado por max_channels 512): ningún T-CSPLayer necesita la conv "
            "1×1 de embedding (C = E).",
            "La DFL, las anclas sin caja (centros de celda) y la asignación TAL de YOLOv8 se mantienen; la pérdida de clase es la "
            "contrastiva región-texto (el paper: L_con + IoU + DFL).",
        ]
    data = {
        "config_id": config_id, "model": "yolo-world" if world else "yolov8",
        "params_total": n_params(model), "params_by_module": {f"{i}:{type(m).__name__}": n_params(m) for i, m in enumerate(mm)},
        "params_by_node": by_node, "params_by_path": by_path,
        "shapes": shapes, "shapes_torch": rec.torch_info(),
        "not_hooked": {"split / bottlenecks intermedios / gate / scale": "chunk, sigmoide y escalares sin módulo propio",
                       "prompts / txt-emb": "el codificador de texto no se construye (offline)", "decode": "dist2bbox funcional (boxes = salida del Detect)"},
        "flops_total": flops, "flops_by_node": by_node_flops,
        "flops_by_op_torch": {str(k): int(v) for k, v in counts.get("Global", {}).items()},
        "flops_by_op_groups": [
            {"ops": ["aten.convolution"], "prims": ["conv2d", "conv_bn_act", "c2f", "sppf", "csp_bottleneck", "dfl_decode"]},
            {"ops": ["aten.addmm", "aten.mm"], "prims": ["linear"]},
            {"ops": ["aten.bmm"], "prims": ["text_guided_scores", "region_text_similarity", "attention_scores", "attention_weighted_sum"]},
        ],
        "source": {"lib": "ultralytics", "ctor": ctor, "versions": dict(versions(), ultralytics=ultralytics.__version__)},
        "notes": notes,
    }
    if world:
        data["calc_overrides"] = {}
        data["v2"] = v2
        txt2 = torch.nn.functional.normalize(torch.randn(1, V_CHECK, 512), dim=-1)
        f2 = FlopCounterMode(display=False)
        head.nc = V_CHECK                 # lo que hace set_classes (sin CLIP): el Detect separa A×(4R + V)
        with f2, torch.no_grad():
            o2 = model(x, txt_feats=txt2)
        head.nc = V
        y2 = o2[0] if isinstance(o2, (tuple, list)) else o2
        data["override_checks"] = [{"calc_overrides": {"V": V_CHECK}, "params_total": n_params(model), "flops_total": int(f2.get_total_flops()),
                                    "shapes": {"scores": [int(y2.shape[2]), int(y2.shape[1]) - 4]},
                                    "note": f"misma referencia con V = {V_CHECK}: los parámetros no cambian; sí la guía de texto, la image-pooling attention y los logits"}]
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    ids = sys.argv[1:] or list(CONFIGS)
    for cid in ids:
        kind, yaml, res, V = CONFIGS[cid]
        d = run(cid, kind, yaml, res, V)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}")
