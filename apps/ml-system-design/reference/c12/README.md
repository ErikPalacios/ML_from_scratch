# Caso c12 — archivos de referencia (agente de soporte con herramientas)

Archivos **reales** del caso c12 de *Ronda de Diseño ML*: el orquestador del agente ("el modelo propone, el código
dispone"), el registro de las 8 herramientas con sus schemas y su clase de efecto, la política de negocio en
funciones puras, el step log durable que permite reanudar sin pagar dos veces, los guardrails para texto no
confiable, la suite de escenarios con su gate, el servicio HTTP con SSE y webhook de aprobaciones, y las 8 alertas
con sus tests. Cada archivo está comentado explicando **por qué**.

Los números (≈ 150k conversaciones/día, ≈ 6 llamadas al modelo por conversación, ≈ 2,500 tokens de entrada y ≈ 150
de salida por llamada, ≤ 8 tool calls por turno, ≤ 12 llamadas por conversación, 40k tokens, 20 s por turno, 3 s por
herramienta, reembolso automático ≤ US$50, aprobación en ≤ 4 h hábiles) son los del caso y, donde son volumen, son
**estimaciones**. Los umbrales y defaults que no vienen del caso son **ilustrativos** y lo dicen en cada archivo.

## Estructura

```
c12/
├── agent/
│   ├── tools.py          # las 8 herramientas: argumentos pydantic → JSON Schema (formato tools de OpenAI, strict),
│   │                     #   clase de efecto (read/write/money), timeout 3 s, reintentos, idempotency keys, executor
│   ├── policy.py         # funciones PURAS: dueño, estado del pedido, monto/moneda/1 por pedido, elegibilidad,
│   │                     #   confirmación, aprobación (> US$50, 2.º reembolso del cliente en 90 días, score de
│   │                     #   riesgo alto o conversación marcada por texto de terceros), kill switch
│   ├── loop.py           # el orquestador: límites, loop detection, compactación, streaming por oración, hand-off
│   ├── state.py          # step log en SQLite (Postgres en producción): write-ahead, reanudar, acciones, trazas
│   ├── llm.py            # cliente del llm-gateway de c10 (stream + tool calls) y dos modelos falsos (guion y demo)
│   ├── backend.py        # interfaz de los sistemas internos + backend en memoria con fallas inyectables
│   └── tests/            # test_policy.py (30), test_tools.py (30), test_loop.py (31), test_state.py (6),
│                         #   test_llm.py (9)
├── guardrails/
│   ├── untrusted.py      # delimitar texto no confiable con nonce y procedencia, banderas heurísticas (y sus límites),
│   │                     #   filtro de salida por oración
│   └── tests/            # test_untrusted.py (18): lo que detecta y, escrito como test, lo que NO detecta
├── eval/
│   ├── run_scenarios.py  # corre conversaciones completas; oráculo propio de invariantes; métricas; gate; pass^k
│   ├── scenarios/        # 15 escenarios YAML (el caso habla de ≈ 400)
│   └── tests/            # test_run_scenarios.py (8): la suite pasa y FALLA con la política rota (mutaciones)
├── service/
│   ├── app.py            # FastAPI: POST mensajes (SSE), GET eventos, POST cierre, webhook de aprobaciones firmado,
│   │                     #   /metrics (sin ids de cliente), demo_app
│   ├── requirements.txt  # lock de runtime (20 paquetes)
│   └── tests/            # test_app.py (15)
├── monitoring/
│   ├── alerts.yml        # 8 alertas (9 reglas) + 8 recording rules
│   ├── alerts_test.yml   # tests de promtool (evaluación cada 1 min)
│   └── alerts_weekly_test.yml  # las que comparan contra hace una semana (evaluación cada 10 min)
├── pytest.ini            # `pytest` desde aquí corre las 4 carpetas
└── requirements-dev.txt  # service/requirements.txt + pytest + pyyaml
```

## Orden de lectura sugerido

1. `agent/policy.py` — el docstring y `evaluate()`: qué decide el código aunque el modelo "decida" otra cosa.
2. `agent/tools.py` — los schemas (sin `customer_id`), las clases de efecto y `ToolExecutor.execute`: qué pasa
   después de un timeout en una escritura.
3. `agent/loop.py` — el docstring (un turno paso a paso) y `_run_tool_call`: lista permitida → schema → id de
   pedido conocido → loop → tope → política → ejecución con write-ahead → observación envuelta.
4. `agent/state.py` — por qué un step log y cómo `resume` retoma sin repetir efectos.
5. `guardrails/untrusted.py` — y sus tests de "lo que no detecta".
6. `eval/run_scenarios.py` y dos escenarios: `07_injection_in_product_description.yaml` y
   `10_timeout_after_refund_commit.yaml`.
7. `service/app.py` y `monitoring/alerts.yml`.

## Una conversación de punta a punta

```
t = 0        la app manda POST /v1/conversations/c1/messages  {"message_id": "m1",
             "text": "Mi pedido A-1029 llegó roto, quiero que me devuelvan el dinero"} con el token de sesión
+ < 10 ms    token → AuthContext(cust-1) (de la SESIÓN; el modelo nunca elige el cliente); lock de la conversación;
             el turno arranca en su propia tarea (si el cliente se va, el turno termina igual)
             message_id nuevo → se registra (dedupe); banderas de inyección del texto del cliente → ninguna
             (si hubiera, se cuentan en métricas pero no marcan la conversación: el cliente es el dueño)
             step log: user_message
+ ≈ 2 s      llamada 1 al llm-gateway (stream, tools de order_support, tool_choice auto, parallel_tool_calls false)
             → tool call get_order {"order_id": "A-1029"}                         step log: llm_call (+ usage)
             A-1029 apareció en el mensaje del cliente → pasa; SSE status "Consultando tu pedido…"
             política: dueño ok → ALLOW; lectura con timeout 3 s → resultado MINIMIZADO (ciudad, no calle)
             → truncado a 2,000 caracteres y envuelto <<untrusted_begin … source=tool:get_order>>   step log: tool_call
+ ≈ 2 s      llamada 2 → issue_refund {"order_id": "A-1029", "amount": 450.0, "currency": "MXN", "reason": "damaged"}
             política: misma moneda, 450 ≤ total, 0 reembolsos previos del agente, entregado hace 3 días (≤ 30) →
             US$24.75 ≤ 50, pero dinero → NEEDS_CONFIRMATION
             acción act_… guardada (sus argumentos, congelados); SSE confirmation_required con el resumen escrito
             por CÓDIGO ("reembolso de 450.00 MXN del pedido A-1029"); mensaje de plantilla; fin del turno
t = minutos  el cliente toca "Confirmar": POST {"message_id": "m2", "text": "Sí", "confirm_action_id": "act_…"}
             la acción es de esta conversación, está pendiente y no venció (15 min) → el orquestador la re-propone
             (paso sintético orch_act_…) → la política se evalúa OTRA VEZ con hechos frescos → ALLOW
             write-ahead: tool_call "started" con su idempotency key → issue_refund al backend
             (si responde en 3 s: "completed"; si no: get_operation(key) → succeeded/not_found/in_progress)
+ ≈ 3 s      llamada 3: el modelo redacta "Listo: emitimos tu reembolso…"; cada ORACIÓN pasa por el filtro de salida
             (enlaces fuera de dominio, imágenes markdown, tarjetas) antes del SSE message_delta; done
cierre       POST /close → costo interno de la conversación (≈ US$0.004 aquí; ≈ US$0.014 con 6 llamadas de 2,500)
```

Con 2,400 MXN (≈ US$132) la segunda llamada termina en `approval_pending` (cola `refunds-tier1`): la conversación
queda esperando en la tabla `actions`, no en memoria. Horas después llega el webhook firmado de la herramienta de
aprobaciones; el orquestador re-evalúa la política (el pedido pudo cambiar), ejecuta con la misma key y avisa con
una **plantilla** (sin llamar al modelo). El cliente lo ve en `GET /events` aunque haya cerrado la app.

## Decisiones que no están en el enunciado (y por qué)

| Decisión | Por qué |
|---|---|
| Key de `update_shipping_address` incluye el turno | Dirección A → B → A en turnos distintos es legítimo; con key por conversación el tercer cambio se "deduplicaría" en silencio. Dinero y cancelación: una vez por conversación. |
| `escalate_to_human`: un ticket por conversación | La key no incluye el resumen: dos textos distintos del modelo no abren dos tickets. |
| Banderas de inyección → aprobación humana para el dinero, solo si vienen de texto de terceros | Las heurísticas tienen falsos positivos, así que no bloquean; suben la exigencia. Solo las de resultados de herramientas con texto del vendedor o del producto (de ahí viene la inyección indirecta): "quiero el reembolso total" del cliente se cuenta en métricas pero no manda su reembolso de US$24.75 a una persona. |
| Tope por cliente: el 2.º reembolso del agente en 90 días (otro pedido) o un score de riesgo alto → aprobación | El "1 por pedido" no ve "llegó dañado" en un pedido distinto cada semana. El umbral del score (0.8) es ilustrativo. |
| Un turno caído se termina cuando llega el siguiente mensaje | `run_turn` llama a `resume` con el `turn_id` del turno caído (mismas idempotency keys) antes de procesar el mensaje nuevo. El webhook de aprobaciones toma el mismo lock por conversación que los mensajes. |
| El `order_id` tiene que haber aparecido en la conversación o estar en los pedidos recientes | Un id "recordado" mal no llega a la API; vuelve al modelo con la lista real. El segundo error de argumentos en un turno → hand-off. |
| Escribir en lugar de tocar el botón invalida la tarjeta pendiente | El cliente pudo cambiar de opinión; si el modelo vuelve a proponer lo mismo, sale la misma tarjeta (mismo `action_id`). |
| Al reanudar un paso "started" no se vuelve a decidir la política | Los hechos nuevos ya muestran el reembolso hecho y la política lo negaría; se concilia con la key. |
| Texto al cliente por oración, no por token | Cada oración pasa por el filtro de salida; cuesta ≈ una oración de demora (estimación). |
| `disabled_tools` y `money_to_humans` | Breaker abierto y kill switch de la escalera de degradación: configuración, no deploy. |
| Precio interno por token | US$0.73/M entrada y US$2.93/M salida (ilustrativo): la flota de c10 repartida sobre sus tokens con la proporción 1:4 del proveedor. |

## Métricas (`/metrics`)

| Métrica | Labels | La usa |
|---|---|---|
| `agent_tool_calls_total` | tool, outcome (`ok`, `not_found`, `rejected`, `error`, `timeout`, `unknown`, `conflict`, `denied`, `not_allowed`, `invalid_args`, `unknown_order`) | AgentToolErrorRateHigh |
| `agent_tool_latency_seconds` (histograma) | tool | diagnóstico |
| `agent_llm_calls_total`, `agent_llm_tokens_total` | direction | costo, diagnóstico |
| `agent_policy_denials_total` | tool, reason | tablero (denegar no es fallar) |
| `agent_policy_violations_total` | check (creada en 0) | AgentPolicyViolation |
| `agent_step_limit_hits_total` | limit (creadas en 0) | AgentStepLimitHit |
| `agent_turns_total` | conversation_type, outcome | AgentStepLimitHit |
| `agent_turn_duration_seconds` (borde en 12) | conversation_type | AgentTurnLatencyHigh |
| `agent_first_response_seconds` (borde en 4) | conversation_type | AgentTurnLatencyHigh |
| `agent_conversations_started_total`, `agent_conversations_closed_total` | conversation_type (+ outcome) | volumen, escalamiento |
| `agent_handoffs_total` | conversation_type, reason | EscalationRateShift |
| `agent_conversation_cost_usd` (histograma) | conversation_type | AgentCostPerConversationHigh |
| `agent_refunds_total`, `agent_refund_amount_usd_total` | path (`auto`/`approved`) | RefundAmountAnomaly |
| `agent_approvals_pending`, `agent_approval_oldest_pending_seconds` (hábiles) | — | ApprovalQueueBacklog |
| `agent_injection_flags_total` | source, rule | tablero |

Ninguna lleva `customer_id`, `conversation_id` ni `order_id`: eso vive en el step log y en la traza.

## Las 8 alertas

| Alerta | Umbral | Severidad |
|---|---|---|
| `AgentPolicyViolation` | cualquier violación en 10 min, sin `for` | page |
| `RefundAmountAnomaly` | US$ por 1,000 conversaciones > 1.5× la misma hora hace una semana, 30 min, con volumen | page |
| `AgentTurnLatencyHigh` | p95 del turno > 12 s o de la primera respuesta > 4 s, 10 min | page |
| `AgentToolErrorRateHigh` | > 5 % de fallas de una herramienta (sin contar denegaciones), 10 min, ≥ 12 llamadas/min | page |
| `ApprovalQueueBacklog` | la más vieja > 3 h hábiles, en horario hábil (lun–vie 9–18 CDMX), 10 min | page |
| `AgentStepLimitHit` | > 2 % de los turnos toca un límite, 15 min | ticket |
| `EscalationRateShift` | hand-offs por conversación ± 10 puntos contra hace una semana, 30 min | ticket |
| `AgentCostPerConversationHigh` | costo promedio > US$0.025, 30 min | ticket |

## Tool calling del lado de vLLM (lo que la flota de c10 necesita)

Leído en el código y la documentación de **vLLM v0.30.0** (`vllm/entrypoints/launchers/cli_args.py`,
`vllm/renderers/online_renderer.py`, `docs/features/tool_calling.md`):

- `tool_choice: "auto"` exige `--enable-auto-tool-choice` y `--tool-call-parser`; sin ellos el servidor rechaza el
  request ("\"auto\" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set").
- Para Llama 3.x: `--tool-call-parser llama3_json` con el chat template `examples/tool_chat_template_llama3.1_json.jinja`.
  La documentación lista Llama 3.1, 3.2 y 4; para Llama 3.3 (el caso base de c10), confírmalo renderizando el
  template y con la suite. **Llama 3 no soporta tool calls en paralelo** (Llama 4 sí).
- Con `parallel_tool_calls: false`, vLLM se queda solo con la primera tool call de la respuesta.
- Con `tool_choice: "auto"`, los argumentos se restringen al schema solo si alguna tool tiene `strict: true`
  (y `VLLM_ENFORCE_STRICT_TOOL_CALLING`, que por defecto es true) y el parser lo soporta; si no, se extraen del texto
  y pueden venir mal formados. Por eso `tools.py` manda `strict: true` **y** el loop valida siempre.

Esos flags van en el Deployment `vllm-70b` de c10 (no en esta carpeta): son una revisión nueva de la flota.

## Correr los tests (sin GPU, sin modelo, sin red)

```bash
cd reference/c12
python3 -m venv .venv && . .venv/bin/activate      # Python 3.13 (o 3.12)
pip install -r requirements-dev.txt
pytest                                              # 158 tests, ≈ 3–10 s
python eval/run_scenarios.py                        # 15 escenarios, tabla de métricas y GATE: PASA
python eval/run_scenarios.py --max-forbidden-proposed-rate 0.05   # GATE: FALLA (el guion "cae" en 2 inyecciones)

cd monitoring
promtool check rules alerts.yml                     # promtool viene en el release de Prometheus
promtool test rules alerts_test.yml                 # ≈ 3 s
promtool test rules alerts_weekly_test.yml          # más de una semana de series: ≈ 40 s en una laptop
```

## Demo local (modelo POR REGLAS, backend en memoria)

```bash
cd reference/c12
uvicorn --factory service.app:demo_app --port 8090
# otra terminal: el cliente cust-1 (token de demo tok-cust-1) pide el reembolso de un monitor de 2,400 MXN
curl -sN localhost:8090/v1/conversations/c1/messages -H 'Authorization: Bearer tok-cust-1' \
  -H 'content-type: application/json' -d '{"message_id":"m1","text":"El monitor del pedido A-1031 llegó roto"}'
# copia el action_id del evento confirmation_required y confírmalo
curl -sN localhost:8090/v1/conversations/c1/messages -H 'Authorization: Bearer tok-cust-1' \
  -H 'content-type: application/json' -d '{"message_id":"m2","text":"Sí","confirm_action_id":"act_…"}'
# → approval_pending. Aprueba con el webhook FIRMADO (secreto de demo: demo-secret)
TS=$(date +%s); BODY='{"decision":"approved","approver_id":"sup-7"}'
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac demo-secret | awk '{print $NF}')
curl -s -X POST localhost:8090/v1/approvals/act_… -H "X-Approval-Timestamp: $TS" \
  -H "X-Approval-Signature: sha256=$SIG" -H 'content-type: application/json' -d "$BODY"
curl -s 'localhost:8090/v1/conversations/c1/events?after=0' -H 'Authorization: Bearer tok-cust-1'
curl -s localhost:8090/metrics | grep '^agent_'
```

`DemoChatModel` reconoce un id de pedido y palabras como "roto" o "reembolso": **no es un modelo**. Sirve para ver
el protocolo (eventos SSE, confirmación, aprobación, métricas) sin GPU.

## Qué se ejecutó y qué no

Probado en macOS (Apple Silicon), sin GPU, sin modelo, sin red hacia sistemas reales y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests de las 4 carpetas | pytest 9.1.1 en venvs limpios desde `requirements-dev.txt`, Python 3.13.15 y 3.12.14; varias corridas; warnings como errores | 158 passed, todas las veces |
| Política | tablas de casos sobre funciones puras: dueño, estados, bordes del límite en USD (909.09 / 909.10 / 909.20 MXN), elegibilidad, aprobación, inyección, kill switch | OK |
| Executor | fallas inyectadas: timeout antes y después de aplicar el efecto, 503, operación colgada, reuso de key | lecturas: 1 reintento; escrituras: consulta por key, un solo reembolso, "unknown" sin reintento |
| Orquestador | modelo con guion: confirmación, aprobación (aprobada, rechazada, con el pedido cambiado), loop, 8 tool calls, 12 llamadas, 40k tokens, 20 s, LLM caído, JSON roto, id inventado, inyección obedecida, filtro de salida, mensaje duplicado, tope de prompt del gateway | OK |
| Reanudar | caída simulada después de aplicar el reembolso y antes de registrarlo; caída después de registrar la respuesta del modelo; aprobación después de "reiniciar" | un solo reembolso; el modelo no se vuelve a llamar para pasos ya registrados |
| Cliente del gateway | `httpx2.MockTransport` con SSE: tool call en pedazos, usage, 429/503/502, evento de error, abort, error de conexión | OK |
| Suite de escenarios | 15 escenarios; mutaciones de la política (límite en US$10,000, sin confirmación, sin "1 por pedido") | GATE: PASA; cada mutación hace FALLAR el gate |
| Servicio | `TestClient` de Starlette; desconexión del cliente llamando al ASGI a mano; uvicorn real + curl (flujo de aprobación completo con webhook firmado con `openssl`) | SSE, 401/404/409/422, dedupe, webhook (firma, replay, 409), turno que termina sin cliente, métricas |
| Alertas | `promtool check rules` y `promtool test rules` de Prometheus **3.15.0** (binario oficial, sha256 verificado contra `sha256sums.txt` del release) | 17 reglas OK; tests pasan en corridas repetidas (con `group_eval_order`; sin él, los tests con offset 1w fallaban al azar). 17 mutaciones de umbrales, filtros, ventanas horarias, `abs` y cuantil hacen fallar algún test (ninguna sobrevive) |
| Lint | `ruff check` (E, F, W, B, UP) | sin hallazgos |
| Lock | `uv pip compile` para Linux x86_64 y Python 3.13 | 20 paquetes de runtime |
| vLLM (tool calling) | leído en el código y la documentación de v0.30.0 | flags y comportamiento citados arriba |

**No verificado** (requiere el modelo, la flota de c10 o los sistemas reales):

- **Ningún modelo real corrió.** Los escenarios usan un guion: prueban que el orquestador, la política y el oráculo
  aguantan lo que un modelo puede hacer, no qué tan bien elige herramientas Llama 3.3 70B. Eso se mide con la suite
  contra el gateway real, k corridas por escenario (pass^k) y clientes simulados; aquí no existe.
- **El tool calling de vLLM** con `llama3_json` y `strict` no se probó con el modelo: ni la calidad de los
  argumentos ni el soporte de Llama 3.3 por ese parser.
- **Los sistemas internos** son un backend en memoria. Que la API de pagos acepte idempotency keys y responda una
  consulta por key es un supuesto del diseño (el caso dice qué hacer cuando una API no las acepta).
- **Estado**: SQLite en un proceso. No hay Postgres, ni leases entre workers (`SELECT … FOR UPDATE SKIP LOCKED`), ni
  outbox, ni job de vencimientos (la confirmación vence cuando se intenta usar; las aprobaciones no vencen solas).
  El lock de "un turno a la vez" es por proceso. No hay un job que retome al arrancar las conversaciones quietas: un
  turno caído se retoma cuando llega su siguiente mensaje o su aprobación.
- **Circuit breaker**: no hay uno automático; `disabled_tools` es el interruptor que un breaker movería.
- **Trazas**: `StepLog.to_trace()` produce spans con atributos `gen_ai.*` (convenciones en estado *Development* a
  oct. 2026), pero no hay exportador de OpenTelemetry.
- **Las heurísticas de inyección y el filtro de salida** solo vieron ejemplos escritos a mano; su recall con texto
  real es desconocido.
- **El centro de ayuda** es una búsqueda de juguete; el caso usa retrieval como en c11.
- No hay manifests de Kubernetes ni Dockerfile para este servicio. Los umbrales de las alertas son ilustrativos.
