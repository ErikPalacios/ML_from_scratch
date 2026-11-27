"""Crea el mundo: el 23 de noviembre a las 10:00 de Ciudad de México, con lo que dejaron las estaciones 2 a 5.

    python mundo/crear.py                # desde cero (antes: python mundo/modelos.py, una vez)
    python mundo/crear.py --golden       # vuelve a bajar el golden set vigente del registro de la estación 4

Copia mundo/entrada/ a almacen/: el corpus (corpus/vigente.json: 151 chunks de 104 documentos, cada uno con su texto
que empieza con la ruta de títulos y su ACL en grupos), el directorio de la empresa y el golden set (golden/VIGENTE y
sus preguntas). Después hace lo que dejó la estación 5: construye el índice c11-e5-2026-11-22 (BM25 y vectores de
multilingual-e5-small, con la ACL de cada chunk) con el código de la estación 5 que viene en pipeline/, lo revisa y
apunta el alias c11 a él. Siempre crea lo mismo; si ya existía, lo reemplaza: indices/ y cache/ se borran. modelo/ no.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import TOKENS, ALMACEN, CACHE, CONFIG, ENTRADA, INDICES, MUNDO, RELOJ, TALLER, VIGENTE, escribir_json, hora, leer_json, leer_jsonl, modelos_faltantes  # noqa: E402


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
    if not CONFIG.exists():
        shutil.copy(Path(__file__).resolve().parent / "esqueleto" / "config.yaml", CONFIG)
    shutil.rmtree(ALMACEN, ignore_errors=True)
    shutil.rmtree(INDICES, ignore_errors=True)
    shutil.rmtree(CACHE, ignore_errors=True)
    shutil.rmtree(TALLER / "ref", ignore_errors=True)
    (ALMACEN / "corpus").mkdir(parents=True)
    shutil.copy(ENTRADA / "corpus" / "corpus-2026-11-22.json", ALMACEN / "corpus" / "vigente.json")
    shutil.copy(ENTRADA / "directorio.json", ALMACEN / "directorio.json")
    v, n = golden()
    escribir_json(MUNDO, {"reloj": RELOJ})
    # la llave de cada persona: en C11 la da el SSO de la empresa; aquí sale fija del correo, para que no cambie
    d = leer_json(ALMACEN / "directorio.json")
    escribir_json(TOKENS, {"dojo-" + hashlib.sha256(p.encode()).hexdigest()[:16]: p for p in d["personas"]})
    # lo de la estación 5, con su propio código (pipeline/construir.py y pipeline/alias.py vienen dados)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
    import alias
    import construir

    with contextlib.redirect_stdout(io.StringIO()):
        nombre = construir.construir("e5")
    assert nombre == VIGENTE, nombre
    alias.apuntar("c11", nombre)
    c = leer_json(ALMACEN / "corpus" / "vigente.json")
    d = leer_json(ALMACEN / "directorio.json")
    docs = {x["doc_id"] for x in c["chunks"].values()}
    print(f"✓ {hora(RELOJ)} (Ciudad de México): {c['version']} con {len(c['chunks'])} chunks de {len(docs)} documentos · "
          f"{len(d['personas'])} personas en el directorio · {v} con {n} preguntas")
    print(f"  la estación 5 dejó indices/{nombre}/ (BM25 y vectores de multilingual-e5-small) y el alias c11 apunta a él")
    print("  siguiente: python verificar.py mundo")
