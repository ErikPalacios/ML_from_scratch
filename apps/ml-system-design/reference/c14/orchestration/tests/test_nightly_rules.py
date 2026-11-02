"""Tests de las reglas del orquestador (sin Airflow): run_date, sensor, capacidad y el callback de las 03:30."""

import asyncio
import datetime as dt
import json

import nightly_rules as r

UTC = dt.timezone.utc


def local(y, m, d, hh, mm):
    return dt.datetime(y, m, d, hh, mm, tzinfo=r.TZ)


def test_run_date_is_the_previous_local_day():
    # La corrida de las 00:30 del 16 de octubre (06:30 UTC) pronostica con run_date = 15
    assert r.run_date_for(dt.datetime(2026, 10, 16, 6, 30, tzinfo=UTC)) == "2026-10-15"
    assert r.run_date_for(local(2026, 10, 16, 0, 30)) == "2026-10-15"
    # El guardia de las 03:45 del 16 también trabaja sobre el 15
    assert r.run_date_for(local(2026, 10, 16, 3, 45)) == "2026-10-15"


def test_the_utc_date_trap():
    # Una corrida manual a las 19:00 del 15 (hora local) ya es 16 en UTC: `ds` diría 16; el run_date es 14
    manual = local(2026, 10, 15, 19, 0)
    assert manual.astimezone(UTC).date() == dt.date(2026, 10, 16)
    assert r.run_date_for(manual) == "2026-10-14"


def test_sensor_waits_for_everyone_or_until_the_cutoff():
    logical = local(2026, 10, 16, 0, 30)
    cutoff = r.data_cutoff_for(logical)
    assert cutoff == local(2026, 10, 16, 1, 30)
    assert r.inputs_ready(400, 400, local(2026, 10, 16, 0, 35), cutoff)  # todas: listo temprano
    assert not r.inputs_ready(396, 400, local(2026, 10, 16, 1, 25), cutoff)  # faltan 4: espera
    assert r.inputs_ready(396, 400, local(2026, 10, 16, 1, 30), cutoff)  # corte: sigue con lo que hay
    assert r.inputs_ready(120, 400, local(2026, 10, 16, 1, 31), cutoff)  # aunque falte mucho: el gate decide
    assert not r.inputs_ready(0, 0, local(2026, 10, 16, 2, 0), cutoff)  # surtido vacío: configuración rota


def test_spot_first_on_demand_last():
    assert r.capacity_for(1, 1) == "spot"  # primer intento (retries = 1)
    assert r.capacity_for(2, 1) == "on-demand"  # el último
    assert r.capacity_for(1, 0) == "on-demand"  # sin reintentos, el único intento es el último


def test_deadline_callback_posts_one_alert_without_blocking_the_loop():
    sent = []
    ctx = {"dag_run": {"dag_id": "forecast_nightly", "dag_run_id": "scheduled__2026-10-16T06:30:00+00:00",
                       "logical_date": "2026-10-16T06:30:00Z"},
           "deadline": {"id": "d1", "deadline_time": "2026-10-16T09:30:00+00:00"}}
    body = asyncio.run(r.notify_forecast_late(context=ctx, alertmanager_url="http://am:9093/",
                                              post=lambda url, data: sent.append((url, json.loads(data)))))
    assert sent[0][0] == "http://am:9093/api/v2/alerts"
    alert = sent[0][1][0]
    assert alert["labels"] == {"alertname": "ForecastRunLate", "severity": "page",
                               "source": "airflow_deadline", "dag_id": "forecast_nightly"}
    assert "run_date 2026-10-15" in alert["annotations"]["summary"] and body == sent[0][1]
