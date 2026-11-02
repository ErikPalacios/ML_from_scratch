"""Datos SINTÉTICOS para los tests y la demo (caso c09). No son datos de fraude reales ni se parecen en escala.

Sirven para tener un GBDT de verdad (con NaN, con features que importan) contra el cual probar el
servicio: latencia de una predicción en CPU, manejo de faltantes, umbrales. La tasa de fraude aquí es
≈ 1.4 % para que un modelo chico aprenda algo con 20,000 filas; en el caso es ≈ 0.08 % por
conteo, y con eso hacen falta millones de filas (o submuestrear negativos y corregir la calibración).
"""

from __future__ import annotations  # anotaciones como texto

import numpy as np  # generador reproducible
from sklearn.ensemble import HistGradientBoostingClassifier  # GBDT de sklearn: NaN nativo, CPU

import definitions as d  # el orden de columnas es FEATURE_ORDER, el mismo del servicio


def make_training_data(n: int = 20000, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """X con columnas en d.FEATURE_ORDER e y ∈ {0, 1}.

    Las features se generan primero y la etiqueta después, con una probabilidad que sube con la velocidad,
    el monto, el cruce de países y la tarjeta nueva. Así el problema NO es separable (como en la vida
    real) y el modelo da scores graduados en vez de 0 o 1.
    """
    rng = np.random.default_rng(seed)
    burst = rng.random(n) < 0.03  # ≈ 3 % de filas con actividad en ráfaga (card testing o gente apurada)
    cols: dict[str, np.ndarray] = {}
    amount = rng.lognormal(3.3, 0.9, n)  # US$; mediana ≈ 27
    cols["amount_usd_log"] = np.log1p(amount)
    cols["is_cross_border"] = (rng.random(n) < 0.1).astype(float)
    cols["card_count_60s"] = rng.poisson(np.where(burst, 3.0, 0.1))
    cols["card_amount_1h"] = rng.poisson(np.where(burst, 4.0, 0.5)) * np.round(amount * 100)
    cols["card_distinct_merchants_1h"] = rng.poisson(np.where(burst, 2.0, 0.3))
    cols["device_distinct_cards_1h"] = rng.poisson(np.where(burst, 1.5, 0.05))
    cols["ip_count_60s"] = rng.poisson(np.where(burst, 3.0, 0.4))
    cols["card_count_24h"] = rng.poisson(1.5, n) + cols["card_count_60s"]
    cols["card_distinct_countries_7d"] = rng.poisson(0.2, n)
    cols["email_distinct_cards_7d"] = rng.poisson(0.3, n)
    cols["ip_distinct_cards_24h"] = rng.poisson(0.5, n)
    cols["merchant_count_1h"] = rng.poisson(800, n).astype(float)  # no informativa: ruido realista
    cols["card_age_days"] = rng.exponential(250, n)
    cols["email_age_days"] = rng.exponential(500, n)
    cols["merchant_chargeback_bps_90d"] = rng.gamma(2.0, 5.0, n)
    cols["device_linked_accounts_30d"] = rng.poisson(1.0, n)
    logit = (-5.6 + 0.45 * cols["amount_usd_log"] + 1.2 * cols["is_cross_border"]
             + 0.6 * cols["card_count_60s"] + 0.9 * cols["device_distinct_cards_1h"]
             + 0.5 * cols["card_distinct_countries_7d"] + 0.3 * cols["email_distinct_cards_7d"]
             - 0.35 * np.log1p(cols["card_age_days"]) + 0.03 * cols["merchant_chargeback_bps_90d"]
             + 0.8 * (cols["card_age_days"] < 3))
    y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
    X = np.column_stack([cols[name].astype(float) for name in d.FEATURE_ORDER])
    # Faltantes como en producción: sin SDK de dispositivo (≈ 10 %), sin país de IP (≈ 5 %), tarjeta o
    # email nuevos sin snapshot batch (≈ 8 %). El modelo aprende qué hacer con NaN en esos grupos.
    for name, rate in (("device_distinct_cards_1h", 0.10), ("device_linked_accounts_30d", 0.10),
                       ("is_cross_border", 0.05), ("card_age_days", 0.08), ("email_age_days", 0.08)):
        X[rng.random(n) < rate, d.FEATURE_ORDER.index(name)] = np.nan
    return X, y


def train_model(X: np.ndarray, y: np.ndarray, seed: int = 0) -> HistGradientBoostingClassifier:
    """Un GBDT chico (60 árboles de ≤ 15 hojas). En producción: LightGBM/XGBoost con ≈ 300 features."""
    model = HistGradientBoostingClassifier(max_iter=60, max_leaf_nodes=15, learning_rate=0.1, random_state=seed)
    return model.fit(X, y)
