"""Crea el mundo: el 21 de noviembre a las 9:00 de Ciudad de México, con lo que dejó la estación 2.

    python mundo/crear.py                # desde cero
    python mundo/crear.py --rechunkear   # vuelve a dejar almacen/docs/ como lo deja la estación 2 (hace del chunking
                                         # corrido otra vez, ya arreglado); no toca el reloj, el directorio ni la cola

Copia mundo/entrada/ a almacen/: docs/<doc>.json (los chunks de cada documento, con su ACL y cuándo la leyó la
ingestión, «acl_leida»), directorio.json (la foto del directorio de la empresa a las 9:00: personas y grupos) y una
cola de eventos vacía (eventos.jsonl). Siempre crea lo mismo. Si ya existía, lo reemplaza. Tu carpeta indice/ no la toca.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALMACEN, ENTRADA, INICIO, MUNDO, escribir_json, hora, leer_json  # noqa: E402


def poner_docs() -> tuple[int, int]:
    shutil.rmtree(ALMACEN / "docs", ignore_errors=True)
    shutil.copytree(ENTRADA / "docs", ALMACEN / "docs")
    xs = [leer_json(p) for p in (ALMACEN / "docs").glob("*.json")]
    return len(xs), sum(len(x["chunks"]) for x in xs)


if __name__ == "__main__":
    if "--rechunkear" in sys.argv:
        n, c = poner_docs()
        print(f"✓ el chunking de la estación 2 volvió a dejar almacen/docs/: {n} documentos, {c} chunks, cada uno con su ACL")
        print("  siguiente: python pipeline/indexar.py")
        sys.exit(0)
    shutil.rmtree(ALMACEN, ignore_errors=True)
    n, c = poner_docs()
    d = leer_json(ENTRADA / "directorio.json")
    escribir_json(ALMACEN / "directorio.json", d)
    (ALMACEN / "eventos.jsonl").write_text("")
    escribir_json(MUNDO, {"reloj": INICIO})
    print(f"✓ el 21 de noviembre a las {hora(INICIO)} (Ciudad de México): {n} documentos y {c} chunks de la estación 2 · "
          f"{len(d['personas'])} personas y {len(d['grupos'])} grupos en el directorio · la cola de permisos, vacía")
    print("  siguiente: python verificar.py mundo")
