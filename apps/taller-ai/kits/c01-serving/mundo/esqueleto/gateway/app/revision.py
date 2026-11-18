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

raise NotImplementedError("gateway/app/revision.py todavía no está escrito (paso 4 del GUION)")
