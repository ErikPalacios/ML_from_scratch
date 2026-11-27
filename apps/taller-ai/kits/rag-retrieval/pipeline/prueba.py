"""Viene de la estación 5 : no lo tienes que escribir. Paso 6: la búsqueda de prueba. Las preguntas del golden set de la estación 4 contra un índice, y qué encuentra cada
mitad por separado: BM25 y vectores. Es la línea base que la estación 6 va a mejorar con la fusión y el reranker.

Contrato:
- medir(buscador, preguntas, k=8) → {"bm25": r, "vectores": r, "por_pregunta": [...]}, con r = {"recall", "margen", "n",
  "fugas", "prohibidas"}. recall@k: de las fuentes de cada directa o con varias fuentes, la fracción que llega al top-k;
  luego el promedio, y margen = 1.96 × desviación estándar / √n (como en la estación 4). fugas: prohibidas que
  recibieron una de sus fuentes. por_pregunta: {"id", "tipo", "bm25": recall o None, "vectores": recall o None}.
- Al correrlo, guarda el resultado de test en indices/<nombre>/prueba.json: {"indice", "golden", "split", "k", "bm25",
  "vectores", "por_pregunta"}.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import INDICES, config, escribir_json, golden  # noqa: E402
from alias import resolver  # noqa: E402
from buscar import Buscador, modelo_de_consulta  # noqa: E402


def _resumen(xs: list[float], fugas: int, prohibidas: int) -> dict:
    n = len(xs)
    m = sum(xs) / n if n else 0.0
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1)) if n > 1 else 0.0
    return {"recall": m, "margen": 1.96 * sd / math.sqrt(n) if n else 0.0, "n": n, "fugas": fugas, "prohibidas": prohibidas}


def medir(buscador, preguntas: list[dict], k: int = 8) -> dict:
    rec = {"bm25": [], "vectores": []}
    fugas = {"bm25": 0, "vectores": 0}
    por = []
    for x in preguntas:
        fs = {f["chunk_id"] for f in x["fuentes"]}
        fila = {"id": x["id"], "tipo": x["tipo"], "bm25": None, "vectores": None}
        for lado in ("bm25", "vectores"):
            top = {c for c, _ in getattr(buscador, lado)(x["pregunta"], x["persona"], k)}
            if x["tipo"] in ("directa", "varias"):
                fila[lado] = len(fs & top) / len(fs)
                rec[lado].append(fila[lado])
            elif x["tipo"] == "prohibida" and fs & top:
                fugas[lado] += 1
        por.append(fila)
    pro = sum(x["tipo"] == "prohibida" for x in preguntas)
    return {lado: _resumen(rec[lado], fugas[lado], pro) for lado in rec} | {"por_pregunta": por}


if __name__ == "__main__":
    # python pipeline/prueba.py [--indice NOMBRE] [--split dev] [--consulta CLAVE]
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--indice", help="un índice por nombre (si no, el del alias)")
    ap.add_argument("--split", default="test", choices=["test", "dev"])
    ap.add_argument("--consulta", help="embeber las preguntas con otro modelo, para ver qué pasaría (no guarda nada)")
    a = ap.parse_args()
    nombre = a.indice or resolver(config()["servicio"]["alias"])
    if a.consulta:
        b = Buscador(nombre, a.consulta, exigir_mismo_modelo=False)
    else:
        b = Buscador(nombre, modelo_de_consulta(nombre))
    v, items = golden()
    items = [x for x in items if x["split"] == a.split]
    r = medir(b, items)
    m = b.manifiesto["modelo"]
    print(f"{b.nombre} ({m['clave']}) · {v} · {a.split}: {len(items)} preguntas, {r['bm25']['n']} con fuentes que buscar" +
          (f" · preguntas embebidas con {a.consulta}" if a.consulta else ""))
    for lado in ("bm25", "vectores"):
        x = r[lado]
        print(f"  {lado:<9} recall@8 = {x['recall']:.1%} ± {x['margen']:.1%}   · {x['prohibidas'] - x['fugas']} de {x['prohibidas']} prohibidas sin fuga")
    solo_b = [p["id"] for p in r["por_pregunta"] if p["bm25"] is not None and p["bm25"] > p["vectores"]]
    solo_v = [p["id"] for p in r["por_pregunta"] if p["bm25"] is not None and p["vectores"] > p["bm25"]]
    print(f"  BM25 encuentra más en {len(solo_b)}: {', '.join(solo_b) or '—'}")
    print(f"  vectores encuentran más en {len(solo_v)}: {', '.join(solo_v) or '—'}")
    if a.split == "test" and not a.consulta:
        escribir_json(INDICES / b.nombre / "prueba.json", {"indice": b.nombre, "golden": v, "split": a.split, "k": 8, **r})
        print(f"  guardado en indices/{b.nombre}/prueba.json")
