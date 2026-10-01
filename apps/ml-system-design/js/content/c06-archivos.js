/* =============================================================================
   Ronda de Diseño ML — js/content/c06-archivos.js
   Caso 06, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c06/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por capa, con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8f. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección de este caso y cualquier página o sección del curso.
  const C = (sec, txt) => '<a href="#c06.' + sec + '">' + txt + '</a>';
  const L = (hash, txt) => '<a href="#' + hash + '">' + txt + '</a>';
  const E = (txt) => '<span class="est">' + txt + '</span>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c06/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c06/' + path, note });

  MSD.addSection('c06', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos de <code>reference/c06/</code>, probados hasta donde se puede sin Triton, sin Kafka y sin un cluster. Hay seis piezas: la config versionada de umbrales y el <code>decision-engine</code> que la aplica, el índice de hashes PDQ, el <code>mod-gateway</code> con su presupuesto de 120 ms y su fail-open, la prioridad de la cola de revisión humana, las métricas de calidad con intervalos de confianza, y las 8 alertas con sus tests. Cada línea importante trae un comentario con el <b>porqué</b>. Son la versión concreta de lo que defiendes en ' + C('serving', 'serving') + ', ' + C('evaluacion', 'evaluación') + ', ' + C('monitoreo', 'monitoreo') + ' y ' + C('fallas', 'fallas') + ': qué pasa con un post cuando Triton no contesta, por qué un hash S0 se bloquea igual, y cómo sabes cuánto contenido malo vio la gente.' },
      { t: 'callout', kind: 'skip',
        html: 'En la entrevista nadie te pide escribir el índice de hashes ni recordar el formato de la config. Primera pasada: el mapa, los callouts de trampas y la tabla de las 7 políticas del <code>README.md</code>. Lo que sí debes poder decir sin mirar: el hash corre <b>dentro</b> del gateway y por eso S0 no tiene fail-open; el gateway corta los modelos a los 120 ms y publica con lo que tenga; gana la acción más fuerte, no la política más severa; la etapa 2 <b>reemplaza</b> el score de la etapa 1; la prioridad de revisión es P × peso × vistas esperadas; y la prevalencia se mide sobre <b>vistas</b>, con personas, nunca con el modelo.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (macOS, sin GPU, sin Triton, sin Kafka, sin daemon de Docker): 116 tests de las cinco carpetas con pytest en venvs limpios con Python 3.13.15 (el de la imagen) y 3.12.14. El gateway con TestClient y fakes que tardan de 80 ms a 3 s, fallan o cuelgan Kafka; además, la demo con uvicorn real y curl. El índice PDQ comparado contra un escaneo lineal (incluido el peor caso del pigeonhole) y medido con 1 M de hashes aleatorios: ' + E('≈ 0.5–2 ms') + ' por consulta contra ≈ 35 ms del escaneo lineal. <code>promtool check rules</code> y <code>promtool test rules</code> de Prometheus 3.15.0 (binario oficial con sha256 verificado): las 8 alertas disparan o no con series sintéticas, y cambiar el umbral de cualquiera hace fallar su test. Los 19 paquetes del lock tienen wheel para Linux y Python 3.13, y la imagen base existe en Docker Hub. El umbral de PDQ (≤ 31), el descarte por calidad (≤ 49) y el esquema de 16 bloques de 16 bits se contrastaron con el repositorio ThreatExchange de Meta.</li>' +
          '<li><b>No ejecutado</b>: no hay adaptadores reales de Triton ni de Kafka. <code>build_app</code> lanza <code>NotImplementedError</code> y documenta qué conectar, porque no se publica código de red sin probar. No se calculó el PDQ de ninguna imagen real: los hashes son aleatorios, y con hashes reales hay más candidatos por consulta. No se construyó la imagen ni se aplicó nada a un cluster. Los umbrales, los pesos de severidad, los SLA de S2/S3 y las reglas de respaldo son ilustrativos. El texto del statement of reasons sigue el art. 17 de la DSA, pero no es un texto aprobado por legal. El <code>README.md</code> de <code>reference/c06</code> trae la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>policies.yaml</code> <small>decision</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas'), '7 políticas × severidad × superficie → umbrales; fail-open por severidad (S0 no); listas de hashes con su distancia; excepciones por clúster; <code>mode: shadow</code>; override regional'],
          ['<code>engine.py</code> <small>decision</small>', C('serving', '7 · Serving') + ', ' + C('arquitectura', '5 · Arquitectura'), 'La validación de la config (monotonía), <code>action_for_score</code> por camino, la acción más fuerte gana, la etapa 2 reemplaza a la 1, reglas de respaldo, <code>decision_id</code>, statement of reasons'],
          ['<code>match.py</code> <small>hashing</small>', C('serving', '7 · Serving'), 'Hamming con numpy, el pigeonhole (31 → radio 1 por bloque), índice estático + delta + tombstones, texto normalizado, dominios'],
          ['<code>main.py</code>, <code>Dockerfile</code> <small>gateway</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas') + ', ' + L('m07.fastapi', 'M7'), 'Hash local → texto e imagen en paralelo con lo que queda de 120 ms → decisión → evento a Kafka sin bloquear; readiness sin Triton; decisión de emergencia; 15 métricas'],
          ['<code>priority.py</code> <small>review</small>', C('datos', '6 · Datos') + ', ' + C('costo', '12 · Costo'), 'P × peso × vistas esperadas, SLA aging con carril prioritario, tope de contenido gráfico por turno, umbral de revisión según capacidad (S0/S1 protegidos)'],
          ['<code>prevalence.py</code> <small>eval</small>', C('evaluacion', '8 · Evaluación') + ', ' + L('m09.etiquetado', 'M9'), 'Prevalencia por vistas (simple y estratificada), cota superior con 0 positivos, precision y recall con Wilson, recall ponderado, kappa'],
          ['<code>alerts.yml</code>, <code>alerts_test.yml</code> <small>monitoring</small>', C('monitoreo', '9 · Monitoreo') + ', ' + L('m12.runbooks', 'M12'), 'Las 8 alertas, sus recording rules (lag en segundos, fracción de scores altos) y los tests de promtool'],
        ],
        note: 'Orden de lectura sugerido: <code>policies.yaml</code> → <code>engine.py</code> → <code>main.py</code> → <code>test_gateway.py</code> → <code>match.py</code> → <code>priority.py</code> → <code>prevalence.py</code> → <code>alerts.yml</code>. Primero la regla que decide, después el camino síncrono que la aplica en 150 ms, y al final cómo se mide y se opera.' },

      // ------------------------------------------------------------------ config + motor
      { t: 'h3', text: 'La config versionada y el decision-engine' },
      { t: 'code', title: 'Qué acción se toma, con qué evidencia y por qué',
        caption: 'Puro: solo PyYAML. <code>cd reference/c06 &amp;&amp; pytest decision/tests</code>: 44 tests en menos de 1 s.',
        files: [
          F('decision/policies.yaml', 'yaml', 'Léelo primero. Cada política tiene severidad, título y cláusula (para el statement of reasons), umbrales por superficie y acción, <code>review_confirms</code> (acciones automáticas que una persona confirma después) y <code>deep_scoring_trigger</code> (desde qué score va a la etapa 2). <code>fail_open.S0.allowed: false</code> no es una opción: el validador la exige. <code>own_removed</code> usa distancia ≤ 16 y no ≤ 31: un meme con la misma plantilla y otro texto puede caer cerca. Los números son ilustrativos: salen de la curva precision-recall de cada política y de la capacidad de revisión.'),
          F('decision/engine.py', 'python', 'El docstring tiene las 7 reglas. <code>validate_config</code> rechaza una config incoherente <i>antes</i> de decidir sobre millones de posts: acción desconocida, umbral fuera de [0, 1], una acción fuerte que pide menos evidencia que una débil, un disparador de etapa 2 por encima de la banda de revisión. <code>action_for_score</code> salta <code>remove</code> antes de publicar y <code>block_prepublish</code> después. <code>decide</code> lanza <code>HashCheckMissing</code> si falta el resultado del hash: sin él no hay garantía S0.'),
          F('decision/tests/test_engine.py', 'python', 'Se lee como una especificación: la banda de revisión publica y manda a la etapa 2; spam a 0.995 gana sobre violencia a 0.6; un hash de CSAM bloquea aunque los dos modelos hayan vencido; la etapa 2 a 0.10 levanta la reducción que puso la etapa 1 a 0.85; una regex de respaldo solo actúa si falta el modelo; el statement of reasons trae los elementos del art. 17 de la DSA; y 11 configs rotas a propósito que el validador rechaza.'),
          F('decision/requirements.txt', 'text', 'Solo PyYAML: el motor lo usan el gateway y el deep-scorer, y los dos deben traer la misma versión. Una regla interpretada distinto en los dos caminos es un bug silencioso.'),
        ] },
      { t: 'table', caption: 'Odio y acoso en un post: qué hace el motor con cada score (umbrales ' + E('ilustrativos') + ' de <code>policies.yaml</code>)',
        head: ['Score', 'Antes de publicar (sync)', 'Después (async, score de la etapa 2)'],
        rows: [
          ['0.30', '<code>none</code>; va a la etapa 2 (disparador 0.30)', '<code>none</code>'],
          ['0.65', '<code>review</code>: se publica, una persona decide', '<code>review</code>'],
          ['0.85', '<code>reduce</code> + revisión que la confirma', '<code>reduce</code> + revisión'],
          ['0.97', '<code>reduce</code> + revisión: <code>remove</code> no existe antes de publicar', '<code>remove</code> + statement of reasons'],
          ['0.995', '<code>block_prepublish</code>: no se publica', '<code>remove</code>'],
        ],
        note: 'Con el override de la región <code>DE</code>, <code>remove</code> baja de 0.95 a 0.90. El valor lo define legal con Trust &amp; Safety, no ML.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: combinar etapas con max()',
        html: 'La forma "segura" de combinar es quedarse con el score más alto de las dos etapas. Parece prudente y rompe la cascada: la etapa 2 existe para corregir a la 1 (ve texto e imagen juntos, entiende el meme), y con <code>max</code> nunca puede bajar un falso positivo. En el asíncrono, el score de la etapa 2 <b>reemplaza</b> al de la 1 para las políticas que cubre. Entre texto e imagen de la etapa 1 sí va <code>max</code>: un post viola si viola el texto <i>o</i> la imagen.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: "la política más severa manda"',
        html: 'Un post con spam a 0.995 y violencia a 0.6. Si manda la severidad, gana violencia (S1) con su acción, que a 0.6 es revisión, y el spam obvio se publica. El motor ordena por <b>acción</b> más fuerte, después por severidad y después por score. La severidad desempata y pesa en la prioridad de revisión; no tapa una acción clara de otra política.' },

      // ------------------------------------------------------------------ hashes
      { t: 'h3', text: 'Etapa 0: hashes PDQ en memoria' },
      { t: 'code', title: 'Distancia de Hamming, multi-index hashing, texto y dominios',
        caption: 'Solo numpy. <code>pytest hashing/tests</code> (26 tests) y <code>python hashing/match.py --bench 1000000</code> para medirlo en tu máquina.',
        files: [
          F('hashing/match.py', 'python', 'El docstring trae el argumento completo: 256 bits en 16 bloques de 16; si la distancia es ≤ 31, algún bloque difiere en ≤ 1 bit (31 ÷ 16 &lt; 2), así que por bloque se busca el valor exacto y sus 16 vecinos (272 búsquedas) y solo esos candidatos se verifican con XOR + popcount. Es el esquema del índice MIH de la implementación C++ de Meta. Las altas van a un delta que se escanea completo, las bajas son tombstones (dejan de coincidir al instante) y <code>compact()</code> reconstruye el índice en lote. Un hash con calidad ≤ 49 no se indexa ni se consulta: el gateway lo trata como "no verificable", no como limpio.'),
          F('hashing/tests/test_match.py', 'python', 'Hashes aleatorios con k bits volteados: encuentra todo hasta 31 y nada desde 32; el peor caso del pigeonhole (31 bits repartidos para que solo un bloque quede a 1 bit); 200 consultas iguales a las del escaneo lineal; que dos hashes al azar estén a ≈ 128 bits; altas, bajas y compactación; homoglifos y caracteres de ancho cero; y que <code>notbad.example</code> no caiga por <code>bad.example</code>.'),
        ] },
      { t: 'calc', title: 'Cuánto filtra el índice (hashes uniformes; los reales agrupan más: mídelo)', rows: [
        { label: 'Hashes en la lista', expr: E('1 M'), value: '32 MB de hashes' },
        { label: 'Candidatos por bloque', expr: '1 M × 17 ÷ 65,536', value: '≈ 260' },
        { label: 'Candidatos por consulta', expr: '16 bloques × 260', value: '≈ 4,200 (0.4 %)' },
        { label: 'Medido: índice vs escaneo lineal', expr: '1 M hashes, una Mac', value: E('≈ 0.5–2 ms') + ' vs ≈ 35 ms' },
        { label: 'Post con 10 imágenes, escaneo lineal', expr: '10 × 35 ms', value: '≈ 350 ms', note: 'no cabe en 150 ms' },
      ], result: 'El índice deja el hash en ≈ 1–2 ms por imagen, que es lo que el presupuesto del gateway le asigna en ' + C('serving', 'serving') + '. El escaneo lineal sirve de referencia en los tests, no en producción. Con decenas de millones de hashes cambia la implementación (la de C++ de Meta o un índice binario), no la idea.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: usar sha256 de la imagen como "hash"',
        html: 'Un hash criptográfico cambia por completo con un byte distinto: una foto recomprimida por otra app, redimensionada o con un borde ya no coincide. Por eso existen los hashes perceptuales: PDQ cambia pocos bits ante esas transformaciones. El sha256 sí sirve para lo exacto (el mismo archivo, la caché) y para el texto ya normalizado. Y un hash perceptual tampoco es un clasificador: no ve contenido nuevo, y un recorte fuerte o un espejo lo evaden.' },

      // ------------------------------------------------------------------ gateway
      { t: 'h3', text: 'El mod-gateway: 150 ms con fail-open' },
      { t: 'code', title: 'FastAPI con presupuesto, etapas en paralelo y fakes de Triton y Kafka',
        caption: '<code>pytest gateway/tests</code>: 19 tests en ≈ 5 s. Demo: <code>HASH_SNAPSHOT_PATH=demo_hashes.jsonl PYTHONPATH=../decision:../hashing:. uvicorn --factory main:demo_app</code> desde <code>gateway/</code>.',
        files: [
          F('gateway/main.py', 'python', 'Léelo desde <code>_moderate</code>. El hash corre en el proceso y en el event loop (≤ 10 imágenes × ≈ 1–2 ms). Texto e imagen van a Triton <b>en paralelo</b> con <code>asyncio.wait_for</code>, y el timeout es lo que queda de los 120 ms menos 5 ms de reserva: al vencer se cancela la llamada y la etapa queda en <code>failed_stages</code>. La imagen llega como <code>media_id</code> + PDQ: media-service lo calculó al subirla, así que el gateway no decodifica nada. El evento va a una cola en memoria que un task vacía a Kafka con reintentos: un broker lento no suma latencia a cada post. <code>/readyz</code> exige config e índice de hashes cargados, y no depende de Triton: si Triton cae, sacar pods no arregla nada (para eso está el fail-open).'),
          F('gateway/tests/test_gateway.py', 'python', 'Cada test es un modo de falla: los dos modelos tardan 3 s y un hash de CSAM se bloquea igual, por debajo de 1 s; el modelo de texto vence y el post se publica con <code>fail_open</code>, prioridad alta y la métrica incrementada; Triton tira error y actúa la regla de respaldo; un bug del motor y el hash S0 se bloquea igual; Kafka falla dos veces y se reintenta; Kafka colgado y los posts siguen saliendo; un PDQ de baja calidad va a la etapa 2; una baja de hash (apelación ganada) deja de coincidir sin reiniciar; y un test que lee <code>alerts.yml</code> y exige que cada métrica <code>mod_*</code> exista en <code>/metrics</code>.'),
          F('gateway/Dockerfile', 'dockerfile', 'Base <code>python:3.13.15-slim-trixie</code>: sin GPU, ' + E('≈ 43 MB') + ' comprimida contra varios GB de una imagen de CUDA. Se construye desde <code>reference/c06</code> porque copia <code>engine.py</code> y <code>match.py</code>: el gateway y el deep-scorer usan los mismos archivos. <code>policies.yaml</code> va en <code>/config</code> para montar encima un ConfigMap versionado. Un proceso uvicorn por contenedor: el índice y las métricas son por proceso.'),
          F('gateway/requirements.txt', 'text', 'El lock completo (19 paquetes), generado con <code>uv pip compile</code> para Linux x86_64 y Python 3.13. Los tests usan exactamente estas versiones vía <code>requirements-dev.txt</code>.'),
          F('gateway/demo_hashes.jsonl', 'text', 'Snapshot SINTÉTICO para la demo: hashes aleatorios (no son imágenes), un texto de spam, un dominio y un heartbeat por lista, que fija el watermark desde el que sigue el stream de novedades.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: fail-open "para todo"',
        html: 'Fail-open es la decisión correcta para S1–S3: bloquear toda publicación porque una GPU está lenta es tirar el producto. Pero si el chequeo S0 fuera un servicio remoto, su timeout también haría fail-open, y eso abre la puerta a lo único que nunca puede pasar. La respuesta no es "fail-closed para todo": es que S0 <b>no tenga nada remoto</b>. El hash corre en el proceso; un pod sin el índice cargado no está ready; y si el motor tiene un bug, <code>_emergency_decision</code> igual bloquea un hash S0.' },
      { t: 'callout', kind: 'senior', title: 'Señal senior: el fail-open se ve y se paga',
        html: 'Cada ítem en fail-open sale con <code>fail_open_reasons</code> y va a la etapa 2 con prioridad. Eso tiene un costo que conviene decir: al pico (6,250 ítems/s), un 1 % de fail-open son ' + E('≈ 62 ítems/s') + ' extra para un deep-scorer planeado en ' + E('≈ 280/s') + '. Por eso hay dos alertas encadenadas: <code>ModFailOpenRateHigh</code> (&gt; 1 % durante 10 min) y, si se sostiene, <code>DeepScorerBacklog</code>. Fail-open sin métrica es un agujero que nadie ve.' },

      // ------------------------------------------------------------------ revisión
      { t: 'h3', text: 'La cola de revisión: daño, SLA y capacidad' },
      { t: 'code', title: 'Qué revisa una persona primero y cuánto mandamos a revisión',
        caption: 'Solo biblioteca estándar. <code>pytest review/tests</code>: 12 tests.',
        files: [
          F('review/priority.py', 'python', 'El docstring empieza con el ejemplo numérico: acoso viral (0.7 × 10 × ' + E('≈ 3,900') + ' vistas en 6 h ≈ 27,000) va antes que autolesiones poco visto (0.5 × 100 × ' + E('≈ 65') + ' ≈ 3,250), hasta que este empieza a viralizarse. Las vistas esperadas salen de la velocidad <b>actual</b> con vida media de ' + E('3 h') + '. Los SLA duros (S0, reportes S1) pasan a un carril prioritario al 75 %; S2/S3 solo envejecen. <code>next_batch</code> respeta idioma, S0 solo para especialistas y el tope de contenido gráfico del turno, también dentro del batch. <code>plan_review_thresholds</code> elige la banda de revisión para que las llegadas quepan en ≈ 93 % de la capacidad: S0/S1 nunca suben su umbral; el resto comparte un mismo valor marginal.'),
          F('review/tests/test_priority.py', 'python', 'Los dos ítems del ejemplo y el cambio cuando el segundo se viraliza; un reporte S1 al 77 % de su SLA que pasa delante de un post con 50,000 vistas/h; spam de 70 h que no pasa delante de lo viral; el tope gráfico; y el plan de capacidad con 216k revisiones al día y 80k reservadas, que deja S1 completa en el piso y llena el resto con S2.'),
        ] },
      { t: 'calc', title: 'Cuántas revisiones caben y de dónde salen (' + E('estimaciones del caso') + ')', rows: [
        { label: 'Capacidad', expr: '600 personas × 60 ítems/h × 6 h productivas', value: '216,000/día' },
        { label: 'Objetivo de utilización', expr: '216,000 × 0.93', value: '≈ 200,000/día', note: 'cerca de 100 %, la espera explota (' + L('m03.colas-utilizacion', 'M3') + ')' },
        { label: 'Fracción de ítems que puede ir a revisión', expr: '200,000 ÷ 180 M', value: '≈ 0.11 %' },
        { label: 'Reservado en el test (ilustrativo)', expr: 'reportes 60k + apelaciones 10k + muestra aleatoria 10k', value: '80,000' },
        { label: 'Para la banda de revisión proactiva', expr: '200,000 − 80,000', value: '≈ 120,000/día' },
      ], result: 'Por eso la banda de revisión no la elige ML con una curva ROC: la elige la capacidad. Cuando faltan personas, la palanca es subir los umbrales de S2/S3 (más acción automática, más reducción de alcance), nunca los de S1; y si ni S0/S1 caben, el error del planificador lo dice: faltan personas, no umbrales.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: la cola FIFO',
        html: 'Orden de llegada suena justo y es el peor orden posible: el post que van a ver 50,000 personas en la próxima hora espera detrás de 3,000 ítems que nadie verá. Y ordenar solo por P(viola) tampoco: pones primero spam a 0.99 que nadie ve. Lo que se ordena es el <b>daño que evitas</b> revisándolo ahora, con aging para que nada espere para siempre. Mira también el bienestar: el tope de contenido gráfico es parte del ruteo, no una política de RR. HH. aparte.' },

      // ------------------------------------------------------------------ calidad
      { t: 'h3', text: 'Medir calidad: prevalencia, precision y recall con su intervalo' },
      { t: 'code', title: 'Muestras etiquetadas por personas → métricas con intervalo de confianza',
        caption: 'numpy (solo para el bootstrap). <code>pytest eval/tests</code>: 15 tests con datos que se pueden verificar a mano.',
        files: [
          F('eval/prevalence.py', 'python', 'Wilson y no Wald: con 3 positivos en 1,000, Wald da un límite negativo. Con 0 positivos no hay estimación, hay cota superior (≈ 3/n). <code>stratified_prevalence</code> repondera por el peso de cada estrato: muestrear más donde el modelo sospecha angosta el intervalo sin sesgar el resultado. <code>recall_from_random_sample</code> acepta pesos: sin ellos, el estrato alto (sobremuestreado y casi todo accionado) infla el recall. <code>cohens_kappa</code> mide el acuerdo entre moderadores corregido por azar.'),
          F('eval/tests/test_prevalence.py', 'python', 'El estratificado contra la verdad conocida (0.498 %), contra el error de no ponderar (20 veces más) y contra la muestra simple con el mismo presupuesto (intervalo más angosto). 76,446 vistas para medir 0.5 % ± 0.05 puntos. Recall con 12 positivos: ± más de 20 puntos. Y un recall ponderado de ≈ 80 % que sin pesos daría 99 %.'),
        ] },
      { t: 'calc', title: 'Cuánto cuesta medir la prevalencia', rows: [
        { label: 'Prevalencia supuesta', expr: E('≈ 0.5 %') + ' de las vistas', value: 'p = 0.005' },
        { label: 'Intervalo deseado', expr: '± 0.05 puntos, confianza de 95 %', value: 'h = 0.0005, z = 1.96' },
        { label: 'Vistas a etiquetar', expr: '1.96² × 0.005 × 0.995 ÷ 0.0005²', value: '≈ 76,446' },
        { label: 'Horas de revisión', expr: '76,446 ÷ 60 ítems/h', value: '≈ 1,274 h', note: 'sale de la misma capacidad que la cola' },
      ], result: 'La medición compite con la revisión por las mismas personas: por eso va en lo reservado del planificador, y por eso se estratifica (con el mismo presupuesto, el intervalo se angosta) y se reporta por semana o por mes para las políticas raras.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: medir la calidad con lo que el sistema ya vio',
        html: 'Tres atajos que suenan razonables y están sesgados: prevalencia = "lo que el modelo marcó ÷ total" (el modelo no ve lo que no detecta); precision desde las apelaciones (solo apela quien cree tener razón); recall desde la cola de revisión (solo contiene lo que el sistema ya marcó). La única fuente sin ese sesgo es una muestra aleatoria de <b>vistas</b> etiquetada por personas, con la versión de la política en cada etiqueta (' + L('m09.etiquetado', 'M9') + ').' },

      // ------------------------------------------------------------------ alertas
      { t: 'h3', text: 'Las 8 alertas y sus tests' },
      { t: 'code', title: 'Reglas de Prometheus y tests de promtool',
        caption: '<code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code> (≈ 1–2 min: simula hasta 33 días de series).',
        files: [
          F('monitoring/alerts.yml', 'yaml', 'Sistema (page): <code>ModGatewayLatencyHigh</code> (p99 &gt; 150 ms), <code>ModFailOpenRateHigh</code> (&gt; 1 %), <code>DeepScorerBacklog</code> (lag ÷ ritmo de producción &gt; 240 s: mide el atraso aunque el consumer no procese nada), <code>ReviewQueueAging</code> (el más viejo al 75 % del SLA) y <code>HashListStale</code> (watermark en el peor pod; heartbeats para no confundir "sin novedades" con "stream roto"; <code>absent()</code> para la lista de CSAM). Modelo (ticket): <code>PolicyScoreShift</code>, contra la misma hora de la semana pasada. Calidad (ticket): <code>AppealOverturnRateHigh</code> y <code>ProactiveRateDrop</code>, en un grupo que se evalúa cada hora.'),
          F('monitoring/alerts_test.yml', 'yaml', 'Series sintéticas para cada alerta, con el momento exacto en que pasa a firing y casos que no deben disparar: otro consumer group, una cola S2 vieja, una política estable, una política con pocas apelaciones que pasa de 0 % a 100 %. En los grupos horarios se prueban labels y momento, no el porcentaje del texto: depende de en qué minuto cae la evaluación.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: un label llamado severity',
        html: 'La cola de revisión exporta la edad del ítem más viejo por severidad de la política. Si el label se llama <code>severity</code>, choca con el label <code>severity: page</code> de la alerta, que lo pisa: el aviso dice "page" y pierdes si era S0 o S1. En la referencia el label es <code>tier</code>. Es un error que no da ningún mensaje: solo lo ves cuando una alerta llega sin la información que necesitabas.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: alertar solo con lo que terminó',
        html: 'Un histograma de "tiempo hasta el score" o "tiempo hasta la revisión" solo registra lo que terminó. Si el deep-scorer está caído o nadie está revisando, no termina nada y esas alertas se quedan calladas justo cuando más importan. Por eso <code>DeepScorerBacklog</code> mira el lag de Kafka y <code>ReviewQueueAging</code> la edad del más viejo pendiente: las dos ven lo atascado. Es la misma lección del ' + L('c04.monitoreo', 'caso 4') + '.' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Todos los tests (sin GPU, Triton ni Kafka)', meta: '≈ 10 s',
          html: '<code>cd reference/c06</code>, crea un venv (Python 3.13 como la imagen, o 3.12), <code>pip install -r requirements-dev.txt</code> y <code>pytest</code>: 116 tests de las cinco carpetas.' },
        { title: 'Mide el índice de hashes', meta: '≈ 10 s',
          html: '<code>python hashing/match.py --bench 1000000</code>: tiempo por consulta del índice contra el escaneo lineal, candidatos y memoria. Cambia N y mira cómo escala cada uno.' },
        { title: 'La demo del gateway', meta: '1 min',
          html: 'En <code>gateway/</code>: <code>HASH_SNAPSHOT_PATH=demo_hashes.jsonl PYTHONPATH=../decision:../hashing:. uvicorn --factory main:demo_app --port 8080</code>, y en otra terminal <code>curl -s -X POST localhost:8080/v1/moderate -H \'content-type: application/json\' -d \'{"item_id":"p-1","surface":"comment","text":"Todo GRATIS hoy"}\'</code>. Después mira <code>/metrics</code> y los eventos de Kafka falsos en la primera terminal.' },
        { title: 'Las alertas con promtool', meta: '≈ 1–2 min',
          html: 'Baja el release de Prometheus para tu sistema (trae <code>promtool</code>) y, en <code>monitoring/</code>: <code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code>. Cambia un umbral y vuelve a correr: su test falla.' },
        { title: 'Juega con la config', meta: 'con tus números',
          html: 'Cambia un umbral en <code>decision/policies.yaml</code> (por ejemplo, <code>remove</code> por debajo de <code>reduce</code>) y corre <code>pytest decision/tests</code>: el validador lo rechaza con el motivo. Pon <code>mode: shadow</code> en una política y mira <code>shadow_actions</code> en la respuesta.' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“The pre-publish check runs inside a 120-millisecond budget. Hash matching against known-bad lists runs in process, so the zero-tolerance check never depends on a remote call. The text and image models run in parallel on Triton with whatever budget is left; if one times out, we fail open for everything below zero tolerance, publish, and send the item to the deep scorer with high priority. A versioned policy config turns scores into actions: the strongest action wins, the second stage replaces the first stage’s score, and every decision carries the config and model versions plus a statement of reasons. Prevalence comes from a random sample of views labeled by humans, never from the model.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo aterriza un módulo: ' + L('m02.asincrona-colas', 'M2 Patrones') + ' (síncrono + asíncrono con Kafka) y ' + L('m02.entrega-reintentos', 'M2') + ' (at-least-once: por eso el <code>decision_id</code> determinista), ' + L('m03.presupuesto', 'M3 Latencia') + ' (presupuesto y timeouts), ' + L('m07.fastapi', 'M7 Serving') + ' (el gateway), ' + L('m09.etiquetado', 'M9 Datos') + ' (etiquetas con versión y muestra aleatoria), ' + L('m10.gate', 'M10 MLOps') + ' y ' + L('m11.shadow', 'M11 Despliegue') + ' (umbrales nuevos en shadow) y ' + L('m12.drift', 'M12 Monitoreo') + ' (drift adversario y alertas). La parte de seguridad y privacidad (acceso a las listas de hashes, retención de lo que ven los moderadores) va en ' + L('m15', 'M15') + '; el clasificador LLM provisional para una política nueva, en ' + L('m14', 'M14') + '.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
