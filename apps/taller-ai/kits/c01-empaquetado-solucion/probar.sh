#!/usr/bin/env bash
# Corre el Guiado de la estación 7 en una carpeta limpia, con los archivos de esta solución, y deja cada salida
# real en <carpeta>.log. Es como el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../c01-empaquetado"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"
docker compose down -v >/dev/null 2>&1; docker rm -f registry >/dev/null 2>&1
docker rmi -f iris-gateway:0.1 iris-gateway:0.2 iris-model-server:0.1 localhost:5050/iris-gateway:0.1 localhost:5050/iris-model-server:0.1 >/dev/null 2>&1

paso "p0 versiones" sh -c 'docker version --format "Docker {{.Server.Version}} · {{.Server.Os}}/{{.Server.Arch}}" && uv --version && python3 --version'
paso "p0 verificar" python3 verificar.py mundo

cp "$SOL/gateway/requirements.in" gateway/; cp "$SOL/model_server/requirements.in" model_server/
paso "p1 compile gw" sh -c 'cd gateway && uv pip compile requirements.in -o requirements.txt --universal --python-version 3.13 2>&1 | tail -3'
paso "p1 compile ms" sh -c 'cd model_server && uv pip compile requirements.in -o requirements.txt --universal --python-version 3.13 2>&1 | tail -3'
paso "p1 grep" sh -c 'grep -E "^(fastapi|uvicorn|httpx|onnxruntime|numpy)==" gateway/requirements.txt model_server/requirements.txt'
paso "p1 verificar" python3 verificar.py deps

paso "p2 sin ignore" python3 verificar.py contexto
cp "$SOL/gateway/.dockerignore" gateway/; cp "$SOL/model_server/Dockerfile.dockerignore" model_server/
paso "p2 verificar" python3 verificar.py contexto

cp "$SOL/gateway/Dockerfile" gateway/
SECONDS=0
paso "p3 build" sh -c 'docker build --no-cache --progress=plain -t iris-gateway:0.1 gateway 2>&1 | grep -E "transferring context|RUN pip|DONE [0-9.]+s|naming to" | grep -vE "^#[0-9]+ DONE 0\.[0-9]s$" | tail -12'
echo "segundos build sin caché: $SECONDS" >> "$LOG"
paso "p3 images" docker images iris-gateway
paso "p3 history" docker history iris-gateway:0.1 --format '{{.Size}}\t{{.CreatedBy}}'
paso "p3 verificar" python3 verificar.py gateway

SECONDS=0
paso "p4 cached" sh -c 'docker build --progress=plain -t iris-gateway:0.1 gateway 2>&1 | grep -E "CACHED|naming to"'
echo "segundos build con caché: $SECONDS" >> "$LOG"
cp gateway/app.py /tmp/app.py.respaldo
echo "# prueba de caché" >> gateway/app.py
paso "p4 cambio app" sh -c 'docker build --progress=plain -t iris-gateway:0.2 gateway 2>&1 | grep -E "^#[0-9]+ \[[0-9]/[0-9]\]|CACHED|DONE [0-9.]+s$" | grep -vE "DONE 0\.0s"'
cp /tmp/app.py.respaldo gateway/app.py; touch gateway/Dockerfile; docker rmi iris-gateway:0.2 >/dev/null
docker build -q -t iris-gateway:0.1 gateway >/dev/null

cp "$SOL/model_server/Dockerfile" model_server/
paso "p5 build" sh -c 'docker build --progress=plain -f model_server/Dockerfile -t iris-model-server:0.1 . 2>&1 | grep -E "transferring context|naming to"'
paso "p5 id" docker run --rm iris-model-server:0.1 id
paso "p5 images" docker images iris-model-server
paso "p5 verificar" python3 verificar.py model-server exec

cp "$SOL/compose.yaml" .
paso "p6 up" docker compose up -d
paso "p6 ps" docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'
paso "p6 smoke" ./scripts/smoke.sh
paso "p6 verificar" python3 verificar.py red salud

paso "p7 stop" sh -c '/usr/bin/time -p docker compose stop gateway 2>&1'
paso "p7 logs" sh -c 'docker compose logs gateway --no-log-prefix | tail -4'
paso "p7 start" sh -c 'docker compose start gateway && sleep 2 && curl -s localhost:8080/readyz'

paso "p8 registry" sh -c 'docker run -d -p 5050:5000 --name registry registry:2 >/dev/null && sleep 2 && curl -s localhost:5050/v2/_catalog'
paso "p8 push gw" sh -c 'docker tag iris-gateway:0.1 localhost:5050/iris-gateway:0.1 && docker push localhost:5050/iris-gateway:0.1'
paso "p8 push ms" sh -c 'docker tag iris-model-server:0.1 localhost:5050/iris-model-server:0.1 && docker push localhost:5050/iris-model-server:0.1'
paso "p8 catalog" curl -s localhost:5050/v2/_catalog
paso "p8 verificar" python3 verificar.py registry

paso "fin verificar" python3 verificar.py
paso "pc df" df -h /
paso "pc system df" docker system df
echo "listo: $LOG"
