"""Paso 4 · El conector del Jira: JQL por fecha de actualización (en minutos y en la zona de la cuenta) y la ACL
por proyecto y nivel de seguridad.

Contrato (la forma común está en conectores/__init__.py):
- listar(): todos los tickets de los proyectos de config (fuentes.jira.proyectos) con
  GET /buscar?jql=project in (SOP, SEG) ORDER BY updated ASC&maxResults=20, siguiendo nextPageToken hasta isLast.
  doc_id = "jira:<clave>", version = fields.updated tal cual, actualizado = esa fecha en UTC con Z, titulo = summary,
  url = <url>/ticket/<clave>, meta = {"proyecto", "reportero" (el correo), "nivel" (el id del nivel o None)}.
- cambios(cursor): con None, listar() y cursor {"desde": el «actualizado» más nuevo, en UTC}. Con cursor, el mismo
  JQL con «AND updated >= "aaaa-mm-dd hh:mm"»: Jira solo entiende minutos y los lee en la zona del perfil de la
  cuenta (fuentes.jira.zona). Convierte el cursor a esa zona y córtalo al minuto: lo que caiga en ese minuto vuelve a
  salir, y eso está bien (la versión dice si cambió). Sin borrados (los encuentra el barrido).
- traer(ref): GET /ticket/<clave>. crudo = el JSON del ticket con json.dumps(…, sort_keys=True, ensure_ascii=False)
  en UTF-8 (mismo ticket → mismos bytes → mismo hash). tipo "ticket". None si ya no existe.
- acl(ref): la cláusula de quién puede ver el proyecto (GET /proyecto/<clave>/permisos), donde el valor especial
  «reportero» se cambia por user:<correo de quien lo reportó>; y, si el ticket tiene nivel de seguridad, una
  segunda cláusula con sus miembros (GET /nivel/<id>). Cada cláusula ordenada y sin repetidos.
"""
from __future__ import annotations

import json
from zoneinfo import ZoneInfo

from _comun import config, iso, utc
from conectores.http import pedir

FUENTE = "jira"
_proyectos: dict[str, list[str]] = {}
_niveles: dict[str, list[str]] = {}


def _buscar(desde: str | None):
    c = config()["fuentes"][FUENTE]
    jql = f"project in ({', '.join(c['proyectos'])})"
    if desde:
        jql += f' AND updated >= "{utc(desde).astimezone(ZoneInfo(c["zona"])):%Y-%m-%d %H:%M}"'
    jql += " ORDER BY updated ASC"
    tok = None
    while True:
        r = pedir(FUENTE, "/buscar", {"jql": jql, "maxResults": 20} | ({"nextPageToken": tok} if tok else {}))
        yield from r["issues"]
        if r["isLast"]:
            return
        tok = r["nextPageToken"]


def _ref(t: dict) -> dict:
    f = t["fields"]
    return {"doc_id": f"jira:{t['key']}", "fuente": FUENTE, "version": f["updated"], "actualizado": iso(utc(f["updated"])),
            "titulo": f["summary"], "url": f"{config()['fuentes'][FUENTE]['url']}/ticket/{t['key']}",
            "meta": {"proyecto": f["project"]["key"], "reportero": f["reporter"]["emailAddress"], "nivel": (f["security"] or {}).get("id")}}


def listar() -> list[dict]:
    return [_ref(t) for t in _buscar(None)]


def cambios(cursor: dict | None):
    refs = listar() if cursor is None else [_ref(t) for t in _buscar(cursor["desde"])]
    fechas = [r["actualizado"] for r in refs] + ([cursor["desde"]] if cursor else [])
    return refs, [], {"desde": max(fechas) if fechas else None}


def acl(ref: dict) -> list[list[str]]:
    m = ref["meta"]
    if m["proyecto"] not in _proyectos:
        _proyectos[m["proyecto"]] = pedir(FUENTE, f"/proyecto/{m['proyecto']}/permisos")["ver"]
    ver = {f"user:{m['reportero']}" if p == "reportero" else p for p in _proyectos[m["proyecto"]]}
    clausulas = [sorted(ver)]
    if m["nivel"]:
        if m["nivel"] not in _niveles:
            _niveles[m["nivel"]] = pedir(FUENTE, f"/nivel/{m['nivel']}")["miembros"]
        clausulas.append(sorted(set(_niveles[m["nivel"]])))
    return clausulas


def traer(ref: dict) -> dict | None:
    t = pedir(FUENTE, f"/ticket/{ref['doc_id'].split(':', 1)[1]}")
    if t is None:
        return None
    r = _ref(t)
    return r | {"tipo": "ticket", "crudo": json.dumps(t, sort_keys=True, ensure_ascii=False).encode(), "acl": acl(r)}
