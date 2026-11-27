"""Le pregunta a tu API como lo haría la app de chat de la empresa, y muestra la respuesta mientras llega.

    python pipeline/preguntar.py --persona elena.cruz@marketplace.test "¿En cuánto tiempo me regresan el dinero si pagué con tarjeta?"
    python pipeline/preguntar.py --persona elena.cruz@marketplace.test --eventos "…"   # cada evento SSE tal cual

Viene dado. Busca la llave de la persona en almacen/tokens.json (en C11 la da el inicio de sesión de la empresa) y
la manda en «Authorization: Bearer …». La API tiene que estar arriba: python mundo/api.py arrancar.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from _comun import TOKENS, leer_json  # noqa: E402
from sse import preguntar  # noqa: E402

from mundo.api import url  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--persona", required=True)
    ap.add_argument("--eventos", action="store_true", help="muestra cada evento SSE con su tiempo")
    ap.add_argument("pregunta", nargs="+")
    a = ap.parse_args()
    llaves = {p: t for t, p in (leer_json(TOKENS, {}) or {}).items()}
    if a.persona not in llaves:
        sys.exit(f"✗ {a.persona} no tiene llave en almacen/tokens.json")
    try:
        for t, nombre, d in preguntar(f"{url()}/v1/ask", llaves[a.persona], " ".join(a.pregunta)):
            if a.eventos:
                print(f"{t * 1000:7.0f} ms  {nombre}: {json.dumps(d, ensure_ascii=False)[:160]}")
            elif nombre == "fuentes":
                print(f"[{t * 1000:.0f} ms] fuentes: " + " · ".join(f"[{c['n']}] {c['chunk_id']}" for c in d["contexto"]) +
                      (f" · recortados {d['recortados']}" if d["recortados"] else "") + (f" · apartados {[x['chunk_id'] for x in d['apartados']]}" if d["apartados"] else ""))
            elif nombre == "token":
                print(d["texto"], end="", flush=True)
            elif nombre == "fin":
                ms = d["ms"]
                print(f"\n[fin] citas: {', '.join(f'[{c['n']}] {c['chunk_id']}' for c in d['citas']) or 'ninguna'}"
                      + (f" · inválidas: {d['invalidas']}" if d["invalidas"] else "") + f" · {d['fin']}"
                      + f"\n      buscar {ms['buscar']:.0f} ms · reranker {ms['reranker']:.0f} ms · prompt {ms['prompt']:.0f} ms · "
                      f"primer token {ms['ttft']:.0f} ms · total {ms['total']:.0f} ms · {d['tokens']['prompt']} tokens de prompt, {d['tokens']['salida']} de respuesta")
            elif nombre == "error":
                print(f"\n[error] {d['motivo']}: {d['mensaje']}")
            else:
                print(f"\n[{nombre}] {d}")
    except urllib.error.HTTPError as e:
        sys.exit(f"✗ HTTP {e.code}: {e.read().decode()[:200]}")
    except urllib.error.URLError as e:
        sys.exit(f"✗ la API no contesta en {url()} ({e.reason}): python mundo/api.py arrancar")
