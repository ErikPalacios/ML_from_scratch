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


def listar() -> list[dict]:
    raise NotImplementedError("paso 2: listar")


def cambios(cursor: dict | None):
    raise NotImplementedError("paso 2: cambios")


def acl(ref: dict) -> list[list[str]]:
    raise NotImplementedError("paso 2: acl")


def traer(ref: dict) -> dict | None:
    raise NotImplementedError("paso 2: traer")
