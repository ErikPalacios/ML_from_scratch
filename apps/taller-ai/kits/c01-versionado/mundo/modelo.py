"""El «entrenamiento» del mundo: un clasificador de juguete (centroide más cercano sobre la foto reducida a 8×8).

La estación 3 entrena de verdad. Aquí solo importa qué entra (qué filas, qué fotos, qué semilla) y qué queda
anotado, así que el modelo es chico, determinista y tarda un segundo.
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image


def rasgos(foto: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(foto)).convert("RGB").resize((8, 8)), dtype=np.float32).ravel() / 255


def entrenar(train: list[tuple[bytes, int]], val: list[tuple[bytes, int]], semilla: int) -> dict:
    """train y val: listas de (bytes de la foto, label_id). Devuelve las métricas."""
    rng = np.random.default_rng(semilla)
    orden = rng.permutation(len(train))                       # la semilla fija el orden, como en un entrenamiento real
    X = np.stack([rasgos(train[i][0]) for i in orden])
    y = np.array([train[i][1] for i in orden])
    clases = np.unique(y)
    centros = np.stack([X[y == c].mean(axis=0) for c in clases])
    Xv = np.stack([rasgos(f) for f, _ in val])
    yv = np.array([l for _, l in val])
    pred = clases[np.argmin(((Xv[:, None, :] - centros[None]) ** 2).sum(-1), axis=1)]
    return {"accuracy_val": round(float((pred == yv).mean()), 4), "n_train": len(train), "n_val": len(val)}
