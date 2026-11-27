#!/usr/bin/env bash
# El servidor del juez: otro llama-server, con lo que dice juez.env. Lo lanza python mundo/servidor.py arrancar.
set -euo pipefail
cd "$(dirname "$0")"
source juez.env
exec llama-server \
  -m "$MODELO" \
  --alias "$ALIAS" \
  --host "$HOST" --port "$PUERTO" \
  -c "$CONTEXTO" -np "$PARALELO" \
  --reasoning "$RAZONAMIENTO" \
  --api-key "$CLAVE"
