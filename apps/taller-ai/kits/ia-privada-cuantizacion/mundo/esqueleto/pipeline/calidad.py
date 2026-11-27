"""Pasos 4 y 5: cuánto pierde cada cuantización: la perplejidad en un texto fijo y un examen con respuestas exactas.

    python3 pipeline/calidad.py              # el f16 (la referencia) y todas las de medicion.json
    python3 pipeline/calidad.py Q2_K         # una

Contrato:
- perplejidad(gguf, cfg) -> {"ppl", "mas_menos", "tokens", "segundos"}: `llama-perplexity -m <gguf> -f <texto>
  -c <contexto_perplejidad>`; ppl y mas_menos salen de su línea «Final estimate: PPL = x +/- y». cfg es
  medicion.json["calidad"]: el mismo texto y el mismo contexto para todas.
- examen(url, cfg) -> {"aciertos", "total", "respuestas": [{"id", "respuesta", "bien"}]}: cada pregunta del examen con
  su fragmento, el sistema del examen, temperatura y semilla de cfg, max_tokens 40 y cache_prompt false (reusar el
  prompt anterior cambia un poco las cuentas, y con eso la respuesta); «bien» si alguno de los textos
  esperados aparece en la respuesta (los dos con normalizar()).
- resultados/calidad.json: {"medicion": cfg, "texto_sha256", "f16": perplejidad(fuente),
  "cuantizaciones": {tipo: {"perplejidad": …, "examen": [vuelta, …]}}} con cfg["vueltas_examen"] vueltas.
"""

from __future__ import annotations
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from mundo.comun import RESULTADOS, escribir_json, herramienta, leer_json, medicion, normalizar, sha256_archivo
from mundo.servidor import servido
SALIDA = RESULTADOS / "calidad.json"


def perplejidad(gguf: str, cfg: dict) -> dict:
    raise NotImplementedError("paso 4: perplejidad")


def examen(url: str, cfg: dict) -> dict:
    raise NotImplementedError("paso 5: examen")


if __name__ == "__main__":
    todo = medicion()
    cfg = todo["calidad"]
    tipos = sys.argv[1:] or todo["cuantizaciones"]
    r = leer_json(SALIDA, {}) if sys.argv[1:] else {}
    r |= {"medicion": cfg, "texto_sha256": sha256_archivo(RAIZ / cfg["texto"])}
    if "f16" not in r:
        r["f16"] = perplejidad(todo["fuente"], cfg)
        print(f"✓ f16     perplejidad {r['f16']['ppl']:.2f} ± {r['f16']['mas_menos']:.2f} ({r['f16']['tokens']:,} tokens, {r['f16']['segundos']:.0f} s): la referencia")
    r.setdefault("cuantizaciones", {})
    man = leer_json(RAIZ / "cuantizados" / "manifiesto.json")
    for tipo in tipos:
        p = perplejidad(man[tipo]["archivo"], cfg)
        with servido(man[tipo]["archivo"]) as url:
            vueltas = [examen(url, cfg) for _ in range(cfg["vueltas_examen"])]
        r["cuantizaciones"][tipo] = {"perplejidad": p, "examen": vueltas}
        escribir_json(SALIDA, r)
        print(f"✓ {tipo:<7} perplejidad {p['ppl']:6.2f} ± {p['mas_menos']:.2f} ({p['ppl'] / r['f16']['ppl'] - 1:+.1%} contra f16) · examen "
              + " y ".join(f"{v['aciertos']}/{v['total']}" for v in vueltas))
