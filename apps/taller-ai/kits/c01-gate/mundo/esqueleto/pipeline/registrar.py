"""Paso «registrar»: el candidato que pasó el gate se vuelve una versión de classifier con el alias challenger.

    python pipeline/registrar.py                          # el candidato de corrida.yaml
    python pipeline/registrar.py --candidato <corrida>

Contrato:
- Solo registra si hay una corrida de gate TERMINADA (FINISHED) para ese candidato, con veredicto «pasa», contra el
  champion de corrida.yaml, con un gate.yaml revisado y con el examen que dice gate.yaml. Si no, se detiene.
- Si champion ya no es la versión contra la que se evaluó, el veredicto es viejo: se detiene (hay que volver a evaluar).
- La versión apunta a los archivos de la corrida del candidato (runs:/<run_id>/modelo) y lleva sus tags: gate=passed,
  gate_run_id, mes, snapshot, pesos_sha256, labels_sha256 (el de entrada/categorias.json), examen, champion_version,
  y el Δmin contra el champion.
- Mueve challenger, nunca champion: champion lo mueve el despliegue cuando termina el canary (estación 10).
- Correrlo dos veces no crea dos versiones.
En C01 este paso va después de la estación 5 (paridad y latencia del engine). En el dojo no hay engine: registra aquí.
"""
from __future__ import annotations

import _comun  # noqa: F401  (corrida(), gate(), revisiones(), s3(), mlflow_cliente(), sha256(), huella_pesos(), CLASES…)

raise NotImplementedError("pipeline/registrar.py todavía no está escrito (paso 6 del GUION)")
