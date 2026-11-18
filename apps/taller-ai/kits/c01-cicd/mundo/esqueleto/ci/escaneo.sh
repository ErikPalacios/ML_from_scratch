#!/usr/bin/env bash
# El SBOM y el escaneo de una imagen, ANTES de subirla (tuyo). Uso: ci/escaneo.sh <imagen>
# Contrato: guarda el SBOM (python mundo/escaner.py image <imagen> --format cyclonedx --output …) y falla (código ≠ 0)
# con un aviso CRITICAL que ya tiene parche. Los que no tienen parche no detienen el push; las excepciones van en
# .trivyignore.yaml, cada una con statement y expired_at.
set -euo pipefail
echo "ci/escaneo.sh: falta escribirlo"; exit 1
