/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/dlrm.js
   Diagramas del ranking (SPEC §7.2, ids de §25.2), modelo `dlrm` (js/arch/recsys.js):
     dlrm-overview  13 features densas → bottom MLP → un vector de d; 26 categóricas → 26 tablas de embeddings (lookups) → 26
                    vectores de d; interacción (productos punto por par en DLRM, capas cruzadas en DCN v2) → top MLP → sigmoide
                    → CTR. Abajo, del calculador: parámetros por config (las tablas son casi todo), bytes de las tablas contra la
                    memoria de una GPU y, por muestra, bytes leídos vs FLOPs (intensidad aritmética: los lookups, limitados por memoria; la muestra completa, cerca o arriba del punto de quiebre).
       interaction  la interacción por dentro (configs con producto punto): apilar los 27 vectores → T·Tᵀ (27 × 27) →
                    triángulo inferior estricto (351) → concatenar con la salida densa (367) → top MLP.
       funnel       el embudo de recomendación (calc:false, números de las configs con prefijo): catálogo → recuperación
                    (two-tower + ANN) → ranking (DLRM, k candidatos) → re-ranking y reglas → lo que ve el usuario.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'dlrm-criteo-kaggle', DOT = ['dlrm-criteo-kaggle', 'dlrm-mlperf'], ALL = ['dlrm-criteo-kaggle', 'dlrm-mlperf', 'dlrm-dcnv2'];
  const TT = 'two-tower-base';
  const q = (k) => '{{' + k + '}}';
  const k2 = (cfg, key) => '{{' + cfg + '.' + key + '}}';
  const PAGE = { page: 'dlrm', section: 'diagrama' };
  const ROWS4 = [
    { config: 'dlrm-criteo-kaggle', label: 'DLRM · Criteo Kaggle' },
    { config: 'dlrm-mlperf', label: 'DLRM · MLPerf (1TB)' },
    { config: 'dlrm-dcnv2', label: 'DLRM-DCNv2 · MLPerf v3' },
    { config: 'wide-and-deep', label: 'Wide & Deep (referencia)' },
  ];

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'dlrm-overview', model: 'dlrm', config: C, configs: ALL, configsNote: 'Wide & Deep no tiene interacción explícita: está en las barras de abajo', kind: 'arch',
    title: 'DLRM — vista general',
    caption: 'Un ranker de CTR: dada una pareja (usuario, anuncio o ítem) con 13 features numéricas y 26 categóricas, predice la probabilidad de clic. Las numéricas pasan por un MLP chico (bottom MLP) hasta un vector de d; cada categórica es un id que busca su fila en su propia tabla de embeddings (26 tablas, algunas de millones de filas). La interacción cruza todos esos vectores de a pares (productos punto en DLRM, capas cruzadas en DCN v2) y el top MLP da un logit. Abajo, del calculador: casi todos los parámetros están en las tablas, que pueden no entrar en una GPU, y cada lookup lee una fila al azar sin hacer cuentas (limitado por memoria). El modelo entero no lo está en Criteo Kaggle ni en MLPerf (los MLP dominan); con muchos lookups anchos por muestra (DLRM-DCNv2: 214 multi-hot de d = 128) la memoria pesa tanto como el cómputo: queda justo en el punto de quiebre de la GPU.',
    grid: { w: 150, h: 98 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['embeddings', 'interaction'], mobileFocusPad: 1,
    modLegend: { txt: 'Tensor de las categóricas (ids, embeddings; rayado)', lat: 'Tensor denso (numéricas, MLP)' },
    opLegend: { fuse: 'Interacción entre features' },
    legendText: { bars: 'Barras: ancho proporcional (lineal, del calculador); fila resaltada = la config dibujada; línea = la memoria de una GPU', cells: 'Matriz de productos punto (tono ilustrativo): solo cuenta el triángulo inferior; el resto, gris' },
    nodes: [
      { id: 'dense', op: 'io', label: 'Features densas', sub: 'n_d números', subNum: '{{tensor.dense.shape}} números', x: 1, y: 4, w: 18, h: 10,
        note: 'Las 13 features numéricas de Criteo (conteos, normalizados con log(1 + x)).' },
      { id: 'bottom-mlp', op: 'mlp', costOf: 'bottom-mlp', label: 'Bottom MLP', sub: 'n_d → … → d, ReLU', blankSub: 'n_d → …, ReLU', subNum: '{{tensor.dense.shape}} → … → {{tensor.bot-out.shape}}, ReLU', x: 24, y: 4, w: 26, h: 10,
        note: 'Un MLP chico que lleva las features densas al mismo ancho d que los embeddings, para poder cruzarlas con ellos. ReLU en todas sus capas (también la última, como en el código de referencia).' },
      { id: 'sparse', op: 'io', label: 'Features categóricas', sub: 'un id por campo', subNum: '{{tensor.sparse-ids.shape}} ids', x: 1, y: 23, w: 18, h: 12,
        note: 'Los 26 campos categóricos de Criteo (anunciante, sitio, dispositivo… anonimizados), cada uno como un id entero dentro de su tabla. En DLRM-DCNv2 (MLPerf v3) son multi-hot: varios ids por campo, sumados.' },
      { id: 'embeddings', op: 'embed', style: 'store', costOf: 'embeddings', label: '26 tablas de embeddings', sub: 'lookup: una fila\nde d por id', subNum: '{{metrics.totalRows}} filas × {{cfg.dim}}\n{{metrics.embeddingBytes}}', x: 24, y: 21, w: 26, h: 16,
        note: 'Una tabla por campo: {{metrics.tables}} tablas con {{metrics.totalRows}} filas en total (la más grande, {{metrics.largestTableRows}} filas = {{metrics.largestTableBytes}}). Buscar la fila de un id no multiplica nada: es leer d números de una dirección casi al azar. Por eso estas tablas tienen ' + q('metrics.embeddingParamsShare') + ' de los parámetros y cero MACs; en producción se reparten entre GPUs (paralelismo de modelo) mientras los MLP se replican (paralelismo de datos).' },
      { id: 'interaction', op: 'fuse', costOf: 'interaction', label: 'Interacción', sub: 'productos punto por par', subNum: '{{tensor.pairs.shape}} productos punto', expand: 'interaction', x: 59, y: 3, w: 27, h: 34,
        when: { if: 'cfg.crossLayers', set: { label: 'Interacción (DCN v2)', sub: 'capas cruzadas de rango bajo', subNum: '{{cfg.crossLayers}} capas cruzadas, rango {{cfg.rank}}' } },
        cells: { rows: 'tensor.gram.0', cols: 'tensor.gram.1', maxR: 9, maxC: 9, cell: 9, mark: 'tril', label: '{{tensor.gram.shape}}: triángulo inferior', seed: 27 },
        note: 'DLRM: apila la salida densa y los 26 embeddings (27 vectores de d) y calcula el producto punto de cada par: {{metrics.interactionMacs}}. DCN v2 (MLPerf v3): capas cruzadas de rango bajo sobre el vector concatenado, con parámetros propios. Ábrelo para ver los productos punto por dentro.' },
      { id: 'top-mlp', op: 'mlp', costOf: 'top-mlp', label: 'Top MLP', sub: '→ … → 1 logit', subNum: '{{tensor.top-in.shape}} → … → 1', x: 97, y: 17, w: 22, h: 12,
        note: 'El MLP que mezcla los cruces y la salida densa hasta un solo logit. Con DLRM (Criteo Kaggle) su entrada es 16 + 351 = 367.' },
      { id: 'ctr', op: 'head', costOf: 'ctr', label: 'σ', sub: 'sigmoide', x: 124, y: 18, w: 10, h: 10, tex: 'p = \\sigma(z) = \\frac{1}{1 + e^{-z}}',
        note: 'La probabilidad de clic; se entrena con entropía cruzada binaria contra el clic observado.' },
      { id: 'out', op: 'io', label: 'CTR', sub: 'p(clic)', expand: 'funnel', x: 138, y: 18, w: 11, h: 10, note: 'Un número por candidato: el ranking ordena los k candidatos por este valor (o por valor esperado: CTR × puja). Ábrelo para ver dónde está el ranking en el embudo de recomendación.' },
      { id: 'params-bars', op: 'io', hideInBlank: true, label: 'Parámetros por config', x: 1, y: 42, w: 148, h: 21,
        bars: { unit: 'params', labelW: 22, totalW: 12, rows: ROWS4, segs: [{ op: 'embed', n: 'metrics.embeddingParams', label: 'tablas de embeddings' }, { op: 'fuse', n: 'metrics.interactionParams', label: 'interacción (capas cruzadas)' }, { op: 'mlp', n: 'metrics.mlpParams', label: 'MLPs' }] },
        note: 'Parámetros de cada config, del calculador. Las tablas son casi todo; los MLP (y las capas cruzadas de DCN v2) no se llegan a ver a esta escala.' },
      { id: 'bytes-bars', op: 'io', hideInBlank: true, label: 'Memoria de las tablas', x: 1, y: 65, w: 148, h: 20,
        bars: { unit: 'bytes', labelW: 22, totalW: 18, fits: true, legend: false, rows: ROWS4.map((r) => Object.assign({ segs: [{ op: 'embed', n: 'metrics.embeddingBytes', label: 'tablas' }] }, r)), lines: [{ v: 80e9, label: '80 GB (H100)' }],
          caption: 'a la precisión de cada config (knob bits)' },
        note: 'Bytes de las tablas (decimal, 1 GB = 10⁹ B) contra la memoria de una H100: con Criteo 1TB no entran en una GPU y se reparten (sharding por tabla o por filas).' },
      { id: 'per-sample', op: 'io', hideInBlank: true, label: 'Por muestra: bytes vs FLOPs', sub: 'lookups: limitados por memoria',
        subNum: 'lookups: {{metrics.lookupsPerSample}} filas = {{metrics.lookupBytesPerSample}}, {{metrics.embeddingIntensity}} FLOP/byte · MLPs e interacción: {{metrics.macsPerSample}}\nmodelo entero: {{metrics.arithmeticIntensity}} FLOP/byte vs ridge de la H100 {{metrics.ridgePoint}} → límite: {{metrics.bound}} · lookups = {{metrics.embeddingMsShare}} del tiempo del lote',
        x: 1, y: 87, w: 148, h: 10,
        note: 'Cada muestra lee {{metrics.lookupBytesPerSample}} de filas al azar y hace {{metrics.macsPerSample}} en los MLP y la interacción. Un lookup casi no hace cuentas por byte ({{metrics.embeddingIntensity}} FLOP/byte: sumar filas): esa parte está limitada por el ancho de banda de memoria siempre. Que el modelo entero lo esté depende de cuánto pesan los MLP: con d = 16 y 26 lookups (Criteo Kaggle) domina el cómputo; con d = 128 y 214 lookups multi-hot (DCN v2) queda en el límite: {{dlrm-dcnv2.metrics.arithmeticIntensity}} contra {{dlrm-dcnv2.metrics.ridgePoint}} FLOP/byte, ≈ mitad memoria y mitad cómputo (un empate, no un modelo limitado por memoria). Repartido entre GPUs se suma la red (el all-to-all de los embeddings). ≈ {{metrics.samplesPerSecH100}} muestras/s en una H100 por el roofline.' },
    ],
    edges: [
      { from: 'dense', to: 'bottom-mlp', kind: 'data', tensor: 'dense', label: false },
      { from: 'bottom-mlp', to: 'interaction', kind: 'data', tensor: 'bot-out', toAt: 0.26, labelSide: 'above', labelT: 0.5 },
      { from: 'sparse', to: 'embeddings', kind: 'data', tensor: 'sparse-ids', label: false },
      { from: 'embeddings', to: 'interaction', kind: 'data', tensor: 'emb', toAt: 0.85, labelSide: 'above', labelT: 0.7 },
      { from: 'interaction', to: 'top-mlp', kind: 'data', tensor: 'top-in', fromAt: 0.588, labelSide: 'above', labelT: 0.55 },
      { from: 'top-mlp', to: 'ctr', kind: 'data', tensor: 'logit', label: false },
      { from: 'ctr', to: 'out', kind: 'data', tensor: 'ctr', label: false },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (una muestra)', steps: [
        { nodes: ['dense', 'bottom-mlp'], edges: ['dense>bottom-mlp', 'bottom-mlp>interaction'], tensors: ['dense', 'bot-out'],
          text: 'Las <b>' + q('tensor.dense.shape') + '</b> features numéricas pasan por el bottom MLP hasta un vector de <b>' + q('tensor.bot-out.shape') + '</b>, el mismo ancho que un embedding.' },
        { nodes: ['sparse', 'embeddings'], edges: ['sparse>embeddings', 'embeddings>interaction'], tensors: ['sparse-ids', 'emb'],
          text: 'Cada uno de los <b>' + q('tensor.sparse-ids.shape') + '</b> ids busca su fila en su tabla: <b>' + q('tensor.emb.shape') + '</b>. Cero MACs, pero ' + q('metrics.lookupBytesPerSample') + ' leídos de direcciones al azar en ' + q('metrics.embeddingBytes') + ' de tablas.' },
        { nodes: ['interaction'], edges: ['interaction>top-mlp'], tensors: ['top-in'],
          text: 'En DLRM (Criteo Kaggle) los 27 vectores se cruzan de a pares: la matriz <b>' + k2(C, 'tensor.gram.shape') + '</b> de productos punto, de la que se toman los <b>' + k2(C, 'tensor.pairs.shape') + '</b> del triángulo inferior (DCN v2, en cambio: capas cruzadas con pesos sobre el vector concatenado). Al top MLP: <b>' + q('tensor.top-in.shape') + '</b> números (en DLRM, la salida densa + los cruces).' },
        { expand: 'interaction', nodes: ['ix-gram', 'ix-tril'], edges: ['ix-gram>ix-tril'], tensors: ['gram', 'pairs'],
          text: 'Por dentro (producto punto, Criteo Kaggle): Z = T·Tᵀ es simétrica y su diagonal es la norma al cuadrado de cada vector, así que basta el triángulo inferior estricto: 27·26/2 = <b>' + k2(C, 'tensor.pairs.shape') + '</b> cruces.' },
        { nodes: ['top-mlp', 'ctr', 'out'], edges: ['top-mlp>ctr', 'ctr>out'], tensors: ['logit', 'ctr'],
          text: 'El top MLP da un logit y la sigmoide la probabilidad de clic. Todo el cómputo de la muestra: ' + q('metrics.macsPerSample') + '.' },
        { nodes: ['params-bars', 'bytes-bars', 'per-sample'], edges: [], tensors: [],
          text: 'A escala: los MLP son solo el ' + q('metrics.mlpParamsShare') + ' de los parámetros; casi todo está en las tablas (' + q('metrics.embeddingBytes') + '). Por muestra se leen ' + q('metrics.lookupBytesPerSample') + ' al azar para hacer ' + q('metrics.macsPerSample') + ': ' + q('metrics.arithmeticIntensity') + ' FLOP/byte contra el ridge de la H100 (' + q('metrics.ridgePoint') + ') → límite: ' + q('metrics.bound') + '. Compara en el selector Criteo Kaggle (d = 16, 26 lookups: cómputo de sobra) con DLRM-DCNv2 (d = 128, 214 lookups multi-hot: prácticamente en el ridge, un empate).' },
        { expand: 'funnel', nodes: ['fn-ranking'], edges: [], tensors: [],
          text: 'Dónde corre: en el ranking del embudo, una vez por cada uno de los k = ' + k2(C, 'cfg.k') + ' candidatos que trajo la recuperación: con Criteo Kaggle, ' + k2(C, 'metrics.rankingMacsPerRequest') + ' por request (la config del embudo).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) la interacción por dentro (producto punto)
  ATLAS.registerDiagram(Object.assign({
    id: 'interaction', model: 'dlrm', config: C, configs: DOT, configsNote: 'es la interacción con producto punto; la de DCN v2 está en la visualización de cruces', kind: 'arch',
    title: 'Interacción: productos punto por par', parent: 'dlrm-overview', parentNode: 'interaction',
    caption: 'Los 27 vectores de d (la salida del bottom MLP y los 26 embeddings) se apilan en T y se multiplican por su transpuesta: Z = T·Tᵀ tiene el producto punto de cada par de vectores. Z es simétrica y su diagonal es la norma al cuadrado de cada vector, así que DLRM se queda con el triángulo inferior estricto (sin la diagonal): un número por par de campos, sin pesos. Se concatenan con la salida densa y van al top MLP.',
    grid: { w: 100, h: 85 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['ix-gram', 'ix-tril'],
    modLegend: { txt: 'Tensor de las categóricas (ids, embeddings; rayado)', lat: 'Tensor denso (numéricas, MLP)' },
    opLegend: { fuse: 'Productos punto entre features' },
    legendText: { cells: 'Matriz de productos punto (tono ilustrativo): solo cuenta el triángulo inferior estricto; el resto, gris' },
    nodes: [
      { id: 'ix-bot', op: 'io', label: 'Salida del bottom MLP', sub: 'un vector de d', x: 4, y: 1, w: 32, h: 7, note: 'Las features densas ya llevadas a d números.' },
      { id: 'ix-emb', op: 'io', label: '26 embeddings', sub: 'n_s × d', x: 56, y: 1, w: 32, h: 7, note: 'Una fila de d por cada campo categórico.' },
      { id: 'ix-stack', op: 'tensorop', shape: 'pill', symbol: 'concat', ops: ['interact-stack'], opsExact: true, label: 'apilar: T', x: 30, y: 13, w: 40, h: 4, tex: 'T = [x;\\, e_1;\\, \\dots;\\, e_{26}] \\in \\mathbb{R}^{27 \\times d}', note: 'Los 27 vectores, uno por fila.' },
      { id: 'ix-gram', op: 'fuse', ops: ['interact-dot'], opsExact: true, label: 'Z = T·Tᵀ', sub: 'producto punto de cada par', x: 22, y: 22, w: 56, h: 36,
        cells: { rows: 'tensor.gram.0', cols: 'tensor.gram.1', maxR: 27, maxC: 27, cell: 8, mark: 'tril', label: '{{tensor.gram.shape}}', seed: 27 },
        tex: 'Z = T T^{\\top},\\quad z_{ij} = t_i \\cdot t_j', note: 'Un bmm de 27 × d por d × 27: {{metrics.interactionMacs}} (el código de referencia calcula la matriz entera, aunque use la mitad). Tonos ilustrativos.' },
      { id: 'ix-tril', op: 'tensorop', shape: 'pill', symbol: 'pick', ops: ['interact-tril'], opsExact: true, label: 'triángulo inferior estricto', x: 26, y: 62, w: 48, h: 4,
        tex: '\\{\\, z_{ij} : j < i \\,\\}', note: '27·26/2 = 351 productos (<code>arch_interaction_itself = False</code>: sin la diagonal).' },
      { id: 'ix-concat', op: 'tensorop', shape: 'concat', ops: ['interact-concat'], opsExact: true, label: '‖ con la salida densa', labelPos: 'right', x: 48, y: 72, w: 4, h: 4, note: 'Se concatena la salida densa (d) delante de los 351 cruces: 367 en Criteo Kaggle.' },
      { id: 'ix-out', op: 'io', label: 'Al top MLP', x: 38, y: 80, w: 24, h: 4.5, note: 'La entrada del top MLP.' },
    ],
    edges: [
      { from: 'ix-bot', to: 'ix-stack', kind: 'data', tensor: 'bot-out', fromSide: 'bottom', toSide: 'top', fromAt: 0.8, toAt: 0.25, labelSide: 'left', labelT: 0.5 },
      { from: 'ix-emb', to: 'ix-stack', kind: 'data', tensor: 'emb', fromSide: 'bottom', toSide: 'top', fromAt: 0.2, toAt: 0.75, labelSide: 'right', labelT: 0.8 },
      { from: 'ix-stack', to: 'ix-gram', kind: 'data', tensor: 'feats', labelSide: 'right', labelT: 0.5 },
      { from: 'ix-gram', to: 'ix-tril', kind: 'data', tensor: 'gram', label: false },
      { from: 'ix-tril', to: 'ix-concat', kind: 'data', tensor: 'pairs', labelSide: 'right', labelT: 0.5 },
      // la salida densa vuelve a entrar (por fuera, a la izquierda) en la concatenación
      { from: 'ix-bot', to: 'ix-concat', kind: 'data', tensor: 'bot-out', fromSide: 'left', toSide: 'left', via: [[2, 4.5], [2, 74]], labelSide: 'right', labelT: 0.5 },
      { from: 'ix-concat', to: 'ix-out', kind: 'data', tensor: 'top-in', labelSide: 'right', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) el embudo de recomendación (sin calculador propio)
  ATLAS.registerDiagram(Object.assign({
    id: 'funnel', model: 'dlrm', calc: false, calcNote: 'Vista de sistema: une dos modelos (two-tower y DLRM); las cuentas salen de sus configs (' + TT + ' y ' + C + ') y las aristas dicen cuántos ítems pasan.',
    kind: 'arch', title: 'El embudo: recuperar, rankear, re-rankear', parent: 'dlrm-overview', parentNode: 'out',
    caption: 'Un sistema de recomendación es un embudo: cada etapa ve menos ítems y puede gastar más por ítem. La recuperación (two-tower + un índice ANN) mira todo el catálogo con un producto punto barato y deja cientos de candidatos; el ranking (DLRM) corre una red entera por candidato con features cruzadas usuario × ítem; el re-ranking aplica reglas y objetivos de negocio (diversidad, frescura, quitar lo ya visto) sobre unas decenas. Números de las configs ' + TT + ' y ' + C + '.',
    grid: { w: 112, h: 72 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['fn-retrieval', 'fn-ranking'],
    edgeLegend: { data: 'Ítems que pasan a la etapa siguiente' },
    opLegend: { fuse: 'Recuperación: barata por ítem (un producto punto)', mlp: 'Ranking: una red entera por candidato', head: 'Re-ranking: reglas y objetivos de negocio' },
    nodes: [
      { id: 'fn-catalog', op: 'io', style: 'store', label: 'Catálogo', sub: 'millones de ítems', subNum: k2(TT, 'cfg.nItems') + ' ítems', x: 6, y: 1, w: 100, h: 9,
        note: 'Todo lo que se podría mostrar: ' + k2(TT, 'cfg.nItems') + ' ítems en la config de referencia del two-tower.' },
      { id: 'fn-retrieval', op: 'fuse', taper: 0.72, label: 'Recuperación', sub: 'two-tower + ANN: u·v contra todo el índice', subNum: 'torre de usuario ' + k2(TT, 'metrics.userTowerMacs') + ' + u·v exacta ' + k2(TT, 'metrics.bruteForceMacs'),
        x: 10, y: 15, w: 92, h: 11,
        xref: [{ href: '#two-tower.diagrama~two-tower-overview.retrieve', label: 'Ver el two-tower' }, { href: '#ann.diagrama~ann-overview.hnsw-search', label: 'Ver los índices ANN' }],
        note: 'Barata por ítem: un producto punto entre u y cada v precalculado (y con ANN, ni siquiera todos). Usa solo lo que se puede separar en "usuario" e "ítem": no puede cruzar features de los dos.' },
      { id: 'fn-ranking', op: 'mlp', taper: 0.72, label: 'Ranking', sub: 'DLRM: una red por candidato', subNum: k2(C, 'cfg.k') + ' candidatos × ' + k2(C, 'metrics.macsPerSample') + ' = ' + k2(C, 'metrics.rankingMacsPerRequest'),
        x: 22, y: 31, w: 68, h: 11,
        xref: [{ href: '#dlrm.diagrama~dlrm-overview.interaction', label: 'Ver DLRM' }],
        note: 'Cara por ítem: un forward completo de DLRM por cada candidato, con features cruzadas usuario × ítem (historial con este anunciante, contexto…). k = ' + k2(C, 'cfg.k') + ' candidatos: ' + k2(C, 'metrics.rankingMacsPerRequest') + ' por request (≈ ' + k2(C, 'metrics.rankingMsH100') + ' ms en una H100 por el roofline).' },
      { id: 'fn-rerank', op: 'head', taper: 0.7, label: 'Re-ranking y reglas', sub: 'diversidad, frescura, negocio', x: 32, y: 47, w: 48, h: 10,
        note: 'Sobre las decenas mejores: quitar lo ya visto o bloqueado, diversificar (no 10 videos del mismo canal), mezclar objetivos (clic, tiempo, ingresos), a veces con un modelo de lista. Pocas cuentas, mucha lógica.' },
      { id: 'fn-shown', op: 'io', label: 'Lo que ve el usuario', sub: 'decenas de ítems', x: 38, y: 62, w: 36, h: 8, note: 'Una página: unas decenas de ítems ordenados.' },
    ],
    edges: [
      { from: 'fn-catalog', to: 'fn-retrieval', kind: 'data', tag: 'todos (' + k2(TT, 'cfg.nItems') + ')', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'fn-retrieval', to: 'fn-ranking', kind: 'data', tag: 'top-' + k2(TT, 'cfg.k') + ' (cientos)', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'fn-ranking', to: 'fn-rerank', kind: 'data', tag: 'los mejores por CTR (decenas)', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'fn-rerank', to: 'fn-shown', kind: 'data', tag: 'una página', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
