"""Lo que deja escrito cada request: su nombre, su línea de log y sus sumas en las métricas. LO ESCRIBES TÚ.

Así como viene, el gateway contesta bien pero no deja rastro: cada request recibe un id que nadie guarda, no escribe
ninguna línea y no suma nada en /metrics. Es la release 15 recién llegada al 100 %… a ciegas.

Contrato (lo usa gateway/app/main.py, que viene dado; no cambies los nombres de las funciones ni sus argumentos):
- request_id(header) → str. Si el caller mandó X-Request-ID y es un id sano (8 a 64 caracteres de letras, números,
  «-», «_», «.» o «:»), ese; si no (falta, vacío, muy largo, con espacios o saltos de línea), un UUID versión 4 nuevo
  (str(uuid.uuid4()), 36 caracteres).
- fuente(header, fuentes) → str. La etiqueta source: el header en minúsculas y sin espacios si está en `fuentes`
  (gateway.yaml: rastro.fuentes); si no, «other». Así la etiqueta tiene 4 valores, venga lo que venga.
- se_traza(request_id, fraccion) → bool. Los primeros 8 caracteres hex del sha256 del id, como número, < fraccion × 2³².
  La misma request siempre cae del mismo lado.
- Rastro(registro, reglas, modelo): crea, EN ESE REGISTRO, las métricas con estos nombres, etiquetas y bordes (las
  alertas y el análisis del canary de la estación 10 los buscan por nombre: no se cambian):
    classifier_requests_total{code, source, model_version}        contador
    classifier_request_seconds{source, model_version}             histograma (sin los 4xx), bordes MS
    classifier_preprocess_seconds{model_version}                  histograma, bordes MS
    classifier_inference_seconds{model_version}                   histograma, bordes MS
    classifier_top1_score{model_version}                          histograma, bordes SCORE (uno en 0.3)
    classifier_image_bytes{source}                                histograma, bordes BYTES
    classifier_top1_label_total{label}                            contador, cada categoría desde el arranque
    classifier_requests_in_flight                                 gauge (el atributo rastro.en_vuelo)
  y los métodos bytes(n, fuente), pre(s), inferencia(s), top1(score, label) y anotar(ev, status, fuente, t0).
- anotar(ev, status, fuente, t0): pone ev["status"] y ev["ms"]["total"] (ms desde t0 = time.monotonic() del
  principio, con un decimal), escribe ev como UNA línea de JSON compacto en stdout (sin la hora: la pone el runtime del
  nodo) y suma: el contador siempre; la latencia solo si el status no es 4xx, con {"trace_id": request_id} como
  exemplar si se_traza. Nunca frena la request: escribir en stdout no espera a la red.
"""
from __future__ import annotations

import uuid

from prometheus_client import CollectorRegistry, Gauge

MS = (0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1.0)   # bordes alrededor del SLO de 200 ms
SCORE = (0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99)             # 0.3 = el umbral de baja confianza
BYTES = (1e3, 1e4, 1e5, 3e5, 1e6, 3e6, 1e7)


def request_id(header: str | None) -> str:
    return str(uuid.uuid4())             # TODO paso 1: respetar el id sano del caller


def fuente(header: str | None, fuentes: list[str]) -> str:
    return "other"                       # TODO paso 3


def se_traza(rid: str, fraccion: float) -> bool:
    return False                         # TODO paso 6


class Rastro:
    def __init__(self, registro: CollectorRegistry, reglas: dict, modelo: dict):
        self.en_vuelo = Gauge("classifier_requests_in_flight", "Requests adentro ahora", registry=registro)
        # TODO paso 3: las demás métricas

    def bytes(self, n: int, fuente_: str) -> None:
        pass

    def pre(self, s: float) -> None:
        pass

    def inferencia(self, s: float) -> None:
        pass

    def top1(self, score: float, label: str) -> None:
        pass

    def anotar(self, ev: dict, status: int, fuente_: str, t0: float) -> None:
        pass                             # TODO paso 1: la línea de log · paso 3: las sumas
