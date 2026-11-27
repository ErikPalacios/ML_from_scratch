"""Paso 5: construir un índice nuevo al lado del que está sirviendo: BM25 y vectores sobre los mismos chunks, con la
ACL de cada chunk, y un manifiesto que dice qué es. El índice vigente no se toca.

Contrato:
- nombre_nuevo(clave, corpus_version) → "c11-<clave>-<fecha del corpus>", y si ya existe, con -2, -3…
- construir(clave=None, nombre=None) → el nombre del índice. clave = config embeddings.modelo si no se da.
  1. Si la dimensión del modelo no es la de config indice.dimension, se detiene ANTES de escribir nada (SystemExit).
  2. Crea indices/<nombre>/ (si ya existe, SystemExit) y escribe primero manifiesto.json con "estado": "construyendo".
  3. chunks.jsonl: una fila por chunk (sorted): {"chunk_id", "doc_id", "titulo", "acl", "sha": sha_texto(texto)}.
  4. bm25.json: bm25.construir con k1 y b de config.
  5. vectores.npy (la matriz) y vectores.json: {"ids", "filas"} de vectores.construir.
  6. Al final, el manifiesto completo y "estado": "listo": {"nombre", "estado", "creado": ahora(), "corpus" (versión),
     "modelo": la firma, "dimension", "similitud", "n" (chunks), "bm25": {"k1", "b"}, "archivos": {archivo: sha256}}.
- revisar(nombre) → lista de problemas (vacía = sano): estado listo; cada archivo existe y su sha256 es el del manifiesto;
  los mismos chunk_ids en chunks.jsonl, en bm25.json y en vectores.json; cada fila de vectores hecha por el modelo del
  manifiesto; la matriz de forma (n, dimension); cada vector de largo 1 (± 0.001). Antes de mover un alias, se revisa.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bm25  # noqa: E402
import vectores  # noqa: E402
from _comun import INDICES, ahora, config, corpus, escribir_json, escribir_jsonl, leer_json, leer_jsonl, sha256_archivo, sha_texto  # noqa: E402
from embeber import Modelo  # noqa: E402

ARCHIVOS = ("chunks.jsonl", "bm25.json", "vectores.npy", "vectores.json")


def nombre_nuevo(clave: str, corpus_version: str) -> str:
    base = f"c11-{clave}-{corpus_version.removeprefix('corpus-')}"
    nombre, n = base, 1
    while (INDICES / nombre).exists():
        n += 1
        nombre = f"{base}-{n}"
    return nombre


def construir(clave: str | None = None, nombre: str | None = None) -> str:
    cfg = config()
    clave = clave or cfg["embeddings"]["modelo"]
    modelo = Modelo(clave)
    if modelo.dim != cfg["indice"]["dimension"]:
        raise SystemExit(f"✗ {clave} da vectores de {modelo.dim} dimensiones y config.yaml dice indice.dimension: "
                         f"{cfg['indice']['dimension']}: no construyo nada")
    c = corpus()
    chunks = c["chunks"]
    nombre = nombre or nombre_nuevo(clave, c["version"])
    carpeta = INDICES / nombre
    if carpeta.exists():
        raise SystemExit(f"✗ indices/{nombre}/ ya existe: un índice se construye una vez")
    man = {"nombre": nombre, "estado": "construyendo", "creado": ahora(), "corpus": c["version"], "modelo": modelo.firma(),
           "dimension": cfg["indice"]["dimension"], "similitud": cfg["indice"]["similitud"]}
    escribir_json(carpeta / "manifiesto.json", man)
    escribir_jsonl(carpeta / "chunks.jsonl", [{"chunk_id": k, "doc_id": chunks[k]["doc_id"], "titulo": chunks[k]["titulo"],
                                               "acl": chunks[k]["acl"], "sha": sha_texto(chunks[k]["texto"])} for k in sorted(chunks)])
    escribir_json(carpeta / "bm25.json", bm25.construir(chunks, cfg["bm25"]["k1"], cfg["bm25"]["b"]))
    ids, matriz, filas = vectores.construir(chunks, modelo)
    np.save(carpeta / "vectores.npy", matriz)
    escribir_json(carpeta / "vectores.json", {"ids": ids, "filas": filas})
    man |= {"estado": "listo", "n": len(ids), "bm25": {"k1": cfg["bm25"]["k1"], "b": cfg["bm25"]["b"]},
            "archivos": {a: sha256_archivo(carpeta / a) for a in ARCHIVOS}}
    problemas = revisar(nombre, man)
    if problemas:
        shutil.rmtree(carpeta)
        raise SystemExit(f"✗ el índice salió mal y lo borré: {problemas[0]}")
    escribir_json(carpeta / "manifiesto.json", man)
    return nombre


def revisar(nombre: str, man: dict | None = None) -> list[str]:
    carpeta = INDICES / nombre
    man = man or leer_json(carpeta / "manifiesto.json")
    if not man:
        return [f"indices/{nombre}/ no tiene manifiesto.json"]
    if man.get("estado") != "listo":
        return [f"{nombre} está «{man.get('estado')}», no «listo»"]
    for a in ARCHIVOS:
        if not (carpeta / a).exists():
            return [f"a {nombre} le falta {a}"]
        if sha256_archivo(carpeta / a) != man["archivos"].get(a):
            return [f"{nombre}/{a} no es el que se construyó (sha256 distinto al del manifiesto)"]
    p = []
    ids_c = [x["chunk_id"] for x in leer_jsonl(carpeta / "chunks.jsonl")]
    ids_b = sorted(leer_json(carpeta / "bm25.json")["docs"])
    vj = leer_json(carpeta / "vectores.json")
    for nom, ids in (("bm25.json", ids_b), ("vectores.json", vj["ids"])):
        if set(ids) != set(ids_c):
            falta, sobra = sorted(set(ids_c) - set(ids)), sorted(set(ids) - set(ids_c))
            p.append(f"{nombre}: {nom} no trae los mismos chunks que chunks.jsonl (faltan {len(falta)}, sobran {len(sobra)})")
    etiqueta = f"{man['modelo']['clave']}@{man['modelo']['revision'][:12]}"
    otros = sorted({f["modelo"] for f in vj["filas"]} - {etiqueta})
    if otros:
        p.append(f"{nombre}: hay filas hechas con {', '.join(otros)} y el índice es de {etiqueta}")
    m = np.load(carpeta / "vectores.npy")
    if m.shape != (len(vj["ids"]), man["dimension"]):
        p.append(f"{nombre}: la matriz es {m.shape} y debería ser ({len(vj['ids'])}, {man['dimension']})")
    elif len(m):
        normas = np.linalg.norm(m, axis=1)
        malas = int((np.abs(normas - 1) > 1e-3).sum())
        if malas:
            p.append(f"{nombre}: {malas} vectores no tienen largo 1 (de {normas.min():.2f} a {normas.max():.2f}) y la similitud es coseno")
    return p


if __name__ == "__main__":
    import argparse
    import time

    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", default=None)
    ap.add_argument("--revisar", metavar="NOMBRE")
    a = ap.parse_args()
    if a.revisar:
        p = revisar(a.revisar)
        print("\n".join(f"✗ {x}" for x in p) or f"✓ {a.revisar}: sano")
        sys.exit(1 if p else 0)
    t = time.perf_counter()
    n = construir(a.modelo)
    man = leer_json(INDICES / n / "manifiesto.json")
    print(f"✓ indices/{n}/ listo en {time.perf_counter() - t:.1f} s: {man['n']} chunks de {man['corpus']} · BM25 y vectores de "
          f"{man['dimension']} dimensiones ({man['modelo']['repo']} @ {man['modelo']['revision'][:12]}) · cada chunk con su ACL")
