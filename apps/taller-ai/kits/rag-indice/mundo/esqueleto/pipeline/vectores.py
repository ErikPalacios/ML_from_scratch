"""Paso 4: el índice de vectores y la búsqueda por similitud, con la ACL como filtro antes de elegir el top.

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
from embeber import Modelo, embeber_chunks


def construir(chunks: dict, modelo: Modelo) -> tuple[list[str], np.ndarray, list[dict]]:
    raise NotImplementedError("paso 4: construir")


def top(matriz: np.ndarray, ids: list[str], vector: np.ndarray, permitidos: np.ndarray, k: int) -> list[tuple[str, float]]:
    raise NotImplementedError("paso 4: top")
