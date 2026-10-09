/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/retrieval.js
   Diagramas de recuperación densa (SPEC §7.2, ids de §23.2), modelo `retrieval` (js/arch/retrieval.js):
     retrieval-overview  dos carriles. Offline (una vez): corpus de N documentos → encoder de documentos (× N) → índice de N
                         vectores. Online (por consulta): query → encoder de queries (× 1) → búsqueda top-k contra el índice →
                         reranker cross-encoder sobre k pares (× k) → resultados. Abajo, el cómputo de una consulta (codificar /
                         buscar / rerankear) de ATLAS.Arch.metrics. Configs dpr-bert-base (canónica: dos torres) y sbert-minilm
                         (siamés: pesos compartidos, la arista de pesos atados solo existe con cfg.shared).
       bi-vs-cross       bi-encoder (dos torres, un vector por texto, producto punto: el corpus se codifica offline) frente al
                         cross-encoder (query y documento juntos en UN encoder, cabeza D → 1: preciso, pero corre por par y no
                         admite índice). Abajo, MACs por consulta: bi-encoder vs cross-encoder sobre k vs sobre los N.
         colbert-maxsim  ColBERT (config colbert-v2): un vector de 128 por token, MaxSim = Σ_i máx_j q_i·d_j; el índice guarda
                         T_d vectores por documento (v1 en fp16 y v2 con compresión residual).
   Notas, captions y recorridos con claves SIN prefijo: siguen la config dibujada.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'dpr-bert-base', BI = ['dpr-bert-base', 'sbert-minilm'], CB = 'colbert-v2';
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 'retrieval', section: 'diagrama' };
  const SHARED = 'cfg.shared';
  // pooling por config: [CLS] (fila 0) en DPR; promedio de los T tokens + normalizar en Sentence-BERT (cfg.normalize = 1)
  const POOL_CLS = 'BERT → [CLS] (fila 0)', POOL_MEAN = 'MiniLM → promedio + normalizar';

  // ------------------------------------------------------------------ (a) vista general: offline y online
  ATLAS.registerDiagram(Object.assign({
    id: 'retrieval-overview', model: 'retrieval', config: C, configs: BI, configsNote: 'es el pipeline de un bi-encoder; el cross-encoder y ColBERT tienen sus vistas', kind: 'arch',
    title: 'Recuperación densa: offline y online',
    caption: 'Búsqueda = "codificar una vez, comparar rápido". Offline (marco ámbar): cada documento del corpus pasa UNA vez por el encoder y su vector se guarda en un índice. Online (marco azul), por cada consulta: un solo pase del encoder de queries, la búsqueda de los k vectores más parecidos (aquí exacta, N productos punto; un índice ANN la hace sublineal, #ann) y un cross-encoder que relee los k pares (query, documento) juntos y los reordena. Las píldoras dicen cuántas veces corre cada red. Abajo, a qué se va el cómputo de UNA consulta: el reranker domina.',
    grid: { w: 150, h: 80 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['ann-search', 'reranker'], mobileFocusPad: 1,
    edgeLegend: { control: 'Vuelve a leer el texto (no un vector)' },
    legendText: { runs: 'Veces que corre por consulta', runsOnce: 'Veces que corre offline (una vez por documento, antes de las consultas)', tie: 'Pesos compartidos: la misma red codifica queries y documentos (siamés)', costSplit: 'Cómputo de una consulta: ancho proporcional a los MACs (del calculador)' },
    groups: [
      { id: 'offline', style: 'lane', tone: 'warn', label: 'Offline · una vez por corpus', legend: 'Marco ámbar: offline (una vez por documento; se guarda en el índice)',
        label2: 'N × ' + q('metrics.docEncodeMacs') + ' = ' + q('metrics.corpusEncodeMacs') + ' · índice ' + q('metrics.embeddingIndexBytes'), x: 0.5, y: 0.5, w: 149, h: 25 },
      { id: 'online', style: 'lane', tone: 'accent', label: 'Online · por cada consulta', legend: 'Marco azul: online (en cada consulta)', labelPos: 'bottom',
        label2: q('metrics.onlineMacsPerQuery') + ' por consulta · ' + q('metrics.rerankShareOnline') + ' en el reranker', label2Pos: 'bottom-right', x: 0.5, y: 29.5, w: 149, h: 30 },
    ],
    nodes: [
      { id: 'corpus', op: 'io', style: 'store', modality: 'txt', label: 'Corpus', sub: 'N documentos', subNum: '{{cfg.N}} pasajes', x: 3, y: 7, w: 19, h: 13,
        note: 'Todos los documentos (pasajes) donde se busca: {{cfg.N}} en esta config. Cada uno con hasta T_d = {{cfg.Td}} tokens.' },
      { id: 'doc-encoder', op: 'attn', style: 'block', modality: 'txt', costOf: 'doc-encoder', label: 'Encoder de documentos', sub: POOL_CLS, subNum: '{{cfg.L}} capas × {{cfg.D}} → [CLS] → {{cfg.dim}}', runs: '× {{cfg.N}} docs', runsTone: 'once', expand: 'bi-vs-cross',
        when: [{ if: SHARED, set: { sub: 'mismos pesos que el de queries', subNum: 'mismos pesos que el de queries' } }],
        x: 29, y: 7, w: 28, h: 13,
        note: 'Un BERT ({{cfg.L}} capas de {{cfg.D}}) que convierte cada documento en UN vector de {{cfg.dim}}: {{metrics.docEncodeMacs}} por documento, {{metrics.corpusEncodeMacs}} para todo el corpus (≈ {{metrics.corpusEncodeTime}} en una H100 al pico). Se paga una sola vez: por eso el bi-encoder escala.' },
      { id: 'index', op: 'io', style: 'store', label: 'Índice de vectores', sub: 'N × dim', blankSub: 'los vectores del corpus', subNum: '{{metrics.embeddingIndexBytes}} ({{cfg.bits}} bits)', costOf: 'index', x: 65, y: 7, w: 28, h: 13,
        note: 'Los N vectores guardados: N × dim × bits/8 = {{metrics.embeddingIndexBytes}}. Con 8 bits o 1 bit por número (cuantización) baja 4× o 32×; con un índice ANN (HNSW, IVF-PQ: #ann) la búsqueda deja de mirar los N.' },
      { id: 'query', op: 'io', modality: 'txt', label: 'Consulta', sub: 'T_q tokens', subNum: 'T_q = {{cfg.Tq}} tokens', x: 3, y: 38, w: 19, h: 9, note: 'El texto que escribe el usuario, como ids de WordPiece.' },
      { id: 'query-encoder', op: 'attn', style: 'block', modality: 'txt', costOf: 'query-encoder', label: 'Encoder de queries', sub: POOL_CLS, subNum: '{{cfg.L}} capas × {{cfg.D}} → [CLS] → {{cfg.dim}}', runs: '× 1', expand: 'bi-vs-cross',
        when: [{ if: 'cfg.normalize', set: { sub: POOL_MEAN, subNum: '{{cfg.L}} capas × {{cfg.D}} → promedio → {{cfg.dim}}' } }],
        x: 29, y: 36.5, w: 28, h: 12,
        note: 'Un pase por consulta ({{metrics.queryEncodeMacs}}; ≈ {{metrics.queryEncodeMs}} ms en una H100). En DPR es una torre aparte (pesos propios); en Sentence-BERT, la misma red que la de documentos.' },
      { id: 'ann-search', op: 'fuse', costOf: 'ann-search', label: 'Búsqueda top-k', sub: 'q · cada vector del índice', subNum: 'exacta: N × {{cfg.dim}} MACs → top-{{cfg.k}}', x: 65, y: 36.5, w: 28, h: 12,
        xref: [{ href: '#ann.diagrama~ann-overview.hnsw-search', label: 'Ver los índices ANN (HNSW, IVF-PQ)' }],
        tex: '\\mathrm{top}\\text{-}k_{\\,d}\\ \\ e_q \\cdot e_d', note: 'Aquí, búsqueda exacta: el producto punto de q con los N vectores ({{metrics.bruteForceMacs}}, limitada por memoria: ≈ {{metrics.bruteForceMsCpu}} ms en una CPU de 1 socket) y los k = {{cfg.k}} mejores. Un índice ANN (HNSW, IVF-PQ) mira una fracción chica del índice.' },
      { id: 'reranker', op: 'attn', style: 'block', modality: 'txt', costOf: 'rerank', label: 'Reranker (cross-encoder)', sub: '[CLS] q [SEP] d [SEP] → puntaje', runs: '× {{cfg.k}} pares', repK: 'cfg.k', expand: 'bi-vs-cross', x: 100, y: 36.5, w: 28, h: 12,
        note: 'Un cross-encoder (MiniLM-L6) lee query y documento JUNTOS y da un puntaje: {{metrics.crossEncoderMacsPerPair}} por par, {{metrics.rerankMacs}} para los k = {{cfg.k}} candidatos (≈ {{metrics.rerankMs}} ms en una H100). Más preciso que el producto punto, pero imposible sobre los N.' },
      { id: 'results', op: 'io', label: 'Resultados', sub: 'k ordenados', subNum: '{{cfg.k}} ordenados', x: 134, y: 38, w: 14, h: 9, note: 'Los k documentos, ordenados por el puntaje del reranker.' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Cómputo por consulta', x: 1, y: 62, w: 148, h: 16,
        costSplit: { segs: [
          { op: 'attn', n: 'metrics.queryEncodeMacs', label: 'Codificar la query (× 1)' },
          { op: 'fuse', n: 'metrics.bruteForceMacs', label: 'Buscar: q contra los N vectores (exacta)' },
          { op: 'head', n: 'metrics.rerankMacs', label: 'Rerankear los k pares (cross-encoder × {{cfg.k}})' },
        ], pct1: 'all', legendSegs: true, caption: 'total {{metrics.onlineMacsPerQuery}} por consulta · offline, una vez: {{metrics.corpusEncodeMacs}} (N × {{metrics.docEncodeMacs}})' },
        note: 'MACs de una consulta, del calculador. La búsqueda exacta hace pocos MACs pero lee todo el índice ({{metrics.embeddingIndexBytes}}): está limitada por memoria.' },
    ],
    tensors: [
      { id: 'd-emb', at: { edge: 'doc-encoder>index' }, show: 'both' },
      { id: 'q-emb', at: { edge: 'query-encoder>ann-search' }, show: 'both' },
    ],
    edges: [
      { from: 'corpus', to: 'doc-encoder', kind: 'data', tensor: 'd-ids', labelSide: 'above', labelT: 0.5 },
      { from: 'doc-encoder', to: 'index', kind: 'data', tensor: 'd-emb', labelT: 0.5 },
      { from: 'index', to: 'ann-search', kind: 'data', tensor: 'doc-index', labelSide: 'right', labelT: 0.45 },
      { from: 'query', to: 'query-encoder', kind: 'data', tensor: 'q-ids', labelSide: 'above', labelT: 0.5 },
      { from: 'query-encoder', to: 'ann-search', kind: 'data', tensor: 'q-emb', labelT: 0.5 },
      { from: 'ann-search', to: 'reranker', kind: 'data', tensor: 'topk-ids', labelSide: 'above', labelT: 0.5 },
      { from: 'reranker', to: 'results', kind: 'data', tensor: 'rerank-scores', label: false },
      // el reranker vuelve a leer el TEXTO de la query (no su vector) y el de los k candidatos
      { from: 'query', to: 'reranker', kind: 'control', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[12.5, 53], [114, 53]], tag: 'texto de la query (+ el de los k documentos)', tagBlank: 'texto', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 'doc-encoder', to: 'query-encoder', kind: 'control', tie: true, when: SHARED, fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.5, tag: 'mismos pesos', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (una búsqueda)', steps: [
        { nodes: ['corpus', 'doc-encoder'], edges: ['corpus>doc-encoder'], tensors: ['d-ids'],
          text: 'Offline: cada uno de los ' + q('cfg.N') + ' documentos (<b>' + q('tensor.d-ids.shape') + '</b> tokens) pasa por el encoder: ' + q('metrics.docEncodeMacs') + ' por documento, ' + q('metrics.corpusEncodeMacs') + ' en total, una sola vez.' },
        { nodes: ['doc-encoder', 'index'], edges: ['doc-encoder>index'], tensors: ['d-emb', 'doc-index'],
          text: 'Cada documento queda como UN vector de <b>' + q('tensor.d-emb.shape') + '</b>; el índice guarda <b>' + q('tensor.doc-index.shape') + '</b> = ' + q('metrics.embeddingIndexBytes') + ' a ' + q('cfg.bits') + ' bits.' },
        { expand: 'bi-vs-cross', nodes: ['bi-q-tower', 'bi-d-tower', 'bi-score'], edges: ['bi-q-tower>bi-score', 'bi-d-tower>bi-score'], tensors: ['q-emb', 'd-emb'],
          text: 'Bi-encoder: la query y el documento se codifican POR SEPARADO; el puntaje es solo un producto punto. Por eso el lado de los documentos se puede precalcular.' },
        { nodes: ['query', 'query-encoder'], edges: ['query>query-encoder', 'query-encoder>ann-search'], tensors: ['q-ids', 'q-emb'],
          text: 'Online: la consulta (<b>' + q('tensor.q-ids.shape') + '</b> tokens) pasa UNA vez por el encoder: ' + q('metrics.queryEncodeMacs') + ' → <b>' + q('tensor.q-emb.shape') + '</b>.' },
        { nodes: ['ann-search', 'index'], edges: ['index>ann-search', 'query-encoder>ann-search', 'ann-search>reranker'], tensors: ['doc-index', 'topk-ids'],
          text: 'Búsqueda exacta: ' + q('cfg.N') + ' productos punto (' + q('metrics.bruteForceMacs') + ', leyendo ' + q('metrics.embeddingIndexBytes') + ') → top-' + q('cfg.k') + ': <b>' + q('tensor.topk-ids.shape') + '</b> ids. Un índice ANN (#ann) evita leer todo.' },
        { nodes: ['reranker', 'results'], edges: ['ann-search>reranker', 'query>reranker', 'reranker>results'], tensors: ['topk-ids', 'rerank-scores'],
          text: 'Reranker: ' + q('cfg.k') + ' pares [CLS] q [SEP] d [SEP] de <b>' + q('tensor.r-ids.shape') + '</b> tokens por un cross-encoder: ' + q('metrics.rerankMacs') + ', ' + q('metrics.rerankShareOnline') + ' del cómputo de la consulta.' },
        { expand: 'bi-vs-cross', nodes: ['cx-encoder', 'cx-head'], edges: ['cx-pair>cx-encoder', 'cx-encoder>cx-pooler', 'cx-pooler>cx-head', 'cx-head>cx-out'], tensors: ['r-ids', 'r-x-out', 'r-pooled', 'r-score'],
          text: 'Cross-encoder: query y documento entran JUNTOS; la atención cruza los tokens de ambos y una cabeza D → 1 da el puntaje. Hacerlo con los N documentos costaría ' + q('metrics.crossEncoderFullScanMacs') + ' por consulta: millones de veces lo del bi-encoder (' + q('metrics.queryEncodeMacs') + ' + ' + q('metrics.bruteForceMacs') + ').' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) bi-encoder vs cross-encoder
  ATLAS.registerDiagram(Object.assign({
    id: 'bi-vs-cross', model: 'retrieval', config: C, configs: BI, configsNote: 'compara el bi-encoder de esta config con su reranker', kind: 'arch',
    title: 'Bi-encoder vs cross-encoder', parent: 'retrieval-overview', parentNode: 'reranker',
    caption: 'Bi-encoder (marco azul): dos torres (o la misma, siamés) codifican query y documento POR SEPARADO; el puntaje es un producto punto entre dos vectores. Como el documento no ve la query, su vector se calcula offline y se indexa. Cross-encoder (marco violeta): un solo encoder lee el par concatenado: cada token de la query atiende a cada token del documento, y una cabeza D → 1 da el puntaje. Es más preciso, pero corre una vez por par y no admite índice: sirve para rerankear k candidatos, no para buscar entre N. Abajo, los MACs de una consulta en escala lineal (y lo que el bi-encoder pagó offline para indexar).',
    grid: { w: 124, h: 76 }, direction: 'tb', maxCrossings: 0,
    // bajo 640 px: carriles apilados (bi arriba, cross abajo) y las barras a lo ancho con el rótulo arriba (node.mobile)
    mobileGrid: { w: 48, h: 150 },
    mobileFocus: ['bi-q-tower', 'bi-d-tower', 'bi-score'],
    mobileFocusFrom: { reranker: ['cx-pair', 'cx-encoder', 'cx-head'] },
    legendText: { runs: 'Veces que corre por consulta', runsOnce: 'Veces que corre offline (una vez por documento)', tie: 'Pesos compartidos (siamés): la misma red en las dos torres', bars: 'MACs por consulta: ancho proporcional (lineal; del calculador)' },
    groups: [
      { id: 'bi', style: 'lane', tone: 'accent', label: 'Bi-encoder · dos vectores, producto punto', legend: 'Marco azul: bi-encoder', x: 0.5, y: 0.5, w: 59, h: 55, mobile: { x: 0.5, y: 0.5, w: 47, h: 56 } },
      { id: 'cx', style: 'lane', tone: 'fuse', label: 'Cross-encoder · un encoder sobre el par', legend: 'Marco violeta: cross-encoder', x: 64, y: 0.5, w: 59.5, h: 55, mobile: { x: 0.5, y: 58.5, w: 47, h: 55 } },
    ],
    nodes: [
      { id: 'bi-q', op: 'io', modality: 'txt', label: 'Query', sub: 'T_q tokens', x: 3, y: 6, w: 24, h: 7, mobile: { x: 2, y: 6, w: 21 }, note: 'El texto de la consulta: T_q = {{cfg.Tq}} tokens de WordPiece.' },
      { id: 'bi-d', op: 'io', modality: 'txt', label: 'Documento', sub: 'T_d tokens', x: 33, y: 6, w: 24, h: 7, mobile: { x: 25, y: 6, w: 21 }, note: 'Un documento del corpus (T_d = {{cfg.Td}} tokens). Se codifica sin ver la query.' },
      { id: 'bi-q-tower', op: 'attn', style: 'block', modality: 'txt', costOf: 'query-encoder', label: 'Torre de queries', sub: POOL_CLS, runs: '× 1', x: 3, y: 18, w: 24, h: 9, mobile: { x: 2, y: 18, w: 21 },
        when: [{ if: 'cfg.normalize', set: { sub: POOL_MEAN } }],
        note: 'BERT y un pooling → un vector por consulta. DPR toma el vector de [CLS] (la fila 0 de la salida, sin el pooler de NSP); Sentence-BERT promedia los T vectores de los tokens (sin contar el relleno) y normaliza a norma 1, así el producto punto es el coseno.' },
      { id: 'bi-d-tower', op: 'attn', style: 'block', modality: 'txt', costOf: 'doc-encoder', label: 'Torre de documentos', sub: POOL_CLS, runs: '× N', runsTone: 'once', x: 33, y: 18, w: 24, h: 9, mobile: { x: 25, y: 18, w: 21 },
        when: [{ if: SHARED, set: { sub: 'la misma red (siamés)' } }],
        note: 'Un vector por documento, calculado offline. En DPR, una red aparte; en Sentence-BERT, la misma que la de queries.' },
      { id: 'bi-score', op: 'fuse', ops: ['search'], opsExact: true, label: 'Producto punto', sub: 'e_q · e_d · ↗ ColBERT: token a token', x: 13, y: 35, w: 34, h: 8, mobile: { x: 7, y: 35, w: 34 }, expand: 'colbert-maxsim',
        tex: 's(q, d) = e_q \\cdot e_d', note: 'Un producto punto de dim MACs por documento: {{metrics.bruteForceMacs}} contra los N. Ábrelo para ver ColBERT, que compara token a token (interacción tardía).' },
      { id: 'bi-out', op: 'io', label: 'Un puntaje por documento', sub: 'N · indexable', x: 13, y: 48, w: 34, h: 6, mobile: { x: 7, y: 48, w: 34 }, note: 'El ranking sale de ordenar estos N puntajes (o de un índice ANN).' },
      { id: 'cx-pair', op: 'io', modality: 'txt', label: 'Par concatenado', sub: '[CLS] q [SEP] d [SEP] · T_q + T_d − 1 tokens', x: 70, y: 6, w: 48, h: 7, mobile: { x: 2, y: 64.5, w: 44 }, note: 'El par concatenado en una sola secuencia (segmento A = query, B = documento).' },
      { id: 'cx-encoder', op: 'attn', style: 'block', modality: 'txt', costOf: 'joint-encoder', label: 'Encoder conjunto', sub: 'atención entre los tokens de q y de d', runs: '× k pares', repK: 'cfg.k', x: 76, y: 18, w: 36, h: 9, mobile: { x: 6, y: 76.5, w: 36 },
        note: 'Un BERT (MiniLM-L6 en el reranker de esta config) sobre el par: la atención cruza query y documento en todas las capas. {{metrics.crossEncoderMacsPerPair}} por par.' },
      { id: 'cx-pooler', op: 'embed', ops: ['r-pool-cls', 'r-pooler-dense', 'r-pooler-tanh'], opsExact: true, label: '[CLS] → pooler', sub: 'tanh', repK: 'cfg.k', x: 80, y: 31, w: 28, h: 6, mobile: { x: 10, y: 89.5, w: 28 }, note: 'El vector de [CLS] por una Linear D → D y tanh (BertForSequenceClassification).' },
      { id: 'cx-head', op: 'head', costOf: 'score-head', label: 'Cabeza de puntaje', sub: 'Linear D → 1', repK: 'cfg.k', x: 80, y: 40, w: 28, h: 6, mobile: { x: 10, y: 98.5, w: 28 }, tex: 's(q, d) = w^\\top p + b', note: 'Un número de relevancia por par (D + 1 parámetros). Sin softmax: se ordenan los k puntajes.' },
      { id: 'cx-out', op: 'io', label: 'Un puntaje por par', sub: '× k · no indexable', x: 80, y: 49, w: 28, h: 5.5, mobile: { x: 10, y: 107.5, w: 28 }, note: 'Un número por par (query, documento): para rankear N documentos habría que correr el encoder N veces por consulta.' },
      { id: 'cost-bars', op: 'io', hideInBlank: true, label: 'MACs por consulta', x: 1, y: 59, w: 122, h: 15, mobile: { x: 0.5, y: 116, w: 47, h: 30 },
        bars: { unit: 'macs', labelW: 26, totalW: 13, legend: false, rows: [
          { label: 'Bi-encoder: codificar q + buscar en N', segs: [{ op: 'attn', n: 'metrics.queryEncodeMacs', label: 'codificar' }, { op: 'fuse', n: 'metrics.bruteForceMacs', label: 'buscar' }] },
          { label: 'Cross-encoder sobre k = {{cfg.k}}', segs: [{ op: 'head', n: 'metrics.rerankMacs', label: 'k pares' }] },
          { label: 'Cross-encoder sobre los N', segs: [{ op: 'head', n: 'metrics.crossEncoderFullScanMacs', label: 'N pares' }] },
        ], caption: 'escala lineal: las dos primeras barras no llegan a 1 px; el cross-encoder sobre todo el corpus cuesta millones de veces lo del bi-encoder · el bi-encoder ya pagó antes, offline y una vez: {{metrics.corpusEncodeMacs}} (N × {{metrics.docEncodeMacs}}) para indexar el corpus' },
        note: 'MACs de UNA consulta, del calculador. El orden de magnitud es el argumento: el cross-encoder no puede recorrer el corpus.' },
    ],
    edges: [
      { from: 'bi-q', to: 'bi-q-tower', kind: 'data', tensor: 'q-ids', label: false },
      { from: 'bi-d', to: 'bi-d-tower', kind: 'data', tensor: 'd-ids', label: false },
      { from: 'bi-q-tower', to: 'bi-score', kind: 'data', tensor: 'q-emb', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.21, labelSide: 'left', labelT: 0.5 },
      { from: 'bi-d-tower', to: 'bi-score', kind: 'data', tensor: 'd-emb', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.79, labelSide: 'right', labelT: 0.5 },
      { from: 'bi-score', to: 'bi-out', kind: 'data', tensor: 'doc-scores', label: false },
      { from: 'bi-d-tower', to: 'bi-q-tower', kind: 'control', tie: true, when: SHARED, fromSide: 'left', toSide: 'right', tag: '=', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'cx-pair', to: 'cx-encoder', kind: 'data', tensor: 'r-ids', labelT: 0.5 },
      { from: 'cx-encoder', to: 'cx-pooler', kind: 'data', tensor: 'r-x-out', labelT: 0.5 },
      { from: 'cx-pooler', to: 'cx-head', kind: 'data', tensor: 'r-pooled', label: false },
      { from: 'cx-head', to: 'cx-out', kind: 'data', tensor: 'r-score', label: false },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) ColBERT: interacción tardía
  ATLAS.registerDiagram(Object.assign({
    id: 'colbert-maxsim', model: 'retrieval', config: CB, configs: [CB], configsNote: 'es la vista de ColBERT', kind: 'arch',
    title: 'ColBERT: MaxSim token a token', parent: 'bi-vs-cross', parentNode: 'bi-score',
    caption: 'Interacción tardía (ColBERT): query y documento se codifican POR SEPARADO, como en el bi-encoder (el documento sigue siendo indexable), pero se guarda un vector chico (128) POR TOKEN. El puntaje compara cada token de la query con cada token del documento (la tabla), toma el máximo de cada fila (el token del documento que mejor responde a ese token de la query) y suma. El precio es el índice: T_d vectores por documento en vez de uno.',
    grid: { w: 104, h: 74 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['cb-sim', 'cb-max'],
    legendText: { runs: 'Veces que corre por consulta', runsOnce: 'Veces que corre offline (una vez por documento)', tie: 'Pesos compartidos: un solo BERT codifica query y documento (marcadores [Q] / [D])', cells: 'Tabla T_q × T_d de similitudes (tono ilustrativo); recuadro = el máximo de cada fila' },
    nodes: [
      { id: 'cb-q', op: 'io', modality: 'txt', label: 'Query', sub: '[Q] + T_q tokens', x: 3, y: 1, w: 26, h: 7, note: 'La consulta con el marcador [Q], rellenada con [MASK] hasta T_q = {{cfg.Tq}} tokens.' },
      { id: 'cb-d', op: 'io', modality: 'txt', label: 'Documento', sub: '[D] + T_d tokens', x: 62, y: 1, w: 26, h: 7, note: 'El documento con el marcador [D] (hasta T_d = {{cfg.Td}} tokens), sin ver la query: por eso se indexa offline.' },
      { id: 'cb-q-enc', op: 'attn', style: 'block', modality: 'txt', costOf: 'query-encoder', label: 'BERT + Linear D → 128', sub: 'normalizar cada vector', runs: '× 1', x: 3, y: 13, w: 26, h: 9,
        note: 'BERT-base, una Linear sin sesgo D → {{cfg.dim}} por token y normalización: T_q vectores de {{cfg.dim}} (con relleno de [MASK] hasta T_q = {{cfg.Tq}}: "query augmentation").' },
      { id: 'cb-d-enc', op: 'attn', style: 'block', modality: 'txt', costOf: 'doc-encoder', label: 'El mismo BERT + Linear', sub: 'un vector por token', runs: '× N', runsTone: 'once', x: 62, y: 13, w: 26, h: 9,
        note: 'Los mismos pesos (sin badge: ya están contados a la izquierda). Offline: T_d = {{cfg.Td}} vectores de {{cfg.dim}} por documento ({{metrics.docEncodeMacs}} por documento).' },
      { id: 'cb-index', op: 'io', style: 'store', label: 'Índice por token', sub: 'v1 (fp16) · v2 (residual 2 bits)', subNum: '{{metrics.colbertIndexBytes}} (v1, fp16) · {{metrics.colbertV2IndexBytes}} (v2)', ops: ['index'], opsExact: true, x: 60, y: 28, w: 40, h: 11,
        note: '{{metrics.tokenVectors}} vectores para el corpus: {{metrics.colbertIndexBytes}} en fp16 (ColBERT v1). ColBERTv2 guarda cada vector como el id de un centroide + el residuo a 2 bits por dimensión ({{metrics.colbertV2BytesPerVector}} por vector): {{metrics.colbertV2IndexBytes}}. Un bi-encoder del mismo corpus (un vector de {{cfg.dim}} por documento, a {{cfg.bits}} bits): {{metrics.embeddingIndexBytes}}.' },
      { id: 'cb-sim', op: 'fuse', ops: ['sim'], opsExact: true, label: 'Similitud token a token', sub: 'E_q E_dᵀ', x: 14, y: 30, w: 40, h: 26,
        cells: { rows: 'cfg.Tq', cols: 'cfg.Td', maxR: 8, maxC: 16, mark: 'rowmax', sum: 'Σ', label: 'T_q = {{cfg.Tq}} filas × T_d = {{cfg.Td}} columnas', seed: 23 },
        tex: 'S = E_q E_d^{\\top} \\in \\mathbb{R}^{T_q \\times T_d}', note: 'Cada fila: un token de la query contra los T_d del documento ({{metrics.maxsimMacsPerDoc}} por documento). Los tonos son ilustrativos: lo que importa es la forma y el máximo por fila.' },
      { id: 'cb-max', op: 'tensorop', shape: 'pill', symbol: 'pool', label: 'máx por fila', ops: ['max'], opsExact: true, x: 22, y: 60, w: 24, h: 4,
        tex: 'm_i = \\max_j\\, q_i \\cdot d_j', note: 'Para cada token de la query, el mejor token del documento.' },
      { id: 'cb-sum', op: 'tensorop', shape: 'add', label: 'Σ sobre la query', labelPos: 'left', ops: ['sum'], opsExact: true, x: 32, y: 68, w: 4, h: 4,
        tex: 's(q, d) = \\textstyle\\sum_i m_i', note: 'El puntaje del par.' },
      { id: 'cb-out', op: 'io', label: 'Puntaje del par', x: 42, y: 67.5, w: 18, h: 5, note: 'Un número por (query, documento). En ColBERTv2, los candidatos salen de los centroides más cercanos a cada token de la query, y MaxSim los ordena.' },
    ],
    edges: [
      { from: 'cb-q', to: 'cb-q-enc', kind: 'data', tensor: 'q-ids', label: false },
      { from: 'cb-d', to: 'cb-d-enc', kind: 'data', tensor: 'd-ids', label: false },
      { from: 'cb-d-enc', to: 'cb-q-enc', kind: 'control', tie: true, fromSide: 'left', toSide: 'right', tag: 'mismos pesos', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'cb-q-enc', to: 'cb-sim', kind: 'data', tensor: 'q-emb', fromSide: 'bottom', toSide: 'top', fromAt: 0.6, toAt: 0.2, labelSide: 'left', labelT: 0.6 },
      { from: 'cb-d-enc', to: 'cb-index', kind: 'data', tensor: 'd-emb', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.6, labelSide: 'right', labelT: 0.5 },
      { from: 'cb-index', to: 'cb-sim', kind: 'data', tensor: 'd-emb', fromSide: 'left', toSide: 'right', toAt: 0.3, label: false },
      { from: 'cb-sum', to: 'cb-out', kind: 'data', tensor: 'score', label: false },
      { from: 'cb-sim', to: 'cb-max', kind: 'data', tensor: 'sim', labelSide: 'right', labelT: 0.5 },
      { from: 'cb-max', to: 'cb-sum', kind: 'data', tensor: 'sim-max', labelSide: 'right', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
