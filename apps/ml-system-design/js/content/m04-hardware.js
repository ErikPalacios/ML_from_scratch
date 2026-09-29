/* =============================================================================
   Ronda de Diseño ML — js/content/m04-hardware.js
   Módulo 04: hardware para inferencia. CPU vs GPU vs TPU vs edge, bytes por dtype,
   VRAM (pesos + activaciones + runtime + KV cache), roofline, T4/L4/A10G/A100/H100,
   costo por predicción, compartir una GPU (MIG, time-slicing, MPS) y Jetson.
   Contrato: docs/SPEC.md §5. Números del caso 1 idénticos a c01-clasificacion.js.
   Specs verificadas (sept. 2026) contra hojas de datos de NVIDIA, la hoja AWS/NVIDIA
   de la A10G y precios on-demand de us-east-1; cómputo SIEMPRE en denso.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Marca de estimación (SPEC §5.3): subrayado punteado + "est."
  const E = (s) => '<span class="est">' + s + '</span>';

  // ------------------------------------------------------------ diagramas
  // Nodo de inferencia en la nube: fila del host (y 8–16) y fila de la GPU (y 35–44).
  // Huecos de 8–12 unidades entre columnas para las etiquetas de las aristas; la vuelta
  // de los logits sube por x = 55 y cruza entre carriles por y = 24.5.
  const NODO = {
    width: 100, height: 50,
    lanes: [
      { id: 'host', label: 'Host: CPU y RAM de la instancia', x: 0, y: 0, w: 100, h: 23, kind: 'neutral' },
      { id: 'gpu', label: 'GPU: VRAM y cómputo', x: 0, y: 26, w: 100, h: 24, kind: 'online' },
    ],
    nodes: [
      { id: 'red', label: 'Red / cliente', sub: 'JPEG ≈ 200 KB', x: 2, y: 8, w: 16, h: 8, kind: 'client',
        note: 'Del cliente llega la imagen comprimida: en el <a href="#c01">caso 1</a>, una foto de celular de ≈ 150–250 KB. Un JPEG casi nunca satura la red; un tensor FP32 sí puede: en el c01 el gateway manda 602 KB por imagen a Triton y, al máximo de la T4, la NIC de la g4dn.xlarge limitaría antes que la GPU. También satura con video sin comprimir o muchos streams.' },
      { id: 'cpu', label: 'CPU del host', sub: 'decode y preproceso', x: 26, y: 8, w: 18, h: 8, kind: 'service',
        note: 'Decodificar el JPEG, rotar por EXIF, redimensionar y normalizar corre en CPU: en el c01 son ' + E('≈ 5–12 ms') + ' de p50 por imagen, más que el cómputo de la GPU. El c01 lo corre en otro tier (los pods del gateway, en c6i): escala con CPU barata, y una g4dn.xlarge solo trae 4 vCPU. Tener GPU no elimina la CPU del sistema de inferencia: la dimensionas aparte.' },
      { id: 'ram', label: 'RAM del host', sub: 'buffers del tensor', x: 52, y: 8, w: 18, h: 8, kind: 'store',
        note: 'El tensor preprocesado (3×224×224 en FP32 ≈ 602 KB) vive en la RAM de la instancia antes de copiarse a la GPU. Los model servers usan buffers "pinned" (fijados en memoria) para que la copia por DMA sea rápida.' },
      { id: 'pcie', label: 'Bus PCIe', sub: 'Gen3 x16 ≈ 16 GB/s (T4)', x: 78, y: 8, w: 20, h: 8, kind: 'edge',
        note: 'El cable entre el host y la GPU. La T4 usa PCIe Gen3 x16 (≈ 16 GB/s por sentido, teórico); la L4 y la A10G, Gen4 x16 (NVIDIA publica 64 GB/s sumando ambos sentidos). Copiar 602 KB toma ' + E('decenas de µs') + ': irrelevante para una imagen, relevante si mueves video 4K sin comprimir o batches enormes por request.' },
      { id: 'vram', label: 'VRAM', sub: 'pesos, activaciones, KV', x: 78, y: 35, w: 20, h: 9, kind: 'store',
        note: 'La memoria propia de la GPU: GDDR6 en T4/L4/A10G (16–24 GB, 300–600 GB/s) o HBM en A100/H100 (40–80 GB, 1.5–3.35 TB/s). Guarda pesos, activaciones, workspace del runtime y, en LLMs, el KV cache. Su <b>capacidad</b> decide qué cabe; su <b>ancho de banda</b> decide qué tan rápido lo lees.' },
      { id: 'sm', label: 'Tensor cores / SMs', sub: 'FLOPs a tu dtype', x: 44, y: 35, w: 22, h: 9, kind: 'gpu',
        note: 'SM (streaming multiprocessor): cada bloque de cómputo de la GPU, con sus CUDA cores y tensor cores; una T4 tiene 40 y una H100, 114–132 según la versión. Aquí ocurren las multiplicaciones de matrices. Los tensor cores dan el cómputo alto en FP16/BF16/FP8/INT8; en FP32 puro trabajan los CUDA cores, mucho más lentos. El cómputo solo se aprovecha si la memoria le entrega datos a tiempo: esa es la idea del roofline (<a href="#m04.roofline">sección 5</a>).' },
      { id: 'sram', label: 'L2 y SRAM on-chip', sub: 'MBs, reuso de datos', x: 10, y: 35, w: 22, h: 9, kind: 'store',
        note: 'Memoria dentro del chip: pocos MB (caché L2, memoria compartida, registros) pero mucho más rápida que la VRAM. Un kernel eficiente trae un bloque de datos una vez y lo reutiliza muchas veces aquí. Cuánto reutilizas por byte traído es la intensidad aritmética.' },
    ],
    edges: [
      { from: 'red', to: 'cpu', kind: 'online', label: 'bytes' },
      { from: 'cpu', to: 'ram', kind: 'online', label: 'tensor' },
      { from: 'ram', to: 'pcie', kind: 'online', label: 'DMA' },
      { from: 'pcie', to: 'vram', kind: 'online', fromSide: 'b', toSide: 't', label: 'copia H2D' },
      { from: 'vram', to: 'sm', kind: 'online', fromSide: 'l', toSide: 'r', label: 'ancho de banda' },
      { from: 'sm', to: 'sram', kind: 'neutral', fromSide: 'l', toSide: 'r', bidir: true, label: 'reuso' },
      { from: 'sm', to: 'cpu', kind: 'online', dashed: true, fromSide: 't', toSide: 'b', via: [[55, 24.5], [35, 24.5]], label: 'logits 2 KB' },
    ],
    flows: [
      { id: 'request-cnn', label: 'Un request del caso 1 (T4)', steps: [
        { nodes: ['red', 'cpu'], edges: ['red>cpu'], text: 'Llega el JPEG. En el c01 lo decodifica y preprocesa la CPU de los pods del gateway (c6i, otro nodo): ' + E('≈ 5–12 ms') + ' de p50, el tramo más caro antes de tocar la GPU. Si el preproceso corre en el nodo de la GPU, es la CPU de este host.' },
        { nodes: ['red', 'cpu', 'ram', 'pcie', 'vram'], edges: ['red>cpu', 'cpu>ram', 'ram>pcie', 'pcie>vram'], text: 'El tensor FP32 de 602 KB llega a Triton por la red de la VPC (' + E('≈ 2–4 ms') + ' de p50 en el c01) y cruza PCIe hacia la VRAM: a ≈ 16 GB/s teóricos son ≈ 40 µs. Mover el tensor cuesta en la red, no en PCIe.' },
        { nodes: ['vram', 'sm', 'sram'], edges: ['vram>sm', 'sm>sram'], text: 'La GPU lee los pesos (≈ 51 MB en FP16) y las activaciones. Cada peso de una convolución se reutiliza en todo el mapa de activaciones: muchas FLOPs por byte, así que manda el cómputo. En el c01: ' + E('≈ 3–6 ms') + ' de p50.' },
        { nodes: ['sm', 'cpu'], edges: ['sm>cpu'], text: 'Vuelven 500 logits (500 × 4 B ≈ 2 KB, por PCIe y por la red) y el gateway calcula el top-5. El hardware que más pesó en este request fue la CPU del gateway, no la GPU.' },
      ] },
      { id: 'token-llm', label: 'Un token de un LLM (L4)', steps: [
        { nodes: ['vram', 'sm'], edges: ['vram>sm'], text: 'Para generar UN token, Llama 3 8B en BF16 lee sus ≈ 16 GB de pesos desde la VRAM. A 300 GB/s (L4) son ≈ 54 ms. El cómputo del token (≈ 16 GFLOPs) tardaría ≈ 0.13 ms. Manda la memoria: memory-bound.' },
        { nodes: ['vram', 'sm', 'sram'], edges: ['vram>sm', 'sm>sram'], text: 'Cada secuencia además lee su KV cache, que crece con cada token (128 KiB por token en Llama 3 8B). La VRAM que queda después de los pesos fija cuántas secuencias sirves a la vez.' },
        { nodes: ['sm', 'cpu'], edges: ['sm>cpu'], text: 'Sale un id de token: unos bytes. PCIe y CPU casi no participan; todo el costo quedó entre la VRAM y los tensor cores.' },
      ] },
    ],
  };

  // Jetson: CPU, GPU y DLA comparten la misma LPDDR5. Fila superior y = 5–12; memoria y = 26–34.
  // La arista del DLA baja por x = 83 y entra por la derecha de la memoria (nada a la derecha abajo).
  const JETSON = {
    width: 100, height: 40,
    lanes: [
      { id: 'soc', label: 'Módulo Jetson Orin (un solo SoC)', x: 0, y: 0, w: 100, h: 40, kind: 'neutral' },
    ],
    nodes: [
      { id: 'cam', label: 'Cámaras', sub: 'CSI, USB, GigE', x: 2, y: 5, w: 16, h: 7, kind: 'client',
        note: 'Los frames llegan directo al dispositivo: no hay red hacia la nube en el camino crítico. Con varias cámaras, el decode por hardware (NVDEC) y DeepStream evitan que la CPU se ahogue.' },
      { id: 'cpu', label: 'CPU Arm', sub: 'OS, tu app, ROS', x: 26, y: 5, w: 16, h: 7, kind: 'service',
        note: 'Linux (L4T, basado en Ubuntu), tu aplicación, el middleware (ROS, GStreamer) y lo que no corre en GPU. Todo eso consume la misma memoria que el modelo.' },
      { id: 'gpu', label: 'GPU (tensor cores)', sub: 'TensorRT, FP16/INT8', x: 48, y: 5, w: 20, h: 7, kind: 'gpu',
        note: 'GPU Ampere integrada (Orin) con tensor cores. Corre engines de TensorRT construidos para ESE módulo y ESA versión de JetPack.' },
      { id: 'dla', label: 'DLA', sub: 'capas CNN en INT8', x: 74, y: 5, w: 18, h: 7, kind: 'model',
        note: 'Deep Learning Accelerator: hardware de función fija para capas de CNN en INT8/FP16. Solo en Orin NX y AGX Orin (no en Orin Nano). Corre en paralelo con la GPU gastando menos energía; las capas que no soporta caen a la GPU. Mide si tu modelo gana algo.' },
      { id: 'mem', label: 'LPDDR5 compartida', sub: '4–64 GB · 34–205 GB/s', x: 30, y: 26, w: 40, h: 8, kind: 'store',
        note: 'Memoria unificada: CPU, GPU, DLA y los motores de video leen y escriben la misma RAM física. Ventaja: no hay copia por PCIe (zero-copy). Costo: el OS y tu app compiten con el modelo por capacidad y por ancho de banda (102 GB/s en un Orin NX, contra 300 GB/s exclusivos de una L4).' },
      { id: 'pwr', label: 'nvpmodel', sub: 'modo de energía', x: 4, y: 26, w: 18, h: 8, kind: 'monitor',
        note: 'Fija el modo de energía: tope de watts, clocks de CPU, GPU y memoria, cores activos. El mismo modelo da latencias distintas en 15 W y en MAXN. Si el disipador no alcanza, además hay thermal throttling.' },
    ],
    edges: [
      { from: 'cam', to: 'cpu', kind: 'online', label: 'frames' },
      { from: 'cpu', to: 'mem', kind: 'online', fromSide: 'b', toSide: 't', bidir: true },
      { from: 'gpu', to: 'mem', kind: 'online', fromSide: 'b', toSide: 't', bidir: true, label: 'zero-copy' },
      { from: 'dla', to: 'mem', kind: 'online', fromSide: 'b', toSide: 'r', via: [[83, 30]], bidir: true },
      { from: 'pwr', to: 'mem', kind: 'monitor', dashed: true, fromSide: 'r', toSide: 'l', label: 'clocks' },
    ],
    flows: [
      { id: 'frame-edge', label: 'Un frame en el Jetson', steps: [
        { nodes: ['cam', 'cpu'], edges: ['cam>cpu'], text: 'Llega un frame. Con DeepStream/GStreamer, el decode y el resize van a los motores de hardware, no a la CPU.' },
        { nodes: ['cpu', 'mem'], edges: ['cpu>mem'], text: 'El frame queda en la LPDDR5 compartida. No hay copia a una VRAM separada: la GPU lo lee del mismo buffer.' },
        { nodes: ['gpu', 'dla', 'mem'], edges: ['gpu>mem', 'dla>mem'], text: 'La GPU (y el DLA, si parte del modelo corre ahí) lee pesos y activaciones de la misma memoria que usa el OS. Si tu app crece en RAM, le quita espacio al modelo.' },
        { nodes: ['pwr', 'mem', 'gpu'], edges: ['pwr>mem'], text: 'El modo de energía decide los clocks. El benchmark que hiciste en MAXN con un ventilador de escritorio no es el de 15 W dentro de una caja sellada: mide en el modo y la carcasa de producción.' },
      ] },
    ],
  };

  // ------------------------------------------------------------ registro
  MSD.register({
    id: 'm04',
    kind: 'module',
    sections: [
      // ======================================================== 1
      {
        id: 'por-que-importa',
        title: 'Por qué el hardware es una decisión de diseño',
        titleEn: 'Why hardware is a design decision',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `En tu notebook, el hardware es un dato: la GPU que había. En producción es una decisión, y el entrevistador la escucha como tal: "¿por qué esa GPU?". Tiene tres consecuencias que ninguna optimización de software compensa del todo:` },
          { t: 'list', items: [
            `<b>Fija tu piso de latencia.</b> El batching y el autoscaling suben el throughput, no bajan el tiempo de una inferencia a batch 1. Si ResNet-50 tarda ${E('≈ 3–6 ms')} en la T4 del <a href="#c01">caso 1</a>, ese es el piso del tramo GPU. Si un LLM de 8B en BF16 en una L4 no puede pasar de ≈ 19 tokens/s por secuencia (lo calculas en la <a href="#m04.roofline">sección 5</a>), ni el batching ni más réplicas te dan 50: necesitas menos bytes por token (INT8 duplica el techo a ≈ 37; INT4 weight-only, ≈ 5.7 GB, lo lleva a ≈ 52), speculative decoding (<a href="#m14">M14</a>) u otra GPU con más ancho de banda.`,
            `<b>Fija el throughput por dólar.</b> Lo que pagas es la hora de GPU; lo que vendes es la predicción. Una GPU más cara que procesa 3× más puede salir más barata por predicción, o más cara si la dejas ociosa (<a href="#m04.costo-por-prediccion">sección 7</a>).`,
            `<b>Fija qué cabe.</b> Si pesos + activaciones + KV cache no caben en la memoria, no hay truco: cambias de GPU, cuantizas o partes el modelo entre varias GPUs.`,
          ] },
          { t: 'h3', text: 'Los tres números, más el precio' },
          { t: 'p', html: `De una hoja de datos de GPU, para inferencia te importan tres líneas. El resto (CUDA cores, RT cores, clocks) casi nunca decide nada en la entrevista.` },
          { t: 'kv', items: [
            ['Capacidad de memoria', 'GB de VRAM', '¿Caben pesos + activaciones + runtime + KV cache? Decide si el modelo corre, no qué tan rápido.'],
            ['Ancho de banda de memoria', 'GB/s', 'Bytes por segundo de la VRAM a los núcleos. Manda en el decode de LLMs y en capas que reutilizan poco cada byte.'],
            ['Cómputo a tu dtype', 'TFLOPS / TOPS densos', 'Operaciones por segundo con tensor cores en FP16, BF16, FP8 o INT8. Manda en CNNs y en el prefill de LLMs a batch moderado.'],
            ['Precio', 'US$ por GPU-hora', 'Convierte los otros tres en costo por predicción, junto con la utilización real.'],
          ] },
          { t: 'table', caption: 'Qué número responde qué pregunta', head: ['Pregunta de diseño', 'Número que manda', 'Ejemplo'], rows: [
            ['¿Cabe Llama 3 70B en una GPU?', 'Capacidad', '≈ 141 GB en BF16 contra 80 GB de una H100: no cabe (<a href="#m04.bytes-dtype">sección 3</a>)'],
            ['¿Cuántos tokens/s da un LLM de 8B a batch 1?', 'Ancho de banda', 'L4: 300 GB/s ÷ ≈ 16 GB de pesos ≈ 19 tokens/s como techo teórico (<a href="#m04.roofline">sección 5</a>)'],
            ['¿Cuántas img/s da ResNet-50 con batches de 32?', 'Cómputo (y medirlo)', `Se mide con perf_analyzer; el c01 supone ${E('≈ 1,200 img/s')} en una T4`],
            ['¿T4 o L4 para el caso 1?', 'Precio × utilización real', 'Con N+1 y ≈ 5 % de carga promedio, gana la hora más barata (<a href="#m04.costo-por-prediccion">sección 7</a>)'],
          ] },
          { t: 'p', html: `El diagrama muestra dónde vive cada número en un nodo de inferencia real. Recorre los dos flujos: el mismo hardware se comporta distinto con una CNN que con un LLM.` },
          { t: 'diagram', id: 'nodo-inferencia', title: 'Anatomía de un nodo de inferencia', caption: 'Arriba, la instancia (CPU y RAM); abajo, la GPU. Toca cada caja para ver qué número la describe. Los dos recorridos muestran por qué una CNN y un LLM se limitan en lugares distintos.', spec: NODO },
          { t: 'callout', kind: 'why', html: `<p>El entrevistador no evalúa si conoces el catálogo de NVIDIA. Evalúa si eliges con un criterio que puedas defender con números: "el modelo pesa 51 MB y la carga promedio es 5 % de una T4, así que manda el costo por hora" es una decisión; "usaría una A100 porque es potente" es una marca.</p>` },
          { t: 'callout', kind: 'trap', title: 'La GPU "más potente" por defecto', html: `<p>Decir H100 para un ResNet-50 a 500 req/s: pagas ${E('≈ US$6.88/h')} por una GPU que, con esa carga, estaría casi vacía, contra ${E('≈ US$0.53/h')} de una T4 (≈ 13× más). El entrevistador anota "no dimensiona". Empieza por la GPU más chica que cumple el SLO y justifica cada salto con un número.</p>` },
          { t: 'callout', kind: 'connect', html: `<p><b>Cuántas</b> GPUs (pico de diseño, capacidad medida, utilización objetivo, N+1) es de <a href="#m03.cuantas-gpus">M3</a>. Aquí decides <b>cuál</b>. El <a href="#c01.serving">caso 1</a> eligió T4 por costo; este módulo te da las herramientas para rehacer esa decisión con otra carga u otro modelo. En <a href="#m01.estimaciones-express">M1</a> viste que pesos ≠ VRAM; aquí haces la cuenta completa.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"Before picking the hardware, let me check which constraint actually binds: memory capacity, memory bandwidth, compute, or cost. For a 25-million-parameter CNN at this load, it's cost — so I'd start with the cheapest GPU that meets the latency target."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'cpu-gpu-tpu',
        title: 'CPU vs GPU vs TPU vs aceleradores',
        titleEn: 'CPU vs GPU vs TPU vs accelerators',
        priority: 'core',
        dims: ['tradeoffs', 'arquitectura'],
        blocks: [
          { t: 'p', html: `La primera decisión no es qué GPU, sino si necesitas una. Esta tabla describe el caso típico de cada familia; en tu modelo, mides.` },
          { t: 'table', caption: 'Familias de hardware para inferencia', head: ['', 'CPU', 'GPU (NVIDIA)', 'TPU (Google Cloud)', 'AWS Inferentia / Trainium', 'Edge (Jetson, Coral, Hailo, NPU)'], rows: [
            ['Paralelismo', 'Decenas de cores con SIMD (AVX-512, AMX)', 'Miles de cores + tensor cores', 'Unidades de matrices grandes (MXU)', 'NeuronCores con motores de tensores', 'Desde un acelerador INT8 fijo hasta una GPU pequeña'],
            ['Memoria', 'RAM del host: mucha y barata, ancho de banda bajo', 'VRAM propia: 16–80 GB y 300–3,350 GB/s en las GPUs de este módulo', 'HBM por chip; se escala uniendo chips', 'HBM por chip', 'Compartida con la CPU (Jetson) o pequeña en el chip (Coral, Hailo)'],
            ['Latencia a batch 1', 'Buena en modelos chicos; crece rápido con el tamaño', 'Buena; algo de overhead por lanzar kernels y copiar por PCIe', 'Pensada para batch; compila formas fijas', 'Buena, tras compilar el modelo', 'Sin red de por medio: la latencia total puede ser la menor'],
            ['Throughput', 'Bajo por core; escala con más cores', 'El más alto por nodo en modelos densos', 'Muy alto a batch grande', 'Alto en modelos soportados', 'Limitado por los watts'],
            ['Costo', 'El más bajo por hora; no agrega un tier', `${E('≈ US$0.5–7 por GPU-hora')} en AWS (<a href="#m04.gpus-nvidia">sección 6</a>)`, 'Competitivo, pero solo en GCP', 'AWS lo posiciona como más barato por inferencia: compruébalo con tu modelo', 'Compras el hardware y operas una flota'],
            ['Ecosistema', 'ONNX Runtime, OpenVINO, cualquier framework', 'CUDA, TensorRT, Triton, vLLM: el más maduro', 'XLA: JAX, TensorFlow, PyTorch/XLA', 'Neuron SDK: compilas tu modelo para el chip', 'JetPack/TensorRT, LiteRT (TFLite), Core ML, SDK de Hailo'],
            ['Cuándo', 'Modelos chicos, tabular/GBDT, QPS bajo, preprocesamiento', 'Default para CNNs medianas y LLMs en la nube', 'Ya estás en GCP y tu stack compila bien a XLA', 'Ya estás en AWS, el volumen es alto y tu modelo está soportado', 'Sin red confiable, privacidad o latencia de pocos ms (<a href="#c03">c03</a>)'],
          ] },
          { t: 'h3', text: 'La CPU es una respuesta legítima' },
          { t: 'p', html: `El reflejo de quien viene de entrenar es "deep learning = GPU". En serving, la CPU gana más seguido de lo que parece:` },
          { t: 'list', items: [
            `<b>Tabular y árboles (XGBoost, LightGBM).</b> Se sirven en CPU casi siempre. Una GPU rara vez se justifica, salvo volúmenes enormes (Triton tiene un backend para árboles, FIL, justo para ese caso).`,
            `<b>CNNs chicas o QPS bajo.</b> A 5 req/s, un ResNet-50 en CPU con ONNX Runtime tarda ${E('decenas de ms')} por imagen y cabe en un par de cores (el ejemplo de <a href="#m01.de-modelo-a-sistema">M1</a>).`,
            `<b>Preprocesamiento.</b> Decode, EXIF, resize: en el c01 son ${E('≈ 6 ms de CPU por imagen')} aunque la inferencia vaya en GPU. La CPU siempre está en tu sistema de inferencia; la pregunta es si también hace el modelo.`,
            `<b>INT8 en CPUs modernas.</b> Las instrucciones VNNI (AVX-512, desde Cascade Lake; en AWS, las c6i) y AMX (desde Sapphire Rapids; las c7i) aceleran INT8 y reducen mucho la distancia con una GPU chica en modelos de este tamaño. Cuánto, se mide.`,
          ] },
          { t: 'calc', title: '¿Sin GPU en el caso 1? (números del c01)', rows: [
            { label: 'ResNet-50 FP32 en CPU', expr: '500 × ' + E('≈ 40–80 ms') + ' por imagen por vCPU', value: '≈ 20–40 vCPU ocupados en el pico' },
            { label: 'ResNet-50 INT8 (ONNX Runtime u OpenVINO)', expr: '500 × ' + E('≈ 8–25 ms') + ' / 0.6', value: E('≈ 7–21 vCPU en el pico') },
            { label: 'Contra', expr: '2 × g4dn.xlarge', value: E('≈ US$768/mes') },
          ], result: 'En FP32 gana la T4. En INT8, CPU-only puede costar igual o menos y elimina un tier entero (sin engine atado a una GPU, sin cold start de nodos GPU). No hay benchmark confiable para tu stack: se mide en la semana 1.' },
          { t: 'h3', text: 'GPU: el default, con costo fijo' },
          { t: 'p', html: `Una GPU NVIDIA es el default razonable para CNNs medianas y para LLMs: tensor cores, el ecosistema más maduro (TensorRT, Triton, vLLM) y disponibilidad en todas las nubes. Su costo es fijo por hora: rinde cuando la mantienes ocupada (batching, varios modelos) y se desperdicia cuando no. Por eso la conversación de GPU casi siempre termina en utilización.` },
          { t: 'h3', text: 'TPU: solo en Google Cloud' },
          { t: 'p', html: `Las TPUs son chips de Google para matrices grandes, disponibles solo en GCP. Se programan a través del compilador XLA (JAX, TensorFlow, PyTorch/XLA), que compila formas estáticas: el preprocesamiento y el postprocesamiento siguen en CPU, y los tamaños de batch o de secuencia variables se manejan con buckets. Rinden muy bien a batch grande y en LLMs. Generaciones recientes: v5e, v6e (Trillium) e Ironwood, anunciada en 2025 con foco en inferencia; la disponibilidad cambia por región: verifícala. El costo real es el <b>lock-in</b>: tu serving queda atado a GCP y a XLA.` },
          { t: 'h3', text: 'AWS Inferentia y Trainium' },
          { t: 'p', html: `Chips propios de AWS: Inferentia2 (instancias inf2) para inferencia y Trainium (trn1, trn2) para training, que también sirve modelos. Compilas el modelo con el Neuron SDK; no toda arquitectura ni todo operador está soportado, y quedas atado a AWS. AWS los vende como más baratos por inferencia que las GPUs equivalentes: tómalo como hipótesis y compara costo por 1,000 predicciones con tu modelo.` },
          { t: 'callout', kind: 'skip', html: `<p>No estudies internals de TPU (arrays sistólicos, topologías de pods), el compilador de Neuron ni chips como Groq, Cerebras o Gaudi, salvo que la empresa a la que aplicas los use. En la entrevista basta con saber que existen, qué lock-in traen y que se deciden con un benchmark de costo por predicción.</p>` },
          { t: 'h3', text: 'Aceleradores edge' },
          { t: 'p', html: `Jetson (una GPU NVIDIA integrada con CPU Arm), Coral Edge TPU, Hailo y las NPUs de los teléfonos corren el modelo donde está el dato. Se eligen por watts, por software y por operación de flota más que por TFLOPS: <a href="#m04.edge-jetson">sección 9</a> y, para la operación, <a href="#m02.edge">M2</a>.` },
          { t: 'callout', kind: 'trap', title: 'GPU por reflejo', html: `<p>Antes de elegir GPU, di en voz alta tres números: QPS de diseño, tamaño del modelo y presupuesto de latencia. Si el QPS es bajo y el modelo es chico, la pregunta obligatoria es "¿por qué no CPU?". El <a href="#c01.tradeoffs">caso 1</a> la contesta con números y deja abierto medir INT8 en CPU.</p>` },
          { t: 'followups', items: [
            { q: '¿Por qué no sirves el modelo en CPU?',
              junior: 'Porque la GPU es mucho más rápida para deep learning.',
              senior: 'A 500 req/s con ResNet-50 en FP32 serían ≈ 20–40 vCPU ocupados en el pico, así que parto de una T4 con TensorRT FP16. Pero la carga promedio es ≈ 5 % de esa GPU, así que en la primera semana mido INT8 en una c7i: si da ≈ 15 ms por imagen por vCPU sin perder más de 0.5 pp en el golden set, CPU-only suma ≈ US$125–250/mes de CPU contra ≈ US$768 de las dos T4 (cuentas del c01) y me ahorro el tier GPU.',
              why: 'Convierte "más rápida" en costo y en operación, y deja una prueba concreta que cambiaría la decisión.' },
            { q: 'Estamos en GCP. ¿Usarías TPUs?',
              junior: 'Sí, las TPUs son más rápidas que las GPUs.',
              senior: 'Depende de tres cosas: que el modelo compile bien con XLA (formas estáticas; pre y postproceso siguen en CPU), que el volumen justifique el port y el lock-in, y que haya capacidad en la región. Para un ResNet-50 a 500 req/s me quedo con una GPU chica: el equipo ya conoce el stack y el costo absoluto es bajo. Para un LLM propio a gran escala sí haría un benchmark de costo por token TPU contra H100.',
              why: 'No compara chips en abstracto: compara costo total, incluidos port, lock-in y operación.' },
          ] },
        ],
      },

      // ======================================================== 3
      {
        id: 'bytes-dtype',
        title: 'Bytes por dtype y cuánto pesa un modelo',
        titleEn: 'Bytes per dtype and model size',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'p', html: `Empieza por el número: ResNet-50 tiene 25.6 M parámetros. En FP32 cada uno ocupa 4 bytes: 25.6 M × 4 B ≈ 102 MB. En FP16, la mitad: ≈ 51 MB. Toda la aritmética de memoria de este módulo es esa multiplicación, con el dtype correcto.` },
          { t: 'table', caption: 'Los dtypes que vas a nombrar', head: ['dtype', 'Bytes', 'Qué guarda', 'Tensor cores desde', 'Uso típico en inferencia'], rows: [
            ['FP32', '4', '8 bits de exponente y 23 de mantisa: rango y precisión amplios', 'Sin tensor cores: corre en CUDA cores (T4: 8.1 TFLOPS)', 'Referencia: el modelo contra el que haces el parity test'],
            ['TF32', '4 en memoria', 'Modo de cómputo: el tensor core usa el rango de FP32 con 10 bits de mantisa; los tensores se guardan como FP32', 'Ampere (A10G, A100) y posteriores; no T4', 'Acelera matmuls "FP32" sin tocar código; no ahorra memoria'],
            ['FP16', '2', '5 bits de exponente y 10 de mantisa: buena precisión, rango hasta 65,504', 'Volta/Turing (T4 incluida)', 'La elección habitual para CNNs con TensorRT (c01: engine FP16)'],
            ['BF16', '2', '8 bits de exponente (el rango de FP32) y 7 de mantisa', 'Ampere en adelante; <b>no</b> T4', 'El default de los LLMs: se entrenan y se sirven en BF16'],
            ['FP8', '1', 'Dos formatos: E4M3 (más precisión) y E5M2 (más rango), con escalas', 'Ada (L4, L40S) y Hopper (H100); no A100 ni A10G', 'LLMs: pesos, activaciones o KV cache, con pérdida pequeña si se calibra'],
            ['INT8', '1', 'Enteros con una escala por tensor o por canal', 'Turing (T4); también CPUs con VNNI/AMX', 'CNNs con calibración post-training (PTQ) o quantization-aware training (QAT); pesos de LLMs'],
            ['INT4', '0.5', 'Enteros de 4 bits con una escala por grupo (p. ej. cada 128 pesos)', 'La T4 lo acelera (260 TOPS); en LLMs casi siempre es weight-only: se descuantiza al vuelo', 'LLMs grandes en GPUs chicas (AWQ, GPTQ) y edge'],
          ], note: 'Blackwell (B200) agrega FP4 en tensor cores. PTQ vs QAT, calibración y qué se rompe al cuantizar: <a href="#m08">M8</a>.' },
          { t: 'callout', kind: 'why', title: 'Por qué BF16 le ganó a FP16 en LLMs', html: `<p>FP16 tiene más mantisa que BF16, pero su máximo es 65,504. Las activaciones de un transformer tienen outliers que pueden pasar ese valor: en FP16 se vuelven <code>inf</code> y luego NaN. BF16 tiene el mismo rango que FP32, así que un modelo entrenado en BF16 se sirve en BF16 sin sorpresas; pierde precisión, que las redes toleran bien. Consecuencia práctica: la T4 no tiene BF16. Servir ahí un LLM entrenado en BF16 te obliga a FP16 (riesgo de overflow: pruébalo con tu golden set) o a FP32 (el doble de memoria y sin tensor cores). Es una de las razones por las que la T4 quedó para CV.</p>` },
          { t: 'h3', text: 'Cuánto pesan modelos que vas a nombrar' },
          { t: 'calc', title: 'Pesos = parámetros × bytes por parámetro', rows: [
            { label: 'ResNet-50', expr: '25.6 M × 4 B · 25.6 M × 2 B', value: '≈ 102 MB FP32 · ≈ 51 MB FP16' },
            { label: 'YOLOv8m (detección)', expr: '25.9 M × 2 B', value: '≈ 52 MB FP16', note: 'Del tamaño de ResNet-50: en detección lo que crece con la resolución son las activaciones (<a href="#m04.vram">sección 4</a>)' },
            { label: 'ViT-B/16', expr: '≈ 86 M × 2 B', value: '≈ 172 MB FP16' },
            { label: 'Llama 3 8B en BF16', expr: '8.03 B × 2 B', value: '≈ 16 GB' },
            { label: 'Llama 3 8B en INT8', expr: '8.03 B × 1 B', value: '≈ 8 GB' },
            { label: 'Llama 3 8B en INT4', expr: '8.03 B × 0.5 B + escalas por grupo + embeddings en 16 bits', value: E('≈ 4–6 GB'), note: 'Teórico ≈ 4 GB. Muchos formatos dejan embeddings y lm_head (≈ 1 B params) en BF16: ≈ 5.7 GB' },
            { label: 'Llama 3 70B en BF16', expr: '70.6 B × 2 B', value: '≈ 141 GB' },
            { label: 'Llama 3 70B en INT4', expr: '70.6 B × 0.5 B', value: '≈ 35 GB + overhead' },
          ], result: 'Una CNN pesa decenas o cientos de MB: en una GPU de 16 GB la memoria casi nunca es tu problema. Un LLM pesa decenas de GB: la memoria decide qué GPU, cuántas y con qué dtype.' },
          { t: 'p', html: `Decisión con el último número: Llama 3 70B en BF16 (≈ 141 GB) no cabe en una H100 de 80 GB. Tres salidas: partirlo entre 2 o más GPUs (tensor parallelism, que rinde mucho mejor con NVLink entre ellas); cuantizarlo a INT8 (≈ 71 GB: cabe justo en 80 GB, casi sin lugar para KV cache); o a INT4 (≈ 35–40 GB: deja margen). Ni siquiera una H200 de 141 GB lo aloja en BF16 con KV cache: los pesos solos llenan la memoria. Y Llama 3 8B en FP16 (≈ 16 GB) tampoco entra en una T4 de 16 GB con su runtime.` },
          { t: 'callout', kind: 'trap', title: 'Parámetros no son bytes (ni la hoja de datos es lo usable)', html: `<ul><li>"8B" son 8 mil millones de <b>parámetros</b>: en BF16 son ≈ 16 GB, no 8.</li><li>Lo usable no es lo de la hoja de datos, y no por GB vs GiB: en T4, L4 y A10G el ECC (activo por defecto) reserva ≈ 6 %, así que <code>nvidia-smi</code> muestra 15,360 MiB (≈ 15 GiB) en la T4 y ≈ 23,030 MiB (≈ 22.5 GiB) en la L4 o la A10G; una H100 de "80 GB" muestra 81,559 MiB (≈ 79.6 GiB). <code>nvidia-smi</code> y PyTorch reportan MiB/GiB (1 GiB ≈ 1.074 GB): usa el total que reporta tu GPU y no mezcles GB y GiB dentro de una misma cuenta.</li><li>Contar solo los pesos: la VRAM real suma activaciones, runtime y, en LLMs, KV cache. Es la siguiente sección.</li></ul>` },
          { t: 'callout', kind: 'connect', html: `<p>La tabla de bytes de <a href="#m01.estimaciones-express">M1</a> tenía FP32, FP16/BF16 e INT8; aquí agregaste TF32, FP8 e INT4 y qué GPU soporta cada uno. Cómo cuantizar sin romper el modelo (y cómo probarlo) está en <a href="#m08">M8</a>; qué dtype elegir para un LLM en producción, en <a href="#m14">M14</a>.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'vram',
        title: 'Cálculo de VRAM paso a paso',
        titleEn: 'Estimating GPU memory step by step',
        priority: 'core',
        dims: ['estimaciones'],
        blocks: [
          { t: 'p', html: `Empieza por un número: los pesos de ResNet-50 en FP16 son ≈ 51 MB, pero con Triton cargado y dos instancias del modelo la T4 del caso 1 muestra ${E('del orden de 1–3 GB')} ocupados en <code>nvidia-smi</code>. Lo que falta son activaciones, runtime y lo que se duplica por instancia. La fórmula que vas a usar en todos los casos:` },
          { t: 'p', html: `<code>VRAM ≈ pesos + activaciones/workspace + overhead del runtime + KV cache (LLMs) + margen</code>` },
          { t: 'table', caption: 'Qué ocupa la memoria de la GPU', head: ['Componente', 'De qué depende', 'Orden de magnitud', 'Cómo lo mides'], rows: [
            ['Pesos', 'params × bytes del dtype; más copias si cargas el modelo en varios procesos', 'MB (CNN) a decenas de GB (LLM)', 'Tamaño del engine o del checkpoint'],
            ['Activaciones y workspace', 'batch × resolución (CNN) o tokens en el batch (LLM); el runtime reutiliza buffers entre capas', 'Cientos de MB a varios GB', '<code>torch.cuda.max_memory_allocated</code>, logs de TensorRT'],
            ['Overhead del runtime', 'Contexto CUDA, cuDNN/cuBLAS/TensorRT, allocator de PyTorch, fragmentación', E('≈ 0.3–1 GB por proceso'), '<code>nvidia-smi</code> con el modelo cargado y sin tráfico'],
            ['KV cache (solo LLMs)', 'capas × KV heads × head_dim × 2 (K y V) × bytes × tokens vivos', 'GB: suele ser lo que limita la concurrencia', 'Métricas del servidor (en vLLM, uso del KV cache)'],
            ['Margen', 'Picos, fragmentación, dos versiones cargadas durante un deploy', E('≈ 10–20 %'), 'Planificación'],
          ] },
          { t: 'h3', text: 'Ejemplo A: el caso 1 en una T4 de 16 GB' },
          { t: 'calc', title: 'Qué ocupa una T4 de 16 GB (mismos números que el c01)', rows: [
            { label: 'Pesos FP16', expr: '25.6 M × 2 B', value: '≈ 51 MB' },
            { label: 'Engine TensorRT (pesos + tácticas elegidas)', expr: '', value: E('≈ 50–150 MB') },
            { label: 'Activaciones + scratch a batch 32 (TensorRT reutiliza memoria)', expr: '', value: E('≈ 0.2–0.5 GB') },
            { label: 'Buffer de entrada a batch 32', expr: '32 × 602 KB', value: '≈ 19 MB' },
            { label: 'Contexto CUDA + librerías (TensorRT, cuBLAS, cuDNN)', expr: '', value: E('≈ 0.3–0.8 GB') },
            { label: '2 instancias del modelo (instance_group count 2)', expr: 'contexto de ejecución duplicado', value: E('≈ 1–3 GB en total') },
          ], result: 'Unos pocos GB de 16 GB: <b>la VRAM no es la restricción</b>. Sobra lugar para alojar en el mismo Triton los modelos de otros equipos (<a href="#m04.compartir-gpu">sección 8</a>). Confírmalo con <code>nv_gpu_memory_used_bytes</code> una vez desplegado.' },
          { t: 'h3', text: 'Ejemplo B: un detector a alta resolución' },
          { t: 'p', html: `YOLOv8m pesa ≈ 52 MB en FP16, lo mismo que ResNet-50. Pero en detección subes la resolución para ver objetos chicos, y las activaciones escalan con <b>batch × alto × ancho</b>: 1280 px en vez de 640 px son (1280 / 640)² = 4× los píxeles. El valor base depende del modelo y del runtime, así que la cuenta arranca de una medición:` },
          { t: 'calc', title: 'Activaciones de un detector (valor base ilustrativo: mídelo)', rows: [
            { label: 'Pico de activaciones medido a 640 px, batch 1', expr: 'torch.cuda.max_memory_allocated (supuesto para el ejemplo)', value: E('A ≈ 100 MB'), note: 'Número ilustrativo, no un benchmark: el real depende del modelo, del dtype y de cuánto reutiliza buffers el runtime' },
            { label: '1280 px, batch 1', expr: 'A × (1280/640)² = A × 4', value: E('≈ 0.4 GB') },
            { label: '1280 px, batch 8', expr: 'A × 4 × 8 = A × 32', value: E('≈ 3.2 GB') },
            { label: '1280 px, batch 32', expr: 'A × 4 × 32 = A × 128', value: E('≈ 12.8 GB'), note: 'Ya no entra en una T4 junto con contexto, instancias y margen' },
          ], result: 'Los pesos no cambiaron y la memoria creció 128×. En CV, el batch máximo que cabe lo fijan las activaciones; el que te conviene lo fija la latencia (<a href="#m03.batching">M3</a>).' },
          { t: 'callout', kind: 'trap', title: 'Medir la memoria de inferencia con el modelo en modo training', html: `<p>Sin <code>torch.inference_mode()</code> (o <code>no_grad</code>), autograd guarda las activaciones de cada capa para un backward que nunca llega: la memoria se multiplica y concluyes que necesitas una GPU más grande. Segundo error clásico: leer <code>nvidia-smi</code> y creer que todo es del modelo. Ahí ves lo que <i>reservó</i> el allocator de PyTorch más el contexto CUDA; <code>max_memory_allocated</code> ve solo los tensores. Mira los dos.</p>` },
          { t: 'code', title: 'Medir la memoria en lugar de adivinarla', files: [
            { name: 'medir_vram.py', lang: 'python', code: `import torch

model = model.eval().half().cuda()          # tu detector ya cargado
for bs in (1, 8, 32):
    torch.cuda.reset_peak_memory_stats()
    x = torch.randn(bs, 3, 1280, 1280, device="cuda", dtype=torch.half)
    with torch.inference_mode():            # sin esto, autograd guarda activaciones
        model(x)
    torch.cuda.synchronize()
    pico = torch.cuda.max_memory_allocated() / 2**20      # solo tensores
    reservado = torch.cuda.memory_reserved() / 2**20      # lo que tomó el allocator
    print(f"batch {bs}: pico {pico:.0f} MiB, reservado {reservado:.0f} MiB")` },
            { name: 'nvidia-smi.sh', lang: 'bash', code: `# Memoria por proceso: incluye el contexto CUDA y lo reservado por el allocator
nvidia-smi --query-compute-apps=pid,used_memory --format=csv

# Cada segundo: memoria usada y total, y utilización de la GPU
nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu --format=csv -l 1` },
          ] },
          { t: 'h3', text: 'Ejemplo C: Llama 3 8B en una L4 de 24 GB' },
          { t: 'p', html: `Aquí aparece el término que las CNNs no tienen: el <b>KV cache</b>. Al generar texto, el modelo guarda las keys y values de cada token anterior para no recalcularlas; ocupan memoria por cada token de cada secuencia viva. La arquitectura de Llama 3 8B (de su config pública): 32 capas, 32 heads de query pero solo <b>8 heads de KV</b> (grouped-query attention, GQA), head_dim = 4096 / 32 = 128, contexto de 8,192 tokens.` },
          { t: 'calc', title: 'KV cache por token y por secuencia', rows: [
            { label: 'Por token', expr: '2 (K y V) × 32 capas × 8 KV heads × 128 dims × 2 B (BF16)', value: '131,072 B = 128 KiB' },
            { label: 'Una secuencia de 8,192 tokens', expr: '128 KiB × 8,192', value: '1 GiB (≈ 1.07 GB)' },
            { label: 'Sin GQA (32 KV heads)', expr: '× 4', value: '512 KiB por token: 4 GiB por secuencia de 8k' },
            { label: 'Llama 3 70B, por token', expr: '2 × 80 capas × 8 KV heads × 128 × 2 B', value: '320 KiB' },
          ], result: 'Cada conversación larga de Llama 3 8B ocupa ≈ 1 GB de VRAM solo en KV cache. GQA es lo que lo hace manejable: sin ella serían 4 GB.' },
          { t: 'calc', title: 'Presupuesto de la L4', rows: [
            { label: 'VRAM nominal', expr: 'hoja de datos', value: '24 GB' },
            { label: 'Pesos BF16', expr: '8.03 B × 2 B', value: '≈ 16.1 GB' },
            { label: 'Runtime + activaciones del prefill + buffers', expr: '', value: E('≈ 1.5–2.5 GB') },
            { label: 'Queda para KV cache, sin margen', expr: '24 − 16.1 − (1.5 a 2.5)', value: E('≈ 5.5–6.5 GB'), note: 'Cota superior: no descuenta el margen de la fórmula' },
            { label: 'Con gpu_memory_utilization = 0.9 (el default de vLLM hasta v0.19; desde v0.20 es 0.92, ≈ 0.5 GB más)', expr: '0.9 × 24 − 16.1 − (1.5 a 2.5)', value: E('≈ 3–4 GB'), note: 'El 10 % que vLLM deja libre es el margen' },
            { label: 'Secuencias de 8k tokens a la vez', expr: '(3 a 4 GB) ÷ 1.07 GB', value: E('≈ 3–4'), note: '≈ 5–6 sin margen' },
            { label: 'Si el promedio es 2k tokens (prompt + respuesta)', expr: '(3 a 4 GB) ÷ 0.27 GB', value: E('≈ 11–15') },
          ], result: 'La L4 tiene cómputo de sobra (≈ 121 TFLOPS densos) y aun así atiende ≈ 3–4 conversaciones largas a la vez: <b>el KV cache, no el cómputo, limita la concurrencia de un LLM</b>.' },
          { t: 'p', html: `En la práctica, vLLM reserva por defecto ≈ 90 % de la VRAM (<code>gpu_memory_utilization</code>: 0.9 hasta v0.19, 0.92 desde v0.20), carga los pesos y convierte lo que sobra en bloques de KV cache (PagedAttention); al arrancar reporta cuántos bloques obtuvo, que es tu concurrencia real. En la L4 verás ≈ 3–4 secuencias de 8k, no 5–6: la cuenta sin margen no descontaba ese 10 %. Con Llama 3.1 8B (misma arquitectura, contexto de 128k), una sola secuencia de 128k tokens ocupa 16 GiB de KV cache: no entra en la L4 junto a los pesos. En una H100 de 80 GB, con el mismo 90 %, quedan ≈ 72 − 16 − 2 ≈ 54 GB: ≈ 3 secuencias de 128k (17.2 GB cada una). Palancas: limitar el contexto máximo, KV cache en FP8 (la mitad), pesos en INT8/INT4 (liberan GB para KV) o una GPU con más memoria. Se desarrolla en <a href="#m14">M14</a> y en el <a href="#c10">caso 10</a>.` },
          { t: 'callout', kind: 'senior', html: `<p>Haz la cuenta del KV cache sin que te la pidan: "8B en BF16 son 16 GB de pesos; en una L4 de 24 GB, con el 10 % de margen que deja vLLM, me quedan ≈ 3–4 GB para KV cache; a 128 KiB por token, eso son ≈ 3–4 conversaciones de 8k a la vez. Si el negocio necesita 50 concurrentes, necesito ≈ 13–17 L4, o menos bytes por token, o GPUs de 80 GB". Esa frase une memoria, concurrencia y costo, que es exactamente lo que evalúa un caso de LLM.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>La memoria de <b>training</b> (gradientes y estados del optimizador: ≈ 16 bytes por parámetro con Adam en precisión mixta, según el paper de ZeRO de Rajbhandari et al., 2020; ≈ 128 GB para 8B sin contar activaciones) no hace falta en una entrevista de inferencia. Apréndela solo si aplicas a un equipo de training de modelos grandes.</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'roofline',
        title: 'Compute-bound vs memory-bound: la intuición del roofline',
        titleEn: 'Compute-bound vs memory-bound: roofline intuition',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Un número primero. La T4 hace 65 TFLOPS en FP16 con tensor cores y lee su VRAM a 320 GB/s. Divide: 65 × 10<sup>12</sup> / 320 × 10<sup>9</sup> ≈ <b>200 FLOPs por byte</b>. Significa que para mantener ocupados los tensor cores, cada byte que traes de la VRAM tiene que usarse en ≈ 200 operaciones. Si tu carga hace menos, los núcleos esperan a la memoria: estás <b>memory-bound</b>. Si hace más, la memoria alcanza y el límite son los núcleos: <b>compute-bound</b>.` },
          { t: 'kv', items: [
            ['Intensidad aritmética', 'FLOPs ÷ bytes movidos desde la VRAM', 'Propiedad de tu carga (modelo, batch, dtype)'],
            ['Punto de quiebre (ridge point)', 'FLOPS pico ÷ ancho de banda', 'Propiedad de la GPU: por debajo, manda la memoria; por encima, el cómputo'],
            ['Techo de rendimiento', 'mín(FLOPS pico, intensidad × ancho de banda)', 'El "techo" del modelo roofline: nunca lo alcanzas, pero te dice cuál recurso comprar'],
          ] },
          { t: 'table', caption: 'Puntos de quiebre y techo de decode para Llama 3 8B (≈ 16 GB en BF16) a batch 1', head: ['GPU', 'FP16/BF16 denso', 'Ancho de banda', 'Punto de quiebre', 'Techo de tokens/s a batch 1'], rows: [
            ['T4', '65 TFLOPS', '320 GB/s', '≈ 200 FLOPs/B', 'No aplica: 16 GB de pesos no entran en 16 GB (y no hay BF16)'],
            ['L4', '≈ 121 TFLOPS', '300 GB/s', '≈ 400 FLOPs/B', '≲ 19'],
            ['A10G', '70 TFLOPS', '600 GB/s', '≈ 117 FLOPs/B', '≲ 37'],
            ['A100 80GB SXM', '312 TFLOPS', '2,039 GB/s', '≈ 153 FLOPs/B', '≲ 127'],
            ['H100 SXM', '≈ 990 TFLOPS', '3,350 GB/s', '≈ 295 FLOPs/B', '≲ 210'],
          ], note: 'Techo = ancho de banda ÷ bytes de pesos. Es una cota superior teórica: ignora la lectura del KV cache, el overhead y que nunca se usa el 100 % del ancho de banda. En la práctica ves menos; mídelo. Supone decode estándar, un token por lectura de los pesos: con speculative decoding (un modelo draft propone varios tokens y el grande los verifica en una sola lectura de pesos; <a href="#m14">M14</a>) puedes superarla. SXM: módulo montado en la placa del servidor, con más potencia y NVLink; la alternativa es la tarjeta PCIe.' },
          { t: 'h3', text: 'Por qué el decode de un LLM es memory-bound' },
          { t: 'p', html: `Al generar un token a batch 1, cada peso se usa una sola vez: una multiplicación y una suma (2 FLOPs) por cada peso de 2 bytes. Intensidad ≈ <b>1 FLOP por byte</b>. El punto de quiebre de la L4 es ≈ 400: estás ≈ 400× por debajo, con los tensor cores esperando casi todo el tiempo.` },
          { t: 'calc', title: 'Un token de Llama 3 8B en una L4', rows: [
            { label: 'FLOPs por token', expr: '2 × 8.03 B', value: '≈ 16 GFLOPs' },
            { label: 'Tiempo si mandara el cómputo', expr: '16 GFLOPs ÷ 121 TFLOPS', value: '≈ 0.13 ms' },
            { label: 'Tiempo si manda la memoria', expr: '16.06 GB ÷ 300 GB/s', value: '≈ 54 ms' },
            { label: 'Techo a batch 1', expr: '1 token ÷ 54 ms', value: '≲ 19 tokens/s' },
            { label: 'Batch de 4 secuencias de 8k (lo que cabe en la L4)', expr: '4 tokens ÷ ((16.06 + 4 × 1.07) GB ÷ 300 GB/s)', value: '≲ 59 tokens/s en total', note: 'Los pesos se leen una vez por paso para todo el batch; el KV cache, una vez por secuencia' },
          ], result: 'La memoria es ≈ 400× más lenta que el cómputo para esta carga. Más TFLOPS no aceleran el decode; más ancho de banda o menos bytes (INT8 duplica el techo, a ≈ 37 tokens/s) sí. Y el batching multiplica el throughput total hasta que el KV cache se come la memoria.' },
          { t: 'p', html: `Por eso en serving de LLMs mandan dos cosas: el <b>ancho de banda</b> (tokens/s por secuencia) y el <b>batching</b> (tokens/s totales), y el batching está limitado por el KV cache de la <a href="#m04.vram">sección 4</a>. El prefill es otra historia: al procesar un prompt de 2,000 tokens de una vez, cada peso se usa 2,000 veces, la intensidad pasa de mil FLOPs por byte y manda el cómputo. Time to first token escala con FLOPs; el tiempo por token, con bytes. Lo profundizas en <a href="#m14">M14</a>.` },
          { t: 'h3', text: 'Y las CNNs' },
          { t: 'p', html: `Una convolución reutiliza cada peso en todas las posiciones del mapa de activaciones, y cada activación en muchos filtros: intensidad alta. A batch moderado, una CNN en GPU tiende a ser compute-bound. Las excepciones son capas con poca reutilización: batch 1 con mapas chicos, convoluciones depthwise (MobileNet, EfficientNet) y operaciones elemento a elemento (normalización, activaciones), que TensorRT fusiona con la convolución vecina justo para no leer la memoria dos veces.` },
          { t: 'p', html: `El control de cordura con FLOPs ya lo hiciste en <a href="#m03.cuantas-gpus">M3</a>: los ${E('≈ 1,200 img/s')} del c01 son ≈ 15 % del pico teórico de la T4. El roofline explica parte de esa distancia: las capas con poca reutilización (las que TensorRT no logra fusionar, y más capas con los batches chicos de la carga real) quedan por debajo de los ≈ 200 FLOPs/B de la T4 y esperan a la memoria. El resto: capas que no usan tensor cores, overhead entre kernels y clocks limitados por los 70 W. Por eso la capacidad se mide con perf_analyzer y no se deriva de los TFLOPS.` },
          { t: 'callout', kind: 'trap', title: 'Utilización 100 % no significa compute-bound', html: `<p><code>nvidia-smi</code> reporta el porcentaje del tiempo en que <i>algún</i> kernel estuvo corriendo, no qué fracción de los núcleos trabajó. Un decode memory-bound marca cerca de 100 % con los tensor cores casi ociosos. Para saber qué te limita: throughput vs batch con perf_analyzer o el benchmark del servidor, y si hace falta, Nsight Systems o Nsight Compute.</p>` },
          { t: 'callout', kind: 'skip', html: `<p>El roofline completo (jerarquía de cachés, gráficos log-log, profiling de kernels con Nsight Compute) es trabajo de un performance engineer. En la entrevista basta la intuición: ¿cuántas veces uso cada byte que traigo? ¿mi GPU tiene más cómputo o más ancho de banda del que necesito?</p>` },
          { t: 'followups', items: [
            { q: 'Tu Llama 3 8B da ≈ 15 tokens/s por usuario en una L4. ¿Compras una GPU con el doble de TFLOPS?',
              junior: 'Sí: con más TFLOPS genera más rápido.',
              senior: 'No. El decode a batch chico es memory-bound: cada token lee los ≈ 16 GB de pesos, y 300 GB/s ÷ 16 GB ≈ 19 tokens/s es el techo; 15 ya está cerca. Para más tokens/s por usuario necesito menos bytes (INT8 sube el techo a ≈ 37) o más ancho de banda (A10G con 600 GB/s, H100 con 3.35 TB/s), o speculative decoding, que verifica varios tokens por cada lectura de los pesos. Para más throughput total en la misma GPU, batching continuo, limitado por el KV cache.',
              why: 'Identifica el recurso que limita y propone palancas que lo mueven, en vez de comprar el recurso que sobra.' },
            { q: '¿Por qué el prefill y el decode se comportan distinto?',
              junior: 'Porque el prefill procesa más tokens, entonces tarda más.',
              senior: 'En el prefill cada peso se usa para todos los tokens del prompt a la vez: miles de FLOPs por byte, compute-bound; el time to first token escala con FLOPs. En el decode sale un token por paso: ≈ 1 FLOP por byte a batch 1, memory-bound; el tiempo por token escala con bytes leídos (pesos + KV cache). Por eso se optimizan distinto: batching y menos bytes para el decode; cómputo (FP8, GPU más grande) para el prefill.',
              why: 'Traduce la diferencia a intensidad aritmética y de ahí a palancas concretas.' },
            { q: '¿El ResNet-50 del caso 1 es compute-bound o memory-bound?',
              junior: 'Memory-bound, porque la T4 tiene poca VRAM.',
              senior: 'Con batches de 32, compute-bound: las convoluciones reutilizan cada peso en todo el mapa. Pero con la carga real (≈ 250 req/s por GPU en el pico de diseño y batches de 1–3) parte de las capas queda limitada por memoria o por el overhead de lanzar kernels; por eso ayudan la fusión de capas de TensorRT y el dynamic batching. No lo adivino: lo veo en la curva de throughput vs batch de perf_analyzer.',
              why: 'Distingue capacidad de VRAM (cuánto cabe) de ancho de banda (qué tan rápido se lee) y ancla la respuesta en la carga real del caso.' },
          ] },
        ],
      },

      // ======================================================== 6
      {
        id: 'gpus-nvidia',
        title: 'T4, L4, A10G, A100, H100: cuándo usar cada una',
        titleEn: 'T4, L4, A10G, A100, H100: when to use each',
        priority: 'core',
        dims: ['tradeoffs', 'estimaciones'],
        blocks: [
          { t: 'p', html: `Cinco GPUs cubren casi todas las conversaciones de entrevista. No memorices la tabla entera: memoriza memoria, ancho de banda, si tiene BF16/FP8 y el orden de magnitud del precio.` },
          { t: 'table', caption: 'Hojas de datos (cómputo en denso) y precio aproximado en AWS', head: ['', 'T4', 'L4', 'A10G', 'A100', 'H100 SXM'], rows: [
            ['Arquitectura (año)', 'Turing (2018)', 'Ada Lovelace (2023)', 'Ampere, variante para AWS (g5, 2021)', 'Ampere (2020)', 'Hopper (2022)'],
            ['Memoria', '16 GB GDDR6', '24 GB GDDR6', '24 GB GDDR6', '40 GB HBM2 · 80 GB HBM2e', '80 GB HBM3'],
            ['Ancho de banda', '320 GB/s', '300 GB/s', '600 GB/s', '1,555 GB/s (40 GB, PCIe o SXM; p4d) · 2,039 GB/s (80 GB SXM; p4de)', '3.35 TB/s'],
            ['FP16 tensor, denso', '65 TFLOPS', '≈ 121 TFLOPS', '70 TFLOPS', '312 TFLOPS', '≈ 990 TFLOPS'],
            ['BF16', 'No', 'Sí', 'Sí', 'Sí', 'Sí'],
            ['FP8', 'No', 'Sí (≈ 242 TFLOPS)', 'No', 'No', 'Sí (≈ 1,979 TFLOPS)'],
            ['INT8, denso', '130 TOPS', '≈ 242 TOPS', '140 TOPS', '624 TOPS', '≈ 1,979 TOPS'],
            ['Potencia máxima', '70 W', '72 W', '300 W', '250–400 W según versión', 'hasta 700 W'],
            ['MIG', 'No', 'No', 'No', 'Sí, hasta 7', 'Sí, hasta 7'],
            ['Instancia AWS típica', 'g4dn.xlarge (1 GPU)', 'g6.xlarge (1 GPU)', 'g5.xlarge (1 GPU)', 'p4d.24xlarge (8 × 40 GB) · p4de.24xlarge (8 × 80 GB)', 'p5.48xlarge (8) · p5.4xlarge (1)'],
            ['US$ por GPU-hora, on-demand', E('≈ 0.53'), E('≈ 0.80'), E('≈ 1.01'), E('≈ 2.75 (40 GB) · ≈ 3.43 (80 GB)'), E('≈ 6.88')],
          ], note: 'Cómputo <b>denso</b>. NVIDIA suele publicar el doble "with sparsity" (sparsity estructurada 2:4, que exige podar el modelo con ese patrón y casi nunca aplica a un modelo que te dan): divide entre 2. La T4 no tiene sparsity: sus números ya son densos. Fuentes: hojas de datos de NVIDIA; A10G, hoja de datos AWS/NVIDIA (2022). Precios: on-demand Linux en us-east-1, aproximados a sept. 2026. Las xlarge incluyen 4 vCPU y 16 GiB de RAM; en p4d/p4de/p5.48xlarge es el precio de la instancia ÷ 8. AWS bajó P4 y P5 hasta 45 % en junio de 2025 y los precios siguen moviéndose: verifica en la página de precios de EC2.' },
          { t: 'h3', text: 'Cuándo usar cada una' },
          { t: 'table', head: ['GPU', 'Úsala cuando', 'No la uses cuando', 'Por qué'], rows: [
            ['<b>T4</b>', 'CV chica o mediana a QPS bajo o medio; necesitas N+1 barato (<a href="#c01">c01</a>)', 'LLMs en BF16; modelos que con su runtime pasan de ≈ 12–14 GB', 'La instancia x86 más barata de AWS con una GPU NVIDIA completa; 16 GB y FP16/INT8 bastan para CNNs. Pero es de 2018: sin BF16 ni FP8, y es una tarjeta pasiva de 70 W que baja clocks bajo carga sostenida.'],
            ['<b>L4</b>', 'Reemplazo moderno de la T4: CV con más throughput, video (4 decodificadores NVDEC y 4 de JPEG), LLMs de 7–8B o cuantizados', 'Decode de LLMs donde manda el ancho de banda: sus 300 GB/s son menos que los de una T4', '≈ 1.5× el precio por hora de la T4 con ≈ 2× los TFLOPS FP16 densos, BF16 y FP8, en 72 W. Los decodificadores de hardware sacan el decode de la CPU.'],
            ['<b>A10G</b>', 'Solo AWS (g5): LLMs de 7–8B en BF16 que necesitan 24 GB y más ancho de banda que la L4', 'CV a QPS bajo: pagas ≈ 2× la T4 por hora sin necesitarlo', '600 GB/s, el doble que la L4: techo de decode ≈ 37 tokens/s para 8B en BF16 contra ≈ 19. Menos TFLOPS que la L4 y sin FP8.'],
            ['<b>A100</b>', 'Modelos que no caben en 24 GB (13–34B, o 70B cuantizado en la de 80 GB), training mediano, partir la GPU con MIG', 'Una CNN a 500 req/s; cualquier carga en la que alcance una L4', 'HBM de 1.5–2 TB/s y 40/80 GB. En AWS viene de a 8 (p4d/p4de): la unidad mínima es una instancia de ' + E('≈ US$22–27/h') + '.'],
            ['<b>H100</b>', 'LLMs a escala (FP8 con Transformer Engine, 3.35 TB/s, NVLink entre las 8 GPUs de un nodo), training grande', 'Cualquier cosa que quepa y cumpla en una L4 o una A10G', '≈ 11× el ancho de banda de una L4 por ≈ 9× el precio por hora: rinde si la mantienes llena. Desde 2025 AWS ofrece p5.4xlarge con una sola H100.'],
          ] },
          { t: 'h3', text: 'Elegir en seis preguntas' },
          { t: 'steps', items: [
            { title: '¿Cabe?', meta: 'Capacidad', html: '<p>Pesos + activaciones + runtime + KV cache + margen (<a href="#m04.vram">sección 4</a>). Si no cabe, descarta la GPU o baja los bytes (INT8/INT4) antes de seguir.</p>' },
            { title: '¿Qué dtype necesito?', meta: 'Soporte', html: '<p>Un LLM entrenado en BF16 descarta la T4. Si quieres FP8, solo quedan L4/L40S, H100 y posteriores. Una CNN en FP16 o INT8 corre en todas.</p>' },
            { title: '¿Qué recurso limita mi carga?', meta: 'Roofline', html: '<p>CNN a batch moderado: cómputo. Decode de LLM: ancho de banda. Compara las GPUs candidatas por ese número, no por el otro (<a href="#m04.roofline">sección 5</a>).</p>' },
            { title: '¿Cuánto cuesta con mi utilización real?', meta: 'Costo', html: '<p>GPUs para el pico más N+1, por precio por hora, y costo por 1,000 predicciones con la carga promedio (<a href="#m04.costo-por-prediccion">sección 7</a>).</p>' },
            { title: '¿El host alimenta a la GPU?', meta: 'CPU y red', html: '<p>Compara lo que pide la GPU a su capacidad con la CPU y la red de la instancia. En el <a href="#c01">c01</a>, ' + E('≈ 1,200 img/s') + ' × ' + E('≈ 6 ms') + ' de CPU por imagen ≈ 7 vCPU y ≈ 5.8 Gb/s de tensores FP32, contra 4 vCPU y ' + E('≈ 5 Gb/s') + ' de baseline de una g4dn.xlarge. Por eso el c01 preprocesa en su propio tier de CPU y pasaría a entrada UINT8 (red ÷ 4) antes de crecer; si preprocesas en el mismo nodo, pides más vCPU por GPU (el backfill usa g4dn.2xlarge).</p>' },
            { title: '¿Existe donde lo necesito?', meta: 'Operación', html: '<p>Disponibilidad y cuota de ese tipo de instancia en tu región, el tamaño mínimo de instancia (las A100 de AWS vienen de a 8) y si tu equipo ya opera ese stack.</p>' },
          ] },
          { t: 'callout', kind: 'trap', title: 'Elegir por TFLOPS', html: `<p>La H100 tiene ≈ 15× los TFLOPS FP16 de una T4 (≈ 990 contra 65) por ≈ 13× el precio por hora. Parece un buen trato hasta que miras la carga: el ResNet-50 del caso 1 usa ≈ 5 % de una T4, así que la H100 estaría casi vacía. Y en el decode de un LLM los TFLOPS ni siquiera son el límite: lo es el ancho de banda. Pregunta en este orden: ¿cabe? ¿qué recurso limita a mi carga? ¿cuánto cuesta cada predicción con mi utilización real?</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"For this CNN the model is about 50 MB and we're at roughly 5% average load, so memory and compute don't bind — cost per GPU-hour does. I'd use T4s, two of them for N+1. If we were serving an 8-billion-parameter LLM instead, I'd look at memory capacity and bandwidth first: an L4 fits it in BF16 but caps decoding at around 19 tokens per second per sequence, so I'd compare it against an A10G or a quantized model."</p>` },
          { t: 'callout', kind: 'note', title: 'Lo que llegó después (a sept. 2026)', html: `<ul>
            <li><b>H200</b> (Hopper): el cómputo de la H100 con 141 GB de HBM3e y 4.8 TB/s. Más KV cache y más ancho de banda de decode por GPU. En AWS, p5e/p5en.</li>
            <li><b>B200 y GB200</b> (Blackwell): un DGX B200 trae 8 GPUs con 1,440 GB en total (≈ 180 GB por GPU) y ≈ 8 TB/s por GPU, con tensor cores FP4. El GB200 NVL72 une 72 GPUs Blackwell y 36 CPUs Grace en un solo dominio NVLink del tamaño de un rack, para modelos que necesitan muchas GPUs.</li>
            <li><b>L40S</b> (Ada): 48 GB GDDR6, 864 GB/s, FP8, 350 W, sin MIG. En AWS, g6e.xlarge a ${E('≈ US$1.86/h')}: un escalón entre la L4 y la A100 para inferencia.</li>
            <li><b>AMD MI300X</b>: 192 GB de HBM3 y 5.3 TB/s (750 W), con el stack ROCm; vLLM lo soporta. Compite por memoria en LLMs grandes; el costo del cambio es el ecosistema.</li>
            <li><b>Jetson Thor</b> (2025), en edge: <a href="#m04.edge-jetson">sección 9</a>.</li>
          </ul><p>En las entrevistas se sigue razonando con las clases T4/L4/A10G/A100/H100. Menciona las nuevas como "más memoria y más ancho de banda por GPU" y verifica specs y precios antes de usarlos en un diseño real.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'costo-por-prediccion',
        title: 'Costo por hora vs costo por predicción',
        titleEn: 'Cost per hour vs cost per prediction',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Número primero. Una T4 cuesta ${E('≈ US$0.526/h')}. Si procesara sus 600 img/s planificadas toda la hora, serían 600 × 3,600 = 2.16 M predicciones: US$0.526 / 2,160 ≈ <b>US$0.00024 por cada 1,000</b>. La fórmula:` },
          { t: 'p', html: `<code>US$ por 1,000 = (US$ por hora) ÷ (predicciones por segundo × 3,600 ÷ 1,000)</code>` },
          { t: 'calc', title: 'Por 1,000 predicciones, con la GPU trabajando a su capacidad planificada', rows: [
            { label: 'T4 (g4dn.xlarge), 600 img/s', expr: '0.526 ÷ (600 × 3.6)', value: E('≈ US$0.00024'), note: 'Capacidad planificada del c01 (≈ 50 % del máximo medido)' },
            { label: 'L4 (g6.xlarge), 1,500 img/s', expr: '0.805 ÷ (1,500 × 3.6)', value: E('≈ US$0.00015'), note: '<b>Supuesto</b>: ≈ 2.5× la T4 (el c01 estima 2–3×). Mídelo con perf_analyzer antes de decidir' },
            { label: 'A10G (g5.xlarge), 1,500 img/s', expr: '1.006 ÷ (1,500 × 3.6)', value: E('≈ US$0.00019'), note: '<b>Supuesto</b>: la hoja de datos AWS/NVIDIA muestra ≈ 2.5× la T4 en ResNet-50, pero en INT8 y batch 128, no en tu configuración' },
            { label: 'CPU INT8 (c6i), 15 ms por imagen por vCPU al 60 %', expr: '1,000 × 0.015 s ÷ 0.6 ÷ 3,600 × 0.0425', value: E('≈ US$0.0003'), note: 'Si la accuracy aguanta; el c01 lo manda a medir en la semana 1' },
          ], result: 'A capacidad llena, la L4 sería la más barata por predicción aunque cueste ≈ 53 % más por hora.' },
          { t: 'p', html: `Pero nadie paga "a capacidad llena". Pagas horas encendidas, y en el c01 hay ≈ 116 req/s promedio repartidos en dos GPUs que están ahí por N+1:` },
          { t: 'calc', title: 'El caso 1 con su carga real (2 GPUs siempre encendidas, sin autoscaling)', rows: [
            { label: '2 × T4', expr: '2 × 0.526 × 730 h', value: E('≈ US$768/mes'), note: '≈ US$0.0025 por 1,000 (≈ 304 M predicciones al mes)' },
            { label: '2 × L4', expr: '2 × 0.805 × 730 h', value: E('≈ US$1,175/mes'), note: '≈ US$0.0039 por 1,000' },
            { label: '2 × A10G', expr: '2 × 1.006 × 730 h', value: E('≈ US$1,469/mes'), note: '≈ US$0.0048 por 1,000' },
            { label: 'Carga promedio de las T4 vs su máximo medido', expr: '116 ÷ (2 × 1,200)', value: E('≈ 5 %') },
            { label: 'Costo efectivo vs costo a capacidad planificada (T4, 600 img/s)', expr: 'US$0.0025 ÷ US$0.00024', value: E('≈ 10×') },
            { label: 'Costo efectivo vs costo al máximo medido (T4, 1,200 img/s)', expr: 'US$0.0025 ÷ (0.526 ÷ (1,200 × 3.6)) = US$0.0025 ÷ US$0.00012', value: E('≈ 20×') },
          ], result: 'Con N+1 y carga baja gana la hora más barata (T4), no la predicción más barata (L4). El costo efectivo es ≈ 20× el de la GPU a su máximo medido y ≈ 10× el de la capacidad planificada, porque la GPU pasa ≈ 95 % de su capacidad ociosa: <b>la utilización real domina el costo</b>.' },
          { t: 'p', html: `Cuando la carga crece, se invierte. Con 10× el tráfico ya no pagas N+1 sobre una GPU casi vacía, sino muchas GPUs llenas, y el throughput por dólar vuelve a mandar:` },
          { t: 'calc', title: 'El mismo servicio a 10× (pico de diseño 5,000 req/s)', rows: [
            { label: 'T4', expr: 'ceil(5,000 ÷ 600) + 1 = 10 GPUs × 0.526 × 730', value: E('≈ US$3,840/mes') },
            { label: 'L4 (supuesto: 1,500 planificadas)', expr: 'ceil(5,000 ÷ 1,500) + 1 = 5 GPUs × 0.805 × 730', value: E('≈ US$2,938/mes') },
            { label: 'A10G (mismo supuesto)', expr: '5 GPUs × 1.006 × 730', value: E('≈ US$3,672/mes') },
          ], result: 'A 10×, la L4 gana (si el supuesto de 2.5× se confirma en tu load test). Es el "a 10× se revisa el hardware, no la arquitectura" del <a href="#c01">caso 1</a>. Con autoscaling siguiendo la curva diaria, las cuentas bajan para todas; el orden no cambia.' },
          { t: 'h3', text: 'Palancas para bajar el costo por predicción' },
          { t: 'table', head: ['Palanca', 'Qué mueve', 'Cuándo', 'Dónde se profundiza'], rows: [
            ['Right-sizing: la GPU más chica que cumple', 'US$ por hora', 'Siempre: es la primera pregunta', 'Esta sección'],
            ['Batching (dynamic o continuous)', 'Predicciones por hora de la misma GPU', 'Cuando hay tráfico suficiente para llenar batches', '<a href="#m03.batching">M3</a>'],
            ['Menos bytes: FP16 → INT8, FP8 o INT4', 'Throughput y VRAM', 'Si el parity test y el golden set aguantan', '<a href="#m08">M8</a>'],
            ['Compartir la GPU entre modelos', 'Horas ociosas', 'Varios modelos chicos, cada uno con poca carga', '<a href="#m04.compartir-gpu">Sección 8</a>'],
            ['Savings Plans o reservas', `US$ por hora: ${E('≈ 30–40 % menos')} sobre la base estable (c01)`, 'Carga base predecible durante 1–3 años', '<a href="#m13">M13</a>'],
            ['Spot', 'US$ por hora, mucho menor pero variable', 'Batch, backfill, training: trabajo que se reintenta. No el N+1 online', '<a href="#m13">M13</a>'],
            ['Autoscaling por largo de cola', 'Horas encendidas', 'Curva diaria marcada y un cold start que toleras', '<a href="#m06">M6</a>'],
            ['Mover el modelo a CPU', 'Elimina el tier GPU', 'Modelo chico en INT8 que cumple el SLO', '<a href="#m04.cpu-gpu-tpu">Sección 2</a>'],
          ] },
          { t: 'tradeoffs', items: [
            { option: '2 × T4 (g4dn.xlarge)', verdict: 'elegido',
              pros: 'La hora más barata con una GPU NVIDIA completa; 16 GB sobran; FP16 e INT8; el engine ya está construido para sm_75.',
              cons: 'De 2018: sin BF16 ni FP8; 70 W pasivos que bajan clocks bajo carga sostenida.',
              why: 'Con ≈ 5 % de carga promedio y N+1 obligatorio, lo que manda es el precio por hora.' },
            { option: '2 × L4 (g6.xlarge)', verdict: 'depende',
              pros: '≈ 2× los TFLOPS FP16 densos, BF16 y FP8, decodificadores de video y de JPEG.',
              cons: '≈ 53 % más por hora; con esta carga estaría igual de ociosa.',
              why: 'Cuando el pico crezca ≈ 3–5× o más y el load test confirme su throughput: con varias GPUs llenas, gana por predicción.' },
            { option: '2 × A10G (g5.xlarge)', verdict: 'descartado',
              pros: '600 GB/s y 24 GB.',
              cons: '≈ 2× el precio de la T4 por hora; su ventaja (ancho de banda) no importa en una CNN compute-bound.',
              why: 'Es una GPU para decode de LLMs, no para este caso.' },
            { option: 'CPU INT8 (c6i/c7i) dentro del gateway', verdict: 'depende',
              pros: 'Sin tier GPU, sin engine atado a una arquitectura, escala con el HPA de CPU.',
              cons: 'Riesgo de perder accuracy en el long tail; ≈ 7–21 vCPU en el pico.',
              why: `Si el benchmark da ≈ 15 ms por imagen por vCPU con ≤ 0.5 pp de pérdida, cuesta menos: ${E('≈ US$125–250/mes')} de CPU contra ${E('≈ US$768')} de GPU (análisis del c01), porque la CPU escala con la carga y no paga una GPU ociosa por N+1.` },
            { option: 'Fracción de L4 (AWS g6f, desde 2025)', verdict: 'depende',
              pros: `g6f.large: 1/8 de L4 con ≈ 3 GB de VRAM a ${E('≈ US$0.20/h')}. Right-sizing por debajo de una GPU entera.`,
              cons: 'Throughput y aislamiento de la fracción por medir; 3 GB son justos para varias instancias.',
              why: 'Interesante cuando una GPU completa sobra: se decide con perf_analyzer sobre la fracción, no con la hoja de datos.' },
            { option: 'H100 (p5.4xlarge)', verdict: 'descartado',
              pros: 'Sobra de todo.',
              cons: E('≈ US$6.88/h') + ', ≈ 13× una T4, para una carga que no llena ni la T4.',
              why: 'Resuelve un problema que este caso no tiene.' },
          ] },
          { t: 'callout', kind: 'senior', html: `<p>Separa las dos cuentas en voz alta: "a capacidad planificada, la L4 es ≈ 40 % más barata por predicción; con mi carga real, las dos GPUs de N+1 están al ≈ 5 %, así que el costo lo fija el precio por hora y gana la T4. Revisaría la decisión si el pico se multiplica: a 10× serían 10 T4 contra 5 L4". Es la diferencia entre repetir una hoja de datos y hacer capacity planning.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>El costo mensual completo del c01 (GPUs, gateway, ALB, logs) está en <a href="#c01.estimaciones">sus estimaciones</a>: las GPUs son ≈ 45 % de la infra. Savings Plans, spot y costos ocultos de la nube, en <a href="#m13">M13</a>.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'compartir-gpu',
        title: 'Compartir una GPU entre modelos',
        titleEn: 'Sharing a GPU between models',
        priority: 'extra',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Las dos T4 del caso 1 trabajan al ≈ 5 % en promedio. Si otros equipos tienen modelos chicos con poca carga, pagar una GPU por modelo multiplica el desperdicio. Hay seis formas de compartir, con aislamiento muy distinto:` },
          { t: 'table', caption: 'Formas de compartir una GPU', head: ['Opción', 'Qué es', 'Aislamiento de memoria', 'Aislamiento de fallas', 'Latencia predecible', 'Dónde existe', 'Cuándo'], rows: [
            ['Varias instancias del mismo modelo', '<code>instance_group</code> de Triton: N copias en la misma GPU que ejecutan en paralelo', 'No aplica: es el mismo modelo', 'No: mismo proceso', 'Buena', 'Cualquier GPU', 'Solapar trabajo y aprovechar mejor la GPU a batch chico (el c01 usa 2)'],
            ['Varios modelos en un model server', 'Un Triton con los modelos de varios equipos en su repositorio', 'No: comparten VRAM', 'No: si el proceso cae, caen todos', 'Media: compiten por los SMs', 'Cualquier GPU', 'Modelos chicos con poca carga y un mismo equipo operando el servidor'],
            ['Time-slicing', 'El device plugin de Kubernetes anuncia N "GPUs" por GPU física y los pods se turnan', 'No: un pod puede agotar la VRAM de otro', 'No', 'Mala: cambios de contexto, sin garantías', 'GPUs NVIDIA soportadas por el plugin', 'Desarrollo, notebooks, cargas que toleran variación'],
            ['MPS', 'Multi-Process Service: kernels de varios procesos corren a la vez en la GPU', 'Parcial, con límites configurables', 'Débil: un error fatal de un cliente puede afectar a los demás', 'Mejor que time-slicing', 'GPUs NVIDIA (desde Volta, con espacios de memoria separados por cliente); en Kubernetes, soporte más nuevo y menos probado', 'Muchos procesos chicos que no llenan la GPU'],
            ['MIG', 'Particiones de hardware con SMs, caché L2, memoria y ancho de banda propios', 'Sí', 'Sí', 'Sí', 'A30, A100, H100, H200, B200 y otras recientes; <b>no</b> T4, L4, A10G ni L40S', 'Multi-tenant con SLO; varios modelos medianos en una GPU grande'],
            ['Fracción de GPU del proveedor', 'La nube vende la fracción como instancia (AWS g6f: desde 1/8 de L4)', 'Según la implementación: verifícalo', 'Según la implementación', 'Mídela', 'AWS g6f (2025)', 'Un modelo que no llena ni una L4'],
          ] },
          { t: 'h3', text: 'MIG en números' },
          { t: 'calc', title: 'Una H100 de 80 GB partida en 7 slices 1g.10gb', rows: [
            { label: 'VRAM por slice', expr: 'perfil 1g.10gb', value: '10 GB' },
            { label: 'Cómputo por slice', expr: 'fracción fija de los SMs', value: '≈ 1/7–1/8 de la GPU' },
            { label: 'Precio por slice', expr: E('US$6.88/h') + ' ÷ 7', value: E('≈ US$0.98/h') },
            { label: 'Contra una T4 completa', expr: 'g4dn.xlarge', value: E('≈ US$0.53/h') },
          ], result: 'MIG hace rentable una GPU grande que <b>ya pagas</b> (varios modelos medianos con SLO, cada uno aislado). No convierte una H100 en siete GPUs baratas: para un modelo chico, un slice cuesta casi el doble que una T4, aunque traiga más cómputo.' },
          { t: 'p', html: `Detalles que suman en un deep dive: los perfiles son fijos (en una A100 de 40 GB, de 1g.5gb a 7g.40gb; en una H100 de 80 GB, 1g.10gb y mayores), cambiar la partición exige vaciar la GPU, y Kubernetes expone cada slice como un recurso propio (p. ej. <code>nvidia.com/mig-1g.10gb</code>) que un pod pide como pediría una GPU.` },
          { t: 'h3', text: 'Noisy neighbor en la GPU' },
          { t: 'p', html: `En todas las opciones salvo MIG, un vecino que manda un batch grande o carga un modelo nuevo sube tu p99 o te deja sin memoria. Mitigaciones concretas: presupuesto de VRAM por modelo (y cargar modelos solo en el deploy, no bajo demanda), métricas por modelo (Triton separa tiempo en cola y tiempo de cómputo por modelo, así ves quién te hace esperar), capacidad planificada con la suma de los picos, no de los promedios, y una regla de salida: el modelo que necesita un SLO estricto o crece se va a su propia GPU o a un slice de MIG.` },
          { t: 'callout', kind: 'trap', title: 'Time-slicing "te da más GPUs"', html: `<p>No. Multiplica el número que Kubernetes anuncia (un nodo con 1 GPU física reporta, por ejemplo, <code>nvidia.com/gpu: 4</code>), no la capacidad. Los cuatro pods se turnan la misma GPU, sin aislamiento de memoria: el primero que carga un modelo grande deja a los otros con out of memory. Sirve para desarrollo, no para cargas con SLO.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>La frase para el caso 1: "Las T4 están al ≈ 5 %. Pondría en el mismo Triton los modelos chicos de otros equipos, con un presupuesto de VRAM por modelo, métricas de cola por modelo y una regla: si un modelo necesita su propio SLO o crece, se va a su propia GPU, o a un slice de MIG si algún día tenemos A100/H100". Reconoce el ahorro y el riesgo en la misma frase.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Cómo pide GPUs un pod, time-slicing y MIG en el device plugin, y el aislamiento de nodos con taints: <a href="#m06">M6</a>. Instance groups, varios modelos en Triton y sus métricas por modelo: <a href="#m07">M7</a>.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'edge-jetson',
        title: 'Edge: Jetson y compañía',
        titleEn: 'Edge: Jetson and friends',
        priority: 'extra',
        dims: ['arquitectura', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Corres el modelo junto al sensor cuando la red no es confiable, cuando el dato no puede salir (privacidad), cuando necesitas unos pocos ms de reacción o cuando mandar video a la nube cuesta más que procesarlo ahí. El caso típico de entrevista: inspección visual en una línea de producción (<a href="#c03">c03</a>) o analítica de video en cámaras (<a href="#c02">c02</a>). En CV industrial, la familia que más vas a nombrar es Jetson Orin.` },
          { t: 'table', caption: 'Familia Jetson Orin (números de NVIDIA)', head: ['Módulo', 'Memoria compartida', 'Ancho de banda', 'IA: TOPS INT8 sparse', 'Potencia', 'DLA'], rows: [
            ['Orin Nano 4GB', '4 GB LPDDR5', '34 → 51 GB/s', '20 → 34', '7–10 W → hasta 25 W', 'No'],
            ['Orin Nano 8GB', '8 GB LPDDR5', '68 → 102 GB/s', '40 → 67', '7–15 W → hasta 25 W', 'No'],
            ['Orin NX 8GB', '8 GB LPDDR5', '102 GB/s', '70 → 117', '10–20 W → hasta 40 W', '1'],
            ['Orin NX 16GB', '16 GB LPDDR5', '102 GB/s', '100 → 157', '10–25 W → hasta 40 W', '2'],
            ['AGX Orin 32GB', '32 GB LPDDR5', '204.8 GB/s', '200', '15–40 W', '2'],
            ['AGX Orin 64GB', '64 GB LPDDR5', '204.8 GB/s', '275', '15–60 W', '2'],
          ], note: '"→" es el modo Super de JetPack 6.2 (2025), que sube clocks y consumo en Nano y NX sin cambiar el hardware (y agrega MAXN SUPER, sin tope fijo). Los TOPS son los que publica NVIDIA: INT8 <b>con sparsity</b>, sumando GPU y DLA cuando hay DLA. Los densos son la mitad: un Orin Nano 8GB Super son ≈ 33 TOPS densos. Fuentes: página de Jetson Orin y blog técnico de JetPack 6.2 de NVIDIA.' },
          { t: 'callout', kind: 'skip', html: `<p>No memorices esta tabla, los números del modo Super ni las versiones de JetPack. Para la entrevista basta con: Orin Nano, NX y AGX, de 4 a 64 GB compartidos y ≈ 7–60 W; los TOPS publicados son sparse (divide entre 2); y los engines se construyen en el dispositivo para esa versión de JetPack.</p>` },
          { t: 'h3', text: 'Memoria unificada: el OS compite con tu modelo' },
          { t: 'p', html: `Un Jetson no tiene VRAM separada. Linux, tu aplicación, los buffers de video y el modelo comparten la misma LPDDR5. En un Orin Nano de 8 GB, el sistema operativo y el contexto CUDA ya se llevan una parte (${E('del orden de 1–2 GB')}; mídelo con <code>tegrastats</code>), y lo que queda es tu "VRAM". El ancho de banda también se comparte: 102 GB/s para CPU, GPU, DLA y video en un Orin NX, contra 300 GB/s exclusivos para la GPU en una L4. La ventaja: no hay copia por PCIe; CPU y GPU pueden leer el mismo buffer (zero-copy).` },
          { t: 'diagram', id: 'jetson-memoria-unificada', title: 'Un Jetson: todo comparte la misma memoria', caption: 'CPU, GPU y DLA leen y escriben la misma LPDDR5; el modo de energía fija los clocks de todos. Recorre un frame de cámara.', spec: JETSON },
          { t: 'h3', text: 'Modos de energía y thermal throttling' },
          { t: 'p', html: `<code>nvpmodel</code> fija el modo de energía: tope de watts, clocks de CPU, GPU y memoria, y cores activos. <code>jetson_clocks</code> fija los clocks al máximo del modo actual. Si el disipador no alcanza (caja sellada IP67 junto a un horno, 40 °C de ambiente), el módulo baja clocks para no sobrecalentarse: thermal throttling. El mismo modelo da latencias distintas en 15 W y en MAXN, y distintas otra vez a la hora 3 de un turno caluroso. Mide en el modo de energía y la carcasa de producción, y vigila temperatura y clocks en operación.` },
          { t: 'code', title: 'Lo que corres en el dispositivo', files: [
            { name: 'jetson.sh', lang: 'bash', code: `sudo nvpmodel -q            # modo de energía actual (los números de modo cambian por módulo)
sudo nvpmodel -m <modo>     # cambiar de modo: consulta los modos en /etc/nvpmodel.conf
sudo jetson_clocks          # clocks al máximo del modo actual (para benchmarks reproducibles)
tegrastats                  # RAM compartida, uso de GPU, temperaturas y consumo, cada segundo

# Construir el engine EN el dispositivo y medir latencia y throughput
/usr/src/tensorrt/bin/trtexec --onnx=detector.onnx --fp16 --saveEngine=detector.plan
# Probar el DLA: las capas que no soporta vuelven a la GPU
/usr/src/tensorrt/bin/trtexec --onnx=detector.onnx --int8 --useDLACore=0 --allowGPUFallback`, note: 'Con <code>--int8</code> sin datos de calibración, trtexec usa escalas de relleno: sirve para medir velocidad, no accuracy. La calibración real está en <a href="#m08">M8</a>.' },
          ] },
          { t: 'h3', text: 'JetPack fija tu stack' },
          { t: 'p', html: `JetPack empaqueta Jetson Linux (L4T, basado en Ubuntu) con versiones fijas de CUDA, cuDNN y TensorRT. Por ejemplo, JetPack 6.2 trae Jetson Linux 36.4.3 sobre Ubuntu 22.04, CUDA 12.6 y TensorRT 10.3; Jetson Thor usa JetPack 7, sobre Ubuntu 24.04. Consecuencias de diseño:` },
          { t: 'list', items: [
            `<b>Los engines de TensorRT no son portables.</b> Se construyen en el dispositivo, o para el mismo módulo con la misma versión de JetPack/TensorRT. Es la misma regla del <a href="#c01">caso 1</a> (T4, sm_75, misma release de NGC), con más variantes de hardware en la flota.`,
            `<b>Actualizar JetPack en una flota</b> es reconstruir engines y revalidar el modelo, con actualización OTA y rollback: operación de flota, en <a href="#m02.edge">M2</a>.`,
            `<b>Los contenedores</b> deben usar imágenes base de la misma versión de L4T que el dispositivo.`,
          ] },
          { t: 'h3', text: 'DeepStream y el DLA' },
          { t: 'p', html: `Para varias cámaras, <b>DeepStream</b> (el SDK de NVIDIA sobre GStreamer) arma el pipeline completo: decode por hardware, batching de varios streams, inferencia con TensorRT y tracking, sin sacar los frames de la memoria de la GPU. Es el camino estándar en <a href="#c02">c02</a> y <a href="#c03">c03</a>. El <b>DLA</b> (en Orin NX y AGX Orin) corre capas de CNN en INT8/FP16 en paralelo con la GPU y gastando menos energía; lo que no soporta cae a la GPU, y ese ir y venir puede comerse la ganancia. Úsalo si trtexec lo confirma con tu modelo.` },
          { t: 'callout', kind: 'note', title: 'Jetson Thor (2025)', html: `<p>Según NVIDIA, el kit Jetson AGX Thor (agosto de 2025) trae una GPU Blackwell, 128 GB de LPDDR5X a 273 GB/s, hasta 2,070 TFLOPS en FP4 (con sparsity) y 40–130 W, con soporte de MIG y JetPack 7; el kit de desarrollo salió a ≈ US$3,499. Apunta a robótica y a modelos generativos (LLMs, VLMs) en el dispositivo. Para inspección visual clásica, un Orin sigue siendo la clase razonable; Thor entra cuando necesitas varios modelos grandes en el borde.</p>` },
          { t: 'h3', text: 'Alternativas a Jetson' },
          { t: 'table', head: ['Acelerador', 'Números de cabecera (fabricante)', 'Cómo se programa', 'Cuándo'], rows: [
            ['Google Coral Edge TPU', '4 TOPS INT8 con ≈ 2 W', 'Modelo TFLite completamente INT8, compilado con <code>edgetpu_compiler</code>; las ops no soportadas caen a la CPU', 'Clasificación o detección chica con muy poco costo y consumo; verifica el estado del soporte antes de elegirlo'],
            ['Hailo-8', '26 TOPS con ≈ 2.5 W típicos', 'Dataflow Compiler y runtime de Hailo', 'Visión en cámaras o gateways de bajo consumo (también como HAT para Raspberry Pi 5)'],
            ['NPUs de teléfono (Apple Neural Engine, Qualcomm Hexagon…)', 'Sin número comparable: cambia por generación', 'Core ML, LiteRT (TFLite), SDKs del fabricante', 'La app corre el modelo: privacidad, sin red, sin costo de servidor'],
          ], note: 'Los TOPS de distintos fabricantes no se comparan directamente: cambian la precisión, la sparsity y qué se cuenta. Compara con tu modelo, tu resolución y tu precisión.' },
          { t: 'callout', kind: 'estimate', html: `<p>No hay un número de "img/s de un Jetson": depende del modelo, la resolución, la precisión y el modo de energía. En la entrevista, di el orden de magnitud con cautela y cómo lo medirías: "construyo el engine en el dispositivo y mido con trtexec en el modo de energía de producción, con la carcasa cerrada".</p>` },
          { t: 'callout', kind: 'trap', title: 'Elegir el módulo por TOPS de marketing', html: `<p>275 TOPS de un AGX Orin son INT8 con sparsity, sumando GPU y DLA, al máximo consumo. Tu YOLO en FP16, en el modo de 30 W, sin sparsity y sin DLA, ve una fracción de eso. Elige por memoria (¿cabe el modelo junto al OS y al pipeline de video?), por watts disponibles y por throughput medido.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Operar una flota de dispositivos (despliegue OTA, versiones de modelo por dispositivo, métricas que suben cuando hay red): <a href="#m02.edge">M2</a>. Casos que lo usan: inspección en planta sin red confiable (<a href="#c03">c03</a>) y video en tiempo real (<a href="#c02">c02</a>).</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'autoevaluacion',
        title: 'Autoevaluación',
        titleEn: 'Self-check',
        priority: 'core',
        dims: ['estimaciones', 'tradeoffs'],
        blocks: [
          { t: 'p', html: `Responde sin mirar. Si fallas más de dos, relee la sección de la explicación antes de volver al <a href="#c01">caso 1</a>.` },
          { t: 'quiz', items: [
            { q: '¿Cuánto pesan los pesos de Llama 3 8B en BF16?', options: ['≈ 8 GB', '≈ 16 GB', '≈ 32 GB', '≈ 4 GB'], answer: 1,
              explain: '8.03 B parámetros × 2 bytes ≈ 16 GB. 8 GB sería INT8 y ≈ 32 GB, FP32. Por eso no entra en una T4 de 16 GB con su runtime.' },
            { q: 'KV cache de Llama 3 8B (32 capas, 8 KV heads, head_dim 128, BF16): ¿cuánto ocupa una secuencia de 8,192 tokens?', options: ['≈ 128 MB', '≈ 1 GiB', '≈ 4 GiB', '≈ 16 GiB'], answer: 1,
              explain: '2 × 32 × 8 × 128 × 2 B = 128 KiB por token; × 8,192 = 1 GiB. Sin GQA (32 KV heads) serían 4 GiB; 16 GiB es una secuencia de 128k.' },
            { q: 'Llama 3 8B BF16 en una L4 (300 GB/s) a batch 1. ¿Techo teórico de tokens/s por secuencia?', options: ['≈ 2', '≈ 19', '≈ 190', '≈ 1,900'], answer: 1,
              explain: 'Cada token lee los ≈ 16 GB de pesos: 300 ÷ 16 ≈ 19. Es una cota superior (sin KV cache ni overhead). Más TFLOPS no la mueven; más ancho de banda o menos bytes sí.' },
            { q: 'Los 65 TFLOPS FP16 de la T4 y sus 320 GB/s dan un punto de quiebre de ≈ 200 FLOPs/B. Una carga con ≈ 1 FLOP/B es…', options: ['Compute-bound', 'Memory-bound', 'Limitada por PCIe', 'Imposible de saber'], answer: 1,
              explain: 'Está 200× por debajo del punto de quiebre: los núcleos esperan a la memoria. Es el perfil del decode de un LLM a batch 1.' },
            { q: 'NVIDIA publica 242 TFLOPS FP16 para la L4 con un asterisco "with sparsity". ¿Qué número usas en tus cuentas?', options: ['242', '≈ 121', '≈ 484', '30.3'], answer: 1,
              explain: 'El denso es la mitad: ≈ 121. La sparsity estructurada 2:4 exige un modelo podado con ese patrón. 30.3 es FP32 sin tensor cores.' },
            { q: 'Tres modelos de equipos distintos, cada uno con su SLO de p99 y poca carga, deben compartir una GPU sin que un vecino les suba la latencia ni los deje sin memoria. ¿Qué eliges?', options: ['Time-slicing en una L4', 'Los tres en el mismo Triton en una T4', 'MIG: un slice por modelo en una A100 o H100 que ya pagas', 'MPS en una A10G'], answer: 2,
              explain: 'Solo MIG aísla memoria, fallas y latencia por hardware, y existe en A30, A100, H100, H200, B200 y afines, no en T4, L4, A10G ni L40S. Time-slicing y un Triton compartido no aíslan memoria; MPS aísla solo en parte. Si no tienes ya una GPU grande, suele ser más barato dar a cada modelo su propia GPU chica.' },
            { q: 'Caso 1: dos GPUs por N+1 con ≈ 5 % de carga promedio. A capacidad llena, la L4 es más barata por predicción que la T4. ¿Qué eliges hoy?', options: ['L4: es más barata por predicción', 'T4: con esta utilización manda el precio por hora', 'H100: sobra capacidad para crecer', 'A10G: tiene más ancho de banda'], answer: 1,
              explain: '2 × T4 ≈ US$768/mes contra 2 × L4 ≈ US$1,175/mes, y las dos estarían casi ociosas. A 10× el tráfico la cuenta se invierte (10 T4 contra 5 L4, si el load test confirma el supuesto).' },
            { q: 'Tu app y el OS de un Orin Nano 8GB usan 2.5 GB de RAM. ¿Qué implica para el modelo?', options: ['Nada: el modelo usa la VRAM', 'Le quedan ≈ 5.5 GB como máximo, compartidos también con los buffers de video', 'Puede usar swap sin costo', 'El DLA tiene memoria propia'], answer: 1,
              explain: 'En Jetson la memoria es unificada: no hay VRAM separada. Lo que usa el OS, tu app y el pipeline de video se lo resta al modelo (y el Orin Nano no tiene DLA).' },
            { q: 'Llama 3 70B en BF16 (≈ 141 GB). ¿Cuál opción funciona?', options: ['Una H100 de 80 GB', 'Una H200 de 141 GB con KV cache de sobra', 'Dos H100 de 80 GB con tensor parallelism, o cuantizar a INT4 (≈ 35–40 GB)', 'Una L40S de 48 GB'], answer: 2,
              explain: 'Los pesos solos no caben en 80 GB, y en 141 GB llenan la memoria sin lugar para KV cache. Hay que partir el modelo (mejor con NVLink) o reducir los bytes por parámetro.' },
          ] },
          { t: 'checklist', id: 'antes-de-elegir-hardware', items: [
            { id: 'restriccion', html: 'Digo cuál de los tres números limita mi carga (capacidad, ancho de banda o cómputo) antes de nombrar una GPU.' },
            { id: 'pesos', html: 'Calculo los pesos con params × bytes del dtype sin calculadora (ResNet-50 ≈ 51 MB en FP16; 8B ≈ 16 GB en BF16).' },
            { id: 'vram', html: 'Sumo pesos + activaciones + runtime + KV cache + margen, y digo qué mediría con nvidia-smi y max_memory_allocated.' },
            { id: 'kv', html: 'Hago la cuenta del KV cache por token (2 × capas × KV heads × head_dim × bytes) y la traduzco a secuencias concurrentes.' },
            { id: 'denso', html: 'Uso TFLOPS densos y aclaro cuando una hoja de datos cita números con sparsity.' },
            { id: 'dtype', html: 'Sé qué GPU soporta BF16 y FP8 (T4: ninguno; L4 y H100: los dos; A100 y A10G: solo BF16).' },
            { id: 'roofline', html: 'Explico por qué el decode de un LLM es memory-bound y qué palancas lo aceleran.' },
            { id: 'costo', html: 'Paso de US$ por hora a US$ por 1,000 predicciones con la utilización real, no con la capacidad máxima.' },
            { id: 'host', html: 'Verifico que la CPU y la red de la instancia alimenten a la GPU (vCPU por GPU, Gb/s de baseline) antes de culpar a la GPU o de comprar una más grande.' },
            { id: 'cpu', html: 'Considero CPU (INT8 con VNNI/AMX) cuando el modelo es chico o el QPS es bajo, y digo qué benchmark decide.' },
            { id: 'compartir', html: 'Sé qué opción de compartir GPU aísla memoria y fallas (MIG) y cuáles no (time-slicing, varios modelos en un Triton).' },
            { id: 'edge', html: 'En edge, elijo por memoria compartida, watts y throughput medido con trtexec en el modo de energía de producción, no por TOPS.' },
          ] },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'm04-01', kind: 'concepto', q: '¿Cuáles son los tres números de una GPU que importan para inferencia (más el precio)?',
        a: 'Capacidad de memoria (qué cabe), ancho de banda de memoria (qué tan rápido lees pesos y KV cache) y cómputo a tu dtype en denso (TFLOPS/TOPS con tensor cores). El precio por hora, junto con la utilización real, los convierte en costo por predicción.' },
      { id: 'm04-02', kind: 'numero', q: 'Bytes por parámetro en FP32, TF32, FP16, BF16, FP8, INT8 e INT4.',
        a: '4 · 4 (TF32 es un modo de cómputo; se guarda como FP32) · 2 · 2 · 1 · 1 · 0.5.' },
      { id: 'm04-03', kind: 'numero', q: '¿Cuánto pesan Llama 3 8B y Llama 3 70B en BF16, INT8 e INT4?',
        a: '8B: ≈ 16 / 8 / 4–6 GB (INT4 real ≈ 5.7 GB si embeddings y lm_head quedan en BF16). 70B: ≈ 141 / 71 / 35–40 GB. 70B en BF16 no cabe en una GPU de 80 GB.' },
      { id: 'm04-04', kind: 'concepto', q: 'Fórmula de la VRAM al servir un modelo.',
        a: 'Pesos + activaciones/workspace (dependen de batch × resolución o de tokens) + overhead del runtime (contexto CUDA, librerías: ≈ 0.3–1 GB por proceso) + KV cache en LLMs + margen de ≈ 10–20 %.' },
      { id: 'm04-05', kind: 'numero', q: 'KV cache por token de Llama 3 8B, con la cuenta.',
        a: '2 (K y V) × 32 capas × 8 KV heads × 128 head_dim × 2 B = 131,072 B = 128 KiB. Una secuencia de 8k ≈ 1 GiB; una de 128k (Llama 3.1) ≈ 16 GiB.' },
      { id: 'm04-06', kind: 'concepto', q: '¿Qué limita la concurrencia de Llama 3 8B BF16 en una L4 de 24 GB?',
        a: 'El KV cache, no el cómputo: tras ≈ 16 GB de pesos, ≈ 2 GB de runtime y el 10 % que vLLM deja libre por defecto quedan ≈ 3–4 GB, es decir ≈ 3–4 secuencias de 8k tokens a la vez (≈ 11–15 si promedian 2k).' },
      { id: 'm04-07', kind: 'concepto', q: '¿Qué es GQA y por qué importa para la VRAM?',
        a: 'Grouped-query attention: varias heads de query comparten una head de K/V. Llama 3 8B tiene 32 heads de query y 8 de KV, así que su KV cache es 4× más chico que con atención multi-head completa (128 KiB contra 512 KiB por token).' },
      { id: 'm04-08', kind: 'concepto', q: 'Intensidad aritmética y punto de quiebre (ridge point).',
        a: 'Intensidad = FLOPs ÷ bytes leídos de la VRAM (propiedad de la carga). Punto de quiebre = FLOPS pico ÷ ancho de banda (propiedad de la GPU). Por debajo, memory-bound; por encima, compute-bound. T4: 65 TFLOPS ÷ 320 GB/s ≈ 200 FLOPs/B.' },
      { id: 'm04-09', kind: 'trampa', q: 'Tu LLM genera lento en una L4. ¿Compras una GPU con más TFLOPS?',
        a: 'No: el decode a batch chico es memory-bound (≈ 1 FLOP por byte). Techo ≈ ancho de banda ÷ bytes de pesos: L4 ≈ 300 ÷ 16 ≈ 19 tokens/s. Palancas: menos bytes (INT8, INT4), más ancho de banda (A10G, H100), speculative decoding o más batch para el throughput total.' },
      { id: 'm04-10', kind: 'numero', q: 'Techo de decode de Llama 3 8B BF16 a batch 1 en L4, A10G y H100 SXM.',
        a: 'L4 ≲ 19 tokens/s (300 GB/s), A10G ≲ 37 (600 GB/s), H100 ≲ 210 (3.35 TB/s). Cotas teóricas: en la práctica, menos.' },
      { id: 'm04-11', kind: 'concepto', q: '¿Por qué el prefill es compute-bound y el decode memory-bound?',
        a: 'En el prefill cada peso se usa para todos los tokens del prompt a la vez (miles de FLOPs por byte); en el decode, una vez por token (≈ 1 FLOP por byte a batch 1). El time to first token (TTFT) escala con FLOPs; el tiempo por token, con bytes leídos.' },
      { id: 'm04-12', kind: 'trampa', q: 'Una hoja de datos dice "242 TFLOPS*". ¿Qué revisas?',
        a: 'El asterisco: "with sparsity" (2:4 estructurada). El número denso es la mitad (≈ 121 en la L4). Usa siempre el denso: la sparsity exige un modelo podado con ese patrón.' },
      { id: 'm04-13', kind: 'numero', q: 'Memoria y ancho de banda de T4, L4, A10G, A100 y H100 SXM.',
        a: 'T4: 16 GB, 320 GB/s · L4: 24 GB, 300 GB/s · A10G: 24 GB, 600 GB/s · A100: 40 GB y 1,555 GB/s (p4d) u 80 GB y 2,039 GB/s (SXM, p4de) · H100 SXM: 80 GB, 3.35 TB/s.' },
      { id: 'm04-14', kind: 'numero', q: 'Precio aproximado por GPU-hora on-demand en AWS (us-east-1) de T4, L4, A10G, A100 y H100.',
        a: '≈ US$0.53 (g4dn.xlarge), ≈ 0.80 (g6.xlarge), ≈ 1.01 (g5.xlarge), ≈ 2.75–3.43 (p4d/p4de ÷ 8), ≈ 6.88 (p5). Aproximados a sept. 2026: verifica, los precios de P4/P5 bajaron en 2025.' },
      { id: 'm04-15', kind: 'concepto', q: '¿Qué GPUs soportan BF16 y FP8?',
        a: 'T4 (Turing): ninguno. A10G y A100 (Ampere): BF16, no FP8. L4 y L40S (Ada) y H100 (Hopper): los dos. Blackwell agrega FP4.' },
      { id: 'm04-16', kind: 'tradeoff', q: 'T4 vs L4 para el caso 1: ¿cuál y cuándo cambiarías?',
        a: 'Hoy T4: con N+1 y ≈ 5 % de carga manda el precio por hora (2 × T4 ≈ US$768/mes contra 2 × L4 ≈ US$1,175). A 10× el tráfico gana la L4 (≈ 10 T4 contra ≈ 5 L4, si el load test confirma ≈ 2.5× de throughput).' },
      { id: 'm04-17', kind: 'concepto', q: 'Fórmula del costo por 1,000 predicciones y el valor del c01.',
        a: 'US$/h ÷ (pred/s × 3,600 ÷ 1,000). T4 a su máximo medido (1,200 img/s) ≈ US$0.00012; a las 600 planificadas ≈ US$0.00024; con la carga real del c01 (2 GPUs, 116 req/s) ≈ US$0.0025: ≈ 10× la cuenta planificada y ≈ 20× la del máximo, porque la utilización real es ≈ 5 %.' },
      { id: 'm04-18', kind: 'tradeoff', q: 'MIG vs time-slicing vs varios modelos en un Triton.',
        a: 'MIG: particiones de hardware con memoria, fallas y latencia aisladas; solo A100/H100/H200/B200 y afines. Time-slicing: se turnan la GPU sin aislamiento de memoria ni garantías de latencia. Varios modelos en Triton: simple y eficiente, pero comparten VRAM y el proceso.' },
      { id: 'm04-19', kind: 'trampa', q: '¿Un slice 1g.10gb de H100 es una forma barata de servir un modelo chico?',
        a: 'No: ≈ US$6.88 ÷ 7 ≈ US$0.98/h, casi el doble que una T4 completa (≈ US$0.53/h), aunque traiga más cómputo. MIG rinde cuando ya pagas la GPU grande y necesitas aislar varios modelos con SLO.' },
      { id: 'm04-20', kind: 'concepto', q: '¿Qué cambia en la memoria de un Jetson respecto a una GPU de servidor?',
        a: 'Es unificada: CPU, GPU, DLA y video comparten la misma LPDDR5 (4–64 GB, 34–205 GB/s según el módulo). El OS y tu app le restan memoria al modelo, pero no hay copia por PCIe (zero-copy).' },
      { id: 'm04-21', kind: 'trampa', q: 'Hiciste el benchmark de tu detector en un AGX Orin en MAXN sobre la mesa. ¿Qué falta?',
        a: 'Medir en el modo de energía de producción (nvpmodel), con la carcasa y la temperatura reales (thermal throttling), con el engine construido para ese módulo y esa versión de JetPack, y con el pipeline de video completo compartiendo la memoria.' },
      { id: 'm04-22', kind: 'concepto', q: '¿Por qué un engine de TensorRT construido en tu laptop no sirve en el Jetson de producción?',
        a: 'Los engines dependen de la GPU exacta y de la versión de TensorRT: se construyen en el dispositivo o para el mismo módulo con la misma versión de JetPack. Actualizar JetPack en la flota implica reconstruir y revalidar.' },
      { id: 'm04-23', kind: 'tradeoff', q: '¿Cuándo sirves un modelo en CPU en vez de GPU?',
        a: 'Tabular/GBDT, CNNs chicas, QPS bajo, o cuando INT8 con VNNI/AMX cumple el SLO sin perder accuracy (c01: ≈ 7–21 vCPU en el pico si da 8–25 ms por imagen por vCPU). Ganas un tier menos, sin engine atado a una GPU ni cold start de nodos GPU.' },
      { id: 'm04-24', kind: 'frase', q: '¿Cómo justificas en inglés la elección de GPU del caso 1?',
        a: '"The model is about 50 MB and we\'re at roughly 5% average load, so cost per GPU-hour is the binding constraint. I\'d use two T4s for N+1, and revisit L4s if traffic grows several-fold."' },
      { id: 'm04-25', kind: 'frase', q: '¿Cómo explicas en inglés por qué el decode de un LLM es lento?',
        a: '"Decoding is memory-bandwidth bound: every generated token streams all the weights from GPU memory, so without speculative decoding, tokens per second is capped at roughly bandwidth divided by model size."' },
      { id: 'm04-26', kind: 'frase', q: '¿Cómo dices en inglés qué limita la concurrencia de un LLM?',
        a: '"The KV cache, not compute, limits how many concurrent sequences we can serve on this GPU."' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'arithmetic intensity', es: 'intensidad aritmética', def: 'FLOPs que hace una carga por cada byte que lee de la memoria. Baja (≈ 1 FLOP/B en el decode de un LLM) → memory-bound; alta (convoluciones a batch moderado) → compute-bound.', say: 'LLM decoding has an arithmetic intensity of about one FLOP per byte, so it is memory-bound.' },
      { en: 'roofline model', es: 'modelo roofline', def: 'Modelo que acota el rendimiento de una carga por el mínimo entre el cómputo pico y la intensidad aritmética × el ancho de banda de memoria.', say: 'A quick roofline estimate tells me whether to buy bandwidth or compute.' },
      { en: 'ridge point', es: 'punto de quiebre (del roofline)', def: 'FLOPS pico ÷ ancho de banda de una GPU: la intensidad a partir de la cual deja de mandar la memoria. T4 ≈ 200 FLOPs/B; H100 SXM ≈ 295.', say: 'The T4\'s ridge point is about 200 FLOPs per byte, far above what decoding needs.' },
      { en: 'compute-bound', es: 'limitado por cómputo', def: 'Carga cuyo tiempo lo fija la velocidad de los núcleos: la memoria entrega datos más rápido de lo que se procesan. Típico de CNNs a batch moderado y del prefill.', say: 'The CNN is compute-bound at batch 32, so FP16 tensor cores matter.' },
      { en: 'memory-bound', es: 'limitado por memoria', def: 'Carga cuyo tiempo lo fija el ancho de banda de memoria: los núcleos esperan datos. Típico del decode de LLMs a batch chico.', say: 'Since decoding is memory-bound, INT8 weights roughly double the token rate.' },
      { en: 'memory bandwidth', es: 'ancho de banda de memoria', def: 'Bytes por segundo que la GPU lee o escribe en su memoria: 300 GB/s en una L4, 3.35 TB/s en una H100 SXM. Fija el techo del decode de un LLM.', say: 'For LLM serving I compare GPUs by memory bandwidth first, not by TFLOPS.' },
      { en: 'VRAM', es: 'memoria de la GPU', def: 'Memoria propia de una GPU discreta (GDDR6 o HBM). Guarda pesos, activaciones, workspace del runtime y KV cache; su capacidad decide qué cabe.', say: 'The model uses a few gigabytes of VRAM, so a 16 GB T4 is plenty.' },
      { en: 'HBM', es: 'memoria de alto ancho de banda', def: 'High Bandwidth Memory: memoria apilada junto al chip, con terabytes por segundo (A100, H100, H200). Las GPUs de gama media de este módulo usan GDDR6, más barata y lenta (300–600 GB/s).', say: 'HBM is what gives the H100 its 3.35 terabytes per second of bandwidth.' },
      { en: 'tensor core', es: 'tensor core', def: 'Unidad de la GPU especializada en multiplicar matrices en precisión reducida (FP16, BF16, FP8, INT8). Da el cómputo alto de las hojas de datos; FP32 puro no la usa.', say: 'TensorRT in FP16 runs the convolutions on tensor cores.' },
      { en: 'SM (streaming multiprocessor)', es: 'multiprocesador de la GPU', def: 'Bloque de cómputo de una GPU NVIDIA, con sus CUDA cores y tensor cores (40 en una T4, 132 en una H100 SXM). MIG reparte SMs entre instancias.', say: 'Each MIG slice gets a fixed share of the SMs.' },
      { en: 'SXM', es: 'SXM (formato de módulo)', def: 'Formato de GPU de NVIDIA montado en la placa del servidor, con más potencia y NVLink entre GPUs; la alternativa es la tarjeta PCIe.', say: 'The SXM H100 has more bandwidth than the PCIe version.' },
      { en: 'structured sparsity (2:4)', es: 'sparsity estructurada 2:4', def: 'Patrón en el que 2 de cada 4 pesos son cero, que los tensor cores (Ampere en adelante) pueden saltar. NVIDIA publica TFLOPS "with sparsity" que duplican los densos; úsalos solo si podaste el modelo así.', say: 'That TFLOPS figure assumes 2:4 structured sparsity, so I halve it for a dense model.' },
      { en: 'TOPS', es: 'tera operaciones por segundo', def: 'Billones de operaciones enteras (normalmente INT8) por segundo. Los TOPS de edge suelen incluir sparsity y sumar varios aceleradores: no se comparan entre fabricantes.', say: 'The 275 TOPS figure is sparse INT8 across the GPU and the DLAs, so I benchmark instead.' },
      { en: 'TDP', es: 'potencia de diseño térmico', def: 'Potencia máxima que la tarjeta disipa y para la que se diseña su enfriamiento (70 W en la T4, hasta 700 W en la H100 SXM). En tarjetas pasivas o en edge, limita los clocks sostenidos.', say: 'The T4 is a 70-watt passive card, so it throttles under sustained load.' },
      { en: 'BF16', es: 'bfloat16', def: 'Formato de 16 bits con el rango de FP32 (8 bits de exponente) y 7 bits de mantisa. Default de LLMs; tensor cores desde Ampere, no en la T4.', say: 'The model was trained in BF16, and the T4 has no BF16 support, so I\'d serve it on an L4.' },
      { en: 'FP8', es: 'punto flotante de 8 bits', def: 'Formatos de 1 byte (E4M3, E5M2) con escalas, acelerados en Ada (L4, L40S) y Hopper (H100). Reduce memoria y aumenta throughput en LLMs con pérdida pequeña si se calibra.', say: 'On the H100 we can serve the weights and the KV cache in FP8.' },
      { en: 'TF32', es: 'TensorFloat-32', def: 'Modo de cómputo de los tensor cores (Ampere en adelante) que opera tensores FP32 con 10 bits de mantisa. Acelera matmuls "FP32" sin cambiar código ni ahorrar memoria.', say: 'TF32 speeds up FP32 matmuls on Ampere, but it doesn\'t reduce memory.' },
      { en: 'weight-only quantization', es: 'cuantización solo de pesos', def: 'Guardar los pesos en INT8 o INT4 (con escalas por grupo) y descuantizarlos al vuelo, manteniendo activaciones en 16 bits. Ataca el cuello del decode: bytes leídos por token.', say: 'Weight-only INT4 cuts the 8B model to about 5 GB and speeds up memory-bound decoding.' },
      { en: 'KV cache', es: 'caché de keys y values', def: 'Keys y values de los tokens anteriores que un LLM guarda en VRAM para no recalcularlos. Crece con capas, KV heads, longitud y número de secuencias; limita la concurrencia.', say: 'At 128 KiB per token, the KV cache for an 8k-token conversation is about 1 GiB.' },
      { en: 'grouped-query attention (GQA)', es: 'atención de consultas agrupadas', def: 'Varias heads de query comparten una head de key/value. Llama 3 8B usa 8 KV heads para 32 de query: KV cache 4× más chico.', say: 'Thanks to grouped-query attention, the KV cache is four times smaller.' },
      { en: 'prefill and decode', es: 'prefill y decode', def: 'Las dos fases de generar texto: prefill procesa el prompt completo de una vez (compute-bound, fija el time to first token); decode genera un token por paso (memory-bound, fija el tiempo por token).', say: 'Prefill is compute-bound and drives time to first token; decode is bandwidth-bound.' },
      { en: 'CUDA context', es: 'contexto de CUDA', def: 'Estado que el driver crea por proceso en cada GPU (más las librerías cargadas): cientos de MB de VRAM antes de cargar un solo peso.', say: 'Each extra process pays for its own CUDA context, so I keep one server process per GPU.' },
      { en: 'MIG (Multi-Instance GPU)', es: 'GPU multi-instancia', def: 'Partición por hardware de una GPU (A30, A100, H100, H200, B200 y afines) en hasta 7 instancias con SMs, caché, memoria y ancho de banda propios. No existe en T4, L4, A10G ni L40S.', say: 'With MIG, each model gets its own slice with isolated memory and predictable latency.' },
      { en: 'GPU time-slicing', es: 'reparto de GPU por turnos', def: 'Configuración del device plugin de Kubernetes que anuncia varias "GPUs" por GPU física; los pods se turnan sin aislamiento de memoria ni de fallas.', say: 'Time-slicing is fine for notebooks, but not for models with a latency SLO.' },
      { en: 'MPS (Multi-Process Service)', es: 'servicio multiproceso de CUDA', def: 'Servicio de NVIDIA que deja correr kernels de varios procesos a la vez en una GPU. Mejor utilización que time-slicing, con aislamiento parcial.', say: 'MPS lets several small processes share the GPU concurrently, but a fatal fault can affect all of them.' },
      { en: 'unified memory (Jetson)', es: 'memoria unificada', def: 'En Jetson, CPU, GPU y aceleradores comparten la misma RAM física. No hay copia por PCIe, pero el OS y la app compiten con el modelo por capacidad y ancho de banda.', say: 'On the Jetson the memory is unified, so the OS and the video pipeline eat into the model\'s budget.' },
      { en: 'DLA (Deep Learning Accelerator)', es: 'acelerador de deep learning', def: 'Hardware de función fija en Orin NX y AGX Orin que corre capas de CNN en INT8/FP16 con bajo consumo, en paralelo con la GPU; lo no soportado cae a la GPU.', say: 'We could offload the backbone to the DLA and keep the GPU free for the tracker.' },
      { en: 'JetPack', es: 'JetPack', def: 'SDK de NVIDIA para Jetson: Jetson Linux (L4T) más versiones fijas de CUDA, cuDNN y TensorRT. Los engines se construyen para una versión concreta.', say: 'Upgrading JetPack across the fleet means rebuilding and revalidating every engine.' },
      { en: 'nvpmodel', es: 'modo de energía de Jetson', def: 'Herramienta que fija el modo de energía de un Jetson (tope de watts, clocks, cores activos). La latencia medida solo vale para el modo en que mediste.', say: 'I benchmark in the same nvpmodel power mode we\'ll run in production.' },
      { en: 'thermal throttling', es: 'reducción térmica de frecuencia', def: 'El chip baja sus clocks para no sobrecalentarse cuando el enfriamiento no alcanza. Aparece en tarjetas pasivas bajo carga sostenida y en edge dentro de cajas selladas.', say: 'Inside a sealed enclosure the module thermal-throttles, so we test at the real ambient temperature.' },
      { en: 'cost per 1,000 predictions', es: 'costo por 1,000 predicciones', def: 'US$ por hora ÷ (predicciones por segundo × 3,600 ÷ 1,000), con la utilización real. Compara hardware mejor que el precio por hora.', say: 'On paper the L4 is cheaper per thousand predictions, but at 5% utilization the T4 wins.' },
      { en: 'AWS Inferentia', es: 'AWS Inferentia', def: 'Chip de AWS para inferencia (instancias inf2), programado con el Neuron SDK. Puede bajar el costo por inferencia en modelos soportados, a cambio de lock-in.', say: 'Inferentia could be cheaper per inference, but it means compiling with Neuron and locking into AWS.' },
      { en: 'TPU', es: 'unidad de procesamiento tensorial', def: 'Acelerador de Google, solo en Google Cloud, programado vía XLA (JAX, TensorFlow, PyTorch/XLA) con formas estáticas.', say: 'TPUs make sense if we are already on GCP and the model compiles cleanly with XLA.' },
      { en: 'NVLink', es: 'NVLink', def: 'Interconexión directa entre GPUs NVIDIA, mucho más rápida que PCIe. Es lo que hace eficiente partir un modelo entre GPUs de un mismo nodo.', say: 'Tensor parallelism across the 8 GPUs works well because they are connected with NVLink.' },
      { en: 'tensor parallelism', es: 'paralelismo de tensores', def: 'Partir cada capa de un modelo entre varias GPUs que calculan su parte y se sincronizan en cada capa. Permite servir modelos que no caben en una GPU; necesita interconexión rápida.', say: 'A 70B model in BF16 needs tensor parallelism across at least two 80 GB GPUs.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
