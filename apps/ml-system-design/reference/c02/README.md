# Caso c02 — archivos de referencia (detección de intrusiones en 1,000 cámaras, edge + nube)

Archivos **reales** del caso c02 de *Ronda de Diseño ML*: 25 centros de distribución × 40 cámaras IP.
Cada sitio tiene una caja edge con **1× NVIDIA L4** que corre **DeepStream 9.1** (decode en NVDEC, lote de
40, detector YOLO en TensorRT, tracker) y un **forwarder** en Python que aplica las reglas de zona y
manda eventos a la nube con store-and-forward. En la nube, una **API de ingesta** (FastAPI) encola en
**SQS** y un **verificador** en GPU (KEDA sobre la cola) confirma antes de alertar al SOC.
Cada archivo está comentado línea por línea explicando **por qué**, no solo qué.

## Estructura

```
c02/
├── edge/                                   # lo que corre en CADA caja (1U, 1× L4)
│   ├── docker-compose.yml                  # deepstream (GPU) + mosquitto + forwarder
│   ├── deepstream/
│   │   ├── ds_app_config.txt               # deepstream-app: 40 RTSP → streammux → YOLO → NvSORT → MQTT
│   │   ├── config_infer_primary.txt        # nvinfer: engine FP16, batch 40, letterbox, NMS, umbrales por clase
│   │   ├── config_tracker_NvSORT.yml       # tracker: ids únicos entre reinicios, probation corta a 5 fps
│   │   ├── msgconv_config.txt              # source_id → camera_id (sin esto todo llega como "0")
│   │   └── labels.txt                      # person, vehicle (orden del training)
│   └── forwarder/
│       ├── rules.py                        # zonas (pie en polígono), horarios, dwell 1.5 s, dedupe 10 min, uuid5
│       ├── app.py                          # MQTT → reglas → fotos → cola SQLite → HTTPS; heartbeat 30 s
│       ├── site.example.yaml               # zonas y horarios de un sitio (se genera del inventario)
│       ├── Dockerfile                      # python:3.13-slim + ffmpeg, usuario no root
│       ├── requirements.txt · requirements-dev.txt · pytest.ini
│       └── tests/test_rules.py             # 25 tests: geometría, dwell, horarios, ids, backoff, cola offline
└── cloud/
    ├── api/
    │   ├── main.py                         # FastAPI: /v1/events (idempotente), /v1/uploads, /v1/heartbeat, SOC
    │   ├── requirements.txt · requirements-dev.txt · pytest.ini
    │   └── tests/test_api.py               # 15 tests: auth por sitio, idempotencia, 503 de SQS, métricas, boto3 sin red
    ├── k8s/verifier.yaml                   # ServiceAccount (IRSA) + Deployment en L4 + PDB + KEDA (aws-sqs-queue)
    └── monitoring/alerts.yml               # EdgeBoxOffline, CameraStreamDown, EventBacklogHigh,
                                            # AlertLatencyHigh, FalseAlarmRateHigh, VerifierErrors
```

## Orden de lectura sugerido

1. `edge/deepstream/ds_app_config.txt` — el pipeline de video y por qué cada llave.
2. `config_infer_primary.txt`, `config_tracker_NvSORT.yml`, `msgconv_config.txt` — detector, tracker, ids de cámara.
3. `edge/forwarder/rules.py` — dónde se decide qué es una intrusión (léelo con `tests/test_rules.py` al lado).
4. `edge/forwarder/app.py` — lo que falla por la red: cola en disco, backoff con jitter, degradación.
5. `edge/docker-compose.yml` — las tres piezas juntas en la caja.
6. `cloud/api/main.py` y `tests/test_api.py` — idempotencia, auth por sitio, métricas.
7. `cloud/k8s/verifier.yaml` y `cloud/monitoring/alerts.yml` — el segundo filtro y lo que despierta a alguien.

## Flujo de un evento

```
cámara ─RTSP 1080p@5fps─▶ DeepStream (NVDEC → lote 40 → YOLO FP16 → NvSORT)
   └─ MQTT local, QoS 0, 1 mensaje por frame y cámara ─▶ forwarder
        rules.py: pie dentro del polígono + clase + horario + 1.5 s de dwell → ZoneEvent (uuid5)
        app.py:   fotos del stream principal (al entrar, a mitad del dwell, al disparar)
                  → SQLite (store-and-forward) → POST /v1/uploads → PUT a S3 → POST /v1/events
                  → clip de 10 s con ffmpeg (-c copy) en segundo plano, prioridad baja
nube:  API ─put_if_absent(event_id)─▶ SQS ─▶ verificador (L4, KEDA 1–2) ─▶ servicio de alertas ─▶ SOC
       SOC ─POST /displayed─▶ alert_end_to_end_seconds   ·   SOC ─POST /disposition─▶ alerts_dismissed_total
```

## Contratos entre piezas (si cambias uno, cambia el otro)

| Contrato | Productor → consumidor | Dónde |
|---|---|---|
| Mensaje "minimal": `{"@timestamp", "sensorId", "objects": ["id\|left\|top\|right\|bottom\|label"]}` | DeepStream → forwarder | `ds_app_config.txt` [sink0] · `rules.parse_minimal_payload` |
| `sensorId` = id de cámara | `msgconv_config.txt` [sensorN] → `site.yaml` cameras | los dos se generan del inventario |
| Coordenadas en píxeles del streammux (1920×1080) | [streammux] → `frame_width/height` | `site.example.yaml` |
| Cuerpo de `POST /v1/events` | `ZoneEvent.to_payload` → `EventIn` | `rules.py` · `main.py` |
| Llaves S3 `sites/<sitio>/events/<event_id>/frame-<i>.jpg` | API → forwarder → verificador | `main.py` (valida el prefijo) |
| Métricas y alertas | `main.py` / worker del verificador → `alerts.yml` | nombres idénticos |

## Correr los tests (sin GPU, sin cámaras, sin AWS)

```bash
cd reference/c02/edge/forwarder
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest          # 25 tests: geometría, dwell, horarios (incluida la trampa del lunes 00:00–06:00),
                # ids idempotentes entre reinicios, backoff con jitter, cola offline, degradación sin fotos

cd ../../cloud/api
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest          # 15 tests: token por sitio, idempotencia, 503 si SQS falla y el reintento sí encola,
                # métricas del heartbeat, latencia E2E, falsas alarmas; boto3 real sin red (Stubber, SigV4)
```

## Levantar una caja (necesita la L4, el driver y NVIDIA Container Toolkit)

Requisitos del host: Ubuntu 24.04, driver NVIDIA ≥ 595.58.03 (el que pide DeepStream 9.1 en x86),
Docker con NVIDIA Container Toolkit, NTP (chrony) activo, y el bundle del modelo en
`/opt/c02/models/<versión>/` con `detector_b40_fp16.engine` y `libnvdsinfer_custom_impl_Yolo.so`, más un
symlink **relativo** `current → <versión>`. El engine y el parser se construyen en una caja idéntica
(misma L4, misma imagen de DeepStream 9.1): el engine no es portable entre GPUs ni versiones de TensorRT.

```bash
sudo install -d -m 700 /etc/c02/secrets
echo -n "<token del sitio>"       | sudo tee /etc/c02/secrets/api_token >/dev/null
echo -n "<clave de las cámaras>"  | sudo tee /etc/c02/secrets/camera_password >/dev/null
cd reference/c02/edge
docker compose up -d --build
docker compose logs -f forwarder     # una línea JSON por evento: event_queued, sent, send_retry…
docker compose logs deepstream | grep -i fps    # FPS por stream cada 30 s
```

Prueba sin cámaras: cambia una `uri` de `ds_app_config.txt` por `file:///opt/nvidia/deepstream/deepstream/samples/streams/sample_1080p_h264.mp4`
con `type=2` (URI; las muestras vienen en la imagen `samples`) y observa los mensajes con
`docker compose exec mqtt mosquitto_sub -t ds/detections -C 5`.

## Desplegar la parte de nube (resumen)

- **API**: imagen de `cloud/api` con `uvicorn --factory main:app_from_env --host 0.0.0.0 --port 8080`, detrás de
  un ALB con TLS; variables `SITE_TOKENS_FILE` (JSON `{"<sha256 del token>": "<sitio>"}`, montado desde un Secret),
  `SOC_TOKEN_SHA256`, `SQS_QUEUE_URL`, `EVIDENCE_BUCKET`, y un rol IAM (IRSA) con `sqs:SendMessage` y `s3:PutObject`
  (la firma de la URL usa las credenciales del rol). Tabla de eventos con escritura condicional (DynamoDB) en vez
  del store en memoria del ejemplo.
- **SQS**: cola estándar `c02-candidate-events` con DLQ (`maxReceiveCount` ≈ 5) y visibility timeout de 30 s.
- **S3**: bucket `c02-evidence` con lifecycle de 30 días sobre `sites/`.
- **Verificador**: `kubectl create namespace c02 && kubectl apply -f cloud/k8s/verifier.yaml` (requiere KEDA,
  NVIDIA device plugin y un node group de g6.xlarge con label `workload=gpu-l4` y taint `nvidia.com/gpu=present:NoSchedule`).
- **Alertas**: `alerts.yml` se carga como spec de un PrometheusRule (mismo comando que en `reference/c01/README.md`).
  Hacen falta ServiceMonitors para la API y el verificador (como `reference/c01/k8s/monitoring.yaml`) y el
  exportador de CloudWatch configurado como dice el comentario de EventBacklogHigh.

## Qué se verificó y qué no

Probado en macOS (Apple Silicon), Python 3.13, sin GPU, sin daemon de Docker y sin AWS:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests del forwarder | `pytest` en un venv limpio con `requirements-dev.txt` | 25 passed |
| Tests de la API | ídem | 15 passed |
| Que los tests muerdan | 25 mutaciones a mano. Forwarder (15): pie → centro, sin tolerancia de salida, ventana nocturna mal, sin dedupe, id sin ventana, sin foto de mitad, sin dwell por zona, sin degradación, cola FIFO sin prioridad, LIFO, sin jitter, token hacia S3, cámara muda omitida, encolado no idempotente, 4xx reintentado para siempre. API (10): "duplicate" que no re-encola, sin chequeo de sitio, sin chequeo de prefijo, fps sin TTL, heartbeat y descartes sin inicializar, latencia E2E contada doble, sin 409 entre sitios, `extra="forbid"`, firma sin s3v4 | 25/25 hacen fallar algún test |
| Integración real en procesos | broker MQTT (amqtt 0.12, MQTT 3.1.1) + `app.py` completo + la API real con `uvicorn --factory` + cámara falsa con Digest + S3 falso; un publicador imita los mensajes minimal de DeepStream a 5 fps | evento a los ≈ 1.6 s del primer frame, 3 fotos con Digest, 3 PUT a S3 sin header Authorization, 202 accepted, heartbeat con fps por cámara en `/metrics`; con la API caída el evento esperó en SQLite (4–5 reintentos con backoff según la corrida) y salió al volver; SIGTERM → salida limpia (exit 0) |
| Hallazgo: boto3 y SigV2 | test con botocore 1.43 en us-east-1 | un cliente S3 sin `signature_version="s3v4"` firma con SigV2; el signer fuerza s3v4 |
| Hallazgo: logs de httpx2 | la corrida de integración | httpx2 loguea cada request en INFO; el forwarder deja la raíz en WARNING |
| Llaves de DeepStream | cada llave de `ds_app_config.txt` y `config_infer_primary.txt` contra los parsers de DS 9.1 (código de github.com/NVIDIA/DeepStream: `deepstream_config_file_parser.c`, `deepstream_app_config_parser.c`, `gstnvinfer_property_parser`) + sin comentarios al final de línea + [sourceN] ↔ [sensorN] | todas existen; control negativo (llave mal escrita, comentario en línea) detectado |
| Semántica verificada en el código de DS 9.1 | `gstnvmsgconv.cpp`, `dsmeta_payload.cpp`, `nvds_mqtt_proto.cpp`, `deepstream_sink_bin.c` | frame-interval default 30; payload minimal por frame (incluso vacío); sensorId "0" sin [sensorN]; cajas en coordenadas del muxer; MQTT v5 con QoS 0; cola leaky de 20 buffers antes del conversor |
| Tracker YAML | PyYAML (sin la línea `%YAML:1.0`) + cada llave presente en la guía de Gst-nvtracker 9.1 | OK |
| `docker compose config` | Compose v5.0.2 | OK (incluye `configs.content` en línea) |
| Manifests K8s | `kubernetes-validate --strict` 1.34 y 1.36 (ServiceAccount, Deployment, PDB) + ScaledObject y TriggerAuthentication contra el `openAPIV3Schema` de los CRDs de KEDA 2.21.0 (campos desconocidos = error) + nombres de parámetros del scaler en `aws_sqs_queue_scaler.go` | OK |
| Alertas | YAML + sintaxis PromQL con `promql-parser` 0.10 + nombres/severidades | OK |
| ffmpeg del clip | ffmpeg 8.1: `-rtsp_transport tcp` existe en el demuxer RTSP; `-t 10 -an -c copy -movflags +faststart` sobre un H.264 local | clip de ≈ 10.1 s |

**No verificado** (requiere la L4, cámaras reales, un cluster o AWS):

- DeepStream no se ejecutó: ni el pipeline, ni la carga del engine, ni el parser de YOLO, ni el adaptador MQTT
  con mosquitto 2.0.22. Las llaves y su semántica salen de la documentación y del código fuente de DS 9.1;
  que la imagen `samples` traiga libmosquitto y declare la capacidad `video` sale de su Dockerfile público
  (`deepstream_dockers/x86_dockerfiles/Dockerfile_samples_x86`), no de inspeccionar la imagen de NGC.
- `trtexec` no corrió; el throughput por L4 (≈ 400 frames/s de máximo medido supuesto) y la latencia por frame
  (≤ 300 ms) son estimaciones a medir con trtexec y con el FPS que imprime deepstream-app.
- El tracker NvSORT con estos parámetros no se probó con video: los valores de asociación son los de la guía
  de NVIDIA (ajustados para PeopleNet a 30 fps) y hay que re-ajustarlos con video de los sitios.
- El clip contra una cámara RTSP real y el snapshot de una cámara ONVIF real (la ruta cambia por fabricante).
- Ninguna imagen se construyó; nada se aplicó a un cluster; las alertas no pasaron por `promtool` ni se
  evaluaron con datos; SQS, S3 y el exportador de CloudWatch no se tocaron (boto3 se probó sin red).
- El worker del verificador y el servicio de alertas del SOC no están en esta carpeta: `verifier.yaml`
  documenta su contrato (métricas, probes, idempotencia por event_id).
