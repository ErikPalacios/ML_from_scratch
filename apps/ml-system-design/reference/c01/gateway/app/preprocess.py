"""Preprocesamiento ÚNICO de imágenes: el mismo código en training, eval y serving (caso c01).

Por qué existe como módulo aparte: el bug más caro y silencioso al llevar un modelo de visión a
producción es el training/serving skew. Si en el notebook usaste torchvision (Resize(256) →
CenterCrop(224) → ToTensor → Normalize) y en el servicio alguien reescribe el preprocesamiento
"parecido" (otro resize, BGR en vez de RGB, sin normalizar), el modelo recibe otra distribución de
entrada y pierde accuracy sin que nada falle ni lance errores. Por eso este archivo es la única
fuente de verdad: el DataLoader de eval/training lo importa y el gateway también.

Contrato: bytes de una imagen JPEG/PNG/WebP → np.ndarray float32 de forma [3, 224, 224] (CHW, RGB,
normalizado con mean/std de ImageNet), que es exactamente lo que espera el input "input" de Triton.

Equivalencia medida contra torchvision 0.29 (Pillow 12.3) en 24 imágenes sintéticas JPEG/PNG/WebP
de 300×200 a 6000×4000 px:
  - sin draft mode: diferencia máxima 0.0 (idéntico bit a bit) en todas;
  - draft "agresivo" (pedir 256 px directo al decoder): media hasta 0.12 y máxima hasta 2.2 en
    unidades normalizadas → mismatch real, descartado;
  - draft conservador (el de abajo: solo si el lado corto es ≥ 1024 px y dejando ≥ 512 px):
    media 0.004–0.011, máxima ≤ 0.23 (≈ 0.05 en escala 0–1, solo en bordes finos), y una foto de
    12 MP pasa de ≈ 40 ms a ≈ 18 ms de CPU. Las fotos del app móvil (≤ 1024 px) no lo activan.
El impacto en top-1 no se midió aquí (no hay modelo entrenado en este repo): como eval usa ESTA
misma función, el efecto queda incluido en la accuracy offline que reporta el pipeline.
"""

from __future__ import annotations  # anotaciones como texto: permite `int | None` sin coste en runtime

import io  # Pillow lee de un objeto tipo archivo; BytesIO evita escribir a disco

import numpy as np  # el tensor de salida es numpy: el cliente de Triton lo serializa directo
from PIL import Image, ImageOps  # Pillow: decodificación y resize; ImageOps para la rotación EXIF

RESIZE_SHORT = 256  # lado corto tras el resize: el mismo número que Resize(256) en training
CROP = 224  # tamaño del center crop: el input del ResNet-50 (y del engine TensorRT)
# mean/std de ImageNet con forma (3,1,1) para hacer broadcasting sobre CHW sin copiar
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)
# Solo los formatos que aceptamos: Pillow no intentará otros decoders (menos superficie de ataque)
ALLOWED_FORMATS = ("JPEG", "PNG", "WEBP")
# Draft mode solo si la imagen reducida sigue siendo ≥ 2× el objetivo (ver docstring y README)
DRAFT_MIN_SHORT = 2 * RESIZE_SHORT


class ImageTooLarge(ValueError):
    """Más píxeles de los permitidos: el gateway lo traduce a HTTP 413."""


def decode(data: bytes, max_pixels: int | None = None) -> Image.Image:
    """bytes → imagen RGB ya orientada. Valida el tamaño ANTES de decodificar los píxeles."""
    # open() solo lee el header: conocemos ancho/alto sin gastar CPU ni RAM en los píxeles
    img = Image.open(io.BytesIO(data), formats=ALLOWED_FORMATS)
    width, height = img.size  # dimensiones declaradas en el header
    # Guardia propia contra decompression bombs: un PNG de 50 KB puede declarar 30,000×30,000 px
    # y ocupar GBs al decodificar. Pillow solo AVISA al pasar MAX_IMAGE_PIXELS y falla al doble,
    # por eso comprobamos el límite exacto aquí.
    if max_pixels is not None and width * height > max_pixels:
        raise ImageTooLarge(f"{width}x{height} px excede el límite de {max_pixels} px")
    if img.format == "JPEG" and min(width, height) >= 2 * DRAFT_MIN_SHORT:
        # Draft mode: el decoder JPEG escala por 1/2, 1/4 o 1/8 al decodificar (IDCT reducida):
        # menos CPU y RAM en fotos grandes. Le pedimos que deje ≥ 512 px de lado corto para que
        # el resize final con antialias haga el resto y el resultado quede casi igual al de
        # decodificar completo (números en el docstring).
        img.draft("RGB", (DRAFT_MIN_SHORT, DRAFT_MIN_SHORT))
    # Las fotos de celular guardan la rotación en EXIF: sin esto el modelo ve la foto de lado
    img = ImageOps.exif_transpose(img)
    # convert("RGB") normaliza L/P/RGBA/CMYK a 3 canales RGB (el modelo se entrenó en RGB, no BGR)
    return img.convert("RGB")


def resize_center_crop(img: Image.Image) -> Image.Image:
    """Igual que torchvision Resize(256) + CenterCrop(224) sobre una imagen PIL."""
    width, height = img.size  # tamaño tras draft/rotación
    # Misma aritmética que torchvision: lado corto = 256, lado largo truncado con int()
    if width <= height:
        new_w, new_h = RESIZE_SHORT, int(RESIZE_SHORT * height / width)
    else:
        new_w, new_h = int(RESIZE_SHORT * width / height), RESIZE_SHORT
    # BILINEAR de Pillow siempre aplica antialias al reducir: es justo lo que hace torchvision
    # con imágenes PIL (con tensores habría que pasar antialias=True para igualarlo)
    img = img.resize((new_w, new_h), Image.Resampling.BILINEAR)
    # int(round(...)) replica el redondeo de CenterCrop (incluido el redondeo bancario de Python)
    left = int(round((new_w - CROP) / 2.0))
    top = int(round((new_h - CROP) / 2.0))
    return img.crop((left, top, left + CROP, top + CROP))  # recorte central 224×224


def to_chw_normalized(img: Image.Image) -> np.ndarray:
    """Imagen RGB 224×224 → float32 [3,224,224] normalizado (ToTensor + Normalize)."""
    x = np.asarray(img, dtype=np.float32) / 255.0  # HWC en [0, 1], igual que ToTensor
    x = x.transpose(2, 0, 1)  # HWC → CHW: el layout que espera el modelo de PyTorch/TensorRT
    x = (x - MEAN) / STD  # normalización por canal con las estadísticas de ImageNet
    # contiguous: el cliente de Triton serializa el buffer tal cual; un view transpuesto se copiaría
    return np.ascontiguousarray(x, dtype=np.float32)


def preprocess(data: bytes, max_pixels: int | None = None) -> np.ndarray:
    """Punto de entrada único: bytes → float32 [3,224,224]. Lo usan gateway, eval y training."""
    return to_chw_normalized(resize_center_crop(decode(data, max_pixels=max_pixels)))
