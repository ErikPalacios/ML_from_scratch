"""Paso 4 · Splits que no se mueven: cada pregunta es de dev o de test para siempre.

    python pipeline/splits.py G-001 G-002 G-009        # en qué split cae cada id

Contrato:
- split_de(id, sal, test) -> "test" o "dev". Toma los primeros 8 caracteres hexadecimales del sha256 de "<sal>|<id>",
  los vuelve entero y saca el residuo entre 100: si es menor que `test`, "test"; si no, "dev". Depende solo del id:
  ni del orden, ni de cuántas preguntas haya, ni de la hora.
- asignar(ids, anteriores, sal, test) -> {id: split}. Un id que ya tenía split (en `anteriores`, {id: split} de las
  versiones publicadas) se queda con ese, aunque la sal o el porcentaje hayan cambiado; uno nuevo usa split_de().
"""

from __future__ import annotations
import argparse
import hashlib
from _comun import config


def split_de(id_: str, sal: str, test: int) -> str:
    raise NotImplementedError("paso 4: split_de")


def asignar(ids, anteriores: dict, sal: str, test: int) -> dict:
    raise NotImplementedError("paso 4: asignar")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="+")
    a = ap.parse_args()
    s = config()["splits"]
    for i in a.ids:
        print(f"{i} → {split_de(i, s['sal'], s['test'])}")
