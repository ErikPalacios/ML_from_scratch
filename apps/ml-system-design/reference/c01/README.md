# Caso c01 — archivos de referencia (clasificador de categorías con Triton)

Archivos **reales** del caso c01 de *Ronda de Diseño ML*: un gateway FastAPI en CPU que valida y
preprocesa imágenes y llama a un ResNet-50 compilado con TensorRT FP16 y servido por NVIDIA Triton
en GPUs T4 (EKS). Cada archivo está comentado línea por línea explicando **por qué**, no solo qué.

## Estructura

```
c01/
├── gateway/                     # servicio HTTP en CPU (lo que llama el marketplace)
│   ├── app/main.py              # FastAPI: POST /v1/classify, /healthz, /readyz, /metrics
│   ├── app/preprocess.py        # EL preprocesamiento compartido con training/eval (anti-skew)
│   ├── app/labels.json          # 500 categorías hoja (índice = id de clase del training)
│   ├── tests/test_api.py        # pytest con un Triton falso: corre sin GPU
│   ├── requirements.txt         # runtime, todo fijado con ==
│   ├── requirements-dev.txt     # + pytest y cliente de tests
│   ├── pytest.ini
│   ├── Dockerfile               # multi-stage, python:3.13-slim, usuario no root, 1 proceso
│   └── .dockerignore
├── model/
│   ├── export_onnx.py           # PyTorch → ONNX opset 17, batch dinámico, verificado con ORT
│   ├── parity_check.py          # gate de CI: PyTorch vs ORT / TensorRT (top-1 ≥ 99.5 %)
│   ├── build_engine.sh          # trtexec --fp16 en la T4 con la misma release NGC que Triton
│   └── requirements.txt
├── triton/
│   ├── model_repository/classifier/config.pbtxt   # contrato del modelo + dynamic batching
│   └── Dockerfile               # tritonserver:24.08 con el modelo horneado
├── docker-compose.yml           # gateway + Triton (GPU) + Prometheus en una máquina
├── monitoring/prometheus.yml    # scrape local de gateway:8080 y triton:8002
├── monitoring/alerts.yml        # 1 regla de grabación + 6 alertas del caso
└── k8s/
    ├── triton.yaml              # Deployment GPU + Service + PodDisruptionBudget + NetworkPolicy
    ├── gateway.yaml             # Deployment + Service + HPA (CPU 60 %) + Ingress ALB
    ├── keda-triton.yaml         # ScaledObject: escala Triton por tiempo en cola
    └── monitoring.yaml          # ServiceMonitors: Prometheus scrapea gateway (8080) y Triton (8002)
```

`model.plan` (el engine) y `classifier.onnx` **no se versionan** (`.gitignore` ignora `*.plan` y
`*.onnx`): se generan con los scripts de `model/`.

## Orden de lectura sugerido

1. `gateway/app/preprocess.py` — el contrato de entrada del modelo y el porqué del skew.
2. `gateway/app/main.py` — validación, threadpool, llamada a Triton, errores, métricas, logs.
3. `gateway/tests/test_api.py` — cómo se prueba sin GPU.
4. `model/export_onnx.py` → `model/parity_check.py` → `model/build_engine.sh` — del checkpoint al engine.
5. `triton/model_repository/classifier/config.pbtxt` y `triton/Dockerfile`.
6. `docker-compose.yml` y `monitoring/` — todo junto en una máquina.
7. `k8s/` — producción: probes, drenado, autoscaling, zonas.

## Flujo: del checkpoint a producción

```
checkpoint .pt ──export_onnx.py──▶ classifier.onnx ──parity_check.py (ORT, CPU)──▶ ¿pasa?
      └─ en la máquina con T4: build_engine.sh ──▶ model.plan ──docker build triton/──▶ imagen
         └─ Triton arriba ──parity_check.py --backend triton (FP16 vs FP32)──▶ ¿pasa? ──▶ registry / canary
```

```bash
cd reference/c01
python -m venv .venv && . .venv/bin/activate && pip install -r model/requirements.txt
python model/export_onnx.py --checkpoint resnet50_500.pt --out model/classifier.onnx
python model/parity_check.py --onnx model/classifier.onnx --images /ruta/muestra_eval --n 2000
# En una g4dn.xlarge (T4) con Docker + NVIDIA Container Toolkit:
bash model/build_engine.sh
docker build -t classifier-triton:2026-09-01-resnet50-fp16 triton/
```

## Correr los tests del gateway (sin GPU)

```bash
cd reference/c01/gateway
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest            # 26 tests: 200 con top_k, 415, 413 (bytes y píxeles), 400 (incluida la relación de aspecto extrema), 422 (con línea y conteo), 499 (upload cortado), 500 (logits NaN), 503 (Triton caído y por sobrecarga), 504 (Triton lento y por deadline), health, métricas
```

## Correr todo en local con docker compose (necesita GPU NVIDIA)

Requisitos: GPU NVIDIA con driver, Docker con **NVIDIA Container Toolkit**, y el engine construido.
El engine solo sirve en la GPU donde se compiló: si tu GPU local no es una T4, compílalo para ella
con `EXPECTED_GPU="<tu GPU>" bash model/build_engine.sh` (sirve para probar en local; para
producción se recompila en una T4).

```bash
cd reference/c01
docker compose up --build
curl -s -H "Content-Type: image/jpeg" --data-binary @foto.jpg "localhost:8080/v1/classify?top_k=5"
# Prometheus con las 6 alertas cargadas: http://localhost:9090/alerts
```

## Desplegar en EKS (resumen)

Prerequisitos del cluster: NVIDIA device plugin, node group de `g4dn.xlarge` con label
`workload=gpu-t4` y taint `nvidia.com/gpu=present:NoSchedule`, AWS Load Balancer Controller, KEDA,
Prometheus (kube-prometheus-stack, con kube-state-metrics), un CNI que aplique NetworkPolicy (VPC CNI
con `enableNetworkPolicy=true`, o Calico) y las imágenes en ECR. Kubernetes ≥ 1.35: 1.34 sale del
soporte upstream el 27 de octubre de 2026 y del soporte estándar de EKS el 2 de diciembre de 2026. Nada
en los manifests depende de 1.34: pasan la validación estricta contra 1.35–1.37 y
`trafficDistribution: PreferSameZone` es GA desde 1.35 (en 1.31–1.33 cámbialo por `PreferClose`).
KEDA 2.21 está probado con Kubernetes 1.34–1.36: en 1.37, usa una release de KEDA que lo incluya.

```bash
kubectl create namespace classifier
kubectl label namespace classifier elbv2.k8s.aws/pod-readiness-gate-inject=enabled
kubectl apply -f k8s/triton.yaml -f k8s/keda-triton.yaml -f k8s/gateway.yaml -f k8s/monitoring.yaml
# Las reglas de monitoring/alerts.yml como PrometheusRule (el Operator no lee archivos de reglas):
{ printf 'apiVersion: monitoring.coreos.com/v1\nkind: PrometheusRule\nmetadata:\n  name: classifier\n  namespace: classifier\n  labels:\n    release: kube-prometheus-stack\nspec:\n'; sed 's/^/  /' monitoring/alerts.yml; } | kubectl apply -f -
```

## Qué se verificó y qué no

Probado en macOS (Apple Silicon), Python 3.13, sin GPU ni daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests del gateway | `pytest` en un venv limpio con `requirements-dev.txt` | 26 passed |
| Cliente real de Triton | uvicorn + `tritonclient.http.aio` 2.72 contra un servidor KServe v2 falso (binary tensors) | 200 (también 16 requests concurrentes), 415, 413, 400, 503 con `Retry-After`, 504 a los ≈ 150 ms, logs JSON y `/metrics` correctos |
| Upload cortado y 422 | uvicorn real; un socket que declara 100,000 bytes, manda 1,000 y cierra; `top_k=0` con `curl` | línea y métrica con 499, sin traceback; el 422 con su línea, su conteo y `X-Request-ID` |
| Load shedding | mismo montaje, ráfagas concurrentes contra un pod con la config por defecto | 16 fotos de 1024×768 a la vez: 16 × 200 (p50 ≈ 40 ms); 40 a la vez: 14 × 200 y 26 × 503 rápidos (p50 ≈ 7 ms), ninguna pasa de 300 ms |
| Preprocesamiento vs torchvision 0.29 | 24 imágenes JPEG/PNG/WebP de 300×200 a 6000×4000 | sin draft: diferencia 0.0; con el draft conservador: media 0.004–0.011, máx ≤ 0.23 (normalizado) |
| Export ONNX (torch 2.14) | `export_onnx.py` con pesos aleatorios | opset 17, batch dinámico, ORT batch 1 y 32: máx \|Δlogit\| ≈ 1e-4 |
| Trampa del exportador dynamo | `--dynamo` con opset 17 | el archivo sale en opset 18; `verify()` lo detecta y falla |
| Gate de paridad (ORT, CPU) | 512 imágenes sintéticas | top-1 100 %, top-5 100 %, máx \|Δlogit\| 8.0e-05 → exit 0 |
| Gate con `--backend triton` | contra el servidor falso (logits sin relación) | 0 % → exit 1 (el gate bloquea) |
| `config.pbtxt` | parseado a `ModelConfig` (protobuf de tritonclient 2.72) | OK + asserts de nombres, shapes, batching |
| `docker-compose.yml` | `docker compose config` (Compose v5.0.2) | OK |
| Manifests K8s | `kubernetes-validate --strict` contra 1.35, 1.36 y 1.37 + chequeo de referencias cruzadas (Service ↔ Deployment, ServiceMonitor ↔ Service, NetworkPolicy ↔ labels y puertos) | 8 recursos OK (el esquema no revisa el valor de `trafficDistribution`: eso lo hace el API server) |
| CRDs | ServiceMonitor, ScaledObject y el PrometheusRule que genera el comando de arriba contra el `openAPIV3Schema` de prometheus-operator v0.94.1 y KEDA v2.21.0 (jsonschema, campos desconocidos = error) | OK |
| Alertas | YAML + sintaxis PromQL con `promql-parser` 0.10 + nombres/severidades | OK |
| Wheels para la imagen | `pip download --only-binary` para cp313 manylinux x86_64 | los 37 paquetes tienen wheel |

**No verificado** (requiere GPU, daemon de Docker o cluster):

- No se construyó ninguna imagen Docker ni se corrió Triton real; los flags de `tritonserver` y la
  existencia de `curl` y del usuario `triton-server` (uid 1000) en la imagen NGC 24.08 salen de la
  documentación, no de una ejecución.
- `build_engine.sh` solo pasó `bash -n`: `trtexec` no se ejecutó (sin GPU). Correrlo en una T4.
- La paridad FP16 de TensorRT y el rendimiento por GPU (perf_analyzer) no se midieron.
- Las alertas no se evaluaron con `promtool` ni con datos reales; los CRDs solo se validaron contra su
  esquema, no contra un API server; los manifests no se aplicaron a un cluster (ni el ruteo por zona
  ni la NetworkPolicy se probaron con tráfico real).
- `labels.json` es ilustrativo: en un proyecto real sale del `class_to_idx` del dataset de training.
