"""Tests del gateway SIN GPU ni Triton: un cliente falso reemplaza a tritonclient (caso c01).

Por qué un fake y no un mock genérico: el fake respeta el contrato real del cliente aio (mismos
métodos async, mismas excepciones) y el gateway sigue construyendo InferInput/InferRequestedOutput
REALES, así que el test detecta si alguien cambia el nombre, shape o dtype del tensor.
Correr: cd gateway && pytest
"""

import asyncio  # el fake "lento" duerme para provocar el timeout del gateway
import io  # imágenes de prueba generadas en memoria, sin archivos en el repo
import re  # /metrics: buscar un par label="valor" sin depender del orden de los labels

import aiohttp  # la excepción de red que lanzaría el cliente real si Triton está caído
import numpy as np  # logits falsos con un top-1 conocido
import pytest
from fastapi.testclient import TestClient  # corre la app ASGI en proceso, incluido el lifespan
from PIL import Image  # genera JPEG/PNG/WebP válidos
from tritonclient.utils import InferenceServerException  # el error "Triton respondió mal"

from app import main  # la app real, tal como la carga uvicorn

TOP_CLASS = 7  # clase con el logit más alto en el fake: el test sabe qué label debe salir primero


class FakeResult:
    """Imita tritonclient.http.InferResult: solo necesitamos as_numpy()."""

    def __init__(self, logits):
        self._logits = logits

    def as_numpy(self, name):
        return self._logits if name == "logits" else None  # como el real: None si el output no existe


class FakeTriton:
    """Doble de tritonclient.http.aio.InferenceServerClient con cuatro modos de comportamiento."""

    mode = "ok"  # ok | down (sin red) | slow (no responde a tiempo) | reject (Triton devuelve error)

    def __init__(self, url, conn_limit=100, conn_timeout=60.0, **kwargs):  # misma firma que el real
        self.url = url
        self.calls = []  # guardamos lo que el gateway envía para verificar el contrato del tensor

    async def infer(self, model_name, inputs, outputs=None, request_id="", **kwargs):
        self.calls.append({"model": model_name, "inputs": inputs, "outputs": outputs})
        if self.mode == "down":
            raise aiohttp.ClientConnectionError("connection refused")  # lo que se ve si el pod de Triton murió
        if self.mode == "slow":
            await asyncio.sleep(1.0)  # más que INFER_TIMEOUT_S (0.15 s): el gateway debe cortar antes
        if self.mode == "reject":
            raise InferenceServerException("Request for unknown model", status="400")
        logits = np.linspace(-2, 2, 500, dtype=np.float32)[np.newaxis]  # [1,500], el shape real
        logits[0, TOP_CLASS] = 12.0  # top-1 claro
        return FakeResult(logits)

    async def is_model_ready(self, model_name, model_version=""):
        if self.mode == "down":
            raise aiohttp.ClientConnectionError("connection refused")
        return self.mode != "reject"  # "reject" simula un modelo que no cargó

    async def close(self):
        pass  # el real cierra el pool de aiohttp


@pytest.fixture
def api(monkeypatch):
    """App con el fake inyectado. `with TestClient` ejecuta el lifespan (crea y cierra el cliente)."""
    FakeTriton.mode = "ok"
    monkeypatch.setattr(main.triton_http, "InferenceServerClient", FakeTriton)
    with TestClient(main.app) as client:
        yield client


def image_bytes(fmt="JPEG", size=(640, 480), mode="RGB"):
    """Imagen válida en memoria (con algo de contenido para que el decoder trabaje de verdad)."""
    img = Image.new(mode, size, color=0)
    if mode == "RGB":
        img = Image.fromarray(np.random.default_rng(0).integers(0, 255, (size[1], size[0], 3), dtype=np.uint8))
    buf = io.BytesIO()
    img.save(buf, fmt)
    return buf.getvalue()


def post(client, data, ctype="image/jpeg", **params):
    return client.post("/v1/classify", content=data, headers={"Content-Type": ctype}, params=params)


# ------------------------------------------------------------------------------ camino feliz
def test_classify_ok_respects_top_k_and_contract(api):
    r = post(api, image_bytes(), top_k=3)
    assert r.status_code == 200
    body = r.json()
    assert body["model_version"] == main.MODEL_VERSION  # el cliente sabe qué modelo respondió
    assert len(body["predictions"]) == 3  # top_k respetado
    assert body["predictions"][0]["label"] == api.app.state.labels[TOP_CLASS]  # índice → label correcto
    scores = [p["score"] for p in body["predictions"]]
    assert scores == sorted(scores, reverse=True) and 0 < scores[0] <= 1  # probabilidades ordenadas
    assert body["latency_ms"] >= 0 and r.headers["X-Request-ID"]  # latencia y trazabilidad
    call = api.app.state.triton.calls[-1]  # lo que viajaría a Triton: debe coincidir con config.pbtxt
    assert call["model"] == "classifier"
    assert call["inputs"][0].name() == "input" and call["inputs"][0].datatype() == "FP32"
    assert call["inputs"][0].shape() == [1, 3, 224, 224]
    assert call["outputs"][0].name() == "logits"


@pytest.mark.parametrize("fmt,ctype", [("PNG", "image/png"), ("WEBP", "image/webp")])
def test_other_formats_and_default_top_k(api, fmt, ctype):
    r = post(api, image_bytes(fmt), ctype=ctype)
    assert r.status_code == 200 and len(r.json()["predictions"]) == 5  # top_k por defecto = 5


def test_request_id_is_propagated(api):
    r = api.post("/v1/classify", content=image_bytes(), headers={"Content-Type": "image/jpeg", "X-Request-ID": "abc123"})
    assert r.headers["X-Request-ID"] == "abc123"  # respeta el id que manda el ALB o el cliente


# ------------------------------------------------------------------------------ errores del cliente (4xx)
def test_unsupported_content_type_is_415(api):
    assert post(api, b"GIF89a....", ctype="image/gif").status_code == 415
    assert post(api, image_bytes(), ctype="application/octet-stream").status_code == 415


def test_body_over_10mb_is_413_by_content_length(api):
    assert post(api, b"\xff" * (10 * 1024 * 1024 + 1)).status_code == 413


def test_body_over_10mb_is_413_without_content_length(api):
    # Streaming chunked: no hay Content-Length, el gateway debe cortar al contar los bytes reales
    chunks = (b"\xff" * (1024 * 1024) for _ in range(11))
    r = api.post("/v1/classify", content=chunks, headers={"Content-Type": "image/jpeg"})
    assert r.status_code == 413


@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")  # Pillow avisa; nosotros cortamos
# 48 MP lo corta nuestra guardia en decode(); 81 MP ya lo corta Pillow (> 2× MAX_IMAGE_PIXELS)
@pytest.mark.parametrize("size", [(8000, 6000), (9000, 9000)], ids=["48MP-guardia", "81MP-pillow"])
def test_decompression_bomb_is_413(api, size):
    # PNG de 1 bit: pocos KB en disco pero decenas de MP declarados en el header (> 40 MP permitidos)
    data = image_bytes("PNG", size=size, mode="1")
    assert len(data) < 200_000  # el archivo es chico: por eso no basta con limitar bytes
    assert post(api, data, ctype="image/png").status_code == 413


def test_extreme_aspect_ratio_is_400(api):
    # 1×4,000 px: menos de 200 bytes y muy por debajo de 40 MP; sin la guardia, ≈ 1.1 GB de RAM al reescalar
    data = image_bytes("PNG", size=(1, 4000), mode="1")
    assert post(api, data, ctype="image/png").status_code == 400


@pytest.mark.parametrize("data", [b"esto no es una imagen", image_bytes()[:2000]], ids=["basura", "truncada"])
def test_undecodable_image_is_400(api, data):
    assert post(api, data).status_code == 400


def test_empty_body_is_400(api):
    assert post(api, b"").status_code == 400


def test_top_k_out_of_range_is_422(api):
    assert post(api, image_bytes(), top_k=0).status_code == 422  # validación de FastAPI (Query ge/le)
    assert post(api, image_bytes(), top_k=500).status_code == 422


# ------------------------------------------------------------------------------ fallas de Triton (5xx)
def test_triton_down_is_503_with_retry_after(api):
    FakeTriton.mode = "down"
    r = post(api, image_bytes())
    assert r.status_code == 503 and r.headers["Retry-After"] == "1"  # el cliente sabe cuándo reintentar


def test_triton_error_is_503(api):
    FakeTriton.mode = "reject"
    assert post(api, image_bytes()).status_code == 503


def test_slow_triton_is_504(api):
    FakeTriton.mode = "slow"
    r = post(api, image_bytes())
    assert r.status_code == 504  # cortamos a los 0.15 s: el cliente cae a su fallback manual
    assert "X-Request-ID" in r.headers  # los errores también son trazables


# ------------------------------------------------------------------------------ sobrecarga (load shedding)
def test_overload_is_503_with_retry_after(api, monkeypatch):
    monkeypatch.setattr(main, "MAX_INFLIGHT", 0)  # simula un pod saturado: se rechaza sin leer el body
    r = post(api, image_bytes())
    assert r.status_code == 503 and r.headers["Retry-After"] == "1"
    assert api.app.state.triton.calls == []  # ni CPU ni GPU gastadas en un request rechazado


def test_request_deadline_is_504(api, monkeypatch):
    monkeypatch.setattr(main, "REQUEST_DEADLINE_S", 0.001)  # presupuesto agotado antes de llegar a Triton
    r = post(api, image_bytes())
    assert r.status_code == 504
    assert api.app.state.triton.calls == []  # no se manda a la GPU un request que el caller ya abandonó


# ------------------------------------------------------------------------------ health y métricas
def test_healthz_does_not_depend_on_triton(api):
    FakeTriton.mode = "down"
    assert api.get("/healthz").status_code == 200  # liveness OK aunque Triton esté caído


@pytest.mark.parametrize("mode,expected", [("ok", 200), ("down", 503), ("reject", 503)])
def test_readyz_reflects_triton_model_readiness(api, mode, expected):
    FakeTriton.mode = mode
    assert api.get("/readyz").status_code == expected


def test_metrics_exposes_contract_names(api):
    post(api, image_bytes())  # al menos un request para que existan series con label status
    r = api.get("/metrics", follow_redirects=False)
    assert r.status_code == 200  # sin redirect 307 a /metrics/ (ver comentario en main.metrics)
    text = r.text
    # prometheus_client ordena los labels alfabéticamente: se busca el par, no la línea exacta
    assert re.search(r'classifier_requests_total\{[^}]*status="200"', text)
    assert re.search(r'classifier_top1_score_bucket\{[^}]*le="0\.3"', text)  # el bucket de ClassifierLowConfidenceSpike
    for name in [
        "classifier_request_latency_seconds_bucket",
        "classifier_preprocess_seconds_bucket",
        "classifier_inference_seconds_bucket",
        "classifier_image_bytes_bucket",
    ]:
        assert name in text, name
