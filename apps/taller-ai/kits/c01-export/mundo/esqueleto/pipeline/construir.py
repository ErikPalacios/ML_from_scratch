"""Paso «construir»: del model.onnx que pasó sus tres chequeos al engine que va a correr el servidor, atado a esta
máquina y a este runtime, con sus huellas.

    python pipeline/construir.py                     # la precisión de engine.yaml (fp16)
    python pipeline/construir.py --precision int8    # una prueba: int8 calibrado (va a artefactos/v4-int8/)

Contrato:
- engine.yaml revisado y en un commit (como en exportar.py).
- Parte de artefactos/v<N>/model.onnx, y solo si su sha256 es el de export.json: el ONNX que pasó los tres chequeos.
- La guardia del build: el onnxruntime con que construyes tiene que ser el que corre el servidor
  (mundo/servidor/requirements.txt). Si no, se detiene: un engine se construye con el runtime que lo va a servir.
- fp16: los pesos a FP16, con la entrada y la salida en FP32 (como pide el contrato del servidor).
  int8: cuantización estática, calibrada con el set de engine.yaml (fotos de train, con su manifest); nunca con el examen.
- Optimiza el grafo con ONNX Runtime (nivel de engine.yaml) y guarda el resultado: ese archivo es el engine.
- Deja engine.onnx y engine.json: versión, huellas (pesos, onnx, engine, receta), precisión, opset, batch_max,
  onnxruntime, máquina y CPU.
"""
from __future__ import annotations

import _comun  # noqa: F401  (carpeta(), corrida(), receta(), revisiones(), runtime_servidor(), manifest(), tensores(), sha_archivo()…)

raise NotImplementedError("pipeline/construir.py todavía no está escrito (paso 3 del GUION)")
