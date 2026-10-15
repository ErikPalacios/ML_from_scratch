"""Tests del DAG con Airflow DE VERDAD (se saltan si no está instalado: el venv de requirements-dev no lo trae).

Para correrlos: un venv con orchestration/requirements.txt (Airflow 3.3.2 + el provider de Kubernetes, con el
archivo de constraints oficial) y `pytest orchestration/tests/test_dag.py`. Prueban que el archivo se importa,
la forma del DAG, el timetable (logical_date a las 00:30 locales → deadline a las 03:30), las plantillas y que
el DAG se serializa (lo que haría el procesador de DAGs). NO prueban que corra: no hay scheduler ni cluster.
"""

import importlib

import pytest

pytest.importorskip("airflow.sdk", reason="Airflow no está instalado (ver orchestration/requirements.txt)")
pytest.importorskip("airflow.providers.cncf.kubernetes", reason="falta el provider de Kubernetes")

import pendulum  # noqa: E402  (viene con Airflow)

import nightly_rules as r  # noqa: E402

TZ = "America/Mexico_City"


@pytest.fixture(scope="module")
def mod():
    return importlib.import_module("forecast_nightly_dag")


def test_two_dags_with_the_case_schedule(mod):
    n, g = mod.nightly, mod.guard
    assert (n.dag_id, g.dag_id) == ("forecast_nightly", "forecast_fallback_guard")
    assert type(n.timetable).__name__ == "CronTriggerTimetable"  # el default de Airflow 3 para un cron
    assert n.timetable.expression == "30 0 * * *" and g.timetable.expression == "45 3 * * *"
    assert str(n.timetable.timezone.name) == TZ
    assert n.catchup is False and n.max_active_runs == 1


def test_tasks_retries_and_trigger_rules(mod):
    n = mod.nightly
    t = {task.task_id: task for task in n.tasks}
    assert set(t) == {"wait_sales", "wait_stock", "run_forecast", "publish_fallback"}
    for s in ("wait_sales", "wait_stock"):
        assert t[s].mode == "reschedule" and t[s].timeout == 7200 and t[s].poke_interval == 300
    job = t["run_forecast"]
    assert job.upstream_task_ids == {"wait_sales", "wait_stock"}
    assert job.retries == 1 and job.execution_timeout == pendulum.duration(minutes=90)
    fb = t["publish_fallback"]
    assert fb.trigger_rule == "all_failed" and fb.upstream_task_ids == {"run_forecast"}
    assert fb.node_selector == {"karpenter.sh/capacity-type": "on-demand"}  # el fallback nunca en spot


def test_logical_date_and_deadline_land_at_0030_and_0330_local(mod):
    from airflow.timetables.base import TimeRestriction
    from airflow.timetables.trigger import CronTriggerTimetable  # el timetable del scheduler

    n = mod.nightly
    core = CronTriggerTimetable(n.timetable.expression, timezone=n.timetable.timezone)
    info = core.next_dagrun_info(last_automated_data_interval=None,
                                 restriction=TimeRestriction(earliest=pendulum.datetime(2026, 10, 15, 12, tz="UTC"),
                                                             latest=None, catchup=False))
    ld = info.logical_date
    assert pendulum.instance(ld).in_timezone(TZ).to_datetime_string() == "2026-10-16 00:30:00"
    (alert,) = n.deadline if isinstance(n.deadline, list) else [n.deadline]
    assert type(alert.reference).__name__ == "DagRunLogicalDateDeadline"
    assert pendulum.instance(ld + alert.interval).in_timezone(TZ).to_datetime_string() == "2026-10-16 03:30:00"
    assert alert.callback.path == "nightly_rules.notify_forecast_late"
    assert r.run_date_for(ld) == "2026-10-15"


def test_templates_render_run_date_and_capacity(mod):
    n = mod.nightly
    env = n.get_template_env()
    ld = pendulum.datetime(2026, 10, 16, 6, 30, tz="UTC")

    class TI:  # lo mínimo de `ti` que usa la plantilla
        max_tries = 1

        def __init__(self, try_number):
            self.try_number = try_number

    job = n.get_task("run_forecast")
    sel = job.node_selector["karpenter.sh/capacity-type"]
    render = lambda s, tn: env.from_string(s).render(logical_date=ld, ti=TI(tn), **n.user_defined_macros)  # noqa: E731
    assert render(sel, 1) == "spot" and render(sel, 2) == "on-demand"
    assert [render(a, 1) for a in job.arguments] == ["nightly", "--run-date", "2026-10-15"]


def test_dag_serializes_like_the_dag_processor_would(mod):
    from airflow.serialization.serialized_objects import DagSerialization

    for dag in (mod.nightly, mod.guard):
        data = DagSerialization.to_dict(dag)
        DagSerialization.from_dict(data)
    deadline = DagSerialization.to_dict(mod.nightly)["dag"]["deadline"][0]
    assert deadline["interval"]["__data__"] == 3 * 3600
