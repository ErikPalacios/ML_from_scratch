"""El preprocesamiento del gateway (estación 6), copiado tal cual: bytes de una foto → tensor que entra a la red.

Es el único: lo usan el gateway en producción, la evaluación y el entrenamiento. El entrenamiento lo IMPORTA de
aquí; nunca lo reescribe. Así no hay training-serving skew de lógica por construcción.
Para que tampoco haya skew de entorno, el entrenamiento usa la misma versión de Pillow que fija
mundo/gateway/requirements.txt (Pillow decide cómo se decodifica el JPEG y cómo se interpola al cambiar el tamaño).

En C01: EXIF → RGB → resize 256 → crop 224 → normalización de ImageNet. En el dojo, la misma receta en chico:
EXIF → RGB → resize 36 → crop 32 → normalización de ImageNet.
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageOps

LADO_RESIZE, LADO_CROP = 36, 32
MEDIA = np.array([0.485, 0.456, 0.406], dtype=np.float32)   # la media y la desviación de ImageNet, por canal (RGB)
DESV = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def decode(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)          # si la cámara guardó la foto girada, la endereza
    return im.convert("RGB")


def resize_center_crop(im: Image.Image) -> Image.Image:
    w, h = im.size
    k = LADO_RESIZE / min(w, h)                # el lado corto queda en 36
    im = im.resize((round(w * k), round(h * k)), Image.Resampling.BILINEAR)
    w, h = im.size
    x, y = (w - LADO_CROP) // 2, (h - LADO_CROP) // 2
    return im.crop((x, y, x + LADO_CROP, y + LADO_CROP))


def to_chw_normalized(im: Image.Image) -> np.ndarray:
    a = np.asarray(im, dtype=np.float32) / 255.0
    return ((a - MEDIA) / DESV).transpose(2, 0, 1).copy()   # [alto, ancho, canal] → [canal, alto, ancho]


def preprocess(data: bytes) -> np.ndarray:
    """Punto de entrada único: bytes → float32 [3, 32, 32]. Lo usan gateway, evaluación y entrenamiento."""
    return to_chw_normalized(resize_center_crop(decode(data)))
