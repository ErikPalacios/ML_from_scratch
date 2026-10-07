"""Cross-check de Grounding DINO (SPEC §9.3, §16.1): HF transformers GroundingDinoForObjectDetection construido en
código con Swin-T y BERT-base SIN pesos (SwinConfig y BertConfig por defecto, sin hub, sin tokenizer: los ids del
prompt se arman a mano con los ids especiales de BERT). Escribe crosscheck/expected/grounding-dino-t.json.

Uso: .venv/bin/python crosscheck/grounding_dino.py [configId ...]

- Parámetros: HF SwinBackbone conserva `swin.layernorm` (1,536) que su forward no usa; el calculador no lo cuenta y
  params_total = HF − 1,536 (params_total_hf_raw guarda el crudo).
- FLOPs (FlopCounterMode, 2 por MAC de matmul/conv): grid_sample y la suma ponderada de la atención deformable no
  cuentan → se suman analíticamente (5·N_q·h·L·K·d_h MACs por llamada, con las formas reales de cada llamada).
  HF aplica además, en cada forward, las cabezas a las 5 capas intermedias del decoder (pérdidas auxiliares) y los
  logits de las queries de contenido contra el texto (encoder_logits, solo para la pérdida): se restan.
  flops_total = flops_counted_torch − aux − encoder_logits + muestreo.
- flops_by_node: FLOPs por bloque leídos de los módulos de HF (mismos ajustes) ↔ 2·MACs de los nodos del calculador.
"""
import math
import sys

import torch
from torch.utils.flop_counter import FlopCounterMode
from transformers import GroundingDinoConfig, GroundingDinoForObjectDetection
from transformers.models.grounding_dino.modeling_grounding_dino import generate_masks_with_special_tokens_and_transfer_map

from common import CUSTOM, n_params, versions, write_expected

# configId → (H, W, T). Debe coincidir con js/arch/grounding-dino.js.
CONFIGS = {"grounding-dino-t": (896, 1344, 16)}
T_CHECK = 64            # segunda pasada con otro largo de texto (override_checks)
CLS, SEP, DOT = 101, 102, 1012


def make_ids(T):
    """[CLS] w w . w w . … [SEP]: frases de 2 palabras separadas por '.' (ids de BERT; sin tokenizer)."""
    body, w = [], 2000
    while len(body) < T - 2:
        if len(body) % 3 == 2:
            body.append(DOT)
        else:
            body.append(w)
            w += 1
    body = body[: T - 2]
    if body and body[-1] != DOT:
        body[-1] = DOT
    return torch.tensor([[CLS] + body + [SEP]])


def build():
    cfg = GroundingDinoConfig()
    model = GroundingDinoForObjectDetection._from_config(cfg, attn_implementation="eager")
    bc, tc = cfg.backbone_config, cfg.text_config
    backbone = {k: getattr(bc, k, None) for k in ("model_type", "embed_dim", "depths", "num_heads", "window_size", "out_indices")}
    text = {k: getattr(tc, k, None) for k in ("model_type", "hidden_size", "num_hidden_layers", "num_attention_heads", "intermediate_size", "vocab_size", "max_position_embeddings")}
    ctor = ("GroundingDinoForObjectDetection._from_config(GroundingDinoConfig(), attn_implementation='eager')  "
            "# backbone_config = SwinConfig(out_indices=[2, 3, 4]) y text_config = BertConfig() por defecto, sin pesos")
    return model.eval().requires_grad_(False), cfg, ctor, backbone, text


class Recorder:
    """Forma de salida ('out'), de la primera entrada ('in') o de un kwarg (('kw', nombre)); módulos por nombre u objeto."""

    def __init__(self, model, spec):
        self.spec, self.raw, self.handles = spec, {}, []
        mods = dict(model.named_modules())
        for tid, (mod, where, fn) in spec.items():
            m = mods[mod] if isinstance(mod, str) else mod
            if where == "out":
                def hook(_m, inp, out, tid=tid):
                    t = out[0] if isinstance(out, tuple) else out
                    self.raw.setdefault(tid, list(t.shape))
                self.handles.append(m.register_forward_hook(hook))
            else:
                def pre(_m, args, kwargs, tid=tid, where=where):
                    t = (args[0] if args else next(iter(kwargs.values()))) if where == "in" else kwargs.get(where[1])
                    self.raw.setdefault(tid, list(t.shape))
                self.handles.append(m.register_forward_pre_hook(pre, with_kwargs=True))

    def remove(self):
        for h in self.handles:
            h.remove()

    def shapes(self):
        return {tid: self.spec[tid][2](self.raw[tid]) for tid in self.spec if tid in self.raw}

    def torch_info(self):
        return {tid: {"module": self.spec[tid][0] if isinstance(self.spec[tid][0], str) else repr(type(self.spec[tid][0]).__name__),
                      "hook": str(self.spec[tid][1]), "torch_shape": self.raw[tid]} for tid in self.spec if tid in self.raw}


def seq(s):          # [1, N, C] → [N, C]
    assert s[0] == 1, s
    return s[1:]


def nchw(s):         # [1, C, H, W] → [H, W, C]
    assert s[0] == 1, s
    return [s[2], s[3], s[1]]


def grid(H, W):      # [1, H·W, C] → [H, W, C]
    def f(s):
        assert s[0] == 1 and s[1] == H * W, (s, H, W)
        return [H, W, s[2]]
    return f


def spec_for(model, H, W):
    sw = "model.backbone.conv_encoder.model"
    st = [(H // (4 * 2 ** i), W // (4 * 2 ** i)) for i in range(4)]
    depths = model.config.backbone_config.depths
    s = {"i-patch-grid": (f"{sw}.swin.embeddings.patch_embeddings.projection", "out", nchw),
         "i-s1-in": (f"{sw}.swin.embeddings", "out", grid(*st[0]))}
    for k in range(4):
        L = f"{sw}.swin.encoder.layers.{k}"
        g = grid(*st[k])
        for j, b in ((1, 0), (2, 1)):
            pre = f"i-s{k + 1}-b{j}-"
            s.update({pre + "ln1": (f"{L}.blocks.{b}.layernorm_before", "out", g), pre + "r1": (f"{L}.blocks.{b}.layernorm_after", "in", g),
                      pre + "ln2": (f"{L}.blocks.{b}.layernorm_after", "out", g), pre + "u": (f"{L}.blocks.{b}.mlp.fc1", "out", g),
                      pre + "g": (f"{L}.blocks.{b}.mlp.activation_fn", "out", g), pre + "f": (f"{L}.blocks.{b}.mlp.fc2", "out", g)})
        s[f"i-s{k + 1}-b1-out"] = (f"{L}.blocks.0", "out", g)
        s[f"i-s{k + 1}-out"] = (f"{L}.blocks.{depths[k] - 1}", "out", g)
        if k < 3:
            s[f"i-m{k + 1}-out"] = (f"{L}.downsample", "out", grid(*st[k + 1]))
        if k >= 1:
            s[f"i-c{k + 2}"] = (f"{sw}.hidden_states_norms.stage{k + 1}", "out", g)
    for l in range(4):
        s[f"i-src-l{l + 1}-conv"] = (f"model.input_proj_vision.{l}.0", "out", nchw)
        s[f"i-src-l{l + 1}"] = (f"model.input_proj_vision.{l}.1", "out", nchw)
    tb = "model.text_backbone"
    s.update({
        "t-tok": (f"{tb}.embeddings.word_embeddings", "out", seq), "t-e-pos": (f"{tb}.embeddings.position_embeddings", "out", seq),
        "t-e-type": (f"{tb}.embeddings.token_type_embeddings", "out", seq), "t-x0": (f"{tb}.embeddings.LayerNorm", "out", seq),
        "t-attn": (f"{tb}.encoder.layer.0.attention.output.dense", "out", seq), "t-r1": (f"{tb}.encoder.layer.0.attention.output.LayerNorm", "in", seq),
        "t-ln1": (f"{tb}.encoder.layer.0.attention.output.LayerNorm", "out", seq), "t-ffn": (f"{tb}.encoder.layer.0.output.dense", "out", seq),
        "t-r2": (f"{tb}.encoder.layer.0.output.LayerNorm", "in", seq), "t-bert-out": (f"{tb}.encoder.layer.11", "out", seq),
        "t-feat": ("model.text_projection", "out", seq),
    })
    e = "model.encoder.layers.0"
    fl, te, dl = f"{e}.fusion_layer", f"{e}.text_enhancer_layer", f"{e}.deformable_layer"
    s.update({
        "i-mem-in": (e, ("kw", "vision_features"), seq), "i-pos": (e, ("kw", "vision_position_embedding"), seq), "i-ref": (e, ("kw", "reference_points"), seq),
        "i-enh-fus-ln": (f"{fl}.layer_norm_vision", "out", seq), "t-enh-fus-ln": (f"{fl}.layer_norm_text", "out", seq),
        "i-enh-i2t-q": (f"{fl}.attn.vision_proj", "out", seq), "t-enh-i2t-k": (f"{fl}.attn.text_proj", "out", seq),
        "t-enh-i2t-v": (f"{fl}.attn.values_text_proj", "out", seq), "i-enh-t2i-v": (f"{fl}.attn.values_vision_proj", "out", seq),
        "i-enh-i2t-z": (f"{fl}.attn.out_vision_proj", "in", seq), "i-enh-i2t-o": (f"{fl}.attn.out_vision_proj", "out", seq),
        "t-enh-t2i-z": (f"{fl}.attn.out_text_proj", "in", seq), "t-enh-t2i-o": (f"{fl}.attn.out_text_proj", "out", seq),
        "t-enh-fused": (te, ("kw", "hidden_states"), seq), "i-enh-fused": (dl, ("kw", "hidden_states"), seq),
        "t-enh-qk-in": (f"{te}.self_attn.query", "in", seq), "t-enh-self-qp": (f"{te}.self_attn.query", "out", seq),
        "t-enh-self-kp": (f"{te}.self_attn.key", "out", seq), "t-enh-self-vp": (f"{te}.self_attn.value", "out", seq),
        "t-enh-self-z": (f"{te}.self_attn.out_proj", "in", seq), "t-enh-self-o": (f"{te}.self_attn.out_proj", "out", seq),
        "t-enh-r1": (f"{te}.layer_norm_before", "in", seq), "t-enh-ln1": (f"{te}.layer_norm_before", "out", seq),
        "t-enh-u": (f"{te}.fc1", "out", seq), "t-enh-f": (f"{te}.fc2", "out", seq), "t-enh-r2": (f"{te}.layer_norm_after", "in", seq),
        "t-memory": ("model.encoder.layers.5.text_enhancer_layer.layer_norm_after", "out", seq),
        "i-enh-q-in": (f"{dl}.self_attn.sampling_offsets", "in", seq), "i-enh-value": (f"{dl}.self_attn.value_proj", "out", seq),
        "i-enh-offsets": (f"{dl}.self_attn.sampling_offsets", "out", seq), "i-enh-aw-logits": (f"{dl}.self_attn.attention_weights", "out", seq),
        "i-enh-z": (f"{dl}.self_attn.output_proj", "in", seq), "i-enh-o": (f"{dl}.self_attn.output_proj", "out", seq),
        "i-enh-r1": (f"{dl}.self_attn_layer_norm", "in", seq), "i-enh-ln1": (f"{dl}.self_attn_layer_norm", "out", seq),
        "i-enh-u": (f"{dl}.fc1", "out", seq), "i-enh-f": (f"{dl}.fc2", "out", seq), "i-enh-r2": (f"{dl}.final_layer_norm", "in", seq),
        "i-memory": ("model.encoder.layers.5.deformable_layer.final_layer_norm", "out", seq),
        "q-cand-proj": ("model.enc_output", "out", seq), "q-cand": ("model.enc_output_norm", "out", seq),
        "q-enc-box-h1": ("model.encoder_output_bbox_embed.layers.0", "out", seq), "q-enc-box-h2": ("model.encoder_output_bbox_embed.layers.1", "out", seq),
        "q-enc-delta": ("model.encoder_output_bbox_embed.layers.2", "out", seq),
        "q-ref-pe": ("model.decoder.reference_points_head", "in", seq), "q-ref-h": ("model.decoder.reference_points_head.layers.0", "out", seq),
        "q-pos": ("model.decoder.reference_points_head", "out", seq),
    })
    d = "model.decoder.layers.0"
    s.update({
        "q-qk-in": (f"{d}.self_attn.query", "in", seq), "q-self-qp": (f"{d}.self_attn.query", "out", seq), "q-self-kp": (f"{d}.self_attn.key", "out", seq),
        "q-self-vp": (f"{d}.self_attn.value", "out", seq), "q-self-z": (f"{d}.self_attn.out_proj", "in", seq), "q-self-o": (f"{d}.self_attn.out_proj", "out", seq),
        "q-r1": (f"{d}.self_attn_layer_norm", "in", seq), "q-ln1": (f"{d}.self_attn_layer_norm", "out", seq),
        "q-txt-q-in": (f"{d}.encoder_attn_text.query", "in", seq), "q-txt-qp": (f"{d}.encoder_attn_text.query", "out", seq),
        "q-txt-kp": (f"{d}.encoder_attn_text.key", "out", seq), "q-txt-vp": (f"{d}.encoder_attn_text.value", "out", seq),
        "q-txt-z": (f"{d}.encoder_attn_text.out_proj", "in", seq), "q-txt-o": (f"{d}.encoder_attn_text.out_proj", "out", seq),
        "q-r2": (f"{d}.encoder_attn_text_layer_norm", "in", seq), "q-ln2": (f"{d}.encoder_attn_text_layer_norm", "out", seq),
        "q-img-q-in": (f"{d}.encoder_attn.sampling_offsets", "in", seq), "q-img-value": (f"{d}.encoder_attn.value_proj", "out", seq),
        "q-img-offsets": (f"{d}.encoder_attn.sampling_offsets", "out", seq), "q-img-aw-logits": (f"{d}.encoder_attn.attention_weights", "out", seq),
        "q-img-z": (f"{d}.encoder_attn.output_proj", "in", seq), "q-img-o": (f"{d}.encoder_attn.output_proj", "out", seq),
        "q-r3": (f"{d}.encoder_attn_layer_norm", "in", seq), "q-ln3": (f"{d}.encoder_attn_layer_norm", "out", seq),
        "q-u": (f"{d}.fc1", "out", seq), "q-f": (f"{d}.fc2", "out", seq), "q-r4": (f"{d}.final_layer_norm", "in", seq),
        "q-out": ("model.decoder.layers.5", "out", seq), "hs": ("model.decoder.layer_norm", "out", seq),
        # MLP de cajas: un solo módulo para el refinamiento del decoder y la cabeza (la 1.ª llamada es la del decoder).
        "q-refine-h1": (model.bbox_embed[0].layers[0], "out", seq), "q-refine-h2": (model.bbox_embed[0].layers[1], "out", seq),
        "q-refine-delta": (model.bbox_embed[0].layers[2], "out", seq),
    })
    return s


NOT_HOOKED = {
    "i-s{k}-b{j}-attn": "la atención por ventanas de HF devuelve las ventanas (nW×M²×C) antes de revertir la partición",
    "i-patch-* / i-pos-sine / i-level-table / i-flatten": "PE seno/coseno (buffer), level_embed (parámetro L×D) y el aplanado: sin módulo propio",
    "t-ids / t-type-ids / t-mask / t-pos-ids": "entradas y la máscara de sub-oraciones: se calculan con generate_masks_with_special_tokens_and_transfer_map",
    "t-x-pos / t-x-sum / t-pos": "sumas dentro de BertEmbeddings y la PE seno/coseno del texto (sin módulo)",
    "*-q / *-k / *-v / *-scores / *-scaled / *-attn / *-z-heads (fusión, texto, decoder)": "view/transpose y matmul sin módulo; los pesos de atención salen de output_attentions",
    "i-enh-aw / i-enh-sampled / q-img-aw / q-img-sampled": "softmax y grid_sample dentro de MultiScaleDeformableAttention: se derivan de las formas de cada llamada (msda_*_call)",
    "q-proposals / q-enc-logits / q-enc-boxes / q-topk / q-ref0-logit / q-ref0 / q-tgt0": "query selection funcional dentro de GroundingDinoModel.forward: enc_outputs_class, enc_outputs_coord_logits, init_reference_points y query_position_embeddings",
    "logits": "HF rellena hasta max_text_len = 256 columnas con −∞; la forma del calculador es la de las T columnas reales",
    "cost / assignment / loss / gt-*": "solo entrenamiento (necesita labels): no se ejecuta",
}


def by_module(counts, name):
    return int(sum(counts.get(name, {}).values()))


def run(config_id, H, W, T, extra_T=None):
    model, cfg, ctor, backbone, text = build()
    total_hf = n_params(model)
    sw = model.model.backbone.conv_encoder.model
    unused = n_params(sw.swin.layernorm)
    rec = Recorder(model, spec_for(model, H, W))
    calls = []

    def msda_pre(mod, args):
        calls.append({"value": list(args[0].shape), "sampling_locations": list(args[4].shape), "attention_weights": list(args[5].shape)})
    hs = [mm.register_forward_pre_hook(msda_pre) for n, mm in model.named_modules() if type(mm).__name__ == "MultiScaleDeformableAttention"]
    ids = make_ids(T)
    x = torch.zeros(1, 3, H, W)
    fcm = FlopCounterMode(display=False, custom_mapping=CUSTOM)
    with fcm, torch.no_grad():
        out = model(pixel_values=x, input_ids=ids, attention_mask=torch.ones_like(ids), output_attentions=True)
    rec.remove()
    for h in hs:
        h.remove()
    counts = fcm.get_flop_counts()
    flops = int(fcm.get_total_flops())
    root = "GroundingDinoForObjectDetection"
    Q, D, Ldec = cfg.num_queries, cfg.d_model, cfg.decoder_layers

    # Cabezas por capa (HF las aplica a las 6 capas) y encoder_logits: se miden con FlopCounterMode sobre los módulos.
    def flops_of(fn):
        f = FlopCounterMode(display=False)
        with f, torch.no_grad():
            fn()
        return int(f.get_total_flops())
    hsq, txt = torch.zeros(1, Q, D), torch.zeros(1, T, D)
    tok_mask = torch.ones(1, T, dtype=torch.bool)
    box_head = flops_of(lambda: model.bbox_embed[0](hsq))
    cls_head = flops_of(lambda: model.class_embed[0](hsq, txt, tok_mask))
    aux = (Ldec - 1) * (box_head + cls_head)
    enc_logits = cls_head                       # target (Q×D) · texto (T×D), solo para la pérdida
    # Muestreo deformable analítico: 5 MACs por (query, cabeza, nivel, punto, canal) → 10 FLOPs.
    samp_enc = samp_dec = 0
    for i, c in enumerate(calls):
        _, Nq, h, L, K, _ = c["sampling_locations"]
        dh = c["value"][3]
        v = 2 * 5 * Nq * h * L * K * dh
        if i < cfg.encoder_layers:
            samp_enc += v
        else:
            samp_dec += v
    m = f"{root}.model"
    model_total = by_module(counts, m)
    flops_by_node = {
        "img-backbone": by_module(counts, f"{m}.backbone"),
        "img-proj": sum(by_module(counts, f"{m}.input_proj_vision.{i}") for i in range(cfg.num_feature_levels)),   # ModuleList: se cuentan sus hijos
        "txt-backbone": by_module(counts, f"{m}.text_backbone"),
        "txt-proj": by_module(counts, f"{m}.text_projection"),
        "enhancer": by_module(counts, f"{m}.encoder") + samp_enc,
        "query-select": by_module(counts, f"{m}.enc_output") + by_module(counts, f"{m}.encoder_output_bbox_embed")
                        + by_module(counts, f"{m}.encoder_output_class_embed") - enc_logits,
        "decoder": by_module(counts, f"{m}.decoder") + samp_dec,
        "contrastive-head+box-head": flops - model_total - aux,
    }
    # Formas
    shapes = {"i-img": [H, W, 3]}
    shapes.update(rec.shapes())
    mask, pos_ids = generate_masks_with_special_tokens_and_transfer_map(ids)
    shapes["t-ids"] = [T]
    shapes["t-mask"] = list(mask.shape[1:])
    shapes["t-pos-ids"] = list(pos_ids.shape[1:])
    shapes["i-level-table"] = list(model.model.level_embed.shape)
    shapes["q-tgt0"] = list(model.model.query_position_embeddings.weight.shape)
    shapes["q-ref0"] = list(out.init_reference_points.shape[1:])
    shapes["q-enc-boxes"] = list(out.enc_outputs_coord_logits.shape[1:])
    ec = list(out.enc_outputs_class.shape[1:])
    assert ec[1] == cfg.max_text_len
    shapes["q-enc-logits"] = [ec[0], T]
    lg = list(out.logits.shape[1:])
    assert lg[1] == cfg.max_text_len
    shapes["logits"] = [lg[0], T]
    shapes["boxes"] = list(out.pred_boxes.shape[1:])
    att = out.encoder_attentions                  # (fusión imagen, fusión texto, texto, deformable)
    hfus = cfg.encoder_attention_heads // 2
    vi = list(att[0][0].shape)                    # (B·h, N, T)
    shapes["i-enh-i2t-attn"] = [hfus, vi[1], vi[2]]
    ti = list(att[1][0].shape)                    # (B·h, T, N)
    shapes["t-enh-t2i-attn"] = [hfus, ti[1], ti[2]]
    shapes["t-enh-self-attn"] = list(att[2][0].shape[1:])
    da = out.decoder_attentions                   # (self, cross de texto, cross de imagen)
    shapes["q-self-attn"] = list(da[0][0].shape[1:])
    shapes["q-txt-attn"] = list(da[1][0].shape[1:])
    enc_call, dec_call = calls[0], calls[cfg.encoder_layers]
    for pre, c in (("i-enh-", enc_call), ("q-img-", dec_call)):
        _, Nq, h, L, K, _ = c["sampling_locations"]
        shapes[pre + "aw"] = [Nq, h * L * K]
        shapes[pre + "sampled"] = [h, Nq, L * K, c["value"][3]]
    # Ventanas de Swin (always_partition: sin recorte; shift 3 en los bloques impares)
    windows = []
    for k, layer in enumerate(sw.swin.encoder.layers):
        for b, blk in enumerate(layer.blocks):
            windows.append({"stage": k + 1, "block": b + 1, "window_size": int(blk.window_size), "shift_size": int(blk.shift_size)})
    # Parámetros por nodo y por ruta
    mm = model.model
    enc, dec = mm.encoder.layers, mm.decoder.layers
    np_ = lambda x: sum(n_params(y) for y in x) if isinstance(x, list) else n_params(x)  # noqa: E731
    s = lambda layers, f: int(sum(np_(f(b)) for b in layers))  # noqa: E731
    box = n_params(model.bbox_embed[0])
    by_node = {
        "img-backbone": n_params(mm.backbone) - unused, "img-proj": n_params(mm.input_proj_vision) + int(mm.level_embed.numel()),
        "txt-backbone": n_params(mm.text_backbone), "txt-proj": n_params(mm.text_projection), "enhancer": n_params(mm.encoder),
        "query-select": n_params(mm.enc_output) + n_params(mm.enc_output_norm) + n_params(mm.encoder_output_bbox_embed) + n_params(mm.query_position_embeddings),
        "decoder": n_params(mm.decoder) - box - n_params(mm.decoder.layer_norm), "dec-norm": n_params(mm.decoder.layer_norm),
        "box-head": box, "contrastive-head": 0,
    }
    fa = lambda b: b.fusion_layer.attn  # noqa: E731
    by_path = {
        "img-backbone>patch-embed": n_params(sw.swin.embeddings),
        "img-backbone>out-norm": n_params(sw.hidden_states_norms),
        "enhancer>enh-layer>i2t": s(enc, lambda b: [fa(b).vision_proj, fa(b).text_proj, fa(b).values_text_proj, fa(b).out_vision_proj])
                                  + int(sum(b.fusion_layer.vision_param.numel() for b in enc)),
        "enhancer>enh-layer>t2i": s(enc, lambda b: [fa(b).values_vision_proj, fa(b).out_text_proj]) + int(sum(b.fusion_layer.text_param.numel() for b in enc)),
        "enhancer>enh-layer>txt-self": s(enc, lambda b: b.text_enhancer_layer.self_attn),
        "enhancer>enh-layer>txt-ffn": s(enc, lambda b: [b.text_enhancer_layer.fc1, b.text_enhancer_layer.fc2]),
        "enhancer>enh-layer>img-self": s(enc, lambda b: b.deformable_layer.self_attn),
        "enhancer>enh-layer>img-ffn": s(enc, lambda b: [b.deformable_layer.fc1, b.deformable_layer.fc2]),
        "decoder>ref-head": n_params(mm.decoder.reference_points_head),
        "decoder>dec-layer>self-attn": s(dec, lambda b: b.self_attn),
        "decoder>dec-layer>txt-cross": s(dec, lambda b: b.encoder_attn_text),
        "decoder>dec-layer>img-cross": s(dec, lambda b: b.encoder_attn),
        "decoder>dec-layer>ffn": s(dec, lambda b: [b.fc1, b.fc2]),
        "query-select>content": n_params(mm.query_position_embeddings),
        "query-select>enc-box": n_params(mm.encoder_output_bbox_embed),
        "txt-backbone>embeddings": n_params(mm.text_backbone.embeddings),
        "txt-backbone>bert-layer": n_params(mm.text_backbone.encoder),
    }
    for k in range(4):
        by_path[f"img-backbone>stage{k + 1}"] = n_params(sw.swin.encoder.layers[k].blocks)
        if k < 3:
            by_path[f"img-backbone>merge{k + 1}"] = n_params(sw.swin.encoder.layers[k].downsample)
    data = {
        "config_id": config_id, "model": "grounding-dino",
        "params_total": total_hf - unused, "params_total_hf_raw": total_hf, "params_unused_swin_layernorm": unused,
        "params_by_module": {n: n_params(c) for n, c in mm.named_children() if n_params(c)} | {"level_embed": int(mm.level_embed.numel()), "bbox_embed (compartido)": box},
        "params_by_node": by_node, "params_by_path": by_path,
        "text_input": {"T": T, "input_ids": ids[0].tolist(), "note": "ids de BERT armados a mano ([CLS]=101, [SEP]=102, '.'=1012): sin tokenizer ni descargas"},
        "levels": [[H // 8, W // 8], [H // 16, W // 16], [H // 32, W // 32], [math.ceil(H / 64), math.ceil(W / 64)]],
        "msda_calls": len(calls), "msda_encoder_call": enc_call, "msda_decoder_call": dec_call,
        "swin_windows": windows,
        "shapes": shapes, "shapes_torch": rec.torch_info(), "not_hooked": NOT_HOOKED,
        "flops_total": flops - aux - enc_logits + samp_enc + samp_dec,
        "flops_counted_torch": flops, "flops_aux_heads_torch": aux, "flops_encoder_logits_torch": enc_logits,
        "flops_sampling_analytic": samp_enc + samp_dec, "flops_sampling_encoder": samp_enc, "flops_sampling_decoder": samp_dec,
        "flops_by_node": flops_by_node,
        "flops_by_op_torch": {str(k): int(v) for k, v in counts.get("Global", {}).items()},
        "source": {"lib": "transformers", "ctor": ctor, "backbone": backbone, "text": text, "versions": versions()},
        "notes": [
            "Construido en código, sin hub, sin pesos y sin tokenizer: SwinConfig (Swin-T: C = 96, profundidades [2, 2, 6, 2], cabezas "
            "[3, 6, 12, 24], ventana 7, out_indices [2, 3, 4]) y BertConfig (bert-base: 12 × 768, 12 cabezas, FFN 3072, vocabulario 30,522) "
            "por defecto. Atención eager.",
            "params_total = params_total_hf_raw − 1,536: HF SwinBackbone conserva swin.layernorm (LayerNorm(768)) que su forward no usa "
            "(cada salida pasa por hidden_states_norms). El código oficial no tiene esa LayerNorm, pero su BERT es un BertModel CON pooler "
            "(768·768 + 768 = 590,592, congelado y sin uso); HF construye BERT sin pooler.",
            "El MLP de cajas (bbox_embed) es UN módulo: refina la caja en cada capa del decoder y es la cabeza de cajas "
            "(decoder_bbox_embed_share = True). La cabeza contrastiva no tiene parámetros: logits = query · token de texto, rellenados con −∞ "
            "hasta max_text_len = 256 columnas (la forma del calculador es la de las T reales). La query selection usa otra copia del MLP de "
            "cajas (two_stage_bbox_embed_share = False, como la config oficial SwinT_OGC).",
            "Swin: HF SwinBackbone usa always_partition = True: ninguna ventana se recorta y los bloques impares tienen shift 3 aun en el "
            "stage 4 (swin_windows). 896×1344 hace que los 4 stages (224×336 … 28×42) sean múltiplos de 7: sin padding.",
            "FLOPs: FlopCounterMode no cuenta grid_sample ni la suma ponderada de las muestras de la atención deformable: "
            "flops_sampling_analytic = Σ por llamada 2·5·N_q·h·L·K·d_h (12 llamadas: 6 del encoder sobre N tokens y 6 del decoder sobre Q). "
            "HF aplica las cabezas a las 6 salidas del decoder y calcula encoder_logits (queries de contenido × texto) en cada forward: "
            "se restan (flops_aux_heads_torch, flops_encoder_logits_torch; medidos con FlopCounterMode sobre los mismos módulos). "
            "flops_total = flops_counted_torch − aux − encoder_logits + muestreo.",
            "flops_by_node: FLOPs por módulo de HF con los mismos ajustes (el refinamiento de cajas del decoder cuenta dentro del decoder; "
            "la query selection = enc_output + encoder_output_bbox_embed + encoder_output_class_embed − encoder_logits).",
            "Formas sin batch; rejillas H×W×C (PyTorch: C×H×W; Swin de HF trabaja con secuencias H·W×C, que aquí se escriben como rejilla).",
        ],
    }
    if extra_T:
        model2 = model
        ids2 = make_ids(extra_T)
        f2 = FlopCounterMode(display=False, custom_mapping=CUSTOM)
        calls.clear()
        hs = [mm_.register_forward_pre_hook(msda_pre) for n, mm_ in model2.named_modules() if type(mm_).__name__ == "MultiScaleDeformableAttention"]
        with f2, torch.no_grad():
            out2 = model2(pixel_values=x, input_ids=ids2, attention_mask=torch.ones_like(ids2))
        for h in hs:
            h.remove()
        txt2 = torch.zeros(1, extra_T, D)
        cls2 = flops_of(lambda: model.class_embed[0](hsq, txt2, torch.ones(1, extra_T, dtype=torch.bool)))
        samp2 = sum(2 * 5 * c["sampling_locations"][1] * c["sampling_locations"][2] * c["sampling_locations"][3] * c["sampling_locations"][4] * c["value"][3] for c in calls)
        data["override_checks"] = [{
            "calc_overrides": {"T": extra_T},
            "flops_total": int(f2.get_total_flops()) - (Ldec - 1) * (box_head + cls2) - cls2 + samp2,
            "shapes": {"logits": [int(out2.logits.shape[1]), extra_T], "t-feat": [extra_T, D]},
            "note": f"misma referencia con T = {extra_T} tokens: cambian BERT, la fusión y los logits; los parámetros no",
        }]
    write_expected(config_id, data)
    return data


if __name__ == "__main__":
    ids_ = sys.argv[1:] or list(CONFIGS)
    for cid in ids_:
        H, W, T = CONFIGS[cid]
        d = run(cid, H, W, T, extra_T=T_CHECK)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}")
