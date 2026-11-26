"""Pasos 7 y 8 · El carril rápido: aplica los cambios de permisos que avisan las fuentes, sin esperar al reindexado.

    python pipeline/revocar.py    # una pasada: lo que llegó a la cola desde la anterior (el mundo la corre cada revocacion.cada_segundos)

Contrato:
- La cola es almacen/eventos.jsonl: un evento por línea, en orden, con "n" (1, 2, 3…), "ocurrio" (cuándo cambió en la
  fuente), "entregado" (cuándo llegó el aviso), "fuente" y "tipo":
  - "acl": con "doc_id" y "acl", la ACL nueva del documento, completa.
  - "membresia": con "grupo", "miembro" y "accion" ("quitar" o "agregar").
- indice/cursor.json {"n": el último evento aplicado}: cada pasada aplica los eventos con n mayor que el cursor y lo
  mueve al último. Sin cursor, empieza desde el primero.
- Un evento "acl" reescribe la ACL de cada chunk de su documento en indice/indice.json (sin volver a indexar ni a
  partir nada: el texto no cambió) y la anota en indice/acl_vigente.json {doc_id: {"acl", "desde": ocurrio}}, para
  que el reindexado no la deshaga. Si el índice ya tiene para ese documento una ACL más nueva que el evento
  (acl_desde posterior a ocurrio), no la toca. Un documento que no está en el índice solo se anota en acl_vigente.
- Un evento "membresia" cambia la copia del directorio (indice/directorio.json): ningún chunk se toca.
- Cada evento aplicado se anota en indice/revocaciones.jsonl: {"n", "tipo", "doc_id" (o "grupo" y "miembro"),
  "ocurrio", "aplicado" (ahora()), "chunks" (cuántos chunks reescribió)}.
- Idempotente: si la corres dos veces seguidas, la segunda no hace nada.
"""
from __future__ import annotations

import json

from _comun import ACL_VIGENTE, ARCHIVO_INDICE, COLA, CURSOR, REVOCACIONES, ahora, escribir_json, leer_json, leer_jsonl
from directorio import copia, guardar_copia


def aplicar_acl(e: dict, idx: dict, vigente: dict) -> int:
    v = vigente.get(e["doc_id"])
    if not v or v["desde"] < e["ocurrio"]:
        vigente[e["doc_id"]] = {"acl": e["acl"], "desde": e["ocurrio"]}
    doc = idx["docs"].get(e["doc_id"])
    if doc is None or (doc["acl_desde"] or "") > e["ocurrio"]:
        return 0
    doc.update(acl=e["acl"], acl_desde=e["ocurrio"], origen="carril")
    for cid in doc["chunks"]:
        idx["chunks"][cid]["acl"] = e["acl"]
    return len(doc["chunks"])


def aplicar_membresia(e: dict, d: dict) -> None:
    m = d["grupos"].setdefault(e["grupo"], {"nombre": e["grupo"], "miembros": []})["miembros"]
    if e["accion"] == "quitar" and e["miembro"] in m:
        m.remove(e["miembro"])
    elif e["accion"] == "agregar" and e["miembro"] not in m:
        m.append(e["miembro"])
        m.sort()


def procesar() -> list[dict]:
    cursor = leer_json(CURSOR, {"n": 0})["n"]
    nuevos = [e for e in leer_jsonl(COLA) if e["n"] > cursor]
    if not nuevos:
        return []
    idx, vigente, d = leer_json(ARCHIVO_INDICE), leer_json(ACL_VIGENTE, {}), copia()
    hechos = []
    for e in nuevos:
        r = {"n": e["n"], "tipo": e["tipo"], "ocurrio": e["ocurrio"], "aplicado": ahora()}
        if e["tipo"] == "acl":
            r |= {"doc_id": e["doc_id"], "chunks": aplicar_acl(e, idx, vigente)}
        else:
            aplicar_membresia(e, d)
            r |= {"grupo": e["grupo"], "miembro": e["miembro"], "accion": e["accion"], "chunks": 0}
        hechos.append(r)
    escribir_json(ARCHIVO_INDICE, idx)          # primero el índice y la copia; el cursor al final: si algo truena a la
    escribir_json(ACL_VIGENTE, vigente)         # mitad, la siguiente pasada vuelve a aplicar (y aplicar dos veces da lo mismo)
    guardar_copia(d)
    with open(REVOCACIONES, "a") as f:
        for r in hechos:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    escribir_json(CURSOR, {"n": nuevos[-1]["n"]})
    return hechos


if __name__ == "__main__":
    hechos = procesar()
    if not hechos:
        print("✓ carril rápido: nada nuevo en la cola")
    for r in hechos:
        que = r.get("doc_id") or f"{r['miembro']} {r['accion']} {r['grupo']}"
        print(f"✓ evento {r['n']} ({r['tipo']}) · {que} · {r['chunks']} chunks reescritos · aplicado {r['aplicado'][11:19]} UTC")
