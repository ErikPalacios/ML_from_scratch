# Caso c13 — archivos de referencia (captions en vivo en videollamadas)

Archivos **reales** del caso c13 de *Ronda de Diseño ML*: el chunker de audio (frames de 20 ms → chunks
de 160 ms, VAD por energía, endpointing), el estabilizador de partials, el `asr-worker` (WebSocket con
backpressure, límites por sesión, drain y métricas), el session router (capacidad, sticky, drain, pérdida
de un worker, rebalanceo), el WER con normalización para español y los percentiles de latencia, el
manifest de Kubernetes con preStop y autoscaling por streams activos, y las 8 alertas con sus tests.
Cada archivo está comentado explicando **por qué**.

Los números (160 ms por chunk, 600 ms de endpointing, ≈ 500 streams por L4 planeados al 70 % = 350,
≈ 60k streams en el pico, p95 de partials ≤ 500 ms y de finales ≤ 1.5 s) son los del caso y son
**estimaciones**. Los umbrales y defaults que no vienen del caso son **ilustrativos**: están marcados así
en cada archivo.

## Estructura

```
c13/
├── streaming/
│   ├── chunker.py           # Reframer (bytes → frames de 20 ms), EnergyVAD (piso adaptativo, onset, hangover),
│   │                        #   StreamChunker (chunks de 160 ms con contexto izquierdo, pre-roll, endpointing, tope)
│   ├── stabilizer.py        # congela palabras de más de 800 ms; tasa de revisiones (flicker)
│   └── tests/               # test_chunker.py (12 tests, señales sintéticas), test_stabilizer.py (5)
├── server/
│   ├── asr_server.py        # FastAPI WebSocket /v1/stream: handshake, VAD + chunking, modelo (interfaz + fake),
│   │                        #   partial/final JSON, colas acotadas, límites, drain, /metrics, CLI drain y demo-client
│   ├── requirements.txt     # lock completo (19 paquetes)
│   └── tests/test_asr_server.py   # 20 tests con TestClient (WebSocket real en proceso) y fakes
├── gateway/
│   ├── session_router.py    # asignación por capacidad (spread/pack), sticky, drain, worker perdido, rebalanceo
│   └── tests/test_session_router.py   # 10 tests
├── eval/
│   ├── wer.py               # WER (Levenshtein con S/D/I), normalización en español, corpus y slices, percentiles
│   └── tests/test_wer.py    # 29 tests con casos calculados a mano
├── k8s/
│   └── asr-worker.yaml      # Service headless, Deployment GPU con preStop y gracia de 90 s, PDB, PodMonitor,
│                            #   ScaledObject (streams activos + cron de la mañana + fallback)
├── monitoring/
│   ├── alerts.yml           # 8 alertas + 9 recording rules
│   └── alerts_test.yml      # tests de promtool
├── pytest.ini               # `pytest` desde aquí corre las 4 carpetas
└── requirements-dev.txt     # server/requirements.txt + pytest + httpx2
```

## Orden de lectura sugerido

1. `streaming/chunker.py` — el docstring (por qué VAD, por qué 600 ms, límites del VAD por energía) y
   `StreamChunker.feed()`: cuándo se abre y se cierra una utterance y qué viaja al modelo.
2. `streaming/stabilizer.py` — el ejemplo del docstring ("el gato" → "el pato se" → …).
3. `server/asr_server.py` — `StreamSession`: tres tareas (leer, procesar, escribir) conectadas por colas
   acotadas; qué se descarta y qué nunca; el drain. Después `test_asr_server.py`: cada test es una situación.
4. `gateway/session_router.py` — las 6 reglas del docstring.
5. `k8s/asr-worker.yaml` — el presupuesto del período de gracia y el ScaledObject.
6. `eval/wer.py` y `monitoring/alerts.yml` — cómo se mide la calidad y qué despierta a alguien.

## Una utterance de punta a punta

```
t = 0         Ana empieza a hablar. Su cliente manda Opus (frames de 20 ms) al SFU
+ ≈ 80 ms     el fork de audio del SFU decodifica, remuestrea a 16 kHz mono y manda PCM16 de 20 ms (640 bytes)
              (en producción al asr-gateway; en esta referencia, directo al WebSocket del asr-worker)
+ 40 ms       el VAD ve 2 frames seguidos con voz (onset) → abre la utterance 0 con 100 ms de pre-roll
+ ≤ 160 ms    8 frames → Chunk(seq 0) → cola de entrada (≤ 12 chunks) → model.step() → estabilizador →
              {"type":"partial","utterance":0,"text":"hol","stable_words":0,"start_ms":140,"end_ms":300,"seq":1}
cada 160 ms   un partial nuevo; las palabras que terminaron hace > 800 ms de audio se congelan (stable_words)
              y ya no cambian en pantalla. Si el modelo va atrás, se procesa todo pero solo sale el último partial
fin de voz    último frame con voz cruda → speech_end_ms
+ 600 ms      silencio de endpointing → EndOfUtterance → model.finalize() →
              {"type":"final","utterance":0,"text":"…","start_ms":140,"end_ms":2360,"seq":15}
              asr_final_latency_seconds mide desde el último frame con voz: los 600 ms + el paso final
```

Medido con la demo (modelo falso con 30 ms por paso, un solo stream, macOS): partials p50 ≈ 30 ms y
finales ≈ 0.81 s server-side (los 600 ms de silencio, que el cliente de la demo manda un poco más lento que
el tiempo real, más el último paso). Con el modelo real, el paso y la cola dominan los partials: mídelo.

### El protocolo del WebSocket (`/v1/stream`)

| Dirección | Mensaje | Para qué |
|---|---|---|
| cliente → server | `{"type":"start","session_id","language","sample_rate":16000,"encoding":"pcm_s16le","reconnect_attempt":0,"reconnect_reason":null}` | primer mensaje, en ≤ 5 s; `language` ∈ `es-419`, `en-US`, `pt-BR` |
| cliente → server | binario: PCM16 little-endian, 16 kHz, mono (cualquier tamaño; se re-encuadra a 20 ms) | el audio |
| cliente → server | `{"type":"stop"}` | cierra la utterance abierta (sale su final) y la sesión |
| server → cliente | `{"type":"ready","session_id","model_version","chunk_ms","max_session_s"}` | handshake aceptado |
| server → cliente | `{"type":"partial","utterance","seq","text","stable_words","start_ms","end_ms"}` | hipótesis en curso: las primeras `stable_words` palabras no cambian más |
| server → cliente | `{"type":"final","utterance","seq","text","start_ms","end_ms"}` | texto final de la utterance (nunca se descarta) |
| server → cliente | `{"type":"migrate","reason":"draining"}` + cierre 1012 | el worker drena: reabrir en otro (entre utterances, sin perder texto) |
| server → cliente | `{"type":"error","code","message"}` + cierre | `bad_handshake` (1008), `capacity`/`draining`/`overloaded` (1013), `internal` (1011) |

`seq` crece en toda la sesión: el consumidor descarta duplicados y desordenados. Los tiempos (`start_ms`,
`end_ms`) son de audio, desde el inicio de la sesión.

### Códigos de cierre

| Código | Cuándo | Qué hace el gateway |
|---|---|---|
| 1000 | `stop`, `MAX_IDLE_S` (30 s sin un frame), `MAX_SESSION_S` (4 h) | nada (o reabre si la reunión sigue: `reconnect_reason=max_duration`) |
| 1008 | handshake inválido | no reintentar igual: es un bug del cliente |
| 1011 | el modelo falló en esa sesión | reabrir en otro worker |
| 1012 | drain (después de `migrate`) o SIGTERM de uvicorn | reabrir en otro worker (`migrate` es planeado) |
| 1013 | worker lleno, drenando, ≈ 2 s atrás del tiempo real, o consumidor que no lee | reabrir en otro worker |

### Métricas del asr-worker (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `asr_active_streams` (gauge) | — | KEDA (objetivo 350 por pod), ASRCapacityHeadroomLow |
| `asr_stream_capacity` (gauge: `MAX_STREAMS`, 0 si drena) | — | ASRCapacityHeadroomLow |
| `asr_draining` (gauge) | — | dashboards |
| `asr_sessions_started_total` | language | SessionReconnectRateHigh |
| `asr_sessions_ended_total` | reason (`normal`, `idle`, `max_duration`, `client_gone`, `migrate`, `overloaded`, `slow_consumer`, `error`) | dashboards |
| `asr_sessions_rejected_total` | reason (`bad_handshake`, `capacity`, `draining`) | runbook de capacidad |
| `asr_reconnects_total` | reason (`worker_lost`, `network`, `migrate`, `max_duration`, `overloaded`, `unknown`) | SessionReconnectRateHigh |
| `asr_partial_latency_seconds` (histograma, bucket en 0.2) | language | CaptionPartialLatencyHigh |
| `asr_final_latency_seconds` (histograma, bucket en 1.2) | language | CaptionFinalLatencyHigh |
| `asr_model_step_seconds` (histograma, bucket en 0.128) | — (Prometheus agrega `pod`) | GPUStreamSaturation |
| `asr_dropped_messages_total` | type, reason (`behind`, `slow_consumer`) | runbook de latencia |
| `asr_vad_frames_total` | decision (`speech`, `silence`) | VADActiveRatioShift |

Métricas de otros servicios que usan las alertas (no están en esta carpeta): `caption_delivery_lag_seconds`
(caption-bus → WebSocket de la reunión) y `asr_golden_wer` / `asr_golden_ref_words` con labels `language`
y `track` (`stable` | `canary`), que publica vía Pushgateway el job que pasa el audio dorado por las dos
versiones cada 30 min (con `eval/wer.py`).

### Las 8 alertas

| Grupo | Alerta | Umbral | Severidad |
|---|---|---|---|
| Sistema | `CaptionPartialLatencyHigh` | p95 server-side de partials > 200 ms por idioma, 10 min | page |
| Sistema | `CaptionFinalLatencyHigh` | p95 server-side de finales > 1.2 s por idioma, 10 min | page |
| Sistema | `GPUStreamSaturation` | p95 del paso del modelo de un pod > 128 ms (80 % del chunk), 5 min | page |
| Sistema | `SessionReconnectRateHigh` | reconexiones no planeadas > 2 % de los handshakes (ventana de 10 min), 15 min | page |
| Sistema | `CaptionDeliveryLag` | p95 de entrega del caption-bus > 250 ms, 10 min | page |
| Sistema | `ASRCapacityHeadroomLow` | streams activos ÷ capacidad que acepta > 85 %, o los workers sin métricas (`cause="no_metrics"`); 10 min | page |
| Modelo | `CanaryWERRegression` | WER del canario > estable + 1 punto en el mismo audio dorado, con ≥ 5,000 palabras; 30 min | ticket |
| Modelo | `VADActiveRatioShift` | fracción de voz < 0.7× o > 1.3× la misma hora de la semana pasada, 1 h | ticket |

Por qué 200 ms y no 500: las métricas del worker miden solo el tramo del server. El presupuesto estimado
del partial es uplink ≈ 80 ms + fork y remuestreo ≈ 20 + llenar el chunk ≤ 160 + server ≤ 150 +
bus, WebSocket y render ≈ 90 ≈ 500 ms. A 200 ms en el server, el SLO de punta a punta ya se rompió.

## Correr los tests (sin GPU, sin modelo, sin SFU)

```bash
cd reference/c13
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 76 tests, ≈ 7 s
python eval/wer.py                                  # los ejemplos del docstring: normalización y corpus

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 16 s: simula hasta una semana y 5 h de series
```

## Demo local (modelo falso)

```bash
cd reference/c13/server
PYTHONPATH=../streaming uvicorn --factory asr_server:demo_app --port 8080
# otra terminal:
PYTHONPATH=../streaming python asr_server.py demo-client       # ≈ 5 s de audio sintético a ritmo real
curl -s localhost:8080/metrics | grep '^asr_'
# drain (lo mismo que hace el preStop), con el demo-client hablando en otra terminal:
PORT=8080 PYTHONPATH=../streaming python asr_server.py drain   # espera el final, el cliente recibe migrate + 1012
```

`demo_app` usa `FakeStreamingASR` (una palabra por chunk, 30 ms por paso; NO es un modelo) y loguea la
latencia de cada mensaje (`LATENCY_LOG_RATE=1.0`), que `eval/wer.py:read_latency_log` convierte en
percentiles.

## Desplegar (resumen)

`build_app()` lanza `NotImplementedError` hasta conectar un `ASRModel` real: un cliente de NVIDIA Riva
(streaming por gRPC), un modelo cache-aware de NeMo cargado en el proceso o Triton con sequence batching
(con una secuencia por utterance: la caché de GPU vive entre el primer `step()` y `finalize()`). La imagen
copia `asr_server.py`, `chunker.py` y `stabilizer.py` a `/app` (el preStop corre
`python /app/asr_server.py drain`). Variables: `ASR_LANGUAGES` (`es-419,en-US,pt-BR`), `MAX_STREAMS` (450),
`MAX_SESSION_S` (14400), `MAX_IDLE_S` (30), `HANDSHAKE_TIMEOUT_S` (5), `INBOUND_MAX_CHUNKS` (12),
`OUTBOUND_MAX_MESSAGES` (32), `FREEZE_AFTER_MS` (800), `DRAIN_TIMEOUT_S` (60), `LATENCY_LOG_RATE` (0.01),
`CHUNK_MS` (160), `LEFT_CONTEXT_MS` (0), `ENDPOINT_SILENCE_MS` (600), `MAX_UTTERANCE_MS` (20000), `PORT`
(8080, para el preStop) y `MODEL_VERSION` (la lee el adaptador real). `/healthz` (liveness), `/readyz`
(503 mientras drena), `/admin/drain` y `/admin/status` solo desde localhost.

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon), sin GPU, sin modelo de ASR, sin SFU, sin cluster y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 4 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.15 y 3.12.14; 6 corridas seguidas en cada uno | 76 passed, todas las veces |
| Chunker y VAD | señales sintéticas (tono de -23 dBFS, ruido de -70 y -40 dBFS, silencio) con tiempos calculados a mano | onset, hangover, pre-roll, endpoint a 600 ms, tope de 20 s sin duplicar audio, piso que se adapta a un ruido nuevo en ≈ 10 s |
| asr-worker | TestClient (WebSocket en proceso): camino feliz, handshakes inválidos, worker lleno, reconexión, inactividad, duración máxima, drain con una sesión callada y una hablando, GPU atrasada, modelo que falla, consumidor lento (transporte falso) | cada caso cierra con el código y el motivo esperados; el estado del modelo se libera siempre |
| Contrato de métricas | un test lee `alerts.yml` y exige que cada `asr_*` del worker exista en `/metrics` | OK |
| Demo con uvicorn real | `uvicorn --factory asr_server:demo_app` + `demo-client` (websockets 17.1) + curl a `/readyz` y `/metrics` | 25 partials y 2 finales; percentiles con `wer.py` desde el log: partial p50 ≈ 30 ms, finales ≈ 0.81 s |
| Drain real | `asr_server.py drain` con el demo-client hablando | el final de la utterance sale, después `migrate` y cierre 1012; `drain_done` con 0 streams en ≈ 5 s; `/readyz` 503 |
| SIGTERM | `kill -TERM` a uvicorn con una sesión abierta | el cliente recibe 1012 (lo que dice el comentario de `create_app`) |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 17 reglas OK; los tests de las 8 alertas pasan. 12 mutaciones de umbrales, ventanas, `for`, filtros y del `offset` hacen fallar algún test (ninguna sobrevive) |
| Manifest | `kubernetes-validate --strict` (Kubernetes 1.36) sobre Service, Deployment y PodDisruptionBudget; `jsonschema` en modo estricto contra los CRDs de KEDA v2.21.0 (ScaledObject) y Prometheus Operator v0.94.1 (PodMonitor) | OK |
| Lock de dependencias | `uv pip compile` para Linux x86_64 y Python 3.13 | 19 paquetes |

**No verificado** (requiere GPU, un modelo de ASR, el SFU, un cluster o audio real):

- No hay adaptador de modelo real (`build_app` lanza `NotImplementedError`): código de red sin probar no
  se publica como referencia. La capacidad (≈ 500 streams por L4), el presupuesto de latencia y el tiempo
  del paso son las estimaciones del caso, a medir con carga sintética (N streams reproduciendo audio real).
- El VAD por energía solo se probó con tonos y ruido gaussiano, no con voz real: su precisión y recall con
  ruido real son desconocidos (por eso el docstring propone WebRTC VAD o Silero y medir por slice).
- No se construyó ninguna imagen ni hay Dockerfile; el manifest no corrió en un cluster (ni el preStop
  real, ni KEDA, ni el PDB). La gracia de 90 s y el drain de 60 s salen del razonamiento del archivo.
- El session router está en memoria y es de un solo proceso: la tabla compartida entre réplicas del
  gateway (Redis-class con reservas atómicas), los heartbeats, la afinidad por zona y el reenvío de la
  frase en curso desde el buffer del gateway cuando cae un worker se describen en el caso, no están aquí.
- El caption-bus, el job del audio dorado y el servidor de señalización no existen aquí: sus métricas
  solo están en los tests de promtool. Los umbrales de las alertas son ilustrativos.
- `wer.py` normaliza números solo en español (0–999,999); inglés y portugués dejan los dígitos.
