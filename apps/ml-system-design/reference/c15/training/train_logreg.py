"""Entrenamiento diario de la regresión logística hasheada (caso c15), en numpy.

Entrada: las filas de build_training_set.py (registro crudo, slot REAL, label, neg_rate).
Salida: serving/model.HashedLogisticModel con sus pesos, su neg_rate y la versión del esquema de features.

La regla de actualización es SGD con learning rate POR COORDENADA:
    η_i = α / (β + sqrt(Σ g_i²))
He et al. (2014) la reportan como la mejor de las que compararon para su regresión logística (con α = 0.1
y β = 1.0 en su tabla de parámetros) y la atribuyen a McMahan et al. (2013, "Ad Click Prediction: a View
from the Trenches"). Por qué por coordenada: "device=mobile" está en casi todas las filas y necesita pasos
chicos; el anuncio que salió ayer tiene unas cientos de impresiones y necesita pasos grandes. Un learning
rate global sirve mal a los dos.
Warm start (el caso entrena todos los días sobre los últimos 14): el entrenamiento de hoy arranca de los
pesos Y de los acumuladores Σ g² de ayer (TrainState); así un peso viejo y estable no vuelve a dar pasos
grandes cada mañana.
Vectorizado por mini-batch: los índices que tocó el batch, el gradiente por bucket con bincount, y solo
esos buckets se actualizan (de 16.8 M pesos, un batch de 256 filas toca unos miles).
SIN peso 1/w en los negativos: se entrena en la escala submuestreada y se corrige al predecir (model.py).
Una de las dos, nunca ambas.
En producción, el mismo algoritmo en un job distribuido (o la DNN en PyTorch); aquí, numpy para leerlo.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

from collections.abc import Sequence  # tipos de entrada
from dataclasses import dataclass  # estado del entrenamiento

import numpy as np  # todo el cálculo

import features as F  # serving/features.py: los MISMOS índices que verá el serving
from build_training_set import single_neg_rate  # una sola w por modelo
from model import HashedLogisticModel, sigmoid  # serving/model.py: el artefacto que se publica


@dataclass
class TrainState:
    """Lo que necesita el warm start de mañana: pesos y acumuladores (en float64 durante el training)."""

    weights: np.ndarray  # (N_BUCKETS,)
    g2: np.ndarray  # Σ g² por bucket
    bias: float = 0.0
    bias_g2: float = 0.0

    @classmethod
    def zeros(cls) -> TrainState:
        # np.zeros pide memoria en cero sin tocarla: 2 × 128 MiB que solo se materializan donde se escribe
        return cls(np.zeros(F.N_BUCKETS), np.zeros(F.N_BUCKETS))


def hashed_rows(rows: Sequence[dict]) -> tuple[list[np.ndarray], np.ndarray]:
    """Filas del set → índices (con la posición REAL: así el modelo aprende el efecto de cada slot)."""
    X = [F.row_indices(r["raw"], r["slot"]) for r in rows]
    y = np.fromiter((r["label"] for r in rows), dtype=np.float64, count=len(rows))
    return X, y


def train(X: Sequence[np.ndarray], y: np.ndarray, *, state: TrainState | None = None, epochs: int = 2,
          alpha: float = 0.1, beta: float = 1.0, l2: float = 1e-4, batch_size: int = 256,
          seed: int = 0) -> TrainState:
    """Mini-batch SGD con learning rate por coordenada sobre log loss. Devuelve el estado (para el warm start).

    l2 (ilustrativo) frena los pesos de features que aparecen pocas veces y siempre con el mismo label.
    """
    st = state or TrainState.zeros()
    rng = np.random.default_rng(seed)  # el orden de las filas: reproducible
    n = len(X)
    for _ in range(epochs):
        order = rng.permutation(n)
        for start in range(0, n, batch_size):
            idx = order[start:start + batch_size]
            rows = [X[i] for i in idx]
            lengths = np.fromiter((len(r) for r in rows), dtype=np.int64, count=len(rows))
            flat = np.concatenate(rows)
            starts = np.concatenate(([0], np.cumsum(lengths)[:-1]))
            z = st.bias + np.add.reduceat(st.weights[flat], starts)  # el mismo logit que model.py
            g_row = sigmoid(z) - y[idx]  # ∂ log loss / ∂ logit, por fila
            uniq, inv = np.unique(flat, return_inverse=True)  # buckets que tocó este batch
            g = np.bincount(inv, weights=np.repeat(g_row, lengths), minlength=len(uniq))
            g += l2 * st.weights[uniq]
            st.g2[uniq] += g * g
            st.weights[uniq] -= alpha / (beta + np.sqrt(st.g2[uniq])) * g
            gb = float(g_row.sum())  # el sesgo es una coordenada más
            st.bias_g2 += gb * gb
            st.bias -= alpha / (beta + np.sqrt(st.bias_g2)) * gb
    return st


def to_model(state: TrainState, *, neg_rate: float, version: str) -> HashedLogisticModel:
    """El artefacto de serving: pesos en float32 (≈ 64 MiB), con su w y su versión de features."""
    return HashedLogisticModel(weights=state.weights.astype(np.float32), bias=state.bias, neg_rate=neg_rate,
                               version=version)


def fit_model(rows: Sequence[dict], *, version: str, state: TrainState | None = None,
              **train_kw) -> HashedLogisticModel:
    """Atajo: filas del set → modelo listo para servir (sin calibración isotónica: ver calibration.py)."""
    w = single_neg_rate(rows)  # una sola w por modelo (si no, la corrección no vale)
    X, y = hashed_rows(rows)
    return to_model(train(X, y, state=state, **train_kw), neg_rate=w, version=version)
