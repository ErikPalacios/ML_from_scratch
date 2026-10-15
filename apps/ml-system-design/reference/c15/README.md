# Caso c15 — archivos de referencia (predicción de clicks para el ad server de un medio de noticias)

Archivos **reales** del caso c15 de *Ronda de Diseño ML*: las features con hashing (una sola definición para
training y serving), el modelo de regresión logística con su corrección de submuestreo, la subasta de
segundo precio por slot, los tokens de impresión firmados, el servicio `ad-api` (FastAPI: filtros,
presupuesto de latencia, fallbacks, beacons y clicks), el set de entrenamiento (impresiones visibles +
clicks en 30 min, submuestreo de negativos), la calibración (corrección, isotónica, bins, ECE), las métricas
offline (log loss, NE, AUC, calibration ratio) y las 8 alertas con sus tests. Cada archivo está comentado
explicando **por qué**.

Los números del caso (≈ 100 M de páginas al día, 6,000 RPS de diseño, p99 ≤ 50 ms, ≈ 2,500 anuncios y
≈ 150 elegibles, reserva eCPM US$0.80, CTR ≈ 0.35 %, w = 5 %, ventana de 30 min, 1 % de exploración) son
**estimaciones** del caso. Timeouts, umbrales de alertas, el boost de 1.2 y el efecto de cada slot son
**ilustrativos** y están marcados así.

## Estructura

```
c15/
├── serving/
│   ├── features.py        # LA definición de features: campos, cruces, normalización, blake2b → 2^24 buckets,
│   │                      #   posición en índices RESERVADOS, intereses sin secciones sensibles
│   ├── model.py           # regresión logística hasheada: pCTR por slot en un scoring, corrección
│   │                      #   q = p / (p + (1 − p)/w), isotónica con np.interp, artefacto .npz con sha256
│   ├── auction.py         # subasta pura: eCPM, reserva, un anuncio por anunciante, GSP con tope, empates,
│   │                      #   boost de anuncios nuevos, exploración con propensity
│   ├── tokens.py          # token de impresión firmado (HMAC-SHA256, rotación de llaves, vigencia)
│   ├── ad_api.py          # FastAPI: POST /v1/ads, GET /v1/imp, GET /v1/click, métricas, fakes, demo
│   ├── requirements.txt   # lock de la imagen del ad-api (sin scikit-learn)
│   └── tests/             # test_features (13), test_auction (12), test_model_tokens (23), test_ad_api (29)
├── training/
│   ├── build_training_set.py  # visibles + clicks ≤ 30 min, dedupe, IVT, madurez, submuestreo determinista
│   ├── train_logreg.py    # SGD con learning rate por coordenada, en numpy, warm start
│   ├── calibration.py     # corrección (la de model.py), isotónica, bins de confiabilidad, ECE, ratio por slice
│   ├── synthetic.py       # mundo SINTÉTICO para tests y demo (no describe a ningún medio real)
│   ├── requirements.txt   # lock del job de entrenamiento (numpy + scikit-learn)
│   └── tests/             # test_build_training_set (11), test_calibration (11: incluye el pipeline completo)
├── eval/
│   ├── offline_metrics.py # log loss, NE, AUC por rangos, calibration ratio, por slice
│   └── tests/             # test_offline_metrics (10, con valores calculados a mano)
├── monitoring/
│   ├── alerts.yml         # 8 alertas (11 reglas) + 14 recording rules
│   └── alerts_test.yml    # tests de promtool
├── pytest.ini             # `pytest` desde aquí corre las 3 carpetas
└── requirements-dev.txt   # los dos locks + pytest + httpx2
```

## Orden de lectura sugerido

1. `serving/features.py` — el docstring: el ejemplo de un par (página, anuncio) hecho features, y las tres
   decisiones (hash estable, colisiones, posición en índices reservados).
2. `serving/model.py` — la corrección de submuestreo con números, y `predict_slots`: un scoring por candidato
   y, por slot, su término de posición.
3. `serving/auction.py` — el ejemplo A/B/C del docstring y las 6 reglas.
4. `serving/ad_api.py` — el docstring (presupuesto por etapa, degradación) y `serve()` de arriba abajo; después
   `/v1/imp` y `/v1/click`.
5. `training/build_training_set.py` — las 8 reglas. La trampa central: una impresión que nadie vio no es un
   negativo, y una de hace 5 minutos todavía no lo es.
6. `training/calibration.py` y `eval/offline_metrics.py` — por qué el AUC no alcanza cuando la probabilidad
   es dinero.
7. `monitoring/alerts.yml` — qué ve cada alerta, y qué NO ve.

## Un request de punta a punta

```
t = 0       la página pide anuncios EN PARALELO a su contenido: POST /v1/ads {section, device, geo,
            user_id?, consent}. Sin consentimiento, el user_id no se usa para nada (ni features, ni caps, ni log)
+ < 1 ms    targeting en el índice en memoria: ≈ 2,500 anuncios → los que coinciden con sección,
            dispositivo, región y hora
+ ≤ 10 ms   EN PARALELO, cada uno con su timeout: frequency caps de hoy (MGET, 8 ms), presupuesto y
            serve_rate por campaña (8 ms; si falla, la última lectura de ≤ 60 s), intereses de 30 días (10 ms)
+ < 1 ms    filtros: interés (segmentados solo con consentimiento y match), cap, presupuesto agotado,
            pacing (participa en serve_rate de los requests) → ≈ 150 elegibles
+ ≈ 1 ms    features.encode_candidates (≈ 0.6 ms para 150 en una Mac) + model.predict_slots en un executor
            (timeout 10 ms): pCTR por candidato × slot, ya corregido (w del artefacto) y calibrado
+ < 1 ms    auction.run_auction (o run_exploration en el 1 % de los requests): slot por slot, del más
            valioso al menos valioso; precio = max(eCPM real del siguiente ÷ boost del ganador, reserva) ÷
            (1000 × pCTR del ganador) + US$0.01, con tope en el bid
→ respuesta los 3 slots en el orden de la página: creatividad + impression_url + click_url con el token
            firmado (rid, ad, campaña, slot, precio, pCTR, src, ts); los slots sin ganador: "programmatic"
→ después   evento "serve" a ad-events (contexto, intereses, atributos de cada anuncio, pCTR, precio, quién
            fue el siguiente, src, propensity, boost, versiones) y, en segundo plano, +1 en los caps
+ segundos  la página manda GET /v1/imp?t=… cuando el anuncio es visible (≥ 50 % de píxeles ≥ 1 s):
            firma, vigencia (10 min), dedupe por imp_id → impresión visible y Σ pCTR esperados (calibración)
+ si click  GET /v1/click?t=…: firma, vigencia, dedupe; evento "click" con el precio DEL TOKEN (espera el
            ack de Kafka ≤ 200 ms: es facturación); gasto al Redis de presupuestos en segundo plano; 302 a
            la landing del índice (nunca a una URL del request)
día +1      build_training_set: visibles + clicks ≤ 30 min, todos los clicks y 5 % de los no-clicks (w en
            cada fila) → train_logreg (warm start) → calibration (isotónica en el día siguiente, sin
            submuestrear) → artefacto .npz con w y versión de features
```

### Caminos y degradación (`path` de la respuesta y de `ad_requests_total{path}`)

| Qué falla | Qué decide | `path` | Se ve en |
|---|---|---|---|
| Nada | modelo + subasta | `model` | `ad_requests_total{path="model"}` |
| Intereses (timeout, error, sin perfil) | el mismo modelo, solo contexto; los anuncios segmentados por interés no participan | `model` | `ad_user_feature_defaults_total{reason}` |
| Frequency caps (timeout o error) | se sirve SIN caps este request (fail-open: en CPC una impresión de más no se cobra) | `model` | `ad_dependency_errors_total{dependency="freq_caps"}` |
| Presupuestos (timeout o error) | la última lectura de ≤ 60 s; sin ella, esas campañas no participan (fail-closed) | `model` o `no_fill` | `ad_dependency_errors_total{dependency="budget"}`, `ad_budget_stale_total` |
| Modelo (timeout, excepción, NaN o fuera de [0, 1], sin cargar) o sin tiempo | bid × CTR histórico suavizado por anuncio × slot; sin exploración ni boost | `fallback` | `ad_fallback_total{reason}` |
| Nada elegible | los 3 slots al programático | `no_fill` | `ad_requests_total{path="no_fill"}` |
| Una excepción | los 3 slots al programático (la página no se rompe) | `error` | `ad_requests_total{path="error"}` |
| El ad-api entero | la página usa su timeout y el programático (fuera de esta carpeta) | — | `AdFallbackRateHigh{cause="no_metrics"}` |

### Endpoints

- `POST /v1/ads` — request: `request_id?` (8–64 de `[A-Za-z0-9_-]`), `section`, `device` (`mobile` · `desktop` ·
  `tablet`), `geo?` (región gruesa, p. ej. `MX-NLE`), `user_id?`, `consent` (default `false`). Respuesta:
  `request_id`, `path`, `exploration`, `model_version`, `feature_set_version`, `slots` (por slot: `fill` = `ad` |
  `programmatic`; si `ad`: `ad_id`, `campaign_id`, `creative`, `impression_url`, `click_url`), `latency_ms`.
  Un request que no valida → 422 **sin** repetir el input (el default de FastAPI devolvería el `user_id`).
- `GET /v1/imp?t=<token>` — 204 siempre. Cuenta una impresión visible por `imp_id` (`request_id:slot`).
- `GET /v1/click?t=<token>` — 302 a la landing del anuncio (del índice). Token inválido: no se cobra y
  redirige a la landing si el anuncio existe, si no a `HOME_URL`. Un anuncio servido DESPUÉS de su pausa (un
  pod con el índice atrasado) redirige pero no se cobra.
- `GET /healthz` (liveness: no depende de Redis ni del modelo) · `GET /readyz` (modelo cargado y calentado,
  índice con anuncios; la llave de firma se exige al arrancar) · `GET /metrics`.

### Eventos de `ad-events` (los escribe el ad-api; `build_training_set.py` los lee)

- `serve`: `event_id`, `request_id`, `ts`, `user_id` (solo con consentimiento), `consent`, `context` (section,
  device, geo, hour, dow LOCALES), `interests` (ya limpios), `path`, `fallback_reason`, `exploration`,
  `exploration_rate`, `model_version`, `feature_set_version`, `candidates`, `latency_ms` y `placements` (por
  slot: `imp_id`, `slot`, `ad_id`, `campaign_id`, `advertiser_id`, `ad_category`, `ad_format`, `bid`, `pctr`,
  `ecpm`, `price`, `price_source` (`next_ad` | `reserve`), `runner_up`, `src` (`model` | `explore` |
  `fallback`), `propensity`, `boost`).
- `impression`: `event_id`, `imp_id`, `request_id`, `ad_id`, `campaign_id`, `slot`, `src`, `pctr`, `serve_ts`, `ts`.
- `click`: `event_id`, `imp_id`, `request_id`, `ad_id`, `campaign_id`, `slot`, `src`, `price` (0 si no se cobra),
  `billable`, `serve_ts`, `ts`. El filtro de tráfico inválido (fuera de esta carpeta) agrega `invalid`.

### Métricas del ad-api (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `ad_request_duration_seconds` (histograma, buckets en 0.04 y 0.05) | — | AdServerLatencyHigh |
| `ad_stage_duration_seconds` | stage (`targeting`, `freq_caps`, `budget`, `user_features`, `model`, `auction`, `dedupe`, `click_log`, …) | runbook de latencia |
| `ad_requests_total` | path (`model`, `fallback`, `no_fill`, `error`) | AdFallbackRateHigh, RPMDrop |
| `ad_fallback_total` | reason (`model_timeout`, `model_error`, `model_unavailable`, `deadline`) | runbook de fallback |
| `ad_candidates` (histograma) | — | dashboards (¿≈ 150?) |
| `ad_filtered_total` | reason (`interest`, `freq_cap`, `budget_unknown`, `budget_exhausted`, `pacing`) | dashboards, runbooks |
| `ad_dependency_errors_total` | dependency, kind (`timeout` · `error`) | BudgetPacingOff |
| `ad_budget_stale_total` | — | dashboards |
| `ad_user_feature_lookups_total`, `ad_user_feature_defaults_total` | reason (`timeout`, `error`, `missing`) | UserFeatureStoreStale |
| `ad_slots_total` | slot, fill | dashboards (fill rate) |
| `ad_exploration_requests_total` | — | dashboards (¿≈ 1 %?) |
| `ad_viewable_impressions_total`, `ad_expected_clicks_total`, `ad_clicks_total` | slot, src, ad_age (`new` · `established`) | CalibrationRatioOff, CTRDrop |
| `ad_click_revenue_usd_total` | — | RPMDrop |
| `ad_clicks_not_billed_total` | reason (`served_after_pause`) | dashboards |
| `ad_impressions_rejected_total`, `ad_clicks_rejected_total` | reason (`malformed`, `unknown_key`, `bad_signature`, `expired`, `future`) | dashboards (fraude) |
| `ad_impression_duplicates_total`, `ad_click_duplicates_total` | — | dashboards |
| `ad_click_log_failures_total`, `ad_event_log_dropped_total{type}` | — | AdEventLogLag |
| `ad_index_age_seconds` (gauge, se calcula en cada scrape) | — | BudgetPacingOff (`index_stale`) |

Métricas de otros componentes que usan las alertas (no están en esta carpeta):
`kafka_consumergroup_lag` y `kafka_topic_partition_current_offset` (kafka_exporter),
`userfeat_last_update_timestamp_seconds` (el job de intereses, cada ≈ 15 min) y
`pacing_last_run_timestamp_seconds`, `pacing_spend_vs_plan_ratio`, `pacing_planned_spend_usd` (el controlador
de pacing).

### Las 8 alertas

| Grupo | Alerta | Umbral (ilustrativo) | Severidad |
|---|---|---|---|
| Sistema | `AdServerLatencyHigh` | p99 > 50 ms, 5 min | page |
| Sistema | `AdFallbackRateHigh` | > 2 % `fallback`, o > 0.5 % `error`, o sin métricas; 10 min (`cause`) | page |
| Sistema | `UserFeatureStoreStale` | job sin escribir > 1 h o ausente, o > 5 % de consultas con timeout/error; 15 min | ticket |
| Sistema | `AdEventLogLag` | consumer `ad-billing` > 5 min atrasado, clicks sin ack, > 0.1 % de eventos descartados, o sin métrica de lag; 5 min · joiner de entrenamiento > 2 h, 30 min | page · ticket |
| Sistema | `BudgetPacingOff` | controlador sin correr > 5 min o ausente, > 5 % de lecturas de presupuesto fallidas, o un índice de anuncios > 5 min; 10 min · gasto fuera de 0.8–1.2× el plan (plan > US$5,000), 30 min | page · ticket |
| Modelo | `CalibrationRatioOff` | clicks ÷ esperados (src=model) fuera de [0.8, 1.25] con ≥ 200 esperados/h, 30 min · fuera de [0.9, 1.1] (y dentro de la anterior) con ≥ 1,000/h, 2 h | page · ticket |
| Modelo | `CTRDrop` | CTR de un slot < 80 % de la misma hora de la semana pasada, con volumen; 1 h | ticket |
| Negocio | `RPMDrop` | RPM < 85 % de la misma hora de la semana pasada, con tráfico; 30 min | page |

Tres trampas de estas reglas, cada una con su test: un counter que nunca se incrementó **no existe** (si el
handler de clicks se rompe, el cociente de calibración queda vacío y la alerta no ve el peor caso: `or 0 *
esperados` lo rellena); en PromQL `and` se evalúa antes que `or` (paréntesis); y `rate(…[1h])` con menos de una
hora de datos casi no extrapola (los "esperados por hora" crecen de a poco al arrancar).

## Correr los tests (sin Redis, sin Kafka, sin online store)

```bash
cd reference/c15
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 109 tests, < 1 min (≈ 20 s en la Mac de la prueba)
pytest -s serving/tests/test_ad_api.py -k latency   # latencia y elegibles con 2,500 anuncios en TU máquina
pytest -s training/tests/test_calibration.py        # el pipeline completo: sin corrección vs con corrección

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 10 s: simula 8 días de series
```

## Demo local del ad-api (todo falso salvo el modelo)

```bash
cd reference/c15/serving
PYTHONPATH=../training uvicorn --factory ad_api:demo_app --port 8080   # entrena la LR sintética (≈ 3–5 s)
curl -s localhost:8080/readyz
curl -s -X POST localhost:8080/v1/ads -H 'content-type: application/json' \
  -d '{"request_id":"demo-req-0001","section":"deportes","device":"mobile","geo":"MX-NLE","user_id":"u-demo","consent":true}'
# copia el t=… de un click_url de la respuesta:
curl -s -o /dev/null -w "%{http_code}\n" "localhost:8080/v1/imp?t=$T"          # 204 (visible)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "localhost:8080/v1/click?t=$T"   # 302 a la landing
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "localhost:8080/v1/click?t=${T}x"  # firma rota: no se cobra
curl -s localhost:8080/metrics | grep -E '^ad_(requests|clicks|click_revenue|expected|viewable)'
```

`demo_app` arma un mundo sintético de 2,500 anuncios (segmentación, presupuestos, pacing), entrena la regresión
logística con un día de eventos sintéticos y escribe cada evento de `ad-events` en stdout. El perfil `u-demo`
lee autos, deportes y política: política no entra a sus intereses.

## Desplegar (resumen)

Faltan los adaptadores reales, que no se publican porque no se pudieron probar aquí: `FrequencyStore` (Redis
Cluster: llaves `fc:{user}:<campaña>:<fecha local>` con hash tag `{user}` → un MGET por request; INCR + EXPIRE
de 48 h al servir), `BudgetStore` (Redis chico que escribe el controlador de pacing cada minuto: gasto,
presupuesto y `serve_rate` por campaña), `UserFeatureStore` (online store), `DedupeStore` (`SET NX EX`),
`EventLog` (productor de Kafka con `acks=all` e idempotencia, tópico `ad-events`) y la recarga del índice
desde la base de campañas (cada minuto, con las pausas recientes para `get()`). El modelo se carga con
`HashedLogisticModel.load(ruta, sha256)` desde el registry. Variables: `BUDGET_MS` (40), `FREQ_TIMEOUT_MS` (8),
`BUDGET_TIMEOUT_MS` (8), `USER_FEATURES_TIMEOUT_MS` (10), `MODEL_TIMEOUT_MS` (10), `RESERVE_ECPM` (0.80),
`PRICE_INCREMENT` (0.01), `EXPLORATION_RATE` (0.01), `NEW_AD_IMPRESSIONS` (10000), `NEW_AD_BOOST` (1.2),
`SLOT_ORDER` (`top,in_article,bottom`), `PUBLISHER_TZ` (`America/Mexico_City`), `BUDGET_SNAPSHOT_MAX_AGE_S`
(60), `IMP_MAX_AGE_S` (600), `CLICK_MAX_AGE_S` (86400), `TOKEN_KEYS` (`kid:base64,…`, de un Secret),
`TOKEN_ACTIVE_KID`, `AD_BASE_URL`, `HOME_URL`, `EVENTS_TOPIC` (`ad-events`), `MODEL_WORKERS` (2).
En producción conviene desplegar `/v1/imp` y `/v1/click` aparte del ad-api: una ola de requests de anuncios no
debe frenar los clicks (son facturación).

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon), sin Redis, sin Kafka, sin online store y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 3 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.16 y 3.12.15 | 109 passed en los dos |
| Hash estable | dos procesos con `PYTHONHASHSEED` distinto | `bucket()` igual en los dos; `hash()` distinto |
| Scoring por slot exacto | `predict_slots` contra la fila completa de cada slot, pesos al azar | iguales (rtol 1e-12) |
| Pipeline completo | un día sintético (80k páginas, 240k impresiones) → `build_training_set` (w = 5 %) → `train_logreg` → holdout del día siguiente sin submuestrear | observados ÷ esperados: 0.067 sin la corrección (predice ≈ 15× los clicks), 1.07 con la corrección; AUC igual en los dos; NE 0.98 (el mundo sintético tiene poca señal) |
| Efecto de posición | el modelo contra la verdad oculta del mundo sintético | in_article −0.20 (verdad −0.25), bottom −0.69 (−0.80), video en in_article +0.10 (+0.10) |
| Isotónica | ajustada en el día 1, medida en el día 2 | ECE de 0.148 a 0.088 puntos porcentuales; `np.interp` sobre los umbrales = `IsotonicRegression.predict` |
| Servicio con fakes | TestClient: online store lento, Redis de caps caído, presupuestos caídos (≤ 60 s y después), modelo lento, NaN, fuera de [0, 1] o sin cargar, exploración, boost, beacons y clicks repetidos, tokens editados, click sin ack de Kafka, anuncio servido después de su pausa | cada caso sale por el camino esperado; latencia interna < 40 ms en los casos lentos |
| Latencia con 2,500 anuncios | 300 requests en proceso, mundo sintético con segmentación y pacing | ≈ 180 elegibles de media; p50 ≈ 2 ms, p99 ≈ 3 ms en esta Mac (todo en memoria: no es el número de producción) |
| Demo con uvicorn real | `uvicorn --factory ad_api:demo_app` + curl | 3 slots con `path: model`; beacon 204 y repetido 204; click 302 a la landing y repetido sin cobrar; firma rota → 302 sin cobrar; p50 ≈ 6 ms y p99 ≈ 11 ms en 200 requests (imprime cada evento a stdout) |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 25 reglas OK; los tests de las 8 alertas pasan (≈ 10 s); 25 mutaciones (cada umbral al otro lado de las series del test, cada rama `absent`, el `or 0 *` de la calibración, el `and on ()` del pacing) hacen fallar algún test |
| Locks | `uv pip compile` para Linux x86_64 y Python 3.13 | los mismos pins instalan en macOS arm64 |

**No verificado** (requiere Redis, Kafka, un cluster o datos reales):

- No hay adaptadores reales de Redis, del online store, de la deduplicación ni de Kafka; la atomicidad de los
  fakes es trivial (un hilo). Las latencias de Redis y del online store son las estimaciones del caso.
- No hay Dockerfile ni manifests de Kubernetes del ad-api (el patrón de imagen es el del c01; el caso pide
  ≈ 7 × c7i.4xlarge en el pico). No se construyó ninguna imagen.
- `build_training_set.py` y `train_logreg.py` corren en Python/numpy sobre miles de filas; en producción son
  un job de Spark/SQL y un entrenamiento distribuido sobre ≈ 16 M filas al día, no medidos a escala.
- El modelo y los datos son sintéticos (CTR ≈ 1 %, 60 anuncios en los tests): prueban la mecánica (corrección,
  calibración, posición, serving), no dicen nada de la calidad de un modelo real. La DNN del caso no está.
- El controlador de pacing, el job de intereses, el filtro de tráfico inválido, los consumers de facturación
  y del set de entrenamiento y kafka_exporter no existen aquí: sus métricas solo están en los tests de promtool.

No incluidos a propósito (se describen en el caso): la DNN con embeddings, la carga en caliente del modelo con
canary por hash del request, el modo barato y el load shedding en picos, el A/B con presupuestos separados por
brazo y los estimadores contrafactuales (IPS) sobre el tráfico de exploración.
