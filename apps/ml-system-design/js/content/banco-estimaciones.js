/* Banco de problemas · Estimaciones: plantillas con números nuevos en cada problema (lo usa js/ui/bank.js).
   Cada plantilla recibe `r` (r.pick · r.int · r.chance · r.shuffle) y devuelve {q, parts, hint, takeaway}.
   Partes numéricas: tol relativa (0.15 = ±15 %), tol 0 = entero exacto, tolAbs = tolerancia absoluta
   (disponibilidad y percentiles, en unidades de %). Partes de opción: choices + answer (índice).
   Números y precios: los de js/content/ref-numeros.js y los módulos (M1, M3, M4, M12–M15, c01, c08, c10),
   marcados "aprox." en el enunciado. Convenciones: 1 día = 86,400 s · mes de costos = 730 h ·
   mes de un SLO = 30 días (43,200 min) · KB/MB/GB/TB en potencias de diez; KiB/GiB solo en el KV cache. */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  MSD.problemBank = MSD.problemBank || {};

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
  // Lo que se dice en voz alta: sin precisión falsa ("≈ 116" o "≈ 120", nunca "115.74"): enteros desde 10
  // (69.4 → 69) y, desde 1,000, dos cifras significativas (3,611 → 3,600 · 48,881 → 49,000).
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
  const DAY = 86400;     // s por día
  const MES_H = 730;     // h por mes, para costos (365 × 24 ÷ 12)
  const MES_MIN = 43200; // min en la ventana de 30 días de un SLO

  MSD.problemBank.estimaciones = {
    id: 'estimaciones',
    title: 'Estimaciones',
    summary: 'Cuentas back-of-the-envelope con números nuevos en cada problema: tráfico, latencia, disponibilidad, hardware, costo, almacenamiento y red, y escenarios encadenados como en el paso 3 de la entrevista.',
    topics: [
      { id: 'trafico', title: 'Tráfico' },
      { id: 'latencia', title: 'Latencia' },
      { id: 'disponibilidad', title: 'Disponibilidad' },
      { id: 'hardware', title: 'Hardware' },
      { id: 'costo', title: 'Costo' },
      { id: 'datos', title: 'Almacenamiento y red' },
      { id: 'escenario', title: 'Escenarios completos' },
    ],

    // ------------------------------------------------------------ formulario
    formulas: [
      { topic: 'trafico', title: 'QPS promedio', expr: 'req/s = volumen diario ÷ 86,400 s', ex: '10 M/día ÷ 86,400 ≈ 116 req/s · atajo: 1 M/día ≈ 11.6 req/s' },
      { topic: 'trafico', title: 'Pico y pico de diseño', expr: 'pico = promedio × factor (2–5×; = 24 × fracción del día que cae en la hora pico) · diseño = pico × margen (1.3–1.5×)', ex: '116 × 3 ≈ 350 → × ≈ 1.4 → 500 req/s · hora pico con 12.5 % del día → 3×' },
      { topic: 'trafico', title: 'Crecimiento compuesto', expr: 'dentro de n periodos = hoy × (1 + g)ⁿ · se duplica cada ≈ 72 ÷ g(%) periodos', ex: '10 %/mes durante 12 meses ≈ 3.1× (no 2.2×)' },
      { topic: 'trafico', title: 'Reintentos y fan-out', expr: 'intentos = (1 + reintentos)^capas · llamadas internas = req/s × fan-out', ex: '(1 + 3)³ = 64 intentos · 3,100 req/s × 1,000 candidatos ≈ 3.1 M scores/s' },
      { topic: 'trafico', title: 'Vaciar un backlog', expr: 'tiempo = backlog ÷ (capacidad − llegada)', ex: '60,000 ÷ (200 − 50) = 400 s ≈ 7 min; con capacidad 60: 100 min' },

      { topic: 'latencia', title: 'Little', expr: 'L = λ · W (W promedio, en segundos; nunca el p99)', ex: '500 req/s × 0.05 s = 25 en vuelo · techo con el timeout: 500 × 0.15 s = 75' },
      { topic: 'latencia', title: 'Utilización y cola (M/M/1)', expr: 'ρ = llegadas ÷ capacidad · W = S ÷ (1 − ρ) · espera en cola W_q = ρS ÷ (1 − ρ) · p99 ≈ 4.6 × W', ex: 'S = 10 ms: ρ 0.5 → W 20 ms · ρ 0.8 → 50 ms · ρ 0.9 → 100 ms' },
      { topic: 'latencia', title: 'Fan-out y cola', expr: 'P(lento) = 1 − 0.99ᴺ ≈ 1 − e^(−N/100) · percentil por backend para 1 % ≈ 1 − 0.01 ÷ N', ex: 'N = 10 → 9.6 % · N = 100 → 63 %, y cada backend tendría que cumplir su p99.99' },
      { topic: 'latencia', title: 'Presupuesto serial', expr: 'en serie se suma cada tramo (la suma de p99 es pesimista: sirve para repartir) · física: RTT ≥ 1 ms por cada 100 km', ex: 'c01: ≈ 150 ms pesimista de un SLO de 200 ms · costa a costa (3,500 km): ≥ 35 ms, medido 60–80' },
      { topic: 'latencia', title: 'LLM con streaming', expr: 'e2e = TTFT + (tokens − 1) × TPOT · tokens/s = 1 ÷ TPOT', ex: '0.6 + 249 × 0.04 ≈ 10.6 s · 40 ms → 25 tokens/s (una persona lee 4–7)' },

      { topic: 'disponibilidad', title: 'Caída permitida', expr: 'caída = (1 − A) × duración de la ventana (30 días = 43,200 min)', ex: '99.9 % → 43.2 min/mes · 99.99 % → 4.3 min · 99 % → 7.2 h' },
      { topic: 'disponibilidad', title: 'Presupuesto de error', expr: 'requests que pueden fallar = (1 − SLO) × requests de la ventana', ex: '0.001 × 10 M/día × 30 = 300,000 requests/mes' },
      { topic: 'disponibilidad', title: 'Serie y paralelo', expr: 'serie: A₁ × A₂ × … (≈ 1 − Σ indisponibilidades) · paralelo: 1 − (1 − A)ⁿ, solo con fallas independientes', ex: '0.999³ ≈ 99.7 % · 1 − 0.01² = 99.99 % · una causa común va en serie' },
      { topic: 'disponibilidad', title: 'Burn rate', expr: 'burn = tasa de error ÷ (1 − SLO) · el presupuesto de 30 días dura 720 h ÷ burn', ex: 'SLO 99.9 %: 1.44 % de errores = 14.4× (2 % del presupuesto en 1 h → page)' },

      { topic: 'hardware', title: 'Pesos', expr: 'pesos = parámetros × bytes (FP32 4 · FP16/BF16 2 · FP8/INT8 1 · INT4 0.5)', ex: 'Llama 3 8B: 8.03 B × 2 B ≈ 16 GB · ResNet-50 FP16 ≈ 51 MB' },
      { topic: 'hardware', title: 'KV cache', expr: 'KV por token = 2 × capas × KV heads × head_dim × bytes · secuencias = ⌊KV libre ÷ (tokens × KV por token)⌋', ex: 'Llama 3 8B: 128 KiB por token, 8k tokens = 1 GiB ≈ 1.07 GB · 70B: 320 KiB' },
      { topic: 'hardware', title: 'Prefill y decode', expr: 'TTFT ≳ 2 × parámetros × tokens del prompt ÷ FLOPS · tokens/s ≲ ancho de banda ÷ bytes de pesos', ex: 'L4, 8B BF16: ≳ 0.27 s para 2,000 tokens · ≲ 19 tokens/s' },
      { topic: 'hardware', title: 'GPUs', expr: 'GPUs = ⌈pico de diseño ÷ (capacidad medida × utilización)⌉ + 1', ex: '⌈500 ÷ (1,200 × 0.5)⌉ + 1 = 2 · utilización 50–70 %' },
      { topic: 'hardware', title: 'CPU del preproceso', expr: 'cores = req/s × segundos de CPU por request · vCPU = cores ÷ utilización objetivo del HPA', ex: '500 × 6 ms = 3 cores → ÷ 0.6 = 5 vCPU → 2 × c6i.xlarge' },

      { topic: 'costo', title: 'Costo mensual', expr: 'US$/mes = instancias × US$/h × 730 h', ex: '2 × 0.526 × 730 ≈ US$768' },
      { topic: 'costo', title: 'Por 1,000 predicciones', expr: 'a capacidad: US$/h ÷ (pred/s × 3.6) · real: costo del mes ÷ predicciones del mes × 1,000', ex: 'T4 a 600 img/s ≈ US$0.00024 · las 2 T4 del c01 con su carga ≈ US$0.0025' },
      { topic: 'costo', title: 'Facturado vs ocupado', expr: 'fracción ociosa = 1 − horas trabajando ÷ horas facturadas', ex: 'c04: 1 − 8.3 ÷ 15 ≈ 45 % · staging 24/7 vs 60 h/semana: ≈ 64 % menos' },
      { topic: 'costo', title: 'Compromisos y spot', expr: 'un compromiso conviene si usas más de 1 − descuento de lo comprometido · spot = horas × (1 + trabajo repetido) × precio spot', ex: '37 % de descuento → más de 63 % de uso · fine-tune: (40 h + 4 × 25 min) × 0.462 ≈ US$19' },
      { topic: 'costo', title: 'Batch', expr: 'GPU-horas = ítems ÷ (ítems/s por GPU) ÷ 3,600 · tiempo de pared = GPU-horas ÷ GPUs', ex: '200 M ÷ 1,000 ÷ 3,600 ≈ 56 GPU-h → 4 GPUs ≈ 14 h' },

      { topic: 'datos', title: 'Almacenamiento', expr: 'bytes = eventos × tamaño × retención (1 M × 1 KB = 1 GB)', ex: '10 M × 300 B = 3 GB/día ≈ 1.1 TB/año' },
      { topic: 'datos', title: 'Ancho de banda', expr: 'Gb/s = req/s × bytes por request × 8 ÷ 10⁹', ex: '500 × 602 KB × 8 ≈ 2.4 Gb/s (baseline de c6i.xlarge: 1.56 Gb/s)' },
      { topic: 'datos', title: 'Embeddings', expr: 'tamaño = vectores × dimensiones × bytes', ex: '100 M × 768 × 4 B ≈ 307 GB en FP32 · ≈ 77 GB en INT8, sin el índice ANN' },
      { topic: 'datos', title: 'Video', expr: 'GB/día = Mb/s × 86,400 ÷ 8 ÷ 1,000', ex: '4 Mb/s → ≈ 43 GB/día por cámara · 40 cámaras ≈ 1.7 TB/día' },
      { topic: 'datos', title: 'Transferencia', expr: 'TB/mes = bytes/s × 2.63 M s (730 h) · cruce de AZ US$0.01/GB por sentido · egress ≈ US$0.09/GB', ex: 'c01 sin ruteo por zona: ≈ 90 TB × US$0.02 ≈ US$1,800/mes' },
    ],

    // ------------------------------------------------------------ números de referencia
    quick: [
      { id: 'q-tiempo', title: 'Tiempo y tráfico', html: `
        <ul>
          <li><b>1 día = 86,400 s</b>. Redondear a 10<sup>5</sup> subestima el QPS ≈ 14 %.</li>
          <li><b>Mes para costos = 730 h</b> ≈ 2.63 × 10<sup>6</sup> s; predicciones al mes = diarias × 30.4.</li>
          <li><b>Mes para SLOs = 30 días</b> = 720 h = 43,200 min.</li>
          <li>1 año = 8,760 h ≈ 3.15 × 10<sup>7</sup> s · 1 semana = 604,800 s.</li>
          <li>1 M/día ≈ 11.6 req/s · 10 M ≈ 116 · 100 M ≈ 1,157 · 1 B ≈ 11,574.</li>
          <li>Pico diurno ≈ 2–5× (3× si la hora pico lleva 1/8 del día) · margen de diseño 1.3–1.5×.</li>
        </ul>` },
      { id: 'q-nueves', title: 'Nueves → caída permitida', html: `
        <table class="dtable"><thead><tr><th>Disponibilidad</th><th>30 días</th><th>Año</th><th>Día</th></tr></thead><tbody>
          <tr><td>99 %</td><td>7.2 h</td><td>3.65 días</td><td>14.4 min</td></tr>
          <tr><td>99.5 %</td><td>3.6 h</td><td>1.83 días</td><td>7.2 min</td></tr>
          <tr><td>99.9 %</td><td>43.2 min</td><td>8.76 h</td><td>1.4 min</td></tr>
          <tr><td>99.95 %</td><td>21.6 min</td><td>4.38 h</td><td>43 s</td></tr>
          <tr><td>99.99 %</td><td>4.3 min</td><td>52.6 min</td><td>8.6 s</td></tr>
        </tbody></table>
        <p>Con el mes de 730 h: 43.8 min para 99.9 %. Serie: 0.999³ ≈ 99.7 %. Paralelo: 1 − 0.01² = 99.99 %.</p>` },
      { id: 'q-gpus', title: 'GPUs: memoria, ancho de banda y precio', html: `
        <table class="dtable"><thead><tr><th>GPU</th><th>Memoria</th><th>Ancho de banda</th><th>FP16 denso</th><th>US$/GPU-h</th></tr></thead><tbody>
          <tr><td>T4</td><td>16 GB</td><td>320 GB/s</td><td>65 TFLOPS</td><td>≈ 0.53</td></tr>
          <tr><td>L4</td><td>24 GB</td><td>300 GB/s</td><td>≈ 121 TFLOPS</td><td>≈ 0.80</td></tr>
          <tr><td>A10G</td><td>24 GB</td><td>600 GB/s</td><td>70 TFLOPS</td><td>≈ 1.01</td></tr>
          <tr><td>A100</td><td>40 · 80 GB</td><td>1,555 · 2,039 GB/s</td><td>312 TFLOPS</td><td>≈ 2.75 · 3.43</td></tr>
          <tr><td>H100</td><td>80 GB</td><td>3.35 TB/s</td><td>≈ 990 TFLOPS</td><td>≈ 6.88</td></tr>
        </tbody></table>
        <p>Cómputo denso; on-demand us-east-1, aproximado. Sin BF16 ni FP8 en la T4; FP8 en L4 y H100.</p>` },
      { id: 'q-precios', title: 'Precios de nube (aprox., us-east-1)', html: `
        <ul>
          <li>g4dn.xlarge (T4) ≈ US$0.526/h (≈ 384/mes) · g6.xlarge (L4) ≈ 0.805 (≈ 588) · g5.xlarge (A10G) ≈ 1.006 (≈ 734).</li>
          <li>g6e.xlarge (L40S) ≈ 1.86 · p5.4xlarge (1 H100) ≈ 6.88 · c6i.xlarge (4 vCPU) ≈ 0.17 (≈ 0.0425 por vCPU-h).</li>
          <li>Cloud Run con L4 ≈ US$1.05/h, por segundo.</li>
          <li>Spot observado: g4dn ≈ 0.27 (≈ 48 % menos) · g5 ≈ 0.46 (≈ 54 %) · g6 ≈ 0.60 (≈ 25 %).</li>
          <li>Savings Plan a 1 año ≈ 30–40 % (g4dn y g5 ≈ 37 %, g6 ≈ 35 %).</li>
          <li>S3 Standard ≈ US$0.023/GB-mes · cruce de AZ US$0.01/GB por sentido · egress ≈ US$0.09/GB · NAT US$0.045/h + 0.045/GB · CloudWatch Logs US$0.50/GB.</li>
        </ul>` },
      { id: 'q-latencias', title: 'Latencias de referencia', html: `
        <ul>
          <li>RAM ≈ 100 ns · lectura aleatoria de 4 KiB en NVMe ≈ 50–100 µs.</li>
          <li>RTT en la misma AZ ≈ 0.1–0.5 ms · entre AZs ≈ 0.4–2.5 ms · regiones vecinas ≈ 10–15 ms · costa a costa en EE. UU. ≈ 60–80 ms · entre continentes ≈ 70–250 ms.</li>
          <li>Física: ≥ 1 ms de RTT por cada 100 km de fibra.</li>
          <li>Redis misma AZ ≈ 0.2–1 ms · Postgres por índice ≈ 1–5 ms · S3 GET chico: decenas de ms, ≈ 100–200 ms "consistentes".</li>
          <li>Conexión nueva TCP + TLS 1.3: + 2 RTT · retransmisión de TCP ≈ 200 ms.</li>
          <li>Decode de JPEG de 1024 px ≈ 2 ms · de 12 MP ≈ 40–80 ms por vCPU · una persona lee ≈ 4–7 tokens/s.</li>
        </ul>` },
      { id: 'q-bytes', title: 'Bytes y modelos', html: `
        <ul>
          <li>FP32 4 B · FP16/BF16 2 · FP8/INT8 1 · INT4 0.5 · 1 GiB ≈ 1.074 GB.</li>
          <li>ResNet-50 25.6 M (≈ 51 MB FP16) · Llama 3 8B 8.03 B (≈ 16 GB BF16) · 70B 70.6 B (≈ 141 GB BF16).</li>
          <li>KV por token: Llama 3 8B 128 KiB · 70B 320 KiB (BF16; la mitad en FP8).</li>
          <li>Tensor 224×224×3: ≈ 150 KB en uint8 · ≈ 602 KB en FP32 · JPEG de celular ≈ 150–250 KB.</li>
          <li>Log de predicción ≈ 300 B · video 1080p H.264 ≈ 4 Mb/s · audio PCM 16 kHz ≈ 32 KB/s.</li>
          <li>Embedding de 768 dims: 3 KB FP32 · 768 B INT8.</li>
        </ul>` },
    ],

    templates: [
      // ======================================================== TRÁFICO
      {
        id: 'tr-01', topic: 'trafico', level: 1, title: 'QPS promedio', ref: 'm03.trafico',
        gen(r) {
          const m = r.pick([2, 4, 5, 8, 10, 20, 30, 50, 100, 200]);
          const c = r.pick([
            ['una app de marketplace', 'fotos subidas', 'cada una'],
            ['un servicio de moderación', 'imágenes revisadas', 'cada una'],
            ['un buscador', 'búsquedas', 'cada una'],
            ['un servicio de detección de fraude', 'transacciones puntuadas', 'cada una'],
            ['un clasificador de documentos', 'documentos procesados', 'cada uno'],
          ]);
          const avg = (m * 1e6) / DAY;
          const what = m <= 5 ? 'Tráfico bajo: dos réplicas por disponibilidad, no por carga.'
            : m <= 50 ? 'Tráfico del orden del caso 1 (10 M/día ≈ 116 req/s): pocas réplicas bien hechas con N+1, sin arquitectura exótica.'
              : 'Varias GPUs llenas: el costo por predicción y el batching empiezan a mandar.';
          return {
            q: `En ${c[0]} hay <b>${f(m)} M de ${c[1]} al día</b>, y ${c[2]} es un request al modelo.`,
            parts: [{
              ask: '¿Cuántos requests por segundo llegan <b>en promedio</b>?', unit: 'req/s', answer: avg, tol: 0.15,
              steps: [
                'Planteamiento: QPS promedio = volumen diario ÷ segundos de un día (86,400 s).',
                `${f(m)} M ÷ 86,400 s = ${f(m * 1e6)} ÷ 86,400 ≈ <b>${f(avg)} req/s</b>`,
                `Chequeo con el atajo 1 M/día ≈ 11.6 req/s: ${f(m)} × 11.6 ≈ ${f(m * 11.6)}.`,
              ],
            }],
            hint: 'Pasa de "por día" a "por segundo": divide el volumen diario entre los segundos que tiene un día. Para verificar de cabeza: 1 M/día ≈ 11.6 req/s.',
            takeaway: `${what} El promedio paga la factura; el pico dimensiona. <i>"${f(m)} million a day is about ${say(Math.round(avg))} requests per second on average."</i>`,
          };
        },
      },
      {
        id: 'tr-02', topic: 'trafico', level: 1, title: 'Factor de pico desde la hora pico', ref: 'm03.trafico',
        gen(r) {
          const x = r.pick([8, 10, 12, 12.5, 15, 20]);
          const k = (24 * x) / 100;
          return {
            q: `Los logs del backend muestran que la hora de más tráfico concentra el <b>${x} %</b> de los requests del día.`,
            parts: [{
              ask: 'El tráfico de esa hora, ¿cuántas veces es el promedio? (factor de pico)', unit: '×', answer: k, tol: 0.15,
              steps: [
                'Planteamiento: una hora promedio lleva 1/24 del día; si la hora pico lleva la fracción p, su tasa es 24 × p veces el promedio.',
                `24 × ${f(x / 100, 3)} = <b>${f(k)}×</b>`,
                'Es el pico de la hora: dentro de ella hay bursts de segundos aún más altos, que absorben la cola y el headroom, no el autoscaler.',
              ],
            }],
            hint: 'Compara la fracción del día que cae en la hora pico con la que cae en una hora promedio (1/24).',
            takeaway: `Así defiendes el supuesto de pico con una frase en vez de inventar "3×", y encima aplicas el margen de diseño (≈ 1.3–1.5×). <i>"The busiest hour carries about ${x}% of daily traffic, so the peak is roughly ${f(k, 1)}x the average."</i>`,
          };
        },
      },
      {
        id: 'tr-03', topic: 'trafico', level: 2, title: 'De usuarios a pico de diseño', ref: 'm01.estimaciones-express',
        gen(r) {
          const dau = r.pick([1, 2, 3, 5, 8, 10, 20]);
          const a = r.pick([2, 3, 4, 5, 10]);
          const k = r.pick([2, 3, 4]);
          const mg = r.pick([1.3, 1.4, 1.5]);
          const vol = dau * a;
          const avg = (vol * 1e6) / DAY;
          const design = avg * k * mg;
          const said = up2(design);   // lo que dices en voz alta, redondeado hacia arriba
          return {
            q: `Una app tiene <b>${f(dau)} M de usuarios activos al día</b> y cada uno hace en promedio <b>${a} requests</b> que pasan por el modelo. Supón un pico diurno de <b>${k}×</b> el promedio y un margen de diseño de <b>${mg}×</b> (spikes y error de la estimación).`,
            parts: [
              {
                ask: 'Tráfico <b>promedio</b>', unit: 'req/s', answer: avg, tol: 0.15,
                steps: [
                  'Planteamiento: volumen diario = usuarios × requests por usuario; promedio = volumen ÷ 86,400 s.',
                  `${f(dau)} M × ${a} = ${f(vol)} M requests/día → ${f(vol)} M ÷ 86,400 ≈ <b>${f(avg)} req/s</b>`,
                ],
              },
              {
                ask: '<b>Pico de diseño</b> (pico diurno × margen)', unit: 'req/s', answer: design, tol: 0.15,
                steps: [
                  'Planteamiento: pico = promedio × factor de pico; diseño = pico × margen.',
                  `Con el resultado anterior (${f(avg)} req/s): × ${k} = ${f(avg * k)} req/s de pico → × ${mg} ≈ <b>${f(design)} req/s</b>`,
                  `En voz alta lo redondeas hacia arriba a un número defendible: ≈ ${f(said)} req/s (en el caso 1, 350 × 1.4 ≈ 490 → 500).`,
                ],
              },
            ],
            hint: 'Dos pasos: (1) volumen diario = usuarios × acciones, y a req/s dividiendo entre 86,400; (2) pico de diseño = promedio × factor de pico × margen.',
            takeaway: `Diseñas para ≈ ${f(said)} req/s y pagas, en promedio, por ≈ ${say(avg)}. El pico de diseño entra en la fórmula de GPUs y réplicas; el promedio, en la factura. <i>"With a ${k}x daily peak plus headroom, I'll design for about ${f(said)} requests per second."</i>`,
          };
        },
      },
      {
        id: 'tr-04', topic: 'trafico', level: 2, title: 'Crecimiento compuesto', ref: 'm03.trafico',
        gen(r) {
          const p0 = r.pick([200, 300, 500, 800, 1000]);
          const gr = r.pick([5, 8, 10, 15]);
          const n = r.pick([6, 12]);
          const fac = Math.pow(1 + gr / 100, n);
          const dbl = 72 / gr;
          const lin = 1 + (gr / 100) * n;
          const future = p0 * fac;
          return {
            q: `Hoy tu pico de diseño es <b>${f(p0)} req/s</b>. Producto espera que el tráfico crezca <b>${gr} % por mes</b>, compuesto, y quieres dimensionar para dentro de <b>${n} meses</b>.`,
            parts: [
              {
                ask: 'Factor de crecimiento en ese plazo', unit: '×', answer: fac, tol: 0.15,
                steps: [
                  'Planteamiento: crecimiento compuesto = (1 + g)<sup>n</sup>, no 1 + g × n.',
                  `(1 + ${f(gr / 100, 2)})<sup>${n}</sup> = ${f(1 + gr / 100, 2)}<sup>${n}</sup> ≈ <b>${f(fac)}×</b>`,
                  `Aproximación de cabeza (regla del 72): se duplica cada ≈ 72 ÷ ${gr} = ${f(dbl, 1)} meses → 2<sup>${n} ÷ ${f(dbl, 1)}</sup> ≈ ${f(Math.pow(2, n / dbl))}×, contra ${f(fac)}× exacto: alcanza para estimar.`,
                  `Sumar en vez de componer daría 1 + ${f(gr / 100, 2)} × ${n} = ${f(lin)}×: ${f((1 - lin / fac) * 100, 0)} % por debajo.`,
                ],
              },
              {
                ask: `Pico de diseño dentro de ${n} meses`, unit: 'req/s', answer: future, tol: 0.15,
                steps: [
                  'Planteamiento: pico futuro = pico de hoy × factor de crecimiento.',
                  `Con el resultado anterior (${f(fac)}×): ${f(p0)} × ${f(fac)} ≈ <b>${f(future)} req/s</b>`,
                ],
              },
            ],
            hint: 'El crecimiento mensual se compone: multiplica (1 + tasa) por sí mismo una vez por mes. Para hacerlo de cabeza, la regla del 72: meses para duplicar ≈ 72 ÷ tasa en %.',
            takeaway: `${fac >= 3 ? 'Con ' + f(fac) + '× en el plazo, el hardware se revisa antes de llegar (más GPUs o una GPU más grande); la arquitectura debería aguantarlo.'
              : fac >= 2 ? 'Con ' + f(fac) + '×, la arquitectura no cambia pero la flota sí: subes el máximo del autoscaler y recalculas GPUs y presupuesto antes de llegar.'
                : 'Con ' + f(fac) + '×, el headroom y el autoscaling lo absorben y recalculas las GPUs al acercarte; la arquitectura no cambia.'} Regla de M3: diseña para 6–12 meses y que la arquitectura aguante 10× sin rediseño; el hardware sí cambia. <i>"At ${gr}% a month, traffic grows about ${f(fac, 1)}x in ${n} months, so I size for about ${say(future)} requests per second."</i>`,
          };
        },
      },
      {
        id: 'tr-05', topic: 'trafico', level: 3, title: 'Spike de una push notification', ref: 'm03.trafico',
        gen(r) {
          // [M de usuarios notificados, % que actúa en el primer minuto, M de fotos al día]
          const c = r.pick([[5, 2, 10], [3, 2, 10], [5, 1, 5], [10, 1, 10], [8, 2, 20], [4, 3, 10], [6, 1, 5], [12, 1, 20]]);
          const users = c[0];
          const pct = c[1];
          const dv = c[2];
          const reqs = (users * 1e6 * pct) / 100;
          const spike = reqs / 60;
          const peak = ((dv * 1e6) / DAY) * 3;
          const ratio = spike / peak;
          const cores = spike * 0.006;
          const ok = 'Escalado programado antes de la push (coordinado con marketing) + load shedding con fallback para lo que sobre';
          const choices = r.shuffle([ok,
            'Confiar en el autoscaler: detecta el aumento y agrega réplicas a tiempo',
            'Dimensionar la flota permanente para el spike, las 24 horas']);
          return {
            q: `Marketing manda una push notification a <b>${f(users)} M de usuarios</b> y estima que el <b>${pct} %</b> abre la app y sube una foto en el <b>primer minuto</b>. Tu servicio recibe normalmente <b>${f(dv)} M fotos al día</b>, con un pico diurno de <b>3×</b> el promedio.`,
            parts: [
              {
                ask: 'Tasa de requests durante ese minuto', unit: 'req/s', answer: spike, tol: 0.15,
                steps: [
                  'Planteamiento: requests del spike = notificados × fracción que actúa; tasa = requests ÷ 60 s.',
                  `${f(users)} M × ${pct} % = ${f(reqs)} requests en 60 s → <b>≈ ${f(spike)} req/s</b>`,
                ],
              },
              {
                ask: 'Ese spike, ¿cuántas veces es el pico diario normal?', unit: '×', answer: ratio, tol: 0.15,
                steps: [
                  'Planteamiento: pico diario = (volumen ÷ 86,400) × 3; factor = spike ÷ pico diario.',
                  `Pico diario: ${f(dv)} M ÷ 86,400 × 3 ≈ ${f(peak)} req/s`,
                  `Con el resultado anterior: ${f(spike)} ÷ ${f(peak)} ≈ <b>${f(ratio)}×</b>`,
                ],
              },
              {
                ask: 'El gateway gasta ≈ <b>6 ms de CPU</b> por request (el preproceso del caso 1). ¿Cuántos cores ocupa durante el spike?', unit: 'cores', answer: cores, tol: 0.15,
                steps: [
                  'Planteamiento (Little aplicado a la CPU): cores ocupados = tasa × tiempo de CPU por request.',
                  `Con el resultado de la primera parte: ${f(spike)} req/s × 0.006 s ≈ <b>${f(cores)} cores</b>`,
                  'El caso 1 provisiona 8 vCPU de gateway para su pico de diseño: en un spike, el primer cuello de botella puede ser la CPU (y la red) del gateway, no la GPU.',
                ],
              },
              {
                ask: 'El spike dura ≈ 1 minuto y un nodo GPU nuevo tarda ≈ 5–13 min en servir. ¿Qué haces?', choices, answer: choices.indexOf(ok),
                steps: [
                  'El autoscaler llega minutos tarde a un spike de un minuto, y dimensionar las 24 horas para el peor minuto es pagar capacidad ociosa. La respuesta de M3 separa tres cosas: capacidad base para el pico de diseño, escalado programado para los eventos conocidos y load shedding con fallback para lo que no conoces.',
                ],
              },
            ],
            hint: 'Cuatro piezas: (1) requests del spike ÷ 60 s; (2) compáralo con el pico diario (promedio × 3); (3) cores = tasa × segundos de CPU por request; (4) compara lo que dura el spike con lo que tarda en llegar capacidad nueva.',
            takeaway: 'El cuello de botella cambia de tier según la forma de la carga: en el ejemplo de M3, las GPUs planeadas al 50 % absorben el spike y lo primero que se satura es el gateway (CPU y red). Cada tier se dimensiona por separado. <i>"A push notification is a scheduled spike: I scale ahead with the marketing calendar and shed load with a fallback, because a new GPU node takes minutes."</i>',
          };
        },
      },
      {
        id: 'tr-06', topic: 'trafico', level: 3, title: 'Tormenta de reintentos', ref: 'm03.timeouts-reintentos',
        gen(r) {
          const R = r.pick([1, 2, 3]);
          const L = r.pick([2, 3, 4]);
          const P = r.pick([200, 300, 500, 800, 1000]);
          const chain = { 2: 'cliente → servicio → model server', 3: 'cliente → API → servicio → model server', 4: 'app → gateway → API → servicio → model server' }[L];
          const att = Math.pow(1 + R, L);
          return {
            q: `Cadena de llamadas: <b>${chain}</b> (${L} capas de llamadas). Cada capa reintenta hasta <b>${R} ${R === 1 ? 'vez' : 'veces'}</b> cada llamada que falla. El model server se pone lento por carga y todas las llamadas empiezan a fallar por timeout. En el pico llegan <b>${f(P)} req/s</b> de usuarios.`,
            parts: [
              {
                ask: 'Intentos que recibe el model server, como máximo, por cada request de usuario', unit: 'intentos', answer: att, tol: 0,
                steps: [
                  'Planteamiento: cada capa hace hasta 1 + R intentos por cada intento que le llega; si todos fallan, se multiplican capa por capa: (1 + R)<sup>capas</sup>.',
                  `(1 + ${R})<sup>${L}</sup> = ${1 + R}<sup>${L}</sup> = <b>${f(att)} intentos</b>`,
                ],
              },
              {
                ask: 'Carga sobre el model server en ese peor caso', unit: 'req/s', answer: P * att, tol: 0.15,
                steps: [
                  'Planteamiento: carga = tasa de usuarios × intentos por request.',
                  `Con el resultado anterior (${f(att)}): ${f(P)} × ${f(att)} = <b>${f(P * att)} req/s</b>`,
                  'Llega justo cuando el model server ya estaba saturado: el sistema no se recupera aunque la causa original desaparezca.',
                ],
              },
              {
                ask: 'Si solo <b>una</b> capa reintenta, con un presupuesto de reintentos de ≈ 10 % del tráfico, ¿cuál es la carga máxima?', unit: 'req/s', answer: P * 1.1, tol: 0.15,
                steps: [
                  'Planteamiento: con presupuesto, los reintentos no pasan de ≈ 10 % de los requests: carga ≤ tasa × 1.1.',
                  `${f(P)} × 1.1 = <b>${f(P * 1.1)} req/s</b>`,
                  `Contra ${f(P * att)} req/s del peor caso: ≈ ${s2(att / 1.1)} veces menos.`,
                ],
              },
            ],
            hint: 'Multiplica los intentos capa por capa (cada capa hace 1 + reintentos por cada intento que recibe); luego multiplica por la tasa de usuarios. Para la alternativa: una sola capa con un presupuesto de ≈ 10 %.',
            takeaway: 'Decide <b>dónde</b> se reintenta: una sola capa, con presupuesto, backoff exponencial con jitter, solo errores transitorios en operaciones idempotentes y dentro del deadline. En el camino interactivo del caso 1 nadie reintenta: el caller cae al selector manual. <i>"Retries multiply across layers, so only one layer retries, with a retry budget of about ten percent."</i>',
          };
        },
      },
      // ======================================================== LATENCIA
      {
        id: 'la-01', topic: 'latencia', level: 1, title: 'Little: en vuelo, latencia o tasa', ref: 'm03.little',
        gen(r) {
          const mode = r.pick(['L', 'W', 'lam']);
          if (mode === 'L') {
            const lam = r.pick([100, 200, 350, 500, 800, 1500, 3000]);
            const W = r.pick([20, 40, 50, 80, 120, 200, 300]);
            const L = (lam * W) / 1000;
            return {
              q: `Tu servicio atiende <b>${f(lam)} req/s</b> con una latencia media de <b>${W} ms</b>, en régimen estable.`,
              parts: [{
                ask: '¿Cuántos requests hay <b>en vuelo</b> al mismo tiempo, en promedio?', unit: 'requests', answer: L, tol: 0.15,
                steps: [
                  'Planteamiento: Little, L = λ × W, con W en segundos (el promedio, no el p99).',
                  `${f(lam)} req/s × ${f(W / 1000, 3)} s = <b>${f(L)} requests en vuelo</b>`,
                ],
              }],
              hint: 'Little: en vuelo = tasa de llegada × tiempo promedio adentro. Pasa los ms a segundos antes de multiplicar.',
              takeaway: `Para ese número dimensionas workers, conexiones y lugares en la cola. Si la latencia media se duplica, la concurrencia también: latencia y capacidad se planean juntas. <i>"At ${f(lam)} requests per second and ${W} ms on average, Little's law gives about ${f(L)} requests in flight."</i>`,
            };
          }
          if (mode === 'W') {
            const Lm = r.pick([10, 20, 40, 60, 100]);
            const lam = r.pick([200, 250, 400, 500, 1000]);
            const Wms = (Lm / lam) * 1000;
            return {
              q: `Un gauge de Prometheus marca en promedio <b>${Lm} requests en vuelo</b> en tu servicio, que recibe <b>${f(lam)} req/s</b>.`,
              parts: [{
                ask: '¿Cuál es la latencia media, sin mirar el histograma?', unit: 'ms', answer: Wms, tol: 0.15,
                steps: [
                  'Planteamiento: Little despejada, W = L ÷ λ.',
                  `${Lm} ÷ ${f(lam)} req/s = ${g(Lm / lam)} s = <b>${f(Wms)} ms</b>`,
                ],
              }],
              hint: 'Little funciona en las tres direcciones: si conoces los requests en vuelo y la tasa, despejas el tiempo promedio adentro (y lo pasas a ms).',
              takeaway: 'Es la latencia media sin instrumentar la latencia: un chequeo cruzado. Si el histograma dice otra cosa, una de las dos métricas está mal (M3). Ojo: es el promedio; el p99 sale del histograma.',
            };
          }
          const Lm = r.pick([16, 32, 64, 100, 128]);
          const W = r.pick([25, 40, 50, 80, 100, 200]);
          const lam = Lm / (W / 1000);
          return {
            q: `Tu servidor admite como máximo <b>${Lm} requests en vuelo</b> (límite de concurrencia) y cada uno tarda en promedio <b>${W} ms</b>.`,
            parts: [{
              ask: '¿Cuál es el throughput máximo antes de que se forme cola?', unit: 'req/s', answer: lam, tol: 0.15,
              steps: [
                'Planteamiento: Little despejada, λ = L ÷ W (W en segundos).',
                `${Lm} ÷ ${f(W / 1000, 3)} s = <b>${f(lam)} req/s</b>`,
                'Por encima de esa tasa los requests esperan en cola y la latencia sube.',
              ],
            }],
            hint: 'Little despejada para la tasa: requests en vuelo ÷ tiempo promedio de cada uno, en segundos.',
            takeaway: 'Un límite de concurrencia es un límite de throughput: para atender más, o admites más en vuelo (RAM, conexiones) o bajas la latencia de cada request.',
          };
        },
      },
      {
        id: 'la-02', topic: 'latencia', level: 2, title: 'Presupuesto serial', ref: 'm03.presupuesto',
        gen(r) {
          // p99 por tramo dentro de los rangos del c01.
          const a = r.pick([15, 25, 39]);
          const b = r.pick([27, 41, 51]);
          const c = r.pick([15, 21, 27]);
          const d = r.pick([12, 22, 32]);
          // [singular, plural, ms de p99 que se presupuestan por llamada, de dónde sale ese número,
          //  frase en inglés si no cabe]
          const dep = r.pick([
            ['un GET a Redis en la misma AZ', 'GETs a Redis en la misma AZ', 1, 'Redis en la misma AZ responde en ≈ 0.2–1 ms: manda la red, y casi nunca es el problema.', ''],
            ['una lectura por índice en Postgres (misma AZ, conexión abierta)', 'lecturas por índice en Postgres (misma AZ, conexión abierta)', 5, 'Una lectura por índice cuesta ≈ 1–5 ms si la conexión ya está abierta.', ''],
            ['una llamada a un servicio en una región vecina (≈ 500 km)', 'llamadas a un servicio en una región vecina (≈ 500 km)', 15, 'Física: ≥ 1 ms de RTT por cada 100 km de fibra (≥ 5 ms); medido, ≈ 10–15 ms.', 'Every cross-region round trip adds 10 to 15 milliseconds, so this call has to leave the request path.'],
            ['una llamada a un servicio en la otra costa de EE. UU. (≈ 3,500 km)', 'llamadas a un servicio en la otra costa de EE. UU. (≈ 3,500 km)', 80, 'Física: ≥ 35 ms de RTT; medido, ≈ 60–80 ms.', 'A coast-to-coast round trip costs 60 to 80 milliseconds, so nothing in the request path leaves the region.'],
            ['un GET a S3 de un objeto chico', 'GETs a S3 de objetos chicos', 200, 'S3: mediana de decenas de ms, pero ≈ 100–200 ms "consistentes" y una cola que AWS manda cortar reintentando a los 2 s.', 'S3 first-byte latency has a long tail, so I keep it out of the synchronous path.'],
            ['una llamada a un servicio en otro continente', 'llamadas a un servicio en otro continente', 250, 'Entre continentes el RTT es ≈ 70–250 ms: nada sale de la región en un camino crítico de pocos cientos de ms.', 'A cross-continent round trip can cost a couple of hundred milliseconds, so nothing in the request path leaves the region.'],
          ]);
          const n = r.pick([1, 2, 3]);
          const sum = a + b + c + d;
          const total = sum + n * dep[2];
          // El SLO se elige al final, a 10 ms o más del total: "¿cabe?" nunca depende de discutir un margen de 1 ms.
          const S = r.pick([200, 250, 300].filter((s) => Math.abs(s - total) >= 10));
          const fits = total < S;
          const say1 = fits
            ? `With every hop budgeted, the new call still leaves about ${S - total} milliseconds of headroom, so it can stay in the request path.`
            : dep[4] || 'If a call doesn\'t fit the latency budget, I precompute it, cache it or take it out of the request path.';
          return {
            q: `SLO: <b>p99 ≤ ${S} ms</b>. El camino del request tiene, en serie, estos p99 presupuestados: entrada <b>${a} ms</b>, preproceso <b>${b} ms</b>, modelo <b>${c} ms</b> y salida <b>${d} ms</b>. Producto pide agregar al camino, en serie, <b>${n === 1 ? dep[0] : n + ' ' + dep[1]}</b>, que presupuestas en ≈ <b>${dep[2]} ms</b> de p99 por llamada.`,
            parts: [
              {
                ask: 'Margen que queda hoy bajo el SLO', unit: 'ms', answer: S - sum, tol: 0.05,
                steps: [
                  'Planteamiento: margen = SLO − suma de los p99 presupuestados por tramo (la suma es pesimista: sirve para repartir el presupuesto, no para medir).',
                  `${S} − (${a} + ${b} + ${c} + ${d}) = ${S} − ${sum} = <b>${S - sum} ms</b>`,
                ],
              },
              {
                ask: 'p99 presupuestado con las llamadas nuevas', unit: 'ms', answer: total, tol: 0.05,
                steps: [
                  'Planteamiento: en serie, cada llamada suma su latencia completa: total = suma actual + n × latencia de la llamada.',
                  `${sum} + ${n} × ${dep[2]} = <b>${total} ms</b>`,
                ],
              },
              {
                ask: '¿Puede ir esa dependencia en el camino crítico?',
                choices: ['Sí: cabe en el SLO', 'No: hay que sacarla del camino crítico (precomputar, caché, paralelizar o resolverla dentro de la región)'],
                answer: fits ? 0 : 1,
                steps: [
                  fits ? `${total} ms queda por debajo de los ${S} ms del SLO: cabe, con ${S - total} ms de margen.` : `${total} ms supera los ${S} ms del SLO por ${total - S} ms: no cabe.`,
                  dep[3],
                  'Rara vez todos los tramos tienen su peor caso en el mismo request: la suma de p99 reparte el presupuesto, y el cumplimiento se mide end-to-end con el histograma.',
                ],
              },
            ],
            hint: 'Suma los p99 de los tramos en serie y réstalo del SLO; después suma las llamadas nuevas (cada una con su latencia completa) y compara con el SLO.',
            takeaway: `El presupuesto se arma antes de elegir tecnología: dice dónde vale la pena optimizar y qué no puede entrar al camino crítico. Lo que no cabe se precomputa, se cachea, se paraleliza o sale del request. <i>"${say1}"</i>`,
          };
        },
      },
      {
        id: 'la-03', topic: 'latencia', level: 2, title: 'LLM con streaming: TTFT y TPOT', ref: 'm14.prefill-decode',
        gen(r) {
          const ttft = r.pick([0.3, 0.5, 0.6, 0.8, 1.0]);
          const tpot = r.pick([20, 25, 40, 50]);
          const out = r.pick([100, 250, 400, 500]);
          const e2e = ttft + ((out - 1) * tpot) / 1000;
          const tps = 1000 / tpot;
          return {
            q: `Un chat con LLM responde en streaming: el primer token llega a <b>${ttft} s</b> (TTFT) y después sale un token cada <b>${tpot} ms</b> (TPOT). La respuesta típica tiene <b>${out} tokens</b>.`,
            parts: [
              {
                ask: '¿Cuánto tarda la respuesta completa (latencia end-to-end)?', unit: 's', answer: e2e, tol: 0.15,
                steps: [
                  'Planteamiento: e2e = TTFT + (tokens − 1) × TPOT; el primer token ya llegó con el TTFT. Pasa los ms a segundos.',
                  `${ttft} + ${out - 1} × ${f(tpot / 1000, 3)} s = ${ttft} + ${f(((out - 1) * tpot) / 1000)} ≈ <b>${f(e2e)} s</b>`,
                ],
              },
              {
                ask: '¿Cuántos tokens por segundo ve la persona durante el streaming?', unit: 'tokens/s', answer: tps, tol: 0.15,
                steps: [
                  'Planteamiento: tokens/s = 1 ÷ TPOT (en segundos).',
                  `1 ÷ ${f(tpot / 1000, 3)} s = <b>${f(tps)} tokens/s</b>`,
                  `Una persona lee ≈ 4–7 tokens/s: el streaming va ≈ ${f(tps / 7, 1)}–${f(tps / 4, 1)}× más rápido de lo que lee.`,
                ],
              },
            ],
            hint: 'Separa las dos fases: el TTFT (cola + prefill) ocurre una vez; después cada token restante cuesta un TPOT. Cuidado con ms vs s.',
            takeaway: `Por eso un LLM interactivo tiene SLOs de <b>TTFT y TPOT</b>, no de latencia total: con streaming la persona empieza a leer a ${ttft} s del request aunque la respuesta tarde ≈ ${f(e2e, 1)} s. Para Little (secuencias en vuelo = req/s × latencia) usas los ≈ ${f(e2e, 1)} s, no el TTFT. <i>"For interactive traffic I set two SLOs: time to first token and time per output token."</i>`,
          };
        },
      },
      {
        id: 'la-04', topic: 'latencia', level: 3, title: 'Utilización y colas', ref: 'm03.colas-utilizacion',
        gen(r) {
          const S = r.pick([5, 10, 20]);
          const rho0 = r.pick([0.5, 0.6, 0.7]);
          const gr = r.pick([1.2, 1.25, 1.3]);
          const mu = 1000 / S;
          const lam = Math.round(rho0 * mu);
          const rho = (lam * S) / 1000;
          const W = S / (1 - rho);
          const rho2 = rho * gr;
          const W2 = S / (1 - rho2);
          const Wq = rho * W;
          const Wq2 = rho2 * W2;
          const pctg = Math.round((gr - 1) * 100);
          return {
            q: `Una réplica procesa un request en <b>${S} ms</b> en promedio (tiempo de servicio S), de a uno, con una cola FIFO. Llegan <b>${f(lam)} req/s</b>. Modélala como M/M/1.`,
            parts: [
              {
                ask: 'Utilización ρ de la réplica', unit: '%', answer: rho * 100, tolAbs: 2,
                steps: [
                  'Planteamiento: ρ = tasa de llegada ÷ capacidad, con capacidad = 1 ÷ S.',
                  `Capacidad: 1 ÷ ${f(S / 1000, 3)} s = ${f(mu)} req/s → ρ = ${f(lam)} ÷ ${f(mu)} = <b>${f(rho * 100, 0)} %</b>`,
                ],
              },
              {
                ask: 'Tiempo promedio en el sistema W (cola + servicio)', unit: 'ms', answer: W, tol: 0.15,
                steps: [
                  'Planteamiento (M/M/1): W = S ÷ (1 − ρ).',
                  `Con el resultado anterior (ρ = ${f(rho, 2)}): ${S} ÷ (1 − ${f(rho, 2)}) = <b>${f(W)} ms</b>`,
                  `De eso, ${f(Wq)} ms son espera en cola (W<sub>q</sub> = ρS ÷ (1 − ρ)).`,
                ],
              },
              {
                ask: `El tráfico sube <b>${pctg} %</b>. ¿Cuál es el nuevo W?`, unit: 'ms', answer: W2, tol: 0.15,
                steps: [
                  'Planteamiento: recalcula ρ con la nueva tasa y vuelve a aplicar W = S ÷ (1 − ρ).',
                  `ρ' = ${f(rho, 2)} × ${gr} = ${f(rho2, 3)} → W = ${S} ÷ (1 − ${f(rho2, 3)}) = <b>${f(W2)} ms</b>`,
                  `El tráfico subió ${pctg} % y la latencia promedio se multiplicó por ${f(W2 / W, 1)}; la espera en cola, por ${f(Wq2 / Wq, 1)}. En M/M/1 el p99 es ≈ 4.6 × W: ≈ ${f(4.6 * W2)} ms.`,
                ],
              },
            ],
            hint: 'Tres pasos con la fórmula de M3: ρ = llegadas ÷ capacidad (capacidad = 1 ÷ S); W = S ÷ (1 − ρ); con más tráfico, recalcula ρ y W. Compara cuánto cambia W con cuánto cambió el tráfico.',
            takeaway: 'La espera no crece en línea recta: crece como ρ ÷ (1 − ρ) y explota cerca de 1. Por eso en serving online se planea a ≈ 50–70 % de la capacidad medida (el headroom es protección, no desperdicio), y una cola compartida entre varios servidores aguanta mejor la misma utilización. <i>"In a simple queueing model the wait grows like rho over one minus rho, so I plan GPUs at about 50 to 70 percent."</i>',
          };
        },
      },
      {
        id: 'la-05', topic: 'latencia', level: 3, title: 'Fan-out y latencia de cola', ref: 'm03.percentiles',
        gen(r) {
          const N = r.pick([5, 10, 20, 50, 100]);
          const c = r.pick([
            ['Un request de búsqueda consulta', 'shards del índice'],
            ['Un ranking lee features de', 'shards del feature store'],
            ['Un RAG consulta', 'particiones del índice vectorial'],
          ]);
          const pFast = Math.pow(0.99, N);
          const pSlow = (1 - pFast) * 100;
          const pctl = 100 * Math.pow(0.99, 1 / N);
          const ok = 'Bajar N (precomputar, menos llamadas en el camino crítico) y recortar la cola de cada llamada (timeouts con respuesta parcial, hedging en lecturas baratas)';
          const choices = r.shuffle([ok,
            'Reintentar de inmediato cada llamada lenta, en todas las capas',
            'Reportar el promedio de los p99 de los backends']);
          return {
            q: `${c[0]} <b>${N} ${c[1]}</b> en paralelo y espera a todas las respuestas. Cada llamada supera el p99 de su backend el <b>1 %</b> de las veces, de forma independiente.`,
            parts: [
              {
                ask: '¿Qué porcentaje de los requests del usuario toca al menos una respuesta lenta?', unit: '%', answer: pSlow, tolAbs: 1,
                steps: [
                  'Planteamiento: el request es rápido solo si las N llamadas lo son: P(rápido) = 0.99<sup>N</sup>; P(lento) = 1 − 0.99<sup>N</sup>.',
                  `1 − 0.99<sup>${N}</sup> = 1 − ${f(pFast, 3)} = <b>${f(pSlow, 1)} %</b>`,
                  'Atajo: 0.99<sup>N</sup> ≈ e<sup>−N/100</sup>; con N ≤ 10 alcanza con P(lento) ≈ N %.',
                ],
              },
              {
                ask: '¿Qué percentil tendría que cumplir cada backend para que solo el 1 % de los requests sea lento? (escribe solo el número: para un p95, 95)', unit: '', answer: pctl, tolAbs: 0.01,
                steps: [
                  'Planteamiento: quieres P(rápido) = 0.99 con N llamadas → cada una necesita p = 0.99<sup>1/N</sup> ≈ 1 − 0.01 ÷ N.',
                  `1 − 0.01 ÷ ${N} = ${f(1 - 0.01 / N, 4)} → cada backend tiene que cumplir su <b>p${f(pctl, 2)}</b>`,
                ],
              },
              {
                ask: '¿Qué haces en el diseño?', choices, answer: choices.indexOf(ok),
                steps: [
                  'Las dos respuestas de M3: bajar N y recortar la cola de cada llamada. Reintentar en todas las capas multiplica la carga, y los percentiles no se promedian: se calculan sobre los buckets agregados.',
                ],
              },
            ],
            hint: 'El request espera a la llamada más lenta: es rápido solo si todas lo son. Multiplica las probabilidades de que cada una sea rápida. Para la segunda parte, despeja al revés.',
            takeaway: `Con un fan-out de ${N}, ${pSlow >= 50 ? 'el p99 de cada pieza se vuelve la latencia típica del conjunto' : 'la cola de cada pieza se suma: ≈ ' + f(pSlow, 0) + ' % de requests lentos contra el 1 % de una sola llamada'} (Dean y Barroso, <i>The Tail at Scale</i>). <i>"With a fan-out of ${N}, about ${f(pSlow, 0)}% of requests hit some backend's tail, so I reduce the fan-out and cut the tail with timeouts and hedging."</i>`,
          };
        },
      },
      {
        id: 'la-06', topic: 'latencia', level: 3, title: 'Little con timeouts: pools por pod', ref: 'm03.little',
        gen(r) {
          const lam = r.pick([300, 500, 800, 1000]);
          const K = r.pick([4, 5, 8, 10]);
          const W = r.pick([8, 10, 15, 20]);
          const T = r.pick([100, 150, 200, 250]);
          const L1 = (lam * W) / 1000;
          const L2 = (lam * T) / 1000;
          const L3 = L2 / K;
          const L4 = (lam * 5) / K;
          return {
            q: `El gateway recibe <b>${f(lam)} req/s</b> en el pico, repartidos en <b>${K} pods</b>. Cada llamada a Triton tarda en promedio <b>${W} ms</b> (ida y vuelta) y tiene un timeout de <b>${T} ms</b>.`,
            parts: [
              {
                ask: 'Llamadas a Triton en vuelo en condiciones normales (todo el servicio)', unit: 'llamadas', answer: L1, tol: 0.15,
                steps: [
                  'Planteamiento: Little, L = λ × W, con el tiempo promedio (no el p99).',
                  `${f(lam)} × ${f(W / 1000, 3)} s = <b>${f(L1)} llamadas en vuelo</b>`,
                ],
              },
              {
                ask: 'Si Triton se frena hasta el timeout, ¿cuántas llamadas quedan abiertas (todo el servicio)?', unit: 'llamadas', answer: L2, tol: 0.15,
                steps: [
                  'Planteamiento: el caso malo acotado: si Triton se frena, cada llamada dura hasta el timeout → L = λ × timeout.',
                  `${f(lam)} × ${f(T / 1000, 3)} s = <b>${f(L2)} llamadas</b>`,
                ],
              },
              {
                ask: 'Eso, ¿cuántas conexiones por pod?', unit: 'por pod', answer: L3, tol: 0.15,
                steps: [
                  'Planteamiento: se reparten entre los pods.',
                  `Con el resultado anterior: ${f(L2)} ÷ ${K} = <b>${f(L3)} por pod</b>`,
                  'Ese es el tamaño del pool de conexiones por pod, o el punto donde empiezas a rechazar (un límite tipo MAX_INFLIGHT).',
                ],
              },
              {
                ask: 'Si el timeout a Triton fuera de <b>5 s</b> (mayor que el del caller), ¿cuántos requests quedarían colgados por pod?', unit: 'por pod', answer: L4, tol: 0.15,
                steps: [
                  'Planteamiento: el mismo cálculo con el timeout mal puesto: λ × 5 s ÷ pods.',
                  `${f(lam)} × 5 s ÷ ${K} = <b>${f(L4)} por pod</b>`,
                  'Cada uno ocupa una conexión, memoria y un slot, para una respuesta que el caller ya abandonó.',
                ],
              },
            ],
            hint: 'Little (L = λ · W) tres veces: con el tiempo promedio para lo normal, con el timeout para el caso malo acotado (nunca con el p99), y repartiendo entre pods.',
            takeaway: 'El pool se dimensiona para el caso malo acotado por el timeout, no para el promedio, y cada timeout interno va por debajo de lo que le queda al caller (c01: 300 → 250 → 150 → 100 ms). <i>"I size the connection pool with Little\'s law, using the timeout as the bound: arrival rate times timeout, divided by the number of pods."</i>',
          };
        },
      },
      // ======================================================== DISPONIBILIDAD
      {
        id: 'di-01', topic: 'disponibilidad', level: 1, title: 'Caída permitida por un SLO', ref: 'ref-numeros.tiempo-disponibilidad',
        gen(r) {
          const a = r.pick([99, 99.5, 99.9, 99.95, 99.99]);
          const w = r.pick([
            ['un mes (ventana de 30 días = 43,200 min)', MES_MIN, 'min/mes', 'min'],
            ['un año (8,760 h)', 8760, 'h/año', 'h'],
            ['un día (86,400 s)', DAY, 's/día', 's'],
          ]);
          const u = 1 - a / 100;
          const ans = u * w[1];
          const need = {
            '99': 'una réplica que se reinicia sola y deploys con un corte breve',
            '99.5': 'dos réplicas y alertas atendidas en horario laboral',
            '99.9': 'N+1 en 2 AZs, rollouts sin corte, rollback en minutos y on-call',
            '99.95': 'lo anterior con rollback automático: un incidente de 30 min ya rompe el mes',
            '99.99': 'detección y failover automáticos: nadie arregla nada a mano en 4 minutos',
          }[String(a)];
          return {
            q: `Tu SLO de disponibilidad es <b>${a} %</b>.`,
            parts: [{
              ask: `¿Cuánta caída permite en <b>${w[0]}</b>?`, unit: w[2], answer: ans, tol: 0.15,
              steps: [
                'Planteamiento: caída permitida = (1 − disponibilidad) × duración de la ventana.',
                `(1 − ${f(a / 100, 4)}) × ${f(w[1])} ${w[3]} = ${g(u)} × ${f(w[1])} = <b>${f(ans)} ${w[2]}</b>`,
                'Cada nueve divide la caída permitida entre 10. Para un SLO la ventana típica es de 30 días; para costos, el mes es de 730 h: nombra la que usas.',
              ],
            }],
            hint: 'La fracción que puede fallar es 1 − disponibilidad. Multiplícala por la duración de la ventana, en la unidad que te piden.',
            takeaway: `Lo que suele hacer falta para ${a} % (regla práctica de la hoja de números): ${need}. <i>"Each extra nine cuts the downtime budget by ten, so I only add one if the business needs it."</i>`,
          };
        },
      },
      {
        id: 'di-02', topic: 'disponibilidad', level: 1, title: 'Presupuesto de error en requests', ref: 'm15.disponibilidad',
        gen(r) {
          const a = r.pick([99, 99.5, 99.9, 99.95, 99.99]);
          const M = r.pick([30, 90, 150, 300, 600, 900]);
          const u = 1 - a / 100;
          const ans = u * M * 1e6;
          return {
            q: `Tu SLO es <b>${a} %</b> de requests exitosos en una ventana de 30 días, y en esa ventana recibes <b>${f(M)} M requests</b>.`,
            parts: [{
              ask: '¿Cuántos requests pueden fallar en la ventana sin romper el SLO?', unit: 'requests', answer: ans, tol: 0.15,
              steps: [
                'Planteamiento: presupuesto de error = (1 − SLO) × requests de la ventana.',
                `${g(u)} × ${f(M)} M = <b>${f(ans)} requests</b>`,
              ],
            }],
            hint: 'El presupuesto de error es la fracción que el SLO deja fallar (1 − SLO), aplicada a todos los requests de la ventana.',
            takeaway: `Ese presupuesto es para gastarlo en deploys, experimentos y mantenimiento. Con una política escrita de antemano con producto (por ejemplo, congelar lo riesgoso si queda menos de 10 %), "¿lanzamos o estabilizamos?" deja de depender de quién grita más. <i>"Our SLO is ${a}% over thirty days, which gives us an error budget of about ${say(ans)} failed requests a month."</i>`,
          };
        },
      },
      {
        id: 'di-03', topic: 'disponibilidad', level: 2, title: 'Componentes en serie', ref: 'm15.disponibilidad',
        gen(r) {
          const n = r.pick([3, 4]);
          const comps = r.shuffle([
            ['el balanceador', 99.99], ['el gateway', 99.95], ['el model server', 99.9], ['el feature store', 99.9],
            ['la base de datos', 99.95], ['el servicio de autenticación', 99.99], ['el caché', 99.9],
          ]).slice(0, n);
          const prod = comps.reduce((p, c) => p * (c[1] / 100), 1);
          const sumU = comps.reduce((s, c) => s + (100 - c[1]), 0);
          const worst = Math.min.apply(null, comps.map((c) => c[1]));
          const down = (1 - prod) * MES_MIN;
          const items = comps.map((c) => `${c[0]} (<b>${c[1]} %</b>)`);
          const list = items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
          return {
            q: `Para responder, cada request necesita, en serie: ${list}. Supón esas disponibilidades (valores ilustrativos, no el SLA de ningún producto) y fallas independientes.`,
            parts: [
              {
                ask: 'Disponibilidad de la cadena', unit: '%', answer: prod * 100, tolAbs: 0.01,
                steps: [
                  'Planteamiento: en serie el request necesita todas las piezas: A = A₁ × A₂ × … Atajo: con varios nueves, la indisponibilidad total ≈ la suma de las indisponibilidades.',
                  `${comps.map((c) => f(c[1] / 100, 4)).join(' × ')} = <b>${f(prod * 100, 3)} %</b>`,
                  `Atajo: ${comps.map((c) => f(100 - c[1], 2)).join(' + ')} = ${f(sumU, 2)} % de indisponibilidad → ≈ ${f(100 - sumU, 2)} %`,
                ],
              },
              {
                ask: '¿Cuántos minutos de caída al mes (30 días) significa?', unit: 'min/mes', answer: down, tol: 0.15,
                steps: [
                  'Planteamiento: caída = (1 − A) × 43,200 min.',
                  `Con el resultado anterior (${f(prod * 100, 3)} %): ${g(1 - prod)} × 43,200 ≈ <b>${f(down)} min/mes</b>`,
                  `Peor que el peor eslabón: ${worst} % solo serían ${f((1 - worst / 100) * MES_MIN)} min/mes.`,
                ],
              },
            ],
            hint: 'En serie, multiplica las disponibilidades (o suma las indisponibilidades, que con varios nueves da casi lo mismo). Después pásalo a minutos con la ventana de 30 días.',
            takeaway: 'Tu servicio no puede estar más disponible que el producto de lo que tiene en serie. Antes de prometer nueves recorre la cadena, y saca al modelo del camino crítico si el producto funciona sin él (fallback). <i>"The chain can\'t be more available than the product of its parts, so I check what\'s in series before promising a number."</i>',
          };
        },
      },
      {
        id: 'di-04', topic: 'disponibilidad', level: 2, title: 'Redundancia en paralelo', ref: 'm15.disponibilidad',
        gen(r) {
          const a = r.pick([99, 99.5, 99.9]);
          const u = 1 - a / 100;
          const d1 = u * MES_MIN;
          const u2 = u * u;
          const d2 = u2 * MES_MIN * 60;
          return {
            q: `Un tier corre en <b>2 réplicas</b>, una en cada zona de disponibilidad. Cada réplica está disponible el <b>${a} %</b> del tiempo, las fallas son independientes y basta con una réplica viva.`,
            parts: [
              {
                ask: 'Minutos de caída al mes (30 días) con <b>una</b> sola réplica', unit: 'min/mes', answer: d1, tol: 0.15,
                steps: [
                  'Planteamiento: caída = (1 − A) × 43,200 min.',
                  `(1 − ${f(a / 100, 4)}) × 43,200 = <b>${f(d1)} min/mes</b>`,
                ],
              },
              {
                ask: 'Caída al mes con las <b>dos</b> réplicas, en <b>segundos</b>', unit: 's/mes', answer: d2, tol: 0.15,
                steps: [
                  'Planteamiento: en paralelo el tier cae solo si caen las dos a la vez: indisponibilidad = (1 − A)². Pásalo a segundos: 43,200 min × 60 = 2,592,000 s.',
                  `(${g(u)})² × 2,592,000 s = ${g(u2)} × 2,592,000 ≈ <b>${f(d2)} s/mes</b>`,
                  `Disponibilidad del par: 1 − ${g(u2)} = ${f(100 * (1 - u2), 4)} %.`,
                ],
              },
            ],
            hint: 'Una réplica: (1 − A) × minutos de la ventana. Dos réplicas independientes: el tier cae solo si las dos caen a la vez, así que multiplicas las indisponibilidades. Ojo con la unidad que te piden.',
            takeaway: 'La redundancia compra nueves solo contra fallas <b>independientes</b>: otra zona, otro nodo. Dos réplicas en el mismo nodo o en la misma AZ no son N+1, y lo que tumba a las dos a la vez (un deploy malo, una configuración compartida) domina el resultado. <i>"Redundancy only buys nines against independent failures, so replicas go in different zones."</i>',
          };
        },
      },
      {
        id: 'di-05', topic: 'disponibilidad', level: 3, title: 'Cadena con redundancia y causa común', ref: 'm15.disponibilidad',
        gen(r) {
          const aLB = 99.99;
          const aGw = r.pick([99.9, 99.95]);
          const aTr = r.pick([99, 99.5]);
          const c = r.pick([0.05, 0.1, 0.2]);
          const uTr = 1 - aTr / 100;
          const tr2 = 1 - uTr * uTr;
          const uGw = 1 - aGw / 100;
          const gw2 = 1 - uGw * uGw;
          const chain = (aLB / 100) * gw2 * tr2;
          const chainC = chain * (1 - c / 100);
          const down = (1 - chainC) * MES_MIN;
          return {
            q: `Cadena del request, en serie: balanceador (<b>${aLB} %</b>) → gateway → Triton. El gateway corre en <b>2 zonas</b>, cada una al <b>${aGw} %</b>; Triton también en <b>2 zonas</b>, cada una al <b>${aTr} %</b>. Basta una zona viva por tier y las zonas fallan de forma independiente (valores ilustrativos, como en M15).`,
            parts: [
              {
                ask: 'Disponibilidad del tier de Triton (2 zonas)', unit: '%', answer: tr2 * 100, tolAbs: 0.001,
                steps: [
                  'Planteamiento: en paralelo, A = 1 − (1 − A<sub>zona</sub>)².',
                  `1 − (${g(uTr)})² = 1 − ${g(uTr * uTr)} = <b>${f(tr2 * 100, 4)} %</b>`,
                ],
              },
              {
                ask: 'Disponibilidad de la cadena completa', unit: '%', answer: chain * 100, tolAbs: 0.001,
                steps: [
                  'Planteamiento: el gateway también es un par en paralelo; después, en serie: A = A<sub>LB</sub> × A<sub>gateway</sub> × A<sub>Triton</sub>.',
                  `Gateway: 1 − (${g(uGw)})² = ${f(gw2 * 100, 6)} %`,
                  `Con el resultado anterior (${f(tr2 * 100, 4)} %): ${f(aLB / 100, 4)} × ${f(gw2, 8)} × ${f(tr2, 6)} = <b>${f(chain * 100, 4)} %</b>`,
                  uTr * uTr < 1 - aLB / 100 - 1e-12
                    ? 'Atajo: suma las indisponibilidades de cada tier; el balanceador, sin redundancia propia, es el que más resta.'
                    : `Atajo: suma las indisponibilidades de cada tier; el balanceador, sin redundancia propia, resta tanto como todo el par de Triton (${g(100 - aLB)} % cada uno).`,
                ],
              },
              {
                ask: `Ahora una causa común (un deploy malo, una configuración compartida) tumba las dos zonas de Triton a la vez el <b>${c} %</b> del tiempo. ¿Disponibilidad de la cadena?`, unit: '%', answer: chainC * 100, tolAbs: 0.001,
                steps: [
                  'Planteamiento: la causa común no la cubre la redundancia: va en serie con todo lo demás, A × (1 − c).',
                  `Con el resultado anterior (${f(chain * 100, 4)} %): × (1 − ${g(c / 100)}) = <b>${f(chainC * 100, 3)} %</b>`,
                ],
              },
              {
                ask: '¿Cuántos minutos de caída al mes (30 días) es eso?', unit: 'min/mes', answer: down, tol: 0.15,
                steps: [
                  'Planteamiento: caída = (1 − A) × 43,200 min.',
                  `Con el resultado anterior: ${g(1 - chainC)} × 43,200 ≈ <b>${f(down)} min/mes</b>`,
                  `Sin la causa común serían ≈ ${f((1 - chain) * MES_MIN)} min/mes: la falla correlacionada domina.`,
                ],
              },
            ],
            hint: 'Primero cada tier redundante: 1 − (1 − A)². Después la cadena en serie: multiplica (o suma indisponibilidades). La causa común no la arregla la redundancia: va en serie. Termina en minutos con 30 días.',
            takeaway: 'La redundancia compra nueves solo contra fallas independientes; lo que tumba a las dos zonas a la vez (un deploy, un cambio de configuración, el mismo engine roto) domina el resultado. Por eso existen canary, rollback rápido y despliegues por zona. <i>"Two zones give me nines against independent failures; a bad deploy hits both, so canaries and fast rollback matter more than a third zone."</i>',
          };
        },
      },
      {
        id: 'di-06', topic: 'disponibilidad', level: 3, title: 'Un deploy malo contra el presupuesto', ref: 'm15.disponibilidad',
        gen(r) {
          const D = r.pick([5, 10, 20, 50]);
          const slo = r.pick([99.5, 99.9, 99.95]);
          const x = r.pick([1, 2, 5, 10]);
          const h = r.pick([0.5, 1, 2, 3]);
          const hstr = { 0.5: '30 min', 1: '1 h', 2: '2 h', 3: '3 h' }[h];
          const u = 1 - slo / 100;
          const B = u * D * 1e6 * 30;
          const perH = (D * 1e6) / 24;
          const F = perH * h * (x / 100);
          const P = (F / B) * 100;
          const burn = x / (100 - slo);
          // Alertas multi-window de M12: la ventana larga promedia, así que tarda en cruzar el umbral.
          const tFast = (14.4 / burn) * 60;   // min hasta que la ventana de 1 h llega a 14.4×
          const tSlow = (6 / burn) * 360;     // min hasta que la ventana de 6 h llega a 6×
          const mins = h * 60;
          const pages = burn >= 14.4 && tFast <= mins;
          const alert = burn >= 14.4
            ? (pages ? `El page rápido (14.4×: 2 % del presupuesto en 1 h) suena a los ≈ ${f(tFast, 0)} min del incidente, cuando la ventana de 1 h llega a 14.4×, antes que las quejas.`
              : `Aunque el burn rate pasa de 14.4×, la ventana de 1 h tardaría ≈ ${f(tFast, 0)} min en llegar a 14.4× y el incidente duró ${f(mins, 0)}: el page rápido no alcanza a sonar.`)
            : burn >= 6
              ? (tSlow <= mins ? `No suena el page rápido; el lento (6×: 5 % del presupuesto en 6 h) suena a los ≈ ${f(tSlow, 0)} min.`
                : `Ningún page suena: el rápido pide 14.4× y la ventana de 6 h tardaría ≈ ${f(tSlow, 0)} min en llegar a 6×. Lo ves en el dashboard del SLO o en las quejas.`)
              : `Con menos de 6×, ningún page suena; la alerta de ticket (1× sostenido en 3 días: 10 % del presupuesto) recién sonaría si el incidente durara ≈ ${f(72 / burn, 0)} h. Lo ves en el dashboard del SLO o en las quejas.`;
          return {
            q: `Un servicio recibe <b>${f(D)} M requests/día</b> (repartidos parejo, para simplificar) y su SLO es <b>${slo} %</b> en 30 días. Un deploy malo hace fallar el <b>${x} %</b> de los requests durante <b>${hstr}</b>, hasta que alguien hace rollback.`,
            parts: [
              {
                ask: 'Presupuesto de error del mes (30 días)', unit: 'requests', answer: B, tol: 0.15,
                steps: [
                  'Planteamiento: presupuesto = (1 − SLO) × requests de la ventana.',
                  `${g(u)} × ${f(D)} M × 30 = <b>${f(B)} requests</b>`,
                ],
              },
              {
                ask: 'Requests que fallaron en el incidente', unit: 'requests', answer: F, tol: 0.15,
                steps: [
                  'Planteamiento: fallidos = requests por hora × horas × tasa de error.',
                  `${f(D)} M ÷ 24 = ${f(perH)} requests/h → × ${h} h × ${x} % = <b>${f(F)} requests</b>`,
                ],
              },
              {
                ask: '¿Qué porcentaje del presupuesto del mes se comió?', unit: '%', answer: P, tol: 0.15,
                steps: [
                  'Planteamiento: fracción = fallidos ÷ presupuesto.',
                  `Con los resultados anteriores: ${f(F)} ÷ ${f(B)} = <b>${f(P)} %</b> del presupuesto`,
                ],
              },
              {
                ask: 'Burn rate durante el incidente', unit: '×', answer: burn, tol: 0.15,
                steps: [
                  'Planteamiento: burn rate = tasa de error ÷ tasa permitida (1 − SLO). Burn rate 1 agota el presupuesto justo al final de la ventana.',
                  `${x} % ÷ ${g(100 - slo)} % = <b>${f(burn)}×</b>`,
                  `A ese ritmo, el presupuesto de 30 días (720 h) se acaba en 720 ÷ ${f(burn)} ≈ ${f(720 / burn)} h.`,
                ],
              },
            ],
            hint: 'Cuatro cuentas encadenadas: presupuesto = (1 − SLO) × requests en 30 días; fallidos = requests por hora × horas × tasa de error; su cociente; y burn rate = tasa de error ÷ (1 − SLO).',
            takeaway: `${alert} ${P >= 100 ? 'Un solo incidente se comió el mes entero: según la política acordada, se congelan los lanzamientos riesgosos.' : 'Con el canary y el rollback automático, el mismo incidente se corta en minutos.'} <i>"At ${slo}%, a deploy failing ${x}% of requests burns the error budget at ${f(burn)}x${pages ? ', so the fast burn-rate alert pages within about ' + f(tFast, 0) + ' minutes' : ''}."</i>`,
          };
        },
      },
      // ======================================================== HARDWARE
      {
        id: 'hw-01', topic: 'hardware', level: 1, title: 'Memoria de los pesos', ref: 'm04.bytes-dtype',
        gen(r) {
          const m = r.pick([
            ['ResNet-50', 25.6, 'M', ['FP32', 'FP16', 'INT8']],
            ['YOLOv8m', 25.9, 'M', ['FP32', 'FP16', 'INT8']],
            ['ViT-B/16', 86, 'M', ['FP32', 'FP16', 'INT8']],
            ['Llama 3 8B', 8.03, 'B', ['BF16', 'FP8', 'INT8', 'INT4']],
            ['Llama 3 70B', 70.6, 'B', ['BF16', 'FP8', 'INT8', 'INT4']],
          ]);
          const dt = r.pick(m[3]);
          const bytes = { FP32: 4, FP16: 2, BF16: 2, FP8: 1, INT8: 1, INT4: 0.5 }[dt];
          const unit = m[2] === 'M' ? 'MB' : 'GB';
          const ans = m[1] * bytes;
          const llm = m[2] === 'B';
          const fit = !llm ? 'Una CNN o un ViT pesan decenas o cientos de MB: en una GPU de 16 GB la memoria casi nunca es el problema; mandan el throughput y el costo por hora.'
            : ans > 80 ? 'No cabe en una H100 de 80 GB: o lo partes en 2 o más GPUs (tensor parallelism) o lo cuantizas.'
              : ans > 40 ? 'Cabe en una GPU de 80 GB, pero casi sin lugar para el KV cache: en c10 va en 2 × H100.'
                : ans > 24 ? 'No cabe en una GPU de 24 GB (L4, A10G): va en una de 80 GB (A100, H100), con lugar para el KV cache, si la calidad aguanta en tu golden set.'
                  : ans >= 16 ? 'No cabe en una T4 de 16 GB con su runtime: L4, A10G o cuantizar, y revisar cuánto queda para el KV cache.'
                    : 'Cabe con holgura en una GPU de 24 GB y libera memoria para el KV cache (más conversaciones a la vez), si la calidad aguanta en tu golden set.';
          return {
            q: `¿Cuánta memoria ocupan solo los <b>pesos</b> de <b>${m[0]}</b> (${m[0] === 'ViT-B/16' ? '≈ ' : ''}${f(m[1])} ${m[2]} de parámetros) en <b>${dt}</b>?`,
            parts: [{
              ask: `Memoria de los pesos, en ${unit} (sin activaciones ni runtime)`, unit, answer: ans, tol: 0.15,
              steps: [
                'Planteamiento: pesos = parámetros × bytes por valor (FP32 4 · FP16/BF16 2 · FP8/INT8 1 · INT4 0.5).',
                `${f(m[1])} ${m[2]} × ${bytes} B = <b>${f(ans)} ${unit}</b>`,
                dt === 'INT4' ? 'Es el número teórico: en la práctica se suman las escalas por grupo y las capas que quedan en 16 bits (8B en INT4 ≈ 4–6 GB).' : 'Es solo la memoria de los pesos: al servir se suman activaciones, runtime y, en un LLM, el KV cache.',
              ],
            }],
            hint: 'Multiplica los parámetros por los bytes de cada valor del dtype. Cuidado: "8B" son parámetros, no bytes.',
            takeaway: `${fit} <i>"${m[0]} in ${dt} is about ${f(ans)} ${unit} of weights, before ${llm ? 'activations, runtime and the KV cache' : 'activations and runtime'}."</i>`,
          };
        },
      },
      {
        id: 'hw-02', topic: 'hardware', level: 1, title: 'Techo de decode de un LLM', ref: 'm04.roofline',
        gen(r) {
          const c = r.pick([
            ['L4', 300, 'Llama 3 8B', 'BF16', 16.06],
            ['A10G', 600, 'Llama 3 8B', 'BF16', 16.06],
            ['A100 de 80 GB', 2039, 'Llama 3 8B', 'BF16', 16.06],
            ['H100', 3350, 'Llama 3 8B', 'BF16', 16.06],
            ['L4', 300, 'Llama 3 8B', 'INT8 weight-only', 8.03],
            ['A10G', 600, 'Llama 3 8B', 'INT8 weight-only', 8.03],
            ['A100 de 80 GB', 2039, 'Llama 3 70B', 'INT4 weight-only', 35.3],
            ['H100', 3350, 'Llama 3 70B', 'INT4 weight-only', 35.3],
          ]);
          const tps = c[1] / c[4];
          return {
            q: `Decode a batch 1 de <b>${c[2]}</b> en <b>${c[3]}</b> (≈ ${f(c[4], 2)} GB de pesos) en una <b>${c[0]}</b> (${f(c[1])} GB/s de ancho de banda de memoria).`,
            parts: [{
              ask: 'Techo de tokens por segundo por secuencia', unit: 'tokens/s', answer: tps, tol: 0.15,
              steps: [
                'Planteamiento: en el decode cada token relee todos los pesos (memory-bound): tokens/s ≲ ancho de banda ÷ bytes de pesos.',
                `${f(c[1])} GB/s ÷ ${f(c[4], 2)} GB ≈ <b>${f(tps)} tokens/s</b>`,
                `O sea, ≥ ${f(1000 / tps)} ms por token. Es una cota: ignora la lectura del KV cache y el overhead; lo real es menor (se mide con vllm bench serve).`,
              ],
            }],
            hint: 'En el decode a batch 1 manda la memoria, no los TFLOPS: cada token obliga a leer todos los pesos una vez. Divide el ancho de banda entre los bytes de pesos.',
            takeaway: 'Más TFLOPS no aceleran el decode; más ancho de banda o menos bytes (INT8 duplica el techo) sí. El throughput total sube con batching hasta que el KV cache llena la memoria. <i>"Decode is memory-bound: tokens per second per sequence can\'t beat bandwidth divided by weight bytes."</i>',
          };
        },
      },
      {
        id: 'hw-03', topic: 'hardware', level: 2, title: 'KV cache por token y por secuencia', ref: 'm04.vram',
        gen(r) {
          const m = r.pick([['8B', 32], ['70B', 80]]);
          const kv = r.pick([['BF16', 2], ['FP8', 1]]);
          const T = r.pick([2048, 4096, 8192, 32768]);
          const name = (T > 8192 ? 'Llama 3.1 ' : 'Llama 3 ') + m[0];
          const bpt = 2 * m[1] * 8 * 128 * kv[1];
          const kib = bpt / 1024;
          const gb = (bpt * T) / 1e9;
          return {
            q: `<b>${name}</b>${T > 8192 ? ' (misma arquitectura que Llama 3, con contexto de hasta 128k)' : ''}: <b>${m[1]} capas</b>, <b>8 KV heads</b> (grouped-query attention) y <b>head_dim = 128</b>. El KV cache se guarda en <b>${kv[0]}</b>.`,
            parts: [
              {
                ask: 'KV cache por token', unit: 'KiB', answer: kib, tol: 0.15,
                steps: [
                  'Planteamiento: KV por token = 2 (K y V) × capas × KV heads × head_dim × bytes.',
                  `2 × ${m[1]} × 8 × 128 × ${kv[1]} B = ${f(bpt)} B ÷ 1,024 = <b>${f(kib)} KiB</b>`,
                ],
              },
              {
                ask: `Una secuencia de <b>${f(T)} tokens</b>: ¿cuántos GB (10<sup>9</sup> B) de KV cache ocupa?`, unit: 'GB', answer: gb, tol: 0.15,
                steps: [
                  'Planteamiento: KV por secuencia = KV por token × tokens, en GB (10<sup>9</sup> B), la unidad de la VRAM en la hoja de datos.',
                  `Con el resultado anterior (${f(kib)} KiB = ${f(bpt)} B): ${f(bpt)} B × ${f(T)} = ${f((bpt * T) / Math.pow(2, 30), 3)} GiB ≈ <b>${f(gb)} GB</b>`,
                  '1 GiB ≈ 1.074 GB: no mezcles las dos en una misma cuenta.',
                ],
              },
            ],
            hint: 'Por token: 2 (K y V) × capas × KV heads × head_dim × bytes del dtype del KV; 1 KiB = 1,024 B. Por secuencia: multiplica por los tokens y pásalo a GB.',
            takeaway: `Cada secuencia de ${f(T)} tokens se lleva ${f(gb)} GB de VRAM solo en KV: por eso la concurrencia de un LLM la limita la memoria, no el cómputo. GQA (8 KV heads en vez de uno por query head) es lo que lo hace manejable, y el KV en FP8 lo divide entre 2. <i>"At ${f(kib)} KiB per token, ${T === 8192 ? 'an' : 'a'} ${f(T)}-token sequence holds about ${s2(gb)} GB of KV cache."</i>`,
          };
        },
      },
      {
        id: 'hw-04', topic: 'hardware', level: 2, title: 'Cuántas GPUs con N+1', ref: 'm03.cuantas-gpus',
        gen(r) {
          const P = r.pick([300, 500, 800, 1200, 2000, 3500, 5000]);
          const C = r.pick([400, 600, 800, 1000, 1200, 1500]);
          const u = r.pick([0.5, 0.6, 0.7]);
          const plan = C * u;
          const n = ceilx(P / plan);
          return {
            q: `Pico de diseño: <b>${f(P)} req/s</b>. Una GPU sostiene como máximo <b>${f(C)} req/s</b> cumpliendo el SLO (medido con perf_analyzer). Planeas con una utilización objetivo de <b>${Math.round(u * 100)} %</b> y redundancia <b>N+1</b>.`,
            parts: [
              {
                ask: 'Capacidad planificada por GPU', unit: 'req/s', answer: plan, tol: 0.05,
                steps: [
                  'Planteamiento: capacidad planificada = capacidad medida al SLO × utilización objetivo.',
                  `${f(C)} × ${u} = <b>${f(plan)} req/s</b> por GPU`,
                ],
              },
              {
                ask: 'GPUs en total (throughput + N+1)', unit: 'GPUs', answer: n + 1, tol: 0,
                steps: [
                  'Planteamiento: GPUs = ⌈pico de diseño ÷ capacidad planificada⌉ + 1.',
                  `Con el resultado anterior: ⌈${f(P)} ÷ ${f(plan)}⌉ = ⌈${f(P / plan, 2)}⌉ = ${n}; + 1 = <b>${n + 1} GPUs</b>`,
                  n === 1 ? 'Una GPU alcanza por throughput: la segunda es por disponibilidad, no por throughput.' : `Si cae una, las ${n} restantes llevan ${f((P / n / C) * 100, 0)} % de su máximo medido cada una.`,
                ],
              },
            ],
            hint: 'La fórmula de M3 en tres piezas: capacidad planificada = medida × utilización; divide el pico de diseño (no el promedio) y redondea hacia arriba; suma la redundancia.',
            takeaway: `Ese número va directo al costo (GPUs × US$/h × 730). Si el load test da una capacidad menor, la fórmula pide más GPUs: di el supuesto y cómo lo mides. <i>"${n === 1 ? 'One GPU covers the throughput; the second one is for availability, not throughput.' : n + ' GPUs cover the design peak at ' + Math.round(u * 100) + '% target utilization, plus one for N+1.'}"</i>`,
          };
        },
      },
      {
        id: 'hw-05', topic: 'hardware', level: 3, title: 'VRAM: cuántas secuencias caben', ref: 'm14.kv-cache',
        gen(r) {
          // [GPU, VRAM total GB, modelo, dtype, GB de pesos, GB de runtime, KiB de KV por token, largos posibles]
          const c = r.pick([
            // L4 como en M4: ≈ 2 GB de runtime → ≈ 3.5 GB de KV: ≈ 3 secuencias de 8k, ≈ 13 de 2k.
            ['una L4', 24, 'Llama 3 8B', 'BF16', 16.06, 2, 128, [1024, 2048, 4096, 8192]],
            ['una H100', 80, 'Llama 3 8B', 'BF16', 16.06, 2, 128, [1000, 2250, 4096, 8192]],
            ['2 × H100 con tensor parallelism (160 GB)', 160, 'Llama 3 70B', 'FP8', 70.6, 5, 320, [1000, 2250, 8192]],
            ['una H100', 80, 'Llama 3 70B', 'INT4 weight-only', 35.3, 3, 320, [1000, 2250, 8192]],
          ]);
          const T = r.pick(c[7]);
          const free = 0.9 * c[1] - c[4] - c[5];
          const per = (T * c[6] * 1024) / 1e9;
          const seqs = floorx(free / per);
          const ok = 'KV cache en FP8 (--kv-cache-dtype fp8)';
          const choices = r.shuffle([ok,
            'Una GPU con el doble de TFLOPS y la misma memoria',
            'Subir --max-model-len para que quepan conversaciones más largas']);
          return {
            q: `Sirves <b>${c[2]}</b> en ${c[3]} (≈ ${f(c[4], 2)} GB de pesos) en <b>${c[0]}</b>. vLLM usa el <b>90 %</b> de la VRAM (gpu_memory_utilization fijado en 0.9) y el runtime con las activaciones se lleva ≈ <b>${c[5]} GB</b>. Cada conversación ocupa ≈ <b>${f(T)} tokens</b> (prompt + respuesta) y el KV cache va en BF16: <b>${c[6]} KiB por token</b>.`,
            parts: [
              {
                ask: 'GB libres para el KV cache', unit: 'GB', answer: free, tol: 0.15,
                steps: [
                  'Planteamiento: KV libre = 0.9 × VRAM − pesos − runtime.',
                  `0.9 × ${c[1]} − ${f(c[4], 2)} − ${c[5]} = <b>${f(free)} GB</b>`,
                ],
              },
              {
                ask: 'GB de KV cache por conversación', unit: 'GB', answer: per, tol: 0.15,
                steps: [
                  'Planteamiento: KV por secuencia = tokens × KV por token (1 KiB = 1,024 B), en GB.',
                  `${f(T)} × ${c[6]} × 1,024 B = ${f(T * c[6] * 1024)} B ≈ <b>${f(per, 3)} GB</b>`,
                ],
              },
              {
                ask: '¿Cuántas conversaciones caben a la vez? (redondea hacia abajo)', unit: 'secuencias', answer: seqs, tol: 0,
                steps: [
                  'Planteamiento: secuencias = ⌊KV libre ÷ KV por secuencia⌋: media secuencia no sirve.',
                  `Con los resultados anteriores: ⌊${f(free)} ÷ ${f(per, 3)}⌋ = ⌊${f(free / per, 2)}⌋ = <b>${seqs} secuencias</b>`,
                  'Al arrancar, vLLM imprime cuántos tokens caben en el KV cache (<code>GPU KV cache size: N tokens</code>) y la concurrencia máxima con el contexto configurado: ese número, no la cuenta de servilleta, es tu capacidad real.',
                ],
              },
              {
                ask: '¿Qué palanca te da ≈ el doble de conversaciones en la misma GPU?', choices, answer: choices.indexOf(ok),
                steps: [
                  'El KV en FP8 ocupa la mitad (1 byte por valor): el doble de secuencias o de contexto en la misma memoria (riesgo bajo a medio en contextos largos: verifícalo). Los TFLOPS no cambian la memoria, y un contexto máximo más largo baja la concurrencia.',
                ],
              },
            ],
            hint: 'Resta pesos y runtime de la memoria que vLLM puede usar; calcula el KV de una conversación (tokens × KV por token); divide y redondea hacia abajo.',
            takeaway: `El KV cache, no el cómputo, limita la concurrencia de un LLM. Si el tráfico pide más secuencias a la vez (Little: req/s × latencia e2e), necesitas más réplicas, menos bytes por token o GPUs con más memoria. <i>"After weights and runtime I have about ${f(free)} GB for the KV cache, which is about ${seqs} concurrent conversations of this length."</i>`,
          };
        },
      },
      {
        id: 'hw-06', topic: 'hardware', level: 3, title: 'CPU del preproceso', ref: 'c01.estimaciones',
        gen(r) {
          const P = r.pick([300, 500, 800, 1200, 2000]);
          const m = r.pick([2, 4, 6, 8, 12]);
          const u = r.pick([0.6, 0.7]);
          const k = r.pick([4, 5]);
          const avg = P / k;
          const cores = (P * m) / 1000;
          const vcpu = cores / u;
          const c4 = ceilx(vcpu / 4);
          const nodes = Math.max(2, c4);
          const cost = nodes * 0.17 * MES_H;
          const coresTxt = (x) => f(x) + (Math.abs(x - 1) < 1e-9 ? ' core' : ' cores');
          return {
            q: `El gateway decodifica y preprocesa cada imagen en CPU: ≈ <b>${m} ms de CPU por request</b> (medido con fotos reales). El tráfico promedia <b>${f(avg)} req/s</b> y el pico de diseño es <b>${f(P)} req/s</b>. El HPA escala al <b>${Math.round(u * 100)} %</b> de CPU y los nodos son <b>c6i.xlarge</b> (4 vCPU, ≈ US$0.17/h, aprox.).`,
            parts: [
              {
                ask: 'Cores ocupados en el <b>pico</b>', unit: 'cores', answer: cores, tol: 0.15,
                steps: [
                  'Planteamiento (Little aplicado a la CPU): cores ocupados = tasa × tiempo de CPU por request. Con el pico de diseño, no con el promedio.',
                  `${f(P)} × ${f(m / 1000, 3)} s = <b>${coresTxt(cores)}</b>`,
                  `Con el promedio darían ${f((avg * m) / 1000)}: dimensionar con eso satura el threadpool en el pico y el p99 explota.`,
                ],
              },
              {
                ask: 'vCPU a provisionar (lo que suman los requests de CPU de los pods)', unit: 'vCPU', answer: vcpu, tol: 0.15,
                steps: [
                  'Planteamiento: vCPU = cores ocupados ÷ utilización objetivo del HPA.',
                  `Con el resultado anterior: ${f(cores)} ÷ ${u} = <b>${f(vcpu)} vCPU</b>`,
                ],
              },
              {
                ask: 'Nodos c6i.xlarge (mínimo 2, uno por zona)', unit: 'nodos', answer: nodes, tol: 0,
                steps: [
                  'Planteamiento: nodos = ⌈vCPU ÷ 4⌉, y al menos 2 para repartir en dos zonas.',
                  `Con el resultado anterior: ⌈${f(vcpu)} ÷ 4⌉ = ${c4} → <b>${nodes} nodos</b>`,
                ],
              },
              {
                ask: 'Costo mensual de esos nodos', unit: 'US$/mes', answer: cost, tol: 0.15,
                steps: [
                  'Planteamiento: costo = nodos × US$/h × 730 h.',
                  `Con el resultado anterior: ${nodes} × 0.17 × 730 = <b>US$${f(cost)}/mes</b>`,
                ],
              },
            ],
            hint: 'Little aplicado a la CPU: cores = req/s del pico × segundos de CPU por request. Después divide por la utilización objetivo del HPA, reparte en nodos de 4 vCPU (mínimo 2) y ponle precio con 730 h.',
            takeaway: `Cada tier se dimensiona por separado y con el pico: en el caso 1 el gateway en CPU (≈ 3 cores en el pico de diseño) es lo primero que se satura en un spike. Si el preproceso pesa (fotos de 12 MP: ≈ 40–80 ms de CPU), limitar tamaños, el draft mode de JPEG o reducir en el cliente valen más que otra GPU. <i>"Preprocessing costs about ${m} ms of CPU per image, so the design peak keeps ${coresTxt(cores)} busy; with the autoscaler targeting ${Math.round(u * 100)}%, I request about ${f(vcpu)} vCPUs."</i>`,
          };
        },
      },
      {
        id: 'hw-07', topic: 'hardware', level: 3, title: 'Prefill vs decode: pisos de latencia', ref: 'm04.roofline',
        gen(r) {
          const gp = r.pick([['L4', 121, 300], ['A10G', 70, 600], ['A100 de 80 GB', 312, 2039], ['H100', 990, 3350]]);
          const Pt = r.pick([1000, 2000, 4000]);
          const n = r.pick([100, 250, 500]);
          const ttftS = (2 * 8.03e9 * Pt) / (gp[1] * 1e12);
          const ttftMs = ttftS * 1000;
          const tpotMs = (16.06 / gp[2]) * 1000;
          const e2e = ttftS + ((n - 1) * tpotMs) / 1000;
          const ok = 'El del TTFT: crece con los tokens del prompt; lo bajan más cómputo (TFLOPS, FP8) o prefix caching';
          const choices = r.shuffle([ok,
            'El del TPOT: crece con el prompt; lo baja más ancho de banda',
            'Ninguno: el largo del prompt no cambia la latencia']);
          return {
            q: `<b>Llama 3 8B</b> en BF16 (8.03 B parámetros, ≈ 16.06 GB de pesos) en una <b>${gp[0]}</b> (≈ ${f(gp[1])} TFLOPS BF16 densos, ${f(gp[2])} GB/s). Un request trae un prompt de <b>${f(Pt)} tokens</b> y genera <b>${n} tokens</b>, a batch 1 y sin cola.`,
            parts: [
              {
                ask: 'Piso del time to first token (prefill)', unit: 'ms', answer: ttftMs, tol: 0.15,
                steps: [
                  'Planteamiento: el prefill es compute-bound: TTFT ≳ 2 × parámetros × tokens del prompt ÷ FLOPS pico.',
                  `2 × 8.03 × 10<sup>9</sup> × ${f(Pt)} ÷ (${f(gp[1])} × 10<sup>12</sup>) = ${f(ttftS, 3)} s = <b>${f(ttftMs)} ms</b>`,
                  'Es un piso: el cómputo real no llega al pico, y en producción se suma la cola.',
                ],
              },
              {
                ask: 'Piso del tiempo por token de salida (decode)', unit: 'ms', answer: tpotMs, tol: 0.15,
                steps: [
                  'Planteamiento: el decode es memory-bound: cada token relee los pesos → TPOT ≳ bytes de pesos ÷ ancho de banda.',
                  `16.06 GB ÷ ${f(gp[2])} GB/s = <b>${f(tpotMs)} ms</b>`,
                ],
              },
              {
                ask: 'Piso de la latencia completa del request', unit: 's', answer: e2e, tol: 0.15,
                steps: [
                  'Planteamiento: e2e = TTFT + (tokens − 1) × TPOT.',
                  `Con los resultados anteriores: ${f(ttftS, 3)} s + ${n - 1} × ${f(tpotMs / 1000, 4)} s = <b>${f(e2e)} s</b>`,
                ],
              },
              {
                ask: `Producto quiere prompts 4× más largos (RAG con más contexto${4 * Pt + n > 8192 ? '; pasan de los 8k tokens de Llama 3, así que usas Llama 3.1 8B: misma arquitectura, contexto de 128k' : ''}). ¿Qué piso crece y qué lo baja?`, choices, answer: choices.indexOf(ok),
                steps: [
                  `El TTFT escala con los FLOPs del prefill, proporcionales a los tokens del prompt: ≈ 4× (${f(4 * ttftMs)} ms de piso). A batch 1 el TPOT se mueve poco: además de los 16 GB de pesos, cada paso lee el KV del contexto, ≈ 1 GB por cada 8k tokens.`,
                ],
              },
            ],
            hint: 'Dos regímenes: el prefill usa cada peso para todos los tokens del prompt (manda el cómputo: 2 × parámetros × tokens ÷ FLOPS); el decode lee todos los pesos por token (manda la memoria: bytes ÷ ancho de banda). Súmalos con e2e = TTFT + (tokens − 1) × TPOT.',
            takeaway: 'El time to first token escala con FLOPs; el tiempo por token, con bytes. Por eso se optimizan distinto: cómputo (FP8, una GPU más grande) o prefix caching para el prefill; menos bytes (INT8) para el tiempo por token, y batching para el throughput total del decode. <i>"Prefill is compute-bound and decode is memory-bound, so I check FLOPS for time to first token and bandwidth for time per output token."</i>',
          };
        },
      },
      // ======================================================== COSTO
      {
        id: 'co-01', topic: 'costo', level: 1, title: 'Costo mensual de una flota', ref: 'ref-numeros.costos',
        gen(r) {
          const it = r.pick([
            ['g4dn.xlarge (1 T4)', 0.526], ['g6.xlarge (1 L4)', 0.805], ['g5.xlarge (1 A10G)', 1.006],
            ['c6i.xlarge (4 vCPU)', 0.17], ['p5.4xlarge (1 H100)', 6.88], ['g6e.xlarge (1 L40S)', 1.86],
          ]);
          const n = r.pick([1, 2, 3, 4, 5, 8, 10]);
          const cost = n * it[1] * MES_H;
          return {
            q: `Tu servicio corre <b>${n} × ${it[0]}</b> encendida${n === 1 ? '' : 's'} todo el mes, a ≈ <b>US$${it[1]}/h</b>${n === 1 ? '' : ' cada una'} (on-demand, aprox.).`,
            parts: [{
              ask: 'Costo mensual', unit: 'US$/mes', answer: cost, tol: 0.15,
              steps: [
                'Planteamiento: costo mensual = instancias × US$/h × 730 h (365 × 24 ÷ 12).',
                `${n} × ${it[1]} × 730 = <b>US$${f(cost)}/mes</b>`,
                `Al año (× 12): ≈ US$${f(cost * 12)}.`,
              ],
            }],
            hint: 'Pasa de por hora a por mes con 730 h (el mes promedio, 30.4 días) y multiplica por las instancias encendidas.',
            takeaway: `Es el número que compara opciones de hardware y decide si un compromiso (≈ 30–40 % a 1 año) vale la pena sobre la base estable. Pero para comparar diseños, el número honesto es el costo por predicción con la utilización real. <i>"At about $${it[1]} an hour, ${n === 1 ? 'one instance is' : n + ' instances are'} roughly $${say(cost)} a month on demand."</i>`,
          };
        },
      },
      {
        id: 'co-02', topic: 'costo', level: 2, title: 'Encendida solo en horario de trabajo', ref: 'm13.costos-ocultos',
        gen(r) {
          const it = r.pick([['g4dn.xlarge', 0.526, '1 T4'], ['g6.xlarge', 0.805, '1 L4'], ['g5.xlarge', 1.006, '1 A10G']]);
          const n = r.pick([1, 2, 3]);
          const W = r.pick([40, 50, 60, 70]);
          const c1 = n * it[1] * MES_H;
          const hMes = (W * MES_H) / 168;
          const c2 = n * it[1] * hMes;
          const save = (1 - W / 168) * 100;
          return {
            q: `Un entorno de staging tiene <b>${n} × ${it[0]}</b> (${it[2]}, ≈ US$${it[1]}/h${n === 1 ? '' : ' cada una'}, aprox.) encendida${n === 1 ? '' : 's'} las 24 horas. El equipo solo ${n === 1 ? 'la usa' : 'las usa'} <b>${W} h por semana</b>.`,
            parts: [
              {
                ask: 'Costo mensual encendida 24/7', unit: 'US$/mes', answer: c1, tol: 0.15,
                steps: [
                  'Planteamiento: costo = instancias × US$/h × 730 h.',
                  `${n} × ${it[1]} × 730 = <b>US$${f(c1)}/mes</b>`,
                ],
              },
              {
                ask: `Costo mensual si se ${n === 1 ? 'enciende' : 'encienden'} solo esas ${W} h por semana`, unit: 'US$/mes', answer: c2, tol: 0.15,
                steps: [
                  'Planteamiento: horas al mes = horas por semana × semanas por mes (730 ÷ 168 ≈ 4.35).',
                  `${W} × 4.35 ≈ ${f(hMes)} h/mes → ${n} × ${it[1]} × ${f(hMes)} ≈ <b>US$${f(c2)}/mes</b>`,
                  `Ahorro: 1 − ${W} ÷ 168 ≈ ${f(save, 0)} %.`,
                ],
              },
            ],
            hint: 'Primero el mes completo con 730 h. Para el horario reducido, convierte horas por semana a horas por mes: un mes tiene 730 ÷ 168 ≈ 4.35 semanas.',
            takeaway: `La nube cobra la hora encendida, no la hora útil: "facturado vs ocupado" es la pregunta para cada GPU del diseño (staging, CI, notebooks). Apagar fuera de horario es de las palancas más baratas. <i>"Staging GPUs only run during working hours, which cuts their cost by about ${f(save, 0)}%."</i>`,
          };
        },
      },
      {
        id: 'co-03', topic: 'costo', level: 2, title: 'Comprometer la base, no la ráfaga', ref: 'm13.compromisos',
        gen(r) {
          const it = r.pick([['g4dn.xlarge (T4)', 0.526, 0.37], ['g5.xlarge (A10G)', 1.006, 0.37], ['g6.xlarge (L4)', 0.805, 0.35]]);
          const B = r.pick([2, 3, 4]);
          const K = r.pick([2, 4, 6]);
          const h = r.pick([3, 4, 6]);
          const p = it[1];
          const d = it[2];
          const avgN = B + (K * h) / 24;
          const c1 = avgN * p * MES_H;
          const c2 = (B + K) * p * (1 - d) * MES_H;
          const c3 = B * p * (1 - d) * MES_H + ((K * h) / 24) * p * MES_H;
          const util = avgN / (B + K);
          return {
            q: `Tu servicio tiene <b>${B} × ${it[0]}</b> siempre encendidas (la base, N+1 incluido) y el autoscaler agrega hasta <b>${K} más</b> durante ≈ <b>${h} h al día</b>. On-demand cuesta ≈ <b>US$${p}/h</b>; un Savings Plan a 1 año da ≈ <b>${Math.round(d * 100)} %</b> de descuento (observado, aprox.).`,
            parts: [
              {
                ask: 'Costo mensual on-demand de lo que realmente usas', unit: 'US$/mes', answer: c1, tol: 0.15,
                steps: [
                  'Planteamiento: instancias promedio = base + ráfaga × (horas ÷ 24); costo = promedio × US$/h × 730.',
                  `${B} + ${K} × ${h} ÷ 24 = ${f(avgN, 2)} instancias en promedio → × ${p} × 730 = <b>US$${f(c1)}/mes</b>`,
                ],
              },
              {
                ask: `Costo mensual si comprometes el máximo del autoscaler (${B + K} instancias)`, unit: 'US$/mes', answer: c2, tol: 0.15,
                steps: [
                  'Planteamiento: un compromiso se paga se use o no: máximo × US$/h × (1 − descuento) × 730.',
                  `${B + K} × ${p} × ${f(1 - d, 2)} × 730 = <b>US$${f(c2)}/mes</b>`,
                  Math.abs(c2 - c1) < 0.5
                    ? `Cuesta lo mismo que on-demand: usas justo el ${f(util * 100, 1)} % de lo comprometido, el punto de equilibrio (1 − ${d} = ${f((1 - d) * 100, 0)} %). Pagas lo mismo y pierdes la flexibilidad.`
                    : c2 > c1
                      ? `Sale US$${f(c2 - c1)} más caro que no comprometer nada: usas el ${f(util * 100, 1)} % de lo comprometido, y un compromiso solo conviene arriba de 1 − ${d} = ${f((1 - d) * 100, 0)} %.`
                      : `Sale US$${f(c1 - c2)} más barato que on-demand porque usas el ${f(util * 100, 1)} % de lo comprometido, más que 1 − ${d} = ${f((1 - d) * 100, 0)} %.`,
                  `Comprometiendo solo la base y pagando la ráfaga on-demand: ${B} × ${p} × ${f(1 - d, 2)} × 730 + ${f((K * h) / 24, 2)} × ${p} × 730 ≈ <b>US$${f(c3)}/mes</b>, la opción más barata.`,
                ],
              },
            ],
            hint: 'Promedio de instancias = base + ráfaga × fracción del día. El compromiso cobra todas las horas comprometidas, con descuento. Compara, y piensa qué parte del uso existe todo el año.',
            takeaway: 'Un compromiso convierte un costo variable en fijo: sobre la base (100 % de uso) es dinero gratis; sobre la ráfaga, pagas horas que no usas. Regla: conviene solo si usas más que 1 − descuento de lo comprometido. Y un Savings Plan es un descuento, no una reserva de capacidad. <i>"I commit only the steady baseline after a few months of real usage, never the burst."</i>',
          };
        },
      },
      {
        id: 'co-04', topic: 'costo', level: 3, title: 'Costo por 1,000 predicciones: capacidad vs carga real', ref: 'm04.costo-por-prediccion',
        gen(r) {
          const gp = r.pick([
            ['T4', 'g4dn.xlarge', 0.526, 600, ' (la del c01: 1,200 medidas, planeadas al 50 %)'],
            ['L4', 'g6.xlarge', 0.805, 1500, ' (supuesto de M4: ≈ 2.5× la T4; mídelo con perf_analyzer)'],
          ]);
          const A = r.pick([50, 100, 150, 300]);
          const p = gp[2];
          const thr = gp[3];
          // La flota sale de la fórmula de M3: pico de diseño (≈ 3× de pico × 1.5 de margen) + N+1.
          const design = A * 4.5;
          const n = ceilx(design / thr) + 1;
          const atCap = p / (thr * 3.6);
          const month = n * p * MES_H;
          const predM = (A * 3600 * MES_H) / 1e6;
          const real = (month / (predM * 1e6)) * 1000;
          const idle = (1 - A / (n * thr)) * 100;
          return {
            q: `Un servicio de visión corre <b>${n} × ${gp[0]}</b> (${gp[1]}, ≈ US$${p}/h, aprox.) siempre encendidas, sin autoscaling: las que pide su pico de diseño de ≈ ${f(design)} req/s, más una de N+1. Cada GPU tiene una capacidad planificada de <b>${f(thr)} img/s</b>${gp[4]}, y el tráfico real promedia <b>${f(A)} req/s</b> (una imagen por request).`,
            parts: [
              {
                ask: 'US$ por 1,000 predicciones con una GPU trabajando a su capacidad planificada', unit: 'US$', answer: atCap, tol: 0.15,
                steps: [
                  'Planteamiento: US$ por 1,000 = US$/h ÷ (predicciones por segundo × 3,600 ÷ 1,000) = US$/h ÷ (pred/s × 3.6).',
                  `${p} ÷ (${f(thr)} × 3.6) = ${p} ÷ ${f(thr * 3.6)} ≈ <b>US$${g(atCap)}</b>`,
                ],
              },
              {
                ask: 'Costo mensual de la flota', unit: 'US$/mes', answer: month, tol: 0.15,
                steps: [
                  'Planteamiento: GPUs × US$/h × 730 h.',
                  `${n} × ${p} × 730 = <b>US$${f(month)}/mes</b>`,
                ],
              },
              {
                ask: 'Predicciones reales al mes (mes de 730 h), en millones', unit: 'M/mes', answer: predM, tol: 0.15,
                steps: [
                  'Planteamiento: predicciones = req/s promedio × segundos del mes (730 h × 3,600 = 2,628,000 s).',
                  `${f(A)} × 2,628,000 ≈ <b>${f(predM)} M/mes</b>`,
                ],
              },
              {
                ask: 'US$ reales por 1,000 predicciones', unit: 'US$', answer: real, tol: 0.15,
                steps: [
                  'Planteamiento: costo del mes ÷ predicciones del mes × 1,000.',
                  `Con los resultados anteriores: US$${f(month)} ÷ ${f(predM)} M × 1,000 ≈ <b>US$${g(real)}</b>`,
                  `≈ ${f(real / atCap, 0)}× el costo a capacidad planificada: la flota pasa ≈ ${f(idle, 0)} % de su capacidad planificada ociosa.`,
                ],
              },
            ],
            hint: 'Costo por 1,000 = US$/h ÷ (pred/s × 3.6). Primero con una GPU llena a su capacidad planificada; después con la factura real: costo mensual de toda la flota ÷ predicciones reales del mes × 1,000.',
            takeaway: `La hoja de precios da el primer número; tu diseño paga el último. Con N+1 y carga baja gana la hora más barata, no la predicción más barata; cuando la carga crece y las GPUs se llenan, el throughput por dólar vuelve a mandar. <i>"At planned capacity ${gp[0] === 'L4' ? 'an' : 'a'} ${gp[0]} costs about $${g(atCap)} per thousand predictions, but with our real load it's about $${g(real)}, because a fleet sized for the peak plus N+1 sits mostly idle."</i>`,
          };
        },
      },
      {
        id: 'co-05', topic: 'costo', level: 3, title: 'Facturado vs ocupado: escalar a cero', ref: 'm13.costos-ocultos',
        gen(r) {
          const it = r.pick([['g6.xlarge (1 L4)', 0.805], ['g4dn.xlarge (1 T4)', 0.526], ['g5.xlarge (1 A10G)', 1.006]]);
          const B = r.pick([3, 4, 6]);
          const W = r.pick([20, 30, 45, 60]);
          const C = r.pick([10, 15, 30]);
          const S = r.pick([5, 10]);
          const p = it[1];
          const busy = (B * W) / 60;
          const billed = (B * (S + W + C)) / 60;
          const idle = (1 - busy / billed) * 100;
          const cm = billed * 30 * p;      // como c04 y M13: horas facturadas por día × 30
          const always = p * 24 * 30;      // la misma ventana de 30 días, para comparar parejo
          return {
            q: `Un servicio batch procesa <b>${B} tandas al día</b>, separadas por horas. Cada tanda ocupa la GPU <b>${W} min</b>. El nodo escala a cero: tarda ≈ <b>${S} min</b> en arrancar (nodo, imagen y modelo; se factura) y se apaga después de <b>${C} min</b> sin trabajo (cooldown). Instancia: <b>${it[0]}</b>, ≈ US$${p}/h (aprox.).`,
            parts: [
              {
                ask: 'Horas al día que la GPU trabaja', unit: 'h/día', answer: busy, tol: 0.15,
                steps: [
                  'Planteamiento: horas ocupadas = tandas × minutos de trabajo ÷ 60.',
                  `${B} × ${W} ÷ 60 = <b>${f(busy)} h/día</b>`,
                ],
              },
              {
                ask: 'Horas al día que se facturan', unit: 'h/día', answer: billed, tol: 0.15,
                steps: [
                  'Planteamiento: cada tanda factura arranque + trabajo + cooldown.',
                  `${B} × (${S} + ${W} + ${C}) ÷ 60 = <b>${f(billed)} h/día</b>`,
                ],
              },
              {
                ask: '¿Qué porcentaje de lo facturado es tiempo ocioso?', unit: '%', answer: idle, tolAbs: 3,
                steps: [
                  'Planteamiento: fracción ociosa = 1 − horas ocupadas ÷ horas facturadas.',
                  `Con los resultados anteriores: 1 − ${f(busy)} ÷ ${f(billed)} = <b>${f(idle, 0)} %</b>`,
                ],
              },
              {
                ask: 'Costo mensual facturado (30 días)', unit: 'US$/mes', answer: cm, tol: 0.15,
                steps: [
                  'Planteamiento: costo = horas facturadas por día × 30 días × US$/h.',
                  `${f(billed)} × 30 × ${p} = <b>US$${f(cm)}/mes</b>`,
                  `Siempre encendida, en los mismos 30 días: ${p} × 24 × 30 ≈ US$${f(always)}/mes. Escalar a cero ahorra ≈ ${f((1 - cm / always) * 100, 0)} %.`,
                ],
              },
            ],
            hint: 'Separa la hora útil de la hora encendida: por tanda pagas el arranque, el trabajo y el cooldown. Después compara, y pasa a mes con 30 días.',
            takeaway: `La nube cobra la hora encendida, no la hora útil. Un cooldown más corto baja lo ocioso, pero si queda por debajo del hueco entre trabajos, el nodo se apaga y vuelve a arrancar entre uno y otro, con minutos de cold start cada vez: por eso c04 acepta ≈ 45 % de horas ociosas con su cooldown de 15 min. <i>"I compare billed hours with busy hours for every GPU: here about ${f(idle, 0)}% of what we pay is startup and cooldown."</i>`,
          };
        },
      },
      {
        id: 'co-06', topic: 'costo', level: 3, title: 'Backfill: GPU-horas, tiempo de pared y spot', ref: 'm13.spot',
        gen(r) {
          const N = r.pick([50, 100, 200, 500]);
          const thr = r.pick([500, 800, 1000]);
          const K = r.pick([2, 4, 8]);
          const rr = r.pick([5, 10]);
          const gh = (N * 1e6) / thr / 3600;
          const wall = gh / K;
          const c3 = gh * 0.526;
          const c4 = gh * (1 + rr / 100) * 0.27;
          return {
            q: `Tienes que reclasificar <b>${f(N)} M imágenes</b> con un job batch. Cada T4 procesa ≈ <b>${f(thr)} img/s</b> con batches llenos (limitado por decode e IO) y lanzas <b>${K} GPUs</b> en paralelo, con el trabajo partido en shards idempotentes. g4dn.xlarge: ≈ <b>US$0.526/h</b> on-demand o ≈ <b>US$0.27/h</b> en spot (observado, aprox.).`,
            parts: [
              {
                ask: 'GPU-horas del job', unit: 'GPU-h', answer: gh, tol: 0.15,
                steps: [
                  'Planteamiento: GPU-horas = imágenes ÷ throughput por GPU ÷ 3,600.',
                  `${f(N)} M ÷ ${f(thr)} ÷ 3,600 ≈ <b>${f(gh)} GPU-h</b>`,
                ],
              },
              {
                ask: `Tiempo de pared con ${K} GPUs`, unit: 'h', answer: wall, tol: 0.15,
                steps: [
                  'Planteamiento: con K GPUs en paralelo, tiempo de pared = GPU-horas ÷ K.',
                  `Con el resultado anterior: ${f(gh)} ÷ ${K} ≈ <b>${f(wall)} h</b>`,
                ],
              },
              {
                ask: 'Costo on-demand', unit: 'US$', answer: c3, tol: 0.15,
                steps: [
                  'Planteamiento: costo = GPU-horas × US$/h. Las GPU-horas no cambian con K: más GPUs terminan antes, no más barato.',
                  `${f(gh)} × 0.526 ≈ <b>US$${f(c3)}</b>`,
                ],
              },
              {
                ask: `En spot, las interrupciones obligan a repetir ≈ <b>${rr} %</b> del trabajo (shards que se reintentan). ¿Costo en spot?`, unit: 'US$', answer: c4, tol: 0.15,
                steps: [
                  'Planteamiento: costo spot = GPU-horas × (1 + trabajo repetido) × precio spot.',
                  `${f(gh)} × ${f(1 + rr / 100, 2)} × 0.27 ≈ <b>US$${f(c4)}</b>`,
                  `Ahorro ≈ ${f((1 - c4 / c3) * 100, 0)} % frente a on-demand: real, pero lejos del "hasta 90 %" de la publicidad.`,
                ],
              },
            ],
            hint: 'GPU-horas = imágenes ÷ throughput ÷ 3,600 (no dependen de cuántas GPUs uses); el tiempo de pared sí: divide entre las GPUs. El costo sale de las GPU-horas; en spot, súmale el trabajo que se repite.',
            takeaway: `Más GPUs acortan el tiempo de pared sin cambiar el costo; spot rinde donde hay muchas horas interrumpibles con checkpoints o shards idempotentes, nunca en el mínimo online. Y en CV el cuello de botella de un backfill suele ser IO + decode, no la GPU. <i>"The backfill is about ${f(gh)} GPU-hours: with ${K} GPUs it finishes in about ${f(wall)} hours, and on spot it costs about $${f(c4)}."</i>`,
          };
        },
      },
      // ======================================================== ALMACENAMIENTO Y RED
      {
        id: 'da-01', topic: 'datos', level: 1, title: 'Logs de predicción por día', ref: 'm12.logging-predicciones',
        gen(r) {
          const m = r.pick([5, 10, 20, 50, 100]);
          const b = r.pick([200, 300, 500, 1000, 2000]);
          const gb = (m * 1e6 * b) / 1e9;
          return {
            q: `Cada predicción escribe una fila de log de ≈ <b>${f(b)} B</b> (JSON con ids, versión, top-k, latencias) y haces <b>${f(m)} M predicciones al día</b>.`,
            parts: [{
              ask: '¿Cuántos GB de logs crudos se escriben por día?', unit: 'GB/día', answer: gb, tol: 0.15,
              steps: [
                'Planteamiento: almacenamiento por día = eventos por día × bytes por evento (1 M × 1 KB = 1 GB).',
                `${f(m)} M × ${f(b)} B = <b>${f(gb)} GB/día</b>`,
                `Al año (× 365): ≈ ${f((gb * 365) / 1000, 2)} TB, menos en Parquet comprimido.`,
              ],
            }],
            hint: 'Multiplica eventos por bytes y pasa a GB con potencias de diez: 10<sup>6</sup> eventos × 10<sup>3</sup> B = 10<sup>9</sup> B = 1 GB.',
            takeaway: 'Las filas de predicción son casi gratis: se loguea el 100 %. En S3 (≈ US$0.023/GB-mes) eso cuesta poco; en CloudWatch Logs (US$0.50/GB al ingerir) ya no, por eso van a S3. Lo caro es guardar los inputs (imágenes) y su privacidad. <i>"Prediction rows are cheap enough to keep at a hundred percent; raw images are not."</i>',
          };
        },
      },
      {
        id: 'da-02', topic: 'datos', level: 2, title: 'Ancho de banda: bits contra bytes', ref: 'c01.estimaciones',
        gen(r) {
          const rate = r.pick([200, 500, 1000, 2000]);
          // [qué viaja, KB por request, cómo se manda menos]
          const pl = r.pick([
            ['un tensor 224×224×3 en FP32', 602, 'Menos bytes: el mismo tensor en UINT8 pesa ÷ 4 (≈ 150 KB), y el JPEG de celular, ≈ 200 KB.'],
            ['un tensor 224×224×3 en FP16', 301, 'Menos bytes: el tensor en UINT8 pesa la mitad (≈ 150 KB).'],
            ['un tensor 224×224×3 en UINT8', 150, 'Ya es el tensor más chico (el JPEG de celular pesa parecido): si no alcanza, se reparte la carga en más nodos.'],
            ['un JPEG de celular', 200, 'Ya viaja comprimido: si no alcanza, se reparte la carga en más nodos.'],
            ['un original web de 12 MP', 3000, 'Menos bytes: reducir en el cliente o limitar el tamaño (≤ 1024 px: ≈ 200 KB, ≈ 15× menos).'],
          ]);
          const mbs = (rate * pl[1]) / 1000;
          const gbps = (mbs * 8) / 1000;
          // Solo instancias con la respuesta clara: o sobra ≥ 20 % del baseline o se pasa por ≥ 20 %
          // (al 96 % del baseline, "¿lo aguanta?" sería discutible).
          const inst = r.pick([['c6i.xlarge', 1.56], ['g6.xlarge', 2.5], ['g4dn.xlarge', 5]].filter((x) => gbps <= 0.8 * x[1] || gbps >= 1.2 * x[1]));
          const fits = gbps <= inst[1];
          return {
            q: `Cada request manda <b>${pl[0]} (≈ ${f(pl[1])} KB)</b> del gateway al model server, y en el pico de diseño llegan <b>${f(rate)} req/s</b>.`,
            parts: [
              {
                ask: 'Throughput en MB/s', unit: 'MB/s', answer: mbs, tol: 0.15,
                steps: [
                  'Planteamiento: bytes por segundo = tasa × bytes por request (potencias de diez: 1,000 KB = 1 MB).',
                  `${f(rate)} × ${f(pl[1])} KB = <b>${f(mbs)} MB/s</b>`,
                ],
              },
              {
                ask: 'Lo mismo en Gb/s (lo que miden las tarjetas de red)', unit: 'Gb/s', answer: gbps, tol: 0.15,
                steps: [
                  'Planteamiento: × 8 bits por byte; ÷ 1,000 para pasar de Mb/s a Gb/s.',
                  `Con el resultado anterior: ${f(mbs)} MB/s × 8 = ${f(mbs * 8)} Mb/s = <b>${f(gbps)} Gb/s</b>`,
                ],
              },
              {
                ask: `¿Lo aguanta sostenido la red de un solo <b>${inst[0]}</b> (baseline ≈ ${inst[1]} Gb/s)?`,
                choices: ['Sí, con margen', 'No: hay que repartir la carga en más nodos o mandar menos bytes por request'],
                answer: fits ? 0 : 1,
                steps: [
                  `${f(gbps)} Gb/s ${fits ? 'cabe en' : 'supera'} los ${inst[1]} Gb/s de baseline de la ${inst[0]} (${f((gbps / inst[1]) * 100, 0)} % del baseline).`,
                  `Las cifras "hasta 10 / 12.5 / 25 Gb/s" son de ráfaga: se dimensiona con el baseline. ${pl[2]}`,
                ],
              },
            ],
            hint: 'Tasa × bytes por request da bytes por segundo; para compararlo con la red pásalo a bits (× 8) y a Gb/s. Compara con el baseline sostenido, no con la ráfaga.',
            takeaway: `Bits contra bytes es un error de 8×. Con payloads grandes la tarjeta de red se satura antes que la GPU: en c01, a 1,200 img/s el tensor FP32 pediría ≈ 5.8 Gb/s, más que el baseline de la g4dn.xlarge. Para la red, las palancas son menos bytes por request (UINT8, el JPEG en vez del tensor, imágenes más chicas) o más nodos; el ruteo por zona baja el costo de esos bytes, no el ancho de banda. <i>"Each request carries about ${f(pl[1])} KB, so at ${f(rate)} requests per second that's about ${s2(gbps)} gigabits per second."</i>`,
          };
        },
      },
      {
        id: 'da-03', topic: 'datos', level: 2, title: 'Índice de embeddings', ref: 'ref-numeros.bytes-tamanos',
        gen(r) {
          const N = r.pick([10, 50, 100, 200, 500]);
          const d = r.pick([128, 256, 512, 768, 1024, 1536]);
          const gb32 = (N * 1e6 * d * 4) / 1e9;
          const gb8 = gb32 / 4;
          const size = (gb) => (gb >= 1000 ? s2(gb / 1000) + ' TB' : say(gb) + ' GB');   // en voz alta
          return {
            q: `Tienes <b>${f(N)} M de embeddings</b> de <b>${f(d)} dimensiones</b> para búsqueda por similitud.`,
            parts: [
              {
                ask: 'Tamaño de los vectores en FP32 (sin el índice ANN)', unit: 'GB', answer: gb32, tol: 0.15,
                steps: [
                  'Planteamiento: tamaño = vectores × dimensiones × bytes por valor.',
                  `Un vector: ${f(d)} × 4 B = ${f((d * 4) / 1000, 3)} KB → ${f(N)} × 10<sup>6</sup> × ${f(d)} × 4 B = <b>${f(gb32)} GB</b>`,
                ],
              },
              {
                ask: 'Los mismos vectores en INT8', unit: 'GB', answer: gb8, tol: 0.15,
                steps: [
                  'Planteamiento: INT8 usa 1 byte por valor: ÷ 4 respecto de FP32.',
                  `Con el resultado anterior: ${f(gb32)} ÷ 4 = <b>${f(gb8)} GB</b>`,
                ],
              },
            ],
            hint: 'Bytes = número de vectores × dimensiones × bytes del dtype (FP32 4, FP16 2, INT8 1). Pasa a GB con 10<sup>9</sup>.',
            takeaway: `Ese número decide si el índice cabe en la RAM de un nodo o hay que partirlo en shards, y cuántas copias pagas. Súmale el grafo del índice ANN: en c08, HNSW con M = 32 agrega ≈ 256 B por vector. <i>"${f(N)} million ${d}-dimensional vectors are about ${size(gb32)} in FP32 and ${size(gb8)} in INT8, before the index."</i>`,
          };
        },
      },
      {
        id: 'da-04', topic: 'datos', level: 3, title: 'Video con retención', ref: 'ref-numeros.bytes-tamanos',
        gen(r) {
          const cams = r.pick([10, 20, 40, 80, 100]);
          const br = r.pick([2, 4, 6]);
          const R = r.pick([7, 14, 30, 90]);
          const gbCam = (br * DAY) / 8 / 1000;
          const tbDay = (gbCam * cams) / 1000;
          const tbStore = tbDay * R;
          const cost = tbStore * 1000 * 0.023;
          return {
            q: `Un sitio guarda el video de <b>${cams} cámaras</b> 1080p en H.264 a ≈ <b>${br} Mb/s</b> cada una, con retención de <b>${R} días</b> en S3 Standard (≈ US$0.023/GB-mes, aprox.).`,
            parts: [
              {
                ask: 'GB por día de una cámara', unit: 'GB/día', answer: gbCam, tol: 0.15,
                steps: [
                  'Planteamiento: bytes por día = bits por segundo × 86,400 s ÷ 8.',
                  `${br} Mb/s × 86,400 s ÷ 8 = ${f((br * DAY) / 8)} MB ≈ <b>${f(gbCam)} GB/día</b>`,
                ],
              },
              {
                ask: 'TB por día de todo el sitio', unit: 'TB/día', answer: tbDay, tol: 0.15,
                steps: [
                  'Planteamiento: × cámaras; 1 TB = 1,000 GB.',
                  `Con el resultado anterior: ${f(gbCam)} × ${cams} = ${f(gbCam * cams)} GB ≈ <b>${f(tbDay)} TB/día</b>`,
                ],
              },
              {
                ask: 'TB guardados en régimen con esa retención', unit: 'TB', answer: tbStore, tol: 0.15,
                steps: [
                  'Planteamiento: con retención de R días, en régimen guardas R días de video (lo más viejo se borra con una regla de lifecycle).',
                  `Con el resultado anterior: ${f(tbDay)} × ${R} = <b>${f(tbStore)} TB</b>`,
                ],
              },
              {
                ask: 'Costo mensual del almacenamiento', unit: 'US$/mes', answer: cost, tol: 0.15,
                steps: [
                  'Planteamiento: costo = GB guardados × US$/GB-mes.',
                  `Con el resultado anterior: ${f(tbStore)} TB = ${f(tbStore * 1000)} GB × 0.023 ≈ <b>US$${f(cost)}/mes</b>`,
                  'Sin la regla de lifecycle el bucket no llega a régimen: crece cada mes, y la factura también.',
                ],
              },
            ],
            hint: 'Bits a bytes (÷ 8) y segundos a día (× 86,400) por cámara; multiplica por las cámaras; la retención fija cuántos días guardas a la vez; el costo es por GB-mes.',
            takeaway: `El video viaja comprimido y casi siempre se decide qué guardar: solo eventos, menos resolución o menos días. En c02, mandar solo los eventos en vez de los streams reduce el volumen ≈ 760×. <i>"Each camera is about ${f(gbCam)} GB a day, so with ${R} days of retention we keep about ${f(tbStore)} TB."</i>`,
          };
        },
      },
      {
        id: 'da-05', topic: 'datos', level: 3, title: 'Transferencia entre zonas', ref: 'm13.costos-ocultos',
        gen(r) {
          const rate = r.pick([100, 200, 500, 1000]);
          const pl = r.pick([['un tensor FP32 de 602 KB', 602], ['un JPEG de 200 KB', 200], ['un tensor UINT8 de 150 KB', 150]]);
          const z = r.pick([2, 3]);
          const tb = (rate * pl[1] * 1e3 * 3600 * MES_H) / 1e12;
          const tbx = (tb * (z - 1)) / z;
          const cost = tbx * 1000 * 0.02;
          const ok = 'Ruteo por zona: cada gateway llama al model server de su propia zona';
          const choices = r.shuffle([ok, 'Más réplicas del model server', 'Comprimir los logs de predicción']);
          return {
            q: `El gateway manda <b>${pl[0]}</b> por request al model server, con <b>${f(rate)} req/s</b> en promedio. Los pods están repartidos en <b>${z} zonas</b> y el Service balancea al azar entre ellas (sin ruteo por zona). Cruzar de AZ cuesta US$0.01/GB en cada sentido (aprox.).`,
            parts: [
              {
                ask: 'TB al mes del gateway al model server (mes de 730 h)', unit: 'TB/mes', answer: tb, tol: 0.15,
                steps: [
                  'Planteamiento: bytes al mes = tasa × bytes por request × segundos del mes (730 h × 3,600 = 2,628,000 s).',
                  `${f(rate)} × ${f(pl[1])} KB × 2,628,000 s ≈ <b>${f(tb)} TB/mes</b>`,
                ],
              },
              {
                ask: '¿Cuántos TB cruzan de zona?', unit: 'TB/mes', answer: tbx, tol: 0.15,
                steps: [
                  'Planteamiento: con balanceo al azar entre z zonas, la fracción que cae en otra zona es (z − 1) ÷ z.',
                  `Con el resultado anterior: ${f(tb)} × ${z - 1}/${z} ≈ <b>${f(tbx)} TB/mes</b>`,
                ],
              },
              {
                ask: 'Costo mensual de ese cruce', unit: 'US$/mes', answer: cost, tol: 0.15,
                steps: [
                  'Planteamiento: se cobra al salir y al entrar: US$0.02 por cada GB que cruza.',
                  `Con el resultado anterior: ${f(tbx)} TB = ${f(tbx * 1000)} GB × 0.02 ≈ <b>US$${f(cost)}/mes</b>`,
                ],
              },
              {
                ask: '¿Qué elimina ese costo casi por completo?', choices, answer: choices.indexOf(ok),
                steps: [
                  'Con ruteo por zona (en Kubernetes, trafficDistribution: PreferSameZone) cada salto se queda en su zona. Más réplicas no cambian adónde van los bytes, y los logs son otra flecha.',
                ],
              },
            ],
            hint: 'Recorre los bytes: tasa × bytes × segundos del mes; qué fracción cruza de zona con balanceo al azar; y cuánto cobra la nube por GB que cruza (los dos lados).',
            takeaway: `Un centavo por GB se vuelve grande cuando multiplica algo que pasa millones de veces al día: en c01 el cruce de AZ sin ruteo por zona (≈ US$1,800/mes) costaría más que las dos GPUs. Ruteo por zona desde el día 1, y menos bytes (UINT8) al crecer. <i>"Cross-AZ traffic costs a cent per gigabyte each way, and every request sends about ${f(pl[1])} KB, so zone-aware routing isn't optional here."</i>`,
          };
        },
      },
      // ======================================================== ESCENARIOS COMPLETOS
      {
        id: 'es-01', topic: 'escenario', level: 2, title: 'Video en tiempo real: de cámaras a costo', ref: 'm03.cuantas-gpus',
        gen(r) {
          const cams = r.pick([20, 40, 60, 80]);
          const fps = r.pick([5, 10, 15]);
          const cap = r.pick([250, 400]);
          const load = cams * fps;
          const plan = cap * 0.7;
          const n = ceilx(load / plan);
          const gpus = n + 1;
          const cost = gpus * 0.805 * MES_H;
          return {
            q: `Un almacén analiza en tiempo real <b>${cams} cámaras a ${fps} fps</b> con un detector a 640 px. Supón que una L4 sostiene ≈ <b>${cap} frames/s</b> al SLO con ese detector (supuesto: es lo primero que mides, con trtexec o perf_analyzer). El tráfico es plano y predecible, así que planeas al <b>70 %</b>, con <b>N+1</b>. g6.xlarge (1 L4): ≈ US$0.805/h (aprox.).`,
            parts: [
              {
                ask: 'Carga en frames por segundo', unit: 'frames/s', answer: load, tol: 0.05,
                steps: [
                  'Planteamiento: carga = cámaras × fps, las 24 horas (las cámaras no duermen).',
                  `${cams} × ${fps} = <b>${f(load)} frames/s</b>`,
                ],
              },
              {
                ask: 'L4 en total (throughput + N+1)', unit: 'GPUs', answer: gpus, tol: 0,
                steps: [
                  'Planteamiento: GPUs = ⌈carga ÷ (capacidad medida × 0.7)⌉ + 1.',
                  `Con el resultado anterior: ⌈${f(load)} ÷ (${cap} × 0.7)⌉ = ⌈${f(load)} ÷ ${f(plan)}⌉ = ⌈${f(load / plan, 2)}⌉ = ${n}; + 1 = <b>${gpus} L4</b>`,
                  `Reparto normal: ${f(load / gpus)} frames/s por GPU (${f((load / gpus / cap) * 100, 0)} % del máximo); si cae una, ${f(load / n)} (${f((load / n / cap) * 100, 0)} %).`,
                ],
              },
              {
                ask: 'Costo mensual de las GPUs', unit: 'US$/mes', answer: cost, tol: 0.15,
                steps: [
                  'Planteamiento: costo = GPUs × US$/h × 730 h.',
                  `Con el resultado anterior: ${gpus} × 0.805 × 730 ≈ <b>US$${f(cost)}/mes</b>`,
                ],
              },
            ],
            hint: 'Carga = cámaras × fps; GPUs con la fórmula de M3 (capacidad medida × utilización objetivo, redondeo hacia arriba, + N+1); costo con 730 h.',
            takeaway: `Con tráfico plano puedes planear más alto (70 % en vez de 50 %), y cada cámara se asigna a una GPU porque el tracking necesita estado: se balancea por stream, no por request. Bajar los fps del análisis (el sub-stream a 5 fps de c02) es la palanca más grande. <i>"${cams} cameras at ${fps} fps is ${f(load)} frames per second; at 70% of the measured capacity that's ${n === 1 ? 'one L4' : n + ' L4s'}, plus one for N+1."</i>`,
          };
        },
      },
      {
        id: 'es-02', topic: 'escenario', level: 3, title: 'Marketplace de fotos: de usuarios a costo por 1,000', ref: 'c01.estimaciones',
        gen(r) {
          const dau = r.pick([2, 3, 5, 8]);
          const ph = r.pick([1, 2, 3, 4]);
          const mg = r.pick([1.3, 1.4, 1.5]);
          const vol = dau * ph;
          const avg = (vol * 1e6) / DAY;
          const design = avg * 3 * mg;
          const n = ceilx(design / 600);
          const gpus = n + 1;
          const cost = gpus * 0.526 * MES_H;
          const per1k = (cost / (vol * 1e6 * 30.4)) * 1000;
          const atCap = 0.526 / (600 * 3.6);
          return {
            q: `Un marketplace sugiere la categoría de cada foto que suben los vendedores. Tiene <b>${f(dau)} M de usuarios activos al día</b> y cada uno sube en promedio <b>${ph} foto${ph === 1 ? '' : 's'}</b> al día. Supón un pico diurno de <b>3×</b> y un margen de diseño de <b>${mg}×</b>. Una T4 (g4dn.xlarge, ≈ US$0.526/h, aprox.) sostiene ≈ <b>1,200 img/s</b> al SLO y planeas al <b>50 %</b>, con N+1.`,
            parts: [
              {
                ask: 'Pico de diseño', unit: 'req/s', answer: design, tol: 0.15,
                steps: [
                  'Planteamiento: volumen = usuarios × fotos; promedio = volumen ÷ 86,400; diseño = promedio × 3 × margen.',
                  `${f(dau)} M × ${ph} = ${f(vol)} M/día → ${f(avg)} req/s promedio → × 3 × ${mg} ≈ <b>${f(design)} req/s</b>`,
                ],
              },
              {
                ask: 'T4 en total (throughput + N+1)', unit: 'GPUs', answer: gpus, tol: 0,
                steps: [
                  'Planteamiento: ⌈pico de diseño ÷ (1,200 × 0.5)⌉ + 1.',
                  `Con el resultado anterior: ⌈${f(design)} ÷ 600⌉ = ⌈${f(design / 600, 2)}⌉ = ${n}; + 1 = <b>${gpus} T4</b>`,
                  n === 1 ? 'Una GPU alcanza por throughput: la segunda es por disponibilidad.' : 'Con varias GPUs por throughput, revisa si una L4 (más throughput por dólar) gana con el load test.',
                ],
              },
              {
                ask: 'Costo mensual de las GPUs', unit: 'US$/mes', answer: cost, tol: 0.15,
                steps: [
                  'Planteamiento: GPUs × US$/h × 730 h.',
                  `Con el resultado anterior: ${gpus} × 0.526 × 730 ≈ <b>US$${f(cost)}/mes</b>`,
                ],
              },
              {
                ask: 'Costo de GPU por 1,000 predicciones con el volumen real', unit: 'US$', answer: per1k, tol: 0.15,
                steps: [
                  'Planteamiento: costo del mes ÷ predicciones del mes × 1,000 (predicciones al mes = diarias × 30.4).',
                  `Con los resultados anteriores: US$${f(cost)} ÷ (${f(vol)} M × 30.4) × 1,000 ≈ <b>US$${g(per1k)}</b>`,
                  `A capacidad planificada sería 0.526 ÷ (600 × 3.6) ≈ US$${g(atCap)}: con la carga real pagas ≈ ${f(per1k / atCap, 0)}× más, porque la flota se dimensiona para el pico de diseño más N+1 y el promedio (≈ ${f(avg)} req/s) usa ≈ ${f((avg / (gpus * 600)) * 100, 0)} % de su capacidad planificada.`,
                ],
              },
            ],
            hint: 'Encadena: usuarios × fotos → req/s promedio → pico de diseño; GPUs con la fórmula de M3; costo con 730 h; y por 1,000 = costo mensual ÷ predicciones reales del mes × 1,000.',
            takeaway: `Es la cadena completa del paso 3 del framework, y cada número decide algo: cuántas GPUs, si conviene otra GPU, si el costo cabe en el presupuesto. Con carga baja, el número de GPUs lo fija la disponibilidad y el costo por predicción lo domina la utilización real. <i>"${f(vol)} million photos a day is about ${say(avg)} requests per second; I design for about ${say(design)}, which needs ${n === 1 ? 'one T4' : n + ' T4s'} plus one for N+1, roughly $${say(cost)} a month."</i>`,
          };
        },
      },
      {
        id: 'es-03', topic: 'escenario', level: 3, title: 'Chat con LLM: memoria contra goodput', ref: 'm14.kv-cache',
        gen(r) {
          const P = r.pick([30, 45, 60, 90]);
          const E = r.pick([8, 10.5, 12]);
          const T = r.pick([1500, 2250, 3000, 4000]);
          const G = r.pick([5, 6, 8]);
          const inflight = P * E;
          const perSeq = (T * 327680) / 1e9;
          const seqs = floorx(68.4 / perSeq);
          const rMem = ceilx(inflight / seqs);
          const rGood = ceilx(P / (G * 0.7));
          return {
            q: `Un chat de soporte sirve <b>Llama 3 70B en FP8</b>. Cada réplica son <b>2 × H100</b> con tensor parallelism y le quedan ≈ <b>68.4 GB</b> para KV cache (en BF16, <b>320 KiB por token</b>). En el pico llegan <b>${P} req/s</b>; cada conversación ocupa ≈ <b>${f(T)} tokens</b> (prompt + respuesta) y tarda ≈ <b>${E} s</b> de punta a punta. El barrido con vllm bench serve da un goodput de ≈ <b>${G} req/s por réplica</b> cumpliendo TTFT y TPOT, y planeas al <b>70 %</b>.`,
            parts: [
              {
                ask: 'Secuencias en vuelo en el pico (todo el servicio)', unit: 'secuencias', answer: inflight, tol: 0.15,
                steps: [
                  'Planteamiento: Little con secuencias: en vuelo = req/s × latencia end-to-end.',
                  `${P} × ${E} s = <b>${f(inflight)} secuencias</b>`,
                ],
              },
              {
                ask: 'Conversaciones de ese largo que caben en el KV de una réplica (redondea hacia abajo)', unit: 'secuencias', answer: seqs, tol: 0,
                steps: [
                  'Planteamiento: KV por secuencia = tokens × 320 KiB; secuencias = ⌊KV libre ÷ KV por secuencia⌋.',
                  `${f(T)} × 327,680 B ≈ ${f(perSeq, 3)} GB → ⌊68.4 ÷ ${f(perSeq, 3)}⌋ = ⌊${f(68.4 / perSeq, 2)}⌋ = <b>${seqs}</b>`,
                  T === 2250
                    ? 'c10 dice "≈ 93" porque redondea al más cercano para hablar; para contar cuántas caben, hacia abajo: media conversación no entra.'
                    : 'Hacia abajo: media conversación no entra en el KV.',
                ],
              },
              {
                ask: 'Réplicas que pide la memoria', unit: 'réplicas', answer: rMem, tol: 0,
                steps: [
                  'Planteamiento: réplicas = ⌈secuencias en vuelo ÷ secuencias por réplica⌉.',
                  `Con los resultados anteriores: ⌈${f(inflight)} ÷ ${seqs}⌉ = ⌈${f(inflight / seqs, 2)}⌉ = <b>${rMem} réplicas</b>`,
                ],
              },
              {
                ask: 'Réplicas que pide el goodput', unit: 'réplicas', answer: rGood, tol: 0,
                steps: [
                  'Planteamiento: réplicas = ⌈pico ÷ (goodput × 0.7)⌉.',
                  `⌈${P} ÷ (${G} × 0.7)⌉ = ⌈${P} ÷ ${f(G * 0.7, 1)}⌉ = ⌈${f(P / (G * 0.7), 2)}⌉ = <b>${rGood} réplicas</b>`,
                  rGood > rMem
                    ? `Manda el goodput (${rGood} contra ${rMem}): la memoria no es el límite; lo es el primer SLO que se rompe, y en sobrecarga se ve primero en el TTFT.`
                    : rGood === rMem
                      ? `Empatan (${rGood} y ${rMem}): las dos cotas piden la misma flota, así que vigilas las dos, el uso del KV cache y el TTFT p95.`
                      : `Manda la memoria (${rMem} contra ${rGood}): el KV se llena antes de que se rompa un SLO; KV en FP8 o conversaciones más cortas bajan la cuenta.`,
                ],
              },
            ],
            hint: 'Little para las secuencias en vuelo; KV por secuencia y cuántas caben por réplica (hacia abajo); réplicas por memoria (hacia arriba); réplicas por goodput con el 70 %. La flota es el mayor de los dos números.',
            takeaway: `La memoria da una cota y el goodput medido da otra: la flota es la mayor (y en c10 se redondea a múltiplos de 4, porque una p5.48xlarge trae 8 H100 = 4 réplicas). <i>"Little's law says about ${say(inflight)} sequences in flight; memory fits ${seqs} per replica, so ${rMem} replicas${rGood > rMem ? ', but goodput asks for ' + rGood + ', so the fleet is ' + rGood + ' replicas' : rGood === rMem ? ', and goodput asks for the same, so the fleet is ' + rMem + ' replicas' : '; goodput only asks for ' + rGood + ', so memory sets the fleet at ' + rMem + ' replicas'}."</i>`,
          };
        },
      },
      {
        id: 'es-04', topic: 'escenario', level: 3, title: 'Ranking con fan-out', ref: 'c08.estimaciones',
        gen(r) {
          // [M de usuarios activos, aperturas por día]: pares elegidos para que ningún cociente de GPUs
          // quede pegado a un entero (con 500, 1,000 o 300 candidatos), así redondear no cambia la respuesta.
          const du = r.pick([[10, 2], [10, 4], [15, 3], [20, 2], [20, 4], [25, 3], [40, 4], [50, 5]]);
          const dau = du[0];
          const loads = du[1];
          const cand = r.pick([500, 1000]);
          const peak = ((dau * loads * 1e6) / DAY) * 3;
          const scores = peak * cand;
          const n = ceilx(scores / 1.05e6);
          const n2 = ceilx((peak * 300) / 1.05e6);
          return {
            q: `El feed de una app: <b>${f(dau)} M de usuarios activos al día</b> abren el home <b>${loads} veces</b> al día (cada apertura es un request), con un pico de <b>3×</b>. Cada request puntúa <b>${f(cand)} candidatos</b> con un ranker en GPU. Una L4 sostiene ≈ <b>1.5 M item-scores/s</b> (supuesto de c08: es lo primero que mides) y planeas al <b>70 %</b>, con N+1.`,
            parts: [
              {
                ask: 'Pico de requests de home', unit: 'req/s', answer: peak, tol: 0.15,
                steps: [
                  'Planteamiento: volumen = usuarios × aperturas; pico = volumen ÷ 86,400 × 3.',
                  `${f(dau)} M × ${loads} = ${f(dau * loads)} M/día → ÷ 86,400 × 3 ≈ <b>${f(peak)} req/s</b>`,
                ],
              },
              {
                ask: 'Item-scores por segundo en el pico, en millones', unit: 'M/s', answer: scores / 1e6, tol: 0.15,
                steps: [
                  'Planteamiento: el fan-out multiplica: cada request puntúa todos sus candidatos.',
                  `Con el resultado anterior: ${f(peak)} × ${f(cand)} ≈ <b>${f(scores / 1e6, 2)} M/s</b>`,
                ],
              },
              {
                ask: 'L4 en total (throughput + N+1)', unit: 'GPUs', answer: n + 1, tol: 0,
                steps: [
                  'Planteamiento: ⌈item-scores/s ÷ (1.5 M × 0.7)⌉ + 1.',
                  `Con el resultado anterior: ⌈${f(scores / 1e6, 2)} ÷ 1.05⌉ = ⌈${f(scores / 1.05e6, 2)}⌉ = ${n}; + 1 = <b>${n + 1} L4</b>`,
                ],
              },
              {
                ask: 'Con un pre-ranker barato que deja solo <b>300</b> candidatos, ¿cuántas L4 (con N+1)?', unit: 'GPUs', answer: n2 + 1, tol: 0,
                steps: [
                  'Planteamiento: el mismo cálculo con 300 candidatos por request.',
                  `${f(peak)} × 300 = ${f((peak * 300) / 1e6, 2)} M/s → ⌈${f((peak * 300) / 1.05e6, 2)}⌉ = ${n2}; + 1 = <b>${n2 + 1} L4</b>`,
                  n2 < n
                    ? 'El pre-ranker cuesta poco (un producto punto o un modelo chico en CPU): el embudo existe por esta cuenta.'
                    : `Aquí la flota no cambia: con ${n === 1 ? 'una GPU' : n + ' GPUs'} por throughput, el redondeo y el N+1 mandan. El pre-ranker igual le quita al ranker el ${f((1 - 300 / cand) * 100, 0)} % de los scores y de las lecturas al feature store, y ahorra GPUs cuando crecen el tráfico o los candidatos.`,
                ],
              },
            ],
            hint: 'Pico de requests como siempre; después multiplica por los candidatos (el fan-out); GPUs con la fórmula de M3 sobre item-scores por segundo; repite con 300 candidatos.',
            takeaway: `El fan-out multiplica la carga: el ranker no ve los ≈ ${say(peak)} req/s del usuario sino ≈ ${s2(scores / 1e6)} M de scores por segundo, y el feature store, una lectura por candidato. Por eso existe el embudo (retrieval → pre-ranker → ranker). <i>"Each home request scores ${f(cand)} candidates, so the ranker sees about ${s2(scores / 1e6)} million item scores per second; ${n2 < n ? 'a cheap pre-ranker cuts the GPU fleet from ' + (n + 1) + ' to ' + (n2 + 1) : 'at this load the fleet stays at ' + (n + 1) + ' GPUs, but a cheap pre-ranker still cuts the scoring work'}."</i>`,
          };
        },
      },
      {
        id: 'es-05', topic: 'escenario', level: 3, title: 'Pipeline asíncrono: workers y backlog', ref: 'm02.asincrona-colas',
        gen(r) {
          const lam = r.pick([5, 10, 20, 50]);
          const W = r.pick([1, 2, 4]);
          const D = r.pick([10, 20, 30]);
          const busy = lam * W;
          const nw = ceilx(busy / 0.7);
          const backlog = lam * D * 60;
          const cap = nw / W;
          const sec = backlog / (cap - lam);
          const min = sec / 60;
          return {
            q: `Un pipeline de documentos recibe <b>${lam} jobs/s</b> en una cola; cada worker procesa un job a la vez y tarda ≈ <b>${W} s</b> por job. Planeas los workers al <b>70 %</b>, sin autoscaling. Un día los workers se caen <b>${D} min</b> y la cola sigue recibiendo.`,
            parts: [
              {
                ask: 'Workers ocupados en promedio', unit: 'workers', answer: busy, tol: 0.15,
                steps: [
                  'Planteamiento: Little con workers: ocupados = llegadas × tiempo por job.',
                  `${lam} × ${W} s = <b>${f(busy)} workers</b>`,
                ],
              },
              {
                ask: 'Workers a provisionar', unit: 'workers', answer: nw, tol: 0,
                steps: [
                  'Planteamiento: workers = ⌈ocupados ÷ 0.7⌉.',
                  `Con el resultado anterior: ⌈${f(busy)} ÷ 0.7⌉ = ⌈${f(busy / 0.7, 2)}⌉ = <b>${nw} workers</b>`,
                ],
              },
              {
                ask: 'Jobs acumulados en la cola al volver', unit: 'jobs', answer: backlog, tol: 0.15,
                steps: [
                  'Planteamiento: backlog = llegadas × duración de la caída.',
                  `${lam} × ${D} × 60 s = <b>${f(backlog)} jobs</b>`,
                ],
              },
              {
                ask: 'Minutos para vaciar la cola con los workers provisionados', unit: 'min', answer: min, tol: 0.15,
                steps: [
                  'Planteamiento: tiempo de vaciado = backlog ÷ (capacidad − llegadas), con capacidad = workers ÷ tiempo por job. Mientras se vacía, siguen llegando jobs.',
                  `Capacidad: ${nw} ÷ ${W} = ${f(cap)} jobs/s → ${f(backlog)} ÷ (${f(cap)} − ${lam}) = ${f(sec)} s ≈ <b>${f(min)} min</b>`,
                  `Con el doble de capacidad que la llegada se vaciaría en ${D} min: el headroom también es velocidad de recuperación.`,
                ],
              },
            ],
            hint: 'Little para los workers ocupados; divide por la utilización objetivo y redondea hacia arriba; el backlog crece a la tasa de llegada mientras no hay workers; y se vacía a la diferencia entre capacidad y llegada, no a la capacidad.',
            takeaway: 'El tiempo de recuperación depende de la diferencia entre capacidad y llegada, no de la capacidad: con poco headroom, una caída corta te deja atrasado mucho más tiempo que lo que duró. Por eso en async se escala por largo de cola y se alerta por la edad del mensaje más viejo. <i>"Recovery time is the backlog divided by spare capacity, not by capacity, so headroom is also recovery speed."</i>',
          };
        },
      },
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
