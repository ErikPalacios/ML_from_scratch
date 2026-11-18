#!/usr/bin/env bash
# Despliega por GitOps (tuyo). Uso: ci/desplegar.sh <staging|produccion> <sha256:…>
# Contrato: revisa que el digest tenga la forma sha256:<64 hex>; clona el repositorio de despliegue
# ($DOJO_DESPLIEGUE_URL) en $RUNNER_TEMP; cambia la línea `imagen:` de <ambiente>/gateway.yaml a $REPO@<digest>
# (con el commit en un comentario); hace commit y push a su main (el hook aplica el cambio, como Argo CD); comprueba
# con `python mundo/gitops.py estado` que el ambiente corre justo ese digest, y le pide una foto (8801 staging,
# 8802 produccion).
set -euo pipefail
echo "ci/desplegar.sh: falta escribirlo"; exit 1
