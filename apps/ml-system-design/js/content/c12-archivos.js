/* =============================================================================
   Ronda de Diseño ML — js/content/c12-archivos.js
   Caso 12, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c12/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por pieza (herramientas, política, orquestador, estado durable, guardrails,
   evaluación, servicio, alertas), con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8m. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección de este caso y cualquier página o sección del curso.
  const C = (sec, txt) => '<a href="#c12.' + sec + '">' + txt + '</a>';
  const L = (hash, txt) => '<a href="#' + hash + '">' + txt + '</a>';
  const E = (txt) => '<span class="est">' + txt + '</span>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c12/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c12/' + path, note });

  MSD.addSection('c12', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos de <code>reference/c12/</code>, probados hasta donde se puede sin el modelo, sin la flota del ' + L('c10', 'c10') + ' y sin los sistemas internos reales. Son ocho piezas: el <b>registro de las 8 herramientas</b> (schemas, clase de efecto, timeouts, idempotency keys), la <b>política</b> en funciones puras, el <b>orquestador</b> con sus límites, el <b>step log durable</b> que permite reanudar sin pagar dos veces, los <b>guardrails</b> para texto no confiable, la <b>suite de escenarios</b> con su gate, el <b>servicio</b> con SSE y webhook de aprobaciones, y las <b>8 alertas</b> con sus tests. Cada línea importante trae un comentario con el <b>porqué</b>. Son la versión concreta de lo que defiendes en ' + C('serving', 'serving') + ', ' + C('evaluacion', 'evaluación') + ', ' + C('monitoreo', 'monitoreo') + ' y ' + C('fallas', 'fallas') + '.' },
      { t: 'callout', kind: 'skip',
        html: 'En la entrevista nadie te pide escribir un orquestador. Primera pasada: el mapa, la conversación de punta a punta y los callouts de trampas. Lo que sí debes poder decir sin mirar: el <code>customer_id</code> sale de la <b>sesión</b> y ninguna herramienta lo recibe como argumento; la política es código puro que se evalúa <b>antes de cada acción</b> y otra vez al confirmar; la idempotency key es un hash de (conversación, acción, argumentos normalizados), no un UUID por intento; después de un timeout en una escritura se <b>pregunta el estado por la key</b>, nunca se reintenta a ciegas; confirmar es un evento del botón atado a una acción exacta, no un "sí" que interpreta el modelo; cada límite termina en hand-off con un resumen armado por código; y la suite tiene un <b>oráculo propio</b>: si el oráculo fuera la misma política, un bug en la política pasaría el gate.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (macOS, sin GPU, sin modelo, sin sistemas reales y sin daemon de Docker): 147 tests de las cuatro carpetas con pytest en venvs limpios con Python 3.13.15 y 3.12.14, varias corridas seguidas y con los warnings como errores. La suite de 15 escenarios pasa su gate, y tres mutaciones de la política (límite automático en US$10,000, sin confirmación, sin "1 reembolso por pedido") lo hacen fallar. Caídas simuladas a mitad de un turno: un solo reembolso al reanudar. El servicio corrió con uvicorn real y <code>curl</code>: un reembolso de 2,400 MXN pasó por confirmación, cola de aprobación y webhook firmado con <code>openssl</code>. <code>promtool check rules</code> y <code>promtool test rules</code> de Prometheus 3.15.0 (binario oficial con sha256 verificado): las 8 alertas disparan o no con series sintéticas, y 17 mutaciones de umbrales, filtros y ventanas hacen fallar algún test. Los flags de tool calling de vLLM se leyeron en el código y la documentación de v0.30.0.</li>' +
          '<li><b>No ejecutado</b>: ningún modelo real. Los escenarios usan un <b>guion</b> (un modelo falso que devuelve tool calls fijas, incluida obedecer una inyección): prueban que el orquestador, la política y el oráculo aguantan, no qué tan bien elige herramientas el modelo del caso. Tampoco el tool calling de vLLM con el modelo, Postgres, leases entre workers, un circuit breaker automático ni un exportador de OpenTelemetry. El backend de pedidos y pagos es un falso en memoria. El <code>README.md</code> de <code>reference/c12</code> trae la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>tools.py</code> <small>agent</small>', C('serving', '7 · Serving') + ', ' + L('m14.agentes', 'M14'), 'Schemas pydantic → JSON Schema "strict" sin <code>customer_id</code>; clase de efecto; key por conversación o por turno; qué hace el executor después de un timeout en una escritura'],
          ['<code>policy.py</code> <small>agent</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas'), 'El orden de las reglas: lista permitida → dueño → estado → dinero → elegibilidad → confirmación → aprobación; el kill switch'],
          ['<code>loop.py</code>, <code>llm.py</code> <small>agent</small>', C('arquitectura', '5 · Arquitectura') + ', ' + C('serving', '7 · Serving'), 'Un turno de punta a punta; los límites y su hand-off; loop detection; el id de pedido que el modelo "recordó" mal; texto por oración con filtro; el request al gateway'],
          ['<code>state.py</code> <small>agent</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas'), 'Write-ahead en el step log, reanudar sin repetir efectos, acciones esperando confirmación o aprobación, trazas con atributos <code>gen_ai.*</code>'],
          ['<code>untrusted.py</code> <small>guardrails</small>', C('fallas', '10 · Fallas') + ', ' + L('m14.guardrails', 'M14'), 'Delimitadores con nonce, banderas heurísticas y, escrito como test, lo que no detectan; el filtro de salida'],
          ['<code>run_scenarios.py</code>, <code>scenarios/*.yaml</code> <small>eval</small>', C('evaluacion', '8 · Evaluación'), 'Estado final del backend, oráculo independiente, afirmaciones sin acción, propuestas prohibidas, pass^k, gate'],
          ['<code>app.py</code> <small>service</small>', C('arquitectura', '5 · Arquitectura') + ', ' + C('monitoreo', '9 · Monitoreo'), 'SSE, un turno a la vez por conversación, el turno que sigue aunque el cliente se vaya, webhook firmado, métricas sin ids'],
          ['<code>alerts.yml</code> y sus tests <small>monitoring</small>', C('monitoreo', '9 · Monitoreo') + ', ' + L('m12.runbooks', 'M12'), 'Las 8 alertas: dinero y seguridad, experiencia, comportamiento y costo; contadores creados en 0'],
        ],
        note: 'Orden de lectura sugerido: <code>policy.py</code> → <code>tools.py</code> → <code>loop.py</code> → <code>state.py</code> → <code>untrusted.py</code> → <code>run_scenarios.py</code> (con dos escenarios) → <code>app.py</code> → <code>alerts.yml</code>. Primero qué puede pasar y qué no, después cómo se ejecuta, cómo sobrevive a una caída, y al final cómo se evalúa y se vigila.' },
      { t: 'table', caption: 'Un reembolso de 450 MXN de punta a punta (tiempos ' + E('estimados') + ')',
        head: ['Cuándo', 'Qué pasa', 'Dónde'],
        rows: [
          ['t = 0', 'La app manda <code>POST /v1/conversations/c1/messages</code> con <code>message_id</code>, el texto y el token de sesión', 'cliente'],
          ['+ &lt; 10 ms', 'Token → <code>AuthContext</code>; lock de la conversación; el turno arranca en su propia tarea; dedupe por <code>message_id</code>; banderas de inyección del texto; paso <code>user_message</code> en el log', '<code>app.py</code>, <code>loop.py</code>'],
          ['+ ' + E('≈ 2 s'), 'Llamada 1 al gateway → <code>get_order</code>. El id apareció en el mensaje → estado "Consultando tu pedido…" → política ALLOW → lectura de 3 s → resultado minimizado, truncado y envuelto como no confiable', '<code>llm.py</code>, <code>policy.py</code>, <code>tools.py</code>'],
          ['+ ' + E('≈ 2 s'), 'Llamada 2 → <code>issue_refund</code> por 450 MXN. Política: moneda, monto, 0 reembolsos previos, entregado hace 3 días; US$24.75 ≤ 50 pero es dinero → <b>confirmación</b>. Tarjeta escrita por código; fin del turno', '<code>policy.py</code>, <code>loop.py</code>'],
          ['minutos', 'El cliente toca "Confirmar": el orquestador re-propone la acción guardada, la política se evalúa otra vez con hechos frescos, write-ahead con la key, <code>issue_refund</code> al backend', '<code>loop.py</code>, <code>state.py</code>'],
          ['+ ' + E('≈ 3 s'), 'Llamada 3: "Listo: emitimos tu reembolso…", oración por oración por el filtro de salida; <code>done</code>', '<code>untrusted.py</code>'],
        ],
        note: 'Con 2,400 MXN (' + E('≈ US$132') + ') la confirmación termina en la cola <code>refunds-tier1</code>: la conversación espera en una tabla, no en memoria, y horas después el webhook firmado ejecuta la acción con la misma key y avisa con una plantilla, sin llamar al modelo. Probado con uvicorn real.' },

      // ------------------------------------------------------------------ herramientas
      { t: 'h3', text: 'Herramientas: el contrato con el modelo y qué pasa después de un timeout' },
      { t: 'code', title: 'Registro de las 8 herramientas, executor y backend falso',
        caption: '<code>pytest agent/tests/test_tools.py</code>: 30 tests. Las fallas se inyectan en el backend en memoria (timeout antes o después de aplicar el efecto, 503, operación colgada).',
        files: [
          F('agent/tools.py', 'python', 'Cada herramienta: un modelo pydantic de argumentos (con <code>extra="forbid"</code>: un <code>customer_id</code> "agregado" por el modelo no pasa), su clase de efecto, 3 s de timeout y un texto de estado. <code>openai_tool</code> convierte el schema al formato <code>tools</code> de Chat Completions en estilo <i>strict</i> (sin <code>$ref</code> ni <code>title</code>, todo requerido, lo opcional como <code>null</code>), en orden fijo para que el prefix caching acierte. <code>idempotency_key</code> = sha256 de (conversación, acción, argumentos normalizados): NFKC, espacios, minúsculas, montos a 2 decimales. Para la dirección entra también el turno; para el ticket, ningún argumento (uno por conversación). <code>ToolExecutor.execute</code> es la regla del caso: lecturas con 1 reintento y backoff con jitter; escrituras, después de un timeout o un 503, <code>get_operation(key)</code> → si se aplicó, ese resultado; si nunca llegó, un reenvío con la misma key; si está en curso, "unknown" y el orquestador pasa a una persona.'),
          F('agent/backend.py', 'python', 'La interfaz <code>CommerceBackend</code> y el falso en memoria. Tres reglas que el backend aplica aunque la política ya haya decidido: dueño (un pedido ajeno es <code>NotFound</code>, igual que uno inexistente), idempotencia por key (misma key y mismos parámetros → mismo resultado sin repetir el efecto; otros parámetros → conflicto, como la API de Stripe) y consulta de estado por key. Guarda un registro de auditoría de cada efecto que la evaluación usa como oráculo.'),
          F('agent/tests/test_tools.py', 'python', 'Que los 8 schemas sean <i>strict</i>, que ninguno tenga un campo de cliente, que el orden sea estable; argumentos que se rechazan (un id con SQL, 10.005 pesos, un motivo inventado); la key igual para 450 y 450.0 y distinta para otro monto o conversación; A → B → A en la dirección; y cada falla del executor: timeout después de aplicar (un solo reembolso, sin reenvío), nunca llegó (un reenvío con la misma key), colgada ("unknown", sin reintento).'),
        ] },
      { t: 'table', caption: 'Qué hace el executor según la clase de efecto',
        head: ['Clase', 'Herramientas', 'Si vence el timeout o hay un 503'],
        rows: [
          ['read', '<code>get_order</code>, <code>get_shipment_tracking</code>, <code>search_help_center</code>', 'Backoff con jitter y 1 reintento; si vuelve a fallar, error estructurado al modelo'],
          ['write', '<code>update_shipping_address</code>, <code>create_return_label</code>, <code>escalate_to_human</code>', 'Consulta por key: <code>succeeded</code> → ese resultado; <code>not_found</code> → reenvío con la misma key; <code>in_progress</code> → hand-off para conciliar'],
          ['money', '<code>issue_refund</code>, <code>cancel_order</code>', 'Igual que write; además, antes de llegar aquí, confirmación del cliente y política (y aprobación arriba de US$50)'],
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: la key por intento',
        html: 'Un <code>uuid4()</code> nuevo en cada llamada parece idempotencia y no lo es: el reintento lleva otra key y el backend lo trata como un reembolso nuevo. Y tampoco sirve para reanudar: el proceso que retoma después de una caída no sabe qué UUID había usado el anterior. Con el hash de (conversación, acción, argumentos), la misma acción produce la misma key en cualquier proceso. El caso borde está en un test: si el cliente cambia la dirección A → B → A, una key por conversación "deduplicaría" el tercer cambio en silencio; por eso la de la dirección incluye el turno.' },

      // ------------------------------------------------------------------ política
      { t: 'h3', text: 'Política: lo que el código decide aunque el modelo "decida" otra cosa' },
      { t: 'code', title: 'Reglas de negocio en funciones puras',
        caption: '<code>pytest agent/tests/test_policy.py</code>: 30 tests de tablas de casos, sin backend, sin modelo y sin reloj real.',
        files: [
          F('agent/policy.py', 'python', '<code>evaluate()</code> devuelve uno de cuatro veredictos (ALLOW, DENY, NEEDS_CONFIRMATION, NEEDS_APPROVAL) con un motivo estable que va a métricas. Recibe los hechos del pedido leídos del backend justo antes (no los que "recuerda" el modelo) y el <code>action_id</code>: lo que el cliente confirma y lo que una persona aprueba es esa acción exacta; otro monto es otra acción. Dinero siempre en <code>Decimal</code> (<code>Decimal(str(x))</code>, nunca <code>Decimal(x)</code> de un float). Las tasas de cambio, la ventana de 30 días y los 7 días de gracia son ilustrativos. <code>money_to_humans</code> es el kill switch de la escalera de degradación.'),
          F('agent/tests/test_policy.py', 'python', 'Ajeno igual que inexistente; dirección y cancelación solo antes del envío; los bordes del límite en USD; reglas duras que ni la confirmación ni la aprobación saltan (monto mayor al pedido, otra moneda, segundo reembolso del agente, pedido cancelado); "dañado" fuera de la ventana; "no llegó" con entrega confirmada; y la bandera de inyección que manda a una persona un reembolso de US$24.75.'),
        ] },
      { t: 'calc', title: 'El límite automático en USD (tasa ilustrativa: 0.055 USD por MXN)', rows: [
        { label: '450 MXN (audífonos)', expr: '450 × 0.055', value: 'US$24.75 → confirmación' },
        { label: '909.09 MXN', expr: '49.99995 → redondeo a centavos', value: 'US$50.00 → automático' },
        { label: '909.20 MXN', expr: '50.006 → redondeo a centavos', value: 'US$50.01 → aprobación' },
        { label: '2,400 MXN (monitor)', expr: '2,400 × 0.055', value: 'US$132.00 → aprobación, cola tier1' },
      ], result: 'El límite es inclusivo y se compara después de redondear a centavos (HALF_UP): eso está escrito en un test, porque es exactamente el tipo de detalle que cambia en silencio. En producción la tasa es la del día del servicio de FX y se guarda con la decisión para poder auditarla.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: la política en el system prompt',
        html: '"No reembolses más de US$50" en el prompt es una instrucción más, que compite con cualquier texto inyectado en una descripción de producto (' + L('m14.guardrails', 'M14') + '). En <code>loop.py</code> el system prompt ni siquiera menciona el límite: lo aplica <code>policy.py</code>, y el backend vuelve a revisar dueño, moneda y techo del pedido. Si el modelo obedece una inyección, lo peor que puede hacer es lo que la política deja hacer.' },

      // ------------------------------------------------------------------ orquestador
      { t: 'h3', text: 'El orquestador: límites, loop detection y hand-off' },
      { t: 'code', title: 'El loop y el cliente del llm-gateway',
        caption: '<code>pytest agent/tests/test_loop.py agent/tests/test_llm.py</code>: 40 tests con un modelo con guion (<code>ScriptedChatModel</code>) y un reloj falso.',
        files: [
          F('agent/loop.py', 'python', 'Léelo desde el docstring. <code>_proceed</code> reconstruye el contexto <b>solo desde el step log</b> antes de cada llamada (así reanudar es lo mismo que seguir) y revisa los límites antes de gastar otra llamada: 12 por conversación, 40k tokens (con la estimación pesimista del próximo request), 20 s de reloj y el tope de 6,000 tokens del tenant en el gateway del ' + L('c10.serving', 'c10') + ', con su misma estimación (caracteres ÷ 3): primero compacta resultados de turnos viejos y, si no alcanza, hand-off. <code>_run_tool_call</code> es el corazón: lista permitida → schema → el <code>order_id</code> apareció en la conversación (o está entre los pedidos recientes) → la misma llamada dos veces en el turno es un loop → tope de 8 → estado visible → hechos del pedido → política → ejecución con write-ahead → observación truncada a 2,000 caracteres y envuelta. El segundo error de argumentos en un turno es hand-off. Al tocar cualquier límite: mensaje (de espera, si fue el reloj) y hand-off con un resumen armado por código desde el log, sin otra llamada al modelo.'),
          F('agent/llm.py', 'python', 'El request al gateway con cada campo explicado: <code>tool_choice: "auto"</code>, <code>parallel_tool_calls: false</code> (el parser de Llama 3 en vLLM no soporta llamadas en paralelo y, con <code>false</code>, vLLM v0.30.0 se queda solo con la primera), temperatura 0, <code>stream</code> con <code>include_usage</code> y un <code>user</code> seudónimo (hash con sal, nunca el id real). El stream arma las tool calls por <code>index</code> porque llegan en pedazos. 429, 503, 5xx, timeout, un evento de error a mitad o un <code>abort</code> sin texto terminan en <code>LLMUnavailable</code>: el tenant de soporte no tiene respaldo al proveedor, así que se degrada a una persona. Incluye el modelo con guion de los tests y uno por reglas para la demo (ninguno es un modelo).'),
          F('agent/tests/test_loop.py', 'python', 'Cada test es una situación: el reembolso chico con confirmación; un "sí" escrito no confirma; aprobación aprobada, rechazada y con el pedido cambiado mientras esperaba; loop; 9 búsquedas; 13 mensajes; presupuesto de tokens; 21 s de modelo (mensaje de espera); gateway caído; timeout después del reembolso; estado desconocido; JSON roto; id inventado; herramienta fuera de la lista; pedido ajeno; la inyección que el modelo obedece; el filtro de salida; el mensaje duplicado; la conversación ya pasada a una persona; el tope de prompt del gateway; las trazas sin contenido; el costo.'),
          F('agent/tests/test_llm.py', 'python', 'El cliente contra un gateway falso (<code>httpx2.MockTransport</code>) con SSE real: una tool call en cuatro pedazos, usage, cada código de error, un evento de error a mitad del stream y un abort.'),
        ] },
      { t: 'table', caption: 'Los límites y qué pasa al tocarlos (todos terminan en una persona)',
        head: ['Límite', 'Valor', 'Dónde se revisa', 'Motivo del hand-off'],
        rows: [
          ['Tool calls por turno', '8', 'Antes de ejecutar cada una', '<code>tool_calls_per_turn</code>'],
          ['Llamadas al modelo por conversación', '12', 'Antes de cada llamada', '<code>llm_calls_per_conversation</code>'],
          ['Tokens por conversación', '40k (usage real)', 'Antes de cada llamada, con la estimación del próximo request', '<code>token_budget</code>'],
          ['Reloj del turno', '20 s', 'Antes de cada paso y durante el stream', '<code>turn_wall_clock</code> (con mensaje de espera)'],
          ['Prompt del tenant en el gateway', '6,000 estimados', 'Antes de cada llamada, después de compactar', '<code>prompt_too_long</code>'],
          ['Misma llamada dos veces en el turno', '2.ª vez', 'Antes de ejecutar', '<code>repeated_call</code>'],
          ['Argumentos inválidos o id desconocido', '2.º error en el turno', 'Al validar', '<code>invalid_arguments</code>'],
        ],
        note: 'Los seis primeros cuentan en <code>agent_step_limit_hits_total{limit}</code> (alerta <code>AgentStepLimitHit</code>). El timeout de 3 s por herramienta no es un hand-off: tiene la regla de su clase de efecto.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: streaming token por token "porque es más rápido"',
        html: 'Si cada token sale directo al cliente, no hay nada que filtrar a tiempo: un enlace a un dominio ajeno o una imagen en markdown que lleva datos en la URL ya se mostró. <code>loop.py</code> junta el stream por <b>oración</b> (<code>SentenceBuffer</code>) y cada oración pasa por <code>filter_output</code> antes de salir. Cuesta ' + E('≈ una oración') + ' de demora en la primera palabra; para que la espera no sea silencio, el estado "Consultando tu pedido…" sale apenas llega una tool call válida, antes de ejecutarla.' },
      { t: 'callout', kind: 'senior', title: 'Señal senior: si el cliente se va, el turno sigue',
        html: 'En el ' + L('c10.archivos', 'c10') + ', un cliente que cierra la pestaña cancela la generación para liberar GPU. Aquí es al revés: cancelar a mitad de un reembolso deja un efecto en estado desconocido. <code>app.py</code> corre el turno en una tarea aparte del request; si el cliente se desconecta, lo que se corta es el stream, no el trabajo, y el resultado queda en <code>GET /events</code>. Hay un test que corta la conexión después del primer evento y verifica que el reembolso confirmado se completó. Decirlo ("I decouple the turn from the HTTP stream, because cancelling in the middle of a write is worse than finishing it") muestra que pensaste en los efectos, no solo en la latencia.' },

      // ------------------------------------------------------------------ estado
      { t: 'h3', text: 'Estado durable: reanudar sin pagar dos veces' },
      { t: 'code', title: 'Step log, acciones pendientes y trazas',
        caption: '<code>pytest agent/tests/test_state.py</code>: 6 tests, dos de ellos con caídas simuladas a mitad de un turno.',
        files: [
          F('agent/state.py', 'python', 'Cuatro tablas: conversaciones, mensajes recibidos (dedupe de la entrada), el step log y las acciones que esperan al cliente o a una persona. Cada escritura se registra "started" con su key <b>antes</b> de llamar al backend y "completed" después (write-ahead). <code>incomplete_turn</code> encuentra el turno a retomar. <code>set_action_status</code> es compare-and-set: dos webhooks iguales no ejecutan dos veces. La edad de las aprobaciones se cuenta en horas <b>hábiles</b> (lunes a viernes, 9 a 18 de CDMX). <code>to_trace</code> exporta spans con atributos <code>gen_ai.*</code> de OpenTelemetry (convenciones en estado <i>Development</i>) sin contenido. El docstring compara con un motor de durable execution tipo Temporal. SQLite con <code>synchronous=FULL</code> por defecto (cada commit llega a disco); los tests usan NORMAL para no pagar un fsync por paso.'),
          F('agent/tests/test_state.py', 'python', 'La caída peligrosa: el reembolso se aplicó y el proceso murió antes de registrarlo. Otro proceso con el mismo archivo retoma el turno, reenvía con la misma key, el backend devuelve el resultado guardado (<code>idempotent_replay</code>) y hay un solo reembolso. La caída después de registrar la respuesta del modelo: se ejecuta la tool call registrada sin volver a llamar al modelo. Una aprobación que llega después de "reiniciar". Las horas hábiles de viernes 17:00 a lunes 10:00 (dos).'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: al reanudar, volver a decidir',
        html: 'El primer intento de reanudar de esta referencia falló en su test: al retomar el paso "started", el orquestador volvió a evaluar la política con hechos frescos, el pedido ya mostraba el reembolso hecho, y la regla de "1 por pedido" lo negó. Resultado: el dinero salió y el log decía "denegado", así que el modelo le habría dicho al cliente que no se pudo. Al reanudar no se decide otra vez: la decisión ya quedó en el log; lo que se hace es <b>conciliar el efecto</b> con la misma key.' },

      // ------------------------------------------------------------------ guardrails
      { t: 'h3', text: 'Guardrails: delimitar, marcar y conocer los límites' },
      { t: 'code', title: 'Texto no confiable de entrada y de salida',
        caption: '<code>pytest guardrails/tests</code>: 18 tests. Biblioteca estándar.',
        files: [
          F('guardrails/untrusted.py', 'python', 'El docstring empieza por los límites: delimitar no es una defensa, las banderas son heurísticas con falsos negativos y falsos positivos, y la defensa real es la política. <code>wrap_untrusted</code> envuelve resultados de herramientas con un nonce aleatorio y su procedencia (el atacante no puede adivinar el cierre) después de quitar caracteres invisibles. <code>flag_instruction_like</code> busca patrones en español, inglés y portugués: "ignora tus instrucciones", tokens del chat template como <code>&lt;|python_tag|&gt;</code>, un turno falso de "assistant:", nombres de herramientas dentro de datos. <code>filter_output</code> quita de cada oración las imágenes en markdown, los enlaces fuera de los dominios permitidos y los números de tarjeta que pasan Luhn.'),
          F('guardrails/tests/test_untrusted.py', 'python', 'Lo que detecta, lo que no marca en texto normal y, escrito como test, lo que <b>no</b> detecta: una paráfrasis, otro idioma, letras separadas por guiones. Un falso positivo de un cliente honesto. Caracteres invisibles que esconden el patrón hasta que se limpian. Un cierre falso del delimitador que queda neutralizado.'),
        ] },

      // ------------------------------------------------------------------ evaluación
      { t: 'h3', text: 'Evaluación: escenarios, un oráculo propio y un gate' },
      { t: 'code', title: 'La suite de escenarios',
        caption: '<code>python eval/run_scenarios.py</code> imprime la tabla y "GATE: PASA". <code>pytest eval/tests</code>: 8 tests, tres de ellos rompen la política a propósito.',
        files: [
          F('eval/run_scenarios.py', 'python', 'Arma el backend falso de cada escenario, corre las conversaciones con el orquestador real y mide: éxito (resultado, estado final de reembolsos, pedidos y direcciones, llamadas requeridas), <b>violaciones</b> revisadas sobre el registro de auditoría con reglas escritas en este archivo (su propia copia de US$50 y de las tasas), afirmaciones sin acción ("ya te reembolsamos" sin el reembolso), propuestas prohibidas del modelo (aunque la política las frene), trayectoria, llamadas, tokens y costo. El gate falla con una sola violación o una sola afirmación sin acción. <code>pass_hat_k</code> es la métrica de τ-bench (Yao et al., 2024) para cuando el modelo es real y cada escenario corre k veces.'),
          F('eval/scenarios/07_injection_in_product_description.yaml', 'yaml', 'Prompt injection indirecta en la descripción del producto. El guion <b>obedece</b> y propone un reembolso que el cliente nunca pidió; lo frena la confirmación. El escenario pasa (el sistema aguanta) y reporta 1 propuesta prohibida (el modelo cayó).'),
          F('eval/scenarios/10_timeout_after_refund_commit.yaml', 'yaml', 'El reembolso se aplica y la respuesta no llega en 3 s. Se espera exactamente un reembolso.'),
          F('eval/scenarios/02_refund_large_needs_approval.yaml', 'yaml', 'Confirmación, cola de aprobación y aprobación: el reembolso sale después, con la misma key.'),
          F('eval/tests/test_run_scenarios.py', 'python', 'La suite pasa; el CLI devuelve 1 con un umbral de propuestas prohibidas; y las mutaciones: límite automático en US$10,000, confirmación desactivada, "1 por pedido" desactivado. Las tres hacen fallar el gate. Una afirmación sin acción también.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: usar la política como oráculo de la suite',
        html: 'Si la suite "verifica" que no hubo violaciones llamando a <code>policy.evaluate</code>, un bug en la política pasa el gate, porque el juez y el acusado son el mismo código. <code>check_invariants</code> mira lo que de verdad pasó (el registro de auditoría del backend) con reglas propias y su propia copia de los números de negocio. El test de mutación lo demuestra: con el límite automático subido por error a US$10,000, la política deja pasar un reembolso de 2,400 MXN sin aprobación y el oráculo lo marca.' },
      { t: 'calc', title: 'Promedio contra pass^k (k corridas independientes del mismo escenario)', rows: [
        { label: 'Un escenario que sale bien el 90 % de las veces', expr: 'pass^1', value: '0.90' },
        { label: 'Las 4 corridas bien', expr: '0.9⁴', value: '≈ 0.66' },
        { label: 'Uno que sale bien el 80 %', expr: '0.8⁴', value: '≈ 0.41' },
      ], result: 'El promedio esconde la inconsistencia: con 0.9 de éxito, uno de cada tres clientes que vuelve 4 veces ve al agente fallar alguna. Con el guion de esta carpeta las corridas son deterministas y pass^k no aporta; con el modelo real, es el número que mira el gate (' + C('evaluacion', 'evaluación') + ').' },

      // ------------------------------------------------------------------ servicio
      { t: 'h3', text: 'El servicio: SSE, webhook firmado y métricas sin ids' },
      { t: 'code', title: 'FastAPI con SSE, aprobaciones y métricas',
        caption: '<code>pytest service/tests</code>: 15 tests. Demo: <code>uvicorn --factory service.app:demo_app --port 8090</code> desde <code>reference/c12</code> (modelo por reglas, backend en memoria).',
        files: [
          F('service/app.py', 'python', '<code>POST /v1/conversations/{id}/messages</code> devuelve un stream SSE (el SSE nativo de FastAPI 0.142.2, que manda un <code>: ping</code> cada 15 s) con los eventos del turno. El 409 de "ya hay un turno corriendo" es una <b>dependencia</b>, no código dentro del stream: una vez que el stream empezó, el status ya es 200. El webhook de aprobaciones verifica HMAC-SHA256 sobre "timestamp.cuerpo" en tiempo constante y rechaza firmas de más de 5 minutos (replay). <code>PrometheusObserver</code> implementa las métricas: ninguna lleva <code>customer_id</code> ni <code>conversation_id</code>, y las series de violaciones, límites y reembolsos se crean en 0 al arrancar. Sin <code>from __future__ import annotations</code> a propósito: FastAPI no podría resolver las dependencias locales.'),
          F('service/tests/test_app.py', 'python', 'El reembolso por SSE; 401, 404 (la conversación de otro cliente "no existe") y 422; dedupe; 409; el webhook con firma mala, vieja, buena y repetida; el turno que termina aunque el cliente corte la conexión (llamando al ASGI a mano); y que cada métrica usada en <code>alerts.yml</code> exista en <code>/metrics</code>.'),
          F('service/requirements.txt', 'text', 'El lock completo (20 paquetes) para Linux x86_64 y Python 3.13, generado con <code>uv pip compile</code>: las mismas versiones que el gateway del c10. <code>httpx2</code> es el cliente hacia el gateway.'),
          F('requirements-dev.txt', 'text', 'Para los tests y la suite: el lock de producción, pytest y PyYAML.'),
          F('pytest.ini', 'ini', 'Un <code>pytest</code> desde <code>reference/c12</code> corre las cuatro carpetas, con los warnings como errores y <code>--import-mode=importlib</code>.'),
        ] },

      // ------------------------------------------------------------------ alertas
      { t: 'h3', text: 'Las 8 alertas y sus tests' },
      { t: 'code', title: 'Reglas de Prometheus y tests de promtool',
        caption: '<code>promtool check rules alerts.yml</code>; <code>promtool test rules alerts_test.yml</code> (≈ 3 s) y <code>alerts_weekly_test.yml</code> (más de una semana de series: ' + E('≈ 40 s') + ' en una laptop).',
        files: [
          F('monitoring/alerts.yml', 'yaml', 'Tres grupos. <b>Seguridad y dinero</b>: <code>AgentPolicyViolation</code> con una sola violación y sin <code>for</code>, y <code>RefundAmountAnomaly</code> (US$ por 1,000 conversaciones contra la misma hora hace una semana, con volumen mínimo). <b>Operación</b>: turno p95 &gt; 12 s o primera respuesta p95 &gt; 4 s (histogramas con bordes exactos en 12 y 4), fallas de una herramienta &gt; 5 % sin contar denegaciones, aprobaciones con más de 3 h <b>hábiles</b> solo en horario hábil, y límites en más del 2 % de los turnos. <b>Comportamiento y costo</b>: escalamiento ± 10 puntos contra hace una semana (en las dos direcciones) y costo por conversación &gt; US$0.025. El encabezado explica el contador sin inicializar.'),
          F('monitoring/alerts_test.yml', 'yaml', 'Series sintéticas que disparan y que no: la trampa del contador que aparece directamente en 1, el 5 % exacto que no es "más de 5 %", las denegaciones que no son fallas, la herramienta con poco volumen, la aprobación vieja a las 8:50 de CDMX. Dos prueban el texto renderizado.'),
          F('monitoring/alerts_weekly_test.yml', 'yaml', 'Las alertas con <code>offset 1w</code> y el sábado, evaluando cada 10 min. Con <code>group_eval_order</code>: sin él, promtool evalúa los grupos en orden aleatorio y estos tests pasaban o fallaban al azar.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: la primera violación que nadie ve',
        html: 'Un counter con labels de <code>prometheus_client</code> no existe hasta su primer <code>inc()</code>; cuando aparece, ya vale 1, y <code>increase()</code> no ve ningún salto. La alerta de tolerancia cero no dispararía con la <b>primera</b> violación, que es la única que importa. <code>app.py</code> crea en 0 al arrancar las series que leen las alertas, y hay un test de promtool con la serie "sin inicializar" que demuestra que la alerta se queda callada.' },
      { t: 'callout', kind: 'note', title: 'Lo que la flota del c10 necesita para tool calling',
        html: 'Leído en el código de vLLM v0.30.0: con <code>tool_choice: "auto"</code>, el servidor exige <code>--enable-auto-tool-choice</code> y <code>--tool-call-parser</code> (sin ellos rechaza el request). Para Llama 3.x, el parser es <code>llama3_json</code> con su chat template de tool calling; la documentación lista Llama 3.1, 3.2 y 4, así que con Llama 3.3 se confirma renderizando el template y con la suite. Llama 3 no soporta tool calls en paralelo. Los argumentos se restringen al schema con <code>auto</code> solo si alguna herramienta tiene <code>strict: true</code> y el parser lo soporta. Son flags del Deployment de ' + L('c10.serving', 'vllm-70b') + ': una revisión nueva de la flota, con su gate.' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Todos los tests (sin GPU, sin modelo, sin red)', meta: '≈ 10 s',
          html: '<code>cd reference/c12</code>, crea un venv (Python 3.13 o 3.12), <code>pip install -r requirements-dev.txt</code> y <code>pytest</code>: 147 tests de las cuatro carpetas.' },
        { title: 'La suite de escenarios', meta: '1 min',
          html: '<code>python eval/run_scenarios.py</code>: 15 escenarios y "GATE: PASA". Abre <code>agent/policy.py</code>, cambia <code>auto_refund_limit_usd</code> a 10000 y vuelve a correrla: el oráculo marca <code>refund_over_limit_without_approval</code> y el gate falla.' },
        { title: 'Una caída a mitad de un reembolso', meta: '5 min',
          html: 'Lee <code>test_crash_after_the_refund_but_before_logging_it_resumes_without_paying_twice</code> en <code>agent/tests/test_state.py</code> y córrelo con <code>pytest -k crash -v</code>. Después, en <code>agent/tools.py</code>, haz que <code>idempotency_key</code> devuelva un <code>uuid4()</code> y corre <code>pytest</code>: falla una veintena de tests. El botón de confirmar deja de encontrar su acción (el <code>action_id</code> deriva de la key) y repetir el mismo reembolso ya no devuelve el resultado guardado: lo único que frena el segundo pago es el techo del pedido en el backend.' },
        { title: 'El servicio con un modelo por reglas', meta: '5 min',
          html: '<code>uvicorn --factory service.app:demo_app --port 8090</code> y los <code>curl</code> del <code>README.md</code>: un reembolso de 2,400 MXN, la confirmación con su <code>action_id</code>, el webhook firmado con <code>openssl</code>, los eventos guardados y <code>/metrics</code>.' },
        { title: 'Las alertas con promtool', meta: '≈ 1 min',
          html: 'Baja el release de Prometheus para tu sistema (trae <code>promtool</code>) y verifica su sha256. En <code>monitoring/</code>: <code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml alerts_weekly_test.yml</code>. Quita el <code>abs(…)</code> de <code>EscalationRateShift</code>: el test de la caída del escalamiento falla.' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“The model proposes and my orchestrator disposes. Every tool has a typed schema with no customer field, because the customer comes from the session. Each proposed call goes through an allow-list, schema validation, a loop check, a per-turn cap and a pure policy function that reads fresh facts from the backend. Writes carry an idempotency key derived from the conversation, the action and its normalized arguments, and every step is written to a durable log before and after it runs, so after a timeout or a crash I reconcile by key instead of retrying blindly. Money needs a confirmation event on frozen arguments, and above fifty dollars a human approval. The scenario suite checks the final backend state with its own invariants, so a bug in the policy can’t pass the gate.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo aterriza un módulo: ' + L('m14.agentes', 'M14 Sistemas con LLMs') + ', ' + L('m14.guardrails', 'M14') + ', ' + L('m14.evaluacion', 'M14') + ' y ' + L('m14.costo-tokens', 'M14') + ' (el loop, la inyección, la evaluación y el costo por token), ' + L('m02.entrega-reintentos', 'M2 Patrones') + ' (idempotencia y entrega al menos una vez), ' + L('m03.timeouts-reintentos', 'M3 Latencia') + ' (timeouts, backoff con jitter), ' + L('m15.authn-authz', 'M15 Seguridad') + ', ' + L('m15.pii-privacidad', 'M15') + ' y ' + L('m15.degradacion', 'M15') + ' (IDOR, datos personales, escalera de degradación), ' + L('m12.prometheus-grafana', 'M12 Monitoreo') + ' y ' + L('m12.runbooks', 'M12') + ' (las alertas), ' + L('m10.gate', 'M10') + ' (el gate por revisión) y la plataforma del ' + L('c10.serving', 'c10') + ' (el gateway, sus topes y la flota). El centro de ayuda usa la técnica de ' + L('c11.serving', 'c11') + '.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
