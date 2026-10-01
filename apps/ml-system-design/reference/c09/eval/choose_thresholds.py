"""Umbrales por costo esperado (caso c09): qué par (step-up, decline) minimiza el costo por 1,000 pagos.

Por qué no "el umbral que maximiza F1": en fraude los errores no cuestan lo mismo. Ejemplo con los
costos del caso (estimaciones; los fija el negocio):

  aprobar un fraude de US$250           → chargeback US$250 + fee US$15            = US$265
  declinar un pago bueno                 → comisión perdida + parte del cliente     ≈ US$7.5
  step-up a un pago bueno                → 15 % abandona × US$7.5                   ≈ US$1.1
  step-up a un fraude de US$250          → 20 % pasa el desafío × US$265            ≈ US$53

Con un score CALIBRADO p (probabilidad real de fraude) y un ticket A, cada acción tiene costo esperado:
  approve  p (A + 15)
  step_up  p · pass · (A + 15) + (1 − p) · abandon · fp
  decline  (1 − p) · fp
y la mejor acción cambia en dos cortes (`bayes_thresholds`): con A = US$25, step-up desde p ≈ 0.034 y
decline desde p ≈ 0.44; con A = US$250, desde ≈ 0.0053 y ≈ 0.11. Un ticket alto se bloquea con mucha
menos sospecha: por eso los umbrales son POR SEGMENTO de ticket (policy.yaml).

En la práctica el score no está perfectamente calibrado (y con negativos submuestreados, nada
calibrado), así que en cada release se busca en una GRILLA el par que minimiza el costo medido sobre
cohortes maduras, sujeto a un tope de declines (`choose`). La fórmula da el punto de partida y sirve de
chequeo: si la grilla da algo muy lejos, el modelo está descalibrado o los costos están mal.

Datos de entrada: una fila por pago con `score` (del modelo CANDIDATO re-scoreando el pasado, no el
score que logueó el modelo viejo), `amount_cents`, `label` (1/0, o NaN si nunca tendrá etiqueta: lo que
el sistema anterior declinó) y opcionalmente `weight` (1/propensity en la exploración).
  - las tasas (decline, step-up) se miden sobre TODAS las filas: el tope es sobre el tráfico real;
  - el costo y el recall, solo sobre filas etiquetadas. Lo que el sistema viejo declinó no tiene
    etiqueta: la exploración (pesada) es lo único que dice algo de esa región. Sin ella, el costo de
    "aprobar más" está subestimado. Es el sesgo de selección del caso, y aquí no se resuelve: se mide.
"""

from __future__ import annotations  # anotaciones como texto

from dataclasses import dataclass  # costos explícitos

import numpy as np  # la grilla vectorizada
import pandas as pd  # tabla de resultados

# Grilla por defecto: densa abajo (los umbrales de tickets altos son ≈ 0.003–0.03) y gruesa arriba.
# 1.01 = "nunca": permite step-up sin decline (o ninguna acción) si el tope lo exige.
DEFAULT_GRID = np.unique(np.round(np.concatenate([np.geomspace(0.001, 0.1, 31), np.linspace(0.1, 0.95, 18),
                                                  [1.01]]), 5))


@dataclass(frozen=True)
class Costs:
    """Costos en US$ (estimaciones del caso). Cambiarlos cambia los umbrales: son decisión de negocio."""

    fp_usd: float = 7.5  # pago bueno declinado: comisión perdida + parte de las compras futuras (5–10)
    chargeback_fee_usd: float = 15.0  # fee del chargeback + operación, además del monto
    stepup_abandon_rate: float = 0.15  # legítimos que abandonan el desafío 3-D Secure (10–20 %)
    stepup_fraud_pass_rate: float = 0.20  # fraudes que pasan el desafío (est.: OTP robado, SIM swap)


def bayes_thresholds(amount_usd: float, c: Costs = Costs()) -> tuple[float, float, float]:
    """(step_up, decline, no_3ds_decline) para un score CALIBRADO y un ticket dado.

    step_up:  approve = step_up  ⇔ p (A+15)(1 − pass) = (1 − p) abandon · fp
    decline:  step_up = decline  ⇔ p · pass (A+15)    = (1 − p) fp (1 − abandon)
    sin 3DS:  approve = decline  ⇔ p (A+15)           = (1 − p) fp
    """
    loss = amount_usd + c.chargeback_fee_usd  # lo que cuesta un fraude aprobado
    a_fp = c.stepup_abandon_rate * c.fp_usd
    step = a_fp / (loss * (1 - c.stepup_fraud_pass_rate) + a_fp)
    keep = c.fp_usd * (1 - c.stepup_abandon_rate)
    decline = keep / (keep + c.stepup_fraud_pass_rate * loss)
    no3ds = c.fp_usd / (c.fp_usd + loss)
    return step, decline, no3ds


def evaluate(df: pd.DataFrame, step_up: float, decline: float, c: Costs = Costs()) -> dict:
    """Métricas de UN par de umbrales. Útil para leer; `grid` hace lo mismo vectorizado."""
    return grid(df, c, step_grid=np.array([step_up]), decline_grid=np.array([decline])).iloc[0].to_dict()


def grid(df: pd.DataFrame, c: Costs = Costs(), step_grid: np.ndarray = DEFAULT_GRID,
         decline_grid: np.ndarray = DEFAULT_GRID) -> pd.DataFrame:
    """Todas las combinaciones step_up < decline (step_up = decline = "sin step-up" también vale)."""
    score = df["score"].to_numpy(float)
    amount = df["amount_cents"].to_numpy(float) / 100
    label = df["label"].to_numpy(float)  # NaN = sin etiqueta posible
    w = df["weight"].to_numpy(float) if "weight" in df.columns else np.ones(len(df))
    labeled = ~np.isnan(label)
    fraud = labeled & (label == 1)
    good = labeled & (label == 0)
    loss = amount + c.chargeback_fee_usd
    w_all, w_lab = w.sum(), w[labeled].sum()
    fraud_value = (w * amount * fraud).sum()
    rows = []
    for t_s in step_grid:
        for t_d in decline_grid:
            if t_s > t_d:
                continue
            dec = score >= t_d
            stp = (score >= t_s) & ~dec
            app = ~dec & ~stp
            cost = (w * (fraud * app * loss                                   # fraude aprobado
                         + fraud * stp * c.stepup_fraud_pass_rate * loss      # fraude que pasa el desafío
                         + good * dec * c.fp_usd                              # bueno declinado
                         + good * stp * c.stepup_abandon_rate * c.fp_usd)).sum()  # bueno que abandona
            caught = (w * amount * fraud * (dec + stp * (1 - c.stepup_fraud_pass_rate))).sum()
            rows.append({
                "step_up": float(t_s), "decline": float(t_d),
                "cost_per_1000": 1000 * cost / w_lab if w_lab else np.nan,
                "decline_rate": (w * dec).sum() / w_all,
                "step_up_rate": (w * stp).sum() / w_all,
                "good_decline_rate": (w * good * dec).sum() / max((w * good).sum(), 1e-12),
                "good_step_up_rate": (w * good * stp).sum() / max((w * good).sum(), 1e-12),
                "value_recall": caught / fraud_value if fraud_value else np.nan,  # US$ de fraude frenado
            })
    return pd.DataFrame(rows)


def choose(df: pd.DataFrame, c: Costs = Costs(), decline_rate_cap: float = 0.015,
           step_up_rate_cap: float = 1.0, **grid_kw) -> dict:
    """El par de menor costo que respeta los topes. Empates → el de MENOS declines (menos fricción)."""
    g = grid(df, c, **grid_kw)
    ok = g[(g["decline_rate"] <= decline_rate_cap) & (g["step_up_rate"] <= step_up_rate_cap)]
    if ok.empty:
        raise ValueError("ningún par respeta los topes: revisa la grilla (¿falta 1.01 = nunca?)")
    best = ok.sort_values(["cost_per_1000", "decline_rate", "step_up_rate"], kind="stable").iloc[0]
    return best.to_dict()


def choose_by_segment(df: pd.DataFrame, c: Costs = Costs(), decline_rate_cap: float = 0.015,
                      **kw) -> dict[str, dict]:
    """Un par por segmento (columna `segment`). Cada segmento necesita fraude maduro suficiente:
    con 20 fraudes, el costo de cada par es ruido; agrupa segmentos chicos antes de llamar a esto."""
    return {seg: choose(part, c, decline_rate_cap, **kw) for seg, part in df.groupby("segment")}


def synthetic_scored(n: int = 60000, seed: int = 0) -> pd.DataFrame:
    """Pagos sintéticos con score CALIBRADO (label ~ Bernoulli(score)), para el ejemplo y los tests."""
    rng = np.random.default_rng(seed)
    high = rng.random(n) < 0.3
    amount = np.where(high, rng.lognormal(np.log(250), 0.3, n), rng.lognormal(np.log(25), 0.3, n))
    score = np.clip(rng.beta(0.3, 40, n), 0, 1)  # la mayoría ≈ 0; una cola de scores altos
    label = (rng.random(n) < score).astype(float)
    return pd.DataFrame({"score": score, "amount_cents": np.round(amount * 100), "label": label,
                         "segment": np.where(high, "retail_high", "retail_low")})


if __name__ == "__main__":
    data = synthetic_scored()
    for seg, best in choose_by_segment(data).items():
        typical = data.loc[data.segment == seg, "amount_cents"].median() / 100
        bs, bd, _ = bayes_thresholds(typical)
        print(f"{seg:12s} grilla: step_up={best['step_up']:.4f} decline={best['decline']:.3f} "
              f"costo/1,000={best['cost_per_1000']:.1f} declines={best['decline_rate']:.3%} "
              f"recall_valor={best['value_recall']:.1%} | Bayes(US${typical:.0f}): {bs:.4f} / {bd:.3f}")
