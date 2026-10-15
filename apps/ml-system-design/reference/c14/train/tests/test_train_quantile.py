"""Tests del entrenamiento por cuantiles: cruce de cuantiles, censura, categóricas y el artefacto."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from sklearn.ensemble import HistGradientBoostingRegressor

import build_features as bf
import calendar_mx as cm
import train_quantile as tq
from backtest import bias, coverage
from synthetic import make_synthetic

EVENTS = Path(__file__).resolve().parents[2] / "features" / "retail_events.yaml"
# Menos árboles que DEFAULT_PARAMS para que los tests tarden segundos; las conclusiones no cambian (medido)
FAST = {"max_iter": 120, "learning_rate": 0.1}


@pytest.fixture(scope="module")
def cfg():
    return cm.load_events(EVENTS)


def test_fix_crossing_sorts_and_clips_by_hand():
    p50, p90, crossed = tq.fix_crossing(np.array([5.0, 3.0, -1.0]), np.array([8.0, 2.0, -0.5]))
    np.testing.assert_array_equal(p50, [5.0, 2.0, 0.0])  # fila 2 cruzó: se ordenan (2, 3)
    np.testing.assert_array_equal(p90, [8.0, 3.0, 0.0])  # fila 3: demanda negativa → 0
    np.testing.assert_array_equal(crossed, [False, True, False])


def test_zero_heavy_counts_freeze_the_p50_unless_jittered():
    """Trampa 0: con mayoría de ceros, la pinball no tiene gradiente útil en la mediana global (0)."""
    rng = np.random.default_rng(0)
    n = 40_000
    fast = rng.random(n) < 0.05  # 5 % de filas que venden ≈ 4 al día; el resto ≈ 0.3
    lam = np.where(fast, 4.0, 0.3)
    y = rng.poisson(lam).astype(float)
    x = np.column_stack([lam + rng.normal(0, 0.3, n), rng.normal(size=n)])  # una feature continua útil
    kw = {"loss": "quantile", "quantile": 0.5, "max_iter": 50, "early_stopping": False, "random_state": 0}
    plain = HistGradientBoostingRegressor(**kw).fit(x, y)
    assert np.allclose(plain.predict(x), 0.0)  # TODAS las filas en 0, también las que venden 4 (medido)
    jittered = tq.from_jittered(HistGradientBoostingRegressor(**kw).fit(x, tq.jitter(y)).predict(x))
    assert 3.0 <= jittered[fast].mean() <= 4.5 and jittered[~fast].mean() <= 0.2  # mediana real: 4 y 0
    np.testing.assert_array_equal(tq.from_jittered(np.array([3.4, 0.7, 2.01, -0.3])), [3.0, 0.0, 2.0, 0.0])


def test_seasonal_naive_fallbacks_by_hand():
    rows = pd.DataFrame({"sw_lag_1": [4.0, np.nan, np.nan], "sw_lag_2": [6.0, 2.0, np.nan],
                         "sw_lag_3": [1.0, 5.0, np.nan], "sw_lag_4": [np.nan, 1.0, np.nan],
                         "sw_mean_4": [3.67, 2.67, np.nan], "roll_mean_28": [3.0, 2.0, 0.5]})
    nv = tq.seasonal_naive(rows)
    np.testing.assert_allclose(nv["p50"], [4.0, 2.67, 0.5])  # lag 1 → promedio de 4 → 28 días
    np.testing.assert_allclose(nv["p90"], [6.0, 5.0, 0.5])  # máximo de los 4 (o el p50 si no hay)


def _pool_and_tests(data, mask_oos):
    start, end = data.sales["date"].min(), data.stock["date"].max()
    panel = bf.build_panel(data.sales, data.stock, data.series, start, end)
    origin = end - pd.Timedelta(days=28)
    train_origins = pd.date_range(start + pd.Timedelta(days=28), origin - pd.Timedelta(days=1), freq="7D")
    pool = bf.training_frame(panel, train_origins, data.calendar, data.promo, data.store_attrs, data.sku_attrs,
                             data.sales, data.stock, mask_oos=mask_oos)
    pool = pool[pool["target_date"] <= origin]
    tests = bf.training_frame(panel, [origin + pd.Timedelta(days=7 * k) for k in range(3)], data.calendar,
                              data.promo, data.store_attrs, data.sku_attrs, data.sales, data.stock,
                              mask_oos=mask_oos)
    truth = data.truth.rename(columns={"date": "target_date"})
    return pool, tests.merge(truth, on=[*bf.KEYS, "target_date"])


def test_ignoring_censored_days_underforecasts_where_it_hurts(cfg):
    """El lazo del caso, medido contra la demanda VERDADERA (solo existe en datos sintéticos).

    Con los días agotados como si fueran demanda (y en los lags), el modelo aprende que lo que se agota
    vende poco: el P50 baja, sobre todo en promociones (donde más se agota), y el P90 cubre menos.
    """
    data = make_synthetic(seed=0, oos_hazard=0.06, events_cfg=cfg)
    res = {}
    for mask in (True, False):
        pool, tests = _pool_and_tests(data, mask)
        res[mask] = (tq.fit(pool, FAST).predict(tests), tests)
    (pm, tm), (pn, tn) = res[True], res[False]
    a = tm["demand"].to_numpy()
    promo = tm["promo_flag"].to_numpy() == 1
    assert bias(pn["p50"], a) < bias(pm["p50"], a) - 0.08  # ≈ −0.34 contra ≈ −0.16 (medido)
    assert bias(pn["p50"][promo], a[promo]) < bias(pm["p50"][promo], a[promo]) - 0.15
    assert coverage(pm["p90"][promo], a[promo]) >= coverage(pn["p90"][promo], a[promo]) + 0.02
    assert pm["p90"].sum() > 1.03 * pn["p90"].sum()  # menos inventario de seguridad sin la máscara


def test_fit_uses_only_rows_with_a_target_and_records_its_window(cfg):
    data = make_synthetic(n_stores=2, n_skus=6, days=200, seed=3, events_cfg=cfg)
    pool, _ = _pool_and_tests(data, True)
    fc = tq.fit(pool, params={"max_iter": 30})
    assert fc.meta["n_rows"] == int(pool["target"].notna().sum())  # agotados y no listados fuera
    assert fc.meta["train_to"] == str(pool.loc[pool["target"].notna(), "target_date"].max().date())
    assert fc.version.startswith("gbdt-q-") and fc.version == tq.fit(pool, params={"max_iter": 30}).version
    pred = fc.predict(pool.head(50))
    assert (pred["p90"] >= pred["p50"]).all() and (pred["p50"] >= 0).all()
    assert (pred[["p50", "p90"]] == pred[["p50", "p90"]].round()).all().all()  # piezas enteras (trampa 0)


def test_category_codes_trap_and_the_fixed_vocabulary():
    """Codificar TÚ las categorías con el batch de la noche cambia los códigos; el vocabulario fijo no."""
    rng = np.random.default_rng(0)
    fmt = rng.choice(["express", "hiper", "super"], 3000)
    y = np.select([fmt == "hiper", fmt == "super"], [10.0, 5.0], 1.0) + rng.normal(0, 0.1, 3000)
    x = rng.normal(size=3000)
    night = pd.Series(["super"] * 5)  # esta noche solo hay supers en el batch
    # 1) El trampa: códigos de pandas como número. Al entrenar, super = 2; en el batch de la noche, 0.
    m = HistGradientBoostingRegressor(max_iter=50, random_state=0).fit(
        np.column_stack([pd.Categorical(fmt).codes, x]), y)
    diy = m.predict(np.column_stack([night.astype("category").cat.codes, np.zeros(5)]))
    assert np.allclose(diy, 1.0, atol=0.3)  # ¡lo trata como express! (código 0), sin error
    # 2) scikit-learn con from_dtype guarda su codificador y mapea por valor (comprobado con 1.9.1)
    m2 = HistGradientBoostingRegressor(max_iter=50, random_state=0, categorical_features="from_dtype").fit(
        pd.DataFrame({"fmt": pd.Categorical(fmt), "x": x}), y)
    assert np.allclose(m2.predict(pd.DataFrame({"fmt": night.astype("category"), "x": 0.0})), 5.0, atol=0.3)
    # 3) El vocabulario del modelo: misma categoría, mismo código siempre; lo desconocido → NaN
    vocab = {"format": ["express", "hiper", "super"], "region": ["centro"], "category": ["lacteos"]}
    rows = pd.DataFrame({"format": ["super", "nuevo"], "region": "centro", "category": "lacteos", "f": 1.0})
    mat = tq.to_matrix(rows, vocab, ["f", "format", "region", "category"])
    assert list(mat["format"].cat.categories) == vocab["format"]
    assert mat["format"].cat.codes.tolist() == [2, -1]  # "nuevo" no recibe el código de otra categoría


def test_save_and_load_refuses_another_sklearn_version(cfg, tmp_path):
    data = make_synthetic(n_stores=2, n_skus=6, days=200, seed=3, events_cfg=cfg)
    pool, tests = _pool_and_tests(data, True)
    fc = tq.fit(pool, params={"max_iter": 30})
    path = tq.save(fc, tmp_path)
    back = tq.load(path)
    pd.testing.assert_frame_equal(fc.predict(tests), back.predict(tests))
    assert back.version == fc.version
    meta = json.loads((path / "meta.json").read_text())
    meta["sklearn_version"] = "0.0.1"
    (path / "meta.json").write_text(json.dumps(meta))
    with pytest.raises(RuntimeError, match="misma imagen"):
        tq.load(path)
