"""Tests del forwarder (caso c02) SIN DeepStream, MQTT, cámaras ni red.

El tiempo viene en cada mensaje (como en producción, del "@timestamp" de DeepStream) y el reloj de la
cola es un reloj falso: los tests de dwell, horarios, deduplicación y backoff son deterministas y
corren en milisegundos. El HTTP es httpx2.MockTransport: el mismo cliente real, con respuestas falsas.
Correr: cd edge/forwarder && pytest
"""

import json  # mensajes en el formato "minimal" de nvmsgconv
import os  # PATH con un ffmpeg falso
import random  # rng con semilla para el jitter
import threading  # el carril de clips corre en otro hilo, como en producción
import time  # medir que el apagado no espera al clip
from concurrent.futures import Future  # el "executor inmediato" devuelve Futures ya resueltos
from datetime import datetime  # construir timestamps en hora local del sitio
from pathlib import Path
from urllib.parse import unquote, urlsplit

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


def test_only_the_first_alert_of_an_intrusion_counts_for_the_slo():
    rules = ZoneRules(cfg())
    person = [PERSON_IN.format(tid=31)]
    first = events(run(rules, "cam-01", NIGHT, 2.0, person))[0]
    assert first.slo is True and first.to_payload([], "m", "f")["slo"] is True
    # Recordatorio: mismo track 10 min después. Mediría ≥ 600 s "de latencia": fuera del SLO
    reminder = events(run(rules, "cam-01", NIGHT + 2.2, 600.0, person))
    assert len(reminder) == 1 and reminder[0].slo is False
    # Carril de bomberos (dwell propio de 60 s): una infracción, no una intrusión
    truck = events(run(ZoneRules(cfg()), "cam-02", DAY, 61.0, ["8|1650|400|1800|900|vehicle"]))
    assert len(truck) == 1 and truck[0].slo is False
    # Sale y vuelve antes de 10 min: su evento sale tarde A PROPÓSITO (dedupe), tampoco cuenta
    rules = ZoneRules(cfg())
    assert events(run(rules, "cam-01", NIGHT, 2.0, person))[0].slo is True
    run(rules, "cam-01", NIGHT + 2.2, 2.0, [])  # 2 s fuera: la presencia termina
    back = events(run(rules, "cam-01", NIGHT + 100, 505.0, person))
    assert len(back) == 1 and back[0].slo is False


def test_event_box_is_clipped_to_0_1():
    # Una caja que asoma unos píxeles fuera del frame: sin recortar, la API respondería 422 (box en [0, 1])
    ev = events(run(ZoneRules(cfg()), "cam-01", NIGHT, 2.0, ["4|-4|700|1925|1000|person"]))[0]
    assert ev.box[0] == 0.0 and ev.box[2] == 1.0
    assert all(0.0 <= v <= 1.0 for v in ev.to_payload([], "m", "f")["box"])


# ------------------------------------------------------------------------------ validación de site.yaml
def raw_cfg() -> dict:
    return yaml.safe_load((HERE / "site.example.yaml").read_text(encoding="utf-8"))


def _typo_class(raw):
    raw["cameras"]["cam-01"]["zones"][0]["classes"] = ["persons"]  # nunca dispararía: recall perdido


def _typo_schedule_key(raw):
    zone = raw["cameras"]["cam-01"]["zones"][0]
    zone["shedule"] = zone.pop("schedule")  # se ignoraría: zona activa SIEMPRE (falsas alarmas de día)


def _typo_camera_key(raw):
    raw["cameras"]["cam-01"]["snapshot_uri"] = raw["cameras"]["cam-01"].pop("snapshot_url")


def _typo_site_key(raw):
    raw["dwell_second"] = 3


def _typo_window_key(raw):
    raw["schedules"]["after_hours"][0]["strat"] = raw["schedules"]["after_hours"][0].pop("start")


def _empty_days(raw):
    raw["schedules"]["after_hours"][0]["days"] = []  # una ventana que nunca se activa


@pytest.mark.parametrize("break_it", [_typo_class, _typo_schedule_key, _typo_camera_key, _typo_site_key,
                                      _typo_window_key, _empty_days])
def test_site_config_rejects_typos_that_yaml_accepts(break_it):
    raw = raw_cfg()
    break_it(raw)
    with pytest.raises((ValueError, KeyError)):
        SiteConfig.from_dict(raw)


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
        self.clip_status = 200
        self.event_status = 202
        self.block_clip: threading.Event | None = None  # si existe, el PUT del clip espera a que se active
        self.clip_started = threading.Event()

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
            if "clip" in path:
                self.clip_started.set()
                if self.block_clip is not None:
                    self.block_clip.wait(5)
                return httpx2.Response(self.clip_status)
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
    # Dos carriles, como main(): uno vacía eventos y el otro clips, cada uno con su pausa y su backoff
    lanes = (app.Sender(outbox, api, "event", clock=clock, rng=random.Random(1)),
             app.Sender(outbox, api, "clip", clock=clock, rng=random.Random(2)))
    return clock, cloud, outbox, lanes, tmp_path


def queue_event(outbox: app.Outbox, folder: Path, event_id: str = "e-1", frames: int = 3) -> list[str]:
    files = []
    for i in range(frames):
        f = folder / event_id / f"frame-{i}.jpg"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\xff\xd8 foto")
        files.append(str(f))
    outbox.put(event_id, "event", {"event_id": event_id, "camera_id": "cam-01"}, files)
    return files


def drain(lanes, clock: FakeClock, max_steps: int = 200) -> None:
    """Corre los dos carriles avanzando el reloj falso hasta que no queda nada (o se acaban los pasos)."""
    for _ in range(max_steps):
        if not any([lane.run_once() for lane in lanes]):
            if lanes[0].outbox.stats()["pending"] == 0:
                return
            clock.advance(5.0)


def test_offline_queue_retries_with_backoff_and_flushes_in_order(cloud_env):
    clock, cloud, outbox, (events_lane, clips_lane), tmp = cloud_env
    files = queue_event(outbox, tmp, "e-1")
    clip = tmp / "clip.mp4"
    clip.write_bytes(b"mp4")
    outbox.put("e-1:clip", "clip", {"event_id": "e-1"}, [str(clip)])
    cloud.down = 3  # la subida del sitio está caída: 3 intentos fallan por red
    for _ in range(3):
        assert events_lane.run_once()
        stats = outbox.stats()
        assert stats["pending"] == 2  # nada se pierde mientras no hay red
        clock.advance(events_lane.pause_until - clock() + 0.01)  # respeta la pausa del carril y el backoff
        clock.advance(300)  # y deja vencer el backoff del ítem
    drain((events_lane, clips_lane), clock)
    assert outbox.stats()["pending"] == 0 and cloud.events["e-1"]["frames"][0].endswith("frame-0")
    # Las 3 fotos (pedir URL + PUT a S3) van ANTES del POST del evento; el clip sale por su carril
    assert cloud.log.index("POST api.test/v1/events") > max(i for i, l in enumerate(cloud.log) if "frame-2" in l)
    assert any("clip" in line for line in cloud.log)
    assert not any(Path(f).exists() for f in files)  # lo enviado se borra del disco de la caja


def test_events_leave_in_order_and_ignore_the_clip_lane(cloud_env):
    clock, cloud, outbox, (events_lane, clips_lane), tmp = cloud_env
    clip = tmp / "old.mp4"
    clip.write_bytes(b"mp4")
    outbox.put("e-0:clip", "clip", {"event_id": "e-0"}, [str(clip)])  # un clip de hace un minuto…
    clock.advance(60)
    queue_event(outbox, tmp, "e-5")  # …y una intrusión nueva
    clock.advance(1)
    queue_event(outbox, tmp, "e-6")  # entre eventos, el más viejo primero (FIFO)
    assert outbox.next_due("event").item_id == "e-5" and outbox.next_due("clip").item_id == "e-0:clip"
    while events_lane.run_once():  # el carril de eventos no toca el clip…
        pass
    assert list(cloud.events) == ["e-5", "e-6"] and not any("clip" in line for line in cloud.log)
    assert outbox.stats()["pending"] == 1  # …que sigue esperando a SU carril
    drain((events_lane, clips_lane), clock)
    assert outbox.stats()["pending"] == 0


def test_a_clip_upload_in_flight_never_delays_an_event(cloud_env):
    """Con un solo sender, un evento que llega mientras sube un clip de 5 MB (2–4 s) esperaría."""
    clock, cloud, outbox, (events_lane, clips_lane), tmp = cloud_env
    cloud.block_clip = threading.Event()  # el PUT del clip se queda "subiendo" hasta que lo soltemos
    cloud.clip_started = threading.Event()
    clip = tmp / "c.mp4"
    clip.write_bytes(b"mp4")
    outbox.put("e-7:clip", "clip", {"event_id": "e-7"}, [str(clip)])
    worker = threading.Thread(target=clips_lane.run_once)
    worker.start()
    assert cloud.clip_started.wait(5)  # el clip está a medio subir…
    queue_event(outbox, tmp, "e-8")  # …y llega una intrusión
    assert events_lane.run_once() and "e-8" in cloud.events  # sale YA, sin esperar al clip
    cloud.block_clip.set()
    worker.join(5)
    assert outbox.stats()["pending"] == 0


def test_a_failing_clip_does_not_pause_events(cloud_env):
    clock, cloud, outbox, (events_lane, clips_lane), tmp = cloud_env
    cloud.clip_status = 503  # S3 rechaza el clip
    clip = tmp / "c.mp4"
    clip.write_bytes(b"mp4")
    item = outbox.put("e-9:clip", "clip", {"event_id": "e-9"}, [str(clip)])
    assert item and clips_lane.run_once() and clips_lane.pause_until > clock()  # el carril de clips se pausa…
    queue_event(outbox, tmp, "e-10")
    assert events_lane.pause_until == 0.0 and events_lane.run_once()  # …el de eventos, no
    assert "e-10" in cloud.events


def test_outbox_is_idempotent_and_survives_a_restart(tmp_path):
    clock = FakeClock()
    box = app.Outbox(str(tmp_path / "q.sqlite3"), clock=clock)
    assert box.put("e-9", "event", {"event_id": "e-9"}, []) is True
    assert box.put("e-9", "event", {"event_id": "e-9"}, []) is False  # el mismo evento no se duplica
    reopened = app.Outbox(str(tmp_path / "q.sqlite3"), clock=clock)  # "reinicio" del contenedor
    assert reopened.stats()["pending"] == 1 and reopened.next_due().item_id == "e-9"


def test_duplicate_response_counts_as_delivered(cloud_env):
    clock, cloud, outbox, lanes, tmp = cloud_env
    cloud.events["e-2"] = {"event_id": "e-2"}  # la nube ya lo tenía (p. ej. se perdió el 202 del intento anterior)
    queue_event(outbox, tmp, "e-2")
    drain(lanes, clock)
    assert outbox.stats() == {"pending": 0, "oldest_age_s": 0.0, "oldest_event_age_s": 0.0,
                              "dead_letters": 0, "dead_letter_events": 0}


def test_permanent_error_goes_to_dead_letter_instead_of_retrying_forever(cloud_env):
    clock, cloud, outbox, lanes, tmp = cloud_env
    cloud.event_status = 422  # el contrato cambió y la API rechaza el cuerpo: reintentar no lo arregla
    queue_event(outbox, tmp, "e-3")
    drain(lanes, clock)
    # Apartado pero VISIBLE: el heartbeat lleva dead_letter_events y la nube alerta (EdgeEventsStuck)
    assert outbox.stats()["pending"] == 0 and outbox.stats()["dead_letter_events"] == 1


@pytest.mark.parametrize("status", [401, 403])
def test_auth_errors_wait_in_the_queue_instead_of_dead_letter(cloud_env, status):
    clock, cloud, outbox, lanes, tmp = cloud_env
    cloud.event_status = status  # Secret de tokens roto o site.yaml de otro sitio: lo arregla un operador
    queue_event(outbox, tmp, "e-11")
    drain(lanes, clock, max_steps=20)
    stats = outbox.stats()
    assert stats["pending"] == 1 and stats["dead_letters"] == 0  # el evento espera…
    assert stats["oldest_event_age_s"] > 60  # …y su edad es lo que ve EdgeEventsStuck
    cloud.event_status = 202  # arreglado: sale solo, con sus fotos
    clock.advance(301)
    drain(lanes, clock)
    assert cloud.events["e-11"]["frames"] and outbox.stats()["pending"] == 0


def test_stats_separate_events_from_clips(tmp_path):
    clock = FakeClock()
    box = app.Outbox(str(tmp_path / "q.sqlite3"), clock=clock)
    box.put("e-1:clip", "clip", {"event_id": "e-1"}, [])
    clock.advance(100)
    box.put("e-2", "event", {"event_id": "e-2"}, [])
    clock.advance(20)
    stats = box.stats()
    assert stats["oldest_age_s"] == 120.0 and stats["oldest_event_age_s"] == 20.0  # un clip viejo no es urgente


def test_event_goes_out_without_photos_if_uploads_keep_failing(cloud_env):
    clock, cloud, outbox, lanes, tmp = cloud_env
    cloud.upload_status = 503  # S3 falla, la API responde
    queue_event(outbox, tmp, "e-4")
    drain(lanes, clock)
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
    assert event.payload["slo"] is True
    assert outbox.stats()["pending"] == 2  # evento + clip
    assert fwd.counters == {"malformed_messages": 1, "unknown_camera_messages": 1}
    clock.advance(2.0)
    fps = fwd.camera_fps()
    assert fps["cam-01"] == pytest.approx(5.0) and fps["cam-02"] == 0.0  # la cámara muda se reporta en 0


def test_on_message_never_raises_into_the_mqtt_thread(tmp_path, monkeypatch):
    # paho re-lanza la excepción de on_message y su hilo de red muere: el sitio quedaría ciego con la caja "viva"
    clock = FakeClock(NIGHT)
    outbox = app.Outbox(str(tmp_path / "q.sqlite3"), clock=clock)
    fwd = app.Forwarder(cfg(), outbox, FakeEvidence(), tmp_path / "spool", ImmediatePool(), ImmediatePool(), clock=clock)
    fwd.on_message(b"[1,2]")  # JSON válido que no es un mensaje: se cuenta como roto
    real_process = fwd.rules.process

    def buggy(frame):  # un bug cualquiera en las reglas
        raise RuntimeError("bug")

    monkeypatch.setattr(fwd.rules, "process", buggy)
    fwd.on_message(msg("cam-01", NIGHT, []))  # no lanza
    monkeypatch.setattr(fwd.rules, "process", real_process)
    for k in range(10):  # y los mensajes siguientes se procesan normal
        fwd.on_message(msg("cam-01", NIGHT + k / FPS, [PERSON_IN.format(tid=78)]))
    assert fwd.counters["malformed_messages"] == 1 and fwd.counters["on_message_errors"] == 1
    assert outbox.next_due("event") is not None


def test_rtsp_credentials_are_percent_encoded():
    password = "Ab#20:26/x@"  # sin codificar, el '#' cortaría la clave en "Ab"
    url = app.rtsp_with_auth("rtsp://10.20.1.11:554/stream1", "forwarder", password)
    parts = urlsplit(url)
    assert parts.hostname == "10.20.1.11" and parts.port == 554 and parts.path == "/stream1"
    assert unquote(parts.username) == "forwarder" and unquote(parts.password) == password


def test_shutdown_terminates_a_running_clip(tmp_path, monkeypatch):
    # ffmpeg falso que "graba" 30 s: sin stop_clips el apagado esperaría hasta el SIGKILL de Docker
    fake = tmp_path / "bin" / "ffmpeg"
    fake.parent.mkdir()
    fake.write_text("#!/bin/sh\nexec sleep 30\n")
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fake.parent}{os.pathsep}{os.environ['PATH']}")
    evidence = app.Evidence(cfg(), "forwarder", "clave", http=httpx2.Client(transport=httpx2.MockTransport(lambda r: httpx2.Response(404))))
    result = {}
    worker = threading.Thread(target=lambda: result.update(ok=evidence.record_clip("cam-01", tmp_path / "c.mp4")))
    worker.start()
    for _ in range(100):  # espera a que ffmpeg arranque
        if evidence._clips:
            break
        threading.Event().wait(0.05)
    evidence.stop_clips()
    worker.join(5)
    assert not worker.is_alive() and result["ok"] is False  # terminó en segundos y cuenta como clip fallido
    t0 = time.monotonic()
    assert evidence.record_clip("cam-01", tmp_path / "d.mp4") is False  # apagando: no arranca clips nuevos…
    assert time.monotonic() - t0 < 2  # …ni espera a uno
