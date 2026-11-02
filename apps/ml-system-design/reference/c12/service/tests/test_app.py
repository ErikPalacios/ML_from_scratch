"""Tests del servicio (service/app.py): SSE, autenticación, dedupe, webhook firmado, turno que sobrevive a la
desconexión del cliente y que cada métrica de alerts.yml exista en /metrics."""

import asyncio
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from agent.backend import InMemoryCommerceBackend, demo_orders
from agent.llm import DemoChatModel
from agent.loop import AgentLoop
from agent.state import StepLog
from agent.tools import ToolExecutor
from service.app import build_app, sign_webhook, static_tokens

SECRET = "test-secret"
ALERTS = Path(__file__).resolve().parents[2] / "monitoring" / "alerts.yml"


def make(base_latency_s=0.0):
    now = datetime.now(UTC)
    backend = InMemoryCommerceBackend(demo_orders(now), now=now, base_latency_s=base_latency_s)
    store = StepLog(":memory:")
    loop = AgentLoop(DemoChatModel(), ToolExecutor(backend), store, now=lambda: now)
    app = build_app(loop, store, static_tokens({"tok-1": "cust-1", "tok-2": "cust-2"}), webhook_secret=SECRET)
    return app, backend, store


def events(resp):
    """Parsea el cuerpo SSE: bloques 'event: …\\ndata: …' separados por línea vacía."""
    out = []
    for block in resp.text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line and not line.startswith(":"))
        if "event" in fields:
            out.append((fields["event"], json.loads(fields["data"])))
    return out


def post(client, conv, text, mid, token="tok-1", **extra):
    return client.post(f"/v1/conversations/{conv}/messages", headers={"Authorization": f"Bearer {token}"},
                       json={"message_id": mid, "text": text, **extra})


def signed(body: dict, ts: str | None = None, secret=SECRET):
    raw = json.dumps(body).encode()
    ts = ts or str(int(time.time()))
    return raw, {"X-Approval-Timestamp": ts, "X-Approval-Signature": sign_webhook(secret, ts, raw),
                 "content-type": "application/json"}


def test_small_refund_over_sse():
    app, backend, store = make()
    with TestClient(app) as c:
        r = post(c, "c1", "Mi pedido A-1029 llegó roto", "m1")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        ev = events(r)
        conf = next(d for t, d in ev if t == "confirmation_required")
        assert conf["summary"] == "reembolso de 450.00 MXN del pedido A-1029"
        ev2 = events(post(c, "c1", "Sí", "m2", confirm_action_id=conf["action_id"]))
        texts = [d["text"] for t, d in ev2 if t == "message"]
        assert texts[-1].startswith("Listo: emitimos tu reembolso")
        assert len(backend.refunds) == 1
        m = c.get("/metrics").text
        assert 'agent_refunds_total{path="auto"} 1.0' in m
        assert 'agent_tool_calls_total{outcome="ok",tool="issue_refund"} 1.0' in m
        assert "cust-1" not in m and "c1" not in re.sub(r"#.*", "", m)  # sin ids de cliente ni de conversación


def test_auth_and_ownership():
    app, *_ = make()
    with TestClient(app) as c:
        assert post(c, "c1", "hola", "m1", token="nope").status_code == 401
        assert c.post("/v1/conversations/c1/messages", json={"message_id": "m1", "text": "x"}).status_code == 401
        assert post(c, "c1", "hola", "m1").status_code == 200
        # la conversación de cust-1 no existe para cust-2 (404, no 403: no se confirma que exista)
        assert post(c, "c1", "hola", "m2", token="tok-2").status_code == 404
        assert c.get("/v1/conversations/c1/events", headers={"Authorization": "Bearer tok-2"}).status_code == 404
        assert post(c, "c1", "x", "bad id with spaces").status_code == 422


def test_duplicate_message_id_replays():
    app, backend, store = make()
    with TestClient(app) as c:
        first = events(post(c, "c1", "¿y A-1029?", "m1"))
        again = events(post(c, "c1", "¿y A-1029?", "m1"))
        assert [t for t, _ in again] == [t for t, _ in first if t in {"message", "done"}]
        assert backend.calls.count("get_order") == 1


def test_one_turn_at_a_time_per_conversation():
    app, *_ = make()
    with TestClient(app) as c:
        class Busy(asyncio.Lock):  # simula un turno en curso sin depender de tiempos
            def locked(self) -> bool:
                return True

        app.state.locks["c1"] = Busy()
        assert post(c, "c1", "hola", "m1").status_code == 409
        del app.state.locks["c1"]
        assert post(c, "c1", "hola", "m1").status_code == 200


def test_approval_webhook_signed_and_idempotent():
    app, backend, store = make()
    with TestClient(app) as c:
        ev = events(post(c, "c1", "El monitor del pedido A-1031 llegó roto", "m1"))
        conf = next(d for t, d in ev if t == "confirmation_required")
        ev2 = events(post(c, "c1", "Confirmo", "m2", confirm_action_id=conf["action_id"]))
        aid = next(d for t, d in ev2 if t == "approval_pending")["approval_id"]
        assert 'agent_approvals_pending 1.0' in c.get("/metrics").text

        body = {"decision": "approved", "approver_id": "sup-7"}
        raw, headers = signed(body, secret="wrong")
        assert c.post(f"/v1/approvals/{aid}", content=raw, headers=headers).status_code == 401
        raw, headers = signed(body, ts=str(int(time.time()) - 3600))  # firma válida pero vieja: replay
        assert c.post(f"/v1/approvals/{aid}", content=raw, headers=headers).status_code == 401
        # con un turno del cliente corriendo, el webhook espera su turno (el mismo lock): 409 + Retry-After
        lock = app.state.locks.setdefault("c1", asyncio.Lock())
        asyncio.run(lock.acquire())
        raw, headers = signed(body)
        busy = c.post(f"/v1/approvals/{aid}", content=raw, headers=headers)
        assert busy.status_code == 409 and busy.headers["retry-after"] == "5" and backend.refunds == []
        lock.release()
        raw, headers = signed(body)
        r = c.post(f"/v1/approvals/{aid}", content=raw, headers=headers)
        assert r.status_code == 200 and len(backend.refunds) == 1
        assert c.post(f"/v1/approvals/{aid}", content=raw, headers=headers).status_code == 409
        raw, headers = signed(body)
        assert c.post("/v1/approvals/act_nope", content=raw, headers=headers).status_code == 404
        # el aviso llega por /events (el cliente puede haber cerrado la app hace horas)
        later = c.get("/v1/conversations/c1/events?after=0", headers={"Authorization": "Bearer tok-1"}).json()
        assert "fue aprobado y emitido" in later["events"][-2]["data"]["text"]
        assert 'agent_approvals_pending 0.0' in c.get("/metrics").text


def test_turn_finishes_even_if_the_client_disconnects():
    """El cliente corta el stream después del primer evento; el reembolso confirmado igual se completa."""
    app, backend, store = make(base_latency_s=0.05)

    async def scenario():
        async def call(body, stop_after_events=None):
            raw = json.dumps(body).encode()
            got, disconnect = [], asyncio.Event()
            msgs = [{"type": "http.request", "body": raw, "more_body": False}]

            async def receive():
                if msgs:
                    return msgs.pop(0)
                await disconnect.wait()
                return {"type": "http.disconnect"}

            async def send(m):
                if m["type"] == "http.response.body" and m.get("body"):
                    got.append(m["body"])
                    if stop_after_events and len(got) >= stop_after_events:
                        disconnect.set()  # el cliente cierra la app

            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
                     "scheme": "http", "path": "/v1/conversations/c1/messages", "raw_path": b"", "query_string": b"",
                     "root_path": "", "headers": [(b"authorization", b"Bearer tok-1"),
                                                  (b"content-type", b"application/json")],
                     "client": ("t", 1), "server": ("t", 80)}
            await app(scope, receive, send)
            return b"".join(got).decode()

        first = await call({"message_id": "m1", "text": "Mi pedido A-1029 llegó roto"})
        aid = re.search(r'"action_id":"(act_[0-9a-f]+)"', first.replace(" ", "")).group(1)
        await call({"message_id": "m2", "text": "Sí", "confirm_action_id": aid}, stop_after_events=1)
        await asyncio.wait(app.state.tasks, timeout=5)  # el turno seguía corriendo en su propia tarea
        return store

    asyncio.run(scenario())
    assert len(backend.refunds) == 1
    assert store.incomplete_turn("c1") is None
    msgs = [s.payload["data"]["text"] for s in store.events("c1") if s.payload["type"] == "message"]
    assert msgs[-1].startswith("Listo")
    store.close()


def _metric_names_in_alerts() -> set[str]:
    names = set()
    for group in yaml.safe_load(ALERTS.read_text())["groups"]:
        for rule in group["rules"]:
            names |= set(re.findall(r"\b(agent_[a-z_]+)", rule["expr"]))
    return {re.sub(r"_(bucket|sum|count)$", "", n) for n in names}


def test_every_metric_used_by_the_alerts_exists():
    app, *_ = make()
    with TestClient(app) as c:
        m = c.get("/metrics").text
    exposed = set(re.findall(r"^# TYPE (\w+) ", m, flags=re.M))
    exposed |= {n.removesuffix("_total") for n in exposed}
    missing = {n for n in _metric_names_in_alerts() if n not in exposed and n.removesuffix("_total") not in exposed}
    assert not missing, missing
    # y las series que la alerta de tolerancia cero necesita existen en 0 desde el arranque
    assert 'agent_policy_violations_total{check="refund_over_limit_without_approval"} 0.0' in m


@pytest.mark.parametrize("name", ["AgentToolErrorRateHigh", "AgentStepLimitHit", "AgentPolicyViolation",
                                  "RefundAmountAnomaly", "AgentTurnLatencyHigh", "ApprovalQueueBacklog",
                                  "AgentCostPerConversationHigh", "EscalationRateShift"])
def test_the_eight_alert_names_of_the_case(name):
    alerts = {r["alert"] for g in yaml.safe_load(ALERTS.read_text())["groups"] for r in g["rules"] if "alert" in r}
    assert name in alerts and len(alerts) == 8
