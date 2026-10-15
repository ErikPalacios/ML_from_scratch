"""DAGs del pronóstico nocturno (caso c14), Airflow 3: `forecast_nightly` y `forecast_fallback_guard`.

NO se ejecutó: aquí no hay scheduler, Kubernetes ni warehouse. Se parseó con apache-airflow 3.3.2 +
apache-airflow-providers-cncf-kubernetes 10.22.0 (orchestration/tests/test_dag.py: imports, parámetros,
timetable, deadline y dependencias) y con `python -m py_compile`. Lo que decide algo vive en
nightly_rules.py, con sus tests.

La noche (hora de las tiendas, America/Mexico_City):

  00:30  forecast_nightly arranca. Dos sensores esperan datos completos: ventas de run_date y el
         inventario al cierre. Terminan cuando reportaron todas las tiendas o a la 01:30, lo que pase
         antes: a la 01:30 se sigue con lo que hay (el job imputa; el gate bloquea si falta > 5 %).
  ≈01:30 run_forecast: el job en su propia imagen (KubernetesPodOperator), en spot; si falla, UN
         reintento en on-demand (`capacity_for`). Tope de 90 min por intento: un reintento cabe en la
         ventana si el primero falla temprano.
         Si los dos intentos fallan → publish_fallback (trigger_rule all_failed): el pronóstico de ayer
         corrido un día.
  03:30  Deadline Alert: si el DAG run sigue corriendo, el callback avisa a Alertmanager. (Si el run
         TERMINÓ antes, aunque haya terminado en falla, Airflow borra el deadline y no avisa: para eso
         están ForecastRunFailed y FallbackForecastServed en Prometheus.)
  03:45  forecast_fallback_guard: si nada de esta noche está publicado, publica el fallback.
  03:55  el job ya no mueve el puntero de esta noche (run_forecast.PUBLISH_CUTOFF).
  04:00  el ERP lee forecast_current.

Airflow 3 y las "SLA": en Airflow 2 esto era `sla=` en la tarea; Airflow 3.0 quitó esa función y 3.1 trajo
los Deadline Alerts (marcados como experimentales en la documentación), que es lo que usa este DAG: el
deadline se calcula al crear el run (logical_date + 3 h = 03:30) y el callback corre en el triggerer.

Tres decisiones que se defienden en la entrevista:
- Airflow orquesta, no computa: el job corre en su imagen (pandas, scikit-learn, el modelo) fijada por
  digest; los workers de Airflow no cargan dependencias de ML ni memoria de features.
- catchup=False y max_active_runs=1: un pronóstico de una noche pasada no sirve para pedir hoy, y dos
  noches a la vez se pelearían el puntero (el job además usa compare-and-swap).
- El run queda "verde" aunque se haya servido el fallback (la hoja publish_fallback terminó bien). La
  verdad operativa está en las métricas del job (FallbackForecastServed), no en el color del DAG.

No incluido: fijar la versión del modelo al arrancar. En producción, una tarea previa resuelve el alias
`champion` del registry a una versión concreta y la pasa al job como argumento, para que una promoción a
las 02:00 no mezcle dos modelos en la misma noche. Aquí el job recibe el modelo por su interfaz
(`JobDeps.load_model`), y ni esa tarea ni el adaptador del registry están escritos.
"""

from __future__ import annotations  # anotaciones como texto

from datetime import timedelta  # intervalos

import pendulum  # zona horaria del schedule (la que usa Airflow)
from airflow.providers.cncf.kubernetes.operators.pod import KubernetesPodOperator  # el job en su imagen
from airflow.sdk import (  # API pública de Airflow 3 para escribir DAGs (Task SDK)
    DAG,
    AsyncCallback,
    Connection,
    DeadlineAlert,
    DeadlineReference,
    PokeReturnValue,
    TriggerRule,
    get_current_context,
    task,
)
from kubernetes.client import models as k8s  # requests/limits del pod (cliente oficial de Kubernetes)

import nightly_rules as rules  # reglas puras (mismo folder: el bundle de DAGs está en el sys.path)

TZ = pendulum.timezone("America/Mexico_City")  # el cron "30 0 * * *" se lee en hora de las tiendas
# Imagen del job fijada por DIGEST, no por tag: un tag se mueve, y el modelo y su scikit-learn no (M5).
IMAGE = "registry.example.com/forecasting/forecast-job@sha256:0000000000000000000000000000000000000000000000000000000000000000"
NAMESPACE = "forecasting"
WAREHOUSE_CONN = "warehouse"  # conexión de Airflow al warehouse (secreto en el backend de secretos)
ALERTMANAGER = "http://alertmanager.monitoring:9093"

# Completitud: tiendas activas con ventas (o inventario) de run_date vs tiendas activas. ILUSTRATIVO: el
# nombre de las tablas es el del caso; el estilo de parámetros (%(run_date)s) depende del driver.
SQL_SALES = """
SELECT (SELECT COUNT(DISTINCT store_id) FROM sales_daily WHERE date = %(run_date)s),
       (SELECT COUNT(*) FROM store_attrs WHERE is_active)
"""
SQL_STOCK = """
SELECT (SELECT COUNT(DISTINCT store_id) FROM stock_daily WHERE date = %(run_date)s),
       (SELECT COUNT(*) FROM store_attrs WHERE is_active)
"""


def _poke(sql: str) -> PokeReturnValue:
    """Un poke del sensor: cuenta tiendas y decide con nightly_rules.inputs_ready."""
    ctx = get_current_context()
    logical = ctx["logical_date"]
    hook = Connection.get(WAREHOUSE_CONN).get_hook()  # el hook del tipo de conexión (Postgres, Snowflake…)
    reported, expected = hook.get_first(sql, parameters={"run_date": rules.run_date_for(logical)})
    done = rules.inputs_ready(int(reported), int(expected), pendulum.now(TZ), rules.data_cutoff_for(logical))
    return PokeReturnValue(is_done=done, xcom_value={"reported": int(reported), "expected": int(expected)})


def job_pod(task_id: str, command: str, cpu: str, memory: str, capacity: str | None = None,
            **kwargs) -> KubernetesPodOperator:
    """Un pod con el job (`python run_forecast.py <command> --run-date …`) y sus recursos.

    `capacity` fijo (p. ej. "on-demand") o, si es None, spot en los intentos normales y on-demand en el
    último (`capacity_for`, como macro: node_selector es un campo con plantilla en el operador).
    """
    cap = capacity or "{{ capacity_for(ti.try_number, ti.max_tries) }}"
    return KubernetesPodOperator(
        task_id=task_id,
        name=f"forecast-{command}",
        namespace=NAMESPACE,
        image=IMAGE,
        cmds=["python", "run_forecast.py"],
        arguments=[command, "--run-date", "{{ run_date_for(logical_date) }}"],
        node_selector={"karpenter.sh/capacity-type": cap},  # label de capacidad de Karpenter (M6)
        container_resources=k8s.V1ResourceRequirements(
            requests={"cpu": cpu, "memory": memory},
            limits={"memory": memory},  # sin límite de CPU: el job usa todos los cores que pidió
        ),
        env_vars={"OMP_NUM_THREADS": cpu},  # OpenMP cuenta los cores del NODO, no los requests del pod
        get_logs=True,
        on_finish_action="delete_succeeded_pod",  # el pod que falla se queda para leerlo
        **kwargs,
    )


DEADLINE = DeadlineAlert(
    reference=DeadlineReference.DAGRUN_LOGICAL_DATE,  # con CronTriggerTimetable = la hora de disparo (00:30)
    interval=timedelta(hours=3),  # 00:30 + 3 h = 03:30, el SLA del caso
    callback=AsyncCallback(rules.notify_forecast_late, kwargs={"alertmanager_url": ALERTMANAGER}),
)
MACROS = {"run_date_for": rules.run_date_for, "capacity_for": rules.capacity_for}

with DAG(
    dag_id="forecast_nightly",
    schedule="30 0 * * *",  # cron → CronTriggerTimetable en Airflow 3: logical_date = 00:30 de cada día
    start_date=pendulum.datetime(2026, 10, 1, tz=TZ),
    catchup=False,
    max_active_runs=1,
    deadline=DEADLINE,
    user_defined_macros=MACROS,
    default_args={"owner": "forecasting", "retries": 0},
    tags=["c14", "forecast", "batch"],
    doc_md=__doc__,
) as nightly:

    # mode="reschedule": entre pokes el sensor libera su slot de worker (esperar 1 h no ocupa un worker).
    # timeout = el respaldo si algo se cuelga: inputs_ready ya termina a la 01:30. Un sensor que vence su
    # timeout falla SIN reintentos (AirflowSensorTimeout), y entonces el job queda upstream_failed y corre
    # el fallback.
    @task.sensor(poke_interval=300, timeout=2 * 3600, mode="reschedule", retries=2, retry_delay=timedelta(minutes=2))
    def wait_sales() -> PokeReturnValue:
        return _poke(SQL_SALES)

    @task.sensor(poke_interval=300, timeout=2 * 3600, mode="reschedule", retries=2, retry_delay=timedelta(minutes=2))
    def wait_stock() -> PokeReturnValue:
        return _poke(SQL_STOCK)

    # Recursos ILUSTRATIVOS de un nodo grande con Polars/DuckDB para 4.8 M series (el caso estima 20–40 min
    # de features); con Spark, este pod solo lanza el job del cluster y espera.
    forecast = job_pod("run_forecast", "nightly", cpu="32", memory="256Gi",
                       retries=1, retry_delay=timedelta(minutes=2), execution_timeout=timedelta(minutes=90))
    # El fallback lee la partición de ayer y calcula el naive: chico, siempre on-demand y con reintentos.
    fallback = job_pod("publish_fallback", "fallback", cpu="4", memory="32Gi", capacity="on-demand",
                       trigger_rule=TriggerRule.ALL_FAILED, retries=2, retry_delay=timedelta(minutes=1),
                       execution_timeout=timedelta(minutes=15))

    [wait_sales(), wait_stock()] >> forecast >> fallback


with DAG(
    dag_id="forecast_fallback_guard",
    schedule="45 3 * * *",  # 03:45: después del SLA y antes de que el ERP lea
    start_date=pendulum.datetime(2026, 10, 1, tz=TZ),
    catchup=False,
    max_active_runs=1,
    user_defined_macros=MACROS,
    default_args={"owner": "forecasting"},
    tags=["c14", "forecast", "guard"],
) as guard:
    # Idempotente: si esta noche ya hay algo publicado (modelo o fallback), no hace nada. Existe porque el
    # Deadline Alert AVISA pero no publica, y un DAG atorado (sensor colgado, pod Pending sin nodos) no
    # llega a su propia tarea de fallback.
    job_pod("ensure_published", "ensure-published", cpu="4", memory="32Gi", capacity="on-demand",
            retries=1, retry_delay=timedelta(minutes=1), execution_timeout=timedelta(minutes=9))
