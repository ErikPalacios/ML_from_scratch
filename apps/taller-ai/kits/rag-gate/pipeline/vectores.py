"""Viene de la estación 5 : no lo tienes que escribir. Paso 4: el índice de vectores y la búsqueda por similitud, con la ACL como filtro antes de elegir el top.

Contrato:
- construir(chunks, modelo) → (ids, matriz, filas): ids = sorted(chunk_ids); matriz = los vectores de pasaje de
  embeber_chunks (float32, forma (n, dim), cada fila de largo 1); filas = [{"chunk_id", "modelo": "<clave>@<revision[:12]>"}]
  en el mismo orden: qué modelo hizo cada fila.
- top(matriz, ids, vector, permitidos, k) → [(chunk_id, similitud)] los k más parecidos a vector (la pregunta ya
  embebida), de mayor a menor, SOLO entre los permitidos (un arreglo de booleanos, uno por fila). Primero se filtra y
  después se elige el top: si la persona ve al menos k chunks, siempre regresan k.
  Con vectores de largo 1, la similitud coseno es el producto punto: matriz @ vector.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from embeber import Modelo, embeber_chunks  # noqa: E402


def construir(chunks: dict, modelo: Modelo) -> tuple[list[str], np.ndarray, list[dict]]:
    ids, matriz, _ = embeber_chunks(chunks, modelo)
    etiqueta = f"{modelo.clave}@{modelo.info['revision'][:12]}"
    return ids, matriz, [{"chunk_id": k, "modelo": etiqueta} for k in ids]


def top(matriz: np.ndarray, ids: list[str], vector: np.ndarray, permitidos: np.ndarray, k: int) -> list[tuple[str, float]]:
    s = matriz @ vector
    s = np.where(permitidos, s, -np.inf)
    orden = np.argsort(-s, kind="stable")[:k]
    return [(ids[i], float(s[i])) for i in orden if permitidos[i]]
