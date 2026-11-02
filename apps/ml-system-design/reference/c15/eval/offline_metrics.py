"""Métricas offline del modelo de CTR (caso c15): log loss, normalized entropy (NE), AUC y calibration ratio.

Cada una contesta otra pregunta, y un modelo de anuncios necesita las cuatro:
  log loss            ¿qué tan buenas son las probabilidades? (castiga confiar mucho y fallar)
  NE                  log loss ÷ el log loss de predecir siempre el CTR de fondo: < 1 = mejor que no saber
                      nada; comparable entre días con CTR distinto (He et al., 2014: la métrica principal
                      de su paper; también la llaman Normalized Cross-Entropy)
  AUC                 ¿ordena bien? P(score de un click > score de un no-click). NO mira la escala: un modelo
                      que predice el doble de todo tiene el mismo AUC
  calibration ratio   clicks observados ÷ clicks esperados (Σ pCTR). 1.0 = la escala es correcta. Es la que
                      importa para el dinero: el pCTR multiplica el bid en el eCPM y divide el precio
Ejemplo a mano (los tests lo usan): labels [1, 0, 0, 0], predicciones [0.5, 0.1, 0.2, 0.1]
  log loss = −(ln 0.5 + ln 0.9 + ln 0.8 + ln 0.9) / 4 = (0.6931 + 0.1054 + 0.2231 + 0.1054) / 4 = 0.2818
  CTR de fondo 0.25 → entropía = −(0.25 ln 0.25 + 0.75 ln 0.75) = 0.5623 → NE = 0.2818 / 0.5623 = 0.5010
  AUC = 1.0 (el único click tiene el score más alto) · calibration ratio = 1 / 0.9 = 1.11 (predice de menos)
Por qué AUC no alcanza: multiplicar todas las predicciones por 2 deja el AUC igual y deja la calibración en
0.5 (los anunciantes pagarían la mitad cuando el precio sale de la reserva). NE sí lo ve: empeora.

Trampas:
  - Ojo con la dirección del cociente: aquí, observados ÷ esperados (> 1 = el modelo subestima). He et al.
    definen "calibration" al revés (esperados ÷ observados). Las dos buscan 1.0; lo que no se puede es
    mezclarlas en un mismo dashboard.
  - CTR de fondo de la NE: He et al. usan el CTR promedio del set de ENTRENAMIENTO. Si el training está
    submuestreado (w = 5 % de los negativos), su CTR crudo es ≈ 19× el real: usa el CTR real (el del set
    de evaluación sin submuestrear, o el de training corregido), nunca el crudo del set submuestreado.
  - Evalúa sobre filas SIN submuestrear (o con peso 1/w en los negativos): sobre el set submuestreado,
    Σ pCTR corregido no se compara con los clicks (faltan el 95 % de los negativos).
  - Promedio que esconde: siempre por slice (slot, sección, anuncios nuevos vs viejos, src).
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

from collections import defaultdict  # agrupar por slice
from collections.abc import Callable, Iterable  # tipos

import numpy as np  # todo vectorizado

EPS = 1e-15  # recorte de probabilidades: log(0) = −inf haría infinito el log loss por UNA predicción


def _arrays(y, p) -> tuple[np.ndarray, np.ndarray]:
    y, p = np.asarray(y, dtype=np.float64), np.asarray(p, dtype=np.float64)
    if y.shape != p.shape or y.ndim != 1:
        raise ValueError("labels y predicciones: mismo largo, una dimensión")
    return y, p


def log_loss(y, p) -> float:
    """−mean(y ln p + (1 − y) ln(1 − p)), con p recortado a [EPS, 1 − EPS]."""
    y, p = _arrays(y, p)
    p = np.clip(p, EPS, 1 - EPS)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def entropy(ctr: float) -> float:
    """Log loss de predecir siempre `ctr` cuando el CTR real es `ctr`: −(c ln c + (1 − c) ln(1 − c))."""
    c = min(max(ctr, EPS), 1 - EPS)
    return float(-(c * np.log(c) + (1 - c) * np.log(1 - c)))


def normalized_entropy(y, p, background_ctr: float | None = None) -> float:
    """NE = log loss ÷ entropía del CTR de fondo. Por defecto, el CTR de fondo es el del propio set.

    Con background_ctr = el del set, predecir ese CTR para todos da NE = 1 exacto (un test lo exige).
    """
    y, p = _arrays(y, p)
    bg = float(y.mean()) if background_ctr is None else background_ctr
    return log_loss(y, p) / entropy(bg)


def auc(y, p) -> float | None:
    """AUC por rangos (Mann–Whitney): (Σ rangos de los positivos − n₊(n₊ + 1)/2) / (n₊ · n₋).

    Empates → rango promedio (valen ½): sin eso, un modelo que da el mismo score a todo saldría ≠ 0.5
    según el orden de las filas. None si falta una de las dos clases (indefinido, no 0.5).
    """
    y, p = _arrays(y, p)
    n_pos = int(y.sum())
    n_neg = len(y) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None
    order = np.argsort(p, kind="mergesort")
    sorted_p = p[order]
    ranks = np.empty(len(p))
    # Bloques de valores iguales → rango promedio (1-based)
    _, first, counts = np.unique(sorted_p, return_index=True, return_counts=True)
    avg = first + (counts + 1) / 2.0
    ranks[order] = np.repeat(avg, counts)
    return float((ranks[y == 1].sum() - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def calibration_ratio(y, p) -> float | None:
    """Clicks observados ÷ clicks esperados (Σ pCTR). LA definición del caso; calibration.py la importa.

    None si no hay clicks esperados (indefinido). Objetivo del caso: entre 0.9 y 1.1 por hora y por slice.
    """
    y, p = _arrays(y, p)
    expected = float(p.sum())
    return None if expected <= 0 else float(y.sum()) / expected


def evaluate(y, p, background_ctr: float | None = None) -> dict[str, float | None]:
    """Las cuatro de una vez, más el volumen (para no confiar en un slice con 12 clicks)."""
    y, p = _arrays(y, p)
    return {"n": float(len(y)), "clicks": float(y.sum()), "expected_clicks": float(p.sum()),
            "log_loss": log_loss(y, p), "ne": normalized_entropy(y, p, background_ctr),
            "auc": auc(y, p), "calibration_ratio": calibration_ratio(y, p)}


def by_slice(rows: Iterable[dict], slice_of: Callable[[dict], str], *, label: str = "label",
             pred: str = "pctr", background_ctr: float | None = None) -> dict[str, dict]:
    """Métricas por slice. El CTR de fondo de la NE es el GLOBAL (si no se pasa): con el de cada slice, la
    NE de un slice con CTR alto y la de uno con CTR bajo no se comparan."""
    groups: dict[str, list[tuple[float, float]]] = defaultdict(list)
    all_y = []
    for r in rows:
        groups[slice_of(r)].append((r[label], r[pred]))
        all_y.append(r[label])
    bg = background_ctr if background_ctr is not None else float(np.mean(all_y)) if all_y else None
    out = {}
    for s, pairs in sorted(groups.items()):
        y, p = zip(*pairs, strict=True)
        out[s] = evaluate(y, p, bg)
    return out
