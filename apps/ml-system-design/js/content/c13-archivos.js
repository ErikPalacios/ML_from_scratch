/* =============================================================================
   Ronda de Diseño ML — js/content/c13-archivos.js
   Caso 13, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c13/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por pieza del camino del audio, con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8j. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección de este caso y cualquier página o sección del curso.
  const C = (sec, txt) => '<a href="#c13.' + sec + '">' + txt + '</a>';
  const L = (hash, txt) => '<a href="#' + hash + '">' + txt + '</a>';
  const E = (txt) => '<span class="est">' + txt + '</span>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c13/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c13/' + path, note });

  MSD.addSection('c13', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos de <code>reference/c13/</code>, probados hasta donde se puede sin GPU, sin un modelo de ASR y sin el SFU. Son seis piezas, en el orden en que viaja el audio: el chunker (frames de 20 ms → chunks de 160 ms, VAD y endpointing), el estabilizador de partials, el <code>asr-worker</code> (un WebSocket por participante con colas acotadas, límites, drain y métricas), el session router, el manifest de Kubernetes con su preStop y su autoscaling por streams activos, y la evaluación (WER con normalización en español y percentiles de latencia). Al final, las 8 alertas con sus tests. Cada línea importante trae un comentario con el <b>porqué</b>. Son la versión concreta de lo que defiendes en ' + C('serving', 'serving') + ', ' + C('evaluacion', 'evaluación') + ', ' + C('monitoreo', 'monitoreo') + ' y ' + C('fallas', 'fallas') + ': qué pasa cuando la GPU no va en tiempo real, cuando quien lee no lee, y cómo se apaga un worker que tiene 450 conversaciones abiertas sin que nadie lo note.' },
      { t: 'callout', kind: 'skip',
        html: 'En la entrevista nadie te pide escribir el VAD ni recordar los códigos de cierre. Primera pasada: el mapa, la línea de tiempo de una utterance y los callouts de trampas. Lo que sí debes poder decir sin mirar: solo el audio con voz llega a la GPU; el final sale con ' + E('≈ 600 ms') + ' de silencio, que es la mayor parte de su latencia; lo congelado no parpadea; el balanceo es por <b>streams activos</b>, no por conexiones; un worker se apaga <b>drenando</b> (readiness en falso, migrar en el próximo límite de utterance, y el período de gracia cubre el tope de una utterance); si la GPU se atrasa, se cierra la sesión para reabrirla en otro worker en lugar de acumular segundos de retraso; un final nunca se descarta; y el WER es Σ errores ÷ Σ palabras, con la normalización escrita.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (macOS, sin GPU, sin modelo, sin SFU, sin cluster y sin daemon de Docker): 76 tests de las cuatro carpetas con pytest en venvs limpios con Python 3.13.15 y 3.12.14, seis corridas seguidas en cada uno sin fallas. El chunker con tonos, ruido y silencio de tiempos calculados a mano. El <code>asr-worker</code> con TestClient (un WebSocket real en proceso) y un modelo falso: camino feliz, handshakes inválidos, worker lleno, reconexión, inactividad, duración máxima, drain con una sesión callada y otra hablando, GPU atrasada, modelo que falla y consumidor lento. Cada caso cierra con el código esperado. La demo con uvicorn real y un cliente de <code>websockets</code>: partials y finales, el drain con alguien hablando (sale su final, después <code>migrate</code> y 1012) y un <code>kill -TERM</code> que el cliente ve como 1012. <code>promtool check rules</code> y <code>promtool test rules</code> de Prometheus 3.15.0 (binario oficial con sha256 verificado): las 8 alertas disparan o no con series sintéticas. Doce mutaciones de umbrales, ventanas y filtros hacen fallar algún test. El manifest pasó <code>kubernetes-validate --strict</code> (1.36) en sus recursos core. El ScaledObject y el PodMonitor pasaron el esquema de sus CRDs (KEDA v2.21.0, Prometheus Operator v0.94.1).</li>' +
          '<li><b>No ejecutado</b>: no hay adaptador de un modelo real. <code>build_app</code> lanza <code>NotImplementedError</code> y documenta qué conectar (Riva, NeMo o Triton con sequence batching), porque no se publica código de red sin probar. La capacidad por L4 y el tiempo del paso son las estimaciones del caso. El VAD solo vio señales sintéticas, nunca voz real. No hay imagen ni Dockerfile, y el manifest no corrió en un cluster: ni el preStop real, ni KEDA, ni el PDB. El router vive en memoria, en un proceso. Los umbrales son ilustrativos. El <code>README.md</code> de <code>reference/c13</code> trae la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>chunker.py</code> <small>streaming</small>', C('serving', '7 · Serving') + ', ' + C('costo', '12 · Costo'), 'Re-encuadre a 20 ms, VAD por energía con piso adaptativo, onset y hangover; chunks de 160 ms con contexto izquierdo y pre-roll; endpointing a 600 ms y tope de 20 s por utterance'],
          ['<code>stabilizer.py</code> <small>streaming</small>', C('serving', '7 · Serving') + ', ' + C('evaluacion', '8 · Evaluación'), 'Congelar palabras de más de 800 ms (con el texto que ya estaba en pantalla), correcciones del final y la tasa de revisiones'],
          ['<code>asr_server.py</code> <small>server</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas') + ', ' + C('monitoreo', '9 · Monitoreo'), '<code>StreamSession</code>: leer, procesar y escribir con colas acotadas; qué se descarta y qué nunca; límites por sesión; drain; métricas; el log de latencias muestreado sin texto ni audio'],
          ['<code>session_router.py</code> <small>gateway</small>', C('arquitectura', '5 · Arquitectura') + ', ' + C('fallas', '10 · Fallas'), 'Capacidad por worker, spread contra pack, sticky, drain, worker perdido con reconexiones contadas, rebalanceo acotado en los límites de utterance'],
          ['<code>asr-worker.yaml</code> <small>k8s</small>', C('serving', '7 · Serving') + ', ' + L('m06.keda', 'M6'), 'Service headless, preStop que drena y la cuenta del período de gracia, PDB, KEDA por streams activos con cron para la mañana y fallback'],
          ['<code>wer.py</code> <small>eval</small>', C('evaluacion', '8 · Evaluación'), 'Levenshtein con S/D/I, normalización en español (números, tildes, Unicode), WER del corpus contra el promedio, slices con soporte mínimo, percentiles de eventos'],
          ['<code>alerts.yml</code>, <code>alerts_test.yml</code> <small>monitoring</small>', C('monitoreo', '9 · Monitoreo') + ', ' + L('m12.runbooks', 'M12'), 'Las 8 alertas del caso, sus recording rules y los tests de promtool'],
        ],
        note: 'Orden de lectura sugerido: <code>chunker.py</code> → <code>stabilizer.py</code> → <code>asr_server.py</code> → <code>test_asr_server.py</code> → <code>session_router.py</code> → <code>asr-worker.yaml</code> → <code>wer.py</code> → <code>alerts.yml</code>. Primero lo que le pasa a una utterance, después cómo se reparten las sesiones y cómo se apaga un worker, y al final cómo se mide.' },
      { t: 'table', caption: 'Una utterance de punta a punta (tiempos del caso, ' + E('estimados') + ')',
        head: ['Cuándo', 'Qué pasa', 'Dónde'],
        rows: [
          ['t = 0', 'Ana empieza a hablar; su cliente manda Opus en frames de 20 ms al SFU', '—'],
          ['+ ' + E('≈ 80 ms'), 'El fork de audio decodifica, remuestrea a 16 kHz mono y manda PCM16 de 20 ms (640 bytes)', 'SFU'],
          ['+ 40 ms', 'Dos frames seguidos con voz (onset): se abre la utterance con 100 ms de pre-roll', '<code>chunker.py</code>'],
          ['+ ≤ 160 ms', '8 frames → un chunk → cola de entrada → paso del modelo → estabilizador → <code>partial</code>', '<code>asr_server.py</code>'],
          ['cada 160 ms', 'Un partial nuevo; las palabras que terminaron hace más de 800 ms de audio se congelan (<code>stable_words</code>)', '<code>stabilizer.py</code>'],
          ['fin de la voz + 600 ms', 'Silencio de endpointing → <code>finalize()</code> → <code>final</code>. La latencia del final se mide desde el último frame con voz', '<code>asr_server.py</code>'],
        ],
        note: 'Medido en la demo (modelo falso de 30 ms por paso, un stream): partials p50 ≈ 30 ms y finales ≈ 0.81 s server-side. Los 600 ms de silencio son casi todo el final. Con el modelo real, el paso y las colas dominan los partials: mídelo con carga sintética.' },

      // ------------------------------------------------------------------ chunker
      { t: 'h3', text: 'El chunker: qué audio llega a la GPU y cuándo hay final' },
      { t: 'code', title: 'Frames de 20 ms → chunks de 160 ms, VAD y endpointing',
        caption: 'numpy, sin I/O. <code>pytest streaming/tests</code>: 17 tests (chunker y estabilizador) en ≈ 3 s.',
        files: [
          F('streaming/chunker.py', 'python', 'Tres clases. <code>Reframer</code> corta bytes en frames exactos de 320 muestras y guarda el resto, incluido un byte impar: un paquete partido por la red no se pierde. <code>EnergyVAD</code> compara la energía del frame con un piso de ruido que <b>baja rápido y sube despacio</b> (2 dB/s, también durante "voz"): el silencio real se aprende en ' + E('≈ 200 ms') + ' y un ventilador nuevo deja de ser voz en segundos, sin que un pico de voz arrastre el piso. Onset de 2 frames (un clic no abre una utterance) y hangover de 200 ms (no corta las colas de palabra). <code>StreamChunker</code> no manda nada fuera de una utterance. Al abrirla incluye 100 ms de pre-roll (el VAD reacciona tarde y la primera sílaba es débil). Dentro de la utterance manda <b>todo</b>, también los silencios cortos: el modelo necesita el audio de después de la última palabra para cerrarla. Cierra con 600 ms de silencio después de la última voz cruda, con el tope de 20 s o al terminar el stream. El contexto izquierdo es configurable: 0 para un modelo cache-aware, que guarda su contexto; más para uno sin estado entre llamadas. El docstring dice los límites del VAD por energía y qué probar después (WebRTC VAD, Silero), medido por slice.'),
          F('streaming/tests/test_chunker.py', 'python', 'Señales sintéticas con tiempos a mano: un seno de amplitud 0.1 tiene −23.0 dBFS; el VAD abre en el frame 26 (el tono empieza en el 25 y el onset pide 2) y cierra 10 frames después del final del tono; un clic de 20 ms no abre nada. Un ventilador de −40 dBFS deja de ser voz entre 8.5 y 11.5 s después, y un tono posterior se sigue detectando. Una utterance de 1 s da 11 chunks contiguos (10 de 160 ms y uno de 100), un final a 1,500 ms y su detección a 2,100. Una pausa de 400 ms no parte la utterance y una de 800 sí. El contexto izquierdo repite exactamente los 16 frames anteriores. Un monólogo de 5 s con tope de 2 s se parte en tres sin mandar dos veces el mismo audio. El silencio no produce ni un chunk.'),
        ] },
      { t: 'calc', title: 'Por qué el VAD es la primera palanca de costo (números del caso, ' + E('estimados') + ')', rows: [
        { label: 'Pistas conectadas en el pico', expr: '50k reuniones × ≈ 4 participantes', value: '≈ 200k' },
        { label: 'Streams con voz en el pico', expr: '50k reuniones × ' + E('≈ 1.2') + ' hablantes activos', value: '≈ 60k' },
        { label: 'GPUs sin VAD', expr: '200k ÷ 350 streams por L4', value: '≈ 572 L4' },
        { label: 'GPUs con VAD', expr: '60k ÷ 350', value: '≈ 172 L4' },
      ], result: 'El VAD corre en CPU, sobre cada frame de cada pista, y decide qué llega a la GPU: ' + E('≈ 3.3×') + ' menos GPUs. Por eso un VAD que se rompe en silencio es una alerta (<code>VADActiveRatioShift</code>): hacia arriba es costo y texto basura; hacia abajo, captions que faltan sin ningún error.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: medir el silencio de endpointing desde el último frame "con voz" del VAD',
        html: 'El VAD con hangover dice "voz" 200 ms más después de que la persona calló. Si el endpointing contara desde esa decisión, cada final llegaría 200 ms más tarde sin que nadie lo decidiera. En <code>chunker.py</code>, el silencio se cuenta desde la última voz <b>cruda</b> (el frame que de verdad superó el umbral); el hangover solo decide si se abre una utterance. Son dos preguntas distintas: "¿sigue hablando?" y "¿terminó la frase?".' },

      // ------------------------------------------------------------------ estabilizador
      { t: 'h3', text: 'El estabilizador: lo que se ve no parpadea' },
      { t: 'code', title: 'Partials con prefijo congelado y la tasa de revisiones',
        caption: 'Python puro. Lo usa <code>asr_server.py</code> para el campo <code>stable_words</code> de cada partial.',
        files: [
          F('streaming/stabilizer.py', 'python', 'Una palabra se congela cuando terminó hace más de <code>freeze_after_ms</code> (800 ms, ilustrativo) de audio y todas las anteriores ya están congeladas. El detalle que importa: se congela con el texto que <b>estaba en pantalla</b> en esa posición, no con la última opinión del modelo. Congelar significa "lo que viste no cambia". La cola se busca por tiempo (<code>start_ms</code> después de lo congelado), no por índice: si el modelo junta o parte palabras viejas, el índice se corre y el tiempo no. El final reemplaza todo y cuenta cuántas palabras congeladas corrigió. <code>revision_stats</code> cuenta palabras mostradas que en la pantalla siguiente cambiaron o desaparecieron; agregar al final no es revisión.'),
          F('streaming/tests/test_stabilizer.py', 'python', 'El ejemplo del docstring paso a paso: "el gato" → "el | pato se" → "el pato | se sentó" (se congela "pato", lo que estaba en pantalla, aunque el modelo ya diga "plato") y el final corrige una palabra. Las revisiones bajan de 3 (0.75) a 2 (0.5). 60 pasos con flicker aleatorio en todas las palabras sin que el prefijo congelado cambie nunca.'),
        ] },
      { t: 'callout', kind: 'senior', title: 'Señal senior: el estabilizador vive del lado del servidor',
        html: 'Si cada cliente estabilizara por su cuenta, dos personas de la misma reunión verían textos distintos, y una que se reconecta vería otro. El worker decide qué está congelado (<code>stable_words</code>) y todos los clientes muestran lo mismo: congelado normal y tentativo en gris. Y la decisión se mide con dos números juntos, por idioma: tasa de revisiones (cuánto baila) y correcciones del final (cuánto se equivocó lo congelado).' },

      // ------------------------------------------------------------------ asr-worker
      { t: 'h3', text: 'El asr-worker: una sesión, tres tareas, dos colas acotadas' },
      { t: 'code', title: 'FastAPI WebSocket con backpressure, límites, drain y métricas',
        caption: '<code>cd reference/c13 &amp;&amp; pytest server/tests</code>: 20 tests en ≈ 4 s. Demo: <code>PYTHONPATH=../streaming uvicorn --factory asr_server:demo_app --port 8080</code> desde <code>server/</code>.',
        files: [
          F('server/asr_server.py', 'python', 'Léelo desde <code>StreamSession.run</code>. El lector re-encuadra el audio, pasa cada frame por el chunker y encola chunks; el procesador llama al modelo y al estabilizador; el escritor manda JSON. <b>Entrada acotada</b>: si el modelo va más de 12 chunks atrás (' + E('≈ 2 s') + ' de audio), la GPU no da abasto y la sesión se cierra con 1013 para que el gateway la reabra en otro worker. Mientras va atrás pero dentro del límite, procesa todo el audio y solo muestra el partial más nuevo. <b>Salida acotada</b>: si quien consume no lee, se descartan los partials más viejos; un final no se descarta nunca, y si no cabe ni así, 1013. Límites: 30 s sin un frame (la pista murió) y 4 h por sesión. El drain lo pide el preStop a <code>/admin/drain</code>, que solo acepta localhost. <code>/readyz</code> pasa a 503, y cada sesión migra en su próximo límite de utterance: las calladas, ya. La latencia se mide hasta que el mensaje se escribe al socket, no hasta que se encola. El log por sesión no lleva texto ni audio; el 1 % de las sesiones (por hash del <code>session_id</code>) loguea la latencia de cada mensaje. La interfaz <code>ASRModel</code> supone una secuencia por utterance: la caché de GPU existe entre el primer <code>step()</code> y <code>finalize()</code>.'),
          F('server/tests/test_asr_server.py', 'python', 'Cada test es una situación de operación. 1 s de voz da partials con <code>seq</code> creciente y un final con 11 palabras y sus tiempos (400–2,100 ms). Puro silencio no hace ni un paso de modelo. Audio antes del JSON, un idioma no lanzado, 48 kHz sin remuestrear o un handshake sin <code>session_id</code> cierran con 1008. Un worker lleno responde 1013. Las reconexiones se cuentan con un label acotado. A los 0.3 s sin audio cierra por inactividad, y la duración máxima corta sin timers extra. En el drain, la sesión callada migra ya y la que habla después de su final; una sesión nueva se rechaza. Pasos de 200 ms (más que los 160 de audio) cierran con 1013. El modelo que falla cierra una sola sesión con 1011. Un consumidor lento pierde partials y recibe todos los finales. Y un test lee <code>alerts.yml</code> y exige que cada <code>asr_*</code> exista en <code>/metrics</code>.'),
          F('server/requirements.txt', 'text', 'El lock completo (19 paquetes), generado con <code>uv pip compile</code> para Linux x86_64 y Python 3.13. <code>websockets</code> está porque sin una implementación de WebSocket uvicorn no acepta conexiones WebSocket. No incluye el runtime del modelo: depende del adaptador.'),
          F('requirements-dev.txt', 'text', 'Para los tests: el lock de producción más pytest y <code>httpx2</code>, el cliente que usa el TestClient de Starlette 1.x.'),
          F('pytest.ini', 'ini', 'Un <code>pytest</code> desde <code>reference/c13</code> corre las cuatro carpetas; cada una entra al <code>sys.path</code>, así <code>asr_server</code> importa <code>chunker</code> y <code>stabilizer</code> como en la imagen, donde los tres están en <code>/app</code>.'),
        ] },
      { t: 'table', caption: 'Los códigos de cierre son contrato con el gateway',
        head: ['Código', 'Cuándo lo manda el worker', 'Qué hace el gateway'],
        rows: [
          ['1000', '<code>stop</code>, 30 s sin un frame, 4 h de sesión', 'nada, o reabrir con <code>reconnect_reason=max_duration</code> si la reunión sigue'],
          ['1008', 'handshake inválido', 'no reintentar igual: es un bug del cliente'],
          ['1011', 'el modelo falló en esa sesión', 'reabrir en otro worker'],
          ['1012', 'drain (después de <code>migrate</code>) o SIGTERM de uvicorn', 'reabrir en otro worker; <code>migrate</code> es planeado y no cuenta para la alerta'],
          ['1013', 'worker lleno, drenando, ' + E('≈ 2 s') + ' atrás del tiempo real o consumidor que no lee', 'reabrir en otro worker'],
        ],
        note: '1000, 1008 y 1011 están en la RFC 6455; 1012 y 1013, en el registro de IANA. El código permite que el gateway distinga "reintenta en otro lado" de "no reintentes", y que la métrica de reconexiones separe lo planeado de lo que no.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: la cola que crece en silencio',
        html: 'Un <code>asyncio.Queue()</code> sin límite entre el socket y el modelo nunca falla: si la GPU procesa 160 ms de audio en 200 ms, la cola crece 40 ms por chunk y los captions llegan cada vez más tarde, sin un error ni un log. Diez minutos después, esa sesión va dos minutos atrasada. Un sistema en tiempo real necesita una regla explícita para cuando no da abasto. Aquí son dos: saltar partials intermedios mientras alcance, y cerrar con 1013 cuando el atraso pasa de ' + E('≈ 2 s') + ', para que la sesión se reabra en una GPU con lugar. Es la misma lección de colas de ' + L('m03.colas-utilizacion', 'M3') + ': con utilización ≥ 1, la cola no tiene techo.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: confiar en que el SIGTERM da tiempo de cerrar bien',
        html: 'Con SIGTERM, uvicorn 0.54 cierra cada WebSocket con 1012 <b>antes</b> de correr el shutdown de la app: un handler de apagado que "termina las frases" nunca llega a ejecutarse. Está en su código y se probó con la demo (<code>kill -TERM</code> y el cliente recibe 1012). Por eso el corte limpio lo da el drain del preStop, que ocurre antes del SIGTERM. Lo que quede abierto al final se reabre en otro worker y pierde ' + E('≈ 1–2 s') + ' de partials.' },

      // ------------------------------------------------------------------ router
      { t: 'h3', text: 'El session router: balancear por estado, no por conexiones' },
      { t: 'code', title: 'Capacidad, sticky, drain, pérdida de un worker y rebalanceo',
        caption: 'Biblioteca estándar. <code>pytest gateway/tests</code>: 10 tests.',
        files: [
          F('gateway/session_router.py', 'python', 'Las 6 reglas del docstring. Cada worker acepta hasta su capacidad (<code>MAX_STREAMS</code> = 450). <b>Spread</b> elige el que tiene más lugares libres (baja latencia); <b>pack</b>, el que tiene menos pero alguno (deja workers vacíos para apagar barato). Se ofrece para comparar, no es la default. Una sesión asignada se queda en su worker toda su vida. Un worker que drena no recibe nada nuevo y sus sesiones se mueven en su próximo límite de utterance. Uno perdido reparte sus sesiones ya, con una reconexión más cada una, y las que no caben quedan en <code>unplaced</code> (la reunión sigue, sin captions). El rebalanceo solo <b>planea</b>: de un worker sobre el 90 % a uno bajo el 60 %, con un tope de movimientos por ronda, y cada movimiento se aplica en el límite de utterance de esa sesión. <code>utilization()</code> divide por la capacidad de los que aceptan: es la señal de <code>ASRCapacityHeadroomLow</code>.'),
          F('gateway/tests/test_session_router.py', 'python', 'Spread reparte 2-2-2 y pack llena 4-2-0. La misma sesión vuelve al mismo worker. Sin lugar, <code>NoCapacity</code> explícito. Un drain deja a w1 sin sesiones nuevas y migra las suyas con una reconexión contada. Al perder w2 sus tres sesiones caben en w1 y w3; al perder w3 después, sus cuatro quedan sin lugar. Después de un scale-out con dos workers llenos (20 de 20), el plan mueve 3, alterna donantes y no toca nada hasta aplicarse; sin tope, se detiene cuando nadie pasa del 90 %. Un movimiento cuya sesión ya terminó no se aplica.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: "pongo un balanceador y que reparta"',
        html: 'Un balanceador reparte <b>conexiones nuevas</b>. Las sesiones duran horas: el worker que arrancó a las 9:00 tiene 400 sesiones largas y el que llegó a las 11:00, 30. Ninguna métrica de CPU lo muestra, porque lo que satura es la GPU. El router decide con streams activos y libres por worker, y el gateway se conecta directo al pod (Service headless, ' + L('m07.protocolos', 'M7') + '). Y el rebalanceo no corta a nadie: mueve en los límites de utterance, donde no hay estado que perder.' },

      // ------------------------------------------------------------------ k8s
      { t: 'h3', text: 'Kubernetes: preStop, período de gracia y autoscaling por streams' },
      { t: 'code', title: 'Service headless, Deployment GPU, PDB, PodMonitor y ScaledObject de KEDA',
        caption: 'Recursos core validados con <code>kubernetes-validate --strict</code> (1.36); el ScaledObject y el PodMonitor, contra el esquema de sus CRDs. No corrió en un cluster.',
        files: [
          F('k8s/asr-worker.yaml', 'yaml', 'El Service es <b>headless</b>: el router necesita la lista de pods Ready para elegir uno por capacidad, y un pod que drena sale de la lista mientras sus conexiones abiertas siguen. El Deployment no fija réplicas (las pone KEDA); un pod por L4 en <code>g6.xlarge</code> (' + E('≈ US$0.80/h') + ' on-demand en us-east-1, verifica), sin límite de CPU (el throttling se ve como latencia), con readiness cada 5 s y <code>failureThreshold: 1</code>: drenar es una decisión, no un síntoma. El preStop es <code>exec</code> porque tiene que <b>esperar</b>: corre <code>asr_server.py drain</code>, que pide el drain y sondea hasta que no queden streams o pasen 60 s. El PDB limita los drains de nodos a 5 % de los workers a la vez. El ScaledObject escala por <code>sum(asr_active_streams)</code> con objetivo 350 por pod (AverageValue: 60,000 ÷ 350 = 171.4 → 172), de 20 a 220 pods. Sube +20 % o 10 pods por minuto y baja de a 5 cada 5 min con una ventana de 20. Un trigger cron fija un mínimo de 120 de 7:30 a 11:00 entre semana, y el fallback hace max(actuales, 120) si Prometheus no contesta.'),
        ] },
      { t: 'calc', title: 'El período de gracia, contado', rows: [
        { label: 'Peor caso hasta un límite de utterance', expr: 'tope de 20 s + 600 ms de endpointing', value: '≈ 20.6 s' },
        { label: 'Drain del preStop (DRAIN_TIMEOUT_S)', expr: '≈ 3× el peor caso', value: '60 s' },
        { label: 'Sondeo y arrancar Python', expr: '≈ 2 s + ≈ 1 s', value: '≈ 3 s' },
        { label: 'Apagado de uvicorn', expr: '<code>--timeout-graceful-shutdown</code>', value: '10 s' },
        { label: 'terminationGracePeriodSeconds', expr: '60 + 3 + 10 + margen', value: '90 s' },
      ], result: 'El reloj del período de gracia empieza <b>antes</b> del preStop (documentación de Kubernetes): el preStop y la parada del contenedor tienen que caber juntos. Con los 30 s por defecto, un worker en medio de una utterance larga se cortaría. Y si los 90 s no alcanzan, el SIGKILL solo cuesta ' + E('≈ 1–2 s') + ' de partials a quien quedaba: el costo de quedarse corto está acotado.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: "con un PodDisruptionBudget, el scale-in es seguro"',
        html: 'Un PDB limita las disrupciones <b>voluntarias</b> que pasan por la API de eviction: drains de nodos en un upgrade, consolidación de Karpenter. El HPA que baja réplicas no hace evictions, y una caída de nodo o una interrupción de spot tampoco. Lo que pone el ritmo del scale-in es el <code>behavior</code> del ScaledObject (de a 5 pods cada 5 min), y lo que lo hace invisible es el preStop. Y qué pod sale lo elige el ReplicaSet, no el HPA: <code>controller.kubernetes.io/pod-deletion-cost</code> (beta, de mejor esfuerzo) puede preferir los más vacíos, pero la documentación pide no actualizarla seguido con una métrica.' },
      { t: 'callout', kind: 'senior', title: 'Señal senior: el autoscaler llega tarde a las 9:00',
        html: 'La métrica de streams reacciona en minutos, y un nodo GPU tarda otros minutos en servir (' + L('m06.cold-starts', 'M6') + '). A las 9:00 empiezan miles de reuniones en el mismo minuto. El diseño tiene tres capas: el 30 % de margen de cada GPU (350 de objetivo contra 450 de tope), un cron que sube el mínimo antes de la rampa y un fallback que, si Prometheus no contesta, no baja la flota a ciegas. Decirlo con números ("I target 350 streams per GPU with a hard cap of 450, so the fleet absorbs a 28 % jump while new nodes boot") es lo que separa un plan de capacidad de un <code>maxReplicas</code>.' },

      // ------------------------------------------------------------------ WER
      { t: 'h3', text: 'Evaluación: WER sin engañarse y percentiles de eventos' },
      { t: 'code', title: 'Levenshtein con S/D/I, normalización en español, corpus, slices y latencias',
        caption: 'Biblioteca estándar. <code>pytest eval/tests</code>: 29 tests con casos calculados a mano. <code>python eval/wer.py</code> imprime los ejemplos.',
        files: [
          F('eval/wer.py', 'python', 'El docstring empieza con el ejemplo a mano ("el gato se sentó" contra "el pato se sentó en": 1 S + 1 I sobre 4 = 0.50). La normalización se aplica igual a referencia e hipótesis. Primero NFC, para que "ó" compuesta y "o" + acento combinante sean lo mismo. Después minúsculas, separadores de miles, "%" como palabras, puntuación y símbolos fuera (¿ ¡ « » incluidos) y números en palabras (2026 → "dos mil veintiséis", 21000 → "veintiún mil"). El plegado de tildes es opcional y conserva la ñ: "año" y "ano" son palabras distintas. <code>corpus_wer</code> suma errores y palabras. <code>by_slice</code> reporta cada valor de cada dimensión con su soporte y marca los que tienen menos de 1,000 palabras. <code>latency_percentiles</code> usa nearest-rank sobre todos los eventos y lee el log muestreado del worker.'),
          F('eval/tests/test_wer.py', 'python', 'Borrados, WER mayor que 1 (3 inserciones sobre "sí"), referencia vacía. La misma frase da 4/6 sin normalizar números, 1/8 normalizándolos y 0 plegando tildes. Diecisiete números escritos a mano, de "cero" a "novecientos noventa y nueve mil novecientos noventa y nueve", con "cien" y "ciento uno", "veintiún mil" y "treinta y un mil". El corpus contra el promedio (1 % contra 50 %). Slices con soporte insuficiente. Percentiles de 1,020 eventos contra el promedio de los p95 por sesión. Un log con un traceback en medio.'),
        ] },
      { t: 'calc', title: 'La misma frase, tres WER ("¿Está listo el reporte de 2026?" contra "esta listo el reporte de dos mil veintiséis")', rows: [
        { label: 'Sin normalizar números', expr: 'está→esta, 2026→dos (2 S) + mil, veintiséis (2 I) ÷ 6', value: '0.667' },
        { label: 'Números en palabras', expr: 'está→esta (1 S) ÷ 8', value: '0.125' },
        { label: 'Plegando tildes', expr: '0 ÷ 8', value: '0.000' },
      ], result: 'El modelo es el mismo y el audio también: lo que cambió es la regla. Por eso la normalización se versiona y se reporta junto al número, y el WER se da con y sin plegado de tildes: en español "esta" y "está" no significan lo mismo.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: el promedio de los WER por utterance',
        html: 'Utterance A: "sí", transcrita "no" (100 %). Utterance B: 99 palabras perfectas (0 %). El promedio da <b>50 %</b>; el WER del corpus, Σ errores ÷ Σ palabras, da 1 ÷ 100 = <b>1 %</b>. En captions abundan las utterances de una palabra ("sí", "ajá", "ok"), así que el promedio exagera justo las que menos texto tienen. Lo mismo con la latencia: el promedio de los p95 de cada sesión no es el p95 de nadie (en el test, 500 ms contra 100 ms del p95 de los eventos).' },

      // ------------------------------------------------------------------ alertas
      { t: 'h3', text: 'Las 8 alertas y sus tests' },
      { t: 'code', title: 'Reglas de Prometheus y tests de promtool',
        caption: '<code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code> (≈ 16 s: simula hasta una semana y 5 h de series).',
        files: [
          F('monitoring/alerts.yml', 'yaml', 'El encabezado trae el presupuesto del partial (' + E('≈ 80 + 20 + 160 + 150 + 90 ≈ 500 ms') + ') y por eso las alertas de latencia miran el tramo del server: partials a 200 ms y finales a 1.2 s (que incluyen los 600 ms de endpointing). <code>GPUStreamSaturation</code> es por pod: p95 del paso del modelo sobre 128 ms, el 80 % de los 160 ms de audio que procesa. <code>SessionReconnectRateHigh</code> excluye las migraciones planeadas, y su <code>for</code> de 15 min es más largo que su ventana de 10 a propósito: la caída de un worker no alcanza a disparar y un problema sostenido sí. <code>ASRCapacityHeadroomLow</code> tiene una rama <code>absent()</code> con <code>cause="no_metrics"</code>: sin métricas, el autoscaling y todas las alertas están ciegos. <code>CanaryWERRegression</code> exige ≥ 5,000 palabras de referencia. <code>VADActiveRatioShift</code> compara con la misma hora de la semana pasada usando <code>offset</code> sobre los contadores crudos.'),
          F('monitoring/alerts_test.yml', 'yaml', 'Series sintéticas con el minuto en que cada alerta pasa a firing y casos que no deben disparar: un 3 % de partials lentos, el pod sano al lado del saturado, la caída de un worker (450 reconexiones de golpe), las migraciones del drain, un canario 10 puntos peor con solo 800 palabras y una semana sin cambios en el VAD. La rama sin métricas prueba también el texto renderizado: dice "sin métricas", no "capacidad al 100 %". Ese bug lo encontró la primera corrida de estos tests, junto con un "+18m" en el resumen del canario (<code>humanize</code> usa prefijos SI: 0.018 → 18m).'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: alertar con el SLO de punta a punta',
        html: 'El SLO dice 500 ms de la palabra a la pantalla. Una alerta a 500 ms sobre la métrica del server no dispararía nunca a tiempo, porque el server solo tiene ' + E('≈ 150 ms') + ' de ese presupuesto; y una sobre la latencia del cliente mezcla Wi-Fi, celulares y relojes, y cuando sube no dice qué arreglar. Cada tramo tiene su presupuesto y su alerta (server, caption-bus); el p95 de punta a punta se mira en el dashboard del SLO (' + L('m12.sistema', 'M12') + ', ' + L('m03.presupuesto', 'M3') + ').' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Todos los tests (sin GPU, sin modelo, sin SFU)', meta: '≈ 10 s',
          html: '<code>cd reference/c13</code>, crea un venv (Python 3.13 o 3.12), <code>pip install -r requirements-dev.txt</code> y <code>pytest</code>: 76 tests de las cuatro carpetas. <code>python eval/wer.py</code> imprime los tres WER de la misma frase y el corpus contra el promedio.' },
        { title: 'La demo del worker', meta: '2 min',
          html: 'En <code>server/</code>: <code>PYTHONPATH=../streaming uvicorn --factory asr_server:demo_app --port 8080</code>. En otra terminal: <code>PYTHONPATH=../streaming python asr_server.py demo-client</code> (unos 5 s de audio sintético a ritmo real; imprime partials, finales y el cierre). Mira <code>curl -s localhost:8080/metrics | grep \'^asr_\'</code>.' },
        { title: 'Un drain de verdad', meta: '1 min',
          html: 'Con el demo-client hablando, en una tercera terminal: <code>PORT=8080 PYTHONPATH=../streaming python asr_server.py drain</code>. El cliente recibe el final de su frase, después <code>migrate</code> y el cierre 1012; <code>/readyz</code> queda en 503. Es lo que hace el preStop.' },
        { title: 'Las latencias desde el log', meta: '1 min',
          html: 'La demo loguea la latencia de cada mensaje. Guarda la salida de uvicorn en un archivo y pásalo por <code>wer.read_latency_log</code> y <code>wer.latency_percentiles</code>: p50, p95 y p99 por tipo. Sube el <code>step_delay_s</code> de <code>demo_app</code> a 0.2 (más que los 160 ms de audio que procesa cada paso): los partials se atrasan y crece <code>asr_dropped_messages_total{reason="behind"}</code>. Con el habla corta de la demo, el silencio entre frases alcanza a vaciar la cola; el cierre con 1013 de un atraso sostenido lo muestra <code>test_gpu_behind_real_time_closes_with_try_again_later</code>.' },
        { title: 'Las alertas con promtool', meta: '≈ 20 s',
          html: 'Baja el release de Prometheus para tu sistema (trae <code>promtool</code>) y verifica su sha256. En <code>monitoring/</code>: <code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code>. Cambia el <code>for: 15m</code> de <code>SessionReconnectRateHigh</code> a <code>5m</code> y vuelve a correr: la caída de un solo worker ya dispara, y el test lo marca.' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“Each participant’s track is a long-lived session pinned to one GPU worker. Voice activity detection on CPU decides what reaches the GPU, and an utterance ends after six hundred milliseconds of silence, which is most of the final latency. Both queues in a session are bounded: if the model falls more than two seconds behind real time, the worker closes the session with try-again-later so the gateway reopens it on a GPU with room, and a slow reader loses partials but never finals. Workers scale on active streams, with a preStop hook that drains them: readiness goes false, sessions migrate at their next utterance boundary, and the grace period covers the twenty-second utterance cap.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo aterriza un módulo: ' + L('m02.streaming', 'M2 Patrones') + ' (conexiones largas y streaming), ' + L('m03.presupuesto', 'M3 Latencia') + ' y ' + L('m03.colas-utilizacion', 'M3') + ' (el presupuesto por tramo y la cola que no tiene techo), ' + L('m06.keda', 'M6 Orquestación') + ', ' + L('m06.cold-starts', 'M6') + ' y ' + L('m06.alta-disponibilidad', 'M6') + ' (KEDA, nodos GPU que tardan, PDB), ' + L('m07.fastapi', 'M7 Serving') + ' y ' + L('m07.protocolos', 'M7') + ' (WebSocket y Service headless), ' + L('m11.canary', 'M11 Despliegue') + ' (el canario con audio dorado), ' + L('m12.prometheus-grafana', 'M12 Monitoreo') + ' y ' + L('m12.runbooks', 'M12') + ' (las alertas) y ' + L('m15.degradacion', 'M15') + ' y ' + L('m15.pii-privacidad', 'M15') + ' (cerrar una sesión sin tocar la reunión; ni texto ni audio en los logs).' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
