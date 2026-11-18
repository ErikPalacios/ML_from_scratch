#!/usr/bin/env bash
# El inventario (SBOM) y el escaneo de una imagen, antes de subirla. Falla con un aviso CRITICAL que ya tiene parche;
# los que no tienen parche no detienen el push, y las excepciones (con fecha de vencimiento) están en .trivyignore.yaml.
# Uso: ci/escaneo.sh <imagen>
set -euo pipefail
IMAGEN="$1"
python mundo/escaner.py image "$IMAGEN" --format cyclonedx --output "${RUNNER_TEMP:-/tmp}/sbom.json"
python mundo/escaner.py image "$IMAGEN" --severity CRITICAL --ignore-unfixed --exit-code 1 --ignorefile .trivyignore.yaml
