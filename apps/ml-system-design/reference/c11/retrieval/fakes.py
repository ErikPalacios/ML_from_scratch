"""Fakes deterministas para tests y demo (caso c11). NINGUNO es un modelo: imitan la FORMA de las interfaces.

- HashingEmbedder: "embedding" por hashing trick de palabras (bolsa de palabras proyectada a `dim` y normalizada).
  Dos textos con palabras en común quedan cerca; sinónimos y otros idiomas NO (un modelo multilingüe real sí).
  Implementa las dos interfaces: embed() (lotes, para la ingesta) y encode() (una pregunta, async, para la consulta).
- OverlapReranker: score = fracción de las palabras de ≥ 4 letras de la pregunta que aparecen en el chunk (las cortas
  — "el", "en", "es" — están en todos lados). Un cross-encoder real lee pregunta y chunk JUNTOS; esto solo permite
  probar el cableado (orden, timeout, umbral).

En producción (el caso, #c11.serving): un modelo de embeddings multilingüe (español, inglés, portugués) de
d = 1024 y un cross-encoder multilingüe, los dos en GPU detrás de un servidor de inferencia. La elección concreta
(nombre, licencia, dimensión) es del caso y se verifica con su model card; estos archivos no dependen de ella.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # encode/rerank async como los clientes reales
import hashlib  # hash estable entre procesos (hash() de Python cambia con PYTHONHASHSEED)
from collections.abc import Sequence  # tipos

import numpy as np  # vectores

from hybrid import analyze  # mismo analizador que BM25: minúsculas y sin acentos


class HashingEmbedder:
    def __init__(self, dim: int = 256, model_version: str = "hash-v1"):
        self.dim = dim
        self.model_version = model_version  # va en cada chunk: un índice = un modelo
        self.calls = 0  # cuántos textos se embebieron (los tests de la ingesta incremental lo miran)
        self.fail = False  # para simular la GPU caída
        self.delay_s = 0.0

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        for w in analyze(text):
            h = int.from_bytes(hashlib.blake2b(w.encode(), digest_size=8).digest(), "little")
            v[h % self.dim] += 1.0 if (h >> 63) == 0 else -1.0  # signo del hash: reduce colisiones sesgadas
        n = float(np.linalg.norm(v))
        return v / n if n else v

    def embed(self, texts: Sequence[str]) -> list[tuple[float, ...]]:
        if self.fail:
            raise ConnectionError("encoder no disponible (simulado)")
        self.calls += len(texts)
        return [tuple(float(x) for x in self._vec(t)) for t in texts]

    async def encode(self, text: str) -> np.ndarray:
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.fail:
            raise ConnectionError("encoder no disponible (simulado)")
        return self._vec(text)


class OverlapReranker:
    def __init__(self, delay_s: float = 0.0, fail: bool = False):
        self.delay_s, self.fail = delay_s, fail
        self.calls = 0

    async def rerank(self, query: str, texts: Sequence[str]) -> list[float]:
        self.calls += 1
        if self.delay_s:
            await asyncio.sleep(self.delay_s)
        if self.fail:
            raise ConnectionError("reranker no disponible (simulado)")
        q = {w for w in analyze(query) if len(w) >= 4}
        if not q:
            return [0.0] * len(texts)
        return [len(q & set(analyze(t))) / len(q) for t in texts]
