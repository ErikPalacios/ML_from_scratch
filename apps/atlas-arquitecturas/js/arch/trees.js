/* =============================================================================
   Atlas de Arquitecturas — js/arch/trees.js
   Modelo `gbdt` (página `gbdt`); contrato SPEC §25.3. Tesis: con datos tabulares los árboles siguen ganando, y son BARATOS en
   inferencia (comparaciones, 0 MACs) y caros en entrenamiento (histogramas de gradientes: ≈ N·F sumas por nivel y árbol).
   Cargar DESPUÉS de retrieval.js (usa su CPU AMD EPYC 9654 para las cotas ≈).
   Cross-check: crosscheck/trees.py (proceso aparte de torch) — modelos REALES de xgboost 3.4.1, lightgbm 4.7.0 y catboost 1.2.10
   entrenados con datos sintéticos (y = Xw + ε, F = 100) a escala reducida (N = 50,000: calc_overrides {N: 50000}): defaults de las
   librerías, nodos / hojas, formas de los datos (bins por feature, hojas por muestra), parámetros aprendidos y bytes del modelo
   guardado contra las fórmulas de primitives.tree_bytes.

   ---------------------------------------------------------------- convenciones
   No fluyen tensores por un árbol: el grafo es de CONTABILIDAD (un ciclo de boosting, repeat = K árboles, + una predicción).
   0 MACs en todo el modelo (FLOPs = 0): el costo va en "otros" (≈: sumas de histograma, candidatos de corte, comparaciones) y en
   metrics. "Parámetros" = los números aprendidos: un umbral por corte + un valor por hoja (+ la predicción base). Las vistas `tree`
   e `histogram-split` pueden ser calc:false (como RT-2) con badges de metrics.
   Símbolos: N (filas), F (features), n_bins (bins del histograma por feature), K (árboles), d (profundidad), n_leaves, n_nodes, n_int.
   mod 'lat' (datos numéricos). Bytes decimales.

   ---------------------------------------------------------------- configs (defaults verificados en las librerías instaladas)
   xgboost-500-d6 (canónica): 500 árboles, max_depth 6, η = 0.1 (no cambia el costo), tree_method auto = hist (updater
     grow_quantile_histmaker), max_bin 256 (default de xgboost 3.4.1: save_config) → 257 cortes por feature (get_quantile_cut: el
     último es máx + ε), λ = 1, γ = 0, min_child_weight 1, crecimiento por profundidad (depthwise). Carga de referencia N = 1M × F = 100.
   lightgbm-500-l31: 500 árboles, num_leaves 31 y max_depth −1 (defaults de lightgbm 4.7.0), max_bin 255 (feature_num_bin = 255),
     min_data_in_leaf 20, λ_l2 = 0, crecimiento por HOJAS (leaf-wise): la profundidad de cada camino depende de los datos.
     boost_from_average = 1: la predicción base va DENTRO de las hojas del primer árbol (sin número aparte).
   xgboost-2000-d8: 2,000 árboles de profundidad 8 (más capacidad: 511 nodos por árbol lleno).
   catboost-oblivious-d6: 500 árboles SIMÉTRICOS (oblivious, grow_policy SymmetricTree, default) de profundidad 6 (default),
     border_count 254 → 255 bins, l2_leaf_reg 3: un corte por NIVEL compartido por todos los nodos: 6 umbrales + 64 hojas por
     árbol (nodesPerTree = 70, no 127); predecir = 6 comparaciones → índice de 6 bits → leer la hoja (sin saltos impredecibles).
   Knobs: nTrees, depth (por hojas: tope 2^d hojas), leaves (solo leaf-wise), F, N, bins.

   ---------------------------------------------------------------- nodos y ops (op.path) → tensores
   Vista `gbdt-overview`: binning (una vez) · gradients · histogram · best-split · tree · update (F_t = F_{t−1} + η·árbol_t) ·
   predict › {walk, sum}. Ops: binning (X → Xb) · grad-hess (y, F-prev → g, h) · histogram (Xb, g, h → hist: F × n_bins × 2 de UN
   nodo; el costo es el del árbol) · split-find (hist → split: feature, umbral, ganancia) · grow-tree (split → tree: n_nodes números
   aprendidos; los parámetros) · update (F-prev, tree → F-new) · predict-walk (x → leaf-ids, K) · predict-sum (leaf-ids → y-hat).
   Entradas: X (N×F), y (N), F-prev (N), x (F). Todas las ops de entrenamiento salvo binning tienen repeat = K.

   ---------------------------------------------------------------- metrics (units en metrics.units)
   nodes / leaves / internalNodes / nodesPerTree / leavesPerTree / paramsPerTree (ÁRBOLES LLENOS: cota superior; CatBoost y las
   hojas de LightGBM son exactos; XGBoost poda las ramas sin ganancia: measuredNodes / measuredLeaves / measuredFullShare = nodos
   medidos ÷ cota llena (fracción de NODOS, no de árboles) del modelo real del crosscheck). Oblivious (CatBoost): lo GUARDADO por
   árbol son d cortes (uno por nivel, compartido) + 2^d hojas → internalNodes = K·d, nodesPerTree = paramsPerTree = d + 2^d (70
   con d = 6), igual que el tensor `tree` y el crosscheck; el árbol binario equivalente tendría 2^(d+1) − 1 nodos.
   modelBytes (formato por defecto de la librería, ≈ tree_bytes con los nodos llenos), modelBytesMeasured (tree_bytes con los nodos
   medidos: ≈ el archivo), modelBytesJson (XGBoost: ≈ 58 B por nodo con árboles LLENOS, no medido), comparisonsPerPrediction (K·d;
   leaf-wise: K·⌈log₂ L⌉ ≈ el camino de un árbol BALANCEADO — NO es cota: el promedio ponderado por datos de un árbol desbalanceado
   puede quedar por encima (3,924 medido en el crosscheck) o por debajo (1,564 con el objetivo no lineal del crosscheck); las únicas cotas son
   K ≤ camino ≤ K·(L − 1)), comparisonsMax (leaf-wise: K·(L − 1)), comparisonsMeasured (camino promedio medido × K; comparisonsMeasuredNonlinear: lo mismo
   con el objetivo no lineal del crosscheck, por debajo del balanceado),
   predictionsPerSecCpu (≈ cota: 1 comparación por ciclo y núcleo en los 96 núcleos del EPYC 9654), predictionUsOneCore,
   histogramRowsPerTree, histogramAddsPerTree (2·filas·F: G y H), histogramBytesPerNode (F·n_bins·2·8: sumas en fp64),
   splitEvalsPerTree (nodos evaluados × F × n_bins), trainOpsPerTree, trainOps (K × árbol + binning), trainSecCpu (≈ cota a 1 op
   por ciclo y núcleo), binnedDataBytes (N·F·1 byte con ≤ 256 bins guardados: XGBoost mira max_bin — 256 → 1 byte aunque su
   histograma tenga 257 entradas; medido con QuantileDMatrix: la misma memoria con max_bin 64 y 256, crece con 257 —; LightGBM
   max_bin; CatBoost border_count + 1), rawDataBytes (N·F·4), histogramShareTrain.

   ---------------------------------------------------------------- desviaciones respecto de SPEC §25.3 (añadidos)
   - nodos / hojas = árboles LLENOS (cota); los modelos reales de XGBoost quedan por debajo (measured*), los de LightGBM (31 hojas)
     y CatBoost (64) llegan siempre. comparisons para leaf-wise = K·⌈log₂ L⌉ (≈ camino de un árbol balanceado; no es cota), no
     K·d (no hay d).
   - bins: el knob es el max_bin / border_count de la librería; el histograma de XGBoost tiene max_bin + 1 entradas por feature.
   - Hardware: la CPU de retrieval.js (EPYC 9654, 96 núcleos a 2.4 GHz): cotas a 1 op por ciclo y núcleo.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel || !A.tree_bytes) throw new Error('trees.js necesita js/arch/primitives.js (fase 13) antes.');
  if (!A.retrieval || !A.retrieval.cpu) throw new Error('trees.js necesita js/arch/retrieval.js antes (CPU de las cotas ≈).');
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);
  // CPU de las cotas: AMD EPYC 9654 (1 socket, 96 núcleos a 2.4 GHz base; ficha de AMD), como el ANN de retrieval.js.
  const CPU = Object.assign({}, A.retrieval.cpu, { cores: 96, hz: 2.4e9 });

  // measured: lo que dio el modelo REAL de crosscheck/trees.py con N = 50,000 × F = 100 (y = Xw + ε, semilla 13): nodos y hojas
  // totales, camino promedio por árbol (leaf-wise). Lo regenera el crosscheck; el JSON lo compara.
  const GB_BASE = { N: 1000000, F: 100, eta: 0.1, lambda: 1, gamma: 0, loss: 'squared', Nref: 50000 };
  const GB_CONFIGS = {
    'xgboost-500-d6': Object.assign({}, GB_BASE, { label: 'XGBoost · 500 árboles de profundidad 6 (hist, 256 bins)', canonical: true, lib: 'xgboost', kind: 'depthwise',
      nTrees: 500, depth: 6, bins: 256, format: 'xgb-ubj', measured: { N: 50000, nodes: 61942, leaves: 31221 },
      source: 'Chen y Guestrin, XGBoost, KDD 2016, arXiv:1603.02754. xgboost 3.4.1: tree_method auto → hist (grow_quantile_histmaker), max_bin 256, λ 1, γ 0, min_child_weight 1 (save_config). η = 0.1 y N = 1M × F = 100: carga de referencia elegida aquí.' }),
    'lightgbm-500-l31': Object.assign({}, GB_BASE, { label: 'LightGBM · 500 árboles de 31 hojas (leaf-wise)', lib: 'lightgbm', kind: 'leafwise',
      nTrees: 500, leaves: 31, depth: 0, bins: 255, lambda: 0, format: 'lgb-text', measured: { N: 50000, nodes: 30500, leaves: 15500, avgPath: 7.847548, avgPathNonlinear: 3.128093 },
      source: 'Ke et al., LightGBM, NeurIPS 2017. lightgbm 4.7.0: num_leaves 31, max_depth −1, max_bin 255, min_data_in_leaf 20, lambda_l2 0, boost_from_average (la base va en las hojas del árbol 1).' }),
    'xgboost-2000-d8': Object.assign({}, GB_BASE, { label: 'XGBoost · 2,000 árboles de profundidad 8', lib: 'xgboost', kind: 'depthwise',
      nTrees: 2000, depth: 8, bins: 256, format: 'xgb-ubj', measured: { N: 50000, nodes: 743392, leaves: 372696 },
      source: 'xgboost 3.4.1 (defaults como xgboost-500-d6) con max_depth 8 y 2,000 rondas: más capacidad (y más riesgo de sobreajuste).' }),
    'catboost-oblivious-d6': Object.assign({}, GB_BASE, { label: 'CatBoost · 500 árboles simétricos (oblivious) de profundidad 6', lib: 'catboost', kind: 'oblivious',
      nTrees: 500, depth: 6, bins: 254, lambda: 3, format: 'cb-cbm', measured: { N: 50000, nodes: 35000, leaves: 32000 },
      source: 'Prokhorenkova et al., CatBoost, NeurIPS 2018, arXiv:1706.09516. catboost 1.2.10: depth 6, border_count 254, l2_leaf_reg 3, grow_policy SymmetricTree (defaults; get_all_params). 500 iteraciones y η = 0.1 elegidos aquí (el default es 1,000 con η automático).' }),
  };

  function gbApplyKnobs(c, ov) {
    Object.assign(c, ov);
    const ks = Object.keys(ov);
    if (ks.length) c._notes = ks.map((k) => k + ' = ' + ov[k] + ' (what-if)');
    if (c.kind !== 'leafwise' && ov.leaves !== undefined) (c._notes = c._notes || []).push('leaves solo aplica al crecimiento por hojas (LightGBM): aquí manda depth');
    return c;
  }
  function gbResolve(c) {
    const W = 'GBDT: ';
    if (c.kind === 'leafwise') {
      if (c.leaves < 2) throw new Error(W + 'num_leaves = ' + c.leaves + ' (≥ 2).');
      c.leavesEff = c.depth ? Math.min(c.leaves, Math.pow(2, c.depth)) : c.leaves;
      if (c.depth && c.leavesEff < c.leaves) (c._notes = c._notes || []).push('max_depth = ' + c.depth + ' limita los árboles a ' + c.leavesEff + ' hojas');
      c.leavesPerTree = c.leavesEff;
      c.internalPerTree = c.leavesEff - 1;
      c.pathDepth = Math.ceil(Math.log2(c.leavesEff));   // ≈ camino de un árbol balanceado (no es cota: el real puede quedar arriba o abajo)
    } else {
      if (c.depth < 1 || c.depth > 16) throw new Error(W + 'depth = ' + c.depth + ' (1 a 16).');
      c.leavesPerTree = Math.pow(2, c.depth);
      // Oblivious: un corte por NIVEL (compartido por los 2^l nodos del nivel) → se guardan d cortes, no 2^d − 1.
      c.internalPerTree = c.kind === 'oblivious' ? c.depth : c.leavesPerTree - 1;
      c.pathDepth = c.depth;
    }
    if (c.bins < 2 || c.bins > 65536) throw new Error(W + 'bins = ' + c.bins + ' (2 a 65,536).');
    c.histBins = c.lib === 'xgboost' ? c.bins + 1 : c.lib === 'catboost' ? c.bins + 1 : c.bins;
    c.nodesPerTree = c.internalPerTree + c.leavesPerTree;
    c.paramsPerTree = c.internalPerTree + c.leavesPerTree;
    // Ancho del índice de bin guardado (1 byte si caben ≤ 256 valores): XGBoost decide con max_bin (= c.bins; su corte 257 es
    // máx + ε y no agrega un valor guardado), LightGBM con max_bin y CatBoost con border_count + 1 bins.
    c.storedBins = c.lib === 'xgboost' ? c.bins : c.histBins;
    c.binBytes = c.storedBins <= 256 ? 1 : 2;
    c.base = c.lib === 'lightgbm' ? 0 : 1;
    return c;
  }

  function gbBuild(c) {
    const g = A.graph(c);
    const K = c.nTrees, Wt = ['Entrenamiento (un árbol por ronda, × K)'];
    const X = g.input('X', shp(['N', 'F'], [c.N, c.F], 'lat', 'seq'), { label: 'Datos de entrenamiento: N filas × F features', tex: 'X' });
    const y = g.input('y', shp(['N'], [c.N], 'lat', 'vec'), { label: 'Objetivo de cada fila', tex: 'y' });
    const fp = g.input('F-prev', shp(['N'], [c.N], 'lat', 'vec'), { label: 'Predicción actual F_{t−1} de cada fila (la suma de los árboles anteriores)', tex: 'F_{t-1}' });
    const xb = g.op('binning', A.quantize_bins(X, { bins: c.histBins, storedBins: c.storedBins }), { path: ['binning'], out: 'Xb', where: ['Preparación (una vez)'], label: 'Discretizar cada feature en ≤ ' + c.histBins + ' bins (cuantiles)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Índice de bin de cada valor (1 byte)', tex: '\\mathrm{bin}(X)' } });
    const [gr, he] = g.op('grad-hess', A.grad_hess(y, fp, { loss: c.loss }), { path: ['gradients'], out: ['g', 'h'], where: Wt, repeat: K, label: 'Gradiente y hessiana de la pérdida en cada fila', type: 'tensorop', group: 'head',
      outMeta: [{ label: 'Gradientes g_i = ∂ℓ/∂F', tex: 'g' }, { label: 'Hessianas h_i = ∂²ℓ/∂F²', tex: 'h' }] });
    const rows = A.treeHistRows({ kind: c.kind, N: c.N, depth: c.depth, leaves: c.leavesPerTree });
    const ev = A.treeSplitEvals({ kind: c.kind, depth: c.depth, leaves: c.leavesPerTree, F: c.F, bins: c.histBins });
    const hist = g.op('histogram', A.histogram_build(xb, gr, he, { rows, F: c.F, bins: c.histBins, nodes: ev.nodes }), { path: ['histogram'], out: 'hist', where: Wt, repeat: K,
      label: 'Histogramas de gradientes (G, H por bin y feature; resta padre − hermano)', type: 'attn', group: 'attn',
      outMeta: { label: 'Histograma de UN nodo: G y H por bin de cada feature', tex: '(G_b, H_b)' } });
    const sp = g.op('split-find', A.split_find(hist, { evals: ev.evals, nodes: ev.nodes }), { path: ['best-split'], out: 'split', where: Wt, repeat: K,
      label: 'Mejor corte: ganancia en cada bin de cada feature', type: 'head', group: 'head',
      outMeta: { label: 'Feature, umbral y ganancia del mejor corte', tex: '(f^*, b^*, \\mathrm{gain})' } });
    const tr = g.op('grow-tree', A.grow_tree(sp, { internal: c.internalPerTree, leaves: c.leavesPerTree, oblivious: c.kind === 'oblivious', depth: c.depth }), { path: ['tree'], out: 'tree', where: Wt, repeat: K,
      label: c.kind === 'oblivious' ? 'Árbol simétrico: ' + c.depth + ' umbrales + ' + c.leavesPerTree + ' hojas' : 'Árbol t: ' + c.internalPerTree + ' umbrales + ' + c.leavesPerTree + ' hojas', type: 'mlp', group: 'mlp',
      outMeta: { label: 'El árbol t (sus números aprendidos)', tex: 'f_t' } });
    g.op('update', A.tree_update(fp, tr, { depth: c.pathDepth, eta: c.eta }), { path: ['update'], out: 'F-new', where: Wt, repeat: K, label: 'F_t = F_{t−1} + η·árbol_t(x) en las N filas', type: 'tensorop', group: 'resid',
      outMeta: { label: 'Predicción tras el árbol t (la F_{t−1} de la ronda siguiente)', tex: 'F_t = F_{t-1} + \\eta f_t' } });
    const Wp = ['Inferencia (una muestra)'];
    const x = g.input('x', shp(['F'], [c.F], 'lat', 'vec'), { label: 'Una muestra: F features (sin discretizar: se compara con los umbrales)', tex: 'x' });
    const li = g.op('predict-walk', A.tree_predict(x, { K, comparisons: K * c.pathDepth }), { path: ['predict', 'walk'], out: 'leaf-ids', where: Wp,
      label: 'Bajar por los K árboles (' + (c.kind === 'leafwise' ? '≈ ' : '') + fint(K * c.pathDepth) + ' comparaciones' + (c.kind === 'leafwise' ? ', camino balanceado' : '') + ')', type: 'tensorop', group: 'head',
      outMeta: { label: 'La hoja a la que cae x en cada árbol', tex: '\\ell_t(x)' } });
    g.op('predict-sum', A.leaf_sum(li, { base: !!c.base }), { path: ['predict', 'sum'], out: 'y-hat', where: Wp, label: 'Sumar los valores de hoja' + (c.base ? ' + la base' : ' (la base ya está en el árbol 1)'), type: 'head', group: 'head',
      outMeta: { label: 'Predicción', tex: '\\hat y = b + \\textstyle\\sum_t w_t(\\ell_t(x))' } });
    return g;
  }

  function gbCost(c, r) {
    const K = c.nTrees;
    const op = (id) => r.ops.find((o) => o.id === id);
    const histRows = op('histogram').detail.rows, histAdds = op('histogram').other, evals = op('split-find').detail.evals;
    const perTree = op('grad-hess').other + histAdds + op('split-find').other + op('update').other;
    const binning = op('binning').other;
    const comparisons = K * c.pathDepth;
    const nodes = K * c.nodesPerTree, leaves = K * c.leavesPerTree;
    const bytes = (n, l) => A.tree_bytes({ format: c.format, nodes: n, leaves: l, K, depth: c.depth, F: c.F }).bytes;
    const meas = c.measured || null;
    return { K, histRows, histAdds, evals, perTree, binning, comparisons, nodes, leaves, bytes, meas };
  }

  function gbQuantities(c, r) {
    const k = gbCost(c, r);
    const q = {
      nTrees: c.nTrees, depth: c.depth, leavesPerTree: c.leavesPerTree, nodesPerTree: c.nodesPerTree, paramsPerTree: c.paramsPerTree, internalPerTree: c.internalPerTree,
      N: c.N, F: c.F, bins: c.bins, histBins: c.histBins, nodes: k.nodes, leaves: k.leaves, comparisonsPerPrediction: k.comparisons, modelBytes: k.bytes(k.nodes, k.leaves),
      histogramAddsPerTree: k.histAdds, splitEvalsPerTree: k.evals,
    };
    if (c.kind === 'leafwise') q.numLeaves = c.leavesEff;
    return q;
  }

  function gbMetrics(c, r, o) {
    const k = gbCost(c, r), K = c.nTrees;
    const cyc = CPU.cores * CPU.hz;
    const out = {
      nTrees: K, depth: c.depth, leavesPerTree: c.leavesPerTree, nodesPerTree: c.nodesPerTree, paramsPerTree: c.paramsPerTree, internalNodes: K * c.internalPerTree,
      nodes: k.nodes, leaves: k.leaves, params: r.totals.params,
      modelBytes: k.bytes(k.nodes, k.leaves), modelFormat: c.format,
      comparisonsPerPrediction: k.comparisons, pathDepth: c.pathDepth,
      predictionsPerSecCpu: cyc / k.comparisons, predictionUsOneCore: 1e6 * k.comparisons / CPU.hz,
      histogramRowsPerTree: k.histRows, histogramAddsPerTree: k.histAdds, histogramBytesPerNode: c.F * c.histBins * 2 * 8,
      splitEvalsPerTree: k.evals, trainOpsPerTree: k.perTree, binningOps: k.binning, trainOps: K * k.perTree + k.binning,
      trainSecCpu: (K * k.perTree + k.binning) / cyc, histogramShareTrain: K * k.histAdds / (K * k.perTree + k.binning),
      binnedDataBytes: c.N * c.F * c.binBytes, rawDataBytes: c.N * c.F * 4,
      cpuCores: CPU.cores, cpuHz: CPU.hz, hardwareSource: CPU.source, estimate: true,
      // actMem / paramMem genéricos (tensores × repeat, bf16) no aplican a árboles: memoria de entrenamiento ≈ datos discretizados +
      // g, h y F en fp32 (3·4·N) + un histograma por nodo de un nivel (depthwise: 2^(d−1) nodos; leaf-wise: L hojas); paramMem = el modelo.
      actMem: c.N * c.F * c.binBytes + 12 * c.N + (c.kind === 'leafwise' ? c.leavesPerTree : Math.pow(2, Math.max(0, c.depth - 1))) * c.F * c.histBins * 16,
      paramMem: k.bytes(k.nodes, k.leaves),
      units: GB_UNITS,
    };
    if (c.lib === 'xgboost') out.modelBytesJson = A.tree_bytes({ format: 'xgb-json', nodes: k.nodes, K, F: c.F }).bytes;
    if (c.kind === 'leafwise') { out.comparisonsMax = K * (c.leavesPerTree - 1); out.numLeaves = c.leavesEff; }
    // Lo medido en el modelo real (crosscheck, N = measured.N; con los mismos K y d de la config): solo sin knobs de forma del árbol.
    const shapeKnobs = ['nTrees', 'depth', 'leaves'].some((x) => r.overrides && r.overrides[x] !== undefined);
    if (k.meas && !shapeKnobs) {
      out.measuredN = k.meas.N; out.measuredNodes = k.meas.nodes; out.measuredLeaves = k.meas.leaves; out.measuredFullShare = k.meas.nodes / k.nodes;
      out.modelBytesMeasured = k.bytes(k.meas.nodes, k.meas.leaves);
      if (k.meas.avgPath) out.comparisonsMeasured = Math.round(K * k.meas.avgPath);
      // El mismo modelo con un objetivo no lineal (crosscheck): el camino promedio queda POR DEBAJO del balanceado.
      if (k.meas.avgPathNonlinear) out.comparisonsMeasuredNonlinear = Math.round(K * k.meas.avgPathNonlinear);
    }
    const arch = {};
    Object.keys(r.overrides || {}).forEach((x) => { if (x in A.model('gbdt').knobs) arch[x] = r.overrides[x]; });
    const row = (ov) => { const rr = A.run(r.id, Object.assign({}, arch, ov)), kk = gbCost(rr.config, rr); return { nodes: kk.nodes, modelBytes: kk.bytes(kk.nodes, kk.leaves), comparisonsPerPrediction: kk.comparisons, trainOps: rr.config.nTrees * kk.perTree + kk.binning }; };
    out.treesScaling = [100, 500, 1000, 2000].map((n) => Object.assign({ nTrees: n }, row({ nTrees: n })));
    if (c.kind !== 'leafwise') out.depthScaling = [3, 4, 6, 8, 10].map((d) => Object.assign({ depth: d }, row({ depth: d })));
    else out.leavesScaling = [15, 31, 63, 127, 255].map((l) => Object.assign({ leaves: l }, row({ leaves: l })));
    out.nScaling = [10000, 100000, 1000000, 10000000, 100000000].map((n) => Object.assign({ N: n }, row({ N: n })));
    return out;
  }
  const GB_UNITS = {
    nTrees: 'count', depth: 'count', leavesPerTree: 'count', nodesPerTree: 'count', paramsPerTree: 'count', internalNodes: 'count', nodes: 'count', leaves: 'count', params: 'params',
    modelBytes: 'bytes', modelBytesJson: 'bytes', modelBytesMeasured: 'bytes', comparisonsPerPrediction: 'count', comparisonsMax: 'count', comparisonsMeasured: 'count', comparisonsMeasuredNonlinear: 'count', pathDepth: 'count',
    predictionsPerSecCpu: 'count', predictionUsOneCore: 'ratio', histogramRowsPerTree: 'count', histogramAddsPerTree: 'count', histogramBytesPerNode: 'bytes', splitEvalsPerTree: 'count',
    trainOpsPerTree: 'count', binningOps: 'count', trainOps: 'count', trainSecCpu: 'ratio', histogramShareTrain: 'pct', binnedDataBytes: 'bytes', rawDataBytes: 'bytes', actMem: 'bytes', paramMem: 'bytes',
    cpuCores: 'count', cpuHz: 'count', measuredN: 'count', measuredNodes: 'count', measuredLeaves: 'count', measuredFullShare: 'pct', numLeaves: 'count',
  };

  A.defineModel({
    id: 'gbdt',
    label: 'Gradient boosting de árboles (XGBoost, LightGBM, CatBoost)',
    paper: { title: 'XGBoost: A Scalable Tree Boosting System', authors: 'Chen y Guestrin', venue: 'KDD 2016', year: 2016, arxiv: '1603.02754',
      note: 'Friedman, Greedy Function Approximation: A Gradient Boosting Machine, Annals of Statistics 29(5), 2001. LightGBM: Ke et al., NeurIPS 2017. CatBoost: Prokhorenkova et al., NeurIPS 2018, arXiv:1706.09516. Por qué los árboles siguen ganando en tabulares: Grinsztajn et al., NeurIPS 2022 Datasets & Benchmarks, arXiv:2207.08815.' },
    configs: GB_CONFIGS,
    knobs: { nTrees: [100, 500, 1000, 2000], depth: [3, 4, 6, 8, 10], leaves: [15, 31, 63, 127, 255], F: [10, 100, 1000], N: [10000, 100000, 1000000, 10000000, 100000000], bins: [16, 64, 256] },
    zeroKnobs: ['depth'],
    hardware: Object.assign({}, CPU),
    applyKnobs: gbApplyKnobs,
    resolve: gbResolve,
    build: gbBuild,
    quantities: gbQuantities,
    metrics: gbMetrics,
  });

  A.trees = { cpu: Object.assign({}, CPU), formats: ['xgb-ubj', 'xgb-json', 'lgb-text', 'cb-cbm'] };
})(typeof window !== 'undefined' ? window : globalThis);
