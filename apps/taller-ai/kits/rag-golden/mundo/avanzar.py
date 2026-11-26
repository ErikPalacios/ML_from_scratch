"""La re-ingesta de la noche: el corpus cambia y el mundo pasa al día siguiente.

    python mundo/avanzar.py            # la del 22 de noviembre (paso 7)
    python mundo/avanzar.py --dia 23   # la del 23 (la usa romper.py)

En C11, la ingestión corre sola cada noche: vuelve a leer las fuentes, a partir en chunks y a indexar. Aquí, avanzar.py
pone en almacen/corpus/vigente.json la versión del corpus de ese día (y la guarda en el historial) y mueve el reloj.
No toca tu golden set: eso es trabajo de tu pipeline (pipeline/reanclar.py). Al final dice cuántas fuentes de la versión
vigente del golden ya no coinciden con el corpus nuevo.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import DIAS, GOLDEN, MUNDO, escribir_json, hora, leer_jsonl, mundo, vigente  # noqa: E402
from mundo.crear import poner_corpus  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dia", default="22", choices=["22", "23"])
    a = ap.parse_args()
    antes = mundo()
    if antes["dia"] >= a.dia:
        sys.exit(f"✗ el mundo ya está en el {antes['dia']}: python mundo/crear.py para volver a empezar")
    c = poner_corpus(a.dia)
    escribir_json(MUNDO, {"reloj": DIAS[a.dia][1], "dia": a.dia})
    print(f"✓ re-ingesta del {a.dia} de noviembre: {c['version']}, {len(c['chunks'])} chunks · ahora son las {hora(DIAS[a.dia][1])}")
    v = vigente()
    if v:
        items = leer_jsonl(GOLDEN / v / "preguntas.jsonl")
        fs = [f for x in items for f in x["fuentes"]]
        sha = lambda t: hashlib.sha256(t.encode()).hexdigest()[:16]  # noqa: E731
        no = [f for f in fs if f["chunk_id"] not in c["chunks"] or sha(c["chunks"][f["chunk_id"]]["texto"]) != f["sha"]]
        print(f"  {v}: {len(no)} de sus {len(fs)} fuentes ya no coinciden con el corpus nuevo (el id no existe o su texto es otro)")
