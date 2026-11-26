"""Crea el mundo: el 21 de noviembre a las 11:00 de Ciudad de México, con lo que dejó la estación 3.

    python mundo/crear.py                # desde cero
    python mundo/crear.py --directorio   # vuelve a sincronizar almacen/directorio.json con el directorio de la empresa
    python mundo/crear.py --candidatos   # vuelve a bajar las preguntas de los expertos de su repositorio
    python mundo/crear.py --afinado      # vuelve a bajar los ejemplos del equipo del prompt de su repositorio

Copia mundo/entrada/ a almacen/: el corpus (corpus/vigente.json, el índice de la estación 3: 154 chunks con su texto y su
ACL, y corpus/historial/, cada versión que ha existido), el directorio de las 10:30 (con los cambios de la mañana), las
candidatas de los expertos (candidatos/expertos.jsonl), los ejemplos de afinado (afinado/ejemplos.jsonl) y un
registro vacío (registro/, el bucket donde se publica cada versión del golden). Siempre crea lo mismo; si ya existía,
lo reemplaza. Tu carpeta golden/ también se borra: es un mundo nuevo.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALMACEN, DIAS, ENTRADA, GOLDEN, MUNDO, escribir_json, hora, leer_json, leer_jsonl  # noqa: E402


def poner_corpus(dia: str) -> dict:
    version, _ = DIAS[dia]
    c = leer_json(ENTRADA / "corpus" / f"{version}.json")
    (ALMACEN / "corpus" / "historial").mkdir(parents=True, exist_ok=True)
    shutil.copy(ENTRADA / "corpus" / f"{version}.json", ALMACEN / "corpus" / "historial" / f"{version}.json")
    shutil.copy(ENTRADA / "corpus" / f"{version}.json", ALMACEN / "corpus" / "vigente.json")
    return c


def directorio() -> dict:
    shutil.copy(ENTRADA / "directorio.json", ALMACEN / "directorio.json")
    return leer_json(ALMACEN / "directorio.json")


def candidatos() -> int:
    shutil.rmtree(ALMACEN / "candidatos", ignore_errors=True)
    shutil.copytree(ENTRADA / "candidatos", ALMACEN / "candidatos")
    return len(leer_jsonl(ALMACEN / "candidatos" / "expertos.jsonl"))


def afinado() -> int:
    shutil.rmtree(ALMACEN / "afinado", ignore_errors=True)
    shutil.copytree(ENTRADA / "afinado", ALMACEN / "afinado")
    return len(leer_jsonl(ALMACEN / "afinado" / "ejemplos.jsonl"))


if __name__ == "__main__":
    if "--directorio" in sys.argv:
        d = directorio()
        print(f"✓ almacen/directorio.json sincronizado con el directorio de la empresa (foto de las {hora(d['foto'])})")
        sys.exit(0)
    if "--candidatos" in sys.argv:
        print(f"✓ almacen/candidatos/expertos.jsonl otra vez como en el repositorio de los expertos: {candidatos()} candidatas")
        sys.exit(0)
    if "--afinado" in sys.argv:
        print(f"✓ almacen/afinado/ejemplos.jsonl otra vez como en el repositorio del equipo del prompt: {afinado()} ejemplos")
        sys.exit(0)
    shutil.rmtree(ALMACEN, ignore_errors=True)
    shutil.rmtree(GOLDEN, ignore_errors=True)
    c = poner_corpus("21")
    d = directorio()
    n, a = candidatos(), afinado()
    (ALMACEN / "registro").mkdir(parents=True)
    escribir_json(MUNDO, {"reloj": DIAS["21"][1], "dia": "21"})
    docs = {x["doc_id"] for x in c["chunks"].values()}
    print(f"✓ {hora(DIAS['21'][1])} (Ciudad de México): {c['version']} con {len(c['chunks'])} chunks de {len(docs)} documentos · "
          f"{len(d['personas'])} personas en el directorio · {n} candidatas de los expertos · {a} ejemplos de afinado · registro vacío")
    print("  siguiente: python verificar.py mundo")
