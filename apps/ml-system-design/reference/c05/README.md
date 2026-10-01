# Caso c05 — archivos de referencia (captura de documentos para créditos PyME)

Archivos **reales** del caso c05 de *Ronda de Diseño ML*: la API que recibe los documentos y decide en
≤ 3 s si la foto sirve (`docs-api`), la lógica del pipeline que valida y enruta cada campo (CURP, RFC,
CLABE, CFDI, umbrales calibrados, SLA de revisión), la máquina de estados de Step Functions que no pierde
ningún documento, y las 8 alertas con sus tests. Cada archivo explica **por qué** en sus comentarios.

Nada de aquí es asesoría legal ni fiscal. Los RFC y CURP de los tests son inventados (con dígito
verificador válido), de ejemplos públicos de bibliotecas o el RFC de pruebas que el SAT publica para
desarrollo; el CFDI es sintético.

## Estructura

```
c05/
├── api/                              # docs-api (FastAPI, CPU): lo único que ve el cliente
│   ├── main.py                       # límites, magic bytes, dedupe, quality gate, S3 + StartExecution, métricas
│   ├── Dockerfile                    # python:3.12-slim, no root; copia quality.py y cfdi.py de pipeline/
│   ├── requirements.txt              # lock completo (27 paquetes con transitivas)
│   ├── requirements-dev.txt          # + pytest, httpx2, moto (S3, KMS, Step Functions en memoria), PyYAML
│   ├── pytest.ini
│   └── tests/                        # 35 tests: test_api.py (TestClient + fakes), test_adapters.py (boto3 + moto)
├── pipeline/                         # lógica PURA de las etapas (la usan los pods doc-worker)
│   ├── validators.py                 # CURP, RFC, CLABE (dígitos verificadores), montos, CFDI, fechas, nombres
│   ├── cfdi.py                       # XML CFDI 4.0 → campos + UUID (defusedxml), QR del PDF
│   ├── quality.py                    # numpy: varianza del Laplaciano, reflejo, DPI, documento cortado
│   ├── routing.py + routing.yaml     # umbral por campo → STP o tarea de revisión con SOLO los campos marcados
│   ├── calibrate_thresholds.py       # umbral por campo con cota de Wilson (CSV etiquetado → YAML)
│   ├── requirements.txt              # numpy, PyYAML, defusedxml, tzdata
│   ├── requirements-dev.txt          # + pytest, python-stdnum (implementación independiente de CURP/RFC)
│   ├── pytest.ini
│   └── tests/                        # 120 tests + fixtures/cfdi40_sintetico.xml
├── orchestration/
│   ├── statemachine.asl.json         # Step Functions Standard: Retry/Catch, waitForTaskToken, captura manual
│   ├── pytest.ini
│   └── tests/test_statemachine.py    # 40 tests de contrato: caminos, rutas $.x por camino, transiciones
└── monitoring/
    ├── alerts.yml                    # 8 alertas (+ 6 recording rules)
    ├── alerts_test.yml               # promtool: ventanas cortas (evaluación cada 1 min)
    └── alerts_test_long.yml          # promtool: ventanas de 7 y 28 días (evaluación cada 10 min)
```

## Orden de lectura sugerido

1. `pipeline/routing.py` — la promesa del sistema: STP ⇔ todos los campos requeridos superan su umbral
   **y** todas las validaciones pasan; si no, el revisor ve solo lo dudoso.
2. `pipeline/validators.py` — por qué una regla que falla marca y no rechaza, y qué errores NO ve un
   dígito verificador (la posición 9 de la CURP).
3. `pipeline/calibrate_thresholds.py` — de dónde salen los umbrales, y por qué certificar 99.9 % pide
   ≈ 3,838 aciertos seguidos.
4. `orchestration/statemachine.asl.json` — qué pasa con el documento en cada falla.
5. `api/main.py` — el gate de 3 s, el dedupe y "guardar primero, arrancar después".
6. `monitoring/alerts.yml` — qué ve cada alerta y qué NO ve (la auditoría no es rápida).
7. `pipeline/cfdi.py` y `pipeline/quality.py` — la extracción sin modelo y la definición de "foto legible".

## Un documento de punta a punta

**INE fotografiada (frente y reverso):**

```
t = 0       POST /v1/documents  application_id, doc_type=ine, files=[frente.jpg, reverso.jpg]
≈ 0.1 s     magic bytes (JPEG) → sha256 por página → ¿(application_id, sha256) ya existe? → 200 mismo id
            (≈ 50 ms por foto sintética de 12 MP en una laptop Apple M4, con el JPEG decodificado en modo draft;
            en el pod y con fotos reales, mídelo con docs_upload_seconds: el SLO es p95 ≤ 3 s)
            quality gate por foto: Laplaciano a 1024 px, reflejo (≤ 2 %), DPI efectivos (≥ 200), bordes
            ¿falla? → 422 {"reasons": [{"code": "borrosa", "page": 1, "message": "La foto salió borrosa…"}]}
            S3 raw/<id>/01-<sha>.jpg (SSE-KMS) → Postgres "received" → StartExecution(name=<id>) → 202
Step Functions (≈ 10 transiciones):
  Init → Classify (doc-worker: ine, text_source=ocr) → AcquireText → RunOcr (DetectDocumentText por página,
  JSON a S3) → Extract (ONNX Runtime en CPU: campos + confianza calibrada + página + bbox)
  → Validate (CURP: formato + dígito; CURP ↔ fecha de nacimiento; vigencia; nombre ≈ el de la solicitud)
  → Route → IsStp:
       stp    → Commit (Postgres con procedencia por campo + core) → Done          objetivo p95 ≤ 2 min
       review → HumanReview (doc-review + task token; review-api ordena por sort_at; heartbeat cada hora)
                → el revisor corrige 1–2 recortes (≈ 45 s, est.) → SendTaskSuccess → Commit → Done
                                                                         objetivo p90 ≤ 4 horas hábiles
```

**Factura con XML:** el gate parsea el CFDI (≈ ms); en el pipeline, `Classify` devuelve `text_source=xml`
y el camino es `ReadCfdiXml → Validate` (RFC emisor/receptor, cuadratura de montos, estatus en el SAT):
**sin OCR y sin Extract**. Es el camino más barato y más exacto del sistema.

### Qué pasa con el documento en cada falla

| Falla | Qué hace el sistema | Dónde termina |
|---|---|---|
| Foto ilegible | 422 inmediato con motivos; no se guarda nada | el cliente la vuelve a tomar |
| Mismo archivo dos veces (doble clic, reintento del móvil) | 200 con el mismo `document_id` | una sola ejecución |
| S3 falla al guardar | 503 + `Retry-After: 5`; el registro queda en `upload_failed` | el reintento reutiliza el id |
| `StartExecution` falla | 202 igual (ya está en S3 y en la base); `resume_unstarted` lo arranca | pipeline normal |
| Error transitorio de una etapa | Retry con backoff y jitter (2, 4, 8, 16 s; máx. 60 s) | sigue |
| Throttling del OCR | `Ocr.Throttled`: hasta 6 reintentos con jitter | sigue |
| Documento ilegible o input inválido | `Doc.Unreadable` / `Doc.InvalidInput`: **sin** reintentos | captura manual |
| Pod que muere a mitad de una etapa | SQS reentrega el mensaje (mismo token) a otro pod | sigue |
| Ningún pod toma la tarea en 1 h | `States.Timeout` → 1 reintento (token NUEVO) → Catch | captura manual |
| SAT caído | 3 reintentos (30, 60, 120 s) → `SatUnverified` → revisión con "SAT no verificado" | revisión |
| review-api pierde la tarea | sin heartbeat 2 h → Catch | captura manual |
| Nadie revisa en 5 días | `States.Timeout` → Catch | captura manual |
| Estado > 256 KiB | `States.DataLimitExceeded` (States.ALL **no** lo atrapa: está explícito) | captura manual |
| El core no acepta el commit | 6 reintentos hasta 5 min entre intentos → Catch, con lo revisado adentro | captura manual |

"Captura manual" = la cola `doc-manual-capture` recibe el estado completo (llaves de S3, lo extraído, lo
revisado, el error) y la ejecución termina en `Fail` (`Doc.ManualCapture`), visible en `ExecutionsFailed`.

## Contrato de los workers (`doc-worker`, no incluido)

Cada etapa automática es un `sqs:sendMessage.waitForTaskToken` a la cola **`doc-tasks`**:

```json
{"stage": "classify|read_xml|read_text_layer|ocr|extract|validate|route|commit",
 "task_token": "…", "execution": "arn:…", "attempt": 0, "document_id": "…", "…": "campos de la etapa"}
```

- El pod hace la etapa y responde `SendTaskSuccess(taskToken, output)`; el output va a `$.classify`,
  `$.text`, `$.extract`, `$.validation`, `$.route` o `$.commit`. Contratos que la máquina lee: classify →
  `{doc_type, text_source}`; read_xml y extract → `{fields: {nombre: {value, confidence, source, page,
  bbox}}}` (mismo esquema, `cfdi.to_fields`); validate → `{results: [...]}`; route → `RouteDecision.as_dict()`
  (`decision` = `stp` | `review`).
- Errores: `SendTaskFailure(error=…)` con `Doc.Unreadable`, `Doc.InvalidInput` (permanentes),
  `Ocr.Throttled`, `Sat.Unavailable` o cualquier otro (transitorio).
- Texto y OCR completos van a S3; por el estado solo viajan llaves (límite de 256 KiB por estado).
- Borra el mensaje de SQS **después** de `SendTaskSuccess/Failure`. Si esa llamada responde que el token
  ya no es válido (la tarea venció y Step Functions mandó otra con un token nuevo), borra el mensaje y no
  hagas nada más: el trabajo lo hará el mensaje nuevo.
- Idempotencia por `(document_id, stage)`: SQS entrega "at least once" y el `commit` al core no puede
  duplicar un registro.

## Métricas

| Métrica | Labels | Quién | La usa |
|---|---|---|---|
| `docs_uploads_total` | doc_type, outcome (`accepted` · `duplicate` · `rejected_quality` · `rejected_invalid` · `too_large` · `unsupported_type` · `error`) | docs-api | QualityGateRejectSpike |
| `docs_quality_rejections_total` | doc_type, reason (`borrosa` · `reflejo` · `baja_resolucion` · `cortado`) | docs-api | dashboards, runbook |
| `docs_upload_seconds` (histograma, bucket en 3 s) | doc_type | docs-api | SLO del gate (p95 ≤ 3 s) |
| `docs_oldest_unfinished_age_seconds` | phase (`automatic` · `review`) | docs-api (lee Postgres en cada scrape) | DocPipelineBacklog |
| `docs_execution_start_failures_total` | — | docs-api | runbook de DocPipelineBacklog |
| `docs_stage_attempts_total` | stage, outcome (`ok` · `error`) | doc-worker | StageErrorRateHigh |
| `docs_routing_decisions_total` | doc_type, decision (`stp` · `review`) | doc-worker | STPRateDrop |
| `docs_ocr_word_confidence` (histograma, bucket en 0.9) | doc_type, source (`photo` · `scan` · `digital`) | doc-worker | OCRConfidenceShift |
| `docs_sat_requests_total` | outcome (`ok` · `error` · `timeout`) | doc-worker | SATValidationDown |
| `docs_review_open_tasks` (gauge) | sla (`on_time` · `at_risk` · `overdue`) | review-api | ReviewSLABreach |
| `docs_audit_fields_total` | doc_type, field_class (`standard` · `critical`), result (`correct` · `wrong`) | herramienta de QA | AuditFieldAccuracyLow |

Las series de docs-api se crean en 0 al arrancar (un counter que nace en 1 es invisible para `increase()`).

### Las 8 alertas

| Grupo | Alerta | Umbral (ilustrativo) | Severidad |
|---|---|---|---|
| Sistema | `DocPipelineBacklog` | documento automático más viejo > 15 min, 5 min | page en horario |
| Sistema | `StageErrorRateHigh` | > 5 % de intentos con error en 10 min (≥ 20 intentos), 10 min | page en horario |
| Sistema | `ReviewSLABreach` | > 10 % de tareas abiertas vencidas (≥ 5), 15 min | page en horario |
| Sistema | `SATValidationDown` | > 50 % de consultas fallidas en 10 min (≥ 10), 10 min | ticket |
| Datos | `QualityGateRejectSpike` | rechazos 1 h > 2× los de 7 d y > 15 % (≥ 30 uploads), 15 min | page en horario |
| Datos | `OCRConfidenceShift` | palabras ≤ 0.90 en 6 h > 1.5× las de 7 d (≥ 5,000), 1 h | ticket |
| Modelo | `STPRateDrop` | STP 6 h < 0.8 × STP 7 d (≥ 100 decisiones), 30 min | ticket |
| Modelo | `AuditFieldAccuracyLow` | estándar 7 d < 99.2 % (≥ 1,500); críticos 28 d < 99.8 % (≥ 2,000), 1 h | ticket |

## Cómo correrlo (sin AWS, sin modelos, sin red)

```bash
cd reference/c05/pipeline
python3 -m venv .venv && . .venv/bin/activate        # Python 3.12 o 3.13
pip install -r requirements-dev.txt && pytest          # 120 tests, ≈ 1–5 s
cd ../orchestration && pytest                          # 40 tests (solo pytest; usa el mismo venv)
deactivate

cd ../api
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt && pytest          # 35 tests, ≈ 3–8 s (incluye boto3 contra moto)

cd ../monitoring                                        # promtool viene en el release de Prometheus
promtool check rules alerts.yml
promtool test rules alerts_test.yml                     # < 1 s
promtool test rules alerts_test_long.yml                # ≈ 30–90 s: simula hasta 29 días de series

npx asl-validator@4.0.0 --json-path ../orchestration/statemachine.asl.json
```

Umbrales a partir de tus etiquetas:

```bash
python pipeline/calibrate_thresholds.py etiquetas.csv --config pipeline/routing.yaml -o umbrales.yaml
# CSV: doc_id,doc_type,field,confidence,correct[,label_source]   (gold y audit; review se ignora)
```

docs-api en local (adaptadores reales, repo en memoria; necesita credenciales y región de AWS):

```bash
cd reference/c05 && mkdir -p /tmp/docs-api && cp api/main.py pipeline/quality.py pipeline/cfdi.py /tmp/docs-api/
cd /tmp/docs-api && DOCS_BUCKET=… STATE_MACHINE_ARN=… uvicorn main:build_default_app --factory --port 8080
# Imagen: docker build -f api/Dockerfile -t docs-api:dev .   (desde reference/c05)
```

## Desplegar en AWS (resumen)

Colas (IaC): `doc-tasks` (visibilidad 300 s, que el worker extiende si una etapa tarda más; redrive a
`doc-tasks-dlq` con maxReceiveCount 5), `doc-review` (la consume review-api y guarda las tareas en
Postgres) y `doc-manual-capture`. Las URLs del ASL son de ejemplo (cuenta `123456789012`): el IaC las
sustituye.

Permisos de mínimo privilegio:

- **Rol de la máquina de estados**: `sqs:SendMessage` en las tres colas (y `kms:GenerateDataKey` +
  `kms:Decrypt` si las colas usan una llave KMS propia).
- **docs-api** (IRSA): `s3:PutObject` en el bucket raw, `kms:GenerateDataKey` en su llave (SSE-KMS lo pide
  para escribir), `states:StartExecution` en la máquina. Sin `s3:GetObject`: la API no lee documentos.
- **doc-worker**: `sqs:ReceiveMessage`/`DeleteMessage`/`ChangeMessageVisibility` en `doc-tasks`,
  `states:SendTaskSuccess`/`SendTaskFailure`/`SendTaskHeartbeat`, `s3:GetObject` (raw) y `s3:PutObject`
  (prefijo de texto/OCR), `kms:Decrypt` y `kms:GenerateDataKey`, `textract:DetectDocumentText`.

Privacidad (principios generales; legal decide los detalles): INE, CURP, domicilios y datos bancarios son
datos personales (en México, la LFPDPPP publicada el 20 de marzo de 2025). Cifrado en reposo con KMS,
mínimo privilegio, logs sin PII (nunca el nombre original del archivo: la gente sube
`INE_Juana_Perez.jpg`), la API de estatus responde 404 a quien no es dueño del documento, las fotos
rechazadas no se guardan, retención según la política del otorgante. El OCR administrado corre en la
misma cuenta y región; AWS documenta que puede usar el contenido de Textract para mejorar el servicio
salvo que la organización lo desactive con una política de opt-out de AWS Organizations: actívala.

## Qué se ejecutó y qué no

Probado en macOS (Apple M4), sin cuenta de AWS, sin daemon de Docker y sin modelos:

| Qué | Cómo | Resultado |
|---|---|---|
| Lógica del pipeline | pytest 9.1.1 en venvs limpios con `requirements-dev.txt`, Python **3.12.14** y **3.13.15** | 120 passed en ambos |
| CURP y RFC contra una implementación independiente | python-stdnum 2.2 en 2,000 cadenas al azar cada uno + ejemplos conocidos (BOXW310820HNERXN09, el RFC de pruebas del SAT EKU9003173C9, la CLABE de ejemplo de Wikipedia 032180000118359719) | coinciden |
| CFDI 4.0 | XML sintético (namespaces `cfd/4` y `TimbreFiscalDigital`), XXE y billion laughs rechazados por defusedxml, sin timbre, 3.3, impuestos locales, QR | OK |
| Quality gate | imágenes sintéticas: nítida, borrosa (desenfoque de caja), con mancha saturada, de baja resolución, cortada; la misma escena a dos resoluciones | OK; ≈ 50 ms por JPEG de 12 MP y ≈ 140 ms por PNG de 12 MP (mediana, laptop) |
| docs-api | TestClient + fakes: 202, dedupe (incluida una carrera de 4 requests), 422 con motivos, PDF con contraseña, HEIC, límites, S3 caído, StartExecution caído + barrido, 404 entre clientes, logs sin PII, métricas | 35 passed (3.12 y 3.13) |
| Adaptadores de boto3 | `S3Store` contra moto 5.2.3 (SSE-KMS con llave de moto KMS) y `StepFunctionsStarter` contra moto Step Functions (mismo name + input → misma ejecución; otro input → ExecutionAlreadyExists, que el adaptador no relanza) | OK |
| Wheels de la imagen | `pip download --only-binary=:all:` para cp312 manylinux x86_64 | los 27 paquetes tienen wheel |
| `uvicorn main:build_default_app --factory` | arrancado en local con los archivos copiados como en la imagen | `/healthz`, `/readyz`, `/metrics` y un 415 responden |
| Dockerfile | parseado con dockerfile-parse | OK (no se construyó: no hay daemon) |
| Máquina de estados | JSON válido; asl-validator 4.0.0 (npm) → "valid" (y detecta un destino inexistente en un control negativo); 40 tests de contrato | OK; el test de rutas por camino detecta un `$.review` inexistente (probado quitándolo) |
| Contratos cruzados | el input que arma docs-api = el contrato de `Init`; los valores de `routing.decide` = las ramas de `IsStp`; cada `docs_*` de las alertas existe en docs-api o está listada como externa | OK |
| Alertas | promtool de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt`): `check rules` (15 reglas), `test rules` en los dos archivos | SUCCESS (el largo, 3 veces seguidas); los tests fallan si se cambian los umbrales (probado con 10 mutaciones) |

**No verificado** (requiere AWS real, modelos, datos reales o un cluster):

- **Nada corrió en AWS.** moto no es AWS: no aplica IAM ni ejecuta los estados de la máquina; no se
  probó Textract, ni el servicio de estatus del SAT, ni KMS real. Los permisos de la sección anterior son
  el diseño, no algo probado.
- **La máquina de estados no se ejecutó.** asl-validator revisa la sintaxis; los tests revisan caminos y
  rutas. El comportamiento de `HeartbeatSeconds` (la documentación de AWS nombra su vencimiento como
  `States.HeartbeatTimeout` y, en otro lugar, `States.Timeout`; por eso se atrapan los dos) no se observó.
- **No hay modelos**: el clasificador, el extractor (layout-aware en ONNX Runtime), el `doc-worker`,
  review-api, el repo de Postgres y la herramienta de QA no están incluidos. `build_default_app` usa un
  repo en memoria.
- **Los umbrales son ilustrativos**: los del gate (Laplaciano 100/60, reflejo 2 %, 200/150 DPI, bordes
  0.5), los de `routing.yaml` y los de las alertas. Las imágenes de los tests son sintéticas: el detector
  de "cortado" es un baseline heurístico (una mesa texturizada da falsos positivos). Todo se calibra con el
  gold set y con fotos reales.
- **El algoritmo de la CURP** no se encontró en un documento oficial de RENAPO en texto citable: se
  verificó contra python-stdnum y ejemplos conocidos. El del RFC es el que el SAT entregó por solicitud de
  transparencia (citado por python-stdnum); python-stdnum lo desactiva por defecto porque reporta RFC en
  uso con dígito inválido: aquí un dígito que no coincide marca para revisión, nunca rechaza.
- **Las probabilidades de AuditFieldAccuracyLow** (≈ 2 % y ≈ 5 % de falsas alarmas; 82 % y ≈ 50 % de
  detección al duplicarse el error) son cálculos de Poisson con los volúmenes estimados del caso, no
  mediciones.

No incluidos a propósito (se describen en el caso): `doc-worker` y sus modelos, review-api y su UI, el
repo de Postgres, el cliente SOAP del SAT, el job de entrenamiento y de alineación de etiquetas débiles,
los manifests de Kubernetes y el IaC de colas, buckets y llaves.
