"""Métricas offline del home (caso c08): recall@k para las fuentes de candidatos, NDCG@k y AUC para el ranker.

Cada etapa del embudo se mide con la métrica de SU trabajo:
  retrieval (cada fuente)  recall@k: de lo que la persona terminó contactando, ¿cuánto trajo la fuente
                           entre sus k candidatos? Si no está en los 1,000, el ranker nunca lo va a ver.
  ranker                   AUC: ¿ordena mejor un positivo que un negativo? (no mira la posición)
                           NDCG@k: ¿pone lo valioso ARRIBA? (sí mira la posición, con descuento log2)
Ejemplo de NDCG@3 con ganancia exponencial (2^g − 1) y descuento log2(posición + 1):
  ranking servido: [contacto (g=2), nada (0), click (g=1)]
  DCG  = 3/log2(2) + 0/log2(3) + 1/log2(4) = 3 + 0 + 0.5 = 3.5
  ideal: [contacto, click, nada] → IDCG = 3/1 + 1/log2(3) = 3 + 0.631 = 3.631
  NDCG@3 = 3.5 / 3.631 = 0.964
Hay otra definición común con ganancia lineal (g en vez de 2^g − 1): da otros números. Las dos son
correctas; lo que no se puede es comparar un número de una con uno de la otra. Aquí: exponencial.

Reglas de agregación (el error silencioso más común):
  - Un usuario sin ningún positivo NO tiene recall ni NDCG definido: se excluye y se CUENTA. Ponerle 0
    (o 1) mueve el promedio según cuántos usuarios inactivos haya en el set, no según el modelo.
  - Se promedia por usuario (macro): si no, unos pocos usuarios muy activos deciden el número.
  - Se reporta por slice (usuario nuevo vs recurrente, tamaño de ciudad): el promedio esconde al que empeora.
El set de evaluación se arma con un split TEMPORAL (entrenar hasta el día D, evaluar el D + 1): un split
aleatorio deja que el modelo vea el futuro de la misma persona.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import math  # log2
from collections import defaultdict  # agrupar por slice
from collections.abc import Callable, Hashable, Iterable, Sequence  # tipos


def recall_at_k(ranked: Sequence[Hashable], relevant: Iterable[Hashable], k: int) -> float | None:
    """|top-k ∩ relevantes| / |relevantes|. None si no hay relevantes (indefinido, no 0)."""
    rel = set(relevant)
    if not rel:
        return None
    return len(set(ranked[:k]) & rel) / len(rel)


def dcg_at_k(gains: Sequence[float], k: int) -> float:
    """Σ (2^g − 1) / log2(i + 1), i = 1..k (posición 1-based)."""
    return sum((2.0**g - 1.0) / math.log2(i + 2) for i, g in enumerate(gains[:k]))


def ndcg_at_k(ranked: Sequence[Hashable], grades: dict[Hashable, float], k: int) -> float | None:
    """NDCG@k con etiquetas graduadas por ítem (p. ej. 0 nada, 1 click, 2 contacto).

    El ideal sale de TODOS los ítems con etiqueta del usuario, no solo de los que el modelo puso en el
    top-k: si no, un modelo que deja afuera lo mejor se ve perfecto. None si no hay ninguna ganancia > 0.
    """
    ideal = dcg_at_k(sorted(grades.values(), reverse=True), k)
    if ideal == 0:
        return None
    return dcg_at_k([grades.get(i, 0.0) for i in ranked], k) / ideal


def auc(scores: Sequence[float], labels: Sequence[int]) -> float | None:
    """AUC por rangos (Mann–Whitney): P(score de un positivo > score de un negativo); empates valen ½.

    Rangos promedio para los empates: sin eso, un modelo que da el mismo score a todo saldría ≠ 0.5
    según el orden de los datos. None si falta una de las dos clases.
    """
    if len(scores) != len(labels):
        raise ValueError("scores y labels de distinto largo")
    n_pos = sum(1 for y in labels if y)
    n_neg = len(labels) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None
    order = sorted(range(len(scores)), key=lambda i: scores[i])
    ranks = [0.0] * len(scores)
    i = 0
    while i < len(order):  # bloques de empates → rango promedio (1-based)
        j = i
        while j + 1 < len(order) and scores[order[j + 1]] == scores[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for t in range(i, j + 1):
            ranks[order[t]] = avg
        i = j + 1
    sum_pos = sum(r for r, y in zip(ranks, labels) if y)
    return (sum_pos - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)


def mean_defined(values: Iterable[float | None]) -> tuple[float | None, int, int]:
    """(promedio de los definidos, cuántos se usaron, cuántos se excluyeron por indefinidos)."""
    vals = list(values)
    ok = [v for v in vals if v is not None]
    return (sum(ok) / len(ok) if ok else None), len(ok), len(vals) - len(ok)


def by_slice(rows: Iterable[dict], slice_of: Callable[[dict], str], metric: Callable[[dict], float | None]
             ) -> dict[str, tuple[float | None, int, int]]:
    """Métrica por slice: {slice: (promedio, usados, excluidos)}. rows = una fila por usuario."""
    groups: dict[str, list[float | None]] = defaultdict(list)
    for r in rows:
        groups[slice_of(r)].append(metric(r))
    return {s: mean_defined(v) for s, v in sorted(groups.items())}
