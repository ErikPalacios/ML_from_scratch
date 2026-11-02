"""Calibración del pCTR (caso c15): corrección del submuestreo, isotónica, bins de confiabilidad, ECE y
calibration ratio por slice.

Por qué importa más aquí que en casi cualquier otro modelo: el pCTR entra al DINERO. El eCPM es
bid × pCTR × 1000 (quién gana y si pasa la reserva) y el precio por click es eCPM del siguiente ÷
(1000 × pCTR del ganador) (serving/auction.py). Un modelo con AUC excelente y pCTR inflado al doble
ordena bien y cobra mal.

El orden de las operaciones (el mismo que aplica el serving, model.HashedLogisticModel.to_probability):
  1. p  = σ(logit)                              el modelo, en la escala SUBMUESTREADA (w = 5 % de negativos)
  2. q  = p / (p + (1 − p) / w)                 corrección de He et al. (2014): vuelve a la escala real
  3. q' = isotónica(q)                          opcional: arregla lo que la corrección no arregla (la forma)
La isotónica se ajusta con un holdout FRESCO y SIN submuestrear (build_training_set con neg_rate = 1),
de días que el modelo no vio. Si se ajusta sobre el set de entrenamiento, aprende a perdonar el
sobreajuste del modelo. En el caso: la mitad del día siguiente (hash del imp_id con su propia sal); la
otra mitad es el set del gate, que así no mide a la isotónica sobre sus propios datos (el split y el gate
no están en esta carpeta).

Ejemplo de bins de confiabilidad (cuantiles: cada bin con la misma cantidad de impresiones):
  bin   impresiones   pCTR medio   CTR observado   observado ÷ esperado
  1       100,000       0.10 %         0.09 %              0.90
  2       100,000       0.30 %         0.33 %              1.10
  3       100,000       1.20 %         1.08 %              0.90
  ECE = Σ (impresiones del bin ÷ total) × |CTR observado − pCTR medio|
      = (0.0001 + 0.0003 + 0.0012) / 3 ≈ 0.053 puntos porcentuales
Trampa de los bins uniformes: con CTR ≈ 0.35 %, bins de ancho 0.1 en [0, 1] meten TODO en el primer bin y
el ECE se reduce a |CTR medio − pCTR medio| (la calibración global): no ve que el modelo sobreestima los
CTR altos y subestima los bajos. Por eso los bins por cuantiles.
Trampa de la maldición del ganador (razonamiento, no una medición): si el pCTR tiene ruido, los anuncios
sobreestimados ganan la subasta más seguido. Entre las impresiones SERVIDAS, observados ÷ esperados tiende
a quedar bajo 1 aunque el modelo esté calibrado sobre todos los candidatos. El tráfico de exploración
(elegido al azar) es el que mide la calibración sin ese sesgo: compara los dos (ver alerts.yml). Y la
selección igual es dinero: el precio de los ganadores sale de un pCTR inflado; se corrige ajustando la
isotónica con impresiones que eligió ese mismo modelo, vigilando el slice de anuncios nuevos.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

from collections import defaultdict  # agrupar por slice
from collections.abc import Callable, Iterable  # tipos
from dataclasses import dataclass  # un bin de confiabilidad

import numpy as np  # cálculo vectorizado
from sklearn.isotonic import IsotonicRegression  # el ajuste isotónico (solo en training: el serving usa np.interp)

from model import correct_downsampling  # LA corrección vive con el modelo (serving/model.py); se re-exporta
from offline_metrics import calibration_ratio  # LA definición del cociente (eval/offline_metrics.py)

__all__ = ["correct_downsampling", "downsampled_ctr", "fit_isotonic", "apply_isotonic", "reliability_bins",
           "expected_calibration_error", "calibration_by_slice", "calibration_ratio"]


def downsampled_ctr(ctr: float, w: float) -> float:
    """El CTR que se VE en el set submuestreado: c / (c + (1 − c) × w). La inversa de correct_downsampling.

    Con el CTR del caso (0.35 %) y w = 5 %: 0.0035 / (0.0035 + 0.9965 × 0.05) ≈ 6.56 %. Es el número que
    predice un modelo sin corregir, y la razón de que un pCTR "de 6 %" no sea una buena noticia.
    """
    return ctr / (ctr + (1.0 - ctr) * w)


@dataclass(frozen=True)
class ReliabilityBin:
    lo: float  # pCTR mínimo del bin
    hi: float  # pCTR máximo del bin
    n: int  # impresiones
    mean_pred: float  # pCTR medio (lo esperado)
    observed: float  # CTR observado
    ratio: float | None  # observado ÷ esperado (None si el bin no espera clicks)


def fit_isotonic(q, y, sample_weight=None) -> tuple[np.ndarray, np.ndarray]:
    """Ajusta la isotónica de q (pCTR ya corregido) → CTR observado. Devuelve (umbrales_x, umbrales_y).

    Se exportan los umbrales (X_thresholds_, y_thresholds_; scikit-learn ≥ 0.24) y no el objeto: el serving
    los aplica con np.interp sin importar scikit-learn, y un artefacto de dos arreglos no es un pickle.
    out_of_bounds="clip": un pCTR fuera del rango visto en el holdout toma el valor del extremo (no NaN).
    Trampa: la isotónica es una escalera con tantos escalones como el holdout permita; con pocos clicks
    sobreajusta (escalones de 3 clicks). Necesita miles de clicks en el holdout; con menos, Platt (una
    logística sobre el logit, 2 parámetros) es más estable. Compáralas por log loss en OTRO holdout.
    """
    q, y = np.asarray(q, dtype=np.float64), np.asarray(y, dtype=np.float64)
    iso = IsotonicRegression(y_min=0.0, y_max=1.0, increasing=True, out_of_bounds="clip")
    iso.fit(q, y, sample_weight=sample_weight)
    return np.asarray(iso.X_thresholds_, dtype=np.float64), np.asarray(iso.y_thresholds_, dtype=np.float64)


def apply_isotonic(x_thr: np.ndarray, y_thr: np.ndarray, q) -> np.ndarray:
    """Lo mismo que hace el serving (model.to_probability): interpolación lineal entre umbrales, con tope."""
    return np.interp(np.asarray(q, dtype=np.float64), x_thr, y_thr)


def reliability_bins(p, y, n_bins: int = 10, strategy: str = "quantile") -> list[ReliabilityBin]:
    """Bins de confiabilidad. strategy="quantile" (misma cantidad de filas por bin) o "uniform" (mismo ancho)."""
    p, y = np.asarray(p, dtype=np.float64), np.asarray(y, dtype=np.float64)
    if strategy == "quantile":
        edges = np.unique(np.quantile(p, np.linspace(0, 1, n_bins + 1)))  # unique: empates colapsan bordes
    elif strategy == "uniform":
        edges = np.linspace(0.0, 1.0, n_bins + 1)
    else:
        raise ValueError(f"strategy desconocida: {strategy}")
    # bin de cada predicción: [edges[i], edges[i+1]) y el último cerrado a la derecha
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, len(edges) - 2)
    out = []
    for b in range(len(edges) - 1):
        mask = idx == b
        n = int(mask.sum())
        if n == 0:
            continue
        mean_pred, observed = float(p[mask].mean()), float(y[mask].mean())
        out.append(ReliabilityBin(lo=float(edges[b]), hi=float(edges[b + 1]), n=n, mean_pred=mean_pred,
                                  observed=observed, ratio=observed / mean_pred if mean_pred > 0 else None))
    return out


def expected_calibration_error(p, y, n_bins: int = 10, strategy: str = "quantile") -> float:
    """ECE = Σ (n_bin / N) × |CTR observado − pCTR medio|, en la escala de la probabilidad."""
    bins = reliability_bins(p, y, n_bins, strategy)
    total = sum(b.n for b in bins)
    return float(sum(b.n / total * abs(b.observed - b.mean_pred) for b in bins))


def calibration_by_slice(rows: Iterable[dict], slice_of: Callable[[dict], str], *, label: str = "label",
                         pred: str = "pctr", min_expected: float = 100.0) -> dict[str, dict]:
    """Observados ÷ esperados por slice (slot, sección, anuncio nuevo vs viejo…).

    Un slice con menos de `min_expected` clicks esperados devuelve ratio None: con 20 clicks esperados, el
    ruido de Poisson solo (≈ ±22 %) ya saca el cociente de 0.9–1.1 sin que el modelo tenga nada.
    """
    groups: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for r in rows:
        groups[slice_of(r)].append((r[label], r[pred]))
    out = {}
    for s, pairs in sorted(groups.items()):
        y, p = (np.array(v, dtype=np.float64) for v in zip(*pairs, strict=True))
        expected = float(p.sum())
        out[s] = {"n": len(y), "clicks": float(y.sum()), "expected": expected,
                  "ratio": calibration_ratio(y, p) if expected >= min_expected else None}
    return out
