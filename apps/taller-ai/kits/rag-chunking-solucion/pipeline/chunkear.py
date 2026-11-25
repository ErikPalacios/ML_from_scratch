"""Pasos 6 y 7 · Chunkear el almacén: cada documento vivo a chunks/docs/, sin volver a partir lo que no cambió.

    python pipeline/chunkear.py                  # la corrida normal (incremental)
    python pipeline/chunkear.py --doc wiki:1002  # solo un documento, y lo vuelve a partir aunque no haya cambiado
    python pipeline/chunkear.py --forzar         # vuelve a partir todo

Contrato:
- Lee almacen/catalogo.json y, por cada documento vivo, su texto en almacen/texto/<hash>.json.
- Cada documento vivo queda en archivo_doc(doc_id) (chunks/docs/<doc_id con «__»>.json):
  {"doc_id", "hash", "sha256_texto", "huella", "acl", "titulo", "url", "version", "chunks": [...]}.
  Cada chunk: {"chunk_id": "<doc_id>#<orden con 3 dígitos>", "doc_id", "orden" (desde 0), "ruta", "texto",
  "tokens", "traslape", "acl", "titulo", "url", "version"}. Un chunk es de un solo documento y lleva la ACL de su
  documento tal cual (las cláusulas del catálogo).
- huella(): los primeros 12 caracteres del sha256 de CHUNKER y de la sección chunking de config.yaml. Si cambia
  cómo se parte, cambia la huella y se vuelve a partir todo.
- Paso 7, incremental (si config incremental es true): un documento cuyo archivo ya tiene el mismo sha256_texto, el
  mismo título y la misma huella no se vuelve a partir (el título cuenta porque va en la ruta, dentro del texto de
  cada chunk). Si además tiene la misma ACL, url y versión, cuenta como sin_cambios; si cambió alguna (un permiso
  nuevo, una republicación), se reescriben en el archivo y en cada chunk, sin partir (solo_meta). Si no, se parte
  (rechunkeados).
- Una lápida (borrado True) o un documento que ya no está en el catálogo pierde su archivo (borrados).
- Fail-closed: un documento con la ACL vacía o sin ACL no se chunkea y pierde su archivo (sin_acl): sin ACL no se
  sabe quién lo puede leer. Un documento sin texto (necesita_ocr) tampoco (sin_texto).
- correr(doc, forzar) hace una corrida y la devuelve. main() (la línea de comandos y el resumen) viene dado.
- Cada corrida deja chunks/corridas/<inicio>.json: {"inicio", "fin", "forzada" (True con --doc o --forzar), "huella", "rechunkeados", "solo_meta",
  "borrados", "sin_acl", "sin_texto" (listas de doc_id), "sin_cambios" (un número), "chunks" y "tokens" (los
  totales de chunks/docs/ al final) y "estado" ({doc_id: sha256_texto} de lo que quedó en chunks/docs/)}.
"""
from __future__ import annotations

import argparse
import json

from _comun import CATALOGO, CORRIDAS, DOCS, TEXTO, ahora, archivo_doc, config, escribir_json, leer_json, sha256
from chunker import CHUNKER, chunks

META = ("acl", "titulo", "url", "version")


def huella() -> str:
    return sha256(json.dumps({"chunker": CHUNKER, "chunking": config()["chunking"]}, sort_keys=True).encode())[:12]


def chunkear_doc(doc_id: str, r: dict, t: dict, hu: str) -> dict:
    cs = chunks(t["texto"], r["titulo"], config()["chunking"])
    meta = {k: r[k] for k in META}
    return {"doc_id": doc_id, "hash": r["hash"], "sha256_texto": t["sha256_texto"], "huella": hu, **meta,
            "chunks": [{"chunk_id": f"{doc_id}#{i:03d}", "doc_id": doc_id, "orden": i, **c, **meta} for i, c in enumerate(cs)]}


def correr(doc: str | None = None, forzar: bool = False) -> dict:
    """Una corrida: chunkea lo que toca, borra lo que ya no vive, escribe la corrida en chunks/corridas/ y la devuelve."""
    inicio, hu, inc = ahora(), huella(), config()["incremental"]
    cat = leer_json(CATALOGO)
    if cat is None:
        raise SystemExit("✗ no existe almacen/catalogo.json: python mundo/crear.py")
    x = {k: [] for k in ("rechunkeados", "solo_meta", "borrados", "sin_acl", "sin_texto")} | {"sin_cambios": 0}
    for doc_id, r in sorted(cat.items()):
        if doc and doc_id != doc:
            continue
        p = archivo_doc(doc_id)
        if r.get("borrado"):
            if p.exists():
                p.unlink()
                x["borrados"].append(doc_id)
            continue
        if not r.get("acl"):
            p.unlink(missing_ok=True)
            x["sin_acl"].append(doc_id)
            continue
        t = leer_json(TEXTO / f"{r['hash']}.json")
        if not t or not t["texto"]:
            p.unlink(missing_ok=True)
            x["sin_texto"].append(doc_id)
            continue
        viejo = leer_json(p)
        if inc and not forzar and not doc and viejo and viejo["sha256_texto"] == t["sha256_texto"] \
                and viejo["titulo"] == r["titulo"] and viejo["huella"] == hu:
            meta = {k: r[k] for k in META}
            if all(viejo[k] == v for k, v in meta.items()):
                x["sin_cambios"] += 1
                continue
            viejo |= meta | {"hash": r["hash"]}
            for c in viejo["chunks"]:
                c |= meta
            escribir_json(p, viejo)
            x["solo_meta"].append(doc_id)
            continue
        escribir_json(p, chunkear_doc(doc_id, r, t, hu))
        x["rechunkeados"].append(doc_id)
    if not doc:   # lo que ya no está en el catálogo
        for p in sorted(DOCS.glob("*.json")) if DOCS.exists() else []:
            d = leer_json(p)
            if d["doc_id"] not in cat:
                p.unlink()
                x["borrados"].append(d["doc_id"])
    docs = [leer_json(p) for p in sorted(DOCS.glob("*.json"))] if DOCS.exists() else []
    corrida = {"inicio": inicio, "fin": ahora(), "forzada": bool(doc or forzar), "huella": hu, **x, "chunks": sum(len(d["chunks"]) for d in docs),
               "tokens": sum(c["tokens"] for d in docs for c in d["chunks"]), "estado": {d["doc_id"]: d["sha256_texto"] for d in docs}}
    escribir_json(CORRIDAS / f"{inicio.replace(':', '')}.json", corrida)
    return corrida


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--doc")
    ap.add_argument("--forzar", action="store_true")
    a = ap.parse_args()
    x = correr(a.doc, a.forzar)
    print(f"✓ chunkeo · huella {x['huella']} · {len(x['rechunkeados'])} partidos · {len(x['solo_meta'])} solo metadatos · "
          f"{x['sin_cambios']} sin cambios · {len(x['borrados'])} borrados")
    print(f"  {x['chunks']} chunks en {len(x['estado'])} documentos · {x['tokens']:,} tokens".replace(",", " "))
    for k in ("sin_acl", "sin_texto"):
        if x[k]:
            print(f"  ⚠ {k.replace('_', ' ')} (no se chunkean): {', '.join(x[k])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
