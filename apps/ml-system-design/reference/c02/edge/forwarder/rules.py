"""Reglas de zona del forwarder (caso c02): lógica PURA, sin red, sin disco y sin reloj propio.

DeepStream solo percibe: por cada frame manda las cajas con su id de track. Aquí se decide qué es una
intrusión: la caja de una clase permitida tiene el PIE dentro del polígono de una zona activa según su
horario, durante al menos `dwell_s` segundos, y se avisa una sola vez por track y zona cada `dedupe_s`.
Por qué separado de app.py: todo lo que decide una alerta se prueba con tests rápidos y deterministas
(el tiempo viene en cada frame), sin MQTT, sin HTTP y sin cámaras.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import json  # el mensaje de DeepStream (esquema "minimal") es JSON
import math  # floor para la ventana de deduplicación
import uuid  # uuid5: id de evento determinista (idempotencia de punta a punta)
from dataclasses import dataclass, field  # estructuras simples, inmutables donde se puede
from datetime import datetime  # hora local del sitio para los horarios de cada zona
from zoneinfo import ZoneInfo  # zonas horarias IANA (incluye cambios de horario de verano)

# Namespace FIJO del caso: uuid5(namespace, nombre) da siempre el mismo id para el mismo nombre.
# Cambiarlo cambiaría todos los ids y rompería la deduplicación con eventos ya enviados.
EVENT_NAMESPACE = uuid.UUID("0233d5c2-d53f-4bf4-bf39-0aa8e8f37d36")

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")  # índice = datetime.weekday()


# ------------------------------------------------------------------------------ mensajes de DeepStream
@dataclass(frozen=True)
class Detection:
    """Una caja ya trackeada, en píxeles de la salida del streammux (1920×1080 en este caso)."""

    track_id: str  # texto: con useUniqueID los ids son de 64 bits y así no dependemos de su tamaño
    label: str  # "person" | "vehicle" (labels.txt del detector)
    left: float
    top: float
    right: float
    bottom: float


@dataclass(frozen=True)
class Frame:
    """Todo lo que DeepStream vio en un frame de UNA cámara."""

    camera_id: str  # "sensorId" del mensaje = id de [sensorN] en msgconv_config.txt
    ts: float  # epoch UTC en segundos del "@timestamp" (reloj de la caja, sincronizado por NTP)
    detections: tuple[Detection, ...]
    malformed: int = 0  # objetos que no se pudieron leer (se cuentan, no tumban el frame)


def parse_rfc3339(value: str) -> float:
    """'2026-09-29T03:12:45.200Z' → epoch en segundos. fromisoformat acepta la Z desde Python 3.11."""
    return datetime.fromisoformat(value).timestamp()


def parse_minimal_payload(raw: bytes | str) -> Frame:
    """Lee el esquema "minimal" de nvmsgconv (DeepStream 9.1, msg2p-newapi=1):

    {"version": "4.0", "id": "<frame_num>", "@timestamp": "…Z", "sensorId": "cam-01",
     "objects": ["<track_id>|<left>|<top>|<right>|<bottom>|<label>", …]}

    Si hubiera un clasificador secundario, cada objeto trae además "|#|<atributos>|<confianza>": se ignora.
    Un JSON inválido lanza ValueError/KeyError (el llamador lo cuenta); un objeto roto solo se descarta.
    """
    msg = json.loads(raw)
    detections: list[Detection] = []
    malformed = 0
    for item in msg.get("objects", []):  # frame sin objetos = lista vacía: también es información
        parts = str(item).split("|")
        if len(parts) < 6:  # necesitamos id, 4 coordenadas y la etiqueta
            malformed += 1
            continue
        try:
            left, top, right, bottom = (float(p) for p in parts[1:5])
        except ValueError:
            malformed += 1
            continue
        detections.append(Detection(parts[0], parts[5], left, top, right, bottom))
    return Frame(
        camera_id=str(msg["sensorId"]),  # KeyError si falta: sin cámara no hay zona que evaluar
        ts=parse_rfc3339(msg["@timestamp"]),
        detections=tuple(detections),
        malformed=malformed,
    )


# ------------------------------------------------------------------------------ geometría
def point_in_polygon(x: float, y: float, polygon: tuple[tuple[float, float], ...]) -> bool:
    """Ray casting (par/impar): cuenta cuántas aristas cruza un rayo horizontal desde el punto.

    Funciona con polígonos cóncavos (un pasillo en L). Un punto EXACTAMENTE sobre una arista puede caer
    de cualquier lado: no importa, el dwell y la tolerancia de salida absorben ese jitter.
    """
    inside = False
    j = len(polygon) - 1  # la arista i va del vértice j (anterior) al i
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        if (yi > y) != (yj > y):  # la arista cruza la altura del punto (y nunca es horizontal aquí)
            x_cross = xi + (y - yi) * (xj - xi) / (yj - yi)  # dónde la cruza
            if x < x_cross:  # el cruce está a la derecha del punto → el rayo la atraviesa
                inside = not inside
        j = i
    return inside


def foot_point(det: Detection, frame_w: int, frame_h: int) -> tuple[float, float]:
    """Centro del borde INFERIOR de la caja, normalizado a 0–1.

    Por qué el pie y no el centro: la zona está pintada en el PISO y la cámara la ve en perspectiva.
    Con el centro de la caja fallas en los dos sentidos: alguien parado fuera, delante de una zona
    lejana, "entra" con el torso; alguien dentro, junto al borde lejano, "sale" porque su centro queda
    arriba de ese borde (lo prueba test_foot_point_uses_bottom_center_not_box_center).
    """
    return ((det.left + det.right) / 2 / frame_w, det.bottom / frame_h)


# ------------------------------------------------------------------------------ configuración
@dataclass(frozen=True)
class Window:
    """Ventana semanal de un horario, en hora LOCAL del sitio. Puede cruzar la medianoche."""

    days: frozenset[int]  # días en que EMPIEZA la ventana (0 = lunes)
    start_min: int  # minutos desde medianoche
    end_min: int  # 1440 = "24:00"

    def contains(self, local: datetime) -> bool:
        minute = local.hour * 60 + local.minute
        weekday = local.weekday()
        if self.start_min < self.end_min:  # dentro del mismo día (p. ej. sábado 00:00–24:00)
            return weekday in self.days and self.start_min <= minute < self.end_min
        # Cruza medianoche (20:00–06:00): el lunes a las 03:00 pertenece a la ventana del DOMINGO
        return (weekday in self.days and minute >= self.start_min) or (
            (weekday - 1) % 7 in self.days and minute < self.end_min
        )


@dataclass(frozen=True)
class Zone:
    zone_id: str
    polygon: tuple[tuple[float, float], ...]  # vértices normalizados 0–1 (independiente de la resolución)
    classes: frozenset[str]  # clases que disparan en esta zona
    windows: tuple[Window, ...] | None  # None = siempre activa (carril de bomberos, pasillo de montacargas)
    dwell_s: float | None = None  # dwell propio de la zona; None = el del sitio (1.5 s)

    def active(self, local: datetime) -> bool:
        return self.windows is None or any(w.contains(local) for w in self.windows)


@dataclass(frozen=True)
class Camera:
    camera_id: str
    zones: tuple[Zone, ...]
    snapshot_url: str | None = None  # JPEG del stream principal (ONVIF: GetSnapshotUri)
    rtsp_main_url: str | None = None  # stream principal 15 fps: de aquí sale el clip de evidencia


@dataclass(frozen=True)
class SiteConfig:
    site_id: str
    tz: ZoneInfo
    frame_w: int  # = width/height del [streammux]: las cajas llegan en esas coordenadas
    frame_h: int
    cameras: dict[str, Camera]
    dwell_s: float = 1.5  # tiempo mínimo dentro de la zona antes de avisar (debounce)
    dedupe_s: float = 600.0  # un evento por track y zona cada 10 min
    exit_grace_s: float = 1.0  # ausencia tolerada (frames perdidos, oclusión corta) antes de "salió"

    @classmethod
    def from_dict(cls, raw: dict) -> SiteConfig:
        """Valida site.yaml al arrancar: una zona mal escrita debe fallar aquí, no a las 3 a. m."""
        schedules: dict[str, tuple[Window, ...] | None] = {"always": None}
        for name, windows in (raw.get("schedules") or {}).items():
            parsed = []
            for w in windows:
                days = frozenset(DAYS.index(d) for d in w["days"])  # ValueError si hay un día mal escrito
                start, end = _minutes(w["start"]), _minutes(w["end"])
                if start == end:
                    raise ValueError(f"horario {name}: inicio y fin iguales ({w['start']})")
                parsed.append(Window(days, start, end))
            schedules[name] = tuple(parsed)
        cameras = {}
        for cam_id, cam in raw["cameras"].items():
            zones = []
            for z in cam.get("zones", []):
                poly = tuple((float(x), float(y)) for x, y in z["polygon"])
                if len(poly) < 3 or not all(0 <= v <= 1 for p in poly for v in p):
                    raise ValueError(f"{cam_id}/{z['id']}: polígono con < 3 vértices o fuera de 0–1")
                if z.get("schedule", "always") not in schedules:
                    raise ValueError(f"{cam_id}/{z['id']}: horario desconocido {z.get('schedule')!r}")
                dwell = float(z["dwell_seconds"]) if "dwell_seconds" in z else None
                zones.append(Zone(z["id"], poly, frozenset(z["classes"]), schedules[z.get("schedule", "always")], dwell))
            cameras[cam_id] = Camera(cam_id, tuple(zones), cam.get("snapshot_url"), cam.get("rtsp_main_url"))
        return cls(
            site_id=raw["site_id"],
            tz=ZoneInfo(raw["timezone"]),  # ZoneInfoNotFoundError si la zona horaria no existe
            frame_w=int(raw["frame_width"]),
            frame_h=int(raw["frame_height"]),
            cameras=cameras,
            dwell_s=float(raw.get("dwell_seconds", 1.5)),
            dedupe_s=float(raw.get("dedupe_seconds", 600)),
            exit_grace_s=float(raw.get("exit_grace_seconds", 1.0)),
        )


def _minutes(hhmm: str) -> int:
    hours, minutes = (int(p) for p in hhmm.split(":"))
    if not (0 <= hours <= 24 and 0 <= minutes < 60) or hours * 60 + minutes > 1440:
        raise ValueError(f"hora inválida {hhmm!r}")
    return hours * 60 + minutes


# ------------------------------------------------------------------------------ salida de las reglas
Key = tuple[str, str, str]  # (camera_id, track_id, zone_id): la unidad de dwell y de deduplicación


@dataclass(frozen=True)
class SnapshotRequest:
    """Pide una foto del stream principal YA, mientras la persona está ahí.

    index 0 = al entrar, 1 = a mitad del dwell; la 2 la toma app.py al disparar. Así las 3 fotos que
    usa el verificador cubren todo el dwell SIN sumar tiempo a la alerta.
    """

    key: Key
    camera_id: str
    index: int


@dataclass(frozen=True)
class ZoneEvent:
    event_id: str
    key: Key
    site_id: str
    camera_id: str
    zone_id: str
    track_id: str
    label: str
    first_seen_at: float  # cuándo el pie entró a la zona: t0 del SLO de 5 s
    triggered_at: float  # cuándo se cumplió el dwell
    box: tuple[float, float, float, float]  # caja normalizada 0–1 al disparar

    def to_payload(self, frames: list[str], model_version: str, forwarder_version: str) -> dict:
        """Cuerpo de POST /v1/events (contrato con cloud/api/main.py)."""
        return {
            "event_id": self.event_id,
            "site_id": self.site_id,  # informativo: la nube usa el sitio del TOKEN y rechaza si no coincide
            "camera_id": self.camera_id,
            "zone_id": self.zone_id,
            "track_id": self.track_id,
            "label": self.label,
            "first_seen_at": self.first_seen_at,
            "triggered_at": self.triggered_at,
            "dwell_s": round(self.triggered_at - self.first_seen_at, 3),
            "box": list(self.box),
            "frames": frames,  # llaves S3 de las fotos ya subidas (las llena app.py)
            "model_version": model_version,
            "forwarder_version": forwarder_version,
        }


def event_id_for(site_id: str, key: Key, triggered_at: float, dedupe_s: float) -> str:
    """uuid5 de sitio/cámara/track/zona/ventana. Mismo intento → mismo id → la nube deduplica.

    La ventana es fija (múltiplos de dedupe_s desde epoch) y no "10 min desde el último evento" a
    propósito: si el forwarder se reinicia y el mismo track vuelve a cumplir el dwell dentro de la misma
    ventana, sale el MISMO id y la nube responde "duplicate" en vez de mandar otra alerta al SOC.
    Costo aceptado: si el reinicio cae justo en el cambio de ventana, puede salir una segunda alerta.
    """
    camera_id, track_id, zone_id = key
    window = int(math.floor(triggered_at / dedupe_s) * dedupe_s)
    return str(uuid.uuid5(EVENT_NAMESPACE, f"{site_id}/{camera_id}/{track_id}/{zone_id}/{window}"))


# ------------------------------------------------------------------------------ motor de reglas
@dataclass
class _Presence:
    entered_at: float
    last_seen: float
    snapshots: int = 1  # la de entrada ya se pidió al crear la presencia


@dataclass
class ZoneRules:
    """Estado mínimo en memoria: quién está en qué zona desde cuándo y cuándo avisamos por última vez."""

    cfg: SiteConfig
    _presence: dict[Key, _Presence] = field(default_factory=dict)
    _last_fired: dict[Key, float] = field(default_factory=dict)

    def process(self, frame: Frame) -> list[SnapshotRequest | ZoneEvent]:
        cam = self.cfg.cameras.get(frame.camera_id)
        if cam is None:  # cámara que no está en site.yaml: app.py la cuenta y la loguea
            return []
        local = datetime.fromtimestamp(frame.ts, self.cfg.tz)  # el horario se evalúa en hora del SITIO
        actions: list[SnapshotRequest | ZoneEvent] = []
        seen: set[Key] = set()
        for det in frame.detections:
            fx, fy = foot_point(det, self.cfg.frame_w, self.cfg.frame_h)
            for zone in cam.zones:
                if det.label not in zone.classes or not zone.active(local):
                    continue
                if not point_in_polygon(fx, fy, zone.polygon):
                    continue
                key = (frame.camera_id, det.track_id, zone.zone_id)
                seen.add(key)
                presence = self._presence.get(key)
                if presence is None:  # acaba de entrar: foto 0
                    presence = self._presence[key] = _Presence(entered_at=frame.ts, last_seen=frame.ts)
                    actions.append(SnapshotRequest(key, frame.camera_id, 0))
                presence.last_seen = frame.ts
                needed = zone.dwell_s if zone.dwell_s is not None else self.cfg.dwell_s
                dwell = frame.ts - presence.entered_at
                if presence.snapshots == 1 and dwell >= needed / 2:  # foto 1: mitad del dwell
                    presence.snapshots = 2
                    actions.append(SnapshotRequest(key, frame.camera_id, 1))
                if dwell >= needed and self._may_fire(key, frame.ts):
                    self._last_fired[key] = frame.ts
                    actions.append(self._event(key, det, presence, frame.ts))
        self._expire(frame, seen)
        return actions

    def _may_fire(self, key: Key, now: float) -> bool:
        last = self._last_fired.get(key)
        return last is None or now - last >= self.cfg.dedupe_s  # 10 min después, un recordatorio

    def _event(self, key: Key, det: Detection, presence: _Presence, now: float) -> ZoneEvent:
        w, h = self.cfg.frame_w, self.cfg.frame_h
        return ZoneEvent(
            event_id=event_id_for(self.cfg.site_id, key, now, self.cfg.dedupe_s),
            key=key,
            site_id=self.cfg.site_id,
            camera_id=key[0],
            zone_id=key[2],
            track_id=key[1],
            label=det.label,
            first_seen_at=presence.entered_at,
            triggered_at=now,
            box=(round(det.left / w, 4), round(det.top / h, 4), round(det.right / w, 4), round(det.bottom / h, 4)),
        )

    def _expire(self, frame: Frame, seen: set[Key]) -> None:
        """Quien no aparece por más de exit_grace_s en SU cámara, salió: su dwell vuelve a cero.

        La tolerancia existe porque a 5 fps un frame perdido o una oclusión de medio segundo no deben
        reiniciar el conteo. Presencias de cámaras que dejaron de mandar frames se limpian a los 60 s.
        """
        for key, presence in list(self._presence.items()):
            same_camera = key[0] == frame.camera_id
            gone = frame.ts - presence.last_seen
            if (same_camera and key not in seen and gone > self.cfg.exit_grace_s) or gone > 60:
                del self._presence[key]
        for key, fired_at in list(self._last_fired.items()):  # memoria acotada: solo ventanas vigentes
            if frame.ts - fired_at > self.cfg.dedupe_s:
                del self._last_fired[key]
