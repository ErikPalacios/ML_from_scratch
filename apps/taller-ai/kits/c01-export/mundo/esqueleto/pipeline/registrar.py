"""Paso «registrar»: el engine que pasó la paridad y la latencia queda en la versión del registro, con sus huellas.

    python pipeline/registrar.py

Contrato:
- engine.yaml revisado y en un commit. Los cuatro reportes de artefactos/v<N>/ (export, engine, paridad y latencia)
  son del MISMO engine (la misma huella, que es la del archivo) y de la misma receta; la paridad y la latencia pasaron;
  el engine se construyó con el runtime del servidor. Si algo no cuadra, se detiene y no registra nada.
- La versión es la de corrida.yaml, y los alias siguen donde los dejó el orquestador: challenger = esa versión y
  champion = el de corrida.yaml. Si alguien los movió, se detiene.
- Sube model.onnx, engine.onnx y los cuatro reportes a la corrida de la versión (artefactos engine/) y le pone sus
  tags: engine=listo, las huellas (onnx, engine, receta), onnxruntime, máquina, precisión, opset, los tres números de
  la paridad y el p99 de cada tasa.
- No mueve ningún alias: el despliegue (estaciones 8 a 10) toma el challenger desde aquí.
- Correrlo dos veces no cambia nada. Si la versión ya tiene OTRO engine, se detiene: el engine de una versión no cambia.
"""
from __future__ import annotations

import _comun  # noqa: F401  (carpeta(), corrida(), receta(), revisiones(), runtime_servidor(), mlflow_cliente(), sha_archivo()…)

raise NotImplementedError("pipeline/registrar.py todavía no está escrito (paso 6 del GUION)")
