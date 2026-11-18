"""Paso «exportar»: el checkpoint que aprobó el gate se vuelve un archivo ONNX, y se revisa ahí mismo con tres chequeos.

    python pipeline/exportar.py                          # el challenger de corrida.yaml
    python pipeline/exportar.py --exportador dynamo      # una prueba con el exportador nuevo (va a artefactos/v4-dynamo/)

Contrato:
- engine.yaml está en un commit y su sha256 es una de las revisiones aprobadas (mundo/revisiones.json). Si no, se detiene.
- La versión es la de corrida.yaml, por número. Tiene que decir gate=passed, su labels.json tiene que ser
  entrada/categorias.json y la huella de sus pesos tiene que ser su tag pesos_sha256. Si algo no cuadra, se detiene.
- El modelo se exporta en eval(), con el opset de engine.yaml, la entrada y la salida con los nombres del contrato del
  servidor (mundo/servidor/classifier.yaml) y el eje 0 (batch) dinámico.
- Tres chequeos, y si uno falla, código 1: (1) onnx.checker con full_check; (2) el opset ESCRITO en el archivo es el
  pedido; (3) ONNX Runtime contra PyTorch, FP32 contra FP32, con las primeras fotos_paridad fotos del golden set
  (manifest con su huella), en batch 1 y en batch_max: mismo top-1 en todas y diferencia máxima ≤ export.d_max.
- Deja artefactos/v<N>/model.onnx y export.json (versión, huellas, opset, exportador y los dos chequeos de paridad).
"""
from __future__ import annotations

import _comun  # noqa: F401  (CLASES, MODELO, carpeta(), contrato(), corrida(), receta(), revisiones(), bajar(), manifest(), tensores(), sesion(), huella_pesos()…)

raise NotImplementedError("pipeline/exportar.py todavía no está escrito (paso 2 del GUION)")
