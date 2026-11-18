"""La revisión de cada foto, de lo más barato a lo más caro. Cada rechazo lleva su código HTTP.

Contrato:
- Rechazo(codigo, motivo): la excepción de todo lo que se rechaza; el gateway la convierte en la respuesta.
- revisar_tipo(content_type, tipos): 415 si no es uno de los tipos de gateway.yaml (ignora «; charset=…»).
- revisar_largo(content_length, max_bytes): 413 si el header Content-Length dice más que max_bytes, sin leer el body.
  Si el header no viene, no decide nada.
- leer_body(request, max_bytes): lee el body en pedazos y corta con 413 en cuanto pasa de max_bytes (el header puede
  mentir o no venir). Si quien llama se va a media subida, deja pasar ClientDisconnect (el gateway contesta 499).
- revisar_imagen(data, max_pixeles, max_proporcion): 400 si está vacía; abre SOLO el encabezado (Image.open no
  decodifica los píxeles) y da 400 si Pillow no la reconoce, 413 si ancho × alto pasa de max_pixeles y 400 si el lado
  largo pasa de max_proporcion veces el corto. Devuelve (ancho, alto).
- preparar(data): el decode y el preprocess del paquete compartido (preprocess.py, el mismo del entrenamiento). Si el
  archivo está corrupto o cortado, 400. Devuelve float32 [3, 32, 32].
- Image.MAX_IMAGE_PIXELS se fija en max_pixeles al arrancar: la red propia de Pillow, de respaldo.
"""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, UnidentifiedImageError

from . import preprocess


class Rechazo(Exception):
    def __init__(self, codigo: int, motivo: str, reintentar: bool = False):
        super().__init__(motivo)
        self.codigo, self.motivo, self.reintentar = codigo, motivo, reintentar


def revisar_tipo(content_type: str | None, tipos: list[str]) -> str:
    tipo = (content_type or "").split(";")[0].strip().lower()
    if tipo not in tipos:
        raise Rechazo(415, f"tipo {tipo or '(sin Content-Type)'}: solo {', '.join(tipos)}")
    return tipo


def revisar_largo(content_length: str | None, max_bytes: int) -> None:
    if content_length is None:
        return
    try:
        n = int(content_length)
    except ValueError:
        raise Rechazo(400, f"Content-Length no es un número: {content_length!r}") from None
    if n > max_bytes:
        raise Rechazo(413, f"Content-Length {n} B: el máximo es {max_bytes} B")


async def leer_body(request, max_bytes: int) -> bytes:
    partes, n = [], 0
    async for trozo in request.stream():
        n += len(trozo)
        if n > max_bytes:
            raise Rechazo(413, f"el body pasa de {max_bytes} B (se cortó al leer)")
        partes.append(trozo)
    return b"".join(partes)


def revisar_imagen(data: bytes, max_pixeles: int, max_proporcion: float) -> tuple[int, int]:
    if not data:
        raise Rechazo(400, "body vacío")
    try:
        with Image.open(io.BytesIO(data)) as im:     # solo el encabezado: el ancho y el alto, sin decodificar
            w, h = im.size
    except Image.DecompressionBombError:
        raise Rechazo(413, f"más de {max_pixeles:,} píxeles (Pillow)") from None
    except (UnidentifiedImageError, OSError, ValueError):
        raise Rechazo(400, "no es una imagen que se pueda leer") from None
    if w * h > max_pixeles:
        raise Rechazo(413, f"{w} × {h} = {w * h:,} píxeles: el máximo es {max_pixeles:,}")
    if max(w, h) > max_proporcion * min(w, h):
        raise Rechazo(400, f"{w} × {h}: el lado largo pasa de {max_proporcion:g} veces el corto")
    return w, h


def preparar(data: bytes) -> np.ndarray:
    try:
        return preprocess.preprocess(data)
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError) as e:
        raise Rechazo(400, f"no se pudo decodificar la imagen ({type(e).__name__})") from None
