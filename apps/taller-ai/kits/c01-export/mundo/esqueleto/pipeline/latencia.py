"""Paso «latencia»: ¿el engine nuevo no se volvió más lento que el que hoy sirve producción?

    python pipeline/latencia.py

Contrato:
- engine.yaml revisado y en un commit. El engine del challenger es el de artefactos/v<N>/ (huella = engine.json) y ya
  pasó la paridad (paridad.json con pasa y la misma huella). Si no, se detiene: medir un engine que no es el modelo no
  sirve de nada.
- La referencia es el engine del champion, el de corrida.yaml, por número: el que guarda su versión en MLflow
  (engine/engine.onnx), con la huella de su tag engine_sha256. Si no está o no cuadra, se detiene: sin referencia no
  hay gate (nunca «pasa» por default).
- Los dos se abren igual (como el servidor) y se miden en la misma máquina, a cada tasa de engine.yaml, con carga
  abierta: las peticiones llegan a su hora (Poisson con semilla fija, la misma para los dos) aunque la anterior no haya
  terminado. La latencia de cada una es desde que llegó hasta que tuvo respuesta (incluye la espera en la fila).
- Por tasa: rondas alternadas (champion, challenger, champion…); el p99 de cada ronda y la mediana de las rondas.
- La regla, a cada tasa: p99 del challenger ≤ (1 + holgura) × p99 del champion. Si no, código 1 y el motivo.
- Deja latencia.json: por tasa, los p99 de cada ronda, las medianas, el límite y pasa; y el máximo de fotos por
  segundo de cada engine.
"""
from __future__ import annotations

import _comun  # noqa: F401  (carpeta(), corrida(), receta(), bajar(), sesion(), sha256(), sha_archivo()…)

raise NotImplementedError("pipeline/latencia.py todavía no está escrito (paso 5 del GUION)")
