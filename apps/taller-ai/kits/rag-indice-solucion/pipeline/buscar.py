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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bm25 as bm25_  # noqa: E402
import vectores as vectores_  # noqa: E402
from _comun import INDICES, config, directorio, leer_json, leer_jsonl, modelos, principals, puede_ver  # noqa: E402
from alias import resolver  # noqa: E402
from construir import revisar  # noqa: E402
from embeber import Modelo  # noqa: E402

_MODELOS: dict[str, Modelo] = {}


class ModeloDistinto(Exception):
    pass


class Buscador:
    def __init__(self, nombre: str, modelo_consulta: str, exigir_mismo_modelo: bool = True):
        p = revisar(nombre)
        if p:
            raise ValueError(p[0])
        carpeta = INDICES / nombre
        self.nombre = nombre
        self.manifiesto = leer_json(carpeta / "manifiesto.json")
        firma = self.manifiesto["modelo"]
        cat = modelos().get(modelo_consulta, {})
        if (modelo_consulta, cat.get("revision")) != (firma["clave"], firma["revision"]) and exigir_mismo_modelo:
            raise ModeloDistinto(f"{nombre} se hizo con {firma['clave']} @ {firma['revision'][:12]} y la consulta se "
                                 f"embebería con {modelo_consulta} @ {str(cat.get('revision'))[:12]}: sus vectores no se comparan")
        meta = {x["chunk_id"]: x for x in leer_jsonl(carpeta / "chunks.jsonl")}
        vj = leer_json(carpeta / "vectores.json")
        self.ids = vj["ids"]
        self.acl = [meta[k]["acl"] for k in self.ids]
        self.matriz = np.load(carpeta / "vectores.npy")
        self.ix_bm25 = leer_json(carpeta / "bm25.json")
        if modelo_consulta not in _MODELOS:
            _MODELOS[modelo_consulta] = Modelo(modelo_consulta)
        self.modelo = _MODELOS[modelo_consulta]
        self._dir = directorio()

    def visibles(self, persona: str) -> np.ndarray:
        ps = principals(persona, self._dir)
        return np.array([puede_ver(a, ps) for a in self.acl], dtype=bool)

    def bm25(self, pregunta: str, persona: str, k: int = 8) -> list[tuple[str, float]]:
        ok = dict(zip(self.ids, self.visibles(persona)))
        s = [(k_, v) for k_, v in bm25_.puntajes(self.ix_bm25, pregunta).items() if ok.get(k_)]
        return sorted(s, key=lambda x: (-x[1], x[0]))[:k]

    def vectores(self, pregunta: str, persona: str, k: int = 8) -> list[tuple[str, float]]:
        v = self.modelo.embeber([pregunta], "consulta")[0]
        return vectores_.top(self.matriz, self.ids, v, self.visibles(persona), k)


def modelo_de_consulta(nombre: str) -> str:
    m = config()["servicio"]["modelo_consulta"]
    if m != "del-indice":
        return m
    man = leer_json(INDICES / nombre / "manifiesto.json")
    if not man:
        raise ValueError(f"indices/{nombre}/ no tiene manifiesto.json")
    return man["modelo"]["clave"]


def abrir(alias: str | None = None) -> Buscador:
    alias = alias or config()["servicio"]["alias"]
    nombre = resolver(alias)
    if not nombre:
        raise ValueError(f"el alias {alias} no apunta a ningún índice (indices/alias.json)")
    return Buscador(nombre, modelo_de_consulta(nombre))


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
