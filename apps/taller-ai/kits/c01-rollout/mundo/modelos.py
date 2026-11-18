"""El registro de modelos del dojo: las versiones de classifier, sus alias y sus etiquetas (en C01: el Model Registry de
MLflow de la estación 4). Guarda todo en .taller/registro-modelos.json; lo crea mundo/crear.py.

    python3 mundo/modelos.py ver                                   # versiones, alias y etiquetas
    python3 mundo/modelos.py alias champion 15 [--tag k=v ...]     # mueve un alias (y pone etiquetas a esa versión)
    python3 mundo/modelos.py version champion                      # imprime solo el número de la versión del alias

Ningún servidor lee el alias (estación 4): el pipeline lo lee una vez. Aquí lo mueve ci/promover.py al final del
rollout, cuando ya es verdad.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import MODELOS, escribir_json, leer_json  # noqa: E402

INICIAL = {
    "modelo": "classifier",
    "versiones": {
        "14": {"model_version": "resnet50-2026-10-01", "run": "run-2026-10-01-a41c", "tags": {}},
        "15": {"model_version": "resnet50-2026-11-01", "run": "run-2026-11-01-7d2e", "tags": {}},
    },
    "alias": {"champion": "14", "challenger": "15"},
    "historia": [],
}


def leer() -> dict:
    return leer_json(MODELOS) or {}


def crear() -> None:
    if not leer():
        escribir_json(MODELOS, INICIAL)


def mover(alias: str, version: str, tags: dict | None = None, quien: str = "tú") -> dict:
    r = leer()
    if version not in r.get("versiones", {}):
        raise SystemExit(f"✗ no existe la versión {version} de classifier (hay: {', '.join(r.get('versiones', {}))})")
    antes = r["alias"].get(alias)
    r["alias"][alias] = version
    r["versiones"][version]["tags"].update(tags or {})
    r["historia"].append({"fecha": datetime.now(timezone.utc).isoformat(timespec="seconds"), "alias": alias,
                          "de": antes, "a": version, "quien": quien, "tags": tags or {}})
    escribir_json(MODELOS, r)
    return r


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ver")
    a = sub.add_parser("alias")
    a.add_argument("alias")
    a.add_argument("version")
    a.add_argument("--tag", action="append", default=[])
    v = sub.add_parser("version")
    v.add_argument("alias")
    x = ap.parse_args()
    r = leer()
    if not r:
        sys.exit("✗ no hay registro de modelos: python3 mundo/crear.py")
    if x.cmd == "ver":
        for n, d in r["versiones"].items():
            al = [k for k, w in r["alias"].items() if w == n]
            print(f"v{n}  {d['model_version']}  run {d['run']}" + (f"  @{' @'.join(al)}" if al else "")
                  + "".join(f"\n      {k}={w}" for k, w in d["tags"].items()))
    elif x.cmd == "version":
        print(r["alias"].get(x.alias, ""))
    else:
        tags = dict(t.split("=", 1) for t in x.tag)
        mover(x.alias, x.version, tags)
        print(f"✓ @{x.alias} → v{x.version} ({r['versiones'][x.version]['model_version']})")


if __name__ == "__main__":
    main()
