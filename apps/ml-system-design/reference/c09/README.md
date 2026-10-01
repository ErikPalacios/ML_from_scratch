# Caso c09 — archivos de referencia (fraude en pagos con tarjeta no presente)

Archivos **reales** del caso c09 de *Ronda de Diseño ML*: las definiciones de features como código (una
sola fuente para online y offline), los contadores de velocidad del request (buckets con TTL, idempotentes
por pago), el set de entrenamiento point-in-time con etiquetas maduras, el servicio `fraud-scoring`
(FastAPI, presupuesto de 80 ms, reglas siempre, GBDT en CPU, umbrales por segmento, exploración y
fallback rules-only), la elección de umbrales por costo esperado, la curva de llegada de chargebacks y las
8 alertas con sus tests. Cada archivo está comentado explicando **por qué**.

Los números (≈ 2,000 TPS de diseño, p99 ≤ 100 ms para el chequeo, ≈ 0.08 % de fraude por conteo y
≈ 12 bps por valor, ≈ 60 % de los chargebacks a 30 días y ≈ 90 % a 60, exploración del 1 %) son los del
caso y son **estimaciones**. Umbrales, límites y costos que no vienen del caso son **ilustrativos** y
están marcados así en cada archivo.

## Estructura

```
c09/
├── features/
│   ├── definitions.py       # LA definición de cada feature: entidad, ventana, bucket, agregación, tier,
│   │                        #   si el pago entra en su propio agregado (no). La usan online y offline
│   ├── online_counters.py   # contadores sync: buckets con TTL detrás de una interfaz KeyValue, guardia
│   │                        #   de idempotencia por payment_id (devuelve lo que vio la 1.ª llamada), fake
│   ├── point_in_time.py     # set de entrenamiento: features "como eran" (pandas), dedupe, as-of join de
│   │                        #   snapshots batch, etiqueta madura, filas inmaduras fuera, solo autorizados
│   └── tests/               # test_online_counters.py (12), test_point_in_time.py (12: paridad online == offline)
├── scoring/
│   ├── service.py           # FastAPI POST /v1/score: presupuesto, caché de decisión, contadores + features
│   │                        #   en paralelo, reglas, GBDT en su executor, decisión, log, métricas, demo
│   ├── policy.py            # de (score, reglas, segmento) a approve/step_up/review/decline + reason codes
│   ├── rules.py             # lista negra, límites duros, reglas de comercio (una regla rota se salta)
│   ├── policy.yaml          # umbrales por segmento, tope de declines, exploración, límites, comercios
│   ├── synthetic.py         # datos SINTÉTICOS para tests y demo (no es un modelo de fraude)
│   ├── requirements.txt     # lock completo de la imagen (25 paquetes)
│   └── tests/               # test_service.py (23), test_policy_rules.py (23)
├── eval/
│   ├── choose_thresholds.py # costo esperado por 1,000 pagos sobre una grilla (step-up, decline) con tope
│   ├── label_maturity.py    # curva de llegada de chargebacks, cohortes evaluables, tasa completada
│   └── tests/test_eval_c09.py   # 13 tests (cálculo a mano, Bayes vs grilla, sesgo de cohortes jóvenes)
├── monitoring/
│   ├── alerts.yml           # 8 alertas (9 reglas: RulesEngineErrors tiene 2) + 12 recording rules
│   └── alerts_test.yml      # tests de promtool
├── pytest.ini               # `pytest` desde aquí corre las 3 carpetas
└── requirements-dev.txt     # scoring/requirements.txt + pandas + pytest + httpx2
```

## Orden de lectura sugerido

1. `features/definitions.py` — el docstring y `bucket_range`: la ventana de "60 s" son 6 buckets de 10 s
   (ve entre 50 y 60 s hacia atrás). Lo que importa no es la precisión: es que offline sea **igual**.
2. `features/online_counters.py` — las tres decisiones del docstring (idempotencia, atomicidad por
   entidad con hash tags, distinct exacto vs HyperLogLog) y `read_and_update`.
3. `scoring/service.py` — el docstring (presupuesto por etapa, modos) y `score()` de arriba abajo.
4. `scoring/policy.py` + `policy.yaml` — `decide()` en 5 pasos, y de dónde salen los umbrales.
5. `features/point_in_time.py` — las 5 reglas del docstring. La trampa central: un pago de hace 20 días
   sin chargeback **no es un negativo todavía**.
6. `eval/choose_thresholds.py` y `eval/label_maturity.py` — el ejemplo numérico de cada docstring.
7. `monitoring/alerts.yml` — qué ve cada alerta, y qué NO ve.

## Un pago de punta a punta

```
t = 0       el orquestador de pagos (con el PAN ya tokenizado) llama POST /v1/score con payment_id,
            comercio, MCC, monto en centavos de USD, card_token, hashes de IP/dispositivo/email
+ ≤ 5 ms    caché de decisión por (payment_id, etapa): un reintento recibe LA MISMA respuesta
+ ≤ 20 ms   EN PARALELO: contadores sync (tarjeta 60 s y 1 h, dispositivo 1 h, IP 60 s) — leer la
+ ≤ 25 ms     ventana ANTES de sumar, guardia por payment_id —, y features stream (Flink) + batch del
              online store. En proceso, siempre: el contador local del pod (respaldo de los límites duros)
+ < 1 ms    reglas: lista negra, límites duros (5 intentos previos de la tarjeta en 60 s → decline),
            reglas del comercio
+ ≈ 0.3 ms  GBDT en CPU (1 fila, 1 thread de OpenMP; medido en una Mac: ver test_service.py)
+ < 1 ms    decisión: umbrales del segmento (retail_low: step-up desde 0.034, decline desde 0.443),
            la más severa entre modelo y reglas, revisión manual si el comercio captura después,
            exploración (1 % de los declines de riesgo medio → step-up, con propensity 0.01)
            → respuesta: decision, reason_codes, score, segment, path, versiones, latency_ms
            → log de la decisión con el FEATURE SNAPSHOT (fraud-decisions), sin bloquear
si step-up  3-D Secure; el orquestador llama OTRA VEZ con el mismo payment_id y three_ds_result
            (path="three_ds_result"): se aplica el resultado a la decisión de la primera, sin volver a
            correr el modelo (las features stream ya incluirían al propio pago). failed → decline;
            authenticated → approve, salvo una regla de review o decline. Los contadores no suman y
            devuelven lo que vio la primera llamada (las reglas ven lo mismo)
después     chargebacks por fraude (hasta ≈ 120 días), reportes de fraude del emisor (TC40, Fraud and
            Loss Database: los únicos para los pagos con 3DS) y fraude confirmado → tabla de etiquetas;
            point_in_time.py arma el set con los pagos autorizados de cohortes maduras (≥ 90 días):
            features del primer registro del pago, decisión final del último (el step-up aprobado entra)
```

### Modos y degradación

| Qué falla | Qué decide | `path` | Se ve en |
|---|---|---|---|
| Nada | modelo + reglas | `model` | `fraud_decisions_total{decision,segment}` |
| Falta el grupo batch (permitido en `policy.yaml`) | modelo con NaN en ese grupo + reglas; `groups_defaulted: ["batch"]` | `model` | `fraud_feature_defaults_total{group="batch"}` |
| Contadores sync (timeout o error) | reglas con el contador **local** del pod + `fallback` del segmento | `rules_only` | `fraud_fallback_total{reason="counters_*"}` |
| Features stream (timeout, error o ausentes) | reglas + `fallback` del segmento | `rules_only` | `fraud_fallback_total{reason="features_*"}` |
| Modelo (timeout, excepción, score fuera de [0, 1], no cargado) o sin presupuesto | reglas + `fallback` del segmento | `rules_only` | `fraud_fallback_total{reason="model_*" \| "budget_exhausted"}` |
| Una regla rota | se salta (fail-open por regla); las demás reglas y el modelo siguen | igual | `fraud_rule_errors_total{rule}` → `RulesEngineErrors` |
| El servicio entero (> 100 ms) | el rules-only del ORQUESTADOR (fuera de esta carpeta) | — | `payments_fraud_check_timeouts_total` → `FraudFallbackActive{cause="caller_timeouts"}` |

`fallback` por segmento (`policy.yaml`): approve en todos salvo `digital_high`, que hace step-up a todo
mientras no haya modelo. Sin 3-D Secure disponible, el step-up se resuelve con otro corte
(`no_3ds_decline`): decline si el score lo pasa, approve si no. Sin modelo Y sin 3-D Secure no hay score
que cortar: decide `fallback_no_3ds` del segmento (decline en `digital_high`, approve en los demás), para
que el "step-up a todo" de `digital_high` no se vuelva un approve a ciegas con las tarjetas sin 3DS.

### El request y la respuesta

`POST /v1/score` — `payment_id`, `merchant_id`, `mcc` (4 dígitos), `amount_cents` (centavos de USD; el
orquestador convierte), `currency`, `card_token` (un PAN con Luhn válido se rechaza con 422 sin
repetirlo), `card_bin_country`, `ip_hash`, `ip_country`, `device_hash`, `email_hash`,
`three_ds_available` (default true), `three_ds_result` (`authenticated` | `failed`, solo en la segunda
llamada). Respuesta: `payment_id`, `decision` (`approve` · `step_up` · `review` · `decline`),
`reason_codes`, `score` (null en rules-only y en la 2.ª llamada), `segment`, `path` (`model` · `rules_only` ·
`three_ds_result`), `groups_defaulted`, `fallback_reason`, `exploration`,
`model_version`, `policy_version`, `feature_set_version`, `latency_ms`, `replayed`.

Reason codes: `APPROVED_LOW_RISK`, `MODEL_MEDIUM_RISK`, `MODEL_HIGH_RISK`, `FALLBACK_RULES_ONLY`,
`MANUAL_REVIEW_DELAYED_CAPTURE`, `EXPLORATION_STEP_UP`, `STEP_UP_UNAVAILABLE`, `STEP_UP_AUTHENTICATED`,
`STEP_UP_FAILED`, `BLOCKLIST_{CARD,DEVICE,IP,EMAIL}`, `VELOCITY_CARD_60S`, `DEVICE_MANY_CARDS_1H`,
`VELOCITY_IP_60S`, `MERCHANT_MAX_TICKET`,
`MERCHANT_BLOCKED_COUNTRY`.

El registro de decisión (tópico `fraud-decisions`) lleva los campos del request (sin PAN), `event_time`
(el reloj del servicio: el mismo que usa el backfill), `features` (las 16, NaN → null; null entero en la
2.ª llamada, que no corre el modelo), `groups_defaulted`,
`rule_hits`, `rule_errors`, `propensity` y los campos de la respuesta. Es la evidencia de una disputa y la
fuente del set de entrenamiento.

### Métricas del servicio (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `fraud_score_requests_total` | status | dashboards |
| `fraud_score_duration_seconds` (histograma, buckets en 0.08 y 0.1) | — | FraudScoreLatencyHigh |
| `fraud_stage_duration_seconds` | stage (`cache`, `counters`, `features`, `rules`, `model`, `cache_put`) | runbook de latencia |
| `fraud_decisions_total` | decision, segment | FraudFallbackActive, DeclineRateSpike, StepUpRateSpike (una por pago: la 1.ª llamada) |
| `fraud_step_up_results_total` | decision, segment | dashboards (qué pasó después de 3-D Secure; aparte para no contar dos veces un pago) |
| `fraud_fallback_total` | reason | FraudFallbackActive |
| `fraud_feature_lookups_total`, `fraud_feature_defaults_total` | group (`sync`, `stream`, `batch`) | FeatureFreshnessLag |
| `fraud_rule_evaluations_total`, `fraud_rule_hits_total{rule,reason}`, `fraud_rule_errors_total{rule}` | | RulesEngineErrors |
| `fraud_blocklist_generated_timestamp_seconds` | — | RulesEngineErrors (`cause="blocklist_stale"`) |
| `fraud_model_score` (histograma) | segment | ScoreDistributionShift |
| `fraud_exploration_total` | segment | dashboards (¿sigue en ≈ 1 %?) |
| `fraud_counter_duplicates_total`, `fraud_idempotent_replays_total` | — | dashboards (reintentos) |
| `fraud_decision_log_dropped_total`, `fraud_decision_cache_errors_total` | — | dashboards (súmale una alerta a la primera si tu set de entrenamiento sale de este tópico) |

Métricas de otros componentes que usan las alertas (no están en esta carpeta):
`fraud_feature_watermark_timestamp_seconds{job}` (gauge propio de los jobs de Flink, no una métrica de
Flink), `fraud_cohort_chargeback_bps{days_since_tx}` (job diario de etiquetas) y
`payments_fraud_check_requests_total` / `payments_fraud_check_timeouts_total` (el orquestador).

### Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Sistema | `FraudScoreLatencyHigh` | p99 server-side > 80 ms (presupuesto interno; SLO 100 ms en el caller), 5 min | page |
| Sistema | `FraudFallbackActive` | > 1 % de decisiones rules-only, o > 0.5 % de timeouts en el orquestador, o sin métricas (`cause`); 5 min | page |
| Sistema | `FeatureFreshnessLag` | watermark de un job de Flink > 5 min atrás, o un job esperado sin watermark (muerto) > 5 min, o > 5 % de lookups stream sin respuesta; 5 min | page |
| Sistema | `RulesEngineErrors` | reglas rotas en > 0.1 % de las evaluaciones, 5 min (page) · lista negra generada hace > 30 h (ticket) | page / ticket |
| Modelo | `DeclineRateSpike` | declines de un segmento en 30 min > 2× la misma hora de la semana pasada y > 0.5 %, o > 1.5 % (tope); ≥ 1 decisión/s; 15 min | page |
| Modelo | `StepUpRateSpike` | step-up > 2× la semana pasada y > 2 %, ≥ 1 decisión/s; 30 min | ticket |
| Modelo | `ScoreDistributionShift` | score medio > 1.5× o < 0.67× la misma hora de la semana pasada, ≥ 1 score/s; 1 h | ticket |
| Negocio | `ChargebackRateRising` | cohorte de hace 30 días > 9 bps (lo esperado a esa edad ≈ 7.2: 12 bps × 0.6); 12 h | ticket |

Dos trampas de estas reglas: un gauge que un job diario expone **una vez** desaparece de las consultas a
los 5 min (lookback) y el `for` nunca se cumple, así que se expone en cada scrape (un test de promtool lo
atrapó de verdad); y en PromQL `and` se evalúa antes que `or`, así que `DeclineRateSpike` necesita
paréntesis (se vio al escribir la regla; sin ellos, el volumen mínimo solo filtra la rama del tope, el
segmento chico del test dispara por la rama de la semana pasada y el test falla: comprobado).

## Correr los tests (sin Redis, sin Kafka, sin Flink)

```bash
cd reference/c09
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 83 tests, < 1 min
pytest -s scoring/tests -k latency                  # imprime p50/p99 de una predicción en TU CPU
python eval/choose_thresholds.py                    # el ejemplo de umbrales por segmento

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 30 s: simula 8 días de series
```

## Demo local del servicio (todo falso salvo el modelo)

```bash
cd reference/c09/scoring
PYTHONPATH=../features uvicorn --factory service:demo_app --port 8080   # entrena el GBDT sintético (≈ 2–8 s según la máquina)
curl -s localhost:8080/readyz
# 6 intentos de la misma tarjeta: el sexto sale decline por VELOCITY_CARD_60S
for i in 1 2 3 4 5 6; do curl -s -X POST localhost:8080/v1/score -H 'content-type: application/json' \
  -d "{\"payment_id\":\"ct-$i\",\"merchant_id\":\"m_shop\",\"mcc\":\"5411\",\"amount_cents\":100,\"currency\":\"MXN\",\"card_token\":\"tok_demo_0001\",\"ip_hash\":\"ip_demo\",\"device_hash\":\"dev_demo\"}"; echo; done
# una tarjeta nueva (tok_new…) con un ticket de US$25: step-up (con US$1 el modelo sintético la aprueba)
NEW='{"payment_id":"new-1","merchant_id":"m_shop","mcc":"5411","amount_cents":2500,"currency":"MXN","card_token":"tok_new_0001","ip_hash":"ip_demo","device_hash":"dev_demo"'
curl -s -X POST localhost:8080/v1/score -H 'content-type: application/json' -d "$NEW}"; echo   # step_up
curl -s -X POST localhost:8080/v1/score -H 'content-type: application/json' -d "$NEW}"; echo   # replayed
# la 2.ª llamada, después del desafío: approve con STEP_UP_AUTHENTICATED, path "three_ds_result"
curl -s -X POST localhost:8080/v1/score -H 'content-type: application/json' \
  -d "$NEW,\"three_ds_result\":\"authenticated\"}"; echo
curl -s localhost:8080/metrics | grep '^fraud_'
```

`demo_app` usa contadores en memoria, un online store falso (0 en las ventanas; `tok_new…` es una tarjeta
y un email recién vistos), la lista negra `{tok_blocked_demo}` y escribe cada registro de decisión en
stdout. El modelo es un GBDT de sklearn entrenado con datos sintéticos: los scores no significan nada.

## Desplegar (resumen)

Faltan los adaptadores reales, que no se publican porque no se pudieron probar aquí: `CounterStore`
(Redis Cluster: un script Lua por entidad con hash tag `{card:…}` que lee la ventana, hace
`SET guard <valores> NX EX` y, si es nuevo, `INCRBY`/`SADD` + `EXPIRE`; redis-py async con pipeline),
`FeatureFetcher` (online store: lectura de las features stream y batch, 0 cuando la entidad existe pero
no hay llave), `DecisionCache` (Redis `SET EX`), `DecisionLog` (productor de Kafka con `acks=all` e
idempotencia, tópico `fraud-decisions`) y la carga de la lista negra desde el artefacto nocturno.
El modelo se carga con `SklearnModel.load(ruta, sha256, versión)` desde el registry; en producción, un
LightGBM/XGBoost en su formato nativo. Pon `OMP_NUM_THREADS=1` en el contenedor además del límite del
executor. Variables: `BUDGET_MS` (80), `CACHE_TIMEOUT_MS` (5), `COUNTERS_TIMEOUT_MS` (20),
`FEATURES_TIMEOUT_MS` (25), `MODEL_TIMEOUT_MS` (10), `DECISION_CACHE_TTL_S` (900), `POLICY_PATH`,
`DECISIONS_TOPIC` (`fraud-decisions`), `MODEL_WORKERS` (2). `/healthz` (liveness: no depende de Redis
ni del modelo) y `/readyz` (política + modelo cargado y calentado; Redis caído NO saca al pod).
La imagen copia `scoring/` y `features/definitions.py` + `features/online_counters.py`.

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon, 10 cores), sin Redis, sin Kafka, sin Flink y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 3 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.15 y 3.12.14 | 83 passed en los dos |
| Paridad online == offline (de la DEFINICIÓN) | 1,500 pagos sintéticos con reintentos, faltantes y ráfagas, en serie, por `OnlineCounters` (fake de un hilo, un reloj) y por `point_in_time.py`: las 10 features por ventana, valor por valor; también con `include_current=True` | iguales; el `BETWEEN` "ingenuo" difiere en el 100 % de las filas. No prueba que producción haya visto esos valores (lag del watermark, orden de scripts concurrentes en Redis, contadores con timeout): para pagos ya scoreados, el set usa el snapshot del log (`use_logged_features=True`, con su test) |
| Servicio con fakes | TestClient con un event loop persistente: KV store lento o caído, online store lento, sin stream o sin batch, modelo lento, con error, con score 1.7 o sin cargar, caché caída, reintentos, segunda llamada después de 3DS, PAN en `card_token` | cada caso sale por el modo esperado y en < 100 ms de reloj; el PAN no aparece ni en la respuesta ni en el log |
| Latencia del GBDT | 500 predicciones de 1 fila en un thread, con y sin `threadpool_limits(1)` en el `initializer` del executor | 1 thread: p50 ≈ 0.3–0.5 ms, p99 < 1 ms; OpenMP por defecto (10 threads): p50 ≈ 1.5–4 ms, p99 de 2 a 30 ms según la carga de la máquina. Limitar solo el thread principal no cambia nada (p50 ≈ 1.45 ms en el executor) |
| Demo con uvicorn real | `uvicorn --factory service:demo_app` + los curl de arriba | el sexto intento de una tarjeta en segundos sale `VELOCITY_CARD_60S`; tarjeta nueva con US$25 → step-up (score ≈ 0.07) → con `authenticated` → approve sin re-scorear; lista negra → decline; reintento → `replayed`; PAN → 422; ≈ 1 ms por request en el servicio |
| Umbrales | contra el cálculo a mano; grilla vs regla de Bayes con scores calibrados; el tope de declines cuesta y se ve | `policy.yaml` coincide con `bayes_thresholds()` al ticket típico (un test lo exige) |
| Madurez de etiquetas | 600,000 pagos sintéticos con 60 % de chargebacks a 30 días y 90 % a 60 | la curva recupera 0.60 y 0.90; usar cohortes jóvenes infla la curva a 30 días en ≈ 7 puntos |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 21 reglas OK; los tests de las 8 alertas pasan (≈ 35 s); 17 mutaciones (cada umbral al otro lado de las series del test, el volumen mínimo, la rama `absent`, la rama `watermark_missing` de un job muerto) hacen fallar algún test |
| Lock de dependencias | `uv pip compile` para Linux x86_64 y Python 3.13 | 25 paquetes; el mismo resultado para macOS arm64 |

**No verificado** (requiere Redis, Kafka, Flink, un cluster o datos reales):

- No hay adaptadores reales de Redis, del online store, de la caché ni de Kafka: el script Lua por
  entidad está descrito, no escrito ni probado. La atomicidad del fake es trivial (un hilo).
- Las latencias por etapa (online store p99 ≤ 10 ms, timeouts de 20 y 25 ms) son estimaciones del caso. Lo único
  medido es el GBDT sintético en una Mac, que no es el pod ni el modelo de ≈ 300 features.
- No hay Dockerfile ni manifests de Kubernetes para `fraud-scoring` (el patrón de imagen es el del c01;
  el caso pide ≈ 3 × c7i.2xlarge por zona). No se construyó ninguna imagen.
- `point_in_time.py` corre en pandas sobre miles de filas; en producción es un job de Spark/SQL sobre el
  lake, no medido a escala. El distinct exacto es O(n · ventana).
- El modelo es sintético (≈ 1.4 % de fraude, 16 features): sirve para probar el servicio, no dice nada de
  la calidad de un modelo real. Costos, umbrales, límites duros, `fallback` por segmento y umbrales de
  las alertas son ilustrativos.
- Los jobs de Flink, de drift y de etiquetas, el orquestador y kafka_exporter no existen aquí: sus
  métricas solo están en los tests de promtool.

No incluidos a propósito (se describen en el caso): los jobs de Flink, el entrenamiento y el registry,
el challenger en shadow, el cálculo de contribuciones por feature (SHAP) para los reason codes del
modelo, el adaptador de 3-D Secure y el rules-only del orquestador.
