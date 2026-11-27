"""Paso 4: preguntarle al modelo desde la terminal, en stream, y ver cuánto tardó.

    python pipeline/preguntar.py "¿Qué es una pena convencional?"
    python pipeline/preguntar.py --sistema "Contesta en una frase." "¿Qué es un arrendamiento?"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm import Cliente, ErrorLLM  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("pregunta")
    ap.add_argument("--sistema", default="Eres el asistente de un despacho de abogados en México. Contesta en español, breve y claro.")
    ap.add_argument("--max", type=int, default=200)
    a = ap.parse_args()
    cli = Cliente()
    msgs = [{"role": "system", "content": a.sistema}, {"role": "user", "content": a.pregunta}]
    try:
        for pedazo in cli.chat_stream(msgs, max_tokens=a.max):
            print(pedazo, end="", flush=True)
    except ErrorLLM as e:
        sys.exit(f"✗ {type(e).__name__}: {e}")
    r = cli.ultima
    dec = r.tiempos.get("predicted_per_second")
    print(f"\n\n— {r.tokens_prompt} tokens de entrada · {r.tokens_salida} de salida · fin: {r.fin} · TTFT {r.ttft_s * 1000:.0f} ms · "
          f"total {r.segundos:.2f} s" + (f" · {dec:.0f} tokens/s al generar" if dec else ""))
