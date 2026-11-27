"""Paso 6 y 7: abrir un índice y buscar en él, por BM25 y por vectores, cada uno por separado, con los permisos de
quien pregunta como filtro. Es lo que usa la API de búsqueda (mundo/servicio.py) y lo que la estación 6 va a fusionar.

Contrato:
- class ModeloDistinto(Exception): la pregunta se embebería con un modelo distinto del que hizo el índice.
- Buscador(nombre, modelo_consulta, exigir_mismo_modelo=True): abre indices/<nombre>/. Si revisar(nombre) encuentra
  problemas, ValueError. Si modelo_consulta (una clave del catálogo) no es el modelo del manifiesto (clave y revisión),
  ModeloDistinto, salvo que exigir_mismo_modelo=False (solo para ver qué pasaría). Carga chunks.jsonl, bm25.json,
  vectores.npy/.json y el Modelo de la consulta (uno por clave, guardado entre Buscadores: cargar cuesta).
  - .nombre, .manifiesto
  - .visibles(persona) → arreglo de booleanos (en el orden de los ids de vectores.json): qué chunks puede leer, con
    principals y puede_ver de la estación 3 y el directorio de almacen/.
  - .bm25(pregunta, persona, k=8) → [(chunk_id, puntaje)]: el top-k de BM25 entre los que ve, de mayor a menor (empates
    por chunk_id); solo chunks con puntaje > 0.
  - .vectores(pregunta, persona, k=8) → [(chunk_id, similitud)]: la pregunta embebida como «consulta» y vectores.top.
- modelo_de_consulta(nombre) → la clave con la que se embebe la pregunta: config servicio.modelo_consulta, y si dice
  "del-indice", la del manifiesto del índice (lo correcto: el índice dice qué modelo lo hizo).
- abrir(alias=None) → Buscador del índice al que apunta el alias (config servicio.alias si no se da), con
  modelo_de_consulta(). Si el alias no apunta a nada, ValueError.
"""

from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
import bm25 as bm25_
import vectores as vectores_
from _comun import INDICES, config, directorio, leer_json, leer_jsonl, modelos, principals, puede_ver
from alias import resolver
from construir import revisar
from embeber import Modelo


class ModeloDistinto(Exception):
    pass


class Buscador:

    def __init__(self, nombre: str, modelo_consulta: str, exigir_mismo_modelo: bool = True):
        raise NotImplementedError("paso 6: Buscador.__init__")

    def visibles(self, persona: str) -> np.ndarray:
        raise NotImplementedError("paso 6: Buscador.visibles")

    def bm25(self, pregunta: str, persona: str, k: int = 8) -> list[tuple[str, float]]:
        raise NotImplementedError("paso 6: Buscador.bm25")

    def vectores(self, pregunta: str, persona: str, k: int = 8) -> list[tuple[str, float]]:
        raise NotImplementedError("paso 6: Buscador.vectores")


def modelo_de_consulta(nombre: str) -> str:
    raise NotImplementedError("paso 7: modelo_de_consulta")


def abrir(alias: str | None = None) -> Buscador:
    raise NotImplementedError("paso 6: abrir")


if __name__ == "__main__":
    # python pipeline/buscar.py --persona elena.cruz@marketplace.test "una pregunta"  → lo que encuentra cada índice
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", required=True)
    ap.add_argument("--indice", help="un índice por nombre, en vez del alias")
    ap.add_argument("-k", type=int, default=8)
    ap.add_argument("pregunta", nargs="+")
    a = ap.parse_args()
    q = " ".join(a.pregunta)
    try:
        b = Buscador(a.indice, modelo_de_consulta(a.indice)) if a.indice else abrir()
    except (ValueError, ModeloDistinto) as e:
        sys.exit(f"✗ {e}")
    print(f"{b.nombre} · {a.persona} ve {int(b.visibles(a.persona).sum())} de {len(b.ids)} chunks")
    xb, xv = b.bm25(q, a.persona, a.k), b.vectores(q, a.persona, a.k)
    print(f"  {'BM25':<34}{'vectores':<34}")
    for i in range(max(len(xb), len(xv))):
        cb = f"{xb[i][1]:6.2f}  {xb[i][0]}" if i < len(xb) else ""
        cv = f"{xv[i][1]:6.3f}  {xv[i][0]}" if i < len(xv) else ""
        print(f"  {cb:<34}{cv:<34}")
