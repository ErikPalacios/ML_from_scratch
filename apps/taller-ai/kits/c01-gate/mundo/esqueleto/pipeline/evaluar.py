"""Paso «evaluar» del gate: el candidato, el champion y el de hace 3 meses, sobre el mismo examen, foto por foto.

    python pipeline/evaluar.py                          # los parámetros de corrida.yaml
    python pipeline/evaluar.py --candidato <corrida>    # otro candidato, con el mismo champion y el mismo examen

Contrato:
- Los modelos entran por NÚMERO de versión (corrida.yaml), nunca por alias: el alias puede moverse a media corrida.
- El examen es golden-v1: su manifest tiene que tener la huella que dice gate.yaml, y cada foto la suya. Si algo no
  coincide, se detiene: un examen que cambió no compara nada.
- Ninguna foto del examen puede estar en el snapshot con que se entrenó el candidato (fuga = examen contaminado).
- Cada modelo: sus pesos tienen la huella que anotó su corrida, y su labels.json es entrada/categorias.json.
- Las fotos pasan por el preprocess del gateway (mundo/gateway/preprocess.py), el mismo de producción.
- Deja reportes/<candidato>/pares.parquet (una fila por foto: label, slice y, por modelo, su top-5 y su confianza)
  y reportes/<candidato>/evaluacion.json (qué se evaluó, con sus huellas).
"""
from __future__ import annotations

import _comun  # noqa: F401  (corrida(), gate(), revisiones(), s3(), mlflow_cliente(), sha256(), huella_pesos(), CLASES…)

raise NotImplementedError("pipeline/evaluar.py todavía no está escrito (paso 2 del GUION)")
