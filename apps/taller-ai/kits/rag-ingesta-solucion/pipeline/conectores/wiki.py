"""Paso 2 · El conector de la wiki: páginas paginadas y la ACL como intersección (espacio ∧ ancestros ∧ página).

Contrato (la forma común está en conectores/__init__.py):
- listar(): todas las páginas de los espacios de config (fuentes.wiki.espacios), siguiendo «siguiente» hasta que
  venga null. doc_id = "wiki:<id>", version = str(version), actualizado = el de la página, url = <url>/paginas/<id>.
  En meta guarda el espacio y los ancestros (los ids, de la raíz al padre).
- cambios(cursor): con None, todo (listar) y el cursor {"desde": la fecha «actualizado» más nueva que viste}.
  Con cursor, solo las páginas con actualizado ≥ cursor["desde"] (parámetro «desde» de la API). La wiki no avisa
  de borrados: la lista de borrados va vacía (los encuentra el barrido, paso 8).
- traer(ref): GET /paginas/<id>. None si la página ya no se ve (404). tipo "html", crudo = el «cuerpo» en UTF-8.
- acl(ref): una cláusula con los principals del espacio (GET /espacios/<clave>/permisos) y una más por cada
  ancestro, y por la página misma, que tenga restricción de lectura (GET /paginas/<id>/restricciones: usuarios +
  grupos). La API solo devuelve la restricción PROPIA de cada página: la heredada la armas tú recorriendo ancestros.
  Cada cláusula, ordenada y sin repetidos. Guarda en memoria lo que ya pediste: cada llamada cuenta para el límite.
"""
from __future__ import annotations

from _comun import config
from conectores.http import pedir

FUENTE = "wiki"
_permisos_espacio: dict[str, list[str]] = {}
_restricciones: dict[str, list[str]] = {}


def _paginas(espacio: str, desde: str | None = None):
    r = pedir(FUENTE, "/paginas", {"espacio": espacio, "inicio": 0, "limite": 10} | ({"desde": desde} if desde else {}))
    while True:
        yield from r["resultados"]
        if not r["siguiente"]:
            return
        r = pedir(FUENTE, r["siguiente"])


def _ref(p: dict) -> dict:
    return {"doc_id": f"wiki:{p['id']}", "fuente": FUENTE, "version": str(p["version"]), "actualizado": p["actualizado"],
            "titulo": p["titulo"], "url": f"{config()['fuentes'][FUENTE]['url']}/paginas/{p['id']}",
            "meta": {"espacio": p["espacio"], "ancestros": p["ancestros"]}}


def listar() -> list[dict]:
    return [_ref(p) for esp in config()["fuentes"][FUENTE]["espacios"] for p in _paginas(esp)]


def cambios(cursor: dict | None):
    if cursor is None:
        refs = listar()
    else:
        refs = [_ref(p) for esp in config()["fuentes"][FUENTE]["espacios"] for p in _paginas(esp, cursor["desde"])]
    fechas = [r["actualizado"] for r in refs] + ([cursor["desde"]] if cursor else [])
    return refs, [], {"desde": max(fechas) if fechas else None}


def _restriccion(pid: str) -> list[str]:
    if pid not in _restricciones:
        r = pedir(FUENTE, f"/paginas/{pid}/restricciones")
        leer = (r or {}).get("leer", {})
        _restricciones[pid] = sorted(set(leer.get("usuarios", []) + leer.get("grupos", [])))
    return _restricciones[pid]


def acl(ref: dict) -> list[list[str]]:
    esp = ref["meta"]["espacio"]
    if esp not in _permisos_espacio:
        _permisos_espacio[esp] = sorted(set(pedir(FUENTE, f"/espacios/{esp}/permisos")["leer"]))
    clausulas = [_permisos_espacio[esp]]
    for pid in ref["meta"]["ancestros"] + [ref["doc_id"].split(":", 1)[1]]:
        if _restriccion(pid):
            clausulas.append(_restriccion(pid))
    return clausulas


def traer(ref: dict) -> dict | None:
    p = pedir(FUENTE, f"/paginas/{ref['doc_id'].split(':', 1)[1]}")
    if p is None:
        return None
    r = _ref(p)
    return r | {"tipo": "html", "crudo": p["cuerpo"].encode(), "acl": acl(r)}
