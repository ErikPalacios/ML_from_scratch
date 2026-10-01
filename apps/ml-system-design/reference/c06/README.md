# Caso c06 — archivos de referencia (moderación de contenido en una red social)

Archivos **reales** del caso c06 de *Ronda de Diseño ML*: el `mod-gateway` que revisa cada post y
comentario antes de publicarse (hashes locales + modelos rápidos con un presupuesto de 120 ms y
fail-open), el `decision-engine` con su config versionada de umbrales, el índice de hashes PDQ, la
prioridad de la cola de revisión humana, las métricas de calidad con intervalos de confianza y las 8
alertas con sus tests. Cada archivo está comentado explicando **por qué**.

Nada de aquí es asesoría legal. Las obligaciones (reporte de CSAM, DSA de la UE) se mencionan como
principios generales y las define legal.

## Estructura

```
c06/
├── decision/
│   ├── policies.yaml        # config VERSIONADA: 7 políticas × severidad × superficie → umbrales y acciones
│   ├── engine.py            # combina la cascada, aplica umbrales, fail-open, statement of reasons
│   ├── requirements.txt     # PyYAML (el motor es puro)
│   └── tests/test_engine.py # 50 tests
├── hashing/
│   ├── match.py             # PDQ 256 bits: Hamming con numpy, índice multi-slot (MIH); texto; dominios
│   └── tests/test_match.py  # 28 tests (hashes sintéticos + bits volteados)
├── review/
│   ├── priority.py          # prioridad por daño esperado, SLA aging, bienestar, routing según capacidad
│   └── tests/test_priority.py  # 12 tests
├── eval/
│   ├── prevalence.py        # prevalencia por vistas (simple y estratificada), precision/recall con IC, kappa
│   └── tests/test_prevalence.py  # 15 tests
├── gateway/
│   ├── main.py              # FastAPI POST /v1/moderate: presupuesto, etapas en paralelo, fail-open, Kafka
│   ├── demo_hashes.jsonl    # snapshot SINTÉTICO para la demo local (hashes aleatorios, no son imágenes reales)
│   ├── requirements.txt     # lock completo de la imagen (19 paquetes)
│   ├── Dockerfile           # python:3.13.15-slim-trixie, no root, 1 proceso uvicorn
│   └── tests/test_gateway.py   # 21 tests (fakes de Triton y Kafka)
├── monitoring/
│   ├── alerts.yml           # 8 alertas + recording rules
│   └── alerts_test.yml      # tests de promtool
├── pytest.ini               # `pytest` desde aquí corre las 5 carpetas
└── requirements-dev.txt     # gateway/requirements.txt + pytest + httpx2
```

## Orden de lectura sugerido

1. `decision/policies.yaml` — la tabla que de verdad decide: por qué S0 no tiene fail-open (y por qué
   eso no es una opción de la config), qué cubre cada modelo de la etapa 1 (`stage_policies`), por qué
   `own_removed` es más estricta que las listas de la industria, qué es `review_confirms`.
2. `decision/engine.py` — las 7 reglas del docstring y `decide()`. Sobre todo: "gana la acción más
   fuerte" y "la etapa 2 reemplaza a la etapa 1".
3. `gateway/main.py` — `_moderate()`: hash local → modelos en paralelo con lo que queda del
   presupuesto → decisión → evento. Y `_emergency_decision()`: un bug del motor no tumba los posts,
   pero un hash S0 se sigue bloqueando.
4. `hashing/match.py` — el pigeonhole que hace rápida la búsqueda (umbral 31 → radio 1 por slot) y la
   compactación en tres pasos, con el paso caro fuera del event loop.
5. `review/priority.py` — el ejemplo numérico del docstring y `plan_review_thresholds`.
6. `eval/prevalence.py` — por qué vistas y no ítems; por qué el recall sale de la muestra aleatoria.
7. `monitoring/alerts.yml` — qué ve cada alerta y qué NO ve.

## Un post de punta a punta

```
t = 0       la persona sube la foto → media-service la guarda, calcula su PDQ (y su calidad) y lo
            consulta contra el mismo índice (match.py) en su proceso: un S0 conocido no llega a guardarse
            … escribe el texto y toca Publicar → post-service llama a POST /v1/moderate
            {"item_id", "surface": "post", "text", "images": [{"media_id", "pdq", "pdq_quality"}], "urls", "region"}
+ ≈ 1–2 ms  etapa 0 LOCAL: PDQ contra el índice (distancia ≤ 31; ≤ 16 para own_removed), texto
            normalizado, dominios. ¿Hash S0? → block_prepublish + escalation al equipo especializado
+ ≤ 115 ms  etapa 1 EN PARALELO: texto e imagen en Triton, con timeout = lo que queda del presupuesto
            de 120 ms menos 5 ms de reserva. Si vence: fail-open (se publica con lo que haya)
+ < 1 ms    decision-engine: umbrales de policies.yaml (versión 2026-10-01.1) → acción, revisión, etapa 2
            → respuesta a post-service: publicar / no publicar / publicar con reduce o interstitial
            → evento a Kafka mod-events (en segundo plano, key = item_id, sin texto ni imagen)
≤ 5 min     (p95) deep-scorer consume mod-events; solo ≈ 3 % de los ítems pasa su disparador y va al
            modelo multimodal grande; el mismo engine.py decide con path="async"
            → si cae en la banda de revisión: review-router lo prioriza (priority.py)
            → la persona decide → etiqueta (con la versión de la política) → enforcement / apelaciones
```

### Qué devuelve `/v1/moderate`

`decision_id` (determinista: ítem + camino + config + modelos; enforcement deduplica por él),
`action` (`block_prepublish` · `remove` · `age_gate` · `interstitial` · `reduce` · `review` · `none`),
`policy`, `severity`, `source` (`hash` · `model` · `fallback_rule` · `none`), `scores`,
`config_version`, `policy_definitions_version`, `model_versions`, `needs_review`, `review_policies`,
`fail_open`, `fail_open_reasons` (p. ej. `stage1_text:timeout`), `send_to_deep_scorer`,
`deep_scoring_priority`, `escalation` (sale de la severidad: cualquier hash S0, de la lista que sea),
`hash_match` (la coincidencia que decidió) y `hash_matches` (todas las válidas), `territorial_scope`
(`global` o la región cuyo override cambió la acción) y `legal_ground`, `shadow_actions`,
`suppressed_by_exception`, `statement_of_reasons` (texto que sigue los elementos principales del art. 17
de la DSA: restricción y alcance, hechos, medios automatizados, base contractual o legal, vías de
reclamo), `latency_ms`.

### Las 7 políticas de `policies.yaml`

| Política | Severidad | Qué cubre | Notas |
|---|---|---|---|
| `csam` | S0 | explotación sexual infantil | solo hashes (`hash_only`), equipo especializado |
| `violent_extremism` | S0 | extremismo violento y terrorismo | hashes de la industria + modelo con banda de revisión ancha |
| `violence` | S1 | amenazas creíbles y violencia gráfica | interstitial confirmado por revisión; reglas de respaldo en fail-open |
| `self_harm` | S1 | promoción de autolesiones | interstitial = pantalla con recursos de ayuda |
| `hate_harassment` | S2 | discurso de odio y acoso | `reduce` confirmado por revisión; override regional de ejemplo |
| `adult_nudity` | S2 | desnudos de adultos | solo posts (los comentarios son texto) |
| `spam_scams` | S3 | spam y estafas | casi todo automático, poca revisión |

Además: listas de hashes `industry_csam`, `industry_terror`, `own_removed` y `benign_exceptions`
(excepciones por clúster benigno, que anulan al modelo pero nunca a otro hash), `stage_policies` (qué
políticas cubre cada modelo de la etapa 1: define qué quedó sin evaluar en un fail-open), `mode: shadow`
por política para medir antes de activar, y `regions` para overrides (con su `legal_ground`).

### Métricas del gateway (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `mod_gateway_requests_total` | surface, status | ModFailOpenRateHigh (denominador; los `status="500"` también al numerador) |
| `mod_gateway_request_duration_seconds` (histograma, bucket en 0.15) | surface | ModGatewayLatencyHigh |
| `mod_stage_duration_seconds` | stage (`hash`, `stage1_text`, `stage1_image`, `engine`) | runbook de latencia |
| `mod_fail_open_requests_total` | surface | ModFailOpenRateHigh (numerador) |
| `mod_fail_open_total` | reason (`stage1_text_timeout`, `stage1_image_error`, `…_budget_exhausted`) | runbook de fail-open |
| `mod_decisions_total` | policy, action, surface | dashboards |
| `mod_stage1_score` (histograma, bucket en 0.5) | policy | PolicyScoreShift |
| `mod_hash_list_watermark_timestamp_seconds` | list | HashListStale |
| `mod_hash_matches_total`, `mod_hash_unverifiable_total`, `mod_hash_index_entries` | list / — / kind | dashboards |
| `mod_events_buffered`, `mod_events_dropped_total`, `mod_events_publish_failures_total` | — | diagnóstico de Kafka |
| `mod_engine_errors_total` | — | diagnóstico |

Métricas de otros servicios que usan las alertas (no están en esta carpeta): `kafka_consumergroup_lag`
y `kafka_topic_partition_current_offset` (kafka_exporter), `review_queue_oldest_age_seconds{tier,source}`
y `review_queue_depth` (review-router, calculadas con `priority.queue_stats`),
`appeals_decided_total{policy,outcome}` (appeals-service), `enforcement_actions_total{policy,detection}`
(enforcement-service), `moderation_unchecked_publish_total{service,reason}` y
`publish_requests_total{service}` (post-service y comment-service: lo que publicaron sin respuesta del
gateway), y `up{job="mod-gateway"}` (Prometheus; supone ese nombre de job). El label de la severidad de la política se llama `tier`: `severity` es el label
de las alertas y lo pisaría.

### Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Sistema | `ModGatewayLatencyHigh` | p99 > 150 ms, 10 min | page |
| Sistema | `ModFailOpenRateHigh` | > 1 % publicado sin etapa 1: fail-open + 500 en el gateway, o lo que post/comment-service publicaron sin respuesta; o el gateway sin métricas; 10 min | page |
| Sistema | `DeepScorerBacklog` | lag ÷ ritmo de producción > 240 s, 10 min (SLO p95 ≤ 5 min) | page |
| Sistema | `ReviewQueueAging` | más viejo: reportes S1 > 45 min, S0 > 22.5 min (75 % del SLA), 5 min | page |
| Sistema | `HashListStale` | watermark en el peor pod: own_removed > 30 min, industria > 26 h; o un pod vivo sin una lista S0 (CSAM, terrorismo); 10 min | page |
| Modelo | `PolicyScoreShift` | fracción con score > 0.5 > 2× o < ½ contra la misma hora de la semana pasada, ≥ 1 ítem/s, 1 h | ticket |
| Calidad | `AppealOverturnRateHigh` | reversión en 7 d > 1.5× su nivel de 28 d (hasta hace 7 d), ≥ 100 apelaciones | ticket |
| Calidad | `ProactiveRateDrop` | proactive rate de ayer > 5 puntos bajo los 7 días anteriores, ≥ 200 acciones | ticket |

Trampa de `AppealOverturnRateHigh`: la regla de 28 días leída con `offset 7d` necesita ≥ 35 días de
retención de los counters crudos. Prometheus guarda 15 por defecto, y con menos datos `increase()`
calcula en silencio sobre lo que haya. Sube la retención o calcula esas reglas en un almacenamiento de
largo plazo (Thanos, Mimir).

## Correr los tests (sin GPU, sin Triton, sin Kafka)

```bash
cd reference/c06
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (el de la imagen) o 3.12
pip install -r requirements-dev.txt
pytest                                              # 126 tests, ≈ 5 s
python hashing/match.py --bench 1000000             # MIH contra escaneo lineal con 1 M hashes

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 1–2 min: simula hasta 33 días de series
```

## Demo local del gateway (modelos y Kafka falsos)

```bash
cd reference/c06/gateway
HASH_SNAPSHOT_PATH=demo_hashes.jsonl PYTHONPATH=../decision:../hashing:. \
  uvicorn --factory main:demo_app --port 8080
curl -s localhost:8080/readyz
curl -s -X POST localhost:8080/v1/moderate -H 'content-type: application/json' \
  -d '{"item_id":"p-1","surface":"comment","text":"Todo GRATIS hoy"}'
```

`demo_app` usa un "modelo" que marca spam si el texto dice "gratis" y escribe los eventos de Kafka en
stdout. El snapshot tiene hashes ALEATORIOS: para ver un bloqueo por hash, manda uno de esos hashes
(o el mismo con algunos caracteres hex cambiados).

## Desplegar (resumen)

La imagen se construye desde `reference/c06` (`docker build -f gateway/Dockerfile .`). Su `CMD` usa
`main:build_app`, que **lanza `NotImplementedError`** hasta conectar los adaptadores reales:
`TextScorer` e `ImageScorer` (tritonclient contra los modelos de la etapa 1), `EventPublisher` (un
productor de Kafka con `acks=all` y `enable.idempotence=true`) y `HashUpdates` (consumer del tópico de
novedades de hashes, con heartbeats por lista). Variables: `POLICIES_PATH`, `HASH_SNAPSHOT_PATH`,
`BUDGET_S` (0.12), `ENGINE_RESERVE_S` (0.005), `EVENTS_TOPIC` (`mod-events`), `EVENT_BUFFER` (20000),
`SHUTDOWN_FLUSH_S` (5), `GATEWAY_VERSION`, `HASH_COMPACT_DELTA` (5000). Puerto 8080; `/healthz` (liveness)
y `/readyz` (readiness: config cargada y cada lista S0 presente en el snapshot; Triton caído NO saca al
pod, porque hay fail-open).

## Qué se verificó y qué no

Probado en macOS (Apple Silicon), sin GPU, sin Triton, sin Kafka y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 5 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python **3.13.15** (el de la imagen) y 3.12.14 | 126 passed en ambos |
| Índice PDQ contra escaneo lineal | 200 consultas aleatorias con 0–44 bits volteados, y el peor caso del pigeonhole (31 bits repartidos) | mismos resultados; nada a > 31 |
| Rendimiento del índice | `match.py --bench` con 1 M hashes aleatorios | MIH ≈ 0.5–2 ms por consulta, lineal ≈ 35 ms, carga ≈ 3 s, compactación ≈ 2 s (en otro hilo; ≈ 5 ms en el event loop); delta de 5k filas ≈ 0.7 ms por consulta, de 20k ≈ 2 ms |
| Gateway con presupuesto y fail-open | TestClient + fakes con demoras de 80 ms a 3 s, errores y Kafka colgado | corta en el presupuesto; hash S0 bloquea aunque los modelos venzan; Kafka colgado no frena posts; un request durante una compactación lenta (0.6 s simulados) responde sin esperarla; un pod sin la lista de terrorismo no está ready |
| Contrato de métricas | un test lee `alerts.yml` y exige que cada `mod_*` exista en `/metrics` del gateway | OK |
| Demo con uvicorn real | `uvicorn --factory main:demo_app` + curl a `/readyz`, `/v1/moderate`, `/metrics` | bloqueo por hash S0 a distancia 3 con statement of reasons; eventos en stdout |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 17 reglas OK; los tests de las 8 alertas pasan, y el de cada una falla si se cambia su umbral (probado alerta por alerta); los casos de 500s, gateway desaparecido y pod sin la lista de CSAM fallan con las reglas anteriores |
| Wheels para la imagen | `pip download --only-binary=:all:` para cp313 manylinux x86_64 | los 19 paquetes tienen wheel |
| Imagen base | tags y manifest de `python:3.13.15-slim-trixie` leídos de Docker Hub | existe; ≈ 43 MB comprimida (amd64) |
| `Dockerfile` | parseado con `dockerfile-parse` | OK (no se construyó) |
| Umbral PDQ 31 y calidad ≤ 49 | README de `pdq` en facebook/ThreatExchange | coincide |
| MIH de 16 slots × 16 bits, radio floor(d/16) | `pdq/cpp/index/mih.h` en facebook/ThreatExchange | mismo esquema |

**No verificado** (requiere Triton, Kafka, un cluster o datos reales):

- No hay adaptadores reales de Triton ni de Kafka (`build_app` lanza `NotImplementedError`): sin esos
  servicios no se pueden probar, y código sin probar no se publica como referencia. Los modelos son
  fakes; las capacidades (≈ 3,000 ítems/s de texto por L4, etc.) son las estimaciones del caso.
- Se supone que las listas de la industria llegan en PDQ. Las de CSAM se distribuyen muy a menudo en
  PhotoDNA (y MD5): en ese caso media-service calcula también PhotoDNA (licencia on-prem) y hace falta
  otro índice con su propia métrica. No está en esta referencia.
- No se calculó ningún PDQ de imágenes reales: los hashes de los tests y de la demo son aleatorios. Con
  hashes reales (no uniformes) hay más candidatos por consulta: hay que medir con las listas reales.
- Los umbrales de `policies.yaml`, los pesos de severidad, los SLA de S2/S3, la vida media de las
  vistas (3 h) y el tope de contenido gráfico por turno (40) son ilustrativos.
- Las reglas de respaldo (regex) son dos ejemplos: no son una lista real ni cubren idiomas.
- El texto del statement of reasons sigue los elementos principales del art. 17 de la DSA, pero no es un
  texto aprobado por legal, ni este código decide qué obligaciones aplican a una plataforma concreta. La
  base legal regional (`legal_ground`) es un texto de ejemplo.
- La configuración de kafka_exporter no se ejecutó; los nombres `kafka_consumergroup_lag` y
  `kafka_topic_partition_current_offset` son los de su README. review-router, appeals-service y
  enforcement-service no existen aquí: sus métricas solo están en los tests de promtool.
- No se construyó la imagen ni se aplicó nada a un cluster.

No incluidos a propósito (se describen en el caso): deep-scorer, review-router como servicio, la
herramienta de revisión, appeals y enforcement, el pipeline de entrenamiento, el job de reconciliación
de eventos perdidos, el cálculo de PDQ y el chequeo S0 por hash al subir en media-service (misma
librería hashing/match.py y mismas listas; su watermark también debería alimentar HashListStale), el
agrupamiento de near-duplicates en review-router (priority.py ordena ítems individuales; una decisión
por clúster y la reversión en lote quedan en el caso), el contador del lado de post-service
(`moderation_unchecked_publish_total`) y los manifests de Kubernetes.
