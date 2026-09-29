"""seg-worker (caso c04): toma slides de la cola `slide-jobs`, segmenta tumor y deja el resultado.

Un mensaje = un WSI recién subido al archivo digital:
    {"slide_id": "...", "uri": "s3://bucket/key.svs", "sha256": "<64 hex>", "lab": "A",
     "scanner": "A-X-01", "available_at": 1790000000.0}      (available_at es opcional)

Vida de un mensaje (lo que un entrevistador quiere oír, en orden):
  1. receive (long polling 20 s, UN mensaje por worker: un slide ocupa la GPU ≈ 20–30 s; pedir 10
     dejaría 9 invisibles esperando mientras otro worker está ocioso).
  2. ¿Ya existe results/<slide_id>/<model_version>/summary.json con el MISMO sha256 y el MISMO hash
     de preprocesamiento? → ya se hizo: se borra el mensaje sin gastar GPU (idempotencia; SQS
     estándar entrega "at least once" y un worker puede morir entre escribir y borrar).
  3. Descarga al disco local (NVMe) y verifica el sha256: el resultado queda atado a ESE archivo.
  4. QC bloqueante: mpp faltante, raro o que no coincide con el escáner registrado, sin pirámide,
     muy poco tejido → summary.json con status "qc_blocked" y SIN números: el visor dice
     "sin resultado de IA" y el motivo. Nunca un número calculado con un mpp dudoso.
  5. Máscara de tejido → grilla de tiles → lectura en hilos → batch a la GPU → stitch con blending.
  6. Escribe los artefactos bajo un prefijo propio de esta corrida (runs/<sha>-<config>/) y
     summary.json AL FINAL: summary.json es el "commit marker". Quien lee (results-api) solo mira
     summary.json, así que nunca ve un resultado a medias.
  7. Fila en el índice (Postgres, upsert idempotente) → recién entonces DeleteMessage.
Mientras procesa, un heartbeat extiende el visibility timeout. Ante un error NO se borra: el
mensaje reaparece y, al tercer intento fallido, SQS lo mueve a la DLQ (maxReceiveCount 3 se
configura EN LA COLA, no aquí). Ante SIGTERM (spot, scale-down, deploy) deja de pedir mensajes,
aborta el slide en curso en el siguiente batch y lo devuelve a la cola con visibilidad 0.

Qué es real aquí y qué queda detrás de una interfaz:
  - Real y probado: el loop, idempotencia, heartbeat, SIGTERM, QC, stitching, métricas, y los
    adaptadores SqsQueue / S3Storage (boto3, probados contra moto) y OpenSlideReader (OpenSlide
    4.0.1 vía openslide-bin, probado con un SVS sintético). OpenSlide también lee DICOM WSI (lab C)
    desde la 4.0.0; eso NO se probó aquí (no hay un DICOM de prueba).
  - Interfaz sin implementación: el Model de TensorRT (ver load_model). Sin una L4 no se puede
    probar, y código de GPU sin probar no se publica como referencia.

Variables de entorno (main): SQS_QUEUE_URL, RESULTS_BUCKET, AWS_REGION, MODEL_VERSION,
MODEL_ENGINE_PATH, CONTAINER_DIGEST, TRAINING_DATA_VERSION, WORKER_CONFIG (/config/worker.yaml),
WORK_DIR (/scratch), METRICS_PORT (9100), POD_NAME.
"""

from __future__ import annotations  # anotaciones como texto: `X | None` sin costo en runtime

import collections  # deque: ventana acotada de lecturas en vuelo
import datetime as dt  # timestamps ISO-8601 en UTC para summary.json
import hashlib  # sha256 del archivo descargado
import json  # mensaje de la cola, summary.json, GeoJSON
import logging  # una línea JSON por evento a stdout (la recoge el agente de logs del cluster)
import os  # variables de entorno, os.replace (escritura atómica local)
import re  # validación de ids que terminan en keys de S3
import signal  # SIGTERM de Kubernetes
import threading  # heartbeat y bandera de parada
import time  # monotonic para duraciones, time.time para timestamps
from concurrent.futures import Future, ThreadPoolExecutor  # lectores de tiles en paralelo
from dataclasses import asdict, dataclass, field  # config y mensajes tipados
from pathlib import Path  # archivos locales
from typing import Callable, Iterator, Optional, Protocol  # interfaces

import numpy as np
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

import tiling  # la matemática pura del slide (probada aparte en tests/test_tiling.py)

log = logging.getLogger("seg-worker")


def log_event(event: str, **fields) -> None:
    """Una línea JSON por evento: se busca por slide_id en el agregador de logs sin parsers."""
    log.info(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str))


# ---------------------------------------------------------------------------- errores
class BadMessage(Exception):
    """El cuerpo del mensaje no cumple el esquema. Reintentar no lo arregla: terminará en la DLQ."""


class IntegrityError(Exception):
    """El archivo descargado no tiene el sha256 del mensaje (subida incompleta, reescaneo, bug)."""


class ModelOutputError(Exception):
    """La salida del modelo no es un mapa de probabilidades válido (forma, NaN, fuera de [0, 1])."""


class Interrupted(Exception):
    """SIGTERM a mitad de un slide: se devuelve el mensaje a la cola, no es un error."""


# ---------------------------------------------------------------------------- mensaje
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
# slide_id y scanner terminan dentro de keys de S3 y en labels: sin "/", sin "..", longitud acotada.
# Un slide_id "../../otro" escribiría fuera de su prefijo: se valida, no se "limpia".
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class SlideJob:
    slide_id: str  # id seudonimizado del slide (nunca el nombre del paciente)
    uri: str  # s3://bucket/key del WSI en el archivo digital
    sha256: str  # hash que calculó el archivo al terminar la subida
    lab: str  # A, B o C
    scanner: str  # id del escáner (A-X-01…): elige el mpp nominal contra el que se valida
    available_at: Optional[float] = None  # epoch s en que el WSI quedó en el archivo (inicio del SLO)


def parse_job(body: str) -> SlideJob:
    """JSON → SlideJob, o BadMessage con el motivo."""
    try:
        d = json.loads(body)
    except json.JSONDecodeError as e:
        raise BadMessage(f"no es JSON: {e}") from None
    if not isinstance(d, dict):
        raise BadMessage("el cuerpo no es un objeto JSON")
    missing = [k for k in ("slide_id", "uri", "sha256", "lab", "scanner") if not d.get(k)]
    if missing:
        raise BadMessage(f"faltan campos: {missing}")
    if not ID_RE.match(str(d["slide_id"])) or not ID_RE.match(str(d["scanner"])):
        raise BadMessage("slide_id o scanner con caracteres no permitidos")
    if not SHA256_RE.match(str(d["sha256"]).lower()):
        raise BadMessage("sha256 no es un hex de 64 caracteres")
    if not str(d["uri"]).startswith("s3://"):
        raise BadMessage("uri debe ser s3://bucket/key")
    avail = d.get("available_at")
    return SlideJob(slide_id=d["slide_id"], uri=d["uri"], sha256=str(d["sha256"]).lower(),
                    lab=str(d["lab"]), scanner=d["scanner"],
                    available_at=float(avail) if avail is not None else None)


@dataclass
class Message:
    """Lo que el loop necesita de un mensaje recibido (independiente de SQS)."""

    body: str
    receipt: str  # receipt handle: identifica ESTA entrega (cambia en cada receive)
    receive_count: int  # ApproximateReceiveCount: 1 en la primera entrega
    sent_at: Optional[float] = None  # SentTimestamp en epoch s (respaldo de available_at)
    message_id: str = ""


# ---------------------------------------------------------------------------- interfaces
class Queue(Protocol):
    def receive(self, wait_s: int) -> Optional[Message]: ...
    def extend_visibility(self, msg: Message, seconds: int) -> None: ...
    def release(self, msg: Message) -> None: ...  # visibilidad 0: disponible ya para otro worker
    def delete(self, msg: Message) -> None: ...


class Storage(Protocol):
    def download(self, uri: str, dest: Path) -> None: ...
    def exists(self, key: str) -> bool: ...
    def read(self, key: str) -> Optional[bytes]: ...
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def put_atomic(self, key: str, data: bytes, content_type: str) -> None: ...


class Slide(Protocol):
    dimensions: tuple[int, int]  # (ancho, alto) del nivel 0
    level_downsamples: tuple[float, ...]
    level_dimensions: tuple[tuple[int, int], ...]
    mpp: tuple[Optional[float], Optional[float]]  # µm/px del nivel 0 según el ARCHIVO

    def read_region(self, x0: int, y0: int, level: int, w: int, h: int) -> np.ndarray: ...
    def close(self) -> None: ...


class SlideReader(Protocol):
    def open(self, path: Path) -> Slide: ...


class Model(Protocol):
    def predict(self, batch: np.ndarray) -> np.ndarray: ...  # (N,512,512,3) uint8 → (N,512,512) float


class ResultIndex(Protocol):
    def upsert(self, summary: dict) -> None: ...  # idempotente por (slide_id, model_version)


# ---------------------------------------------------------------------------- configuración
@dataclass(frozen=True)
class WorkerConfig:
    """Lo operativo: NO entra al hash de preprocesamiento (no cambia el resultado)."""

    model_version: str  # p. ej. "2026-09-01-unet-fp16": también es parte de la key del resultado
    container_digest: str = "unknown"  # sha256 de la imagen: trazabilidad de CADA resultado
    training_data_version: str = "unknown"  # versión del dataset con que se entrenó el modelo
    results_prefix: str = "results"
    work_dir: Path = Path("/scratch")  # emptyDir sobre el NVMe local del nodo
    receive_wait_s: int = 20  # long polling (máximo de SQS): menos requests vacíos, menos costo
    visibility_s: int = 300  # = VisibilityTimeout de la cola; el heartbeat lo renueva
    heartbeat_s: int = 60  # renovar cada 60 s con 300 s de visibilidad: 4 heartbeats perdidos de margen
    retry_backoff_s: int = 60  # tras un error, el próximo intento en 60 s × intento (no inmediato)
    max_receive_count: int = 3  # SOLO informativo (logs): el valor real vive en la redrive policy
    reader_threads: int = 6  # OpenSlide suelta el GIL al decodificar (ctypes): hilos alcanzan
    batch_size: int = 16  # tiles por llamada a la GPU (mídelo con trtexec: lo fija la VRAM y la latencia)
    prefetch_batches: int = 2  # batches leídos por adelantado: la GPU no espera al CPU, la RAM queda acotada
    min_tissue_mm2: float = 1.0  # menos tejido que esto → qc_blocked (low_tissue); ilustrativo
    blurry_frac_flag: float = 0.10  # > 10 % de tiles borrosos → flag "blurry" (no bloquea)
    labs: tuple[str, ...] = ("A", "B", "C")
    scanners: dict[str, float] = field(default_factory=dict)  # id → mpp calibrado del nivel 0
    liveness_file: Optional[Path] = None  # el livenessProbe revisa su mtime
    pod_name: str = "local"


# ---------------------------------------------------------------------------- métricas
STATUSES = ("ok", "qc_blocked", "duplicate", "error", "interrupted")  # label status
# Flags de seg_qc_flags_total. Bloqueantes (sin resultado): missing_mpp, odd_mpp, anisotropic_mpp,
# mpp_mismatch, unknown_scanner, no_low_res_level, low_tissue. Informativo: blurry. Integridad
# (error, reintento): sha256_mismatch.
QC_FLAGS = ("missing_mpp", "odd_mpp", "anisotropic_mpp", "mpp_mismatch", "unknown_scanner",
            "no_low_res_level", "low_tissue", "blurry", "sha256_mismatch")


class Metrics:
    """Nombres = contrato con monitoring/alerts.yml (un test verifica que coinciden).
    NUNCA slide_id como label: cada slide sería una serie nueva (1,200 por día, para siempre)."""

    def __init__(self, registry: CollectorRegistry):
        r = registry
        self.slides = Counter("seg_slides_processed_total", "Slides por resultado",
                              ["lab", "scanner", "status"], registry=r)
        self.slide_seconds = Histogram("seg_slide_seconds", "Tiempo de un slide en el worker (s)",
                                       buckets=(5, 10, 20, 30, 45, 60, 90, 120, 180, 300, 600), registry=r)
        self.stage_seconds = Histogram("seg_stage_seconds", "Tiempo por etapa (s)", ["stage"],
                                       buckets=(0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120), registry=r)
        # El SLI del SLO: desde "WSI en el archivo" hasta "summary.json escrito". Bucket en 3600 exacto.
        self.turnaround = Histogram("seg_turnaround_seconds", "Turnaround archivo → resultado (s)",
                                    ["lab"], buckets=(300, 600, 900, 1200, 1800, 2700, 3600, 5400,
                                                      7200, 14400, 28800, 43200), registry=r)
        self.tiles = Counter("seg_tiles_total", "Tiles inferidos", ["lab", "scanner"], registry=r)
        self.blur_checked = Counter("seg_blur_checked_tiles_total", "Tiles evaluados por blur",
                                    ["lab", "scanner"], registry=r)
        self.blurry = Counter("seg_blurry_tiles_total", "Tiles borrosos", ["lab", "scanner"], registry=r)
        self.qc_flags = Counter("seg_qc_flags_total", "Flags de QC e integridad",
                                ["lab", "scanner", "flag"], registry=r)
        self.tumor_pct = Histogram("seg_tumor_pct_of_tissue", "% de tumor predicho por slide", ["lab"],
                                   buckets=(1, 2, 5, 10, 20, 30, 50, 70, 90, 100), registry=r)
        self.confidence = Histogram("seg_mean_confidence", "Confianza media por slide", ["lab"],
                                    buckets=(0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98, 1.0), registry=r)
        self.redeliveries = Counter("seg_redeliveries_total", "Mensajes recibidos más de una vez",
                                    ["lab"], registry=r)
        self.heartbeat_failures = Counter("seg_heartbeat_failures_total",
                                          "Renovaciones de visibilidad fallidas", registry=r)
        self.last_success = Gauge("seg_last_success_timestamp_seconds",
                                  "Último slide terminado (epoch s)", registry=r)

    def init_series(self, labs, scanners) -> None:
        """Crea en 0 las series conocidas. Por qué: increase()/rate() necesitan DOS muestras; un
        counter que aparece directamente en 1 (el primer missing_mpp del mes) no suma nada en
        increase() y la alerta MissingMppMetadata nunca dispara por ese primer caso."""
        for lab in labs:
            for sc in list(scanners) + ["unknown"]:
                for st in STATUSES:
                    self.slides.labels(lab, sc, st)
                for fl in QC_FLAGS:
                    self.qc_flags.labels(lab, sc, fl)
                self.tiles.labels(lab, sc)
                self.blur_checked.labels(lab, sc)
                self.blurry.labels(lab, sc)


# ---------------------------------------------------------------------------- heartbeat
class Heartbeat:
    """Hilo que renueva el visibility timeout mientras el slide se procesa.

    Sin esto, un slide de 3 GB con una descarga lenta pasa de los 300 s, el mensaje reaparece y
    OTRO worker procesa el mismo slide en paralelo (doble GPU; la idempotencia evita el daño,
    no el costo). Con esto el visibility timeout puede ser corto (300 s) y un worker muerto
    libera su slide en ≤ 5 min en vez de en horas.
    """

    def __init__(self, queue: Queue, msg: Message, every_s: float, extend_to_s: int,
                 metrics: Metrics):
        self._queue, self._msg, self._every, self._extend = queue, msg, every_s, extend_to_s
        self._metrics = metrics
        self._done = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="heartbeat", daemon=True)

    def _loop(self) -> None:
        while not self._done.wait(self._every):  # espera `every` s o hasta que terminen
            try:
                self._queue.extend_visibility(self._msg, self._extend)
            except Exception as e:  # un heartbeat fallido no mata el slide: lo registra
                self._metrics.heartbeat_failures.inc()
                log_event("heartbeat_failed", error=repr(e))

    def __enter__(self) -> "Heartbeat":
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._done.set()  # detenerlo ANTES de borrar el mensaje o devolverlo a la cola
        self._thread.join()


# ---------------------------------------------------------------------------- utilidades
def sha256_file(path: Path, chunk: int = 8 * 1024 * 1024) -> str:
    """sha256 en bloques de 8 MiB (un WSI de 1 GB no cabe cómodo en RAM de una vez)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc).isoformat()


def tumor_geojson(tumor: np.ndarray, map_to_level0: float, props: dict) -> dict:
    """Máscara de tumor (map px) → GeoJSON con polígonos en coordenadas de NIVEL 0 del WSI.

    Nivel 0 porque es lo único que el visor y QuPath comparten sin ambigüedad: cualquier otro
    nivel depende de la pirámide de ese archivo. RETR_CCOMP da contornos externos y sus huecos
    (un tumor con un área de estroma adentro). Los mm² del reporte salen de contar pixeles, no del
    área de estos polígonos (el contorno pasa por el centro de los pixeles del borde).
    """
    import cv2  # OpenCV solo aquí: tiling.py queda en numpy puro

    contours, hierarchy = cv2.findContours(tumor.astype(np.uint8), cv2.RETR_CCOMP,
                                           cv2.CHAIN_APPROX_SIMPLE)
    features = []
    if hierarchy is not None:
        hier = hierarchy[0]

        def ring(c: np.ndarray) -> list[list[float]]:
            pts = [[round((float(x) + 0.5) * map_to_level0, 1), round((float(y) + 0.5) * map_to_level0, 1)]
                   for x, y in c[:, 0, :]]
            return pts + [pts[0]]  # GeoJSON exige anillos cerrados

        for i, c in enumerate(contours):
            if hier[i][3] != -1 or len(c) < 3:  # solo externos; < 3 puntos = 1 pixel o una línea
                continue
            rings = [ring(c)]
            child = hier[i][2]  # primer hueco de este contorno
            while child != -1:
                if len(contours[child]) >= 3:
                    rings.append(ring(contours[child]))
                child = hier[child][0]  # siguiente hueco
            features.append({"type": "Feature", "properties": props,
                             "geometry": {"type": "Polygon", "coordinates": rings}})
    return {"type": "FeatureCollection", "features": features}


def heatmap_png(prob: np.ndarray) -> bytes:
    """Mapa de probabilidad (4 µm/px) como PNG en escala de grises 0–255 para el overlay."""
    import cv2

    ok, buf = cv2.imencode(".png", np.clip(np.rint(prob * 255), 0, 255).astype(np.uint8))
    if not ok:
        raise RuntimeError("no se pudo codificar el PNG")
    return buf.tobytes()


# ---------------------------------------------------------------------------- el worker
class Worker:
    def __init__(self, queue: Queue, storage: Storage, reader: SlideReader, model: Model,
                 cfg: WorkerConfig, pre: tiling.PreprocConfig = tiling.PreprocConfig(),
                 index: Optional[ResultIndex] = None, registry: Optional[CollectorRegistry] = None,
                 clock: Callable[[], float] = time.time):
        pre.validate()
        self.queue, self.storage, self.reader, self.model = queue, storage, reader, model
        self.cfg, self.pre, self.index, self.clock = cfg, pre, index, clock
        self.pre_hash = pre.hash()  # se calcula una vez: es constante durante la vida del proceso
        self.registry = registry or CollectorRegistry()
        self.metrics = Metrics(self.registry)
        self.metrics.init_series(cfg.labs, cfg.scanners)
        self._stop = threading.Event()

    # ------------------------------------------------------------------ control
    def request_stop(self) -> None:
        """Lo llama el handler de SIGTERM: solo levanta una bandera (seguro dentro de un handler)."""
        self._stop.set()

    def _alive(self) -> None:
        if self.cfg.liveness_file:
            self.cfg.liveness_file.touch()  # el livenessProbe mira el mtime de este archivo

    def run(self, max_receives: Optional[int] = None) -> None:
        """Loop principal. max_receives solo existe para los tests."""
        n = 0
        while not self._stop.is_set() and (max_receives is None or n < max_receives):
            self._alive()
            msg = self.queue.receive(self.cfg.receive_wait_s)
            n += 1
            if msg is None:
                continue
            if self._stop.is_set():
                # SIGTERM llegó durante el long polling: este mensaje no se empieza
                self.queue.release(msg)
                break
            self.handle(msg)
        log_event("worker_stopped", reason="sigterm" if self._stop.is_set() else "max_receives")

    # ------------------------------------------------------------------ un mensaje
    def handle(self, msg: Message) -> str:
        """Procesa un mensaje y decide su destino: delete, release o dejarlo reaparecer."""
        t0 = time.monotonic()
        try:
            job = parse_job(msg.body)
        except BadMessage as e:
            # No se borra: después de 3 entregas SQS lo mueve a la DLQ, donde alguien lo mira.
            # Borrarlo aquí sería perder en silencio un slide que nadie va a procesar.
            self.metrics.slides.labels("unknown", "unknown", "error").inc()
            log_event("bad_message", message_id=msg.message_id, attempt=msg.receive_count, error=str(e))
            return "error"
        lab = job.lab if job.lab in self.cfg.labs else "other"  # labels acotados
        scanner = job.scanner if job.scanner in self.cfg.scanners else "unknown"
        if msg.receive_count > 1:
            self.metrics.redeliveries.labels(lab).inc()
        try:
            with Heartbeat(self.queue, msg, self.cfg.heartbeat_s, self.cfg.visibility_s, self.metrics):
                status, summary = self._process(job, msg, lab, scanner)
        except Interrupted:
            # SIGTERM: el slide NO terminó y no hay summary.json. Visibilidad 0 = otro worker lo toma
            # ya, en vez de esperar 5 min. Ojo: esta entrega igual cuenta para maxReceiveCount.
            self.queue.release(msg)
            self.metrics.slides.labels(lab, scanner, "interrupted").inc()
            log_event("slide_interrupted", slide_id=job.slide_id, attempt=msg.receive_count)
            return "interrupted"
        except Exception as e:
            self.metrics.slides.labels(lab, scanner, "error").inc()
            last = msg.receive_count >= self.cfg.max_receive_count
            log_event("slide_failed", slide_id=job.slide_id, attempt=msg.receive_count,
                      error=repr(e), next="dlq" if last else "retry")
            try:  # backoff: el próximo intento en 60 s, 120 s… (no en el acto, ni en 5 min)
                self.queue.extend_visibility(msg, self.cfg.retry_backoff_s * msg.receive_count)
            except Exception as e2:
                log_event("backoff_failed", slide_id=job.slide_id, error=repr(e2))
            return "error"
        finally:
            for p in self.cfg.work_dir.glob(f"{job.slide_id}.*"):
                p.unlink(missing_ok=True)  # el NVMe es chico: un slide a la vez en disco
        # Llegar aquí = summary.json escrito (o ya existía) e índice actualizado. Recién ahora.
        self.queue.delete(msg)
        self.metrics.slides.labels(lab, scanner, status).inc()
        self.metrics.slide_seconds.observe(time.monotonic() - t0)
        if status in ("ok", "qc_blocked") and summary:
            self.metrics.last_success.set(self.clock())
            if summary.get("turnaround_s") is not None:
                self.metrics.turnaround.labels(lab).observe(summary["turnaround_s"])
        return status

    # ------------------------------------------------------------------ el slide
    def _keys(self, job: SlideJob) -> tuple[str, str]:
        base = f"{self.cfg.results_prefix}/{job.slide_id}/{self.cfg.model_version}"
        run = f"{base}/runs/{job.sha256[:12]}-{self.pre_hash[:8]}"  # prefijo propio de ESTA corrida
        return f"{base}/summary.json", run

    def _header(self, job: SlideJob, msg: Message, status: str) -> dict:
        """Campos de trazabilidad que lleva TODO summary.json, con o sin resultado."""
        return {
            "schema_version": 1,
            "status": status,
            "slide_id": job.slide_id, "lab": job.lab, "scanner": job.scanner,
            "input_uri": job.uri, "input_sha256": job.sha256,
            "model_version": self.cfg.model_version,
            "container_digest": self.cfg.container_digest,
            "training_data_version": self.cfg.training_data_version,
            "preprocessing_config_hash": self.pre_hash,
            "preprocessing_config": asdict(self.pre),
            "worker": self.cfg.pod_name,
            "attempt": msg.receive_count,
        }

    def _finish(self, summary: dict, job: SlideJob, msg: Message, summary_key: str,
                timings: dict, t_start: float) -> dict:
        """Cierra tiempos, escribe summary.json (commit) y el índice."""
        now = self.clock()
        available = job.available_at if job.available_at is not None else msg.sent_at
        summary["available_at"] = iso(available) if available else None
        summary["completed_at"] = iso(now)
        summary["turnaround_s"] = round(now - available, 1) if available else None
        t = time.monotonic()
        body = json.dumps(summary, indent=2, sort_keys=True).encode()
        self.storage.put_atomic(summary_key, body, "application/json")  # EL commit
        if self.index is not None:
            self.index.upsert(summary)  # si falla: error → reintento → rama "duplicate" repite el upsert
        timings["write_summary"] = round(time.monotonic() - t, 3)
        timings["total"] = round(time.monotonic() - t_start, 3)
        log_event("slide_done", slide_id=job.slide_id, status=summary["status"],
                  flags=summary["qc"]["flags"], timings=timings)
        return summary

    def _qc_blocked(self, job, msg, summary_key, flags, timings, t_start, lab, scanner, extra=None):
        for f in flags:
            self.metrics.qc_flags.labels(lab, scanner, f).inc()
        summary = self._header(job, msg, "qc_blocked")
        summary.update({"tissue_mm2": None, "tumor_mm2": None, "tumor_pct_of_tissue": None,
                        "qc": {"flags": flags, "blocking": True, **(extra or {})},
                        "timings_s": timings})
        return "qc_blocked", self._finish(summary, job, msg, summary_key, timings, t_start)

    def _process(self, job: SlideJob, msg: Message, lab: str, scanner: str) -> tuple[str, dict]:
        t_start = time.monotonic()
        timings: dict[str, float] = {}
        summary_key, run_prefix = self._keys(job)

        # 2. idempotencia: mismo archivo + mismo preprocesamiento + mismo modelo (está en la key)
        raw = self.storage.read(summary_key)
        if raw is not None:
            prev = json.loads(raw)
            if (prev.get("status") == "ok" and prev.get("input_sha256") == job.sha256
                    and prev.get("preprocessing_config_hash") == self.pre_hash):
                if self.index is not None:
                    self.index.upsert(prev)  # por si el intento anterior murió entre summary e índice
                log_event("duplicate_skipped", slide_id=job.slide_id, attempt=msg.receive_count)
                return "duplicate", prev
            # Un qc_blocked previo SÍ se reevalúa: quizá ya se registró el escáner o se corrigió
            # el metadato. Un sha distinto (reescaneo) también: el summary nuevo reemplaza al viejo.

        # 3. descarga + integridad
        self.cfg.work_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(job.uri).suffix or ".bin"  # OpenSlide detecta el formato por contenido, pero ayuda
        local = self.cfg.work_dir / f"{job.slide_id}{suffix}"
        t = time.monotonic()
        self.storage.download(job.uri, local)
        timings["download"] = round(time.monotonic() - t, 3)
        if self._stop.is_set():
            raise Interrupted()
        t = time.monotonic()
        actual = sha256_file(local)
        timings["sha256"] = round(time.monotonic() - t, 3)
        if actual != job.sha256:
            # No es QC: el archivo no es el que el evento anunció. Error → reintento → DLQ.
            self.metrics.qc_flags.labels(lab, scanner, "sha256_mismatch").inc()
            raise IntegrityError(f"sha256 esperado {job.sha256[:12]}…, obtenido {actual[:12]}…")

        slide = self.reader.open(local)
        try:
            return self._segment(job, msg, slide, summary_key, run_prefix, timings, t_start, lab, scanner)
        finally:
            slide.close()

    def _segment(self, job, msg, slide: Slide, summary_key, run_prefix, timings, t_start, lab, scanner):
        pre = self.pre
        # 4. QC del metadato ANTES de leer un solo pixel
        t = time.monotonic()
        mpp_x, mpp_y = slide.mpp
        nominal = self.cfg.scanners.get(job.scanner)
        flags = [] if nominal is not None else ["unknown_scanner"]  # escáner sin registrar: no se adivina
        flags += tiling.check_mpp(mpp_x, mpp_y, nominal, pre)
        if flags:
            return self._qc_blocked(job, msg, summary_key, flags, timings, t_start, lab, scanner,
                                    {"mpp": {"x": mpp_x, "y": mpp_y}, "nominal_mpp": nominal})
        mask_level = tiling.choose_mask_level(mpp_x, slide.level_downsamples, pre)
        if mask_level is None:
            return self._qc_blocked(job, msg, summary_key, ["no_low_res_level"], timings, t_start,
                                    lab, scanner)

        # máscara de tejido sobre el nivel grueso (≈ 4 µm/px): segundos, no minutos
        mask_mpp = mpp_x * slide.level_downsamples[mask_level]
        mw, mh = slide.level_dimensions[mask_level]
        thumb = slide.read_region(0, 0, mask_level, mw, mh)
        mask = tiling.tissue_mask(thumb, pre)
        tissue_mm2 = float(mask.sum()) * (mask_mpp * 1e-3) ** 2
        color_hist = tiling.color_histograms(thumb, mask, pre.color_bins)
        del thumb
        timings["qc_mask"] = round(time.monotonic() - t, 3)
        if tissue_mm2 < self.cfg.min_tissue_mm2:
            return self._qc_blocked(job, msg, summary_key, ["low_tissue"], timings, t_start, lab,
                                    scanner, {"tissue_mm2": round(tissue_mm2, 4)})

        # 5. tiles → GPU → stitch
        t = time.monotonic()
        plan = tiling.choose_read_plan(mpp_x, slide.level_downsamples, pre)
        w0, h0 = slide.dimensions
        w_model = int(w0 / plan.model_to_level0)  # ancho del slide a 0.5 µm/px
        h_model = int(h0 / plan.model_to_level0)
        tiles = tiling.plan_tiles(w_model, h_model, mask, mask_mpp, pre)
        stitcher = tiling.Stitcher(w_model, h_model, pre)
        checked, blurry = self._infer(slide, plan, tiles, stitcher)
        timings["inference"] = round(time.monotonic() - t, 3)
        self.metrics.tiles.labels(lab, scanner).inc(len(tiles))
        self.metrics.blur_checked.labels(lab, scanner).inc(checked)
        self.metrics.blurry.labels(lab, scanner).inc(blurry)

        # 6. números + artefactos (prefijo de la corrida) + summary.json al final
        t = time.monotonic()
        prob, covered = stitcher.result()
        tissue_on_map = tiling.resample_mask(mask, mask_mpp, pre.out_mpp, prob.shape)
        numbers, tumor = tiling.summarize(prob, covered, tissue_on_map, pre.out_mpp, pre.tumor_threshold)
        blurry_frac = blurry / checked if checked else 0.0
        flags = ["blurry"] if blurry_frac > self.cfg.blurry_frac_flag else []
        for f in flags:
            self.metrics.qc_flags.labels(lab, scanner, f).inc()
        map_to_level0 = pre.out_mpp / mpp_x  # 4 / 0.25 = 16 px de nivel 0 por px del mapa
        props = {"class": "tumor", "slide_id": job.slide_id, "model_version": self.cfg.model_version}
        geo = json.dumps(tumor_geojson(tumor, map_to_level0, props), separators=(",", ":")).encode()
        png = heatmap_png(prob)
        timings["postprocess"] = round(time.monotonic() - t, 3)
        t = time.monotonic()
        self.storage.put(f"{run_prefix}/tumor.geojson", geo, "application/geo+json")
        self.storage.put(f"{run_prefix}/heatmap.png", png, "image/png")
        timings["write_artifacts"] = round(time.monotonic() - t, 3)

        summary = self._header(job, msg, "ok")
        summary.update(numbers)
        summary.update({
            "tumor_threshold": pre.tumor_threshold,
            "mpp": {"x": mpp_x, "y": mpp_y},
            "read_plan": {"level": plan.level, "level_mpp": plan.level_mpp, "read_px": plan.read_px},
            "tiles": len(tiles),
            "qc": {"flags": flags, "blocking": False, "blurry_tile_frac": round(blurry_frac, 4),
                   "color_hist": color_hist, "color_hist_bins": pre.color_bins},
            "artifacts": {"tumor_geojson": f"{run_prefix}/tumor.geojson",
                          "heatmap_png": f"{run_prefix}/heatmap.png",
                          "map_mpp": pre.out_mpp, "map_to_level0": map_to_level0},
            "timings_s": timings,
        })
        if numbers["tumor_pct_of_tissue"] is not None:
            self.metrics.tumor_pct.labels(lab).observe(numbers["tumor_pct_of_tissue"])
        if numbers["mean_confidence"] is not None:
            self.metrics.confidence.labels(lab).observe(numbers["mean_confidence"])
        return "ok", self._finish(summary, job, msg, summary_key, timings, t_start)

    # ------------------------------------------------------------------ lectura + GPU
    def _read_tile(self, slide: Slide, plan: tiling.ReadPlan, tile: tiling.Tile) -> np.ndarray:
        x0 = round(tile.x * plan.model_to_level0)  # model px → level-0 px (× 2 en el caso)
        y0 = round(tile.y * plan.model_to_level0)
        region = slide.read_region(x0, y0, plan.level, plan.read_px, plan.read_px)
        return tiling.resize_to(region, self.pre.tile_px)

    def _iter_tiles(self, slide, plan, tiles) -> Iterator[tuple[tiling.Tile, np.ndarray]]:
        """Tiles leídos en `reader_threads` hilos, en orden, con una ventana ACOTADA en vuelo.

        Por qué la ventana: Executor.map encola TODAS las tareas de una vez; con 3,000 tiles y una
        GPU más lenta que los lectores, los tiles leídos se acumulan en RAM (≈ 0.8 MB cada uno a
        512², más la región de 1024² mientras se reduce). Aquí nunca hay más de
        batch_size × (prefetch_batches + 1) lecturas pendientes.
        """
        window = self.cfg.batch_size * (self.cfg.prefetch_batches + 1)
        it = iter(tiles)
        pending: collections.deque[tuple[tiling.Tile, Future]] = collections.deque()
        with ThreadPoolExecutor(self.cfg.reader_threads, thread_name_prefix="reader") as ex:
            try:
                for t in it:
                    pending.append((t, ex.submit(self._read_tile, slide, plan, t)))
                    if len(pending) >= window:
                        break
                while pending:
                    tile, fut = pending.popleft()
                    img = fut.result()  # re-lanza aquí cualquier error de lectura
                    nxt = next(it, None)
                    if nxt is not None:
                        pending.append((nxt, ex.submit(self._read_tile, slide, plan, nxt)))
                    yield tile, img
            finally:
                for _, fut in pending:  # SIGTERM o error: no leer lo que ya no se va a usar
                    fut.cancel()

    def _infer(self, slide, plan, tiles, stitcher: tiling.Stitcher) -> tuple[int, int]:
        """Batches a la GPU y al stitcher. Devuelve (tiles evaluados por blur, tiles borrosos)."""
        checked = blurry = 0
        batch_t: list[tiling.Tile] = []
        batch_x: list[np.ndarray] = []

        def flush() -> None:
            if self._stop.is_set():  # punto de control: como mucho se pierde el batch en curso
                raise Interrupted()
            probs = np.asarray(self.model.predict(np.stack(batch_x)))
            n, px = len(batch_x), self.pre.tile_px
            if probs.shape != (n, px, px):
                raise ModelOutputError(f"forma {probs.shape}, esperaba {(n, px, px)}")
            # NaN >= 0.5 es False: sin este chequeo, un overflow en FP16 se vería como "sin tumor"
            if not np.isfinite(probs).all() or probs.min() < -1e-3 or probs.max() > 1 + 1e-3:
                raise ModelOutputError("probabilidades fuera de [0, 1] o no finitas")
            for tile, p in zip(batch_t, probs):
                stitcher.add(tile.x, tile.y, np.clip(p, 0.0, 1.0))
            batch_t.clear()
            batch_x.clear()
            self._alive()

        for tile, img in self._iter_tiles(slide, plan, tiles):
            if tile.tissue_frac >= self.pre.blur_min_tissue_frac:
                checked += 1
                blurry += tiling.laplacian_variance(img) < self.pre.blur_lapvar_min
            batch_t.append(tile)
            batch_x.append(img)
            if len(batch_x) == self.cfg.batch_size:
                flush()
        if batch_x:
            flush()
        return checked, int(blurry)


# ============================================================================ adaptadores reales
class SqsQueue:
    """Queue sobre Amazon SQS (boto3). Probado contra moto (emulador), no contra AWS real.

    Atributos de la cola que este código asume (se configuran con IaC, no aquí):
    VisibilityTimeout 300 · ReceiveMessageWaitTimeSeconds 20 · RedrivePolicy
    {"deadLetterTargetArn": <slide-jobs-dlq>, "maxReceiveCount": 3} · retención de la DLQ (14 días)
    MAYOR que la de la cola (4 días): en colas estándar el vencimiento cuenta desde el envío original.
    """

    def __init__(self, client, queue_url: str):
        self._c, self._url = client, queue_url  # el read_timeout de botocore (60 s) > WaitTimeSeconds

    def receive(self, wait_s: int) -> Optional[Message]:
        r = self._c.receive_message(
            QueueUrl=self._url, MaxNumberOfMessages=1, WaitTimeSeconds=wait_s,
            # MessageSystemAttributeNames reemplaza al viejo AttributeNames (deprecado en boto3)
            MessageSystemAttributeNames=["ApproximateReceiveCount", "SentTimestamp"])
        msgs = r.get("Messages", [])
        if not msgs:
            return None
        m = msgs[0]
        a = m.get("Attributes", {})
        sent = a.get("SentTimestamp")
        return Message(body=m["Body"], receipt=m["ReceiptHandle"],
                       receive_count=int(a.get("ApproximateReceiveCount", "1")),
                       sent_at=int(sent) / 1000 if sent else None, message_id=m.get("MessageId", ""))

    def extend_visibility(self, msg: Message, seconds: int) -> None:
        # Cuenta desde AHORA (no suma). Tope de SQS: 12 h desde la PRIMERA recepción, y renovar no lo reinicia.
        self._c.change_message_visibility(QueueUrl=self._url, ReceiptHandle=msg.receipt,
                                          VisibilityTimeout=seconds)

    def release(self, msg: Message) -> None:
        self.extend_visibility(msg, 0)  # visibilidad 0 = visible ya para el siguiente receive

    def delete(self, msg: Message) -> None:
        self._c.delete_message(QueueUrl=self._url, ReceiptHandle=msg.receipt)


class S3Storage:
    """Storage sobre S3. download usa GETs por rangos en paralelo (s3transfer). Probado con moto."""

    def __init__(self, client, results_bucket: str):
        from boto3.s3.transfer import TransferConfig

        self._c, self._bucket = client, results_bucket
        # 64 MiB por parte × 16 en paralelo: un WSI de 1 GB son 16 partes (≈ 5–10 s, estimado)
        self._tc = TransferConfig(multipart_threshold=64 * 2**20, multipart_chunksize=64 * 2**20,
                                  max_concurrency=16)

    @staticmethod
    def _split(uri: str) -> tuple[str, str]:
        bucket, _, key = uri[len("s3://"):].partition("/")
        return bucket, key

    def download(self, uri: str, dest: Path) -> None:
        bucket, key = self._split(uri)
        self._c.download_file(bucket, key, str(dest), Config=self._tc)

    def exists(self, key: str) -> bool:
        return self.read(key) is not None

    def read(self, key: str) -> Optional[bytes]:
        try:
            return self._c.get_object(Bucket=self._bucket, Key=key)["Body"].read()
        except self._c.exceptions.NoSuchKey:
            return None

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self._c.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    def put_atomic(self, key: str, data: bytes, content_type: str) -> None:
        # En S3 un PutObject ya es atómico: nadie lee un objeto a medias, y desde 2020 la lectura
        # posterior es fuertemente consistente. El orden (artefactos antes, summary al final) es lo
        # que hace atómico al RESULTADO completo.
        self.put(key, data, content_type)


class OpenSlideSlide:
    """Slide sobre OpenSlide (SVS/TIFF de los labs A y B; DICOM WSI del lab C desde OpenSlide 4.0.0).
    openslide_t se puede usar desde varios hilos sin lock (openslide.h), y openslide-python llama
    a la biblioteca con ctypes, que suelta el GIL: por eso los lectores son hilos y no procesos."""

    def __init__(self, path: Path):
        import openslide

        self._s = openslide.OpenSlide(str(path))
        self.dimensions = self._s.dimensions
        self.level_downsamples = tuple(float(d) for d in self._s.level_downsamples)
        self.level_dimensions = tuple(self._s.level_dimensions)
        props = self._s.properties

        def num(k: str) -> Optional[float]:
            try:
                return float(props[k])
            except (KeyError, ValueError):
                return None

        self.mpp = (num(openslide.PROPERTY_NAME_MPP_X), num(openslide.PROPERTY_NAME_MPP_Y))
        self.vendor = props.get(openslide.PROPERTY_NAME_VENDOR)

    def read_region(self, x0: int, y0: int, level: int, w: int, h: int) -> np.ndarray:
        # read_region devuelve RGBA NO premultiplicado; fuera del escaneo, alfa 0. Se compone sobre
        # blanco: para el modelo y la máscara, "fuera del slide" debe verse como vidrio vacío.
        rgba = np.asarray(self._s.read_region((x0, y0), level, (w, h)), dtype=np.uint16)
        a = rgba[..., 3:4]
        return ((rgba[..., :3] * a + 255 * (255 - a)) // 255).astype(np.uint8)

    def close(self) -> None:
        self._s.close()


class OpenSlideReader:
    def open(self, path: Path) -> OpenSlideSlide:
        return OpenSlideSlide(path)


def load_model(engine_path: str) -> Model:
    """El Model real: un engine TensorRT FP16 construido con trtexec EN una L4 (sm_89) y con el MISMO
    TensorRT de la imagen (nvcr.io/nvidia/tensorrt:26.08-py3 → TensorRT 11.2.1.2). Un engine no es
    portable entre versiones de TensorRT ni entre arquitecturas de GPU.

    No se implementa aquí a propósito: sin una L4 no se puede probar, y código de GPU sin probar no
    se publica como referencia. Lo que haría: deserializar el engine con tensorrt.Runtime, un
    execution context con shape de entrada (batch, 512, 512, 3) o NCHW según cómo se exportó el
    ONNX, normalización idéntica a la de training, copia a la GPU, ejecución asíncrona en un stream
    y copia de vuelta. Revisa la API exacta en la documentación de TensorRT 11 antes de escribirlo.
    """
    raise NotImplementedError(f"Model de TensorRT no incluido (engine: {engine_path})")


def load_worker_config(env: dict) -> WorkerConfig:
    """WorkerConfig desde variables de entorno + worker.yaml (ConfigMap con labs y escáneres)."""
    import yaml

    with open(env.get("WORKER_CONFIG", "/config/worker.yaml")) as f:
        y = yaml.safe_load(f) or {}
    tunables = {k: y[k] for k in ("batch_size", "reader_threads", "prefetch_batches",
                                  "min_tissue_mm2", "blurry_frac_flag", "heartbeat_s",
                                  "visibility_s", "retry_backoff_s") if k in y}
    work_dir = Path(env.get("WORK_DIR", "/scratch"))
    return WorkerConfig(
        model_version=env["MODEL_VERSION"],  # sin versión no hay resultado trazable: KeyError al arrancar
        container_digest=env.get("CONTAINER_DIGEST", "unknown"),
        training_data_version=env.get("TRAINING_DATA_VERSION", "unknown"),
        work_dir=work_dir, labs=tuple(y.get("labs", ("A", "B", "C"))),
        scanners={str(k): float(v) for k, v in (y.get("scanners") or {}).items()},
        liveness_file=work_dir / "alive", pod_name=env.get("POD_NAME", "local"), **tunables)


def main() -> int:
    import boto3
    from botocore.config import Config
    from prometheus_client import start_http_server

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    env = dict(os.environ)
    cfg = load_worker_config(env)
    boto_cfg = Config(region_name=env["AWS_REGION"], retries={"mode": "standard", "max_attempts": 5})
    registry = CollectorRegistry()
    worker = Worker(
        queue=SqsQueue(boto3.client("sqs", config=boto_cfg), env["SQS_QUEUE_URL"]),
        storage=S3Storage(boto3.client("s3", config=boto_cfg), env["RESULTS_BUCKET"]),
        reader=OpenSlideReader(), model=load_model(env.get("MODEL_ENGINE_PATH", "/models/model.plan")),
        cfg=cfg, registry=registry)
    start_http_server(int(env.get("METRICS_PORT", "9100")), registry=registry)  # /metrics
    # SIGTERM (kubelet) y SIGINT (Ctrl-C): solo levantan la bandera; el loop termina limpio
    signal.signal(signal.SIGTERM, lambda *_: worker.request_stop())
    signal.signal(signal.SIGINT, lambda *_: worker.request_stop())
    log_event("worker_started", model_version=cfg.model_version, config_hash=worker.pre_hash)
    worker.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
