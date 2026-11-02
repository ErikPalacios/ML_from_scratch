"""Cross-check de los modelos `lora` y `rlhf-dpo` (SPEC §22): HF LlamaForCausalLM / LlamaForSequenceClassification (Llama 3 8B)
construidos en código en el dispositivo META (sin pesos en memoria, sin hub) + peft get_peft_model(LoraConfig(...)).
Escribe crosscheck/expected/{lora-llama3-8b-r16, lora-llama3-8b-r16-qv, lora-llama3-8b-r64, qlora-llama3-8b-r16, full-ft-llama3-8b,
rlhf-llama3-8b, dpo-llama3-8b, grpo-llama3-8b, ppo-llama3-8b-lora, dpo-llama3-8b-lora}.json.

- Parámetros: sum(p.numel()) del modelo meta (= "all params" de print_trainable_parameters); entrenables con
  get_nb_trainable_parameters (EXACTOS).
- FLOPs del forward: FlopCounterMode sobre tensores meta con las 32 capas (máscara 4-D de ceros ya armada: no cambia FLOPs).
- Paso de entrenamiento: forward en modo train + loss.backward() (pérdida = suma de los logits en fp32: no tiene matmuls)
  bajo FlopCounterMode → forward + backward exactos. Gradient checkpointing con use_reentrant = True (recomputación completa:
  la convención del calculador); se registra también el default de HF 5 (use_reentrant = False), que recorta la recomputación.
- QLoRA: bitsandbytes no corre en este Mac (sin CUDA): la contabilidad NF4 + doble cuantización se hace aquí recorriendo las
  nn.Linear reales de los bloques (bnb Linear4bit las reemplaza; lm_head y embedding quedan en bf16) con las reglas de
  bitsandbytes.functional.quantize_4bit (bloques de 64; compress_statistics: absmax en 8 bits por bloque de 256 + absmax fp32
  de 2.º nivel + 1 offset fp32 por matriz) — la misma cuenta que el paper (§3: 0.5 → 0.127 bits por parámetro).
- RLHF / DPO / GRPO: un modelo HF por rol (política y referencia LlamaForCausalLM; reward model y crítico
  LlamaForSequenceClassification con num_labels = 1, como TRL); DPO = batch de 2 (elegida + rechazada), GRPO = batch de G; con
  LoRA la referencia = el mismo PeftModel dentro de disable_adapter().
- loss_checks: pérdidas (Bradley-Terry, DPO, PPO-clip, KL k1 / k3, ventaja de GRPO, GAE) en torch float64 desde las ecuaciones
  de los papers (DPO con la forma "sigmoid" de TRL: −logsigmoid(β·(logratios_π − logratios_ref))) ↔ ATLAS.Arch.finetune.

Uso: .venv/bin/python crosscheck/finetune.py
"""
import math
import os

import torch
import torch.nn.functional as F
from torch.utils.flop_counter import FlopCounterMode

from common import n_params, versions, write_expected

import transformers  # noqa: E402
import peft  # noqa: E402
from peft import LoraConfig, get_peft_model  # noqa: E402
from transformers import LlamaConfig, LlamaForCausalLM, LlamaForSequenceClassification  # noqa: E402

# Llama 3 8B (= CONFIGS['llama3-8b'] de crosscheck/llm.py y js/arch/llm.js)
LLAMA = dict(D=4096, L=32, h=32, G=8, dh=128, Dmlp=14336, V=128256, ctx_max=8192, theta=500000.0, eps=1e-5)
ALL7 = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
QV = ["q_proj", "v_proj"]
ATTN4 = ["q_proj", "k_proj", "v_proj", "o_proj"]
PEFT_TO_ID = {"q_proj": "q", "k_proj": "k", "v_proj": "v", "o_proj": "o", "gate_proj": "gate", "up_proj": "up", "down_proj": "down"}
# Deben coincidir con js/arch/finetune.js
LORA = {
    "lora-llama3-8b-r16": dict(r=16, alpha=32, p=0.05, targets=ALL7, T=2048),
    "lora-llama3-8b-r16-qv": dict(r=16, alpha=32, p=0.05, targets=QV, T=2048),
    "lora-llama3-8b-r64": dict(r=64, alpha=128, p=0.05, targets=ALL7, T=2048),
    "qlora-llama3-8b-r16": dict(r=16, alpha=32, p=0.05, targets=ALL7, T=2048, nf4=True),
    "full-ft-llama3-8b": dict(full=True, T=2048),
}
RL = {
    "rlhf-llama3-8b": dict(method="ppo", T=1024),
    "dpo-llama3-8b": dict(method="dpo", T=1024),
    "grpo-llama3-8b": dict(method="grpo", T=1024, G=8),
    "ppo-llama3-8b-lora": dict(method="ppo", T=1024, lora=dict(r=16, alpha=32, p=0.05, targets=ALL7)),
    "dpo-llama3-8b-lora": dict(method="dpo", T=1024, lora=dict(r=16, alpha=32, p=0.05, targets=ALL7)),
}


def hf_config(num_labels=None):
    c = LLAMA
    kw = dict(vocab_size=c["V"], hidden_size=c["D"], intermediate_size=c["Dmlp"], num_hidden_layers=c["L"], num_attention_heads=c["h"],
              num_key_value_heads=c["G"], head_dim=c["dh"], max_position_embeddings=c["ctx_max"], rms_norm_eps=c["eps"], rope_theta=c["theta"],
              tie_word_embeddings=False, attention_bias=False, mlp_bias=False)
    if num_labels is not None:
        kw["num_labels"] = num_labels
    return LlamaConfig(**kw)


def ctor(kind):
    keys = ["vocab_size", "hidden_size", "intermediate_size", "num_hidden_layers", "num_attention_heads", "num_key_value_heads", "head_dim",
            "max_position_embeddings", "rms_norm_eps", "tie_word_embeddings", "attention_bias", "mlp_bias"]
    cfg = hf_config(1 if kind == "seqcls" else None)
    args = ", ".join(f"{k}={getattr(cfg, k)!r}" for k in keys) + f", rope_theta={LLAMA['theta']!r}" + (", num_labels=1" if kind == "seqcls" else "")
    cls = "LlamaForSequenceClassification" if kind == "seqcls" else "LlamaForCausalLM"
    return f"with torch.device('meta'): {cls}(LlamaConfig({args}))"


def build(kind="lm", lora=None, ckpt=None):
    with torch.device("meta"):
        m = (LlamaForSequenceClassification if kind == "seqcls" else LlamaForCausalLM)(hf_config(1 if kind == "seqcls" else None))
    m.config._attn_implementation = "eager"
    if ckpt is not None:
        m.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": ckpt == "reentrant"})
    if lora:
        m = get_peft_model(m, LoraConfig(r=lora["r"], lora_alpha=lora["alpha"], lora_dropout=lora["p"], target_modules=lora["targets"], bias="none"))
    return m


def lora_ctor(lora):
    return (f"get_peft_model(model, LoraConfig(r={lora['r']}, lora_alpha={lora['alpha']}, lora_dropout={lora['p']}, "
            f"target_modules={lora['targets']!r}, bias='none'))")


def inputs(S, T):
    return dict(input_ids=torch.zeros(S, T, dtype=torch.long, device="meta"), attention_mask=torch.zeros(S, 1, T, T, device="meta"),
                position_ids=torch.arange(T, device="meta")[None].expand(S, T), use_cache=False)


class Rec:
    """Formas por id de tensor del calculador (sin la dimensión de batch S)."""

    def __init__(self, S=1):
        self.S, self.raw, self.handles = S, {}, []

    def hook(self, model, name, where, tid, idx=None):
        m = dict(model.named_modules())[name]
        S = self.S

        def put(shape):
            s = list(shape)
            assert s[0] == S, f"se esperaba batch {S} en {tid}: {s}"
            self.raw.setdefault(tid, s[1:])
        if where == "out":
            self.handles.append(m.register_forward_hook(lambda mod, inp, out: put((out[idx] if idx is not None else (out[0] if isinstance(out, tuple) else out)).shape)))
        else:
            self.handles.append(m.register_forward_pre_hook(lambda mod, inp: put(inp[0].shape)))

    def remove(self):
        for h in self.handles:
            h.remove()


def attach(model, rec, pre="", lora=None, seqcls=False, mprefix=None):
    """Hooks de la capa 0 (y de la salida) con los ids de F6; con LoRA, los del adaptador (X-base, X-drop, X-lora-a, X-lora-b)."""
    mp = mprefix if mprefix is not None else ("base_model.model." if lora else "")
    L = LLAMA["L"]
    lay = mp + "model.layers.0."
    rec.hook(model, mp + "model.embed_tokens", "out", pre + "x0")
    rec.hook(model, lay + "input_layernorm", "out", pre + "h-norm1")
    mods = {"q": "self_attn.q_proj", "k": "self_attn.k_proj", "v": "self_attn.v_proj", "o": "self_attn.o_proj",
            "gate": "mlp.gate_proj", "up": "mlp.up_proj", "down": "mlp.down_proj"}
    outs = {"q": "q", "k": "k", "v": "v", "o": "o", "gate": "gate", "up": "up", "down": "f"}
    tg = set(PEFT_TO_ID[t] for t in (lora["targets"] if lora else []))
    for x, mod in mods.items():
        rec.hook(model, lay + mod, "out", pre + outs[x])
        if x in tg:
            rec.hook(model, lay + mod + ".base_layer", "out", pre + x + "-base")
            if lora["p"] > 0:
                rec.hook(model, lay + mod + ".lora_dropout.default", "out", pre + x + "-drop")
            rec.hook(model, lay + mod + ".lora_A.default", "out", pre + x + "-lora-a")
            rec.hook(model, lay + mod + ".lora_B.default", "out", pre + x + "-lora-b")
    rec.hook(model, lay + "self_attn.o_proj", "in", pre + "z")
    rec.hook(model, lay + "post_attention_layernorm", "in", pre + "r1")
    rec.hook(model, lay + "post_attention_layernorm", "out", pre + "h-norm2")
    rec.hook(model, lay + "mlp.down_proj", "in", pre + "prod")
    rec.hook(model, mp + f"model.layers.{L - 1}", "out", pre + "x-out")
    rec.hook(model, mp + "model.norm", "out", pre + "x-norm")
    if not seqcls:
        rec.hook(model, mp + "lm_head", "out", pre + "logits")


def fwd_flops(model, S, T, rec=None):
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = model(**inputs(S, T))
    counts = fcm.get_flop_counts()
    by_op = {str(k): int(v) for k, v in counts.get("Global", {}).items()}
    by_mod = {k: sum(int(v) for v in d.values()) for k, d in counts.items() if k != "Global"}
    return int(fcm.get_total_flops()), dict(sorted(by_op.items())), by_mod, out


def step_flops(model, T, seqcls=False):
    """Forward (train) + backward de UNA secuencia: (FLOPs del forward, FLOPs del backward incluida la recomputación)."""
    model.train()
    f1 = FlopCounterMode(display=False)
    with f1:
        out = model(**inputs(1, T))
    f2 = FlopCounterMode(display=False)
    with f2:
        out.logits.float().sum().backward()
    return int(f1.get_total_flops()), int(f2.get_total_flops())


def sum_mod(by_mod, pat):
    return sum(v for k, v in by_mod.items() if k.endswith(pat) or ("." + pat + ".") in (k + "."))


def layer_sum(by_mod, sub):
    """FLOPs de un submódulo sumados sobre las L capas (claves …model.layers.i.<sub>)."""
    return sum(v for k, v in by_mod.items() if any(k.endswith(f"model.layers.{i}.{sub}") for i in range(LLAMA["L"])))


def lora_params_by_node(model, lora):
    named = dict(model.named_parameters())
    tg = set(lora["targets"]) if lora else set()
    out = {"lora-a": 0, "lora-b": 0, "w-frozen": 0}
    for n, p in named.items():
        if ".lora_A." in n:
            out["lora-a"] += p.numel()
        elif ".lora_B." in n:
            out["lora-b"] += p.numel()
        elif ".base_layer." in n:
            out["w-frozen"] += p.numel()
    for t in ALL7:
        out[t.replace("_", "-")] = sum(p.numel() for n, p in named.items() if f".{t}." in n)
    out["embed"] = sum(p.numel() for n, p in named.items() if "embed_tokens" in n)
    out["lm-head"] = sum(p.numel() for n, p in named.items() if "lm_head" in n)
    out["attn"] = sum(p.numel() for n, p in named.items() if ".self_attn." in n)
    out["ffn"] = sum(p.numel() for n, p in named.items() if ".mlp." in n)
    if not lora:
        for k in ("lora-a", "lora-b", "w-frozen"):
            out.pop(k)
    return {k: int(v) for k, v in out.items()}


def nf4_bytes(model, dq=True):
    """Bytes de la base con las nn.Linear de los bloques en NF4 (reglas de bitsandbytes.quantize_4bit) y el resto en bf16."""
    lin, other, const = 0, 0, 0
    for name, mod in model.named_modules():
        if isinstance(mod, torch.nn.Linear) and ".layers." in name and "lora_" not in name:
            n = mod.weight.numel()
            blocks = math.ceil(n / 64)
            c = (blocks * 1 + math.ceil(blocks / 256) * 4 + 4) if dq else blocks * 4
            lin += math.ceil(n / 2) + c
            const += c
    for name, p in model.named_parameters():
        if "lora_" in name:
            continue
        is_block_linear = ".layers." in name and name.endswith(".weight") and any(f".{t}." in name for t in ALL7)
        if not is_block_linear:
            other += 2 * p.numel()
    return lin + other, const


def lora_shapes_spec_notes():
    return {
        "ids": "entrada (input_ids)",
        "X-lora-delta": "lora_B(…) * scaling dentro de LoraLayer.forward (no es un módulo): misma forma que X-lora-b",
        "q-heads / q-rope / scores / attn / z-heads": "ver crosscheck/llm.py (mismo decoder de F6)",
    }


def run_lora(cid):
    c = LORA[cid]
    T = c["T"]
    full = c.get("full", False)
    lora = None if full else dict(r=c["r"], alpha=c["alpha"], p=c["p"], targets=c["targets"])
    m = build("lm", lora)
    params_total = n_params(m)
    trainable, all_params = (m.get_nb_trainable_parameters() if lora else (params_total, params_total))
    pbn = lora_params_by_node(m, lora)
    rec = Rec(1)
    attach(m, rec, lora=lora)
    flops, by_op, by_mod, _ = fwd_flops(m, 1, T)
    rec.remove()
    assert set(by_op) <= {"aten.mm", "aten.bmm"}, by_op
    fbn = {"attn": layer_sum(by_mod, "self_attn"), "ffn": layer_sum(by_mod, "mlp"), "lm-head": sum_mod(by_mod, "lm_head")}
    if lora:
        fbn["lora-a"] = sum(v for k, v in by_mod.items() if k.endswith("lora_A.default"))
        fbn["lora-b"] = sum(v for k, v in by_mod.items() if k.endswith("lora_B.default"))
        fbn["w-frozen"] = sum(v for k, v in by_mod.items() if k.endswith(".base_layer"))
    shapes = dict(rec.raw)
    shapes["ids"] = [T]
    # paso de entrenamiento (forward + backward): sin checkpointing, con checkpointing reentrante (convención) y el default de HF 5
    f_fwd, f_bwd = step_flops(build("lm", lora), T)
    assert f_fwd == flops, (f_fwd, flops)
    _, f_bwd_ck = step_flops(build("lm", lora, ckpt="reentrant"), T)
    _, f_bwd_nr = step_flops(build("lm", lora, ckpt="nonreentrant"), T)
    T2 = 512
    f_fwd2, f_bwd2 = step_flops(build("lm", lora), T2)
    metrics = {"forwardMacsPerSeq": flops // 2, "trainStepMacsPerSeq": (f_fwd + f_bwd) // 2, "trainableParams": int(trainable), "allParams": int(all_params)}
    notes = [
        "Modelo construido en código en el dispositivo meta (sin pesos ni memoria, sin hub): parámetros exactos con sum(p.numel()).",
        f"FLOPs = FlopCounterMode sobre tensores meta con las {LLAMA['L']} capas; una secuencia de T = {T} tokens, atención eager, máscara 4-D de ceros ya armada (no cambia FLOPs).",
        "Paso de entrenamiento = forward en modo train + backward de la suma de los logits en fp32 (la pérdida no tiene matmuls): FlopCounterMode cuenta los matmuls de dX y dW que autograd realmente calcula.",
        f"Gradient checkpointing (metrics_override_checks gradCkpt = 1) con use_reentrant = True: recomputa el forward completo de cada capa. El default de HF 5 (use_reentrant = False) corta la recomputación en el último tensor guardado: backward = {f_bwd_nr:,} FLOPs vs {f_bwd_ck:,} reentrante (diferencia {f_bwd_ck - f_bwd_nr:,}).",
    ]
    if lora:
        notes.insert(1, f"PEFT {peft.__version__}: {lora_ctor(lora)}; print_trainable_parameters → trainable params: {trainable:,} || all params: {all_params:,} || trainable%: {100 * trainable / all_params:.4f}.")
        notes.append("LoRA: las W₀ congeladas calculan dX (para que el gradiente llegue a los adaptadores de abajo) pero no dW; en la capa 1 la entrada (embedding congelado) no requiere gradiente → sin dX allí; con gradient checkpointing PEFT llama enable_input_require_grads y la capa 1 también los calcula.")
        notes.append(f"lora_dropout = {lora['p']}: PEFT aplica un dropout por adaptador a SU entrada (0 FLOPs; el calculador lo cuenta en las activaciones).")
    else:
        notes.append("Full FT: backward = 2 × forward exacto (dX y dW de cada matmul; el embedding entrenable hace que la capa 1 también calcule dX).")
    data = {
        "config_id": cid, "model": "lora", "T": T,
        "params_total": params_total, "params_by_node": pbn, "shapes": shapes,
        "flops_total": flops, "flops_by_node": fbn, "flops_by_op_torch": by_op,
        "flops_train_step": {"forward": f_fwd, "backward": f_bwd, "backward_ckpt_reentrant": f_bwd_ck, "backward_ckpt_nonreentrant_hf_default": f_bwd_nr},
        "metrics_checks": metrics,
        "metrics_override_checks": [
            {"calc_overrides": {"gradCkpt": 1}, "metrics": {"trainStepMacsPerSeq": (f_fwd + f_bwd_ck) // 2, "forwardMacsPerSeq": f_fwd // 2}},
            {"calc_overrides": {"T": T2}, "metrics": {"trainStepMacsPerSeq": (f_fwd2 + f_bwd2) // 2, "forwardMacsPerSeq": f_fwd2 // 2}},
        ],
        "not_hooked": lora_shapes_spec_notes(),
        "source": {"lib": "transformers + peft", "version": transformers.__version__, "peft": peft.__version__, "ctor": ctor("lm") + ("; " + lora_ctor(lora) if lora else ""),
                   "attn_implementation": "eager", "versions": dict(versions(), peft=peft.__version__)},
        "notes": notes,
    }
    if lora:
        print_line = f"trainable params: {trainable:,} || all params: {all_params:,} || trainable%: {100 * trainable / all_params:.4f}"
        data["print_trainable_parameters"] = print_line
        # override_checks: otro r y otras matrices (otro PeftModel)
        oc = []
        if cid == "lora-llama3-8b-r16":
            for ov, lo in (({"r": 8}, dict(lora, r=8, alpha=16)), ({"targets": 4}, dict(lora, targets=ATTN4)), ({"targets": 2}, dict(lora, targets=QV))):
                mm = build("lm", lo)
                ff, _, _, _ = fwd_flops(mm, 1, T)
                oc.append({"calc_overrides": ov, "params_total": n_params(mm), "flops_total": ff, "ctor": lora_ctor(lo)})
                del mm
        data["override_checks"] = oc
    if cid == "lora-llama3-8b-r16":
        data["activation_checks"] = activation_checks()
        notes.append("activation_checks: bytes guardados por token y por capa MEDIDOS en un Llama diminuto real (CPU, bf16, sdpa) = la fórmula del calculador (HF: RMSNorm guarda una copia fp32 de su entrada + rstd; SDPA guarda Q, K, V, la salida y el logsumexp; con lora_dropout > 0 cada adaptador guarda su copia con dropout + la máscara).")
    if c.get("nf4"):
        b_dq, const_dq = nf4_bytes(build("lm", None), dq=True)
        b_nodq, const_nodq = nf4_bytes(build("lm", None), dq=False)
        nlin = sum(mod.weight.numel() for name, mod in build("lm", None).named_modules() if isinstance(mod, torch.nn.Linear) and ".layers." in name)
        data["nf4_accounting"] = {
            "rule": "bitsandbytes.functional.quantize_4bit(blocksize=64, quant_type='nf4', compress_statistics=True): 4 bits por peso; absmax por bloque de 64 → 8 bits (quantize_blockwise con bloques de 256, tras restar la media: 1 offset fp32 por matriz) + 1 absmax fp32 por bloque de 256; sin compress_statistics, absmax fp32 por bloque de 64. Solo las nn.Linear de los bloques (Linear4bit); embedding, lm_head y RMSNorm en bf16.",
            "block_linear_params": nlin, "const_bytes_dq": const_dq, "const_bytes_no_dq": const_nodq,
            "const_bits_per_param_dq": 8 * const_dq / nlin, "const_bits_per_param_no_dq": 8 * const_nodq / nlin,
            "paper": "QLoRA §3 (Double Quantization): 32/64 = 0.5 bits por parámetro → 8/64 + 32/(64·256) = 0.127",
        }
        data["metrics_checks"].update({"baseWeightBytes": b_dq, "baseWeightBytes4NoDQ": b_nodq, "quantConstBytes": const_dq})
        notes.append("QLoRA: bitsandbytes no corre en este Mac; parámetros y FLOPs = los de LoRA r 16 (la cuantización no cambia ninguno: los matmuls corren en bf16 tras descuantizar). Los bytes NF4 + DQ se calculan aquí sobre las nn.Linear reales (nf4_accounting) y se comparan con metrics().baseWeightBytes.")
    write_expected(cid, data)


def role_model(role, lora=None, ckpt=None):
    m = build("seqcls" if role in ("reward", "critic") else "lm", lora if role in ("policy", "critic") else None, ckpt)
    if lora and role == "critic":
        # la cabeza de valor se entrena (TRL / PEFT: modules_to_save; aquí requires_grad directo para no duplicar sus 4,096 pesos)
        m.base_model.model.score.weight.requires_grad_(True)
    return m


def run_rl(cid):
    c = RL[cid]
    T, method = c["T"], c["method"]
    S = 2 if method == "dpo" else (c.get("G", 1) if method == "grpo" else 1)
    lora = c.get("lora")
    roles = ["policy", "reference", "reward", "critic"] if method == "ppo" else ["policy", "reference"]
    pre = {"policy": "pol-", "reference": "ref-", "reward": "rm-", "critic": "cr-"}
    shapes, flops_total, fbn, pbn, by_op_all = {}, 0, {}, {}, {}
    params_total = 0
    models = {}
    for role in roles:
        if lora and role == "reference":
            m = models["policy"]          # la misma base con los adaptadores apagados
        else:
            m = role_model(role, lora)
        models[role] = m
        seq = role in ("reward", "critic")
        rec = Rec(S)
        mp = "base_model.model." if (lora and role in ("policy", "reference", "critic")) else ""
        attach(m, rec, pre=pre[role], lora=lora if (lora and role in ("policy", "critic")) else None, seqcls=seq, mprefix=mp)
        if seq:
            rec.hook(m, mp + "score", "out", "reward-scores" if role == "reward" else "critic-values")
        if lora and role == "reference":
            with m.disable_adapter():
                f, by_op, _, out = fwd_flops(m, S, T)
            pbn[role] = 0
        else:
            f, by_op, _, out = fwd_flops(m, S, T)
            pbn[role] = n_params(m)
            params_total += n_params(m)
        rec.remove()
        shapes.update(rec.raw)
        if role == "reward":
            shapes["reward"] = list(out.logits.shape[1:])     # pooled: el último token
        fbn[role] = f
        flops_total += f
        for k, v in by_op.items():
            by_op_all[k] = by_op_all.get(k, 0) + v
    shapes["ids"] = [T]
    # costo del update por secuencia (gradient checkpointing reentrante: la config usa gradCkpt = 1)
    pol_fwd, pol_bwd = step_flops(role_model("policy", lora, ckpt="reentrant"), T)
    metrics = {"policyTrainStepMacsPerSeq": (pol_fwd + pol_bwd) // 2, "policyForwardMacsPerSeq": pol_fwd // 2, "totalParams": params_total}
    if method == "ppo":
        cm = role_model("critic", lora, ckpt="reentrant")
        cm.train()
        base = cm.base_model.model if lora else cm
        f1 = FlopCounterMode(display=False)
        with f1:
            out = base.model(**{k: v for k, v in inputs(1, T).items()})
            vals = base.score(out.last_hidden_state)
        f2 = FlopCounterMode(display=False)
        with f2:
            vals.float().sum().backward()
        metrics["criticTrainStepMacsPerSeq"] = (int(f1.get_total_flops()) + int(f2.get_total_flops())) // 2
        metrics["rewardParams"] = pbn["reward"]
        metrics["criticParams"] = pbn["critic"]
    if lora:
        metrics["trainableParams"] = int(models["policy"].get_nb_trainable_parameters()[0]) + (int(models["critic"].get_nb_trainable_parameters()[0]) if "critic" in models else 0)
    notes = [
        "Un modelo HF por rol, construido en código en el dispositivo meta (sin pesos ni hub): política y referencia LlamaForCausalLM; reward model y crítico LlamaForSequenceClassification(num_labels = 1) = el decoder sin lm_head + score (Linear D → 1 sin sesgo), como TRL.",
        f"FLOPs = la suma de los forwards de cada rol sobre {'el par (batch 2: elegida + rechazada, como concatenated_forward de TRL)' if method == 'dpo' else ('las G = ' + str(S) + ' respuestas del prompt (batch G)') if method == 'grpo' else 'la secuencia prompt + respuesta'} con T = {T} (FlopCounterMode, todas las capas, atención eager).",
        "El rollout (generación) no está en el grafo: el calculador lo cuenta con llm.js (prefill + decode, verificados en crosscheck/llm.py).",
        "metrics_checks: costo de UN update de la política (y del crítico en PPO) por secuencia con gradient checkpointing reentrante (forward + backward + recomputación), medido con loss.backward().",
    ]
    if lora:
        notes.append("Con LoRA la referencia es el mismo PeftModel dentro de disable_adapter(): no suma parámetros (paramRepeat 0 en el calculador) y su forward no pasa por los adaptadores.")
    if lora and method == "ppo":
        notes.append("PPO + LoRA: política y crítico con adaptadores r 16 en las 7 lineales; la cabeza de valor (score) también se entrena (requires_grad; en TRL / PEFT, modules_to_save, que además guarda una copia de sus 4,096 pesos: no contada); el reward model queda congelado aparte.")
    if method == "ppo":
        notes.append("Crítico: TRL llama value_model.score(hidden) sobre TODAS las posiciones (valores T×1); el reward model usa el score del último token (pooled_logits de HF).")
    data = {
        "config_id": cid, "model": "rlhf-dpo", "T": T, "sequences": S,
        "params_total": params_total, "params_by_node": pbn, "shapes": shapes,
        "flops_total": flops_total, "flops_by_node": fbn, "flops_by_op_torch": dict(sorted(by_op_all.items())),
        "metrics_checks": metrics,
        "source": {"lib": "transformers + peft", "version": transformers.__version__, "peft": peft.__version__,
                   "ctor": ctor("lm") + "; " + ctor("seqcls") + ("; " + lora_ctor(lora) if lora else ""),
                   "attn_implementation": "eager", "versions": dict(versions(), peft=peft.__version__)},
        "notes": notes,
    }
    if cid == "rlhf-llama3-8b":
        data["loss_checks"] = loss_checks()
    write_expected(cid, data)


def activation_checks():
    """Bytes que guarda el backward por token y por capa, MEDIDOS (torch.autograd.graph.saved_tensors_hooks, sin parámetros, sin
    repetir almacenamientos) en un Llama diminuto con pesos reales en CPU (bf16, sdpa, GQA), como la diferencia entre 3 y 2 capas
    (una capa de régimen) ↔ ATLAS.Arch.finetune.activationPerTokenLayer con maskBytes = 2 (en CPU la máscara del dropout es
    bf16; en CUDA native_dropout la guarda como bool de 1 byte, el valor por defecto del calculador)."""
    D, h, G, dh, F, V, T, r = 64, 4, 2, 16, 160, 100, 16, 4

    def measure(L, lora):
        torch.manual_seed(0)
        cfg = LlamaConfig(vocab_size=V, hidden_size=D, intermediate_size=F, num_hidden_layers=L, num_attention_heads=h, num_key_value_heads=G,
                          head_dim=dh, tie_word_embeddings=False)
        m = LlamaForCausalLM(cfg).to(torch.bfloat16)
        m.config._attn_implementation = "sdpa"
        if lora:
            m = get_peft_model(m, LoraConfig(r=r, lora_alpha=2 * r, lora_dropout=lora["p"], target_modules=lora["targets"]), autocast_adapter_dtype=False)
        m.train()
        params = {p.untyped_storage().data_ptr() for p in m.parameters()}
        seen = {}

        def pack(t):
            st = t.untyped_storage()
            k = st.data_ptr()
            if k not in params and k != 0:
                seen[k] = st.nbytes()
            return t
        ids = torch.randint(0, V, (1, T))
        with torch.autograd.graph.saved_tensors_hooks(pack, lambda t: t):
            m(input_ids=ids, use_cache=False)
        return sum(seen.values())
    out = []
    for name, lora in (("full", None), ("lora-all-p0", dict(p=0.0, targets=ALL7)), ("lora-all-p0.05", dict(p=0.05, targets=ALL7)), ("lora-qv-p0.05", dict(p=0.05, targets=QV))):
        per = (measure(3, lora) - measure(2, lora)) / T
        out.append({"case": name, "args": {"D": D, "Dkv": G * dh, "F": F, "h": h, "r": r, "full": lora is None,
                                           "adapted": [PEFT_TO_ID[t] for t in (lora["targets"] if lora else [])], "p": lora["p"] if lora else 0, "maskBytes": 2},
                    "measured_bytes_per_token_layer": per})
    return out


def loss_checks():
    """Referencias en float64 desde las ecuaciones (y la forma de TRL para DPO) ↔ ATLAS.Arch.finetune."""
    d = torch.float64
    out = []
    for rw, rl in ((1.3, 0.2), (-0.5, 0.7), (4.0, 4.0)):
        diff = torch.tensor(rw - rl, dtype=d)
        out.append({"fn": "bradleyTerry", "args": [rw, rl], "out": {"prob": float(torch.sigmoid(diff)), "loss": float(-F.logsigmoid(diff))}})
    for pc, pr, rc, rr, beta in ((-12.0, -15.0, -12.5, -14.0, 0.1), (-30.2, -28.9, -31.0, -29.5, 0.5), (-5.0, -5.0, -5.0, -5.0, 0.1)):
        pi_logratios = torch.tensor(pc - pr, dtype=d)
        ref_logratios = torch.tensor(rc - rr, dtype=d)
        logits = pi_logratios - ref_logratios
        loss = -F.logsigmoid(beta * logits)                     # TRL DPOTrainer, loss_type = "sigmoid", label_smoothing = 0
        out.append({"fn": "dpoLoss", "args": [{"piChosen": pc, "piRejected": pr, "refChosen": rc, "refRejected": rr, "beta": beta}],
                    "out": {"loss": float(loss), "rewardChosen": beta * (pc - rc), "rewardRejected": beta * (pr - rr), "prob": float(torch.sigmoid(beta * logits))}})
    for lp, old, adv in ((-1.0, -1.3, 2.0), (-1.0, -0.6, 2.0), (-2.0, -1.5, -1.0), (-0.2, -0.9, -0.5)):
        ratio = torch.exp(torch.tensor(lp - old, dtype=d))
        a = torch.tensor(adv, dtype=d)
        loss = -torch.min(ratio * a, torch.clamp(ratio, 0.8, 1.2) * a)
        out.append({"fn": "ppoClip", "args": [{"logp": lp, "oldLogp": old, "adv": adv, "eps": 0.2}], "out": {"ratio": float(ratio), "loss": float(loss)}})
    for lp, ref in ((-1.2, -1.0), (-0.3, -2.1)):
        x = torch.tensor(ref - lp, dtype=d)
        out.append({"fn": "klEstimators", "args": [lp, ref], "out": {"k1": float(-x), "k3": float(torch.exp(x) - x - 1)}})
    rewards = [1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.5, 0.0]
    r = torch.tensor(rewards, dtype=d)
    adv = (r - r.mean()) / (r.std() + 1e-4)                      # TRL GRPOTrainer (std con corrección de Bessel)
    out.append({"fn": "grpoAdvantages", "args": [rewards], "out": {"list": [float(x) for x in adv]}})
    rew = [0.0, -0.01, 0.02, -0.03, 1.2]
    val = [0.4, 0.5, 0.45, 0.6, 0.8]
    g, lam = 1.0, 0.95
    adv_g, last = [0.0] * len(rew), 0.0
    for t in reversed(range(len(rew))):                          # TRL PPOTrainer (bucle de GAE)
        nxt = val[t + 1] if t + 1 < len(rew) else 0.0
        delta = rew[t] + g * nxt - val[t]
        last = delta + g * lam * last
        adv_g[t] = last
    out.append({"fn": "gae", "args": [rew, val, {"gamma": g, "lambda": lam}], "out": {"advantages": adv_g, "returns": [a + v for a, v in zip(adv_g, val)]}})
    return out


if __name__ == "__main__":
    for cid in LORA:
        print(f"▸ {cid}", flush=True)
        run_lora(cid)
    for cid in RL:
        print(f"▸ {cid}", flush=True)
        run_rl(cid)
