"""Paso 3 · El índice: cada chunk con la ACL de su documento, guardada como grupos (no como personas).

    python pipeline/indexar.py               # el reindexado de cada hora: reconstruye desde almacen/docs/ sin perder lo del carril rápido
    python pipeline/indexar.py --desde-cero  # borra indice/ entero (también lo del carril rápido) y lo construye

Contrato:
- Lee almacen/docs/<doc>.json (lo que dejó la estación 2): {"doc_id", "acl", "acl_leida", "titulo", "url", "chunks": [...]},
  cada chunk con "chunk_id", "texto" y "acl".
- Escribe indice/indice.json: {"construido" (ahora()), "chunks": {chunk_id: {"doc_id", "titulo", "url", "texto", "acl"}},
  "docs": {doc_id: {"acl", "acl_desde", "origen" ("chunks" o "carril"), "chunks": [chunk_id, …]}}, "sin_acl": [doc_id, …]}.
- La ACL va tal cual, en cláusulas de principals (grupos, usuarios, dominio): nunca expandida a personas.
- Fail-closed: si la ACL del documento o la de alguno de sus chunks no es válida (permisos.acl_valida), el documento no
  entra al índice y queda en sin_acl. Salvo con config permisos.sin_acl: publico, que lo mete con [["domain:<dominio
  del directorio>"]] (es para ver por qué no).
- Lo del carril rápido gana si es más nuevo: si indice/acl_vigente.json trae una ACL para el documento con "desde"
  posterior a su acl_leida, esa manda en todos sus chunks (origen "carril"); si no, la del documento ("chunks", y
  acl_desde = acl_leida).
- También refresca la copia del directorio (indice/directorio.json) desde almacen/directorio.json.
- --desde-cero borra indice/ antes: acl_vigente.json, cursor.json, revocaciones.jsonl y la copia del directorio.
"""
from __future__ import annotations

import argparse
import shutil

from _comun import ACL_VIGENTE, ARCHIVO_INDICE, DIRECTORIO, DOCS, INDICE, ahora, config, escribir_json, leer_json
from directorio import guardar_copia
from permisos import acl_valida


def construir() -> dict:
    cfg = config()["permisos"]
    d = leer_json(DIRECTORIO)
    vigente = leer_json(ACL_VIGENTE, {})
    idx = {"construido": ahora(), "chunks": {}, "docs": {}, "sin_acl": []}
    for p in sorted(DOCS.glob("*.json")):
        x = leer_json(p)
        acl, desde, origen = x.get("acl"), x.get("acl_leida"), "chunks"
        if not (acl_valida(acl) and all(acl_valida(c.get("acl")) for c in x["chunks"])):
            if cfg["sin_acl"] != "publico":
                idx["sin_acl"].append(x["doc_id"])
                continue
            acl = [[f"domain:{d['dominio']}"]]
        v = vigente.get(x["doc_id"])
        if v and (desde is None or v["desde"] > desde):
            acl, desde, origen = v["acl"], v["desde"], "carril"
        for c in x["chunks"]:
            idx["chunks"][c["chunk_id"]] = {"doc_id": x["doc_id"], "titulo": x["titulo"], "url": x.get("url"), "texto": c["texto"],
                                            "acl": acl if origen == "carril" or not acl_valida(c.get("acl")) else c["acl"]}
        idx["docs"][x["doc_id"]] = {"acl": acl, "acl_desde": desde, "origen": origen, "chunks": [c["chunk_id"] for c in x["chunks"]]}
    escribir_json(ARCHIVO_INDICE, idx)
    guardar_copia(d)
    return idx


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--desde-cero", action="store_true")
    a = ap.parse_args()
    if a.desde_cero:
        shutil.rmtree(INDICE, ignore_errors=True)
    idx = construir()
    carril = sorted(d for d, x in idx["docs"].items() if x["origen"] == "carril")
    grupos = {p for x in idx["docs"].values() for c in x["acl"] for p in c}
    print(f"✓ índice {'desde cero' if a.desde_cero else 'reconstruido'} a las {idx['construido'][11:19]} UTC · {len(idx['chunks'])} chunks de "
          f"{len(idx['docs'])} documentos · {len(grupos)} principals distintos en sus ACL")
    if carril:
        print(f"  con la ACL del carril rápido (más nueva que la de los chunks): {', '.join(carril)}")
    if idx["sin_acl"]:
        print(f"  ⚠ sin ACL válida, fuera del índice (fail-closed): {', '.join(idx['sin_acl'])}")


if __name__ == "__main__":
    main()
