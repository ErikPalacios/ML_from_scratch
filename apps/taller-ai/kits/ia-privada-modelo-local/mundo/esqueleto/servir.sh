#!/usr/bin/env bash
# Paso 2: arrancar llama-server con lo que dice servidor.env. Lo lanza python mundo/servidor.py arrancar.
# Contrato: lee servidor.env y termina en `exec llama-server …` con el modelo, el alias, host y puerto, el contexto,
# cuántas peticiones a la vez, el razonamiento y la clave. Nada más: lo demás, como viene por omisión.
set -euo pipefail
cd "$(dirname "$0")"
echo "servir.sh todavía es el esqueleto (paso 2)" >&2
exit 1
