"""ad-api (caso c15): elige los anuncios de los 3 slots de una página de noticias en pocos milisegundos.

La página pide anuncios EN PARALELO a su contenido: si el ad-api tarda o falla, la nota se ve igual y los
slots se llenan con el fallback programático. SLO del caso: p99 ≤ 50 ms server-side, a ≈ 3,500 RPS de pico
diario y ≈ 6,000 RPS en una noticia de último momento. Este servicio se da 40 ms internos (BUDGET_MS); el
resto es la cola del event loop y escribir la respuesta. Presupuesto por etapa (estimaciones del caso):

  targeting           índice en memoria: ≈ 2,500 anuncios → los que coinciden con la página    ≈ 1–5 ms
  frequency caps      Redis: impresiones de hoy de esta persona por campaña  ┐
  presupuesto/pacing  Redis: gasto de hoy y tasa de pacing por campaña       ├ EN PARALELO, 8–10 ms c/u
  user features       online store: secciones leídas en 30 días (consent)    ┘
  filtros             intereses, caps, presupuesto, pacing (en memoria) → ≈ 150 elegibles   < 1 ms
  features + modelo   hash de los candidatos + LR (o la DNN) en CPU, en un executor        ≤ 10 ms
  subasta             GSP greedy por slot, un anuncio por anunciante (auction.py)           < 1 ms
  respuesta           tokens HMAC por slot, evento "serve" al log (sin esperar a Kafka)     < 1 ms

Degradación (campo `path` de la respuesta y de ad_requests_total{path}):
  - user features no llegan (timeout, error, sin perfil) → solo contexto: intereses vacíos, los anuncios
    segmentados por interés no participan; el modelo decide igual (vio "interest=__none__" al entrenar);
  - frequency caps no llegan → se sirve SIN caps (fail-open): exceder un cap unos segundos cuesta poco;
    sacar todo lo que tiene cap dejaría la página al programático;
  - presupuesto no llega → la última lectura buena si tiene ≤ 60 s; si no, esas campañas no participan
    (fail-closed): cobrar más allá del presupuesto incumple el contrato con el anunciante;
  - el modelo tarda, falla, devuelve basura o no queda tiempo → path="fallback": bid × CTR histórico
    suavizado del anuncio × slot (el ranking de hoy, mejorado). Sin exploración ni boost;
  - nada elegible → path="no_fill"; una excepción → path="error"; en los dos casos los 3 slots van al
    programático y la página no se entera. Si el ad-api entero no contesta, la página usa su propio
    timeout y el programático (fuera de esta carpeta).

Eventos al tópico de Kafka `ad-events` (un registro por evento): "serve" (lo decidido, con los valores
crudos de las features: training los re-hashea con features.py), "impression" (beacon VISIBLE) y "click".

Todo lo externo está detrás de interfaces (Protocol) con fakes en memoria en los tests: índice de
anuncios, Redis de caps y de presupuesto, online store, deduplicación y Kafka. Los adaptadores reales no
están aquí porque no se pudieron probar (ver README). El modelo sí es real (model.py), entrenado en los
tests con datos sintéticos.
Endpoints: POST /v1/ads · GET /v1/imp · GET /v1/click · GET /healthz · GET /readyz · GET /metrics
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import asyncio  # gather + wait_for: dependencias en paralelo, un timeout por etapa
import base64  # llaves de firma desde el entorno
import hashlib  # decisiones deterministas por request (exploración, pacing)
import json  # eventos como JSON aquí (en producción Avro/Protobuf con schema registry)
import logging  # a stdout: en un contenedor los logs son un stream
import os  # configuración por variables de entorno
import sys  # stdout explícito para el demo
import time  # perf_counter (latencias) y time (timestamps)
import uuid  # request_id cuando la página no manda uno
from collections import deque  # buffer acotado del log de eventos
from collections.abc import Callable, Iterable, Mapping, Sequence  # tipos
from concurrent.futures import ThreadPoolExecutor  # el modelo corre fuera del event loop
from contextlib import asynccontextmanager  # lifespan: cerrar el executor
from dataclasses import dataclass, field  # contratos internos
from typing import Literal, Protocol  # valores permitidos e interfaces sin herencia

import numpy as np  # matriz de pCTR candidatos × slots
from fastapi import BackgroundTasks, FastAPI, Query, Request  # framework ASGI
from fastapi.exceptions import RequestValidationError  # 422 sin repetir el input
from fastapi.responses import JSONResponse, RedirectResponse, Response  # respuestas explícitas
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel, Field  # validación del request

import auction as A  # serving/auction.py: subasta pura
import features as F  # serving/features.py: LA definición de features (la misma del entrenamiento)
import tokens as T  # serving/tokens.py: tokens de impresión firmados

log = logging.getLogger("ad-api")
SOURCES = ("model", "explore", "fallback")  # de dónde salió el pCTR de una impresión (label `src`)


# ---------------------------------------------------------------------------- configuración
def _env_keys(raw: str) -> dict[str, bytes]:
    """TOKEN_KEYS="k2026a:<base64>,k2026b:<base64>" → {kid: llave}. Vienen de un Secret, nunca de la imagen."""
    out = {}
    for part in filter(None, (p.strip() for p in raw.split(","))):
        kid, _, b64 = part.partition(":")
        out[kid] = base64.b64decode(b64)
    return out


@dataclass
class Settings:
    budget_s: float = float(os.getenv("BUDGET_MS", "40")) / 1000  # presupuesto interno de los 50 ms
    freq_timeout_s: float = float(os.getenv("FREQ_TIMEOUT_MS", "8")) / 1000
    budget_timeout_s: float = float(os.getenv("BUDGET_TIMEOUT_MS", "8")) / 1000
    user_timeout_s: float = float(os.getenv("USER_FEATURES_TIMEOUT_MS", "10")) / 1000
    model_timeout_s: float = float(os.getenv("MODEL_TIMEOUT_MS", "10")) / 1000
    dedupe_timeout_s: float = float(os.getenv("DEDUPE_TIMEOUT_MS", "20")) / 1000  # beacons: no hay página esperando
    click_log_timeout_s: float = float(os.getenv("CLICK_LOG_TIMEOUT_MS", "200")) / 1000
    reserve_ecpm: float = float(os.getenv("RESERVE_ECPM", "0.80"))  # US$ por 1,000 impresiones (dato del caso)
    increment: float = float(os.getenv("PRICE_INCREMENT", "0.01"))  # US$ por click sobre el mínimo
    exploration_rate: float = float(os.getenv("EXPLORATION_RATE", "0.01"))  # ≈ 1 % de los requests
    new_ad_impressions: int = int(os.getenv("NEW_AD_IMPRESSIONS", "10000"))  # "nuevo" = menos de esto
    new_ad_boost: float = float(os.getenv("NEW_AD_BOOST", "1.2"))  # ilustrativo: se ajusta con A/B
    # Orden de VALOR de los slots para la subasta (el más valioso primero). Ilustrativo: lo confirma el
    # efecto de posición que aprende el modelo (model.position_term) y el tráfico de exploración.
    slot_order: tuple[str, ...] = tuple(os.getenv("SLOT_ORDER", "top,in_article,bottom").split(","))
    timezone: str = os.getenv("PUBLISHER_TZ", "America/Mexico_City")  # hora local y "día" del cap
    freq_ttl_s: int = int(os.getenv("FREQ_TTL_S", str(2 * 86400)))  # la llave es por día; el TTL la limpia
    budget_snapshot_max_age_s: float = float(os.getenv("BUDGET_SNAPSHOT_MAX_AGE_S", "60"))
    imp_max_age_s: float = float(os.getenv("IMP_MAX_AGE_S", "600"))  # beacon > 10 min después: sospechoso
    click_max_age_s: float = float(os.getenv("CLICK_MAX_AGE_S", "86400"))  # ilustrativo: política comercial
    dedupe_ttl_s: int = int(os.getenv("DEDUPE_TTL_S", str(86400 + 3600)))  # ≥ la vida del token
    base_url: str = os.getenv("AD_BASE_URL", "https://ads.example.com")  # host de /v1/imp y /v1/click
    home_url: str = os.getenv("HOME_URL", "https://www.example.com")  # destino si un click no se puede leer
    events_topic: str = os.getenv("EVENTS_TOPIC", "ad-events")
    model_workers: int = int(os.getenv("MODEL_WORKERS", "2"))  # ≈ cores del pod dedicados al modelo
    token_keys: dict[str, bytes] = field(default_factory=lambda: _env_keys(os.getenv("TOKEN_KEYS", "")))
    token_kid: str = os.getenv("TOKEN_ACTIVE_KID", "")


# ---------------------------------------------------------------------------- request y anuncios
class AdRequest(BaseModel):
    request_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{8,64}$")  # la página puede mandarlo
    section: str = Field(min_length=1, max_length=40)  # contexto: sección de la nota
    device: Literal["mobile", "desktop", "tablet"]
    geo: str | None = Field(default=None, max_length=12)  # región gruesa (p. ej. "MX-NLE"); la calcula el edge por IP
    user_id: str | None = Field(default=None, min_length=1, max_length=64)  # id propio, seudónimo
    consent: bool = False  # consentimiento de personalización: sin él, el user_id NO se usa


@dataclass(frozen=True)
class Ad:
    """Un anuncio activo, como lo carga el índice en memoria (se refresca desde la base de campañas)."""

    ad_id: str
    campaign_id: str
    advertiser_id: str
    bid: float  # CPC máximo en US$
    ad_category: str
    ad_format: str
    title: str = ""
    image_url: str = ""
    landing_url: str = "https://example.com/"  # el destino del click SOLO sale de aquí, nunca de la URL
    advertiser_name: str = ""
    target_sections: frozenset[str] | None = None  # None = todas
    target_devices: frozenset[str] | None = None
    target_geos: frozenset[str] | None = None
    target_hours: frozenset[int] | None = None
    target_interests: frozenset[str] | None = None  # segmentación por interés: exige consentimiento
    freq_cap_per_day: int | None = 5  # cap de la CAMPAÑA por persona por día (copiado a cada anuncio)
    lifetime_impressions: int = 0  # para el boost de anuncios nuevos
    # Cuándo se pausó (None = activo). El índice guarda las pausadas recientes SOLO para get(): el click de
    # una impresión servida antes de la pausa todavía tiene que redirigir y cobrarse
    paused_at: float | None = None

    def attrs(self) -> dict[str, str]:
        """Los campos que el modelo ve del anuncio (features.AD_FIELDS)."""
        return {f: getattr(self, f) for f in F.AD_FIELDS}


@dataclass(frozen=True)
class CampaignBudget:
    spent_usd: float  # gasto de hoy (clicks cobrados)
    daily_budget_usd: float
    serve_rate: float  # 0–1: fracción de requests en los que participa (la fija el controlador de pacing)


# ---------------------------------------------------------------------------- interfaces
class TargetingIndex(Protocol):
    """Índice de anuncios en memoria (≈ 2,500): se recarga cada minuto desde la base de campañas.

    loaded_at = cuándo se armó: su edad es una métrica (ad_index_age_seconds) con alerta. Un pod con un
    índice viejo sirve anuncios ya pausados.
    """

    loaded_at: float

    def candidates(self, ctx: Mapping[str, object]) -> list[Ad]: ...

    def get(self, ad_id: str) -> Ad | None: ...

    def __len__(self) -> int: ...


class FrequencyStore(Protocol):
    """Producción: Redis. Llave fc:{user}:{campaña}:{fecha local} con hash tag {user}: un MGET por request."""

    async def counts(self, user_id: str, campaign_ids: Sequence[str], day: str) -> dict[str, int]: ...

    async def increment(self, user_id: str, campaign_ids: Sequence[str], day: str, ttl_s: int) -> None: ...


class BudgetStore(Protocol):
    """Producción: Redis. El controlador de pacing escribe serve_rate cada minuto; el click suma gasto."""

    async def status(self, campaign_ids: Sequence[str]) -> dict[str, CampaignBudget]: ...

    async def add_spend(self, campaign_id: str, amount_usd: float, day: str) -> None: ...


class UserFeatureStore(Protocol):
    """Online store: {"interests": [secciones de 30 días, la más leída primero]} o None (sin perfil)."""

    async def get(self, user_id: str) -> dict | None: ...


class CTRModel(Protocol):
    """model.HashedLogisticModel cumple esto; la DNN también lo cumpliría."""

    version: str

    def predict_slots(self, rows: Sequence[np.ndarray], formats: Sequence[str | None],
                      slots: Sequence[str]) -> np.ndarray: ...


class DedupeStore(Protocol):
    """Producción: Redis SET key 1 NX EX ttl. True = primera vez."""

    async def first_time(self, key: str, ttl_s: int) -> bool: ...


class EventLog(Protocol):
    """Producción: productor de Kafka (acks=all, idempotente) al tópico ad-events."""

    def publish(self, record: dict) -> bool: ...  # serve/impression: encola y no espera; False = descartado

    async def publish_and_wait(self, record: dict) -> None: ...  # click: espera el ack (es facturación)


# ---------------------------------------------------------------------------- fallback de ranking
@dataclass
class SmoothedCTR:
    """bid × CTR histórico SUAVIZADO del anuncio × slot: el ranking de hoy (bid × CTR de 7 días), mejorado.

    CTR suavizado = (clicks + a × prior) / (impresiones + a). Con prior 0.35 % y a = 1,000:
      anuncio con 50 clicks en 10,000 impresiones → (50 + 3.5) / 11,000 ≈ 0.49 % (casi su propio CTR)
      anuncio nuevo, 0 de 0                       → 3.5 / 1,000 = 0.35 % (el prior: no 0 ni "infinito")
      0 clicks en 5,000                           → 3.5 / 6,000 ≈ 0.06 %
    Sin suavizar, un anuncio con 1 click en 10 impresiones (10 %) ganaría todo. La tabla viene de un job
    horario sobre el warehouse y vive en memoria: el fallback no puede depender de otra llamada remota.
    """

    stats: Mapping[tuple[str, str], tuple[float, float]]  # (ad_id, slot) → (clicks, impresiones visibles), 7 días
    priors: Mapping[str, float]  # slot → CTR promedio del slot
    strength: float = 1000.0  # a: cuántas impresiones "pesa" el prior (ilustrativo)

    def ctr(self, ad_id: str, slot: str) -> float:
        clicks, imps = self.stats.get((ad_id, slot), (0.0, 0.0))
        return (clicks + self.strength * self.priors[slot]) / (imps + self.strength)

    def matrix(self, ads: Sequence[Ad], slots: Sequence[str]) -> np.ndarray:
        return np.array([[self.ctr(a.ad_id, s) for s in slots] for a in ads], dtype=np.float64)


# ---------------------------------------------------------------------------- fakes en memoria
class InMemoryTargetingIndex:
    """Índice invertido: por cada dimensión, valor → anuncios que lo aceptan (incluye los "todos")."""

    DIMS = (("section", "target_sections"), ("device", "target_devices"), ("geo", "target_geos"),
            ("hour", "target_hours"))

    def __init__(self, ads: Iterable[Ad], loaded_at: float | None = None) -> None:
        self.loaded_at = time.time() if loaded_at is None else loaded_at
        self._ads = {a.ad_id: a for a in ads}  # get(): activos y pausados recientes
        active = [a for a in self._ads.values() if a.paused_at is None]  # candidates(): solo activos
        self._active = len(active)
        self._match: dict[str, dict[object, frozenset[str]]] = {}
        self._any: dict[str, frozenset[str]] = {}
        for dim, attr in self.DIMS:
            any_ids = frozenset(a.ad_id for a in active if getattr(a, attr) is None)
            values: dict[object, set[str]] = {}
            for a in active:
                for v in getattr(a, attr) or ():
                    values.setdefault(v, set()).add(a.ad_id)
            # Precalculado: valor → (los que lo eligieron ∪ los que aceptan todo). Por request, 4 intersecciones
            self._match[dim] = {v: frozenset(ids) | any_ids for v, ids in values.items()}
            self._any[dim] = any_ids

    def candidates(self, ctx: Mapping[str, object]) -> list[Ad]:
        ids: frozenset[str] | None = None
        for dim, _ in self.DIMS:
            ok = self._match[dim].get(ctx.get(dim), self._any[dim])
            ids = ok if ids is None else ids & ok
        return [self._ads[i] for i in sorted(ids or ())]  # orden determinista

    def get(self, ad_id: str) -> Ad | None:
        return self._ads.get(ad_id)

    def __len__(self) -> int:
        return self._active  # anuncios que pueden salir (readiness: > 0)


class InMemoryFrequencyStore:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._data: dict[tuple[str, str, str], tuple[int, float]] = {}  # → (conteo, vence)

    async def counts(self, user_id: str, campaign_ids: Sequence[str], day: str) -> dict[str, int]:
        now = self._clock()
        out = {}
        for c in campaign_ids:
            n, exp = self._data.get((user_id, c, day), (0, 0.0))
            if n and exp > now:
                out[c] = n
        return out

    async def increment(self, user_id: str, campaign_ids: Sequence[str], day: str, ttl_s: int) -> None:
        now = self._clock()
        for c in campaign_ids:
            n, exp = self._data.get((user_id, c, day), (0, 0.0))
            self._data[(user_id, c, day)] = ((n if exp > now else 0) + 1, now + ttl_s)  # INCR + EXPIRE


class InMemoryBudgetStore:
    def __init__(self, budgets: Mapping[str, CampaignBudget]) -> None:
        self.budgets = dict(budgets)
        self.spend_log: list[tuple[str, float, str]] = []

    async def status(self, campaign_ids: Sequence[str]) -> dict[str, CampaignBudget]:
        return {c: self.budgets[c] for c in campaign_ids if c in self.budgets}

    async def add_spend(self, campaign_id: str, amount_usd: float, day: str) -> None:
        self.spend_log.append((campaign_id, amount_usd, day))
        b = self.budgets.get(campaign_id)
        if b:
            self.budgets[campaign_id] = CampaignBudget(b.spent_usd + amount_usd, b.daily_budget_usd, b.serve_rate)


class StaticUserFeatureStore:
    def __init__(self, profiles: Mapping[str, dict] | None = None) -> None:
        self.profiles = dict(profiles or {})
        self.calls = 0  # los tests verifican que sin consentimiento NI SE CONSULTA

    async def get(self, user_id: str) -> dict | None:
        self.calls += 1
        return self.profiles.get(user_id)


class InMemoryDedupeStore:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._seen: dict[str, float] = {}

    async def first_time(self, key: str, ttl_s: int) -> bool:
        now = self._clock()
        if self._seen.get(key, 0.0) > now:
            return False
        self._seen[key] = now + ttl_s
        return True


class BufferedEventLog:
    """Buffer acotado en memoria (lo vaciaría un productor de Kafka). Lleno → se descarta y se cuenta."""

    def __init__(self, maxlen: int = 100_000, echo: bool = False) -> None:
        self.records: deque[dict] = deque()
        self.maxlen = maxlen
        self.echo = echo

    def publish(self, record: dict) -> bool:
        if len(self.records) >= self.maxlen:
            return False
        self.records.append(record)
        if self.echo:
            print(json.dumps(record, sort_keys=True), file=sys.stdout, flush=True)
        return True

    async def publish_and_wait(self, record: dict) -> None:
        if not self.publish(record):
            raise RuntimeError("buffer lleno")


# ---------------------------------------------------------------------------- métricas
class Metrics:
    """Un registry por app (los tests crean varias apps en el mismo proceso sin choques de nombres)."""

    def __init__(self) -> None:
        r = self.registry = CollectorRegistry()
        self.requests = Counter("ad_requests_total", "Requests de anuncios por camino", ["path"], registry=r)
        self.invalid = Counter("ad_invalid_requests_total", "Requests que no validan (422)", registry=r)
        # Buckets EXACTOS en 0.04 (presupuesto interno) y 0.05 (SLO): sin ellos histogram_quantile
        # interpola entre vecinos y la alerta oscila alrededor del umbral.
        self.duration = Histogram("ad_request_duration_seconds", "Latencia server-side de POST /v1/ads",
                                  buckets=(0.002, 0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.1, 0.25, 0.5),
                                  registry=r)
        self.stage = Histogram("ad_stage_duration_seconds", "Latencia por etapa", ["stage"],
                               buckets=(0.0005, 0.001, 0.002, 0.005, 0.008, 0.01, 0.015, 0.02, 0.04, 0.1, 0.25),
                               registry=r)
        self.candidates = Histogram("ad_candidates", "Anuncios elegibles que llegan al modelo",
                                    buckets=(0, 10, 25, 50, 100, 150, 200, 300, 500, 1000), registry=r)
        self.filtered = Counter("ad_filtered_total", "Candidatos descartados por filtro", ["reason"], registry=r)
        self.dep_errors = Counter("ad_dependency_errors_total", "Fallas de dependencias", ["dependency", "kind"],
                                  registry=r)
        self.budget_stale = Counter("ad_budget_stale_total", "Requests servidos con la última lectura de presupuesto",
                                    registry=r)
        self.user_lookups = Counter("ad_user_feature_lookups_total", "Consultas de user features (con consent)",
                                    registry=r)
        self.user_defaults = Counter("ad_user_feature_defaults_total", "User features que no llegaron",
                                     ["reason"], registry=r)
        self.fallback = Counter("ad_fallback_total", "Requests rankeados sin modelo", ["reason"], registry=r)
        self.exploration = Counter("ad_exploration_requests_total", "Requests de exploración", registry=r)
        self.slots = Counter("ad_slots_total", "Slots respondidos", ["slot", "fill"], registry=r)
        lab = ["slot", "src", "ad_age"]
        self.viewable = Counter("ad_viewable_impressions_total", "Impresiones visibles (beacon)", lab, registry=r)
        # Σ pCTR de las impresiones VISIBLES: el denominador del calibration ratio. Se suma en el beacon, no
        # al servir: el modelo predice P(click | impresión visible), y sumar las servidas que nadie vio
        # dejaría el cociente siempre bajo 1 (por la tasa de visibilidad, no por el modelo).
        self.expected = Counter("ad_expected_clicks_total", "Σ pCTR de impresiones visibles", lab, registry=r)
        self.imp_rejected = Counter("ad_impressions_rejected_total", "Beacons rechazados", ["reason"], registry=r)
        self.imp_dupes = Counter("ad_impression_duplicates_total", "Beacons repetidos", registry=r)
        self.clicks = Counter("ad_clicks_total", "Clicks válidos (firma, vigencia, primero de su impresión)", lab,
                              registry=r)
        self.not_billed = Counter("ad_clicks_not_billed_total", "Clicks válidos que no se cobran", ["reason"],
                                  registry=r)
        self.index_age = Gauge("ad_index_age_seconds", "Edad del índice de anuncios de este pod", registry=r)
        self.revenue = Counter("ad_click_revenue_usd_total", "Ingreso por clicks (US$)", registry=r)
        self.click_rejected = Counter("ad_clicks_rejected_total", "Clicks rechazados", ["reason"], registry=r)
        self.click_dupes = Counter("ad_click_duplicates_total", "Clicks repetidos (no se cobran)", registry=r)
        self.click_log_failures = Counter("ad_click_log_failures_total", "Clicks que Kafka no confirmó", registry=r)
        self.log_dropped = Counter("ad_event_log_dropped_total", "Eventos descartados (buffer lleno)", ["type"],
                                   registry=r)


# ---------------------------------------------------------------------------- app
def _unit(key: str) -> float:
    """Número en [0, 1) determinista por llave: la misma decisión si se re-juega el request."""
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big") / 2**64


def _score(model: CTRModel, ctx: Mapping[str, object], interests: Sequence[str], ads: Sequence[Ad],
           slots: Sequence[str]) -> np.ndarray:
    """Hash de features + modelo, en el thread del executor (el event loop sigue atendiendo)."""
    rows = F.encode_candidates(ctx, interests, [a.attrs() for a in ads])
    return model.predict_slots(rows, [a.ad_format for a in ads], slots)


@dataclass
class Deps:
    index: TargetingIndex
    freq: FrequencyStore
    budget: BudgetStore
    users: UserFeatureStore
    model: CTRModel | None
    fallback_ctr: SmoothedCTR
    dedupe: DedupeStore
    events: EventLog
    settings: Settings = field(default_factory=Settings)
    clock: Callable[[], float] = time.time  # el reloj del servicio: es el ts que se loguea


def create_app(deps: Deps) -> FastAPI:
    s = deps.settings
    m = Metrics()
    # Se calcula en cada scrape (no en cada request): deps.index se reemplaza cuando se recarga el índice
    m.index_age.set_function(lambda: deps.clock() - deps.index.loaded_at)
    if not s.token_keys or s.token_kid not in s.token_keys:
        raise ValueError("TOKEN_KEYS / TOKEN_ACTIVE_KID: sin llave activa no se puede firmar ni cobrar")
    if sorted(s.slot_order) != sorted(F.SLOTS):
        raise ValueError(f"SLOT_ORDER debe ser una permutación de {F.SLOTS}")
    model_pool = ThreadPoolExecutor(max_workers=s.model_workers, thread_name_prefix="model")
    # Última lectura buena de presupuesto por campaña: (estado, cuándo se leyó). Acotado por # de campañas.
    budget_cache: dict[str, tuple[CampaignBudget, float]] = {}
    warm = False
    if deps.model is not None:
        # Warm-up ANTES de estar ready: el primer scoring paga cachés frías y se comería los 10 ms del primer
        # request real. Si el modelo ni siquiera puntúa un anuncio de prueba, el pod no queda ready (el
        # rollout se detiene ahí, no en producción).
        probe = Ad("warmup", "warmup", "warmup", 0.1, "warmup", F.FORMATS[0])
        try:
            out = model_pool.submit(_score, deps.model, {}, (), [probe], s.slot_order).result(timeout=5)
            warm = bool(np.all(np.isfinite(out)))
        except Exception:  # noqa: BLE001
            log.exception("warm-up del modelo falló: el pod no estará ready")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        model_pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="ad-api", lifespan=lifespan)
    app.state.metrics = m

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Por defecto FastAPI devuelve el `input` de cada error: repetiría el user_id en la respuesta y en
        # los logs de quien llama. Solo ubicación, mensaje y tipo.
        m.invalid.inc()
        detail = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
        return JSONResponse({"detail": detail}, status_code=422)

    async def timed(stage: str, coro, timeout: float):
        """Corre `coro` con su timeout y mide la etapa. Devuelve el resultado o la excepción (no la lanza)."""
        t = time.perf_counter()
        try:
            return await asyncio.wait_for(coro, timeout=max(timeout, 0.0))
        except Exception as exc:  # noqa: BLE001 — timeout o error: lo decide quien llama
            return exc
        finally:
            m.stage.labels(stage=stage).observe(time.perf_counter() - t)

    async def const(value):
        return value

    def dep_error(dependency: str, exc: Exception) -> None:
        m.dep_errors.labels(dependency=dependency, kind="timeout" if isinstance(exc, TimeoutError) else "error").inc()

    def ad_age(ad: Ad | None) -> str:
        if ad is None:
            return "unknown"
        return "new" if ad.lifetime_impressions < s.new_ad_impressions else "established"

    def all_programmatic(rid: str, path: str, t0: float, **extra) -> dict:
        for slot in F.SLOTS:
            m.slots.labels(slot=slot, fill="programmatic").inc()
        m.requests.labels(path=path).inc()
        m.duration.observe(time.perf_counter() - t0)
        return {"request_id": rid, "path": path, "exploration": False, "model_version": None,
                "feature_set_version": F.FEATURE_SET_VERSION,
                "slots": [{"slot": sl, "fill": "programmatic"} for sl in F.SLOTS],
                "latency_ms": round((time.perf_counter() - t0) * 1000, 2), **extra}

    @app.post("/v1/ads")
    async def ads(req: AdRequest, background: BackgroundTasks) -> dict:
        t0 = time.perf_counter()
        rid = req.request_id or uuid.uuid4().hex
        try:
            return await serve(req, rid, t0, background)
        except Exception:  # noqa: BLE001 — el ad server nunca rompe la página: programático y se cuenta
            log.exception("error inesperado en /v1/ads (request_id=%s)", rid)
            return all_programmatic(rid, "error", t0)

    async def serve(req: AdRequest, rid: str, t0: float, background: BackgroundTasks) -> dict:
        deadline = t0 + s.budget_s
        ts = deps.clock()
        hour, dow, day = F.local_time(ts, s.timezone)
        ctx = {"section": req.section, "device": req.device, "geo": req.geo, "hour": hour, "dow": dow}
        # Sin consentimiento el user_id no existe para este request: ni features, ni caps, ni log
        uid = req.user_id if req.consent else None
        explore = _unit(f"explore|{rid}") < s.exploration_rate  # determinista por request (re-jugable)

        # 1) Targeting en memoria
        t = time.perf_counter()
        cands = deps.index.candidates(ctx)
        m.stage.labels(stage="targeting").observe(time.perf_counter() - t)
        campaign_ids = sorted({a.campaign_id for a in cands})

        # 2) Caps, presupuesto y user features EN PARALELO, cada uno con su timeout
        freq_res, budget_res, user_res = await asyncio.gather(
            timed("freq_caps", deps.freq.counts(uid, campaign_ids, day), s.freq_timeout_s)
            if uid and cands else const({}),
            timed("budget", deps.budget.status(campaign_ids), s.budget_timeout_s) if cands else const({}),
            timed("user_features", deps.users.get(uid), s.user_timeout_s) if uid else const(None),
        )

        interests: tuple[str, ...] = ()
        if uid:
            m.user_lookups.inc()
            if isinstance(user_res, Exception):
                m.user_defaults.labels(reason="timeout" if isinstance(user_res, TimeoutError) else "error").inc()
            elif user_res is None:
                m.user_defaults.labels(reason="missing").inc()  # persona nueva o perfil vencido
            else:
                interests = F.clean_interests(user_res.get("interests"))
        if isinstance(freq_res, Exception):
            dep_error("freq_caps", freq_res)
            freq_res = {}  # fail-open: sin caps este request
        now = deps.clock()
        if isinstance(budget_res, Exception):
            dep_error("budget", budget_res)
            budget_res = {c: b for c, (b, at) in budget_cache.items() if now - at <= s.budget_snapshot_max_age_s}
            if budget_res:
                m.budget_stale.inc()  # se sirve con una lectura de hace ≤ 60 s (si no hay, fail-closed abajo)
        else:
            budget_cache.update({c: (b, now) for c, b in budget_res.items()})

        # 3) Filtros (en memoria): cada descarte cuenta con su motivo
        eligible: list[Ad] = []
        user_interests = set(interests)
        for ad in cands:
            reason = None
            st = budget_res.get(ad.campaign_id)
            if ad.target_interests is not None and not (ad.target_interests & user_interests):
                reason = "interest"  # sin consentimiento o sin match: un anuncio segmentado no participa
            elif uid and ad.freq_cap_per_day is not None and freq_res.get(ad.campaign_id, 0) >= ad.freq_cap_per_day:
                reason = "freq_cap"
            elif st is None:
                reason = "budget_unknown"  # fail-closed: no se puede saber si todavía tiene presupuesto
            elif st.spent_usd >= st.daily_budget_usd:
                reason = "budget_exhausted"
            elif _unit(f"pace|{rid}|{ad.campaign_id}") >= st.serve_rate:
                reason = "pacing"  # throttling probabilístico: participa en serve_rate de los requests
            if reason:
                m.filtered.labels(reason=reason).inc()
            else:
                eligible.append(ad)
        m.candidates.observe(len(eligible))
        if not eligible:
            return all_programmatic(rid, "no_fill", t0)

        # 4) pCTR por candidato × slot: modelo en el executor, o el fallback
        slots = s.slot_order
        fallback_reason = None
        pctr = None
        remaining = deadline - time.perf_counter()
        if deps.model is None:
            fallback_reason = "model_unavailable"
        elif remaining < s.model_timeout_s / 2:
            fallback_reason = "deadline"  # no se empieza lo que no se puede terminar
        else:
            loop = asyncio.get_running_loop()
            res = await timed("model", loop.run_in_executor(model_pool, _score, deps.model, ctx, interests,
                                                           eligible, slots), min(s.model_timeout_s, remaining))
            if isinstance(res, TimeoutError):
                fallback_reason = "model_timeout"  # el thread sigue calculando; el request ya no espera
            elif isinstance(res, Exception) or res.shape != (len(eligible), len(slots)) \
                    or not np.all(np.isfinite(res)) or res.min() < 0 or res.max() > 1:
                fallback_reason = "model_error"  # excepción, forma rara, NaN o fuera de [0, 1]
            else:
                pctr = res
        path = "model" if fallback_reason is None else "fallback"
        if fallback_reason:
            m.fallback.labels(reason=fallback_reason).inc()
            pctr = deps.fallback_ctr.matrix(eligible, slots)
            explore = False  # sin modelo no hay exploración: la propensity sería de otra política

        # 5) Subasta (o exploración): boost a anuncios nuevos solo con modelo
        def boost(a: Ad) -> float:
            return s.new_ad_boost if path == "model" and a.lifetime_impressions < s.new_ad_impressions else 1.0

        bids = [A.Bid(ad_id=a.ad_id, campaign_id=a.campaign_id, advertiser_id=a.advertiser_id, bid=a.bid,
                      pctr={sl: float(pctr[i, j]) for j, sl in enumerate(slots)}, boost=boost(a))
                for i, a in enumerate(eligible)]
        boost_of = {b.ad_id: b.boost for b in bids}
        t = time.perf_counter()
        run = A.run_exploration if explore else A.run_auction
        placements = {p.slot: p for p in run(bids, slots, reserve_ecpm=s.reserve_ecpm, increment=s.increment, seed=rid)}
        m.stage.labels(stage="auction").observe(time.perf_counter() - t)
        if explore:
            m.exploration.inc()

        # 6) Respuesta con tokens firmados, en el orden de la PÁGINA
        by_id = {a.ad_id: a for a in eligible}
        out_slots, logged = [], []
        for slot in F.SLOTS:
            p = placements.get(slot)
            if p is None:
                m.slots.labels(slot=slot, fill="programmatic").inc()
                out_slots.append({"slot": slot, "fill": "programmatic"})
                continue
            ad = by_id[p.ad_id]
            src = "explore" if p.explored else path
            token = T.sign({"rid": rid, "ad": p.ad_id, "c": p.campaign_id, "slot": slot, "px": p.price,
                            "p": round(p.pctr, 8), "src": src, "ts": round(ts, 3)},
                           s.token_keys[s.token_kid], s.token_kid)
            m.slots.labels(slot=slot, fill="ad").inc()
            out_slots.append({"slot": slot, "fill": "ad", "ad_id": p.ad_id, "campaign_id": p.campaign_id,
                              "creative": {"title": ad.title, "image_url": ad.image_url,
                                           "advertiser": ad.advertiser_name, "format": ad.ad_format},
                              "impression_url": f"{s.base_url}/v1/imp?t={token}",
                              "click_url": f"{s.base_url}/v1/click?t={token}"})
            logged.append({"imp_id": f"{rid}:{slot}", "slot": slot, **ad.attrs(), "bid": p.bid,
                           "pctr": p.pctr, "ecpm": p.ecpm, "price": p.price, "price_source": p.price_source,
                           "runner_up": p.runner_up, "src": src, "propensity": p.propensity,
                           "boost": boost_of[p.ad_id]})

        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        # 7) Evento "serve" (no bloquea): lo decidido + los valores CRUDOS de las features. El user_id solo
        #    con consentimiento. Es la fuente del set de entrenamiento y la evidencia de una disputa.
        record = {"type": "serve", "event_id": uuid.uuid4().hex, "request_id": rid, "ts": ts,
                  "user_id": uid, "consent": req.consent, "context": ctx, "interests": list(interests),
                  "path": path, "fallback_reason": fallback_reason, "exploration": explore,
                  "exploration_rate": s.exploration_rate,
                  "model_version": deps.model.version if deps.model is not None and path == "model" else None,
                  "feature_set_version": F.FEATURE_SET_VERSION, "candidates": len(eligible),
                  "placements": logged, "latency_ms": latency_ms}
        if not deps.events.publish(record):
            m.log_dropped.labels(type="serve").inc()
        # 8) Frequency caps: después de responder (BackgroundTasks corre tras enviar el body). Se cuenta al
        #    SERVIR, no al ver: la página puede pedir de nuevo antes de que llegue el beacon, y contar de más
        #    solo adelanta el cap
        if uid and placements:
            background.add_task(bump_caps, uid, sorted({p.campaign_id for p in placements.values()}), day)

        m.requests.labels(path=path).inc()
        m.duration.observe(time.perf_counter() - t0)
        return {"request_id": rid, "path": path, "exploration": explore,
                "model_version": deps.model.version if path == "model" else None,
                "feature_set_version": F.FEATURE_SET_VERSION, "slots": out_slots, "latency_ms": latency_ms}

    async def bump_caps(uid: str, campaign_ids: list[str], day: str) -> None:
        # Fuera del request: la página ya tiene su respuesta, así que el timeout puede ser más holgado
        res = await timed("freq_update", deps.freq.increment(uid, campaign_ids, day, s.freq_ttl_s),
                          s.freq_timeout_s * 5)
        if isinstance(res, Exception):
            dep_error("freq_update", res)

    def verified(token: str, max_age_s: float, counter: Counter) -> dict | None:
        """Payload si el token es válido (firma, edad, slot y src conocidos); si no, cuenta el motivo."""
        try:
            payload = T.verify(token, s.token_keys, now=deps.clock(), max_age_s=max_age_s)
            if payload["slot"] not in F.SLOTS or payload["src"] not in SOURCES:
                raise T.TokenError("malformed")  # firmado por nosotros pero raro: no inventa labels
            return payload
        except T.TokenError as e:
            counter.labels(reason=e.reason).inc()
            return None

    async def first_time(key: str) -> bool:
        res = await timed("dedupe", deps.dedupe.first_time(key, s.dedupe_ttl_s), s.dedupe_timeout_s)
        if isinstance(res, Exception):
            dep_error("dedupe", res)
            return True  # fail-open: se cuenta; build_training_set y facturación deduplican después por imp_id
        return bool(res)

    @app.get("/v1/imp", status_code=204)
    async def impression(t: str = Query(..., max_length=2048)) -> Response:
        # La página dispara este beacon cuando el anuncio es VISIBLE (MRC/IAB para display: ≥ 50 % de los
        # píxeles en pantalla durante ≥ 1 s continuo). Responde 204 siempre: el navegador no hace nada con
        # la respuesta, y un error no le dice nada útil a un bot.
        payload = verified(t, s.imp_max_age_s, m.imp_rejected)
        if payload is None:
            return Response(status_code=204)
        iid = T.imp_id(payload)
        if not await first_time("imp:" + iid):
            m.imp_dupes.inc()
            return Response(status_code=204)
        labels = {"slot": payload["slot"], "src": payload["src"], "ad_age": ad_age(deps.index.get(payload["ad"]))}
        m.viewable.labels(**labels).inc()
        m.expected.labels(**labels).inc(float(payload["p"]))
        rec = {"type": "impression", "event_id": uuid.uuid4().hex, "imp_id": iid, "request_id": payload["rid"],
               "ad_id": payload["ad"], "campaign_id": payload["c"], "slot": payload["slot"], "src": payload["src"],
               "pctr": payload["p"], "serve_ts": payload["ts"], "ts": deps.clock()}
        if not deps.events.publish(rec):
            m.log_dropped.labels(type="impression").inc()
        return Response(status_code=204)

    def redirect(url: str) -> RedirectResponse:
        # 302 y no 301: un 301 lo puede cachear el navegador y el siguiente click ni pasaría por aquí
        # (ni se contaría ni se cobraría). no-store por lo mismo.
        return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})

    def landing_of_unverified(token: str) -> str:
        """Token inválido: si se puede leer el ad_id y existe, a su landing (del ÍNDICE); si no, a la home.

        Nunca se redirige a una URL que venga en el request (open redirect); no se cobra nada.
        """
        payload = T.peek_unverified(token)
        ad = deps.index.get(str(payload.get("ad"))) if payload else None
        return ad.landing_url if ad else s.home_url

    @app.get("/v1/click")
    async def click(background: BackgroundTasks, t: str = Query(..., max_length=2048)) -> RedirectResponse:
        payload = verified(t, s.click_max_age_s, m.click_rejected)
        if payload is None:
            return redirect(landing_of_unverified(t))
        iid = T.imp_id(payload)
        ad = deps.index.get(payload["ad"])
        landing = ad.landing_url if ad else s.home_url
        if not await first_time("click:" + iid):
            m.click_dupes.inc()  # doble click o recarga: redirige, no cobra
            return redirect(landing)
        now = deps.clock()
        price = float(payload["px"])  # el precio de la SUBASTA, firmado: no se recalcula al hacer click
        # Pausada DESPUÉS del serve: la impresión era legítima, se cobra. Servida DESPUÉS de la pausa (un pod
        # con el índice atrasado): no se cobra; es el reclamo de facturación que se evita
        billable = not (ad and ad.paused_at is not None and float(payload["ts"]) >= ad.paused_at)
        rec = {"type": "click", "event_id": uuid.uuid4().hex, "imp_id": iid, "request_id": payload["rid"],
               "ad_id": payload["ad"], "campaign_id": payload["c"], "slot": payload["slot"], "src": payload["src"],
               "price": price if billable else 0.0, "billable": billable, "serve_ts": payload["ts"], "ts": now}
        # El click es FACTURACIÓN: se espera el ack de Kafka (≤ 200 ms) antes de redirigir. Si no llega,
        # igual se redirige (la persona no paga nuestra falla) y se cuenta: el access log del balanceador
        # con el token es la red de seguridad para reconstruirlo.
        res = await timed("click_log", deps.events.publish_and_wait(rec), s.click_log_timeout_s)
        if isinstance(res, Exception):
            m.click_log_failures.inc()
        m.clicks.labels(slot=payload["slot"], src=payload["src"], ad_age=ad_age(ad)).inc()
        if not billable:
            m.not_billed.labels(reason="served_after_pause").inc()
            return redirect(landing)
        m.revenue.inc(price)
        _, _, day = F.local_time(now, s.timezone)  # el gasto cuenta en el día del click
        background.add_task(add_spend, payload["c"], price, day)
        return redirect(landing)

    async def add_spend(campaign_id: str, price: float, day: str) -> None:
        # Camino rápido para el pacing (segundos). El gasto oficial lo agrega el consumer de facturación de
        # ad-events: si esto falla, el pacing ve el gasto con ese atraso, la factura no cambia.
        res = await timed("budget_spend", deps.budget.add_spend(campaign_id, price, day), s.budget_timeout_s * 5)
        if isinstance(res, Exception):
            dep_error("budget_spend", res)

    @app.get("/healthz")
    async def healthz() -> dict:
        # Liveness: el proceso responde. NO depende de Redis ni del modelo (si dependiera, un Redis caído
        # reiniciaría todos los pods a la vez y se perdería también el fallback).
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> JSONResponse:
        # Readiness: modelo cargado Y calentado, índice de anuncios con contenido, llave de firma. Redis
        # caído NO saca el pod (para eso están los fallbacks). Sin modelo, el pod no recibe tráfico: el
        # fallback es para fallas puntuales, no para que una flota entera corra sin modelo sin que nadie lo vea.
        ok = deps.model is not None and warm and len(deps.index) > 0
        return JSONResponse({"ready": ok, "model_version": deps.model.version if deps.model else None,
                             "ads": len(deps.index)}, status_code=200 if ok else 503)

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(m.registry), media_type=CONTENT_TYPE_LATEST)

    return app


def demo_app() -> FastAPI:
    """App local con todo falso salvo el modelo: `uvicorn --factory ad_api:demo_app --port 8080`.

    Entrena la regresión logística con datos SINTÉTICOS al arrancar (training/synthetic.py y
    train_logreg.py; correr con PYTHONPATH=../training). Los pCTR no significan nada fuera de la demo.
    """
    import synthetic  # solo para la demo: no entra al camino de producción
    import train_logreg

    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    world = synthetic.World(seed=7, n_ads=2500, n_advertisers=400)
    model = train_logreg.fit_model(synthetic.training_rows(world, n_pageviews=120_000, neg_rate=0.05, seed=1),
                                   version="demo-lr-synthetic")
    ads = [Ad(**a) for a in world.ads]
    settings = Settings(token_keys={"demo": b"demo-key-not-secret"}, token_kid="demo", base_url="http://localhost:8080")
    return create_app(Deps(
        index=InMemoryTargetingIndex(ads), freq=InMemoryFrequencyStore(),
        budget=InMemoryBudgetStore({c: CampaignBudget(**b) for c, b in world.budgets().items()}),
        users=StaticUserFeatureStore({"u-demo": {"interests": ["autos", "deportes", "politica"]}}),
        model=model, fallback_ctr=SmoothedCTR(world.ctr_table(), world.slot_priors()),
        dedupe=InMemoryDedupeStore(), events=BufferedEventLog(echo=True), settings=settings))
