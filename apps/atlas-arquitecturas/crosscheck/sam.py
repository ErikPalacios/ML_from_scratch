"""Cross-check de SAM y SAM 2 (SPEC §9.3, §17): HF transformers construido en código, sin hub ni pesos.

Uso: .venv/bin/python crosscheck/sam.py [configId ...]

SAM (`sam-vit-h-1024`, `sam-vit-l-1024`, `sam-vit-b-1024`): `SamModel._from_config(SamConfig(vision_config=...))` con los
hiperparámetros de build_sam.py oficial, atención eager. Forward de referencia: imagen 1024×1024 en ceros, 1 clic positivo
(sin caja: el prompt encoder añade el punto de relleno → 2 tokens dispersos), sin máscara de entrada, multimask_output=True.
- Parámetros: HF registra la matriz gaussiana 2×128 de la PE de Fourier como nn.Parameter (compartida entre
  shared_image_embedding y prompt_encoder); el oficial la registra como buffer. params_total = HF − 256.
- FLOPs (FlopCounterMode, 2 por MAC de matmul/conv/einsum): exactos, incluidas las dos einsum de la posición relativa
  descompuesta y el producto por la matriz gaussiana (puntos y rejilla densa).
- override_checks en ViT-B: P = 3 clics, una sola máscara (masks = 1) y con máscara de entrada (maskIn = 1).

SAM 2 (`sam2-hiera-l`, `-bplus`, `-s`, `-t`): `Sam2VideoModel._from_config(Sam2VideoConfig(vision_config=...))` con los
hiperparámetros de configs/sam2.1/*.yaml oficiales, atención eager. Forward de referencia = UN frame de seguimiento en
régimen estacionario: sesión de 21 frames (ceros); el frame 0 tiene prompt (cond) y los 1…19 ya están seguidos; se
procesa el frame 20 sin clics. Memoria leída: 1 frame con prompt + 6 recientes (num_maskmem = 7) = 7 memorias de
64×64×64 y 16 punteros de objeto (1 del frame con prompt + 15 anteriores; max_obj_ptrs_in_encoder = 16) → 7·4096 + 16·4 =
28,736 tokens. Fases medidas: (A) codificador de imagen + FPN + conv_s0/conv_s1 (get_image_features), (B)
_run_single_frame_inference (memory attention, prompt encoder, decoder, cabeza de oclusión, puntero de objeto) y (C)
_encode_new_memory (memory encoder).
- HF Sam2MultiScaleAttention (Hiera) calcula además un producto (query·scale) @ keyᵀ cuyo resultado descarta (vestigio:
  batch sobre los tokens, nH×d·d×nH); el oficial no lo tiene. Se mide con pre-hooks (2·B'·hw·nH·dim_out FLOPs por llamada) y
  se resta; en sam2-hiera-t se verifica además con un forward parcheado sin ese producto.
- override_checks en Hiera-T: memFrames = 3 y ptrs = 8 (num_maskmem = 4, max_obj_ptrs_in_encoder = 8; otro modelo).
"""
import math
import sys

import torch
from torch.utils.flop_counter import FlopCounterMode
from transformers import SamConfig, SamModel, Sam2VideoConfig, Sam2VideoModel
from transformers.models.sam2_video.modeling_sam2_video import Sam2VideoInferenceSession

from common import CUSTOM, n_params, versions, write_expected

# configId → hiperparámetros. Deben coincidir con js/arch/sam.js.
SAM = {
    "sam-vit-h-1024": dict(hidden_size=1280, num_hidden_layers=32, num_attention_heads=16, global_attn_indexes=[7, 15, 23, 31]),
    "sam-vit-l-1024": dict(hidden_size=1024, num_hidden_layers=24, num_attention_heads=16, global_attn_indexes=[5, 11, 17, 23]),
    "sam-vit-b-1024": dict(hidden_size=768, num_hidden_layers=12, num_attention_heads=12, global_attn_indexes=[2, 5, 8, 11]),
}


def hiera(D, h, depths, globals_, windows, bkg):
    return dict(hidden_size=D, num_attention_heads=h, blocks_per_stage=depths, global_attention_blocks=globals_, window_size_per_stage=windows,
                window_positional_embedding_background_size=[bkg, bkg], embed_dim_per_stage=[D * 2 ** i for i in range(4)],
                num_attention_heads_per_stage=[h * 2 ** i for i in range(4)])


SAM2 = {
    "sam2-hiera-l": hiera(144, 2, [2, 6, 36, 4], [23, 33, 43], [8, 4, 16, 8], 7),
    "sam2-hiera-bplus": hiera(112, 2, [2, 3, 16, 3], [12, 16, 20], [8, 4, 14, 7], 14),
    "sam2-hiera-s": hiera(96, 1, [1, 2, 11, 2], [7, 10, 13], [8, 4, 14, 7], 7),
    "sam2-hiera-t": hiera(96, 1, [1, 2, 7, 2], [5, 7, 9], [8, 4, 14, 7], 7),
}
RES = 1024


class Recorder:
    """Forma de salida ('out', con índice opcional), de la primera entrada ('in') o de un kwarg (('kw', nombre))."""

    def __init__(self, model, spec):
        self.spec, self.raw, self.handles = spec, {}, []
        mods = dict(model.named_modules())
        for tid, (mod, where, fn) in spec.items():
            m = mods[mod]
            if isinstance(where, tuple) and where[0] == "out":
                def hook(_m, inp, out, tid=tid, i=where[1]):
                    self.raw.setdefault(tid, list(out[i].shape))
                self.handles.append(m.register_forward_hook(hook))
            elif where == "out":
                def hook(_m, inp, out, tid=tid):
                    t = out[0] if isinstance(out, (tuple, list)) else out
                    self.raw.setdefault(tid, list(t.shape))
                self.handles.append(m.register_forward_hook(hook))
            else:
                def pre(_m, args, kwargs, tid=tid, where=where):
                    if where == "in":
                        t = args[0] if args else next(iter(kwargs.values()))
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
        return {tid: self.spec[tid][2](self.raw[tid]) for tid in self.spec if tid in self.raw}

    def torch_info(self):
        return {tid: {"module": self.spec[tid][0], "hook": str(self.spec[tid][1]), "torch_shape": self.raw[tid]} for tid in self.spec if tid in self.raw}


def b1(s):           # [1, …] → […]
    assert s[0] == 1, s
    return s[1:]


def b11(s):          # [1, 1, …] → […]
    assert s[0] == 1 and s[1] == 1, s
    return s[2:]


def nchw(s):         # [1, C, H, W] → [H, W, C]
    assert s[0] == 1, s
    return [s[2], s[3], s[1]]


def win(s):          # [nW, M, M, C] → [nW, M², C]
    return [s[0], s[1] * s[2], s[3]]


def heads(nh):       # [nW·h, N, N] → [nW, h, N, N] (o [h, N, N] si nW = 1)
    def f(s):
        nw = s[0] // nh
        return ([nw] if nw > 1 else []) + [nh, s[1], s[2]]
    return f


def seq_b(s):        # [N, 1, C], [1, 1, N, C]… → [N, C] (sin las dimensiones de batch, todas 1)
    out = [x for x in s if x != 1]
    assert len(out) == 2, s
    return out


def by_module(counts, name):
    return int(sum(counts.get(name, {}).values()))


def fcm_run(fn):
    f = FlopCounterMode(display=False, custom_mapping=CUSTOM)
    with f, torch.no_grad():
        out = fn()
    return out, f


# ================================================================== SAM
def sam_build(cid, res=RES):
    vc = dict(SAM[cid], image_size=res)
    cfg = SamConfig(vision_config=vc, prompt_encoder_config=dict(image_size=res))
    model = SamModel._from_config(cfg, attn_implementation="eager").eval().requires_grad_(False)
    ctor = f"SamModel._from_config(SamConfig(vision_config={vc}, prompt_encoder_config={{'image_size': {res}}}), attn_implementation='eager')"
    return model, cfg, ctor


def sam_inputs(P, maskIn, res=RES):
    pts = torch.tensor([[[[300.0 + 37 * i, 400.0 + 21 * i] for i in range(P)]]])
    labels = torch.ones(1, 1, P, dtype=torch.int)
    kw = dict(pixel_values=torch.zeros(1, 3, res, res), input_points=pts, input_labels=labels)
    if maskIn:
        kw["input_masks"] = torch.zeros(1, 1, res // 4, res // 4)
    return kw


def sam_spec(cfg):
    vc = cfg.vision_config
    g0 = vc.global_attn_indexes[0]
    w0 = 0 if g0 != 0 else 1
    G = vc.image_size // vc.patch_size
    nw = math.ceil(G / vc.window_size) ** 2
    ve, md = "vision_encoder", "mask_decoder"
    nh = vc.num_attention_heads
    return {
        "patches": (f"{ve}.patch_embed", "out", b1),
        "w-ln1": (f"{ve}.layers.{w0}.layer_norm1", "out", b1),
        "w-win": (f"{ve}.layers.{w0}.attn", "in", win),
        "w-qkv": (f"{ve}.layers.{w0}.attn.qkv", "out", lambda s: [s[0], s[1] * s[2], s[3]]),
        "w-attn": (f"{ve}.layers.{w0}.attn", ("out", 1), heads(nh)),
        "w-o": (f"{ve}.layers.{w0}.attn.proj", "out", lambda s: [s[0], s[1] * s[2], s[3]]),
        "w-ln2": (f"{ve}.layers.{w0}.layer_norm2", "out", b1),
        "w-u": (f"{ve}.layers.{w0}.mlp.lin1", "out", b1),
        "w-out": (f"{ve}.layers.{w0}", "out", b1),
        "g-ln1": (f"{ve}.layers.{g0}.layer_norm1", "out", b1),
        "g-qkv": (f"{ve}.layers.{g0}.attn.qkv", "out", lambda s: [s[1] * s[2], s[3]]),
        "g-attn": (f"{ve}.layers.{g0}.attn", ("out", 1), heads(nh)),
        "g-u": (f"{ve}.layers.{g0}.mlp.lin1", "out", b1),
        "enc-out": (f"{ve}.layers.{vc.num_hidden_layers - 1}", "out", b1),
        "neck-c1": (f"{ve}.neck.conv1", "out", nchw),
        "img-emb": (f"{ve}.neck", "out", nchw),
        "sparse": ("prompt_encoder", ("out", 0), b11),
        "dense": ("prompt_encoder", ("out", 1), nchw),
        "tokens": (f"{md}.transformer", ("kw", "point_embeddings"), b11),
        "tw-self-attn": (f"{md}.transformer.layers.0.self_attn", ("out", 1), b1),
        "tw-t2i-attn": (f"{md}.transformer.layers.0.cross_attn_token_to_image", ("out", 1), b1),
        "tw-i2t-attn": (f"{md}.transformer.layers.0.cross_attn_image_to_token", ("out", 1), b1),
        "tw-u": (f"{md}.transformer.layers.0.mlp.lin1", "out", b11),
        "tw-keys": (f"{md}.transformer.layers.0", ("out", 1), b11),
        "fa-attn": (f"{md}.transformer.final_attn_token_to_image", ("out", 1), b1),
        "tok-out": (f"{md}.transformer", ("out", 0), b11),
        "up-c1": (f"{md}.upscale_conv1", "out", nchw),
        "up-c2": (f"{md}.upscale_conv2", "out", nchw),
        "hn-h1": (f"{md}.output_hypernetworks_mlps.0.proj_in", "out", lambda s: [4] + b11(s)),
        "iou-all": (f"{md}.iou_prediction_head", "out", b11),
        "mask-c1": ("prompt_encoder.mask_embed.conv1", "out", nchw),
    }, nw, G


def sam_flops_by_node(counts):
    r = "SamModel"
    return {
        "img-encoder": by_module(counts, f"{r}.vision_encoder"),
        "prompt-enc": by_module(counts, f"{r}.shared_image_embedding") + by_module(counts, f"{r}.prompt_encoder"),
        "mask-decoder": by_module(counts, f"{r}.mask_decoder"),
    }


def sam_run(cid):
    model, cfg, ctor = sam_build(cid)
    vc = cfg.vision_config
    total_hf = n_params(model)
    gauss = int(model.shared_image_embedding.positional_embedding.numel())
    spec, nw, G = sam_spec(cfg)
    rec = Recorder(model, spec)
    out, f = fcm_run(lambda: model(**sam_inputs(1, False), multimask_output=True))
    rec.remove()
    counts = f.get_flop_counts()
    flops = int(f.get_total_flops())
    by_node = sam_flops_by_node(counts)
    assert sum(by_node.values()) == flops, (by_node, flops)
    shapes = {"x-img": [RES, RES, 3]}
    shapes.update(rec.shapes())
    shapes.pop("mask-c1", None)
    shapes["masks"] = b11(list(out.pred_masks.shape))
    shapes["iou"] = b11(list(out.iou_scores.shape))
    shapes["img-pe"] = nchw(list(model.get_image_wide_positional_embeddings().shape))
    ve = model.vision_encoder
    layers = ve.layers
    wl = [i for i in range(vc.num_hidden_layers) if i not in vc.global_attn_indexes]
    gl = list(vc.global_attn_indexes)
    md = model.mask_decoder
    pe = model.prompt_encoder
    params_by_node = {"img-encoder": n_params(ve), "prompt-enc": n_params(pe) - gauss, "mask-decoder": n_params(md)}
    params_by_path = {
        "img-encoder>patch-embed": n_params(ve.patch_embed), "img-encoder>pos-embed": int(ve.pos_embed.numel()),
        "img-encoder>win-blocks": sum(n_params(layers[i]) for i in wl), "img-encoder>global-blocks": sum(n_params(layers[i]) for i in gl),
        "img-encoder>neck": n_params(ve.neck),
        "prompt-enc>mask-in": n_params(pe.mask_embed) + n_params(pe.no_mask_embed),
        "prompt-enc>type-embed": sum(n_params(x) for x in pe.point_embed) + n_params(pe.not_a_point_embed),
        "mask-decoder>tokens": n_params(md.iou_token) + n_params(md.mask_tokens),
        "mask-decoder>two-way": n_params(md.transformer.layers),
        "mask-decoder>final-attn": n_params(md.transformer.final_attn_token_to_image) + n_params(md.transformer.layer_norm_final_attn),
        "mask-decoder>upscale": n_params(md.upscale_conv1) + n_params(md.upscale_conv2) + n_params(md.upscale_layer_norm),
        "mask-decoder>hypernet": n_params(md.output_hypernetworks_mlps), "mask-decoder>iou-head": n_params(md.iou_prediction_head),
    }
    rel = {"window": list(layers[wl[0]].attn.rel_pos_h.shape), "global": list(layers[gl[0]].attn.rel_pos_h.shape)}
    data = {
        "config_id": cid, "model": "sam",
        "params_total": total_hf - gauss, "params_total_hf_raw": total_hf, "params_fourier_gaussian_hf": gauss,
        "params_by_module": {n: n_params(c) for n, c in model.named_children()},
        "params_by_node": params_by_node, "params_by_path": params_by_path,
        "rel_pos_tables": rel, "sam_windows": {"window_size": vc.window_size, "grid": G, "num_windows": nw, "padded_tokens": nw * vc.window_size ** 2,
                                           "global_attn_indexes": gl},
        "prompt": {"points": 1, "boxes": 0, "mask_input": False, "multimask_output": True,
                   "note": "1 clic positivo sin caja: el prompt encoder añade el punto de relleno (2 tokens dispersos)"},
        "shapes": shapes, "shapes_torch": rec.torch_info(),
        "flops_total": flops, "flops_by_node": by_node,
        "flops_by_op_torch": {str(k): int(v) for k, v in counts.get("Global", {}).items()},
        "source": {"lib": "transformers", "ctor": ctor, "versions": versions()},
        "notes": [
            "Construido en código, sin hub ni pesos: SamConfig con los hiperparámetros de build_sam.py oficial (ventana 14, rel-pos, "
            "neck 256, decoder two-way de 2 capas × 8 cabezas, MLP 2048). Atención eager.",
            "params_total = params_total_hf_raw − 256: HF registra la matriz gaussiana 2×128 de la PE de Fourier "
            "(shared_image_embedding.positional_embedding, la misma que usa el prompt encoder) como nn.Parameter; en el código "
            "oficial (PositionEmbeddingRandom) es un buffer. El resto coincide módulo a módulo.",
            "El forward de referencia: imagen 1024×1024 en ceros, 1 clic positivo, sin caja (→ + 1 punto de relleno), sin máscara de "
            "entrada (→ embedding no-mask), multimask_output=True. FlopCounterMode cuenta las einsum de la posición relativa "
            "descompuesta y el producto por la matriz gaussiana (puntos y rejilla densa de 64×64).",
            "Bloques con ventanas: la rejilla de 64×64 se rellena a 70×70 (25 ventanas de 14×14 = 4,900 tokens); qkv, la atención y "
            "la proyección también corren sobre el relleno. Las tablas relativas miden (2·14−1)×d_h (ventana) y (2·64−1)×d_h (global).",
            "Las 4 máscaras se calculan siempre (multimask o no); la salida se corta después. Las máscaras salen a 256×256 (logits); "
            "el procesador las interpola a la imagen original (fuera del modelo).",
            "Formas sin batch; rejillas H×W×C (PyTorch: C×H×W; el ViT de SAM ya trabaja en B×H×W×C).",
        ],
    }
    if cid == "sam-vit-b-1024":
        data["override_checks"] = []
        for ov, P, mi, mm in (({"P": 3}, 3, False, True), ({"masks": 1}, 1, False, False), ({"maskIn": 1}, 1, True, True)):
            spec2, _, _ = sam_spec(cfg)
            keep = {k: spec2[k] for k in ("sparse", "tokens", "tok-out", "dense", "mask-c1")}
            r2 = Recorder(model, keep)
            o2, f2 = fcm_run(lambda: model(**sam_inputs(P, mi), multimask_output=mm))
            r2.remove()
            sh = r2.shapes()
            if not mi:
                sh.pop("mask-c1", None)
            sh["masks"] = b11(list(o2.pred_masks.shape))
            sh["iou"] = b11(list(o2.iou_scores.shape))
            data["override_checks"].append({"calc_overrides": ov, "params_total": total_hf - gauss, "flops_total": int(f2.get_total_flops()), "shapes": sh,
                                            "note": f"{P} clic(s), multimask_output={mm}, máscara de entrada={'sí (256×256)' if mi else 'no'}"})
    write_expected(cid, data)
    return data


# ================================================================== SAM 2
def sam2_build(cid, num_maskmem=7, max_ptrs=16):
    bb = SAM2[cid]
    ch = list(reversed(bb["embed_dim_per_stage"]))
    vc = dict(backbone_config=dict(model_type="sam2_hiera_det_model", **bb), backbone_channel_list=ch)
    cfg = Sam2VideoConfig(vision_config=vc, num_maskmem=num_maskmem, max_object_pointers_in_encoder=max_ptrs)
    model = Sam2VideoModel._from_config(cfg, attn_implementation="eager").eval().requires_grad_(False)
    ctor = (f"Sam2VideoModel._from_config(Sam2VideoConfig(vision_config={{'backbone_config': Sam2HieraDetConfig(**{bb}), "
            f"'backbone_channel_list': {ch}}}, num_maskmem={num_maskmem}, max_object_pointers_in_encoder={max_ptrs}), attn_implementation='eager')")
    return model, cfg, ctor


def make_session(model, frames=21):
    """Sesión con el frame 0 condicionado (prompt) y los 1…frames−2 seguidos; memorias y punteros en ceros."""
    sess = Sam2VideoInferenceSession(dtype=torch.float32)
    frame = torch.zeros(3, RES, RES)
    sess.processed_frames = {i: frame for i in range(frames)}
    obj = sess.obj_id_to_idx(1)
    N = (RES // 16) ** 2
    for t in range(frames - 1):
        sess.output_dict_per_obj[obj]["cond_frame_outputs" if t == 0 else "non_cond_frame_outputs"][t] = {
            "maskmem_features": torch.zeros(N, 1, model.mem_dim, dtype=torch.bfloat16),
            "maskmem_pos_enc": torch.zeros(N, 1, model.mem_dim),
            "object_pointer": torch.zeros(1, model.hidden_dim),
            "object_score_logits": torch.ones(1, 1),
        }
    return sess, obj, frames - 1


class DeadMatmul:
    """HF Sam2MultiScaleAttention: (query·scale) @ keyᵀ con batch sobre los tokens (resultado descartado)."""

    def __init__(self, model):
        self.flops, self.calls, self.handles = 0, 0, []
        for _n, m in model.named_modules():
            if type(m).__name__ == "Sam2MultiScaleAttention":
                def pre(mod, args, kwargs):
                    x = args[0] if args else kwargs["hidden_states"]
                    b, h, w, _ = x.shape
                    self.flops += 2 * b * h * w * mod.num_attention_heads * mod.dim_out
                    self.calls += 1
                self.handles.append(m.register_forward_pre_hook(pre, with_kwargs=True))

    def remove(self):
        for h in self.handles:
            h.remove()


def patched_vision_flops(model):
    """FLOPs del codificador con la atención de Hiera sin el producto descartado (como el oficial)."""
    from transformers.models.sam2 import modeling_sam2 as ms
    cls = None
    for _n, m in model.named_modules():
        if type(m).__name__ == "Sam2MultiScaleAttention":
            cls = type(m)
            break
    orig = cls.forward

    def fwd(self, hidden_states, **kwargs):
        B, H, W, _ = hidden_states.shape
        qkv = self.qkv(hidden_states).reshape(B, H * W, 3, self.num_attention_heads, -1)
        q, k, v = torch.unbind(qkv, 2)
        if self.query_stride:
            q = ms.do_pool(q.reshape(B, H, W, -1), self.query_stride)
            H, W = q.shape[1:3]
            q = q.reshape(B, H * W, self.num_attention_heads, -1)
        q, k, v = q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)
        a = torch.softmax((q * self.scale) @ k.transpose(-2, -1), dim=-1)
        x = (a @ v).transpose(1, 2).reshape(B, H, W, -1)
        return self.proj(x)
    cls.forward = fwd
    try:
        _, f = fcm_run(lambda: model.get_image_features(torch.zeros(1, 3, RES, RES), return_dict=True))
    finally:
        cls.forward = orig
    return int(f.get_total_flops())


def sam2_spec(model, cfg):
    bb = cfg.vision_config.backbone_config
    ends = [sum(bb.blocks_per_stage[: i + 1]) - 1 for i in range(4)]
    starts = [sum(bb.blocks_per_stage[:i]) for i in range(4)]
    ve = "vision_encoder.backbone"
    s = {"patches": (f"{ve}.patch_embed", "out", b1)}
    for k in range(4):
        s[f"h{k + 1}-out"] = (f"{ve}.blocks.{ends[k]}", "out", b1)
    s["h1-w-ln1"] = (f"{ve}.blocks.0.layer_norm1", "out", b1)
    s["h1-w-win"] = (f"{ve}.blocks.0.attn", "in", win)
    s["h1-w-u"] = (f"{ve}.blocks.0.mlp.proj_in", "out", b1)
    for k in (2, 3, 4):
        st = starts[k - 1]
        s[f"h{k}-q-ln1"] = (f"{ve}.blocks.{st}.layer_norm1", "out", b1)
        s[f"h{k}-q-skip-p"] = (f"{ve}.blocks.{st}.proj", "out", b1)
        s[f"h{k}-q-win"] = (f"{ve}.blocks.{st}.attn", "in", win)
        s[f"h{k}-q-o"] = (f"{ve}.blocks.{st}.attn.proj", "out", win)
        s[f"h{k}-q-u"] = (f"{ve}.blocks.{st}.mlp.proj_in", "out", b1)
    g0 = bb.global_attention_blocks[0]
    s["h3-g-seq"] = (f"{ve}.blocks.{g0}.attn", "in", lambda x: [x[1] * x[2], x[3]] if x[0] == 1 else None)
    s["h3-g-u"] = (f"{ve}.blocks.{g0}.mlp.proj_in", "out", b1)
    for i, lvl in enumerate(("fpn-l4", "fpn-l3", "fpn-s8", "fpn-s4")):
        s[lvl] = (f"vision_encoder.neck.convs.{i}", "out", nchw)
    s.update({
        "feat-s0": ("mask_decoder.conv_s0", "out", nchw), "feat-s1": ("mask_decoder.conv_s1", "out", nchw),
        "memory": ("memory_attention", ("kw", "memory"), seq_b), "memory-pos": ("memory_attention", ("kw", "memory_posision_embeddings"), seq_b),
        "feat-seq": ("memory_attention", ("kw", "current_vision_features"), seq_b),
        "ma-cross-kp": ("memory_attention.layers.0.cross_attn_image.k_proj", "out", seq_b),
        "ma-cross-qp": ("memory_attention.layers.0.cross_attn_image.q_proj", "out", seq_b),
        "ma-u": ("memory_attention.layers.0.linear1", "out", seq_b),
        "pix-mem-seq": ("memory_attention", "out", seq_b),
        "ptr-tpos": ("temporal_positional_encoding_projection_layer", "out", lambda x: x),
        "sparse": ("prompt_encoder", ("out", 0), b11), "dense": ("prompt_encoder", ("out", 1), nchw),
        "tokens": ("mask_decoder.transformer", ("kw", "point_embeddings"), b11),
        "tw-t2i-attn": ("mask_decoder.transformer.layers.0.cross_attn_token_to_image", ("out", 1), b1),
        "tok-out": ("mask_decoder.transformer", ("out", 0), b11),
        "up-c1": ("mask_decoder.upscale_conv1", "out", nchw), "up-c2": ("mask_decoder.upscale_conv2", "out", nchw),
        "masks": ("mask_decoder", ("out", 0), b11), "iou": ("mask_decoder", ("out", 1), b11),
        "obj-score": ("mask_decoder", ("out", 3), b11),
        "ptr-raw": ("object_pointer_proj", "out", lambda x: [y for y in x if y != 1]),
        "mask-mem-in": ("memory_encoder", ("arg", 1), nchw),
        "me-ds1-c": ("memory_encoder.mask_downsampler.layers.0.conv", "out", nchw),
        "mem-mask": ("memory_encoder.mask_downsampler", "out", nchw),
        "mem-pix": ("memory_encoder.feature_projection", "out", nchw),
        "me-cx-u": ("memory_encoder.memory_fuser.layers.0.pointwise_conv1", "out", b1),
        "mem-fused": ("memory_encoder.memory_fuser", "out", nchw),
        "mem-new": ("memory_encoder.projection", "out", nchw),
    })
    return s


def sam2_frame(model, cfg, record=True):
    sess, obj, t = make_session(model)
    spec = sam2_spec(model, cfg) if record else {}
    rec = Recorder(model, spec)
    dead = DeadMatmul(model)
    _, fa = fcm_run(lambda: model._prepare_vision_features(sess, t, 1))
    dead.remove()
    out, fb = fcm_run(lambda: model._run_single_frame_inference(sess, t, obj, 1, False, None, None, False))
    feats, _ = model._prepare_vision_features(sess, t, 1)
    _, fc = fcm_run(lambda: model._encode_new_memory(feats[-1], out["high_res_masks"], out["object_score_logits"], False))
    rec.remove()
    return rec, dead, (fa, fb, fc), out


def sam2_run(cid):
    model, cfg, ctor = sam2_build(cid)
    total = n_params(model)
    rec, dead, (fa, fb, fc), out = sam2_frame(model, cfg)
    ca, cb, cc = fa.get_flop_counts(), fb.get_flop_counts(), fc.get_flop_counts()
    # Los métodos se llaman directamente: FlopCounterMode nombra cada submódulo de primer nivel por su clase.
    by_node = {
        "img-encoder": by_module(ca, "Sam2VisionModel.backbone") - dead.flops,
        "fpn": by_module(ca, "Sam2VisionModel.neck"),
        "memory-attn+memory-bank+obj-ptrs": by_module(cb, "Sam2VideoMemoryAttention") + by_module(cb, "Linear") + by_module(cb, "Sam2VideoFeedForward"),
        "prompt-enc+mask-decoder+occlusion": by_module(cb, "Sam2VideoPromptEncoder") + by_module(cb, "Sam2VideoPositionalEmbedding")
                                             + by_module(cb, "Sam2VideoMaskDecoder") + by_module(ca, "Conv2d"),
        "memory-encoder": by_module(cc, "Sam2VideoMemoryEncoder"),
    }
    fA, fB, fC = int(fa.get_total_flops()), int(fb.get_total_flops()), int(fc.get_total_flops())
    flops = fA + fB + fC - dead.flops
    assert sum(by_node.values()) == flops, (by_node, flops, fA, fB, fC)
    shapes = {"x-img": [RES, RES, 3]}
    sh = rec.shapes()
    shapes.update({k: v for k, v in sh.items() if v is not None})
    shapes["best-mask"] = [out["pred_masks"].shape[-2], out["pred_masks"].shape[-1], 1]
    shapes["mask-hr"] = [out["high_res_masks"].shape[-2], out["high_res_masks"].shape[-1], 1]
    shapes["obj-ptr"] = [x for x in out["object_pointer"].shape if x != 1]
    md, ve = model.mask_decoder, model.vision_encoder
    bb = ve.backbone
    starts = [sum(cfg.vision_config.backbone_config.blocks_per_stage[:i]) for i in range(5)]
    params_by_node = {
        "img-encoder": n_params(bb), "fpn": n_params(ve.neck),
        "mask-decoder": n_params(md) - n_params(md.pred_obj_score_head), "occlusion": n_params(md.pred_obj_score_head),
        "prompt-enc": n_params(model.prompt_encoder) + n_params(model.mask_downsample),
        "memory-attn": n_params(model.memory_attention) + model.no_memory_embedding.numel() + model.no_memory_positional_encoding.numel(),
        "memory-bank": int(model.memory_temporal_positional_encoding.numel()),
        "obj-ptrs": n_params(model.object_pointer_proj) + n_params(model.temporal_positional_encoding_projection_layer) + int(model.no_object_pointer.numel()),
        "memory-encoder": n_params(model.memory_encoder) + int(model.occlusion_spatial_embedding_parameter.numel()),
    }
    params_by_path = {f"img-encoder>stage{k + 1}": sum(n_params(bb.blocks[i]) for i in range(starts[k], starts[k + 1])) for k in range(4)}
    params_by_path.update({
        "img-encoder>patch-embed": n_params(bb.patch_embed), "img-encoder>pos-embed": int(bb.pos_embed.numel() + bb.pos_embed_window.numel()),
        "mask-decoder>hires": n_params(md.conv_s0) + n_params(md.conv_s1),
        "mask-decoder>tokens": n_params(md.obj_score_token) + n_params(md.iou_token) + n_params(md.mask_tokens),
        "mask-decoder>two-way": n_params(md.transformer.layers), "mask-decoder>hypernet": n_params(md.output_hypernetworks_mlps),
        "memory-attn>cross-mem": sum(n_params(l.cross_attn_image) + n_params(l.layer_norm2) for l in model.memory_attention.layers),
        "memory-attn>self-attn": sum(n_params(l.self_attn) + n_params(l.layer_norm1) for l in model.memory_attention.layers),
        "memory-attn>mlp": sum(n_params(l.linear1) + n_params(l.linear2) + n_params(l.layer_norm3) for l in model.memory_attention.layers),
        "memory-encoder>downsampler": n_params(model.memory_encoder.mask_downsampler),
        "memory-encoder>fuser": n_params(model.memory_encoder.memory_fuser),
        "obj-ptrs>ptr-proj": n_params(model.object_pointer_proj),
    })
    blocks = [{"block": i, "dim": int(b.dim), "dim_out": int(b.dim_out), "window_size": int(b.window_size), "query_stride": list(b.query_stride) if b.query_stride else None,
               "heads": int(b.attn.num_attention_heads)} for i, b in enumerate(bb.blocks)]
    N = (RES // 16) ** 2
    data = {
        "config_id": cid, "model": "sam2",
        "params_total": total, "params_by_module": {n: n_params(c) for n, c in model.named_children()} | {
            "no_memory_embedding": int(model.no_memory_embedding.numel()), "no_memory_positional_encoding": int(model.no_memory_positional_encoding.numel()),
            "memory_temporal_positional_encoding": int(model.memory_temporal_positional_encoding.numel()), "no_object_pointer": int(model.no_object_pointer.numel()),
            "occlusion_spatial_embedding_parameter": int(model.occlusion_spatial_embedding_parameter.numel())},
        "params_by_node": params_by_node, "params_by_path": params_by_path,
        "hiera_blocks": blocks,
        "frame": {"frame_idx": 20, "num_frames": 21, "prompted_frames": [0], "tracked_frames": list(range(1, 20)), "points_on_frame": 0,
                  "spatial_memories": 7, "object_pointers": 16, "memory_tokens": 7 * N + 16 * 4,
                  "note": "frame de seguimiento sin clics: memoria = frame 0 (con prompt) + frames 14…19; punteros = frame 0 + frames 5…19"},
        "shapes": shapes, "shapes_torch": rec.torch_info(),
        "flops_total": flops, "flops_counted_torch": fA + fB + fC, "flops_hf_dead_matmul": dead.flops, "hf_dead_matmul_calls": dead.calls,
        "flops_phases": {"image_features": fA - dead.flops, "single_frame_inference": fB, "encode_new_memory": fC},
        "flops_by_node": by_node,
        "flops_by_op_torch": dict(sorted((str(k), int(sum(c.get("Global", {}).get(k, 0) for c in (ca, cb, cc))))
                                         for k in set(ca.get("Global", {})) | set(cb.get("Global", {})) | set(cc.get("Global", {})))),
        "source": {"lib": "transformers", "ctor": ctor, "versions": versions()},
        "notes": [
            "Construido en código, sin hub ni pesos: Sam2VideoConfig con el Hiera de configs/sam2.1/*.yaml oficiales (embed_dim, cabezas, "
            "stages, bloques globales, window_spec y fondo de la posición por ventanas) y el resto por defecto (= oficial: FPN a 256 con "
            "top-down en los niveles [2, 3], memory attention 4 capas RoPE de 1 cabeza, memory encoder de 64 canales, num_maskmem 7, "
            "16 punteros). Atención eager. Los parámetros coinciden con el oficial (la PE de Fourier es buffer en ambos).",
            "Forward de referencia: UN frame de seguimiento en régimen estacionario (frame 20 de 21, sin clics; 1 frame con prompt + "
            "6 recientes = 7 memorias de 64×64×64 y 16 punteros de objeto partidos en 4 tokens de 64 → 28,736 tokens de memoria). "
            "Sin clics, el prompt encoder recibe un punto vacío (etiqueta −1) + el relleno: 2 tokens. multimask (3) y la mejor por IoU "
            "alimenta la memoria y el puntero.",
            "flops_total = flops_counted_torch − flops_hf_dead_matmul: HF Sam2MultiScaleAttention calcula (query·scale) @ keyᵀ con el "
            "batch sobre los tokens (nH×d · d×nH, 2·B'·hw·nH·dim_out FLOPs por llamada) y descarta el resultado; el oficial "
            "(MultiScaleAttention de hieradet.py) no lo tiene." + (" Verificado en este JSON con un forward parcheado (dead_matmul_check)." if cid == "sam2-hiera-t" else ""),
            "Fases: (A) get_image_features = Hiera + FPN + conv_s0/conv_s1 del decoder (se calculan una vez por frame); (B) "
            "_run_single_frame_inference = memory attention + punteros + prompt encoder + decoder + oclusión + puntero nuevo; (C) "
            "_encode_new_memory = memory encoder (la máscara elegida se interpola a 1024×1024 antes, en B).",
            "FlopCounterMode no cuenta RoPE (productos elementwise), las interpolaciones ni la PE seno/coseno.",
            "Formas sin batch; rejillas H×W×C (PyTorch: C×H×W; Hiera de HF trabaja en B×H×W×C; la memoria es (HW)×B×C).",
        ],
    }
    if cid == "sam2-hiera-t":
        patched = patched_vision_flops(model)
        data["dead_matmul_check"] = {"image_features_patched": patched, "image_features_minus_dead": fA - dead.flops, "ok": patched == fA - dead.flops}
        assert patched == fA - dead.flops, (patched, fA, dead.flops)
        m2, cfg2, _ = sam2_build(cid, num_maskmem=4, max_ptrs=8)
        rec2, dead2, (ga, gb, gc), _o = sam2_frame(m2, cfg2)
        sh2 = rec2.shapes()
        data["override_checks"] = [{
            "calc_overrides": {"memFrames": 3, "ptrs": 8}, "params_total": n_params(m2),
            "flops_total": int(ga.get_total_flops() + gb.get_total_flops() + gc.get_total_flops()) - dead2.flops,
            "shapes": {k: sh2[k] for k in ("memory", "memory-pos", "ma-cross-kp", "pix-mem-seq", "ptr-tpos")},
            "note": "num_maskmem = 4 (3 recientes + 1 con prompt) y max_obj_ptrs_in_encoder = 8: 4·4096 + 8·4 tokens de memoria",
        }]
    write_expected(cid, data)
    return data


if __name__ == "__main__":
    ids_ = sys.argv[1:] or list(SAM) + list(SAM2)
    for cid in ids_:
        d = sam_run(cid) if cid in SAM else sam2_run(cid)
        print(f"{cid}: params {d['params_total']:,}  flops {d['flops_total']:,}")
