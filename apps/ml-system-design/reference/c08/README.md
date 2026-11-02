# Caso c08 — archivos de referencia (home personalizado de un marketplace)

Archivos **reales** del caso c08 de *Ronda de Diseño ML*: el `home-api` que arma el feed de cada persona
(4 fuentes de candidatos en paralelo con su timeout, filtros, features, ranker, re-ranker y 3 escalones de
degradación), el re-ranker con diversidad y exploración, la co-visitación ítem-ítem, el set de
entrenamiento con la etiqueta demorada de 24 h, el tamaño de muestra del A/B, las métricas offline y las
8 alertas con sus tests. Cada archivo está comentado explicando **por qué**.

Los números (≈ 3,100 RPS de pico, p99 ≤ 200 ms, ≈ 1,000 candidatos, 50 ítems por respuesta, 5 % de
exploración, contacto en ≤ 24 h) son los del caso. Los umbrales, los pesos y los topes que no vienen del
caso son **ilustrativos**: están marcados así en cada archivo.

## Estructura

```
c08/
├── serving/
│   ├── home_api.py          # FastAPI GET /v1/home: fuentes en paralelo, filtros, features, ranker, re-rank,
│   │                        #   fallbacks, log de impresiones con el feature snapshot, métricas, demo local
│   ├── rerank.py            # freshness, topes por categoría/vendedor, vendedor nuevo, exploración 5 % (puro)
│   ├── requirements.txt     # lock completo de la imagen (17 paquetes)
│   └── tests/               # test_home_api.py (26 tests, fakes), test_rerank.py (16 tests)
├── retrieval/
│   ├── covisitation.py      # "quienes vieron esto también vieron": pares por sesión, decaimiento, coseno, top-k
│   └── tests/test_covisitation.py   # 9 tests con sesiones que se calculan a mano
├── training/
│   ├── build_training_set.py        # join point-in-time: impresiones + vistas + clicks + contactos ≤ 24 h,
│   │                                #   negativos censurados por venta, submuestreo de negativos con peso
│   └── tests/test_build_training_set.py   # 17 tests con líneas de tiempo
├── eval/
│   ├── ab_sample_size.py    # usuarios por brazo (test z), CUPED, delta method, días con usuarios distintos
│   ├── offline_metrics.py   # recall@k, NDCG@k (ganancia exponencial), AUC por rangos, promedio por slice
│   └── tests/test_eval.py   # 16 tests (contra el cálculo a mano, uno por simulación)
├── monitoring/
│   ├── alerts.yml           # 8 alertas + 12 recording rules
│   └── alerts_test.yml      # tests de promtool
├── pytest.ini               # `pytest` desde aquí corre las 4 carpetas
└── requirements-dev.txt     # serving/requirements.txt + pytest + httpx2
```

## Orden de lectura sugerido

1. `serving/home_api.py` — el docstring (embudo con el presupuesto de cada etapa y los 3 escalones de
   degradación) y `build_feed()`. Mira dónde se filtra (antes del batch de features, con la metadata
   del candidato), qué corre en paralelo (las 4 fuentes; features y vendidos) y qué se loguea.
2. `serving/rerank.py` — los 5 pasos del docstring. Sobre todo la exploración: uniforme, con
   propensity, insertada (no reemplaza) y determinista por `request_id`; y por qué la regla del vendedor
   nuevo se vuelve a fijar después de explorar.
3. `training/build_training_set.py` — las 7 reglas del docstring. La trampa central: un ejemplo de hace
   6 horas sin contacto **no es un negativo todavía**.
4. `retrieval/covisitation.py` — el ejemplo numérico del docstring (por qué el coseno y no la
   probabilidad condicional).
5. `eval/ab_sample_size.py` y `eval/offline_metrics.py` — el cálculo a mano y las reglas de agregación.
6. `monitoring/alerts.yml` — qué ve cada alerta y qué NO ve.

## Un request al home de punta a punta

```
t = 0       la app pide GET /v1/home?user_id=u42&page=1 (header x-request-id: el mismo id viaja en los
            eventos de vista y de click que la app manda después)
+ ≈ 5 ms    contexto del usuario (Redis-class): ciudad, vendedores bloqueados, vistas sin interacción en
            7 días, lo ya servido en esta sesión, últimas vistas, vendedores que sigue
+ ≤ 40 ms   4 fuentes EN PARALELO, cada una con su timeout (two_tower 40 ms, covisitation 30, trending_city
            15, followed 30): ≈ 500 + 300 + 100 + 100 candidatos. La que vence no se espera: se sirve con
            las demás y se cuenta en home_source_timeouts_total{source}
+ < 1 ms    merge: dedupe por item_id; `sources` guarda todas las fuentes que lo trajeron
            filtros baratos con la metadata del candidato: propias, bloqueados, geo (otra ciudad sin
            envíos), ya servidos en la sesión, vistos ≥ 3 veces sin interacción
+ ≤ 40 ms   EN PARALELO: batch get de features (usuario + ≈ 700–1,000 ítems; faltantes → defaults y se
            cuentan) y el chequeo de vendidos (tombstones, el mismo store del c07; si no contesta, el
            estado del ítem que trae el feature store)
+ ≤ 60 ms   ranker en Triton: P(click) y P(contact | click) por ítem → score = P(click) × (P(contact|click) + 0.05)
+ ≈ 10 ms   re-rank: freshness, ≤ 3 por categoría y ≤ 1 por vendedor en las primeras 10, ≤ 3 por vendedor
            en la página, ≥ 1 vendedor nuevo en las primeras 10 (también después de explorar), exploración en
            ≈ 5 % de las posiciones
            → respuesta: 50 ítems con request_id, path ("ranked"), model_version y posición global
            → en segundo plano: registro a Kafka home-impressions (key = user_id) con el FEATURE SNAPSHOT
              de cada ítem servido, y los ids servidos a la sesión (para que la página 2 no los repita)
después     la app manda vistas (qué estuvo en pantalla) y clicks con el mismo request_id; messaging-service
            manda los contactos. Al día siguiente, build_training_set une todo: un ejemplo por ítem VISTO
            cuya ventana de 24 h (+ 1 h de gracia) ya cerró; si el ítem se vendió antes, el negativo
            queda marcado como censurado
```

### La escalera de degradación

| Qué falla | Qué se sirve | `path` | Métrica |
|---|---|---|---|
| Una o más fuentes vencen | el feed con las fuentes que contestaron | `ranked` | `home_source_timeouts_total{source}` |
| Faltan features de algunos ítems | defaults (contadores en 0, tasas en el prior global), igual en el log | `ranked` | `home_feature_defaults_total{entity}` |
| El store de tombstones no contesta | el feed sin los ítems que el feature store marca vendidos; sin features tampoco, el feed igual (puede colarse un vendido) | `ranked` | `home_filtered_total{reason="availability_check_failed"}` |
| Feature store caído, versión de esquema distinta, ranker con timeout, error o salida con otra forma | los candidatos reales en orden heurístico (round-robin por fuente), sin exploración | `heuristic` | `home_fallback_total{reason}` |
| Sin contexto de usuario, sin candidatos o una excepción | populares de su ciudad (o nacionales) desde memoria | `popular` | `home_fallback_total{reason}` |
| Sin caché de populares | 503 con `Retry-After` (y `/readyz` ya había sacado al pod) | — | `home_requests_total{status="503"}` |
| El home-api entero | la app muestra "recientes en tu ciudad" (lo de hoy) | — | `HomeFallbackRateHigh` por `absent_over_time`, con `cause="no_metrics"` |

### El registro de impresión (`home_impression_v1`)

Uno por request, al tópico `home-impressions`, key `user_id`:
`request_id`, `user_id`, `ts`, `page`, `path`, `fallback_reason`, `model_version`, `city`, `is_new_user`,
`feature_set_version`, `user_features`, `context_features`, `user_features_defaulted`, `sources_failed`
(fuente → `timeout` | `error`), `filtered` (motivo → cuántos), `candidates` (solo en el 1 % de requests
de `CANDIDATE_LOG_RATE`: los ≈ 1,000 ids únicos antes de filtrar, con sus fuentes, para medir recall@k
por fuente) e `items`: por ítem servido `item_id`,
`position` (global en el scroll), `source`, `sources`, `score`, `p_click`, `p_contact_given_click`,
`exploration`, `propensity` (ε ÷ tamaño del pool, solo en exploración), `reasons` (`freshness`,
`new_seller`, `cap_relaxed`, `exploration`), `features` y `features_defaulted`.

El tamaño importa: con 6 features por ítem, un registro JSON de la demo pesa ≈ 13.5 KB (medido). Con
≈ 200 features de ítem en FP16 (el mismo tensor que recibe el ranker) son ≈ 0.4 KB por ítem → ≈ 22 KB
por request con usuario y contexto → ≈ 2 TB/día sin comprimir a 90 M requests/día (estimación del caso).
Por eso en producción va en un formato binario con esquema (Avro o Protobuf), comprimido y con retención
acotada; JSON está aquí para poder leerlo.

### Métricas del home-api (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `home_requests_total` | status, path (`ranked` · `heuristic` · `popular` · `none`) | HomeFallbackRateHigh |
| `home_request_duration_seconds` (histograma, bucket en 0.2) | — | HomeLatencyHigh |
| `home_stage_duration_seconds` | stage (`user`, `retrieval`, `features`, `ranker`, `rerank`, `total`) | runbook de latencia |
| `home_source_requests_total`, `home_source_timeouts_total`, `home_source_errors_total` | source | CandidateSourceTimeouts |
| `home_candidates_total` | source | dashboards |
| `home_filtered_total` | reason | dashboards ("% vendidos mostrados") |
| `home_feature_lookups_total`, `home_feature_defaults_total` | entity (`user`, `item`) | FeatureStoreStale |
| `home_fallback_total` | reason | runbook de fallback |
| `home_items_served_total`, `home_exploration_items_total` | path / — | ExplorationTrafficOff |
| `home_ranker_score` (histograma) | head (`click`, `contact_given_click`) | RankerScoreShift |
| `home_impression_log_buffered`, `home_impression_log_dropped_total`, `home_impression_log_failures_total` | — | ImpressionLogLag |

Métricas de otros servicios que usan las alertas (no están en esta carpeta): `kafka_consumergroup_lag` y
`kafka_topic_partition_current_offset` (kafka_exporter, consumer group `impression-joiner`),
`feature_pipeline_watermark_timestamp_seconds{feature_group}` (gauge propio del job de streaming que
escribe las features en tiempo real), `marketplace_contacts_total{surface}` (messaging-service) y
`marketplace_active_users{window}` (usuarios distintos por ventana, de un job de analytics con
HyperLogLog: un counter de Prometheus no cuenta distintos).

### Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Sistema | `HomeLatencyHigh` | p99 > 200 ms, 10 min | page |
| Sistema | `HomeFallbackRateHigh` | > 2 % de respuestas no `ranked` (heurístico, populares, 503), o el home-api sin métricas (`cause="no_metrics"`); 10 min | page |
| Sistema | `CandidateSourceTimeouts` | una fuente con > 5 % de timeouts, 15 min | ticket |
| Sistema | `FeatureStoreStale` | watermark de un grupo de features > 5 min atrás (SLO ≤ 1 min), o > 5 % de ítems con defaults; 5 min | page |
| Sistema | `ImpressionLogLag` | consumer `impression-joiner` > 15 min atrasado, o > 0.1 % de registros perdidos; 15 min | ticket |
| Modelo | `RankerScoreShift` | score medio de la primera pantalla > 1.3× o < 0.7× la misma hora de la semana pasada, ≥ 10 scores/s; 1 h | ticket |
| Modelo | `ExplorationTrafficOff` | exploración < 2 % de las posiciones del ranker (objetivo 5 %), 30 min | ticket |
| Negocio | `ContactsPerDAUDrop` | contactos por usuario activo en la hora < 85 % de la misma hora de la semana pasada, 2 h | ticket |

Trampa de las comparaciones semanales: la referencia de "hace una semana" se calcula con `offset 1w` sobre
las series **crudas**, no sobre la recording rule. Una regla recién creada no tiene historia, y la alerta
quedaría ciega una semana. Requiere ≥ 8 días de retención de los crudos (Prometheus guarda 15 por defecto).

## Correr los tests (sin GPU, sin Redis, sin Triton, sin Kafka)

```bash
cd reference/c08
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 84 tests, ≈ 4 s
python eval/ab_sample_size.py                       # el ejemplo del docstring

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 30 s: simula hasta 1 semana y media de series
```

## Demo local del home-api (todo falso)

```bash
cd reference/c08/serving
uvicorn --factory home_api:demo_app --port 8080
curl -s localhost:8080/readyz
curl -s -H 'x-request-id: demo-1' 'localhost:8080/v1/home?user_id=u42'
curl -s 'localhost:8080/v1/home?user_id=u42&page=2'     # no repite lo de la página 1
curl -s localhost:8080/metrics | grep '^home_'
```

`demo_app` usa un catálogo sintético, fuentes que solo duermen unos ms, un "ranker" que deriva el score
de una feature (NO es un modelo) y escribe los registros de impresión en stdout. Para ver un escalón de
degradación, sube el `delay_s` de una fuente en `demo_app` por encima de su timeout.

## Desplegar (resumen)

`build_app()` lanza `NotImplementedError` hasta conectar los adaptadores reales: `UserStore`,
`FeatureStore` y `AvailabilityStore` (cliente async de Redis-class con pipelining; el `FeatureStore`
puede ser el online store de Feast), las 4 `CandidateSource` (el índice ANN del item tower como el del
c07, la tabla de co-visitación cargada en el KV store, trending por ciudad, vendedores seguidos),
`Ranker` (tritonclient contra el modelo `home_ranker`), `ImpressionLog` (productor de Kafka con
`acks=all` y `enable.idempotence=true`) y `PopularCache` (snapshot en memoria refrescado desde el output
del job de populares). Variables: `BUDGET_S` (0.18), `RESERVE_S` (0.015), `USER_TIMEOUT_MS` (15),
`SOURCE_TIMEOUTS_MS` (`two_tower=40,covisitation=30,trending_city=15,followed=30`), `SOURCE_QUOTAS`
(`two_tower=500,covisitation=300,trending_city=100,followed=100`), `FEATURES_TIMEOUT_MS` (40),
`RANKER_TIMEOUT_MS` (60), `SEEN_CAP` (3), `PAGE_SIZE` (50), `SCORE_W_CLICK` (0.05), `EXPLORATION_RATE`
(0.05), `IMPRESSIONS_TOPIC` (`home-impressions`), `IMPRESSION_BUFFER` (50000), `POPULAR_NATIONAL_KEY`
(`_national`), `CANDIDATE_LOG_RATE` (0.01). `/healthz` (liveness) y `/readyz` (readiness: la caché de populares cargada; Redis, el ANN
o Triton caídos NO sacan al pod, porque hay escalones de degradación).

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon), sin GPU, sin Redis, sin Triton, sin Kafka y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 4 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.15 y 3.12.14 | 84 passed en los dos |
| home-api con fakes | TestClient: fuentes que tardan 500 ms o fallan, feature store lento, con faltantes o con otra versión de esquema, ranker con timeout, error o salida corta, store de tombstones colgado, Kafka colgado, buffer lleno | cada caso sale por el escalón esperado y por debajo de 200 ms; el registro de impresión trae exactamente las features (y defaults) que vio el ranker |
| Contrato de métricas | un test lee `alerts.yml` y exige que cada `home_*` exista en `/metrics` | OK |
| Demo con uvicorn real | `uvicorn --factory home_api:demo_app` + curl a `/readyz`, `/v1/home` (páginas 1 y 2), `/metrics` | 50 ítems `ranked` en ≈ 40 ms; la página 2 empieza en la posición 51 sin repetir; registro de ≈ 13.5 KB en stdout |
| Exploración | 200 requests de 50 posiciones en `test_rerank.py`; 80 en `test_home_api.py` | ≈ 5 % (entre 4 y 6 %); misma página para el mismo `request_id` |
| Tamaño de muestra | contra el cálculo a mano (1,744,196 por brazo con números redondos; 1,741,514 con los del caso) y por simulación (400 experimentos: potencia ≈ 80 %) | OK |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 20 reglas OK; los tests de las 8 alertas pasan, y llevar el umbral al otro lado del valor que producen las series del test (p. ej. 0.2 → 0.25 en HomeLatencyHigh) hace fallar su test. Un cambio chico (0.2 → 0.22) no: los tests tienen margen a propósito |
| Lock de dependencias | `uv pip compile` para Linux x86_64 y Python 3.13 | 17 paquetes |

**No verificado** (requiere Redis, el índice ANN, Triton, Kafka, un cluster o datos reales):

- No hay adaptadores reales (`build_app` lanza `NotImplementedError`): código de red sin probar no se
  publica como referencia. El ranker es un fake; la capacidad (≈ 1.5 M item-scores/s por L4) y los
  presupuestos por etapa son las estimaciones del caso, a medir con `perf_analyzer` y una prueba de carga.
- No se construyó ninguna imagen ni hay Dockerfile ni manifests de Kubernetes para el home-api (el patrón
  es el del gateway del c01/c06).
- La co-visitación corre en Python puro sobre listas: el cálculo es el mismo que haría un job de Spark,
  pero no se midió a escala (30 días de sesiones).
- `build_training_set.py` trabaja en memoria con listas de dicts: en producción es el mismo join en
  Spark/SQL. La ventana de gracia de 1 h para eventos tardíos es ilustrativa (mide el p99 de tu retraso),
  igual que la fracción de negativos (`neg_sample_rate`, 0.1 en producción según el caso).
- Los pesos (`SCORE_W_CLICK`, freshness 15 %, topes de diversidad, `SEEN_CAP`) y los umbrales de las
  alertas son ilustrativos. μ ≈ 1.3 sale de los números del caso, pero σ ≈ 4.33 del ejemplo del A/B es un supuesto: los dos salen de tus logs.
- El job de streaming de features, kafka_exporter, messaging-service y el job de usuarios activos no
  existen aquí: sus métricas solo están en los tests de promtool. El nombre
  `feature_pipeline_watermark_timestamp_seconds` es propio (no es una métrica que exporte Flink).

No incluidos a propósito (se describen en el caso): el entrenamiento del two-tower y del ranker, el
indexado del item tower (blue/green como el c07), el pre-ranker, el job de populares por ciudad, el job
que une impresiones con etiquetas en streaming (`impression-joiner`), el análisis del A/B (CUPED aplicado,
SRM) y los diseños contra la interferencia del marketplace.
