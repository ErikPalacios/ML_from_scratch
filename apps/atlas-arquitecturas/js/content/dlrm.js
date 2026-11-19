/* =============================================================================
   Atlas de Arquitecturas — js/content/dlrm.js
   Página de modelo: ranking en recomendación — DLRM (Naumov et al., arXiv:1906.00091), Wide & Deep (Cheng et al.,
   DLRS 2016, arXiv:1606.07792), DCN v2 (Wang et al., WWW 2021, arXiv:2008.13535) y los benchmarks de MLPerf.
   Canónica dlrm-criteo-kaggle (la corrida de facebookresearch/dlrm bench/dlrm_s_criteo_kaggle.sh).
   Plantilla fija de 11 secciones (SPEC §5.3, §25.2).
   Tesis de la fase (SPEC §25): la recomendación es un embudo; el ranker puntúa cientos de candidatos con tablas de
   embeddings enormes (casi todos los parámetros, limitadas por memoria) más MLPs chicos e interacciones explícitas.
   Regla: ningún número de la arquitectura se escribe a mano: parámetros, MACs, bytes e intensidad aritmética salen del
   calculador (js/arch/recsys.js, cantidades {{config.ruta}}, SPEC §6.6). Resultados de papers con tabla citada;
   estimaciones con est(). El diseño de sistema completo es de la Ronda de Diseño ML. Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/recsys.js, SPEC §25.2).
  const C = 'dlrm-criteo-kaggle';   // canónica: d 16, bottom 13-512-256-64-16, top 512-256-1, 26 tablas de Criteo Kaggle
  const CM = 'dlrm-mlperf';         // MLPerf Training v0.7–v2.1: Criteo 1TB, d 128, tablas con tope de 40M filas
  const CD = 'dlrm-dcnv2';          // MLPerf Training v3.0–v6.0: multi-hot, 3 capas cross de rango 512
  const CW = 'wide-and-deep';       // config de referencia sobre las tablas de Kaggle (tamaños de la Fig. 4 de Cheng et al.)
  const TT = 'two-tower-base';

  // Claves de metrics() del calculador: un solo lugar para adaptarlas.
  const MK = {
    embP: 'embeddingParams', mlpP: 'mlpParams', intP: 'interactionParams', embShare: 'embeddingParamsShare',
    embB: 'embeddingBytes', embB32: 'embeddingBytes32', lookN: 'lookupsPerSample', look: 'lookupBytesPerSample',
    intMacs: 'interactionMacs', botMacs: 'bottomMlpMacs', topMacs: 'topMlpMacs', mlpMacs: 'mlpMacsPerSample', macs: 'macsPerSample',
    ai: 'arithmeticIntensity', ridge: 'ridgePoint', sps: 'samplesPerSecH100', bound: 'bound',
    rank: 'rankingMacsPerRequest', rankMs: 'rankingMsH100', bigRows: 'largestTableRows', bigB: 'largestTableBytes', tables: 'tables', rows: 'totalRows',
  };
  // Ids de tensores del calculador (contrato con dlrm-overview / interaction y el trace).
  const T = {
    dense: 'dense', bot: 'bot-out', sparse: 'sparse-ids', emb: 'emb', feats: 'feats', gram: 'gram', pairs: 'pairs', topIn: 'top-in',
    logit: 'logit', ctr: 'ctr', x0: 'x0', cLow: 'c-low', cUp: 'c-up',
    wEmb: 'w-emb', wLogit: 'wide-logit', eFlat: 'e-flat', dLogit: 'deep-logit',
  };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const sh = (id, cfg) => qn('tensor.' + (T[id] || id) + '.shape', cfg);

  const DLRM = 'Naumov et al., <i>Deep Learning Recommendation Model for Personalization and Recommendation Systems</i>, arXiv:1906.00091 (2019)';
  const WD = 'Cheng et al., <i>Wide & Deep Learning for Recommender Systems</i>, DLRS 2016, arXiv:1606.07792';
  const DCN = 'Wang et al., <i>Deep & Cross Network for Ad Click Predictions</i>, ADKDD 2017, arXiv:1708.05123';
  const DCN2 = 'Wang et al., <i>DCN V2: Improved Deep & Cross Network and Practical Lessons for Web-scale Learning to Rank Systems</i>, WWW 2021, arXiv:2008.13535';
  const REPO = 'repositorio facebookresearch/dlrm (<code>bench/dlrm_s_criteo_kaggle.sh</code> y <code>bench/run_and_time.sh</code>)';
  const MLPERF = 'referencia de MLPerf Training (mlcommons/training: <code>recommendation_v2/torchrec_dlrm</code>, hoy en <code>retired_benchmarks</code>)';
  const YT = 'Covington, Adams y Sargin, <i>Deep Neural Networks for YouTube Recommendations</i>, RecSys 2016';
  const FB = 'He et al., <i>Practical Lessons from Predicting Clicks on Ads at Facebook</i>, ADKDD 2014';
  const ZION = 'Mudigere et al., <i>Software-Hardware Co-design for Fast and Scalable Training of Deep Learning Recommendation Models</i>, ISCA 2022, arXiv:2104.05158';
  const QR = 'Shi et al., <i>Compositional Embeddings Using Complementary Partitions for Memory-Efficient Recommendation Systems</i> (QR trick), KDD 2020, arXiv:1909.02107';
  const TTREC = 'Yin et al., <i>TT-Rec: Tensor Train Compression for Deep Learning Recommendation Models</i>, MLSys 2021, arXiv:2101.11714';
  const MDE = 'Ginart et al., <i>Mixed Dimension Embeddings with Application to Memory-Efficient Recommendation Systems</i>, IEEE ISIT 2021, arXiv:1909.11810';
  const HASH = 'Weinberger et al., <i>Feature Hashing for Large Scale Multitask Learning</i>, ICML 2009, arXiv:0902.2206';
  const MONO = 'Liu et al., <i>Monolith: Real Time Recommendation System With Collisionless Embedding Table</i>, ORSUM@RecSys 2022, arXiv:2209.07663';
  const PAL = 'Guo et al., <i>PAL: A Position-bias Aware Learning Framework for CTR Prediction in Live Recommender Systems</i>, RecSys 2019';
  const WNEXT = 'Zhao et al., <i>Recommending What Video to Watch Next: A Multitask Ranking System</i>, RecSys 2019';
  const MMOE = 'Ma et al., <i>Modeling Task Relationships in Multi-task Learning with Multi-gate Mixture-of-Experts</i> (MMoE), KDD 2018';
  const DELAY = 'Chapelle, <i>Modeling Delayed Feedback in Display Advertising</i>, KDD 2014';
  const FM = 'Rendle, <i>Factorization Machines</i>, ICDM 2010';
  const DEEPFM = 'Guo et al., <i>DeepFM: A Factorization-Machine based Neural Network for CTR Prediction</i>, IJCAI 2017, arXiv:1703.04247';
  const DIN = 'Zhou et al., <i>Deep Interest Network for Click-Through Rate Prediction</i> (DIN), KDD 2018, arXiv:1706.06978';
  const HSTU = 'Zhai et al., <i>Actions Speak Louder than Words: Trillion-Parameter Sequential Transducers for Generative Recommendations</i> (HSTU), ICML 2024, arXiv:2402.17152';
  const SASREC = 'Kang y McAuley, <i>Self-Attentive Sequential Recommendation</i> (SASRec), ICDM 2018, arXiv:1808.09781';
  const BERT4REC = 'Sun et al., <i>BERT4Rec: Sequential Recommendation with Bidirectional Encoder Representations from Transformer</i>, CIKM 2019, arXiv:1904.06690';
  const DROSS = 'Klenitskiy y Vasilev, <i>Turning Dross Into Gold Loss: is BERT4Rec really better than SASRec?</i>, RecSys 2023, arXiv:2309.07602';
  const ESMM = 'Ma et al., <i>Entire Space Multi-Task Model: An Effective Approach for Estimating Post-Click Conversion Rate</i> (ESMM), SIGIR 2018';
  const ONEEPOCH = 'Zhang et al., <i>Towards Understanding the Overfitting Phenomenon of Deep Click-Through Rate Models</i> ("one-epoch phenomenon"), CIKM 2022, arXiv:2209.06053';
  const DLRMV4 = 'MLCommons, <i>DLRMv4: The Next-Generation Recommendation MLPerf Training Benchmark</i> (1 de octubre de 2026), <a href="https://mlcommons.org/2026/10/dlrmv4-training/" target="_blank" rel="noopener">mlcommons.org/2026/10/dlrmv4-training</a>, y la tabla de MLPerf Training v6.1 en github.com/mlcommons/training';
  const TWITTER = 'blog de ingeniería de Twitter, <i>Twitter\'s Recommendation Algorithm</i> (marzo de 2023), y el README del heavy ranker en twitter/the-algorithm-ml';

  ATLAS.register({
    id: 'dlrm',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> dado un usuario, un contexto y <b>un</b> candidato, estimar la probabilidad de que haga click (o compre, o mire hasta el final): un número entre 0 y 1 por candidato, con el que se ordenan los cientos de candidatos que trajo el retrieval. Las entradas son de dos tipos: <b>densas</b> (números: edad de la cuenta, CTR histórico, precio) y <b>categóricas</b> (ids: usuario, anuncio, anunciante, ciudad, dispositivo). Las categóricas se convierten en vectores con <b>tablas de embeddings</b> de millones de filas; un MLP procesa las densas; una capa de <b>interacción</b> cruza todo con todo; otro MLP da el logit.` },
          { t: 'p', html: R`Es la segunda etapa del embudo (<a href="#dlrm.diagrama~funnel.fn-ranking">la vista del embudo</a>). El <a href="#two-tower">two-tower</a> no puede usar features cruzadas usuario × ítem porque tiene que precalcular los ítems; el ranker sí, porque solo ve ${cf('k')} candidatos por request. La canónica (${C}) es la corrida de referencia del ${REPO} sobre Criteo Kaggle: 13 features densas, 26 categóricas, embeddings de ${cf('dim')} dimensiones, bottom MLP 13-512-256-64-16, interacción por productos punto y top MLP 512-256-1. Tiene ${qn('params.total')} parámetros, y ${met('embShare')} están en las tablas.` },
          { t: 'archdiagram', diagram: 'funnel', caption: 'El embudo de recomendación: varios nominadores traen miles de candidatos de millones; el ranker ordena cientos; el re-ranking aplica diversidad y reglas y se muestran decenas.' },
          { t: 'table', caption: 'El embudo, con los números que publicaron las empresas', head: ['Sistema', 'Retrieval', 'Ranking', 'Lo que se muestra', 'Fuente'], rows: [
            ['YouTube (2016)', 'Millones de videos → cientos', 'Cientos → decenas (tiempo de visualización esperado)', 'Decenas', `${YT}, Fig. 2`],
            ['Google Play (Wide & Deep)', 'Más de un millón de apps → O(100), con modelos y reglas', 'O(100) → O(10), en O(10) ms', 'O(10)', `${WD}, Fig. 2`],
            ['YouTube (2019, two-tower)', 'Varios nominadores, cada uno con cientos', 'Un ranker neuronal re-ordena', '—', 'Yi et al., RecSys 2019, §5'],
            ['Twitter "For You" (2023)', 'Los mejores 1,500 de un pool de cientos de millones', R`Una red de ${est('≈ 48M')} parámetros (MaskNet) predice ≈ 10 probabilidades de engagement`, 'Filtros y heurísticas después del ranking', TWITTER],
          ] },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿DLRM / DCN?', 'Por qué'], rows: [
            ['CTR de anuncios o ranking de un feed con muchas features categóricas de alta cardinalidad', 'Sí', 'Es su caso de diseño: embeddings para los ids, interacciones explícitas, una probabilidad calibrada.'],
            ['Pocas features tabulares, densas, y datos chicos (miles a pocos millones de filas)', R`Primero <a href="#gbdt">GBDT</a>`, 'Los árboles ganan en tabular "clásico" y son baratos de servir; los ids de alta cardinalidad son su punto débil.'],
            ['Generar candidatos de un catálogo de millones', R`No: <a href="#two-tower">two-tower</a>`, 'Puntuar cada ítem del catálogo con el ranker no cabe en la latencia.'],
            ['La señal está en el orden del historial (música, series, sesiones)', 'DLRM + un módulo secuencial (DIN, transformer) o un modelo secuencial', 'La interacción por pares no ve el orden de los eventos.'],
            ['Necesitas explicar cada predicción a un regulador', 'Con cuidado', 'Las interacciones de embeddings no se leen fácil; un GBDT o un modelo lineal con features cruzadas se explica mejor.'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Recommendation is a funnel: cheap retrievers narrow millions of items to a few hundred candidates, a ranking model scores each candidate with rich user-item features, and a re-ranking stage applies diversity and business rules. The ranking model is typically a DLRM-style network: embedding tables for categorical features, a small MLP for dense features, an explicit interaction layer such as pairwise dot products or cross layers, and a top MLP that outputs a calibrated probability. Almost all of its parameters are in the embedding tables, whose lookups are memory-bound, so the tables are sharded across devices while the MLPs carry the FLOPs."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como la cabeza de un detector de dos etapas, pero las "features de la región" son decenas de ids y números sueltos.</b> En Faster R-CNN, la RPN propone y una cabeza cara clasifica cada propuesta con sus features; el ranker es esa cabeza: corre una vez por candidato. Y como el cross-encoder de <a href="#retrieval">retrieval</a>, ve usuario e ítem <b>juntos</b>, por eso puede cruzarlos. Lo nuevo no es la red (dos MLPs que ya conoces) sino de dónde salen las entradas: <b>tablas de embeddings</b> que tienen casi todos los parámetros y que se leen con accesos aleatorios a memoria, y una capa de <b>interacción explícita</b> que cruza pares de features porque un MLP aprende esos cruces de forma muy ineficiente.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma del ranking', head: ['Concepto', 'Donde ya lo viste', 'En el ranker', '¿Nuevo?'], rows: [
            ['Embedding de un id', 'nn.Embedding de los tokens de un LLM (vocabulario de ≈ 32K–150K)', R`Una tabla por feature categórica, de 3 a ${met('bigRows')} filas en Criteo Kaggle; la suma de todas es casi todo el modelo`, 'Escala: <b>nuevo</b>'],
            ['MLP', 'El FFN de un transformer, la cabeza de clasificación de ResNet', 'Bottom MLP sobre las densas; top MLP sobre las interacciones', 'Igual'],
            ['Pares de features', 'La matriz de atención QKᵀ: productos punto entre todos los tokens', R`La matriz de Gram de los ${qn('cfg.nSparse')} + 1 vectores: productos punto entre todas las features, como una factorization machine`, 'Parecido'],
            ['Pérdida', 'Entropía cruzada binaria (la objectness de YOLO)', 'Log loss sobre click / no click; la salida tiene que estar <b>calibrada</b>', 'Calibración: <b>nuevo</b>'],
            ['Métrica', 'mAP', 'AUC, log loss normalizada (NE), calibración', 'Parecida'],
            ['Paralelismo', 'Data parallel (DDP), tensor parallel en LLMs', 'Tablas en <b>modelo-paralelo</b> (repartidas), MLPs en <b>data-paralelo</b>, all-to-all entre los dos', '<b>Nuevo</b>'],
            ['Cuello de botella', 'Decode de un LLM: limitado por memoria', 'Lookups: leer filas aleatorias casi sin cómputo', 'Igual, más extremo'],
          ] },
          { t: 'h3', text: 'De dónde viene la interacción: factorization machines' },
          { t: 'p', html: R`Primero sin notación. Un modelo lineal de CTR suma un peso por feature ("país = MX": +0.2, "anunciante = X": +0.5). No sabe que "MX × anunciante de comida a domicilio" vale más que la suma de las dos. El arreglo clásico: crear la feature cruzada "país × anunciante" a mano (Wide & Deep la llama <b>cross-product transformation</b>), con un peso propio; pero hay millones de combinaciones y la mayoría nunca se ve en el entrenamiento. Una <b>factorization machine</b> (${FM}) da a cada valor un vector y estima el peso del cruce como el producto punto de los dos vectores: funciona para pares nunca vistos, porque cada vector se aprende con todos los pares en que aparece. DLRM es exactamente eso, con MLPs alrededor: "computa la interacción de segundo orden explícitamente, siguiendo la intuición de las FMs" (§2.2).` },
          { t: 'math', display: true, tex: R`\hat y_{FM} = b + \sum_i w_i x_i + \sum_{i<j} \langle \mathbf{v}_i, \mathbf{v}_j\rangle\, x_i x_j \qquad\longrightarrow\qquad \text{DLRM: } \langle \mathbf{e}_i, \mathbf{e}_j\rangle \text{ para cada par de features}`, caption: 'Factorization machine: el peso del cruce (i, j) se factoriza como el producto punto de dos embeddings. DLRM toma los productos punto entre todos los pares de vectores de feature y se los pasa al top MLP.' },
          { t: 'callout', kind: 'connect', html: R`<p>De dónde vienen los candidatos que este modelo ordena: <a href="#two-tower">two-tower</a>. El baseline que siempre conviene correr en features tabulares (y que sigue rankeando en muchas empresas): <a href="#gbdt">GBDT</a>. La analogía de "limitado por memoria" la viste en el decode de <a href="#llm-inferencia">LLMs</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Dos entradas y un cruce. Las ${cf('nDense')} features densas pasan por el <b>bottom MLP</b> hasta un vector de ${cf('dim')}, el mismo ancho que los embeddings. Cada una de las ${cf('nSparse')} categóricas es un lookup en su tabla. Los ${cf('nSparse')} + 1 vectores entran a la <b>interacción</b>: todos los productos punto entre pares. Los productos y el vector denso se concatenan y van al <b>top MLP</b>, que da un logit; la sigmoide lo vuelve pCTR. "Recorrido" sigue una muestra de Criteo con números.` },
          { t: 'archdiagram', diagram: 'dlrm-overview', walk: 'forward', wide: true, caption: R`DLRM de la corrida de Criteo Kaggle (${C}): 26 tablas de embeddings de ${cf('dim')} dimensiones, bottom 13-512-256-64-16, interacción por productos punto, top 512-256-1. Formas del calculador para una muestra.` },
          { t: 'p', html: R`<b>La interacción</b>, de cerca: la matriz de Gram de los vectores de feature es simétrica y su diagonal es la norma al cuadrado de cada vector (su producto punto consigo mismo); DLRM se queda con el triángulo inferior estricto: ${sh('pairs')} números. Desde <a href="#dlrm.diagrama~dlrm-overview.out">la vista general</a>, el nodo de salida se expande en el embudo.` },
          { t: 'archdiagram', diagram: 'interaction', caption: R`Productos punto entre las ${cf('nSparse')} + 1 features: ${sh('gram')} → triángulo inferior sin diagonal → concatenado con el vector denso: ${sh('topIn')}.` },
          { t: 'viz', kind: 'feature-interaction', params: { config: C, dcnConfig: CD, mode: 'dlrm' }, caption: 'Sintético: toca una celda para ver qué par de features cruza. En modo DCN, el cruce es elemento a elemento con una matriz W aprendida.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación. Una impresión de Criteo: 13 números (conteos anonimizados, transformados con log(1 + x)) y 26 ids anonimizados (hashes de 32 bits de valores como sitio, anunciante, categoría). Los 13 números pasan por el bottom MLP y quedan en 16. Cada id elige una fila de 16 números de su tabla: la del id más común de una tabla chica (3 filas) o una entre ${met('bigRows')} de la más grande. Ahora hay 27 vectores de 16. Se calculan los 351 productos punto entre pares (27 × 26 / 2), se les pega el vector denso (16 + 351 = 367 números) y el top MLP los reduce a un número: el logit del click. Sigmoide: 0.03, "3 % de probabilidad de click".` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            [R`n<sub>d</sub>`, 'features densas', cf('nDense')],
            [R`n<sub>s</sub>`, 'features categóricas (= tablas de embeddings)', cf('nSparse')],
            ['d', 'dimensión de los embeddings (y de la salida del bottom MLP)', cf('dim')],
            [R`m<sub>t</sub>`, 'filas de la tabla t (cardinalidad, con tope maxRows)', R`de 3 a ${met('bigRows')}`],
            ['b', 'bits por número de las tablas (32 / 16 / 8 / 4)', cf('bits')],
            ['k', 'candidatos rankeados por request', cf('k')],
            ['B', 'muestras por batch de entrenamiento', R`128 en la corrida de Kaggle; 2,048 en MLPerf v0.7–v2.1; ${qn('B', CD)} en DLRM-DCNv2`],
          ] },

          { t: 'h3', text: 'Las dos entradas' },
          { t: 'op', block: 'bottom-mlp', model: 'dlrm', title: 'Bottom MLP: features densas → un vector del ancho de los embeddings',
            tex: R`\mathbf{x} = \mathrm{MLP}_{bot}(\mathbf{z}_{dense}),\qquad \mathbf{z}_{dense} = \log(1 + \text{conteos}) \in \mathbb{R}^{13},\ \ \mathbf{x}\in\mathbb{R}^{d}`,
            in: [T.dense], out: [T.bot], params: true, flops: true,
            what: R`${sh('dense')} → 512 → 256 → 64 → ${sh('bot')}, ReLU en todas las capas (también en la última, como el repo): ${met('botMacs')} por muestra.`,
            why: R`El vector denso tiene que salir con el mismo ancho d que los embeddings para poder hacer productos punto con ellos: así el bloque de números (edad de la cuenta, CTR histórico) "habla" con los ids. La transformación log(1 + x) importa: los conteos van de 0 a millones y sin ella dominan los gradientes. Wide & Deep normaliza por cuantiles (la posición de x en la distribución empírica, en [0, 1]).` },
          { t: 'op', block: 'embeddings', model: 'dlrm', title: 'Embeddings: un lookup por feature categórica',
            tex: R`\mathbf{e}_t = W_t^\top \mathbf{1}_{i_t} = W_t[\,i_t\,] \in \mathbb{R}^{d},\qquad W_t \in \mathbb{R}^{m_t \times d},\quad t = 1\ldots n_s;\qquad \text{multi-hot: } \mathbf{e}_t = \textstyle\sum_{i \in S_t} a_i\, W_t[\,i\,]`,
            in: [T.sparse], out: [T.emb], params: true,
            what: R`${sh('sparse')} → ${sh('emb')}: ${met('lookN')} filas leídas (${met('look')} por muestra con ${cf('bits')} bits). Cero MACs. Las tablas tienen ${met('embP')} parámetros (${met('embShare')} del modelo) y ocupan ${met('embB')}.`,
            why: R`Es la multiplicación por un one-hot de la Ec. 1 del paper, implementada como indexación (<code>nn.EmbeddingBag</code> en PyTorch, <code>SparseLengthsSum</code> en Caffe2, Tabla 1): nadie materializa el vector de 10M ceros. Con features multi-valor ("las últimas 20 categorías que vio") el bag suma (o promedia) varias filas: eso es el "multi-hot" de DLRM-DCNv2, con ${met('lookN', CD)} lookups por muestra. Cada tabla tiene su cardinalidad; la de 10.1M filas × 16 en fp32 son ${est('≈ 648 MB')}, una de 3 filas, 192 bytes.` },
          { t: 'callout', kind: 'trap', title: '"Los embeddings son una capa más; el costo está en el MLP"', html: R`<p>Depende de qué costo. En la canónica, las tablas son ${met('embShare')} de los parámetros y el MLP cabe en la cache L2 de una GPU. Pero el MLP hace casi todos los MACs (${met('mlpMacs')} por muestra contra 0 de los lookups). Dos recursos distintos: las tablas consumen <b>capacidad y ancho de banda de memoria</b> (y lecturas aleatorias), los MLPs consumen <b>FLOPs</b>. Por eso se paralelizan distinto (abajo) y se optimizan con herramientas distintas.</p>` },

          { t: 'h3', text: 'La interacción' },
          { t: 'op', block: 'interaction', model: 'dlrm', title: 'Interacción por productos punto (DLRM)',
            tex: R`T = [\mathbf{x};\ \mathbf{e}_1;\ \ldots;\ \mathbf{e}_{n_s}] \in \mathbb{R}^{(n_s+1)\times d},\qquad Z = T\,T^\top,\qquad \mathbf{z}_{top} = \big[\,\mathbf{x};\ \{Z_{ij}\}_{i>j}\,\big] \in \mathbb{R}^{d + (n_s+1)n_s/2}`,
            in: [T.bot, T.emb], out: [T.topIn], flops: true,
            what: R`${sh('feats')} → Gram ${sh('gram')} → triángulo inferior estricto ${sh('pairs')} → concatenado con x: ${sh('topIn')}. ${met('intMacs')} (el calculador cuenta el bmm completo, como la implementación de referencia, que calcula toda la matriz y después indexa). Sin parámetros.`,
            why: R`Cada producto punto es un "peso de cruce" factorizado, como en una FM: país·anunciante, sitio·categoría, denso·usuario. El paper argumenta que las interacciones de orden mayor que 2 pueden no valer el costo extra de cómputo y memoria (§2.3, en palabras del paper original: «may not necessarily be worth the additional computational/memory cost»). Dos detalles de la implementación (<code>interact_features</code>): sin la diagonal (⟨e<sub>i</sub>, e<sub>i</sub>⟩ no cruza nada) y con x concatenado, así el top MLP también ve las densas directamente. De ahí sale el 367 de entrada al top MLP: 16 + 27·26/2.` },
          { t: 'callout', kind: 'note', title: 'DLRM y DCN cruzan cosas distintas', html: R`<p>DLRM trata cada vector de feature como <b>una unidad</b>: un producto punto por par de features (cruce "feature-wise"). DCN cruza <b>elementos</b>: cada coordenada de la entrada concatenada con cada otra, también dentro de un mismo vector (cruce "bit-wise"), lo que da más términos y más dimensión (${DLRM.split(',')[0]}, §2.3). En la práctica las dos funcionan; DCN v2 es el que adoptó MLPerf (DLRM-DCNv2, de v3.0 a v6.0) y el que Google llevó a producción.</p>` },
          { t: 'op', block: 'interaction', model: 'dlrm', config: CD, title: 'Capa cross de DCN v2 (la de DLRM-DCNv2)',
            tex: R`\mathbf{x}_{l+1} = \mathbf{x}_0 \odot \big(W_l\,\mathbf{x}_l + \mathbf{b}_l\big) + \mathbf{x}_l,\qquad W_l \approx U_l V_l^\top,\ \ U_l, V_l \in \mathbb{R}^{D\times r}`,
            in: [T.x0], out: [T.topIn], params: true, flops: true,
            what: R`La entrada es la concatenación de los 27 vectores: ${sh('x0', CD)}. Cada capa proyecta a rango r (${sh('cLow', CD)}), vuelve a D (${sh('cUp', CD)}), multiplica elemento a elemento por x<sub>0</sub> y suma el residuo. Tres capas en MLPerf: ${met('intP', CD)} parámetros, ${met('intMacs', CD)} por muestra.`,
            why: R`x<sub>0</sub> ⊙ (W x<sub>l</sub>) contiene todos los productos x<sub>i</sub>·x<sub>j</sub> pesados por W: cada capa sube un grado del polinomio (l capas → grado l + 1) y el residuo conserva los grados menores (${DCN2}, §3.2). El DCN original usaba W = 1·wᵀ (un vector por capa: barato pero poco expresivo); la v2 usa una matriz completa y, como la matriz aprendida resulta numéricamente de rango bajo, la aproxima por UVᵀ: en producción, rango (tamaño de entrada)/4 "preservó consistentemente" la accuracy del rango completo (§8).` },

          { t: 'h3', text: 'La salida' },
          { t: 'op', block: 'top-mlp', model: 'dlrm', title: 'Top MLP y sigmoide: el pCTR',
            tex: R`\hat p = \sigma\big(\mathrm{MLP}_{top}(\mathbf{z}_{top})\big),\qquad \mathcal{L} = -\big[\,y\log\hat p + (1-y)\log(1-\hat p)\,\big]`,
            in: [T.topIn], out: [T.ctr], params: true, flops: true,
            what: R`${sh('topIn')} → 512 → 256 → ${sh('logit')} → sigmoide: ${met('topMacs')} por muestra. Con el bottom, ${met('mlpMacs')}: todo el cómputo del modelo.`,
            why: R`El top MLP aprende combinaciones no lineales de los cruces de segundo orden (lo que la FM no puede). La salida no es solo un score para ordenar: en anuncios se multiplica por la puja (precio esperado = puja × pCTR) y en feeds se combina con otras cabezas (pLike, pShare): por eso tiene que estar <b>calibrada</b> (ver <a href="#dlrm.entrenamiento">entrenamiento</a>).` },
          { t: 'h3', text: 'Wide & Deep en una tarjeta' },
          { t: 'op', block: 'wide', model: 'dlrm', config: CW, title: 'Wide & Deep: un modelo lineal y un MLP, entrenados juntos',
            tex: R`P(y = 1 \mid \mathbf{x}) = \sigma\big(\mathbf{w}_{wide}^\top[\mathbf{x},\ \phi(\mathbf{x})] + \mathbf{w}_{deep}^\top \mathbf{a}^{(l_f)} + b\big),\qquad \phi_k(\mathbf{x}) = \prod_i x_i^{c_{ki}}`,
            in: [T.sparse], out: [T.wLogit], params: true,
            what: R`La parte <b>wide</b>: un peso por valor de feature (y por cruce φ elegido a mano; en Google Play, "app instalada × app mostrada"). La parte <b>deep</b>: embeddings de 32 por feature categórica concatenados con las densas (≈ 1,200 dimensiones en el paper) → ReLU 1024 → 512 → 256 → logit. En la config del calculador sobre las tablas de Kaggle: ${sh('topIn', CW)} de entrada al MLP y ${qn('params.total', CW)} parámetros.`,
            why: R`<b>Memorización</b> (la parte lineal recuerda "excepciones": pares concretos que funcionan) más <b>generalización</b> (los embeddings extrapolan a pares nunca vistos, pero pueden sobre-generalizar con nichos). Se entrenan <b>juntos</b>, no como ensemble: la parte wide solo tiene que cubrir lo que la deep no, con pocos cruces. Optimizadores distintos: FTRL con L1 para la wide (pesos ralos) y AdaGrad para la deep (${WD}, §3.3).` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de la canónica, para una muestra. Toca una fila para resaltarla en el diagrama.` },
          { t: 'trace', model: 'dlrm' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`${qn('params.total')} parámetros: ${met('embP')} en ${met('tables')} tablas (${met('rows')} filas en total) y ${met('mlpP')} en los MLPs. El paper lo dice así: DLRM y DCN con embeddings de 16 tienen "aproximadamente 540M parámetros" en Criteo Kaggle (§5.1). Las tablas ocupan ${met('embB32')} en fp32; la más grande sola, ${met('bigB')}.` },
          { t: 'params', model: 'dlrm', group: 'block' },
          { t: 'flops', model: 'dlrm' },
          { t: 'calc', title: R`Una muestra, recurso por recurso (calculador, ${C})`, rows: [
            { label: 'Parámetros en tablas', expr: R`Σ<sub>t</sub> m<sub>t</sub> × d`, value: met('embP'), note: R`${met('embShare')} del modelo` },
            { label: 'Parámetros en MLPs', expr: 'bottom + top', value: met('mlpP') },
            { label: 'Lookups por muestra', expr: R`n<sub>s</sub> filas de d números`, value: met('lookN'), note: R`${met('look')} leídos` },
            { label: 'MACs de los MLPs', expr: 'cada peso una vez por muestra', value: met('mlpMacs') },
            { label: 'MACs de la interacción', expr: R`(n<sub>s</sub> + 1)² × d`, value: met('intMacs') },
            { label: 'Intensidad de los lookups', expr: 'FLOPs del bag / bytes leídos', value: met('embeddingIntensity'), note: R`FLOPs por byte: limitados por memoria, siempre` },
            { label: 'Intensidad de la muestra completa', expr: 'FLOPs de MLPs e interacción / bytes de filas leídos', value: met('ai'), note: R`contra el punto de quiebre de una H100: ${met('ridge')} FLOPs/byte → en conjunto, ${met('bound')}` },
          ], result: R`Los lookups no reutilizan nada (cada fila se lee para una muestra y casi no se opera); los MLPs reutilizan sus pesos en todo el batch, así que sus FLOPs no traen bytes nuevos por muestra. En este modelo chico de Kaggle los MLPs pesan más y el batch queda del lado del cómputo, pero los lookups ya son ${met('embeddingMsShare')} del tiempo de un batch en la cota de roofline. Con multi-hot (DLRM-DCNv2: ${met('lookN', CD)} lookups por muestra) queda justo en el punto de quiebre: ${met('ai', CD)} contra ${met('ridge')} FLOPs/byte, con ${met('embeddingMsShare', CD)} del tiempo en las tablas y el resto en los MLPs, mitad y mitad. Ese veredicto depende de la precisión: el calculador lee las tablas con los bits de la config (fp32) y pone los MLPs al pico bf16; con tablas en fp16, o con MLPs en TF32 (punto de quiebre ${est('≈ 148')}), cae del lado del cómputo. Cota de inferencia (solo forward, canónica de Kaggle): ${met('sps')} muestras por segundo en una H100 (${est('≈')}, pico de la hoja de datos, sin overhead de kernels, de red ni de all-to-all). Para contrastarla con algo medido hay que comparar lo mismo. Lo medido: la referencia de TorchRec <b>entrena</b> un DLRM de Criteo 1TB con la arquitectura del de MLPerf (d = 128) a ${est('≈ 1.67M')} muestras por segundo con 8 A100 (8 GPUs × 2,048 muestras por GPU, README de la ${MLPERF}; con las tablas sin tope, 91.10 GiB, que no cambian los bytes leídos por muestra): ${met('measuredTrainPerGpu', CM)} por GPU. La cota de entrenamiento de esa misma arquitectura (${CM}, forward + backward) es ${met('trainSamplesPerSecH100', CM)} muestras por segundo en una H100: ${met('trainCeilingVsMeasuredH100', CM)} veces lo medido por GPU. La misma cota en una A100 (312 contra 989 TFLOP/s bf16; sigue limitada por cómputo) es ${met('trainSamplesPerSecA100', CM)} por segundo: ${met('trainCeilingVsMeasuredA100', CM)} veces. Entre dos y dos órdenes y medio de magnitud debajo de la cota, que se van en la comunicación (all-to-all), el pipeline de datos, los kernels y la precisión real de la corrida. Contra la cota de inferencia de Kaggle saldrían ${est('≈ 4,900×')}, pero esa cuenta mezcla modelo (5 veces menos MLP), modo (sin backward) y GPU.` },
          { t: 'callout', kind: 'senior', html: R`<p>La frase que un entrevistador espera: "embedding lookups have almost no arithmetic per byte, so the sparse side of a ranking model is memory-bound: the tables decide capacity and bandwidth, the MLPs decide FLOPs". Con números: una fila de ${cf('dim')} floats son ${cf('dim')} × 4 bytes y se usa en 0 multiplicaciones (solo se copia o se suma en el bag); una H100 necesita ${est('≈ 295')} FLOPs por byte leído de HBM (${est('≈ 989 TFLOP/s')} bf16 denso / ${est('3.35 TB/s')}) para estar limitada por cómputo. Ni con el batch más grande un lookup llega ahí (${met('embeddingIntensity')} FLOPs/byte en el calculador). Que el modelo entero sea limitado por memoria o por cómputo depende de cuánto MLP hay por cada lookup: la canónica de Kaggle sale ${met('bound')} (${met('ai')} FLOPs/byte), DLRM-DCNv2 con multi-hot queda en el límite (${met('ai', CD)}, mitad tablas y mitad MLP), y los modelos de producción con cientos de features ralas por cada capa de MLP tienden a quedar del lado de la memoria. Consecuencias de diseño: tablas en la memoria más rápida que quepa (HBM, luego DRAM, luego SSD, con cache de filas calientes), precisión baja en las tablas antes que en el MLP, y lookups agrupados por tabla en un solo kernel (FBGEMM <code>TBE</code>, TorchRec).</p>` },
          { t: 'h3', text: 'Las perillas' },
          { t: 'scaling', model: 'dlrm', knobs: [{ key: 'dim', values: [8, 16, 32, 64, 128] }, { key: 'bits', values: [32, 16, 8, 4] }], show: ['embeddingParams', 'embeddingBytes', 'lookupBytesPerSample', 'interactionMacs', 'arithmeticIntensity'] },
          { t: 'scaling', model: 'dlrm', knobs: [{ key: 'maxRows', values: [100000, 1000000, 10000000, 40000000] }], show: ['embeddingParams', 'embeddingBytes', 'embeddingParamsShare', 'largestTableBytes'] },
          { t: 'scaling', model: 'dlrm', knobs: [{ key: 'k', values: [50, 200, 500, 2000] }], show: ['rankingMacsPerRequest', 'rankingMsH100'] },
          { t: 'h3', text: 'Reducir las tablas: hashing, tope, precisión y factorización' },
          { t: 'table', caption: 'Compresión de embeddings', head: ['Técnica', 'Qué hace', 'Cuánto ahorra', 'Qué cuesta', 'Fuente'], rows: [
            ['Tope de filas (hashing)', 'fila = h(id) mod maxRows; los ids que caen en la misma fila comparten vector', 'Lineal en el tope: MLPerf v0.7–v2.1 capa las tablas de Criteo 1TB en 40M filas', 'Colisiones: los ids raros se mezclan con otros', `${HASH}; ${REPO}`],
            ['Menos precisión', 'Tablas en fp16, int8 por fila (con escala y sesgo por fila) o int4', '2–8× en memoria y en bytes por lookup', 'Algo de calidad; el optimizador suele mantener fp32', 'práctica estándar (FBGEMM, TorchRec)'],
            ['Dimensión mixta', 'Menos dimensiones para las tablas o filas poco frecuentes', 'Grande en tablas con colas largas', 'Proyecciones para igualar d', MDE],
            ['QR trick (particiones complementarias)', 'Dos tablas chicas, por cociente (id ÷ m′) y resto (id mod m′), combinadas (por defecto, producto elemento a elemento; también suma o concatenación): cada id recibe un par (cociente, resto) único; con m′ ≈ √m, ≈ 2√m filas', 'De m filas a ≈ 2√m', 'Un poco de calidad; mejor que el hashing a igual memoria', QR],
            ['Tensor Train', 'La tabla se factoriza como un producto de tensores chicos y cada fila se reconstruye al leerla', 'Reportan 117× (Kaggle) y 112× (Terabyte) sin pérdida de accuracy', 'Cómputo extra por lookup', TTREC],
            ['Sin colisiones con expiración', 'Hash table dinámica (cuckoo): solo ids vistos, filtro por frecuencia, expiran los inactivos', 'La memoria sigue a los ids activos', 'Infraestructura propia', MONO],
          ] },
          { t: 'compare', models: [C, CM, CD, CW], rows: ['params', 'embeddingParams', 'mlpParams', 'interactionParams', 'embeddingParamsShare', 'embeddingBytes32', 'lookupsPerSample', 'macsPerSample', 'arithmeticIntensity'], caption: R`Las cuatro configs: la canónica de Kaggle, el DLRM de MLPerf v0.7–v2.1 (Criteo 1TB, d = 128, tope de 40M filas), DLRM-DCNv2 de MLPerf v3.0–v6.0 (multi-hot y capas cross) y Wide & Deep sobre las tablas de Kaggle. Los modelos de MLPerf tienen decenas de miles de millones de parámetros casi todos en tablas; sus MLPs son 5–11 veces más grandes que los de Kaggle (DCN v2 suma 10.6M en capas cross) y aun así son una fracción mínima.` },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 d → ×2 tablas, ×2 bytes por lookup, ×2 la interacción por productos punto; el MLP casi igual (solo crecen las capas que tocan d). ÷2 bits → ÷2 memoria de las tablas y ÷2 bytes por lookup, mismos MACs. Tope de filas → las tablas grandes se achican, las chicas no cambian. ×2 features categóricas → ×2 lookups y ≈ ×4 pares en la interacción. ×2 k → ×2 el costo del ranking por request.` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: TT-Rec, la dimensión mixta y los explorers. Lo que no te puedes saltar: tablas ≫ MLP en parámetros pero MLP ≫ tablas en MACs, la intensidad aritmética de un lookup, y que el hashing cambia memoria por colisiones.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'math', display: true, tex: R`\mathcal{L} = -\frac{1}{N}\sum_{i=1}^{N}\Big[y_i\log \hat p_i + (1-y_i)\log(1-\hat p_i)\Big],\qquad \mathrm{NE} = \frac{\mathcal{L}}{-\big[\bar p\log\bar p + (1-\bar p)\log(1-\bar p)\big]}`, caption: R`Log loss (entropía cruzada binaria) y su versión normalizada, NE (${FB}): la log loss dividida por la que tendría un modelo que siempre predice el CTR de fondo p̄. NE = 1 es "no sé nada más que el promedio"; menor es mejor. Se normaliza porque con CTRs cercanos a 0 es fácil tener log loss baja.` },
          { t: 'h3', text: 'Datos y recetas que vas a citar' },
          { t: 'table', caption: 'Corridas de referencia', head: ['Corrida', 'Datos', 'Modelo', 'Entrenamiento', 'Fuente'], rows: [
            ['DLRM Criteo Kaggle', '≈ 45M muestras de 7 días; 13 densas (log(1 + x)) y 26 categóricas; 6 días de entrenamiento y el 7.º partido en validación y prueba', 'd 16, bottom 13-512-256-64-16, top 512-256-1', 'SGD, LR 0.1, batch 128, una época, BCE', `${DLRM}, §4.3 y §5.1; ${REPO}`],
            ['DLRM MLPerf (v0.7–v2.1)', 'Criteo 1TB: 24 días; 23 de entrenamiento y el 24.º para validación y prueba', 'd 128, bottom 13-512-256-128, top 1024-1024-512-256-1, tablas con tope de 40M filas', 'LR 1.0, batch 2,048; objetivo AUC 0.8025', REPO],
            ['DLRM-DCNv2 (MLPerf v3.0 a v6.0)', 'Criteo 1TB con features <b>multi-hot</b> sintéticas (Σ 214 ids por muestra; ≈ 3.8 TB materializado), 4,195,197,692 muestras de entrenamiento', 'd 128, bottom 512-256-128, 3 capas cross de rango 512, top 1024-1024-512-256-1', R`Adagrad, LR 0.005, batch global ${qn('B', CD)}; objetivo AUROC 0.80275 en una época`, MLPERF],
            ['Wide & Deep (Google Play)', 'Más de 500 mil millones de ejemplos; etiqueta = la app mostrada se instaló', 'Embeddings de 32, ≈ 1,200 de entrada, ReLU 1024-512-256; wide: cruces app instalada × app mostrada', 'FTRL + L1 (wide), AdaGrad (deep); warm-start desde el modelo anterior en cada re-entrenamiento', `${WD}, §4.2`],
          ] },
          { t: 'callout', kind: 'note', title: 'Una época, y por qué', html: R`<p>Los modelos de recomendación se entrenan típicamente <b>una sola pasada</b> sobre los datos (las corridas de referencia de arriba, y Monolith lo dice explícito). Con miles de millones de ejemplos y tablas que memorizan ids, una segunda época suele empeorar: ${ONEEPOCH} lo midió en el CTR de anuncios de Alibaba (la AUC de prueba cae de golpe al empezar la segunda época) y en datasets públicos, y lo asocia a features muy ralas y optimizadores que convergen rápido. Lo que se repite no son épocas sino <b>días</b>: entrenar continuo o incremental (warm-start) sobre los datos nuevos.</p>` },
          { t: 'h3', text: 'Lo que midió DCN v2 en Criteo' },
          { t: 'table', caption: 'Criteo, mismo tamaño de embedding (39) para todos los modelos (DCN v2, Tabla 6; promedio de 5 corridas; parámetros sin contar los embeddings)', head: ['Modelo', 'LogLoss', 'AUC', 'Parámetros de la interacción + MLP'], rows: [
            ['DNN (solo MLP)', '0.4421', '0.8098', '3.2M'],
            ['DLRM', '0.4427', '0.8092', '1.1M'],
            ['DCN (v1)', '0.4420', '0.8099', '2.1M'],
            ['DCN-V2', '<b>0.4406</b>', '<b>0.8115</b>', '3.5M'],
            ['DCN-Mix (mezcla de rango bajo)', '0.4408', '0.8112', '2.4M'],
          ], note: R`${DCN2}. En Criteo, una mejora de 0.001 de log loss se considera significativa (§7.2). En producción en Google, DCN-V2 dio 0.6 % de mejora en AUCLoss (1 − AUC) sobre un MLP, donde 0.1 % ya es significativo; las lecciones: poner las capas cross entre la entrada y el MLP, 1–2 capas (más se estanca) y rango = entrada/4 (§8).` },
          { t: 'callout', kind: 'trap', title: '"La AUC subió de 0.8098 a 0.8115: casi nada"', html: R`<p>En CTR, los modelos buenos están todos cerca: lo que separa a un modelo de producción de otro son milésimas de log loss o de AUC, porque se aplican a miles de millones de impresiones (DCN v2: 0.001 ya es significativo en Criteo; 0.1 % de AUCLoss en su modelo de producción). Lo que hay que decir en una entrevista: el tamaño del efecto en la métrica online (ingresos, engagement) y si es estadísticamente significativo en el A/B.</p>` },
          { t: 'h3', text: 'Calibración y las métricas que importan' },
          { t: 'list', items: [
            R`<b>AUC</b>: probabilidad de que un positivo al azar quede arriba de un negativo al azar. Mide el <b>orden</b>, no los valores: dividir todas las predicciones por 2 no la cambia.`,
            R`<b>Log loss / NE</b>: mide los <b>valores</b>. "Si el modelo sobre-predice ×2 y aplicamos un multiplicador global de 0.5 para arreglar la calibración, la NE mejora aunque la AUC quede igual" (${FB.split(',')[0]}, §2).`,
            R`<b>Calibración</b>: clicks esperados / clicks observados, Σ p̂ / Σ y. Tiene que ser ≈ 1 en total y <b>por segmento</b> (por país, por posición, por tipo de anuncio): un modelo calibrado en promedio puede sobre-predecir en un segmento y sub-predecir en otro.`,
            R`<b>Por qué importa</b>: en anuncios, el ranking es puja × pCTR (y lo que se cobra depende de esa cuenta): un pCTR ×2 cobra mal y reparte mal. En feeds, el score final es una suma pesada de varias cabezas (pClick, pLike, pTiempo): si una cabeza está descalibrada, su peso efectivo cambia sin que nadie lo decida.`,
          ] },
          { t: 'math', display: true, tex: R`q = \frac{p}{p + (1-p)/w}`, caption: R`Re-calibración después de <b>negative downsampling</b> (${FB.split(',')[0]}, §6.3): si se entrenó guardando una fracción w de los negativos, p es la predicción "en el espacio submuestreado" y q la probabilidad real. Su ejemplo: CTR 0.1 % y w = 0.01 → el CTR de entrenamiento queda en ≈ 10 %; la fórmula lo devuelve a 0.1 %. Olvidar este paso es un bug clásico: el modelo ordena bien (la AUC no cambia) y predice probabilidades ≈ 1/w veces más altas.` },
          { t: 'h3', text: 'Las tres trampas de los datos de clicks' },
          { t: 'p', html: R`<b>Sesgo de posición.</b> Lo de arriba se clickea más porque está arriba, no solo porque es mejor. Si la posición no entra al modelo, aprende "lo que antes se mostraba arriba es bueno" y se refuerza a sí mismo. Arreglo estándar: la posición como feature (o una "shallow tower" de sesgo, ${WNEXT}) solo en entrenamiento, y en serving se fija a un valor constante (o se apaga la torre) para puntuar todos los candidatos como si estuvieran en la misma posición. PAL (${PAL}) factoriza p(click) = p(visto | posición) · p(click | visto, features).` },
          { t: 'p', html: R`<b>Feedback retrasado.</b> Un click llega en segundos; una conversión (compra, instalación) puede llegar horas o días después. Si entrenas con los datos de hoy, muchos "negativos" son positivos que todavía no llegaron, y el modelo sub-predice conversiones, sobre todo en lo más nuevo. ${DELAY} modela el retraso explícitamente; en la práctica, una ventana de espera (que cuesta frescura), corrección por la probabilidad de que la conversión ya haya llegado, o re-etiquetar ejemplos cuando llega la conversión tardía.` },
          { t: 'p', html: R`<b>Training/serving skew.</b> La feature "CTR del anunciante en los últimos 7 días" calculada con un job de Spark para entrenar y con un servicio en tiempo real para servir: dos códigos, dos resultados ligeramente distintos, y un modelo que se ve bien offline y peor online. Arreglos: un <b>feature store</b> con la misma definición para los dos lados y joins <b>point-in-time</b> (el valor de la feature en el instante de la impresión, no el de hoy), o mejor, <b>loguear las features tal como se sirvieron</b> y entrenar con esos logs ("log and wait"). La frescura también importa: ${FB.split(',')[0]} midió que pasar de re-entrenar semanal a diario baja la NE ${est('≈ 1 %')} (§3.2, Fig. 2), más que la mayoría de los experimentos de features.` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: las recetas exactas de MLPerf y la tabla de DCN v2. Lo que no te puedes saltar: log loss y NE, AUC no ve la calibración, la re-calibración tras el negative downsampling, sesgo de posición, feedback retrasado y training/serving skew.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Recibir los candidatos', html: R`<p>Del retrieval llegan ${est('cientos a miles')} de ids de ítem (varios nominadores, deduplicados). Muchas veces hay un <b>ranker ligero</b> intermedio (un modelo chico o destilado) que corta a ${est('≈ 500')} antes del pesado.</p>` },
            { title: 'Features del usuario, una vez', html: R`<p>Covington separa features de "query" (usuario y contexto: se calculan <b>una vez</b> por request) de las de "impresión" (del ítem: una vez por candidato). Mismo truco en el modelo: la parte del usuario (sus lookups, su bottom MLP) se calcula una vez y se reutiliza para los k candidatos.</p>` },
            { title: 'Puntuar los k candidatos en un batch', html: R`<p>k filas por request: ${met('rank')} con k = ${cf('k')} y la canónica (cota ≈ ${met('rankMs')} ms en una H100 a pico: menos de un microsegundo). El costo real lo ponen los lookups (k × n<sub>s</sub> filas leídas, muchas en otra máquina) y la latencia de red de las features, no los MACs.</p>` },
            { title: 'Combinar cabezas y re-rankear', html: R`<p>En un feed multi-objetivo, score = Σ w<sub>i</sub> · p̂<sub>i</sub> sobre varias cabezas (el heavy ranker de Twitter combina ≈ 10 probabilidades de engagement con pesos de un archivo de configuración). Después: diversidad (no 5 seguidos del mismo creador), reglas de negocio, frecuencia de anuncios, filtros de seguridad.</p>` },
          ] },
          { t: 'h3', text: 'Repartir las tablas: modelo-paralelo para tablas, data-paralelo para MLPs' },
          { t: 'p', html: R`Primero sin notación. Las tablas no caben en una GPU, así que cada GPU guarda <b>algunas</b> tablas (o pedazos de una tabla grande). Los MLPs son chicos, así que <b>cada</b> GPU tiene una copia completa y procesa su parte del batch. El problema: la GPU 3 tiene la tabla de "anunciante" y necesita darle a cada GPU el vector de anunciante de <b>sus</b> muestras. Eso es un <b>all-to-all</b>: cada GPU manda a cada otra la parte del batch que le toca. DLRM lo llama "butterfly shuffle" (Fig. 2) y es el paralelismo combinado que el paper describe como "un requisito único de DLRM" (§3).` },
          { t: 'table', caption: 'Formas de repartir una tabla (TorchRec / FBGEMM)', head: ['Sharding', 'Cómo', 'Cuándo'], rows: [
            ['Table-wise', 'Cada tabla entera en una GPU', 'Muchas tablas chicas y medianas: balancear por tamaño y por lookups'],
            ['Row-wise', 'Las filas de una tabla repartidas entre GPUs', 'Una tabla más grande que la memoria de una GPU'],
            ['Column-wise', 'Las columnas (dimensiones) repartidas', 'Tablas anchas: reparte también el ancho de banda de los lookups'],
            ['Data-parallel', 'Copia completa en cada GPU', 'Tablas diminutas (3 filas): replicar es más barato que comunicar'],
          ], note: R`${ZION}: DLRMs de hasta 12 billones (12·10¹²) de parámetros, particionando las tablas por filas y columnas de forma jerárquica, con memoria en niveles (HBM + DDR + SSD); según el paper, los DLRMs son la aplicación de IA que más infraestructura consume en los data centers de Facebook.` },
          { t: 'callout', kind: 'trap', title: '"Uso DDP como con cualquier modelo"', html: R`<p>DDP replica todo el modelo en cada GPU: con ${met('embB32', CM)} de tablas (la config de MLPerf en fp32) no entra en ninguna GPU, y además el all-reduce de gradientes de tablas enormes y ralas (cada batch toca una fracción mínima de filas) sería absurdo. Tablas: modelo-paralelo con all-to-all y optimizador ralo (solo se actualizan las filas tocadas); MLPs: DDP con all-reduce. El balanceo importa tanto como el reparto: si una GPU recibe la tabla con más lookups, todas la esperan.</p>` },
          { t: 'table', caption: 'Trucos de serving', head: ['Truco', 'Qué gana', 'Qué cuesta'], rows: [
            ['Tablas en fp16/int8 (int8 por fila)', '2–4× memoria y bytes por lookup', 'Un poco de calidad: validar NE y calibración'],
            ['Cache de filas calientes en HBM, el resto en DRAM o SSD', 'Tablas más grandes que la HBM; los ids siguen una ley de potencia', 'Latencia de cola cuando falla la cache'],
            ['Parte del usuario una vez por request', 'Ahorra (k − 1) lookups y MLPs del lado usuario', 'Arquitectura que separa usuario e ítem hasta cierta capa'],
            ['Ranker ligero antes del pesado (cascada)', 'El pesado ve 500 en vez de 5,000', 'Otro modelo que entrenar y que puede cortar buenos candidatos'],
            ['Destilar el pesado en el ligero', 'El ligero imita el orden del pesado', 'Re-destilar en cada versión'],
          ] },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Mejora offline, nada online.</b> El modelo nuevo gana en AUC y no mueve el A/B. Causas típicas: training/serving skew, fuga de información en una feature (calculada con datos posteriores a la impresión), el set de evaluación no representa el tráfico (solo impresiones que el modelo viejo eligió: sesgo de selección), o la métrica offline no es la del producto (clicks contra retención). Wide & Deep reporta lo contrario: +0.002 de AUC offline y +3.9 % de adquisiciones online (Tabla 1), porque el sistema online explora y aprende de respuestas nuevas.`,
            R`<b>Descalibración.</b> Negative downsampling sin re-calibrar, un cambio de mezcla de tráfico, una feature que se rompe en un segmento. La AUC no lo ve; la NE y la calibración por segmento sí. Arreglo: monitorear Σ p̂ / Σ y por segmento en tiempo real y una capa de calibración (isotónica o Platt) re-ajustada seguido.`,
            R`<b>Colisiones y ids raros.</b> Con hashing, un id nuevo y un id viejo popular pueden compartir fila: el nuevo hereda el comportamiento del viejo. Los ids que se ven una vez sobreajustan su fila (de ahí entrenar una época, el "one-epoch phenomenon" de Zhang et al., CIKM 2022, el filtro por frecuencia de Monolith o un umbral mínimo de apariciones antes de darle fila propia).`,
            R`<b>Datos viejos.</b> La NE empeora con cada día de atraso del modelo (He et al., Fig. 2). Los ids nuevos (anuncios de hoy) no tienen embedding entrenado: el modelo cae a las features densas y de contenido. Arreglo: entrenamiento incremental diario o continuo, con sincronización de las filas actualizadas al serving (Monolith: minutos).`,
            R`<b>Feedback loop y sesgo de posición.</b> El ranker se entrena con lo que él mismo mostró, en las posiciones que él eligió: sin features de posición y sin exploración, se auto-confirma.`,
          ] },
          { t: 'table', caption: 'Rankers (filas = criterios)', head: ['Criterio', 'Logística + cruces a mano', 'GBDT', 'Wide & Deep', 'DLRM / DCN v2', 'Secuencial (DIN, HSTU)'], rows: [
            ['Ids de alta cardinalidad', 'Sí, un peso por valor (ralo)', 'Mal: hay que convertirlos en conteos o CTRs', 'Sí (wide y embeddings)', 'Sí (embeddings)', 'Sí'],
            ['Interacciones', 'Solo las que defines', 'Automáticas entre features densas', 'Cruces a mano + MLP', 'Explícitas de 2.º orden (DLRM) o de orden l + 1 (DCN) + MLP', 'Atención sobre el historial'],
            ['Costo de serving por candidato', 'Mínimo', 'Bajo (comparaciones)', 'Bajo–medio', 'Bajo en MACs, alto en memoria', 'Medio–alto'],
            ['Dónde está el modelo', 'Pesos ralos', 'Árboles (MB)', 'Tablas + MLP', 'Tablas (GB–TB) + MLP', 'Tablas + transformer'],
            ['Cuándo', 'Baseline, regulado', R`Tabular denso, datos medianos (<a href="#gbdt">GBDT</a>)`, 'Memorizar excepciones + generalizar', 'Escala de anuncios y feeds', 'Cuando el orden de las acciones importa'],
          ], note: R`Fuentes: ${WD}; ${DLRM}; ${DCN2}; ${DIN}; ${HSTU}.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota: "for a ranking model I watch calibration per segment and normalized entropy, not only AUC, I log features at serving time to avoid training-serving skew, I put position in training and fix it at serving, and I retrain at least daily because the gain from freshness is often larger than the gain from a new architecture."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Cuándo lo mencionas'], rows: [
            [R`Factorization Machines (${FM})`, 'Pesos de cruce de 2.º orden factorizados como productos punto de embeddings.', 'El origen de la interacción de DLRM'],
            [R`GBDT + regresión logística (${FB})`, 'Cada árbol de un GBDT es una feature categórica (la hoja a la que cae la muestra) para un modelo lineal.', R`La historia del CTR; <a href="#gbdt">GBDT</a>`],
            [R`Wide & Deep (${WD})`, 'Lineal con cruces a mano + MLP sobre embeddings, entrenados juntos.', 'Memorización vs generalización'],
            [R`DeepFM (${DEEPFM})`, 'Reemplaza la parte wide por una FM: sin cruces a mano.', 'Wide & Deep sin feature engineering'],
            [R`DCN (${DCN}) y DCN v2 (${DCN2})`, 'Capas cross x₀ ⊙ (W xₗ + b) + xₗ; la v2 con matriz completa o de rango bajo y mezcla de expertos.', 'El estándar actual; MLPerf DLRM-DCNv2'],
            [R`DLRM (${DLRM})`, 'Embeddings + bottom MLP + productos punto por pares + top MLP; paralelismo combinado.', 'La canónica; el benchmark'],
            [R`DIN (${DIN})`, 'Atención del candidato sobre el historial del usuario: el historial se pondera según el ítem que se puntúa.', 'Historial en el ranker'],
            [R`MMoE (${MMOE})`, 'Varias tareas (click, like, tiempo) con expertos compartidos y una compuerta por tarea.', 'Ranking multi-objetivo (YouTube 2019)'],
            [R`HSTU / Generative Recommenders (${HSTU})`, R`El ranking y el retrieval como transducción secuencial sobre las acciones del usuario. Desde MLPerf Training v6.1, el benchmark de recomendación es DLRMv4: un modelo chico de 3 capas HSTU (d = 512, secuencias de hasta 4,096) sobre Yambda-5B, que reemplaza a DLRM-DCNv2 (${DLRMV4}; resultados de v6.1 todavía sin publicar).`, 'Hacia dónde va el ranking'],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`El ranking aparece en casi toda ronda de diseño de recomendación o de anuncios: "diseña el ranking del feed", "predice el CTR de anuncios". Las segundas preguntas: el embudo con números, dónde están los parámetros, cómo se reparte el modelo, calibración, la diferencia offline/online, el feature store y la frescura. Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'callout', kind: 'connect', html: R`<p>Las preguntas de sistema completo que siguen a estas (exploración con bandits y presupuesto de impresiones, evaluación off-policy con la propensión logueada, interleaving para comparar rankers, A/B con SRM, efecto novedad e interferencia, guardrails, ESMM en el embudo de conversión) están en el curso de diseño de sistemas de ML, en su caso de recomendación. Aquí: el modelo, sus costos y sus trampas.</p>` },
          { t: 'followups', items: [
            { q: 'Design the ranking stage for an ads (or feed) system: 50K QPS peak, 500 candidates per request, 100 ms p99 for ranking.',
              junior: 'Un DNN que predice el click de cada candidato.',
              senior: R`<b>Preguntas</b>: ¿objetivo (click, conversión, valor esperado)?, ¿la salida se usa en una subasta (necesita calibración)?, ¿qué tan rápido entran anuncios nuevos?, ¿features disponibles en tiempo real? <b>Cuentas</b>: 50K QPS × 500 = ${est('2.5·10⁷ candidatos por segundo')}. Con un ranker de ${est('≈ 20M MACs')} por candidato en los MLPs (un modelo de producción mediano, unas 40 veces la canónica), son ${est('5·10¹⁴ MACs/s ≈ 1 PFLOP/s')}: con GPUs al ${est('≈ 30 %')} de su pico bf16, ${est('≈ 4 H100')} de cómputo puro; el número real lo deciden los lookups y la red. <b>Lookups</b>: ${est('≈ 300')} features categóricas del lado del ítem × 500 candidatos × 64 dims × 2 bytes ${est('≈ 19 MB')} leídos por request, ${est('≈ 1 TB/s')} en el pico: en el orden del ancho de banda de HBM de una GPU, por eso las tablas calientes van a HBM, repartidas en varias GPUs, y las features del usuario se calculan <b>una vez</b> por request. <b>Memoria</b>: tablas de ${est('≈ 5·10⁹ filas × 64')} en fp16 ${est('≈ 640 GB')}: no cabe con margen en una máquina de 8 × 80 GB (es justo el total, sin lugar para MLPs, activaciones ni cache): dos máquinas, int8 (${est('≈ 320 GB')}), o HBM como cache de filas calientes con el resto en DRAM. <b>Arquitectura</b>: cascada (ranker ligero de 2,000 → 500, pesado sobre 500), modelo DLRM/DCN v2 con varias cabezas (pClick, pConversión) y la posición como feature solo en entrenamiento. <b>Latencia</b> (100 ms p99): features ${est('≈ 20–30 ms')} (lo más variable: red y feature store), inferencia ${est('≈ 20–30 ms')} con batching de los 500 candidatos, el resto margen. <b>Datos</b>: logs de impresiones con las features <b>tal como se sirvieron</b>, etiquetas con ventana para conversiones tardías, negative downsampling con re-calibración. <b>Entrenamiento</b>: incremental diario o continuo (la frescura vale ≈ 1 % de NE), tablas en modelo-paralelo y MLPs en data-paralelo. <b>Evaluación</b>: NE y calibración por segmento offline; A/B con ingresos o engagement y guardrails (latencia, calidad de anuncios).`,
              say: 'First I ask about the objective, whether the scores feed an auction and need calibration, and how fresh features must be. Fifty thousand QPS times five hundred candidates is twenty-five million scorings per second; with a twenty-million-MAC ranker that is about one petaflop per second, a handful of GPUs of pure compute, so the real constraints are embedding lookups and feature fetching. Tables of a few billion rows are hundreds of gigabytes in fp16, sharded across GPUs with hot-row caching, and user-side features are computed once per request. I use a cascade with a light ranker, a DCN-style heavy ranker with multiple heads and position as a training-only feature, log features as served, recalibrate after negative downsampling, retrain daily or continuously, and evaluate with normalized entropy and per-segment calibration offline and an A/B test online.',
              why: 'Se anota preguntar por objetivo y calibración, la cuenta de candidatos por segundo, que el límite son lookups y features y no MACs, el sharding, la cascada, features logueadas, re-calibración y frescura.' },
            { q: 'Where are the parameters of a DLRM, and what does that imply for training and serving?',
              junior: 'En las capas del MLP, como en cualquier red.',
              senior: R`En las tablas: ${met('embShare')} en la canónica de Criteo Kaggle (${met('embP')} de ${qn('params.total')}); en los modelos de producción, tablas de cientos de GB a TB (Meta reporta entrenar DLRMs de hasta 12 billones de parámetros). Implicaciones: (1) memoria: un lookup casi no tiene aritmética (${met('embeddingIntensity')} FLOPs/byte contra ${met('ridge')} del punto de quiebre de una H100); el modelo entero puede quedar del lado del cómputo si el MLP es grande (la canónica: ${met('ai')} FLOPs por byte de filas leídas) o acercarse al de memoria con muchos lookups (DLRM-DCNv2 multi-hot queda justo en el límite, ${met('ai', CD)}); (2) paralelismo combinado: tablas repartidas en modelo-paralelo con all-to-all, MLPs en data-paralelo; (3) optimizadores ralos que solo tocan las filas usadas; (4) compresión de tablas (fp16/int8, hashing, QR, TT) antes que achicar el MLP; (5) el MLP domina los MACs, así que en serving se agrupan candidatos en batches para usar bien la GPU.`,
              say: 'Almost all of them are in the embedding tables, over ninety-nine percent for the Criteo Kaggle reference, and production tables reach terabytes. Lookups have essentially no arithmetic, so the embedding side is memory-bound while the MLPs carry the FLOPs; tables are sharded model-parallel with all-to-all communication while the MLPs are data-parallel, updates are sparse, and compression targets the tables first.',
              why: 'Trampa: "en el MLP". Se anota el porcentaje, la intensidad aritmética, el paralelismo combinado y la compresión de tablas.', trap: true },
            { q: 'What does the interaction layer do in DLRM, and how is it different from DCN v2?',
              junior: 'Concatena las features.',
              senior: R`DLRM apila los ${cf('nSparse')} embeddings y el vector denso (27 × d), calcula todos los productos punto entre pares (la matriz de Gram), se queda con el triángulo inferior sin diagonal (351 números) y los concatena con el denso: 367 entradas al top MLP. Es una factorization machine: cada producto punto es un peso de cruce factorizado, que existe aunque el par nunca se haya visto. DCN v2 cruza <b>elementos</b>, no vectores: x<sub>l+1</sub> = x<sub>0</sub> ⊙ (W x<sub>l</sub> + b) + x<sub>l</sub> sobre la concatenación completa; cada capa sube un grado del polinomio, con W de rango bajo (UVᵀ) para controlar el costo. En Criteo, DCN v2 0.4406 de log loss contra 0.4427 de DLRM y 0.4421 de un MLP solo (Tabla 6); en MLPerf, DLRM-DCNv2 reemplazó a DLRM desde v3.0.`,
              say: 'DLRM stacks the dense vector and the twenty-six embeddings, takes all pairwise dot products, keeps the strict lower triangle and concatenates it with the dense vector, like a factorization machine. DCN v2 instead crosses individual elements of the concatenated input with a learned, usually low-rank matrix, adding one polynomial degree per layer; it was better on Criteo and replaced DLRM in MLPerf.',
              why: 'Se anota la matriz de Gram con el triángulo, el 367, la analogía con FM y el cruce elemento a elemento de DCN v2.' },
            { q: 'Your new model has higher offline AUC but loses in the A/B test. What do you check?',
              junior: 'Entreno más tiempo.',
              senior: R`En orden: (1) <b>training/serving skew</b>: comparo las features que el modelo ve en serving con las del entrenamiento para el mismo request (loguear y diffear); una feature con default distinto online basta. (2) <b>Fuga</b>: alguna feature calculada con datos posteriores a la impresión (un CTR del día completo) infla el offline. (3) <b>Calibración</b>: AUC igual o mejor pero predicciones corridas: si el score se combina con otras cabezas o con la puja, el orden final cambia. Miro calibración por segmento. (4) <b>Sesgo de selección</b>: el set offline son impresiones que eligió el modelo viejo; el nuevo puede ser mejor justo donde no hay datos. (5) <b>La métrica</b>: AUC de clicks contra un A/B que mide retención o ingresos; y la AUC global mezcla usuarios con CTRs distintos: para feeds, AUC por usuario (GAUC) o NDCG@k por request. (6) <b>Frescura y latencia</b>: el modelo nuevo es más lento y pierde timeouts, o se despliega con más atraso.`,
              say: 'I check for training-serving skew by logging and diffing served features, for leakage from features computed after the impression, for calibration per segment since scores feed auctions or multi-head blends, for selection bias in an offline set built from the old model\'s impressions, for a metric mismatch between global AUC and the online objective, preferring per-user AUC or NDCG per request for feeds, and for latency or freshness regressions.',
              why: 'Trampa: entrenar más. Se anota skew, fuga, calibración, sesgo de selección, la métrica y latencia/frescura.', trap: true },
            { q: 'Why does calibration matter if AUC is what ranks the items?',
              junior: 'No importa, solo importa el orden.',
              senior: R`Porque el pCTR casi nunca se usa solo. En anuncios, el orden es puja × pCTR: si el modelo sobre-predice ×2 para un anunciante, gana subastas que no debería y se cobra mal. En feeds, el score es Σ w<sub>i</sub> p̂<sub>i</sub> sobre varias cabezas: una cabeza descalibrada cambia su peso efectivo. Y hay umbrales (no mostrar si p(reporte) > x). La AUC es invariante a transformaciones monótonas, así que no ve nada de esto; NE y calibración (Σ p̂ / Σ y, por segmento) sí. Bug clásico: entrenar con negative downsampling y no re-calibrar con q = p / (p + (1 − p)/w).`,
              say: 'Predicted probabilities are combined with bids in auctions and with other heads in multi-objective feeds, and they drive thresholds, so their values matter, not only their order. AUC is invariant to monotonic transforms and cannot see miscalibration, so I track normalized entropy and expected-over-observed clicks per segment, and recalibrate after negative downsampling.',
              why: 'Trampa: "solo importa el orden". Se anota subasta, combinación de cabezas, invarianza de la AUC y la re-calibración.', trap: true },
            { q: 'How do you handle position bias in the training data?',
              junior: 'Mezclo el orden al azar.',
              senior: R`Lo de arriba se clickea más por estar arriba. Si no lo modelo, el ranker aprende a repetir lo que el modelo anterior puso arriba. Opciones: (1) la posición como feature en entrenamiento y un valor fijo en serving (todos los candidatos se puntúan "en la misma posición"); (2) una shallow tower de sesgo separada que se suma al logit al entrenar y se apaga al servir (YouTube 2019); (3) factorizar p(click) = p(visto | posición) · p(click | visto) (PAL); (4) estimar la propensión por posición con un poco de tráfico aleatorizado (intercambiar posiciones) y pesar los ejemplos por inverse propensity. Mezclar el orden para todos no: cuesta mucho engagement; se hace en una fracción chica para estimar la propensión.`,
              say: 'I include position as a training-only feature, or a separate shallow bias tower, and set it to a fixed value at serving so every candidate is scored at the same position. I can also factorize click probability into examination probability by position times relevance, as in PAL, and estimate position propensities from a small randomized slice for inverse propensity weighting.',
              why: 'Se anota la posición solo al entrenar, la shallow tower, PAL y propensidades con un poco de tráfico aleatorio.' },
            { q: 'How would you shard and train a DLRM whose embedding tables are 2 TB?',
              junior: 'Con DDP en muchas GPUs.',
              senior: R`DDP no: replicaría 2 TB en cada GPU. Tablas en <b>modelo-paralelo</b>: table-wise para las medianas, row-wise para las enormes, column-wise para repartir ancho de banda, data-parallel para las diminutas; un planner balancea memoria y lookups por GPU (TorchRec lo hace con un costo por tabla). Con 80 GB de HBM, 2 TB en fp32 son ${est('≈ 25+ GPUs')} solo de tablas, más el estado del optimizador (Adagrad: ×2): o más GPUs, o tablas en fp16/int8, o niveles de memoria (HBM como cache de filas calientes, DRAM y SSD para el resto, como en el ZionEX de Meta). <b>MLPs</b> en data-paralelo con all-reduce. Entre los dos, un <b>all-to-all</b> por iteración (ida en el forward, vuelta de gradientes en el backward) que se solapa con cómputo (pipeline). Optimizador <b>ralo</b>: solo las filas tocadas. Y el pipeline de datos: miles de millones de muestras, una época, lectura en streaming.`,
              say: 'Not with plain data parallelism, which would replicate two terabytes per GPU. I shard tables model-parallel, table-wise, row-wise or column-wise with a planner that balances memory and lookup load, use reduced precision and a memory hierarchy with hot rows in HBM, keep the MLPs data-parallel with all-reduce, overlap the all-to-all exchange with compute, and use sparse optimizer updates.',
              why: 'Trampa: DDP. Se anota el paralelismo combinado, los tipos de sharding, el all-to-all, la jerarquía de memoria y el optimizador ralo.', trap: true },
            { q: 'What is a feature store and what problem does it solve for ranking?',
              junior: 'Una base de datos de features.',
              senior: R`Es la definición única de cada feature para entrenar y para servir: el mismo cálculo (o el mismo pipeline) produce el valor offline (histórico, para entrenar) y online (baja latencia, para servir). Resuelve tres problemas: (1) <b>training/serving skew</b> (dos implementaciones de la misma feature); (2) <b>point-in-time correctness</b>: al armar el set de entrenamiento, cada ejemplo recibe el valor de la feature <b>en el instante</b> de la impresión, no el de hoy (si no, hay fuga del futuro); (3) reutilización y frescura (features en streaming con su SLA). La alternativa que usan muchos equipos de ranking: loguear el vector de features tal como se sirvió y entrenar con esos logs; sin skew por construcción, pero una feature nueva necesita esperar a juntar logs (o un backfill cuidadoso).`,
              say: 'A feature store gives each feature one definition that produces both offline training values and low-latency online values, which prevents training-serving skew, supports point-in-time joins so training examples see feature values as of the impression time, and manages freshness. Many ranking teams also log features exactly as served and train on those logs.',
              why: 'Se anota skew, point-in-time joins (fuga del futuro), frescura y la alternativa de loguear lo servido.' },
            { q: 'Conversions arrive days after the click. How do you train a conversion model?',
              junior: 'Espero una semana antes de entrenar.',
              senior: R`Esperar a que lleguen todas cuesta frescura, y la frescura vale. Entrenar con lo que hay convierte positivos tardíos en negativos y sub-predice, sobre todo en lo nuevo. Opciones: (1) una ventana de atribución corta y fija (por ejemplo, 1 día) con la etiqueta "convirtió dentro de la ventana", que es lo que se predice; (2) modelar el retraso: p(convierte) × p(ya llegó | tiempo transcurrido), como Chapelle (KDD 2014), y entrenar con todos los ejemplos; (3) re-etiquetar: entrar el ejemplo como negativo y corregirlo (re-emitirlo como positivo) cuando llega la conversión, con pesos de importancia para no duplicar. Y medir la calibración por "edad" del ejemplo. Además, si el modelo de conversión se entrena solo con clicks y se sirve sobre todas las impresiones, tiene sesgo de selección y pocos datos; ESMM (${ESMM}) entrena p(click) y p(click y conversión) = p(click) · p(conversión | click) sobre todas las impresiones (el detalle de sistema está en el caso de recomendación del curso de diseño de sistemas de ML).`,
              say: 'Waiting for all conversions kills freshness, while training on what has arrived turns late positives into negatives. I either predict conversion within a fixed short window, model the delay explicitly as in Chapelle\'s delayed feedback model, or ingest examples as negatives and correct them when the conversion arrives with importance weighting, and I check calibration by example age. I also avoid training conversion only on clicked impressions, which is biased; I model click and click-then-convert jointly over all impressions, as in ESMM.',
              why: 'Se anota el trade-off frescura/etiquetas, la ventana fija, el modelo de retraso, la re-etiquetación y el sesgo de selección de entrenar solo con clicks (ESMM).' },
            { q: 'Wide & Deep: what does each part do, and why train them jointly?',
              junior: 'La parte wide es más ancha.',
              senior: R`<b>Wide</b>: un modelo lineal sobre features ralas y cruces elegidos a mano ("app instalada = Netflix AND app mostrada = Pandora"): memoriza excepciones concretas con pocos parámetros. <b>Deep</b>: embeddings (32 por feature en el paper) + MLP (1024-512-256): generaliza a combinaciones nunca vistas, pero con interacciones ralas y de alto rango (nichos) puede sobre-generalizar y recomendar cosas poco relevantes. <b>Juntas</b>: los logits se suman antes de una sola sigmoide y se entrenan a la vez (FTRL + L1 para la wide, AdaGrad para la deep), así la wide solo cubre lo que la deep no, con pocos cruces; un ensemble entrenado por separado necesitaría dos modelos completos. Resultado (Google Play, Tabla 1): AUC offline 0.726 / 0.722 / 0.728 (wide / deep / W&D) y +3.9 % de adquisiciones online contra la wide (+1 % sobre la deep).`,
              say: 'The wide part is a linear model over sparse features and hand-picked crosses that memorizes specific exceptions; the deep part uses embeddings and an MLP to generalize to unseen combinations but can over-generalize for niche items. Training them jointly lets the wide part only cover what the deep part misses. On Google Play it lifted app acquisitions by three point nine percent over the wide-only model.',
              why: 'Se anota memorización vs generalización, el entrenamiento conjunto (no ensemble) y los números del paper.' },
            { q: 'How do you make ranking multi-objective (clicks, likes, watch time, reports)?',
              junior: 'Sumo los labels.',
              senior: R`Varias cabezas sobre una base compartida (o MMoE: expertos compartidos con una compuerta por tarea, que maneja tareas en conflicto mejor que una base única), cada una con su pérdida y su calibración. El score final es una combinación Σ w<sub>i</sub> p̂<sub>i</sub> (más términos negativos: p(reporte), p(ocultar)), con los pesos como <b>decisión de producto</b> ajustada con A/Bs, no aprendidos por el modelo. Twitter publicó la suya: ≈ 10 probabilidades de engagement con pesos en un archivo de configuración. Para tiempo de visualización, Covington usa logística ponderada: los positivos pesan su tiempo visto y los odds aprendidos aproximan el tiempo esperado. Cuidado: si una cabeza se descalibra, su peso efectivo cambia; y optimizar solo clicks premia el clickbait (Covington lo dice explícito).`,
              say: 'I train multiple heads on a shared or multi-gate mixture-of-experts base, one calibrated probability per objective, and combine them with a weighted sum whose weights are a product decision tuned through A/B tests, including negative terms like report probability. For watch time, weighted logistic regression gives odds that approximate expected watch time.',
              why: 'Se anota cabezas o MMoE, la combinación con pesos de producto, la calibración de cada cabeza y la logística ponderada de YouTube.' },
            { q: 'How would you use the user\'s behavior sequence in retrieval and in ranking?',
              junior: 'Promedio los embeddings de los últimos ítems.',
              senior: R`El promedio (Covington, la canónica de <a href="#two-tower">two-tower</a>) pierde el orden y trata igual lo de hace un minuto y lo de hace un mes. <b>En retrieval</b>: la torre de usuario pasa a ser un transformer causal sobre los últimos L ítems (${SASREC}): predice el siguiente ítem con atención solo hacia atrás y su salida en la última posición es u; sigue siendo un producto punto indexable. BERT4Rec (CIKM 2019) usa máscara bidireccional estilo cloze; ojo con evaluarlo con un split que deje ver el futuro, y con comparaciones contra un SASRec mal tuneado: ${DROSS} muestran que SASRec entrenado con la misma pérdida (softmax completa, o muchos negativos muestreados en vez de uno) le gana. <b>En ranking</b>: atención del candidato sobre el historial (${DIN}): el historial se pondera según el ítem que se puntúa, así "vio 3 videos de cocina" pesa para un candidato de cocina y no para uno de fútbol. Ese es el cruce usuario × ítem que el two-tower no puede hacer. <b>Costo</b>: la atención de DIN corre por candidato: al menos k × L × d MACs (500 × 1,000 × 64 ${est('≈ 32M')} por request; la unidad de activación de DIN, un MLP chico por par, multiplica eso), más leer L filas de la tabla de ítems; por eso se trunca L, se pre-filtra el historial por categoría del candidato o se cachea la codificación del usuario por sesión. <b>Datos</b>: la secuencia se arma "as of" la impresión (sin eventos posteriores) y con los mismos ids que en serving; los eventos de los últimos minutos llegan por streaming. <b>Hacia dónde va</b>: HSTU (ICML 2024) trata retrieval y ranking como transducción secuencial sobre todas las acciones del usuario y reporta escalamiento tipo LLM hasta 1.5 billones de parámetros; una versión chica de 3 capas es el benchmark de recomendación de MLPerf Training desde v6.1.`,
              say: 'The mean of recent items loses order and recency. In retrieval I replace it with a causal transformer over the last few hundred interactions, as in SASRec, whose last output is still a user vector for the index. In ranking I use target attention as in DIN, so the history is weighted by its relevance to the candidate being scored, which is the user-item interaction the two-tower model cannot express. Its cost scales with candidates times sequence length, so I truncate or pre-filter the history and cache the user encoding, and I build sequences point in time to avoid leaking future events.',
              why: 'Se anota por qué el promedio no basta, SASRec en la torre de usuario (sigue siendo indexable), DIN como interacción candidato × historial en el ranker, el costo k × L, la construcción point-in-time y HSTU como dirección actual.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuánto ocupan las tablas de la canónica y cuánto se lee por muestra?',
              a: R`${met('embP')} parámetros = ${met('embB32')} en fp32. Por muestra: ${met('lookN')} filas de ${cf('dim')} números = ${met('look')} con ${cf('bits')} bits.` },
            { q: 'Entrenaste con negative downsampling w = 0.1 y el modelo predice 0.2 en una impresión. ¿Qué probabilidad real reportas?',
              a: 'q = p / (p + (1 − p)/w) = 0.2 / (0.2 + 0.8/0.1) = 0.2 / 8.2 ≈ 0.0244. Sin re-calibrar, sobre-predices ≈ 8×; la AUC no cambia, la calibración sí.' },
            { q: 'La AUC de tu modelo es 0.80 en todos los países, pero en uno la calibración es 1.6. ¿Qué pasa y qué haces?',
              a: 'Ese país recibe predicciones 60 % más altas que su CTR real: gana subastas o posiciones que no debería. Causas: una feature rota o distinta en ese país, mezcla de tráfico nueva, poco dato. Arreglos: revisar las features del segmento, una calibración por segmento (isotónica) y monitoreo de Σ p̂ / Σ y por segmento.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (los calcula el calculador), las cuentas a mano y al final el ejercicio de código: un DLRM chico, su interacción comparada con la del repo oficial, la NE y la re-calibración.` },
          { t: 'h3', text: 'Diagrama en blanco' },
          { t: 'blankdiagram', diagram: 'dlrm-overview', slots: [
            { node: 'bottom-mlp', tensor: T.bot, ask: 'shape' },
            { node: 'embeddings', ask: 'label', hint: 'una fila por id, sin MACs' },
            { node: 'interaction', tensor: T.topIn, ask: 'shape' },
            { node: 'top-mlp', ask: 'label', hint: 'termina en un logit' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'dlrm', pool: 'all', configs: [C, CM, CD, CW] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Duplicas la dimensión de los embeddings (de ${cf('dim')} a 32). ¿Por qué factor cambian los parámetros de las tablas?`, change: { dim: 32 }, ask: 'embeddingParams',
              explain: '×2: cada fila tiene el doble de números. Y los bytes por lookup también ×2.' },
            { q: 'Mismo cambio. ¿Y los MACs de la interacción por productos punto?', change: { dim: 32 }, ask: 'interactionMacs',
              explain: '×2: (n_s + 1)² productos de d elementos. La cantidad de pares (351) no cambia.' },
            { q: 'Guardas las tablas en int8 en lugar de fp32. ¿Por qué factor cambia su memoria?', change: { bits: 8 }, ask: 'embeddingBytes',
              explain: '÷4, con los mismos parámetros y los mismos MACs. Es la primera palanca de memoria en recsys.' },
            { q: 'Mismo cambio. ¿Y la intensidad aritmética?', change: { bits: 8 }, ask: 'arithmeticIntensity',
              explain: '×4 (584 → 2,337 FLOPs/byte): los mismos FLOPs con ¼ de los bytes. La canónica ya estaba por encima del punto de quiebre (≈ 295): el lote queda aún más del lado del cómputo; lo que baja ÷4 es el tiempo de los lookups. Las tablas en sí siguen en ≈ 1 FLOP/byte.' },
            { q: 'Capas todas las tablas en 1M filas (hashing). ¿Qué pasa con los parámetros de embeddings?', change: { maxRows: 1000000 }, ask: 'embeddingParams',
              explain: 'Bajan mucho: las tablas de 10M, 8M, 7M, 5M y 2M filas quedan en 1M; las chicas no cambian. El costo: colisiones en las tablas grandes.' },
            { q: 'Mismo tope. ¿Qué pasa con los MACs por muestra?', change: { maxRows: 1000000 }, ask: 'macsPerSample',
              explain: 'Nada: un lookup lee una fila igual de ancha en una tabla grande o chica. El tope cambia memoria, no cómputo.' },
            { q: R`Rankeas 2,000 candidatos por request en lugar de ${cf('k')}. ¿Por qué factor cambia el costo del ranking?`, change: { k: 2000 }, ask: 'rankingMacsPerRequest',
              explain: 'Lineal en k: un forward por candidato. Por eso hay rankers ligeros antes del pesado.' },
          ] },
          { t: 'h3', text: 'A mano' },
          { t: 'calc', title: 'Parámetros de la canónica (verificado contra el calculador y con PyTorch)', rows: [
            { label: 'Tablas: 26 cardinalidades de Criteo Kaggle', expr: R`${met('rows')} filas × 16`, value: met('embP') },
            { label: 'Bottom MLP 13-512-256-64-16', expr: '13·512 + 512 + 512·256 + 256 + 256·64 + 64 + 64·16 + 16', value: qn('node.bottom-mlp.params') },
            { label: 'Top MLP 367-512-256-1', expr: '367·512 + 512 + 512·256 + 256 + 256 + 1', value: qn('node.top-mlp.params') },
            { label: 'Total', expr: 'tablas + MLPs', value: qn('params.total'), note: 'el mismo número que da PyTorch (abajo)' },
            { label: 'Entrada del top MLP', expr: '16 + 27·26/2', value: '367' },
            { label: 'Bytes leídos de tablas por muestra (fp32)', expr: '26 × 16 × 4', value: '1,664 bytes' },
          ], result: R`Las tablas son 99.912 % de los parámetros; la más grande (${met('bigRows')} filas) sola tiene ${est('≈ 162M')}. Y los MLPs hacen ${met('mlpMacs')} por muestra contra 0 de los lookups: memoria en un lado, cómputo en el otro.` },
          { t: 'calc', title: 'NE y calibración de 10 impresiones (2 clicks: CTR de fondo 0.2)', rows: [
            { label: 'Predecir siempre 0.2', expr: 'log loss = entropía del CTR de fondo', value: 'NE = 1.0' },
            { label: 'Modelo p = [0.6, 0.1, 0.1, 0.2, 0.5, 0.1 × 5]', expr: 'Σ p̂ / Σ y = 2.0 / 2', value: 'NE = 0.4326, calibración 1.0' },
            { label: 'El mismo modelo dividido por 2', expr: 'Σ p̂ / Σ y = 1.0 / 2', value: 'NE = 0.6104, calibración 0.5', note: 'la AUC no cambia: 1.0 en los dos' },
          ], result: 'Misma AUC, peor NE: la AUC mide el orden y la NE los valores. Verificado con el código de abajo.' },
          { t: 'calc', title: 'A mano: propensión por posición (IPS)', rows: [
            { label: 'Tráfico aleatorizado: CTR por posición', expr: 'pos 1: 10 %, pos 3: 4 %', value: 'propensión relativa p₃/p₁ = 0.4' },
            { label: 'Un click observado en la posición 3', expr: 'peso = 1 / 0.4', value: '2.5' },
            { label: 'Un click en la posición 1', expr: '1 / 1.0', value: '1.0' },
          ], result: 'Con pesos de inverse propensity, un click en la posición 3 cuenta 2.5 veces uno en la 1: corrige que lo de abajo se ve menos. Los pesos se recortan (por ejemplo a 10) porque las propensiones chicas disparan la varianza.' },

          { t: 'h3', text: 'Escríbelo: un DLRM, su interacción, la NE y la re-calibración' },
          { t: 'p', html: R`Sin mirar: (1) un <code>DLRM</code> con bottom MLP, 26 <code>EmbeddingBag</code>, interacción por productos punto (triángulo inferior estricto concatenado con el denso) y top MLP; (2) contar sus parámetros con las tablas reales de Criteo Kaggle sin reservar memoria (<code>device='meta'</code>); (3) <code>normalized_entropy(p, y)</code> y <code>recalibrate(p, w)</code>. Verificado en el venv del Atlas (PyTorch 2.14): ${met('embP')} parámetros en tablas, ${met('mlpP')} en MLPs (99.912 %, igual que el calculador), entrada del top MLP de 367, la interacción idéntica bit a bit a la de <code>interact_features</code> del repo oficial, NE 1.0 / 0.4326 / 0.6104 y q = 0.0244.` },
          { t: 'code', title: 'Solución de referencia (PyTorch)', files: [
            { name: 'mini_dlrm.py', lang: 'python', code: [
              'import torch',
              'import torch.nn as nn',
              '',
              '',
              'def mlp(sizes, last_relu=True):',
              '    layers = []',
              '    for i, (a, b) in enumerate(zip(sizes, sizes[1:])):',
              '        layers.append(nn.Linear(a, b))',
              '        if last_relu or i < len(sizes) - 2:',
              '            layers.append(nn.ReLU())',
              '    return nn.Sequential(*layers)',
              '',
              '',
              'class DLRM(nn.Module):',
              "    def __init__(self, rows, dim=16, bottom=(13, 512, 256, 64), top=(512, 256, 1), device=None):",
              '        super().__init__()',
              "        self.tables = nn.ModuleList(nn.EmbeddingBag(n, dim, mode='sum', device=device) for n in rows)",
              '        self.bottom = mlp(list(bottom) + [dim]).to(device)                   # 13-512-256-64-16, ReLU en todas',
              '        n = len(rows) + 1                                                    # 26 embeddings + el denso',
              '        self.top = mlp([dim + n * (n - 1) // 2] + list(top), last_relu=False).to(device)   # 16 + 351 = 367',
              '        self.li, self.lj = torch.tril_indices(n, n, offset=-1)               # triángulo inferior estricto',
              '',
              '    def forward(self, dense, sparse):                                        # dense (B, 13), sparse (B, 26)',
              '        x = self.bottom(dense)                                               # (B, d)',
              '        embs = [t(sparse[:, k:k + 1]) for k, t in enumerate(self.tables)]    # 26 × (B, d): lookups',
              '        T = torch.stack([x] + embs, dim=1)                                   # (B, 27, d)',
              '        Z = T @ T.transpose(1, 2)                                            # (B, 27, 27): todos los productos punto',
              '        z = torch.cat([x, Z[:, self.li, self.lj]], dim=1)                    # (B, 16 + 351) = (B, 367)',
              '        return self.top(z).squeeze(1)                                        # logit; sigmoid → pCTR',
              '',
              '',
              'def normalized_entropy(p, y):',
              '    """He et al. 2014: log loss promedio / entropía del CTR de fondo (el de los datos)."""',
              '    ll = -(y * p.log() + (1 - y) * (1 - p).log()).mean()',
              '    c = y.mean()',
              '    return ll / -(c * c.log() + (1 - c) * (1 - c).log())',
              '',
              '',
              'def recalibrate(p, w):',
              '    """Predicción entrenada con negative downsampling a tasa w → probabilidad real (He et al. 2014, §6.3)."""',
              '    return p / (p + (1 - p) / w)',
            ] },
            { name: 'check_dlrm.py', lang: 'python', code: [
              'import torch',
              'from mini_dlrm import DLRM, normalized_entropy, recalibrate',
              '',
              'KAGGLE = [1460, 583, 10131227, 2202608, 305, 24, 12517, 633, 3, 93145, 5683, 8351593, 3194, 27,',
              '          14992, 5461306, 10, 5652, 2173, 4, 7046547, 18, 15, 286181, 105, 142572]',
              "m = DLRM(KAGGLE, device='meta')                                   # sin memoria: solo formas",
              'emb = sum(p.numel() for p in m.tables.parameters())',
              'mlp = sum(p.numel() for p in m.bottom.parameters()) + sum(p.numel() for p in m.top.parameters())',
              'print(emb, mlp, emb + mlp, round(100 * emb / (emb + mlp), 3))     # 540201232 475985 540677217 99.912',
              '',
              'torch.manual_seed(0)',
              'small = DLRM([100] * 26)                                          # tablas chicas para correrlo de verdad',
              'dense, sparse = torch.randn(4, 13), torch.randint(0, 100, (4, 26))',
              'print(small(dense, sparse).shape, small.top[0].in_features)      # torch.Size([4]) 367',
              '',
              '# la interacción == la del repo facebookresearch/dlrm (interact_features, sin la diagonal)',
              'x = small.bottom(dense); ly = [t(sparse[:, k:k + 1]) for k, t in enumerate(small.tables)]',
              'T = torch.cat([x] + ly, dim=1).view((4, -1, 16)); Z = torch.bmm(T, T.transpose(1, 2))',
              'li = torch.tensor([i for i in range(27) for j in range(i)]); lj = torch.tensor([j for i in range(27) for j in range(i)])',
              'print(torch.equal(torch.cat([x, Z[:, li, lj]], 1), torch.cat([x, Z[:, small.li, small.lj]], 1)))   # True',
              '',
              '# NE, calibración y AUC',
              'y = torch.tensor([1., 0., 0., 0., 1., 0., 0., 0., 0., 0.])        # CTR de fondo 0.2',
              'p = torch.tensor([.6, .1, .1, .2, .5, .1, .1, .1, .1, .1])',
              'auc = lambda s: ((s[y == 1][:, None] > s[y == 0][None, :]).float().mean()).item()',
              'for q in (torch.full((10,), 0.2), p, p / 2):',
              '    print(round(normalized_entropy(q, y).item(), 4), round((q.mean() / y.mean()).item(), 3), auc(q))',
              '# 1.0 1.0 0.0  ·  0.4326 1.0 1.0  ·  0.6104 0.5 1.0   (la constante no ordena: AUC 0 con ">")',
              'print(round(recalibrate(torch.tensor(0.2), 0.1).item(), 4))      # 0.0244',
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los bugs que este ejercicio atrapa', html: R`<p>(1) Usar el triángulo con diagonal (378 pares en vez de 351): el top MLP espera otra entrada y la norma de cada vector se cuela como "cruce". (2) Olvidar concatenar x: el top MLP no ve las densas directamente. (3) Que el bottom MLP no termine en d: no se pueden hacer productos punto con los embeddings. (4) Contar los parámetros con las tablas en memoria real: 540M floats son 2.2 GB; <code>device='meta'</code> da las formas sin reservar nada. (5) Reportar AUC y no NE: un modelo ×0.5 sale idéntico.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. La etapa anterior del embudo: <a href="#two-tower">two-tower</a>. Y el baseline tabular que siempre conviene correr antes que una red: <a href="#gbdt">GBDT</a>.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'dlrm-01', kind: 'concepto', q: 'DLRM en una línea.', a: 'Densas → bottom MLP (a d); categóricas → lookups en tablas (d); productos punto entre todos los pares; concat con el denso → top MLP → sigmoide = pCTR.' },
      { id: 'dlrm-02', kind: 'conteo', q: 'Entrada del top MLP de DLRM en Criteo Kaggle.', a: '16 + 27·26/2 = 16 + 351 = 367: el vector denso más el triángulo inferior estricto de la matriz de Gram de 27 vectores.' },
      { id: 'dlrm-03', kind: 'conteo', q: 'Parámetros de DLRM en Criteo Kaggle (d = 16).', a: '≈ 540M (el paper): ≈ 540.2M en tablas y ≈ 0.48M en MLPs; 99.9 % en embeddings.' },
      { id: 'dlrm-04', kind: 'concepto', q: '¿Por qué los lookups de embeddings están limitados por memoria?', a: 'Un lookup lee d números y casi no opera (≈ 0.25 FLOPs/byte en fp32) contra ≈ 295 FLOPs/byte del punto de quiebre de una H100. Las tablas deciden capacidad y ancho de banda; los MLPs, FLOPs. El modelo entero cae de un lado u otro según cuánto MLP hay por lookup.' },
      { id: 'dlrm-05', kind: 'concepto', q: '¿Qué intercambia el all-to-all de DLRM en el forward y en el backward?', a: 'Forward: cada GPU dueña de una tabla manda a cada otra los embeddings de las muestras que le tocan (el "butterfly shuffle"). Backward: los gradientes de esas filas vuelven a la GPU dueña de la tabla.' },
      { id: 'dlrm-06', kind: 'trampa', q: '"Entreno el DLRM con DDP como cualquier modelo."', a: 'Replicaría tablas de cientos de GB a TB en cada GPU y haría all-reduce de gradientes ralos enormes. Tablas repartidas + optimizador ralo; DDP solo para los MLPs.' },
      { id: 'dlrm-07', kind: 'formula', q: 'Capa cross de DCN v2.', a: R`\(\mathbf{x}_{l+1} = \mathbf{x}_0 \odot (W_l\mathbf{x}_l + \mathbf{b}_l) + \mathbf{x}_l\); l capas → polinomio de grado l + 1; W ≈ UVᵀ de rango bajo.` },
      { id: 'dlrm-08', kind: 'tradeoff', q: 'Interacción de DLRM vs DCN.', a: 'DLRM: un producto punto por par de vectores de feature (feature-wise, como una FM). DCN: cruces elemento a elemento sobre la concatenación (bit-wise), de orden creciente por capa.' },
      { id: 'dlrm-09', kind: 'conteo', q: 'DCN v2 en Criteo (Tabla 6): log loss y AUC contra DLRM y un MLP.', a: 'DCN-V2 0.4406 / 0.8115; DLRM 0.4427 / 0.8092; DNN 0.4421 / 0.8098. 0.001 de log loss ya es significativo.' },
      { id: 'dlrm-10', kind: 'concepto', q: 'Wide & Deep en una línea.', a: 'Lineal con cruces a mano (memoriza excepciones) + MLP sobre embeddings (generaliza), sumados antes de una sigmoide y entrenados juntos (FTRL + L1 y AdaGrad).' },
      { id: 'dlrm-11', kind: 'conteo', q: 'Wide & Deep en Google Play (Tabla 1).', a: 'AUC 0.726 / 0.722 / 0.728 (wide / deep / W&D); online +3.9 % de adquisiciones contra la wide, +1 % sobre la deep.' },
      { id: 'dlrm-12', kind: 'formula', q: 'Normalized Entropy (He et al. 2014).', a: 'Log loss promedio / entropía del CTR de fondo: −[p̄ log p̄ + (1 − p̄) log(1 − p̄)]. 1 = no mejor que predecir el promedio; menor es mejor.' },
      { id: 'dlrm-13', kind: 'formula', q: 'Re-calibración tras negative downsampling.', a: 'q = p / (p + (1 − p)/w), con w la fracción de negativos conservada. Ej.: p = 0.2, w = 0.1 → q ≈ 0.0244.' },
      { id: 'dlrm-14', kind: 'trampa', q: '"La AUC es la métrica del ranker; la calibración no importa."', a: 'La AUC es invariante a transformaciones monótonas. El pCTR se multiplica por la puja o se combina con otras cabezas: los valores importan. NE y calibración por segmento.' },
      { id: 'dlrm-15', kind: 'conteo', q: 'En un tipo de anuncio, Σ p̂ = 800 y hubo 1,000 clicks. ¿Calibración y qué pasa?', a: '0.8: sub-predice 20 %; en la subasta (puja × pCTR) esos anuncios pierden impresiones que deberían ganar. Calibración por segmento (isotónica) y revisar las features del segmento.' },
      { id: 'dlrm-16', kind: 'concepto', q: 'Sesgo de posición: el arreglo estándar.', a: 'Posición como feature (o shallow tower) solo al entrenar; en serving, fija para todos los candidatos. PAL: p(click) = p(visto | posición) · p(click | visto).' },
      { id: 'dlrm-17', kind: 'concepto', q: 'Feedback retrasado.', a: 'Las conversiones llegan horas o días después: entrenar ya convierte positivos tardíos en negativos. Ventana fija, modelo del retraso (Chapelle 2014) o re-etiquetado.' },
      { id: 'dlrm-18', kind: 'concepto', q: 'Training/serving skew y cómo se evita.', a: 'La misma feature calculada distinto al entrenar y al servir. Feature store con point-in-time joins, o loguear las features tal como se sirvieron.' },
      { id: 'dlrm-19', kind: 'conteo', q: 'Efecto de la frescura del modelo (He et al. 2014).', a: 'Re-entrenar diario en vez de semanal baja la NE ≈ 1 %: más que la mayoría de los experimentos de features.' },
      { id: 'dlrm-20', kind: 'concepto', q: 'DLRM de MLPerf Training (v0.7–v2.1).', a: 'Criteo 1TB, d = 128, bottom 13-512-256-128, top 1024-1024-512-256-1, tablas con tope de 40M filas, objetivo AUC 0.8025.' },
      { id: 'dlrm-21', kind: 'concepto', q: 'DLRM-DCNv2 de MLPerf Training (desde v3.0).', a: 'Criteo 1TB multi-hot (214 ids por muestra), 3 capas cross de rango 512, Adagrad, batch global 2¹⁶, objetivo AUROC 0.80275. Benchmark de v3.0 a v6.0; en v6.1 lo reemplaza DLRMv4 (3 capas HSTU, dataset Yambda-5B).' },
      { id: 'dlrm-22', kind: 'concepto', q: 'QR trick para tablas de embeddings.', a: 'Dos tablas chicas indexadas por cociente y resto del id, combinadas (por defecto, producto elemento a elemento): cada id recibe un par único de filas, ≈ 2√m filas en lugar de m; mejor que el hashing a igual memoria (Shi et al., KDD 2020).' },
      { id: 'dlrm-23', kind: 'concepto', q: 'Formas de shardear una tabla de embeddings.', a: 'Table-wise (tablas enteras), row-wise (filas repartidas: tablas enormes), column-wise (dimensiones: ancho de banda), data-parallel (tablas diminutas replicadas).' },
      { id: 'dlrm-24', kind: 'concepto', q: 'Features de "query" vs de "impresión" (Covington).', a: 'Usuario y contexto: una vez por request. Ítem: una vez por candidato. El ranker reutiliza la parte del usuario para los k candidatos.' },
      { id: 'dlrm-25', kind: 'concepto', q: 'Logística ponderada para tiempo de visualización (YouTube 2016).', a: 'Positivos pesados por su tiempo visto, negativos con peso 1: los odds aprendidos ≈ E[T](1 + P) ≈ tiempo esperado; en serving, e^x.' },
      { id: 'dlrm-26', kind: 'trampa', q: '"Mejor AUC offline = mejor modelo online."', a: 'Skew, fuga, calibración, sesgo de selección del set offline, métrica distinta, latencia. Wide & Deep: +0.002 de AUC y +3.9 % online; también pasa al revés.' },
      { id: 'dlrm-27', kind: 'concepto', q: 'Por qué los rankers se entrenan una época.', a: 'Miles de millones de ejemplos y tablas que memorizan ids: con la segunda pasada la AUC de prueba cae de golpe ("one-epoch phenomenon", Zhang et al., CIKM 2022). Se repiten días (incremental), no épocas.' },
      { id: 'dlrm-28', kind: 'concepto', q: 'DIN (KDD 2018) en una línea.', a: 'Atención del candidato sobre el historial del usuario: cada ítem visto pesa según su relevancia para el ítem que se puntúa. Es una interacción usuario × ítem, por eso vive en el ranker y no en el two-tower; cuesta al menos k × L × d por request.' },
      { id: 'dlrm-29', kind: 'tradeoff', q: 'Historial promediado vs transformer causal (SASRec) en la torre de usuario.', a: 'Promedio: barato, sin orden ni recencia. SASRec: atención causal sobre los últimos L ítems, la salida final es u y sigue siendo indexable; más costo por request y cuidado con la fuga del futuro al armar la secuencia.' },
      { id: 'dlrm-30', kind: 'concepto', q: 'MMoE en una línea.', a: 'Varias tareas (click, like, tiempo) sobre expertos compartidos, con una compuerta softmax por tarea que mezcla los expertos: maneja tareas en conflicto mejor que una base única compartida (YouTube 2019 lo usa en su ranker).' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'embedding table', es: 'tabla de embeddings', def: 'Matriz de filas × d donde cada valor de una feature categórica tiene su vector; en recsys concentra casi todos los parámetros.', say: 'Our embedding tables are sharded row-wise across eight GPUs.' },
      { en: 'feature interaction', es: 'interacción de features', def: 'Términos que combinan dos o más features (productos punto entre embeddings, capas cross) para capturar efectos que no son aditivos.', say: 'DLRM models second-order feature interactions with pairwise dot products.' },
      { en: 'click-through rate (CTR)', es: 'tasa de clicks', def: 'Clicks / impresiones; el ranker predice su probabilidad por impresión (pCTR).', say: 'The model predicts the CTR of each candidate.' },
      { en: 'normalized entropy (NE)', es: 'entropía normalizada', def: 'Log loss dividida por la entropía del CTR de fondo; 1 = no mejor que el promedio.', say: 'The new features reduced normalized entropy by half a percent.' },
      { en: 'calibration', es: 'calibración', def: 'Que las probabilidades predichas coincidan con las frecuencias observadas: Σ p̂ / Σ y ≈ 1, también por segmento.', say: 'We monitor calibration per country.' },
      { en: 'negative downsampling', es: 'submuestreo de negativos', def: 'Entrenar con una fracción w de los negativos; obliga a re-calibrar las predicciones.', say: 'We downsample negatives to ten percent and recalibrate.' },
      { en: 'position bias', es: 'sesgo de posición', def: 'Los ítems de arriba reciben más clicks por su posición, no solo por su relevancia.', say: 'Position is a training-only feature to remove position bias.' },
      { en: 'training-serving skew', es: 'desfase entre entrenamiento y serving', def: 'Diferencias entre las features (o el preprocesamiento) que ve el modelo al entrenar y al servir.', say: 'We log served features to eliminate training-serving skew.' },
      { en: 'feature store', es: 'almacén de features', def: 'Sistema con una definición única de cada feature para entrenar (histórico, point-in-time) y servir (baja latencia).', say: 'The feature store gives us point-in-time correct training data.' },
      { en: 'delayed feedback', es: 'retroalimentación retrasada', def: 'Etiquetas (conversiones) que llegan mucho después de la impresión.', say: 'Conversions have delayed feedback of up to a week.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
