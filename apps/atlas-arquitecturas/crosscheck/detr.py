"""Cross-check de DETR y Deformable DETR (SPEC §9.3, §15): HF transformers DetrForObjectDetection /
DeformableDetrForObjectDetection construidos en código (sin hub, sin pesos: backbone timm resnet50 con
use_pretrained_backbone=False). Escribe crosscheck/expected/<configId>.json.

Uso: .venv/bin/python crosscheck/detr.py [configId ...]

- DETR: parámetros, formas y FLOPs exactos (FlopCounterMode cuenta convs, Linear y las matmuls de la
  atención eager, igual que el calculador). auxiliary_loss=False: las cabezas solo sobre la última capa.
- Deformable DETR: grid_sample y la suma ponderada de las muestras (elementwise) NO los cuenta
  FlopCounterMode; se suman analíticamente (5·N_q·h·L·K·d_h MACs por llamada, con N_q, h, L, K y d_h
  leídos de los tensores de cada llamada) y se restan las cabezas de las 5 capas intermedias (HF las
  aplica en cada forward; el calculador predice solo con la última). flops_total = contados − cabezas
  auxiliares + muestreo analítico; los crudos quedan en flops_counted_torch / flops_by_op_raw.
- BatchNorm del backbone: HF (como el código oficial) la reemplaza por FrozenBatchNorm2d: γ, β, media y
  varianza son buffers → mismo conteo que el oficial.
"""
import sys

import torch
from torch.utils.flop_counter import FlopCounterMode
from transformers import DeformableDetrConfig, DeformableDetrForObjectDetection, DetrConfig, DetrForObjectDetection

from common import CUSTOM, n_params, to_calc, versions, write_expected

# configId → (tipo, H, W, Q). Debe coincidir con js/arch/detr.js.
CONFIGS = {
    "detr-r50-800x1216": ("detr", 800, 1216, 100),
    "detr-r50-640": ("detr", 640, 640, 100),
    "deformable-detr-r50": ("deformable", 800, 1216, 300),
}
COMMON = dict(num_labels=91, d_model=256, encoder_layers=6, decoder_layers=6, encoder_attention_heads=8,
              decoder_attention_heads=8, activation_function="relu", position_embedding_type="sine")
DETR_KW = dict(COMMON, encoder_ffn_dim=2048, decoder_ffn_dim=2048, auxiliary_loss=False)
DEF_KW = dict(COMMON, encoder_ffn_dim=1024, decoder_ffn_dim=1024, num_feature_levels=4, encoder_n_points=4,
              decoder_n_points=4, with_box_refine=False, two_stage=False)


def build(kind, Q):
    if kind == "detr":
        kw = dict(DETR_KW, num_queries=Q)
        cfg = DetrConfig(**kw)
        model = DetrForObjectDetection._from_config(cfg, attn_implementation="eager")
        ctor = f"DetrForObjectDetection._from_config(DetrConfig(**{kw}), attn_implementation='eager')"
    else:
        kw = dict(DEF_KW, num_queries=Q)
        cfg = DeformableDetrConfig(**kw)
        model = DeformableDetrForObjectDetection._from_config(cfg, attn_implementation="eager")
        ctor = f"DeformableDetrForObjectDetection._from_config(DeformableDetrConfig(**{kw}), attn_implementation='eager')"
    bc = cfg.backbone_config
    backbone = {k: getattr(bc, k, None) for k in ("model_type", "backbone", "use_pretrained_backbone", "out_indices", "num_channels")}
    assert backbone["use_pretrained_backbone"] is False, "el backbone no debe cargar pesos"
    # Sin gradientes: el module tracker de FlopCounterMode falla con vistas de parámetros bajo no_grad.
    return model.eval().requires_grad_(False), cfg, ctor, backbone


class Recorder:
    """Forma de salida ('out'), de la primera entrada ('in') o de un argumento (('arg', i) / ('kw', nombre))."""

    def __init__(self, model, spec):
        self.spec, self.raw, self.handles = spec, {}, []
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
                def pre(mod, args, kwargs, tid=tid, where=where):
                    if where == "in":
                        t = args[0] if args else kwargs.get("hidden_states")
                    elif where[0] == "arg":
                        t = args[where[1]]
                    else:
                        t = kwargs.get(where[1])
                    self.raw.setdefault(tid, list(t.shape))
                self.handles.append(m.register_forward_pre_hook(pre, with_kwargs=True))

    def remove(self):
        for h in self.handles:
            h.remove()

    def shapes(self):
        return {tid: to_calc(self.raw[tid], layout) for tid, (n, w, layout) in self.spec.items() if tid in self.raw}

    def torch_info(self):
        return {tid: {"module": self.spec[tid][0], "hook": str(self.spec[tid][1]), "torch_shape": self.raw[tid]}
                for tid in self.spec if tid in self.raw}


def backbone_spec(prefix):
    s = {"stem-out": (f"{prefix}.act1", "out", "grid"), "pool-out": (f"{prefix}.maxpool", "out", "grid")}
    for k in range(1, 5):
        s[f"l{k}-b1-out"] = (f"{prefix}.layer{k}.0", "out", "grid")
        s[f"c{k + 1}"] = (f"{prefix}.layer{k}", "out", "grid")
    return s


def mha_spec(pre, mod):
    return {
        pre + "qp": (f"{mod}.q_proj", "out", "seq"), pre + "kp": (f"{mod}.k_proj", "out", "seq"),
        pre + "vp": (f"{mod}.v_proj", "out", "seq"), pre + "z": (f"{mod}.o_proj", "in", "seq"),
        pre + "o": (f"{mod}.o_proj", "out", "seq"),
    }


def ffn_spec(pre, layer):
    return {pre + "u": (f"{layer}.mlp.fc1", "out", "seq"), pre + "g": (f"{layer}.mlp.activation_fn", "out", "seq"),
            pre + "f": (f"{layer}.mlp.fc2", "out", "seq")}


def detr_spec():
    m, e, d = "model", "model.encoder.layers.0", "model.decoder.layers.0"
    s = backbone_spec("model.backbone.model")
    s.update({
        "proj": (f"{m}.input_projection", "out", "grid"),
        "memory-in": (e, "in", "seq"),
        "e-qk-in": (f"{e}.self_attn.q_proj", "in", "seq"),
        "e-r1": (f"{e}.self_attn_layer_norm", "in", "seq"), "e-ln1": (f"{e}.self_attn_layer_norm", "out", "seq"),
        "e-r2": (f"{e}.final_layer_norm", "in", "seq"),
        "memory": ("model.encoder.layers.5", "out", "seq"),
        "tgt0": (d, "in", "seq"),
        "d-qk-in": (f"{d}.self_attn.q_proj", "in", "seq"),
        "d-r1": (f"{d}.self_attn_layer_norm", "in", "seq"), "d-ln1": (f"{d}.self_attn_layer_norm", "out", "seq"),
        "d-cross-q-in": (f"{d}.encoder_attn.q_proj", "in", "seq"), "d-cross-k-in": (f"{d}.encoder_attn.k_proj", "in", "seq"),
        "d-r2": (f"{d}.encoder_attn_layer_norm", "in", "seq"), "d-ln2": (f"{d}.encoder_attn_layer_norm", "out", "seq"),
        "d-r3": (f"{d}.final_layer_norm", "in", "seq"),
        "d-out": ("model.decoder.layers.5", "out", "seq"),
        "hs": ("model.decoder.layernorm", "out", "seq"),
        "logits": ("class_labels_classifier", "out", "seq"),
        "box-h1": ("bbox_predictor.layers.0", "out", "seq"), "box-h2": ("bbox_predictor.layers.1", "out", "seq"),
        "box-raw": ("bbox_predictor.layers.2", "out", "seq"),
    })
    s.update(mha_spec("e-", f"{e}.self_attn"))
    s.update(mha_spec("d-self-", f"{d}.self_attn"))
    s.update(mha_spec("d-cross-", f"{d}.encoder_attn"))
    s.update(ffn_spec("e-", e))
    s.update(ffn_spec("d-", d))
    return s


def deformable_spec():
    e, d = "model.encoder.layers.0", "model.decoder.layers.0"
    s = backbone_spec("model.backbone.model")
    for i in range(4):
        s[f"src-l{i + 1}-conv"] = (f"model.input_proj.{i}.0", "out", "grid")
        s[f"src-l{i + 1}"] = (f"model.input_proj.{i}.1", "out", "grid")
    s.update({
        "memory-in": (e, "in", "seq"),
        "e-ref": (f"{e}.self_attn", ("kw", "reference_points"), "seq"),
        "e-value": (f"{e}.self_attn.value_proj", "out", "seq"),
        "e-q-in": (f"{e}.self_attn.sampling_offsets", "in", "seq"),
        "e-offsets": (f"{e}.self_attn.sampling_offsets", "out", "seq"),
        "e-aw-logits": (f"{e}.self_attn.attention_weights", "out", "seq"),
        "e-z": (f"{e}.self_attn.output_proj", "in", "seq"), "e-o": (f"{e}.self_attn.output_proj", "out", "seq"),
        "e-r1": (f"{e}.self_attn_layer_norm", "in", "seq"), "e-ln1": (f"{e}.self_attn_layer_norm", "out", "seq"),
        "e-r2": (f"{e}.final_layer_norm", "in", "seq"),
        "memory": ("model.encoder.layers.5", "out", "seq"),
        "d-ref-logits": ("model.reference_points", "out", "seq"),
        "tgt0": (d, "in", "seq"),
        "d-qk-in": (f"{d}.self_attn.q_proj", "in", "seq"),
        "d-r1": (f"{d}.self_attn_layer_norm", "in", "seq"), "d-ln1": (f"{d}.self_attn_layer_norm", "out", "seq"),
        "d-cross-q-in": (f"{d}.encoder_attn.sampling_offsets", "in", "seq"),
        "d-cross-value": (f"{d}.encoder_attn.value_proj", "out", "seq"),
        "d-cross-offsets": (f"{d}.encoder_attn.sampling_offsets", "out", "seq"),
        "d-cross-aw-logits": (f"{d}.encoder_attn.attention_weights", "out", "seq"),
        "d-cross-z": (f"{d}.encoder_attn.output_proj", "in", "seq"), "d-cross-o": (f"{d}.encoder_attn.output_proj", "out", "seq"),
        "d-r2": (f"{d}.encoder_attn_layer_norm", "in", "seq"), "d-ln2": (f"{d}.encoder_attn_layer_norm", "out", "seq"),
        "d-r3": (f"{d}.final_layer_norm", "in", "seq"),
        "hs": ("model.decoder.layers.5", "out", "seq"),
        "logits": ("class_embed.5", "out", "seq"),
        "box-h1": ("bbox_embed.5.layers.0", "out", "seq"), "box-h2": ("bbox_embed.5.layers.1", "out", "seq"),
        "box-raw": ("bbox_embed.5.layers.2", "out", "seq"),
    })
    s.update(mha_spec("d-self-", f"{d}.self_attn"))
    s.update(ffn_spec("e-", e))
    s.update(ffn_spec("d-", d))
    return s


NOT_HOOKED_DETR = {
    "pos": "DetrSinePositionEmbedding devuelve [1, D, H/32, W/32]; se registra aplanada (N×D) desde su forward hook",
    "query-pos": "es el peso de query_position_embeddings (Q×D): se registra su forma",
    "e-q / e-k / e-v, d-*-q/k/v, *-scores, *-scores-scaled, *-z-heads": "view + transpose y torch.matmul dentro de eager_attention_forward (sin módulo); "
                                                                        "*-attn se toman de output_attentions=True",
    "e-g / d-g": "nn.ReLU registrado como activation_fn: sí se engancha",
    "box-a1 / box-a2 / boxes": "relu funcional dentro de DetrMLPPredictionHead; boxes = pred_boxes",
    "cost / assignment / loss / gt-*": "solo entrenamiento (necesita labels y scipy): no se ejecuta; Q×G y G×2 son triviales",
    "flatten": "flatten(2).transpose(1, 2) dentro de DetrModel.forward: memory-in se toma como entrada de encoder.layers.0",
}
NOT_HOOKED_DEF = {
    "pos-sine / level-table / pos": "pos-sine = suma de las PE por nivel (forward hook de position_embedding, una llamada por nivel); "
                                    "level-table = forma de level_embed; pos = pos-sine + level_embed (sin módulo)",
    "query-pos / tgt0": "query_position_embeddings.weight (Q×2D) partido en dos (torch.split dentro del forward); tgt0 = entrada de decoder.layers.0",
    "e-aw / e-sampled / d-cross-aw / d-cross-sampled": "softmax y grid_sample dentro de MultiScaleDeformableAttention: e-aw sale de las attention weights "
                                                       "(B, N, h, L, K) que recibe; e-sampled = h×N×LK×d_h (lo arma grid_sample nivel por nivel)",
    "d-ref": "sigmoid funcional sobre reference_points(query_pos): misma forma que d-ref-logits",
    "box-ref / box-logits / boxes": "suma de inverse_sigmoid(ref) y sigmoid funcionales; boxes = pred_boxes",
    "cost / assignment / loss / gt-*": "solo entrenamiento (necesita labels y scipy): no se ejecuta",
}


def detr_params(model):
    m = model.model
    enc, dec = m.encoder.layers, m.decoder.layers
    s = lambda layers, f: int(sum(n_params(f(b)) for b in layers))  # noqa: E731
    bb = m.backbone.model
    by_node = {
        "backbone": n_params(m.backbone), "stem": n_params(bb.conv1) + n_params(bb.bn1),
        "input-proj": n_params(m.input_projection), "pos-enc": n_params(m.position_embedding),
        "encoder": n_params(m.encoder), "enc-layer": n_params(enc),
        "queries": n_params(m.query_position_embeddings),
        "decoder": n_params(dec), "dec-layer": n_params(dec), "dec-norm": n_params(m.decoder.layernorm),
        "class-head": n_params(model.class_labels_classifier), "box-head": n_params(model.bbox_predictor),
    }
    for k in range(1, 5):
        by_node[f"layer{k}"] = n_params(getattr(bb, f"layer{k}"))
    by_path = {
        "encoder>enc-layer>self-attn": s(enc, lambda b: b.self_attn),
        "encoder>enc-layer>self-attn>q-proj": s(enc, lambda b: b.self_attn.q_proj),
        "encoder>enc-layer>self-attn>v-proj": s(enc, lambda b: b.self_attn.v_proj),
        "encoder>enc-layer>self-attn>proj": s(enc, lambda b: b.self_attn.o_proj),
        "encoder>enc-layer>ffn": s(enc, lambda b: b.mlp),
        "encoder>enc-layer>ln1": s(enc, lambda b: b.self_attn_layer_norm),
        "encoder>enc-layer>ln2": s(enc, lambda b: b.final_layer_norm),
        "decoder>dec-layer>self-attn": s(dec, lambda b: b.self_attn),
        "decoder>dec-layer>cross-attn": s(dec, lambda b: b.encoder_attn),
        "decoder>dec-layer>cross-attn>k-proj": s(dec, lambda b: b.encoder_attn.k_proj),
        "decoder>dec-layer>ffn": s(dec, lambda b: b.mlp),
        "decoder>dec-layer>ln1": s(dec, lambda b: b.self_attn_layer_norm),
        "decoder>dec-layer>ln2": s(dec, lambda b: b.encoder_attn_layer_norm),
        "decoder>dec-layer>ln3": s(dec, lambda b: b.final_layer_norm),
        "box-head>fc1": n_params(model.bbox_predictor.layers[0]),
        "box-head>fc3": n_params(model.bbox_predictor.layers[2]),
    }
    return by_node, by_path


def deformable_params(model):
    m = model.model
    enc, dec = m.encoder.layers, m.decoder.layers
    s = lambda layers, f: int(sum(n_params(f(b)) for b in layers))  # noqa: E731
    bb = m.backbone.model
    by_node = {
        "backbone": n_params(m.backbone), "stem": n_params(bb.conv1) + n_params(bb.bn1),
        "input-proj": n_params(m.input_proj), "pos-enc": n_params(m.position_embedding) + int(m.level_embed.numel()),
        "level-embed": int(m.level_embed.numel()),
        "encoder": n_params(m.encoder), "enc-layer": n_params(enc),
        "queries": n_params(m.query_position_embeddings),
        "decoder": n_params(m.decoder) + n_params(m.reference_points), "dec-layer": n_params(dec),
        "ref-points": n_params(m.reference_points),
        "class-head": n_params(model.class_embed), "box-head": n_params(model.bbox_embed),
    }
    for k in range(1, 5):
        by_node[f"layer{k}"] = n_params(getattr(bb, f"layer{k}"))
    for i in range(4):
        by_node[f"proj-l{i + 1}"] = n_params(m.input_proj[i])
    by_path = {
        "encoder>enc-layer>self-attn": s(enc, lambda b: b.self_attn),
        "encoder>enc-layer>self-attn>offsets": s(enc, lambda b: b.self_attn.sampling_offsets),
        "encoder>enc-layer>self-attn>attn-weights": s(enc, lambda b: b.self_attn.attention_weights),
        "encoder>enc-layer>self-attn>value-proj": s(enc, lambda b: b.self_attn.value_proj),
        "encoder>enc-layer>self-attn>proj": s(enc, lambda b: b.self_attn.output_proj),
        "encoder>enc-layer>ffn": s(enc, lambda b: b.mlp),
        "decoder>dec-layer>self-attn": s(dec, lambda b: b.self_attn),
        "decoder>dec-layer>cross-attn": s(dec, lambda b: b.encoder_attn),
        "decoder>dec-layer>cross-attn>offsets": s(dec, lambda b: b.encoder_attn.sampling_offsets),
        "decoder>dec-layer>ffn": s(dec, lambda b: b.mlp),
    }
    return by_node, by_path


def frozen_official(model):
    """Parámetros que el código oficial congela: todo el backbone salvo layer2…layer4 (conv1 y layer1)."""
    bb = model.model.backbone.model
    return int(sum(p.numel() for n, p in bb.named_parameters() if not any(f"layer{k}" in n for k in (2, 3, 4))))


def count(model, x, **kw):
    fcm = FlopCounterMode(display=False, custom_mapping=CUSTOM)
    with fcm, torch.no_grad():
        out = model(pixel_values=x, output_attentions=True, **kw)
    counts = fcm.get_flop_counts()
    by_op = {str(k): int(v) for k, v in counts.get("Global", {}).items()}
    return int(fcm.get_total_flops()), dict(sorted(by_op.items())), counts, out


def run_detr(config_id, H, W, Q):
    model, cfg, ctor, backbone = build("detr", Q)
    rec = Recorder(model, detr_spec())
    pos_shape = {}

    def pos_hook(mod, inp, out):
        pos_shape.setdefault("s", list(out.shape))   # sin return: no reemplaza la salida
    hp = model.model.position_embedding.register_forward_hook(pos_hook)
    x = torch.zeros(1, 3, H, W)
    flops, by_op, _, out = count(model, x)
    rec.remove()
    hp.remove()
    shapes = {"x-img": [H, W, 3]}
    shapes.update(rec.shapes())
    p = pos_shape["s"]
    shapes["pos"] = [p[2] * p[3], p[1]]
    shapes["query-pos"] = list(model.model.query_position_embeddings.weight.shape)
    shapes["e-attn"] = list(out.encoder_attentions[0].shape[1:])
    shapes["d-self-attn"] = list(out.decoder_attentions[0].shape[1:])
    shapes["d-cross-attn"] = list(out.cross_attentions[0].shape[1:])
    shapes["boxes"] = list(out.pred_boxes.shape[1:])
    by_node, by_path = detr_params(model)
    total = n_params(model)
    frozen = frozen_official(model)
    data = {
        "config_id": config_id, "model": "detr",
        "params_total": total,
        "params_by_module": {n: n_params(mm) for n, mm in model.model.named_children() if n_params(mm)}
        | {"class_labels_classifier": n_params(model.class_labels_classifier), "bbox_predictor": n_params(model.bbox_predictor)},
        "params_by_node": by_node, "params_by_path": by_path,
        "buffers_total": int(sum(b.numel() for b in model.buffers())),
        "params_official_trainable": total - frozen, "params_official_frozen": frozen,
        "shapes": shapes, "shapes_torch": rec.torch_info(), "not_hooked": NOT_HOOKED_DETR,
        "flops_total": flops, "flops_by_op": by_op,
        "source": {"lib": "transformers", "ctor": ctor, "backbone": backbone, "versions": versions()},
        "notes": [
            "Construido en código (sin hub ni pesos): backbone timm resnet50 (use_pretrained_backbone=False), el mismo "
            "ResNet-50 v1.5 que torchvision (stride en la 3×3).",
            "BatchNorm del backbone: HF la reemplaza por DetrFrozenBatchNorm2d (weight, bias, running_mean y running_var "
            "son buffers: buffers_total = 4·26,560 = 106,240), igual que el código oficial (FrozenBatchNorm2d de "
            "facebookresearch/detr). Por eso HF y el oficial dan el mismo número de parámetros; con BatchNorm normal "
            "(torchvision) serían +53,120 (γ, β). El calculador sigue al oficial (cfg.frozenBN = true).",
            "El código oficial imprime los parámetros con requires_grad (n_parameters en main.py): congela conv1 y layer1 "
            "del backbone → params_official_trainable = params_total − params_official_frozen.",
            "Q, K y V separados (HF q_proj/k_proj/v_proj); el oficial usa nn.MultiheadAttention con in_proj fusionado "
            "(3D×D + 3D): mismos conteos. La posición se suma a Q y K (nunca a V) en las 12 atenciones.",
            "auxiliary_loss=False: HF aplica las cabezas solo a la salida final. El código oficial las aplica a las 6 "
            "salidas del decoder en cada forward (pérdidas auxiliares; en inferencia usa la última): el calculador "
            "predice con la última (repeat 1) e informa la diferencia en quantities.auxHeadsMacs.",
            "FlopCounterMode cuenta convs, Linear y las matmuls de la atención eager (QKᵀ, A·V) a 2 FLOPs por MAC; "
            "FrozenBN, ReLU, LayerNorm, softmax, la PE seno/coseno y las sumas de posición no cuentan.",
            "El matching húngaro y la pérdida (solo entrenamiento, con labels y scipy) no se ejecutan; no tienen MACs.",
            "Formas sin batch; rejillas H×W×C (PyTorch: C×H×W).",
        ],
    }
    write_expected(config_id, data)
    return data


def run_deformable(config_id, H, W, Q):
    model, cfg, ctor, backbone = build("deformable", Q)
    rec = Recorder(model, deformable_spec())
    calls = []

    def msda_pre(mod, args):
        value, locs, aw = args[0], args[4], args[5]
        calls.append({"value": list(value.shape), "sampling_locations": list(locs.shape), "attention_weights": list(aw.shape)})
    hs = [mm.register_forward_pre_hook(msda_pre) for n, mm in model.named_modules() if n.endswith(".attn") and type(mm).__name__ == "MultiScaleDeformableAttention"]
    pos_shapes = []

    def pos_hook(mod, inp, out):
        pos_shapes.append(list(out.shape))           # sin return: no reemplaza la salida
    hp = model.model.position_embedding.register_forward_hook(pos_hook)
    x = torch.zeros(1, 3, H, W)
    flops, by_op_raw, counts, out = count(model, x)
    rec.remove()
    hp.remove()
    for h in hs:
        h.remove()
    # Cabezas de las 5 capas intermedias (HF las aplica en cada forward): se restan por operador.
    aux_by_op, aux = {}, 0
    for key, d in counts.items():
        parts = key.split(".")
        if len(parts) == 3 and parts[1] in ("class_embed", "bbox_embed") and parts[2] != str(cfg.decoder_layers - 1):
            for op, v in d.items():
                aux_by_op[str(op)] = aux_by_op.get(str(op), 0) + int(v)
                aux += int(v)
    by_op = {k: v - aux_by_op.get(k, 0) for k, v in by_op_raw.items()}
    # Muestreo deformable analítico: 5 MACs por (query, cabeza, nivel, punto, canal) → 10 FLOPs.
    sampling = 0
    for c in calls:
        B, Nq, h, L, K, _ = c["sampling_locations"]
        dh = c["value"][3]
        assert c["value"][2] == h
        sampling += 2 * 5 * Nq * h * L * K * dh
    shapes = {"x-img": [H, W, 3]}
    shapes.update(rec.shapes())
    shapes["pos-sine"] = [sum(p[2] * p[3] for p in pos_shapes), pos_shapes[0][1]]
    shapes["level-table"] = list(model.model.level_embed.shape)
    qw = model.model.query_position_embeddings.weight
    shapes["query-pos"] = [qw.shape[0], qw.shape[1] // 2]
    shapes["d-ref"] = shapes["d-ref-logits"]
    shapes["d-self-attn"] = list(out.decoder_attentions[0].shape[1:])
    shapes["boxes"] = list(out.pred_boxes.shape[1:])
    enc_call, dec_call = calls[0], calls[cfg.encoder_layers]
    for pre, c in (("e-", enc_call), ("d-cross-", dec_call)):
        B, Nq, h, L, K, _ = c["sampling_locations"]
        shapes[pre + "aw"] = [Nq, h * L * K]
        shapes[pre + "sampled"] = [h, Nq, L * K, c["value"][3]]
    by_node, by_path = deformable_params(model)
    total = n_params(model)
    frozen = frozen_official(model)
    data = {
        "config_id": config_id, "model": "deformable-detr",
        "params_total": total,
        "params_by_module": {n: n_params(mm) for n, mm in model.model.named_children() if n_params(mm)}
        | {"level_embed": int(model.model.level_embed.numel()), "class_embed": n_params(model.class_embed), "bbox_embed": n_params(model.bbox_embed)},
        "params_by_node": by_node, "params_by_path": by_path,
        "buffers_total": int(sum(b.numel() for b in model.buffers())),
        "params_official_trainable": total - frozen, "params_official_frozen": frozen,
        "levels": [[p[2], p[3]] for p in pos_shapes],
        "msda_calls": len(calls), "msda_encoder_call": enc_call, "msda_decoder_call": dec_call,
        "shapes": shapes, "shapes_torch": rec.torch_info(), "not_hooked": NOT_HOOKED_DEF,
        "flops_total": flops - aux + sampling,
        "flops_counted_torch": flops, "flops_aux_heads_torch": aux, "flops_sampling_analytic": sampling,
        "flops_by_op": dict(sorted(by_op.items())), "flops_by_op_raw": by_op_raw, "flops_by_op_aux_heads": aux_by_op,
        "source": {"lib": "transformers", "ctor": ctor, "backbone": backbone, "versions": versions()},
        "notes": [
            "Construido en código (sin hub ni pesos; sin el kernel CUDA: ruta PyTorch con grid_sample). Backbone timm "
            "resnet50 con FrozenBatchNorm (buffers), C3–C5 (out_indices [2, 3, 4]) + una conv 3×3 stride 2 sobre C5 "
            "(nivel 4); GroupNorm(32) tras cada proyección; level_embed L×D aprendido.",
            "Las cabezas (class_embed, bbox_embed) de las 6 capas del decoder comparten pesos (sin box refinement): "
            "parameters() las cuenta una vez. Clases = 91 (focal loss, sin clase ∅).",
            "FLOPs: FlopCounterMode NO cuenta grid_sample ni la suma ponderada de las muestras (elementwise). "
            "flops_sampling_analytic = Σ por llamada 2·5·N_q·h·L·K·d_h (4 MACs de la interpolación bilineal + 1 de la suma "
            "ponderada por canal y punto), con las formas reales de cada llamada (msda_calls). HF además aplica las cabezas "
            "a las 6 salidas del decoder: flops_aux_heads_torch (las 5 intermedias) se resta. "
            "flops_total = flops_counted_torch − flops_aux_heads_torch + flops_sampling_analytic.",
            "flops_by_op = flops_by_op_raw sin las cabezas auxiliares (comparable con el calculador); el muestreo no aparece "
            "en ningún operador aten.",
            "El código oficial congela conv1 y layer1 del backbone: params_official_trainable.",
            "Formas sin batch; rejillas H×W×C (PyTorch: C×H×W).",
        ],
    }
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    ids = sys.argv[1:] or list(CONFIGS)
    for cid in ids:
        kind, H, W, Q = CONFIGS[cid]
        d = (run_detr if kind == "detr" else run_deformable)(cid, H, W, Q)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}")
