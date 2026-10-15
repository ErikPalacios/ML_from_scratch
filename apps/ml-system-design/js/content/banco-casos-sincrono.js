/* Banco de problemas · Mini-casos por patrón · Online síncrono: alguien espera la respuesta (ms a ≈ 1 s): presupuesto de latencia, réplicas, CPU vs GPU, batching dinámico, timeouts y fallback.
   Se carga DESPUÉS de banco-casos.js (que define la sección, las tarjetas y B.util). Contrato y convenciones:
   ver el encabezado de banco-casos.js.
   Plantillas: sin-01 ¿quién espera? (N1) · sin-02 presupuesto de latencia (N1) · sin-03 CPU o GPU (N2) ·
   sin-04 batching dinámico (N2) · sin-05 fan-out y cola larga (N3) · sin-06 timeouts y fallback (N3).
   Las decisiones se calculan en gen(): primero se elige el resultado y después una combinación de entradas que lo
   produce con margen (≥ 10 % en cada comparación), así cada desenlace sale parecido número de veces y ningún
   redondeo intermedio cambia un conteo ni una decisión. Precios: los de ref-numeros.js (aprox.); el resto, supuestos
   rotulados en el enunciado. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const B = MSD.problemBank && MSD.problemBank.casos;
  if (!B || B.templates.some((t) => t.topic === 'sincrono')) return;   // sin la sección, o ya cargado
  const { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN } = B.util;

  const C6I = 0.17;    // c6i.xlarge (4 vCPU), US$/h aprox. (ref-numeros)
  const T4H = 0.526;   // g4dn.xlarge (1 T4), US$/h aprox.
  const L4H = 0.805;   // g6.xlarge (1 L4), US$/h aprox.
  const pct = (x) => f(x * 100, 0);   // 0.237 → "24"

  // ------------------------------------------------------------------ historias de cada plantilla
  // sin-01: lo que se hace mientras alguien espera (el cómputo decide si cabe) y una variante cuyo input existe antes.
  const SIN01 = [
    {
      org: 'Una plataforma de siniestros que usan varias aseguradoras', task: 'estima el costo de reparación de un auto a partir de las fotos del choque',
      cost: (y) => `Procesar las fotos de un siniestro tarda ≈ <b>${f(y)} s</b> en una L4 (medido)`,
      vol: (v) => `Llegan ≈ <b>${f(v)}k siniestros al día</b>`,
      wait: (x) => `la persona asegurada sube las fotos en la app y espera la estimación en pantalla; producto acepta hasta <b>${x} s</b> de espera.`,
      X: 3, ys: [0.4, 0.8, 1.2, 1.5], ya: [5, 8, 15, 25], vs: [10, 20, 30, 50], noun: 'siniestros',
      fallback: 'el formulario para pedir un ajustador',
      bOrg: 'Una aseguradora de autos', bTask: 'calcula para cada póliza vigente la probabilidad de que no la renueve, y la app le muestra una oferta de renovación a quien la abre',
      bCalc: 'Puntuar una póliza', bMs: 40, bOpen: 'La app se abre', bvs: [1, 2, 4], bInput: 'las pólizas y sus datos',
      bReq: 'las pólizas y sus datos existen desde antes y cambian poco en un día: una oferta calculada anoche alcanza.',
    },
    {
      org: 'Una fintech', task: 'evalúa cada solicitud de tarjeta de crédito y propone un límite',
      cost: (y) => `Evaluar una solicitud tarda ≈ <b>${f(y)} s</b>, con la consulta al buró de crédito (medido)`,
      vol: (v) => `Llegan ≈ <b>${f(v)}k solicitudes al día</b>`,
      wait: (x) => `la persona espera la oferta en la última pantalla de la solicitud; producto acepta hasta <b>${x} s</b> de espera.`,
      X: 2, ys: [0.3, 0.5, 0.7, 0.9], ya: [4, 6, 10, 20], vs: [30, 60, 100, 150], noun: 'solicitudes',
      fallback: 'mandar la solicitud a revisión manual',
      bOrg: 'Una fintech', bTask: 'calcula para cada cliente un aumento de límite preaprobado, que la app muestra al abrirla',
      bCalc: 'Puntuar a un cliente', bMs: 15, bOpen: 'La app se abre', bvs: [3, 6, 10], bInput: 'los clientes y su historial',
      bReq: 'los datos de cada cliente existen desde antes y una oferta calculada anoche alcanza.',
    },
    {
      org: 'Una empresa de paquetería', task: 'estima el peso volumétrico de un paquete a partir de una foto para cotizar el envío',
      cost: (y) => `Procesar la foto tarda ≈ <b>${f(y)} s</b> en una T4 (medido)`,
      vol: (v) => `Se cotizan ≈ <b>${f(v)}k paquetes al día</b>`,
      wait: (x) => `la persona toma la foto en el mostrador de la sucursal y espera el precio en pantalla; producto acepta hasta <b>${x} s</b> de espera.`,
      X: 2, ys: [0.2, 0.4, 0.6, 0.9], ya: [5, 8, 12, 20], vs: [50, 100, 200, 400], noun: 'cotizaciones',
      fallback: 'medir el paquete a mano',
      bOrg: 'Una empresa de paquetería', bTask: 'calcula cada noche la ventana de entrega de los paquetes que salen a reparto al día siguiente, y la página de rastreo la muestra al abrirla',
      bCalc: 'Calcular la ventana de un paquete', bMs: 25, bOpen: 'La página de rastreo se abre', bvs: [2, 4, 8], bInput: 'los paquetes de mañana',
      bReq: 'los paquetes de mañana ya existen esta noche y una ventana calculada anoche alcanza.',
    },
    {
      org: 'Una plataforma de cursos de programación', task: 'corre los tests de cada entrega y un modelo que comenta el código',
      cost: (y) => `Procesar una entrega tarda ≈ <b>${f(y)} s</b> (medido)`,
      vol: (v) => `Llegan ≈ <b>${f(v)}k entregas al día</b>`,
      wait: (x) => `la persona estudiante aprieta «Enviar» y espera los comentarios en pantalla; producto acepta hasta <b>${x} s</b> de espera.`,
      X: 3, ys: [0.5, 0.8, 1.2, 1.5], ya: [6, 12, 20, 40], vs: [50, 100, 200, 300], noun: 'entregas',
      fallback: 'mostrar solo el resultado de los tests',
      bOrg: 'Una plataforma de cursos de programación', bTask: 'recomienda a cada estudiante la próxima lección, que la app muestra al abrirla',
      bCalc: 'Puntuar a una persona', bMs: 30, bOpen: 'La app se abre', bvs: [1, 2, 4], bInput: 'el historial de cada estudiante',
      bReq: 'el historial de cada estudiante existe desde antes y una recomendación calculada anoche alcanza.',
    },
  ];

  // sin-02: [contexto, dónde se midió, métrica, calidad de cada variante, p99 de cada variante (ms)]
  const SIN02 = [
    { org: 'Un sitio de viajes ordena los hoteles de cada búsqueda con un ranker', where: 'en la GPU de producción', metric: 'NDCG@10', q: ['0.47', '0.45', '0.42'], p99: [150, 85, 35] },
    { org: 'El checkout de una tienda online muestra la fecha estimada de entrega antes de pagar', where: 'en la CPU de producción', metric: 'error medio', q: ['0.6 días', '0.7 días', '0.9 días'], p99: [110, 60, 20] },
    { org: 'La app del call center de una telco sugiere qué plan ofrecer mientras la persona agente atiende', where: 'en la GPU de producción', metric: 'aceptación offline', q: ['19 %', '17.5 %', '15 %'], p99: [140, 75, 30] },
    { org: 'La historia clínica electrónica de una red de hospitales sugiere códigos de diagnóstico (CIE-10) mientras se escribe la nota clínica', where: 'en la GPU de producción', metric: 'recall@5', q: ['93 %', '90 %', '85 %'], p99: [180, 100, 40] },
  ];

  // sin-03: [contexto, modelo, req/s planificados por c6i.xlarge, p99 en CPU (ms), req/s planificados por T4, p99 en la T4]
  const SIN03 = [
    { org: 'Una empresa de atención al cliente clasifica la intención de cada mensaje del chat para mandarlo a la cola correcta', model: 'un DistilBERT', tc: [40, 60], pc: [35, 70, 110], tg: [500, 800], pg: 10 },
    { org: 'Un portal inmobiliario etiqueta el tipo de ambiente de cada foto mientras la persona publica el aviso', model: 'un ResNet-18', tc: [30, 50], pc: [45, 80, 120], tg: [900, 1200], pg: 8 },
    { org: 'El portal de trámites de un gobierno reconoce el tipo de documento que sube la ciudadanía antes de aceptarlo', model: 'un EfficientNet-B0', tc: [25, 40], pc: [50, 90, 140], tg: [700, 1000], pg: 12 },
    { org: 'Las cajas de autoservicio de una cadena de supermercados reconocen la fruta o verdura que se pone en la balanza', model: 'un MobileNetV3', tc: [50, 80], pc: [25, 45, 70], tg: [1500, 2000], pg: 6 },
  ];

  // sin-04: barrido de perf_analyzer por historia: [batch máximo, ventana (ms), tiempo del batch lleno (ms), req/s medidos]
  // (formas realistas, números ilustrativos: el de la T4 es la tabla de M3) y picos posibles. Los presupuestos del tramo
  // salen de SIN04_BUD: los que dejan ganar a cada configuración con ≥ 10 % de margen contra su p99 y el de la siguiente.
  const SIN04 = [
    {
      org: 'Un marketplace de moda tiene «buscar por foto»: la persona sube una foto y espera productos parecidos', model: 'el embedding de la foto (un ResNet-50 en TensorRT FP16)',
      gpu: 'T4 (g4dn.xlarge, ≈ US$0.526/h', price: T4H, cfg: [[1, 0, 4, 250], [8, 2, 9, 890], [16, 4, 15, 1070], [32, 8, 27, 1190]],
      peaks: [800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000],
    },
    {
      org: 'Una plataforma de publicidad puja en subastas en tiempo real: el exchange espera la oferta', model: 'un modelo de CTR (una red densa chica)',
      gpu: 'L4 (g6.xlarge, ≈ US$0.805/h', price: L4H, cfg: [[1, 0, 1, 1000], [16, 1, 2, 6000], [64, 2, 4, 12000], [256, 4, 12, 16000]],
      peaks: [15000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000, 120000],
    },
    {
      org: 'Una app de movilidad verifica con una selfie la identidad de cada conductor al empezar el turno', model: 'el embedding facial (TensorRT FP16)',
      gpu: 'L4 (g6.xlarge, ≈ US$0.805/h', price: L4H, cfg: [[1, 0, 3, 330], [8, 2, 8, 1000], [16, 4, 14, 1140], [32, 6, 26, 1230]],
      peaks: [400, 500, 600, 800, 1000, 1200, 1500, 1800, 2400, 3000],
    },
    {
      org: 'Una telco revisa cada SMS antes de entregarlo para frenar el spam: el gateway de SMS espera el veredicto', model: 'un clasificador de texto (DistilBERT en TensorRT FP16)',
      gpu: 'T4 (g4dn.xlarge, ≈ US$0.526/h', price: T4H, cfg: [[1, 0, 3, 330], [8, 2, 10, 800], [16, 4, 18, 890], [32, 8, 34, 940]],
      peaks: [800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000],
    },
  ];
  const SIN04_BUD = [4, 5, 7, 8, 10, 12, 13, 14, 15, 16, 17, 18, 20, 22, 25, 28, 30, 35, 36, 40, 45, 50, 60];

  // sin-05: [contexto(N), unidad, ¿acepta parciales? y por qué, menos fan-out(N'), llamada normal c, espera del hedge H
  // (≈ p95 de una llamada), lo que se va antes y después del fan-out o, N' posibles]
  const SIN05 = [
    {
      org: (n) => `Un portal de empleo busca vacantes consultando en paralelo los <b>${n} shards</b> del índice, y espera a todos`, unit: 'shard', partial: true,
      why: 'Producto acepta resultados parciales: si falta un shard, faltan algunas vacantes de la búsqueda.',
      less: (n) => `juntar el índice en ${n} ${n === 1 ? 'shard grande' : 'shards más grandes'} (nodos con más memoria)`, lessS: (n) => `${n} ${n === 1 ? 'shard' : 'shards'}`, c: 20, H: 35, o: 10, nps: [2, 3, 4],
    },
    {
      org: (n) => `La app de una cadena de ferreterías muestra «disponible cerca de ti» consultando en paralelo el inventario de <b>${n} shards</b> regionales, y espera a todos`, unit: 'shard', partial: true,
      why: 'Producto acepta resultados parciales: las tiendas de un shard que no respondió se muestran como «consultar disponibilidad».',
      less: (n) => `juntar el inventario en ${n} ${n === 1 ? 'shard grande' : 'shards más grandes'} (nodos con más memoria)`, lessS: (n) => `${n} ${n === 1 ? 'shard' : 'shards'}`, c: 25, H: 40, o: 15, nps: [2, 3, 4],
    },
    {
      org: (n) => `Una aseguradora cotiza en línea un seguro de vida: <b>${n} modelos</b> de riesgo, cada uno en su propio servicio, se consultan en paralelo y la prima espera a todos`, unit: 'servicio', partial: false,
      why: 'Producto no acepta resultados parciales: sin uno de los scores, la prima sale mal calculada.',
      less: (n) => `juntar los modelos en ${n} ${n === 1 ? 'servicio' : 'servicios'} (varios modelos por proceso)`, lessS: (n) => `${n} ${n === 1 ? 'servicio' : 'servicios'}`, c: 30, H: 50, o: 10, nps: [1, 2],
    },
    {
      org: (n) => `Una farmacia en línea revisa las interacciones entre los medicamentos de cada receta consultando en paralelo los <b>${n} shards</b> de su base clínica, y espera a todos`, unit: 'shard', partial: false,
      why: 'Producto no acepta resultados parciales: un shard faltante podría esconder una interacción grave.',
      less: (n) => `juntar la base en ${n} ${n === 1 ? 'shard grande' : 'shards más grandes'} (nodos con más memoria)`, lessS: (n) => `${n} ${n === 1 ? 'shard' : 'shards'}`, c: 25, H: 45, o: 15, nps: [1, 2],
    },
  ];

  // sin-06: [contexto, modelo, fallback, métrica, calidad con el modelo y con el fallback, latencias p50/p90/p95/p99]
  const SIN06 = [
    { org: 'Una app de viajes calcula el precio de cada viaje cuando la persona lo pide', model: 'un modelo de demanda en GPU', fb: 'una tabla de precios por zona y hora, en memoria del gateway', metric: 'Conversión (viajes pedidos ÷ cotizados)', mShort: 'conversión', qp: 34, qf: 26, lat: [18, 45, 70, 140] },
    { org: 'Una app de idiomas elige el siguiente ejercicio de cada persona', model: 'un modelo de secuencia en GPU', fb: 'el siguiente ejercicio del temario', metric: 'Ejercicios completados', mShort: 'ejercicios completados', qp: 64, qf: 52, lat: [25, 60, 90, 180] },
    { org: 'Un diario digital ordena las noticias de la portada para cada persona', model: 'un ranker en GPU', fb: 'el orden editorial de la portada', metric: 'Sesiones con al menos un clic', mShort: 'sesiones con clic', qp: 58, qf: 47, lat: [15, 40, 65, 120] },
    { org: 'Un banco puntúa el riesgo de fraude de cada transferencia antes de ejecutarla', model: 'un modelo de grafos en GPU', fb: 'reglas de monto y de destinatario nuevo', metric: 'Fraude detectado', mShort: 'fraude detectado', qp: 82, qf: 61, lat: [12, 30, 50, 110] },
  ];

  B.formulas.push(
    { topic: 'sincrono', title: 'Presupuesto para el modelo', expr: 'ms del modelo = SLO − Σ p99 de los tramos fijos · dos tramos independientes en paralelo cuestan el máximo, no la suma', ex: '250 − (15 + 10 + 25 + 20 + 10) = 170 ms · features en paralelo con el preproceso: 25 + 20 → 25, 20 ms más para el modelo' },
    { topic: 'sincrono', title: 'Batching dinámico', expr: 'p99 del tramo ≈ ventana + batch lleno · GPUs = ⌈pico ÷ (req/s de esa configuración × 0.7)⌉ + 1', ex: 'T4, hasta 16 con ventana de 4 ms: 4 + 15 = 19 ms · 2,500 req/s: ⌈2,500 ÷ 749⌉ + 1 = 5 GPUs, contra ⌈2,500 ÷ 175⌉ + 1 = 16 sin batching' },
    { topic: 'sincrono', title: 'Fan-out y hedging', expr: 'P(lento) = 1 − (1 − p)ᴺ · con hedge: 1 − (1 − p²)ᴺ ≈ N × p² · el hedge suma ≈ la fracción de llamadas que pasan su espera (al p95: ≈ 5 %)', ex: 'N = 20, p = 1 %: 18.2 % de requests lentos → ≈ 0.2 % con hedge' },
    { topic: 'sincrono', title: 'Timeout y fallback', expr: 'timeout ≤ SLO − resto del camino − fallback · al fallback = (100 − percentil del timeout) + % de errores · calidad = (1 − f) × modelo + f × fallback', ex: 'timeout al p95 con 0.2 % de errores: f = 5.2 % · 82 % y 61 % → 80.9 %' },
  );

  B.templates.push(
    // ======================================================== ¿QUIÉN ESPERA?
    {
      id: 'sin-01', topic: 'sincrono', level: 1, title: '¿Quién espera la predicción?', ref: 'm02.decision',
      gen(r) {
        const st = r.pick(SIN01);
        const kind = r.pick(['sync', 'async', 'batch']);
        const k = r.pick([2, 2.5, 3, 4]);
        const PS = 'Online síncrono: request/response con timeout y fallback';
        const PA = 'Asíncrono con cola: 202 con job_id y aviso al terminar';
        const PB = 'Batch con lookup: precomputar de noche y leer en ms';
        const PT = 'Streaming: procesar un flujo continuo de eventos';
        const choices = r.shuffle([PS, PA, PB, PT]);
        const X = st.X;
        let q;
        let Y = 0;
        let V;
        let avg;
        let t = 0;
        if (kind === 'batch') {
          V = r.pick(st.bvs);
          t = r.pick([0.5, 1]);   // un GET a Redis en la misma AZ: ≈ 0.2–1 ms (ref-numeros)
          avg = (V * 1e6) / DAY;
          q = `${st.bOrg} ${st.bTask}. ${st.bCalc} tarda ≈ <b>${st.bMs} ms</b> en CPU (medido). ${st.bOpen} ≈ <b>${f(V)} M de veces al día</b>, con un pico ≈ <b>${k}×</b> el promedio. <b>Requisito:</b> ${st.bReq}`;
        } else {
          // Sin k × Y = 1: los requests en vuelo saldrían iguales al promedio por segundo que muestra la parte 2.
          Y = r.pick((kind === 'sync' ? st.ys : st.ya).filter((y) => Math.abs(k * y - 1) > 0.01));
          V = r.pick(st.vs);
          avg = (V * 1e3) / DAY;
          q = `${st.org} ${st.task}. ${st.cost(Y)}. ${st.vol(V)}, con un pico ≈ <b>${k}×</b> el promedio. <b>Requisito:</b> ${st.wait(X)}`;
        }
        const peak = avg * k;
        const L = kind === 'batch' ? (peak * t) / 1000 : peak * Y;
        const unit = kind === 'batch' ? 'aperturas/s' : st.noun + '/s';
        const vtxt = kind === 'batch' ? f(V) + ' M' : f(V) + 'k';
        const ok = { sync: PS, async: PA, batch: PB }[kind];
        const s1 = ['Planteamiento: las preguntas de M2, en orden: ¿el input existe antes de que alguien pida la predicción? ¿Alguien espera la respuesta, y cuánto? ¿Es un flujo continuo de eventos?'];
        if (kind === 'sync') {
          s1.push(
            `El input nace con el request (no hay nada que precomputar) y alguien espera: el cómputo (≈ ${f(Y)} s) cabe en los ${X} s que acepta producto. <b>Online síncrono</b>, con timeout y un fallback (${st.fallback}).`,
            'Una cola con aviso agrega estado, polling y un segundo contrato que aquí no hacen falta: la respuesta llega mientras la persona espera.',
            'Batch no aplica porque el input no existe antes; streaming es para un flujo continuo de eventos con frescura de segundos, no para solicitudes sueltas.');
        } else if (kind === 'async') {
          s1.push(
            `Alguien espera, pero no ≈ ${f(Y)} s: con ${X} s de tolerancia, para la pregunta «¿alguien espera?» la respuesta es no. <b>Asíncrono con cola</b>: POST → 202 con job_id, workers que procesan y un aviso (push o polling) al terminar.`,
            `Síncrono dejaría un request abierto ≈ ${f(Y)} s: rompe lo que acepta producto y choca con los timeouts de balanceadores y proxies.`,
            'Batch no aplica porque el input nace con el request; streaming es para un flujo continuo de eventos, y aquí cada solicitud es un trabajo suelto.');
        } else {
          s1.push(
            `El input existe antes (${st.bInput}) y una predicción de anoche alcanza: <b>batch</b> de noche y la pantalla lee un lookup de ms. La segunda pregunta decide antes que la tercera.`,
            'Que alguien espere la pantalla no obliga a calcular en el request: espera un lookup. Síncrono pagaría el modelo en cada apertura, con capacidad para el pico las 24 h, para un resultado que no cambió.',
            'Una cola sirve para trabajos que alguien pide; aquí el resultado tiene que estar listo antes de que se abra la pantalla. Y nada pide frescura de segundos: no es streaming.');
        }
        let p3;
        if (kind === 'sync') {
          p3 = {
            ask: 'Requests en vuelo en el pico (Little)', unit: 'requests', answer: L, tol: 0.15,
            steps: [
              'Planteamiento: Little, en vuelo = llegadas × tiempo de cada request (en segundos).',
              `Con el resultado anterior: ${f(peak)} × ${f(Y)} s ≈ <b>${f(L)} requests en vuelo</b>`,
              'Es la concurrencia que dimensiona workers y el límite de requests en vuelo por pod. El caso malo acotado sale con el timeout en lugar del tiempo promedio.',
            ],
          };
        } else if (kind === 'async') {
          p3 = {
            ask: 'Trabajos en proceso a la vez en el pico, si los workers siguen el ritmo de llegada (Little)', unit: 'trabajos', answer: L, tol: 0.15,
            steps: [
              'Planteamiento: Little con workers: ocupados = llegadas × tiempo por trabajo (en segundos).',
              `Con el resultado anterior: ${f(peak)} × ${f(Y)} s ≈ <b>${f(L)} trabajos a la vez</b>`,
              'Con una cola, una ráfaga corta espera en el backlog; para un SLO de minutos se dimensiona para el pico sostenido y se escala por backlog por worker (M2).',
            ],
          };
        } else {
          const Lm = peak * (st.bMs / 1000);
          p3 = {
            ask: `Lookups en vuelo en el pico (Little), si cada uno tarda ≈ <b>${f(t)} ms</b> (supuesto: un GET a Redis en la misma AZ)`, unit: 'lookups', answer: L, tol: 0.15,
            steps: [
              'Planteamiento: Little con el lookup: en vuelo = llegadas × tiempo del lookup (en segundos).',
              `Con el resultado anterior: ${f(peak)} × ${g(t / 1000)} s ≈ <b>${g(L)} lookups en vuelo</b>`,
              `Si calcularas en cada apertura (≈ ${st.bMs} ms) serían ≈ ${g(Lm)} en vuelo, ${f(st.bMs / t, 0)}× más, y con capacidad para el pico las 24 h. Precomputar convierte el costo por apertura en un lookup.`,
            ],
          };
        }
        const say1 = kind === 'sync'
          ? `The person is waiting on the screen and the model takes about ${f(Y)} seconds, within the ${X} seconds product allows, so it's synchronous, with a timeout and a fallback.`
          : kind === 'async'
            ? `Someone is waiting, but not for ${f(Y)} seconds, so I return a 202 with a job ID, process it from a queue and notify them when it's done.`
            : 'The inputs exist ahead of time and last night\'s result is fresh enough, so I precompute in batch and the screen just does a millisecond lookup.';
        const take = kind === 'sync'
          ? `<b>Requisito:</b> la persona espera hasta ${X} s y el cómputo tarda ≈ ${f(Y)} s. <b>Decisión:</b> online síncrono, con timeout y fallback. <b>Por qué:</b> el input nace con el request y la respuesta cabe en la espera. <b>Tamaño:</b> ≈ ${say(peak)} ${unit} en el pico, ≈ ${say(L)} requests en vuelo. <b>Cuándo cambia:</b> si el cómputo pasara de los ${X} s, el mismo endpoint respondería 202 y procesaría en una cola.`
          : kind === 'async'
            ? `<b>Requisito:</b> la persona acepta ${X} s y el cómputo tarda ≈ ${f(Y)} s. <b>Decisión:</b> asíncrono con cola, 202 + job_id y aviso. <b>Por qué:</b> «alguien espera» solo cuenta si la respuesta cabe en lo que acepta esperar. <b>Tamaño:</b> ≈ ${say(peak)} ${unit} en el pico, ≈ ${say(L)} trabajos a la vez. <b>Cuándo cambia:</b> si el cómputo bajara de los ${X} s (un modelo más chico), volvería a ser síncrono.`
            : `<b>Requisito:</b> el input existe antes y una predicción de anoche alcanza. <b>Decisión:</b> batch nocturno + lookup. <b>Por qué:</b> la pregunta «¿existe el input antes?» va antes que «¿alguien espera?». <b>Tamaño:</b> ≈ ${say(peak)} aperturas/s en el pico y apenas ${g(L)} lookups en vuelo. <b>Cuándo cambia:</b> si producto pidiera reaccionar a lo que pasó hoy, un re-rank online encima del batch (un híbrido).`;
        return {
          q,
          parts: [
            { ask: '¿Qué patrón usas?', choices, answer: choices.indexOf(ok), steps: s1 },
            {
              ask: kind === 'batch' ? 'Pico de aperturas por segundo' : `Pico de ${st.noun} por segundo`, unit, answer: peak, tol: 0.15,
              steps: [
                'Planteamiento: promedio = volumen diario ÷ 86,400 s; pico = promedio × factor de pico.',
                `${vtxt} ÷ 86,400 ≈ ${f(avg)} por segundo → × ${k} ≈ <b>${f(peak)} ${unit}</b>`,
              ],
            },
            p3,
          ],
          hint: 'Primero el patrón: ¿el input existe antes de que alguien lo pida? Si no, ¿alguien espera, y lo que tarda el cómputo cabe en lo que acepta esperar? Después, el pico (volumen diario ÷ 86,400 × factor de pico) y Little: en vuelo = pico × tiempo de cada uno, en segundos.',
          takeaway: `${take} <i>"${say1}"</i>`,
        };
      },
    },

    // ======================================================== PRESUPUESTO DE LATENCIA
    {
      id: 'sin-02', topic: 'sincrono', level: 1, title: 'Presupuesto de latencia', ref: 'm03.presupuesto',
      gen(r) {
        const st = r.pick(SIN02);
        const [G, M, C] = st.p99;
        // Variante que gana con lo que queda: 0 grande, 1 mediana, 2 destilada; -1 si alguna comparación queda a menos
        // de 10 % (esas combinaciones no se usan).
        const win = (rem) => (rem >= 1.1 * G ? 0 : rem >= 1.1 * M && rem <= 0.9 * G ? 1 : rem >= 1.1 * C && rem <= 0.9 * M ? 2 : -1);
        const by = [[], [], []];
        [150, 200, 250, 300].forEach((S) => [10, 15, 20].forEach((a) => [5, 10].forEach((b) => [15, 25, 40].forEach((c) => [10, 20, 30].forEach((d) => [5, 10].forEach((e) => {
          const w = win(S - (a + b + c + d + e));
          const rem2 = S - (a + b + Math.max(c, d) + e);
          if (w >= 0 && st.p99.every((p) => Math.abs(rem2 - p) / p >= 0.1)) by[w].push([S, a, b, c, d, e]);
        }))))));
        const k = r.pick([0, 1, 2]);
        const [S, a, b, c, d, e] = r.pick(by[k]);
        const sum = a + b + c + d + e;
        const rem = S - sum;
        const sum2 = a + b + Math.max(c, d) + e;
        const rem2 = S - sum2;
        const gain = Math.min(c, d);
        const k2 = rem2 >= G ? 0 : rem2 >= M ? 1 : 2;
        const nm = ['la grande', 'la mediana', 'la destilada'];
        const en = ['large', 'medium', 'distilled'];
        const names = [`La grande (p99 ≈ ${G} ms)`, `La mediana (p99 ≈ ${M} ms)`, `La destilada (p99 ≈ ${C} ms)`];
        const choices = r.shuffle(names.slice());
        const fits = (p) => (p <= rem ? 'entra' : 'no entra');
        return {
          q: `${st.org}. SLO: <b>p99 ≤ ${S} ms</b> en el servidor. Presupuesto de p99 por tramo, en serie (medido): red y TLS <b>${a} ms</b>, autenticación <b>${b} ms</b>, lectura de features <b>${c} ms</b>, preproceso <b>${d} ms</b> y postproceso <b>${e} ms</b>. Tres variantes del modelo (p99 medido ${st.where}): la grande, <b>${G} ms</b> (${st.metric} ${st.q[0]}); la mediana, <b>${M} ms</b> (${st.q[1]}); la destilada, <b>${C} ms</b> (${st.q[2]}).`,
          parts: [
            {
              ask: 'Milisegundos de p99 que quedan para el modelo', unit: 'ms', answer: rem, tol: 0.05,
              steps: [
                'Planteamiento: lo que queda para el modelo = SLO − la suma de los p99 de los tramos en serie.',
                `${S} − (${a} + ${b} + ${c} + ${d} + ${e}) = ${S} − ${sum} = <b>${rem} ms</b>`,
              ],
            },
            {
              ask: '¿Qué variante usas?', choices, answer: choices.indexOf(names[k]),
              steps: [
                'Planteamiento: la variante más precisa cuyo p99 entra en lo que queda.',
                `Con el resultado anterior (${rem} ms): la grande (${G} ms) ${fits(G)}; la mediana (${M} ms) ${fits(M)}; la destilada (${C} ms) ${fits(C)}.`,
                k === 0
                  ? `Gana <b>la grande</b>, con ${rem - G} ms de margen: si la más precisa entra, una más chica solo regala calidad.`
                  : k === 1
                    ? `Gana <b>la mediana</b>, con ${rem - M} ms de margen: la grande se pasa por ${G - rem} ms, y la destilada pierde calidad sin necesidad.`
                    : `Gana <b>la destilada</b>, con ${rem - C} ms de margen: la mediana se pasa por ${M - rem} ms y la grande por ${G - rem} ms.`,
                'La suma de p99 es pesimista (rara vez todos los tramos tienen su peor caso en el mismo request): sirve para repartir el presupuesto, y el cumplimiento se mide end-to-end con el histograma (M3).',
              ],
            },
            {
              ask: 'Si lees las features en paralelo con el preproceso (son independientes), ¿cuántos ms quedan para el modelo?', unit: 'ms', answer: rem2, tol: 0.05,
              steps: [
                'Planteamiento: dos tramos independientes en paralelo cuestan el más largo de los dos, no la suma.',
                `${S} − (${a} + ${b} + máx(${c}, ${d}) + ${e}) = ${S} − ${sum2} = <b>${rem2} ms</b>`,
                k2 < k
                  ? `Ganas ${gain} ms, y con eso ya entra ${nm[k2]} (${st.p99[k2]} ms): paralelizar compró calidad sin tocar el modelo.`
                  : k === 0
                    ? `Ganas ${gain} ms: ya usabas la grande, así que el margen extra absorbe picos de los otros tramos.`
                    : `Ganas ${gain} ms, pero ${nm[k - 1]} (${st.p99[k - 1]} ms) sigue sin entrar: la próxima palanca sería sacar trabajo del camino (caché de features, conexiones persistentes) o un modelo más rápido.`,
              ],
            },
          ],
          hint: 'Resta del SLO los p99 de todos los tramos que no son el modelo: lo que queda es el presupuesto del modelo, y eliges la variante más precisa que entra. Si dos tramos son independientes y corren en paralelo, cuenta solo el más largo.',
          takeaway: `<b>Requisito:</b> p99 ≤ ${S} ms con ≈ ${sum} ms en tramos fijos. <b>Decisión:</b> ${nm[k]} (${st.p99[k]} ms) en los ${rem} ms que quedan. <b>Por qué:</b> el presupuesto se reparte antes de elegir el modelo, y va la variante más precisa que entra. <b>Trade-off:</b> leer features en paralelo con el preproceso libera ${gain} ms${k2 < k ? ' y alcanza para ' + nm[k2] : ''}; optimizar el modelo es una palanca entre varias, no la primera. <i>"After the fixed hops, about ${rem} milliseconds of the ${S}-millisecond p99 are left for the model, so I ship the ${en[k]} variant; fetching features in parallel with preprocessing would free another ${gain} milliseconds."</i>`,
        };
      },
    },

    // ======================================================== CPU O GPU
    {
      id: 'sin-03', topic: 'sincrono', level: 2, title: 'CPU o GPU para servir', ref: 'm04.cpu-gpu-tpu',
      gen(r) {
        const st = r.pick(SIN03);
        // Combinaciones separadas por resultado; todas las comparaciones (p99 de la CPU contra el SLO, cada costo contra
        // el presupuesto y CPU contra GPU cuando las dos sirven) a ≥ 10 %, y ningún cociente pegado a un entero.
        const by = { cpu: [], gpu: [], none: [] };
        [60, 100, 150, 250, 400, 600, 900, 1300].forEach((P) => [50, 80, 100, 150].forEach((S) => [500, 800, 1200, 1800, 2500, 3500, 5000].forEach((Bu) => st.tc.forEach((Tc) => st.pc.forEach((Pc) => st.tg.forEach((Tg) => {
          if (!far(P / Tc) || !far(P / Tg)) return;
          const cC = (ceilx(P / Tc) + 1) * C6I * MES_H;
          const cG = (ceilx(P / Tg) + 1) * T4H * MES_H;
          const lat = Pc <= 0.9 * S ? 1 : Pc >= 1.1 * S ? 0 : -1;
          const bC = cC <= 0.9 * Bu ? 1 : cC >= 1.1 * Bu ? 0 : -1;
          const bG = cG <= 0.9 * Bu ? 1 : cG >= 1.1 * Bu ? 0 : -1;
          if (lat < 0 || bC < 0 || bG < 0) return;
          const cpuOk = lat === 1 && bC === 1;
          let out;
          if (cpuOk && bG === 1) {
            if (Math.abs(cC - cG) / Math.min(cC, cG) < 0.1) return;
            out = cC < cG ? 'cpu' : 'gpu';
          } else out = cpuOk ? 'cpu' : bG === 1 ? 'gpu' : 'none';
          by[out].push([P, S, Bu, Tc, Pc, Tg]);
        }))))));
        const out = r.pick(['cpu', 'cpu', 'gpu', 'gpu', 'none']);
        const [P, S, Bu, Tc, Pc, Tg] = r.pick(by[out]);
        const nC = ceilx(P / Tc) + 1;
        const cC = nC * C6I * MES_H;
        const nG = ceilx(P / Tg) + 1;
        const cG = nG * T4H * MES_H;
        const latOk = Pc <= S;
        const budC = cC <= Bu;
        const budG = cG <= Bu;
        const okC = 'CPU: c6i.xlarge con ONNX Runtime INT8';
        const okG = 'GPU: T4 con TensorRT';
        const okN = 'Ninguna cumple las dos: negociar el SLO o el presupuesto antes de comprar';
        const bad = 'Una sola T4, sin N+1, para entrar en el presupuesto';
        const choices = r.shuffle([okC, okG, okN, bad]);
        const why = out === 'cpu'
          ? `Gana la <b>CPU</b>: cumple el p99 y ${budG ? 'sale ≈ ' + pct(1 - cC / cG) + ' % más barata que la GPU' : 'es la única que entra en el presupuesto'}. Además quitas un tier: sin engine atado a una GPU ni cold start de nodos GPU (M4).`
          : out === 'gpu'
            ? `Gana la <b>GPU</b>: ${!latOk ? 'la CPU no llega al p99 (' + Pc + ' ms contra ' + S + '), y las ' + nG + ' T4 entran en el presupuesto' : !budC ? 'la CPU no entra en el presupuesto y las ' + nG + ' T4 sí' : 'con esta carga, la CPU cuesta ≈ ' + pct(cC / cG - 1) + ' % más que las ' + nG + ' T4'}.`
            : `<b>Ninguna cumple las dos</b>: ${!latOk ? 'la CPU no llega al p99 (' + Pc + ' ms contra ' + S + ')' : 'la CPU no entra en el presupuesto'} y la GPU cuesta ≈ US$${f(cG)} contra US$${f(Bu)}. Se lleva a la mesa con números: ${latOk ? '≈ US$' + say(cC) + '/mes con CPU o ≈ US$' + say(cG) + '/mes con GPU (las dos cumplen el p99)' : '≈ US$' + say(cG) + '/mes para la GPU, la única que cumple el p99' + (budC ? ', o aceptar un p99 de ≈ ' + Pc + ' ms para quedarse en CPU' : '')}, o un modelo más chico.`;
        const say1 = out === 'cpu'
          ? `The quantized model meets the ${S}-millisecond p99 on CPU, and ${nC} small instances cost about $${say(cC)} a month, so I skip the GPU tier.`
          : out === 'gpu'
            ? (!latOk
              ? `CPU can't meet the ${S}-millisecond p99, so I serve on T4s: ${nG} GPUs with N+1, about $${say(cG)} a month, inside the budget.`
              : `At ${f(P)} requests per second the CPU fleet costs more than ${nG} T4s, so the GPU is the cheaper way to meet the p99.`)
            : `Neither option fits both the p99 and the $${say(Bu)} budget, so before buying anything I'd take the numbers to product: ${latOk ? 'about $' + say(cC) + ' a month on CPU or $' + say(cG) + ' on GPUs' : 'about $' + say(cG) + ' a month for GPUs'}, or a smaller model.`;
        return {
          q: `${st.org}. El modelo, ${st.model}, responde dentro del request: pico de diseño de <b>${f(P)} req/s</b>, <b>N+1</b> y un SLO de <b>p99 ≤ ${S} ms</b> para el tramo del modelo. Presupuesto: <b>US$${f(Bu)}/mes</b> para ese cómputo. El load test dio (medido):<ul><li><b>CPU</b>: c6i.xlarge (4 vCPU, ≈ US$0.17/h, aprox.) con ONNX Runtime INT8: ≈ <b>${Tc} req/s</b> planificados por instancia, con un p99 de ≈ <b>${Pc} ms</b>.</li><li><b>GPU</b>: T4 (g4dn.xlarge, ≈ US$0.526/h, aprox.) con TensorRT FP16: ≈ <b>${f(Tg)} req/s</b> planificados por GPU, con un p99 de ≈ <b>${st.pg} ms</b>.</li></ul>`,
          parts: [
            {
              ask: 'Instancias c6i.xlarge para el pico, con N+1', unit: 'instancias', answer: nC, tol: 0,
              steps: [
                'Planteamiento: instancias = ⌈pico ÷ capacidad planificada por instancia⌉ + 1.',
                `⌈${f(P)} ÷ ${Tc}⌉ = ⌈${f(P / Tc, 2)}⌉ = ${nC - 1}; + 1 = <b>${nC} instancias</b>`,
              ],
            },
            {
              ask: 'Costo mensual de la opción CPU', unit: 'US$/mes', answer: cC, tol: 0.15,
              steps: [
                'Planteamiento: instancias × US$/h × 730 h.',
                `Con el resultado anterior: ${nC} × 0.17 × 730 ≈ <b>US$${f(cC)}/mes</b>`,
              ],
            },
            {
              ask: 'Costo mensual de la opción GPU (T4 con N+1)', unit: 'US$/mes', answer: cG, tol: 0.15,
              steps: [
                'Planteamiento: T4 = ⌈pico ÷ capacidad planificada por GPU⌉ + 1; costo = T4 × 0.526 × 730.',
                `⌈${f(P)} ÷ ${f(Tg)}⌉ = ⌈${f(P / Tg, 2)}⌉ = ${nG - 1}; + 1 = ${nG} T4 → ${nG} × 0.526 × 730 ≈ <b>US$${f(cG)}/mes</b>`,
              ],
            },
            {
              ask: '¿Qué eliges?', choices, answer: choices.indexOf(out === 'cpu' ? okC : out === 'gpu' ? okG : okN),
              steps: [
                'Planteamiento: descarta lo que no cumple el p99 o no entra en el presupuesto; de lo que queda, la más barata.',
                `CPU: p99 ≈ ${Pc} ms ${latOk ? 'cumple' : 'no cumple'} los ${S} ms, y cuesta ≈ US$${f(cC)}, ${budC ? 'dentro' : 'fuera'} del presupuesto de US$${f(Bu)}. GPU: p99 ≈ ${st.pg} ms, cumple, y cuesta ≈ US$${f(cG)}, ${budG ? 'dentro' : 'fuera'} del presupuesto.`,
                why,
                'Una sola T4 sin N+1 entra en más presupuestos, pero una GPU caída es el servicio caído: no cumple el N+1 que pide la disponibilidad.',
              ],
            },
          ],
          hint: 'Dimensiona las dos opciones con la misma fórmula (⌈pico ÷ capacidad planificada⌉ + 1) y costéalas con 730 h. Después filtra: ¿cumple el p99? ¿entra en el presupuesto? De lo que pasa los dos filtros, la más barata; si nada pasa, se negocia.',
          takeaway: `<b>Requisito:</b> ${f(P)} req/s, p99 ≤ ${S} ms y US$${f(Bu)}/mes. <b>Números:</b> ${nC} c6i.xlarge ≈ US$${say(cC)}/mes (p99 ≈ ${Pc} ms) contra ${nG} T4 ≈ US$${say(cG)}/mes. <b>Decisión:</b> ${out === 'cpu' ? 'CPU con INT8' : out === 'gpu' ? 'GPU (T4)' : 'ninguna: se negocia el SLO o el presupuesto'}. <b>Trade-off:</b> la CPU gana con carga baja y modelos chicos si llega al p99; la GPU gana cuando el p99 es estricto o la carga llena varias instancias; el N+1 no se negocia. <i>"${say1}"</i>`,
        };
      },
    },

    // ======================================================== BATCHING DINÁMICO
    {
      id: 'sin-04', topic: 'sincrono', level: 2, title: 'Batching dinámico contra el p99', ref: 'm03.batching',
      gen(r) {
        const n = (P, thr) => ceilx(P / (0.7 * thr)) + 1;
        // Gana la configuración k (1, 2 o 3): la de más throughput que entra en el presupuesto del tramo (≥ 10 % de margen
        // contra su p99 y contra el de la siguiente). Para que no haya dos respuestas defendibles, k usa al menos una GPU
        // menos que la configuración anterior (con las mismas GPUs ganaría la anterior, por p99). Conteos lejos de un entero.
        const k = r.pick([1, 2, 3]);
        const opts = SIN04.map((x) => {
          const lt = x.cfg.map((c) => c[1] + c[2]);
          const thr = x.cfg.map((c) => c[3]);
          const buds = SIN04_BUD.filter((b) => b >= 1.1 * lt[k] && (k < 3 ? b <= lt[k + 1] / 1.1 : b <= 1.8 * lt[k]));
          const peaks = x.peaks.filter((p) => far(p / (0.7 * thr[0]), 0.05) && far(p / (0.7 * thr[k]), 0.05) && far(p / (0.7 * thr[k - 1])) && n(p, thr[k]) < n(p, thr[k - 1]));
          return { st: x, buds, peaks };
        }).filter((x) => x.buds.length && x.peaks.length);
        const pickd = r.pick(opts);
        const st = pickd.st;
        const Bm = r.pick(pickd.buds);
        const P = r.pick(pickd.peaks);
        const cfg = st.cfg;
        const lat = cfg.map((x) => x[1] + x[2]);
        const label = cfg.map((x) => (x[0] === 1 ? 'Batch 1, sin ventana' : `Hasta ${x[0]}, ventana de ${x[1]} ms`));
        const n1 = n(P, cfg[0][3]);
        const nk = n(P, cfg[k][3]);
        const save = (n1 - nk) * st.price * MES_H;
        const choices = r.shuffle(label.slice());
        const rows = cfg.map((x, i) => `<li>${label[i]}: ${i === 0 ? '' : 'batch lleno en '}<b>${x[2]} ms</b>${i === 0 ? ' por request' : ''}, <b>${f(x[3])} req/s</b></li>`).join('');
        const latTxt = cfg.map((x, i) => (i === 0 ? `batch 1: ${x[2]} ms` : `hasta ${x[0]}: ${x[1]} + ${x[2]} = ${lat[i]} ms`)).join(' · ');
        const priceTxt = st.price === T4H ? '0.526' : '0.805';
        return {
          q: `${st.org}. Sirve ${st.model} con Triton y dynamic batching, en ${st.gpu}, aprox.). Pico de diseño: <b>${f(P)} req/s</b>, con <b>N+1</b> y las GPUs planeadas al <b>70 %</b> de lo medido. Del SLO end-to-end, al tramo del modelo (cola + GPU) le tocan <b>${Bm} ms</b> de p99. Supuesto (simplificado): p99 del tramo ≈ ventana + batch lleno, lo que espera el request que abre un batch. Barrido con perf_analyzer por GPU (medido):<ul>${rows}</ul>`,
          parts: [
            {
              ask: 'GPUs sin batching (batch 1), al 70 % y con N+1', unit: 'GPUs', answer: n1, tol: 0,
              steps: [
                'Planteamiento: GPUs = ⌈pico ÷ (req/s medidos × 0.7)⌉ + 1.',
                `⌈${f(P)} ÷ (${f(cfg[0][3])} × 0.7)⌉ = ⌈${f(P)} ÷ ${f(0.7 * cfg[0][3])}⌉ = ⌈${f(P / (0.7 * cfg[0][3]), 2)}⌉ = ${n1 - 1}; + 1 = <b>${n1} GPUs</b>`,
              ],
            },
            {
              ask: '¿Qué configuración usas?', choices, answer: choices.indexOf(label[k]),
              steps: [
                `Planteamiento: p99 de cada configuración ≈ ventana + batch lleno; va la de más throughput que entra en los ${Bm} ms del tramo.`,
                `${latTxt}.`,
                `La configuración más grande que entra es <b>${label[k].toLowerCase()}</b> (${lat[k]} ms)${k < 3 ? '; la siguiente (' + lat[k + 1] + ' ms) se pasa' : ': es la más grande del barrido'}.`,
                k > 1
                  ? 'Las configuraciones más chicas también entran, pero dan menos req/s por GPU: más GPUs para el mismo pico. Batch 1 tira todo lo que el batching regala: cada lanzamiento de kernels y cada lectura de pesos se reparte entre menos requests.'
                  : 'Batch 1 entra siempre, pero tira el throughput que el batching regala: cada lanzamiento de kernels y cada lectura de pesos se reparte entre menos requests.',
                'Es un modelo simplificado: si la GPU todavía procesa otro batch, el request también lo espera. Por eso el p99 de la configuración elegida se confirma con perf_analyzer al QPS de diseño antes de fijarla (M3).',
              ],
            },
            {
              ask: 'GPUs con esa configuración (70 %, N+1)', unit: 'GPUs', answer: nk, tol: 0,
              steps: [
                'Planteamiento: la misma fórmula con el throughput de la configuración elegida.',
                `⌈${f(P)} ÷ (${f(cfg[k][3])} × 0.7)⌉ = ⌈${f(P / (0.7 * cfg[k][3]), 2)}⌉ = ${nk - 1}; + 1 = <b>${nk} GPUs</b>`,
              ],
            },
            {
              ask: 'Ahorro mensual frente a servir sin batching', unit: 'US$/mes', answer: save, tol: 0.15,
              steps: [
                'Planteamiento: GPUs que ahorras × US$/h × 730 h.',
                `Con los resultados anteriores: (${n1} − ${nk}) × ${priceTxt} × 730 ≈ <b>US$${f(save)}/mes</b>`,
                `El throughput sube ≈ ${f(cfg[k][3] / cfg[0][3], 1)}× a cambio de ≈ ${lat[k] - cfg[0][2]} ms de p99: rendimientos decrecientes, por eso se barre la ventana en pasos y se para en el codo (M3).`,
              ],
            },
          ],
          hint: 'Para cada configuración, p99 ≈ ventana + batch lleno: elige la de más throughput que entra en el presupuesto del tramo. GPUs = ⌈pico ÷ (req/s medidos × la utilización planeada)⌉ + 1, con y sin batching; el ahorro son las GPUs de diferencia × US$/h × 730.',
          takeaway: `<b>Requisito:</b> ${Bm} ms de p99 para el tramo y ${f(P)} req/s de pico. <b>Decisión:</b> ${label[k].toLowerCase()} (p99 ≈ ${lat[k]} ms). <b>Tamaño:</b> ${nk} GPUs contra ${n1} sin batching, ≈ US$${say(save)}/mes menos. <b>Trade-off:</b> cada ms de ventana compra throughput con latencia; ${k < 3 ? 'con ' + lat[k + 1] + ' ms o más de presupuesto, la siguiente configuración daría más req/s por GPU' : 'aquí el presupuesto deja usar la más grande del barrido'}. <i>"Dynamic batching up to ${cfg[k][0]} with a ${cfg[k][1]}-millisecond window still fits the ${Bm}-millisecond budget and cuts the fleet from ${n1} to ${nk} GPUs."</i>`,
        };
      },
    },

    // ======================================================== FAN-OUT Y COLA LARGA
    {
      id: 'sin-05', topic: 'sincrono', level: 3, title: 'Fan-out y la cola larga', ref: 'm03.timeouts-reintentos',
      gen(r) {
        // Resultado primero: hedging si alcanza (lentos ≤ 0.9 % y un rescate dentro del SLO con ≥ 10 % de margen);
        // si no, parciales cuando producto los acepta; si tampoco, menos fan-out (que tiene que cumplir con margen).
        const out = r.pick(['hedge', 'partial', 'less']);
        const st = r.pick(SIN05.filter((x) => (out === 'partial' ? x.partial : out === 'less' ? !x.partial : true)));
        const combos = [];
        [6, 8, 10, 12, 16, 20, 24, 32, 40].forEach((N) => [0.2, 0.3, 0.5, 1, 1.5, 2, 3].forEach((p) => [60, 70, 80, 100, 120, 150].forEach((S) => st.nps.forEach((Np) => {
          const q1 = p / 100;
          const now = 1 - Math.pow(1 - q1, N);
          const ph = 1 - Math.pow(1 - q1 * q1, N);
          const lh = st.o + st.H + st.c;
          const less = 1 - Math.pow(1 - q1, Np);
          if (now < 0.011 || now > 0.4 || st.o + st.c > 0.9 * S) return;   // un problema real, pero no un sistema roto
          const hOk = ph <= 0.009 && lh <= 0.9 * S;
          const hNo = ph >= 0.011 || lh >= 1.1 * S;
          if (!hOk && !hNo) return;
          let o2;
          if (hOk) o2 = 'hedge';
          else if (st.partial) o2 = 'partial';
          else if (less <= 0.009 && st.o + st.c + 10 <= 0.9 * S) o2 = 'less';
          else return;
          if (o2 === out) combos.push([N, p, S, Np]);
        }))));
        const [N, p, S, Np] = r.pick(combos);
        const q1 = p / 100;
        const now = 1 - Math.pow(1 - q1, N);
        const ph = 1 - Math.pow(1 - q1 * q1, N);
        const lh = st.o + st.H + st.c;
        const less = 1 - Math.pow(1 - q1, Np);
        const c2 = st.c + 10;
        const okH = `Hedging: copia a la otra réplica si no respondió a los ${st.H} ms, y cancelar la perdedora`;
        const okP = 'Un timeout por llamada que responde a tiempo con resultados parciales';
        const okL = 'Menos fan-out: ' + st.less(Np);
        const bad = 'Reintentar cada llamada que pase de 300 ms';
        const choices = r.shuffle([okH, okP, okL, bad]);
        const mon = {
          hedge: 'La tasa de hedges disparados y el p99 por réplica: si los hedges pasan de ≈ 5 %, la lentitud ya no es al azar y el hedge solo suma carga',
          partial: `El % de respuestas parciales por ${st.unit}: si siempre falta el mismo, hay un hueco silencioso en los resultados`,
          less: `El p99 por llamada y la memoria de cada ${st.unit} grande: con menos ${st.unit === 'servicio' ? 'servicios' : 'shards'}, cada pausa o cada nodo caído pesa más`,
        }[out];
        const monBad = ['Solo el p50 end-to-end: el p99 es ruido', 'El promedio de los p99 de cada llamada', 'La CPU promedio de toda la flota'];
        const mChoices = r.shuffle([mon].concat(monBad));
        const hTxt = `Hedging: deja ${g(ph * 100)} % de requests lentos (${ph < 0.01 ? 'debajo' : 'arriba'} del 1 %), y un request rescatado tarda ${lh} ms, ${lh <= S ? 'dentro' : 'fuera'} del SLO de ${S} ms.`;
        const pTxt = `Parciales: ${st.partial ? 'producto los acepta; responder a tiempo con lo que llegó deja ≈ ' + f(now * 100, 1) + ' % de las respuestas con algo faltante' : 'producto no los acepta'}.`;
        const lTxt = `Menos fan-out: con ${st.lessS(Np)} quedan ${f(less * 100, 2)} % de requests lentos (${less < 0.0099 ? 'debajo del' : less > 0.0101 ? 'arriba del' : 'justo en el'} 1 %), pero pide un cambio de arquitectura y cada llamada pasa a ≈ ${c2} ms: es la palanca más cara.`;
        const decide = out === 'hedge'
          ? 'Gana el <b>hedging</b>: arregla la cola con ≈ 5 % más de llamadas, sin perder resultados ni rehacer la arquitectura. Funciona porque las pausas son al azar e independientes por réplica, y leer es idempotente.'
          : out === 'partial'
            ? `Gana el <b>timeout con parciales</b>. El hedging ${ph >= 0.011 ? 'no baja los lentos del 1 %' : 'rescata tarde (' + lh + ' ms no entran en ' + S + ')'}, y producto acepta responder con lo que llegó.${now >= 0.15 ? ' Con ≈ ' + f(now * 100, 0) + ' % de respuestas incompletas, en paralelo se ataca la causa de las pausas (GC, compactación).' : ''}`
            : `Gana <b>menos fan-out</b>. El hedging ${ph >= 0.011 ? 'no baja los lentos del 1 %' : 'rescata tarde (' + lh + ' ms no entran en ' + S + ')'}, los parciales no se aceptan, y con ${st.lessS(Np)} quedan ${f(less * 100, 2)} % de lentos.`;
        const say1 = out === 'hedge'
          ? `With a fan-out of ${N}, about ${f(now * 100, 0)}% of requests hit a pause; hedging at the p95 brings that to roughly ${g(ph * 100)}% for about five percent more calls.`
          : out === 'partial'
            ? `Hedging can't get under one percent within ${S} milliseconds here, and product accepts partial results, so each call gets a timeout and I return what arrived.`
            : `Hedging doesn't fix the tail here and partial results aren't acceptable, so I reduce the fan-out to ${Np} and accept the bigger ${st.unit === 'servicio' ? 'services' : 'shards'}.`;
        return {
          q: `${st.org(N)}. Medido: cada llamada responde en ≈ <b>${st.c} ms</b>, pero el <b>${f(p)} %</b> cae en una pausa de ≈ 300 ms (GC o compactación) de su réplica; cada ${st.unit} tiene 2 réplicas, con pausas al azar e independientes. Antes y después del fan-out se van ≈ <b>${st.o} ms</b>. SLO: <b>p99 ≤ ${S} ms</b>. ${st.why} Opciones, en orden de preferencia (si varias cumplen, va la primera):<ul><li>Hedging: si una llamada no respondió a los <b>${st.H} ms</b> (su p95), se manda una copia a la otra réplica y se cancela la perdedora (≈ 5 % más de llamadas).</li><li>Un timeout por llamada que responde a tiempo con lo que llegó.</li><li>Menos fan-out: ${st.less(Np)}, con llamadas de ≈ ${c2} ms.</li></ul>`,
          parts: [
            {
              ask: '% de requests que hoy tocan al menos una pausa', unit: '%', answer: now * 100, tol: 0.15,
              steps: [
                'Planteamiento: el request es rápido solo si las N llamadas lo son: P(lento) = 1 − (1 − p)<sup>N</sup>.',
                `1 − (1 − ${g(q1)})<sup>${N}</sup> = 1 − ${f(1 - now, 4)} ≈ <b>${f(now * 100, 1)} %</b>`,
                `El p99 pide menos de 1 %: hoy hay ≈ ${f(now * 100, 1)}× más lentos de los que permite el SLO.`,
              ],
            },
            {
              ask: '% de requests lentos con hedging (una llamada es lenta solo si el original y la copia caen en pausa)', unit: '%', answer: ph * 100, tol: 0.15,
              steps: [
                'Planteamiento: con el hedge, una llamada es lenta con probabilidad p²; con N llamadas, 1 − (1 − p²)<sup>N</sup> ≈ N × p².',
                `p² = ${g(q1 * q1)} → 1 − (1 − ${g(q1 * q1)})<sup>${N}</sup> ≈ <b>${g(ph * 100)} %</b>`,
              ],
            },
            {
              ask: 'Latencia de un request que el hedge rescata (lo de antes y después del fan-out + espera del hedge + una llamada normal)', unit: 'ms', answer: lh, tol: 0.05,
              steps: [
                'Planteamiento: el request espera el hedge completo y después la llamada normal de la copia.',
                `${st.o} + ${st.H} + ${st.c} = <b>${lh} ms</b>`,
              ],
            },
            {
              ask: `% de requests lentos con menos fan-out (${st.lessS(Np)})`, unit: '%', answer: less * 100, tol: 0.15,
              steps: [
                'Planteamiento: la misma fórmula con menos llamadas: 1 − (1 − p)<sup>N\'</sup>.',
                `1 − (1 − ${g(q1)})<sup>${Np}</sup> ≈ <b>${f(less * 100, 2)} %</b>`,
              ],
            },
            {
              ask: '¿Qué haces?', choices, answer: choices.indexOf(out === 'hedge' ? okH : out === 'partial' ? okP : okL),
              steps: [
                'Planteamiento: el p99 pide menos de 1 % de requests lentos. Se revisan las opciones en el orden de preferencia (el hedge deja respuestas completas por ≈ 5 % más de llamadas; los parciales no suman carga pero pierden resultados; menos fan-out es rehacer la arquitectura) y va la primera que lo logra sin romper otro requisito.',
                hTxt,
                pTxt,
                lTxt,
                decide,
                'Reintentar al pasar de 300 ms llega tarde (el request ya rompió el SLO) y suma carga justo sobre la réplica en pausa: un reintento no es un hedge.',
              ],
            },
            {
              ask: '¿Qué monitoreas para saber que el arreglo sigue funcionando?', choices: mChoices, answer: mChoices.indexOf(mon),
              steps: [
                'Planteamiento: se monitorea el supuesto que hace funcionar el arreglo y la cola por pieza, no un promedio.',
                out === 'hedge'
                  ? 'El hedge vale mientras la lentitud sea al azar y por réplica. Si la tasa de hedges sube, la causa se volvió común (saturación, una dependencia lenta) y cada copia agrega carga al tier más cargado: alerta y un tope de hedges.'
                  : out === 'partial'
                    ? 'Una respuesta parcial no es un error: no aparece en los 5xx. Si el mismo shard falta siempre, una parte del catálogo desaparece en silencio; por eso se cuenta por shard, con alerta.'
                    : `Con menos ${st.unit === 'servicio' ? 'servicios' : 'shards'}, cada uno es más grande: su p99 y su memoria son ahora el riesgo, y una caída se lleva una parte mayor de la respuesta.`,
                'El p50 no ve la cola, y los percentiles no se promedian: se calculan sobre los buckets agregados (M3). La CPU promedio no dice nada de una pausa de 300 ms en una réplica.',
              ],
            },
          ],
          hint: 'El request es lento si cualquiera de sus N llamadas lo es: 1 − (1 − p)ᴺ. Con hedge, una llamada es lenta solo si las dos copias lo son (p²), y un request rescatado espera el hedge más una llamada normal. Compara cada opción contra el 1 % que permite el p99 y contra el SLO, en el orden de preferencia: va la primera que cumple.',
          takeaway: `<b>Requisito:</b> p99 ≤ ${S} ms con un fan-out de ${N} y ${f(p)} % de pausas por llamada (≈ ${f(now * 100, 1)} % de requests lentos hoy). <b>Decisión:</b> ${out === 'hedge' ? 'hedging al p95' : out === 'partial' ? 'timeout por llamada con resultados parciales' : 'menos fan-out (' + st.lessS(Np) + ')'}. <b>Por qué:</b> ${out === 'hedge' ? 'baja los lentos a ≈ ' + g(ph * 100) + ' % con ≈ 5 % más de llamadas' : out === 'partial' ? 'el hedge no alcanza y producto acepta parciales' : 'el hedge no alcanza y los parciales no se aceptan'}. <b>Trade-off:</b> el hedge cuesta carga, los parciales cuestan completitud y menos fan-out cuesta arquitectura; se elige con los números de la cola, no por costumbre. <i>"${say1}"</i>`,
        };
      },
    },

    // ======================================================== TIMEOUTS Y FALLBACK
    {
      id: 'sin-06', topic: 'sincrono', level: 3, title: 'Timeouts y fallback', ref: 'm15.degradacion',
      gen(r) {
        const st = r.pick(SIN06);
        const L = st.lat;
        const pctl = [90, 95, 99];
        // Timeout que gana (0: p90, 1: p95, 2: p99) y si los gateways aguantan el 100 % del tráfico en el fallback;
        // cada comparación a ≥ 10 %.
        const kT = r.pick([0, 1, 2]);
        const cap = r.pick(['ok', 'no']);
        const combos = [];
        [120, 150, 200, 250, 300].forEach((S) => [40, 60, 80, 100].forEach((O) => [2, 4, 6].forEach((F) => [400, 800, 1500, 3000, 6000].forEach((P) => [4, 8, 16, 24].forEach((V) => {
          const Tm = S - O - F;
          const opts = [L[1], L[2], L[3]];
          if (opts.some((x) => Math.abs(x - Tm) / Tm < 0.1)) return;
          let w = -1;
          opts.forEach((x, i) => { if (x <= Tm) w = i; });
          if (w !== kT) return;
          const cores = (P * F) / 1000;
          const c2 = cores <= 0.9 * V ? 'ok' : cores >= 1.1 * V ? 'no' : '';
          if (c2 === cap) combos.push([S, O, F, P, V]);
        })))));
        const [S, O, F, P, V] = r.pick(combos);
        const e = r.pick([0.1, 0.2, 0.5]);
        const A = r.pick([99.9, 99.95]);
        const Tm = S - O - F;
        const T = L[kT + 1];
        const fb = 100 - pctl[kT] + e;
        const blend = (1 - fb / 100) * st.qp + (fb / 100) * st.qf;
        const cores = (P * F) / 1000;
        const tNames = [`${L[1]} ms (p90 del modelo)`, `${L[2]} ms (p95 del modelo)`, `${L[3]} ms (p99 del modelo)`];
        const tBad = 'Sin timeout: esperar siempre al modelo';
        const tChoices = r.shuffle(tNames.concat([tBad]));
        const alertOk = `La tasa de fallback por motivo (timeout o error), con alerta si pasa de ≈ ${f(2 * fb, 1)} % (el doble de lo normal)`;
        const aChoices = r.shuffle([alertOk, `Solo el p99 end-to-end, con alerta si pasa de los ${S} ms del SLO`, `La tasa de 5xx del endpoint, con alerta si pasa del ${f(2 * e, 1)} % (el doble de los errores del modelo)`, 'La utilización de la GPU del modelo, con alerta si pasa del 70 %']);
        const failOk = `Todo va al fallback: la calidad baja a ≈ ${st.qf} %, sin errores, porque los gateways aguantan el 100 % del pico`;
        const failNo = 'Todo va al fallback, pero los gateways no alcanzan para el 100 % del pico: hace falta CPU reservada para el fallback o load shedding';
        const fChoices = r.shuffle([failOk, failNo, 'Todos los requests fallan con 504 hasta que vuelva el modelo', 'No pasa nada visible: el autoscaler repone el modelo en segundos']);
        const fits = (x) => (x <= Tm ? 'entra' : 'no entra');
        return {
          q: `${st.org}: ${st.model} responde dentro del request, con un SLO de <b>p99 ≤ ${S} ms</b> end-to-end y <b>${A} %</b> de disponibilidad (una respuesta del fallback cuenta como buena). Medido: el resto del camino (gateway, features y respuesta) se lleva ≈ <b>${O} ms</b> de p99; el modelo tarda p50 ${L[0]} ms, p90 <b>${L[1]} ms</b>, p95 <b>${L[2]} ms</b> y p99 <b>${L[3]} ms</b>, y falla (5xx) en el <b>${e} %</b> de las llamadas; el fallback, ${st.fb}, tarda ≈ <b>${F} ms</b> de CPU y no depende del modelo. ${st.metric} en un A/B: <b>${st.qp} %</b> con el modelo y <b>${st.qf} %</b> con el fallback. En el pico llegan <b>${f(P)} req/s</b> y los gateways tienen ≈ <b>${V} vCPU</b> libres.`,
          parts: [
            {
              ask: 'Timeout máximo hacia el modelo para que un request que cae al fallback siga dentro del SLO', unit: 'ms', answer: Tm, tol: 0.05,
              steps: [
                'Planteamiento: el peor request espera el timeout entero y después corre el fallback: resto del camino + timeout + fallback ≤ SLO.',
                `${S} − ${O} − ${F} = <b>${Tm} ms</b>`,
              ],
            },
            {
              ask: '¿Qué timeout pones?', choices: tChoices, answer: tChoices.indexOf(tNames[kT]),
              steps: [
                'Planteamiento: el timeout más largo que entra en el máximo. Cada ms de más deja que el modelo termine más requests: menos fallback, más calidad.',
                `Con el resultado anterior (${Tm} ms): p90 ${L[1]} ms ${fits(L[1])} · p95 ${L[2]} ms ${fits(L[2])} · p99 ${L[3]} ms ${fits(L[3])}. Va <b>${tNames[kT]}</b>.`,
                'Sin timeout, un modelo lento arrastra el p99 entero y deja requests colgados (Little): el fallback nunca llega a tiempo.',
              ],
            },
            {
              ask: '% del tráfico que sirve el fallback con ese timeout', unit: '%', answer: fb, tolAbs: 0.05,
              steps: [
                'Planteamiento: lo que pasa del timeout (100 − el percentil del timeout) más lo que falla.',
                `(100 − ${pctl[kT]}) + ${e} = <b>${f(fb, 1)} %</b>`,
              ],
            },
            {
              ask: `Calidad mezclada (${st.mShort})`, unit: '%', answer: blend, tolAbs: 0.1,
              steps: [
                'Planteamiento: promedio ponderado: (1 − f) × calidad del modelo + f × calidad del fallback.',
                `Con el resultado anterior: (1 − ${g(fb / 100)}) × ${st.qp} + ${g(fb / 100)} × ${st.qf} ≈ <b>${f(blend, 2)} %</b>`,
                `≈ ${f(st.qp - blend, 2)} puntos menos que con el modelo siempre: el precio de cumplir el SLO.`,
              ],
            },
            {
              ask: '¿Qué alerta pones?', choices: aChoices, answer: aChoices.indexOf(alertOk),
              steps: [
                'Planteamiento: el fallback responde rápido y con 200, así que un modelo lento o caído no se ve en el p99 ni en los 5xx: un fail-open que nadie mide esconde la caída (M2).',
                `Lo normal es ≈ ${f(fb, 1)} %; una alerta al doble avisa mientras el SLO sigue verde, y el motivo separa «modelo lento» de «modelo con errores».`,
                'El p99 y los 5xx quedan verdes justamente porque el fallback funciona; la utilización de la GPU puede estar en cualquier valor sin decir nada de la calidad.',
              ],
            },
            {
              ask: 'Si el modelo se cae entero, ¿qué pasa?', choices: fChoices, answer: fChoices.indexOf(cap === 'ok' ? failOk : failNo),
              steps: [
                'Planteamiento: con el modelo caído, el 100 % del tráfico corre el fallback: CPU = req/s × segundos de CPU por request.',
                `${f(P)} × ${F} ms = ${f(cores, 1)} vCPU contra ${V} libres: ${cap === 'ok' ? 'alcanza' : 'no alcanza'}.`,
                cap === 'ok'
                  ? `La disponibilidad (${A} %) se cumple porque el fallback cuenta como buena respuesta; lo que cae es la calidad, a ≈ ${st.qf} %, y la alerta de la tasa de fallback lo avisa.`
                  : `Sin CPU para todos, el fallback mismo se satura y llegan los errores: el ${A} % se rompe. Se reserva CPU para el peor caso (≈ ${f(cores, 1)} vCPU) o se descarta barato lo de menor prioridad.`,
                'Con un fallback que no depende del modelo no hay 504 masivos; y un nodo GPU nuevo tarda minutos en servir, no segundos (M6).',
              ],
            },
          ],
          hint: 'El peor request espera el timeout entero y después el fallback: eso fija el timeout máximo, y eliges el percentil más alto que entra. La fracción al fallback es lo que pasa del timeout más los errores; la calidad es el promedio ponderado. Después: qué alerta ve una caída silenciosa y si el fallback aguanta todo el tráfico.',
          takeaway: `<b>Requisito:</b> p99 ≤ ${S} ms y ${A} % de disponibilidad. <b>Decisión:</b> timeout de ${T} ms (≈ p${pctl[kT]}), que deja ≈ ${f(fb, 1)} % del tráfico en el fallback y una calidad de ≈ ${f(blend, 1)} %. <b>Cómo falla:</b> sin modelo, todo va al fallback (≈ ${f(cores, 1)} vCPU, ${cap === 'ok' ? 'que los gateways tienen' : 'más de lo que hay libre'}); por eso la tasa de fallback lleva alerta. <b>Trade-off:</b> un timeout más largo da más calidad y más latencia; uno más corto protege el SLO a costa de calidad. <i>"The timeout is what's left of the budget after the fallback, ${T} milliseconds here, so about ${say(fb)}% of requests fall back; I alert on the fallback rate, because a silent fail-open hides an outage."</i>`,
        };
      },
    },
  );
})(typeof window !== 'undefined' ? window : globalThis);
