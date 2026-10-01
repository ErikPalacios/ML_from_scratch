"""Fakes y generadores de archivos para los tests de docs-api (sin AWS, sin red)."""

import io
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter

import main

CFDI_FIXTURE = Path(__file__).resolve().parents[2] / "pipeline" / "tests" / "fixtures" / "cfdi40_sintetico.xml"


class FakeStore:
    """S3 en un dict. `fail = True` simula una caída de S3 (o de KMS) durante el PutObject."""

    def __init__(self):
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail = False

    def put(self, key, data, content_type):
        if self.fail:
            raise RuntimeError("S3 no disponible")
        self.objects[key] = (data, content_type)


class FakeStarter:
    """Step Functions de mentira: registra cada StartExecution. `fail = True` simula un error de la API."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.fail = False

    def start(self, name, payload):
        if self.fail:
            raise RuntimeError("ThrottlingException")
        self.calls.append((name, payload))
        return f"arn:aws:states:us-east-1:000000000000:execution:doc-pipeline:{name}"


def document_image(h=1500, w=2000, seed=1) -> np.ndarray:
    """Mesa lisa + documento claro con "renglones de texto" (bordes nítidos), como en test_quality."""
    rng = np.random.default_rng(seed)
    img = np.full((h, w), 90, dtype=np.float32)
    y0, x0, y1, x1 = int(0.15 * h), int(0.15 * w), int(0.85 * h), int(0.85 * w)
    img[y0:y1, x0:x1] = 200
    for row in range(y0 + 20, y1 - 30, 40):
        for col in range(x0 + 20, x1 - 30, 24):
            if rng.random() < 0.8:
                img[row:row + 18, col:col + int(rng.integers(10, 18))] = 30
    img += rng.normal(0, 2, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def blur(img: np.ndarray, k: int = 15) -> np.ndarray:
    f = np.pad(img.astype(np.float64), k // 2, mode="edge")
    c = np.pad(f.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k))[: img.shape[0], : img.shape[1]].astype(np.uint8)


def jpeg(arr: np.ndarray, quality: int = 92) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).convert("RGB").save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def png(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def pdf(pages: int = 3, password: str | None = None) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=612, height=792)  # carta en puntos
    if password:
        w.encrypt(password)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


@pytest.fixture
def ctx():
    """App nueva por test con fakes; devuelve (client, repo, store, starter, settings, app)."""
    settings = main.Settings(bucket="test-bucket", state_machine_arn="arn:aws:states:us-east-1:000000000000:stateMachine:doc-pipeline")
    repo, store, starter = main.InMemoryRepo(), FakeStore(), FakeStarter()
    app = main.create_app(settings, repo, store, starter)
    return TestClient(app), repo, store, starter, settings, app


@pytest.fixture(scope="session")
def ine_jpegs():
    return jpeg(document_image(seed=1)), jpeg(document_image(seed=2))


@pytest.fixture(scope="session")
def cfdi_xml():
    return CFDI_FIXTURE.read_bytes()
