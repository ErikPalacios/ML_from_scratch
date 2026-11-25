"""Crea el mundo: el almacén como lo dejó la estación 1 el día 1 (20 de noviembre, 9:00 de Ciudad de México).

    python mundo/crear.py                # el día 1, desde cero
    python mundo/crear.py --reingestar   # vuelve a dejar el almacén del día en que está el mundo (hace de la
                                         # ingestión de la estación 1 corrida otra vez, ya arreglada)

Copia mundo/entrada/ a almacen/: catalogo.json (un registro por documento, con su hash y su ACL) y texto/<hash>.json
(el texto de cada documento). Son los 101 documentos de la estación 1 más tres largos que operaciones subió esa
semana (un manual, una tabla de tarifas y una página de niveles de servicio). Siempre crea lo mismo.
Si ya existía, lo reemplaza. Tu carpeta chunks/ no la toca.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALMACEN, ENTRADA, MUNDO, entrada, escribir_json  # noqa: E402

RELOJ = {1: "2026-11-20T15:00:00Z", 2: "2026-11-21T15:00:00Z"}


def poner(dia: int) -> dict:
    """Deja en almacen/ el catálogo de ese día y los textos que usa."""
    c = entrada(dia)
    (ALMACEN / "texto").mkdir(parents=True, exist_ok=True)
    for r in c.values():
        p = ENTRADA / "texto" / f"{r['hash']}.json"
        if p.exists() and not (ALMACEN / "texto" / p.name).exists():
            shutil.copy(p, ALMACEN / "texto" / p.name)
    escribir_json(ALMACEN / "catalogo.json", c)
    return c


def resumen(c: dict) -> str:
    vivos = [r for r in c.values() if not r["borrado"]]
    por = {}
    for r in vivos:
        por[r["fuente"]] = por.get(r["fuente"], 0) + 1
    return " · ".join(f"{f} {n}" for f, n in sorted(por.items())) + f" · {len(vivos)} documentos vivos" + \
        (f" y {len(c) - len(vivos)} lápidas" if len(c) > len(vivos) else "")


if __name__ == "__main__":
    if "--reingestar" in sys.argv:
        from mundo.comun import mundo

        m = mundo()
        c = poner(m["dia"])
        print(f"✓ la ingestión volvió a dejar el almacén del día {m['dia']}: {resumen(c)}")
        print("  siguiente: python pipeline/chunkear.py")
        sys.exit(0)
    shutil.rmtree(ALMACEN, ignore_errors=True)
    c = poner(1)
    escribir_json(MUNDO, {"dia": 1, "reloj": RELOJ[1]})
    print(f"✓ almacén de la estación 1 al {RELOJ[1]}: {resumen(c)}")
    print("  siguiente: python verificar.py mundo")
