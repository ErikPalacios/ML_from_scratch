"""El disparador: de los resúmenes diarios a tickets con diagnóstico. No reentrena nada:
abre tickets, y una persona decide.

    python diario/disparador.py                          # evalúa ayer (mundo.comun.ayer()), después de monitoreo.py
    python diario/disparador.py --dia 2026-11-18
    python diario/disparador.py --desde 2026-10-28 --hasta 2026-11-18   # cada día, como si hubiera corrido diario
    python diario/disparador.py … --seco                 # imprime lo que abriría, sin abrir nada

Contrato:
- Lee los resúmenes de s3://ml-datos/monitoreo/diario/dt=AAAA-MM-DD/resumen.json (los de tu monitoreo.py) y el
  historial de despliegues de s3://ml-datos/plataforma/despliegues.json.
- Dos reglas, evaluadas para el día D:
  · drift: el PSI pasa de 0.2 tres días seguidos (D, D-1 y D-2). El episodio empieza el primer día de la racha.
  · aceptación: para cada slice del resumen (total, source=…, categoria=…), la semana D-6..D contra D-13..D-7
    (sumando n y aceptadas de cada día): si las dos semanas tienen n ≥ 5,000 y la aceptación cayó más de 3 puntos.
    El episodio empieza el primer día, contando hacia atrás desde D, desde el que la regla se cumple todos los días.
    Si cae más de 3 puntos pero alguna semana tiene n < 5,000, no abre ticket: lo imprime como «al reporte».
    Un ticket por causa, no por síntoma: mientras la regla se cumple para algún source=, las caídas de categoria= van
    al reporte como «arrastradas por source=…» (mobile es más de la mitad de cada categoría: si mobile cae 4 puntos,
    cada categoría cae ≈ 2.4 y, con el ruido, alguna pasa de 3). Es la misma idea que la inhibición de Alertmanager.
- Un ticket por episodio: id = «drift-psi-<inicio>» o «aceptacion-<slice>-<inicio>». Mandar el mismo id otra vez no
  duplica (el buscapersonas contesta 409): correrlo todos los días es seguro.
- Cada ticket lleva el diagnóstico de la lección, para quien lo recibe:
  · despliegues: los del historial entre 3 días antes del inicio y el inicio (¿un deploy propio?).
  · fuentes: el cambio semana contra semana de la aceptación, la baja confianza y la mediana de bytes de cada source,
    y la mezcla de versiones de app (¿un solo source? ¿una app nueva?).
  · slice: para drift, la categoría que más aporta al PSI («categoria=<la de mayor término>»); para aceptación, el slice.
  · accion_sugerida, con la tabla de la lección: deploy cerca → rollback; un solo source movido → avisar-dueno (con el
    dueño de mundo/plataforma.yaml); drift con la aceptación de esa misma categoría cayendo > 3 puntos, o aceptación
    de una categoria= con el PSI > 0.2 → reentrenar (tanda extra del slice); drift sin labels peores → etiquetar.
- Abre cada ticket con POST http://localhost:8966/api/tickets (JSON con id, titulo, regla, slice, inicio, dia,
  evidencia, diagnostico, accion_sugerida). Imprime qué abrió, qué ya estaba y qué fue al reporte.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUCKET, BUSCAPERSONAS, MONITOREO, ayer as mundo_ayer, http, plataforma, s3  # noqa: E402

PSI_UMBRAL, PSI_DIAS = 0.2, 3
CAIDA, N_MIN, Z = 0.03, 5_000, 1.96
DESPLIEGUES = "plataforma/despliegues.json"


def main() -> None:
    raise SystemExit("✗ por escribir: el contrato está arriba de este archivo")


if __name__ == "__main__":
    main()
