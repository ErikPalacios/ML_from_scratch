"""Paso 3: el índice BM25, el buscador de palabras.

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
from _comun import palabras


def construir(chunks: dict, k1: float, b: float) -> dict:
    raise NotImplementedError("paso 3: construir")


def idf(indice: dict, palabra: str) -> float:
    raise NotImplementedError("paso 3: idf")


def puntajes(indice: dict, consulta: str) -> dict[str, float]:
    raise NotImplementedError("paso 3: puntajes")


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
