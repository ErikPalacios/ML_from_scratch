"""Cross-check de los modelos `openvla` y `pi0` (SPEC §21). Todo en el dispositivo META (sin pesos ni memoria, sin hub).
Escribe crosscheck/expected/{openvla-7b,pi0,pi0-1cam}.json.

OpenVLA (HF openvla/openvla-7b, rev. 47a0ec7, modeling_prismatic.py): el código remoto exige timm 0.9.x y transformers 4.40,
así que NO se carga con trust_remote_code; se reconstruye con las MISMAS piezas: timm.create_model(<timm_model_ids>,
pretrained=False, num_classes=0, img_size=224) para las dos torres (timm 1.0.30: mismas capas y parámetros), un forward que
copia el get_intermediate_layers(n = {L − 2}) de timm 0.9.16 (_intermediate_layers corre TODOS los bloques y devuelve la
salida del penúltimo, sin tokens prefijo ni norma final) puesto como forward de cada torre (igual que el monkeypatch de
PrismaticVisionBackbone), PrismaticProjector (fused: fc1, GELU, fc2, GELU, fc3) copiado del archivo y LlamaForCausalLM con el
text_config del checkpoint (vocab 32,064). Inserción de los parches después de <BOS> como PrismaticForConditionalGeneration.
Una acción = prefill + 6 pasos de decode con DynamicCache (generate con max_new_tokens = 7). Parámetros = 7,541,237,184 =
total_size / 2 de model.safetensors.index.json del checkpoint (bf16).

π0 (Physical-Intelligence/openpi, main @ 215abfb): como el port oficial de PyTorch (models_pytorch/gemma_pytorch.py,
pi0_pytorch.py): PaliGemmaForConditionalGeneration (SigLIP So400m/14 con intermediate 4304, projection_dim 2048, vocab
257,152; Gemma 2B) + GemmaModel con la config del experto (gemma_300m) y embed_tokens = None + las 5 lineales de pi0.py
(state_proj, action_in_proj, action_time_mlp_in, action_time_mlp_out, action_out_proj). sample_actions: el prefijo (imágenes +
texto) corre UNA vez por PaliGemma y deja la KV cache; cada uno de los 10 pasos corre el sufijo (estado + 50 acciones) por el
experto leyendo esa caché (DynamicCache recortada al prefijo tras cada paso, como hace openpi con use_cache=False).
FLOPs = FlopCounterMode, atención eager, todas las capas.

Uso: .venv/bin/python crosscheck/vla.py
"""
import math
import types

import torch
from torch import nn
from torch.utils.flop_counter import FlopCounterMode

from common import n_params, versions, write_expected

import timm  # noqa: E402
import transformers  # noqa: E402
from transformers import (GemmaConfig, GemmaModel, LlamaConfig, LlamaForCausalLM,  # noqa: E402
                          PaliGemmaConfig, PaliGemmaForConditionalGeneration)

# Deben coincidir con js/arch/vla.js.
OVLA = dict(H=224, P=14, T=22, da=7, D=4096, L=32, h=32, Dmlp=11008, V=32064, Ld=24, Ls=27)
TIMM_IDS = ["vit_large_patch14_reg4_dinov2.lvd142m", "vit_so400m_patch14_siglip_224"]
CKPT_PARAMS = 15082474368 // 2   # openvla/openvla-7b model.safetensors.index.json: total_size (bytes, bf16) / 2
PI0 = {"pi0": dict(cams=3), "pi0-1cam": dict(cams=1)}
PI0_BASE = dict(T=48, H=50, steps=10, da=32, D=2048, L=18, Da=1024)


def count_ctx():
    return FlopCounterMode(display=False)


def by_module(fcm):
    counts = fcm.get_flop_counts()
    return {k: sum(int(v) for v in d.values()) for k, d in counts.items() if k != "Global"}, \
        {str(k): int(v) for k, v in counts.get("Global", {}).items()}


class Rec:
    def __init__(self):
        self.raw, self.handles = {}, []

    def put(self, tid, shape):
        self.raw.setdefault(tid, [int(x) for x in shape])

    def hook(self, model, name, where, tid, fn=None):
        m = dict(model.named_modules())[name]
        if where == "out":
            def h(mod, inp, out):
                t = out[0] if isinstance(out, tuple) else out
                if hasattr(t, "last_hidden_state"):
                    t = t.last_hidden_state
                self.put(tid, fn(list(t.shape)) if fn else list(t.shape)[1:])
            self.handles.append(m.register_forward_hook(h))
        else:
            def p(mod, inp):
                self.put(tid, fn(list(inp[0].shape)) if fn else list(inp[0].shape)[1:])
            self.handles.append(m.register_forward_pre_hook(p))

    def remove(self):
        for h in self.handles:
            h.remove()


# ---------------------------------------------------------------- OpenVLA
def intermediate_forward(self, x):
    """timm 0.9.16 VisionTransformer.get_intermediate_layers(x, n={len(blocks) − 2}) (norm=False, sin prefijos)."""
    take = len(self.blocks) - 2
    x = self.patch_embed(x)
    x = self._pos_embed(x)
    x = self.patch_drop(x)
    x = self.norm_pre(x)
    out = None
    for i, blk in enumerate(self.blocks):   # timm 0.9: corre TODOS los bloques (sin parar en el que se toma)
        x = blk(x)
        if i == take:
            out = x
    return out[:, self.num_prefix_tokens:]


class PrismaticProjector(nn.Module):
    """modeling_prismatic.py, use_fused_vision_backbone = True."""

    def __init__(self, vision_dim, llm_dim):
        super().__init__()
        initial_projection_dim = 4 * vision_dim
        self.fc1 = nn.Linear(vision_dim, initial_projection_dim, bias=True)
        self.fc2 = nn.Linear(initial_projection_dim, llm_dim, bias=True)
        self.fc3 = nn.Linear(llm_dim, llm_dim, bias=True)
        self.act_fn1 = nn.GELU()
        self.act_fn2 = nn.GELU()

    def forward(self, x):
        return self.fc3(self.act_fn2(self.fc2(self.act_fn1(self.fc1(x)))))


class VisionBackbone(nn.Module):
    def __init__(self, res=224):
        super().__init__()
        self.featurizer = timm.create_model(TIMM_IDS[0], pretrained=False, num_classes=0, img_size=res)
        self.fused_featurizer = timm.create_model(TIMM_IDS[1], pretrained=False, num_classes=0, img_size=res)
        for m in (self.featurizer, self.fused_featurizer):
            m.forward = types.MethodType(intermediate_forward, m)
            for b in m.blocks:
                b.attn.fused_attn = False   # q @ kᵀ y A @ v explícitos (FlopCounterMode los cuenta como bmm)
        self.embed_dim = self.featurizer.embed_dim + self.fused_featurizer.embed_dim

    def forward(self, pixel_values):
        img, img_fused = torch.split(pixel_values, [3, 3], dim=1)
        return torch.cat([self.featurizer(img), self.fused_featurizer(img_fused)], dim=2)


class OpenVLARef(nn.Module):
    def __init__(self, res=224):
        super().__init__()
        self.vision_backbone = VisionBackbone(res)
        self.projector = PrismaticProjector(self.vision_backbone.embed_dim, OVLA["D"])
        tc = LlamaConfig(vocab_size=OVLA["V"], hidden_size=OVLA["D"], intermediate_size=OVLA["Dmlp"], num_hidden_layers=OVLA["L"],
                         num_attention_heads=OVLA["h"], num_key_value_heads=OVLA["h"], max_position_embeddings=4096, rms_norm_eps=1e-5,
                         rope_theta=10000.0, tie_word_embeddings=False, pad_token_id=32000)
        tc._attn_implementation = "eager"
        self.language_model = LlamaForCausalLM(tc)

    def forward(self, input_ids, pixel_values, output_attentions=False):   # prefill (claves de FlopCounterMode: 'OpenVLARef.…')
        patches = self.vision_backbone(pixel_values)
        proj = self.projector(patches)
        emb = self.language_model.get_input_embeddings()(input_ids)
        mm = torch.cat([emb[:, :1, :], proj, emb[:, 1:, :]], dim=1)
        S = mm.shape[1]
        return self.language_model(inputs_embeds=mm, attention_mask=torch.zeros(1, 1, S, S, device="meta"),
                                   position_ids=torch.arange(S, device="meta")[None], use_cache=True, output_attentions=output_attentions)


def run_openvla():
    with torch.device("meta"):
        model = OpenVLARef()
    model.eval()
    vb, lm = model.vision_backbone, model.language_model
    dino, sig = vb.featurizer, vb.fused_featurizer
    T, Np = OVLA["T"], (OVLA["H"] // OVLA["P"]) ** 2
    S = Np + T
    rec = Rec()
    grid = lambda s: [s[2], s[3], s[1]]  # noqa: E731
    for pre, tid, tw in (("vision_backbone.featurizer.", "d-", dino), ("vision_backbone.fused_featurizer.", "s-", sig)):
        rec.hook(model, pre + "patch_embed.proj", "out", tid + "patch-grid", fn=grid)
        rec.hook(model, pre + "patch_embed", "out", tid + "patches")
        rec.hook(model, pre + "blocks.0", "in", tid + "x0")
        rec.hook(model, pre + "blocks.0.norm1", "out", tid + "h-ln1")
        rec.hook(model, pre + "blocks.0.attn.qkv", "out", tid + "qkv")
        rec.hook(model, pre + "blocks.0.attn.proj", "in", tid + "z")
        rec.hook(model, pre + "blocks.0.attn.proj", "out", tid + "o")
        rec.hook(model, pre + "blocks.0.norm2", "in", tid + "r1")
        rec.hook(model, pre + "blocks.0.mlp.fc1", "out", tid + "u")
        rec.hook(model, pre + "blocks.0.mlp.fc2", "out", tid + "f")
        rec.hook(model, pre + f"blocks.{len(tw.blocks) - 1}", "out", tid + "x-last")
        rec.hook(model, pre.rstrip("."), "out", tid + "feats")
    rec.hook(model, "vision_backbone.featurizer.blocks.0.ls1", "out", "d-o-ls")
    rec.hook(model, "vision_backbone.featurizer.blocks.0.ls2", "out", "d-f-ls")
    rec.hook(model, "vision_backbone.featurizer.blocks.22", "out", "d-x-out")
    rec.hook(model, "projector", "in", "vis-feats")
    rec.hook(model, "projector.fc1", "out", "proj-h1")
    rec.hook(model, "projector.fc2", "out", "proj-h2")
    rec.hook(model, "projector.fc3", "out", "vis-tokens")
    lay = "language_model.model.layers.0."
    rec.hook(model, "language_model.model.layers.0", "in", "prompt")
    rec.hook(model, lay + "input_layernorm", "out", "h-norm1")
    for t, mod in (("q", "q_proj"), ("k", "k_proj"), ("v", "v_proj")):
        rec.hook(model, lay + "self_attn." + mod, "out", t)
    rec.hook(model, lay + "self_attn.o_proj", "in", "z")
    rec.hook(model, lay + "mlp.gate_proj", "out", "gate")
    rec.hook(model, lay + "mlp.down_proj", "in", "prod")
    rec.hook(model, f"language_model.model.layers.{OVLA['L'] - 1}", "out", "x-out")
    rec.hook(model, "language_model.model.norm", "out", "x-norm")
    rec.hook(model, "language_model.lm_head", "out", "logits")
    ids = torch.zeros(1, T, dtype=torch.long, device="meta")
    px = torch.zeros(1, 6, OVLA["H"], OVLA["H"], device="meta")
    fcm = count_ctx()
    with fcm, torch.no_grad():
        out = model(ids, px, output_attentions=True)
    rec.remove()
    prefill_flops = int(fcm.get_total_flops())
    bm, by_op = by_module(fcm)
    cache = out.past_key_values
    shapes = dict(rec.raw)
    shapes["attn"] = list(out.attentions[0].shape[1:])
    shapes["k-rope"] = list(cache.layers[0].keys.shape[1:])
    kv_elems = sum(int(l.keys.numel() + l.values.numel()) for l in cache.layers)
    # 6 pasos de decode (generate con max_new_tokens = 7: el 1.er token sale del prefill)
    dec = []
    for k in range(1, OVLA["da"]):
        ctx = S + k
        f2 = count_ctx()
        with f2, torch.no_grad():
            lm(input_ids=torch.zeros(1, 1, dtype=torch.long, device="meta"), past_key_values=cache, attention_mask=torch.zeros(1, 1, 1, ctx, device="meta"),
                   position_ids=torch.tensor([[ctx - 1]], device="meta"), use_cache=True)
        dec.append({"ctx": ctx, "flops": int(f2.get_total_flops())})
    decode_flops = sum(d["flops"] for d in dec)
    shapes["pixels"] = [OVLA["H"], OVLA["H"], 3]
    shapes["text-ids"] = [T]
    shapes["action-tokens"] = [OVLA["da"]]
    shapes["action"] = [OVLA["da"]]
    root = "OpenVLARef."
    pb = {
        "dinov2": n_params(dino), "siglip": n_params(sig), "projector": n_params(model.projector),
        "embed": n_params(lm.model.embed_tokens), "llm": n_params(lm.model) - n_params(lm.model.embed_tokens), "lm-head": n_params(lm.lm_head),
        "last-layer": n_params(dino.blocks[-1]) + n_params(sig.blocks[-1]),
    }
    pbp = {
        "dinov2>enc-layer": int(sum(n_params(b) for b in dino.blocks[:-1])), "dinov2>last-layer": n_params(dino.blocks[-1]),
        "dinov2>norm": n_params(dino.norm), "dinov2>patch-embed": n_params(dino.patch_embed),
        "dinov2>prefix-tokens": int(dino.cls_token.numel() + dino.reg_token.numel()), "dinov2>pos-embed": int(dino.pos_embed.numel()),
        "siglip>enc-layer": int(sum(n_params(b) for b in sig.blocks[:-1])), "siglip>last-layer": n_params(sig.blocks[-1]),
        "siglip>head": n_params(sig.norm) + n_params(sig.attn_pool), "siglip>pos-embed": int(sig.pos_embed.numel()),
        "projector>fc1": n_params(model.projector.fc1), "projector>fc2": n_params(model.projector.fc2), "projector>fc3": n_params(model.projector.fc3),
        "llm>block": int(sum(n_params(l) for l in lm.model.layers)),
    }
    params_total = n_params(model)
    assert params_total == CKPT_PARAMS, (params_total, CKPT_PARAMS)
    fbn = {
        "dinov2": bm.get(root + "vision_backbone.featurizer", 0), "siglip": bm.get(root + "vision_backbone.fused_featurizer", 0),
        "last-layer": bm.get(root + f"vision_backbone.featurizer.blocks.{len(dino.blocks) - 1}", 0) + bm.get(root + f"vision_backbone.fused_featurizer.blocks.{len(sig.blocks) - 1}", 0),
        "projector": bm.get(root + "projector", 0), "llm": bm.get(root + "language_model.model", 0), "lm-head": bm.get(root + "language_model.lm_head", 0),
        "action-tokens": decode_flops,
    }
    assert set(by_op) <= {"aten.convolution", "aten.addmm", "aten.mm", "aten.bmm"}, by_op
    oc = []
    for T2, res2, da2 in ((8, 224, 7), (64, 224, 7), (22, 448, 7), (22, 224, 4)):
        m2 = model
        if res2 != 224:
            with torch.device("meta"):
                m2 = OpenVLARef(res2)       # timm img_size = res: tablas de posición de (res/14)² filas
            m2.eval()
        Np2 = (res2 // OVLA["P"]) ** 2
        with torch.no_grad():
            f3 = count_ctx()
            with f3:
                o3 = m2(torch.zeros(1, T2, dtype=torch.long, device="meta"), torch.zeros(1, 6, res2, res2, device="meta"))
            pre2 = int(f3.get_total_flops())
            c3, S2, d2 = o3.past_key_values, Np2 + T2, 0
            for k in range(1, da2):
                f4 = count_ctx()
                with f4:
                    m2.language_model(input_ids=torch.zeros(1, 1, dtype=torch.long, device="meta"), past_key_values=c3, attention_mask=torch.zeros(1, 1, 1, S2 + k, device="meta"),
                       position_ids=torch.tensor([[S2 + k - 1]], device="meta"), use_cache=True)
                d2 += int(f4.get_total_flops())
        ov = {k: v for k, v, d in (("T", T2, 22), ("res", res2, 224), ("da", da2, 7)) if v != d}
        oc.append({"calc_overrides": ov, "params_total": n_params(m2), "flops_total": pre2 + d2,
                   "shapes": {"prompt": [S2, OVLA["D"]], "logits": [S2, OVLA["V"]], "d-x0": [Np2 + 5, 1024], "vis-feats": [Np2, 2176]}})
    notes = [
        "Sin trust_remote_code (el modeling_prismatic.py del checkpoint exige timm 0.9.x y transformers 4.40.1): mismas piezas reconstruidas — timm.create_model de los dos timm_model_ids con pretrained=False, num_classes=0, img_size=224; PrismaticProjector fused copiado; LlamaForCausalLM con vocab 32,064. sum(p.numel()) = 7,541,237,184 = total_size/2 de model.safetensors.index.json (bf16): la reconstrucción tiene exactamente los parámetros del checkpoint.",
        "Visión: get_intermediate_layers(n = {L − 2}) de timm 0.9.16 corre los L bloques y devuelve la salida del bloque L − 2 (el penúltimo) sin los tokens prefijo y sin la norma final; la última capa de cada torre se CALCULA y se descarta (flops_by_node['last-layer']). timm 1.0 podría parar antes (stop_early); el forward de aquí copia el de 0.9.16, el que usa el checkpoint.",
        "DINOv2-reg4: 1 CLS + 4 registros (sin posición: no_embed_class) → 261 tokens dentro de la torre, 256 a la salida. SigLIP sin CLS: 256. Fusión por canal: 256 × (1024 + 1152) = 256 × 2176.",
        "Parámetros sin uso en el forward (existen en el checkpoint): LayerNorm final de DINOv2 (2,048) y de SigLIP (2,304) y el attention pooling MAP de SigLIP (15,238,352; timm lo crea con global_pool = 'map' aunque num_classes = 0). El calculador los pone como idle_params.",
        "Proyector fused-gelu-mlp = TRES lineales (2176 → 8704 → 4096 → 4096, GELU tras las dos primeras). El paper (§3.1) habla de un 'MLP de 2 capas'; el checkpoint tiene fc1, fc2, fc3.",
        f"Prompt: T = {T} tokens ('In: What action should the robot take to put the eggplant in the pot?\\nOut:' con el tokenizer del checkpoint = 21 con <BOS>, + el 29871 que agrega predict_action); los 256 tokens visuales van después de <BOS> → {S} filas en el LLM; logits sobre todas (el forward de HF sin logits_to_keep).",
        "Acción = 7 tokens: el prefill da el 1.º; generate hace 6 pasos de decode más (ctx = N + T + 1 … N + T + 6) con la DynamicCache. flops_total = prefill + los 6 pasos (= totals.flops del calculador, que incluye la op ar-decode).",
        "Parches para meta (no cambian FLOPs): máscara 4-D de ceros y position_ids dados; atención eager en Llama y attn.fused_attn = False en timm (q @ kᵀ y A @ v como bmm).",
        "override_checks: T = 8 y 64; res = 448 (timm img_size = 448: las tablas de posición de las dos torres tienen 1,024 filas, interpoladas en un checkpoint real; +768·2176 parámetros) y d_a = 4 (1 prefill + 3 decodes). El knob images (varias vistas) no tiene referencia: Prismatic acepta una imagen; el calculador repite las torres con los mismos pesos.",
        "Tokens de acción: ids 32,000 − b con b = np.digitize(a, linspace(−1, 1, 256)) ∈ [1, 256] → 31,744 … 31,999 (los 256 últimos del tokenizer de Llama). Detokenizar usa 255 centros (los bins 255 y 256 dan el mismo).",
    ]
    data = {
        "config_id": "openvla-7b", "model": "openvla", "T": T,
        "params_total": params_total, "params_checkpoint": CKPT_PARAMS, "params_by_node": pb, "params_by_path": pbp,
        "shapes": shapes, "flops_total": prefill_flops + decode_flops, "flops_prefill": prefill_flops, "flops_decode_steps": dec,
        "flops_by_node": fbn, "flops_by_op_torch": by_op,
        "override_checks": oc,
        "metrics_checks": {"kvBytesPerToken": kv_elems * 2 // S, "visualTokens": Np, "promptTokens": S, "totalParams": params_total, "projectorParams": pb["projector"],
                           "dinoParams": pb["dinov2"], "siglipParams": pb["siglip"], "prefillMacs": prefill_flops // 2, "decodeMacsTotal": decode_flops // 2,
                           "decodeMacsPerToken": dec[0]["flops"] // 2, "macsPerAction": (prefill_flops + decode_flops) // 2, "decodeSteps": len(dec),
                           "idleParams": pbp["dinov2>norm"] + pbp["siglip>head"]},
        "not_hooked": {"d-pixels / s-pixels": "la normalización la hace el procesador (dos estadísticas): pixel_values ya trae 6 canales",
                       "text-emb": "embedding de las T ids (búsqueda)", "next-token": "argmax de la última fila (generate)"},
        "hf_config_source": "openvla/openvla-7b (rev. 47a0ec7): config.json, modeling_prismatic.py, model.safetensors.index.json",
        "source": {"lib": "timm + transformers", "version": f"timm {timm.__version__}, transformers {transformers.__version__}",
                   "ctor": "with torch.device('meta'): OpenVLARef() = timm.create_model('vit_large_patch14_reg4_dinov2.lvd142m' | 'vit_so400m_patch14_siglip_224', pretrained=False, num_classes=0, img_size=224) + PrismaticProjector(2176, 4096) + LlamaForCausalLM(LlamaConfig(vocab_size=32064, hidden_size=4096, intermediate_size=11008, num_hidden_layers=32, num_attention_heads=32, num_key_value_heads=32, tie_word_embeddings=False))",
                   "attn_implementation": "eager", "versions": versions()},
        "notes": notes,
    }
    write_expected("openvla-7b", data)


# ---------------------------------------------------------------- π0
def posemb_sincos(pos, dim, min_period, max_period):
    """pi0_pytorch.create_sinusoidal_pos_embedding / pi0.posemb_sincos: [sin, cos] de τ·2π/período."""
    fraction = torch.linspace(0.0, 1.0, dim // 2, device=pos.device)
    period = min_period * (max_period / min_period) ** fraction
    x = pos[:, None] * (1.0 / period * 2 * math.pi)[None, :]
    return torch.cat([torch.sin(x), torch.cos(x)], dim=1)


class Pi0Ref(nn.Module):
    def __init__(self):
        super().__init__()
        vc = dict(hidden_size=1152, intermediate_size=4304, num_hidden_layers=27, num_attention_heads=16, image_size=224, patch_size=14,
                  projection_dim=2048, hidden_act="gelu_pytorch_tanh", vision_use_head=False, layer_norm_eps=1e-6)
        tc = dict(vocab_size=257152, hidden_size=2048, intermediate_size=16384, num_hidden_layers=18, num_attention_heads=8, num_key_value_heads=1,
                  head_dim=256, hidden_activation="gelu_pytorch_tanh", rms_norm_eps=1e-6, tie_word_embeddings=True)
        cfg = PaliGemmaConfig(vision_config=vc, text_config=tc, image_token_index=257152, projection_dim=2048, tie_word_embeddings=True)
        ec = GemmaConfig(vocab_size=257152, hidden_size=1024, intermediate_size=4096, num_hidden_layers=18, num_attention_heads=8, num_key_value_heads=1,
                         head_dim=256, hidden_activation="gelu_pytorch_tanh", rms_norm_eps=1e-6)
        for c in (cfg, cfg.text_config, cfg.vision_config, ec):
            c._attn_implementation = "eager"
        self.paligemma = PaliGemmaForConditionalGeneration(cfg)
        self.gemma_expert = GemmaModel(ec)
        self.gemma_expert.embed_tokens = None      # gemma_pytorch.py: el experto no tiene embedder
        aw, ad = 1024, 32
        self.state_proj = nn.Linear(ad, aw)
        self.action_in_proj = nn.Linear(ad, aw)
        self.action_time_mlp_in = nn.Linear(2 * aw, aw)
        self.action_time_mlp_out = nn.Linear(aw, aw)
        self.action_out_proj = nn.Linear(aw, ad)

    def forward(self, what, *args, **kw):   # 'prefix' | 'step': claves de FlopCounterMode 'Pi0Ref.<submódulo>'
        return getattr(self, "_" + what)(*args, **kw)

    def _prefix(self, cams, T, S, record):
        pg = self.paligemma
        lm = pg.model.language_model
        img = pg.model.get_image_features(pixel_values=torch.zeros(cams, 3, 224, 224, device="meta"))
        img = img.pooler_output if hasattr(img, "pooler_output") else img
        img = img.reshape(1, cams * img.shape[1], img.shape[-1])
        lang = lm.embed_tokens(torch.zeros(1, T, dtype=torch.long, device="meta")) * math.sqrt(2048)
        prefix = torch.cat([img, lang], dim=1)
        return lm(inputs_embeds=prefix, attention_mask=torch.zeros(1, 1, S, S, device="meta"), position_ids=torch.arange(S, device="meta")[None],
                  use_cache=True, output_attentions=record)

    def _step(self, state, x_t, tau, cache, S, H, record):
        L = 1 + H
        suf = self.embed_suffix(state, x_t, tau)
        eo = self.gemma_expert(inputs_embeds=suf, past_key_values=cache, attention_mask=torch.zeros(1, 1, L, S + L, device="meta"),
                               position_ids=(S + torch.arange(L, device="meta"))[None], use_cache=True, output_attentions=record)
        return eo, self.action_out_proj(eo.last_hidden_state[:, -H:])

    def embed_suffix(self, state, x_t, tau):
        st = self.state_proj(state)[:, None, :]
        a = self.action_in_proj(x_t)
        te = posemb_sincos(tau, a.shape[-1], 4e-3, 4.0)
        te = te[:, None, :].expand_as(a)
        h = self.action_time_mlp_out(nn.functional.silu(self.action_time_mlp_in(torch.cat([a, te], dim=2))))
        return torch.cat([st, h], dim=1)


def pi0_cfg_ctor():
    return ("with torch.device('meta'): Pi0Ref() = PaliGemmaForConditionalGeneration(PaliGemmaConfig(vision_config=dict(hidden_size=1152, intermediate_size=4304, "
            "num_hidden_layers=27, num_attention_heads=16, image_size=224, patch_size=14, projection_dim=2048, hidden_act='gelu_pytorch_tanh', vision_use_head=False), "
            "text_config=dict(vocab_size=257152, hidden_size=2048, intermediate_size=16384, num_hidden_layers=18, num_attention_heads=8, num_key_value_heads=1, "
            "head_dim=256, hidden_activation='gelu_pytorch_tanh', tie_word_embeddings=True), image_token_index=257152, projection_dim=2048)) + "
            "GemmaModel(GemmaConfig(hidden_size=1024, intermediate_size=4096, num_hidden_layers=18, num_attention_heads=8, num_key_value_heads=1, head_dim=256)) "
            "con embed_tokens = None + nn.Linear ×5 de pi0.py (state_proj 32→1024, action_in_proj 32→1024, action_time_mlp_in 2048→1024, action_time_mlp_out 1024→1024, action_out_proj 1024→32)")


def pi0_forward(model, cams, T, H, steps, record=False):
    pg, ex = model.paligemma, model.gemma_expert
    lm = pg.model.language_model
    rec = Rec()
    root = "Pi0Ref."
    if record:
        v = "paligemma.model.vision_tower."
        per_cam = lambda s: s[1:]  # noqa: E731  (lote = cámaras: formas POR cámara)
        rec.hook(model, v + "embeddings.patch_embedding", "out", "s-patch-grid", fn=lambda s: [s[2], s[3], s[1]])
        rec.hook(model, v + "embeddings", "out", "s-x0", fn=per_cam)
        rec.hook(model, v + "encoder.layers.0.layer_norm1", "out", "s-h-ln1", fn=per_cam)
        rec.hook(model, v + "encoder.layers.0.self_attn.out_proj", "in", "s-z", fn=per_cam)
        rec.hook(model, v + "encoder.layers.0.mlp.fc1", "out", "s-u", fn=per_cam)
        rec.hook(model, v + "encoder.layers.0.mlp.fc2", "out", "s-f", fn=per_cam)
        rec.hook(model, v + "encoder.layers.26", "out", "s-x-out", fn=per_cam)
        rec.hook(model, v + "post_layernorm", "out", "s-feats", fn=per_cam)
        rec.hook(model, "paligemma.model.multi_modal_projector", "out", "img-tokens", fn=per_cam)
        lay = "paligemma.model.language_model.layers.0."
        rec.hook(model, "paligemma.model.language_model.layers.0", "in", "prefix")
        rec.hook(model, lay + "input_layernorm", "out", "h-norm1")
        for t, mod in (("q", "q_proj"), ("k", "k_proj"), ("v", "v_proj")):
            rec.hook(model, lay + "self_attn." + mod, "out", t)
        rec.hook(model, lay + "self_attn.o_proj", "in", "z")
        rec.hook(model, lay + "mlp.gate_proj", "out", "gate")
        rec.hook(model, lay + "mlp.down_proj", "in", "prod")
        rec.hook(model, "paligemma.model.language_model.layers.17", "out", "x-out")
        rec.hook(model, "paligemma.model.language_model.norm", "out", "x-norm")
        e = "gemma_expert.layers.0."
        rec.hook(model, "gemma_expert.layers.0", "in", "suffix")
        rec.hook(model, e + "input_layernorm", "out", "a-h-norm1")
        for t, mod in (("a-q", "q_proj"), ("a-k", "k_proj"), ("a-v", "v_proj")):
            rec.hook(model, e + "self_attn." + mod, "out", t)
        rec.hook(model, e + "self_attn.o_proj", "in", "a-z")
        rec.hook(model, e + "self_attn.o_proj", "out", "a-o")
        rec.hook(model, e + "mlp.gate_proj", "out", "a-gate")
        rec.hook(model, e + "mlp.down_proj", "in", "a-prod")
        rec.hook(model, e + "mlp.down_proj", "out", "a-f")
        rec.hook(model, "gemma_expert.norm", "out", "a-x-norm")
        rec.hook(model, "action_in_proj", "out", "act-emb")
        rec.hook(model, "action_time_mlp_in", "in", "at-cat")
        rec.hook(model, "action_time_mlp_out", "out", "act-tokens")
        rec.hook(model, "state_proj", "out", "state-tok", fn=lambda s: [1, s[-1]])
        rec.hook(model, "action_out_proj", "in", "a-act-out")
        rec.hook(model, "action_out_proj", "out", "velocity")
    S = cams * 256 + T
    out = {}
    fcm = count_ctx()
    with fcm, torch.no_grad():
        po = model("prefix", cams, T, S, record)
    pre_flops = int(fcm.get_total_flops())
    pre_bm, pre_op = by_module(fcm)
    cache = po.past_key_values
    if record:
        out["attn"] = list(po.attentions[0].shape[1:])
        out["k-rope"] = list(cache.layers[0].keys.shape[1:])
        out["v-heads"] = list(cache.layers[0].values.shape[1:])
    kv_elems = sum(int(l.keys.numel() + l.values.numel()) for l in cache.layers)
    state = torch.zeros(1, 32, device="meta")
    x_t = torch.zeros(1, H, 32, device="meta")
    L = 1 + H
    dt = -1.0 / steps
    f2 = count_ctx()
    with f2, torch.no_grad():
        for i in range(steps):
            tau = torch.full((1,), 1.0 + i * dt, device="meta")
            eo, v_t = model("step", state, x_t, tau, cache, S, H, record and i == 0)
            if record and i == 0:
                out["a-attn"] = list(eo.attentions[0].shape[1:])
                out["a-k-all"] = list(cache.layers[0].keys.shape[1:])
            cache.crop(-L)                     # el sufijo no se guarda: cada paso lee solo la KV del prefijo
            x_t = x_t + dt * v_t
    flow_flops = int(f2.get_total_flops())
    flow_bm, flow_op = by_module(f2)
    rec.remove()
    shapes = dict(rec.raw)
    shapes.update(out)
    return dict(pre_flops=pre_flops, pre_bm=pre_bm, pre_op=pre_op, flow_flops=flow_flops, flow_bm=flow_bm, flow_op=flow_op, shapes=shapes, kv_elems=kv_elems, S=S, root=root)


def run_pi0(config_id):
    cams = PI0[config_id]["cams"]
    T, H, steps = PI0_BASE["T"], PI0_BASE["H"], PI0_BASE["steps"]
    with torch.device("meta"):
        model = Pi0Ref()
    model.eval()
    pg, ex = model.paligemma, model.gemma_expert
    lm = pg.model.language_model
    r = pi0_forward(model, cams, T, H, steps, record=True)
    S, root = r["S"], r["root"]
    params_total = n_params(model)
    vt, mp = pg.model.vision_tower, pg.model.multi_modal_projector
    pb = {
        "siglip": n_params(vt) + n_params(mp), "language": n_params(lm.embed_tokens), "gemma": n_params(lm) - n_params(lm.embed_tokens),
        "action-expert": n_params(ex), "state": n_params(model.state_proj), "noisy-actions": n_params(model.action_in_proj),
        "t-embed": n_params(model.action_time_mlp_in) + n_params(model.action_time_mlp_out), "velocity": n_params(model.action_out_proj),
    }
    pbp = {"siglip>img-proj": n_params(mp), "siglip>enc-layer": n_params(vt.encoder), "siglip>ln-post": n_params(vt.post_layernorm),
           "gemma>block": int(sum(n_params(l) for l in lm.layers)), "gemma>final-norm": n_params(lm.norm),
           "action-expert>block": int(sum(n_params(l) for l in ex.layers)), "action-expert>final-norm": n_params(ex.norm)}
    pre_bm, flow_bm = r["pre_bm"], r["flow_bm"]
    P = "Pi0Ref."
    fbn = {
        "siglip": pre_bm.get(P + "paligemma.model.vision_tower", 0) + pre_bm.get(P + "paligemma.model.multi_modal_projector", 0),
        "gemma": pre_bm.get(P + "paligemma.model.language_model", 0),
        "action-expert": flow_bm.get(P + "gemma_expert", 0),
        "state": flow_bm.get(P + "state_proj", 0), "noisy-actions": flow_bm.get(P + "action_in_proj", 0),
        "t-embed": flow_bm.get(P + "action_time_mlp_in", 0) + flow_bm.get(P + "action_time_mlp_out", 0), "velocity": flow_bm.get(P + "action_out_proj", 0),
    }
    by_op = {}
    for d in (r["pre_op"], r["flow_op"]):
        for k, v in d.items():
            by_op[k] = by_op.get(k, 0) + v
    assert set(by_op) <= {"aten.convolution", "aten.addmm", "aten.mm", "aten.bmm"}, by_op
    shapes = r["shapes"]
    shapes["pixels"] = [224, 224, 3]
    shapes["lang-ids"] = [T]
    shapes["x-t"] = [H, 32]
    shapes["action-chunk"] = [H, 32]
    oc = []
    if config_id == "pi0":
        for ov in ({"steps": 5}, {"H": 25}, {"T": 16}, {"cams": 2}):
            r2 = pi0_forward(model, ov.get("cams", cams), ov.get("T", T), ov.get("H", H), ov.get("steps", steps))
            oc.append({"calc_overrides": ov, "params_total": params_total, "flops_total": r2["pre_flops"] + r2["flow_flops"]})
    flops_total = r["pre_flops"] + r["flow_flops"]
    notes = [
        "Reimplementación fiel de openpi (main @ 215abfb) siguiendo su port oficial de PyTorch (models_pytorch/gemma_pytorch.py: PaliGemmaForConditionalGeneration + GemmaForCausalLM del experto con embed_tokens = None; pi0_pytorch.py: embed_prefix, embed_suffix, sample_actions, denoise_step). Aquí el experto es GemmaModel (sin LM head: el JAX original no tiene embedder ni cabeza para el experto; el port deja una lm_head atada que no se usa).",
        "Parámetros = PaliGemma 3B (SigLIP So400m/14 con head 1152 → 2048 = multi_modal_projector, Gemma 2B con vocab 257,152 = PALIGEMMA_VOCAB_SIZE y embedding atado) + experto gemma_300m (311,463,936 en las capas, el '311M' de gemma.py, + 1,024 de su norma final) + las 5 lineales de pi0.py. El paper dice ≈ 3.3B y ≈ 300M para el experto.",
        f"FLOPs = FlopCounterMode, atención eager. Prefijo UNA vez: {cams} cámara(s) × 256 tokens + T = {T} (max_token_len de Pi0Config, relleno incluido) = {S} filas por Gemma 2B (bidireccional: máscara 4-D de ceros; el conteo no depende de la máscara). Luego {steps} pasos: sufijo de 1 + {H} tokens por el experto, que lee la KV cache del prefijo (DynamicCache recortada al prefijo tras cada paso: openpi llama al experto con use_cache = False).",
        "Gemma no corre su LM head (π0 no decodifica texto); la RMSNorm final del prefijo sí corre (su salida no se usa). El experto no corre en el prefijo ni Gemma en el sufijo (sample_actions: [prefix_tokens, None] y luego [None, suffix_tokens]).",
        "Atención conjunta: Q del sufijo (8 cabezas × 256 = 2,048 desde D_a = 1,024) contra K/V de prefijo + sufijo (1 cabeza KV: MQA) → scores 8 × 51 × (N + T + 51). La máscara por bloques (estado → prefijo + estado; acciones → todo) no cambia el conteo.",
        "Parches para meta (no cambian FLOPs): máscaras 4-D de ceros y position_ids dados; τ sobre meta (el valor no importa).",
        "Latencia del paper (Tabla I, RTX 4090, 3 cámaras): encoders de imagen 14 ms, forward del prefijo 32 ms, 10 pasos de flow 27 ms → 73 ms a bordo (86 ms con 13 ms de red). El calculador da cotas de roofline (≈), menores.",
    ]
    data = {
        "config_id": config_id, "model": "pi0", "cams": cams, "T": T, "H": H, "steps": steps,
        "params_total": params_total, "params_paligemma_hf": n_params(pg), "params_by_node": pb, "params_by_path": pbp,
        "shapes": shapes, "flops_total": flops_total, "flops_prefix": r["pre_flops"], "flops_flow": r["flow_flops"],
        "flops_by_node": fbn, "flops_by_op_torch": dict(sorted(by_op.items())),
        "override_checks": oc,
        "metrics_checks": {"totalParams": params_total, "paligemmaParams": n_params(pg), "expertParams": n_params(ex), "kvBytesPerToken": r["kv_elems"] * 2 // S,
                           "prefixTokens": S, "suffixTokens": 1 + H, "kvRows": S + 1 + H, "prefixMacs": r["pre_flops"] // 2, "flowStepMacs": r["flow_flops"] // (2 * steps),
                           "flowMacs": r["flow_flops"] // 2, "macsPerChunk": flops_total // 2},
        "not_hooked": {"s-patches": "HF suma la posición dentro de embeddings (s-x0)", "t-emb / t-tokens": "posemb_sincos (sin módulo)",
                       "a-k-all": "la KV que lee el experto = caché del prefijo + el sufijo (forma tomada de la DynamicCache tras el 1.er paso)"},
        "hf_config_source": "Physical-Intelligence/openpi main @ 215abfb: src/openpi/models/{pi0.py, pi0_config.py, gemma.py, siglip.py}, src/openpi/models_pytorch/{pi0_pytorch.py, gemma_pytorch.py}",
        "source": {"lib": "transformers", "version": transformers.__version__, "ctor": pi0_cfg_ctor(), "attn_implementation": "eager", "versions": versions()},
        "notes": notes,
    }
    write_expected(config_id, data)


if __name__ == "__main__":
    print("▸ openvla-7b", flush=True)
    run_openvla()
    for cid in PI0:
        print(f"▸ {cid}", flush=True)
        run_pi0(cid)
