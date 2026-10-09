/* =============================================================================
   Atlas de Arquitecturas — js/content/gbdt.js
   Página de modelo: gradient boosted decision trees (GBDT) — XGBoost, LightGBM, CatBoost. Canónica xgboost-500-d6
   (500 árboles, max_depth 6, 256 bins, η = 0.1, carga de referencia N = 1M filas × F = 100 features). Plantilla fija de 11
   secciones (SPEC §5.3, §25.3). Un GBDT no es una red: no hay tensores que fluyan por capas ni MACs; "arquitectura" = el
   ensamble de árboles y el bucle de boosting, "parámetros" = umbrales + valores de hoja, "costo" = comparaciones por
   predicción, bytes del modelo y operaciones de histograma por árbol.
   Tesis de la fase (SPEC §25): la recomendación es un embudo y en datos tabulares los árboles siguen ganando.
   Papers: Friedman, Greedy function approximation: a gradient boosting machine, Annals of Statistics 29(5), 2001;
   Chen y Guestrin, XGBoost, KDD 2016 (arXiv:1603.02754); Ke et al., LightGBM, NIPS 2017; Prokhorenkova et al., CatBoost,
   NeurIPS 2018 (arXiv:1706.09516); Grinsztajn, Oyallon y Varoquaux, NeurIPS 2022 Datasets & Benchmarks (arXiv:2207.08815);
   Burges, From RankNet to LambdaRank to LambdaMART, MSR-TR-2010-82; Lundberg, Erion y Lee, TreeSHAP (arXiv:1802.03888).
   Regla: ningún número del ensamble (nodos, hojas, bytes, comparaciones, operaciones de histograma) se escribe a mano: sale
   del calculador (js/arch/trees.js, modelo gbdt; bloques op/trace/params/scaling/compare y cantidades {{config.ruta}},
   SPEC §6.6). Los defaults de las bibliotecas se leyeron de las bibliotecas instaladas (xgboost 3.4.1: save_config;
   lightgbm 4.7.0: model_to_string; catboost 1.2.10: get_all_params). Los ejercicios a mano y el código se verificaron
   contra xgboost 3.4.1 (scratchpad build13/gbdt/ex: split_gain.py, logistic_mcw.py, gbdt_numpy.py, hist_split.py).
   Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/trees.js, SPEC §25.3).
  const C = 'xgboost-500-d6';          // canónica: depth-wise, 500 árboles de profundidad 6, 256 bins
  const LG = 'lightgbm-500-l31';       // leaf-wise, num_leaves 31 (default de LightGBM)
  const X8 = 'xgboost-2000-d8';        // más árboles y más profundos
  const CB = 'catboost-oblivious-d6';  // árboles simétricos (oblivious) de profundidad 6

  // Claves de metrics() del calculador. Un solo lugar para adaptarlas.
  const MK = {
    nodes: 'nodes', leaves: 'leaves', internal: 'internalNodes', npt: 'nodesPerTree', lpt: 'leavesPerTree',
    bytes: 'modelBytes', cmp: 'comparisonsPerPrediction', pps: 'predictionsPerSecCpu',
    hist: 'histogramAddsPerTree', split: 'splitEvalsPerTree', trainTree: 'trainOpsPerTree', train: 'trainOps',
  };
  // Ids de tensores del calculador (js/arch/trees.js, modelo gbdt; arch-ids.md).
  const T = { X: 'X', Xb: 'Xb', y: 'y', Fp: 'F-prev', g: 'g', h: 'h', hist: 'hist', split: 'split', tree: 'tree',
    Fn: 'F-new', x: 'x', leaf: 'leaf-ids', yhat: 'y-hat' };
  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const cf = (k, cfg) => qn('cfg.' + k, cfg);

  const XGB = 'Chen y Guestrin, <i>XGBoost: A Scalable Tree Boosting System</i>, KDD 2016, arXiv:1603.02754';
  const LGBM = 'Ke et al., <i>LightGBM: A Highly Efficient Gradient Boosting Decision Tree</i>, NIPS 2017';
  const CATB = 'Prokhorenkova et al., <i>CatBoost: unbiased boosting with categorical features</i>, NeurIPS 2018, arXiv:1706.09516';
  const FRIED = 'Friedman, <i>Greedy function approximation: a gradient boosting machine</i>, Annals of Statistics 29(5):1189–1232, 2001';
  const FRIED02 = 'Friedman, <i>Stochastic gradient boosting</i>, Computational Statistics &amp; Data Analysis 38(4), 2002';
  const FHT = 'Friedman, Hastie y Tibshirani, <i>Additive logistic regression: a statistical view of boosting</i>, Annals of Statistics 28(2), 2000';
  const GRIN = 'Grinsztajn, Oyallon y Varoquaux, <i>Why do tree-based models still outperform deep learning on typical tabular data?</i>, NeurIPS 2022 Datasets and Benchmarks, arXiv:2207.08815';
  const BURGES = 'Burges, <i>From RankNet to LambdaRank to LambdaMART: An Overview</i>, Microsoft Research MSR-TR-2010-82, 2010';
  const TSHAP = 'Lundberg, Erion y Lee, <i>Consistent Individualized Feature Attribution for Tree Ensembles</i>, arXiv:1802.03888, 2018';
  const SHAP = 'Lundberg y Lee, <i>A Unified Approach to Interpreting Model Predictions</i>, NeurIPS 2017, arXiv:1705.07874';
  const MCEL = 'McElfresh et al., <i>When Do Neural Nets Outperform Boosted Trees on Tabular Data?</i>, NeurIPS 2023 Datasets and Benchmarks, arXiv:2305.02997';
  const FTT = 'Gorishniy et al., <i>Revisiting Deep Learning Models for Tabular Data</i> (FT-Transformer), NeurIPS 2021, arXiv:2106.11959';
  const TABPFN = 'Hollmann et al., <i>TabPFN: A Transformer That Solves Small Tabular Classification Problems in a Second</i>, arXiv:2207.01848 (ICLR 2023); v2: <i>Accurate predictions on small data with a tabular foundation model</i>, Nature 637, 2025';
  const FBADS = 'He et al., <i>Practical Lessons from Predicting Clicks on Ads at Facebook</i>, ADKDD 2014';
  const DART = 'Rashmi y Gilad-Bachrach, <i>DART: Dropouts meet Multiple Additive Regression Trees</i>, AISTATS 2015, arXiv:1505.01866';
  const NGB = 'Duan et al., <i>NGBoost: Natural Gradient Boosting for Probabilistic Prediction</i>, ICML 2020, arXiv:1910.03225';
  const HB = 'Nakandala et al., <i>A Tensor Compiler for Unified Machine Learning Prediction Serving</i> (Hummingbird), OSDI 2020';

  ATLAS.register({
    id: 'gbdt',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> dada una fila de una tabla (F = ${cf('F')} columnas: monto, hora, país, antigüedad de la cuenta, conteos de los últimos 7 días…), devolver un número (una probabilidad de fraude, un precio, el score de un documento para un ranking) como la <b>suma</b> de las salidas de ${cf('nTrees')} árboles de decisión chicos, cada uno entrenado para corregir el error que dejaron los anteriores. Es el modelo por defecto para datos tabulares en fraude, riesgo de crédito, pricing, churn, demanda y ranking con features hechas a mano; y el baseline que cualquier red tabular tiene que vencer.` },
          { t: 'p', html: R`Los números de la canónica (XGBoost, ${cf('nTrees')} árboles de profundidad ${cf('depth')}): cada árbol tiene a lo sumo 2<sup>${cf('depth')}</sup> hojas, el ensamble guarda ${qn('params.total')} números aprendidos (umbrales y valores de hoja) y una predicción hace ${met('cmp')} comparaciones (${cf('nTrees')} × ${cf('depth')}): cero multiplicaciones de matrices. Entrenar es otra historia: cada árbol arma histogramas de gradientes sobre las N = ${cf('N')} filas y las ${cf('F')} features, ${met('hist')} sumas por árbol en el calculador.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿GBDT?', 'Por qué'], rows: [
            ['Tabla con features heterogéneas (montos, conteos, categorías chicas), miles a millones de filas', '<b>Sí, empieza aquí</b>', R`Es lo que gana en los benchmarks tabulares de tamaño medio (${GRIN}) y entrena en minutos en CPU sin normalizar nada.`],
            ['Fraude, riesgo, churn, scoring con latencia de milisegundos en CPU', 'Sí', R`Inferencia de miles de comparaciones, sin GPU; explicable con SHAP; monotonicidad imponible (<code>monotone_constraints</code>) para requisitos regulatorios.`],
            ['Ranking con cientos de features densas (learning to rank)', 'Sí (LambdaMART)', R`El objetivo por defecto de ranking de XGBoost (<code>rank:ndcg</code>) es LambdaMART; un ensamble de LambdaMART ganó el Track 1 del Yahoo! Learning to Rank Challenge 2010 (${BURGES}).`],
            ['Miles de millones de ejemplos con IDs de altísima cardinalidad (usuario, ítem, anuncio)', 'No como modelo principal', R`Un árbol corta por umbrales: no aprende un embedding por id. Ahí van las tablas de embeddings de <a href="#dlrm">DLRM</a>; el GBDT solo ve los ids convertidos a conteos o tasas.`],
            ['Imágenes, audio, texto libre', 'No', 'Las features crudas no tienen significado individual (un píxel); las redes aprenden la representación. Un GBDT puede ir encima de embeddings o de scores de una red.'],
            ['Pocas filas (≲ 10,000) y quieres lo mejor sin tunear', 'Compáralo con TabPFN', R`Un modelo fundacional tabular reporta ganarle a los GBDT tuneados en ese régimen (${TABPFN}); verifícalo en tus datos.`],
            ['Hay que extrapolar fuera del rango visto (tendencias, precios que suben)', 'Con cuidado', 'Un árbol devuelve una constante fuera del rango de entrenamiento: la predicción se aplana. Modela la tendencia aparte o predice diferencias / ratios.'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Gradient boosting builds an additive model of small regression trees. Each new tree is fitted to the gradient of the loss with respect to the current predictions, so it is gradient descent in function space, and XGBoost uses a second-order Taylor expansion so that each leaf gets a closed-form Newton weight minus G over H plus lambda, and each split is scored by the reduction of that objective. Histograms over a couple of hundred bins make split finding cheap, regularization comes from depth, learning rate, subsampling, minimum child weight and early stopping, and at inference it is just a few thousand comparisons. On medium-sized tabular data it still beats deep models, so it is my first baseline."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como ResNet, pero el residuo es literal y se aprende un bloque a la vez.</b> Un bloque de ResNet calcula x + F(x): aprende lo que le falta a su entrada. Boosting hace lo mismo con las <b>predicciones</b>: F<sub>t</sub>(x) = F<sub>t−1</sub>(x) + η·f<sub>t</sub>(x), donde el árbol f<sub>t</sub> se entrena para predecir lo que todavía falta (con pérdida cuadrática, literalmente el residuo y − F<sub>t−1</sub>). La diferencia: en ResNet todos los bloques se entrenan juntos con backprop; en boosting se entrena el árbol t, <b>se congela</b> y recién entonces se entrena el t + 1. Y los árboles no son diferenciables: cada uno se construye con una búsqueda voraz de cortes, no con SGD.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de boosting', head: ['Concepto', 'En redes / en este atlas', 'En GBDT', '¿Nuevo?'], rows: [
            ['Aprender un residuo', 'Skip connection de ResNet: x + F(x)', R`F<sub>t</sub> = F<sub>t−1</sub> + η·f<sub>t</sub>: cada árbol corrige lo que dejaron los anteriores`, 'Equivale'],
            ['Paso de gradiente con learning rate', 'θ ← θ − η∇<sub>θ</sub>L', R`Descenso de gradiente sobre las predicciones: cada árbol aproxima −∂L/∂F; η (shrinkage) achica el paso`, 'Equivale'],
            ['Weight decay', 'λ‖θ‖² en la pérdida', R`λ‖w‖² sobre los valores de hoja y γ por cada hoja (Ω de XGBoost)`, 'Igual'],
            ['Dropout / data augmentation', 'Ruido para no memorizar', R`subsample (filas por árbol) y colsample (columnas por árbol, nivel o nodo)`, 'Equivale'],
            ['Early stopping', 'Parar cuando sube la pérdida de validación', 'Igual, contando árboles: <code>early_stopping_rounds</code>', 'Igual'],
            ['Paso de Newton (segundo orden)', 'Casi nunca en redes (Adam aproxima la diagonal)', R`Cada hoja recibe su peso óptimo en forma cerrada: w* = −G/(H + λ), con G y H sumas de gradientes y hessianos`, '<b>Nuevo</b>'],
            ['Búsqueda voraz de cortes con histogramas', '—', 'Para cada feature, sumar g y h por bin y barrer los umbrales: la "capa" se elige, no se optimiza', '<b>Nuevo</b>'],
          ] },

          { t: 'h3', text: 'Descenso de gradiente en el espacio de funciones' },
          { t: 'p', html: R`Primero un ejemplo. Seis filas con una feature x = 1…6 y objetivos y = 1.0, 1.2, 0.8, 3.0, 3.4, 2.6. La predicción inicial es la media: F<sub>0</sub> = 2.0 para todas. Con pérdida cuadrática ½(F − y)², el gradiente respecto de la predicción de cada fila es g<sub>i</sub> = F<sub>0</sub> − y<sub>i</sub> = +1.0, +0.8, +1.2, −1.0, −1.4, −0.6. Si pudieras mover cada predicción por separado, el descenso de gradiente diría "baja las tres primeras, sube las tres últimas". Pero un vector de seis números no sirve para una fila nueva. Entonces <b>ajustas un árbol a −g</b>: el árbol aprende la regla "si x &lt; 3.5, baja; si no, sube", que sí generaliza. Ese árbol es el paso de gradiente.` },
          { t: 'math', display: true, tex: R`\begin{aligned}&\text{parámetros: }\ \theta \leftarrow \theta - \eta\,\nabla_\theta L &&\text{(una red)}\\ &\text{funciones: }\ F_t(x) = F_{t-1}(x) + \eta\, f_t(x),\quad f_t \approx -\frac{\partial L}{\partial F}\Big|_{F_{t-1}} &&\text{(boosting)}\\ &L(F) = \sum_{i=1}^{N} l\big(y_i, F(x_i)\big),\qquad g_i = \frac{\partial\, l(y_i, F)}{\partial F}\Big|_{F = F_{t-1}(x_i)}\end{aligned}`, caption: 'Friedman (2001): boosting como descenso por pasos (steepest descent) en el espacio de funciones. La "dirección" son los N gradientes de la pérdida respecto de las predicciones en el set de entrenamiento; el árbol es la mejor aproximación de esa dirección que se puede evaluar en cualquier x. Con pérdida cuadrática, −g es el residuo y − F.' },
          { t: 'p', html: R`Eso es todo boosting. Lo que cambia entre GBM (Friedman), XGBoost, LightGBM y CatBoost es <b>cómo</b> se construye cada árbol (primer o segundo orden, cortes exactos o por histograma, crecimiento por nivel o por hoja, árboles simétricos) y qué se hace contra el sobreajuste. ${FRIED}.` },
          { t: 'callout', kind: 'trap', title: '"Más árboles nunca sobreajustan, como en Random Forest"', html: R`<p>En Random Forest los árboles son independientes y promediar más solo reduce varianza. En boosting cada árbol se ajusta a lo que los anteriores no explicaron, incluido el ruido: con suficientes árboles el error de entrenamiento va a cero y el de validación sube. Por eso boosting se entrena con early stopping y η chico, y Random Forest no lo necesita.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>La otra mitad del embudo de recomendación: <a href="#two-tower">two-tower</a> trae cientos de candidatos y <a href="#dlrm">DLRM</a> los ordena con tablas de embeddings. Un GBDT con LambdaMART es la alternativa clásica para ese ranking cuando las features son densas y hechas a mano; la comparación está en <a href="#gbdt.fallas">cómo falla y trade-offs</a> y en las preguntas de entrevista.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`El bucle de entrenamiento y la predicción. <b>Una vez</b>: cuantizar cada feature en ${cf('bins')} bins. <b>Por árbol</b> (${cf('nTrees')} veces): calcular g y h de cada fila con la predicción actual, armar histogramas de g y h por feature y por bin, elegir el mejor corte de cada nodo con la fórmula de ganancia, crecer el árbol hasta la profundidad ${cf('depth')} y sumar su salida (× η) a la predicción. <b>Para predecir</b>: recorrer los ${cf('nTrees')} árboles (una comparación por nivel) y sumar las hojas. No fluyen tensores entre capas: las flechas son datos del bucle (gradientes, histogramas, el árbol nuevo).` },
          { t: 'archdiagram', diagram: 'gbdt-overview', walk: 'forward', wide: true, caption: R`Boosting con histogramas (XGBoost hist / LightGBM), canónica: ${cf('nTrees')} árboles de profundidad ${cf('depth')}, ${cf('bins')} bins, N = ${cf('N')} × F = ${cf('F')}. Conteos del calculador.` },
          { t: 'p', html: R`<b>Un árbol por dentro.</b> Cada nodo interno pregunta "¿x<sub>f</sub> &lt; umbral?" y manda la fila a la izquierda o a la derecha; si el valor falta, la manda por la <b>dirección por defecto</b> que aprendió ese nodo. Cada hoja guarda un número w<sub>j</sub>. La predicción de un árbol es el w de la hoja donde cae la fila; la del ensamble, la suma de todas.` },
          { t: 'archdiagram', diagram: 'tree', caption: 'Un árbol de profundidad limitada y el camino de una fila hasta su hoja (ilustrativo: los cortes son de ejemplo).' },
          { t: 'p', html: R`<b>Elegir un corte con histogramas.</b> Mueve λ y γ, cambia el número de bins y la pérdida (cuadrática o logística): el histograma suma g y h por bin, el barrido acumula G<sub>L</sub>, H<sub>L</sub> de izquierda a derecha y cada umbral recibe su ganancia. Con pocos bins el mejor umbral se mueve un poco; con λ grande las hojas chicas pesan menos; con γ grande el nodo deja de partirse.` },
          { t: 'viz', kind: 'histogram-split', params: { config: C, bins: 16, loss: 'sq', lambda: 1, gamma: 0 }, caption: 'Datos sintéticos (rotulados): 240 filas de una feature. La ganancia se muestra con la fórmula del paper (con el ½) y el loss_chg del código de XGBoost (sin el ½).' },
          { t: 'p', html: R`<b>Boosting en una dimensión.</b> Cada árbol ajusta el residuo de los anteriores. Baja η: hace falta más árboles para llegar al mismo error, pero el error de prueba mínimo suele ser menor. Sube los árboles con η = 1: el error de entrenamiento sigue bajando y el de prueba sube (sobreajuste).` },
          { t: 'viz', kind: 'boosting-residuals', params: { config: C, m: 10, eta: 0.3, depth: 2 }, caption: 'Regresión 1-D sintética (rotulada): los errores son de este juego, no de un benchmark.' },
          { t: 'archdiagram', diagram: 'histogram-split', caption: 'El paso de histograma y corte de un nodo: bins de una feature, sumas G y H por bin, el barrido y la fórmula de ganancia.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación, con las seis filas de antes (F<sub>0</sub> = 2.0, g = +1.0, +0.8, +1.2, −1.0, −1.4, −0.6, y h = 1 en todas porque la pérdida es cuadrática). Probamos el corte "x &lt; 3.5": a la izquierda quedan tres filas con G<sub>L</sub> = 3.0, H<sub>L</sub> = 3; a la derecha G<sub>R</sub> = −3.0, H<sub>R</sub> = 3. Con λ = 1, la hoja izquierda vale w = −3.0/(3 + 1) = −0.75 y la derecha +0.75: un promedio de los residuos "encogido" hacia 0 por λ. Ese corte reduce el objetivo en ½(9/4 + 9/4 − 0/7) = 2.25, más que cualquier otro umbral. Con η = 0.3 las predicciones pasan a 2.0 − 0.225 = 1.775 y 2.0 + 0.225 = 2.225. Eso es un árbol de boosting entero; el resto es hacerlo rápido con N = ${cf('N')} filas.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            ['N, F', 'filas de entrenamiento y features', R`${cf('N')}, ${cf('F')}`],
            ['K (nTrees)', 'árboles del ensamble', cf('nTrees')],
            ['d (depth), T', 'profundidad máxima; hojas de un árbol (T ≤ 2<sup>d</sup>)', R`${cf('depth')}; ≤ 2<sup>${cf('depth')}</sup>`],
            ['B (bins)', 'bins por feature del método por histograma (max_bin)', cf('bins')],
            ['g<sub>i</sub>, h<sub>i</sub>', 'primera y segunda derivada de la pérdida respecto de la predicción F(x<sub>i</sub>)', '—'],
            ['G<sub>j</sub>, H<sub>j</sub>', 'sumas de g y h de las filas que caen en la hoja (o el lado) j', '—'],
            ['λ, γ', 'regularización L2 de los valores de hoja; costo por hoja (mínima ganancia para partir)', 'XGBoost: λ = 1, γ = 0'],
            ['η', 'learning rate (shrinkage)', R`0.1 en la canónica (default de XGBoost: 0.3)`],
          ] },

          { t: 'h3', text: '1. Cuantizar las features (una vez)' },
          { t: 'op', block: 'binning', model: 'gbdt', title: 'Bordes por cuantiles y bin de cada valor',
            tex: R`b_{if} = \#\{\,k : c_{fk} \le x_{if}\,\},\qquad c_{f1} < \dots < c_{f,B-1}\ \text{(cuantiles de la feature } f\text{)}`,
            in: [T.X], out: [T.Xb],
            what: R`Para cada feature se calculan ≤ B − 1 bordes en los cuantiles (XGBoost: un sketch de cuantiles <b>ponderado por h</b>, §3.3 del paper; LightGBM y CatBoost: sus propios bordes) y cada valor se reemplaza por el índice de su bin: con B ≤ 256, un byte por celda. Se hace una sola vez antes del primer árbol. Defaults: XGBoost <code>max_bin</code> = 256, LightGBM <code>max_bin</code> = 255, CatBoost <code>border_count</code> = 254 en CPU.`,
            why: R`Con bins, buscar el mejor umbral cuesta O(B) por feature en vez de ordenar N valores, y la matriz cuantizada ocupa ×4 menos que en float32 (cabe mejor en caché). ¿Por qué ponderar por h? El objetivo de segundo orden es una regresión cuadrática ponderada con etiquetas −g/h y pesos h (§3.3 de ${XGB}): las filas con h grande pesan más y merecen bordes más finos.` },

          { t: 'h3', text: '2. Gradientes y hessianos con la predicción actual' },
          { t: 'op', block: 'gradients', model: 'gbdt', title: 'g y h de cada fila',
            tex: R`g_i = \frac{\partial\, l(y_i, F)}{\partial F}\Big|_{F_{t-1}(x_i)},\qquad h_i = \frac{\partial^2 l(y_i, F)}{\partial F^2}\Big|_{F_{t-1}(x_i)}`,
            in: [T.y, T.Fp], out: [T.g, T.h],
            what: R`Dos números por fila. Es la única parte que depende de la pérdida: el resto del algoritmo solo ve sumas de g y h. Por eso XGBoost acepta pérdidas a medida: le das una función que devuelve (g, h).`,
            why: R`Con g y h, el árbol puede aproximar la pérdida con una parábola por fila (Taylor de segundo orden) y resolver cada hoja en forma cerrada. GBM clásico usa solo g y ajusta el valor de cada hoja con una búsqueda en línea; el paso de Newton viene de LogitBoost (${FHT}).` },
          { t: 'table', caption: 'g y h de las pérdidas más usadas (F es el margen: la salida cruda del ensamble)', head: ['Pérdida', 'l(y, F)', 'g', 'h', 'Objetivo en XGBoost'], rows: [
            ['Cuadrática', '½(F − y)²', 'F − y', '1', '<code>reg:squarederror</code>'],
            ['Logística (y ∈ {0, 1})', R`−y log p − (1 − y) log(1 − p), p = σ(F)`, 'p − y', 'p(1 − p)', '<code>binary:logistic</code>'],
            ['Softmax (K clases)', R`−log p<sub>y</sub>`, R`p<sub>k</sub> − 1[k = y]`, R`p<sub>k</sub>(1 − p<sub>k</sub>) (diagonal)`, '<code>multi:softprob</code>: un árbol por clase y por ronda'],
            ['Poisson (conteos)', 'e<sup>F</sup> − yF', 'e<sup>F</sup> − y', 'e<sup>F</sup>', '<code>count:poisson</code>'],
            ['Absoluta / cuantil', '|F − y|', 'signo', '0 (no hay curvatura)', R`<code>reg:absoluteerror</code>, <code>reg:quantileerror</code>: las hojas se re-ajustan con un paso especial`],
          ] },
          { t: 'callout', kind: 'trap', title: '"min_child_weight es el número mínimo de filas por hoja"', html: R`<p>Es la suma mínima de <b>hessianos</b> (lo que el dump de XGBoost llama <code>cover</code>). Con pérdida cuadrática h = 1 y coincide con un conteo. Con logística h = p(1 − p): con p = 0.5 cada fila aporta 0.25 y una hoja necesita ≥ 4 filas para llegar a 1; con p = 0.99 cada fila aporta ≈ 0.0099 y hacen falta ≈ 102. En fraude, donde casi todas las predicciones son ≈ 0, el default de 1 ya es una restricción fuerte y las hojas de casos "seguros" no se pueden partir. LightGBM separa las dos cosas: <code>min_data_in_leaf</code> (20, conteo) y <code>min_sum_hessian_in_leaf</code> (10<sup>−3</sup>).</p>` },

          { t: 'h3', text: '3. El objetivo de segundo orden y el peso de cada hoja' },
          { t: 'math', display: true, tex: R`\begin{aligned}\mathcal{L}^{(t)} &= \sum_{i=1}^{N} l\big(y_i,\ F_{t-1}(x_i) + f_t(x_i)\big) + \Omega(f_t),\qquad \Omega(f) = \gamma T + \tfrac{1}{2}\lambda \sum_{j=1}^{T} w_j^2\\ &\approx \sum_{i=1}^{N}\Big[g_i f_t(x_i) + \tfrac{1}{2} h_i f_t(x_i)^2\Big] + \Omega(f_t) + \text{cte}\\ &= \sum_{j=1}^{T}\Big[G_j w_j + \tfrac{1}{2}(H_j + \lambda)\, w_j^2\Big] + \gamma T,\qquad G_j = \sum_{i\in I_j} g_i,\ \ H_j = \sum_{i \in I_j} h_i\end{aligned}`, caption: 'Ecuaciones 2–4 de Chen y Guestrin: Taylor de segundo orden alrededor de la predicción actual. Como el árbol devuelve el mismo w_j para todas las filas de la hoja j, la suma sobre filas se agrupa por hojas: cada hoja es una parábola independiente en w_j.' },
          { t: 'math', display: true, tex: R`w_j^{*} = -\frac{G_j}{H_j + \lambda},\qquad \mathcal{L}^{(t)}(q) = -\frac{1}{2}\sum_{j=1}^{T}\frac{G_j^2}{H_j+\lambda} + \gamma T`, caption: 'Ecuaciones 5 y 6: derivar la parábola de cada hoja e igualar a 0 da el paso de Newton regularizado; sustituirlo da el objetivo de la estructura q (cuánto baja la pérdida con ese árbol). Con pérdida cuadrática y λ = 0, w* es el promedio de los residuos de la hoja; λ lo encoge hacia 0 (más en hojas con pocas filas).' },
          { t: 'p', html: R`<b>Deriva tú:</b> para una hoja, \(G w + \tfrac{1}{2}(H + \lambda) w^2\) tiene derivada \(G + (H+\lambda) w = 0 \Rightarrow w^* = -G/(H+\lambda)\), y el valor en el mínimo es \(-\tfrac{1}{2} G^2/(H+\lambda)\). En el ejemplo: G = 3.0, H = 3, λ = 1 → w* = −0.75 y la hoja aporta −½·9/4 = −1.125 al objetivo.` },

          { t: 'h3', text: '4. Histogramas y el mejor corte' },
          { t: 'op', block: 'histogram', model: 'gbdt', title: 'Histograma de G y H por feature y por bin (un nodo)',
            tex: R`\mathrm{Hist}_{f,b} = \Big(\sum_{i \in I:\ b_{if} = b} g_i,\ \ \sum_{i\in I:\ b_{if}=b} h_i\Big),\qquad f = 1..F,\ b = 1..B`,
            in: [T.Xb, T.g, T.h], out: [T.hist],
            what: R`Una pasada por las filas del nodo: para cada fila y cada feature, sumar g y h en la celda de su bin. Cuesta 2 sumas (G y H) por fila del nodo y por feature, y deja F × B × 2 números. Con crecimiento por niveles, cada nivel recorre las N filas una vez (cada fila está en un solo nodo): sin trucos, ≈ d·N filas por árbol; es lo que domina el entrenamiento (§2.1 de ${LGBM}). El calculador cuenta la raíz entera y la mitad de las filas en cada nivel siguiente (la resta, abajo): N·(1 + (d − 1)/2) filas × 2F sumas = ${met('hist')} sumas por árbol en la canónica.`,
            why: R`El <b>truco de la resta</b>: el histograma de un hijo es el del padre menos el de su hermano, así que solo se construye el del hijo con menos filas y el otro sale gratis (LightGBM, y el método hist de XGBoost). Eso corta el trabajo por nivel a menos de la mitad.` },
          { t: 'op', block: 'best-split', model: 'gbdt', title: 'Barrido de umbrales y ganancia',
            tex: R`\text{Gain} = \frac{1}{2}\left[\frac{G_L^2}{H_L+\lambda} + \frac{G_R^2}{H_R+\lambda} - \frac{(G_L+G_R)^2}{H_L+H_R+\lambda}\right] - \gamma`,
            in: [T.hist], out: [T.split],
            what: R`Para cada feature, sumas acumuladas de izquierda a derecha sobre los B bins: G<sub>L</sub>, H<sub>L</sub>, y G<sub>R</sub> = G − G<sub>L</sub>, H<sub>R</sub> = H − H<sub>L</sub>. Cada umbral recibe su ganancia (ecuación 7 del paper): lo que bajaría el objetivo si el nodo se parte ahí. Se queda el mejor (feature, umbral) de todas las features; si H<sub>L</sub> o H<sub>R</sub> &lt; min_child_weight el umbral no vale; si la mejor ganancia no supera 0 (o γ), el nodo queda hoja. Cuesta O(F × B) por nodo: con B ≪ N es barato al lado del histograma.`,
            why: R`La ganancia es "objetivo del padre − objetivo de los dos hijos" con la fórmula de la ecuación 6. Que sea una diferencia de G²/(H + λ) es lo que permite evaluar cientos de umbrales con dos sumas acumuladas. γ es el precio de agregar una hoja: un corte que no paga γ se poda.` },
          { t: 'callout', kind: 'trap', title: 'El ½ y γ en la biblioteca', html: R`<p>El <code>gain</code> que imprime XGBoost (en <code>get_dump(with_stats=True)</code> y en <code>importance_type='gain'</code>) es el corchete <b>sin el ½</b>: \(G_L^2/(H_L+\lambda) + G_R^2/(H_R+\lambda) - G^2/(H+\lambda)\), y el nodo se poda si ese número es menor que <code>gamma</code>. O sea, el γ de la biblioteca se compara con el doble de la ganancia de la ecuación 7. Verificado con xgboost 3.4.1 en el ejemplo de seis filas: el dump dice <code>gain=4.5</code> (la ecuación 7 da 2.25); con <code>gamma = 4.4</code> el corte sobrevive y con <code>gamma = 4.6</code> el árbol queda en una hoja. El propio Algoritmo 1 del paper ya escribe el score sin el ½.</p>` },

          { t: 'h3', text: '5. Cómo crece el árbol: por niveles, por hojas o simétrico' },
          { t: 'table', caption: 'Tres políticas de crecimiento', head: ['Política', 'Quién', 'Regla', 'Consecuencia'], rows: [
            ['Por niveles (depth-wise)', R`XGBoost (<code>grow_policy='depthwise'</code>, default), sklearn`, 'Partir todos los nodos de un nivel antes de bajar; parar en max_depth', R`Árboles balanceados, ≤ 2<sup>d</sup> hojas; parte nodos con poca ganancia solo porque están en el nivel`],
            ['Por hojas (leaf-wise, best-first)', R`LightGBM (default), XGBoost con <code>grow_policy='lossguide'</code>`, 'Partir siempre la hoja con mayor ganancia, hasta num_leaves hojas', R`Menos pérdida con el mismo número de hojas, pero ramas profundas y sobreajuste con pocos datos: se controla con <code>num_leaves</code> (31), <code>min_data_in_leaf</code> (20) y, si hace falta, <code>max_depth</code> (−1 = sin límite)`],
            ['Simétrico (oblivious)', R`CatBoost (<code>grow_policy='SymmetricTree'</code>, default)`, 'El mismo (feature, umbral) en todos los nodos de un nivel', R`Un árbol de profundidad d son d preguntas: las d respuestas forman un índice de d bits a una tabla de 2<sup>d</sup> hojas. Más regularizado y muy rápido de evaluar; cada árbol es más débil`],
          ] },
          { t: 'callout', kind: 'trap', title: '"num_leaves = 2^max_depth da el mismo árbol"', html: R`<p>Da el mismo <b>número</b> de hojas, no el mismo árbol: un árbol leaf-wise con 64 hojas puede tener una rama de profundidad 20 y el resto chato. La guía de tuning de LightGBM pide <code>num_leaves</code> bastante menor que 2<sup>max_depth</sup> y lo marca como el parámetro principal contra el sobreajuste. En el calculador, la config de LightGBM tiene ${cf('leaves', LG)} hojas por árbol y cuenta ${met('cmp', LG)} comparaciones por predicción con el camino de un árbol balanceado (⌈log₂ 31⌉ = 5 por árbol, una cota inferior); en el modelo real del crosscheck el camino promedio da ${qn('metrics.comparisonsMeasured', LG)}, y el peor caso es ${qn('metrics.comparisonsMax', LG)}.</p>` },

          { t: 'h3', text: '6. Valores faltantes y categóricas' },
          { t: 'p', html: R`<b>Faltantes.</b> XGBoost aprende en cada nodo una <b>dirección por defecto</b>: al buscar el corte, prueba mandar todas las filas sin valor a la izquierda y después a la derecha, y se queda con la que da más ganancia (Algoritmo 3, sparsity-aware split finding). Solo recorre las entradas presentes: en el dataset Allstate (one-hot, muy disperso) eso fue más de 50 veces más rápido que el algoritmo ingenuo (Fig. 5 de ${XGB}). LightGBM hace lo mismo (<code>use_missing</code> = true); CatBoost, por defecto, trata el faltante como menor que cualquier valor (<code>nan_mode='Min'</code>).` },
          { t: 'callout', kind: 'trap', title: '"El modelo maneja los NaN solo"', html: R`<p>Solo si vio NaN al entrenar. Si una feature nunca faltó en entrenamiento, la dirección por defecto de sus nodos no aprendió nada: en el ejemplo de seis filas, xgboost 3.4.1 manda el faltante a la izquierda con <code>tree_method='exact'</code> y a la derecha con <code>'hist'</code>, sobre el mismo corte. Si en producción la feature empieza a faltar (un servicio caído), las filas se van por un lado arbitrario sin ningún error. Monitorea la tasa de faltantes por feature y, si puede faltar en producción, que falte también en entrenamiento.</p>` },
          { t: 'p', html: R`<b>Categóricas.</b> One-hot en un árbol es ineficiente: cada nodo solo puede separar una categoría del resto. Las tres bibliotecas tienen soporte nativo. <b>LightGBM</b> (<code>categorical_feature</code>): con ≤ <code>max_cat_to_onehot</code> = 4 categorías prueba una contra el resto; con más, ordena las categorías por G/H (suma de gradientes sobre suma de hessianos, regularizado con <code>cat_smooth</code> = 10) y busca el corte como si fueran numéricas. <b>XGBoost</b> (<code>enable_categorical=True</code> con hist): la misma idea, con <code>max_cat_to_onehot</code> = 4 y particiones de hasta <code>max_cat_threshold</code> = 64 categorías. <b>CatBoost</b> reemplaza cada categoría por un <b>target statistic</b> ordenado y combina categóricas (abajo).` },
          { t: 'math', display: true, tex: R`\hat{x}_k = \frac{\sum_{j:\ \sigma(j) < \sigma(k)} \mathbb{1}[x_j = x_k]\, y_j \;+\; a\,p}{\sum_{j:\ \sigma(j) < \sigma(k)} \mathbb{1}[x_j = x_k] \;+\; a}`, caption: 'Ordered target statistic de CatBoost (ec. 5 con D_k = {j : σ(j) &lt; σ(k)}, §3.2): el promedio del objetivo en la categoría usando solo las filas ANTERIORES en una permutación σ, suavizado hacia el prior p con peso a. Si se usaran todas las filas (incluida la propia), la feature filtra la etiqueta: con categorías únicas, un solo corte separa perfecto el train y en test predice el prior.' },
          { t: 'p', html: R`<b>Ordered boosting</b> (CatBoost) aplica la misma idea a los gradientes: el residuo de una fila se calcula con un modelo que no la vio, para que la distribución de los residuos en entrenamiento sea la de test (el paper llama <i>prediction shift</i> a esa diferencia). En catboost 1.2.10 el modo por defecto es <code>boosting_type='Plain'</code> (boosting estándar con target statistics ordenados); <code>'Ordered'</code> se pide explícitamente y es más caro. ${CATB}.` },

          { t: 'h3', text: '7. Sumar el árbol y predecir' },
          { t: 'op', block: 'update', model: 'gbdt', title: 'F_t = F_{t−1} + η·f_t',
            tex: R`F_t(x_i) = F_{t-1}(x_i) + \eta\, w_{q_t(x_i)},\qquad F_0 = \text{base\_score}`,
            in: [T.tree, T.Fp], out: [T.Fn],
            what: R`Cada fila suma η por el valor de su hoja en el árbol nuevo. Las hojas que guarda XGBoost ya vienen multiplicadas por η (en el ejemplo, ±0.225 = 0.3 × 0.75). F<sub>0</sub> es <code>base_score</code>: desde XGBoost 2.0 se estima de los datos (la media de y en regresión cuadrática).`,
            why: R`η &lt; 1 deja trabajo para los árboles siguientes: cada árbol corrige un poco y el ensamble promedia muchos cortes distintos. Menos η pide más árboles para el mismo error de entrenamiento; a cambio, el mínimo de validación suele ser mejor.` },
          { t: 'op', block: 'predict', model: 'gbdt', title: 'Recorrer K árboles y sumar las hojas',
            tex: R`\hat{y}(x) = \sigma\Big(F_0 + \sum_{k=1}^{K} w^{(k)}_{q_k(x)}\Big)\quad \text{(}\sigma\text{ solo si la pérdida es logística)}`,
            in: [T.x], out: [T.yhat],
            what: R`Para cada árbol, bajar desde la raíz comparando una feature contra un umbral por nivel hasta una hoja: ${cf('depth')} comparaciones por árbol en un árbol de profundidad ${cf('depth')}, ${met('cmp')} para el ensamble canónico. Después, sumar ${cf('nTrees')} números.`,
            why: R`No hay multiplicaciones de matrices: el costo son lecturas de memoria dependientes (el siguiente nodo depende de la comparación anterior) y saltos difíciles de predecir para la CPU. Los árboles simétricos de CatBoost evitan los saltos: d comparaciones independientes arman el índice de la hoja.` },
          { t: 'p', html: R`El recorrido completo del bucle con los números del calculador (una ronda de boosting y una predicción):` },
          { t: 'trace', model: 'gbdt' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Un GBDT no tiene matrices de pesos: sus "parámetros" son un umbral (y una feature) por cada nodo interno y un valor por cada hoja, más el base_score. En la canónica: ${met('nodes')} nodos, ${met('leaves')} hojas, ${qn('params.total')} números aprendidos. Es un modelo <b>chico</b>: ${met('bytes')} en el calculador, contra ${qn('params.total', 'dlrm-criteo-kaggle')} parámetros del DLRM de Criteo Kaggle (casi todos en tablas de embeddings, <a href="#dlrm">DLRM</a>).` },
          { t: 'params', model: 'gbdt', group: 'block' },
          { t: 'p', html: R`Y la tabla de MACs, que en un ensamble de árboles es casi vacía a propósito: no hay ni una multiplicación de matrices. Todo el trabajo (sumas de histograma, evaluaciones de umbral, comparaciones) va en "otros" y en las cuentas de abajo.` },
          { t: 'flops', model: 'gbdt' },

          { t: 'h3', text: 'Costo de predicción' },
          { t: 'calc', title: R`Una predicción del ensamble canónico (calculador; tiempos ≈ en CPU)`, rows: [
            { label: 'Comparaciones', expr: R`K · d = ${cf('nTrees')} × ${cf('depth')} (un nivel = una comparación)`, value: met('cmp') },
            { label: 'Hojas sumadas', expr: 'K (una por árbol)', value: cf('nTrees') },
            { label: 'Nodos del modelo', expr: R`K · (2<sup>d</sup> − 1) internos + K · 2<sup>d</sup> hojas si los árboles se llenan (cota)`, value: met('nodes'), note: R`el modelo real de XGBoost (crosscheck, N = ${qn('metrics.measuredN')}) tiene ${qn('metrics.measuredNodes')}: poda las ramas sin ganancia` },
            { label: 'Bytes del modelo', expr: 'nodos × bytes por nodo del formato (umbral, feature, hijos, dirección por defecto)', value: met('bytes') },
            { label: 'Una predicción en un núcleo', expr: 'K·d comparaciones a una por ciclo (2.4 GHz), sin esperas de memoria', value: est(qn('metrics.predictionUsOneCore') + ' µs'), note: 'cota optimista: cada salto puede esperar a la memoria' },
            { label: 'Predicciones por segundo en CPU', expr: 'la misma cota en los 96 núcleos de un AMD EPYC 9654, sin overhead de red ni de features', value: est(met('pps')) },
          ], result: R`Lo que cuesta es la <b>latencia de memoria</b>, no la aritmética: cada comparación lee un nodo que depende de la anterior. Si el modelo cabe en la caché del procesador (cientos de KB a pocos MB), la predicción de una fila tarda ${est('microsegundos a decenas de microsegundos')}; con miles de árboles profundos que no caben, cada salto puede ir a RAM. En producción, casi siempre domina <b>calcular las features</b> (consultas a un feature store, agregados por ventana), no el modelo. Mídelo: tiempo de <code>predict</code> por lote en tu máquina, no esta cota.` },

          { t: 'h3', text: 'Costo de entrenamiento' },
          { t: 'calc', title: R`Un árbol de la canónica (N = ${cf('N')}, F = ${cf('F')}, B = ${cf('bins')}, profundidad ${cf('depth')}; calculador)`, rows: [
            { label: 'Histogramas', expr: R`2F sumas (G y H) por fila recorrida; N filas en la raíz y ≈ N/2 en cada nivel siguiente gracias a la resta: N·(1 + (d − 1)/2) filas`, value: met('hist') },
            { label: 'Búsqueda de cortes', expr: R`F · B umbrales por nodo × nodos del árbol`, value: met('split') },
            { label: 'Un árbol', expr: 'gradientes (N) + histogramas + cortes + actualizar F (N)', value: met('trainTree') },
            { label: 'Ensamble', expr: R`× K = ${cf('nTrees')} árboles`, value: met('train') },
          ], result: R`El histograma escala con <b>N × F</b> (${qn('metrics.histogramShareTrain')} de las operaciones de entrenamiento en la canónica) y el corte con <b>F × B</b> por nodo: con N = ${cf('N')} y B = ${cf('bins')}, construir histogramas es casi todo. Por eso las aceleraciones atacan N y F: GOSS muestrea filas, EFB junta features, subsample y colsample_bytree recortan los dos, y la resta de histogramas evita la mitad de cada nivel. Bajar B de 256 a 64 casi no cambia el tiempo (el corte ya era barato) y pierde poca precisión en el umbral.` },
          { t: 'callout', kind: 'note', html: R`<p><b>GOSS y EFB (LightGBM), en dos líneas.</b> <b>GOSS</b> (Gradient-based One-Side Sampling): quedarse con el a × 100 % de filas de mayor |g| y una muestra al azar del b × 100 % del resto, multiplicando los g y h de la muestra por (1 − a)/b para no sesgar las sumas (Algoritmo 2); en LightGBM 4.x, <code>data_sample_strategy='goss'</code> con <code>top_rate</code> = 0.2 y <code>other_rate</code> = 0.1. <b>EFB</b> (Exclusive Feature Bundling): juntar features que casi nunca son distintas de 0 a la vez (típico del one-hot) en una sola, como colorear un grafo con un algoritmo voraz; activo por defecto (<code>enable_bundle</code>). El paper reporta hasta 21× por iteración contra su propio baseline sin GOSS ni EFB en Allstate (Tabla 2) con casi la misma exactitud (Tabla 3). ${LGBM}.</p>` },

          { t: 'h3', text: 'Cómo escala' },
          { t: 'scaling', model: 'gbdt', knobs: [{ key: 'nTrees', values: [100, 500, 2000, 5000] }, { key: 'depth', values: [4, 6, 8, 10] }, { key: 'N', values: [100000, 1000000, 10000000, 100000000] }, { key: 'F', values: [10, 100, 1000] }, { key: 'bins', values: [16, 64, 256] }], show: ['nodes', 'modelBytes', 'comparisonsPerPrediction', 'histogramAddsPerTree', 'trainOps', 'predictionsPerSecCpu'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 árboles → ×2 nodos, bytes, comparaciones por predicción y costo de entrenamiento. +1 de profundidad → ×2 hojas y nodos por árbol (exponencial) pero solo +1 comparación por árbol (lineal): la profundidad es barata al predecir y cara en memoria. ×2 N → ≈ ×2 histogramas (el entrenamiento), la predicción no cambia. ×2 F → ×2 histogramas y ×2 cortes, la predicción no cambia. ×2 bins → ×2 en la búsqueda de cortes (la parte barata) y nada en la predicción. Y la que no se ve en la tabla: η y K van juntos; con η a la mitad hacen falta ${est('≈ el doble')} de árboles para el mismo error de entrenamiento.` },
          { t: 'compare', models: [C, LG, X8, CB], rows: ['nTrees', 'depth', 'leaves', 'nodes', 'params', 'modelBytes', 'comparisonsPerPrediction', 'predictionsPerSecCpu', 'histogramAddsPerTree', 'splitEvalsPerTree', 'trainOps'], caption: R`XGBoost depth-wise (canónica), LightGBM leaf-wise con ${cf('leaves', LG)} hojas, XGBoost con ${cf('nTrees', X8)} árboles de profundidad ${cf('depth', X8)} y CatBoost simétrico de profundidad ${cf('depth', CB)}, todos sobre N = ${cf('N')} × F = ${cf('F')}. Predicciones por segundo: cota ≈ del calculador en CPU.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota en "how expensive is this model to serve": "a prediction is number of trees times depth comparisons, here five hundred times six, three thousand branchy memory reads and no multiplications, so microseconds per row on one core if the model fits in cache. The model is a few megabytes at most. What actually dominates latency is fetching and computing the features, so I would profile the feature pipeline first, and only then compile the trees with Treelite or batch them on GPU with FIL."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La pérdida es la de la tarea (cuadrática, logística, Poisson, de ranking) más la regularización de cada árbol; el procedimiento es voraz: un árbol por ronda, cada corte el mejor del momento. Lo que se pregunta en entrevistas no es la derivada sino <b>las perillas</b>, la <b>validación</b> y los <b>datos</b> (fuga, desbalance, tiempo).` },
          { t: 'math', display: true, tex: R`\mathcal{L}(\phi) = \sum_{i=1}^{N} l(\hat{y}_i, y_i) + \sum_{k=1}^{K}\Omega(f_k),\qquad \Omega(f) = \gamma T + \tfrac{1}{2}\lambda\lVert w\rVert^2\ \ (+\ \alpha\lVert w\rVert_1)`, caption: 'Ecuación 2 de Chen y Guestrin (α, la L1 de reg_alpha, es una opción de la biblioteca). Con λ = γ = 0 vuelve al gradient tree boosting tradicional.' },

          { t: 'h3', text: 'Las perillas, y qué cambian' },
          { t: 'table', caption: 'Regularización y defaults (leídos de las bibliotecas instaladas: xgboost 3.4.1, lightgbm 4.7.0, catboost 1.2.10)', head: ['Perilla', 'Qué hace', 'XGBoost', 'LightGBM', 'CatBoost'], rows: [
            ['Learning rate η', 'Achica cada árbol; menos η → más árboles, mejor mínimo', '<code>eta</code> 0.3', '<code>learning_rate</code> 0.1', 'automático según datos e iteraciones'],
            ['Árboles K', 'Capacidad total; se elige con early stopping', R`<code>num_boost_round</code> (10 en <code>xgb.train</code>; 100 en la API de sklearn)`, '<code>num_iterations</code> 100', '<code>iterations</code> 1000'],
            ['Tamaño del árbol', 'Orden de las interacciones que puede capturar', '<code>max_depth</code> 6', R`<code>num_leaves</code> 31, <code>max_depth</code> −1`, '<code>depth</code> 6 (simétrico)'],
            ['L2 en las hojas λ', 'Encoge w* = −G/(H + λ), sobre todo en hojas chicas', '<code>lambda</code> 1', '<code>lambda_l2</code> 0', '<code>l2_leaf_reg</code> 3'],
            ['Costo por hoja γ', 'Ganancia mínima para partir (ver la trampa del ½)', '<code>gamma</code> 0', '<code>min_gain_to_split</code> 0', '—'],
            ['Peso mínimo por hijo', 'Σh mínimo (o filas) en cada hoja', '<code>min_child_weight</code> 1', R`<code>min_data_in_leaf</code> 20, <code>min_sum_hessian_in_leaf</code> 10<sup>−3</sup>`, R`<code>min_data_in_leaf</code> 1 (solo con <code>Depthwise</code> / <code>Lossguide</code>)`],
            ['Filas por árbol', 'Bagging sin reemplazo: menos varianza, más rápido (stochastic GB)', '<code>subsample</code> 1', '<code>bagging_fraction</code> 1', R`<code>bootstrap_type</code> MVS`],
            ['Columnas', 'Por árbol, nivel o nodo: menos correlación entre árboles', R`<code>colsample_bytree/bylevel/bynode</code> 1`, '<code>feature_fraction</code> 1', '<code>rsm</code>'],
            ['Bins', 'Resolución de los umbrales', '<code>max_bin</code> 256', '<code>max_bin</code> 255', '<code>border_count</code> 254'],
          ], note: R`Los defaults cambian entre versiones: fija la versión y escribe los parámetros explícitos. Ojo con λ: 1 en XGBoost, 0 en LightGBM y 3 en CatBoost; "los mismos hiperparámetros" en dos bibliotecas no son el mismo modelo.` },
          { t: 'steps', items: [
            { title: 'Fija η y usa early stopping para K', html: R`<p>η = 0.05–0.1, K grande (miles) y <code>early_stopping_rounds</code> ${est('≈ 50–200')} sobre un set de validación con la métrica que importa. El mejor K sale solo; guarda <code>best_iteration</code> y predice con ese.</p>` },
            { title: 'Tamaño del árbol', html: R`<p>max_depth 4–8 (o num_leaves 15–255 con min_data_in_leaf). Es la perilla con más efecto: controla el orden de las interacciones.</p>` },
            { title: 'Aleatoriedad', html: R`<p>subsample y colsample_bytree 0.6–0.9. El paper de XGBoost reporta que, según sus usuarios, submuestrear columnas previene el sobreajuste más que submuestrear filas (§2.3); en Yahoo LTR, colsample = 0.5 dio NDCG@10 0.7913 contra 0.7892 sin él (Tabla 4).</p>` },
            { title: 'Regularización fina', html: R`<p>min_child_weight, λ, γ (y α si quieres hojas en 0). Con datos chicos y ruidosos importan más.</p>` },
            { title: 'Al final, baja η y re-entrena', html: R`<p>Con η a la mitad y el doble de árboles, casi siempre un poco mejor. Sale caro: decide con el presupuesto de latencia, porque K entra lineal en el costo de predecir.</p>` },
          ] },

          { t: 'h3', text: 'Validación: el error más caro es la fuga' },
          { t: 'list', items: [
            R`<b>Validación temporal.</b> Si los datos tienen tiempo (casi siempre en fraude, riesgo, demanda, ranking), un K-fold al azar mete el futuro en entrenamiento: agregados que incluyen eventos posteriores, el mismo cliente a los dos lados, patrones de fraude que todavía no existían. Entrena hasta una fecha, valida en la siguiente ventana (out-of-time) y, si puedes, deja un hueco entre las dos del tamaño del retraso de la etiqueta.`,
            R`<b>Features point-in-time.</b> Cada feature se calcula con lo que se sabía en el momento de la predicción. "Número de contracargos del cliente" calculado hoy sobre todo el historial filtra la etiqueta en las filas viejas. El síntoma: una feature con importancia altísima y un AUC offline que no se reproduce en producción.`,
            R`<b>Target encoding con la propia fila.</b> Reemplazar una categoría por la tasa media del objetivo calculada con todas las filas (incluida la propia) filtra la etiqueta: es el ejemplo de CatBoost con categorías únicas. Usa out-of-fold o el target statistic ordenado.`,
            R`<b>Early stopping sobre el test.</b> Si eliges K mirando el set de prueba, el test ya no mide nada. Tres particiones: entrenamiento, validación (early stopping, hiperparámetros, calibración) y prueba.`,
          ] },

          { t: 'h3', text: 'Clases desbalanceadas' },
          { t: 'p', html: R`Fraude a 0.1 %: de cada mil filas, una positiva. Opciones: (1) <b>no hacer nada</b> con la pérdida logística y elegir el umbral por costo; los árboles manejan bien el desbalance y la probabilidad queda calibrada. (2) <code>scale_pos_weight</code> (XGBoost; la doc sugiere sum(negativos)/sum(positivos)) o pesos por clase: más gradiente para los positivos, mejor ranking a veces, pero las probabilidades quedan <b>infladas</b>. (3) <b>Submuestrear negativos</b> para entrenar más rápido y corregir la probabilidad después: con una tasa w de negativos conservados, q = p/(p + (1 − p)/w) (${FBADS}). La doc de XGBoost lo resume: si solo te importa el ranking (AUC), balancea con scale_pos_weight; si te importa la probabilidad, no rebalancees y usa <code>max_delta_step</code> (por ejemplo 1) para ayudar a converger.` },
          { t: 'callout', kind: 'senior', html: R`<p>Métricas con desbalance: PR-AUC (la ROC-AUC se ve alta aunque el modelo sea inútil al umbral que importa), recall a una tasa fija de falsos positivos o a la capacidad del equipo de revisión, y pérdida en dinero (fraude evitado − costo de bloquear a un cliente bueno). Calibración: si el score se usa como probabilidad (precio de un seguro, límite de crédito, una regla de negocio "bloquear si p > 0.9"), recalibra con isotónica o Platt sobre una ventana reciente que el modelo no vio, y revisa el gráfico de confiabilidad por segmento.</p>` },

          { t: 'h3', text: 'Datos y recetas que se citan' },
          { t: 'kv', items: [
            ['Higgs-1M (XGBoost, Tabla 3)', R`500 árboles, profundidad 8, η = 0.1, exact greedy: 0.6841 s por árbol y AUC 0.8304 en una máquina de 2 × 8 núcleos Xeon E5-2470; scikit-learn llega a 0.8302 en 28.51 s por árbol.`, XGB],
            ['Kaggle 2015 (XGBoost, §1)', 'De 29 soluciones ganadoras publicadas en el blog de Kaggle en 2015, 17 usaron XGBoost (8 solo XGBoost); redes profundas, 11. En la KDDCup 2015, todos los equipos del top 10 usaron XGBoost.', XGB],
            ['Criteo con árboles (XGBoost, §6.2)', R`1,700 millones de filas: los 26 ids categóricos se reemplazaron por su CTR medio y su conteo (calculados en otros días), 67 features en total. Un árbol no come ids crudos.`, XGB],
            ['LightGBM (Tablas 2–3)', 'Con GOSS + EFB: 21× más rápido por iteración que su baseline en Allstate, AUC 0.6093 en ambos; KDD10 y KDD12 con decenas de millones de features dispersas.', LGBM],
            ['CatBoost (Tabla 2)', R`Mejor logloss que LightGBM y XGBoost en los 9 datasets del paper (Adult, Amazon, Click, Epsilon, …); en Amazon, +17 % de logloss para los otros dos. Setup: los tres tuneados con 50 pasos de Hyperopt (Epsilon con defaults), las categóricas de todos preprocesadas con ordered TS y CatBoost en modo Ordered; mejoras significativas salvo en Appetency, Churn y Upselling.`, CATB],
          ] },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Calcular las features', html: R`<p>Las mismas transformaciones que en entrenamiento, con los mismos bordes, encodings y ventanas de tiempo. Es la causa número uno de diferencias entre offline y producción (training-serving skew): una ventana de "últimos 7 días" que en batch incluye el día completo y online no.</p>` },
            { title: 'Recorrer los árboles', html: R`<p>${cf('nTrees')} árboles × ${cf('depth')} comparaciones = ${met('cmp')}. Sin GPU, sin batch mínimo: una fila sola cuesta lo mismo por fila que un lote.</p>` },
            { title: 'Sumar y transformar', html: R`<p>base_score + Σ hojas → margen; σ(margen) si es logística; la calibración (isotónica / Platt) si la hay.</p>` },
            { title: 'Explicar (si hace falta)', html: R`<p>TreeSHAP por predicción para razones de rechazo (reason codes) en crédito o revisión manual de fraude: O(K·L·D²) por fila (${TSHAP}), mucho más caro que predecir.</p>` },
          ] },
          { t: 'h3', text: 'Cómo se sirve' },
          { t: 'table', head: ['Opción', 'Qué es', 'Cuándo'], rows: [
            ['La biblioteca nativa', R`<code>Booster.predict</code> / <code>inplace_predict</code> en XGBoost, <code>Booster.predict</code> en LightGBM, el evaluador C++ de CatBoost`, 'Lo más simple; suficiente para la mayoría de servicios en CPU'],
            ['Treelite + TL2cgen', 'Treelite: formato de intercambio común para bosques de XGBoost, LightGBM y scikit-learn. TL2cgen (antes dentro de Treelite) compila el modelo a código C con los umbrales como constantes', 'Latencia mínima en CPU, binario sin dependencias de Python'],
            ['FIL (RAPIDS cuML)', 'Forest Inference Library: carga modelos de XGBoost, LightGBM y scikit-learn (vía Treelite) y predice en lotes en GPU (y en CPU desde RAPIDS 25.04); también como backend de Triton', 'Lotes grandes: millones de filas por segundo para scoring offline o un ranking con muchos candidatos'],
            ['ONNX', R`onnxmltools convierte XGBoost / LightGBM a los operadores TreeEnsemble de ONNX-ML; ONNX Runtime los ejecuta. Hummingbird compila árboles a operaciones de tensores (${HB})`, 'Cuando la plataforma de serving solo habla ONNX o quieres el mismo runtime que tus redes'],
          ] },
          { t: 'callout', kind: 'note', html: R`<p>Formatos de guardado: XGBoost recomienda JSON o UBJSON (binario) con <code>save_model</code>; pickle depende de la versión. LightGBM guarda texto. El formato no cambia la predicción pero sí el tamaño en disco y el tiempo de carga; el calculador estima los bytes por formato (${met('bytes')} en la canónica).</p>` },
          { t: 'callout', kind: 'trap', title: '"Para bajar la latencia, lo paso a GPU"', html: R`<p>Con una fila por request, no: la GPU gana con lotes grandes (FIL), y una fila en CPU con un modelo en caché ya tarda ${est('microsegundos')}. Primero mide dónde está el tiempo (features, red, serialización); si es el modelo, menos árboles (early stopping con un presupuesto de latencia), menos profundidad, árboles simétricos o compilar con TL2cgen.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Fuga de información.</b> Una feature calculada con datos del futuro o derivada de la etiqueta (ver <a href="#gbdt.entrenamiento">entrenamiento</a>). El GBDT la encuentra en el primer árbol y la usa en todos: el AUC offline sube a 0.99 y en producción se cae.`,
            R`<b>No extrapola.</b> Fuera del rango de entrenamiento la predicción es la de la hoja del borde: constante. Un modelo de precios entrenado con inflación del 5 % no sigue la del 20 %. Arreglo: predecir ratios o diferencias, quitar la tendencia antes, o un modelo lineal para la parte que extrapola.`,
            R`<b>Drift.</b> La distribución de las features cambia (un producto nuevo, un país nuevo, un patrón de fraude nuevo) y los umbrales aprendidos ya no separan. Monitorear: PSI o KS por feature y del score, la tasa de faltantes, y la métrica con la etiqueta cuando llega (en fraude, semanas después). Re-entrenar con una cadencia y con ventanas recientes.`,
            R`<b>Importancias que mienten.</b> La importancia por ganancia (gain) o por número de cortes (weight / split) favorece features continuas y de alta cardinalidad (más umbrales posibles), reparte de forma arbitraria entre features correlacionadas y es <b>inconsistente</b>: un modelo que depende más de una feature puede asignarle menos importancia (${TSHAP}). Usa SHAP (|SHAP| medio) o importancia por permutación sobre <b>validación</b>; y no leas causalidad en ninguna.`,
            R`<b>IDs de alta cardinalidad.</b> Un user_id como número no significa nada para un umbral; como categórica, son millones de categorías. Los árboles necesitan los ids convertidos en estadísticas (conteos, tasas, target encoding sin fuga); si la señal está en el id mismo, hace falta un embedding (<a href="#dlrm">DLRM</a>, <a href="#two-tower">two-tower</a>).`,
          ] },
          { t: 'callout', kind: 'trap', title: 'Tres defaults de importancia distintos', html: R`<p>En xgboost 3.4.1, <code>XGBClassifier.feature_importances_</code> usa <code>'gain'</code> (ganancia media por corte), <code>Booster.get_score()</code> usa <code>'weight'</code> (cuántas veces se usa la feature) y LightGBM usa <code>'split'</code> (lo mismo que weight). El mismo modelo da tres rankings distintos según la línea de código. En una entrevista: "¿importancia de qué tipo, sobre qué datos?".</p>` },

          { t: 'h3', text: '¿Por qué los árboles siguen ganando en tabulares?' },
          { t: 'p', html: R`${GRIN}. Lo que el paper dice, con su alcance exacto: 45 datasets de OpenML elegidos con criterios explícitos (columnas heterogéneas, i.i.d., sin series de tiempo, no demasiado fáciles), un régimen de <b>tamaño medio</b> (el entrenamiento se trunca a 10,000 filas), sin faltantes (se eliminan), clases balanceadas y categóricas de ≤ 20 valores; ≈ 400 iteraciones de búsqueda aleatoria por dataset (20,000 horas de cómputo en total). Resultado: XGBoost, Random Forest y GBT de scikit-learn quedan por encima de MLP, ResNet, FT-Transformer y SAINT, incluso sin contar que entrenan más rápido. Y tres hallazgos sobre el porqué:` },
          { t: 'table', head: ['Hallazgo', 'Experimento', 'Lectura'], rows: [
            ['1. Las redes prefieren soluciones demasiado suaves', 'Suavizar el objetivo de entrenamiento con un kernel gaussiano baja mucho la exactitud de los árboles y casi nada la de las redes', 'Los objetivos tabulares son irregulares (saltos en umbrales); los árboles, constantes por tramos, los siguen; las redes tienen sesgo hacia funciones de baja frecuencia'],
            ['2. Las features no informativas dañan más a las redes tipo MLP', 'Quitar features poco importantes acerca a la ResNet; agregar features de ruido agranda la brecha', 'Las tablas reales tienen muchas columnas inútiles; un árbol las ignora (no las elige para cortar)'],
            ['3. Los datos no son invariantes a rotaciones', 'Rotar las features al azar invierte el orden: las redes quedan arriba de los árboles', 'Cada columna tiene significado propio (edad, monto); un MLP es invariante a rotaciones y tiene que "descubrir" la base original. Los árboles cortan eje por eje'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Los árboles siempre ganan a las redes en tabulares"', html: R`<p>No es lo que dice el paper. Su régimen es de 10,000 filas, sin faltantes, i.i.d. y con categóricas chicas; en el apéndice, con 50,000 filas, la brecha "parece" achicarse y lo deja para trabajo futuro. ${MCEL}: en 176 datasets y 19 algoritmos, para muchos datasets la diferencia entre redes y GBDT es despreciable o importa más tunear un poco el GBDT; los GBDT manejan mejor features sesgadas o de cola pesada; y TabPFN, limitado a ≈ 3,000 filas de entrenamiento en ese estudio, fue el mejor en promedio. La respuesta senior: empieza por un GBDT, y prueba una red cuando las condiciones la favorecen.</p>` },

          { t: 'h3', text: 'Cuándo una red en vez de (o además de) un GBDT' },
          { t: 'list', items: [
            R`<b>Escala e ids</b>: miles de millones de ejemplos con ids de usuario, ítem o anuncio de cardinalidad enorme: embeddings (<a href="#dlrm">DLRM</a>), entrenamiento incremental en GPU.`,
            R`<b>Multimodal</b>: la fila trae texto, imágenes o secuencias (historial del usuario); una red las codifica y puede combinar todo de punta a punta. Alternativa barata: embeddings o scores de una red como features del GBDT.`,
            R`<b>Varias tareas o representaciones compartidas</b>: multi-task (click, compra, tiempo), o embeddings que también usa el retrieval.`,
            R`<b>Datos muy chicos</b>: TabPFN (${TABPFN}) reporta superar a los GBDT tuneados hasta ≈ 10,000 filas; en v1, hasta 1,000 filas y 100 features numéricas.`,
            R`<b>Ensamble</b>: GBDT + red promediados suelen ganarle a los dos solos en competencias; en producción pesa el costo de mantener dos modelos.`,
          ] },

          { t: 'h3', text: 'Trade-offs: modelos tabulares' },
          { t: 'table', head: ['Criterio', 'GBDT (XGBoost / LightGBM / CatBoost)', 'Random Forest', 'Regresión logística', 'MLP / FT-Transformer', 'DLRM / Wide & Deep'], rows: [
            ['Exactitud en tabular medio', 'La mejor en general', 'Buena, algo por debajo', 'Baseline; buena con features bien hechas', 'Cerca con mucho tuning; peor con features ruidosas', 'No es su caso de uso'],
            ['IDs de alta cardinalidad', 'Solo como estadísticas (conteos, tasas)', 'Igual', 'One-hot / hashing (memoriza)', 'Embeddings', 'Tablas de embeddings: su fuerte'],
            ['Datos que necesita', 'Miles a cientos de millones de filas', 'Igual', 'Pocos', 'Más; regularización cuidadosa', 'Muchísimos'],
            ['Preprocesamiento', 'Casi nada (sin escalar; NaN y categóricas nativas)', 'Casi nada', 'Escalar, one-hot, interacciones a mano', 'Escalar / cuantiles, embeddings de numéricas', 'Hashing, normalización de densas'],
            ['Sobreajuste con más capacidad', 'Sí: early stopping', 'No con más árboles', 'Poco', 'Sí', 'Sí (una época suele bastar)'],
            ['Inferencia', 'K·d comparaciones, CPU', 'Igual con árboles profundos (más memoria)', 'Un producto punto', 'MACs de la red; GPU con lotes', 'Lookups (memoria) + MLP chicos'],
            ['Extrapolar', 'No (constante)', 'No', 'Sí (lineal)', 'Sí, sin garantías', 'Sí, sin garantías'],
            ['Explicar', 'TreeSHAP exacto y rápido; monotonicidad', 'TreeSHAP', 'Coeficientes', 'SHAP aproximado', 'Difícil'],
            ['Aprendizaje incremental', 'Re-entrenar (o seguir agregando árboles)', 'Re-entrenar', 'SGD online', 'Fine-tuning', 'Online / incremental, su modo normal'],
          ] },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'list', items: [
            R`<b>AdaBoost → gradient boosting</b>: Friedman, Hastie y Tibshirani (2000) leen AdaBoost como un modelo aditivo que minimiza una pérdida exponencial y proponen LogitBoost con pasos de Newton (${FHT}); Friedman (2001) generaliza a cualquier pérdida diferenciable (${FRIED}) y en 2002 agrega el submuestreo de filas (${FRIED02}).`,
            R`<b>XGBoost</b> (${XGB}): objetivo regularizado de segundo orden, sketch de cuantiles ponderado, dirección por defecto para faltantes, bloques de columnas, accesos conscientes de la caché y entrenamiento fuera de memoria (1,700 millones de filas de Criteo en una máquina).`,
            R`<b>LightGBM</b> (${LGBM}): histogramas con resta, crecimiento por hojas (best-first, de la tesis de Shi, 2007, que el paper cita), GOSS y EFB.`,
            R`<b>CatBoost</b> (${CATB}): target statistics ordenados, ordered boosting, combinaciones de categóricas armadas de forma voraz y árboles simétricos.`,
            R`<b>HistGradientBoosting de scikit-learn</b>: implementación por histogramas inspirada en LightGBM, con NaN y categóricas nativas; el GBT de scikit-learn de toda la vida es el exacto (lento con N grande).`,
            R`<b>Random Forest</b>: el pariente por bagging (árboles profundos, independientes, promediados); no es boosting, pero es el otro baseline tabular y no necesita early stopping.`,
            R`<b>LambdaMART</b> (${BURGES}): boosting con los "λ-gradientes" de LambdaRank: para cada par (i, j) de una misma query con i más relevante, \(\lambda_{ij} = -\sigma\,|\Delta \text{NDCG}_{ij}| / (1 + e^{\sigma(s_i - s_j)})\), el gradiente de RankNet pesado por cuánto cambiaría el NDCG si se intercambian; cada árbol ajusta esos λ con pasos de Newton. Es <code>rank:ndcg</code> (el objetivo de ranking por defecto de XGBoost, que necesita un <code>qid</code> ordenado por query) y <code>lambdarank</code> en LightGBM.`,
            R`<b>GBDT + regresión logística</b> (${FBADS}): los índices de hoja de cada árbol como features one-hot de un modelo lineal para predecir clicks; el antecedente de mezclar árboles y modelos de embeddings en ranking.`,
            R`<b>DART</b> (${DART}): dropout de árboles enteros al calcular el residuo, para que los primeros árboles no dominen; disponible como <code>booster='dart'</code> en XGBoost y <code>boosting='dart'</code> en LightGBM.`,
            R`<b>NGBoost</b> (${NGB}): boosting de los parámetros de una distribución (media y varianza) con gradiente natural, para predicción probabilística.`,
            R`<b>Redes para tabulares</b>: FT-Transformer (${FTT}), TabPFN (${TABPFN}). Comparaciones: ${GRIN}; ${MCEL}.`,
          ] },
          { t: 'h3', text: 'Referencias' },
          { t: 'list', items: [
            FRIED + '.', FRIED02 + '.', FHT + '.', XGB + '.', LGBM + '.', CATB + '.', GRIN + '.', MCEL + '.', BURGES + '.', SHAP + '.', TSHAP + '.', FBADS + '.',
            'Documentación de XGBoost (Parameters, Learning to Rank, Categorical Data), de LightGBM (Parameters, Parameters Tuning) y de CatBoost (parámetros de entrenamiento); Treelite / TL2cgen y RAPIDS cuML FIL.',
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`GBDT aparece de tres formas: como derivación ("cómo elige XGBoost un corte"), como diseño ("un modelo de fraude") y como criterio ("árboles o una red"). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Walk me through how XGBoost chooses a split and the value of each leaf.',
              junior: 'Prueba todos los cortes y se queda con el que más reduce el error.',
              senior: R`Con la expansión de Taylor de segundo orden de la pérdida alrededor de la predicción actual: cada fila aporta g<sub>i</sub> w + ½ h<sub>i</sub> w² al objetivo si cae en una hoja de valor w. Agrupando por hoja: G<sub>j</sub> w<sub>j</sub> + ½(H<sub>j</sub> + λ) w<sub>j</sub>² + γ por hoja. Derivando, w* = −G/(H + λ) (un paso de Newton regularizado) y la hoja aporta −½ G²/(H + λ). La ganancia de un corte es objetivo del padre menos el de los hijos: ½[G<sub>L</sub>²/(H<sub>L</sub>+λ) + G<sub>R</sub>²/(H<sub>R</sub>+λ) − G²/(H+λ)] − γ. Para encontrarlo rápido: features cuantizadas en ${cf('bins')} bins, un histograma de G y H por feature y bin (O(N·F) por nivel, con la resta para un hijo), y un barrido con sumas acumuladas (O(F·B) por nodo). Restricciones: H<sub>L</sub>, H<sub>R</sub> ≥ min_child_weight. Detalle que se anota: la biblioteca reporta la ganancia sin el ½ y compara γ con ese número.`,
              say: 'It takes a second-order Taylor expansion of the loss around the current predictions, so each row contributes its gradient times the leaf value plus half its Hessian times the value squared. Summing per leaf, the optimal leaf weight is minus G over H plus lambda, a regularized Newton step, and the leaf reduces the objective by one half G squared over H plus lambda. The split gain is the children\'s score minus the parent\'s, minus gamma. It finds it fast by binning features, building gradient and Hessian histograms per feature, and scanning prefix sums over the bins.',
              why: 'Se anota la derivación completa (no solo la fórmula de memoria), el paso de Newton, histogramas con prefijos y min_child_weight sobre hessianos.' },
            { q: 'Design a fraud detection model for card transactions. Walk me through data, model, validation, serving and monitoring.',
              junior: 'Entreno un XGBoost con las transacciones etiquetadas, balanceo las clases con SMOTE y mido accuracy.',
              senior: R`<b>Etiqueta</b>: fraude confirmado (contracargo o reporte), que llega con <b>semanas de retraso</b>; las transacciones bloqueadas no tienen etiqueta (sesgo de selección): dejo una pequeña muestra aleatoria sin bloquear o revisada para estimar lo que el modelo no deja ver. <b>Features</b> point-in-time desde un feature store: monto relativo al historial del cliente, velocidad (transacciones en 1 h / 24 h), comercio y país nuevos para la tarjeta, distancia al último uso, dispositivo, tasas de fraude por comercio calculadas sin fuga. <b>Modelo</b>: GBDT con logística, sin rebalancear si necesito probabilidades (o submuestreo de negativos con la corrección q = p/(p + (1 − p)/w)); monotonicidad donde la regulación lo pida. <b>Validación</b>: out-of-time, con un hueco del tamaño del retraso de la etiqueta; métricas PR-AUC, recall a la tasa de falsos positivos que tolera el negocio o a la capacidad de revisión, y pérdida en dinero; elijo el umbral por costo, no en 0.5. <b>Calibración</b> isotónica sobre una ventana reciente. <b>Serving</b>: CPU, latencia total de decenas de ms dominada por las features; el modelo (${cf('nTrees')} × ${cf('depth')} comparaciones) es lo de menos. <b>Monitoreo</b>: drift de features y del score (PSI), tasa de faltantes por feature, tasa de alertas, y la métrica real cuando llegan las etiquetas; los defraudadores se adaptan, así que re-entreno con cadencia fija y ventanas recientes. <b>Explicación</b>: TreeSHAP para los analistas que revisan.`,
              say: 'Labels are confirmed chargebacks that arrive weeks later, and blocked transactions never get labels, so I keep a small random holdout to measure what the model hides. Features are point-in-time from a feature store: velocity, amount relative to the customer\'s history, new merchant or country, device. I train a gradient boosted model with logistic loss, validate out of time with a gap for label delay, and report precision-recall AUC, recall at the false positive rate operations can handle, and money saved. I pick the threshold by cost, calibrate on a recent window, serve on CPU where feature fetching dominates latency, and monitor feature drift, missing rates, alert rates and delayed performance, retraining on a fixed cadence.',
              why: 'Trampa: SMOTE + accuracy + K-fold al azar. Se anota retraso de etiqueta, sesgo de selección por bloqueos, point-in-time, out-of-time, métricas por costo, calibración y monitoreo con etiquetas tardías.', trap: true },
            { q: 'Your fraud model has an offline AUC of 0.99, but in production it barely beats the rules. What happened?',
              junior: 'Sobreajuste; le pongo más regularización.',
              senior: R`Casi siempre <b>fuga</b>, no sobreajuste. Reviso en orden: (1) una feature calculada con el futuro (un agregado sobre todo el historial, un campo que se llena después de la investigación, "estado de la cuenta" que ya dice bloqueada); la pista es una feature con importancia SHAP desproporcionada; (2) un split aleatorio en vez de temporal, con el mismo cliente o el mismo ataque en train y test; (3) target encoding con la propia fila; (4) training-serving skew: la feature se calcula distinto online (ventanas, zonas horarias, faltantes que en batch no existían y que el modelo manda por una dirección por defecto que nunca aprendió). Lo confirmo re-evaluando out-of-time con features reconstruidas point-in-time y comparando, fila por fila, las features offline con las que registró el servicio.`,
              say: 'An AUC of 0.99 on fraud is a leakage alarm, not overfitting. I would look for features computed with future information, a random instead of temporal split with the same customers on both sides, target encoding that includes the row itself, and training-serving skew, where online features are computed differently or start to be missing. I confirm it by rebuilding features point in time, validating out of time, and diffing logged online features against the offline ones.',
              why: 'Trampa: "más regularización". Se anota fuga temporal, importancia desproporcionada como síntoma, skew y NaN que solo aparecen online.', trap: true },
            { q: 'For ranking, would you use LambdaMART on gradient boosted trees or a deep model like DLRM? When would you switch?',
              junior: 'Deep learning, porque es más moderno.',
              senior: R`Depende de las features y de la escala. <b>LambdaMART</b> (<code>rank:ndcg</code>): cientos de features densas hechas a mano (BM25, CTR histórico del ítem, precio, distancia, frescura, cruces usuario × ítem calculados) sobre ≈ cientos de candidatos por query; entrena en horas en CPU, se explica con SHAP y es difícil de vencer. Su límite: no aprende de ids crudos (el paper de XGBoost tuvo que reemplazar los 26 ids de Criteo por CTR y conteos), no comparte representaciones con el retrieval y se re-entrena entero. <b>DLRM</b>: miles de millones de ejemplos, ids de usuario/ítem/anuncio con tablas de embeddings (${qn('params.total', 'dlrm-criteo-kaggle')} parámetros en la de Criteo Kaggle), secuencias de historial, multi-task, entrenamiento incremental en GPU. Cambio cuando (1) la señal está en ids y en la historia del usuario y no en features agregadas, (2) el volumen de datos lo justifica, (3) existe la infraestructura de GPU y de serving, y (4) un A/B muestra la ganancia: el offline NDCG engaña. Puente frecuente: los scores o embeddings de la red como features del GBDT, o los índices de hoja del GBDT como features de un modelo lineal (${FBADS}).`,
              say: 'With a few hundred dense engineered features and hundreds of candidates per query, LambdaMART on gradient boosted trees is very hard to beat, cheap to train on CPU and easy to explain. It cannot learn from raw high-cardinality IDs, so when the signal lives in user and item IDs and long behavior sequences, and I have billions of examples and GPU infrastructure, a DLRM-style model with embedding tables wins. I would switch only after an online A/B test, and a common bridge is feeding neural scores or embeddings as features into the tree model.',
              why: 'Se anota features densas vs ids, escala, infraestructura, la evidencia del A/B y los híbridos.' },
            { q: 'Why do tree ensembles still beat neural networks on tabular data? Is that always true?',
              junior: 'Porque las redes necesitan más datos.',
              senior: R`Grinsztajn et al. (NeurIPS 2022, 45 datasets, régimen de ≈ 10,000 filas) dan tres razones medidas: las redes tienen sesgo hacia funciones suaves y los objetivos tabulares son irregulares (suavizar el objetivo daña a los árboles, casi no a las redes); los MLP son poco robustos a features no informativas, comunes en tablas; y los MLP son invariantes a rotaciones mientras que las columnas tabulares tienen significado individual (rotar las features invierte el ranking). No siempre: el paper excluye faltantes, series de tiempo y categóricas grandes, y con 50,000 filas la brecha parece achicarse; McElfresh et al. (176 datasets) encuentran que a menudo la diferencia es despreciable y que TabPFN gana en datasets chicos. Mi práctica: GBDT como baseline fuerte, una red cuando hay escala, ids, texto o imágenes, y medir.`,
              say: 'The NeurIPS 2022 benchmark by Grinsztajn and colleagues found that on medium-sized tabular data neural networks are biased toward overly smooth functions while real targets are irregular, MLPs are hurt by uninformative features, and they are rotation invariant while tabular columns carry individual meaning. It is not universal: that benchmark excluded missing values, time series and large categoricals, the gap seems to shrink with more data, and foundation models like TabPFN win on small datasets. So I start with boosted trees and try a network when there is scale, IDs or unstructured inputs.',
              why: 'Trampa: "siempre". Se anotan los tres hallazgos con su alcance y la evidencia en contra.', trap: true },
            { q: 'LightGBM grows trees leaf-wise and CatBoost uses oblivious trees. What are the trade-offs?',
              junior: 'LightGBM es más rápido.',
              senior: R`<b>Depth-wise</b> (XGBoost): parte todos los nodos de un nivel; árboles balanceados, ≤ 2<sup>d</sup> hojas, a veces parte nodos con poca ganancia. <b>Leaf-wise</b> (LightGBM): parte siempre la hoja de mayor ganancia hasta num_leaves; menos pérdida con el mismo número de hojas, pero ramas profundas que sobreajustan con pocos datos: num_leaves (31 por defecto) bastante menor que 2<sup>max_depth</sup>, min_data_in_leaf, y max_depth si hace falta. <b>Oblivious</b> (CatBoost): un mismo corte por nivel; cada árbol es más débil y regularizado, y predecir es d comparaciones independientes que forman un índice de bits a 2<sup>d</sup> hojas: sin saltos dependientes, vectorizable, muy rápido. Con los defaults, los tres se parecen en exactitud; las diferencias grandes vienen de categóricas (CatBoost), velocidad de entrenamiento en datos grandes y dispersos (LightGBM) y del tuning.`,
              say: 'Depth-wise growth splits a whole level at a time and gives balanced trees. Leaf-wise growth always splits the leaf with the largest gain, which reaches lower loss for the same number of leaves but can grow deep branches and overfit small data, so I cap num leaves and set a minimum data per leaf. Oblivious trees use the same split across a level, which regularizes and makes inference a bit-index lookup without branches. In practice accuracy is close and the choice comes from categorical handling, training speed and serving latency.',
              why: 'Se anota num_leaves vs 2^depth, el control del sobreajuste y la ventaja de inferencia de los árboles simétricos.' },
            { q: 'The top feature in your model is customer_id. What do you do?',
              junior: 'Lo dejo, el modelo sabe lo que hace.',
              senior: R`Desconfío dos veces. (1) Un id tratado como número no tiene orden con significado: el modelo está memorizando rangos de ids (clientes viejos tienen ids bajos, quizás) y eso no generaliza a clientes nuevos. (2) La importancia por ganancia o por cortes favorece features con muchos valores distintos: un id continuo ofrece miles de umbrales y "gana" aunque aporte poco. Pruebo: importancia por permutación o SHAP en validación out-of-time, y quitar la columna (drop-column) y comparar la métrica. Si la señal real es "quién es el cliente", la expreso como features que generalizan (antigüedad, historial, tasas) o con un embedding en otro modelo.`,
              say: 'An ID as a numeric feature has no meaningful order, so the model is memorizing ID ranges, and gain or split-count importance is biased toward features with many unique values. I would check permutation or SHAP importance on an out-of-time validation set and a drop-column test, and replace the ID with features that generalize, like tenure and historical rates.',
              why: 'Se anota el sesgo de la importancia hacia alta cardinalidad, la memorización y cómo medir bien.', trap: true },
            { q: 'Your probabilities are badly calibrated after you set scale_pos_weight. Why, and how do you fix it?',
              junior: 'Subo el número de árboles.',
              senior: R`scale_pos_weight multiplica el gradiente y el hessiano de los positivos: el modelo optimiza otra pérdida, equivalente a ver los positivos w veces más frecuentes, así que sus probabilidades están infladas en ese factor (en odds). El ranking puede quedar igual o mejor, pero p ya no es una probabilidad. Arreglos: (1) no usarlo si necesito probabilidades (la doc de XGBoost lo dice); (2) corregir analíticamente las odds; (3) recalibrar con isotónica o Platt sobre una validación reciente sin rebalancear; (4) verificar con un gráfico de confiabilidad y Brier score, por segmento.`,
              say: 'Scale pos weight upweights positive gradients and Hessians, so the model effectively trains on a distribution with many more positives and its outputs are inflated probabilities, even if the ranking is fine. If I need probabilities I either avoid reweighting, correct the odds analytically, or recalibrate with isotonic regression or Platt scaling on a recent validation window, and check a reliability diagram per segment.',
              why: 'Se anota que reponderar cambia la pérdida y que la calibración se arregla aparte, en datos recientes.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuántas comparaciones hace una predicción de la canónica, y cuántas con 2,000 árboles de profundidad 8?',
              a: R`K·d: ${met('cmp')} en la canónica y ${met('cmp', X8)} en ${X8}. La predicción es lineal en K y en d; la memoria del modelo, en cambio, crece como K·2<sup>d</sup>.` },
            { q: '¿Qué domina el costo de entrenar un árbol con N = 1M y F = 100?',
              a: R`Armar los histogramas: ≈ N·F sumas por nivel (${met('hist')} por árbol en el calculador), contra ${met('split')} evaluaciones de umbral. Por eso GOSS (menos filas) y EFB (menos features) aceleran, y bajar los bins casi no.` },
            { q: 'En el ejemplo de seis filas, ¿por qué el mejor corte es x &lt; 3.5 y no x &lt; 4.5?',
              a: R`Por la ganancia. x &lt; 3.5: G<sub>L</sub> = 3.0, H<sub>L</sub> = 3, G<sub>R</sub> = −3.0, H<sub>R</sub> = 3 → ½(9/4 + 9/4 − 0) = 2.25. x &lt; 4.5: G<sub>L</sub> = 2.0 (+1.0 + 0.8 + 1.2 − 1.0), H<sub>L</sub> = 4, G<sub>R</sub> = −2.0, H<sub>R</sub> = 2 → ½(4/5 + 4/3) ≈ 1.07. Separar los tres residuos negativos de los tres positivos es lo que más baja el objetivo.` },
            { q: '¿Qué cambia en la hoja si λ pasa de 1 a 10, en el mismo ejemplo?',
              a: R`w* = −3.0/(3 + 10) ≈ −0.23 en vez de −0.75: la hoja se encoge hacia 0, y la ganancia baja a ½(9/13 + 9/13) ≈ 0.69. λ pesa más cuanto menos filas (menos H) tiene la hoja: regulariza justo las hojas que menos evidencia tienen.` },
            { q: '¿Por qué un GBDT necesita early stopping y un Random Forest no?',
              a: 'Porque cada árbol de boosting se ajusta al residuo de los anteriores, incluido el ruido: el error de validación baja, toca fondo y sube. En Random Forest los árboles son independientes y promediar más solo reduce la varianza.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el bucle de boosting sin mirar; después las cuentas del calculador ("¿qué pasa si…?") y al final tres ejercicios que se piden en entrevistas: un corte y sus hojas a mano, una ronda de boosting a mano y un GBDT en NumPy que da lo mismo que XGBoost.` },
          { t: 'h3', text: 'Diagrama en blanco: el bucle de boosting' },
          { t: 'blankdiagram', diagram: 'gbdt-overview', slots: [
            { node: 'gradients', ask: 'label', hint: 'dos números por fila' },
            { node: 'histogram', ask: 'label', hint: 'sumas por bin' },
            { node: 'best-split', ask: 'label', hint: 'G²/(H + λ)' },
            { node: 'update', ask: 'label', hint: 'F_t = F_{t−1} + η·f_t' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'gbdt', pool: 'all', configs: [C, LG] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Duplicas los árboles de ${cf('nTrees')} a 1,000. ¿Por qué factor cambian las comparaciones por predicción?`, change: { nTrees: 1000 }, ask: 'comparisonsPerPrediction',
              explain: '×2: K·d, lineal en K.' },
            { q: 'Mismo cambio, 1,000 árboles. ¿Y los bytes del modelo?', change: { nTrees: 1000 }, ask: 'modelBytes',
              explain: '×2: cada árbol aporta los mismos nodos (y la misma cabecera en el archivo).' },
            { q: R`Subes la profundidad de ${cf('depth')} a 8. ¿Por qué factor cambian las comparaciones por predicción?`, change: { depth: 8 }, ask: 'comparisonsPerPrediction',
              explain: '×8/6 ≈ 1.33: una comparación más por nivel. La predicción crece lineal con la profundidad.' },
            { q: 'Mismo cambio, profundidad 8. ¿Y los nodos del modelo?', change: { depth: 8 }, ask: 'nodes',
              explain: '≈ ×4: un árbol lleno tiene 2^d hojas y 2^d − 1 nodos internos. La memoria crece exponencial con la profundidad.' },
            { q: R`Multiplicas N por 10 (de ${cf('N')} a 10 millones de filas). ¿Por qué factor cambian las operaciones de histograma por árbol?`, change: { N: 10000000 }, ask: 'histogramAddsPerTree',
              explain: '≈ ×10: cada nivel recorre las N filas.' },
            { q: 'Mismo cambio, N × 10. ¿Y las comparaciones por predicción?', change: { N: 10000000 }, ask: 'comparisonsPerPrediction',
              explain: 'Nada: predecir solo depende de K y d. Más datos encarecen el entrenamiento, no el serving (salvo que permitan árboles más grandes).' },
            { q: R`Bajas los bins de ${cf('bins')} a 64. ¿Qué pasa con las evaluaciones de umbral por árbol?`, change: { bins: 64 }, ask: 'splitEvalsPerTree',
              explain: '≈ ÷4: F·B por nodo (XGBoost usa B + 1 entradas: 257 → 65). Pero esa parte ya era chica al lado de los histogramas: el total de operaciones de entrenamiento baja menos de 2 %.' },
            { q: R`Duplicas las features de ${cf('F')} a 200. ¿Qué pasa con las operaciones de histograma por árbol?`, change: { F: 200 }, ask: 'histogramAddsPerTree',
              explain: '×2: N·F por nivel. Por eso colsample_bytree y EFB aceleran.' },
          ] },

          { t: 'h3', text: 'A mano (1): un corte y sus hojas' },
          { t: 'p', html: R`Seis filas, una feature, pérdida cuadrática, λ = 1, γ = 0, η = 0.3. x = 1, 2, 3, 4, 5, 6; y = 1.0, 1.2, 0.8, 3.0, 3.4, 2.6; F<sub>0</sub> = base_score = 2.0 (la media). (a) Calcula g y h de cada fila. (b) Calcula la ganancia de los cinco umbrales posibles con la ecuación 7 y elige el mejor. (c) Calcula w* de las dos hojas y las predicciones nuevas. (d) ¿Qué número imprime XGBoost como <code>gain</code> y desde qué γ el corte se poda?` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con xgboost 3.4.1, tree_method exact y hist)',
              a: R`(a) g = F<sub>0</sub> − y = +1.0, +0.8, +1.2, −1.0, −1.4, −0.6; h = 1. (b) Umbrales entre x = k y k + 1: 1|2 → G<sub>L</sub> = 1.0, H<sub>L</sub> = 1 → ½(1/2 + 1/6) ≈ 0.333; 2|3 → ½(3.24/3 + 3.24/5) = 0.864; <b>3|4 → ½(9/4 + 9/4) = 2.25</b>; 4|5 → ½(4/5 + 4/3) ≈ 1.067; 5|6 → ½(0.36/6 + 0.36/2) = 0.12 (el término del padre es 0 porque G = 0: F<sub>0</sub> es la media). (c) w<sub>L</sub> = −3.0/(3 + 1) = −0.75, w<sub>R</sub> = +0.75; XGBoost guarda las hojas ya multiplicadas por η: −0.225 y +0.225; predicciones 1.775 (x ≤ 3) y 2.225 (x ≥ 4). (d) El dump dice <code>[f0&lt;3.5] … gain=4.5, cover=6</code>: el corchete sin el ½ (2 × 2.25). El corte sobrevive con <code>gamma</code> = 4.4 y se poda con 4.6: γ se compara con 4.5, no con 2.25. Con <code>tree_method='hist'</code> el umbral impreso es <code>f0&lt;4</code> (un borde de bin), con las mismas hojas.` },
          ] },
          { t: 'h3', text: 'A mano (2): la segunda ronda' },
          { t: 'p', html: R`Sigue desde las predicciones 1.775 y 2.225. Calcula los nuevos residuos, la ganancia (en la escala de la biblioteca) y las hojas del segundo árbol con el mismo corte, y las predicciones después de dos rondas.` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con xgboost 3.4.1)',
              a: R`g = 1.775 − y = +0.775, +0.575, +0.975 (G<sub>L</sub> = 2.325) y 2.225 − y = −0.775, −1.175, −0.375 (G<sub>R</sub> = −2.325); H<sub>L</sub> = H<sub>R</sub> = 3. Ganancia de la biblioteca: 2·(2.325²/4) ≈ 2.703 (el dump: <code>gain=2.70281267</code>). Hojas: w = ∓2.325/4 = ∓0.58125, × η = ∓0.174375. Predicciones: 1.775 − 0.174375 = 1.600625 y 2.399375. Observa que G bajó de 3.0 a 2.325 = 3.0 × (1 − 0.225): con hojas compartidas, cada ronda quita una fracción η·H/(H + λ) = 0.3 × 3/4 del residuo de la hoja; por eso η chico pide más rondas.` },
          ] },
          { t: 'h3', text: 'A mano (3): logística y min_child_weight' },
          { t: 'p', html: R`Ocho filas, x = 1…8, y = 0, 0, 0, 1, 0, 1, 1, 1, pérdida logística, base_score = 0.5 (margen 0), λ = 1, η = 1, profundidad 1. (a) ¿Cuánto valen g y h de cada fila? (b) ¿Qué umbrales permite min_child_weight = 1? (c) ¿Qué corte elige XGBoost con min_child_weight = 1 y con 0?` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con xgboost 3.4.1)',
              a: R`(a) p = 0.5 → g = p − y = ±0.5 y h = p(1 − p) = 0.25 en todas. (b) Cada hijo necesita Σh ≥ 1, o sea ≥ 4 filas: solo x &lt; 4.5 (cuatro y cuatro). (c) Con min_child_weight = 1: x &lt; 4.5, G<sub>L</sub> = 1.0, H<sub>L</sub> = 1.0 → hojas ∓0.5, ganancia (biblioteca) 1/2 + 1/2 − 0 = 1.0, y el dump dice <code>cover=2</code> en la raíz (Σh de 8 filas, no 8). Con min_child_weight = 0 aparecen cortes mejores: x &lt; 3.5 y x &lt; 5.5 empatan con 2.286 (xgboost elige x &lt; 5.5, hojas −0.667 y +0.857). Moraleja: con logística, min_child_weight cuenta hessianos y con p cerca de 0 o 1 exige muchas más filas por hoja.` },
          ] },

          { t: 'h3', text: 'Escríbelo: un GBDT en NumPy que da lo mismo que XGBoost' },
          { t: 'p', html: R`Sin mirar: (1) <code>grad_hess</code> para cuadrática y logística; (2) <code>build_tree</code> recursivo por niveles: para cada feature, ordenar, sumas prefijo de g y h, ganancia de todos los umbrales (en la escala de la biblioteca), respetar min_child_weight y γ, hoja con w* = −G/(H + λ); (3) el bucle de boosting con η; (4) comparar contra <code>xgboost.train</code> con <code>tree_method='exact'</code> y el mismo base_score. Verificado (xgboost 3.4.1, 500 filas × 5 features, 20 árboles de profundidad 3, η = 0.3, λ = 1): diferencia máxima entre predicciones 1.7·10<sup>−7</sup> en regresión y 8·10<sup>−8</sup> en logística (float32 de XGBoost). Extensión: cambia el ordenamiento por histogramas de 256 bins (<code>np.bincount</code> con pesos g y h); en un juego de 100,000 filas × 10 features, el mejor corte por histograma recupera el 99.98 % de la ganancia del exacto con 256 bins y el 98.8 % con 16.` },
          { t: 'code', title: 'Solución de referencia (NumPy, contra xgboost)', files: [
            { name: 'gbdt_numpy.py', lang: 'python', code: R`import numpy as np


def grad_hess(y, F, loss):
    if loss == 'squared':                      # l = ½(F − y)²
        return F - y, np.ones_like(F)
    p = 1.0 / (1.0 + np.exp(-F))                # logística: F es el logit
    return p - y, p * (1.0 - p)


def build_tree(X, g, h, depth, max_depth, lam, gamma, min_child_weight):
    G, H = g.sum(), h.sum()
    leaf = {'w': -G / (H + lam)}                # w* = −G/(H+λ)
    if depth == max_depth or len(g) < 2:
        return leaf
    parent = G * G / (H + lam)
    best = (0.0, None, None)
    for f in range(X.shape[1]):
        order = np.argsort(X[:, f], kind='stable')
        xs, gs, hs = X[order, f], g[order], h[order]
        GL, HL = np.cumsum(gs)[:-1], np.cumsum(hs)[:-1]   # prefijos: G_L, H_L de cada umbral
        GR, HR = G - GL, H - HL
        gain = GL**2 / (HL + lam) + GR**2 / (HR + lam) - parent   # sin el ½: la escala de la biblioteca
        ok = (xs[1:] > xs[:-1]) & (HL >= min_child_weight) & (HR >= min_child_weight)
        gain = np.where(ok, gain, -np.inf)
        k = int(np.argmax(gain))
        if gain[k] > best[0]:
            best = (gain[k], f, (xs[k] + xs[k + 1]) / 2)
    gain, f, thr = best
    if f is None or gain <= gamma:              # γ: ganancia mínima para partir
        return leaf
    m = X[:, f] < thr
    return {'f': f, 'thr': thr,
            'L': build_tree(X[m], g[m], h[m], depth + 1, max_depth, lam, gamma, min_child_weight),
            'R': build_tree(X[~m], g[~m], h[~m], depth + 1, max_depth, lam, gamma, min_child_weight)}


def predict_tree(t, X):
    out = np.empty(len(X))
    for i, x in enumerate(X):
        n = t
        while 'f' in n:                          # una comparación por nivel
            n = n['L'] if x[n['f']] < n['thr'] else n['R']
        out[i] = n['w']
    return out


def fit(X, y, n_trees=20, max_depth=3, eta=0.3, lam=1.0, gamma=0.0, min_child_weight=1.0, loss='squared', base=None):
    if base is None:
        base = y.mean() if loss == 'squared' else 0.0
    F = np.full(len(y), base, dtype=float)
    trees = []
    for _ in range(n_trees):
        g, h = grad_hess(y, F, loss)
        t = build_tree(X, g, h, 0, max_depth, lam, gamma, min_child_weight)
        F += eta * predict_tree(t, X)            # F_t = F_{t−1} + η f_t
        trees.append(t)
    return base, trees


def predict(model, X, eta=0.3):
    base, trees = model
    return base + eta * sum(predict_tree(t, X) for t in trees)


if __name__ == '__main__':
    import xgboost as xgb
    rng = np.random.default_rng(0)
    X = rng.random((500, 5)).astype(np.float32)
    y = np.sin(6 * X[:, 0]) + (X[:, 1] > 0.5) + 0.1 * rng.standard_normal(500)
    model = fit(X, y)
    b = xgb.train({'tree_method': 'exact', 'max_depth': 3, 'eta': 0.3, 'lambda': 1.0, 'base_score': float(model[0])},
                  xgb.DMatrix(X, label=y), 20)
    print('max |numpy − xgboost| =', np.abs(predict(model, X) - b.predict(xgb.DMatrix(X))).max())   # ≈ 1.7e-07
    yb = (y > 1.0).astype(float)
    mb = fit(X, yb, loss='logistic')
    bb = xgb.train({'objective': 'binary:logistic', 'tree_method': 'exact', 'max_depth': 3, 'eta': 0.3,
                    'lambda': 1.0, 'base_score': 0.5}, xgb.DMatrix(X, label=yb), 20)
    pb = 1 / (1 + np.exp(-predict(mb, X)))
    print('max |numpy − xgboost| (logística) =', np.abs(pb - bb.predict(xgb.DMatrix(X))).max())  # ≈ 8e-08
` },
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. El resto del embudo de recomendación: <a href="#two-tower">two-tower</a> (candidatos) y <a href="#dlrm">DLRM</a> (ranking con embeddings).</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'gbdt-01', kind: 'concepto', q: 'Boosting en una línea.', a: R`Modelo aditivo F<sub>t</sub> = F<sub>t−1</sub> + η·f<sub>t</sub>, donde cada árbol f<sub>t</sub> aproxima el gradiente negativo de la pérdida respecto de las predicciones: descenso de gradiente en el espacio de funciones (Friedman 2001).` },
      { id: 'gbdt-02', kind: 'formula', q: 'Peso óptimo de una hoja en XGBoost.', a: R`\(w^* = -G/(H + \lambda)\), con G y H las sumas de gradientes y hessianos de la hoja: un paso de Newton regularizado.` },
      { id: 'gbdt-03', kind: 'formula', q: 'Ganancia de un corte (ecuación 7 de XGBoost).', a: R`\(\tfrac{1}{2}\big[G_L^2/(H_L+\lambda) + G_R^2/(H_R+\lambda) - G^2/(H+\lambda)\big] - \gamma\).` },
      { id: 'gbdt-04', kind: 'trampa', q: '"El gain del dump de XGBoost es el de la ecuación 7, y γ se compara con él."', a: 'La biblioteca imprime el corchete sin el ½ y poda si ese número &lt; gamma: su γ equivale al doble del γ del paper.' },
      { id: 'gbdt-05', kind: 'formula', q: 'g y h de la pérdida logística.', a: 'g = p − y, h = p(1 − p), con p = σ(F) y F el margen.' },
      { id: 'gbdt-06', kind: 'trampa', q: '"min_child_weight = número mínimo de filas por hoja."', a: 'Es Σh (cover). Con logística y p = 0.5, ≥ 4 filas; con p = 0.99, ≈ 102. Solo con pérdida cuadrática (h = 1) es un conteo.' },
      { id: 'gbdt-07', kind: 'concepto', q: 'Por qué el sketch de cuantiles de XGBoost pondera por h.', a: 'El objetivo de segundo orden es una regresión cuadrática ponderada con etiquetas −g/h y pesos h: las filas con más hessiano merecen bordes más finos.' },
      { id: 'gbdt-08', kind: 'formula', q: 'Costo de histogramas y de cortes.', a: 'Histogramas O(filas × F) por nodo (≈ N·F por nivel); búsqueda de cortes O(F × B) por nodo. Con B ≪ N domina el histograma.' },
      { id: 'gbdt-09', kind: 'concepto', q: 'El truco de la resta de histogramas.', a: 'Histograma del hijo grande = padre − hijo chico: solo se construye el del hijo con menos filas.' },
      { id: 'gbdt-10', kind: 'tradeoff', q: 'Depth-wise vs leaf-wise vs oblivious.', a: 'Depth-wise (XGBoost): balanceado, ≤ 2^d hojas. Leaf-wise (LightGBM): parte la hoja de mayor ganancia, menos pérdida por hoja, ramas profundas y sobreajuste con pocos datos. Oblivious (CatBoost): un corte por nivel, regularizado, inferencia sin saltos.' },
      { id: 'gbdt-11', kind: 'trampa', q: '"num_leaves = 2^max_depth da el mismo árbol en LightGBM."', a: 'Mismo número de hojas, otra forma: leaf-wise puede hacer una rama muy profunda. num_leaves bastante menor que 2^max_depth.' },
      { id: 'gbdt-12', kind: 'concepto', q: 'GOSS.', a: 'Conservar el a·100 % de filas con mayor |g| y una muestra del b·100 % del resto, con sus g y h × (1 − a)/b para no sesgar las sumas.' },
      { id: 'gbdt-13', kind: 'concepto', q: 'EFB.', a: 'Juntar features mutuamente excluyentes (casi nunca ≠ 0 a la vez, como el one-hot) en una sola; agrupar de forma óptima es NP-hard, se hace voraz como colorear un grafo.' },
      { id: 'gbdt-14', kind: 'concepto', q: 'Cómo maneja XGBoost los faltantes.', a: 'Cada nodo aprende una dirección por defecto: prueba mandar los faltantes a la izquierda y a la derecha y se queda con la de más ganancia, recorriendo solo las entradas presentes.' },
      { id: 'gbdt-15', kind: 'trampa', q: '"Si en producción empieza a faltar una feature, el modelo lo maneja."', a: 'Si nunca faltó en entrenamiento, la dirección por defecto es arbitraria (xgboost la pone distinta con exact y con hist): las filas caen por un lado sin aprender.' },
      { id: 'gbdt-16', kind: 'concepto', q: 'Ordered target statistic (CatBoost).', a: 'Codificar la categoría con el promedio del objetivo de las filas anteriores en una permutación aleatoria, suavizado con un prior: sin la propia etiqueta, sin fuga.' },
      { id: 'gbdt-17', kind: 'concepto', q: 'Prediction shift y ordered boosting.', a: 'Los residuos de entrenamiento se calculan con un modelo que ya vio esas filas, así que su distribución difiere de la de test. Ordered boosting usa para cada fila un modelo entrenado solo con las anteriores.' },
      { id: 'gbdt-18', kind: 'concepto', q: 'Árbol oblivious: cómo se predice.', a: 'd comparaciones independientes (una por nivel, el mismo corte en todo el nivel) forman un índice de d bits a una tabla de 2^d hojas.' },
      { id: 'gbdt-19', kind: 'conteo', q: 'Comparaciones por predicción de la canónica (500 árboles, profundidad 6).', a: R`K·d = ${met('cmp')}; cero MACs.` },
      { id: 'gbdt-20', kind: 'concepto', q: 'Qué crece lineal y qué exponencial con la profundidad.', a: 'Comparaciones por predicción: lineal (d por árbol). Hojas, nodos y memoria: exponencial (2^d por árbol).' },
      { id: 'gbdt-21', kind: 'trampa', q: '"Más árboles nunca sobreajustan."', a: 'Eso es Random Forest. En boosting cada árbol ajusta el residuo, incluido el ruido: el error de validación sube después de un punto. Early stopping.' },
      { id: 'gbdt-22', kind: 'tradeoff', q: 'Learning rate vs número de árboles.', a: 'η a la mitad pide ≈ el doble de árboles para el mismo error de entrenamiento y suele dar un mínimo de validación algo mejor; K entra lineal en la latencia.' },
      { id: 'gbdt-23', kind: 'concepto', q: 'λ por defecto en XGBoost, LightGBM y CatBoost.', a: 'XGBoost lambda = 1, LightGBM lambda_l2 = 0, CatBoost l2_leaf_reg = 3: los "mismos hiperparámetros" no son el mismo modelo.' },
      { id: 'gbdt-24', kind: 'concepto', q: 'Defaults de bins.', a: 'XGBoost max_bin 256, LightGBM max_bin 255, CatBoost border_count 254 (CPU).' },
      { id: 'gbdt-25', kind: 'trampa', q: '"La importancia por gain dice qué features importan."', a: 'Gain y split count favorecen features continuas y de alta cardinalidad y son inconsistentes (Lundberg et al. 2018). SHAP o permutación en validación; nunca causalidad.' },
      { id: 'gbdt-26', kind: 'concepto', q: 'Defaults de importancia.', a: "XGBClassifier.feature_importances_: 'gain'. Booster.get_score(): 'weight'. LightGBM: 'split'." },
      { id: 'gbdt-27', kind: 'formula', q: 'Costo de TreeSHAP.', a: 'O(T·L·D²) por fila explicada (T árboles, L hojas, D profundidad), contra O(T·L·2^M) del cálculo ingenuo con M features.' },
      { id: 'gbdt-28', kind: 'concepto', q: 'Los tres hallazgos de Grinsztajn et al. (2022).', a: 'Las redes prefieren funciones demasiado suaves; las features no informativas dañan más a los MLP; los datos tabulares no son invariantes a rotaciones (y los MLP sí).' },
      { id: 'gbdt-29', kind: 'trampa', q: '"Los árboles siempre ganan en tabulares."', a: 'El benchmark es de ≈ 10,000 filas, sin faltantes, i.i.d. y categóricas chicas; con 50,000 la brecha parece achicarse; McElfresh et al. (2023) ven diferencias a menudo despreciables y a TabPFN ganar en datos chicos.' },
      { id: 'gbdt-30', kind: 'concepto', q: 'LambdaMART en una línea.', a: 'Boosting de árboles sobre los λ-gradientes de LambdaRank: el gradiente de RankNet de cada par pesado por |ΔNDCG| al intercambiarlos. rank:ndcg en XGBoost, lambdarank en LightGBM.' },
      { id: 'gbdt-31', kind: 'tradeoff', q: 'LambdaMART (GBDT) vs DLRM para ranking.', a: 'GBDT: cientos de features densas hechas a mano, CPU, explicable, no aprende ids crudos. DLRM: ids de alta cardinalidad con embeddings, historia del usuario, escala y GPU. Cambiar solo con un A/B.' },
      { id: 'gbdt-32', kind: 'concepto', q: 'Cómo usó Criteo el paper de XGBoost.', a: 'Reemplazó los 26 ids categóricos por su CTR medio y su conteo, calculados en otros días: 67 features para 1,700 millones de filas. Los árboles no comen ids crudos.' },
      { id: 'gbdt-33', kind: 'concepto', q: 'Para qué sirve monotone_constraints.', a: 'Forzar que la predicción no baje (o no suba) cuando crece una feature (más ingreso → no más riesgo): requisito regulatorio en crédito y robustez fuera de los datos. XGBoost y LightGBM lo imponen al elegir cortes y valores de hoja.' },
      { id: 'gbdt-34', kind: 'trampa', q: '"Uso scale_pos_weight y leo el score como probabilidad."', a: 'Reponderar cambia la pérdida y infla las probabilidades. Si importan las probabilidades, no rebalancees o recalibra (isotónica / Platt) en una ventana reciente.' },
      { id: 'gbdt-35', kind: 'concepto', q: 'Validación de un modelo de fraude.', a: 'Out-of-time con un hueco del tamaño del retraso de la etiqueta, features point-in-time, PR-AUC y recall a la tasa de falsos positivos aceptable, umbral por costo.' },
      { id: 'gbdt-36', kind: 'trampa', q: '"AUC offline de 0.99 en fraude."', a: 'Alarma de fuga: features con futuro, split aleatorio con el mismo cliente a los dos lados, target encoding con la propia fila, o skew offline/online.' },
      { id: 'gbdt-37', kind: 'concepto', q: 'Por qué un GBDT no extrapola.', a: 'Cada árbol es constante por tramos: fuera del rango de entrenamiento devuelve la hoja del borde. Predice ratios o diferencias, o quita la tendencia.' },
      { id: 'gbdt-38', kind: 'concepto', q: 'Treelite, TL2cgen, FIL.', a: 'Treelite: formato común para bosques de XGBoost, LightGBM y scikit-learn. TL2cgen: compila el modelo a C. FIL (cuML): inferencia en lotes en GPU (y CPU).' },
      { id: 'gbdt-39', kind: 'trampa', q: '"Para bajar la latencia del GBDT, lo paso a GPU."', a: 'Con una fila por request la GPU no ayuda; suele dominar el cálculo de features. Menos árboles o profundidad, árboles simétricos, compilar a C.' },
      { id: 'gbdt-40', kind: 'concepto', q: 'Qué hacen subsample y colsample.', a: 'Muestrear filas (stochastic GB, Friedman 2002) o columnas por árbol, nivel o nodo: menos varianza y menos correlación entre árboles, y entrenamiento más rápido.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'gradient boosting', es: 'boosting por gradiente', def: 'Modelo aditivo que agrega en cada ronda un modelo débil (un árbol) ajustado al gradiente negativo de la pérdida respecto de las predicciones actuales.', say: 'Gradient boosting is gradient descent in function space.' },
      { en: 'GBDT (gradient boosted decision trees)', es: 'árboles de decisión con boosting por gradiente', def: 'Gradient boosting con árboles de regresión como modelo débil; XGBoost, LightGBM y CatBoost son implementaciones.', say: 'Our first baseline for tabular data is a GBDT.' },
      { en: 'shrinkage (learning rate)', es: 'encogimiento', def: 'Factor η que multiplica cada árbol nuevo antes de sumarlo; menos η pide más árboles y suele generalizar mejor.', say: 'We use a learning rate of 0.05 with early stopping.' },
      { en: 'Hessian (second-order gradient)', es: 'hessiano', def: 'Segunda derivada de la pérdida respecto de la predicción; XGBoost la usa para dar a cada hoja un paso de Newton.', say: 'With logistic loss the Hessian is p times one minus p.' },
      { en: 'split gain', es: 'ganancia de un corte', def: 'Cuánto baja el objetivo regularizado al partir un nodo; en XGBoost, función de G y H de los dos hijos, λ y γ.', say: 'A split is kept only if its gain exceeds gamma.' },
      { en: 'min_child_weight / cover', es: 'peso mínimo por hijo', def: 'Suma mínima de hessianos en cada hoja (cover en el dump de XGBoost); con pérdida cuadrática equivale a un conteo de filas.', say: 'With logistic loss, min child weight counts Hessians, not rows.' },
      { en: 'histogram-based split finding', es: 'búsqueda de cortes por histogramas', def: 'Cuantizar cada feature en B bins y sumar gradientes y hessianos por bin para evaluar solo B umbrales por feature.', say: 'Histogram building dominates training time.' },
      { en: 'leaf-wise (best-first) growth', es: 'crecimiento por hojas', def: 'Partir siempre la hoja de mayor ganancia hasta un número de hojas; lo usa LightGBM por defecto.', say: 'Leaf-wise growth needs a cap on the number of leaves.' },
      { en: 'oblivious (symmetric) tree', es: 'árbol simétrico', def: 'Árbol con el mismo corte en todos los nodos de un nivel; la hoja es un índice de d bits. Lo usa CatBoost.', say: 'Oblivious trees make inference branch-free.' },
      { en: 'default direction (sparsity-aware split)', es: 'dirección por defecto', def: 'Rama a la que un nodo manda las filas con el valor faltante; se aprende al entrenar.', say: 'Missing values follow the learned default direction.' },
      { en: 'target statistic (target encoding)', es: 'estadístico del objetivo', def: 'Reemplazar una categoría por el promedio del objetivo en esa categoría; filtra la etiqueta si incluye la propia fila.', say: 'We use out-of-fold target encoding to avoid leakage.' },
      { en: 'early stopping', es: 'parada temprana', def: 'Dejar de agregar árboles cuando la métrica de validación no mejora en un número de rondas.', say: 'Early stopping picked about eight hundred trees.' },
      { en: 'LambdaMART', es: 'LambdaMART', def: 'Boosting de árboles para ranking con los λ-gradientes de LambdaRank, pesados por el cambio de NDCG de cada par.', say: 'Our ranker is LambdaMART with the rank NDCG objective.' },
      { en: 'SHAP values (TreeSHAP)', es: 'valores SHAP', def: 'Atribución de cada predicción a las features según valores de Shapley; TreeSHAP los calcula exactos en tiempo polinomial para árboles.', say: 'We return the top three SHAP features as reason codes.' },
      { en: 'out-of-time validation', es: 'validación fuera de tiempo', def: 'Validar con datos posteriores a los de entrenamiento, como el modelo se va a usar.', say: 'We validate out of time with a gap for label delay.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
