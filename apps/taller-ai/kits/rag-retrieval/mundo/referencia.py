"""La verdad del equipo: cómo se busca, cómo se fusiona, cómo puntúa el reranker y cómo se mide, para que verificar.py
y romper.py comparen lo tuyo contra algo. No lo leas para resolver un paso: es la respuesta.
"""
from __future__ import annotations

import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import hashlib  # noqa: E402
import json  # noqa: E402

from mundo.comun import ALMACEN, INDICES, MODELO, RESULTADOS, VIGENTE, catalogo, leer_json, leer_jsonl  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from _comun import palabras, principals, puede_ver  # noqa: E402

_SES: dict = {}


def _modelo(clave: str):
    if clave not in _SES:
        import onnxruntime as ort
        from tokenizers import Tokenizer

        info = catalogo()[clave]
        tok = Tokenizer.from_file(str(MODELO / clave / "tokenizer.json"))
        tok.enable_truncation(info["max_tokens"])
        tok.enable_padding()
        s = ort.InferenceSession(str(MODELO / clave / "model.onnx"), providers=["CPUExecutionProvider"])
        _SES[clave] = (info, tok, s, {i.name for i in s.get_inputs()})
    return _SES[clave]


def embeber(clave: str, textos: list[str], tipo: str, normalizar: bool = True) -> np.ndarray:
    info, tok, s, entradas = _modelo(clave)
    prefijo = info["prefijo_consulta"] if tipo == "consulta" else info["prefijo_pasaje"]
    out = []
    for i in range(0, len(textos), 16):
        enc = tok.encode_batch([prefijo + t for t in textos[i:i + 16]])
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        m = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": m}
        if "token_type_ids" in entradas:
            feed["token_type_ids"] = np.zeros_like(ids)
        h = s.run(None, feed)[0]
        mf = m[..., None].astype(np.float32)
        v = (h * mf).sum(1) / mf.sum(1)
        out.append(v / np.linalg.norm(v, axis=1, keepdims=True) if normalizar else v)
    return np.vstack(out).astype(np.float32)


def firma(clave: str) -> dict:
    i = catalogo()[clave]
    return {"clave": clave, "repo": i["repo"], "revision": i["revision"], "sha256": i["archivos"]["model.onnx"]["sha256"], "dim": i["dim"]}


def etiqueta(clave: str) -> str:
    return f"{clave}@{catalogo()[clave]['revision'][:12]}"


def bm25(chunks: dict, k1: float = 1.2, b: float = 0.75) -> dict:
    docs, df = {}, Counter()
    for k in sorted(chunks):
        ws = palabras(chunks[k]["texto"])
        docs[k] = {"len": len(ws), "tf": dict(Counter(ws))}
        df.update(set(ws))
    return {"k1": k1, "b": b, "N": len(docs), "avgdl": sum(d["len"] for d in docs.values()) / len(docs), "df": dict(df), "docs": docs}


def puntajes(ix: dict, consulta: str) -> dict[str, float]:
    qs = [w for w in dict.fromkeys(palabras(consulta)) if w in ix["df"]]
    idf = {w: math.log(1 + (ix["N"] - ix["df"][w] + 0.5) / (ix["df"][w] + 0.5)) for w in qs}
    out = {}
    for k, d in ix["docs"].items():
        s = sum(idf[w] * d["tf"][w] * (ix["k1"] + 1) / (d["tf"][w] + ix["k1"] * (1 - ix["b"] + ix["b"] * d["len"] / ix["avgdl"]))
                for w in qs if w in d["tf"])
        if s > 0:
            out[k] = s
    return out


def corpus() -> dict:
    return leer_json(ALMACEN / "corpus" / "vigente.json")


def directorio() -> dict:
    return leer_json(ALMACEN / "directorio.json")


def golden() -> tuple[str, list[dict]]:
    v = (ALMACEN / "golden" / "VIGENTE").read_text().strip()
    return v, leer_jsonl(ALMACEN / "golden" / v / "preguntas.jsonl")


def top(ix_dir: str, pregunta: str, persona: str | None, lado: str, k: int = 8, consulta: str | None = None, cache: dict = {}) -> list[str]:  # noqa: B006
    """El top-k de un índice, con el filtro de permisos antes de elegir (persona=None: sin filtro)."""
    llave = (ix_dir, (INDICES / ix_dir / "manifiesto.json").stat().st_mtime_ns)
    if llave not in cache:
        d = INDICES / ix_dir
        man = leer_json(d / "manifiesto.json")
        vj = leer_json(d / "vectores.json")
        meta = {x["chunk_id"]: x["acl"] for x in leer_jsonl(d / "chunks.jsonl")}
        cache[llave] = (man, vj["ids"], meta, np.load(d / "vectores.npy"), leer_json(d / "bm25.json"))
    man, ids, meta, m, bm = cache[llave]
    ps = principals(persona, directorio()) if persona else None
    if lado == "bm25":
        return [x for x, _ in sorted(((k_, s) for k_, s in puntajes(bm, pregunta).items() if ref_ve(meta.get(k_), ps)), key=lambda x: (-x[1], x[0]))[:k]]
    ok = np.array([ref_ve(meta.get(x), ps) for x in ids], dtype=bool)
    q = embeber(consulta or man["modelo"]["clave"], [pregunta], "consulta")[0]
    s = np.where(ok, m @ q, -np.inf)
    return [ids[i] for i in np.argsort(-s, kind="stable")[:k] if ok[i]]


def ref_ve(acl, ps) -> bool:
    return acl is not None and (ps is None or puede_ver(acl, ps))


CORRECTA = {"candidatos": 30, "filtro": "antes", "fusion": "rrf", "rrf_k": 60, "rerank_n": 20, "k": 8}
_RR: dict = {}


def visibles(persona: str, ix_dir: str = VIGENTE) -> set[str]:
    ps = principals(persona, directorio())
    return {x["chunk_id"] for x in leer_jsonl(INDICES / ix_dir / "chunks.jsonl") if ref_ve(x["acl"], ps)}


def rrf(listas: list[list[str]], k: int = 60) -> list[str]:
    s: dict = {}
    for l in listas:
        for r, c in enumerate(l, 1):
            s[c] = s.get(c, 0.0) + 1 / (k + r)
    return sorted(s, key=lambda c: (-s[c], c))


def reranker(pregunta: str, textos: list[str]) -> np.ndarray:
    """El puntaje del cross-encoder para cada par (pregunta, texto), con memoria en disco (.taller/ref/)."""
    if not _RR:
        import onnxruntime as ort
        from tokenizers import Tokenizer

        info = catalogo()["reranker"]
        tok = Tokenizer.from_file(str(MODELO / "reranker" / "tokenizer.json"))
        tok.enable_truncation(info["max_tokens"])
        tok.enable_padding()
        _RR["tok"], _RR["s"] = tok, ort.InferenceSession(str(MODELO / "reranker" / "model.onnx"), providers=["CPUExecutionProvider"])
        _RR["memo"] = leer_json(RESULTADOS / "reranker.json", {})
    memo = _RR["memo"]
    llave = [hashlib.sha256(f"{pregunta}\x00{t}".encode()).hexdigest()[:20] for t in textos]
    faltan = [i for i, k in enumerate(llave) if k not in memo]
    for i0 in range(0, len(faltan), 8):
        idx = faltan[i0:i0 + 8]
        enc = _RR["tok"].encode_batch([(pregunta, textos[i]) for i in idx])
        out = _RR["s"].run(None, {"input_ids": np.array([e.ids for e in enc], np.int64), "attention_mask": np.array([e.attention_mask for e in enc], np.int64)})[0][:, 0]
        for i, v in zip(idx, out):
            memo[llave[i]] = float(v)
    if faltan:
        RESULTADOS.mkdir(parents=True, exist_ok=True)
        (RESULTADOS / "reranker.json").write_text(json.dumps(memo))
    return np.array([memo[k] for k in llave], dtype=np.float32)


def recuperar(pregunta: str, persona: str, modo: str, cfg: dict, ix_dir: str = VIGENTE) -> list[str]:
    """El top-k de cada modo con una configuración dada (la verdad para comparar tu Recuperador)."""
    n = cfg["candidatos"]
    if cfg.get("filtro", "antes") == "antes":
        bm, ve = top(ix_dir, pregunta, persona, "bm25", n), top(ix_dir, pregunta, persona, "vectores", n)
    else:
        ok = visibles(persona, ix_dir)
        bm = [c for c in top(ix_dir, pregunta, None, "bm25", n) if c in ok]
        ve = [c for c in top(ix_dir, pregunta, None, "vectores", n) if c in ok]
    k = cfg["k"]
    if modo == "bm25":
        return bm[:k]
    if modo == "vectores":
        return ve[:k]
    fus = rrf([bm, ve], cfg["rrf_k"])
    if modo == "fusion":
        return fus[:k]
    pool = fus[:cfg["rerank_n"]]
    c = corpus()["chunks"]
    s = reranker(pregunta, [c[x]["texto"] for x in pool])
    return [pool[i] for i in np.argsort(-s, kind="stable")][:k]


def medir(cfg: dict, split: str = "test", modos=("bm25", "vectores", "fusion", "completo"), ix_dir: str = VIGENTE) -> dict:
    """recall@k (directa y varias), recall@3, MRR y fugas de cada modo, como pide el contrato de medir.py."""
    _, items = golden()
    out = {}
    for modo in modos:
        rec, r3, rr, fugas, pt = [], [], [], 0, {"directa": [], "varias": []}
        for x in items:
            if x["split"] != split:
                continue
            t = recuperar(x["pregunta"], x["persona"], modo, cfg, ix_dir)
            fs = {f["chunk_id"] for f in x["fuentes"]}
            if x["tipo"] == "prohibida" and fs & set(t):
                fugas += 1
            if x["tipo"] in pt:
                v = len(fs & set(t)) / len(fs)
                rec.append(v)
                pt[x["tipo"]].append(v)
                r3.append(len(fs & set(t[:3])) / len(fs))
                rr.append(next((1 / (i + 1) for i, c in enumerate(t) if c in fs), 0.0))
        out[modo] = {"recall": sum(rec) / len(rec), "n": len(rec), "recall@3": sum(r3) / len(r3), "mrr": sum(rr) / len(rr), "fugas": fugas,
                     "por_tipo": {t: {"recall": sum(v) / len(v) if v else 0.0, "n": len(v)} for t, v in pt.items()}}
    return out
