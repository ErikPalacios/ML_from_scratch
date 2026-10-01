"""Reciprocal Rank Fusion (RRF): junta la lista del ANN (semántica) y la de BM25 (palabras exactas).

Definición (Cormack, Clarke y Büttcher, "Reciprocal Rank Fusion outperforms Condorcet and individual
Rank Learning Methods", SIGIR 2009):

    RRF(d) = Σ_listas  1 / (k + rank_lista(d))        rank empieza en 1, k = 60

Ejemplo a mano (k = 60):
    listing A: 1.º en ANN y 3.º en BM25  → 1/61 + 1/63 = 0.016393 + 0.015873 = 0.032266
    listing B: 1.º solo en BM25          → 1/61                    = 0.016393
    listing C: 20.º en ANN y 20.º en BM25 → 1/80 + 1/80             = 0.025000   (¡le gana a B!)

Por qué RRF y no sumar scores: el score de BM25 (0 a ~30, depende de la consulta y del largo del
texto) y el coseno del ANN (−1 a 1) no están en la misma escala, y normalizarlos (min-max por consulta)
es frágil: un outlier mueve toda la lista. RRF solo usa POSICIONES, así que no hay que calibrar nada.
El costo: premia mucho el acuerdo entre listas (el ejemplo de C) e ignora "qué tan seguro" estaba cada
sistema. k grande aplana la diferencia entre el 1.º y el 10.º; k chico la agranda. 60 es el valor del
paper; cámbialo solo si una evaluación offline (eval/offline_eval.py) dice que mejora NDCG@10.

Puro: sin dependencias. Lo usa search/api.py.
"""

from __future__ import annotations  # anotaciones como texto (sintaxis moderna sin costo en runtime)

from collections.abc import Mapping, Sequence  # tipos de entrada: cualquier dict / lista sirve
from dataclasses import dataclass, field  # resultado inmutable y fácil de comparar en tests

DEFAULT_K = 60  # el k del paper; mismo valor en el caso c07 (§ serving)


@dataclass(frozen=True)
class Fused:
    """Un documento después de fusionar: score RRF + en qué posición estaba en cada lista."""

    doc_id: str
    score: float
    # lista → rank (1-based). Sirve para depurar ("¿por qué salió esto?") y para el log de la búsqueda:
    # sin esto no puedes medir después cuánto aporta cada fuente.
    ranks: dict[str, int] = field(default_factory=dict)

    @property
    def best_rank(self) -> int:
        return min(self.ranks.values())


def rrf(
    rankings: Mapping[str, Sequence[str] | None],
    k: int = DEFAULT_K,
    weights: Mapping[str, float] | None = None,
    limit: int | None = None,
) -> list[Fused]:
    """Fusiona listas ordenadas (mejor primero) de ids. Devuelve la lista fusionada, mejor primero.

    rankings: {"ann": [...ids...], "bm25": [...ids...]}. Una lista None o vacía se ignora: si BM25
      falló, RRF con solo el ANN devuelve el mismo orden del ANN (lo que queremos como fallback).
    weights: peso por lista (por defecto 1.0). Un peso ≠ 1 ya es "RRF ponderado", no el del paper:
      úsalo solo si lo justifica una evaluación offline.
    limit: cuántos devolver (None = todos).
    """
    if k <= 0:
        # k = 0 haría que el 1.º valga 1 y el 2.º 0.5: el primer lugar de UNA lista domina todo.
        raise ValueError("k debe ser > 0")
    weights = weights or {}
    scores: dict[str, float] = {}
    ranks: dict[str, dict[str, int]] = {}
    for name, ids in rankings.items():
        if not ids:
            continue  # lista faltante (timeout, error) o sin resultados: no aporta nada
        w = float(weights.get(name, 1.0))
        seen: set[str] = set()
        rank = 0
        for doc_id in ids:
            if doc_id in seen:
                # Un id repetido en la MISMA lista (dos shards devolvieron el mismo listing durante una
                # migración) cuenta una sola vez, con su mejor posición. Si sumara dos veces, un bug de
                # duplicados se convertiría en un boost.
                continue
            seen.add(doc_id)
            rank += 1  # el rank sale de la posición entre ids ÚNICOS: el duplicado no empuja a los demás
            scores[doc_id] = scores.get(doc_id, 0.0) + w / (k + rank)
            ranks.setdefault(doc_id, {})[name] = rank
    fused = [Fused(d, s, ranks[d]) for d, s in scores.items()]
    # Empates (pasan seguido: dos docs que están 1.º y 2.º en listas distintas no empatan, pero dos docs
    # que solo aparecen en una lista con el mismo rank sí). Orden DETERMINISTA: score ↓, mejor rank ↑,
    # más listas ↓, id ↑. Sin esto el orden depende del orden del dict, y la página 2 puede repetir un
    # resultado de la página 1 (o saltarse uno) entre dos requests iguales.
    fused.sort(key=lambda f: (-f.score, f.best_rank, -len(f.ranks), f.doc_id))
    return fused if limit is None else fused[:limit]
