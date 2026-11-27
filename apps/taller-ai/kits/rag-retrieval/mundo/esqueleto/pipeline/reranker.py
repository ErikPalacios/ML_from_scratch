"""Paso 3: el reranker. Un cross-encoder lee la pregunta y un pasaje juntos, en una sola pasada por el modelo, y da un
número: qué tan bien contesta ese pasaje esa pregunta. Es más fino que comparar dos vectores hechos por separado, y
más caro: una pasada por cada par. Por eso solo lee los candidatos que ya juntó la fusión, no todo el índice.

Contrato:
- Reranker(clave="reranker") carga modelo/<clave>/ (model.onnx con onnxruntime y tokenizer.json con tokenizers).
  Antes de usarlo comprueba el sha256 de los dos archivos contra el catálogo (mundo/modelos.json); si no coinciden,
  ValueError. El tokenizer corta cada par en max_tokens del catálogo (512).
  - .firma() → {"clave", "repo", "revision", "sha256" (el de model.onnx)}.
  - .puntuar(pregunta, textos) → numpy.ndarray float32 de forma (len(textos),): un puntaje por pasaje, el logit del
    modelo para el par (pregunta, pasaje). Más alto = más relevante. Pasa los pares en lotes de config reranker.lote.
    Con textos vacío, un arreglo vacío.
- reordenar(reranker, pregunta, candidatos, textos) → [(chunk_id, puntaje)]: candidatos es una lista de chunk_ids y
  textos un {chunk_id: texto}; el reranker puntúa cada uno y regresan de mayor a menor (empates: el orden de entrada).
"""

from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
from _comun import MODELO, config, modelos, sha256_archivo


class Reranker:

    def __init__(self, clave: str = "reranker"):
        raise NotImplementedError("paso 3: Reranker.__init__")

    def firma(self) -> dict:
        raise NotImplementedError("paso 3: Reranker.firma")

    def puntuar(self, pregunta: str, textos: list[str]) -> np.ndarray:
        raise NotImplementedError("paso 3: Reranker.puntuar")


def reordenar(reranker: Reranker, pregunta: str, candidatos: list[str], textos: dict) -> list[tuple[str, float]]:
    raise NotImplementedError("paso 3: reordenar")


if __name__ == "__main__":
    # python pipeline/reranker.py "pregunta" "pasaje uno" "pasaje dos" ...  → el puntaje de cada par, de mayor a menor
    import time

    if len(sys.argv) < 3:
        sys.exit('uso: python pipeline/reranker.py "pregunta" "pasaje" ["otro pasaje" ...]')
    t = time.perf_counter()
    r = Reranker()
    print(f"{r.clave}: {r.info['repo']} @ {r.info['revision'][:12]} · cargado en {time.perf_counter() - t:.1f} s")
    t = time.perf_counter()
    s = r.puntuar(sys.argv[1], sys.argv[2:])
    print(f"  {len(s)} pares en {(time.perf_counter() - t) * 1000:.0f} ms")
    for i in np.argsort(-s, kind="stable"):
        print(f"  {s[i]:7.2f}  «{sys.argv[2 + i][:90]}»")
