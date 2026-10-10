/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/two-tower.js
   Diagramas del two-tower (SPEC §7.2, ids de §25.1), modelo `two-tower` (js/arch/recsys.js):
     two-tower-overview  dos carriles. Offline (una vez por catálogo): cada ítem → tablas del ítem (id compartido + categóricas)
                         → MLP del ítem (× N_items) → índice de N_items vectores. Online (por request): el usuario (id, historial,
                         contexto) → tablas del usuario → MLP del usuario (× 1) → u·v contra el índice → top-k candidatos para
                         el ranking (#dlrm). Las tablas y los MLP van en nodos separados: sus insignias muestran que casi todos
                         los parámetros están en las tablas; abajo, el cómputo de un request y el reparto de parámetros por config.
       inbatch-softmax   el entrenamiento: B usuarios y sus B ítems por las torres → U·Vᵀ (B×B, diagonal = positivos) → ÷τ −
                         log Q(j) → softmax por fila + CE.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'two-tower-base', ALL = ['two-tower-base', 'two-tower-small', 'two-tower-no-ids'];
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 'two-tower', section: 'diagrama' };
  // Subíndices estilo TeX en el html de notas y pasos ("N_items", "Q_j") → <sub> (como dit.js); no toca <code> ni las claves {{…}}
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9θ]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };

  // ------------------------------------------------------------------ (a) vista general: offline y online
  register(Object.assign({
    id: 'two-tower-overview', model: 'two-tower', config: C, configs: ['two-tower-base', 'two-tower-small'],
    configsNote: 'la config sin ids (two-tower-no-ids) no tiene las tablas de id: compárala en las barras de abajo', kind: 'arch',
    title: 'Two-tower: offline y online',
    caption: 'El patrón bi-encoder de #retrieval aplicado a usuarios × ítems. Dos redes separadas: la torre de ítems convierte cada ítem en un vector v y la torre de usuario convierte al usuario (su id, lo último que vio, su contexto) en un vector u; el puntaje es u·v. Como el ítem nunca ve al usuario, todo el catálogo se codifica offline (marco ámbar) y se guarda en un índice; por cada request (marco azul) corre solo la torre de usuario y una búsqueda de los k vectores más parecidos (exacta aquí; con un índice ANN, #ann). Cada torre en dos partes: las tablas de embeddings (casi todos los parámetros) y un MLP chico. Abajo: el cómputo de un request y el reparto de parámetros.',
    grid: { w: 150, h: 97 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['user-mlp', 'retrieve'], mobileFocusPad: 1,
    modLegend: { qry: 'Tensor del lado del usuario (contorno)', txt: 'Tensor del lado del ítem (rayado)' },
    opLegend: { fuse: 'Puntaje u·v (usuario × ítem)' },
    legendText: { runs: 'Veces que corre por request', runsOnce: 'Veces que corre offline (una vez por ítem, antes de los requests)', tie: 'La misma tabla de ids de ítem en las dos torres (se cuenta una vez)', costSplit: 'Cómputo de un request: ancho proporcional a los MACs (del calculador)', bars: 'Parámetros: ancho proporcional (lineal, del calculador); fila resaltada = la config dibujada' },
    groups: [
      { id: 'offline', style: 'lane', tone: 'warn', label: 'Offline · una vez por catálogo', legend: 'Marco ámbar: offline (una vez por ítem; se guarda en el índice)',
        label2: q('cfg.nItems') + ' ítems × ' + q('metrics.itemTowerMacs') + ' = ' + q('metrics.itemCorpusMacs') + ' · índice ' + q('metrics.indexBytes'), x: 0.5, y: 0.5, w: 149, h: 25 },
      { id: 'online', style: 'lane', tone: 'accent', label: 'Online · por cada request', legend: 'Marco azul: online (en cada request)', labelPos: 'bottom',
        label2: q('metrics.servingMacsPerRequest') + ' por request', label2Pos: 'bottom-right', x: 0.5, y: 29.5, w: 149, h: 27 },
    ],
    nodes: [
      { id: 'catalog', op: 'io', style: 'store', label: 'Catálogo', sub: 'N_items ítems', subNum: '{{cfg.nItems}} ítems', x: 2, y: 6, w: 18, h: 13,
        note: 'Todos los ítems que se pueden recomendar ({{cfg.nItems}} en esta config). Cada uno entra como su id y 4 features categóricas (categoría, idioma, duración y antigüedad en buckets).' },
      { id: 'item-emb', op: 'embed', ops: ['item-id-embed', 'item-cat-embed', 'item-concat'], opsExact: true, label: 'Torre de ítems: tablas', sub: 'id de ítem + 4 categóricas', subNum: 'id: {{cfg.nItems}} × {{cfg.idDim}}\n+ 4 categóricas × 16', x: 26, y: 6.5, w: 28, h: 12,
        note: 'Buscar filas en tablas (lookups), sin multiplicar nada: la fila del id del ítem en una tabla de {{cfg.nItems}} × {{cfg.idDim}} (la MISMA tabla que usa el historial del usuario: sus parámetros se cuentan aquí) y una fila de 16 por cada categórica; todo concatenado. Casi todos los parámetros del modelo viven en estas tablas.' },
      { id: 'item-mlp', op: 'mlp', costOf: 'mlp', scope: 'item-tower', ops: ['item-norm'], label: 'Torre de ítems: MLP', sub: '256 → 128 → dim, L2', blankSub: '256 → 128 → …, L2', subNum: '{{tensor.v-in.shape}} → 256 → 128 → {{cfg.dim}}, L2', runs: '× {{cfg.nItems}} ítems', runsTone: 'once',
        x: 60, y: 6.5, w: 26, h: 12,
        note: 'Tres capas lineales con ReLU entre ellas y una normalización L2 al final (‖v‖ = 1: u·v es un coseno). Corre una vez por ítem del catálogo, offline: {{metrics.itemTowerMacs}} por ítem, {{metrics.itemCorpusMacs}} en total.' },
      { id: 'index', op: 'io', style: 'store', costOf: 'item-index', label: 'Índice de ítems', sub: 'N_items × dim', blankSub: 'un vector por ítem', subNum: '{{metrics.indexBytes}} (fp32)', x: 93, y: 6, w: 28, h: 13,
        xref: [{ href: '#ann.diagrama~ann-overview.hnsw-search', label: 'Ver los índices ANN (HNSW, IVF-PQ)' }],
        note: 'Los {{cfg.nItems}} vectores v guardados: N_items × dim × 4 bytes = {{metrics.indexBytes}}. Se recalcula cuando cambian los pesos de la torre de ítems (o llegan ítems nuevos). Con un índice ANN (HNSW, IVF-PQ: #ann) la búsqueda deja de mirar todos.' },
      { id: 'user', op: 'io', label: 'Usuario', sub: 'id + historial\n+ contexto', subNum: 'id + {{cfg.hist}} vistos\n+ 4 categóricas', x: 2, y: 34, w: 18, h: 12,
        note: 'Lo que se sabe del usuario al momento del request: su id (hasheado a {{cfg.idBuckets}} buckets), los últimos {{cfg.hist}} ítems que vio y su contexto (país, idioma, dispositivo, hora).' },
      { id: 'user-emb', op: 'embed', ops: ['user-id-embed', 'hist-embed', 'user-cat-embed', 'user-concat'], opsExact: true, label: 'Torre de usuario: tablas', sub: 'id hasheado +\npromedio del historial', subNum: 'id: {{cfg.idBuckets}} × {{cfg.idDim}}\n+ historial + 4 × 16', x: 26, y: 34, w: 28, h: 12,
        note: 'La fila del id del usuario (tabla de {{cfg.idBuckets}} × {{cfg.idDim}}, hasheada), el PROMEDIO de las filas de los {{cfg.hist}} ítems vistos (en la tabla de ítems compartida: no suma parámetros) y una fila de 16 por categórica; todo concatenado.' },
      { id: 'user-mlp', op: 'mlp', costOf: 'mlp', scope: 'user-tower', ops: ['user-norm'], label: 'Torre de usuario: MLP', sub: '256 → 128 → dim, L2', blankSub: '256 → 128 → …, L2', subNum: '{{tensor.u-in.shape}} → 256 → 128 → {{cfg.dim}}, L2', runs: '× 1 por request',
        x: 60, y: 34, w: 26, h: 12,
        note: 'El mismo esquema que la torre de ítems, con sus propios pesos. Una pasada por request: {{metrics.userTowerMacs}}.' },
      { id: 'retrieve', op: 'fuse', costOf: 'retrieve', label: 'Puntaje u·v → top-k', sub: 'u contra los N_items vectores', subNum: 'exacta: {{metrics.bruteForceMacs}} → top-{{cfg.k}}', expand: 'inbatch-softmax', x: 93, y: 33.5, w: 28, h: 13,
        tex: 's(u, i) = u \\cdot v_i,\\quad \\mathrm{top}\\text{-}k_{\\,i}\\ s(u, i)', note: 'El producto punto de u con cada vector del índice ({{metrics.bruteForceMacs}} en búsqueda exacta: poco cómputo, pero lee todo el índice) y los k = {{cfg.k}} mejores. Ábrelo para ver cómo se entrena este mismo producto punto: con los demás ítems del lote como negativos.' },
      { id: 'candidates', op: 'io', label: 'k candidatos', sub: 'al ranking', subNum: 'top-{{cfg.k}} → ranking', x: 127, y: 35, w: 21, h: 9,
        xref: [{ href: '#dlrm.diagrama~funnel.fn-ranking', label: 'Ver el embudo: el ranking los ordena (DLRM)' }],
        note: 'Los k = {{cfg.k}} ítems más parecidos pasan a la siguiente etapa del embudo: un ranker más caro (DLRM, #dlrm) que los ordena con features que el two-tower no puede usar (cruces usuario × ítem).' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Cómputo de un request', x: 1, y: 59, w: 148, h: 15,
        costSplit: { segs: [
          { op: 'mlp', n: 'metrics.userTowerMacs', label: 'Torre de usuario (× 1)' },
          { op: 'fuse', n: 'metrics.bruteForceMacs', label: 'u contra los N_items vectores (exacta)' },
        ], pct1: 'all', legendSegs: true, caption: 'offline, una vez: {{metrics.itemCorpusMacs}} (N_items × {{metrics.itemTowerMacs}}) · los lookups no son MACs: leen {{metrics.lookupBytesPerExample}} por ejemplo de entrenamiento (usuario + ítem)' },
        note: 'MACs de un request, del calculador. La búsqueda exacta domina y además lee todo el índice ({{metrics.indexBytes}}): un índice ANN la reduce a miles de distancias.' },
      { id: 'params', op: 'io', hideInBlank: true, label: 'Parámetros por config', x: 1, y: 76, w: 148, h: 20,
        bars: { unit: 'params', labelW: 24, totalW: 13, rows: [
          { config: 'two-tower-base', label: 'two-tower-base' },
          { config: 'two-tower-small', label: 'two-tower-small' },
          { config: 'two-tower-no-ids', label: 'sin ids (arranque en frío)' },
        ], segs: [{ op: 'embed', n: 'metrics.embeddingParams', label: 'tablas de embeddings' }, { op: 'mlp', n: 'metrics.mlpParams', label: 'MLP de las dos torres' }],
          caption: 'las tablas de ids escalan con el catálogo y los usuarios; los MLP no' },
        note: 'Parámetros de cada config, del calculador: tablas de embeddings (las de id dominan) contra los MLP de las dos torres. Sin tablas de id el modelo es chico y sirve para ítems o usuarios nuevos (arranque en frío), a costa de no memorizar a nadie.' },
    ],
    tensors: [
      { id: 'v', at: { edge: 'item-mlp>index' }, show: 'both' },
      { id: 'u', at: { edge: 'user-mlp>retrieve' }, show: 'both' },
    ],
    edges: [
      { from: 'catalog', to: 'item-emb', kind: 'data', tensor: 'item-id', label: false },
      { from: 'item-emb', to: 'item-mlp', kind: 'data', tensor: 'v-in', labelSide: 'above', labelT: 0.5 },
      { from: 'item-mlp', to: 'index', kind: 'data', tensor: 'v', labelT: 0.5 },
      { from: 'index', to: 'retrieve', kind: 'data', tensor: 'index', labelSide: 'right', labelT: 0.59 },
      { from: 'user', to: 'user-emb', kind: 'data', tensor: 'hist-ids', labelSide: 'above', labelT: 0.5 },
      { from: 'user-emb', to: 'user-mlp', kind: 'data', tensor: 'u-in', labelSide: 'above', labelT: 0.5 },
      { from: 'user-mlp', to: 'retrieve', kind: 'data', tensor: 'u', labelT: 0.5 },
      { from: 'retrieve', to: 'candidates', kind: 'data', tensor: 'topk-ids', labelSide: 'above', labelT: 0.5 },
      // la tabla de ids de ítem es una sola: el historial del usuario lee filas de la misma tabla que la torre de ítems
      { from: 'item-emb', to: 'user-emb', kind: 'control', tie: true, fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.5, tag: 'misma tabla de ids de ítem', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (un request)', steps: [
        { nodes: ['catalog', 'item-emb', 'item-mlp'], edges: ['catalog>item-emb', 'item-emb>item-mlp'], tensors: ['item-id', 'v-in'],
          text: 'Offline: cada uno de los ' + q('cfg.nItems') + ' ítems busca sus filas en las tablas (<b>' + q('tensor.v-in.shape') + '</b> números concatenados) y pasa por el MLP: ' + q('metrics.itemTowerMacs') + ' por ítem, ' + q('metrics.itemCorpusMacs') + ' para todo el catálogo.' },
        { nodes: ['item-mlp', 'index'], edges: ['item-mlp>index'], tensors: ['v', 'index'],
          text: 'Cada ítem queda como un vector de <b>' + q('tensor.v.shape') + '</b> con norma 1; el índice guarda <b>' + q('tensor.index.shape') + '</b> = ' + q('metrics.indexBytes') + '.' },
        { nodes: ['user', 'user-emb', 'user-mlp'], edges: ['user>user-emb', 'user-emb>user-mlp', 'item-emb>user-emb'], tensors: ['hist-ids', 'u-in'],
          text: 'Online: el usuario busca su fila de id, el promedio de las filas de sus ' + q('cfg.hist') + ' ítems vistos (en la tabla compartida) y sus categóricas: <b>' + q('tensor.u-in.shape') + '</b> números, sin un solo MAC.' },
        { nodes: ['user-mlp'], edges: ['user-mlp>retrieve'], tensors: ['u'],
          text: 'El MLP del usuario: ' + q('metrics.userTowerMacs') + ' → u de <b>' + q('tensor.u.shape') + '</b>. Es lo único de redes neuronales que corre por request.' },
        { nodes: ['retrieve', 'index', 'candidates'], edges: ['index>retrieve', 'retrieve>candidates'], tensors: ['index', 'topk-ids'],
          text: 'u contra los ' + q('cfg.nItems') + ' vectores (' + q('metrics.bruteForceMacs') + ' en búsqueda exacta) y los <b>' + q('tensor.topk-ids.shape') + '</b> mejores pasan al ranking. Un índice ANN (#ann) evita leer todo.' },
        { expand: 'inbatch-softmax', nodes: ['ib-logits', 'ib-logq'], edges: ['ib-logits>ib-logq'], tensors: ['logits', 'logits-corrected'],
          text: 'Entrenamiento: en un lote de ' + q('cfg.B') + ' pares (usuario, ítem que vio), cada usuario usa los ítems de los OTROS pares como negativos: logits <b>' + q('tensor.logits.shape') + '</b> y la corrección − log Q(j) por la popularidad.' },
        { nodes: ['params'], edges: [], tensors: [],
          text: 'Los parámetros: ' + q('metrics.embeddingParams') + ' en tablas de embeddings contra ' + q('metrics.mlpParams') + ' en los MLP (los MLP son solo el ' + q('metrics.mlpParamsShare') + ' del total). El modelo es, sobre todo, una memoria.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) entrenamiento: softmax con los negativos del lote
  register(Object.assign({
    id: 'inbatch-softmax', model: 'two-tower', config: C, configs: ALL, configsNote: 'el mismo lote para las tres configs', kind: 'arch',
    title: 'Entrenamiento: softmax en el lote + logQ', parent: 'two-tower-overview', parentNode: 'retrieve',
    caption: 'Un lote de B pares (usuario, ítem que vio). Las dos torres dan U (B × dim) y V (B × dim); U·Vᵀ es una matriz B × B: la diagonal son los pares reales (positivos) y el resto de cada fila son los ítems de los otros pares, usados como negativos sin calcular nada extra. Como los ítems populares aparecen en más lotes, serían negativos demasiado seguido: a cada columna se le resta log Q(j), la probabilidad estimada de que el ítem j esté en un lote (Yi et al., RecSys 2019), y recién entonces softmax por fila y entropía cruzada contra la diagonal.',
    grid: { w: 100, h: 74 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['ib-logits', 'ib-logq'],
    modLegend: { qry: 'Tensor del lado del usuario (contorno)', txt: 'Tensor del lado del ítem (rayado)' },
    opLegend: { fuse: 'U·Vᵀ: cada usuario contra cada ítem del lote' },
    legendText: { cells: 'Matriz B × B (tono ilustrativo); recuadro = la diagonal: el ítem que ese usuario vio (positivo)' },
    nodes: [
      { id: 'ib-users', op: 'io', label: 'B usuarios del lote', sub: 'uno por par', subNum: 'B = {{cfg.B}}', x: 3, y: 1, w: 30, h: 7, note: 'Los usuarios de los B pares del lote (B = {{cfg.B}}).' },
      { id: 'ib-items', op: 'io', label: 'B ítems que vieron', sub: 'el positivo de cada par', subNum: 'B = {{cfg.B}}', x: 67, y: 1, w: 30, h: 7, note: 'El ítem que vio cada usuario: el positivo de su fila y un negativo para las demás.' },
      { id: 'ib-utower', op: 'mlp', style: 'block', costOf: 'user-tower', label: 'Torre de usuario', sub: 'tablas + MLP + L2', x: 3, y: 12, w: 30, h: 8, note: 'La misma torre de la vista general, sobre los B usuarios.' },
      { id: 'ib-itower', op: 'mlp', style: 'block', costOf: 'item-tower', label: 'Torre de ítems', sub: 'tablas + MLP + L2', x: 67, y: 12, w: 30, h: 8, note: 'La misma torre de ítems, sobre los B ítems del lote (no sobre todo el catálogo: eso es lo barato del truco).' },
      { id: 'ib-logits', op: 'fuse', ops: ['inbatch-logits', 'user-stack', 'item-stack'], opsExact: true, label: 'U·Vᵀ', sub: 'B × B: fila = usuario, columna = ítem', x: 26, y: 26, w: 48, h: 26,
        cells: { rows: 'cfg.B', cols: 'cfg.B', maxR: 8, maxC: 8, cell: 12, mark: 'diag', label: 'B = {{cfg.B}} filas × B columnas', seed: 19 },
        tex: 'S = U V^{\\top} \\in \\mathbb{R}^{B \\times B}', note: 'Cada fila: un usuario contra los B ítems del lote ({{metrics.inBatchLogitsMacs}} para el lote entero: B² · dim). La diagonal es el positivo; los B − 1 restantes, negativos gratis. Tonos ilustrativos.' },
      { id: 'ib-q', op: 'io', label: 'Q(j) estimada', sub: 'frecuencia en el flujo', x: 76, y: 54, w: 23, h: 8,
        note: 'La probabilidad de que el ítem j caiga en un lote. Yi et al. la estiman en streaming: guardan el último paso en que se vio cada ítem (en un arreglo hasheado) y un promedio móvil del intervalo entre apariciones; Q ≈ 1 / intervalo. Sin parámetros entrenables.' },
      { id: 'ib-logq', op: 'tensorop', shape: 'pill', ops: ['logq'], opsExact: true, label: '÷ τ − log Q(j)', x: 30, y: 56, w: 40, h: 4,
        tex: 's^c_{ij} = \\frac{u_i \\cdot v_j}{\\tau} - \\log Q(j)', note: 'Temperatura τ (los vectores tienen norma 1) y la corrección de muestreo: a la columna de un ítem popular se le resta más que a la de uno raro (log Q es negativo y el suyo está más cerca de 0: −log Q le suma menos), así que su logit corregido queda más abajo, pesa menos como negativo en la softmax de cada fila y deja de ser castigado por aparecer seguido.' },
      { id: 'ib-loss', op: 'head', ops: ['inbatch-loss'], opsExact: true, label: 'Softmax por fila + CE', sub: 'contra la diagonal', x: 30, y: 64, w: 40, h: 7,
        tex: '\\mathcal{L} = -\\frac{1}{B}\\sum_i \\log \\frac{e^{s^c_{ii}}}{\\sum_j e^{s^c_{ij}}}', note: 'Entropía cruzada de cada fila con el positivo en la diagonal, promediada en el lote (Yi et al. además pesan cada fila por una recompensa, p. ej. el tiempo de visualización).' },
    ],
    edges: [
      { from: 'ib-users', to: 'ib-utower', kind: 'data', tensor: 'user-cat-ids', label: false },
      { from: 'ib-items', to: 'ib-itower', kind: 'data', tensor: 'item-cat-ids', label: false },
      { from: 'ib-utower', to: 'ib-logits', kind: 'data', tensor: 'U', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.15, labelSide: 'left', labelT: 0.5 },
      { from: 'ib-itower', to: 'ib-logits', kind: 'data', tensor: 'V', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.85, labelSide: 'right', labelT: 0.5 },
      { from: 'ib-logits', to: 'ib-logq', kind: 'data', tensor: 'logits', labelSide: 'right', labelT: 0.5 },
      { from: 'ib-q', to: 'ib-logq', kind: 'data', tensor: 'item-logq', fromSide: 'left', toSide: 'right', labelSide: 'above', labelT: 0.5 },
      { from: 'ib-logq', to: 'ib-loss', kind: 'data', tensor: 'logits-corrected', labelSide: 'right', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
