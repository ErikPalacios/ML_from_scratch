/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/gbdt.js
   Diagramas de GBDT (SPEC §7.2, ids de §25.3), modelo `gbdt` (js/arch/trees.js):
     gbdt-overview    entrenamiento: datos X (N × F) → cuantizar en bins (una vez) → por cada ronda (× T árboles): gradientes
                      g, h de la pérdida en F_{t−1} → histogramas (Σ g, Σ h por bin y feature, de cada nodo) → mejor corte →
                      árbol t → F_t = F_{t−1} + η·árbol_t → la ronda siguiente. Inferencia: una fila recorre los T árboles
                      (T × profundidad comparaciones) y suma los valores de hoja. Formas y costos del calculador.
       tree           (calc:false, ilustrativo) un árbol de profundidad 3 dibujado entero: cortes "feature < umbral", el camino de
                      una fila (aristas continuas; las ramas no tomadas, punteadas) y su valor de hoja. La config usa más
                      profundidad: sus números, con prefijo de config.
       histogram-split (calc:false) el corte de una feature en un nodo: histograma de G_b, H_b → barrido G_L / G_R → ganancia de
                      XGBoost (½[…] − γ, ec. 7 de Chen y Guestrin 2016) → el mejor corte o una hoja con w = −G/(H + λ); el
                      histograma del hermano por resta.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas y costos: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'xgboost-500-d6', ALL = ['xgboost-500-d6', 'lightgbm-500-l31', 'xgboost-2000-d8', 'catboost-oblivious-d6'];
  const q = (k) => '{{' + k + '}}';
  const k2 = (key) => '{{' + C + '.' + key + '}}';
  const PAGE = { page: 'gbdt', section: 'diagrama' };
  // Subíndices estilo TeX en el html de notas y pasos ("F_{t−1}", "G_L", "x_j") → <sub> (como dit.js); no toca <code> ni las claves {{…}}
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9θ]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };
  const OPLEG = { head: 'Pérdida y sus gradientes', fuse: 'Histogramas y búsqueda del corte', mlp: 'Árboles: umbrales y valores de hoja (lo que se aprende)' };

  // ------------------------------------------------------------------ (a) vista general: el bucle de boosting y la inferencia
  register(Object.assign({
    id: 'gbdt-overview', model: 'gbdt', config: C, configs: ALL, kind: 'arch',
    title: 'GBDT — vista general',
    caption: 'Gradient boosting con árboles: un modelo es la suma de T árboles chicos, y cada árbol nuevo se ajusta a lo que los anteriores todavía erran. Antes de empezar, cada feature se cuantiza en unos cientos de bins (una vez). En cada ronda: los gradientes g y hessianos h de la pérdida en la predicción actual; por cada nodo, un histograma con la suma de g y h por bin de cada feature; el corte de mayor ganancia; y el árbol terminado se suma achicado por η. Predecir es recorrer los T árboles (una comparación por nivel) y sumar sus hojas: cero multiplicaciones de matrices.',
    grid: { w: 150, h: 70 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['histogram', 'best-split', 'tree'], mobileFocusPad: 1,
    opLegend: OPLEG,
    modLegend: { lat: 'Tensor (datos tabulares, gradientes, histogramas)' },
    edgeLegend: { control: 'Bucle por nodo / modelo final' },
    legendText: { runs: 'Veces que corre', runsOnce: 'Corre una vez (antes del bucle)', loop: 'Bucle: se repite (por nodo dentro de la ronda; por árbol entre rondas)', repeat: 'Ronda repetida × T (una por árbol)' },
    groups: [
      { id: 'train', style: 'lane', tone: 'warn', label: 'Entrenamiento', legend: 'Marco ámbar: entrenamiento', labelPos: 'bottom', x: 0.5, y: 0.5, w: 149, h: 47 },
      { id: 'round', label: 'Una ronda de boosting', repeat: { sym: 'T', from: 'nTrees' }, x: 50, y: 3, w: 97, h: 42 },
      { id: 'infer', style: 'lane', tone: 'accent', label: 'Inferencia · por fila', legend: 'Marco azul: inferencia', labelPos: 'bottom', x: 0.5, y: 50, w: 149, h: 19.5 },
    ],
    nodes: [
      { id: 'data', op: 'io', style: 'store', label: 'Datos', sub: 'N filas ×\nF features', subNum: '{{tensor.X.shape}}', x: 2, y: 7, w: 15, h: 12,
        note: 'La tabla de entrenamiento: N = {{cfg.N}} filas con F = {{cfg.F}} features numéricas (las categóricas, codificadas) y el objetivo y. Carga de referencia, no un dataset real.' },
      { id: 'binning', op: 'tensorop', shape: 'rect', costOf: 'binning', label: 'Cuantizar en bins', sub: 'cuantiles por feature', subNum: '≤ {{cfg.histBins}} bins', runs: 'una vez', runsTone: 'once', x: 21, y: 8, w: 19, h: 10,
        note: 'Cada feature se corta en a lo sumo {{cfg.histBins}} bins por cuantiles (un "sketch" de cuantiles en XGBoost) y cada valor se reemplaza por el índice de su bin (1 byte). Se hace una vez; desde ahí, los cortes candidatos son los bordes de los bins, no cada valor distinto.' },
      { id: 'histogram', op: 'fuse', costOf: 'histogram', label: 'Histogramas', sub: 'Σ g y Σ h por bin y feature', subNum: '{{tensor.hist.shape}} por nodo', x: 54, y: 8, w: 27, h: 10,
        note: 'Para cada nodo del árbol en construcción: recorrer sus filas y sumar g y h en el bin de cada feature: F × bins pares (G_b, H_b). Es el costo dominante del entrenamiento (≈ N × F sumas por nivel). Truco: el histograma de un hijo se obtiene restando el del hermano al del padre, así que solo se recorre el hijo más chico.' },
      { id: 'best-split', op: 'fuse', costOf: 'best-split', label: 'Mejor corte', sub: 'máx ganancia sobre F × bins', expand: 'histogram-split', x: 89, y: 8, w: 27, h: 10,
        tex: '\\text{Gain} = \\tfrac{1}{2}\\Big[\\tfrac{G_L^2}{H_L+\\lambda} + \\tfrac{G_R^2}{H_R+\\lambda} - \\tfrac{(G_L+G_R)^2}{H_L+H_R+\\lambda}\\Big] - \\gamma',
        note: 'Barrer los bins de cada feature con sumas acumuladas (G_L, H_L a la izquierda; G_R, H_R = el resto) y quedarse con el corte de mayor ganancia. Si ninguno gana más que γ, el nodo queda hoja. Ábrelo para verlo con números.' },
      { id: 'gradients', op: 'head', costOf: 'gradients', label: 'Gradientes g, h', sub: 'de la pérdida en F_{t−1}', subNum: 'g: {{tensor.g.shape}} · h: {{tensor.h.shape}}', x: 54, y: 28, w: 27, h: 10,
        tex: 'g_i = \\partial_{F}\\, \\ell(y_i, F_{t-1}(x_i)),\\quad h_i = \\partial^2_{F}\\, \\ell(y_i, F_{t-1}(x_i))',
        note: 'Una derivada primera y una segunda por fila. Cuadrática: g = F − y, h = 1 (el árbol ajusta el residuo). Logística: g = p − y, h = p(1 − p). El paso de Newton por hoja (w = −G/H) ya venía de LogitBoost y del TreeBoost de Friedman (2001); XGBoost usa la segunda derivada también para elegir los cortes (la ganancia de su ec. 7) y regulariza con λ y γ.' },
      { id: 'tree', op: 'mlp', costOf: 'tree', label: 'Árbol t', sub: 'cortes + valores de hoja', expand: 'tree', x: 89, y: 28, w: 27, h: 10,
        note: 'El árbol terminado: un umbral por nodo interno y un valor w por hoja (sus "parámetros"). XGBoost crece nivel a nivel hasta la profundidad máxima; LightGBM, hoja a hoja (<code>num_leaves</code>); CatBoost, árboles simétricos (el mismo corte en todo un nivel). Ábrelo para ver uno.' },
      { id: 'update', op: 'tensorop', shape: 'add', costOf: 'update', label: 'F_t = F_{t−1} + η·árbol_t', labelPos: 'right', x: 100.5, y: 40, w: 4, h: 4,
        tex: 'F_t(x) = F_{t-1}(x) + \\eta\\, f_t(x)', note: 'Sumar la predicción del árbol nuevo, achicada por la tasa de aprendizaje η (shrinkage), a la de los anteriores. Con η chico hacen falta más árboles, pero generaliza mejor.' },
      { id: 'x-in', op: 'io', label: 'Una fila x', sub: 'F features', subNum: '{{tensor.x.shape}} features', x: 2, y: 53, w: 17, h: 9, note: 'Una fila a predecir (sin cuantizar: los umbrales guardados son valores reales).' },
      { id: 'predict', op: 'mlp', costOf: 'predict', costExclude: ['sum'], label: 'Recorrer los T árboles', sub: 'una comparación por nivel', subNum: '{{metrics.comparisonsPerPrediction}} comparaciones', runs: '× 1 por fila', x: 30, y: 52.5, w: 40, h: 10,
        note: 'En cada árbol, bajar comparando x_j &lt; umbral hasta una hoja: ≈ {{metrics.comparisonsPerPrediction}} comparaciones y T sumas. En árboles por niveles (XGBoost, CatBoost) son T × profundidad (a lo sumo: una rama puede terminar antes); en los de hoja a hoja (LightGBM), el camino de un árbol balanceado, que no es cota (el camino promedio real puede quedar arriba o abajo). Todo eso, sin multiplicar matrices: ≈ {{metrics.predictionUsOneCore}} µs por fila en un núcleo de CPU, ≈ {{metrics.predictionsPerSecCpu}} filas/s con el socket entero (≈: los saltos de memoria mandan).' },
      { id: 'y-hat', op: 'io', label: 'Predicción ŷ', sub: 'F_0 + η Σ_t w_t(x)', x: 80, y: 53, w: 24, h: 9, note: 'La suma de la predicción inicial (base score) y de una hoja por árbol, cada una por η (en el formato guardado el η ya va dentro de los valores de hoja). Para clasificación, pasa por una sigmoide.' },
    ],
    edges: [
      { from: 'data', to: 'binning', kind: 'data', tensor: 'X', label: false },
      { from: 'binning', to: 'histogram', kind: 'data', tensor: 'Xb', labelSide: 'above', labelT: 0.36 },
      { from: 'histogram', to: 'best-split', kind: 'data', tensor: 'hist', label: false },
      { from: 'best-split', to: 'tree', kind: 'data', tensor: 'split', label: false, tag: '(feature, umbral) por nodo', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'gradients', to: 'histogram', kind: 'data', tensor: 'g', labelSide: 'left', labelT: 0.5 },
      // y vuelve en cada ronda: los gradientes se miden contra el objetivo
      { from: 'data', to: 'gradients', kind: 'data', tensor: 'y', fromSide: 'bottom', toSide: 'left', fromAt: 0.5, via: [[9.5, 33]], labelSide: 'above', labelT: 0.6 },
      { from: 'tree', to: 'update', kind: 'data', tensor: 'tree', label: false },
      { from: 'update', to: 'gradients', kind: 'data', tensor: 'F-new', fromSide: 'left', toSide: 'bottom', via: [[67.5, 42]], loop: true, labelSide: 'below', labelT: 0.25 },
      // dentro de la ronda: histogramas y corte se repiten por cada nodo, nivel a nivel
      { from: 'best-split', to: 'histogram', kind: 'control', fromSide: 'top', toSide: 'top', fromAt: 0.5, toAt: 0.5, via: [[102.5, 5.5], [67.5, 5.5]], tag: 'por cada nodo, nivel a nivel', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5, loop: true },
      { from: 'x-in', to: 'predict', kind: 'data', tensor: 'x', label: false },
      { from: 'predict', to: 'y-hat', kind: 'data', tensor: 'y-hat', label: false },
      { from: 'update', to: 'predict', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.45, tag: 'los T árboles entrenados', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (una ronda y una predicción)', steps: [
        { nodes: ['data', 'binning'], edges: ['data>binning', 'binning>histogram'], tensors: ['X', 'Xb'],
          text: 'Una vez: los <b>' + q('tensor.X.shape') + '</b> valores se cuantizan en a lo sumo ' + q('cfg.histBins') + ' bins por feature (<b>' + q('tensor.Xb.shape') + '</b> índices de 1 byte).' },
        { nodes: ['gradients'], edges: ['data>gradients', 'gradients>histogram'], tensors: ['y', 'g'],
          text: 'Ronda t: un gradiente y un hessiano por fila (<b>' + q('tensor.g.shape') + '</b> cada uno), medidos en la predicción actual F_{t−1}.' },
        { nodes: ['histogram', 'best-split'], edges: ['histogram>best-split', 'best-split>histogram'], tensors: ['hist'],
          text: 'Por cada nodo: el histograma <b>' + q('tensor.hist.shape') + '</b> (Σ g y Σ h por bin y feature) y el corte de mayor ganancia, nivel a nivel (hoja a hoja en LightGBM). ≈ ' + q('metrics.histogramAddsPerTree') + ' sumas por árbol.' },
        { expand: 'histogram-split', nodes: ['hs-scan', 'hs-gain'], edges: ['hs-scan>hs-gain'], tensors: [],
          text: 'Por dentro: G_L, H_L acumulados de izquierda a derecha, G_R y H_R por resta, y la ganancia ½[G_L²/(H_L+λ) + G_R²/(H_R+λ) − G²/(H+λ)] − γ de cada corte.' },
        { nodes: ['tree', 'update'], edges: ['best-split>tree', 'tree>update', 'update>gradients'], tensors: ['split', 'tree', 'F-new'],
          text: 'El árbol terminado (' + q('metrics.nodesPerTree') + ' nodos guardados, ' + q('metrics.leavesPerTree') + ' de ellos hojas) se suma achicado por η = ' + q('cfg.eta') + ': F_t = F_{t−1} + η·árbol_t. Se repite ' + q('cfg.nTrees') + ' veces.' },
        { expand: 'tree', nodes: ['t-s0', 't-s2', 't-s5', 't-l5'], edges: ['t-s0>t-s2', 't-s2>t-s5', 't-s5>t-l5'], tensors: [],
          text: 'Un árbol por dentro: la fila baja comparando una feature contra un umbral en cada nivel hasta una hoja, y suma su valor.' },
        { nodes: ['x-in', 'predict', 'y-hat'], edges: ['x-in>predict', 'predict>y-hat', 'update>predict'], tensors: ['x', 'y-hat'],
          text: 'Predecir: ≈ ' + q('metrics.comparisonsPerPrediction') + ' comparaciones y ' + q('cfg.nTrees') + ' sumas, sin una sola multiplicación de matrices. El modelo ocupa ≈ ' + q('metrics.modelBytes') + '.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) un árbol (ilustrativo, profundidad 3)
  // camino de la fila: visitas = 12 (no < 5.5 → derecha), precio = 80 (< 100 → izquierda), edad = 34 (no < 30 → derecha) → hoja 6
  const LEAVES = ['−0.42', '−0.18', '−0.05', '+0.12', '−0.09', '+0.31', '+0.22', '+0.47'];
  const leaf = (i) => ({ id: 't-l' + i, op: 'mlp', label: LEAVES[i], sub: 'hoja ' + (i + 1), x: 1 + 15 * i, y: 44, w: 13, h: 7,
    note: i === 5 ? 'La hoja donde cae la fila de ejemplo: w = +0.31. Su valor salió de w = −G/(H + λ) con las filas de entrenamiento que cayeron aquí.' : 'Valor de hoja w = −G/(H + λ) de las filas de entrenamiento que cayeron aquí (ilustrativo).' });
  const SPLITS = [
    { id: 't-s0', label: 'visitas < 5.5', x: 46, y: 4, w: 30 },
    { id: 't-s1', label: 'precio < 40', x: 18, y: 17, w: 26 },
    { id: 't-s2', label: 'precio < 100', x: 78, y: 17, w: 26 },
    { id: 't-s3', label: 'edad < 25', x: 3, y: 30, w: 24 },
    { id: 't-s4', label: 'edad < 60', x: 32, y: 30, w: 24 },
    { id: 't-s5', label: 'edad < 30', x: 64, y: 30, w: 24 },
    { id: 't-s6', label: 'móvil < 0.5', x: 94, y: 30, w: 24 },
  ];
  const ON_PATH = { 't-s0>t-s2': 1, 't-s2>t-s5': 1, 't-s5>t-l5': 1 };
  const kids = [['t-s0', 't-s1', 't-s2'], ['t-s1', 't-s3', 't-s4'], ['t-s2', 't-s5', 't-s6'], ['t-s3', 't-l0', 't-l1'], ['t-s4', 't-l2', 't-l3'], ['t-s5', 't-l4', 't-l5'], ['t-s6', 't-l6', 't-l7']];
  const treeEdges = [];
  kids.forEach(([p, a, b]) => [[a, 'sí', 0.3], [b, 'no', 0.7]].forEach(([c, tag, at]) => {
    const on = ON_PATH[p + '>' + c];
    treeEdges.push({ from: p, to: c, kind: on ? 'data' : 'control', fromSide: 'bottom', toSide: 'top', fromAt: at, toAt: 0.5, tag, tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 });
  }));
  register(Object.assign({
    id: 'tree', model: 'gbdt', calc: false, calcNote: 'Árbol ilustrativo (profundidad 3, features y umbrales inventados); los tamaños reales de la config van en el texto.',
    kind: 'arch', title: 'Un árbol por dentro', parent: 'gbdt-overview', parentNode: 'tree',
    caption: 'Un árbol de decisión de profundidad 3 (ilustrativo; ' + C + ' usa profundidad ' + k2('cfg.depth') + ': hasta ' + k2('metrics.leavesPerTree') + ' hojas). Cada nodo interno compara UNA feature contra un umbral ("sí" a la izquierda); cada hoja guarda un número w. La fila de ejemplo (visitas = 12, precio = 80, edad = 34) baja por las aristas continuas y cae en la hoja 6: el árbol aporta η·w a la predicción. Las ramas punteadas no se recorren: predecir cuesta una comparación por nivel. En CatBoost (árboles simétricos) todos los nodos de un nivel usan el mismo corte.',
    grid: { w: 122, h: 66 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['t-s2', 't-s5', 't-l5'], mobileFocusPad: 1,
    opLegend: { fuse: 'Nodo interno: una feature contra un umbral', mlp: 'Hoja: un valor w (lo que suma el árbol)' },
    edgeLegend: { data: 'Camino de la fila de ejemplo', control: 'Rama no tomada' },
    edgeLegendAria: true,
    nodes: [
      { id: 't-x', op: 'io', label: 'Una fila x', sub: 'visitas 12 · precio 80 · edad 34', x: 2, y: 3, w: 36, h: 8, note: 'La fila de ejemplo (ilustrativa): tres de sus F features.' },
      ...SPLITS.map((s) => ({ id: s.id, op: 'fuse', label: s.label, sub: s.id === 't-s0' ? 'raíz' : '', x: s.x, y: s.y, w: s.w, h: s.id === 't-s0' ? 8 : 7,
        note: 'Nodo interno: "' + s.label.replace('<', '&lt;') + '" → sí a la izquierda, no a la derecha. El umbral es el borde de un bin elegido por la ganancia; si falta el valor, XGBoost manda la fila por la dirección por omisión que aprendió para este nodo.' })),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map(leaf),
      { id: 't-out', op: 'io', label: 'Aporte: η·w', sub: 'η = 0.1 → +0.031 a F(x)', x: 62, y: 56, w: 34, h: 8, note: 'Lo que suma este árbol a la predicción de esta fila: η × w = 0.1 × 0.31 (ilustrativo). La predicción final suma un aporte por árbol: ' + k2('cfg.nTrees') + ' en ' + C + '.' },
    ],
    edges: [
      { from: 't-x', to: 't-s0', kind: 'data', tag: 'x', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      ...treeEdges,
      { from: 't-l5', to: 't-out', kind: 'data', tag: 'w = +0.31', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido: una fila baja por el árbol', steps: [
        { nodes: ['t-x', 't-s0'], edges: ['t-x>t-s0'], text: 'Raíz: ¿visitas &lt; 5.5? La fila tiene 12: <b>no</b>, a la derecha.' },
        { nodes: ['t-s2'], edges: ['t-s0>t-s2'], text: 'Nivel 2: ¿precio &lt; 100? Tiene 80: <b>sí</b>, a la izquierda.' },
        { nodes: ['t-s5'], edges: ['t-s2>t-s5'], text: 'Nivel 3: ¿edad &lt; 30? Tiene 34: <b>no</b>, a la derecha.' },
        { nodes: ['t-l5', 't-out'], edges: ['t-s5>t-l5', 't-l5>t-out'], text: 'Hoja 6: w = +0.31; el árbol suma η·w = +0.031. Tres comparaciones, ninguna multiplicación de matrices.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) el corte de una feature con histogramas
  register(Object.assign({
    id: 'histogram-split', model: 'gbdt', calc: false, calcNote: 'Histograma ilustrativo (16 bins); los tamaños reales de la config van en los subtítulos. La visualización de la página hace las cuentas.',
    kind: 'arch', title: 'Elegir el corte con histogramas', parent: 'gbdt-overview', parentNode: 'best-split',
    caption: 'Cómo un GBDT elige el corte de una feature en un nodo sin ordenar filas. Las filas del nodo se reparten en los bins de la feature y se suman sus gradientes y hessianos: G_b y H_b por bin. Un barrido de izquierda a derecha da, para cada corte entre bins, las sumas del lado izquierdo (G_L, H_L) y, por resta, las del derecho. La ganancia de XGBoost compara el objetivo con y sin el corte; λ regulariza y γ es el precio de una hoja más. Se repite para las F features y gana el mayor; si nada supera 0, el nodo queda hoja con w = −G/(H + λ).',
    grid: { w: 104, h: 77 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['hs-hist', 'hs-gain'], mobileFocusPad: 1,
    opLegend: { fuse: 'Histograma y ganancia', head: 'Hoja: su valor óptimo' },
    edgeLegend: { data: 'Lo que pasa a la etapa siguiente', control: 'Histograma por resta (sin recorrer filas)' },
    nodes: [
      { id: 'hs-rows', op: 'io', label: 'Filas del nodo', sub: 'cada una: (g_i, h_i) y su bin', x: 4, y: 1, w: 42, h: 8, note: 'Las filas que llegaron a este nodo, con el gradiente y el hessiano de la ronda y el índice de bin de cada feature.' },
      { id: 'hs-sibling', op: 'io', label: 'Padre − hermano', sub: 'el otro hijo, por resta', x: 58, y: 1, w: 42, h: 8,
        note: 'Truco de LightGBM y XGBoost: el histograma de un hijo = el del padre − el del hermano, bin a bin. Se recorre solo el hijo con menos filas y el otro sale gratis.' },
      { id: 'hs-hist', op: 'fuse', label: 'Histograma de la feature j', sub: 'G_b = Σ g, H_b = Σ h de las filas del bin b', subNum: 'G_b = Σ g, H_b = Σ h · ≤ ' + k2('cfg.histBins') + ' bins × ' + k2('cfg.F') + ' features en ' + C, x: 4, y: 13, w: 96, h: 19,
        hist: { n: 16, split: 9, seed: 7, h: 92, left: 'G_L, H_L (bins ≤ k)', right: 'G_R, H_R' },
        note: 'Una barra por bin: la suma de los gradientes de sus filas (ilustrativo). La línea punteada es un corte candidato k: los bins a su izquierda van a un hijo y el resto al otro.' },
      { id: 'hs-scan', op: 'tensorop', shape: 'rect', label: 'Barrido izquierda → derecha', sub: 'G_L += G_b, H_L += H_b · G_R = G − G_L', x: 14, y: 36, w: 76, h: 8,
        tex: 'G_L(k) = \\sum_{b \\le k} G_b,\\quad G_R(k) = G - G_L(k)\\quad (\\text{ídem } H)', note: 'Una pasada por los bins con sumas acumuladas: bins − 1 cortes candidatos por feature, sin volver a mirar filas.' },
      { id: 'hs-gain', op: 'fuse', label: 'Ganancia de cada corte', sub: '½[G_L²/(H_L+λ) + G_R²/(H_R+λ) − G²/(H+λ)] − γ', x: 6, y: 48, w: 92, h: 9,
        tex: '\\text{Gain} = \\tfrac{1}{2}\\Big[\\tfrac{G_L^2}{H_L+\\lambda} + \\tfrac{G_R^2}{H_R+\\lambda} - \\tfrac{(G_L+G_R)^2}{H_L+H_R+\\lambda}\\Big] - \\gamma',
        note: 'Chen y Guestrin (KDD 2016), ec. 7: cuánto baja el objetivo regularizado al partir el nodo. λ (<code>reg_lambda</code>, 1 por omisión) achica los pesos y castiga los lados con poco H; γ (<code>min_split_loss</code>, 0 por omisión) es el costo de una hoja más. Un lado con H &lt; <code>min_child_weight</code> (1) no se permite. En el código de XGBoost el corchete va sin el ½ y el nodo se poda si es menor que γ.' },
      { id: 'hs-best', op: 'tensorop', shape: 'pill', symbol: 'pick', label: 'máx sobre cortes y features', x: 18, y: 61, w: 68, h: 4, note: 'El mejor corte de todas las features: (feature, umbral, ganancia).' },
      { id: 'hs-out', op: 'io', label: 'Corte (feature, umbral)', sub: 'si la ganancia > 0', x: 4, y: 69, w: 44, h: 6.5, note: 'El nodo se parte: dos hijos que se procesan en el nivel siguiente (con sus histogramas, uno por resta).' },
      { id: 'hs-leaf', op: 'head', label: 'Si no: hoja', sub: 'w = −G/(H + λ)', x: 56, y: 69, w: 44, h: 6.5, tex: 'w^{*} = -\\frac{G}{H + \\lambda}', note: 'Chen y Guestrin, ec. 5: el valor óptimo de una hoja con sumas G, H (un paso de Newton regularizado). Con pérdida cuadrática y λ = 0, el promedio del residuo.' },
    ],
    edges: [
      { from: 'hs-rows', to: 'hs-hist', kind: 'data', toAt: 0.2188, tag: 'sumar g, h en su bin', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'hs-sibling', to: 'hs-hist', kind: 'control', toAt: 0.7812, tag: 'o por resta', tagBlank: false, tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'hs-hist', to: 'hs-scan', kind: 'data', tag: 'bins × (G_b, H_b)', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'hs-scan', to: 'hs-gain', kind: 'data', tag: 'G_L, H_L, G_R, H_R por corte', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'hs-gain', to: 'hs-best', kind: 'data', tag: 'bins − 1 ganancias por feature', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'hs-best', to: 'hs-out', kind: 'data', fromAt: 0.25, toAt: 0.5, tag: '> 0', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'hs-best', to: 'hs-leaf', kind: 'data', fromAt: 0.75, toAt: 0.5, tag: '≤ 0', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
