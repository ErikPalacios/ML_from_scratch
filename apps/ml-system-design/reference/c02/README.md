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
│   │   ├── ds_app_config.txt               # deepstream-app: 40 RTSP → streammux → YOLO → NvSORT → MQTT (plantilla)
│   │   ├── config_infer_primary.txt        # nvinfer: engine FP16, batch 40, letterbox, NMS, umbrales por clase
│   │   ├── config_tracker_NvSORT.yml       # tracker: ids únicos entre reinicios, probation corta a 5 fps
│   │   ├── msgconv_config.txt              # source_id → camera_id (sin esto todo llega como "0")
│   │   └── labels.txt                      # person, vehicle (orden del training)
│   └── forwarder/
│       ├── rules.py                        # zonas (pie en polígono), horarios, dwell 1.5 s, dedupe 10 min, uuid5
│       ├── app.py                          # MQTT → reglas → fotos → cola SQLite (carriles evento/clip) → HTTPS; heartbeat 30 s
│       ├── site.example.yaml               # zonas y horarios de un sitio (se genera del inventario)
│       ├── Dockerfile                      # python:3.13-slim + ffmpeg, usuario no root
│       ├── requirements.txt · requirements-dev.txt · pytest.ini
│       └── tests/test_rules.py             # 41 tests: geometría, dwell, SLO, horarios, validación, ids, cola, carriles
└── cloud/
    ├── api/
    │   ├── main.py                         # FastAPI: /v1/events (idempotente), /v1/uploads, /v1/heartbeat, SOC
    │   ├── requirements.txt · requirements-dev.txt · pytest.ini
    │   └── tests/test_api.py               # 18 tests: auth por sitio, idempotencia, 503 de SQS, métricas, boto3 sin red
    ├── k8s/verifier.yaml                   # ServiceAccount (IRSA) + Deployment en L4 + PDB + KEDA + PodMonitor
    └── monitoring/alerts.yml               # 8 alertas: EdgeBoxOffline, SitePipelineDown, CameraStreamDown,
                                            # EdgeEventsStuck, EventBacklogHigh, AlertLatencyHigh,
                                            # FalseAlarmRateHigh, VerifierErrors
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
                  → clip de 10 s con ffmpeg (-c copy) en segundo plano, por su propio carril (nunca frena un evento)
nube:  API ─put_if_absent(event_id)─▶ SQS ─▶ verificador (L4, KEDA 1–2) ─▶ servicio de alertas ─▶ SOC
       SOC ─POST /displayed─▶ alert_end_to_end_seconds   ·   SOC ─POST /disposition─▶ alerts_dismissed_total
```

## Contratos entre piezas (si cambias uno, cambia el otro)

| Contrato | Productor → consumidor | Dónde |
|---|---|---|
| Mensaje "minimal": `{"@timestamp", "sensorId", "objects": ["id\|left\|top\|right\|bottom\|label"]}` | DeepStream → forwarder | `ds_app_config.txt` [sink0] · `rules.parse_minimal_payload` |
| `sensorId` = id de cámara | `msgconv_config.txt` [sensorN] → `site.yaml` cameras | los dos se generan del inventario |
| Coordenadas en píxeles del streammux (1920×1080) | [streammux] → `frame_width/height` | `site.example.yaml` |
| Cuerpo de `POST /v1/events` (incluye `slo`: solo la primera alerta de una intrusión mide latencia) | `ZoneEvent.to_payload` → `EventIn` | `rules.py` · `main.py` |
| Cuerpo de `POST /v1/heartbeat` (`site_id`, fps por cámara, `Outbox.stats()`) | `heartbeat_loop` → `HeartbeatIn` → `camera_fps`, `edge_outbox_*` | `app.py` · `main.py` · `alerts.yml` |
| Llaves S3 `sites/<sitio>/events/<event_id>/frame-<i>.jpg` | API → forwarder → verificador | `main.py` (valida el prefijo) |
| Métricas y alertas | `main.py` / worker del verificador → `alerts.yml` | nombres idénticos |

## Correr los tests (sin GPU, sin cámaras, sin AWS)

```bash
cd reference/c02/edge/forwarder
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest          # 41 tests: geometría, dwell, qué entra al SLO, horarios (incluida la trampa del lunes
                # 00:00–06:00), typos en site.yaml, ids idempotentes, backoff con jitter, cola offline,
                # 401/403 que esperan, carriles de eventos y clips, degradación sin fotos, apagado con clip en curso

cd ../../cloud/api
python3.13 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest          # 18 tests: token por sitio, idempotencia, 503 si SQS falla y el reintento sí encola,
                # métricas del heartbeat y de la cola de la caja, latencia E2E solo con slo=true,
                # falsas alarmas; boto3 real sin red (Stubber, SigV4)
```

## Levantar una caja (necesita la L4, el driver y NVIDIA Container Toolkit)

Requisitos del host: Ubuntu 24.04, driver NVIDIA ≥ 595.58.03 (el que pide DeepStream 9.1 en x86),
Docker con NVIDIA Container Toolkit, NTP (chrony) activo, y el bundle del modelo en
`/opt/c02/models/<versión>/` con `detector_b40_fp16.engine` y `libnvdsinfer_custom_impl_Yolo.so`, más un
symlink **relativo** `current → <versión>`. El engine y el parser se construyen en una caja idéntica
(misma L4, misma imagen de DeepStream 9.1): el engine no es portable entre GPUs ni versiones de TensorRT.

`edge/deepstream/` es una **plantilla**: deepstream-app no tiene llaves de usuario y clave para una fuente
RTSP, así que la clave de las cámaras solo puede ir dentro de cada `uri`. El aprovisionamiento (el mismo
script que genera las 40 `[sourceN]`, `msgconv_config.txt` y `site.yaml` desde el inventario) renderiza la
carpeta con la clave codificada para URL en `/etc/c02/deepstream/` (root, 0600; DeepStream corre como root
en su imagen) y compose monta **esa** carpeta en `/config`. El archivo renderizado es un secreto: fuera de
git y de los backups.

```bash
sudo install -d -m 700 /etc/c02/secrets
echo -n "<token del sitio>"       | sudo tee /etc/c02/secrets/api_token >/dev/null
echo -n "<clave de las cámaras>"  | sudo tee /etc/c02/secrets/camera_password >/dev/null
# Renderizar la config de DeepStream (desde la raíz del repo; en producción lo hace el aprovisionamiento)
sudo python3 - <<'PY'
import pathlib, urllib.parse
pw = urllib.parse.quote(pathlib.Path("/etc/c02/secrets/camera_password").read_text().strip(), safe="")
out = pathlib.Path("/etc/c02/deepstream"); out.mkdir(mode=0o700, exist_ok=True)
for src in pathlib.Path("reference/c02/edge/deepstream").iterdir():
    dst = out / src.name
    dst.write_text(src.read_text().replace("<usuario>", "forwarder").replace("<password-url-encoded>", pw))
    dst.chmod(0o600)
PY
cd reference/c02/edge
docker compose up -d --build
docker compose logs -f forwarder     # una línea JSON por evento: event_queued, sent, send_retry…
docker compose logs deepstream | grep -i fps    # FPS por stream cada 30 s
```

Prueba sin cámaras: cambia una `uri` de `/etc/c02/deepstream/ds_app_config.txt` por `file:///opt/nvidia/deepstream/deepstream/samples/streams/sample_1080p_h264.mp4`
con `type=2` (URI; las muestras vienen en la imagen `samples`) y observa los mensajes con
`docker compose exec mqtt mosquitto_sub -t ds/detections -C 5`.

## Desplegar la parte de nube (resumen)

- **API**: imagen de `cloud/api` con `uvicorn --factory main:app_from_env --host 0.0.0.0 --port 8080`, detrás de
  un ALB con TLS que enruta **solo** `/v1/*` (y usa `/healthz` como health check): `/metrics` no se publica,
  Prometheus lo lee de los pods (publicado, `camera_fps{site,camera}` diría qué cámaras de perímetro están
  caídas ahora mismo). Variables `SITE_TOKENS_FILE` (JSON `{"<sha256 del token>": "<sitio>"}`, montado desde un Secret),
  `SOC_TOKEN_SHA256`, `SQS_QUEUE_URL`, `EVIDENCE_BUCKET`, y un rol IAM (IRSA) con `sqs:SendMessage` y `s3:PutObject`
  (la firma de la URL usa las credenciales del rol). Tabla de eventos con escritura condicional (DynamoDB) en vez
  del store en memoria del ejemplo.
- **SQS**: cola estándar `c02-candidate-events` con DLQ (`maxReceiveCount` ≈ 5) y visibility timeout de 30 s.
- **S3**: bucket `c02-evidence` con lifecycle de 30 días sobre `sites/`.
- **Verificador**: `kubectl create namespace c02 && kubectl apply -f cloud/k8s/verifier.yaml` (requiere KEDA,
  NVIDIA device plugin y un node group de g6.xlarge con label `workload=gpu-l4` y taint `nvidia.com/gpu=present:NoSchedule`).
- **Alertas**: `alerts.yml` se carga como spec de un PrometheusRule (mismo comando que en `reference/c01/README.md`).
  Hace falta un ServiceMonitor para la API (como `reference/c01/k8s/monitoring.yaml`); el verificador no tiene
  Service, así que su scrape es el **PodMonitor** que ya trae `verifier.yaml`. Y el exportador de CloudWatch
  configurado como dice el comentario de EventBacklogHigh.

## Qué se verificó y qué no

Probado en macOS (Apple Silicon), Python 3.13, sin GPU, sin daemon de Docker y sin AWS:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests del forwarder | `pytest` en un venv limpio con `requirements-dev.txt` | 41 passed |
| Tests de la API | ídem | 18 passed |
| Que los tests muerdan (revisión) | 19 mutaciones más sobre lo agregado tras la revisión: 401/403 a dead-letter, sin red en `on_message`, clave sin codificar, un solo carril, `stop_clips` que no termina ffmpeg o que deja arrancar clips, edad de la cola contando clips, `slo` siempre true o sin mirar el dedupe, caja sin recortar, typos de site.yaml aceptados, JSON que no es objeto, histogramas con `slo=false`, heartbeat de otro sitio aceptado, gauges de la cola sin TTL | 19/19 hacen fallar algún test |
| Que los tests muerdan | 25 mutaciones a mano. Forwarder (15): pie → centro, sin tolerancia de salida, ventana nocturna mal, sin dedupe, id sin ventana, sin foto de mitad, sin dwell por zona, sin degradación, cola FIFO sin prioridad, LIFO, sin jitter, token hacia S3, cámara muda omitida, encolado no idempotente, 4xx reintentado para siempre. API (10): "duplicate" que no re-encola, sin chequeo de sitio, sin chequeo de prefijo, fps sin TTL, heartbeat y descartes sin inicializar, latencia E2E contada doble, sin 409 entre sitios, `extra="forbid"`, firma sin s3v4 | 25/25 hacen fallar algún test |
| Integración real en procesos (repetida tras la revisión) | broker MQTT (amqtt 0.12, MQTT 3.1.1) + `app.py` completo + la API real con `uvicorn --factory` + cámara falsa con Digest + S3 falso; un publicador imita los mensajes minimal de DeepStream a 5 fps | evento a los ≈ 1.7 s del primer frame, 3 fotos con Digest, 3 PUT a S3 sin header Authorization, 202 accepted con `slo: true`, heartbeat con fps por cámara y `edge_outbox_*` en `/metrics`; con la API caída el evento esperó en SQLite (4–5 reintentos con backoff según la corrida) y salió al volver; SIGTERM → salida limpia en ≈ 1 s (exit 0) |
| Apagado con un clip en curso | ffmpeg 8.1 real grabando con `-re`, luego SIGTERM | sale en ≈ 0.03 s (código 255, archivo cerrado): `stop_clips()` no deja esperando a Docker |
| Hallazgo: boto3 y SigV2 | test con botocore 1.43 en us-east-1 | un cliente S3 sin `signature_version="s3v4"` firma con SigV2; el signer fuerza s3v4 |
| Hallazgo: logs de httpx2 | la corrida de integración | httpx2 loguea cada request en INFO; el forwarder deja la raíz en WARNING |
| Credenciales en la URI RTSP | `deepstream_config_file_parser.c` (sin llaves de usuario/clave en `[sourceN]`), `gstrtspurl.c` de GStreamer y `libavformat/httpauth.c` de FFmpeg | DeepStream solo acepta la clave dentro de la URI; rtspsrc y ffmpeg decodifican el percent-encoding, así que `%23` llega como `#` |
| Reconexión MQTT de DeepStream | `gstnvmsgbroker.cpp`, `nvmsgbroker.cpp`, `nvds_mqtt_proto.cpp` y `cfg_nvmsgbroker.txt` de DS 9.1 | con la API vieja (default) el aviso de conexión perdida cae en un callback vacío y nadie reconecta; con `new-api=1` libnvds_msgbroker reconecta (auto-reconnect=1, cada 1 s, hasta 3600 s) |
| Llaves de DeepStream | cada llave de `ds_app_config.txt` y `config_infer_primary.txt` contra los parsers de DS 9.1 (código de github.com/NVIDIA/DeepStream: `deepstream_config_file_parser.c`, `deepstream_app_config_parser.c`, `gstnvinfer_property_parser`) + sin comentarios al final de línea + [sourceN] ↔ [sensorN] | todas existen; control negativo (llave mal escrita, comentario en línea) detectado |
| Semántica verificada en el código de DS 9.1 | `gstnvmsgconv.cpp`, `dsmeta_payload.cpp`, `nvds_mqtt_proto.cpp`, `deepstream_sink_bin.c` | frame-interval default 30; payload minimal por frame (incluso vacío); sensorId "0" sin [sensorN]; cajas en coordenadas del muxer; MQTT v5 con QoS 0; cola leaky de 20 buffers antes del conversor |
| Tracker YAML | PyYAML (sin la línea `%YAML:1.0`) + cada llave presente en la guía de Gst-nvtracker 9.1 | OK |
| `docker compose config` | Compose v5.0.2 | OK (incluye `configs.content` en línea y `depends_on.restart`) |
| Manifests K8s | `kubernetes-validate --strict` 1.34 y 1.36 (ServiceAccount, Deployment, PDB) + ScaledObject y TriggerAuthentication contra el `openAPIV3Schema` de los CRDs de KEDA 2.21.0 y el PodMonitor contra el de prometheus-operator v0.94.1 (campos desconocidos = error) + nombres de parámetros del scaler en `aws_sqs_queue_scaler.go` | OK |
| Alertas | YAML + sintaxis PromQL con `promql-parser` 0.10 + nombres/severidades | OK |
| ffmpeg del clip | ffmpeg 8.1: `-rtsp_transport tcp` existe en el demuxer RTSP; `-t 10 -an -c copy -movflags +faststart` sobre un H.264 local | clip de ≈ 10.1 s |

**No verificado** (requiere la L4, cámaras reales, un cluster o AWS):

- DeepStream no se ejecutó: ni el pipeline, ni la carga del engine, ni el parser de YOLO, ni el adaptador MQTT
  con mosquitto 2.0.22. En particular, la reconexión con `new-api=1` tras reiniciar mosquitto sale del
  código fuente, no de una prueba con un broker real; tampoco se probó una URI con credenciales contra
  una cámara. Las llaves y su semántica salen de la documentación y del código fuente de DS 9.1;
  que la imagen `samples` traiga libmosquitto y declare la capacidad `video` sale de su Dockerfile público
  (`deepstream_dockers/x86_dockerfiles/Dockerfile_samples_x86`), no de inspeccionar la imagen de NGC.
- `trtexec` no corrió; el throughput por L4 (≈ 400 frames/s de máximo medido supuesto) y la latencia por frame
  (≤ 300 ms) son estimaciones a medir con trtexec y con el FPS que imprime deepstream-app.
- El tracker NvSORT con estos parámetros no se probó con video: los valores de asociación son los de la guía
  de NVIDIA (ajustados para PeopleNet a 30 fps) y hay que re-ajustarlos con video de los sitios.
- El clip contra una cámara RTSP real y el snapshot de una cámara ONVIF real (la ruta cambia por fabricante).
- Ninguna imagen se construyó; nada se aplicó a un cluster; las alertas no pasaron por `promtool` ni se
  evaluaron con datos (el umbral de 4 s de AlertLatencyHigh supone ≈ 1 s antes de `first_seen_at`: se
  confirma con walk tests cronometrados); SQS, S3 y el exportador de CloudWatch no se tocaron (boto3 se probó sin red).
- El worker del verificador y el servicio de alertas del SOC no están en esta carpeta: `verifier.yaml`
  documenta su contrato (métricas, probes, idempotencia por event_id).
