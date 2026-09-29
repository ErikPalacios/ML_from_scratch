/* =============================================================================
   Ronda de Diseño ML — js/content/m01-mapa.js
   Módulo 01: el mapa. Del notebook al sistema, ciclo de vida, online vs offline,
   qué evalúa la entrevista, framework de 7 pasos, aclaración, estimaciones express.
   Contrato: docs/SPEC.md §5. El framework y la rúbrica salen de MSD.FRAMEWORK y
   MSD.RUBRIC_DIMENSIONS (registry.js) para que nunca se desincronicen del simulador.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const est = (s) => '<span class="est">' + s + '</span>';
  const F = MSD.FRAMEWORK || [];
  const R = MSD.RUBRIC_DIMENSIONS || [];
  const win = (s) => s.from + '–' + s.to + ' min';

  // ------------------------------------------------------------ framework: detalle por paso
  const STEP = {
    aclarar: `
      <p><b>Objetivo:</b> convertir un enunciado ambiguo en un problema acotado, con supuestos que dices en voz alta y escribes.</p>
      <p><b>En el pizarrón:</b> zona "Supuestos": quién usa la predicción, volumen y pico, latencia, labels, restricciones (privacidad, edge, presupuesto).</p>
      <ul>
        <li>¿Quién consume la predicción y qué decisión toma con ella? ¿Qué cuesta un error?</li>
        <li>¿Cuánto volumen y cómo es el pico? ¿Alguien espera la respuesta (síncrono) o puede esperar minutos?</li>
        <li>¿Hay labels? ¿Hay un modelo o una heurística hoy (baseline)?</li>
        <li>Cierra con: "Voy a asumir X, Y, Z; corrígeme si alguno está mal".</li>
      </ul>
      <p><b>Error típico:</b> los dos extremos. Cero preguntas y a dibujar, o 15 preguntas sin fijar ningún supuesto.</p>`,
    requisitos: `
      <p><b>Objetivo:</b> requisitos funcionales, no funcionales con número, y la cadena de métricas: negocio → online → offline, más guardrails.</p>
      <p><b>En el pizarrón:</b> 2–4 requisitos funcionales; NFR con números (p99, QPS de diseño, disponibilidad, costo, frescura); métricas en tres niveles.</p>
      <ul>
        <li><b>Framing ML:</b> qué predice exactamente el modelo (el label y cómo se obtiene), con qué input disponible en el momento de predecir, y qué tipo de tarea es (clasificación, ranking, regresión). En product ML es lo primero que puntúa.</li>
        <li>Baja el objetivo por la cadena: negocio (tasa de publicaciones completadas) → online (tasa de aceptación de la categoría sugerida) → offline (top-5 accuracy en el golden set).</li>
        <li>Decide qué error duele más (falso positivo vs falso negativo) y dilo: eso fija precision vs recall y el umbral.</li>
        <li>Nombra 1–2 guardrails: la métrica que no puede empeorar aunque la principal mejore (p99, tasa de publicación, quejas).</li>
      </ul>
      <p><b>Error típico:</b> decir "accuracy" sin decir de qué, sobre qué distribución y por qué esa. O no ligarla nunca al negocio.</p>`,
    estimar: `
      <p><b>Objetivo:</b> órdenes de magnitud que deciden arquitectura. No precisión: decisiones.</p>
      <p><b>En el pizarrón:</b> QPS promedio → pico → diseño; hardware (GPUs o cores); memoria (pesos, VRAM); almacenamiento (logs, datos); costo mensual. Solo resultados redondos.</p>
      <ul>
        <li>Redondea agresivo: 1 día ≈ 10<sup>5</sup> s, 1 M/día ≈ 12 req/s.</li>
        <li>Después de cada número, di la decisión: "500 req/s de pico → una GPU basta por throughput, dos por N+1".</li>
        <li>Marca lo que no sabes de memoria y cómo lo medirías: "capacidad por GPU: la mido con un load test".</li>
      </ul>
      <p><b>Error típico:</b> 8 minutos de aritmética con decimales, u olvidar el pico y diseñar para el promedio.</p>`,
    arquitectura: `
      <p><b>Objetivo:</b> un diagrama end-to-end simple que funcione hoy, con el camino online y el offline separados.</p>
      <p><b>En el pizarrón:</b> carril online (cliente → API → preprocesamiento → modelo → postproceso → respuesta, con log async) y carril offline (logs → datos → labels → training → evaluation gate → registry → deploy), más monitoreo.</p>
      <ul>
        <li>Empieza por la versión más simple que cumple los requisitos; la complejidad se agrega cuando un número la exige.</li>
        <li>Define el contrato de la API: input, output, errores, timeout, qué pasa si fallas (fallback).</li>
        <li>Recorre un request de punta a punta y luego un ciclo de reentrenamiento. Luego chequea: "¿tiene sentido antes de profundizar?".</li>
      </ul>
      <p><b>Error típico:</b> dibujar solo el camino online, o dibujar 15 cajas con nombres de productos (Kafka, Feast, Ray) sin flujo de datos ni porqué.</p>`,
    profundizar: `
      <p><b>Objetivo:</b> profundidad real en 1–2 áreas elegidas con el entrevistador. Aquí se decide el nivel senior.</p>
      <p><b>En el pizarrón:</b> un zoom del componente: batching, timeouts y colas del serving; o el pipeline de labels; o el esquema de features y cómo evitas el skew.</p>
      <ul>
        <li>Ofrece 2–3 opciones basadas en tus números y deja elegir. Si te dicen "tú eliges", ve al cuello de botella que más riesgo tiene.</li>
        <li>Cada decisión con su alternativa descartada y la condición en la que cambiarías de opinión.</li>
        <li>Usa números otra vez: batch máximo, espera máxima en cola, latencia por etapa, costo por label.</li>
        <li>Las fallas del componente que profundizas se dicen aquí, no al final: el cierre solo las resume.</li>
      </ul>
      <p><b>Error típico:</b> profundizar en el backbone porque es tu zona cómoda, o en algo que el entrevistador no pidió.</p>`,
    operar: `
      <p><b>Objetivo:</b> cómo sabes que el modelo nuevo es mejor, cómo lo lanzas sin riesgo y cómo sabes que sigue bien.</p>
      <p><b>En el pizarrón:</b> evaluation gate offline (golden set + slices) → shadow → canary 5 % → A/B; métricas de sistema, de modelo y de negocio; 1–2 alertas con umbral; trigger de reentrenamiento.</p>
      <ul>
        <li>Una alerta concreta: métrica, umbral y ventana ("p99 &gt; 200 ms durante 10 min").</li>
        <li>Rollback: la versión anterior sigue en el registry (y, recién promovida, todavía desplegada): volver es cambiar ruteo o redeployar un tag, no reentrenar.</li>
        <li>Reentrenamiento ligado a una señal (drift sostenido, caída de la métrica con labels), no solo a un calendario.</li>
      </ul>
      <p><b>Error típico:</b> "haría un A/B test" sin métrica, sin guardrails ni unidad de aleatorización; "monitorearía el drift" sin decir qué distribución ni contra qué referencia.</p>`,
    cerrar: `
      <p><b>Objetivo:</b> demostrar que sabes cómo se rompe y dejar un resumen que el entrevistador pueda copiar a su nota.</p>
      <p><b>En el pizarrón:</b> 3 fallas con detección y mitigación (cae una GPU → N+1; el modelo tarda → timeout + fallback; drift → alerta + reentreno); 2–3 trade-offs; siguientes pasos.</p>
      <ul>
        <li>Resumen de 30–60 segundos: problema, números clave, arquitectura en una frase, las 2 decisiones más importantes.</li>
        <li>"Con más tiempo, miraría…": una optimización de costo y un riesgo que dejaste abierto.</li>
      </ul>
      <p><b>Error típico:</b> no llegar. Terminar a mitad de un deep dive sin haber dicho nada de fallas ni haber cerrado.</p>`,
  };

  // Notas de la rúbrica: qué anota el entrevistador (buena vs mala), por dimensión.
  const RUBRIC_NOTES = {
    aclaracion: [
      '"Preguntó volumen, si el usuario espera la respuesta y de dónde salen los labels. Asumió 10 M/día y reutilizó ese número en las estimaciones."',
      '"Empezó a dibujar a los 30 segundos. Asumió que había labels limpios. Nunca preguntó qué significa éxito."',
    ],
    estimaciones: [
      '"Pico 500 req/s → 1 GPU por throughput, 2 por N+1. Logs ≈ 3 GB/día → guarda el 100 %. Usó los números para decidir batching."',
      '"Dijo que \'escala mucho\' y que usaría autoscaling. Ningún número. Diseñó para el promedio."',
    ],
    arquitectura: [
      '"Separó online y offline desde el principio. Diseño simple, cada caja con su porqué. Deep dive sólido en batching y timeouts."',
      '"Una caja que dice \'modelo\' y una flecha. Cuando le pedí más, agregó nombres de herramientas sin flujo de datos."',
    ],
    tradeoffs: [
      '"Eligió HTTP/REST y no gRPC hacia el model server por simplicidad de balanceo; explicó la trampa de las conexiones HTTP/2 largas detrás de un balanceador L4 y cuándo cambiaría."',
      '"Kafka, Kubernetes, Feast y Ray en los primeros 10 minutos; no supo decir por qué ninguno."',
    ],
    monitoreo: [
      '"Gate offline con slices, shadow, canary 5 % con rollback automático, alerta de p99 y de distribución de scores, reentreno por drift sostenido."',
      '"Dijo \'monitorearíamos el modelo\' y pasó al siguiente tema."',
    ],
    comunicacion: [
      '"Dio agenda al inicio, chequeó antes del deep dive, avisó cuando iba tarde y cerró con un resumen de trade-offs."',
      '"Monólogo de 20 minutos. No reaccionó cuando intenté redirigir. Se quedó sin tiempo antes de monitoreo."',
    ],
  };

  // Ejemplo guiado (fotos borrosas): una línea por paso del framework.
  const EX = {
    aclarar: `Pregunto lo que cambia el diseño y fijo supuestos: <b>aviso suave</b>, no bloqueo ("tu foto parece borrosa, ¿quieres tomar otra?"), porque un falso positivo que bloquea cuesta un anuncio. App y web. Mismo marketplace del <a href="#c01">caso 1</a>: ≈ 10 M fotos/día. No hay labels de "borrosa"; hay rechazos de moderación por "foto de mala calidad" como señal débil.`,
    requisitos: `FR: por cada foto, devolver <code>{blurry, score}</code> mientras el vendedor sigue en la pantalla. NFR: p99 ≤ 150 ms server-side; 99.9 % con <b>fail-open</b> (si el servicio falla, se publica sin aviso). Métricas: de negocio, contactos por anuncio; online, % de avisos que terminan en foto re-tomada; offline, precision del aviso a un recall mínimo; guardrails, tasa de publicación y tiempo hasta publicar.`,
    estimar: `10 M/día → ≈ 116 req/s promedio, ≈ 350 pico, diseño 500. Varianza del Laplaciano sobre la imagen reducida: ${est('≈ 2–5 ms de CPU')} → 500 × 5 ms ≈ 2.5 cores, y reutiliza el decode que el gateway ya hace para clasificar: cabe en el gateway existente con poco CPU extra. Una CNN pequeña en CPU: ${est('≈ 10–30 ms')} → 500 × 10–30 ms ≈ 5–15 cores; en GPU sería trivial. Conclusión: el baseline no necesita infraestructura nueva.`,
    arquitectura: `Online: app → upload → gateway → función de blur en CPU → respuesta con aviso; log async con score, decisión, versión del umbral y modelo del dispositivo. Offline: logs + si el vendedor re-tomó o ignoró + rechazos de moderación → muestra semanal etiquetada por humanos → recalibrar umbral (y, más adelante, entrenar una CNN).`,
    profundizar: `Elijo el umbral y los labels, porque ahí está el riesgo: la varianza del Laplaciano depende de la resolución (normalizo a un lado fijo antes de medir), del contenido (una pared lisa tiene varianza baja sin estar borrosa → falso positivo) y de la compresión. Golden set de 1–2k fotos con una guía clara ("¿se lee la etiqueta del producto?"). Umbral para precision ≥ 90 %: el aviso solo sale cuando estamos seguros.`,
    operar: `Offline: precision/recall por slice (dispositivo, categoría, luz). Online: A/B por vendedor. Monitoreo: % de fotos marcadas por hora; si salta de ${est('≈ 8 %')} a 30 % tras un release de la app, algo cambió en la compresión → alerta. Más p99 y errores del servicio.`,
    cerrar: `Fallas: servicio caído → fail-open; celular nuevo con sharpening agresivo infla la varianza → no detecta nada en ese modelo de dispositivo → lo ves en el % marcado por dispositivo. Trade-offs: heurística vs CNN, servidor vs on-device, aviso vs bloqueo. Resumen en 30 segundos.`,
  };

  // Paso del framework → módulos y casos donde se entrena.
  const MAP = {
    aclarar: ['Este módulo (<a href="#m01.preguntas-aclaracion">preguntas</a>), <a href="#m02">M2</a>', '<a href="#c03">c03</a> (dos problemas en un enunciado), <a href="#c05">c05</a>, <a href="#c12">c12</a>'],
    requisitos: ['<a href="#m02">M2</a>, <a href="#m03">M3</a>, <a href="#m11">M11</a> (métrica primaria y guardrails), <a href="#m15">M15</a> (SLOs)', '<a href="#c06">c06</a> (prevalencia, no accuracy), <a href="#c08">c08</a>, <a href="#c09">c09</a> (costo asimétrico)'],
    estimar: ['<a href="#m03">M3</a>, <a href="#m04">M4</a>, <a href="#m13">M13</a> (costo)', '<a href="#c01">c01</a>, <a href="#c02">c02</a> (streams por GPU), <a href="#c10">c10</a> (VRAM y KV cache)'],
    arquitectura: ['<a href="#m02">M2</a>, <a href="#m07">M7</a>, <a href="#m09">M9</a>', '<a href="#c01">c01</a>, <a href="#c05">c05</a> (pipeline multi-modelo), <a href="#c08">c08</a> (embudo retrieval → ranking)'],
    profundizar: ['Serving: <a href="#m03">M3</a>, <a href="#m04">M4</a>, <a href="#m06">M6</a>, <a href="#m07">M7</a>, <a href="#m08">M8</a> · Datos: <a href="#m09">M9</a> · LLMs: <a href="#m14">M14</a>', '<a href="#c02">c02</a>, <a href="#c07">c07</a>, <a href="#c09">c09</a>, <a href="#c10">c10</a>, <a href="#c11">c11</a>'],
    operar: ['<a href="#m10">M10</a>, <a href="#m11">M11</a>, <a href="#m12">M12</a>', '<a href="#c01">c01</a>, <a href="#c04">c04</a> (human in the loop), <a href="#c06">c06</a> (adversarios, reentreno frecuente)'],
    cerrar: ['<a href="#m15">M15</a>, <a href="#m06">M6</a> (alta disponibilidad)', '<a href="#c03">c03</a> (sin red), <a href="#c12">c12</a> (acciones irreversibles), <a href="#c13">c13</a> (conexiones largas)'],
  };

  // ------------------------------------------------------------ diagramas
  // Sculley et al. 2015: la caja "ML code" es chica; lo demás es el sistema. Sin proporciones exactas.
  const SCULLEY = {
    width: 100, height: 46,
    lanes: [
      { id: 'sistema', label: 'Sistema de ML en producción', x: 0, y: 0, w: 100, h: 46, kind: 'neutral' },
    ],
    nodes: [
      { id: 'config', label: 'Configuración', sub: 'umbrales, flags, versiones', x: 3, y: 5, w: 19, h: 7, kind: 'service',
        note: 'Umbrales, versión de modelo activa, flags, rutas, parámetros de batching. Sculley et al. advierten que, en un sistema maduro, las líneas de configuración pueden superar con creces a las de código, que cada línea es una oportunidad de error (y esos errores pueden salir caros) y que la configuración debe pasar code review y vivir en el repositorio. En la entrevista: "los umbrales viven en config versionada, no hardcodeados".' },
      { id: 'collection', label: 'Data collection', sub: 'logging, uploads, streams', x: 28, y: 5, w: 19, h: 7, kind: 'job',
        note: 'Cómo entran los datos al sistema: logs del producto, uploads, eventos. Lo que no logueas hoy no lo puedes usar para entrenar ni para evaluar mañana. Detalle en <a href="#m09">M9</a>.' },
      { id: 'featext', label: 'Feature extraction', sub: 'decode, resize, normalize', x: 53, y: 5, w: 19, h: 7, kind: 'job',
        note: 'Convertir datos crudos en lo que el modelo consume: en CV, decodificar, rotar según EXIF, redimensionar, normalizar. Tiene que ser idéntico en training y en serving, o aparece el training-serving skew (<a href="#m09">M9</a>).' },
      { id: 'verification', label: 'Data verification', sub: 'schema, rangos, nulos', x: 78, y: 5, w: 19, h: 7, kind: 'job',
        note: 'Validar antes de entrenar o de servir: imágenes corruptas o de 0 bytes, canales equivocados, labels fuera del catálogo, distribuciones raras. Es barato y evita entrenar con basura.' },
      { id: 'resources', label: 'Machine resources', sub: 'GPUs, cuotas, costo', x: 3, y: 20, w: 19, h: 7, kind: 'gpu',
        note: 'Quién corre qué, en qué hardware y cuánto cuesta: GPUs, CPUs, cuotas, autoscaling, capacity planning. Detalle en <a href="#m03">M3</a>, <a href="#m04">M4</a> y <a href="#m06">M6</a>.' },
      { id: 'mlcode', label: 'ML code', sub: 'tu ResNet / YOLO', x: 43, y: 20, w: 14, h: 6, kind: 'model',
        note: 'Arquitectura, loss, loop de entrenamiento: lo que ya dominas. Importa, pero en una entrevista de ML Engineer se da casi por supuesto. La caja es chica a propósito.' },
      { id: 'analysis', label: 'Analysis tools', sub: 'slices, debugging', x: 78, y: 20, w: 19, h: 7, kind: 'service',
        note: 'Entender el modelo en producción: métricas por slice, inspección de errores, comparar versiones. Sin esto sabes que empeoró, pero no por qué.' },
      { id: 'process', label: 'Process management', sub: 'orquestación, reintentos', x: 15, y: 35, w: 19, h: 7, kind: 'service',
        note: 'Orquestar jobs recurrentes (ingesta, training, evaluación) con dependencias, reintentos y alertas: Airflow, Kubeflow Pipelines, Argo Workflows. Detalle en <a href="#m10">M10</a>.' },
      { id: 'serving', label: 'Serving infra', sub: 'API, model server, LB', x: 41, y: 35, w: 19, h: 7, kind: 'service',
        note: 'Lo que convierte un archivo de pesos en un endpoint confiable: API, model server, batching, load balancer, autoscaling, fallback. Detalle en <a href="#m07">M7</a>.' },
      { id: 'monitoring', label: 'Monitoring', sub: 'sistema, datos, modelo', x: 67, y: 35, w: 19, h: 7, kind: 'monitor',
        note: 'Métricas de sistema (latencia, errores), de datos (drift), de modelo (calidad con labels retrasados) y de negocio. Un modelo falla en silencio: sin monitoreo te enteras por un usuario. Detalle en <a href="#m12">M12</a>.' },
    ],
    edges: [],
    flows: [
      { id: 'notebook-a-sistema', label: 'Del notebook al sistema', steps: [
        { nodes: ['mlcode'], edges: [], text: 'Esto es lo que ya sabes hacer. En la entrevista le dedicas 1–2 minutos: un modelo probado y por qué basta.' },
        { nodes: ['collection', 'verification', 'featext'], edges: [], text: 'Datos: de dónde vienen, cómo los validas y cómo los transformas igual en training y en serving.' },
        { nodes: ['serving', 'resources'], edges: [], text: 'Serving y recursos: latencia, throughput, cuántas GPUs y cuánto cuesta.' },
        { nodes: ['monitoring', 'analysis'], edges: [], text: 'Operación: cómo sabes que funciona y por qué dejó de funcionar.' },
        { nodes: ['config', 'process'], edges: [], text: 'Pegamento: configuración versionada y orquestación. Poca gloria, muchos incidentes.' },
      ] },
    ],
  };

  // Arquitectura de referencia. Columnas A–E: x = 2, 22, 42, 64, 84; huecos en x ≈ 20, 40, 62, 82 para las aristas.
  // Filas: online y=5–12 · puente (feature store) y=19–27 · offline y=33–40 y 44–51 · monitoreo y=61–68.
  // Las aristas largas van por los huecos entre columnas (x = 62 y 82) o por y = 2.5 / 71 para no cruzar nodos.
  const REF = {
    width: 100, height: 74,
    lanes: [
      { id: 'online', label: 'Camino online (por request)', x: 0, y: 0, w: 100, h: 23, kind: 'online' },
      { id: 'offline', label: 'Camino offline (datos y entrenamiento)', x: 0, y: 25, w: 100, h: 30, kind: 'offline' },
      { id: 'monitoreo', label: 'Monitoreo', x: 0, y: 57, w: 100, h: 17, kind: 'monitor' },
    ],
    nodes: [
      { id: 'client', label: 'Cliente', sub: 'app, web u otro servicio', x: 2, y: 5, w: 16, h: 7, kind: 'client',
        note: 'Quien hace el request: la app, la web u otro equipo. Define el contrato: tamaño del payload, timeout del lado del cliente (300 ms en el <a href="#c01">caso 1</a>) y qué hace si fallas (en c01, mostrar el selector manual de categoría).' },
      { id: 'gateway', label: 'API gateway / LB', sub: 'TLS, auth, rate limit', x: 22, y: 5, w: 16, h: 7, kind: 'edge',
        note: 'Punto de entrada: TLS, autenticación, rate limiting y routing por versión (útil para el canary). Sin lógica de ML. En la entrevista basta una caja; no lo diseñes a fondo salvo que te lo pidan.' },
      { id: 'inference', label: 'Inference service', sub: 'preproceso + fallback', x: 42, y: 5, w: 18, h: 7, kind: 'service',
        note: 'Servicio sin estado en CPU: valida el input, decodifica y preprocesa la imagen, llama al model server, postprocesa (top-k, umbrales, ids → nombres) y aplica fallback si el modelo no responde a tiempo. Separarlo del model server permite escalar CPU y GPU por separado y tener el preprocesamiento en un solo lugar.' },
      { id: 'modelserver', label: 'Model server (GPU)', sub: 'Triton (vLLM si es LLM)', x: 64, y: 5, w: 16, h: 7, kind: 'gpu',
        note: 'Proceso especializado en ejecutar el modelo en GPU. Su trabajo principal es el <b>dynamic batching</b>: junta requests de muchos clientes en un batch para aprovechar la GPU sin que cada cliente espere demasiado. Escala por throughput; N+1 réplicas por disponibilidad. Detalle en <a href="#m07">M7</a> y <a href="#m03">M3</a>.' },
      { id: 'predlogs', label: 'Prediction logs', sub: '1 línea JSON por request', x: 84, y: 5, w: 15, h: 7, kind: 'queue',
        note: 'Una línea por predicción: request_id, versión del modelo, hash del input, top-k con scores, latencia. Se escribe de forma asíncrona para no sumar latencia. Es la materia prima de monitoreo, labeling, reentrenamiento y debugging: sin logs no hay lazo cerrado.' },
      { id: 'featurestore', label: 'Feature store', sub: 'misma def. online/offline', x: 42, y: 19, w: 18, h: 8, kind: 'store',
        note: 'Guarda features con una sola definición para training (histórico, con point-in-time correctness: cada ejemplo usa el valor que la feature tenía en el momento de la predicción, no el de hoy, para no filtrar el futuro) y para serving (baja latencia). Cruza los dos carriles a propósito. En CV puro (una imagen → una clase) muchas veces no hace falta: la "feature" es la imagen. Aparece cuando mezclas metadata (precio, historial del vendedor). Detalle en <a href="#m09">M9</a>.' },
      { id: 'registry', label: 'Model registry', sub: 'versiones + linaje', x: 2, y: 33, w: 16, h: 7, kind: 'store',
        note: 'Catálogo de modelos versionados con su linaje (datos, código, métricas) y un alias o estado que dice cuál sirve producción (p. ej. champion/challenger; MLflow reemplazó los stages Staging/Production por aliases desde la versión 2.9). Hace posible el rollback sin reentrenar: la versión anterior sigue registrada y volver es cambiar ruteo o redeployar su tag. MLflow, SageMaker Model Registry, W&amp;B. Detalle en <a href="#m10">M10</a>.' },
      { id: 'evalgate', label: 'Evaluation gate', sub: 'golden set + slices', x: 22, y: 33, w: 16, h: 7, kind: 'job',
        note: 'Compuerta automática: el candidato debe igualar o superar al modelo en producción en el golden set y en los slices críticos (fotos nocturnas, categorías nuevas), y pasar tests de paridad de preprocesamiento y de latencia. Si no pasa, no llega al registry como candidato.' },
      { id: 'training', label: 'Training job', sub: 'GPU efímera, dataset vers.', x: 42, y: 33, w: 18, h: 7, kind: 'job',
        note: 'Job efímero en GPU (on-demand o spot) que entrena sobre un dataset versionado y registra código, datos, hiperparámetros y métricas. Es tu notebook convertido en un pipeline reproducible que corre sin ti.' },
      { id: 'labeling', label: 'Labeling', sub: 'humanos + guía', x: 64, y: 33, w: 16, h: 7, kind: 'human',
        note: 'Personas (equipo interno o proveedor) etiquetan una muestra: aleatoria para medir sin sesgo, y dirigida (baja confianza, errores reportados) para mejorar el modelo, que es active learning. Cuesta dinero por label y tarda días: es un requisito de diseño, no un detalle. Detalle en <a href="#m09">M9</a>.' },
      { id: 'datalake', label: 'Data lake', sub: 'S3 / GCS, Parquet', x: 84, y: 33, w: 15, h: 7, kind: 'store',
        note: 'Almacenamiento barato y durable de logs, imágenes muestreadas, labels y snapshots de datasets. Es la fuente de verdad del camino offline; versionar lo que sale de aquí es lo que hace reproducible un entrenamiento.' },
      { id: 'cicd', label: 'CI/CD', sub: 'build, tests, deploy', x: 2, y: 44, w: 16, h: 7, kind: 'job',
        note: 'Construye el artefacto (engine optimizado, imagen de contenedor), corre tests y despliega con una estrategia segura: shadow (recibe una copia del tráfico sin responder), canary (≈ 5 % del tráfico) y rollback automático si las métricas empeoran. Detalle en <a href="#m11">M11</a>.' },
      { id: 'oncall', label: 'On-call', sub: 'alerta + runbook', x: 2, y: 61, w: 16, h: 7, kind: 'human',
        note: 'Una persona con un runbook: si sube el p99, escalar o revisar el batching; si cae la calidad, rollback al modelo anterior en el registry. Una alerta sin dueño ni runbook es ruido.' },
      { id: 'prom', label: 'Prometheus/Grafana', sub: 'métricas, dashboards', x: 64, y: 61, w: 16, h: 7, kind: 'monitor',
        note: 'Métricas de sistema (QPS, p50/p99, errores, utilización de GPU, largo de cola) que Prometheus recolecta del gateway, del inference service y del model server; dashboards en Grafana; alertas hacia on-call. Dibujo una sola flecha para no ensuciar el diagrama. Detalle en <a href="#m12">M12</a>.' },
      { id: 'drift', label: 'Drift job', sub: 'inputs y scores vs ref.', x: 84, y: 61, w: 15, h: 7, kind: 'job',
        note: 'Job periódico (p. ej. cada hora) que compara la distribución de inputs y de scores contra una referencia (el set de training o la semana pasada) con métricas como PSI o KS. Publica el resultado como métrica y puede disparar reentrenamiento o una revisión. Detecta lo que las métricas de sistema no ven: un servicio sano que se equivoca.' },
    ],
    edges: [
      { from: 'client', to: 'gateway', kind: 'online', label: 'HTTPS' },
      { from: 'gateway', to: 'inference', kind: 'online' },
      { from: 'inference', to: 'modelserver', kind: 'online', label: 'tensor' },
      { from: 'inference', to: 'featurestore', kind: 'online', fromSide: 'b', toSide: 't', label: 'features' },
      { from: 'inference', to: 'predlogs', kind: 'async', fromSide: 't', toSide: 't', via: [[51, 2.5], [91.5, 2.5]], label: 'log async' },
      { from: 'predlogs', to: 'datalake', kind: 'async', fromSide: 'b', toSide: 't', label: 'ingesta' },
      { from: 'datalake', to: 'labeling', kind: 'offline', fromSide: 'l', toSide: 'r', label: 'muestra' },
      { from: 'labeling', to: 'training', kind: 'offline', fromSide: 'l', toSide: 'r', label: 'labels' },
      { from: 'featurestore', to: 'training', kind: 'offline', fromSide: 'b', toSide: 't' },
      { from: 'training', to: 'evalgate', kind: 'offline', fromSide: 'l', toSide: 'r', label: 'candidato' },
      { from: 'evalgate', to: 'registry', kind: 'offline', fromSide: 'l', toSide: 'r', label: 'aprobado' },
      { from: 'registry', to: 'cicd', kind: 'offline', fromSide: 'b', toSide: 't' },
      { from: 'cicd', to: 'modelserver', kind: 'offline', dashed: true, fromSide: 'r', toSide: 'b', via: [[62, 47.5], [62, 16], [72, 16]], label: 'deploy canary' },
      { from: 'modelserver', to: 'prom', kind: 'monitor', fromSide: 'r', toSide: 't', via: [[82, 8.5], [82, 59], [72, 59]] },
      { from: 'datalake', to: 'drift', kind: 'monitor', fromSide: 'b', toSide: 't' },
      { from: 'drift', to: 'prom', kind: 'monitor', fromSide: 'l', toSide: 'r' },
      { from: 'prom', to: 'oncall', kind: 'monitor', fromSide: 'l', toSide: 'r', label: 'alerta' },
      { from: 'drift', to: 'training', kind: 'monitor', dashed: true, fromSide: 'b', toSide: 'b', via: [[91.5, 71], [51, 71]], label: 'trigger' },
    ],
    flows: [
      { id: 'request-online', label: 'Un request online', steps: [
        { nodes: ['client', 'gateway'], edges: ['client>gateway'], text: 'El vendedor sube una foto. La app hace un POST con los bytes de la imagen y espera, con un timeout propio (300 ms en el caso 1).' },
        { nodes: ['gateway', 'inference'], edges: ['gateway>inference'], text: 'El gateway termina TLS, autentica y enruta a una réplica del inference service (o a la versión canary si el request cae en ese porcentaje).' },
        { nodes: ['inference', 'featurestore'], edges: ['inference>featurestore'], text: 'El inference service valida y preprocesa la imagen. Si el modelo usa metadata (historial del vendedor), la lee del online store; en CV puro este paso no existe.' },
        { nodes: ['inference', 'modelserver'], edges: ['inference>modelserver'], text: 'Manda el tensor al model server, que lo agrupa con otros requests (dynamic batching: espera como máximo ≈ 2 ms a que lleguen más requests, max_queue_delay; si el batch se llena antes, sale antes) y corre el batch en la GPU.' },
        { nodes: ['inference', 'predlogs'], edges: ['inference>predlogs'], text: 'Postprocesa (top-5, nombres de categoría), responde al cliente y escribe el log de la predicción de forma asíncrona. Si el model server no respondió a tiempo, responde con el fallback.' },
        { nodes: ['modelserver', 'prom'], edges: ['modelserver>prom'], text: 'Cada componente expone métricas (latencia, errores, cola, GPU) que Prometheus recolecta cada 15–30 s (scrape interval típico): así sabes si cumples el SLO.' },
      ] },
      { id: 'reentrenamiento', label: 'Un ciclo de reentrenamiento', steps: [
        { nodes: ['predlogs', 'datalake'], edges: ['predlogs>datalake'], text: 'Los logs llegan al data lake cada pocos minutos (Parquet particionado por fecha).' },
        { nodes: ['datalake', 'drift', 'prom'], edges: ['datalake>drift', 'drift>prom'], text: 'El drift job compara la distribución de inputs y de scores de hoy contra la referencia y publica el resultado como métrica.' },
        { nodes: ['datalake', 'labeling', 'training'], edges: ['datalake>labeling', 'labeling>training'], text: 'Se muestrea una fracción de los requests (≈ 1 % en el caso 1, guardando referencias, no copias de la imagen) y de esa muestra se eligen las que etiquetan personas (≈ 5k/mes: baja confianza, desacuerdo con el vendedor y una parte aleatoria); solo esas imágenes se copian, y los labels nuevos se suman al dataset versionado.' },
        { nodes: ['drift', 'training', 'featurestore'], edges: ['drift>training', 'featurestore>training'], text: 'Un trigger (drift sostenido, caída de la métrica con labels o el calendario) lanza el training job, que lee datos y features con la misma definición que usa serving.' },
        { nodes: ['training', 'evalgate'], edges: ['training>evalgate'], text: 'El candidato pasa por el evaluation gate: golden set, slices críticos, paridad de preprocesamiento y latencia.' },
        { nodes: ['evalgate', 'registry'], edges: ['evalgate>registry'], text: 'Si pasa, se registra con su linaje. Si no, se queda como experimento y alguien investiga por qué.' },
        { nodes: ['registry', 'cicd', 'modelserver'], edges: ['registry>cicd', 'cicd>modelserver'], text: 'CI/CD construye el artefacto y lo despliega: shadow, luego canary al 5 %, luego 100 %. Si las métricas empeoran, rollback automático a la versión anterior del registry.' },
        { nodes: ['prom', 'oncall'], edges: ['prom>oncall'], text: 'Si algo se rompe en el camino, la alerta llega a una persona con runbook. El lazo está cerrado.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm01',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'de-modelo-a-sistema',
        title: 'De modelo a sistema',
        titleEn: 'From model to system',
        priority: 'core',
        blocks: [
          { t: 'p', html: `En tu notebook hay un <code>model.eval()</code>, un DataLoader con imágenes ya limpias y una métrica: top-1 sobre el split de validación. En producción, esa misma ResNet recibe fotos que nadie limpió, a las 3 a. m., desde un celular con la lente sucia, 350 veces por segundo, y alguien paga cada hora de GPU. La pregunta de una entrevista de ML Engineer no es "¿qué backbone usas?" sino "¿cómo construyes y operas el sistema que rodea al modelo?".` },
          { t: 'p', html: `En 2015, Sculley et al. (Google) publicaron <i>Hidden Technical Debt in Machine Learning Systems</i> (NeurIPS). Su figura más citada muestra una caja pequeña, "ML code", rodeada de cajas mucho más grandes: configuración, recolección de datos, extracción de features, verificación de datos, gestión de recursos, herramientas de análisis, gestión de procesos, infraestructura de serving y monitoreo. El mensaje no es un porcentaje exacto (la figura es ilustrativa y yo tampoco te voy a inventar uno), sino dónde están el trabajo y la complejidad: casi todo el sistema es lo que rodea al modelo. La experiencia operativa apunta en la misma dirección: en una década de outages de uno de los pipelines de ML más grandes de Google, la mayoría no fueron fallas específicas de ML sino del carácter distribuido del sistema (Papasian y Underwood, <a href="https://www.usenix.org/conference/opml20/presentation/papasian" target="_blank" rel="noopener"><i>How ML Breaks</i></a>, USENIX OpML 2020).` },
          { t: 'diagram', id: 'sculley-cajas', title: 'El modelo es la caja chica', caption: 'Inspirado en la figura 1 de Sculley et al. (NeurIPS 2015). Los tamaños no son proporciones medidas: toca cada caja para ver por qué existe.', spec: SCULLEY },
          { t: 'callout', kind: 'why', html: `<p>El entrevistador de ML Engineer asume que sabes entrenar; lo que no sabe es si sabes lo demás. Cada minuto en la caja chica es un minuto sin dar señal en las otras nueve. Tu ventaja (entiendes el modelo a fondo) sirve para decisiones puntuales: qué optimización no rompe la calidad, qué slices pueden fallar, cuándo basta un modelo más simple. No para llenar el pizarrón de capas.</p>` },
          { t: 'h3', text: 'Las cuatro restricciones que el notebook no tiene' },
          { t: 'list', ordered: true, items: [
            `<b>Latencia y throughput.</b> Además de accuracy, ahora hay un p99 ≤ 200 ms (el 99 % de los requests responde en menos de 200 ms; el promedio esconde la cola lenta, <a href="#m03">M3</a>) con 500 req/s. Tu YOLO a 1280 px detecta mejor los objetos pequeños que a 640 px, pero procesa 4× más píxeles (1280² / 640² = 4); en video a 30 fps llega un frame cada 33 ms: si procesas en serie, decode + inferencia + NMS + postproceso tienen que caber en 33 ms; con un pipeline por etapas basta con que cada etapa procese un frame en menos de 33 ms (throughput), aunque la latencia total sea mayor. Y el batch de 64 con que evaluabas no existe: llega una imagen por request y el batch lo arma el servidor (dynamic batching, <a href="#m03">M3</a>).`,
            `<b>Costo.</b> Una T4 en AWS (g4dn.xlarge, on-demand) cuesta ${est('≈ US$0.53/h')}: ${est('≈ US$384/mes')} encendida 24/7, y dos réplicas por disponibilidad ${est('≈ US$770/mes')} antes de CPU, red y logs. Con 5 req/s quizá ni necesitas GPU: un ResNet-50 en CPU con ONNX Runtime tarda ${est('decenas de ms por imagen')} y puede alcanzar. Batch, precisión (FP16/INT8) y autoscaling mueven la factura más que la arquitectura del modelo (<a href="#m04">M4</a>, <a href="#m13">M13</a>).`,
            `<b>Confiabilidad y disponibilidad.</b> 99.9 % de disponibilidad son ≈ 43 minutos de caída al mes. Si tu único nodo GPU se reinicia por un parche y tarda minutos en bajar la imagen de contenedor y cargar los pesos, te comiste una parte importante de ese margen. De ahí salen N+1 réplicas (una más de las que necesita el pico, para que la caída de una no se note), health checks, timeouts y un fallback cuando el modelo no responde (<a href="#m15">M15</a>).`,
            `<b>Cambio en el tiempo.</b> Tu set de validación es una foto del pasado. Salen celulares con otro procesamiento de imagen (HDR, sharpening), cambia la temporada, la app empieza a comprimir más, el negocio agrega 20 categorías. Eso es <b>data drift</b> (cambia la distribución de los inputs) y <b>concept drift</b> (cambia la relación input → label). El modelo no lanza un error: se equivoca con confianza (<a href="#m12">M12</a>).`,
          ] },
          { t: 'p', html: `Hay más (seguridad, privacidad, reproducibilidad, quién es dueño de cada pieza), pero estas cuatro aparecen en todas las entrevistas. Si tu diseño no dice algo concreto sobre cada una, está incompleto.` },
          { t: 'table', caption: 'Notebook vs producción', head: ['Aspecto', 'En tu notebook', 'En producción', 'Qué implica para el diseño'], rows: [
            ['Datos de entrada', 'Dataset curado y fijo, mismo formato siempre', 'Fotos reales: rotadas por EXIF, borrosas, capturas de pantalla, PNG con alfa, 40 MP, archivos corruptos', 'Validación de input, límites de tamaño, preprocesamiento robusto, errores claros (400/413/415)'],
            ['Métrica', 'Top-1 o mAP en validación', 'p99 de latencia, costo por 1,000 predicciones, métrica online (tasa de aceptación) ligada a una de negocio (publicaciones completadas)', 'Métricas en tres niveles: negocio, online, offline; más guardrails'],
            ['Preprocesamiento', 'Transforms de torchvision dentro del DataLoader', 'Reimplementado en un servicio (quizá con OpenCV, quizá en otro lenguaje)', 'Riesgo de training-serving skew; compartir código o meterlo en el modelo (<a href="#m09">M9</a>)'],
            ['Hardware', 'Tu GPU, batch 64, sin límite de tiempo', 'GPU compartida o CPU, una imagen por request, SLO de latencia (el objetivo que te comprometes a cumplir, p. ej. p99 ≤ 200 ms)', 'Dynamic batching, optimización (FP16/INT8), capacity planning'],
            ['Fallas', 'Se cae el kernel y vuelves a correr la celda', 'Se cae un nodo a las 3 a. m. con usuarios esperando', 'N+1, health checks, timeouts, fallback, on-call'],
            ['Versionado', '<code>model_final_v2_ahora_si.pt</code>', 'Model registry con linaje: qué datos, qué código, qué métricas', 'Reproducibilidad y rollback en minutos'],
            ['Tiempo', 'El dataset no cambia', 'La distribución cambia; aparecen clases nuevas', 'Monitoreo de drift y reentrenamiento'],
            ['Labels', 'Vienen con el dataset', 'Hay que conseguirlos: humanos, feedback implícito, con retraso de días o semanas', 'Pipeline de labeling, muestreo, active learning'],
            ['Quién consume', 'Tú', 'Otros servicios y equipos que dependen de un contrato', 'API versionada, compatibilidad, SLO publicado'],
            ['Evaluación', 'Una vez, offline', 'Continua: gate offline, shadow, canary, A/B', 'Pipeline de evaluación, golden set, rollout gradual'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Resolver la entrevista como si fuera un paper', html: `<p>Te piden "diseña un sistema de detección de defectos" y dibujas un backbone, un FPN y una loss. Eso es un modelo, no un sistema. Un buen control: si a los 15 minutos tu pizarrón no tiene cajas de logs, monitoreo o fallback, vas mal.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Este módulo es el mapa: te da el vocabulario y el orden. Cada caja del diagrama tiene su módulo: patrones de inferencia en <a href="#m02">M2</a>, latencia y capacidad en <a href="#m03">M3</a>, model servers en <a href="#m07">M7</a>, datos y features en <a href="#m09">M9</a>, MLOps en <a href="#m10">M10</a>, despliegue seguro en <a href="#m11">M11</a> y monitoreo en <a href="#m12">M12</a>. El <a href="#c01">caso 1</a> lo junta en un sistema completo con archivos reales.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'ciclo-de-vida',
        dims: ['arquitectura', 'monitoreo'],
        title: 'El ciclo de vida de ML en producción',
        titleEn: 'The production ML lifecycle',
        priority: 'core',
        blocks: [
          { t: 'p', html: `Cualquier sistema de ML en producción pasa por las mismas etapas, sea un clasificador de imágenes, un detector de fraude o un recomendador. Apréndelas como checklist: cada etapa es una pregunta potencial del entrevistador y cada una tiene una forma típica de fallar. Primero, un hilo concreto: el ResNet-50 del <a href="#c01">caso 1</a>, que sugiere la categoría de un anuncio, recorriendo las 11 etapas.` },
          { t: 'steps', items: [
            { title: 'Definir el problema', meta: 'Problem framing', html: `<p>Sugerir el top-5 de 500 categorías mientras el vendedor llena el formulario. Éxito: que acepte una sugerencia. Baseline: sin sugerencia (el selector manual de hoy).</p>` },
            { title: 'Recolectar datos', meta: 'Data collection', html: `<p>Fotos de anuncios ya publicados con su categoría final. Sesgo de entrada: solo ves anuncios que llegaron a publicarse.</p>` },
            { title: 'Etiquetar', meta: 'Labeling', html: `<p>La categoría que eligió el vendedor es un label implícito, ruidoso y sesgado por la propia sugerencia. Se muestrea ≈ 1 % de los requests (≈ 100k/día; se guarda la referencia, la foto sigue en el storage del producto); de ahí, personas etiquetan ≈ 5k/mes elegidas a propósito (baja confianza, desacuerdo con el vendedor y una parte aleatoria) para medir sin ese sesgo. Solo esas imágenes se copian, sin EXIF.</p>` },
            { title: 'Preprocesar', meta: 'Features / preprocessing', html: `<p>Decode, orientación EXIF, resize, normalización: un solo paquete que usan el training y el gateway.</p>` },
            { title: 'Entrenar', meta: 'Training', html: `<p>Fine-tuning como job reproducible: dataset versionado, código versionado, métricas registradas. Tu zona conocida.</p>` },
            { title: 'Evaluar offline', meta: 'Offline evaluation', html: `<p>Top-5 en un golden set fijo (set de evaluación curado y congelado, el mismo para todas las versiones) y por slices (subconjuntos como fotos nocturnas o categorías nuevas), contra el modelo en producción.</p>` },
            { title: 'Empaquetar y exportar', meta: 'Packaging / export', html: `<p>ONNX → engine TensorRT FP16 compilado en el mismo tipo de GPU que sirve, con test de paridad.</p>` },
            { title: 'Desplegar', meta: 'Deployment', html: `<p>Shadow (el modelo nuevo recibe una copia del tráfico y su respuesta se descarta), canary 5 % → 25 % → 100 % (primero un 5 % de los requests reales va a la versión nueva) con rollback automático si empeoran latencia, errores o la distribución de predicciones; la tasa de aceptación se valida en el A/B.</p>` },
            { title: 'Servir', meta: 'Serving', html: `<p>Gateway en CPU + Triton en GPU con dynamic batching; 2 GPUs por N+1.</p>` },
            { title: 'Monitorear', meta: 'Monitoring', html: `<p>p99, errores, distribución de scores, tasa de aceptación.</p>` },
            { title: 'Reentrenar', meta: 'Feedback & retraining', html: `<p>Logs y labels nuevos vuelven al dataset; se reentrena cuando el drift o la tasa de aceptación lo piden. Y el ciclo vuelve a empezar.</p>` },
          ] },
          { t: 'table', caption: 'Cada etapa: qué preguntas, qué produce, cómo falla y dónde se profundiza', head: ['Etapa', 'Pregunta clave', 'Artefacto', 'Herramientas típicas', 'Cómo falla', 'Módulo'], rows: [
            ['Problem framing', '¿Qué decisión mejora la predicción y cuánto cuesta un error?', 'Doc de diseño: tarea, métricas, baseline, supuestos', 'Un documento, no una herramienta', 'Optimizas la métrica equivocada (accuracy con clases desbalanceadas; CTR que premia el clickbait)', 'Este módulo, <a href="#m02">M2</a>'],
            ['Data collection', '¿De dónde salen los ejemplos y qué sesgo traen?', 'Datos crudos en el data lake, con schema', 'Logging del producto, Kafka/Kinesis, S3/GCS, Spark', 'Sesgo de selección; datos de un solo país o dispositivo; no guardaste lo que necesitabas', '<a href="#m09">M9</a>'],
            ['Labeling', '¿Quién etiqueta, con qué guía, a qué costo y con qué retraso?', 'Labels versionados + guía de etiquetado', 'CVAT, Label Studio, proveedores de labeling', 'Guía ambigua → ruido; labels que llegan semanas tarde; feedback implícito sesgado', '<a href="#m09">M9</a>'],
            ['Features / preprocesamiento', '¿Se calcula igual en training y en serving?', 'Función o paquete de preprocesamiento versionado; feature definitions', 'torchvision/Albumentations compartidos, Feast, validación de schema', 'Training-serving skew: RGB vs BGR, otro resize → cae la accuracy sin ningún error', '<a href="#m09">M9</a>'],
            ['Training', '¿Puedo reproducir exactamente este modelo?', 'Checkpoint + metadata (datos, código, config, métricas)', 'PyTorch, MLflow o W&amp;B, Kubeflow/SageMaker Pipelines', 'No sabes con qué datos se entrenó el modelo que está en producción', '<a href="#m10">M10</a>'],
            ['Evaluación offline', '¿Es mejor que el actual en lo que importa, incluidos los slices críticos?', 'Reporte de evaluación + decisión del gate', 'Scripts de evaluación, golden set, reportes por slice', 'El promedio oculta un slice roto (fotos nocturnas); leakage entre train y test', '<a href="#m10">M10</a>, <a href="#m08">M8</a>'],
            ['Packaging / export', '¿El artefacto corre igual en el hardware de producción?', 'ONNX / engine TensorRT + imagen de contenedor', 'ONNX, TorchScript, TensorRT (trtexec), Docker', 'Engine compilado para otra GPU; operador no soportado en el opset; FP16 cambia la salida', '<a href="#m08">M8</a>, <a href="#m05">M5</a>'],
            ['Deployment', '¿Cómo lo lanzo sin arriesgar a todos los usuarios y cómo vuelvo atrás?', 'Versión desplegada + plan de rollback', 'GitHub Actions, Argo CD, Argo Rollouts, KServe', 'Deploy "big bang" sin rollback; modelo y preprocesamiento desplegados por separado y desincronizados', '<a href="#m11">M11</a>, <a href="#m06">M6</a>'],
            ['Serving', '¿Cumplo latencia y throughput en el pico al costo acordado?', 'Endpoint con SLO', 'FastAPI, Triton, KServe, Ray Serve, vLLM', 'p99 explota en el pico; cold start de minutos cargando pesos; sin fallback', '<a href="#m02">M2</a>, <a href="#m03">M3</a>, <a href="#m07">M7</a>'],
            ['Monitoring', '¿Cómo me entero de que empeoró antes que el usuario?', 'Dashboards, alertas con umbral, runbooks', 'Prometheus/Grafana, Evidently, Datadog, CloudWatch', 'Dashboards verdes en latencia y CPU mientras la calidad cae en silencio', '<a href="#m12">M12</a>'],
            ['Feedback y reentrenamiento', '¿Cuándo reentreno y con qué datos?', 'Dataset nuevo versionado + trigger', 'Airflow, Kubeflow, Argo Workflows; colas de labeling', 'Feedback loop: el modelo aprende solo de lo que él mismo mostró; reentrenar con labels contaminados', '<a href="#m12">M12</a>, <a href="#m10">M10</a>'],
          ], note: 'Las herramientas son ejemplos de la categoría, no recomendaciones. En la entrevista importa la categoría y el porqué; la marca es secundaria.' },
          { t: 'h3', text: 'La arquitectura de referencia' },
          { t: 'p', html: `Este es el diagrama que vas a redibujar, con variaciones, en casi todos los casos. Arriba, el camino que corre en cada request; en medio, lo que corre por horas o días; abajo, lo que vigila a los dos. Toca cada caja para ver por qué existe y usa los recorridos para ver cómo fluye un request y cómo se cierra el lazo de reentrenamiento.` },
          { t: 'diagram', id: 'arquitectura-referencia', title: 'Arquitectura de referencia de un sistema de ML en producción', caption: 'Azul: por request. Ámbar: datos y entrenamiento. Violeta: monitoreo. El feature store cruza los dos carriles a propósito; la flecha punteada de CI/CD es el despliegue de una versión nueva.', spec: REF },
          { t: 'callout', kind: 'note', html: `<p>No dibujes todas estas cajas en los primeros 5 minutos de diseño. Empieza con el camino online mínimo y el lazo offline en una línea (logs → datos → training → registry → deploy), y agrega cajas cuando un requisito o un número las exija. El feature store, por ejemplo, solo entra si hay features además de la imagen.</p>` },
          { t: 'h3', text: 'Inner loop vs outer loop' },
          { t: 'table', head: ['', 'Inner loop (experimentación)', 'Outer loop (producción)'], rows: [
            ['Qué es', 'Iterar sobre el modelo: datos → entrenar → evaluar → cambiar algo', 'El ciclo de vida completo corriendo solo: datos nuevos → reentrenar → evaluar → desplegar → monitorear'],
            ['Ciclo', 'Horas', 'Días a semanas'],
            ['Métrica', 'Métrica offline en validación', 'SLOs, métricas online y de negocio'],
            ['Si falla', 'Pierdes una tarde', 'Lo sufren usuarios, otros equipos y on-call'],
            ['Tu experiencia', 'Mucha', 'Poca o ninguna: lo que vas a aprender aquí'],
          ] },
          { t: 'p', html: `La entrevista de ML System Design es, en su mayor parte, outer loop. El inner loop aparece en el deep dive si el entrevistador lo pide, y ahí tu experiencia en CV te da ventaja.` },
          { t: 'callout', kind: 'trap', title: 'Diseñar solo el camino online', html: `<p>El error más común de quien viene de modelado: cliente → API → modelo → respuesta, y listo. Faltan de dónde salen los labels, cómo se entrena el próximo modelo, cómo sabes que el nuevo es mejor y cómo te enteras de que el actual empeoró. El entrevistador anota "no closed loop". Regla: cualquier diseño tiene al menos dos flechas que conectan los carriles: logs → datos (online hacia offline) y registry → deploy (offline hacia online).</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'online-offline',
        title: 'Online vs offline: la separación que usarás en todos los casos',
        titleEn: 'Online vs offline paths',
        priority: 'core',
        blocks: [
          { t: 'p', html: `El camino online y el offline tienen reglas distintas: presupuesto de tiempo, tipo de cómputo, qué pasa cuando fallan, cómo escalan. Decidir qué pieza vive en cada uno es la primera decisión de arquitectura, y verlos separados es lo primero que un entrevistador busca en tu diagrama.` },
          { t: 'table', caption: 'Los dos caminos, lado a lado', head: ['Dimensión', 'Camino online', 'Camino offline'], rows: [
            ['Qué lo dispara', 'Un request de un usuario o de otro servicio', 'Un calendario, un evento (llegó un lote de labels) o una persona'],
            ['Presupuesto de latencia', 'Milisegundos: p99 típico de 50–300 ms para el request completo', 'Minutos a horas; importa el throughput y terminar antes de un deadline'],
            ['Frescura de los datos', 'Lo que trae el request; features de hace segundos o minutos', 'Snapshots de ayer o de hace una hora'],
            ['Tipo de cómputo', 'Siempre encendido, request/response, batches chicos armados al vuelo', 'Jobs efímeros, batches grandes, instancias spot/preemptible'],
            ['Impacto de una falla', 'El usuario lo ve de inmediato → necesitas fallback y timeouts', 'Se reintenta; el costo es atraso (el modelo viejo sigue más tiempo)'],
            ['Cómo escala', 'Horizontal por QPS: réplicas, autoscaling, N+1', 'Por volumen de datos: más workers, más particiones'],
            ['Costo dominante', 'Capacidad reservada para el pico, aunque sea de madrugada', 'GPU-horas de entrenamiento y almacenamiento'],
            ['Herramientas típicas', 'FastAPI/gRPC, Triton, KServe, vLLM, Redis, load balancer', 'Spark, Airflow/Kubeflow, PyTorch DDP, S3 + Parquet, herramientas de labeling'],
            ['Qué monitoreas', 'QPS, p50/p99, errores 5xx, saturación de GPU, largo de cola', 'Éxito y duración de jobs, calidad y frescura de datos, métricas del candidato'],
            ['Cómo cambias algo', 'Canary y rollback en minutos', 'Nueva versión del pipeline; a veces backfill de datos históricos'],
          ] },
          { t: 'h3', text: 'Lo "online" no siempre es request/response' },
          { t: 'p', html: `La pregunta que decide el patrón: <b>¿alguien espera la predicción antes de continuar?</b> Si no, casi siempre es más barato y más simple hacerlo asíncrono o en batch.` },
          { t: 'table', head: ['Patrón', 'Cuándo', 'Ejemplo en CV'], rows: [
            ['Online síncrono', 'Un usuario o servicio espera la respuesta', 'Sugerir la categoría mientras el vendedor llena el formulario (<a href="#c01">c01</a>)'],
            ['Asíncrono con cola', 'Se necesita en segundos o minutos, no en ms', 'Revisar fotos después de publicar; OCR de documentos (<a href="#c05">c05</a>)'],
            ['Batch offline', 'Sobre el inventario completo, cada cierto tiempo', 'Recalcular los embeddings del catálogo completo cada noche (<a href="#c07">c07</a>)'],
            ['Streaming', 'Flujo continuo de eventos o frames', 'Video de cámaras analizado en tiempo real (<a href="#c02">c02</a>)'],
            ['Edge / on-device', 'Sin red confiable, privacidad o latencia de pocos ms', 'Inspección junto a la línea de producción en un Jetson (<a href="#c03">c03</a>)'],
          ], note: 'La tabla de decisión completa, con costos y trade-offs, está en <a href="#m02">M2</a>.' },
          { t: 'h3', text: 'Training-serving skew: el bug que no lanza excepciones' },
          { t: 'p', html: `Un ejemplo concreto. Entrenaste con torchvision: <code>PIL.Image.open</code> → RGB, <code>Resize(256)</code> que conserva el aspect ratio → <code>CenterCrop(224)</code> → <code>Normalize</code> con la media y desviación de ImageNet. En serving, alguien de backend reescribe el preprocesamiento con OpenCV: <code>cv2.imread</code> (que entrega <b>BGR</b>) y <code>cv2.resize</code> directo a 224×224, sin crop (deforma el aspect ratio) y sin antialias. El servicio responde 200, la latencia es perfecta y el modelo predice con confianza alta. Solo que peor: puede costarte varios puntos de accuracy (cuántos, solo lo sabes midiéndolo) y nadie se entera hasta que alguien mira la métrica de negocio.` },
          { t: 'list', items: [
            `<b>Orden de canales:</b> RGB vs BGR. El más clásico y el más silencioso.`,
            `<b>Resize:</b> interpolación, antialias, resize + crop vs resize directo, aspect ratio.`,
            `<b>Orientación EXIF:</b> <code>cv2.imread</code> aplica la rotación EXIF por defecto; <code>PIL.Image.open</code> no (necesitas <code>ImageOps.exif_transpose</code>). La misma foto de celular llega derecha a un pipeline y de lado al otro.`,
            `<b>Normalización:</b> escala 0–1 vs 0–255, media y desviación distintas, olvidarla.`,
            `<b>Decoder y precisión:</b> decodificar en CPU vs en GPU (nvJPEG), FP32 vs FP16. Diferencias pequeñas que casi nunca importan, pero se miden, no se suponen.`,
            `<b>Features tabulares:</b> una ventana de "últimos 7 días" calculada distinto en el pipeline batch y en el servicio. Es el skew típico de recomendación y fraude.`,
          ] },
          { t: 'h3', text: 'Dónde debe vivir el preprocesamiento compartido' },
          { t: 'tradeoffs', items: [
            { option: 'Un paquete de preprocesamiento versionado que importan training y serving', verdict: 'elegido', pros: 'Una sola implementación; se versiona junto con el modelo; fácil de testear.', cons: 'Obliga a usar el mismo lenguaje (Python) en training y en el servicio.', why: 'Es el default razonable para CV con un servicio en Python: elimina la causa más común de skew con muy poco costo.' },
            { option: 'Meter el preprocesamiento dentro del modelo exportado (capas en ONNX/TorchScript, ensemble de Triton, DALI)', verdict: 'depende', pros: 'Imposible desincronizarlo: viaja con los pesos. Puede correr en GPU.', cons: 'El decode de JPEG en GPU requiere nvJPEG/DALI; es menos flexible para validar inputs y dar errores claros.', why: 'Buena opción cuando el preprocesamiento es un cuello de botella de CPU o cuando varios clientes llaman al modelo directo.' },
            { option: 'Reimplementarlo en el servicio (otro lenguaje u otra librería)', verdict: 'descartado', pros: 'Libertad total para el equipo de backend.', cons: 'Dos implementaciones que divergen con el tiempo; es exactamente el ejemplo de arriba.', why: 'Solo si no hay otra opción, y entonces con un test de paridad obligatorio en CI.' },
            { option: 'Feature store (para features tabulares, no para la imagen)', verdict: 'depende', pros: 'Una definición para offline y online, con point-in-time correctness para training.', cons: 'Infraestructura nueva que operar; sobra si solo tienes la imagen.', why: 'Entra cuando hay features de usuario o de contexto con frescura; ver <a href="#m09">M9</a>.' },
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Menciona el <b>test de paridad</b> sin que te lo pidan: "tengo 100 imágenes golden; en CI corro el preprocesamiento de training y el de serving, comparo los tensores (diferencia absoluta máxima) y los logits; si pasan de una tolerancia, el build falla". Y la otra defensa: <b>loguea lo que sirves</b>. Martin Zinkevich lo pone en sus <i>Rules of Machine Learning</i>: guarda las features que usaste al servir y entrena con esas. Así el modelo aprende de lo mismo que va a ver.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Skew, feature store y point-in-time correctness, a fondo en <a href="#m09">M9</a>. La paridad del export (PyTorch vs ONNX vs TensorRT), en <a href="#m08">M8</a> y aplicada en el <a href="#c01">caso 1</a>.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'roles',
        title: 'Quién hace qué: ML Engineer vs los demás',
        titleEn: 'Who does what',
        priority: 'extra',
        blocks: [
          { t: 'p', html: `"ML Engineer" significa cosas distintas en cada empresa; esta tabla describe el centro de gravedad típico, no una regla. Sirve para calibrar qué esperan de ti y qué puedes delegar en voz alta en la entrevista ("esto lo resuelve el equipo de plataforma; yo le daría los requisitos").` },
          { t: 'table', head: ['Rol', 'Qué suele poseer', 'Entrevista típica', 'Qué espera ese rol de ti (MLE)'], rows: [
            ['ML Engineer', 'Modelos en producción: pipelines de training, serving, evaluación, monitoreo; a veces el modelado', 'Coding, ML fundamentals, ML system design, behavioral', 'Es tu rol: que diseñes el sistema completo y lo puedas operar, no solo el modelo'],
            ['Data Scientist', 'Análisis, métricas de producto, experimentos, prototipos de modelos (en algunas empresas es principalmente analítica)', 'SQL, estadística, product sense, casos de negocio', 'Que conviertas su prototipo en un servicio confiable y le des logs limpios para medir'],
            ['Research Scientist', 'Métodos y arquitecturas nuevas, papers, benchmarks internos', 'Profundidad en ML y matemática, research talk, coding', 'Que industrialices sus ideas (export, optimización, serving) y le expliques las restricciones de latencia y costo'],
            ['MLOps / ML Platform', 'La plataforma compartida: infraestructura de training, feature store, registry, serving platform, CI/CD', 'System design de infraestructura, Kubernetes, sistemas distribuidos, coding', 'Que uses bien la plataforma y le des requisitos claros: QPS, latencia, GPU, frescura'],
            ['Data Engineer', 'Pipelines de datos, data lake y warehouse, calidad y contratos de datos', 'SQL, modelado de datos, Spark/streaming, system design de datos', 'Que definas qué datos necesitas, con qué schema y frescura, y que respetes los contratos'],
            ['Backend SWE', 'Servicios de producto, APIs, bases de datos, confiabilidad', 'Coding (estructuras de datos y algoritmos), system design clásico, behavioral', 'Una API estable con contrato (latencia, errores, fallback) que puedan consumir sin saber nada del modelo'],
          ] },
          { t: 'h3', text: 'Qué suele evaluar un proceso de ML Engineer' },
          { t: 'list', items: [
            `<b>Coding:</b> problemas de estructuras de datos y algoritmos y/o coding práctico de ML (implementar IoU y NMS, una métrica, un data loader, k-means). Depende mucho de la empresa.`,
            `<b>ML fundamentals:</b> bias/variance, métricas, desbalance, evaluación, leakage. Tu fortaleza; no la descuides, pero no es donde más puntos marginales ganas.`,
            `<b>ML system design:</b> 45–60 minutos, un enunciado ambiguo. Es lo que entrena este curso.`,
            `<b>Behavioral:</b> ownership, conflictos, decisiones con información incompleta. Si nunca llevaste nada a producción, usa proyectos de mecatrónica o de tu maestría donde hubo restricciones reales: tiempo real, hardware limitado, algo que tenía que funcionar sin ti.`,
            `<b>A veces:</b> un system design clásico sin ML, o una ronda de profundidad en tu dominio (CV).`,
          ] },
          { t: 'callout', kind: 'note', html: `<p>La mezcla exacta varía por empresa y por nivel, y cambia con el tiempo. Pregúntale al recruiter qué rondas hay y si el system design es más de producto o de infraestructura. Es una pregunta normal y te ahorra preparar lo que no toca.</p>` },
          { t: 'callout', kind: 'why', title: 'Tu background de mecatrónica sí cuenta', html: `<p>Un lazo de control a 1 kHz es un presupuesto de latencia de 1 ms con consecuencias físicas si lo incumples. Ese reflejo (presupuesto por etapa, peor caso y no promedio, qué pasa si un sensor falla) es exactamente el que buscan en el serving. Úsalo como analogía cuando hables de p99 y de degradación con gracia.</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'que-evalua',
        title: 'Qué evalúa una entrevista de ML System Design',
        titleEn: 'What the interview scores',
        priority: 'core',
        blocks: [
          { t: 'h3', text: 'El formato' },
          { t: 'list', items: [
            `<b>45–60 minutos.</b> En una ronda de 60, descuenta ≈ 5–10 de presentación y ≈ 5–10 de tus preguntas al final: quedan ≈ 40–50 de diseño. Por eso el framework está calibrado a 45.`,
            `<b>Un enunciado ambiguo, a propósito.</b> "Diseña un sistema que sugiera la categoría de un producto a partir de sus fotos." Quieren ver cómo lo acotas.`,
            `<b>Tú conduces.</b> El entrevistador responde, interrumpe con follow-ups y te redirige si te pierdes, pero no te dice qué sigue. Si esperas instrucciones, anota "necesitó guía".`,
            `<b>Pizarrón virtual</b> (Excalidraw, Miro, un doc compartido) o físico. Casi nunca se escribe código; a veces te piden la firma de una API o un pseudo-schema.`,
            `<b>Hay una rúbrica.</b> Después de la entrevista, el entrevistador llena una evaluación por dimensiones a partir de sus notas. Tu trabajo es darle frases concretas para esas notas.`,
          ] },
          { t: 'h3', text: 'ML System Design vs system design clásico' },
          { t: 'table', head: ['', 'System design clásico', 'ML System Design'], rows: [
            ['El centro', 'Almacenamiento, consistencia, particionado, caché', 'Datos, labels, métricas, modelo como componente, ciclo de reentrenamiento'],
            ['Qué puede estar "mal" sin error', 'Poco: un bug suele dar un error', 'Mucho: el sistema responde 200 y se equivoca (drift, skew)'],
            ['Métrica de éxito', 'Latencia, disponibilidad, consistencia', 'Lo mismo, más calidad del modelo y métrica de negocio'],
            ['Evaluación y hardware', 'Tests, load tests; CPU, memoria, red', 'Además evaluación offline, shadow, A/B; GPU, VRAM, batching'],
            ['Lo que se reusa', 'Load balancers, colas, caches, réplicas, SLOs', 'Siguen aplicando: no los olvides por pensar en el modelo'],
          ] },
          { t: 'h3', text: 'Los tres sabores' },
          { t: 'table', head: ['Sabor', 'Ejemplos de enunciado', 'Dónde está el peso', 'Cómo lo reconoces en 2 minutos', 'Cómo repartes el tiempo'], rows: [
            ['Product ML (modeling-heavy)', 'Feed o recomendaciones (<a href="#c08">c08</a>), ranking de búsqueda (<a href="#c07">c07</a>), ads CTR, fraude (<a href="#c09">c09</a>), moderación (<a href="#c06">c06</a>)', 'Framing, labels, features, elección de modelo, métricas offline/online, A/B', 'El enunciado habla de usuarios y de un objetivo de negocio ("más engagement", "menos fraude"); el entrevistador pregunta por features y métricas', 'Más tiempo en datos, features, modelo y evaluación; serving a alto nivel pero con números'],
            ['ML infra / platform', 'Feature store, plataforma de training distribuido, serving multi-modelo, servir un LLM propio (<a href="#c10">c10</a>)', 'Escalabilidad, confiabilidad, APIs, multi-tenancy, costo', 'No hay un problema de negocio concreto; el "cliente" es otro equipo de ML; preguntan por throughput, aislamiento y fallas', 'Más tiempo en componentes, contratos, escala y fallas; el modelo es casi una caja negra'],
            ['Applied (mixto)', 'API de clasificación (<a href="#c01">c01</a>), video en tiempo real (<a href="#c02">c02</a>), inspección en planta (<a href="#c03">c03</a>), OCR (<a href="#c05">c05</a>)', 'End-to-end: datos + serving con restricciones duras (latencia, GPU, edge)', 'Hay un input concreto (imágenes, video, documentos) y un requisito de latencia o volumen', 'Balanceado; el deep dive suele ser serving/throughput o el pipeline de datos'],
          ], note: 'Con tu perfil de CV es razonable esperar principalmente applied y product ML, pero depende del equipo: prepara los tres, no en partes iguales.' },
          { t: 'callout', kind: 'interview', html: `<p>Si no está claro, pregúntalo directo; no es debilidad, es conducir:</p><ul><li>"Should I focus more on the modeling side or on the serving infrastructure?"</li><li>"Is the model itself in scope, or should I treat it as a given and design around it?"</li></ul>` },
          { t: 'h3', text: 'Las 6 señales que anota el entrevistador' },
          { t: 'p', html: `Son las mismas 6 dimensiones de la rúbrica que usa el <a href="#practica">modo práctica</a> para tu autoevaluación. Para cada una: la pregunta que se hace el entrevistador y dos ejemplos de nota, una que te sube y una que te hunde.` },
          { t: 'table', head: ['Dimensión', 'La pregunta que se hace', 'Nota que te sube', 'Nota que te hunde'], rows: R.map((d) => [
            '<b>' + d.title + '</b><br><span class="en">' + d.en + '</span>',
            d.question,
            (RUBRIC_NOTES[d.id] || ['', ''])[0],
            (RUBRIC_NOTES[d.id] || ['', ''])[1],
          ]) },
          { t: 'callout', kind: 'why', html: `<p>El entrevistador escribe notas mientras hablas y después las traduce a un nivel por dimensión. Si dices "usaría autoscaling", no hay nada que anotar. Si dices "escalo por largo de cola del model server, entre 2 y 4 réplicas, porque escalar por CPU no refleja la carga de una GPU", eso se copia casi textual a la nota. Habla en frases que se puedan citar.</p>` },
          { t: 'h3', text: 'Qué cambia por nivel' },
          { t: 'table', head: ['Aspecto', 'Junior / mid', 'Senior', 'Staff'], rows: [
            ['Quién conduce', 'El entrevistador guía con preguntas', 'Tú conduces; el entrevistador valida y empuja', 'Tú conduces y propones qué vale la pena profundizar y por qué'],
            ['Alcance', 'Un componente bien hecho (p. ej. el serving)', 'El sistema end-to-end: online y offline, monitoreo, rollout', 'Sistema + organización: plataforma compartida, costo a escala, evolución a 1–2 años'],
            ['Números', 'Los hace si se los piden', 'Los pone sin que se los pidan y decide con ellos', 'Además dice cuál número es incierto y cómo lo mediría (load test, piloto)'],
            ['Trade-offs', 'Nombra alternativas', 'Elige con criterio y dice cuándo cambiaría', 'Suma reversibilidad, costo de oportunidad y riesgo para el equipo'],
            ['Datos y labels', 'Asume que hay labels', 'Diseña cómo conseguirlos: costo, retraso, sesgos, feedback loops', 'Estrategia de datos a largo plazo, privacidad y regulación'],
            ['Operación', '"Hay que monitorear"', 'Métricas de sistema y de modelo, alertas concretas, rollback', 'SLOs, error budgets, on-call, respuesta a incidentes, gobierno de costos'],
            ['Profundidad', 'Correcta pero superficial', 'Profunda en 1–2 áreas elegidas con el entrevistador', 'Profunda, y además sabe dónde no vale la pena profundizar'],
          ], note: 'El mismo diseño técnico puede leerse como mid o como senior según cómo lo conduces y cómo justificas cada decisión.' },
          { t: 'callout', kind: 'trap', title: 'Cero minutos o veinte minutos de modelo: los dos pierden', html: `<p>Incluso en una entrevista de infraestructura, cubre en ≈ 5 minutos (no 0, no 25) qué labels hay, qué métrica importa y cuál es el baseline. Sin eso, tu infraestructura no tiene para qué existir. Y el riesgo opuesto, el tuyo como persona de CV: pasar 20 minutos en el backbone, las augmentations y la loss. Resiste. Una frase basta: "ResNet-50 preentrenada y fine-tuned; no es el cuello de botella; si quieres, lo discutimos después". Si el entrevistador quiere más modelo, te lo va a pedir, y entonces sí brillas.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I'll start with a simple, proven model — say, a fine-tuned ResNet-50 — and focus on the system around it. Happy to go deeper on the model later if that's useful."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'framework',
        dims: ['comunicacion'],
        title: 'El framework de 7 pasos para 45 minutos',
        titleEn: 'The 7-step framework',
        priority: 'core',
        blocks: [
          { t: 'p', html: `Este es el esqueleto que vas a usar en cada caso del curso, y el que muestra el temporizador del <a href="#practica">modo práctica</a> según el minuto. Las ventanas son una guía, no una ley: si el entrevistador te lleva a otro lado, lo sigues. Sin esa guía, esta distribución cubre las 6 dimensiones de la rúbrica sin quedarte sin tiempo.` },
          { t: 'steps', items: F.map((s) => ({ title: s.title, meta: win(s) + ' · ' + s.en, html: STEP[s.id] || '' })) },
          { t: 'callout', kind: 'why', html: `<p>¿Por qué 12 minutos de deep dive y solo 5 de estimaciones? Porque las estimaciones valen por las decisiones que habilitan, y el deep dive es donde se distingue a un senior de un mid. Y ¿por qué 5 minutos de aclaración si parecen muchos? Porque cada supuesto mal puesto ahí te cuesta 10 minutos de diseño equivocado después.</p>` },
          { t: 'h3', text: 'Reparto según el sabor' },
          { t: 'table', head: ['Sabor', 'Reparto de los 45 minutos'], rows: [
            ['Applied e infra (<a href="#c01">c01</a>, <a href="#c02">c02</a>, <a href="#c03">c03</a>, <a href="#c05">c05</a>, <a href="#c10">c10</a>…)', 'Las 7 ventanas por defecto del temporizador.'],
            ['Product ML (<a href="#c06">c06</a>, <a href="#c08">c08</a>, <a href="#c09">c09</a>)', '0–5 aclarar · 5–10 framing ML y métricas · 10–13 estimaciones breves · 13–23 datos, labels y features · 23–33 modelo y evaluación offline · 33–40 serving y A/B · 40–45 monitoreo, fallas y cierre.'],
          ], note: 'El temporizador del modo práctica usa las ventanas por defecto; en un caso de product ML, úsalo como reloj y sigue este reparto.' },
          { t: 'h3', text: 'Cómo organizar el pizarrón' },
          { t: 'table', head: ['Zona', 'Qué va', 'Cuándo la llenas'], rows: [
            ['Arriba a la izquierda: supuestos', 'Escala, latencia, labels, restricciones, cada uno con "asumo"', 'Minutos 0–5; la actualizas si el entrevistador cambia algo'],
            ['Arriba al centro: requisitos y métricas', 'FR, NFR con números, métricas de negocio, online, offline y guardrails', 'Minutos 5–10'],
            ['Arriba a la derecha: números', 'QPS de diseño, GPUs, almacenamiento, costo. Solo resultados redondos', 'Minutos 10–15'],
            ['Centro (la zona más grande): diseño', 'Dos carriles, online y offline, más monitoreo', 'Minutos 15–37'],
            ['Abajo: deep dive', 'Zoom de un componente', 'Minutos 25–37'],
            ['Abajo a la derecha: riesgos y trade-offs', 'Fallas, mitigaciones, decisiones con su alternativa descartada', 'Anotas durante toda la entrevista; lo lees al cerrar'],
          ], note: 'En un pizarrón virtual, dibujar cajas cuesta tiempo. Usa texto con viñetas para las tres primeras zonas y dibuja solo el diseño.' },
          { t: 'h3', text: 'Cómo elegir el deep dive con el entrevistador' },
          { t: 'p', html: `Ni lo elijas solo ni preguntes en abierto sin propuesta. Ofrece 2–3 opciones que salgan de tus números y del sabor de la entrevista, y deja que elija: "Veo tres áreas interesantes: el serving a 500 req/s con batching, cómo conseguimos labels y el skew de preprocesamiento. ¿Dónde quieres que profundice?". Si te dice "tú eliges", elige el mayor riesgo y di por qué.` },
          { t: 'list', items: [
            `Si los números dicen que el sistema está limitado por GPU o la latencia está apretada → <b>serving</b>: batching, optimización, capacidad (<a href="#m03">M3</a>, <a href="#m07">M7</a>, <a href="#m08">M8</a>).`,
            `Si los labels son escasos, caros o ruidosos → <b>pipeline de datos y labeling</b> (<a href="#m09">M9</a>).`,
            `Si hay features de usuario o de contexto con frescura → <b>features, feature store y skew</b> (<a href="#m09">M9</a>).`,
            `Si un error es caro (moderación, fraude, salud) → <b>evaluación, umbrales y human in the loop</b> (<a href="#m11">M11</a>, <a href="#m12">M12</a>).`,
          ] },
          { t: 'h3', text: 'Cómo manejar las interrupciones' },
          { t: 'p', html: `Una interrupción es una señal, no un obstáculo: casi siempre te dice qué quiere ver el entrevistador.` },
          { t: 'table', head: ['Tipo de interrupción', 'Qué significa', 'Qué haces'], rows: [
            ['Pregunta de aclaración ("¿esto es por imagen o por anuncio?")', 'Algo no quedó claro', 'Respondes corto y vuelves a donde estabas'],
            ['"¿Y si el tráfico fuera 10×?"', 'Están probando escala', 'Rehaces la cuenta en voz alta y dices qué cambia: con 5,000 req/s ya son ≈ 10 GPUs, y ahora sí vale la pena INT8 o una GPU más grande'],
            ['"Cuéntame más de X"', 'Te están eligiendo el deep dive', 'Vas ahí, aunque no fuera tu plan'],
            ['Te corrigen', 'Viste algo mal o asumiste algo que no aplica', 'Aceptas, ajustas el diseño y sigues, sin defenderte de más'],
          ] },
          { t: 'p', html: `Si la interrupción toca algo que de verdad corresponde a un paso posterior, puedes estacionarla: "Buena pregunta; la anoto en riesgos y la retomo en monitoreo". Solo si realmente la retomas, y nunca con algo que el entrevistador quiere ahora.` },
          { t: 'h3', text: 'Si vas tarde' },
          { t: 'table', head: ['Si en el minuto…', '…todavía estás en', 'Haz esto'], rows: [
            ['12', 'Aclaración', 'Fija todos los supuestos de una vez ("voy a asumir X, Y, Z") y pasa a números en 2 minutos'],
            ['20', 'Estimaciones, o sin diagrama', 'Salta el detalle de costo; dibuja el diseño mínimo con los dos carriles en 3 minutos'],
            ['30', 'Arquitectura de alto nivel', 'Pide elegir un solo deep dive y limítalo a 7 minutos'],
            ['40', 'Mitad del deep dive', 'Corta: "para dejar tiempo a monitoreo y fallas, cierro aquí" y cubre los pasos 6–7 en viñetas'],
            ['43', 'Sin haber hablado de monitoreo', '60 segundos: dos métricas de sistema, una de modelo, una alerta con umbral, rollback; y el resumen'],
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Di el control de tiempo en voz alta: "I'm conscious of time — let me move on to monitoring." Muestra que conduces, suma en comunicación y le da al entrevistador la oportunidad de redirigirte si quería otra cosa.</p>` },
          { t: 'callout', kind: 'interview', title: 'Frases para abrir: pasos 1–3', html: `<ul>
            <li>"Before designing, I'd like to clarify a few things about the use case and the scale."</li>
            <li>"Who consumes the prediction, and what happens if it's wrong or late?"</li>
            <li>"Let me write down the requirements: functional first, then latency, throughput and availability."</li>
            <li>"The business goal is more completed listings. Online, I'll track the suggestion acceptance rate; offline, top-5 accuracy as a proxy; and p99 latency as a guardrail."</li>
            <li>"Let me do a quick back-of-the-envelope estimate. I'll round aggressively; I only care about the order of magnitude."</li>
            <li>"So roughly 500 requests per second at peak. One GPU covers the throughput, but I want two for redundancy."</li>
          </ul>` },
          { t: 'callout', kind: 'interview', title: 'Frases para el diseño: pasos 4–5', html: `<ul>
            <li>"I'll split the design into an online path and an offline path."</li>
            <li>"Let me start with the simplest version that works, and then evolve it where the numbers require it."</li>
            <li>"Let me walk through a single request end to end."</li>
            <li>"Does this high-level design make sense before I go deeper?"</li>
            <li>"Which area would you like me to go deeper on: serving, the data and labeling pipeline, or evaluation?"</li>
            <li>"The alternative would be gRPC. I'm not choosing it because load balancing is simpler with HTTP, but I'd switch if serialization overhead became the bottleneck."</li>
          </ul>` },
          { t: 'callout', kind: 'interview', title: 'Frases para cerrar: pasos 6–7', html: `<ul>
            <li>"Before rollout, the candidate has to match or beat the current model on a fixed golden set, including the critical slices."</li>
            <li>"I'd ship it in shadow mode first, then a 5% canary with automatic rollback."</li>
            <li>"I'd alert if p99 latency stays above 200 ms for 10 minutes, and on a shift in the distribution of prediction scores."</li>
            <li>"Let me go over the main failure modes and how the system degrades."</li>
            <li>"Let me summarize the key trade-offs."</li>
            <li>"With more time, I'd look into INT8 quantization to cut cost, and into how we label the long-tail categories."</li>
          </ul>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'preguntas-aclaracion',
        dims: ['aclaracion'],
        title: 'Preguntas de aclaración que cambian el diseño',
        titleEn: 'Clarifying questions that change the design',
        priority: 'core',
        blocks: [
          { t: 'p', html: `Una pregunta es buena si su respuesta cambia una caja o un número de tu diseño. "¿Qué lenguaje usa el backend?" casi nunca lo hace; "¿el usuario espera la respuesta?" decide entre un servicio online y una cola. Esta tabla es tu banco: no hagas las 12, elige las 5–7 que más mueven el enunciado que tienes delante.` },
          { t: 'table', head: ['Categoría', 'Pregunta (ES / EN)', 'Por qué cambia el diseño', 'Supuesto por defecto si no te responden'], rows: [
            ['Usuarios y caso de uso', '¿Quién consume la predicción y qué hace con ella?<br><span class="en">Who consumes the prediction, and what action does it drive?</span>', 'Decide si es síncrono (alguien espera) o asíncrono, y cuánto cuesta un error', 'Una persona en una UI esperando → síncrono, con fallback'],
            ['Usuarios y caso de uso', '¿Qué pasa si la predicción está mal?<br><span class="en">What is the cost of a wrong prediction?</span>', 'Fija precision vs recall, umbrales y si hace falta human in the loop', 'Error molesto pero no crítico → priorizo precision en lo que se muestra y dejo corregir'],
            ['Escala', '¿Cuántos requests por día y cómo es el pico?<br><span class="en">How many requests per day, and what does peak look like?</span>', 'Número de réplicas y GPUs, si vale la pena el batching, si hace falta un cluster', '10 M/día, pico ≈ 3× el promedio'],
            ['Escala', '¿Cuántas clases o ítems hay y cuánto crecen?<br><span class="en">How large is the label or item space, and how fast does it grow?</span>', 'Clasificación cerrada vs retrieval con embeddings; frecuencia de reentrenamiento', 'Cientos de clases, estables por trimestre'],
            ['Latencia / SLO', '¿Cuál es el presupuesto de latencia y la disponibilidad objetivo?<br><span class="en">What is the latency budget and the availability target?</span>', 'GPU vs CPU, tamaño del modelo, edge vs servidor, redundancia', 'p99 ≤ 200 ms server-side, 99.9 %'],
            ['Latencia / SLO', '¿Tiene que ser en tiempo real o puede tardar minutos?<br><span class="en">Does it need to be real time, or is near-real-time fine?</span>', 'Online vs cola asíncrona vs batch: la decisión de arquitectura más cara de revertir', 'Si hay alguien esperando, online; si no, asíncrono'],
            ['Datos y labels', '¿Hay labels? ¿De dónde salen y con cuánto retraso?<br><span class="en">Do we have labels? Where do they come from, and how delayed are they?</span>', 'Pipeline de labeling, costo, cadencia de reentrenamiento, cómo se evalúa online', 'Hay labels iniciales; el feedback implícito llega con días de retraso'],
            ['Datos y labels', '¿Qué datos hay disponibles al momento de predecir?<br><span class="en">What data is available at prediction time?</span>', 'Qué features son posibles, si hace falta feature store, riesgo de leakage', 'Solo el input (la imagen) y la metadata del request'],
            ['Restricciones', '¿Hay restricciones de privacidad, regulación, dispositivo o presupuesto?<br><span class="en">Any privacy, regulatory, on-device or budget constraints?</span>', 'On-device vs nube, retención de datos, PII (caras, placas), costo como requisito', 'Nube, sin PII sensible, presupuesto del orden de miles de US$/mes'],
            ['Métricas de éxito', '¿Cómo va a medir el negocio que esto funciona?<br><span class="en">How will the business measure success?</span>', 'Métrica primaria del A/B, guardrails, qué optimizas offline', 'Una métrica de producto (aceptación, conversión) más guardrails de latencia'],
            ['Estado actual', '¿Hay un modelo o una heurística hoy? ¿Un baseline?<br><span class="en">Is there an existing model or heuristic we are replacing?</span>', 'Define contra qué comparas, cómo haces el rollout y si el problema necesita ML', 'Existe un modelo entrenado offline, sin serving; el baseline es no tener ML'],
            ['Estado actual', '¿Hay infraestructura que deba reutilizar?<br><span class="en">Is there existing infrastructure I should build on?</span>', 'Evita diseñar una plataforma desde cero; cambia las herramientas', 'Nube pública con Kubernetes gestionado disponible'],
          ] },
          { t: 'callout', kind: 'trap', title: '15 preguntas sin fijar supuestos', html: `<p>Preguntar no es la señal; convertir las respuestas en supuestos útiles sí lo es. Con 15 preguntas gastas 10 minutos, y a la mitad el entrevistador te va a responder "lo que tú consideres razonable". Peor aún si preguntas cosas que no cambian nada. El entrevistador anota "no supo priorizar".</p>` },
          { t: 'callout', kind: 'senior', html: `<p>El patrón senior: 5–7 preguntas que cambian la arquitectura y después, en voz alta, "voy a asumir X; si no fuera así, cambiaría Y". Por ejemplo: "Voy a asumir que el vendedor espera la sugerencia en la pantalla, así que es síncrono con p99 ≤ 200 ms. Si pudiera esperar un minuto, lo haría con una cola y batches más grandes, que es más barato". Una sola frase demuestra que sabes qué decisión depende de qué supuesto.</p>` },
          { t: 'callout', kind: 'interview', html: `<ul><li>"I'll assume X. If that's wrong, the main thing that changes is Y."</li><li>"I'll assume the seller is waiting for the suggestion while filling out the form, so this is a synchronous call with a p99 under 200 ms."</li><li>"Let me pause here: are these assumptions reasonable?"</li></ul>` },
          { t: 'callout', kind: 'note', title: 'Cuando te dicen "tú decide"', html: `<p>No es evasión: están probando si sabes elegir defaults razonables. Elige, justifícalo en una línea y sigue. Quedarte bloqueado esperando un número "correcto" es peor que elegir uno defendible.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'estimaciones-express',
        dims: ['estimaciones'],
        title: 'Estimaciones express: los números que siempre necesitas',
        titleEn: 'Back-of-the-envelope essentials',
        priority: 'core',
        blocks: [
          { t: 'p', html: `El objetivo son órdenes de magnitud que cambian una decisión, no precisión. Si te equivocas por 2× y la decisión no cambia, no importa. Si te equivocas por 10×, pasas de "un par de réplicas" a "un cluster", y eso sí importa. Memoriza estos redondeos para no pensarlos en la entrevista.` },
          { t: 'kv', items: [
            ['1 día', '86,400 s ≈ 10<sup>5</sup> s', 'Redondear a 10<sup>5</sup> subestima el QPS ≈ 14 %; para el número final usa 86,400'],
            ['1 M requests/día', '≈ 12 req/s promedio', '10<sup>6</sup> / 86,400 ≈ 11.6'],
            ['10 M requests/día', '≈ 116 req/s promedio', 'El tráfico del caso 1'],
            ['Pico', est('≈ 2–5 × el promedio'),'Patrón diurno; eventos especiales (Black Friday) pueden ser más'],
            ['1 mes', '≈ 730 h ≈ 2.6 M s', 'Costo mensual = US$/h × 730'],
            ['1 año', '≈ 8,760 h ≈ 3.15 × 10<sup>7</sup> s', 'Truco: π × 10<sup>7</sup> s'],
            ['99.9 % de disponibilidad', '≈ 43 min de caída al mes', '99.99 % ≈ 4.4 min; 99 % ≈ 7.3 h'],
          ] },
          { t: 'h3', text: 'Bytes: pesos, tensores y logs' },
          { t: 'table', head: ['Qué', 'Bytes por valor', 'Ejemplo'], rows: [
            ['FP32', '4 B', 'ResNet-50: 25.6 M params × 4 B ≈ 102 MB'],
            ['FP16 / BF16', '2 B', 'ResNet-50 ≈ 51 MB; un LLM de 7 B params ≈ 14 GB solo de pesos'],
            ['INT8', '1 B', 'ResNet-50 ≈ 26 MB; LLM de 7 B ≈ 7 GB'],
            ['Imagen 224×224×3 en uint8', '1 B × 150,528 valores', '≈ 150 KB'],
            ['El mismo tensor en float32', '4 B × 150,528', '≈ 602 KB; un batch de 32 ≈ 19 MB'],
            ['JPEG de 1024 px de lado largo', 'comprimido', `${est('≈ 150–250 KB')} según calidad y contenido`],
            ['Log de una predicción (JSON)', '—', `${est('≈ 300 B')}: ids, top-5 con scores, latencia, versión`],
          ] },
          { t: 'callout', kind: 'trap', title: 'Pesos ≠ VRAM', html: `<p>La VRAM que usa un modelo al servir es pesos + activaciones (dependen del batch y de la resolución) + workspace del runtime + el contexto de CUDA (${est('cientos de MB')}). En una CNN los pesos son lo de menos; en un LLM manda el KV cache. El cálculo completo está en <a href="#m04">M4</a>.</p>` },
          { t: 'h3', text: 'Ejemplo trabajado con los números del caso 1' },
          { t: 'p', html: `Marketplace de segunda mano: el vendedor sube fotos y el servicio sugiere la categoría con un ResNet-50. Estos son exactamente los números que usa el <a href="#c01">caso 1</a>.` },
          { t: 'calc', title: 'Tráfico', rows: [
            { label: 'Volumen diario', expr: 'dato del enunciado', value: '10 M img/día' },
            { label: 'Promedio', expr: '10^7 / 86,400 s', value: '116 req/s' },
            { label: 'Pico diurno', expr: '116 × 3', value: '350 req/s' },
            { label: 'Pico de diseño', expr: '350 + margen para spikes', value: '500 req/s', note: 'Un número redondo y defendible' },
          ], result: 'Diseñas para <b>500 req/s</b>. Es tráfico modesto: no justifica Kafka ni una arquitectura distribuida exótica; justifica pocas réplicas bien hechas.' },
          { t: 'calc', title: 'GPUs', rows: [
            { label: 'Capacidad máxima medida por GPU', expr: 'T4, ResNet-50 FP16, dynamic batching; se mide con perf_analyzer', value: est('1,200 img/s'), note: 'Estimación: en el caso real la mides' },
            { label: 'Utilización objetivo', expr: 'margen para spikes y para el p99', value: '50 %' },
            { label: 'Capacidad planificada por GPU', expr: '1,200 × 0.5', value: '600 img/s' },
            { label: 'GPUs por throughput', expr: 'ceil(500 / 600)', value: '1' },
            { label: 'Redundancia N+1', expr: '+1, en otra zona de disponibilidad', value: '2 GPUs' },
          ], result: 'Una GPU alcanza; pides <b>dos por disponibilidad, no por throughput</b>. Esa frase es la señal: el número decide la arquitectura.' },
          { t: 'calc', title: 'Logs de predicción', rows: [
            { label: 'Tamaño por log', expr: 'JSON: request_id, versión, top-5, latencia, hash', value: est('300 B') },
            { label: 'Por día', expr: '10^7 × 300 B', value: '3 GB/día' },
            { label: 'Por año', expr: '3 GB × 365', value: '1.1 TB/año' },
            { label: 'Si guardaras las imágenes', expr: '10^7 × 200 KB', value: '2 TB/día', note: 'Unas 700 veces el volumen de los logs' },
          ], result: 'Guardas el <b>100 % de los logs</b> (es barato, y en Parquet comprimido ocupa menos) y solo un <b>hash</b> de la imagen: la foto ya vive en el almacenamiento del producto. Aparte muestreas ≈ 1 % de los requests (≈ 100k/día, guardando solo la referencia: ≈ 10 MB/día) y de ahí salen las ≈ 5k/mes que etiquetan personas; solo esas imágenes se copian.' },
          { t: 'p', html: `La versión completa, con VRAM, CPUs del gateway, presupuesto de latencia por componente y costo mensual, está en <a href="#c01.estimaciones">el caso 1</a>.` },
          { t: 'h3', text: 'La fórmula de GPUs' },
          { t: 'p', html: `<code>GPUs = ceil(pico / (capacidad medida × utilización objetivo)) + redundancia</code>` },
          { t: 'list', items: [
            `<b>Pico:</b> el de diseño, no el promedio. Diseñar para el promedio es el error más caro de esta sección.`,
            `<b>Capacidad medida:</b> el throughput máximo <i>que todavía cumple tu SLO de latencia</i>, no el máximo absoluto. Se mide con un load test (perf_analyzer para Triton; Locust o k6 para HTTP). En la entrevista no lo sabes de memoria: di un orden de magnitud, márcalo como estimación y di cómo lo medirías.`,
            `<b>Utilización objetivo:</b> ≈ 50–70 %. Cerca de saturación las colas crecen de forma no lineal y el p99 se dispara; además necesitas margen para spikes mientras el autoscaler reacciona.`,
            `<b>Redundancia:</b> N+1 como mínimo. Si repartes en dos zonas de disponibilidad, que cada zona pueda con el pico sola o que el autoscaler llegue a tiempo.`,
          ] },
          { t: 'h3', text: 'Little\'s law, en una línea' },
          { t: 'calc', title: 'Requests en vuelo', rows: [
            { label: 'Concurrencia', expr: 'throughput × latencia media = 500 req/s × 0.05 s', value: '25 requests en vuelo' },
            { label: 'Si la latencia media sube a 200 ms en un pico', expr: '500 × 0.2', value: '100 requests en vuelo' },
          ], result: 'Tu servicio tiene 25 requests simultáneos en promedio (y más en ráfagas): para eso dimensionas workers, conexiones y lugares en la cola del batcher. Si la latencia se degrada, la concurrencia se multiplica y aparecen colas y timeouts: por eso la latencia y la capacidad no se pueden planear por separado. Se desarrolla en <a href="#m03">M3</a>.' },
          { t: 'callout', kind: 'trap', title: 'Precisión falsa y otros errores de cuentas', html: `<ul><li>"115.74 req/s": los decimales no dan puntos, dan la impresión de que no sabes qué importa.</li><li>No redondear y hacer divisiones largas en voz alta durante 5 minutos.</li><li>Olvidar el pico y diseñar para el promedio.</li><li>Mezclar unidades: bits vs bytes, GB vs GiB, por segundo vs por día.</li></ul>` },
          { t: 'callout', kind: 'senior', html: `<p>Di el número <b>y la decisión</b> que implica. No "500 req/s", sino "≈ 500 req/s de pico, así que una T4 cubre el throughput y corro dos por N+1; no necesito un cluster grande ni un sistema de colas". El número solo es aritmética; el número con la decisión es diseño.</p>` },
          { t: 'callout', kind: 'estimate', html: `<p>Cada número de esta sección es un orden de magnitud. Antes de producción se mide con un load test. En la entrevista basta con decirlo una vez: "I'd validate this capacity number with a load test before committing to it".</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'senales',
        dims: ['tradeoffs'],
        title: 'Señales senior y errores que te hunden',
        titleEn: 'Senior signals and fatal mistakes',
        priority: 'core',
        blocks: [
          { t: 'p', html: `Lo que ve el entrevistador, momento a momento. La columna senior casi nunca requiere saber más; requiere decir en voz alta el porqué y la alternativa.` },
          { t: 'table', head: ['Momento o tema', 'Junior: lo que se ve', 'Senior: lo que se ve'], rows: [
            ['Primeros 2 minutos', 'Empieza a dibujar o habla del modelo', 'Pregunta lo que cambia el diseño y fija supuestos en voz alta'],
            ['Métricas', '"Accuracy"', 'Métrica de negocio → online → offline, con guardrails, y por qué esa'],
            ['Números', 'Ninguno, o con decimales', 'Redondos, con pico, y cada uno decide algo'],
            ['Arquitectura', 'Una caja "modelo", o 15 cajas con nombres de productos', 'Online y offline separados, simple primero, cada caja con su porqué'],
            ['El modelo', '15 minutos de backbone', '1–2 minutos: baseline simple + modelo probado; vuelve si se lo piden'],
            ['Datos', 'Asume un dataset limpio', 'De dónde salen los labels, cuánto cuestan, cuánto tardan, qué sesgo traen'],
            ['Herramientas', 'Name-dropping: Kafka, Kubernetes, Feast', 'Nombra la categoría y el porqué; la marca es secundaria'],
            ['Trade-offs', '"Depende" y no cierra', '"Elijo X por Y; cambiaría a Z si pasara W"'],
            ['Despliegue', '"Lo desplegamos"', 'Shadow → canary → rollback automático; modelo y preprocesamiento versionados juntos'],
            ['Monitoreo', '"Monitorearía el modelo"', 'Alertas con umbral y ventana; drift de inputs y de scores; métrica de negocio con labels retrasados'],
            ['Fallas', 'No las menciona', 'Qué falla, cómo se detecta, cómo degrada el sistema'],
            ['Comunicación', 'Monólogo; no mira el reloj', 'Agenda al inicio, chequeos, adapta el plan, resume al final'],
            ['Cuando no sabe algo', 'Inventa, o se bloquea', '"No lo sé con certeza; lo mediría así…"'],
          ] },
          { t: 'h3', text: 'Los 10 errores que te hunden' },
          { t: 'list', ordered: true, items: [
            `<b>Saltar directo a la arquitectura del modelo.</b> Antídoto: los primeros 10 minutos no contienen la palabra "backbone".`,
            `<b>No separar online y offline.</b> Antídoto: dos carriles desde la primera caja.`,
            `<b>Sin números.</b> Antídoto: QPS de diseño, GPUs y almacenamiento en menos de 5 minutos.`,
            `<b>Over-engineering:</b> Kafka + Kubernetes + feature store para 5 req/s (≈ 430 k requests al día, que un servicio en un par de réplicas resuelve). El mismo diseño para 50,000 req/s puede ser correcto. Antídoto: cada pieza de infraestructura justificada por un número o un requisito.`,
            `<b>Ignorar datos y labels.</b> Antídoto: una línea sobre de dónde salen los labels, cuánto cuestan y con qué retraso llegan.`,
            `<b>Sin monitoreo ni rollback.</b> Antídoto: una alerta concreta y un plan de rollback.`,
            `<b>Nombrar herramientas sin porqué.</b> Antídoto: categoría primero ("un model server con dynamic batching"), herramienta después ("por ejemplo Triton, porque…").`,
            `<b>No ligar la métrica ML con la de negocio.</b> Antídoto: la cadena negocio → online → offline en el paso 2.`,
            `<b>Monólogo sin chequeos.</b> Antídoto: un chequeo explícito al terminar los pasos 1, 4 y 5.`,
            `<b>Quedarse sin tiempo antes de las fallas.</b> Antídoto: en el minuto 40 cortas lo que estés haciendo.`,
          ] },
          { t: 'callout', kind: 'trap', title: 'El error del especialista en CV', html: `<p>Es el más probable en tu caso porque es tu zona cómoda: el entrevistador pregunta "¿qué modelo usarías?" y respondes con 10 minutos de EfficientNet vs ConvNeXt vs ViT, augmentations y label smoothing. La pregunta era una transición, no una invitación. Responde en dos frases (modelo probado, por qué basta, qué lo haría cambiar) y ofrece profundizar: "happy to go deeper if you want". Si quiere, te lo va a pedir.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Lo que más sube la nota, en una frase: <b>cada decisión con su porqué y su alternativa descartada</b>. "Uso HTTP/REST y no gRPC hacia el model server porque detrás de un balanceador L4 las conexiones HTTP/2 largas de gRPC no se reparten por request; cambiaría si la serialización se volviera el cuello de botella." (Por qué: un balanceador L4, como un Service de Kubernetes, reparte <i>conexiones</i>, no requests, y gRPC manda todo por una sola conexión HTTP/2 larga, así que cada cliente queda pegado a un solo pod. Lo ves a fondo en el <a href="#c01.serving">caso 1</a>.) Dicho en la entrevista, toma 10 segundos y alimenta dos dimensiones de la rúbrica a la vez.</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'ejemplo-guiado',
        title: 'Ejemplo guiado en 5 minutos',
        titleEn: 'A 5-minute guided example',
        priority: 'core',
        blocks: [
          { t: 'p', html: `<b>Enunciado:</b> "Detecta fotos borrosas antes de que un vendedor publique su anuncio."` },
          { t: 'p', html: `Los 7 pasos condensados, como si tuvieras 5 minutos en vez de 45: la forma completa de una respuesta y el tipo de frase que alimenta cada dimensión de la rúbrica. Nota que no aparece ninguna arquitectura de red neuronal.` },
          { t: 'steps', items: F.map((s) => ({ title: s.title, meta: s.en, html: '<p>' + (EX[s.id] || '') + '</p>' })) },
          { t: 'followups', items: [
            { q: '¿Necesitas deep learning aquí?',
              junior: 'Sí. Entrenaría una CNN (ResNet o EfficientNet) con transfer learning para clasificar nítida vs borrosa; con un buen dataset debería llegar a más de 95 % de accuracy.',
              senior: 'Primero no. Baseline: varianza del Laplaciano en CPU, unos milisegundos por imagen, cero entrenamiento, con el umbral calibrado sobre un golden set de 1–2k fotos etiquetadas. Mido precision al recall que me importa, por slice. Solo si el baseline falla en slices concretos (fondos lisos, fotos nocturnas, desenfoque de movimiento parcial) entreno una CNN chica y la comparo contra el baseline con la misma evaluación. Y el baseline se queda como fallback.',
              why: 'El ML es un medio: mides antes de construir, y el baseline es a la vez tu punto de comparación y tu plan de degradación. Es la mentalidad de las primeras reglas de Zinkevich (no temas lanzar sin ML; primer modelo simple, infraestructura bien hecha). Además, "95 % de accuracy" no dice nada sin la tasa base de fotos borrosas.' },
            { q: '¿Por qué no lo corres directamente en el celular?',
              junior: 'Tienes razón, en el celular es mejor porque no hay latencia de red.',
              senior: 'Buena optimización, pero no la primera. La web necesita el servidor igual; cambiar el umbral en el dispositivo requiere release o remote config, y las versiones viejas de la app conviven meses; y pierdo visibilidad si no logueo desde el cliente. Empiezo server-side para iterar el umbral rápido; cuando esté estable, muevo el Laplaciano al dispositivo con el umbral en remote config y el servidor sigue validando.',
              why: 'No se queda en latencia: considera versionado, observabilidad y velocidad de iteración, que son las consecuencias operativas de mover lógica al edge.' },
            { q: '¿Cómo sabes que el aviso ayuda y no molesta?',
              junior: 'Viendo la accuracy del modelo en el set de prueba.',
              senior: 'Con un A/B aleatorizado por vendedor, no por foto, para que nadie vea un comportamiento inconsistente. Métrica primaria: contactos por anuncio a 7 días; secundaria: % de avisos que terminan en una foto re-tomada. Guardrails: tasa de publicación y tiempo hasta publicar. Si los falsos positivos suben el abandono del formulario, subo el umbral. Y empiezo mostrando el aviso solo con score alto.',
              why: 'Liga el modelo a una métrica de negocio, elige bien la unidad de aleatorización y define guardrails: exactamente lo que la dimensión de monitoreo y operación busca.' },
          ] },
          { t: 'callout', kind: 'connect', html: `<p>Hiciste la versión corta. La versión larga del mismo marketplace, con serving en GPU, archivos reales y costo, es el <a href="#c01">caso 1</a>. Practícalo con el temporizador antes de leer la solución: <a href="#practica-c01">practicar c01</a>.</p>` },
        ],
      },

      // ======================================================== 11
      {
        id: 'mapa-del-curso',
        title: 'Cómo se conecta el resto del curso',
        titleEn: 'How the rest of the course connects',
        priority: 'core',
        blocks: [
          { t: 'p', html: `Cada módulo profundiza uno o varios pasos del framework, y cada caso los ejercita bajo presión distinta. Esta tabla te dice dónde ir cuando la rúbrica te muestre un paso débil.` },
          { t: 'table', head: ['Paso del framework', 'Módulos', 'Casos que más lo exigen'], rows: F.map((s) => [
            '<b>' + s.num + '. ' + s.title + '</b><br><span class="en">' + s.en + '</span>',
            (MAP[s.id] || ['', ''])[0],
            (MAP[s.id] || ['', ''])[1],
          ]) },
          { t: 'h3', text: 'Qué sale seguido y qué no' },
          { t: 'table', head: ['Tema', 'Frecuencia en entrevistas de MLE', 'Por qué'], rows: [
            ['Separar online/offline, patrón de inferencia (<a href="#m02">M2</a>)', 'Alta', 'Es la primera decisión de cualquier diseño'],
            ['Latencia, capacidad, GPUs para el pico (<a href="#m03">M3</a>)', 'Alta', 'Donde más candidatos pierden puntos por falta de números'],
            ['Model servers, batching (<a href="#m07">M7</a>)', 'Alta', 'El deep dive más común en casos con imágenes o video'],
            ['Datos, features, skew, labeling (<a href="#m09">M9</a>)', 'Alta', 'La mayoría de los incidentes reales vienen de datos'],
            ['Despliegue seguro y A/B (<a href="#m11">M11</a>)', 'Alta', 'Aparece como "¿cómo lanzas el modelo nuevo?"'],
            ['Monitoreo y drift (<a href="#m12">M12</a>)', 'Alta', 'Casi todas las entrevistas terminan aquí'],
            ['LLMs (<a href="#m14">M14</a>)', 'Alta y subiendo', 'Cada vez más procesos incluyen al menos una pregunta de LLMs'],
            ['Hardware, optimización, MLOps, orquestación, seguridad y confiabilidad (<a href="#m04">M4</a>, <a href="#m08">M8</a>, <a href="#m10">M10</a>, <a href="#m06">M6</a>, <a href="#m15">M15</a>)', 'Media', 'Salen en deep dives o al cerrar; basta con criterio y órdenes de magnitud'],
            ['Contenedores, nube (<a href="#m05">M5</a>, <a href="#m13">M13</a>)', 'Baja', 'Se asume que existen; importan el costo y algunos límites'],
          ] },
          { t: 'callout', kind: 'skip', html: `<p>Para un proceso de MLE enfocado en llevar modelos a producción, no inviertas tiempo de preparación en esto:</p><ul><li><b>Programar kernels de CUDA.</b> Es otro rol (performance engineer); a ti te basta saber que TensorRT o un compilador lo hacen y cuánto ganan.</li><li><b>Internals de Kubernetes</b> como etcd o los algoritmos del scheduler. Te preguntan qué pides (requests, autoscaling, nodos GPU), no cómo lo implementa el control plane.</li><li><b>Rutas de clics en la consola de la nube.</b> Nadie evalúa en qué menú está un botón; sí qué servicio usarías y cuánto cuesta.</li><li><b>Detalles exóticos de entrenamiento distribuido</b> (variantes de ZeRO, pipeline parallelism a mano) si tu proceso es de inferencia. Basta con saber que existen data y model parallelism y cuándo se usan. Si aplicas a un equipo de training de modelos grandes, esto sí cambia.</li></ul>` },
          { t: 'h3', text: 'Plan de estudio sugerido (4–6 semanas)' },
          { t: 'table', head: ['Semana', 'Qué', 'Meta al terminar'], rows: [
            ['1', 'Este módulo + <a href="#c01">caso 1</a> completo (primero en modo práctica, después la solución)', 'Recitas el framework y haces las estimaciones del caso 1 sin mirar'],
            ['2', '<a href="#m02">M2</a>, <a href="#m03">M3</a>, <a href="#m04">M4</a> + repetir <a href="#c01">c01</a> con el temporizador', 'Eliges el patrón de inferencia y calculas GPUs y VRAM en voz alta'],
            ['3', '<a href="#m05">M5</a>–<a href="#m08">M8</a> + <a href="#c02">c02</a>', 'Puedes sostener un deep dive de serving de 10 minutos con trade-offs'],
            ['4', '<a href="#m09">M9</a>–<a href="#m12">M12</a> + <a href="#c03">c03</a>, <a href="#c04">c04</a>', 'Cubres datos, rollout y monitoreo con alertas concretas en cualquier caso'],
            ['5', '<a href="#m13">M13</a>–<a href="#m15">M15</a> + <a href="#c05">c05</a>, <a href="#c06">c06</a>', 'Sumas costo, seguridad y LLMs; manejas pipelines con revisión humana'],
            ['6', '<a href="#c07">c07</a>–<a href="#c09">c09</a> + <a href="#c10">c10</a> y <a href="#c11">c11</a> (<a href="#c12">c12</a> si te alcanza; <a href="#c13">c13</a> solo si aplicas a una empresa de voz)', 'Los clásicos de producto y de LLMs sin quedarte en blanco; tres intentos seguidos por encima de 75 % en la rúbrica'],
          ], note: 'Sigue el orden de las fases de la app: cada semana usa lo que ya está publicado; los enunciados de fases futuras ya se pueden practicar aunque la solución llegue después. La semana 6 es la más cargada: si puedes, pártela en dos, y ciérrala repitiendo los casos con peor puntaje y con un simulacro con otra persona. Si solo tienes 4 semanas, junta la 2 con la 3 y la 4 con la 5, y no recortes los casos de LLMs (<a href="#c10">c10</a>, <a href="#c11">c11</a>): cada vez más procesos los incluyen.' },
          { t: 'h3', text: 'El ciclo de estudio en esta app' },
          { t: 'steps', items: [
            { title: 'Módulo', meta: 'Leer', html: `<p>Lee y marca cada sección como leída. En la primera pasada, sáltate lo marcado "Sáltate esto".</p>` },
            { title: 'Flashcards', meta: 'Fijar', html: `<p>Repasa las <a href="#flashcards">flashcards</a> del módulo: números, trampas y frases en inglés. Vuelven según qué tan bien las supiste.</p>` },
            { title: 'Caso en modo práctica', meta: '45 min con temporizador', html: `<p>En el <a href="#practica">simulador</a>, escribe tu diseño con el temporizador corriendo, como lo dirías en voz alta. El riel del framework te dice en qué paso deberías ir.</p>` },
            { title: 'Rúbrica', meta: 'Autoevaluar', html: `<p>Evalúate en las 6 dimensiones y marca los puntos clave que cubriste. Importa menos el puntaje que cuál dimensión sale más débil.</p>` },
            { title: 'Solución', meta: 'Comparar', html: `<p>Lee la solución del caso y compárala con tu intento. Anota lo que te faltó en una línea.</p>` },
            { title: 'Repetir', meta: 'En unos días', html: `<p>Vuelve al módulo de tu dimensión más débil y repite el caso unos días después. El <a href="#historial">historial</a> te muestra si mejoras.</p>` },
          ] },
          { t: 'h3', text: 'Lecturas opcionales' },
          { t: 'list', items: [
            `<b>Chip Huyen, <i>Designing Machine Learning Systems</i> (O'Reilly, 2022).</b> La mejor referencia general del ciclo de vida en producción; léela para datos, features, drift y monitoreo.`,
            `<b>Ali Aminian y Alex Xu, <i>Machine Learning System Design Interview</i> (ByteByteGo, 2023).</b> Casos resueltos con formato de entrevista; útil para ver cómo se estructura una respuesta de producto (recomendación, búsqueda, ads).`,
            `<b>Sculley et al., <i>Hidden Technical Debt in Machine Learning Systems</i> (NeurIPS 2015).</b> Corto; léelo para el vocabulario de deuda técnica (entanglement, feedback loops, configuración).`,
            `<b>Martin Zinkevich, <a href="https://developers.google.com/machine-learning/guides/rules-of-ml" target="_blank" rel="noopener"><i>Rules of Machine Learning</i></a>.</b> Reglas prácticas de Google para lanzar y mejorar sistemas de ML; léelo para la mentalidad de baseline primero y de loguear lo que sirves.`,
            `<b>Google, <a href="https://sre.google/sre-book/service-level-objectives/" target="_blank" rel="noopener"><i>Site Reliability Engineering</i></a> (O'Reilly, 2016), capítulo de SLOs.</b> Léelo para hablar con precisión de SLI, SLO, SLA y error budgets.`,
          ] },
        ],
      },

      // ======================================================== 12
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, relee la sección de la explicación antes de practicar el caso 1.` },
          { t: 'quiz', items: [
            { q: '10 M requests al día equivalen, en promedio, a…', options: ['≈ 1,160 req/s', '≈ 12 req/s', '≈ 10,000 req/s', '≈ 116 req/s'], answer: 3,
              explain: '10<sup>7</sup> / 86,400 s ≈ 116 req/s. Atajo: 1 M/día ≈ 12 req/s, así que 10 M/día ≈ 120. Y no olvides que el pico es ≈ 2–5× eso.' },
            { q: 'Capacidad medida de 1,200 img/s por GPU, utilización objetivo de 50 %, pico de diseño de 500 req/s y N+1. ¿Cuántas GPUs?', options: ['1', '2', '3', '4'], answer: 1,
              explain: 'ceil(500 / (1,200 × 0.5)) + 1 = ceil(0.83) + 1 = 2. Una por throughput, otra por disponibilidad.' },
            { q: '¿Cuál es el síntoma típico de un training-serving skew?', options: ['La calidad online cae sin ningún error y con predicciones confiadas', 'Errores 500 en el servicio', 'Out of memory en la GPU', 'El p99 sube en los picos'], answer: 0,
              explain: 'El skew no lanza excepciones: el modelo recibe inputs distintos a los de training (RGB vs BGR, otro resize) y se equivoca con confianza. Se previene con preprocesamiento compartido y un test de paridad.' },
            { q: 'En una entrevista con sabor de infraestructura (p. ej. "diseña un feature store"), ¿cuánto tiempo le das a labels, métricas y baseline?', options: ['Nada, no es el tema', '≈ 5 minutos', '≈ 20 minutos', 'La mitad de la entrevista'], answer: 1,
              explain: 'Breve pero presente: sin saber para qué se usan los datos y cómo se mide el éxito, la infraestructura no tiene requisitos. Cero es un error; 20 minutos también.' },
            { q: 'Con 500 req/s y 50 ms de latencia media, ¿cuántos requests hay en vuelo según Little\'s law?', options: ['2.5', '10', '25', '250'], answer: 2,
              explain: '500 × 0.05 = 25 en promedio. Si la latencia media sube a 200 ms, son 100: las colas crecen justo cuando menos margen tienes.' },
            { q: 'Te dan el enunciado. ¿Cuál es tu primer movimiento?', options: ['Dibujar la arquitectura', 'Elegir el backbone', 'Estimar cuántas GPUs necesitas', 'Preguntar lo que cambia el diseño y fijar supuestos'], answer: 3,
              explain: 'Sin saber volumen, latencia, labels y qué significa éxito, cualquier diagrama o número es una apuesta. Pero con 5–7 preguntas, no 15.' },
            { q: 'El sistema recibe 5 req/s y lo mantiene un equipo de 2 personas. ¿Qué diseño es más defendible?', options: ['Kafka + Kubernetes + feature store', 'Un cluster de Spark', 'Un servicio (p. ej. FastAPI) en 1–2 réplicas, con fallback y logs', 'Entrenamiento online en streaming'], answer: 2,
              explain: '5 req/s son ≈ 430 k requests al día: pocas réplicas lo resuelven. Cada pieza extra es costo de operación para un equipo chico. La infraestructura se justifica con un número.' },
            { q: '¿Cuál de estas es una métrica guardrail para el caso de sugerencia de categoría?', options: ['p99 de latencia del servicio', 'Top-5 accuracy offline', 'Número de categorías', 'Loss de entrenamiento'], answer: 0,
              explain: 'Un guardrail es lo que no puede empeorar aunque la métrica principal mejore. Un modelo más preciso pero más lento puede romper la experiencia; por eso el p99 se vigila en el A/B. Otro guardrail razonable: el % de anuncios recategorizados después por moderación.' },
            { q: '¿Cuánto pesan los pesos de ResNet-50 (25.6 M params) en FP16?', options: ['≈ 13 MB', '≈ 26 MB', '≈ 51 MB', '≈ 102 MB'], answer: 2,
              explain: '25.6 M × 2 B ≈ 51 MB. En FP32 serían ≈ 102 MB y en INT8 ≈ 26 MB. La VRAM total al servir es mayor: activaciones, workspace y contexto de CUDA.' },
          ] },
          { t: 'checklist', id: 'antes-de-practicar', items: [
            { id: 'framework', html: 'Recito los 7 pasos del framework con sus ventanas de minutos.' },
            { id: 'preguntas', html: 'Abro con 5–7 preguntas que cambian el diseño y las convierto en supuestos ("asumo X; si no, cambia Y").' },
            { id: 'trafico', html: 'Hago 10 M/día → ≈ 116 req/s → pico ≈ 350 → diseño 500 sin calculadora.' },
            { id: 'gpus', html: 'Sé la fórmula de GPUs y por qué la utilización objetivo es ≈ 50–70 % y no 100 %.' },
            { id: 'carriles', html: 'Dibujo online y offline separados en menos de 3 minutos, con logs → datos → training → registry → deploy.' },
            { id: 'skew', html: 'Doy un ejemplo concreto de training-serving skew en CV y cómo lo prevengo.' },
            { id: 'metricas', html: 'Nombro métrica de negocio, métrica online, métrica offline y dos guardrails para un caso.' },
            { id: 'rollout', html: 'Explico cómo se despliega un modelo nuevo: gate offline → shadow → canary → rollback.' },
            { id: 'alerta', html: 'Tengo lista una alerta concreta: métrica, umbral y ventana.' },
            { id: 'frases', html: 'Tengo tres frases en inglés para chequear con el entrevistador y una para cerrar.' },
            { id: 'no-se', html: 'Sé decir "no lo sé con certeza; lo mediría así" en vez de inventar.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm01-01', kind: 'concepto', q: '¿Qué muestra la figura de Sculley et al. (NeurIPS 2015) y qué lección sacas para la entrevista?',
        a: 'La caja "ML code" es pequeña y está rodeada de infraestructura mucho mayor: datos, features, verificación, recursos, serving, monitoreo, configuración, orquestación. Lección: el trabajo y la complejidad están mayormente fuera del modelo (y la experiencia operativa muestra que también la mayoría de los outages); el entrevistador de MLE evalúa esas otras cajas.' },
      { id: 'm01-02', kind: 'concepto', q: '¿Cuáles son las cuatro restricciones de producción que tu notebook no tiene?',
        a: 'Latencia y throughput, costo, confiabilidad/disponibilidad y cambio en el tiempo (data y concept drift).' },
      { id: 'm01-03', kind: 'concepto', q: 'Los 7 pasos del framework con sus ventanas de minutos.',
        a: F.map((s) => s.num + '. ' + s.title + ' (' + win(s) + ')').join('<br>') },
      { id: 'm01-04', kind: 'numero', q: '1 M requests/día ≈ ¿cuántos req/s?', a: '≈ 12 req/s (10<sup>6</sup> / 86,400 ≈ 11.6). 1 día ≈ 10<sup>5</sup> s como redondeo rápido.' },
      { id: 'm01-05', kind: 'numero', q: 'Caso 1: 10 M img/día. ¿Promedio, pico y pico de diseño?', a: '≈ 116 req/s promedio, ≈ 350 req/s de pico (3×), 500 req/s de diseño con margen para spikes.' },
      { id: 'm01-06', kind: 'numero', q: 'Bytes por parámetro en FP32, FP16 e INT8, y cuánto pesa ResNet-50 en cada uno.', a: '4 / 2 / 1 B → ≈ 102 / 51 / 26 MB (25.6 M params).' },
      { id: 'm01-07', kind: 'numero', q: '¿Cuánto ocupa una imagen 224×224×3 en uint8 y en float32?', a: '≈ 150 KB en uint8 (150,528 valores) y ≈ 602 KB en float32. Un batch de 32 en float32 ≈ 19 MB.' },
      { id: 'm01-08', kind: 'concepto', q: 'Fórmula para el número de GPUs, con el ejemplo del caso 1.', a: '<code>ceil(pico / (capacidad medida × utilización objetivo)) + redundancia</code>. Caso 1: ceil(500 / (1,200 × 0.5)) + 1 = 2 GPUs: una por throughput, otra por N+1.' },
      { id: 'm01-09', kind: 'numero', q: 'Little\'s law con 500 req/s y 50 ms de latencia media.', a: 'Concurrencia promedio = throughput × latencia media = 500 × 0.05 = 25 requests en vuelo. Si la latencia media sube a 200 ms, son 100.' },
      { id: 'm01-10', kind: 'numero', q: '1 mes ≈ ¿cuántas horas? ¿Cuánta caída permite 99.9 % al mes?', a: '≈ 730 h (≈ 2.6 M s). 99.9 % ≈ 43 min de caída al mes; 99.99 % ≈ 4.4 min.' },
      { id: 'm01-11', kind: 'tradeoff', q: '¿Qué pregunta decide entre inferencia online y asíncrona o batch?', a: '¿Alguien espera la predicción antes de continuar? Si sí, online síncrono con fallback. Si no, una cola o un batch: más barato, batches más grandes, fallas que se reintentan.' },
      { id: 'm01-12', kind: 'trampa', q: 'Fuentes típicas de training-serving skew en un pipeline de CV (nombra al menos tres).', a: 'RGB vs BGR (<code>cv2.imread</code> entrega BGR); resize distinto (interpolación, antialias, crop vs deformar el aspect ratio); orientación EXIF (OpenCV la aplica por defecto, PIL no); normalización distinta.' },
      { id: 'm01-13', kind: 'concepto', q: '¿Cómo previenes el skew de preprocesamiento?', a: 'Una sola implementación versionada que usan training y serving (o el preprocesamiento dentro del modelo exportado); un test de paridad en CI con imágenes golden; y loguear lo que sirves para entrenar con eso.' },
      { id: 'm01-14', kind: 'concepto', q: 'Las 6 dimensiones de la rúbrica de ML System Design.', a: R.map((d) => d.title + ' (' + d.en + ')').join('<br>') },
      { id: 'm01-15', kind: 'concepto', q: 'Los tres sabores de entrevista y cómo reconocerlos.', a: 'Product ML (usuarios + objetivo de negocio; peso en datos, features, métricas), ML infra/platform (el cliente es otro equipo; peso en escala, contratos, fallas) y applied/mixto (input concreto como imágenes o video + requisito de latencia o volumen).' },
      { id: 'm01-16', kind: 'trampa', q: 'Entrevista de infraestructura: ¿te saltas labels, métricas y baseline?', a: 'No. ≈ 5 minutos (no 0, no 25). Sin saber para qué se usa y cómo se mide el éxito, la infraestructura no tiene requisitos.' },
      { id: 'm01-17', kind: 'trampa', q: 'Kafka + Kubernetes + feature store para 5 req/s: ¿qué anota el entrevistador?', a: '"Over-engineering; no sabe dimensionar." 5 req/s ≈ 430 k requests/día: un servicio en 1–2 réplicas con fallback y logs basta. La infraestructura se justifica con un número.' },
      { id: 'm01-18', kind: 'trampa', q: '¿Qué falta si diseñas solo el camino online?', a: 'El lazo cerrado: logs → datos → labels → training → evaluation gate → registry → deploy, más monitoreo. El entrevistador anota "no closed loop".' },
      { id: 'm01-19', kind: 'tradeoff', q: 'Preguntar vs asumir en los primeros 5 minutos.', a: '5–7 preguntas que cambian la arquitectura y luego supuestos explícitos: "voy a asumir X; si no, cambiaría Y". 15 preguntas sin supuestos es tan malo como ninguna.' },
      { id: 'm01-20', kind: 'concepto', q: 'Inner loop vs outer loop.', a: 'Inner loop: experimentar con el modelo (horas, notebook, métrica offline). Outer loop: el ciclo de vida corriendo solo en producción (días o semanas, pipelines, SLOs, métricas online). La entrevista es principalmente outer loop.' },
      { id: 'm01-21', kind: 'concepto', q: 'Las métricas en tres niveles, con el caso 1.', a: 'Negocio: tasa de publicaciones completadas (el vendedor termina y publica). Online: tasa de aceptación de la categoría sugerida. Offline: top-5 accuracy en el golden set. Guardrails: p99 de latencia, % de anuncios recategorizados por moderación y tiempo para completar el formulario.' },
      { id: 'm01-22', kind: 'tradeoff', q: 'Detección de fotos borrosas: ¿servidor u on-device primero?', a: 'Servidor primero: la web lo necesita igual, el umbral se itera sin releases y tienes logs. Después mueves la heurística al dispositivo con remote config para ahorrar la ida y vuelta, y el servidor sigue validando.' },
      { id: 'm01-23', kind: 'trampa', q: '"Capacidad medida por GPU": ¿es el throughput máximo absoluto?', a: 'No. Es el throughput máximo que todavía cumple el SLO de latencia, medido con un load test (perf_analyzer, Locust, k6). Y se planifica a ≈ 50–70 % de esa cifra.' },
      { id: 'm01-24', kind: 'trampa', q: '¿Qué hay de malo en decir "115.74 req/s"?', a: 'Precisión falsa: los decimales no dan puntos y consumen tiempo. Redondea (≈ 120), usa el pico y di la decisión que implica.' },
      { id: 'm01-25', kind: 'frase', q: '¿Cómo abres después de escuchar el enunciado? (en inglés)', a: '"Before designing, I\'d like to clarify a few things about the use case and the scale."' },
      { id: 'm01-26', kind: 'frase', q: '¿Cómo fijas un supuesto? (en inglés)', a: '"I\'ll assume X. If that\'s wrong, the main thing that changes is Y."' },
      { id: 'm01-27', kind: 'frase', q: '¿Cómo entras a las estimaciones? (en inglés)', a: '"Let me do a quick back-of-the-envelope estimate. I\'ll round aggressively; I only care about the order of magnitude."' },
      { id: 'm01-28', kind: 'frase', q: '¿Cómo presentas el diseño de alto nivel? (en inglés)', a: '"I\'ll split the design into an online path and an offline path."' },
      { id: 'm01-29', kind: 'frase', q: '¿Cómo eliges el deep dive con el entrevistador? (en inglés)', a: '"Which area would you like me to go deeper on: serving, the data and labeling pipeline, or evaluation?"' },
      { id: 'm01-30', kind: 'frase', q: '¿Cómo cierras? (en inglés)', a: '"Let me summarize the key trade-offs." Y después: "With more time, I\'d look into…"' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'A/B test', es: 'prueba A/B', def: 'Experimento que reparte usuarios al azar entre la versión actual y la nueva y compara una métrica primaria y guardrails con significancia estadística.', say: 'We would run an A/B test randomized by seller, with listing contacts as the primary metric.' },
      { en: 'active learning', es: 'aprendizaje activo', def: 'Elegir qué ejemplos etiquetar según lo que más ayuda al modelo (baja confianza, desacuerdo, errores) en vez de muestrear al azar.', say: 'We would use active learning to send low-confidence images to the labeling queue.' },
      { en: 'availability', es: 'disponibilidad', def: 'Fracción del tiempo (o de requests) en que el servicio responde correctamente. 99.9 % ≈ 43 min de caída al mes.', say: 'The target is 99.9% availability, so we need at least two replicas in different zones.' },
      { en: 'availability zone (AZ)', es: 'zona de disponibilidad', def: 'Uno o más data centers aislados dentro de una región de la nube; repartir réplicas en 2+ zonas protege de la caída de una.', say: 'We run one GPU replica per availability zone.' },
      { en: 'back-of-the-envelope estimate', es: 'estimación rápida (en servilleta)', def: 'Cálculo de orden de magnitud con números redondos para tomar decisiones de diseño: QPS, GPUs, almacenamiento, costo.', say: 'Let me do a quick back-of-the-envelope estimate before choosing the hardware.' },
      { en: 'backfill', es: 'reproceso histórico', def: 'Correr un modelo o pipeline sobre datos que ya existían (p. ej. clasificar las 200 M imágenes ya publicadas) por un camino batch separado del online.', say: 'The backfill runs as a separate batch job on spot instances, never against the online endpoint.' },
      { en: 'baseline', es: 'línea base', def: 'La solución más simple con la que comparas (una heurística, el modelo actual o no usar ML). También sirve de fallback.', say: 'The baseline is a Laplacian-variance threshold; the CNN has to beat it on the same golden set.' },
      { en: 'batch inference', es: 'inferencia batch (offline)', def: 'Predicciones calculadas por lotes sobre muchos datos, sin un usuario esperando; se guardan para usarlas después. También se le dice offline inference.', say: 'Catalog embeddings are recomputed with batch inference every night.' },
      { en: 'canary release', es: 'despliegue canario', def: 'Enviar un porcentaje pequeño del tráfico (p. ej. 5 %) a la versión nueva y ampliarlo solo si las métricas no empeoran.', say: 'I would start with a 5% canary and roll back automatically if p99 or error rates regress.' },
      { en: 'capacity planning', es: 'planificación de capacidad', def: 'Decidir cuántos recursos (réplicas, GPUs) necesitas para el pico a partir de la capacidad medida y una utilización objetivo.', say: 'For capacity planning I use the measured throughput at our latency SLO, not the theoretical maximum.' },
      { en: 'cold start', es: 'arranque en frío', def: 'Tiempo desde que el autoscaler decide escalar hasta que la réplica nueva atiende tráfico: provisionar el nodo (con GPU, minutos), descargar la imagen (varios GB con CUDA/Triton), cargar y calentar el modelo y pasar readiness. Por eso el autoscaling no absorbe spikes de segundos.', say: 'A cold start on a new GPU node takes several minutes, so we keep spare warm capacity instead of relying on autoscaling for short spikes.' },
      { en: 'concept drift', es: 'deriva de concepto', def: 'Cambia la relación entre input y label (lo que cuenta como "vintage", una categoría que se divide), aunque los inputs se vean iguales.', say: 'Concept drift shows up in delayed labels, not in the input distribution.' },
      { en: 'data drift', es: 'deriva de datos', def: 'Cambia la distribución de los inputs respecto de la de training: celulares nuevos, temporada, otra compresión en la app.', say: 'We monitor data drift by comparing image statistics and embedding distributions against the training set.' },
      { en: 'data lake', es: 'lago de datos', def: 'Almacenamiento barato y durable (S3, GCS) de datos crudos y procesados, típicamente en Parquet, que alimenta el camino offline.', say: 'Prediction logs land in the data lake as Parquet, partitioned by day.' },
      { en: 'deep dive', es: 'profundización', def: 'La parte de la entrevista en que haces zoom a uno o dos componentes con detalle concreto: batching, labels, features, evaluación.', say: 'Which area would you like me to deep dive into?' },
      { en: 'delayed labels', es: 'labels retrasados', def: 'Labels que llegan días o semanas después de la predicción; mientras tanto monitoreas con proxies.', say: 'Moderator labels are delayed by days, so we watch proxies in the meantime.' },
      { en: 'dynamic batching', es: 'batching dinámico', def: 'El model server junta requests que llegan en una ventana corta (p. ej. 2 ms) en un solo batch para aprovechar la GPU.', say: 'Dynamic batching with a 2 ms queue delay trades a little latency for much higher GPU throughput.' },
      { en: 'evaluation gate', es: 'compuerta de evaluación', def: 'Paso automático que decide si un modelo candidato puede reemplazar al actual: golden set, slices críticos, paridad y latencia.', say: 'The evaluation gate blocks any candidate that regresses on the night-photo slice.' },
      { en: 'fail-open', es: 'fallar abierto', def: 'Si el componente falla, el sistema sigue sin él en vez de bloquear (publicar sin el aviso de foto borrosa). Lo contrario es fail-closed.', say: 'The blur check fails open: if it times out, the listing is published without a warning.' },
      { en: 'fallback', es: 'respaldo, plan B', def: 'Respuesta alternativa cuando el modelo no responde a tiempo: una heurística, el modelo anterior, o la experiencia sin ML.', say: 'If inference times out, the fallback is the manual category picker.' },
      { en: 'feature store', es: 'almacén de features', def: 'Sistema que guarda features con una sola definición para training (histórico, point-in-time) y serving (baja latencia).', say: 'For pure image classification I would skip the feature store; it becomes useful once we add seller history.' },
      { en: 'feedback loop', es: 'lazo de retroalimentación', def: 'Cuando las predicciones del modelo influyen en los datos con los que se reentrena (solo ves lo que el modelo mostró), sesgándolo.', say: 'To avoid a feedback loop, part of the labeling sample is random, not chosen by the model.' },
      { en: 'golden set', es: 'set dorado', def: 'Conjunto de evaluación fijo, curado y bien etiquetado, que se usa para comparar versiones del modelo de forma consistente.', say: 'Every candidate is scored on the same frozen golden set of about 50,000 images, stratified by category.' },
      { en: 'graceful degradation', es: 'degradación con gracia', def: 'Diseñar el sistema para perder calidad de forma controlada (modelo más simple, fallback, menos features) en vez de caerse.', say: 'Under overload we degrade gracefully by returning cached or fallback predictions.' },
      { en: 'guardrail metric', es: 'métrica guardrail (de protección)', def: 'Métrica que no puede empeorar aunque la principal mejore: latencia, tasa de publicación, quejas.', say: 'p99 latency is a guardrail metric in the experiment.' },
      { en: 'headroom', es: 'margen de capacidad', def: 'Capacidad que dejas libre para spikes, fallas y el tiempo de reacción del autoscaler: 1 − utilización objetivo.', say: 'Planning at 50% utilization leaves headroom for a zone failure.' },
      { en: 'human-in-the-loop', es: 'humano en el lazo', def: 'Diseño en el que personas revisan o corrigen parte de las predicciones (las dudosas o las caras de equivocar) y esas correcciones vuelven como labels.', say: 'Low-confidence cases go to a human-in-the-loop review queue.' },
      { en: 'inner loop', es: 'ciclo interno', def: 'La iteración de experimentación sobre el modelo: datos, entrenar, evaluar, en horas.', say: 'My experience is mostly in the inner loop; in production I would automate the outer loop.' },
      { en: 'labeling', es: 'etiquetado', def: 'Proceso de obtener labels, con humanos o de forma implícita, con una guía, control de calidad, costo por label y retraso.', say: 'Labeling costs money and takes days, so it is a design constraint, not a detail.' },
      { en: 'Little\'s law', es: 'ley de Little', def: 'Concurrencia promedio = throughput × latencia promedio (L = λ·W), en régimen estable. Usa la latencia media, no el p99: 500 req/s × 0.05 s = 25 requests en vuelo en promedio.', say: 'By Little\'s law, at 500 requests per second and 50 ms average latency we have about 25 requests in flight.' },
      { en: 'ML lifecycle', es: 'ciclo de vida de ML', def: 'Las etapas de un sistema de ML en producción: framing, datos, labels, features, training, evaluación, export, deploy, serving, monitoreo y reentrenamiento.', say: 'Let me walk through the ML lifecycle for this system, from data collection to retraining.' },
      { en: 'model registry', es: 'registro de modelos', def: 'Catálogo de modelos versionados con linaje (datos, código, métricas) y estado; hace posible el rollback.', say: 'Rolling back never means retraining: the previous version is still in the model registry, ready to redeploy.' },
      { en: 'model server', es: 'servidor de modelos', def: 'Proceso especializado en ejecutar modelos (Triton, vLLM, Ray Serve) con batching, múltiples instancias y métricas.', say: 'The model server runs on GPU and handles dynamic batching.' },
      { en: 'N+1 redundancy', es: 'redundancia N+1', def: 'Tener una réplica más de las necesarias para el pico, para que la caída de una no rompa el servicio.', say: 'One GPU covers peak throughput; the second one is N+1 redundancy.' },
      { en: 'on-call', es: 'guardia', def: 'La persona del equipo que atiende las alertas urgentes durante su turno, con un runbook.', say: 'Latency alerts page the on-call; model-quality alerts open a ticket.' },
      { en: 'online inference', es: 'inferencia online', def: 'Predicción calculada por request mientras alguien espera la respuesta, con presupuesto de latencia.', say: 'Category suggestion is online inference because the seller is waiting on the form.' },
      { en: 'outer loop', es: 'ciclo externo', def: 'El ciclo de vida completo corriendo en producción: datos nuevos, reentrenamiento, evaluación, despliegue, monitoreo.', say: 'The outer loop retrains monthly, or earlier when drift persists for several days.' },
      { en: 'p99 latency', es: 'latencia p99', def: 'El valor por debajo del cual cae el 99 % de los requests. Describe la cola (tail latency) que el promedio esconde.', say: 'Our SLO is a p99 latency of 200 ms measured server-side.' },
      { en: 'page (paging)', es: 'alerta urgente al de guardia', def: 'Notificación que despierta al on-call a cualquier hora. Solo para síntomas que afectan al usuario ahora; lo demás es ticket.', say: 'We only page on user-facing symptoms like p99 and error rate.' },
      { en: 'point-in-time correctness', es: 'corrección en el tiempo (sin mirar el futuro)', def: 'Al armar el dataset de training, cada feature toma el valor que tenía en el momento de la predicción, no el de hoy; si no, el modelo aprende del futuro (leakage).', say: 'The feature store gives us point-in-time correct training data, so nothing leaks from the future.' },
      { en: 'prediction logging', es: 'registro de predicciones', def: 'Guardar por cada request la versión del modelo, el input (o su hash), el output y la latencia. Alimenta monitoreo, labeling y reentrenamiento.', say: 'Prediction logging is asynchronous so it never adds latency to the request.' },
      { en: 'proxy metric', es: 'métrica proxy', def: 'Métrica que puedes medir ya y que se mueve con la que te importa pero tarda (p. ej. la distribución de scores en vez de la accuracy con labels).', say: 'Until labels arrive, the low-confidence rate is our proxy metric.' },
      { en: 'QPS', es: 'consultas por segundo', def: 'Queries (requests) per second: la unidad de carga de un servicio. Se estima promedio, pico y pico de diseño.', say: 'We expect around 116 QPS on average and design for 500 QPS at peak.' },
      { en: 'rate limiting', es: 'límite de tasa', def: 'Cuota de requests por caller y por unidad de tiempo; protege la capacidad compartida de un caller ruidoso.', say: 'Each internal team gets its own rate limit at the API gateway.' },
      { en: 'rollback', es: 'reversión', def: 'Volver a la versión anterior (de modelo o de servicio) cuando la nueva empeora las métricas; idealmente automático y en minutos.', say: 'If the canary regresses, we roll back automatically to the previous model version.' },
      { en: 'runbook', es: 'manual de respuesta', def: 'Pasos concretos para quien recibe una alerta: qué mirar primero, cómo mitigar, cuándo escalar.', say: 'Every paging alert links to a runbook.' },
      { en: 'shadow deployment', es: 'despliegue en sombra', def: 'La versión nueva recibe una copia del tráfico real y predice, pero sus respuestas no llegan al usuario. Sirve para comparar sin riesgo.', say: 'We run the new model in shadow mode for a day or two before the canary.' },
      { en: 'slice', es: 'segmento (de evaluación)', def: 'Subconjunto de datos (fotos nocturnas, un país, una categoría) sobre el que se mide el modelo por separado para no esconder fallas en el promedio.', say: 'The candidate improves overall accuracy but regresses on the low-light slice.' },
      { en: 'SLA', es: 'acuerdo de nivel de servicio', def: 'Compromiso contractual con un cliente sobre un SLO, con consecuencias si se incumple. Suele ser menos estricto que el SLO interno.', say: 'The SLA with the partner team is looser than our internal SLO.' },
      { en: 'SLI', es: 'indicador de nivel de servicio', def: 'La métrica medida: p. ej. la fracción de requests que responden en menos de 200 ms.', say: 'The SLI is the fraction of requests served in under 200 ms.' },
      { en: 'SLO', es: 'objetivo de nivel de servicio', def: 'El objetivo interno para un SLI: p. ej. p99 ≤ 200 ms y 99.9 % de disponibilidad en 30 días.', say: 'The SLO is 99.9% availability and a p99 under 200 ms over a 30-day window.' },
      { en: 'throughput', es: 'rendimiento, caudal', def: 'Trabajo completado por unidad de tiempo (req/s, img/s, tokens/s). Se sube con batching, a costa de algo de latencia.', say: 'Batching improves throughput at the cost of a few milliseconds of latency.' },
      { en: 'training-serving skew', es: 'desfase entre training y serving', def: 'Diferencia entre cómo se preparan los datos en training y en serving (RGB vs BGR, otro resize) que degrada el modelo sin lanzar errores.', say: 'To prevent training-serving skew, both paths import the same preprocessing package and we run a parity test in CI.' },
      { en: 'utilization target', es: 'utilización objetivo', def: 'Fracción de la capacidad medida a la que planeas operar (≈ 50–70 %) para dejar margen a spikes y proteger el p99.', say: 'I plan at a 50% utilization target so the p99 stays flat during spikes.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
