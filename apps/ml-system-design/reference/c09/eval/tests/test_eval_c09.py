"""Tests de eval/: umbrales por costo esperado y madurez de etiquetas."""

import math

import numpy as np
import pandas as pd
import pytest
from choose_thresholds import Costs, bayes_thresholds, choose, choose_by_segment, evaluate, grid, synthetic_scored
from label_maturity import DAY_S, arrival_curve, cohorts, completed_rate, maturity_day

# ------------------------------------------------------------------------------------------ umbrales


def test_bayes_thresholds_match_the_hand_calculation_in_the_docstring():
    step, dec, no3ds = bayes_thresholds(25)
    assert step == pytest.approx(1.125 / (0.8 * 40 + 1.125))  # 0.0340
    assert dec == pytest.approx(6.375 / (6.375 + 0.2 * 40))  # 0.4435
    assert no3ds == pytest.approx(7.5 / (7.5 + 40))  # 0.158
    step_hi, dec_hi, _ = bayes_thresholds(250)
    assert step_hi == pytest.approx(0.0053, abs=5e-5) and dec_hi == pytest.approx(0.107, abs=5e-4)
    assert step_hi < step and dec_hi < dec  # ticket alto → se actúa con menos sospecha


def test_cost_of_one_pair_by_hand():
    # 4 pagos de US$100 (score, label): fraude alto, fraude bajo, bueno alto, bueno bajo
    df = pd.DataFrame({"score": [0.9, 0.05, 0.6, 0.01], "label": [1, 1, 0, 0], "amount_cents": [10000] * 4})
    r = evaluate(df, step_up=0.04, decline=0.5)
    # decline: fraude 0.9 (0) y bueno 0.6 (7.5); step-up: fraude 0.05 (0.2 × 115 = 23); approve: bueno 0.01 (0)
    assert r["cost_per_1000"] == pytest.approx(1000 * (7.5 + 23) / 4)
    assert r["decline_rate"] == pytest.approx(0.5) and r["step_up_rate"] == pytest.approx(0.25)
    assert r["value_recall"] == pytest.approx((100 + 100 * 0.8) / 200)  # US$ de fraude frenados


def test_grid_optimum_matches_bayes_when_the_score_is_calibrated():
    df = calibrated(200_000)
    best = choose(df, decline_rate_cap=1.0)
    step, dec, _ = bayes_thresholds(25)
    assert best["step_up"] == pytest.approx(step, rel=0.35)
    assert best["decline"] == pytest.approx(dec, rel=0.35)
    # y, sobre todo, el costo es prácticamente el de los umbrales teóricos
    at_bayes = evaluate(df, step, dec)["cost_per_1000"]
    assert best["cost_per_1000"] <= at_bayes * 1.01


def calibrated(n=100_000, seed=1, amount_cents=2500):
    """Scores uniformes en [0, 0.8] y etiqueta ~ Bernoulli(score): un modelo perfectamente calibrado."""
    rng = np.random.default_rng(seed)
    score = rng.uniform(0, 0.8, n)
    return pd.DataFrame({"score": score, "label": (rng.random(n) < score).astype(float),
                         "amount_cents": amount_cents})


def test_decline_cap_binds_and_costs_more():
    df = calibrated()
    free = choose(df, decline_rate_cap=1.0)
    capped = choose(df, decline_rate_cap=0.10)
    assert free["decline_rate"] > 0.10 >= capped["decline_rate"]  # sin tope declina ≈ 45 % (score ≥ 0.44)
    assert capped["cost_per_1000"] > free["cost_per_1000"]  # el tope tiene un precio, y se ve


def test_high_ticket_segment_gets_lower_thresholds():
    res = choose_by_segment(synthetic_scored(60_000, seed=3), decline_rate_cap=1.0)
    assert res["retail_high"]["step_up"] < res["retail_low"]["step_up"]


def test_unlabeled_rows_count_in_rates_but_not_in_cost():
    labeled = pd.DataFrame({"score": [0.9, 0.01], "label": [1.0, 0.0], "amount_cents": [10000, 10000]})
    with_unlabeled = pd.concat([labeled, pd.DataFrame({"score": [0.95, 0.95], "label": [np.nan, np.nan],
                                                       "amount_cents": [10000, 10000]})])
    a = evaluate(labeled, 0.5, 0.8)
    b = evaluate(with_unlabeled, 0.5, 0.8)
    assert a["cost_per_1000"] == b["cost_per_1000"]  # lo que no tiene etiqueta no tiene costo medible
    assert a["decline_rate"] == 0.5 and b["decline_rate"] == 0.75  # pero sí cuenta para el tope


def test_exploration_weight_scales_its_rows():
    df = pd.DataFrame({"score": [0.6, 0.01], "label": [1.0, 0.0], "amount_cents": [10000, 10000],
                       "weight": [100.0, 1.0]})
    r = evaluate(df, 0.5, 0.9)  # el explorado (peso 100) cae en step-up
    assert r["step_up_rate"] == pytest.approx(100 / 101)


def test_never_decline_is_always_feasible():
    g = grid(synthetic_scored(5000, seed=4))
    assert (g["decline"] == 1.01).any()
    assert choose(synthetic_scored(5000, seed=4), decline_rate_cap=0.0)["decline_rate"] == 0.0


# ------------------------------------------------------------------------------------------ madurez
AS_OF = 1_760_000_000.0


def chargeback_log(n_tx=600_000, cb_rate=0.03, seed=0, span_days=160):
    """Pagos en `span_days` hasta AS_OF; retrasos: 60 % en 0–30 días, 30 % en 30–60, 10 % en 60–120."""
    rng = np.random.default_rng(seed)
    tx = AS_OF - rng.uniform(0, span_days, n_tx) * DAY_S
    has = rng.random(n_tx) < cb_rate
    u = rng.random(n_tx)
    delay = np.where(u < 0.6, rng.uniform(0, 30, n_tx),
                     np.where(u < 0.9, rng.uniform(30, 60, n_tx), rng.uniform(60, 120, n_tx)))
    cb = np.where(has, tx + delay * DAY_S, np.nan)
    cb = np.where(cb <= AS_OF, cb, np.nan)  # lo que todavía no llegó, hoy no se ve
    return pd.DataFrame({"tx_time": tx, "cb_time": cb, "amount_cents": 3000})


def test_arrival_curve_recovers_60_and_90_percent():
    curve = arrival_curve(chargeback_log(), AS_OF)
    assert curve.loc[30, "fraction"] == pytest.approx(0.6, abs=0.03)
    assert curve.loc[60, "fraction"] == pytest.approx(0.9, abs=0.03)
    assert maturity_day(curve, 0.9) in range(57, 66)  # la curva es plana después de 60: el día exacto baila
    assert curve["fraction"].iloc[-1] == pytest.approx(1.0)


def test_using_young_cohorts_makes_the_curve_too_optimistic():
    """La trampa: con TODOS los pagos, las cohortes jóvenes solo aportan chargebacks rápidos."""
    log = chargeback_log()
    right = arrival_curve(log, AS_OF)
    # "todas las cohortes": los retrasos de todo lo que llegó hasta hoy, sin filtrar por edad
    delays = ((log.cb_time - log.tx_time) / DAY_S).dropna()
    wrong_30 = (delays <= 30).mean()
    assert wrong_30 > right.loc[30, "fraction"] + 0.05


def test_only_mature_cohorts_are_evaluable():
    log = chargeback_log()
    curve = arrival_curve(log, AS_OF)
    table = cohorts(log, AS_OF, curve, target=0.9)
    young = table[table.age_days_youngest < 50]
    old = table[table.age_days_youngest > 70]
    assert not young.evaluable.any() and old.evaluable.all()
    # las cohortes jóvenes "parecen" tener menos fraude: no es mejora del modelo, es que no llegó
    assert young.observed_bps.mean() < 0.8 * old.observed_bps.mean()


def test_completed_rate_extrapolates_a_young_cohort():
    curve = arrival_curve(chargeback_log(), AS_OF)
    est = completed_rate(7.2, 30, curve)  # 7.2 bps observados a los 30 días
    assert est == pytest.approx(12.0, rel=0.06)
    assert math.isnan(completed_rate(0.5, 3, curve))  # a los 3 días: demasiado ruido para estimar
