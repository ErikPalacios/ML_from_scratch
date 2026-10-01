# Caso c07 — archivos de referencia (búsqueda semántica e híbrida en el marketplace)

Archivos **reales** del caso c07 de *Ronda de Diseño ML*: el `embed-worker` que mantiene el índice
vectorial al día (idempotente, versionado, con tombstones para lo vendido), un benchmark de FAISS que
mide recall, memoria y latencia de HNSW e IVF-PQ contra la búsqueda exacta, la fusión RRF, el
`search-api` híbrido con timeouts y fallbacks, la evaluación offline (NDCG@10 y recall con intervalo
bootstrap) y las 8 alertas con sus tests. Cada archivo está comentado explicando **por qué**.

No es el código del modelo (el dual encoder lo entrega otro equipo) ni el de un motor vectorial: los
servicios externos están detrás de interfaces pequeñas con fakes en los tests.

## Estructura

```
c07/
├── indexing/
│   ├── embed_worker.py        # listing-events → embedding → upsert con model_version; sold/removed → tombstone
│   ├── build_index.py         # FAISS: HNSW (Flat, SQ8, + refine) e IVF-PQ vs brute force; filtros; memoria a 100 M
│   ├── requirements.txt       # faiss-cpu 1.15.1, numpy, prometheus-client (lock)
│   └── tests/                 # test_embed_worker.py (16) · test_build_index.py (9)
├── search/
│   ├── api.py                 # FastAPI POST /v1/search: texto o foto, ANN ∥ BM25, RRF, tombstones, rerank, fallbacks
│   ├── fusion.py              # Reciprocal Rank Fusion (k = 60) con empates deterministas
│   ├── fakes.py               # encoder, shards, BM25, tombstones y reranker de juguete (tests y demo)
│   ├── requirements.txt       # lock completo de la imagen (17 paquetes, sin numpy ni torch)
│   ├── Dockerfile             # python:3.13.15-slim-trixie, no root, 1 proceso uvicorn
│   └── tests/                 # test_api.py (26) · test_fusion.py (9)
├── eval/
│   ├── offline_eval.py        # NDCG@10 (grados 0–3), recall@k, judged@10, knn-recall, bootstrap pareado
│   └── tests/                 # test_offline_eval.py (15)
├── monitoring/
│   ├── alerts.yml             # 8 alertas + 10 recording rules
│   └── alerts_test.yml        # tests de promtool (13 escenarios)
├── pytest.ini                 # `pytest` desde aquí corre las 3 carpetas (75 tests)
└── requirements-dev.txt       # los dos locks + pytest + httpx2
```

## Orden de lectura sugerido

1. `search/fusion.py` — el docstring tiene el ejemplo a mano: por qué un listing 20.º en las dos listas
   le gana al 1.º de una sola, y por qué no se suman scores de BM25 y coseno.
2. `search/api.py` — `Searcher.search()`: BM25 arranca sin esperar al encoder; encode → 4 shards en
   paralelo con timeout; RRF; filtros como defensa; tombstones; rerank del top-30 solo en la página 0.
   Después `_shard_search()`: la trampa del post-filtro y el chequeo de `model_version`.
3. `search/tests/test_api.py` — cada test es un modo de falla (encoder lento, shard caído, BM25 caído,
   todo caído, Redis caído, shard con otro modelo, adaptador que ignora el filtro).
4. `indexing/embed_worker.py` — el docstring con las 4 garantías; `process()`: versiones, bajas primero,
   re-embeber solo si cambió el contenido.
5. `indexing/build_index.py` — corre la versión rápida y mira la tabla y el experimento de filtros.
6. `eval/offline_eval.py` — NDCG con IDCG de *todos* los juzgados, judged@10, bootstrap pareado.
7. `monitoring/alerts.yml` — qué ve cada alerta y qué NO ve (el histograma de frescura calla si el
   worker está caído; por eso existe `EmbedWorkerBacklog`).

## Una búsqueda de punta a punta

```
t = 0     la app manda POST /v1/search?city=GDL&price_max=1000   {"q": "chamarra de mezclilla vintage talla M"}
          search-api valida (q ≤ 256 caracteres, rango de precio coherente) y arranca DOS caminos a la vez:
+ ≈ 40 ms  ├─ BM25 en OpenSearch con los filtros como bool/filter (timeout 120 ms) → hasta 200 ids
+ ≈ 10 ms  └─ encoder de texto en GPU (timeout 50 ms) → vector de 512 (model_version v7)
+ ≈ 20 ms       └─ 4 shards EN PARALELO, filtro dentro de la búsqueda, re-score con float32 (timeout 80 ms c/u)
                   ¿un shard con otro model_version? se descarta (ann_partial) · ¿todos fallan? solo BM25
+ ≈ 1 ms   RRF (k = 60) sobre las dos listas → filtros otra vez (defensa: un adaptador con bug no pasa)
+ ≤ 20 ms  tombstones: ¿cuáles de los ≤ 400 candidatos se vendieron hace segundos? (un round trip a Redis)
+ ≈ 60 ms  rerank del top-30 con el cross-encoder (timeout 100 ms; si vence, queda el orden de RRF)
           → página 0 (48 resultados) con latency_ms por etapa, model_version y degraded
           → una línea JSON al log (base de eval sets, atribución de clics y auditoría de vendidos)
```
Una foto ("algo como esto") salta BM25 y el reranker de texto: decode + encode de imagen (timeout
300 ms, SLO p99 600 ms) → ANN → tombstones. Si el encoder de imagen no responde, es 503: una foto no
tiene fallback de palabras clave.

### Qué devuelve `/v1/search`

`model_version` (del encoder; `null` si se sirvió solo BM25), `query_type` (`text` · `photo`), `page`,
`results` (`listing_id`, `rank`, `sources` = posición en cada lista ANTES de filtros y tombstones,
`rerank_score` si se re-ordenó), `has_more`, `degraded` (`encode_timeout`, `ann_unavailable`,
`ann_partial:shard-1`, `bm25_error`, `tombstones_unchecked`, `rerank_skipped`…), `latency_ms` por etapa
(`encode`, `ann` = el shard más lento, `bm25`, `fusion`, `tombstones`, `rerank`, `total`) y `request_id`.
Errores: 400 (query vacía o muy larga, bytes que no son JPEG/PNG/WebP), 413 (> 10 MB), 415 (otro
content-type), 422 (filtros inválidos), 503 con `Retry-After` (ni ANN ni BM25).

## Lo que midió `build_index.py` (200,000 × 512 sintéticos, Mac M4 de 10 núcleos, FAISS 1.15.1)

| Índice | Parámetros | recall@10 | recall@100 | build | bytes/vector | p50 / p99 por consulta |
|---|---|---|---|---|---|---|
| HNSW-Flat | M=32, efSearch=128 | 1.000 | 0.999 | 40 s | 2,320 | 0.38 / 0.78 ms |
| HNSW-SQ8 | M=32, efSearch=128 | 0.975 | 0.988 | 19 s | 784 | 0.35 / 0.50 ms |
| HNSW-SQ8 + refine | efSearch=128, 200 candidatos re-scored | 1.000 | 0.999 | 19 s | 784 (+ float32 aparte) | 0.46 / 0.64 ms |
| IVF-PQ64 | nlist=2048, nprobe=64 | 0.308 | 0.563 | 17 s | 96 | 0.40 / 0.49 ms |
| IVF-PQ64 + refine | nprobe=64, 200 candidatos | 0.973 | 0.822 | 17 s | 96 (+ float32 aparte) | 0.48 / 0.86 ms |

Latencia: una consulta a la vez, un hilo, k = 100, sin red ni filtros. Corrida completa: ≈ 100 s.

Filtros por un atributo que no depende del contenido (como la ciudad), k = 48:

| Selectividad | Post-filtro sobre 200 candidatos | Filtro dentro del HNSW (efSearch=128) | Exacto sobre el subconjunto |
|---|---|---|---|
| 0.2 % (400 vectores) | 0.4 resultados; 69 % de páginas vacías | 1.9 resultados; recall 0.03 | 0.27 ms |
| 10 % (20,000 vectores) | 20 resultados; ninguna página llena | 48 resultados; recall 0.96 | 12.4 ms |

**Cómo leerlo.** (1) SQ8 cuesta poco recall y 3× menos memoria; el re-score de 200 candidatos con float32
lo recupera: es la decisión del caso. (2) IVF-PQ es el más barato en RAM, pero PQ pierde mucho en estos
datos; el refine lo levanta a 0.97 en recall@10 pero no en recall@100 (la lista de 200 candidatos ya
viene mal). (3) Con un filtro muy selectivo, ni el post-filtro ni el HNSW filtrado sirven: lo correcto es
la búsqueda exacta sobre el subconjunto. Con uno amplio, el HNSW filtrado sí. Algunos motores eligen
entre los dos solos; por ejemplo, OpenSearch k-NN con el motor faiss pasa a búsqueda exacta cuando los ids
filtrados son pocos (`knn.advanced.filtered_exact_search_threshold`). Verifica cómo lo hace el tuyo.
(4) A 100 M de vectores: 51.2 GB de int8 + 25.6 GB de grafo = 76.8 GB, 19.2 GB por shard (4 shards),
más 204.8 GB de float32 para el re-score fuera del grafo (51.2 GB por shard).

**Recall sintético ≠ recall real.** Estos vectores son gaussianas alrededor de centros al azar; tus
embeddings tienen otra estructura y el recall de HNSW y PQ depende de eso. El número que vale es el del
canary con vectores reales (`ANNRecallDrop`).

## Métricas que exportan los servicios

| Métrica | Labels | La usa |
|---|---|---|
| `search_requests_total` | query_type, status | ZeroResultRateHigh (denominador) |
| `search_request_duration_seconds` (buckets en 0.3 y 0.6) | query_type | SearchLatencyHigh |
| `search_stage_duration_seconds` | stage (`encode`, `ann` por shard, `bm25`, `tombstones`, `rerank`) | runbook de latencia |
| `search_zero_results_total` | query_type | ZeroResultRateHigh |
| `search_degraded_total` | reason | runbooks (¿fallback activo?) |
| `search_ann_shard_errors_total` | shard, reason (`timeout`, `error`, `model_version_mismatch`) | runbooks |
| `search_tombstone_checks_total` | outcome (`ok`, `failed`) | SoldItemsServed |
| `search_tombstoned_results_total`, `search_postfilter_underfilled_total`, `search_filter_violations_total` | — / shard / — | dashboards |
| `embed_worker_index_freshness_seconds` (buckets en 60 y 300) | op (`upsert`, `tombstone`) | IndexFreshnessLag, SoldItemsServed |
| `embed_worker_events_total` | type, outcome (`applied`, `attrs_only`, `stale`, `superseded`, `invalid`) | dashboards |
| `embed_worker_upserts_total`, `embed_worker_tombstones_total`, `embed_worker_attribute_updates_total` | — | dashboards |
| `embed_worker_event_lag_seconds`, `embed_worker_backlog_messages`, `embed_worker_last_success_timestamp_seconds` | — | dashboards |
| `embed_worker_dead_letter_total` | reason | runbook de backlog |

De otros componentes (no están en esta carpeta): `kafka_consumergroup_lag` y
`kafka_topic_partition_current_offset` (kafka_exporter), `ann_canary_recall_at_100{shard}` y
`ann_canary_last_run_timestamp_seconds{shard}` (job horario del canary), `sold_audit_results_checked_total` y
`sold_audit_sold_served_total` (auditoría de vendidos servidos), `clickstream_searches_total` y
`clickstream_searches_with_click_total` (eventos de la app), `container_memory_working_set_bytes`
(cAdvisor) y `kube_pod_container_resource_limits` (kube-state-metrics).

## Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Sistema | `SearchLatencyHigh` | p99 > 300 ms (texto) o > 600 ms (foto), 10 min | page |
| Sistema | `EmbedWorkerBacklog` | lag ÷ ritmo de producción > 180 s, 10 min (ve al worker caído) | page |
| Sistema | `IndexFreshnessLag` | p95 commit → upsert > 300 s, 15 min | page |
| Sistema | `SoldItemsServed` | chequeos de tombstones fallidos > 1 %, o p95 de tombstones > 60 s, o auditoría > 0.1 %; 10 min | page |
| Sistema | `ShardMemoryHigh` | memoria de una réplica > 85 % de su límite, 30 min | ticket |
| Índice | `ANNRecallDrop` | recall@100 vs exacto < 0.95 en un shard, o canary sin correr > 3 h (o inexistente); 1 h | ticket |
| Calidad | `ZeroResultRateHigh` | > 2 % y > 2× la misma hora de la semana pasada, 15 min | page |
| Calidad | `SearchCTRDrop` | < 0.8× la misma hora de la semana pasada, con > 10 búsquedas/s, 1 h | ticket |

Los umbrales que no salen de un SLO (2 %, 0.1 %, 85 %, 0.8×, 180 s) son ilustrativos: ajústalos con la
historia de tus métricas. Las comparaciones contra la semana pasada usan `offset 1w` sobre los counters
crudos: necesitan ≥ 8 días de retención (Prometheus guarda 15 por defecto).

## Correr los tests (sin GPU, sin Kafka, sin motor vectorial)

```bash
cd reference/c07
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (el de la imagen) o 3.12
pip install -r requirements-dev.txt
pytest                                              # 75 tests, ≈ 5 s
python indexing/build_index.py --n 50000 --queries 300   # ≈ 20 s; sin argumentos, 200k × 512 (≈ 100 s)
python eval/offline_eval.py qrels.jsonl run.jsonl --baseline run_actual.jsonl   # con tus archivos

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 30 s: simula hasta 7.8 días de series
```

## Demo local de search-api (todo falso, catálogo de 12 listings)

```bash
cd reference/c07/search
uvicorn --factory api:demo_app --port 8080
curl -s localhost:8080/readyz
curl -s -X POST 'localhost:8080/v1/search?city=GDL' -H 'content-type: application/json' \
  -d '{"q":"chamarra de mezclilla vintage talla M"}'
printf '\xff\xd8\xffchamarra de mezclilla' | curl -s -X POST localhost:8080/v1/search \
  -H 'content-type: image/jpeg' --data-binary @-
curl -s localhost:8080/metrics | grep ^search_
```

El "embedding" de juguete promedia vectores fijos por palabra: no entiende sinónimos, solo sirve para
ver el cableado. `L2` tiene tombstone: no aparece aunque esté en el índice y en BM25. La "foto" de la
demo es la firma JPEG seguida de texto. Fíjate en que el ANN devuelve vecinos aunque sean malos: un
umbral mínimo de similitud es una decisión de producto (no está implementado).

## Desplegar (resumen)

La imagen se construye desde `reference/c07/search` (`docker build -t search-api:<versión> .`). Su `CMD`
usa `api:build_app`, que **lanza `NotImplementedError`** hasta conectar los adaptadores reales:
`QueryEncoder` (cliente de Triton: torres de texto e imagen; el decode de la foto en CPU, en un
threadpool), 4 × `AnnShard` (el cliente del motor vectorial elegido, uno por shard, con sus 2 réplicas),
`KeywordIndex` (opensearch-py async), `TombstoneStore` (Redis) y `Reranker` (cross-encoder en Triton, o
`None`). Variables: `TEXT_ENCODE_TIMEOUT_S` (0.05), `IMAGE_ENCODE_TIMEOUT_S` (0.3), `ANN_SHARD_TIMEOUT_S`
(0.08), `BM25_TIMEOUT_S` (0.12), `TOMBSTONE_TIMEOUT_S` (0.02), `RERANK_TIMEOUT_S` (0.1), `CANDIDATES` (200),
`RERANK_TOP_N` (30; 0 lo apaga), `PAGE_SIZE` (48), `RRF_K` (60), `OVERFETCH_FACTOR` (4), `MAX_IMAGE_BYTES`
(10 MB), `MAX_QUERY_CHARS` (256), `RETRY_AFTER_S` (2). Puerto 8080; `/healthz` (liveness) y `/readyz`
(readiness: encoder y shards con el **mismo** `model_version`).

`embed_worker.build_worker()` también lanza `NotImplementedError`: faltan el consumer de Kafka
(`group.id=embed-worker`, commit manual), el cliente del encoder, el de los shards (apuntando al índice de
SU `model_version`, no al alias de lectura), Redis para tombstones y versiones, y el productor de la DLQ.
Métricas en el puerto 9100.

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon M4), sin GPU, sin Kafka, sin OpenSearch, sin Redis y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 3 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python **3.13.15** (el de la imagen) y 3.12.14 | 75 passed en ambos |
| search-api con fallbacks | TestClient + fakes con demoras de 1–2 s, errores, versiones distintas, shards que solo post-filtran o ignoran el filtro | corta en cada timeout (< 0.5 s en total con 4 shards de 1 s); cada fallback sale en `degraded` y en métricas |
| Demo con uvicorn real | `uvicorn --factory api:demo_app` + curl a `/readyz`, `/v1/search` (texto y foto) y `/metrics` | OK; el listing con tombstone no aparece |
| Benchmark FAISS | `build_index.py` con 200k × 512 y con 50k (FAISS 1.15.1) | la tabla de arriba; bytes/vector medidos = fórmula (2,320 vs 2,304 de HNSW-Flat) |
| HNSW no borra | `remove_ids` en `IndexHNSWFlat` (en un test) | `RuntimeError: remove_ids not implemented` |
| Contrato de métricas | dos tests leen `alerts.yml` y exigen que cada `search_*` y `embed_worker_*` exista en el código | OK |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 18 reglas OK; los 13 escenarios pasan (8 corridas seguidas); cambiar cualquiera de los 12 umbrales, o quitar la rama `canary_missing`, hace fallar su test |
| Wheels para la imagen | `pip download --only-binary=:all:` para cp313 manylinux x86_64 | los 20 paquetes de los dos locks tienen wheel |
| Imagen base | tag de `python:3.13.15-slim-trixie` leído de Docker Hub | existe; ≈ 43 MB comprimida (amd64) |
| `Dockerfile` | parseado con `dockerfile-parse` 2.0.1 | OK (no se construyó) |
| Fórmulas de memoria y RRF | wiki de FAISS ("Guidelines to choose an index") y Cormack, Clarke y Büttcher (SIGIR 2009) | coinciden (HNSW: 4d + 2·M·4 B; PQ: m B; RRF con k = 60) |

**No verificado** (requiere GPU, Kafka, un motor vectorial, Redis, un cluster o datos reales):

- No hay adaptadores reales (encoder, shards, OpenSearch, Redis, Kafka, reranker): `build_app` y
  `build_worker` lanzan `NotImplementedError`. Sin esos servicios no se pueden probar, y código de red sin
  probar no se publica como referencia.
- Las latencias por etapa del caso (≈ 10 ms de encoder, ≈ 20 ms por shard, ≈ 40 ms de BM25, ≈ 60 ms de
  rerank) son estimaciones; los timeouts son techos razonables, no medidos contra un sistema real.
- El recall del benchmark es de vectores sintéticos; el de IVF-PQ en particular depende mucho de los datos.
- No se construyó la imagen (no hay daemon de Docker) ni se aplicó nada a un cluster.
- kafka_exporter, el canary, la auditoría de vendidos y el pipeline de clics no existen aquí: sus métricas
  solo aparecen en los tests de promtool, con nombres elegidos para esta referencia (los de kafka_exporter
  son los de su README).
- `ShardMemoryHigh` supone réplicas como pods de Kubernetes con límite de memoria. Si el motor corre en VMs
  (p. ej. nodos de datos de OpenSearch), la regla se reescribe con node_exporter (comentario en `alerts.yml`).

No incluidos a propósito (se describen en el caso): el caché de resultados de consultas populares (con la
versión del índice en la clave y los tombstones aplicados DESPUÉS del caché), la hidratación de los 48
resultados (que también quita lo que su estado marca como vendido), el hedged request a la otra réplica
de un shard lento, el listing sintético que mide la frescura de punta a punta cada minuto, el job del
canary, la auditoría de vendidos, el re-embedding del catálogo y el build blue/green del índice, el
manifest de Kubernetes y el entrenamiento del encoder.
