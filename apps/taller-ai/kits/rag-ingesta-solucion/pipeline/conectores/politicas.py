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


def _arbol() -> dict:
    return pedir(FUENTE, "/arbol")


def _ref(a: dict) -> dict:
    return {"doc_id": f"politicas:{a['ruta']}", "fuente": FUENTE, "version": a["sha"], "actualizado": None,
            "titulo": a["ruta"], "url": f"{config()['fuentes'][FUENTE]['url']}/crudo/{a['ruta']}", "meta": {}}


def listar() -> list[dict]:
    return [_ref(a) for a in _arbol()["archivos"]]


def cambios(cursor: dict | None):
    t = _arbol()
    antes = (cursor or {}).get("shas", {})
    ahora = {a["ruta"]: a["sha"] for a in t["archivos"]}
    refs = [_ref(a) for a in t["archivos"] if antes.get(a["ruta"]) != a["sha"]]
    borrados = [f"politicas:{r}" for r in antes if r not in ahora]
    return refs, borrados, {"commit": t["commit"], "shas": ahora}


def acl(ref: dict) -> list[list[str]]:
    return [sorted(set(config()["fuentes"][FUENTE]["leer"]))]


def traer(ref: dict) -> dict | None:
    crudo = pedir(FUENTE, f"/crudo/{ref['titulo']}")
    if crudo is None:
        return None
    return ref | {"tipo": "markdown", "crudo": crudo, "acl": acl(ref)}
