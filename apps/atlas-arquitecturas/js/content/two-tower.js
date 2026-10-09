/* =============================================================================
   Atlas de Arquitecturas — js/content/two-tower.js
   Página de modelo: two-tower para recomendación (candidate generation). Yi et al., RecSys 2019 (logQ, DOI
   10.1145/3298689.3346996); Covington et al., RecSys 2016 (YouTube DNN, DOI 10.1145/2959100.2959190); DSSM (Huang et
   al., CIKM 2013). Canónica two-tower-base (config de referencia documentada, sin checkpoint oficial).
   Plantilla fija de 11 secciones (SPEC §5.3, §25.1).
   Tesis de la fase (SPEC §25): la recomendación es un embudo. Two-tower = el bi-encoder de #retrieval con usuarios e
   ítems: los ítems se codifican offline y se indexan con ANN (#ann); casi todos los parámetros son tablas de embeddings.
   Regla: ningún número de la arquitectura se escribe a mano: parámetros, MACs y bytes salen del calculador
   (js/arch/recsys.js, cantidades {{config.ruta}}, SPEC §6.6). Resultados de papers con tabla citada; estimaciones con
   est(). El diseño de sistema completo es de la Ronda de Diseño ML: aquí, el modelo, sus costos y sus trampas.
   Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/recsys.js, SPEC §25.1).
  const C = 'two-tower-base';      // canónica: ids hasheados + historial + 4 categóricas por torre, MLP 256-128-dim
  const CS = 'two-tower-small';    // menos ids
  const CN = 'two-tower-no-ids';   // solo features: cold start

  // Claves de metrics() del calculador: un solo lugar para adaptarlas.
  const MK = {
    embP: 'embeddingParams', mlpP: 'mlpParams', embShare: 'embeddingParamsShare', embB: 'embeddingBytes', embB16: 'embeddingBytes16',
    uMacs: 'userTowerMacs', iMacs: 'itemTowerMacs', uP: 'userTowerParams', iP: 'itemTowerParams',
    inb: 'inBatchLogitsMacs', idx: 'indexBytes', brute: 'bruteForceMacs', corpus: 'itemCorpusMacs',
    look: 'lookupBytesPerExample', lookN: 'lookupsPerExample', serve: 'servingMacsPerRequest', step: 'trainStepMacs',
  };
  // Ids de tensores del calculador (contrato con two-tower-overview / inbatch-softmax y el trace).
  const T = {
    uid: 'user-id', uIdE: 'u-id-emb', hist: 'hist-ids', uHist: 'u-hist-emb', uCat: 'user-cat-ids', uCatE: 'u-cat-emb', uIn: 'u-in', uH1: 'u-h1', u: 'u',
    iid: 'item-id', vIdE: 'v-id-emb', iCat: 'item-cat-ids', vCatE: 'v-cat-emb', vIn: 'v-in', v: 'v', score: 'score',
    U: 'U', V: 'V', logits: 'logits', logq: 'item-logq', corr: 'logits-corrected', loss: 'loss',
    index: 'index', scores: 'item-scores', topk: 'topk-ids',
  };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const sh = (id, cfg) => qn('tensor.' + (T[id] || id) + '.shape', cfg);

  const YI = 'Yi et al., <i>Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations</i>, RecSys 2019, <a href="https://doi.org/10.1145/3298689.3346996" target="_blank" rel="noopener">doi:10.1145/3298689.3346996</a>';
  const YT = 'Covington, Adams y Sargin, <i>Deep Neural Networks for YouTube Recommendations</i>, RecSys 2016, <a href="https://doi.org/10.1145/2959100.2959190" target="_blank" rel="noopener">doi:10.1145/2959100.2959190</a>';
  const DSSM = 'Huang et al., <i>Learning Deep Structured Semantic Models for Web Search using Clickthrough Data</i> (DSSM), CIKM 2013';
  const MNS = 'Yang et al., <i>Mixed Negative Sampling for Learning Two-tower Neural Networks in Recommendations</i>, WWW 2020 (Companion)';
  const EBR = 'Huang et al., <i>Embedding-based Retrieval in Facebook Search</i>, KDD 2020, arXiv:2006.11632';
  const HASH = 'Weinberger et al., <i>Feature Hashing for Large Scale Multitask Learning</i>, ICML 2009, arXiv:0902.2206';
  const MONO = 'Liu et al., <i>Monolith: Real Time Recommendation System With Collisionless Embedding Table</i>, ORSUM@RecSys 2022, arXiv:2209.07663';
  const CHANEY = 'Chaney, Stewart y Engelhardt, <i>How Algorithmic Confounding in Recommendation Systems Increases Homogeneity and Decreases Utility</i>, RecSys 2018, arXiv:1710.11214';
  const DROPOUTNET = 'Volkovs, Yu y Poutanen, <i>DropoutNet: Addressing Cold Start in Recommender Systems</i>, NeurIPS 2017';
  const SASREC = 'Kang y McAuley, <i>Self-Attentive Sequential Recommendation</i> (SASRec), ICDM 2018, arXiv:1808.09781';
  const BERT4REC = 'Sun et al., <i>BERT4Rec: Sequential Recommendation with Bidirectional Encoder Representations from Transformer</i>, CIKM 2019, arXiv:1904.06690';
  const HSTU = 'Zhai et al., <i>Actions Speak Louder than Words: Trillion-Parameter Sequential Transducers for Generative Recommendations</i> (HSTU), ICML 2024, arXiv:2402.17152';
  const TIGER = 'Rajput et al., <i>Recommender Systems with Generative Retrieval</i> (TIGER), NeurIPS 2023, arXiv:2305.05065';
  const BENGIO = 'Bengio y Senécal, <i>Adaptive Importance Sampling to Accelerate Training of a Neural Probabilistic Language Model</i>, IEEE Trans. Neural Networks 19(4), 2008';
  const TFRS = 'TensorFlow Recommenders, <code>tfrs.tasks.Retrieval</code> (argumentos <code>candidate_sampling_probability</code> y <code>remove_accidental_hits</code>)';

  ATLAS.register({
    id: 'two-tower',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> dado un usuario (su id, su historial, su contexto), devolver en pocos milisegundos los ${cf('k')} ítems más prometedores de un catálogo de millones. Una <b>torre de usuario</b> convierte al usuario en un vector <i>u</i> de ${cf('dim')} números; una <b>torre de ítem</b> convierte cada ítem en un vector <i>v</i> del mismo tamaño; el score es el producto punto u·v. Como v no depende del usuario, todos los ítems se codifican <b>offline</b> y se guardan en un índice ANN; por request solo se paga la torre de usuario y una búsqueda de vecinos.` },
          { t: 'p', html: R`Es la primera etapa del embudo de recomendación (<b>candidate generation</b> o retrieval): millones de ítems → cientos de candidatos. Después, un modelo de <a href="#dlrm">ranking</a> mucho más caro ordena esos cientos con features que mezclan usuario e ítem, y una etapa final aplica reglas de negocio. La canónica del calculador (${C}) es una config de referencia documentada, no un checkpoint: id de usuario hasheado en ${cf('idBuckets')} filas, promedio de los últimos ${cf('hist')} ítems vistos, cuatro categóricas por torre y un MLP 256-128-${cf('dim')} con normalización L2 al final, como el modelo de YouTube de ${YI}.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Two-tower?', 'Por qué'], rows: [
            ['Feed, home o "para ti" con un catálogo de millones de ítems', 'Sí, como uno de los generadores de candidatos', 'Puntuar millones de ítems con el ranker no cabe en la latencia; el producto punto sobre un índice ANN sí.'],
            ['Ordenar los 500 candidatos que se van a mostrar', 'No: eso es ranking', R`La torre no puede usar features cruzadas usuario × ítem (veces que el usuario vio este canal, precio contra su presupuesto). El ranker (<a href="#dlrm">DLRM, DCN</a>) sí.`],
            ['Ítems nuevos cada minuto (videos, noticias, anuncios)', 'Sí, con features de contenido en la torre de ítem', 'Un ítem sin historial igual tiene vector si la torre usa su texto, categoría o embedding de imagen; con solo el id, no.'],
            ['Catálogo chico (miles de ítems) y pocos usuarios', 'Opcional', 'Puntuar todo con un modelo mejor (o un GBDT) puede caber; empieza por popularidad y co-ocurrencia ("los que vieron X vieron Y").'],
            ['"Ítems parecidos a este" (item-to-item)', 'Sí, con la misma torre de ítem', 'Vecinos de v en el mismo índice; no hace falta usuario.'],
            ['Búsqueda con texto', R`Es el mismo patrón: <a href="#retrieval">retrieval denso</a>`, 'Consulta en lugar de usuario; aquí la "consulta" es implícita (el historial).'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"A two-tower model encodes the user and the item separately into vectors in the same space and scores them with a dot product. Because the item vector does not depend on the user, I precompute embeddings for the whole catalog and serve them from an approximate nearest neighbor index, so each request costs one user-tower pass plus a vector lookup. It is the candidate generation stage: it narrows millions of items to a few hundred, and a heavier ranking model with user-item cross features orders those."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Es el bi-encoder de <a href="#retrieval">retrieval</a> con usuarios e ítems en lugar de consultas y documentos.</b> Lo que ya sabes de DPR y de <a href="#clip">CLIP</a> aplica casi entero: dos encoders, un producto punto, una matriz B×B con los positivos en la diagonal, los ítems precalculados en un índice <a href="#ann">ANN</a>. Y el embudo es el del detector de dos etapas: una red barata propone cientos de candidatos y una cabeza cara decide sobre ellos. Lo genuinamente nuevo son tres cosas: las entradas son <b>ids categóricos</b> de vocabularios enormes (no texto ni píxeles), los negativos in-batch están <b>sesgados por la popularidad</b> (y se corrigen con logQ), y el entrenamiento es un <b>stream</b> que no termina.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de recomendación', head: ['Concepto', 'Donde ya lo viste', 'En two-tower', '¿Nuevo?'], rows: [
            ['Dos torres, un espacio común', 'DPR: consulta y pasaje; CLIP: imagen y texto', 'Usuario (id, historial, contexto) e ítem (id, metadatos, contenido)', 'Igual'],
            ['Pérdida', 'InfoNCE con in-batch negatives', R`Softmax in-batch <b>con corrección logQ</b>: los ítems populares aparecen más como negativos y hay que descontarlo`, 'logQ: <b>nuevo</b>'],
            ['Entrada de la torre', 'Tokens de texto o patches', R`Ids de usuario e ítem → filas de <b>tablas de embeddings</b> de millones de filas (hasheadas)`, '<b>Nuevo</b>'],
            ['Precalcular un lado', 'El corpus de documentos en un índice', 'El catálogo de ítems, re-indexado cada pocas horas', 'Igual'],
            ['Embudo barato → caro', 'Bi-encoder → cross-encoder', R`Two-tower → ranker (<a href="#dlrm">DLRM</a>) → re-ranking`, 'Equivale'],
            ['Interacción entre los dos lados', 'Cross-encoder: atención entre los dos textos', 'Ninguna antes del producto punto; las features cruzadas usuario × ítem van al ranker', 'Igual (y es la restricción clave)'],
            ['Métrica offline', 'Recall@k, nDCG', 'Recall@k del próximo ítem consumido, con split <b>temporal</b>', 'Parecida'],
          ] },
          { t: 'h3', text: 'De dónde viene: factorización de matrices, DSSM y YouTube' },
          { t: 'p', html: R`<b>Factorización de matrices (MF)</b> ya era un two-tower sin MLP: la matriz de interacciones R (usuarios × ítems) se aproxima por U·Vᵀ, y cada fila de U y de V es un embedding (el paper de DLRM lo presenta así, Ec. 3). El two-tower agrega dos cosas: <b>features</b> además del id (lo que permite cold start) y <b>MLPs</b> que las combinan de forma no lineal. ${DSSM} fue el primer two-tower con redes profundas, en búsqueda web: cada texto pasa por <b>word hashing</b> en letter-trigramas (un vocabulario de 500K palabras queda en 30,621 dimensiones), dos capas de 300 y una salida de 128, coseno, y una softmax sobre el documento clickeado y 4 no clickeados al azar.` },
          { t: 'p', html: R`${YT} lo llevó a recomendación a escala: la generación de candidatos como <b>clasificación extrema</b> ("¿cuál de los millones de videos mira ahora?") con softmax muestreada (varios miles de negativos con importance weighting, "más de 100 veces" más rápido que la softmax completa), el historial como <b>promedio</b> de los embeddings de los últimos 50 videos vistos y de 50 búsquedas (1M videos y 1M tokens, 256 floats cada uno), y en serving un vecino más cercano en el espacio del producto punto. En ese modelo la "torre de ítem" es solo la tabla de la softmax; ${YI} la reemplaza por una red sobre features del ítem, y ahí aparece el problema que resuelve logQ.` },
          { t: 'callout', kind: 'connect', html: R`<p>El índice que hace sublineal la búsqueda (HNSW, IVF-PQ, ScaNN) está en <a href="#ann">búsqueda ANN</a>; la InfoNCE y los hard negatives, en <a href="#retrieval.operaciones">retrieval</a>. La etapa siguiente del embudo, el ranker con tablas enormes e interacciones explícitas, en <a href="#dlrm">DLRM</a>. Y el baseline tabular que siempre conviene probar, en <a href="#gbdt">GBDT</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Dos carriles, como en retrieval. Arriba, <b>offline</b>: cada ítem del catálogo pasa una vez por la torre de ítem y su vector va al índice (${sh('index')}). Abajo, <b>online</b>, por cada request: la torre de usuario da u, la búsqueda devuelve los ${cf('k')} ítems de mayor u·v y esos candidatos siguen al ranker. "Recorrido" sigue a un usuario con números.` },
          { t: 'archdiagram', diagram: 'two-tower-overview', walk: 'forward', wide: true, caption: R`Two-tower de referencia (${C}): tablas de ids compartidas, historial promediado, MLP 256-128-${cf('dim')} con L2 por torre. Formas del calculador, sin batch.` },
          { t: 'p', html: R`<b>El entrenamiento</b>, aparte: B pares (usuario, ítem clickeado) del stream; las dos torres dan U y V de ${sh('U')}, la matriz de logits ${sh('logits')} tiene los positivos en la diagonal, y a cada <b>columna</b> se le resta log Q(ítem) antes de la softmax.` },
          { t: 'archdiagram', diagram: 'inbatch-softmax', caption: 'Softmax in-batch con corrección logQ: la columna de un ítem popular baja log Q, así deja de recibir el empujón hacia abajo de todas las filas en que aparece como negativo.' },
          { t: 'p', html: R`<b>Juega con el sesgo.</b> Activa y desactiva la corrección y mira la columna del ítem popular: sin logQ, cada fila lo empuja hacia abajo, porque está en casi todos los batches.` },
          { t: 'viz', kind: 'inbatch-softmax', params: { config: C, B: 6, view: 'softmax', correct: true }, caption: 'Sintético: una matriz B×B de un batch con un ítem muy popular. La corrección resta log Q(j) a la columna j; los scores de serving (u·v) no la llevan.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación. Una usuaria abre la app a las 21 h en un Android, desde México, en español. Su torre lee su id (una fila de la tabla de usuarios), los últimos ${cf('hist')} videos que vio (${cf('hist')} filas de la tabla de ítems, promediadas en un solo vector) y cuatro categóricas (país, idioma, dispositivo, hora; 16 números cada una). Concatena todo en ${sh('uIn')}, lo pasa por un MLP y lo normaliza: ${sh('u')}. Cada video del catálogo ya tiene su ${sh('v')} guardado. El score de cada video es u·v; los ${cf('k')} más altos salen hacia el ranker. Nada de esto ve "esta usuaria × este video": la torre de usuario no sabe qué video se está puntuando. El camino completo, con formas, en <a href="#two-tower.diagrama~two-tower-overview.retrieve">el diagrama</a>.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            [R`d<sub>id</sub>`, 'ancho de los embeddings de id (usuario e ítem)', cf('idDim')],
            [R`n<sub>hist</sub>`, 'ítems del historial que se promedian', cf('hist')],
            [R`d<sub>c</sub>`, 'ancho de cada embedding categórico', '16'],
            ['dim', 'dimensión de u y v (y del índice)', cf('dim')],
            [R`N<sub>items</sub>`, 'ítems en el catálogo = filas de la tabla de ítems = vectores del índice', cf('nItems')],
            ['buckets', 'filas de la tabla hasheada de usuarios', cf('idBuckets')],
            ['B', 'pares por batch de entrenamiento (B−1 negativos in-batch)', cf('B')],
            ['k', 'candidatos que salen hacia el ranker', cf('k')],
            ['τ', 'temperatura de la softmax (con u y v normalizados)', R`0.05 en los mejores resultados de ${YI.split(',')[0]}`],
            ['Q(j)', 'probabilidad de que el ítem j aparezca en un batch', 'estimada en streaming'],
          ] },

          { t: 'h3', text: 'Torre de usuario: ids, historial y categóricas' },
          { t: 'op', block: 'user-emb', model: 'two-tower', title: 'Embeddings del usuario: id hasheado, historial promediado, categóricas',
            tex: R`\mathbf{e}_{id} = E_{user}[\,h(\text{user\_id}) \bmod \text{buckets}\,],\qquad \mathbf{e}_{hist} = \frac{1}{n_{hist}}\sum_{t=1}^{n_{hist}} E_{item}[\,\text{item}_t\,],\qquad \mathbf{x}_u = [\mathbf{e}_{id};\ \mathbf{e}_{hist};\ \mathbf{e}_{país};\ \mathbf{e}_{idioma};\ \mathbf{e}_{disp.};\ \mathbf{e}_{hora}]`,
            in: [T.uid, T.hist, T.uCat], out: [T.uIn], params: true,
            what: R`Un lookup en la tabla de usuarios (${sh('uIdE')}), ${cf('hist')} lookups en la tabla de ítems promediados en ${sh('uHist')} y cuatro lookups categóricos concatenados (${sh('uCatE')}): ${sh('uIn')}. Cero MACs de matmul: solo leer filas de memoria (${met('lookN')} lookups, ${met('look')} leídos por ejemplo en fp32).`,
            why: R`<b>Hashing</b>: hay más usuarios que filas; h(id) mod buckets asigna una fila a cada usuario, y los usuarios que caen en la misma fila comparten vector (colisiones). Es el hashing trick (${HASH}): memoria fija, sin vocabulario que mantener, y los usuarios nuevos tienen fila desde el primer request. ${YI.split(',')[0]} lo usa para ids fuera del vocabulario: "hash buckets" aprendidos. <b>Historial como bolsa</b>: el promedio pierde el orden pero da un vector de tamaño fijo para cualquier largo; Covington y Yi lo hacen así. <b>Tabla compartida</b>: el mismo embedding de video sirve para el historial, para la semilla y para el candidato (Yi §5.1: no compartir no mejoró), así que el historial "habla el idioma" de la torre de ítem.` },
          { t: 'callout', kind: 'trap', title: '"Con 10M buckets cada usuario tiene su vector"', html: R`<p>Solo si hay menos de 10M usuarios, y ni así: el hash reparte al azar, así que algunas filas reciben varios usuarios y otras ninguno. Con 100M usuarios activos en ${cf('idBuckets')} filas, cada fila promedia ${est('≈ 10')} usuarios: el "embedding del usuario" es en realidad el de un grupo aleatorio, y el modelo depende del historial y de las features para distinguirlos. Opciones: más filas (más memoria: cada fila son d<sub>id</sub> × 4 bytes en fp32), dos hashes con dos tablas sumadas (la idea del QR trick, en <a href="#dlrm.costo">DLRM</a>), o una tabla sin colisiones con expiración de ids inactivos (Monolith: ${MONO}).</p>` },
          { t: 'op', block: 'user-mlp', model: 'two-tower', title: 'MLP de la torre de usuario y normalización L2',
            tex: R`\mathbf{u} = \frac{\mathbf{h}}{\|\mathbf{h}\|_2},\qquad \mathbf{h} = W_3\,\mathrm{ReLU}\big(W_2\,\mathrm{ReLU}(W_1\mathbf{x}_u + \mathbf{b}_1) + \mathbf{b}_2\big) + \mathbf{b}_3`,
            in: [T.uIn], out: [T.u], params: true, flops: true,
            what: R`${sh('uIn')} → ${sh('uH1')} → … → ${sh('u')}: ${met('uMacs')} por usuario, ${met('uP')} parámetros contando las tablas que lee esta torre. El MLP es diminuto al lado de sus tablas.`,
            why: R`El MLP combina features de forma no lineal (lo que la MF no puede) y lleva todo a la dimensión del índice. La normalización L2 hace que u·v sea un coseno: Yi reporta que normalizar "mejora la entrenabilidad" y da mejor retrieval, siempre con una temperatura τ (u·v/τ) que hay que ajustar. Sin normalizar, la norma de v funciona como un sesgo de popularidad escondido en el índice (la misma trampa de <a href="#retrieval.operaciones">retrieval</a>).` },

          { t: 'h3', text: 'Torre de ítem (offline) y el score' },
          { t: 'op', block: 'item-mlp', model: 'two-tower', title: 'Torre de ítem: id (tabla compartida) + features de contenido',
            tex: R`\mathbf{v} = \mathrm{L2}\Big(\mathrm{MLP}\big([\,E_{item}[\text{item\_id}];\ \mathbf{e}_{categoría};\ \mathbf{e}_{idioma};\ \mathbf{e}_{duración};\ \mathbf{e}_{antigüedad}\,]\big)\Big)`,
            in: [T.vIn], out: [T.v], params: true, flops: true,
            what: R`${sh('vIn')} → ${sh('v')}: ${met('iMacs')} por ítem; para todo el catálogo (${cf('nItems')} ítems), ${met('corpus')} offline, una vez por re-indexado. Esta torre es la dueña de la tabla de ítems: sus parámetros se cuentan aquí, no en el historial.`,
            why: R`Las features de contenido son el seguro contra el cold start: un video subido hace un minuto no tiene id entrenado, pero sí categoría, idioma, duración y (en sistemas reales) embeddings de su título, miniatura o audio de un encoder preentrenado (<a href="#clip">CLIP</a>, un text encoder). Con solo el id, un ítem nuevo es una fila aleatoria y nunca sale en el top-k: nunca se muestra, nunca recibe clicks, nunca aprende.` },
          { t: 'op', block: 'retrieve', model: 'two-tower', title: 'Score: producto punto (en serving, sin corrección)',
            tex: R`s(u, j) = \mathbf{u}^\top\mathbf{v}_j \quad\text{(coseno: } \|\mathbf{u}\| = \|\mathbf{v}_j\| = 1\text{)}`,
            in: [T.u, T.index], out: [T.scores], flops: true,
            what: R`${cf('dim')} MACs por par. Sobre todo el índice ${sh('index')}: ${met('brute')} por request en fuerza bruta (${sh('scores')} → ${sh('topk')}); con ANN, una fracción (<a href="#ann">ANN</a>).`,
            why: R`Que el score se <b>factorice</b> en f(usuario)·g(ítem) es lo que permite el índice: maximizar uᵀv sobre millones de v fijos es maximum inner product search. Cualquier término que dependa de los dos a la vez (un MLP sobre [u; v], una feature "veces que este usuario vio este canal") rompe la factorización y obliga a puntuar cada ítem con la red: eso es un ranker, no un retriever.` },
          { t: 'callout', kind: 'trap', title: '"Agrego la feature cruzada usuario × ítem a la torre de usuario"', html: R`<p>No se puede: la torre de usuario se ejecuta <b>una vez</b> por request, antes de saber qué ítems va a comparar, y la de ítem una vez por ítem, sin saber quién pregunta. "Cuántas veces vio este usuario a este creador", "distancia entre el usuario y la tienda" o "el precio relativo a su gasto típico" dependen del par, así que no caben en ninguna torre. Esas features son justamente la ventaja del ranker (<a href="#dlrm">DLRM</a>, <a href="#gbdt">GBDT</a>), que solo ve cientos de candidatos. Lo que sí puede hacer la torre de usuario: incluir el <b>historial</b> (que crea interacción implícita con los ítems parecidos a los vistos) y features agregadas del usuario (afinidad por categoría), que la torre de ítem iguala con la categoría del ítem en el producto punto.</p>` },

          { t: 'h3', text: 'Entrenamiento: softmax in-batch y la corrección logQ' },
          { t: 'p', html: R`Primero sin notación. Un batch trae B clicks: (usuaria 1, video de cocina), (usuario 2, el video viral del día), (usuaria 3, un tutorial de nicho)… Para la fila 1, el positivo es el de cocina y los negativos son los otros B−1 videos del batch. El problema: el video viral está en el batch porque es popular, no porque sea irrelevante para la usuaria 1. Aparece en casi todos los batches, así que como negativo recibe un empujón hacia abajo en casi todas las filas. El modelo aprende "lo popular es malo", al revés de lo que querías. Míralo en <a href="#two-tower.diagrama~inbatch-softmax.ib-logq">la vista de la softmax in-batch</a>. La corrección logQ le resta a cada logit el log de qué tan probable era que ese ítem estuviera en el batch: si estaba "de oficio", su aparición como negativo cuenta poco.` },
          { t: 'op', block: 'ib-logq', diagram: 'inbatch-softmax', model: 'two-tower', title: 'Logits B×B, corrección logQ y pérdida',
            tex: R`s^c(x_i, y_j) = \frac{\mathbf{u}_i^\top\mathbf{v}_j}{\tau} - \log p_j,\qquad \mathcal{L}_B = -\frac{1}{B}\sum_{i=1}^{B} r_i\,\log\frac{e^{s^c(x_i, y_i)}}{e^{s^c(x_i, y_i)} + \sum_{j\neq i} e^{s^c(x_i, y_j)}}`,
            in: [T.logits, T.logq], out: [T.corr],
            what: R`${sh('U')} · ${sh('V')}ᵀ → ${sh('logits')} (${met('inb')} con B = ${cf('B')}), menos log Q por columna → ${sh('corr')}, entropía cruzada con la diagonal como etiqueta. r<sub>i</sub> es el peso del ejemplo (Yi: 0 para un click casi sin tiempo de visualización, 1 si vio el video completo).`,
            why: R`Es la corrección de importance sampling de la softmax muestreada (${BENGIO}), aplicada a negativos que no se eligen sino que "llegan" con el stream. Yi la aplica a <b>todos</b> los logits, el del positivo incluido (Ec. 4). Sin ella, el modelo aprende p(ítem | usuario) / Q(ítem): si Q es la popularidad (in-batch), borra justamente la señal de popularidad. Se usa <b>solo para entrenar</b>: en serving el score es u·v, sin restar nada.` },
          { t: 'math', display: true, tex: R`\text{Algoritmo 2 de Yi: al ver el ítem } y \text{ en el paso } t:\quad B[h(y)] \leftarrow (1-\alpha)\,B[h(y)] + \alpha\,\big(t - A[h(y)]\big),\quad A[h(y)] \leftarrow t;\qquad \hat p(y) = 1/B[h(y)]`, caption: R`Estimación de Q en streaming (${YI.split(',')[0]}, §4): A guarda el último paso en que se vio el bucket del ítem y B, el promedio móvil de los pasos entre dos apariciones (δ). Si un ítem aparece cada 50 pasos, p = 0.02. Sin vocabulario fijo (arreglos hasheados de tamaño H) y adaptable a cambios de distribución; con varios hashes se toma el máximo de las estimaciones de δ para mitigar colisiones (Alg. 3, como un count-min sketch). En YouTube: H = 50M, α = 0.01.` },
          { t: 'callout', kind: 'trap', title: '"Corrijo con logQ también al servir"', html: R`<p>No. logQ arregla un <b>estimador de entrenamiento</b>: la softmax sobre B ítems sesgados por popularidad no es la softmax sobre todo el catálogo. En serving puntúas contra el catálogo entero (o su aproximación ANN) con s = u·v. Si quieres <b>menos</b> popularidad en lo que se muestra (diversidad, exploración), eso es una decisión de producto que se toma en el re-ranking, con una penalización explícita y medida, no restando log Q en el índice.</p>` },
          { t: 'callout', kind: 'note', title: 'Accidental hits', html: R`<p>Si dos usuarios del batch clickearon el mismo video viral, ese video aparece en dos columnas: para la fila 1 su propia columna es el positivo y la otra copia es un "negativo" idéntico. Se enmascara (−∞) cuando el id coincide y no es la diagonal; ${TFRS} lo hace con un flag. Ojo: al enmascarar cambia cuántas veces "cuenta" el ítem como negativo, así que la estimación de Q y la máscara se diseñan juntas.</p>` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de la canónica: una usuaria, un ítem, el índice y, al final, el batch de entrenamiento. Toca una fila para resaltarla en el diagrama.` },
          { t: 'trace', model: 'two-tower' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La canónica tiene ${qn('params.total')} parámetros: ${met('embP')} en las tablas de embeddings y ${met('mlpP')} en los MLPs, que son apenas ${met('mlpParamsShare')} del total. Las tablas ocupan ${met('embB')} en fp32 (${met('embB16')} en fp16). Por eso en recomendación "el tamaño del modelo" se mide en filas × ancho, no en capas: el MLP de cada torre cabe en la cache de una CPU.` },
          { t: 'params', model: 'two-tower', group: 'block' },
          { t: 'flops', model: 'two-tower' },
          { t: 'calc', title: R`Dónde se paga cada cosa (calculador, ${C})`, rows: [
            { label: 'Offline: codificar el catálogo', expr: R`N<sub>items</sub> = ${cf('nItems')} × ${met('iMacs')} por ítem`, value: met('corpus'), note: 'una vez por re-indexado (cada pocas horas en el sistema de Yi)' },
            { label: 'Online: torre de usuario', expr: R`lookups (${met('lookN')}) + MLP`, value: met('uMacs'), note: R`limitada por leer ${met('look')} de tablas, no por los MACs` },
            { label: 'Online: fuerza bruta sobre el índice', expr: R`N<sub>items</sub> × dim`, value: met('brute'), note: R`hay que leer ${met('idx')} de vectores por request: por eso ANN` },
            { label: 'Online: total del modelo por request (fuerza bruta)', expr: 'torre de usuario + escaneo', value: met('serve') },
            { label: R`Entrenamiento: logits in-batch con B = ${cf('B')}`, expr: 'B² × dim', value: met('inb'), note: R`${met('inBatchLogitsShare')} del forward del paso (torres + logits); ${met('step')} por paso con forward y backward (≈ 3×)` },
          ], result: R`El único cómputo que crece con el catálogo en línea es el escaneo, y ANN lo vuelve sublineal. Todo lo demás es diminuto. El costo real de un two-tower está en <b>memoria</b> (tablas e índice) y en <b>lecturas aleatorias</b> de filas, no en FLOPs.` },
          { t: 'h3', text: 'Las perillas' },
          { t: 'scaling', model: 'two-tower', knobs: [{ key: 'nItems', values: [100000, 2000000, 10000000, 100000000] }, { key: 'dim', values: [32, 64, 128, 256] }], show: ['indexBytes', 'bruteForceMacs', 'embeddingParams', 'itemCorpusMacs'] },
          { t: 'scaling', model: 'two-tower', knobs: [{ key: 'idBuckets', values: [1000000, 10000000, 100000000] }, { key: 'idDim', values: [16, 32, 64, 128] }, { key: 'hist', values: [0, 10, 50, 200] }], show: ['embeddingParams', 'embeddingBytes', 'lookupBytesPerExample', 'userTowerMacs'] },
          { t: 'scaling', model: 'two-tower', knobs: [{ key: 'B', values: [256, 1024, 4096, 8192, 16384] }], show: ['inBatchLogitsMacs', 'trainStepMacs', 'inBatchLogitsShare'] },
          { t: 'calc', title: 'A mano: tablas e índice de un catálogo de 50M videos', rows: [
            { label: 'Tabla de ítems, 50M × 64, fp32', expr: '5·10⁷ × 64 × 4 bytes', value: est('≈ 12.8 GB') },
            { label: 'Tabla de usuarios hasheada, 10⁸ filas × 64, fp32', expr: '10⁸ × 64 × 4', value: est('≈ 25.6 GB') },
            { label: 'Estado del optimizador (Adagrad: un acumulador por peso)', expr: '× 2 en total', value: est('≈ 77 GB') },
            { label: 'Índice de 50M vectores de 64 en fp16', expr: '5·10⁷ × 64 × 2', value: est('≈ 6.4 GB') },
            { label: 'El mismo índice con PQ de 16 bytes por vector', expr: '5·10⁷ × 16', value: est('≈ 0.8 GB') },
          ], result: R`Las tablas de entrenamiento no caben en una GPU de 80 GB: se reparten entre máquinas (servidores de parámetros o tablas en modelo-paralelo, como en <a href="#dlrm.inferencia">DLRM</a>). El índice de serving sí cabe en la RAM de una sola máquina y se replica para dar QPS.` },
          { t: 'callout', kind: 'senior', html: R`<p>La frase de Covington que un entrevistador quiere oír: "la abrumadora mayoría de los parámetros están en los espacios de embeddings de alta cardinalidad: un millón de ids en 32 dimensiones tiene 7 veces más parámetros que capas densas de 2048" (§4.1; 32M contra 2048² ≈ 4.2M). En la canónica, los MLPs de las dos torres son ${met('mlpParamsShare')} de los parámetros. Consecuencias: (1) el cuello de botella es memoria y ancho de banda, no FLOPs; (2) la regularización y el learning rate de las tablas importan más que la profundidad del MLP; (3) agregar una feature categórica de alta cardinalidad cuesta más memoria que duplicar el MLP.</p>` },
          { t: 'compare', models: [C, CS, CN], rows: ['params', 'embeddingParams', 'mlpParams', 'embeddingParamsShare', 'embeddingBytes', 'userTowerMacs', 'itemTowerMacs', 'indexBytes'], caption: R`Las tres configs: la canónica, una con menos ids y una sin ids (solo features: lo que se puede usar en cold start). Sin ids, el modelo casi no tiene parámetros y generaliza a ítems nuevos, pero no memoriza los gustos de cada usuario ni los ítems "raros" que funcionan.` },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 N<sub>items</sub> → ×2 tabla de ítems, ×2 índice, ×2 fuerza bruta y ×2 costo de re-indexar; la torre de usuario, igual. ×2 dim → ×2 índice y fuerza bruta, casi igual el MLP. ×2 buckets o ×2 d<sub>id</sub> → ×2 tablas. ×2 historial → ×2 lookups por ejemplo, mismos parámetros (la tabla es compartida). ×2 B → ×4 la matriz de logits y el doble de negativos por fila.` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los explorers. Lo que no te puedes saltar: tablas ≫ MLPs, dónde se paga cada cosa (offline por ítem, online por request, B² en entrenamiento) y N<sub>items</sub> × dim × bytes del índice.</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La pérdida es la softmax in-batch corregida de <a href="#two-tower.operaciones">operaciones</a>. Lo que decide la calidad: <b>qué es un positivo</b>, <b>de dónde salen los negativos</b>, cómo se separa la evaluación en el tiempo y qué features se le esconden al modelo para que no haga trampa.` },
          { t: 'math', display: true, tex: R`\mathcal{L} = -\frac{1}{B}\sum_{i=1}^{B} r_i \log\frac{\exp\!\big(\mathbf{u}_i^\top\mathbf{v}_i/\tau - \log p_i\big)}{\sum_{j=1}^{B}\exp\!\big(\mathbf{u}_i^\top\mathbf{v}_j/\tau - \log p_j\big)}`, caption: R`${YI}, Ec. 4 con la normalización y la temperatura de §3. Positivos: clicks, pesados por r (engagement). Al inicio, con todo al azar, la pérdida vale ≈ ln B, como en retrieval.` },
          { t: 'h3', text: 'Lo que midió Yi et al.' },
          { t: 'table', caption: 'Corrección logQ contra softmax in-batch simple', head: ['Experimento', 'Sin corrección (mejor τ)', 'Con logQ (mejor τ)', 'Fuente'], rows: [
            ['Wikipedia, 5.3M páginas: Recall@10 / @100', '0.0643 / 0.3746 (τ = 0.07)', '0.1065 / 0.4835 (τ = 0.07 / 0.05)', 'Tabla 1; torres de [512, 128], batch 1024, Adagrad'],
            ['YouTube, índice de 10M videos: Recall@10 / @50', '0.2728 / 0.4586 (τ = 0.05)', '0.2960 / 0.5322 (τ = 0.05)', 'Tabla 2; torres de [1024, 512, 128], batch 8192, Adagrad con LR 0.2'],
            ['YouTube en vivo (A/B), agregando el nominador al sistema de producción', '+0.20 % en la métrica de engagement', '+0.37 %', 'Tabla 3'],
          ], note: R`Detalles de §6.3: el entrenamiento es secuencial por días (se pone al día con 15 días y después espera el día nuevo), el índice de ≈ 10M videos se reconstruye "cada pocas horas" y cubre más del 90 % de los ejemplos de entrenamiento. La temperatura importa casi tanto como la corrección: en Wikipedia, τ = 0.14 empeora las dos variantes.` },
          { t: 'h3', text: 'Negativos: in-batch, mezclados y difíciles' },
          { t: 'list', ordered: true, items: [
            R`<b>In-batch</b> (gratis, sesgados por popularidad): los positivos de las otras filas. Solo contienen ítems que alguien clickeó en el periodo de entrenamiento: los ítems de la cola larga y los recién llegados casi nunca son negativos, y el modelo nunca aprende a ponerlos abajo. Con logQ se corrige el sesgo de frecuencia, no la ausencia.`,
            R`<b>Mezclados</b> (${MNS}): a los B in-batch se suman B' ítems muestreados <b>uniformemente</b> del catálogo indexado, que también pasan por la torre de ítem. Cubre la cola larga y los ítems frescos, el "selection bias" del in-batch. Costo: B' forwards extra de la torre de ítem por paso.`,
            R`<b>Impresiones no clickeadas</b>: tentador ("se le mostró y no clickeó") pero para <b>retrieval</b> es una mala idea. ${EBR}: entrenar con impresiones no clickeadas como negativos dio una regresión absoluta de 55 % en recall contra negativos al azar en el modelo de personas (§2.4): son todos casos difíciles, y la tarea real de retrieval es separar lo relevante de una enorme mayoría de ítems fáciles. Las impresiones no clickeadas son la materia prima del <b>ranker</b>.`,
            R`<b>Hard negatives minados</b>: los más cercanos al positivo en el espacio actual. En EBR, el minado online dentro del batch (para cada consulta, los positivos de otras filas con mayor similitud) dio +8.38 % de recall en búsqueda de personas, y más de dos hard negatives por positivo empezó a empeorar (§6.1). Mezcla, no reemplazo: la mayoría de los negativos deben seguir siendo fáciles.`,
          ] },
          { t: 'callout', kind: 'trap', title: '"Para el two-tower uso como negativos lo que se mostró y no se clickeó"', html: R`<p>Es la intuición del ranker aplicada a la etapa equivocada. El retriever tiene que separar a los cientos buenos de los millones irrelevantes; las impresiones ya pasaron por el embudo, son todas "parecidas a buenas", y entrenar solo con ellas distorsiona el espacio (EBR: −55 % de recall absoluto). Negativos al azar o in-batch con logQ para la mayoría, unos pocos hard negatives, y las impresiones para el modelo de ranking.</p>` },
          { t: 'h3', text: 'Positivos, contexto y la fuga de información' },
          { t: 'p', html: R`${YT} deja tres lecciones que se repiten en entrevistas. (1) <b>Entrenar con todo el consumo</b> (también lo descubierto fuera de las recomendaciones), no solo con clicks en lo recomendado: si no, el sistema solo aprende de sí mismo y lo nuevo nunca sale. (2) <b>Un número fijo de ejemplos por usuario</b>, para que los usuarios muy activos no dominen la pérdida. (3) <b>Predecir el próximo consumo</b>, no uno sacado al azar del historial: ocultar un video del medio y dárselo al modelo con el resto del historial (incluido lo que vio <b>después</b>) filtra el futuro e ignora la asimetría (los episodios de una serie se ven en orden). Covington "hace rollback" del historial: solo entra lo anterior a la etiqueta.` },
          { t: 'callout', kind: 'trap', title: 'Feature leakage: el modelo que "adivina" mirando el sitio', html: R`<p>El ejemplo de Covington (§3.4): si el modelo ve la última búsqueda ("taylor swift") y la etiqueta es el siguiente video visto, aprende a reproducir la página de resultados de esa búsqueda, y en la home recomienda eso: funciona offline y fracasa en vivo. La solución fue darle las búsquedas como bolsa de tokens sin orden. Otras fugas típicas: features calculadas con datos posteriores al momento del ejemplo (el CTR del ítem calculado con todo el día, incluida esta impresión), features que solo existen para ítems que ya se mostraron, o un split aleatorio entre días en lugar de uno temporal. Regla: cada feature se calcula "as of" el instante del ejemplo, con el mismo código que en serving.</p>` },
          { t: 'p', html: R`<b>"Example age"</b> (Covington §3.3): el modelo aprende la popularidad promedio de la ventana de entrenamiento, que va atrasada para un catálogo que cambia cada hora. Se le da la edad del ejemplo como feature en el entrenamiento y en serving se pone en cero (o algo negativo): el modelo aprende la dependencia temporal y predice "al final de la ventana". Así puede subir un video recién publicado que está despegando.` },
          { t: 'h3', text: 'Cómo se evalúa' },
          { t: 'list', items: [
            R`<b>Offline</b>: recall@k del ítem consumido contra el catálogo completo (lo que mide Yi), con <b>split temporal</b>: entrenas hasta el día d y evalúas el día d+1 (Yi promedia 7 días por el patrón semanal). Recall@k porque el retriever solo tiene que meter el ítem en los candidatos: el orden lo decide el ranker.`,
            R`<b>Por segmento</b>: usuarios nuevos y viejos, ítems frescos y de la cola larga, por país e idioma. Un promedio alto puede esconder que el modelo solo devuelve lo popular.`,
            R`<b>Cobertura y diversidad</b>: qué fracción del catálogo aparece en algún top-k, concentración (Gini) de las apariciones. Un retriever que solo devuelve el top 1 % del catálogo puede tener buen recall y matar el ecosistema.`,
            R`<b>Del sistema</b>: el retriever es uno de varios "nominadores"; lo que importa es si sus candidatos <b>sobreviven al ranker</b> (fracción en el top final) y lo que aporta en un <b>A/B</b> de todo el embudo. Covington: la elección del problema sustituto tiene "una importancia desmedida en los A/B pero es muy difícil de medir offline".`,
          ] },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los números de las tablas de Yi y el Algoritmo 2 línea por línea. Lo que no te puedes saltar: por qué el in-batch sesga contra lo popular, que logQ resta log Q por columna solo al entrenar, por qué las impresiones no clickeadas no son buenos negativos para retrieval, y el split temporal.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Offline: construir el índice', html: R`<p>Yi §5.3, en tres etapas: elegir el conjunto de ítems a indexar (≈ 10M de un corpus mayor, con criterios de calidad), correr la torre de ítem sobre todos (${met('corpus')} con la canónica) y entrenar el índice ANN (cuantización y árboles para MIPS). El modelo de serving "cose" la torre de usuario con el índice. Se repite cada pocas horas.</p>` },
            { title: 'Online: features del usuario', html: R`<p>Leer del feature store el historial reciente, agregados y contexto (hora, dispositivo). Es la parte con más latencia de cola: lecturas de red, no cómputo. El historial de los últimos minutos (lo que acaba de ver) es la señal más fuerte: si el pipeline de features tiene horas de retraso, el modelo recomienda lo que ya viste.</p>` },
            { title: 'Online: torre de usuario', html: R`<p>${met('uMacs')}: microsegundos en CPU. Se puede cachear u por sesión unos minutos.</p>` },
            { title: 'Online: búsqueda de vecinos', html: R`<p>Top-${cf('k')} por producto punto en el índice ANN (<a href="#ann">HNSW, IVF-PQ, ScaNN</a>), con filtros (país, edad, ya visto, bloqueados). En fuerza bruta serían ${met('brute')} y leer ${met('idx')}.</p>` },
            { title: 'Online: unir con los otros generadores', html: R`<p>El two-tower es un nominador entre varios (Yi: "múltiples nominadores, cada uno genera cientos"): co-visitación, suscripciones, tendencias, frescos. Se deduplican y pasan al ranker (<a href="#dlrm.para-que">DLRM y el embudo</a>).</p>` },
          ] },
          { t: 'h3', text: 'Frescura: tres relojes distintos' },
          { t: 'table', caption: 'Qué se desactualiza y cómo se arregla', head: ['Qué', 'Problema', 'Arreglo típico'], rows: [
            ['El índice de ítems', 'Un video subido hace 10 minutos no está en el índice construido hace 3 horas', 'Índice principal cada pocas horas + un segmento chico de ítems frescos que se agrega en streaming (torre de ítem sobre sus features) o un nominador dedicado a frescos'],
            ['Los pesos del modelo', 'La distribución cambia cada día (tendencias, estacionalidad)', R`Entrenamiento secuencial/continuo (Yi: día a día); Monolith sincroniza los embeddings tocados al servidor de serving con intervalos de minutos (${MONO.split(',')[0]})`],
            ['Las features del usuario', 'El historial no incluye lo de hace un minuto', 'Features en streaming con el mismo código que en entrenamiento'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Re-entreno el modelo y sigo sirviendo el índice viejo"', html: R`<p>Si la torre de ítem cambió, los v del índice viejo viven en otro espacio que los u del modelo nuevo: el producto punto da basura, sin errores. Torre de usuario e índice se versionan y despliegan <b>juntos</b> (la misma lección de <a href="#retrieval.inferencia">retrieval</a>). Con entrenamiento continuo es peor: el índice siempre va atrás del modelo. Opciones: congelar la torre de usuario que se sirve hasta que llegue el índice nuevo, o re-indexar con la frecuencia con que se actualiza el modelo y medir cuánto se degrada el recall con la diferencia de versiones.</p>` },
          { t: 'table', caption: 'Trucos de serving', head: ['Truco', 'Qué gana', 'Qué cuesta'], rows: [
            ['Índice en fp16/int8 o PQ', '2–16× menos memoria', 'Recall del ANN: medir contra fuerza bruta'],
            ['Cachear u por sesión', 'Sin forward de la torre en requests seguidos', 'u desactualizado si el usuario acaba de consumir algo'],
            ['Filtros dentro del ANN (pre-filtrado)', 'No perder el top-k por filtros selectivos', R`Complejidad del índice (<a href="#ann.fallas">ANN con filtros</a>)`],
            ['Varios vectores por usuario (por interés)', 'Cubre usuarios con gustos muy distintos', 'Más búsquedas por request'],
            ['k más grande', 'Más recall para el ranker', 'El ranker paga k × su costo por candidato'],
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
            R`<b>Sesgo de popularidad y feedback loops.</b> El modelo se entrena con clicks sobre lo que él mismo mostró; lo que no se muestra no recibe clicks y nunca sube. Con el tiempo las recomendaciones se homogenizan: ${CHANEY} lo mostró en simulación (los usuarios se parecen más entre sí y la utilidad baja). Arreglos: entrenar también con consumo orgánico (Covington), exploración controlada (un porcentaje de tráfico con candidatos fuera del top), nominadores de frescos y de cola larga, y medir cobertura del catálogo además de engagement.`,
            R`<b>Cold start.</b> Ítems nuevos: sin id entrenado, solo valen las features de contenido; si la torre de ítem depende mucho del id, el ítem nuevo no sale. Usuarios nuevos: sin historial ni id útil, quedan las features de contexto y onboarding. ${DROPOUTNET} entrena apagando al azar las entradas de preferencia (ids, historial) para que la red aprenda a funcionar solo con contenido. La config ${CN} muestra el costo: casi sin parámetros, generaliza, pero no memoriza.`,
            R`<b>Sin interacciones cruzadas.</b> El producto punto de dos vectores no puede expresar "a esta usuaria le gusta la cocina, pero no los videos largos de cocina" si eso no quedó codificado en las dimensiones. Es una cota de capacidad del retriever, por diseño: lo arregla el ranker, no un MLP más profundo en cada torre.`,
            R`<b>Folding.</b> Grupos de usuarios e ítems que nunca interactúan (idiomas, nichos) pueden quedar superpuestos en el espacio, porque nada en los datos los separa: el producto punto entre un usuario de un grupo y un ítem del otro sale alto por accidente. Los negativos uniformes del catálogo (mezclados) y los filtros duros (idioma, región) lo mitigan.`,
            R`<b>Colisiones y deriva de versiones.</b> Muy pocos buckets: usuarios distintos comparten vector. Índice y torre de usuario de versiones distintas: scores sin sentido. Las dos fallas son silenciosas; se detectan con recall@k online contra un muestreo con fuerza bruta y con alarmas sobre la distribución de scores.`,
          ] },
          { t: 'table', caption: 'Generadores de candidatos (filas = criterios)', head: ['Criterio', 'Co-visitación / item-to-item', 'MF (ALS)', 'Two-tower', 'Secuencial (SASRec, HSTU)'], rows: [
            ['Entradas', 'Pares de ítems consumidos juntos', 'Solo ids de usuario e ítem', 'Ids + features de usuario, contexto e ítem', 'La secuencia ordenada de acciones'],
            ['Cold start de ítems', 'No', 'No', 'Sí, con features de contenido', 'Parcial (con features del ítem)'],
            ['Contexto (hora, dispositivo)', 'No', 'No', 'Sí', 'Sí'],
            ['Serving', 'Tabla precalculada', 'Producto punto + ANN', 'Torre de usuario + ANN', 'Transformer sobre el historial + ANN (o generación de ids)'],
            ['Costo por request', 'Mínimo', 'Mínimo', 'Bajo', 'Medio–alto (largo del historial)'],
            ['Cuándo', 'Siempre como nominador barato', 'Baseline y catálogos estables', 'El caballo de batalla del retrieval personalizado', 'Cuando el orden importa (series, música, sesiones)'],
          ], note: R`Fuentes: ${YT}; ${YI}; ${SASREC}; ${HSTU}.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota: "the two-tower model is a recall engine, not a precision engine. I judge it by whether the items the ranker ends up showing were in its candidates, by catalog coverage, and by how it treats fresh and long-tail items, and I keep several cheap nominators next to it because each one fails differently."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Cuándo lo mencionas'], rows: [
            [R`DSSM (${DSSM})`, 'Dos torres profundas sobre letter-trigramas, coseno y softmax sobre el clickeado y 4 negativos al azar: el primer two-tower profundo, en búsqueda.', 'El origen del patrón'],
            [R`YouTube DNN (${YT})`, 'Generación de candidatos como softmax sobre millones de videos con historial promediado, example age y ANN en serving; un ranker aparte predice tiempo de visualización.', 'El embudo de dos etapas, la fuga de información'],
            [R`Yi et al. 2019 (${YI})`, 'Torre de ítem con features, softmax in-batch con logQ estimado en streaming, entrenamiento secuencial.', 'La canónica de esta página'],
            [R`Mixed Negative Sampling (${MNS})`, 'In-batch + negativos uniformes del catálogo.', 'Cola larga y frescos'],
            [R`EBR de Facebook (${EBR})`, 'Two-tower para búsqueda con features sociales, minado de hard negatives online y offline, ANN integrado al índice invertido.', 'Negativos y serving en producción'],
            [R`SASRec (${SASREC}) y BERT4Rec (${BERT4REC})`, 'La torre de usuario es un transformer sobre la secuencia de ítems (causal o enmascarado), en vez de un promedio.', 'Cuando el orden del historial importa'],
            [R`HSTU / Generative Recommenders (${HSTU})`, 'Recomendación como transducción secuencial con un transformer modificado; reportan escalamiento en ley de potencia con el cómputo y modelos de 1.5 billones de parámetros. Es el benchmark de recomendación de MLPerf Training v6.1.', 'Escalamiento tipo LLM en recsys'],
            [R`TIGER (${TIGER})`, 'Cada ítem recibe un "semantic ID" (códigos de un RQ-VAE sobre su contenido) y un transformer genera el id del próximo ítem: retrieval sin índice ANN.', 'Retrieval generativo'],
            ['Item-to-item (co-visitación, "Swing", item2vec)', 'Vecinos del último ítem consumido, precalculados.', 'El nominador barato que siempre está'],
            [R`Ranking: <a href="#dlrm">DLRM, Wide & Deep, DCN</a>`, 'La etapa siguiente: features cruzadas, tablas enormes, interacción explícita.', 'Después del retrieval'],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Recomendación es una de las rondas clásicas de diseño de ML: "diseña el feed de videos", "recomendaciones de productos", "personas que quizás conozcas". La primera pregunta casi siempre es el embudo y la generación de candidatos; las de seguimiento son negativos, sesgo de popularidad, cold start, frescura y evaluación. Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Design the candidate generation stage for a short-video feed with 50M videos and 100M daily users.',
              junior: 'Un two-tower con los clicks y un índice vectorial.',
              senior: R`Primero preguntas y cuentas. <b>Preguntas</b>: QPS pico, latencia del feed completo, qué tan rápido tiene que aparecer un video nuevo, qué objetivo (watch time, likes, retención). <b>Cuentas</b>: 100M usuarios × ${est('≈ 20 requests')} al día = ${est('2·10⁹ requests/día ≈ 23K QPS promedio, ≈ 60K pico')}. Presupuesto: ${est('≈ 200 ms')} para todo el feed, ${est('≈ 30–50 ms')} para retrieval. <b>Arquitectura</b>: varios nominadores en paralelo, cada uno con ${est('cientos')} de candidatos: (1) two-tower personalizado; (2) item-to-item desde los últimos videos vistos; (3) seguidos; (4) frescos y tendencias por región. Unión y dedup: ${est('≈ 1–2K')} candidatos → ranker ligero → ${est('≈ 500')} → ranker pesado (<a href="#dlrm">DLRM/DCN</a>) → re-ranking con diversidad y reglas → ${est('≈ 10–50')} mostrados. <b>El two-tower</b>: torre de usuario con id hasheado, historial reciente (promedio o un transformer chico), contexto; torre de ítem con id + features de contenido (embedding del video y del audio de un encoder preentrenado, creador, idioma, duración) para cold start. dim 64. Positivos: views con tiempo de visualización alto, pesados por engagement. Pérdida: softmax in-batch con logQ, B ${est('≈ 8K')}, más negativos uniformes del catálogo. <b>Memoria</b>: tabla de ítems 5·10⁷ × 64 × 4 ${est('≈ 12.8 GB')} y de usuarios hasheada ${est('≈ 25.6 GB')} en fp32 (con Adagrad, ×2): entrenamiento distribuido con tablas repartidas. Índice de serving 5·10⁷ × 64 en fp16 ${est('≈ 6.4 GB')}: cabe en una máquina, réplicas para QPS. <b>ANN</b>: con HNSW a ${est('≈ 1 ms')} por consulta y núcleo, 60K QPS son ${est('≈ 60 núcleos')} más margen: un puñado de máquinas replicadas. <b>Frescura</b>: re-indexar cada pocas horas + un segmento de frescos en streaming. <b>Evaluación</b>: recall@k del próximo video visto con split temporal, cobertura, recall por segmento (nuevos, cola larga) y, al final, A/B del embudo con watch time y retención y guardrails de latencia.`,
              say: 'I would run several nominators in parallel: a personalized two-tower model, item-to-item from recent watches, subscriptions and a fresh-content source, each returning a few hundred candidates, which a light ranker cuts to about five hundred and a heavy ranker orders. The two-tower uses a hashed user id, recent history and context on one side, and the video id plus content embeddings on the other so new uploads get a vector. I train it with in-batch softmax with log-Q correction plus uniform negatives. The item table is about thirteen gigabytes in fp32, so training is distributed, but the serving index is about six gigabytes in fp16 and fits on one machine, replicated for sixty thousand QPS. I rebuild the index every few hours, stream fresh items into a small segment, and evaluate with temporal recall at k, coverage, and an end-to-end A/B test.',
              why: 'Se anota preguntar antes de dibujar, las cuentas de QPS y memoria, varios nominadores y el embudo con números, features de contenido para cold start, logQ, frescura y evaluación temporal.' },
            { q: 'Why does in-batch softmax need a sampling-bias correction, and what exactly do you subtract?',
              junior: 'Para normalizar los scores.',
              senior: R`Los negativos in-batch son los positivos de otras filas, así que llegan con probabilidad proporcional a su popularidad: un video viral es negativo en casi todas las filas y recibe un gradiente hacia abajo enorme. El modelo termina aprendiendo p(ítem | usuario)/Q(ítem): si Q es la popularidad, borra justamente esa señal (en el juguete de <a href="#two-tower.practica">práctica</a> aprende una distribución uniforme). La corrección (${YI.split(',')[0]}, siguiendo la softmax muestreada de Bengio) resta log p<sub>j</sub> a cada logit de la columna j, positivo incluido: s<sup>c</sup> = u·v/τ − log p<sub>j</sub>. p<sub>j</sub> se estima en streaming con arreglos hasheados del promedio de pasos entre apariciones (p = 1/δ). Solo en entrenamiento: en serving, u·v. Resultado del paper: en YouTube, recall@50 de 0.4586 a 0.5322, y +0.37 % contra +0.20 % de engagement en vivo.`,
              say: 'In-batch negatives are other users\' positives, so they are sampled in proportion to popularity, and popular items get pushed down far more than they should; the model ends up learning the ratio of the true probability to the sampling probability. The log-Q correction subtracts the log of each item\'s estimated in-batch frequency from its logit during training only, which recovers an unbiased estimate of the full softmax. Yi and colleagues estimate that frequency in streaming with hashed arrays of the average gap between occurrences.',
              why: 'Trampa: "normalizar". Se anota por qué los populares son sobre-penalizados, que se resta log Q por columna, que solo se aplica al entrenar y cómo se estima Q.', trap: true },
            { q: 'Why can\'t a two-tower model use user-item cross features? Where do they go?',
              junior: 'Sí puede, las agrego a la torre de usuario.',
              senior: R`Porque el score tiene que factorizarse en f(usuario)·g(ítem): la torre de ítem corre offline sin saber quién pregunta, y la de usuario corre una vez por request sin saber qué ítems va a comparar; ese es el precio de poder indexar los ítems. "Veces que este usuario vio a este creador" o "precio contra su gasto típico" dependen del par: no caben en ninguna torre. Van al <b>ranker</b>, que solo ve cientos de candidatos y puede calcular features por par. Lo que el two-tower sí hace: interacción implícita vía el historial (los ítems vistos están en el mismo espacio que el candidato) y afinidades agregadas del usuario que "se encuentran" con la categoría del ítem en el producto punto.`,
              say: 'The score has to factor into a user vector times an item vector so that item vectors can be precomputed and indexed. A cross feature depends on both, so it cannot be computed in either tower; it belongs in the ranking model, which only scores a few hundred candidates. The retriever gets implicit interaction through the user\'s history embedded in the same space as the items.',
              why: 'Trampa: meter la feature cruzada en una torre. Se anota la factorización, el precio de indexar y que va al ranker.', trap: true },
            { q: 'How do you handle cold start for new items and new users?',
              junior: 'Se muestran al azar hasta que tengan datos.',
              senior: R`<b>Ítems nuevos</b>: que la torre de ítem no dependa solo del id. Features de contenido (embedding del título, la imagen o el audio de un encoder preentrenado, categoría, creador, idioma) dan un v razonable desde el primer minuto; se mete al índice por el segmento de frescos sin esperar el re-indexado. Entrenar apagando el id al azar (dropout de las entradas de preferencia, como DropoutNet) para que la torre aprenda a funcionar sin él. Y una ruta de exploración: un nominador de frescos con un presupuesto de impresiones, para juntar las primeras señales. <b>Usuarios nuevos</b>: contexto (país, idioma, dispositivo, hora, fuente de instalación), onboarding (temas elegidos) y popularidad por segmento; el historial de la primera sesión entra en minutos con features en streaming. Medir aparte: recall y CTR de ítems de menos de un día y de usuarios de menos de una semana.`,
              say: 'For new items I make the item tower content-aware, using pretrained embeddings of the title, thumbnail or audio plus metadata, train with random dropout of the id features so the tower works without them, insert fresh items into a streaming index segment, and give them an exploration budget. For new users I rely on context, onboarding choices and segment popularity, and stream in first-session history within minutes. I track metrics separately for fresh items and new users.',
              why: 'Se anota contenido en la torre de ítem, dropout del id, segmento fresco del índice, exploración y métricas por segmento.' },
            { q: 'Your recommendations keep showing the same popular items. Why, and what do you do?',
              junior: 'Bajo el score de los ítems populares.',
              senior: R`Tres causas que se suman. (1) <b>Feedback loop</b>: el modelo aprende de clicks sobre lo que él mismo mostró; lo no mostrado nunca recibe señal (Chaney et al. lo mostraron en simulación: homogeneidad creciente, utilidad decreciente). (2) <b>El objetivo</b>: los clicks premian lo popular y lo llamativo. (3) <b>El entrenamiento</b>: sin logQ, el in-batch sesga contra lo popular; pero con negativos solo in-batch, la cola larga nunca es negativo y el espacio la ignora. Qué hago: entrenar también con consumo orgánico (fuera de las recomendaciones), corregir con logQ y sumar negativos uniformes, un nominador de cola larga y frescos, exploración controlada (un % de impresiones fuera del top, con logging de la propensión para poder corregir después), diversidad explícita en el re-ranking (penalizar repetición de creador o tema), y métricas de cobertura y concentración junto al engagement. No bajo los scores de lo popular a ciegas: lo popular suele ser popular por algo.`,
              say: 'It is usually a feedback loop: the model learns from clicks on what it already showed, so unexposed items never get signal. I train on organic consumption too, use log-Q correction plus uniform negatives, add long-tail and fresh nominators, reserve a small logged exploration budget, enforce diversity in re-ranking, and track catalog coverage and concentration alongside engagement.',
              why: 'Trampa: penalizar lo popular a ciegas. Se anota el feedback loop, los arreglos en datos, modelo, embudo y métricas.', trap: true },
            { q: 'Which negatives would you use to train the retrieval model? Would you use impressions that were not clicked?',
              junior: 'Sí, las impresiones no clickeadas son los mejores negativos.',
              senior: R`Para retrieval, no como base. La tarea es separar cientos de relevantes de millones de irrelevantes; las impresiones ya pasaron por el embudo y son todas "casi buenas". En EBR de Facebook, entrenar con impresiones no clickeadas dio −55 % absoluto de recall contra negativos al azar. Uso: in-batch con logQ (gratis), más negativos uniformes del catálogo (Mixed Negative Sampling: cubre cola larga y frescos), más unos pocos hard negatives minados (EBR: el minado online dio +8.38 % de recall; más de dos por positivo empeoró). Las impresiones no clickeadas son el negativo natural del <b>ranker</b>.`,
              say: 'Not as the main negatives for retrieval. Retrieval must separate the relevant few hundred from millions of easy negatives, and Facebook\'s embedding-based retrieval paper saw a fifty-five percent absolute recall drop when training on non-clicked impressions instead of random negatives. I use in-batch negatives with log-Q correction, uniform negatives from the catalog, and a couple of mined hard negatives per positive; impressions belong to the ranking model.',
              why: 'Trampa: las impresiones como negativos del retriever. Se anota el resultado de EBR, la mezcla de negativos y dónde sí sirven las impresiones.', trap: true },
            { q: 'How do you evaluate a candidate generator offline and online?',
              junior: 'Con accuracy en un set de prueba.',
              senior: R`<b>Offline</b>: recall@k (k = lo que entrega al ranker) del próximo ítem consumido contra el catálogo completo, con split <b>temporal</b> (entrenar hasta d, evaluar d+1; promediar una semana), nunca un ítem al azar del historial (filtra el futuro). Por segmento: usuarios nuevos, ítems frescos, cola larga, idioma. Cobertura del catálogo y concentración. Y la métrica del sistema: qué fracción de lo que el ranker termina mostrando vino de este nominador (si sus candidatos no sobreviven al ranker, no aportan). <b>Online</b>: A/B del embudo completo con el objetivo del producto (watch time, retención a 7 días), no CTR solo, con guardrails de latencia y diversidad. Ojo: el ranker actual fue entrenado con candidatos del retriever viejo; un retriever nuevo puede necesitar re-entrenar al ranker para mostrar su valor.`,
              say: 'Offline I measure recall at k of the next consumed item against the full catalog with a temporal split, broken down by fresh items, new users and the long tail, plus catalog coverage and how many of its candidates survive ranking. Online I run an A/B test of the whole funnel on the product objective with latency and diversity guardrails, keeping in mind the ranker was trained on the old retriever\'s candidates.',
              why: 'Se anota split temporal, recall@k contra todo el catálogo, segmentos, supervivencia al ranker y A/B del embudo.' },
            { q: 'How do you keep the index fresh, and what can go wrong when the model is retrained?',
              junior: 'Re-indexo una vez al día.',
              senior: R`Hay tres relojes: el índice (re-construcción cada pocas horas en Yi, más un segmento de frescos en streaming), los pesos (entrenamiento continuo o diario) y las features del usuario (streaming). El riesgo: torre de usuario e índice de <b>versiones distintas</b>: si la torre de ítem cambió, el producto punto entre un u nuevo y un v viejo no significa nada, y no hay error que lo avise. Despliego índice y torre de usuario como una unidad versionada (la torre que se sirve es la que generó el índice), con validación de recall contra fuerza bruta antes del swap y rollback. Monitoreo: distribución de scores, recall@k online en una muestra y fracción de candidatos que sobreviven al ranker.`,
              say: 'I rebuild the main index every few hours and stream fresh items into a small segment. The serving user tower and the index are deployed together as one versioned unit, because a user vector from a new model against item vectors from an old one is meaningless and fails silently. I validate recall before swapping, keep the previous version for rollback, and monitor score distributions.',
              why: 'Se anota los tres relojes, el desfase de versiones entre torres y el despliegue conjunto.', trap: true },
            { q: 'Your product cares about clicks, watch time and creator diversity. How does the retrieval stage handle multiple objectives?',
              junior: 'Entreno tres two-towers.',
              senior: R`El grueso de lo multi-objetivo se resuelve en el <b>ranker</b> (varias cabezas, una por señal, y una combinación ponderada en el score final). En retrieval tengo tres palancas: (1) <b>pesos por ejemplo</b> (Yi: r<sub>i</sub> = engagement del click; Covington pondera por tiempo visto en el ranker), así un solo modelo apunta a lo que importa; (2) <b>varios nominadores</b> con objetivos distintos (uno de watch time, uno de frescos, uno de seguidos) y una cuota por fuente; (3) diversidad en el <b>re-ranking</b> final. Tres two-towers completos multiplican el costo de índice y entrenamiento; antes de eso, pruebo pesos y fuentes.`,
              say: 'Most multi-objective trade-offs live in the ranker, with one head per signal and a weighted final score. In retrieval I weight positives by engagement, run several nominators with different objectives and quotas, and handle diversity in re-ranking, before paying for multiple full two-tower models and indexes.',
              why: 'Se anota que lo multi-objetivo vive sobre todo en el ranker, pesos por ejemplo, nominadores con cuotas y diversidad en el re-ranking.' },
            { q: 'Two-tower vs matrix factorization: what does the two-tower add?',
              junior: 'Es más profundo.',
              senior: R`MF es un two-tower donde cada torre es solo una tabla de ids: U·Vᵀ. El two-tower agrega features (contexto, contenido del ítem, historial) y MLPs que las combinan: con eso resuelve cold start de ítems, usa el contexto del request (hora, dispositivo) y generaliza a combinaciones no vistas. Lo que no cambia: el score sigue siendo un producto punto (se indexa igual) y las tablas de ids siguen siendo casi todos los parámetros. Si solo tienes ids y un catálogo estable, MF con ALS es un baseline fuerte y barato.`,
              say: 'Matrix factorization is a two-tower model whose towers are just id embedding tables. The two-tower adds content, context and history features with neural networks, which handles cold-start items and request context, while keeping the dot-product score that makes indexing possible.',
              why: 'Se anota MF = dos tablas, lo que agregan las features y que el producto punto se mantiene.' },
            { q: 'You hash 500M user ids into 10M buckets. What are the trade-offs?',
              junior: 'No pasa nada, el hash es aleatorio.',
              senior: R`Cada fila la comparten ${est('≈ 50')} usuarios en promedio: el embedding de usuario se vuelve el de un grupo aleatorio, y el modelo depende del historial y las features para personalizar. A cambio: memoria fija (10⁷ × d<sub>id</sub> × 4 bytes en fp32), sin vocabulario que mantener y usuarios nuevos con fila inmediata. Opciones: más buckets (memoria lineal), varios hashes con tablas sumadas (cada usuario queda casi único con menos memoria: el QR trick de DLRM), tablas sin colisiones con expiración de ids inactivos y filtro de frecuencia (Monolith), o quitar el id de usuario y apostar al historial (que generaliza mejor y no colisiona). Lo mido: recall con y sin id de usuario, por segmento de actividad.`,
              say: 'Each bucket is shared by about fifty users on average, so the user id embedding becomes a random group embedding and personalization comes from history and features. In exchange memory is fixed and new users get a row immediately. I would compare more buckets, multiple hashes combined, collisionless tables with expiry, or dropping the user id in favor of history, and measure recall by activity segment.',
              why: 'Se anota la tasa de colisión, el trade-off de memoria y las alternativas (doble hash, sin colisiones, historial).' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuánto ocupan las tablas y el índice de la canónica?',
              a: R`Tablas: ${met('embP')} parámetros = ${met('embB')} en fp32 (los MLPs, ${met('mlpParamsShare')}). Índice: ${cf('nItems')} × ${cf('dim')} × 4 bytes = ${met('idx')}.` },
            { q: 'El two-tower recién entrenado devuelve casi los mismos 200 ítems a todos los usuarios. ¿Qué miras?',
              a: 'Sospechosos: (1) la torre de usuario colapsó (u casi constante: mira la varianza de u entre usuarios); (2) producto punto sin normalizar y unos pocos v de norma enorme (hubness); (3) logQ con el signo al revés o aplicado en serving; (4) features de usuario vacías en serving pero no en entrenamiento (training/serving skew); (5) el índice es de otra versión del modelo. Chequeo rápido: pérdida inicial ≈ ln B, recall@k por segmento y la distribución de normas.' },
            { q: 'Recall@100 offline subió 10 % pero el A/B no se movió. ¿Por qué puede pasar?',
              a: 'El ranker filtra: si los ítems nuevos que trae el retriever no sobreviven al ranker (entrenado con candidatos del retriever viejo), no se muestran. O el split offline no es temporal y hay fuga. O la mejora está en ítems que igual llegaban por otro nominador. Mide la fracción de candidatos de este nominador en el top final y re-entrena el ranker con los nuevos candidatos.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (los calcula el calculador), dos cuentas a mano y al final el ejercicio de código: la softmax in-batch con logQ y un juguete que muestra qué aprende cada pérdida.` },
          { t: 'h3', text: 'Diagrama en blanco: las dos torres' },
          { t: 'blankdiagram', diagram: 'two-tower-overview', slots: [
            { node: 'user-mlp', tensor: T.u, ask: 'shape' },
            { node: 'item-mlp', ask: 'label', hint: 'offline, una vez por ítem' },
            { node: 'index', tensor: T.index, ask: 'shape' },
            { node: 'retrieve', ask: 'label', hint: 'top-k por producto punto' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'two-tower', pool: 'all', configs: [C, CS, CN] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`El catálogo crece de ${cf('nItems')} a 10 veces más ítems. ¿Por qué factor cambia la memoria del índice?`, change: { nItems: 20000000 }, ask: 'indexBytes',
              explain: '×10, lineal: un vector por ítem.' },
            { q: 'Mismo cambio. ¿Y el costo de la torre de usuario por request?', change: { nItems: 20000000 }, ask: 'userTowerMacs',
              explain: 'Nada: la torre de usuario no sabe cuántos ítems hay. Crecen el índice, la búsqueda y el costo de re-indexar.' },
            { q: 'Mismo cambio. ¿Y los parámetros de embeddings?', change: { nItems: 20000000 }, ask: 'embeddingParams',
              explain: 'Crecen casi en proporción a las filas nuevas de la tabla de ítems (la de usuarios no cambia).' },
            { q: R`Duplicas el batch B. ¿Qué pasa con los MACs de la matriz de logits?`, change: { B: 2 * 4096 }, ask: 'inBatchLogitsMacs',
              explain: '×4: B² productos punto de dim. El costo de las torres solo se duplica.' },
            { q: R`Bajas la dimensión de u y v de ${cf('dim')} a 32. ¿Cómo cambia el índice?`, change: { dim: 32 }, ask: 'indexBytes',
              explain: 'Lineal en dim. La tabla de embeddings no cambia: dim es la salida del MLP, no el ancho de los ids.' },
            { q: 'Historial de 200 ítems en lugar de los de la canónica. ¿Qué pasa con los parámetros?', change: { hist: 200 }, ask: 'embeddingParams',
              explain: 'Nada: el historial lee filas de la tabla de ítems, que ya existe (compartida). Crecen los lookups y los bytes leídos por ejemplo.' },
            { q: 'Mismo cambio. ¿Y los bytes leídos de tablas por ejemplo?', change: { hist: 200 }, ask: 'lookupBytesPerExample',
              explain: 'Crecen casi lineal con el historial: cada ítem es una fila de d_id números. En recsys el costo de la torre es leer memoria.' },
            { q: 'Duplicas los buckets de usuarios. ¿Por qué factor cambian las tablas de embeddings?', change: { idBuckets: 20000000 }, ask: 'embeddingParams',
              explain: 'Menos que ×2: solo crece la tabla de usuarios; la de ítems sigue igual.' },
          ] },
          { t: 'h3', text: 'A mano: la corrección logQ en una fila' },
          { t: 'calc', title: 'Una fila del batch: positivo de nicho (p = 0.001), negativo popular (p = 0.1) y otro (p = 0.01); logits u·v/τ = [2, 3, 1]', rows: [
            { label: 'Sin corrección: softmax', expr: 'e² , e³ , e¹ → [0.245, 0.665, 0.090]', value: 'pérdida = −ln 0.245 = 1.4076', note: 'el popular recibe 0.665 del gradiente hacia abajo' },
            { label: 'logits corregidos', expr: '2 − ln 0.001 , 3 − ln 0.1 , 1 − ln 0.01', value: '[8.9078, 5.3026, 5.6052]' },
            { label: 'Con logQ: softmax', expr: '→ [0.940, 0.026, 0.035]', value: 'pérdida = 0.0620', note: 'el empujón al popular baja de 0.665 a 0.0255' },
          ], result: 'El gradiente de la entropía cruzada sobre el logit de un negativo es su probabilidad softmax. Sin corrección, el ítem popular se lleva dos tercios del "castigo" de esta fila solo por estar en el batch; con logQ, casi nada. Verificado en PyTorch (abajo).' },
          { t: 'calc', title: 'A mano: ¿dónde están los parámetros? (dim de ids 64)', rows: [
            { label: 'Tabla de ítems 2M × 64', expr: '2·10⁶ × 64', value: met('itemIdParams') },
            { label: 'Tabla de usuarios 10M × 64', expr: '10⁷ × 64', value: met('userIdParams') },
            { label: 'MLP de una torre: 192 → 256 → 128 → 64', expr: '192·256 + 256 + 256·128 + 128 + 128·64 + 64', value: '90,560' },
          ], result: R`Las dos tablas suman 768M; el MLP de cada torre, menos de 0.1M. Compáralo con el calculador: ${met('embP')} en tablas y ${met('mlpP')} en MLPs (la canónica agrega las tablas categóricas chicas).` },

          { t: 'h3', text: 'Escríbelo: softmax in-batch con logQ' },
          { t: 'p', html: R`Sin mirar: (1) <code>inbatch_softmax_loss(u, v, log_q, tau)</code>: la matriz B×B, restar log Q por columna y entropía cruzada con la diagonal; (2) un juguete sin usuarios donde el modelo solo aprende un logit por ítem, con clicks que siguen una ley de Zipf sobre 1,000 ítems: ¿qué popularidad aprende con y sin corrección? Verificado en el venv del Atlas (PyTorch 2.14): los números de la fila a mano salen idénticos, la pérdida vectorizada coincide con el bucle por fila (float64), y en el juguete <b>sin corrección el modelo aprende una distribución uniforme</b> (P(ítem 1) = 0.001 contra 0.1794 real, KL 2.186, 0 de 10 en el top-10), mientras que <b>con logQ la recupera exacta</b> (P(ítem 1) = 0.1794, KL 0.000, 10 de 10).` },
          { t: 'code', title: 'Solución de referencia (PyTorch)', files: [
            { name: 'logq_twotower.py', lang: 'python', code: [
              'import torch',
              'import torch.nn.functional as F',
              '',
              '',
              'def inbatch_softmax_loss(u, v, log_q=None, tau=0.05):',
              '    """u, v: (B, E) con norma 1; fila i = un usuario, columna i = su ítem positivo.',
              '    log_q: (B,) log de cuántas veces se espera que cada ítem del batch aparezca en un batch, o None."""',
              '    logits = u @ v.T / tau                                   # (B, B): la diagonal son los positivos',
              '    if log_q is not None:',
              '        logits = logits - log_q[None, :]                     # logQ: se corrige cada COLUMNA (el ítem), positivo incluido',
              '    labels = torch.arange(u.shape[0], device=u.device)',
              '    return F.cross_entropy(logits, labels)',
              '',
              '',
              'def item_bias_toy(p_true, B=256, steps=4000, correct=True, seed=0):',
              '    """Sin usuario: el modelo solo aprende un logit por ítem. Los positivos llegan con la popularidad p_true."""',
              '    g = torch.Generator().manual_seed(seed)',
              '    b = torch.zeros(len(p_true), dtype=torch.float64, requires_grad=True)',
              '    opt = torch.optim.Adam([b], lr=0.05)',
              '    for _ in range(steps):',
              '        items = torch.multinomial(p_true, B, replacement=True, generator=g)   # un batch de clicks',
              '        logits = b[items][None, :].expand(B, B)                                # mismo "usuario" en cada fila',
              '        if correct:',
              '            logits = logits - torch.log(B * p_true[items])[None, :]           # Q = apariciones esperadas por batch',
              '        loss = F.cross_entropy(logits, torch.arange(B))',
              '        opt.zero_grad(); loss.backward(); opt.step()',
              '    return b.detach().softmax(0)                                               # la "full softmax" que aprendió',
            ] },
            { name: 'check_logq.py', lang: 'python', code: [
              'import torch',
              'import torch.nn.functional as F',
              'from logq_twotower import inbatch_softmax_loss, item_bias_toy',
              '',
              '# 1) a mano: una fila; positivo de nicho (p = 0.001), negativo popular (0.1) y otro (0.01)',
              's = torch.tensor([2.0, 3.0, 1.0], dtype=torch.float64)',
              'p = torch.tensor([0.001, 0.1, 0.01], dtype=torch.float64)',
              'for z in (s, s - p.log()):',
              '    sm = z.softmax(0)',
              "    print(-sm[0].log().item(), sm[1].item())   # 1.4076 0.6652  ·  0.0620 0.0255",
              '',
              '# 2) vectorizada == bucle -log softmax por fila (float64)',
              'torch.manual_seed(0)',
              'B, E, tau = 6, 8, 0.05',
              'u, v = (F.normalize(torch.randn(B, E, dtype=torch.float64), dim=-1) for _ in range(2))',
              'lq = torch.log(torch.rand(B, dtype=torch.float64))',
              'loop = sum(-(z[i] - torch.logsumexp(z, 0)) for i in range(B) for z in [u[i] @ v.T / tau - lq]) / B',
              'print(torch.allclose(inbatch_softmax_loss(u, v, lq, tau), loop))          # True',
              '',
              '# 3) juguete Zipf: ¿qué popularidad aprende cada pérdida?',
              'M = 1000',
              'p_true = 1.0 / torch.arange(1, M + 1).double() ** 1.1; p_true /= p_true.sum()',
              'for correct in (False, True):',
              '    q = item_bias_toy(p_true, correct=correct)',
              '    kl = (p_true * (p_true.log() - q.log())).sum().item()',
              '    top10 = len(set(q.topk(10).indices.tolist()) & set(range(10)))',
              '    print(correct, round(kl, 3), top10, round(q[0].item(), 4))',
              '# False 2.186 0 0.001    <- sin corrección: uniforme (aprende p / Q = constante)',
              '# True  0.0  10 0.1794   <- con logQ: la popularidad real',
            ] },
          ] },
          { t: 'callout', kind: 'note', title: 'Qué Q usar (y por qué el juguete usa B·p)', html: R`<p>La corrección exacta de la softmax muestreada con reemplazo usa el número <b>esperado</b> de apariciones por batch, B·p<sub>j</sub>. Yi estima la probabilidad de que el ítem <b>aparezca</b> en un batch (1/δ), que es casi lo mismo cuando B·p<sub>j</sub> ≪ 1 (casi todo un catálogo de millones) pero se satura en 1 para los ítems que están en todos los batches. En este juguete de 1,000 ítems, donde el más popular tiene p = 0.18, esa versión deja la cabeza subestimada (P(ítem 1) ≈ 0.009 en vez de 0.18, aunque sí ordena bien el top-10). Con un catálogo real, la diferencia está en los pocos ítems más populares: mídelo antes de elegir.</p>` },
          { t: 'callout', kind: 'trap', title: 'Los bugs que este ejercicio atrapa', html: R`<p>(1) Restar log Q por <b>fila</b> en vez de por columna: la fila es el usuario, que no se muestrea por popularidad del ítem; la corrección tiene que ir con el ítem. (2) Sumar en vez de restar: amplifica el sesgo. (3) Corregir solo los negativos y no el positivo: no es la Ec. 4 de Yi. (4) Dejar la corrección en el score de serving. (5) Olvidar la temperatura con vectores normalizados: con τ = 1 los logits viven en [−1, 1] y la softmax casi no distingue nada.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. Lo siguiente en el embudo: <a href="#dlrm">el ranker (DLRM, Wide & Deep, DCN)</a>, que ordena los candidatos que este modelo trae.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'two-tower-01', kind: 'concepto', q: 'Two-tower de recomendación en una línea.', a: 'Torre de usuario → u, torre de ítem → v, score u·v; los v del catálogo se precalculan y se indexan con ANN: candidate generation de millones a cientos.' },
      { id: 'two-tower-02', kind: 'concepto', q: 'El embudo de recomendación y el tamaño de cada etapa.', a: 'Retrieval (varios nominadores): millones → cientos. Ranking: cientos → decenas, con features cruzadas. Re-ranking: diversidad y reglas de negocio.' },
      { id: 'two-tower-03', kind: 'trampa', q: '"Agrego una feature usuario × ítem a la torre de usuario."', a: 'No cabe: el score debe factorizarse en f(usuario)·g(ítem) para indexar los ítems. Las features cruzadas van al ranker.' },
      { id: 'two-tower-04', kind: 'concepto', q: '¿Por qué la softmax in-batch está sesgada?', a: 'Los negativos son positivos de otras filas, muestreados según la popularidad: los ítems populares reciben demasiado castigo y el modelo aprende p/Q.' },
      { id: 'two-tower-05', kind: 'formula', q: 'Logit corregido de Yi et al. (RecSys 2019).', a: R`\(s^c(x_i, y_j) = \mathbf{u}_i^\top\mathbf{v}_j/\tau - \log p_j\), en todas las columnas (positivo incluido), solo al entrenar.` },
      { id: 'two-tower-06', kind: 'trampa', q: '"La corrección logQ también va en el score de serving."', a: 'No: corrige un estimador de entrenamiento. En serving el score es u·v; menos popularidad en lo mostrado se decide en el re-ranking.' },
      { id: 'two-tower-07', kind: 'concepto', q: 'Cómo estima Yi la frecuencia de un ítem en streaming.', a: 'Arreglos hasheados A (último paso visto) y B (promedio móvil de pasos entre apariciones, δ); p = 1/δ. Sin vocabulario fijo; varios hashes → máximo de δ.' },
      { id: 'two-tower-08', kind: 'conteo', q: 'Yi et al., YouTube (Tabla 2): recall@50 sin y con logQ.', a: '0.4586 → 0.5322 (τ = 0.05) sobre un índice de ≈ 10M videos; en vivo +0.20 % vs +0.37 % de engagement.' },
      { id: 'two-tower-09', kind: 'concepto', q: 'Configuración de entrenamiento de Yi en YouTube.', a: 'Torres [1024, 512, 128], batch 8192, Adagrad LR 0.2, embeddings L2-normalizados con temperatura, entrenamiento secuencial por días, índice re-construido cada pocas horas.' },
      { id: 'two-tower-10', kind: 'trampa', q: '"Impresiones no clickeadas = los mejores negativos para el retriever."', a: 'EBR de Facebook: −55 % absoluto de recall frente a negativos al azar. Son negativos para el ranker; el retriever necesita mayoría de negativos fáciles.' },
      { id: 'two-tower-11', kind: 'concepto', q: 'Mixed Negative Sampling.', a: 'In-batch + negativos muestreados uniformemente del catálogo: cubre la cola larga y los ítems frescos que nunca aparecen como positivos.' },
      { id: 'two-tower-12', kind: 'conteo', q: 'Hard negatives en EBR (Facebook, KDD 2020).', a: 'Minado online dentro del batch: +8.38 % de recall en búsqueda de personas; más de 2 hard negatives por positivo empeora.' },
      { id: 'two-tower-13', kind: 'concepto', q: 'Hashing trick para ids.', a: 'fila = h(id) mod buckets: memoria fija, ids nuevos con fila inmediata; a cambio, colisiones (usuarios distintos comparten vector).' },
      { id: 'two-tower-14', kind: 'concepto', q: 'Cómo representa el historial el two-tower de YouTube.', a: 'Bolsa: promedio de los embeddings de los últimos ítems vistos (Covington: 50 videos y 50 búsquedas), con la tabla de ítems compartida.' },
      { id: 'two-tower-15', kind: 'concepto', q: 'Cold start de ítems en two-tower.', a: 'Features de contenido en la torre de ítem (embeddings de título, imagen, audio; categoría, creador), dropout del id al entrenar, segmento fresco del índice y exploración.' },
      { id: 'two-tower-16', kind: 'concepto', q: '"Example age" (Covington 2016).', a: 'La edad del ejemplo como feature al entrenar y 0 en serving: el modelo aprende la dependencia temporal y deja de predecir la popularidad promedio de la ventana.' },
      { id: 'two-tower-17', kind: 'trampa', q: 'Evaluar el retriever ocultando un ítem al azar del historial.', a: 'Filtra el futuro y rompe la asimetría del consumo. Split temporal: predecir el próximo ítem con solo lo anterior.' },
      { id: 'two-tower-18', kind: 'concepto', q: 'Leakage de la última búsqueda (Covington §3.4).', a: 'Con la búsqueda como feature, el modelo reproduce la página de resultados: bien offline, mal en vivo. Se le dio como bolsa de tokens sin orden.' },
      { id: 'two-tower-19', kind: 'concepto', q: '¿Dónde están los parámetros de un two-tower?', a: 'Casi todos en las tablas de ids (millones de filas × d); los MLPs son diminutos. Covington: 1M ids × 32 = 7× una capa densa de 2048.' },
      { id: 'two-tower-20', kind: 'concepto', q: 'Los tres relojes de frescura de un two-tower.', a: 'El índice (re-construcción cada pocas horas + segmento de frescos en streaming), los pesos (entrenamiento continuo o diario) y las features del usuario (streaming).' },
      { id: 'two-tower-21', kind: 'conteo', q: 'MACs de la matriz de logits in-batch.', a: 'B² × dim: ×2 en B → ×4 en la matriz, ×2 en las torres.' },
      { id: 'two-tower-22', kind: 'trampa', q: '"Con entrenamiento continuo, sirvo siempre la torre de usuario más nueva."', a: 'El índice se construyó con una torre de ítem anterior: u nuevo · v viejo no significa nada, sin error. Se sirve la torre de usuario de la misma versión que generó el índice.' },
      { id: 'two-tower-23', kind: 'concepto', q: 'Feedback loop en recomendación.', a: 'El modelo aprende de clicks sobre lo que mostró; lo no mostrado nunca recibe señal → homogeneidad. Consumo orgánico, exploración con logging, nominadores de cola larga, métricas de cobertura.' },
      { id: 'two-tower-24', kind: 'tradeoff', q: 'Two-tower vs matrix factorization.', a: 'MF = dos tablas de ids (U·Vᵀ). Two-tower agrega features y MLPs: cold start, contexto, generalización; el score sigue siendo un producto punto indexable.' },
      { id: 'two-tower-25', kind: 'concepto', q: 'DSSM (CIKM 2013) en una línea.', a: 'El primer two-tower profundo: word hashing en letter-trigramas (500K palabras → 30,621 dims), capas 300-300-128, coseno, softmax sobre el clickeado y 4 negativos al azar.' },
      { id: 'two-tower-26', kind: 'concepto', q: 'Accidental hits en la softmax in-batch.', a: 'El mismo ítem en dos columnas del batch: para una fila, la copia es un "negativo" idéntico a su positivo. Se enmascara (TFRS: remove_accidental_hits).' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'two-tower model', es: 'modelo de dos torres', def: 'Una red para el usuario y otra para el ítem; el score es el producto punto de sus salidas, así que los ítems se precalculan e indexan.', say: 'Our candidate generator is a two-tower model served from an ANN index.' },
      { en: 'candidate generation', es: 'generación de candidatos', def: 'Primera etapa del embudo de recomendación: de millones de ítems a cientos, con modelos baratos y varias fuentes.', say: 'Candidate generation narrows ten million videos to a few hundred.' },
      { en: 'sampling-bias correction (logQ)', es: 'corrección del sesgo de muestreo (logQ)', def: 'Restar el log de la frecuencia de muestreo de cada ítem a su logit en la softmax in-batch, solo al entrenar.', say: 'We apply log-Q correction so popular items are not over-penalized as negatives.' },
      { en: 'hashing trick', es: 'truco de hashing', def: 'Mapear ids a un número fijo de filas con una función hash; acepta colisiones a cambio de memoria fija y sin vocabulario.', say: 'User ids are hashed into ten million buckets.' },
      { en: 'cold start', es: 'arranque en frío', def: 'Usuarios o ítems sin historial de interacciones; se resuelve con features de contenido y contexto.', say: 'Content features in the item tower solve cold start for new uploads.' },
      { en: 'feedback loop', es: 'bucle de retroalimentación', def: 'El modelo se entrena con datos generados por sus propias recomendaciones y refuerza lo que ya mostraba.', say: 'Exploration traffic breaks the feedback loop.' },
      { en: 'nominator', es: 'nominador', def: 'Cada fuente de candidatos del embudo (two-tower, co-visitación, seguidos, frescos).', say: 'We added the neural model as a new nominator.' },
      { en: 'feature leakage', es: 'fuga de información en features', def: 'Una feature que contiene información posterior al momento de la predicción o que codifica la etiqueta.', say: 'The offline gain was feature leakage from the search page.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
