"""El modelo que está en producción, para evaluarlo offline (en C01 lo bajarías del model registry).

    from mundo.modelo import predecir
    probs = predecir([pil_image, …])     # (n, 10): una probabilidad por categoría; «bolsas» siempre es 0

Recibe las fotos tal como están en S3 (112×112) y las lleva a 28×28 como las vio el modelo al entrenar.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, OCULTO  # noqa: E402

_m = None


def predecir(imagenes: list[Image.Image]) -> np.ndarray:
    global _m
    if _m is None:
        import joblib
        _m = joblib.load(OCULTO / "modelo.joblib")
    X = np.stack([np.asarray(im.convert("L").resize((28, 28), Image.Resampling.BOX), dtype=np.float64) / 255.0
                  for im in imagenes]).reshape(len(imagenes), -1)
    out = np.zeros((len(imagenes), len(CLASES)))
    out[:, _m.classes_] = _m.predict_proba(X)
    return out
