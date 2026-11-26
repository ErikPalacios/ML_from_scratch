"""Pasos 1 y 2 · ¿Esta pregunta candidata sirve para el golden set? Primero su forma; después lo que significa.

    python pipeline/esquema.py almacen/candidatos/expertos.jsonl     # revisa un lote y dice qué tiene cada una

Contrato:
- estructura(item) -> lista de errores (textos), vacía si la forma está bien. Valida contra esquema/candidata.schema.json
  con jsonschema (Draft 2020-12), todos los errores y no solo el primero, cada uno con el campo donde está
  («fuentes: [] should be non-empty»). El esquema lo escribes tú (paso 1).
- reglas(item, corpus, directorio) -> lista de errores, vacía si tiene sentido. El item ya pasó estructura() y sus fuentes
  ya están en el corpus vigente (armar.py las traduce antes). Revisa:
  · cada fuente existe en corpus["chunks"] («fuente wiki:1040#001: no existe en corpus-2026-11-21»);
  · la persona está en el directorio («persona x: no está en el directorio»);
  · directa: todas sus fuentes son de un solo documento; varias: de dos documentos o más;
  · directa y varias: la persona puede ver todas sus fuentes (si no, el gate premiaría darle lo que no puede ver);
  · prohibida: la persona no puede ver ninguna de sus fuentes (si ve una, no es prohibida);
  · sin_respuesta: ninguna fuente.
  Los permisos se resuelven con principals() y puede_ver() de _comun.py (los de la estación 3) y la ACL de cada chunk.
"""

from __future__ import annotations
import argparse
import json
from functools import lru_cache
from _comun import ESQUEMA, corpus, directorio, leer_jsonl, principals, puede_ver


def estructura(item) -> list[str]:
    raise NotImplementedError("paso 1: estructura")


def reglas(item: dict, corpus: dict, directorio: dict) -> list[str]:
    raise NotImplementedError("paso 2: reglas")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("lote")
    a = ap.parse_args()
    c, d = corpus(), directorio()
    malas = 0
    for x in leer_jsonl(a.lote):
        e = estructura(x)
        if not e and x.get("corpus") == c["version"]:
            e = reglas(x, c, d)
        malas += bool(e)
        print(f"{'✗' if e else '✓'} {x.get('id', '¿sin id?')} · {x.get('tipo')} · {x.get('pregunta', '')[:60]}" + "".join(f"\n    {m}" for m in e))
    print(f"\n{malas} con problemas" + ("" if all(x.get("corpus") == c["version"] for x in leer_jsonl(a.lote)) else
          f" (las reglas solo se revisan aquí si el lote es de {c['version']}; las demás las revisa armar.py, que traduce sus fuentes)"))
