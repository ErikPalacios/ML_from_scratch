# Caso c10 — archivos de referencia (servir un LLM propio a escala)

Archivos **reales** del caso c10 de *Ronda de Diseño ML*: la cuenta de VRAM y KV cache, la de la flota y el costo
contra el vendor, el lector del barrido de `vllm bench serve`, el `llm-gateway` (API compatible con OpenAI con
cuotas en tokens, admisión por prioridad, alias, streaming SSE, fallback gobernado al vendor con redacción de
PII y métricas), el manifest de `vllm-70b` para EKS, el runner de golden sets con juez pareado y gate, y las 8
alertas con sus tests. Cada archivo está comentado explicando **por qué**.

Los números (60 rps de diseño, ≈ 2,000 tokens de prompt y ≈ 250 de salida, 2 × H100 por réplica, ≈ 6 rps por
réplica medidos y planeados al 70 %, 16 réplicas en 4 × p5.48xlarge, ≈ US$160.6k/mes contra ≈ US$442.5k/mes del
vendor) son los del caso y son **estimaciones**. Los umbrales y defaults que no vienen del caso son
**ilustrativos**: están marcados así en cada archivo.

## Estructura

```
c10/
├── capacity/
│   ├── vram_calc.py         # pesos + KV por token → lugar para KV por réplica (TP, gpu_memory_utilization) → secuencias
│   ├── fleet_calc.py        # tráfico → réplicas → nodos de 8 GPUs → US$/mes contra la factura del vendor y el break-even
│   └── tests/               # test_vram_calc.py (19: reproduce #m04 y el caso), test_fleet_calc.py (14)
├── bench/
│   ├── run_sweep.sh         # el barrido de `vllm bench serve` con la mezcla del caso (NO ejecutado: no hay GPU)
│   ├── pick_concurrency.py  # lee los JSON del barrido y elige la concurrencia máxima dentro de los SLOs
│   └── tests/               # test_pick_concurrency.py (12) + fixtures/ SINTÉTICOS con las claves reales de vLLM v0.30.0
├── gateway/
│   ├── llm_gateway.py       # FastAPI: /v1/chat/completions (stream y no stream), /v1/models, /metrics, /healthz
│   ├── quota.py             # token bucket en tokens/min con cobro estimado y conciliación con usage
│   ├── admission.py         # tope de requests en vuelo, interactive > batch, lugares reservados, colas acotadas
│   ├── pii.py               # redacción por regex antes del vendor (y sus límites, escritos)
│   ├── tenants.yaml         # tenants, alias, upstreams y límites (validado al arrancar)
│   ├── requirements.txt     # lock completo (21 paquetes)
│   └── tests/               # test_llm_gateway.py (25), test_admission.py (8), test_pii.py (8), test_quota.py (6)
├── k8s/
│   └── vllm-70b.yaml        # Service, Deployment (16 × 2 GPUs, init container que baja y verifica pesos), PDB,
│                            #   NetworkPolicy, PodMonitor
├── eval/
│   ├── golden_eval.py       # extracción (JSON válido, F1 por campo), juez pareado con cambio de posición, Wilson, gates
│   └── tests/               # test_golden_eval.py (10)
├── monitoring/
│   ├── alerts.yml           # 8 alertas (11 reglas) + 9 recording rules
│   └── alerts_test.yml      # tests de promtool
├── pytest.ini               # `pytest` desde aquí corre las 4 carpetas
└── requirements-dev.txt     # gateway/requirements.txt + pytest
```

## Orden de lectura sugerido

1. `capacity/vram_calc.py` — el docstring: de 70.6 B parámetros a "≈ 92 conversaciones a la vez por réplica".
2. `capacity/fleet_calc.py` — de 60 rps a 4 nodos y US$160.6k/mes, y por qué el vendor gana debajo de ≈ 1/3 del
   volumen.
3. `bench/pick_concurrency.py` y `bench/run_sweep.sh` — de dónde sale el "≈ 6 rps por réplica" (se mide).
4. `gateway/llm_gateway.py` — el docstring (un request de punta a punta, los códigos) y después `quota.py`,
   `admission.py` y `pii.py`. Luego `test_llm_gateway.py`: cada test es una situación de operación.
5. `k8s/vllm-70b.yaml` — los args de `vllm serve` uno por uno, el init container de pesos y el apagado.
6. `eval/golden_eval.py` y `monitoring/alerts.yml` — cómo se decide si una revisión entra y qué despierta a alguien.

## Un request de punta a punta

```
t = 0       soporte manda POST /v1/chat/completions {model: "chat-default", stream: true, max_tokens: 512}
            con su API key al llm-gateway
+ < 1 ms    key → sha256 → tenant support-assistant (interactive, 5.4 M tokens/min, tope 1,024, sin vendor)
            validación: alias permitido, n = 1, max_tokens ≤ 1,024, prompt estimado ≤ 6,000
            cuota: cobra ≈ 2,000 (prompt estimado) + 512 del token bucket de esta réplica (5.4 M ÷ 4 por minuto)
+ ≤ 0.5 s   admisión: un lugar interactivo de los 160 de esta réplica, o cola (≤ 64, ≤ 0.5 s), o 503 + Retry-After
            → upstream vllm-70b con model = chat-70b-fp8-2026-09-28, priority = 0,
              stream_options.include_usage = true
+ ≈ 0.3–1 s vLLM: prefix cache del system prompt, prefill troceado del resto, primer token
            el gateway espera el PRIMER evento (≤ 10 s): hasta acá una falla todavía es un 502/504 limpio
            TTFT = desde que el request llegó al gateway hasta el primer evento con contenido
cada ≈ 40 ms un evento SSE por token, reenviado apenas llega (TPOT p95 ≤ 50 ms)
fin         [DONE]; el chunk de usage que pidió el gateway no se reenvía (el cliente no lo pidió)
            cierre: libera el lugar, concilia la cuota con usage (devuelve lo cobrado de más), métricas y una línea
            de log sin prompt ni respuesta
si el cliente se va: se cierra la conexión con vLLM (vLLM aborta y libera el KV), status 499 en las métricas
```

Medido con la demo (upstream falso, uvicorn real, macOS): el stream llega evento por evento, `/metrics` cuenta
el request y los tokens, y un `curl --max-time 0.5` que corta un stream de 200 palabras queda como `499` con
`llm_gateway_inflight` de vuelta en 0.

### Códigos del gateway

| Código | Cuándo | Qué hace el cliente |
|---|---|---|
| 400 | JSON inválido, `messages` vacío, `n` ≠ 1, `max_tokens` sobre el tope, prompt estimado sobre el tope | corregir el request |
| 401 | API key inválida | — |
| 403 | el alias existe pero el tenant no puede usarlo | — |
| 404 | el alias no existe | — |
| 429 + Retry-After | cuota de tokens/min del tenant agotada (su límite) | esperar lo que dice Retry-After |
| 503 + Retry-After | plataforma llena: cola llena o se esperó más de 0.5 s (interactive) / 30 s (batch) | reintentar con backoff; degradar |
| 502 / 504 | vLLM no responde / no da el primer evento a tiempo (y el tenant no tiene vendor) | degradar |
| 4xx del upstream | p. ej. prompt más largo que el contexto (vLLM) | corregir el request |
| 200 + evento `error` | el upstream falló con el stream ya empezado (`stream_error` en métricas) | mostrar lo recibido + error |

### Métricas del gateway (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `llm_gateway_requests_total` | tenant, alias, status (código, `499`, `stream_error`) | LLMGatewayErrorRate |
| `llm_gateway_tokens_total` | tenant, direction (`input`/`output`), backend (`self`/`vendor`) | showback por tenant, factura del vendor |
| `llm_gateway_ttft_seconds` (histograma, borde en 1.0) | alias, priority, backend | LLMTTFTHigh |
| `llm_gateway_tpot_seconds` (histograma, borde en 0.05) | alias, priority, backend | LLMTPOTHigh |
| `llm_gateway_queue_depth` (gauge) | priority | LLMQueueBacklog |
| `llm_gateway_inflight` (gauge) | priority | LLMCapacityHeadroomLow |
| `llm_gateway_max_inflight` (gauge) | — | LLMCapacityHeadroomLow |
| `llm_gateway_vendor_requests_total` | tenant, reason (`overloaded`, `upstream_error`, `upstream_timeout`) | costo del fallback |
| `llm_gateway_pii_redactions_total` | kind (`EMAIL`, `PHONE`, `CARD`, `CLABE`, `CURP`, `RFC`) | auditoría de lo que sale |

Métricas de vLLM que usan las alertas (v0.30.0): `vllm:time_to_first_token_seconds`, `vllm:num_requests_waiting`,
`vllm:num_requests_running`, `vllm:kv_cache_usage_perc` (antes `vllm:gpu_cache_usage_perc`, que no existe
desde v0.12), `vllm:num_preemptions_total` y `vllm:request_success_total`. De otros servicios (no están aquí):
`batch_runner_items_remaining`, `batch_runner_items_completed_total`, `llm_golden_score{tenant,track}` y
`llm_golden_items{tenant,track}`.

### Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Experiencia | `LLMTTFTHigh` | TTFT p95 en el gateway > 1 s (interactivo, flota propia), 10 min | page |
| Experiencia | `LLMTPOTHigh` | TPOT p95 > 50 ms, 10 min | page |
| Experiencia | `LLMGatewayErrorRate` | (5xx + `stream_error`) ÷ requests sin 499 > 1 %, 10 min; los 429 de cuota no cuentan | page |
| Flota | `LLMQueueBacklog` | cola interactiva de una réplica del gateway > 32, 5 min (page); el batch no termina antes de las 06:00 CDMX al ritmo actual, 15 min (ticket) | page / ticket |
| Flota | `KVCacheSaturation` | KV > 95 % **y** requests esperando en el mismo pod, 15 min, de 06:00 a 22:00 CDMX | ticket |
| Flota | `LLMPreemptionsRising` | preemptions ÷ requests terminados > 5 %, 15 min, de 06:00 a 22:00 CDMX | ticket |
| Flota | `LLMCapacityHeadroomLow` | lugares en vuelo > 85 % (15 min), menos de 15 réplicas sirviendo (10 min), o sin métricas de vLLM | page |
| Modelo | `CanaryEvalRegression` | canario > 2 puntos debajo del estable en el mismo golden set, con ≥ 300 items, 30 min | ticket |

Por qué KV y preemptions solo de día: de noche el batch llena la flota a propósito; KV al 100 % es la flota bien
usada, no un problema.

## Correr los tests (sin GPU, sin vLLM, sin vendor)

```bash
cd reference/c10
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 102 tests, ≈ 3 s
python capacity/vram_calc.py                        # la cuenta de VRAM del caso y la de la L4 de #m04
python capacity/fleet_calc.py                       # flota, costo, Little, batch nocturno y break-even
python bench/pick_concurrency.py bench/tests/fixtures/sweep-c*.json   # elige 72 → ≈ 6.1 rps (datos sintéticos)
python eval/golden_eval.py                          # el ejemplo de extracción y los intervalos de Wilson

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 3 s: simula hasta 15 h de series
```

## Demo local del gateway (vLLM falso)

```bash
cd reference/c10/gateway
uvicorn --factory llm_gateway:demo_app --port 8080
# otra terminal: streaming con la key de demo de soporte
curl -sN localhost:8080/v1/chat/completions -H 'Authorization: Bearer sk-c10-demo-support' \
  -H 'content-type: application/json' \
  -d '{"model":"chat-default","messages":[{"role":"user","content":"hola"}],"stream":true,"max_tokens":5}'
curl -s localhost:8080/metrics | grep '^llm_gateway_'
# cortar un stream a la mitad: arranca la demo con DEMO_WORDS=200 y usa curl --max-time 0.5 → status 499
```

`demo_app` usa `fake_vllm_handler` (palabras numeradas con la forma de la API de OpenAI; NO es un modelo) detrás
de `httpx2.MockTransport`. Las keys de demo (`sk-c10-demo-support`, `sk-c10-demo-listings`,
`sk-c10-demo-catalog`) solo existen como hashes en `tenants.yaml`.

## Desplegar (resumen)

- **vllm-70b**: `kubectl apply -f k8s/vllm-70b.yaml` en el namespace `c10`, con nodos p5.48xlarge (capacidad
  reservada), la ServiceAccount `vllm-weights-reader` con lectura sobre el prefijo de modelos, los pesos de la
  revisión en S3 junto a su `SHA256SUMS` y el sha256 de ese manifiesto escrito en el YAML por el pipeline de
  release (el del archivo es un placeholder). Prometheus Operator para el PodMonitor.
- **llm-gateway** (no hay manifest aquí): imagen con `llm_gateway.py`, `quota.py`, `admission.py`, `pii.py` y
  `tenants.yaml`; `uvicorn --factory llm_gateway:app_from_env`, variables `GATEWAY_CONFIG` (ruta a
  `tenants.yaml`) y `VENDOR_API_KEY` (de un Secret); 4 réplicas en CPU (las cuotas se dividen por
  `gateway_replicas`), label `app.kubernetes.io/name: llm-gateway` (lo exige la NetworkPolicy de vLLM).

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon), sin GPU, sin vLLM, sin vendor, sin cluster y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 4 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.15 y 3.12.14; varias corridas seguidas; warnings como errores | 102 passed, todas las veces |
| Cuentas de capacidad | tests contra los números de #m04 (128 KiB y 320 KiB por token, ≈ 16 GB y ≈ 141 GB en BF16, la L4 con 3 secuencias de 8k) y del caso (≈ 68.4 GB, 92 secuencias, 16 réplicas, US$160.6k, US$442.5k, 630 secuencias vivas) | coinciden |
| Gateway | `httpx2.ASGITransport` contra la app y upstreams falsos con `httpx2.MockTransport` (el cliente HTTP real del gateway corre entero); la desconexión del cliente, llamando al ASGI a mano | auth, alias, topes, cuotas, prioridad, 503, fallback con redacción y lista permitida de campos, reintento solo ante ConnectError, 502/504, 4xx reenviados, error a mitad del stream, desconexión con stream y sin stream (upstream cerrado, lugar liberado, 499) |
| Demo con uvicorn real | `uvicorn --factory llm_gateway:demo_app` + curl | streaming, no streaming, 403, `/metrics`; un `curl --max-time 0.5` que corta el stream queda como 499 con el lugar liberado |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 20 reglas OK; los tests pasan. 17 mutaciones de umbrales, filtros, ventanas horarias y ramas hacen fallar algún test (ninguna sobrevive) |
| Manifest | `kubernetes-validate --strict` (Kubernetes 1.36) sobre Service, Deployment, PodDisruptionBudget y NetworkPolicy; `jsonschema` en modo estricto contra el CRD de PodMonitor (Prometheus Operator v0.94.1) | OK; un campo mal escrito en cada uno se rechaza |
| Flags y métricas de vLLM | leídos del código fuente de vLLM v0.30.0 (`vllm/engine/arg_utils.py`, `vllm/v1/metrics/loggers.py`, `vllm/benchmarks/serve.py`) | los nombres de los archivos coinciden con esa versión |
| Lint | `ruff check` (E, F, W, B, UP) y `shellcheck` 0.11.0 sobre `run_sweep.sh` | sin hallazgos |
| Lock de dependencias | `uv pip compile` para Linux x86_64 y Python 3.13 | 21 paquetes |

**No verificado** (requiere GPU, vLLM corriendo, el vendor o un cluster):

- **vLLM no corrió.** Ni el manifest, ni los args de `vllm serve` contra un modelo real, ni `run_sweep.sh`. Que el
  70B en FP8 entre en 2 × H100 con ≈ 68 GB para KV y que una réplica dé ≈ 6 rps de esta mezcla son las
  estimaciones del caso: se confirman con el log de arranque de vLLM ("GPU KV cache size: N tokens") y con el
  barrido. Los fixtures de `bench/` son sintéticos.
- **El apagado con `--shutdown-timeout`** (drena lo que está en vuelo al recibir SIGTERM) se leyó en el código
  de v0.30.0; no se probó que los streams en curso lleguen completos al cliente durante el drain. Pruébalo en
  staging antes de confiar en él.
- **El init container** (`aws s3 sync` + `sha256sum -c`) no corrió; la imagen de aws-cli trae `sha256sum`
  (Amazon Linux 2023) según su historial de capas, no porque se haya ejecutado. El sha256 del manifiesto es un
  placeholder. Correr como UID 2000 sale del Dockerfile de vLLM; no se probó.
- **El vendor real** no se llamó: el fallback se probó contra un upstream falso con la forma de la API de
  OpenAI. Los nombres `vendor-mid-tier` y `llm-vendor.example.com` son placeholders.
- **La redacción de PII** se probó con ejemplos escritos a mano. Su recall con prompts reales es desconocido:
  hay que medirlo con una muestra etiquetada (el docstring de `pii.py` dice qué no detecta).
- **El juez** de `golden_eval.py` es una interfaz; los tests usan jueces falsos con sesgos programados. El
  acuerdo con humanos (kappa) se mide con una muestra de calibración que aquí no existe.
- **Estado compartido**: cuotas y admisión viven en la memoria de cada réplica del gateway (cada una aplica
  cuota ÷ 4). En producción la cuota va a un store compartido (Redis-class); la elección de réplica por
  afinidad de conversación o por carga (que el caso recomienda) tampoco está: la referencia usa el Service de
  Kubernetes.
- El batch-runner, el job de evaluación que publica `llm_golden_*` y el manifest del gateway no existen aquí.
  Los umbrales de las alertas son ilustrativos.
