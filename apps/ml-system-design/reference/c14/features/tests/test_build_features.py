"""Tests de build_features: sin leakage, días agotados enmascarados, faltante ≠ cero, plan de promos as-of."""

import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import build_features as bf
import calendar_mx as cm
from synthetic import make_synthetic

EVENTS = Path(__file__).resolve().parents[1] / "retail_events.yaml"
RUN = pd.Timestamp("2026-10-15")  # jueves; la noche del 15 al 16


@pytest.fixture(scope="module")
def cfg():
    return cm.load_events(EVENTS)


@pytest.fixture(scope="module")
def synth(cfg):
    return make_synthetic(n_stores=3, n_skus=8, start="2025-09-01", days=420, seed=7, events_cfg=cfg)


def tiny(oos_days=(), missing=None):
    """Una tienda T1 (y T2 si hace falta), dos SKUs, del 1 de agosto al 15 de octubre de 2026.
    A vende (día del año mod 5) unidades; B vende 2 cada día."""
    dates = pd.date_range("2026-08-01", RUN, freq="D")
    rows = []
    for store in ("T1", "T2"):
        for d in dates:
            rows.append({"store_id": store, "sku_id": "A", "date": d, "units": float(d.dayofyear % 5)})
            rows.append({"store_id": store, "sku_id": "B", "date": d, "units": 2.0})
    sales = pd.DataFrame(rows)
    sales = sales[sales["units"] > 0]  # el POS no registra los días sin venta
    stock = pd.DataFrame([{"store_id": "T1", "sku_id": "A", "date": pd.Timestamp(d), "oos_flag": True} for d in oos_days],
                         columns=["store_id", "sku_id", "date", "oos_flag"])
    series = pd.DataFrame({"store_id": ["T1", "T1", "T2", "T2"], "sku_id": ["A", "B", "A", "B"],
                           "listed_date": pd.Timestamp("2025-01-01")})
    stores = pd.DataFrame({"store_id": ["T1", "T2"], "format": "super", "region": "centro"})
    skus = pd.DataFrame({"sku_id": ["A", "B"], "category": ["lacteos", "abarrotes"], "perishable": [True, False],
                         "shelf_life_days": [10, 365]})
    promo = pd.DataFrame(columns=["store_id", "sku_id", "date", "price", "regular_price", "promo_flag"])
    panel = bf.build_panel(sales, stock, series, dates[0], RUN, missing)
    return sales, stock, series, stores, skus, promo, panel


def features(panel, cfg, stores, skus, promo, **kw):
    cal = cm.calendar_table(dt.date(2026, 7, 1), dt.date(2026, 11, 30), cfg)
    return bf.features_for_origin(panel, RUN, cal, promo, stores, skus, **kw)


def units_on(sales, store, sku, day):
    s = sales[(sales.store_id == store) & (sales.sku_id == sku) & (sales.date == pd.Timestamp(day))]
    return float(s["units"].sum())


# ------------------------------------------------------------------------------- regla 1: leakage
def test_no_feature_uses_data_after_run_date(synth):
    """Cambiar TODO lo posterior a run_date (ventas ×100, agotados al revés) no cambia ni una feature."""
    d = synth
    origin = pd.Timestamp("2026-06-30")
    after = d.sales["date"] > origin
    sales_poison = d.sales.copy()
    sales_poison.loc[after, "units"] = sales_poison.loc[after, "units"] * 100 + 7
    stock_poison = d.stock.copy()
    flip = stock_poison["date"] > origin
    stock_poison.loc[flip, "oos_flag"] = ~stock_poison.loc[flip, "oos_flag"]
    start = d.sales["date"].min()

    def feats(sales, stock, end):
        panel = bf.build_panel(sales, stock, d.series, start, end)
        return bf.features_for_origin(panel.until(origin), origin, d.calendar, d.promo, d.store_attrs, d.sku_attrs)

    base = feats(d.sales, d.stock, d.stock["date"].max())
    poisoned = feats(sales_poison, stock_poison, d.stock["date"].max())
    truncated = feats(d.sales[~after], d.stock[d.stock["date"] <= origin], origin)
    cols = bf.FEATURE_COLUMNS + ["new_item", "imputed_input"]
    pd.testing.assert_frame_equal(base[cols], poisoned[cols])
    pd.testing.assert_frame_equal(base[cols], truncated[cols])
    assert (base["target_date"] == origin + pd.to_timedelta(base["horizon"], unit="D")).all()
    assert sorted(base["horizon"].unique()) == list(range(1, 15))


def test_panel_slice_equals_a_panel_built_with_data_up_to_the_origin(synth):
    d = synth
    start, origin = d.sales["date"].min(), pd.Timestamp("2026-03-01")
    full = bf.build_panel(d.sales, d.stock, d.series, start, d.stock["date"].max()).until(origin)
    rebuilt = bf.build_panel(d.sales[d.sales["date"] <= origin], d.stock[d.stock["date"] <= origin],
                             d.series, start, origin)
    np.testing.assert_array_equal(full.units, rebuilt.units)
    np.testing.assert_array_equal(full.oos, rebuilt.oos)


def test_same_weekday_lags_are_the_case_lags(cfg):
    sales, stock, series, stores, skus, promo, panel = tiny()
    f = features(panel, cfg, stores, skus, promo)
    a = f[(f.store_id == "T1") & (f.sku_id == "A")].set_index("horizon")
    for h in (1, 5, 7):  # h ≤ 7: lags 7, 14, 21, 28 del target
        t = RUN + pd.Timedelta(days=h)
        for k in range(1, 5):
            assert a.loc[h, f"sw_lag_{k}"] == units_on(sales, "T1", "A", t - pd.Timedelta(days=7 * k))
    for h in (8, 14):  # h = 8…14: el target − 7 todavía no pasó → lags 14, 21, 28, 35
        t = RUN + pd.Timedelta(days=h)
        assert a.loc[h, "sw_lag_1"] == units_on(sales, "T1", "A", t - pd.Timedelta(days=14))
        assert a.loc[h, "sw_lag_4"] == units_on(sales, "T1", "A", t - pd.Timedelta(days=35))
    # un día sin renglón de venta (A vende 0 cuando día del año mod 5 = 0) es 0, no NaN
    assert (f["sw_lag_1"].notna()).all()


# --------------------------------------------------------------------------- regla 2: censura
def test_oos_days_are_masked_from_lags_and_rolling_means(cfg):
    oos_day = pd.Timestamp("2026-10-09")  # viernes: el sw_lag_1 del target del viernes 16 (h = 1)
    sales, stock, series, stores, skus, promo, panel = tiny(oos_days=[oos_day])
    f = features(panel, cfg, stores, skus, promo)
    a1 = f[(f.store_id == "T1") & (f.sku_id == "A") & (f.horizon == 1)].iloc[0]
    assert np.isnan(a1["sw_lag_1"])  # agotado: la venta de ese día no es demanda
    assert a1["oos_days_7"] == 1 and a1["oos_days_28"] == 1  # la "bandera" de los lags
    last7 = [units_on(sales, "T1", "A", RUN - pd.Timedelta(days=i)) for i in range(7)
             if RUN - pd.Timedelta(days=i) != oos_day]
    assert a1["roll_mean_7"] == pytest.approx(np.mean(last7))  # promedio de los otros 6 días
    assert a1["sw_mean_4"] == pytest.approx(np.nanmean([a1["sw_lag_2"], a1["sw_lag_3"], a1["sw_lag_4"]]))
    # La otra tienda no se contamina
    t2 = f[(f.store_id == "T2") & (f.sku_id == "A") & (f.horizon == 1)].iloc[0]
    assert t2["sw_lag_1"] == units_on(sales, "T2", "A", oos_day) and t2["oos_days_7"] == 0
    # Lo que pasa si ignoras la censura (solo para el test): el día agotado entra como demanda
    naive = features(panel, cfg, stores, skus, promo, mask_oos=False)
    n1 = naive[(naive.store_id == "T1") & (naive.sku_id == "A") & (naive.horizon == 1)].iloc[0]
    assert n1["sw_lag_1"] == units_on(sales, "T1", "A", oos_day) and n1["oos_days_7"] == 0


def test_targets_exclude_oos_days_and_days_before_listing(cfg):
    sales, stock, series, stores, skus, promo, panel = tiny()
    f = features(panel, cfg, stores, skus, promo)
    future = pd.DataFrame({"store_id": ["T1", "T1"], "sku_id": ["A", "B"],
                           "date": [RUN + pd.Timedelta(days=1)] * 2, "units": [3.0, 2.0]})
    oos = pd.DataFrame({"store_id": ["T1"], "sku_id": ["A"], "date": [RUN + pd.Timedelta(days=1)], "oos_flag": [True]})
    listed = series.assign(listed_date=[pd.Timestamp("2025-01-01"), RUN + pd.Timedelta(days=5),
                                        pd.Timestamp("2025-01-01"), pd.Timestamp("2025-01-01")])
    t = bf.attach_targets(f, pd.concat([sales, future]), oos, listed).set_index(["store_id", "sku_id", "horizon"])
    assert np.isnan(t.loc[("T1", "A", 1), "target"])  # agotado: no es target
    assert t.loc[("T1", "A", 1), "actual_units"] == 3.0 and t.loc[("T1", "A", 1), "target_oos"]
    assert np.isnan(t.loc[("T1", "B", 1), "target"])  # B se lista el día 20: antes no es demanda 0
    assert t.loc[("T2", "B", 1), "target"] == 0.0  # sin renglón de venta en una tienda que reportó = 0


# --------------------------------------------------------------------- regla 4: faltante ≠ cero
def test_missing_store_is_unknown_and_imputed_from_last_week(cfg):
    missing = pd.DataFrame({"store_id": ["T2"], "date": [RUN]})
    sales, stock, series, stores, skus, promo, panel = tiny(missing=missing)
    rows = panel.series.index[panel.series["store_id"] == "T2"]
    assert np.isnan(panel.units[rows, -1]).all()  # no reportó: NaN, no 0
    imputed = bf.impute_missing(panel)
    week_ago = [units_on(sales, "T2", s, RUN - pd.Timedelta(days=7)) for s in ("A", "B")]
    np.testing.assert_array_equal(imputed.units[rows, -1], week_ago)
    f = features(imputed, cfg, stores, skus, promo)
    assert f.loc[f.store_id == "T2", "imputed_input"].all()
    assert not f.loc[f.store_id == "T1", "imputed_input"].any()


# ------------------------------------------------------------- regla 3: el futuro que sí se conoce
def test_promo_plan_is_read_as_of_the_run_date(cfg):
    sales, stock, series, stores, skus, promo, panel = tiny()
    day = RUN + pd.Timedelta(days=3)
    plan = pd.DataFrame([
        # versión publicada antes de la noche: 20 % de descuento
        {"store_id": "T1", "sku_id": "B", "date": day, "price": 80.0, "regular_price": 100.0, "promo_flag": 1,
         "published_at": RUN - pd.Timedelta(days=10)},
        # rebaja de último minuto publicada DESPUÉS de run_date: esa noche nadie la conocía
        {"store_id": "T1", "sku_id": "B", "date": day, "price": 50.0, "regular_price": 100.0, "promo_flag": 1,
         "published_at": RUN + pd.Timedelta(days=2)},
    ])
    f = features(panel, cfg, stores, skus, plan)
    b3 = f[(f.store_id == "T1") & (f.sku_id == "B") & (f.horizon == 3)].iloc[0]
    assert b3["promo_flag"] == 1 and b3["discount_depth"] == pytest.approx(0.20)
    assert b3["price_ratio"] == pytest.approx(0.80)
    other = f[(f.store_id == "T1") & (f.sku_id == "B") & (f.horizon == 4)].iloc[0]
    assert other["promo_flag"] == 0 and other["price_ratio"] == 1.0  # sin renglón = precio regular
    with pytest.raises(ValueError, match="más de un renglón"):
        bf.promo_as_of(plan.drop(columns="published_at"), RUN)


def test_calendar_must_cover_every_target_date(cfg):
    sales, stock, series, stores, skus, promo, panel = tiny()
    short = cm.calendar_table(dt.date(2026, 7, 1), dt.date(2026, 10, 25), cfg)  # termina antes de RUN + 14
    with pytest.raises(ValueError, match="no cubre"):
        bf.features_for_origin(panel, RUN, short, promo, stores, skus)


def test_new_items_and_category_level(cfg):
    sales, stock, series, stores, skus, promo, panel = tiny()
    young = panel.series.assign(listed_date=[RUN - pd.Timedelta(days=10)] + [pd.Timestamp("2025-01-01")] * 3)
    from dataclasses import replace
    f = features(replace(panel, series=young), cfg, stores, skus, promo)
    t1a = f[(f.store_id == "T1") & (f.sku_id == "A")].iloc[0]
    assert t1a["new_item"] and t1a["series_age_days"] == 10
    assert not f[(f.store_id == "T1") & (f.sku_id == "B")].iloc[0]["new_item"]
    # nivel de categoría en la tienda: con un solo SKU por categoría, es su propio promedio de 28 días
    b = f[(f.store_id == "T1") & (f.sku_id == "B")].iloc[0]
    assert b["cat_store_mean_28"] == pytest.approx(b["roll_mean_28"]) == pytest.approx(2.0)


def test_share_of_slow_series_in_the_synthetic_data_is_like_the_case():
    """El caso: ≈ 60 % de las series vende < 1 unidad/día. El generador sintético se calibró para eso."""
    d = make_synthetic(n_stores=6, n_skus=40, days=200, seed=11)
    mean = d.truth.groupby(bf.KEYS)["demand"].mean()
    assert 0.45 <= (mean < 1).mean() <= 0.75
