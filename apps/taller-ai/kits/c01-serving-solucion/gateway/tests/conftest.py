"""Lo que comparten las pruebas: un Triton falso, las reglas, la ficha del modelo y fotos hechas al vuelo.

Contrato:
- TritonFalso tiene los mismos métodos asíncronos que el cliente real (get_model_metadata, is_model_ready, infer,
  close) y lanza las mismas excepciones, pero contesta lo que la prueba le pida: logits, una demora, un error, «no
  listo». Además revisa el nombre, el tipo y la forma del tensor que le mandan, como lo haría Triton.
- No abre ningún puerto: las pruebas corren sin Triton, sin GPU y sin red, en segundos.
"""
from __future__ import annotations

import asyncio
import io
import json
import struct
import zlib

import numpy as np
import pytest
from PIL import Image
from tritonclient.utils import InferenceServerException

from app.main import leer_reglas

LABELS = ["playeras", "pantalones", "sueteres", "vestidos", "abrigos",
          "sandalias", "camisas", "tenis", "bolsas", "botines"]


class Resultado:
    def __init__(self, y: np.ndarray):
        self.y = y

    def as_numpy(self, nombre: str) -> np.ndarray:
        return self.y


class TritonFalso:
    def __init__(self, logits=None, demora: float = 0.0, error: Exception | None = None, listo: bool = True,
                 demora_listo: float = 0.0, n_logits: int = 10):
        self.logits = np.array(logits if logits is not None else [0.5, 0.1, 0.2, 0.0, 0.3, 1.0, 0.4, 3.0, 0.2, 2.0], np.float32)
        self.demora, self.error, self.listo, self.demora_listo, self.n = demora, error, listo, demora_listo, n_logits
        self.vistos: list[tuple] = []
        self.cerrado = False

    async def get_model_metadata(self, nombre):
        return {"name": nombre, "versions": ["1"], "platform": "onnxruntime_onnx",
                "inputs": [{"name": "input", "datatype": "FP32", "shape": [-1, 3, 32, 32]}],
                "outputs": [{"name": "logits", "datatype": "FP32", "shape": [-1, self.n]}]}

    async def is_model_ready(self, nombre):
        await asyncio.sleep(self.demora_listo)
        return self.listo

    async def infer(self, model_name, inputs, outputs=None, request_id="", **kw):
        e = inputs[0]
        self.vistos.append((e.name(), e.datatype(), list(e.shape()), request_id))
        if e.name() != "input" or e.datatype() != "FP32" or list(e.shape())[1:] != [3, 32, 32]:
            raise InferenceServerException(f"unexpected shape for input '{e.name()}': {e.shape()}", status="400")
        if self.demora:
            await asyncio.sleep(self.demora)
        if self.error:
            raise self.error
        return Resultado(np.tile(self.logits, (list(e.shape())[0], 1)))

    async def close(self):
        self.cerrado = True


@pytest.fixture
def reglas():
    return leer_reglas()


@pytest.fixture
def modelo():
    s = json.dumps(LABELS, ensure_ascii=False) + "\n"
    import hashlib

    return {"modelo": "classifier", "version": 4, "model_version": "miniresnet-2026-10-01", "engine_sha256": "0" * 64,
            "labels": LABELS, "labels_sha256": hashlib.sha256(s.encode()).hexdigest(),
            "entrada": {"nombre": "input", "forma": [-1, 3, 32, 32]}, "salida": {"nombre": "logits", "forma": [-1, 10]}}


def foto(formato: str = "JPEG", lado: tuple[int, int] = (56, 56)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", lado, (120, 80, 40)).save(b, formato)
    return b.getvalue()


def png_solo_encabezado(ancho: int, alto: int) -> bytes:
    """Un PNG que dice medir ancho × alto y casi no trae píxeles: pesa ≈ 60 B. Image.open lo abre (lee el encabezado)."""
    def trozo(tipo, datos):
        return struct.pack(">I", len(datos)) + tipo + datos + struct.pack(">I", zlib.crc32(tipo + datos))
    return (b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0))
            + trozo(b"IDAT", zlib.compress(b"\x00" * 16)) + trozo(b"IEND", b""))
