"""Paso 2 · Del texto a bloques: títulos, párrafos, listas y tablas.

Contrato:
- bloques(texto) -> list[dict], en el orden del texto. Cada bloque trae "tipo" y "lineas" (sus líneas, tal cual):
  - "titulo": una línea «# », «## » o «### ». Trae además "nivel" (1, 2 o 3) y "texto" (sin los #).
  - "tabla": las filas seguidas de una tabla, en una de las dos formas que deja la estación 1:
      de barras (los markdown): líneas «| a | b |»; la segunda es la separadora «|---|---|»;
      de filas (la wiki): dos o más líneas seguidas «Encabezado: valor; Encabezado: valor» que empiezan con el mismo
      encabezado.
    Trae además "encabezado": las líneas que se repiten en cada pedazo si la tabla se parte (las dos primeras en una
    de barras; [] en una de filas, porque cada fila ya dice sus encabezados).
  - "lista": ítems «- » seguidos.
  - "parrafo": cualquier otra línea con texto. Cada línea es un párrafo (así las deja la estación 1).
- Las líneas vacías separan bloques y no se guardan. Ninguna otra línea se pierde ni se cambia.
"""

from __future__ import annotations
import re

TITULO = re.compile(r"^(#{1,3}) (.+)$")

BARRAS = re.compile(r"^\|.*\|$")

FILA = re.compile(r"^([^:;|]{1,40}): [^;]*(?:; [^:;]{1,40}: .*)+$")


def bloques(texto: str) -> list[dict]:
    raise NotImplementedError("paso 2: bloques")
