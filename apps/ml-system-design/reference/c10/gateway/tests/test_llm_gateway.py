"""Tests del llm-gateway con upstreams FALSOS (httpx2.MockTransport): el código HTTP real del gateway corre entero.

Cada test es una situación de operación: auth, alias, cuota, admisión, fallback al vendor con redacción,
streaming con y sin usage, fallas antes y después del primer byte, y un cliente que se va a mitad del stream.
"""

import asyncio  # concurrencia y eventos
import hashlib  # hashes de las keys de prueba
import json  # cuerpos
import re  # leer /metrics
from pathlib import Path  # tenants.yaml y alerts.yml

import httpx2  # cliente hacia el gateway (ASGITransport) y upstreams falsos (MockTransport)
import pytest  # runner
import yaml  # alerts.yml para el test de contrato
from prometheus_client import CollectorRegistry  # registry aislado por test

from llm_gateway import HttpUpstream, create_app, fake_vllm_handler, load_config

HERE = Path(__file__).resolve().parent.parent
SUPPORT, LISTINGS, CATALOG = "sk-c10-demo-support", "sk-c10-demo-listings", "sk-c10-demo-catalog"
MSG = [{"role": "user", "content": "Hola, ¿dónde está mi pedido?"}]


@pytest.fixture
def anyio_backend():
    return "asyncio"


def h(key):
    return {"Authorization": f"Bearer {key}"}


class Recorder:
    """Upstream falso programable: guarda cada request y responde según `mode`."""

    def __init__(self, mode="ok", words=5, delay_s=0.0):
        self.mode, self.calls, self.closed = mode, [], 0
        self.inner = fake_vllm_handler(words=words, delay_s=delay_s)

    async def __call__(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        self.calls.append(body)
        if self.mode == "500":
            return httpx2.Response(500, json={"error": {"message": "boom"}})
        if self.mode == "400":
            return httpx2.Response(400, json={"error": {"message": "prompt más largo que el contexto"}})
        if self.mode == "connect":
            raise httpx2.ConnectError("connection refused", request=request)
        if self.mode in ("hang", "midstream", "track_close"):
            return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=self._special(body))
        return await self.inner(request)

    async def _special(self, body):
        try:
            if self.mode == "hang":
                await asyncio.sleep(30)  # nunca llega el primer evento
            chunk = {"id": "x", "model": body["model"], "choices": [{"index": 0, "delta": {"content": " hola"}}]}
            yield f"data: {json.dumps(chunk)}\n\n".encode()
            if self.mode == "midstream":
                raise httpx2.ReadError("el pod murió")
            for _ in range(200):  # track_close: un stream largo que el cliente abandona
                await asyncio.sleep(0.01)
                yield f"data: {json.dumps(chunk)}\n\n".encode()
        finally:
            self.closed += 1  # el gateway cerró la conexión: vLLM abortaría el request


def build(self_rec=None, vendor_rec=None, **limits_override):
    raw = yaml.safe_load((HERE / "tenants.yaml").read_text())
    raw["limits"].update(dict(first_token_timeout_s=0.3, **limits_override))
    cfg = load_config(raw)
    self_rec = self_rec or Recorder()
    vendor_rec = vendor_rec or Recorder()
    ups = {
        "vllm-70b": HttpUpstream("vllm-70b", "http://vllm/v1", "self", cfg.limits, transport=httpx2.MockTransport(self_rec)),
        "vendor": HttpUpstream("vendor", "https://vendor/v1", "vendor", cfg.limits, api_key="vk",
                               transport=httpx2.MockTransport(vendor_rec)),
    }
    app = create_app(cfg, ups, registry=CollectorRegistry())
    client = httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://gw")
    return app, client, self_rec, vendor_rec


async def metric(client, name, **labels):
    text = (await client.get("/metrics")).text
    total = 0.0
    for line in text.splitlines():
        if not line.startswith(name + "{") and not line.startswith(name + " "):
            continue
        if all(f'{k}="{v}"' in line for k, v in labels.items()):
            total += float(line.rsplit(" ", 1)[1])
    return total


def sse_events(text):
    return [line[6:] for line in text.split("\n") if line.startswith("data: ")]


# ------------------------------------------------------------------ configuración
def test_tenants_yaml_loads_and_hashes_match_demo_keys():
    cfg = load_config(HERE / "tenants.yaml")
    assert cfg.by_key[hashlib.sha256(SUPPORT.encode()).hexdigest()].name == "support-assistant"
    assert cfg.tenants["catalog-enrichment"].priority == "batch"
    assert not cfg.tenants["support-assistant"].vendor_fallback  # PII de soporte: no sale


@pytest.mark.parametrize("mutate, msg", [
    (lambda r: r.update(typo=1), "claves desconocidas"),
    (lambda r: r["tenants"]["support-assistant"].update(allowed_aliases=["nope"]), "alias inexistentes"),
    (lambda r: r["tenants"]["catalog-enrichment"].update(vendor_fallback=True), "vendor_fallback sin"),
    (lambda r: r["tenants"]["support-assistant"].update(tokens_per_minute=1000), "tokens_per_minute"),
    (lambda r: r["tenants"]["support-assistant"].update(priority="vip"), "prioridad"),
    (lambda r: r["tenants"]["support-assistant"].update(
        pins={"extract-default": {"upstream": "vllm-70b-canary", "model": "x"}}), "fija revisiones"),
    (lambda r: r["tenants"]["support-assistant"].update(pins={"chat-default": "x"}), "debe ser"),  # falta el upstream
    (lambda r: r["tenants"]["support-assistant"].update(
        pins={"chat-default": {"upstream": "vendor", "model": "x"}}), "no es una flota propia"),
    (lambda r: r["tenants"]["support-assistant"].update(
        pins={"chat-default": {"upstream": "vllm-70b-canary", "model": "x", "percent": 0}}), "percent"),
    (lambda r: r["tenants"]["support-assistant"].update(max_prompt_token=10), "claves desconocidas"),
])
def test_config_errors_fail_at_startup(mutate, msg):
    raw = yaml.safe_load((HERE / "tenants.yaml").read_text())
    mutate(raw)
    with pytest.raises(ValueError, match=msg):
        load_config(raw)


# ------------------------------------------------------------------ auth y validación
@pytest.mark.anyio
async def test_auth_alias_and_validation_errors():
    _, c, rec, _ = build()
    body = {"model": "chat-default", "messages": MSG}
    assert (await c.post("/v1/chat/completions", json=body)).status_code == 401
    assert (await c.post("/v1/chat/completions", json=body, headers=h("sk-otra"))).status_code == 401
    r = await c.post("/v1/chat/completions", json=dict(body, model="gpt-x"), headers=h(SUPPORT))
    assert r.status_code == 404 and r.json()["error"]["code"] == "model_not_found"
    r = await c.post("/v1/chat/completions", json=dict(body, model="extract-default"), headers=h(SUPPORT))
    assert r.status_code == 403
    r = await c.post("/v1/chat/completions", json=dict(body, max_tokens=5000), headers=h(SUPPORT))
    assert r.status_code == 400 and r.json()["error"]["code"] == "max_tokens_exceeded"
    assert (await c.post("/v1/chat/completions", json=dict(body, n=2), headers=h(SUPPORT))).status_code == 400
    assert (await c.post("/v1/chat/completions", json=dict(body, messages=[]), headers=h(SUPPORT))).status_code == 400
    assert rec.calls == []  # nada de esto llegó a la GPU
    assert await metric(c, "llm_gateway_requests_total", tenant="support-assistant", status="404") == 1
    models = (await c.get("/v1/models", headers=h(CATALOG))).json()
    assert [m["id"] for m in models["data"]] == ["extract-default"]  # solo sus alias


# ------------------------------------------------------------------ camino feliz
@pytest.mark.anyio
async def test_non_stream_rewrites_alias_priority_and_max_tokens():
    app, c, rec, _ = build()
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(SUPPORT))
    assert r.status_code == 200
    assert r.headers["x-llm-backend"] == "self" and r.headers["x-model-revision"] == "chat-70b-fp8-2026-09-28"
    sent = rec.calls[0]
    assert sent["model"] == "chat-70b-fp8-2026-09-28"  # alias → revisión
    assert sent["priority"] == 0  # interactive
    assert sent["max_completion_tokens"] == 1024  # el tope del tenant, porque el cliente no mandó uno
    usage = r.json()["usage"]
    assert await metric(c, "llm_gateway_tokens_total", tenant="support-assistant", direction="output") == usage["completion_tokens"]
    # La cuota se concilió: solo queda cobrado lo real (prompt + completion)
    bucket = app.state.gateway.buckets["support-assistant"]
    assert bucket.tokens == pytest.approx(bucket.capacity - usage["total_tokens"], abs=50)  # + la recarga de ms


CANARY = "chat-70b-fp8-2026-10-12"


def build_with_canary(pin):
    """Gateway con DOS Services de vLLM (estable y canario), cada uno con su upstream falso, y un pin en listings."""
    raw = yaml.safe_load((HERE / "tenants.yaml").read_text())
    raw["tenants"]["listing-assistant"]["pins"] = {"chat-default": pin}
    cfg = load_config(raw)
    stable, canary = Recorder(), Recorder()
    ups = {name: HttpUpstream(name, f"http://{name}/v1", "self", cfg.limits, transport=httpx2.MockTransport(rec))
           for name, rec in (("vllm-70b", stable), ("vllm-70b-canary", canary))}
    app = create_app(cfg, ups, CollectorRegistry())
    return httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url="http://gw"), stable, canary


@pytest.mark.anyio
async def test_prompt_cap_and_per_tenant_pin_routes_to_canary_service():
    c, stable, canary = build_with_canary({"upstream": "vllm-70b-canary", "model": CANARY})  # el tenant entero
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(LISTINGS))
    # El pin cambia el Service Y la revisión: el pod canario solo sirve su --served-model-name (si no, 404)
    assert r.headers["x-model-revision"] == canary.calls[0]["model"] == CANARY and stable.calls == []
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(SUPPORT))
    assert stable.calls[0]["model"] == "chat-70b-fp8-2026-09-28" and len(canary.calls) == 1  # los demás, estable
    long_msg = [{"role": "user", "content": "x" * 18_100}]  # 18,100 ÷ 3 + 4 ≈ 6,038 estimados > 6,000 de listings
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": long_msg}, headers=h(LISTINGS))
    assert r.status_code == 400 and r.json()["error"]["code"] == "prompt_too_long" and len(canary.calls) == 1


@pytest.mark.anyio
async def test_canary_percent_is_per_user_and_sticky():
    c, stable, canary = build_with_canary({"upstream": "vllm-70b-canary", "model": CANARY, "percent": 30})
    users = [f"seller-{i}" for i in range(200)]
    first = {}
    for u in users + users:  # cada usuario dos veces: tiene que caer del mismo lado
        n = len(canary.calls)
        await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "user": u},
                     headers=h(LISTINGS))
        side = len(canary.calls) > n
        assert first.setdefault(u, side) == side
    share = sum(first.values()) / len(users)
    assert 0.2 < share < 0.4  # ≈ 30 % de los usuarios, no de los requests
    assert all(call["model"] == CANARY for call in canary.calls)
    n = len(canary.calls)
    await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(LISTINGS))
    assert len(canary.calls) == n  # sin `user` no hay asignación estable: va a la estable


@pytest.mark.anyio
async def test_batch_tenant_gets_low_priority():
    _, c, rec, _ = build()
    r = await c.post("/v1/chat/completions", json={"model": "extract-default", "messages": MSG, "max_tokens": 200},
                     headers=h(CATALOG))
    assert r.status_code == 200 and rec.calls[0]["priority"] == 10 and rec.calls[0]["max_tokens"] == 200


@pytest.mark.anyio
async def test_stream_relays_events_and_hides_usage_chunk_it_added():
    _, c, rec, _ = build(Recorder(words=5))
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "stream": True},
                     headers=h(SUPPORT))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = sse_events(r.text)
    assert events[-1] == "[DONE]"
    chunks = [json.loads(e) for e in events[:-1]]
    assert "".join(ch["choices"][0]["delta"].get("content", "") for ch in chunks) == " palabra0 palabra1 palabra2 palabra3 palabra4"
    assert all("usage" not in ch for ch in chunks)  # el cliente no pidió usage: no lo ve
    assert rec.calls[0]["stream_options"] == {"include_usage": True}  # pero el gateway sí lo pidió
    assert await metric(c, "llm_gateway_tokens_total", tenant="support-assistant", direction="output") == 5
    assert await metric(c, "llm_gateway_ttft_seconds_count", backend="self") == 1
    assert await metric(c, "llm_gateway_tpot_seconds_count", backend="self") == 1
    assert await metric(c, "llm_gateway_requests_total", status="200") == 1


@pytest.mark.anyio
async def test_stream_passes_usage_when_client_asks():
    _, c, _, _ = build()
    r = await c.post("/v1/chat/completions", headers=h(SUPPORT), json={
        "model": "chat-default", "messages": MSG, "stream": True, "stream_options": {"include_usage": True}})
    chunks = [json.loads(e) for e in sse_events(r.text)[:-1]]
    assert chunks[-1]["choices"] == [] and chunks[-1]["usage"]["completion_tokens"] == 5


# ------------------------------------------------------------------ cuota
@pytest.mark.anyio
async def test_quota_exhaustion_returns_429_with_retry_after():
    app, c, rec, _ = build()
    bucket = app.state.gateway.buckets["support-assistant"]
    bucket.tokens = 500  # casi sin saldo
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(SUPPORT))
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limit_exceeded"
    assert int(r.headers["Retry-After"]) >= 1
    assert rec.calls == []
    # Otro tenant no se ve afectado: las cuotas son por tenant
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(LISTINGS))
    assert r.status_code == 200


# ------------------------------------------------------------------ admisión y fallback
@pytest.mark.anyio
async def test_overload_503_for_support_and_vendor_spillover_for_listings():
    slow = Recorder(words=30, delay_s=0.02)
    _, c, rec, vendor = build(slow, max_inflight=1, interactive_reserved=0, max_wait_s={"interactive": 0.05, "batch": 0.05})
    first = asyncio.create_task(c.post("/v1/chat/completions", headers=h(SUPPORT),
                                       json={"model": "chat-default", "messages": MSG}))
    await asyncio.sleep(0.05)  # el único lugar está ocupado ≈ 0.6 s
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(SUPPORT))
    assert r.status_code == 503 and r.headers["Retry-After"] == "2"  # soporte no tiene fallback
    r = await c.post("/v1/chat/completions", headers=h(LISTINGS), json={
        "model": "chat-default", "messages": [{"role": "user", "content": "escríbeme a ana@x.mx"}]})
    assert r.status_code == 200 and r.headers["x-llm-backend"] == "vendor"
    assert vendor.calls[0]["messages"][0]["content"] == "escríbeme a [EMAIL_1]"  # redactado antes de salir
    assert (await first).status_code == 200
    assert await metric(c, "llm_gateway_vendor_requests_total", tenant="listing-assistant", reason="overloaded") == 1
    assert await metric(c, "llm_gateway_pii_redactions_total", kind="EMAIL") == 1


@pytest.mark.anyio
async def test_upstream_500_fallback_only_for_allowed_tenant_with_allowlisted_fields():
    _, c, _, vendor = build(Recorder(mode="500"))
    body = {"model": "chat-default", "messages": MSG, "user": "buyer-8812", "top_k": 5}
    r = await c.post("/v1/chat/completions", json=body, headers=h(SUPPORT))
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_error"
    r = await c.post("/v1/chat/completions", json=body, headers=h(LISTINGS))
    assert r.status_code == 200 and r.headers["x-llm-backend"] == "vendor"
    sent = vendor.calls[0]
    assert sent["model"] == "vendor-mid-tier"
    assert "priority" not in sent and "user" not in sent and "top_k" not in sent  # solo campos permitidos
    assert await metric(c, "llm_gateway_tokens_total", tenant="listing-assistant", backend="vendor") > 0


@pytest.mark.anyio
async def test_connect_error_and_first_token_timeout():
    _, c, _, _ = build(Recorder(mode="connect"))
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "stream": True},
                     headers=h(SUPPORT))
    assert r.status_code == 502  # antes del primer byte todavía hay un código HTTP honesto
    _, c, rec, _ = build(Recorder(mode="hang"))
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "stream": True},
                     headers=h(SUPPORT))
    assert r.status_code == 504 and r.json()["error"]["code"] == "upstream_timeout"
    assert rec.closed == 1  # se cerró la conexión que no contestaba


@pytest.mark.anyio
async def test_one_retry_on_connect_error_only():
    attempts = []
    ok = fake_vllm_handler(words=3)

    async def flaky(request):
        attempts.append(1)
        if len(attempts) == 1:  # un pod que ya murió y todavía figura en kube-proxy: conexión rechazada
            raise httpx2.ConnectError("connection refused", request=request)
        return await ok(request)

    app, c, _, _ = build()
    app.state.gateway.upstreams["vllm-70b"].client._transport = httpx2.MockTransport(flaky)
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(SUPPORT))
    assert r.status_code == 200 and len(attempts) == 2  # un solo reintento, en otra conexión
    rec = Recorder(mode="500")
    _, c, _, _ = build(rec)
    await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(SUPPORT))
    assert len(rec.calls) == 1  # un 5xx no se reintenta: el request pudo haber llegado


@pytest.mark.anyio
async def test_stream_fallback_before_first_byte():
    _, c, _, vendor = build(Recorder(mode="hang"))
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "stream": True},
                     headers=h(LISTINGS))
    assert r.status_code == 200 and r.headers["x-llm-backend"] == "vendor"
    assert sse_events(r.text)[-1] == "[DONE]" and vendor.calls[0]["stream"] is True


def aborted_stream(content_first=False):
    """Lo que manda vLLM v0.30 cuando aborta un request (p. ej. un pod en drain rechaza lo nuevo): un 200 con el
    chunk del rol, finish_reason "abort" (con o sin texto antes), usage y [DONE]."""
    async def handler(request):
        body = json.loads(request.content)
        base = {"id": "x", "object": "chat.completion.chunk", "model": body["model"]}
        if not body.get("stream"):
            return httpx2.Response(200, json=dict(base, object="chat.completion", choices=[
                {"index": 0, "message": {"role": "assistant", "content": ""}, "finish_reason": "abort"}]))
        chunks = [dict(base, choices=[{"index": 0, "delta": {"role": "assistant", "content": ""}}])]
        if content_first:
            chunks.append(dict(base, choices=[{"index": 0, "delta": {"content": " hola"}}]))
        chunks.append(dict(base, choices=[{"index": 0, "delta": {}, "finish_reason": "abort"}]))
        chunks.append(dict(base, choices=[], usage={"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11}))
        text = "".join(f"data: {json.dumps(ch)}\n\n" for ch in chunks) + "data: [DONE]\n\n"
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=text.encode())
    return handler


@pytest.mark.anyio
async def test_abort_before_content_is_an_upstream_failure_not_an_empty_200():
    app, c, _, vendor = build()
    app.state.gateway.upstreams["vllm-70b"].client._transport = httpx2.MockTransport(aborted_stream())
    stream_body = {"model": "chat-default", "messages": MSG, "stream": True}
    r = await c.post("/v1/chat/completions", json=stream_body, headers=h(SUPPORT))
    assert r.status_code == 502  # soporte: error honesto (y cuenta en LLMGatewayErrorRate)
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(SUPPORT))
    assert r.status_code == 502  # sin streaming, igual
    r = await c.post("/v1/chat/completions", json=stream_body, headers=h(LISTINGS))
    assert r.status_code == 200 and r.headers["x-llm-backend"] == "vendor" and len(vendor.calls) == 1
    assert await metric(c, "llm_gateway_requests_total", tenant="support-assistant", status="502") == 2
    assert await metric(c, "llm_gateway_vendor_requests_total", reason="upstream_error") == 1
    assert app.state.gateway.admission.inflight("interactive") == 0


@pytest.mark.anyio
async def test_abort_after_content_counts_as_stream_error():
    app, c, _, _ = build()
    app.state.gateway.upstreams["vllm-70b"].client._transport = httpx2.MockTransport(aborted_stream(content_first=True))
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "stream": True},
                     headers=h(SUPPORT))
    assert r.status_code == 200 and sse_events(r.text)[-1] == "[DONE]"  # el cliente ya lo estaba recibiendo
    assert await metric(c, "llm_gateway_requests_total", status="stream_error") == 1
    assert await metric(c, "llm_gateway_requests_total", status="200") == 0


@pytest.mark.anyio
async def test_vendor_429_during_fallback_is_our_503():
    async def limited(request):
        return httpx2.Response(429, headers={"retry-after": "7"}, json={"error": {"message": "rate limited"}})

    app, c, _, _ = build(Recorder(mode="500"))
    app.state.gateway.upstreams["vendor"].client._transport = httpx2.MockTransport(limited)
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(LISTINGS))
    # El producto no ve "tu cuota" (429): ve "plataforma sin capacidad", con el Retry-After del vendor
    assert r.status_code == 503 and r.json()["error"]["code"] == "overloaded" and r.headers["Retry-After"] == "7"
    assert await metric(c, "llm_gateway_requests_total", status="503") == 1
    assert await metric(c, "llm_gateway_requests_total", status="429") == 0


@pytest.mark.anyio
async def test_upstream_4xx_is_passed_through_without_fallback():
    _, c, _, vendor = build(Recorder(mode="400"))
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG}, headers=h(LISTINGS))
    assert r.status_code == 400 and "contexto" in r.json()["error"]["message"]
    assert vendor.calls == []  # un request inválido no se "arregla" mandándolo afuera


@pytest.mark.anyio
async def test_midstream_failure_sends_error_event_no_fallback():
    app, c, rec, vendor = build(Recorder(mode="midstream"))
    r = await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "stream": True},
                     headers=h(LISTINGS))
    assert r.status_code == 200  # ya había empezado
    events = sse_events(r.text)
    assert json.loads(events[0])["choices"][0]["delta"]["content"] == " hola"
    assert json.loads(events[-1])["error"]["code"] == "upstream_error"
    assert vendor.calls == []  # no se pegan dos streams de dos modelos
    assert await metric(c, "llm_gateway_requests_total", status="stream_error") == 1
    assert app.state.gateway.admission.inflight("interactive") == 0


# ------------------------------------------------------------------ el cliente se va
async def call_raw(app, body, disconnect_after_first_chunk=False, disconnect_after_s=None):
    """Llama al ASGI app a mano para poder simular la desconexión del cliente (httpx no lo permite)."""
    raw = json.dumps(body).encode()
    gone = asyncio.Event()
    sent = []
    messages = [{"type": "http.request", "body": raw, "more_body": False}]

    async def receive():
        if messages:
            return messages.pop(0)
        await gone.wait()
        return {"type": "http.disconnect"}

    async def send(msg):
        sent.append(msg)
        if disconnect_after_first_chunk and msg["type"] == "http.response.body" and msg.get("body"):
            gone.set()

    scope = {"type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"}, "http_version": "1.1",
             "method": "POST", "scheme": "http", "path": "/v1/chat/completions", "raw_path": b"/v1/chat/completions",
             "query_string": b"", "root_path": "", "server": ("gw", 80), "client": ("10.0.0.1", 5000),
             "headers": [(b"authorization", f"Bearer {SUPPORT}".encode()), (b"content-type", b"application/json")]}
    if disconnect_after_s is not None:
        asyncio.get_running_loop().call_later(disconnect_after_s, gone.set)
    await asyncio.wait_for(app(scope, receive, send), 5)
    return sent


@pytest.mark.anyio
async def test_client_disconnect_mid_stream_closes_upstream_and_frees_slot():
    rec = Recorder(mode="track_close")
    app, c, _, _ = build(rec)
    await call_raw(app, {"model": "chat-default", "messages": MSG, "stream": True}, disconnect_after_first_chunk=True)
    await asyncio.sleep(0.05)
    assert rec.closed == 1  # la conexión con "vLLM" se cerró: el request se aborta allá
    gw = app.state.gateway
    assert gw.admission.inflight("interactive") == 0
    assert await metric(c, "llm_gateway_requests_total", status="499") == 1


@pytest.mark.anyio
async def test_client_disconnect_non_stream_cancels_upstream():
    slow = Recorder(words=40, delay_s=0.0)
    gate = asyncio.Event()

    async def blocked(request):
        slow.calls.append(json.loads(request.content))
        await gate.wait()  # el "modelo" tarda; el cliente se va antes
        return httpx2.Response(200, json={})

    app, c, _, _ = build()
    app.state.gateway.upstreams["vllm-70b"].client._transport = httpx2.MockTransport(blocked)
    sent = await call_raw(app, {"model": "chat-default", "messages": MSG}, disconnect_after_s=0.3)
    assert sent[0]["status"] == 499
    assert app.state.gateway.admission.inflight("interactive") == 0
    assert await metric(c, "llm_gateway_requests_total", status="499") == 1


# ------------------------------------------------------------------ contrato con alerts.yml
@pytest.mark.anyio
async def test_every_gateway_metric_used_in_alerts_exists():
    _, c, _, _ = build()
    await c.post("/v1/chat/completions", json={"model": "chat-default", "messages": MSG, "stream": True}, headers=h(SUPPORT))
    exposed = (await c.get("/metrics")).text
    rules = (HERE.parent / "monitoring" / "alerts.yml").read_text()
    used = set(re.findall(r"\b(llm_gateway_[a-z_]+)", rules))
    assert used, "alerts.yml no usa métricas del gateway"
    for name in used:
        assert re.search(rf"^{name}(\{{| )", exposed, re.M), f"{name} está en alerts.yml pero no en /metrics"
