"""Paso 1: correr el examen. Le hace a tu API (la de la estación 8) cada pregunta del golden set como la haría su
persona, con su llave, y guarda todo lo que contestó en una corrida: lo que llegó al prompt, la respuesta, las citas,
si dijo «no sé» y cuánto tardó. Así se compara después un cambio contra otro con las mismas preguntas.

    python pipeline/correr.py base              # el examen con evals.split (test) contra la API arriba
    python pipeline/correr.py base --ids G-001 G-070

Contrato (todo sale de config.yaml):
- preguntas(split) → las preguntas del golden set vigente de ese split («test», «dev» o «todas»), en su orden.
- manifiesto(nombre, split, ids) → dict con lo que hace falta para saber si dos corridas se pueden comparar:
  {"nombre", "fecha" (ISO, de tu Mac), "split", "n", "ids", "golden": {"version", "sha256"} (el sha256 del archivo
  preguntas.jsonl), "config_sha256" (de config.yaml completo), "sistema": {"retrieval", "respuesta", "llm",
  "seguridad"} (esas secciones de config.yaml), "llm": {"modelo", "sha256"} (el archivo de servidor.env y su sha256 del
  catálogo), "indice" (a qué apunta el alias c11), "sin_cache"}.
- una(x, llave, sin_cache) → la fila de una pregunta: {"id", "tipo", "persona", "contexto": [chunk_id], "apartados":
  [chunk_id], "descartados", "de_cache", "respuesta", "citas": [chunk_id], "invalidas": [n], "no_se", "fin",
  "error" (el motivo, o None), "ms": {"ttft", "total"}}. POST /v1/ask con «Authorization: Bearer <llave>» y, si
  sin_cache, «Cache-Control: no-cache». Un error HTTP o un evento error no detienen el examen: quedan en la fila.
- correr(nombre, split=None, ids=None) → la carpeta corridas/<nombre>/ con respuestas.jsonl (una fila por pregunta)
  y manifiesto.json. split por omisión: evals.split; sin_cache: evals.sin_cache. Si la carpeta ya existe, ValueError:
  una corrida no se pisa. Se escribe en una carpeta temporal y se renombra al final: una corrida a medias no existe.
"""

from __future__ import annotations
import json
import shutil
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from _comun import ALIAS, GOLDEN, RAIZ, TOKENS, config, escribir_json, escribir_jsonl, leer_json, leer_jsonl, modelos, sha256_archivo
import sse

CORRIDAS = RAIZ / "corridas"


def preguntas(split: str) -> list[dict]:
    raise NotImplementedError("paso 1: preguntas")


def manifiesto(nombre: str, split: str, ids: list[str]) -> dict:
    raise NotImplementedError("paso 1: manifiesto")


def una(x: dict, llave: str, sin_cache: bool) -> dict:
    raise NotImplementedError("paso 1: una")


def correr(nombre: str, split: str | None = None, ids: list[str] | None = None) -> Path:
    raise NotImplementedError("paso 1: correr")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("nombre")
    ap.add_argument("--split")
    ap.add_argument("--ids", nargs="*")
    a = ap.parse_args()
    t0 = time.perf_counter()
    d = correr(a.nombre, a.split, a.ids)
    filas = leer_jsonl(d / "respuestas.jsonl")
    m = leer_json(d / "manifiesto.json")
    malas = [f["id"] for f in filas if f["error"]]
    print(f"✓ corridas/{a.nombre}/: {len(filas)} preguntas de {m['golden']['version']} ({m['split']}) en {time.perf_counter() - t0:.0f} s · "
          f"{sum(f['no_se'] for f in filas)} «no sé» · {sum(f['de_cache'] for f in filas)} de la cache · "
          f"{len(malas)} con error{': ' + ', '.join(malas) if malas else ''}")
