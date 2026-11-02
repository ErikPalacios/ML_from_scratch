"""Tests del job nocturno: cada test es una noche (o dos) con fakes de warehouse, lake, puntero y Pushgateway.

Los adaptadores locales (LocalPartitionStore, LocalPointer) son de verdad: escriben Parquet y JSON en una
carpeta temporal con rename atómico. El modelo es el GBDT de cuantiles entrenado con datos sintéticos.
"""

import datetime as dt
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

import build_features as bf
import calendar_mx as cm
import run_forecast as rf
import train_quantile as tq
from synthetic import make_synthetic

ROOT = Path(__file__).resolve().parents[2]
R = dt.date(2026, 6, 10)  # run_date de la primera noche (miércoles)
DAY = dt.timedelta(days=1)


@pytest.fixture(scope="module")
def cfg():
    return cm.load_events(ROOT / "features" / "retail_events.yaml")


@pytest.fixture(scope="module")
def data(cfg):
    # 25 tiendas: 1 tienda sin datos = 4 % (pasa el gate), 2 = 8 % (lo bloquea)
    return make_synthetic(n_stores=25, n_skus=8, start="2025-12-01", days=345, seed=5, events_cfg=cfg)


@pytest.fixture(scope="module")
def model_path(data, tmp_path_factory):
    end = pd.Timestamp("2026-06-01")
    panel = bf.build_panel(data.sales, data.stock, data.series, data.sales["date"].min(), end)
    origins = pd.date_range("2026-01-05", end - pd.Timedelta(days=1), freq="7D")
    pool = bf.training_frame(panel, origins, data.calendar, data.promo, data.store_attrs, data.sku_attrs,
                             data.sales, data.stock)
    fc = tq.fit(pool[pool["target_date"] <= end], {"max_iter": 60, "learning_rate": 0.15})
    return tq.save(fc, tmp_path_factory.mktemp("model"))


class Clock:
    """Reloj inyectable: por defecto, las 02:00 locales de la noche de `run_date`."""

    def __init__(self, run_date=R, hh=2, mm=0):
        self.set(run_date, hh, mm)

    def set(self, run_date, hh, mm):
        self.t = dt.datetime.combine(run_date + DAY, dt.time(hh, mm), rf.TZ).astimezone(dt.timezone.utc)

    def __call__(self):
        return self.t


class Sink:
    """Pushgateway falso: guarda cada registro empujado (uno por intento)."""

    def __init__(self, fail=False):
        self.pushes, self.fail = [], fail

    def push(self, registry):
        if self.fail:
            raise ConnectionError("pushgateway caído")
        self.pushes.append(registry)

    def last(self, name, **labels):
        """El último valor empujado de una métrica (como lo vería Prometheus en el Pushgateway)."""
        for reg in reversed(self.pushes):
            v = reg.get_sample_value(name, labels)
            if v is not None:
                return v
        return None

    def names(self):
        return {m.name for reg in self.pushes for m in reg.collect()}


def make_deps(tmp_path, data, model_path, cfg, reported=None, clock=None, sink=None, load_model=None):
    return rf.JobDeps(
        warehouse=rf.TableWarehouse(data, reported),
        store=rf.LocalPartitionStore(tmp_path / "forecast_daily"),
        publisher=rf.LocalPointer(tmp_path / "forecast_current.json"),
        load_model=load_model or (lambda: tq.load(model_path)),
        events_cfg=cfg, metrics=sink or Sink(), clock=clock or Clock(),
    )


def stores(data, minus=()):
    return set(data.store_attrs["store_id"]) - set(minus)


def n_series(d, run_date):
    """Series activas esa noche (los SKUs nuevos del generador se listan a media historia)."""
    return len(d.warehouse.active_series(run_date))


def broken_model():
    raise RuntimeError("model.joblib corrupto")


class Racing(rf.LocalPointer):
    """Otro proceso movió el puntero entre la lectura y el swap: el compare-and-swap siempre pierde."""

    def compare_and_swap(self, expected, new):
        return False


class DeadWarehouse:
    """El warehouse no responde: cualquier lectura lanza."""

    def __getattr__(self, name):
        def boom(*args, **kwargs):
            raise ConnectionError("warehouse caído")
        return boom


def scaled(real, factor):
    """Un modelo que multiplica todo por `factor`: piezas contra cajas, o una feature que se fue a la mitad."""

    class Scaled:
        version = f"gbdt-q-x{factor}"

        def predict(self, rows):
            p = real.predict(rows)
            return p.assign(p50=p["p50"] * factor, p90=p["p90"] * factor)

    return Scaled


# ----------------------------------------------------------------------------- una noche normal
def test_a_normal_night_publishes_the_model(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg)
    out = rf.run_nightly(R, d)
    assert out.status == "published" and not out.published.fallback and out.gate.ok
    fc = d.store.read(out.published.partition)
    assert len(fc) == n_series(d, R) * 14 and sorted(fc["horizon"].unique()) == list(range(1, 15))
    assert (fc["target_date"] == fc["run_date"] + pd.to_timedelta(fc["horizon"], unit="D")).all()
    assert (fc["p90"] >= fc["p50"]).all() and (fc["p50"] >= 0).all() and not fc["fallback"].any()
    assert fc["model_version"].str.startswith("gbdt-q-").all()
    assert d.publisher.current() == out.published
    s = d.metrics
    assert s.last("forecast_published_fallback", reason="none") == 0
    assert s.last("forecast_published_run_date_seconds") == rf.run_date_epoch(R)
    assert s.last("forecast_validation_blocked") == 0 and s.last("forecast_input_stores_imputed") == 0
    assert s.last("forecast_last_success_timestamp_seconds") is not None
    assert s.last("forecast_last_failure_timestamp_seconds") is None  # ni siquiera como 0 (pushadd)


def test_rerunning_the_same_night_is_idempotent(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg)
    first, second = rf.run_nightly(R, d), rf.run_nightly(R, d)
    assert second.status == "already_published" and second.published == first.published
    parts = list((tmp_path / "forecast_daily" / f"run_date={R}").iterdir())
    assert [p.name for p in parts] == ["part-" + first.published.partition.split("/")[1]]  # una sola versión


# ------------------------------------------------------------------------------ datos incompletos
def test_one_missing_store_is_imputed_and_flagged(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg, reported={R: stores(data, minus=["T007"])})
    out = rf.run_nightly(R, d)
    assert out.status == "published" and out.imputed_stores == ["T007"]  # 1 de 25 = 4 %: pasa el gate
    fc = d.store.read(out.published.partition)
    assert fc.loc[fc["store_id"] == "T007", "imputed_input"].all()
    assert not fc.loc[fc["store_id"] != "T007", "imputed_input"].any()
    assert d.metrics.last("forecast_input_stores_imputed") == 1


def test_too_many_missing_stores_block_and_serve_the_fallback(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg, reported={R: stores(data, minus=["T001", "T002"])})
    out = rf.run_nightly(R, d)
    assert out.gate.failed == ["imputed_stores"]  # 2 de 25 = 8 % > 5 %
    assert out.status == "published" and out.published.fallback and out.published.reason == "validation_blocked"
    fc = d.store.read(out.published.partition)
    assert (fc["model_version"] == "seasonal_naive").all()  # no había nada publicado antes: todo naive
    s = d.metrics
    assert s.last("forecast_validation_blocked") == 1
    assert s.last("forecast_validation_failed_checks", check="imputed_stores") == 1
    assert s.last("forecast_published_fallback", reason="validation_blocked") == 1


# ------------------------------------------------------------------------------- el fallback
def test_model_failure_serves_yesterday_shifted(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg)
    night1 = rf.run_nightly(R, d)
    yesterday = d.store.read(night1.published.partition)

    d.load_model, d.clock = broken_model, Clock(R + DAY)
    out = rf.run_nightly(R + DAY, d)
    assert out.published.fallback and out.published.reason == "prediction_error"
    fc = d.store.read(out.published.partition)
    assert len(fc) == n_series(d, R + DAY) * 14 and fc["fallback"].all()
    m = fc.merge(yesterday, on=["store_id", "sku_id", "target_date"], suffixes=("", "_y"))
    assert sorted(m["horizon"].unique()) == list(range(1, 14))  # los 2…14 de ayer son los 1…13 de hoy
    assert (m["horizon"] == m["horizon_y"] - 1).all()
    np.testing.assert_allclose(m["p50"], m["p50_y"])  # mismo día pronosticado, mismo número
    assert (fc.loc[fc["horizon"] == 14, "model_version"] == "seasonal_naive").all()
    assert d.metrics.last("forecast_published_fallback", reason="prediction_error") == 1


def test_two_bad_nights_shift_two_days(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg)
    good = rf.run_nightly(R, d)
    version = d.store.read(good.published.partition)["model_version"].iloc[0]
    d.load_model = broken_model
    for k in (1, 2):
        d.clock = Clock(R + k * DAY)
        rf.run_nightly(R + k * DAY, d)
    fc = d.store.read(d.publisher.current().partition)
    assert fc["fallback"].all() and len(fc) == n_series(d, R + 2 * DAY) * 14  # un SKU nuevo de hoy: todo naive
    from_model = fc[fc["model_version"] == version]
    assert sorted(from_model["horizon"].unique()) == list(range(1, 13))  # los 3…14 de hace dos noches


def test_a_broken_scale_is_blocked_by_the_category_band(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg)
    rf.run_nightly(R, d)
    real = tq.load(model_path)

    class TenX:  # el bug clásico: el modelo nuevo pronostica cajas como si fueran piezas (×10)
        version = "gbdt-q-casesbug"

        def predict(self, rows):
            p = real.predict(rows)
            return p.assign(p50=p["p50"] * 10, p90=p["p90"] * 10)

    d.load_model, d.clock = TenX, Clock(R + DAY)
    out = rf.run_nightly(R + DAY, d)
    assert "category_band" in out.gate.failed  # aunque haya promos o eventos: 10× no se explica
    assert out.published.fallback and out.published.reason == "validation_blocked"
    assert d.metrics.last("forecast_validation_failed_checks", check="category_band") >= 1


def test_a_uniform_error_is_blocked_on_a_night_without_events(tmp_path, data, model_path, cfg):
    """×2 o ×0.45 en todo: sin feriado ni campaña en los 7 días pronosticados, la banda de ±30 % lo atrapa.

    El 5 de octubre de 2026, el último feriado (16 de septiembre) está en las semanas de referencia: eso ya
    no "explica" nada, porque la referencia es la mediana de 4 mismos días y lo amortigua.
    """
    night = dt.date(2026, 10, 5)
    real = tq.load(model_path)
    ok = rf.run_nightly(night, make_deps(tmp_path / "x1", data, model_path, cfg, clock=Clock(night)))
    assert ok.gate.ok and not ok.published.fallback  # el modelo de verdad pasa esa misma noche
    for factor in (2.0, 0.45):
        d = make_deps(tmp_path / f"x{factor}", data, model_path, cfg, clock=Clock(night),
                      load_model=scaled(real, factor))
        out = rf.run_nightly(night, d)
        assert "category_band" in out.gate.failed, factor
        assert out.published.fallback and out.published.reason == "validation_blocked"


# --------------------------------------------------------------- el guardia y las reglas del puntero
def test_guard_then_model_before_the_cutoff_then_late_night(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg)
    guard = rf.ensure_published(R, d)  # 03:45 y no había nada: fallback
    assert guard.published.fallback and guard.published.reason == "guard"
    d.clock.set(R, 3, 50)  # el modelo termina a las 03:50 (antes del corte de las 03:55): reemplaza
    out = rf.run_nightly(R, d)
    assert out.status == "published" and not d.publisher.current().fallback
    assert rf.ensure_published(R, d).status == "nothing_to_do"  # el guardia ya no toca la noche
    # Noche siguiente: el guardia publica y el modelo termina a las 04:10 → el ERP ya leyó
    d.clock = Clock(R + DAY, 3, 45)
    rf.ensure_published(R + DAY, d)
    d.clock.set(R + DAY, 4, 10)
    late = rf.run_nightly(R + DAY, d)
    assert late.status == "late_not_published" and d.publisher.current().fallback
    assert d.metrics.last("forecast_late_not_published") == 1


def test_an_old_night_never_replaces_a_newer_one(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg, clock=Clock(R + DAY))
    newer = rf.run_nightly(R + DAY, d)
    d.clock = Clock(R)
    old = rf.run_nightly(R, d)  # un re-run tardío de la noche anterior
    assert old.status == "stale" and d.publisher.current() == newer.published


def test_missing_event_dates_fail_loudly_but_the_fallback_still_works(tmp_path, data, model_path, cfg):
    no_bf = yaml.safe_load(yaml.safe_dump(cfg))  # copia
    no_bf["announced"]["buen_fin"]["dates"].pop(2026)
    # El horizonte llega al 28 de octubre; con los 30 días que mira days_to_buen_fin, toca la ventana del
    # Buen Fin (1 de noviembre): la noche del 14 ya exige sus fechas, aunque ningún target caiga en noviembre
    night = dt.date(2026, 10, 14)
    d = make_deps(tmp_path, data, model_path, no_bf, clock=Clock(night))
    with pytest.raises(cm.MissingEventDates, match="buen_fin 2026"):
        rf.run_nightly(night, d)
    assert d.metrics.last("forecast_last_failure_timestamp_seconds") is not None
    out = rf.run_fallback(night, d)  # lo que hace el DAG: el fallback no necesita fechas de eventos
    assert out.published.fallback and out.published.reason == "job_failed"
    assert d.metrics.last("forecast_last_success_timestamp_seconds") > d.metrics.last(
        "forecast_last_failure_timestamp_seconds") - 1  # ForecastRunFailed se resuelve con el fallback


def test_the_dag_fallback_survives_a_dead_warehouse(tmp_path, data, model_path, cfg):
    """El job truena porque el warehouse no responde; el fallback del DAG no lo necesita: publica lo corrido."""
    d = make_deps(tmp_path, data, model_path, cfg)
    yesterday = d.store.read(rf.run_nightly(R, d).published.partition)
    d.warehouse, d.clock = DeadWarehouse(), Clock(R + DAY)
    with pytest.raises(ConnectionError):
        rf.run_nightly(R + DAY, d)
    out = rf.run_fallback(R + DAY, d)
    assert out.published.fallback and out.published.reason == "job_failed"
    fc = d.store.read(out.published.partition)
    assert sorted(fc["horizon"].unique()) == list(range(1, 14)) and fc["fallback"].all()  # sin naive: 1…13
    m = fc.merge(yesterday, on=["store_id", "sku_id", "target_date"], suffixes=("", "_y"))
    assert len(m) == len(fc) and (m["horizon"] == m["horizon_y"] - 1).all()
    np.testing.assert_allclose(m["p50"], m["p50_y"])
    assert rf.ensure_published(R + DAY, d).status == "nothing_to_do"  # el guardia ya no toca la noche


def test_the_guard_never_builds_features_and_its_naive_is_the_same(tmp_path, data, model_path, cfg, monkeypatch):
    """El guardia (y el fallback del DAG) no arman features: el día 14 sale de 28 días de ventas e inventario,
    con la MISMA definición de lags que las features, así que da lo mismo que el naive del job."""
    d = make_deps(tmp_path, data, model_path, cfg)
    rf.run_nightly(R, d)
    night = R + DAY
    rows = rf._features(night, d, d.warehouse.active_series(night))[0]  # lo que haría el job, para comparar

    def no_features(*args, **kwargs):
        raise AssertionError("el fallback armó features")

    monkeypatch.setattr(rf, "_features", no_features)
    d.clock = Clock(night, 3, 45)
    out = rf.ensure_published(night, d)
    assert out.published.reason == "guard"
    fc = d.store.read(out.published.partition)
    assert len(fc) == n_series(d, night) * 14  # el día 14 de todas las series, del naive sin features
    full = rf.naive_forecast(rows)
    day14 = fc[fc["horizon"] == 14].merge(full[full["horizon"] == 14], on=["store_id", "sku_id"], suffixes=("", "_f"))
    assert len(day14) == n_series(d, night)
    np.testing.assert_array_equal(day14["p50"], day14["p50_f"])
    np.testing.assert_array_equal(day14["p90"], day14["p90_f"])


def test_yesterdays_block_does_not_survive_a_night_that_fails_early(tmp_path, data, model_path, cfg):
    """Con pushadd, el 1 de ForecastValidationBlocked se quedaría en el Pushgateway si la noche siguiente falla
    antes de validar (warehouse caído, fechas de eventos): el job empuja el 0 antes de su primera lectura."""
    d = make_deps(tmp_path, data, model_path, cfg, reported={R: stores(data, minus=["T001", "T002"])})
    assert rf.run_nightly(R, d).gate.failed == ["imputed_stores"]
    assert d.metrics.last("forecast_validation_blocked") == 1
    d.warehouse, d.clock = DeadWarehouse(), Clock(R + DAY)
    with pytest.raises(ConnectionError):
        rf.run_nightly(R + DAY, d)
    assert d.metrics.last("forecast_validation_blocked") == 0  # ya no dispara por la noche de ayer
    assert d.metrics.last("forecast_last_failure_timestamp_seconds") is not None  # ForecastRunFailed sí


def test_a_concurrent_swap_is_a_conflict_not_an_overwrite(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg)

    d.publisher = Racing(tmp_path / "forecast_current.json")
    with pytest.raises(rf.PublishConflict):
        rf.run_nightly(R, d)
    assert d.metrics.last("forecast_last_failure_timestamp_seconds") is not None


def test_a_dead_pushgateway_does_not_change_the_outcome(tmp_path, data, model_path, cfg):
    d = make_deps(tmp_path, data, model_path, cfg, sink=Sink(fail=True))
    assert rf.run_nightly(R, d).status == "published"


# ------------------------------------------------------------------------------ piezas puras
def test_shift_forecast_by_hand():
    p = pd.Timestamp("2026-06-10")
    prev = pd.DataFrame([{"run_date": p, "store_id": "T1", "sku_id": s, "target_date": p + pd.Timedelta(days=h),
                          "horizon": h, "p50": float(h), "p90": float(h) + 1, "model_version": "m1",
                          "imputed_input": False, "fallback": False, "new_item": False}
                         for s in ("A", "B") for h in range(1, 15)])
    rd = dt.date(2026, 6, 11)
    series = pd.DataFrame({"store_id": ["T1", "T1"], "sku_id": ["A", "C"]})  # B salió del surtido, C es nuevo
    naive = pd.DataFrame([{"run_date": pd.Timestamp(rd), "store_id": "T1", "sku_id": s,
                           "target_date": pd.Timestamp(rd) + pd.Timedelta(days=h), "horizon": h, "p50": 99.0,
                           "p90": 120.0, "model_version": "seasonal_naive", "imputed_input": False,
                           "fallback": True, "new_item": s == "C"} for s in ("A", "C") for h in range(1, 15)])
    out = rf.shift_forecast(prev, rd, series, naive)
    a = out[out["sku_id"] == "A"].set_index("horizon")
    assert list(a.index) == list(range(1, 15))
    assert a.loc[1, "p50"] == 2.0 and a.loc[13, "p50"] == 14.0  # el h = 2 de ayer es el h = 1 de hoy
    assert a.loc[14, "p50"] == 99.0 and a.loc[14, "model_version"] == "seasonal_naive"
    assert set(out["sku_id"]) == {"A", "C"} and (out.loc[out["sku_id"] == "C", "p50"] == 99.0).all()
    assert out["fallback"].all() and (out["run_date"] == pd.Timestamp(rd)).all()


def test_partitions_are_immutable_and_content_addressed(tmp_path):
    store = rf.LocalPartitionStore(tmp_path)
    df = pd.DataFrame({"store_id": ["T1"], "p50": [1.5]})
    a, b = store.write(R, df), store.write(R, df.copy())
    c = store.write(R, df.assign(p50=2.0))
    assert a == b != c
    names = sorted(p.name for p in (tmp_path / f"run_date={R}").iterdir())
    assert len(names) == 2 and all(n.startswith("part-") for n in names)  # sin temporales a medias
    pd.testing.assert_frame_equal(store.read(a), df)


def test_every_job_metric_in_the_alerts_exists(tmp_path, data, model_path, cfg):
    """Contrato: cada métrica forecast_* que usan las alertas (salvo las del job de evaluación) la empuja el job."""
    rules = yaml.safe_load((ROOT / "monitoring" / "alerts.yml").read_text())
    used = {n for g in rules["groups"] for rule in g["rules"]
            for n in re.findall(r"\b(forecast_[a-z0-9_]+)", rule["expr"]) if not n.startswith("forecast_eval_")}
    sink = Sink()
    d = make_deps(tmp_path, data, model_path, cfg, sink=sink)
    rf.run_nightly(R, d)  # éxito
    d.load_model, d.clock = broken_model, Clock(R + DAY)
    rf.run_nightly(R + DAY, d)  # fallback por error del modelo
    racing = make_deps(tmp_path / "otra", data, model_path, cfg, sink=sink)
    racing.publisher = Racing(tmp_path / "otra" / "forecast_current.json")
    with pytest.raises(rf.PublishConflict):
        rf.run_nightly(R, racing)  # falla: empuja el timestamp de la última falla
    assert used, "no se encontraron métricas en alerts.yml"
    assert used <= sink.names(), f"faltan en el job: {sorted(used - sink.names())}"
