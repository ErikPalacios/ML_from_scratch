"""Cross-check del modelo `llm` (SPEC §18): HF LlamaForCausalLM / MixtralForCausalLM construidos en código en el
dispositivo META (sin pesos en memoria, sin hub). Escribe crosscheck/expected/{llama3-8b,llama3-70b,llama2-7b,mixtral-8x7b}.json.

- Parámetros: sum(p.numel()) del modelo meta (exacto).
- FLOPs: FlopCounterMode sobre tensores meta con TODAS las capas (no se extrapola desde un modelo chico). Los tensores meta
  no permiten construir la máscara causal (HF llama .item()): se pasa una máscara 4-D de ceros ya construida, que no cambia
  ningún FLOP (la máscara es una suma; QKᵀ y A·V se calculan completos igual).
- MoE: experts_implementation = 'batched_mm' (bmm sobre las k·T filas enrutadas: funciona con tensores meta). Con la
  implementación eager (bucle por experto sobre los tokens enrutados) el conteo es idéntico: se verifica en un Mixtral
  diminuto con pesos reales (moe_impl_check). 'grouped_mm' no lo cuenta FlopCounterMode (aten._grouped_mm sin fórmula).
- Decode: una KV cache (DynamicCache) con ctx − 1 filas meta por capa + 1 token nuevo en la posición ctx − 1.

Uso: .venv/bin/python crosscheck/llm.py
"""
import os

import torch
from torch.utils.flop_counter import FlopCounterMode

from common import n_params, versions, write_expected

import transformers  # noqa: E402
from transformers import DynamicCache, LlamaConfig, LlamaForCausalLM, MixtralConfig, MixtralForCausalLM  # noqa: E402
from transformers.models.llama import modeling_llama  # noqa: E402
from transformers.models.mixtral import modeling_mixtral  # noqa: E402
from transformers.integrations import moe as hf_moe  # noqa: E402

# Deben coincidir con js/arch/llm.js (T = tokens del prompt, ctx = contexto del paso de decode).
CONFIGS = {
    "llama3-8b": dict(kind="llama", D=4096, L=32, h=32, G=8, dh=128, Dmlp=14336, V=128256, ctx_max=8192, theta=500000.0, eps=1e-5,
                      hf="meta-llama/Meta-Llama-3-8B"),
    "llama3-70b": dict(kind="llama", D=8192, L=80, h=64, G=8, dh=128, Dmlp=28672, V=128256, ctx_max=8192, theta=500000.0, eps=1e-5,
                       hf="meta-llama/Meta-Llama-3-70B"),
    "llama2-7b": dict(kind="llama", D=4096, L=32, h=32, G=32, dh=128, Dmlp=11008, V=32000, ctx_max=4096, theta=10000.0, eps=1e-5,
                      hf="meta-llama/Llama-2-7b-hf"),
    "mixtral-8x7b": dict(kind="mixtral", D=4096, L=32, h=32, G=8, dh=128, Dmlp=14336, V=32000, ctx_max=32768, theta=1e6, eps=1e-5,
                         E=8, k=2, hf="mistralai/Mixtral-8x7B-v0.1"),
}
T_DEFAULT, CTX_DEFAULT, T_SMALL = 2048, 4096, 64

NOT_HOOKED = {
    "ids": "entrada (input_ids)",
    "scores": "dentro de eager_attention_forward (matmul funcional); la forma es la de attn",
    "scores-scaled": "dentro de eager_attention_forward",
    "masked": "dentro de eager_attention_forward (suma de la máscara)",
    "z-heads": "dentro de eager_attention_forward (HF la devuelve ya transpuesta, T×h×d_h)",
    "next-token": "el muestreo no es parte del forward de HF (generate lo hace afuera)",
}


def hf_config(c, G=None):
    common = dict(vocab_size=c["V"], hidden_size=c["D"], intermediate_size=c["Dmlp"], num_hidden_layers=c["L"],
                  num_attention_heads=c["h"], num_key_value_heads=G or c["G"], head_dim=c["dh"],
                  max_position_embeddings=c["ctx_max"], rms_norm_eps=c["eps"], rope_theta=c["theta"], tie_word_embeddings=False)
    if c["kind"] == "mixtral":
        return MixtralConfig(**common, num_local_experts=c["E"], num_experts_per_tok=c["k"], sliding_window=None)
    return LlamaConfig(**common, attention_bias=False, mlp_bias=False)


def ctor_text(c, G=None):
    cls = "MixtralForCausalLM(MixtralConfig" if c["kind"] == "mixtral" else "LlamaForCausalLM(LlamaConfig"
    cfg = hf_config(c, G)
    keys = ["vocab_size", "hidden_size", "intermediate_size", "num_hidden_layers", "num_attention_heads", "num_key_value_heads",
            "head_dim", "max_position_embeddings", "rms_norm_eps", "tie_word_embeddings"]
    keys += ["num_local_experts", "num_experts_per_tok", "sliding_window"] if c["kind"] == "mixtral" else ["attention_bias", "mlp_bias"]
    args = ", ".join(f"{k}={getattr(cfg, k)!r}" for k in keys)
    return f"with torch.device('meta'): {cls}({args}, rope_theta={c['theta']!r}))"


def build(c, G=None):
    cfg = hf_config(c, G)
    with torch.device("meta"):
        model = (MixtralForCausalLM if c["kind"] == "mixtral" else LlamaForCausalLM)(cfg)
    model.config._attn_implementation = "eager"
    if c["kind"] == "mixtral":
        model.config._experts_implementation = "batched_mm"
    model.eval()
    return model


class Recorder:
    """Formas por id de tensor del calculador (sin batch)."""

    def __init__(self):
        self.raw = {}
        self.handles = []
        self.patches = []

    def put(self, tid, shape, strip=True):
        s = list(shape)
        if strip:
            assert s[0] == 1, f"se esperaba B=1 en {tid}: {s}"
            s = s[1:]
        self.raw.setdefault(tid, s)

    def hook(self, model, name, where, tid, idx=None, strip=True):
        m = dict(model.named_modules())[name]
        if where == "out":
            def h(mod, inp, out):
                t = out[idx] if idx is not None else (out[0] if isinstance(out, tuple) else out)
                self.put(tid, t.shape, strip)
            self.handles.append(m.register_forward_hook(h))
        else:
            def p(mod, inp):
                self.put(tid, inp[0].shape, strip)
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


def attach(model, c, rec):
    L = c["L"]
    pre = "model.layers.0."
    rec.hook(model, "model.embed_tokens", "out", "x0")
    rec.hook(model, pre + "input_layernorm", "out", "h-norm1")
    for t, mod in (("q", "q_proj"), ("k", "k_proj"), ("v", "v_proj")):
        rec.hook(model, pre + "self_attn." + mod, "out", t)
    rec.hook(model, pre + "self_attn.o_proj", "in", "z")
    rec.hook(model, pre + "self_attn.o_proj", "out", "o")
    rec.hook(model, pre + "post_attention_layernorm", "in", "r1")
    rec.hook(model, pre + "post_attention_layernorm", "out", "h-norm2")
    if c["kind"] == "mixtral":
        # el router devuelve (logits T×E, pesos T×k, ids T×k) ya sin la dimensión de batch
        rec.hook(model, pre + "mlp.gate", "out", "router-logits", idx=0, strip=False)
        rec.hook(model, pre + "mlp.gate", "out", "topk-weights", idx=1, strip=False)
        rec.hook(model, pre + "mlp.gate", "out", "topk-ids", idx=2, strip=False)
        rec.hook(model, pre + "mlp", "out", "f")
        calls = {"n": 0}

        def wrap_bl(orig):
            # batched_mm: 1.ª llamada x-routed (S×D) → [gate; up] (S×2D_mlp); 2.ª prod (S×D_mlp) → expert-out (S×D). Solo capa 0.
            def f(inp, weight, bias=None, is_transposed=False):
                out = orig(inp, weight, bias=bias, is_transposed=is_transposed)
                if calls["n"] == 0:
                    rec.put("x-routed", inp.shape, False)
                    rec.put("gate", [out.shape[0], out.shape[1] // 2], False)
                    rec.put("up", [out.shape[0], out.shape[1] // 2], False)
                elif calls["n"] == 1:
                    rec.put("prod", inp.shape, False)
                    rec.put("expert-out", out.shape, False)
                calls["n"] += 1
                return out
            return f
        rec.patch(hf_moe, "_batched_linear", wrap_bl)
    else:
        rec.hook(model, pre + "mlp.gate_proj", "out", "gate")
        rec.hook(model, pre + "mlp.up_proj", "out", "up")
        rec.hook(model, pre + "mlp.act_fn", "out", "act")
        rec.hook(model, pre + "mlp.down_proj", "in", "prod")
        rec.hook(model, pre + "mlp.down_proj", "out", "f")
    rec.hook(model, f"model.layers.{L - 1}", "out", "x-out")
    rec.hook(model, "model.norm", "out", "x-norm")
    rec.hook(model, "lm_head", "out", "logits")
    mod = modeling_mixtral if c["kind"] == "mixtral" else modeling_llama

    def wrap_rope(orig):
        def f(q, k, cos, sin, *a, **kw):
            rec.put("q-heads", q.shape)
            rec.put("k-heads", k.shape)
            qo, ko = orig(q, k, cos, sin, *a, **kw)
            rec.put("q-rope", qo.shape)
            rec.put("k-rope", ko.shape)
            return qo, ko
        return f
    rec.patch(mod, "apply_rotary_pos_emb", wrap_rope)


def forward(model, c, T, past=0, record=True):
    """Prefill (past = 0) o decode (T = 1, past = ctx − 1 filas en la caché). Devuelve (flops, por op, por módulo, formas, kv)."""
    rec = Recorder()
    if record:
        attach(model, c, rec)
    S = past + T
    ids = torch.zeros(1, T, dtype=torch.long, device="meta")
    mask = torch.zeros(1, 1, T, S, device="meta")
    pos = torch.arange(past, S, device="meta")[None]
    kwargs = dict(input_ids=ids, attention_mask=mask, position_ids=pos, use_cache=True, output_attentions=record)
    if past:
        cache = DynamicCache(config=model.config)
        for layer in range(c["L"]):
            kv = torch.zeros(1, model.config.num_key_value_heads, past, c["dh"], device="meta")
            cache.update(kv, kv.clone(), layer)
        kwargs["past_key_values"] = cache
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = model(**kwargs)
    rec.remove()
    counts = fcm.get_flop_counts()
    by_op = {str(k): int(v) for k, v in counts.get("Global", {}).items()}
    by_mod = {k: sum(int(v) for v in d.values()) for k, d in counts.items() if k != "Global"}
    shapes = dict(rec.raw)
    if record:
        shapes["attn"] = list(out.attentions[0].shape[1:])
        lay = out.past_key_values.layers[0]
        if past:
            shapes["k-ctx"] = list(lay.keys.shape[1:])
            shapes["v-ctx"] = list(lay.values.shape[1:])
        else:
            shapes["v-heads"] = list(lay.values.shape[1:])
    kv_elems = sum(int(l.keys.numel() + l.values.numel()) for l in out.past_key_values.layers)
    return int(fcm.get_total_flops()), dict(sorted(by_op.items())), by_mod, shapes, kv_elems


def module_flops(by_mod, cls, c, sub):
    return sum(by_mod.get(f"{cls}.model.layers.{i}.{sub}", 0) for i in range(c["L"]))


def moe_impl_check():
    """Mixtral diminuto con pesos reales: FLOPs con experts eager (bucle por experto) = batched_mm; grouped_mm no se cuenta."""
    cfg = MixtralConfig(vocab_size=100, hidden_size=64, intermediate_size=96, num_hidden_layers=2, num_attention_heads=4,
                        num_key_value_heads=2, head_dim=16, num_local_experts=8, num_experts_per_tok=2)
    torch.manual_seed(0)
    m = MixtralForCausalLM(cfg)
    for p in m.parameters():
        torch.nn.init.normal_(p, std=0.1)
    m.config._attn_implementation = "eager"
    m.eval()
    ids = torch.randint(0, 100, (1, 16))
    res = {}
    for impl in ("eager", "batched_mm", "grouped_mm"):
        m.config._experts_implementation = impl
        fcm = FlopCounterMode(display=False)
        with fcm, torch.no_grad():
            m(input_ids=ids, use_cache=False)
        res[impl] = int(fcm.get_total_flops())
    D, F, E, k, T, L = 64, 96, 8, 2, 16, 2
    analytic_experts = 2 * L * k * T * 3 * D * F
    return {"config": "MixtralConfig(hidden 64, intermediate 96, 2 capas, 4 cabezas, 2 KV, 8 expertos, top-2), T = 16, pesos aleatorios",
            "flops": res, "experts_flops_analytic": analytic_experts,
            "eager_equals_batched_mm": res["eager"] == res["batched_mm"], "grouped_mm_undercounts": res["grouped_mm"] < res["eager"]}


def run(config_id):
    c = CONFIGS[config_id]
    model = build(c)
    cls = type(model).__name__
    L = c["L"]
    layers = model.model.layers

    def lsum(fn):
        return int(sum(fn(layers[i]) for i in range(L)))

    pb = {
        "embed": n_params(model.model.embed_tokens), "lm-head": n_params(model.lm_head), "final-norm": n_params(model.model.norm),
        "blocks": lsum(n_params), "attn": lsum(lambda l: n_params(l.self_attn)), "ffn": lsum(lambda l: n_params(l.mlp)),
        "norm1": lsum(lambda l: n_params(l.input_layernorm)), "norm2": lsum(lambda l: n_params(l.post_attention_layernorm)),
        "q-proj": lsum(lambda l: n_params(l.self_attn.q_proj)), "k-proj": lsum(lambda l: n_params(l.self_attn.k_proj)),
        "v-proj": lsum(lambda l: n_params(l.self_attn.v_proj)), "o-proj": lsum(lambda l: n_params(l.self_attn.o_proj)),
    }
    if c["kind"] == "mixtral":
        # HF guarda los expertos fusionados: gate_up_proj (E, 2·D_mlp, D) = [W_gate; W_up] (w1 y w3 del oficial), down_proj (E, D, D_mlp)
        pb.update({
            "router": lsum(lambda l: n_params(l.mlp.gate)), "experts": lsum(lambda l: n_params(l.mlp.experts)),
            "gate-proj": lsum(lambda l: l.mlp.experts.gate_up_proj.numel() // 2), "up-proj": lsum(lambda l: l.mlp.experts.gate_up_proj.numel() // 2),
            "down-proj": lsum(lambda l: l.mlp.experts.down_proj.numel()),
        })
    else:
        pb.update({"gate-proj": lsum(lambda l: n_params(l.mlp.gate_proj)), "up-proj": lsum(lambda l: n_params(l.mlp.up_proj)),
                   "down-proj": lsum(lambda l: n_params(l.mlp.down_proj))})
    params_total = n_params(model)

    # ---- prefill de T tokens
    T = T_DEFAULT
    flops, by_op, by_mod, shapes, kv_elems = forward(model, c, T)
    fbn = {"attn": module_flops(by_mod, cls, c, "self_attn"), "ffn": module_flops(by_mod, cls, c, "mlp"),
           "lm-head": by_mod.get(f"{cls}.lm_head", 0)}
    if c["kind"] == "mixtral":
        fbn["router"] = module_flops(by_mod, cls, c, "mlp.gate")
        fbn["experts"] = module_flops(by_mod, cls, c, "mlp.experts")
    groups = [{"ops": ["aten.mm"], "prims": ["linear", "lm_head"] + (["moe_router"] if c["kind"] == "mixtral" else [])},
              {"ops": ["aten.bmm"], "prims": ["attention_scores", "attention_weighted_sum"] + (["expert_linear"] if c["kind"] == "mixtral" else [])}]
    assert set(by_op) <= {"aten.mm", "aten.bmm"}, by_op
    # sdpa (math en meta; la fórmula de FlopCounterMode para sdpa tampoco tiene término causal): mismo total que eager
    model.config._attn_implementation = "sdpa"
    flops_sdpa = forward(model, c, T_SMALL, record=False)[0]
    model.config._attn_implementation = "eager"
    flops_small, _, _, shapes_small, _ = forward(model, c, T_SMALL)

    # ---- decode: 1 token con ctx − 1 filas en la KV cache
    ctx = CTX_DEFAULT
    flops_dec, by_op_dec, _, shapes_dec, _ = forward(model, c, 1, past=ctx - 1)
    pick = ["x0", "q", "k", "q-rope", "k-rope", "k-ctx", "v-ctx", "attn", "z", "o", "h-norm2", "f", "x-out", "logits"]
    pick += ["router-logits", "x-routed", "gate", "expert-out"] if c["kind"] == "mixtral" else ["gate", "prod"]

    override_checks = [
        {"calc_overrides": {"T": T_SMALL}, "flops_total": flops_small, "flops_total_sdpa": flops_sdpa,
         "shapes": {k: shapes_small[k] for k in ("x0", "q-rope", "k-rope", "attn", "logits") if k in shapes_small}},
        {"calc_overrides": {"decode": 1, "ctx": ctx}, "params_total": params_total, "flops_total": flops_dec, "flops_by_op_torch": by_op_dec,
         "shapes": {k: shapes_dec[k] for k in pick if k in shapes_dec}},
    ]
    if config_id == "llama3-8b":
        for G in (32, 1):     # what-if MHA y MQA: otro modelo HF con num_key_value_heads = G
            mg = build(c, G)
            fg, _, _, sg, _ = forward(mg, c, T)
            override_checks.append({"calc_overrides": {"nKV": G}, "params_total": n_params(mg), "flops_total": fg, "ctor": ctor_text(c, G),
                                    "shapes": {k: sg[k] for k in ("k", "v", "k-rope", "v-heads", "attn")}})
            del mg

    experts_params = pb.get("experts", 0)
    active = params_total - (experts_params * (c["E"] - c["k"]) // c["E"] if c["kind"] == "mixtral" else 0)
    kv_bytes_per_token = kv_elems * 2 // T          # bf16: 2 bytes por elemento; todas las capas
    shapes["ids"] = [T]

    notes = [
        "Modelo construido en código en el dispositivo meta (sin pesos ni memoria, sin hub): parámetros exactos con sum(p.numel()).",
        f"FLOPs = FlopCounterMode sobre tensores meta con las {L} capas (no se extrapola desde un modelo chico); prefill de T = {T} tokens, decode con ctx = {ctx} (ctx − 1 filas en la caché + el token nuevo).",
        "Los tensores meta no permiten construir la máscara causal (HF llama .item()): se pasa una máscara 4-D de ceros ya armada; la máscara es una suma y no cambia los FLOPs.",
        "La máscara causal NO divide el conteo: eager calcula QKᵀ y A·V con las T² entradas y la fórmula de sdpa de FlopCounterMode no tiene término causal (flops_total_sdpa = eager). El trabajo útil es T(T+1)/2 por cabeza (metrics().prefillScoreMacsCausal).",
        "El LM head corre sobre las T posiciones (logits T×V, logits_to_keep = 0); al servir solo hace falta la última fila (metrics().prefillMacsLastLogits).",
        "Sin sesgos (attention_bias = mlp_bias = False); RMSNorm solo con γ; embedding y LM head sin atar (tie_word_embeddings = False).",
    ]
    if config_id.startswith("llama3"):
        notes.append("Vocabulario: el paper (Tabla 3) dice 128K (128,000 tokens del tokenizer); el config de HF tiene 128,256 (256 especiales reservados): el calculador usa 128,256.")
        notes.append("Contexto 8,192 (Llama 3). Llama 3.1 usa los mismos tamaños y llega a 128K con rope_type 'llama3' (factor 8): no cambia ni parámetros ni FLOPs a igual T.")
    if config_id == "llama2-7b":
        notes.append("Llama 2 7B usa MHA (num_key_value_heads = 32): el paper aplica GQA solo a 34B y 70B (Tabla 1).")
    if c["kind"] == "mixtral":
        notes.append("HF guarda los 8 expertos fusionados: gate_up_proj (8, 2·14,336, 4096) = [w1; w3] del oficial y down_proj (8, 4096, 14,336) = w2: el mismo conteo; params_by_node reparte gate_up_proj en mitades.")
        notes.append("Router: softmax sobre los 8 logits, top-2 y renormalizar (HF) = softmax sobre los 2 logits elegidos (paper, ec. 2): mismo resultado, sin MACs extra.")
        notes.append("MoE con experts_implementation = 'batched_mm' (funciona en meta): FlopCounterMode cuenta router (T·D·E) + SOLO los k = 2 expertos de cada token (bmm sobre las 2T filas). moe_impl_check: con la implementación eager (bucle por experto sobre los tokens enrutados) el conteo es idéntico; grouped_mm no se cuenta (aten._grouped_mm sin fórmula).")
        notes.append(f"Parámetros activos por token = total − (E − k)/E de los expertos = {active:,} (el paper: 13B activos de 47B).")

    data = {
        "config_id": config_id,
        "model": "llm",
        "T": T, "ctx": ctx,
        "params_total": params_total,
        "params_by_node": pb,
        "shapes": {k: v for k, v in shapes.items()},
        "flops_total": flops,
        "flops_by_node": fbn,
        "flops_by_op_torch": by_op,
        "flops_by_op_groups": groups,
        "override_checks": override_checks,
        "metrics_checks": {"kvBytesPerToken": kv_bytes_per_token, "activeParams": active, "totalParams": params_total},
        "not_hooked": NOT_HOOKED,
        "hf_config_source": c["hf"],
        "source": {"lib": "transformers", "version": transformers.__version__, "ctor": ctor_text(c),
                   "attn_implementation": "eager", "experts_implementation": "batched_mm" if c["kind"] == "mixtral" else None,
                   "versions": versions()},
        "notes": notes,
    }
    if c["kind"] == "mixtral":
        data["moe_impl_check"] = moe_impl_check()
    write_expected(config_id, data)


if __name__ == "__main__":
    for cid in CONFIGS:
        print(f"▸ {cid}", flush=True)
        run(cid)
