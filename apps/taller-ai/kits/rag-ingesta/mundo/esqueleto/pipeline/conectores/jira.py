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


def listar() -> list[dict]:
    raise NotImplementedError("paso 4: listar")


def cambios(cursor: dict | None):
    raise NotImplementedError("paso 4: cambios")


def acl(ref: dict) -> list[list[str]]:
    raise NotImplementedError("paso 4: acl")


def traer(ref: dict) -> dict | None:
    raise NotImplementedError("paso 4: traer")
