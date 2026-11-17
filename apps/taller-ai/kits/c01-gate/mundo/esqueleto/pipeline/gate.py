"""Paso «gate»: aplica las reglas de gate.yaml a los pares que dejó evaluar.py y decide. Si no pasa, FALLA.

    python pipeline/gate.py                          # el candidato de corrida.yaml
    python pipeline/gate.py --candidato <corrida>    # otro (después de evaluarlo)

Contrato:
- Las reglas son las de gate.yaml, y gate.yaml tiene que ser una versión revisada (su sha256 en mundo/revisiones.json)
  y estar en el último commit, sin cambios pendientes. Si no, se detiene antes de calcular nada.
- Los pares tienen que ser de esta corrida: mismo champion y mismo examen que corrida.yaml.
- Contra cada modelo de comparar_contra, en top-1 y en top-5: no inferioridad pareada, Δmin = Δ − 1.96 × SE ≥ −margen.
- Por categoría (contra el champion): falla si el recall cae más de caida_max_puntos Y la caída es significativa
  (McNemar exacto con las discrepancias de esa categoría, corregido con Holm sobre las 10).
- Por slice (contra el champion): no inferioridad pareada con el margen de los slices.
- Calibración del candidato: ECE (15 cubetas de confianza) ≤ ece_max.
- Deja reportes/<candidato>/reporte.json y una corrida en MLflow (experimento c01-gate) con el veredicto, el motivo,
  las métricas y los punteros. Si no pasa, la corrida queda FAILED y el proceso sale con código 1: el pipeline se
  pone en rojo y no sigue. Nunca «devuelve false» y deja seguir.
"""
from __future__ import annotations

import _comun  # noqa: F401  (corrida(), gate(), revisiones(), s3(), mlflow_cliente(), sha256(), huella_pesos(), CLASES…)

raise NotImplementedError("pipeline/gate.py todavía no está escrito (paso 3 del GUION)")
