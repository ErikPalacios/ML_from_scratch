"""Server-Sent Events (SSE): cómo viaja la respuesta en streaming. Viene dado: no tienes que escribirlo, pero sí
entenderlo.

Una respuesta SSE es texto que llega poco a poco por la misma conexión HTTP (Content-Type: text/event-stream). Cada
evento son líneas «event: nombre» y «data: …» y termina con una línea en blanco:

    event: token
    data: {"texto": "Los reembolsos"}

- evento(nombre, datos) → el texto de un evento, con datos en JSON (una sola línea).
- leer(lineas) → genera (nombre, datos) de un flujo de líneas (bytes o str), como las da urlopen().
- preguntar(url, token, pregunta, timeout=120) → genera (segundos desde que se mandó, nombre, datos): el cliente que
  usan pipeline/preguntar.py y verificar.py. Si la API contesta con un error HTTP, lanza urllib.error.HTTPError.
"""
from __future__ import annotations

import json
import time
import urllib.request


def evento(nombre: str, datos: dict) -> str:
    return f"event: {nombre}\ndata: {json.dumps(datos, ensure_ascii=False)}\n\n"


def leer(lineas):
    nombre, datos = None, []
    for linea in lineas:
        if isinstance(linea, bytes):
            linea = linea.decode()
        linea = linea.rstrip("\r\n")
        if not linea:
            if nombre or datos:
                yield nombre or "message", json.loads("\n".join(datos)) if datos else {}
            nombre, datos = None, []
        elif linea.startswith("event:"):
            nombre = linea[6:].strip()
        elif linea.startswith("data:"):
            datos.append(linea[5:].strip())
    if nombre or datos:                 # un evento sin su línea en blanco final: el flujo se cortó a la mitad
        yield nombre or "message", {"_incompleto": True}


def preguntar(url: str, token: str | None, pregunta: str, timeout: float = 120):
    h = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    t0 = time.perf_counter()
    req = urllib.request.Request(url, json.dumps({"pregunta": pregunta}).encode(), h, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for nombre, datos in leer(r):
            yield time.perf_counter() - t0, nombre, datos
