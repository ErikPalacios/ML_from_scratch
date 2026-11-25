"""Paso 4 · El conector del repositorio de políticas: el árbol de git dice qué cambió, por la huella de cada archivo.

Contrato (la forma común está en conectores/__init__.py):
- listar(): GET /arbol → {"commit", "archivos": [{"ruta", "sha"}]}. doc_id = "politicas:<ruta>",
  version = el sha del archivo (git ya te da la huella del contenido), actualizado = None, titulo = la ruta,
  url = <url>/crudo/<ruta>, meta = {}.
- cambios(cursor): no hay feed ni fechas: siempre pide el árbol y lo compara con el del cursor.
  Cursor = {"commit", "shas": {ruta: sha}}. Refs = los archivos nuevos o con otro sha; borrados = las rutas que
  estaban en el cursor y ya no están. Con None, todo.
- traer(ref): los bytes con GET /crudo/<ruta>. tipo "markdown".
- acl(ref): una sola cláusula, la de config (fuentes.politicas.leer): todo el repositorio lo leen soporte y operaciones.
"""

from __future__ import annotations
from _comun import config
from conectores.http import pedir

FUENTE = "politicas"


def listar() -> list[dict]:
    raise NotImplementedError("paso 4: listar")


def cambios(cursor: dict | None):
    raise NotImplementedError("paso 4: cambios")


def acl(ref: dict) -> list[list[str]]:
    raise NotImplementedError("paso 4: acl")


def traer(ref: dict) -> dict | None:
    raise NotImplementedError("paso 4: traer")
