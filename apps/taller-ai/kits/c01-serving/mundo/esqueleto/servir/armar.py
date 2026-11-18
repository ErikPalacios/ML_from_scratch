"""Paso «repositorio»: arma el model repository de Triton y la ficha del modelo para el gateway, para la versión que
dice servir.yaml, con las huellas del registro.

    python servir/armar.py

Contrato:
- La versión sale de servir.yaml, por número (nunca de un alias leído al correr).
- En el registro, esa versión tiene gate=passed y engine=listo; si no, se detiene.
- Baja engine/engine.onnx de su corrida y solo lo usa si su sha256 es el tag engine_sha256 de la versión.
- Baja modelo/labels.json y solo lo usa si su sha256 es el tag labels_sha256.
- El engine se construyó con el runtime del servidor de modelos: el tag onnxruntime de la versión es la versión de
  onnxruntime instalada (la que corre mundo/triton_dojo/). Si no, se detiene.
- Escribe model_repository/classifier/1/model.onnx (la copia exacta del engine) y servir/modelo.json: modelo, version,
  model_version (el nombre de servir.yaml), engine_sha256, labels, labels_sha256, y el nombre y la forma de la entrada
  y la salida, leídos del engine. El config.pbtxt no lo escribe: es tuyo, y está en git.
- Correrlo dos veces no cambia nada: si el repositorio ya tiene ese engine, lo dice.
"""
from __future__ import annotations

raise NotImplementedError("servir/armar.py todavía no está escrito (paso 2 del GUION)")
