"""rag-api (caso c11): POST /v1/ask contesta con documentos internos, cita sus fuentes y respeta permisos.

Un request de punta a punta (SLOs del caso: retrieval + rerank p95 ≤ 700 ms, primer token p95 ≤ 2.5 s, respuesta
completa ≤ 10 s; tiempos estimados, mídelos):
  1. Authorization: Bearer <token> → email. En producción el token es del SSO corporativo (OIDC) y se valida firma,
     emisor, audiencia y expiración (en el ingress o aquí con las llaves públicas del IdP); aquí es una interfaz.
  2. email → principales con la foto del IdP (ingest/acl.py). Foto de más de 5 min → 503 (falla CERRADO: el caso
     promete que una revocación aplica en ≤ 5 min; contestar con una foto vieja rompería esa promesa en silencio).
     Persona desconocida o desactivada → 403. Una FUENTE cuyos permisos no se sincronizan hace más de 5 min sale del
     retrieval (las demás siguen): rag_retrieval_degraded_total{reason="source_acl_stale"}.
  3. Validación del body (pregunta ≤ 2,000 caracteres, historial ≤ 20 mensajes) → 400.
  4. Retrieval híbrido con el filtro de ACL adentro (retrieval/hybrid.py), timeout 1.5 s → 503 si no hay índice.
     Opcional, para fuentes sensibles: chequeo tardío contra la fuente (LateAclCheck, timeout 250 ms; si no
     contesta, esos chunks se sacan).
     Hasta aquí todo error es un código HTTP limpio: todavía no se mandó ni un byte del stream.
  5. Sin chunks → no se llama al LLM: el stream trae "no encontré" sin gastar tokens (y se cuenta).
  6. Prompt dentro de 8k (answer/prompt_builder.py) → llm-gateway (#c10) con model "chat-default", stream,
     max_tokens 600 y `user` = un hash de la persona (el gateway lo usa para los canarios por % de usuarios).
  7. SSE hacia el cliente:
       event: meta    {request_id, sources:[{n, title, section, url, updated_at}]}  ← apenas termina el retrieval
       event: delta   {text}                                                       ← cada pedazo del LLM
       event: final   {outcome, answer, citations, invalid_citations, uncited_sentences}
     outcome: answered (≥ 1 cita válida) · no_answer (ninguna cita válida: el modelo dijo "no sé" o no citó) ·
     no_sources (retrieval vacío) · llm_unavailable (el LLM no dio el primer token: se muestran las fuentes, que
     ya son útiles) · llm_error (se cortó a mitad: se valida lo recibido). El texto del evento final reemplaza al
     de los deltas (citas inválidas borradas, ver answer/citations.py).
  8. Al cerrar (también si el cliente se va): se cierra el stream con el gateway (que cierra el de vLLM y libera
     su KV cache), métricas y UNA línea de log con ids de documentos y chunks, sin pregunta ni respuesta.

Métricas (/metrics). Ningún label lleva usuario, pregunta ni documento:
  rag_requests_total{outcome}              · rag_retrieval_latency_seconds (borde en 0.7)
  rag_ttft_seconds (borde en 2.5)          · rag_answer_latency_seconds (borde en 10)
  rag_empty_retrieval_total{reason}        · rag_retrieval_degraded_total{reason}
  rag_acl_violations_total                 · rag_citations_total{result}
  rag_prompt_tokens (histograma)           · rag_acl_snapshot_age_seconds (gauge, calculado al leerlo)
  rag_feedback_total{rating}               (POST /v1/feedback: el pulgar de la interfaz)

Endpoints: POST /v1/ask · POST /v1/feedback · GET /healthz · GET /readyz · GET /metrics
Variables de entorno: ver Settings. Demo sin GPU ni gateway: `uvicorn --factory app:demo_app` (README).
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # timeouts del primer token y entre pedazos
import hashlib  # hash de la persona (user del gateway) y de la pregunta (log)
import json  # eventos SSE y log
import logging  # una línea JSON por pregunta
import os  # configuración por variables de entorno
import re  # demo: sacar la primera oración de la fuente [1]
import time  # perf_counter (latencias) y time (edad de la foto del IdP)
import uuid  # request id
from collections.abc import AsyncGenerator, Callable, Mapping, Sequence  # tipos
from dataclasses import dataclass, field  # configuración
from typing import Protocol  # interfaces

import httpx2  # cliente HTTP async hacia el llm-gateway (API de httpx; tests con MockTransport)
from fastapi import FastAPI, Request  # el servidor
from fastapi.responses import JSONResponse, Response, StreamingResponse  # respuestas
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest

from acl import IdentitySnapshot  # personas → principales
from chunker import RegexTokenCounter  # contador de respaldo (producción: el tokenizer del LLM)
from citations import validate  # citas válidas y permitidas
from hybrid import AclFilter, HybridRetriever, RetrievalUnavailable  # retrieval con permisos
from prompt_builder import NO_SOURCES_ANSWER, PromptBudget, PromptBuilder, PromptTooLarge, QuestionTooLong

log = logging.getLogger("rag-api")


# ---------------------------------------------------------------------------- configuración
@dataclass
class Settings:
    gateway_url: str = os.getenv("RAG_GATEWAY_URL", "http://llm-gateway.c10.svc.cluster.local:8080/v1")  # placeholder
    gateway_api_key: str = os.getenv("RAG_GATEWAY_API_KEY", "")  # la key del tenant employee-assistant (un Secret)
    model_alias: str = os.getenv("RAG_MODEL_ALIAS", "chat-default")  # alias del gateway, nunca una revisión
    max_output_tokens: int = int(os.getenv("RAG_MAX_OUTPUT_TOKENS", "600"))
    temperature: float = float(os.getenv("RAG_TEMPERATURE", "0.2"))  # baja: se quiere el texto de las fuentes
    retrieval_timeout_s: float = float(os.getenv("RAG_RETRIEVAL_TIMEOUT_S", "1.5"))  # ≈ 2× el p95 de 700 ms
    first_token_timeout_s: float = float(os.getenv("RAG_FIRST_TOKEN_TIMEOUT_S", "8"))  # después: mostrar fuentes
    gap_timeout_s: float = float(os.getenv("RAG_GAP_TIMEOUT_S", "10"))  # silencio máximo entre dos pedazos
    total_timeout_s: float = float(os.getenv("RAG_TOTAL_TIMEOUT_S", "30"))  # 600 tokens a ≈ 20/s ≈ 30 s en el peor caso
    acl_max_staleness_s: float = float(os.getenv("RAG_ACL_MAX_STALENESS_S", "300"))  # la promesa: revocación ≤ 5 min
    question_max_chars: int = int(os.getenv("RAG_QUESTION_MAX_CHARS", "2000"))
    history_max_messages: int = int(os.getenv("RAG_HISTORY_MAX_MESSAGES", "20"))
    user_salt: str = os.getenv("RAG_USER_SALT", "c11-demo-salt")  # sal del hash de la persona (Secret en prod)
    late_check_timeout_s: float = float(os.getenv("RAG_LATE_CHECK_TIMEOUT_S", "0.25"))  # chequeo tardío: duro


# ---------------------------------------------------------------------------- interfaces
class Authenticator(Protocol):
    def verify(self, token: str) -> str | None: ...  # email de la persona, o None si el token no vale


@dataclass
class StaticTokenAuth:
    """Tokens fijos → email. SOLO tests y demo: en producción, validación OIDC contra el IdP."""

    tokens: Mapping[str, str]

    def verify(self, token: str) -> str | None:
        return self.tokens.get(token)


class LateAclCheck(Protocol):
    """Chequeo TARDÍO de permisos (late binding) para fuentes sensibles: se le pregunta a la fuente misma, sobre los
    chunks finales, si la persona puede leerlos AHORA. Cubre la ventana entre un cambio de permisos y su llegada al
    índice. Cuesta una llamada por pregunta a la API de la fuente (límites de uso): solo para `sources`."""

    sources: frozenset[str]

    async def allowed(self, email: str, doc_ids: Sequence[str]) -> set[str]: ...


class LLMUnavailable(RuntimeError):
    def __init__(self, reason: str, status: int | None = None):
        super().__init__(reason)
        self.reason, self.status = reason, status


class LLMClient(Protocol):
    def stream(self, messages: list[dict], max_tokens: int, user: str) -> AsyncGenerator[str, None]: ...


class GatewayClient:
    """Cliente del llm-gateway de #c10 (API compatible con OpenAI, streaming SSE)."""

    def __init__(self, settings: Settings, transport: httpx2.AsyncBaseTransport | None = None):
        self.s = settings
        self.client = httpx2.AsyncClient(
            base_url=settings.gateway_url, transport=transport,
            # connect corto (un gateway que no acepta conexiones en 2 s está caído); read = silencio máximo
            timeout=httpx2.Timeout(connect=2.0, read=settings.gap_timeout_s, write=5.0, pool=2.0),
            headers={"Authorization": f"Bearer {settings.gateway_api_key}"},
        )

    async def stream(self, messages: list[dict], max_tokens: int, user: str) -> AsyncGenerator[str, None]:
        body = {"model": self.s.model_alias, "messages": messages, "stream": True, "max_tokens": max_tokens,
                "temperature": self.s.temperature, "user": user}
        try:
            async with self.client.stream("POST", "/chat/completions", json=body) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    # 429 = cuota del tenant agotada; 503 = plataforma llena; 5xx/502/504 = vLLM caído. Para la
                    # persona es lo mismo: no hay respuesta generada, pero sí fuentes (outcome llm_unavailable).
                    raise LLMUnavailable(f"gateway {resp.status_code}", resp.status_code)
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue  # comentarios y líneas vacías del SSE
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError as e:
                        # Un evento mal formado = el stream ya no es confiable: se trata como un corte (llm_error si
                        # ya llegó texto, llm_unavailable si no), nunca como una excepción que deja al cliente sin final
                        raise LLMUnavailable("evento SSE mal formado") from e
                    if "error" in event:
                        raise LLMUnavailable("error a mitad del stream")
                    for choice in event.get("choices", ()):
                        piece = (choice.get("delta") or {}).get("content")
                        if piece:
                            yield piece
                        if choice.get("finish_reason") == "abort":
                            raise LLMUnavailable("el engine abortó el request")
        except httpx2.TransportError as e:  # conexión, timeouts de lectura, etc.
            raise LLMUnavailable(f"transporte: {type(e).__name__}") from e


# ---------------------------------------------------------------------------- métricas
class RagMetrics:
    def __init__(self, registry: CollectorRegistry, snapshot_age: Callable[[], float]):
        self.requests = Counter("rag_requests_total", "Preguntas por resultado", ["outcome"], registry=registry)
        self.retrieval = Histogram("rag_retrieval_latency_seconds", "Retrieval + rerank (incluye el filtro de ACL)",
                                   buckets=(0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.5, 5.0), registry=registry)
        self.ttft = Histogram("rag_ttft_seconds", "Desde que llega la pregunta hasta el primer pedazo de texto",
                              buckets=(0.25, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0, 8.0, 10.0), registry=registry)
        self.answer = Histogram("rag_answer_latency_seconds", "Desde que llega la pregunta hasta el evento final",
                                buckets=(0.5, 1, 2, 4, 6, 8, 10, 15, 20, 30), registry=registry)
        self.empty = Counter("rag_empty_retrieval_total", "Retrieval sin chunks", ["reason"], registry=registry)
        self.degraded = Counter("rag_retrieval_degraded_total", "Retrieval degradado", ["reason"], registry=registry)
        self.acl_violations = Counter("rag_acl_violations_total",
                                      "Candidatos prohibidos que llegaron del índice (debe ser 0)", registry=registry)
        self.citations = Counter("rag_citations_total", "Citas del modelo", ["result"], registry=registry)
        self.prompt_tokens = Histogram("rag_prompt_tokens", "Tokens de entrada estimados del prompt",
                                       buckets=(1000, 2000, 3000, 4000, 5000, 6000, 7000, 7500, 8192),
                                       registry=registry)
        self.feedback = Counter("rag_feedback_total", "Pulgares de la interfaz", ["rating"], registry=registry)
        self.snapshot_age = Gauge("rag_acl_snapshot_age_seconds", "Edad de la foto del IdP que usa esta réplica",
                                  registry=registry)
        self.snapshot_age.set_function(snapshot_age)  # se calcula en cada scrape: nunca queda "congelado"


# ---------------------------------------------------------------------------- helpers
def sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode()


def _error(status: int, code: str, message: str, retry_after: int | None = None) -> JSONResponse:
    headers = {"Retry-After": str(retry_after)} if retry_after else None
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


def _bearer(request: Request) -> str:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


def _sources_payload(sources) -> list[dict]:
    return [{"n": s.n, "title": s.title, "section": s.section, "url": s.url, "updated_at": s.updated_at}
            for s in sources]


# ---------------------------------------------------------------------------- la app
def create_app(retriever: HybridRetriever, llm: LLMClient, auth: Authenticator,
               snapshot: Callable[[], IdentitySnapshot], settings: Settings | None = None,
               registry: CollectorRegistry | None = None, builder: PromptBuilder | None = None,
               wall_clock: Callable[[], float] = time.time,
               source_acl_sync: Callable[[], Mapping[str, float]] | None = None,
               late_check: LateAclCheck | None = None) -> FastAPI:
    """source_acl_sync: {fuente: epoch s del último sync de permisos exitoso} (lo publica la ingesta; en producción
    se lee de su store con caché de segundos). Una fuente con más de acl_max_staleness_s sale del retrieval."""
    s = settings or Settings()
    registry = registry or CollectorRegistry()
    builder = builder or PromptBuilder(RegexTokenCounter(), PromptBudget(max_output_tokens=s.max_output_tokens))

    def snapshot_age() -> float:
        try:
            return snapshot().age_s(wall_clock())
        except Exception:  # sin foto cargada: "infinitamente vieja" para la alerta
            return float("inf")

    m = RagMetrics(registry, snapshot_age)
    app = FastAPI(title="rag-api (c11)", docs_url=None, redoc_url=None)

    @app.post("/v1/ask")
    async def ask(request: Request):
        t0 = time.perf_counter()
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex

        def reject(status: int, outcome: str, message: str, retry_after: int | None = None) -> JSONResponse:
            m.requests.labels(outcome).inc()
            return _error(status, outcome, message, retry_after)

        # -- 1-2. identidad y permisos
        email = auth.verify(_bearer(request))
        if not email:
            return reject(401, "unauthorized", "token inválido o ausente")
        snap = snapshot()
        if snap.age_s(wall_clock()) > s.acl_max_staleness_s:
            return reject(503, "acl_stale", "la foto de permisos está desactualizada; reintenta en un momento", 30)
        principals = snap.principals_for(email)
        if not principals:
            return reject(403, "forbidden", "persona desconocida o desactivada")

        # -- 3. body
        try:
            body = await request.json()
            question = body["question"]
            history = body.get("history", [])
            if not isinstance(question, str) or not question.strip() or len(question) > s.question_max_chars:
                raise ValueError("question")
            if not isinstance(history, list) or len(history) > s.history_max_messages:
                raise ValueError("history")
        except (ValueError, KeyError, TypeError):
            return reject(400, "bad_request", f"se espera {{question: str ≤ {s.question_max_chars} caracteres, "
                                              f"history: lista ≤ {s.history_max_messages}}}")

        # -- 4. retrieval (antes del primer byte)
        stale_sources: frozenset[str] = frozenset()
        if source_acl_sync is not None:
            now = wall_clock()
            stale_sources = frozenset(src for src, ts in source_acl_sync().items()
                                      if now - ts > s.acl_max_staleness_s)
            for _ in stale_sources:
                m.degraded.labels("source_acl_stale").inc()
        acl = AclFilter(principals, excluded_sources=stale_sources)
        tr = time.perf_counter()
        try:
            res = await asyncio.wait_for(retriever.retrieve(question, acl), s.retrieval_timeout_s)
        except (RetrievalUnavailable, TimeoutError):
            m.retrieval.observe(time.perf_counter() - tr)
            return reject(503, "retrieval_unavailable", "el índice no responde", 5)
        m.retrieval.observe(time.perf_counter() - tr)
        for reason in res.degraded:
            m.degraded.labels(reason).inc()
        if res.acl_violations:
            m.acl_violations.inc(res.acl_violations)
            log.error(json.dumps({"request_id": rid, "event": "acl_violation", "count": res.acl_violations}))
        if late_check is not None:
            sensitive = sorted({c.record.doc_id for c in res.chunks if c.record.source in late_check.sources})
            if sensitive:
                try:
                    ok = await asyncio.wait_for(late_check.allowed(email, sensitive), s.late_check_timeout_s)
                except (TimeoutError, ConnectionError):
                    ok = set()  # sin respuesta de la fuente: esos chunks NO entran (falla cerrado)
                    m.degraded.labels("late_check_failed").inc()
                kept = [c for c in res.chunks if c.record.source not in late_check.sources or c.record.doc_id in ok]
                if len(kept) < len(res.chunks):
                    m.degraded.labels("late_check_removed").inc()
                res.chunks = kept
                if not kept:
                    res.empty_reason = "no_candidates"

        user_tag = hashlib.sha256((s.user_salt + email).encode()).hexdigest()[:16]
        base_log = {"request_id": rid, "user": user_tag, "excluded_sources": sorted(stale_sources),
                    "question_sha256": hashlib.sha256(question.encode()).hexdigest()[:16],
                    "chunks": [c.record.chunk_id for c in res.chunks], "degraded": res.degraded,
                    "retrieval_ms": res.timings_ms}

        # -- 5. sin evidencia: no se llama al LLM
        if not res.chunks:
            m.empty.labels(res.empty_reason or "no_candidates").inc()

            async def empty_stream():
                yield sse("meta", {"request_id": rid, "sources": []})
                yield sse("final", {"outcome": "no_sources", "answer": NO_SOURCES_ANSWER, "citations": [],
                                    "invalid_citations": [], "uncited_sentences": []})
                m.requests.labels("no_sources").inc()
                m.answer.observe(time.perf_counter() - t0)
                log.info(json.dumps({**base_log, "outcome": "no_sources"}))

            return StreamingResponse(empty_stream(), media_type="text/event-stream",
                                     headers={"Cache-Control": "no-cache", "X-Request-Id": rid})

        # -- 6. prompt
        try:
            built = builder.build(question, history, [c.record for c in res.chunks])
        except QuestionTooLong as e:
            return reject(400, "bad_request", str(e))
        except PromptTooLarge as e:
            return reject(500, "prompt_too_large", str(e))
        m.prompt_tokens.observe(built.tokens["total"])

        # -- 7-8. stream
        async def answer_stream():
            outcome = "client_disconnected"  # si nada lo cambia, el cliente se fue a mitad
            parts: list[str] = []
            report = None
            stream = llm.stream(built.messages, s.max_output_tokens, user_tag)
            it = stream.__aiter__()
            # asyncio.wait_for sobre __anext__: desde Python 3.12 corre en ESTA tarea (no crea otra), así que el
            # `async with` del cliente HTTP dentro del generador no cambia de tarea entre pedazos.
            try:
                yield sse("meta", {"request_id": rid, "sources": _sources_payload(built.sources)})
                try:
                    first = await asyncio.wait_for(it.__anext__(), s.first_token_timeout_s)
                except (LLMUnavailable, TimeoutError, StopAsyncIteration) as e:
                    outcome = "llm_unavailable"
                    yield sse("final", {"outcome": outcome, "answer": "", "reason": type(e).__name__,
                                        "sources": _sources_payload(built.sources), "citations": [],
                                        "invalid_citations": [], "uncited_sentences": []})
                    return
                m.ttft.observe(time.perf_counter() - t0)
                parts.append(first)
                yield sse("delta", {"text": first})
                deadline = t0 + s.total_timeout_s
                error = None
                while True:
                    remaining = deadline - time.perf_counter()
                    try:
                        if remaining <= 0:
                            raise TimeoutError("total")
                        piece = await asyncio.wait_for(it.__anext__(), min(s.gap_timeout_s, remaining))
                    except StopAsyncIteration:
                        break
                    except (LLMUnavailable, TimeoutError) as e:
                        error = type(e).__name__
                        break
                    parts.append(piece)
                    yield sse("delta", {"text": piece})
                report = validate("".join(parts), built.sources, principals)
                outcome = "llm_error" if error else ("answered" if report.citations else "no_answer")
                yield sse("final", {
                    "outcome": outcome, "answer": report.text,
                    "citations": [c.__dict__ for c in report.citations],
                    "invalid_citations": [{"n": n, "reason": r} for n, r in report.invalid],
                    "uncited_sentences": report.uncited_sentences,
                    **({"error": error} if error else {}),
                })
            finally:
                await stream.aclose()  # cierra la conexión con el gateway (y la de vLLM): sin esto, KV ocupado
                m.requests.labels(outcome).inc()
                if outcome != "client_disconnected":
                    m.answer.observe(time.perf_counter() - t0)
                if report is not None:
                    m.citations.labels("valid").inc(len(report.citations))
                    m.citations.labels("invalid").inc(len(report.invalid))
                log.info(json.dumps({
                    **base_log, "outcome": outcome, "prompt_tokens": built.tokens,
                    "dropped_sources": built.dropped_sources,
                    "cited_doc_ids": report.cited_doc_ids if report else [],
                    "invalid_citations": len(report.invalid) if report else 0,
                    "total_ms": round((time.perf_counter() - t0) * 1000, 1),
                }))

        return StreamingResponse(answer_stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Request-Id": rid})

    @app.post("/v1/feedback")
    async def feedback(request: Request):
        if not auth.verify(_bearer(request)):
            return _error(401, "unauthorized", "token inválido o ausente")
        try:
            body = await request.json()
            rating = body["rating"]
            if rating not in ("up", "down") or not isinstance(body.get("request_id"), str):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return _error(400, "bad_request", "se espera {request_id: str, rating: 'up' | 'down'}")
        m.feedback.labels(rating).inc()
        # El request_id une el pulgar con la línea de log (chunks y documentos citados) para revisar los "down"
        log.info(json.dumps({"request_id": body["request_id"], "event": "feedback", "rating": rating}))
        return Response(status_code=204)

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}  # el proceso vive (liveness): no depende del índice ni del gateway

    @app.get("/readyz")
    async def readyz():
        # Readiness: con la foto del IdP vieja, esta réplica contestaría 503 a todo: mejor que no reciba tráfico
        age = snapshot_age()
        if age > s.acl_max_staleness_s:
            return JSONResponse({"status": "acl_stale", "age_s": age}, status_code=503)
        return {"status": "ready", "acl_snapshot_age_s": round(age, 1)}

    @app.get("/metrics")
    async def metrics():
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    return app


# ---------------------------------------------------------------------------- demo (sin GPU ni gateway)
@dataclass
class ScriptedLLM:
    """LLM FALSO: contesta con la primera oración (o la fila de tabla más parecida) de la fuente [1] y la cita, o con
    "no encontré" si esa fuente casi no comparte palabras con la pregunta. NO es un modelo.

    `answer` fijo reemplaza ese comportamiento (tests); `fail_first` simula el gateway caído; `fail_after` corta el
    stream después de N pedazos; `delay_s` espera entre pedazos.
    """

    answer: str | None = None
    fail_first: bool = False
    fail_after: int | None = None
    delay_s: float = 0.0
    calls: list[dict] = field(default_factory=list)
    closed: int = 0

    def _compose(self, messages: Sequence[Mapping[str, str]]) -> str:
        if self.answer is not None:
            return self.answer
        user = messages[-1]["content"]
        refusal = "No encontré esto en los documentos a los que tienes acceso."
        src = re.search(r'<fuente id="1">\n.*?\n.*?\n.*?\n(.*?)\n</fuente>', user, re.S)
        question = user.rsplit("Pregunta:", 1)[-1]
        if not src:
            return refusal
        body = src.group(1)
        # Imitación burda de "solo contesto si la fuente habla de lo mismo": ≥ 2 palabras largas en común
        q_words = {w for w in re.findall(r"\w+", question.lower()) if len(w) >= 5}
        if len(q_words & set(re.findall(r"\w+", body.lower()))) < 2:
            return refusal
        lines = [ln for ln in body.split("\n") if ln.strip()]
        prose = [ln for ln in lines if not ln.startswith("|")]
        if prose:
            text = re.split(r"(?<=[.!?])\s", prose[0].strip())[0].rstrip(".")
        else:  # una tabla: la fila que más palabras comparte con la pregunta
            rows = [ln for ln in lines[2:] if ln.startswith("|")]
            text = max(rows, key=lambda r: len(q_words & set(re.findall(r"\w+", r.lower())))) if rows else lines[0]
        return f"{text} [1]."

    async def stream(self, messages: list[dict], max_tokens: int, user: str) -> AsyncGenerator[str, None]:
        self.calls.append({"messages": messages, "max_tokens": max_tokens, "user": user})
        try:
            if self.fail_first:
                raise LLMUnavailable("gateway 503", 503)
            for i, word in enumerate(self._compose(messages).split(" ")):
                if self.fail_after is not None and i >= self.fail_after:
                    raise LLMUnavailable("error a mitad del stream")
                if self.delay_s:
                    await asyncio.sleep(self.delay_s)
                yield word if i == 0 else " " + word
        finally:
            self.closed += 1


def demo_app() -> FastAPI:
    """El corpus ficticio de eval/fixtures/corpus.json, índice en memoria, embedder y reranker falsos, LLM falso."""
    from fakes import OverlapReranker  # import local: solo la demo usa fakes
    from fixture_loader import build_demo, load_identity

    index, embedder, data, _ = build_demo()
    retriever = HybridRetriever(index, index, embedder, OverlapReranker())
    tokens = {"demo-ana": "ana@acme.com", "demo-luis": "luis@acme.com", "demo-marta": "marta@acme.com",
              "demo-carlos": "carlos@consultora.com"}
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    return create_app(retriever, ScriptedLLM(delay_s=float(os.getenv("DEMO_DELAY_S", "0.05"))),
                      StaticTokenAuth(tokens), lambda: load_identity(data, time.time()))
