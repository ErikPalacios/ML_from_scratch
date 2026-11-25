"""Paso 6 · El almacén: el texto parseado guardado por el hash de su contenido crudo, y el catálogo con la ACL.

Contrato:
- El texto de un contenido vive en almacen/texto/<sha256 del crudo>.json:
  {"hash_crudo", "parser" (PARSER de parsing.py), "texto", "sha256_texto", "necesita_ocr"}.
  El nombre del archivo ES la huella del contenido: el mismo PDF en dos lugares se guarda una vez.
- tiene_texto(h): True solo si el archivo existe, se parseó con el PARSER de hoy y su sha256_texto coincide con su
  texto (si alguien lo editó a mano, ya no sirve y hay que volver a parsear).
- guardar_texto(h, parseado): escribe ese JSON (de un jalón, con escribir_json).
- El catálogo, almacen/catalogo.json, es un dict doc_id → registro:
  {"fuente", "version", "actualizado", "titulo", "url", "tipo", "hash" (el del crudo), "acl" (las cláusulas),
   "necesita_ocr", "borrado" (False), "ingerido" (cuándo, en UTC)}.
- borrar(c, doc_id, motivo): no quita el registro: lo deja como lápida (tombstone): borrado True, su motivo y
  «borrado_en». Así sabes qué se borró, cuándo y por qué, y un evento viejo no lo «revive» sin que lo notes.
"""
from __future__ import annotations

from _comun import CATALOGO, TEXTO, ahora, escribir_json, leer_json, sha256
from parsing import PARSER


def ruta_texto(h: str):
    return TEXTO / f"{h}.json"


def tiene_texto(h: str) -> bool:
    d = leer_json(ruta_texto(h))
    return bool(d and d.get("parser") == PARSER and sha256(d["texto"].encode()) == d.get("sha256_texto"))


def leer_texto(h: str) -> dict:
    return leer_json(ruta_texto(h))


def guardar_texto(h: str, parseado: dict) -> None:
    escribir_json(ruta_texto(h), {"hash_crudo": h, "parser": PARSER, "texto": parseado["texto"],
                                  "sha256_texto": sha256(parseado["texto"].encode()), "necesita_ocr": parseado["necesita_ocr"]})


def catalogo() -> dict:
    return leer_json(CATALOGO, {})


def guardar_catalogo(c: dict) -> None:
    escribir_json(CATALOGO, c)


def registrar(c: dict, doc: dict, h: str, necesita_ocr: bool) -> None:
    c[doc["doc_id"]] = {"fuente": doc["fuente"], "version": doc["version"], "actualizado": doc["actualizado"], "titulo": doc["titulo"],
                        "url": doc["url"], "tipo": doc["tipo"], "hash": h, "acl": doc["acl"], "necesita_ocr": necesita_ocr,
                        "borrado": False, "ingerido": ahora()}


def borrar(c: dict, doc_id: str, motivo: str) -> bool:
    if doc_id not in c or c[doc_id].get("borrado"):
        return False
    c[doc_id] |= {"borrado": True, "motivo": motivo, "borrado_en": ahora()}
    return True
