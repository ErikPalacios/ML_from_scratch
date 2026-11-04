#!/usr/bin/env bash
# Prueba de humo end-to-end: model server directo y luego a través del gateway.
set -euo pipefail

MODEL_SERVER=${MODEL_SERVER:-http://localhost:9000}
GATEWAY=${GATEWAY:-http://localhost:8080}

echo "== Model server: ¿modelo listo?"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" "$MODEL_SERVER/v2/models/iris/ready"

echo "== Model server: metadata (qué espera el modelo)"
curl -sf "$MODEL_SERVER/v2/models/iris"
echo

echo "== Model server: inferencia cruda (protocolo v2)"
curl -sf "$MODEL_SERVER/v2/models/iris/infer" -H 'Content-Type: application/json' -d '{
  "inputs": [{"name": "input", "shape": [1, 4], "datatype": "FP32", "data": [5.1, 3.5, 1.4, 0.2]}]
}'
echo

echo "== Gateway: readiness"
curl -sf "$GATEWAY/readyz"
echo

echo "== Gateway: predicción (3 flores en un request)"
curl -sf "$GATEWAY/v1/predict" -H 'Content-Type: application/json' -d '{
  "flowers": [
    {"sepal_length": 5.1, "sepal_width": 3.5, "petal_length": 1.4, "petal_width": 0.2},
    {"sepal_length": 5.9, "sepal_width": 3.0, "petal_length": 4.2, "petal_width": 1.5},
    {"sepal_length": 6.7, "sepal_width": 3.0, "petal_length": 5.2, "petal_width": 2.3}
  ]
}'
echo
