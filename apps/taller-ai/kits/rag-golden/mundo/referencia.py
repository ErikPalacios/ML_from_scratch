"""La verdad del mundo: el corpus de cada día, el directorio de verdad, cómo se mueve cada chunk entre re-ingestas y
qué pasa con cada pregunta. La usan verificar.py y romper.py. No la leas para resolver un paso: es la respuesta del equipo.
"""
from __future__ import annotations

import hashlib
import sys
from functools import lru_cache

from mundo.comun import DIAS, ENTRADA, RAIZ, leer_json, leer_jsonl, mundo

sys.path.insert(0, str(RAIZ / "pipeline"))
from _comun import cuerpo, palabras, principals, puede_ver  # noqa: E402  — lo que viene dado (estación 3)

UMBRAL = 0.6          # C11: dos preguntas del mismo tipo con Jaccard ≥ 0.6 son la misma
CUOTAS = {"varias": 0.15, "sin_respuesta": 0.10, "prohibida": 0.10}
SAL, TEST = "golden-c11", 75


@lru_cache(maxsize=4)
def corpus(version: str) -> dict:
    return leer_json(ENTRADA / "corpus" / f"{version}.json")


def version_hoy() -> str:
    return DIAS[mundo()["dia"]][0]


def hoy() -> dict:
    return corpus(version_hoy())


@lru_cache(maxsize=1)
def directorio() -> dict:
    return leer_json(ENTRADA / "directorio.json")


def candidatas() -> list[dict]:
    return leer_jsonl(ENTRADA / "candidatos" / "expertos.jsonl")


def sha(texto: str) -> str:
    return hashlib.sha256(texto.encode()).hexdigest()[:16]


def ve(persona: str, chunk: dict) -> bool:
    return puede_ver(chunk["acl"], principals(persona, directorio()))


def similitud(a: str, b: str) -> float:
    x, y = set(palabras(a)), set(palabras(b))
    return len(x & y) / len(x | y) if x | y else 0.0


def split_de(id_: str) -> str:
    return "test" if int(hashlib.sha256(f"{SAL}|{id_}".encode()).hexdigest()[:8], 16) % 100 < TEST else "dev"


def mapa(viejo: dict, nuevo: dict) -> dict:
    por_doc: dict[str, list] = {}
    for k in sorted(nuevo["chunks"]):
        por_doc.setdefault(nuevo["chunks"][k]["doc_id"], []).append(k)
    out = {}
    for k, x in sorted(viejo["chunks"].items()):
        cs = por_doc.get(x["doc_id"], [])
        igual = next((n for n in cs if nuevo["chunks"][n]["texto"] == x["texto"]), None)
        dentro = next((n for n in cs if cuerpo(x["texto"]) in nuevo["chunks"][n]["texto"]), None)
        out[k] = {"a": igual, "por": "sha"} if igual else {"a": dentro, "por": "contenido"} if dentro else \
            {"a": None, "por": "cambio" if cs else "borrado"}
    return out


def destino(fuentes: list[str], desde: str, hasta: str) -> tuple[str, list[str]]:
    """Qué le pasa a una lista de fuentes del corpus `desde` al llegar al corpus `hasta`: ("sigue", fuentes nuevas),
    ("retirada", []) o ("revisar", [])."""
    orden = [v for v, _ in DIAS.values()]
    fs = list(fuentes)
    for a, b in zip(orden, orden[1:]):
        if orden.index(a) < orden.index(desde) or orden.index(b) > orden.index(hasta):
            continue
        m = mapa(corpus(a), corpus(b))
        nuevas = []
        for f in fs:
            x = m.get(f)
            if x is None:
                nuevas.append(f)
            elif x["por"] == "borrado":
                return "retirada", []
            elif x["por"] == "cambio":
                return "revisar", []
            else:
                nuevas.append(x["a"])
        fs = list(dict.fromkeys(nuevas))
    return "sigue", fs
