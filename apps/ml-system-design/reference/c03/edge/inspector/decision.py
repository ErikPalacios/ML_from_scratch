"""Lógica de decisión PURA del inspector de línea (caso c03).

Por qué va en un archivo aparte: esta función decide si una pieza de un cliente automotriz se envía
o no. Aquí no hay cámara, GPU, PLC, reloj ni red: entra un dict de scores, sale PASS o REJECT con
sus razones. Así se prueba exhaustivamente (tests/test_inspector.py) y se revisa en un code review
sin distraerse con la integración. El fail-safe por tiempo o por fallas (DIVERT) vive en app.py.

Contrato con el Engine (app.py):
    {"anomaly_score": 0.41, "defects": {"crack": 0.02, "burr": 0.10, ...}}
Todos los scores están normalizados a [0, 1]; la normalización la hace el wrapper del modelo.
Regla: una pieza se rechaza si CUALQUIER score es >= su umbral. El ">=" es el mismo que usa
tools/choose_threshold.py para medir recall: si uno usara ">" y el otro ">=", el umbral elegido
en validación no sería exactamente el que corre en la línea.
"""

from __future__ import annotations  # anotaciones como texto: `dict[str, float]` sin costo en runtime

import math  # isfinite: NaN e infinito no son scores válidos
from dataclasses import dataclass, field  # objetos inmutables y comparables en los tests
from typing import Mapping  # los umbrales y scores llegan como dicts leídos de YAML o del Engine

PASS = "PASS"  # la pieza sigue a la línea
REJECT = "REJECT"  # el modelo vio un defecto: la pieza va al contenedor de inspección manual


class InvalidScores(ValueError):
    """El Engine devolvió algo que no se puede evaluar. app.py lo convierte en DIVERT, nunca en PASS."""


@dataclass(frozen=True)
class Thresholds:
    """Umbrales de la línea. Salen de tools/choose_threshold.py, no de la intuición de nadie."""

    anomaly: float  # umbral del modelo de anomalías (entrenado solo con piezas buenas)
    # Un umbral por tipo de defecto del clasificador supervisado. Vacío al arrancar el proyecto,
    # cuando todavía no hay suficientes defectos etiquetados para entrenarlo.
    defects: Mapping[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Validar al cargar la config: un umbral de 0 rechaza todo y uno > 1 no rechaza nada.
        # Ambos son errores de dedo que no deben llegar a la línea.
        for name, value in [("anomaly", self.anomaly), *self.defects.items()]:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"umbral '{name}' debe ser un número, llegó {value!r}")
            if not 0.0 < float(value) <= 1.0:
                raise ValueError(f"umbral '{name}' fuera de (0, 1]: {value}")

    @classmethod
    def from_config(cls, cfg: Mapping) -> "Thresholds":
        """Construye los umbrales desde la sección `thresholds` de config.yaml."""
        defects = dict(cfg.get("defects") or {})  # `defects: {}` o ausente = solo anomalías
        return cls(anomaly=cfg["anomaly"], defects=defects)


@dataclass(frozen=True)
class Decision:
    """Resultado del modelo para una pieza: la decisión y POR QUÉ (va al log y al operador)."""

    decision: str  # PASS | REJECT
    reasons: tuple[str, ...] = ()  # p. ej. ("anomaly", "defect:crack"); vacío si PASS

    @property
    def reason(self) -> str:
        """Texto corto para el log JSON: 'ok' o las razones unidas con '+'."""
        return "+".join(self.reasons) if self.reasons else "ok"


def _check_score(name: str, value: object) -> float:
    """Un score válido es un número finito en [0, 1]. Todo lo demás es InvalidScores."""
    # bool es subclase de int en Python: True pasaría como 1.0 sin este chequeo explícito
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidScores(f"score '{name}' no es numérico: {value!r}")
    score = float(value)
    # LA trampa: NaN >= umbral es False, así que un NaN (p. ej. overflow en FP16) haría PASS.
    # Un fail-safe también se diseña en la lógica pura, no solo en los timeouts.
    if not math.isfinite(score):
        raise InvalidScores(f"score '{name}' no es finito: {score}")
    if not 0.0 <= score <= 1.0:  # fuera de rango = el wrapper de normalización está roto
        raise InvalidScores(f"score '{name}' fuera de [0, 1]: {score}")
    return score


def decide(scores: Mapping, thresholds: Thresholds) -> Decision:
    """PASS solo si TODOS los scores están por debajo de su umbral. Lanza InvalidScores si faltan datos."""
    if not isinstance(scores, Mapping):
        raise InvalidScores(f"el Engine devolvió {type(scores).__name__}, se esperaba un dict")
    reasons: list[str] = []
    anomaly = _check_score("anomaly_score", scores.get("anomaly_score"))
    if anomaly >= thresholds.anomaly:  # >= : mismo criterio que tools/choose_threshold.py
        reasons.append("anomaly")
    defect_scores = scores.get("defects") or {}
    # Se evalúan los tipos que la CONFIG declara. Si el modelo no trae uno, no se asume 0 (eso
    # sería un PASS silencioso): es un error. Los tipos extra que traiga el modelo se ignoran;
    # la anomalía los sigue cubriendo mientras no tengan umbral.
    for defect_type in sorted(thresholds.defects):  # orden fijo: el log sale igual cada vez
        if defect_type not in defect_scores:
            raise InvalidScores(f"falta el score del defecto '{defect_type}'")
        score = _check_score(defect_type, defect_scores[defect_type])
        if score >= thresholds.defects[defect_type]:
            reasons.append(f"defect:{defect_type}")
    return Decision(REJECT, tuple(reasons)) if reasons else Decision(PASS)
