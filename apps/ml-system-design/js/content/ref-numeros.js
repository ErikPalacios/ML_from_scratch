/* =============================================================================
   Ronda de Diseño ML — js/content/ref-numeros.js
   Parte 4 · Hoja de referencia "Números que debes saber": tiempo y nueves,
   latencias, bytes y tamaños, GPUs, throughput (qué medir y con qué), costos de
   nube, fórmulas de bolsillo y cómo decir los números en la entrevista.
   CONDENSA números ya establecidos: M1–M8 y c01 (la tabla verificada de GPUs de
   m04-hardware.js es la fuente de specs y precios). Si un número cambia allá, se
   cambia aquí. Lo nuevo de esta hoja está verificado (sept. 2026) contra
   documentación de AWS (S3: rendimiento y precios; VPC/NAT; EBS gp3; red de EC2),
   la guía de tokens de OpenAI, el blog de Confluent sobre particiones, la CLI de
   vLLM (vllm bench serve) y AIPerf de NVIDIA; o es aritmética (recalculada con un
   script) o física (≈ 200 km por ms en fibra). Lo medido en una laptop se dice.
   Contrato: docs/SPEC.md §5 y §7.4. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'ref-numeros',
    kind: 'special',
    sections: [
      // ======================================================== 1
      {
        id: 'tiempo-disponibilidad',
        title: 'Tiempo, tráfico y disponibilidad',
        titleEn: 'Time, traffic and availability',
        priority: 'core',
        dims: ['estimaciones', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Tres conversiones que haces en cada entrevista. Todo es aritmética exacta salvo lo marcado como estimación. El porqué de cada paso está en <a href="#m01.estimaciones-express">M1</a> y <a href="#m03.trafico">M3</a>.` },
          { t: 'kv', items: [
            ['1 día', '86,400 s', 'Redondear a 10<sup>5</sup> sirve para calcular de cabeza, pero subestima el QPS ≈ 14 %: corrige el número final'],
            ['1 semana', '604,800 s ≈ 6 × 10<sup>5</sup> s', 'Un A/B corre 1–2 semanas aunque junte su muestra en horas (<a href="#c01.evaluacion">c01</a>)'],
            ['1 mes, para costos', '730 h ≈ 2.63 × 10<sup>6</sup> s', '365 × 24 ÷ 12 ≈ 30.4 días. Costo mensual = US$/h × 730; predicciones al mes = diarias × 30.4'],
            ['1 mes, para SLOs', '30 días = 720 h ≈ 2.59 × 10<sup>6</sup> s', 'Ventana típica de un SLO; también se usan 4 semanas (28 días)'],
            ['1 año', '8,760 h ≈ 3.15 × 10<sup>7</sup> s', 'Truco: π × 10<sup>7</sup> s'],
          ] },
          { t: 'table', caption: 'De volumen diario a requests por segundo', head: ['Por día', 'Promedio', 'Pico diurno (3×)', 'Por mes (× 30.4)', 'Qué suele implicar'], rows: [
            ['100 k', '≈ 1.2 req/s', '≈ 3.5 req/s', '≈ 3 M', '¿Tiene que ser online? Quizá un job o una cola'],
            ['1 M', '≈ 11.6 req/s', '≈ 35 req/s', '≈ 30 M', 'Dos réplicas por disponibilidad, no por carga'],
            ['10 M', '≈ 116 req/s', '≈ 350 req/s', '≈ 304 M', 'El <a href="#c01.estimaciones">caso 1</a>: diseño 500 req/s, 2 T4 por N+1'],
            ['100 M', '≈ 1,157 req/s', '≈ 3,500 req/s', '≈ 3 B', 'Varias GPUs llenas: el costo por predicción y el batching empiezan a mandar'],
            ['1 B', '≈ 11,574 req/s', '≈ 35,000 req/s', '≈ 30 B', 'Una flota: caché, cascadas y costo de red entran al diseño'],
          ], note: 'Regla: 1 M/día ≈ 11.6 req/s; multiplica. El pico de 3× es un supuesto: si la hora pico lleva 1/8 del tráfico diario, el pico es 24 × 1/8 = 3× el promedio. Confírmalo con los logs.' },
          { t: 'table', caption: 'Factores de pico (condensado de M3)', head: ['Factor', 'Valor típico', 'Nota'], rows: [
            ['Diurno (pico ÷ promedio)', E('2–5×'), 'Una sola zona horaria: valle nocturno profundo'],
            ['Semanal', E('1.2–2×'), 'Entre el mejor y el peor día: dimensiona con el peor'],
            ['Eventos (Black Friday, un lanzamiento)', E('2–10× sobre el pico normal'), 'Pide el histórico; si no existe, escalado programado'],
            ['Spike de una push notification', E('≈ 4.8× el pico diario'), 'Ejemplo ilustrativo de <a href="#m03.trafico">M3</a>: 5 M notificados, 2 % suben una foto en un minuto'],
            ['Margen de diseño', E('1.3–1.5×'), 'Spikes que no conoces + el error de tu estimación: 350 → 500'],
          ] },
          { t: 'table', caption: 'Nueves → caída permitida', head: ['Disponibilidad', 'Por mes (30 días)', 'Por mes (730 h)', 'Por año', 'Por día', 'Lo que suele hacer falta'], rows: [
            ['99 %', '7.2 h', '7.3 h', '3.65 días', '14.4 min', 'Una réplica que se reinicia sola; deploys con un corte breve'],
            ['99.5 %', '3.6 h', '3.65 h', '1.83 días', '7.2 min', 'Dos réplicas; alertas atendidas en horario laboral'],
            ['99.9 %', '43.2 min', '43.8 min', '8.76 h', '1.4 min', 'N+1 en 2 AZs, rollouts sin corte, rollback en minutos, on-call (<a href="#c01.requisitos">c01</a>)'],
            ['99.95 %', '21.6 min', '21.9 min', '4.38 h', '43 s', 'Lo anterior con rollback automático: un incidente de 30 min ya rompe el mes'],
            ['99.99 %', '4.3 min', '4.4 min', '52.6 min', '8.6 s', 'Detección y failover automáticos: nadie arregla nada a mano en 4 minutos'],
            ['99.999 %', '26 s', '26 s', '5.3 min', '0.9 s', 'Rara vez tiene sentido para un servicio de ML con fallback'],
          ], note: 'El "≈ 43 min/mes" del c01 y de M1 es 99.9 %: 43.2 min con 30 días, 43.8 con 730 h (40.3 con 28 días). Al hablar da igual; en un documento de SLO, nombra la ventana. La última columna es una regla práctica, no una norma.' },
          { t: 'calc', title: 'Disponibilidad compuesta y presupuesto de error', rows: [
            { label: 'Tres dependencias en serie, al 99.9 % cada una', expr: '0.999 × 0.999 × 0.999', value: '≈ 99.7 % (≈ 130 min/mes)' },
            { label: 'Dos réplicas independientes, al 99 % cada una', expr: '1 − (1 − 0.99)²', value: '99.99 %', note: 'Solo si fallan de forma independiente: otra AZ, otro nodo' },
            { label: 'Presupuesto de error en requests (c01)', expr: '(1 − 0.999) × 10 M/día × 30', value: '300,000 requests/mes' },
          ], result: 'En serie, cada pieza resta; la redundancia suma solo si las fallas no están correlacionadas. Dos réplicas en el mismo nodo o en la misma AZ no son N+1 (<a href="#m06.alta-disponibilidad">M6</a>).' },
          { t: 'callout', kind: 'trap', title: 'Prometer nueves sin mirar la cadena', html: `<p>Tu servicio no puede estar más disponible que el producto de lo que tiene en serie: balanceador, cluster, zona, dependencias. Antes de aceptar 99.99 %, pregunta qué pasa cuando falla (el c01 tiene selector manual: 99.9 % basta) y qué cuesta el siguiente nueve. Cada nueve divide la caída permitida entre 10 y encarece la operación.</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'latencias',
        title: 'Latencias de referencia',
        titleEn: 'Reference latencies',
        priority: 'core',
        dims: ['estimaciones', 'arquitectura'],
        blocks: [
          { t: 'p', html: `Órdenes de magnitud para saber qué tramo domina un presupuesto de latencia (<a href="#m03.presupuesto">M3</a>), no benchmarks. La escalera de hardware sigue la forma de la lista clásica "Latency Numbers Every Programmer Should Know" (Jeff Dean), redondeada a hardware actual; la red y la nube salen de la documentación de AWS o de la física; lo de ML, de los módulos. Lo marcado, lo mides en tu sistema.` },
          { t: 'table', caption: 'Hardware y almacenamiento', head: ['Operación', 'Orden de magnitud', 'De dónde sale', 'Cómo lo mides'], rows: [
            ['Lectura de caché L1 / L2', E('≈ 1 ns / ≈ 3–5 ns'), 'Pocos ciclos de reloj', 'No hace falta en una entrevista'],
            ['Acceso a RAM', E('≈ 100 ns'), 'DRAM: ≈ 100× la L1', '—'],
            ['Leer 1 MB secuencial de RAM', E('≈ 10–100 µs'), '10–100 GB/s de ancho de banda', '—'],
            ['Copiar 602 KB por PCIe (T4, Gen3 x16)', E('≈ 40 µs'), '≈ 16 GB/s por sentido (<a href="#m04.por-que-importa">M4</a>)', 'Nsight Systems'],
            ['Lectura aleatoria de 4 KiB en NVMe local', E('≈ 50–100 µs'), 'SSD NAND; g4dn, g5 y g6 traen NVMe local (instance store)', '<code>fio</code>'],
            ['Una I/O en EBS gp3 (disco típico del nodo)', '"un dígito de ms"', 'AWS; io2 Block Express: &lt; 500 µs en promedio', '<code>fio</code>, métricas del volumen en CloudWatch'],
            ['Leer 1 GB', E('≈ 0.3–1 s en NVMe') + ' · ≈ 8 s en gp3 base', 'NVMe ' + E('≈ 1–3 GB/s') + '; gp3 base: 125 MiB/s (AWS)', 'Cronometra la carga del modelo (<a href="#m05.pesos-modelo">M5</a>)'],
          ] },
          { t: 'table', caption: 'Red', head: ['Operación', 'Orden de magnitud', 'De dónde sale', 'Cómo lo mides'], rows: [
            ['Ida y vuelta (RTT) en la misma AZ', E('≈ 0.1–0.5 ms'), 'Depende del tipo de instancia y de la carga', '<code>ping</code>, <code>sockperf</code>, histograma del cliente'],
            ['RTT entre AZs de una región', E('≈ 0.4–2.5 ms'), 'AWS: "un dígito de ms"; mediciones independientes dan menos de 1 ms en la mayoría de los pares', 'Igual: compara misma AZ contra otra'],
            ['RTT entre regiones vecinas (≈ 500 km)', E('≈ 10–15 ms'), 'Física: ≥ 5 ms', '<code>ping</code> entre instancias'],
            ['RTT de costa a costa en EE. UU. (≈ 3,500 km)', E('≈ 60–80 ms'), 'Física: ≥ 35 ms', 'Ídem'],
            ['RTT entre continentes', E('≈ 70–250 ms'), 'Física: ≥ 1 ms por cada 100 km de fibra, ida y vuelta (la luz recorre ≈ 200 km por ms en la fibra)', 'Ídem'],
            ['Conexión nueva TCP + TLS 1.3', '+ 2 RTT antes del primer byte', 'Un RTT del handshake de TCP y uno del de TLS 1.3, más su cómputo', 'Por eso keep-alive y pools de conexiones (<a href="#c01.serving">c01</a>)'],
            ['Retransmisión de TCP', '≈ 200 ms', 'RTO mínimo por defecto de Linux (<a href="#m03.percentiles">M3</a>)', 'Saltos discretos de ≈ 200 ms en el histograma'],
          ] },
          { t: 'table', caption: 'Servicios de datos', head: ['Operación', 'Orden de magnitud', 'De dónde sale', 'Cómo lo mides'], rows: [
            ['GET a Redis / ElastiCache en la misma AZ', E('≈ 0.2–1 ms'), 'El servidor responde en µs: manda la red', '<code>redis-cli --latency</code>'],
            ['DynamoDB GetItem', '"un dígito de ms"', 'AWS', 'Métrica <code>SuccessfulRequestLatency</code>'],
            ['Postgres: lectura por índice, misma AZ', E('≈ 1–5 ms'), 'Consulta simple con la conexión abierta; una analítica tarda segundos', '<code>EXPLAIN ANALYZE</code> + latencia del cliente'],
            ['S3 GET de un objeto chico (&lt; 512 KB)', 'Mediana de decenas de ms; ≈ 100–200 ms "consistentes"', 'AWS; S3 Express One Zone: un dígito de ms', 'Métrica <code>FirstByteLatency</code> (métricas de requests, se activan por bucket) e histograma del cliente'],
          ] },
          { t: 'table', caption: 'Cómputo de ML', head: ['Operación', 'Orden de magnitud', 'De dónde sale', 'Cómo lo mides'], rows: [
            ['Decode de un JPEG de ≈ 1024 px (≈ 200 KB)', E('≈ 2 ms'), 'Medido en una laptop (Apple M4, Pillow, un hilo): solo orden de magnitud', 'Cronometra el preproceso con fotos reales'],
            ['Decode de un JPEG de 12 MP', E('≈ 40–80 ms por vCPU'), '≈ 40 ms en una máquina de desarrollo (<a href="#c01.estimaciones">c01</a>; en la laptop M4, ≈ 35 ms); ≈ 1.3–2× menos con draft mode (menos cuanto más pesa el archivo: el decoder igual lee todos los bytes)', 'Ídem, con la distribución de tamaños de producción'],
            ['Preproceso completo del c01, promedio', E('≈ 6 ms de CPU'), 'Mezcla 85 % celular y 15 % web, con draft mode (<a href="#c01.estimaciones">c01</a>)', 'Histograma por tramo en el gateway'],
            ['ResNet-50, TensorRT FP16, T4, batch 1–8', E('≈ 3–6 ms de p50'), 'Presupuesto del <a href="#c01.estimaciones">c01</a>', '<code>perf_analyzer</code>, <code>trtexec</code>'],
            ['ResNet-50, T4, batch 32', E('≈ 27 ms por batch'), 'Tabla ilustrativa de <a href="#m03.batching">M3</a> (≈ 1,190 img/s)', '<code>perf_analyzer</code>'],
            ['ResNet-50, PyTorch eager FP32, T4, batch 1', E('≈ 10 ms'), '≈ 100 img/s por proceso (<a href="#c01.estimaciones">c01</a>)', 'Script con <code>torch.cuda.synchronize()</code>'],
            ['ResNet-50 en un vCPU de nube', E('FP32 ≈ 40–80 ms · INT8 ≈ 8–25 ms'), '<a href="#c01.estimaciones">c01</a> y <a href="#m04.cpu-gpu-tpu">M4</a>: a medir en la semana 1', '<code>onnxruntime_perf_test</code>, <code>benchmark_app</code> (OpenVINO)'],
            ['LLM 8B en BF16: tiempo por token (decode, batch 1)', '≳ 54 ms L4 · ≳ 27 ms A10G · ≳ 4.8 ms H100', 'Cota: bytes de pesos ÷ ancho de banda (<a href="#m04.roofline">M4</a>)', '<code>vllm bench serve</code> (TPOT, ITL)'],
            ['LLM 8B: time to first token, prompt de 2,000 tokens', '≳ 0.27 s L4 · ≳ 32 ms H100, más la cola', 'Cota: 2 × parámetros × tokens ÷ FLOPS pico (<a href="#ref-numeros.formulas">fórmulas</a>)', '<code>vllm bench serve</code> (TTFT), AIPerf de NVIDIA'],
            ['Velocidad de lectura de una persona', E('≈ 4–7 tokens/s'), E('≈ 200–300 palabras por minuto') + ' en inglés, a ≈ ¾ de palabra por token', 'Referencia para fijar tokens/s en streaming'],
          ] },
          { t: 'kv', items: [
            ['0.1 s', 'Se siente instantáneo', 'Umbrales de Jakob Nielsen (<i>Usability Engineering</i>, 1993)'],
            ['1 s', 'Se nota la espera, pero no corta el flujo', 'El c01 corta a los 300 ms y muestra el selector manual'],
            ['10 s', 'Se pierde la atención', 'Progreso visible o un patrón asíncrono (<a href="#m02.asincrona-colas">M2</a>)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Una llamada lenta escondida en el camino crítico', html: `<p>Un p99 ≤ 200 ms no aguanta un RTT entre continentes (70–250 ms) ni un GET a S3: mediana de decenas de ms, ≈ 100–200 ms "consistentes" según AWS, y una cola que AWS manda cortar reintentando a los 2 s. Por eso el c01 recibe los bytes en el request y, si algún día manda la key de S3, mide antes su p99 (<a href="#c01.costo">c01</a>). Dentro de una región, cruzar de AZ cuesta ≈ 1 ms: la razón para evitarlo es el costo por GB, no la latencia.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El presupuesto por tramo del caso 1 (ALB 1–3 ms, hop a Triton 2–4 ms y GPU 3–6 ms de p50; ≈ 20–45 ms de p50 y ≈ 150 ms de p99 pesimista en total) está en <a href="#c01.estimaciones">c01</a>; por qué la suma de los p99 sobrestima el p99 real, en <a href="#m03.presupuesto">M3</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'bytes-tamanos',
        title: 'Bytes, dtypes y tamaños típicos',
        titleEn: 'Bytes, dtypes and typical sizes',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'table', caption: 'Bytes por valor (igual que M4)', head: ['dtype', 'Bytes', 'Tensor cores', 'Uso típico en inferencia'], rows: [
            ['FP32', '4', 'No: corre en CUDA cores (T4: 8.1 TFLOPS)', 'Referencia del parity test'],
            ['TF32', '4 en memoria', 'Ampere en adelante; no T4', 'Modo de cómputo: acelera matmuls, no ahorra memoria'],
            ['FP16', '2', 'Volta/Turing en adelante (T4 incluida)', 'CNNs con TensorRT (engine FP16 del c01)'],
            ['BF16', '2', 'Ampere en adelante; no T4', 'LLMs: se entrenan y se sirven en BF16'],
            ['FP8', '1', 'Ada (L4, L40S) y Hopper (H100); no A100 ni A10G', 'LLMs: pesos, activaciones o KV cache, con calibración'],
            ['INT8', '1', 'Turing en adelante; CPUs con VNNI/AMX', 'CNNs con PTQ o QAT; pesos de LLMs'],
            ['INT4', '0.5', 'La T4 lo acelera; en LLMs casi siempre es weight-only', 'LLMs grandes en GPUs chicas'],
          ], note: 'Detalle y por qué BF16 le ganó a FP16 en LLMs: <a href="#m04.bytes-dtype">M4</a>. <code>nvidia-smi</code> y PyTorch reportan MiB/GiB (1 GiB ≈ 1.074 GB): no los mezcles con GB en una misma cuenta.' },
          { t: 'calc', title: 'Pesos = parámetros × bytes', rows: [
            { label: 'ResNet-50 (25.6 M)', expr: '× 4 B · × 2 B · × 1 B', value: '≈ 102 MB FP32 · ≈ 51 MB FP16 · ≈ 26 MB INT8' },
            { label: 'YOLOv8m (25.9 M)', expr: '× 2 B', value: '≈ 52 MB FP16' },
            { label: 'ViT-B/16 (≈ 86 M)', expr: '× 2 B', value: '≈ 172 MB FP16' },
            { label: 'Llama 3 8B (8.03 B)', expr: '× 2 B · × 1 B · × 0.5 B + escalas', value: '≈ 16 GB BF16 · ≈ 8 GB INT8 · ' + E('≈ 4–6 GB') + ' INT4' },
            { label: 'Llama 3 70B (70.6 B)', expr: '× 2 B · × 1 B · × 0.5 B', value: '≈ 141 GB BF16 · ≈ 71 GB INT8 · ≈ 35 GB + overhead INT4' },
          ], result: 'Una CNN pesa decenas o cientos de MB: en una GPU de 16 GB la memoria casi nunca es el problema. Un LLM pesa decenas de GB: la memoria decide la GPU. La VRAM completa (activaciones, runtime, KV cache) está en <a href="#m04.vram">M4</a>.' },
          { t: 'table', caption: 'Tensores y payloads', head: ['Qué', 'Tamaño', 'Por qué importa'], rows: [
            ['Tensor 224×224×3 en uint8', '150,528 B ≈ 150 KB', 'Entrada UINT8: ÷ 4 de red contra FP32 (<a href="#c01.estimaciones">c01</a>, al crecer)'],
            ['El mismo tensor en FP32', '602,112 B ≈ 602 KB · batch 32 ≈ 19 MB', 'Pesa 3× el JPEG de celular: ≈ 2.4 Gb/s a 500 req/s (<a href="#c01.estimaciones">c01</a>)'],
            ['El mismo tensor como JSON (floats en texto)', '≈ 3.1 MB (≈ 5× el binario) · en base64, ≈ 803 KB', 'A 500 req/s serían ≈ 12.4 Gb/s, y serializarlo en Python cuesta ' + E('decenas de ms') + ' de CPU por request (≈ 50 ms en una laptop). Por eso binario o gRPC (<a href="#m07.protocolos">M7</a>)'],
            ['Logits de 500 clases en FP32', '2 KB', 'La respuesta es chica: el costo de red está en la entrada'],
            ['JPEG de celular (≤ 1024 px)', E('≈ 150–250 KB'), 'El caso normal del c01'],
            ['Original web de 12 MP', E('≈ 3 MB') + ' (2–5 MB según calidad y escena)', 'El 15 % del <a href="#c01.estimaciones">c01</a> que mueve la CPU de decode; si llegara así al ALB, triplicaría su costo'],
            ['Esa foto decodificada (RGB uint8)', '4000 × 3000 × 3 = 36 MB · 120 MB a 40 MP', 'RAM por request en vuelo; defensa contra decompression bombs'],
            ['Log de una predicción (JSON)', E('≈ 300 B'), '10 M/día → 3 GB/día crudos (<a href="#m01.estimaciones-express">M1</a>)'],
            ['Frame 1080p RGB sin comprimir', '1920 × 1080 × 3 ≈ 6.2 MB', 'A 30 fps: ≈ 187 MB/s ≈ 1.5 Gb/s. El video viaja comprimido y se decodifica cerca del modelo'],
            ['Video 1080p H.264', E('≈ 4 Mb/s') + ' → ≈ 43 GB/día por cámara', 'Depende de escena y configuración; 40 cámaras ≈ 1.7 TB/día (<a href="#m02.edge">M2</a>)'],
            ['Audio PCM de 16 kHz, 16 bit, mono', '32 KB/s · ≈ 1.9 MB/min · ≈ 115 MB/h', 'Formato de entrada habitual de los modelos de voz'],
            ['Voz comprimida (Opus)', E('≈ 16–32 kb/s') + ' ≈ 2–4 KB/s', 'Lo que viaja por la red en streaming de voz (<a href="#c13">c13</a>)'],
          ] },
          { t: 'table', caption: 'Un embedding: dimensiones × bytes', head: ['Dimensiones', 'FP32', 'FP16', 'INT8'], rows: [
            ['512', '2 KB', '1 KB', '512 B'],
            ['768', '3 KB', '1.5 KB', '768 B'],
            ['1,024', '4 KB', '2 KB', '1 KB'],
            ['1,536', '6 KB', '3 KB', '1.5 KB'],
          ], note: '100 M vectores de 768 dims: ≈ 307 GB en FP32 o ≈ 77 GB en INT8, antes de sumar el índice ANN. Ese número decide si el índice cabe en la RAM de un nodo o hay que partirlo (<a href="#c07">c07</a>).' },
          { t: 'kv', items: [
            ['1 token', E('≈ 4 caracteres de inglés ≈ ¾ de palabra'), 'Regla de OpenAI para sus tokenizers: 100 tokens ≈ 75 palabras. En español suelen salir más tokens por palabra: cuéntalos con el tokenizer del modelo'],
            ['KV cache por token (Llama 3 8B, BF16)', '128 KiB', 'El texto de un token pesa unos bytes; guardarlo en la GPU, ≈ 30,000× más (<a href="#m04.vram">M4</a>)'],
            ['Una conversación de 8k tokens', '≈ 1 GiB de KV cache', 'Por eso la concurrencia de un LLM la limita la memoria, no el cómputo'],
          ] },
          { t: 'callout', kind: 'trap', title: 'El JPEG no es lo que ocupa', html: `<p>Una foto de 200 KB se decodifica a ≈ 2.4 MB (1024 × 768 × 3) y una de 3 MB a 36 MB. La RAM por request en vuelo, el CPU de decode y el riesgo de una decompression bomb dependen de los píxeles, no de los bytes: por eso el c01 limita megapíxeles además de MB y acota los requests en vuelo por pod (<a href="#c01.fallas">c01</a>).</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'gpus',
        title: 'GPUs: memoria, ancho de banda, cómputo y precio',
        titleEn: 'GPUs: memory, bandwidth, compute and price',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Copia condensada de la tabla verificada de <a href="#m04.gpus-nvidia">M4</a> (sept. 2026), donde está el porqué de cada elección. Cómputo en <b>denso</b>; precios on-demand de us-east-1, aproximados.` },
          { t: 'table', caption: 'Las cinco GPUs de las entrevistas', head: ['', 'T4', 'L4', 'A10G', 'A100', 'H100 SXM'], rows: [
            ['Memoria', '16 GB GDDR6', '24 GB GDDR6', '24 GB GDDR6', '40 GB HBM2 · 80 GB HBM2e', '80 GB HBM3'],
            ['Lo que muestra <code>nvidia-smi</code>', '15,360 MiB', '≈ 23,030 MiB', '≈ 23,030 MiB', '—', '81,559 MiB'],
            ['Ancho de banda', '320 GB/s', '300 GB/s', '600 GB/s', '1,555 GB/s (40 GB) · 2,039 GB/s (80 GB SXM)', '3.35 TB/s'],
            ['FP16 tensor, denso', '65 TFLOPS', '≈ 121 TFLOPS', '70 TFLOPS', '312 TFLOPS', '≈ 990 TFLOPS'],
            ['INT8, denso', '130 TOPS', '≈ 242 TOPS', '140 TOPS', '624 TOPS', '≈ 1,979 TOPS'],
            ['BF16 · FP8', 'No · No', 'Sí · Sí (≈ 242 TFLOPS)', 'Sí · No', 'Sí · No', 'Sí · Sí (≈ 1,979 TFLOPS)'],
            ['Potencia máxima', '70 W', '72 W', '300 W', '250–400 W', 'hasta 700 W'],
            ['MIG', 'No', 'No', 'No', 'Hasta 7', 'Hasta 7'],
            ['Punto de quiebre (FP16 ÷ ancho de banda)', '≈ 200 FLOPs/B', '≈ 400 FLOPs/B', '≈ 117 FLOPs/B', '≈ 153 FLOPs/B (80 GB)', '≈ 295 FLOPs/B'],
            ['Techo de decode, Llama 3 8B BF16, batch 1', 'No cabe', '≲ 19 tokens/s', '≲ 37 tokens/s', '≲ 127 tokens/s (80 GB)', '≲ 210 tokens/s'],
            ['Instancia AWS', 'g4dn.xlarge', 'g6.xlarge', 'g5.xlarge', 'p4d.24xlarge (8 × 40 GB) · p4de (8 × 80 GB)', 'p5.48xlarge (8) · p5.4xlarge (1)'],
            ['US$ por GPU-hora', E('≈ 0.53'), E('≈ 0.80'), E('≈ 1.01'), E('≈ 2.75 · ≈ 3.43'), E('≈ 6.88')],
          ], note: 'NVIDIA suele publicar el doble "with sparsity" (2:4): divide entre 2 (la T4 ya es densa). Las xlarge traen 4 vCPU y 16 GiB de RAM; en p4d/p4de/p5.48xlarge es el precio de la instancia ÷ 8. AWS bajó P4 y P5 hasta 45 % en junio de 2025: verifica en la página de precios de EC2.' },
          { t: 'table', caption: 'Más allá de las cinco (cabeceras de M4)', head: ['Opción', 'Memoria', 'Ancho de banda', 'Nota'], rows: [
            ['L40S (g6e.xlarge)', '48 GB GDDR6', '864 GB/s', 'FP8, sin MIG; ' + E('≈ US$1.86/h') + ': escalón entre la L4 y la A100'],
            ['H200 (p5e / p5en)', '141 GB HBM3e', '4.8 TB/s', 'El cómputo de la H100 con más memoria y ancho de banda'],
            ['B200 (Blackwell)', '≈ 180 GB por GPU', '≈ 8 TB/s', 'Tensor cores FP4'],
            ['AMD MI300X', '192 GB HBM3', '5.3 TB/s', 'Stack ROCm; vLLM lo soporta'],
            ['1/8 de L4 (g6f.large)', '≈ 3 GB', '—', E('≈ US$0.20/h') + ': throughput por medir'],
            ['Slice MIG 1g.10gb de H100', '10 GB', '≈ 1/7–1/8 de la GPU', E('≈ US$0.98/h') + ': casi 2× una T4 completa (<a href="#m04.compartir-gpu">M4</a>)'],
          ] },
          { t: 'table', caption: 'Jetson (números de NVIDIA; los TOPS son INT8 con sparsity: divide entre 2)', head: ['Módulo', 'Memoria compartida', 'Ancho de banda', 'TOPS publicados', 'Potencia', 'DLA'], rows: [
            ['Orin Nano 4GB / 8GB', '4–8 GB LPDDR5', '34–102 GB/s', '20–67', '7–25 W', 'No'],
            ['Orin NX 8GB / 16GB', '8–16 GB LPDDR5', '102 GB/s', '70–157', '10–40 W', '1–2'],
            ['AGX Orin 32GB / 64GB', '32–64 GB LPDDR5', '204.8 GB/s', '200–275', '15–60 W', '2'],
            ['AGX Thor (2025)', '128 GB LPDDR5X', '273 GB/s', '2,070 TFLOPS FP4 sparse', '40–130 W', '—'],
          ], note: 'Los rangos de Nano y NX incluyen el modo Super de JetPack 6.2. Memoria unificada: el OS y tu app le restan al modelo (<a href="#m04.edge-jetson">M4</a>).' },
          { t: 'callout', kind: 'skip', html: `<p>No memorices TFLOPS ni TOPS con decimales, ni la tabla de Jetson. Memoriza por GPU: memoria, ancho de banda, si tiene BF16/FP8 y el orden de magnitud del precio. Con eso decides; el resto lo consultas.</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'throughput',
        title: 'Throughput: qué medir y con qué',
        titleEn: 'Throughput: what to measure and with which tool',
        priority: 'core',
        dims: ['estimaciones', 'monitoreo'],
        blocks: [
          { t: 'p', html: `Esto no es una lista de benchmarks. Cada fila da el orden de magnitud que ya usaste en los módulos, para chequear cordura, y la herramienta con la que lo mides en tu sistema. Ninguno reemplaza tu medición.` },
          { t: 'table', caption: 'Cantidad · orden de magnitud · cómo se mide', head: ['Cantidad', 'Orden de magnitud (de dónde sale)', 'Con qué lo mides'], rows: [
            ['ResNet-50, TensorRT FP16, una T4 con dynamic batching', E('≈ 1,200 img/s') + ' máximo medido (supuesto del <a href="#c01.estimaciones">c01</a>) → 600 planificadas al 50 %; a batch 1, ' + E('≈ 250 img/s') + ' (ilustrativo, <a href="#m03.batching">M3</a>)', '<code>perf_analyzer</code> contra Triton (<code>--concurrency-range</code>, <code>--request-rate-range</code>); <code>model_analyzer</code> para barrer configuraciones; <code>trtexec</code> para el engine solo'],
            ['Chequeo de cordura con FLOPs', 'T4: 65 TFLOPS ÷ 8.2 GFLOPs por imagen ≈ 7,900 img/s de techo; lo medido queda en ' + E('≈ 15 %') + ' (<a href="#m03.cuantas-gpus">M3</a>)', 'Cuenta en papel: si tu medición supera el techo, está mal'],
            ['ResNet-50, PyTorch eager FP32, batch 1, T4', E('≈ 100 img/s por proceso') + ' (<a href="#c01.estimaciones">c01</a>)', 'Script con <code>torch.cuda.synchronize()</code> y warmup'],
            ['ResNet-50 en CPU, por vCPU', 'FP32 ' + E('≈ 12–25 img/s') + ' · INT8 ' + E('≈ 40–125 img/s') + ' (40–80 y 8–25 ms por imagen, <a href="#c01.estimaciones">c01</a>)', '<code>onnxruntime_perf_test</code> o <code>benchmark_app</code> (OpenVINO) en el tipo de instancia real'],
            ['Decode + preproceso JPEG, por core', 'Foto de ≈ 1024 px: cientos por core (' + E('≈ 2 ms') + ' de decode); mezcla del <a href="#c01.estimaciones">c01</a>: ' + E('≈ 6 ms') + ' → ≈ 170 por core; 12 MP: ' + E('≈ 12–25 por core'), 'Cronometra con fotos de producción: la distribución de tamaños manda'],
            ['Detector a 640 px en una L4', E('≈ 250 frames/s') + ' (supuesto ilustrativo de <a href="#m03.cuantas-gpus">M3</a>)', '<code>trtexec</code> o <code>perf_analyzer</code>; el decode de video, aparte'],
            ['LLM: tokens/s por secuencia', '≲ ancho de banda ÷ bytes de pesos: 8B BF16 ≲ 19 (L4), ≲ 37 (A10G), ≲ 210 (H100)', '<code>vllm bench serve</code> (TTFT, TPOT, tokens/s de salida); AIPerf de NVIDIA, sucesor de GenAI-Perf'],
            ['LLM: tokens/s totales con batching', 'Sube con el batch hasta que el KV cache llena la VRAM: L4 ≲ 59 tokens/s con 4 secuencias de 8k (<a href="#m04.roofline">M4</a>)', 'Ídem, barriendo la concurrencia; mira el uso del KV cache del servidor'],
            ['Red sostenida por instancia (baseline)', 'g4dn.xlarge 5 Gb/s (ráfaga hasta 25) · g5.xlarge y g6.xlarge 2.5 (hasta 10) · c6i.xlarge 1.56 (hasta 12.5)', 'Documentación de EC2; <code>iperf3</code> entre dos instancias. El <a href="#c01.estimaciones">c01</a> manda ≈ 2.4 Gb/s de tensores FP32'],
            ['Disco del nodo', 'gp3 base: 125 MiB/s y 3,000 IOPS (se provisiona hasta 2,000 MiB/s y 80,000 IOPS)', '<code>fio</code>'],
            ['Descarga desde S3 a un nodo', E('≈ 0.2–1 GB/s') + ' con partes en paralelo (<a href="#m05.pesos-modelo">M5</a>)', 'Cronometra <code>aws s3 cp</code> o el loader real'],
            ['Pull de una imagen de contenedor', E('≈ 0.03–0.09 GB/s') + ' efectivos (arriba, el benchmark de AWS con un EBS de 1,000 MiB/s; abajo, gp3 base de 125 MiB/s) → Triton de 9.2 GB en ' + E('≈ 2–5 min') + ' (<a href="#m05.tamano">M5</a>)', 'Eventos <code>Pulling</code>/<code>Pulled</code> del kubelet (<a href="#ref-comandos.autoscaling-cmds">comandos</a>)'],
            ['S3: requests por segundo', 'Al menos 3,500 escrituras y 5,500 lecturas por segundo por prefijo; escala de a poco y responde 503 Slow Down mientras', 'Métricas de requests de S3; reparte las keys en varios prefijos'],
            ['Kafka: throughput por partición', 'Productor: "decenas de MB/s" en una partición (Confluent); consumidor: lo que tarde tu lógica (<a href="#m02.streaming">M2</a>: ' + E('≈ 1,500 ev/s') + ' por consumidor, supuesto)', '<code>kafka-producer-perf-test</code> / <code>kafka-consumer-perf-test</code>; particiones ≥ max(t/p, t/c)'],
            ['Servicio HTTP de punta a punta', 'La capacidad al SLO: el último escalón de la rampa con p99 dentro del presupuesto', 'k6 (<code>constant-arrival-rate</code>, carga abierta) o Locust (<a href="#m03.load-testing">M3</a>)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Citar el throughput de otra máquina', html: `<p>Otro modelo, otro batch, otra precisión, otro driver: otro número. El "≈ 2.5× la T4" de la A10G en la hoja de AWS/NVIDIA es INT8 a batch 128, no tu configuración (<a href="#m04.costo-por-prediccion">M4</a>). Y tu laptop no es un vCPU de nube: el decode de 12 MP que tarda ≈ 35 ms en una Apple M4 cuesta 40–80 ms en un vCPU. Di la fuente, el orden de magnitud y la herramienta con la que lo confirmas.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>La señal senior es decir el número y la medición en la misma frase: "asumo ≈ 1,200 img/s por T4 para dimensionar; lo primero que hago es una rampa con perf_analyzer. Si el codo sale en 800, la fórmula pide 3 GPUs y no 2 (ceil(500 ÷ 400) + 1)". El supuesto te deja decidir hoy; la medición confirma la flota antes de comprarla.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'optimizacion-serving',
        title: 'Optimización y serving: rangos y umbrales',
        titleEn: 'Optimization and serving: ranges and thresholds',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Rangos para decir en voz alta, siempre con su condición. Son ganancias del <b>modelo</b>, no del servicio: el porqué de cada una está en <a href="#m08.mapa-tecnicas">M8</a>; el costo de mandar el tensor en JSON, en <a href="#m07.protocolos">M7</a>.` },
          { t: 'table', caption: 'Qué compra cada técnica y con qué la validas', head: ['Qué', 'Número', 'Condición'], rows: [
            ['Compilador de grafos (TensorRT, ONNX Runtime, torch.compile), misma precisión', E('≈ 1–2×') + ' sobre PyTorch eager', 'Más a batch chico en GPU, donde manda el overhead; en CPU puede no ganar nada (<a href="#m08.cpu-inferencia">M8</a>)'],
            ['FP16 con tensor cores', E('≈ 2–4×') + ' sobre FP32', 'Misma GPU, batch moderado; T4 en adelante (BF16: Ampere en adelante)'],
            ['INT8 post-training (PTQ)', E('≈ 1.5–2×') + ' sobre FP16 en GPU; 4× menos bytes que FP32', 'Techo en la T4: 130 TOPS ÷ 65 TFLOPS = 2×. Pide calibración y un gate por slices'],
            ['Sparsity 2:4', E('≈ 1.1–1.5×') + ' de punta a punta', 'Ampere en adelante (no T4), con fine-tuning de la máscara'],
            ['Pruning no estructurado', '≈ 1×', 'Los kernels densos multiplican los ceros igual: 50 % de ceros, misma latencia (medido en <a href="#m08.pruning-destilacion">M8</a>)'],
            ['Destilación a un estudiante chico', E('≈ 2–5×'), 'La razón entre arquitecturas; se mide (ResNet-50 → MobileNetV3: ≈ 4× en CPU, laptop)'],
            ['Modelo 2× más rápido en el c01', '≈ 3–5 % menos de p99', 'El cómputo es ' + E('≈ 8–15 ms') + ' de ' + E('≈ 150 ms') + ' de p99: ley de Amdahl'],
            ['Parity test contra PyTorch FP32', 'Acuerdo top-1 ≥ 99.5 % y top-5 ≥ 99 %; max|Δlogit| esperable ≈ 1e-4 en FP32 y ≈ 1e-2 en FP16', '≈ 10k imágenes del golden set con el preproceso del gateway (gate del c01, <a href="#m08.validar">M8</a>). Un 97 % en FP16 es un bug, no redondeo'],
            ['Calibración de INT8', '≈ 500–1,000 imágenes', 'Tráfico real reciente, estratificado por slice; NVIDIA Model Optimizer pide al menos 500'],
            ['Build de un engine de TensorRT (ResNet-50)', E('del orden de minutos'), 'En CI, en la misma GPU y release de NGC que el serving; nunca al arrancar el pod'],
            ['torch.compile, primera llamada', '≈ 17 s en CPU (laptop); ≈ 1.1–1.4 s con el caché en disco', 'Warmup de todas las shapes antes de la readiness, caché en la imagen o AOTInductor (<a href="#m08.torch-compile">M8</a>)'],
          ] },
          { t: 'callout', kind: 'trap', title: 'Multiplicar las ganancias', html: `<p>"TensorRT, INT8 y pruning: 8× más rápido" junta ganancias que solo actúan sobre la parte de cómputo. En el c01 el cómputo es ≈ 5–10 % del p99: aunque desapareciera, el p99 bajaría menos de 10 %. Di qué número mueve la técnica (GPUs, un tier, que el modelo quepa) antes de dar el factor (<a href="#m08.por-que-optimizar">M8</a>).</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'costos',
        title: 'Costos de nube (órdenes de magnitud)',
        titleEn: 'Cloud costs (orders of magnitude)',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Precios on-demand aproximados de us-east-1 (sept. 2026). Cambian: en un diseño real, verifícalos en la calculadora de AWS. Mensual = por hora × 730.` },
          { t: 'table', caption: 'Cómputo', head: ['Recurso', 'US$/h', 'US$/mes', 'Nota'], rows: [
            ['g4dn.xlarge (1 T4, 4 vCPU, 16 GiB)', E('≈ 0.526'), E('≈ 384'), '<a href="#c01.costo">c01</a>: 2 → ≈ US$768/mes'],
            ['g6.xlarge (1 L4)', E('≈ 0.805'), E('≈ 588'), '≈ 53 % más por hora que la T4'],
            ['g5.xlarge (1 A10G)', E('≈ 1.006'), E('≈ 734'), '≈ 2× la T4'],
            ['g6e.xlarge (1 L40S)', E('≈ 1.86'), E('≈ 1,358'), '48 GB y FP8'],
            ['p4d.24xlarge (8 × A100 40 GB)', E('≈ 22'), E('≈ 16k'), '≈ 2.75 por GPU; la A100 viene de a 8'],
            ['p4de.24xlarge (8 × A100 80 GB)', E('≈ 27.4'), E('≈ 20k'), '≈ 3.43 por GPU'],
            ['p5.48xlarge (8 × H100)', E('≈ 55'), E('≈ 40k'), '≈ 6.88 por GPU; p5.4xlarge trae 1'],
            ['c6i.xlarge (4 vCPU, 8 GiB)', E('≈ 0.17'), E('≈ 124'), '≈ US$0.0425 por vCPU-hora; <a href="#c01.costo">c01</a>: 2 → ≈ US$248'],
            ['g6f.large (1/8 de L4)', E('≈ 0.20'), E('≈ 146'), 'Fracción de GPU (<a href="#m04.costo-por-prediccion">M4</a>)'],
            ['Cloud Run con L4 (4 vCPU, 16 GiB)', E('≈ 1.05'), E('≈ 764'), 'Por segundo; ese mensual es si nunca se apaga (<a href="#m06.serverless">M6</a>)'],
          ] },
          { t: 'table', caption: 'Plataforma, red, almacenamiento y datos', head: ['Concepto', 'Precio aproximado', 'Ejemplo con números del curso'], rows: [
            ['Control plane de EKS', 'US$0.10/h por cluster', '≈ US$73/mes (<a href="#c01.costo">c01</a>)'],
            ['ALB', 'US$0.0225/h + US$0.008 por LCU-hora (1 LCU = 1 GB/h procesado hacia targets de instancia o IP)', 'c01, suponiendo ≈ 200 KB por imagen (la web también reduce antes de subir): ≈ 2 TB/día → ' + E('≈ US$500/mes') + ', ≈ 30 % de la infra. Con 15 % de originales web de ≈ 3 MB serían ≈ 6 TB/día y ' + E('≈ US$1.5k') + ' (<a href="#c01.estimaciones">c01</a>)'],
            ['Transferencia entre AZs', 'US$0.01/GB en cada sentido (US$0.02 ida y vuelta)', '<a href="#c01.estimaciones">c01</a> sin ruteo por zona: ≈ 90 TB/mes → ' + E('≈ US$1,800/mes') + ', más que las dos GPUs'],
            ['Egress a internet', '≈ US$0.09/GB (primeros 10 TB/mes; 100 GB/mes gratis sumando servicios y regiones)', 'Subir datos a la nube normalmente no se cobra (<a href="#m02.edge">M2</a>)'],
            ['NAT Gateway', 'US$0.045/h + US$0.045 por GB procesado', 'Llama 3 70B (141 GB) por NAT: ≈ US$6.3 por réplica que arranca; un VPC endpoint de tipo gateway para S3 no cobra por GB (<a href="#m05.pesos-modelo">M5</a>)'],
            ['S3 Standard', '≈ US$0.023/GB-mes (primeros 50 TB)', '1 TB ≈ US$23/mes; los logs del <a href="#c01.estimaciones">c01</a>, ≈ 90 GB/mes crudos'],
            ['S3 GET', 'US$0.0004 por 1,000', '200 M GETs del backfill ≈ US$80 (<a href="#c01.estimaciones">c01</a>)'],
            ['DynamoDB on-demand, escrituras', '≈ US$0.625 por millón', '1.5 B/mes ≈ US$940 (<a href="#m02.batch">M2</a>)'],
            ['AWS WAF, regla rate-based', '≈ US$0.60 por millón de requests', '≈ 300 M/mes → ≈ US$180 (<a href="#c01.serving">c01</a>)'],
            ['Etiquetado humano', E('≈ US$0.05–0.10 por imagen'), '≈ 5k/mes → ≈ US$250–500 (<a href="#c01.costo">c01</a>)'],
          ] },
          { t: 'table', caption: 'Descuentos (el detalle, en M13)', head: ['Mecanismo', 'Descuento de referencia', 'Para qué sí', 'Para qué no'], rows: [
            ['Savings Plans o reservas a 1 año', E('≈ 30–40 %') + ' (<a href="#c01.costo">c01</a>); AWS anuncia "hasta 72 %" con compromisos más largos y específicos', 'La base estable: las 2 GPUs de N+1', 'Capacidad que no sabes si vas a usar'],
            ['Spot', E('≈ 25–55 %') + ' observado en GPUs de inferencia (≈ 25 % en g6, ≈ 48 % en g4dn, ≈ 54 % en g5; us-east-1, oct. 2026); varía mucho por familia y zona (<a href="#m13.spot">M13</a>). Los ' + E('60–70 %') + ' de <a href="#c01.costo">c01</a>, c02 y c04 son un supuesto a confirmar con el historial de precios spot; AWS anuncia "hasta 90 %"', 'Backfill, training, batch con checkpoints (aviso de ≈ 2 min)', 'El mínimo online'],
          ], note: 'Un Savings Plan es un descuento, no una reserva de capacidad: no te garantiza GPUs (<a href="#m06.nodos">M6</a>). Más en <a href="#m13">M13</a>.' },
          { t: 'calc', title: 'Costo por 1,000 predicciones = US$/h ÷ (predicciones/s × 3,600 ÷ 1,000)', rows: [
            { label: 'T4 a su capacidad planificada (600 img/s)', expr: '0.526 ÷ (600 × 3.6)', value: E('≈ US$0.00024') },
            { label: 'Las 2 T4 del c01 con su carga real (≈ 304 M/mes)', expr: 'US$768 ÷ 304 M × 1,000', value: E('≈ US$0.0025'), note: '≈ 10× la cuenta anterior: cada GPU procesa ≈ 58 img/s en promedio, ≈ 10 % de las 600 planificadas (≈ 5 % de su máximo medido)' },
            { label: 'Infra completa del c01', expr: 'US$1,750 ÷ 304 M × 1,000', value: E('≈ US$0.006') },
            { label: 'Con etiquetado', expr: 'US$2,300 ÷ 304 M × 1,000', value: E('≈ US$0.008') },
          ], result: 'La hoja de precios da el primer número; tu diseño paga el último. La utilización real y lo que no es GPU (ALB, gateway, red) mandan (<a href="#c01.costo">c01</a>, <a href="#m04.costo-por-prediccion">M4</a>).' },
          { t: 'callout', kind: 'trap', title: 'Buscar el costo solo en la GPU', html: `<p>En el c01 las GPUs son ≈ 45 % de la infra y el ALB ≈ 30 % (con ≈ 200 KB por imagen), porque cobra por cada GB de imagen que lo cruza: si el 15 % llegara como original web de ≈ 3 MB, su costo se triplicaría y superaría a las GPUs. La transferencia entre AZs sin ruteo por zona (≈ US$1,800/mes) o una descarga grande por NAT pueden superar a las GPUs. Recorre los bytes: quién los mueve, cuántas veces y por dónde.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'formulas',
        title: 'Fórmulas de bolsillo',
        titleEn: 'Back-of-the-envelope formulas',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'p', html: `Cada fórmula con un número resuelto de los módulos y el enlace a donde se explica. Si te acuerdas del ejemplo, te acuerdas de la fórmula.` },
          { t: 'calc', title: 'Tráfico y capacidad', rows: [
            { label: 'QPS promedio = por día ÷ 86,400', expr: '10 M ÷ 86,400', value: '≈ 116 req/s', note: '<a href="#m03.trafico">M3</a>' },
            { label: 'Diseño = promedio × pico × margen', expr: '116 × 3 ≈ 350; × ≈ 1.4', value: '500 req/s (redondeado)', note: '<a href="#c01.estimaciones">c01</a>' },
            { label: 'Little: L = λ · W (W promedio)', expr: '500 req/s × 0.05 s', value: '25 requests en vuelo', note: '<a href="#m03.little">M3</a>' },
            { label: 'GPUs = ceil(pico ÷ (máx. medido × utilización)) + N+1', expr: 'ceil(500 ÷ (1,200 × 0.5)) + 1', value: '2 GPUs', note: '<a href="#m03.cuantas-gpus">M3</a>' },
            { label: 'Utilización ρ = carga ÷ máximo', expr: '250 ÷ 1,200', value: '≈ 21 % por GPU en el pico de diseño (500 req/s entre 2 GPUs)' },
            { label: 'M/M/1, tiempo en el sistema: W = S ÷ (1 − ρ)', expr: '10 ms ÷ (1 − 0.8)', value: '50 ms', note: '<a href="#m03.colas-utilizacion">M3</a>' },
            { label: 'M/M/1, espera en cola: Wq = ρS ÷ (1 − ρ)', expr: '0.8 × 10 ms ÷ 0.2', value: '40 ms' },
            { label: 'Ancho de banda = bytes × tasa × 8', expr: '602 KB × 500 req/s × 8', value: '≈ 2.4 Gb/s', note: '<a href="#c01.estimaciones">c01</a>' },
            { label: 'Almacenamiento = bytes × eventos × retención', expr: '300 B × 10 M/día × 365', value: '3 GB/día ≈ 1.1 TB/año', note: '<a href="#m01.estimaciones-express">M1</a>' },
            { label: 'Vaciar un backlog = backlog ÷ (capacidad − llegada)', expr: '60,000 ÷ (200 − 50)', value: '400 s ≈ 7 min', note: '<a href="#m02.asincrona-colas">M2</a>' },
            { label: 'Fan-out: P(lento) = 1 − 0.99<sup>N</sup>', expr: 'N = 100', value: '≈ 63 %', note: '<a href="#m03.percentiles">M3</a>' },
          ], result: 'Con estas cuentas decides cuántas réplicas, cuántas GPUs y dónde se forma la cola. Todas usan el promedio y el pico que fijaste al principio: si esos cambian, recalcula todo.' },
          { t: 'calc', title: 'Memoria y LLMs', rows: [
            { label: 'Pesos = parámetros × bytes', expr: '8.03 B × 2 B', value: '≈ 16 GB', note: '<a href="#m04.bytes-dtype">M4</a>' },
            { label: 'VRAM = pesos + activaciones + runtime + KV cache + margen', expr: 'c01 en una T4', value: E('≈ 1–3 GB') + ' de 16 GB', note: '<a href="#m04.vram">M4</a>' },
            { label: 'KV por token = 2 × capas × KV heads × head_dim × bytes', expr: '2 × 32 × 8 × 128 × 2 B', value: '128 KiB; 8k tokens = 1 GiB' },
            { label: 'Secuencias a la vez = VRAM libre para KV ÷ KV por secuencia', expr: E('3–4 GB') + ' ÷ 1.07 GB (L4, 8k tokens)', value: E('≈ 3–4') },
            { label: 'Decode: tokens/s por secuencia ≲ ancho de banda ÷ bytes de pesos', expr: '300 GB/s ÷ 16.06 GB', value: '≈ 19 tokens/s como techo (L4)', note: '<a href="#m04.roofline">M4</a>' },
            { label: 'TTFT ≳ 2 × parámetros × tokens del prompt ÷ FLOPS pico', expr: '2 × 8.03 B × 2,000 ÷ 121 TFLOPS', value: '≈ 0.27 s como piso (L4)', note: 'Cota: el cómputo real no llega al pico y se suma la cola' },
            { label: 'Punto de quiebre = FLOPS pico ÷ ancho de banda', expr: '65 TFLOPS ÷ 320 GB/s', value: '≈ 200 FLOPs/B (T4)' },
          ], result: 'En un LLM, la capacidad de memoria fija cuántas conversaciones sirves, el ancho de banda fija la velocidad de cada una y el cómputo fija el TTFT.' },
          { t: 'calc', title: 'Costo, experimentos y confiabilidad', rows: [
            { label: 'Mensual = US$/h × 730', expr: '2 × 0.526 × 730', value: E('≈ US$768') },
            { label: 'Por 1,000 = US$/h ÷ (pred/s × 3.6)', expr: '0.526 ÷ (600 × 3.6)', value: E('≈ US$0.00024'), note: 'Con la carga real del c01: ' + E('≈ US$0.006') + ' de infra' },
            { label: 'A/B por brazo: n ≈ 16 · p(1 − p) ÷ δ²', expr: '16 × 0.7 × 0.3 ÷ 0.01²', value: '≈ 33,600 (exacta ≈ 32,600) → ≈ 33k', note: 'α = 0.05, potencia 0.8 (<a href="#c01.evaluacion">c01</a>)' },
            { label: 'Caída = (1 − A) × minutos del periodo', expr: '0.001 × 43,200', value: '43.2 min/mes' },
            { label: 'Presupuesto de error = (1 − SLO) × requests', expr: '0.001 × 300 M', value: '300,000 requests/mes', note: '<a href="#c01.requisitos">c01</a>' },
            { label: 'En serie: A₁ × A₂ × …; en paralelo: 1 − (1 − A)ⁿ', expr: '0.999³ · 1 − 0.01²', value: '≈ 99.7 % · 99.99 %' },
            { label: 'Reintentos: intentos = (1 + reintentos)<sup>capas</sup>', expr: '(1 + 3)³', value: '64 intentos por request', note: '<a href="#m03.timeouts-reintentos">M3</a>' },
          ], result: 'Cada una convierte un número en una decisión: comprar compromiso o no, cuánto dura el experimento, cuánto error aguanta el SLO, en qué capa reintentar.' },
          { t: 'callout', kind: 'trap', title: 'Little con el p99', html: `<p>L = λ · W usa el tiempo <b>promedio</b> adentro, no el p99. Con W = p99 sobredimensionas pools y colas. Para el caso malo acotado usa el timeout: 500 req/s × 0.15 s = 75 llamadas a Triton como techo (<a href="#m03.little">M3</a>).</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'entrevista',
        title: 'Cómo usar estos números en voz alta',
        titleEn: 'Using these numbers out loud',
        priority: 'core',
        dims: ['comunicacion', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Un número que no cambia una decisión es ruido. Di el número, la cuenta en una línea y la decisión que dispara.` },
          { t: 'table', head: ['Número que dices', 'Decisión que dispara'], rows: [
            ['"≈ 116 req/s promedio, diseño 500"', 'Tráfico modesto: pocas réplicas, sin Kafka ni sharding'],
            ['"Una T4 alcanza; la segunda es N+1"', 'Dos GPUs en dos AZs; el número de GPUs lo fija la disponibilidad'],
            ['"El tensor pesa 602 KB, 3× el JPEG"', 'Ruteo por zona desde el día 1; entrada UINT8 al crecer'],
            ['"INT8 da ≈ 2× en la T4, como mucho"', 'En el c01 no quita ninguna GPU (están por N+1): no se lanza hasta 10× el tráfico o para pasar a CPU'],
            ['"8B en BF16 son 16 GB"', 'No cabe en una T4: L4 o cuantizar, y revisar el KV cache'],
            ['"128 KiB de KV cache por token"', '≈ 3–4 conversaciones de 8k por L4: la concurrencia define la flota'],
            ['"99.9 % son 43 minutos al mes"', 'Un rollback manual de 30 minutos se come casi todo el mes: rollback automático'],
            ['"Otra región: de 10 a más de 100 ms de RTT"', 'Nada sale de la región en un camino crítico de 200 ms'],
          ] },
          { t: 'list', items: [
            '<b>Redondea a una o dos cifras.</b> "≈ 116" o "≈ 120", nunca "115.74". La precisión falsa resta: pierdes tiempo y parece que no sabes qué importa.',
            '<b>Siempre con unidades.</b> "500 req/s en el pico de diseño", "602 KB por request", "US$768 al mes". Un número sin unidad no se puede verificar.',
            '<b>Rangos con condiciones.</b> "40–80 ms por imagen en un vCPU, en FP32" dice más que "60 ms".',
            '<b>Di la fuente y la medición.</b> "Es un supuesto; lo confirmo con perf_analyzer" convierte un número incierto en un plan.',
            '<b>Chequea el orden de magnitud contra un techo.</b> Si tu throughput supera el de los FLOPs o el de la red, la cuenta está mal.',
          ] },
          { t: 'callout', kind: 'interview', html: `<ul>
            <li>"Ten million a day is about 116 requests per second on average; with a 3x daily peak and some headroom, I'll design for 500."</li>
            <li>"I don't have a reliable benchmark for this model on a T4, so my working assumption is around 1,200 images per second, and the first thing I'd do is a ramp test with perf_analyzer."</li>
            <li>"At 99.9%, the monthly error budget is about 43 minutes, so a manual rollback that takes half an hour would burn most of it."</li>
            <li>"A round trip to another region costs anywhere from ten to a couple of hundred milliseconds, so nothing in the 200-millisecond request path leaves the region."</li>
            <li>"The 8-billion-parameter model is about 16 GB in BF16, so it doesn't fit on a T4; I'd start with an L4 and check how much memory is left for the KV cache."</li>
            <li>"These are list prices and they change, but the ratio matters more: here the load balancer costs about two-thirds as much as the GPUs, because it bills by processed bytes and every image goes through it."</li>
          </ul>` },
          { t: 'callout', kind: 'skip', html: `<p>No memorices latencias de caché al nanosegundo ni TFLOPS con decimales. Memoriza la forma de la escalera (ns en memoria, µs en SSD, menos de un ms dentro de una región, decenas a cientos de ms entre regiones) y los números de la lista de abajo. El resto está en esta hoja.</p>` },
          { t: 'checklist', id: 'numeros-de-memoria', items: [
            { id: 'tiempo', html: '86,400 s por día; 1 M/día ≈ 12 req/s; un mes son 730 h.' },
            { id: 'nueves', html: '99.9 % ≈ 43 min/mes; 99.99 % ≈ 4 min; cada nueve divide la caída entre 10.' },
            { id: 'escalera', html: 'RAM ≈ 100 ns · NVMe ≈ 100 µs · misma AZ ≲ 0.5 ms · entre AZs ≈ 1 ms · entre continentes ≈ 100 ms o más.' },
            { id: 'dtype', html: 'Bytes por dtype 4 / 2 / 1 / 0.5 y pesos = parámetros × bytes (ResNet-50 FP16 ≈ 51 MB; 8B BF16 ≈ 16 GB).' },
            { id: 'tensor', html: '224×224×3: ≈ 150 KB en uint8 y ≈ 602 KB en FP32.' },
            { id: 'gpus', html: 'T4: 16 GB, 320 GB/s, ≈ US$0.53/h · L4: 24 GB, 300 GB/s, ≈ US$0.80/h · H100: 80 GB, 3.35 TB/s, ≈ US$6.88/h.' },
            { id: 'llm', html: 'KV por token = 2 × capas × KV heads × head_dim × bytes (128 KiB en Llama 3 8B) y decode ≲ ancho de banda ÷ bytes de pesos.' },
            { id: 'colas', html: 'Little L = λ · W y M/M/1: al 50 % W = 2S; al 90 %, W = 10S.' },
            { id: 'costo', html: '× 730 para el mes; costo por 1,000 predicciones; entre AZs US$0.01/GB por sentido; egress ≈ US$0.09/GB.' },
            { id: 'ab', html: 'A/B: n ≈ 16 · p(1 − p) ÷ δ² por brazo (≈ 33k para +1 pp sobre 70 %).' },
            { id: 'optimizacion', html: 'FP16 ≈ 2–4× sobre FP32 e INT8 ≈ 1.5–2× sobre FP16 en GPU; parity top-1 ≥ 99.5 %; calibración con ≈ 500–1,000 imágenes reales; el tensor en JSON pesa ≈ 5× el binario.' },
          ] },
          { t: 'quiz', items: [
            { q: 'Te dicen 50 M requests al día. ¿QPS promedio?', options: ['≈ 58', '≈ 580', '≈ 5,800', '≈ 50'], answer: 1,
              explain: '50 × 11.6 ≈ 580 req/s (50,000,000 ÷ 86,400 ≈ 579). Con un pico de 3×, ≈ 1,700.' },
            { q: '99.95 % mensual, con una ventana de 30 días: ¿cuánta caída permite?', options: ['≈ 4 min', '≈ 22 min', '≈ 43 min', '≈ 3.6 h'], answer: 1,
              explain: '0.0005 × 43,200 min = 21.6 min. 43 min es 99.9 % y 4 min es 99.99 %.' },
            { q: '¿Qué cabe con holgura en un presupuesto de p99 de 50 ms?', options: ['Un GET a S3 de un objeto chico, contando su cola', 'Un RTT entre continentes', 'Dos GETs a Redis en la misma AZ', 'Decodificar un JPEG de 40 MP en un vCPU'], answer: 2,
              explain: 'Redis en la misma AZ: ≈ 0.2–1 ms por GET. Un GET a S3 tiene mediana de decenas de ms, pero AWS habla de ≈ 100–200 ms "consistentes" y aconseja reintentar a los 2 s: su cola llega a segundos. Un RTT entre continentes llega a 70–250 ms, y 40 MP son ≈ 3× los píxeles de 12 MP: más de 100 ms de decode.' },
            { q: 'Tu gateway manda ≈ 90 TB al mes a un Triton en otra AZ. ¿Cuánto cuesta esa transferencia?', options: ['≈ US$90', '≈ US$900', '≈ US$1,800', 'Nada: es la misma región'], answer: 2,
              explain: 'US$0.01/GB al salir + US$0.01/GB al entrar = US$0.02 × 90,000 GB ≈ US$1,800/mes. Es la cuenta del c01 sin ruteo por zona.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'ref-numeros-01', kind: 'numero', q: '¿Cuánta caída al mes permiten 99 %, 99.5 %, 99.9 %, 99.95 % y 99.99 %?',
        a: 'Con 30 días: 7.2 h · 3.6 h · 43.2 min · 21.6 min · 4.3 min (con 730 h: 7.3 h, 3.65 h, 43.8, 21.9 y 4.4 min). Cada nueve divide la caída permitida entre 10.' },
      { id: 'ref-numeros-02', kind: 'numero', q: '100 M y 1 B de requests al día: ¿cuántos req/s promedio y con un pico de 3×?',
        a: '≈ 1,157 y ≈ 11,574 req/s promedio; ≈ 3,500 y ≈ 35,000 en el pico. Regla: 1 M/día ≈ 11.6 req/s.' },
      { id: 'ref-numeros-03', kind: 'numero', q: 'Escalera de latencias: acceso a RAM, lectura aleatoria en NVMe, RTT en la misma AZ, entre AZs y entre continentes.',
        a: '≈ 100 ns · ≈ 50–100 µs · ≈ 0.1–0.5 ms · ≈ 0.4–2.5 ms (AWS: "un dígito de ms") · ≈ 70–250 ms. Física: ≥ 1 ms de RTT por cada 100 km de fibra.' },
      { id: 'ref-numeros-04', kind: 'numero', q: 'S3: latencia de un GET de objeto chico y requests por segundo por prefijo.',
        a: 'Mediana de decenas de ms; AWS habla de ≈ 100–200 ms "consistentes" y aconseja reintentar un GET chico a los 2 s: la cola puede llegar a segundos. Al menos 3,500 escrituras y 5,500 lecturas por segundo por prefijo, escalando de a poco (503 Slow Down mientras). Para un dígito de ms: S3 Express One Zone o una caché.' },
      { id: 'ref-numeros-05', kind: 'numero', q: '¿Cuánto pesa un embedding de 768 dimensiones, y 100 M de ellos?',
        a: '768 × 4 B = 3 KB en FP32 (1.5 KB en FP16, 768 B en INT8). 100 M → ≈ 307 GB en FP32 o ≈ 77 GB en INT8, sin contar el índice.' },
      { id: 'ref-numeros-06', kind: 'numero', q: 'Un segundo y una hora de audio PCM de 16 kHz, 16 bit, mono.',
        a: '16,000 × 2 B = 32 KB/s; ≈ 1.9 MB por minuto; ≈ 115 MB por hora.' },
      { id: 'ref-numeros-07', kind: 'numero', q: '¿Cuántos caracteres es un token, y cuánto pesa un token dentro de un LLM?',
        a: '≈ 4 caracteres de inglés (≈ ¾ de palabra); en español suelen salir más tokens por palabra: cuéntalos con el tokenizer. El texto pesa bytes; su KV cache en Llama 3 8B, 128 KiB. Lo caro es guardarlo, no transmitirlo.' },
      { id: 'ref-numeros-08', kind: 'trampa', q: 'Una foto de 12 MP pesa ≈ 3 MB en JPEG. ¿Cuánta RAM ocupa al decodificarla y cuánto CPU cuesta?',
        a: '4000 × 3000 × 3 B = 36 MB (120 MB a 40 MP), y ≈ 40–80 ms de decode en un vCPU (≈ 1.3–2× menos con draft mode, según el peso del archivo). Por eso el c01 limita tamaño, megapíxeles y requests en vuelo.' },
      { id: 'ref-numeros-09', kind: 'numero', q: 'Precios de transferencia en AWS: entre AZs, a internet y por NAT Gateway.',
        a: 'Entre AZs US$0.01/GB en cada sentido (US$0.02 ida y vuelta) · egress a internet ≈ US$0.09/GB (primeros 10 TB) · NAT US$0.045/GB procesado + US$0.045/h. En el c01, sin ruteo por zona, la transferencia entre AZs (≈ US$1,800/mes) costaría más que las dos GPUs.' },
      { id: 'ref-numeros-10', kind: 'numero', q: 'Llama 3 8B BF16 en una L4: cota del tiempo por token y del TTFT con un prompt de 2,000 tokens.',
        a: 'Por token ≳ 16 GB ÷ 300 GB/s ≈ 54 ms (≲ 19 tokens/s). TTFT ≳ 2 × 8 B × 2,000 ÷ 121 TFLOPS ≈ 0.27 s, más la cola. Son cotas: lo real es mayor.' },
      { id: 'ref-numeros-11', kind: 'numero', q: 'Red sostenida (baseline) de g4dn.xlarge, g6.xlarge y c6i.xlarge.',
        a: '5 Gb/s (ráfaga hasta 25) · 2.5 Gb/s (hasta 10) · 1.56 Gb/s (hasta 12.5). El tensor FP32 del c01 a 500 req/s son ≈ 2.4 Gb/s: por eso se revisa.' },
      { id: 'ref-numeros-12', kind: 'numero', q: 'S3 Standard, control plane de EKS y ALB: ¿cuánto cuestan?',
        a: 'S3 ≈ US$0.023/GB-mes · EKS US$0.10/h por cluster (≈ US$73/mes) · ALB US$0.0225/h + US$0.008 por LCU-hora (1 LCU = 1 GB/h procesado): en el c01, con ≈ 200 KB por imagen, ≈ US$500/mes, ≈ 30 % de la infra; con 15 % de originales web de ≈ 3 MB, ≈ US$1.5k.' },
      { id: 'ref-numeros-13', kind: 'concepto', q: 'Disponibilidad de componentes en serie y en paralelo.',
        a: 'Serie: el producto (tres al 99.9 % ≈ 99.7 %, ≈ 130 min/mes). Paralelo: 1 − ∏(1 − A), solo si las fallas son independientes (otra AZ, otro nodo): dos réplicas al 99 % ≈ 99.99 %.' },
      { id: 'ref-numeros-14', kind: 'trampa', q: 'Te piden 99.99 % para el servicio del caso 1. ¿Qué respondes?',
        a: 'Son ≈ 4 minutos al mes: nadie detecta, decide y revierte a mano en ese tiempo, y lo que está en serie (balanceador, cluster, zona) ya consume parte. Pregunto si el negocio lo necesita (el c01 tiene selector manual como fallback) y qué cuesta el nueve extra: failover automático en todo el camino.' },
      { id: 'ref-numeros-15', kind: 'frase', q: '¿Cómo das en inglés un número del que no estás seguro?',
        a: '"I don\'t have a reliable benchmark for this; my working assumption is around 1,200 images per second per T4, and I\'d confirm it with perf_analyzer before sizing the fleet."' },
      { id: 'ref-numeros-16', kind: 'frase', q: '¿Cómo conectas en inglés un número con una decisión?',
        a: '"Cross-AZ traffic costs a cent per gigabyte each way, and every request sends a 602 KB tensor, so zone-aware routing isn\'t optional here."' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'round-trip time (RTT)', es: 'tiempo de ida y vuelta', def: 'Lo que tarda un paquete en ir y volver entre dos máquinas. ≈ 0.1–0.5 ms en la misma AZ, ≈ 1 ms entre AZs y decenas a cientos de ms entre regiones; la física pone un piso de ≈ 1 ms por cada 100 km de fibra.', say: 'A round trip across the Atlantic is roughly 70 milliseconds, a third of our 200-millisecond budget.' },
      { en: 'nines of availability', es: 'nueves de disponibilidad', def: 'Forma de decir el objetivo de disponibilidad por su cantidad de nueves: "tres nueves" es 99.9 % (≈ 43 min de caída al mes). Cada nueve extra divide la caída permitida entre 10.', say: 'Each extra nine cuts the monthly downtime budget by ten, so I only add one if the business needs it.' },
      { en: 'time to first token (TTFT)', es: 'tiempo hasta el primer token', def: 'Latencia desde que llega el request hasta que el LLM devuelve el primer token: cola + prefill del prompt. Escala con los FLOPs del prefill.', say: 'Time to first token is dominated by prefill, so long prompts need more compute, not more bandwidth.' },
      { en: 'time per output token (TPOT)', es: 'tiempo por token de salida', def: 'Tiempo promedio entre tokens generados después del primero. En el decode lo fija el ancho de banda de memoria: ≥ bytes de pesos ÷ ancho de banda.', say: 'On an L4 the time per output token can\'t go much below 54 milliseconds, which is still faster than people read.' },
      { en: 'first-byte latency', es: 'latencia al primer byte', def: 'Tiempo hasta recibir el primer byte de la respuesta. En S3, mediana de decenas de ms para objetos chicos y ≈ 100–200 ms "consistentes" según AWS; la cola puede llegar a segundos (AWS aconseja reintentar a los 2 s).', say: 'S3 first-byte latency has a long tail, so I keep it out of the synchronous path.' },
      { en: 'egress', es: 'transferencia de salida', def: 'Datos que salen de la nube (o de una región) hacia internet u otra región; se cobran por GB (≈ US$0.09/GB a internet en AWS). Subir datos normalmente no se cobra.', say: 'Egress is cheap here because we only return a small JSON; the images come in, not out.' },
      { en: 'cross-AZ data transfer', es: 'transferencia entre zonas', def: 'Tráfico entre zonas de disponibilidad de una misma región: en AWS, US$0.01/GB en cada sentido. Con payloads grandes puede costar más que el cómputo.', say: 'With 602 KB per request, cross-AZ transfer would cost more than the GPUs, so we route within the zone.' },
      { en: 'NAT gateway', es: 'NAT gateway (puerta de enlace NAT)', def: 'Servicio que da salida a internet a subredes privadas. En AWS cobra por hora y por GB procesado (US$0.045 cada uno en us-east-1): bajar pesos grandes por ahí sale caro.', say: 'We pull model weights through an S3 gateway endpoint, not the NAT gateway, to avoid the per-GB charge.' },
      { en: 'Load Balancer Capacity Unit (LCU)', es: 'unidad de capacidad del balanceador', def: 'Unidad con la que AWS cobra un ALB por hora: se mide en la dimensión más alta entre conexiones nuevas, activas, bytes procesados (1 GB/h hacia targets de instancia o IP) y reglas.', say: 'Because images go through the ALB, processed bytes drive the LCU charge.' },
      { en: 'baseline network bandwidth', es: 'ancho de banda de red sostenido', def: 'Ancho de banda que una instancia mantiene de forma sostenida; las "hasta X Gb/s" solo lo superan en ráfagas. g4dn.xlarge: 5 Gb/s; c6i.xlarge: 1.56 Gb/s.', say: 'The instance says up to 12.5 gigabits, but its baseline is 1.56, and that is what I size for.' },
      { en: 'token', es: 'token', def: 'Unidad en la que un LLM lee y genera texto: ≈ 4 caracteres de inglés (≈ ¾ de palabra); en español suelen salir más tokens por palabra. Precios, contexto y latencia se miden en tokens.', say: 'A thousand words of English is roughly 1,300 tokens.' },
      { en: 'embedding', es: 'embedding (vector de representación)', def: 'Vector denso que representa un ítem (imagen, texto) para buscar por similitud. Pesa dimensiones × bytes: 768 dims en FP32 son 3 KB.', say: 'A hundred million 768-dimensional embeddings are about 300 GB in FP32, before the index.' },
      { en: 'on-demand instance', es: 'instancia on-demand', def: 'Instancia que pagas por hora (o segundo) sin compromiso. Es el precio de lista contra el que se miden Savings Plans, reservas y spot.', say: 'These are on-demand prices; a one-year Savings Plan on the baseline would cut them by roughly a third.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
