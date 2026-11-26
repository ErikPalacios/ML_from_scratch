"""Paso 6 · Publicar una versión: se escribe una vez, con su huella, y nunca se pisa.

    python pipeline/publicar.py --comprobar     # cada versión publicada contra su manifiesto y contra el registro

Contrato:
- versiones() -> las líneas de golden/versiones.jsonl, en orden ({"version", "sha256", "n", "creado"}).
- siguiente() -> el nombre de la siguiente versión: "golden-v1", "golden-v2"… (uno más que las publicadas).
- publicar(items, rechazadas, meta) -> el nombre de la versión publicada. En golden/<versión>/ escribe
  preguntas.jsonl (los items ordenados por id, con escribir_jsonl), rechazadas.jsonl y manifiesto.json:
  {"version", "anterior" (la vigente o None), "creado" (ahora() del mundo), "sha256" (el de preguntas.jsonl),
   "n", "por_tipo", "por_split", "cambios": {"nuevas", "quitadas", "cambiadas"} (ids contra la anterior)} más lo que
  traiga `meta` (corpus, directorio, quemadas, config, motivo). Después la sube al registro con subir(), agrega su
  línea a golden/versiones.jsonl y, al final, escribe su nombre en golden/VIGENTE.
  Si golden/<versión>/ ya existe o el registro ya la tiene, no escribe nada y levanta YaExiste.
- comprobar() -> lista de problemas (vacía si todo está bien): para cada versión de versiones.jsonl, el sha256 de su
  preguntas.jsonl local, el de su manifiesto, el de su línea en versiones.jsonl y el de la copia del registro son el
  mismo; y VIGENTE es la última.
"""

from __future__ import annotations
import argparse
import json
import shutil
from _comun import GOLDEN, VERSIONES, VIGENTE, YaExiste, ahora, en_registro, escribir_json, escribir_jsonl, leer_json, leer_jsonl, \
    sha256_archivo, subir


def versiones() -> list[dict]:
    return leer_jsonl(VERSIONES)


def siguiente() -> str:
    return f"golden-v{len(versiones()) + 1}"


def vigente() -> str | None:
    return VIGENTE.read_text().strip() if VIGENTE.exists() else None


def publicar(items: list[dict], rechazadas: list[dict], meta: dict) -> str:
    raise NotImplementedError("paso 6: publicar")


def comprobar() -> list[str]:
    raise NotImplementedError("paso 6: comprobar")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--comprobar", action="store_true")
    a = ap.parse_args()
    ps = comprobar()
    for p in ps:
        print("✗ " + p)
    print(f"{len(versiones())} versión(es) publicadas, vigente {vigente()} · " + ("todas coinciden con el registro" if not ps else f"{len(ps)} problema(s)"))
