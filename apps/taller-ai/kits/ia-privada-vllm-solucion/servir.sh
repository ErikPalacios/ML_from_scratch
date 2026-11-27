#!/usr/bin/env bash
# Arranca vLLM con lo que dice servidor.env. En tu Mac corre el vLLM del dojo (simulado); en el pod, el de verdad.
set -euo pipefail
cd "$(dirname "$0")"
source servidor.env
exec vllm serve "$MODELO" \
  --host "$HOST" --port "$PUERTO" \
  --served-model-name "$NOMBRE" \
  --max-model-len "$MAX_MODEL_LEN" \
  --max-num-seqs "$MAX_NUM_SEQS" \
  --api-key "$CLAVE" \
  --reasoning-parser qwen3 \
  --default-chat-template-kwargs '{"enable_thinking": false}'
