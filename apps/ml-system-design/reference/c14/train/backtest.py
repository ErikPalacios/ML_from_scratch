"""Backtest por origen móvil (rolling origin), métricas por segmento y el gate de promoción (caso c14).

Las métricas, con un ejemplo antes de la fórmula. Tres días de una serie, pronóstico F y venta real A:
F = [10, 0, 5], A = [8, 2, 5] → errores |F − A| = [2, 2, 0].
- WAPE = Σ|F − A| ÷ ΣA = 4 ÷ 15 ≈ 0.267. Pesa por volumen: un error de 2 piezas en un producto que vende
  2 al día cuenta igual que en uno que vende 200 (a diferencia del MAPE, que explota con ventas cercanas
  a 0, y el 60 % de las series vende < 1 al día).
- bias = (ΣF − ΣA) ÷ ΣA = (15 − 15) ÷ 15 = 0. El WAPE no dice hacia dónde te equivocas; el sesgo sí:
  negativo = pides de menos (agotados), positivo = pides de más (merma en frescos).
- pinball de un cuantil q: por fila, q·(A − F) si te quedaste corto, (1 − q)·(F − A) si te pasaste. Con
  q = 0.9 quedarse corto cuesta 9 veces más que pasarse: por eso el P90 queda arriba.
  Con F = P90 = [10, 0, 5]: [0.1·2, 0.9·2, 0] → promedio 2.0 ÷ 3 ≈ 0.667.
- cobertura del P90 = fracción de días con A ≤ P90. Meta ≈ 90 %: 97 % quiere decir inventario de más.
Todas se calculan SOLO en días evaluables: target conocido y sin agotado (la venta de un día agotado es
una cota inferior: contra ella, el modelo que pronostica bien la demanda "se ve" sobreestimado).

El backtest repite lo que haría producción en cada origen O (los últimos 8 orígenes, uno por semana):
entrenar con todo lo que se sabía en O (filas con target_date ≤ O: también las de orígenes recientes con
horizonte corto) y pronosticar O + 1 … O + 14. Trampa: entrenar con filas de los últimos 14 orígenes sin
filtrar por target_date mete al entrenamiento ventas posteriores a O. `run_backtest` acepta `fit_fn` y un
test pasa uno espía que verifica que nunca ve un target_date > O.

El gate (`promotion_gate`) es el del caso: el candidato le gana al campeón en WAPE total sobre los 8
orígenes y no empeora ningún segmento grande más de 2 puntos de WAPE (0.02).
"""

from __future__ import annotations  # anotaciones como texto

import numpy as np  # métricas vectorizadas
import pandas as pd  # tablas de predicciones

import build_features as bf  # panel, features y targets (la misma definición que el job nocturno)
from train_quantile import fit as default_fit, seasonal_naive  # modelo y línea base

# Segmentos del caso: fresco/seco, rápido/lento, promo/sin promo, nuevos. Una fila cae en varios.
# "Rápido" = ≥ 1 unidad/día de promedio en los 28 días ANTES del origen (no después: sería leakage).
SEGMENTS = {
    "all": lambda d: np.ones(len(d), dtype=bool),
    "fresh": lambda d: d["perishable"].to_numpy() == 1,
    "dry": lambda d: d["perishable"].to_numpy() == 0,
    "fast": lambda d: d["roll_mean_28"].fillna(0).to_numpy() >= 1.0,
    "slow": lambda d: d["roll_mean_28"].fillna(0).to_numpy() < 1.0,
    "promo": lambda d: d["promo_flag"].to_numpy() == 1,
    "no_promo": lambda d: d["promo_flag"].to_numpy() == 0,
    "new_item": lambda d: d["new_item"].to_numpy().astype(bool),
}
MAJOR_SEGMENTS = ("fresh", "dry", "fast", "slow", "promo", "no_promo")  # los que el gate protege


# --------------------------------------------------------------------------------------- métricas
def wape(f, a) -> float:
    a, f = np.asarray(a, float), np.asarray(f, float)
    return float(np.abs(f - a).sum() / a.sum()) if a.sum() > 0 else float("nan")


def bias(f, a) -> float:
    a, f = np.asarray(a, float), np.asarray(f, float)
    return float((f.sum() - a.sum()) / a.sum()) if a.sum() > 0 else float("nan")


def pinball(q: float, f, a) -> float:
    """Pérdida pinball promedio por fila para el cuantil q (la que minimiza el modelo de ese cuantil)."""
    diff = np.asarray(a, float) - np.asarray(f, float)
    return float(np.mean(np.maximum(q * diff, (q - 1) * diff))) if len(diff) else float("nan")


def coverage(p90, a) -> float:
    a = np.asarray(a, float)
    return float(np.mean(a <= np.asarray(p90, float))) if len(a) else float("nan")


def evaluable(df: pd.DataFrame) -> np.ndarray:
    """Días que cuentan: target conocido (no agotado, serie listada, tienda que reportó)."""
    ok = df["target"].notna().to_numpy().copy()  # pandas 3 (copy-on-write) devuelve vistas de solo lectura
    if "target_oos" in df:
        ok &= ~df["target_oos"].to_numpy(dtype=bool)  # redundante con target NaN; explícito a propósito
    return ok


def metrics(df: pd.DataFrame, pred: str = "model") -> dict:
    """WAPE, sesgo, pinball 50/90 y cobertura del P90 de las columnas `{pred}_p50` y `{pred}_p90`."""
    d = df[evaluable(df)]
    a = d["target"].to_numpy(float)
    p50, p90 = d[f"{pred}_p50"].to_numpy(float), d[f"{pred}_p90"].to_numpy(float)
    return {
        "n": int(len(d)),
        "wape": wape(p50, a),
        "bias": bias(p50, a),
        "pinball_50": pinball(0.5, p50, a),
        "pinball_90": pinball(0.9, p90, a),
        "coverage_90": coverage(p90, a),
    }


def metrics_by_segment(df: pd.DataFrame, pred: str = "model", segments=SEGMENTS) -> pd.DataFrame:
    """Una fila por segmento (los segmentos se traslapan: una fila es fresca Y de promo)."""
    rows = []
    for name, sel in segments.items():
        part = df[sel(df)]
        rows.append({"segment": name, **metrics(part, pred)})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------------- origen móvil
def rolling_origins(last_origin, n: int = 8, step_days: int = 7) -> list[pd.Timestamp]:
    """Los n orígenes, uno cada `step_days`, terminando en `last_origin` (el más viejo primero)."""
    last = pd.Timestamp(last_origin).normalize()
    return [last - pd.Timedelta(days=step_days * k) for k in range(n - 1, -1, -1)]


def run_backtest(data, n_origins: int = 8, last_origin=None, train_step_days: int = 7,
                 train_window_days: int = 364, params: dict | None = None, mask_oos: bool = True,
                 fit_fn=default_fit) -> pd.DataFrame:
    """Backtest de `data` (tablas con los esquemas de build_features, p. ej. synthetic.make_synthetic).

    Devuelve las filas de los n orígenes con `model_p50/p90`, `naive_p50/p90`, `target` y las columnas
    de segmento. Para no recalcular features, arma UNA vez las filas de todos los orígenes de
    entrenamiento: las de un origen o solo dependen de datos ≤ o (regla 1 de build_features), así que
    precalcularlas no filtra nada; lo que sí filtra es el target, y por eso el corte target_date ≤ O.
    """
    start, end = data.sales["date"].min(), data.stock["date"].max()
    panel = bf.build_panel(data.sales, data.stock, data.series, start, end)
    last = pd.Timestamp(last_origin) if last_origin is not None else end - pd.Timedelta(days=14)
    origins = rolling_origins(last, n_origins)
    first_train = start + pd.Timedelta(days=28)  # un mínimo de historia para los lags
    train_origins = list(pd.date_range(first_train, last - pd.Timedelta(days=1), freq=f"{train_step_days}D"))
    pool = bf.training_frame(panel, train_origins, data.calendar, data.promo, data.store_attrs,
                             data.sku_attrs, data.sales, data.stock, mask_oos=mask_oos)
    out = []
    for o in origins:
        known = pool[(pool["run_date"] < o) & (pool["target_date"] <= o)]  # lo que se sabía en O
        known = known[known["run_date"] >= o - pd.Timedelta(days=train_window_days)]  # ventana de 52 semanas
        model = fit_fn(known, params)
        test = bf.training_frame(panel, [o], data.calendar, data.promo, data.store_attrs, data.sku_attrs,
                                 data.sales, data.stock, mask_oos=True)  # se evalúa SIEMPRE sin censura
        pred = model.predict(test)
        naive = seasonal_naive(test)
        test = test.assign(model_p50=pred["p50"].to_numpy(), model_p90=pred["p90"].to_numpy(),
                           naive_p50=naive["p50"].to_numpy(), naive_p90=naive["p90"].to_numpy(),
                           origin=o, model_version=getattr(model, "version", "?"))
        out.append(test)
    return pd.concat(out, ignore_index=True)


# ------------------------------------------------------------------------------------------- gate
def promotion_gate(candidate: pd.DataFrame, champion: pd.DataFrame, max_worsening: float = 0.02,
                   segments=MAJOR_SEGMENTS, min_rows: int = 200) -> tuple[bool, list[str], list[str]]:
    """¿Reemplaza el candidato al campeón? Recibe dos salidas de `metrics_by_segment` (mismos orígenes).

    1. WAPE total menor que el del campeón (si no, ¿para qué cambiar?).
    2. Ningún segmento grande empeora más de `max_worsening` (2 puntos de WAPE): un modelo que mejora el
       total a costa de los frescos sube la merma, y el total no lo enseña.
    Devuelve (pasa, razones que bloquean, segmentos que no votaron). Un segmento con menos de `min_rows`
    filas evaluables no vota (su WAPE es ruido), pero se reporta: un "pasa" sin frescos no es un "pasa".
    """
    c, ch = candidate.set_index("segment"), champion.set_index("segment")
    reasons, skipped = [], []
    if not c.loc["all", "wape"] < ch.loc["all", "wape"]:
        reasons.append(f"all: WAPE {c.loc['all', 'wape']:.3f} no mejora a {ch.loc['all', 'wape']:.3f}")
    for s in segments:
        if s not in c.index or s not in ch.index or c.loc[s, "n"] < min_rows:
            skipped.append(s)
            continue
        delta = c.loc[s, "wape"] - ch.loc[s, "wape"]
        if delta > max_worsening:
            reasons.append(f"{s}: WAPE empeora {delta * 100:.1f} puntos (máx. {max_worsening * 100:.0f})")
    return (not reasons), reasons, skipped
