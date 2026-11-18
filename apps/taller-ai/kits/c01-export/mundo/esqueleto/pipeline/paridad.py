"""Paso «paridad»: ¿el engine que se va a servir responde lo mismo que el checkpoint que aprobó el gate?

    python pipeline/paridad.py                 # el engine de artefactos/v4/
    python pipeline/paridad.py --prueba int8   # el de artefactos/v4-int8/

Contrato:
- engine.yaml revisado y en un commit. El engine.onnx tiene que ser el de su engine.json (misma huella), construido con
  el runtime del servidor.
- El contrato con el servidor (mundo/servidor/classifier.yaml): una entrada con ese nombre, float32, forma
  [batch, 3, 32, 32] con el batch variable; una salida con ese nombre, [batch, 10]; y el engine acepta hasta
  max_batch_size fotos juntas. Si no cuadra, se detiene: el servidor no podría cargarlo.
- La referencia es PyTorch FP32 en eval(), con los pesos de la versión (huella = la de engine.json).
- El examen es el golden set completo de engine.yaml (manifest con su huella). El engine corre en lotes de max_batch_size.
- Tres números contra los umbrales de engine.yaml: a1 (acuerdo top-1), o5 (solapamiento top-5) y d (diferencia
  máxima de logits). Si alguno no pasa, código 1 y el motivo.
- Deja paridad.json: los tres números, los umbrales, pasa, el motivo y las fotos que cambiaron de top-1.
"""
from __future__ import annotations

import _comun  # noqa: F401  (carpeta(), contrato(), corrida(), receta(), bajar(), manifest(), tensores(), sesion(), huella_pesos()…)

raise NotImplementedError("pipeline/paridad.py todavía no está escrito (paso 4 del GUION)")
