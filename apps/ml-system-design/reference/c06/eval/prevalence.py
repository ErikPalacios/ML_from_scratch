"""Métricas de moderación con intervalos de confianza (caso c06): prevalencia, precision y recall.

Por qué estas y no "accuracy del modelo":
- PREVALENCIA = fracción de las VISTAS que fueron de contenido violatorio. Mide lo que la gente vio,
  que es el daño. Se estima con una muestra aleatoria de vistas etiquetada por PERSONAS, nunca con el
  modelo (el modelo no puede medir lo que no detecta). Así la describen los reportes de transparencia
  públicos (p. ej. el de Meta: muestreo de vistas, estratificado cuando conviene, intervalo de 95 %, y
  solo una cota superior cuando la violación es tan rara que la muestra no alcanza).
- PRECISION por política = de lo que accionamos, cuánto violaba. Muestra aleatoria de lo ACCIONADO,
  etiquetada por personas. Las apelaciones NO sirven: solo apela quien cree tener razón (sesgo).
- RECALL por política = de lo que violaba, cuánto accionamos. Sale de la muestra aleatoria (la única
  que ve lo que se nos escapó). Con prevalencia ≈ 0.5 %, 10,000 vistas muestreadas traen ≈ 50
  violatorias en total: por política son pocas, y el intervalo es ancho. Dilo así en la entrevista.

Vistas, no ítems: un post visto 1 M de veces pesa 1 M de veces más que uno que nadie vio. Si la muestra
es de ÍTEMS, pondera por vistas (`view_weighted_rate`); si es de VISTAS, el peso ya viene incluido.

Las etiquetas llevan la versión de la definición de la política: no mezcles muestras de dos versiones.
Solo numpy (para el bootstrap) y la biblioteca estándar.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import math  # sqrt
from collections.abc import Iterable, Mapping, Sequence  # tipos de entrada
from dataclasses import dataclass  # resultados legibles
from statistics import NormalDist  # cuantiles de la normal sin scipy

import numpy as np  # bootstrap estratificado


@dataclass(frozen=True)
class Estimate:
    value: float  # estimación puntual
    low: float  # límite inferior del intervalo (0 si solo hay cota superior)
    high: float  # límite superior
    n: int  # tamaño de muestra (vistas o ítems etiquetados)
    k: int  # positivos en la muestra
    method: str  # wilson · upper_bound · stratified_normal · stratified_bootstrap
    upper_bound_only: bool = False  # True = "menos de X %", sin estimación puntual confiable


def _z(conf: float) -> float:
    """z bilateral: 0.95 → 1.96."""
    return NormalDist().inv_cdf(0.5 + conf / 2)


def wilson_interval(k: int, n: int, conf: float = 0.95) -> tuple[float, float]:
    """Intervalo de Wilson para una proporción k/n.

    Por qué Wilson y no p ± z·√(p(1−p)/n) (Wald): con proporciones chicas, Wald da límites negativos o un
    intervalo de ancho 0 cuando k = 0. Ejemplo: k = 3, n = 1,000 → Wald [−0.04 %, 0.64 %], Wilson
    [0.10 %, 0.88 %].
    """
    if n <= 0:
        raise ValueError("n debe ser > 0")
    if not 0 <= k <= n:
        raise ValueError("k debe estar en [0, n]")
    return wilson_interval_float(k, n, conf)


def wilson_interval_float(k: float, n: float, conf: float = 0.95) -> tuple[float, float]:
    """Wilson con k y n no enteros (tamaños efectivos de una muestra ponderada)."""
    if n <= 0 or not 0 <= k <= n:
        raise ValueError("se necesita 0 ≤ k ≤ n y n > 0")
    z = _z(conf)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - half), min(1.0, center + half)


def upper_bound_zero(n: int, conf: float = 0.95) -> float:
    """Cota superior exacta (unilateral) cuando hay 0 positivos en n: 1 − (1 − conf)^(1/n).

    ≈ 3/n para 95 % ("regla de tres"): 0 violatorias en 3,000 vistas → prevalencia < 0.1 % (95 %).
    """
    if n <= 0:
        raise ValueError("n debe ser > 0")
    return 1.0 - (1.0 - conf) ** (1.0 / n)


def proportion(labels: Iterable[bool], conf: float = 0.95, method: str = "wilson") -> Estimate:
    """Proporción de una muestra aleatoria simple. Con 0 positivos, solo cota superior."""
    labels = list(labels)
    n, k = len(labels), sum(bool(x) for x in labels)
    if n == 0:
        raise ValueError("muestra vacía")
    if k == 0:
        return Estimate(0.0, 0.0, upper_bound_zero(n, conf), n, 0, "upper_bound", upper_bound_only=True)
    lo, hi = wilson_interval(k, n, conf)
    return Estimate(k / n, lo, hi, n, k, method)


def prevalence_srs(view_labels: Iterable[bool], conf: float = 0.95) -> Estimate:
    """Prevalencia desde una muestra aleatoria SIMPLE de vistas (cada etiqueta = una vista)."""
    return proportion(view_labels, conf)


def sample_size_for(p: float, half_width: float, conf: float = 0.95) -> int:
    """Vistas a etiquetar para estimar una prevalencia ≈ p con ± half_width (aprox. normal).

    Ejemplo: p = 0.5 %, ± 0.05 puntos → 1.96² × 0.005 × 0.995 / 0.0005² ≈ 76,450 vistas. A 60 ítems/h
    por persona, ≈ 1,274 horas de revisión: la medición tiene costo y compite con la revisión normal.
    """
    z = _z(conf)
    return math.ceil(z * z * p * (1 - p) / (half_width * half_width))


# ---------------------------------------------------------------------------- estratificado
@dataclass(frozen=True)
class Stratum:
    """Un estrato de vistas: p. ej. 'score de etapa 1 ≥ 0.3' vs 'score < 0.3'."""

    views_total: float  # vistas del período en este estrato (de los logs: se conocen, no se estiman)
    sampled: int  # vistas muestreadas y etiquetadas en este estrato
    violating: int  # de ellas, violatorias


def stratified_prevalence(strata: Mapping[str, Stratum], conf: float = 0.95) -> Estimate:
    """Estimador estratificado: Σ W_h · p_h, con W_h = vistas del estrato / vistas totales.

    Por qué estratificar: si muestreas MÁS en el estrato donde el modelo sospecha (score alto), ves
    muchos más positivos por la misma cantidad de etiquetas y el intervalo se angosta. El peso W_h
    corrige el sobremuestreo: el estimador sigue siendo insesgado. Varianza: Σ W_h² · p_h(1 − p_h)/n_h.
    Aproximación normal: con muy pocos positivos por estrato, prefiere `stratified_bootstrap` o
    reporta una cota superior.
    """
    total = sum(s.views_total for s in strata.values())
    if total <= 0:
        raise ValueError("sin vistas")
    p, var, n, k = 0.0, 0.0, 0, 0
    for name, s in strata.items():
        if s.sampled <= 0:
            raise ValueError(f"estrato '{name}' sin muestra: no se puede estimar (y no se puede ignorar)")
        w = s.views_total / total
        ph = s.violating / s.sampled
        p += w * ph
        var += w * w * ph * (1 - ph) / s.sampled
        n += s.sampled
        k += s.violating
    if k == 0:
        # Ningún positivo en ningún estrato: cota superior Σ W_h · cota_h. Conservadora: supone que
        # todos los estratos están a la vez en su peor caso.
        ub = sum((s.views_total / total) * upper_bound_zero(s.sampled, conf) for s in strata.values())
        return Estimate(0.0, 0.0, ub, n, 0, "upper_bound", upper_bound_only=True)
    half = _z(conf) * math.sqrt(var)
    return Estimate(p, max(0.0, p - half), min(1.0, p + half), n, k, "stratified_normal")


def stratified_bootstrap(
    strata: Mapping[str, Stratum], conf: float = 0.95, b: int = 4000, seed: int = 0
) -> Estimate:
    """Mismo estimador, intervalo por bootstrap paramétrico (remuestreo binomial por estrato).

    Útil cuando la normal no aplica (pocos positivos). Límite: un estrato con 0 positivos se remuestrea
    siempre en 0 y el bootstrap no ve su incertidumbre; para eso, la cota superior.
    """
    rng = np.random.default_rng(seed)
    total = sum(s.views_total for s in strata.values())
    w = np.array([s.views_total / total for s in strata.values()])
    n_h = np.array([s.sampled for s in strata.values()])
    p_h = np.array([s.violating / s.sampled for s in strata.values()])
    draws = rng.binomial(n_h[None, :], p_h[None, :], size=(b, len(n_h))) / n_h[None, :]  # [b, estratos]
    est = draws @ w
    alpha = 1 - conf
    lo, hi = np.quantile(est, [alpha / 2, 1 - alpha / 2])
    k = int(sum(s.violating for s in strata.values()))
    return Estimate(float(p_h @ w), float(lo), float(hi), int(n_h.sum()), k, "stratified_bootstrap")


def view_weighted_rate(items: Sequence[tuple[float, bool]]) -> float:
    """Desde una muestra de ÍTEMS (vistas, ¿viola?): fracción de VISTAS violatorias.

    Ejemplo: 1,000 ítems, 5 violatorios (0.5 % de los ítems), pero esos 5 tuvieron 20,000 vistas de un
    total de 400,000 → 5 % de las vistas. La métrica de daño es la segunda.
    """
    total = sum(v for v, _ in items)
    return sum(v for v, bad in items if bad) / total if total else 0.0


# ---------------------------------------------------------------------------- precision / recall
def precision(actioned_labels: Iterable[bool], conf: float = 0.95) -> Estimate:
    """Precision de UNA política: muestra aleatoria de lo accionado, ¿la persona confirma que violaba?"""
    return proportion(actioned_labels, conf)


def recall_from_random_sample(records: Iterable[Mapping], policy: str, conf: float = 0.95) -> Estimate:
    """Recall de una política desde la muestra aleatoria de vistas.

    Cada registro: {"label": política violada o None (persona), "actioned": políticas que el sistema
    accionó para ese ítem (dentro de la ventana que definas, p. ej. 24 h), "weight": opcional}.
    recall = vistas violatorias de `policy` cuyo ítem accionamos / vistas violatorias de `policy`.

    Muestra estratificada: cada registro lleva `weight` = vistas del estrato / vistas muestreadas del
    estrato (cuántas vistas reales representa). Sin eso, el estrato de score alto, sobremuestreado y
    casi todo accionado, inflaría el recall. El intervalo usa Wilson con el tamaño efectivo de Kish,
    n_ef = (Σw)² / Σw²: una aproximación (con pesos muy desiguales, n_ef cae y el intervalo se abre,
    que es lo correcto).
    """
    pos = [(float(r.get("weight", 1.0)), policy in (r.get("actioned") or ()))
           for r in records if r.get("label") == policy]
    if not pos:
        raise ValueError(f"la muestra no tiene vistas violatorias de '{policy}': agranda o estratifica la muestra")
    w_total = sum(w for w, _ in pos)
    value = sum(w for w, hit in pos if hit) / w_total
    n_eff = w_total * w_total / sum(w * w for w, _ in pos)
    k_eff = value * n_eff
    lo, hi = wilson_interval_float(k_eff, n_eff, conf)
    method = "wilson" if all(w == pos[0][0] for w, _ in pos) else "wilson_kish"
    return Estimate(value, lo, hi, len(pos), sum(hit for _, hit in pos), method)


def cohens_kappa(a: Sequence[str], b: Sequence[str]) -> float:
    """Acuerdo entre dos personas que etiquetaron los MISMOS ítems, corregido por azar.

    Por qué no el % de acuerdo: con 99 % de ítems limpios, dos personas que dicen siempre "limpio"
    coinciden 99 % sin aportar nada; kappa da ≈ 0 en ese caso.
    """
    if len(a) != len(b) or not a:
        raise ValueError("listas del mismo largo, no vacías")
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n  # acuerdo observado
    cats = set(a) | set(b)
    pe = sum((a.count(c) / n) * (b.count(c) / n) for c in cats)  # acuerdo esperado por azar
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)
