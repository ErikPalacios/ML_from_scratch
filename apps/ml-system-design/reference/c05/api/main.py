"""docs-api: recibe los documentos del cliente y responde en ≤ 3 s (p95) "recibido" o "súbelo de nuevo".

Lo que hace POST /v1/documents, en orden de costo (lo barato primero, para rechazar rápido):
  1. Límites: tamaño del request y de cada archivo (413), cantidad de archivos, tipo REAL por magic
     bytes (415; el Content-Type del cliente no se cree), páginas del PDF, PDF con contraseña.
  2. Dedupe por (application_id, sha256): el mismo archivo subido dos veces (doble clic, reintento del
     móvil con mala señal) devuelve el MISMO document_id con 200. Nunca dos ejecuciones ni dos tareas
     de revisión del mismo papel.
  3. Quality gate síncrono (pipeline/quality.py) en cada foto: borrosa, reflejo, baja resolución,
     cortada → 422 con motivos en español para el cliente, mientras todavía tiene el documento en la mano.
  4. Guarda las páginas en S3 (cifradas con KMS), registra el documento, arranca la ejecución de Step
     Functions con name = document_id y responde 202.

Lo que NO hace: OCR, clasificar ni extraer. Todo eso es asíncrono (Step Functions). Esta API es lo
único del sistema que ve el cliente, por eso su objetivo es 99.9 % y por eso no depende del OCR, del
modelo ni del SAT: si el pipeline está atrasado, la API igual recibe y el documento espera en S3.

Nunca perder un documento: si StartExecution falla DESPUÉS de guardar, respondemos 202 igual (el
documento ya está seguro en S3 y en la base) y `resume_unstarted` lo reintenta. StartExecution es
idempotente para Standard con el mismo name y el mismo input mientras la ejecución corre.

Interfaces (para probar sin AWS): DocumentRepo (Postgres en producción; aquí InMemoryRepo),
ObjectStore (S3Store), ExecutionStarter (StepFunctionsStarter). Los adaptadores de boto3 se prueban
contra moto en tests/test_adapters.py.

Privacidad: nunca se loguea el nombre original del archivo (la gente sube "INE_Juana_Perez.jpg"),
ni contenido, ni campos. Solo document_id, prefijo del sha256, tamaños y motivos.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import logging
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Protocol

import numpy as np
from fastapi import FastAPI, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from prometheus_client import CollectorRegistry, Counter, Histogram, generate_latest
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.exposition import CONTENT_TYPE_LATEST
from pypdf import PdfReader
from pypdf.errors import PdfReadError

import cfdi  # pipeline/cfdi.py: el MISMO parser que usa el pipeline
import quality  # pipeline/quality.py: la MISMA definición de "foto legible"

log = logging.getLogger("docs-api")


# ------------------------------------------------------------------------------------- settings
@dataclass(frozen=True)
class Settings:
    """Límites y destinos. Los defaults son los de esta referencia; en el pod llegan por variables de
    entorno (Settings.from_env), leídas al CREAR la app y no al importar el módulo."""

    bucket: str = "docs-raw-dev"
    kms_key_id: str | None = None  # None = la llave KMS por defecto (aws/s3); en producción, una propia
    state_machine_arn: str = ""
    max_request_bytes: int = 40 * 1024 * 1024
    max_file_bytes: int = 15 * 1024 * 1024
    max_images: int = 10  # un documento = 1 PDF, 1 XML o hasta 10 fotos (sus páginas)
    max_pdf_pages: int = 50  # un estado de cuenta típico tiene ≈ 8; 50 deja margen sin abrir la puerta a 3,000
    max_image_pixels: int = 60_000_000  # ≈ foto de 60 MP; corta las bombas de descompresión antes de decodificar
    analysis_long_side: int = quality.ANALYSIS_LONG_SIDE

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ
        return cls(
            bucket=e.get("DOCS_BUCKET", cls.bucket),
            kms_key_id=e.get("DOCS_KMS_KEY_ID") or None,
            state_machine_arn=e.get("STATE_MACHINE_ARN", ""),
            max_request_bytes=int(e.get("DOCS_MAX_REQUEST_BYTES", cls.max_request_bytes)),
            max_file_bytes=int(e.get("DOCS_MAX_FILE_BYTES", cls.max_file_bytes)),
            max_images=int(e.get("DOCS_MAX_IMAGES", cls.max_images)),
            max_pdf_pages=int(e.get("DOCS_MAX_PDF_PAGES", cls.max_pdf_pages)),
            max_image_pixels=int(e.get("DOCS_MAX_IMAGE_PIXELS", cls.max_image_pixels)),
        )


class DocType(str, Enum):
    """Tipo DECLARADO por el cliente (el hueco de la pantalla donde subió el archivo). El clasificador
    lo confirma después; aquí solo elige el perfil de calidad y qué formatos se aceptan."""

    factura = "factura"
    ine = "ine"
    comprobante_domicilio = "comprobante_domicilio"
    estado_cuenta = "estado_cuenta"
    solicitud = "solicitud"


# Estados del documento. "Automático" = lo está procesando el pipeline (DocPipelineBacklog lo vigila).
AUTOMATIC = {"received", "processing"}
REVIEW = {"in_review"}
UNFINISHED = AUTOMATIC | REVIEW


@dataclass
class DocRecord:
    document_id: str
    application_id: str
    sha256: str
    doc_type: str
    status: str  # receiving → received → processing → in_review → completed | manual_capture; upload_failed
    pages: list[dict] = field(default_factory=list)
    created_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))
    updated_at: dt.datetime = field(default_factory=lambda: dt.datetime.now(dt.timezone.utc))
    execution_arn: str | None = None


# ----------------------------------------------------------------------------------- interfaces
class DocumentRepo(Protocol):
    def find(self, application_id: str, sha256: str) -> DocRecord | None: ...
    def create_if_absent(self, rec: DocRecord) -> tuple[DocRecord, bool]: ...
    def get(self, document_id: str) -> DocRecord | None: ...
    def update(self, document_id: str, **changes) -> DocRecord: ...
    def list_status(self, status: str, older_than: dt.datetime) -> list[DocRecord]: ...
    def oldest_created(self, statuses: set[str]) -> dt.datetime | None: ...
    def ping(self) -> bool: ...


class ObjectStore(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...


class ExecutionStarter(Protocol):
    def start(self, name: str, payload: dict) -> str: ...


class InMemoryRepo:
    """Para tests y desarrollo. En Postgres, la garantía de create_if_absent la da
    `UNIQUE (application_id, sha256)` + `INSERT … ON CONFLICT DO NOTHING RETURNING …`: dos requests
    idénticos y simultáneos producen UN documento aunque lleguen a dos réplicas distintas."""

    def __init__(self) -> None:
        self._by_id: dict[str, DocRecord] = {}
        self._by_key: dict[tuple[str, str], str] = {}
        self._lock = threading.Lock()

    def find(self, application_id, sha256):
        with self._lock:
            doc_id = self._by_key.get((application_id, sha256))
            return replace(self._by_id[doc_id]) if doc_id else None

    def create_if_absent(self, rec):
        with self._lock:
            key = (rec.application_id, rec.sha256)
            if key in self._by_key:
                return replace(self._by_id[self._by_key[key]]), False
            self._by_key[key] = rec.document_id
            self._by_id[rec.document_id] = replace(rec)
            return replace(rec), True

    def get(self, document_id):
        with self._lock:
            rec = self._by_id.get(document_id)
            return replace(rec) if rec else None

    def update(self, document_id, **changes):
        with self._lock:
            rec = replace(self._by_id[document_id], **changes, updated_at=dt.datetime.now(dt.timezone.utc))
            self._by_id[document_id] = rec
            return replace(rec)

    def list_status(self, status, older_than):
        with self._lock:
            return [replace(r) for r in self._by_id.values() if r.status == status and r.updated_at < older_than]

    def oldest_created(self, statuses):
        with self._lock:
            ts = [r.created_at for r in self._by_id.values() if r.status in statuses]
            return min(ts) if ts else None

    def ping(self):
        return True


class S3Store:
    """S3 con cifrado SSE-KMS explícito en cada PutObject: no dependemos de que alguien no haya cambiado
    la configuración por defecto del bucket. Las INE y los estados de cuenta son datos personales."""

    def __init__(self, bucket: str, kms_key_id: str | None, client=None):
        import boto3  # import tardío: los tests de la API no necesitan boto3

        self.bucket, self.kms_key_id = bucket, kms_key_id
        self.s3 = client or boto3.client("s3")

    def put(self, key, data, content_type):
        extra = {"ServerSideEncryption": "aws:kms"}
        if self.kms_key_id:
            extra["SSEKMSKeyId"] = self.kms_key_id
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type, **extra)


class StepFunctionsStarter:
    """StartExecution con name = document_id. Para Standard es idempotente: mismo name + mismo input
    mientras corre → misma respuesta. Si la ejecución ya cerró (o el input difiere) AWS responde
    ExecutionAlreadyExists: el documento ya tuvo su ejecución y NO se relanza a ciegas (se loguea)."""

    def __init__(self, state_machine_arn: str, client=None):
        import boto3

        self.arn = state_machine_arn
        self.sfn = client or boto3.client("stepfunctions")

    def start(self, name, payload):
        try:
            resp = self.sfn.start_execution(stateMachineArn=self.arn, name=name,
                                            input=json.dumps(payload, sort_keys=True))
            return resp["executionArn"]
        except self.sfn.exceptions.ExecutionAlreadyExists:
            log.warning(json.dumps({"event": "execution_already_exists", "document_id": name}))
            return self.arn.replace(":stateMachine:", ":execution:") + ":" + name


# ------------------------------------------------------------------------------------ mensajes
# Para el CLIENTE: claros, accionables, en tuteo. Son parte del producto (los revisa UX), no logs.
CUSTOMER_MESSAGES = {
    "borrosa": "La foto salió borrosa. Apoya los codos o el teléfono, espera a que enfoque y vuelve a tomarla.",
    "reflejo": "Un reflejo tapa parte de tu INE. Aléjate de la luz directa o inclina un poco la credencial.",
    "baja_resolucion": "La imagen tiene muy poca resolución. Acércate para que el documento llene la foto.",
    "cortado": "Parece que una orilla del documento quedó fuera. Asegúrate de que se vean las cuatro esquinas.",
    "pdf_protegido": "El PDF tiene contraseña. Descárgalo de nuevo sin contraseña desde tu banco o proveedor.",
    "pdf_danado": "No pudimos abrir el PDF. Descárgalo de nuevo y vuelve a subirlo.",
    "demasiadas_paginas": "El PDF tiene demasiadas páginas para este documento.",
    "imagen_danada": "No pudimos abrir la imagen. Vuelve a tomar la foto.",
    "imagen_demasiado_grande": "La imagen es demasiado grande. Tómala con la cámara en su resolución normal.",
    "xml_no_cfdi": "El XML no es una factura electrónica (CFDI 4.0) válida. Sube el XML que te envió tu proveedor.",
    "tipo_no_soportado": "Sube un PDF, una foto JPG o PNG (o el XML, si es factura).",
    "heic": "Tu foto está en formato HEIC. Cámbiala a JPG en los ajustes de la cámara o súbela como captura.",
    "combinacion_invalida": "Sube un solo PDF, un solo XML o hasta 10 fotos del mismo documento.",
    "archivo_muy_grande": "El archivo es demasiado grande.",
}


class GateError(Exception):
    def __init__(self, status: int, code: str, page: int | None = None, outcome: str = "rejected_invalid"):
        super().__init__(code)
        self.status, self.code, self.page, self.outcome = status, code, page, outcome


def sniff(data: bytes) -> str:
    """Tipo real por los primeros bytes. El Content-Type y la extensión los decide el cliente."""
    head = data[:32]
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"mif1", b"heif"):
        return "heic"
    if head.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"<"):
        return "xml"
    return "unknown"


CONTENT_TYPES = {"pdf": "application/pdf", "jpeg": "image/jpeg", "png": "image/png", "xml": "application/xml"}
EXT = {"pdf": "pdf", "jpeg": "jpg", "png": "png", "xml": "xml"}


def load_image_for_gate(data: bytes, s: Settings) -> tuple[np.ndarray, tuple[int, int]]:
    """Decodifica rápido: para JPEG, `draft` pide al decodificador una escala 1/2, 1/4 u 1/8 (lo más
    caro de una foto de 12–50 MP es decodificarla completa). Devuelve el array y el tamaño ORIGINAL."""
    try:
        im = Image.open(io.BytesIO(data))
        w, h = im.size  # solo leyó el encabezado: todavía no decodifica
    except Image.DecompressionBombError as exc:  # Pillow corta por su cuenta las imágenes absurdas
        raise GateError(422, "imagen_demasiado_grande") from exc
    except (UnidentifiedImageError, OSError) as exc:
        raise GateError(422, "imagen_danada") from exc
    if w * h > s.max_image_pixels:
        raise GateError(422, "imagen_demasiado_grande")
    try:
        if im.format == "JPEG":
            im.draft("L", (s.analysis_long_side, s.analysis_long_side))
        im = ImageOps.exif_transpose(im)  # una foto vertical guardada "acostada" + la marca EXIF
        gray = np.asarray(im.convert("L"))
    except (OSError, ValueError) as exc:  # JPEG truncado, etc.
        raise GateError(422, "imagen_danada") from exc
    # Tras exif_transpose el ancho y el alto pueden intercambiarse; los DPI solo usan el lado largo.
    return gray, (w, h)


def check_pdf(data: bytes, s: Settings) -> int:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            # Textract no acepta PDFs con contraseña, y no vamos a pedirle la contraseña al cliente.
            raise GateError(422, "pdf_protegido")
        n = len(reader.pages)
    except GateError:
        raise
    except (PdfReadError, ValueError, KeyError, OSError) as exc:
        raise GateError(422, "pdf_danado") from exc
    if n == 0:
        raise GateError(422, "pdf_danado")
    if n > s.max_pdf_pages:
        raise GateError(422, "demasiadas_paginas")
    return n


# ------------------------------------------------------------------------------------- métricas
OUTCOMES = ("accepted", "duplicate", "rejected_quality", "rejected_invalid", "too_large", "unsupported_type", "error")


class _BacklogCollector:
    """docs_oldest_unfinished_age_seconds{phase}: edad del documento sin terminar más viejo, leída de
    la base en cada scrape. Ve TODO lo atascado (un StartExecution que nunca ocurrió, un worker caído,
    una ejecución colgada), no solo lo que llegó a una cola. Con varias réplicas, la alerta usa max()."""

    def __init__(self, repo: DocumentRepo):
        self.repo = repo

    def collect(self):
        g = GaugeMetricFamily("docs_oldest_unfinished_age_seconds",
                              "Edad del documento sin terminar más viejo, por fase", labels=["phase"])
        now = dt.datetime.now(dt.timezone.utc)
        for phase, statuses in (("automatic", AUTOMATIC), ("review", REVIEW)):
            oldest = self.repo.oldest_created(statuses)
            g.add_metric([phase], (now - oldest).total_seconds() if oldest else 0.0)
        yield g


@dataclass
class Metrics:
    registry: CollectorRegistry
    uploads: Counter
    rejections: Counter
    latency: Histogram
    start_failures: Counter


def make_metrics(repo: DocumentRepo) -> Metrics:
    reg = CollectorRegistry()  # un registry por app: los tests crean varias apps sin chocar
    m = Metrics(
        registry=reg,
        uploads=Counter("docs_uploads_total", "Uploads por tipo declarado y resultado", ["doc_type", "outcome"],
                        registry=reg),
        rejections=Counter("docs_quality_rejections_total", "Motivos de rechazo del quality gate",
                           ["doc_type", "reason"], registry=reg),
        # Bucket en 3 s: el SLO del gate es p95 ≤ 3 s, y sin ese bucket no se puede medir.
        latency=Histogram("docs_upload_seconds", "Latencia de POST /v1/documents", ["doc_type"],
                          buckets=(0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0), registry=reg),
        start_failures=Counter("docs_execution_start_failures_total", "StartExecution fallidos (los reintenta "
                               "resume_unstarted)", registry=reg),
    )
    # Series en 0 desde el arranque: un counter que nace en 1 es invisible para increase() (caso c04).
    for t in DocType:
        for o in OUTCOMES:
            m.uploads.labels(t.value, o)
        for r in ("borrosa", "reflejo", "baja_resolucion", "cortado"):
            m.rejections.labels(t.value, r)
    reg.register(_BacklogCollector(repo))
    return m


# ------------------------------------------------------------------------------------------ app
APP_ID_RE = r"^[A-Za-z0-9_-]{6,64}$"


def _err(status: int, code: str, page: int | None = None) -> JSONResponse:
    body = {"error": code, "message": CUSTOMER_MESSAGES.get(code, "No pudimos recibir tu documento.")}
    if page is not None:
        body["page"] = page
    return JSONResponse(body, status_code=status)


def create_app(settings: Settings, repo: DocumentRepo, store: ObjectStore, starter: ExecutionStarter) -> FastAPI:
    app = FastAPI(title="docs-api", version="1.0")
    metrics = make_metrics(repo)
    app.state.metrics, app.state.repo = metrics, repo

    @app.middleware("http")
    async def limit_body(request, call_next):
        # Content-Length declarado > límite → 413 SIN leer el cuerpo. El límite duro para cuerpos sin
        # Content-Length (chunked) lo pone el ingress/ALB delante: aquí no se puede cortar a medio parseo.
        cl = request.headers.get("content-length")
        if request.url.path == "/v1/documents" and cl and cl.isdigit() and int(cl) > settings.max_request_bytes:
            metrics.uploads.labels("desconocido", "too_large").inc()
            return _err(413, "archivo_muy_grande")
        return await call_next(request)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}  # liveness: el proceso responde; no mira dependencias

    @app.get("/readyz")
    def readyz():
        # readiness: sin base no hay dedupe ni registro → mejor que el balanceador no nos mande tráfico.
        return {"status": "ready"} if repo.ping() else JSONResponse({"status": "db_unavailable"}, status_code=503)

    @app.get("/metrics")
    def prom():
        return Response(generate_latest(metrics.registry), media_type=CONTENT_TYPE_LATEST)

    # `def` (no `async def`) a propósito: decodificar imágenes y calcular el Laplaciano es CPU; FastAPI
    # corre las funciones síncronas en un threadpool y el event loop sigue atendiendo /healthz.
    @app.post("/v1/documents", status_code=202)
    def upload(
        application_id: str = Form(..., pattern=APP_ID_RE),
        doc_type: DocType = Form(...),
        files: list[UploadFile] = File(...),
    ):
        t0 = time.perf_counter()
        resp = _handle_upload(settings, repo, store, starter, metrics, application_id, doc_type, files)
        metrics.latency.labels(doc_type.value).observe(time.perf_counter() - t0)
        return resp

    @app.get("/v1/documents/{document_id}")
    def status(document_id: str, application_id: str = Query(..., pattern=APP_ID_RE)):
        # En producción application_id sale del token del cliente, nunca de un parámetro que él controla.
        # 404 (no 403) si no es suyo: no confirmamos que ese document_id exista (IDOR).
        rec = repo.get(document_id)
        if rec is None or rec.application_id != application_id:
            return JSONResponse({"error": "no_encontrado"}, status_code=404)
        public = {"receiving": "processing", "received": "processing", "upload_failed": "upload_failed"}
        return {"document_id": rec.document_id, "doc_type": rec.doc_type,
                "status": public.get(rec.status, rec.status), "received_at": rec.created_at.isoformat()}

    return app


def _handle_upload(s, repo, store, starter, metrics, application_id, doc_type, files):
    dtype = doc_type.value
    try:
        pages = _read_and_check(s, dtype, files)
    except GateError as e:
        metrics.uploads.labels(dtype, e.outcome).inc()
        log.info(json.dumps({"event": "upload_rejected", "doc_type": dtype, "code": e.code, "page": e.page}))
        return _err(e.status, e.code, e.page)

    # sha256 del documento = sha256 de los sha256 de sus páginas, en orden.
    doc_sha = hashlib.sha256("".join(p["sha256"] for p in pages).encode()).hexdigest()

    # ---- dedupe ANTES del quality gate: un reintento del mismo archivo no paga otra vez la decodificación
    existing = repo.find(application_id, doc_sha)
    if existing and existing.status != "upload_failed":
        metrics.uploads.labels(dtype, "duplicate").inc()
        return _duplicate(existing)

    # ---- quality gate (solo fotos; los PDF escaneados se evalúan en el pipeline, página por página)
    reasons = []
    for i, p in enumerate(pages, start=1):
        if p["kind"] in ("jpeg", "png"):
            try:
                gray, size = load_image_for_gate(p["data"], s)
            except GateError as e:
                metrics.uploads.labels(dtype, "rejected_invalid").inc()
                return _err(e.status, e.code, i)
            rep = quality.assess(gray, quality.PROFILES[dtype], source_size=size)
            p["quality"] = rep.metrics
            reasons += [{"code": r, "page": i, "message": CUSTOMER_MESSAGES[r]} for r in rep.reasons]
    if reasons:
        metrics.uploads.labels(dtype, "rejected_quality").inc()
        for r in {r["code"] for r in reasons}:
            metrics.rejections.labels(dtype, r).inc()
        # Las fotos rechazadas NO se guardan: una INE ilegible no aporta nada y retenerla es riesgo.
        log.info(json.dumps({"event": "quality_rejected", "doc_type": dtype, "sha256": doc_sha[:12],
                             "reasons": sorted({r["code"] for r in reasons})}))
        return JSONResponse({"error": "calidad_insuficiente",
                             "message": "No pudimos leer bien tu documento. Revisa los motivos y vuelve a subirlo.",
                             "reasons": reasons}, status_code=422)

    # ---- registro (carrera: dos réplicas con el mismo archivo → una gana el INSERT)
    doc_id = existing.document_id if existing else str(uuid.uuid4())
    rec, created = repo.create_if_absent(DocRecord(doc_id, application_id, doc_sha, dtype, "receiving"))
    if not created and rec.status != "upload_failed":
        metrics.uploads.labels(dtype, "duplicate").inc()
        return _duplicate(rec)
    doc_id = rec.document_id

    # ---- guardar en S3 (cifrado KMS). Si falla, el cliente reintenta y caemos en upload_failed → reintento.
    stored = []
    try:
        for i, p in enumerate(pages, start=1):
            key = f"raw/{doc_id}/{i:02d}-{p['sha256'][:16]}.{EXT[p['kind']]}"
            store.put(key, p["data"], CONTENT_TYPES[p["kind"]])
            stored.append({"key": key, "content_type": CONTENT_TYPES[p["kind"]], "sha256": p["sha256"],
                           "bytes": len(p["data"]), "quality": p.get("quality")})
    except Exception:  # noqa: BLE001 — cualquier falla de almacenamiento se trata igual
        repo.update(doc_id, status="upload_failed")
        metrics.uploads.labels(dtype, "error").inc()
        log.exception(json.dumps({"event": "store_failed", "document_id": doc_id}))
        return JSONResponse({"error": "no_disponible", "message": "Intenta de nuevo en unos segundos."},
                            status_code=503, headers={"Retry-After": "5"})

    rec = repo.update(doc_id, status="received", pages=stored)
    _start(repo, starter, metrics, rec)
    metrics.uploads.labels(dtype, "accepted").inc()
    return JSONResponse({"document_id": doc_id, "status": "processing", "status_url": f"/v1/documents/{doc_id}"},
                        status_code=202)


def _read_and_check(s: Settings, dtype: str, files: list[UploadFile]) -> list[dict]:
    """Lee cada archivo con tope de bytes, detecta su tipo real y valida la combinación."""
    if not files:
        raise GateError(422, "combinacion_invalida")
    if len(files) > s.max_images:
        raise GateError(422, "combinacion_invalida")
    pages = []
    for i, f in enumerate(files, start=1):
        data = f.file.read(s.max_file_bytes + 1)  # nunca más del límite + 1 byte en memoria
        if len(data) > s.max_file_bytes:
            raise GateError(413, "archivo_muy_grande", i, outcome="too_large")
        kind = sniff(data)
        if kind == "heic":
            raise GateError(415, "heic", i, outcome="unsupported_type")
        if kind == "unknown" or (kind == "xml" and dtype != "factura"):
            raise GateError(415, "tipo_no_soportado", i, outcome="unsupported_type")
        pages.append({"kind": kind, "data": data, "sha256": hashlib.sha256(data).hexdigest()})
    kinds = {p["kind"] for p in pages}
    if ({"pdf", "xml"} & kinds) and len(pages) != 1:
        raise GateError(422, "combinacion_invalida")  # un PDF o un XML viaja solo
    p0 = pages[0]
    if p0["kind"] == "pdf":
        p0["pdf_pages"] = check_pdf(p0["data"], s)
    elif p0["kind"] == "xml":
        try:
            parsed = cfdi.parse_cfdi(p0["data"])  # rápido (ms) y nos ahorra correr un pipeline con basura
        except cfdi.CfdiError as exc:
            raise GateError(422, "xml_no_cfdi") from exc
        p0["cfdi_uuid"] = parsed.uuid
    return pages


def _duplicate(rec: DocRecord) -> JSONResponse:
    return JSONResponse({"document_id": rec.document_id, "status": "processing" if rec.status in
                         ("receiving", "received") else rec.status, "duplicate": True,
                         "status_url": f"/v1/documents/{rec.document_id}"}, status_code=200)


def execution_input(rec: DocRecord) -> dict:
    """Input de la máquina de estados: solo REFERENCIAS (llaves de S3), nunca el contenido. Step Functions
    limita el input y el estado a 256 KiB; un estado de cuenta de 8 páginas no cabe y además no debe
    quedar copiado en el historial de ejecuciones."""
    return {"document_id": rec.document_id, "application_id": rec.application_id, "declared_type": rec.doc_type,
            "sha256": rec.sha256, "pages": [{k: p[k] for k in ("key", "content_type", "sha256")} for p in rec.pages],
            "received_at": rec.created_at.isoformat()}


def _start(repo: DocumentRepo, starter: ExecutionStarter, metrics: Metrics, rec: DocRecord) -> bool:
    try:
        arn = starter.start(rec.document_id, execution_input(rec))
    except Exception:  # noqa: BLE001 — el documento ya está a salvo; resume_unstarted lo reintenta
        metrics.start_failures.inc()
        log.exception(json.dumps({"event": "start_failed", "document_id": rec.document_id}))
        return False
    repo.update(rec.document_id, status="processing", execution_arn=arn)
    return True


def resume_unstarted(repo: DocumentRepo, starter: ExecutionStarter, metrics: Metrics,
                     min_age: dt.timedelta = dt.timedelta(minutes=1)) -> int:
    """Barrido periódico (un CronJob cada minuto): documentos guardados cuya ejecución no arrancó.
    Es la mitad que falta del "nunca perder un documento": guardar primero, arrancar después, y un
    proceso que repara lo que quedó en medio. Reintentar es seguro porque StartExecution es idempotente."""
    older_than = dt.datetime.now(dt.timezone.utc) - min_age
    return sum(_start(repo, starter, metrics, r) for r in repo.list_status("received", older_than))


def build_default_app() -> FastAPI:
    """Wiring con adaptadores reales: `uvicorn main:build_default_app --factory`. El repo de Postgres
    no está incluido en esta referencia: InMemoryRepo solo sirve para desarrollo local (se pierde al
    reiniciar y no se comparte entre réplicas, así que con él no hay dedupe entre pods)."""
    s = Settings.from_env()
    return create_app(s, InMemoryRepo(), S3Store(s.bucket, s.kms_key_id), StepFunctionsStarter(s.state_machine_arn))
