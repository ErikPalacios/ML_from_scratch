"""Tests de rag-api con el corpus ficticio, índice en memoria y LLM falso: cada test es una situación de operación."""

import asyncio
import json
import re
from pathlib import Path

import httpx2
import pytest
import yaml
from prometheus_client import CollectorRegistry

from app import GatewayClient, LLMUnavailable, ScriptedLLM, Settings, StaticTokenAuth, create_app
from fakes import OverlapReranker
from fixture_loader import build_demo, load_identity
from hybrid import HybridRetriever

ROOT = Path(__file__).resolve().parents[2]
TOKENS = {"t-ana": "ana@acme.com", "t-luis": "luis@acme.com", "t-carlos": "carlos@consultora.com",
          "t-ex": "exempleada@acme.com"}
NOW = 1_790_000_000.0


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module")
def corpus():
    index, embedder, data, _ = build_demo()
    return index, embedder, data


def make(corpus, llm=None, snapshot_age=10.0, settings=None, fail_index=False, source_sync=None, late=None):
    index, embedder, data = corpus
    index.fail_keyword = index.fail_vector = fail_index
    reg = CollectorRegistry()
    llm = llm or ScriptedLLM()
    app = create_app(HybridRetriever(index, index, embedder, OverlapReranker()), llm, StaticTokenAuth(TOKENS),
                     lambda: load_identity(data, NOW - snapshot_age), settings or Settings(), reg,
                     wall_clock=lambda: NOW, source_acl_sync=source_sync, late_check=late)
    client = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://rag")
    return client, llm, reg


def events(text):
    out = []
    for block in text.strip().split("\n\n"):
        name = re.search(r"^event: (.+)$", block, re.M).group(1)
        data = json.loads(re.search(r"^data: (.+)$", block, re.M).group(1))
        out.append((name, data))
    return out


async def ask(client, token, question, history=None):
    body = {"question": question, **({"history": history} if history is not None else {})}
    return await client.post("/v1/ask", json=body, headers={"Authorization": f"Bearer {token}"})


# ---------------------------------------------------------------- el camino feliz
@pytest.mark.anyio
async def test_answer_streams_meta_deltas_and_final_with_valid_citation(corpus):
    client, llm, reg = make(corpus)
    r = await ask(client, "t-ana", "¿Cuál es el viático diario en Colombia?")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    ev = events(r.text)
    assert ev[0][0] == "meta" and ev[0][1]["sources"][0]["url"] == "https://docs.acme.com/d/3002"
    assert {name for name, _ in ev[1:-1]} == {"delta"}
    final = ev[-1][1]
    assert final["outcome"] == "answered" and final["citations"][0]["doc_id"] == "drive:3002"
    assert final["answer"] == "| Colombia | US$55 | US$110 | [1]."  # el LLM falso copia la fila de la tabla
    # lo que viajó al gateway: alias, tope de salida, usuario en hash (no el email)
    call = llm.calls[0]
    assert call["max_tokens"] == 600 and "ana@acme.com" not in call["user"] and len(call["user"]) == 16
    assert reg.get_sample_value("rag_requests_total", {"outcome": "answered"}) == 1
    assert reg.get_sample_value("rag_ttft_seconds_count") == 1
    assert reg.get_sample_value("rag_citations_total", {"result": "valid"}) == 1
    assert llm.closed == 1  # el stream con el gateway se cerró


@pytest.mark.anyio
async def test_permissions_change_the_sources_for_the_same_question(corpus):
    client, llm, _ = make(corpus)
    q = "¿Cómo se calcula el bono trimestral del equipo de Finanzas?"
    luis = events((await ask(client, "t-luis", q)).text)
    ana = events((await ask(client, "t-ana", q)).text)
    assert luis[0][1]["sources"][0]["url"] == "https://docs.acme.com/d/3001"
    assert all(s["url"] != "https://docs.acme.com/d/3001" for s in ana[0][1]["sources"])
    # y el texto del documento de Finanzas jamás llegó al prompt de ana
    assert "cierre contable" not in json.dumps(llm.calls[1]["messages"], ensure_ascii=False)


@pytest.mark.anyio
async def test_no_sources_does_not_call_the_llm(corpus):
    client, llm, reg = make(corpus)
    ev = events((await ask(client, "t-carlos", "¿Cuál es el viático diario en Colombia?")).text)
    assert ev[0][1]["sources"] == [] and ev[-1][1]["outcome"] == "no_sources"
    assert llm.calls == []
    assert reg.get_sample_value("rag_empty_retrieval_total", {"reason": "no_candidates"}) == 1


@pytest.mark.anyio
async def test_model_without_citations_is_no_answer(corpus):
    client, _, _ = make(corpus, ScriptedLLM(answer="No encontré esto en los documentos a los que tienes acceso."))
    final = events((await ask(client, "t-ana", "¿Cuál es el código de vestimenta?")).text)[-1][1]
    assert final["outcome"] == "no_answer" and final["citations"] == []


@pytest.mark.anyio
async def test_invented_citation_is_stripped_in_the_final_event(corpus):
    # hay ≤ 8 fuentes: [12] no existe en este prompt
    client, _, reg = make(corpus, ScriptedLLM(answer="El viático en Colombia es US$55 [1] y en Perú US$40 [12]."))
    final = events((await ask(client, "t-ana", "¿Cuál es el viático diario en Colombia?")).text)[-1][1]
    assert "[12]" not in final["answer"] and final["invalid_citations"] == [{"n": 12, "reason": "not_retrieved"}]
    assert reg.get_sample_value("rag_citations_total", {"result": "invalid"}) == 1


# ---------------------------------------------------------------- degradación
@pytest.mark.anyio
async def test_llm_down_still_shows_the_sources(corpus):
    client, llm, reg = make(corpus, ScriptedLLM(fail_first=True))
    ev = events((await ask(client, "t-ana", "¿Cuál es el viático diario en Colombia?")).text)
    assert [n for n, _ in ev] == ["meta", "final"]
    assert ev[-1][1]["outcome"] == "llm_unavailable" and ev[-1][1]["sources"]
    assert reg.get_sample_value("rag_requests_total", {"outcome": "llm_unavailable"}) == 1


@pytest.mark.anyio
async def test_first_token_timeout(corpus):
    client, _, _ = make(corpus, ScriptedLLM(delay_s=0.3), settings=Settings(first_token_timeout_s=0.05))
    final = events((await ask(client, "t-ana", "viático Colombia")).text)[-1][1]
    assert final["outcome"] == "llm_unavailable" and final["reason"] == "TimeoutError"


@pytest.mark.anyio
async def test_stream_cut_midway_validates_what_arrived(corpus):
    client, llm, _ = make(corpus, ScriptedLLM(answer="El viático diario en Colombia es US$55 [1] por día.",
                                              fail_after=8))
    ev = events((await ask(client, "t-ana", "viático Colombia")).text)
    final = ev[-1][1]
    assert final["outcome"] == "llm_error" and final["error"] == "LLMUnavailable"
    assert final["answer"].startswith("El viático diario") and llm.closed == 1


@pytest.mark.anyio
async def test_index_down_is_a_clean_503_before_any_byte(corpus):
    client, llm, reg = make(corpus, fail_index=True)
    r = await ask(client, "t-ana", "viático Colombia")
    corpus[0].fail_keyword = corpus[0].fail_vector = False
    assert r.status_code == 503 and r.headers["retry-after"] == "5"
    assert r.json()["error"]["code"] == "retrieval_unavailable" and llm.calls == []


# ---------------------------------------------------------------- identidad y entrada
@pytest.mark.anyio
async def test_auth_and_identity_errors(corpus):
    client, _, reg = make(corpus)
    assert (await ask(client, "nope", "hola")).status_code == 401
    assert (await ask(client, "t-ex", "hola")).status_code == 403  # token válido, persona fuera del IdP
    assert reg.get_sample_value("rag_requests_total", {"outcome": "forbidden"}) == 1


@pytest.mark.anyio
async def test_stale_acl_snapshot_fails_closed(corpus):
    client, llm, _ = make(corpus, snapshot_age=301.0)
    r = await ask(client, "t-ana", "viático Colombia")
    assert r.status_code == 503 and r.json()["error"]["code"] == "acl_stale" and llm.calls == []
    ready = await client.get("/readyz")
    assert ready.status_code == 503  # la réplica sale del Service hasta que llegue una foto nueva
    metrics = (await client.get("/metrics")).text
    assert "rag_acl_snapshot_age_seconds 301.0" in metrics


@pytest.mark.anyio
@pytest.mark.parametrize("body", [{}, {"question": ""}, {"question": "x" * 2001}, {"question": "hola", "history": "no"},
                                  {"question": "hola", "history": [{"role": "user", "content": "x"}] * 21}])
async def test_bad_bodies_are_400(corpus, body):
    client, _, _ = make(corpus)
    r = await client.post("/v1/ask", json=body, headers={"Authorization": "Bearer t-ana"})
    assert r.status_code == 400


@pytest.mark.anyio
async def test_feedback(corpus):
    client, _, reg = make(corpus)
    h = {"Authorization": "Bearer t-ana"}
    r = await client.post("/v1/feedback", json={"request_id": "r1", "rating": "down"}, headers=h)
    assert r.status_code == 204
    assert (await client.post("/v1/feedback", json={"request_id": "r1", "rating": "meh"}, headers=h)).status_code == 400
    assert (await client.post("/v1/feedback", json={"request_id": "r1", "rating": "up"})).status_code == 401
    assert reg.get_sample_value("rag_feedback_total", {"rating": "down"}) == 1


# ---------------------------------------------------------------- el cliente que se va
@pytest.mark.anyio
async def test_client_disconnect_closes_the_llm_stream(corpus):
    index, embedder, data = corpus
    llm = ScriptedLLM(answer=" ".join(["palabra"] * 50) + " [1]")
    reg = CollectorRegistry()
    app = create_app(HybridRetriever(index, index, embedder), llm, StaticTokenAuth(TOKENS),
                     lambda: load_identity(data, NOW), Settings(), reg, wall_clock=lambda: NOW)
    # Se llama al endpoint y se consume el generador de la respuesta a mano: 3 eventos y se "va" (aclose),
    # que es lo que hace Starlette cuando detecta la desconexión (cancela el generador).
    route = next(r for r in app.routes if getattr(r, "path", "") == "/v1/ask")
    scope = {"type": "http", "method": "POST", "path": "/v1/ask", "headers": [(b"authorization", b"Bearer t-ana")],
             "query_string": b""}

    async def receive():
        return {"type": "http.request", "body": json.dumps({"question": "viático Colombia"}).encode(),
                "more_body": False}

    from starlette.requests import Request
    resp = await route.endpoint(Request(scope, receive))
    gen = resp.body_iterator
    for _ in range(3):
        await gen.__anext__()
    await gen.aclose()
    assert llm.closed == 1
    assert reg.get_sample_value("rag_requests_total", {"outcome": "client_disconnected"}) == 1
    assert reg.get_sample_value("rag_answer_latency_seconds_count") is None or \
        reg.get_sample_value("rag_answer_latency_seconds_count") == 0


# ---------------------------------------------------------------- el cliente real del gateway
def gateway_handler(mode="ok"):
    async def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        assert request.url.path == "/v1/chat/completions" and body["stream"] is True
        assert request.headers["authorization"] == "Bearer sk-employee-assistant"
        if mode == "503":
            return httpx2.Response(503, json={"error": {"message": "plataforma sin capacidad"}},
                                   headers={"Retry-After": "2"})

        async def sse():
            yield b'data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n'
            for word in ["Hola", " mundo", " [1]"]:
                chunk = {"choices": [{"index": 0, "delta": {"content": word}}]}
                yield f"data: {json.dumps(chunk)}\n\n".encode()
            if mode == "abort":
                yield b'data: {"choices":[{"index":0,"delta":{},"finish_reason":"abort"}]}\n\n'
            yield b"data: [DONE]\n\n"

        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=sse())
    return handler


@pytest.mark.anyio
async def test_gateway_client_parses_openai_sse():
    s = Settings(gateway_url="http://gw/v1", gateway_api_key="sk-employee-assistant")
    gc = GatewayClient(s, transport=httpx2.MockTransport(gateway_handler()))
    pieces = [p async for p in gc.stream([{"role": "user", "content": "x"}], 600, "u")]
    assert pieces == ["Hola", " mundo", " [1]"]  # el primer chunk (solo role) no es texto


@pytest.mark.anyio
@pytest.mark.parametrize("mode", ["503", "abort"])
async def test_gateway_client_errors(mode):
    s = Settings(gateway_url="http://gw/v1", gateway_api_key="sk-employee-assistant")
    gc = GatewayClient(s, transport=httpx2.MockTransport(gateway_handler(mode)))
    with pytest.raises(LLMUnavailable):
        _ = [p async for p in gc.stream([{"role": "user", "content": "x"}], 600, "u")]


# ---------------------------------------------------------------- contrato con las alertas
def test_every_rag_metric_in_the_alerts_exists():
    """Cada métrica rag_* que usan alerts.yml existe en la app, en ingest/metrics.py o en eval/groundedness.py."""
    rules = yaml.safe_load((ROOT / "monitoring" / "alerts.yml").read_text())
    exprs = " ".join(r["expr"] for g in rules["groups"] for r in g["rules"])
    used = {re.sub(r"_(bucket|count|sum)$", "", m) for m in re.findall(r"\brag_[a-z0-9_]+", exprs)}
    used = {u for u in used if not u.startswith("rag:")}
    sources = "".join((ROOT / p).read_text() for p in ("service/app.py", "ingest/metrics.py", "eval/groundedness.py"))
    missing = sorted(u for u in used if f'"{u}"' not in sources)
    assert not missing, missing


@pytest.mark.anyio
async def test_a_source_with_stale_permissions_leaves_the_retrieval(corpus):
    sync = {"drive": NOW - 400, "confluence": NOW - 30, "jira": NOW - 30, "policies": NOW - 30}
    client, _, reg = make(corpus, source_sync=lambda: sync)
    ev = events((await ask(client, "t-ana", "¿Cuál es el viático diario en Colombia?")).text)
    assert all("docs.acme.com" not in s["url"] for s in ev[0][1]["sources"])  # Drive afuera; lo demás sigue
    assert reg.get_sample_value("rag_retrieval_degraded_total", {"reason": "source_acl_stale"}) == 1


class FakeLateCheck:
    """La fuente dice, AHORA, qué documentos puede leer la persona (p. ej. una restricción recién agregada)."""

    def __init__(self, revoked=(), delay_s=0.0):
        self.sources, self.revoked, self.delay_s, self.calls = frozenset({"drive"}), set(revoked), delay_s, 0

    async def allowed(self, email, doc_ids):
        self.calls += 1
        await asyncio.sleep(self.delay_s)
        return {d for d in doc_ids if d not in self.revoked}


@pytest.mark.anyio
async def test_late_check_removes_a_just_revoked_document(corpus):
    late = FakeLateCheck(revoked={"drive:3002"})
    client, _, reg = make(corpus, late=late)
    ev = events((await ask(client, "t-ana", "¿Cuál es el viático diario en Colombia?")).text)
    assert late.calls == 1 and all("docs.acme.com/d/3002" not in s["url"] for s in ev[0][1]["sources"])
    assert reg.get_sample_value("rag_retrieval_degraded_total", {"reason": "late_check_removed"}) == 1


@pytest.mark.anyio
async def test_late_check_timeout_fails_closed_for_that_source_only(corpus):
    client, _, reg = make(corpus, late=FakeLateCheck(delay_s=0.5), settings=Settings(late_check_timeout_s=0.05))
    ev = events((await ask(client, "t-ana", "¿Cuál es el viático diario en Colombia?")).text)
    urls = [s["url"] for s in ev[0][1]["sources"]]
    assert urls and all("docs.acme.com" not in u for u in urls)  # Drive afuera; Confluence y macros siguen
    assert reg.get_sample_value("rag_retrieval_degraded_total", {"reason": "late_check_failed"}) == 1
