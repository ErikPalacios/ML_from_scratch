"""Paso 1 · Quién es quién: los principals de una persona, con sus grupos anidados.

Contrato:
- El directorio (almacen/directorio.json es la foto del IdP; tu copia vive en indice/directorio.json) es
  {"dominio", "foto", "personas": {correo: {"nombre", "area"}},
   "grupos": {"group:<correo del grupo>": {"nombre", "miembros": ["user:<correo>" o "group:<correo>", …]}}}.
  Un grupo puede estar dentro de otro: sus miembros son también miembros del de afuera (grupo anidado).
- principals(correo, directorio, profundidad) devuelve el set de principals de esa persona: "user:<correo>",
  "domain:<lo que va después de la @>" y cada grupo al que pertenece, directo o por anidamiento, hasta `profundidad`
  niveles (1 = solo sus grupos directos). Nunca se cuelga con un ciclo (un grupo dentro de otro que está dentro del primero).
- Una persona que no está en el directorio no tiene principals: set() (fail-closed).
- copia() lee indice/directorio.json (la copia que mantienen el carril rápido y el reindexado); guardar_copia(d) la escribe.
"""
from __future__ import annotations

from _comun import COPIA, escribir_json, leer_json


def principals(correo: str, directorio: dict, profundidad: int) -> set[str]:
    if correo not in directorio["personas"]:
        return set()
    padres: dict[str, set[str]] = {}            # miembro → los grupos que lo tienen adentro
    for grupo, x in directorio["grupos"].items():
        for m in x["miembros"]:
            padres.setdefault(m, set()).add(grupo)
    yo = f"user:{correo}"
    out = {yo, "domain:" + correo.split("@", 1)[1]}
    frontera = {yo}
    for _ in range(profundidad):                # un nivel por vuelta: mis grupos, los grupos de mis grupos…
        nuevos = {g for m in frontera for g in padres.get(m, ())} - out    # «- out»: lo ya visto no se repite (ciclos)
        if not nuevos:
            break
        out |= nuevos
        frontera = nuevos
    return out


def copia() -> dict:
    d = leer_json(COPIA)
    if d is None:
        raise SystemExit("✗ no hay copia del directorio en indice/: python pipeline/indexar.py")
    return d


def guardar_copia(d: dict) -> None:
    escribir_json(COPIA, d)
