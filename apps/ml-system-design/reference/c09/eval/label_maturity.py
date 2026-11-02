"""Madurez de las etiquetas (caso c09): cuándo llegan los chargebacks y qué cohortes ya se pueden evaluar.

El problema: un chargeback llega días o meses después del pago. Las redes dan al tarjetahabiente
≈ 120 días desde el procesamiento para disputar los motivos de fraude más comunes (p. ej., Visa 10.4 o
Mastercard 4837; hay excepciones y los plazos los fija cada red: verifícalos con tu adquirente). Si
evalúas el modelo de la semana pasada con los chargebacks que llegaron hasta hoy, ves una fracción del
fraude y concluyes que el modelo es mejor de lo que es.

Este archivo mide la curva de llegada con TUS datos (el caso supone ≈ 60 % a 30 días y ≈ 90 % a 60 días;
es una estimación) y responde tres preguntas:
  1. `arrival_curve`: de los chargebacks que un pago eventualmente recibe, ¿qué fracción llegó al día N?
     Solo con cohortes COMPLETAS (más viejas que el horizonte): si metes cohortes jóvenes, solo aportan
     los chargebacks rápidos y la curva sale demasiado optimista.
  2. `cohorts`: a la fecha de hoy, ¿qué cohortes semanales ya llegaron a la madurez objetivo (90 %)?
     Las demás no se usan para evaluar el modelo ni para fijar umbrales.
  3. `completed_rate`: para monitorear antes (ChargebackRateRising), la tasa observada de una cohorte
     joven ÷ la fracción que ya debería haber llegado = la tasa final esperada. Ej.: 7.2 bps a los 30
     días con F(30) = 0.6 → ≈ 12 bps. Es la idea del "chain ladder" de los actuarios.
"""

from __future__ import annotations  # anotaciones como texto

import numpy as np  # cuantiles y búsquedas
import pandas as pd  # tabla de pagos y cohortes

DAY_S = 86400


def arrival_curve(df: pd.DataFrame, as_of: float, horizon_days: int = 120) -> pd.DataFrame:
    """Fracción acumulada de chargebacks llegados por día desde el pago, con cohortes completas.

    `df`: columnas `tx_time` y `cb_time` (epoch s; NaN si el pago no tuvo chargeback). Devuelve
    `day` (0..horizon) y `fraction`. Un chargeback que llega DESPUÉS del horizonte cuenta en el
    denominador y nunca en el numerador: la curva puede no llegar a 1.0, y eso es información.
    """
    complete = df[df["tx_time"] + horizon_days * DAY_S <= as_of]  # cohortes que ya vieron todo el plazo
    delays = ((complete["cb_time"] - complete["tx_time"]) / DAY_S).dropna().to_numpy()
    if len(delays) == 0:
        raise ValueError("no hay chargebacks en cohortes completas: hace falta más historia")
    days = np.arange(horizon_days + 1)
    # searchsorted sobre los retrasos ordenados: cuántos llegaron a más tardar el día d
    fraction = np.searchsorted(np.sort(delays), days, side="right") / len(delays)
    return pd.DataFrame({"day": days, "fraction": fraction})


def fraction_by(curve: pd.DataFrame, age_days: float) -> float:
    """F(edad): fracción esperada ya llegada para un pago de `age_days` días."""
    if age_days < 0:
        return 0.0
    idx = min(int(np.floor(age_days)), int(curve["day"].max()))
    return float(curve["fraction"].iloc[idx])


def maturity_day(curve: pd.DataFrame, target: float = 0.9) -> int:
    """Primer día en el que llegó al menos `target` de los chargebacks (el caso: ≈ 60 días para 90 %)."""
    hit = curve.loc[curve["fraction"] >= target, "day"]
    if hit.empty:
        raise ValueError(f"la curva nunca llega a {target:.0%} dentro del horizonte")
    return int(hit.iloc[0])


def cohorts(df: pd.DataFrame, as_of: float, curve: pd.DataFrame, target: float = 0.9) -> pd.DataFrame:
    """Una fila por cohorte semanal: edad, F(edad), si es evaluable y la tasa de chargebacks por valor.

    Una cohorte es evaluable si su pago MÁS JOVEN ya alcanzó `target`: así ninguna parte de la cohorte
    se evalúa con etiquetas a medio llegar.
    """
    out = df.copy()
    out["week"] = (out["tx_time"] // (7 * DAY_S)).astype(int)
    has_cb = out["cb_time"].notna() & (out["cb_time"] <= as_of)  # lo que se sabe HOY
    out["cb_cents"] = np.where(has_cb, out.get("amount_cents", 1), 0)
    out["value_cents"] = out.get("amount_cents", 1)
    g = out.groupby("week").agg(tx_min=("tx_time", "min"), tx_max=("tx_time", "max"), n=("tx_time", "size"),
                                cb_cents=("cb_cents", "sum"), value_cents=("value_cents", "sum")).reset_index()
    g["age_days_youngest"] = (as_of - g["tx_max"]) / DAY_S
    g["expected_arrived"] = [fraction_by(curve, a) for a in g["age_days_youngest"]]
    g["evaluable"] = g["expected_arrived"] >= target
    g["observed_bps"] = 1e4 * g["cb_cents"] / g["value_cents"]
    return g[["week", "n", "age_days_youngest", "expected_arrived", "evaluable", "observed_bps"]]


def completed_rate(observed_bps: float, age_days: float, curve: pd.DataFrame, min_fraction: float = 0.3) -> float:
    """Tasa final esperada de una cohorte joven: observada ÷ F(edad).

    Con F muy chico (una cohorte de 3 días) la división amplifica el ruido: por debajo de `min_fraction`
    no se estima (NaN). Supone que la curva de llegada no cambió; si el fraude cambia de tipo (más
    "friendly fraud", que se disputa más tarde), la curva también cambia: re-mídela cada mes.
    """
    f = fraction_by(curve, age_days)
    return float("nan") if f < min_fraction else observed_bps / f
