# Caso c11 — archivos de referencia (asistente interno con RAG y permisos)

Archivos **reales** del caso c11 de *Ronda de Diseño ML*: el chunking por estructura, la normalización de permisos de
Confluence, Drive y Jira a un filtro que el índice aplica **antes** del top-k, la ingesta incremental (qué se
re-embebe y qué no, tombstones, cambios de permisos sin re-embeber, freno de borrado masivo), el retrieval híbrido
(BM25 + vectores, RRF k = 60, reranker, top-8), el armado del prompt dentro de 8k tokens, la validación de citas, el
servicio `rag-api` con streaming SSE hacia el `llm-gateway` de #c10, la evaluación (recall@k y MRR por slice con casos
de permisos; groundedness con un juez y su acuerdo con personas) y las 8 alertas con sus tests. Cada archivo está
comentado explicando **por qué**.

Los números (≈ 1.5 M documentos → ≈ 12 M chunks de ≈ 400 tokens, ≈ 25k preguntas/día con pico ≈ 2 qps, 8 fuentes ×
≈ 400 tokens en un contexto de 8k, retrieval + rerank p95 ≤ 700 ms, primer token p95 ≤ 2.5 s, ediciones visibles en
p95 ≤ 15 min, revocaciones en ≤ 5 min) son los del caso y son **estimaciones**. Los umbrales y defaults que no vienen
del caso son **ilustrativos**: están marcados así en cada archivo. El corpus de los tests (`eval/fixtures/corpus.json`)
es **ficticio**.

## Estructura

```
c11/
├── ingest/
│   ├── chunker.py           # documento (títulos, párrafos, listas, tablas) → chunks de ≈ 400 tokens con la ruta de títulos
│   ├── acl.py               # ACLs de Confluence / Drive / Jira → principales; persona → principales (foto del IdP); el filtro
│   ├── incremental.py       # evento de cambio → upsert / ACL-only / tombstone / nada; freno de borrado masivo
│   ├── metrics.py           # métricas del worker de ingesta (lag, eventos, documentos, último sync de permisos)
│   ├── fixture_loader.py    # carga el corpus ficticio por el camino real (tests, eval y demo)
│   └── tests/               # test_chunker.py (15), test_acl.py (18), test_incremental.py (13)
├── retrieval/
│   ├── hybrid.py            # BM25 + kNN con el filtro de ACL ANTES del top-k, RRF, re-chequeo, reranker, ≤ 3 por documento, top-8
│   ├── fakes.py             # embedder por hashing y reranker por solapamiento (NO son modelos)
│   ├── opensearch_index.json# mapping del índice: campos acl_0..acl_2 (keyword), knn_vector 1024 con HNSW (faiss, FP16)
│   └── tests/               # test_hybrid.py (16)
├── answer/
│   ├── prompt_builder.py    # instrucciones + historial + fuentes numeradas + pregunta dentro de 8k (y del tope del gateway)
│   ├── citations.py         # [n] → ¿recuperada y permitida? inválidas fuera; oraciones sin cita
│   └── tests/               # test_prompt_builder.py (11), test_citations.py (8)
├── service/
│   ├── app.py               # FastAPI: POST /v1/ask (SSE), /v1/feedback, /metrics, /healthz, /readyz; cliente del llm-gateway
│   ├── requirements.txt     # lock completo (21 paquetes)
│   └── tests/               # test_app.py (25)
├── eval/
│   ├── retrieval_eval.py    # golden JSONL → recall@k y MRR por slice, fugas de permisos (tolerancia cero), gate
│   ├── groundedness.py      # interfaz de juez, faithfulness, citation precision, kappa y falso pase contra personas
│   ├── fixtures/            # corpus.json (8 documentos FICTICIOS, 4 personas) y golden_sample.jsonl (14 preguntas)
│   └── tests/               # test_retrieval_eval.py (11), test_groundedness.py (7)
├── monitoring/
│   ├── alerts.yml           # 8 alertas (15 reglas) + 4 recording rules
│   ├── alerts_test.yml      # tests de promtool de minutos y horas
│   └── alerts_long_test.yml # tests de promtool de días (feedback contra la semana pasada, canario, documentos contra ayer)
├── pytest.ini               # `pytest` desde aquí corre las cinco carpetas
└── requirements-dev.txt     # service/requirements.txt + pytest + pyyaml
```

## Orden de lectura sugerido

1. `ingest/acl.py` — el docstring: por qué una ACL es un AND de ORs, la trampa del enlace y por qué grupos y roles se
   resuelven al consultar. Después `test_acl.py`: cada test es una trampa.
2. `retrieval/hybrid.py` — el docstring (pre-filtering vs post-filtering, con la consulta de OpenSearch) y
   `test_post_filtering_starves_restricted_users`: 0 resultados contra 3, con los mismos datos.
3. `ingest/chunker.py` y `ingest/incremental.py` — qué es un chunk y qué pasa cuando cambia un documento.
4. `answer/prompt_builder.py` y `answer/citations.py` — el presupuesto de 8k y qué se valida de una cita (y qué no).
5. `service/app.py` — el docstring: una pregunta de punta a punta, los eventos SSE y los `outcome`.
6. `eval/retrieval_eval.py`, `eval/groundedness.py` y `monitoring/alerts.yml` — cómo se decide si funciona y qué
   despierta a alguien.

## Una pregunta de punta a punta

```
t = 0        ana@acme.com (soporte) manda POST /v1/ask {"question": "¿Cuál es el viático diario en Colombia?"}
             con el token del SSO
+ < 1 ms     token → email → principales con la foto del IdP: user:ana@acme.com, sus grupos de Google y Atlassian
             (con los anidados), domain:acme.com, roles de Jira que la incluyen, acl:open
             foto de más de 300 s → 503 acl_stale (falla cerrado) · persona fuera del IdP → 403
             una fuente sin sync de permisos en > 300 s → sale del retrieval (las demás siguen)
+ ≈ 0.3–0.7 s retrieval (timeout 1.5 s): BM25 y kNN EN PARALELO, cada uno con el filtro acl_0 ∧ acl_1 ∧ acl_2
             adentro → 50 + 50 candidatos ya filtrados → RRF (k = 60) → re-chequeo de ACL → cross-encoder sobre 50
             → ≤ 3 chunks por documento → top-8
             sin chunks → evento final "no_sources" y NO se llama al LLM
             índice caído → 503 retrieval_unavailable (todavía no salió un byte)
             event: meta {sources: [{n: 1, title: "Guía de viáticos 2026", section: "Viáticos por país", url, updated_at}, …]}
+ < 5 ms     prompt: system fijo (prefix caching en vLLM) + historial ≤ 1,200 + 8 fuentes numeradas + pregunta,
             ≤ 7,336 tokens y ≤ 7,500 según la estimación del gateway (caracteres ÷ 3)
+ ≈ 1–2.5 s  llm-gateway (#c10): model "chat-default", stream, max_tokens 600, user = hash de la persona
             primer pedazo (timeout 8 s; si no llega → final "llm_unavailable" con las fuentes, que ya sirven)
             event: delta {text} … (cada pedazo, apenas llega)
fin ≤ 10 s   citas validadas: [n] que no se recuperó o que la persona no puede ver → se borra
             event: final {outcome: "answered", answer, citations: [{n, doc_id, title, section, url, updated_at}],
                           invalid_citations, uncited_sentences}
             una línea de log: request_id, hash de la persona y de la pregunta, chunk_ids, doc_ids citados,
             tokens del prompt, latencias. SIN pregunta ni respuesta.
si el cliente se va: se cierra el stream con el gateway (que cierra el de vLLM y libera su KV) → outcome
             "client_disconnected"
```

`outcome` del evento final: `answered` (≥ 1 cita válida) · `no_answer` (ninguna cita válida: el modelo dijo "no sé" o
no citó) · `no_sources` · `llm_unavailable` · `llm_error` (se cortó a mitad; se valida lo que llegó).

### Códigos antes del stream

| Código | Cuándo | Qué hace la interfaz |
|---|---|---|
| 400 | body inválido, pregunta de más de 2,000 caracteres o de más de 500 tokens, historial de más de 20 mensajes | corregir |
| 401 | token inválido o ausente | volver a iniciar sesión |
| 403 | la persona no está en la foto del IdP (desactivada, otra empresa) | — |
| 503 + Retry-After 30 | foto del IdP de más de 5 min (`acl_stale`) | reintentar |
| 503 + Retry-After 5 | el índice no responde (`retrieval_unavailable`) | reintentar; mostrar "búsqueda no disponible" |
| 200 (SSE) | todo lo demás, incluidos el LLM caído y el retrieval vacío | mostrar fuentes y respuesta |

### Métricas de `rag-api` (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `rag_requests_total` | outcome | tablero; tasa de `no_answer` |
| `rag_ttft_seconds` (borde en 2.5) | — | RAGAnswerLatencyHigh |
| `rag_answer_latency_seconds` (borde en 10) | — | RAGAnswerLatencyHigh |
| `rag_retrieval_latency_seconds` (borde en 0.7) | — | RetrievalLatencyHigh; su `_count` es el denominador de EmptyRetrievalRateHigh |
| `rag_empty_retrieval_total` | reason (`no_candidates`, `below_threshold`) | EmptyRetrievalRateHigh |
| `rag_retrieval_degraded_total` | reason (`bm25_only`, `vector_only`, `encoder_version_mismatch`, `rerank_skipped`, `source_acl_stale`) | diagnóstico |
| `rag_acl_violations_total` | — | debe ser 0: un candidato prohibido llegó del índice (ver "Qué falta") |
| `rag_citations_total` | result (`valid`, `invalid`) | tablero |
| `rag_prompt_tokens` (histograma) | — | presupuesto de 8k y costo |
| `rag_acl_snapshot_age_seconds` (gauge) | — | ACLSyncStale |
| `rag_feedback_total` | rating (`up`, `down`) | NegativeFeedbackRising |

Del worker de ingesta (`ingest/metrics.py`): `rag_ingest_events_total{source,action}`,
`rag_ingest_lag_seconds{source,kind}` (bordes en 300 y 900 s), `rag_ingest_chunks_embedded_total{source}`,
`rag_index_documents{source}`, `rag_acl_sync_last_success_timestamp_seconds{source}`,
`rag_ingest_mass_delete_blocked_total{source}`. Del job de evaluación (`eval/groundedness.py`, formato de texto para
el textfile collector o un Pushgateway): `rag_eval_groundedness{suite}`, `rag_eval_citation_precision{suite}`,
`rag_eval_recall_at_8{suite}`, `rag_eval_items{suite}`, `rag_eval_last_run_timestamp_seconds{suite}`.

### Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Experiencia | `RAGAnswerLatencyHigh` | primer token p95 > 2.5 s (10 min) o respuesta completa p50 > 10 s (15 min; la típica, no la cola), con ≥ 0.05 preguntas/s | page |
| Experiencia | `RetrievalLatencyHigh` | retrieval + rerank p95 > 700 ms, 15 min | ticket |
| Calidad | `EmptyRetrievalRateHigh` | > 15 % de preguntas sin chunks en 1 h, 30 min | ticket |
| Calidad | `NegativeFeedbackRising` | pulgares abajo en 24 h > 1.5× los de hace una semana, > 10 % y ≥ 100 votos, 1 h | ticket |
| Ingesta | `IngestionLagHigh` | lag p95 de ediciones > 15 min por fuente (30 min); o una fuente sin eventos 1 h en horario de oficina | ticket |
| Permisos | `ACLSyncStale` | foto del IdP > 2 min (1 min); poller de permisos de una fuente sin éxito > 5 min; lag p95 de permisos > 5 min | page |
| Ingesta | `IndexDocCountDrop` | documentos de una fuente < 95 % de ayer (15 min, ticket); el freno de borrado masivo detuvo un lote (page) | ticket / page |
| Evaluación | `GroundednessCanaryRegression` | canario < 85 %, o > 5 puntos bajo su promedio de 7 días, con ≥ 50 preguntas; o el canario no corre hace 8 h | ticket |

Por qué las latencias exigen tráfico mínimo: con ≈ 2 qps en el pico y casi nada de noche, un p95 de 10 minutos con
5 preguntas es ruido. Por qué `ACLSyncStale` pagina: es la única alerta que protege una promesa de seguridad
(revocación ≤ 5 min), y a los 300 s el servicio empieza a contestar 503: la alerta da ≈ 2 min de aviso.

## Correr los tests (sin OpenSearch, sin GPU, sin gateway)

```bash
cd reference/c11
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 128 tests, ≈ 2 s
PYTHONPATH=ingest:retrieval python eval/retrieval_eval.py   # el golden de ejemplo contra el corpus ficticio

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # < 1 s
promtool test rules alerts_long_test.yml            # ≈ 10 s: simula hasta 8 días
```

## Demo local (corpus ficticio, LLM falso)

```bash
cd reference/c11/service
PYTHONPATH=../ingest:../retrieval:../answer uvicorn --factory app:demo_app --port 8081
# otra terminal: ana (soporte) pregunta por viáticos (domain:acme.com, visible para toda la empresa)
curl -sN localhost:8081/v1/ask -H 'Authorization: Bearer demo-ana' -H 'content-type: application/json' \
  -d '{"question": "¿Cuál es el viático diario en Colombia?"}'
# la misma pregunta sobre bonos de Finanzas: luis la ve, ana no (y el documento "con enlace" no lo ve nadie)
curl -sN localhost:8081/v1/ask -H 'Authorization: Bearer demo-luis' -H 'content-type: application/json' \
  -d '{"question": "¿Cómo se calcula el bono trimestral del equipo de Finanzas?"}'
curl -sN localhost:8081/v1/ask -H 'Authorization: Bearer demo-ana' -H 'content-type: application/json' \
  -d '{"question": "¿Cómo se calcula el bono trimestral del equipo de Finanzas?"}'
curl -s localhost:8081/metrics | grep '^rag_'
```

`demo_app` usa `ScriptedLLM`: contesta con la primera oración de la fuente [1] y la cita. **No es un modelo**: sirve
para ver el contrato (eventos, citas, permisos, métricas), no la calidad. Tokens de demo: `demo-ana`, `demo-luis`,
`demo-marta`, `demo-carlos` (contratista: no ve nada).

## Desplegar (resumen; no hay manifests aquí)

- **rag-api**: imagen con `service/app.py`, `retrieval/hybrid.py`, `ingest/acl.py`, `ingest/chunker.py` (por el
  contador de tokens) y `answer/`; `uvicorn --factory` sobre una función que arme los adaptadores reales (OpenSearch,
  encoder y reranker en GPU, OIDC, la foto del IdP refrescada cada ≈ 60 s). Variables: `RAG_GATEWAY_URL`,
  `RAG_GATEWAY_API_KEY` (Secret: la key del tenant `employee-assistant`), `RAG_MODEL_ALIAS`, `RAG_MAX_OUTPUT_TOKENS`,
  `RAG_ACL_MAX_STALENESS_S`, `RAG_USER_SALT` (Secret) y los timeouts de `Settings`. `/readyz` saca la réplica del
  Service si su foto del IdP está vieja. Dos ganchos opcionales de `create_app`: `source_acl_sync` (último sync de
  permisos por fuente: una fuente con más de 5 min sale del retrieval) y `late_check` (chequeo tardío contra la
  fuente para las fuentes sensibles, timeout 250 ms; si no contesta, esos chunks no entran).
- **Tenant en el gateway de #c10** (`tenants.yaml`): `employee-assistant`, prioridad interactive, alias
  `chat-default`, `max_tokens_cap: 600`, `max_prompt_tokens: 7500` (el prompt_builder recorta con esa misma cuenta),
  sin respaldo al proveedor (documentos internos), cuota de ≈ 1 M tokens/min (≈ 2 qps × ≈ 7.6k tokens estimados por
  request ≈ 0.9 M/min en el pico, más margen; ilustrativo).
- **Índice**: `retrieval/opensearch_index.json`: motor faiss (filtrado eficiente de k-NN desde 2.9), producto
  interno sobre vectores normalizados y cuantización escalar de 16 bits (FP16). Con la fórmula de la documentación de
  OpenSearch para HNSW, 1.1 × (1024 × 16/8 + 8 × m) bytes por vector: con m = 32 (como en #c07), ≈ 2,534 B →
  ≈ 30.4 GB para 12 M chunks (≈ 24.6 GB son los vectores en FP16; los ≈ 27.7 GB de la página del caso son la misma
  cuenta sin el 1.1 de overhead; estimación, mídelo con el índice real). Sin réplicas; con
  `number_of_replicas: 1`, el doble. Un índice por modelo de embeddings detrás de un alias (blue/green, como #c07);
  `RetrievalConfig.index_model_version` hace que un encoder de otra versión no se use (degrada a BM25).

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon), sin GPU, sin OpenSearch, sin el gateway, sin cluster y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 5 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.15 y 3.12.14; varias corridas seguidas; warnings como errores | 128 passed, todas las veces |
| Retrieval con permisos | índice en memoria con la MISMA regla que el filtro de OpenSearch (`acl.fields_allow`); 300 chunks con ACLs aleatorias y 40 personas aleatorias × BM25 y kNN | ninguna fuga; post-filtering deja 0 resultados donde pre-filtering deja 3 |
| Fuentes atrasadas y chequeo tardío | `source_acl_sync` con Drive atrasado; `late_check` falso que revoca un documento y otro que no contesta a tiempo | Drive sale del retrieval, Confluence y las macros siguen; el documento revocado no entra; sin respuesta, esa fuente no entra |
| Cadena completa | corpus ficticio → ACLs normalizadas → chunker → ingesta → índice → retrieval → prompt → LLM falso → citas → SSE | recall@8 = 1.0 en el golden de ejemplo (14 preguntas, 8 con respuesta), 0 fugas |
| Servicio | `httpx2.ASGITransport` contra la app; el cliente real del gateway contra `httpx2.MockTransport` con SSE con la forma de la API de OpenAI; la desconexión del cliente consumiendo el generador de la respuesta a mano | eventos, outcomes, 401/403/400/503, timeout del primer token, stream cortado, cierre del stream upstream |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 20 reglas OK; los dos archivos de tests pasan. 22 mutaciones de umbrales, mínimos de tráfico y de preguntas, ventanas, filtros de fuente y horarios hacen fallar algún test (ninguna sobrevive); los tests corrieron varias veces seguidas con el orden de grupos fijado |
| Mapping | `opensearch_index.json` parseado como JSON; sus campos y parámetros se compararon con la documentación de OpenSearch 3.9 (repo `documentation-website`) | no se creó en un cluster |
| Demo con uvicorn real | `uvicorn --factory app:demo_app` + curl | streaming, permisos distintos para la misma pregunta, `no_answer`, `no_sources`, 401, `/metrics`; un `curl --max-time 0.2` queda como `client_disconnected` |
| Lint | `ruff check` (E, F, W, B, UP; 120 columnas) | sin hallazgos |
| Lock de dependencias | `uv pip compile` para Linux x86_64 y Python 3.13 | 21 paquetes (mismas versiones que el gateway de #c10 donde coinciden) |

**No verificado:**

- **OpenSearch no corrió.** El filtro (`opensearch_filter`), la consulta `hybrid` (`opensearch_hybrid_body`) y el
  mapping siguen la documentación (filtrado eficiente de k-NN, `filter` de nivel superior en `hybrid` desde 3.0,
  `score-ranker-processor` con RRF desde 2.19, cuantización escalar de faiss), pero no se ejecutaron. La regla de
  permisos se probó en Python con la misma semántica.
- **Ningún modelo corrió**: el embedder (hashing), el reranker (solapamiento de palabras), el LLM y el juez son
  falsos. Recall, MRR y groundedness del corpus ficticio NO dicen nada de la calidad real; prueban el cableado.
- **Los conectores no existen**: los modelos de permisos de Confluence, Drive y Jira están simplificados y escritos en
  `acl.py` (las restricciones heredadas de Confluence, la lista de permisos de Drive con `allowFileDiscovery`, `view`
  y `deleted`, Browse Projects + nivel de seguridad en Jira). Que cada API entregue exactamente eso, y con qué
  latencia llegan los cambios de permisos, hay que verificarlo fuente por fuente.
- **El tokenizer**: los tests cuentan palabras y signos (`RegexTokenCounter`). En producción se cuenta con el
  tokenizer del modelo de embeddings (chunking) y con el del LLM (prompt); el margen de 256 tokens y el chat template
  (4 tokens por mensaje) son estimaciones a medir.
- **Estado compartido**: el estado de la ingesta es un dict en memoria (en producción, una tabla con escritura
  condicional por documento); la foto del IdP se inyecta (en producción, un refresco en segundo plano).
- **Qué falta**: el worker de ingesta (cola, reintentos, dead-letter), los adaptadores reales, el Dockerfile y los
  manifests; el resumen de turnos viejos del historial (aquí se recortan enteros), la reescritura de preguntas de
  seguimiento y la sonda sintética que mide revocaciones de punta a punta, que el caso menciona. Y una alerta que pagine con `rag_acl_violations_total > 0` (un candidato prohibido llegó del índice: es
  un incidente de seguridad aunque el re-chequeo lo haya frenado): no es una de las 8 del caso; agrégala.
- Los umbrales de las alertas y del gate son ilustrativos.
