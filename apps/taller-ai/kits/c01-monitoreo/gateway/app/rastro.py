"""Lo que deja escrito cada request: su nombre, su línea de log y sus sumas en las métricas (solución de referencia).

Contrato (lo usa gateway/app/main.py, que viene dado):
- request_id(header) → str. Si el caller mandó X-Request-ID y es un id sano (8 a 64 caracteres de letras, números,
  «-», «_», «.» o «:»), ese; si no (falta, vacío, muy largo, con espacios o saltos de línea), un UUID versión 4 nuevo
  (str(uuid.uuid4()), 36 caracteres).
- fuente(header, fuentes) → str. La etiqueta source: el header en minúsculas y sin espacios si está en `fuentes`
  (gateway.yaml: rastro.fuentes); si no, «other». Así la etiqueta tiene 4 valores, venga lo que venga.
- se_traza(request_id, fraccion) → bool. Los primeros 8 caracteres hex del sha256 del id, como número, < fraccion × 2³².
  La misma request siempre cae del mismo lado.
- Rastro(registro, reglas, modelo): crea, en ese registro, las métricas con estos nombres, etiquetas y bordes (las
  alertas y el análisis del canary de la estación 10 los buscan por nombre: no se cambian):
    classifier_requests_total{code, source, model_version}        contador
    classifier_request_seconds{source, model_version}             histograma (sin los 4xx), bordes MS
    classifier_preprocess_seconds{model_version}                  histograma, bordes MS
    classifier_inference_seconds{model_version}                   histograma, bordes MS
    classifier_top1_score{model_version}                          histograma, bordes SCORE (uno en 0.3)
    classifier_image_bytes{source}                                histograma, bordes BYTES
    classifier_top1_label_total{label}                            contador, cada categoría desde el arranque
    classifier_requests_in_flight                                 gauge (rastro.en_vuelo)
  y los métodos bytes(n, fuente), pre(s), inferencia(s), top1(score, label) y anotar(ev, status, fuente, t0).
- anotar: pone status y ms.total en ev, escribe ev como UNA línea de JSON compacto en stdout (sin la hora: la pone el
  runtime del nodo) y suma: el contador siempre; la latencia solo si no es 4xx, con el request_id como exemplar
  (trace_id) si se_traza. Nunca frena la request: escribir en stdout no espera a la red.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import uuid

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

MS = (0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1.0)   # bordes alrededor del SLO de 200 ms
SCORE = (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99)             # 0.3 = el umbral de baja confianza
BYTES = (1e3, 1e4, 1e5, 3e5, 1e6, 3e6, 1e7)
ID_SANO = re.compile(r"[A-Za-z0-9._:-]{8,64}")


def request_id(header: str | None) -> str:
    if header and ID_SANO.fullmatch(header):
        return header
    return str(uuid.uuid4())


def fuente(header: str | None, fuentes: list[str]) -> str:
    f = (header or "").strip().lower()
    return f if f in fuentes else "other"


def se_traza(rid: str, fraccion: float) -> bool:
    return int(hashlib.sha256(rid.encode()).hexdigest()[:8], 16) < fraccion * 2**32


class Rastro:
    def __init__(self, registro: CollectorRegistry, reglas: dict, modelo: dict):
        self.version = modelo["model_version"]
        self.fraccion = reglas["rastro"]["traza"]
        v = self.version
        self.requests = Counter("classifier_requests_total", "Requests por código, fuente y versión del modelo",
                                ["code", "source", "model_version"], registry=registro)
        self.latencia = Histogram("classifier_request_seconds", "Latencia total en el gateway (sin los 4xx)",
                                  ["source", "model_version"], buckets=MS, registry=registro)
        self._pre = Histogram("classifier_preprocess_seconds", "Decode y preprocess", ["model_version"],
                              buckets=MS, registry=registro).labels(v)
        self._inf = Histogram("classifier_inference_seconds", "La llamada a Triton, también si no contestó",
                              ["model_version"], buckets=MS, registry=registro).labels(v)
        self._top1 = Histogram("classifier_top1_score", "El score de la primera sugerencia", ["model_version"],
                               buckets=SCORE, registry=registro).labels(v)
        self._bytes = Histogram("classifier_image_bytes", "Tamaño de la foto", ["source"], buckets=BYTES,
                                registry=registro)
        self._label = Counter("classifier_top1_label_total", "Fotos por categoría que va primero (para el PSI)",
                              ["label"], registry=registro)
        for lb in modelo["labels"]:                       # cada categoría existe desde el arranque, aunque valga 0
            self._label.labels(lb)
        self.en_vuelo = Gauge("classifier_requests_in_flight", "Requests adentro ahora", registry=registro)

    def bytes(self, n: int, fuente_: str) -> None:
        self._bytes.labels(fuente_).observe(n)

    def pre(self, s: float) -> None:
        self._pre.observe(s)

    def inferencia(self, s: float) -> None:
        self._inf.observe(s)

    def top1(self, score: float, label: str) -> None:
        self._top1.observe(score)
        self._label.labels(label).inc()

    def anotar(self, ev: dict, status: int, fuente_: str, t0: float) -> None:
        s = time.monotonic() - t0
        ev["status"] = status
        ev.setdefault("ms", {})["total"] = round(s * 1000, 1)
        sys.stdout.write(json.dumps(ev, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()
        self.requests.labels(str(status), fuente_, self.version).inc()
        if not 400 <= status < 500:                       # un 415 tarda microsegundos: no baja el p99 de nadie
            ej = {"trace_id": ev["request_id"]} if se_traza(ev["request_id"], self.fraccion) else None
            self.latencia.labels(fuente_, self.version).observe(s, exemplar=ej)
