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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import GOLDEN, RAIZ, corpus, directorio, escribir_json, leer_json, leer_jsonl, principals, puede_ver  # noqa: E402

CONTESTABLES = ("directa", "varias")
SIN = ("sin_respuesta", "prohibida")


def docs(chunk_ids: list[str]) -> list[str]:
    out = []
    for c in chunk_ids:
        d = c.split("#", 1)[0]
        if d not in out:
            out.append(d)
    return out


def por_pregunta(fila: dict, x: dict, ver) -> dict:
    esperados = set(docs([f["chunk_id"] for f in x["fuentes"]]))
    en_ctx = set(docs(fila["contexto"]))
    contesto = not fila["no_se"] and not fila["error"]
    citados = set(docs(fila["citas"]))
    fuga = any(not ver(c) for c in fila["contexto"] + fila["citas"])
    if x["tipo"] == "prohibida":
        fuga = fuga or bool({f["chunk_id"] for f in x["fuentes"]} & set(fila["contexto"]))
    contestable = x["tipo"] in CONTESTABLES
    return {
        "recall": len(esperados & en_ctx) / len(esperados) if contestable and esperados else None,
        "fuga": fuga,
        "contesto": contesto,
        "cita_esperada": bool(citados & esperados) if contestable and contesto and citados else None,
        "sin_cita": contestable and contesto and not citados,
        "abstencion": ("correcta" if fila["no_se"] else None) if x["tipo"] in SIN else ("indebida" if fila["no_se"] else None),
        "ttft": fila["ms"]["ttft"],
        "error": fila["error"],
    }


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    c = (p + z * z / (2 * n)) / (1 + z * z / n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return max(0.0, c - m), min(1.0, c + m)


def p95(valores: list[float], q: float = 0.95) -> float | None:
    v = sorted(x for x in valores if x is not None)
    return v[int(q * (len(v) - 1))] if v else None


def _golden(version: str) -> dict:
    return {x["id"]: x for x in leer_jsonl(GOLDEN / version / "preguntas.jsonl")}


def resumen(carpeta: Path) -> dict:
    carpeta = Path(carpeta)
    filas = leer_jsonl(carpeta / "respuestas.jsonl")
    m = leer_json(carpeta / "manifiesto.json")
    g = _golden(m["golden"]["version"])
    ch, d = corpus()["chunks"], directorio()
    pp = {}
    for f in filas:
        ps = principals(f["persona"], d)
        pp[f["id"]] = por_pregunta(f, g[f["id"]], lambda c, ps=ps: c in ch and puede_ver(ch[c]["acl"], ps))
    rec = [v["recall"] for v in pp.values() if v["recall"] is not None]
    cit = [v["cita_esperada"] for v in pp.values() if v["cita_esperada"] is not None]
    sin = [i for i in pp if g[i]["tipo"] in SIN]
    cont = [i for i in pp if g[i]["tipo"] in CONTESTABLES]
    r = {
        "n": len(filas),
        "recall": {"media": sum(rec) / len(rec) if rec else None, "n": len(rec)},
        "fugas": sum(v["fuga"] for v in pp.values()),
        "citas": {"esperada": sum(cit), "con_cita": len(cit), "sin_cita": sum(v["sin_cita"] for v in pp.values())},
        "abstencion": {"correctas": sum(pp[i]["abstencion"] == "correcta" for i in sin), "de": len(sin),
                       "indebidas": sum(pp[i]["abstencion"] == "indebida" for i in cont), "de_contestables": len(cont)},
        "errores": sum(1 for f in filas if f["error"]),
        "de_cache": sum(1 for f in filas if f["de_cache"]),
        "ttft_p50": p95([v["ttft"] for v in pp.values()], 0.5),
        "ttft_p95": p95([v["ttft"] for v in pp.values()]),
        "por_pregunta": pp,
    }
    escribir_json(carpeta / "metricas.json", r)
    return r


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
