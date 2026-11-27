"""Viene de la estación 5 : no lo tienes que escribir. Paso 7: el alias. La API de búsqueda nunca nombra un índice: nombra el alias, y el alias apunta al vigente.
Cambiar de índice es cambiar a dónde apunta, de un jalón, con forma de volver atrás.

Contrato (indices/alias.json = {alias: {"actual", "anterior", "historial": [{"fecha", "de", "a"}]}}):
- resolver(alias) → el nombre del índice al que apunta, o None.
- apuntar(alias, nombre): solo si revisar(nombre) no encuentra problemas (si no, ValueError con el primero). El que
  estaba pasa a "anterior" (para volver), y se anota en el historial con la fecha real (UTC). Se escribe con
  escribir_json: quien lo lea a la mitad ve el viejo o el nuevo, nunca uno a medias.
- volver(alias): apunta otra vez al "anterior" (que también se revisa) y el que estaba queda como anterior.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import ALIAS, escribir_json, leer_json  # noqa: E402
from construir import revisar  # noqa: E402


def leer() -> dict:
    return leer_json(ALIAS, {})


def resolver(alias: str) -> str | None:
    return leer().get(alias, {}).get("actual")


def apuntar(alias: str, nombre: str) -> None:
    p = revisar(nombre)
    if p:
        raise ValueError(f"no muevo {alias} a {nombre}: {p[0]}")
    a = leer()
    x = a.get(alias, {})
    if x.get("actual") == nombre:
        return
    a[alias] = {"actual": nombre, "anterior": x.get("actual"),
                "historial": x.get("historial", []) + [{"fecha": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "de": x.get("actual"), "a": nombre}]}
    escribir_json(ALIAS, a)


def volver(alias: str) -> str:
    x = leer().get(alias, {})
    if not x.get("anterior"):
        raise ValueError(f"{alias} no tiene a dónde volver")
    destino = x["anterior"]
    apuntar(alias, destino)
    return destino


if __name__ == "__main__":
    # python pipeline/alias.py listar | cambiar <alias> <índice> | volver <alias>
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("accion", choices=["listar", "cambiar", "volver"])
    ap.add_argument("args", nargs="*")
    a = ap.parse_args()
    try:
        if a.accion == "cambiar":
            antes = resolver(a.args[0])
            apuntar(*a.args)
            print(f"✓ {a.args[0]}: {antes} → {a.args[1]}")
        elif a.accion == "volver":
            antes = resolver(a.args[0])
            print(f"✓ {a.args[0]}: {antes} → {volver(a.args[0])} (de vuelta)")
    except ValueError as e:
        sys.exit(f"✗ {e}")
    for al, x in leer().items():
        print(f"{al} → {x['actual']}   (anterior: {x['anterior']} · {len(x['historial'])} cambio(s))")
