#!/usr/bin/env bash
# Paso 2: arrancar llama-server con lo que dice servidor.env. Lo lanza python mundo/servidor.py arrancar.
set -euo pipefail
cd "$(dirname "$0")"
source servidor.env
exec llama-server \
  -m "$MODELO" \
  --alias "$ALIAS" \
  --host "$HOST" --port "$PUERTO" \
  -c "$CONTEXTO" -np "$PARALELO" \
  --reasoning "$RAZONAMIENTO" \
  --api-key "$CLAVE"
