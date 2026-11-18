#!/usr/bin/env bash
# La prueba de humo de una imagen, antes de subirla: la prende con el Triton del mundo y le pide una foto.
# Uso: ci/humo.sh <imagen>
set -euo pipefail
IMAGEN="$1"
NOMBRE="humo-${GITHUB_RUN_ID:-local}"
docker run -d --rm --name "$NOMBRE" --network taller-c01-cicd_default -e TRITON_URL=triton:8000 \
  -p 127.0.0.1::8080 "$IMAGEN" > /dev/null
trap 'docker rm -f "$NOMBRE" > /dev/null 2>&1 || true' EXIT
PUERTO=$(docker port "$NOMBRE" 8080/tcp | head -1 | cut -d: -f2)
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PUERTO/readyz" > /dev/null && break
  sleep 0.5
done
curl -sf "http://localhost:$PUERTO/healthz"; echo
python ci/foto.py | curl -sf -X POST --data-binary @- -H "Content-Type: image/jpeg" \
  "http://localhost:$PUERTO/v1/classify?top_k=3" | tee "${RUNNER_TEMP:-/tmp}/humo.json"; echo
python -c 'import json, sys; r = json.load(open(sys.argv[1])); assert len(r["predictions"]) == 3, r' "${RUNNER_TEMP:-/tmp}/humo.json"
echo "humo: ok"
