#!/usr/bin/env bash
# Sube la imagen a ECR con las credenciales del rol del CI y deja su digest como salida del paso: digest=sha256:…
# Uso (dentro del job imagen, que pide id-token: write): ci/push.sh <imagen>
set -euo pipefail
IMAGEN="$1"
REGISTRO="${IMAGEN%%/*}"
python mundo/nube.py ecr get-login-password --role-arn "$ROL" \
  | docker login --username AWS --password-stdin "$REGISTRO"
docker push "$IMAGEN" | tee "${RUNNER_TEMP:-/tmp}/push.log"
DIGEST=$(grep -o 'digest: sha256:[0-9a-f]\{64\}' "${RUNNER_TEMP:-/tmp}/push.log" | cut -d' ' -f2)
[ -n "$DIGEST" ] || { echo "no encontré el digest en la salida de docker push"; exit 1; }
echo "digest=$DIGEST" >> "$GITHUB_OUTPUT"
echo "subida: $IMAGEN → $DIGEST"
