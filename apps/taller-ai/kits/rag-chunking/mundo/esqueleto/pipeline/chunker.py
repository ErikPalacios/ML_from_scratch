"""Pasos 3 a 5 · Los chunks de un documento.

Contrato:
- CHUNKER: la versión de cómo se parte. Súbela cuando cambies este archivo: con eso se vuelve a partir todo.
- chunks(texto, titulo, cfg) -> list[dict] en orden, cada uno {"ruta": [str], "texto": str, "tokens": int,
  "traslape": int}. cfg es config()["chunking"]; titulo, el del catálogo.
- Estrategia "estructura" (paso 3):
  - La ruta de títulos: el título del documento (su primera línea si es «# », si no el título del catálogo sin su
    extensión) y los títulos «#», «##» y «###» vigentes donde empieza el contenido del chunk.
  - El texto de un chunk es « › ».join(ruta) + "\\n\\n" + sus líneas unidas con "\\n", y contar(texto) ≤ objetivo,
    siempre. "tokens" es ese contar().
  - Se llena con bloques enteros, en orden. Un título va pegado al bloque que le sigue (un chunk nunca termina en un
    título). Un título «#» o «##» siempre empieza un chunk nuevo; un «###» no: las subsecciones de una sección se
    juntan mientras quepan. Así un chunk nunca mezcla dos secciones y su ruta es cierta para todo lo que trae.
  - Paso 4: un bloque que no cabe ni en un chunk vacío se parte: un párrafo por oraciones, una lista por ítems,
    una tabla por filas. Cada pedazo de una tabla de barras empieza con su encabezado (bloque["encabezado"]). Una
    tabla que cabe en un chunk vacío nunca se parte: si no cabe en lo que queda, empieza un chunk nuevo.
- Paso 5, traslape: cuando un corte cae dentro de una sección (no en un título) y no en una tabla, el chunk
  siguiente empieza con las últimas oraciones del anterior, hasta cfg["traslape"] tokens (tokens_texto), en su propia
  línea. "traslape" dice cuántos tokens repite (0 si ninguno).
- Estrategia "fija": ventanas de cfg["fija_caracteres"] caracteres que se traslapan cfg["fija_traslape"], sin ruta
  (ruta []) y sin mirar la estructura. Es la de muchos tutoriales: está para comparar (paso 3).
"""

from __future__ import annotations
import re
from bloques import bloques
from tokens import contar, tokens_texto

CHUNKER = "v1"

ORACION = re.compile(r"(?<=[.!?])\s+")

EXTENSION = re.compile(r"\.(md|pdf|txt|docx)$", re.I)


def oraciones(linea: str) -> list[str]:
    return [o for o in ORACION.split(linea) if o]


def texto_chunk(ruta: list[str], lineas: list[str]) -> str:
    return " › ".join(ruta) + "\n\n" + "\n".join(lineas)


def chunks_estructura(texto: str, titulo: str, cfg: dict) -> list[dict]:
    raise NotImplementedError("paso 3: chunks_estructura")


def chunks_fijos(texto: str, cfg: dict) -> list[dict]:
    raise NotImplementedError("paso 3: chunks_fijos")


def chunks(texto: str, titulo: str, cfg: dict) -> list[dict]:
    if cfg["estrategia"] == "fija":
        return chunks_fijos(texto, cfg)
    if cfg["estrategia"] == "estructura":
        return chunks_estructura(texto, titulo, cfg)
    raise ValueError(f"estrategia desconocida: {cfg['estrategia']}")
