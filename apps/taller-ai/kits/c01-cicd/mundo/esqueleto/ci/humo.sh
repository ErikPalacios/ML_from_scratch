#!/usr/bin/env bash
# La prueba de humo de una imagen, ANTES de subirla (tuya). Uso: ci/humo.sh <imagen>
# Contrato: prende la imagen en la red del mundo (taller-c01-cicd_default) con TRITON_URL=triton:8000 y un puerto
# libre de tu Mac; espera /readyz; /healthz da 200; un POST /v1/classify?top_k=3 con la foto de `python ci/foto.py`
# da 200 y 3 predicciones. Siempre apaga el contenedor al salir (trap). Sale con código ≠ 0 si algo falla.
set -euo pipefail
echo "ci/humo.sh: falta escribirlo"; exit 1
