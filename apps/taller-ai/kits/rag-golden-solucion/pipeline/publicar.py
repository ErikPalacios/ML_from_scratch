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


def _conteo(items: list[dict], campo: str) -> dict:
    out = {}
    for x in items:
        out[x[campo]] = out.get(x[campo], 0) + 1
    return dict(sorted(out.items()))


def publicar(items: list[dict], rechazadas: list[dict], meta: dict) -> str:
    v = siguiente()
    carpeta = GOLDEN / v
    if carpeta.exists() or en_registro(v):
        raise YaExiste(f"{v} ya existe: una versión publicada no se vuelve a escribir (la que sigue es una versión nueva)")
    anterior = vigente()
    viejos = {x["id"]: x for x in leer_jsonl(GOLDEN / anterior / "preguntas.jsonl")} if anterior else {}
    nuevos = {x["id"]: x for x in items}
    tmp = GOLDEN / f".{v}.armando"
    shutil.rmtree(tmp, ignore_errors=True)
    escribir_jsonl(tmp / "preguntas.jsonl", sorted(items, key=lambda x: x["id"]))
    escribir_jsonl(tmp / "rechazadas.jsonl", rechazadas)
    m = {"version": v, "anterior": anterior, "creado": ahora(), "sha256": sha256_archivo(tmp / "preguntas.jsonl"), "n": len(items),
         "por_tipo": _conteo(items, "tipo"), "por_split": _conteo(items, "split"),
         "cambios": {"nuevas": sorted(nuevos.keys() - viejos.keys()), "quitadas": sorted(viejos.keys() - nuevos.keys()),
                     "cambiadas": sorted(i for i in nuevos.keys() & viejos.keys() if nuevos[i] != viejos[i])}} | meta
    escribir_json(tmp / "manifiesto.json", m)
    tmp.rename(carpeta)
    subir(carpeta, v)
    with VERSIONES.open("a") as f:
        f.write(json.dumps({"version": v, "sha256": m["sha256"], "n": m["n"], "creado": m["creado"]}, ensure_ascii=False, sort_keys=True) + "\n")
    tmp_v = VIGENTE.with_suffix(".tmp")
    tmp_v.write_text(v + "\n")
    tmp_v.replace(VIGENTE)
    return v


def comprobar() -> list[str]:
    problemas = []
    vs = versiones()
    for linea in vs:
        v = linea["version"]
        local = GOLDEN / v / "preguntas.jsonl"
        man = leer_json(GOLDEN / v / "manifiesto.json")
        reg = en_registro(v)
        if not local.exists() or man is None:
            problemas.append(f"{v}: falta en golden/ (bájala del registro: python mundo/registro.py bajar {v})")
            continue
        if reg is None:
            problemas.append(f"{v}: no está en el registro")
            continue
        shas = {"preguntas.jsonl local": sha256_archivo(local), "su manifiesto": man["sha256"], "versiones.jsonl": linea["sha256"],
                "el registro": sha256_archivo(reg / "preguntas.jsonl")}
        if len(set(shas.values())) > 1:
            problemas.append(f"{v}: los sha256 no coinciden ({', '.join(f'{k} {s[:12]}' for k, s in shas.items())})")
    if vs and vigente() != vs[-1]["version"]:
        problemas.append(f"VIGENTE dice {vigente()} y la última publicada es {vs[-1]['version']}")
    return problemas


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--comprobar", action="store_true")
    a = ap.parse_args()
    ps = comprobar()
    for p in ps:
        print("✗ " + p)
    print(f"{len(versiones())} versión(es) publicadas, vigente {vigente()} · " + ("todas coinciden con el registro" if not ps else f"{len(ps)} problema(s)"))
