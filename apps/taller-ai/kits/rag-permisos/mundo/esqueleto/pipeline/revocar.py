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
    raise NotImplementedError("paso 7: aplicar_acl")


def aplicar_membresia(e: dict, d: dict) -> None:
    raise NotImplementedError("paso 7: aplicar_membresia")


def procesar() -> list[dict]:
    raise NotImplementedError("paso 7: procesar")


if __name__ == "__main__":
    hechos = procesar()
    if not hechos:
        print("✓ carril rápido: nada nuevo en la cola")
    for r in hechos:
        que = r.get("doc_id") or f"{r['miembro']} {r['accion']} {r['grupo']}"
        print(f"✓ evento {r['n']} ({r['tipo']}) · {que} · {r['chunks']} chunks reescritos · aplicado {r['aplicado'][11:19]} UTC")
