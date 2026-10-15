"""Reglas puras del orquestador (caso c14), sin Airflow: las usa forecast_nightly_dag.py y se prueban solas.

Por qué un archivo aparte: lo que decide algo (qué run_date toca, cuándo dejar de esperar datos, en qué
capacidad corre cada intento, qué dice la alerta de las 03:30) se prueba con pytest en cualquier venv; el
DAG solo cablea. Y el triggerer de Airflow tiene que poder importar el callback del Deadline Alert: este
archivo va en la carpeta de plugins (o en el bundle de DAGs), sin dependencias fuera de la biblioteca
estándar.

Las horas del caso (hora local de las tiendas):
  22:00 cierran las tiendas · 00:30 llegan las ventas al warehouse (las de mala conectividad, hasta la
  01:30) · 01:00 llega el inventario al cierre · 03:30 SLA de publicación · 03:45 guardia del fallback ·
  03:55 último momento para mover el puntero · 04:00 corre el ERP.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # el callback corre en el event loop del triggerer
import datetime as dt  # horas y fechas
import json  # cuerpo del POST a Alertmanager
import urllib.request  # sin dependencias: el triggerer no tiene por qué tener httpx
from typing import Any, Callable  # tipos
from zoneinfo import ZoneInfo  # hora local

TZ = ZoneInfo("America/Mexico_City")
DAG_START = dt.time(0, 30)  # el DAG arranca cuando llega la mayoría de las ventas
DATA_CUTOFF = dt.time(1, 30)  # después de esto ya no se espera a nadie: se imputa (el caso)
DEADLINE = dt.time(3, 30)  # SLA: pronóstico publicado
GUARD_AT = dt.time(3, 45)  # el guardia publica el fallback si nada se publicó
ERP_READS_AT = dt.time(4, 0)


def run_date_for(logical_date: dt.datetime) -> str:
    """logical_date del DAG → run_date (YYYY-MM-DD): el día local ANTERIOR al de la corrida.

    Con el timetable por defecto de Airflow 3 para un cron (CronTriggerTimetable) el logical_date ES la hora
    de disparo: la corrida de las 00:30 del 16 de octubre tiene logical_date = 16 de octubre 00:30 (hora
    local; Airflow lo guarda en UTC: 06:30). El último día de ventas cerrado es el 15: ese es el run_date.
    Trampa: la macro `ds` de Airflow formatea el logical_date en UTC; a las 18:00 o más tarde en la Ciudad
    de México ya es "mañana" en UTC. Aquí se convierte a la hora de las tiendas antes de restar el día.
    """
    local = logical_date.astimezone(TZ)
    return (local.date() - dt.timedelta(days=1)).isoformat()


def data_cutoff_for(logical_date: dt.datetime) -> dt.datetime:
    """La 01:30 local del día de la corrida (aware)."""
    return dt.datetime.combine(logical_date.astimezone(TZ).date(), DATA_CUTOFF, TZ)


def inputs_ready(reported: int, expected: int, now: dt.datetime, cutoff: dt.datetime) -> bool:
    """El sensor termina cuando reportaron todas las tiendas o cuando llegó el corte, lo que pase antes.

    Nunca "falla por datos incompletos": a la 01:30 sigue con lo que hay (el job imputa y el gate decide
    si es demasiado). Un sensor que falla a la 01:30 deja al ERP sin pronóstico por esperar a 3 tiendas.
    `expected` = 0 es una configuración rota (surtido vacío): no se da por listo y el timeout del sensor
    lo convierte en falla visible.
    """
    if expected <= 0:
        return False
    return reported >= expected or now >= cutoff


def capacity_for(try_number: int, max_tries: int) -> str:
    """Spot en los intentos normales y on-demand en el ÚLTIMO (el caso).

    En Airflow el primer intento tiene try_number = 1 y max_tries = retries: con retries = 1, el intento 2
    es el último. Spot ahorra casi todas las noches; pero si una interrupción tumba el primer intento, el
    reintento ya no tiene ventana para jugarse otra interrupción.
    """
    return "on-demand" if try_number > max_tries else "spot"


# ------------------------------------------------------------------- callback del Deadline Alert
def late_alert(dag_id: str, run_id: str, deadline_time: str, run_date: str) -> list[dict]:
    """Cuerpo para POST /api/v2/alerts de Alertmanager: una alerta, con los labels con los que se rutea."""
    return [{
        "labels": {"alertname": "ForecastRunLate", "severity": "page", "source": "airflow_deadline",
                   "dag_id": dag_id},
        "annotations": {
            "summary": f"{dag_id}: run_date {run_date} sin terminar a las 03:30 (deadline {deadline_time})",
            "description": "El guardia publica el fallback a las 03:45; el ERP lee a las 04:00. Revisa el run "
                           f"{run_id} en Airflow: ¿sensores esperando, reintento en on-demand, pod pendiente?",
        },
    }]


async def notify_forecast_late(context: dict | None = None, alertmanager_url: str = "http://alertmanager:9093",
                               post: Callable[[str, bytes], Any] | None = None, **_: Any) -> list[dict]:
    """Callback del Deadline Alert (AsyncCallback: corre en el triggerer).

    Airflow le pasa `context` con `dag_run` (los campos de la API: dag_id, dag_run_id, logical_date…) y
    `deadline` (id y deadline_time). Trampa: el triggerer corre todos sus triggers en UN event loop; una
    llamada de red bloqueante aquí congela los demás (los sensores diferidos de cualquier DAG que caigan en
    ese triggerer). Por eso el POST va en un thread (`asyncio.to_thread`) y con timeout corto.
    """
    ctx = context or {}
    run = ctx.get("dag_run", {})
    dag_id, run_id = run.get("dag_id", "forecast_nightly"), run.get("dag_run_id", "?")
    logical = run.get("logical_date")
    run_date = run_date_for(dt.datetime.fromisoformat(logical)) if logical else "?"
    body = late_alert(dag_id, run_id, str(ctx.get("deadline", {}).get("deadline_time", "?")), run_date)
    data = json.dumps(body).encode()
    poster = post or _post_json
    await asyncio.to_thread(poster, alertmanager_url.rstrip("/") + "/api/v2/alerts", data)
    return body


def _post_json(url: str, data: bytes) -> None:  # pragma: no cover - red de verdad
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5):
        pass
