/* Banco de problemas · Casos de diseño: casos completos de entrevista, agrupados por patrón (M2) más LLMs y RAG.
   Este archivo define la sección (MSD.problemBank.casos): temas, tarjetas de referencia y utilidades. Las
   plantillas viven en un archivo por tema que se carga DESPUÉS de este (y de banco-estimaciones.js):
     banco-casos-sincrono.js · banco-casos-batch.js · banco-casos-asincrono.js · banco-casos-llm.js ·
     banco-casos-hibrido.js · banco-casos-streaming.js · banco-casos-edge.js
   Cada archivo de tema hace B.templates.push(...) y B.formulas.push(...) con las utilidades de B.util.
   Mismo contrato que banco-estimaciones.js: gen(r) → {q, parts, hint, takeaway}; r = {pick, int, chance, shuffle}.
   Un caso completo: requisitos con números (volumen, latencia, presupuesto, frescura, disponibilidad) → patrón →
   estimación → tamaño y costo contra el presupuesto → trade-off (en nivel 3, también cómo falla y qué monitoreas).
   Las decisiones que dependen de los números se calculan en gen(). Precios y specs: js/content/ref-numeros.js,
   M13 y los casos, marcados "aprox." o como supuesto. Convenciones: 1 día = 86,400 s · mes de costos = 730 h ·
   mes de un SLO = 30 días (43,200 min) · KB/MB/GB/TB en potencias de diez. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  MSD.problemBank = MSD.problemBank || {};
  if (MSD.problemBank.casos) return;   // ya cargado

  // Formato de números como en el curso: miles con coma, decimales con punto.
  const f = (x, d) => {
    const n = Number(x);
    const dec = d === undefined ? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2) : d;
    return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  };
  // Tres cifras significativas para números chicos (US$0.000243, 0.0005); f() para el resto.
  const g = (x) => {
    const n = Number(x);
    const a = Math.abs(n);
    if (a === 0) return '0';
    if (a >= 1) return f(n);
    const dec = Math.min(9, 2 - Math.floor(Math.log10(a)));
    return n.toLocaleString('en-US', { maximumFractionDigits: dec, minimumFractionDigits: 0 });
  };
  // Redondeos de conteo a prueba de ruido de punto flotante (1200 × 0.002 ÷ 0.6 = 4.000000000000001).
  const ceilx = (x) => Math.ceil(x - 1e-9);
  const floorx = (x) => Math.floor(x + 1e-9);
  // Dos cifras significativas (232.7 → 230 · 3.64 → 3.6), para razones y factores.
  const s2 = (x) => Number(Number(x).toPrecision(2)).toLocaleString('en-US', { maximumFractionDigits: 6 });
  // Lo que se dice en voz alta: enteros desde 10 y dos cifras significativas desde 1,000 (3,611 → 3,600).
  const say = (x) => {
    const n = Number(x);
    if (Math.abs(n) < 10) return f(n);
    if (Math.abs(n) < 1000) return f(n, 0);
    const p = Math.pow(10, Math.floor(Math.log10(Math.abs(n))) - 1);
    return f(Math.round(n / p) * p);
  };
  // Hacia arriba con dos cifras significativas: el número defendible del pico de diseño (3,611 → 3,700).
  const up2 = (x) => {
    const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
    return Math.ceil(x / p - 1e-9) * p;
  };
  // Lejos de un entero: ⌈x⌉ o ⌊x⌋ no cambian si la persona redondeó un paso anterior (t = margen, 0.03 por defecto).
  const far = (x, t) => {
    const m = t === undefined ? 0.03 : t;
    const fr = x - Math.floor(x);
    return fr > m && fr < 1 - m;
  };
  const DAY = 86400;     // s por día
  const MES_H = 730;     // h por mes, para costos (365 × 24 ÷ 12)
  const MES_MIN = 43200; // min en la ventana de 30 días de un SLO

  // Tarjetas propias de la sección; las de números se comparten con Estimaciones (una sola fuente).
  const Q_PATRON = { id: 'q-patron', title: '¿Qué patrón? Las tres preguntas (M2)', html: `
    <ol>
      <li><b>¿Dónde vive el dato y alcanza la red?</b> Si nace en un dispositivo y mandarlo es lento, caro, poco confiable o no está permitido: edge, al menos como primer filtro. Si no, el default es el servidor.</li>
      <li><b>¿El input existe antes de que alguien pida la predicción?</b> Si el conjunto es enumerable y cambia lento (usuarios, catálogo): batch y un lookup de ms.</li>
      <li><b>¿Alguien espera la respuesta, y cuánto?</b> Una persona o un servicio bloqueado, de ms a ≈ 1 s: online síncrono. Segundos a horas, o nadie espera: asíncrono con cola. Un flujo continuo de eventos con frescura de segundos: streaming.</li>
    </ol>
    <table class="dtable"><thead><tr><th>Patrón</th><th>Latencia</th><th>Frescura</th><th>Escala con</th><th>Alerta principal</th></tr></thead><tbody>
      <tr><td>Online síncrono</td><td>ms a ≈ 1 s</td><td>La del request</td><td>Concurrencia</td><td>p99, errores, tasa de fallback</td></tr>
      <tr><td>Asíncrono con cola</td><td>Segundos a horas</td><td>La del job</td><td>Backlog por worker</td><td>Edad del mensaje más viejo, DLQ</td></tr>
      <tr><td>Batch</td><td>Horas por corrida; lookup en ms</td><td>La de la última corrida</td><td>Volumen vs ventana</td><td>Edad de la versión activa</td></tr>
      <tr><td>Streaming</td><td>ms a segundos</td><td>Segundos</td><td>Consumer lag y particiones</td><td>Lag en tiempo</td></tr>
      <tr><td>Edge / on-device</td><td>ms, sin red</td><td>La del sensor</td><td>Por dispositivo</td><td>Versiones en la flota, heartbeat</td></tr>
    </tbody></table>
    <p>Casi todos los sistemas reales combinan dos patrones (híbridos). "Real-time" no es un requisito: pregunta quién espera y cuánto.</p>` };
  const Q_PIEZAS = { id: 'q-piezas', title: 'Piezas típicas de cada patrón', html: `
    <ul>
      <li><b>Online síncrono:</b> load balancer → gateway (FastAPI: auth, timeouts) → model server (Triton, ONNX Runtime) · HPA por concurrencia · fallback.</li>
      <li><b>Asíncrono:</b> POST → 202 con job_id → cola (SQS, Pub/Sub) → workers que escalan por backlog (KEDA) → resultado en S3 o la DB + webhook · DLQ · idempotencia por job_id.</li>
      <li><b>Batch:</b> orquestador (Airflow) → job con batches grandes (Spark, Ray o un script; spot) → tabla o KV (Redis, DynamoDB) publicada de forma atómica → lookup en ms con fallback.</li>
      <li><b>Streaming:</b> log de eventos (Kafka, Kinesis) → procesador con estado (Flink) → feature store online o alertas · paralelismo = particiones.</li>
      <li><b>Edge:</b> modelo compilado en el dispositivo (TensorRT en Jetson, Core ML, TFLite) → a la nube solo eventos y métricas · OTA por etapas.</li>
      <li><b>LLMs:</b> gateway (cuotas, caché, fallback de proveedor) → API o vLLM propio · RAG: embeddings + vector DB (pgvector, Qdrant) + reranker.</li>
    </ul>` };
  const Q_DECIR = { id: 'q-decir', title: 'Cómo defender la elección', html: `
    <p><b>Requisito que decide → patrón → alternativa descartada y la condición que te haría cambiar.</b> Con números: el costo, la latencia o la frescura que lo decide.</p>
    <ul>
      <li>"The seller is waiting on the form, so this is synchronous, with a timeout and a fallback. If the product could show the result a minute later, I'd use a queue with big batches: much cheaper."</li>
      <li>"Nobody is blocked on this result, so I'll return a 202 with a job ID and process it from a queue."</li>
      <li>"The inputs exist ahead of time and a day of staleness is fine, so I'll precompute nightly and serve a lookup."</li>
    </ul>` };
  const E = MSD.problemBank.estimaciones;
  const shared = (id) => (E && Array.isArray(E.quick) ? E.quick.find((q) => q.id === id) || null : null);

  MSD.problemBank.casos = {
    id: 'casos',
    title: 'Casos de diseño',
    summary: 'Casos completos de entrevista con requisitos concretos (volumen, latencia, presupuesto, frescura): eliges el patrón, estimas, dimensionas, comparas contra el presupuesto y defiendes el trade-off. Agrupados por patrón de M2, más LLMs y RAG.',
    // En orden de lo que más se ve en trabajos reales.
    topics: [
      { id: 'sincrono', title: 'Online síncrono' },
      { id: 'batch', title: 'Batch' },
      { id: 'asincrono', title: 'Asíncrono con colas' },
      { id: 'llm', title: 'LLMs y RAG' },
      { id: 'hibrido', title: 'Híbridos' },
      { id: 'streaming', title: 'Streaming' },
      { id: 'edge', title: 'Edge y on-device' },
    ],
    formulas: [],
    quick: [Q_PATRON, Q_PIEZAS, Q_DECIR, shared('q-latencias'), shared('q-precios'), shared('q-gpus'), shared('q-tiempo')].filter(Boolean),
    templates: [],
    // Utilidades para los archivos de tema (banco-casos-*.js). El motor (js/ui/bank.js) no las usa.
    util: { f, g, ceilx, floorx, s2, say, up2, far, DAY, MES_H, MES_MIN },
  };
})(typeof window !== 'undefined' ? window : globalThis);
