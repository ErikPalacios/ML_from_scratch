"""Paso 5: construir un índice nuevo al lado del que está sirviendo: BM25 y vectores sobre los mismos chunks, con la
ACL de cada chunk, y un manifiesto que dice qué es. El índice vigente no se toca.

Contrato:
- nombre_nuevo(clave, corpus_version) → "c11-<clave>-<fecha del corpus>", y si ya existe, con -2, -3…
- construir(clave=None, nombre=None) → el nombre del índice. clave = config embeddings.modelo si no se da.
  1. Si la dimensión del modelo no es la de config indice.dimension, se detiene ANTES de escribir nada (SystemExit).
  2. Crea indices/<nombre>/ (si ya existe, SystemExit) y escribe primero manifiesto.json con "estado": "construyendo".
  3. chunks.jsonl: una fila por chunk (sorted): {"chunk_id", "doc_id", "titulo", "acl", "sha": sha_texto(texto)}.
  4. bm25.json: bm25.construir con k1 y b de config.
  5. vectores.npy (la matriz) y vectores.json: {"ids", "filas"} de vectores.construir.
  6. Al final, el manifiesto completo y "estado": "listo": {"nombre", "estado", "creado": ahora(), "corpus" (versión),
     "modelo": la firma, "dimension", "similitud", "n" (chunks), "bm25": {"k1", "b"}, "archivos": {archivo: sha256}}.
- revisar(nombre) → lista de problemas (vacía = sano): estado listo; cada archivo existe y su sha256 es el del manifiesto;
  los mismos chunk_ids en chunks.jsonl, en bm25.json y en vectores.json; cada fila de vectores hecha por el modelo del
  manifiesto; la matriz de forma (n, dimension); cada vector de largo 1 (± 0.001). Antes de mover un alias, se revisa.
"""

from __future__ import annotations
import shutil
import sys
from pathlib import Path
import numpy as np
import bm25
import vectores
from _comun import INDICES, ahora, config, corpus, escribir_json, escribir_jsonl, leer_json, leer_jsonl, sha256_archivo, sha_texto
from embeber import Modelo

ARCHIVOS = ("chunks.jsonl", "bm25.json", "vectores.npy", "vectores.json")


def nombre_nuevo(clave: str, corpus_version: str) -> str:
    base = f"c11-{clave}-{corpus_version.removeprefix('corpus-')}"
    nombre, n = base, 1
    while (INDICES / nombre).exists():
        n += 1
        nombre = f"{base}-{n}"
    return nombre


def construir(clave: str | None = None, nombre: str | None = None) -> str:
    raise NotImplementedError("paso 5: construir")


def revisar(nombre: str, man: dict | None = None) -> list[str]:
    raise NotImplementedError("paso 5: revisar")


if __name__ == "__main__":
    import argparse
    import time

    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", default=None)
    ap.add_argument("--revisar", metavar="NOMBRE")
    a = ap.parse_args()
    if a.revisar:
        p = revisar(a.revisar)
        print("\n".join(f"✗ {x}" for x in p) or f"✓ {a.revisar}: sano")
        sys.exit(1 if p else 0)
    t = time.perf_counter()
    n = construir(a.modelo)
    man = leer_json(INDICES / n / "manifiesto.json")
    print(f"✓ indices/{n}/ listo en {time.perf_counter() - t:.1f} s: {man['n']} chunks de {man['corpus']} · BM25 y vectores de "
          f"{man['dimension']} dimensiones ({man['modelo']['repo']} @ {man['modelo']['revision'][:12]}) · cada chunk con su ACL")
