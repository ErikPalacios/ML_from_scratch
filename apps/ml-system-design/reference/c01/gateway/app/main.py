"""Gateway HTTP del clasificador de categorías (caso c01).

Por qué existe un gateway en CPU delante de Triton: validar, decodificar y redimensionar imágenes es
trabajo de CPU; si lo hiciera Triton (python backend o DALI) competiría con la GPU cara. Así cada
capa escala por separado: gateway por CPU (HPA) y Triton por cola de GPU (KEDA).

Endpoints: POST /v1/classify?top_k=5 · GET /healthz (liveness) · GET /readyz (readiness) · GET /metrics
"""

from __future__ import annotations  # anotaciones como texto (sintaxis moderna sin coste en runtime)

import asyncio  # wait_for: el timeout de inferencia se impone del lado del cliente (ver _infer)
import hashlib  # sha256 de la imagen: une logs con labels futuros sin guardar la imagen
import json  # una línea JSON por request: la ingesta (Fluent Bit → S3) no necesita parsers
import logging  # a stdout: en un contenedor los logs son un stream, nunca archivos locales
import os  # configuración por variables de entorno: la misma imagen corre en dev, staging y prod
import sys  # sys.stdout como destino explícito de los logs
import time  # perf_counter: reloj monotónico para medir latencias
import uuid  # request_id propio cuando el caller no manda uno (el ALB no lo agrega: solo X-Amzn-Trace-Id)
from contextlib import asynccontextmanager  # lifespan: crear y cerrar recursos compartidos
from pathlib import Path  # ruta por defecto de labels.json, junto a este archivo

import aiohttp  # el cliente aio de Triton usa aiohttp: sus fallas de red llegan como aiohttp.ClientError
import numpy as np  # softmax y top-k sobre los 500 logits
import tritonclient.http.aio as triton_http  # cliente async de Triton: protocolo KServe v2 por HTTP
from fastapi import FastAPI, HTTPException, Query, Request, Response  # framework ASGI + validación
from fastapi.exception_handlers import request_validation_exception_handler  # el 422 por defecto de FastAPI
from fastapi.exceptions import RequestValidationError  # lo que lanza FastAPI si la query no valida (→ 422)
from PIL import Image  # límite global de píxeles de Pillow y su DecompressionBombError
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest  # métricas Prometheus
from starlette.concurrency import run_in_threadpool  # corre código bloqueante fuera del event loop
from starlette.requests import ClientDisconnect  # el cliente cerró la conexión mientras leíamos el body
from tritonclient.utils import InferenceServerException  # error que devuelve Triton (4xx/5xx)

from .preprocess import ImageTooLarge, preprocess  # EL MISMO preprocesamiento que training/eval

# ---------------------------------------------------------------------------- configuración
TRITON_URL = os.getenv("TRITON_URL", "localhost:8000")  # host:puerto HTTP de Triton, SIN "http://" (lo exige el cliente)
MODEL_NAME = os.getenv("MODEL_NAME", "classifier")  # nombre del modelo en el model repository de Triton
MODEL_VERSION = os.getenv("MODEL_VERSION", "dev")  # se devuelve y se loguea: cada predicción queda atada a su modelo
INFER_TIMEOUT_S = float(os.getenv("INFER_TIMEOUT_S", "0.15"))  # 150 ms para Triton dentro del p99 ≤ 200 ms
LABELS_PATH = os.getenv("LABELS_PATH", str(Path(__file__).with_name("labels.json")))  # índice de clase → nombre
# Decodes simultáneos por proceso: acota CPU y RAM. Pico medido de UN PNG de 40 MP: ≈ 320 MB
# (Pillow guarda RGB en 4 bytes/px = 160 MB, más las copias de exif_transpose y convert).
PREPROCESS_CONCURRENCY = int(os.getenv("PREPROCESS_CONCURRENCY", "2"))
# Load shedding: requests aceptados a la vez por proceso; el resto → 503 inmediato con Retry-After.
# ≈ lo que un pod completa en ≈ 200 ms (≈ 100 req/s × 0.2 s ≈ 20) y acotado por RAM: 16 bodies de
# hasta 10 MB = 160 MB, que caben en 1Gi junto a los decodes. Al pico hay ≈ 3–5 en vuelo por pod.
MAX_INFLIGHT = int(os.getenv("MAX_INFLIGHT", "16"))
SLOT_WAIT_S = 0.05  # espera máxima por un slot de CPU: si hay que esperar más, ya no cumple el SLO → 503
# Presupuesto total server-side (< 300 ms del caller). Cada etapa usa lo que queda: deadline propagation
REQUEST_DEADLINE_S = float(os.getenv("REQUEST_DEADLINE_S", "0.25"))
MAX_BYTES = 10 * 1024 * 1024  # 10 MB: tope de subida web (el app móvil manda ~150–250 KB)
MAX_PIXELS = 40_000_000  # 40 MP: por encima es casi seguro un error o un ataque
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}  # los únicos formatos que decodificamos
# Valores de x-client-source que se vuelven label: lista cerrada; un label libre explotaría la cardinalidad
SOURCES = {"mobile", "web", "internal"}
MAX_TOP_K = 20  # top_k acotado: nadie necesita 500 sugerencias y el log crecería sin control
# Segunda red de Pillow: avisa > 40 MP y falla > 80 MP aunque alguien se salte la guardia de decode()
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

# ---------------------------------------------------------------------------- métricas
# Nombres = contrato con monitoring/alerts.yml: si cambias uno aquí, rompes una alerta en silencio.
# Labels acotados: status (≈ 10 códigos) × source (4) × model_version (1–2 durante un canary)
REQUESTS = Counter(  # el cliente de Python agrega el sufijo _total; el nombre expuesto es este mismo
    "classifier_requests_total", "Requests a /v1/classify por código HTTP, caller y modelo",
    ["status", "source", "model_version"],  # status: "200", "503"… · source: mobile/web/internal/other
)
LATENCY = Histogram(  # latencia server-side; los buckets rodean al SLO (0.2 s) para que el p99 sea preciso
    "classifier_request_latency_seconds", "Latencia total de /v1/classify", ["source"],
    buckets=(0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 2.5),
)
PREPROCESS = Histogram(  # separar preprocess e inferencia dice a qué capa escalar cuando sube la latencia
    "classifier_preprocess_seconds", "Decode + resize + normalize (CPU)",
    buckets=(0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5),
)
INFERENCE = Histogram(  # ida y vuelta a Triton: red + cola de dynamic batching + cómputo en GPU
    "classifier_inference_seconds", "Llamada a Triton (round trip)",
    buckets=(0.005, 0.01, 0.02, 0.035, 0.05, 0.075, 0.1, 0.15, 0.3),
)
TOP1 = Histogram(  # distribución de confianza: la señal de drift más barata que existe (sin labels)
    "classifier_top1_score", "Score top-1 tras softmax", ["model_version"],  # separa canary de estable
    buckets=tuple(round(0.1 * i, 1) for i in range(1, 11)),  # 0.1 … 1.0 → el bucket le="0.3" alimenta una alerta
)
IMAGE_BYTES = Histogram(  # tamaño de entrada: explica cambios de latencia (p. ej. la web empieza a subir 12 MP)
    "classifier_image_bytes", "Bytes de la imagen recibida",
    buckets=(1e4, 5e4, 1e5, 2.5e5, 5e5, 1e6, 2.5e6, 5e6, 1e7),
)

# Logger propio a stdout, sin propagar al root (evita líneas duplicadas con los loggers de uvicorn)
log = logging.getLogger("classifier")
log.addHandler(logging.StreamHandler(sys.stdout))  # un handler: cada log.info es una línea JSON
log.setLevel(logging.INFO)
log.propagate = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Recursos compartidos: se crean con el event loop ya corriendo y se cierran al apagar."""
    # Etiquetas en memoria: 500 strings, índice = id de clase del training (mismo orden que el dataset)
    app.state.labels = json.loads(Path(LABELS_PATH).read_text(encoding="utf-8"))
    # Sin este límite el threadpool (40 hilos por defecto) decodificaría 40 imágenes a la vez en un
    # pod de 1 CPU: más latencia para todas y riesgo de OOMKilled. Los demás esperan como mucho
    # SLOT_WAIT_S; si no, 503.
    app.state.cpu_slots = asyncio.Semaphore(PREPROCESS_CONCURRENCY)
    app.state.inflight = 0  # requests aceptados en este proceso; sin lock: el event loop es un solo hilo
    # UN cliente por proceso: reutiliza conexiones keep-alive (sin handshake TCP por request).
    # conn_limit = máximo de requests en vuelo hacia Triton (backpressure); conn_timeout es un
    # timeout total de aiohttp para CUALQUIER llamada: queda de respaldo (el fino va en _infer).
    # Se crea aquí y no al importar: aiohttp necesita un event loop corriendo.
    app.state.triton = triton_http.InferenceServerClient(url=TRITON_URL, conn_limit=64, conn_timeout=1.0)
    yield  # aquí la app atiende tráfico
    await app.state.triton.close()  # cierra el pool de conexiones limpiamente en el SIGTERM


app = FastAPI(title="classifier-gateway", lifespan=lifespan)  # lifespan reemplaza a on_event


@app.get("/metrics", include_in_schema=False)
def metrics() -> Response:
    """Endpoint que scrapea Prometheus. Con 1 proceso por contenedor basta el registro por defecto.

    Verificado: app.mount("/metrics", make_asgi_app()) (lo que sugiere la doc) responde 307 →
    /metrics/ en Starlette; Prometheus sigue el redirect, pero cada scrape serían dos requests.
    Con gunicorn/uvicorn --workers N necesitarías el modo multiproceso de prometheus_client.
    """
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)  # formato de texto de Prometheus


async def _read_body_limited(request: Request) -> bytes:
    """Lee el body en streaming y corta en cuanto pasa de MAX_BYTES (no confía en Content-Length)."""
    chunks, size = [], 0  # acumulamos trozos para no copiar el buffer en cada iteración
    try:
        async for chunk in request.stream():  # llega por partes: podemos abortar sin leer 1 GB
            size += len(chunk)
            if size > MAX_BYTES:  # un cliente con chunked encoding o que miente en Content-Length
                raise HTTPException(413, "la imagen supera 10 MB")
            chunks.append(chunk)
    except ClientDisconnect:
        # El cliente cortó a mitad del upload (red móvil, app cerrada): no es una falla del servidor.
        # Sin esto contaría como 500 (con traceback) e inflaría ClassifierHigh5xxRate. 499 es la
        # convención de nginx ("client closed request"): queda con los 4xx, fuera de la tasa de 5xx.
        # Nadie recibe esta respuesta: uvicorn descarta lo que se manda a un cliente que ya se fue.
        raise HTTPException(499, "el cliente cerró la conexión antes de terminar el upload") from None
    if size == 0:  # body vacío: error del cliente, no vale la pena llegar al decoder
        raise HTTPException(400, "body vacío: envía los bytes de la imagen")
    return b"".join(chunks)


def _decode_and_hash(data: bytes) -> tuple[np.ndarray, str]:
    """CPU pura (bloqueante): corre en el threadpool. Pillow y numpy sueltan el GIL en decode y resize."""
    digest = hashlib.sha256(data).hexdigest()  # huella de la imagen: deduplicar y cruzar con labels
    tensor = preprocess(data, max_pixels=MAX_PIXELS)  # float32 [3,224,224], idéntico a training/eval
    return tensor[np.newaxis], digest  # batch de 1: Triton junta requests con dynamic batching


async def _infer(client, batch: np.ndarray, request_id: str, timeout: float = INFER_TIMEOUT_S) -> np.ndarray:
    """Llama a Triton y traduce sus fallas a códigos HTTP útiles para el cliente."""
    inp = triton_http.InferInput("input", list(batch.shape), "FP32")  # nombre, shape y dtype = config.pbtxt
    # binary tensor extension: 602 KB crudos detrás del header JSON, en vez de 150k floats como texto
    inp.set_data_from_numpy(batch, binary_data=True)
    out = triton_http.InferRequestedOutput("logits", binary_data=True)  # la respuesta también en binario
    try:
        # Verificado en tritonclient 2.72: el parámetro `timeout` de infer() NO es un timeout del
        # cliente, es un parámetro en microsegundos que Triton aplica en SU cola (solo con dynamic
        # batching). El único timeout del cliente aio es conn_timeout, global para toda la sesión.
        # Por eso el presupuesto por request se impone con asyncio.wait_for, que además cancela la
        # petición HTTP en vuelo.
        result = await asyncio.wait_for(
            client.infer(MODEL_NAME, [inp], outputs=[out], request_id=request_id),
            timeout=timeout,  # ≤ INFER_TIMEOUT_S: lo que quede del presupuesto del request
        )
    except TimeoutError:  # asyncio.TimeoutError es alias de TimeoutError desde Python 3.11
        # 504: Triton está vivo pero lento (cola llena, GPU saturada); el cliente cae a su fallback
        raise HTTPException(504, "timeout de inferencia") from None
    except aiohttp.ClientError:  # conexión rechazada/reseteada, DNS: Triton caído o reiniciando
        raise HTTPException(503, "Triton no disponible", headers={"Retry-After": "1"}) from None
    except InferenceServerException as exc:  # Triton respondió error: modelo no cargado, request rechazado
        detail = f"Triton rechazó la inferencia: {exc.message()}"
        raise HTTPException(503, detail, headers={"Retry-After": "1"}) from None
    logits = result.as_numpy("logits")[0]  # [500] logits del único elemento del batch
    # Un engine roto (FP16 desbordado, pesos corruptos) puede devolver NaN o inf. Sin esta guardia, FastAPI
    # fallaría al serializar la respuesta (JSONResponse usa allow_nan=False) DESPUÉS del finally de classify:
    # el cliente recibiría un 500 mientras la línea de log y la métrica dicen 200, y la suma de TOP1 quedaría
    # en NaN hasta que el pod reinicie. Así es un 500 que la alerta de 5xx sí ve.
    if not np.isfinite(logits).all():
        raise HTTPException(500, "Triton devolvió logits no finitos (NaN o inf)")
    return logits


def _budget_left(deadline: float) -> float:
    """Segundos que quedan del presupuesto. Agotado → 504: no gastes CPU ni GPU en un request abandonado."""
    left = deadline - time.perf_counter()
    if left <= 0:
        raise HTTPException(504, "se agotó el presupuesto del request")
    return left


def _softmax(logits: np.ndarray) -> np.ndarray:
    """Softmax estable. El modelo devuelve logits (no probabilidades) para poder calibrar aquí."""
    z = logits.astype(np.float64) - logits.max()  # restar el máximo evita overflow en exp()
    e = np.exp(z)
    return e / e.sum()


@app.post("/v1/classify")
async def classify(request: Request, response: Response, top_k: int = Query(5, ge=1, le=MAX_TOP_K)):
    """Body = bytes crudos de la imagen (no multipart: menos parsing, sin archivos temporales)."""
    t0 = time.perf_counter()  # el reloj arranca con el request ya recibido (el SLO es server-side)
    # Si el cliente (o un proxy) ya trae un id lo respetamos: así se traza el request de punta a punta
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    record = {  # la línea de log que se escribe SIEMPRE, también en errores
        "event": "classify",
        "request_id": request_id,
        "model_version": MODEL_VERSION,
        # Autodeclarado: solo sirve para partir el monitoreo (mobile/web/interno), NO es identidad.
        # Cuotas y prioridad se basan en la identidad verificada en el borde (JWT de servicio o mTLS).
        "source": request.headers.get("x-client-source", "unknown"),
    }
    status = 500  # si algo inesperado explota, se cuenta como 500
    try:
        state = request.app.state
        if state.inflight >= MAX_INFLIGHT:  # fallar rápido (µs) > encolar lo que va a vencer de todos modos
            raise HTTPException(503, "gateway saturado: reintenta más tarde", headers={"Retry-After": "1"})
        state.inflight += 1
        try:
            result = await _classify(request, top_k, record, deadline=t0 + REQUEST_DEADLINE_S)
        finally:
            state.inflight -= 1  # siempre, también si _classify lanza
        status = 200
        response.headers["X-Request-ID"] = request_id  # el cliente puede reportar un caso con este id
        result["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        return result
    except HTTPException as exc:
        status = exc.status_code
        record["error"] = exc.detail
        # Re-lanzamos con el X-Request-ID para que también los errores sean trazables
        headers = {**(exc.headers or {}), "X-Request-ID": request_id}
        raise HTTPException(exc.status_code, exc.detail, headers=headers) from None
    finally:
        elapsed = time.perf_counter() - t0
        source = record["source"] if record["source"] in SOURCES else "other"  # cardinalidad acotada
        # Alimenta la alerta de 5xx y los paneles por caller y por modelo (canary vs estable)
        REQUESTS.labels(status=str(status), source=source, model_version=MODEL_VERSION).inc()
        if not 400 <= status < 500:  # los 4xx son rechazos rápidos: incluirlos "mejoraría" el p99 falsamente
            LATENCY.labels(source=source).observe(elapsed)
        record.update(status=status, latency_ms=round(elapsed * 1000, 1))
        # Sin imagen cruda ni PII (ni IP ni user id): solo lo necesario para monitorear y etiquetar
        log.info(json.dumps(record, ensure_ascii=False))


async def _classify(request: Request, top_k: int, record: dict, deadline: float) -> dict:
    """Validación barata primero, CPU después, GPU al final: rechazar pronto cuesta menos.

    `deadline` (reloj perf_counter) es el presupuesto del request: cada etapa usa lo que queda y, si
    ya no alcanza, corta con 504 en vez de hacer trabajo que el caller ya abandonó.
    """
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()  # sin "; charset=…"
    if ctype not in ALLOWED_TYPES:
        raise HTTPException(415, "Content-Type debe ser image/jpeg, image/png o image/webp")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BYTES:  # rechazo sin leer ni un byte del body
        raise HTTPException(413, "la imagen supera 10 MB")
    data = await _read_body_limited(request)  # segunda verificación: los bytes reales
    IMAGE_BYTES.observe(len(data))
    record["image_bytes"] = len(data)

    _budget_left(deadline)  # si leer el body ya se comió el presupuesto, ni siquiera decodificamos
    # Decode + resize son CPU pura. Una ruta `async def` que los corre directo BLOQUEA el event loop:
    # mientras decodifica una foto de 12 MP ninguna otra request avanza. En el threadpool el loop sigue
    # atendiendo I/O (otras llamadas a Triton, health checks). Máximo PREPROCESS_CONCURRENCY a la vez;
    # esperar un slot más de SLOT_WAIT_S → 503 (el pod está saturado de CPU).
    slots = request.app.state.cpu_slots
    try:
        await asyncio.wait_for(slots.acquire(), timeout=SLOT_WAIT_S)
    except TimeoutError:
        raise HTTPException(503, "gateway saturado (CPU)", headers={"Retry-After": "1"}) from None
    t = time.perf_counter()  # el reloj arranca con el slot tomado: mide CPU, no cola
    try:
        # Aquí no hay timeout a propósito: un hilo no se puede cancelar. Si cortáramos el await, el
        # slot se liberaría con el hilo todavía decodificando y el tope de RAM dejaría de valer.
        batch, digest = await run_in_threadpool(_decode_and_hash, data)
    except (ImageTooLarge, Image.DecompressionBombError) as exc:  # ImageTooLarge antes que ValueError
        raise HTTPException(413, str(exc)) from None
    except (OSError, ValueError, SyntaxError):  # lo que lanza Pillow con archivos corruptos o truncados
        raise HTTPException(400, "no se pudo decodificar la imagen") from None
    finally:
        slots.release()  # siempre: también en 400/413
    pre_s = time.perf_counter() - t
    PREPROCESS.observe(pre_s)
    record["preprocess_ms"] = round(pre_s * 1000, 1)  # desglose en el log: ¿lento por CPU o por GPU?
    record["image_sha256"] = digest[:16]  # un prefijo basta para cruzar; no es un identificador de usuario

    left = _budget_left(deadline)  # no mandes a la GPU un request que el caller ya abandonó
    t = time.perf_counter()
    try:
        logits = await _infer(  # I/O: aquí el await sí cede el loop
            request.app.state.triton, batch, record["request_id"], timeout=min(INFER_TIMEOUT_S, left)
        )
    finally:
        # También si Triton falla (503) o no contesta a tiempo (504): un timeout es la llamada MÁS lenta,
        # no una que falta. Si no entrara, el p99 de inferencia se vería sano justo cuando Triton está
        # lento, y el desglose no cuadraría con la latencia total, que sí cuenta los 5xx.
        inf_s = time.perf_counter() - t
        INFERENCE.observe(inf_s)
        record["inference_ms"] = round(inf_s * 1000, 1)

    probs = _softmax(logits)
    top = np.argsort(probs)[::-1][:top_k]  # 500 clases: ordenar todo cuesta microsegundos
    labels = request.app.state.labels
    TOP1.labels(model_version=MODEL_VERSION).observe(float(probs[top[0]]))  # → alerta ClassifierLowConfidenceSpike
    record["top_k"] = [[int(i), round(float(probs[i]), 4)] for i in top]  # ids + scores para monitoreo/labeling
    return {
        "model_version": MODEL_VERSION,  # el cliente (y los logs) saben qué modelo respondió
        "predictions": [{"label": labels[i], "score": round(float(probs[i]), 4)} for i in top],
    }


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> Response:
    """422 (p. ej. top_k=0): FastAPI valida la query ANTES de llamar a classify, así que su finally no corre.

    Sin este handler el 422 no dejaría línea de log ni métrica (uvicorn corre con --no-access-log): una ola
    de 422 tras un release del caller solo se vería en el ALB. Se anota como los demás 4xx y responde el
    handler por defecto de FastAPI (mismo body). /v1/classify es la única ruta con parámetros.
    """
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    source = request.headers.get("x-client-source", "unknown")
    REQUESTS.labels(status="422", source=source if source in SOURCES else "other", model_version=MODEL_VERSION).inc()
    # Dónde y qué falló, sin el `input` de cada error: puede traer cualquier cosa que mandó el cliente
    error = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
    record = {  # los campos de la línea de classify que se conocen sin leer el body; sin latencia (es un 4xx)
        "event": "classify", "request_id": request_id, "model_version": MODEL_VERSION, "source": source,
        "error": error, "status": 422,
    }
    log.info(json.dumps(record, ensure_ascii=False))
    response = await request_validation_exception_handler(request, exc)
    response.headers["X-Request-ID"] = request_id  # trazable, como los errores que decide classify
    return response


@app.get("/healthz")
async def healthz():
    """Liveness: ¿el proceso responde? SIN dependencias: si Triton cae, reiniciar el gateway no ayuda."""
    return {"status": "ok"}


@app.get("/readyz")
async def readyz(request: Request):
    """Readiness: ¿puedo recibir tráfico? Sí solo si el modelo está listo en Triton.

    Si Triton cae, TODOS los gateways quedan NotReady, el ALB se queda sin targets y responde 503: aceptable,
    porque sin Triton el gateway no sirve de nada. Lo que nunca debes hacer es poner esta dependencia
    en liveness: el kubelet reiniciaría en cascada pods sanos.
    """
    try:
        # 0.5 s máximo: el probe del kubelet tiene su propio timeout y no queremos colgarlo
        ready = await asyncio.wait_for(request.app.state.triton.is_model_ready(MODEL_NAME), timeout=0.5)
    except (TimeoutError, aiohttp.ClientError, InferenceServerException):
        ready = False  # cualquier falla hablando con Triton = no listo
    if not ready:
        raise HTTPException(503, "el modelo no está listo en Triton")
    return {"status": "ready", "model": MODEL_NAME, "model_version": MODEL_VERSION}
