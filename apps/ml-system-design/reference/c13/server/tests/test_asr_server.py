"""Tests del asr-worker con TestClient (WebSocket real en proceso) y el modelo falso.

Cada test es una situación de operación: el camino feliz, un handshake inválido, el worker lleno, una
reconexión, un stream que deja de mandar audio, una sesión de 4 h, un drain con alguien hablando, la GPU
que no da abasto, el modelo que falla y un consumidor que no lee. Más el contrato con las alertas.
"""

import asyncio
import re
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from asr_server import (
    CLOSE_INTERNAL,
    CLOSE_NORMAL,
    CLOSE_POLICY,
    CLOSE_SERVICE_RESTART,
    CLOSE_TRY_AGAIN,
    FakeStreamingASR,
    Metrics,
    OutboundBuffer,
    Settings,
    StreamSession,
    _sampled,
    create_app,
    wait_for_drain,
)

SR = 16000
LOCAL = ("127.0.0.1", 50000)  # /admin/* solo acepta localhost (lo llama el preStop dentro del pod)


def tone(ms, amp=0.1):
    t = np.arange(SR * ms // 1000) / SR
    return (amp * np.sin(2 * np.pi * 300 * t) * 32767).astype("<i2")


def silence(ms):
    return np.zeros(SR * ms // 1000, dtype="<i2")


def send_audio(ws, audio, frame=320):
    for i in range(0, len(audio), frame):
        ws.send_bytes(audio[i:i + frame].tobytes())


def start(ws, sid="s1", **extra):
    ws.send_json({"type": "start", "session_id": sid, "language": "es-419", "sample_rate": 16000,
                  "encoding": "pcm_s16le", **extra})
    return ws.receive_json()


def collect(ws):
    """Lee hasta que el server cierra; devuelve (mensajes, código de cierre)."""
    msgs = []
    try:
        while True:
            msgs.append(ws.receive_json())
    except WebSocketDisconnect as e:
        return msgs, e.code


def sample(metrics: Metrics, name, labels=None):
    return metrics.registry.get_sample_value(name, labels or {})


def make(**settings):
    model = FakeStreamingASR(step_delay_s=settings.pop("step_delay_s", 0.0),
                             fail_at_step=settings.pop("fail_at_step", None))
    m = Metrics()
    app = create_app(model, Settings(**settings), m)
    return app, model, m


# ---------------------------------------------------------------------------- camino feliz
def test_one_utterance_partials_then_final_then_normal_close():
    app, model, m = make()
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        ready = start(ws)
        assert ready["type"] == "ready" and ready["chunk_ms"] == 160
        # 0.5 s de silencio, 1 s de "voz", 1 s de silencio → una utterance de 11 chunks (ver test_chunker)
        send_audio(ws, np.concatenate([silence(500), tone(1000), silence(1000)]))
        ws.send_json({"type": "stop"})
        msgs, code = collect(ws)
    assert code == CLOSE_NORMAL
    partials = [x for x in msgs if x["type"] == "partial"]
    finals = [x for x in msgs if x["type"] == "final"]
    assert partials, "debe haber al menos un partial"
    assert len(finals) == 1
    # El fake emite una palabra por chunk: 11 chunks → 11 palabras, sin la letra que le "falta" al partial
    assert finals[0]["text"] == "hola a todos hoy vamos a revisar el plan de la"
    assert (finals[0]["start_ms"], finals[0]["end_ms"]) == (400, 2100)
    seqs = [x["seq"] for x in msgs]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)  # el consumidor puede descartar desordenados
    assert all(0 <= p["stable_words"] <= len(p["text"].split()) for p in partials)
    assert sample(m, "asr_sessions_ended_total", {"reason": "normal"}) == 1
    assert sample(m, "asr_final_latency_seconds_count", {"language": "es-419"}) == 1
    assert sample(m, "asr_vad_frames_total", {"decision": "silence"}) > 0
    assert sample(m, "asr_active_streams") == 0 and model.open_streams == 0  # el estado se liberó


def test_silence_only_produces_no_captions():
    app, _, m = make()
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        start(ws)
        send_audio(ws, silence(2000))
        ws.send_json({"type": "stop"})
        msgs, code = collect(ws)
    assert msgs == [] and code == CLOSE_NORMAL
    assert sample(m, "asr_model_step_seconds_count") == 0  # el silencio no gastó GPU


# ---------------------------------------------------------------------------- handshake y límites
@pytest.mark.parametrize("first", [
    b"\x00\x01" * 320,  # audio antes del JSON
    {"type": "start", "session_id": "s", "language": "fr-FR", "sample_rate": 16000},  # idioma no lanzado
    {"type": "start", "session_id": "s", "language": "es-419", "sample_rate": 48000},  # Opus sin remuestrear
    {"type": "start", "language": "es-419", "sample_rate": 16000},  # sin session_id
])
def test_bad_handshake_closes_with_policy_violation(first):
    app, _, m = make()
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        if isinstance(first, bytes):
            ws.send_bytes(first)
        else:
            ws.send_json(first)
        msgs, code = collect(ws)
    assert code == CLOSE_POLICY and msgs[0]["code"] == "bad_handshake"
    assert sample(m, "asr_sessions_rejected_total", {"reason": "bad_handshake"}) == 1


def test_full_worker_rejects_with_try_again_later():
    app, _, m = make(max_streams=1)
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws1:
        assert start(ws1, "a")["type"] == "ready"
        with c.websocket_connect("/v1/stream") as ws2:
            ws2.send_json({"type": "start", "session_id": "b", "language": "es-419", "sample_rate": 16000})
            msgs, code = collect(ws2)
        assert code == CLOSE_TRY_AGAIN and msgs[0]["code"] == "capacity"
        assert sample(m, "asr_active_streams") == 1


def test_reconnect_is_counted_with_a_bounded_reason():
    app, _, m = make()
    with TestClient(app) as c:
        for reason in ("worker_lost", "something-new"):
            with c.websocket_connect("/v1/stream") as ws:
                start(ws, "s1", reconnect_attempt=1, reconnect_reason=reason)
                ws.send_json({"type": "stop"})
                collect(ws)
    assert sample(m, "asr_reconnects_total", {"reason": "worker_lost"}) == 1
    assert sample(m, "asr_reconnects_total", {"reason": "unknown"}) == 1  # el label no crece sin control


def test_idle_stream_is_closed_and_frees_the_slot():
    app, _, m = make(max_idle_s=0.3)
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        start(ws)
        msgs, code = collect(ws)  # no manda nada: a los 0.3 s el server cierra
    assert code == CLOSE_NORMAL and msgs == []
    assert sample(m, "asr_sessions_ended_total", {"reason": "idle"}) == 1
    assert sample(m, "asr_active_streams") == 0


def test_max_session_duration():
    # El reader espera audio con timeout = min(MAX_IDLE_S, lo que queda de la sesión): sin mensajes ni
    # timers extra, la sesión se corta a los 0.4 s aunque MAX_IDLE_S sea 30 s
    app, _, m = make(max_session_s=0.4)
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        start(ws)
        send_audio(ws, silence(200))
        msgs, code = collect(ws)
    assert code == CLOSE_NORMAL and msgs == []
    assert sample(m, "asr_sessions_ended_total", {"reason": "max_duration"}) == 1


# ---------------------------------------------------------------------------- drain
def test_drain_migrates_idle_sessions_now_and_speaking_sessions_after_their_final():
    app, _, m = make()
    with TestClient(app, client=LOCAL) as c:
        with c.websocket_connect("/v1/stream") as speaking, c.websocket_connect("/v1/stream") as quiet:
            start(speaking, "speaking")
            start(quiet, "quiet")
            send_audio(quiet, silence(400))
            send_audio(speaking, np.concatenate([silence(300), tone(600)]))  # sigue hablando: sin endpoint
            r = c.post("/admin/drain")
            assert r.status_code == 200 and r.json()["draining"] is True
            assert c.get("/readyz").status_code == 503  # el router deja de mandar sesiones nuevas
            # La sesión callada migra de inmediato
            q_msgs, q_code = collect(quiet)
            assert q_code == CLOSE_SERVICE_RESTART and q_msgs[-1] == {"type": "migrate", "reason": "draining", "seq": 1}
            # La que habla termina su frase: 1 s de silencio → final → migrate → 1012
            send_audio(speaking, silence(1000))
            s_msgs, s_code = collect(speaking)
            assert s_code == CLOSE_SERVICE_RESTART
            types = [x["type"] for x in s_msgs]
            assert "final" in types and types[-1] == "migrate" and types.index("final") < types.index("migrate")
        # Una sesión nueva en un worker que drena se rechaza (carrera con el router)
        with c.websocket_connect("/v1/stream") as late:
            late.send_json({"type": "start", "session_id": "late", "language": "es-419", "sample_rate": 16000})
            msgs, code = collect(late)
            assert code == CLOSE_TRY_AGAIN and msgs[0]["code"] == "draining"
        assert c.get("/admin/status").json() == {"draining": True, "active_streams": 0}
    assert sample(m, "asr_stream_capacity") == 0 and sample(m, "asr_draining") == 1
    assert sample(m, "asr_sessions_ended_total", {"reason": "migrate"}) == 2


def test_admin_endpoints_are_local_only():
    app, _, _ = make()
    with TestClient(app) as c:  # cliente "testclient", no localhost
        assert c.post("/admin/drain").status_code == 403
        assert c.get("/admin/status").status_code == 403
        assert c.get("/readyz").status_code == 200


def test_wait_for_drain_polls_until_empty_or_deadline():
    now = [0.0]
    statuses = iter([{"active_streams": 3}, {"active_streams": 1}, {"active_streams": 0}])
    left = wait_for_drain(lambda: {"active_streams": 5}, lambda: next(statuses), timeout_s=100,
                          poll_s=2, clock=lambda: now[0], sleep=lambda s: now.__setitem__(0, now[0] + s))
    assert left == 0 and now[0] == 6  # tres sondeos de 2 s
    now[0] = 0.0
    left = wait_for_drain(lambda: {"active_streams": 5}, lambda: {"active_streams": 2}, timeout_s=10,
                          poll_s=2, clock=lambda: now[0], sleep=lambda s: now.__setitem__(0, now[0] + s))
    assert left == 2 and now[0] == 10  # venció el plazo con 2 streams: el preStop sale igual

    def boom():
        raise OSError("connection refused")

    assert wait_for_drain(boom, boom, timeout_s=10) == -1  # nunca lanza: el preStop no debe colgarse


# ---------------------------------------------------------------------------- backpressure y fallas
def test_gpu_behind_real_time_closes_with_try_again_later():
    # Cada paso tarda 200 ms (más que los 160 ms de audio que procesa): el worker se atrasa sin remedio
    app, _, m = make(step_delay_s=0.2, inbound_max_chunks=3)
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        start(ws)
        send_audio(ws, np.concatenate([silence(200), tone(3000)]))
        msgs, code = collect(ws)
    assert code == CLOSE_TRY_AGAIN
    assert any(x.get("code") == "overloaded" for x in msgs)
    assert sample(m, "asr_sessions_ended_total", {"reason": "overloaded"}) == 1


def test_model_failure_closes_one_session_with_internal_error():
    app, model, m = make(fail_at_step=2)
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        start(ws)
        send_audio(ws, np.concatenate([silence(200), tone(1000)]))
        msgs, code = collect(ws)
    assert code == CLOSE_INTERNAL and msgs[-1]["code"] == "internal"
    assert model.open_streams == 0  # el estado del stream se liberó igual
    with TestClient(app) as c:
        assert c.get("/healthz").status_code == 200  # el worker sigue vivo para las demás sesiones


def test_outbound_buffer_drops_old_partials_never_finals():
    b = OutboundBuffer(maxsize=3)
    assert b.offer({"type": "partial", "seq": 1}) == (True, 0)
    assert b.offer({"type": "final", "seq": 2}) == (True, 0)
    assert b.offer({"type": "partial", "seq": 3}) == (True, 0)
    assert b.offer({"type": "partial", "seq": 4}) == (True, 1)  # sale el partial 1
    assert [x["seq"] for x in b._q] == [2, 3, 4]
    assert b.offer({"type": "final", "seq": 5}) == (True, 1)  # sale el partial 3
    assert b.offer({"type": "final", "seq": 6}) == (True, 1)  # sale el partial 4
    assert [x["seq"] for x in b._q] == [2, 5, 6]
    assert b.offer({"type": "partial", "seq": 7}) == (True, 1)  # el partial nuevo es el que sobra
    assert b.offer({"type": "final", "seq": 8}) == (False, 0)  # solo finales: el consumidor no lee


class SlowTransport:
    """Un cliente que manda audio 10× más rápido que el tiempo real (2 ms por frame de 20 ms) y tarda
    50 ms en leer cada mensaje: el modelo va al día, quien consume no."""

    def __init__(self, audio):
        self.inbox = [audio[i:i + 320].tobytes() for i in range(0, len(audio), 320)] + ['{"type":"stop"}']
        self.sent, self.closed = [], None

    async def receive(self):
        await asyncio.sleep(0.002)
        return self.inbox.pop(0) if self.inbox else None

    async def send_json(self, msg):
        await asyncio.sleep(0.05)
        self.sent.append(msg)

    async def close(self, code, reason):
        self.closed = (code, reason)


def test_slow_consumer_loses_partials_but_gets_every_final():
    audio = np.concatenate([silence(200), tone(1500), silence(800), tone(1500), silence(800)])
    m = Metrics()
    t = SlowTransport(audio)
    s = Settings(outbound_max_messages=2)
    sess = StreamSession("slow", "es-419", t, FakeStreamingASR(step_delay_s=0.001), s, m)
    asyncio.run(sess.run())
    finals = [x for x in t.sent if x["type"] == "final"]
    assert len(finals) == 2 and t.closed[0] == CLOSE_NORMAL
    assert sample(m, "asr_dropped_messages_total", {"type": "partial", "reason": "slow_consumer"}) > 0


def test_latency_log_sampling_is_deterministic_and_close_to_the_rate():
    ids = [f"meeting-{i}/participant-{i % 7}" for i in range(20000)]
    picked = [i for i in ids if _sampled(i, 0.01)]
    assert 140 <= len(picked) <= 260  # ≈ 1 % de 20,000 = 200
    assert picked == [i for i in ids if _sampled(i, 0.01)]  # la misma sesión siempre cae igual


# ---------------------------------------------------------------------------- contrato con las alertas
def test_every_asr_metric_used_by_alerts_exists():
    app, _, _ = make()
    with TestClient(app) as c:
        exposed = c.get("/metrics").text
    alerts = (Path(__file__).resolve().parents[2] / "monitoring" / "alerts.yml").read_text()
    # asr_golden_* las publica el job de evaluación (no el worker): ver el encabezado de alerts.yml.
    # (?!\.py): "asr_server.py" en un comentario no es una métrica.
    used = {n for n in re.findall(r"\b(asr_[a-z_]+?)(?:_bucket|_count|_sum)?\b(?!\.py)", alerts)
            if not n.startswith("asr_golden_")}
    assert used, "alerts.yml debería usar métricas asr_*"
    for name in sorted(used):
        base = name.removesuffix("_total")
        assert re.search(rf"^# TYPE {base}(_total)? ", exposed, re.M), f"{name} no existe en /metrics"


def test_ready_message_contract():
    # El contrato con el gateway: el ready trae la versión del modelo (va con cada transcript) y los límites
    app, _, _ = make()
    with TestClient(app) as c, c.websocket_connect("/v1/stream") as ws:
        ready = start(ws)
        ws.send_json({"type": "stop"})
        collect(ws)
    assert ready == {"type": "ready", "session_id": "s1", "model_version": "fake-streaming-asr",
                     "chunk_ms": 160, "max_session_s": 14400.0}
