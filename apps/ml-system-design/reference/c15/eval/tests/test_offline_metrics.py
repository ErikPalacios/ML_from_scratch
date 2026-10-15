"""Tests de offline_metrics.py con valores calculados a mano."""

import itertools
import math

import numpy as np
import pytest

import offline_metrics as om

Y = [1, 0, 0, 0]
P = [0.5, 0.1, 0.2, 0.1]


def test_docstring_example():
    # log loss = (ln 2 + ln(1/0.9) + ln(1/0.8) + ln(1/0.9)) / 4
    ll = (math.log(2) + 2 * math.log(1 / 0.9) + math.log(1 / 0.8)) / 4
    assert om.log_loss(Y, P) == pytest.approx(ll) and ll == pytest.approx(0.281753, abs=1e-6)
    h = -(0.25 * math.log(0.25) + 0.75 * math.log(0.75))
    assert om.entropy(0.25) == pytest.approx(h) and h == pytest.approx(0.562335, abs=1e-6)
    assert om.normalized_entropy(Y, P) == pytest.approx(ll / h) and ll / h == pytest.approx(0.501041, abs=1e-6)
    assert om.auc(Y, P) == 1.0
    assert om.calibration_ratio(Y, P) == pytest.approx(1 / 0.9)


def test_predicting_the_background_ctr_gives_ne_one():
    y = [1, 0, 0, 0, 0, 0, 0, 0, 0, 1]
    assert om.normalized_entropy(y, [0.2] * 10) == pytest.approx(1.0)


def test_ties_count_half_in_auc():
    # positivos 0.3 y 0.2; negativos 0.2 y 0.1: (1 + 1 + ½ + 1) / 4 = 0.875
    assert om.auc([1, 1, 0, 0], [0.3, 0.2, 0.2, 0.1]) == pytest.approx(0.875)
    assert om.auc([1, 0, 1, 0, 0], [0.5] * 5) == pytest.approx(0.5)  # todo empatado: azar, en cualquier orden


def test_auc_matches_brute_force_pairs():
    rng = np.random.default_rng(0)
    y = (rng.random(400) < 0.1).astype(int)
    p = np.round(rng.random(400), 2)  # redondeo: fuerza empates
    pos, neg = p[y == 1], p[y == 0]
    brute = np.mean([1.0 if a > b else 0.5 if a == b else 0.0 for a, b in itertools.product(pos, neg)])
    assert om.auc(y, p) == pytest.approx(brute, abs=1e-12)


def test_auc_is_undefined_with_one_class():
    assert om.auc([0, 0, 0], [0.1, 0.2, 0.3]) is None


def test_doubling_every_prediction_keeps_auc_and_breaks_calibration():
    rng = np.random.default_rng(1)
    p = rng.beta(1, 60, size=20_000)
    y = (rng.random(20_000) < p).astype(int)
    p2 = np.clip(2 * p, 0, 1)
    assert om.auc(y, p2) == pytest.approx(om.auc(y, p))  # el ranking no cambia
    assert om.calibration_ratio(y, p2) == pytest.approx(om.calibration_ratio(y, p) / 2, rel=0.01)
    assert om.normalized_entropy(y, p2) > om.normalized_entropy(y, p)  # NE sí lo castiga


def test_background_from_a_downsampled_set_is_the_trap():
    rng = np.random.default_rng(2)
    p = rng.beta(1, 280, size=200_000)  # CTR real ≈ 0.35 %
    y = (rng.random(200_000) < p).astype(int)
    real_bg = y.mean()
    downsampled_bg = real_bg / (real_bg + (1 - real_bg) * 0.05)  # ≈ 6.4 %: el CTR "del training"
    good = om.normalized_entropy(y, p, background_ctr=real_bg)
    wrong = om.normalized_entropy(y, p, background_ctr=downsampled_bg)
    assert good < 1.0 and wrong < 0.2  # con el fondo equivocado, el modelo "parece" ≈ 10 veces mejor (0.93 → 0.09)


def test_log_loss_is_finite_with_zero_and_one_predictions():
    assert math.isfinite(om.log_loss([1, 0], [0.0, 1.0]))  # recortado a EPS: grande, pero no infinito


def test_by_slice_uses_the_global_background():
    rows = ([{"slot": "top", "label": 1, "pctr": 0.5}] * 10 + [{"slot": "top", "label": 0, "pctr": 0.5}] * 10
            + [{"slot": "bottom", "label": 1, "pctr": 0.1}] * 2 + [{"slot": "bottom", "label": 0, "pctr": 0.1}] * 18)
    out = om.by_slice(rows, lambda r: r["slot"])
    bg = 12 / 40
    assert out["top"]["ne"] == pytest.approx(om.log_loss([1] * 10 + [0] * 10, [0.5] * 20) / om.entropy(bg))
    assert out["bottom"]["calibration_ratio"] == pytest.approx(2 / 2.0)
    assert out["top"]["auc"] == pytest.approx(0.5)


def test_mismatched_lengths_fail_loudly():
    with pytest.raises(ValueError):
        om.log_loss([1, 0], [0.5])
