/* Práctica de M01: banco de preguntas difíciles y notas rápidas (lo usa js/ui/drill.js). */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  MSD.drillBank = MSD.drillBank || {};
  const B = (MSD.drillBank.m01 = MSD.drillBank.m01 || {});

  // ------------------------------------------------------------ notas rápidas
  B.quick = [
    { id: 'q-framework', title: 'Framework de 7 pasos (45 min)', html: `
      <ol>
        <li><b>Aclarar</b> (0–5): lo que cambia el diseño → "voy a asumir X, Y, Z".</li>
        <li><b>Requisitos y métricas</b> (5–10): FR, NFR con número, negocio → online → offline + guardrails.</li>
        <li><b>Estimaciones</b> (10–15): QPS promedio → pico → diseño; GPUs, logs, costo. Número + decisión.</li>
        <li><b>Arquitectura</b> (15–25): simple primero, carril online y carril offline, recorre un request.</li>
        <li><b>Deep dives</b> (25–37): 1–2 áreas; ofrece 2–3 opciones; si "tú eliges", el mayor riesgo.</li>
        <li><b>Evaluación, despliegue y monitoreo</b> (37–42): gate → shadow → canary 5 % → A/B; alerta con umbral y ventana.</li>
        <li><b>Fallas, trade-offs y cierre</b> (42–45): 3 fallas con detección y mitigación, resumen de 30–60 s.</li>
      </ol>` },
    { id: 'q-numeros', title: 'Números que decides en voz alta', html: `
      <ul>
        <li>1 día ≈ 10<sup>5</sup> s · 1 M/día ≈ 12 req/s (11.6 exacto) · 10 M/día ≈ 116 req/s.</li>
        <li>Pico ≈ 2–5× (caso 1: ×3 → 350) · <b>diseño 500 req/s</b>.</li>
        <li><code>GPUs = ceil(pico / (capacidad medida × utilización)) + redundancia</code></li>
        <li>Capacidad medida = máximo que <i>cumple el SLO</i> (load test). Utilización ≈ 50–70 %. N+1 mínimo.</li>
        <li>Caso 1: ceil(500 / 600) + 1 = <b>2 GPUs</b>: una por throughput, otra por disponibilidad.</li>
        <li>Log ≈ 300 B → 3 GB/día (100 %); imágenes ≈ 2 TB/día → solo hash + muestra.</li>
        <li>Little: 500 × 0.05 s = 25 en vuelo; a 200 ms, 100.</li>
        <li>99.9 % ≈ 43 min/mes · 99.99 % ≈ 4.3 min · 99 % ≈ 7.2 h (mes de 30 días).</li>
      </ul>` },
    { id: 'q-patrones', title: 'Los 5 patrones de inferencia', html: `
      <p>Pregunta que decide: <b>¿alguien espera la predicción antes de continuar?</b></p>
      <table class="dtable"><thead><tr><th>Patrón</th><th>Cuándo</th></tr></thead><tbody>
        <tr><td>Online síncrono</td><td>Un usuario o servicio espera la respuesta (c01)</td></tr>
        <tr><td>Asíncrono con cola</td><td>Hace falta en segundos o minutos, no en ms (revisar fotos ya publicadas, OCR)</td></tr>
        <tr><td>Batch offline</td><td>Todo el inventario cada cierto tiempo (re-embeddings del catálogo)</td></tr>
        <tr><td>Streaming</td><td>Flujo continuo de eventos o frames (video en tiempo real)</td></tr>
        <tr><td>Edge / on-device</td><td>Sin red confiable, privacidad o latencia de pocos ms (Jetson en planta)</td></tr>
      </tbody></table>` },
    { id: 'q-online-offline', title: 'Online vs offline', html: `
      <table class="dtable"><thead><tr><th></th><th>Online</th><th>Offline</th></tr></thead><tbody>
        <tr><td>Disparo</td><td>Un request</td><td>Calendario, evento o persona</td></tr>
        <tr><td>Latencia</td><td>ms (p99 50–300 ms)</td><td>Minutos a horas; importa el throughput</td></tr>
        <tr><td>Cómputo</td><td>Siempre encendido, batches chicos al vuelo</td><td>Jobs efímeros, batches grandes, spot</td></tr>
        <tr><td>Si falla</td><td>El usuario lo ve → timeout + fallback</td><td>Se reintenta; el costo es atraso</td></tr>
        <tr><td>Escala</td><td>Réplicas por QPS, N+1</td><td>Workers y particiones por volumen</td></tr>
        <tr><td>Costo</td><td>Capacidad reservada para el pico</td><td>GPU-horas de training y almacenamiento</td></tr>
      </tbody></table>` },
    { id: 'q-ciclo', title: 'Ciclo de vida: 11 etapas y cómo fallan', html: `
      <ol>
        <li>Framing: métrica equivocada (accuracy con desbalance).</li>
        <li>Data collection: sesgo de selección; no guardaste lo necesario.</li>
        <li>Labeling: guía ambigua, labels tarde, feedback implícito sesgado.</li>
        <li>Preprocesamiento: training-serving skew (RGB/BGR, resize).</li>
        <li>Training: no sabes con qué datos se entrenó lo que está en prod.</li>
        <li>Evaluación offline: el promedio oculta un slice roto; leakage.</li>
        <li>Packaging: engine para otra GPU; FP16 cambia la salida.</li>
        <li>Deployment: big bang sin rollback; modelo y preproceso desincronizados.</li>
        <li>Serving: p99 explota en el pico; cold start; sin fallback.</li>
        <li>Monitoring: dashboards verdes mientras la calidad cae.</li>
        <li>Reentrenamiento: feedback loop; labels contaminados.</li>
      </ol>` },
    { id: 'q-aclaracion', title: 'Preguntas que más cambian el diseño', html: `
      <ul>
        <li>¿Quién consume la predicción y qué cuesta un error? → síncrono o no; precision vs recall.</li>
        <li>¿Tiempo real o puede tardar minutos? → online vs cola vs batch (la más cara de revertir).</li>
        <li>¿Volumen por día y pico? → réplicas, GPUs, batching.</li>
        <li>¿Presupuesto de latencia y disponibilidad? → GPU vs CPU, edge, redundancia.</li>
        <li>¿Hay labels, de dónde y con qué retraso? → labeling, reentreno, evaluación online.</li>
        <li>¿Privacidad, dispositivo, presupuesto? → on-device vs nube, retención.</li>
      </ul>
      <p>5–7 preguntas, luego: "asumo X; si no fuera así, cambiaría Y". Si te dicen "tú decide": elige un default defendible y sigue.</p>` },
    { id: 'q-senales', title: 'Señal senior vs bandera roja', html: `
      <table class="dtable"><thead><tr><th>Senior</th><th>Bandera roja</th></tr></thead><tbody>
        <tr><td>Supuestos en voz alta en los primeros minutos</td><td>Dibujar o hablar del backbone de entrada</td></tr>
        <tr><td>Números redondos con pico, cada uno decide algo</td><td>Sin números, o "115.74 req/s"</td></tr>
        <tr><td>Dos carriles, simple primero, cada caja con porqué</td><td>Kafka + K8s + feature store para 5 req/s</td></tr>
        <tr><td>"Elijo X por Y; cambiaría a Z si W"</td><td>"Depende" sin cerrar; name-dropping</td></tr>
        <tr><td>Shadow → canary → rollback; alerta con umbral</td><td>"Monitorearía el modelo"</td></tr>
        <tr><td>"No lo sé con certeza; lo mediría así…"</td><td>Inventar o bloquearse</td></tr>
      </tbody></table>` },
    { id: 'q-tarde', title: 'Si vas tarde o te interrumpen', html: `
      <table class="dtable"><thead><tr><th>Minuto / evento</th><th>Haz esto</th></tr></thead><tbody>
        <tr><td>12, aún aclarando</td><td>Fija todos los supuestos de una vez; a números en 2 min</td></tr>
        <tr><td>20, sin diagrama</td><td>Salta el costo; diseño mínimo con dos carriles en 3 min</td></tr>
        <tr><td>30, aún en alto nivel</td><td>Un solo deep dive, máximo 7 min</td></tr>
        <tr><td>40, mitad del deep dive</td><td>"Cierro aquí" y pasos 6–7 en viñetas</td></tr>
        <tr><td>"¿Y si fuera 10×?"</td><td>Rehaces la cuenta y dices qué cambia (≈ 10 GPUs, INT8)</td></tr>
        <tr><td>"Cuéntame más de X"</td><td>Vas ahí: te eligieron el deep dive</td></tr>
        <tr><td>Te corrigen</td><td>Aceptas, ajustas y sigues</td></tr>
      </tbody></table>` },
  ];

  // ------------------------------------------------------------ preguntas
  B.questions = [
    // ======================================================== de-modelo-a-sistema
    {
      id: 'm01-p01', section: 'de-modelo-a-sistema',
      q: `Te piden "diseña un sistema de detección de defectos para una línea de producción". Llevas 15 minutos y tu pizarrón tiene: backbone, FPN, cabeza de detección, focal loss y augmentations. ¿Cuál es el diagnóstico más preciso?`,
      options: [
        { html: `Diseñaste un modelo, no un sistema: no hay logs, monitoreo ni fallback, ni nada de latencia, costo o fallas.`, ok: true, why: `Es exactamente el control que propone el módulo: si a los 15 minutos no hay cajas de logs, monitoreo o fallback, vas mal. Lo que falta es el sistema que rodea al modelo.` },
        { html: `Elegiste un detector demasiado pesado; con un modelo más simple habrías tenido tiempo para el serving.`, ok: false, why: `Media verdad: el problema no es la complejidad del modelo sino haber pasado 15 minutos en la caja chica, sea cual sea el modelo.` },
        { html: `Faltó justificar por qué FPN y no otra arquitectura; con los trade-offs del modelo bien explicados, la señal sería senior.`, ok: false, why: `Los trade-offs del backbone siguen dentro de la caja "ML code". La señal senior está en decisiones del sistema, no en más detalle del modelo.` },
        { html: `Vas bien si en los 30 minutos que quedan cubres serving, monitoreo y fallas: el orden de los pasos no importa mientras al final llegues a todo lo que pide la rúbrica.`, ok: false, why: `Ya quemaste las ventanas de aclarar, requisitos y estimaciones (0–15) sin supuestos ni números; sin eso, el diseño que venga no tiene base.` },
      ],
      explain: `En una entrevista de ML Engineer se asume que sabes entrenar; cada minuto en el backbone es un minuto sin dar señal en las otras cajas (datos, serving, monitoreo, configuración). Si a los 15 minutos tu pizarrón no tiene logs, monitoreo o fallback, corrige el rumbo. Dilo así: "I'll start with a simple, proven model and focus on the system around it".`,
    },
    {
      id: 'm01-p02', section: 'de-modelo-a-sistema',
      q: `El entrevistador dice: "Tu modelo tiene 94 % de top-1 en validación. ¿Qué más necesitas saber antes de decir que está listo para producción?". ¿Qué respuesta cubre las cuatro restricciones que el notebook no tiene?`,
      options: [
        { html: `Accuracy por slice (fotos nocturnas, categorías nuevas), calibración de los scores, matriz de confusión y robustez a las augmentations que verás en producción.`, ok: false, why: `Todo es evaluación offline (inner loop). Es útil, pero no dice nada de latencia, costo, disponibilidad ni drift.` },
        { html: `Seguridad, privacidad, reproducibilidad y quién es dueño de cada pieza.`, ok: false, why: `El módulo las menciona como restricciones adicionales, pero las cuatro que aparecen en todas las entrevistas son otras.` },
        { html: `p99 y throughput en el pico, costo de GPUs, qué pasa si cae un nodo y cómo detecto drift.`, ok: true, why: `Son las cuatro: latencia/throughput, costo, confiabilidad/disponibilidad y cambio en el tiempo (data y concept drift).` },
        { html: `Latencia por imagen, throughput máximo, tamaño del modelo en MB y FLOPs por inferencia.`, ok: false, why: `Todo cae en la primera restricción (latencia y throughput); faltan costo, disponibilidad y drift.` },
      ],
      explain: `Las cuatro restricciones de producción son latencia y throughput, costo, confiabilidad/disponibilidad y cambio en el tiempo. Si tu diseño no dice algo concreto sobre cada una, está incompleto. Una buena respuesta las nombra con un número o un mecanismo cada una: p99 en el pico, US$/mes, N+1 y fallback, monitoreo de drift.`,
    },
    {
      id: 'm01-p03', section: 'de-modelo-a-sistema',
      q: `Seis meses después del lanzamiento, el negocio divide la categoría "Electrónica" en "Celulares" y "Accesorios". Las fotos que llegan se ven igual que antes. ¿Qué está pasando y dónde lo ves?`,
      options: [
        { html: `Data drift: la distribución de inputs se alejó de la de training; el drift job lo detecta comparando estadísticas de las imágenes contra la referencia y dispara el reentrenamiento.`, ok: false, why: `Los inputs no cambiaron: un monitor de drift de inputs no ve nada. Lo que cambió es la relación input → label.` },
        { html: `Concept drift: cambió la relación input → label, no los inputs; lo ves en los labels y en métricas online, no en el drift de inputs.`, ok: true, why: `Una categoría que se divide es el ejemplo de concept drift del módulo, y se manifiesta en los labels, no en los inputs.` },
        { html: `Training-serving skew: el modelo de serving trabaja con un catálogo de categorías distinto del de training.`, ok: false, why: `El skew es una diferencia en cómo se preparan los datos entre training y serving (RGB vs BGR, resize). Aquí ambos caminos están de acuerdo; el que cambió es el mundo.` },
        { html: `No es un problema de ML sino de configuración: basta con actualizar el mapeo de ids a nombres en el postproceso.`, ok: false, why: `Renombrar no reparte una clase en dos: el modelo no tiene salida para las nuevas. Hace falta etiquetar y reentrenar.` },
      ],
      explain: `Data drift es cambio en la distribución de los inputs; concept drift es cambio en la relación input → label aunque los inputs se vean iguales. El modelo no lanza un error: se equivoca con confianza. Y cuando el cambio lo decide el negocio, no esperas a verlo en las métricas: reetiquetas la clase vieja y reentrenas antes de activar la nueva taxonomía. En la entrevista: "Concept drift shows up in delayed labels, not in the input distribution", y por eso además del drift de inputs monitoreas métricas con labels y proxies online.`,
    },
    {
      id: 'm01-p04', section: 'de-modelo-a-sistema',
      q: `Sirves con un solo nodo GPU y un SLO de 99.9 % de disponibilidad mensual. Un parche reinicia el nodo y tarda 15 minutos en bajar la imagen de contenedor y cargar los pesos. ¿Qué conclusión es la correcta?`,
      options: [
        { html: `No pasa nada: 15 minutos está muy por debajo de las ≈ 7 h al mes que permite 99.9 %.`, ok: false, why: `≈ 7.2 h al mes corresponde a 99 %, no a 99.9 %.` },
        { html: `Rompiste el SLO en un solo evento: 99.9 % permite ≈ 4 minutos de caída al mes.`, ok: false, why: `≈ 4.3 min al mes es 99.99 %. Con 99.9 % tienes ≈ 43 min.` },
        { html: `Lo resuelve el autoscaling: cuando el health check marca el nodo como caído, el autoscaler levanta otro igual y el servicio sigue sin intervención humana.`, ok: false, why: `El nodo nuevo tiene el mismo cold start de minutos (provisionar, bajar la imagen, cargar pesos). El autoscaling no reemplaza capacidad caliente.` },
        { html: `Gastaste ≈ un tercio del margen mensual (≈ 43 min) en un evento de rutina: necesitas N+1 y fallback.`, ok: true, why: `15 de ≈ 43 minutos en un parche rutinario: la redundancia N+1 hace que la caída de una réplica no se note.` },
      ],
      explain: `99.9 % son ≈ 43 minutos de caída al mes, y un solo nodo convierte cada parche o reinicio en caída visible. N+1 (una réplica más de las que pide el pico, idealmente en otra zona) más health checks, timeouts y fallback es la respuesta estándar. Dilo con el número: "one GPU covers peak throughput; the second one is N+1 redundancy".`,
    },
    {
      id: 'm01-p05', section: 'de-modelo-a-sistema',
      q: `El entrevistador pregunta por qué dedicas 1–2 minutos al modelo y casi todo el resto a lo demás. ¿Qué justificación es la más sólida y honesta?`,
      options: [
        { html: `Porque Sculley et al. midieron que el código de ML es ≈ 5 % de un sistema de ML en producción, y el resto es configuración, datos, serving y monitoreo.`, ok: false, why: `La figura es ilustrativa: no da un porcentaje medido. Citar un número inventado es justo lo que un entrevistador cuidadoso detecta.` },
        { html: `Porque el trabajo y la complejidad están sobre todo fuera del modelo (lo ilustra la figura de Sculley et al.) y en MLE se asume que sabes entrenar.`, ok: true, why: `Es el mensaje de la figura sin inventar proporciones, más el porqué de la entrevista: el modelo se asume, no se ignora.` },
        { html: `Porque el modelo casi no importa: en producción cualquier backbone preentrenado rinde parecido.`, ok: false, why: `Exagerado: el entendimiento del modelo sí decide cosas (qué optimización no rompe la calidad, qué slices fallan, cuándo basta algo más simple).` },
        { html: `Porque el entrevistador de system design no evalúa el modelo y no podría puntuar esa parte.`, ok: false, why: `Suposición equivocada: el modelo se asume, no se ignora; y si el entrevistador quiere profundidad en el modelo, la va a pedir.` },
      ],
      explain: `El paper de Sculley et al. (NeurIPS 2015) muestra la caja "ML code" pequeña rodeada de configuración, datos, verificación, recursos, serving y monitoreo; el mensaje es dónde está el trabajo, no un porcentaje. Tu ventaja en CV sirve para decisiones puntuales, no para llenar el pizarrón de capas. Frase útil: "ResNet-50 preentrenada y fine-tuned; no es el cuello de botella; si quieres, lo discutimos después".`,
    },

    // ======================================================== ciclo-de-vida
    {
      id: 'm01-p06', section: 'ciclo-de-vida',
      q: `El modelo nuevo pasó el evaluation gate (mejor top-5 que producción en el golden set y en todos los slices). En el canary al 5 %, latencia y errores están bien, pero la distribución de predicciones se corrió fuerte hacia 3 categorías. ¿Qué haces?`,
      options: [
        { html: `Sigues a 25 %: latencia y errores están sanos y el gate pasó; la distribución de predicciones solo importa si baja la aceptación en el A/B.`, ok: false, why: `La distribución de predicciones es uno de los criterios de rollback del canary, junto con latencia y errores; no esperas al A/B para reaccionar.` },
        { html: `Reentrenas con datos más recientes: es concept drift en el tráfico real.`, ok: false, why: `El 95 % del tráfico sigue en el modelo viejo con una distribución normal: lo que cambió es la versión nueva, no el mundo.` },
        { html: `Rollback automático e investigar el artefacto servido (export, FP16, preprocesamiento) contra el que pasó el gate.`, ok: true, why: `El gate evaluó un modelo; el canary sirve un artefacto (export, FP16, preprocesamiento desplegado). Si divergen, aparece una distribución rara sin errores.` },
        { html: `Amplías el golden set: si el gate no lo detectó, el golden set no es representativo.`, ok: false, why: `Puede ser una mejora posterior, pero no es la acción inmediata y probablemente no es la causa: el gate no vio el artefacto que se despliega.` },
      ],
      explain: `Entre evaluar y servir hay dos etapas que fallan en silencio: packaging (engine compilado para otra GPU, FP16 que cambia la salida) y deployment (modelo y preprocesamiento desplegados por separado). Por eso el canary hace rollback automático si empeoran latencia, errores <i>o la distribución de predicciones</i>, y por eso existe el test de paridad. Dilo así: "rollback first, then diff the served artifact against the evaluated one".`,
    },
    {
      id: 'm01-p07', section: 'ciclo-de-vida',
      q: `Para reentrenar el clasificador de categorías propones usar como label la categoría que el vendedor terminó eligiendo, en el 100 % de los anuncios. ¿Cuál es el problema principal?`,
      options: [
        { html: `El volumen: 10 M labels al día no caben en un training job razonable.`, ok: false, why: `El volumen se resuelve muestreando. No es el problema de fondo.` },
        { html: `El retraso: la categoría definitiva llega semanas después y ya no sirve para reentrenar.`, ok: false, why: `La elección del vendedor llega al publicar, casi de inmediato. El problema es el sesgo, no el retraso.` },
        { html: `Ninguno grave: es el label más fiel, porque lo pone quien conoce el producto.`, ok: false, why: `Ignora que el vendedor vio la sugerencia del modelo antes de elegir.` },
        { html: `Es un label sesgado por la propia sugerencia (feedback loop): hace falta una muestra etiquetada por personas con una parte aleatoria.`, ok: true, why: `Es un feedback loop: sin una parte aleatoria etiquetada por personas, no puedes medir ni corregir ese sesgo.` },
      ],
      explain: `En el caso 1, la categoría del vendedor es un label implícito sesgado por la sugerencia. La solución del módulo: muestrear ≈ 1 % de los requests y que personas etiqueten ≈ 5k/mes elegidas a propósito (baja confianza, desacuerdo con el vendedor y una parte aleatoria). En la entrevista: "to avoid a feedback loop, part of the labeling sample is random, not chosen by the model".`,
    },
    {
      id: 'm01-p08', section: 'ciclo-de-vida',
      q: `Hay un incidente y alguien pregunta: "¿Con qué datos y qué código se entrenó el modelo que está en producción?". Nadie lo sabe con certeza. ¿Qué etapa falló y qué artefacto faltaba?`,
      options: [
        { html: `Training: faltaba registrar el checkpoint con su linaje (datos, código, config, métricas) en el registry.`, ok: true, why: `La pregunta clave de training es "¿puedo reproducir exactamente este modelo?", y su falla típica es justo no saber con qué datos se entrenó.` },
        { html: `Monitoring: faltaba un dashboard que muestre qué versión está sirviendo.`, ok: false, why: `Saber la versión no te dice con qué datos ni código se produjo. Eso es linaje, y se registra al entrenar.` },
        { html: `Deployment: faltaba un plan de rollback a la versión anterior.`, ok: false, why: `El rollback depende del registry, pero aquí el problema es que no hay linaje; puedes volver atrás y seguir sin saber qué tienes.` },
        { html: `Data collection: faltaba guardar los datos crudos con schema y particionados por fecha en el data lake, para poder reconstruir cualquier entrenamiento.`, ok: false, why: `Necesario pero insuficiente: puedes tener todos los datos y no saber qué snapshot usó este modelo.` },
      ],
      explain: `Cada etapa del ciclo de vida tiene un artefacto; el de training es el checkpoint con su metadata, y el registry guarda ese linaje (datos, código, métricas) junto al alias que dice qué sirve producción. Sin eso no hay reproducibilidad ni un rollback en el que confíes. Frase: "every model in the registry links to its dataset version, code commit and evaluation report".`,
    },
    {
      id: 'm01-p09', section: 'ciclo-de-vida',
      q: `Tu diagrama tiene cliente → API → model server → respuesta, y abajo, sin conexión, data lake → training → registry. El entrevistador anota "no closed loop". ¿Qué te falta, como mínimo?`,
      options: [
        { html: `Un feature store que cruce los dos carriles, para que training y serving lean las mismas features.`, ok: false, why: `El feature store solo entra si hay features además de la imagen; no es lo que cierra el lazo.` },
        { html: `Las dos flechas entre carriles: logs → datos y registry → deploy.`, ok: true, why: `Es la regla del módulo: cualquier diseño tiene al menos esas dos flechas.` },
        { html: `Un drift job que compare los inputs contra la referencia y dispare el reentrenamiento automáticamente.`, ok: false, why: `Es una buena adición, pero sin logs que lleguen al offline y sin deploy desde el registry el lazo sigue abierto.` },
        { html: `Un evaluation gate entre training y registry que bloquee candidatos peores.`, ok: false, why: `Importante, pero vive dentro del carril offline: no conecta los carriles.` },
      ],
      explain: `El error más común de quien viene de modelado es dibujar solo el camino online. El lazo mínimo es: los logs del online alimentan los datos del offline, y lo que sale del registry se despliega en el online. Dibuja los dos carriles desde la primera caja y di: "I'll split the design into an online path and an offline path".`,
    },
    {
      id: 'm01-p10', section: 'ciclo-de-vida',
      q: `El entrevistador dice: "Cuéntame cómo mejorarías este modelo con el tiempo". ¿Qué respuesta muestra que entiendes el outer loop y no solo el inner loop?`,
      options: [
        { html: `Probaría otros backbones, más augmentations y ajuste de hiperparámetros en validación hasta ganar un par de puntos.`, ok: false, why: `Es inner loop: iterar el modelo en horas con métrica offline. Nada corre solo en producción.` },
        { html: `Reentrenaría automáticamente cada lunes con todos los datos nuevos de la semana y desplegaría el modelo nuevo si la loss de validación baja respecto del anterior.`, ok: false, why: `Solo calendario, y la loss no es un gate: faltan golden set, slices, shadow y canary.` },
        { html: `Mandaría a etiquetar las imágenes de baja confianza (active learning) y las sumaría al dataset.`, ok: false, why: `Es una pieza del lazo (labeling), no el ciclo completo; y solo dirigido, sin parte aleatoria, sesga la medición.` },
        { html: `Un trigger (drift sostenido, caída de la métrica con labels o calendario) lanza un training reproducible; el candidato pasa gate, shadow y canary.`, ok: true, why: `Es el outer loop: datos nuevos → reentrenar → evaluar → desplegar → monitorear, corriendo sin ti y ligado a señales.` },
      ],
      explain: `La entrevista de ML System Design es casi toda outer loop: el ciclo de vida completo corriendo en producción, en días o semanas, con SLOs y métricas online. El reentrenamiento se liga a una señal (drift sostenido, caída de la métrica con labels), no solo al calendario. Di: "the outer loop retrains on a schedule, or earlier when drift persists".`,
    },

    // ======================================================== online-offline
    {
      id: 'm01-p11', section: 'online-offline',
      q: `Te piden revisar las fotos de anuncios <i>ya publicados</i> para detectar contenido prohibido. Producto dice que basta con retirarlos en unos minutos. ¿Qué patrón eliges?`,
      options: [
        { html: `Asíncrono con cola: nadie espera y alcanza con minutos; más barato, y las fallas se reintentan.`, ok: true, why: `Es el ejemplo del módulo para este patrón: revisar fotos después de publicar.` },
        { html: `Online síncrono con p99 ≤ 200 ms, para retirarlos lo antes posible.`, ok: false, why: `Nadie espera la predicción: pagas capacidad reservada para el pico y un presupuesto de ms que el problema no pide.` },
        { html: `Batch offline nocturno sobre todo el inventario.`, ok: false, why: `Con un batch nocturno el contenido queda publicado durante horas; el requisito es minutos.` },
        { html: `Streaming, porque las fotos llegan como un flujo continuo durante todo el día y procesarlas evento por evento minimiza el tiempo hasta retirarlas.`, ok: false, why: `Streaming es para flujos continuos de eventos o frames (video en tiempo real); uploads sueltos con tolerancia de minutos los resuelve una cola.` },
      ],
      explain: `La pregunta que decide el patrón es: ¿alguien espera la predicción antes de continuar? Si no, casi siempre es más barato y más simple hacerlo asíncrono o en batch. Entre esos dos, decide la frescura requerida: minutos → cola; todo el inventario cada cierto tiempo → batch. Dilo con la alternativa: "if this had to block publishing, I'd make it synchronous".`,
    },
    {
      id: 'm01-p12', section: 'online-offline',
      q: `Inspección visual en una planta donde la red se cae varias veces por semana y la línea necesita una decisión en pocos ms. ¿Qué patrón eliges y qué consecuencia operativa tienes que mencionar?`,
      options: [
        { html: `Online síncrono en la nube, con reintentos agresivos para cubrir los cortes de red.`, ok: false, why: `Los reintentos no sirven si no hay red, y un round trip a la nube no cabe en pocos ms.` },
        { html: `Asíncrono con una cola local que sube las imágenes a la nube cuando vuelve la red.`, ok: false, why: `La línea necesita la decisión ahora. La cola local sirve para subir logs, no para decidir.` },
        { html: `Edge / on-device, y explicar cómo versionas y actualizas el modelo y cómo recuperas logs del dispositivo.`, ok: true, why: `Edge es el patrón para sin red confiable y latencia de pocos ms; lo senior es nombrar el costo operativo de mover lógica al dispositivo.` },
        { html: `Edge / on-device; como ya no depende de la red ni de un servidor, el modelo queda fijo en el dispositivo y el monitoreo y el versionado dejan de ser un problema.`, ok: false, why: `El patrón es correcto, la conclusión no: en el edge el versionado y la observabilidad son más difíciles, no innecesarios.` },
      ],
      explain: `Edge / on-device se elige por red poco confiable, privacidad o latencia de pocos ms. Pero mover lógica al dispositivo trae consecuencias operativas: versiones viejas conviviendo, actualizar requiere un release o config remota, y pierdes logs si no los subes. Nombrarlas es lo que separa "lo pongo en un Jetson" de un diseño operable.`,
    },
    {
      id: 'm01-p13', section: 'online-offline',
      q: `En el último deploy, backend reescribió el preprocesamiento de serving con OpenCV; el modelo es el mismo. Desde entonces el servicio responde 200, el p99 es perfecto y los scores salen altos y confiados, pero la tasa de aceptación cayó. ¿Qué revisas primero?`,
      options: [
        { html: `Drift de datos: comparar la distribución de inputs de esta semana contra el set de training, porque predicciones confiadas pero peores es el síntoma típico del drift.`, ok: false, why: `La caída coincide con la reescritura del preprocesamiento; el drift suele ser gradual. Es la segunda hipótesis, no la primera.` },
        { html: `Paridad de preprocesamiento: canales (cv2 da BGR), resize, EXIF y normalización, comparando tensores y logits de ambos caminos.`, ok: true, why: `Es el patrón clásico de training-serving skew: respuesta 200, latencia perfecta, predicciones confiadas y peores.` },
        { html: `Capacidad del model server: si la cola crece, los timeouts disparan el fallback y baja la aceptación.`, ok: false, why: `Con p99 perfecto y sin errores, el fallback no se está disparando.` },
        { html: `Calibración: scores altos y peor calidad indican sobreconfianza; aplicaría temperature scaling.`, ok: false, why: `Trata el síntoma. El modelo recibe inputs distintos de los de training; calibrar no arregla eso.` },
      ],
      explain: `El training-serving skew es el bug que no lanza excepciones: RGB vs BGR, otro resize, EXIF o normalización distinta, y el modelo se equivoca con confianza. Se previene con un paquete de preprocesamiento compartido, un test de paridad en CI con imágenes golden y logueando lo que sirves. Menciona el test de paridad sin que te lo pidan.`,
    },
    {
      id: 'm01-p14', section: 'online-offline',
      q: `En tu test de paridad, la misma foto de celular llega derecha a un pipeline y de lado al otro. Training usa <code>PIL.Image.open</code> y serving usa <code>cv2.imread</code>. ¿Cuál es la explicación?`,
      options: [
        { html: `PIL aplica la rotación EXIF al abrir y OpenCV no; hay que rotar a mano en serving.`, ok: false, why: `Es al revés.` },
        { html: `Ninguno de los dos aplica EXIF; la diferencia viene del orden de canales BGR de OpenCV.`, ok: false, why: `El orden de canales cambia los colores, no la orientación.` },
        { html: `Es un efecto del resize: <code>cv2.resize</code> directo a 224×224, sin resize + crop, deforma el aspect ratio de las fotos verticales y parecen giradas.`, ok: false, why: `Deformar el aspect ratio estira la imagen, no la gira 90°.` },
        { html: `<code>cv2.imread</code> aplica la rotación EXIF por defecto y <code>PIL.Image.open</code> no: training ve la foto sin rotar.`, ok: true, why: `Es la fuente de skew de orientación que describe el módulo; con PIL hace falta <code>ImageOps.exif_transpose</code> para igualarla.` },
      ],
      explain: `La orientación EXIF es una de las fuentes de skew más silenciosas en CV, junto con RGB vs BGR, resize y normalización. OpenCV aplica la rotación EXIF por defecto y PIL no. Por eso el preprocesamiento vive en un solo paquete compartido por training y serving, y el test de paridad compara tensores sobre fotos reales de celular.`,
    },
    {
      id: 'm01-p15', section: 'online-offline',
      q: `El entrevistador pregunta: "¿Por qué no usas instancias spot también para el model server online, si son mucho más baratas?". ¿Mejor respuesta?`,
      options: [
        { html: `Porque en el online una interrupción la ve el usuario al instante; spot encaja en jobs offline que se reintentan.`, ok: true, why: `Usa la diferencia de impacto de una falla entre los dos caminos, que es lo que decide dónde va spot.` },
        { html: `Sí conviene: con N+1, si se interrumpe una instancia spot la otra absorbe el tráfico mientras llega el reemplazo, así que el riesgo es el mismo que con on-demand.`, ok: false, why: `N+1 cubre la caída de una réplica como evento raro; con spot las interrupciones son frecuentes, no las eliges tú y pueden llegar a varias instancias a la vez.` },
        { html: `Porque en el online el costo dominante es el almacenamiento de logs, no el cómputo, así que spot ahorra poco.`, ok: false, why: `El costo dominante online es la capacidad reservada para el pico, aunque sea de madrugada.` },
        { html: `Da igual: si se interrumpe una instancia, el autoscaler la reemplaza en segundos.`, ok: false, why: `Un nodo GPU nuevo tarda minutos (cold start): provisionar, bajar la imagen, cargar pesos.` },
      ],
      explain: `Online y offline tienen reglas distintas: el online está siempre encendido y una falla la ve el usuario (necesitas timeouts y fallback); el offline corre jobs efímeros que se reintentan, por eso ahí encajan spot/preemptible. Decidir qué pieza vive en cada camino es la primera decisión de arquitectura. Dilo así: "spot for training jobs that can retry; on-demand for the always-on serving path".`,
    },

    // ======================================================== roles
    {
      id: 'm01-p16', section: 'roles',
      q: `Estás diseñando el serving y el entrevistador pregunta: "¿Y quién mantiene el cluster de GPUs y el CI/CD compartido?". La empresa del enunciado tiene un equipo de ML Platform. ¿Cómo lo manejas?`,
      options: [
        { html: `Lo delegas con requisitos: "lo opera el equipo de plataforma; yo le daría QPS, latencia, GPUs y frescura".`, ok: true, why: `Es lo que espera ese rol de ti: que uses bien la plataforma y le des requisitos claros.` },
        { html: `Lo diseñas a fondo (tipos de nodo, scheduler, etcd, pipelines de CI) para mostrar que también dominas la infraestructura que soporta tu servicio.`, ok: false, why: `Los internals de Kubernetes son lo que el módulo dice que no prepares: te preguntan qué pides, no cómo lo implementa el control plane.` },
        { html: `Dices que no es responsabilidad del MLE y pasas al siguiente tema.`, ok: false, why: `Delegar sin dar requisitos suena a evasión; la señal está en saber qué le pides a la plataforma.` },
        { html: `Propones que tu equipo construya su propio cluster para no depender de otro equipo.`, ok: false, why: `Diseñar una plataforma desde cero cuando ya existe es over-engineering; la pregunta "¿hay infraestructura que deba reutilizar?" existe por esto.` },
      ],
      explain: `El MLE posee los modelos en producción (training, serving, evaluación, monitoreo); la plataforma compartida suele ser de MLOps/ML Platform. Delegar en voz alta con requisitos concretos (QPS, latencia, GPU, frescura) muestra que entiendes la frontera. Si el entrevistador insiste en ese tema, entonces sí vas ahí: te está eligiendo el deep dive.`,
    },
    {
      id: 'm01-p17', section: 'roles',
      q: `Un Data Scientist te entrega un notebook con un prototipo que mejora la conversión en un análisis offline. ¿Qué espera típicamente ese rol de ti como MLE?`,
      options: [
        { html: `Que valides estadísticamente su análisis y rediseñes las métricas de producto.`, ok: false, why: `Eso es el centro de gravedad del Data Scientist, no lo que espera del MLE.` },
        { html: `Que reescribas el modelo con una arquitectura más moderna antes de llevarlo a producción.`, ok: false, why: `Nada indica que el modelo sea el problema; y explorar arquitecturas nuevas se parece más a research.` },
        { html: `Que conviertas el prototipo en un servicio confiable y le des logs limpios para medir.`, ok: true, why: `Es exactamente la expectativa que la tabla de roles asigna al Data Scientist respecto del MLE.` },
        { html: `Que construyas el warehouse y los contratos de datos que alimentan su notebook.`, ok: false, why: `Eso suele ser del Data Engineer; tú defines qué datos necesitas y respetas los contratos.` },
      ],
      explain: `Calibrar el rol te dice qué esperan de ti y qué puedes delegar. Con un Data Scientist, tu aporte es el puente al sistema: servicio confiable, contrato de API, logs de predicción limpios para que pueda medir experimentos. En la entrevista suena a: "I'd productionize the prototype behind a versioned API and log every prediction so we can measure it".`,
    },
    {
      id: 'm01-p18', section: 'roles',
      q: `Hablando de p99, el entrevistador nota tu background de mecatrónica y te pregunta si te sirve. ¿Qué analogía es correcta y útil?`,
      options: [
        { html: `Un filtro pasa bajos: suaviza los picos, así que dimensiono con el promedio filtrado.`, ok: false, why: `Lleva a diseñar para el promedio, que es el error más caro; el p99 existe justamente porque el promedio esconde la cola.` },
        { html: `Un lazo de control a 1 kHz: presupuesto de 1 ms, importa el peor caso y no el promedio, y qué pasa si un sensor falla. Eso es p99 y degradación con gracia.`, ok: true, why: `Es la analogía que propone el módulo: presupuesto por etapa, peor caso y comportamiento ante fallas.` },
        { html: `Un PID bien sintonizado es como un buen autoscaler: si está bien ajustado, no hace falta sobredimensionar.`, ok: false, why: `El autoscaler tiene cold start de minutos; por eso planificas con utilización objetivo y N+1, no con capacidad justa.` },
        { html: `Nyquist: si muestreas al doble de la frecuencia, cubres la señal; igual, diseñar al doble del promedio cubre el pico.`, ok: false, why: `El pico es ≈ 2–5× el promedio y depende del tráfico, no de un teorema; el factor se pregunta o se asume en voz alta.` },
      ],
      explain: `Tu experiencia con tiempo real sí cuenta: un lazo de control tiene presupuesto por etapa, se diseña para el peor caso y define qué pasa si un sensor falla. Eso es pensar en p99, timeouts y fallback. Un matiz que suma: el lazo es tiempo real duro (peor caso absoluto) y el p99 es un percentil, así que el 1 % restante existe y por eso hacen falta timeouts y fallback. Úsalo como analogía corta, no como historia larga, y vuelve al diseño.`,
    },

    // ======================================================== que-evalua
    {
      id: 'm01-p19', section: 'que-evalua',
      q: `Enunciado: "Diseña la plataforma que usan 30 equipos para servir sus modelos". Te preguntan por aislamiento entre equipos y throughput. ¿Qué sabor es y cómo repartes el tiempo?`,
      options: [
        { html: `ML infra/platform; como el modelo y los labels de cada equipo quedan fuera de alcance, dedico 0 minutos a métricas y todo el tiempo a componentes, escala y fallas.`, ok: false, why: `Cero minutos es el error que señala el módulo: sin saber para qué se usa y cómo se mide el éxito, la infraestructura no tiene requisitos.` },
        { html: `Applied: hay requisitos de latencia y throughput, así que reparto balanceado entre datos y serving.`, ok: false, why: `Applied tiene un input concreto (imágenes, video) y un problema de negocio; aquí el cliente es otro equipo de ML.` },
        { html: `Product ML: hay usuarios (los 30 equipos), así que más tiempo en features, métricas y A/B.`, ok: false, why: `No hay un objetivo de negocio de usuario final; el "cliente" interno es la marca del sabor infra.` },
        { html: `ML infra/platform: casi todo a componentes, contratos, escala y fallas, pero ≈ 5 minutos para métricas, labels y baseline.`, ok: true, why: `Reconoce el sabor (cliente interno, preguntas de throughput y aislamiento) y respeta los ≈ 5 minutos, ni 0 ni 25.` },
      ],
      explain: `Los tres sabores se reconocen en 2 minutos: product ML habla de usuarios y un objetivo de negocio; infra/platform tiene como cliente a otro equipo y pregunta por throughput, aislamiento y fallas; applied tiene un input concreto con restricciones duras. Si no está claro, pregúntalo: "Should I focus more on the modeling side or on the serving infrastructure?".`,
    },
    {
      id: 'm01-p20', section: 'que-evalua',
      q: `Dices: "usaría autoscaling para manejar la carga". ¿Por qué esa frase casi no suma en la rúbrica y cuál la reemplaza?`,
      options: [
        { html: `No deja nada que anotar; mejor: "escalo por largo de cola del model server, de 2 a 4 réplicas, porque la CPU no refleja la carga de la GPU".`, ok: true, why: `Una frase citable con métrica, rango y porqué se copia casi textual a la nota del entrevistador.` },
        { html: `Porque el autoscaling no aplica a ML; mejor: "réplicas fijas dimensionadas para el pico".`, ok: false, why: `El autoscaling sí aplica; el problema de la frase es que es vaga, no que sea incorrecta.` },
        { html: `Porque le falta la herramienta; mejor: "usaría el HPA de Kubernetes con KEDA".`, ok: false, why: `Agrega nombres sin porqué: name-dropping. Sigue sin decir por qué señal escalas ni por qué.` },
        { html: `Porque es correcta pero llega tarde: debió decirse en la aclaración, no en la arquitectura.`, ok: false, why: `El momento no es el problema; el problema es que no tiene número ni criterio.` },
      ],
      explain: `El entrevistador escribe notas mientras hablas y las traduce a un nivel por dimensión. "Usaría autoscaling" no deja nada que anotar; una frase con métrica, rango y porqué se copia casi textual. Habla en frases que se puedan citar: número, decisión y alternativa descartada.`,
    },
    {
      id: 'm01-p21', section: 'que-evalua',
      q: `Tu diseño técnico ya es sólido: online/offline separados, números con pico, canary con rollback. Según la tabla de niveles, ¿qué agregarías para que se lea como Staff y no solo como Senior?`,
      options: [
        { html: `Sumar al diagrama un feature store compartido, un service mesh y despliegue multi-región: más cajas muestran más alcance y visión a 1–2 años.`, ok: false, why: `La columna Staff habla de plataforma y evolución como razonamiento (qué compartir, cuándo y a qué costo), no de sumar cajas que ningún número exige: eso es over-engineering, no nivel.` },
        { html: `Más profundidad en el modelo: tres backbones comparados con ablations.`, ok: false, why: `Más tiempo en la caja chica; no es lo que distingue los niveles en esta entrevista.` },
        { html: `Decir qué número es incierto y cómo lo medirías, sumar reversibilidad y costo de oportunidad, y decir dónde no vale profundizar.`, ok: true, why: `Son exactamente las diferencias Senior → Staff de la tabla: números, trade-offs y profundidad.` },
        { html: `Más precisión en las estimaciones: costo con decimales y QPS exacto en vez de redondeado.`, ok: false, why: `Precisión falsa: los decimales no dan puntos, dan la impresión de que no sabes qué importa.` },
      ],
      explain: `Senior conduce, pone números sin que se los pidan y elige con criterio. Staff además dice cuál número es incierto y cómo lo mediría, suma reversibilidad, costo de oportunidad y riesgo para el equipo, y sabe dónde no vale la pena profundizar. El mismo diseño se lee como mid o como senior según cómo lo conduces y justificas.`,
    },
    {
      id: 'm01-p22', section: 'que-evalua',
      q: `Una persona con mucha experiencia en system design clásico hace su primera entrevista de ML System Design. ¿Qué es lo que más probablemente va a subestimar?`,
      options: [
        { html: `Load balancers, colas y réplicas: en ML pasan a segundo plano porque el cuello de botella real es la GPU y todo el diseño gira alrededor del model server.`, ok: false, why: `Siguen aplicando; el módulo advierte no olvidarlos por pensar en el modelo.` },
        { html: `Que el sistema puede responder 200 y estar equivocado: drift, skew, labels y evaluación continua.`, ok: true, why: `Es la diferencia central: en ML mucho puede estar mal sin ningún error.` },
        { html: `La consistencia fuerte de la base de datos, que en ML es todavía más crítica.`, ok: false, why: `Consistencia y particionado son el centro del system design clásico; es lo que esa persona ya domina.` },
        { html: `Que en ML System Design se espera escribir el código del pipeline durante la entrevista.`, ok: false, why: `Casi nunca se escribe código; a veces la firma de una API o un pseudo-schema.` },
      ],
      explain: `En system design clásico un bug suele dar un error; en ML el sistema responde 200 y se equivoca. Por eso el centro se mueve a datos, labels, métricas y el ciclo de reentrenamiento, sin dejar de lado lo clásico (load balancers, colas, réplicas, SLOs). Para ti, como persona de CV, el riesgo es el inverso: olvidar lo clásico por pensar en el modelo.`,
    },

    // ======================================================== framework
    {
      id: 'm01-p23', section: 'framework',
      q: `Llevas 21 minutos y todavía estás en estimaciones, sin ningún diagrama. ¿Qué haces?`,
      options: [
        { html: `Saltas el detalle de costo y dibujas el diseño mínimo con los dos carriles en ≈ 3 minutos.`, ok: true, why: `Es la regla del minuto 20: sin diagrama, el resto de la entrevista no tiene sobre qué construir.` },
        { html: `Terminas bien las estimaciones, incluido el costo mensual: sin números sólidos el diseño no tiene base, y el diagrama se dibuja más rápido después.`, ok: false, why: `Las estimaciones debían cerrar en el minuto 15; ya tienes los números que deciden, el costo detallado puede esperar.` },
        { html: `Saltas directo al deep dive del serving para recuperar tiempo.`, ok: false, why: `No hay diagrama sobre el cual profundizar, y el entrevistador no vio todavía la separación online/offline.` },
        { html: `Pides al entrevistador elegir un solo deep dive y lo limitas a 7 minutos.`, ok: false, why: `Es la regla del minuto 30, cuando ya tienes la arquitectura de alto nivel. Buena idea, momento equivocado.` },
      ],
      explain: `Las ventanas son una guía, pero si vas tarde hay un movimiento para cada momento: en 12 fijas supuestos de una vez; en 20 dibujas el diseño mínimo; en 30 limitas el deep dive a uno; en 40 cortas y cubres 6–7 en viñetas. Dilo en voz alta: "I'm conscious of time — let me sketch the high-level design".`,
    },
    {
      id: 'm01-p24', section: 'framework',
      q: `Minuto 18. Con 500 req/s de diseño tenías 2 GPUs. El entrevistador interrumpe: "¿Y si el tráfico fuera 10×?". ¿Mejor reacción?`,
      options: [
        { html: `La estacionas: "buena pregunta, la anoto en riesgos y la retomo en el cierre".`, ok: false, why: `Estacionar solo vale para algo que corresponde a un paso posterior y que el entrevistador no quiere ahora; una prueba de escala la quiere ahora.` },
        { html: `"El autoscaling lo absorbe", y sigues con la arquitectura.`, ok: false, why: `Ningún número: es la nota que te hunde en estimaciones.` },
        { html: `Rediseñas con Kafka delante del model server y un cluster distribuido, porque a 10× el sistema cambia de categoría y conviene desacoplar la ingesta.`, ok: false, why: `Rediseñar sin rehacer la cuenta es adivinar; el número dice qué cambia (cuántas GPUs, si vale INT8), no la topología completa.` },
        { html: `Rehaces la cuenta en voz alta: ≈ 5,000 req/s son ≈ 10 GPUs, y ahora sí paga INT8 o una GPU más grande.`, ok: true, why: `Es la respuesta del módulo: rehacer la cuenta y decir qué decisión cambia.` },
      ],
      explain: `"¿Y si fuera 10×?" significa que están probando escala. La respuesta es reusar tu fórmula en voz alta (ceil(5,000 / 600) + 1 = 10) y decir qué decisión cambia: a esa escala la optimización (INT8, GPU más grande) ya paga. Respondes y vuelves a donde estabas.`,
    },
    {
      id: 'm01-p25', section: 'framework',
      q: `Terminaste la arquitectura y el entrevistador dice "tú eliges dónde profundizar". Tus números: pico de 500 req/s, una GPU basta por throughput. No hay labels de la tarea, y etiquetar cuesta dinero y días. ¿Qué eliges?`,
      options: [
        { html: `Serving con batching y timeouts, porque es el deep dive más común en casos con imágenes y donde el entrevistador espera ver números de latencia.`, ok: false, why: `Es frecuente, pero tus números dicen que la GPU está holgada; profundizar ahí no ataca el riesgo de este enunciado.` },
        { html: `Pipeline de datos y labeling: es el mayor riesgo, y el serving está holgado según tus números; lo dices así.`, ok: true, why: `"Tú eliges" pide elegir el mayor riesgo y justificarlo con tus números.` },
        { html: `El backbone y las augmentations, porque es donde tienes más profundidad para mostrar.`, ok: false, why: `Es el error típico del paso 5: profundizar en tu zona cómoda en vez de en el riesgo.` },
        { html: `Le devuelves la pregunta: "¿dónde te gustaría que profundice?".`, ok: false, why: `Ya te dijo que elijas; devolverla sin propuesta muestra que no conduces.` },
      ],
      explain: `Para elegir el deep dive, ofreces 2–3 opciones que salen de tus números y del sabor; si te dicen "tú eliges", vas al cuello de botella de más riesgo y dices por qué. Labels escasos, caros o ruidosos → pipeline de datos y labeling; GPU o latencia apretadas → serving. Cada decisión con su alternativa descartada.`,
    },
    {
      id: 'm01-p26', section: 'framework',
      q: `Alguien propone reducir la aclaración a 1 minuto y dar 10 a estimaciones "porque los números impresionan". ¿Qué argumento lo refuta mejor?`,
      options: [
        { html: `Los números no puntúan en la rúbrica, así que 10 minutos de cuentas son tiempo perdido.`, ok: false, why: `Estimaciones es una de las 6 dimensiones de la rúbrica; el problema no es hacerlas, es alargarlas.` },
        { html: `La aclaración debería durar más, no menos: 15 minutos permiten cubrir las 12 preguntas del banco y llegar a la arquitectura sin ningún supuesto dudoso.`, ok: false, why: `El banco es para elegir 5–7; 15 preguntas sin supuestos es una trampa del módulo.` },
        { html: `Las estimaciones valen por las decisiones que habilitan, y un supuesto mal puesto en la aclaración cuesta ≈ 10 minutos de diseño equivocado.`, ok: true, why: `Es la justificación del módulo para las ventanas de 5 y 5, y deja los 12 minutos al deep dive.` },
        { html: `El orden no importa mientras al final se cubran las 6 dimensiones.`, ok: false, why: `El orden importa: los supuestos alimentan los números y los números deciden la arquitectura.` },
      ],
      explain: `El framework reparte 5 minutos a aclarar, 5 a requisitos, 5 a estimaciones, 10 a arquitectura, 12 al deep dive, 5 a operar y 3 al cierre. Las estimaciones valen por las decisiones que habilitan, y el deep dive es donde se distingue a un senior de un mid. "Ocho minutos de aritmética con decimales" es el error típico del paso 3.`,
    },
    {
      id: 'm01-p27', section: 'framework',
      q: `En el paso 6 dices: "haría un A/B test y monitorearía el drift". El entrevistador no anota nada. ¿Qué versión convierte eso en señal?`,
      options: [
        { html: `A/B con 50 % del tráfico desde el día uno para llegar rápido a significancia, y accuracy en tiempo real.`, ok: false, why: `Sin shadow ni canary expones a la mitad de los usuarios; y la accuracy necesita labels, que llegan con retraso.` },
        { html: `Dashboards de CPU, memoria y latencia del servicio en Grafana, con alertas cuando algo se ponga rojo.`, ok: false, why: `Solo métricas de sistema: los dashboards pueden estar verdes mientras la calidad cae en silencio.` },
        { html: `Reentrenar cada semana para que el drift no se acumule; así el A/B deja de ser necesario.`, ok: false, why: `Reentrenar por calendario no valida que el modelo nuevo sea mejor ni cómo lanzarlo sin riesgo.` },
        { html: `Gate con slices → shadow → canary 5 % con rollback → A/B con métrica primaria, guardrails y unidad de aleatorización; alerta "p99 &gt; 200 ms por 10 min"; drift de scores.`, ok: true, why: `Concreta las dos frases vagas: qué se mide, contra qué, con qué umbral y qué pasa si falla.` },
      ],
      explain: `El error típico del paso 6 es "haría un A/B" sin métrica, guardrails ni unidad de aleatorización, y "monitorearía el drift" sin decir qué distribución ni contra qué referencia. La versión con señal tiene una alerta con métrica, umbral y ventana, y un rollback que es cambiar ruteo, no reentrenar. Dilo así: "I'd ship it in shadow mode first, then a 5% canary with automatic rollback".`,
    },

    // ======================================================== preguntas-aclaracion
    {
      id: 'm01-p28', section: 'preguntas-aclaracion',
      q: `Ya sabes el volumen (10 M/día) y que hay labels. Te queda tiempo para UNA pregunta más. ¿Cuál fija la decisión de arquitectura más cara de revertir?`,
      options: [
        { html: `¿Tiene que ser en tiempo real o puede tardar minutos?`, ok: true, why: `Decide online vs cola asíncrona vs batch: cambia el cómputo, el manejo de fallas y el costo de todo el sistema.` },
        { html: `¿Cuántas clases hay y cuánto crecen? (clasificación cerrada vs retrieval)`, ok: false, why: `Cambia la formulación del modelo (clasificación vs retrieval, quizá con un índice de embeddings) y la cadencia de reentrenamiento, pero eso se reformula detrás del mismo patrón de serving; pasar de síncrono a cola o batch cambia todo el sistema.` },
        { html: `¿Hay infraestructura que deba reutilizar?`, ok: false, why: `Cambia herramientas y evita construir de cero, pero el patrón de inferencia lo decide otra respuesta.` },
        { html: `¿Cómo va a medir el negocio que esto funciona?`, ok: false, why: `Fija qué optimizas y la métrica del A/B, y se puede asumir y ajustar; no decide la topología.` },
      ],
      explain: `Una pregunta es buena si su respuesta cambia una caja o un número. De todas, "¿tiempo real o puede tardar minutos?" decide entre servicio online, cola o batch, que el módulo llama la decisión de arquitectura más cara de revertir. Las otras importan, pero mueven piezas dentro de ese esqueleto.`,
    },
    {
      id: 'm01-p29', section: 'preguntas-aclaracion',
      q: `Preguntas por el presupuesto de latencia y el entrevistador responde: "lo que tú consideres razonable". ¿Qué haces?`,
      options: [
        { html: `Insistes amablemente en que te dé un número: sin él, cualquier diseño es una apuesta.`, ok: false, why: `Quedarte bloqueado esperando el número "correcto" es peor que elegir uno defendible.` },
        { html: `Eliges un default defendible y lo dices ("asumo p99 ≤ 200 ms y 99.9 %; si pudiera tardar minutos, usaría una cola") y sigues.`, ok: true, why: `"Tú decide" prueba si sabes elegir defaults; lo eliges, lo justificas en una línea y dices qué cambiaría.` },
        { html: `Asumes lo más exigente posible (p99 de 10 ms) para que el diseño cubra cualquier caso.`, ok: false, why: `No es un default defendible: dispara costo y complejidad sin que nada lo pida.` },
        { html: `Lo dejas abierto y lo decides al final, según cómo quede la arquitectura.`, ok: false, why: `La latencia es un insumo de la arquitectura, no un resultado; un supuesto sin fijar no se puede usar después.` },
      ],
      explain: `Cuando te dicen "tú decide" no es evasión: están probando si eliges defaults razonables. El default del módulo para una persona esperando en una UI es p99 ≤ 200 ms server-side y 99.9 %. Frase: "I'll assume X. If that's wrong, the main thing that changes is Y".`,
    },
    {
      id: 'm01-p30', section: 'preguntas-aclaracion',
      q: `Minuto 7. Llevas 11 preguntas respondidas y ningún supuesto escrito. ¿Cuál es el problema principal y qué haces?`,
      options: [
        { html: `Te faltan preguntas: el banco tiene 12 y conviene completarlo antes de avanzar.`, ok: false, why: `El banco es para elegir 5–7 según el enunciado, no para recorrerlo entero.` },
        { html: `Ninguno: 7 minutos de aclaración es razonable si las preguntas fueron buenas, y es mejor asumir poco que fijar supuestos que después resulten falsos.`, ok: false, why: `La ventana es 0–5 y no hay supuestos fijados: el tiempo se fue sin producir nada utilizable.` },
        { html: `No priorizaste: lo que da señal son los supuestos. Cierras con "voy a asumir X, Y, Z" y pasas a requisitos.`, ok: true, why: `Es la trampa "15 preguntas sin fijar supuestos"; el entrevistador anota "no supo priorizar".` },
        { html: `Debiste empezar por estimaciones para saber qué preguntar después.`, ok: false, why: `Las estimaciones dependen de los supuestos (volumen, pico, latencia); van después, no antes.` },
      ],
      explain: `La señal de la aclaración no es cuántas preguntas haces sino que las respuestas se conviertan en supuestos escritos que usas después. 5–7 preguntas que cambian la arquitectura y un cierre explícito: "voy a asumir X, Y, Z; corrígeme si alguno está mal". Ese cierre también te da un chequeo natural con el entrevistador.`,
    },
    {
      id: 'm01-p31', section: 'preguntas-aclaracion',
      q: `¿Cuál de estas frases de cierre de la aclaración da más señal senior?`,
      options: [
        { html: `"Voy a asumir que es síncrono con p99 ≤ 200 ms, 10 M/día con pico 3× y que hay labels iniciales."`, ok: false, why: `Buenos supuestos, pero no dice qué cambiaría si alguno fuera falso: no muestra qué decisión depende de cuál.` },
        { html: `"Voy a asumir lo más común en la industria para este tipo de sistema y lo ajusto si hace falta."`, ok: false, why: `No fija nada concreto; no hay nada que el entrevistador pueda validar o corregir.` },
        { html: `"Como todavía no tengo todos los datos, voy a diseñar algo flexible que funcione tanto síncrono como asíncrono, y decidimos cuando sepamos más."`, ok: false, why: `Evita decidir y paga los costos de ambos patrones.` },
        { html: `"Asumo que el vendedor espera en pantalla: síncrono, p99 ≤ 200 ms. Si pudiera esperar un minuto, usaría una cola, que es más barata."`, ok: true, why: `Supuesto + consecuencia + qué cambiaría: demuestra que sabes qué decisión depende de qué supuesto.` },
      ],
      explain: `El patrón senior es "voy a asumir X; si no fuera así, cambiaría Y". Una sola frase con el supuesto, la decisión que implica y la alternativa demuestra criterio y le da al entrevistador algo concreto que corregir. En inglés: "I'll assume the seller is waiting for the suggestion, so this is a synchronous call with a p99 under 200 ms".`,
    },
    {
      id: 'm01-p32', section: 'preguntas-aclaracion',
      q: `Enunciado de moderación. Preguntas "¿hay labels?" y te responden: "sí, los moderadores revisan lo que reportan los usuarios". ¿Qué repregunta o supuesto vuelve útil esa respuesta?`,
      options: [
        { html: `Cuántos moderadores hay, para dimensionar las GPUs del serving.`, ok: false, why: `La cantidad de moderadores no determina el hardware de inferencia; determina la capacidad de etiquetado.` },
        { html: `Con cuánto retraso llegan y qué sesgo traen (solo ves lo reportado): necesitas una muestra aleatoria y proxies.`, ok: true, why: `Pregunta por retraso y sesgo, que cambian la evaluación, el monitoreo y la cadencia de reentrenamiento.` },
        { html: `Qué herramienta de labeling usan, para integrarla al pipeline.`, ok: false, why: `La marca es secundaria; no cambia ninguna decisión de diseño importante.` },
        { html: `Ninguna: si los moderadores ya etiquetan lo reportado, el pipeline de labeling está resuelto y puedes pasar directo a requisitos y métricas.`, ok: false, why: `Es la actitud junior de "asume que hay labels"; el senior diseña cómo se consiguen, cuánto cuestan, cuánto tardan y qué sesgo traen.` },
      ],
      explain: `"¿Hay labels?" solo es útil con la repregunta: de dónde salen y con cuánto retraso. Labels que vienen solo de reportes están sesgados (no ves lo no reportado) y llegan con días de retraso; eso obliga a una muestra aleatoria etiquetada y a métricas proxy mientras tanto. Dilo así: "moderator labels are delayed by days, so we watch proxies in the meantime".`,
    },

    // ======================================================== estimaciones-express
    {
      id: 'm01-p33', section: 'estimaciones-express',
      q: `Tu promedio es ≈ 116 req/s y el pico ≈ 350. Alguien propone: "dimensiona para 116; el autoscaler se encarga del resto". ¿Mejor refutación?`,
      options: [
        { html: `Hay que dimensionar para el pico porque redondear el día a 10<sup>5</sup> s ya subestima el QPS ≈ 14 %, y sumado al autoscaling ese error se vuelve inaceptable.`, ok: false, why: `Ese 14 % es real, pero es ruido frente a un pico de 3×; no es el argumento.` },
        { html: `Dimensionar para el pico solo importa si el SLO es de 99.99 % o más.`, ok: false, why: `Con cualquier SLO de latencia, el pico sin capacidad dispara colas, p99 y timeouts.` },
        { html: `Diseñar para el promedio es el error más caro: un nodo GPU nuevo tarda minutos, así que el autoscaler no absorbe spikes cortos.`, ok: true, why: `Usa el pico de diseño y el cold start, que son las dos razones del módulo.` },
        { html: `El autoscaler sí alcanza, pero dimensionar para el pico sale más barato a largo plazo.`, ok: false, why: `Dimensionar para el pico cuesta más, no menos; lo pagas porque protege el SLO.` },
      ],
      explain: `El pico (≈ 2–5× el promedio; ×3 en el caso 1) más un margen para spikes da el pico de diseño de 500 req/s. El autoscaling ayuda con cambios lentos, pero un cold start de GPU tarda minutos, por eso dejas capacidad caliente. Di el número con la decisión: "≈ 500 req/s at peak, so one T4 covers throughput and I run two for N+1".`,
    },
    {
      id: 'm01-p34', section: 'estimaciones-express',
      q: `Mediste ≈ 1,200 img/s por GPU con perf_analyzer, cumpliendo el SLO. ¿Por qué planificas con 600 y no con 1,200?`,
      options: [
        { html: `Porque la otra mitad es la réplica N+1.`, ok: false, why: `La redundancia es un término aparte (+1 GPU). Mezclarla con la utilización la cuenta dos veces.` },
        { html: `Porque cerca de saturación las colas crecen de forma no lineal y el p99 se dispara; además hay que absorber spikes.`, ok: true, why: `Es la definición del módulo de utilización objetivo y su porqué.` },
        { html: `Porque perf_analyzer mide el máximo absoluto en condiciones ideales, y en producción, con tráfico real e irregular, siempre se obtiene alrededor de la mitad.`, ok: false, why: `La capacidad que usas ya debe ser el máximo que cumple el SLO; "siempre la mitad" es una regla inventada.` },
        { html: `Porque FP16 en producción rinde la mitad que en el benchmark.`, ok: false, why: `No hay tal regla; el benchmark se hace con el mismo artefacto (engine FP16) que vas a servir.` },
      ],
      explain: `La fórmula es <code>ceil(pico / (capacidad medida × utilización objetivo)) + redundancia</code>, y cada término responde a una pregunta distinta: capacidad (lo que da una GPU cumpliendo el SLO), utilización (margen para colas y spikes) y redundancia (que la caída de una no se note). Con 500 / 600 sale 1 GPU por throughput, y 2 con N+1.`,
    },
    {
      id: 'm01-p35', section: 'estimaciones-express',
      q: `Con 500 req/s y 50 ms de latencia media tienes ≈ 25 requests en vuelo. En un pico, la latencia media sube a 200 ms con el mismo throughput. ¿Qué implica para el diseño?`,
      options: [
        { html: `Nada: el throughput sigue en 500 req/s, y eso es lo que dimensiona las GPUs.`, ok: false, why: `Ignora la concurrencia: los workers, las conexiones y la cola no se dimensionan por throughput solo.` },
        { html: `Que para dimensionar workers y conexiones debes usar el p99 en Little's law y no la media, porque el p99 es lo que protege el SLO del servicio.`, ok: false, why: `Little's law usa la latencia media; el p99 describe la cola de la distribución, no la concurrencia promedio.` },
        { html: `La concurrencia baja a ≈ 6, porque cada request tarda más y entran menos.`, ok: false, why: `Error de sentido: concurrencia = throughput × latencia, así que sube.` },
        { html: `Sube a ≈ 100 en vuelo: más workers, conexiones y cola del batcher; colas y timeouts justo cuando menos margen hay.`, ok: true, why: `500 × 0.2 = 100: si la latencia se degrada, la concurrencia se multiplica.` },
      ],
      explain: `Little's law (L = λ·W) dice cuántos requests hay en vuelo en promedio: para eso dimensionas workers, conexiones y la cola del batcher. Si la latencia se degrada en un pico, la concurrencia se multiplica y aparecen colas y timeouts: un círculo vicioso. En la entrevista: "by Little's law, at 500 requests per second and 50 ms we have about 25 in flight".`,
    },
    {
      id: 'm01-p36', section: 'estimaciones-express',
      q: `Calculas: logs de predicción ≈ 300 B × 10 M/día ≈ 3 GB/día; guardar las imágenes serían ≈ 2 TB/día. ¿Qué decisión sale de esos números?`,
      options: [
        { html: `100 % de los logs con un hash de la imagen; de las fotos, solo copias las que se etiquetan.`, ok: true, why: `Los logs son baratos y son la materia prima del lazo; las imágenes ya existen y copiarlas todas no aporta.` },
        { html: `Guardas el 1 % de los logs para ahorrar y el 100 % de las imágenes para reentrenar.`, ok: false, why: `Está invertido: los logs ocupan ≈ 700 veces menos y los necesitas completos para monitoreo y debugging.` },
        { html: `Guardas todo, logs e imágenes, en el data lake: el almacenamiento de objetos es barato y tener cada foto te deja reentrenar con cualquier criterio en el futuro.`, ok: false, why: `Duplicas ≈ 2 TB/día de fotos que ya están en el storage del producto, con más costo y más datos sensibles, sin una necesidad concreta.` },
        { html: `Guardas solo agregados por hora (conteos y promedios), porque los logs individuales casi no se usan.`, ok: false, why: `Sin logs por request pierdes monitoreo por slice, labeling, reentrenamiento y debugging.` },
      ],
      explain: `El número decide: 3 GB/día de logs es barato, así que guardas el 100 % (en Parquet ocupa menos); 2 TB/día de imágenes no, y además ya existen en el storage del producto. Muestreas ≈ 1 % de referencias (≈ 100k/día) y copias solo las ≈ 5k/mes que etiquetan personas. Ese es el patrón "número + decisión".`,
    },

    // ======================================================== senales
    {
      id: 'm01-p37', section: 'senales',
      q: `Enunciado con 5 req/s y un equipo de 2 personas. Propusiste Kafka + Kubernetes + feature store y el entrevistador pregunta "¿por qué Kafka?". ¿Qué respuesta recupera mejor la señal?`,
      options: [
        { html: `Lo defiendes: Kafka desacopla los servicios y deja el sistema listo para crecer.`, ok: false, why: `Preparar para un crecimiento que ningún número indica es over-engineering con mejor discurso.` },
        { html: `Reconoces y simplificas: 5 req/s son ≈ 430 k/día; 1–2 réplicas con fallback y logs bastan, y cada pieza entra cuando un número la pida.`, ok: true, why: `Corrige en voz alta con un número, que es exactamente el antídoto del error de over-engineering.` },
        { html: `Dices que es el estándar de la industria para sistemas de ML en producción.`, ok: false, why: `Es name-dropping: nombrar herramientas sin porqué.` },
        { html: `Mantienes Kafka pero quitas el feature store para compensar la complejidad.`, ok: false, why: `Recorte arbitrario: sigue sin haber un número que justifique lo que queda.` },
      ],
      explain: `Over-engineering es uno de los 10 errores que te hunden: cada pieza de infraestructura se justifica con un número o un requisito, y para 5 req/s con un equipo chico cada pieza extra es costo de operación. El mismo diseño para 50,000 req/s podría ser correcto. Cuando te corrigen, aceptas, ajustas y sigues, sin defenderte de más.`,
    },
    {
      id: 'm01-p38', section: 'senales',
      q: `¿Cuál de estas respuestas sobre el protocolo entre el inference service y el model server da más señal en la dimensión de trade-offs?`,
      options: [
        { html: `"gRPC con Protobuf: serializa más eficiente que JSON y usa HTTP/2 con multiplexing, así que es la opción de mejor rendimiento para tráfico interno entre servicios."`, ok: false, why: `Media verdad sin condición de cambio: ignora cómo se balancean esas conexiones y no dice cuándo elegiría otra cosa.` },
        { html: `"Depende del caso; los dos tienen ventajas y desventajas que habría que evaluar."`, ok: false, why: `"Depende" sin cerrar es la marca junior de la tabla de señales.` },
        { html: `"REST, porque es más simple y todo el equipo lo conoce."`, ok: false, why: `La dirección es razonable, pero falta el porqué técnico y la condición en que cambiarías.` },
        { html: `"REST: tras un balanceador L4, gRPC deja cada cliente pegado a un pod por su conexión HTTP/2 larga; cambiaría si la serialización fuera el cuello de botella."`, ok: true, why: `Tiene elección, porqué concreto, alternativa descartada y condición de cambio.` },
      ],
      explain: `Lo que más sube la nota es cada decisión con su porqué y su alternativa descartada: "elijo X por Y; cambiaría a Z si pasara W". Un balanceador L4 reparte conexiones, no requests, y gRPC manda todo por una conexión HTTP/2 larga, así que un cliente queda pegado a un pod. Dicho en 10 segundos, alimenta trade-offs y arquitectura a la vez.`,
    },
    {
      id: 'm01-p39', section: 'senales',
      q: `Minuto 14. El entrevistador pregunta, casi de pasada: "¿qué modelo usarías?". ¿Mejor respuesta?`,
      options: [
        { html: `Dos frases: un modelo probado (ResNet-50 fine-tuned), por qué basta y qué lo cambiaría; y ofreces profundizar.`, ok: true, why: `La pregunta es una transición, no una invitación; respondes corto y dejas la puerta abierta.` },
        { html: `Comparas EfficientNet, ConvNeXt y ViT en accuracy, FLOPs y latencia, porque te lo preguntó de forma directa y es donde más valor puedes mostrar.`, ok: false, why: `Es "el error del especialista en CV": 10 minutos de modelo en respuesta a una transición.` },
        { html: `"En system design el modelo no importa", y pasas a la arquitectura.`, ok: false, why: `Despectivo y sin respuesta: el modelo se resuelve breve, no se ignora.` },
        { html: `Propones entrenar desde cero, porque los modelos preentrenados no conocen las categorías del marketplace.`, ok: false, why: `Fine-tuning de un modelo preentrenado resuelve justo eso; entrenar desde cero no es el baseline razonable.` },
      ],
      explain: `Tu riesgo como especialista en CV es convertir cada mención del modelo en un deep dive de arquitecturas. Responde en dos frases (modelo probado, por qué basta, qué lo haría cambiar) y ofrece más: "happy to go deeper if you want". Si el entrevistador quiere más modelo, te lo va a pedir, y entonces sí brillas.`,
    },
    {
      id: 'm01-p40', section: 'senales',
      q: `Te preguntan cuántas imágenes por segundo da una T4 con tu modelo en FP16. No lo sabes con certeza. ¿Qué dices?`,
      options: [
        { html: `"No lo sé", y pasas al siguiente tema para no perder tiempo.`, ok: false, why: `Bloquearse es la columna junior; sin un orden de magnitud no puedes calcular GPUs.` },
        { html: `Un número exacto que suene seguro, como 1,237 img/s, para no mostrar duda.`, ok: false, why: `Inventar con precisión falsa es peor que reconocer la incertidumbre.` },
        { html: `Un orden de magnitud marcado como estimación, y cómo lo medirías: load test al máximo que cumple el SLO.`, ok: true, why: `Es la respuesta senior/Staff: número incierto, marcado como tal, con el método para medirlo.` },
        { html: `Que lo calculas exacto con la hoja de datos: TFLOPS en FP16 de la T4 ÷ FLOPs del modelo, y planificas las GPUs con ese número en vez de adivinar.`, ok: false, why: `Eso da una cota superior teórica, útil como sanity check, pero la GPU real rinde muy por debajo y el número no dice nada del p99: planificar con él sobreestima la capacidad. La que importa es la que cumple el SLO, medida con tu modelo.` },
      ],
      explain: `"No lo sé con certeza; lo mediría así…" es una señal positiva, no una debilidad. Das un orden de magnitud, lo marcas como estimación y dices cómo lo validarías (perf_analyzer para Triton, Locust o k6 para HTTP). Frase: "I'd validate this capacity number with a load test before committing to it".`,
    },
    {
      id: 'm01-p41', section: 'senales',
      q: `Minuto 40. Estás a mitad de un deep dive muy bueno sobre batching y el entrevistador se ve interesado, aunque no pidió seguir. Todavía no hablaste de monitoreo ni de fallas. ¿Qué haces?`,
      options: [
        { html: `Sigues: si el entrevistador se ve interesado, el deep dive está dando señal fuerte en arquitectura, y eso vale más que un cierre apurado.`, ok: false, why: `Es el error 10: quedarse sin tiempo antes de las fallas. Terminar a mitad de un deep dive deja dos dimensiones sin señal.` },
        { html: `Terminas el deep dive y en el minuto 44 agregas "y monitorearíamos el modelo".`, ok: false, why: `"Monitorearía el modelo" es justo la frase que no deja nada que anotar.` },
        { html: `Hablas más rápido para cubrir el resto del deep dive y el cierre en los 5 minutos que quedan.`, ok: false, why: `No es priorizar: comprimes todo y la comunicación se resiente.` },
        { html: `Cortas en voz alta ("para dejar tiempo a monitoreo y fallas, cierro aquí") y cubres los pasos 6–7 en viñetas.`, ok: true, why: `Es la regla del minuto 40, y decirlo en voz alta le da al entrevistador la oportunidad de redirigirte.` },
      ],
      explain: `El control de tiempo dicho en voz alta suma en comunicación y deja que el entrevistador decida si quiere otra cosa: "I'm conscious of time — let me move on to monitoring". En el minuto 40 cortas; si en el 43 no hablaste de monitoreo, 60 segundos: dos métricas de sistema, una de modelo, una alerta con umbral, rollback y el resumen.`,
    },

    // ======================================================== ejemplo-guiado
    {
      id: 'm01-p42', section: 'ejemplo-guiado',
      q: `Detector de fotos borrosas antes de publicar. El servicio de blur se cae. ¿Qué comportamiento debería tener el sistema y por qué?`,
      options: [
        { html: `Fail-closed: bloquear la publicación hasta que el servicio vuelva, para no dejar pasar fotos borrosas.`, ok: false, why: `Bloquear cuesta anuncios; el aviso es una mejora, no un control crítico.` },
        { html: `Fail-open: se publica sin aviso, porque es un aviso suave y un bloqueo cuesta un anuncio.`, ok: true, why: `Es la decisión del ejemplo: 99.9 % con fail-open.` },
        { html: `Reintentar hasta obtener respuesta, para que ninguna foto quede sin revisar.`, ok: false, why: `El vendedor está esperando en la pantalla; reintentar sin límite rompe la latencia y no respeta el timeout.` },
        { html: `Mostrar el aviso en todas las fotos mientras dure la caída, por precaución.`, ok: false, why: `Es 100 % de falsos positivos: molesta y daña el guardrail de tasa de publicación.` },
      ],
      explain: `El comportamiento ante fallas se decide desde el costo del error: aquí un falso positivo que bloquea cuesta un anuncio, así que el aviso es suave y el servicio falla abierto. Ponlo en los requisitos no funcionales ("99.9 % con fail-open") y en el cierre ("servicio caído → fail-open"). Lo contrario, fail-closed, se reserva para controles donde dejar pasar es más caro que bloquear.`,
    },
    {
      id: 'm01-p43', section: 'ejemplo-guiado',
      q: `En el detector de fotos borrosas, el entrevistador pregunta: "¿Necesitas deep learning aquí?". ¿Mejor respuesta?`,
      options: [
        { html: `Sí: una CNN pequeña con transfer learning es barata de entrenar y, con un buen dataset, supera el 95 % de accuracy, más que cualquier heurística.`, ok: false, why: `Respuesta junior: "95 % de accuracy" no dice nada sin la tasa base de fotos borrosas, y no hay baseline.` },
        { html: `No: la varianza del Laplaciano resuelve el problema y nunca va a hacer falta una CNN.`, ok: false, why: `Absoluto y sin medir: el baseline puede fallar en slices concretos (fondos lisos, fotos nocturnas, desenfoque parcial).` },
        { html: `Depende de los datos: primero recolecto y etiqueto 100k fotos, y con eso decido.`, ok: false, why: `Caro antes de tener un baseline; un golden set de 1–2k fotos basta para medir.` },
        { html: `Primero no: varianza del Laplaciano en CPU con umbral calibrado en 1–2k fotos; CNN solo si falla en slices concretos.`, ok: true, why: `Mide antes de construir, y el baseline sirve como punto de comparación y como plan de degradación.` },
      ],
      explain: `El ML es un medio: empiezas con un baseline barato, lo mides por slice y solo agregas un modelo si falla donde importa. Es la mentalidad de las primeras reglas de Zinkevich: no temas lanzar sin ML; primer modelo simple, infraestructura bien hecha. Además, el baseline queda como fallback.`,
    },
    {
      id: 'm01-p44', section: 'ejemplo-guiado',
      q: `¿Cómo validas que el aviso de foto borrosa ayuda y no molesta?`,
      options: [
        { html: `A/B aleatorizado por foto, para tener muchas más unidades y llegar antes a significancia; métrica primaria: % de fotos marcadas como borrosas.`, ok: false, why: `Por foto, el mismo vendedor ve un comportamiento inconsistente; y el % marcado mide al modelo, no si ayuda.` },
        { html: `Precision y recall del aviso en el golden set, por slice.`, ok: false, why: `Es evaluación offline necesaria, pero no dice si el aviso cambia el comportamiento ni el negocio.` },
        { html: `A/B por vendedor; primaria: contactos por anuncio a 7 días; guardrails: tasa de publicación y tiempo hasta publicar.`, ok: true, why: `Unidad de aleatorización correcta, métrica de negocio y guardrails: lo que busca la dimensión de monitoreo y operación.` },
        { html: `Comparar la tasa de publicación del mes antes y del mes después del lanzamiento.`, ok: false, why: `Antes/después mezcla temporada y otros cambios; y la tasa de publicación es guardrail, no la métrica primaria.` },
      ],
      explain: `Un buen experimento liga el modelo a una métrica de negocio, elige la unidad de aleatorización (vendedor, no foto, para no mostrar comportamientos inconsistentes) y define guardrails. Si los falsos positivos suben el abandono del formulario, subes el umbral. Dilo así: "We would run an A/B test randomized by seller, with listing contacts as the primary metric".`,
    },
    {
      id: 'm01-p45', section: 'ejemplo-guiado',
      q: `Tras un release de la app, el % de fotos marcadas como borrosas salta de ≈ 8 % a 30 % en pocas horas. El p99 y la tasa de errores del servicio están normales. ¿Interpretación más probable y qué haces?`,
      options: [
        { html: `Las fotos de los usuarios empeoraron de golpe; el aviso funciona como se espera.`, ok: false, why: `Un salto brusco que coincide con un release apunta a un cambio en el input, no a que los usuarios fotografíen peor de un día para otro.` },
        { html: `El servicio está sobrecargado y los timeouts marcan como borrosas las fotos que no procesa.`, ok: false, why: `Con p99 y errores normales no hay sobrecarga; y con fail-open un timeout publica sin aviso, no marca.` },
        { html: `Cambió el input con el release (p. ej. la compresión): desglosas el % marcado por versión de app y dispositivo, y mitigas en esa versión mientras se corrige el origen.`, ok: true, why: `Es el escenario del ejemplo: el % marcado por hora detecta un cambio de compresión que las métricas de sistema no ven. Mitigas solo en la versión afectada (umbral propio o aviso apagado) porque un umbral global nuevo dañaría a las demás.` },
        { html: `Concept drift: cambió lo que la gente considera "borroso"; hay que reetiquetar el golden set.`, ok: false, why: `Lo que significa "borroso" no cambia en horas; lo que cambió es la distribución del input.` },
      ],
      explain: `Las métricas de sistema (p99, errores) no ven a un servicio sano que se equivoca; por eso monitoreas también el comportamiento del modelo, como el % de fotos marcadas por hora. Un salto que coincide con un release apunta a un cambio en el input (p. ej. más compresión), y lo confirmas desglosando por versión de app y modelo de dispositivo. Es el tipo de alerta concreta que suma en monitoreo.`,
    },
  ];
})(typeof window !== 'undefined' ? window : globalThis);
