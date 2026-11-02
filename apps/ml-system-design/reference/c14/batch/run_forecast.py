"""Job nocturno del pronóstico (caso c14): de los datos de anoche a `forecast_current`, o al fallback.

La noche de punta a punta (run_date = último día de ventas cerrado; la noche del 15 al 16, run_date = 15):

 1. Completitud: qué tiendas reportaron ventas de run_date. Las que no, se imputan con su mismo día de la
    semana pasada (build_features.impute_missing) y sus filas llevan `imputed_input`. Esperar a la última
    tienda haría perder las 04:00; el gate decide si son demasiadas (> 5 %).
 2. Calendario: si el horizonte, con los 30 días que mira hacia adelante `days_to_<evento>`, toca la
    ventana del Buen Fin o del Hot Sale y faltan sus fechas, el job FALLA (calendar_mx.require_event_dates)
    y el DAG publica el fallback: mejor eso que un Buen Fin pronosticado como semana normal.
 3. Features point-in-time del origen run_date, horizontes 1–14 (build_features).
 4. Predicción P50/P90 con el modelo del registry. Si el modelo no carga o el predict lanza: fallback.
 5. Escritura de la partición run_date como un directorio INMUTABLE cuyo nombre es el hash del contenido:
    re-correr la noche con los mismos datos produce el mismo hash y no escribe nada (idempotente); con
    datos distintos (llegó la tienda que faltaba) escribe otra versión al lado.
 6. Validación de lo escrito (validate_output). Si bloquea: fallback.
 7. Publicación: un compare-and-swap del puntero `forecast_current` (el ERP solo lee a través de él).
    Write-audit-publish: nadie ve la partición hasta que el swap la apunta.

El fallback (`publish_fallback`): el último pronóstico publicado, corrido. Si era de ayer, los horizontes
2…14 pasan a 1…13 y el día 14 sale del seasonal naive; si eran dos noches malas, se corre 2 días; si no hay
nada publicado, todo es seasonal naive. Flag `fallback` = True. El ERP SIEMPRE recibe un pronóstico.
Cuando lo llaman el DAG o el guardia, el job ya falló, quizá por las features (memoria, `price_promo`, el
calendario), así que el fallback no las arma: su naive (`light_naive`) solo lee ventas e inventario de los
últimos 28 días. Si ni eso responde (warehouse caído), publica lo corrido: los horizontes 1…13.

Reglas del puntero (`publish`), cada una con su porqué:
- Idempotente: si ya apunta a lo mismo, no hace nada.
- Nunca hacia atrás: un run_date viejo no reemplaza uno nuevo (un re-run tardío de la noche anterior).
- Un fallback no reemplaza al pronóstico del modelo de la misma noche (el guardia de las 03:45 que corre
  después de un éxito).
- Después del corte (03:55: el ERP lee a las 04:00), lo de la misma noche ya no se cambia: el ERP ya pidió
  con eso y lo publicado debe ser lo que el ERP usó (auditoría). Un run_date más nuevo sí entra.

Interfaces (`Warehouse`, `PartitionStore`, `Publisher`, `MetricsSink`): las implementaciones reales
(warehouse, lake, vista con CAS, Pushgateway) no están aquí porque no se pudieron probar; las locales
(`LocalPartitionStore`, `LocalPointer`) son de verdad (archivos con rename atómico) y las usan los tests y
la demo. En el warehouse, el puntero es una fila de control con `UPDATE … WHERE partition = :esperado`
como compare-and-swap (una fila afectada = ganó). La vista: en motores con DDL transaccional (Postgres,
Redshift), `CREATE OR REPLACE VIEW forecast_current` en la misma transacción; en Snowflake (un DDL hace
commit implícito) o BigQuery (sus transacciones no admiten DDL sobre objetos permanentes), en un segundo
paso idempotente que el job repite si muere entre los dos, y que regenera la vista desde la fila de
control (no desde lo que el job cree que publicó: así dos jobs no la dejan apuntando al perdedor).

Métricas (empujadas al Pushgateway al terminar cada intento, con pushadd: solo se reemplazan las métricas
con el mismo nombre, así un intento fallido no borra el timestamp del último éxito). Nombres en
`JobMetrics`; las alertas de monitoring/alerts.yml las usan.
"""

from __future__ import annotations  # anotaciones como texto

import argparse  # CLI: nightly | fallback | ensure-published
import datetime as dt  # fechas y horas
import hashlib  # partición direccionada por contenido
import json  # el puntero local
import logging  # una línea por paso: el log del job es su primer runbook
import os  # rename atómico (os.replace)
import sys  # sys.exit en la CLI
import uuid  # nombre temporal único al escribir
import warnings  # nanmedian de una fila toda NaN avisa; aquí es esperado
from dataclasses import asdict, dataclass, field  # registros del puntero y del resultado
from pathlib import Path  # rutas locales
from typing import Callable, Protocol  # interfaces
from zoneinfo import ZoneInfo  # hora local de las tiendas

import numpy as np  # flags y conteos
import pandas as pd  # tablas
from prometheus_client import CollectorRegistry, Gauge  # métricas del job (batch → Pushgateway)

import build_features as bf  # panel, imputación y features: LA misma definición que el entrenamiento
import calendar_mx  # calendario y fechas de eventos
from train_quantile import seasonal_naive  # día 14 del fallback y línea base
from validate_output import GateContext, GateResult, validate  # el gate

log = logging.getLogger("forecast_nightly")

TZ = ZoneInfo("America/Mexico_City")  # hora de las tiendas; UTC−6 todo el año desde fines de 2022 (tzdata)
PUBLISH_CUTOFF = dt.time(3, 55)  # el ERP lee a las 04:00: 5 min de margen para el swap
HORIZONS = bf.HORIZONS
FORECAST_COLUMNS = ["run_date", "store_id", "sku_id", "target_date", "horizon", "p50", "p90",
                    "model_version", "imputed_input", "fallback", "new_item"]  # forecast_daily (el caso)
# Una categoría con ≥ 20 % de sus SKU-día de la semana en promo tiene una campaña que explica un salto
# (ILUSTRATIVO). Tiene que quedar arriba del nivel NORMAL de promos: con 10 %, la tasa de todos los días de
# los datos sintéticos, el puro ruido "explicaba" ≈ 40–45 % de las categorías en una noche típica. En
# producción, contra la tasa de la propia categoría en sus semanas de referencia.
PROMO_SHARE_EXPLAINS = 0.20
# Solo las series "rápidas" (≥ 1 pieza al día en sus últimos 28 días, como en backtest.py) y con 4 semanas de
# historia votan en la banda por categoría: en una lenta, el P50 es 0 por construcción y la mediana de 4 días
# no (validate_output); una nueva no tiene referencia.
BAND_MIN_RATE = 1.0
NAIVE_DAYS = 28  # el naive del fallback: los 4 mismos días de la semana de CUALQUIER horizonte caen aquí


# ----------------------------------------------------------------------------------- registros
@dataclass(frozen=True)
class Published:
    """Lo que apunta forecast_current: qué noche, qué partición y si es fallback."""

    run_date: str  # YYYY-MM-DD (texto: viaja igual en JSON, en el warehouse y en las métricas)
    partition: str  # "<run_date>/<hash>"
    fallback: bool
    reason: str = "none"  # none | prediction_error | validation_blocked | job_failed | guard


@dataclass
class Outcome:
    """Qué hizo el job: lo imprime la CLI y lo revisan los tests."""

    status: str  # published | already_published | late_not_published | stale | nothing_to_do
    published: Published | None
    gate: GateResult | None = None
    imputed_stores: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------------- interfaces
class Warehouse(Protocol):
    def active_series(self, run_date: dt.date) -> pd.DataFrame: ...  # store_id, sku_id, listed_date
    def reported_stores(self, day: dt.date) -> set[str]: ...  # tiendas cuyas ventas de `day` ya llegaron
    def sales(self, start: dt.date, end: dt.date) -> pd.DataFrame: ...  # sales_daily en [start, end]
    def stock(self, start: dt.date, end: dt.date) -> pd.DataFrame: ...  # stock_daily en [start, end]
    def promo_plan(self, start: dt.date, end: dt.date, as_of: dt.date) -> pd.DataFrame: ...
    def store_attrs(self) -> pd.DataFrame: ...
    def sku_attrs(self) -> pd.DataFrame: ...


class PartitionStore(Protocol):
    def write(self, run_date: dt.date, df: pd.DataFrame) -> str: ...  # devuelve el id; idempotente
    def read(self, partition: str) -> pd.DataFrame: ...


class Publisher(Protocol):
    def current(self) -> Published | None: ...
    def compare_and_swap(self, expected: Published | None, new: Published) -> bool: ...


class MetricsSink(Protocol):
    def push(self, registry: CollectorRegistry) -> None: ...


@dataclass
class JobDeps:
    warehouse: Warehouse
    store: PartitionStore
    publisher: Publisher
    load_model: Callable[[], object]  # → objeto con .predict(rows) y .version (train_quantile)
    events_cfg: dict  # retail_events.yaml ya leído
    metrics: MetricsSink
    clock: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.timezone.utc)  # inyectable en tests


class PublishConflict(RuntimeError):
    """Alguien movió el puntero entre la lectura y el swap (dos jobs a la vez): no se pisa, se falla."""


# ------------------------------------------------------------------------------------- métricas
class JobMetrics:
    """Métricas de UN intento. Registro nuevo en cada intento y solo con lo que pasó en él.

    Por qué solo lo que pasó: un Gauge de prometheus_client sin labels se exporta con 0 aunque nadie lo
    toque, y con pushadd ese 0 pisaría en el Pushgateway el último éxito o la última falla de verdad.
    """

    def __init__(self) -> None:
        self.registry = CollectorRegistry()
        self._g: dict[str, Gauge] = {}

    def set(self, name: str, value: float, doc: str, **labels: str) -> None:
        g = self._g.get(name)
        if g is None:
            g = self._g[name] = Gauge(name, doc, list(labels), registry=self.registry)
        (g.labels(**labels) if labels else g).set(value)


def run_date_epoch(run_date: dt.date) -> float:
    """El run_date publicado como epoch de su medianoche local: ForecastRunLate compara contra time()."""
    return dt.datetime.combine(run_date, dt.time(0), TZ).timestamp()


# ---------------------------------------------------------------------------- piezas puras
def content_hash(df: pd.DataFrame) -> str:
    """Hash estable del contenido (orden de filas incluido): misma noche + mismos datos → mismo hash."""
    h = hashlib.sha256(",".join(df.columns).encode())
    h.update(pd.util.hash_pandas_object(df, index=False).to_numpy().tobytes())
    return h.hexdigest()[:16]


def assemble(rows: pd.DataFrame, pred: pd.DataFrame, model_version: str) -> pd.DataFrame:
    """Filas de features + predicción → esquema forecast_daily, ordenado (el orden entra al hash)."""
    out = rows[["run_date", "store_id", "sku_id", "target_date", "horizon", "imputed_input", "new_item"]].copy()
    out["p50"], out["p90"] = pred["p50"].to_numpy(), pred["p90"].to_numpy()
    out["model_version"] = model_version
    out["fallback"] = False
    return out[FORECAST_COLUMNS].sort_values(["store_id", "sku_id", "horizon"]).reset_index(drop=True)


def shift_forecast(prev: pd.DataFrame, run_date: dt.date, series: pd.DataFrame,
                   naive: pd.DataFrame | None) -> pd.DataFrame:
    """El fallback: el pronóstico publicado de una noche anterior, corrido hasta `run_date`.

    Con k = run_date − prev.run_date días: los horizontes k+1…14 de prev pasan a 1…14−k (el target_date no
    cambia: es el mismo día pronosticado, visto desde más cerca). Los horizontes que faltan (y las series
    que prev no tenía, p. ej. un SKU nuevo de hoy) salen del seasonal naive de `naive` si lo hay. Las series
    que ya no están en el surtido se quitan.
    """
    rd = pd.Timestamp(run_date)
    keep = prev.merge(series[bf.KEYS], on=bf.KEYS, how="inner")  # solo el surtido de hoy
    keep = keep[pd.to_datetime(keep["target_date"]) > rd].copy()
    keep["target_date"] = pd.to_datetime(keep["target_date"])
    keep["horizon"] = (keep["target_date"] - rd).dt.days
    keep["run_date"] = rd
    keep["fallback"] = True
    keep = keep[keep["horizon"].between(1, max(HORIZONS))]
    return fill_missing(keep, naive)


def fill_missing(keep: pd.DataFrame | None, naive: pd.DataFrame | None) -> pd.DataFrame:
    """Lo corrido + del naive solo los (serie, horizonte) que faltan; esquema forecast_daily, ordenado."""
    parts = [] if keep is None else [keep]
    if naive is not None:
        if keep is not None:
            have = keep[[*bf.KEYS, "horizon"]].assign(_have=True)
            naive = naive.merge(have, on=[*bf.KEYS, "horizon"], how="left")
            naive = naive[naive["_have"].isna()].drop(columns="_have")
        parts.append(naive.assign(fallback=True))
    out = pd.concat(parts, ignore_index=True)
    return out[FORECAST_COLUMNS].sort_values(["store_id", "sku_id", "horizon"]).reset_index(drop=True)


def naive_forecast(rows: pd.DataFrame) -> pd.DataFrame:
    """Seasonal naive en el esquema forecast_daily (model_version "seasonal_naive")."""
    nv = seasonal_naive(rows)
    out = rows[["run_date", "store_id", "sku_id", "target_date", "horizon", "imputed_input", "new_item"]].copy()
    out["p50"], out["p90"] = nv["p50"].to_numpy(), nv["p90"].to_numpy()
    out["model_version"], out["fallback"] = "seasonal_naive", True
    return out[FORECAST_COLUMNS]


def gate_context(rows: pd.DataFrame, series: pd.DataFrame, sku_attrs: pd.DataFrame, calendar: pd.DataFrame,
                 run_date: dt.date, imputed_share: float) -> GateContext:
    """Arma la referencia por categoría y qué categorías quedan "explicadas" esta noche.

    Referencia: por serie RÁPIDA y día pronosticado (horizontes 1–7), la MEDIANA de sus últimos 4 mismos
    días de la semana (sw_lag_1…4, que ya están en las filas de features; los días agotados no cuentan),
    sumada por categoría. Medianas contra medianas: Σ P50 no se compara con un promedio; y solo las rápidas,
    porque en una serie lenta el P50 es 0 por construcción y la mediana de 4 días no (validate_output). Una
    serie nueva tampoco vota: sin 4 semanas de historia no tiene referencia.
    """
    rd = pd.Timestamp(run_date)
    week = rows[rows["horizon"].between(1, 7)]
    # Votan las rápidas con 4 semanas de historia: una serie nueva (new_item) no tiene sus 4 mismos días
    fast = week[(week["roll_mean_28"].fillna(0).to_numpy() >= BAND_MIN_RATE) & ~week["new_item"].to_numpy(bool)]
    lags = fast[["sw_lag_1", "sw_lag_2", "sw_lag_3", "sw_lag_4"]].to_numpy(dtype=float)
    with warnings.catch_warnings():  # una fila con los 4 días agotados → NaN, sin aviso
        warnings.simplefilter("ignore", RuntimeWarning)
        med = np.nanmedian(lags, axis=1)
    ref = fast.assign(ref=med).groupby("category", as_index=False)["ref"].sum().rename(columns={"ref": "ref_7d"})
    # Calendario: un feriado o evento en los 7 días que se pronostican lo explica todo (mueve a todas las
    # categorías). Solo esos 7: un evento en las semanas de referencia no hace falta explicarlo (cae en 1
    # de los 4 mismos días de la semana, y la mediana lo amortigua), y con esa excusa el 75 % de las noches
    # de 2026 quedaba "explicado": la banda de ±30 % casi no se aplicaba.
    win = calendar[(calendar["date"] > rd) & (calendar["date"] <= rd + pd.Timedelta(days=7))]
    ev_cols = [c for c in win.columns if c.startswith("ev_")] + ["is_holiday"]
    explained = set(sku_attrs["category"]) if win[ev_cols].to_numpy().any() else set()
    share = week.groupby("category")["promo_flag"].mean()  # promo: una campaña de la categoría
    explained |= set(share[share >= PROMO_SHARE_EXPLAINS].index)
    return GateContext(
        expected_series=len(series), horizons=len(HORIZONS),
        sku_category=sku_attrs[["sku_id", "category"]], category_reference=ref,
        band_series=fast[bf.KEYS].drop_duplicates(),
        explained_categories=frozenset(explained), imputed_store_share=imputed_share,
    )


def light_naive(run_date: dt.date, deps: JobDeps, series: pd.DataFrame,
                keep: pd.DataFrame | None) -> pd.DataFrame | None:
    """Seasonal naive de lo que el corrimiento no cubre, SIN features: el del fallback del DAG y del guardia.

    Esos dos corren cuando el job ya falló, quizá por las features (memoria, `price_promo`, el calendario),
    y no pueden depender de lo mismo. El naive solo necesita ventas e inventario de los últimos 28 días: los
    4 mismos días de la semana de cualquier horizonte caen ahí (`bf.same_weekday_lags`, la misma definición
    que las features). Ni promociones, ni calendario, ni atributos, ni el panel de 70 días. Y solo para lo
    que falta en `keep` (lo corrido): con el pronóstico de ayer, el día 14 de cada serie y los 14 días de
    las series que ayer no estaban; sin nada publicado, todo.
    """
    wh = deps.warehouse
    start = run_date - dt.timedelta(days=NAIVE_DAYS - 1)
    missing = sorted(set(series["store_id"]) - wh.reported_stores(run_date))  # regla 4: no reportó ≠ 0
    gaps = pd.DataFrame({"store_id": missing, "date": pd.Timestamp(run_date)})
    panel = bf.impute_missing(bf.build_panel(wh.sales(start, run_date), wh.stock(start, run_date), series,
                                             start, run_date, gaps))
    d, r, rd = panel.demand(), NAIVE_DAYS - 1, pd.Timestamp(run_date)
    need = np.ones((len(series), len(HORIZONS)), dtype=bool)  # (serie, horizonte) sin pronóstico corrido
    if keep is not None and len(keep):
        pos = panel.series[bf.KEYS].assign(_i=np.arange(len(series)))
        have = keep[[*bf.KEYS, "horizon"]].merge(pos, on=bf.KEYS, how="inner")
        need[have["_i"].to_numpy(), have["horizon"].to_numpy(dtype=int) - 1] = False
    s = panel.series
    age = (rd - pd.to_datetime(s["listed_date"])).dt.days if "listed_date" in s else pd.Series(np.nan, s.index)
    base = s[bf.KEYS].assign(run_date=rd, imputed_input=panel.imputed, roll_mean_28=bf.row_nanmean(d),
                             new_item=age.fillna(365).to_numpy() < bf.NEW_ITEM_DAYS)  # como features_for_origin
    blocks = []
    for h in HORIZONS:
        sel = need[:, h - 1]
        if not sel.any():
            continue
        lags = bf.same_weekday_lags(d[sel], r, h)
        blk = base[sel].assign(horizon=h, target_date=rd + pd.Timedelta(days=h), sw_mean_4=bf.row_nanmean(lags))
        for j in range(bf.N_SW_LAGS):
            blk[f"sw_lag_{j + 1}"] = lags[:, j]
        blocks.append(blk)
    return naive_forecast(pd.concat(blocks, ignore_index=True)) if blocks else None  # None: no falta nada


# ---------------------------------------------------------------------------------- el job
def _local_now(deps: JobDeps) -> dt.datetime:
    return deps.clock().astimezone(TZ)


def _after_cutoff(deps: JobDeps, run_date: dt.date) -> bool:
    cutoff = dt.datetime.combine(run_date + dt.timedelta(days=1), PUBLISH_CUTOFF, TZ)
    return _local_now(deps) > cutoff


def publish(new: Published, deps: JobDeps, m: JobMetrics, rows_published: int) -> Outcome:
    """Compare-and-swap del puntero con las 4 reglas del docstring del módulo."""
    cur = deps.publisher.current()
    late_doc = "1 si el pronóstico de la noche terminó después del corte y no se publicó"
    if cur == new:
        status = "already_published"
    elif cur is not None and cur.run_date > new.run_date:
        log.warning("no se publica %s: el puntero ya está en %s", new.run_date, cur.run_date)
        return Outcome("stale", cur)
    elif cur is not None and cur.run_date == new.run_date and new.fallback and not cur.fallback:
        return Outcome("nothing_to_do", cur)  # el modelo de esta noche ya está publicado
    elif cur is not None and cur.run_date == new.run_date and _after_cutoff(deps, dt.date.fromisoformat(new.run_date)):
        log.error("terminó después de las %s: el ERP ya leyó %s; no se cambia", PUBLISH_CUTOFF, cur.partition)
        m.set("forecast_late_not_published", 1, late_doc)  # tablero: el modelo existe, pero no se usó
        return Outcome("late_not_published", cur)
    else:
        if not deps.publisher.compare_and_swap(cur, new):
            raise PublishConflict(f"el puntero cambió mientras se publicaba {new.partition}")
        status = "published"
        log.info("publicado %s (fallback=%s, %s)", new.partition, new.fallback, new.reason)
    rd = dt.date.fromisoformat(new.run_date)
    m.set("forecast_late_not_published", 0, late_doc)  # se reinicia en cada publicación (pushadd lo conserva)
    m.set("forecast_published_run_date_seconds", run_date_epoch(rd),
          "medianoche local del run_date que apunta forecast_current")
    m.set("forecast_published_fallback", 1 if new.fallback else 0,
          "1 si lo publicado es el fallback", reason=new.reason)
    m.set("forecast_published_timestamp_seconds", deps.clock().timestamp(), "cuándo se movió el puntero")
    m.set("forecast_rows_published", rows_published, "filas de la partición publicada")
    return Outcome(status, new)


def publish_fallback(run_date: dt.date, deps: JobDeps, m: JobMetrics, reason: str,
                     rows: pd.DataFrame | None = None, series: pd.DataFrame | None = None) -> Outcome:
    """Publica el fallback de `run_date`. Idempotente, sin el modelo, sin el calendario y sin features.

    Con `rows` (el job ya armó las features: el modelo falló o el gate bloqueó), el naive sale de ahí. Sin
    ellas (el DAG cuando el job falló dos veces, el guardia de las 03:45), sale de `light_naive`: el
    fallback no puede fallar por lo mismo que tiró al job. Si el warehouse no responde ni para el surtido,
    se usan las series de lo publicado y se publica solo lo corrido (horizontes 1…13 si era de ayer).
    """
    cur = deps.publisher.current()
    rd = run_date.isoformat()
    if cur is not None and cur.run_date >= rd:
        return Outcome("nothing_to_do", cur)  # ya hay algo de esta noche (o más nuevo): no se toca
    prev = deps.store.read(cur.partition) if cur is not None else None
    warehouse_ok = True
    if series is None:
        try:
            series = deps.warehouse.active_series(run_date)
        except Exception:  # noqa: BLE001 - sin surtido de hoy, el de lo último publicado
            if prev is None:
                raise
            log.exception("sin surtido del warehouse: se corren las series del último pronóstico publicado")
            series, warehouse_ok = prev[bf.KEYS].drop_duplicates().reset_index(drop=True), False
    keep = shift_forecast(prev, run_date, series, None) if prev is not None else None
    naive = None
    if rows is not None:
        naive = naive_forecast(rows)
    elif warehouse_ok:
        try:
            naive = light_naive(run_date, deps, series, keep)
        except Exception:  # noqa: BLE001 - sin naive, lo corrido: el pedido usa los primeros 2 días
            log.exception("sin seasonal naive para el fallback: se publican solo los horizontes corridos")
    fc = fill_missing(keep, naive) if keep is not None or naive is not None else None
    if fc is None or fc.empty:
        raise RuntimeError("no hay pronóstico publicado ni datos para un naive: no hay fallback posible")
    pid = deps.store.write(run_date, fc)
    written = deps.store.read(pid)
    gate = validate(written, GateContext(expected_series=len(series), structural_only=True))
    if not gate.ok:  # ni el fallback se publica roto
        raise RuntimeError(f"el fallback no pasa las reglas de estructura: {gate.failed}")
    return publish(Published(rd, pid, fallback=True, reason=reason), deps, m, len(written))


def _features(run_date: dt.date, deps: JobDeps, series: pd.DataFrame):
    """Pasos 1–3: completitud, imputación, calendario y features. Devuelve (filas, tiendas imputadas, calendario)."""
    wh = deps.warehouse
    start = run_date - dt.timedelta(days=bf.HISTORY_DAYS)
    end = run_date + dt.timedelta(days=max(HORIZONS))
    sales, stock = wh.sales(start, run_date), wh.stock(start, run_date)
    missing = sorted(set(series["store_id"]) - wh.reported_stores(run_date))
    missing_days = pd.DataFrame({"store_id": missing, "date": pd.Timestamp(run_date)})
    panel = bf.impute_missing(bf.build_panel(sales, stock, series, start, run_date, missing_days))
    calendar = calendar_mx.calendar_table(start, end, deps.events_cfg)
    promo = wh.promo_plan(run_date + dt.timedelta(days=1), end, as_of=run_date)
    rows = bf.features_for_origin(panel, run_date, calendar, promo, wh.store_attrs(), wh.sku_attrs())
    return rows, missing, calendar


def _nightly(run_date: dt.date, deps: JobDeps, m: JobMetrics) -> Outcome:
    # Valor de arranque, ANTES de cualquier lectura: con pushadd, el "bloqueado" de ayer seguiría en el
    # Pushgateway si hoy el job falla antes de validar (warehouse caído, fechas de eventos), y
    # ForecastValidationBlocked dispararía por una noche que ya pasó.
    m.set("forecast_validation_blocked", 0, "1 si el gate bloqueó la publicación")
    wh = deps.warehouse
    series = wh.active_series(run_date)
    n_stores = series["store_id"].nunique()
    # Paso 2 primero: si faltan fechas de eventos, falla ANTES de gastar 30 min en features
    calendar_mx.require_event_dates(deps.events_cfg, run_date + dt.timedelta(days=1),
                                    run_date + dt.timedelta(days=max(HORIZONS)))
    rows, missing, calendar = _features(run_date, deps, series)
    m.set("forecast_input_stores_expected", n_stores, "tiendas activas en el surtido")
    m.set("forecast_input_stores_imputed", len(missing), "tiendas sin ventas de run_date al corte (imputadas)")
    if missing:
        log.warning("%d tiendas sin datos de %s, imputadas: %s", len(missing), run_date, missing[:10])
    try:  # paso 4: el modelo no puede tirar la noche
        model = deps.load_model()
        pred = model.predict(rows)
        fc = assemble(rows, pred, model.version)
        m.set("forecast_quantile_crossing_ratio", float(np.mean(pred["crossed"])) if "crossed" in pred else 0.0,
              "fracción de filas con P90 < P50 antes de ordenarlos")
    except Exception:  # noqa: BLE001
        log.exception("el modelo falló: fallback")
        return publish_fallback(run_date, deps, m, "prediction_error", rows, series)
    pid = deps.store.write(run_date, fc)  # paso 5
    written = deps.store.read(pid)
    ctx = gate_context(rows, series, wh.sku_attrs(), calendar, run_date, len(missing) / max(n_stores, 1))
    gate = validate(written, ctx)  # paso 6
    m.set("forecast_validation_blocked", 0 if gate.ok else 1, "1 si el gate bloqueó la publicación")
    for c in gate.checks:
        m.set("forecast_validation_failed_checks", 0 if c.ok else max(c.failures, 1),
              "elementos que fallan cada regla del gate", check=c.name)
    if not gate.ok:
        log.error("gate bloqueado: %s", "; ".join(f"{c.name}: {c.detail}" for c in gate.checks if not c.ok))
        out = publish_fallback(run_date, deps, m, "validation_blocked", rows, series)
    else:
        out = publish(Published(run_date.isoformat(), pid, fallback=False), deps, m, len(written))  # paso 7
    out.gate, out.imputed_stores = gate, missing
    return out


def _attempt(run_date: dt.date, deps: JobDeps, body: Callable[[JobMetrics], Outcome]) -> Outcome:
    """Corre un intento y SIEMPRE empuja sus métricas: éxito, falla y duración."""
    m = JobMetrics()
    t0 = deps.clock()
    try:
        out = body(m)
        m.set("forecast_last_success_timestamp_seconds", deps.clock().timestamp(), "fin del último intento sin error")
        return out
    except Exception:
        m.set("forecast_last_failure_timestamp_seconds", deps.clock().timestamp(), "fin del último intento con error")
        raise
    finally:
        m.set("forecast_run_duration_seconds", (deps.clock() - t0).total_seconds(), "duración del último intento")
        try:
            deps.metrics.push(m.registry)
        except Exception:  # noqa: BLE001 - un Pushgateway caído no cambia el resultado del job
            log.exception("no se pudieron empujar las métricas")


def run_nightly(run_date: dt.date, deps: JobDeps) -> Outcome:
    """Pasos 1–7. Lanza si algo no recuperable falla (Airflow reintenta y, si no, publica el fallback)."""
    return _attempt(run_date, deps, lambda m: _nightly(run_date, deps, m))


def run_fallback(run_date: dt.date, deps: JobDeps, reason: str = "job_failed") -> Outcome:
    """Lo que llama el DAG cuando el job falló después de su reintento."""
    return _attempt(run_date, deps, lambda m: publish_fallback(run_date, deps, m, reason))


def ensure_published(run_date: dt.date, deps: JobDeps) -> Outcome:
    """El guardia de las 03:45: si nadie publicó esta noche, publica el fallback. Si ya hay algo, nada."""
    return run_fallback(run_date, deps, reason="guard")


# -------------------------------------------------------------------------- adaptadores locales
class LocalPartitionStore:
    """forecast_daily en disco: <root>/run_date=YYYY-MM-DD/part-<hash>/data.parquet, inmutable."""

    def __init__(self, root: str | Path):
        self.root = Path(root)

    def write(self, run_date: dt.date, df: pd.DataFrame) -> str:
        digest = content_hash(df)
        final = self.root / f"run_date={run_date.isoformat()}" / f"part-{digest}"
        if not final.exists():  # mismo contenido = misma carpeta: re-correr no escribe dos veces
            tmp = final.with_name(f".tmp-{uuid.uuid4().hex}")  # oculto: nadie lo lista a medio escribir
            tmp.mkdir(parents=True)
            df.to_parquet(tmp / "data.parquet", index=False)
            os.replace(tmp, final)  # rename atómico de la carpeta completa (mismo filesystem)
        return f"{run_date.isoformat()}/{digest}"

    def read(self, partition: str) -> pd.DataFrame:
        run_date, digest = partition.split("/")
        return pd.read_parquet(self.root / f"run_date={run_date}" / f"part-{digest}" / "data.parquet")


class LocalPointer:
    """forecast_current local: un JSON reemplazado con os.replace (atómico) bajo un lock de archivo."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def current(self) -> Published | None:
        return Published(**json.loads(self.path.read_text())) if self.path.exists() else None

    def compare_and_swap(self, expected: Published | None, new: Published) -> bool:
        import fcntl  # POSIX: suficiente para la demo y los tests (en el warehouse es una transacción)

        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path.with_suffix(".lock"), "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if self.current() != expected:
                return False
            tmp = self.path.with_name(f".{self.path.name}.{uuid.uuid4().hex}")
            tmp.write_text(json.dumps(asdict(new)))
            os.replace(tmp, self.path)  # quien lee ve el puntero viejo o el nuevo, nunca medio archivo
            return True


class PrintMetrics:
    """MetricsSink de la demo: imprime en formato de exposición lo que se empujaría al Pushgateway."""

    def push(self, registry: CollectorRegistry) -> None:
        from prometheus_client import generate_latest

        sys.stdout.write(generate_latest(registry).decode())


class TableWarehouse:
    """Warehouse en memoria sobre tablas con los esquemas de build_features (tests y demo).

    `reported` simula la completitud de la noche: {fecha: tiendas que reportaron}; si una fecha no está,
    reportaron todas.
    """

    def __init__(self, data, reported: dict | None = None):
        self.d, self.reported = data, reported or {}

    def _between(self, df: pd.DataFrame, start, end) -> pd.DataFrame:
        return df[(df["date"] >= pd.Timestamp(start)) & (df["date"] <= pd.Timestamp(end))]

    def active_series(self, run_date):
        s = self.d.series
        return s[pd.to_datetime(s["listed_date"]) <= pd.Timestamp(run_date)].reset_index(drop=True)

    def reported_stores(self, day):
        return set(self.reported.get(pd.Timestamp(day).date(), set(self.d.store_attrs["store_id"])))

    def sales(self, start, end):
        out = self._between(self.d.sales, start, end)
        for day, stores in self.reported.items():  # lo que no llegó, no está en el warehouse
            gone = (out["date"] == pd.Timestamp(day)) & ~out["store_id"].isin(stores)
            out = out[~gone]
        return out

    def stock(self, start, end):
        return self._between(self.d.stock, start, end)

    def promo_plan(self, start, end, as_of):
        return bf.promo_as_of(self._between(self.d.promo, start, end), as_of)

    def store_attrs(self):
        return self.d.store_attrs

    def sku_attrs(self):
        return self.d.sku_attrs


# ------------------------------------------------------------------------------------------ CLI
def build_production_deps() -> JobDeps:  # pragma: no cover
    """Los adaptadores reales (warehouse, lake con tabla abierta, vista con CAS, Pushgateway y el
    registry de modelos) no se publican: código de red sin probar no es referencia."""
    raise NotImplementedError("adaptadores de producción no incluidos: usa --demo-dir para correr local")


def demo_deps(root: Path, run_date: dt.date) -> JobDeps:  # pragma: no cover - lo prueba el README
    """Todo local: datos sintéticos, modelo entrenado al vuelo y guardado en <root>/model.

    El reloj es el de la noche de `run_date` (las 02:00 del día siguiente), no el de tu máquina: con la hora
    real, después de las 03:55 de esa noche cualquier re-run saldría `late_not_published`. El corte lo
    prueban los tests con un reloj inyectado.
    """
    import train_quantile as tq
    from synthetic import make_synthetic

    events = calendar_mx.load_events(Path(__file__).resolve().parents[1] / "features" / "retail_events.yaml")
    start = pd.Timestamp("2025-09-01")  # fijo: todas las noches de la demo ven LOS MISMOS datos sintéticos
    if not start + pd.Timedelta(days=120) <= pd.Timestamp(run_date) <= start + pd.Timedelta(days=700):
        raise SystemExit("la demo cubre run_date entre 2025-12-30 y 2027-08-02")
    data = make_synthetic(start=str(start.date()), days=730, events_cfg=events)
    model_dir = root / "model"
    if not model_dir.exists() or not any(model_dir.iterdir()):
        panel = bf.build_panel(data.sales, data.stock, data.series, data.sales["date"].min(), run_date)
        origins = pd.date_range(start + pd.Timedelta(days=28), pd.Timestamp(run_date) - pd.Timedelta(days=1), freq="7D")
        pool = bf.training_frame(panel, origins, data.calendar, data.promo, data.store_attrs, data.sku_attrs,
                                 data.sales, data.stock)
        tq.save(tq.fit(pool[pool["target_date"] <= pd.Timestamp(run_date)]), model_dir)
    path = next(p for p in model_dir.iterdir() if p.is_dir())
    night = dt.datetime.combine(run_date + dt.timedelta(days=1), dt.time(2, 0), TZ)  # las 02:00 de esa noche
    real0 = dt.datetime.now(dt.timezone.utc)  # y avanza con el tiempo real: la duración sí es la medida
    return JobDeps(warehouse=TableWarehouse(data), store=LocalPartitionStore(root / "forecast_daily"),
                   publisher=LocalPointer(root / "forecast_current.json"), load_model=lambda: tq.load(path),
                   events_cfg=events, metrics=PrintMetrics(),
                   clock=lambda: night + (dt.datetime.now(dt.timezone.utc) - real0))


def main(argv: list[str] | None = None) -> int:  # pragma: no cover
    ap = argparse.ArgumentParser(description="Job nocturno del pronóstico (caso c14)")
    ap.add_argument("command", choices=["nightly", "fallback", "ensure-published"])
    ap.add_argument("--run-date", required=True, type=dt.date.fromisoformat, help="último día de ventas cerrado")
    ap.add_argument("--demo-dir", type=Path, help="corre con datos sintéticos y adaptadores locales")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    deps = demo_deps(a.demo_dir, a.run_date) if a.demo_dir else build_production_deps()
    fn = {"nightly": run_nightly, "fallback": run_fallback, "ensure-published": ensure_published}[a.command]
    out = fn(a.run_date, deps)
    print(json.dumps({"status": out.status, "published": out.published and asdict(out.published),
                      "gate_failed": out.gate.failed if out.gate else None, "imputed": out.imputed_stores}))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
