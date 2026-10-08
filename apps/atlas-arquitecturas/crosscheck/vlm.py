"""Cross-check de los modelos `llava` y `qwen2-vl` (SPEC §19): HF LlavaForConditionalGeneration(LlavaConfig(...)) y
Qwen2VLForConditionalGeneration(Qwen2VLConfig(...)) construidos en código en el dispositivo META (sin pesos ni memoria, sin
hub; dimensiones copiadas de los config.json publicados). Escribe crosscheck/expected/{llava15-7b,llava15-13b,qwen2-vl-7b,
qwen2-vl-2b,qwen2-vl-72b}.json.

- Parámetros: sum(p.numel()) del modelo meta (exacto; con embeddings atados, la matriz cuenta una vez).
- FLOPs: FlopCounterMode sobre tensores meta con TODAS las capas (visión, proyector/merger, LLM y LM head), atención eager.
  Parches mínimos para que el forward corra en meta, ninguno cambia un FLOP:
  * torch_compilable_check (llava / qwen2_vl) → no-op: compara la cantidad de marcadores <image> con un .item() (imposible
    en meta). Los ids son ceros: el masked_scatter recibe la máscara de ceros y copia nada; los FLOPs no dependen de eso.
  * qwen2_vl.get_vision_position_ids → el mismo cálculo (CPU, a partir de grid_thw real) movido a meta; cu_seqlens queda en
    CPU (se usan sus valores para partir la atención por par de frames).
  * Máscara 4-D de ceros ya armada y position_ids dados (LLaVA: 0..S−1; Qwen2-VL: 3×1×S de ceros: los valores de M-RoPE no
    cambian FLOPs; su forma 3×S sí se verifica).
- LLaVA: HF corre las 24 capas de CLIP (output_hidden_states=True) y toma hidden_states[−2]: la capa 24 se cuenta (el
  calculador la tiene como op vis-last-layer).

Uso: .venv/bin/python crosscheck/vlm.py
"""
import types

import torch
from torch.utils.flop_counter import FlopCounterMode

from common import n_params, versions, write_expected

import transformers  # noqa: E402
from transformers import (CLIPVisionConfig, LlamaConfig, LlavaConfig, LlavaForConditionalGeneration,  # noqa: E402
                          Qwen2VLConfig, Qwen2VLForConditionalGeneration)
from transformers.models.llava import modeling_llava  # noqa: E402
from transformers.models.llama import modeling_llama  # noqa: E402
from transformers.models.qwen2_vl import modeling_qwen2_vl as mq  # noqa: E402
from transformers.models.qwen2_vl.image_processing_qwen2_vl import smart_resize  # noqa: E402
from transformers.models.llava_next.processing_llava_next import LlavaNextProcessor  # noqa: E402

modeling_llava.torch_compilable_check = lambda *a, **k: None
mq.torch_compilable_check = lambda *a, **k: None
_gvp = mq.get_vision_position_ids
mq.get_vision_position_ids = lambda grid_thw, sms, *a, **k: _gvp(grid_thw, sms, *a, **k).to("meta")

# Deben coincidir con js/arch/vlm.js.
LLAVA = {
    "llava15-7b": dict(D=4096, L=32, h=32, Dmlp=11008, V=32064, hf="llava-hf/llava-1.5-7b-hf"),
    "llava15-13b": dict(D=5120, L=40, h=40, Dmlp=13824, V=32064, hf="llava-hf/llava-1.5-13b-hf"),
}
QWEN = {
    "qwen2-vl-7b": dict(D=3584, L=28, h=28, G=4, Dmlp=18944, V=152064, tied=False, hf="Qwen/Qwen2-VL-7B-Instruct"),
    "qwen2-vl-2b": dict(D=1536, L=28, h=12, G=2, Dmlp=8960, V=151936, tied=True, hf="Qwen/Qwen2-VL-2B-Instruct"),
    "qwen2-vl-72b": dict(D=8192, L=80, h=64, G=8, Dmlp=29568, V=152064, tied=False, hf="Qwen/Qwen2-VL-72B-Instruct"),
}
T_DEFAULT = 64
QWEN_HW = (812, 812)
MIN_PIXELS, MAX_PIXELS = 3136, 12845056          # preprocessor_config.json de Qwen/Qwen2-VL-7B-Instruct
PINPOINTS = [[336, 672], [672, 336], [672, 672], [1008, 336], [336, 1008]]   # image_grid_pinpoints de llava-v1.6


class Recorder:
    def __init__(self):
        self.raw, self.handles, self.patches = {}, [], []

    def put(self, tid, shape, strip=True):
        s = list(shape)
        if strip:
            assert s[0] == 1, f"se esperaba B=1 en {tid}: {s}"
            s = s[1:]
        self.raw.setdefault(tid, s)

    def hook(self, model, name, where, tid, strip=True, fn=None):
        m = dict(model.named_modules())[name]
        if where == "out":
            def h(mod, inp, out):
                t = out[0] if isinstance(out, tuple) else out
                if hasattr(t, "last_hidden_state"):
                    t = t.last_hidden_state
                self.put(tid, fn(t.shape) if fn else t.shape, strip)
            self.handles.append(m.register_forward_hook(h))
        else:
            def p(mod, inp, kw=None):
                t = inp[0] if inp else None
                self.put(tid, fn(t.shape) if fn else t.shape, strip)
            self.handles.append(m.register_forward_pre_hook(p))

    def patch(self, module, attr, fn):
        orig = getattr(module, attr)
        setattr(module, attr, fn(orig))
        self.patches.append((module, attr, orig))

    def remove(self):
        for h in self.handles:
            h.remove()
        for module, attr, orig in reversed(self.patches):
            setattr(module, attr, orig)


def count(model, kwargs):
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = model(**kwargs)
    counts = fcm.get_flop_counts()
    by_op = {str(k): int(v) for k, v in counts.get("Global", {}).items()}
    by_mod = {k: sum(int(v) for v in d.values()) for k, d in counts.items() if k != "Global"}
    return int(fcm.get_total_flops()), dict(sorted(by_op.items())), by_mod, out


def llm_hooks(rec, model, pre, L, rope_mod, rope_fn="apply_rotary_pos_emb"):
    lay = pre + "layers.0."
    rec.hook(model, pre + "layers.0", "in", "prompt")
    rec.hook(model, lay + "input_layernorm", "out", "h-norm1")
    for t, mod in (("q", "q_proj"), ("k", "k_proj"), ("v", "v_proj")):
        rec.hook(model, lay + "self_attn." + mod, "out", t)
    rec.hook(model, lay + "self_attn.o_proj", "in", "z")
    rec.hook(model, lay + "self_attn.o_proj", "out", "o")
    rec.hook(model, lay + "post_attention_layernorm", "in", "r1")
    rec.hook(model, lay + "post_attention_layernorm", "out", "h-norm2")
    rec.hook(model, lay + "mlp.gate_proj", "out", "gate")
    rec.hook(model, lay + "mlp.up_proj", "out", "up")
    rec.hook(model, lay + "mlp.down_proj", "in", "prod")
    rec.hook(model, lay + "mlp.down_proj", "out", "f")
    rec.hook(model, pre + f"layers.{L - 1}", "out", "x-out")
    rec.hook(model, pre + "norm", "out", "x-norm")
    rec.hook(model, "lm_head", "out", "logits")
    calls = {"n": 0}

    def wrap(orig):
        def f(q, k, cos, sin, *a, **kw):
            if calls["n"] == 0:
                rec.put("q-heads", q.shape)
                rec.put("k-heads", k.shape)
            qo, ko = orig(q, k, cos, sin, *a, **kw)
            if calls["n"] == 0:
                rec.put("q-rope", qo.shape)
                rec.put("k-rope", ko.shape)
            calls["n"] += 1
            return qo, ko
        return f
    rec.patch(rope_mod, rope_fn, wrap)


# ---------------------------------------------------------------- LLaVA
def llava_config(c):
    vc = CLIPVisionConfig(hidden_size=1024, intermediate_size=4096, num_hidden_layers=24, num_attention_heads=16, image_size=336,
                          patch_size=14, projection_dim=768, hidden_act="quick_gelu")
    tc = LlamaConfig(vocab_size=c["V"], hidden_size=c["D"], intermediate_size=c["Dmlp"], num_hidden_layers=c["L"], num_attention_heads=c["h"],
                     num_key_value_heads=c["h"], max_position_embeddings=4096, rms_norm_eps=1e-5, rope_theta=10000.0, tie_word_embeddings=False)
    return LlavaConfig(vision_config=vc, text_config=tc, image_token_index=32000, vision_feature_layer=-2, vision_feature_select_strategy="default",
                       projector_hidden_act="gelu", multimodal_projector_bias=True, tie_word_embeddings=False)


def llava_ctor(c):
    return ("with torch.device('meta'): LlavaForConditionalGeneration(LlavaConfig(vision_config=CLIPVisionConfig(hidden_size=1024, "
            "intermediate_size=4096, num_hidden_layers=24, num_attention_heads=16, image_size=336, patch_size=14, projection_dim=768, "
            f"hidden_act='quick_gelu'), text_config=LlamaConfig(vocab_size={c['V']}, hidden_size={c['D']}, intermediate_size={c['Dmlp']}, "
            f"num_hidden_layers={c['L']}, num_attention_heads={c['h']}, num_key_value_heads={c['h']}, max_position_embeddings=4096, "
            "rms_norm_eps=1e-05, rope_theta=10000.0, tie_word_embeddings=False), image_token_index=32000, vision_feature_layer=-2, "
            "vision_feature_select_strategy='default', projector_hidden_act='gelu', multimodal_projector_bias=True, tie_word_embeddings=False))")


def llava_forward(model, T, images=1, record=False, c=None):
    rec = Recorder()
    if record:
        vm = "model.vision_tower."
        rec.hook(model, vm + "embeddings.patch_embedding", "out", "v-patch-grid", fn=lambda s: [s[0], s[2], s[3], s[1]])
        rec.hook(model, vm + "embeddings", "out", "v-x0")
        rec.hook(model, vm + "pre_layrnorm", "out", "v-ln-pre")
        rec.hook(model, vm + "encoder.layers.0.layer_norm1", "out", "v-h-ln1")
        rec.hook(model, vm + "encoder.layers.0.self_attn.q_proj", "out", "v-q-proj-out")
        rec.hook(model, vm + "encoder.layers.0.self_attn.out_proj", "in", "v-z")
        rec.hook(model, vm + "encoder.layers.0.self_attn.out_proj", "out", "v-o")
        rec.hook(model, vm + "encoder.layers.0.layer_norm2", "in", "v-r1")
        rec.hook(model, vm + "encoder.layers.0.mlp.fc1", "out", "v-u")
        rec.hook(model, vm + "encoder.layers.0.mlp.fc2", "out", "v-f")
        rec.hook(model, vm + "encoder.layers.22", "out", "v-x-out")
        rec.hook(model, vm + "encoder.layers.23", "out", "v-x-last")
        rec.hook(model, vm + "post_layernorm", "out", "v-cls-ln")
        rec.hook(model, "model.multi_modal_projector", "in", "vis-feats")
        rec.hook(model, "model.multi_modal_projector.linear_1", "out", "proj-h")
        rec.hook(model, "model.multi_modal_projector.act", "out", "proj-act")
        rec.hook(model, "model.multi_modal_projector.linear_2", "out", "vis-tokens")
        llm_hooks(rec, model, "model.language_model.", c["L"], modeling_llama)
    N = images * 576
    S = N + T
    kw = dict(input_ids=torch.zeros(1, S, dtype=torch.long, device="meta"), pixel_values=torch.zeros(images, 3, 336, 336, device="meta"),
              attention_mask=torch.zeros(1, 1, S, S, device="meta"), position_ids=torch.arange(S, device="meta")[None], use_cache=True,
              output_attentions=record)
    flops, by_op, by_mod, out = count(model, kw)
    rec.remove()
    shapes = dict(rec.raw)
    shapes.pop("v-q-proj-out", None)
    if record:
        shapes["attn"] = list(out.attentions[0].shape[1:])
        shapes["v-heads"] = list(out.past_key_values.layers[0].values.shape[1:])
    kv = sum(int(l.keys.numel() + l.values.numel()) for l in out.past_key_values.layers)
    return flops, by_op, by_mod, shapes, kv, S


def anyres_checks():
    stub = types.SimpleNamespace(image_processor=types.SimpleNamespace(image_grid_pinpoints=PINPOINTS), patch_size=14, num_additional_image_tokens=0)
    stub._get_unpadded_features = types.MethodType(LlavaNextProcessor._get_unpadded_features, stub)
    out = []
    for h, w in [[336, 336], [672, 672], [336, 672], [672, 336], [1008, 336], [336, 1008], [480, 640], [1024, 768], [500, 375], [1920, 1080]]:
        out.append({"H": h, "W": w, "tokens": int(LlavaNextProcessor._get_number_of_features(stub, h, w, 336, 336))})
    return out


def run_llava(config_id):
    c = LLAVA[config_id]
    with torch.device("meta"):
        model = LlavaForConditionalGeneration(llava_config(c))
    model.config._attn_implementation = "eager"
    model.eval()
    cls = type(model).__name__
    vt, lm = model.model.vision_tower, model.model.language_model
    layers = lm.layers
    lsum = lambda fn: int(sum(fn(layers[i]) for i in range(c["L"])))  # noqa: E731
    venc = vt.encoder.layers
    pb = {
        "vision-encoder": n_params(vt), "enc-layer": int(sum(n_params(venc[i]) for i in range(23))), "last-layer": n_params(venc[23]),
        "ln-post": n_params(vt.post_layernorm), "patch-embed": n_params(vt.embeddings.patch_embedding),
        "projector": n_params(model.model.multi_modal_projector),
        "embed": n_params(lm.embed_tokens), "llm": n_params(lm) - n_params(lm.embed_tokens), "lm-head": n_params(model.lm_head),
        "block": lsum(n_params), "attn": lsum(lambda l: n_params(l.self_attn)), "ffn": lsum(lambda l: n_params(l.mlp)),
        "q-proj": lsum(lambda l: n_params(l.self_attn.q_proj)), "o-proj": lsum(lambda l: n_params(l.self_attn.o_proj)),
        "final-norm": n_params(lm.norm),
    }
    pbp = {"projector>fc1": n_params(model.model.multi_modal_projector.linear_1), "projector>fc2": n_params(model.model.multi_modal_projector.linear_2)}
    params_total = n_params(model)
    flops, by_op, by_mod, shapes, kv, S = llava_forward(model, T_DEFAULT, record=True, c=c)
    pre = f"{cls}.model."
    fbn = {"vision-encoder": by_mod.get(pre + "vision_tower", 0), "last-layer": by_mod.get(pre + "vision_tower.encoder.layers.23", 0),
           "projector": by_mod.get(pre + "multi_modal_projector", 0), "llm": by_mod.get(pre + "language_model", 0), "lm-head": by_mod.get(f"{cls}.lm_head", 0)}
    assert set(by_op) <= {"aten.convolution", "aten.addmm", "aten.mm", "aten.bmm"}, by_op
    groups = [{"ops": ["aten.convolution"], "prims": ["conv2d"]},
              {"ops": ["aten.addmm", "aten.mm", "aten.bmm"], "prims": ["linear", "lm_head", "attention_scores", "attention_weighted_sum", "transformer_block"]}]
    shapes["pixels"] = [336, 336, 3]
    shapes["text-ids"] = [T_DEFAULT]
    oc = []
    for ov in ({"T": 256}, {"images": 2}):
        f2, _, _, sh2, _, _ = llava_forward(model, ov.get("T", T_DEFAULT), images=ov.get("images", 1), record=False, c=c)
        oc.append({"calc_overrides": ov, "flops_total": f2})
    notes = [
        "Modelo construido en código en el dispositivo meta (sin pesos ni hub; dimensiones del config.json de " + c["hf"] + "): parámetros exactos con sum(p.numel()).",
        f"FLOPs = FlopCounterMode sobre tensores meta con todas las capas: una imagen de 336×336 (576 tokens visuales) + T = {T_DEFAULT} tokens de texto = {S} filas en el LLM; logits sobre las {S} filas (sin logits_to_keep).",
        "HF corre las 24 capas de CLIP (get_image_features pide output_hidden_states=True) y toma hidden_states[−2] sin el CLS (vision_feature_layer = −2, estrategia 'default'): la capa 24 y post_layernorm se calculan y se descartan. El código original de LLaVA (CLIPVisionTower) hace lo mismo; vLLM la omite. El calculador la cuenta (op vis-last-layer) y metrics().visionMacsUsed la resta.",
        "HF embebe las N + T ids (los 576 marcadores <image> incluidos) y luego masked_scatter reemplaza esas filas por los tokens visuales; el calculador embebe solo las T de texto e inserta (splice). Mismos parámetros y FLOPs (el embedding es una búsqueda, 0 FLOPs); por eso text-emb no se engancha.",
        "Vocabulario 32,064 (llava-hf: 32,000 de Vicuna + <image> 32000 + <pad> 32001 + relleno a múltiplo de 64); el checkpoint original liuhaotian/llava-v1.5 usa 32,000 (2·64·D parámetros menos).",
        "Parches para meta (no cambian FLOPs): torch_compilable_check (cuenta de <image> con .item()) → no-op; máscara 4-D de ceros y position_ids dados.",
        "Proyector mlp2x_gelu con sesgos (multimodal_projector_bias = True): 1024 → D → D. CLIP con QuickGELU (hidden_act de openai/clip-vit-large-patch14-336).",
        "anyres_checks: tokens de LLaVA-NeXT (AnyRes, rejilla de llava-v1.6) con LlavaNextProcessor._get_number_of_features de HF (num_additional_image_tokens = 1 y estrategia 'default' se cancelan) ↔ ATLAS.Arch.vlm.llavaNextTokens; el paper/blog cuenta (recortes + 1)·576 = 2,880 a 672×672, HF 2,928 (quita relleno y suma 1 token de salto de línea por fila).",
    ]
    data = {
        "config_id": config_id, "model": "llava", "T": T_DEFAULT, "images": 1,
        "params_total": params_total, "params_by_node": pb, "params_by_path": pbp,
        "shapes": shapes, "flops_total": flops, "flops_by_node": fbn, "flops_by_op_torch": by_op, "flops_by_op_groups": groups,
        "override_checks": oc,
        "metrics_checks": {"kvBytesPerToken": kv * 2 // S, "visualTokens": 576, "projectorParams": pb["projector"], "visionParams": pb["vision-encoder"], "totalParams": params_total},
        "anyres_checks": anyres_checks(),
        "not_hooked": {"text-emb": "HF embebe N + T ids (ver notas)", "v-scores": "output_attentions de CLIP no se pide; attn = la del LLM",
                       "next-token": "el muestreo no es parte del forward de HF"},
        "hf_config_source": c["hf"],
        "source": {"lib": "transformers", "version": transformers.__version__, "ctor": llava_ctor(c), "attn_implementation": "eager", "versions": versions()},
        "notes": notes,
    }
    write_expected(config_id, data)


# ---------------------------------------------------------------- Qwen2-VL
def qwen_config(c):
    text = dict(vocab_size=c["V"], hidden_size=c["D"], intermediate_size=c["Dmlp"], num_hidden_layers=c["L"], num_attention_heads=c["h"],
                num_key_value_heads=c["G"], max_position_embeddings=32768, rms_norm_eps=1e-6, rope_theta=1000000.0,
                rope_scaling={"type": "mrope", "mrope_section": [16, 24, 24]}, use_sliding_window=False, tie_word_embeddings=c["tied"])
    vision = dict(depth=32, embed_dim=1280, hidden_size=c["D"], mlp_ratio=4, num_heads=16, in_channels=3, patch_size=14, spatial_merge_size=2,
                  temporal_patch_size=2, hidden_act="quick_gelu")
    return Qwen2VLConfig(text_config=text, vision_config=vision, tie_word_embeddings=c["tied"]), text, vision


def qwen_ctor(c):
    _, text, vision = qwen_config(c)
    return (f"with torch.device('meta'): Qwen2VLForConditionalGeneration(Qwen2VLConfig(text_config={text!r}, vision_config={vision!r}, "
            f"tie_word_embeddings={c['tied']!r}))")


def qwen_forward(model, c, H, W, T, frames=1, record=False):
    rec = Recorder()
    tseg = 1 if frames == 1 else frames // 2
    if record:
        v = "model.visual."
        rec.hook(model, v + "patch_embed", "out", "v-patches", strip=False)
        rec.hook(model, v + "blocks.0.norm1", "out", "v-h-ln1", strip=False)
        rec.hook(model, v + "blocks.0.attn.qkv", "out", "v-qkv", strip=False)
        rec.hook(model, v + "blocks.0.attn.proj", "in", "v-z", strip=False)
        rec.hook(model, v + "blocks.0.attn.proj", "out", "v-o", strip=False)
        rec.hook(model, v + "blocks.0.norm2", "in", "v-r1", strip=False)
        rec.hook(model, v + "blocks.0.mlp.fc1", "out", "v-u", strip=False)
        rec.hook(model, v + "blocks.0.mlp.fc2", "out", "v-f", strip=False)
        rec.hook(model, v + "blocks.31", "out", "vis-feats", strip=False)
        rec.hook(model, v + "merger.ln_q", "out", "v-merge-ln", strip=False)
        rec.hook(model, v + "merger.mlp.0", "in", "v-grouped", strip=False)
        rec.hook(model, v + "merger.mlp.0", "out", "merger-h", strip=False)
        rec.hook(model, v + "merger.mlp.1", "out", "merger-act", strip=False)
        rec.hook(model, v + "merger", "out", "vis-tokens", strip=False)
        rot = model.model.language_model.rotary_emb

        def pos_hook(mod, args, kwargs):   # rotary_emb(x, position_ids): position_ids (3, 1, S) → 3×S
            pid = args[1] if len(args) > 1 else kwargs["position_ids"]
            rec.put("pos-ids", [pid.shape[0], pid.shape[2]], False)
        rec.handles.append(rot.register_forward_pre_hook(pos_hook, with_kwargs=True))
        llm_hooks(rec, model, "model.language_model.", c["L"], mq)
        vcalls = {"n": 0}

        def wrapv(orig):
            def f(q, k, cos, sin):
                qo, ko = orig(q, k, cos, sin)
                if vcalls["n"] == 0:      # HF: (N_p, h_v, d_v) → calculador h_v × N_p × d_v (video: t × h_v × N_p/t × d_v, por par de frames)
                    for tid, x in (("v-q-rope", qo), ("v-k-rope", ko)):
                        n, hh, dd = x.shape
                        rec.put(tid, [hh, n, dd] if tseg == 1 else [tseg, hh, n // tseg, dd], False)
                vcalls["n"] += 1
                return qo, ko
            return f
        rec.patch(mq, "apply_rotary_pos_emb_vision", wrapv)
    t = 1 if frames == 1 else frames // 2
    gh, gw = H // 14, W // 14
    Np = t * gh * gw
    N = Np // 4
    S = N + T
    grid = torch.tensor([[t, gh, gw]])
    kw = dict(input_ids=torch.zeros(1, S, dtype=torch.long, device="meta"), attention_mask=torch.zeros(1, 1, S, S, device="meta"),
              position_ids=torch.zeros(3, 1, S, dtype=torch.long, device="meta"), use_cache=True, output_attentions=record)
    px = torch.zeros(Np, 3 * 2 * 14 * 14, device="meta")
    if frames == 1:
        kw.update(pixel_values=px, image_grid_thw=grid)
    else:
        kw.update(pixel_values_videos=px, video_grid_thw=grid)
    flops, by_op, by_mod, out = count(model, kw)
    rec.remove()
    shapes = dict(rec.raw)
    if record:
        shapes["attn"] = list(out.attentions[0].shape[1:])
        shapes["v-heads"] = list(out.past_key_values.layers[0].values.shape[1:])
    kv = sum(int(l.keys.numel() + l.values.numel()) for l in out.past_key_values.layers)
    return flops, by_op, by_mod, shapes, kv, S, N


def run_qwen(config_id):
    c = QWEN[config_id]
    cfg, _, _ = qwen_config(c)
    with torch.device("meta"):
        model = Qwen2VLForConditionalGeneration(cfg)
    model.config._attn_implementation = "eager"
    model.eval()
    cls = type(model).__name__
    vis, lm = model.model.visual, model.model.language_model
    layers = lm.layers
    lsum = lambda fn: int(sum(fn(layers[i]) for i in range(c["L"])))  # noqa: E731
    lm_head = 0 if c["tied"] else n_params(model.lm_head)
    pb = {
        "patchify": n_params(vis.patch_embed), "vision-encoder": n_params(vis.blocks), "merger": n_params(vis.merger),
        "embed": n_params(lm.embed_tokens), "llm": n_params(lm) - n_params(lm.embed_tokens), "lm-head": lm_head,
        "block": lsum(n_params), "attn": lsum(lambda l: n_params(l.self_attn)), "ffn": lsum(lambda l: n_params(l.mlp)),
        "q-proj": lsum(lambda l: n_params(l.self_attn.q_proj)), "k-proj": lsum(lambda l: n_params(l.self_attn.k_proj)),
        "v-proj": lsum(lambda l: n_params(l.self_attn.v_proj)), "o-proj": lsum(lambda l: n_params(l.self_attn.o_proj)),
        "final-norm": n_params(lm.norm),
    }
    pbp = {"merger>fc1": n_params(vis.merger.mlp[0]), "merger>fc2": n_params(vis.merger.mlp[2]), "merger>ln": n_params(vis.merger.ln_q)}
    params_total = n_params(model)
    H, W = QWEN_HW
    flops, by_op, by_mod, shapes, kv, S, N = qwen_forward(model, c, H, W, T_DEFAULT, record=True)
    pre = f"{cls}.model."
    vtot = by_mod.get(pre + "visual", 0)
    fbn = {"patchify": by_mod.get(pre + "visual.patch_embed", 0), "merger": by_mod.get(pre + "visual.merger", 0),
           "vision-encoder": vtot - by_mod.get(pre + "visual.patch_embed", 0) - by_mod.get(pre + "visual.merger", 0),
           "llm": by_mod.get(pre + "language_model", 0), "lm-head": by_mod.get(f"{cls}.lm_head", 0)}
    assert set(by_op) <= {"aten.convolution", "aten.addmm", "aten.mm", "aten.bmm"}, by_op
    groups = [{"ops": ["aten.convolution"], "prims": ["patch_embed_3d"]},
              {"ops": ["aten.addmm", "aten.mm"], "prims": ["linear", "lm_head"]},
              {"ops": ["aten.bmm"], "prims": ["attention_scores", "attention_weighted_sum"]}]
    shapes["pixels"] = [H, W, 3]
    shapes["text-ids"] = [T_DEFAULT]
    oc = []
    if config_id == "qwen2-vl-7b":
        for ov, (h, w, fr, T) in (({"H": 448, "W": 672}, (448, 672, 1, T_DEFAULT)), ({"frames": 4}, (H, W, 4, T_DEFAULT)), ({"T": 256}, (H, W, 1, 256)),
                                  ({"H": 1344, "W": 1344}, (1344, 1344, 1, T_DEFAULT))):
            f2, _, _, sh2, _, _, _ = qwen_forward(model, c, h, w, T, frames=fr, record=True)
            keep = {k: sh2[k] for k in ("v-patches", "vis-feats", "v-grouped", "vis-tokens", "prompt", "pos-ids", "logits", "v-q-rope") if k in sh2}
            oc.append({"calc_overrides": ov, "flops_total": f2, "shapes": keep})
    resize = []
    for h, w in [[812, 812], [480, 640], [1080, 1920], [300, 400], [2000, 3000], [37, 50], [1024, 768], [4000, 3000], [1023, 1023], [70, 70], [42, 42]]:
        hh, ww = smart_resize(h, w, factor=28, min_pixels=MIN_PIXELS, max_pixels=MAX_PIXELS)
        resize.append({"h": h, "w": w, "H": int(hh), "W": int(ww)})
    notes = [
        "Modelo construido en código en el dispositivo meta (sin pesos ni hub; dimensiones del config.json de " + c["hf"] + "): parámetros exactos con sum(p.numel())"
        + (" (embeddings atados: la matriz V×D cuenta una vez; el LM head no suma parámetros)." if c["tied"] else "."),
        f"FLOPs = FlopCounterMode sobre tensores meta con todas las capas: imagen de {H}×{W} → {(H // 14) * (W // 14):,} parches (Conv3d 2×14×14 sobre la imagen duplicada) → {N} tokens visuales tras el merge 2×2; + T = {T_DEFAULT} tokens de texto = {S} filas en el LLM; logits sobre todas las filas.",
        "Visual de HF (675.8M en los tres tamaños salvo el merger, que termina en D) = patchify + 32 bloques + merger: el calculador separa patchify, vision-encoder y merger.",
        "Merger de HF: ln_q (LayerNorm de 1280 POR parche) → view a (N_p/4)×5120 → Linear 5120→5120 → GELU → Linear 5120→D: la LayerNorm va antes de agrupar 2×2.",
        "Qwen2: W_Q, W_K, W_V con sesgo; W_O, la FFN y el LM head sin sesgo; RMSNorm ε 1e-6; RoPE θ 1e6 con M-RoPE (mrope_section [16, 24, 24]).",
        "Parches para meta (no cambian FLOPs): torch_compilable_check → no-op; get_vision_position_ids calculado en CPU y movido a meta; cu_seqlens en CPU (la atención del ViT se parte por par de frames); máscara 4-D de ceros; position_ids 3×1×S de ceros (la forma 3×S es la que recibe rotary_emb).",
        "Video (override frames = 4): pixel_values_videos con video_grid_thw = [2, H/14, W/14]: 2 parches temporales; la atención del ViT es por par de frames (cu_seqlens = repeat_interleave(h·w, t)) y el LLM ve 2·(H/28)(W/28) tokens.",
        "smart_resize_checks: smart_resize de Qwen2VLImageProcessor (factor 28, min_pixels 3,136, max_pixels 12,845,056 del preprocessor_config.json) ↔ ATLAS.Arch.vlm.smartResize (redondeo de Python: mitad al par).",
        "M-RoPE: con la imagen en el prompt, el texto siguiente continúa desde el máximo id + 1; el código original de Qwen2-VL usa max(t, h, w) de la rejilla y HF 5.19 max(h, w) (iguales para una imagen). No cambia FLOPs.",
    ]
    data = {
        "config_id": config_id, "model": "qwen2-vl", "T": T_DEFAULT, "H": H, "W": W,
        "params_total": params_total, "params_by_node": pb, "params_by_path": pbp,
        "shapes": shapes, "flops_total": flops, "flops_by_node": fbn, "flops_by_op_torch": by_op, "flops_by_op_groups": groups,
        "override_checks": oc,
        "metrics_checks": {"kvBytesPerToken": kv * 2 // S, "visualTokens": N, "projectorParams": pb["merger"],
                           "visualModuleParams": n_params(vis), "totalParams": params_total},
        "smart_resize_checks": resize,
        "not_hooked": {"text-emb": "HF embebe N + T ids y reemplaza las filas de la imagen (masked_scatter)",
                       "v-patch-grid": "HF aplana antes de la Conv3d (salida N_p×D_v×1×1×1)", "next-token": "el muestreo no es parte del forward de HF"},
        "hf_config_source": c["hf"],
        "source": {"lib": "transformers", "version": transformers.__version__, "ctor": qwen_ctor(c), "attn_implementation": "eager", "versions": versions()},
        "notes": notes,
    }
    write_expected(config_id, data)


if __name__ == "__main__":
    for cid in LLAVA:
        print(f"▸ {cid}", flush=True)
        run_llava(cid)
    for cid in QWEN:
        print(f"▸ {cid}", flush=True)
        run_qwen(cid)
