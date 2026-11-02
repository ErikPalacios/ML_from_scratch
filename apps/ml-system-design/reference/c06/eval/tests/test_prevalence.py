"""Tests de eval/prevalence.py con datos cuyo resultado se puede calcular a mano."""

import random

import pytest

import prevalence as pv


def test_wilson_matches_hand_computation():
    lo, hi = pv.wilson_interval(3, 1000)
    assert lo == pytest.approx(0.00102, abs=1e-5)
    assert hi == pytest.approx(0.00879, abs=1e-5)
    lo, hi = pv.wilson_interval(50, 100)
    assert (lo, hi) == pytest.approx((0.4038, 0.5962), abs=1e-4)


def test_wilson_never_negative_unlike_wald():
    p, n = 3 / 1000, 1000
    wald_low = p - 1.96 * (p * (1 - p) / n) ** 0.5
    assert wald_low < 0  # el intervalo "de libro" se sale de [0, 1]
    assert pv.wilson_interval(3, 1000)[0] > 0


def test_zero_positives_gives_upper_bound_only():
    est = pv.prevalence_srs([False] * 3000)
    assert est.upper_bound_only and est.value == 0.0
    assert est.high == pytest.approx(0.000998, abs=1e-6)  # ≈ regla de tres: 3 / 3000
    assert est.high == pytest.approx(3 / 3000, rel=0.01)


def test_srs_prevalence():
    est = pv.prevalence_srs([True] * 50 + [False] * 9950)
    assert est.value == 0.005 and est.k == 50 and est.n == 10_000
    assert est.low < 0.005 < est.high
    assert est.high - est.low == pytest.approx(0.0028, abs=2e-4)  # ± ≈ 0.14 puntos con 10k vistas


def test_sample_size_example_from_docstring():
    assert pv.sample_size_for(0.005, 0.0005) == 76_446


def test_stratified_is_unbiased_and_weights_correct_oversampling():
    """Riesgo alto: 2 % de las vistas, muestreado 50×; riesgo bajo: 98 %. Verdad: 0.02·0.20 + 0.98·0.001."""
    strata = {
        "riesgo_alto": pv.Stratum(views_total=2_000_000, sampled=5_000, violating=1_000),  # p = 0.20
        "riesgo_bajo": pv.Stratum(views_total=98_000_000, sampled=5_000, violating=5),  # p = 0.001
    }
    est = pv.stratified_prevalence(strata)
    assert est.value == pytest.approx(0.02 * 0.20 + 0.98 * 0.001)  # 0.498 %
    naive = (1_000 + 5) / 10_000  # ignorar los pesos: 10 %, 20 veces más
    assert naive > 15 * est.value
    assert est.low < est.value < est.high


def test_stratified_beats_srs_for_same_labeling_budget():
    """Mismo presupuesto (10k etiquetas): el estratificado da un intervalo más angosto que el simple."""
    rng = random.Random(1)
    srs = pv.prevalence_srs([rng.random() < 0.00498 for _ in range(10_000)])
    strat = pv.stratified_prevalence({
        "alto": pv.Stratum(2e6, 5_000, 1_000),
        "bajo": pv.Stratum(98e6, 5_000, 5),
    })
    assert (strat.high - strat.low) < (srs.high - srs.low)


def test_stratified_bootstrap_agrees_with_normal_when_counts_are_large():
    strata = {"a": pv.Stratum(4e6, 4_000, 400), "b": pv.Stratum(6e6, 4_000, 80)}
    normal = pv.stratified_prevalence(strata)
    boot = pv.stratified_bootstrap(strata, b=20_000, seed=3)
    assert boot.value == pytest.approx(normal.value)
    assert boot.low == pytest.approx(normal.low, abs=1.5e-3)
    assert boot.high == pytest.approx(normal.high, abs=1.5e-3)


def test_stratum_without_sample_is_an_error():
    with pytest.raises(ValueError, match="sin muestra"):
        pv.stratified_prevalence({"a": pv.Stratum(1e6, 0, 0), "b": pv.Stratum(1e6, 100, 1)})


def test_stratified_zero_positives_upper_bound():
    est = pv.stratified_prevalence({"a": pv.Stratum(1e6, 3000, 0), "b": pv.Stratum(1e6, 3000, 0)})
    assert est.upper_bound_only and est.high == pytest.approx(pv.upper_bound_zero(3000))


def test_view_weighting_example_from_docstring():
    items = [(4_000, True)] * 5 + [(380_000 / 995, False)] * 995
    assert sum(bad for _, bad in items) / len(items) == 0.005  # 0.5 % de los ítems
    assert pv.view_weighted_rate(items) == pytest.approx(0.05)  # 5 % de las vistas


def test_precision_from_actioned_sample():
    est = pv.precision([True] * 180 + [False] * 20)
    assert est.value == 0.9 and est.low < 0.9 < est.high


def test_recall_from_random_sample_is_wide_with_few_positives():
    # 10,000 vistas al azar → solo 12 de acoso; accionamos 9
    records = [{"label": None, "actioned": ()} for _ in range(9_988)]
    records += [{"label": "hate_harassment", "actioned": ("hate_harassment",)}] * 9
    records += [{"label": "hate_harassment", "actioned": ()}] * 3
    records += [{"label": "spam_scams", "actioned": ("spam_scams",)}] * 4
    est = pv.recall_from_random_sample(records, "hate_harassment")
    assert est.value == 0.75 and est.n == 12
    assert est.high - est.low > 0.4  # ± más de 20 puntos: con 12 positivos no hay más precisión
    with pytest.raises(ValueError, match="agranda o estratifica"):
        pv.recall_from_random_sample(records, "self_harm")


def test_cohens_kappa_corrects_for_chance():
    always_clean = ["ok"] * 99 + ["hate"]
    lazy = ["ok"] * 100
    assert sum(x == y for x, y in zip(always_clean, lazy)) / 100 == 0.99  # 99 % de acuerdo…
    assert pv.cohens_kappa(always_clean, lazy) == pytest.approx(0.0)  # …y kappa 0: no aporta nada
    a = ["ok", "ok", "hate", "hate", "spam", "ok"]
    assert pv.cohens_kappa(a, a) == 1.0
    b = ["ok", "hate", "hate", "ok", "spam", "ok"]
    # po = 4/6; pe = (3/6·3/6) + (2/6·2/6) + (1/6·1/6) = 14/36 → (24/36 − 14/36)/(22/36) = 10/22
    assert pv.cohens_kappa(a, b) == pytest.approx(10 / 22)


def test_recall_with_stratified_weights_is_not_inflated():
    """Estrato alto (sobremuestreado, todo accionado) vs bajo (nadie lo miró: nada accionado).

    Verdad: el estrato bajo tiene 0.97 × 0.05 % de las vistas violando y el alto 0.005 × 40 %
    → recall = 0.002 / (0.000485 + 0.002) ≈ 80.5 %. Sin pesos: 400 / 403 ≈ 99 %.
    """
    low = [{"label": "hate_harassment", "actioned": (), "weight": 97e6 / 6000}] * 3
    high = [{"label": "hate_harassment", "actioned": ("hate_harassment",), "weight": 0.5e6 / 1000}] * 400
    est = pv.recall_from_random_sample(low + high, "hate_harassment")
    assert est.value == pytest.approx(0.002 / (0.000485 + 0.002), rel=1e-3)
    unweighted = pv.recall_from_random_sample([{k: v for k, v in r.items() if k != "weight"} for r in low + high],
                                              "hate_harassment")
    assert unweighted.value > 0.99 and est.method == "wilson_kish"
    assert est.high - est.low > unweighted.high - unweighted.low  # n efectivo chico: intervalo honesto
