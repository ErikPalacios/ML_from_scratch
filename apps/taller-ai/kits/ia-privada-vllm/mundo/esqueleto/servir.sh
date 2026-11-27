#!/usr/bin/env bash
# Paso 2: arrancar vLLM con lo que dice servidor.env. Lo lanza python3 mundo/servidor.py arrancar (en tu Mac, con el
# vLLM del dojo); mundo/gpu.py receta lo lee para armar el pod. Contrato: lee servidor.env y termina en
# `exec vllm serve "$MODELO" …` con host y puerto, el nombre servido, el contexto, cuántas a la vez, la clave, el
# parser de razonamiento de Qwen3 y la plantilla sin razonar. Nada más: lo demás, como viene por omisión.
set -euo pipefail
cd "$(dirname "$0")"
echo "servir.sh todavía es el esqueleto (paso 2)" >&2
exit 1
