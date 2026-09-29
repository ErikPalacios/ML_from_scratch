"""API de ingesta de eventos del caso c02: la puerta de la nube para las 25 cajas edge y la consola del SOC.

Endpoints:
  cajas (token del SITIO)   POST /v1/events      evento candidato, idempotente por event_id → 202
                            POST /v1/uploads     URL prefirmada de S3 para una foto o el clip
                            POST /v1/heartbeat   "sigo vivo" + fps por cámara + estado de su cola, cada 30 s
  consola SOC (token SOC)   POST /v1/alerts/{id}/displayed    la alerta ya está en pantalla → latencia E2E
                            POST /v1/alerts/{id}/disposition  confirmada | descartada → tasa de falsas alarmas
  plataforma                GET /healthz · GET /readyz · GET /metrics
El ALB (con TLS) enruta SOLO /v1/* y usa /healthz para su health check. /metrics no se publica: Prometheus
lo lee de cada pod dentro del cluster. Publicado, camera_fps{site,camera} le diría a cualquiera qué cámaras
de perímetro están caídas en este momento (como en c01, donde /metrics tampoco pasa por el Ingress).

Por qué la API no verifica ni alerta: solo acepta rápido y encola en SQS. El verificador (GPU) consume a
su ritmo; si se atrasa, la cola absorbe y las cajas no se enteran. Aceptar ≠ procesar.
Arranque: uvicorn --factory main:app_from_env --host 0.0.0.0 --port 8080
"""

from __future__ import annotations  # anotaciones como texto

import hashlib  # los tokens se guardan y comparan como sha256, nunca en claro
import hmac  # comparación en tiempo constante del token del SOC
import json  # cuerpo del mensaje de SQS y logs
import logging  # una línea JSON por evento aceptado, a stdout
import os  # configuración por variables de entorno
import sys
import threading  # el store en memoria se comparte entre los hilos del threadpool de FastAPI
import time  # reloj inyectable en tests
import uuid  # event_id es un UUID (uuid5 generado en la caja)
from dataclasses import dataclass, field
from typing import Annotated, Literal, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest
from prometheus_client.core import GaugeMetricFamily
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

log = logging.getLogger("c02-api")

CameraId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,31}$")]  # "cam-07"
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$")]  # "perimetro-norte"
Fps = Annotated[float, Field(ge=0, le=120)]


# ------------------------------------------------------------------------------ contratos
class EventIn(BaseModel):
    """Cuerpo de POST /v1/events (lo arma ZoneEvent.to_payload en edge/forwarder/rules.py).

    extra="ignore" a propósito: las cajas se actualizan por olas durante días; un campo nuevo de un
    forwarder más reciente no puede tumbar la ingesta de la API vieja (ni al revés).
    """

    model_config = ConfigDict(extra="ignore")
    event_id: uuid.UUID
    site_id: str | None = None  # informativo: manda el sitio del TOKEN
    camera_id: CameraId
    zone_id: Slug
    track_id: Annotated[str, StringConstraints(max_length=32)]
    label: Literal["person", "vehicle"]
    # Epoch (reloj de la caja) del primer mensaje de DeepStream con el track ya confirmado dentro de la
    # zona: la entrada real + probation del tracker + pipeline (≈ 1 s, est.) ocurrió ANTES. Ese tramo se
    # mide con walk tests y se descuenta del umbral de AlertLatencyHigh (4 s, no 5).
    first_seen_at: float
    triggered_at: float
    dwell_s: Annotated[float, Field(ge=0)]
    box: Annotated[list[Annotated[float, Field(ge=0, le=1)]], Field(min_length=4, max_length=4)]
    frames: Annotated[list[str], Field(max_length=3)] = []
    evidence_missing: bool = False  # la caja no pudo subir fotos: el SOC la ve "sin verificar"
    # False = recordatorio (mismo track 10 min después) o regla con dwell largo (carril de bomberos): el SOC
    # lo recibe igual, pero NO entra en las métricas del SLO (mediría 600 s o 61 s "de latencia").
    # Default True: un forwarder viejo sin este campo sigue contando como antes durante el rollout.
    slo: bool = True
    model_version: Annotated[str, StringConstraints(max_length=64)]
    forwarder_version: Annotated[str, StringConstraints(max_length=64)] | None = None


class UploadIn(BaseModel):
    event_id: uuid.UUID
    kind: Literal["frame", "clip"]
    index: Annotated[int, Field(ge=0, le=2)] = 0  # 3 fotos por evento: 0, 1, 2
    content_type: Literal["image/jpeg", "video/mp4"]


class OutboxStats(BaseModel):
    """Estado de la cola SQLite de la caja (Outbox.stats() en edge/forwarder/app.py)."""

    model_config = ConfigDict(extra="ignore")
    pending: Annotated[int, Field(ge=0)] = 0
    oldest_event_age_s: Annotated[float, Field(ge=0)] = 0.0  # el EVENTO más viejo sin enviar (los clips no)
    dead_letter_events: Annotated[int, Field(ge=0)] = 0  # eventos apartados por un 4xx: perdidos hasta re-encolar


class HeartbeatIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sent_at: float
    site_id: str | None = None  # el de site.yaml: si no coincide con el del token, 403 (caja mal configurada)
    # ≤ 64 cámaras: un bug (o una caja comprometida) no puede crear miles de series en Prometheus
    cameras: Annotated[dict[CameraId, Fps], Field(max_length=64)]
    model_version: str | None = None
    forwarder_version: str | None = None
    outbox: OutboxStats | None = None  # → edge_outbox_* (alerta EdgeEventsStuck)
    # Mensajes rotos, cámaras desconocidas, bugs en on_message: solo se loguean (no son labels). Validación
    # laxa a propósito: un contador nuevo de un forwarder más reciente no puede hacer fallar el heartbeat.
    counters: Annotated[dict[str, int], Field(max_length=32)] = {}


class DispositionIn(BaseModel):
    disposition: Literal["confirmed", "dismissed"]


# ------------------------------------------------------------------------------ dependencias inyectables
@dataclass
class EventRecord:
    event: dict
    site_id: str
    received_at: float
    enqueued: bool = False
    displayed_at: float | None = None
    disposition: str | None = None


class EventStore(Protocol):
    def put_if_absent(self, event_id: str, record: EventRecord) -> tuple[bool, EventRecord]: ...
    def get(self, event_id: str) -> EventRecord | None: ...
    def update(self, event_id: str, **fields) -> None: ...


class InMemoryEventStore:
    """Para tests y desarrollo. En producción es una tabla con escritura CONDICIONAL: DynamoDB
    PutItem con ConditionExpression="attribute_not_exists(event_id)" (o INSERT … ON CONFLICT DO NOTHING
    en Postgres). Lo importante es que "¿existe? → insertar" sea UNA operación atómica, no dos."""

    def __init__(self):
        self._data: dict[str, EventRecord] = {}
        self._lock = threading.Lock()

    def put_if_absent(self, event_id: str, record: EventRecord) -> tuple[bool, EventRecord]:
        with self._lock:
            if event_id in self._data:
                return False, self._data[event_id]
            self._data[event_id] = record
            return True, record

    def get(self, event_id: str) -> EventRecord | None:
        with self._lock:
            return self._data.get(event_id)

    def update(self, event_id: str, **fields) -> None:
        with self._lock:
            for k, v in fields.items():
                setattr(self._data[event_id], k, v)


class EventQueue(Protocol):
    def send(self, message: dict) -> None: ...


class SqsEventQueue:
    """Cola SQS estándar (at-least-once: puede entregar un mensaje dos veces; el verificador deduplica por
    event_id). Una FIFO no hace falta: el orden entre eventos de sitios distintos no importa."""

    def __init__(self, queue_url: str, client=None):
        import boto3  # import tardío: los tests con colas falsas no necesitan credenciales de AWS

        self.queue_url = queue_url
        self.client = client or boto3.client("sqs")

    def send(self, message: dict) -> None:
        self.client.send_message(
            QueueUrl=self.queue_url,
            MessageBody=json.dumps(message),  # ≈ 1 KB: muy por debajo del límite de SQS (1 MiB)
            # Atributo visible sin parsear el cuerpo (filtros, métricas por sitio en el consumidor)
            MessageAttributes={"site_id": {"DataType": "String", "StringValue": message["site_id"]}},
        )


class Signer(Protocol):
    def presign_put(self, key: str, content_type: str) -> dict: ...


class S3PresignSigner:
    """URL prefirmada de PUT (SigV4, 15 min). La caja sube directo a S3: los MB de fotos y clips no pasan
    por esta API ni por su ALB (que cobra por byte procesado, como viste en el caso 1).

    Trampa: una URL de PUT prefirmada no limita el tamaño del archivo. Si te preocupa un abuso, usa POST
    prefirmado con una política content-length-range o valida el tamaño al procesar.
    """

    def __init__(self, bucket: str, client=None, expires_s: int = 900):
        import boto3
        from botocore.config import Config

        self.bucket, self.expires_s = bucket, expires_s
        # s3v4 EXPLÍCITO: verificado con botocore 1.43 en us-east-1, sin esto la URL sale firmada con SigV2,
        # que los buckets creados después del 24-jun-2020 rechazan (lo prueba tests/test_api.py).
        self.client = client or boto3.client("s3", config=Config(signature_version="s3v4"))

    def presign_put(self, key: str, content_type: str) -> dict:
        url = self.client.generate_presigned_url(
            "put_object",
            # ContentType queda FIRMADO: la caja debe mandar exactamente ese header en el PUT
            Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=self.expires_s,
        )
        return {"url": url, "headers": {"Content-Type": content_type}, "expires_in": self.expires_s}


# ------------------------------------------------------------------------------ métricas del heartbeat
class HeartbeatCollector:
    """Expone el último heartbeat de cada sitio como gauges, calculados al momento del scrape.

    Dos trampas que resuelve:
    1. Una serie que no existe nunca dispara una alerta. Por eso edge_last_heartbeat_timestamp_seconds
       existe para TODOS los sitios conocidos desde el arranque (con 0 si esta réplica aún no oyó nada).
    2. Con varias réplicas de la API, cada una recuerda el último heartbeat que LE tocó: un gauge de
       "último valor" en la réplica A puede tener 5 min mientras la B tiene el fresco. Por eso las alertas
       agregan con max (timestamp) y camera_fps y edge_outbox_* solo se exponen si el heartbeat de ESTA
       réplica tiene < 90 s.
    """

    def __init__(self, sites: list[str], clock, fresh_s: float = 90.0):
        self._last: dict[str, tuple[float, dict, OutboxStats | None]] = {site: (0.0, {}, None) for site in sites}
        self._clock, self._fresh_s = clock, fresh_s
        self._lock = threading.Lock()

    def record(self, site: str, now: float, cameras: dict[str, float], outbox: OutboxStats | None = None) -> None:
        with self._lock:
            self._last[site] = (now, dict(cameras), outbox)

    def collect(self):
        heartbeat = GaugeMetricFamily(
            "edge_last_heartbeat_timestamp_seconds", "Epoch del último heartbeat recibido por esta réplica", labels=["site"]
        )
        fps = GaugeMetricFamily("camera_fps", "Frames analizados por segundo que reporta la caja", labels=["site", "camera"])
        oldest = GaugeMetricFamily("edge_outbox_oldest_event_age_seconds",
                                   "Edad del evento más viejo sin enviar en la cola de la caja", labels=["site"])
        dead = GaugeMetricFamily("edge_outbox_dead_letter_events",
                                 "Eventos apartados en dead-letter en la caja (perdidos hasta re-encolarlos)", labels=["site"])
        now = self._clock()
        with self._lock:
            snapshot = dict(self._last)
        for site, (seen_at, cameras, outbox) in sorted(snapshot.items()):
            heartbeat.add_metric([site], seen_at)
            if seen_at and now - seen_at <= self._fresh_s:  # solo valores frescos: los viejos mienten
                for camera, value in sorted(cameras.items()):
                    fps.add_metric([site, camera], value)
                if outbox is not None:
                    oldest.add_metric([site], outbox.oldest_event_age_s)
                    dead.add_metric([site], outbox.dead_letter_events)
        yield heartbeat
        yield fps
        yield oldest
        yield dead


# ------------------------------------------------------------------------------ la app
def token_hash(token: str) -> str:
    """Tokens aleatorios de 32+ bytes: sha256 alcanza (no son contraseñas elegidas por humanos)."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_app(
    site_tokens: dict[str, str],  # sha256(token) → site_id
    soc_token_sha256: str,
    queue: EventQueue,
    signer: Signer,
    store: EventStore | None = None,
    clock=time.time,
) -> FastAPI:
    """Fábrica: todo lo externo entra como parámetro (tests con fakes, producción con AWS)."""
    store = store or InMemoryEventStore()
    sites = sorted(set(site_tokens.values()))
    registry = CollectorRegistry()  # un registro por app: los tests crean varias sin choques de nombres

    # Nombres = contrato con cloud/monitoring/alerts.yml. Labels acotados: site (25) × verdict (2).
    events_received = Counter("events_received_total", "Eventos candidatos recibidos por sitio y resultado",
                              ["site", "verdict"], registry=registry)
    # Las dos empiezan en first_seen_at: la publicación de DeepStream del primer frame con el pie en la zona
    # (reloj de la caja), no la entrada real (≈ 1 s antes, est.). Solo eventos con slo=true.
    ingest_lag = Histogram("event_ingest_lag_seconds",
                           "De la publicación de DeepStream del primer frame con el pie en la zona (reloj de la caja) "
                           "a recibido en la nube", ["site"],
                           buckets=(0.5, 1, 2, 3, 4, 5, 7.5, 10, 30, 60, 300, 3600), registry=registry)
    alert_e2e = Histogram("alert_end_to_end_seconds",
                          "De la publicación de DeepStream del primer frame con el pie en la zona (reloj de la caja) "
                          "a la alerta en pantalla del SOC (alerta: p95 > 4 s = SLO de 5 s menos ≈ 1 s previo)",
                          ["site"], buckets=(1, 2, 3, 4, 5, 6, 8, 10, 15, 30, 60), registry=registry)
    alerts_closed = Counter("alerts_closed_total", "Alertas cerradas por el SOC", ["site"], registry=registry)
    alerts_dismissed = Counter("alerts_dismissed_total", "Alertas cerradas como falsa alarma", ["site"], registry=registry)
    heartbeats = HeartbeatCollector(sites, clock)
    registry.register(heartbeats)
    for site in sites:  # series en 0 desde el arranque: increase() y los cocientes funcionan desde el minuto 1
        for verdict in ("accepted", "duplicate"):
            events_received.labels(site=site, verdict=verdict)
        alerts_closed.labels(site=site)
        alerts_dismissed.labels(site=site)

    def site_auth(authorization: str | None = Header(default=None)) -> str:
        """El site_id sale del token, NUNCA del cuerpo: una caja comprometida no escribe por otro sitio."""
        scheme, _, token = (authorization or "").partition(" ")
        site = site_tokens.get(token_hash(token)) if scheme.lower() == "bearer" and token else None
        if site is None:
            raise HTTPException(401, "token de sitio inválido", headers={"WWW-Authenticate": "Bearer"})
        return site

    def soc_auth(authorization: str | None = Header(default=None)) -> None:
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not hmac.compare_digest(token_hash(token), soc_token_sha256):
            raise HTTPException(401, "token del SOC inválido", headers={"WWW-Authenticate": "Bearer"})

    app = FastAPI(title="c02-event-ingest")

    # Rutas `def` (no async): boto3 bloquea; FastAPI las corre en su threadpool sin frenar el event loop.
    @app.post("/v1/events", status_code=202)
    def ingest_event(event: EventIn, site: str = Depends(site_auth)) -> dict:
        if event.site_id is not None and event.site_id != site:
            raise HTTPException(403, "site_id del cuerpo no coincide con el token")
        event_id = str(event.event_id)
        prefix = f"sites/{site}/events/{event_id}/"
        if any(not key.startswith(prefix) for key in event.frames):  # solo fotos de SU sitio y SU evento
            raise HTTPException(422, "frames fuera del prefijo del evento")
        now = clock()
        body = {**event.model_dump(mode="json"), "site_id": site, "received_at": now}
        created, record = store.put_if_absent(event_id, EventRecord(event=body, site_id=site, received_at=now))
        if record.site_id != site:  # el uuid5 incluye el sitio: otro sitio con el mismo id no es un reintento
            raise HTTPException(409, "event_id ya registrado por otro sitio")
        first_delivery = not record.enqueued
        if first_delivery:
            # Guardado ≠ encolado. Si SQS falla, respondemos 503 y la caja reintenta; el reintento llega como
            # "ya existe", pero como nunca se encoló, se encola ahora. Un "duplicate" que se traga un evento
            # que nunca llegó a la cola sería una intrusión perdida en silencio.
            try:
                queue.send(record.event)
            except Exception as exc:  # noqa: BLE001 - cualquier falla de la cola es "reintenta"
                log.error(json.dumps({"event": "enqueue_failed", "event_id": event_id, "error": repr(exc)}))
                raise HTTPException(503, "cola no disponible", headers={"Retry-After": "5"}) from None
            store.update(event_id, enqueued=True)
            if event.slo:  # recordatorios y reglas de dwell largo no son latencia: ensuciarían el p95
                ingest_lag.labels(site=site).observe(max(0.0, now - event.first_seen_at))  # reloj caja vs nube
        verdict = "accepted" if first_delivery else "duplicate"
        events_received.labels(site=site, verdict=verdict).inc()
        log.info(json.dumps({"event": "ingest", "event_id": event_id, "site": site, "verdict": verdict,
                             "camera": event.camera_id, "zone": event.zone_id, "evidence_missing": event.evidence_missing}))
        return {"event_id": event_id, "status": verdict}

    @app.post("/v1/uploads")
    def create_upload(req: UploadIn, site: str = Depends(site_auth)) -> dict:
        if (req.kind == "frame") != (req.content_type == "image/jpeg"):
            raise HTTPException(422, "frame → image/jpeg; clip → video/mp4")
        name = f"frame-{req.index}.jpg" if req.kind == "frame" else "clip.mp4"
        # Llave determinista bajo el prefijo del sitio: un reintento sobrescribe el mismo objeto (idempotente)
        # y la política IAM puede limitar a cada consumidor a sites/<su-sitio>/*. Retención de 30 días:
        # regla de lifecycle del bucket, no código.
        key = f"sites/{site}/events/{req.event_id}/{name}"
        return {"key": key, "method": "PUT", **signer.presign_put(key, req.content_type)}

    @app.post("/v1/heartbeat")
    def heartbeat(hb: HeartbeatIn, site: str = Depends(site_auth)) -> dict:
        if hb.site_id is not None and hb.site_id != site:
            # Una caja con el site.yaml de OTRO sitio (p. ej. un repuesto mal aprovisionado): sus eventos
            # reciben 403 y esperan en su cola. Rechazar también el heartbeat hace que EdgeBoxOffline avise
            # en minutos, en vez de un sitio "vivo" que en realidad no entrega nada.
            raise HTTPException(403, "site_id del heartbeat no coincide con el token")
        now = clock()  # hora del SERVIDOR: el reloj de la caja podría estar mal
        heartbeats.record(site, now, hb.cameras, hb.outbox)
        log.info(json.dumps({"event": "heartbeat", "site": site,
                             "outbox": hb.outbox.model_dump() if hb.outbox else None, "counters": hb.counters,
                             "model_version": hb.model_version, "skew_s": round(now - hb.sent_at, 2)}))
        return {"status": "ok", "server_time": now}  # la caja compara con su reloj y avisa si NTP falla

    def _record_or_404(event_id: uuid.UUID) -> tuple[str, EventRecord]:
        record = store.get(str(event_id))
        if record is None:
            raise HTTPException(404, "evento desconocido")
        return str(event_id), record

    @app.post("/v1/alerts/{event_id}/displayed", dependencies=[Depends(soc_auth)])
    def alert_displayed(event_id: uuid.UUID) -> dict:
        """La consola lo llama al DIBUJAR la alerta: es el final del SLO de 5 s (persona entra → pantalla).

        Mide con dos relojes: first_seen_at viene de la caja y `now` del servidor; por eso la caja
        vigila su desfase con server_time en cada heartbeat. Solo cuenta la primera vez, y solo eventos
        con slo=true (no recordatorios ni el carril de bomberos).
        """
        eid, record = _record_or_404(event_id)
        if record.displayed_at is None:
            now = clock()
            store.update(eid, displayed_at=now)
            if record.event.get("slo", True):
                alert_e2e.labels(site=record.site_id).observe(max(0.0, now - record.event["first_seen_at"]))
        return {"event_id": eid, "displayed_at": store.get(eid).displayed_at}

    @app.post("/v1/alerts/{event_id}/disposition", dependencies=[Depends(soc_auth)])
    def alert_disposition(event_id: uuid.UUID, body: DispositionIn) -> dict:
        """El operador cierra la alerta. Las descartadas alimentan FalseAlarmRateHigh y la cola de
        etiquetado: son los negativos difíciles del próximo reentrenamiento."""
        eid, record = _record_or_404(event_id)
        if record.disposition is None:
            store.update(eid, disposition=body.disposition)
            alerts_closed.labels(site=record.site_id).inc()
            if body.disposition == "dismissed":
                alerts_dismissed.labels(site=record.site_id).inc()
        elif record.disposition != body.disposition:
            raise HTTPException(409, f"ya cerrada como {record.disposition}")  # el primer cierre manda
        return {"event_id": eid, "disposition": store.get(eid).disposition}

    @app.get("/healthz")
    def healthz() -> dict:
        """Liveness: el proceso responde. Sin dependencias (reiniciar la API no arregla SQS)."""
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> dict:
        """Readiness: en este ejemplo, la app construida. En producción, además, credenciales de AWS válidas."""
        return {"status": "ready", "sites": len(sites)}

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    return app


def app_from_env() -> FastAPI:
    """Producción: tokens desde un archivo montado (Secret de Kubernetes), SQS y S3 reales."""
    logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(message)s")
    with open(os.environ["SITE_TOKENS_FILE"], encoding="utf-8") as f:
        site_tokens = json.load(f)  # {"<sha256 del token>": "dc-07", …}: el archivo no contiene tokens en claro
    return create_app(
        site_tokens=site_tokens,
        soc_token_sha256=os.environ["SOC_TOKEN_SHA256"],
        queue=SqsEventQueue(os.environ["SQS_QUEUE_URL"]),
        signer=S3PresignSigner(os.environ["EVIDENCE_BUCKET"]),
    )
