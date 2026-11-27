"""La verdad del equipo: cómo se embebe, cómo se arma BM25 y cómo se mide, para que verificar.py compare lo tuyo
contra algo. También construye el índice del piloto (crear.py). No lo leas para resolver un paso: es la respuesta.
"""
from __future__ import annotations

import math
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALIAS, ALMACEN, INDICES, MODELO, PILOTO, RELOJ, catalogo, escribir_json, escribir_jsonl, leer_json, leer_jsonl, sha256_archivo  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from _comun import palabras, principals, puede_ver, sha_texto  # noqa: E402

_SES: dict = {}
ARCHIVOS = ("chunks.jsonl", "bm25.json", "vectores.npy", "vectores.json")


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


def construir_piloto() -> str:
    """El índice que dejó el job del piloto anoche: el mismo formato que el tuyo, con all-MiniLM-L6-v2."""
    c = corpus()
    ch = c["chunks"]
    ids = sorted(ch)
    d = INDICES / PILOTO
    man = {"nombre": PILOTO, "estado": "construyendo", "creado": "2026-11-22T09:40:00Z", "corpus": c["version"], "modelo": firma("minilm"),
           "dimension": 384, "similitud": "coseno"}
    escribir_json(d / "manifiesto.json", man)
    escribir_jsonl(d / "chunks.jsonl", [{"chunk_id": k, "doc_id": ch[k]["doc_id"], "titulo": ch[k]["titulo"], "acl": ch[k]["acl"],
                                         "sha": sha_texto(ch[k]["texto"])} for k in ids])
    escribir_json(d / "bm25.json", bm25(ch))
    np.save(d / "vectores.npy", embeber("minilm", [ch[k]["texto"] for k in ids], "pasaje"))
    escribir_json(d / "vectores.json", {"ids": ids, "filas": [{"chunk_id": k, "modelo": etiqueta("minilm")} for k in ids]})
    man |= {"estado": "listo", "n": len(ids), "bm25": {"k1": 1.2, "b": 0.75}, "archivos": {a: sha256_archivo(d / a) for a in ARCHIVOS}}
    escribir_json(d / "manifiesto.json", man)
    escribir_json(ALIAS, {"c11": {"actual": PILOTO, "anterior": None, "historial": [{"fecha": "2026-11-22T09:41:00.000Z", "de": None, "a": PILOTO}]}})
    return PILOTO


def problemas(nombre: str) -> list[str]:
    """Lo que tiene mal un índice, visto por el equipo: lo mismo que pide revisar() y además que cada vector sea de
    verdad el de su chunk con el modelo del manifiesto (se re-embebe todo: ≈ 2 s)."""
    d = INDICES / nombre
    man = leer_json(d / "manifiesto.json")
    if not man:
        return [f"indices/{nombre}/ no tiene manifiesto.json"]
    if man.get("estado") != "listo":
        return [f"{nombre} está «{man.get('estado')}» (no «listo»): está a medio construir"]
    for a in ARCHIVOS:
        if not (d / a).exists():
            return [f"a {nombre} le falta {a}"]
    p = []
    c = corpus()["chunks"]
    meta = leer_jsonl(d / "chunks.jsonl")
    ids_c = [x["chunk_id"] for x in meta]
    vj = leer_json(d / "vectores.json")
    bm = leer_json(d / "bm25.json")
    for nom, ids in (("chunks.jsonl", ids_c), ("bm25.json", list(bm["docs"])), ("vectores.json", vj["ids"])):
        falta, sobra = sorted(set(c) - set(ids)), sorted(set(ids) - set(c))
        if falta or sobra:
            p.append(f"{nombre}: {nom} no trae los chunks del corpus: faltan {len(falta)}" + (f" ({', '.join(falta[:3])}…)" if falta else "") +
                     f", sobran {len(sobra)}")
    malas = [x["chunk_id"] for x in meta if x["chunk_id"] in c and x["acl"] != c[x["chunk_id"]]["acl"]]
    if malas:
        p.append(f"{nombre}: {len(malas)} chunks con una ACL distinta a la del corpus ({malas[0]}…)")
    clave = man["modelo"]["clave"]
    modelos_filas = Counter(f["modelo"] for f in vj["filas"])
    if set(modelos_filas) != {etiqueta(clave)}:
        p.append(f"{nombre}: sus vectores son de {len(modelos_filas)} modelos: " + ", ".join(f"{n} de {m}" for m, n in modelos_filas.most_common()))
    m = np.load(d / "vectores.npy")
    if m.shape != (len(vj["ids"]), catalogo()[clave]["dim"]):
        p.append(f"{nombre}: la matriz es {m.shape} y {clave} da {catalogo()[clave]['dim']} dimensiones")
        return p
    normas = np.linalg.norm(m, axis=1)
    fuera = int((np.abs(normas - 1) > 1e-3).sum())
    if fuera:
        p.append(f"{nombre}: {fuera} de {len(m)} vectores no tienen largo 1 (de {normas.min():.2f} a {normas.max():.2f}) y la similitud es coseno")
    ids_ok = [i for i, k in enumerate(vj["ids"]) if k in c]
    if ids_ok:
        v = embeber(clave, [c[vj["ids"][i]]["texto"] for i in ids_ok], "pasaje")
        mn = m[ids_ok] / np.maximum(np.linalg.norm(m[ids_ok], axis=1, keepdims=True), 1e-9)
        cos = (mn * v).sum(1)
        otros = int((cos < 0.999).sum())
        if otros:
            p.append(f"{nombre}: {otros} vectores no son los de su chunk con {clave} (re-embebidos, el coseno da {cos.min():.2f})")
    return p


def top(ix_dir: str, pregunta: str, persona: str, lado: str, k: int = 8, consulta: str | None = None, cache: dict = {}) -> list[str]:  # noqa: B006
    """El top-k de un índice, con el filtro de permisos antes de elegir: la verdad para comparar tu búsqueda."""
    llave = (ix_dir, (INDICES / ix_dir / "manifiesto.json").stat().st_mtime_ns)
    if llave not in cache:
        d = INDICES / ix_dir
        man = leer_json(d / "manifiesto.json")
        vj = leer_json(d / "vectores.json")
        meta = {x["chunk_id"]: x["acl"] for x in leer_jsonl(d / "chunks.jsonl")}
        cache[llave] = (man, vj["ids"], meta, np.load(d / "vectores.npy"), leer_json(d / "bm25.json"))
    man, ids, meta, m, bm = cache[llave]
    ps = principals(persona, directorio())
    if lado == "bm25":
        return [x for x, _ in sorted(((k_, s) for k_, s in puntajes(bm, pregunta).items() if ref_ve(meta.get(k_), ps)), key=lambda x: (-x[1], x[0]))[:k]]
    ok = np.array([ref_ve(meta.get(x), ps) for x in ids], dtype=bool)
    q = embeber(consulta or man["modelo"]["clave"], [pregunta], "consulta")[0]
    s = np.where(ok, m @ q, -np.inf)
    return [ids[i] for i in np.argsort(-s, kind="stable")[:k] if ok[i]]


def ref_ve(acl, ps) -> bool:
    return acl is not None and puede_ver(acl, ps)


def recall(nombre: str, split: str = "test", consulta: str | None = None) -> dict:
    _, items = golden()
    out = {}
    for lado in ("bm25", "vectores"):
        xs = []
        for x in items:
            if x["split"] == split and x["tipo"] in ("directa", "varias"):
                fs = {f["chunk_id"] for f in x["fuentes"]}
                xs.append(len(fs & set(top(nombre, x["pregunta"], x["persona"], lado, consulta=consulta))) / len(fs))
        out[lado] = sum(xs) / len(xs)
    return out
