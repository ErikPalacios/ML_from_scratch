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
    raise NotImplementedError("paso 6: ruta_texto")


def tiene_texto(h: str) -> bool:
    raise NotImplementedError("paso 6: tiene_texto")


def leer_texto(h: str) -> dict:
    raise NotImplementedError("paso 6: leer_texto")


def guardar_texto(h: str, parseado: dict) -> None:
    raise NotImplementedError("paso 6: guardar_texto")


def catalogo() -> dict:
    raise NotImplementedError("paso 6: catalogo")


def guardar_catalogo(c: dict) -> None:
    raise NotImplementedError("paso 6: guardar_catalogo")


def registrar(c: dict, doc: dict, h: str, necesita_ocr: bool) -> None:
    raise NotImplementedError("paso 6: registrar")


def borrar(c: dict, doc_id: str, motivo: str) -> bool:
    raise NotImplementedError("paso 6: borrar")
