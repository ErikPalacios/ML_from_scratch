"""mod-gateway (caso c06): verificación SÍNCRONA antes de publicar un post o un comentario.

post-service y comment-service llaman a POST /v1/moderate ANTES de publicar y esperan como mucho
150 ms (p99, el SLO). Dentro de ese tiempo:
  etapa 0  hash-match LOCAL (PDQ de cada imagen, texto normalizado, dominios)       ≈ 1–2 ms por imagen
  etapa 1  modelos rápidos en Triton (texto e imagen EN PARALELO), con timeout      lo que quede del presupuesto
  decisión decision-engine (policies.yaml versionado)                               < 1 ms
  evento   a Kafka `mod-events` en segundo plano (no bloquea la respuesta)
Presupuesto interno: 120 ms (BUDGET_S). Los 30 ms restantes del SLO son red, serialización y la
cola del event loop: el presupuesto limita las llamadas remotas, NO un event loop bloqueado.

Fail-open: si un modelo de la etapa 1 vence su timeout o falla, el post se publica con lo que haya
y se manda a la etapa 2 con prioridad (ver decision/policies.yaml). El hash NO tiene fail-open: corre
en este proceso, y un pod sin el índice cargado no está ready.

Interfaces (Protocol) para todo lo externo: los modelos (Triton), Kafka y la fuente de hashes. Los tests
usan fakes; los adaptadores reales (tritonclient, un productor de Kafka) no están en esta carpeta porque
no se pudieron probar aquí (ver README).

Endpoints: POST /v1/moderate · GET /healthz · GET /readyz · GET /metrics
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import asyncio  # wait_for + gather: timeouts por etapa y etapas en paralelo
import json  # una línea JSON por decisión; el evento de Kafka también es JSON
import logging  # a stdout: en un contenedor los logs son un stream
import os  # configuración por variables de entorno
import sys  # stdout explícito para el logger
import time  # perf_counter (latencias) y time (timestamps)
from collections.abc import AsyncIterator, Iterable  # tipos de las interfaces
from contextlib import asynccontextmanager  # lifespan: cargar índice y config, arrancar tareas
from dataclasses import dataclass, field  # Settings y Deps
from pathlib import Path  # rutas por defecto relativas al repo
from typing import Literal, Protocol  # interfaces sin herencia

from fastapi import FastAPI, Request, Response  # framework ASGI
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest  # /metrics
from pydantic import BaseModel, Field, field_validator  # validación del body

import engine  # decision/engine.py (en la imagen se copia junto a este archivo)
import match  # hashing/match.py

HERE = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------- configuración
@dataclass
class Settings:
    # policies.yaml versionado (en el cluster, un ConfigMap montado; cambiarlo = rollout con su versión)
    policies_path: str = os.getenv("POLICIES_PATH", str(HERE.parent / "decision" / "policies.yaml"))
    # Snapshot de las listas de hashes (JSONL) que se carga al arrancar; las novedades llegan por stream
    hash_snapshot_path: str = os.getenv("HASH_SNAPSHOT_PATH", "")
    # Presupuesto INTERNO total del request: 120 ms de los 150 ms del SLO p99
    budget_s: float = float(os.getenv("BUDGET_S", "0.12"))
    # Lo que se reserva al final para decidir, serializar y responder (no se le da a los modelos)
    engine_reserve_s: float = float(os.getenv("ENGINE_RESERVE_S", "0.005"))
    # Tópico de eventos: lo consumen deep-scorer, enforcement, auditoría y métricas
    events_topic: str = os.getenv("EVENTS_TOPIC", "mod-events")
    # Eventos en memoria esperando a Kafka. Lleno → se descarta y se cuenta (ver _enqueue_event)
    event_buffer: int = int(os.getenv("EVENT_BUFFER", "20000"))
    # Al apagar (SIGTERM), cuánto esperar a que el buffer de eventos llegue a Kafka. Debe caber en el
    # terminationGracePeriodSeconds del pod (30 s por defecto) junto con terminar los requests en vuelo.
    shutdown_flush_s: float = float(os.getenv("SHUTDOWN_FLUSH_S", "5"))
    # Versión del gateway (imagen): va en cada evento junto a las del modelo y la config
    gateway_version: str = os.getenv("GATEWAY_VERSION", "dev")


# ---------------------------------------------------------------------------- interfaces
class TextScorer(Protocol):
    """Etapa 1, texto: clasificador multilingüe destilado, multi-label por política (Triton)."""

    async def score(self, text: str, surface: str) -> engine.StageResult: ...


class ImageScorer(Protocol):
    """Etapa 1, imagen: clasificador liviano (Triton). Recibe referencias, no bytes (ver ImageIn)."""

    async def score(self, media_ids: list[str]) -> engine.StageResult: ...


class EventPublisher(Protocol):
    """Productor de Kafka. El real usa acks=all + enable.idempotence (sin duplicados por reintento)."""

    async def publish(self, topic: str, key: str, value: bytes) -> None: ...


class HashUpdates(Protocol):
    """Stream de novedades de las listas de hashes (altas, bajas y heartbeats con su watermark)."""

    def __aiter__(self) -> AsyncIterator[dict]: ...


@dataclass
class Deps:
    text: TextScorer
    image: ImageScorer
    publisher: EventPublisher
    hash_updates: HashUpdates | None = None
    hash_entries: Iterable[dict] = field(default_factory=list)  # snapshot ya leído (tests) o vacío


# ---------------------------------------------------------------------------- métricas
# Nombres = contrato con monitoring/alerts.yml (un test lo verifica). Labels de cardinalidad acotada.
REQUESTS = Counter("mod_gateway_requests_total", "Requests a /v1/moderate", ["surface", "status"])
LATENCY = Histogram(  # buckets alrededor del SLO (0.15 s) para que el p99 sea preciso donde importa
    "mod_gateway_request_duration_seconds", "Latencia server-side de /v1/moderate", ["surface"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.12, 0.15, 0.2, 0.3, 0.5, 1.0),
)
STAGE_LATENCY = Histogram(  # ¿qué etapa se come el presupuesto?
    "mod_stage_duration_seconds", "Duración de cada etapa en el gateway", ["stage"],
    buckets=(0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.12, 0.15),
)
FAIL_OPEN = Counter(  # una cuenta por ETAPA que faltó: stage1_text_timeout, stage1_image_error…
    "mod_fail_open_total", "Etapas que faltaron y se resolvieron con fail-open", ["reason"],
)
FAIL_OPEN_REQ = Counter(  # una cuenta por REQUEST con al menos una etapa faltante: el numerador de la alerta
    "mod_fail_open_requests_total", "Requests decididos con fail-open", ["surface"],
)
DECISIONS = Counter(
    "mod_decisions_total", "Decisiones del camino síncrono", ["policy", "action", "surface"],
)
STAGE1_SCORE = Histogram(  # distribución de scores por política: la señal de PolicyScoreShift
    "mod_stage1_score", "Score de la etapa 1 por política", ["policy"],
    buckets=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99),
)
HASH_MATCHES = Counter("mod_hash_matches_total", "Coincidencias de hash-match", ["list"])
HASH_UNVERIFIABLE = Counter(  # imágenes cuyo PDQ es de baja calidad: no son "limpias", son "no verificables"
    "mod_hash_unverifiable_total", "Imágenes sin hash PDQ utilizable",
)
HASH_WATERMARK = Gauge(  # hasta qué momento de la lista aplicó ESTE pod las novedades (HashListStale)
    "mod_hash_list_watermark_timestamp_seconds", "Watermark aplicado por lista de hashes", ["list"],
)
HASH_ENTRIES = Gauge("mod_hash_index_entries", "Entradas vivas en el índice local", ["kind"])
EVENTS_BUFFERED = Gauge("mod_events_buffered", "Eventos esperando a Kafka en este pod")
EVENTS_DROPPED = Counter("mod_events_dropped_total", "Eventos descartados (buffer lleno)")
EVENTS_FAILED = Counter("mod_events_publish_failures_total", "Eventos que Kafka rechazó tras los reintentos")
ENGINE_ERRORS = Counter("mod_engine_errors_total", "Excepciones del decision-engine (decisión de emergencia)")

STAGE_NAMES = ("hash", "stage1_text", "stage1_image", "engine")  # se crean en 0 al arrancar (ver _init_metrics)

log = logging.getLogger("mod-gateway")
log.addHandler(logging.StreamHandler(sys.stdout))  # una línea JSON por decisión
log.setLevel(logging.INFO)
log.propagate = False


# ---------------------------------------------------------------------------- API
class ImageIn(BaseModel):
    # media-service ya tiene la imagen: al SUBIRLA (segundos antes de publicar) calcula el PDQ. Por eso
    # aquí llega el hash y no los bytes: decodificar otra vez dentro de los 150 ms sería tirar CPU.
    media_id: str = Field(min_length=1, max_length=128)
    pdq: str = Field(min_length=64, max_length=64)  # obligatorio: sin PDQ no hay verificación S0
    pdq_quality: int = Field(ge=0, le=100)

    @field_validator("pdq")
    @classmethod
    def _hex(cls, v: str) -> str:
        int(v, 16)  # ValueError → 422: un hash inválido es un error del caller, no un "limpio"
        return v.lower()


class ModerateIn(BaseModel):
    item_id: str = Field(min_length=1, max_length=128)
    surface: Literal["post", "comment"]
    text: str = Field(default="", max_length=20_000)  # tope: un texto enorme no debe comerse el presupuesto
    images: list[ImageIn] = Field(default_factory=list, max_length=10)  # los comentarios llegan sin imágenes
    urls: list[str] = Field(default_factory=list, max_length=50)
    region: str | None = Field(default=None, max_length=8)  # para los overrides regionales de la config


@dataclass
class State:
    cfg: dict
    pdq: match.PdqIndex
    texts: match.TextHashSet
    domains: match.DomainBlocklist
    ready: bool = False
    watermarks: dict[str, float] = field(default_factory=dict)  # lista → ts aplicado (monótono)
    events: asyncio.Queue | None = None
    tasks: list[asyncio.Task] = field(default_factory=list)


def apply_hash_entry(st: State, e: dict) -> None:
    """Una entrada del snapshot o del stream. kind: pdq · text_sha256 · domain · remove · heartbeat."""
    kind = e["kind"]
    if kind == "pdq":
        st.pdq.add(e["id"], e["value"], e["list"], e["policy"], quality=e.get("quality"))
    elif kind == "text_sha256":
        st.texts.add_hash(e["id"], e["value"], e["list"], e["policy"])
    elif kind == "domain":
        st.domains.add(e["value"], e["list"], e["policy"])
    elif kind == "remove":
        st.pdq.remove(e["id"])  # apelación ganada o entrada errónea: deja de coincidir ya
    elif kind != "heartbeat":
        raise ValueError(f"tipo de entrada desconocido: {kind}")
    # Watermark: el productor de las listas manda heartbeats aunque no haya novedades (de noche puede
    # no haber remociones durante horas). Sin heartbeats, "no llegó nada" y "el stream está roto" se
    # verían igual.
    if "ts" in e:
        wm = max(float(e["ts"]), st.watermarks.get(e["list"], 0.0))  # nunca retrocede (mensajes desordenados)
        st.watermarks[e["list"]] = wm
        HASH_WATERMARK.labels(list=e["list"]).set(wm)
    HASH_ENTRIES.labels(kind="pdq").set(len(st.pdq))
    HASH_ENTRIES.labels(kind="text").set(len(st.texts))
    HASH_ENTRIES.labels(kind="domain").set(len(st.domains))


def load_snapshot(path: str) -> list[dict]:
    """JSONL: una entrada por línea. Archivo vacío o ruta vacía → sin entradas (el pod NO queda ready).

    El snapshot trae, por lista, una línea heartbeat con su ts: el watermark desde el que el stream de
    novedades continúa.
    """
    if not path:
        return []
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def _init_metrics(cfg: dict) -> None:
    """Crea las series en 0: un counter que nace en 1 es invisible para increase() (trampa del c04)."""
    for s in ("post", "comment"):
        REQUESTS.labels(surface=s, status="200")
        FAIL_OPEN_REQ.labels(surface=s)
        LATENCY.labels(surface=s)
    for stage in ("stage1_text", "stage1_image"):
        for why in ("timeout", "error", "budget_exhausted"):
            FAIL_OPEN.labels(reason=f"{stage}_{why}")
    for stage in STAGE_NAMES:
        STAGE_LATENCY.labels(stage=stage)
    for pol in cfg["policies"]:
        STAGE1_SCORE.labels(policy=pol)
    for lname in cfg.get("hash_lists") or {}:
        HASH_MATCHES.labels(list=lname)


def create_app(deps: Deps, settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        cfg = engine.load_config(settings.policies_path)  # config inválida → el pod no arranca (bien)
        st = State(cfg, match.PdqIndex(), match.TextHashSet(), match.DomainBlocklist())
        _init_metrics(cfg)
        entries = list(deps.hash_entries) or load_snapshot(settings.hash_snapshot_path)
        # Carga masiva: agrega todo y compacta UNA vez (≈ 3 s por millón de PDQ, medido; ver README)
        for e in entries:
            if e["kind"] != "pdq":
                apply_hash_entry(st, e)
        st.pdq.add_many(
            (e["id"], e["value"], e["list"], e["policy"], e.get("quality")) for e in entries if e["kind"] == "pdq"
        )
        HASH_ENTRIES.labels(kind="pdq").set(len(st.pdq))
        # Ready solo con índice: un pod sin hashes no puede garantizar S0, así que no recibe tráfico
        st.ready = len(st.pdq) + len(st.texts) + len(st.domains) > 0
        st.events = asyncio.Queue(maxsize=settings.event_buffer)
        st.tasks.append(asyncio.create_task(_publish_loop(st, deps.publisher, settings)))
        if deps.hash_updates is not None:
            st.tasks.append(asyncio.create_task(_updates_loop(st, deps.hash_updates)))
        app.state.mod = st
        yield
        # SIGTERM: dejar de aceptar (lo hace uvicorn) y vaciar el buffer de eventos con un tope de tiempo
        try:
            await asyncio.wait_for(st.events.join(), timeout=settings.shutdown_flush_s)
        except TimeoutError:
            log.warning(json.dumps({"event": "shutdown_events_lost", "pending": st.events.qsize()}))
        for t in st.tasks:
            t.cancel()

    app = FastAPI(title="mod-gateway", lifespan=lifespan)

    @app.get("/healthz")
    def healthz() -> dict:
        """Liveness: el proceso responde. No depende de Triton (si Triton cae, reiniciar no ayuda)."""
        return {"ok": True}

    @app.get("/readyz")
    def readyz(request: Request, response: Response) -> dict:
        """Readiness: config cargada e índice de hashes cargado. Triton caído NO saca al pod (hay fail-open)."""
        st: State = request.app.state.mod
        if not st.ready:
            response.status_code = 503
        return {"ready": st.ready, "config_version": st.cfg["version"], "pdq_entries": len(st.pdq)}

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.post("/v1/moderate")
    async def moderate(body: ModerateIn, request: Request) -> dict:
        t0 = time.perf_counter()  # el reloj arranca con el body ya validado
        deadline = t0 + settings.budget_s
        st: State = request.app.state.mod
        status = "500"
        try:
            decision, extra = await _moderate(st, deps, settings, body, deadline)
            status = "200"
            out = decision.to_dict() | extra
            out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
            return out
        finally:
            elapsed = time.perf_counter() - t0
            REQUESTS.labels(surface=body.surface, status=status).inc()
            LATENCY.labels(surface=body.surface).observe(elapsed)

    return app


async def _call_stage(name: str, coro, timeout: float) -> tuple[engine.StageResult | None, str | None]:
    """Corre una etapa remota con timeout. Devuelve (resultado, None) o (None, motivo)."""
    t = time.perf_counter()
    try:
        if timeout <= 0:
            coro.close()  # no la arrancamos: evita el warning de "coroutine never awaited"
            return None, "budget_exhausted"
        # wait_for CANCELA la llamada en vuelo al vencer: no seguimos esperando a un Triton lento
        return await asyncio.wait_for(coro, timeout=timeout), None
    except TimeoutError:
        return None, "timeout"
    except Exception as exc:  # conexión rechazada, modelo no cargado, respuesta inválida…
        log.warning(json.dumps({"event": "stage_error", "stage": name, "error": type(exc).__name__}))
        return None, "error"
    finally:
        STAGE_LATENCY.labels(stage=name).observe(time.perf_counter() - t)


async def _moderate(st: State, deps: Deps, settings: Settings, body: ModerateIn, deadline: float):
    extra: dict = {}
    # -- etapa 0: hashes, LOCAL. Corre en el event loop: ≤ 10 imágenes × ≈ 1–2 ms (1 M hashes, medido).
    t = time.perf_counter()
    hits: list[engine.HashHit] = []
    unverifiable = 0
    for img in body.images:
        if img.pdq_quality < match.PDQ_MIN_QUALITY:
            unverifiable += 1  # calidad baja: el hash no discrimina; no es "limpio", es "no verificable"
            continue
        hits += [engine.HashHit(h.entry_id, h.list_name, h.policy, h.distance) for h in st.pdq.query(img.pdq)]
    if body.text:
        th = st.texts.query(body.text)
        if th:
            hits.append(engine.HashHit(th.entry_id, th.list_name, th.policy, 0))
    for url in body.urls:
        dh = st.domains.query(url)
        if dh:
            hits.append(engine.HashHit(dh.entry_id, dh.list_name, dh.policy, 0))
    STAGE_LATENCY.labels(stage="hash").observe(time.perf_counter() - t)
    for h in hits:
        HASH_MATCHES.labels(list=h.list_name).inc()
    if unverifiable:
        HASH_UNVERIFIABLE.inc(unverifiable)

    # -- etapa 1: texto e imagen EN PARALELO, con lo que queda del presupuesto
    stages: list[engine.StageResult] = []
    failed: dict[str, str] = {}
    left = deadline - time.perf_counter() - settings.engine_reserve_s
    calls = {}
    if body.text:
        calls["stage1_text"] = deps.text.score(body.text, body.surface)
    if body.images:
        calls["stage1_image"] = deps.image.score([i.media_id for i in body.images])
    if calls:
        results = await asyncio.gather(*(_call_stage(n, c, left) for n, c in calls.items()))
        for name, (res, why) in zip(calls, results):
            if res is not None:
                stages.append(res)
                for pol, sc in res.scores.items():
                    if pol in st.cfg["policies"]:
                        STAGE1_SCORE.labels(policy=pol).observe(sc)
            else:
                failed[name] = why
                FAIL_OPEN.labels(reason=f"{name}_{why}").inc()

    # -- decisión
    t = time.perf_counter()
    try:
        decision = engine.decide(
            st.cfg, item_id=body.item_id, surface=body.surface, path="sync", region=body.region,
            hash_hits=hits, stages=stages, failed_stages=failed, text=body.text,
        )
    except Exception as exc:  # un bug del motor no puede tumbar la creación de posts…
        ENGINE_ERRORS.inc()
        log.error(json.dumps({"event": "engine_error", "item_id": body.item_id, "error": type(exc).__name__}))
        decision = _emergency_decision(st, body, hits, failed)  # …pero un hash S0 se sigue bloqueando
    STAGE_LATENCY.labels(stage="engine").observe(time.perf_counter() - t)
    if unverifiable and decision.action != "block_prepublish":
        decision.send_to_deep_scorer = True  # la etapa 2 mira la imagen con el modelo grande
        decision.deep_scoring_priority = decision.deep_scoring_priority or "normal"
        extra["hash_unverifiable_images"] = unverifiable
    if decision.fail_open:
        FAIL_OPEN_REQ.labels(surface=body.surface).inc()
    DECISIONS.labels(policy=decision.policy or "none", action=decision.action, surface=body.surface).inc()

    # -- evento (sin texto ni imágenes: deep-scorer lee el contenido por id; Kafka no es un almacén de PII)
    event = decision.to_dict() | {
        "event_time": time.time(),
        "media_ids": [i.media_id for i in body.images],
        "region": body.region,
        "gateway_version": settings.gateway_version,
    }
    _enqueue_event(st, event)
    log.info(json.dumps({"event": "decision", **{k: event[k] for k in (
        "item_id", "surface", "action", "policy", "source", "fail_open", "fail_open_reasons",
        "send_to_deep_scorer", "config_version", "model_versions")}}, ensure_ascii=False))
    return decision, extra


def _emergency_decision(st: State, body: ModerateIn, hits, failed) -> engine.Decision:
    """Decisión mínima si el motor falla: hash S0 → no publicar; todo lo demás → fail-open a la etapa 2."""
    s0 = [h for h in hits if (st.cfg["policies"].get(h.policy) or {}).get("severity") == "S0"]
    block = bool(s0)
    return engine.Decision(
        item_id=body.item_id, surface=body.surface, path="sync",
        action="block_prepublish" if block else "none",
        policy=s0[0].policy if block else None, severity="S0" if block else None,
        source="hash" if block else "none", scores={},
        config_version=st.cfg["version"], policy_definitions_version=st.cfg["policy_definitions_version"],
        model_versions={}, needs_review=False, fail_open=not block,
        fail_open_reasons=sorted([f"{k}:{v}" for k, v in failed.items()] + ["engine:error"]),
        send_to_deep_scorer=not block, deep_scoring_priority=None if block else "high",
        escalation="s0_specialist_team" if block else None,
        decision_id=f"emergency-{body.item_id}",
    )


def _enqueue_event(st: State, event: dict) -> None:
    """Encola sin bloquear. Si el buffer está lleno (Kafka caído varios segundos), se descarta y se cuenta.

    Por qué no esperar a Kafka dentro del request: un broker lento no puede sumar latencia a cada post.
    El costo: un pod que muere con eventos en el buffer los pierde. Mitigación (fuera de este archivo):
    un job de reconciliación compara los posts creados con los eventos y re-encola los que faltan.
    """
    try:
        st.events.put_nowait(event)
    except asyncio.QueueFull:
        EVENTS_DROPPED.inc()
    EVENTS_BUFFERED.set(st.events.qsize())


async def _publish_loop(st: State, publisher: EventPublisher, settings: Settings) -> None:
    """Vacía el buffer hacia Kafka con 3 intentos y backoff. Key = item_id: los eventos de un mismo
    ítem (publicación, re-scoring, reporte) caen en la misma partición y se consumen en orden."""
    while True:
        event = await st.events.get()
        try:
            for attempt in range(3):
                try:
                    await publisher.publish(settings.events_topic, event["item_id"],
                                            json.dumps(event, ensure_ascii=False).encode("utf-8"))
                    break
                except Exception:
                    if attempt == 2:
                        EVENTS_FAILED.inc()
                    else:
                        await asyncio.sleep(0.05 * 2**attempt)
        finally:
            st.events.task_done()
            EVENTS_BUFFERED.set(st.events.qsize())


async def _updates_loop(st: State, updates: HashUpdates) -> None:
    """Aplica altas/bajas de hashes en caliente: lo que removimos hace 2 min ya bloquea la re-subida."""
    async for e in updates:
        try:
            apply_hash_entry(st, e)
            st.ready = st.ready or len(st.pdq) > 0
        except Exception as exc:  # una entrada mala no detiene el stream (y queda en el log)
            log.warning(json.dumps({"event": "hash_update_error", "error": str(exc)[:200]}))


# ---------------------------------------------------------------------------- entradas (uvicorn --factory)
def build_app() -> FastAPI:
    """Producción: `uvicorn --factory main:build_app`. Falta conectar los adaptadores reales.

    No se incluyen porque no se pudieron probar aquí (sin Triton ni Kafka), y código sin probar no se
    publica como referencia. Lo que cada uno tiene que hacer:
      - TextScorer / ImageScorer: tritonclient.http.aio (o grpc.aio) contra los modelos de la etapa 1;
        la tokenización del texto, en el gateway o en un ensemble de Triton (la misma que en training).
      - EventPublisher: un productor async de Kafka con acks=all y enable.idempotence=true.
      - HashUpdates: consumer del tópico de novedades de hashes (altas, bajas y heartbeats).
    """
    raise NotImplementedError("conecta los adaptadores reales de Triton, Kafka y hashes (ver README)")


class _DemoScorer:
    """Modelo falso para la demo local: todo limpio salvo palabras clave obvias. NO es un clasificador."""

    def __init__(self, stage: str):
        self.stage = stage

    async def score(self, *args) -> engine.StageResult:
        await asyncio.sleep(0.005)  # ≈ lo que tardaría un Triton cercano con batching (est.)
        text = args[0] if self.stage == "stage1_text" and args else ""
        spam = 0.995 if isinstance(text, str) and "gratis" in text.lower() else 0.01
        return engine.StageResult(self.stage, "demo-0", {"spam_scams": spam, "hate_harassment": 0.01})


class _StdoutPublisher:
    async def publish(self, topic: str, key: str, value: bytes) -> None:
        print(f"[kafka:{topic}] key={key} {value[:120].decode('utf-8', 'replace')}…", flush=True)


def demo_app() -> FastAPI:
    """Demo local SIN Triton ni Kafka: `HASH_SNAPSHOT_PATH=demo_hashes.jsonl uvicorn --factory main:demo_app`."""
    return create_app(Deps(_DemoScorer("stage1_text"), _DemoScorer("stage1_image"), _StdoutPublisher()))
