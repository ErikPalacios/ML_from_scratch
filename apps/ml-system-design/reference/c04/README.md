# Caso c04 — archivos de referencia (segmentación de tumor en whole-slide images)

Archivos **reales** del caso c04 de *Ronda de Diseño ML*: el `seg-worker` que vacía la cola
`slide-jobs` (descarga el WSI, valida el mpp, arma la máscara de tejido y la grilla de tiles, infiere
en una L4, cose los mapas sin costuras y escribe un resultado trazable), su imagen y su despliegue con
KEDA, la selección de regiones para etiquetar con 20 h de patólogo al mes, y las alertas de Prometheus
con sus tests. Cada archivo está comentado explicando **por qué**.

El sistema es **asistivo**: el patólogo siempre revisa, corrige y firma. Nada de aquí es consejo clínico
ni regulatorio.

## Estructura

```
c04/
├── worker/                          # el seg-worker (corre en nodos g6.2xlarge con 1× L4)
│   ├── tiling.py                    # matemática PURA: mpp, nivel de lectura, máscara, grilla, stitching, mm²
│   ├── worker.py                    # el loop: cola, idempotencia, heartbeat, SIGTERM, QC, resultado, métricas
│   ├── requirements.txt             # runtime fijado (14 paquetes con transitivas)
│   ├── requirements-dev.txt         # + pytest, moto (S3/SQS en memoria), tifffile (SVS sintético)
│   ├── pytest.ini
│   ├── tests/conftest.py            # cola con semántica de SQS, storage, WSI sintético, modelo falso
│   ├── tests/test_tiling.py         # 35 tests
│   ├── tests/test_worker.py         # 30 tests (incluye boto3 + moto + OpenSlide real)
│   └── Dockerfile                   # nvcr.io/nvidia/tensorrt:26.08-py3, no root, engine horneado
├── k8s/seg-worker.yaml              # ServiceAccount (IRSA) + ConfigMap + Deployment + PodMonitor + KEDA (0–4)
├── loop/
│   ├── select_for_labeling.py       # active learning con presupuesto de horas de patólogo
│   └── tests/test_select.py         # 13 tests
└── monitoring/
    ├── alerts.yml                   # 10 alertas (+ recording rules del SLO y de la baseline)
    ├── alerts_test.yml              # tests de promtool: cada alerta dispara (o no) con series sintéticas
    ├── stain_psi.py                 # job diario: PSI de color por lab/escáner → Pushgateway
    └── tests/test_stain_psi.py      # 6 tests
```

## Orden de lectura sugerido

1. `worker/tiling.py` — `choose_read_plan` (por qué 1024 px del nivel 0 para un tile de 512),
   `check_mpp` (por qué un mpp dudoso bloquea en vez de adivinar) y `Stitcher` (por qué no hay costuras).
2. `worker/worker.py` — el docstring y `Worker.handle`: qué pasa con el MENSAJE en cada camino.
3. `worker/tests/test_worker.py` — cada test es un modo de falla con nombre (redelivery, DLQ, SIGTERM…).
4. `k8s/seg-worker.yaml` — por qué 90 s de gracia, por qué sin PDB, por qué `queueLength: "20"`.
5. `monitoring/alerts.yml` y `alerts_test.yml` — qué ve cada alerta y qué NO ve.
6. `loop/select_for_labeling.py` — cómo se gastan las horas de patólogo que quedan para active learning
   (≈ 15.5 de las 20: el resto va a la auditoría aleatoria y al set temporal, que se eligen al azar).

## Un slide, de punta a punta

```
t = 0        el escáner termina de subir el WSI (≈ 1 GB) al archivo → evento → mensaje en slide-jobs
             {"slide_id", "uri": "s3://…", "sha256", "lab", "scanner", "available_at"?}
≤ 30 s       KEDA lo ve (GetQueueAttributes). Con 0 workers: + cold start ≈ 3–5 min (est.)
+ 0–20 s     receive (long polling, 1 mensaje) → arranca el heartbeat (visibilidad 300 s, cada 60 s)
             ¿results/<slide_id>/<model_version>/summary.json con este sha256 y este config hash? → borrar y listo
             ¿apunta a un reescaneo MÁS NUEVO de este slide? → este mensaje es del archivo viejo: borrar y listo
+ 5–10 s     descarga a NVMe (GETs por rangos, 16 en paralelo) + sha256 del archivo (est.)
+ ≈ 1 s      QC: mpp del archivo vs el registrado para ese escáner; máscara de tejido en el nivel de 4 µm/px
             mpp faltante/raro, escáner sin registrar, sin pirámide, < 1 mm² de tejido → qc_blocked (sin números)
+ ≈ 15 s     ≈ 3,000 tiles: 6 hilos leen 1024² px del nivel 0 y reducen 2× → batches de 16 a la L4 (plan 200 tiles/s)
+ 2–3 s      stitch con rampas lineales → umbral 0.5 → mm² y % de tejido → GeoJSON (px de nivel 0) + heatmap PNG
+ < 1 s      artefactos en results/<slide_id>/<model_version>/runs/<sha256[:12]>-<config[:8]>/
             → summary.json (EL commit, escritura condicional con ETag) → fila en el índice → DeleteMessage
≈ 20–30 s en el worker (est.); el SLO es turnaround p95 ≤ 60 min desde que el WSI está en el archivo
```

**Qué pasa con el mensaje en cada camino** (lo que el entrevistador quiere oír):

| Camino | Mensaje | Resultado |
|---|---|---|
| ok / qc_blocked | `DeleteMessage` **después** de `summary.json` y del índice | visible en el visor (con números o con el motivo del bloqueo) |
| ya procesado (mismo sha256 + config) | se borra sin tocar la GPU; se repite el upsert del índice | el que ya estaba |
| archivo viejo de un slide ya reescaneado | se borra sin tocar la GPU (cuenta como `duplicate`) | el del reescaneo, que ya estaba |
| el viejo termina DESPUÉS que el reescaneo (carrera) | se borra después de escribir su fila en el índice | `summary.json` no se toca: sigue en el reescaneo |
| error (S3, modelo, NaN, sha distinto, mensaje inválido) | **no** se borra; visibilidad = 60 s × intento (backoff) | ninguno; al 4.º receive SQS lo mueve a `slide-jobs-dlq` |
| SIGTERM (spot, scale-down, deploy) | visibilidad 0: otro worker lo toma ya | ninguno a medias (esa entrega cuenta para maxReceiveCount) |
| SIGKILL / nodo muerto | nadie lo toca | reaparece al vencer la visibilidad (≤ 300 s) |

### `summary.json` (campos principales)

`schema_version`, `status` (`ok` · `qc_blocked`), `slide_id`, `lab`, `scanner`, `input_uri`,
`input_sha256`, `model_version`, `container_digest`, `training_data_version`,
`preprocessing_config_hash` (+ `preprocessing_config`), `tissue_mm2`, `tumor_mm2`,
`tumor_pct_of_tissue`, `tissue_covered_frac`, `mean_confidence`, `tumor_threshold`, `mpp`, `read_plan`,
`tiles`, `qc` (`flags`, `blocking`, `blurry_tile_frac`, `color_hist`), `artifacts`
(`tumor_geojson`, `heatmap_png`, `map_mpp` = 4, `map_to_level0` = 16), `timings_s`, `available_at`,
`completed_at`, `turnaround_s`, `worker`, `attempt`. Con `qc_blocked`, los números van en `null`.

### Métricas del worker (`/metrics` en :9100)

| Métrica | Labels | La usa |
|---|---|---|
| `seg_slides_processed_total` | lab, scanner, status (`ok` · `qc_blocked` · `duplicate` · `error` · `interrupted`) | SegWorkerErrors |
| `seg_turnaround_seconds` (histograma, bucket en 3600) | lab | TurnaroundSLOBurn (recording rules) |
| `seg_qc_flags_total` | lab, scanner, flag | MissingMppMetadata |
| `seg_blurry_tiles_total`, `seg_blur_checked_tiles_total` | lab, scanner | BlurryTilesSpike |
| `seg_tiles_total` | lab, scanner | dashboards (tiles por slide) |
| `seg_slide_seconds`, `seg_stage_seconds{stage}` | — / stage (`download`, `sha256`, `qc_mask`, `inference`, `postprocess`, `write_artifacts`, `write_summary`) | dashboards y runbook de TurnaroundSLOBurn (¿qué etapa se atrasó?) |
| `seg_tumor_pct_of_tissue`, `seg_mean_confidence` (histogramas) | lab | dashboards de modelo (drift de predicción) |
| `seg_redeliveries_total`, `seg_heartbeat_failures_total`, `seg_last_success_timestamp_seconds` | lab / — / — | diagnóstico |

Flags de QC: bloqueantes `missing_mpp`, `odd_mpp`, `anisotropic_mpp`, `mpp_mismatch`, `unknown_scanner`,
`no_low_res_level`, `low_tissue`; informativo `blurry`; de integridad (error y reintento)
`sha256_mismatch`. Las series conocidas se crean en 0 al arrancar, y `/metrics` se levanta antes de
cargar el engine: sin eso, `increase()` no ve el primer caso (hay un test de promtool que lo
demuestra). Casi siempre alcanza; un pod recién escalado desde 0 que terminara su primer slide antes
del primer scrape (cada 15 s) haría nacer la serie en 1.

Otras métricas que usan las alertas: `seg_stain_psi{lab,scanner,channel}` y `seg_stain_psi_slides`
(job diario `stain_psi.py`) más el `push_time_seconds` que agrega el Pushgateway (StainPsiJobStale);
`results_reviews_total{lab,edit}` con `edit` = `none` · `minor` · `major` (results-api, al firmar) y
`seg_pending_slides_before_cutoff` (results-api, SLO de las 07:00; ver NightlyCoverageAtRisk):
results-api no está en esta carpeta. Y `aws_sqs_*` (CloudWatch vía exportador).

### Las 10 alertas

| Grupo | Alerta | Severidad |
|---|---|---|
| Sistema | `SlideQueueBacklog`, `TurnaroundSLOBurn` (rápida), `SegWorkerErrors` | page en horario (07:00–22:00), ticket de noche |
| Sistema | `NightlyCoverageAtRisk` (SLO de las 07:00) | page desde las 05:30, todos los días (ruta propia en Alertmanager) |
| Sistema | `SlideDLQNotEmpty`, `TurnaroundSLOBurn` (lenta) | ticket |
| Datos | `StainDriftPerScanner`, `StainPsiJobStale`, `BlurryTilesSpike`, `MissingMppMetadata` | ticket |
| Modelo | `MajorEditRateHigh` | ticket |

## Correr los tests (sin AWS, sin GPU, sin un WSI real)

```bash
cd reference/c04/worker
python3 -m venv .venv && . .venv/bin/activate          # Python 3.12 (el de la imagen) o 3.13
pip install -r requirements-dev.txt
pytest                                                  # 65 tests, ≈ 35 s

cd ../loop && pytest -q tests                           # 13 tests (solo pytest)
cd ../monitoring && pytest -q tests                     # 6 tests (prometheus-client)
promtool check rules alerts.yml                         # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                     # ≈ 1.5 min: simula hasta 29 días de series
```

Selección para etiquetar, con el CSV que produce un job de inferencia sobre los slides del mes:

```bash
python loop/select_for_labeling.py candidatos.csv --hours 15.5 --exclude-slides golden.txt -o lista.csv
# CSV: slide_id,lab,scanner,region_id,x,y,mean_entropy[,minutes]   (o margin con --score margin)
```

## Desplegar en EKS (resumen)

Prerrequisitos: node pool de `g6.2xlarge` con taint `nvidia.com/gpu=present:NoSchedule`, el instance
store NVMe como almacenamiento efímero (Karpenter: `instanceStorePolicy: RAID0`), NVIDIA device plugin,
KEDA 2.21 con IRSA (`sqs:GetQueueAttributes`), kube-prometheus-stack, un exportador de CloudWatch y el
Pushgateway (con persistencia y scrapeado con `honor_labels: true`). La cola `slide-jobs` (visibilidad
300 s, long polling 20 s, retención 4 días, redrive a `slide-jobs-dlq` con maxReceiveCount 3; la DLQ
con 14 días) se crea con IaC.

El rol IRSA del worker (`c04-seg-worker`), de mínimo privilegio:

- `sqs:ReceiveMessage`, `sqs:ChangeMessageVisibility`, `sqs:DeleteMessage` en `slide-jobs`.
- `s3:GetObject` en el bucket del archivo (solo lectura).
- `s3:GetObject`, `s3:PutObject` y **`s3:ListBucket`** en el bucket de resultados; sin `DeleteObject`.
  ListBucket no sobra: sin él, S3 contesta **403** (no 404) a un `summary.json` que no existe, que es
  el caso de todo slide nuevo, y el worker fallaría con cada uno hasta la DLQ (lo hace a propósito, con
  un error que nombra el permiso: tratar el 403 como "no procesado" escondería el problema). Otórgalo
  sin condición `s3:prefix`, o prueba que con ella una key inexistente siga dando 404.

```bash
kubectl create namespace c04
kubectl apply -f k8s/seg-worker.yaml
# Las reglas como PrometheusRule (el Operator no lee archivos de reglas):
{ printf 'apiVersion: monitoring.coreos.com/v1\nkind: PrometheusRule\nmetadata:\n  name: c04\n  namespace: c04\n  labels:\n    release: kube-prometheus-stack\nspec:\n'; sed 's/^/  /' monitoring/alerts.yml; } | kubectl apply -f -
```

### Versiones del modelo y backfills de un candidato

- **Qué versión ve el patólogo** lo decide results-api por lab, no el orden en que terminan los workers:
  la versión aprobada más nueva para ese lab que tenga resultado para ese sha256. Un caso ya firmado
  conserva la versión con que se firmó.
- **Backfills de un modelo candidato** (silent mode sobre semanas de láminas) no pasan por `slide-jobs`
  ni por este Deployment: van en un Deployment aparte, fijado a la `MODEL_VERSION` candidata, que
  consume una cola `slide-jobs-backfill` de noche con su propio ScaledObject. Así un backfill nunca le
  quita GPU al turnaround del día ni mezcla versiones en el camino de producción. No está en este
  manifest: es una copia con otra imagen, otra cola y otro `maxReplicaCount`.

El engine se construye con `trtexec --fp16` **en una L4** y **dentro de la misma imagen base**
(`nvcr.io/nvidia/tensorrt:26.08-py3`, TensorRT 11.2.1.2), se deja en `worker/model/model.plan` y se
hornea con `docker build`. Tag de la imagen = `MODEL_VERSION`; su digest va en `CONTAINER_DIGEST`.

## Qué se verificó y qué no

Probado en macOS (Apple Silicon), sin GPU, sin cuenta de AWS y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests del worker | pytest 9.1.1 en venvs limpios con `requirements-dev.txt`, Python **3.12.14** (el de la imagen) y 3.13.15 | 65 passed en ambos |
| `SqsQueue` y `S3Storage` reales (boto3 1.43.105) | contra moto 5.2.3 (emulador en memoria), dentro de los tests | receive con `ApproximateReceiveCount`, borrado tras el resultado, redrive a la DLQ al 4.º receive, descarga y escritura en S3 (moto también aplica `If-None-Match` / `If-Match` con 412) |
| Puntero monótono de `summary.json` | dobles con semántica de ETag: el mensaje viejo que termina después del reescaneo, el que llega tarde, un 412 entre la lectura y la escritura | el puntero nunca vuelve al escaneo viejo |
| `OpenSlideReader` real (OpenSlide 4.0.1 vía openslide-bin 4.0.1.2) | SVS sintético con estructura Aperio (3 niveles 1/4/16) escrito con tifffile | mpp 0.25 leído del archivo; sin `MPP =` → `(None, None)` → `missing_mpp`; fuera del escaneo = blanco |
| Resultado de punta a punta | loop real + moto + OpenSlide + modelo falso (umbral de color) | tumor ≈ 0.0655 mm² y 12.5 % del tejido, como el SVS sintético |
| Selección para etiquetar | pytest, Python 3.12 y 3.13 | 13 passed |
| Job de PSI | pytest, Python 3.12 y 3.13 (el push, con un handler que captura el request) | 6 passed |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado) | 18 reglas OK; los tests pasan, y fallan si se cambian los umbrales (probado) |
| Contrato de métricas | un test lee `alerts.yml` y exige que cada `seg_*` exista en el registry del worker | OK |
| Manifests K8s | `kubernetes-validate --strict` contra 1.34 y 1.36 (ServiceAccount, ConfigMap, Deployment) + ScaledObject, TriggerAuthentication y PodMonitor contra el `openAPIV3Schema` de los CRDs de KEDA 2.21.0 y prometheus-operator v0.94.1 (campos desconocidos = error) + nombres de parámetros del scaler en `aws_sqs_queue_scaler.go` (v2.21.0) | OK |
| Wheels para la imagen | `pip download --only-binary=:all:` para cp312 manylinux x86_64 | los 14 paquetes tienen wheel |
| Imagen base | configuración de `tensorrt:26.08-py3` leída del registry de NGC, y su `nvidia_entrypoint.sh` | Ubuntu 24.04, Python 3.12, CUDA 13.4.1, TensorRT 11.2.1.2, ≈ 6.8 GB comprimida; el entrypoint hace `exec "$@"` |
| `Dockerfile` | parseado con `dockerfile-parse` | OK (no se construyó) |

**No verificado** (requiere GPU, AWS real, cluster o datos reales):

- No se construyó la imagen ni se corrió en una L4. **El `Model` de TensorRT no está implementado**
  (`load_model` lanza `NotImplementedError` y documenta los pasos): sin GPU no se puede probar, y código
  de GPU sin probar no se publica como referencia. Tampoco se midieron los 300 tiles/s por L4 ni los
  ≈ 20 ms de CPU por tile: son las estimaciones del caso.
- moto emula SQS y S3; no es AWS. Los tiempos de descarga (5–10 s por GB) y el comportamiento de
  visibilidad bajo carga real no se midieron. moto tampoco aplica IAM: el 403 por falta de
  `s3:ListBucket` se probó con un cliente falso que lo devuelve, no contra AWS.
- **DICOM WSI (lab C) no se probó**: OpenSlide lo lee desde la 4.0.0 (y la 4.0.1 corrigió mpp X/Y
  invertidos en DICOM), pero no había un DICOM de prueba. Además, un DICOM WSI puede ser varios archivos
  (uno por nivel) en un directorio: el mensaje de este worker trae UN archivo y UN sha256; para lab C
  habría que mandar la serie completa con un hash por archivo.
- Los CRDs se validaron contra su esquema, no contra un API server; nada se aplicó a un cluster. La
  configuración del exportador de CloudWatch está en comentarios de `alerts.yml`, no se ejecutó, y el
  nombre de las métricas `aws_sqs_*` depende del exportador.
- La máscara de tejido (Otsu sobre saturación) es un baseline: no se midió contra máscaras hechas a
  mano. Los umbrales (`blur_lapvar_min`, `min_tissue_mm2`, la baseline de major-edit rate) son
  ilustrativos y se calibran con datos reales.
- El reescalado de `tiling.resize_to` (promedio de bloques) difiere de `cv2.resize(INTER_AREA)` en el
  redondeo de los .5 (≈ 12.5 % de los pixeles, 1 nivel de gris) y es ≈ 300× más lento (≈ 30 ms contra
  ≈ 0.1 ms por tile, medido): el que va a producción es el de training, con un test de paridad.

No incluidos a propósito (se describen en el caso): results-api y su índice en Postgres (con los
gauge de corte nocturno), el Deployment de backfills de candidatos, el job de
inferencia que produce los candidatos de active learning, la herramienta de anotación, la quita de la
etiqueta y la imagen macro del WSI para las copias de training, y el Terraform de la cola y los buckets.
