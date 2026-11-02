"""Cross-check de los modelos `t5` y `whisper` (SPEC §24): HF T5ForConditionalGeneration / WhisperForConditionalGeneration
construidos desde la config en el dispositivo META (sin pesos en memoria, sin hub). Escribe crosscheck/expected/
{t5-small,t5-base,t5-large,flan-t5-base,whisper-tiny,whisper-base,whisper-small,whisper-medium,whisper-large-v3,
distil-whisper-large-v3}.json y las configs de decode {t5-base-decode,whisper-small-decode}.json.

- Parámetros: sum(p.numel()) del modelo meta (exacto; los pesos atados cuentan una vez).
  * flan-t5-base: transformers 5.x fuerza T5Config.tie_word_embeddings = True (el valor del config solo apaga el reescalado
    d^-0.5); al cargar el checkpoint real lm_head y shared vienen distintos y HF NO los ata. Aquí se desata lm_head a mano
    (un Parameter meta nuevo) para reproducir el modelo cargado: 247,577,856.
  * Whisper: HF guarda la posición sinusoidal del encoder como nn.Embedding congelado (requires_grad False) y la cuenta en
    parameters(); el código de OpenAI la registra como buffer. params_total la excluye (convención del calculador: los PE fijos
    son buffers) y params_total_hf_raw = el crudo de HF (↔ quantities.paramsHF).
- FLOPs: FlopCounterMode sobre tensores meta con TODAS las capas, atención eager. Teacher forcing: encoder sobre T_in + decoder
  sobre las T_out posiciones en paralelo (el forward de HF con decoder_input_ids). Decode: EncoderDecoderCache con T_out − 1
  filas en la caché propia de cada capa y las K, V del encoder en la cross (is_updated = True: no se recalculan) + 1 token.
- Formas: hooks en la capa 0 de cada stack y un parche de eager_attention_forward (Q, K, V por cabeza, sesgo relativo, pesos
  de atención) por módulo de atención.
- Buckets de posición relativa: T5Attention._relative_position_bucket de HF en CPU (int64 reales) para −600 … 600, bidireccional
  y causal (↔ ATLAS.Arch.t5RelativeBucket).
- Whisper: WhisperFeatureExtractor(feature_size = n_mels) sobre audio de 30 s y de 5 s (ceros): 3,000 frames en los dos (relleno).
- Span corruption: port literal de random_spans_helper (t5/data/preprocessors.py del repo de T5, un centinela por span en
  entrada y objetivo; el paquete t5 no se instala) sobre una rejilla de inputs_length × noise_density × mean_noise_span_length
  (↔ ATLAS.Arch.encdec.spanCorruption: tokens, inputs y targets, con la corrección de noise_density == 0.5).

Uso: .venv/bin/python crosscheck/encdec.py
"""
import numpy as np
import torch
from torch.utils.flop_counter import FlopCounterMode

from common import n_params, versions, write_expected

import transformers  # noqa: E402
from transformers import (EncoderDecoderCache, DynamicCache, T5Config, T5ForConditionalGeneration,  # noqa: E402
                          WhisperConfig, WhisperFeatureExtractor, WhisperForConditionalGeneration)
from transformers.models.t5 import modeling_t5  # noqa: E402
from transformers.models.t5.modeling_t5 import T5Attention  # noqa: E402
from transformers.models.whisper import modeling_whisper  # noqa: E402

# Deben coincidir con js/arch/encdec.js.
T5 = {
    "t5-small": dict(D=512, L=6, h=8, Dmlp=2048, hf="google-t5/t5-small"),
    "t5-base": dict(D=768, L=12, h=12, Dmlp=3072, hf="google-t5/t5-base"),
    "t5-large": dict(D=1024, L=24, h=16, Dmlp=4096, hf="google-t5/t5-large"),
    "flan-t5-base": dict(D=768, L=12, h=12, Dmlp=2048, gated=True, hf="google/flan-t5-base"),
}
WH = {
    "whisper-tiny": dict(D=384, L=4, Ld=4, h=6, Dmlp=1536, mels=80, V=51865, hf="openai/whisper-tiny"),
    "whisper-base": dict(D=512, L=6, Ld=6, h=8, Dmlp=2048, mels=80, V=51865, hf="openai/whisper-base"),
    "whisper-small": dict(D=768, L=12, Ld=12, h=12, Dmlp=3072, mels=80, V=51865, hf="openai/whisper-small"),
    "whisper-medium": dict(D=1024, L=24, Ld=24, h=16, Dmlp=4096, mels=80, V=51865, hf="openai/whisper-medium"),
    "whisper-large-v3": dict(D=1280, L=32, Ld=32, h=20, Dmlp=5120, mels=128, V=51866, hf="openai/whisper-large-v3"),
    "distil-whisper-large-v3": dict(D=1280, L=32, Ld=2, h=20, Dmlp=5120, mels=128, V=51866, hf="distil-whisper/distil-large-v3"),
}
DECODE = {"t5-base-decode": "t5-base", "whisper-small-decode": "whisper-small"}
T5_TIN, T5_TOUT = 512, 114
WH_TOUT, WH_POS, WH_FRAMES = 128, 1500, 3000


# ------------------------------------------------------------------ construcción
def t5_config(c):
    kw = dict(vocab_size=32128, d_model=c["D"], d_kv=64, d_ff=c["Dmlp"], num_layers=c["L"], num_heads=c["h"],
              relative_attention_num_buckets=32, relative_attention_max_distance=128, layer_norm_epsilon=1e-6)
    if c.get("gated"):
        kw.update(feed_forward_proj="gated-gelu", tie_word_embeddings=False)
    return T5Config(**kw)


def wh_config(c):
    return WhisperConfig(vocab_size=c["V"], num_mel_bins=c["mels"], d_model=c["D"], encoder_layers=c["L"], decoder_layers=c["Ld"],
                         encoder_attention_heads=c["h"], decoder_attention_heads=c["h"], encoder_ffn_dim=c["Dmlp"], decoder_ffn_dim=c["Dmlp"],
                         max_source_positions=WH_POS, max_target_positions=448)


def build(kind, c):
    cfg = t5_config(c) if kind == "t5" else wh_config(c)
    cfg._attn_implementation = "eager"
    with torch.device("meta"):
        m = (T5ForConditionalGeneration if kind == "t5" else WhisperForConditionalGeneration)(cfg)
        if kind == "t5" and c.get("gated"):
            # checkpoint real de flan-t5: lm_head propio (HF no lo ata al cargar: pesos distintos)
            m.lm_head.weight = torch.nn.Parameter(torch.empty(cfg.vocab_size, cfg.d_model))
    m.config._attn_implementation = "eager"
    m.eval()
    return m, cfg


def ctor_text(kind, c):
    cfg = t5_config(c) if kind == "t5" else wh_config(c)
    if kind == "t5":
        keys = ["vocab_size", "d_model", "d_kv", "d_ff", "num_layers", "num_decoder_layers", "num_heads", "relative_attention_num_buckets",
                "relative_attention_max_distance", "feed_forward_proj", "layer_norm_epsilon", "scale_decoder_outputs"]
        txt = "T5ForConditionalGeneration(T5Config(" + ", ".join(f"{k}={getattr(cfg, k)!r}" for k in keys) + "))"
        if c.get("gated"):
            txt += "; lm_head.weight = Parameter nuevo (desatado, como el checkpoint)"
        return "with torch.device('meta'): " + txt
    keys = ["vocab_size", "num_mel_bins", "d_model", "encoder_layers", "decoder_layers", "encoder_attention_heads", "decoder_attention_heads",
            "encoder_ffn_dim", "decoder_ffn_dim", "max_source_positions", "max_target_positions", "activation_function", "scale_embedding"]
    return "with torch.device('meta'): WhisperForConditionalGeneration(WhisperConfig(" + ", ".join(f"{k}={getattr(cfg, k)!r}" for k in keys) + "))"


# ------------------------------------------------------------------ formas
class Recorder:
    def __init__(self):
        self.raw, self.handles, self.patches = {}, [], []

    def put(self, tid, shape, strip=True):
        s = list(shape)
        if strip:
            assert s[0] == 1, f"se esperaba B=1 en {tid}: {s}"
            s = s[1:]
        self.raw.setdefault(tid, s)

    def hook(self, model, name, where, tid, strip=True, transpose=False):
        m = dict(model.named_modules())[name]

        def fix(t):
            s = list(t.shape)
            if strip:
                assert s[0] == 1, f"B=1 en {tid}: {s}"
                s = s[1:]
            if transpose:
                s = [s[1], s[0]]
            self.raw.setdefault(tid, s)
        if where == "out":
            self.handles.append(m.register_forward_hook(lambda mod, inp, out: fix(out[0] if isinstance(out, tuple) else out)))
        else:
            self.handles.append(m.register_forward_pre_hook(lambda mod, inp: fix(inp[0])))

    def patch(self, module, attr, fn):
        orig = getattr(module, attr)
        setattr(module, attr, fn(orig))
        self.patches.append((module, attr, orig))

    def remove(self):
        for h in self.handles:
            h.remove()
        for module, attr, orig in reversed(self.patches):
            setattr(module, attr, orig)


def patch_attention(rec, mod, prefixes, t5, decode=False):
    """eager_attention_forward: Q, K, V por cabeza, scores / pesos (h×T_q×T_k), A·V por cabeza y el sesgo relativo de T5.
    En decode, la K y la V de la self-attention ya traen la caché (ctx filas): son d-k-ctx / d-v-ctx del calculador."""
    def wrap(orig):
        def f(module, query, key, value, attention_mask, *a, **kw):
            p = prefixes.get(id(module))
            if p:
                ctx = decode and p == "d-"
                rec.put(p + "q-heads", query.shape)
                rec.put(p + ("k-ctx" if ctx else "k-heads"), key.shape)
                rec.put(p + ("v-ctx" if ctx else "v-heads"), value.shape)
                rec.put(p + "scores", list(query.shape[:3]) + [key.shape[2]])
                rec.put(p + "attn", list(query.shape[:3]) + [key.shape[2]])
                rec.put(p + "z-heads", list(query.shape[:3]) + [value.shape[3]])
                if t5 and p != "c-" and kw.get("position_bias") is not None:
                    rec.put(p + "bias", kw["position_bias"].shape)
            return orig(module, query, key, value, attention_mask, *a, **kw)
        return f
    rec.patch(mod, "eager_attention_forward", wrap)


def attach_t5(m, c, rec, decode=False):
    e, d = "encoder.block.0.", "decoder.block.0."
    if not decode:
        rec.hook(m, "encoder.embed_tokens", "out", "e-x0")
        rec.hook(m, e + "layer.0.layer_norm", "out", "e-h1")
        for t, n in (("e-q", "q"), ("e-k", "k"), ("e-v", "v")):
            rec.hook(m, e + "layer.0.SelfAttention." + n, "out", t)
        rec.hook(m, e + "layer.0.SelfAttention.o", "in", "e-z")
        rec.hook(m, e + "layer.0.SelfAttention.o", "out", "e-o")
        rec.hook(m, e + "layer.1", "in", "e-r1")
        rec.hook(m, e + "layer.1.layer_norm", "out", "e-h2")
        ff = e + "layer.1.DenseReluDense."
        if c.get("gated"):
            rec.hook(m, ff + "wi_0", "out", "e-gate")
            rec.hook(m, ff + "wi_1", "out", "e-u")
        else:
            rec.hook(m, ff + "wi", "out", "e-u")
        rec.hook(m, ff + "act", "out", "e-g")
        if c.get("gated"):
            rec.hook(m, ff + "wo", "in", "e-prod")
        rec.hook(m, ff + "wo", "out", "e-f")
        rec.hook(m, f"encoder.block.{c['L'] - 1}", "out", "e-x-out")
        rec.hook(m, "encoder.final_layer_norm", "out", "enc-out")
    rec.hook(m, "decoder.embed_tokens", "out", "d-x0")
    rec.hook(m, d + "layer.0.layer_norm", "out", "d-h1")
    for t, n in (("d-q", "q"), ("d-k", "k"), ("d-v", "v")):
        rec.hook(m, d + "layer.0.SelfAttention." + n, "out", t)
    rec.hook(m, d + "layer.0.SelfAttention.o", "in", "d-z")
    rec.hook(m, d + "layer.0.SelfAttention.o", "out", "d-o")
    rec.hook(m, d + "layer.1", "in", "d-r1")
    rec.hook(m, d + "layer.1.layer_norm", "out", "c-h")
    rec.hook(m, d + "layer.1.EncDecAttention.q", "out", "c-q")
    if not decode:
        rec.hook(m, d + "layer.1.EncDecAttention.k", "out", "c-k")
        rec.hook(m, d + "layer.1.EncDecAttention.v", "out", "c-v")
    rec.hook(m, d + "layer.1.EncDecAttention.o", "in", "c-z")
    rec.hook(m, d + "layer.1.EncDecAttention.o", "out", "c-o")
    rec.hook(m, d + "layer.2", "in", "d-r2")
    rec.hook(m, d + "layer.2.layer_norm", "out", "d-h3")
    ff = d + "layer.2.DenseReluDense."
    if c.get("gated"):
        rec.hook(m, ff + "wi_0", "out", "d-gate")
        rec.hook(m, ff + "wi_1", "out", "d-u")
    else:
        rec.hook(m, ff + "wi", "out", "d-u")
    rec.hook(m, ff + "act", "out", "d-g")
    if c.get("gated"):
        rec.hook(m, ff + "wo", "in", "d-prod")
    rec.hook(m, ff + "wo", "out", "d-f")
    rec.hook(m, f"decoder.block.{c['L'] - 1}", "out", "d-x-out")
    rec.hook(m, "decoder.final_layer_norm", "out", "dec-out")
    if m.config.scale_decoder_outputs:
        rec.hook(m, "lm_head", "in", "dec-out-scaled")
    rec.hook(m, "lm_head", "out", "logits")
    pre = {id(m.encoder.block[0].layer[0].SelfAttention): "e-", id(m.decoder.block[0].layer[0].SelfAttention): "d-",
           id(m.decoder.block[0].layer[1].EncDecAttention): "c-"}
    patch_attention(rec, modeling_t5, pre, True, decode)


def attach_wh(m, c, rec, decode=False):
    E, Dd = "model.encoder.", "model.decoder."
    if not decode:
        rec.hook(m, E + "conv1", "in", "mel", transpose=True)
        rec.hook(m, E + "conv1", "out", "conv1-out", transpose=True)
        rec.hook(m, E + "conv2", "out", "conv2-out", transpose=True)
        rec.hook(m, E + "embed_positions", "out", "e-pos", strip=False)
        e = E + "layers.0."
        rec.hook(m, e[:-1], "in", "e-x0")
        rec.hook(m, e + "self_attn_layer_norm", "out", "e-h1")
        for t, n in (("e-q", "q_proj"), ("e-k", "k_proj"), ("e-v", "v_proj")):
            rec.hook(m, e + "self_attn." + n, "out", t)
        rec.hook(m, e + "self_attn.out_proj", "in", "e-z")
        rec.hook(m, e + "self_attn.out_proj", "out", "e-o")
        rec.hook(m, e + "final_layer_norm", "in", "e-r1")
        rec.hook(m, e + "final_layer_norm", "out", "e-h2")
        rec.hook(m, e + "fc1", "out", "e-u")
        rec.hook(m, e + "fc2", "in", "e-g")
        rec.hook(m, e + "fc2", "out", "e-f")
        rec.hook(m, E + f"layers.{c['L'] - 1}", "out", "e-x-out")
        rec.hook(m, E + "layer_norm", "out", "enc-out")
    d = Dd + "layers.0."
    rec.hook(m, Dd + "embed_tokens", "out", "d-tok")
    rec.hook(m, d[:-1], "in", "d-x0")
    rec.hook(m, d + "self_attn_layer_norm", "out", "d-h1")
    for t, n in (("d-q", "q_proj"), ("d-k", "k_proj"), ("d-v", "v_proj")):
        rec.hook(m, d + "self_attn." + n, "out", t)
    rec.hook(m, d + "self_attn.out_proj", "in", "d-z")
    rec.hook(m, d + "self_attn.out_proj", "out", "d-o")
    rec.hook(m, d + "encoder_attn_layer_norm", "in", "d-r1")
    rec.hook(m, d + "encoder_attn_layer_norm", "out", "c-h")
    rec.hook(m, d + "encoder_attn.q_proj", "out", "c-q")
    if not decode:
        rec.hook(m, d + "encoder_attn.k_proj", "out", "c-k")
        rec.hook(m, d + "encoder_attn.v_proj", "out", "c-v")
    rec.hook(m, d + "encoder_attn.out_proj", "in", "c-z")
    rec.hook(m, d + "encoder_attn.out_proj", "out", "c-o")
    rec.hook(m, d + "final_layer_norm", "in", "d-r2")
    rec.hook(m, d + "final_layer_norm", "out", "d-h3")
    rec.hook(m, d + "fc1", "out", "d-u")
    rec.hook(m, d + "fc2", "in", "d-g")
    rec.hook(m, d + "fc2", "out", "d-f")
    rec.hook(m, Dd + f"layers.{c['Ld'] - 1}", "out", "d-x-out")
    rec.hook(m, Dd + "layer_norm", "out", "dec-out")
    rec.hook(m, "proj_out", "out", "logits")
    pre = {id(m.model.encoder.layers[0].self_attn): "e-", id(m.model.decoder.layers[0].self_attn): "d-",
           id(m.model.decoder.layers[0].encoder_attn): "c-"}
    patch_attention(rec, modeling_whisper, pre, False, decode)


# ------------------------------------------------------------------ forwards
def teacher_forced(kind, m, c, Tin, Tout, record=True):
    rec = Recorder()
    if record:
        (attach_t5 if kind == "t5" else attach_wh)(m, c, rec)
    dec_ids = torch.zeros(1, Tout, dtype=torch.long, device="meta")
    if kind == "t5":
        kwargs = dict(input_ids=torch.zeros(1, Tin, dtype=torch.long, device="meta"), decoder_input_ids=dec_ids)
    else:
        kwargs = dict(input_features=torch.zeros(1, c["mels"], WH_FRAMES, device="meta"), decoder_input_ids=dec_ids)
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = m(**kwargs, use_cache=True)
    rec.remove()
    counts = fcm.get_flop_counts()
    by_op = {str(k): int(v) for k, v in counts.get("Global", {}).items()}
    by_mod = {k: sum(int(v) for v in dd.values()) for k, dd in counts.items() if k != "Global"}
    pkv = out.past_key_values
    kv = {"self": sum(int(l.keys.numel() + l.values.numel()) for l in pkv.self_attention_cache.layers),
          "cross": sum(int(l.keys.numel() + l.values.numel()) for l in pkv.cross_attention_cache.layers)}
    return int(fcm.get_total_flops()), dict(sorted(by_op.items())), by_mod, dict(rec.raw), kv


def decode_step(kind, m, c, Tin, Tout, record=True):
    """Un paso de generación en la posición Tout − 1: Tout − 1 filas en la self cache, Tin en la cross (ya calculadas)."""
    cfg = m.config
    h, dh = (c["h"], 64) if kind == "t5" else (c["h"], c["D"] // c["h"])
    L = c["L"] if kind == "t5" else c["Ld"]
    self_c, cross_c = DynamicCache(config=cfg), DynamicCache(config=cfg)
    for i in range(L):
        k = torch.zeros(1, h, Tout - 1, dh, device="meta")
        self_c.update(k, k.clone(), i)
        kx = torch.zeros(1, h, Tin, dh, device="meta")
        cross_c.update(kx, kx.clone(), i)
    cache = EncoderDecoderCache(self_c, cross_c)
    for i in range(L):
        cache.is_updated[i] = True
    rec = Recorder()
    if record:
        (attach_t5 if kind == "t5" else attach_wh)(m, c, rec, decode=True)
    enc = torch.zeros(1, Tin, c["D"], device="meta")
    kwargs = dict(encoder_outputs=(enc,), decoder_input_ids=torch.zeros(1, 1, dtype=torch.long, device="meta"), past_key_values=cache, use_cache=True)
    if kind == "whisper":
        kwargs["decoder_position_ids"] = torch.tensor([[Tout - 1]], device="meta")
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        m(**kwargs)
    rec.remove()
    counts = fcm.get_flop_counts()
    by_op = {str(k): int(v) for k, v in counts.get("Global", {}).items()}
    return int(fcm.get_total_flops()), dict(sorted(by_op.items())), dict(rec.raw)


# ------------------------------------------------------------------ desgloses
def params_by_node(kind, m, c):
    s = lambda mods: int(sum(n_params(x) for x in mods))  # noqa: E731
    if kind == "t5":
        eb, db = m.encoder.block, m.decoder.block
        pb = {"embed": n_params(m.shared), "encoder": s(eb), "enc-out": n_params(m.encoder.final_layer_norm),
              "decoder": s(db), "dec-norm": n_params(m.decoder.final_layer_norm),
              "lm-head": 0 if m.lm_head.weight is m.shared.weight else n_params(m.lm_head),
              "enc-attn": s(b.layer[0] for b in eb), "enc-ffn": s(b.layer[1] for b in eb),
              "self-attn": s(b.layer[0] for b in db), "cross-attn": s(b.layer[1] for b in db), "ffn": s(b.layer[2] for b in db),
              "rel-bias": n_params(eb[0].layer[0].SelfAttention.relative_attention_bias) + n_params(db[0].layer[0].SelfAttention.relative_attention_bias)}
        return pb
    enc, dec = m.model.encoder, m.model.decoder
    el, dl = enc.layers, dec.layers
    return {"conv": n_params(enc.conv1) + n_params(enc.conv2), "encoder": s(el), "enc-out": n_params(enc.layer_norm),
            "prompt-tokens": n_params(dec.embed_tokens) + n_params(dec.embed_positions), "pos-embed": n_params(dec.embed_positions),
            "decoder": s(dl), "dec-norm": n_params(dec.layer_norm), "lm-head": 0 if m.proj_out.weight is dec.embed_tokens.weight else n_params(m.proj_out),
            "enc-attn": s(l.self_attn for l in el) + s(l.self_attn_layer_norm for l in el),
            "enc-ffn": s(l.fc1 for l in el) + s(l.fc2 for l in el) + s(l.final_layer_norm for l in el),
            "self-attn": s(l.self_attn for l in dl) + s(l.self_attn_layer_norm for l in dl),
            "cross-attn": s(l.encoder_attn for l in dl) + s(l.encoder_attn_layer_norm for l in dl),
            "ffn": s(l.fc1 for l in dl) + s(l.fc2 for l in dl) + s(l.final_layer_norm for l in dl)}


def node_flops(kind, by_mod, c):
    cls = "T5ForConditionalGeneration" if kind == "t5" else "WhisperForConditionalGeneration"
    if kind == "t5":
        L = c["L"]
        cross = sum(by_mod.get(f"{cls}.decoder.block.{i}.layer.1", 0) for i in range(L))
        return {"encoder": by_mod.get(f"{cls}.encoder", 0), "decoder": by_mod.get(f"{cls}.decoder", 0), "lm-head": by_mod.get(f"{cls}.lm_head", 0),
                "cross-attn": cross}
    Ld = c["Ld"]
    cross = sum(by_mod.get(f"{cls}.model.decoder.layers.{i}.encoder_attn", 0) for i in range(Ld))
    return {"conv+encoder": by_mod.get(f"{cls}.model.encoder", 0), "conv": by_mod.get(f"{cls}.model.encoder.conv1", 0) + by_mod.get(f"{cls}.model.encoder.conv2", 0),
            "decoder": by_mod.get(f"{cls}.model.decoder", 0), "lm-head": by_mod.get(f"{cls}.proj_out", 0), "cross-attn": cross}


def op_groups(kind):
    g = [{"ops": ["aten.mm", "aten.addmm"], "prims": ["linear", "lm_head"]},
         {"ops": ["aten.bmm"], "prims": ["attention_scores", "attention_weighted_sum"]}]
    if kind == "whisper":
        g.append({"ops": ["aten.convolution"], "prims": ["conv1d"]})
    return g


def bucket_checks():
    r = torch.arange(-600, 601)
    out = []
    for bi in (True, False):
        b = T5Attention._relative_position_bucket(r, bidirectional=bi, num_buckets=32, max_distance=128)
        out.append({"what": ("bidireccional (encoder)" if bi else "causal (decoder)") + ", 32 buckets, distancia máxima 128",
                    "range": [-600, 600], "bidirectional": bi, "buckets": 32, "max_distance": 128, "ref": [int(x) for x in b]})
    return out


def random_spans_helper(inputs_length, noise_density, mean_noise_span_length,
                        extra_tokens_per_span_inputs=1, extra_tokens_per_span_targets=1):
    """Port literal de t5/data/preprocessors.py::random_spans_helper (google-research/text-to-text-transfer-transformer).
    Devuelve (tokens_length, inputs_length, targets_length): los dos que retorna T5 y el inputs_length que registra con verbose."""
    def _tokens_length_to_inputs_length_targets_length(tokens_length):
        num_noise_tokens = int(round(tokens_length * noise_density))
        num_nonnoise_tokens = tokens_length - num_noise_tokens
        num_noise_spans = int(round(num_noise_tokens / mean_noise_span_length))
        return (num_nonnoise_tokens + num_noise_spans * extra_tokens_per_span_inputs + 1,
                num_noise_tokens + num_noise_spans * extra_tokens_per_span_targets + 1)
    tokens_length = inputs_length - 1
    while _tokens_length_to_inputs_length_targets_length(tokens_length + 1)[0] <= inputs_length:
        tokens_length += 1
    inputs_length, targets_length = _tokens_length_to_inputs_length_targets_length(tokens_length)
    if noise_density == 0.5 and targets_length > inputs_length:
        tokens_length -= 1
        targets_length -= 1
    return tokens_length, inputs_length, targets_length


def span_checks():
    lengths = list(range(2, 41)) + [64, 100, 128, 256, 511, 512, 513, 568, 1024, 2048]
    densities = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75]
    means = [1, 2, 2.5, 3, 4, 5, 8, 10]
    # Una fila por combinación, en texto compacto: "inputs_length noise_density mean_span: tokens inputs targets".
    rows = ["%d %s %s: %d %d %d" % ((L, d, m) + random_spans_helper(L, d, m)) for L in lengths for d in densities for m in means]
    return {"what": "random_spans_helper de T5 (port literal), " + str(len(rows)) + " combinaciones",
            "format": "inputs_length noise_density mean_noise_span_length: tokens inputs targets", "rows": rows}


def mel_checks(mels):
    fe = WhisperFeatureExtractor(feature_size=mels)
    res = {}
    for sec in (30, 5):
        audio = np.zeros(sec * 16000, dtype=np.float32)
        feats = fe(audio, sampling_rate=16000, return_tensors="np").input_features
        res[sec] = {"audio": [int(audio.shape[0])], "mel": [int(feats.shape[2]), int(feats.shape[1])]}
    return res


# ------------------------------------------------------------------ JSON
def run(cid, kind):
    c = T5[cid] if kind == "t5" else WH[cid]
    m, cfg = build(kind, c)
    params_hf = n_params(m)
    enc_pos = 0 if kind == "t5" else n_params(m.model.encoder.embed_positions)
    params_total = params_hf - enc_pos
    Tin = T5_TIN if kind == "t5" else WH_POS
    Tout = T5_TOUT if kind == "t5" else WH_TOUT
    flops, by_op, by_mod, shapes, kv = teacher_forced(kind, m, c, Tin, Tout)
    L_dec = c["L"] if kind == "t5" else c["Ld"]
    notes = ["FlopCounterMode = 2 × MACs de matmuls (mm, bmm) y convoluciones; sesgos, normas, softmax, GELU / ReLU, el sesgo relativo de T5 y la máscara no cuentan.",
             "Teacher forcing: decoder_input_ids de T_out tokens en paralelo (QKᵀ y A·V de la self-attention causal cuentan las T_out² entradas, como el calculador)."]
    data = {"config_id": cid, "model": kind, "Tin": Tin, "Tout": Tout, "params_total": params_total,
            "params_by_node": params_by_node(kind, m, c), "shapes": shapes, "flops_total": flops,
            "flops_by_node": node_flops(kind, by_mod, c), "flops_by_op_torch": by_op, "flops_by_op_groups": op_groups(kind),
            "metrics_checks": {"crossKvBytes": kv["cross"] * 2, "selfKvCacheBytes": kv["self"] * 2, "totalParams": params_total}}
    if kind == "t5":
        data["params_by_node"].pop("rel-bias")
        data["rel_bias_params"] = params_by_node(kind, m, c)["rel-bias"]
        Tin2, Tout2 = 128, 32
        f2, _, _, sh2, kv2 = teacher_forced(kind, m, c, Tin2, Tout2)
        data["override_checks"] = [{"calc_overrides": {"Tin": Tin2, "Tout": Tout2}, "flops_total": f2, "params_total": params_total,
                                    "shapes": {k: sh2[k] for k in ("e-x0", "e-scores", "e-bias", "d-scores", "d-bias", "c-scores", "c-k-heads", "logits") if k in sh2}}]
        if cid == "t5-base":
            data["bucket_checks"] = bucket_checks()
            data["span_checks"] = span_checks()
        notes.append("Sin escalado 1/√d_h en QKᵀ (T5Attention.scaling = 1.0); el sesgo relativo (tabla 32 × h) solo existe en la capa 0 de cada stack y se reusa.")
        if c.get("gated"):
            notes.append("flan-t5-base: T5Config de transformers 5.x fuerza tie_word_embeddings = True; lm_head se desata a mano (como queda al cargar el checkpoint, donde lm_head ≠ shared). scale_decoder_outputs = False (sin d^-0.5).")
    else:
        data["params_total_hf_raw"] = params_hf
        data["encoder_positions_buffer"] = enc_pos
        mc = mel_checks(c["mels"])
        data["shapes"]["audio"] = mc[30]["audio"]
        data["shapes"]["mel"] = mc[30]["mel"]
        f5, _, _, sh5, _ = teacher_forced(kind, m, c, Tin, Tout, record=False)
        data["override_checks"] = [{"calc_overrides": {"seconds": 5}, "flops_total": f5, "params_total": params_total,
                                    "shapes": {"audio": mc[5]["audio"], "mel": mc[5]["mel"]}}]
        T448 = 448
        f448, _, _, sh448, _ = teacher_forced(kind, m, c, Tin, T448)
        data["override_checks"].append({"calc_overrides": {"Tout": T448}, "flops_total": f448,
                                        "shapes": {k: sh448[k] for k in ("d-scores", "c-scores", "logits") if k in sh448}})
        notes.append("Posición sinusoidal del encoder: HF la guarda como nn.Embedding congelado (" + f"{enc_pos:,}" + " valores) y la cuenta en parameters(); params_total la excluye (buffer, como en el código de OpenAI); params_total_hf_raw = crudo de HF.")
        notes.append("mel: WhisperFeatureExtractor(feature_size = n_mels) sobre audio de ceros: 30 s y 5 s dan los mismos 3,000 frames (relleno a 30 s); la entrada del modelo es n_mels × 3,000 (aquí traspuesta, frames × bandas).")
    data["notes"] = notes
    data["hf_config_source"] = c["hf"]
    data["source"] = {"lib": "transformers", "version": transformers.__version__, "ctor": ctor_text(kind, c), "attn_implementation": "eager", "versions": versions()}
    write_expected(cid, data)


def run_decode(cid):
    of = DECODE[cid]
    kind = "t5" if of in T5 else "whisper"
    c = T5[of] if kind == "t5" else WH[of]
    m, cfg = build(kind, c)
    params_hf = n_params(m)
    enc_pos = 0 if kind == "t5" else n_params(m.model.encoder.embed_positions)
    Tin = T5_TIN if kind == "t5" else WH_POS
    Tout = T5_TOUT if kind == "t5" else WH_TOUT
    flops, by_op, shapes = decode_step(kind, m, c, Tin, Tout)
    T2 = 32
    f2, _, sh2 = decode_step(kind, m, c, Tin, T2, record=True)
    data = {"config_id": cid, "model": kind, "decode_of": of, "Tin": Tin, "Tout": Tout, "params_total": params_hf - enc_pos,
            "shapes": shapes, "flops_total": flops, "flops_by_op_torch": by_op, "flops_by_op_groups": op_groups(kind)[:2],
            "override_checks": [{"calc_overrides": {"Tout": T2}, "flops_total": f2, "shapes": {k: sh2[k] for k in ("d-scores", "c-scores", "logits") if k in sh2}}],
            "notes": ["Un paso de decode: EncoderDecoderCache con T_out − 1 filas en la self cache y T_in en la cross (is_updated = True: W_K y W_V de la cross no corren).",
                      "La self-attention lee T_out filas (T_out − 1 + la nueva); la cross-attention, las T_in del encoder."],
            "hf_config_source": c["hf"],
            "source": {"lib": "transformers", "version": transformers.__version__, "ctor": ctor_text(kind, c), "attn_implementation": "eager", "versions": versions()}}
    if kind == "whisper":
        data["params_total_hf_raw"] = params_hf
    write_expected(cid, data)


if __name__ == "__main__":
    for cid in T5:
        print(f"▸ {cid}", flush=True)
        run(cid, "t5")
    for cid in WH:
        print(f"▸ {cid}", flush=True)
        run(cid, "whisper")
    for cid in DECODE:
        print(f"▸ {cid}", flush=True)
        run_decode(cid)
