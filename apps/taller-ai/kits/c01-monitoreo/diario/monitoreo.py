"""El job monitoreo-diario, segunda parte: del Parquet de un día a sus señales del modelo y del negocio.

    python diario/monitoreo.py                                   # ayer (mundo.comun.ayer()), como el job de la 01:00
    python diario/monitoreo.py --dia 2026-11-18
    python diario/monitoreo.py --desde 2026-10-28 --hasta 2026-11-18   # varios días, del más viejo al más nuevo

Contrato:
- Lee de s3://ml-datos/ (con mundo.comun.descargar, que reusa lo ya bajado) el Parquet de predicciones del día
  (logs/predicciones/dt=AAAA-MM-DD/, todas las versiones) y el de los 28 días anteriores (la referencia del PSI), y los
  eventos del backend del día (eventos/publicaciones/dt=AAAA-MM-DD/). Solo cuentan las filas con status 200.
- Si el día no tiene filas, o falta alguno de los 28 días de referencia, termina con error (código ≠ 0) y no escribe ni
  publica nada: un job que publica un PSI calculado sobre nada es peor que uno que truena.
- Calcula, y escribe en s3://ml-datos/monitoreo/diario/dt=AAAA-MM-DD/resumen.json (lo reemplaza: idempotente):
    dia, filas (con status 200), versiones {model_version: filas},
    psi: el PSI de la categoría predicha (top1) del día contra la de los 28 días anteriores juntos, con las 10
         categorías como bins: suma de (p − q) · ln(p / q); una proporción 0 se cuenta como 0.0001. Redondeado a 4.
    psi_por_categoria: {categoría: su término de la suma}, para saber qué la movió.
    baja_confianza: {total, mobile, web, internal}: la fracción con score < 0.3.
    bytes_mediana: {mobile, web, internal}.
    aceptacion: {slice: {n, aceptadas}} con los slices total, source=mobile, source=web y categoria=<cada una>
         (la categoría que eligió quien vende). n = publicaciones con la sugerencia mostrada y fuera del holdout,
         unidas al log por request_id; aceptadas = las que eligieron por la vía «sugerencia».
    holdout: {n, aciertos}: las publicaciones del holdout (nunca ven sugerencias) y en cuántas el top1 es lo que eligió.
    apps: {versión de la app: publicaciones} (del evento).
- Empuja a la Pushgateway (job="monitoreo-diario", con PUT: reemplaza el grupo) los gauges
  classifier_monitoreo_psi, classifier_monitoreo_baja_confianza{source}, classifier_monitoreo_aceptacion{slice}
  (aceptadas ÷ n) y classifier_monitoreo_dia_timestamp_seconds (a qué día corresponden). La Pushgateway agrega sola
  push_time_seconds: de ahí sale MonitoringJobStale.
- Imprime una línea por día: filas, PSI, baja confianza y aceptación total.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (BUCKET, EVENTOS, MONITOREO, PREDICCIONES, PUSHGATEWAY, ayer as mundo_ayer, descargar,  # noqa: E402
                         etiquetas, s3)

REFERENCIA_DIAS = 28
UMBRAL_BAJA = 0.3
EPS = 1e-4


def main() -> None:
    raise SystemExit("✗ por escribir: el contrato está arriba de este archivo")


if __name__ == "__main__":
    main()
