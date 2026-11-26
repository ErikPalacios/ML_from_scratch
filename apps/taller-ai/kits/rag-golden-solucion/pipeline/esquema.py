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


@lru_cache(maxsize=1)
def _validador():
    from jsonschema import Draft202012Validator

    esquema = json.loads(ESQUEMA.read_text())
    Draft202012Validator.check_schema(esquema)      # un esquema mal escrito es un error tuyo, no del experto
    return Draft202012Validator(esquema)


def estructura(item) -> list[str]:
    errores = sorted(_validador().iter_errors(item), key=lambda e: (list(e.absolute_path), e.message))
    return [f"{'.'.join(str(p) for p in e.absolute_path) or '(raíz)'}: {e.message}" for e in errores]


def reglas(item: dict, corpus: dict, directorio: dict) -> list[str]:
    chunks = corpus["chunks"]
    errores = [f"fuente {f}: no existe en {corpus['version']}" for f in item["fuentes"] if f not in chunks]
    if item["persona"] not in directorio["personas"]:
        errores.append(f"persona {item['persona']}: no está en el directorio")
    if errores:
        return errores
    ps = principals(item["persona"], directorio)
    ve = [puede_ver(chunks[f]["acl"], ps) for f in item["fuentes"]]
    docs = {chunks[f]["doc_id"] for f in item["fuentes"]}
    tipo = item["tipo"]
    if tipo == "directa" and len(docs) != 1:
        errores.append(f"directa: sus fuentes son de {len(docs)} documentos (una directa sale de uno solo)")
    if tipo == "varias" and len(docs) < 2:
        errores.append("varias: todas sus fuentes son del mismo documento (hacen falta dos documentos o más)")
    if tipo in ("directa", "varias") and not all(ve):
        no = [f for f, v in zip(item["fuentes"], ve) if not v]
        errores.append(f"{tipo}: {item['persona']} no puede ver {', '.join(no)} (darla por buena premiaría una fuga)")
    if tipo == "prohibida" and any(ve):
        si = [f for f, v in zip(item["fuentes"], ve) if v]
        errores.append(f"prohibida: {item['persona']} sí puede ver {', '.join(si)} (entonces no es prohibida)")
    if tipo == "sin_respuesta" and item["fuentes"]:
        errores.append("sin_respuesta: no lleva fuentes")
    return errores


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
