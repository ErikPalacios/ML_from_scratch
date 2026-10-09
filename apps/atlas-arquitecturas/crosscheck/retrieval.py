"""Cross-check de los modelos `bert`, `retrieval` y `ann` (SPEC §23). Solo desarrollo; sin pesos, sin hub, sin red.

- BERT: HF BertForPreTraining(BertConfig(...)) en el dispositivo META (bert-base, bert-large): parámetros exactos (sum de
  p.numel(); el decoder del MLM está ATADO a los word embeddings y su sesgo es cls.predictions.bias), FLOPs con
  FlopCounterMode (2 por MAC; atención eager) por módulo, formas con hooks + un parche de eager_attention_forward.
  Sin máscara de atención (una secuencia sin relleno: la máscara sería una suma de ceros).
- Recuperación: HF DPRQuestionEncoder / DPRContextEncoder(DPRConfig()) (BertModel sin pooler, projection_dim 0) para DPR;
  BertModel(config de all-MiniLM-L6-v2) (con pooler, sin uso) + mean pooling + normalizar para Sentence-BERT;
  BertForSequenceClassification(config de ms-marco-MiniLM-L-6-v2, num_labels = 1) para el cross-encoder (también el reranker,
  corrido con un batch de k pares); BertModel(bert-base) + nn.Linear(768, 128, bias=False) para ColBERTv2 (HF_ColBERT del repo
  stanford-futuredata/ColBERT). La búsqueda exacta (q·Eᵀ contra N vectores meta), el top-k y MaxSim se corren en torch sobre
  tensores meta dentro de FlopCounterMode.
- ANN: el encoder de queries de DPR (meta) + la búsqueda reimplementada en torch meta (flat: q·Xᵀ; IVF: q·Cᵀ y las tablas ADC
  q·codebooks, por FlopCounterMode; HNSW: la cota ≈ del calculador, sin forma "exacta" que medir). FAISS 1.15.1 (faiss-cpu):
  índices chicos REALES (N = 20,000, d = 64) para verificar las fórmulas de bytes (serialize_index y los arreglos internos) y
  los conteos de distancias (hnsw_stats.ndis, indexIVF_stats.ndis) — escalan con N, d, M, n_list, m (fórmulas, no constantes).

Uso: .venv/bin/python crosscheck/retrieval.py
"""
import json
import math
import os
import subprocess
import sys

import numpy as np
import torch
from torch import nn
from torch.utils.flop_counter import FlopCounterMode

from common import n_params, versions, write_expected

from transformers import (BertConfig, BertForPreTraining, BertForSequenceClassification, BertModel, DPRConfig,  # noqa: E402
                          DPRContextEncoder, DPRQuestionEncoder)
from transformers.models.bert import modeling_bert  # noqa: E402


# ---------------------------------------------------------------- configs (deben coincidir con js/arch/retrieval.js)
ENC = {
    "base": dict(hidden_size=768, num_hidden_layers=12, num_attention_heads=12, intermediate_size=3072),
    "large": dict(hidden_size=1024, num_hidden_layers=24, num_attention_heads=16, intermediate_size=4096),
    "minilm": dict(hidden_size=384, num_hidden_layers=6, num_attention_heads=12, intermediate_size=1536),
}
BERT = {"bert-base": dict(enc="base", T=128), "bert-large": dict(enc="large", T=128)}
N_WIKI, N_MSMARCO = 21015324, 8841823
RET = {
    "dpr-bert-base": dict(kind="bi", enc="base", Tq=32, Td=256, N=N_WIKI, k=100, dim=768, pool="cls", normalize=False, shared=False, rerank=True),
    "sbert-minilm": dict(kind="bi", enc="minilm", Tq=32, Td=180, N=N_MSMARCO, k=100, dim=384, pool="mean", normalize=True, shared=True, rerank=True),
    "cross-encoder-minilm": dict(kind="cross", enc="minilm", Tq=32, Td=180, N=N_MSMARCO, k=100),
    "colbert-v2": dict(kind="late", enc="base", Tq=32, Td=180, N=N_MSMARCO, k=1000, dim=128),
}
ANN = {
    "hnsw-1m-768": dict(kind="hnsw", N=1_000_000, d=768, M=32, efSearch=64, k=10),
    "ivfpq-1m-768": dict(kind="ivfpq", N=1_000_000, d=768, nlist=4096, nprobe=16, m=96, nbits=8, k=10, coarseM=0),
    "flat-1m-768": dict(kind="flat", N=1_000_000, d=768, k=10),
    "ivfpq-1b-768": dict(kind="ivfpq", N=1_000_000_000, d=768, nlist=1 << 20, nprobe=16, m=96, nbits=8, k=10, coarseM=32, coarseEf=64),
}
TQ_ANN = 32
SMALL = dict(N=20000, d=64)   # índices FAISS reales para las fórmulas de bytes (faiss_ann.py)
HERE = os.path.dirname(os.path.abspath(__file__))


def bert_config(enc, **kw):
    return BertConfig(**ENC[enc], **kw)


def meta(cls, cfg):
    with torch.device("meta"):
        m = cls(cfg)
    m.config._attn_implementation = "eager"
    # warn_if_padding_and_no_attention_mask hace `pad_id in input_ids` (.item(): imposible en meta). Solo es un aviso.
    for mod in m.modules():
        if hasattr(mod, "warn_if_padding_and_no_attention_mask"):
            mod.warn_if_padding_and_no_attention_mask = lambda *a, **k: None
    m.eval()
    return m


def unique_params(module, exclude=()):
    ex = {id(p) for m in exclude for p in m.parameters()}
    return int(sum(p.numel() for p in module.parameters() if id(p) not in ex))


class Rec:
    """Formas por id de tensor del calculador. put() quita la dimensión de batch (B = 1 o k pares del reranker)."""

    def __init__(self):
        self.raw, self.handles, self.patches = {}, [], []
        self.current = None   # prefijo de la torre que corre (el parche de la atención es global)

    def put(self, tid, shape, strip=True):
        s = list(shape)
        self.raw.setdefault(tid, s[1:] if strip else s)

    def hook(self, model, name, where, tid, fn=None):
        m = dict(model.named_modules())[name]
        if where == "out":
            def h(mod, inp, out):
                t = out[0] if isinstance(out, tuple) else out
                self.put(tid, fn(t.shape) if fn else t.shape)
            self.handles.append(m.register_forward_hook(h))
        else:
            def p(mod, inp):
                self.put(tid, fn(inp[0].shape) if fn else inp[0].shape)
            self.handles.append(m.register_forward_pre_hook(p))

    def patch_attention(self):
        orig = modeling_bert.eager_attention_forward

        def f(module, query, key, value, attention_mask, scaling=None, dropout=0.0, **kw):
            t = self.current or ""
            out, w = orig(module, query, key, value, attention_mask, scaling=scaling, dropout=dropout, **kw)
            for tid, sh in (("q", query.shape), ("k", key.shape), ("v", value.shape), ("scores", w.shape), ("scores-scaled", w.shape),
                            ("attn", w.shape)):
                self.put(t + tid, sh)
            s = list(out.shape)   # B×T×h×d_h (HF ya la transpone) → h×T×d_h
            self.put(t + "z-heads", [s[0], s[2], s[1], s[3]])
            return out, w
        modeling_bert.eager_attention_forward = f
        self.patches.append((modeling_bert, "eager_attention_forward", orig))

    def remove(self):
        for h in self.handles:
            h.remove()
        for mod, attr, orig in reversed(self.patches):
            setattr(mod, attr, orig)
        self.handles, self.patches = [], []


def attach_bert(rec, model, base, tid, L):
    """Hooks de un BertModel (base = nombre del módulo, p. ej. 'bert' o 'question_encoder.bert_model'), capa 0 + salida."""
    b = (base + ".") if base else ""
    E = b + "embeddings."
    rec.hook(model, E + "word_embeddings", "out", tid + "e-tok")
    rec.hook(model, E + "position_embeddings", "out", tid + "e-pos")
    rec.hook(model, E + "token_type_embeddings", "out", tid + "e-type")
    rec.hook(model, E + "LayerNorm", "in", tid + "e-sum")
    rec.hook(model, E + "LayerNorm", "out", tid + "x0")
    l0 = b + "encoder.layer.0."
    # HF tiene W_Q, W_K, W_V separadas (3 salidas T×D); el calculador las fusiona en qkv (T×3D, mismo conteo).
    rec.hook(model, l0 + "attention.self.query", "out", tid + "qkv", fn=lambda s: list(s[:-1]) + [3 * s[-1]])
    rec.hook(model, l0 + "attention.output.dense", "in", tid + "z")
    rec.hook(model, l0 + "attention.output.dense", "out", tid + "o")
    rec.hook(model, l0 + "attention.output.LayerNorm", "in", tid + "r1")
    rec.hook(model, l0 + "attention.output.LayerNorm", "out", tid + "h-ln1")
    rec.hook(model, l0 + "intermediate.dense", "out", tid + "u")
    rec.hook(model, l0 + "intermediate.intermediate_act_fn", "out", tid + "g")
    rec.hook(model, l0 + "output.dense", "out", tid + "f")
    rec.hook(model, l0 + "output.LayerNorm", "in", tid + "r2")
    rec.hook(model, b + f"encoder.layer.{L - 1}.output.LayerNorm", "out", tid + "x-out")


def run_bert(rec, model, tid, T, batch=1, **kw):
    """Un forward de un BertModel / BertFor* con ids de ceros. Devuelve (salida, FLOPs totales, FLOPs por módulo)."""
    rec.current = tid
    ids = torch.zeros(batch, T, dtype=torch.long, device="meta")
    for x in ("ids", "type-ids", "pos-ids"):
        rec.put(tid + x, [batch, T])
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = model(input_ids=ids, **kw)
    rec.current = None
    by_mod = {k: int(sum(v.values())) for k, v in fcm.get_flop_counts().items()}
    return out, int(fcm.get_total_flops()), by_mod


def dpr_pooled(o):
    """DPREncoder devuelve (sequence_output, pooled_output, …) o un ModelOutput; pooled = h_[CLS] (o su proyección)."""
    return o[1] if isinstance(o, tuple) else o.pooler_output


def mm_flops(fn):
    # Ojo: FlopCounterMode cuenta mm / addmm / bmm, no mv (matriz × vector): los productos contra la query se escriben como
    # matriz × (d×1).
    fcm = FlopCounterMode(display=False)
    with fcm, torch.no_grad():
        out = fn()
    return out, int(fcm.get_total_flops())


# ================================================================ BERT
def bert_expected(cid, c):
    L = ENC[c["enc"]]["num_hidden_layers"]
    m = meta(BertForPreTraining, bert_config(c["enc"]))

    def measure(T, record=True):
        rec = Rec()
        if record:
            rec.patch_attention()
            attach_bert(rec, m, "bert", "", L)
            rec.hook(m, "bert.pooler.dense", "in", "h-cls")
            rec.hook(m, "bert.pooler.dense", "out", "pooler-pre")
            rec.hook(m, "bert.pooler.activation", "out", "pooled")
            rec.hook(m, "cls.predictions.transform.dense", "out", "mlm-h")
            rec.hook(m, "cls.predictions.transform.transform_act_fn", "out", "mlm-g")
            rec.hook(m, "cls.predictions.transform.LayerNorm", "out", "mlm-n")
            rec.hook(m, "cls.predictions.decoder", "out", "mlm-logits")
            rec.hook(m, "cls.seq_relationship", "out", "nsp-logits")
        out, flops, by = run_bert(rec, m, "", T)
        rec.remove()
        for x in ("raw-ids", "mlm-labels"):
            rec.put(x, [1, T])
        return rec, flops, by

    rec, flops, by = measure(c["T"])
    P = "BertForPreTraining."
    word = m.bert.embeddings.word_embeddings
    tied = m.cls.predictions.decoder.weight is word.weight
    mlm_params = unique_params(m.cls.predictions, exclude=[m.bert.embeddings])
    params_by_node = {"embed": n_params(m.bert.embeddings), "encoder": n_params(m.bert.encoder), "pooler": n_params(m.bert.pooler),
                      "mlm-head": mlm_params, "nsp-head": n_params(m.cls.seq_relationship)}
    flops_by_node = {"encoder": by[P + "bert.encoder"], "pooler": by[P + "bert.pooler"], "mlm-head": by[P + "cls.predictions"],
                     "nsp-head": by[P + "cls.seq_relationship"]}
    r512, f512, _ = measure(512)
    hf = m.config
    data = {
        "config_id": cid, "model": "bert",
        "params_total": n_params(m), "params_by_node": params_by_node,
        "shapes": rec.raw, "flops_total": flops, "flops_by_node": flops_by_node,
        "override_checks": [{"calc_overrides": {"T": 512}, "params_total": n_params(m), "flops_total": f512,
                             "shapes": {k: r512.raw[k] for k in ("x0", "scores", "u", "x-out", "mlm-logits", "pooled")}}],
        "metrics_checks": {"mlmTiedParams": int(word.weight.numel()), "poolerParams": params_by_node["pooler"], "nspParams": params_by_node["nsp-head"],
                           "mlmHeadParams": mlm_params, "embedParams": params_by_node["embed"], "encoderParams": params_by_node["encoder"]},
        "tied_decoder": bool(tied),
        "notes": [
            "El decoder del MLM (cls.predictions.decoder) comparte la matriz con bert.embeddings.word_embeddings (" + str(bool(tied)) + "): "
            "sum(p.numel()) la cuenta una vez; la cabeza MLM aporta dense D×D + D, LayerNorm 2D y el sesgo V.",
            "HF calcula los logits del MLM en las T posiciones (prediction_logits T×V); el código original de TF (run_pretraining.py, "
            "gather_indexes) aplica la cabeza solo a las max_predictions_per_seq posiciones: quantities.mlmHeadMacsGathered.",
            "Atención eager (matmul QKᵀ y A·V, como el calculador); sin máscara de atención: una secuencia sin relleno.",
            "HF tiene W_Q, W_K, W_V separadas: la forma `qkv` del JSON es la de query con el ancho ×3 (el calculador las fusiona).",
            "Formas sin batch; e-pos sale de position_embeddings (índices = el buffer position_ids).",
        ],
        "not_hooked": {"mask-tokens": "el enmascarado lo hace el collator de datos, fuera del forward",
                       "loss-mlm / loss-nsp / loss": "HF solo calcula la pérdida si se pasan labels (no cambia FLOPs de matmul)"},
        "source": {"lib": "transformers", "ctor": f"with torch.device('meta'): BertForPreTraining(BertConfig({', '.join(f'{k}={v!r}' for k, v in ENC[c['enc']].items())}))",
                   "vocab_size": hf.vocab_size, "max_position_embeddings": hf.max_position_embeddings, "type_vocab_size": hf.type_vocab_size,
                   "hidden_act": hf.hidden_act, "layer_norm_eps": hf.layer_norm_eps, "T": c["T"], **versions()},
    }
    write_expected(cid, data)


# ================================================================ recuperación
def cross_model(enc):
    return meta(BertForSequenceClassification, bert_config(enc, num_labels=1))


def run_cross(rec, enc, Tq, Td, batch, tid):
    """Cross-encoder (o el reranker con un batch de k pares): ids del par → BERT → pooler → Linear D → 1."""
    m = cross_model(enc)
    L = ENC[enc]["num_hidden_layers"]
    if rec is not None:
        attach_bert(rec, m, "bert", tid, L)
        rec.hook(m, "bert.pooler.dense", "in", tid + "h-cls")
        rec.hook(m, "bert.pooler.dense", "out", tid + "pooler-pre")
        rec.hook(m, "bert.pooler.activation", "out", tid + "pooled")
        rec.hook(m, "classifier", "out", tid + "score")
    out, flops, by = run_bert(rec if rec is not None else Rec(), m, tid, Tq + Td - 1, batch=batch)
    return m, out, flops


def retrieval_expected(cid, c):
    rec = Rec()
    rec.patch_attention()
    enc = c["enc"]
    D = ENC[enc]["hidden_size"]
    L = ENC[enc]["num_hidden_layers"]
    N, k = c["N"], c["k"]
    notes, data = [], {"config_id": cid, "model": "retrieval"}

    if c["kind"] == "cross":
        m, out, flops = run_cross(rec, enc, c["Tq"], c["Td"], 1, "")
        rec.remove()
        _, _, f2 = run_cross(None, enc, 16, 128, 1, "")
        data.update({"params_total": n_params(m), "params_by_node": {"joint-encoder": n_params(m.bert.embeddings) + n_params(m.bert.encoder),
                     "pooler": n_params(m.bert.pooler), "score-head": n_params(m.classifier)},
                     "shapes": rec.raw, "flops_total": flops,
                     "override_checks": [{"calc_overrides": {"Tq": 16, "Td": 128}, "params_total": n_params(m), "flops_total": f2}],
                     "metrics_checks": {"crossEncoderMacsPerPair": flops // 2, "crossEncoderParams": n_params(m)}})
        notes.append("BertForSequenceClassification(num_labels = 1): el puntaje es classifier(pooler(h_[CLS])); entrada [CLS] q [SEP] d [SEP] = T_q + T_d − 1 tokens.")
        data["source"] = {"lib": "transformers", "ctor": "with torch.device('meta'): BertForSequenceClassification(BertConfig(hidden_size=384, num_hidden_layers=6, num_attention_heads=12, intermediate_size=1536, num_labels=1))",
                          "hf": "cross-encoder/ms-marco-MiniLM-L-6-v2 (config.json)", **versions()}
        data["notes"] = notes
        write_expected(cid, data)
        return

    flops_by_node, params_by_path, metrics_checks = {}, {}, {}
    # --- torres
    if c["kind"] == "bi" and not c["shared"]:   # DPR: dos BERT-base independientes, sin pooler
        q = meta(DPRQuestionEncoder, DPRConfig())
        d = meta(DPRContextEncoder, DPRConfig())
        attach_bert(rec, q, "question_encoder.bert_model", "q-", L)
        attach_bert(rec, d, "ctx_encoder.bert_model", "d-", L)
        # DPRQuestionEncoder.forward arma una máscara (input_ids != pad) que en meta no se puede evaluar: se llama al DPREncoder
        # interno (BertModel + [CLS]; mismo cómputo, máscara None = sin relleno).
        qo, fq, _ = run_bert(rec, q.question_encoder, "q-", c["Tq"])
        do, fd, _ = run_bert(rec, d.ctx_encoder, "d-", c["Td"])
        q_emb, d_emb = dpr_pooled(qo)[0], dpr_pooled(do)[0]   # DPR: pooler_output = h_[CLS] (sin capa pooler)
        rec.put("q-emb", q_emb.shape, strip=False)
        rec.put("d-emb", d_emb.shape, strip=False)
        params_by_path.update({"query-encoder": n_params(q), "doc-encoder": n_params(d)})
        metrics_checks.update({"towerParams": n_params(q), "docTowerParams": n_params(d)})
        enc_params = n_params(q) + n_params(d)
        ctor = "DPRQuestionEncoder(DPRConfig()) + DPRContextEncoder(DPRConfig())"
        notes.append("DPR: dos BertModel(add_pooling_layer = False) independientes (§3.1 del paper); embedding = h_[CLS] (projection_dim = 0).")
    else:   # Sentence-BERT y ColBERT: UN BertModel (con pooler sin uso) para query y documento
        b = meta(BertModel, bert_config(enc))

        def pooler_hooks(t):
            rec.hook(b, "pooler.dense", "in", t + "h-cls")
            rec.hook(b, "pooler.dense", "out", t + "pooler-pre")
            rec.hook(b, "pooler.activation", "out", t + "pooled")
        attach_bert(rec, b, "", "q-", L)
        pooler_hooks("q-")
        qo, fq, _ = run_bert(rec, b, "q-", c["Tq"])
        rec.remove()
        rec.patch_attention()
        attach_bert(rec, b, "", "d-", L)
        pooler_hooks("d-")
        do, fd, _ = run_bert(rec, b, "d-", c["Td"])
        hq, hd = qo.last_hidden_state[0], do.last_hidden_state[0]
        enc_params = n_params(b)
        params_by_path.update({"query-encoder": n_params(b), "doc-encoder": 0})
        metrics_checks.update({"towerParams": n_params(b)})
        if c["kind"] == "late":
            with torch.device("meta"):
                lin = nn.Linear(D, c["dim"], bias=False)
            (pq, fpq) = mm_flops(lambda: lin(hq))
            (pd, fpd) = mm_flops(lambda: lin(hd))
            rec.put("q-lin", pq.shape, strip=False)
            rec.put("d-lin", pd.shape, strip=False)
            q_emb = torch.nn.functional.normalize(pq, dim=-1)
            d_emb = torch.nn.functional.normalize(pd, dim=-1)
            rec.put("q-emb", q_emb.shape, strip=False)
            rec.put("d-emb", d_emb.shape, strip=False)
            fq += fpq
            fd += fpd
            enc_params += n_params(lin)
            params_by_path["query-encoder"] = n_params(b) + n_params(lin)
            metrics_checks["towerParams"] = n_params(b) + n_params(lin)
            ctor = f"BertModel(BertConfig()) + nn.Linear({D}, {c['dim']}, bias=False)"
            notes.append("ColBERT: HF_ColBERT = BertModel(config) (add_pooling_layer = True por defecto: el forward CALCULA el pooler y el modelo lo descarta) + Linear(768, 128, bias = False); "
                         "query y documento usan el MISMO BERT (marcadores [Q] / [D]).")
        else:
            mask = torch.ones(c["Tq"], 1, device="meta")
            q_emb = torch.nn.functional.normalize((hq * mask).sum(0) / mask.sum(), dim=-1)
            maskd = torch.ones(c["Td"], 1, device="meta")
            d_emb = torch.nn.functional.normalize((hd * maskd).sum(0) / maskd.sum(), dim=-1)
            rec.put("q-mean", [D], strip=False)
            rec.put("d-mean", [D], strip=False)
            rec.put("q-emb", q_emb.shape, strip=False)
            rec.put("d-emb", d_emb.shape, strip=False)
            ctor = f"BertModel(BertConfig({', '.join(f'{k2}={v!r}' for k2, v in ENC[enc].items())})) + mean pooling + Normalize"
            notes.append("Sentence-BERT: red siamesa (los mismos pesos para query y documento); AutoModel crea BertModel con pooler: el forward lo calcula y mean pooling lo descarta "
                         "(22,713,216 parámetros = el checkpoint all-MiniLM-L6-v2).")
    flops_by_node["query-encoder"] = fq
    flops_by_node["doc-encoder"] = fd
    metrics_checks["queryEncodeMacs"] = fq // 2
    metrics_checks["docEncodeMacs"] = fd // 2
    rec.remove()

    if c["kind"] == "late":
        sim, fs = mm_flops(lambda: q_emb @ d_emb.T)
        rec.put("sim", sim.shape, strip=False)
        smax = sim.max(dim=1).values
        rec.put("sim-max", smax.shape, strip=False)
        rec.put("score", [1], strip=False)
        flops_by_node["maxsim"] = fs
        metrics_checks.update({"maxsimMacsPerDoc": fs // 2, "colbertV2BytesPerVector": 36})
        notes.append("MaxSim = Σ_i máx_j q_i·d_j: la matmul E_q E_dᵀ (T_q×T_d×128 MACs) la cuenta FlopCounterMode; máximo y suma son 'otros'.")
        notes.append("colbertV2BytesPerVector = 36 B con 2 bits por dimensión (Santhanam et al. 2022, §3.3: «20 or 36 bytes per vector»).")
        total_flops = fq + fd + fs
        total_params = enc_params
    else:
        # Búsqueda exacta: q·Eᵀ contra los N vectores (meta) y top-k.
        with torch.device("meta"):
            E = torch.empty(N, c["dim"])
        sc, fs = mm_flops(lambda: (E @ q_emb[:, None])[:, 0])
        rec.put("doc-index", E.shape, strip=False)
        rec.put("doc-scores", sc.shape, strip=False)
        top = torch.topk(sc, k).indices
        rec.put("topk-ids", top.shape, strip=False)
        flops_by_node["ann-search"] = fs
        metrics_checks["bruteForceMacs"] = fs // 2
        total_flops, total_params = fq + fd + fs, enc_params
        # Reranker: el cross-encoder MiniLM con un batch de k pares (T_q + T_d − 1 tokens cada uno).
        if c["rerank"]:
            rec2 = Rec()
            rec2.patch_attention()
            mc, oc, fr = run_cross(rec2, "minilm", c["Tq"], c["Td"], k, "r-")
            rec2.remove()
            rec.raw.update(rec2.raw)
            rec.put("rerank-scores", oc.logits.shape, strip=False)
            rec.put("results", [k], strip=False)
            flops_by_node["rerank"] = fr
            params_by_path["rerank"] = n_params(mc)
            metrics_checks.update({"rerankerParams": n_params(mc), "rerankMacs": fr // 2, "crossEncoderMacsPerPair": fr // 2 // k})
            total_flops += fr
            total_params += n_params(mc)
            notes.append(f"Rerank: BertForSequenceClassification (MiniLM, num_labels = 1) con un batch de k = {k} pares; FLOPs = k × los de un par (formas por par).")
    data.update({"params_total": total_params, "params_by_path": params_by_path, "shapes": rec.raw, "flops_total": total_flops,
                 "flops_by_node": flops_by_node, "metrics_checks": metrics_checks})
    # override: sin rerank y con otros T (los parámetros de las torres no cambian)
    ov = []
    if c["kind"] == "bi":
        ov.append({"calc_overrides": {"rerank": 0}, "params_total": enc_params, "flops_total": fq + fd + fs})
    data["override_checks"] = ov
    notes.append("Búsqueda exacta (flat) = la matmul E·q con E de N×dim en meta (FlopCounterMode: 2·N·dim); topk sin FLOPs.")
    notes.append("Formas sin batch; las del reranker (r-…) son por par (el batch de k se quita).")
    data["notes"] = notes
    data["source"] = {"lib": "transformers", "ctor": "with torch.device('meta'): " + ctor, "Tq": c["Tq"], "Td": c["Td"], "N": N, "k": k, **versions()}
    write_expected(cid, data)


# ================================================================ ANN
def faiss_run(c):
    """FAISS en un proceso aparte (faiss_ann.py): torch y faiss-cpu traen cada uno su libomp y no pueden cargarse juntos en macOS."""
    r = subprocess.run([sys.executable, os.path.join(HERE, "faiss_ann.py"), json.dumps(c)], capture_output=True, text=True, check=True,
                       env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
    return json.loads(r.stdout)


def ann_expected(cid, c):
    rec = Rec()
    rec.patch_attention()
    d = c["d"]
    q = meta(DPRQuestionEncoder, DPRConfig(projection_dim=0 if d == 768 else d))
    attach_bert(rec, q, "question_encoder.bert_model", "q-", 12)
    qo, fenc, _ = run_bert(rec, q.question_encoder, "q-", TQ_ANN)
    rec.remove()
    qv = dpr_pooled(qo)[0]
    rec.put("query", qv.shape, strip=False)
    enc_params = n_params(q)
    N, k = c["N"], c["k"]
    notes = ["Encode = el encoder de queries de DPR (BertModel sin pooler, [CLS], T_q = 32) en meta; FLOPs por FlopCounterMode."]
    search_flops, search_params, metrics_checks = 0, 0, {"encodeMacs": fenc // 2, "encodeParams": enc_params}
    fx = faiss_run(c)
    full = fx["full"]
    with torch.device("meta"):
        if c["kind"] == "flat":
            X = torch.empty(N, d)
            ds, search_flops = mm_flops(lambda: (X @ qv[:, None])[:, 0])
            rec.put("xb", X.shape, strip=False)
            rec.put("dists", ds.shape, strip=False)
            rec.put("ids", torch.topk(ds, k).indices.shape, strip=False)
            notes.append("Flat: la matmul X·q (N×d) en meta = 2·N·d FLOPs; es lo que hace IndexFlatIP (BLAS).")
        elif c["kind"] == "hnsw":
            nb0 = full["nb_neighbors0"]
            lv = max(0, math.floor(math.log(N) / math.log(c["M"])))
            dist = lv * c["M"] + c["efSearch"] * 2 * c["M"]
            Xs = torch.empty(dist, d)
            _, search_flops = mm_flops(lambda: Xs @ qv[:, None])
            rec.put("xb", [N, d], strip=False)
            rec.put("links", [N, nb0], strip=False)
            rec.put("entry", [1], strip=False)
            rec.put("cands", [c["efSearch"]], strip=False)
            rec.put("ids", [k], strip=False)
            metrics_checks["levels"] = lv
            notes.append(f"HNSW: FAISS IndexHNSWFlat(d, M = {c['M']}).hnsw.nb_neighbors(0) = {nb0} = 2M enlaces en el nivel 0 (forma de `links`). "
                         "Las distancias de una búsqueda dependen de los datos: el calculador usa la cota ≈ ⌊log_M N⌋·M + efSearch·2M y "
                         "la verifica contra hnsw_stats.ndis de FAISS en índices chicos (range_checks: 0.5–1.0× la cota en datos sintéticos). "
                         "flops_total = encoder + 2·d por distancia de esa cota (≈, no medible en meta).")
        else:
            coarse_hnsw = c.get("coarseM", 0)
            if coarse_hnsw:
                lv = max(0, math.floor(math.log(c["nlist"]) / math.log(coarse_hnsw)))
                ndc = lv * coarse_hnsw + c["coarseEf"] * 2 * coarse_hnsw
                C = torch.empty(ndc, d)
                notes.append(f"Cuantizador grueso HNSW{coarse_hnsw} sobre los {c['nlist']:,} centroides (IVF1048576_HNSW32 del wiki): ≈ {ndc} distancias (cota del calculador).")
            else:
                C = torch.empty(c["nlist"], d)
            cdist, fc = mm_flops(lambda: C @ qv[:, None])
            ks = 2 ** c["nbits"]
            cb = torch.empty(c["m"], ks, d // c["m"])
            lut_q, fl = mm_flops(lambda: torch.einsum("mkd,md->mk", cb, qv.view(c["m"], d // c["m"])))
            precomputed = c["nlist"] * c["m"] * ks * 4 <= full["precomputed_table_max_bytes"]
            if not precomputed:
                fl *= c["nprobe"]
            search_flops = fc + fl
            scanned = max(1, round(c["nprobe"] * N / c["nlist"]))
            rec.put("coarse-dists", [c["nlist"]], strip=False)
            rec.put("probe-ids", [c["nprobe"]], strip=False)
            rec.put("residuals", [c["nprobe"], d], strip=False)
            rec.put("lut", [c["nprobe"]] + list(lut_q.shape), strip=False)
            rec.put("codes", [N, full["code_size"] * 8 // c["nbits"]], strip=False)
            rec.put("list-ids", [N], strip=False)
            rec.put("adc-dists", [scanned], strip=False)
            rec.put("ids", [k], strip=False)
            search_params = c["nlist"] * full["d"] + full["pq_centroids"]
            metrics_checks.update({"codebookBytes": 4 * full["pq_centroids"], "bytesPerVector": full["code_size"] + 8,
                                   "precomputedTableBytes": c["nlist"] * c["m"] * ks * 4 if precomputed else 0, "scannedVectors": scanned})
            notes.append(f"IVF-PQ: IndexIVFPQ(IndexFlatL2, d, {c['nlist']}, {c['m']}, {c['nbits']}) a tamaño real sin entrenar: code_size = {full['code_size']} B, "
                         f"pq.centroids = {full['pq_centroids']} floats (k_s·d); centroides gruesos n_list·d (parámetros de k-means). "
                         "FLOPs de búsqueda en meta: q·Cᵀ (cuantizador grueso) + las tablas ADC q·codebooks (einsum, k_s·d MACs con la tabla precalculada, "
                         "× n_probe sin ella); recorrer códigos = lecturas de tabla y sumas, 0 FLOPs de matmul.")
    data = {
        "config_id": cid, "model": "ann", "params_total": enc_params + search_params,
        "params_by_node": {"encode": enc_params},
        "shapes": rec.raw, "flops_total": fenc + search_flops, "flops_search": search_flops,
        "flops_by_node": {"encode": fenc},
        "metrics_checks": metrics_checks,
    }
    data.update({"ann_checks": fx["ann_checks"], "range_checks": fx["range_checks"], "faiss_measured": fx["measured"]})
    notes.append(f"ann_checks / range_checks: índices FAISS reales con N = {SMALL['N']:,} y d = {SMALL['d']} (datos gaussianos, semilla 0): las fórmulas de "
                 "bytes del calculador (A.flat_bytes / hnsw_bytes / ivfpq_bytes) con esos mismos N, d, M, n_list, m, nbits = los arreglos de FAISS.")
    data["notes"] = notes
    data["source"] = {"lib": "faiss-cpu + transformers", "faiss": fx["faiss_version"], "ctor": "DPRQuestionEncoder(DPRConfig()) en meta + FAISS " + c["kind"], **versions()}
    write_expected(cid, data)


def main():
    torch.manual_seed(0)
    for cid, c in BERT.items():
        print("▸", cid)
        bert_expected(cid, c)
    for cid, c in RET.items():
        print("▸", cid)
        retrieval_expected(cid, c)
    for cid, c in ANN.items():
        print("▸", cid)
        ann_expected(cid, c)


if __name__ == "__main__":
    main()
