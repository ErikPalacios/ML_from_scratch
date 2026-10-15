"""Tests del backtest: métricas a mano, días agotados fuera, origen móvil sin leakage y el gate."""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import backtest as bt
import calendar_mx as cm
from synthetic import make_synthetic

EVENTS = Path(__file__).resolve().parents[2] / "features" / "retail_events.yaml"
FAST = {"max_iter": 120, "learning_rate": 0.1}  # menos árboles: segundos, mismas conclusiones (medido)


@pytest.fixture(scope="module")
def data():
    return make_synthetic(seed=0, events_cfg=cm.load_events(EVENTS))


def test_metrics_by_hand():
    f, a = [10, 0, 5], [8, 2, 5]
    assert bt.wape(f, a) == pytest.approx(4 / 15)  # |2| + |−2| + 0 sobre 15
    assert bt.bias(f, a) == pytest.approx(0.0)  # se compensan: el WAPE no, el sesgo sí
    assert bt.bias([12, 3, 6], a) == pytest.approx(6 / 15)  # pidió de más: +40 %
    assert bt.pinball(0.9, f, a) == pytest.approx((0.1 * 2 + 0.9 * 2 + 0) / 3)  # quedarse corto pesa 9×
    assert bt.pinball(0.5, f, a) == pytest.approx((1 + 1 + 0) / 3)  # q = 0.5: la mitad del error absoluto
    assert bt.coverage([12, 1, 5], a) == pytest.approx(2 / 3)  # 8 ≤ 12 sí, 2 ≤ 1 no, 5 ≤ 5 sí
    assert np.isnan(bt.wape([1, 2], [0, 0]))  # sin ventas no hay WAPE (no es 0 ni infinito)


def test_oos_and_unknown_days_do_not_count():
    df = pd.DataFrame({"target": [8.0, 2.0, 5.0, np.nan], "target_oos": [False, False, False, True],
                       "model_p50": [10, 0, 5, 500.0], "model_p90": [12, 1, 5, 900.0]})
    m = bt.metrics(df)
    assert m["n"] == 3 and m["wape"] == pytest.approx(4 / 15) and m["coverage_90"] == pytest.approx(2 / 3)


def test_segments_overlap_and_use_only_what_was_known_at_the_origin():
    df = pd.DataFrame({"target": [10.0, 1.0], "model_p50": [10.0, 3.0], "model_p90": [12.0, 4.0],
                       "perishable": [1, 0], "roll_mean_28": [5.0, 0.2], "promo_flag": [1, 0],
                       "new_item": [False, True]})
    seg = bt.metrics_by_segment(df).set_index("segment")
    assert seg.loc["all", "n"] == 2 and seg.loc["fresh", "n"] == 1 and seg.loc["promo", "n"] == 1
    assert seg.loc["slow", "wape"] == pytest.approx(2.0)  # 1 pieza real, pronóstico 3: WAPE 200 %
    assert seg.loc["fast", "wape"] == 0.0


def test_rolling_origins_are_weekly_and_end_at_the_last():
    o = bt.rolling_origins("2026-10-11", n=8)
    assert len(o) == 8 and o[-1] == pd.Timestamp("2026-10-11") and o[0] == pd.Timestamp("2026-08-23")
    assert all((b - a).days == 7 for a, b in zip(o, o[1:]))


class SpyModel:
    """Fake: devuelve el seasonal naive y recuerda qué vio el entrenamiento."""

    version = "spy"

    def predict(self, rows):
        from train_quantile import seasonal_naive

        return seasonal_naive(rows)


def test_training_never_sees_targets_after_the_origin(data):
    seen = []

    def spy_fit(rows, params):
        seen.append((rows["run_date"].max(), rows["target_date"].max(), rows["run_date"].min()))
        return SpyModel()

    res = bt.run_backtest(data, n_origins=3, fit_fn=spy_fit)
    origins = sorted(res["origin"].unique())
    assert len(seen) == 3
    for (max_run, max_target, min_run), o in zip(seen, origins):
        assert max_target <= o  # la trampa: filas de orígenes recientes con target después de O
        assert max_run < o
        assert min_run >= o - pd.Timedelta(days=364)  # ventana de 52 semanas
    # y sí usa lo más reciente que se podía: filas con target_date exactamente en O
    assert any(t == o for (_, t, _), o in zip(seen, origins))
    assert (res["target_date"] > res["origin"]).all()


def test_model_beats_the_seasonal_naive_and_the_p90_covers(data):
    res = bt.run_backtest(data, n_origins=2, params=FAST)
    model = bt.metrics_by_segment(res, "model").set_index("segment")
    naive = bt.metrics_by_segment(res, "naive").set_index("segment")
    assert model.loc["all", "wape"] < naive.loc["all", "wape"] - 0.10  # ≈ 0.61 contra ≈ 0.86 (medido)
    assert model.loc["all", "pinball_90"] < naive.loc["all", "pinball_90"]
    # El P90 de un conteo es un entero: cubre ≥ 90 % por construcción (≈ 0.95 medido; 0.97 en las lentas)
    assert 0.88 <= model.loc["all", "coverage_90"] <= 0.97
    # El sesgo del P50 es NEGATIVO por construcción con demanda asimétrica: la mediana < la media.
    # En las series lentas, la mediana es 0 (la mitad de los días no vende nada).
    assert model.loc["all", "bias"] < 0 and model.loc["slow", "bias"] < model.loc["fast", "bias"]


def _table(**wapes):
    return pd.DataFrame([{"segment": s, "n": n, "wape": w} for s, (w, n) in wapes.items()])


def test_promotion_gate():
    champion = _table(all=(0.40, 5000), fresh=(0.45, 2000), dry=(0.35, 3000), fast=(0.30, 2500),
                      slow=(0.60, 2500), promo=(0.50, 300), no_promo=(0.39, 4700))
    better = champion.assign(wape=champion["wape"] - 0.03)
    ok, reasons, skipped = bt.promotion_gate(better, champion)
    assert ok and not reasons and not skipped
    # mejora el total pero los frescos empeoran 3 puntos: bloquea (sube la merma)
    worse_fresh = better.copy()
    worse_fresh.loc[worse_fresh.segment == "fresh", "wape"] = 0.48
    ok, reasons, _ = bt.promotion_gate(worse_fresh, champion)
    assert not ok and reasons[0].startswith("fresh")
    # 1.5 puntos peor en frescos: dentro de la tolerancia de 2
    slightly = better.copy()
    slightly.loc[slightly.segment == "fresh", "wape"] = 0.465
    assert bt.promotion_gate(slightly, champion)[0]
    # un segmento con pocas filas no vota, pero se reporta
    few = better.copy()
    few.loc[few.segment == "promo", ["wape", "n"]] = [0.90, 50]
    ok, reasons, skipped = bt.promotion_gate(few, champion)
    assert ok and skipped == ["promo"]
    # no mejorar el total ya bloquea
    assert not bt.promotion_gate(champion, champion)[0]
