/* =============================================================================
   Ronda de Diseño ML — js/content/m03-latencia.js
   Módulo 03: latencia, throughput y capacidad. Percentiles y tail latency,
   presupuesto de latencia, QPS promedio/pico/diseño, Little's law, colas y
   utilización, batching, cuántas GPUs, load testing, timeouts y reintentos.
   Contrato: docs/SPEC.md §5. Los números del caso 1 son los de c01-clasificacion.js
   (y de reference/c01): si cambian allá, se cambian aquí.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const est = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // Camino del request de c01 con su presupuesto y sus timeouts.
  // Fila online y = 6–14 (5 columnas de 16 con huecos de 6: x = 2, 24, 46, 68, 90);
  // fallback y = 17–24 bajo el caller; carril de medición y = 33–40.
  const PRESUPUESTO = {
    width: 108, height: 44,
    lanes: [
      { id: 'online', label: 'Camino del request (c01) · SLO p99 ≤ 200 ms server-side', x: 0, y: 0, w: 108, h: 26, kind: 'online' },
      { id: 'medicion', label: 'Dónde se mide', x: 0, y: 28, w: 108, h: 16, kind: 'monitor' },
    ],
    nodes: [
      { id: 'caller', label: 'Caller (backend)', sub: 'timeout 300 ms', x: 2, y: 6, w: 16, h: 8, kind: 'client',
        note: 'El backend de publicación ya recibió la foto del celular y nos llama server-to-server. Su timeout de 300 ms es el techo de todo el presupuesto: pasado ese tiempo, la respuesta ya no le sirve a nadie. La subida de la foto por 4G ocurre antes y queda fuera del SLO: por eso el SLO es server-side.' },
      { id: 'alb', label: 'ALB', sub: 'TLS · p99 5–10 ms', x: 24, y: 6, w: 16, h: 8, kind: 'edge',
        note: 'Termina TLS, autentica y enruta. Con conexiones persistentes cuesta ' + est('1–3 ms') + ' en p50. El reloj del SLO arranca aquí, cuando el request completo llegó. Detalle en <a href="#c01.estimaciones">c01</a>.' },
      { id: 'gw', label: 'Gateway FastAPI', sub: 'deadline 250 ms · CPU', x: 46, y: 6, w: 16, h: 8, kind: 'service',
        note: 'Lee el body, decodifica, redimensiona y normaliza en un threadpool, llama a Triton y arma la respuesta. Es el tramo más variable: una foto web de 12 MP le cuesta ' + est('≈ 40–80 ms') + ' de CPU sin draft mode (' + est('≈ 1.3–2×') + ' menos con el draft mode que usa c01, según el archivo) contra ' + est('≈ 6 ms') + ' en promedio. Fija el deadline total del request (250 ms) y responde 504 si se acaba.' },
      { id: 'cola', label: 'Cola de Triton', sub: 'batching ≤ 2 ms', x: 68, y: 6, w: 16, h: 8, kind: 'queue',
        note: 'El dynamic batcher espera como máximo 2 ms (<code>max_queue_delay_microseconds: 2000</code>) a que lleguen más requests. Aquí vive el tiempo de espera, separado del de servicio: si la GPU se satura, es lo que crece primero. Un request que lleva 100 ms en cola se rechaza.' },
      { id: 'gpu', label: 'TensorRT en T4', sub: 'FP16 · batch 1–3', x: 90, y: 6, w: 16, h: 8, kind: 'gpu',
        note: 'El tiempo de servicio: ' + est('3–6 ms') + ' en p50 y ' + est('8–15 ms') + ' en p99 para un batch chico: un décimo o menos del p99 pesimista (≈ 150 ms). Optimizar el modelo casi nunca es la primera palanca en este sistema.' },
      { id: 'fallback', label: 'Selector manual', sub: 'si vence o hay 5xx', x: 2, y: 17, w: 16, h: 7, kind: 'human',
        note: 'Si vence el timeout de 300 ms o llega un 503/504, la UI muestra el selector de categorías de siempre. Gracias a él, el camino no es crítico y los timeouts pueden ser agresivos: un request lento se convierte en una experiencia algo peor, no en un error.' },
      { id: 'albm', label: 'Métrica del ALB', sub: 'TargetResponseTime', x: 24, y: 33, w: 16, h: 7, kind: 'monitor',
        note: 'Lo que tardó el target visto desde el balanceador. Sirve para contrastar con tu histograma y para detectar un pod lento, pero no reemplaza al histograma del gateway.' },
      { id: 'hist', label: 'Histograma gateway', sub: 'el SLI del SLO', x: 46, y: 33, w: 16, h: 7, kind: 'monitor',
        note: '<code>classifier_request_latency_seconds</code>, con buckets densos alrededor de 200 ms. Sumado entre pods (<code>sum by (le)</code>) da el p99 que se compara con el SLO. Dos histogramas más separan preproceso (CPU) de inferencia (ida y vuelta a Triton).' },
      { id: 'tm', label: 'Métricas Triton', sub: 'cola vs cómputo', x: 68, y: 33, w: 16, h: 7, kind: 'monitor',
        note: 'Contadores acumulados de tiempo en cola y en cómputo (<code>nv_inference_queue_duration_us</code>, <code>nv_inference_compute_infer_duration_us</code>). Divididos por los requests dan promedios, no percentiles: suficientes para saber si la GPU está saturada (sube la cola) o si algo cambió en el cómputo.' },
    ],
    edges: [
      { from: 'caller', to: 'alb', kind: 'online', label: 'foto ≈ 200 KB' },
      { from: 'alb', to: 'gw', kind: 'online' },
      { from: 'gw', to: 'cola', kind: 'online', label: 'tensor 602 KB' },
      { from: 'cola', to: 'gpu', kind: 'online' },
      { from: 'caller', to: 'fallback', kind: 'neutral', dashed: true, fromSide: 'b', toSide: 't' },
      { from: 'alb', to: 'albm', kind: 'monitor', fromSide: 'b', toSide: 't' },
      { from: 'gw', to: 'hist', kind: 'monitor', fromSide: 'b', toSide: 't' },
      { from: 'cola', to: 'tm', kind: 'monitor', fromSide: 'b', toSide: 't' },
      { from: 'gpu', to: 'tm', kind: 'monitor', fromSide: 'b', toSide: 'r', via: [[98, 36.5]] },
    ],
    flows: [
      { id: 'request-p50', label: 'Un request típico (p50)', steps: [
        { nodes: ['caller', 'alb'], edges: ['caller>alb'], text: 'El backend manda la foto (≈ 200 KB si viene del celular). El reloj del SLO arranca cuando el ALB tiene el request completo. ALB + routing: ' + est('1–3 ms') + '.' },
        { nodes: ['alb', 'gw'], edges: ['alb>gw'], text: 'El gateway lee el body (' + est('1–3 ms') + '), decodifica y redimensiona en un threadpool (' + est('5–12 ms') + ') y normaliza (' + est('≈ 1 ms') + '). Casi todo es CPU.' },
        { nodes: ['gw', 'cola'], edges: ['gw>cola'], text: 'Manda el tensor de 602 KB a Triton de su misma zona (' + est('2–4 ms') + '). Espera en la cola del batcher como máximo 2 ms: tiempo de espera, no de servicio.' },
        { nodes: ['cola', 'gpu'], edges: ['cola>gpu'], text: 'TensorRT FP16 corre el batch (' + est('3–6 ms') + '). A 250 req/s por GPU, el batch típico es de 1–3 requests.' },
        { nodes: ['gw'], edges: [], text: 'De vuelta en el gateway: softmax, top-5, JSON y log (' + est('≈ 1 ms') + '), más el overhead de Python (' + est('5–10 ms') + '). Total p50 ' + est('≈ 20–45 ms') + ', dentro de lo esperado (30–50 ms).' },
      ] },
      { id: 'deadlines', label: 'Triton lento: deadlines en cascada', steps: [
        { nodes: ['caller'], edges: [], text: 'El caller empieza con 300 ms. Si se le acaban, deja de esperar y muestra el selector manual.' },
        { nodes: ['gw'], edges: [], text: 'El gateway fija su propio deadline total de 250 ms: 50 ms antes que el caller, para alcanzar a responder un 504 limpio en vez de dejar al caller colgado.' },
        { nodes: ['gw', 'cola'], edges: ['gw>cola'], text: 'La llamada a Triton sale con timeout de 150 ms. Si vence, el gateway responde 504 y libera el slot en vez de seguir esperando.' },
        { nodes: ['cola'], edges: [], text: 'Dentro de Triton, un request que lleva 100 ms en la cola se rechaza (<code>default_queue_policy</code> con REJECT): ya no llegaría a tiempo, así que no se gasta GPU en él.' },
        { nodes: ['caller', 'fallback'], edges: ['caller>fallback'], text: 'El caller recibe el 504 (o vence su timeout) y muestra el selector manual. Algunos requests degradan; el servicio no se cae.' },
      ] },
      { id: 'medicion', label: 'Dónde se mide cada cosa', steps: [
        { nodes: ['gw', 'hist'], edges: ['gw>hist'], text: 'El SLO se mide aquí: histograma del gateway, agregado entre pods. Es el único número que se compara con "p99 ≤ 200 ms".' },
        { nodes: ['cola', 'gpu', 'tm'], edges: ['cola>tm', 'gpu>tm'], text: 'Si el p99 sube, las métricas de Triton dicen si es espera (GPU saturada: escalar) o servicio (algo cambió en el modelo o en la GPU).' },
        { nodes: ['alb', 'albm'], edges: ['alb>albm'], text: 'La métrica del ALB sirve de contraste y para ver si un solo target está lento. Lo que siente el vendedor (con su red) solo lo ve el cliente.' },
      ] },
    ],
  };

  // Amplificación de reintentos: 3 capas × 3 reintentos vs una sola capa con presupuesto.
  // Columnas x = 2, 30, 58, 86 (w 16, huecos de 12 para que las etiquetas quepan sobre la arista).
  const REINTENTOS = {
    width: 104, height: 40,
    lanes: [
      { id: 'tormenta', label: 'Cada capa reintenta 3 veces', x: 0, y: 0, w: 104, h: 19, kind: 'neutral' },
      { id: 'presupuesto', label: 'Una sola capa reintenta, con presupuesto', x: 0, y: 21, w: 104, h: 19, kind: 'online' },
    ],
    nodes: [
      { id: 'c1', label: 'Cliente', sub: '1 request', x: 2, y: 6, w: 16, h: 8, kind: 'client',
        note: 'Un usuario, un request. Si el cliente también reintenta 3 veces cuando la API falla, es la primera capa del multiplicador.' },
      { id: 'a1', label: 'API', sub: 'hasta 4 intentos', x: 30, y: 6, w: 16, h: 8, kind: 'edge',
        note: 'Recibe hasta 4 intentos por request del usuario (1 + 3 reintentos del cliente). Cada uno, a su vez, puede reintentar hacia abajo.' },
      { id: 's1', label: 'Servicio', sub: 'hasta 16 intentos', x: 58, y: 6, w: 16, h: 8, kind: 'service',
        note: '4 × 4 = 16 intentos por request del usuario. Nadie en esta capa ve el problema completo: cada una cree que está siendo resiliente.' },
      { id: 'm1', label: 'Model server', sub: 'hasta 64 intentos', x: 86, y: 6, w: 16, h: 8, kind: 'gpu',
        note: '4<sup>3</sup> = 64 intentos por request del usuario, justo en el tier más caro y justo cuando está lento. Aunque la causa original desaparezca, la carga de reintentos sola lo mantiene saturado: eso es un retry storm.' },
      { id: 'c2', label: 'Cliente', sub: 'reintenta ≤ 10 %', x: 2, y: 27, w: 16, h: 8, kind: 'client',
        note: 'La única capa que reintenta; en este ejemplo, la que conoce el deadline y tiene el fallback. Solo errores transitorios (503 o 429 con Retry-After, errores de conexión), con backoff exponencial y jitter, y como mucho un 10 % de reintentos sobre el total.' },
      { id: 'a2', label: 'API', sub: '≤ 1.1 intentos', x: 30, y: 27, w: 16, h: 8, kind: 'edge',
        note: 'Pasa el error hacia arriba sin reintentar (o con un 503 que diga cuándo volver). La carga extra queda acotada en 10 %.' },
      { id: 's2', label: 'Servicio', sub: '≤ 1.1 intentos', x: 58, y: 27, w: 16, h: 8, kind: 'service',
        note: 'Tampoco reintenta: propaga el error y el deadline. Si el model server está saturado, le conviene responder rápido y dejar que el cliente decida.' },
      { id: 'm2', label: 'Model server', sub: '≤ 1.1 intentos', x: 86, y: 27, w: 16, h: 8, kind: 'gpu',
        note: 'Ve como mucho 1.1 intentos por request del usuario. Si está saturado, recibe casi la misma carga que antes del problema y se puede recuperar.' },
    ],
    edges: [
      { from: 'c1', to: 'a1', kind: 'neutral', label: '3 reintentos' },
      { from: 'a1', to: 's1', kind: 'neutral', label: '3 reintentos' },
      { from: 's1', to: 'm1', kind: 'neutral', label: '3 reintentos' },
      { from: 'c2', to: 'a2', kind: 'online', label: '≤ 10 % extra' },
      { from: 'a2', to: 's2', kind: 'online', label: 'sin reintentos' },
      { from: 's2', to: 'm2', kind: 'online', label: 'sin reintentos' },
    ],
    flows: [
      { id: 'tormenta', label: 'Cómo se multiplica', steps: [
        { nodes: ['m1'], edges: [], text: 'El model server se frena por carga: sus respuestas empiezan a vencer el timeout del servicio.' },
        { nodes: ['s1', 'm1'], edges: ['s1>m1'], text: 'El servicio reintenta 3 veces cada llamada: el model server recibe 4 intentos por cada request del servicio, justo cuando no da abasto.' },
        { nodes: ['a1', 's1'], edges: ['a1>s1'], text: 'La API ve fallar al servicio (agotó sus reintentos) y reintenta 3 veces: 16 intentos abajo por cada request de la API.' },
        { nodes: ['c1', 'a1', 'm1'], edges: ['c1>a1'], text: 'El cliente hace lo mismo: hasta 64 intentos en el model server por un request del usuario. Una lentitud se convirtió en caída.' },
      ] },
      { id: 'presupuesto', label: 'Con una sola capa y presupuesto', steps: [
        { nodes: ['c2', 'a2'], edges: ['c2>a2'], text: 'Solo el cliente reintenta, y solo si los reintentos no pasan del 10 % de sus requests. Con backoff exponencial y jitter.' },
        { nodes: ['a2', 's2', 'm2'], edges: ['a2>s2', 's2>m2'], text: 'Las capas internas propagan el error y el deadline sin reintentar. El model server ve como mucho 1.1× la carga y puede recuperarse.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ código
  const PROMQL = `# p99 de TODO el servicio: primero sumar los buckets de todos los pods (sum by le),
# después calcular el cuantil. Promediar el p99 de cada pod da un número sin sentido.
histogram_quantile(0.99,
  sum by (le) (rate(classifier_request_latency_seconds_bucket[5m])))

# Fracción de requests bajo el SLO: exacta solo si hay un bucket en 0.2 s
  sum(rate(classifier_request_latency_seconds_bucket{le="0.2"}[5m]))
/ sum(rate(classifier_request_latency_seconds_count[5m]))`;

  const LOCUST = `# locustfile.py: carga end-to-end para POST /v1/classify del caso 1
import random
from locust import HttpUser, task, constant_throughput

MOVIL = open("fotos/celular_1024px.jpg", "rb").read()   # ≈ 200 KB, lo que manda la app
WEB = open("fotos/web_12mp.jpg", "rb").read()           # ≈ 3 MB, original subido desde la web

class Vendedor(HttpUser):
    # Cada usuario intenta 1 req/s. Como el timeout (0.3 s) es menor que ese segundo,
    # un servidor lento no frena el ritmo: se aproxima a carga abierta.
    wait_time = constant_throughput(1)

    @task
    def clasificar(self):
        img = MOVIL if random.random() < 0.85 else WEB   # mezcla 85/15 del caso
        with self.client.post("/v1/classify?top_k=5", data=img,
                              headers={"Content-Type": "image/jpeg"},
                              timeout=0.3, catch_response=True) as r:
            if r.status_code != 200:                      # 503/504 o timeout (status 0)
                r.failure(f"status {r.status_code}")`;

  const LOCUST_RUN = `# 500 usuarios × 1 req/s = 500 req/s (el pico de diseño), rampa de 20 usuarios/s, 20 min.
# --processes reparte la carga en varios procesos: un solo proceso de Python puede
# saturarse antes que tu servicio (vigila su CPU; sin esa opción, usa --master y --worker).
locust -f locustfile.py --headless -u 500 -r 20 --run-time 20m \\
  --host https://classifier.internal --processes 4`;

  const PERF = `# 1) Capacidad de UNA T4: carga cerrada, subiendo la concurrencia hasta pasar el codo
perf_analyzer -m classifier -u triton:8000 \\
  --concurrency-range 1:32:2 \\
  --input-data tensores_reales.json \\
  --percentile=99 --measurement-interval 10000
# tensores_reales.json: fotos reales ya preprocesadas (por defecto manda datos aleatorios)

# 2) Latencia a una tasa fija (carga abierta): ¿cómo queda el p99 a 250 img/s por GPU?
perf_analyzer -m classifier -u triton:8000 \\
  --request-rate-range 250 \\
  --input-data tensores_reales.json --percentile=99`;

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm03',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'vocabulario',
        title: 'Latencia, throughput y concurrencia: tres números distintos',
        titleEn: 'Latency, throughput and concurrency',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'p', html: `Tres números describen el rendimiento de cualquier servicio, y la mitad de los malentendidos en una entrevista salen de mezclarlos. Primero el ejemplo, con los números del <a href="#c01">caso 1</a>: en el pico de diseño llegan 500 req/s al gateway, cada request tarda en promedio ${est('50 ms')} en responderse, y en cualquier instante hay unos 25 requests a medio procesar. 500 req/s es <b>throughput</b>, 50 ms es <b>latencia</b>, 25 es <b>concurrencia</b>. Son tres cosas distintas, atadas por una cuenta que verás en la <a href="#m03.little">sección 5</a>: 25 = 500 × 0.05.` },
          { t: 'table', caption: 'Los tres números', head: ['Número', 'Qué mide', 'Unidades', 'En el caso 1', 'Qué dimensiona'], rows: [
            ['Latencia', 'Cuánto tarda <b>un</b> request, entre dos puntos que tienes que nombrar', 'ms, como percentil (p50, p95, p99)', 'p99 ≤ 200 ms server-side; p50 ≈ 30–50 ms', 'La experiencia de quien espera y los timeouts de toda la cadena'],
            ['Throughput', 'Trabajo terminado por unidad de tiempo', 'req/s, img/s, frames/s, tokens/s', `500 req/s de diseño; ${est('≈ 1,200 img/s')} de máximo medido por T4`, 'Cuántas réplicas y GPUs pagas'],
            ['Concurrencia', 'Requests en curso al mismo tiempo (en cola + en proceso)', 'un conteo, sin unidad de tiempo', '≈ 25 en vuelo en todo el gateway', 'Threads, conexiones, memoria, lugares en cola: todo lo que está acotado'],
          ], note: 'Los tres se miden en un lugar concreto: la latencia que ve el cliente no es la del servidor, y el throughput del gateway no es el de la GPU si un request trae varias imágenes.' },
          { t: 'h3', text: 'Las unidades cambian la cuenta' },
          { t: 'list', items: [
            `<b>req/s vs img/s.</b> En c01 son lo mismo porque va una imagen por request. Si la app mandara las 3 fotos del anuncio en un solo request, 116 req/s serían ≈ 350 img/s: el gateway escala por requests (conexiones, bodies), la GPU por imágenes. Cuando te den un número, pregunta de cuál de los dos habla.`,
            `<b>frames/s.</b> En video (<a href="#c02">c02</a>) la carga la fija el número de cámaras × fps, no los usuarios: 40 cámaras a 15 fps son 600 frames/s las 24 horas, sin pico diurno.`,
            `<b>tokens/s.</b> En LLMs hay dos throughputs: tokens/s por usuario (lo que siente quien lee la respuesta) y tokens/s agregados de la GPU (lo que pagas). Batches más grandes suben el segundo y bajan el primero. Lo ves en <a href="#m14">M14</a>.`,
            `<b>Promedio o pico.</b> Un throughput que no dice si es promedio o pico no sirve para dimensionar (<a href="#m03.trafico">sección 4</a>).`,
          ] },
          { t: 'h3', text: 'Tiempo de servicio vs tiempo de espera' },
          { t: 'p', html: `La latencia de un request tiene dos partes que se comportan distinto. El <b>tiempo de servicio</b> (service time) es el trabajo en sí: los ${est('3–6 ms')} que tarda la T4 en correr un batch chico. El <b>tiempo de espera</b> (queueing delay) es lo que el request pasa esperando turno: en la cola del dynamic batcher, en el threadpool del gateway, detrás de otro batch que ocupa la GPU. El de servicio se baja con hardware u optimización del modelo; el de espera, con capacidad y con menos variabilidad. Con carga baja casi todo es servicio; cerca de la saturación domina la espera, y el mismo modelo en el mismo hardware puede responder en 10 ms o en 200 ms según qué tan cargado esté (<a href="#m03.colas-utilizacion">sección 6</a>).` },
          { t: 'kv', items: [
            ['Latencia', 'espera + servicio', 'W = W<sub>q</sub> + S; la notación se usa en la sección 6'],
            ['Dentro de Triton (c01, p50)', `0–2 ms de cola + ${est('3–6 ms')} de GPU`, 'La ventana de batching es espera; el cómputo es servicio'],
          ] },
          { t: 'h3', text: 'La confusión clásica: qué palanca mueve qué' },
          { t: 'table', head: ['Palanca', 'Throughput', 'Latencia de un request', 'Por qué'], rows: [
            ['Batch más grande', 'Sube', 'Sube', 'Reparte el costo fijo de cada ejecución en la GPU entre más imágenes, pero cada imagen espera a que se forme el batch y el batch tarda más. Es el trade-off de la <a href="#m03.batching">sección 7</a>.'],
            ['Más réplicas', 'Sube', 'Baja solo la espera, si había cola', 'Otra GPU no hace más rápida a una ResNet-50: reparte la carga.'],
            ['GPU más rápida, FP16, INT8', 'Sube', 'Baja', 'Reduce el tiempo de servicio: ganas en los dos, a cambio de dinero o de validar la calidad (<a href="#m08">M8</a>).'],
            ['Modelo más chico (destilación)', 'Sube', 'Baja', 'Menos cómputo por imagen; lo paga la calidad y el equipo de modelado.'],
            ['async o más workers', 'Sube, si había espera por I/O', 'Igual para un request aislado', 'La concurrencia deja atender a otros mientras uno espera a Triton; no acelera a ninguno.'],
            ['Paralelizar etapas independientes', 'Igual', 'Baja', 'La latencia pasa de la suma de las etapas a la más lenta de ellas.'],
            ['Cache de resultados', 'Sube: los hits no llegan a la GPU', 'Baja en los hits', 'Solo si hay repetición real: mide el hit rate antes de prometerlo.'],
          ] },
          { t: 'callout', kind: 'trap', title: '"El modelo es rápido"', html: `<p>¿Rápido en qué? "Corre a 1,000 img/s" es throughput con batch 32 y no dice cuánto espera un request solo. "Tarda 5 ms" es tiempo de servicio en batch 1 y no dice cuántas GPUs necesitas. Cada vez que digas "rápido", di el número, la unidad, el percentil y dónde se mide: "p99 de 200 ms server-side a 500 req/s".</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Batching trades latency for throughput. I'd cap the batching delay at 2 ms, which is noise against a 200 ms p99 budget, and it lets the GPU absorb spikes without scaling out."</p><p>Tres números, un trade-off y una decisión en dos frases: eso es lo que se anota.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>En <a href="#m01.estimaciones-express">M1</a> viste los redondeos (1 M/día ≈ 12 req/s, 25 requests en vuelo) y la fórmula de GPUs. Este módulo los convierte en herramientas: de dónde sale cada factor, cuándo falla y cómo se mide. Los ejemplos usan los números del <a href="#c01.estimaciones">caso 1</a>, para que puedas compararlos con su solución.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'percentiles',
        title: 'p50, p95, p99: por qué el promedio miente',
        titleEn: 'Percentiles and tail latency',
        priority: 'core',
        dims: ['estimaciones', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Empieza con 1,000 requests de un servicio (inventados, con forma realista): 900 respondieron en 40 ms, 85 en 150 ms (les tocó una foto web grande) y 15 en 1.2 s (les tocó una pausa del proceso o un reintento). Ordénalos de menor a mayor: los #1–900 tardaron 40 ms, los #901–985 tardaron 150 ms y los #986–1,000 tardaron 1,200 ms.` },
          { t: 'calc', title: 'Promedio vs percentiles de 1,000 requests', rows: [
            { label: 'Promedio', expr: '(900 × 40 + 85 × 150 + 15 × 1,200) / 1,000', value: '≈ 67 ms' },
            { label: 'p50 (mediana)', expr: 'request #500 → bloque de 40 ms (#1–900)', value: '40 ms' },
            { label: 'p95', expr: 'request #950 → bloque de 150 ms (#901–985)', value: '150 ms' },
            { label: 'p99', expr: 'request #990 → bloque de 1.2 s (#986–1,000)', value: '1,200 ms' },
            { label: 'Requests por encima de 200 ms', expr: '15 / 1,000', value: '1.5 %' },
          ], result: 'El promedio dice 67 ms y "cumple" con holgura un SLO de 200 ms. El p99 dice 1.2 s: el SLO <b>p99 ≤ 200 ms</b> está roto y 15 de cada 1,000 vendedores esperan más de un segundo. Y ningún request tardó 67 ms: el promedio no describe a nadie.' },
          { t: 'p', html: `Un percentil pN es el valor bajo el cual queda el N % de las mediciones. El p50 describe el caso típico; el p95 y el p99, la <b>cola</b> de la distribución (tail latency). Los SLOs se escriben sobre el p99 porque la cola es lo que el usuario recuerda y lo que dispara timeouts, y porque a escala el 1 % no es poco: con los 10 M requests diarios del caso 1, el 1 % son 100,000 requests lentos al día.` },
          { t: 'callout', kind: 'note', html: `<p>En este ejemplo todos los métodos de cálculo coinciden porque ningún percentil cae en el borde entre dos bloques. Con datos reales, los métodos (nearest-rank, interpolación lineal, buckets de un histograma) difieren un poco en los bordes. Importa usar siempre el mismo, no cuál.</p>` },
          { t: 'h3', text: 'Qué hace crecer la cola' },
          { t: 'table', head: ['Causa', 'Cómo se ve', 'En serving de ML', 'Mitigación'], rows: [
            ['Colas por utilización alta', 'El p99 sube con el QPS aunque el p50 casi no se mueva', 'La cola de Triton crece en el pico diurno', 'Headroom, más réplicas, load shedding (<a href="#m03.colas-utilizacion">§6</a>)'],
            ['Pausas del proceso', 'Picos de decenas o cientos de ms sin relación con la carga', 'GC de Python; un decode dentro de <code>async def</code> bloquea el event loop (<a href="#c01.serving">c01</a>)', 'Threadpool para el trabajo de CPU, menos objetos por request'],
            ['Cold starts y caches fríos', 'Los primeros requests después de un deploy o de escalar son lentos', 'Contexto de CUDA, carga del engine, primer uso de un tamaño de batch', 'Warmup antes de pasar readiness (<a href="#m03.load-testing">§9</a>)'],
            ['Noisy neighbors', 'Una réplica o un nodo más lento que los demás', 'Otro pod del nodo satura CPU, disco o red; un caller batch en tu API', 'Requests de recursos, nodos dedicados, cuota por caller'],
            ['CPU throttling', 'Picos periódicos aunque la CPU promedio esté baja', 'Un límite de CPU en el pod: el kernel reparte la cuota en ventanas de 100 ms y, si se agota, el pod espera al resto de la ventana', 'Sin límite de CPU en pods sensibles a latencia, como el gateway de c01'],
            ['Espera de batching', 'Un piso de latencia de hasta max_queue_delay', 'La ventana de 2 ms de Triton', 'Ventana chica frente al presupuesto (<a href="#m03.batching">§7</a>)'],
            ['Reintentos', 'Requests que tardan un timeout completo más otro intento', 'Timeout de 150 ms + reintento', 'Deadlines y presupuesto de reintentos (<a href="#m03.timeouts-reintentos">§10</a>)'],
            ['Inputs grandes', 'Latencia correlacionada con el tamaño del input', `Una foto web de 12 MP: ${est('≈ 40–80 ms')} de CPU de decode sin draft mode, contra ${est('≈ 6 ms')} en promedio`, 'Límites de tamaño, draft mode, reducir en el cliente'],
            ['Red', 'Saltos discretos de ≈ 200 ms', 'Una retransmisión de TCP: el timeout de retransmisión (RTO) mínimo por defecto de Linux es 200 ms', 'Conexiones persistentes, misma zona; que el timeout lo absorba'],
          ] },
          { t: 'h3', text: 'Tail at scale: el fan-out multiplica la cola' },
          { t: 'p', html: `Si un request dispara N llamadas en paralelo y espera a todas, basta con que una sea lenta. Supón que cada backend supera su propio p99 el 1 % de las veces, de forma independiente:` },
          { t: 'calc', title: 'Probabilidad de que el request sea lento: 1 − 0.99^N', rows: [
            { label: 'N = 1', expr: '1 − 0.99', value: '1 %' },
            { label: 'N = 10', expr: '1 − 0.99<sup>10</sup>', value: '≈ 9.6 %' },
            { label: 'N = 100', expr: '1 − 0.99<sup>100</sup>', value: '≈ 63.4 %' },
          ], result: 'Con un fan-out de 100, la mayoría de los requests toca la cola de algún backend: el p99 de cada pieza se vuelve la latencia típica del conjunto. Es el argumento central de Dean y Barroso en <i>The Tail at Scale</i> (Communications of the ACM, 2013).' },
          { t: 'p', html: `Dónde aparece en ML: un ranking que lee features de 10 shards, un ensemble de 5 modelos, un pipeline de documentos que corre OCR, layout y clasificación (<a href="#c05">c05</a>), un RAG que consulta varios índices. Dos respuestas de diseño: bajar N (menos llamadas en el camino crítico, precomputar lo que se pueda) y recortar la cola de cada llamada (timeouts con respuesta parcial, hedging en la <a href="#m03.timeouts-reintentos">sección 10</a>).` },
          { t: 'h3', text: 'Los percentiles no se promedian' },
          { t: 'p', html: `Dos pods detrás del balanceador, 5 minutos de tráfico. El pod A atendió 9,900 requests con p99 de 80 ms. El pod B, con un vecino ruidoso en su nodo, atendió 200 requests, todos en ≈ 2 s.` },
          { t: 'calc', title: 'Tres formas de "calcular" el p99 del servicio', rows: [
            { label: 'Promedio de los p99', expr: '(80 + 2,000) / 2', value: '1,040 ms', note: 'sugiere que todo el servicio está roto' },
            { label: 'Promedio ponderado por tráfico', expr: '(9,900 × 80 + 200 × 2,000) / 10,100', value: '≈ 118 ms', note: 'sugiere que todo está bien' },
            { label: 'Fracción de requests en ≈ 2 s', expr: '200 / 10,100', value: '≈ 2 %' },
            { label: 'p99 real', expr: 'más del 1 % de los requests tardó ≈ 2 s', value: '≈ 2 s' },
          ], result: 'Ningún promedio de percentiles da el percentil del conjunto. La única forma correcta es juntar las distribuciones (los buckets de los histogramas) y calcular el percentil al final.' },
          { t: 'p', html: `En Prometheus eso significa: exporta un <b>histograma</b> (conteos por bucket), suma los buckets de todos los pods y recién después calcula el cuantil. Es la alerta de p99 del caso 1:` },
          { t: 'code', title: 'p99 agregado y fracción bajo el SLO (PromQL)', files: [
            { name: 'latencia.promql', lang: 'promql', code: PROMQL },
          ] },
          { t: 'list', items: [
            `<b>Summary vs Histogram.</b> Un <code>Summary</code> de Prometheus calcula los cuantiles dentro de cada proceso y no se puede agregar entre pods. Un <code>Histogram</code> exporta conteos por bucket, que sí se suman. Para la latencia de un servicio con varias réplicas, histograma.`,
            `<b>Los buckets deciden la precisión.</b> <code>histogram_quantile</code> interpola dentro del bucket: con buckets de 0.1, 0.5 y 1 s, un p99 "de 300 ms" puede ser cualquier cosa entre 100 y 500 ms. Pon buckets densos alrededor del SLO y uno exactamente en él: el gateway de c01 usa 0.15, 0.2 y 0.3 s.`,
            `<b>Tampoco se promedian en el tiempo.</b> El p99 del día no es el promedio de los 24 p99 horarios: la hora pico tiene más requests y pesa más. Calcula sobre la ventana completa con los buckets, o usa la fracción de requests bajo el SLO, que se agrega sumando conteos.`,
          ] },
          { t: 'h3', text: 'Dónde mides cambia el número' },
          { t: 'table', head: ['Punto de medición', 'Incluye', 'No incluye', 'Para qué sirve'], rows: [
            ['Cliente (la app, el backend que llama)', 'Red, TLS, el pool de conexiones del cliente y tu servicio', '—', 'Lo que siente quien espera; se reporta desde el cliente'],
            ['Balanceador (p. ej. <code>TargetResponseTime</code> del ALB)', 'Tu servicio visto desde el balanceador', 'La red del cliente y la subida de la foto', 'Contrastar con tu histograma; ver si un target está lento'],
            ['Histograma del gateway', 'Lectura del body, preproceso, llamada a Triton, respuesta', 'Lo que pasa antes de que el proceso acepte el request', 'El SLI del SLO de c01: p99 ≤ 200 ms server-side'],
            ['Métricas de Triton', 'Espera en la cola del batcher y cómputo en GPU, por separado', 'Red y preproceso', 'Diagnóstico: ¿GPU saturada o es otra cosa?'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Medir el servidor y prometerle al cliente', html: `<p>Tu histograma dice p99 = 120 ms y el equipo de la app ve 900 ms. No hay contradicción: la subida por 4G, el TLS del celular y el backend de publicación no están en tu histograma. Por eso c01 define el SLO server-side y el caller tiene su propio timeout. Cada vez que des un número de latencia, di dónde se mide.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Our SLO is a p99 of 200 ms, measured server-side at the gateway. I'd compute it from a histogram aggregated across pods, never by averaging per-pod percentiles."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Qué alertas se construyen con estas métricas (umbral, ventana, a quién despiertan) está en <a href="#m12">M12</a>; SLOs y error budgets, en <a href="#m15">M15</a>. Las alertas reales del caso 1 están en sus <a href="#c01.archivos">archivos de referencia</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'presupuesto',
        title: 'Presupuesto de latencia end-to-end',
        titleEn: 'End-to-end latency budget',
        priority: 'core',
        dims: ['estimaciones', 'arquitectura'],
        blocks: [
          { t: 'p', html: `Un SLO end-to-end no se cumple solo: se reparte. El presupuesto de latencia es la tabla que dice cuánto puede gastar cada tramo del camino de un request, y sirve para decidir dónde vale la pena optimizar y dónde no. Se hace antes de elegir tecnología: si el decode de una foto puede comerse 50 ms, lo quieres saber antes de prometer 100 ms.` },
          { t: 'diagram', id: 'presupuesto-c01', title: 'El camino de un request del caso 1: tiempo, timeouts y medición', caption: 'Azul: el request. Violeta: dónde se mide. Toca cada caja para ver su parte del presupuesto y recorre los tres flujos: el request típico, qué pasa cuando Triton se pone lento y dónde se mide cada cosa.', spec: PRESUPUESTO },
          { t: 'table', caption: 'Presupuesto del caso 1 agrupado por tier (valores típicos a medir, no benchmarks)', head: ['Tier', 'Tramos', 'p50', 'p99', 'Qué lo mueve'], rows: [
            ['Entrada', 'ALB + lectura del body', est('2–6 ms'), est('15–40 ms'), 'Tamaño del body: 200 KB del celular vs hasta 10 MB de la web'],
            ['Preproceso en CPU', 'Decode + resize + crop + normalización', est('6–13 ms'), est('27–52 ms'), 'Megapíxeles de la foto; draft mode de JPEG'],
            ['Triton', 'Hop de red + cola de batching + cómputo en GPU', est('5–12 ms'), est('15–27 ms'), 'Carga de la GPU, tamaño del batch'],
            ['Salida y overhead', 'Postproceso, JSON y log + overhead de Python', est('6–11 ms'), est('12–33 ms'), 'Pausas del proceso, contención del event loop'],
            ['<b>Total</b>', '', est('≈ 20–45 ms'), est('≈ 150 ms (suma pesimista)'), 'SLO p99 ≤ 200 ms: ≈ 50 ms de margen'],
          ], note: 'La tabla fila por fila, con cada tramo, está en <a href="#c01.estimaciones">c01, estimaciones</a>.' },
          { t: 'p', html: `Léela así: el cómputo en la GPU, que es "el modelo", son ${est('8–15 ms')} de un p99 pesimista de ≈ 150 ms: un décimo o menos. La mayor parte del presupuesto se va en mover y preparar bytes en CPU. Es lo normal en visión online con modelos medianos, y es la razón por la que optimizar el modelo rara vez es la primera palanca.` },
          { t: 'h3', text: 'Por qué los p99 de los tramos no se suman' },
          { t: 'p', html: `Dos tramos, A y B, independientes. Cada uno responde en 10 ms el 98 % de las veces y en 100 ms el 2 % restante: el p99 de cada uno es 100 ms y la suma de los p99 da 200 ms.` },
          { t: 'calc', title: 'Dos tramos independientes con p99 = 100 ms cada uno', rows: [
            { label: 'Los dos rápidos', expr: '0.98 × 0.98', value: '96.04 % → 20 ms' },
            { label: 'Uno lento', expr: '2 × 0.98 × 0.02', value: '3.92 % → 110 ms' },
            { label: 'Los dos lentos', expr: '0.02 × 0.02', value: '0.04 % → 200 ms' },
            { label: 'p99 end-to-end', expr: '96.04 % &lt; 99 % ≤ 96.04 % + 3.92 %', value: '110 ms' },
          ], result: 'La suma de los p99 (200 ms) sobrestima el p99 real (110 ms) porque es raro que los dos tramos tengan su peor caso en el mismo request. Si estuvieran perfectamente correlacionados (la misma foto gigante hace lento el body, el decode y el overhead de Python), la suma sería exacta.' },
          { t: 'p', html: `Y ni siquiera es una cota: si A y B tienen cada uno un 0.9 % de requests lentos de 100 ms, en requests distintos, el p99 de cada tramo es 10 ms (suma: 20 ms), pero el 1.8 % de los requests tarda 110 ms, así que el p99 end-to-end es 110 ms. Conclusión práctica: la suma de los p99 sirve para <b>repartir</b> el presupuesto (y en sistemas reales, con tramos correlacionados, suele quedar cerca); el cumplimiento se <b>mide</b> end-to-end con el histograma.` },
          { t: 'h3', text: 'Dónde recortar cuando no te alcanza' },
          { t: 'table', head: ['Palanca', 'Qué recorta', 'Precio', 'En c01'], rows: [
            ['Paralelizar lo independiente', 'La suma se vuelve el máximo: leer features del vendedor mientras decodificas la foto', 'Código concurrente; más fan-out, más cola (§2)', 'No aplica: un solo input, pasos en serie'],
            ['Sacar trabajo del camino del request', 'Lo que el caller no necesita para seguir: logs, métricas, thumbnails, notificaciones', 'Consistencia eventual; una cola que operar (<a href="#m02.asincrona-colas">M2</a>)', 'El log de predicción es asíncrono (stdout → Fluent Bit)'],
            ['Precomputar', 'Lo que se puede calcular antes de que llegue el request: embeddings del catálogo, agregados', 'Almacenamiento y frescura (<a href="#m02.batch">M2</a>)', 'No aplica al request; sí al backfill de 200 M'],
            ['Cache', 'Requests repetidos: la misma foto subida otra vez (hash → predicción)', 'Solo con hit rate real; invalidar al cambiar de modelo', 'Posible, con hash + <code>model_version</code> como clave; mide el hit rate primero'],
            ['Reducir bytes', 'Lectura del body, decode, red entre tiers', 'Cambios en el cliente o reexportar el modelo', 'La app reduce a ≤ 1024 px; entrada UINT8 cuando crezca'],
            ['Modelo más barato (FP16, INT8, destilación)', 'Cómputo en GPU o CPU', 'Validar calidad con parity test y golden set (<a href="#m08">M8</a>)', 'Ya en FP16; INT8 no hace falta con la GPU al ≈ 5 % en promedio'],
            ['Colocar (misma zona, mismo pod)', 'Saltos de red y transferencia entre zonas', 'Acopla el escalado de los tiers', 'Ruteo por zona (<code>trafficDistribution: PreferSameZone</code>)'],
            ['Cortar la cola con timeouts', 'No baja la latencia: convierte un request lento en un fallback rápido', 'Ese request se pierde; necesitas un fallback', 'Deadline de 250 ms → 504 → selector manual'],
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Antes de optimizar, averigua en qué tramo está la cola. El gateway de c01 exporta dos histogramas separados: <code>classifier_preprocess_seconds</code> (CPU) y <code>classifier_inference_seconds</code> (ida y vuelta a Triton). Si el p99 end-to-end sube y solo se mueve el primero, comprar GPUs no arregla nada.</p>` },
          { t: 'h3', text: 'Deadline propagation: cada salto hereda lo que queda' },
          { t: 'p', html: `Un timeout por salto elegido al azar produce trabajo zombi: el caller ya se rindió y el servidor sigue gastando GPU en una respuesta que nadie va a leer. La regla: cada nivel tiene un timeout <b>menor</b> que el tiempo que le queda a quien lo llamó, con margen para devolver un error limpio. En c01:` },
          { t: 'table', head: ['Nivel', 'Timeout', 'Por qué ese valor'], rows: [
            ['Caller (backend de publicación)', '300 ms', 'Techo: después, la UI muestra el selector manual'],
            ['Gateway: deadline total del request', '250 ms (<code>REQUEST_DEADLINE_S</code>)', '50 ms antes que el caller: alcanza a responder 504 antes de que el caller abandone'],
            ['Gateway → Triton', '150 ms (<code>INFER_TIMEOUT_S</code>)', 'Lo que queda después del peor preproceso razonable; si Triton tarda más, ya no se cumple'],
            ['Cola de Triton', '100 ms (<code>default_queue_policy</code> con REJECT)', 'Un request que esperó 100 ms en cola no va a llegar a tiempo: mejor rechazarlo que gastar GPU'],
          ], note: 'El deadline no es el SLO. El SLO dice qué fracción de requests tiene que ser rápida (99 % bajo 200 ms); el deadline dice cuándo dejar de trabajar en un request porque ya no le sirve a nadie.' },
          { t: 'p', html: `Con gRPC, el deadline viaja en cada llamada (header <code>grpc-timeout</code>) y, si el servidor usa el contexto del request entrante para hacer sus propias llamadas (como es idiomático en Go o Java), se propaga solo. Con HTTP lo haces tú: calculas el tiempo restante al inicio y cada etapa usa <code>min(su timeout, lo que queda)</code>, como el gateway de referencia de c01 (<a href="#c01.archivos">archivos</a>). Si hubiera más saltos (un servicio de features, un reranker), el tiempo restante viajaría en un header.` },
          { t: 'callout', kind: 'interview', html: `<p>"Every hop gets a timeout shorter than what's left of its caller's budget: 300 ms at the caller, a 250 ms deadline in the gateway, 150 ms for the call to Triton, and Triton drops anything that has waited 100 ms in its queue. Nobody keeps working on a request that has already been abandoned."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Si el entrevistador pregunta "¿y si pido p99 ≤ 50 ms?", este presupuesto te da la respuesta: el preproceso de fotos grandes ya no cabe, y las salidas son reducir en el cliente, cambiar de patrón o de hardware. Patrones en <a href="#m02.tabla-decision">M2</a>; hardware en <a href="#m04.cpu-gpu-tpu">M4</a>.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'trafico',
        title: 'QPS promedio, pico y de diseño',
        titleEn: 'Average, peak and design QPS',
        priority: 'core',
        dims: ['aclaracion', 'estimaciones'],
        blocks: [
          { t: 'p', html: `El throughput que tienes que soportar no es un número sino tres: el <b>promedio</b> paga la factura, el <b>pico</b> dimensiona y el <b>pico de diseño</b> es el pico más un margen que decides tú. La cadena del caso 1, que ya viste en M1:` },
          { t: 'calc', title: 'De volumen diario a pico de diseño (c01)', rows: [
            { label: 'Volumen', expr: 'dato del enunciado', value: '10 M img/día' },
            { label: 'Promedio', expr: '10,000,000 / 86,400 s', value: '≈ 116 req/s' },
            { label: 'Pico diurno', expr: '116 × 3', value: est('≈ 350 req/s'), note: 'factor 3× supuesto; se confirma con los logs del backend' },
            { label: 'Pico de diseño', expr: '350 × ≈ 1.4 (spikes, crecimiento)', value: '500 req/s' },
          ], result: 'Diseñas para <b>500 req/s</b>. Pagas, en promedio, por 116.' },
          { t: 'h3', text: 'De dónde sale cada factor' },
          { t: 'table', head: ['Factor', 'Valor típico', 'De dónde sale', 'Cómo lo defiendes'], rows: [
            ['Diurno (pico / promedio)', est('2–5×'), 'La gente duerme: en una sola zona horaria el valle nocturno es profundo', 'Si 1/8 del tráfico diario cae en la hora pico, el pico es 24 × 1/8 = 3× el promedio'],
            ['Semanal', est('1.2–2×') + ' entre el mejor y el peor día', 'Fines de semana, lunes, quincenas', 'Dimensiona con el peor día, no con el promedio de la semana'],
            ['Estacional y eventos', est('2–10×') + ' sobre un pico normal', 'Buen Fin, Hot Sale, Black Friday, Navidad, un lanzamiento', 'Pide el histórico del evento anterior; si no existe, dilo y planea escalado programado'],
            ['Bursts dentro del segundo', 'Ventanas de 10–100 ms muy por encima de la tasa del segundo', 'Llegadas aleatorias, crons a la hora en punto, reintentos sincronizados, push notifications', 'Los absorben la cola y el headroom, no el autoscaler'],
            ['Margen de diseño', est('1.3–1.5×'), 'Spikes que no conoces + el error de tu estimación', 'Un número redondo y defendible: 350 → 500'],
            ['Crecimiento', 'lo que diga producto', 'Usuarios nuevos, otro país, un caller nuevo', 'Diseña para 6–12 meses; la arquitectura debe aguantar 10× sin rediseño (el hardware sí cambia)'],
          ] },
          { t: 'p', html: `El truco de "24 × fracción" sirve para defender tu supuesto con una frase: "asumo que la hora pico lleva ≈ 12 % del tráfico del día; eso es ≈ 3× el promedio". Con 10 % serían 2.4×; con 20 %, 4.8×.` },
          { t: 'h3', text: 'Bursts: lo que el dashboard no ve' },
          { t: 'p', html: `500 req/s medidos por minuto no son 5 requests cada 10 ms. Con llegadas aleatorias (Poisson, el modelo estándar para muchos usuarios independientes), en ventanas de 10 ms llegan 5 en promedio con una desviación de ≈ 2.2, y ≈ 3 % de esas ventanas trae 10 o más: el doble de la tasa promedio durante 10 ms. A eso súmale lo que no es aleatorio: un cron que dispara a las 12:00:00, clientes que reintentan al mismo tiempo. Prometheus hace scrape cada 15–30 s y las gráficas promedian por minuto: ninguna muestra esos bursts, pero la cola del batcher sí los siente. Por eso el headroom no se decide mirando la gráfica de QPS por minuto.` },
          { t: 'h3', text: 'Dos contrastes' },
          { t: 'p', html: `<b>Tráfico plano.</b> El equipo de moderación llama tu API desde un job que procesa una cola a ritmo constante, las 24 horas: 2 M imágenes al día.` },
          { t: 'calc', title: 'API interna con tráfico plano', rows: [
            { label: 'Promedio', expr: '2,000,000 / 86,400 s', value: '≈ 23 req/s' },
            { label: 'Pico', expr: 'el job no tiene hora pico', value: '≈ 23 req/s (1×)' },
            { label: 'Diseño', expr: '23 × 1.3 de margen', value: '≈ 30 req/s' },
          ], result: 'Aquí el promedio sí sirve para dimensionar. Y la pregunta de diseño cambia: si nadie espera la respuesta, ¿por qué es una llamada síncrona? Probablemente le conviene un endpoint batch o una cola (<a href="#m02.batch">M2</a>), fuera del camino del formulario.' },
          { t: 'p', html: `<b>Un evento en vivo.</b> Marketing manda una push notification del Hot Sale a 5 M usuarios, y una parte abre la app y publica algo en el primer minuto.` },
          { t: 'calc', title: 'Spike de una push notification (ilustrativo)', rows: [
            { label: 'Usuarios notificados', expr: 'dato de marketing', value: '5 M' },
            { label: 'Suben una foto en el primer minuto', expr: '5 M × ' + est('≈ 2 %'), value: '100,000 requests' },
            { label: 'Tasa durante ese minuto', expr: '100,000 / 60 s', value: '≈ 1,670 req/s' },
            { label: 'Contra el pico diario', expr: '1,670 / 350', value: '≈ 4.8×' },
            { label: 'Las 2 T4 de c01', expr: '1,670 / (2 × 1,200)', value: est('≈ 70 % del máximo medido') },
            { label: 'CPU del gateway', expr: '1,670 × ' + est('≈ 6 ms'), value: '≈ 10 cores contra 8 vCPU provisionados' },
            { label: 'Red gateway → Triton (FP32)', expr: '1,670 × 602 KB', value: '≈ 8 Gb/s' },
          ], result: 'Las dos GPUs, planeadas al 50 %, absorberían el spike con la p99 más alta; lo que se satura primero es el gateway: su CPU y su red. El cuello de botella cambia de tier según la forma de la carga, y por eso cada tier se dimensiona por separado. Y como el spike dura menos de lo que tarda en llegar un nodo nuevo, la respuesta es preparar capacidad antes (escalado programado, coordinado con quien manda la push) y degradar con gracia lo que sobre (load shedding + fallback).' },
          { t: 'callout', kind: 'trap', title: 'Dimensionar para el promedio', html: `<p>El error más común de esta sección: dimensionar con el promedio sin mirar el pico. En c01, el gateway a 116 req/s ocupa ≈ 0.7 cores (116 × ${est('≈ 6 ms')} de CPU); si provisionas 1 vCPU "porque sobra", a las 8 p. m. llegan 350 req/s (≈ 2.1 cores), el threadpool se satura y el p99 explota. (La GPU no sirve de ejemplo: una T4 aguanta 350 req/s al ≈ 29 % de su máximo medido; por eso c01 necesita una sola por throughput.) El error opuesto también existe: dimensionar para el peor evento del año y pagarlo los 365 días. La respuesta senior separa tres cosas: capacidad base para el pico de diseño, escalado programado para los eventos conocidos, y load shedding con fallback para lo que no conoces.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>Pregunta por los eventos, no solo por el pico diario: "¿hay campañas o push notifications que concentren tráfico?". En un marketplace de Latinoamérica, un Buen Fin o un Hot Sale puede cambiar el diseño más que el patrón diario, y la pregunta muestra que piensas en cómo se usa el producto.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I don't have the traffic shape, so I'll assume a 3x diurnal peak (roughly 12% of daily traffic in the busiest hour) plus about 40% headroom for spikes and growth. That gives a design peak of 500 requests per second. If you have real numbers, I'll redo it."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>La pregunta de escala está en el banco de <a href="#m01.preguntas-aclaracion">preguntas de aclaración</a> de M1; aquí aprendiste a convertir su respuesta en un número de diseño. Cómo escalar entre el valle y el pico (HPA, KEDA, escalado programado, cold start de nodos GPU) está en <a href="#m06">M6</a>.</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'little',
        title: 'Little\'s law: la cuenta que ordena todo',
        titleEn: 'Little\'s law',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'p', html: `Si recuerdas una sola fórmula de este módulo, que sea esta. Primero el número: al gateway entran 500 req/s y cada uno tarda en promedio ${est('50 ms')}; ¿cuántos hay adentro en un instante cualquiera? 500 × 0.05 = 25. Eso es Little's law:` },
          { t: 'kv', items: [
            ['L = λ · W', 'en vuelo = tasa de llegada × tiempo promedio adentro', 'vale para cualquier "caja" en régimen estable: el servicio entero, una cola, un pool'],
          ] },
          { t: 'list', items: [
            `<b>L</b>: número promedio de requests dentro de la caja (en cola + en proceso).`,
            `<b>λ</b>: tasa de llegada. En régimen estable, cuando no se acumula cola, es igual al throughput.`,
            `<b>W</b>: tiempo <b>promedio</b> que pasa cada request dentro de la caja. Promedio, no p99.`,
          ] },
          { t: 'p', html: `No hace ningún supuesto sobre cómo llegan los requests ni cuánto tarda cada uno: por eso sirve en cualquier parte. Tres usos concretos, todos con números del caso 1.` },
          { t: 'calc', title: 'Uso 1: requests en vuelo en el gateway', rows: [
            { label: 'Todo el servicio', expr: '500 req/s × 0.05 s', value: '25 en vuelo' },
            { label: 'Por pod, con 5 pods en el pico', expr: '100 req/s × 0.05 s', value: '5 en vuelo' },
            { label: 'Si la latencia media sube a 200 ms', expr: '100 req/s × 0.2 s', value: '20 en vuelo por pod' },
          ], result: 'Así se dimensiona el load shedding de c01: <code>MAX_INFLIGHT</code> ≈ lo que un pod completa en ≈ 200 ms (≈ 20), recortado a 16 por RAM (16 bodies de hasta 10 MB). En el pico normal hay ≈ 3–5 en vuelo por pod; si alguna vez hay 16, algo va lento, y aceptar más solo alarga la cola.' },
          { t: 'calc', title: 'Uso 2: cuánta concurrencia necesita el model server', rows: [
            { label: 'Llegadas por GPU en el pico de diseño', expr: '500 / 2', value: '250 req/s' },
            { label: 'Tiempo promedio dentro de Triton', expr: 'cola de batching + copia + cómputo', value: est('≈ 8 ms') },
            { label: 'Requests dentro de Triton', expr: '250 × 0.008', value: '≈ 2' },
          ], result: 'Con ≈ 2 requests adentro en promedio, una sola instancia del modelo haría que uno espere al otro o que se junten en un batch; dos instancias (<code>instance_group</code> con count 2, como en c01) dejan solapar la copia de un batch con el cómputo del otro. Ocho instancias no ayudarían: habría más instancias que requests. Los 8 ms son un supuesto; el count definitivo lo elige <code>model_analyzer</code> barriendo configuraciones.' },
          { t: 'calc', title: 'Uso 3: pools de conexiones y threads', rows: [
            { label: 'Llamadas simultáneas a Triton (normal)', expr: '500 req/s × ' + est('≈ 10 ms') + ' de ida y vuelta', value: '≈ 5 en todo el servicio' },
            { label: 'Si Triton se frena hasta el timeout', expr: '500 req/s × 0.15 s', value: '75 (≈ 15 por pod con 5 pods)' },
            { label: 'Threads de CPU ocupados en preproceso', expr: '500 req/s × ' + est('≈ 6 ms'), value: '≈ 3 (≈ 3 cores)' },
          ], result: 'El pool de conexiones a Triton se dimensiona para el caso malo acotado por el timeout, no para el promedio: en condiciones normales hay 5 llamadas abiertas, pero si Triton se frena, el pool tiene que aguantar las que el timeout permite o empezar a rechazar (<code>MAX_INFLIGHT</code> ya lo acota a 16 por pod). Y la última fila: aplicado a la CPU, Little da la utilización (tasa × tiempo de servicio = cores ocupados). Es la misma cuenta de "≈ 3 cores" del caso 1.' },
          { t: 'p', html: `Una cuenta vecina que <b>no</b> es Little sino balance de flujo: si se acumuló un backlog, tiempo de vaciado = backlog / (capacidad máxima − llegadas). La cola se vacía a la capacidad máxima del consumidor, no a la planeada, y por eso el headroom también es velocidad de recuperación. En c01 no aplica, porque los requests vencen y caen al fallback; el ejemplo con números (60,000 jobs: 400 s con 4× de capacidad, 100 min con 1.2×) está en la <a href="#m02.asincrona-colas">cola de jobs de M2</a>.` },
          { t: 'callout', kind: 'trap', title: 'Meter el p99 en Little', html: `<p>λ × p99 no es "la concurrencia en el peor caso": es una cuenta sin significado, porque Little habla de promedios. Para dimensionar pools y límites contra el caso malo, usa un tope explícito (λ × timeout, como en el uso 3) o mide la distribución de requests en vuelo con una métrica de tipo gauge (un valor que sube y baja). Y la trampa inversa: si tomas la latencia media de un momento tranquilo, subdimensionas justo cuando la latencia sube.</p>` },
          { t: 'callout', kind: 'note', title: 'También funciona al revés', html: `<p>Si mides 40 requests en vuelo y entran 500 req/s, la latencia media es 40 / 500 = 80 ms, sin instrumentar la latencia. Sirve como chequeo cruzado de tus métricas: si el histograma dice otra cosa, una de las dos está mal.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>En LLMs la misma cuenta se hace con secuencias. Con números ilustrativos, 5 req/s × 20 s por respuesta generada = 100 secuencias en vuelo, y cada una ocupa KV cache en la VRAM. Esa cuenta decide cuántas GPUs necesitas para servir un LLM (<a href="#m14">M14</a>, <a href="#c10">c10</a>).</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'colas-utilizacion',
        title: 'Utilización y colas: por qué no se planea al 100 %',
        titleEn: 'Utilization and queueing',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `La <b>utilización</b> (ρ) es la fracción del tiempo en que un servidor está ocupado: ρ = tasa de llegada / capacidad. Con 500 req/s sobre una capacidad de 1,000, ρ = 0.5. La intuición dice que al 90 % todavía queda un 10 % libre y todo va bien. La teoría de colas dice otra cosa: la espera no crece en línea recta con ρ, crece como ρ / (1 − ρ) (la espera en cola; el tiempo total, como 1 / (1 − ρ)), y se dispara cuando ρ se acerca a 1.` },
          { t: 'p', html: `El modelo más simple, <b>M/M/1</b> (llegadas aleatorias tipo Poisson, tiempos de servicio exponenciales, un servidor y una cola FIFO), da el tiempo promedio en el sistema:` },
          { t: 'kv', items: [
            ['W = S / (1 − ρ)', 'tiempo en el sistema = tiempo de servicio / (1 − utilización)', 'W<sub>q</sub> = W − S = ρS / (1 − ρ) es la espera en cola'],
          ] },
          { t: 'table', caption: 'M/M/1 con tiempo de servicio S = 10 ms', head: ['ρ', 'W (promedio)', 'Espera W<sub>q</sub>', 'p99 en M/M/1', 'Lectura'], rows: [
            ['0.5', '20 ms', '10 ms', '≈ 92 ms', 'La espera ya iguala al servicio'],
            ['0.7', '≈ 33 ms', '≈ 23 ms', '≈ 154 ms', 'Zona típica de planeación para online'],
            ['0.8', '50 ms', '40 ms', '≈ 230 ms', 'El p99 ya pasaría un SLO de 200 ms'],
            ['0.9', '100 ms', '90 ms', '≈ 461 ms', 'De 0.5 a 0.9, la espera se multiplica por 9'],
            ['0.95', '200 ms', '190 ms', '≈ 921 ms', 'Cualquier burst te saca del SLO'],
          ], note: 'En M/M/1 el tiempo en el sistema sigue una exponencial, así que p99 = W × ln(100) ≈ 4.6 × W. Es un modelo, no una ley: tus llegadas no son exactamente Poisson, el servicio de una GPU es mucho más regular que una exponencial y Triton con batching no es un servidor FIFO simple. Lo que sí se conserva en la práctica es la forma: plana hasta cierto punto y después, un palo de hockey. Úsalo para argumentar; para dimensionar, mide el codo.' },
          { t: 'callout', kind: 'why', title: 'Por qué la curva se dobla', html: `<p>Con ρ = 0.5, cuando llega un burst, el servidor tiene la mitad del tiempo libre para vaciar la cola que se formó. Con ρ = 0.9 solo tiene un 10 %: cada burst deja una cola que tarda en vaciarse, y el siguiente burst llega antes de que termine. La espera no la causa la carga promedio sino la <b>variabilidad</b> (de llegadas y de servicio) combinada con poco tiempo libre para absorberla.</p>` },
          { t: 'h3', text: 'Dos cosas que aplanan la curva' },
          { t: 'p', html: `<b>Menos variabilidad.</b> Si el tiempo de servicio es casi constante, la espera promedio se reduce a la mitad: en el modelo M/D/1 (servicio determinístico), W<sub>q</sub> = ρS / (2(1 − ρ)). A ρ = 0.9 y S = 10 ms son 45 ms de espera en vez de 90. Una GPU corriendo el mismo engine con el mismo shape se parece más a ese caso que a la exponencial. Lo que agrega variabilidad (fotos de 200 KB mezcladas con fotos de 12 MP, batches de tamaño variable, pausas de GC) te empuja de vuelta hacia el peor caso.` },
          { t: 'p', html: `<b>Pooling: una cola para varios servidores.</b> Dos GPUs con una cola compartida esperan mucho menos que dos GPUs con una cola cada una, a la misma utilización:` },
          { t: 'table', head: ['Configuración (S = 10 ms, ρ = 0.8 por servidor)', 'Espera promedio W<sub>q</sub>', 'Tiempo en el sistema W'], rows: [
            ['2 servidores, cada uno con su cola (2 × M/M/1)', '40 ms', '50 ms'],
            ['2 servidores, una cola compartida (M/M/2)', '≈ 18 ms', '≈ 28 ms'],
            ['4 servidores, una cola compartida (M/M/4)', '≈ 7.5 ms', '≈ 17.5 ms'],
          ], note: 'Con una cola compartida, nadie espera detrás de un servidor ocupado mientras otro está libre. Valores de la fórmula de Erlang C; no hace falta memorizarla.' },
          { t: 'p', html: `En la práctica, "una cola compartida" es un balanceador que manda cada request al servidor menos ocupado: el algoritmo <i>least outstanding requests</i> del ALB, o un balanceador L7 que mira requests en vuelo. El reparto de un Service de Kubernetes (aleatorio en el modo iptables de kube-proxy, el más común) se parece más a colas separadas: un pod puede tener cola mientras otro está ocioso. La misma idea explica por qué un pool grande de réplicas aguanta mejor la misma utilización que un pool chico.` },
          { t: 'callout', kind: 'skip', html: `<p>No memorices Erlang C, la fórmula de Kingman ni la notación de Kendall. En la entrevista basta con la forma de la curva, W = S / (1 − ρ) para poner un número, y sus dos consecuencias: headroom y pooling. Si te preguntan más que eso, estás en una entrevista de performance engineering, no de ML Engineer.</p>` },
          { t: 'h3', text: 'Headroom es protección, no desperdicio' },
          { t: 'p', html: `Por eso en serving online sensible a latencia se planea a ${est('≈ 50–70 %')} de la capacidad medida, mientras que un job batch offline trabaja cerca del 100 % (ahí solo importa terminar, no cuánto espera cada ítem). El headroom paga cuatro cosas a la vez:` },
          { t: 'list', items: [
            `<b>La p99:</b> lejos del codo de la curva, un burst no se convierte en cola.`,
            `<b>La caída de una réplica o de una zona:</b> su carga se reparte en las demás.`,
            `<b>El tiempo de reacción del autoscaler:</b> un nodo GPU nuevo tarda minutos (<a href="#c01.serving">c01</a>).`,
            `<b>El error de tu medición:</b> el máximo que mediste no es el de producción (otra mezcla de imágenes, clocks más bajos bajo carga sostenida).`,
          ] },
          { t: 'calc', title: 'Qué significa planear al 50 % en c01', rows: [
            { label: 'Máximo medido por T4, al SLO', expr: 'perf_analyzer', value: est('≈ 1,200 img/s') },
            { label: 'Capacidad planeada', expr: '1,200 × 0.5', value: '600 img/s' },
            { label: 'Carga por GPU en el pico de diseño (2 GPUs)', expr: '250 / 1,200', value: '≈ 21 % del máximo' },
            { label: 'Si cae una GPU', expr: '500 / 1,200', value: '≈ 42 % del máximo' },
            { label: 'Carga promedio', expr: '(116 / 2) / 1,200', value: '≈ 5 %' },
          ], result: 'El 50 % decide cuántas GPUs hacen falta por throughput (una); la N+1 agrega la segunda. Con las dos vivas, cada GPU trabaja lejos del codo incluso en el pico, y si cae una, la otra sigue en la parte plana de la curva.' },
          { t: 'callout', kind: 'trap', title: 'Planear con la utilización de la GPU', html: `<p><code>nv_gpu_utilization</code> (lo mismo que muestra <code>nvidia-smi</code>) mide el porcentaje del tiempo en que hubo algún kernel corriendo, no qué fracción de la capacidad usas: con batches de 1 puede marcar 30 % mientras usas el 5 % de lo que la GPU haría con batches grandes. Planea con throughput medido contra throughput máximo, y escala con una señal de saturación real, como el tiempo en cola (<a href="#m04.roofline">M4</a>, <a href="#m06">M6</a>).</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"I'd plan each GPU at about 50% of its measured capacity. In a simple queueing model the wait grows like rho over one minus rho, so going from 50% to 90% multiplies it by nine and the first burst blows the p99."</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'batching',
        title: 'Batching: throughput a cambio de latencia',
        titleEn: 'Batching: trading latency for throughput',
        priority: 'core',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Una GPU ejecuta un batch de 8 imágenes en mucho menos que 8 veces lo que tarda una sola: parte del costo es fijo por ejecución (lanzar kernels, leer los pesos de memoria, sincronizar) y, con una sola imagen, la mayoría de los núcleos queda sin trabajo. Batching es repartir ese costo fijo entre más imágenes. El precio es latencia: cada imagen espera a que se forme el batch, y el batch completo tarda más que una imagen sola.` },
          { t: 'table', caption: 'Batch vs throughput vs latencia en una T4. Números ILUSTRATIVOS, con forma realista: no son un benchmark; los tuyos se miden con perf_analyzer', head: ['Batch', 'Tiempo GPU por batch', 'Throughput máximo', 'Latencia extra vs batch 1', 'Ganancia de throughput'], rows: [
            ['1', '4 ms', '250 img/s', '—', '1×'],
            ['4', '6 ms', '≈ 670 img/s', '+2 ms', '≈ 2.7×'],
            ['8', '9 ms', '≈ 890 img/s', '+5 ms', '≈ 3.6×'],
            ['16', '15 ms', '≈ 1,070 img/s', '+11 ms', '≈ 4.3×'],
            ['32', '27 ms', '≈ 1,190 img/s', '+23 ms', '≈ 4.7×'],
          ], note: 'La latencia extra no incluye la espera para formar el batch. Rendimientos decrecientes: de 1 a 8 el throughput se multiplica por ≈ 3.6; de 8 a 32, solo por ≈ 1.3, mientras el tiempo de cómputo se triplica. La curva real depende del modelo, del engine y de la GPU; la forma, no.' },
          { t: 'h3', text: 'Estático, dinámico y los que no son batching de servidor' },
          { t: 'table', head: ['Tipo', 'Cómo funciona', 'Dónde se usa', 'Riesgo'], rows: [
            ['Estático', 'Juntas exactamente N ítems (o recorres un archivo en bloques de N)', 'Batch offline: el backfill de 200 M de c01 corre con batches llenos de 32', 'Online, con tráfico bajo, un request podría esperar mucho a que se llene el batch'],
            ['Dinámico (en el servidor)', 'El model server junta los requests que llegan dentro de una ventana: el batch sale cuando se llena (max batch size) o cuando vence la espera máxima (max queue delay)', 'Serving online en GPU: Triton, Ray Serve, BentoML', 'La ventana suma latencia a cada request que espera'],
            ['En el cliente', 'El gateway acumula imágenes y las manda juntas', 'Rara vez vale la pena online', 'Latencia y complejidad sin darle al servidor nada que no pueda hacer solo (la trampa de <a href="#c01.serving">c01</a>)'],
            ['Continuo (in-flight)', 'En generación de texto, las secuencias entran y salen del batch en cada paso de decodificación', 'LLMs: vLLM, TensorRT-LLM, SGLang', 'Otra bestia: se ve en <a href="#m14">M14</a>'],
          ] },
          { t: 'h3', text: 'El batch que se forma depende de la tasa de llegada' },
          { t: 'p', html: `El max batch size es un techo, no lo que pasa. Con dynamic batching, el tamaño real depende de cuántos requests llegan mientras el batcher espera y mientras la GPU está ocupada con el batch anterior. Con los números de c01:` },
          { t: 'calc', title: 'Tamaño de batch real a 250 req/s por GPU (c01)', rows: [
            { label: 'Llegadas durante la ventana de 2 ms', expr: '250 × 0.002', value: '0.5 requests' },
            { label: 'Llegadas mientras la GPU procesa el batch anterior', expr: '250 × ' + est('≈ 5 ms'), value: '≈ 1.25 requests' },
            { label: 'Batch promedio', expr: 'el que abrió la ventana + los que se juntaron', value: est('≈ 1–3') },
            { label: 'Tiempo para llenar un batch de 32', expr: '32 / 250 req/s', value: '128 ms' },
          ], result: 'A la carga de c01 el batching casi no hace nada: batches de 1–3. Llenar uno de 32 tardaría 128 ms, casi todo el presupuesto de p99: para eso existe el max queue delay. El batching empieza a importar en el pico, en un failover (500 req/s en una sola GPU: batches de ' + est('≈ 2–4') + ') y en el backfill offline, donde los batches de 32 se llenan al instante y el límite pasa a ser el decode y el IO (' + est('≈ 1,000 img/s') + ' por T4 en c01).' },
          { t: 'h3', text: 'Cómo se ajusta max_queue_delay contra el SLO' },
          { t: 'steps', items: [
            { title: 'Empieza sin ventana', meta: 'línea base', html: `<p>Mide throughput y p99 con perf_analyzer al QPS de diseño por GPU, con la ventana en 0 (o en unos 100 µs).</p>` },
            { title: 'Sube la ventana en pasos', meta: '0.5 → 1 → 2 → 5 ms', html: `<p>En cada paso mira dos cosas: cuánto sube el throughput máximo y cuánto sube el p99. Mientras el throughput suba y el p99 quede dentro del presupuesto del tramo, sigue.</p>` },
            { title: 'Detente en el codo', meta: 'el primer paso que no paga', html: `<p>Cuando el throughput deja de subir o el p99 se come el margen, vuelve al paso anterior. Con un presupuesto de 200 ms, 2 ms es ruido; con un SLO de 20 ms (un ranker que corre dentro de otro servicio), 5 ms sería un cuarto del presupuesto.</p>` },
            { title: 'Automatízalo', meta: 'model_analyzer', html: `<p><code>model_analyzer</code> barre instancias × max batch size (con dynamic batching activado) y te da la configuración que maximiza throughput bajo una restricción de latencia. La ventana (<code>max_queue_delay_microseconds</code>) no entra en su búsqueda automática: agrégala como barrido manual en su config. Repítelo cuando cambie el modelo o la GPU.</p>` },
          ] },
          { t: 'p', html: `Triton también acepta <code>preferred_batch_size</code> (formar batches de los tamaños en que el engine rinde mejor) y colas con prioridad (c01 las usa para que la app nunca espere detrás de un caller batch). Son ajustes de segundo orden: primero la ventana.` },
          { t: 'h3', text: 'Inputs de tamaño variable: padding y buckets' },
          { t: 'p', html: `Todos los ítems de un batch necesitan el mismo shape. Con imágenes redimensionadas a 224×224 no hay problema. Con tamaños variables (crops de texto para OCR, secuencias de tokens, imágenes con su aspect ratio original) se rellena todo al más grande (<b>padding</b>) y el cómputo del relleno se tira: si tus secuencias miden 64 tokens en promedio y rellenas el batch a 512 porque vino una larga, ≈ 87.5 % del cómputo es relleno.` },
          { t: 'p', html: `La solución es <b>bucketing</b>: agrupar por tamaño parecido (buckets de 64, 128, 256 y 512 tokens, o por resolución) y batchear dentro de cada bucket. En TensorRT, cada bucket puede tener su optimization profile (min/opt/max); en Triton, un modelo por bucket y el gateway enruta según el tamaño. El precio: más configuraciones que mantener y batches más chicos en cada bucket.` },
          { t: 'h3', text: 'En CPU, el batching rinde menos' },
          { t: 'p', html: `En CPU la ganancia suele ser mucho menor que en GPU: hay pocos núcleos que llenar y cada uno ya trabaja con una sola imagen; lo que se amortiza es sobre todo el overhead del framework. Muchas veces rinde igual o más correr batch 1 en varios procesos o threads en paralelo. Es una regla general, no un dato: mide las dos configuraciones en tu instancia, como hace el caso 1 al evaluar ResNet-50 INT8 en CPU.` },
          { t: 'callout', kind: 'trap', title: '"Activo batching y la latencia baja"', html: `<p>Solo es verdad en un caso: el sistema estaba saturado y el batching, al subir la capacidad, vació la cola. En un sistema con holgura, el batching siempre suma latencia a cada request (la ventana y un batch más lento). Di el trade-off completo.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"At our load, dynamic batching barely forms batches, one to three requests, so it costs at most the 2 ms window. I keep it because at peak or during a failover the batches grow on their own, and the GPU absorbs the extra load without scaling out."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>La configuración completa de batching e instancias en Triton, comentada línea por línea, está en los <a href="#c01.archivos">archivos del caso 1</a>; la comparación de model servers, en <a href="#m07">M7</a>; continuous batching y KV cache, en <a href="#m14">M14</a>.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'cuantas-gpus',
        title: 'Cuántas GPUs necesito',
        titleEn: 'How many GPUs do I need?',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'p', html: `La fórmula de M1 es <code>GPUs = ceil(pico / (capacidad medida × utilización objetivo)) + redundancia</code>. Aquí va el procedimiento completo, que es lo que el entrevistador quiere oír paso a paso, y dos ejemplos resueltos.` },
          { t: 'steps', items: [
            { title: 'Mide la capacidad al SLO', meta: 'el codo de la curva', html: `<p>Con perf_analyzer (o un load test end-to-end), sube la carga hasta encontrar el máximo throughput que todavía cumple el presupuesto de latencia de ese tramo, con la configuración de producción: mismo engine, misma GPU, mismo batching, inputs reales. No es el máximo absoluto: pasado el codo, el throughput apenas sube y el p99 se dispara (<a href="#m03.load-testing">§9</a>).</p>` },
            { title: 'Aplica la utilización objetivo', meta: '≈ 50–70 %', html: `<p>Capacidad planeada = medida × utilización. Más cerca del 50 % con tráfico en ráfagas y SLO apretado; más cerca del 70 % con tráfico plano y predecible (<a href="#m03.colas-utilizacion">§6</a>).</p>` },
            { title: 'Divide el pico de diseño', meta: 'ceil', html: `<p>GPUs por throughput = ceil(pico de diseño / capacidad planeada). Siempre hacia arriba.</p>` },
            { title: 'Agrega redundancia', meta: 'N+1, por zona', html: `<p>Una más, para que la caída de una no rompa el SLO. Si repartes en 2 zonas, verifica que lo que queda tras perder una zona aguante el pico, o que el fallback cubra el hueco mientras llega capacidad nueva.</p>` },
            { title: 'Agrega el excedente del rollout', meta: 'surge', html: `<p>Un rolling update con <code>maxSurge: 1</code>, o un canary con réplicas propias, necesita una GPU más durante el despliegue. Si el node group no puede crecer, el deploy se queda esperando o baja capacidad en el pico.</p>` },
            { title: 'Verifica la memoria', meta: 'VRAM', html: `<p>Pesos + activaciones al batch máximo + contexto de CUDA, por cada instancia, tienen que caber con margen (<a href="#m04.vram">M4</a>). En CNNs casi nunca es la restricción; en LLMs casi siempre.</p>` },
            { title: 'Ponle precio', meta: 'US$/mes y por predicción', html: `<p>GPUs × US$/h × 730 h, y el costo por 1,000 predicciones (<a href="#m04.costo-por-prediccion">M4</a>). Si no cabe en el presupuesto, vuelve al paso 1 con otra GPU, otra precisión u otro patrón.</p>` },
          ] },
          { t: 'calc', title: 'Ejemplo 1: el caso 1 (T4, ResNet-50)', rows: [
            { label: 'Capacidad medida al SLO', expr: 'perf_analyzer, TensorRT FP16, batch dinámico ≤ 32', value: est('≈ 1,200 img/s'), note: 'supuesto: es lo primero que mides' },
            { label: 'Capacidad planeada', expr: '1,200 × 0.5', value: '600 img/s' },
            { label: 'GPUs por throughput', expr: 'ceil(500 / 600) = ceil(0.83)', value: '1' },
            { label: 'Redundancia', expr: 'N+1, una GPU por zona', value: '2 GPUs' },
            { label: 'Con una GPU caída', expr: '500 / 1,200', value: '≈ 42 % del máximo: aguanta sola' },
            { label: 'Rollout', expr: 'maxSurge 1 → una GPU extra durante minutos', value: '3 GPUs transitorias' },
            { label: 'VRAM', expr: '2 instancias del engine + contexto CUDA', value: est('≈ 1–3 GB de 16 GB') },
            { label: 'Costo', expr: '2 × ' + est('US$0.526/h') + ' × 730 h', value: est('≈ US$768/mes') },
          ], result: '<b>Dos T4, una por zona</b>: la segunda es por disponibilidad, no por throughput. Es exactamente el número de <a href="#c01.estimaciones">c01</a>.' },
          { t: 'p', html: `<b>Ejemplo 2.</b> Un almacén con 40 cámaras a 15 fps y un detector más pesado que una ResNet-50, con entrada de 640 px (el frame 1080p se reduce antes de la inferencia). El tráfico es plano y periódico: las cámaras no duermen.` },
          { t: 'calc', title: 'Ejemplo 2: detección en tiempo real en 40 cámaras', rows: [
            { label: 'Carga', expr: '40 cámaras × 15 fps', value: '600 frames/s, 24/7' },
            { label: 'Capacidad medida por L4 al SLO', expr: 'detector a 640 px, TensorRT FP16', value: est('≈ 250 frames/s'), note: 'supuesto para el ejemplo: es lo primero que mides' },
            { label: 'Utilización objetivo', expr: 'tráfico plano y predecible', value: '70 %' },
            { label: 'Capacidad planeada', expr: '250 × 0.7', value: '175 frames/s' },
            { label: 'GPUs por throughput', expr: 'ceil(600 / 175) = ceil(3.4)', value: '4' },
            { label: 'Redundancia', expr: 'N+1', value: '5 L4' },
            { label: 'Reparto normal', expr: '40 / 5 = 8 cámaras × 15 fps', value: '120 frames/s por GPU (48 %)' },
            { label: 'Si cae una', expr: '40 / 4 = 10 cámaras × 15 fps', value: '150 frames/s por GPU (60 %)' },
            { label: 'Costo', expr: '5 × ' + est('US$0.8/h') + ' (g6.xlarge) × 730 h', value: est('≈ US$2,900/mes') },
          ], result: 'Cinco L4. Dos diferencias con c01: el tráfico plano permite planear más alto (70 % en vez de 50 %), y cada cámara se asigna a una GPU (el tracking entre frames necesita estado), así que se balancea por stream y no por request. Falta medir el decode de video y la red de 40 streams: eso es el <a href="#c02">caso 2</a>.' },
          { t: 'h3', text: 'Chequeo de cordura con FLOPs' },
          { t: 'p', html: `Antes de confiar en un número medido (o supuesto), compáralo con el techo teórico. No sirve para dimensionar; sirve para detectar un benchmark roto.` },
          { t: 'calc', title: 'ResNet-50 en una T4', rows: [
            { label: 'Cómputo por imagen', expr: '≈ 4.1 GMACs × 2 FLOPs/MAC', value: '≈ 8.2 GFLOPs' },
            { label: 'Pico de la T4 en FP16 con tensor cores', expr: 'hoja de datos de NVIDIA', value: '≈ 65 TFLOPS' },
            { label: 'Techo teórico', expr: '65 × 10<sup>12</sup> / 8.2 × 10<sup>9</sup>', value: '≈ 7,900 img/s' },
            { label: 'Medido (supuesto de c01)', expr: 'perf_analyzer', value: est('≈ 1,200 img/s') },
            { label: 'Fracción del pico', expr: '1,200 / 7,900', value: '≈ 15 %' },
          ], result: 'Quedar al ≈ 15 % del pico teórico es normal en inferencia, aun con batches de 32, donde ResNet-50 ya es compute-bound: la T4 baja clocks bajo su tope de 70 W, no todas las capas usan tensor cores, hay overhead entre kernels y algunas capas (elemento a elemento, mapas chicos) reutilizan poco cada byte que leen. Cómo razonarlo con el roofline está en <a href="#m04.roofline">M4</a>. La regla: <b>el techo teórico dice qué es imposible, no qué vas a obtener</b>. Si tu benchmark diera 10,000 img/s en una T4, está midiendo mal.' },
          { t: 'callout', kind: 'trap', title: 'Benchmarks que no predicen producción', html: `<ul>
            <li>Medir en la GPU de tu laptop o de tu escritorio: no es una T4 pasiva de 70 W en un data center, ni la misma instancia.</li>
            <li>Inputs sintéticos o diminutos: perf_analyzer manda datos aleatorios por defecto; sin imágenes reales no mides el preproceso, y con una imagen de 1 KB no mides ni la red ni el decode.</li>
            <li>Medir la GPU sola y dimensionar el sistema: en c01, a 1,200 img/s el tensor FP32 pediría ≈ 5.8 Gb/s de red, más que el ancho de banda sostenido (baseline) de la g4dn.xlarge. La tarjeta de red (NIC) limita antes que la GPU.</li>
            <li>Una prueba de un minuto: no ves la baja de clocks por temperatura ni las fugas de memoria (soak test, <a href="#m03.load-testing">§9</a>).</li>
          </ul>` },
          { t: 'callout', kind: 'estimate', html: `<p>En la entrevista no te sabes de memoria la capacidad de una GPU para tu modelo. Di un orden de magnitud, márcalo como supuesto y di cómo lo medirías: "I'll assume roughly a thousand images per second per T4 with TensorRT FP16. That's the first number I'd measure with perf_analyzer before committing to a GPU count."</p>` },
          { t: 'callout', kind: 'connect', html: `<p>¿Y con 10× el tráfico? 5,000 req/s / 600 ≈ 8.3 → 9 GPUs + N+1 ≈ 10. Con ese número ya vale la pena INT8 o una GPU más grande (<a href="#m04.gpus-nvidia">M4</a>, <a href="#m08">M8</a>), y el batching empieza a formar batches de verdad. Compartir una GPU entre varios modelos, en <a href="#m04.compartir-gpu">M4</a>.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'load-testing',
        title: 'Load testing: cómo se mide de verdad',
        titleEn: 'Load testing',
        priority: 'core',
        dims: ['estimaciones', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Cada número marcado como estimación en este curso se vuelve un número real con un load test. En la entrevista, decir cómo lo medirías vale tanto como el número.` },
          { t: 'table', caption: 'Herramientas por capa', head: ['Herramienta', 'Qué carga', 'Modelo de carga', 'Para qué la usas'], rows: [
            ['perf_analyzer', 'El model server (Triton) directo, por HTTP o gRPC', 'Concurrencia fija (cerrado) o tasa fija (<code>--request-rate-range</code>)', 'Capacidad por GPU, curva throughput–latencia, cola vs cómputo'],
            ['model_analyzer', 'Triton, usando perf_analyzer por debajo', 'Barridos de configuración (automáticos o manuales)', 'Elegir max batch size e instancias bajo una restricción de latencia; la ventana de batching, si la agregas al barrido'],
            ['Locust', 'El servicio HTTP end-to-end (gateway + Triton)', 'Usuarios virtuales en Python; cerrado por defecto', 'Escenarios realistas: mezcla de fotos, varios endpoints, lógica en Python'],
            ['k6', 'HTTP end-to-end', 'Tiene ejecutores de tasa fija (<code>constant-arrival-rate</code>): abierto', 'Pruebas en CI con umbrales: el build falla si el p99 pasa del SLO'],
            ['wrk2 / vegeta', 'HTTP, un endpoint', 'Tasa constante (abierto)', 'Latencia a una tasa exacta, sin coordinated omission'],
            ['trtexec', 'Solo el engine de TensorRT, sin servidor', 'Loop local', 'Latencia y throughput del engine aislado (<a href="#m08">M8</a>)'],
          ] },
          { t: 'h3', text: 'Carga abierta vs cerrada, y coordinated omission' },
          { t: 'p', html: `<b>Carga cerrada</b> (closed-loop): N usuarios virtuales, cada uno manda el siguiente request cuando recibe la respuesta del anterior. <b>Carga abierta</b> (open-loop): los requests llegan a una tasa fija, pase lo que pase con las respuestas. Tus usuarios reales se parecen a la abierta: un vendedor en Monterrey no espera a que termine el request de otro vendedor para subir su foto.` },
          { t: 'p', html: `El problema de la carga cerrada: cuando el servidor se frena, el generador también se frena y manda menos requests justo mientras el servidor está lento. Los momentos malos quedan sub-muestreados y los percentiles salen mejores que la realidad. Gil Tene lo llamó <b>coordinated omission</b>: el generador se "coordina" con el servidor y omite las mediciones que más importan. Un experimento mental:` },
          { t: 'calc', title: 'Prueba de 10 s a 1,000 req/s: el servidor responde en 10 ms, salvo una pausa de 1 s', rows: [
            { label: 'Cerrado: 10 usuarios × (1 / 10 ms)', expr: 'durante la pausa, los 10 están bloqueados', value: '≈ 9,000 muestras rápidas + 10 lentas' },
            { label: 'Cerrado: fracción lenta', expr: '10 / 9,010', value: '≈ 0.1 % → p99 ≈ 10 ms' },
            { label: 'Abierto: requests afectados', expr: 'durante la pausa llegan 1,000 que esperan entre 0 y 1 s', value: '≥ 1,000 de 10,000' },
            { label: 'Abierto: p99', expr: 'los 100 más lentos esperaron ≥ 0.9 s', value: 'p99 ≈ 0.9 s' },
          ], result: 'Mismo servidor, misma pausa: la prueba cerrada reporta un p99 de 10 ms y la abierta, de casi un segundo. La segunda es la que vivirían tus usuarios.' },
          { t: 'p', html: `Qué hacer: para medir la latencia a una tasa dada, usa un generador abierto (k6 con <code>constant-arrival-rate</code>, wrk2, vegeta, perf_analyzer con <code>--request-rate-range</code>). Para encontrar el throughput máximo sí sirve la carga cerrada: subes la concurrencia hasta saturar. Y si usas un generador cerrado, pon un timeout menor que el intervalo entre requests de cada usuario: así un servidor lento no frena el ritmo (es lo que hace el ejemplo de Locust más abajo).` },
          { t: 'h3', text: 'Qué hace que un load test prediga producción' },
          { t: 'list', items: [
            `<b>Warmup.</b> Descarta los primeros minutos: contexto de CUDA, carga del engine, primeras asignaciones de memoria, pools de conexiones, caches. perf_analyzer repite las mediciones hasta que se estabilizan antes de reportar.`,
            `<b>Payloads reales.</b> La distribución real de tamaños: en c01, ≈ 85 % fotos de celular de ≈ 200 KB y ≈ 15 % originales web de varios MB. Una imagen de prueba de 1 KB no ejercita ni la red ni el decode.`,
            `<b>El camino completo.</b> Una prueba contra Triton mide la GPU; una contra el gateway, a través del ALB, mide el servicio. Necesitas las dos: la primera para dimensionar GPUs, la segunda para el SLO.`,
            `<b>El mismo hardware y la misma configuración.</b> Mismo tipo de instancia, mismo engine, mismo batching, mismas réplicas, mismos límites de CPU. Tu laptop no es una g4dn.xlarge.`,
            `<b>Un generador que no sea el cuello de botella.</b> Vigila la CPU y la red del generador: si se satura, estás midiendo el generador. Locust en Python necesita varios procesos para cientos de req/s con payloads grandes.`,
            `<b>Dónde.</b> En un entorno de staging igual a producción, o en producción con tráfico sintético marcado y coordinado con los dueños. Nunca sin avisar contra un servicio compartido.`,
          ] },
          { t: 'h3', text: 'Tipos de prueba' },
          { t: 'table', head: ['Prueba', 'Forma de la carga', 'Qué encuentra', 'En c01'], rows: [
            ['Rampa (ramp)', 'Subir por escalones hasta pasar el codo', 'La capacidad al SLO: el último escalón con p99 dentro del presupuesto', 'Escalones de 100 img/s contra una T4 hasta ≈ 1,400'],
            ['Soak', 'El pico de diseño sostenido por horas', 'Fugas de memoria, baja de clocks por temperatura, discos de logs que se llenan, conexiones que se degradan', '500 req/s durante 4–8 h'],
            ['Spike', 'De la carga normal a 3–5× en segundos', 'Si el load shedding responde, si el autoscaler reacciona y cuánto tarda el cold start', 'La push notification de la <a href="#m03.trafico">sección 4</a>'],
            ['Failover', 'Pico de diseño y apagar un nodo GPU o una zona', 'Si N+1 de verdad aguanta: ¿una GPU sola con 500 req/s cumple el p99?', 'Apagar un nodo g4dn en medio de la prueba'],
          ] },
          { t: 'h3', text: 'Lo que buscas: la curva y su codo' },
          { t: 'p', html: `El resultado de una rampa es una curva throughput–latencia. Mientras hay capacidad, el throughput sigue a la carga ofrecida y la latencia casi no cambia; pasado el <b>codo</b> (knee), el throughput se aplana y la latencia se dispara, porque todo lo que sobra se va a la cola. Si la cola está acotada, como la de Triton en c01, la latencia se estanca cerca del tope y lo que se dispara son los rechazos. Una rampa contra una T4 del caso 1 se vería así:` },
          { t: 'table', caption: 'Rampa contra una T4 con perf_analyzer. Números ILUSTRATIVOS, con la forma que vas a ver', head: ['Carga ofrecida', 'Throughput logrado', 'p50', 'p99', 'Lectura'], rows: [
            ['300 img/s', '300', '6 ms', '11 ms', 'Plano'],
            ['600 img/s', '600', '7 ms', '13 ms', 'Plano: aquí planea c01 (50 %)'],
            ['900 img/s', '900', '9 ms', '17 ms', 'Empieza a curvarse'],
            ['1,200 img/s', '≈ 1,190', '14 ms', '28 ms', '<b>Codo</b>: último escalón dentro del presupuesto del tramo (≈ 30 ms)'],
            ['1,300 img/s', '≈ 1,210', '≈ 110 ms', '≈ 130 ms', 'Saturado: el throughput ya no sube; la cola llega al tope de 100 ms (espera + un batch de 32) y lo que sobra (≈ 7 %) se rechaza'],
            ['1,400 img/s', '≈ 1,210', '≈ 110 ms', '≈ 130 ms', 'Más rechazos (≈ 14 %): la política de cola de Triton corta a los 100 ms; la latencia queda acotada, los errores no'],
          ], note: 'La capacidad "medida" de c01 (≈ 1,200 img/s) es el codo, no el último número que alcanzó la prueba. Planear al 50 % pone la operación normal en la zona plana.' },
          { t: 'h3', text: 'Los comandos' },
          { t: 'code', title: 'Carga para el caso 1: GPU sola y end-to-end', caption: 'perf_analyzer mide el tier GPU; Locust mide el servicio completo a través del gateway, con la mezcla real de fotos.', files: [
            { name: 'perf_analyzer.sh', lang: 'bash', code: PERF },
            { name: 'locustfile.py', lang: 'python', code: LOCUST, note: '<code>constant_throughput(1)</code> hace que cada usuario intente 1 request por segundo: 500 usuarios, 500 req/s. Para carga abierta estricta, k6 con <code>constant-arrival-rate</code>. Locust mide del lado del cliente: su p99 incluye la red hasta el gateway y será algo mayor que el histograma server-side.' },
            { name: 'correr-locust.sh', lang: 'bash', code: LOCUST_RUN },
          ] },
          { t: 'callout', kind: 'interview', html: `<p>"Before committing to a GPU count, I'd run a ramp test with perf_analyzer against one T4 using real preprocessed images, find the knee where p99 leaves its budget, and plan at half of that. Then an end-to-end test with an open-loop generator at the design peak, a soak test for a few hours, and a failover test that kills one GPU node."</p>` },
          { t: 'callout', kind: 'skip', html: `<p>HdrHistogram, la corrección matemática de coordinated omission o escribir tu propio generador: sáltatelo. Basta con saber que existe, por qué la carga cerrada miente sobre la cola y qué herramienta usarías.</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'timeouts-reintentos',
        title: 'Timeouts, reintentos y hedging',
        titleEn: 'Timeouts, retries and hedging',
        priority: 'core',
        dims: ['arquitectura', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Un servicio lento es peor que uno caído: el caído falla rápido y el cliente pasa al fallback; el lento retiene threads, conexiones y memoria en cada salto hasta que todo el sistema se atasca. Timeouts, reintentos, hedging y load shedding son las herramientas para que la lentitud de una pieza no se propague, y todas se deciden con los números de las secciones anteriores.` },
          { t: 'h3', text: 'Jerarquía de timeouts' },
          { t: 'p', html: `Regla: cliente &gt; gateway &gt; model server, cada uno menor que lo que le queda a su caller (lo viste en la <a href="#m03.presupuesto">sección 3</a>). En c01: 300 ms en el caller, deadline de 250 ms en el gateway, 150 ms hacia Triton y 100 ms como máximo en la cola de Triton. Dos errores frecuentes:` },
          { t: 'list', items: [
            `<b>Un timeout interno mayor que el externo.</b> Gateway → Triton con 5 s cuando el caller abandona a los 300 ms: si Triton se traba, Little da 500 req/s × 5 s = 2,500 requests colgados en el gateway (≈ 500 por pod), contra 75 con el timeout de 150 ms. Cada uno ocupa una conexión, memoria y un slot, para una respuesta que nadie espera.`,
            `<b>Ningún timeout.</b> Muchos clientes HTTP esperan varios minutos, o para siempre, si no les pones uno (en Python, <code>requests</code> no tiene timeout por defecto). Cada llamada saliente lleva un timeout explícito.`,
          ] },
          { t: 'h3', text: 'Reintentos: solo si es seguro, y con presupuesto' },
          { t: 'table', head: ['Regla', 'Por qué', 'Ejemplo'], rows: [
            ['Solo operaciones idempotentes', 'Si el primer intento sí se ejecutó y solo se perdió la respuesta, repetirlo no debe cambiar el resultado', 'Clasificar una imagen es idempotente; crear una publicación o cobrar no lo son, salvo con una idempotency key (<a href="#m02.entrega-reintentos">M2</a>)'],
            ['Solo errores transitorios', 'Un 400 o un 413 va a fallar igual la segunda vez', 'Reintentar 503 y 429 (respetando <code>Retry-After</code>) y errores de conexión; nunca un 400, 413 o 415: son errores del request'],
            ['Backoff exponencial con jitter', 'Sin espera, el reintento llega cuando el servidor sigue saturado; sin jitter, todos los clientes reintentan sincronizados', 'Espera aleatoria entre 0 y 100 × 2<sup>n</sup> ms en el intento n ("full jitter", del artículo de Marc Brooker en el AWS Architecture Blog)'],
            ['Presupuesto de reintentos', 'Acota la carga extra que pueden generar', 'Como mucho ≈ 10 % de los requests pueden ser reintentos; si se pasa, no se reintenta (capítulo "Handling Overload" del SRE Book de Google)'],
            ['Dentro del deadline', 'Un reintento que no cabe en el tiempo que queda es trabajo zombi', 'Si el primer intento agotó sus 150 ms, al segundo le quedan ≈ 100 ms del deadline y el sistema probablemente sigue saturado'],
          ] },
          { t: 'h3', text: 'Retry storms: cómo una lentitud se vuelve caída' },
          { t: 'p', html: `Si cada capa reintenta por su cuenta, los reintentos se multiplican. Tres capas de llamadas (cliente → API → servicio → model server), cada una con 3 reintentos, es decir, hasta 4 intentos por llamada:` },
          { t: 'diagram', id: 'amplificacion-reintentos', title: 'Amplificación de reintentos: 4³ = 64', caption: 'Arriba, cada capa reintenta por su cuenta; abajo, una sola capa reintenta con presupuesto. Recorre los dos flujos.', spec: REINTENTOS },
          { t: 'calc', title: 'Amplificación con 3 reintentos en cada una de 3 capas', rows: [
            { label: 'Intentos que recibe la API', expr: '1 + 3', value: '4' },
            { label: 'Intentos que recibe el servicio', expr: '4 × 4', value: '16' },
            { label: 'Intentos que recibe el model server', expr: '4 × 4 × 4 = 4<sup>3</sup>', value: '64' },
            { label: 'Con una sola capa y presupuesto de 10 %', expr: '1 × 1.1', value: '≤ 1.1' },
          ], result: 'Si el model server se frena por carga, cada request del usuario puede convertirse en 64 intentos: la carga se multiplica justo cuando no hay capacidad, y el sistema no se recupera aunque la causa original desaparezca. Reintenta en <b>una</b> sola capa, con presupuesto. El SRE Book de Google elige la inmediatamente superior a la que falla, que devuelve hacia arriba un error "overloaded; don\'t retry" para que nadie más reintente; en el camino interactivo de c01 nadie reintenta (el caller cae al selector manual) y solo los callers batch reintentan una vez.' },
          { t: 'h3', text: 'Hedged requests: recortar la cola con un segundo intento' },
          { t: 'p', html: `Hedging (Dean y Barroso, <i>The Tail at Scale</i>): si un request no respondió cuando ya pasó el p95 típico, mandas una copia a otra réplica, te quedas con la primera respuesta que llegue y cancelas la otra. Solo ≈ 5 % de los requests llega a ese punto, así que cuesta ≈ 5 % de carga extra.` },
          { t: 'calc', title: 'Ejemplo: 2 % de los requests cae en una réplica que se pausa ≈ 1 s (al azar, independiente por réplica)', rows: [
            { label: 'Sin hedging', expr: '2 % de los requests tarda ≈ 1 s', value: 'p99 ≈ 1 s' },
            { label: 'Hedge a los ' + est('45 ms') + ' (≈ p95)', expr: 'se dispara en ≈ 5 % de los requests', value: '≈ +5 % de carga' },
            { label: 'Siguen lentos con hedging', expr: 'el original y la copia caen en pausa: 2 % × 2 %', value: '0.04 %' },
            { label: 'Los rescatados', expr: 'hedge a los 45 ms + ' + est('≈ 40 ms') + ' de la copia', value: '≈ 85 ms' },
          ], result: 'El p99 baja de ≈ 1 s a ≈ 85 ms o menos por ≈ 5 % más de carga. Funciona porque la lentitud es aleatoria y por réplica; si todo el servicio está lento por saturación, el hedge solo agrega carga.' },
          { t: 'table', caption: 'Cuándo no hacer hedging', head: ['Situación', 'Por qué no'], rows: [
            ['Inferencia cara en GPU cerca de saturación', '5 % más de carga en el tier más caro y más cerca del codo; si la lentitud es por saturación, el hedge la empeora'],
            ['Operaciones no idempotentes', 'Dos copias ejecutadas son dos efectos'],
            ['Lentitud compartida', 'Si la causa es común (una dependencia lenta, la misma foto gigante), la copia va a ser igual de lenta'],
            ['Sin cancelación', 'Si no puedes cancelar la copia perdedora, pagas el trabajo doble en ese 5 %'],
          ], note: 'En ML encaja en lecturas baratas y replicadas: shards de un feature store, índices de retrieval, caches.' },
          { t: 'h3', text: 'Load shedding y backpressure' },
          { t: 'p', html: `Cuando la carga supera la capacidad, algo tiene que ceder. Encolar sin límite es la peor opción: la latencia crece hasta que todo vence. Las buenas son <b>descartar</b> lo que no vas a poder atender a tiempo (load shedding: un 503 inmediato cuesta microsegundos) y <b>avisar hacia atrás</b> para que quien manda baje el ritmo (backpressure: colas acotadas, 429 o 503 con <code>Retry-After</code>, un consumer que deja de leer). En c01: <code>MAX_INFLIGHT</code> = 16 por pod → 503; cola de Triton con REJECT a los 100 ms; prioridad para la app sobre los callers batch (<a href="#c01.serving">c01</a>). En sistemas con colas, backpressure y dead-letter queues están en <a href="#m02.entrega-reintentos">M2</a>; el circuit breaker (dejar de llamar un rato a una dependencia que falla y usar el fallback directo) y el resto de los patrones de confiabilidad, en <a href="#m15">M15</a>.` },
          { t: 'callout', kind: 'trap', title: 'Reintentar un timeout en el camino interactivo', html: `<p>Un timeout casi siempre significa "el servidor está lento", no "se perdió un paquete". Reintentarlo duplica la carga del tier más cargado justo cuando está al límite, y el segundo intento tiene menos tiempo que el primero. En el camino interactivo, el fallback casi siempre es mejor respuesta que el reintento.</p>` },
          { t: 'followups', items: [
            { q: 'La p99 subió de 80 a 400 ms desde ayer. ¿Qué revisas primero?',
              junior: 'Agregaría GPUs para ver si baja. Si no, revisaría si el modelo nuevo es más lento.',
              senior: 'Primero localizo el tramo, antes de tocar nada: ¿subió <code>classifier_preprocess_seconds</code> o <code>classifier_inference_seconds</code>? Si es inferencia, en Triton separo cola de cómputo. Cola alta es saturación: ¿subió el QPS, se cayó una réplica, llegó un caller batch? Cómputo alto es un cambio en la GPU: un engine nuevo, otro shape de entrada, clocks más bajos por temperatura. Si es preproceso, miro la distribución de bytes de entrada (¿la web empezó a mandar originales de 12 MP?), CPU throttling o un event loop bloqueado. Y dos cortes que casi siempre aclaran: ¿es en todos los pods o en uno (noisy neighbor, nodo malo)? ¿coincide con un deploy? Con eso decido: escalar, revertir o limitar inputs.',
              why: 'No adivina: parte el problema con las métricas que diseñó (preproceso vs inferencia, cola vs cómputo, por pod, por deploy). Escalar a ciegas no arregla un preproceso lento ni un engine más lento, y cuesta dinero.' },
            { q: '¿Por qué no planeas las GPUs al 90 % si son tan caras?',
              junior: 'Para tener margen por si acaso.',
              senior: 'Porque la espera en cola crece como ρ / (1 − ρ): de 50 % a 90 %, la espera promedio se multiplica por 9 en el modelo simple (de 1 a 9 veces el tiempo de servicio), y el p99 sale del SLO con el primer burst. Además necesito absorber la caída de una GPU y los minutos que tarda en llegar un nodo nuevo. En c01 la cuenta termina igual: una GPU por throughput al 50 % y la segunda por N+1. Si el costo aprieta, las palancas son otras (Savings Plans, alojar otros modelos en la GPU ociosa, INT8 en CPU), no trabajar más cerca del codo.',
              why: 'Convierte "margen por si acaso" en un número con su causa, y separa el problema de costo, que tiene sus propias palancas, del de latencia.' },
            { q: 'Si Triton da timeout, ¿el gateway debería reintentar?',
              junior: 'Sí, dos o tres veces, porque la inferencia es idempotente.',
              senior: 'En el camino interactivo, no. Que sea idempotente significa que puedo reintentar sin efectos raros, no que me convenga: un timeout casi siempre significa que Triton está lento por carga, y el reintento suma carga justo ahí; además, al segundo intento le quedarían ≈ 100 ms del deadline. Respondo 504 rápido y el caller muestra el selector manual. Para callers batch sí: un reintento, con backoff exponencial y jitter, respetando <code>Retry-After</code>, dentro de un presupuesto de ≈ 10 %.',
              why: 'Distingue "puedo reintentar" de "debo reintentar", conoce el costo en carga y usa el fallback que ya existe.' },
            { q: 'perf_analyzer dio 1,200 img/s por T4, pero en producción la latencia se dispara a 700 img/s. ¿Qué pasó?',
              junior: 'Producción tiene más variabilidad; hay que agregar GPUs.',
              senior: 'El número de laboratorio no medía lo mismo que producción. Candidatos, en orden: (1) perf_analyzer corrió en la misma máquina, sin red; en producción el tensor FP32 cruza la red: a 700 img/s son ≈ 3.4 Gb/s, que caben en el baseline de la g4dn.xlarge (' + est('≈ 5 Gb/s') + ') pero no en el de los dos c6i.xlarge del gateway (' + est('≈ 1.56 Gb/s') + ' cada uno: ≈ 325 img/s por nodo, ≈ 650 entre los dos); a 1,200 img/s (≈ 5.8 Gb/s) ni la g4dn alcanzaría. (2) Datos aleatorios o de un solo tamaño, en vez de la mezcla real. (3) Una prueba corta: con carga sostenida, la T4 baja clocks. (4) Carga cerrada, que esconde la cola. (5) Otra configuración: batching, instancias, versión del engine. Lo reproduzco con carga abierta, datos reales, desde otra máquina y durante una hora, y recién ahí recalculo cuántas GPUs.',
              why: 'Trata el benchmark como un experimento con supuestos y los revisa uno por uno; conoce el límite de red que se esconde detrás del número de la GPU.' },
            { q: '¿Qué cambia si el tráfico se multiplica por 10?',
              junior: 'Diez veces más GPUs.',
              senior: 'Rehago la cuenta: 5,000 req/s / 600 planeados ≈ 8.3 → 9 GPUs por throughput, ≈ 10 con N+1, o más si cada zona tiene que aguantar sola. Pero cambian más cosas que el número. Con ≈ 500 req/s por GPU los batches crecen y la capacidad efectiva sube; vale la pena medir INT8 o una L4 y recalcular el costo por predicción. La red entre tiers pasa a ser el primer cuello (≈ 24 Gb/s de tensores FP32), así que muevo la normalización al grafo con entrada UINT8. Y el gateway en CPU pasa de ≈ 3 a ≈ 30 cores ocupados. La arquitectura aguanta; el hardware y algunas decisiones se revisan.',
              why: 'No escala linealmente sin pensar: identifica qué cuello aparece primero a otra escala (red, CPU, batching) y qué decisión se revisa.' },
            { q: '¿Usarías hedged requests hacia Triton para bajar la p99?',
              junior: 'Sí, el hedging siempre baja la latencia de cola.',
              senior: 'Hacia Triton, no. El hedging funciona cuando la lentitud es aleatoria y por réplica, y la copia es barata. Aquí la cola de un request viene de su propia foto (una imagen grande se decodifica lento en cualquier réplica, y eso pasa antes de Triton) o de la saturación, y en ninguno de los dos casos la copia ayuda: en el segundo, agrega carga al tier más caro. Lo usaría en lecturas baratas y replicadas, como un feature store o un índice de retrieval, con el hedge al p95 y cancelación de la copia perdedora.',
              why: 'Conoce la condición que hace funcionar el hedging (independencia entre réplicas) y la verifica contra la causa real de la cola en este sistema.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, relee la sección de la explicación y rehaz en voz alta las estimaciones del <a href="#c01.estimaciones">caso 1</a>.` },
          { t: 'quiz', items: [
            { q: 'Un servicio reporta una latencia promedio de 60 ms. ¿Qué puedes concluir sobre su p99?', options: ['Que es ≈ 60 ms', 'Que está por debajo de 120 ms', 'Casi nada: la única cota general es la de Markov (p99 ≤ 100 × 60 ms = 6 s), inútil en la práctica', 'Que es ≈ 4.6 × 60 ms'], answer: 2,
              explain: 'En el ejemplo de la sección 2, un promedio de ≈ 67 ms convivía con un p99 de 1.2 s. La única cota que da el promedio (Markov: como la latencia no es negativa, p99 ≤ 100 × media) no sirve en la práctica. El factor 4.6 solo vale dentro del modelo M/M/1.' },
            { q: 'Tres pods reportan p99 de 90, 110 y 600 ms. ¿Cuál es el p99 del servicio?', options: ['≈ 267 ms (el promedio)', '600 ms (el máximo)', 'No se puede saber sin las distribuciones: hay que agregar los histogramas', '110 ms (la mediana)'], answer: 2,
              explain: 'El percentil de un conjunto no es función de los percentiles de sus partes: depende de cuánto tráfico atendió cada pod y de la forma de cada distribución. Se suman los buckets (sum by le) y se calcula histogram_quantile al final.' },
            { q: 'Un request hace fan-out a 10 backends independientes y espera a todos; cada uno supera su p99 el 1 % de las veces. ¿Qué fracción de requests toca la cola?', options: ['1 %', '≈ 9.6 %', '10 %', '≈ 63 %'], answer: 1,
              explain: '1 − 0.99<sup>10</sup> ≈ 9.6 %. Con 100 backends sería ≈ 63 %.' },
            { q: 'Little\'s law: 250 req/s por GPU y ≈ 8 ms promedio dentro de Triton. ¿Cuántos requests hay dentro de Triton en promedio?', options: ['0.5', '2', '8', '31'], answer: 1,
              explain: '250 × 0.008 = 2. Por eso instance_group con count 2 es un buen punto de partida, y 8 instancias no ayudarían.' },
            { q: 'En M/M/1 con S = 10 ms, ¿qué pasa con el tiempo promedio en el sistema si la utilización sube de 50 % a 90 %?', options: ['Sube de 20 a 100 ms', 'Sube de 10 a 18 ms', 'No cambia: el tiempo de servicio es el mismo', 'Sube de 20 a 28 ms'], answer: 0,
              explain: 'W = S / (1 − ρ): 10 / 0.5 = 20 ms y 10 / 0.1 = 100 ms. La espera pasa de 10 a 90 ms: se multiplica por 9.' },
            { q: 'Con 250 req/s por GPU y max_queue_delay de 2 ms, ¿por qué el batch promedio es de 1–3 y no de 32?', options: ['Porque Triton limita el batch a 3', 'Porque en 2 ms llegan en promedio 0.5 requests: el batch depende de la tasa de llegada', 'Porque TensorRT no soporta batch 32', 'Porque cada request trae una sola imagen'], answer: 1,
              explain: 'El max batch size es un techo. A esta tasa, llenar un batch de 32 tardaría 128 ms. Los batches grandes aparecen en el pico, en un failover o en el backfill offline.' },
            { q: 'Pico de 600 frames/s, capacidad medida de 250 frames/s por GPU, utilización objetivo de 70 % y N+1. ¿Cuántas GPUs?', options: ['3', '4', '5', '6'], answer: 2,
              explain: '250 × 0.7 = 175; ceil(600 / 175) = 4; + 1 = 5.' },
            { q: 'Un load test con 10 usuarios virtuales en bucle cerrado reporta p99 = 12 ms, pero en producción hay picos de p99 de 800 ms. ¿Cuál es la explicación más probable del lado de la prueba?', options: ['El generador tiene poca CPU', 'Coordinated omission: la carga cerrada deja de mandar requests justo cuando el servidor se frena', 'Prometheus redondea los buckets', 'El modelo cambió'], answer: 1,
              explain: 'Con carga cerrada, durante una pausa del servidor solo hay 10 requests en curso y los momentos malos quedan sub-muestreados. Para latencia a una tasa dada, carga abierta.' },
            { q: 'Tres capas de llamadas reintentan 3 veces cada una. ¿Cuántos intentos puede recibir el model server por un request del usuario?', options: ['9', '12', '27', '64'], answer: 3,
              explain: '(1 + 3)<sup>3</sup> = 64. Se reintenta en una sola capa, con backoff exponencial, jitter y presupuesto.' },
          ] },
          { t: 'checklist', id: 'antes-de-estimar', items: [
            { id: 'percentil', html: 'Doy la latencia como percentil, con unidad y punto de medición ("p99 ≤ 200 ms server-side"), nunca como "rápido" ni como promedio.' },
            { id: 'no-promediar', html: 'Explico por qué los percentiles no se promedian entre pods ni entre ventanas, y cómo se agrega un histograma en Prometheus.' },
            { id: 'fanout', html: 'Calculo el efecto del fan-out con 1 − 0.99<sup>N</sup>.' },
            { id: 'presupuesto', html: 'Reparto un SLO end-to-end por tramo y digo dónde se va la mayor parte (en c01, CPU y overhead, no la GPU).' },
            { id: 'deadlines', html: 'Encadeno los timeouts de afuera hacia adentro (300 → 250 → 150 → 100 ms) y explico por qué cada uno es menor.' },
            { id: 'pico', html: 'Paso de volumen diario a promedio, pico y pico de diseño, y defiendo el factor diurno con 24 × la fracción de la hora pico.' },
            { id: 'little', html: 'Uso Little\'s law con la latencia media para dimensionar requests en vuelo, pools e instancias del modelo.' },
            { id: 'utilizacion', html: 'Explico con W = S / (1 − ρ) por qué se planea al 50–70 % y no al 100 %.' },
            { id: 'batching', html: 'Digo qué tamaño de batch se forma a mi tasa de llegada y cómo ajustaría max_queue_delay contra el SLO.' },
            { id: 'gpus', html: 'Hago en voz alta los 7 pasos de "cuántas GPUs": capacidad medida, utilización, ceil, N+1, surge del rollout, VRAM y costo.' },
            { id: 'tiers', html: 'Dimensiono por separado cada tier (CPU del gateway, red entre tiers y GPUs) y digo cuál se satura primero a mi carga y a 10×.' },
            { id: 'medir', html: 'Sé con qué herramienta mediría cada número (perf_analyzer, model_analyzer, Locust o k6) y por qué uso carga abierta para la latencia.' },
            { id: 'reintentos', html: 'Sé cuándo no reintentar, qué es un retry budget y cuándo el hedging ayuda o estorba.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm03-01', kind: 'concepto', q: 'Latencia, throughput y concurrencia: define cada uno con sus unidades y di cómo se relacionan.',
        a: 'Latencia: cuánto tarda un request (ms, como percentil y con punto de medición). Throughput: trabajo por unidad de tiempo (req/s, img/s, tokens/s). Concurrencia: requests en curso al mismo tiempo. Little: concurrencia = throughput × latencia media (500 × 0.05 = 25).' },
      { id: 'm03-02', kind: 'numero', q: '1,000 requests: 900 en 40 ms, 85 en 150 ms y 15 en 1.2 s. ¿Promedio, p50, p95 y p99?',
        a: 'Promedio ≈ 67 ms; p50 = 40 ms; p95 = 150 ms; p99 = 1.2 s. El promedio "cumple" un SLO de 200 ms y el p99 no; además, ningún request tardó 67 ms.' },
      { id: 'm03-03', kind: 'numero', q: 'Fan-out: probabilidad de que el request sea lento con N backends que superan su p99 el 1 % de las veces (N = 1, 10, 100).',
        a: '1 − 0.99<sup>N</sup>: 1 %, ≈ 9.6 %, ≈ 63.4 %. Con fan-out de 100, el p99 de cada pieza es la latencia típica del conjunto (Dean y Barroso, <i>The Tail at Scale</i>).' },
      { id: 'm03-04', kind: 'trampa', q: '¿Por qué no puedes promediar los p99 de tus pods?',
        a: 'Porque el percentil del conjunto no es función de los percentiles de las partes. Pod A: 9,900 requests con p99 de 80 ms; pod B: 200 requests a 2 s. Promedio de p99 ≈ 1 s, ponderado ≈ 118 ms, real ≈ 2 s. Suma los buckets (<code>sum by (le)</code>) y calcula <code>histogram_quantile</code> al final.' },
      { id: 'm03-05', kind: 'concepto', q: 'Summary vs Histogram en Prometheus para medir latencia.',
        a: 'Summary calcula los cuantiles dentro de cada proceso: no se agregan entre pods. Histogram exporta conteos por bucket, que se suman entre pods y ventanas. Buckets densos alrededor del SLO y uno exactamente en él (0.2 s en c01).' },
      { id: 'm03-06', kind: 'concepto', q: 'Nombra 5 causas de tail latency en serving de ML.',
        a: 'Colas por utilización alta; pausas del proceso (GC, event loop bloqueado); cold starts y caches fríos; noisy neighbors; CPU throttling por límites de CPU; espera de batching; reintentos; inputs grandes (fotos de 12 MP); retransmisiones de TCP (≈ 200 ms).' },
      { id: 'm03-07', kind: 'tradeoff', q: '¿Por qué la suma de los p99 de los tramos no es el p99 end-to-end?',
        a: 'Con tramos independientes es raro que todos tengan su peor caso en el mismo request: la suma sobrestima (dos tramos de 98 % a 10 ms y 2 % a 100 ms: suma 200 ms, real 110 ms). Con tramos correlacionados se acerca, y ni siquiera es una cota. Sirve para repartir el presupuesto; el cumplimiento se mide end-to-end.' },
      { id: 'm03-08', kind: 'concepto', q: 'Deadline propagation con los números del caso 1.',
        a: 'Caller 300 ms → deadline total del gateway 250 ms → timeout hacia Triton 150 ms → Triton rechaza lo que lleva 100 ms en cola. Cada nivel es menor que lo que le queda a su caller: nadie trabaja en un request abandonado.' },
      { id: 'm03-09', kind: 'numero', q: 'Si la hora pico lleva 1/8 del tráfico diario, ¿cuántas veces el promedio es el pico?',
        a: '24 × 1/8 = 3×. Con 10 % serían 2.4×; con 20 %, 4.8×. Sirve para defender el supuesto en una frase.' },
      { id: 'm03-10', kind: 'trampa', q: 'Dimensionar para el promedio vs para el peor evento del año.',
        a: 'Para el promedio: el p99 explota en la hora pico. Para el peor evento: pagas GPUs ociosas 364 días. Senior: capacidad base para el pico de diseño, escalado programado para los eventos conocidos y load shedding con fallback para lo desconocido.' },
      { id: 'm03-11', kind: 'numero', q: 'Little\'s law en c01: gateway a 500 req/s con 50 ms de media; Triton a 250 req/s por GPU con ≈ 8 ms adentro.',
        a: '25 requests en vuelo en el gateway (≈ 5 por pod con 5 pods); ≈ 2 dentro de cada Triton: por eso instance_group con count 2, y no 8.' },
      { id: 'm03-12', kind: 'trampa', q: '¿Qué está mal en calcular λ × p99 para saber la concurrencia?',
        a: 'Little habla de promedios: con el p99, el número no significa nada. Para el caso malo usa un tope explícito (λ × timeout: 500 × 0.15 s = 75 llamadas) o mide los requests en vuelo con un gauge.' },
      { id: 'm03-13', kind: 'numero', q: 'M/M/1 con S = 10 ms: tiempo promedio en el sistema a ρ = 0.5, 0.7, 0.8, 0.9 y 0.95.',
        a: '20, ≈ 33, 50, 100 y 200 ms (W = S / (1 − ρ)). De 0.5 a 0.9 la espera en cola se multiplica por 9.' },
      { id: 'm03-14', kind: 'concepto', q: 'Dos cosas que aplanan la curva de colas.',
        a: 'Menos variabilidad (con servicio regular, M/D/1 espera la mitad que M/M/1) y pooling: una cola para varios servidores (2 servidores al 80 % con S = 10 ms esperan ≈ 18 ms en vez de 40). En la práctica: inputs acotados y balanceo por requests pendientes.' },
      { id: 'm03-15', kind: 'tradeoff', q: '¿Por qué se planea al 50–70 % de la capacidad medida y no al 100 %?',
        a: 'El headroom paga la p99 (lejos del codo), la caída de una réplica o de una zona, los minutos de cold start del autoscaler y el error de tu medición. Un job batch offline sí trabaja cerca del 100 %: ahí solo importa terminar.' },
      { id: 'm03-16', kind: 'numero', q: 'A 250 req/s por GPU con max_queue_delay de 2 ms: ¿cuántos requests llegan en la ventana y cuánto tardaría llenar un batch de 32?',
        a: '0.5 requests en la ventana (batch típico de 1–3); llenar 32 tardaría 128 ms. El batching importa en el pico, en un failover y offline.' },
      { id: 'm03-17', kind: 'trampa', q: '"Activo batching y la latencia baja." ¿Cuándo es verdad?',
        a: 'Solo si el sistema estaba saturado y el batching, al subir la capacidad, vació la cola. Con holgura, el batching siempre suma latencia: la ventana y un batch más lento.' },
      { id: 'm03-18', kind: 'concepto', q: 'Padding y bucketing.',
        a: 'Un batch necesita el mismo shape: se rellena al más grande y ese cómputo se tira (secuencias de 64 tokens rellenadas a 512: ≈ 87.5 % es relleno). Bucketing agrupa por tamaño parecido y batchea dentro de cada grupo.' },
      { id: 'm03-19', kind: 'concepto', q: 'Los 7 pasos para decidir cuántas GPUs.',
        a: 'Medir la capacidad al SLO (el codo) → utilización objetivo → ceil(pico de diseño / capacidad planeada) → N+1 por zona → excedente del rollout → VRAM → costo.' },
      { id: 'm03-20', kind: 'numero', q: '40 cámaras × 15 fps, 250 frames/s medidos por L4, 70 % de utilización y N+1. ¿Cuántas GPUs?',
        a: '600 frames/s; 250 × 0.7 = 175; ceil(600 / 175) = 4; + 1 = 5 L4 (' + est('≈ US$2.9k/mes') + ' on-demand). Tráfico plano: se puede planear más alto que en c01.' },
      { id: 'm03-21', kind: 'numero', q: 'Chequeo de FLOPs: ResNet-50 en una T4.',
        a: '8.2 GFLOPs por imagen contra ≈ 65 TFLOPS FP16 → techo ≈ 7,900 img/s; medido ' + est('≈ 1,200') + ' (≈ 15 %). El techo teórico dice qué es imposible, no qué vas a obtener.' },
      { id: 'm03-22', kind: 'trampa', q: 'Carga cerrada y coordinated omission.',
        a: 'En bucle cerrado, el generador manda menos requests cuando el servidor se frena: los momentos malos quedan sub-muestreados y el p99 sale mejor que la realidad (una pausa de 1 s: cerrado p99 ≈ 10 ms, abierto ≈ 0.9 s). Para latencia, carga abierta: k6 constant-arrival-rate, wrk2, perf_analyzer --request-rate-range.' },
      { id: 'm03-23', kind: 'concepto', q: 'Rampa, soak, spike y failover: qué encuentra cada prueba.',
        a: 'Rampa: la capacidad al SLO (el codo). Soak: fugas, baja de clocks, discos que se llenan. Spike: load shedding, autoscaler, cold start. Failover: si N+1 de verdad aguanta el pico con una réplica menos.' },
      { id: 'm03-24', kind: 'trampa', q: 'Tres capas de llamadas con 3 reintentos cada una.',
        a: 'Hasta 4<sup>3</sup> = 64 intentos en el model server por request del usuario: retry storm. Reintenta en una sola capa, solo lo idempotente y transitorio, con backoff exponencial + jitter y presupuesto ≤ 10 %.' },
      { id: 'm03-25', kind: 'tradeoff', q: 'Hedged requests: cuándo sí y cuándo no.',
        a: 'Sí: lentitud aleatoria por réplica en lecturas baratas y replicadas (hedge al p95 → ≈ 5 % más de carga, recorta mucho la cola). No: inferencia cara cerca de saturación, operaciones no idempotentes, lentitud compartida o sin forma de cancelar la copia.' },
      { id: 'm03-26', kind: 'frase', q: '¿Cómo dices el SLO de latencia y cómo lo mides? (en inglés)',
        a: '"Our SLO is a p99 of 200 ms, measured server-side at the gateway and computed from a histogram aggregated across pods."' },
      { id: 'm03-27', kind: 'frase', q: '¿Cómo justificas la utilización objetivo? (en inglés)',
        a: '"I\'d plan each GPU at about 50% of its measured capacity. In a simple queueing model the wait grows like rho over one minus rho, so at 90% the first burst would blow the p99."' },
      { id: 'm03-28', kind: 'frase', q: '¿Cómo presentas la capacidad por GPU cuando no la conoces? (en inglés)',
        a: '"That per-GPU number is an assumption. It\'s the first thing I\'d measure with perf_analyzer, at our latency budget and with real images."' },
    ],

    // ---------------------------------------------------------- glosario
    // Términos nuevos de este módulo. Los que ya definen m01/c01 (p99 latency, Little's law,
    // dynamic batching, perf_analyzer, load shedding, retry storm…) no se repiten.
    glossary: [
      { en: 'tail latency', es: 'latencia de cola', def: 'Los percentiles altos de la latencia (p95, p99, p99.9): lo que viven los requests más lentos, que el promedio esconde.', say: 'Tail latency is what users remember, so our SLO is on the p99, not on the mean.' },
      { en: 'percentile', es: 'percentil', def: 'pN es el valor bajo el cual queda el N % de las mediciones: p50 es la mediana, p99 describe la cola. No se promedia entre pods ni entre ventanas de tiempo.', say: 'Percentiles don\'t average, so we sum the histogram buckets first and compute the quantile at the end.' },
      { en: 'latency budget', es: 'presupuesto de latencia', def: 'Reparto del SLO end-to-end entre los tramos del camino de un request (red, preproceso, cola, cómputo), para decidir dónde optimizar.', say: 'Out of the 200 ms budget, preprocessing takes the biggest share, not the GPU.' },
      { en: 'service time', es: 'tiempo de servicio', def: 'El trabajo real de un request en un recurso (p. ej. el cómputo en la GPU), sin contar la espera.', say: 'A faster GPU cuts the service time; more replicas only cut the waiting time.' },
      { en: 'queueing delay', es: 'tiempo de espera en cola', def: 'Lo que un request espera su turno (en la cola del batcher, en un pool). Cerca de la saturación crece como ρ / (1 − ρ) y domina la latencia.', say: 'The p99 regression is all queueing delay; compute time is flat.' },
      { en: 'in-flight requests', es: 'requests en vuelo', def: 'Requests aceptados que todavía no terminaron (en cola + en proceso). Por Little\'s law, en promedio = throughput × latencia media.', say: 'We cap in-flight requests per pod and shed the rest with a 503.' },
      { en: 'arrival rate (λ)', es: 'tasa de llegada', def: 'Requests que llegan por unidad de tiempo; en régimen estable coincide con el throughput. Es la λ de Little\'s law y de la utilización.', say: 'At an arrival rate of 250 requests per second per GPU, a 2 ms window only collects half a request on average.' },
      { en: 'fan-out', es: 'fan-out (llamadas en abanico)', def: 'Un request que dispara N llamadas en paralelo y espera a todas. Si cada una supera su p99 el 1 % de las veces, el request toca la cola con probabilidad 1 − 0.99<sup>N</sup>.', say: 'With a fan-out of a hundred shards, most requests hit at least one shard\'s tail.' },
      { en: 'histogram_quantile', es: 'histogram_quantile (función de PromQL)', def: 'Función de Prometheus que estima un cuantil a partir de los buckets de un histograma, interpolando dentro del bucket. Se aplica después de sumar los buckets de todos los pods.', say: 'We alert on histogram_quantile over the summed buckets, never on an average of per-pod p99s.' },
      { en: 'peak-to-average ratio', es: 'relación pico/promedio', def: 'Cuántas veces el pico supera al promedio (factor diurno típico de 2–5×). Equivale a 24 × la fracción del tráfico diario que cae en la hora pico.', say: 'I\'ll assume a peak-to-average ratio of three, about 12% of daily traffic in the busiest hour.' },
      { en: 'design peak', es: 'pico de diseño', def: 'El pico esperado más un margen (spikes, crecimiento, error de estimación) para el que se dimensiona el sistema. En c01, 500 req/s.', say: 'The design peak is 500 requests per second, about 1.4 times the expected daily peak.' },
      { en: 'traffic burst', es: 'ráfaga de tráfico', def: 'Llegadas concentradas en ventanas de milisegundos a segundos, muy por encima de la tasa promedio del minuto. Las absorben la cola y el headroom, no el autoscaler.', say: 'Per-minute QPS graphs hide the bursts that actually fill the batcher queue.' },
      { en: 'utilization (ρ)', es: 'utilización', def: 'Fracción del tiempo en que un servidor está ocupado: ρ = tasa de llegada / capacidad. La espera en cola crece como ρ / (1 − ρ); el tiempo total, como 1 / (1 − ρ).', say: 'At 90% utilization the queueing delay is nine times what it is at 50%.' },
      { en: 'M/M/1 queue', es: 'cola M/M/1', def: 'Modelo de colas con llegadas Poisson, servicio exponencial y un servidor: W = S / (1 − ρ). Sirve para razonar la forma de la curva, no para dimensionar.', say: 'Even a simple M/M/1 model shows why we don\'t plan GPUs at 90% utilization.' },
      { en: 'knee of the curve', es: 'codo de la curva', def: 'El punto de la curva throughput–latencia donde el throughput deja de subir y la latencia se dispara. La capacidad útil se mide ahí, dentro del presupuesto de latencia.', say: 'We define capacity as the throughput at the knee, where p99 still fits the budget.' },
      { en: 'static batching', es: 'batching estático', def: 'Procesar en lotes de tamaño fijo (juntar N ítems o recorrer un archivo en bloques de N). Natural en batch offline; peligroso online con tráfico bajo.', say: 'The backfill uses static batches of 32; the online path uses dynamic batching.' },
      { en: 'max queue delay', es: 'espera máxima de batching', def: 'Tiempo máximo que el model server espera para juntar requests en un batch (<code>max_queue_delay_microseconds</code> en Triton). Se ajusta contra el presupuesto de latencia.', say: 'A 2 ms max queue delay is noise against a 200 ms budget.' },
      { en: 'padding', es: 'relleno', def: 'Completar los inputs más chicos hasta el shape del más grande para poder batchearlos. Ese cómputo se desperdicia.', say: 'Padding everything to 512 tokens would waste most of the batch.' },
      { en: 'shape bucketing', es: 'agrupación por tamaño', def: 'Agrupar inputs de tamaño parecido y batchear dentro de cada grupo, para no tirar cómputo en padding.', say: 'We bucket sequences by length so we don\'t waste the GPU on padding.' },
      { en: 'load testing', es: 'prueba de carga', def: 'Generar tráfico controlado contra un servicio para medir throughput y latencia bajo carga: rampa, soak, spike, failover.', say: 'The per-GPU number comes from a load test, not from a spec sheet.' },
      { en: 'open-loop load', es: 'carga abierta', def: 'Generador que envía requests a una tasa fija sin esperar las respuestas, como usuarios reales independientes. La carga cerrada (closed-loop) espera cada respuesta antes de mandar la siguiente.', say: 'For latency I use an open-loop generator at a fixed arrival rate.' },
      { en: 'coordinated omission', es: 'omisión coordinada', def: 'Sesgo de los generadores de carga cerrados: cuando el servidor se frena mandan menos requests, sub-muestrean los momentos lentos y el p99 sale mejor que la realidad.', say: 'A closed-loop test hides stalls because of coordinated omission.' },
      { en: 'soak test', es: 'prueba de resistencia (soak)', def: 'Carga sostenida por horas al pico de diseño para encontrar fugas de memoria, baja de clocks por temperatura o recursos que se agotan.', say: 'A four-hour soak test at design peak would catch thermal throttling on the T4s.' },
      { en: 'spike test', es: 'prueba de pico', def: 'Subir la carga varias veces en segundos para ver si el load shedding, el autoscaler y el cold start se comportan como se diseñó.', say: 'The spike test showed that load shedding kicks in long before a new GPU node is ready.' },
      { en: 'warmup', es: 'calentamiento', def: 'Requests iniciales que pagan inicializaciones (contexto de CUDA, carga del engine, conexiones, caches). Se descartan de las mediciones y se hacen antes de pasar readiness.', say: 'New replicas run a warmup before the readiness probe passes, so users never pay for the first slow requests.' },
      { en: 'Locust', es: 'Locust', def: 'Herramienta de load testing en Python: usuarios virtuales con su lógica en código. Genera carga cerrada por defecto.', say: 'I\'d script the realistic mix of phone and web photos in Locust.' },
      { en: 'k6', es: 'k6', def: 'Herramienta de load testing con scripts en JavaScript; tiene ejecutores de tasa fija (carga abierta) y umbrales que pueden hacer fallar un pipeline de CI.', say: 'In CI, a k6 test fails the build if p99 goes over the SLO.' },
      { en: 'deadline propagation', es: 'propagación de deadlines', def: 'Pasar a cada salto el tiempo que le queda al request, para que ningún nivel trabaje en algo que su caller ya abandonó.', say: 'With deadline propagation, no hop keeps working on a request its caller has already given up on.' },
      { en: 'exponential backoff', es: 'backoff exponencial', def: 'Esperar cada vez más entre reintentos (100, 200, 400 ms…) para no insistir sobre un servicio saturado.', say: 'Batch callers retry once, with exponential backoff and jitter.' },
      { en: 'jitter', es: 'jitter (espera aleatoria)', def: 'Componente aleatorio en la espera entre reintentos, para que los clientes no reintenten todos a la vez.', say: 'Without jitter, all the clients retry at the same moment and hit the server in synchronized waves.' },
      { en: 'retry budget', es: 'presupuesto de reintentos', def: 'Tope a la fracción de requests que pueden ser reintentos (p. ej. ≤ 10 %); por encima, no se reintenta.', say: 'Each client has a retry budget of 10%, so retries can never multiply the load.' },
      { en: 'hedged request', es: 'request de cobertura (hedging)', def: 'Mandar una copia a otra réplica si el original no respondió al p95 y quedarse con la primera respuesta. ≈ 5 % más de carga a cambio de recortar la cola, si la lentitud es independiente por réplica.', say: 'Hedged requests work for cheap replicated reads, not for expensive GPU inference near saturation.' },
      { en: 'backpressure', es: 'contrapresión (backpressure)', def: 'Señal hacia atrás para que quien envía baje el ritmo cuando el receptor no da abasto: colas acotadas, 429/503 con Retry-After, un consumer que deja de leer.', say: 'Bounded queues give us backpressure instead of unbounded latency.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
