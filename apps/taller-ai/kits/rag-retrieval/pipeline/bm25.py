"""Viene de la estación 5 : no lo tienes que escribir. Paso 3: el índice BM25, el buscador de palabras.

Contrato:
- construir(chunks, k1, b) → {"k1", "b", "N", "avgdl", "df": {palabra: en cuántos chunks está},
  "docs": {chunk_id: {"len": cuántas palabras, "tf": {palabra: cuántas veces}}}}. Las palabras salen de palabras()
  de _comun.py, sobre el texto completo del chunk (con su ruta de títulos).
- idf(indice, palabra) = ln(1 + (N − df + 0.5) / (df + 0.5)): rara vale mucho, común vale poco; 0 si no está.
- puntajes(indice, consulta) → {chunk_id: puntaje} solo de los chunks con al menos una palabra de la consulta.
  Cada palabra distinta de la consulta suma idf × tf × (k1 + 1) / (tf + k1 × (1 − b + b × len / avgdl)).
"""
from __future__ import annotations

import math
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import palabras  # noqa: E402


def construir(chunks: dict, k1: float, b: float) -> dict:
    docs, df = {}, Counter()
    for k in sorted(chunks):
        ws = palabras(chunks[k]["texto"])
        docs[k] = {"len": len(ws), "tf": dict(Counter(ws))}
        df.update(set(ws))
    n = len(docs)
    return {"k1": k1, "b": b, "N": n, "avgdl": sum(d["len"] for d in docs.values()) / n if n else 0.0, "df": dict(df), "docs": docs}


def idf(indice: dict, palabra: str) -> float:
    df = indice["df"].get(palabra, 0)
    return math.log(1 + (indice["N"] - df + 0.5) / (df + 0.5)) if df else 0.0


def puntajes(indice: dict, consulta: str) -> dict[str, float]:
    k1, b, avgdl = indice["k1"], indice["b"], indice["avgdl"]
    qs = [w for w in dict.fromkeys(palabras(consulta)) if w in indice["df"]]
    pesos = {w: idf(indice, w) for w in qs}
    out = {}
    for k, d in indice["docs"].items():
        s = 0.0
        for w in qs:
            tf = d["tf"].get(w, 0)
            if tf:
                s += pesos[w] * tf * (k1 + 1) / (tf + k1 * (1 - b + b * d["len"] / avgdl))
        if s > 0:
            out[k] = s
    return out


if __name__ == "__main__":
    # python pipeline/bm25.py "una pregunta"  → el top-5 de BM25 sobre el corpus vigente, sin permisos, con el peso de cada palabra
    from _comun import config, corpus

    c = config()["bm25"]
    ix = construir(corpus()["chunks"], c["k1"], c["b"])
    q = " ".join(sys.argv[1:])
    print(f"{ix['N']} chunks · {len(ix['df'])} palabras distintas · {ix['avgdl']:.1f} palabras por chunk en promedio")
    print("  idf: " + " · ".join(f"{w} {idf(ix, w):.2f} (en {ix['df'].get(w, 0)})" for w in dict.fromkeys(palabras(q))))
    for k, s in sorted(puntajes(ix, q).items(), key=lambda x: (-x[1], x[0]))[:5]:
        print(f"  {s:6.2f}  {k}")
