"""Crea el mundo: el 22 de noviembre a las 11:00 de Ciudad de México, con lo que dejaron las estaciones 2 a 4.

    python mundo/crear.py                # desde cero (antes: python mundo/modelos.py, una vez)
    python mundo/crear.py --golden       # vuelve a bajar el golden set vigente del registro de la estación 4

Copia mundo/entrada/ a almacen/: el corpus (corpus/vigente.json: 151 chunks de 104 documentos, cada uno con su texto
que empieza con la ruta de títulos y su ACL en grupos), el directorio de la empresa y el golden set (golden/VIGENTE y
sus preguntas). Después hace lo que hizo anoche el job del piloto: el índice c11-minilm-2026-11-22, con BM25 y los
vectores de all-MiniLM-L6-v2, y el alias c11 apuntando a él. Siempre crea lo mismo; si ya existía, lo reemplaza.
Tus carpetas indices/ y cache/ también se borran: es un mundo nuevo. modelo/ no se toca.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALMACEN, CACHE, ENTRADA, INDICES, MUNDO, RELOJ, escribir_json, hora, leer_json, leer_jsonl, modelos_faltantes  # noqa: E402


def golden() -> tuple[str, int]:
    shutil.rmtree(ALMACEN / "golden", ignore_errors=True)
    shutil.copytree(ENTRADA / "registro-golden", ALMACEN / "golden")
    v = (ALMACEN / "golden" / "VIGENTE").read_text().strip()
    return v, len(leer_jsonl(ALMACEN / "golden" / v / "preguntas.jsonl"))


if __name__ == "__main__":
    if "--golden" in sys.argv:
        v, n = golden()
        print(f"✓ almacen/golden/ otra vez como en el registro de la estación 4: {v}, {n} preguntas")
        sys.exit(0)
    malos = modelos_faltantes()
    if malos:
        sys.exit(f"✗ faltan los modelos (o no son los del catálogo): {', '.join(malos)}\n  python mundo/modelos.py")
    shutil.rmtree(ALMACEN, ignore_errors=True)
    shutil.rmtree(INDICES, ignore_errors=True)
    shutil.rmtree(CACHE, ignore_errors=True)
    (ALMACEN / "corpus").mkdir(parents=True)
    shutil.copy(ENTRADA / "corpus" / "corpus-2026-11-22.json", ALMACEN / "corpus" / "vigente.json")
    shutil.copy(ENTRADA / "directorio.json", ALMACEN / "directorio.json")
    v, n = golden()
    escribir_json(MUNDO, {"reloj": RELOJ})
    from mundo import referencia as ref

    piloto = ref.construir_piloto()
    c = leer_json(ALMACEN / "corpus" / "vigente.json")
    d = leer_json(ALMACEN / "directorio.json")
    docs = {x["doc_id"] for x in c["chunks"].values()}
    print(f"✓ {hora(RELOJ)} (Ciudad de México): {c['version']} con {len(c['chunks'])} chunks de {len(docs)} documentos · "
          f"{len(d['personas'])} personas en el directorio · {v} con {n} preguntas")
    print(f"  el job del piloto dejó indices/{piloto}/ (BM25 y vectores de all-MiniLM-L6-v2) y el alias c11 apunta a él")
    print("  siguiente: python verificar.py mundo")
