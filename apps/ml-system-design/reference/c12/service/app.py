"""Servicio HTTP del agente de soporte (caso c12): conversación por SSE, webhook de aprobaciones y métricas.

Endpoints:
  POST /v1/conversations/{id}/messages   un mensaje del cliente → stream SSE de eventos del turno
        body {"message_id": "m-…", "text": "…", "confirm_action_id": null, "conversation_type": "order_support"}
        eventos: status · message_delta · message · confirmation_required · approval_pending · handoff · done
  GET  /v1/conversations/{id}/events?after=N   eventos guardados después del step N (reconexión, y el aviso que
        llega cuando una persona aprueba horas después)
  POST /v1/conversations/{id}/close      fin de la conversación (la app o un job de inactividad): costo y resultado
  POST /v1/approvals/{approval_id}       webhook de la herramienta interna de aprobaciones, FIRMADO (HMAC)
  GET  /metrics, GET /healthz

Tres decisiones que no se ven en la lista:
  1. El turno corre en una TAREA APARTE del request. Si el cliente cierra la app a mitad de un reembolso, el turno
     termina igual (y el aviso queda en /events). En #c10 era al revés: cancelar el stream libera GPU; aquí cancelar
     a mitad de una escritura deja un efecto a medias. Lo que se corta es el stream, no el trabajo.
  2. Un turno a la vez por conversación (409 si llega otro): dos turnos en paralelo leerían el mismo step log y
     podrían proponer la misma acción dos veces. El lock es por proceso; con varias réplicas, las conversaciones
     se rutean por afinidad o el lock va a la base (un lease en Postgres).
  3. El webhook de aprobaciones se verifica con HMAC-SHA256 sobre "timestamp.cuerpo" y una ventana de 5 min
     (mismo esquema que usan proveedores de pagos para sus webhooks): sin firma, cualquiera que llegue a la red
     interna podría aprobar reembolsos; sin timestamp, un webhook capturado se podría reenviar.

Métricas (Prometheus): NINGUNA lleva customer_id ni conversation_id como label. Serían millones de series (y
datos personales en el sistema de métricas); por conversación se mira la traza o el step log, no Prometheus.

Correr la demo (modelo por reglas y backend en memoria): uvicorn --factory service.app:demo_app --port 8090
desde reference/c12 (ver README).
"""

# Sin `from __future__ import annotations` a propósito: FastAPI lee las anotaciones de las rutas (Depends dentro de
# Annotated) y las dependencias son funciones locales de build_app; como texto no las podría resolver.

import asyncio  # tareas de turno, locks
import hashlib  # HMAC del webhook
import hmac  # comparación en tiempo constante
import json  # cuerpo crudo del webhook
import logging  # errores de turno
import os  # configuración de la demo
import time  # ventana del webhook
from collections.abc import AsyncIterator, Callable  # tipos
from contextlib import asynccontextmanager  # lifespan
from datetime import UTC, datetime  # backlog de aprobaciones
from decimal import Decimal  # montos en métricas
from typing import Annotated, Literal  # validación del body

from fastapi import Depends, FastAPI, Header, HTTPException, Request  # el servidor
from fastapi.responses import Response  # /metrics
from fastapi.sse import EventSourceResponse, ServerSentEvent  # SSE nativo de FastAPI (0.142.2, la fijada)
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest
from pydantic import BaseModel, Field  # bodies

from agent.backend import InMemoryCommerceBackend, demo_orders  # backend falso para la demo
from agent.llm import DemoChatModel  # modelo por reglas para la demo
from agent.loop import LIMIT_REASONS, AgentLoop, ApprovalAlreadyDecided, Event  # el orquestador
from agent.policy import AuthContext  # identidad
from agent.state import NotOwner, StepLog  # step log
from agent.tools import ToolExecutor  # herramientas

log = logging.getLogger("c12.service")


# ------------------------------------------------------------------ métricas
class PrometheusObserver:
    """Implementa agent.loop.Observer con métricas de Prometheus. Los nombres los usan monitoring/alerts.yml
    (un test verifica que cada métrica de las alertas exista en /metrics)."""

    def __init__(self, registry: CollectorRegistry, store: StepLog):
        r = registry
        self.tool_calls = Counter("agent_tool_calls_total", "Tool calls por herramienta y resultado",
                                  ["tool", "outcome"], registry=r)
        self.tool_latency = Histogram("agent_tool_latency_seconds", "Latencia de herramientas (con reintentos)",
                                      ["tool"], buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8), registry=r)
        self.llm_calls = Counter("agent_llm_calls_total", "Llamadas al modelo", registry=r)
        self.llm_tokens = Counter("agent_llm_tokens_total", "Tokens del modelo (usage)", ["direction"], registry=r)
        self.denials = Counter("agent_policy_denials_total", "Acciones negadas por la política",
                               ["tool", "reason"], registry=r)
        self.violations = Counter("agent_policy_violations_total",
                                  "Tripwire: algo que la política no debió permitir (debe ser siempre 0)",
                                  ["check"], registry=r)
        self.limits = Counter("agent_step_limit_hits_total", "Límites tocados (cada uno termina en hand-off)",
                              ["limit"], registry=r)
        self.turns = Counter("agent_turns_total", "Turnos por tipo y resultado", ["conversation_type", "outcome"],
                             registry=r)
        # Bordes EXACTOS en 4 s (primera respuesta visible, SLO p95) y 12 s (turno completo, SLO p95)
        self.turn_seconds = Histogram("agent_turn_duration_seconds", "Duración de un turno completo",
                                      ["conversation_type"], buckets=(1, 2, 4, 6, 8, 10, 12, 15, 20, 30),
                                      registry=r)
        self.first_seconds = Histogram("agent_first_response_seconds",
                                       "Hasta el primer evento visible (estado o texto)", ["conversation_type"],
                                       buckets=(0.5, 1, 2, 3, 4, 6, 8, 12), registry=r)
        self.started = Counter("agent_conversations_started_total", "Conversaciones nuevas", ["conversation_type"],
                               registry=r)
        self.closed = Counter("agent_conversations_closed_total", "Conversaciones cerradas por resultado",
                              ["conversation_type", "outcome"], registry=r)
        self.handoffs = Counter("agent_handoffs_total", "Hand-offs a personas por motivo",
                                ["conversation_type", "reason"], registry=r)
        self.cost = Histogram("agent_conversation_cost_usd", "Costo interno por conversación (showback, US$)",
                              ["conversation_type"],
                              buckets=(0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.1), registry=r)
        self.refunds = Counter("agent_refunds_total", "Reembolsos emitidos por el agente", ["path"], registry=r)
        self.refund_usd = Counter("agent_refund_amount_usd_total", "US$ reembolsados por el agente", ["path"],
                                  registry=r)
        self.flags = Counter("agent_injection_flags_total", "Banderas heurísticas de inyección",
                             ["source", "rule"], registry=r)
        # Series en 0 desde el arranque. Trampa de Prometheus: un counter con labels NO existe hasta su primer
        # inc(); la primera muestra ya vale 1 y increase()/rate() no ven el salto de 0 a 1. Para la alerta de
        # tolerancia cero (AgentPolicyViolation), eso sería no despertar a nadie en la PRIMERA violación.
        self.violations.labels("refund_over_limit_without_approval")
        for lim in LIMIT_REASONS:
            self.limits.labels(lim)
        for path in ("auto", "approved"):
            self.refunds.labels(path)
            self.refund_usd.labels(path)
        pending = Gauge("agent_approvals_pending", "Aprobaciones esperando a una persona", registry=r)
        oldest = Gauge("agent_approval_oldest_pending_seconds",
                       "Edad en segundos HÁBILES de la aprobación pendiente más vieja", registry=r)
        # Se calculan al momento del scrape desde la tabla de acciones (la fuente de verdad), no en memoria
        pending.set_function(lambda: store.approval_backlog(datetime.now(UTC))[0])
        oldest.set_function(lambda: store.approval_backlog(datetime.now(UTC))[1])

    def tool_call(self, tool: str, outcome: str, latency_s: float) -> None:
        self.tool_calls.labels(tool, outcome).inc()
        self.tool_latency.labels(tool).observe(latency_s)

    def policy_denial(self, tool: str, reason: str) -> None:
        self.denials.labels(tool, reason).inc()

    def step_limit(self, limit: str) -> None:
        self.limits.labels(limit).inc()

    def llm_call(self, prompt_tokens: int, completion_tokens: int, latency_s: float) -> None:
        self.llm_calls.inc()
        self.llm_tokens.labels("input").inc(prompt_tokens)
        self.llm_tokens.labels("output").inc(completion_tokens)

    def turn(self, conversation_type: str, outcome: str, duration_s: float, first_response_s: float | None) -> None:
        self.turns.labels(conversation_type, outcome).inc()
        self.turn_seconds.labels(conversation_type).observe(duration_s)
        if first_response_s is not None:
            self.first_seconds.labels(conversation_type).observe(first_response_s)

    def conversation_started(self, conversation_type: str) -> None:
        self.started.labels(conversation_type).inc()

    def conversation_closed(self, conversation_type: str, outcome: str, cost_usd: float) -> None:
        self.closed.labels(conversation_type, outcome).inc()
        self.cost.labels(conversation_type).observe(cost_usd)

    def handoff(self, conversation_type: str, reason: str) -> None:
        self.handoffs.labels(conversation_type, reason).inc()

    def refund(self, path: str, amount_usd: Decimal) -> None:
        self.refunds.labels(path).inc()
        self.refund_usd.labels(path).inc(float(amount_usd))

    def policy_violation(self, check: str) -> None:
        self.violations.labels(check).inc()

    def injection_flag(self, source: str, rule: str) -> None:
        self.flags.labels(source, rule).inc()


# ------------------------------------------------------------------ requests
class MessageIn(BaseModel):
    message_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")  # lo genera la app
    text: str = Field(max_length=4000)  # un mensaje de chat; más largo es otra cosa (y otro costo)
    confirm_action_id: str | None = Field(default=None, max_length=40)  # el botón "Confirmar" de la UI
    conversation_type: Literal["order_support", "general_question"] = "order_support"


class ApprovalIn(BaseModel):
    decision: Literal["approved", "rejected"]
    approver_id: str = Field(min_length=1, max_length=64)
    note: str = Field(default="", max_length=500)


Authenticator = Callable[[str], AuthContext | None]


def static_tokens(tokens: dict[str, str]) -> Authenticator:
    """Autenticación de DEMO: token → customer_id. En producción, la sesión del marketplace (un JWT verificado
    contra su emisor); el agente nunca recibe la contraseña ni decide quién es el cliente."""
    return lambda token: AuthContext(tokens[token]) if token in tokens else None


def sign_webhook(secret: str, timestamp: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def _sse(ev: Event) -> ServerSentEvent:
    return ServerSentEvent(event=ev.type, data=ev.data, id=str(ev.id) if ev.id is not None else None)


# ------------------------------------------------------------------ la app
def build_app(loop: AgentLoop, store: StepLog, authenticate: Authenticator, *, webhook_secret: str,
              registry: CollectorRegistry | None = None, drain_timeout_s: float = 25.0) -> FastAPI:
    registry = registry or CollectorRegistry()
    loop.obs = PrometheusObserver(registry, store)
    tasks: set[asyncio.Task] = set()
    locks: dict[str, asyncio.Lock] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        # Apagado: se dejan terminar los turnos en curso (≤ 20 s cada uno + 3 s de la última herramienta).
        # terminationGracePeriodSeconds del pod tiene que ser mayor que esto. Lo que no termine se retoma con
        # AgentLoop.resume desde el step log al arrancar otro pod.
        if tasks:
            await asyncio.wait(tasks, timeout=drain_timeout_s)
        store.close()

    app = FastAPI(title="support-agent (c12)", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.tasks, app.state.locks = tasks, locks

    def auth(authorization: Annotated[str | None, Header()] = None) -> AuthContext:
        token = (authorization or "").removeprefix("Bearer ").strip()
        who = authenticate(token) if token else None
        if who is None:
            raise HTTPException(401, "invalid session")
        return who

    def own(conversation_id: str, who: Annotated[AuthContext, Depends(auth)]) -> AuthContext:
        conv = store.get_conversation(conversation_id)
        if conv is not None and conv.customer_id != who.customer_id:
            raise HTTPException(404, "conversation not found")  # ajena = inexistente (no se confirma que existe)
        return who

    async def turn_lock(conversation_id: str) -> AsyncIterator[dict]:
        """409 si ya corre un turno de esta conversación. Es una dependencia (no código dentro del stream)
        porque una vez que el stream SSE empezó, el status ya es 200 y no se puede cambiar."""
        lock = locks.setdefault(conversation_id, asyncio.Lock())
        if lock.locked():
            raise HTTPException(409, "a turn is already running for this conversation")
        await lock.acquire()
        handle = {"lock": lock, "taken_by_task": False}
        try:
            yield handle
        finally:
            if not handle["taken_by_task"]:  # el turno nunca arrancó (p. ej. el cliente se fue antes)
                lock.release()

    @app.post("/v1/conversations/{conversation_id}/messages", response_class=EventSourceResponse)
    async def post_message(conversation_id: str, body: MessageIn, who: Annotated[AuthContext, Depends(own)],
                           held: Annotated[dict, Depends(turn_lock)]) -> AsyncIterator[ServerSentEvent]:
        lock = held["lock"]
        held["taken_by_task"] = True  # desde aquí, el lock lo suelta la tarea del turno al terminar
        queue: asyncio.Queue[Event | None] = asyncio.Queue()

        async def pump() -> None:
            try:
                async for ev in loop.run_turn(conversation_id=conversation_id, auth=who, message_id=body.message_id,
                                              text=body.text, conversation_type=body.conversation_type,
                                              confirm_action_id=body.confirm_action_id):
                    await queue.put(ev)
            except NotOwner:
                await queue.put(Event("error", {"code": "conversation_not_found"}))
            except Exception:  # el turno falló: queda incompleto en el step log y se retoma con resume
                log.exception("turn failed")
                await queue.put(Event("error", {"code": "internal_error",
                                                "text": "Tuvimos un problema; seguimos con tu caso en breve."}))
            finally:
                lock.release()
                await queue.put(None)

        task = asyncio.create_task(pump())  # NO ligada al request: si el cliente se va, el turno sigue
        tasks.add(task)
        task.add_done_callback(tasks.discard)
        while (ev := await queue.get()) is not None:
            yield _sse(ev)

    @app.get("/v1/conversations/{conversation_id}/events")
    async def get_events(conversation_id: str, who: Annotated[AuthContext, Depends(own)], after: int = 0) -> dict:
        if store.get_conversation(conversation_id) is None:
            raise HTTPException(404, "conversation not found")
        return {"events": [{"id": s.step_id, "type": s.payload["type"], "data": s.payload["data"]}
                           for s in store.events(conversation_id, after_step=after)]}

    @app.post("/v1/conversations/{conversation_id}/close")
    async def close(conversation_id: str, who: Annotated[AuthContext, Depends(own)]) -> dict:
        try:
            return loop.close(conversation_id, who)
        except KeyError as e:
            raise HTTPException(404, "conversation not found") from e

    @app.post("/v1/approvals/{approval_id}")
    async def approval(approval_id: str, request: Request,
                       x_approval_timestamp: Annotated[str, Header()],
                       x_approval_signature: Annotated[str, Header()]) -> dict:
        raw = await request.body()  # la firma es sobre los BYTES recibidos, antes de parsear
        expected = sign_webhook(webhook_secret, x_approval_timestamp, raw)
        if not hmac.compare_digest(expected, x_approval_signature):  # tiempo constante
            raise HTTPException(401, "bad signature")
        try:
            skew = abs(time.time() - int(x_approval_timestamp))
        except ValueError as e:
            raise HTTPException(401, "bad timestamp") from e
        if skew > 300:
            raise HTTPException(401, "stale webhook")
        body = ApprovalIn.model_validate(json.loads(raw))
        try:
            events = await loop.decide_approval(approval_id, approved=body.decision == "approved",
                                                approver=body.approver_id, note=body.note)
        except KeyError as e:
            raise HTTPException(404, "approval not found") from e
        except ApprovalAlreadyDecided as e:
            raise HTTPException(409, f"already {e}") from e
        return {"approval_id": approval_id, "decision": body.decision,
                "events": [{"type": e.type, "data": e.data} for e in events]}

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    return app


def demo_app() -> FastAPI:
    """Demo local: modelo POR REGLAS (no es un modelo), backend en memoria con 4 pedidos y tokens fijos.
    cust-1 → token "tok-cust-1"; cust-2 → "tok-cust-2". Secreto del webhook: C12_WEBHOOK_SECRET o "demo-secret"."""
    backend = InMemoryCommerceBackend(demo_orders(datetime.now(UTC)))
    store = StepLog(os.environ.get("C12_DB_PATH", ":memory:"))
    loop = AgentLoop(DemoChatModel(), ToolExecutor(backend), store)
    return build_app(loop, store, static_tokens({"tok-cust-1": "cust-1", "tok-cust-2": "cust-2"}),
                     webhook_secret=os.environ.get("C12_WEBHOOK_SECRET", "demo-secret"))
