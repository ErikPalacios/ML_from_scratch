"""llm-gateway del caso c10: una API compatible con OpenAI delante de vllm-70b (y del vendor, como fallback gobernado).

Los tres productos internos (soporte, asistente de vendedores, enriquecimiento de catálogo) llaman a ESTO, nunca a
vLLM ni al vendor directo. Por qué un gateway propio y no "cada producto con su cliente de OpenAI":
  * quién es quién: API key por tenant → cuotas, prioridad, modelos permitidos y medición de uso por producto;
  * un ALIAS (`chat-default`) en vez de una revisión: cambiar de modelo es editar tenants.yaml, no tres deploys;
  * admisión: la flota tiene un techo (≈ 640 secuencias planeadas) y no crece en 1 minuto; alguien tiene que
    decidir quién pasa y a quién se le dice "reintenta en 2 s";
  * el ÚNICO lugar por donde un prompt puede salir de la VPC (al vendor), con redacción de PII y solo para los
    tenants que tienen permiso.

Un request de punta a punta (POST /v1/chat/completions, stream=true, tenant listing-assistant):
  1. Authorization: Bearer <key> → sha256 → tenant (401 si no existe). La key nunca se guarda ni se loguea.
  2. Validación: `model` es un alias que existe (404) y que el tenant puede usar (403); messages; n = 1;
     max_tokens ≤ el tope del tenant (400 si lo pasa; si no viene, se pone el tope: vLLM generaría hasta
     llenar el contexto); prompt estimado ≤ el tope de prompt del tenant (400).
  3. Cuota: se cobra prompt estimado + max_tokens del token bucket del tenant (429 + Retry-After si no
     alcanza). Al final se concilia con `usage` (quota.py).
  4. Admisión: un lugar en vuelo para su clase (interactive/batch) o espera acotada (admission.py). Sin lugar:
     503 + Retry-After, o el vendor si el tenant puede (`overloaded`).
  5. Upstream: alias → revisión servida (`chat-70b-fp8-2026-09-28`, o la que el tenant tenga fijada durante un
     canary), `priority` 0 o 10 para el scheduler de vLLM, y stream_options.include_usage para poder conciliar
     tokens.
  6. Antes del primer byte al cliente, una falla del upstream (conexión, 5xx, sin primer evento en 10 s) todavía
     se puede convertir en otra cosa: un 502/504 limpio o el vendor (si el tenant puede). Después del primer
     byte, no: se manda un evento de error y se corta. No se pueden pegar dos streams de dos modelos.
  7. Streaming SSE: cada evento se reenvía apenas llega; el TTFT se mide en el primer evento con CONTENIDO (el
     primer chunk de vLLM puede traer solo el rol). Si el cliente se va, se cierra la conexión con vLLM, que
     aborta el request: una GPU no debería generar 1,000 tokens para nadie.
  8. Cierre: liberar el lugar, conciliar la cuota, métricas y una línea de log SIN prompt ni respuesta.

Códigos: 400 request inválido · 401 key · 403 alias no permitido · 404 alias inexistente · 429 cuota del tenant
(su problema: Retry-After = cuándo le alcanza) · 503 plataforma llena (nuestro problema: Retry-After sugerido) ·
502/504 upstream caído o lento · 4xx del upstream: se reenvían tal cual (p. ej. prompt más largo que el contexto).
En métricas, "499" = el cliente cerró antes del final (convención de nginx) y "stream_error" = el upstream falló
con el stream ya empezado (el cliente vio un 200).

Correr la demo (upstream falso): uvicorn --factory llm_gateway:demo_app --port 8080 (ver README).
En producción: uvicorn --factory llm_gateway:app_from_env con GATEWAY_CONFIG=tenants.yaml y VENDOR_API_KEY.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # carreras con la desconexión del cliente y timeouts
import hashlib  # sha256 de las API keys
import json  # cuerpos OpenAI y eventos SSE
import logging  # una línea JSON por request
import math  # ceil del Retry-After
import os  # configuración por variables de entorno
import time  # reloj monotónico
import uuid  # request id
from collections.abc import AsyncIterator, Callable  # tipos
from contextlib import asynccontextmanager  # lifespan de la app
from dataclasses import dataclass, field  # configuración y estado del stream
from pathlib import Path  # leer tenants.yaml

import anyio  # CancelScope blindado para limpiar aunque la tarea esté cancelada
import httpx2  # cliente HTTP async hacia vLLM y el vendor (API de httpx; tests con MockTransport)
import yaml  # tenants.yaml
from fastapi import FastAPI, Request  # el servidor
from fastapi.responses import JSONResponse, Response, StreamingResponse  # respuestas
from prometheus_client import (  # métricas
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

from admission import PRIORITIES, AdmissionConfig, Overloaded, PriorityAdmission  # quién pasa a la flota
from pii import Redactor  # redacción antes del vendor
from quota import TokenBucket, estimate_prompt_tokens  # cuotas en tokens

log = logging.getLogger("llm_gateway")

# Prioridad que entiende vLLM con --scheduling-policy priority: MENOR número = antes (y desalojado último).
# Sin ese flag en el servidor, vLLM rechaza cualquier priority distinta de 0 (lo dice su protocolo en v0.30.0).
VLLM_PRIORITY = {"interactive": 0, "batch": 10}

# Lo único que sale hacia el vendor: lista PERMITIDA, no lista prohibida. Un campo nuevo que agregue un cliente
# (o un parámetro propio de vLLM) no viaja fuera de la empresa por accidente. "user" queda afuera: suele
# llevar un id de persona.
VENDOR_FIELDS = frozenset({
    "model", "messages", "max_tokens", "max_completion_tokens", "temperature", "top_p", "stop", "seed",
    "presence_penalty", "frequency_penalty", "response_format", "tools", "tool_choice", "stream", "stream_options",
})

# Buckets elegidos para que los umbrales de las alertas (1.0 s de TTFT, 50 ms de TPOT) sean bordes EXACTOS:
# histogram_quantile interpola dentro de un bucket, y un umbral en medio de uno da un p95 inventado.
TTFT_BUCKETS = (0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.5, 5.0, 10.0, 20.0)
TPOT_BUCKETS = (0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.1, 0.2, 0.5)


# =============================================================================== configuración
@dataclass(frozen=True)
class Tenant:
    name: str
    key_sha256: frozenset[str]
    priority: str  # "interactive" | "batch": la decide la plataforma, no el cliente
    tokens_per_minute: int  # cuota TOTAL del tenant (se reparte entre réplicas del gateway)
    allowed_aliases: frozenset[str]
    max_tokens_cap: int
    vendor_fallback: bool
    max_prompt_tokens: int  # tope de prompt ESTIMADO (quota.py): un loop que manda historiales infinitos no pasa
    pins: dict = field(default_factory=dict)  # alias → revisión fija para ESTE tenant (canary por tenant, rollback)

    def model_for(self, alias: "Alias") -> str:
        return self.pins.get(alias.name, alias.model)


@dataclass(frozen=True)
class Alias:
    name: str
    upstream: str  # nombre en `upstreams`
    model: str  # revisión servida (--served-model-name)
    vendor_model: str | None  # None = este alias nunca va al vendor


@dataclass(frozen=True)
class Limits:
    gateway_replicas: int = 4
    max_inflight: int = 160
    interactive_reserved: int = 40
    queue_max: dict = field(default_factory=lambda: {"interactive": 64, "batch": 256})
    max_wait_s: dict = field(default_factory=lambda: {"interactive": 0.5, "batch": 30.0})
    retry_after_s: dict = field(default_factory=lambda: {"interactive": 2.0, "batch": 60.0})
    connect_timeout_s: float = 2.0
    first_token_timeout_s: float = 10.0
    read_timeout_s: float = 30.0
    total_timeout_s: float = 120.0


@dataclass(frozen=True)
class GatewayConfig:
    max_model_len: int
    limits: Limits
    upstreams: dict  # nombre → {"base_url", "kind"}
    aliases: dict  # nombre → Alias
    tenants: dict  # nombre → Tenant
    by_key: dict  # sha256 de la key → Tenant


def load_config(source: str | Path | dict) -> GatewayConfig:
    """Lee y VALIDA tenants.yaml. Todo error de configuración se detecta aquí, al arrancar."""
    raw = source if isinstance(source, dict) else yaml.safe_load(Path(source).read_text())
    allowed_top = {"max_model_len", "limits", "upstreams", "aliases", "tenants"}
    if unknown := set(raw) - allowed_top:
        raise ValueError(f"claves desconocidas en la configuración: {sorted(unknown)}")  # un typo no se ignora
    limits = Limits(**raw.get("limits", {}))
    upstreams = raw["upstreams"]
    for name, u in upstreams.items():
        if u.get("kind") not in ("self", "vendor"):
            raise ValueError(f"upstream {name}: kind debe ser self o vendor")
    aliases = {}
    for name, a in raw["aliases"].items():
        if a["upstream"] not in upstreams or upstreams[a["upstream"]]["kind"] != "self":
            raise ValueError(f"alias {name}: upstream {a['upstream']!r} no es una flota propia")
        aliases[name] = Alias(name, a["upstream"], a["model"], a.get("vendor_model"))
    tenants, by_key = {}, {}
    per_replica_floor = raw["max_model_len"] * limits.gateway_replicas
    for name, t in raw["tenants"].items():
        tenant = Tenant(
            name=name,
            key_sha256=frozenset(t["key_sha256"]),
            priority=t["priority"],
            tokens_per_minute=int(t["tokens_per_minute"]),
            allowed_aliases=frozenset(t["allowed_aliases"]),
            max_tokens_cap=int(t["max_tokens_cap"]),
            vendor_fallback=bool(t["vendor_fallback"]),
            max_prompt_tokens=int(t["max_prompt_tokens"]),
            pins=dict(t.get("pins") or {}),
        )
        if unknown_t := set(t) - {"key_sha256", "priority", "tokens_per_minute", "allowed_aliases", "max_tokens_cap",
                                  "vendor_fallback", "max_prompt_tokens", "pins"}:
            raise ValueError(f"tenant {name}: claves desconocidas {sorted(unknown_t)}")
        if not 1 <= tenant.max_prompt_tokens < raw["max_model_len"]:
            raise ValueError(f"tenant {name}: max_prompt_tokens fuera de rango")
        if bad_pins := set(tenant.pins) - set(tenant.allowed_aliases):
            raise ValueError(f"tenant {name}: fija revisiones de alias que no puede usar {sorted(bad_pins)}")
        if tenant.priority not in PRIORITIES:
            raise ValueError(f"tenant {name}: prioridad {tenant.priority!r} desconocida")
        if missing := tenant.allowed_aliases - set(aliases):
            raise ValueError(f"tenant {name}: alias inexistentes {sorted(missing)}")
        if tenant.tokens_per_minute < per_replica_floor:
            # Cada réplica necesita lugar para al menos un request de contexto completo, o ese request nunca pasa
            raise ValueError(f"tenant {name}: tokens_per_minute < max_model_len × réplicas ({per_replica_floor})")
        if not 1 <= tenant.max_tokens_cap < raw["max_model_len"]:
            raise ValueError(f"tenant {name}: max_tokens_cap fuera de rango")
        if tenant.vendor_fallback and not any(aliases[a].vendor_model for a in tenant.allowed_aliases):
            raise ValueError(f"tenant {name}: vendor_fallback sin ningún alias con vendor_model")
        for h in tenant.key_sha256:
            if len(h) != 64 or h in by_key:
                raise ValueError(f"tenant {name}: hash de key inválido o repetido")
            by_key[h] = tenant
        tenants[name] = tenant
    return GatewayConfig(int(raw["max_model_len"]), limits, upstreams, aliases, tenants, by_key)


# =============================================================================== upstreams
class UpstreamUnavailable(Exception):
    """El upstream no está o no contesta a tiempo: candidato a fallback. kind = "error" | "timeout"."""

    def __init__(self, kind: str, detail: str):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind


class UpstreamRejected(Exception):
    """El upstream contestó 4xx: el request está mal (o el vendor nos limitó). Se reenvía tal cual."""

    def __init__(self, status: int, body: dict, headers: dict | None = None):
        super().__init__(f"HTTP {status}")
        self.status, self.body, self.headers = status, body, headers or {}


def _error_body(resp: httpx2.Response) -> dict:
    try:
        return resp.json()
    except ValueError:
        return {"error": {"message": resp.text[:500], "type": "upstream_error"}}


class SSEStream:
    """Eventos `data:` de una respuesta SSE. next_event() devuelve el payload, o None al terminar."""

    def __init__(self, resp: httpx2.Response):
        self._resp = resp
        self._lines = resp.aiter_lines()

    async def next_event(self) -> str | None:
        data: list[str] = []
        try:
            async for line in self._lines:
                if line == "":  # línea vacía = fin del evento
                    if data:
                        return "\n".join(data)
                    continue
                if line.startswith("data:"):
                    data.append(line[5:].lstrip())  # "data: {...}" → "{...}"
                # otras líneas SSE (": comentario", "event:", "id:") no las usa la API de OpenAI: se ignoran
        except httpx2.TimeoutException as e:
            raise UpstreamUnavailable("timeout", f"stream: {e!r}") from e
        except httpx2.TransportError as e:
            raise UpstreamUnavailable("error", f"stream: {e!r}") from e
        return "\n".join(data) if data else None

    async def aclose(self) -> None:
        await self._resp.aclose()  # cerrar la conexión: vLLM detecta la desconexión y aborta el request


class HttpUpstream:
    """Un servidor compatible con OpenAI (vLLM o el vendor) detrás de httpx2. `transport` permite tests sin red."""

    def __init__(self, name: str, base_url: str, kind: str, limits: Limits,
                 api_key: str | None = None, transport: httpx2.AsyncBaseTransport | None = None,
                 connect_retries: int = 1):
        self.name, self.kind, self.limits = name, kind, limits
        # Un reintento SOLO si la conexión ni se estableció (ConnectError): el request no llegó a ningún servidor,
        # así que reintentar no duplica trabajo. Pasa en cada deploy: un pod que ya recibió SIGTERM rechaza
        # conexiones mientras todavía figura en los endpoints; la conexión nueva cae en otro. Nada de reintentos
        # ante timeouts o 5xx: ahí el request pudo haber llegado, y reintentar en masa es una tormenta (#m03).
        self.connect_retries = connect_retries
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.client = httpx2.AsyncClient(
            base_url=base_url,
            headers=headers,
            transport=transport,
            # connect corto (una réplica que no acepta en 2 s está mal); read = silencio máximo entre bytes
            timeout=httpx2.Timeout(connect=limits.connect_timeout_s, read=limits.read_timeout_s,
                                   write=10.0, pool=limits.connect_timeout_s),
        )

    async def _send(self, body: dict, stream: bool) -> httpx2.Response:
        # Sin streaming, el primer byte llega al final: el read timeout tiene que cubrir la generación entera
        timeout = None if stream else httpx2.Timeout(self.limits.total_timeout_s, connect=self.limits.connect_timeout_s)
        for attempt in range(self.connect_retries + 1):
            req = self.client.build_request("POST", "/chat/completions", json=body,
                                            **({} if timeout is None else {"timeout": timeout}))
            try:
                return await self.client.send(req, stream=stream)
            except httpx2.ConnectError:
                if attempt == self.connect_retries:
                    raise
        raise AssertionError("inalcanzable")

    async def complete(self, body: dict) -> dict:
        try:
            resp = await self._send(body, stream=False)
        except httpx2.TimeoutException as e:
            raise UpstreamUnavailable("timeout", repr(e)) from e
        except httpx2.TransportError as e:
            raise UpstreamUnavailable("error", repr(e)) from e
        if resp.status_code >= 500:
            raise UpstreamUnavailable("error", f"HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise UpstreamRejected(resp.status_code, _error_body(resp), _retry_after_header(resp))
        return resp.json()

    async def open_stream(self, body: dict) -> SSEStream:
        try:
            resp = await self._send(body, stream=True)  # vuelve con los headers; el cuerpo se lee después
        except httpx2.TimeoutException as e:
            raise UpstreamUnavailable("timeout", repr(e)) from e
        except httpx2.TransportError as e:
            raise UpstreamUnavailable("error", repr(e)) from e
        if resp.status_code >= 400:
            await resp.aread()
            await resp.aclose()
            if resp.status_code >= 500:
                raise UpstreamUnavailable("error", f"HTTP {resp.status_code}")
            raise UpstreamRejected(resp.status_code, _error_body(resp), _retry_after_header(resp))
        return SSEStream(resp)

    async def aclose(self) -> None:
        await self.client.aclose()


def _retry_after_header(resp: httpx2.Response) -> dict:
    return {"Retry-After": resp.headers["retry-after"]} if "retry-after" in resp.headers else {}


# =============================================================================== métricas
class Metrics:
    """Todas las métricas del gateway en un registry propio (un registry por app: tests aislados)."""

    def __init__(self, registry: CollectorRegistry, admission: PriorityAdmission, max_inflight: int):
        r = registry
        # status: código HTTP como texto, "499" (el cliente se fue) o "stream_error". tenant y alias son listas
        # cerradas (la configuración): un alias desconocido se cuenta como "unknown", no como un label nuevo.
        self.requests = Counter("llm_gateway_requests_total", "Requests por tenant, alias y resultado",
                                ["tenant", "alias", "status"], registry=r)
        # Tokens reales (usage), por dirección y backend: lo que se factura internamente a cada producto y lo
        # que se le paga al vendor. backend = self | vendor.
        self.tokens = Counter("llm_gateway_tokens_total", "Tokens según usage", ["tenant", "direction", "backend"],
                              registry=r)
        self.ttft = Histogram("llm_gateway_ttft_seconds",
                              "Desde que el request llega al gateway hasta el primer token con contenido",
                              ["alias", "priority", "backend"], buckets=TTFT_BUCKETS, registry=r)
        self.tpot = Histogram("llm_gateway_tpot_seconds",
                              "Por request: (último token − primer token) ÷ (tokens de salida − 1)",
                              ["alias", "priority", "backend"], buckets=TPOT_BUCKETS, registry=r)
        self.vendor = Counter("llm_gateway_vendor_requests_total", "Requests mandados al vendor y por qué",
                              ["tenant", "reason"], registry=r)
        self.pii = Counter("llm_gateway_pii_redactions_total", "Ocurrencias de PII redactadas antes del vendor",
                           ["kind"], registry=r)
        queue = Gauge("llm_gateway_queue_depth", "Requests esperando lugar, por clase", ["priority"], registry=r)
        inflight = Gauge("llm_gateway_inflight", "Requests en vuelo hacia la flota, por clase", ["priority"],
                         registry=r)
        for p in PRIORITIES:  # los gauges se leen del objeto de admisión en cada scrape: nunca se desfasan
            queue.labels(p).set_function(lambda p=p: admission.queue_depth(p))
            inflight.labels(p).set_function(lambda p=p: admission.inflight(p))
        Gauge("llm_gateway_max_inflight", "Tope de requests en vuelo de esta réplica", registry=r).set(max_inflight)


# =============================================================================== el gateway
class ClientGone(Exception):
    """El cliente cerró la conexión antes de la respuesta."""


def _error(status: int, message: str, etype: str, code: str, headers: dict | None = None) -> JSONResponse:
    """Errores con la forma de OpenAI: los SDKs de los productos ya saben leerla."""
    return JSONResponse({"error": {"message": message, "type": etype, "code": code}}, status_code=status,
                        headers=headers)


async def race_disconnect(request: Request, coro, poll_s: float = 0.25):
    """Espera `coro`, pero si el cliente se va antes, cancela (cierra la conexión con vLLM → aborta)."""
    task = asyncio.ensure_future(coro)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=poll_s)
            if done:
                return task.result()
            if await request.is_disconnected():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise ClientGone()
    except asyncio.CancelledError:
        task.cancel()
        raise


@dataclass
class StreamState:
    """Lo que hay que cerrar y contar al terminar un stream, pase lo que pase (fin, error o desconexión)."""

    gw: "Gateway"
    tenant: Tenant
    alias: str
    priority: str
    backend: str
    stream: SSEStream
    holds_slot: bool  # True si ocupa un lugar de la flota (el vendor no ocupa)
    charged: int
    estimated_prompt: int
    t0: float
    client_wants_usage: bool
    request_id: str
    usage: dict | None = None
    first_content_t: float | None = None
    last_content_t: float | None = None
    done: bool = False
    status: str | None = None  # None mientras corre; "200" | "499" | "stream_error" | "500" al final
    closed: bool = False

    async def close(self, status: str) -> None:
        if self.closed:  # idempotente: lo pueden llamar el generador y la respuesta
            return
        self.closed = True
        self.status = self.status or status
        with anyio.CancelScope(shield=True):  # limpiar aunque la tarea esté siendo cancelada
            await self.stream.aclose()
        if self.holds_slot:
            self.gw.admission.release(self.priority)
        self.gw.finish(self.tenant, self.alias, self.priority, self.backend, self.status, self.charged,
                       self.estimated_prompt, self.usage, self.t0, self.first_content_t, self.last_content_t,
                       self.request_id)


class GuardedStream(StreamingResponse):
    """StreamingResponse que SIEMPRE limpia: aunque el cliente se vaya antes de que el generador arranque."""

    def __init__(self, content: AsyncIterator[bytes], state: StreamState, **kw):
        super().__init__(content, **kw)
        self._state = state

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        except Exception:
            await self._state.close("500")  # un bug nuestro a mitad del stream: se cuenta como tal
            raise
        finally:
            # Si no vimos [DONE] ni un error del upstream, el que cortó fue el cliente
            await self._state.close("200" if self._state.done else "499")


class Gateway:
    def __init__(self, cfg: GatewayConfig, upstreams: dict[str, HttpUpstream], registry: CollectorRegistry,
                 clock: Callable[[], float] = time.monotonic):
        self.cfg, self.upstreams, self.clock = cfg, upstreams, clock
        lim = cfg.limits
        self.admission = PriorityAdmission(AdmissionConfig(
            max_inflight=lim.max_inflight,
            interactive_reserved=lim.interactive_reserved,
            queue_max=tuple(lim.queue_max.items()),
            max_wait_s=tuple(lim.max_wait_s.items()),
            retry_after_s=tuple(lim.retry_after_s.items()),
        ))
        per_replica = {n: t.tokens_per_minute / lim.gateway_replicas for n, t in cfg.tenants.items()}
        # Bucket = un minuto de cuota de esta réplica; se recarga a cuota ÷ 60 por segundo
        self.buckets = {n: TokenBucket(q, q / 60.0, clock) for n, q in per_replica.items()}
        self.metrics = Metrics(registry, self.admission, lim.max_inflight)
        self.vendor = next((u for u in upstreams.values() if u.kind == "vendor"), None)

    # ---------------------------------------------------------------- cierre común
    def finish(self, tenant: Tenant, alias: str, priority: str, backend: str, status: str, charged: int,
               estimated_prompt: int, usage: dict | None, t0: float, first_t: float | None,
               last_t: float | None, request_id: str) -> None:
        """Concilia la cuota, cuenta métricas y loguea. Un solo lugar para todos los caminos de salida."""
        if usage:
            actual = int(usage.get("prompt_tokens", 0)) + int(usage.get("completion_tokens", 0))
            self.metrics.tokens.labels(tenant.name, "input", backend).inc(usage.get("prompt_tokens", 0))
            self.metrics.tokens.labels(tenant.name, "output", backend).inc(usage.get("completion_tokens", 0))
        elif status in ("499", "stream_error"):
            actual = estimated_prompt  # sin usage: el prefill ya se pagó; lo generado no lo sabemos
        else:
            actual = 0  # no llegó a la GPU (o falló antes): se devuelve todo
        if backend == "self" or usage:
            self.buckets[tenant.name].settle(charged, actual)
        self.metrics.requests.labels(tenant.name, alias, status).inc()
        out_tokens = int((usage or {}).get("completion_tokens", 0))
        if first_t is not None and last_t is not None and out_tokens > 1:
            self.metrics.tpot.labels(alias, priority, backend).observe((last_t - first_t) / (out_tokens - 1))
        # Una línea por request, SIN prompt ni respuesta: el contenido no se guarda por defecto (PII). Lo que se
        # loguea alcanza para facturar por tenant, depurar latencia y unir con las métricas por request_id.
        log.info(json.dumps({
            "request_id": request_id, "tenant": tenant.name, "alias": alias, "backend": backend, "status": status,
            "prompt_tokens": (usage or {}).get("prompt_tokens"), "completion_tokens": (usage or {}).get("completion_tokens"),
            "ttft_s": None if first_t is None else round(first_t - t0, 4), "duration_s": round(self.clock() - t0, 4),
        }))

    # ---------------------------------------------------------------- cuerpos hacia cada upstream
    def _self_body(self, body: dict, model: str, priority: str) -> dict:
        out = dict(body, model=model, priority=VLLM_PRIORITY[priority])
        if body.get("stream"):
            out["stream_options"] = dict(body.get("stream_options") or {}, include_usage=True)
        return out

    def _vendor_body(self, body: dict, alias: Alias) -> tuple[dict, Redactor]:
        red = Redactor()
        out = {k: v for k, v in body.items() if k in VENDOR_FIELDS}
        out["model"] = alias.vendor_model
        out["messages"] = red.redact_messages(body["messages"])
        if body.get("stream"):
            out["stream_options"] = dict(body.get("stream_options") or {}, include_usage=True)
        return out, red

    def _can_fallback(self, tenant: Tenant, alias: Alias) -> bool:
        return tenant.vendor_fallback and alias.vendor_model is not None and self.vendor is not None

    def _count_redactions(self, red: Redactor) -> None:
        for kind, n in red.counts.items():
            self.metrics.pii.labels(kind).inc(n)

    # ---------------------------------------------------------------- endpoint
    async def chat_completions(self, request: Request) -> Response:
        t0 = self.clock()
        rid = uuid.uuid4().hex
        auth = request.headers.get("authorization", "")
        key = auth[7:] if auth.lower().startswith("bearer ") else ""
        tenant = self.cfg.by_key.get(hashlib.sha256(key.encode()).hexdigest()) if key else None
        if tenant is None:
            return _error(401, "API key inválida", "authentication_error", "invalid_api_key")
        try:
            body = await request.json()
        except ValueError:
            return self._reject(tenant, "unknown", 400, "el cuerpo no es JSON", "invalid_request_error", "invalid_json")
        if not isinstance(body, dict):
            return self._reject(tenant, "unknown", 400, "el cuerpo debe ser un objeto", "invalid_request_error", "invalid_body")
        alias_name = body.get("model")
        alias = self.cfg.aliases.get(alias_name) if isinstance(alias_name, str) else None
        if alias is None:
            return self._reject(tenant, "unknown", 404, f"el modelo {alias_name!r} no existe", "invalid_request_error",
                                "model_not_found")
        if alias.name not in tenant.allowed_aliases:
            return self._reject(tenant, alias.name, 403, f"el tenant no puede usar {alias.name}", "permission_error",
                                "model_not_allowed")
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            return self._reject(tenant, alias.name, 400, "messages debe ser una lista no vacía",
                                "invalid_request_error", "invalid_messages")
        if body.get("n", 1) != 1:
            # n > 1 multiplica la salida (y el KV cache): la cuota y la admisión cuentan un solo resultado
            return self._reject(tenant, alias.name, 400, "solo se admite n = 1", "invalid_request_error", "invalid_n")
        max_tokens = body.get("max_completion_tokens", body.get("max_tokens"))
        if max_tokens is None:
            max_tokens = tenant.max_tokens_cap
            body["max_completion_tokens"] = max_tokens  # sin tope, vLLM genera hasta llenar el contexto
        if not isinstance(max_tokens, int) or isinstance(max_tokens, bool) or not 1 <= max_tokens <= tenant.max_tokens_cap:
            return self._reject(tenant, alias.name, 400, f"max_tokens debe estar entre 1 y {tenant.max_tokens_cap}",
                                "invalid_request_error", "max_tokens_exceeded")
        stream = bool(body.get("stream", False))

        # ---- cuota: prompt estimado + max_tokens, sin pasar del contexto (un request no puede usar más que eso)
        est_prompt = estimate_prompt_tokens(messages)
        if est_prompt > tenant.max_prompt_tokens:
            return self._reject(tenant, alias.name, 400, f"prompt de ≈ {est_prompt} tokens (tope {tenant.max_prompt_tokens})",
                                "invalid_request_error", "prompt_too_long")
        charged = min(est_prompt + max_tokens, self.cfg.max_model_len)
        ok, wait_s = self.buckets[tenant.name].try_take(charged)
        if not ok:
            return self._reject(tenant, alias.name, 429, "cuota de tokens por minuto agotada", "rate_limit_error",
                                "rate_limit_exceeded", {"Retry-After": str(max(1, math.ceil(wait_s)))})

        # ---- admisión a la flota
        priority = tenant.priority
        try:
            await self.admission.acquire(priority)
        except Overloaded as e:
            if self._can_fallback(tenant, alias):
                self.metrics.vendor.labels(tenant.name, "overloaded").inc()
                return await self._to_vendor(request, tenant, alias, body, stream, charged, est_prompt, t0, rid)
            self.buckets[tenant.name].settle(charged, 0)  # no se usó nada: se devuelve la cuota
            return self._reject(tenant, alias.name, 503, f"plataforma sin capacidad ({e.reason})",
                                "overloaded_error", "overloaded", {"Retry-After": str(math.ceil(e.retry_after_s))})
        except asyncio.CancelledError:
            self.buckets[tenant.name].settle(charged, 0)
            raise

        upstream = self.upstreams[alias.upstream]
        self_body = self._self_body(body, tenant.model_for(alias), priority)
        if stream:
            return await self._stream_self(request, tenant, alias, body, upstream, self_body, charged, est_prompt, t0, rid)
        return await self._complete_self(request, tenant, alias, body, upstream, self_body, charged, est_prompt, t0, rid)

    def _reject(self, tenant: Tenant, alias: str, status: int, message: str, etype: str, code: str,
                headers: dict | None = None) -> JSONResponse:
        self.metrics.requests.labels(tenant.name, alias, str(status)).inc()
        return _error(status, message, etype, code, headers)

    def _headers(self, rid: str, backend: str, model: str) -> dict:
        return {"x-request-id": rid, "x-llm-backend": backend, "x-model-revision": model}

    def _upstream_failure(self, tenant: Tenant, alias: Alias, e: UpstreamUnavailable) -> JSONResponse:
        if e.kind == "timeout":
            return self._reject(tenant, alias.name, 504, "el modelo no respondió a tiempo", "api_error", "upstream_timeout")
        return self._reject(tenant, alias.name, 502, "el modelo no está disponible", "api_error", "upstream_error")

    # ---------------------------------------------------------------- sin streaming
    async def _complete_self(self, request, tenant, alias, body, upstream, self_body, charged, est_prompt, t0, rid):
        try:
            data = await race_disconnect(request, upstream.complete(self_body))
        except UpstreamUnavailable as e:
            self.admission.release(tenant.priority)
            if self._can_fallback(tenant, alias):
                # La cuota es del tenant, no del backend: lo ya cobrado pasa al vendor y se concilia con su usage
                self.metrics.vendor.labels(tenant.name, f"upstream_{e.kind}").inc()
                return await self._to_vendor(request, tenant, alias, body, False, charged, est_prompt, t0, rid)
            self.buckets[tenant.name].settle(charged, 0)
            return self._upstream_failure(tenant, alias, e)
        except UpstreamRejected as e:
            self.admission.release(tenant.priority)
            self.buckets[tenant.name].settle(charged, 0)
            self.metrics.requests.labels(tenant.name, alias.name, str(e.status)).inc()
            return JSONResponse(e.body, status_code=e.status, headers=e.headers)
        except ClientGone:
            self.admission.release(tenant.priority)
            self.finish(tenant, alias.name, tenant.priority, "self", "499", charged, est_prompt, None, t0, None, None,
                        rid)
            return Response(status_code=499)
        except BaseException:
            self.admission.release(tenant.priority)
            self.buckets[tenant.name].settle(charged, 0)
            raise
        self.admission.release(tenant.priority)
        self.finish(tenant, alias.name, tenant.priority, "self", "200", charged, est_prompt, data.get("usage"), t0,
                    None, None, rid)
        return JSONResponse(data, headers=self._headers(rid, "self", tenant.model_for(alias)))

    # ---------------------------------------------------------------- con streaming
    async def _open_and_first(self, upstream: HttpUpstream, body: dict) -> tuple[SSEStream, str]:
        """Abre el stream y espera el PRIMER evento: hasta aquí todavía se puede elegir otro camino."""
        stream = await upstream.open_stream(body)
        try:
            first = await asyncio.wait_for(stream.next_event(), self.cfg.limits.first_token_timeout_s)
        except asyncio.TimeoutError:
            await stream.aclose()
            raise UpstreamUnavailable("timeout", "sin primer evento") from None
        except BaseException:
            await stream.aclose()
            raise
        if first is None:
            await stream.aclose()
            raise UpstreamUnavailable("error", "stream vacío")
        return stream, first

    async def _stream_self(self, request, tenant, alias, body, upstream, self_body, charged, est_prompt, t0, rid):
        try:
            stream, first = await race_disconnect(request, self._open_and_first(upstream, self_body))
        except UpstreamUnavailable as e:
            self.admission.release(tenant.priority)
            if self._can_fallback(tenant, alias):
                self.metrics.vendor.labels(tenant.name, f"upstream_{e.kind}").inc()
                return await self._to_vendor(request, tenant, alias, body, True, charged, est_prompt, t0, rid)
            self.buckets[tenant.name].settle(charged, 0)
            return self._upstream_failure(tenant, alias, e)
        except UpstreamRejected as e:
            self.admission.release(tenant.priority)
            self.buckets[tenant.name].settle(charged, 0)
            self.metrics.requests.labels(tenant.name, alias.name, str(e.status)).inc()
            return JSONResponse(e.body, status_code=e.status, headers=e.headers)
        except ClientGone:
            self.admission.release(tenant.priority)
            self.finish(tenant, alias.name, tenant.priority, "self", "499", charged, est_prompt, None, t0, None, None,
                        rid)
            return Response(status_code=499)
        except BaseException:
            self.admission.release(tenant.priority)
            self.buckets[tenant.name].settle(charged, 0)
            raise
        state = StreamState(self, tenant, alias.name, tenant.priority, "self", stream, True, charged, est_prompt, t0,
                            _wants_usage(body), rid)
        return self._sse_response(state, first, tenant.model_for(alias))

    def _sse_response(self, state: StreamState, first: str, model: str) -> GuardedStream:
        return GuardedStream(
            self._relay(state, first),
            state,
            media_type="text/event-stream",
            headers=dict(self._headers(state.request_id, state.backend, model), **{"Cache-Control": "no-cache"}),
        )

    async def _relay(self, st: StreamState, first: str) -> AsyncIterator[bytes]:
        """Reenvía evento por evento. Mide TTFT en el primer contenido; guarda usage; corta limpio si falla."""
        event: str | None = first
        while event is not None:
            if event == "[DONE]":
                st.done = True
                yield b"data: [DONE]\n\n"
                return
            out = self._process_event(st, event)
            if out is not None:
                yield out
            try:
                event = await st.stream.next_event()
            except UpstreamUnavailable as e:
                # Ya mandamos un 200 y parte del texto: no hay fallback posible. Evento de error y fin.
                st.status = "stream_error"
                err = {"error": {"message": "el modelo dejó de responder", "type": "api_error", "code": f"upstream_{e.kind}"}}
                yield f"data: {json.dumps(err, ensure_ascii=False)}\n\n".encode()
                return
        st.done = True  # el upstream cerró sin [DONE]: se da por terminado lo recibido

    def _process_event(self, st: StreamState, event: str) -> bytes | None:
        try:
            obj = json.loads(event)
        except ValueError:
            return f"data: {event}\n\n".encode()  # no es JSON: se reenvía tal cual
        if isinstance(obj, dict) and obj.get("usage"):
            st.usage = obj["usage"]
        has_content = isinstance(obj, dict) and any(
            (c.get("delta") or {}).get("content") or (c.get("delta") or {}).get("tool_calls")
            for c in obj.get("choices") or [] if isinstance(c, dict)
        )
        if has_content:
            now = self.clock()
            if st.first_content_t is None:
                st.first_content_t = now
                self.metrics.ttft.labels(st.alias, st.priority, st.backend).observe(now - st.t0)
            st.last_content_t = now
        if not st.client_wants_usage and isinstance(obj, dict) and "usage" in obj:
            if obj.get("choices") == []:
                return None  # el chunk final de usage lo pidió el gateway, no el cliente: no se reenvía
            obj = {k: v for k, v in obj.items() if k != "usage"}
        return f"data: {json.dumps(obj, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()

    # ---------------------------------------------------------------- vendor (fallback gobernado)
    async def _to_vendor(self, request, tenant, alias, body, stream, charged, est_prompt, t0, rid):
        vbody, red = self._vendor_body(body, alias)
        self._count_redactions(red)
        vendor = self.vendor
        if stream:
            try:
                vstream, first = await race_disconnect(request, self._open_and_first(vendor, vbody))
            except UpstreamUnavailable as e:
                self.buckets[tenant.name].settle(charged, 0)
                return self._upstream_failure(tenant, alias, e)
            except UpstreamRejected as e:
                self.buckets[tenant.name].settle(charged, 0)
                self.metrics.requests.labels(tenant.name, alias.name, str(e.status)).inc()
                return JSONResponse(e.body, status_code=e.status, headers=e.headers)
            except ClientGone:
                self.buckets[tenant.name].settle(charged, 0)
                self.metrics.requests.labels(tenant.name, alias.name, "499").inc()
                return Response(status_code=499)
            state = StreamState(self, tenant, alias.name, tenant.priority, "vendor", vstream, False, charged,
                                est_prompt, t0, _wants_usage(body), rid)
            return self._sse_response(state, first, alias.vendor_model)
        try:
            data = await race_disconnect(request, vendor.complete(vbody))
        except UpstreamUnavailable as e:
            self.buckets[tenant.name].settle(charged, 0)
            return self._upstream_failure(tenant, alias, e)
        except UpstreamRejected as e:
            self.buckets[tenant.name].settle(charged, 0)
            self.metrics.requests.labels(tenant.name, alias.name, str(e.status)).inc()
            return JSONResponse(e.body, status_code=e.status, headers=e.headers)
        except ClientGone:
            self.buckets[tenant.name].settle(charged, 0)
            self.metrics.requests.labels(tenant.name, alias.name, "499").inc()
            return Response(status_code=499)
        self.finish(tenant, alias.name, tenant.priority, "vendor", "200", charged, est_prompt, data.get("usage"), t0,
                    None, None, rid)
        return JSONResponse(data, headers=self._headers(rid, "vendor", alias.vendor_model))


def _wants_usage(body: dict) -> bool:
    return bool((body.get("stream_options") or {}).get("include_usage"))


# =============================================================================== app
def create_app(cfg: GatewayConfig, upstreams: dict[str, HttpUpstream], registry: CollectorRegistry | None = None,
               clock: Callable[[], float] = time.monotonic) -> FastAPI:
    registry = registry or CollectorRegistry()
    gw = Gateway(cfg, upstreams, registry, clock)
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        for u in upstreams.values():  # al apagar, cerrar los pools de conexiones hacia vLLM y el vendor
            await u.aclose()

    app = FastAPI(title="llm-gateway (c10)", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.gateway = gw

    @app.post("/v1/chat/completions")
    async def chat_completions(request: Request) -> Response:
        return await gw.chat_completions(request)

    @app.get("/v1/models")
    async def models(request: Request) -> Response:
        # Solo los alias que ESTE tenant puede usar: la lista de revisiones es interna
        auth = request.headers.get("authorization", "")
        key = auth[7:] if auth.lower().startswith("bearer ") else ""
        tenant = cfg.by_key.get(hashlib.sha256(key.encode()).hexdigest()) if key else None
        if tenant is None:
            return _error(401, "API key inválida", "authentication_error", "invalid_api_key")
        return JSONResponse({"object": "list", "data": [{"id": a, "object": "model"} for a in sorted(tenant.allowed_aliases)]})

    @app.get("/healthz")
    async def healthz() -> Response:
        return Response("ok")  # liveness: el proceso responde

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    return app


def _setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)  # una línea por request ya la escribe el gateway


def app_from_env() -> FastAPI:
    """Producción: GATEWAY_CONFIG (ruta a tenants.yaml) y VENDOR_API_KEY (de un Secret)."""
    _setup_logging()
    cfg = load_config(os.environ.get("GATEWAY_CONFIG", "tenants.yaml"))
    ups = {
        name: HttpUpstream(name, u["base_url"], u["kind"], cfg.limits,
                           api_key=os.environ.get("VENDOR_API_KEY") if u["kind"] == "vendor" else None)
        for name, u in cfg.upstreams.items()
    }
    return create_app(cfg, ups)


# =============================================================================== demo local (upstream falso)
def fake_vllm_handler(words: int = 12, delay_s: float = 0.02) -> Callable:
    """Un "vLLM" falso para httpx2.MockTransport: contesta con la forma de la API de OpenAI (NO es un modelo)."""

    async def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        prompt_tokens = estimate_prompt_tokens(body["messages"])
        n = min(words, body.get("max_completion_tokens") or body.get("max_tokens") or words)
        usage = {"prompt_tokens": prompt_tokens, "completion_tokens": n, "total_tokens": prompt_tokens + n}
        base = {"id": "chatcmpl-demo", "object": "chat.completion.chunk", "created": 0, "model": body["model"]}
        if not body.get("stream"):
            await asyncio.sleep(delay_s * n)  # sin streaming, la respuesta llega cuando termina de "generar"
            msg = {"role": "assistant", "content": " ".join(f"palabra{i}" for i in range(n))}
            return httpx2.Response(200, json=dict(base, object="chat.completion", usage=usage,
                                                  choices=[{"index": 0, "message": msg, "finish_reason": "length"}]))

        async def sse():
            yield f"data: {json.dumps(dict(base, choices=[{'index': 0, 'delta': {'role': 'assistant', 'content': ''}}]))}\n\n".encode()
            for i in range(n):
                await asyncio.sleep(delay_s)
                yield f"data: {json.dumps(dict(base, choices=[{'index': 0, 'delta': {'content': f' palabra{i}'}}]))}\n\n".encode()
            yield f"data: {json.dumps(dict(base, choices=[{'index': 0, 'delta': {}, 'finish_reason': 'length'}]))}\n\n".encode()
            if (body.get("stream_options") or {}).get("include_usage"):
                yield f"data: {json.dumps(dict(base, choices=[], usage=usage))}\n\n".encode()
            yield b"data: [DONE]\n\n"

        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=sse())

    return handler


def demo_app() -> FastAPI:
    """tenants.yaml + un vLLM falso en memoria. Keys de demo: sk-c10-demo-support, -listings, -catalog."""
    _setup_logging()
    cfg = load_config(Path(__file__).with_name("tenants.yaml"))
    # DEMO_WORDS y DEMO_DELAY_S alargan la respuesta falsa (p. ej. para cortar un stream a la mitad con curl)
    transport = httpx2.MockTransport(fake_vllm_handler(int(os.environ.get("DEMO_WORDS", "12")),
                                                       float(os.environ.get("DEMO_DELAY_S", "0.02"))))
    ups = {name: HttpUpstream(name, u["base_url"], u["kind"], cfg.limits, transport=transport)
           for name, u in cfg.upstreams.items()}
    return create_app(cfg, ups)
