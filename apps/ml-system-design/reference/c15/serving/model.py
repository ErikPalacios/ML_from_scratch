"""Modelo de CTR del caso c15: regresión logística sobre features hasheadas, con su corrección de muestreo.

Por qué este modelo como baseline: predice ≈ 150 candidatos en microsegundos de CPU (sumar ≈ 25 pesos por
fila), se entrena todos los días en minutos y, como minimiza log loss, sale bien calibrado en la
distribución con la que se entrenó. La DNN con embeddings (tipo DCN/DeepFM) es el siguiente paso del caso
y se sirve igual: en CPU, un batch por request, con la misma corrección al final.

Qué viaja DENTRO del artefacto (y por qué no en la configuración del serving):
  weights, bias            los pesos (2^24 float32 ≈ 64 MiB) y el sesgo
  neg_rate                 w, la tasa de negativos con la que se submuestreó el entrenamiento. Si viviera
                           en una variable de entorno del ad-api, el día que training pase de 5 % a 2 %
                           el serving seguiría corrigiendo con 5 % y todos los pCTR saldrían mal, sin error
  feature_set_version      el esquema de features.py con el que se entrenó (otro esquema = otros índices)
  calib_x, calib_y         la recalibración isotónica opcional (training/calibration.py), como dos
                           arreglos: el serving la aplica con np.interp y no necesita scikit-learn

La corrección de muestreo (He et al., 2014, "Practical Lessons from Predicting Clicks on Ads at Facebook").
Ejemplo primero: CTR real 0.35 %. Se guardan todos los clicks y w = 5 % de los no-clicks, así que en el set
de entrenamiento el CTR es 0.0035 / (0.0035 + 0.9965 × 0.05) ≈ 6.56 %. Un modelo bien entrenado ahí
predice ≈ 6.56 % para ese tráfico: ≈ 19× lo real. La corrección lo devuelve a la escala real:
    q = p / (p + (1 − p) / w)        p = 0.0656, w = 0.05  →  q = 0.0656 / (0.0656 + 18.69) ≈ 0.0035
Es lo mismo que sumar ln(w) al logit (con w = 5 %, ln 0.05 ≈ −3.0): los odds se multiplican por w.
Sin la corrección, el pCTR entra ≈ 19× inflado al eCPM y al precio (ver auction.py): anuncios que no
valen la reserva la pasan, y cuando el precio sale de la reserva se divide por ese pCTR inflado (el
anunciante paga ≈ 19 veces menos). El orden por pCTR no cambia (la corrección es monótona); el orden por
bid × pCTR puede cambiar un poco, porque no es proporcional.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import hashlib  # sha256 del artefacto antes de cargarlo
import io  # el artefacto se valida en memoria antes de parsearlo
from collections.abc import Sequence  # tipos de entrada
from dataclasses import dataclass  # el modelo es un contenedor de arreglos con reglas
from pathlib import Path  # rutas del artefacto

import numpy as np  # pesos, logits, probabilidades

import features as F  # serving/features.py: la definición de índices (y la versión del esquema)


def sigmoid(z: np.ndarray) -> np.ndarray:
    """σ(z) sin overflow: 1 / (1 + e^−z) desborda para z muy negativo; exp(−logaddexp(0, −z)) no."""
    return np.exp(-np.logaddexp(0.0, -np.asarray(z, dtype=np.float64)))


def correct_downsampling(p: np.ndarray | float, w: float) -> np.ndarray:
    """q = p / (p + (1 − p) / w): de la escala submuestreada a la real. LA definición del caso.

    training/calibration.py la importa de aquí (una sola implementación para el serving, la evaluación y
    la recalibración). w = 1 no cambia nada (no hubo submuestreo).
    Trampa: corregir un modelo que YA se entrenó con peso 1/w en los negativos es corregir dos veces (el
    peso ya devolvió la escala real) y deja los pCTR ≈ w veces más bajos. Una de las dos, nunca ambas.
    """
    if not 0.0 < w <= 1.0:
        raise ValueError(f"neg_rate fuera de (0, 1]: {w}")
    p = np.asarray(p, dtype=np.float64)
    return p / (p + (1.0 - p) / w)


@dataclass
class HashedLogisticModel:
    weights: np.ndarray  # float32, shape (N_BUCKETS,): un peso por bucket
    bias: float  # el logit de "nada activo"
    neg_rate: float  # w del submuestreo de negativos con el que se entrenó
    version: str  # p. ej. "ctr-lr-2026-10-14": el que se loguea con cada impresión
    feature_set_version: str = F.FEATURE_SET_VERSION
    calib_x: np.ndarray | None = None  # umbrales de la isotónica sobre q (X_thresholds_ de sklearn)
    calib_y: np.ndarray | None = None  # valores calibrados en esos umbrales (y_thresholds_)

    def __post_init__(self) -> None:
        # Validar AL CARGAR: un artefacto incoherente tiene que impedir que el pod quede ready, no
        # producir pCTR raros durante una hora.
        if self.weights.shape != (F.N_BUCKETS,):
            raise ValueError(f"weights con forma {self.weights.shape}; se esperaba ({F.N_BUCKETS},)")
        if self.feature_set_version != F.FEATURE_SET_VERSION:
            raise ValueError(f"modelo entrenado con features {self.feature_set_version!r}; "
                             f"este serving usa {F.FEATURE_SET_VERSION!r}")
        if not 0.0 < self.neg_rate <= 1.0:
            raise ValueError(f"neg_rate fuera de (0, 1]: {self.neg_rate}")
        if (self.calib_x is None) != (self.calib_y is None):
            raise ValueError("calib_x y calib_y van juntos")
        if self.calib_x is not None:
            if len(self.calib_x) < 2 or np.any(np.diff(self.calib_x) <= 0) or np.any(np.diff(self.calib_y) < 0):
                raise ValueError("la calibración debe ser monótona con umbrales crecientes")
        self.weights = np.ascontiguousarray(self.weights, dtype=np.float32)

    # -------------------------------------------------------------------------- scoring
    def _sum_logits(self, rows: Sequence[np.ndarray]) -> np.ndarray:
        """bias + Σ peso[índice] por fila, vectorizado: concatenar las filas y sumar por tramos."""
        lengths = np.fromiter((len(r) for r in rows), dtype=np.int64, count=len(rows))
        if len(rows) == 0:
            return np.zeros(0)
        if np.any(lengths == 0):
            raise ValueError("fila sin features")  # reduceat con tramos vacíos devolvería basura, no 0
        flat = np.concatenate(rows)
        starts = np.concatenate(([0], np.cumsum(lengths)[:-1]))
        # Suma en float64: la misma en training (que entrena en float64) y en serving
        return self.bias + np.add.reduceat(self.weights[flat].astype(np.float64), starts)

    def position_term(self, slot: str, ad_format: str | None) -> float:
        """Lo que suma al logit mostrar este formato en este slot (pesos de los índices reservados)."""
        return float(self.weights[F.position_indices(slot, ad_format)].astype(np.float64).sum())

    def to_probability(self, logits: np.ndarray) -> np.ndarray:
        """logit del modelo (escala submuestreada) → pCTR final: σ, corrección por w, isotónica opcional."""
        q = correct_downsampling(sigmoid(logits), self.neg_rate)
        if self.calib_x is not None:
            # np.interp = lo que hace IsotonicRegression.predict con out_of_bounds="clip" (interpolación
            # lineal entre umbrales y extremos fijos; un test lo compara con sklearn)
            q = np.interp(q, self.calib_x, self.calib_y)
        return q

    def predict_slots(self, rows: Sequence[np.ndarray], formats: Sequence[str | None],
                      slots: Sequence[str]) -> np.ndarray:
        """pCTR de cada candidato en cada slot: matriz (candidatos × slots). Lo usa el ad-api.

        `rows` son índices SIN posición (features.encode_candidates). Un scoring por candidato y, por
        slot, el término de posición de su formato: exactamente el logit de la fila con ese slot (sin
        aproximaciones), al costo de un solo pase sobre los ≈ 150 candidatos.
        """
        if len(formats) != len(rows):
            raise ValueError("un formato por candidato")
        base = self._sum_logits(rows)
        # Términos de posición por (formato, slot): ≤ 4 formatos × 3 slots, no 150 × 3
        by_format = {f: [self.position_term(s, f) for s in slots] for f in set(formats)}
        terms = np.array([by_format[f] for f in formats], dtype=np.float64).reshape(len(rows), len(slots))
        return self.to_probability(base[:, None] + terms)

    def predict_rows(self, rows_with_position: Sequence[np.ndarray]) -> np.ndarray:
        """pCTR de filas que YA traen su posición (features.row_indices): evaluación offline y tests."""
        return self.to_probability(self._sum_logits(rows_with_position))

    # -------------------------------------------------------------------------- artefacto
    def save(self, path: str | Path) -> str:
        """npz comprimido (sin pickle) → devuelve el sha256 que se registra junto al modelo.

        Los pesos que el modelo nunca tocó quedan en 0, así que el archivo comprime mucho mejor que
        64 MiB. np.load con allow_pickle=False no ejecuta código al cargar: un pickle sí.
        """
        extra = {} if self.calib_x is None else {"calib_x": self.calib_x, "calib_y": self.calib_y}
        buf = io.BytesIO()
        np.savez_compressed(buf, weights=self.weights, bias=np.float64(self.bias),
                            neg_rate=np.float64(self.neg_rate), version=np.str_(self.version),
                            feature_set_version=np.str_(self.feature_set_version), **extra)
        blob = buf.getvalue()
        Path(path).write_bytes(blob)
        return hashlib.sha256(blob).hexdigest()

    @classmethod
    def load(cls, path: str | Path, expected_sha256: str) -> HashedLogisticModel:
        """Carga solo el artefacto que el registry dice: sha256 verificado ANTES de parsear."""
        blob = Path(path).read_bytes()
        digest = hashlib.sha256(blob).hexdigest()
        if digest != expected_sha256:
            raise ValueError(f"sha256 del modelo no coincide ({digest[:12]}…): no se carga")
        with np.load(io.BytesIO(blob), allow_pickle=False) as z:
            return cls(weights=z["weights"], bias=float(z["bias"]), neg_rate=float(z["neg_rate"]),
                       version=str(z["version"]), feature_set_version=str(z["feature_set_version"]),
                       calib_x=z["calib_x"] if "calib_x" in z else None,
                       calib_y=z["calib_y"] if "calib_y" in z else None)
