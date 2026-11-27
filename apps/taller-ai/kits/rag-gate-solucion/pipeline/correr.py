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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import ALIAS, GOLDEN, RAIZ, TOKENS, config, escribir_json, escribir_jsonl, leer_json, leer_jsonl, modelos, sha256_archivo  # noqa: E402
import sse  # noqa: E402

CORRIDAS = RAIZ / "corridas"


def preguntas(split: str) -> list[dict]:
    v = (GOLDEN / "VIGENTE").read_text().strip()
    g = leer_jsonl(GOLDEN / v / "preguntas.jsonl")
    if split not in ("test", "dev", "todas"):
        raise ValueError(f"evals.split tiene que ser test, dev o todas, no {split}")
    return g if split == "todas" else [x for x in g if x["split"] == split]


def _env() -> dict:
    out = {}
    for linea in (RAIZ / "servidor.env").read_text().splitlines():
        linea = linea.split("#", 1)[0].strip()
        if "=" in linea:
            k, v = linea.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def manifiesto(nombre: str, split: str, ids: list[str]) -> dict:
    cfg = config()
    v = (GOLDEN / "VIGENTE").read_text().strip()
    archivo = Path(_env()["MODELO"]).name
    sha = next((a["sha256"] for m in modelos().values() for n, a in m["archivos"].items() if n == archivo), None)
    return {
        "nombre": nombre, "fecha": datetime.now().astimezone().isoformat(timespec="seconds"), "split": split, "n": len(ids), "ids": ids,
        "golden": {"version": v, "sha256": sha256_archivo(GOLDEN / v / "preguntas.jsonl")},
        "config_sha256": sha256_archivo(RAIZ / "config.yaml"),
        "sistema": {k: cfg[k] for k in ("retrieval", "respuesta", "llm", "seguridad")},
        "llm": {"modelo": archivo, "sha256": sha},
        "indice": (leer_json(ALIAS, {}) or {}).get("c11", {}).get("actual"),
        "sin_cache": bool(cfg["evals"]["sin_cache"]),
    }


def _url() -> str:
    a = config()["api"]
    return f"http://{a['host']}:{a['puerto']}/v1/ask"


def una(x: dict, llave: str, sin_cache: bool) -> dict:
    fila = {"id": x["id"], "tipo": x["tipo"], "persona": x["persona"], "contexto": [], "apartados": [], "descartados": 0,
            "de_cache": False, "respuesta": "", "citas": [], "invalidas": [], "no_se": False, "fin": None, "error": None,
            "ms": {"ttft": None, "total": None}}
    h = {"Content-Type": "application/json", "Accept": "text/event-stream", "Authorization": f"Bearer {llave}"}
    if sin_cache:
        h["Cache-Control"] = "no-cache"
    t0 = time.perf_counter()
    req = urllib.request.Request(_url(), json.dumps({"pregunta": x["pregunta"]}).encode(), h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            for nombre, d in sse.leer(r):
                if nombre == "fuentes":
                    fila.update(contexto=[c["chunk_id"] for c in d["contexto"]], apartados=[a["chunk_id"] for a in d["apartados"]],
                                descartados=d["descartados"], de_cache=d["de_cache"])
                elif nombre == "token" and fila["ms"]["ttft"] is None:
                    fila["ms"]["ttft"] = round((time.perf_counter() - t0) * 1000, 1)
                elif nombre == "fin":
                    fila.update(respuesta=d["respuesta"], citas=[c["chunk_id"] for c in d["citas"]], invalidas=[c["n"] for c in d["invalidas"]],
                                no_se=d["no_se"], fin=d["fin"])
                elif nombre == "error":
                    fila.update(error=d["motivo"], fin="error")
    except urllib.error.HTTPError as e:
        fila.update(error=f"http {e.code}", fin="error")
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        fila.update(error=f"sin conexión: {e}", fin="error")
    fila["ms"]["total"] = round((time.perf_counter() - t0) * 1000, 1)
    return fila


def correr(nombre: str, split: str | None = None, ids: list[str] | None = None) -> Path:
    cfg = config()
    split = split or cfg["evals"]["split"]
    destino = CORRIDAS / nombre
    if destino.exists():
        raise ValueError(f"corridas/{nombre} ya existe: una corrida no se pisa, usa otro nombre")
    qs = preguntas(split)
    if ids:
        qs = [x for x in qs if x["id"] in ids]
    llaves = {p: t for t, p in (leer_json(TOKENS, {}) or {}).items()}
    sin_cache = bool(cfg["evals"]["sin_cache"])
    filas = []
    for i, x in enumerate(qs, 1):
        filas.append(una(x, llaves[x["persona"]], sin_cache))
        print(f"\r  {i}/{len(qs)} {x['id']}", end="", flush=True)
    print()
    tmp = CORRIDAS / f".{nombre}.tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    escribir_jsonl(tmp / "respuestas.jsonl", filas)
    escribir_json(tmp / "manifiesto.json", manifiesto(nombre, split, [x["id"] for x in qs]))
    tmp.rename(destino)
    return destino


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
