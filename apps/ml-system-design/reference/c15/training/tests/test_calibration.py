"""Tests de calibration.py y del pipeline completo: eventos → set submuestreado → modelo → corrección → isotónica.

El último bloque es la demostración central del caso: un modelo entrenado con 5 % de los negativos predice
≈ 15–20 veces más clicks de los que hay, la corrección lo devuelve a ≈ 1, y el AUC no ve nada de eso.
"""

import dataclasses

import numpy as np
import pytest
from sklearn.isotonic import IsotonicRegression

import calibration as C
import model as M
import synthetic
import train_logreg
from offline_metrics import auc, calibration_ratio, normalized_entropy


# ---------------------------------------------------------------------------- piezas
def test_correction_and_downsampled_ctr_are_inverses():
    assert C.downsampled_ctr(0.0035, 0.05) == pytest.approx(0.065635, abs=1e-6)  # el ejemplo del docstring
    for c in (0.001, 0.0035, 0.015, 0.2):
        assert float(C.correct_downsampling(C.downsampled_ctr(c, 0.05), 0.05)) == pytest.approx(c, rel=1e-12)
    assert C.correct_downsampling is M.correct_downsampling  # UNA definición: la del modelo


def docstring_bins():
    """Los 3 bins del docstring, con 10,000 impresiones cada uno (pCTR fijo por bin)."""
    p = np.repeat([0.001, 0.003, 0.012], 10_000)
    y = np.zeros(30_000)
    y[:9] = 1  # bin 1: 9 clicks → 0.09 %
    y[10_000:10_033] = 1  # bin 2: 33 clicks → 0.33 %
    y[20_000:20_108] = 1  # bin 3: 108 clicks → 1.08 %
    return p, y


def test_reliability_bins_and_ece_from_the_docstring():
    p, y = docstring_bins()
    bins = C.reliability_bins(p, y, n_bins=3)
    assert [round(b.ratio, 2) for b in bins] == [0.9, 1.1, 0.9]
    assert C.expected_calibration_error(p, y, n_bins=3) == pytest.approx((0.0001 + 0.0003 + 0.0012) / 3)


def test_uniform_bins_hide_the_miscalibration():
    p, y = docstring_bins()
    quantile = C.expected_calibration_error(p, y, n_bins=3, strategy="quantile")
    uniform = C.expected_calibration_error(p, y, n_bins=10, strategy="uniform")
    # Con bins de ancho 0.1 todo cae en [0, 0.1): solo queda |CTR medio − pCTR medio| = |0.5 % − 0.533 %|
    assert len(C.reliability_bins(p, y, 10, "uniform")) == 1
    assert uniform == pytest.approx(abs(150 / 30_000 - 0.016 / 3)) and uniform < quantile


def test_isotonic_thresholds_with_np_interp_equal_sklearn():
    rng = np.random.default_rng(0)
    q = rng.beta(1, 80, size=5000)
    y = (rng.random(5000) < np.clip(q * 1.3, 0, 1)).astype(float)
    x_thr, y_thr = C.fit_isotonic(q, y)
    iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(q, y)
    test = np.concatenate([rng.beta(1, 80, size=2000), [0.0, 0.9, 1.0]])  # incluye valores fuera del rango
    assert np.allclose(C.apply_isotonic(x_thr, y_thr, test), iso.predict(test), atol=1e-12)


def test_calibration_by_slice_refuses_tiny_slices():
    rows = [{"slot": "top", "label": 1, "pctr": 0.01}] * 50 + [{"slot": "top", "label": 0, "pctr": 0.01}] * 19_950
    rows += [{"slot": "bottom", "label": 1, "pctr": 0.02}] * 3 + [{"slot": "bottom", "label": 0, "pctr": 0.02}] * 497
    out = C.calibration_by_slice(rows, lambda r: r["slot"], min_expected=100)
    assert out["top"]["ratio"] == pytest.approx(50 / 200)  # 200 esperados, 50 observados: sobreestima 4×
    assert out["bottom"]["ratio"] is None  # 10 esperados: ruido, no señal


# ---------------------------------------------------------------------------- el pipeline completo
@pytest.fixture(scope="module")
def pipeline():
    world = synthetic.World(seed=3, n_ads=60, n_advertisers=25, targeted=False)
    train_rows = synthetic.training_rows(world, n_pageviews=80_000, neg_rate=0.05, seed=0)
    model = train_logreg.fit_model(train_rows, version="lr-e2e")
    hold_a = synthetic.training_rows(world, n_pageviews=80_000, neg_rate=1.0, seed=1)  # día 1, sin submuestrear
    hold_b = synthetic.training_rows(world, n_pageviews=80_000, neg_rate=1.0, seed=2)  # día 2
    return world, train_rows, model, hold_a, hold_b


def predict(model, rows):
    X, y = train_logreg.hashed_rows(rows)
    return model.predict_rows(X), y, X


def test_training_set_is_downsampled_and_carries_w(pipeline):
    _, train_rows, model, _, _ = pipeline
    ctr = np.mean([r["label"] for r in train_rows])
    assert 0.10 < ctr < 0.25  # ≈ 1 % real → ≈ 17 % en el set con 5 % de los negativos
    assert model.neg_rate == 0.05  # la w viaja en el artefacto


def test_correction_brings_the_ratio_back_to_one(pipeline):
    _, _, model, hold_a, _ = pipeline
    q, y, X = predict(model, hold_a)
    p_raw = M.sigmoid(model._sum_logits(X))  # lo que saldría SIN la corrección
    raw_ratio, ratio = calibration_ratio(y, p_raw), calibration_ratio(y, q)
    print(f"\nholdout: {int(y.sum())} clicks · observados ÷ esperados sin corrección {raw_ratio:.3f}, "
          f"con corrección {ratio:.3f}")
    assert raw_ratio < 0.12  # predice ≈ 10–20 veces más clicks de los que hay
    assert 0.88 < ratio < 1.12
    # El AUC no se entera: la corrección es monótona
    assert auc(y, p_raw) == pytest.approx(auc(y, q), abs=1e-12)
    assert normalized_entropy(y, q) < 1.0 < normalized_entropy(y, p_raw)  # NE sí lo ve


def test_learned_position_effects_match_the_hidden_truth(pipeline):
    _, _, model, _, _ = pipeline
    # Verdad oculta (synthetic.py): bottom −0.8 y in_article −0.25 respecto de top, para native
    top = model.position_term("top", "native")
    assert model.position_term("bottom", "native") - top == pytest.approx(-0.8, abs=0.25)
    assert model.position_term("in_article", "native") - top == pytest.approx(-0.25, abs=0.25)


def test_isotonic_fitted_on_one_day_does_not_hurt_the_next(pipeline):
    _, _, model, hold_a, hold_b = pipeline
    qa, ya, _ = predict(model, hold_a)
    x_thr, y_thr = C.fit_isotonic(qa, ya)
    calibrated = dataclasses.replace(model, calib_x=x_thr, calib_y=y_thr)  # así se publica (dos arreglos)
    qb, yb, Xb = predict(model, hold_b)
    qb_cal = calibrated.predict_rows(Xb)
    before = C.expected_calibration_error(qb, yb, n_bins=10)
    after = C.expected_calibration_error(qb_cal, yb, n_bins=10)
    print(f"\nECE en el día 2: {before * 100:.4f} pp sin isotónica, {after * 100:.4f} pp con isotónica del día 1")
    assert after <= before * 1.5 + 1e-4  # con un modelo ya bien corregido, la isotónica casi no mueve nada
    assert 0.85 < calibration_ratio(yb, qb_cal) < 1.15


def test_warm_start_continues_from_yesterday(pipeline):
    world, train_rows, _, _, hold_b = pipeline
    X, y = train_logreg.hashed_rows(train_rows)
    state = train_logreg.train(X, y)
    day1 = synthetic.training_rows(world, n_pageviews=80_000, neg_rate=0.05, seed=4)
    X1, y1 = train_logreg.hashed_rows(day1)
    warm = train_logreg.to_model(train_logreg.train(X1, y1, state=state), neg_rate=0.05, version="warm")
    cold = train_logreg.fit_model(day1, version="cold")  # solo el día nuevo
    qw, yb, _ = predict(warm, hold_b)
    qc, _, _ = predict(cold, hold_b)
    print(f"\nNE día 2: warm start {normalized_entropy(yb, qw):.4f} · "
          f"solo el día nuevo {normalized_entropy(yb, qc):.4f}")
    assert normalized_entropy(yb, qw) <= normalized_entropy(yb, qc) + 0.002  # más historia, no peor


def test_mixed_rates_cannot_train_one_model(pipeline):
    _, train_rows, _, hold_a, _ = pipeline
    with pytest.raises(ValueError, match="neg_rate"):
        train_logreg.fit_model(train_rows + hold_a[:100], version="mal")
