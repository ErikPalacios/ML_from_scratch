"""Las muestras para etiquetar: la cola del mes y las tandas extra que pidió una persona. Con
esto el ciclo vuelve a la estación 1.

    python diario/muestras.py              # la cola del mes que viene, desde los últimos 30 días (hasta ayer)

Contrato:
- Lee el Parquet de predicciones de los últimos 30 días (logs/predicciones/, hasta ayer): solo status 200 y solo la
  versión que atiende hoy (la de las filas de ayer; si ayer hubo dos, la más nueva). Une los eventos del backend
  (eventos/publicaciones/) por request_id para saber la categoría que eligió quien vende.
- Quita las fotos del examen fijo (la lista está en S3, en la ruta que dice mundo.comun.examen(), de plataforma.yaml:
  sha256 completos; el log guarda los primeros 12 caracteres): una foto del examen que entra al entrenamiento deja de medir. Y quita las repetidas por
  sha256 (la misma foto subida otra vez): se queda la primera.
- La cola del mes, 500 fotos:
  · 300 por incertidumbre: las de score más bajo (las mismas que cuenta la baja confianza).
  · 200 al azar entre las que quedan (semilla: el mes de la cola), para no ver solo lo que el modelo ya sabe que duda.
- Más una tanda extra de 100 fotos al azar (de los últimos 7 días, sin repetir las de arriba) por cada slice de un
  ticket que una persona decidió con «reentrenar» o «etiquetar» (GET http://localhost:8966/api/tickets: campo
  decision.accion; el slice es el del ticket, p. ej. categoria=abrigos = las que quien vende eligió como abrigos;
  source=mobile = las de esa fuente). Un slice repetido en dos tickets da una sola tanda.
- Escribe s3://ml-datos/etiquetado/cola-AAAA-MM/tareas.json (AAAA-MM = el mes que viene; lo reemplaza: idempotente):
  una lista de tareas en el formato de importación de Label Studio, [{"data": {"image", "request_id", "sha256",
  "motivo", "score", "top1"}}], con image = s3://publicaciones/fotos/<sha256>.jpg y motivo = incertidumbre | azar |
  extra:<slice>. Imprime cuántas hay por motivo.
"""
from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (BUCKET, BUSCAPERSONAS, ETIQUETADO, EVENTOS, PREDICCIONES, ayer as mundo_ayer, descargar,  # noqa: E402
                         etiquetas, examen, http, s3)

DIAS, POR_INCERTIDUMBRE, AL_AZAR, EXTRA, DIAS_EXTRA = 30, 300, 200, 100, 7


def main() -> None:
    raise SystemExit("✗ por escribir: el contrato está arriba de este archivo")


if __name__ == "__main__":
    main()
