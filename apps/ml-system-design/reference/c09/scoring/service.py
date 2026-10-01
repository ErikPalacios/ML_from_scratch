"""Servicio de scoring de fraude (caso c09): POST /v1/score dentro del flujo de autorización.

El orquestador de pagos llama aquí ANTES de pedir la autorización al emisor. SLO del caso: p99 ≤ 100 ms
para el chequeo completo, visto por el orquestador. Este servicio se da 80 ms internos (BUDGET_MS); los
≈ 20 restantes son red, balanceador y la cola del event loop: el presupuesto corta llamadas remotas, no
puede cortar un loop bloqueado. Presupuesto por etapa (estimaciones del caso; mídelas):

  caché de decisión  ¿este payment_id ya se decidió? (reintento)                ≤ 5 ms
  contadores sync    leer + sumar velocidades en el KV store (Redis-class)       ┐ EN PARALELO, ≤ 20 ms
  features           stream (Flink) + batch (diario) del online store            ┘ ≤ 25 ms
  reglas             lista negra, límites duros, reglas del comercio (en proceso) ≈ < 1 ms
  modelo             GBDT en CPU, en este proceso                                 ≤ 10 ms (≈ 1–5 ms, est.)
  decisión           umbrales por segmento, exploración, reason codes            < 1 ms
  log                registro de la decisión con el feature snapshot (no bloquea)

Degradación (campo `path` de la respuesta y del log: "model" o "rules_only"):
  - falta un grupo de features PERMITIDO (policy.yaml: batch) → NaN para ese grupo, se cuenta en
    fraud_feature_defaults_total{group}, queda en `groups_defaulted` y el modelo decide igual (vio NaN
    ahí al entrenar): path="model";
  - contadores sync o features stream no llegan, el modelo falla o tarda, o no queda presupuesto →
    path="rules_only" (y suma en fraud_fallback_total{reason}): reglas (con el contador LOCAL del pod si el KV store no contestó) + la acción
    `fallback` del segmento. Nunca se bloquean todos los pagos;
  - si este servicio entero no contesta en 100 ms, el ORQUESTADOR aplica su propio rules-only (fuera de
    esta carpeta) y lo cuenta: es la segunda rama de FraudFallbackActive.
Un pago con step-up llama DOS veces con el mismo payment_id: la segunda trae `three_ds_result`. Los
contadores no vuelven a sumar (y devuelven lo que vio la primera), y la decisión se toma de nuevo.

Todo lo externo está detrás de interfaces (Protocol) con fakes en los tests: KV store, online store,
caché de decisiones y log de decisiones (Kafka). Los adaptadores reales no están en esta carpeta porque
no se pudieron probar aquí (ver README). El modelo sí es real: un GBDT de sklearn entrenado en los tests.
Endpoints: POST /v1/score · GET /healthz · GET /readyz · GET /metrics
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import asyncio  # gather + wait_for: un timeout por etapa
import hashlib  # sha256 del artefacto del modelo antes de deserializarlo
import json  # el registro de decisión es JSON aquí (en producción Avro/Protobuf con schema registry)
import logging  # a stdout: en un contenedor los logs son un stream
import os  # configuración por variables de entorno
import pickle  # formato del modelo de sklearn (ver SklearnModel: solo con checksum)
import sys  # stdout explícito
import time  # perf_counter para latencias, time() para event_time
from collections import deque  # buffer acotado del log de decisiones
from collections.abc import Callable  # reloj inyectable
from concurrent.futures import ThreadPoolExecutor  # threads propios del modelo (ver _model_thread_init)
from contextlib import asynccontextmanager  # lifespan: cerrar el executor del modelo
from dataclasses import dataclass, field  # configuración y dependencias
from pathlib import Path  # rutas de policy.yaml y del modelo
from typing import Literal, Protocol  # valores permitidos e interfaces sin herencia

import numpy as np  # el vector de features para el modelo
from fastapi import FastAPI, Request  # framework ASGI
from fastapi.exceptions import RequestValidationError  # para no devolver el input en un 422
from fastapi.responses import JSONResponse, Response  # respuestas explícitas
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel, Field, field_validator  # validación del request
from threadpoolctl import threadpool_limits  # limitar OpenMP en los threads del modelo (viene con sklearn)

import definitions as d  # features/definitions.py: el mismo módulo que usa el backfill
from online_counters import CounterResult, InMemoryKV, OnlineCounters  # features/online_counters.py
from policy import Decision, Policy, decide, load_policy, segment_of  # scoring/policy.py
from rules import Blocklists, RulesEngine  # scoring/rules.py

log = logging.getLogger("fraud-scoring")


# ---------------------------------------------------------------------------- configuración
@dataclass
class Settings:
    budget_s: float = float(os.getenv("BUDGET_MS", "80")) / 1000  # presupuesto interno de los 100 ms
    cache_timeout_s: float = float(os.getenv("CACHE_TIMEOUT_MS", "5")) / 1000
    # El online store apunta a p99 ≤ 10 ms; el timeout deja margen para la cola (y corta antes de que una
    # etapa lenta se coma el presupuesto entero). Contadores y features corren en paralelo.
    counters_timeout_s: float = float(os.getenv("COUNTERS_TIMEOUT_MS", "20")) / 1000
    features_timeout_s: float = float(os.getenv("FEATURES_TIMEOUT_MS", "25")) / 1000
    model_timeout_s: float = float(os.getenv("MODEL_TIMEOUT_MS", "10")) / 1000
    # Cuánto se recuerda una decisión por payment_id: cubre los reintentos del orquestador (segundos)
    decision_cache_ttl_s: int = int(os.getenv("DECISION_CACHE_TTL_S", "900"))
    policy_path: str = os.getenv("POLICY_PATH", str(Path(__file__).with_name("policy.yaml")))
    decision_topic: str = os.getenv("DECISIONS_TOPIC", "fraud-decisions")
    # Threads que ejecutan el modelo. ≈ los cores que pide el pod: más threads que cores solo hacen cola.
    model_workers: int = int(os.getenv("MODEL_WORKERS", "2"))


# ---------------------------------------------------------------------------- request
def looks_like_pan(value: str) -> bool:
    """13–19 dígitos que pasan Luhn: forma de número de tarjeta en claro.

    El sistema de fraude NO debe recibir PANs (está fuera del alcance PCI DSS gracias a la tokenización
    upstream). Si un bug del orquestador manda el PAN en `card_token`, se rechaza aquí y NO se loguea:
    un PAN en los logs mete a todo el pipeline de logs en el alcance PCI.
    """
    digits = value.replace(" ", "")
    if not digits.isdigit() or not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, ch in enumerate(reversed(digits)):  # Luhn: duplicar uno sí y uno no desde la derecha
        n = int(ch)
        if i % 2 == 1:
            n = n * 2 - 9 if n * 2 > 9 else n * 2
        total += n
    return total % 10 == 0


class ScoreRequest(BaseModel):
    payment_id: str = Field(min_length=1, max_length=64)  # llave de idempotencia (la misma en reintentos)
    merchant_id: str = Field(min_length=1, max_length=64)
    mcc: str = Field(pattern=r"^\d{4}$")  # merchant category code
    amount_cents: int = Field(gt=0, le=100_000_000)  # en centavos de USD (el orquestador convierte)
    currency: str = Field(pattern=r"^[A-Z]{3}$")  # moneda original (se loguea; no es feature aquí)
    card_token: str = Field(min_length=8, max_length=64)  # token de la bóveda, NUNCA el PAN
    card_bin_country: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    ip_hash: str | None = None  # IP con HMAC (el orquestador tiene la llave; aquí no hay IPs en claro)
    ip_country: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    device_hash: str | None = None
    email_hash: str | None = None
    three_ds_available: bool = True  # ¿la tarjeta/emisor soportan 3-D Secure? (lo sabe el orquestador)
    # Solo en la SEGUNDA llamada de un pago con step-up: el resultado del desafío
    three_ds_result: Literal["authenticated", "failed"] | None = None

    @field_validator("card_token")
    @classmethod
    def _not_a_pan(cls, v: str) -> str:
        if looks_like_pan(v):
            # mensaje genérico: ni el valor ni pistas sobre él
            raise ValueError("card_token parece un número de tarjeta en claro; se esperaba un token")
        return v


# ---------------------------------------------------------------------------- interfaces
class CounterStore(Protocol):
    """Contadores sync en el KV store. Producción: Redis con un script Lua por entidad (online_counters)."""

    async def read_and_update(self, event: dict, ts: float) -> CounterResult: ...


class FeatureFetcher(Protocol):
    """Online store: {"stream": {...}, "batch": {...}}. Un grupo AUSENTE del dict = no llegó.

    Contrato de paridad con point_in_time.py: si el pago trae la entidad y el store no tiene la llave
    (tarjeta sin compras en 24 h), un count/sum/distinct vale 0, no None; None solo si el pago no trae
    la entidad. Si el adaptador devuelve None para "no hay llave", online ve NaN donde training vio 0.
    """

    async def fetch(self, event: dict) -> dict[str, dict[str, float | None]]: ...


class Model(Protocol):
    version: str

    def predict(self, row: list[float]) -> float: ...  # P(fraude) para UN pago


class DecisionCache(Protocol):
    """payment_id → respuesta ya dada. Producción: Redis SET EX (la misma flota, otro prefijo)."""

    async def get(self, payment_id: str) -> dict | None: ...

    async def put(self, payment_id: str, response: dict, ttl_s: int) -> None: ...


class DecisionLog(Protocol):
    """Registro de cada decisión → Kafka `fraud-decisions`. Encolar NO bloquea el request."""

    def publish(self, record: dict) -> bool: ...  # False = buffer lleno, se descartó


# ---------------------------------------------------------------------------- adaptadores
class SklearnModel:
    """GBDT de sklearn (HistGradientBoostingClassifier) servido en CPU, en este proceso.

    Por qué en proceso y no en Triton o un model server aparte: un GBDT predice un pago en ≈ 1–2 ms
    de CPU (est.; el test lo mide); un salto de red a otro servicio cuesta lo mismo o más y agrega un
    punto de falla. Un GBDT no necesita GPU (#m04): con batch de 1 no hay nada que paralelizar.
    En producción: LightGBM/XGBoost con su formato nativo (texto/JSON, sin pickle). Aquí sklearn porque
    instala sin dependencias del sistema (LightGBM en macOS necesita libomp de Homebrew).
    """

    def __init__(self, estimator, version: str) -> None:
        self.estimator = estimator
        self.version = version

    @classmethod
    def load(cls, path: str | Path, expected_sha256: str, version: str) -> SklearnModel:
        """pickle ejecuta código al cargar: SOLO artefactos del registry propio, con su sha256 verificado.

        Además, la versión de scikit-learn tiene que ser la misma con la que se entrenó (sklearn avisa
        con InconsistentVersionWarning): por eso training y serving usan el mismo lock.
        """
        blob = Path(path).read_bytes()
        digest = hashlib.sha256(blob).hexdigest()
        if digest != expected_sha256:
            raise ValueError(f"sha256 del modelo no coincide ({digest[:12]}…): no se carga")
        return cls(pickle.loads(blob), version)  # noqa: S301 — artefacto verificado arriba

    def predict(self, row: list[float]) -> float:
        # Un pago a la vez: el request es uno. predict_proba devuelve [P(0), P(1)]
        return float(self.estimator.predict_proba(np.asarray([row], dtype=float))[0, 1])


class LocalCounterStore:
    """Contadores en memoria del proceso (demo y tests). En producción: Redis (ver online_counters)."""

    def __init__(self, counters: OnlineCounters) -> None:
        self.counters = counters

    async def read_and_update(self, event: dict, ts: float) -> CounterResult:
        return self.counters.read_and_update(event, ts)


class StaticFeatureFetcher:
    """Online store falso: 0 en las ventanas (entidad presente sin historia) y valores fijos en batch."""

    def __init__(self, batch: dict[str, float] | None = None) -> None:
        self.batch = batch or {}

    async def fetch(self, event: dict) -> dict[str, dict[str, float | None]]:
        stream = {f.name: (0.0 if d.entity_value(event, f.entity) else None) for f in d.STREAM_FEATURES}
        batch = {f.name: self.batch.get(f.name) for f in d.BATCH_FEATURES}
        return {"stream": stream, "batch": batch}


class InMemoryDecisionCache:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._data: dict[str, tuple[float, dict]] = {}

    async def get(self, payment_id: str) -> dict | None:
        hit = self._data.get(payment_id)
        return hit[1] if hit and hit[0] > self._clock() else None

    async def put(self, payment_id: str, response: dict, ttl_s: int) -> None:
        self._data[payment_id] = (self._clock() + ttl_s, response)


class BufferedDecisionLog:
    """Buffer acotado en memoria (lo vaciaría un productor de Kafka con acks=all e idempotencia).

    Lleno → se descarta y se cuenta, no se bloquea el pago. Perder registros tiene costo (el set de
    entrenamiento y la auditoría salen de aquí), por eso fraud_decision_log_dropped_total tiene alerta.
    """

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


# ---------------------------------------------------------------------------- métricas
class Metrics:
    """Un registry por app (los tests crean varias apps en el mismo proceso sin choques de nombres)."""

    def __init__(self) -> None:
        r = self.registry = CollectorRegistry()
        self.requests = Counter("fraud_score_requests_total", "Requests de scoring", ["status"], registry=r)
        # Buckets EXACTOS en 0.08 (presupuesto interno) y 0.1 (SLO): sin ellos, histogram_quantile
        # interpola entre buckets vecinos y la alerta oscila alrededor del umbral.
        self.duration = Histogram("fraud_score_duration_seconds", "Latencia server-side del scoring",
                                  buckets=(0.005, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1, 0.15, 0.25, 0.5, 1.0),
                                  registry=r)
        self.stage = Histogram("fraud_stage_duration_seconds", "Latencia por etapa", ["stage"],
                               buckets=(0.001, 0.002, 0.005, 0.01, 0.015, 0.02, 0.025, 0.04, 0.08, 0.1), registry=r)
        self.decisions = Counter("fraud_decisions_total", "Decisiones", ["decision", "segment"], registry=r)
        self.fallback = Counter("fraud_fallback_total", "Decisiones sin modelo (rules-only)", ["reason"], registry=r)
        self.feature_lookups = Counter("fraud_feature_lookups_total", "Grupos de features pedidos", ["group"], registry=r)
        self.feature_defaults = Counter("fraud_feature_defaults_total", "Grupos que faltaron (NaN o fallback)",
                                        ["group"], registry=r)
        self.counter_duplicates = Counter("fraud_counter_duplicates_total",
                                          "Pagos que los contadores ya habían sumado (reintentos)", registry=r)
        self.replays = Counter("fraud_idempotent_replays_total", "Reintentos respondidos desde la caché", registry=r)
        self.rule_evaluations = Counter("fraud_rule_evaluations_total", "Evaluaciones del motor de reglas", registry=r)
        self.rule_hits = Counter("fraud_rule_hits_total", "Reglas que dispararon", ["rule", "reason"], registry=r)
        self.rule_errors = Counter("fraud_rule_errors_total", "Reglas que fallaron y se saltaron", ["rule"], registry=r)
        self.blocklist_generated = Gauge("fraud_blocklist_generated_timestamp_seconds",
                                         "Cuándo generó el job nocturno la lista negra cargada", registry=r)
        self.score = Histogram("fraud_model_score", "Score del modelo", ["segment"],
                               buckets=(0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0),
                               registry=r)
        self.exploration = Counter("fraud_exploration_total", "Declines del modelo mandados a step-up para explorar",
                                   ["segment"], registry=r)
        self.log_dropped = Counter("fraud_decision_log_dropped_total", "Registros de decisión descartados", registry=r)
        self.cache_errors = Counter("fraud_decision_cache_errors_total", "Fallas o timeouts de la caché", registry=r)


# ---------------------------------------------------------------------------- app
def _model_thread_init() -> None:
    """Cada thread del modelo usa UN thread de OpenMP.

    El GBDT de sklearn paraleliza la predicción con OpenMP, con tantos threads como cores vea. Para UNA
    fila eso es puro overhead: medido en una Mac de 10 cores con el modelo de los tests, p50 ≈ 1.5–4 ms
    y p99 de 2 a 30 ms (según qué más corría) con el default, contra p50 ≈ 0.3–0.5 ms y p99 < 1 ms con
    1 thread. Es una Mac, no tu pod: mídelo en tu CPU (test_model_latency_on_cpu_is_milliseconds).
    En un pod con límite de CPU, además, 10 threads compitiendo por 2 cores = CPU throttling.
    Trampa: limitarlo en el thread principal NO alcanza; el límite de OpenMP es por thread, y la
    predicción corre en los threads de este executor (por eso va en su `initializer`). La alternativa
    simple es OMP_NUM_THREADS=1 en el entorno del contenedor, antes de que arranque el proceso.
    """
    threadpool_limits(limits=1, user_api="openmp")


@dataclass
class Deps:
    policy: Policy
    model: Model | None
    counters: CounterStore
    fetcher: FeatureFetcher
    cache: DecisionCache
    decision_log: DecisionLog
    blocklists: Blocklists = field(default_factory=Blocklists)
    settings: Settings = field(default_factory=Settings)
    clock: Callable[[], float] = time.time  # event_time: el reloj del servicio, y se loguea


def create_app(deps: Deps) -> FastAPI:
    s, policy = deps.settings, deps.policy
    m = Metrics()
    engine = RulesEngine(policy, deps.blocklists)
    m.blocklist_generated.set(deps.blocklists.generated_at)
    # Contador LOCAL del pod con las features de los límites duros: si el KV store no contesta, las
    # reglas de velocidad usan esto. Ve solo el tráfico de ESTE pod (con 9 pods, ≈ 1/9 de los intentos
    # de una tarjeta si el balanceo es aleatorio): un límite de 5 por minuto se vuelve ≈ 45 en total.
    # Es un piso, no el mismo control. Rutear por card_token lo arreglaría a costa de acoplar el
    # balanceador a una feature.
    local = OnlineCounters(InMemoryKV(deps.clock),
                           features=[f for f in d.SYNC_FEATURES if f.name in policy.hard_limits])
    # Executor PROPIO para el modelo: el threadpool por defecto de asyncio lo comparten otras cosas, y aquí
    # cada thread se inicializa con 1 thread de OpenMP.
    model_pool = ThreadPoolExecutor(max_workers=s.model_workers, thread_name_prefix="model",
                                    initializer=_model_thread_init)
    warm = False
    if deps.model is not None:
        # Warm-up ANTES de estar ready: la primera predicción paga la inicialización (OpenMP, caches) y
        # se comería el presupuesto de 10 ms del primer pago real. Si el modelo ni siquiera predice un
        # vector de faltantes, el pod no pasa a ready (el rollout se detiene ahí, no en producción).
        try:
            model_pool.submit(deps.model.predict, d.vector({})).result(timeout=5)
            warm = True
        except Exception:  # noqa: BLE001
            log.exception("warm-up del modelo falló: el pod no estará ready")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        model_pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="fraud-scoring", lifespan=lifespan)
    app.state.metrics = m

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI devuelve por defecto el `input` de cada error: con un PAN en card_token, el PAN volvería
        # en la respuesta y terminaría en los logs del caller. Solo ubicación, mensaje y tipo.
        m.requests.labels(status="422").inc()
        detail = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
        return JSONResponse({"detail": detail}, status_code=422)

    async def timed(stage: str, coro, timeout: float):
        """Corre `coro` con su timeout y mide la etapa. Devuelve (resultado | excepción)."""
        t = time.perf_counter()
        try:
            return await asyncio.wait_for(coro, timeout=max(timeout, 0.0))
        except Exception as exc:  # noqa: BLE001 — timeout o error: lo decide quien llama
            return exc
        finally:
            m.stage.labels(stage=stage).observe(time.perf_counter() - t)

    @app.post("/v1/score")
    async def score(req: ScoreRequest) -> dict:
        t0 = time.perf_counter()
        deadline = t0 + s.budget_s
        event = req.model_dump()
        payment_id = req.payment_id
        # La caché es por (pago, etapa): la llamada después de 3-D Secure NO es un reintento de la primera
        cache_key = f"{payment_id}:{req.three_ds_result or 'initial'}"

        # 0) Reintento: la MISMA respuesta. Un reintento no puede recibir otra decisión (aprobar y luego
        #    declinar el mismo pago) ni volver a sumar velocidades. Caché caída → se sigue sin ella.
        cached = await timed("cache", deps.cache.get(cache_key), s.cache_timeout_s)
        if isinstance(cached, Exception):
            m.cache_errors.inc()
        elif cached is not None:
            m.replays.inc()
            m.requests.labels(status="200").inc()
            m.duration.observe(time.perf_counter() - t0)
            return {**cached, "replayed": True}

        ts = deps.clock()  # event_time del pago: el MISMO que se loguea y que usa el backfill
        local_values = local.read_and_update(event, ts).values  # en proceso, siempre (respaldo)

        # 1) Contadores sync y features en paralelo, cada uno con su timeout
        counters_res, features_res = await asyncio.gather(
            timed("counters", deps.counters.read_and_update(event, ts), s.counters_timeout_s),
            timed("features", deps.fetcher.fetch(event), s.features_timeout_s),
        )
        fallback_reason: str | None = None
        values: dict[str, float | None] = d.request_features(event)
        defaulted: list[str] = []

        if isinstance(counters_res, Exception):
            fallback_reason = "counters_timeout" if isinstance(counters_res, TimeoutError) else "counters_error"
            velocity = local_values  # las reglas usan el contador local del pod
            defaulted.append("sync")
        else:
            if counters_res.duplicate:
                m.counter_duplicates.inc()
            velocity = counters_res.values
            values.update(counters_res.values)

        groups = {} if isinstance(features_res, Exception) else features_res
        for group in ("stream", "batch"):
            m.feature_lookups.labels(group=group).inc()
            got = groups.get(group)
            if got is None:
                m.feature_defaults.labels(group=group).inc()
                defaulted.append(group)
                if group not in policy.degraded_groups_allowed and fallback_reason is None:
                    if isinstance(features_res, Exception):
                        fallback_reason = ("features_timeout" if isinstance(features_res, TimeoutError)
                                           else "features_error")
                    else:
                        fallback_reason = "features_missing"
            else:
                values.update(got)  # lo que falta adentro del grupo queda como NaN en d.vector

        # 2) Reglas: SIEMPRE, con o sin modelo
        m.rule_evaluations.inc()
        t = time.perf_counter()
        rules_res = engine.evaluate(event, velocity)
        m.stage.labels(stage="rules").observe(time.perf_counter() - t)
        for name in rules_res.errors:
            m.rule_errors.labels(rule=name).inc()
        for h in rules_res.hits:
            m.rule_hits.labels(rule=h.rule, reason=h.reason_code).inc()

        # 3) Modelo, si hay con qué y con cuánto tiempo
        segment = segment_of(policy, req.mcc, req.amount_cents)
        row = d.vector(values)
        score_value: float | None = None
        if fallback_reason is None:
            remaining = deadline - time.perf_counter()
            if deps.model is None:
                fallback_reason = "model_unavailable"
            elif remaining < s.model_timeout_s / 2:
                fallback_reason = "budget_exhausted"  # no se empieza lo que no se puede terminar
            else:
                # En un thread para poder dejar de ESPERAR si tarda: el cálculo no se puede cancelar y
                # sigue consumiendo CPU, pero el pago no espera. Si pasa seguido, el problema es el pod.
                loop = asyncio.get_running_loop()
                res = await timed("model", loop.run_in_executor(model_pool, deps.model.predict, row),
                                  min(s.model_timeout_s, remaining))
                if isinstance(res, TimeoutError):
                    fallback_reason = "model_timeout"
                elif isinstance(res, Exception) or not 0.0 <= float(res) <= 1.0:
                    fallback_reason = "model_error"  # una excepción o un score fuera de [0, 1]
                else:
                    score_value = float(res)
        if fallback_reason is not None:
            m.fallback.labels(reason=fallback_reason).inc()
            score_value = None
        else:
            m.score.labels(segment=segment).observe(score_value)

        # 4) Decisión
        decision: Decision = decide(policy, segment, score_value, rules_res.actions(), req.merchant_id,
                                    req.three_ds_available, payment_id, req.three_ds_result)
        m.decisions.labels(decision=decision.decision, segment=segment).inc()
        if decision.exploration:
            m.exploration.labels(segment=segment).inc()
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        response = {
            "payment_id": payment_id,
            "decision": decision.decision,
            "reason_codes": list(decision.reason_codes),
            "score": None if score_value is None else round(score_value, 6),
            "segment": segment,
            "path": "model" if fallback_reason is None else "rules_only",
            "groups_defaulted": defaulted,  # grupos de features que faltaron (NaN o fallback)
            "fallback_reason": fallback_reason,
            "exploration": decision.exploration,
            "model_version": deps.model.version if deps.model else None,
            "policy_version": policy.version,
            "feature_set_version": d.FEATURE_SET_VERSION,
            "latency_ms": latency_ms,
            "replayed": False,
        }

        # 5) Log de la decisión con el FEATURE SNAPSHOT (log-and-wait): es el set de entrenamiento de
        #    dentro de 90 días y la evidencia de una disputa. Lleva lo que vio el modelo, no lo que habría
        #    que recalcular después (que ya no sería lo mismo).
        record = {
            **{k: event[k] for k in ("payment_id", "merchant_id", "mcc", "amount_cents", "currency",
                                     "card_token", "card_bin_country", "ip_hash", "ip_country",
                                     "device_hash", "email_hash", "three_ds_available", "three_ds_result")},
            "event_time": ts,
            "features": dict(zip(d.FEATURE_ORDER, [None if v != v else v for v in row])),  # NaN → null
            "rule_hits": [h.reason_code for h in rules_res.hits],
            "rule_errors": rules_res.errors,
            "propensity": decision.propensity,
            **{k: response[k] for k in ("decision", "reason_codes", "score", "segment", "path", "groups_defaulted",
                                        "fallback_reason", "exploration", "model_version",
                                        "policy_version", "feature_set_version", "latency_ms")},
        }
        if not deps.decision_log.publish(record):
            m.log_dropped.inc()
        put = await timed("cache_put", deps.cache.put(cache_key, response, s.decision_cache_ttl_s),
                          s.cache_timeout_s)
        if isinstance(put, Exception):
            m.cache_errors.inc()

        m.duration.observe(time.perf_counter() - t0)
        m.requests.labels(status="200").inc()
        return response

    @app.get("/healthz")
    async def healthz() -> dict:
        # Liveness: el proceso responde. NO depende de Redis ni del modelo (si dependiera, un Redis caído
        # reiniciaría todos los pods a la vez y se perdería también el fallback).
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz() -> Response:
        # Readiness: política cargada y modelo cargado Y calentado. Redis caído NO saca el pod: para eso
        # está el fallback (si sacara los pods, un Redis caído dejaría sin fraude ni reglas a todo el mundo).
        ok = deps.model is not None and warm
        return JSONResponse({"ready": ok, "policy_version": policy.version,
                             "model_version": deps.model.version if deps.model else None},
                            status_code=200 if ok else 503)

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(m.registry), media_type=CONTENT_TYPE_LATEST)

    return app


class DemoFeatureFetcher(StaticFeatureFetcher):
    """Solo para la demo: un card_token que empieza con `tok_new` es una tarjeta y un email recién vistos."""

    async def fetch(self, event: dict) -> dict[str, dict[str, float | None]]:
        out = await super().fetch(event)
        if str(event.get("card_token", "")).startswith("tok_new"):
            out["batch"] = {**out["batch"], "card_age_days": 1.0, "email_age_days": 2.0}
        return out


def demo_app() -> FastAPI:
    """App local con todo falso salvo el modelo: `uvicorn --factory service:demo_app --port 8080`.

    Entrena un GBDT chico con datos SINTÉTICOS al arrancar (≈ 1 s): no es un modelo de fraude.
    """
    import synthetic  # solo para la demo: no entra al camino de producción

    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    X, y = synthetic.make_training_data(20000)
    model = SklearnModel(synthetic.train_model(X, y), version="demo-hgb-synthetic")
    settings = Settings()
    policy = load_policy(settings.policy_path)
    return create_app(Deps(
        policy=policy, model=model,
        counters=LocalCounterStore(OnlineCounters(InMemoryKV())),
        fetcher=DemoFeatureFetcher({"card_age_days": 120.0, "email_age_days": 400.0,
                                    "merchant_chargeback_bps_90d": 8.0, "device_linked_accounts_30d": 1.0}),
        cache=InMemoryDecisionCache(), decision_log=BufferedDecisionLog(echo=True),
        blocklists=Blocklists(card=frozenset({"tok_blocked_demo"})), settings=settings,
    ))
