"""Paso 1: juntar dos listas de resultados en una sola. BM25 da puntajes de 0 a ≈ 20 y los vectores dan cosenos de
≈ 0.7 a 0.9: no están en la misma escala, así que no se suman. RRF (Reciprocal Rank Fusion) usa solo el lugar.

Contrato (una lista = [(chunk_id, puntaje)] de mayor a menor, como la dan Buscador.bm25() y Buscador.vectores()):
- rrf(listas, k=60) → [(chunk_id, puntaje_rrf)]: cada chunk suma 1 / (k + lugar) por cada lista donde aparece
  (lugar empieza en 1); los que no aparecen en una lista no suman nada por ella. De mayor a menor; empates por chunk_id.
  k es la constante de RRF: entre más grande, más parejo cuenta el lugar 1 contra el lugar 20.
- suma(listas) → [(chunk_id, suma de puntajes crudos)]: lo que hacía el prototipo, para comparar. De mayor a menor;
  empates por chunk_id.
- fusionar(listas, metodo, k=60): metodo "rrf" o "suma" (si no, ValueError).
"""
from __future__ import annotations


def rrf(listas: list[list[tuple[str, float]]], k: int = 60) -> list[tuple[str, float]]:
    s: dict[str, float] = {}
    for lista in listas:
        for lugar, (c, _) in enumerate(lista, start=1):
            s[c] = s.get(c, 0.0) + 1.0 / (k + lugar)
    return sorted(s.items(), key=lambda x: (-x[1], x[0]))


def suma(listas: list[list[tuple[str, float]]]) -> list[tuple[str, float]]:
    s: dict[str, float] = {}
    for lista in listas:
        for c, p in lista:
            s[c] = s.get(c, 0.0) + float(p)
    return sorted(s.items(), key=lambda x: (-x[1], x[0]))


def fusionar(listas: list[list[tuple[str, float]]], metodo: str, k: int = 60) -> list[tuple[str, float]]:
    if metodo == "rrf":
        return rrf(listas, k)
    if metodo == "suma":
        return suma(listas)
    raise ValueError(f"método de fusión desconocido: {metodo} (hay rrf y suma)")


if __name__ == "__main__":
    # python pipeline/fusion.py → un ejemplo a mano: dos listas cortas, su suma cruda y su RRF
    bm = [("a", 14.2), ("b", 9.8), ("c", 7.1)]
    ve = [("c", 0.88), ("d", 0.86), ("a", 0.84)]
    print("BM25     ", bm)
    print("vectores ", ve)
    print("suma     ", [(c, round(p, 3)) for c, p in suma([bm, ve])])
    print("RRF k=60 ", [(c, round(p, 4)) for c, p in rrf([bm, ve])])
