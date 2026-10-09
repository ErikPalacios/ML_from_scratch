/* =============================================================================
   Atlas de Arquitecturas — js/content/retrieval.js
   Página de modelo: dense retrieval — bi-encoder (Sentence-BERT, EMNLP 2019, arXiv:1908.10084; DPR, EMNLP 2020,
   arXiv:2004.04906), cross-encoder (reranker) y late interaction (ColBERT, SIGIR 2020, arXiv:2004.12832).
   Canónica dpr-bert-base. Plantilla fija de 11 secciones (SPEC §5.3, §23.2).
   Tesis de la fase (SPEC §23): "codificar una vez, comparar rápido". El bi-encoder embebe el corpus offline y compara por
   producto punto; el cross-encoder lee query y documento juntos (preciso, sin índice); ANN (ann.js) hace sublineal la búsqueda.
   Regla: ningún número de la arquitectura se escribe a mano: MACs de codificación, de reranking y bytes del índice salen del
   calculador (js/arch/retrieval.js, cantidades {{config.ruta}}, SPEC §6.6). Recall/MRR/nDCG solo citados (tabla del paper).
   Estimaciones con est(). El diseño de sistema completo (feature store, logging, A/B) es de la Ronda de Diseño ML: aquí solo
   el modelo y sus costos. Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/retrieval.js, SPEC §23.2).
  const C = 'dpr-bert-base';            // canónica: dos torres BERT-base, [CLS], 768-d, producto punto
  const SB = 'sbert-minilm';            // all-MiniLM-L6-v2: 6 capas, 384, mean pooling
  const CE = 'cross-encoder-minilm';    // ms-marco-MiniLM-L6-v2: query y documento juntos
  const CB = 'colbert-v2';              // BERT-base, 128-d por token, MaxSim
  const BB = 'bert-base';               // el encoder (bert.js)

  // Claves de metrics() del calculador: un solo lugar para adaptarlas.
  const MK = {
    qEnc: 'queryEncodeMacs', dEnc: 'docEncodeMacs', corpus: 'corpusEncodeMacs', ce: 'crossEncoderMacsPerPair',
    rerank: 'rerankMacs', idx: 'embeddingIndexBytes', colIdx: 'colbertIndexBytes', colV2: 'colbertV2IndexBytes', colV2Vec: 'colbertV2BytesPerVector',
    brute: 'bruteForceMacs', bruteBytes: 'bruteForceBytes', bruteGpu: 'bruteForceMsH100', bruteCpu: 'bruteForceMsCpu',
    online: 'onlineMacsPerQuery', rerankShare: 'rerankShareOnline', rerankMs: 'rerankMs', qMs: 'queryEncodeMs', corpusMs: 'corpusEncodeMs',
    crossVsBi: 'crossVsBiPerQuery', fullScan: 'crossEncoderFullScanMacs', qVsD: 'queryVsDocEncode', tokVecs: 'tokenVectors', maxsim: 'maxsimMacsPerDoc',
  };
  // Ids de tensores del calculador (contrato con retrieval-overview / bi-vs-cross / colbert-maxsim y el trace).
  const T = {
    qIds: 'q-ids', qTok: 'q-x-out', qVec: 'q-emb', dIds: 'd-ids', dTok: 'd-x-out', dVec: 'd-emb',
    index: 'doc-index', scores: 'doc-scores', topk: 'topk-ids', rIds: 'r-ids', rScore: 'r-score', reranked: 'rerank-scores', results: 'results',
    pair: 'ids', pairTok: 'x-out', ceScore: 'score',                       // config cross-encoder-minilm
    cq: 'q-emb', cd: 'd-emb', sim: 'sim', simMax: 'sim-max', maxsim: 'score', // config colbert-v2
  };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const sh = (id, cfg) => qn('tensor.' + (T[id] || id) + '.shape', cfg);

  const SBERT = 'Reimers y Gurevych, <i>Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks</i>, EMNLP 2019, arXiv:1908.10084';
  const DPR = 'Karpukhin et al., <i>Dense Passage Retrieval for Open-Domain Question Answering</i>, EMNLP 2020, arXiv:2004.04906';
  const COLBERT = 'Khattab y Zaharia, <i>ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT</i>, SIGIR 2020, arXiv:2004.12832';
  const COLBERT2 = 'Santhanam et al., <i>ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction</i>, NAACL 2022, arXiv:2112.01488';
  const BEIR = 'Thakur et al., <i>BEIR: A Heterogeneous Benchmark for Zero-shot Evaluation of Information Retrieval Models</i>, NeurIPS 2021 (Datasets and Benchmarks), arXiv:2104.08663';
  const MSMARCO = 'Bajaj et al., <i>MS MARCO: A Human Generated MAchine Reading COmprehension Dataset</i>, arXiv:1611.09268 (2016)';
  const CPC = 'van den Oord, Li y Vinyals, <i>Representation Learning with Contrastive Predictive Coding</i>, arXiv:1807.03748 (2018)';
  const ANCE = 'Xiong et al., <i>Approximate Nearest Neighbor Negative Contrastive Learning for Dense Text Retrieval</i> (ANCE), ICLR 2021, arXiv:2007.00808';
  const ROCKET = 'Qu et al., <i>RocketQA: An Optimized Training Approach to Dense Passage Retrieval for Open-Domain Question Answering</i>, NAACL 2021, arXiv:2010.08191';
  const GRADCACHE = 'Gao et al., <i>Scaling Deep Contrastive Learning Batch Size under Memory Limited Setup</i> (GradCache), RepL4NLP 2021, arXiv:2101.06983';
  const E5 = 'Wang et al., <i>Text Embeddings by Weakly-Supervised Contrastive Pre-training</i> (E5), arXiv:2212.03533 (2022)';
  const BGE = 'Xiao et al., <i>C-Pack: Packed Resources For General Chinese Embeddings</i> (BGE), SIGIR 2024, arXiv:2309.07597';
  const GTE = 'Li et al., <i>Towards General Text Embeddings with Multi-stage Contrastive Learning</i> (GTE), arXiv:2308.03281 (2023)';
  const MTEB = 'Muennighoff et al., <i>MTEB: Massive Text Embedding Benchmark</i>, EACL 2023, arXiv:2210.07316';
  const MRL = 'Kusupati et al., <i>Matryoshka Representation Learning</i>, NeurIPS 2022, arXiv:2205.13147';
  const SPLADE = 'Formal, Piwowarski y Clinchant, <i>SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking</i>, SIGIR 2021, arXiv:2107.05720';
  const CONTRIEVER = 'Izacard et al., <i>Unsupervised Dense Information Retrieval with Contrastive Learning</i> (Contriever), TMLR 2022, arXiv:2112.09118';
  const RRF = 'Cormack, Clarke y Büttcher, <i>Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods</i>, SIGIR 2009';
  const MINILM_CARD = 'tarjeta del modelo <code>cross-encoder/ms-marco-MiniLM-L6-v2</code> (sentence-transformers), medido en una V100';
  const ALLMINI_CARD = 'tarjeta del modelo <code>sentence-transformers/all-MiniLM-L6-v2</code>';

  ATLAS.register({
    id: 'retrieval',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> dada una consulta y un corpus de N documentos, devolver los k más relevantes, ordenados. Un <b>bi-encoder</b> convierte cada texto en un vector de ${cf('dim')} números por separado, así que los ${est('millones')} de documentos se codifican <b>una sola vez, offline</b>, y una consulta nueva solo cuesta un forward de BERT más una búsqueda por producto punto en un índice. Un <b>cross-encoder</b> lee consulta y documento juntos y da un score más preciso, pero cuesta un forward por par: solo sirve para <b>reordenar</b> unos pocos candidatos.` },
          { t: 'p', html: R`En producción se usan en cascada: el bi-encoder (y casi siempre BM25 en paralelo) trae los mejores ${cf('k')} candidatos de entre millones en milisegundos, y el cross-encoder los reordena. Es el embudo de la búsqueda semántica y de la etapa de "retrieval" de RAG. La canónica del calculador es DPR (${DPR}): dos BERT-base, el vector del [CLS] como embedding y producto punto.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Retrieval denso?', 'Por qué'], rows: [
            ['Búsqueda por significado: la consulta y el documento usan palabras distintas ("auto no arranca" ↔ "falla del motor de arranque")', 'Sí', 'El embedding captura sinónimos y paráfrasis que BM25 no ve.'],
            ['Retrieval para RAG sobre documentación interna', 'Sí, híbrido con BM25 y con reranker', 'Lo denso trae paráfrasis; BM25, los nombres y códigos exactos; el cross-encoder ordena lo que entra al prompt.'],
            ['Buscar identificadores exactos: SKUs, códigos de error, nombres propios raros', 'No solo', 'Un vector de 768 números no garantiza el match exacto de "E-4021": BM25 o un filtro por campo sí.'],
            ['Dominio muy distinto del de entrenamiento y sin datos para ajustar', 'Con cuidado', R`Zero-shot, los bi-encoders entrenados en MS MARCO pueden quedar por debajo de BM25 (${BEIR}): mide antes.`],
            ['Corpus chico (miles de documentos) y pocas consultas', 'Sí, sin ANN', 'Fuerza bruta sobre todos los vectores (o incluso un cross-encoder sobre todo) es barato y exacto.'],
            ['Necesitas una explicación de por qué salió un documento', 'Mejor lexical o ColBERT', 'Un producto punto de dos vectores no dice qué palabras coincidieron; ColBERT y BM25 sí.'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"A bi-encoder embeds queries and documents independently, so the whole corpus is encoded offline and indexed with approximate nearest neighbor search, and a query costs one encoder pass plus a vector lookup. A cross-encoder feeds the query and document together through one transformer, so attention can compare every query token with every document token; it is much more accurate but needs one forward pass per pair and has no index. Production systems retrieve a few hundred candidates with the bi-encoder, usually fused with BM25, and rerank the top ones with a cross-encoder."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como CLIP, pero con texto en las dos torres; como un detector de dos etapas, pero buscando documentos.</b> De <a href="#clip">CLIP</a> ya conoces todo el mecanismo de entrenamiento: dos encoders, embeddings normalizados, la matriz de similitudes del batch y una InfoNCE donde los otros B−1 pares son los negativos. Un bi-encoder de texto es eso con una consulta en una torre y un pasaje en la otra. Y de detección conoces el embudo: un detector de dos etapas (Faster R-CNN) propone cientos de regiones con una red barata y una cabeza cara clasifica solo esas. Retrieval hace lo mismo: el bi-encoder propone, el cross-encoder decide.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de retrieval', head: ['Concepto', 'Donde ya lo viste', 'En retrieval', '¿Nuevo?'], rows: [
            ['Dos torres, un espacio común', 'CLIP: imagen y texto', 'Query y documento (DPR: dos BERT; SBERT: el mismo BERT para los dos)', 'Igual'],
            ['Pérdida', 'CLIP: InfoNCE simétrica con temperatura aprendida', R`InfoNCE con in-batch negatives (B−1 por query) + <b>hard negatives</b> minados (BM25)`, 'Hard negatives: <b>nuevo</b>'],
            ['Embedding de un texto', 'CLIP: el token EOT proyectado', '[CLS] (DPR) o el promedio de los tokens (SBERT)', 'Equivale'],
            ['Precalcular un lado', 'CLIP zero-shot: los textos de las clases', 'Todo el corpus, offline, en un índice ANN', 'Igual, a escala'],
            ['Embudo barato → caro', 'Detector de dos etapas: propuestas → cabeza', 'Bi-encoder + BM25 → cross-encoder sobre los top-k', 'Equivale'],
            ['Métrica', 'mAP (precisión promedio sobre el ranking de detecciones)', 'Recall@k, MRR@10, nDCG@10: métricas del ranking', 'Parecida'],
            ['Interacción entre los dos textos', 'CLIP: ninguna antes del producto punto', R`Cross-encoder: atención completa entre query y documento; ColBERT: interacción tardía token a token`, '<b>Nuevo</b>'],
          ] },
          { t: 'h3', text: 'Por qué no sirve el [CLS] de BERT tal cual' },
          { t: 'p', html: R`La tentación: tomar <a href="#bert">BERT</a> preentrenado, sacar el [CLS] de cada texto y comparar por coseno. Sentence-BERT (${SBERT}) lo midió en siete tareas de similitud semántica (STS): Spearman promedio <b>29.19</b> con el [CLS], 54.81 promediando los tokens de BERT y 61.32 promediando vectores de GloVe (Tabla 1). Peor que un modelo de 2014 sin contexto. La razón: el [CLS] se entrenó para NSP, nada en el preentrenamiento pide que dos frases parecidas den vectores cercanos, y los vectores contextuales de BERT ocupan un cono estrecho donde casi todo tiene coseno alto. El arreglo de SBERT: BERT en una red siamesa, mean pooling, y un fine-tuning con pares etiquetados (NLI); DPR y los modelos actuales usan directamente la pérdida contrastiva.` },
          { t: 'h3', text: 'Y por qué no un cross-encoder para todo' },
          { t: 'p', html: R`Con BERT como cross-encoder ("[CLS] frase A [SEP] frase B [SEP]" → score), encontrar el par más parecido entre 10,000 frases son n(n−1)/2 = 49,995,000 forwards: ${est('≈ 65 horas')} en una V100, según SBERT (§1). Con un bi-encoder: 10,000 forwards (${est('≈ 5 s')}) y una matriz de cosenos (${est('≈ 0.01 s')}). La misma cuenta, para búsqueda: un cross-encoder sobre un corpus de N documentos son N forwards <b>por consulta</b>; un bi-encoder, N forwards <b>una vez</b> y después uno por consulta.` },
          { t: 'callout', kind: 'connect', html: R`<p>El índice que hace sublineal la búsqueda sobre millones de vectores (HNSW, IVF-PQ) está en <a href="#ann">búsqueda ANN</a>. El mismo patrón de dos torres, con usuarios e ítems en lugar de consultas y documentos, es el <a href="#two-tower">two-tower de recomendación</a> (próximamente). El diseño del sistema completo (logging, frescura del índice, A/B tests) es materia de la Ronda de Diseño ML; aquí, el modelo y sus costos.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Dos carriles. Arriba, <b>offline</b>: cada documento del corpus pasa una vez por el encoder de documentos y su vector va al índice. Abajo, <b>online</b>, por cada consulta: el encoder de consultas da un vector, la búsqueda devuelve los ${cf('k')} más cercanos por producto punto (exacta en el calculador; con un índice ANN en producción), el cross-encoder los reordena leyendo consulta y documento juntos, y salen los resultados. "Recorrido" sigue una consulta con números.` },
          { t: 'archdiagram', diagram: 'retrieval-overview', walk: 'forward', wide: true, caption: R`DPR con BERT-base: embeddings de ${cf('dim')} dimensiones, producto punto, top-${cf('k')} reordenado por un cross-encoder. Formas del calculador.` },
          { t: 'p', html: R`<b>Bi-encoder contra cross-encoder</b>, uno al lado del otro: en el bi-encoder, la consulta y el documento no se ven hasta el producto punto final; en el cross-encoder entran como una sola secuencia, y cada token de la consulta atiende a cada token del documento en todas las capas.` },
          { t: 'archdiagram', diagram: 'bi-vs-cross', caption: 'Bi-encoder (dos pasadas independientes, un producto punto) contra cross-encoder (una pasada sobre el par, una cabeza de score).' },
          { t: 'p', html: R`<b>ColBERT</b>, el punto medio: guarda un vector <b>por token</b> del documento (offline, como el bi-encoder) y compara cada token de la consulta con su token más parecido del documento (MaxSim).` },
          { t: 'archdiagram', diagram: 'colbert-maxsim', caption: 'Late interaction: matriz de similitudes token a token, máximo por fila de la consulta, suma.' },
          { t: 'p', html: R`<b>El espacio de embeddings, en 2-D.</b> Gira la consulta y mira el ranking; activa el negativo difícil y la normalización. En el modo lote, la matriz B×B de un batch con in-batch negatives y la pérdida por fila.` },
          { t: 'viz', kind: 'embedding-space', params: { mode: 'rank', query: 0, norm: 1, hard: 1, k: 3 }, caption: 'Juguete 2-D, sintético: los embeddings reales tienen cientos de dimensiones. El documento "popular" de norma grande muestra por qué se normaliza (o se entrena con producto punto sabiendo lo que implica).' },
          { t: 'viz', kind: 'embedding-space', params: { mode: 'batch', hard: 1, tau: 0.05 }, caption: 'In-batch negatives: cada fila es una consulta, la diagonal es su positivo, las otras columnas son los positivos de las demás consultas (y, opcional, un hard negative por consulta). τ = 0.05 equivale a la escala 20 de sentence-transformers.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación. Consulta: "who wrote the origin of species" (${cf('Tq')} tokens con [CLS] y [SEP], con padding). Pasa por el encoder de consultas (BERT-base) y se queda con el vector del [CLS]: ${cf('dim')} números. Cada pasaje de Wikipedia (${cf('Td')} tokens) se codificó antes con el encoder de pasajes, otro BERT-base, y su [CLS] está guardado. El score de cada pasaje es el producto punto de los dos vectores: ${cf('dim')} multiplicaciones y sumas. El pasaje sobre Darwin queda primero no porque comparta palabras, sino porque el entrenamiento llevó la pregunta y su respuesta al mismo lugar del espacio.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            [R`T<sub>q</sub>, T<sub>d</sub>`, 'tokens de la consulta y del documento (con [CLS] y [SEP])', R`${cf('Tq')}, ${cf('Td')}`],
            ['E', 'dimensión del embedding (dim en el calculador)', cf('dim')],
            ['N', 'documentos del corpus', cf('N')],
            ['k', 'candidatos que el cross-encoder reordena', cf('k')],
            ['B', 'consultas por batch de entrenamiento (B−1 negativos in-batch)', '128 en DPR (§5.2)'],
            ['τ', 'temperatura de la InfoNCE (DPR: sin temperatura, τ = 1)', '—'],
            ['b', 'bits por número del índice (32 / 16 / 8 / 1)', cf('bits')],
          ] },

          { t: 'h3', text: 'Bi-encoder: dos pasadas independientes' },
          { t: 'op', block: 'query-encoder', model: 'retrieval', title: 'Encoder de consultas y pooling',
            tex: R`\mathbf{q} = \mathrm{pool}\big(\mathrm{BERT}_Q(\text{query})\big)\in\mathbb{R}^{E},\qquad \mathrm{pool} \in \{\,\mathbf{h}_\text{[CLS]}\ \text{(DPR)},\ \tfrac{1}{T}\textstyle\sum_i \mathbf{h}_i\ \text{(SBERT)}\,\}`,
            in: [T.qIds], out: [T.qVec], params: true, flops: true,
            what: R`Un forward de BERT-base sobre los ${cf('Tq')} tokens: ${sh('qIds')} → ${sh('qTok')} → ${sh('qVec')}. Es el único cómputo de modelo que se paga por consulta en la etapa de retrieval: ${met('qEnc')}.`,
            why: R`El pooling decide qué vector representa al texto. DPR usa el [CLS], que el entrenamiento contrastivo vuelve útil; SBERT probó MEAN, MAX y CLS y eligió MEAN (Tabla 6: 80.78 / 79.07 / 79.80 en NLI). El mean pooling tiene que ignorar el padding (promedio pesado por la attention mask): un bug común es promediar también los [PAD].` },
          { t: 'op', block: 'doc-encoder', model: 'retrieval', title: 'Encoder de documentos (offline)',
            tex: R`\mathbf{d}_j = \mathrm{pool}\big(\mathrm{BERT}_D(\text{doc}_j)\big)\in\mathbb{R}^{E},\qquad j = 1\ldots N`,
            in: [T.dIds], out: [T.dVec], params: true, flops: true,
            what: R`El mismo cálculo sobre ${cf('Td')} tokens: ${sh('dIds')} → ${sh('dVec')}, ${met('dEnc')} por documento, y ${met('corpus')} para los ${cf('N')} documentos del corpus. Se hace una vez (y otra vez cada vez que cambias el modelo).`,
            why: R`DPR usa <b>dos</b> BERT-base independientes (uno para preguntas, otro para pasajes, §3.1): las consultas son cortas y con forma de pregunta, los pasajes largos y declarativos. SBERT y la mayoría de los modelos actuales comparten un solo encoder (siamés) y marcan el rol con un prefijo ("query: " / "passage: " en E5). Compartir pesos ahorra la mitad de los parámetros; separar da más capacidad para la asimetría.` },
          { t: 'op', block: 'ann-search', model: 'retrieval', title: 'Score: producto punto (o coseno)',
            tex: R`s(q, d_j) = \mathbf{q}^\top \mathbf{d}_j,\qquad \text{coseno si } \|\mathbf{q}\| = \|\mathbf{d}_j\| = 1`,
            in: [T.qVec, T.index], out: [T.scores], flops: true,
            what: R`${sh('qVec')} contra el índice ${sh('index')}: ${sh('scores')} puntajes, ${met('brute')} por consulta (N·E), y después el top-${cf('k')} (${sh('topk')}). Con un índice ANN (<a href="#ann">HNSW o IVF-PQ</a>), solo una fracción.`,
            why: R`Que el score sea un producto punto de dos vectores calculados por separado es <b>lo que permite el índice</b>: maximizar qᵀd sobre N vectores fijos es un problema de búsqueda de vecinos (maximum inner product search). DPR usa el producto punto sin normalizar; en su ablación, producto punto y L2 rinden parecido y el coseno queda algo abajo (App. B). Muchos modelos actuales normalizan y usan coseno, con una temperatura chica en el entrenamiento (sentence-transformers: escala 20, τ = 0.05).` },
          { t: 'callout', kind: 'trap', title: '"Coseno y producto punto dan el mismo ranking"', html: R`<p>Solo si los vectores tienen norma 1. Si el modelo se entrenó con producto punto sin normalizar (DPR), la norma del documento es parte del score: un documento "popular" de norma grande gana consultas que no responde (lo puedes ver en la viz). Si lo entrenaron con coseno y lo indexas con producto punto sin normalizar, el ranking cambia. Regla: usa la métrica con la que se entrenó, y si normalizas, coseno = producto punto y = −½·L2² + 1 (los tres dan el mismo orden).</p>` },

          { t: 'h3', text: 'Entrenamiento: InfoNCE con in-batch negatives' },
          { t: 'math', display: true, tex: R`\mathcal{L} = -\frac{1}{B}\sum_{i=1}^{B}\log\frac{e^{s(q_i,\,d_i^+)/\tau}}{\displaystyle\sum_{j=1}^{B} e^{s(q_i,\,d_j^+)/\tau} \;+\; \sum_{j=1}^{B} e^{s(q_i,\,d_j^-)/\tau}}`, caption: R`DPR (§3.2): la fila i tiene su positivo, los B−1 positivos de las otras consultas como negativos (in-batch) y, opcional, un hard negative por consulta (de BM25), que también sirve de negativo a todas las demás: 2B−1 negativos por fila. La matriz de scores es B×2B. Es la InfoNCE de ${CPC}, la misma de <a href="#clip.operaciones">CLIP</a> (allí simétrica).` },
          { t: 'p', html: R`Con B = 128 (el batch de DPR), cada consulta ve 127 negativos in-batch "gratis": sus vectores ya se calcularon para ser positivos de otras filas, así que solo cuesta la matriz B×B de productos punto. Por qué importa el tamaño del batch: más negativos hacen la tarea más difícil y el gradiente más informativo, y aumentan la probabilidad de que aparezca un negativo parecido. En DPR (Tabla 3, top-20 en NQ dev): 69.1 % con 7 negativos in-batch, 70.8 % con 31, 73.0 % con 127, y <b>77.3 %</b> al agregar un solo hard negative de BM25 por consulta. Un buen negativo difícil vale más que cuadruplicar el batch.` },
          { t: 'callout', kind: 'trap', title: '"Más negativos al azar es igual que hard negatives"', html: R`<p>No. Un negativo al azar de un corpus grande es casi siempre trivial (otro tema): el modelo lo separa en las primeras horas y después no aporta gradiente. Un hard negative (un pasaje que BM25 pone arriba porque comparte palabras, pero no responde) obliga a aprender lo que BM25 no sabe. Su riesgo: el <b>falso negativo</b>, un pasaje que sí responde pero no está etiquetado; entrenar a separarlo enseña lo contrario. RocketQA (${ROCKET}) filtra los hard negatives con un cross-encoder por eso.</p>` },

          { t: 'h3', text: 'Cross-encoder: una pasada sobre el par' },
          { t: 'op', block: 'joint-encoder', model: 'retrieval', title: 'Query y documento juntos, un score',
            tex: R`s(q, d) = \mathbf{w}^\top \mathbf{h}_\text{[CLS]}\Big(\mathrm{BERT}\big([\text{CLS}]\ q\ [\text{SEP}]\ d\ [\text{SEP}]\big)\Big) + b`,
            in: [T.pair], out: [T.ceScore], params: true, flops: true, config: CE,
            what: R`Una secuencia de T<sub>q</sub> + T<sub>d</sub> − 1 tokens (un solo [CLS] y los dos [SEP]), ${sh('pair', CE)} → ${sh('ceScore', CE)}: ${met('ce', CE)} por par con T<sub>d</sub> = ${cf('Td', CE)}; reordenar ${cf('k', CE)} candidatos son ${met('rerank', CE)} por consulta.`,
            why: R`La atención cruza cada token de la consulta con cada token del documento en <b>todas</b> las capas: puede ver que "no" niega la frase, que la fecha coincide, que el sujeto es otro. El bi-encoder comprime cada texto en un vector antes de compararlos y pierde esos detalles. El precio: no hay nada que precalcular, porque el vector del documento depende de la consulta.` },

          { t: 'h3', text: 'ColBERT: late interaction' },
          { t: 'op', block: 'maxsim', model: 'retrieval', title: 'MaxSim: el mejor token del documento para cada token de la consulta',
            tex: R`s(q, d) = \sum_{i=1}^{T_q}\ \max_{j=1\ldots T_d}\ \mathbf{q}_i^\top \mathbf{d}_j,\qquad \mathbf{q}_i, \mathbf{d}_j \in \mathbb{R}^{128},\ \|\cdot\| = 1`,
            in: [T.cq, T.cd], out: [T.maxsim], flops: true, config: CB,
            what: R`Los vectores por token de la consulta (${sh('cq', CB)}) contra los del documento (${sh('cd', CB)}): matriz ${sh('sim', CB)}, máximo por fila, suma. Los vectores del documento se calculan offline, como en el bi-encoder; sin parámetros en la interacción (§3.3): ${met('maxsim', CB)} por documento.`,
            why: R`Conserva el detalle por token que el bi-encoder pierde, sin pagar un forward por par como el cross-encoder. La consulta se rellena con [MASK] hasta 32 tokens ("query augmentation") y los signos de puntuación del documento se descartan. El costo se mueve a la <b>memoria</b>: un vector por token en vez de uno por documento (${met('colIdx', CB)} en fp16 para MS MARCO en el calculador; ver <a href="#retrieval.costo">costo</a>). En MS MARCO, ColBERT reordenando el top-1000 de BM25 da MRR@10 34.9 en 61 ms contra 36.0 de un BERT-base cross-encoder en 10,700 ms (Tabla 1): 170× más rápido y 13,900× menos FLOPs.` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de la canónica (una consulta y un documento). Toca una fila para resaltarla en el diagrama.` },
          { t: 'trace', model: 'retrieval' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`DPR son dos BERT-base sin pooler ni cabezas (${qn('quantities.biEncoderParams')} parámetros) y el reranker MiniLM del calculador suma ${qn('quantities.rerankerParams')}: ${qn('params.total')} en total. Pero en retrieval lo que importa no es el tamaño sino <b>dónde</b> se paga cada cosa: offline una vez por documento, online una vez por consulta y online una vez por par. Las tablas suman un camino completo: una consulta, <b>un</b> documento codificado, la búsqueda exacta sobre los N vectores y el rerank de k pares.` },
          { t: 'params', model: 'retrieval', group: 'block' },
          { t: 'flops', model: 'retrieval' },
          { t: 'calc', title: R`Dónde se paga el cómputo (calculador; N = ${cf('N')} pasajes de Wikipedia, k = ${cf('k')})`, rows: [
            { label: 'Offline: codificar el corpus', expr: R`N × ${met('dEnc')} por pasaje (T<sub>d</sub> = ${cf('Td')})`, value: met('corpus'), note: R`${est('≈ 16 min')} en una H100 a pico (cota); DPR midió 8.8 h con 8 GPUs (§5.4)` },
            { label: 'Online: codificar la consulta', expr: R`un forward de T<sub>q</sub> = ${cf('Tq')} tokens: ${met('qVsD')} veces más barato que un pasaje`, value: met('qEnc') },
            { label: 'Online: fuerza bruta sobre el índice', expr: R`N × E productos; hay que leer ${met('bruteBytes')}`, value: met('brute'), note: R`cota ≈ ${met('bruteGpu')} ms en una H100 y ${met('bruteCpu')} ms en una CPU EPYC: limitada por memoria` },
            { label: R`Online: reordenar k = ${cf('k')} pares con el cross-encoder MiniLM`, expr: R`k × un forward de T<sub>q</sub> + T<sub>d</sub> − 1 tokens`, value: met('rerank'), note: R`${met('rerankShare')} de los MACs online` },
            { label: 'Cross-encoder sobre todo el corpus (no se hace)', expr: 'N × un forward del par, por cada consulta', value: met('fullScan'), note: R`${met('crossVsBi')} veces el costo online del bi-encoder` },
          ], result: R`La consulta cuesta poco (es corta); el reranker cuesta k pares por consulta y con k = ${cf('k')} ya es ${met('rerankShare')} de los MACs del camino online. Por eso k es la perilla de latencia más importante, y por eso el reranker es un modelo chico (6 capas de 384) y no un BERT-base. Las cotas en ms son de roofline (pico de la hoja de datos, sin overhead): la realidad es varias veces más lenta, como muestran las 8.8 h de DPR.` },
          { t: 'h3', text: 'La memoria del índice' },
          { t: 'p', html: R`Un vector por documento: N × E × b/8 bytes. Con la canónica (${cf('dim')} dimensiones en fp32, ${cf('dim')} × 4 bytes por vector), ${met('idx')}. Cambia los bits y la dimensión en el explorador: es la cuenta que decide si el índice cabe en la RAM de una máquina.` },
          { t: 'scaling', model: 'retrieval', knobs: [{ key: 'N', values: [1000000, 21015324, 100000000, 1000000000] }, { key: 'dim', values: [128, 256, 384, 768] }, { key: 'bits', values: [32, 16, 8, 1] }], show: ['embeddingIndexBytes', 'bruteForceMacs', 'bruteForceMsH100', 'corpusEncodeMacs'] },
          { t: 'p', html: R`Y el lado online: cuántos candidatos reordenar y qué tan largos son los documentos.` },
          { t: 'scaling', model: 'retrieval', knobs: [{ key: 'k', values: [10, 20, 100, 1000] }, { key: 'Td', values: [64, 128, 180, 256] }], show: ['rerankMacs', 'crossEncoderMacsPerPair', 'docEncodeMacs', 'rerankShareOnline'] },
          { t: 'calc', title: 'Un índice de 100 millones de documentos (a mano, la misma fórmula)', rows: [
            { label: '768 dimensiones, fp32', expr: '10⁸ × 768 × 4 bytes', value: est('≈ 307 GB') },
            { label: '768, fp16', expr: '× 2 bytes', value: est('≈ 154 GB') },
            { label: '768, int8 (scalar quantization)', expr: '× 1 byte', value: est('≈ 77 GB') },
            { label: '768, binario (1 bit por dimensión)', expr: '× 1/8 byte', value: est('≈ 9.6 GB') },
            { label: '256 dimensiones (Matryoshka), fp16', expr: '10⁸ × 256 × 2', value: est('≈ 51 GB') },
            { label: 'IVF-PQ con 96 bytes por vector', expr: '10⁸ × 96', value: est('≈ 9.6 GB') },
          ], result: R`Más el grafo o las listas del índice ANN (<a href="#ann">ANN</a>). La compresión no es gratis: bajar bits o dimensiones pierde recall, y la práctica estándar es buscar con los vectores comprimidos y <b>re-puntuar</b> los mejores cientos con los vectores completos (guardados en disco o en otra máquina).` },
          { t: 'callout', kind: 'senior', html: R`<p>La cuenta que un entrevistador quiere ver para fuerza bruta: 10⁸ documentos × 768 = ${est('7.7 × 10¹⁰')} MACs por consulta. En cómputo, una H100 lo haría en ${est('≈ 0.2 ms')}; pero hay que <b>leer</b> 154 GB en fp16 por cada consulta: a 3.35 TB/s son ${est('≈ 46 ms')}, y además no caben en sus 80 GB. Con la canónica (21M en fp32) el calculador da la misma conclusión: ${met('bruteGpu')} ms de cota, limitada por memoria. La búsqueda exhaustiva está limitada por bytes, no por FLOPs: por eso ANN (visitar una fracción) y compresión (leer menos bytes) van juntas.</p>` },
          { t: 'h3', text: 'ColBERT: el índice por token' },
          { t: 'calc', title: R`ColBERTv2 sobre MS MARCO (${cf('N', CB)} pasajes; calculador con T<sub>d</sub> = ${cf('Td', CB)} vectores por pasaje)`, rows: [
            { label: 'Vectores de token', expr: R`N × T<sub>d</sub>`, value: met('tokVecs', CB) },
            { label: 'ColBERT (v1): fp16', expr: R`× 128 dimensiones × 2 bytes`, value: met('colIdx', CB), note: 'el paper mide 154 GiB (Tabla 4)' },
            { label: 'ColBERTv2: centroide + residuo de 2 bits', expr: R`× (128·2/8 + 4) = ${met('colV2Vec', CB)} por vector`, value: met('colV2', CB), note: 'el paper mide 25 GiB (§5.3)' },
            { label: 'Un vector por pasaje (bi-encoder de 128-d, fp16)', expr: 'N × 128 × 2', value: met('idx', CB) },
          ], result: R`El calculador asume que todos los pasajes llenan los ${cf('Td', CB)} tokens; los pasajes reales son más cortos y ColBERT descarta la puntuación: los 154 GiB medidos equivalen a ${est('≈ 73 vectores por pasaje')} en promedio. La conclusión no cambia: ColBERT guarda decenas de vectores por documento, y v2 los comprime ≈ 7× sin perder calidad.` },
          { t: 'compare', models: [C, SB, CE, CB], rows: ['params', 'L', 'D', 'dim', 'queryEncodeMacs', 'docEncodeMacs', 'crossEncoderMacsPerPair', 'bruteForceBytes', 'rerankMacs'], caption: R`Las cuatro configs del calculador: DPR (dos BERT-base), all-MiniLM-L6-v2 (un encoder siamés de 6 capas y 384, ${ALLMINI_CARD}), el cross-encoder MiniLM de MS MARCO y ColBERTv2 (BERT-base con vectores de 128 por token). "Bytes del índice" es lo que lee una búsqueda exhaustiva. Las dos primeras incluyen un rerank de k = ${cf('k')} pares con el cross-encoder.` },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 N → ×2 el costo offline, ×2 la memoria del índice y ×2 la fuerza bruta; con ANN, la búsqueda crece mucho menos que N. ×2 E → ×2 memoria y fuerza bruta, el encoder casi igual. ÷2 bits → ÷2 memoria. ×2 k → ×2 el reranker, que suele ser lo más caro online. ×2 T<sub>d</sub> → ≈ ×2 offline y ≈ ×2 por par en el reranker; ColBERT además ×2 de índice.` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La pérdida es la InfoNCE de <a href="#retrieval.operaciones">operaciones</a>; lo que separa un buen retriever de uno malo son <b>los datos de pares</b> y <b>los negativos</b>.` },
          { t: 'table', caption: 'Recetas que vas a citar', head: ['Modelo', 'Datos', 'Negativos y pérdida', 'Detalles', 'Fuente'], rows: [
            ['SBERT', 'SNLI + MultiNLI (≈ 1M pares de frases)', 'Softmax de 3 clases sobre (u, v, |u − v|); también triplet con margen 1', 'Batch 16, LR 2e-5, 1 época, warmup 10 %; mean pooling', R`${SBERT}, §3–4`],
            ['DPR', 'NQ, TriviaQA, WebQuestions, CuratedTREC, SQuAD sobre 21M pasajes de 100 palabras de Wikipedia', 'NLL del positivo; in-batch + 1 hard negative de BM25 por pregunta', 'Batch 128, LR 1e-5, hasta 40 épocas, dropout 0.1, dos encoders; con ≈ 1,000 ejemplos ya supera a BM25 (Fig. 1)', R`${DPR}, §3–5`],
            ['ColBERT', 'Tripletas (q, d⁺, d⁻) de MS MARCO', 'Softmax sobre los dos scores del par', 'Batch 32, LR 3e-6, 200K iteraciones', R`${COLBERT}, §4.1`],
            ['all-MiniLM-L6-v2', '≈ 1.17 mil millones de pares de varias fuentes', 'In-batch negatives con coseno', 'Batch 1,024, 100K pasos, secuencias de 128 tokens', ALLMINI_CARD],
            ['E5', 'CCPairs: ≈ 270M pares de la web filtrados, luego MS MARCO, NQ, NLI', 'Preentrenamiento contrastivo débil (batch 32K, τ = 0.01) + fine-tuning con hard negatives y destilación de un cross-encoder', 'Prefijos "query: " y "passage: "; primer modelo no supervisado que supera a BM25 en BEIR (42.9 vs 41.7 nDCG@10)', E5],
            ['ColBERTv2', 'MS MARCO', 'Destilación de un cross-encoder MiniLM (KL sobre tuplas de 64) con hard negatives del propio índice', 'Compresión residual a 1–2 bits por dimensión', COLBERT2],
          ] },
          { t: 'h3', text: 'Los negativos, de peor a mejor' },
          { t: 'list', ordered: true, items: [
            R`<b>Al azar</b>: baratos y casi siempre fáciles.`,
            R`<b>In-batch</b>: B−1 por consulta sin costo de encoder; su calidad sube con B. Si la memoria no deja subir B: GradCache (${GRADCACHE}) separa el cálculo de la pérdida del backward del encoder y logra batches grandes con memoria casi constante; RocketQA comparte negativos entre GPUs (cross-batch).`,
            R`<b>Hard negatives de BM25</b>: parecidos en palabras, no en significado (DPR: +4 puntos de top-20).`,
            R`<b>Hard negatives del propio modelo</b>: buscar con el retriever actual y tomar lo que pone arriba sin ser relevante. ANCE (${ANCE}) lo hace con un índice que se refresca durante el entrenamiento.`,
            R`<b>Filtrados o destilados</b>: un cross-encoder decide qué hard negatives son de verdad negativos (RocketQA) o da scores suaves que el bi-encoder imita (E5, ColBERTv2).`,
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué destilar de un cross-encoder', html: R`<p>El cross-encoder es más preciso pero no indexable; el bi-encoder es indexable pero menos preciso. Entrenar al bi-encoder para que reproduzca los scores del cross-encoder (no solo la etiqueta binaria de MS MARCO, que tiene un solo positivo por consulta y muchos relevantes sin etiquetar) le pasa información graduada sobre qué candidatos son "casi" buenos. Es lo que hacen las recetas que encabezan los benchmarks.</p>` },
          { t: 'h3', text: 'Embeddings Matryoshka' },
          { t: 'p', html: R`Matryoshka (${MRL}) suma la pérdida sobre prefijos anidados del vector (por ejemplo, las primeras 64, 128, 256, … dimensiones), así que un solo modelo da embeddings que se pueden <b>truncar</b> y siguen sirviendo. Uso típico: buscar con 256 dimensiones (÷3 de memoria y de cómputo frente a 768) y re-puntuar los mejores con el vector completo. El paper reporta hasta 14× menos dimensiones con la misma accuracy en clasificación de ImageNet y hasta 14× de aceleración real en retrieval a gran escala con esa búsqueda adaptativa.` },
          { t: 'callout', kind: 'trap', title: '"Trunco a 256 dimensiones cualquier modelo de embeddings"', html: R`<p>Solo si se entrenó con la pérdida Matryoshka (o lo dice su documentación). En un modelo normal, la información está repartida en todas las dimensiones y las primeras 256 no son un buen resumen; para achicar un modelo así, PCA sobre tus vectores o cuantización, y medir recall antes y después.</p>` },
          { t: 'h3', text: 'Cómo se evalúa' },
          { t: 'math', display: true, tex: R`\text{Recall@}k = \frac{|\text{relevantes} \cap \text{top-}k|}{|\text{relevantes}|},\qquad \text{MRR@}10 = \frac{1}{|Q|}\sum_{q}\frac{1}{\text{rank}_q}\ (0\ \text{si}\ \text{rank}_q > 10),\qquad \text{nDCG@}k = \frac{\sum_{i=1}^{k} \frac{2^{\text{rel}_i}-1}{\log_2(i+1)}}{\text{IDCG@}k}`, caption: 'Recall@k mide si el candidato está en el top-k (lo que necesita la etapa siguiente); MRR mira la posición del primer relevante; nDCG usa relevancia graduada y descuenta por posición, normalizado por el ranking ideal. El "top-20 accuracy" de DPR es un hit rate: ¿hay al menos un pasaje con la respuesta en el top-20?' },
          { t: 'table', caption: 'Benchmarks y números que vas a citar', head: ['Benchmark', 'Qué es', 'Números', 'Fuente'], rows: [
            ['MS MARCO passage', R`≈ 8.8M pasajes de Bing, ≈ 500K consultas de entrenamiento con ≈ 1 positivo etiquetado cada una; métrica MRR@10 en dev (6,980 consultas)`, R`BM25 16.7 · BERT-base cross-encoder 36.0 · ColBERT 36.0 (de punta a punta) · ColBERTv2 39.7 · cross-encoder MiniLM-L6 39.01 (reordenando, según su tarjeta)`, R`${MSMARCO}; ${COLBERT}, Tablas 1–2; ${COLBERT2}; ${MINILM_CARD}`],
            ['Natural Questions (DPR)', 'Preguntas reales de Google sobre 21M pasajes de Wikipedia; top-k accuracy', 'Top-20: BM25 59.1 · DPR 78.4 · BM25 + DPR 76.6', R`${DPR}, Tabla 2`],
            ['BEIR', '18 datasets de 9 tareas (bio-médico, finanzas, argumentos, fact-checking…), evaluados zero-shot con nDCG@10', 'Promedio relativo a BM25: DPR −47.7 % · ANCE −7.4 % · TAS-B −2.8 % · ColBERT +2.5 % · BM25 + cross-encoder +11 %', R`${BEIR}, Tabla 2`],
            ['MTEB', '8 tipos de tarea (retrieval, clustering, STS, clasificación, reranking…), 58 datasets, 112 idiomas', 'Ningún modelo gana en todas las tareas; el leaderboard cambia cada mes', MTEB],
          ] },
          { t: 'callout', kind: 'trap', title: '"El modelo número 1 del leaderboard de MTEB es el mejor para mi búsqueda"', html: R`<p>MTEB promedia tareas muy distintas, y el retrieval de tu dominio puede no parecerse a ninguna. Además, varios modelos se entrenan con datos de los mismos datasets de evaluación. BEIR mostró que el rendimiento en el dominio de entrenamiento no predice bien el zero-shot. La única medida que decide: recall@k y nDCG@10 en un set de consultas reales tuyas, con juicios de relevancia (aunque sean 200 consultas etiquetadas a mano o con un LLM revisado).</p>` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: las recetas exactas de cada modelo y los números de MS MARCO. Lo que no te puedes saltar: InfoNCE con B−1 negativos in-batch, el salto de DPR con un hard negative de BM25, el riesgo de falsos negativos, destilación del cross-encoder, y que BEIR muestra a BM25 como un baseline difícil fuera del dominio.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Offline: indexar', html: R`<p>Trocear los documentos (${est('≈ 200–500 tokens')} por trozo, con solapamiento), codificar cada trozo (${met('dEnc')} con DPR), guardar el vector y los metadatos (id, fuente, fecha, permisos) y construir el índice ANN. DPR tardó 8.8 horas en codificar 21M pasajes con 8 GPUs y 8.5 horas en construir el índice FAISS (§5.4).</p>` },
            { title: 'Online: codificar la consulta', html: R`<p>Un forward de ${cf('Tq')} tokens (${met('qEnc')}). Si usas un modelo con prefijos (E5: "query: "), el mismo prefijo que en el entrenamiento.</p>` },
            { title: 'Online: buscar candidatos', html: '<p>ANN sobre el índice denso y, en paralelo, BM25 sobre un índice invertido; fusionar (abajo). DPR busca a 995 preguntas por segundo con FAISS contra 23.7 por hilo de BM25 en Lucene (§5.4).</p>' },
            { title: 'Online: reordenar', html: R`<p>El cross-encoder sobre los top-k pares (${met('rerank')} con k = ${cf('k')} y pasajes de ${cf('Td')} tokens; cota ≈ ${met('rerankMs')} ms en una H100 a pico). La tarjeta del MiniLM-L6 reporta 1,800 documentos por segundo medidos en una V100: ${est('≈ 55 ms')} para 100 pares. La distancia entre la cota y lo medido (otra GPU, fp32, padding, kernels chicos) es la regla, no la excepción: mide en tu hardware. Es la etapa que más limita la latencia.</p>` },
            { title: 'Online: devolver o armar el prompt', html: '<p>Filtros de negocio y de permisos, deduplicar trozos casi iguales, y en RAG elegir cuántos trozos entran al contexto del LLM.</p>' },
          ] },
          { t: 'h3', text: 'Híbrido: BM25 + denso con Reciprocal Rank Fusion' },
          { t: 'math', display: true, tex: R`\text{RRF}(d) = \sum_{r\,\in\,\text{rankers}} \frac{1}{k_\text{rrf} + \text{rank}_r(d)},\qquad k_\text{rrf} = 60`, caption: R`${RRF}. Usa solo las posiciones, no los scores: no hay que calibrar BM25 contra cosenos. Un documento 1.º en BM25 y 30.º en denso suma 1/61 + 1/90; uno 5.º en los dos, 2/65 y queda arriba.` },
          { t: 'p', html: R`Por qué funciona: los errores de BM25 (sinónimos, paráfrasis) y los del denso (nombres raros, códigos, negación, fuera de dominio) son distintos. BEIR muestra que BM25 es un baseline difícil de vencer fuera del dominio; un híbrido casi nunca es peor que la mejor de sus partes. Matiz honesto: en NQ, el dominio de DPR, la combinación lineal BM25 + DPR del paper quedó <b>por debajo</b> de DPR solo en top-20 (76.6 contra 78.4, Tabla 2). Fusionar no es gratis: mídelo.` },
          { t: 'table', caption: 'Trucos de inferencia', head: ['Truco', 'Qué gana', 'Qué cuesta'], rows: [
            ['Cuantizar el índice (int8, binario) + re-puntuar', '4–32× menos memoria y lectura', 'Recall: medir; re-puntuar los mejores cientos con los vectores completos'],
            ['Dimensiones Matryoshka (truncar)', 'Memoria y búsqueda proporcionales a la dimensión', 'Solo en modelos entrenados así'],
            ['Cachear embeddings de consultas frecuentes', 'Sin forward para las consultas repetidas', 'Invalidar al cambiar el modelo'],
            ['Reranker chico y k chico', 'La mayor palanca de latencia online', 'Recall del reranker limitado a esos k'],
            ['Destilar el reranker al bi-encoder', 'Mejor primera etapa, menos k', 'Reentrenar y re-indexar'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Cambio el modelo de embeddings en producción y listo"', html: R`<p>Los vectores de dos modelos viven en espacios distintos: una consulta codificada con el modelo nuevo contra un índice del modelo viejo da basura, sin ningún error. Cambiar de modelo es <b>re-indexar todo el corpus</b> (${met('corpus')} offline con la canónica) y desplegar consulta e índice juntos, con versión. Lo mismo al cambiar el troceado o el prefijo.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Desajuste léxico al revés: términos exactos.</b> El embedding resume el significado, y los tokens raros (SKUs, códigos de error, nombres de productos nuevos, números de versión) casi no lo mueven: "error E-4021" y "error E-4012" quedan casi en el mismo punto. Arreglo: híbrido con BM25, filtros por campo, o SPLADE (pesos por término del vocabulario).`,
            R`<b>Fuera del dominio.</b> En BEIR, un DPR entrenado en NQ queda 47.7 % por debajo de BM25 en promedio y no le gana en ninguno de los 18 datasets zero-shot; los bi-encoders entrenados en MS MARCO quedan cerca de BM25, y BM25 + cross-encoder es lo más robusto (+11 %). Ojo con la evaluación misma: los juicios de BEIR vienen de sistemas léxicos y favorecen a BM25 (en TREC-COVID, anotar los documentos que faltaban subió a ANCE de 0.654 a 0.735 nDCG@10, por encima de BM25). Arreglo: medir en tu dominio, adaptar con pares sintéticos (un LLM genera preguntas para tus documentos) o con preentrenamiento contrastivo en tu corpus.`,
            R`<b>Documentos largos y troceado.</b> Un vector de ${cf('dim')} números para un documento de 20 páginas promedia demasiado; y el encoder trunca en 512 tokens (all-MiniLM-L6-v2 en 256, y se entrenó con 128). Arreglo: trozos de unos cientos de tokens con solapamiento, con el título o la sección pegados al trozo para que no pierda contexto, y agregar por documento al final. Trozos demasiado chicos pierden contexto; demasiado grandes, precisión.`,
            R`<b>Negación y detalles finos.</b> "Medicamentos que <b>no</b> se deben tomar con alcohol" queda cerca de "medicamentos que se toman con alcohol": casi todas las palabras coinciden y el bi-encoder comprime la frase en un vector. El cross-encoder lo maneja mucho mejor porque la atención ve el "no" junto al resto.`,
            R`<b>Falsos negativos en el entrenamiento y en la evaluación.</b> MS MARCO etiqueta ≈ 1 positivo por consulta; muchos pasajes relevantes están sin etiquetar, se usan como negativos y castigan respuestas correctas en la métrica.`,
            R`<b>Asimetría de consulta y documento.</b> Consultas de 3 palabras contra pasajes de 200: un encoder simétrico entrenado con pares de frases parecidas (STS) rinde peor que uno entrenado con pares pregunta–pasaje. Por eso DPR usa dos encoders y E5 usa prefijos distintos.`,
          ] },
          { t: 'table', caption: 'Familias de retrieval (filas = criterios)', head: ['Criterio', 'BM25', 'Bi-encoder (DPR, E5)', 'SPLADE', 'ColBERT(v2)', 'Cross-encoder'], rows: [
            ['Qué se indexa', 'Índice invertido de términos', 'Un vector por documento', 'Índice invertido con pesos aprendidos (y términos expandidos)', 'Un vector por token', 'Nada'],
            ['Costo por consulta', 'Muy bajo', 'Un forward + ANN', 'Un forward + índice invertido', 'Un forward + ANN por token + MaxSim', 'Un forward por par'],
            ['Memoria del índice', 'Baja', R`N × E × b/8 (${met('idx')})`, 'Baja–media', R`Alta: N × T<sub>d</sub> × 128 (${met('colIdx', CB)}); v2 la comprime a 1–2 bits por dimensión`, '—'],
            ['Términos exactos', 'Excelente', 'Débil', 'Bueno', 'Bueno', 'Bueno'],
            ['Paráfrasis', 'Débil', 'Bueno', 'Bueno', 'Bueno', 'Excelente'],
            ['Zero-shot (BEIR, relativo a BM25)', '0', 'DPR −47.7 %, TAS-B −2.8 %', 'SPLADEv2: cerca de ColBERTv2 (según ColBERTv2)', 'ColBERT +2.5 %', '+11 % (sobre BM25)'],
            ['Uso', 'Siempre como baseline y en el híbrido', 'Primera etapa', 'Primera etapa (motor léxico)', 'Primera etapa o rerank', 'Solo rerank de los top-k'],
          ], note: R`Fuentes: ${BEIR}; ${SPLADE}; ${COLBERT}; ${COLBERT2}. Memoria del calculador para las canónicas.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota en RAG: "most RAG failures are retrieval failures, so I evaluate retrieval separately from generation: recall at k of the chunks that contain the answer, on a labeled set of real queries. Then I fix the specific failure: hybrid BM25 for identifiers, a cross-encoder for ordering, better chunking with titles for context, query rewriting for conversational follow-ups, and metadata filters for freshness and permissions."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Cuándo lo mencionas'], rows: [
            [R`Sentence-BERT (${SBERT})`, 'BERT siamés con mean pooling ajustado con NLI: el primer embedding de frase bueno con BERT, y la librería sentence-transformers.', 'Por qué no el [CLS] crudo'],
            [R`DPR (${DPR})`, 'Dos BERT-base, [CLS], producto punto; in-batch + hard negatives de BM25; supera a BM25 en QA de dominio abierto.', 'La canónica de esta página'],
            [R`ANCE (${ANCE})`, 'Hard negatives del propio modelo con un índice que se refresca durante el entrenamiento.', 'Minar negativos'],
            [R`RocketQA (${ROCKET})`, 'Negativos entre GPUs (cross-batch), hard negatives filtrados por un cross-encoder y aumento de datos.', 'Falsos negativos'],
            [R`ColBERT / ColBERTv2 (${COLBERT}; ${COLBERT2})`, 'Un vector por token y MaxSim; v2 comprime cada vector a un centroide + residuo de 1–2 bits (≈ 20–36 bytes en vez de 256) y destila de un cross-encoder: el índice de MS MARCO baja de 154 a 16–25 GiB.', 'Precisión cerca del cross-encoder con índice'],
            [R`SPLADE (${SPLADE})`, 'Usa la cabeza de MLM de BERT para dar un peso log(1 + ReLU) a cada término del vocabulario (y expandir con términos que no están); se sirve con un índice invertido como BM25.', 'Retrieval aprendido pero léxico'],
            [R`Contriever (${CONTRIEVER})`, 'Retriever denso entrenado sin etiquetas (contraste entre recortes del mismo documento).', 'Sin datos etiquetados'],
            [R`E5 (${E5})`, 'Preentrenamiento contrastivo con 270M pares débiles + fine-tuning; prefijos query/passage.', 'Embeddings generales abiertos'],
            [R`BGE (${BGE}) y GTE (${GTE})`, 'Familias abiertas de embeddings con entrenamiento contrastivo en varias etapas (BGE: con una instrucción para las consultas); GTE-base, con 110M parámetros, reporta superar a la API de embeddings de OpenAI de entonces en MTEB.', 'Elegir un modelo abierto'],
            [R`Matryoshka (${MRL})`, 'Pérdida sobre prefijos anidados del embedding: se puede truncar.', 'Memoria del índice'],
            ['Two-tower de recomendación', 'El mismo bi-encoder con usuarios e ítems.', R`<a href="#two-tower">Two-tower</a> (próximamente)`],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Search y RAG son de lo más preguntado en entrevistas de ML/AI Engineer, en las dos formas: conceptual ("bi- vs cross-encoder") y de diseño ("búsqueda semántica sobre 100M documentos con 50 ms"). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual. El diseño de sistema completo se practica en la Ronda de Diseño ML; aquí, las piezas de modelo.` },
          { t: 'followups', items: [
            { q: 'Bi-encoder vs cross-encoder: how do they differ and when do you use each?',
              junior: 'El cross-encoder es más preciso, así que es mejor.',
              senior: R`Bi-encoder: consulta y documento se codifican <b>por separado</b> en un vector cada uno y se comparan por producto punto. Como el vector del documento no depende de la consulta, se calcula offline y se indexa: una consulta cuesta un forward (${met('qEnc')} con DPR) más una búsqueda ANN. Cross-encoder: el par entra junto ([CLS] q [SEP] d [SEP]) y la atención cruza los tokens en todas las capas: mucho más preciso (negación, detalles), pero un forward por par (${met('ce', CE)} con MiniLM) y nada que indexar. Se usan en cascada: el bi-encoder (con BM25) trae cientos de candidatos y el cross-encoder reordena los mejores ${cf('k', CE)}.`,
              say: 'A bi-encoder embeds query and document independently, so documents are encoded offline and indexed, and each query costs one encoder pass plus a nearest-neighbor lookup. A cross-encoder reads the pair jointly with full attention, which is far more accurate but costs one forward pass per pair and cannot be indexed. So I retrieve with the bi-encoder and rerank the top candidates with the cross-encoder.',
              why: 'La de entrada. Se anota independencia → índice, interacción → precisión, el costo por par y la cascada.' },
            { q: 'Why not use a cross-encoder for everything?',
              junior: 'Porque es más lento.',
              senior: R`Porque escala con el corpus <b>por consulta</b>: con N = ${cf('N')} documentos serían N forwards por cada consulta, contra uno con el bi-encoder. La cuenta de SBERT: encontrar el par más parecido entre 10,000 frases con un cross-encoder son ≈ 50 millones de forwards, ≈ 65 horas en una V100, contra ≈ 5 segundos con embeddings. Y no hay índice posible: el "vector del documento" depende de la consulta. Lo uso solo donde el número de pares está acotado: reranking de los top-k (k = 20–100), y como profesor para destilar al bi-encoder.`,
              say: 'Because its cost grows with the corpus for every query: scoring a million documents means a million forward passes per query, and nothing can be precomputed since the document representation depends on the query. I use it only to rerank a bounded top-k and as a teacher for distilling the bi-encoder.',
              why: 'Trampa: "es más lento" sin la cuenta. Se anota N por consulta vs una vez, el ejemplo de SBERT y el rol de profesor.', trap: true },
            { q: 'How many negatives does in-batch training give you, and why does batch size matter?',
              junior: 'Uno por ejemplo.',
              senior: R`B−1 por consulta: los positivos de las otras B−1 consultas del batch, que ya se codificaron, así que solo cuesta la matriz B×B de productos punto. Con un hard negative por consulta, como DPR, la matriz es B×2B y hay 2B−1 negativos. El batch importa porque más negativos son una tarea más difícil y más probable que aparezca uno parecido: en DPR, top-20 sube de 69.1 % (7 negativos) a 73.0 % (127). Pero un solo hard negative de BM25 lo lleva a 77.3 %: la <b>calidad</b> del negativo pesa más que la cantidad. Límites: la memoria de las activaciones crece con B (GradCache la desacopla), y en multi-GPU hay que hacer all-gather de los embeddings con gradiente para usar los negativos de todas las GPUs (la trampa de <a href="#clip.costo">CLIP</a>). Y con B grande sube la probabilidad de falsos negativos (otro positivo de la misma consulta en el batch).`,
              say: 'Each query gets B minus one in-batch negatives, the other queries\' positives, essentially for free because they are already encoded. Larger batches help because more negatives make the task harder: in DPR top-twenty accuracy rose from sixty-nine to seventy-three percent going from eight to a hundred twenty-eight, but adding one BM25 hard negative per query jumped to seventy-seven. Quality of negatives beats quantity.',
              why: 'Se anota B−1, B×2B con hard negatives, los números de DPR, all-gather y falsos negativos.' },
            { q: 'Why is the BERT CLS vector a bad sentence embedding out of the box, and how does SBERT fix it?',
              junior: 'Porque BERT es viejo.',
              senior: R`Nada en el preentrenamiento pide que frases parecidas den vectores cercanos: el [CLS] se entrenó para NSP y los vectores contextuales de BERT son anisótropos (casi todo tiene coseno alto). SBERT lo midió en STS: [CLS] 29.19 de Spearman promedio, peor que promediar GloVe (61.32). El arreglo: misma red para las dos frases (siamesa), mean pooling, y fine-tuning con pares etiquetados (NLI) con una pérdida que fuerza la geometría; hoy, InfoNCE con in-batch negatives sobre millones de pares.`,
              say: 'Pretraining never asks similar sentences to have nearby vectors; CLS was trained for next-sentence prediction and BERT embeddings are anisotropic. SBERT showed raw CLS is worse than averaged GloVe on similarity benchmarks, and fixed it by fine-tuning a siamese BERT with mean pooling on labeled sentence pairs.',
              why: 'Se anota NSP, anisotropía, el número de SBERT y el fine-tuning siamés contrastivo.', trap: true },
            { q: 'Design semantic search over 100M documents with a 50 ms p99 budget.',
              junior: 'Embeddings de OpenAI y una base vectorial.',
              senior: R`Empiezo por los números. <b>Offline</b>: trocear y codificar 10⁸ trozos; con un encoder chico (MiniLM-L6, 384-d) son ${est('decenas a cientos de GPU-horas')} según la longitud y la eficiencia real (DPR tardó 8.8 h para 21M pasajes en 8 GPUs con BERT-base). <b>Memoria</b>: 10⁸ × 384 × 2 bytes ${est('≈ 77 GB')} en fp16 (768-d serían 154 GB); con int8 o PQ, ${est('10–40 GB')}, en un índice HNSW o IVF-PQ por shard (<a href="#ann">ANN</a>), re-puntuando con vectores completos. <b>Presupuesto online</b> (${est('a medir')}): tokenizar + codificar la consulta ${est('≈ 5 ms')} en GPU (o un modelo destilado en CPU), ANN ${est('≈ 5–10 ms')} por shard en paralelo, BM25 en paralelo, RRF ${est('&lt; 1 ms')}, reranker cross-encoder MiniLM sobre ${est('k ≈ 30–50')} pares ${est('≈ 20–30 ms')} en GPU (1,800 pares/s en una V100 según su tarjeta), red y filtros el resto. k es la perilla: si no entra, k más chico, un reranker más chico o destilarlo al bi-encoder. <b>Calidad</b>: un set de consultas reales con juicios, recall@100 para la primera etapa y nDCG@10 para el final. <b>Operación</b>: versionar modelo e índice juntos (cambiar de modelo = re-indexar), indexar documentos nuevos de forma incremental, filtros de permisos y frescura, cache de consultas frecuentes. El sistema completo (logging, A/B) lo practico en la Ronda de Diseño ML.`,
              say: 'I start with numbers. A small encoder embeds a hundred million chunks offline; at three hundred eighty-four dimensions in fp16 the vectors are about seventy-seven gigabytes, so I compress with int8 or product quantization and shard an HNSW or IVF-PQ index. Online: encode the query in a few milliseconds, search the shards and BM25 in parallel, fuse with reciprocal rank fusion, and rerank a few dozen candidates with a small cross-encoder, which is the main latency knob. I measure recall at a hundred for the first stage and nDCG at ten end to end, and version the model and index together.',
              why: 'Se anota la cuenta de memoria y cómputo antes de la arquitectura, el presupuesto por etapa, k como perilla y la operación.' },
            { q: 'Your recall@100 is fine but nDCG@10 is bad. What do you change?',
              junior: 'Cambio el modelo de embeddings por uno más grande.',
              senior: R`El problema no es encontrar sino <b>ordenar</b>: los relevantes están en los 100 candidatos pero no arriba. No toco la primera etapa ni el índice. (1) Agrego o mejoro el <b>reranker</b>: un cross-encoder sobre los top-50–100, que es exactamente para esto; si ya hay uno, lo ajusto con datos de mi dominio. (2) Reviso la <b>fusión</b>: con RRF, un ranker malo puede empujar basura arriba; pesos por ranker o k<sub>rrf</sub>. (3) Señales que el modelo no ve: frescura, popularidad, autoridad, deduplicar casi-duplicados que ocupan el top-10. (4) Antes que todo, miro los <b>juicios</b>: si los "irrelevantes" de arriba son en realidad relevantes sin etiquetar (falsos negativos, típico de MS MARCO), el problema es la evaluación. Leo 20 consultas fallidas antes de entrenar nada.`,
              say: 'Recall at a hundred being fine means the relevant documents are in the candidate set, so the problem is ordering, not retrieval. I would add or fine-tune a cross-encoder reranker on the top candidates, check the fusion weights, add signals like freshness and deduplication, and first verify that the top results are not unlabeled relevant documents.',
              why: 'Trampa: cambiar el retriever. Se anota recall vs ranking, el reranker, la fusión y revisar los juicios.', trap: true },
            { q: 'RAG answers are wrong. How do you tell whether retrieval is the problem, and how do you fix it?',
              junior: 'Cambio el prompt del LLM.',
              senior: R`Separo las dos etapas. (1) Un set de preguntas con el trozo (o documento) que contiene la respuesta; mido <b>recall@k</b> del retriever con el k que entra al prompt. Si el trozo correcto no está en el top-k, es retrieval; si está y la respuesta igual es mala, es generación (contexto demasiado largo, el modelo ignora el medio, prompt). (2) Por tipo de falla de retrieval: identificadores o nombres exactos → híbrido con BM25; paráfrasis o preguntas largas → reranker y un mejor modelo de embeddings ajustado a mi dominio; preguntas de seguimiento en un chat ("¿y el precio?") → reescribir la consulta con el historial; información partida entre trozos → trozos más grandes, solapamiento, títulos pegados, o recuperar el vecino; documentos viejos o de otro cliente → filtros de metadatos; respuesta que requiere varios documentos → más k con reranker, o búsqueda en varios pasos. (3) Re-mido después de cada cambio con el mismo set.`,
              say: 'I evaluate retrieval separately: on a labeled set I measure whether the chunk containing the answer is in the top k that reaches the prompt. If it is not, I fix retrieval by failure type: hybrid search for exact terms, a reranker and domain-tuned embeddings for paraphrases, query rewriting for conversational follow-ups, better chunking for split information, and metadata filters for freshness and permissions.',
              why: 'Trampa: tocar el prompt primero. Se anota medir recall@k del retriever por separado y el arreglo por tipo de falla.', trap: true },
            { q: 'Write the in-batch contrastive loss for a bi-encoder.',
              junior: 'Una MSE entre el embedding de la query y el del documento.',
              senior: R`Con q y d normalizados de forma (B, E): scores = q·dᵀ/τ, de forma (B, B); labels = arange(B) (el positivo de la fila i está en la columna i); pérdida = cross_entropy(scores, labels). Con hard negatives, concateno [d⁺; d⁻] y la matriz es B×2B con las mismas labels. Detalles: τ ≈ 0.05 (escala 20) si uso coseno; DPR no normaliza y no usa temperatura. Una MSE sin negativos colapsa: todo al mismo punto da pérdida cero. Al azar, la pérdida vale ≈ ln B, un buen chequeo del primer paso. El ejercicio está en <a href="#retrieval.practica">práctica</a>.`,
              say: 'With normalized query and document embeddings, I compute the B by B similarity matrix divided by a temperature and apply cross-entropy with the diagonal as targets, so each query must pick its own document among all documents in the batch. Hard negatives are appended as extra columns. At initialization the loss should be about log B.',
              why: 'Trampa: sin negativos colapsa. Se anota la forma de la matriz, las labels, τ y el chequeo ln B.', trap: true },
            { q: 'How does ColBERT work and what does it cost compared to a single-vector bi-encoder?',
              junior: 'Es un BERT más rápido.',
              senior: R`Guarda un vector de 128 dimensiones <b>por token</b> del documento (offline) y puntúa con MaxSim: para cada token de la consulta, el producto punto con el token más parecido del documento, sumado. Así conserva el detalle léxico sin pagar un forward por par. Costo: la memoria del índice se multiplica por el número de tokens: para MS MARCO en fp16, ${met('colIdx', CB)} en el calculador (que asume ${cf('Td', CB)} tokens por pasaje) contra ${met('idx', CB)} con un vector de 128 por pasaje; el ColBERT original midió 154 GiB, porque los pasajes reales son más cortos. ColBERTv2 lo comprime (centroide + residuo de 1–2 bits) a 16–25 GiB. Resultado: MS MARCO MRR@10 36.0 de punta a punta (v1) y 39.7 (v2), cerca o por encima de un cross-encoder BERT-base (36.0) a una fracción de la latencia.`,
              say: 'ColBERT stores a small vector per document token offline and scores with MaxSim: each query token takes its best-matching document token and the scores are summed. It keeps token-level matching without a forward pass per pair, but the index grows with the number of tokens, which ColBERTv2 addresses with residual compression to one or two bits per dimension.',
              why: 'Se anota MaxSim, el índice por token con números y la compresión de v2.' },
            { q: 'What are hard negatives, how do you mine them, and what can go wrong?',
              junior: 'Ejemplos negativos difíciles de conseguir.',
              senior: R`Negativos que el modelo confunde: parecidos en superficie, irrelevantes de verdad. Se minan con BM25 (DPR: el top de BM25 que no contiene la respuesta), con el propio retriever (ANCE: refrescando el índice durante el entrenamiento) o de los rankings de producción (lo que se mostró arriba y no se clickeó, con cuidado). Lo que sale mal: <b>falsos negativos</b>: el "negativo" sí era relevante pero no estaba etiquetado, y el modelo aprende a alejarlo. Cuanto más duro el minado, más falsos negativos. Mitigación: filtrar con un cross-encoder (RocketQA), descartar los demasiado cercanos al positivo, o reemplazar etiquetas duras por scores de un cross-encoder (destilación).`,
              say: 'Hard negatives are documents that look relevant but are not, mined from BM25, from the current model\'s own top results, or from production logs. The main risk is false negatives, relevant but unlabeled documents that the model learns to push away, which I mitigate by filtering with a cross-encoder or distilling soft scores instead of hard labels.',
              why: 'Se anota las fuentes de minado y el riesgo de falsos negativos con su mitigación.', trap: true },
            { q: 'How do you combine BM25 and dense retrieval? Why does hybrid help?',
              junior: 'Sumo los scores.',
              senior: R`Sumar los scores crudos no sirve: BM25 no está acotado y depende de la consulta, el coseno vive en [−1, 1]. Opciones: (1) <b>RRF</b>: Σ 1/(60 + rank) por ranker; solo usa posiciones, no hay que calibrar, y es el default robusto; (2) combinación lineal de scores normalizados (min-max por consulta) con un peso ajustado en un dev set (DPR usó BM25 + 1.1·sim); (3) que el reranker decida sobre la unión de candidatos. Ayuda porque fallan en cosas distintas: BM25 en sinónimos y paráfrasis, el denso en términos exactos y fuera de dominio. Pero mídelo: en NQ, BM25 + DPR quedó por debajo de DPR solo en top-20 (76.6 vs 78.4).`,
              say: 'Raw scores are on different scales, so I use reciprocal rank fusion, which sums one over sixty plus the rank across retrievers, or a tuned weighted sum of normalized scores, or let a reranker score the union of candidates. It helps because lexical and dense retrieval fail on different queries, but I validate it on my data.',
              why: 'Trampa: sumar scores crudos. Se anota RRF con la fórmula, la normalización y el contraejemplo de DPR.', trap: true },
            { q: 'Dense retrieval works on MS MARCO but is worse than BM25 on your legal documents. Why, and what do you do?',
              junior: 'Uso un modelo más grande.',
              senior: R`Fuera del dominio, los bi-encoders pierden contra BM25 con frecuencia: es el hallazgo central de BEIR (DPR −47.7 % en promedio relativo a BM25; BM25 + cross-encoder es lo más robusto). El vocabulario legal es raro (el embedding no lo distingue), las consultas usan términos exactos (artículos, nombres de partes), y el modelo nunca vio esa distribución. Qué hago: (1) híbrido con BM25 ya, y un cross-encoder encima; (2) adaptar el bi-encoder: generar preguntas sintéticas para mis documentos con un LLM y entrenar con ellas (con hard negatives de BM25 y un filtro de calidad), o continuar el preentrenamiento contrastivo en mi corpus; (3) un modelo general más reciente (E5/BGE) comparado en mi set; (4) medir con consultas reales etiquetadas, porque los juicios armados con BM25 favorecen a BM25.`,
              say: 'Out-of-domain dense retrievers often lose to BM25, as BEIR showed, because legal vocabulary and exact references are rare in their training data. I would go hybrid with a cross-encoder reranker immediately, then adapt the bi-encoder with synthetic queries generated for my documents and BM25 hard negatives, and evaluate on real labeled queries.',
              why: 'Se anota BEIR, el porqué (vocabulario, términos exactos), el híbrido inmediato y la adaptación con datos sintéticos.' },
            { q: 'How do you chunk long documents for retrieval, and what are the trade-offs?',
              junior: 'Cada 512 tokens.',
              senior: R`El tamaño del trozo es un trade-off entre <b>precisión</b> (un trozo chico es sobre una sola cosa y su vector no promedia temas) y <b>contexto</b> (un trozo grande no corta la respuesta a la mitad y lleva su propio contexto). Práctica: ${est('200–500 tokens')} con ${est('10–20 %')} de solapamiento, respetando la estructura (secciones, párrafos, tablas enteras), y anteponiendo el título del documento y de la sección a cada trozo para que "el plazo es de 30 días" sepa de qué contrato habla. El límite duro es el del encoder (all-MiniLM-L6-v2 trunca en 256 y se entrenó con 128). Variantes: indexar trozos chicos y devolver el trozo grande que los contiene (parent document), o varios vectores por documento y agregar por documento (max). Elijo midiendo recall@k con distintos tamaños, no a ojo.`,
              say: 'Chunk size trades precision against context: small chunks give focused vectors but may split the answer, large ones keep context but average topics. I use a few hundred tokens with overlap, respect document structure, prepend titles and section headers, stay within the encoder\'s trained length, and tune the size by measuring recall.',
              why: 'Trampa: 512 fijo. Se anota el trade-off, el solapamiento, los títulos, el límite del encoder y medir.', trap: true },
            { q: 'How do you reduce the memory of a 100M-vector index? What do you lose?',
              junior: 'Uso menos documentos.',
              senior: R`Cuatro palancas sobre N × E × b/8: (1) <b>bits</b>: fp32 → fp16 (÷2, casi sin pérdida) → int8 (÷4, pérdida chica) → binario (÷32, pérdida grande sin re-puntuar); (2) <b>dimensiones</b>: Matryoshka (si el modelo lo soporta) o PCA; (3) <b>product quantization</b>: 96 bytes por vector en lugar de 3,072 (<a href="#ann">IVF-PQ</a>); (4) <b>dedup</b> de trozos casi iguales. La receta estándar es de dos etapas: buscar sobre los vectores comprimidos para traer unos cientos y re-puntuar con los vectores completos (en disco o en otro nivel de memoria). Pierdes recall en la primera etapa; con re-puntuación, casi todo vuelve. Lo mido con recall@k contra la búsqueda exacta (fuerza bruta en fp32) sobre una muestra.`,
              say: 'The index is N times dimension times bytes, so I reduce bits with fp16 or int8, reduce dimensions with Matryoshka or PCA, or use product quantization, and then re-score the top few hundred candidates with full-precision vectors. I measure the recall loss against exact search on a sample.',
              why: 'Se anota la fórmula, las cuatro palancas con factores y la re-puntuación con medición contra búsqueda exacta.' },
            { q: 'Should the query and document encoders share weights?',
              junior: 'Siempre dos encoders separados, como DPR.',
              senior: R`Depende de la asimetría y de los datos. DPR usa dos BERT-base: preguntas cortas y pasajes largos tienen distribuciones distintas, y separar da más capacidad (el doble de parámetros, ${qn('params.total')}). SBERT, E5, BGE y la mayoría de los modelos actuales comparten un encoder y marcan el rol con un prefijo ("query: " / "passage: "): la mitad de parámetros, la misma capacidad de representar los dos lados y funciona para búsquedas simétricas (frase contra frase, deduplicación). Con pocos datos, compartir generaliza mejor. Trampa operativa: si el modelo usa prefijos, olvidarlos en inferencia degrada en silencio.`,
              say: 'DPR uses two separate encoders because questions and passages differ, at twice the parameters. Most current models share one encoder and mark the role with a prefix, which halves the parameters and generalizes better with limited data. If the model expects prefixes, forgetting them at inference silently hurts quality.',
              why: 'Se anota asimetría, prefijos, parámetros y la trampa de olvidar el prefijo.' },
            { q: 'What do recall@k, MRR and nDCG measure, and which do you use where?',
              junior: 'Las tres miden accuracy.',
              senior: R`Recall@k: qué fracción de los relevantes está en el top-k; es la métrica de la <b>primera etapa</b>, porque lo que no entra en los candidatos no lo arregla nadie después (con un solo relevante, es un hit rate: el "top-20 accuracy" de DPR). MRR@10: el promedio de 1/rank del primer relevante; para tareas con una respuesta (QA, navegación); es la oficial de MS MARCO. nDCG@10: relevancia graduada con descuento logarítmico por posición, normalizada por el ranking ideal; es la del ranking <b>final</b> que ve el usuario y la de BEIR. En RAG agrego recall@k con el k que entra al prompt. Y todas dependen de juicios completos: con relevantes sin etiquetar, subestiman.`,
              say: 'Recall at k measures whether relevant items make it into the candidate set, so I use it for the first stage. MRR looks at the rank of the first relevant result and suits single-answer tasks. nDCG uses graded relevance with a position discount and evaluates the final ranking. All of them are biased by incomplete relevance labels.',
              why: 'Se anota qué mide cada una, en qué etapa va y el sesgo de juicios incompletos.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuánto ocupa el índice de la canónica y cuánto por vector?',
              a: R`${met('idx')} para N = ${cf('N')} vectores de ${cf('dim')} dimensiones en ${cf('bits')} bits (${cf('dim')} × 4 bytes por vector). En fp16, la mitad; en int8, un cuarto.` },
            { q: 'Tu bi-encoder recién entrenado da la misma lista de documentos para todas las consultas. ¿Qué pasó?',
              a: 'Colapso o hubness: (1) la pérdida no tenía negativos (MSE o coseno con el positivo solamente) y todo se fue al mismo punto; (2) producto punto sin normalizar y unos pocos documentos con norma grande ganan todo; (3) mean pooling incluyendo el padding, que domina en textos cortos; (4) el prefijo de consulta o documento cambiado entre entrenamiento e inferencia. Chequeo rápido: la pérdida al inicio ≈ ln B, y la norma y la varianza de los embeddings por dimensión.' },
            { q: 'Pasas de reordenar k = 100 a k = 20 candidatos. ¿Qué ganas y qué arriesgas?',
              a: R`El reranker cuesta k forwards por consulta: ÷5 en esa etapa (${met('rerank')} con k = ${cf('k')}). Arriesgas que un relevante que estaba en la posición 21–100 de la primera etapa ya no pueda subir: mide recall@20 de la primera etapa antes de bajar k.` },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (los calcula el calculador) y al final el ejercicio de código: la pérdida con in-batch negatives y las métricas de ranking.` },
          { t: 'h3', text: 'Diagrama en blanco: el embudo' },
          { t: 'blankdiagram', diagram: 'retrieval-overview', slots: [
            { node: 'doc-encoder', ask: 'label', hint: 'offline, una vez por documento' },
            { node: 'query-encoder', tensor: T.qVec, ask: 'shape' },
            { node: 'index', tensor: T.index, ask: 'shape' },
            { node: 'reranker', ask: 'label', hint: 'lee consulta y documento juntos' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'retrieval', pool: 'all', configs: [C, SB, CE, CB] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`El corpus crece de ${cf('N')} a 100 millones de pasajes. ¿Por qué factor cambia la memoria del índice?`, change: { N: 100000000 }, ask: 'embeddingIndexBytes',
              explain: '≈ ×4.8, lineal en N: un vector por documento.' },
            { q: 'Mismo cambio. ¿Y el costo de codificar una consulta?', change: { N: 100000000 }, ask: 'queryEncodeMacs',
              explain: 'Nada: la consulta no sabe cuántos documentos hay. Lo que crece es la búsqueda (lineal en fuerza bruta, mucho menos con ANN) y el costo offline.' },
            { q: 'Mismo cambio. ¿Y la búsqueda por fuerza bruta?', change: { N: 100000000 }, ask: 'bruteForceMacs',
              explain: '≈ ×4.8: N × E productos por consulta. Por eso ANN.' },
            { q: 'Bajas la dimensión de 768 a 256 (Matryoshka). ¿Por qué factor cambia la memoria del índice?', change: { dim: 256 }, ask: 'embeddingIndexBytes',
              explain: '÷3: lineal en la dimensión. El encoder cuesta casi lo mismo (solo cambia la última proyección).' },
            { q: 'Guardas el índice en int8 en lugar de fp32. ¿Por qué factor cambia su memoria?', change: { bits: 8 }, ask: 'embeddingIndexBytes',
              explain: '÷4. Con re-puntuación de los mejores con los vectores completos, el recall casi no cae.' },
            { q: 'Índice binario (1 bit por dimensión). ¿Cuánto ocupa ahora?', change: { bits: 1 }, ask: 'embeddingIndexBytes', expect: 'value',
              explain: '÷32 respecto de fp32: la búsqueda binaria (Hamming) es rapidísima, pero hay que re-puntuar con más bits.' },
            { q: R`Reordenas k = 20 candidatos en lugar de ${cf('k')} con el cross-encoder. ¿Por qué factor cambian sus MACs?`, change: { k: 20 }, ask: 'rerankMacs',
              explain: '÷5: lineal en k, un forward por par.' },
            { q: R`Pasajes de 128 tokens en lugar de ${cf('Td')}. ¿Qué pasa con el costo de un par en el cross-encoder?`, change: { Td: 128 }, ask: 'crossEncoderMacsPerPair',
              explain: 'Baja algo más que en proporción a los tokens del par (de T_q + T_d − 1 = 287 a 159): las lineales son lineales en el largo y la atención, cuadrática.' },
            { q: 'Mismo cambio, pasajes de 128 tokens. ¿Y el costo offline de codificar el corpus?', change: { Td: 128 }, ask: 'corpusEncodeMacs',
              explain: '≈ ÷2: N forwards de T_d tokens. Por eso trocear más fino también cuesta: más trozos, cada uno más barato.' },
          ] },

          { t: 'h3', text: 'Escríbelo: InfoNCE con in-batch negatives y recall@k' },
          { t: 'p', html: R`Sin mirar: (1) <code>in_batch_infonce(q, d_pos, d_hard=None, tau)</code> con la matriz de scores B×B (o B×2B con hard negatives) y entropía cruzada con la diagonal como etiqueta; (2) <code>rank_metrics(q, docs, gold)</code> con recall@1/10/100 y MRR@10 por fuerza bruta; (3) entrenar un bi-encoder de juguete (embedding promedio de los tokens + lineal, un encoder compartido) en un corpus sintético: 2,000 documentos de 20 tokens; cada consulta son 4 tokens de su documento + 2 de ruido. Verificado en el venv del Atlas (PyTorch 2.14): la pérdida vectorizada coincide con el bucle −log softmax por fila (float64), con embeddings al azar vale 8.318 = ln 4096, y las métricas coinciden con un bucle ingenuo. El bi-encoder pasa de recall@1 0.184 / recall@10 0.458 / MRR@10 0.262 (sin entrenar: un embedding promedio al azar ya captura el solapamiento de palabras) a 0.690 / 0.935 / 0.778 con B = 32 y 4,800 pasos.` },
          { t: 'code', title: 'Solución de referencia (PyTorch)', files: [
            { name: 'infonce_retrieval.py', lang: 'python', code: [
              'import torch',
              'import torch.nn.functional as F',
              '',
              '',
              'def in_batch_infonce(q, d_pos, d_hard=None, tau=0.05):',
              '    """q, d_pos: (B, E) con norma 1; d_hard: (B, E) o None (un hard negative por query).',
              '    Fila i: el positivo es d_pos[i]; los negativos, los otros B-1 positivos (+ los B hard negatives)."""',
              '    docs = d_pos if d_hard is None else torch.cat([d_pos, d_hard], dim=0)   # (B, E) o (2B, E)',
              '    scores = q @ docs.T / tau                                               # (B, B) o (B, 2B)',
              '    labels = torch.arange(q.shape[0], device=q.device)                      # el positivo está en la diagonal',
              '    return F.cross_entropy(scores, labels)',
              '',
              '',
              'def rank_metrics(q, docs, gold, ks=(1, 10, 100)):',
              '    """q: (Q, E), docs: (N, E), gold: (Q,) índice del documento relevante (uno por query)."""',
              '    scores = q @ docs.T                                                     # (Q, N): fuerza bruta',
              '    gold_score = scores.gather(1, gold[:, None])                            # (Q, 1)',
              '    rank = (scores > gold_score).sum(1) + 1                                 # 1 = primero',
              "    out = {f'recall@{k}': (rank <= k).float().mean().item() for k in ks}",
              "    out['MRR@10'] = torch.where(rank <= 10, 1.0 / rank, torch.zeros_like(rank, dtype=torch.float)).mean().item()",
              '    return out',
              '',
              '',
              'class BagEncoder(torch.nn.Module):          # un "BERT" de juguete: embedding promedio + lineal',
              '    def __init__(self, vocab, dim=64):',
              '        super().__init__()',
              "        self.emb = torch.nn.EmbeddingBag(vocab, 128, mode='mean')",
              '        self.proj = torch.nn.Linear(128, dim)',
              '',
              '    def forward(self, ids):                  # ids: (B, n_tokens)',
              '        return F.normalize(self.proj(self.emb(ids)), dim=-1)',
            ] },
            { name: 'check_infonce.py', lang: 'python', code: [
              'import math, torch',
              'import torch.nn.functional as F',
              'from infonce_retrieval import in_batch_infonce, rank_metrics, BagEncoder',
              '',
              'torch.manual_seed(0)',
              '# 1) la pérdida vectorizada == el bucle -log softmax por fila (con hard negatives)',
              'B, E, tau = 8, 16, 0.05',
              'q, dp, dh = (F.normalize(torch.randn(B, E, dtype=torch.float64), dim=-1) for _ in range(3))',
              'loop = sum(-(s[i] - torch.logsumexp(s, 0)) for i in range(B)',
              '           for s in [torch.cat([q[i] @ dp.T, q[i] @ dh.T]) / tau]) / B',
              "print(torch.allclose(in_batch_infonce(q, dp, dh, tau), loop))           # True",
              'qr, dr = (F.normalize(torch.randn(4096, 768), dim=-1) for _ in range(2))',
              "print(in_batch_infonce(qr, dr, tau=1.0).item(), math.log(4096))          # 8.318 8.318: al azar ≈ ln B",
              '',
              '# 2) corpus sintético: la consulta son 4 tokens de su documento + 2 de ruido',
              'V, N, L = 5000, 2000, 20',
              'docs = torch.randint(0, V, (N, L))',
              'def make_queries(seed):',
              '    g = torch.Generator().manual_seed(seed)',
              '    keep = torch.stack([torch.randperm(L, generator=g)[:4] for _ in range(N)])',
              '    return torch.cat([docs.gather(1, keep), torch.randint(0, V, (N, 2), generator=g)], 1)',
              'q_test, gold = make_queries(123), torch.arange(N)',
              'Q_TRAIN = [make_queries(s) for s in range(50)]',
              '',
              'torch.manual_seed(0)',
              'enc = BagEncoder(V)                                    # un solo encoder (pesos compartidos)',
              'with torch.no_grad():',
              '    print(rank_metrics(enc(q_test), enc(docs), gold))  # recall@1 0.184 · @10 0.458 · @100 0.793 · MRR@10 0.262',
              'opt = torch.optim.Adam(enc.parameters(), lr=3e-3)',
              'for step in range(4800):',
              '    idx = torch.randint(0, N, (32,))                   # B = 32: 31 negativos in-batch por consulta',
              '    loss = in_batch_infonce(enc(Q_TRAIN[step % 50][idx]), enc(docs[idx]), tau=0.05)',
              '    opt.zero_grad(); loss.backward(); opt.step()',
              'with torch.no_grad():',
              '    print(rank_metrics(enc(q_test), enc(docs), gold))  # recall@1 0.690 · @10 0.935 · @100 0.993 · MRR@10 0.778',
            ] },
          ] },
          { t: 'callout', kind: 'note', title: 'Lo que este juguete no muestra (y por qué)', html: R`<p>Con el mismo número de pares vistos (153,600), B = 4, 32 y 256 terminan parecidos en este juguete (recall@1 0.66, 0.68 y 0.62): los negativos al azar de un corpus sintético son fáciles, así que más negativos no enseñan más. El efecto del batch y de los hard negatives aparece con negativos que se parecen al positivo, como en DPR (Tabla 3: 69.1 → 73.0 → 77.3 en top-20). Si quieres verlo, genera documentos que compartan la mayoría de sus tokens con otros y usa como hard negative el documento más parecido por solapamiento (un BM25 de juguete).</p>` },
          { t: 'callout', kind: 'trap', title: 'Los bugs que este ejercicio atrapa', html: R`<p>(1) Etiquetas que no son arange(B): si el orden de d no coincide con el de q, la pérdida baja igual y el modelo aprende pares equivocados. (2) Hard negatives pegados <b>antes</b> de los positivos: las etiquetas tendrían que desplazarse. (3) Olvidar normalizar con τ = 0.05: los logits explotan. (4) La misma consulta (o el mismo documento) dos veces en el batch: un positivo cuenta como negativo (falso negativo). (5) Calcular el rank con ≥ en vez de &gt;: los empates cuentan en contra. (6) Evaluar con consultas que el modelo vio en el entrenamiento.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. Lo siguiente: <a href="#ann">búsqueda ANN</a>, cómo encontrar los vecinos más cercanos entre millones de vectores sin compararlos todos (HNSW, IVF-PQ).</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'retrieval-01', kind: 'concepto', q: 'Bi-encoder en una línea.', a: 'Query y documento se codifican por separado en un vector cada uno y se comparan por producto punto: el corpus se codifica offline y se indexa.' },
      { id: 'retrieval-02', kind: 'concepto', q: 'Cross-encoder en una línea.', a: '[CLS] q [SEP] d [SEP] en un solo forward y una cabeza de score: atención entre los dos textos, preciso, un forward por par, sin índice.' },
      { id: 'retrieval-03', kind: 'tradeoff', q: '¿Por qué no un cross-encoder para todo el corpus?', a: 'N forwards por consulta y nada precalculable. SBERT: 10,000 frases = ≈ 50M pares ≈ 65 h en una V100 vs ≈ 5 s con embeddings.' },
      { id: 'retrieval-04', kind: 'concepto', q: 'El embudo de búsqueda y RAG.', a: 'Bi-encoder (+ BM25) trae cientos de candidatos con ANN → cross-encoder reordena los top-k → resultados o prompt.' },
      { id: 'retrieval-05', kind: 'formula', q: 'InfoNCE con in-batch negatives.', a: R`\(\mathcal{L} = -\frac{1}{B}\sum_i \log\frac{e^{s(q_i,d_i)/\tau}}{\sum_j e^{s(q_i,d_j)/\tau}}\): matriz B×B, etiquetas en la diagonal.` },
      { id: 'retrieval-06', kind: 'conteo', q: 'Negativos por consulta con in-batch, y con un hard negative por consulta.', a: 'B−1; con hard negatives (matriz B×2B), 2B−1.' },
      { id: 'retrieval-07', kind: 'conteo', q: 'DPR, Tabla 3: efecto del batch y del hard negative (top-20 en NQ dev).', a: '69.1 (7 neg.) → 70.8 (31) → 73.0 (127) → 77.3 con 1 hard negative de BM25 (31 + 32).' },
      { id: 'retrieval-08', kind: 'trampa', q: '"Más negativos al azar = hard negatives."', a: 'No: los negativos al azar son triviales. Un hard negative de BM25 sube más que cuadruplicar el batch. Riesgo: falsos negativos.' },
      { id: 'retrieval-09', kind: 'concepto', q: '¿Qué es un falso negativo en retrieval?', a: 'Un documento relevante sin etiquetar usado como negativo: el modelo aprende a alejarlo. Mitigación: filtrar con un cross-encoder (RocketQA) o destilar scores.' },
      { id: 'retrieval-10', kind: 'trampa', q: '"El [CLS] de BERT sirve como embedding de búsqueda."', a: 'Sin entrenamiento contrastivo, no: STS promedio 29.19 contra 61.32 de GloVe (SBERT, Tabla 1).' },
      { id: 'retrieval-11', kind: 'concepto', q: 'Pooling en SBERT y en DPR.', a: 'SBERT: mean pooling (mejor que CLS y MAX en su Tabla 6), ignorando el padding. DPR: el [CLS].' },
      { id: 'retrieval-12', kind: 'concepto', q: 'DPR: arquitectura.', a: 'Dos BERT-base independientes (preguntas y pasajes), [CLS] de 768, producto punto; 21M pasajes de 100 palabras de Wikipedia.' },
      { id: 'retrieval-13', kind: 'conteo', q: 'DPR vs BM25 en NQ (top-20, test).', a: 'DPR 78.4 vs BM25 59.1; BM25 + DPR 76.6 (la combinación no siempre ayuda).' },
      { id: 'retrieval-14', kind: 'formula', q: 'ColBERT: MaxSim.', a: R`\(s(q,d) = \sum_i \max_j q_i^\top d_j\): cada token de la consulta con su token más parecido del documento.` },
      { id: 'retrieval-15', kind: 'conteo', q: 'ColBERT en MS MARCO (Tabla 1).', a: 'Rerank: MRR@10 34.9 en 61 ms vs BERT-base 36.0 en 10,700 ms: 170× más rápido, 13,900× menos FLOPs.' },
      { id: 'retrieval-16', kind: 'conteo', q: 'Índice de ColBERT vs ColBERTv2 en MS MARCO.', a: '154 GiB (16 bits por dimensión) → 16–25 GiB con compresión residual de 1–2 bits; MRR@10 36.0 → 39.7.' },
      { id: 'retrieval-17', kind: 'formula', q: 'Memoria de un índice denso.', a: 'N × E × b/8 bytes. 10⁸ × 768 en fp32 ≈ 307 GB; fp16 ≈ 154 GB; int8 ≈ 77 GB; binario ≈ 9.6 GB.' },
      { id: 'retrieval-18', kind: 'concepto', q: '¿Por qué la búsqueda exhaustiva sobre 100M vectores es limitada por memoria?', a: 'Pocos FLOPs por byte: hay que leer todo el índice (154 GB en fp16) por consulta. ANN visita una fracción; la compresión lee menos bytes.' },
      { id: 'retrieval-19', kind: 'formula', q: 'Reciprocal Rank Fusion.', a: R`\(\text{RRF}(d) = \sum_r 1/(60 + \text{rank}_r(d))\): solo posiciones, sin calibrar scores.` },
      { id: 'retrieval-20', kind: 'trampa', q: '"Para el híbrido sumo el score de BM25 y el coseno."', a: 'Escalas distintas (BM25 no acotado, coseno en [−1, 1]): RRF, o normalizar por consulta y ajustar un peso.' },
      { id: 'retrieval-21', kind: 'concepto', q: 'BEIR: el hallazgo.', a: '18 datasets zero-shot: BM25 es un baseline difícil; DPR −47.7 % relativo a BM25; BM25 + cross-encoder +11 %; in-domain no predice zero-shot.' },
      { id: 'retrieval-22', kind: 'formula', q: 'MRR@10 y nDCG@10.', a: R`MRR: promedio de 1/rank del primer relevante (0 si > 10). nDCG: \(\sum (2^{rel_i}-1)/\log_2(i+1)\) normalizado por el ideal.` },
      { id: 'retrieval-23', kind: 'concepto', q: '¿Qué métrica para la primera etapa y cuál para el ranking final?', a: 'Primera etapa: recall@k (lo que no entra, no se recupera). Final: nDCG@10 o MRR@10.' },
      { id: 'retrieval-24', kind: 'trampa', q: '"Recall@100 bien, nDCG@10 mal: cambio el retriever."', a: 'El problema es el orden: reranker (cross-encoder), fusión, señales extra, y revisar los juicios.' },
      { id: 'retrieval-25', kind: 'concepto', q: 'Matryoshka en una línea.', a: 'Pérdida sobre prefijos anidados del vector: se puede truncar (p. ej. 768 → 256) y sigue funcionando; buscar corto y re-puntuar largo.' },
      { id: 'retrieval-26', kind: 'trampa', q: '"Cambio el modelo de embeddings y sigo usando el índice."', a: 'Espacios distintos: hay que re-indexar todo el corpus y desplegar consulta e índice juntos, con versión.' },
      { id: 'retrieval-27', kind: 'concepto', q: 'SPLADE en una línea.', a: 'La cabeza de MLM de BERT da pesos log(1 + ReLU) por término del vocabulario (con expansión); se sirve con un índice invertido.' },
      { id: 'retrieval-28', kind: 'concepto', q: 'E5 en una línea.', a: 'Preentrenamiento contrastivo con ≈ 270M pares débiles (batch 32K, τ = 0.01) + fine-tuning; prefijos "query: " / "passage: ".' },
      { id: 'retrieval-29', kind: 'concepto', q: '¿Por qué destilar un cross-encoder en el bi-encoder?', a: 'El cross-encoder da scores graduados sobre los candidatos (no solo 1 positivo etiquetado), y el bi-encoder sigue siendo indexable.' },
      { id: 'retrieval-30', kind: 'concepto', q: 'Fallas clásicas del retrieval denso.', a: 'Términos exactos (SKUs, códigos), fuera del dominio, documentos largos (troceado), negación, falsos negativos, asimetría consulta–documento.' },
      { id: 'retrieval-31', kind: 'tradeoff', q: 'Tamaño de trozo para RAG.', a: 'Chico: preciso pero corta la respuesta y pierde contexto. Grande: contexto pero promedia temas. ≈ 200–500 tokens con solapamiento y títulos; medir recall.' },
      { id: 'retrieval-32', kind: 'concepto', q: 'Cross-encoder ms-marco-MiniLM-L6-v2: números de su tarjeta.', a: 'MRR@10 39.01 en MS MARCO dev, nDCG@10 74.30 en TREC DL19, 1,800 docs/s en una V100.' },
      { id: 'retrieval-33', kind: 'concepto', q: 'all-MiniLM-L6-v2.', a: '6 capas, 384 dimensiones, mean pooling normalizado, trunca en 256 tokens (entrenado con 128), 1.17B pares.' },
      { id: 'retrieval-34', kind: 'concepto', q: '¿Compartir pesos entre el encoder de consultas y el de documentos?', a: 'DPR: dos encoders (asimetría). La mayoría hoy: uno compartido con prefijos; olvidar el prefijo en inferencia degrada en silencio.' },
      { id: 'retrieval-35', kind: 'conteo', q: 'Pérdida InfoNCE con embeddings al azar.', a: '≈ ln B (ln 4096 = 8.32): el chequeo del primer paso.' },
      { id: 'retrieval-36', kind: 'trampa', q: '"El número 1 de MTEB es el mejor para mi búsqueda."', a: 'MTEB promedia tareas distintas; in-domain no predice zero-shot (BEIR). Mide recall@k y nDCG@10 en tus consultas reales.' },
      { id: 'retrieval-37', kind: 'concepto', q: 'Cómo diagnosticar un RAG que responde mal.', a: 'Medir recall@k del retriever con el k que entra al prompt. Si el trozo no está: retrieval (híbrido, reranker, troceado, reescritura). Si está: generación.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'bi-encoder (dual encoder)', es: 'bi-encoder', def: 'Codifica consulta y documento por separado; el score es un producto punto, así que los documentos se indexan.', say: 'We retrieve candidates with a bi-encoder and an ANN index.' },
      { en: 'cross-encoder', es: 'cross-encoder', def: 'Codifica consulta y documento juntos en una secuencia y produce un score; preciso, un forward por par.', say: 'A cross-encoder reranks the top fifty candidates.' },
      { en: 'late interaction', es: 'interacción tardía', def: 'Vectores por token precalculados que se comparan al final con MaxSim (ColBERT).', say: 'ColBERT uses late interaction over token embeddings.' },
      { en: 'in-batch negatives', es: 'negativos dentro del batch', def: 'Usar los positivos de las otras consultas del batch como negativos: B−1 por consulta sin costo extra de encoder.', say: 'In-batch negatives give us B minus one negatives per query for free.' },
      { en: 'hard negative', es: 'negativo difícil', def: 'Documento parecido en superficie pero irrelevante, minado con BM25 o con el propio modelo.', say: 'Adding one BM25 hard negative per question helped more than a bigger batch.' },
      { en: 'reranking', es: 'reordenamiento', def: 'Segunda etapa que puntúa con un modelo caro los top-k candidatos de la primera.', say: 'Reranking is the main latency knob in our search stack.' },
      { en: 'reciprocal rank fusion (RRF)', es: 'fusión por rango recíproco', def: 'Combinar rankings sumando 1/(k + rank) por ranker, con k = 60.', say: 'We fuse BM25 and dense results with reciprocal rank fusion.' },
      { en: 'recall@k', es: 'recall en k', def: 'Fracción de los relevantes que aparece en los k primeros resultados.', say: 'Recall at a hundred is our first-stage metric.' },
      { en: 'nDCG (normalized discounted cumulative gain)', es: 'ganancia acumulada descontada normalizada', def: 'Métrica de ranking con relevancia graduada y descuento logarítmico por posición, normalizada por el ranking ideal.', say: 'We report nDCG at ten for the final ranking.' },
      { en: 'Matryoshka embedding', es: 'embedding Matryoshka', def: 'Embedding entrenado para que sus prefijos (primeras dimensiones) sigan siendo útiles al truncarlo.', say: 'We truncate Matryoshka embeddings to two hundred fifty-six dimensions for the first pass.' },
      { en: 'chunking', es: 'troceado', def: 'Partir documentos largos en trozos que se indexan por separado.', say: 'Most RAG retrieval failures we saw were chunking problems.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
