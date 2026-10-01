/* =============================================================================
   Ronda de Diseño ML — js/content/c05-archivos.js
   Caso 05, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c05/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por capa, con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8e. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección de este caso y cualquier página o sección del curso.
  const C = (sec, txt) => '<a href="#c05.' + sec + '">' + txt + '</a>';
  const L = (hash, txt) => '<a href="#' + hash + '">' + txt + '</a>';
  const E = (txt) => '<span class="est">' + txt + '</span>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c05/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c05/' + path, note });

  MSD.addSection('c05', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos de <code>reference/c05/</code>, probados hasta donde se puede sin una cuenta de AWS y sin modelos. Hay cinco grupos: la regla que decide qué va directo y qué va a revisión (con los umbrales calibrados), las validaciones que atrapan lo que la confianza del modelo no ve, el quality gate y la API que recibe los documentos, la máquina de estados que no pierde ninguno, y las alertas con sus tests. Cada línea importante trae un comentario con el <b>porqué</b>. Son la versión concreta de lo que defiendes en ' + C('serving', 'serving') + ', ' + C('fallas', 'fallas') + ' y ' + C('monitoreo', 'monitoreo') + ': qué ve el revisor, qué pasa si el SAT se cae y cómo sabes que lo que pasó sin revisión estaba bien.' },
      { t: 'callout', kind: 'skip',
        html: 'En la entrevista nadie te pide escribir el ASL ni el algoritmo del RFC. Primera pasada: el mapa, los callouts de trampas y la tabla "qué pasa con el documento en cada falla" del <code>README.md</code>. Lo que sí debes poder decir sin mirar: <b>STP ⇔ todos los campos requeridos sobre su umbral y todas las validaciones pasan</b>; los umbrales salen de una cota de Wilson, y certificar 99.9 % con cero errores pide ≈ 3,838 ejemplos; el XML del CFDI (o el QR) va antes que el OCR; el revisor ve solo los campos marcados; docs-api guarda primero y arranca después, y todo Catch termina en captura manual; la auditoría aleatoria es la única medida sin sesgo de lo que nadie revisó, y es lenta.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (macOS, sin AWS, sin daemon de Docker, sin modelos): 120 tests del pipeline, 35 de docs-api y 40 de contrato de la máquina de estados, con pytest en venvs limpios con Python 3.12.14 y 3.13.15. Los dígitos verificadores de CURP y RFC coinciden con python-stdnum (una implementación independiente) en 2,000 cadenas al azar cada uno. Los adaptadores reales de boto3 contra moto 5.2.3: S3 con SSE-KMS y Step Functions (mismo nombre e input → la misma ejecución). <code>uvicorn main:build_default_app --factory</code> arrancado en local. El ASL pasa asl-validator 4.0.0. <code>promtool check rules</code> y <code>promtool test rules</code> de Prometheus 3.15.0 (binario oficial, sha256 verificado): las 8 alertas disparan (o no) con series sintéticas, y los tests fallan si cambias los umbrales (10 mutaciones probadas).</li>' +
          '<li><b>No ejecutado</b>: nada corrió en AWS. moto no aplica IAM ni ejecuta los estados; Textract, el servicio de estatus del SAT y KMS real no se probaron. No se construyó la imagen. El <code>doc-worker</code>, sus modelos, review-api y el repo de Postgres no están incluidos. Todos los umbrales (gate, <code>routing.yaml</code>, alertas) son ilustrativos y las imágenes de los tests son sintéticas. El algoritmo de la CURP no apareció en un documento oficial citable: se verificó contra python-stdnum y ejemplos conocidos. El <code>README.md</code> de <code>reference/c05</code> trae la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>routing.py</code>, <code>routing.yaml</code> <small>pipeline</small>', C('serving', '7 · Serving') + ', ' + C('arquitectura', '5 · Arquitectura'), '<code>decide</code>: STP o tarea de revisión con solo los campos marcados; horas hábiles; prioridad por etapa del crédito; auditoría del 2 % por hash'],
          ['<code>calibrate_thresholds.py</code> <small>pipeline</small>', C('datos', '6 · Datos') + ', ' + C('evaluacion', '8 · Evaluación'), 'Umbral por campo con cota de Wilson; la regla que no cruza una franja mala; holdout; por qué las correcciones de revisión no sirven para esto'],
          ['<code>validators.py</code> <small>pipeline</small>', C('serving', '7 · Serving'), 'CURP, RFC, CLABE, cuadratura del CFDI, fechas mexicanas, nombres entre documentos; qué error NO ve cada dígito verificador'],
          ['<code>cfdi.py</code> <small>pipeline</small>', C('serving', '7 · Serving') + ', ' + C('costo', '12 · Costo'), 'XML CFDI 4.0 sin modelo y sin OCR; defusedxml contra XXE; el QR del PDF'],
          ['<code>quality.py</code> <small>pipeline</small>', C('serving', '7 · Serving'), 'Varianza del Laplaciano a escala fija, reflejo, DPI efectivos, documento cortado'],
          ['<code>main.py</code>, <code>Dockerfile</code> <small>api</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas'), 'Límites, magic bytes, dedupe por cliente, gate de 3 s con motivos en español, S3 + StartExecution, el barrido que no pierde nada'],
          ['<code>statemachine.asl.json</code> <small>orchestration</small>', C('arquitectura', '5 · Arquitectura') + ', ' + C('fallas', '10 · Fallas') + ', ' + C('costo', '12 · Costo'), 'Retry/Catch por etapa, <code>waitForTaskToken</code> para máquinas y personas, degradación con el SAT caído, transiciones por documento'],
          ['<code>alerts.yml</code> y sus tests <small>monitoring</small>', C('monitoreo', '9 · Monitoreo'), 'Las 8 alertas; por qué el backlog se mide desde la base; qué tan lenta es la auditoría para detectar una degradación'],
        ],
        note: 'Orden de lectura sugerido: <code>routing.py</code> → <code>validators.py</code> → <code>calibrate_thresholds.py</code> → <code>statemachine.asl.json</code> → <code>api/main.py</code> → <code>alerts.yml</code>. Primero la regla que el negocio compra, después lo que la protege, y al final cómo se opera.' },

      // ------------------------------------------------------------------ STP y umbrales
      { t: 'h3', text: 'La regla STP y de dónde salen los umbrales' },
      { t: 'code', title: 'Ruteo por campo y calibración con Wilson',
        caption: 'Solo numpy, PyYAML, defusedxml y tzdata: <code>cd pipeline &amp;&amp; pip install -r requirements-dev.txt &amp;&amp; pytest</code> (120 tests en segundos).',
        files: [
          F('pipeline/routing.py', 'python', 'Léelo primero. <code>decide</code> recorre los campos requeridos del tipo de documento: falta, umbral <code>null</code>, fuente manuscrita (Textract solo reconoce escritura a mano en inglés) o confianza bajo el umbral → campo marcado con su motivo. Las validaciones fallidas marcan sus campos (o el documento, como "CFDI cancelado"). Sin marcas → STP, y el 2 % de esos entra a auditoría por hash del <code>document_id</code>. Con marcas → tarea con valor, confianza, página y bbox de cada campo (para el recorte), críticos primero, vencimiento en 4 horas <b>hábiles</b> y un <code>sort_at</code> que adelanta 2 h lo que bloquea un desembolso.'),
          F('pipeline/routing.yaml', 'yaml', 'Umbrales por tipo y campo (ilustrativos: en producción los escribe <code>calibrate_thresholds.py</code>), campos críticos, el horario del equipo de revisión y el bono por etapa. Un campo opcional bajo su umbral no bloquea el STP: se entrega como "no verificado". La config se valida al cargar: un umbral fuera de [0, 1] o un requerido sin umbral rompe el arranque, no la producción.'),
          F('pipeline/calibrate_thresholds.py', 'python', 'Para cada campo, recorre los umbrales de mayor a menor y se queda con el más bajo cuya exactitud de lo aceptado tiene cota de Wilson ≥ objetivo (99.5 %, o 99.9 % en críticos), <b>sin cruzar una franja que falla</b>. Con <code>--confirm-frac 0.3</code>, el 30 % de los documentos solo confirma: si ahí la exactitud no llega, el campo queda en <code>null</code>. Por defecto ignora las etiquetas de revisión.'),
          F('pipeline/tests/test_routing.py', 'python', 'El ejemplo del docstring (confianza + cruce en la misma tarea), manuscrito, XML con CFDI cancelado, viernes 17:00 → lunes 11:00, días festivos, la prioridad por etapa, la muestra de auditoría ≈ 2 %, la config rota, y el contrato con la máquina de estados: <code>decide</code> produce exactamente <code>stp</code> y <code>review</code>, las dos ramas de <code>IsStp</code>.'),
          F('pipeline/tests/test_calibrate.py', 'python', 'Wilson con números calculables (990 de 1,000 → 0.9817), los mínimos 765 y 3,838, por qué la aproximación normal "certifica" 100 % con 10 ejemplos, la franja mala que no se cruza, el holdout que anula un umbral, y un CSV roto que falla con número de línea.'),
        ] },
      { t: 'calc', title: 'Cuántas etiquetas pide certificar un campo', rows: [
        { label: 'Cota de Wilson con cero errores', expr: 'n ÷ (n + z²), z = 1.96', value: 'z² ≈ 3.84' },
        { label: 'Para 99.5 % (campos estándar)', expr: '0.995 × 3.8416 ÷ 0.005', value: '≈ 765 aciertos' },
        { label: 'Para 99.9 % (CURP, RFC, CLABE, montos)', expr: '0.999 × 3.8416 ÷ 0.001', value: '≈ 3,838 aciertos' },
        { label: 'CURP en el gold set', expr: '2,000 documentos × ' + E('≈ 25 %') + ' INE', value: E('≈ 500') },
        { label: 'Auditoría de STP', expr: E('≈ 3,000 STP/día') + ' × 2 %', value: E('≈ 60 documentos/día') },
      ], result: 'El gold set no alcanza para certificar 99.9 % en ningún campo crítico: hay que acumular meses de auditoría aleatoria, o dejar ese campo en revisión mientras tanto (umbral <code>null</code>). Y la captura histórica no sirve como etiqueta para esto: con ' + E('≈ 1–2 %') + ' de errores de tecleo, su ruido es 10–20 veces el 0.1 % que intentas medir. Esa frase, con los números, es una señal senior clara.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: calibrar con las correcciones de los revisores',
        html: 'Las correcciones son etiquetas gratis y abundantes, pero solo existen para campos que <b>ya estaban bajo el umbral</b>. No dicen nada de la zona que se auto-acepta, que es justo la que el umbral tiene que certificar. Es sesgo de selección: el mismo problema de ' + L('m09.etiquetado', 'etiquetar lo que el modelo eligió en M9') + '. Para la zona alta valen el gold set (doble captura y adjudicación) y la auditoría aleatoria; las correcciones sirven para reentrenar y para medir la zona baja.' },

      // ------------------------------------------------------------------ validaciones
      { t: 'h3', text: 'Lo que la confianza del modelo no ve' },
      { t: 'code', title: 'Dígitos verificadores, cuadratura del CFDI y el XML sin modelo',
        caption: 'Puro, sin I/O: la consulta de estatus al SAT vive en el worker, detrás de una interfaz; aquí solo llega su resultado.',
        files: [
          F('pipeline/validators.py', 'python', 'CURP (formato, entidad, fecha, dígito 18), RFC de persona física (13) y moral (12) con su dígito mod 11, CLABE con pesos 3-7-1, montos con <code>Decimal</code> (nunca float), Total = SubTotal − Descuento + traslados − retenciones (+ impuestos locales), fechas impresas día/mes/año, antigüedad máxima y nombres entre documentos. Ninguna regla rechaza al cliente: marca el campo con un motivo para el revisor.'),
          F('pipeline/cfdi.py', 'python', 'El XML de un CFDI 4.0 ya trae RFCs, montos y UUID exactos y timbrados: hacer OCR del PDF de esa factura es pagar por adivinar lo que ya está escrito. Parsea con defusedxml (<code>forbid_dtd=True</code>), exige el <code>TimbreFiscalDigital</code> (sin timbre no es un CFDI), da un motivo claro para un 3.3 y produce los campos con el mismo esquema que <code>extract</code> (confianza 1.0, fuente <code>xml</code>). <code>parse_qr_url</code> lee el QR del PDF y solo acepta el dominio del SAT.'),
          F('pipeline/tests/test_validators.py', 'python', 'Ejemplos conocidos, 2,000 cadenas al azar contra python-stdnum para CURP y RFC, todo error de un dígito en la CLABE detectado, el RFC genérico de público en general, 10,961.25 leído en vez de 10,901.25 y la posición 9 de la CURP.'),
          F('pipeline/tests/test_cfdi.py', 'python', 'Campos y UUID del CFDI sintético, XXE y billion laughs rechazados, sin timbre, 3.3, monto no numérico, impuestos locales, QR coincidente, QR de otra factura y QR de otro dominio.'),
          F('pipeline/tests/fixtures/cfdi40_sintetico.xml', 'text', 'Sintético: sello, certificado y UUID inventados. Emisor = el RFC de pruebas que el SAT publica para desarrollo; receptor y PAC inventados con dígito válido. Montos: 10,000.00 − 500.00 + 1,520.00 − 118.75 = 10,901.25.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: creer que el dígito verificador atrapa todo',
        html: 'En la CLABE sí atrapa cualquier error de un solo dígito: los pesos 3, 7 y 1 son coprimos con 10 (el test prueba los 153 cambios posibles). En la CURP no: el carácter 9 (el primer dígito del día de nacimiento) pesa 10 ≡ 0 (mod 10), así que leer 21 en vez de 01 deja el dígito igual y la CURP "valida". Por eso existe el cruce CURP ↔ fecha de nacimiento impresa en la INE, y el test lo demuestra. La regla general: un check digit reduce errores, no los elimina; los cruces entre campos y entre documentos son la segunda llave.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: parsear XML del cliente con el parser por defecto',
        html: 'El XML lo sube el cliente: es entrada hostil. Un DTD con entidades puede pedir archivos del servidor (XXE) o expandirse hasta agotar la memoria (billion laughs). ElementTree de la biblioteca estándar no resuelve entidades externas, pero su protección contra la expansión depende de la versión de expat enlazada; defusedxml las rechaza sin importar la versión, y un CFDI legítimo nunca trae DTD. Es el tipo de detalle que conecta con ' + L('m15', 'M15 (seguridad)') + '.' },
      { t: 'callout', kind: 'senior', title: 'El mejor modelo es el que no corres',
        html: 'De ' + E('≈ 1,750') + ' facturas al día, ' + E('≈ 60 %') + ' llegan con XML: ese camino es <code>ReadCfdiXml → Validate</code>, sin OCR, sin Extract y con exactitud de 100 % en la lectura. Para las que solo traen PDF, el QR da UUID, RFCs y total sin OCR. El OCR y el modelo quedan para lo que de verdad lo necesita. Decirlo antes de dibujar el modelo es lo que separa a quien diseña sistemas de quien entrena modelos.' },

      // ------------------------------------------------------------------ gate y API
      { t: 'h3', text: 'El quality gate y la API que ve el cliente' },
      { t: 'code', title: 'docs-api: 3 s para decir "recibido" o "súbelo de nuevo"',
        caption: '<code>cd api &amp;&amp; pip install -r requirements-dev.txt &amp;&amp; pytest</code>: 35 tests en segundos, sin AWS (fakes y moto).',
        files: [
          F('pipeline/quality.py', 'python', 'Varianza del Laplaciano medida siempre con el lado largo en 1,024 px, reflejo como fracción de pixeles saturados (solo en la INE: en papel blanco el fondo también satura), DPI efectivos con la medida física del documento (ID-1 = 85.60 × 53.98 mm; carta) y un detector heurístico de documento cortado. Devuelve <b>todos</b> los motivos, no solo el primero. Umbrales ilustrativos.'),
          F('api/main.py', 'python', 'En orden de costo: tamaño (413), tipo real por magic bytes (415, también para HEIC), combinación de archivos, PDF con contraseña o con más de 50 páginas, XML que no es CFDI; dedupe por <code>(application_id, sha256)</code>; gate en cada foto (JPEG decodificado en modo draft) → 422 con motivos en español; S3 con SSE-KMS → Postgres → <code>StartExecution(name=document_id)</code> → 202. Si S3 falla: 503 con <code>Retry-After</code>. Si <code>StartExecution</code> falla: 202 igual y <code>resume_unstarted</code> lo arranca después. Publica la edad del documento sin terminar más viejo leyendo la base en cada scrape.'),
          F('api/tests/test_api.py', 'python', 'Cada test es un camino: el feliz, el mismo archivo dos veces, el mismo archivo de otro cliente, cuatro requests idénticos a la vez (uno gana), foto borrosa, motivos por página, 12 MP en menos de 3 s, PDF con contraseña, HEIC, S3 caído, StartExecution caído + barrido, 404 entre clientes, logs sin el nombre del archivo, y dos contratos: cada <code>docs_*</code> de las alertas existe, y el input de la ejecución es exactamente lo que <code>Init</code> espera.'),
          F('api/tests/test_adapters.py', 'python', 'Los adaptadores reales de boto3 contra moto: <code>PutObject</code> con SSE-KMS (con y sin llave explícita) y <code>StartExecution</code> idempotente por nombre; con otro input, <code>ExecutionAlreadyExists</code>, que el adaptador no relanza.'),
          F('api/Dockerfile', 'dockerfile', 'Se construye desde <code>reference/c05</code> porque copia <code>quality.py</code> y <code>cfdi.py</code> de <code>pipeline/</code>: el gate y el pipeline comparten la definición de "foto legible". <code>python:3.12-slim</code>, wheels únicamente, usuario no root, <code>uvicorn … --factory</code> en el 8080.'),
          F('api/requirements.txt', 'text', 'El lock completo (27 paquetes, los 27 con wheel para Linux y Python 3.12). Starlette, Pillow y pypdf fijados: deciden cómo se parsea un multipart y cómo se decodifica una foto.'),
          F('pipeline/tests/test_quality.py', 'python', 'Imágenes sintéticas: nítida, borrosa, con mancha saturada, de baja resolución, cortada, RGB vs gris, y la misma escena a dos resoluciones.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: un umbral de nitidez sin escala fija',
        html: 'La varianza del Laplaciano depende de la resolución. En el test, la misma escena con el mismo desenfoque óptico da ' + E('≈ 5×') + ' menos a doble resolución: sin normalizar, una foto de 50 MP parecería "más borrosa" que una de 12 MP. Por eso <code>quality.py</code> reduce todo a 1,024 px de lado largo (promedio por área, con factor no entero) antes de medir, y por eso los DPI se calculan con el tamaño <b>original</b> aunque el JPEG se haya decodificado a 1/4.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: el dedupe global y los logs con nombre de archivo',
        html: 'Dedupe por sha256 a secas parece más eficiente, pero le dice al cliente B que alguien ya subió esa INE: es una fuga de información. El dedupe es por <code>(application_id, sha256)</code>; el mismo archivo en dos solicitudes distintas es una señal de fraude interna, no una respuesta de la API. Y el nombre original del archivo no se loguea nunca: la gente sube <code>INE_Juana_Perez.jpg</code>. Un test busca "Juana" en los logs.' },
      { t: 'callout', kind: 'senior', title: 'Guardar primero, arrancar después, y un barrido que repara',
        html: 'El cliente recibe 202 cuando el documento está en S3 y en la base, no cuando el pipeline arrancó. Si <code>StartExecution</code> falla, el documento queda en <code>received</code>, el 202 sale igual y un barrido cada minuto lo reintenta: es seguro porque <code>StartExecution</code> es idempotente para Standard con el mismo nombre y el mismo input mientras la ejecución corre. Es el patrón de ' + L('m02.entrega-reintentos', 'entrega y reintentos de M2') + ' aplicado al punto exacto donde se pierden documentos: entre dos sistemas.' },

      // ------------------------------------------------------------------ orquestación
      { t: 'h3', text: 'La máquina de estados: ningún camino pierde un documento' },
      { t: 'code', title: 'Step Functions Standard y sus tests de contrato',
        caption: '<code>cd orchestration &amp;&amp; pytest</code> (40 tests, solo biblioteca estándar) y <code>npx asl-validator@4.0.0 --json-path statemachine.asl.json</code>.',
        files: [
          F('orchestration/statemachine.asl.json', 'json', 'Cada etapa automática es un mensaje con task token a la cola <code>doc-tasks</code>; los pods <code>doc-worker</code> responden con <code>SendTaskSuccess/Failure</code>. <code>AcquireText</code> elige XML, capa de texto u OCR (default OCR). Retry por etapa: errores permanentes sin reintento, timeout de 1 h con un reintento, transitorios con backoff y jitter. <code>HumanReview</code>: heartbeat de 2 h y timeout de 5 días. Todo Catch va a <code>ToManualCapture</code>, que manda el estado completo a <code>doc-manual-capture</code> y termina en <code>Fail</code>. Los <code>Comment</code> explican cada decisión.'),
          F('orchestration/tests/test_statemachine.py', 'python', 'Lo que un validador de sintaxis no ve: todo estado alcanzable, solo dos finales, Catch con <code>States.DataLimitExceeded</code> explícito, token y timeout en cada callback, y un recorrido por camino (XML, capa de texto, OCR, revisión, desconocido) que verifica que cada <code>$.x</code> leído exista <b>en ese camino</b> y cuenta las transiciones: 9, 10 y 11.'),
        ] },
      { t: 'calc', title: 'Transiciones de estado por documento y costo de Step Functions', rows: [
        { label: 'Factura con XML, STP', expr: 'Init → Classify → AcquireText → ReadCfdiXml → Validate → Route → IsStp → Commit → Done', value: '9' },
        { label: 'Foto con OCR, STP', expr: '… → RunOcr → Extract → …', value: '10' },
        { label: 'Foto con OCR y revisión', expr: '… + HumanReview', value: '11' },
        { label: 'Al mes', expr: '5,000 docs/día × 30 × ' + E('≈ 10'), value: '≈ 1.5 M transiciones' },
        { label: 'Costo (Standard)', expr: '1.5 M × US$0.025 por 1,000', value: E('≈ US$37.5') + ' (≈ US$40 con reintentos)' },
      ], result: 'Cada reintento cuenta como transición: por eso el OCR pasa texto por S3 en vez de repetir llamadas, y por eso no hay un estado Map por página (cada página serían varias transiciones más). El costo de orquestar es ruido frente al OCR (' + E('≈ US$280') + ') y frente a las personas.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: States.ALL no atrapa todo',
        html: 'Según la documentación de AWS, <code>States.ALL</code> no atrapa <code>States.DataLimitExceeded</code> (un estado de más de 256 KiB) ni <code>States.Runtime</code> (por ejemplo, leer una ruta que no existe). El primero se atrapa poniéndolo explícito en cada Catch, y se evita pasando llaves de S3 en vez de texto. El segundo no se puede atrapar: se evita con tests. Por eso <code>Init</code> crea <code>review: null</code> (si no, <code>Commit</code> fallaría en el camino STP al leer <code>$.review</code>) y por eso cada Choice tiene <code>Default</code>: sin él, un valor inesperado es <code>States.NoChoiceMatched</code> y la ejecución muere. El test de rutas por camino detecta el primer caso (probado quitando <code>review</code>).' },
      { t: 'callout', kind: 'senior', title: 'El mismo patrón para máquinas y personas, con otros tiempos',
        html: '<code>waitForTaskToken</code> solo existe en Standard (Express solo hace request-response y dura máximo 5 min), y es lo que permite que una revisión dure horas sin pagar por esperar. Para las etapas automáticas, si un pod muere SQS reentrega el mensaje con el mismo token; el timeout de 1 h es el último recurso. Para la revisión, review-api manda un heartbeat por hora por cada tarea abierta: si deja de hacerlo, a las 2 h la tarea falla y el documento va a captura manual en vez de quedar colgado 5 días. Ojo con un detalle: cuando una tarea vence, el reintento lleva un token <b>nuevo</b>; el worker que termina tarde recibe un error al responder y debe descartar su mensaje.' },

      // ------------------------------------------------------------------ monitoreo
      { t: 'h3', text: 'Las 8 alertas y sus tests' },
      { t: 'code', title: 'alerts.yml y dos archivos de tests de promtool',
        caption: '<code>promtool check rules alerts.yml</code>, <code>promtool test rules alerts_test.yml</code> (&lt; 1 s) y <code>promtool test rules alerts_test_long.yml</code> (≈ 30–90 s: simula hasta 29 días de series).',
        files: [
          F('monitoring/alerts.yml', 'yaml', 'Sistema: <code>DocPipelineBacklog</code> (documento automático más viejo > 15 min, medido desde la base: ve también un arranque que nunca ocurrió), <code>StageErrorRateHigh</code> (por <b>intento</b>, porque los Retry esconden los errores), <code>ReviewSLABreach</code> (tareas abiertas vencidas, no terminadas) y <code>SATValidationDown</code> (ticket: es externo). Datos: <code>QualityGateRejectSpike</code> y <code>OCRConfidenceShift</code> (también detecta un cambio del proveedor de OCR). Modelo: <code>STPRateDrop</code> y <code>AuditFieldAccuracyLow</code>, con el cálculo de cuánto tarda en detectar una degradación.'),
          F('monitoring/alerts_test.yml', 'yaml', 'Ventanas cortas, evaluación cada minuto: cuándo dispara cada alerta, las dos réplicas que no se cuentan doble, los 3 vencidos de 10 que no despiertan a nadie, y una caída parcial del SAT (67 % de fallas), la más común.'),
          F('monitoring/alerts_test_long.yml', 'yaml', 'Ventanas de 7 y 28 días con evaluación cada 10 min (cada minuto tardaba más de 10 min). Incluye los casos que no deben disparar: un tipo con rechazo alto pero estable, la auditoría en el objetivo, pocas muestras.'),
        ] },
      { t: 'table', caption: 'Qué tan rápido detecta la auditoría una degradación (Poisson con los volúmenes estimados del caso)',
        head: ['Campos', 'Ventana y umbral', 'Falsa alarma con el objetivo', 'Detecta si el error se duplica', 'Si se triplica'],
        rows: [
          ['Estándar (99.5 %)', '7 días, ' + E('≈ 2,520') + ' auditados, &lt; 99.2 %', E('≈ 2 %'), E('≈ 82 %'), '—'],
          ['Críticos (99.9 %)', '28 días, ' + E('≈ 3,360') + ' auditados, &lt; 99.8 %', E('≈ 5 %'), E('≈ 50 %'), E('≈ 87 %')],
        ],
        note: 'La auditoría del 2 % es insesgada pero lenta: un mes después, una duplicación del error en campos críticos sigue siendo una moneda al aire. Lo que protege los campos críticos día a día son los dígitos verificadores y los cruces; la auditoría confirma. Cada error crítico encontrado se investiga, suene o no la alerta.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: recording rules en otro grupo (y la retención)',
        html: 'La primera versión tenía las recording rules en un grupo aparte y el test largo fallaba <b>a veces</b>: entre grupos no hay orden garantizado, y una alerta evaluada antes que su recording rule leía el valor anterior o nada (más viejo que el lookback de 5 min). Dentro de un grupo las reglas se evalúan en orden: cada alerta vive con las recording rules que usa. Y una más: <code>increase(…[28d])</code> necesita 28 días de retención; la de Prometheus es de 15 días por defecto y, si no alcanza, calcula en silencio sobre lo que haya. Detalles de alertas y runbooks en ' + L('m12.runbooks', 'M12') + '.' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Pipeline y máquina de estados', meta: '≈ 10 s',
          html: '<code>cd reference/c05/pipeline</code>, crea un venv (Python 3.12 o 3.13), <code>pip install -r requirements-dev.txt</code> y <code>pytest</code> (120 tests). Con el mismo venv: <code>cd ../orchestration &amp;&amp; pytest</code> (40 tests).' },
        { title: 'docs-api', meta: '≈ 10 s',
          html: 'Otro venv en <code>api/</code>: <code>pip install -r requirements-dev.txt &amp;&amp; pytest</code> (35 tests, incluidos los adaptadores de boto3 contra moto). Para verla correr: copia <code>api/main.py</code>, <code>pipeline/quality.py</code> y <code>pipeline/cfdi.py</code> a una carpeta y <code>uvicorn main:build_default_app --factory --port 8080</code>.' },
        { title: 'Las alertas con promtool', meta: '≈ 1–2 min',
          html: 'Baja el release de Prometheus para tu sistema (trae <code>promtool</code>) y, en <code>monitoring/</code>: <code>promtool check rules alerts.yml</code>, <code>promtool test rules alerts_test.yml</code> y <code>promtool test rules alerts_test_long.yml</code>. Cambia un umbral y vuelve a correr: el test correspondiente falla.' },
        { title: 'El ASL', meta: '≈ 10 s',
          html: '<code>npx asl-validator@4.0.0 --json-path orchestration/statemachine.asl.json</code>. Valida la sintaxis; los caminos y las rutas los revisan los tests de <code>orchestration/</code>.' },
        { title: 'Tus propios umbrales', meta: 'con tus etiquetas',
          html: 'Arma un CSV <code>doc_id,doc_type,field,confidence,correct,label_source</code> (gold y audit) y corre <code>python pipeline/calibrate_thresholds.py etiquetas.csv --config pipeline/routing.yaml -o umbrales.yaml</code>. El reporte por campo (umbral, cobertura, exactitud, cota) sale en stderr.' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“Each document runs as a Standard Step Functions execution keyed by its ID. Invoices with XML skip OCR entirely. Every field gets a calibrated confidence, and a document goes straight through only if every required field clears its per-field threshold and every validation passes: check digits, cross-field totals, cross-document names, the SAT status. Otherwise a reviewer sees only the flagged fields, with the image crop. I pick each threshold as the lowest one whose Wilson lower bound on accepted accuracy meets the target, so certifying 99.9 percent takes roughly four thousand clean labels. Every failure path ends in a manual-capture queue, so no document is ever lost.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo aterriza un módulo: ' + L('m02.asincrona-colas', 'M2 Patrones') + ' (colas, callbacks, at-least-once), ' + L('m03.timeouts-reintentos', 'M3 Latencia') + ' (timeouts, backoff y jitter), ' + L('m05.dockerfile-ml', 'M5 Contenedores') + ' (la imagen), ' + L('m07.fastapi', 'M7 Servidores') + ' (FastAPI y el threadpool), ' + L('m09.validacion-datos', 'M9 Datos') + ' (validar la entrada antes de procesarla), ' + L('m10.gate', 'M10 MLOps') + ' (los umbrales viajan con la versión del modelo) y ' + L('m12.modelo', 'M12 Monitoreo') + ' (métricas de modelo con etiquetas tardías). El worker con cola y la idempotencia son los del ' + L('c04.archivos', 'caso 4') + '; la seguridad del XML y la privacidad de las INE siguen en ' + L('m15', 'M15') + '.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
