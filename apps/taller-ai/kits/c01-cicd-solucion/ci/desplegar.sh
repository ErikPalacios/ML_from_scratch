#!/usr/bin/env bash
# Despliega por GitOps: cambia la imagen del ambiente en el repositorio de despliegue (por digest), la sube y espera
# a que el ambiente corra justo esa imagen; luego le pide una foto.
# Uso: ci/desplegar.sh <staging|produccion> <sha256:…>
set -euo pipefail
AMBIENTE="$1"
DIGEST="$2"
case "$AMBIENTE" in staging) PUERTO=8801 ;; produccion) PUERTO=8802 ;; *) echo "ambiente desconocido: $AMBIENTE"; exit 1 ;; esac
[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "digest inválido: '$DIGEST'"; exit 1; }
IMAGEN="$REPO@$DIGEST"
git clone -q "$DOJO_DESPLIEGUE_URL" "$RUNNER_TEMP/despliegue"
cd "$RUNNER_TEMP/despliegue"
sed -i.bak -E "s|^imagen: .*|imagen: $IMAGEN   # commit ${GITHUB_SHA::7}|" "$AMBIENTE/gateway.yaml" && rm "$AMBIENTE/gateway.yaml.bak"
git -c user.name=ci -c user.email=ci@dojo commit -qam "gateway ${GITHUB_SHA::7} en $AMBIENTE"
git push -q origin main           # el hook aplica el cambio, como Argo CD
cd "$GITHUB_WORKSPACE"
python mundo/gitops.py estado | grep "^$AMBIENTE " | tee "$RUNNER_TEMP/estado.txt"
grep -q "corre ${DIGEST:7:12} (running).*coincide" "$RUNNER_TEMP/estado.txt" || { echo "el ambiente no corre $IMAGEN"; exit 1; }
python ci/foto.py | curl -sf -X POST --data-binary @- -H "Content-Type: image/jpeg" "http://localhost:$PUERTO/v1/classify?top_k=1"; echo
