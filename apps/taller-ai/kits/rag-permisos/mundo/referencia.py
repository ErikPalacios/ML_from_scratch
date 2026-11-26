"""La verdad del mundo: quién está en qué grupo y qué ACL tiene cada documento en cada momento de la mañana (de
mundo/entrada/, no de tu almacén ni de tu índice), y por lo tanto qué chunks puede ver cada persona.
La usan verificar.py y mundo/avanzar.py. No la leas para resolver un paso: es la respuesta del equipo.
"""
from __future__ import annotations

import copy
from functools import lru_cache

from mundo.comun import ENTRADA, INICIO, leer_json, mundo


@lru_cache(maxsize=1)
def docs() -> dict:
    """doc_id → el documento tal como lo dejó la estación 2 (con sus chunks y su ACL de las 9:05)."""
    return {x["doc_id"]: x for x in (leer_json(p) for p in sorted((ENTRADA / "docs").glob("*.json")))}


@lru_cache(maxsize=1)
def _directorio0() -> dict:
    return leer_json(ENTRADA / "directorio.json")


def eventos() -> list[dict]:
    return leer_json(ENTRADA / "eventos.json")


def personas() -> list[str]:
    return sorted(_directorio0()["personas"])


def ahora() -> str:
    return mundo()["reloj"]


def directorio(en: str | None = None) -> dict:
    """El directorio verdadero en ese momento (el del reloj, si no se dice): la foto de las 9:00 más lo que cambió."""
    en = en or ahora()
    d = copy.deepcopy(_directorio0())
    for e in eventos():
        if e["tipo"] == "membresia" and e["ocurrio"] <= en:
            m = d["grupos"].setdefault(e["grupo"], {"nombre": e["grupo"], "miembros": []})["miembros"]
            if e["accion"] == "quitar" and e["miembro"] in m:
                m.remove(e["miembro"])
            elif e["accion"] == "agregar" and e["miembro"] not in m:
                m.append(e["miembro"])
                m.sort()
    return d


def acl(doc_id: str, en: str | None = None) -> list:
    en = en or ahora()
    a = docs()[doc_id]["acl"]
    for e in eventos():
        if e["tipo"] == "acl" and e["doc_id"] == doc_id and e["ocurrio"] <= en:
            a = e["acl"]
    return a


def principals(correo: str, d: dict, profundidad: int = 99) -> set[str]:
    if correo not in d["personas"]:
        return set()
    padres: dict[str, set] = {}
    for g, x in d["grupos"].items():
        for m in x["miembros"]:
            padres.setdefault(m, set()).add(g)
    out = {f"user:{correo}", "domain:" + correo.split("@", 1)[1]}
    frontera = {f"user:{correo}"}
    for _ in range(profundidad):
        nuevos = {g for m in frontera for g in padres.get(m, ())} - out
        if not nuevos:
            break
        out |= nuevos
        frontera = nuevos
    return out


def puede_ver(a, ps: set) -> bool:
    ok = isinstance(a, list) and a and all(isinstance(c, list) and c and all(isinstance(p, str) and p.split(":")[0] in ("user", "group", "domain") for p in c) for c in a)
    return bool(ok) and all(any(p in ps for p in c) for c in a)


def permitidos(correo: str, en: str | None = None) -> set[str]:
    """Los chunk_id que esa persona puede ver en ese momento, según la verdad."""
    en = en or ahora()
    ps = principals(correo, directorio(en))
    return {c["chunk_id"] for d, x in docs().items() if puede_ver(acl(d, en), ps) for c in x["chunks"]}


def doc_de(chunk_id: str) -> str:
    return chunk_id.rsplit("#", 1)[0]


def es_inicio() -> bool:
    return ahora() == INICIO
