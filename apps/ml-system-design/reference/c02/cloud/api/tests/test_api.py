"""Tests de la API de ingesta (caso c02) SIN AWS: cola, firmador y reloj falsos.

Los dos últimos tests usan boto3 REAL sin red: el Stubber de botocore valida los parámetros de
send_message contra el modelo de la API de SQS, y la URL prefirmada de S3 se genera localmente
(firmar no llama a AWS). Así se prueba el código de producción, no solo los fakes.
Correr: cd cloud/api && pytest
"""

import uuid

import boto3
import pytest
from botocore.stub import Stubber
from fastapi.testclient import TestClient  # corre la app ASGI en proceso (usa httpx2)
from prometheus_client.parser import text_string_to_metric_families

from main import S3PresignSigner, SqsEventQueue, create_app, token_hash

SITE_TOKEN, OTHER_TOKEN, SOC_TOKEN = "tok-dc07-" + "x" * 32, "tok-dc08-" + "y" * 32, "tok-soc-" + "z" * 32
SITE = {"Authorization": f"Bearer {SITE_TOKEN}"}
OTHER = {"Authorization": f"Bearer {OTHER_TOKEN}"}
SOC = {"Authorization": f"Bearer {SOC_TOKEN}"}


class FakeClock:
    def __init__(self, t=1_790_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class FakeQueue:
    """Imita SqsEventQueue.send; `fail` > 0 simula SQS caído en los próximos envíos."""

    def __init__(self):
        self.sent, self.fail = [], 0

    def send(self, message):
        if self.fail:
            self.fail -= 1
            raise ConnectionError("SQS no disponible")
        self.sent.append(message)


class FakeSigner:
    def presign_put(self, key, content_type):
        return {"url": f"https://evidence.s3.test/{key}?X-Amz-Signature=fake", "headers": {"Content-Type": content_type},
                "expires_in": 900}


@pytest.fixture
def env():
    clock, queue = FakeClock(), FakeQueue()
    app = create_app({token_hash(SITE_TOKEN): "dc-07", token_hash(OTHER_TOKEN): "dc-08"}, token_hash(SOC_TOKEN),
                     queue, FakeSigner(), clock=clock)
    with TestClient(app) as client:
        yield client, queue, clock


def event(event_id=None, **overrides):
    eid = event_id or str(uuid.uuid4())
    body = {
        "event_id": eid, "site_id": "dc-07", "camera_id": "cam-01", "zone_id": "perimetro-norte", "track_id": "7",
        "label": "person", "first_seen_at": 1_790_000_000.0 - 3.2, "triggered_at": 1_790_000_000.0 - 1.6,
        "dwell_s": 1.6, "box": [0.48, 0.65, 0.52, 0.9],
        "frames": [f"sites/dc-07/events/{eid}/frame-{i}.jpg" for i in range(3)],
        "model_version": "det-2026-09-01-yolo-fp16", "forwarder_version": "2026-09-29",
    }
    body.update(overrides)
    return body


def metric(client, name, **labels):
    """Valor de una serie en /metrics (None si no existe): lo mismo que vería Prometheus."""
    for family in text_string_to_metric_families(client.get("/metrics").text):
        for sample in family.samples:
            if sample.name == name and all(sample.labels.get(k) == v for k, v in labels.items()):
                return sample.value
    return None


# ------------------------------------------------------------------------------ autenticación
def test_events_require_a_valid_site_token(env):
    client, queue, _ = env
    assert client.post("/v1/events", json=event()).status_code == 401
    r = client.post("/v1/events", json=event(), headers={"Authorization": "Bearer inventado"})
    assert r.status_code == 401 and r.headers["WWW-Authenticate"] == "Bearer"
    assert client.post("/v1/alerts/" + str(uuid.uuid4()) + "/displayed", headers=SITE).status_code == 401  # rol SOC
    assert queue.sent == []


def test_site_comes_from_the_token_not_the_body(env):
    client, queue, _ = env
    assert client.post("/v1/events", json=event(site_id="dc-08"), headers=SITE).status_code == 403
    body = event()
    body.pop("site_id")  # sin site_id en el cuerpo también se acepta: manda el token
    assert client.post("/v1/events", json=body, headers=SITE).status_code == 202
    assert queue.sent[0]["site_id"] == "dc-07"


def test_frames_must_live_under_the_event_prefix(env):
    client, _, _ = env
    body = event()
    body["frames"] = ["sites/dc-08/events/otro/frame-0.jpg"]  # apuntar a evidencia de otro sitio
    assert client.post("/v1/events", json=body, headers=SITE).status_code == 422


# ------------------------------------------------------------------------------ idempotencia
def test_same_event_twice_is_accepted_once(env):
    client, queue, _ = env
    body = event()
    first = client.post("/v1/events", json=body, headers=SITE)
    second = client.post("/v1/events", json=body, headers=SITE)  # la caja reintenta (perdió el 202)
    assert (first.status_code, first.json()["status"]) == (202, "accepted")
    assert (second.status_code, second.json()["status"]) == (202, "duplicate")
    assert len(queue.sent) == 1  # el verificador (y el SOC) lo ven una sola vez
    assert metric(client, "events_received_total", site="dc-07", verdict="accepted") == 1
    assert metric(client, "events_received_total", site="dc-07", verdict="duplicate") == 1


def test_queue_outage_returns_503_and_the_retry_still_enqueues(env):
    client, queue, _ = env
    queue.fail = 1
    body = event()
    r = client.post("/v1/events", json=body, headers=SITE)
    assert r.status_code == 503 and r.headers["Retry-After"] == "5"  # la caja lo deja en su cola y reintenta
    retry = client.post("/v1/events", json=body, headers=SITE)
    # Ya estaba guardado, pero NUNCA se encoló: el reintento lo encola y cuenta como aceptado
    assert retry.json()["status"] == "accepted" and len(queue.sent) == 1
    assert client.post("/v1/events", json=body, headers=SITE).json()["status"] == "duplicate"
    assert len(queue.sent) == 1


def test_same_event_id_from_another_site_is_a_conflict(env):
    client, _, _ = env
    body = event()
    assert client.post("/v1/events", json=body, headers=SITE).status_code == 202
    other = dict(body, site_id="dc-08", frames=[])
    assert client.post("/v1/events", json=other, headers=OTHER).status_code == 409


def test_unknown_fields_are_ignored_but_bad_values_are_rejected(env):
    client, _, _ = env
    # Un forwarder más nuevo manda un campo que esta API no conoce: se acepta (rollout por olas)
    assert client.post("/v1/events", json=event(nuevo_campo=123), headers=SITE).status_code == 202
    assert client.post("/v1/events", json=event(label="dog"), headers=SITE).status_code == 422
    assert client.post("/v1/events", json=event(box=[0.1, 0.2, 1.5, 0.9]), headers=SITE).status_code == 422


# ------------------------------------------------------------------------------ uploads
def test_upload_returns_a_presigned_put_under_the_site_prefix(env):
    client, _, _ = env
    eid = str(uuid.uuid4())
    r = client.post("/v1/uploads", json={"event_id": eid, "kind": "frame", "index": 2, "content_type": "image/jpeg"},
                    headers=SITE)
    assert r.status_code == 200
    spec = r.json()
    assert spec["key"] == f"sites/dc-07/events/{eid}/frame-2.jpg" and spec["method"] == "PUT"
    assert spec["headers"] == {"Content-Type": "image/jpeg"}  # va firmado: la caja debe mandarlo igual
    clip = client.post("/v1/uploads", json={"event_id": eid, "kind": "clip", "content_type": "video/mp4"}, headers=SITE)
    assert clip.json()["key"].endswith("/clip.mp4")
    bad = {"event_id": eid, "kind": "frame", "index": 0, "content_type": "video/mp4"}
    assert client.post("/v1/uploads", json=bad, headers=SITE).status_code == 422
    bad = {"event_id": eid, "kind": "frame", "index": 3, "content_type": "image/jpeg"}
    assert client.post("/v1/uploads", json=bad, headers=SITE).status_code == 422


# ------------------------------------------------------------------------------ heartbeat y métricas
def test_heartbeat_gauges_exist_for_every_site_and_fps_expires(env):
    client, _, clock = env
    # Antes de cualquier heartbeat, la serie existe en 0: EdgeBoxOffline puede disparar para un sitio mudo
    assert metric(client, "edge_last_heartbeat_timestamp_seconds", site="dc-08") == 0.0
    r = client.post("/v1/heartbeat", headers=SITE,
                    json={"sent_at": clock.t - 0.4, "cameras": {"cam-01": 5.0, "cam-02": 0.0}, "outbox": {"pending": 0}})
    assert r.json() == {"status": "ok", "server_time": clock.t}
    assert metric(client, "edge_last_heartbeat_timestamp_seconds", site="dc-07") == clock.t
    assert metric(client, "camera_fps", site="dc-07", camera="cam-02") == 0.0  # cámara caída: 0 explícito
    clock.t += 120  # 2 min sin heartbeat en esta réplica: el fps ya no es confiable
    assert metric(client, "camera_fps", site="dc-07", camera="cam-01") is None
    assert metric(client, "edge_last_heartbeat_timestamp_seconds", site="dc-07") == clock.t - 120


def test_heartbeat_exports_the_edge_outbox_while_fresh(env):
    client, _, clock = env
    body = {"sent_at": clock.t, "site_id": "dc-07", "cameras": {"cam-01": 5.0},
            "outbox": {"pending": 3, "oldest_age_s": 400.0, "oldest_event_age_s": 75.0, "dead_letters": 2,
                       "dead_letter_events": 1},
            "counters": {"malformed_messages": 2, "on_message_errors": 0}}  # contadores: solo se loguean
    assert client.post("/v1/heartbeat", json=body, headers=SITE).status_code == 200
    # Lo que mira EdgeEventsStuck: un evento que no sale o que quedó en dead-letter en la caja
    assert metric(client, "edge_outbox_oldest_event_age_seconds", site="dc-07") == 75.0
    assert metric(client, "edge_outbox_dead_letter_events", site="dc-07") == 1
    clock.t += 120  # heartbeat viejo en esta réplica: igual que camera_fps, deja de exponerse
    assert metric(client, "edge_outbox_oldest_event_age_seconds", site="dc-07") is None


def test_heartbeat_from_a_box_configured_for_another_site_is_rejected(env):
    client, _, clock = env
    # Repuesto con el site.yaml de dc-08 y el token de dc-07: sus eventos reciben 403 y esperan en la caja.
    # Si el heartbeat pasara, el sitio se vería "vivo"; rechazado, EdgeBoxOffline avisa.
    body = {"sent_at": clock.t, "site_id": "dc-08", "cameras": {"cam-01": 5.0}}
    assert client.post("/v1/heartbeat", json=body, headers=SITE).status_code == 403
    assert metric(client, "edge_last_heartbeat_timestamp_seconds", site="dc-07") == 0.0


def test_heartbeat_limits_cardinality(env):
    client, _, clock = env
    too_many = {f"cam-{i:03d}": 5.0 for i in range(65)}
    assert client.post("/v1/heartbeat", json={"sent_at": clock.t, "cameras": too_many}, headers=SITE).status_code == 422
    weird = {"Cam 1; DROP": 5.0}  # ids fuera del patrón no se vuelven labels
    assert client.post("/v1/heartbeat", json={"sent_at": clock.t, "cameras": weird}, headers=SITE).status_code == 422


def test_displayed_observes_end_to_end_latency_once(env):
    client, _, clock = env
    body = event()
    client.post("/v1/events", json=body, headers=SITE)
    assert client.post(f"/v1/alerts/{body['event_id']}/displayed", headers=SOC).status_code == 200
    client.post(f"/v1/alerts/{body['event_id']}/displayed", headers=SOC)  # la consola reintenta: no cuenta doble
    assert metric(client, "alert_end_to_end_seconds_count", site="dc-07") == 1
    assert metric(client, "alert_end_to_end_seconds_sum", site="dc-07") == pytest.approx(3.2)  # first_seen = t − 3.2
    assert metric(client, "alert_end_to_end_seconds_bucket", site="dc-07", le="4.0") == 1  # dentro del SLO de 5 s
    assert client.post(f"/v1/alerts/{uuid.uuid4()}/displayed", headers=SOC).status_code == 404


def test_events_outside_the_slo_do_not_touch_the_latency_histograms(env):
    client, queue, _ = env
    # Un recordatorio 10 min después (o el carril de bomberos, 60 s): mediría 600 s "de latencia" y un solo
    # evento así dispararía AlertLatencyHigh. Llega al SOC igual, pero no entra en el SLO.
    reminder = event(slo=False, first_seen_at=1_790_000_000.0 - 603.2, dwell_s=601.6)
    assert client.post("/v1/events", json=reminder, headers=SITE).status_code == 202 and len(queue.sent) == 1
    client.post(f"/v1/alerts/{reminder['event_id']}/displayed", headers=SOC)
    assert not metric(client, "alert_end_to_end_seconds_count", site="dc-07")
    assert not metric(client, "event_ingest_lag_seconds_count", site="dc-07")
    normal = event()
    client.post("/v1/events", json=normal, headers=SITE)
    client.post(f"/v1/alerts/{normal['event_id']}/displayed", headers=SOC)
    assert metric(client, "alert_end_to_end_seconds_count", site="dc-07") == 1
    assert metric(client, "event_ingest_lag_seconds_count", site="dc-07") == 1  # por sitio: "¿uno o todos?"


def test_disposition_feeds_the_false_alarm_counters(env):
    client, _, _ = env
    real, false_alarm = event(), event()
    for b in (real, false_alarm):
        client.post("/v1/events", json=b, headers=SITE)
    client.post(f"/v1/alerts/{real['event_id']}/disposition", json={"disposition": "confirmed"}, headers=SOC)
    client.post(f"/v1/alerts/{false_alarm['event_id']}/disposition", json={"disposition": "dismissed"}, headers=SOC)
    again = client.post(f"/v1/alerts/{false_alarm['event_id']}/disposition", json={"disposition": "dismissed"}, headers=SOC)
    assert again.status_code == 200  # idempotente: no cuenta doble
    flip = client.post(f"/v1/alerts/{real['event_id']}/disposition", json={"disposition": "dismissed"}, headers=SOC)
    assert flip.status_code == 409
    assert metric(client, "alerts_closed_total", site="dc-07") == 2
    assert metric(client, "alerts_dismissed_total", site="dc-07") == 1
    assert metric(client, "alerts_dismissed_total", site="dc-08") == 0  # inicializada aunque no haya alertas


def test_health_endpoints(env):
    client, _, _ = env
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json()["sites"] == 2


# ------------------------------------------------------------------------------ boto3 real, sin red
@pytest.fixture
def fake_aws(monkeypatch):
    # Credenciales falsas: firmar y validar parámetros no llama a AWS
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")


def test_sqs_queue_sends_what_the_sqs_api_accepts(fake_aws):
    client = boto3.client("sqs", region_name="us-east-1")
    url = "https://sqs.us-east-1.amazonaws.com/123456789012/c02-candidate-events"
    message = {"event_id": "e-1", "site_id": "dc-07"}
    with Stubber(client) as stub:
        # El Stubber rechaza parámetros que no existen en el modelo de SQS (nombres, tipos, anidamiento)
        stub.add_response("send_message", {"MessageId": "m-1", "MD5OfMessageBody": "x"}, {
            "QueueUrl": url, "MessageBody": '{"event_id": "e-1", "site_id": "dc-07"}',
            "MessageAttributes": {"site_id": {"DataType": "String", "StringValue": "dc-07"}},
        })
        SqsEventQueue(url, client=client).send(message)
        stub.assert_no_pending_responses()


def test_s3_signer_builds_a_sigv4_put_url(fake_aws):
    # Hallazgo verificado (botocore 1.43, us-east-1): un cliente de S3 creado SIN signature_version="s3v4"
    # firma la URL con SigV2 (AWSAccessKeyId=…&Signature=…), que los buckets creados después del 24-jun-2020
    # no aceptan. Por eso S3PresignSigner construye su propio cliente con Config(signature_version="s3v4").
    legacy = boto3.client("s3", region_name="us-east-1").generate_presigned_url(
        "put_object", Params={"Bucket": "c02-evidence", "Key": "k"}, ExpiresIn=900)
    assert "AWSAccessKeyId=" in legacy and "X-Amz-Signature=" not in legacy
    signer = S3PresignSigner("c02-evidence")  # el cliente por defecto, como en producción
    spec = signer.presign_put("sites/dc-07/events/e-1/frame-0.jpg", "image/jpeg")
    assert "c02-evidence" in spec["url"] and "sites/dc-07/events/e-1/frame-0.jpg" in spec["url"]
    assert "X-Amz-Signature=" in spec["url"] and "X-Amz-Expires=900" in spec["url"]
    assert "content-type" in spec["url"].lower()  # el Content-Type va entre los headers firmados
