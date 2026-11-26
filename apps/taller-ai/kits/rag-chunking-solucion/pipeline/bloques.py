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


def _clave_fila(linea: str) -> str | None:
    m = FILA.match(linea)
    return m.group(1) if m else None


def bloques(texto: str) -> list[dict]:
    lineas = texto.splitlines()
    out, i = [], 0
    while i < len(lineas):
        l = lineas[i]
        if not l.strip():
            i += 1
            continue
        if m := TITULO.match(l):
            out.append({"tipo": "titulo", "lineas": [l], "nivel": len(m.group(1)), "texto": m.group(2).strip()})
            i += 1
        elif BARRAS.match(l):
            j = i
            while j < len(lineas) and BARRAS.match(lineas[j]):
                j += 1
            filas = lineas[i:j]
            out.append({"tipo": "tabla", "lineas": filas, "encabezado": filas[:2]})
            i = j
        elif (k := _clave_fila(l)) and i + 1 < len(lineas) and _clave_fila(lineas[i + 1]) == k:
            j = i
            while j < len(lineas) and _clave_fila(lineas[j]) == k:
                j += 1
            out.append({"tipo": "tabla", "lineas": lineas[i:j], "encabezado": []})
            i = j
        elif l.startswith("- "):
            j = i
            while j < len(lineas) and lineas[j].startswith("- "):
                j += 1
            out.append({"tipo": "lista", "lineas": lineas[i:j]})
            i = j
        else:
            out.append({"tipo": "parrafo", "lineas": [l]})
            i += 1
    return out
