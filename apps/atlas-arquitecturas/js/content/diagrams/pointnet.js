/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/pointnet.js
   Diagramas de PointNet (SPEC §7.2, ids de §26.3), modelo `pointnet` (js/arch/perception.js):
     pointnet-overview  puntos N×3 → T-Net de entrada (3×3) → MLP compartida 64-64 → T-Net de features (64×64) → MLP compartida
                        64-128-1024 → max-pool sobre los puntos → feature global 1024 → MLP 512-256-k → clases. Carril de
                        segmentación (config pointnet-seg): features por punto ‖ global repetida → MLP por punto → una etiqueta por
                        punto. Abajo, del calculador: MACs por punto (× N) contra los globales.
       tnet             un T-Net por dentro: mini PointNet (MLP compartida → max-pool → FC) → matriz K×K (inicializada en la
                        identidad) → se multiplica a los puntos; el regularizador de ortogonalidad del de 64×64.
       maxpool          el max-pool por dentro: matriz N × 1024 de features por punto → el máximo de cada columna; el orden de las
                        filas no importa (invariancia a permutaciones) y solo cuentan las filas que ganan alguna columna (críticos).
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas y costos: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'pointnet-cls', SEG = 'pointnet-seg';
  const q = (k) => '{{' + k + '}}';
  const ks = (key) => '{{' + SEG + '.' + key + '}}';
  const PAGE = { page: 'pointnet', section: 'diagrama' };
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9θ]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };
  const OPLEG = { embed: 'T-Net: predice una matriz de alineación', mlp: 'MLP compartida (la misma para cada punto: conv1d k = 1)', head: 'Cabeza (MLP sobre la feature global)' };

  // ------------------------------------------------------------------ (a) vista general
  register(Object.assign({
    id: 'pointnet-overview', model: 'pointnet', config: C, configs: [C], configsNote: 'PointNet++ es otra arquitectura (set abstraction): está en la tabla de variantes', kind: 'arch',
    title: 'PointNet — vista general',
    caption: 'Una red para un conjunto de puntos sin orden. Cada punto (x, y, z) pasa por la MISMA MLP (una conv1d de kernel 1), sin mirar a los demás; dos T-Nets aprenden a alinear la nube (3×3) y las features (64×64). Un max-pool sobre los N puntos junta todo en un vector de 1024: el máximo no depende del orden, así que la red tampoco. Clasificación: una MLP sobre ese vector. Segmentación (carril de abajo, otra config): a cada punto se le pega la feature global y otra MLP por punto da su etiqueta. Abajo, del calculador: casi todo el cómputo es por punto.',
    grid: { w: 154, h: 62 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['shared-mlp-2', 'maxpool', 'head'], mobileFocusPad: 1,
    opLegend: OPLEG,
    modLegend: { img: 'Tensor: puntos y sus features' },
    legendText: { costSplit: 'MACs por nube: ancho proporcional (del calculador)' },
    groups: [
      { id: 'cls-lane', style: 'lane', tone: 'accent', label: 'Clasificación (pointnet-cls)', legend: 'Marco azul: la red de clasificación', labelPos: 'bottom', x: 0.5, y: 0.5, w: 153, h: 19 },
      { id: 'seg-lane', style: 'lane', tone: 'fuse', config: SEG, label: 'Segmentación de partes (config pointnet-seg)', legend: 'Marco violeta: cabeza de segmentación (formas de pointnet-seg)', labelPos: 'bottom', x: 60.5, y: 22.5, w: 93, h: 19 },
    ],
    nodes: [
      { id: 'points', op: 'io', label: 'Nube de puntos', sub: 'N × (x, y, z)', subNum: '{{tensor.points.shape}} (x, y, z)', x: 1, y: 4, w: 14.5, h: 11, note: 'N puntos 3-D (N = {{cfg.N}} en ModelNet40, muestreados de cada malla), en cualquier orden. Sin color ni normales en la config canónica.' },
      { id: 'input-tnet', op: 'embed', costOf: 'input-tnet', label: 'T-Net de entrada', sub: '→ matriz 3×3', subNum: '→ matriz {{tensor.t-in.shape}}', expand: 'tnet', x: 18, y: 4, w: 18, h: 11,
        tex: "x'_i = x_i\\, A,\\quad A = T(\\{x_i\\}) \\in \\mathbb{R}^{3\\times 3}", note: 'Una mini PointNet que mira toda la nube y predice una matriz 3×3; los puntos se multiplican por ella para llevarlos a una pose canónica (rotar la nube no debería cambiar la clase). Se inicializa en la identidad. Ábrelo para verla por dentro.' },
      { id: 'shared-mlp-1', op: 'mlp', costOf: 'shared-mlp-1', label: 'MLP compartida 64-64', sub: 'conv1d k=1 + BN + ReLU', subNum: '→ {{tensor.h2.shape}}', x: 40, y: 4, w: 20, h: 11,
        tex: 'h_i = \\mathrm{ReLU}(\\mathrm{BN}(W x_i + b))', note: 'La misma MLP para cada punto: 3 → 64 → 64. Escrita como conv1d de kernel 1 (o conv2d 1×3 en el código original), que es exactamente eso: los pesos se comparten entre puntos y no hay mezcla entre ellos.' },
      { id: 'feature-tnet', op: 'embed', costOf: 'feature-tnet', label: 'T-Net de features', sub: '→ matriz 64×64', subNum: '→ matriz {{tensor.t-feat.shape}}', expand: 'tnet', x: 64, y: 4, w: 18, h: 11,
        tex: '\\mathcal{L}_{reg} = \\lVert I - A A^\\top \\rVert_F^2', note: 'Lo mismo sobre las features de 64: una matriz 64×64 (4,096 salidas). Como es difícil de optimizar, se le suma a la pérdida un regularizador que la empuja a ser ortogonal (peso 0.001), que no deforma las features.' },
      { id: 'shared-mlp-2', op: 'mlp', costOf: 'shared-mlp-2', label: 'MLP compartida 64-128-1024', sub: 'por punto', subNum: 'por punto → {{tensor.h5.shape}}', x: 86, y: 4, w: 24, h: 11,
        note: 'La parte más cara: 64 → 64 → 128 → 1024 para cada uno de los N puntos. Todavía no hay información de los otros puntos.' },
      { id: 'maxpool', op: 'tensorop', shape: 'pool', costOf: 'maxpool', label: 'Max-pool', labelPos: 'above', expand: 'maxpool', x: 114, y: 7.5, w: 4, h: 4,
        tex: 'g_c = \\max_{i = 1..N} h_{i,c}', note: 'Por cada uno de los 1024 canales, el máximo sobre los puntos: una función simétrica, así que el resultado no depende del orden. Sin parámetros: ≈ {{metrics.maxpoolOps}} comparaciones. Ábrelo para ver los puntos críticos.' },
      { id: 'head', op: 'head', costOf: 'head', label: 'MLP 512-256-k', sub: 'BN + dropout', subNum: 'BN + dropout → {{tensor.logits.shape}}', x: 122, y: 4, w: 18, h: 11,
        note: 'Sobre la feature global: 1024 → 512 → 256 → k clases (40 en ModelNet40), con batch norm y dropout (keep 0.7) en las dos primeras.' },
      { id: 'logits', op: 'io', label: 'Clases', sub: 'k logits', x: 143, y: 4, w: 10, h: 11, note: 'Un logit por clase; softmax + entropía cruzada (más el regularizador del T-Net de 64).' },
      { id: 'seg-concat', op: 'tensorop', shape: 'concat', label: '‖ global repetida', labelPos: 'below', x: 98, y: 29, w: 4, h: 4,
        tex: '[\\,h_i \\,\\|\\, g\\,] \\in \\mathbb{R}^{64 + 1024}', note: 'A la feature de 64 de cada punto (después del T-Net de features) se le pega la global de 1024: cada punto sabe qué es él y de qué objeto forma parte. ' + ks('tensor.concat.shape') + ' en pointnet-seg (N = ' + ks('cfg.N') + ').' },
      { id: 'seg-mlp', op: 'mlp', costRef: { config: SEG, nodes: ['seg-head'] }, label: 'MLP por punto → partes', sub: '512-256-128-128-50', x: 108, y: 26, w: 26, h: 10,
        note: 'Otra MLP compartida sobre los 1088 de cada punto: 512 → 256 → 128 → 128 → 50 partes (ShapeNet-Part). La última capa sin BN ni ReLU.' },
      { id: 'seg-out', op: 'io', label: 'Partes por punto', sub: 'N × 50', x: 137, y: 26, w: 16, h: 10, note: 'Un logit por parte para cada punto.' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'MACs por nube', x: 1, y: 45, w: 152, h: 16,
        costSplit: { pct1: true, segs: [{ op: 'mlp', n: 'metrics.perPointMacs', label: 'por punto: MLP compartidas y T-Nets (× N)' }, { op: 'head', n: 'metrics.globalMacs', label: 'globales: FC de los T-Nets y la cabeza (no dependen de N)' }],
          caption: 'max-pool: ≈ {{metrics.maxpoolOps}} comparaciones, sin MACs · total {{metrics.macs}}' },
        note: 'Del calculador: lo que escala con N (las MLP compartidas, también las de los T-Nets) contra lo que no (las FC sobre vectores globales). Duplicar N duplica casi todo el costo.' },
    ],
    edges: [
      { from: 'points', to: 'input-tnet', kind: 'data', tensor: 'points', label: false },
      { from: 'input-tnet', to: 'shared-mlp-1', kind: 'data', tensor: 'points-t', label: false },
      { from: 'shared-mlp-1', to: 'feature-tnet', kind: 'data', tensor: 'h2', label: false },
      { from: 'feature-tnet', to: 'shared-mlp-2', kind: 'data', tensor: 'h2-t', label: false },
      { from: 'shared-mlp-2', to: 'maxpool', kind: 'data', tensor: 'h5', label: false },
      { from: 'maxpool', to: 'head', kind: 'data', tensor: 'global', label: false },
      { from: 'head', to: 'logits', kind: 'data', tensor: 'logits', label: false },
      // carril de segmentación: formas de pointnet-seg
      { from: 'feature-tnet', to: 'seg-concat', kind: 'data', tensor: 'h2-t', config: SEG, fromSide: 'bottom', toSide: 'left', fromAt: 0.5, via: [[73, 31]], labelSide: 'below', labelSeg: 1, labelT: 0.45 },
      { from: 'maxpool', to: 'seg-concat', kind: 'data', tensor: 'global', config: SEG, fromSide: 'bottom', toSide: 'top', via: [[116, 20], [100, 20]], labelSide: 'right', labelSeg: 2, labelT: 0.5 },
      { from: 'seg-concat', to: 'seg-mlp', kind: 'data', tensor: 'concat', config: SEG, label: false },
      { from: 'seg-mlp', to: 'seg-out', kind: 'data', tensor: 'point-logits', config: SEG, label: false },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (ModelNet40, N = 1,024)', steps: [
        { nodes: ['points', 'input-tnet'], edges: ['points>input-tnet', 'input-tnet>shared-mlp-1'], tensors: ['points', 'points-t'],
          text: 'Entran <b>' + q('tensor.points.shape') + '</b> números: ' + q('cfg.N') + ' puntos (x, y, z) en cualquier orden. El T-Net de entrada predice una 3×3 y los alinea: <b>' + q('tensor.points-t.shape') + '</b> (' + q('metrics.inputTnetParams') + ' parámetros).' },
        { expand: 'tnet', nodes: ['tn-mlp1', 'tn-mlp3', 'tn-pool', 'tn-A'], edges: ['tn-mlp3>tn-pool', 'tn-fc2>tn-A', 'tn-A>tn-apply'], tensors: ['itn-h3', 'itn-g', 't-in'],
          text: 'Por dentro, un T-Net es una PointNet chica: MLP compartida hasta <b>' + q('tensor.itn-h3.shape') + '</b>, max-pool a <b>' + q('tensor.itn-g.shape') + '</b>, FC hasta los 9 números de la matriz <b>' + q('tensor.t-in.shape') + '</b> (inicializada en la identidad).' },
        { nodes: ['shared-mlp-1', 'feature-tnet'], edges: ['shared-mlp-1>feature-tnet', 'feature-tnet>shared-mlp-2'], tensors: ['h2', 'h2-t'],
          text: 'MLP compartida 3 → 64 → 64 (<b>' + q('tensor.h2.shape') + '</b>) y el T-Net de features, una 64×64 con regularizador de ortogonalidad: <b>' + q('tensor.h2-t.shape') + '</b>. Los dos T-Nets son ' + q('metrics.tnetParamsShare') + ' de los parámetros.' },
        { nodes: ['shared-mlp-2'], edges: ['shared-mlp-2>maxpool'], tensors: ['h5'],
          text: 'La MLP grande, punto por punto: 64 → 64 → 128 → 1024, <b>' + q('tensor.h5.shape') + '</b>. Hasta acá cada punto se procesó solo: ' + q('metrics.macsPerPoint') + ' MACs por punto.' },
        { nodes: ['maxpool'], edges: ['shared-mlp-2>maxpool', 'maxpool>head'], tensors: ['h5', 'global'],
          text: 'Max-pool sobre los ' + q('cfg.N') + ' puntos: el máximo de cada uno de los 1024 canales, <b>' + q('tensor.global.shape') + '</b>. Simétrico: el orden de los puntos no cambia nada.' },
        { expand: 'maxpool', nodes: ['mp-table', 'mp-crit'], edges: ['mp-table>mp-global'], tensors: ['global'],
          text: 'Por dentro: la tabla <b>' + q('tensor.h5.shape') + '</b> → el máximo de cada columna. Solo importan las filas que ganan alguna columna, los puntos críticos: a lo sumo ' + q('metrics.criticalPointsMax') + '. Quitar cualquier otro punto no cambia la salida.' },
        { nodes: ['head', 'logits'], edges: ['maxpool>head', 'head>logits'], tensors: ['global', 'logits'],
          text: 'La cabeza 1024 → 512 → 256 → ' + q('tensor.logits.shape') + ' clases. Total: ' + q('metrics.params') + ' parámetros y ' + q('metrics.macs') + ' por nube.' },
        { nodes: ['seg-concat', 'seg-mlp', 'seg-out'], edges: ['feature-tnet>seg-concat', 'maxpool>seg-concat', 'seg-concat>seg-mlp', 'seg-mlp>seg-out'], tensors: [],
          text: 'Segmentación (pointnet-seg, N = ' + ks('cfg.N') + '): a cada punto se le pega la global repetida (' + ks('tensor.concat.shape') + ') y una MLP por punto da ' + ks('tensor.point-logits.shape') + ' logits de partes.' },
        { nodes: ['cost'], edges: [], tensors: [],
          text: 'Casi todo el cómputo es por punto (' + q('metrics.perPointMacs') + ' de ' + q('metrics.macs') + '): duplicar N duplica el costo. El max-pool no tiene MACs (≈ ' + q('metrics.maxpoolOps') + ' comparaciones).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) un T-Net por dentro (el de entrada)
  register(Object.assign({
    id: 'tnet', model: 'pointnet', config: C, configs: [C, SEG], kind: 'arch',
    title: 'T-Net: una mini PointNet que predice una matriz', parent: 'pointnet-overview', parentNode: 'input-tnet',
    caption: 'El T-Net de entrada por dentro (el de features es igual con K = 64: entra N × 64 y sale una 64 × 64). Una PointNet chica mira toda la nube: MLP compartida 64-128-1024, max-pool y FC 512-256 hasta K² números, que se ordenan como una matriz K×K y se suman a la identidad (la última capa empieza en cero: al inicio no transforma nada). La nube se multiplica por esa matriz. El de 64×64 lleva además un regularizador que la empuja a ser ortogonal.',
    grid: { w: 124, h: 50 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['tn-pool', 'tn-A', 'tn-apply'], mobileFocusPad: 1,
    opLegend: { mlp: 'MLP compartida (por punto)', head: 'FC sobre el vector global', embed: 'La matriz K×K y su aplicación' },
    edgeLegend: { control: 'Solo en entrenamiento (pérdida)' },
    nodes: [
      { id: 'tn-in', op: 'io', label: 'Puntos', sub: 'N × 3', x: 1, y: 4, w: 13, h: 9, note: 'La nube de entrada (o, en el T-Net de features, las N features de 64).' },
      { id: 'tn-mlp1', op: 'mlp', ops: ['itn-mlp1'], opsExact: true, label: 'MLP 64', sub: 'por punto', subNum: '→ {{tensor.itn-h1.shape}}', x: 18, y: 4, w: 15, h: 9, note: 'conv1d k = 1 + BN + ReLU: 3 → 64 en cada punto.' },
      { id: 'tn-mlp2', op: 'mlp', ops: ['itn-mlp2'], opsExact: true, label: 'MLP 128', sub: 'por punto', subNum: '→ {{tensor.itn-h2.shape}}', x: 37, y: 4, w: 15, h: 9, note: '64 → 128 en cada punto.' },
      { id: 'tn-mlp3', op: 'mlp', ops: ['itn-mlp3'], opsExact: true, label: 'MLP 1024', sub: 'por punto', subNum: '→ {{tensor.itn-h3.shape}}', x: 56, y: 4, w: 16, h: 9, note: '128 → 1024 en cada punto: lo más caro del T-Net.' },
      { id: 'tn-pool', op: 'tensorop', shape: 'pool', ops: ['itn-pool'], opsExact: true, label: 'máx', labelPos: 'above', x: 76, y: 6.5, w: 4, h: 4, note: 'Max-pool sobre los puntos: un vector de 1024 que describe la nube entera, sin importar el orden.' },
      { id: 'tn-fc1', op: 'head', ops: ['itn-fc1'], opsExact: true, label: 'FC 512', sub: 'sobre la global', subNum: '{{tensor.itn-g.shape}} → {{tensor.itn-f1.shape}}', x: 84, y: 4, w: 15, h: 9, note: '1024 → 512 + BN + ReLU.' },
      { id: 'tn-fc2', op: 'head', ops: ['itn-fc2'], opsExact: true, label: 'FC 256', sub: 'sobre la global', subNum: '→ {{tensor.itn-f2.shape}}', x: 103, y: 4, w: 15, h: 9, note: '512 → 256 + BN + ReLU.' },
      { id: 'tn-A', op: 'embed', ops: ['itn-transform'], opsExact: true, label: 'A = W f + b + I', sub: 'K² números → K×K', x: 99, y: 22, w: 23, h: 9,
        tex: 'A = \\mathrm{reshape}_{K\\times K}(W f + b) + I', note: 'Una lineal de 256 a K² (9 o 4,096) con pesos en cero y sesgo igual a la identidad aplanada: al empezar el entrenamiento, A = I y el T-Net no cambia nada.' },
      { id: 'tn-apply', op: 'embed', ops: ['itn-apply'], opsExact: true, label: 'x · A', sub: 'cada punto por la matriz', x: 54, y: 22, w: 22, h: 9,
        tex: "x'_i = x_i A", note: 'Una matmul de N × K por K × K: la misma transformación para todos los puntos (rotar, escalar, sesgar la nube).' },
      { id: 'tn-out', op: 'io', label: 'Puntos alineados', sub: '→ MLP compartida', x: 54, y: 39, w: 22, h: 8, note: 'La nube transformada sigue a la MLP compartida 64-64.' },
      { id: 'tn-reg', op: 'head', label: 'Regularizador', sub: '‖I − AAᵀ‖², solo 64×64', x: 99, y: 39, w: 23, h: 8,
        tex: '\\mathcal{L}_{reg} = \\lVert I - A A^\\top \\rVert_F^2', note: 'Solo en el T-Net de features: empuja a A a ser ortogonal (una rotación no pierde información). Peso 0.001 en la pérdida; ≈ {{metrics.orthoRegMacs}} por nube, solo al entrenar.' },
    ],
    edges: [
      { from: 'tn-in', to: 'tn-mlp1', kind: 'data', tensor: 'points', label: false },
      { from: 'tn-mlp1', to: 'tn-mlp2', kind: 'data', tensor: 'itn-h1', label: false },
      { from: 'tn-mlp2', to: 'tn-mlp3', kind: 'data', tensor: 'itn-h2', label: false },
      { from: 'tn-mlp3', to: 'tn-pool', kind: 'data', tensor: 'itn-h3', label: false },
      { from: 'tn-pool', to: 'tn-fc1', kind: 'data', tensor: 'itn-g', label: false },
      { from: 'tn-fc1', to: 'tn-fc2', kind: 'data', tensor: 'itn-f1', label: false },
      { from: 'tn-fc2', to: 'tn-A', kind: 'data', tensor: 'itn-f2', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.6087, labelSide: 'right', labelT: 0.5 },
      { from: 'tn-A', to: 'tn-apply', kind: 'data', tensor: 't-in', labelSide: 'above', labelT: 0.5 },
      // los puntos originales también entran a la matmul (por abajo, a la izquierda)
      { from: 'tn-in', to: 'tn-apply', kind: 'data', tensor: 'points', fromSide: 'bottom', toSide: 'left', fromAt: 0.5, via: [[7.5, 26.5]], labelSide: 'below', labelSeg: 1, labelT: 0.5 },
      { from: 'tn-apply', to: 'tn-out', kind: 'data', tensor: 'points-t', labelSide: 'right', labelT: 0.5 },
      { from: 'tn-A', to: 'tn-reg', kind: 'control', tag: 'A (64×64)', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) el max-pool por dentro
  register(Object.assign({
    id: 'maxpool', model: 'pointnet', config: C, configs: [C, SEG], kind: 'arch',
    title: 'Max-pool: invariancia al orden y puntos críticos', parent: 'pointnet-overview', parentNode: 'maxpool',
    caption: 'Las features por punto forman una tabla: una fila por punto, una columna por canal (1024). El max-pool se queda con el máximo de cada columna. Barajar los puntos solo permuta las filas, así que el resultado es el mismo: invariancia a permutaciones. Y solo cuentan las filas que ganan alguna columna (punto a la izquierda): los puntos críticos, a lo sumo 1024. Quitar o mover un punto no crítico, mientras no supere ningún máximo, no cambia la salida: por eso PointNet es robusta a puntos faltantes. La tabla es ilustrativa; sus tamaños, del calculador.',
    grid: { w: 124, h: 64 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['mp-table'], mobileFocusPad: 1,
    opLegend: { tensorop: 'Max-pool (sin parámetros)' },
    modLegend: { img: 'Tensor: features de los puntos' },
    legendText: { cellsColmax: 'Tabla (tono ilustrativo): recuadro = el máximo de cada columna; punto = punto crítico (gana alguna); fila de abajo = la feature global' },
    nodes: [
      { id: 'mp-in', op: 'io', label: 'Features por punto', sub: 'salida de la MLP 64-128-1024', x: 18, y: 1, w: 50, h: 7, note: 'Una fila de 1024 features por punto, calculada sin mirar a los otros puntos.' },
      { id: 'mp-table', op: 'tensorop', shape: 'rect', ops: ['max-pool'], opsExact: true, label: 'Máximo de cada columna', sub: 'sobre los N puntos (filas)', x: 6, y: 12, w: 74, h: 34,
        cells: { rows: 'tensor.h5.0', cols: 'tensor.h5.1', maxR: 12, maxC: 18, cell: 10, mark: 'colmax', pooled: true, label: '{{tensor.h5.shape}} → {{tensor.global.shape}}', seed: 1612 },
        tex: 'g_c = \\max_{i=1..N} h_{i,c},\\qquad g(\\pi(X)) = g(X)', note: 'Una función simétrica de las filas: cualquier permutación π de los puntos da el mismo g. La suma o el promedio también lo son, pero con el máximo cada canal "elige" un punto. ≈ {{metrics.maxpoolOps}} comparaciones.' },
      { id: 'mp-global', op: 'io', label: 'Feature global', sub: 'un número por canal', x: 18, y: 50, w: 50, h: 7, note: 'El descriptor de la nube entera que usan la cabeza de clasificación y la de segmentación.' },
      { id: 'mp-perm', op: 'io', hideInBlank: true, label: 'Barajar los puntos', sub: 'permuta las filas:\nlos máximos no cambian', x: 86, y: 14, w: 36, h: 12, note: 'PointNet procesa un conjunto, no una secuencia: el orden en que vienen los puntos de un sensor (o de un muestreo) no tiene significado.' },
      { id: 'mp-crit', op: 'io', hideInBlank: true, label: 'Puntos críticos', sub: 'las filas que ganan\nalguna columna', subNum: '≤ {{metrics.criticalPointsMax}} de {{metrics.N}} puntos', x: 86, y: 30, w: 36, h: 12,
        note: 'Qi et al. (CVPR 2017), teorema 2: el conjunto crítico tiene a lo sumo K = 1024 puntos y define la salida; en la práctica, unos cientos que dibujan el esqueleto del objeto. Agregar puntos dentro de la "forma de cota superior" o quitar no críticos no cambia g.' },
    ],
    edges: [
      { from: 'mp-in', to: 'mp-table', kind: 'data', tensor: 'h5', labelSide: 'right', labelT: 0.5 },
      { from: 'mp-table', to: 'mp-global', kind: 'data', tensor: 'global', labelSide: 'right', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
