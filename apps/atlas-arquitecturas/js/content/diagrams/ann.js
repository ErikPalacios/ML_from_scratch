/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/ann.js
   Diagramas de búsqueda de vecinos aproximada (SPEC §7.2, ids de §23.3), modelo `ann` (js/arch/retrieval.js):
     ann-overview   la misma query contra tres índices de 1M vectores de 768, uno por carril: flat (fuerza bruta), HNSW (grafo)
                    e IVF-PQ (listas + códigos). Cada arista toma su forma de SU config (edge.config: flat-1m-768, hnsw-1m-768,
                    ivfpq-1m-768); memoria, distancias por query y latencia ≈ en los subtítulos, de ATLAS.Arch.metrics.
       ann-costs    barras a escala (lineal) de las tres configs: memoria del índice por partes, distancias por query y bytes
                    leídos por query (con la latencia ≈ en CPU). Grilla angosta (mobileGrid) bajo 640 px.
       hnsw-layers  el grafo por capas (pictograma ilustrativo: la ruta codiciosa de arriba abajo) y las dos fases de la búsqueda:
                    capas de arriba con ef = 1 y la capa 0 con efSearch; costos del calculador (config hnsw-1m-768).
       ivfpq        cuantizador grueso (q contra n_list centroides) → n_probe listas → residuo → tablas ADC (m × k_s) → recorrer
                    los códigos PQ de las listas (m lecturas por código) → top-k. Configs ivfpq-1m-768 e ivfpq-1b-768.
   Notas, captions y recorridos: claves con prefijo de config cuando nombran OTRA columna; sin prefijo cuando siguen la dibujada.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas y números: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const FL = 'flat-1m-768', HN = 'hnsw-1m-768', IV = 'ivfpq-1m-768', IVB = 'ivfpq-1b-768';
  const ONE = [HN, IV, FL];
  const k = (cfg, key) => '{{' + cfg + '.' + key + '}}';
  const q = (key) => '{{' + key + '}}';
  const PAGE = { page: 'ann', section: 'diagrama' };

  // ------------------------------------------------------------------ (a) vista general: flat vs HNSW vs IVF-PQ
  // carril y0: índice arriba (y0 + 3), búsqueda abajo (y0 + 13), top-k a la derecha; la query entra por la izquierda
  const lane = (y0) => ({ idx: y0 + 2, srch: y0 + 14 });
  const L1 = lane(1), L2 = lane(24), L3 = lane(47);
  ATLAS.registerDiagram(Object.assign({
    id: 'ann-overview', model: 'ann', config: HN, configs: ONE, configsNote: 'compara los tres índices de 1M vectores; la de mil millones está en la vista de IVF-PQ', kind: 'arch',
    title: 'ANN: flat vs HNSW vs IVF-PQ',
    caption: 'La misma query (un vector de 768) contra tres índices del mismo millón de vectores. Flat compara con todos: exacto, pero lee el índice entero en cada búsqueda. HNSW guarda además un grafo y salta de vecino en vecino: unas miles de distancias en vez de un millón, a cambio de un poco más de memoria. IVF-PQ agrupa los vectores en listas, recorre solo n_probe de ellas y guarda cada vector como un código de m bytes: ' + k(IV, 'metrics.indexBytes') + ' en vez de ' + k(FL, 'metrics.indexBytes') + ', con distancias aproximadas. Números del calculador; las latencias son cotas inferiores en una CPU de 1 socket (solo el ancho de banda de memoria: los saltos aleatorios del grafo y las cachés no entran). El carril de la config elegida arriba va con marco continuo. Abre un índice para verlo a escala, o una búsqueda para verla por dentro.',
    grid: { w: 100, h: 70 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['query', 'flat-scan', 'ivfpq-search'], mobileFocusPad: 1,
    edgeLegend: { control: 'Lee parte del índice (los códigos de n_probe listas)' },
    groups: [
      { id: 'lane-flat', config: FL, style: 'lane', tone: 'muted', label: 'Flat · fuerza bruta (exacto)', legend: 'Marco gris: flat', labelPos: 'right', x: 17, y: 1, w: 82, h: 21 },
      { id: 'lane-hnsw', config: HN, style: 'lane', tone: 'accent', label: 'HNSW · grafo navegable', legend: 'Marco azul: HNSW', labelPos: 'right', x: 17, y: 24, w: 82, h: 21 },
      { id: 'lane-ivfpq', config: IV, style: 'lane', tone: 'fuse', label: 'IVF-PQ · listas + códigos', legend: 'Marco violeta: IVF-PQ', labelPos: 'right', x: 17, y: 47, w: 82, h: 21 },
    ],
    nodes: [
      { id: 'query', op: 'io', modality: 'txt', label: 'Query', sub: 'un vector de d', subNum: 'd = {{cfg.d}}', x: 1, y: 10, w: 14, h: 56,
        note: 'El vector de la consulta (del encoder de queries de DPR: {{metrics.encodeMacs}} en una H100, ≈ {{metrics.encodeMsH100}} ms). Los tres índices reciben el mismo.' },
      // flat
      { id: 'flat-index', op: 'io', style: 'store', label: 'Vectores tal cual', sub: 'N × d en fp32', subNum: k(FL, 'metrics.indexBytes') + ' · ' + k(FL, 'metrics.bytesPerVector') + ' por vector', expand: 'ann-costs', x: 20, y: L1.idx, w: 36, h: 7,
        note: 'N × d × 4 bytes = ' + k(FL, 'metrics.indexBytes') + '. Nada más: no hay estructura que construir.' },
      { id: 'flat-scan', op: 'fuse', costRef: { config: FL, nodes: ['scan'] }, label: 'q contra los N → top-k', sub: 'N distancias', subNum: k(FL, 'metrics.distanceComputations') + ' distancias exactas', x: 20, y: L1.srch, w: 36, h: 6,
        costNote: 'De la config ' + FL + '.', note: 'Un producto punto por vector: ' + k(FL, 'metrics.searchMacs') + ' y, sobre todo, leer ' + k(FL, 'metrics.bytesTouchedPerQuery') + ' por query: limitada por memoria (≈ ' + k(FL, 'metrics.latencyMs') + ' ms en 1 socket de CPU).' },
      { id: 'flat-topk', op: 'io', label: 'k vecinos (exactos)', sub: '≈ ms', subNum: '≈ ' + k(FL, 'metrics.latencyMs') + ' ms', x: 70, y: L1.srch + 1, w: 26, h: 4, note: 'Los k más cercanos de verdad (recall = 1).' },
      // HNSW
      { id: 'hnsw-index', op: 'io', style: 'store', label: 'Vectores + grafo', sub: 'N × d + enlaces', subNum: k(HN, 'metrics.indexBytes') + ' (' + k(HN, 'metrics.linkBytes') + ' de enlaces)', expand: 'ann-costs', x: 20, y: L2.idx, w: 36, h: 7,
        note: 'Los vectores completos más el grafo: 2M = ' + k(HN, 'cfg.M') + ' × 2 enlaces int32 por nodo en la capa 0 y M en las de arriba (' + k(HN, 'metrics.linkBytes') + '). Construirlo cuesta ≈ ' + k(HN, 'metrics.buildMacs') + '.' },
      { id: 'hnsw-search', op: 'fuse', costRef: { config: HN, nodes: ['graph-walk'] }, label: 'Bajar por el grafo → top-k', sub: 'codiciosa + lista de efSearch', subNum: '≈ ' + k(HN, 'metrics.distanceComputations') + ' distancias (efSearch = ' + k(HN, 'cfg.efSearch') + ')', expand: 'hnsw-layers', x: 20, y: L2.srch, w: 36, h: 6,
        costNote: 'De la config ' + HN + ' (≈).', note: 'Entra por la capa de arriba, baja saltando al vecino más cercano y en la capa 0 mantiene una lista de efSearch candidatos: ≈ ' + k(HN, 'metrics.distanceComputations') + ' distancias, ' + k(HN, 'metrics.distanceRatioVsFlat') + ' veces menos que flat. Ábrela para ver las capas.' },
      { id: 'hnsw-topk', op: 'io', label: 'k vecinos (aprox.)', sub: '≥ ms (cota)', subNum: '≥ ' + k(HN, 'metrics.latencyMs') + ' ms (cota)', x: 70, y: L2.srch + 1, w: 26, h: 4, note: 'Los k mejores de la lista: casi siempre los verdaderos (recall@10 alto con efSearch suficiente; ver la página). La latencia es una cota inferior: cuenta solo los bytes leídos ÷ el ancho de banda; los accesos aleatorios del grafo la suben (FAISS mide ≈ 0.03 ms con efSearch 64 y 20 hilos, más con un hilo).' },
      // IVF-PQ
      { id: 'ivfpq-index', op: 'io', style: 'store', label: 'Códigos PQ en n_list listas', sub: 'N × m bytes + ids', subNum: k(IV, 'metrics.indexBytes') + ' · ' + k(IV, 'metrics.bytesPerVector') + ' por vector', expand: 'ann-costs', x: 20, y: L3.idx, w: 36, h: 7,
        note: 'Cada vector como m = ' + k(IV, 'cfg.m') + ' sub-códigos de ' + k(IV, 'cfg.nbits') + ' bits (' + k(IV, 'metrics.compression') + '× menos que fp32) más su id de 8 bytes, repartidos en ' + k(IV, 'cfg.nlist') + ' listas. Entrenarlo (k-means) cuesta ≈ ' + k(IV, 'metrics.buildMacs') + '.' },
      { id: 'ivfpq-search', op: 'fuse', costRef: { config: IV, nodes: ['coarse', 'list-scan'] }, label: 'n_probe listas + ADC → top-k', sub: 'centroides + códigos de las listas', subNum: k(IV, 'metrics.coarseDistances') + ' centroides + ' + k(IV, 'metrics.scannedVectors') + ' códigos', expand: 'ivfpq', x: 20, y: L3.srch, w: 36, h: 6,
        costNote: 'De la config ' + IV + '. Los "parámetros" son los centroides y los codebooks: datos del índice, no pesos entrenados por gradiente.', note: 'Compara q con los ' + k(IV, 'cfg.nlist') + ' centroides, recorre las ' + k(IV, 'cfg.nprobe') + ' listas más cercanas (≈ ' + k(IV, 'metrics.scannedVectors') + ' vectores) y estima cada distancia con m lecturas de tabla. Ábrela para ver el detalle.' },
      { id: 'ivfpq-topk', op: 'io', label: 'k vecinos (aprox.)', sub: '≥ ms (cota)', subNum: '≥ ' + k(IV, 'metrics.latencyMs') + ' ms (cota)', x: 70, y: L3.srch + 1, w: 26, h: 4, note: 'Distancias aproximadas (PQ) y solo n_probe listas: el recall depende de n_probe y de m. La latencia es una cota inferior (bytes leídos ÷ ancho de banda); casi toda es leer los ' + k(IV, 'cfg.nlist') + ' centroides, que en la práctica viven en caché.' },
    ],
    edges: [
      { from: 'query', to: 'flat-scan', kind: 'data', tensor: 'query', config: FL, fromSide: 'right', toSide: 'left', fromAt: 0.1429, label: false },
      { from: 'query', to: 'hnsw-search', kind: 'data', tensor: 'query', config: HN, fromSide: 'right', toSide: 'left', fromAt: 0.5536, labelSide: 'above', labelT: 0.5 },
      { from: 'query', to: 'ivfpq-search', kind: 'data', tensor: 'query', config: IV, fromSide: 'right', toSide: 'left', fromAt: 0.9643, label: false },
      { from: 'flat-index', to: 'flat-scan', kind: 'data', tensor: 'xb', config: FL, labelSide: 'right', labelT: 0.5 },
      { from: 'hnsw-index', to: 'hnsw-search', kind: 'data', tensor: 'links', config: HN, labelSide: 'right', labelT: 0.5 },
      // IVF-PQ no guarda los vectores: la búsqueda lee los códigos de n_probe listas (su forma, N × m, va en el subtítulo del índice)
      { from: 'ivfpq-index', to: 'ivfpq-search', kind: 'control', tag: 'lee n_probe listas', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'flat-scan', to: 'flat-topk', kind: 'data', tensor: 'ids', config: FL, labelSide: 'above', labelT: 0.5 },
      { from: 'hnsw-search', to: 'hnsw-topk', kind: 'data', tensor: 'ids', config: HN, labelSide: 'above', labelT: 0.5 },
      { from: 'ivfpq-search', to: 'ivfpq-topk', kind: 'data', tensor: 'ids', config: IV, labelSide: 'above', labelT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (una query, tres índices)', steps: [
        { nodes: ['query', 'flat-index', 'flat-scan', 'flat-topk'], edges: ['query>flat-scan', 'flat-index>flat-scan', 'flat-scan>flat-topk'], tensors: [],
          text: 'Flat: ' + k(FL, 'metrics.distanceComputations') + ' productos punto de ' + k(FL, 'cfg.d') + ' y leer ' + k(FL, 'metrics.bytesTouchedPerQuery') + ' por query. Con el ancho de banda de memoria de 1 socket de CPU eso es ≈ ' + k(FL, 'metrics.latencyMs') + ' ms: el cuello es la memoria, no los MACs.' },
        { nodes: ['hnsw-index', 'hnsw-search'], edges: ['hnsw-index>hnsw-search', 'query>hnsw-search'], tensors: [],
          text: 'HNSW: el índice crece a ' + k(HN, 'metrics.indexBytes') + ' (de ellos, ' + k(HN, 'metrics.linkBytes') + ' de enlaces) y la búsqueda mira ≈ ' + k(HN, 'metrics.distanceComputations') + ' vectores: ≈ ' + k(HN, 'metrics.bytesTouchedPerQuery') + ' leídos, ≈ ' + k(HN, 'metrics.latencyMs') + ' ms.' },
        { expand: 'hnsw-layers', nodes: ['hl-graph', 'hl-upper', 'hl-layer0'], edges: ['hl-query>hl-upper', 'hl-upper>hl-layer0'], tensors: ['entry', 'cands'],
          text: 'Por dentro: ' + k(HN, 'metrics.levels') + ' capas de arriba con ef = 1 (un salto codicioso tras otro) y la capa 0 con una lista de efSearch = ' + k(HN, 'cfg.efSearch') + ' candidatos: <b>' + k(HN, 'tensor.cands.shape') + '</b>.' },
        { nodes: ['ivfpq-index', 'ivfpq-search', 'ivfpq-topk'], edges: ['ivfpq-index>ivfpq-search', 'query>ivfpq-search', 'ivfpq-search>ivfpq-topk'], tensors: [],
          text: 'IVF-PQ: ' + k(IV, 'metrics.indexBytes') + ' en total (' + k(IV, 'metrics.bytesPerVector') + ' por vector); la query mira ' + k(IV, 'metrics.coarseDistances') + ' centroides y ' + k(IV, 'metrics.scannedVectors') + ' códigos: ≈ ' + k(IV, 'metrics.latencyMs') + ' ms.' },
        { expand: 'ivfpq', nodes: ['iv-lut', 'iv-adc'], edges: ['iv-residual>iv-lut', 'iv-lut>iv-adc', 'iv-codes>iv-adc'], tensors: ['lut', 'adc-dists'],
          text: 'Por dentro: ' + k(IV, 'cfg.nprobe') + ' tablas de ' + k(IV, 'cfg.m') + ' × ' + k(IV, 'cfg.ksub') + ' distancias, una por lista recorrida (<b>' + k(IV, 'tensor.lut.shape') + '</b>), y, por cada código recorrido, ' + k(IV, 'cfg.m') + ' lecturas de tabla y sumas: <b>' + k(IV, 'tensor.adc-dists.shape') + '</b> distancias aproximadas.' },
        { expand: 'ann-costs', nodes: ['ac-mem', 'ac-dist', 'ac-bytes'], edges: [], tensors: [],
          text: 'A escala: flat ' + k(FL, 'metrics.indexBytes') + ', HNSW ' + k(HN, 'metrics.indexBytes') + ', IVF-PQ ' + k(IV, 'metrics.indexBytes') + '. La memoria decide a partir de cientos de millones de vectores; ahí IVF-PQ (o DiskANN) es lo que entra.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) costos a escala
  const SEG_MEM = {
    [FL]: [{ op: 'embed', n: 'metrics.vectorBytes', label: 'vectores' }],
    [HN]: [{ op: 'embed', n: 'metrics.vectorBytes', label: 'vectores' }, { op: 'attn', n: ['metrics.linkBytes', 'metrics.levelBytes'], label: 'grafo' }],
    [IV]: [{ op: 'conv', n: 'metrics.codeBytes', label: 'códigos PQ' }, { op: 'norm', n: ['metrics.idBytes', 'metrics.centroidBytes', 'metrics.codebookBytes', 'metrics.listSizeBytes', 'metrics.coarseLinkBytes'], label: 'ids, centroides, codebooks' }],
  };
  const ROWS = (label, extra) => [FL, HN, IV].map((c) => Object.assign({ config: c, label: { [FL]: 'Flat', [HN]: 'HNSW', [IV]: 'IVF-PQ' }[c] }, extra ? extra(c) : {}));
  ATLAS.registerDiagram(Object.assign({
    id: 'ann-costs', model: 'ann', config: HN, configs: ONE, configsNote: 'compara los tres índices de 1M vectores', kind: 'arch',
    title: 'Memoria y costo por query, a escala', parent: 'ann-overview', parentNode: 'hnsw-index',
    caption: 'Las tres configs en la MISMA escala lineal por barra (la fila de la config dibujada va resaltada). Memoria: HNSW es flat más el grafo; IVF-PQ guarda ' + k(IV, 'metrics.bytesPerVector') + ' por vector en vez de ' + k(FL, 'metrics.bytesPerVector') + '. Distancias por query: los índices miran miles de vectores en vez de un millón. Bytes leídos por query: como la búsqueda está limitada por memoria, de esto sale la latencia (≈, 1 socket de CPU).',
    grid: { w: 96, h: 64 }, mobileGrid: { w: 44, h: 92 }, direction: 'tb', maxCrossings: 0,
    legendText: { bars: 'Barras: ancho proporcional (lineal, del calculador); fila resaltada = la config dibujada' },
    nodes: [
      { id: 'ac-mem', op: 'io', label: 'Memoria del índice', x: 1, y: 1, w: 94, h: 18, mobile: { x: 1, y: 1, w: 42, h: 24 },
        bars: { unit: 'bytes', labelW: 12, totalW: 12, curFrameMin: 4, rows: ROWS('', (c) => ({ segs: SEG_MEM[c] })), segs: [{ op: 'embed', label: 'vectores (fp32)' }, { op: 'attn', label: 'grafo (enlaces)' }, { op: 'conv', label: 'códigos PQ' }, { op: 'norm', label: 'ids, centroides, codebooks' }] },
        note: 'Bytes del índice por partes, de ATLAS.Arch.metrics de cada config (decimales: 1 GB = 10⁹ B).' },
      { id: 'ac-dist', op: 'io', label: 'Distancias por query', x: 1, y: 22, w: 94, h: 18, mobile: { x: 1, y: 27, w: 42, h: 27 },
        bars: { unit: 'count', labelW: 12, totalW: 12, curFrameMin: 4, legend: false, rows: ROWS('', (c) => ({ segs: c === IV ? [{ op: 'fuse', n: 'metrics.coarseDistances', label: 'centroides' }, { op: 'conv', n: 'metrics.scannedVectors', label: 'códigos (ADC)' }] : [{ op: 'fuse', n: 'metrics.distanceComputations', label: 'distancias' }] })),
          caption: 'HNSW ≈ niveles·M + efSearch·2M; IVF-PQ: n_list centroides + n_probe·N/n_list códigos (cada uno, m lecturas de tabla)' },
        note: 'Cuántos vectores (o códigos) se comparan con la query. HNSW es una estimación (≈).' },
      { id: 'ac-bytes', op: 'io', label: 'Bytes leídos por query', x: 1, y: 43, w: 94, h: 19, mobile: { x: 1, y: 57, w: 42, h: 33 },
        bars: { unit: 'bytes', labelW: 12, totalW: 12, curFrameMin: 4, legend: false, rows: ROWS('', (c) => ({ sub: '≈ ' + k(c, 'metrics.latencyMs') + ' ms por query (1 socket de CPU, cota de memoria)', segs: [{ op: 'embed', n: 'metrics.bytesTouchedPerQuery', label: 'bytes leídos' }] })) },
        note: 'Vectores (o códigos) y listas de vecinos leídos por query. Dividido por el ancho de banda de memoria da la latencia ≈.' },
    ],
    edges: [],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) HNSW por capas
  ATLAS.registerDiagram(Object.assign({
    id: 'hnsw-layers', model: 'ann', config: HN, configs: [HN], configsNote: 'es la vista de HNSW', kind: 'arch',
    title: 'HNSW: capas y búsqueda codiciosa', parent: 'ann-overview', parentNode: 'hnsw-search',
    caption: 'Un grafo por capas (Malkov y Yashunin): la capa 0 tiene los N vectores; cada capa de arriba, ≈ 1/M de los de abajo, con enlaces más largos. La búsqueda entra por el punto de entrada de la capa más alta y baja: en cada capa de arriba salta al vecino más cercano a q hasta no mejorar (ef = 1); en la capa 0 mantiene una lista de efSearch candidatos para no quedarse en un mínimo local. El pictograma es ilustrativo (pocos puntos); formas y costos, del calculador.',
    grid: { w: 126, h: 54 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['hl-graph', 'hl-vectors'], mobileFocusPad: 1,
    edgeLegend: { control: 'Lee los vecinos de las capas de arriba' },
    legendText: { layered: 'Grafo por capas (ilustrativo): círculo grande = punto de entrada (capa más alta); rombo = q (punteado: su posición en las capas de arriba); línea gruesa = saltos codiciosos, cada uno más cerca de q; punteada vertical = el mismo nodo baja de capa' },
    nodes: [
      { id: 'hl-query', op: 'io', modality: 'txt', label: 'Query q', subNum: 'd = {{cfg.d}}', sub: 'd', x: 56, y: 1, w: 40, h: 6, note: 'El vector de la consulta.' },
      { id: 'hl-graph', op: 'io', style: 'store', label: 'Grafo por capas', x: 2, y: 9, w: 42, h: 32,
        layered: { seed: 12795, levels: [{ n: 3, label: 'capa más alta: entrada' }, { n: 7, label: 'capa 2' }, { n: 13, label: 'capa 1 (≈ N/M)' }, { n: 30, label: 'capa 0: los N = {{cfg.N}}' }] },
        note: 'Cada vector está en la capa 0 y, con probabilidad que cae como 1/M por nivel, también en las de arriba (nivel = ⌊−ln U · m_L⌋, m_L = 1/ln M). Con N = {{cfg.N}} y M = {{cfg.M}}, ≈ {{metrics.levels}} capas sobre la 0. Ilustrativo: pocos puntos.' },
      { id: 'hl-upper', op: 'fuse', costOf: 'upper', label: 'Capas de arriba (ef = 1)', sub: 'codiciosa: salta al vecino más cercano a q', subNum: '≈ {{metrics.levels}} capas × M = {{cfg.M}} → ≈ {{metrics.upperDistances}} distancias', x: 56, y: 12, w: 40, h: 9,
        note: 'En cada capa: mirar los M vecinos del nodo actual y saltar al más cercano a q; si ninguno mejora, bajar con el mismo nodo. Pocas distancias: ≈ niveles·M.' },
      { id: 'hl-layer0', op: 'fuse', costOf: 'layer0', label: 'Capa 0: lista de efSearch', sub: 'expandir el mejor candidato pendiente', subNum: 'efSearch = {{cfg.efSearch}} · 2M = {{quantities.links0}} vecinos por nodo', x: 56, y: 27, w: 40, h: 9,
        note: 'Una búsqueda en anchura acotada: expande el mejor candidato, mide sus 2M vecinos y guarda los efSearch mejores; para cuando el mejor pendiente es peor que el peor de la lista. ≈ efSearch·2M = la mayor parte de las ≈ {{metrics.distanceComputations}} distancias. Más efSearch: más recall y más latencia.' },
      { id: 'hl-vectors', op: 'io', style: 'store', label: 'Vectores (N × d)', sub: 'para medir distancias', subNum: '{{metrics.vectorBytes}}', x: 2, y: 44, w: 42, h: 8, note: 'Las distancias se calculan con los vectores completos (HNSW Flat): cada distancia lee d × 4 bytes.' },
      { id: 'hl-topk', op: 'tensorop', shape: 'pill', symbol: 'pick', costOf: 'rerank', label: 'top-k de los ef', blankLabel: 'top-k', x: 102, y: 29.5, w: 22, h: 4, note: 'Se quedan los k mejores de la lista (FAISS usa máx(efSearch, k)).' },
      { id: 'hl-out', op: 'io', label: 'ids', sub: 'k vecinos', x: 102, y: 44, w: 22, h: 6, note: 'Los k vecinos aproximados.' },
    ],
    edges: [
      { from: 'hl-query', to: 'hl-upper', kind: 'data', tensor: 'query', labelSide: 'right', labelT: 0.5 },
      { from: 'hl-upper', to: 'hl-layer0', kind: 'data', tensor: 'entry', labelSide: 'right', labelT: 0.5, tag: 'punto de entrada a la capa 0', tagStyle: 'plain', tagSide: 'left', tagT: 0.5, tagBlank: false },
      { from: 'hl-graph', to: 'hl-upper', kind: 'control', fromSide: 'right', toSide: 'left', fromAt: 0.234, toAt: 0.5 },
      { from: 'hl-graph', to: 'hl-layer0', kind: 'data', tensor: 'links', blankHide: 'cands', fromSide: 'right', toSide: 'left', fromAt: 0.703, toAt: 0.5, labelSide: 'above', labelT: 0.5 },
      { from: 'hl-vectors', to: 'hl-layer0', kind: 'data', tensor: 'xb', fromSide: 'right', toSide: 'bottom', toAt: 0.5, labelSide: 'below', labelT: 0.4 },
      { from: 'hl-layer0', to: 'hl-topk', kind: 'data', tensor: 'cands', labelSide: 'above', labelT: 0.5 },
      { from: 'hl-topk', to: 'hl-out', kind: 'data', tensor: 'ids', labelSide: 'right', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) IVF-PQ por dentro
  ATLAS.registerDiagram(Object.assign({
    id: 'ivfpq', model: 'ann', config: IV, configs: [IV, IVB], configsNote: 'es la vista de IVF-PQ', kind: 'arch',
    title: 'IVF-PQ: listas invertidas + códigos PQ', parent: 'ann-overview', parentNode: 'ivfpq-search',
    caption: 'Dos ideas juntas. IVF: un k-means parte el espacio en n_list celdas; la query se compara con los centroides y solo se recorren las n_probe listas más cercanas. PQ: cada vector (el residuo respecto de su centroide) se parte en m sub-vectores y cada uno se reemplaza por el índice de su centroide más cercano entre k_s = 2ⁿᵇⁱᵗˢ (256 con 8 bits): un código de m bytes. Para buscar se arma una tabla m × k_s de distancias entre la query y los sub-centroides (ADC) y cada código cuesta m lecturas de tabla y sumas, sin multiplicar. Las tablas son ilustrativas; las formas, del calculador.',
    grid: { w: 100, h: 96 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['iv-coarse', 'iv-probe', 'iv-residual', 'iv-lut'], mobileFocusPad: 2,
    legendText: { cells: 'Tabla ADC (tono ilustrativo): recuadro = la entrada que lee un código en cada sub-espacio', cellsRows: 'Listas invertidas: resaltadas = las n_probe que se recorren' },
    nodes: [
      { id: 'iv-query', op: 'io', modality: 'txt', label: 'Query q', subNum: 'd = {{cfg.d}}', sub: 'd', x: 26, y: 1, w: 38, h: 6, note: 'El vector de la consulta, sin cuantizar (por eso la distancia es asimétrica).' },
      { id: 'iv-coarse', op: 'fuse', costOf: 'coarse', label: 'Cuantizador grueso', sub: 'q contra los n_list centroides', subNum: 'n_list = {{cfg.nlist}} centroides', x: 22, y: 11, w: 46, h: 8,
        costNote: 'Los "parámetros" son los centroides del k-means (datos del índice).',
        when: { if: 'cfg.coarseM', set: { sub: 'HNSW sobre los n_list centroides', subNum: 'n_list = {{cfg.nlist}} · ≈ {{metrics.coarseDistances}} distancias',
          note: 'Busca los n_probe centroides más cercanos con un HNSW (M = {{cfg.coarseM}}, ef = {{cfg.coarseEf}}) sobre los {{cfg.nlist}} centroides: ≈ {{metrics.coarseDistances}} distancias en vez de {{cfg.nlist}}. Con N = {{cfg.N}}, cada lista tiene ≈ {{metrics.listSize}} vectores.' } },
        note: 'Distancia de q a los {{cfg.nlist}} centroides del k-means ({{metrics.coarseDistances}} distancias: todos). Con N = {{cfg.N}}, cada lista tiene ≈ {{metrics.listSize}} vectores.' },
      { id: 'iv-probe', op: 'tensorop', shape: 'pill', symbol: 'pick', ops: ['probe'], opsExact: true, label: 'n_probe listas más cercanas', x: 26, y: 23, w: 38, h: 4, note: 'Elegir las n_probe = {{cfg.nprobe}} listas cuyos centroides están más cerca de q. Más n_probe: más recall y más trabajo.' },
      { id: 'iv-residual', op: 'tensorop', shape: 'pill', ops: ['residual'], opsExact: true, label: 'residuo q − c_i por lista', x: 26, y: 31, w: 38, h: 4, tex: 'r_i = q - c_i', note: 'PQ cuantiza el residuo de cada vector respecto de su centroide (by_residual en FAISS): la query se expresa igual, una vez por lista.' },
      { id: 'iv-lut', op: 'fuse', ops: ['lut'], opsExact: true, label: 'Tablas ADC', sub: 'distancia de cada sub-vector de q a los k_s sub-centroides', x: 14, y: 40, w: 62, h: 22,
        cells: { rows: 'cfg.m', cols: 'cfg.ksub', maxR: 8, maxC: 24, mark: 'pick', label: 'm = {{cfg.m}} sub-espacios × k_s = {{cfg.ksub}} centroides (por lista)', seed: 31 },
        tex: 'T_{j,c} = \\lVert r_j - c^{(j)}_c \\rVert^2', note: 'Una tabla de m × k_s distancias por lista recorrida: se calcula una vez y después cada código cuesta m lecturas. (FAISS precalcula una parte de la tabla para todas las listas cuando entra en memoria.)' },
      { id: 'iv-adc', op: 'tensorop', shape: 'rect', ops: ['adc'], opsExact: true, label: 'Recorrer los códigos (ADC)', sub: 'Σ_j T[j, código_j] por vector', subNum: '≈ {{metrics.scannedVectors}} códigos × m = {{cfg.m}} lecturas', x: 22, y: 67, w: 46, h: 8,
        tex: '\\hat d(q, x) = \\textstyle\\sum_{j=1}^{m} T_{j,\\, c_j(x)}', note: 'Por cada vector de las listas elegidas: m lecturas de tabla y sumas. Distancias aproximadas: el error de cuantización entra en el ranking (por eso a veces se re-rankea con los vectores completos).' },
      { id: 'iv-codes', op: 'io', style: 'store', label: 'Listas: códigos PQ', sub: 'residuo x − c_lista\nN × m bytes', subNum: 'residuo x − c_lista\n{{metrics.codeBytes}} de códigos', x: 79, y: 44, w: 20, h: 31,
        cells: { rows: 'cfg.nlist', cols: 'metrics.listSize', maxR: 9, maxC: 12, cell: 7, mark: 'rows', litRows: [2, 6], caption: '{{cfg.nprobe}} de {{cfg.nlist}} listas', seed: 3 },
        note: 'Los N códigos de m = {{cfg.m}} bytes, agrupados por lista (≈ {{metrics.listSize}} por lista). Cada código cuantiza el RESIDUO x − c_lista del vector respecto del centroide de su lista (by_residual en FAISS), no el vector crudo: por eso la tabla ADC se arma con q − c_lista, una por lista. Se leen solo las n_probe = {{cfg.nprobe}} listas elegidas, las de centroide más cercano a q, estén donde estén (el dibujo resalta dos sueltas: en la config son {{cfg.nprobe}} de {{cfg.nlist}}).' },
      { id: 'iv-ids', op: 'io', style: 'store', label: 'ids (int64)', subNum: '{{metrics.idBytes}}', sub: 'N × 8 bytes', x: 79, y: 80, w: 20, h: 9, note: 'El id original de cada vector, guardado junto a su código.' },
      { id: 'iv-topk', op: 'tensorop', shape: 'pill', symbol: 'pick', ops: ['topk'], opsExact: true, label: 'top-k', x: 26, y: 81, w: 38, h: 4, note: 'Los k menores por distancia aproximada, con sus ids.' },
      { id: 'iv-out', op: 'io', label: 'ids de los k vecinos', x: 26, y: 89, w: 38, h: 5.5, note: 'Los k vecinos aproximados.' },
    ],
    edges: [
      { from: 'iv-query', to: 'iv-coarse', kind: 'data', tensor: 'query', labelSide: 'right', labelT: 0.5 },
      // con un HNSW sobre los centroides (config de mil millones) no salen n_list distancias: se calculan ≈ coarseDistances
      { from: 'iv-coarse', to: 'iv-probe', kind: 'data', tensor: 'coarse-dists', labelSide: 'right', labelT: 0.5,
        whenSet: { if: 'cfg.coarseM', set: { tag: '≈ {{metrics.coarseDistances}} distancias (HNSW)', tagBlank: false, tagStyle: 'plain', tagSide: 'right', tagT: 0.5 } } },
      { from: 'iv-probe', to: 'iv-residual', kind: 'data', tensor: 'probe-ids', labelSide: 'right', labelT: 0.5 },
      { from: 'iv-residual', to: 'iv-lut', kind: 'data', tensor: 'residuals', labelSide: 'right', labelT: 0.5 },
      { from: 'iv-lut', to: 'iv-adc', kind: 'data', tensor: 'lut', labelSide: 'right', labelT: 0.5 },
      { from: 'iv-codes', to: 'iv-adc', kind: 'data', tensor: 'codes', fromSide: 'left', toSide: 'right', fromAt: 0.87, toAt: 0.5, label: false },
      { from: 'iv-adc', to: 'iv-topk', kind: 'data', tensor: 'adc-dists', labelSide: 'right', labelT: 0.5 },
      { from: 'iv-ids', to: 'iv-topk', kind: 'data', tensor: 'list-ids', fromSide: 'left', toSide: 'right', toAt: 0.5, label: false },
      { from: 'iv-topk', to: 'iv-out', kind: 'data', tensor: 'ids', label: false },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
