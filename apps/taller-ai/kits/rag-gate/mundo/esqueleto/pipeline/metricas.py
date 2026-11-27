"""Paso 2: las métricas que no necesitan juez. Cada pregunta de una corrida se compara con su golden set: si llegaron
sus fuentes al prompt (recall), si llegó algo que esa persona no puede ver (fugas), a qué citó, si dijo «no sé» y
cuánto tardó el primer token. Todo es contar: el mismo resultado cada vez.

    python pipeline/metricas.py base

Contrato:
- docs(chunk_ids) → los documentos de esos chunks («wiki:1001#002» → «wiki:1001»), en orden y sin repetir. Se mide
  por documento: dos chunks del mismo documento no son dos aciertos.
- por_pregunta(fila, x, ver) → dict. fila = una fila de respuestas.jsonl; x = su pregunta del golden set; ver(chunk_id)
  → si la persona de esa pregunta puede ver ese chunk (la ACL de la estación 3, con el directorio de hoy).
    "recall": en directa y varias, |documentos esperados ∩ documentos del contexto| ÷ |documentos esperados|;
              None en las demás. El contexto es lo que llegó al prompt (lo que de verdad leyó el modelo).
    "fuga": True si al prompt o a las citas llegó un chunk que la persona no puede ver, o si en una prohibida llegó
            un chunk de sus fuentes. Tolerancia cero.
    "contesto": no dijo «no sé» y no terminó en error.
    "cita_esperada": en directa y varias que contestaron con al menos una cita, si alguna cita es de un documento
                     esperado; None si no aplica. "sin_cita": contestó una directa o varias sin ninguna cita.
    "abstencion": "correcta" (sin_respuesta o prohibida con «no sé»), "indebida" (directa o varias con «no sé») o None.
    "ttft": ms hasta el primer token; "error": el de la fila.
- wilson(k, n, z=1.96) → (bajo, alto): el intervalo de Wilson del 95 % para k de n (en fracción). n = 0 → (0, 1).
- p95(valores, q=0.95) → el percentil q por rango más cercano: ordenados, el de la posición int(q × (n − 1)). Sin valores,
  None. Con q = 0.5, la mediana (la de abajo, si n es par).
- resumen(carpeta) → dict con "n", "recall" ({"media", "n"}), "fugas" (cuántas preguntas), "citas"
  ({"esperada", "con_cita", "sin_cita"}), "abstencion" ({"correctas", "de", "indebidas", "de_contestables"}),
  "errores", "de_cache", "ttft_p50", "ttft_p95", "por_pregunta" ({id: por_pregunta()}). Lo escribe en <carpeta>/metricas.json.
"""

from __future__ import annotations
import math
import sys
from pathlib import Path
from _comun import GOLDEN, RAIZ, corpus, directorio, escribir_json, leer_json, leer_jsonl, principals, puede_ver

CONTESTABLES = ("directa", "varias")

SIN = ("sin_respuesta", "prohibida")


def docs(chunk_ids: list[str]) -> list[str]:
    raise NotImplementedError("paso 2: docs")


def por_pregunta(fila: dict, x: dict, ver) -> dict:
    raise NotImplementedError("paso 2: por_pregunta")


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    raise NotImplementedError("paso 2: wilson")


def p95(valores: list[float], q: float = 0.95) -> float | None:
    raise NotImplementedError("paso 2: p95")


def resumen(carpeta: Path) -> dict:
    raise NotImplementedError("paso 2: resumen")


def texto(r: dict) -> str:
    a, c = r["abstencion"], r["citas"]
    lo, hi = wilson(round(r["recall"]["media"] * r["recall"]["n"]), r["recall"]["n"]) if r["recall"]["n"] else (0, 1)
    return (f"recall@8 {r['recall']['media']:.1%} en {r['recall']['n']} contestables (Wilson, aprox.: {lo:.0%}–{hi:.0%}) · fugas {r['fugas']} · "
            f"citas a una fuente esperada {c['esperada']}/{c['con_cita']} · sin cita {c['sin_cita']} · "
            f"«no sé» correcto {a['correctas']}/{a['de']} · «no sé» indebido {a['indebidas']}/{a['de_contestables']} · "
            f"errores {r['errores']} · primer token p50 {r['ttft_p50']:.0f} ms y p95 {r['ttft_p95']:.0f} ms")


if __name__ == "__main__":
    nombre = sys.argv[1] if len(sys.argv) > 1 else sys.exit("uso: python pipeline/metricas.py <corrida>")
    print(texto(resumen(RAIZ / "corridas" / nombre)))
