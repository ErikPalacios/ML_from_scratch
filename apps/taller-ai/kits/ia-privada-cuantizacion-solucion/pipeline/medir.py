"""Pasos 2 y 3: la velocidad de cada cuantización, con los mismos prompts, calentando antes, sin cache y con el mismo
largo de respuesta.

    python3 pipeline/medir.py              # todas las de medicion.json
    python3 pipeline/medir.py Q4_K_M       # una

Contrato:
- una_peticion(url, sistema, texto, cfg) -> dict, una muestra: {"ttft_ms", "prompt_n", "prefill_tps", "tokens",
  "decode_tps", "total_s"}. Petición con stream e include_usage; ttft_ms hasta el primer pedazo con texto; prompt_n,
  prefill_tps (prompt_per_second) y decode_tps (predicted_per_second) salen de los timings de llama-server.
  cfg es medicion.json["velocidad"]: con largo_fijo, ignore_eos (todas escriben max_tokens); cache_prompt tal cual;
  con metrica "total", decode_tps = tokens ÷ total_s.
- medir(tipo) -> dict: sirve el GGUF con mundo.servidor.servido, hace cfg["calentamiento"] peticiones que no cuentan
  y cfg["repeticiones"] de cada prompt. Devuelve {"tipo", "archivo", "muestras": {id: [muestra, …]},
  "mediana": {id: {"ttft_ms", "prefill_tps", "decode_tps"}}}.
- resultados/velocidad.json: {"medicion": cfg, "prompts_sha256", "cuantizaciones": {tipo: medir(tipo)}}.
"""
from __future__ import annotations

import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import RESULTADOS, escribir_json, leer_json, medicion, sha256_archivo  # noqa: E402
from mundo.servidor import servido  # noqa: E402

SALIDA = RESULTADOS / "velocidad.json"


def una_peticion(url: str, sistema: str, texto: str, cfg: dict) -> dict:
    cuerpo = {"messages": [{"role": "system", "content": sistema}, {"role": "user", "content": texto}], "max_tokens": cfg["max_tokens"],
              "temperature": 0, "seed": 7, "stream": True, "stream_options": {"include_usage": True}, "cache_prompt": cfg["cache_prompt"]}
    if cfg["largo_fijo"]:
        cuerpo["ignore_eos"] = True
    t0, ttft, t, u = time.perf_counter(), None, {}, {}
    req = urllib.request.Request(f"{url}/chat/completions", json.dumps(cuerpo).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        for linea in r:
            linea = linea.decode().strip()
            if not linea.startswith("data: ") or linea == "data: [DONE]":
                continue
            d = json.loads(linea[6:])
            t, u = d.get("timings") or t, d.get("usage") or u
            if ttft is None and any((c.get("delta") or {}).get("content") for c in d.get("choices", [])):
                ttft = time.perf_counter() - t0
    total = time.perf_counter() - t0
    tokens = u.get("completion_tokens", t.get("predicted_n", 0))
    decode = t["predicted_per_second"] if cfg["metrica"] == "decode" else tokens / total
    return {"ttft_ms": round(ttft * 1000, 1), "prompt_n": t["prompt_n"], "prefill_tps": round(t["prompt_per_second"], 1),
            "tokens": tokens, "decode_tps": round(decode, 1), "total_s": round(total, 3)}


def medir(tipo: str) -> dict:
    cfg = medicion()["velocidad"]
    p = leer_json(RAIZ / cfg["prompts"])
    m = leer_json(RAIZ / "cuantizados" / "manifiesto.json")[tipo]
    with servido(m["archivo"]) as url:
        for _ in range(cfg["calentamiento"]):
            una_peticion(url, p["sistema"], p["prompts"][0]["texto"], cfg)
        muestras = {x["id"]: [una_peticion(url, p["sistema"], x["texto"], cfg) for _ in range(cfg["repeticiones"])] for x in p["prompts"]}
    med = {k: {c: statistics.median(s[c] for s in v) for c in ("ttft_ms", "prefill_tps", "decode_tps")} for k, v in muestras.items()}
    return {"tipo": tipo, "archivo": m["archivo"], "muestras": muestras, "mediana": med}


if __name__ == "__main__":
    cfg = medicion()
    tipos = sys.argv[1:] or cfg["cuantizaciones"]
    r = leer_json(SALIDA, {}) if sys.argv[1:] else {}
    r |= {"medicion": cfg["velocidad"], "prompts_sha256": sha256_archivo(RAIZ / cfg["velocidad"]["prompts"])}
    r.setdefault("cuantizaciones", {})
    for tipo in tipos:
        t0 = time.perf_counter()
        r["cuantizaciones"][tipo] = x = medir(tipo)
        escribir_json(SALIDA, r)
        med = x["mediana"]
        print(f"✓ {tipo:<7} decode {med['corto']['decode_tps']:5.0f} tokens/s · prefill {med['largo']['prefill_tps']:6,.0f} tokens/s · "
              f"TTFT corto {med['corto']['ttft_ms']:4.0f} ms · largo {med['largo']['ttft_ms']:5.0f} ms · ({time.perf_counter() - t0:.0f} s)")
