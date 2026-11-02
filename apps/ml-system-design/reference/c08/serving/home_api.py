"""home-api (caso c08): el feed personalizado del home del marketplace.

GET /v1/home?user_id=…&page=1 → 50 publicaciones para esa persona. SLO: p99 ≤ 200 ms server-side, a
≈ 3,100 RPS de pico. El embudo, con el presupuesto de cada etapa (estimaciones del caso, mídelas):

  contexto   perfil + estado de sesión del usuario (Redis-class)                      ≈ 5 ms
  retrieval  4 fuentes EN PARALELO, cada una con su timeout (≈ 1,000 candidatos)       ≤ 40 ms
               two_tower       ANN sobre el embedding del usuario (≈ 500)
               covisitation    vecinos de lo que vio hace poco (≈ 300)
               trending_city   lo popular en su ciudad (≈ 100)
               followed        vendedores que sigue / búsquedas guardadas (≈ 100)
  merge      dedupe por item_id conservando QUÉ fuentes lo trajeron                    < 1 ms
  filtros    baratos (metadata del candidato): bloqueados, propios, geo, vistos de más  < 1 ms
  features   batch get de usuario + ≈ 1,000 ítems  ┐ EN PARALELO                      ≤ 40 ms
  vendidos   tombstones (el mismo store del c07)   ┘
  ranker     DNN multi-task en Triton: P(click), P(contact | click)                    ≤ 60 ms
  re-rank    diversidad, freshness, vendedor nuevo, exploration 5 % (rerank.py)       ≈ 10 ms (est.)
  log        impresión con el FEATURE SNAPSHOT usado → Kafka, en segundo plano (no bloquea)

Degradación (de menos a más grave; cada paso cuenta en home_fallback_total{reason} salvo el primero):
  1. una fuente vence su timeout   → se sirve con las que contestaron (home_source_timeouts_total)
     un ítem sin features          → valores por defecto (home_feature_defaults_total) y se loguea así
     tombstones sin respuesta      → vendidos según el estado que trae el feature store (y se cuenta)
  2. features o ranker no llegan   → path="heuristic": los candidatos reales, en orden por fuente
                                     (round-robin del rank de cada fuente), sin exploration
  3. sin candidatos / sin contexto → path="popular": lo popular en su ciudad, de una caché en memoria
     o cualquier excepción           que un job refresca cada pocos minutos
Si el home-api entero no contesta, la app muestra lo de hoy ("recientes en tu ciudad"): eso vive del
lado del cliente y no está aquí.

Todo lo externo está detrás de interfaces (Protocol) con fakes en los tests: Redis, el ANN, Triton y
Kafka. Los adaptadores reales no están en esta carpeta porque no se pudieron probar aquí (ver README).
Endpoints: GET /v1/home · GET /healthz · GET /readyz · GET /metrics
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import asyncio  # gather + wait_for: fuentes en paralelo, un timeout por etapa
import json  # el registro de impresión es JSON (en producción, Avro/Protobuf con schema registry)
import logging  # a stdout: en un contenedor los logs son un stream
import math  # seno/coseno de la hora del día (feature de contexto)
import os  # configuración por variables de entorno
import sys  # stdout explícito para el logger
import time  # perf_counter (latencias) y time (timestamps)
import uuid  # request_id cuando el caller no manda uno
from collections.abc import Awaitable  # tipo de las corrutinas que se cronometran
from contextlib import asynccontextmanager  # lifespan: arrancar y parar el publicador de impresiones
from dataclasses import dataclass, field  # contratos internos simples
from typing import Protocol  # interfaces sin herencia: el fake y el real solo cumplen la forma

from fastapi import FastAPI, Query, Request, Response  # framework ASGI
from fastapi.responses import JSONResponse  # 503 explícito cuando no hay ni fallback
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest  # /metrics

import rerank as rr  # serving/rerank.py (se copia junto a este archivo)

# Orden = prioridad para la atribución: si dos fuentes traen el mismo ítem, `source` es la primera de esta
# lista y `sources` guarda todas. Son los valores del label `source` de las métricas (cardinalidad 4).
SOURCES = ("two_tower", "covisitation", "trending_city", "followed")


# ---------------------------------------------------------------------------- configuración
def _env_pairs(name: str, default: str) -> dict[str, float]:
    """'two_tower=40,covisitation=30' → {'two_tower': 40.0, 'covisitation': 30.0}."""
    raw = os.getenv(name, default)
    return {k.strip(): float(v) for k, v in (p.split("=") for p in raw.split(",") if p)}


@dataclass
class Settings:
    # Presupuesto INTERNO del request: 180 ms de los 200 del SLO p99 = las etapas + el overhead en proceso
    # (merge, filtros, armar el tensor del ranker y la respuesta; el final lo cubre reserve_s). Los ≈ 20
    # restantes son margen para la cola del event loop y para serializar y escribir la respuesta: el
    # presupuesto limita las llamadas remotas, no puede cortar un loop bloqueado. La red y el balanceador
    # quedan fuera del SLO (se miden desde el balanceador y la app).
    budget_s: float = float(os.getenv("BUDGET_S", "0.18"))
    # Lo que se reserva al final para re-rank, serializar y responder (no se le da al ranker)
    reserve_s: float = float(os.getenv("RESERVE_S", "0.015"))
    user_timeout_s: float = float(os.getenv("USER_TIMEOUT_MS", "15")) / 1000
    # Timeout POR FUENTE (ms). Ninguna espera a otra: la más lenta no puede comerse el presupuesto entero
    source_timeouts_s: dict[str, float] = field(default_factory=lambda: {k: v / 1000 for k, v in _env_pairs(
        "SOURCE_TIMEOUTS_MS", "two_tower=40,covisitation=30,trending_city=15,followed=30").items()})
    # Cuántos candidatos pide a cada fuente (SPEC: ≈ 500 + 300 + 100 + 100 ≈ 1,000)
    source_quotas: dict[str, int] = field(default_factory=lambda: {k: int(v) for k, v in _env_pairs(
        "SOURCE_QUOTAS", "two_tower=500,covisitation=300,trending_city=100,followed=100").items()})
    features_timeout_s: float = float(os.getenv("FEATURES_TIMEOUT_MS", "40")) / 1000
    ranker_timeout_s: float = float(os.getenv("RANKER_TIMEOUT_MS", "60")) / 1000
    # Vistas sin interacción en 7 días a partir de las cuales un ítem deja de mostrarse a esa persona
    seen_cap: int = int(os.getenv("SEEN_CAP", "3"))
    page_size: int = int(os.getenv("PAGE_SIZE", "50"))
    # Peso del click en el score final: score = P(click) × (P(contact|click) + W_CLICK). El objetivo del
    # negocio es el contacto; el click pesa poco para no premiar el clickbait. Ilustrativo: se ajusta con A/B.
    w_click: float = float(os.getenv("SCORE_W_CLICK", "0.05"))
    exploration_rate: float = float(os.getenv("EXPLORATION_RATE", "0.05"))
    impressions_topic: str = os.getenv("IMPRESSIONS_TOPIC", "home-impressions")
    # Registros en memoria esperando a Kafka. Lleno → se descarta y se cuenta (ver _enqueue_impression)
    impression_buffer: int = int(os.getenv("IMPRESSION_BUFFER", "50000"))
    # Página "nacional" de la caché de populares: el fallback cuando no sabemos la ciudad
    national_key: str = os.getenv("POPULAR_NATIONAL_KEY", "_national")
    # Fracción de requests que loguean TODOS los candidatos (≈ 1,000 ids con sus fuentes, antes de
    # filtrar): es lo que permite medir recall@k por fuente contra los contactos del día siguiente.
    # 1 % alcanza para estimar recall (≈ 900k requests al día) sin duplicar el tamaño del log.
    candidate_log_rate: float = float(os.getenv("CANDIDATE_LOG_RATE", "0.01"))


# ---------------------------------------------------------------------------- contratos internos
@dataclass(frozen=True)
class Candidate:
    """Lo que devuelve una fuente: el id + la metadata barata que viaja como payload en el índice.

    La metadata (vendedor, ciudad, categoría) viene CON el candidato para filtrar ANTES del batch de
    features: sacar 300 de 1,000 candidatos antes de la llamada más cara ahorra tráfico y latencia.
    """

    item_id: str
    seller_id: str
    category: str
    city: str
    ships: bool  # ¿hace envíos? Si no, solo sirve en la ciudad de la persona
    age_h: float  # horas desde que se publicó
    seller_is_new: bool
    retrieval_score: float = 0.0  # similitud, conteo de co-visitas, popularidad… (no comparables entre fuentes)


@dataclass
class UserContext:
    user_id: str
    city: str
    blocked_sellers: frozenset[str] = frozenset()
    seen_counts: dict[str, int] = field(default_factory=dict)  # vistas SIN interacción, 7 días
    served_this_session: frozenset[str] = frozenset()  # lo que ya mostraron las páginas anteriores
    recent_items: tuple[str, ...] = ()  # últimas vistas (las usa covisitation)
    followed_sellers: tuple[str, ...] = ()
    is_new_user: bool = False  # cold start: el two-tower no tiene historial; el caso usa onboarding


@dataclass
class FeatureBatch:
    """Resultado del batch get. Faltantes = ausentes del dict (o None): se completan con defaults."""

    feature_set_version: str  # versión del esquema: debe coincidir con la que espera el ranker
    user: list[float] | None
    items: dict[str, list[float]]
    # Ítems cuyo ESTADO en el feature store (lo escribe el job de streaming) dice vendido o removido.
    # Es la segunda fuente de "vendidos": se usa solo si el store de tombstones no contesta.
    unavailable: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class FeatureSchema:
    """Orden y defaults de las features. El MISMO objeto lo usa training (build_training_set lee el
    snapshot logueado, que ya trae los defaults aplicados: así no hay skew de defaults)."""

    version: str
    user_defaults: tuple[float, ...]
    item_defaults: tuple[float, ...]  # contadores en 0, tasas en el prior global (no en 0: un CTR de 0
    #                                   le dice al ranker "nadie lo quiere", y es solo "no sabemos")


@dataclass
class RankerOutput:
    model_version: str
    p_click: list[float]
    p_contact_given_click: list[float]


# ---------------------------------------------------------------------------- interfaces
class CandidateSource(Protocol):
    name: str

    async def fetch(self, user: UserContext, k: int) -> list[Candidate]: ...


class UserStore(Protocol):
    """Perfil + estado de sesión (Redis-class). add_served lo escribe este servicio: la página 2 llega
    segundos después de la 1, antes de que el stream actualice las features (≤ 1 min)."""

    async def get(self, user_id: str) -> UserContext | None: ...

    async def add_served(self, user_id: str, item_ids: list[str]) -> None: ...


class AvailabilityStore(Protocol):
    """Tombstones de vendidos/removidos (el mismo del c07: ≤ 1 min desde que se vende)."""

    async def unavailable(self, item_ids: list[str]) -> set[str]: ...


class FeatureStore(Protocol):
    """Online store: UNA llamada para el usuario y todos los ítems (pipelined MGET), no 1,000."""

    async def get(self, user_id: str, item_ids: list[str]) -> FeatureBatch: ...


class Ranker(Protocol):
    """En producción: tritonclient contra el modelo `home_ranker` (≈ 1,000 filas por request)."""

    async def score(self, user: list[float], context: list[float],
                    items: list[list[float]]) -> RankerOutput: ...


class PopularCache(Protocol):
    """Populares por ciudad, precomputados por un job cada pocos minutos y cacheados EN MEMORIA:
    el fallback no puede depender de los mismos servicios que acaban de fallar."""

    def get(self, city: str) -> list[Candidate]: ...

    def loaded(self) -> bool: ...


class ImpressionLog(Protocol):
    """Productor de Kafka (acks=all, idempotente). key = user_id: los eventos de una persona en orden."""

    async def publish(self, topic: str, key: str, value: bytes) -> None: ...


@dataclass
class Deps:
    users: UserStore
    sources: list[CandidateSource]
    availability: AvailabilityStore
    features: FeatureStore
    ranker: Ranker
    popular: PopularCache
    impressions: ImpressionLog
    schema: FeatureSchema


# ---------------------------------------------------------------------------- métricas
# Nombres = contrato con monitoring/alerts.yml (un test lo verifica). Labels de cardinalidad acotada:
# nunca user_id ni item_id como label (serían millones de series).
REQUESTS = Counter("home_requests_total", "Requests a /v1/home", ["status", "path"])
LATENCY = Histogram(  # buckets alrededor del SLO (0.2 s) para que el p99 sea preciso donde importa
    "home_request_duration_seconds", "Latencia server-side de /v1/home",
    buckets=(0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.175, 0.2, 0.25, 0.3, 0.5, 1.0),
)
STAGE_LATENCY = Histogram(  # ¿qué etapa se come el presupuesto?
    "home_stage_duration_seconds", "Duración de cada etapa del home", ["stage"],
    buckets=(0.001, 0.0025, 0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15),
)
SOURCE_REQUESTS = Counter("home_source_requests_total", "Llamadas a cada fuente", ["source"])
SOURCE_TIMEOUTS = Counter("home_source_timeouts_total", "Fuentes que vencieron su timeout", ["source"])
SOURCE_ERRORS = Counter("home_source_errors_total", "Fuentes que fallaron con error", ["source"])
CANDIDATES = Counter("home_candidates_total", "Candidatos devueltos por fuente (antes de dedupe)", ["source"])
FILTERED = Counter("home_filtered_total", "Candidatos descartados por filtro", ["reason"])
FEATURE_LOOKUPS = Counter("home_feature_lookups_total", "Entidades pedidas al feature store", ["entity"])
FEATURE_DEFAULTS = Counter(  # entidades servidas con valores por defecto: la señal de FeatureStoreStale
    "home_feature_defaults_total", "Entidades sin features (se usaron defaults)", ["entity"],
)
FALLBACKS = Counter("home_fallback_total", "Respuestas degradadas por motivo", ["reason"])
ITEMS_SERVED = Counter("home_items_served_total", "Ítems servidos por camino", ["path"])
EXPLORATION = Counter("home_exploration_items_total", "Ítems de exploración servidos (camino ranked)")
RANKER_SCORE = Histogram(  # P(click) y P(contact|click) de la primera pantalla: RankerScoreShift
    "home_ranker_score", "Scores del ranker en las primeras 10 posiciones", ["head"],
    buckets=(0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0),
)
IMPRESSIONS_BUFFERED = Gauge("home_impression_log_buffered", "Registros de impresión esperando a Kafka")
IMPRESSIONS_DROPPED = Counter("home_impression_log_dropped_total", "Registros descartados (buffer lleno)")
IMPRESSIONS_FAILED = Counter("home_impression_log_failures_total", "Registros que Kafka rechazó tras reintentos")

STAGES = ("user", "retrieval", "features", "ranker", "rerank", "total")
FALLBACK_REASONS = ("features_unavailable", "ranker_timeout", "ranker_error", "no_candidates",
                    "user_context_unavailable", "internal_error")
PATHS = ("ranked", "heuristic", "popular")

log = logging.getLogger("home-api")
log.addHandler(logging.StreamHandler(sys.stdout))
log.setLevel(logging.INFO)
log.propagate = False


def _init_metrics() -> None:
    """Crea en 0 las series con labels conocidos: un rate() sobre una serie que no existe no es 0, es
    VACÍO, y una alerta de ratio sin numerador no dispara nunca (o dispara tarde)."""
    for s in SOURCES:
        SOURCE_REQUESTS.labels(source=s)
        SOURCE_TIMEOUTS.labels(source=s)
        SOURCE_ERRORS.labels(source=s)
        CANDIDATES.labels(source=s)
    for r in FALLBACK_REASONS:
        FALLBACKS.labels(reason=r)
    for p in PATHS:
        ITEMS_SERVED.labels(path=p)
    for e in ("user", "item"):
        FEATURE_LOOKUPS.labels(entity=e)
        FEATURE_DEFAULTS.labels(entity=e)


# ---------------------------------------------------------------------------- utilidades puras
class _Fallback(Exception):
    """Señal interna: degradar al siguiente escalón con este motivo."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def combine(p_click: float, p_contact_given_click: float, w_click: float) -> float:
    """Valor esperado para ordenar: P(click) × (P(contact|click) + w).

    P(click) × P(contact|click) = P(contact): lo que le importa al negocio. El término w × P(click)
    rompe empates entre ítems sin historial de contactos. Multiplicar dos cabezas de un multi-task
    supone que las dos están CALIBRADAS: si una no lo está, el producto ordena mal (ver el caso).
    """
    return p_click * (p_contact_given_click + w_click)


def merge_candidates(by_source: dict[str, list[Candidate]]) -> tuple[list[Candidate], dict[str, list[str]],
                                                                       dict[str, int]]:
    """Dedupe por item_id. Devuelve (únicos en orden de prioridad de fuente, item → fuentes, item → mejor rank).

    El "mejor rank" es la posición más alta del ítem en cualquiera de sus fuentes: lo usa el orden
    heurístico del fallback. Que un ítem venga de 3 fuentes es información (se loguea en `sources`).
    """
    seen: dict[str, Candidate] = {}
    sources: dict[str, list[str]] = {}
    best_rank: dict[str, int] = {}
    for src in SOURCES:  # orden fijo: la fuente principal de un duplicado es determinista
        for rank, c in enumerate(by_source.get(src, [])):
            if c.item_id not in seen:
                seen[c.item_id] = c
                sources[c.item_id] = [src]
                best_rank[c.item_id] = rank
            elif src not in sources[c.item_id]:
                sources[c.item_id].append(src)
                best_rank[c.item_id] = min(best_rank[c.item_id], rank)
    return list(seen.values()), sources, best_rank


def cheap_filters(cands: list[Candidate], user: UserContext, seen_cap: int) -> tuple[list[Candidate],
                                                                                       dict[str, int]]:
    """Filtros que solo necesitan la metadata del candidato y el contexto: corren ANTES del batch de
    features. Devuelve (los que pasan, conteo por motivo). El orden de los chequeos define el motivo."""
    kept, dropped = [], {}
    for c in cands:
        if c.seller_id == user.user_id:
            reason = "own_listing"  # sus propias publicaciones (seller_id = user_id en este marketplace)
        elif c.seller_id in user.blocked_sellers:
            reason = "blocked"  # un vendedor que bloqueó: mostrarlo es un problema de confianza, no de relevancia
        elif not c.ships and c.city != user.city:
            reason = "geo"  # no hace envíos y está en otra ciudad: no se puede comprar
        elif c.item_id in user.served_this_session:
            reason = "served_this_session"  # ya salió en una página anterior de este scroll
        elif user.seen_counts.get(c.item_id, 0) >= seen_cap:
            reason = "seen_cap"  # lo vio 3 veces sin tocarlo: mostrarlo una cuarta es ruido
        else:
            kept.append(c)
            continue
        dropped[reason] = dropped.get(reason, 0) + 1
    return kept, dropped


def heuristic_order(cands: list[Candidate], best_rank: dict[str, int], sources: dict[str, list[str]]
                    ) -> list[tuple[Candidate, float]]:
    """Orden del fallback sin ranker: round-robin por fuente según el rank dentro de cada fuente.

    Los scores de retrieval NO son comparables entre fuentes (similitud coseno vs conteos), así que no
    se ordena por ellos: se intercalan los primeros de cada fuente. Score heurístico = 1 / (1 + rank).
    """
    prio = {s: i for i, s in enumerate(SOURCES)}
    keyed = sorted(cands, key=lambda c: (best_rank[c.item_id], prio[sources[c.item_id][0]], c.item_id))
    return [(c, 1.0 / (1 + best_rank[c.item_id])) for c in keyed]


def context_features(now: float, page: int) -> list[float]:
    """Features de contexto calculadas aquí (no vienen del store). Hora del día como seno/coseno.

    La POSICIÓN no está: al servir no se conoce (es lo que estamos decidiendo). En training la posición
    es una feature para separar "le gustó" de "estaba arriba"; al servir, el modelo recibe una posición
    FIJA (1), que agrega el propio modelo exportado (o un ensemble de Triton). La evaluación offline
    usa ese mismo valor fijo: si no, mide un modelo distinto del que se sirve.
    """
    hour = (now % 86400) / 3600  # UTC; en producción, hora LOCAL de la persona
    return [math.sin(2 * math.pi * hour / 24), math.cos(2 * math.pi * hour / 24), float(page)]


# ---------------------------------------------------------------------------- estado
@dataclass
class State:
    settings: Settings
    deps: Deps
    queue: asyncio.Queue | None = None
    tasks: set[asyncio.Task] = field(default_factory=set)  # referencias fuertes: sin esto el GC puede
    #                                                         matar un create_task a medias


async def _timed(stage: str, coro: Awaitable, timeout: float):
    """wait_for + histograma por etapa. Al vencer se CANCELA la llamada (no queda trabajando de fondo)."""
    t = time.perf_counter()
    try:
        return await asyncio.wait_for(coro, timeout=max(0.0, timeout))
    finally:
        STAGE_LATENCY.labels(stage=stage).observe(time.perf_counter() - t)


async def _call_source(src: CandidateSource, user: UserContext, k: int, timeout: float
                       ) -> tuple[str, list[Candidate] | None, str | None]:
    """Una fuente con su propio timeout. Nunca lanza: devuelve (nombre, candidatos | None, motivo)."""
    SOURCE_REQUESTS.labels(source=src.name).inc()
    try:
        out = await asyncio.wait_for(src.fetch(user, k), timeout=max(0.0, timeout))
        CANDIDATES.labels(source=src.name).inc(len(out))
        return src.name, out[:k], None
    except TimeoutError:
        SOURCE_TIMEOUTS.labels(source=src.name).inc()
        return src.name, None, "timeout"
    except Exception:
        SOURCE_ERRORS.labels(source=src.name).inc()
        return src.name, None, "error"


# ---------------------------------------------------------------------------- el pipeline
async def build_feed(st: State, user_id: str, page: int, request_id: str) -> dict:
    """Devuelve la respuesta y encola el registro de impresión. Ver el docstring del módulo."""
    s, d = st.settings, st.deps
    t0 = time.perf_counter()
    deadline = t0 + s.budget_s
    left = lambda: deadline - time.perf_counter()  # noqa: E731 — lo que queda del presupuesto
    now = time.time()
    record: dict = {"sources_failed": {}, "filtered": {}}
    user: UserContext | None = None

    try:
        # -- 1. contexto del usuario. Sin él no hay ciudad, ni bloqueados, ni historial → populares
        try:
            user = await _timed("user", d.users.get(user_id), min(s.user_timeout_s, left()))
        except Exception:
            user = None
        if user is None:
            raise _Fallback("user_context_unavailable")

        # -- 2. retrieval: las 4 fuentes EN PARALELO, cada una con su timeout
        t = time.perf_counter()
        calls = [_call_source(src, user, s.source_quotas.get(src.name, 100),
                              min(s.source_timeouts_s.get(src.name, 0.04), left() - s.reserve_s))
                 for src in d.sources]
        results = await asyncio.gather(*calls)
        STAGE_LATENCY.labels(stage="retrieval").observe(time.perf_counter() - t)
        by_source = {name: out for name, out, _ in results if out is not None}
        record["sources_failed"] = {name: why for name, _, why in results if why}

        merged, sources, best_rank = merge_candidates(by_source)
        # Muestra determinista por request (otro prefijo que la semilla de exploración: muestras independientes)
        if rr.seed_from_request("candlog:" + request_id) / 2**64 < s.candidate_log_rate:
            record["candidates"] = [{"item_id": c.item_id, "sources": sources[c.item_id]} for c in merged]
        kept, dropped = cheap_filters(merged, user, s.seen_cap)
        if not kept:
            raise _Fallback("no_candidates")

        # -- 3. features + vendidos EN PARALELO (los dos dependen solo de la lista de ids). Se piden
        #       features de algunos ítems que después resultan vendidos: es más barato que esperar una
        #       llamada para empezar la otra (≈ 40 ms en paralelo contra ≈ 40 + 15 ms en serie, est.).
        ids = [c.item_id for c in kept]
        budget = min(s.features_timeout_s, left() - s.reserve_s)
        feats_r, sold_r = await asyncio.gather(
            _timed("features", d.features.get(user_id, ids), budget),
            asyncio.wait_for(d.availability.unavailable(ids), timeout=max(0.0, budget)),
            return_exceptions=True,
        )
        if isinstance(sold_r, BaseException):
            # Plan B: el estado de cada ítem que trae el feature store (lo escribe el job de streaming,
            # ≤ 1 min en condiciones normales). Si tampoco hay features, se sirve sin chequeo: algún
            # vendido puede colarse (el clic muestra "vendido"). Molesto, no dañino; peor sería tirar el
            # feed. En los dos casos se cuenta para verlo.
            FILTERED.labels(reason="availability_check_failed").inc()
            sold = set() if isinstance(feats_r, BaseException) else set(feats_r.unavailable)
        else:
            sold = sold_r
        if sold:
            kept = [c for c in kept if c.item_id not in sold]
            dropped["sold"] = dropped.get("sold", 0) + len(ids) - len(kept)
        record["filtered"] = dropped
        for reason, n in dropped.items():
            FILTERED.labels(reason=reason).inc(n)
        if not kept:
            raise _Fallback("no_candidates")

        ctx = context_features(now, page)
        ranked_path = True
        try:
            if isinstance(feats_r, BaseException):
                raise _Fallback("features_unavailable")
            user_vec, item_vecs, defaulted = _apply_defaults(feats_r, user_id, kept, d.schema)
            # -- 4. ranker (Triton): una llamada con todas las filas
            try:
                out = await _timed("ranker", d.ranker.score(user_vec, ctx, item_vecs),
                                   min(s.ranker_timeout_s, left() - s.reserve_s))
            except TimeoutError:
                raise _Fallback("ranker_timeout") from None
            except Exception:
                raise _Fallback("ranker_error") from None
            if len(out.p_click) != len(kept) or len(out.p_contact_given_click) != len(kept):
                raise _Fallback("ranker_error")  # salida con forma inesperada = modelo equivocado
            scores = {c.item_id: (pc, pk, combine(pc, pk, s.w_click))
                      for c, pc, pk in zip(kept, out.p_click, out.p_contact_given_click)}
            to_rerank = [rr.Scored(c.item_id, scores[c.item_id][2], c.category, c.seller_id, c.age_h,
                                   c.seller_is_new, sources[c.item_id][0]) for c in kept]
            model_version = out.model_version
            snapshot = {"user": user_vec, "context": ctx,
                        "items": dict(zip([c.item_id for c in kept], item_vecs)),
                        "defaulted": defaulted, "feature_set_version": d.schema.version}
        except _Fallback as fb:
            # Escalón 2: los candidatos REALES (personalizados) en orden heurístico. Sin exploration:
            # la exploración se mide contra el ranker; mezclarla con este orden ensucia esos datos.
            FALLBACKS.labels(reason=fb.reason).inc()
            record["fallback_reason"] = fb.reason
            ranked_path = False
            to_rerank = [rr.Scored(c.item_id, h, c.category, c.seller_id, c.age_h, c.seller_is_new,
                                   sources[c.item_id][0]) for c, h in heuristic_order(kept, best_rank, sources)]
            scores, model_version, snapshot = {}, None, None

        # -- 5. re-rank
        t = time.perf_counter()
        cfg = rr.RerankConfig(page_size=s.page_size, exploration_rate=s.exploration_rate, explore=ranked_path)
        slots = rr.rerank(to_rerank, request_id, cfg)
        STAGE_LATENCY.labels(stage="rerank").observe(time.perf_counter() - t)
        path = "ranked" if ranked_path else "heuristic"
        by_id = {c.item_id: c for c in kept}

    except _Fallback as fb:
        # Escalón 3: populares en su ciudad (o nacionales si no sabemos la ciudad)
        FALLBACKS.labels(reason=fb.reason).inc()
        return await _popular_response(st, user_id, page, request_id, fb.reason, user, t0)

    # -- 6. respuesta + registro de impresión (en segundo plano)
    offset = (page - 1) * s.page_size  # posición GLOBAL en el scroll: la 51 es la primera de la página 2
    items_out, items_log = [], []
    for sl in slots:
        pos = offset + sl.position
        items_out.append({"item_id": sl.item_id, "position": pos, "source": sl.source,
                          "exploration": sl.exploration})
        entry = {"item_id": sl.item_id, "position": pos, "source": sl.source,
                 "sources": sources[sl.item_id], "score": round(sl.score, 6),
                 "exploration": sl.exploration, "propensity": sl.propensity, "reasons": sl.reasons}
        if ranked_path:
            pc, pk, _ = scores[sl.item_id]
            entry |= {"p_click": round(pc, 6), "p_contact_given_click": round(pk, 6),
                      "features": snapshot["items"][sl.item_id],
                      "features_defaulted": sl.item_id in snapshot["defaulted"]}
            if pos <= 10:  # solo la primera pantalla REAL (página 1): la profundidad del scroll no mueve el histograma
                RANKER_SCORE.labels(head="click").observe(pc)
                RANKER_SCORE.labels(head="contact_given_click").observe(pk)
        items_log.append(entry)
    ITEMS_SERVED.labels(path=path).inc(len(slots))
    EXPLORATION.inc(sum(1 for sl in slots if sl.exploration))

    _enqueue_impression(st, user_id, {
        "schema": "home_impression_v1", "request_id": request_id, "user_id": user_id, "ts": now,
        "page": page, "path": path, "fallback_reason": record.get("fallback_reason"),
        "model_version": model_version, "city": user.city, "is_new_user": user.is_new_user,
        "feature_set_version": snapshot["feature_set_version"] if snapshot else None,
        "user_features": snapshot["user"] if snapshot else None,
        "context_features": snapshot["context"] if snapshot else None,
        "user_features_defaulted": ("__user__" in snapshot["defaulted"]) if snapshot else None,
        "sources_failed": record["sources_failed"], "filtered": record["filtered"],
        "candidates": record.get("candidates"),  # solo en la muestra de CANDIDATE_LOG_RATE; si no, null
        "items": items_log,
    })
    _remember_served(st, user_id, [sl.item_id for sl in slots])
    return {"request_id": request_id, "path": path, "fallback_reason": record.get("fallback_reason"),
            "model_version": model_version, "page": page, "items": items_out,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}


def _apply_defaults(fb: FeatureBatch, user_id: str, kept: list[Candidate], schema: FeatureSchema
                    ) -> tuple[list[float], list[list[float]], set[str]]:
    """Completa con defaults lo que falta y CUENTA cuántos. Un vector con otro largo (otra versión del
    esquema) también es "falta": darle al ranker features corridas un lugar es peor que el default."""
    if fb.feature_set_version != schema.version:
        raise _Fallback("features_unavailable")  # versión distinta = skew garantizado: mejor no rankear
    defaulted: set[str] = set()
    FEATURE_LOOKUPS.labels(entity="user").inc()
    user = fb.user
    if user is None or len(user) != len(schema.user_defaults):
        user = list(schema.user_defaults)
        defaulted.add("__user__")
        FEATURE_DEFAULTS.labels(entity="user").inc()
    vecs = []
    for c in kept:
        v = fb.items.get(c.item_id)
        if v is None or len(v) != len(schema.item_defaults):
            v = list(schema.item_defaults)
            defaulted.add(c.item_id)
        vecs.append(list(v))
    FEATURE_LOOKUPS.labels(entity="item").inc(len(kept))
    FEATURE_DEFAULTS.labels(entity="item").inc(sum(1 for c in kept if c.item_id in defaulted))
    return list(user), vecs, defaulted


async def _popular_response(st: State, user_id: str, page: int, request_id: str, reason: str,
                            user: UserContext | None, t0: float) -> dict:
    """Escalón 3. Lo popular de la ciudad sale de memoria; los vendidos se quitan si el store contesta
    rápido (≤ 15 ms) y, si no, se sirve igual. Sin exploration ni feature snapshot."""
    s, d = st.settings, st.deps
    city = user.city if user else s.national_key
    cands = d.popular.get(city) or d.popular.get(s.national_key) or []
    if not cands:
        raise RuntimeError("popular cache empty")  # → 503 en el handler: no queda ningún escalón
    if user is not None:
        cands, _ = cheap_filters(cands, user, s.seen_cap)
    try:
        sold = await asyncio.wait_for(d.availability.unavailable([c.item_id for c in cands]), timeout=0.015)
        cands = [c for c in cands if c.item_id not in sold]
    except Exception:
        FILTERED.labels(reason="availability_check_failed").inc()
    offset = (page - 1) * s.page_size
    if user is None:
        # Sin contexto no hubo filtro por sesión: la lista es la misma para todos y se pagina por offset
        chosen = cands[offset: offset + s.page_size]
    else:
        # cheap_filters ya sacó lo servido en las páginas anteriores (served_this_session): saltar
        # además el offset dejaría sin mostrar ≈ 50 populares que nadie vio. Pasa también cuando la
        # página 1 salió del ranker y la 2 cae a populares.
        chosen = cands[: s.page_size]
    items = [{"item_id": c.item_id, "position": offset + i + 1, "source": "popular", "exploration": False}
             for i, c in enumerate(chosen)]
    ITEMS_SERVED.labels(path="popular").inc(len(items))
    _enqueue_impression(st, user_id, {
        "schema": "home_impression_v1", "request_id": request_id, "user_id": user_id, "ts": time.time(),
        "page": page, "path": "popular", "fallback_reason": reason, "model_version": None,
        "city": city, "feature_set_version": None, "user_features": None, "context_features": None,
        "items": [{**it, "sources": ["popular"], "propensity": None} for it in items],
    })
    if user is not None:
        _remember_served(st, user_id, [c.item_id for c in chosen])
    return {"request_id": request_id, "path": "popular", "fallback_reason": reason, "model_version": None,
            "page": page, "items": items, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}


def _enqueue_impression(st: State, user_id: str, record: dict) -> None:
    """Encola sin bloquear. Lleno (Kafka caído varios segundos) → se descarta y se cuenta.

    Por qué no esperar a Kafka dentro del request: un broker lento sumaría latencia a cada home.
    El costo: un pod que muere con registros en el buffer los pierde, y esas impresiones no tendrán
    ejemplo de entrenamiento. Si la pérdida se concentra en el pico, sesga los datos hacia las horas
    tranquilas: por eso hay métrica y alerta (ImpressionLogLag).
    """
    try:
        st.queue.put_nowait((user_id, record))
    except asyncio.QueueFull:
        IMPRESSIONS_DROPPED.inc()
    IMPRESSIONS_BUFFERED.set(st.queue.qsize())


def _remember_served(st: State, user_id: str, item_ids: list[str]) -> None:
    """Escribe lo servido en la sesión SIN esperar (la respuesta no depende de esto)."""
    task = asyncio.create_task(_safe(st.deps.users.add_served(user_id, item_ids)))
    st.tasks.add(task)
    task.add_done_callback(st.tasks.discard)


async def _safe(coro: Awaitable) -> None:
    try:
        await asyncio.wait_for(coro, timeout=0.5)
    except Exception:
        pass  # perderlo solo significa que la página 2 podría repetir algún ítem


async def _publish_loop(st: State) -> None:
    """Vacía el buffer hacia Kafka con 3 intentos y backoff. key = user_id."""
    while True:
        user_id, record = await st.queue.get()
        try:
            payload = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            for attempt in range(3):
                try:
                    await st.deps.impressions.publish(st.settings.impressions_topic, user_id, payload)
                    break
                except Exception:
                    if attempt == 2:
                        IMPRESSIONS_FAILED.inc()
                    else:
                        await asyncio.sleep(0.05 * 2**attempt)
        finally:
            st.queue.task_done()
            IMPRESSIONS_BUFFERED.set(st.queue.qsize())


# ---------------------------------------------------------------------------- app
def create_app(deps: Deps, settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    st = State(settings, deps)
    _init_metrics()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        st.queue = asyncio.Queue(maxsize=settings.impression_buffer)
        pub = asyncio.create_task(_publish_loop(st))
        yield
        # Apagado (SIGTERM): hasta 5 s para vaciar el buffer, dentro del terminationGracePeriodSeconds
        try:
            await asyncio.wait_for(st.queue.join(), timeout=5)
        except TimeoutError:
            pass
        pub.cancel()

    app = FastAPI(title="home-api (c08)", lifespan=lifespan)
    app.state.st = st

    @app.get("/v1/home")
    async def home(request: Request, user_id: str = Query(min_length=1, max_length=64),
                   page: int = Query(default=1, ge=1, le=20)):
        # request_id: el que manda el gateway/app (para correlacionar con los eventos del cliente) o uno nuevo
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
        t0 = time.perf_counter()
        status, path = "200", "popular"
        try:
            body = await build_feed(st, user_id, page, request_id)
            path = body["path"]
        except Exception as exc:  # bug en el pipeline: escalón 3 igual, nunca un 500 si hay populares
            log.error(json.dumps({"event": "home_error", "request_id": request_id, "error": type(exc).__name__}))
            FALLBACKS.labels(reason="internal_error").inc()
            try:
                body = await _popular_response(st, user_id, page, request_id, "internal_error", None, t0)
            except Exception:
                status = "503"
                REQUESTS.labels(status=status, path="none").inc()
                return JSONResponse({"request_id": request_id, "error": "unavailable"}, status_code=503,
                                    headers={"Retry-After": "1"})
        finally:
            elapsed = time.perf_counter() - t0
            LATENCY.observe(elapsed)
            STAGE_LATENCY.labels(stage="total").observe(elapsed)
        REQUESTS.labels(status=status, path=path).inc()
        return body

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}  # liveness: el proceso responde. Nada de dependencias aquí

    @app.get("/readyz")
    async def readyz():
        # readiness: sin la caché de populares no hay ni el último escalón → no recibir tráfico.
        # Redis, el ANN o Triton caídos NO sacan al pod: para eso están los escalones 1 y 2, y sacar
        # todos los pods a la vez convertiría una degradación en una caída.
        if deps.popular.loaded():
            return {"status": "ready"}
        return JSONResponse({"status": "popular cache not loaded"}, status_code=503)

    @app.get("/metrics")
    async def metrics():
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


def build_app() -> FastAPI:
    """Producción: `uvicorn --factory home_api:build_app`. Falta conectar los adaptadores reales.

    No se incluyen porque no se pudieron probar aquí (sin Redis, sin el índice ANN, sin Triton, sin
    Kafka), y código de red sin probar no se publica como referencia. Lo que cada uno tiene que hacer:
      - UserStore / FeatureStore / AvailabilityStore: cliente async de Redis-class con pipelining
        (un MGET por bloque, no 1,000 GETs); el FeatureStore puede ser el online store de Feast.
      - CandidateSource × 4: el ANN del item tower (como el índice del c07), la tabla de co-visitación
        (retrieval/covisitation.py la calcula offline y se carga en el KV store), trending por ciudad
        y vendedores seguidos.
      - Ranker: tritonclient.http.aio contra el modelo `home_ranker` (entradas user, context, items).
      - ImpressionLog: productor de Kafka con acks=all y enable.idempotence=true.
      - PopularCache: snapshot en memoria que una tarea refresca desde el output del job de populares.
    """
    raise NotImplementedError("conecta los adaptadores reales de Redis, ANN, Triton y Kafka (ver README)")


# ---------------------------------------------------------------------------- demo local (fakes)
def _demo_item(i: int) -> Candidate:
    """Catálogo SINTÉTICO de la demo: 300 vendedores, 40 categorías, 1 de cada 10 en otra ciudad."""
    return Candidate(f"i{i}", f"s{i % 300}", f"c{i % 40}", "gdl" if i % 10 == 9 else "cdmx",
                     i % 10 != 9, float(i % 72), (i % 300) % 50 == 0)


class _DemoSource:
    def __init__(self, name: str, start: int, delay_s: float):
        self.name, self.start, self.delay_s = name, start, delay_s

    async def fetch(self, user: UserContext, k: int) -> list[Candidate]:
        await asyncio.sleep(self.delay_s)  # ≈ lo que tardaría la fuente real (est.); súbelo para ver un timeout
        offset = sum(map(ord, user.user_id)) % 50  # cada usuario ve un corte distinto del catálogo
        return [_demo_item(self.start + offset + j) for j in range(k)]


class _DemoUsers:
    def __init__(self):
        self.served: dict[str, set[str]] = {}

    async def get(self, user_id: str) -> UserContext:
        return UserContext(user_id, "cdmx", served_this_session=frozenset(self.served.get(user_id, ())))

    async def add_served(self, user_id: str, item_ids: list[str]) -> None:
        self.served.setdefault(user_id, set()).update(item_ids)


class _DemoFeatures:
    async def get(self, user_id: str, item_ids: list[str]) -> FeatureBatch:
        await asyncio.sleep(0.005)
        return FeatureBatch("demo-fs-1", [0.0] * 4, {i: [float(int(i[1:]) % 7), 1.0, 0.03, 0.0, 0.5, 1.0]
                                                     for i in item_ids})


class _DemoRanker:
    model_version = "demo-ranker-0"

    async def score(self, user, context, items) -> RankerOutput:
        await asyncio.sleep(0.01)  # NO es un modelo: un score derivado de la primera feature
        return RankerOutput(self.model_version, [0.01 + 0.02 * v[0] for v in items], [0.1] * len(items))


class _DemoPopular:
    def get(self, city: str) -> list[Candidate]:
        return [_demo_item(5000 + j) for j in range(200)]

    def loaded(self) -> bool:
        return True


class _StdoutImpressions:
    async def publish(self, topic: str, key: str, value: bytes) -> None:
        print(f"[kafka:{topic}] key={key} {len(value):,} bytes {value[:100].decode('utf-8', 'replace')}…", flush=True)


def demo_app() -> FastAPI:
    """Demo local SIN Redis, ANN, Triton ni Kafka: `uvicorn --factory home_api:demo_app --port 8080`."""
    srcs = [_DemoSource("two_tower", 0, 0.015), _DemoSource("covisitation", 300, 0.008),
            _DemoSource("trending_city", 600, 0.002), _DemoSource("followed", 700, 0.005)]
    schema = FeatureSchema("demo-fs-1", (0.0,) * 4, (0.0, 0.0, 0.02, 0.0, 0.0, 0.0))
    return create_app(Deps(_DemoUsers(), srcs, _DemoAvailability(), _DemoFeatures(), _DemoRanker(),
                           _DemoPopular(), _StdoutImpressions(), schema))


class _DemoAvailability:
    async def unavailable(self, item_ids: list[str]) -> set[str]:
        return {i for i in item_ids if i.endswith("7")}  # "vendidos": todo id que termina en 7
