/* =============================================================================
   Ronda de Diseño ML — js/content/c07-archivos.js
   Caso 07, sección 13 "Archivos de referencia": los archivos REALES de
   reference/c07/ (embebidos en MSD.files por tools/embed-reference.mjs) agrupados
   por capa, con el porqué de cada uno, trampas y cómo correrlos.
   Contrato: docs/SPEC.md §5.5, §6 (fila 13), §8g. Sin DOM: se carga también en Node.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Enlaces internos cortos: sección de este caso y cualquier página o sección del curso.
  const C = (sec, txt) => '<a href="#c07.' + sec + '">' + txt + '</a>';
  const L = (hash, txt) => '<a href="#' + hash + '">' + txt + '</a>';
  const E = (txt) => '<span class="est">' + txt + '</span>';
  // Archivo embebido: el nombre visible es la ruta dentro de reference/c07/.
  const F = (path, lang, note) => ({ name: path, lang, src: 'c07/' + path, note });

  MSD.addSection('c07', {
    id: 'archivos',
    title: 'Archivos de referencia',
    titleEn: 'Reference files',
    blocks: [
      { t: 'p', html: 'Esto no es pseudocódigo: son los archivos de <code>reference/c07/</code>, probados hasta donde se puede sin GPU, sin Kafka, sin un motor vectorial y sin Redis. Hay cinco piezas: el <code>embed-worker</code> que mantiene el índice al día (idempotente, sin mezclar versiones de modelo, con tombstones para lo vendido), un benchmark de FAISS que mide recall, memoria y latencia de HNSW, IVF-PQ e IVF-Flat contra la búsqueda exacta, el <code>search-api</code> híbrido (ANN y BM25 en paralelo, RRF, timeouts y fallbacks, la versión del modelo tomada del alias del índice), la evaluación offline con NDCG@10 y recall, y las 8 alertas con sus tests. Cada línea importante trae un comentario con el <b>porqué</b>. Son la versión concreta de lo que defiendes en ' + C('datos', 'datos') + ', ' + C('serving', 'serving') + ', ' + C('evaluacion', 'evaluación') + ', ' + C('monitoreo', 'monitoreo') + ' y ' + C('fallas', 'fallas') + ': qué pasa con una búsqueda cuando un shard no contesta, por qué un vendido desaparece en segundos aunque siga en el grafo, y cómo sabes que el ANN encuentra lo mismo que la búsqueda exacta.' },
      { t: 'callout', kind: 'skip',
        html: 'En la entrevista nadie te pide escribir el worker ni recordar los parámetros de FAISS. Primera pasada: el mapa, los callouts de trampas y las dos tablas de resultados medidos. Lo que sí debes poder decir sin mirar: BM25 y el ANN corren <b>en paralelo</b>, cada fuente con su timeout, y la búsqueda se sirve con las que contesten; RRF fusiona por <b>posiciones</b> porque los scores no son comparables; los filtros van <b>dentro</b> de la búsqueda (el post-filtro deja páginas vacías); lo vendido sale por un <b>tombstone</b> consultado en cada búsqueda, porque borrar de HNSW es caro; un índice tiene <b>un solo</b> <code>model_version</code>, y la API le pide al encoder la versión del índice al que apunta el alias; y hay dos recalls distintos: el del ANN contra la búsqueda exacta (sin humanos) y el de la búsqueda contra etiquetas humanas.' },
      { t: 'callout', kind: 'note', title: 'Qué se ejecutó y qué no',
        html: '<ul>' +
          '<li><b>Ejecutado</b> (Mac M4, sin GPU, sin Kafka, sin OpenSearch, sin Redis, sin daemon de Docker): 88 tests de las tres carpetas con pytest en un venv limpio con Python 3.13.15 (el de la imagen). El <code>search-api</code> con TestClient y fakes que tardan 1–2 s, fallan, sirven otro modelo, no traen títulos o ignoran el filtro; además, la demo con uvicorn real y curl. <code>build_index.py</code> con 200,000 vectores sintéticos × 512 y FAISS 1.15.1 (≈ 2 min): los bytes por vector medidos coinciden con la fórmula de la wiki de FAISS. Un test confirma que <code>IndexHNSWFlat</code> no implementa <code>remove_ids</code>. <code>promtool check rules</code> y <code>promtool test rules</code> de Prometheus 3.15.0 (binario oficial con sha256 verificado): los 14 escenarios pasan, y cambiar cualquiera de los 12 umbrales hace fallar su test. Los 20 paquetes de los dos locks tienen wheel para Linux y Python 3.13, la imagen base existe en Docker Hub y el <code>Dockerfile</code> se parseó con dockerfile-parse.</li>' +
          '<li><b>No ejecutado</b>: no hay adaptadores reales del encoder, de los shards, de OpenSearch, de Redis ni de Kafka. <code>build_app</code> y <code>build_worker</code> lanzan <code>NotImplementedError</code> y documentan qué conectar, porque no se publica código de red sin probar. Las latencias por etapa del caso son estimaciones y los timeouts son techos razonables, no medidos contra un sistema real. El recall del benchmark es de vectores sintéticos: el de tus embeddings puede ser otro (en particular el de PQ). No se construyó la imagen ni se aplicó nada a un cluster. El canary de recall, la auditoría de vendidos y el pipeline de clics no existen aquí: sus métricas solo aparecen en los tests de promtool. El <code>README.md</code> de <code>reference/c07</code> trae la tabla completa.</li>' +
          '</ul>' },

      { t: 'h3', text: 'Mapa: qué sección del caso implementa cada archivo' },
      { t: 'table',
        head: ['Archivo', 'Implementa', 'Qué mirar'],
        rows: [
          ['<code>embed_worker.py</code> <small>indexing</small>', C('datos', '6 · Datos') + ', ' + C('fallas', '10 · Fallas'), 'Idempotencia por (listing_id, event_version); bajas primero (tombstone, después el grafo); re-embeber solo si cambió título, atributos de texto o foto; se niega a escribir con otro <code>model_version</code>; DLQ para lo envenenado; commit al final'],
          ['<code>build_index.py</code> <small>indexing</small>', C('estimaciones', '4 · Estimaciones') + ', ' + C('tradeoffs', '11 · Trade-offs'), 'HNSW-Flat, HNSW-SQ8 (+ re-score) e IVF-PQ contra <code>IndexFlatIP</code>; bytes por vector medidos vs fórmula; post-filtro vs filtro dentro vs exacto; la memoria a 100 M'],
          ['<code>api.py</code>, <code>Dockerfile</code> <small>search</small>', C('serving', '7 · Serving') + ', ' + C('fallas', '10 · Fallas') + ', ' + L('m07.fastapi', 'M7'), 'BM25 sin esperar al encoder; la versión del alias pedida al encoder y chequeada por shard; 4 shards en paralelo con timeout; RRF; filtros como defensa; tombstones; rerank del top-30 solo en la página 0; la escalera de fallbacks; el log sin PII'],
          ['<code>fusion.py</code> <small>search</small>', C('serving', '7 · Serving'), 'RRF con k = 60, listas faltantes, duplicados y empates deterministas'],
          ['<code>fakes.py</code>, <code>tests/</code> <small>search</small>', C('fallas', '10 · Fallas'), 'Un fake por dependencia con <code>delay_s</code> y <code>fail</code>: cada test es un modo de falla'],
          ['<code>offline_eval.py</code> <small>eval</small>', C('evaluacion', '8 · Evaluación') + ', ' + L('m09.etiquetado', 'M9'), 'NDCG@10 con grados 0–3, IDCG con todos los juzgados, judged@10, knn-recall, bootstrap por queries y pareado'],
          ['<code>alerts.yml</code>, <code>alerts_test.yml</code> <small>monitoring</small>', C('monitoreo', '9 · Monitoreo') + ', ' + L('m12.runbooks', 'M12'), 'Las 8 alertas, 10 recording rules (lag en segundos, frescura p95 por operación, comparación con la semana pasada) y 14 escenarios de promtool'],
        ],
        note: 'Orden de lectura sugerido: <code>fusion.py</code> → <code>api.py</code> → <code>test_api.py</code> → <code>embed_worker.py</code> → <code>build_index.py</code> (córrelo) → <code>offline_eval.py</code> → <code>alerts.yml</code>. Primero la consulta que la persona espera en 300 ms, después cómo se mantiene el índice y al final cómo se mide y se opera.' },

      // ------------------------------------------------------------------ search-api
      { t: 'h3', text: 'El search-api: híbrido, en paralelo y con fallbacks' },
      { t: 'code', title: 'FastAPI con ANN ∥ BM25, RRF, tombstones y rerank',
        caption: 'Sin numpy, Pillow ni torch en la imagen. <code>cd reference/c07 &amp;&amp; pytest search/tests</code>: 46 tests en ≈ 2 s. Demo: <code>uvicorn --factory api:demo_app</code> desde <code>search/</code>.',
        files: [
          F('search/api.py', 'python', 'Léelo desde <code>Searcher.search</code>. BM25 no necesita el embedding, así que arranca <b>ya</b>, en paralelo con encoder → shards. La versión del modelo no se configura: <code>AliasResolver</code> lee a qué índice apunta el alias <code>listings-vec-live</code> (con caché de 5 s) y el encoder recibe <b>esa</b> versión; si Triton no la tiene cargada, la consulta de texto va a BM25 solo (<code>encoder_version_unavailable</code>). Cada llamada va con <code>asyncio.wait_for</code> y su techo (encoder de texto 50 ms, cada shard 80 ms, BM25 120 ms, tombstones 20 ms, textos del top-30 20 ms, rerank 100 ms): el camino más largo de texto suma 270 ms, dentro del SLO de 300. <code>_shard_search</code> descarta la respuesta de un shard que viene de otro modelo (y fuerza a releer el alias) y, si el motor no sabe filtrar adentro, pide 4× candidatos y filtra aquí (y cuenta cuando ni así alcanza). Después de RRF se re-chequean los filtros: un adaptador con un bug no le muestra a nadie un listing de otra ciudad. El reranker lee título + atributos del caché de listings, no de los hits: el índice vectorial no guarda títulos. El rerank solo corre en la página 0: re-ordena dentro del top-30, que cabe entero en la primera página de 48, así que las siguientes no cambian y no se paga GPU por ellas. La foto viaja como bytes a Triton, que la decodifica: la API solo mira la firma del archivo. El log enmascara teléfonos y correos con <code>scrub_pii</code> antes de escribir la consulta. <code>/readyz</code> es local: no mira versiones ni dependencias.'),
          F('search/fusion.py', 'python', 'El docstring trae la cuenta a mano: 1.º en ANN y 3.º en BM25 = 1/61 + 1/63 ≈ 0.0323; 20.º en las dos = 2/80 = 0.025, que le gana al 1.º de una sola lista (1/61 ≈ 0.0164). RRF premia el acuerdo. Un id repetido en la misma lista cuenta una vez; una lista que falta no resta; los empates se ordenan por score, mejor posición, cantidad de listas e id, para que dos requests iguales sobre el mismo catálogo den el mismo orden (sin cambios de catálogo entre páginas, la página 2 no repite la 1).'),
          F('search/tests/test_api.py', 'python', 'Cada test es un modo de falla: el encoder tarda 2 s y la búsqueda sale en menos de 0.5 s solo con BM25 (<code>model_version: null</code>); cuatro shards de 1 s no suman 4 s; un shard caído da <code>ann_partial:shard-1</code>; BM25 caído sirve solo ANN; todo caído es 503 con <code>Retry-After</code>; Redis caído deja pasar el vendido y lo cuenta; un shard con el modelo anterior se descarta; el alias pasa a v8 y la siguiente consulta pide v8 al encoder; un encoder sin la versión del alias cae a BM25 (y una foto, a 503); <code>/readyz</code> sigue en 200 con todo eso roto; el reranker recibe textos no vacíos aunque ninguna fuente traiga títulos; un adaptador que dice filtrar y no filtra no llega a la persona; una foto nunca toca BM25 ni el reranker; el log escribe <code>[tel]</code> y <code>[email]</code>, no el teléfono ni el correo. Y un test que lee <code>alerts.yml</code> y exige que cada <code>search_*</code> exista en <code>/metrics</code>.'),
          F('search/fakes.py', 'python', 'El "embedding" de juguete promedia vectores fijos por palabra: no sabe que "chamarra" y "chaqueta" se parecen, pero da vectores deterministas para probar el cableado. Los shards reparten el catálogo por hash del id, como el adaptador real, y devuelven id, coseno y atributos de filtro, sin título, como un índice que llena el <code>embed-worker</code>.'),
          F('search/tests/test_fusion.py', 'python', 'Los números del docstring, listas faltantes, duplicados, empates que no dependen del orden del dict, y el ejemplo de que k es un hiperparámetro: con k = 1 gana el 1.º de una lista; con k = 60, el 5.º en las dos.'),
          F('search/Dockerfile', 'dockerfile', 'Base <code>python:3.13.15-slim-trixie</code> (' + E('≈ 43 MB') + ' comprimida): la API no toca la GPU ni decodifica fotos, todo lo pesado está detrás de la red. <code>fakes.py</code> y los tests no entran a la imagen. Un proceso uvicorn por contenedor.'),
          F('search/requirements.txt', 'text', 'El lock completo (17 paquetes), generado con <code>uv pip compile</code> para Linux x86_64 y Python 3.13. Sin numpy ni Pillow: la API pasa el vector a los shards y los bytes de la foto a Triton.'),
        ] },
      { t: 'table', caption: 'La escalera de fallbacks que implementa <code>api.py</code> (cada escalón sale en <code>degraded</code> y en <code>search_degraded_total</code>)',
        head: ['Falla', 'Texto', 'Foto'],
        rows: [
          ['Encoder lento o caído', 'Solo BM25 (<code>encode_timeout</code>, <code>ann_unavailable</code>)', '503 con <code>Retry-After</code>: no hay fallback por palabras'],
          ['El encoder no tiene la versión del índice del alias', 'Solo BM25 (<code>encoder_version_unavailable</code>)', '503'],
          ['Algunos shards vencen', 'Resultados parciales (<code>ann_partial:shard-N</code>) + BM25', 'Resultados parciales'],
          ['Todos los shards vencen', 'Solo BM25', '503'],
          ['BM25 falla', 'Solo ANN (<code>bm25_error</code>)', 'No aplica'],
          ['ANN y BM25 fallan', '503 con <code>Retry-After</code>', '503'],
          ['Tombstones no responden en 20 ms', 'Se sirve igual y se cuenta (<code>tombstones_unchecked</code>)', 'Igual'],
          ['Caché de textos o reranker no llegan', 'Orden de RRF (<code>rerank_skipped</code>)', 'No aplica'],
          ['Shard que contesta con otro <code>model_version</code>', 'Se descarta esa respuesta (<code>ann_partial</code>) y se relee el alias; <code>/readyz</code> no cambia', 'Igual'],
        ],
        note: 'El piso de la escalera es la búsqueda de hoy: BM25 con los mismos filtros. Por eso el sistema nuevo nunca es peor que el viejo cuando falla la parte semántica.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: sumar el score de BM25 y el coseno',
        html: 'BM25 da números de 0 a ' + E('≈ 30') + ' que dependen de la consulta y del largo del texto; el coseno va de −1 a 1. Sumarlos (o normalizarlos con min-max por consulta) hace que una fuente domine sin que nadie lo decida, y un outlier mueve toda la lista. RRF usa solo posiciones y no hay que calibrar nada. Lo que sí pagas: RRF ignora qué tan seguro estaba cada sistema. Un modelo aprendido de fusión puede ganarle, pero necesita labels y se valida con interleaving (' + L('m11.interleaving-bandits', 'M11') + ').' },
      { t: 'callout', kind: 'trap', title: 'Trampa: post-filtrar',
        html: 'Pedir el top-200 al ANN y <b>después</b> quitar lo que no cumple el filtro. Con una ciudad que tiene el 0.2 % del catálogo quedan ≈ 0.4 resultados: páginas vacías aunque existan cientos de listings que cumplen. <code>build_index.py</code> lo mide (69 % de páginas vacías) y <code>test_api.py</code> lo reproduce con un shard que solo post-filtra. El filtro va <b>dentro</b> de la búsqueda; el over-fetch (pedir 4×) es un parche que se cuenta en <code>search_postfilter_underfilled_total</code>, no una solución.' },
      { t: 'callout', kind: 'senior', title: 'Señal senior: el search-api sigue al alias',
        html: 'Un vector de la v8 contra un índice de la v7 no da error: da resultados plausibles y malos, con 200 OK. Un alias se mueve en una operación atómica; una flota de pods no se actualiza toda en el mismo instante. Por eso la versión no se despliega en dos lugares: el <code>search-api</code> sigue al alias y pide al encoder esa versión; durante el swap (' + L('m11.blue-green', 'M11') + ') el encoder tiene v7 y v8 cargadas. Segunda defensa: cada shard devuelve su <code>model_version</code> y la API descarta la respuesta que no coincide con la versión que pidió. Y <code>/readyz</code> no mira versiones: si lo hiciera, en el swap todos los pods saldrían del balanceador a la vez y se caería también BM25. Del lado de la escritura, el <code>embed-worker</code> se niega a escribir un batch que vino de otro modelo. Decirlo así le muestra al entrevistador que pensaste en el estado intermedio del deploy, que es donde se rompen estos sistemas.' },

      // ------------------------------------------------------------------ embed-worker
      { t: 'h3', text: 'El embed-worker: el índice al día sin mezclar versiones' },
      { t: 'code', title: 'Kafka → GPU → índice, idempotente y con tombstones',
        caption: 'numpy y prometheus-client. <code>pytest indexing/tests/test_embed_worker.py</code>: 18 tests con fakes de Kafka, GPU, índice y stores.',
        files: [
          F('indexing/embed_worker.py', 'python', 'El docstring trae las cuatro garantías. <code>process()</code> colapsa el batch (por listing gana la versión más alta), compara contra la última versión aplicada y clasifica: <b>bajas</b> (tombstone primero, después marcar en el índice), <b>solo atributos</b> (cambió precio o ciudad: el vector sería el mismo, no se toca la GPU) y <b>a embeber</b>. Un evento con versión menor o igual a la aplicada se ignora: así un <code>updated</code> atrasado no resucita un <code>sold</code>. Un listing removido vuelve solo con una versión más nueva (una apelación ganada). El <code>Embedder</code> marca en NaN la fila de una foto que no baja, y esa fila va a la DLQ; un error del servicio (GPU, Triton) se reintenta y, si sigue, el worker se cae sin commitear. Cada batch de vectores llega con el <code>model_version</code> que de verdad lo calculó (Triton lo devuelve en cada respuesta) y se compara con el del índice antes del upsert. El estado de versiones es <b>por índice</b> (<code>state:{index}:{listing_id}</code>): en un blue/green, el worker de green relee los eventos que el de blue ya aplicó, y con un estado compartido los tiraría como viejos. Los tombstones sí se comparten, una key por listing con su propio vencimiento de 7 días.'),
          F('indexing/tests/test_embed_worker.py', 'python', 'Duplicado que no se re-procesa; <code>updated</code> v4 después de <code>sold</code> v5 que no resucita nada; removido y reactivado con v3; <code>created</code> + <code>sold</code> en el mismo batch que ni llega a la GPU; cambio de precio sin re-embeber y cambio de título que sí; un tombstone a 45 s que cae en el bucket ≤ 60; JSON roto a la DLQ sin frenar el batch; un vector NaN a la DLQ y el resto escrito; modelo distinto que no arranca, modelo recargado en caliente y una respuesta de otro modelo aunque el adaptador diga lo contrario, los tres detectados antes de escribir; dos workers (v7 y v8) sobre el mismo Redis, y green recibe todo; GPU que falla dos veces y se recupera; GPU caída que no commitea.'),
          F('indexing/requirements.txt', 'text', 'faiss-cpu 1.15.1 tiene wheels abi3 para macOS 14+ arm64 y Linux (manylinux_2_28): el benchmark corre igual en una Mac y en CI. El worker en sí solo usa numpy y prometheus-client.'),
        ] },
      { t: 'table', caption: 'Qué hace el worker con cada evento de <code>listing-events</code>',
        head: ['Evento', 'Estado guardado', 'Acción', 'Por qué'],
        rows: [
          ['<code>created</code> v1', '—', 'Embeber → upsert con <code>model_version</code>', 'Buscable en p95 ≤ 5 min'],
          ['<code>updated</code> v2, cambió el precio', 'live, mismo <code>content_hash</code>', 'Solo atributos de filtro', 'La mayoría de las ediciones; GPU ahorrada'],
          ['<code>updated</code> v3, cambió el título', 'live, otro hash', 'Embeber de nuevo → upsert', 'El vector cambia'],
          ['<code>sold</code> v5', 'live', 'Tombstone (Redis) → marcar borrado en el índice', 'Fuera en ≤ 1 min; el grafo se limpia en el rebuild'],
          ['<code>updated</code> v4 (llega tarde)', 'gone v5', 'Nada (<code>stale</code>)', 'No resucitar lo vendido'],
          ['<code>updated</code> v6 tras un <code>removed</code> v5', 'gone v5', 'Embeber → upsert → quitar el tombstone', 'Reactivado de verdad (versión más nueva)'],
          ['JSON roto o tipo desconocido', '—', 'DLQ, se commitea', 'Un mensaje envenenado no frena la partición'],
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: "borro el vector del índice y listo"',
        html: 'Borrar de un grafo HNSW es caro o no existe: en FAISS, <code>remove_ids</code> ni siquiera está implementado para HNSW (hay un test que lo comprueba), y los motores que lo soportan marcan el nodo y lo limpian al reconstruir. Si la promesa es "un vendido desaparece en ≤ 1 min", el borrado del grafo no la cumple. La cumple un <b>tombstone</b> en un store rápido que el <code>search-api</code> consulta en cada búsqueda (un MGET de los ≤ 400 candidatos en un round trip). En Redis es una key por listing (<code>SET tomb:{id} &lt;ts&gt; EX 604800</code>): un Redis Set tiene un solo vencimiento para todos sus miembros, así que o se borran todos los tombstones a la vez o no se borra ninguno. El costo: los borrados marcados se acumulan en el grafo hasta el rebuild del shard, y eso se ve en <code>ShardMemoryHigh</code> y <code>ANNRecallDrop</code>.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: idempotencia por offset de Kafka',
        html: 'Kafka entrega al menos una vez (' + L('m02.entrega-reintentos', 'M2') + '), y el offset no ordena lo que importa: un outbox que re-publica o un backfill pueden traer un evento viejo <i>después</i> de uno nuevo. Lo que ordena es la versión que pone la <b>fuente</b> (listing-service), y el store de versiones escribe solo si la versión es mayor (compare-and-set), para que dos réplicas que se pisan en un rebalanceo no la bajen. Ese estado es por índice: el worker de un índice nuevo tiene que poder aplicar lo que el del viejo ya aplicó.' },

      // ------------------------------------------------------------------ benchmark
      { t: 'h3', text: 'Cuánto cuesta un índice: build_index.py' },
      { t: 'code', title: 'FAISS sobre vectores sintéticos: recall, memoria, latencia y filtros',
        caption: '<code>python indexing/build_index.py --n 50000 --queries 300</code> (≈ 20 s) o sin argumentos (200k × 512, ≈ 2 min). <code>pytest indexing/tests/test_build_index.py</code>: 9 tests con N chico.',
        files: [
          F('indexing/build_index.py', 'python', 'Arriba están las fórmulas sin FAISS (<code>memory_per_vector</code>, <code>extrapolate</code>): un test verifica que dan los números del caso (204.8 / 102.4 / 51.2 / 6.4 GB y 25.6 GB de grafo). Después construye cada índice, mide recall@10 y recall@100 contra <code>IndexFlatIP</code> (brute force), los bytes por vector serializando el índice y la latencia de <b>una</b> consulta con <b>un</b> hilo, que es como llega cada búsqueda online. <code>with_refine</code> es el re-score de 200 candidatos con float32 del caso. IVF-PQ se mide con <code>nprobe</code> 1, 4, 16 y 64, y IVF-Flat (mismas listas, sin comprimir) separa la pérdida de IVF de la de PQ. <code>filtered_experiment</code> compara post-filtro, filtro dentro del HNSW (<code>IDSelector</code>) y búsqueda exacta sobre el subconjunto.'),
          F('indexing/tests/test_build_index.py', 'python', 'Las fórmulas contra el caso, los bytes medidos dentro del 25 % de la fórmula, SQ8 más chico que Flat, <code>remove_ids</code> que falla en HNSW, el refine que sube el recall de IVF-PQ, el post-filtro que deja páginas vacías y la CLI completa con N chico.'),
        ] },
      { t: 'table', caption: 'Medido en una Mac M4 de 10 núcleos: 200,000 vectores sintéticos × 512, 1,000 queries, FAISS 1.15.1 (una consulta a la vez, un hilo, k = 100)',
        head: ['Índice', 'recall@10', 'recall@100', 'Bytes por vector', 'p50 / p99'],
        rows: [
          ['HNSW-Flat (M = 32, efSearch = 128)', '1.000', '0.999', '2,320', '0.38 / 0.78 ms'],
          ['HNSW-SQ8 (M = 32, efSearch = 128)', '0.975', '0.988', '784', '0.35 / 0.50 ms'],
          ['HNSW-SQ8 + re-score de 200 con float32', '1.000', '0.999', '784 + float32 aparte', '0.46 / 0.64 ms'],
          ['IVF-PQ64 (nlist = 2,048, nprobe = 1)', '0.212', '0.342', '96', '0.30 / 0.37 ms'],
          ['IVF-PQ64 (nprobe = 4)', '0.299', '0.546', '96', '0.30 / 0.38 ms'],
          ['IVF-PQ64 (nprobe = 16; igual con 64)', '0.308', '0.563', '96', '0.45 / 0.72 ms'],
          ['IVF-PQ64 + re-score de 200 (nprobe = 64)', '0.973', '0.822', '96 + float32 aparte', '0.48 / 0.86 ms'],
          ['IVF-Flat (nlist = 2,048, nprobe = 16)', '1.000', '1.000', '2,077', '0.30 / 0.41 ms'],
        ],
        note: '<code>nprobe</code> es la perilla de IVF: de 1 a 4 listas el recall sube; de 16 en adelante ya no se mueve. nprobe deja de importar cuando ya visitas las listas de los vecinos; el techo lo pone PQ, y IVF-Flat (las mismas listas sin comprimir) lo confirma con recall 1.000. Las filas de IVF con nprobe 1, 4 y 16 y la de IVF-Flat salen de una segunda corrida con la máquina ocupada: recall y bytes no cambian entre corridas, las latencias se mueven ± 50 %. Recall sintético ≠ recall real: son gaussianas alrededor de centros al azar, y el recall de HNSW y sobre todo el de PQ dependen de la estructura de tus embeddings. Úsalo para entender las perillas (SQ8 cuesta poco y el re-score lo recupera; PQ ahorra memoria y pierde mucho recall en estos datos), no como número de diseño. El número que vale es el del canary con vectores reales.' },
      { t: 'table', caption: 'Filtro por un atributo que no depende del contenido (como la ciudad), k = 48, mismo índice HNSW-Flat',
        head: ['Selectividad', 'Post-filtro sobre 200', 'Filtro dentro del HNSW', 'Exacto sobre el subconjunto'],
        rows: [
          ['0.2 % (400 vectores)', '0.4 resultados; 69 % de páginas vacías', '1.9 resultados; recall 0.03', '0.27 ms'],
          ['10 % (20,000 vectores)', '20 resultados; ninguna página llena', '48 resultados; recall 0.96', '12.4 ms'],
        ],
        note: 'Con un filtro muy selectivo, ni el post-filtro ni el grafo filtrado alcanzan: lo correcto es la búsqueda exacta sobre el subconjunto, que es barata justamente porque el subconjunto es chico. Con uno amplio, el grafo filtrado funciona. Algunos motores eligen solos (OpenSearch k-NN con el motor faiss pasa a búsqueda exacta cuando los ids filtrados son pocos: <code>knn.advanced.filtered_exact_search_threshold</code>); verifica cómo lo hace el tuyo (' + L('ref-herramientas.vector-dbs', 'bases vectoriales') + ').' },
      { t: 'calc', title: 'De bytes por vector a la memoria de los 100 M de listings (fórmulas, d = 512, M = 32)', rows: [
        { label: 'Vectores int8', expr: '100 M × 512 B', value: '51.2 GB' },
        { label: 'Grafo HNSW, nivel 0', expr: '100 M × 2 × 32 × 4 B', value: '25.6 GB', note: 'los niveles altos suman poco: medido 2,320 B vs 2,304 de fórmula en HNSW-Flat' },
        { label: 'HNSW-SQ8 total', expr: '51.2 + 25.6', value: '76.8 GB' },
        { label: 'Por shard', expr: '76.8 ÷ 4', value: '19.2 GB', note: 'el "≈ 19 GB por shard" del caso' },
        { label: 'float32 para el re-score', expr: '100 M × 512 × 4 B', value: '204.8 GB (51.2 por shard)', note: 'fuera del grafo: en EBS, servidos desde el page cache (la r7i no tiene disco local)' },
        { label: 'IVF-PQ64, por comparar', expr: '100 M × (64 + 8 de id) B', value: '7.2 GB' },
      ], result: 'IVF-PQ cuesta ' + E('≈ 10×') + ' menos RAM que HNSW-SQ8, y con estos datos pierde recall que el re-score solo recupera en parte. Por eso el caso elige HNSW sobre int8 con re-score y deja IVF-PQ como la alternativa cuando la RAM pase a ser el costo dominante (' + C('tradeoffs', 'trade-offs') + ').' },

      // ------------------------------------------------------------------ evaluación
      { t: 'h3', text: 'Evaluación offline: NDCG@10 y los dos recalls' },
      { t: 'code', title: 'Métricas por query, por segmento y con intervalo',
        caption: 'Solo biblioteca estándar. <code>pytest eval/tests</code>: 15 tests con casos que se calculan a mano.',
        files: [
          F('eval/offline_eval.py', 'python', 'NDCG@10 con ganancia exponencial: DCG = Σ (2<sup>grado</sup> − 1) / log<sub>2</sub>(posición + 1), e IDCG con <b>todos</b> los juzgados de la query, no solo con lo recuperado (si no, un sistema que nunca encuentra el 3 no se castiga). Una query sin nada relevante se excluye y se cuenta. Una query etiquetada que el sistema no devolvió cuenta como 0, no se salta. <code>judged_at_k</code> dice qué fracción del top-10 tiene etiqueta. El intervalo sale de un bootstrap por <b>queries</b>; para comparar dos sistemas, bootstrap <b>pareado</b> de la diferencia, mucho más angosto que comparar dos intervalos.'),
          F('eval/tests/test_offline_eval.py', 'python', 'El ejemplo del docstring (juzgados {A: 3, B: 2}, el sistema devuelve [X, A]: 4.4165 ÷ 8.8928 ≈ 0.4966), el orden ideal que da 1, un sistema que solo encuentra el "2" y no saca 1.0, el corte en k, duplicados, un intervalo que no depende de la suerte (semilla) y la CLI con JSONL.'),
        ] },
      { t: 'table', caption: 'Dos recalls que se confunden en entrevistas',
        head: ['', 'knn-recall@100 del ANN', 'recall@k y NDCG@10 de la búsqueda'],
        rows: [
          ['Pregunta', '¿El ANN encuentra lo mismo que la búsqueda exacta?', '¿Los resultados le sirven a la persona?'],
          ['Contra qué', 'Brute force sobre los mismos vectores', 'Etiquetas humanas graduadas (0–3)'],
          ['Necesita personas', 'No: corre cada hora', 'Sí: se etiqueta por lotes'],
          ['Lo baja', 'efSearch, cuantización, filtros, borrados acumulados', 'El modelo, la fusión, el reranker, el catálogo'],
          ['Alerta / función', '<code>ANNRecallDrop</code> · <code>knn_recall_at_k</code>', 'Gate offline antes del A/B · <code>ndcg_at_k</code>'],
        ],
        note: 'Un ANN perfecto con embeddings malos tiene knn-recall 1.0 y NDCG malo. Si solo miras uno, no sabes cuál de los dos se rompió.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: los resultados sin juzgar cuentan como 0',
        html: 'Un sistema nuevo trae listings que nadie etiquetó para el sistema viejo. Si cuentan como irrelevantes, NDCG castiga justo al sistema que encuentra cosas nuevas. Antes de concluir, mira <code>judged@10</code> de los dos: si el nuevo está muy por debajo, etiqueta esos huecos (' + L('m09.etiquetado', 'M9') + ') o compara solo en lo juzgado y dilo. Y reporta por segmento: el promedio lo dominan las queries head, y la búsqueda semántica se justifica sobre todo en tail.' },

      // ------------------------------------------------------------------ alertas
      { t: 'h3', text: 'Las 8 alertas y sus tests' },
      { t: 'code', title: 'Reglas de Prometheus y tests de promtool',
        caption: '<code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code> (≈ 30 s: simula hasta 7.8 días de series para las comparaciones con la semana pasada).',
        files: [
          F('monitoring/alerts.yml', 'yaml', 'Sistema (page): <code>SearchLatencyHigh</code> (p99 &gt; 300 ms texto o &gt; 600 ms foto, buckets exactos en los dos SLO), <code>EmbedWorkerBacklog</code> (lag ÷ ritmo de producción &gt; 180 s, por consumer group <code>embed-worker-&lt;versión&gt;</code>: ve al worker caído, también después de un cambio de modelo), <code>IndexFreshnessLag</code> (p95 commit → upsert &gt; 300 s) y <code>SoldItemsServed</code> con tres ramas y un label <code>signal</code> que dice cuál (chequeos de tombstones fallidos, tombstones tarde, auditoría). Ticket: <code>ShardMemoryHigh</code> (&gt; 85 % del límite), <code>ANNRecallDrop</code> (&lt; 0.95 en un shard, o el canary sin correr o inexistente) y <code>SearchCTRDrop</code>. <code>ZeroResultRateHigh</code> pagina: &gt; 2 % <b>y</b> &gt; 2× la misma hora de la semana pasada.'),
          F('monitoring/alerts_test.yml', 'yaml', 'Cada escenario documenta la cuenta del momento exacto de firing (con ventanas abiertas a la izquierda de Prometheus 3) el swap a v8 (la alerta tiene que ver al grupo <code>embed-worker-v8</code>, no al de v7) y casos que no deben disparar: otro consumer group con lag enorme, una foto a 530 ms (dentro de su SLO), tombstones lentos que no son de <code>IndexFreshnessLag</code>, un 3 % de cero resultados igual al de la semana pasada.'),
          F('README.md', 'text', 'El README de <code>reference/c07</code>: árbol, una búsqueda de punta a punta, la tabla de métricas, las mediciones y qué se ejecutó y qué no.'),
        ] },
      { t: 'callout', kind: 'trap', title: 'Trampa: alertar solo con lo que terminó',
        html: 'El histograma de frescura del worker (commit → upsert) solo registra lo que se escribió. Si el worker se cae, no se escribe nada, la serie se queda sin datos y <code>IndexFreshnessLag</code> calla justo cuando más importa. Por eso existe <code>EmbedWorkerBacklog</code>, que mira el lag de Kafka en segundos y crece aunque nadie procese. Es la misma lección del ' + L('c04.monitoreo', 'caso 4') + ' y del ' + L('c06.monitoreo', 'caso 6') + '. Y el canary de recall tiene el mismo problema: si deja de correr, su último valor "bueno" se ve igual que un índice sano, así que la alerta también mira su timestamp y su ausencia.' },
      { t: 'callout', kind: 'trap', title: 'Trampa: una recording rule de otro grupo llega tarde',
        html: 'Prometheus evalúa los grupos de reglas en paralelo: una alerta que lee una recording rule de otro grupo puede ver el valor de la evaluación anterior. En producción eso es un minuto de atraso; en los tests de promtool es un test que a veces falla. Los tests de esta referencia dejan ±1 min alrededor del momento de firing y verifican el valor del summary solo donde la serie ya no cambia.' },

      // ------------------------------------------------------------------ correrlo
      { t: 'h3', text: 'Cómo correrlo en tu máquina' },
      { t: 'steps', items: [
        { title: 'Todos los tests (sin GPU, Kafka ni motor vectorial)', meta: '≈ 10 s',
          html: '<code>cd reference/c07</code>, crea un venv (Python 3.13 como la imagen), <code>pip install -r requirements-dev.txt</code> y <code>pytest</code>: 88 tests de las tres carpetas.' },
        { title: 'Mide los índices', meta: '≈ 20 s o ≈ 2 min',
          html: '<code>python indexing/build_index.py --n 50000 --queries 300</code>. Después cambia <code>--M</code>, <code>--filter-values</code> o <code>--noise</code> y mira qué se mueve: recall, bytes por vector, latencia, páginas vacías.' },
        { title: 'La demo del search-api', meta: '1 min',
          html: 'En <code>search/</code>: <code>uvicorn --factory api:demo_app --port 8080</code>, y en otra terminal <code>curl -s -X POST \'localhost:8080/v1/search?city=GDL\' -H \'content-type: application/json\' -d \'{"q":"chamarra de mezclilla vintage talla M"}\'</code>. Mira <code>sources</code>, <code>latency_ms</code> y que <code>L2</code> (con tombstone) no aparece. Después <code>/metrics</code>.' },
        { title: 'Las alertas con promtool', meta: '≈ 30 s',
          html: 'Baja el release de Prometheus para tu sistema (trae <code>promtool</code>) y, en <code>monitoring/</code>: <code>promtool check rules alerts.yml</code> y <code>promtool test rules alerts_test.yml</code>. Cambia un umbral y vuelve a correr: su test falla.' },
        { title: 'Evalúa con tus datos', meta: 'con tus etiquetas',
          html: '<code>python eval/offline_eval.py qrels.jsonl run.jsonl --baseline run_actual.jsonl</code>: NDCG@10 y recall@48 por segmento con intervalo, y la diferencia pareada contra el sistema actual.' },
      ] },

      { t: 'callout', kind: 'interview',
        html: '“The search API runs keyword search and vector search in parallel, each with its own timeout, and fuses them with reciprocal rank fusion, because BM25 scores and cosine similarities aren’t on the same scale. Filters are applied inside the vector search, and for very selective filters we switch to an exact search over the filtered subset; post-filtering a top-k gives empty pages. Sold items disappear through tombstone keys in Redis, checked with one MGET per query, because deleting from an HNSW graph is expensive; the graph gets cleaned up on the next shard rebuild. Every index holds vectors from exactly one model version: the API reads the model version of the index behind the live alias, asks the encoder for that version, and drops any shard response from another version. If vector search fails, text queries fall back to BM25 only, which is today’s system.”' },
      { t: 'callout', kind: 'connect',
        html: 'Cada archivo aterriza un módulo: ' + L('m02.streaming', 'M2 Patrones') + ' (el worker consume un stream) y ' + L('m02.entrega-reintentos', 'M2') + ' (at-least-once: idempotencia por versión), ' + L('m03.timeouts-reintentos', 'M3 Latencia') + ' (un timeout por dependencia y respuestas parciales), ' + L('m07.fastapi', 'M7 Serving') + ' (el <code>search-api</code>), ' + L('m09.versionado', 'M9 Datos') + ' (un índice por versión de modelo), ' + L('m11.blue-green', 'M11 Despliegue') + ' (el swap del índice) y ' + L('m12.runbooks', 'M12 Monitoreo') + ' (alertas con runbook). La degradación hasta BM25 es la de ' + L('m15.degradacion', 'M15') + '; el costo de los nodos con mucha RAM, ' + L('m13.costos-ocultos', 'M13') + '. El caso ' + L('c08', 'c08') + ' reusa estas piezas: los vectores de los items se indexan igual, y la recomendación agrega un ranker encima.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
