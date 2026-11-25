"""Paso 1 · pedir(): una llamada a una fuente, con su token, reintentos ante 429 y errores que no se tragan.

Contrato:
- La URL base y el token de cada fuente salen de config.yaml (fuentes.<fuente>.url y .token). El token va en el
  encabezado «Authorization: Bearer <token>».
- 429 (demasiadas llamadas): espera los segundos de «Retry-After» (las fuentes del dojo siempre lo mandan en segundos) y reintenta, hasta http.reintentos veces.
  Si se acaban los reintentos, deja salir el error.
- 401 o 403: lanza FuenteSinAcceso. Nunca lo conviertas en «no hay nada»: un conector sin acceso parece uno sin cambios.
- 404: devuelve None (el documento ya no existe, o la cuenta del conector ya no lo puede ver).
- Si la respuesta es JSON, devuelve el dict; si no (un PDF, un Markdown), los bytes tal cual.
- Cuenta cada llamada en LLAMADAS[fuente] y cada 429 en ESPERAS[fuente] (para el resumen de la corrida).
"""

from __future__ import annotations
import json
import time
from collections import Counter
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from _comun import FuenteSinAcceso, config

LLAMADAS: Counter = Counter()

ESPERAS: Counter = Counter()


def pedir(fuente: str, ruta: str, params: dict | None = None):
    """GET a <url de la fuente><ruta>?<params>. La ruta puede traer ya su «?…» (por ejemplo, la «siguiente» de la wiki)."""
    raise NotImplementedError("paso 1: pedir")
