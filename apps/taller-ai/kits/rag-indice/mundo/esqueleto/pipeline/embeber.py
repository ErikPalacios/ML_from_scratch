"""Paso 1 y 2: convertir texto en embeddings con un modelo local, y no volver a embeber lo que ya embebiste.

Contrato:
- Modelo(clave) carga el modelo del catálogo (mundo/modelos.json) desde modelo/<clave>/: model.onnx con onnxruntime y
  tokenizer.json con tokenizers. Antes de usarlo comprueba el sha256 de los dos archivos contra el catálogo; si no
  coinciden, levanta ValueError (un modelo que no es el anotado no se usa).
- Modelo.firma(): {"clave", "repo", "revision", "sha256" (el de model.onnx), "dim"}: qué modelo y qué versión hizo un
  vector. Va en el manifiesto de cada índice y en cada fila.
- Modelo.embeber(textos, tipo): tipo es "consulta" o "pasaje"; a cada texto le pone el prefijo de ese tipo que pide el
  catálogo («query: » o «passage: » en e5; nada en MiniLM), lo parte en tokens (cortando en max_tokens), lo pasa por
  el modelo en lotes de config embeddings.lote, promedia los vectores de sus tokens (mean pooling, sin contar el
  relleno) y normaliza cada vector a largo 1. Devuelve un numpy.ndarray float32 de forma (len(textos), dim).
- embeber_chunks(chunks, modelo) → (ids, matriz, nuevos): los vectores de pasaje de cada chunk {chunk_id: {"texto", ...}},
  en el orden de sorted(chunk_ids). Usa el cache de cache/embeddings/<clave>@<revision[:12]>/<sha_texto(texto)>.npy:
  solo embebe los textos que no están y los guarda. nuevos = cuántos tuvo que embeber.
"""

from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
from _comun import CACHE, MODELO, config, modelos, sha256_archivo, sha_texto


class Modelo:

    def __init__(self, clave: str):
        raise NotImplementedError("paso 1: Modelo.__init__")

    def firma(self) -> dict:
        raise NotImplementedError("paso 1: Modelo.firma")

    def embeber(self, textos: list[str], tipo: str) -> np.ndarray:
        raise NotImplementedError("paso 1: Modelo.embeber")


def carpeta_cache(modelo: Modelo) -> Path:
    raise NotImplementedError("paso 2: carpeta_cache")


def embeber_chunks(chunks: dict, modelo: Modelo) -> tuple[list[str], np.ndarray, int]:
    raise NotImplementedError("paso 2: embeber_chunks")


if __name__ == "__main__":
    # python pipeline/embeber.py [--modelo minilm] "texto uno" "texto dos" ...  → la similitud coseno de cada par
    import argparse
    import time

    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", default=None)
    ap.add_argument("textos", nargs="+")
    a = ap.parse_args()
    t = time.perf_counter()
    m = Modelo(a.modelo or config()["embeddings"]["modelo"])
    print(f"{m.clave}: {m.info['repo']} @ {m.info['revision'][:12]} · {m.dim} dimensiones · cargado en {time.perf_counter() - t:.1f} s")
    v = m.embeber(a.textos, "pasaje")
    for i in range(len(a.textos)):
        for j in range(i + 1, len(a.textos)):
            print(f"  {float(v[i] @ v[j]):.3f}  «{a.textos[i]}» · «{a.textos[j]}»")
