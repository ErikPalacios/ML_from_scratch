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


def _ref(f: dict) -> dict:
    return {"doc_id": f"drive:{f['id']}", "fuente": FUENTE, "version": str(f["version"]), "actualizado": f["modifiedTime"],
            "titulo": f["name"], "url": f"{config()['fuentes'][FUENTE]['url']}/files/{f['id']}", "meta": {"mimeType": f["mimeType"]}}


def listar() -> list[dict]:
    out, tok = [], None
    while True:
        r = pedir(FUENTE, "/files", {"pageToken": tok} if tok else None)
        out += [_ref(f) for f in r["files"]]
        tok = r.get("nextPageToken")
        if not tok:
            return out


def cambios(cursor: dict | None):
    if cursor is None:
        inicio = pedir(FUENTE, "/changes/startPageToken")["startPageToken"]   # antes de listar, no después
        return listar(), [], {"pageToken": inicio}
    vivos, borrados, tok = {}, {}, cursor["pageToken"]
    while True:
        r = pedir(FUENTE, "/changes", {"pageToken": tok})
        for c in r["changes"]:
            did = f"drive:{c['fileId']}"
            if c["removed"] or c["file"]["trashed"]:
                borrados[did] = True
                vivos.pop(did, None)
            else:
                vivos[did] = _ref(c["file"])
                borrados.pop(did, None)
        if "newStartPageToken" in r:
            return list(vivos.values()), list(borrados), {"pageToken": r["newStartPageToken"]}
        tok = r["nextPageToken"]


def acl(ref: dict) -> list[list[str]]:
    c = config()
    r = pedir(FUENTE, f"/files/{ref['doc_id'].split(':', 1)[1]}/permissions") or {"permissions": []}
    principals = set()
    for p in r["permissions"]:
        if p["type"] == "user":
            principals.add(f"user:{p['emailAddress']}")
        elif p["type"] == "group":
            principals.add(f"group:{p['emailAddress']}")
        elif p["type"] in ("domain", "anyone"):
            if p.get("allowFileDiscovery") or c["drive"]["link_compartido"] == "dominio":
                principals.add(f"domain:{c['dominio']}")
    return [sorted(principals)]


def traer(ref: dict) -> dict | None:
    fid = ref["doc_id"].split(":", 1)[1]
    meta = pedir(FUENTE, f"/files/{fid}")
    crudo = pedir(FUENTE, f"/files/{fid}", {"alt": "media"}) if meta else None
    if meta is None or crudo is None:
        return None
    r = _ref(meta)
    return r | {"tipo": TIPOS[meta["mimeType"]], "crudo": crudo, "acl": acl(r)}
