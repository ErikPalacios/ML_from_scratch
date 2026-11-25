"""Paso 3 · El conector del Drive: el feed de cambios con su pageToken y los permisos de cada archivo.

Contrato (la forma común está en conectores/__init__.py):
- listar(): todos los archivos visibles (GET /files, siguiendo nextPageToken). doc_id = "drive:<id>",
  version = str(version), actualizado = modifiedTime, titulo = name, url = <url>/files/<id>, meta = {"mimeType"}.
- cambios(cursor): con None, PRIMERO pide el token de inicio (GET /changes/startPageToken) y DESPUÉS lista todo:
  así un cambio que pase mientras listas queda en el feed. Cursor = {"pageToken": ese token}.
  Con cursor, lee GET /changes?pageToken=… página por página hasta que venga newStartPageToken (ese es el cursor
  nuevo). Un cambio con removed: true o con el archivo en la papelera (trashed) va a la lista de borrados; los demás
  son refs. Si un archivo cambió dos veces, queda una sola vez, con su estado más nuevo.
- traer(ref): los bytes con GET /files/<id>?alt=media (None si ya no se ve). tipo "pdf" o "markdown" según mimeType.
- acl(ref): UNA cláusula con los permisos (GET /files/<id>/permissions): user → user:<correo>, group → group:<correo>,
  domain o anyone con allowFileDiscovery: true → domain:<dominio de config>. Un domain o anyone con
  allowFileDiscovery: false es un link compartido: con drive.link_compartido = ignorar no da acceso a nadie
  (no entra a la cláusula). Ordenada y sin repetidos.
"""

from __future__ import annotations
from _comun import config
from conectores.http import pedir

FUENTE = "drive"

TIPOS = {"application/pdf": "pdf", "text/markdown": "markdown"}


def listar() -> list[dict]:
    raise NotImplementedError("paso 3: listar")


def cambios(cursor: dict | None):
    raise NotImplementedError("paso 3: cambios")


def acl(ref: dict) -> list[list[str]]:
    raise NotImplementedError("paso 3: acl")


def traer(ref: dict) -> dict | None:
    raise NotImplementedError("paso 3: traer")
