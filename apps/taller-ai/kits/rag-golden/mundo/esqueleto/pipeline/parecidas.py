"""Paso 3 · Preguntas casi iguales: la misma pregunta escrita dos veces cuenta doble en el examen.

    python pipeline/parecidas.py almacen/candidatos/expertos.jsonl      # los pares parecidos de un lote

Contrato:
- similitud(a, b) -> float de 0 a 1: la similitud de Jaccard entre los conjuntos de palabras de dos textos (palabras() de
  _comun.py: sin acentos, sin mayúsculas, sin las palabras vacías). Dos textos sin palabras dan 0.
- pares(items, umbral) -> lista de (id_a, id_b, similitud) con id_a < id_b, de los items del mismo tipo cuya pregunta
  tiene similitud ≥ umbral, ordenada por (id_a, id_b). Dos preguntas iguales de tipos distintos (una directa y su versión
  prohibida para otra persona) no son repetidas: prueban cosas distintas.
- quitar(items, umbral, publicados=()) -> (quedan, quitadas). Recorre los items del más viejo al más nuevo: primero los
  que ya estaban publicados (sus ids en `publicados`), después los demás, cada grupo por id. Un item se queda si no se
  parece (≥ umbral, mismo tipo) a ninguno de los que ya se quedaron; si se parece, va a `quitadas` como
  (id, id_del_que_se_quedó, similitud). `quedan` sale en el orden en que entraron.
"""

from __future__ import annotations
import argparse
from _comun import config, leer_jsonl, palabras


def similitud(a: str, b: str) -> float:
    raise NotImplementedError("paso 3: similitud")


def pares(items: list[dict], umbral: float) -> list[tuple[str, str, float]]:
    raise NotImplementedError("paso 3: pares")


def quitar(items: list[dict], umbral: float, publicados=()) -> tuple[list[dict], list[tuple[str, str, float]]]:
    raise NotImplementedError("paso 3: quitar")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("lote")
    ap.add_argument("--umbral", type=float)
    a = ap.parse_args()
    u = a.umbral if a.umbral is not None else config()["parecidas"]["umbral"]
    xs = [x for x in leer_jsonl(a.lote) if isinstance(x.get("pregunta"), str) and x.get("tipo")]
    texto = {x["id"]: x["pregunta"] for x in xs}
    ps = pares(xs, u)
    for i, j, s in ps:
        print(f"{s:.2f}  {i} «{texto[i]}»\n      {j} «{texto[j]}»")
    print(f"{len(ps)} par(es) del mismo tipo con similitud ≥ {u} entre {len(xs)} preguntas ({len(xs) * (len(xs) - 1) // 2} pares revisados)")
