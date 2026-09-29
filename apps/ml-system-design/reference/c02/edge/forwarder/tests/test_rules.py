"""Tests del forwarder (caso c02) SIN DeepStream, MQTT, cámaras ni red.

El tiempo viene en cada mensaje (como en producción, del "@timestamp" de DeepStream) y el reloj de la
cola es un reloj falso: los tests de dwell, horarios, deduplicación y backoff son deterministas y
corren en milisegundos. El HTTP es httpx2.MockTransport: el mismo cliente real, con respuestas falsas.
Correr: cd edge/forwarder && pytest
"""

import json  # mensajes en el formato "minimal" de nvmsgconv
import random  # rng con semilla para el jitter
from concurrent.futures import Future  # el "executor inmediato" devuelve Futures ya resueltos
from datetime import datetime  # construir timestamps en hora local del sitio
from pathlib import Path

import httpx2  # MockTransport: HTTP falso con el cliente real
import pytest
import yaml
from zoneinfo import ZoneInfo

import app
from rules import (
    SiteConfig,
    SnapshotRequest,
    Window,
    ZoneEvent,
    ZoneRules,
    event_id_for,
    foot_point,
    parse_minimal_payload,
    point_in_polygon,
)

HERE = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("America/Mexico_City")
FPS = 5  # el stream de análisis: 5 frames por segundo por cámara
# Caja de una persona con el PIE en (0.5, 0.9) de la imagen: dentro de "perimetro-norte" de cam-01
PERSON_IN = "{tid}|930|700|990|972|person"


def cfg() -> SiteConfig:
    """La configuración de ejemplo REAL: si alguien la rompe, fallan los tests."""
    return SiteConfig.from_dict(yaml.safe_load((HERE / "site.example.yaml").read_text(encoding="utf-8")))


def ts_local(y, mo, d, h, mi=0, s=0.0) -> float:
    """Epoch de una hora LOCAL del sitio (así se leen los horarios)."""
    return datetime(y, mo, d, h, mi, tzinfo=TZ).timestamp() + s


# Miércoles 30-sep-2026 a las 22:00 en Ciudad de México: fuera de horario laboral (after_hours activo)
NIGHT = ts_local(2026, 9, 30, 22)
DAY = ts_local(2026, 9, 30, 14)  # miércoles 14:00: horario laboral, perímetro inactivo


def msg(camera: str, ts: float, objects: list[str]) -> bytes:
    """Un mensaje idéntico en forma al de nvmsgconv (payload-type=1, msg2p-newapi=1)."""
    ms = round(ts * 1000)  # DeepStream escribe milisegundos; round evita que 0.2 se vuelva 0.199
    iso = datetime.fromtimestamp(ms // 1000, ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S") + f".{ms % 1000:03d}Z"
    return json.dumps({"version": "4.0", "id": "1", "@timestamp": iso, "sensorId": camera, "objects": objects}).encode()


def run(rules: ZoneRules, camera: str, start: float, seconds: float, objects: list[str]) -> list:
    """Alimenta `seconds` de video a 5 fps con los mismos objetos en cada frame."""
    actions = []
    for k in range(int(seconds * FPS) + 1):
        actions += rules.process(parse_minimal_payload(msg(camera, start + k / FPS, objects)))
    return actions


def events(actions) -> list[ZoneEvent]:
    return [a for a in actions if isinstance(a, ZoneEvent)]


# ------------------------------------------------------------------------------ parseo del mensaje
def test_parse_minimal_payload_real_format():
    raw = msg("cam-01", NIGHT, [
        "9876543210123|930.5|700|990|972|person",  # 6 campos: el caso normal sin clasificador secundario
        "17|10|20|30|40|vehicle|#|forklift|0.91",  # con atributos de un SGIE: se ignoran
        "roto|x|y",  # objeto mal formado: se cuenta y se descarta, el frame sigue
    ])
    frame = parse_minimal_payload(raw)
    assert frame.camera_id == "cam-01"
    assert frame.ts == pytest.approx(NIGHT, abs=1e-3)  # el @timestamp tiene milisegundos
    assert [d.track_id for d in frame.detections] == ["9876543210123", "17"]
    assert frame.detections[0].left == 930.5 and frame.detections[1].label == "vehicle"
    assert frame.malformed == 1


def test_parse_rejects_message_without_camera():
    with pytest.raises(KeyError):  # sin sensorId no hay zonas que evaluar: app.py lo cuenta como roto
        parse_minimal_payload(json.dumps({"@timestamp": "2026-09-30T04:00:00.000Z", "objects": []}))


# ------------------------------------------------------------------------------ geometría
def test_point_in_polygon_convex_and_concave():
    square = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    assert point_in_polygon(0.5, 0.5, square) and not point_in_polygon(1.5, 0.5, square)
    ell = cfg().cameras["cam-02"].zones[0].polygon  # pasillo en L de site.example.yaml
    assert point_in_polygon(0.35, 0.50, ell)  # brazo vertical de la L
    assert point_in_polygon(0.70, 0.85, ell)  # brazo horizontal
    assert not point_in_polygon(0.70, 0.50, ell)  # la esquina "vacía" de la L: afuera


def test_foot_point_uses_bottom_center_not_box_center():
    c = cfg()
    zone = c.cameras["cam-01"].zones[0].polygon  # franja inferior de la imagen; su borde lejano, en y ≈ 0.585
    # Persona parada justo DENTRO del borde lejano: el pie (y ≈ 0.593) está dentro, pero el centro de su
    # caja (y ≈ 0.47) cae fuera. Con el centro, esta intrusión no existiría.
    det = parse_minimal_payload(msg("cam-01", NIGHT, ["1|930|380|990|640|person"])).detections[0]
    cx, cy = (det.left + det.right) / 2 / c.frame_w, (det.top + det.bottom) / 2 / c.frame_h
    assert not point_in_polygon(cx, cy, zone)
    assert point_in_polygon(*foot_point(det, c.frame_w, c.frame_h), zone)
    assert len(events(run(ZoneRules(c), "cam-01", NIGHT, 2.0, ["1|930|380|990|640|person"]))) == 1


# ------------------------------------------------------------------------------ dwell y fotos
def test_dwell_fires_once_after_1_5_s_and_asks_for_snapshots():
    rules = ZoneRules(cfg())
    actions = run(rules, "cam-01", NIGHT, 3.0, [PERSON_IN.format(tid=7)])
    evs = events(actions)
    assert len(evs) == 1
    ev = evs[0]
    # A 5 fps el primer frame con dwell ≥ 1.5 s es el de t0 + 1.6 s (1.4 aún no alcanza)
    assert ev.triggered_at - ev.first_seen_at == pytest.approx(1.6, abs=1e-3)
    assert (ev.camera_id, ev.zone_id, ev.track_id, ev.label) == ("cam-01", "perimetro-norte", "7", "person")
    snaps = [a for a in actions if isinstance(a, SnapshotRequest)]
    assert [s.index for s in snaps] == [0, 1]  # al entrar y a mitad del dwell (la 2 la toma app.py al disparar)
    assert actions.index(snaps[1]) < actions.index(ev)


def test_short_occlusion_keeps_dwell_but_leaving_resets_it():
    rules = ZoneRules(cfg())
    person = [PERSON_IN.format(tid=3)]
    # 0.0–0.6 s visible, 0.8–1.2 s ocluido (3 frames vacíos, < 1 s de gracia), 1.4 s en adelante visible
    acts = run(rules, "cam-01", NIGHT, 0.6, person)
    acts += run(rules, "cam-01", NIGHT + 0.8, 0.4, [])
    acts += run(rules, "cam-01", NIGHT + 1.4, 1.0, person)
    assert len(events(acts)) == 1
    assert events(acts)[0].first_seen_at == pytest.approx(NIGHT, abs=1e-3)  # la oclusión no reinició el reloj

    rules = ZoneRules(cfg())
    acts = run(rules, "cam-01", NIGHT, 1.0, person)
    acts += run(rules, "cam-01", NIGHT + 1.2, 1.2, [])  # 1.2 s sin verlo: salió
    acts += run(rules, "cam-01", NIGHT + 2.6, 1.0, person)  # vuelve: dwell desde cero
    assert events(acts) == []  # 1.0 s + 1.0 s nunca suman 1.5 s seguidos


def test_one_event_per_track_and_zone_then_a_reminder_after_10_min():
    rules = ZoneRules(cfg())
    person = [PERSON_IN.format(tid=11)]
    first = events(run(rules, "cam-01", NIGHT, 30.0, person))
    assert len(first) == 1  # 30 s dentro: una sola alerta, no una por frame
    later = events(run(rules, "cam-01", NIGHT + 30.2, 590.0, person))
    assert len(later) == 1 and later[0].event_id != first[0].event_id  # a los ≥ 600 s: recordatorio
    other = events(run(rules, "cam-01", NIGHT + 700, 2.0, [PERSON_IN.format(tid=12)]))
    assert len(other) == 1  # otro track, otra alerta


def test_class_filter_per_zone():
    rules = ZoneRules(cfg())
    # Pasillo de montacargas (solo "person"): un vehículo con el pie en (0.35, 0.60) no es infracción
    forklift = ["5|600|500|744|648|vehicle"]
    assert events(run(rules, "cam-02", DAY, 3.0, forklift)) == []
    walker = ["6|650|500|694|648|person"]
    assert len(events(run(rules, "cam-02", DAY, 3.0, walker))) == 1  # zona "always": también de día


def test_zone_specific_dwell_for_fire_lane():
    rules = ZoneRules(cfg())
    truck = ["8|1650|400|1800|900|vehicle"]  # pie en (0.89, 0.83): carril de bomberos, dwell de 60 s
    assert events(run(rules, "cam-02", DAY, 30.0, truck)) == []  # un camión que pasa no es alerta
    assert len(events(run(rules, "cam-02", DAY + 30.2, 40.0, truck))) == 1  # estacionado > 60 s: sí


# ------------------------------------------------------------------------------ horarios
@pytest.mark.parametrize(
    "when, active",
    [
        (ts_local(2026, 9, 30, 14), False),  # miércoles 14:00: el centro opera
        (ts_local(2026, 9, 30, 22), True),  # miércoles 22:00
        (ts_local(2026, 10, 1, 5, 59), True),  # jueves 05:59: sigue la ventana que empezó el miércoles
        (ts_local(2026, 10, 1, 6, 0), False),  # jueves 06:00: fin exacto, ya no
        (ts_local(2026, 10, 3, 14), True),  # sábado 14:00: fin de semana completo
        (ts_local(2026, 10, 5, 3), True),  # lunes 03:00: ventana nocturna del DOMINGO (la trampa)
    ],
)
def test_after_hours_schedule(when, active):
    rules = ZoneRules(cfg())
    assert bool(events(run(rules, "cam-01", when, 2.0, [PERSON_IN.format(tid=21)]))) is active


def test_overnight_window_belongs_to_the_day_it_starts():
    friday_night = Window(frozenset({4}), 20 * 60, 6 * 60)  # viernes 20:00 → sábado 06:00
    assert friday_night.contains(datetime(2026, 10, 3, 3, tzinfo=TZ))  # sábado 03:00: sí
    assert not friday_night.contains(datetime(2026, 10, 2, 3, tzinfo=TZ))  # viernes 03:00: no (eso es del jueves)
    # La trampa de site.example.yaml: noches solo de lunes a viernes dejan el lunes 00:00–06:00 sin vigilancia
    weeknights = Window(frozenset({0, 1, 2, 3, 4}), 20 * 60, 6 * 60)
    assert not weeknights.contains(datetime(2026, 10, 5, 3, tzinfo=TZ))


# ------------------------------------------------------------------------------ ids idempotentes
def test_event_id_is_deterministic_across_restarts():
    person = [PERSON_IN.format(tid=42)]
    first = events(run(ZoneRules(cfg()), "cam-01", NIGHT, 2.0, person))[0]
    # El forwarder se reinicia 20 s después y el MISMO track sigue ahí: vuelve a cumplir el dwell…
    again = events(run(ZoneRules(cfg()), "cam-01", NIGHT + 20, 2.0, person))[0]
    assert again.event_id == first.event_id  # …y sale el mismo id: la nube responde "duplicate"
    key = ("cam-01", "42", "perimetro-norte")
    assert event_id_for("dc-07", key, NIGHT + 601, 600) != first.event_id  # otra ventana, otro id
    assert event_id_for("dc-08", key, NIGHT + 2, 600) != first.event_id  # otro sitio, otro id


# ------------------------------------------------------------------------------ backoff
def test_backoff_full_jitter_bounds_and_cap():
    rng = random.Random(7)
    for attempt in range(15):
        ceiling = min(300.0, 2.0**attempt)
        samples = [app.backoff_delay(attempt, rng) for _ in range(200)]
        assert all(0.0 <= s <= ceiling for s in samples)
        # Usa TODO el rango [0, techo]: eso es lo que evita que las 25 cajas reintenten en el mismo segundo
        assert max(samples) > 0.7 * ceiling and min(samples) < 0.3 * ceiling
    assert max(app.backoff_delay(30, rng) for _ in range(200)) <= 300.0  # tope de 5 min


# ------------------------------------------------------------------------------ cola offline + envío
class FakeClock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class FakeCloud:
    """API + S3 falsos detrás de MockTransport. `down` = cuántos requests más fallan por red."""

    def __init__(self):
        self.down = 0
        self.log: list[str] = []
        self.events: dict[str, dict] = {}
        self.upload_status = 200
        self.event_status = 202

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        if self.down > 0:
            self.down -= 1
            raise httpx2.ConnectError("sin red", request=request)
        path = request.url.path
        self.log.append(f"{request.method} {request.url.host}{path}")
        if request.url.host == "api.test":
            assert request.headers["authorization"] == "Bearer secreto-del-sitio"
        else:
            assert "authorization" not in request.headers  # a S3 NUNCA va el token del sitio
        if path == "/v1/uploads":
            body = json.loads(request.content)
            key = f"sites/dc-07/events/{body['event_id']}/{body['kind']}-{body['index']}"
            return httpx2.Response(200, json={"url": f"https://s3.test/{key}?X-Amz-Signature=x", "key": key,
                                              "headers": {"Content-Type": body["content_type"]}})
        if request.url.host == "s3.test":
            return httpx2.Response(self.upload_status)
        if path == "/v1/events":
            if self.event_status != 202:
                return httpx2.Response(self.event_status, json={"detail": "inválido"})
            body = json.loads(request.content)
            status = "duplicate" if body["event_id"] in self.events else "accepted"
            self.events[body["event_id"]] = body
            return httpx2.Response(202, json={"event_id": body["event_id"], "status": status})
        return httpx2.Response(404)


@pytest.fixture
def cloud_env(tmp_path):
    clock = FakeClock()
    cloud = FakeCloud()
    outbox = app.Outbox(str(tmp_path / "outbox.sqlite3"), clock=clock)
    api = app.ApiClient("https://api.test", "secreto-del-sitio", transport=httpx2.MockTransport(cloud.handler))
    sender = app.Sender(outbox, api, clock=clock, rng=random.Random(1))
    return clock, cloud, outbox, sender, tmp_path


def queue_event(outbox: app.Outbox, folder: Path, event_id: str = "e-1", frames: int = 3) -> list[str]:
    files = []
    for i in range(frames):
        f = folder / event_id / f"frame-{i}.jpg"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\xff\xd8 foto")
        files.append(str(f))
    outbox.put(event_id, "event", {"event_id": event_id, "camera_id": "cam-01"}, files)
    return files


def drain(sender: app.Sender, clock: FakeClock, max_steps: int = 200) -> None:
    """Corre el sender avanzando el reloj falso hasta que no queda nada (o se acaban los pasos)."""
    for _ in range(max_steps):
        if not sender.run_once():
            if sender.outbox.stats()["pending"] == 0:
                return
            clock.advance(5.0)


def test_offline_queue_retries_with_backoff_and_flushes_in_order(cloud_env):
    clock, cloud, outbox, sender, tmp = cloud_env
    files = queue_event(outbox, tmp, "e-1")
    clip = tmp / "clip.mp4"
    clip.write_bytes(b"mp4")
    outbox.put("e-1:clip", "clip", {"event_id": "e-1"}, [str(clip)])
    cloud.down = 3  # la subida del sitio está caída: 3 intentos fallan por red
    for _ in range(3):
        assert sender.run_once()
        stats = outbox.stats()
        assert stats["pending"] == 2  # nada se pierde mientras no hay red
        clock.advance(sender.pause_until - clock() + 0.01)  # respeta la pausa global y el backoff
        clock.advance(300)  # y deja vencer el backoff del ítem
    drain(sender, clock)
    assert outbox.stats()["pending"] == 0 and cloud.events["e-1"]["frames"][0].endswith("frame-0")
    # Orden: las 3 fotos (pedir URL + PUT a S3) ANTES del evento, y el clip al final (prioridad baja)
    posts = [line for line in cloud.log if "/v1/events" in line or "clip" in line]
    assert posts[0].startswith("POST api.test/v1/events") and "clip" in posts[-1]
    assert cloud.log.index("POST api.test/v1/events") > max(i for i, l in enumerate(cloud.log) if "frame-2" in l)
    assert not any(Path(f).exists() for f in files)  # lo enviado se borra del disco de la caja


def test_events_jump_ahead_of_older_clips(cloud_env):
    clock, cloud, outbox, sender, tmp = cloud_env
    clip = tmp / "old.mp4"
    clip.write_bytes(b"mp4")
    outbox.put("e-0:clip", "clip", {"event_id": "e-0"}, [str(clip)])  # un clip de hace un minuto…
    clock.advance(60)
    queue_event(outbox, tmp, "e-5")  # …y una intrusión nueva: sale PRIMERO aunque sea más reciente
    clock.advance(1)
    queue_event(outbox, tmp, "e-6")  # entre eventos, el más viejo primero (FIFO)
    assert outbox.next_due().item_id == "e-5"
    drain(sender, clock)
    assert cloud.log.index("POST api.test/v1/events") < next(i for i, l in enumerate(cloud.log) if "clip" in l)
    assert list(cloud.events) == ["e-5", "e-6"]


def test_outbox_is_idempotent_and_survives_a_restart(tmp_path):
    clock = FakeClock()
    box = app.Outbox(str(tmp_path / "q.sqlite3"), clock=clock)
    assert box.put("e-9", "event", {"event_id": "e-9"}, []) is True
    assert box.put("e-9", "event", {"event_id": "e-9"}, []) is False  # el mismo evento no se duplica
    reopened = app.Outbox(str(tmp_path / "q.sqlite3"), clock=clock)  # "reinicio" del contenedor
    assert reopened.stats()["pending"] == 1 and reopened.next_due().item_id == "e-9"


def test_duplicate_response_counts_as_delivered(cloud_env):
    clock, cloud, outbox, sender, tmp = cloud_env
    cloud.events["e-2"] = {"event_id": "e-2"}  # la nube ya lo tenía (p. ej. se perdió el 202 del intento anterior)
    queue_event(outbox, tmp, "e-2")
    drain(sender, clock)
    assert outbox.stats() == {"pending": 0, "oldest_age_s": 0.0, "dead_letters": 0}


def test_permanent_error_goes_to_dead_letter_instead_of_retrying_forever(cloud_env):
    clock, cloud, outbox, sender, tmp = cloud_env
    cloud.event_status = 422  # el contrato cambió y la API rechaza el cuerpo: reintentar no lo arregla
    queue_event(outbox, tmp, "e-3")
    drain(sender, clock)
    assert outbox.stats()["pending"] == 0 and outbox.stats()["dead_letters"] == 1


def test_event_goes_out_without_photos_if_uploads_keep_failing(cloud_env):
    clock, cloud, outbox, sender, tmp = cloud_env
    cloud.upload_status = 503  # S3 falla, la API responde
    queue_event(outbox, tmp, "e-4")
    drain(sender, clock)
    sent = cloud.events["e-4"]
    assert sent["frames"] == [] and sent["evidence_missing"] is True  # mejor una alerta sin fotos que ninguna


# ------------------------------------------------------------------------------ forwarder completo
class ImmediatePool:
    """Executor que corre la tarea en el acto: el test no depende de hilos ni de tiempos."""

    def submit(self, fn, *args):
        fut = Future()
        fut.set_result(fn(*args))
        return fut


class FakeEvidence:
    def __init__(self):
        self.snapshots = 0

    def snapshot(self, camera_id):
        self.snapshots += 1
        return b"\xff\xd8" + camera_id.encode()

    def record_clip(self, camera_id, dest):
        dest.write_bytes(b"mp4")
        return True


def test_forwarder_end_to_end_with_fakes(tmp_path):
    clock = FakeClock(NIGHT)
    c = cfg()
    outbox = app.Outbox(str(tmp_path / "q.sqlite3"), clock=clock)
    fwd = app.Forwarder(c, outbox, FakeEvidence(), tmp_path / "spool", ImmediatePool(), ImmediatePool(), clock=clock)
    for k in range(10):  # 2 s de una persona en el perímetro de cam-01, a 5 fps
        fwd.on_message(msg("cam-01", NIGHT + k / FPS, [PERSON_IN.format(tid=77)]))
    fwd.on_message(b"{no es json")  # un mensaje roto no tumba nada: se cuenta
    fwd.on_message(msg("cam-99", NIGHT, []))  # cámara que no está en site.yaml
    event = outbox.next_due()
    assert event.kind == "event" and len(event.files) == 3  # entrada, mitad del dwell y disparo
    assert event.payload["zone_id"] == "perimetro-norte" and event.payload["model_version"] == app.MODEL_VERSION
    assert outbox.stats()["pending"] == 2  # evento + clip
    assert fwd.counters == {"malformed_messages": 1, "unknown_camera_messages": 1}
    clock.advance(2.0)
    fps = fwd.camera_fps()
    assert fps["cam-01"] == pytest.approx(5.0) and fps["cam-02"] == 0.0  # la cámara muda se reporta en 0
