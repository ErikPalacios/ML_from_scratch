"""Escribe en stdout una foto JPEG de prueba (64 × 64), siempre la misma: para la prueba de humo."""
import io
import sys

from PIL import Image

b = io.BytesIO()
Image.new("RGB", (64, 64), (190, 40, 40)).save(b, "JPEG", quality=90)
sys.stdout.buffer.write(b.getvalue())
