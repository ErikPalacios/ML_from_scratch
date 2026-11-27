"""Paso 1: las cuantizaciones de medicion.json, todas del mismo f16, con llama-quantize; y su manifiesto.

    python3 pipeline/cuantizar.py            # las que falten o cuyo archivo ya no es el del manifiesto
    python3 pipeline/cuantizar.py --todas    # todas otra vez

Contrato:
- cuantizar(tipo) -> dict: corre `llama-quantize <fuente> cuantizados/Qwen3-0.6B-<tipo>.gguf <tipo>` con la fuente de
  medicion.json (el f16, nunca otra cuantización) y devuelve {"archivo", "tipo", "bytes", "sha256", "fuente",
  "fuente_sha256", "bits_por_peso", "segundos"}. bits_por_peso sale del encabezado del GGUF (mundo.ficha.resumen).
- cuantizados/manifiesto.json: {tipo: lo que devolvió cuantizar(tipo)}, escrito de un jalón (escribir_json).
"""

from __future__ import annotations
import subprocess
import sys
import time
from pathlib import Path
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from mundo.comun import CUANTIZADOS, escribir_json, herramienta, leer_json, medicion, sha256_archivo
from mundo.ficha import resumen
MANIFIESTO = CUANTIZADOS / "manifiesto.json"


def destino(tipo: str) -> Path:
    return CUANTIZADOS / f"Qwen3-0.6B-{tipo}.gguf"


def cuantizar(tipo: str) -> dict:
    raise NotImplementedError("paso 1: cuantizar")


if __name__ == "__main__":
    m = leer_json(MANIFIESTO, {})
    for tipo in medicion()["cuantizaciones"]:
        p = destino(tipo)
        if "--todas" not in sys.argv and tipo in m and p.exists() and sha256_archivo(p) == m[tipo]["sha256"]:
            print(f"= {tipo:<7} ya está ({m[tipo]['bytes'] / 1e6:,.0f} MB)")
            continue
        m[tipo] = cuantizar(tipo)
        escribir_json(MANIFIESTO, m)
        x = m[tipo]
        print(f"✓ {tipo:<7} {x['bytes'] / 1e6:6,.0f} MB · {x['bits_por_peso']:.2f} bits por peso · {x['segundos']:.1f} s · sha256 {x['sha256'][:12]}…")
