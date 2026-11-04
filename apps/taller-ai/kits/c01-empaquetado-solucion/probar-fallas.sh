#!/usr/bin/env bash
# Prueba las 6 fallas sobre una carpeta que ya pasó probar.sh: romper, ver que verificar.py la detecta, confirmar,
# aplicar el arreglo documentado y cerrar con romper.py --verificar. Deja las salidas en <carpeta>-fallas.log.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>
set -uo pipefail
D="$1"; LOG="$D-fallas.log"; : > "$LOG"; cd "$D"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
falla() {  # id · comando para confirmar · arreglo
  paso "$1 romper" python3 romper.py --mostrar --falla "$1"
  paso "$1 verificar" python3 verificar.py
  paso "$1 confirma" sh -c "$2"
  paso "$1 arreglo" sh -c "$3"
  paso "$1 cerrar" python3 romper.py --verificar
}
falla puerto-ocupado "docker compose up -d 2>&1 | tail -1; docker ps --format '{{.Names}}\t{{.Ports}}' | grep 8080; docker compose ps --format '{{.Service}}\t{{.Status}}\t{{.Ports}}'" \
  "docker rm -f demo-pagos && docker compose up -d --force-recreate gateway 2>&1 | tail -1"
falla url-localhost "curl -s localhost:8080/readyz; echo; docker compose exec gateway env | grep MODEL_SERVER_URL" \
  "sed -i '' 's#http://localhost:8000#http://model-server:8000#' config.env && docker compose up -d 2>&1 | tail -1"
falla basura-contexto "du -sh gateway/* | sort -h | tail -3" \
  "printf '\\n*.bin\\n' >> gateway/.dockerignore && tail -3 gateway/.dockerignore && python3 verificar.py contexto"
falla modelo-roto "docker compose ps -a --format '{{.Service}}\t{{.Status}}'; docker compose logs model-server --no-log-prefix 2>&1 | grep -iE 'error|fail|invalid' | tail -3" \
  "cp mundo/modelos/iris-1.onnx model_repository/iris/1/model.onnx && docker compose build model-server 2>&1 | tail -1 && docker compose up -d 2>&1 | tail -1"
falla registry-caido "docker push localhost:5050/iris-gateway:0.1 2>&1 | tail -1; docker ps -a --filter name=registry --format '{{.Names}}\t{{.Status}}'" \
  "docker start registry && docker update --restart unless-stopped registry"
falla tag-pisado "docker inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' localhost:5050/iris-gateway:0.1; curl -sI -H 'Accept: application/vnd.oci.image.index.v1+json' localhost:5050/v2/iris-gateway/manifests/0.1 | grep -i docker-content-digest" \
  "docker tag iris-gateway:0.1 localhost:5050/iris-gateway:0.1 && docker push localhost:5050/iris-gateway:0.1 | tail -1"
paso "fin" python3 verificar.py
echo "listo: $LOG"
