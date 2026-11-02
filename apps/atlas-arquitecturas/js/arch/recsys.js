/* =============================================================================
   Atlas de Arquitecturas — js/arch/recsys.js
   Modelos `two-tower` (página `two-tower`) y `dlrm` (página `dlrm`); contrato SPEC §25.1–25.2. Tesis: recomendar es un embudo
   (recuperar millones → rankear cientos → re-rankear decenas) y casi todos los parámetros son TABLAS de embeddings: leer filas
   (memoria, acceso aleatorio) en vez de multiplicar matrices. Cargar DESPUÉS de llm.js (hardware H100 de las cotas ≈).
   Cross-check: crosscheck/recsys.py — módulos de PyTorch construidos en código desde estas configs en el dispositivo META
   (nn.EmbeddingBag, nn.Linear, bmm; LowRankCrossNet de torchrec reescrito con sus mismas fórmulas): parámetros por módulo,
   FLOPs (FlopCounterMode) y formas por hooks, exactos.

   No hay UN checkpoint oficial: son configs de REFERENCIA documentadas y reproducibles (cada número dice de dónde sale).

   ---------------------------------------------------------------- convenciones
   Formas SIN batch: un ejemplo (two-tower: un par usuario–ítem; dlrm: una muestra). B solo en los tensores del lote (in-batch
   softmax) y en metrics. MACs = matmuls (FLOPs = 2·MACs = FlopCounterMode). Leer y sumar filas de embedding (EmbeddingBag),
   ReLU, sigmoide, normalizar, sesgo de DCN: "otros" (≈) + métricas de BYTES (lo que de verdad cuesta). Bytes decimales.
   Símbolos: d_id (ancho de los ids), n_hist (historial), d_c (16, categóricas chicas), d_user / d_item (entradas de las torres),
   dim (u, v), B, N_items, k · n_d (13 densas), n_s (26 categóricas), d (embedding de DLRM), n_s+1 (27 vectores), n_pairs
   (n(n−1)/2 = 351), r (rango de DCN v2), L_hot (lookups multi-hot por muestra).
   mod de los tensores: usuario 'qry', ítem 'txt', densas 'lat', ids / embeddings de DLRM 'txt', matrices B×B y n×n 'mat'.

   ---------------------------------------------------------------- modelo `two-tower` (configs two-tower-base [canónica], -small, -no-ids)
   Referencia (elección de esta config, en el espíritu de Yi et al., RecSys 2019, y Covington et al., RecSys 2016): torre de usuario
   = user-id con hashing (idBuckets × d_id) + promedio de los últimos n_hist ítems vistos (tabla de ítems COMPARTIDA con la torre de
   ítems, N_items × d_id) + 4 categóricas (país 250, idioma 100, dispositivo 8, hora 24; × 16) → concat (d_user = 192) → MLP
   256-128-dim (ReLU entre capas) → normalizar L2. Torre de ítem = item-id (la tabla compartida) + 4 categóricas (categoría 1,000,
   idioma 100, duración 32 buckets, antigüedad 64 buckets; × 16) → concat (d_item = 128) → MLP 256-128-dim → L2. Puntaje u·v.
   Entrenamiento: softmax in-batch (los B − 1 ítems del lote son los negativos) con temperatura y corrección −log Q(j) (Yi et al.).
   Servir: los N_items vectores v se precalculan (índice) y la búsqueda es u·V (fuerza bruta aquí; ANN en #ann).
   two-tower-base: idBuckets 10M, N_items 2M, d_id 64, n_hist 50, dim 64, B 4,096, k 500. two-tower-small: idBuckets 1M,
   N_items 100k. two-tower-no-ids: sin user-id, sin item-id y sin historial (solo features: arranque en frío).
   Knobs: B, dim, nItems, hist (0 = sin historial), idBuckets, idDim (añadido), k (añadido).
   Vista `two-tower-overview` — nodos: user-tower › {id-embed, hist-embed, cat-embed, concat, mlp › {fc1, relu1, fc2, relu2, fc3},
   normalize}, item-tower › {id-embed, cat-embed, concat, mlp › …, normalize}, score, inbatch-softmax › {stack-u, stack-v, logits,
   logq, loss}, item-index, retrieve › {scan, topk}. Ops → tensores: user-id-embed → u-id-emb · hist-embed → u-hist-emb ·
   user-cat-embed → u-cat-emb · user-concat → u-in · user-fc1/relu1/fc2/relu2/fc3 → u-h1/u-a1/u-h2/u-a2/u-h3 · user-norm → u ·
   item-id-embed → v-id-emb · item-cat-embed → v-cat-emb · item-concat → v-in · item-fc1 … item-fc3 → v-h1 … v-h3 · item-norm → v ·
   score → score · user-stack → U · item-stack → V · inbatch-logits → logits (por par B·dim MACs, lote B²·dim) · logq →
   logits-corrected · inbatch-loss → loss · item-index → index · retrieve-scan → item-scores · retrieve-topk → topk-ids.
   Entradas: user-id, hist-ids, user-cat-ids, item-id, item-cat-ids, item-logq.
   La tabla de ítems COMPARTIDA: sus parámetros los cuenta item-id-embed; hist-embed la reusa (paramRepeat 0).
   totals = lo dibujado: un par (torres + puntaje), una fila del lote (in-batch) y UNA consulta contra el índice (fuerza bruta).

   ---------------------------------------------------------------- modelo `dlrm` (configs dlrm-criteo-kaggle [canónica], dlrm-mlperf, dlrm-dcnv2, wide-and-deep)
   dlrm-criteo-kaggle: facebookresearch/dlrm, bench/dlrm_s_criteo_kaggle.sh: --arch-sparse-feature-size=16 --arch-mlp-bot=13-512-256-64-16
     --arch-mlp-top=512-256-1, interacción dot (default de dlrm_s_pytorch.py; arch_interaction_itself = False). 26 tablas con las
     cuentas del Criteo Kaggle procesado por el repo SIN filtrar ids raros (33,762,577 filas; lista citada por Desai et al., ROBE,
     arXiv:2108.02191, §7.5). Entrada del top MLP derivada como el repo (num_int = n(n−1)/2 + d con n = 27): 351 + 16 = 367.
     Todas las capas del bottom MLP con ReLU (sigmoid_bot = −1); el top MLP termina en sigmoide (sigmoid_top = última capa).
   dlrm-mlperf: bench/run_and_time.sh (referencia MLPerf v0.7–v2.1, Criteo 1TB): --arch-sparse-feature-size=128
     --arch-mlp-bot=13-512-256-128 --arch-mlp-top=1024-1024-512-256-1 --max-ind-range=40000000 (cada tabla se recorta a 40M filas:
     dlrm_s_pytorch.py ln_emb = min(cuenta, max_ind_range)). Cuentas de Criteo 1TB con ese tope: las de --num_embeddings_per_feature
     del README de torchrec_dlrm de MLPerf (training/retired_benchmarks/recommendation_v2), que coinciden con el reparto que
     publica Intel para el benchmark (40M ×5, 3,067,956, 590,152, …). 128 + 351 = 479 entra al top MLP.
   dlrm-dcnv2: MLPerf Training v3.0+ (mismo README, torchrec DLRM_DCN): las mismas 26 tablas y dims, datos MULTI-HOT sintéticos
     (--multi_hot_sizes 3,2,1,2,6,1,1,1,1,7,3,8,1,6,9,5,1,1,1,12,100,27,10,3,1,1 = 214 lookups por muestra, suma), interacción
     LowRankCrossNet (--dcn_num_layers=3 --dcn_low_rank_dim=512) sobre (26 + 1)·128 = 3,456 → top MLP 1024-1024-512-256-1
     (OverArch: la última capa sin activación; la sigmoide va en la pérdida: aquí el nodo ctr).
   wide-and-deep: REFERENCIA ilustrativa sobre las mismas tablas de Kaggle (Cheng et al., DLRS 2016, arXiv:1606.07792, §3 y Fig. 4:
     embeddings de 32 por categórica, concatenados con las densas → ReLU 1024-512-256 → logística). Parte wide = un peso por valor
     categórico (26 tablas × filas × 1: regresión logística sobre el one-hot; SIN los productos cruzados a mano del paper); parte
     deep = 26 × 32 ⊕ 13 densas = 845 → 1024-512-256 → 1. logit = wide + deep (el sesgo es el de la última capa del deep).
   Knobs: B (lote: solo métricas), dim (d; el bottom MLP termina en d), maxRows (tope de filas por tabla, como max-ind-range:
   min(filas, maxRows)), bits (precisión GUARDADA de las tablas: 32 / 16 / 8 / 4), k (candidatos rankeados por request).
   Nodos: bottom-mlp › {fc1, relu1, …}, embeddings › lookup, interaction › {stack, dot, tril, concat} (dot) | {stack, flatten,
   cross › {v, w, mix}} (DCN v2, × 3), top-mlp › {fc1, relu1, …, fcN}, ctr; W&D: wide › {lookup, sum}, embeddings › lookup,
   deep-in › {flatten, concat}, top-mlp › …, combine, ctr.
   Ops → tensores: bot-fc<i> → b-h<i> · bot-relu<i> → b-a<i> (el último = bot-out) · emb-lookup → emb (n_s × d) · interact-stack →
   feats · interact-dot → gram · interact-tril → pairs · interact-concat → top-in · interact-flatten → x0 · cross-v → c-low ·
   cross-w → c-up · cross-mix → top-in (× 3) · top-fc<i> → t-h<i> · top-relu<i> → t-a<i> · el último top-fc → logit (W&D: deep-logit) ·
   ctr → ctr · wide-lookup → w-emb · wide-sum → wide-logit · deep-flatten → e-flat · deep-concat → top-in · combine → logit.
   Entradas: dense (13), sparse-ids (26; DCN v2: 214 = L_hot).

   metrics (units en metrics.units): ver la sección de cada modelo abajo (twoTowerMetrics, dlrmMetrics).

   ---------------------------------------------------------------- desviaciones respecto de SPEC §25 (añadidos; nada renombrado)
   - two-tower: knobs añadidos idDim y k; `dim` = dimensión de u y v (la última capa del MLP), no la de las tablas (idDim).
   - two-tower: totals incluye la búsqueda por fuerza bruta de UNA consulta (N_items·dim MACs) como retrieval.js; metrics separa
     userTowerMacs / itemTowerMacs / bruteForceMacs.
   - dlrm: la interacción dot cuenta la matriz ENTERA (n²·d MACs, el bmm de la referencia y de FlopCounterMode); los pares útiles
     n(n−1)/2·d van en metrics.interactionMacsUseful.
   - dlrm: arithmeticIntensity sale por partes: las tablas son ≈ 0.25 op/B (memoria pura) pero en Criteo Kaggle / MLPerf el MLP
     domina los FLOPs por muestra y la intensidad TOTAL queda por ENCIMA del punto de quiebre del H100 (584 y 369 vs ≈ 295 FLOP/B);
     DLRM-DCNv2 (214 lookups multi-hot) queda justo EN el punto de quiebre (≈ 293 vs 295: mitad tablas, mitad MLP; con tablas en
     fp16 o MLPs en TF32 cae del lado del cómputo). Supuesto de precisión: las tablas a `bits` (32 por defecto) y los MLPs al pico
     bf16 denso de la H100. `bound` (y los demás *Bound) dicen "≈ en el punto de quiebre" si cómputo y memoria están a ≤ 5 %
     (roof()). embeddingMsShare: qué parte del tiempo ≈ es de las tablas.
   - Las cotas de samples/s son de roofline IDEAL (1 GPU, sin all-to-all de las tablas repartidas, sin el costo real de los gathers
     aleatorios de filas de 64–512 B): quedan órdenes de magnitud por encima de lo medido. Número medido citable (A.recsys.measured):
     README de torchrec_dlrm de MLPerf — DLRM sobre Criteo 1TB (d 128, 13-512-256-128, 1024-1024-512-256-1), 8 × A100 40 GB,
     lote global 16,384: ≈ 1,671,168 registros/s de ENTRENAMIENTO (43 min por época) = 208,896 por GPU, con las tablas SIN tope
     (91.10 GiB en total), no las de 40M filas de dlrm-mlperf (97.4 GiB). La comparación justa es de ENTRENAMIENTO con la arquitectura
     de MLPerf: metrics de dlrm-mlperf trainSamplesPerSecH100 (≈ 67.0M/s) y trainSamplesPerSecA100 (misma cota en una A100 40 GB),
     measuredTrainPerGpu (208,896) y trainCeilingVsMeasuredH100 / …A100 (≈ 320× y ≈ 100×: 2.5 y 2 órdenes de magnitud); NO la cota
     de inferencia de Kaggle (samplesPerSecH100 de dlrm-criteo-kaggle ≈ 1.02·10⁹/s, ≈ 4,870× lo medido).
   - dlrm-dcnv2 con `dim` chico: si 2r ≥ (n_s + 1)·d el "bajo rango" (2·D·r + D por capa) ya no ahorra frente a la matriz llena
     (D² + D): nota en run() y metrics.crossParamsFullRank para comparar.
   - two-tower: lookups por REQUEST = solo la torre de usuario (user-id + historial + 4 categóricas = 55 filas, 13,312 B en la
     canónica): userLookupsPerRequest / userLookupBytesPerRequest; lookupsPerExample (60) es el PAR de entrenamiento (usuario + ítem).
     userTowerParams cuenta su tabla de usuarios y sus categóricas; la tabla de ítems que lee para el historial se cuenta en la torre
     de ítem (userTowerParamsWithShared la suma). topkOps ≈ N_items·log₂ k (heap de tamaño k sobre los puntajes).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel || !A.embedding_tables) throw new Error('recsys.js necesita js/arch/primitives.js (fase 13) antes.');
  if (!A.hasConfig || !A.hasConfig('llama3-8b')) throw new Error('recsys.js necesita js/arch/llm.js antes (hardware H100 de las cotas ≈).');
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);

  // ------------------------------------------------------------------ hardware (≈, roofline sin overheads)
  const H100 = Object.assign({ id: 'h100', label: 'H100 SXM' }, A.model('llm').hardware);   // 3.35 TB/s, 989 TFLOPS bf16 denso, 80 GB
  // A100 SXM 40 GB (la GPU de la corrida medida de MLPerf, A.recsys.measured): solo para comparar esa medición con su propia cota.
  const A100 = { id: 'a100-40gb', label: 'A100 SXM 40 GB', peakFlops: 312e12, bandwidth: 1.555e12, hbmBytes: 40e9,
    source: 'NVIDIA A100 Tensor Core GPU datasheet: 312 TFLOPS bf16 denso (Tensor Core), 1,555 GB/s de HBM2 en la versión de 40 GB.' };
  // Cota de roofline: el máximo de cómputo y memoria. Si los dos tiempos están a ≤ 5 % (intensidad ≈ punto de quiebre: DLRM-DCNv2,
  // 293 vs 295 FLOP/B), `bound` lo dice en vez de elegir un lado por menos del 1 %.
  const TIE = 0.05;
  const roof = (flops, bytes, hw) => {
    const tc = flops / hw.peakFlops, tm = bytes / hw.bandwidth;
    const tie = tc > 0 && tm > 0 && Math.abs(tc / tm - 1) <= TIE;
    return { ms: 1000 * Math.max(tc, tm), bound: tie ? '≈ en el punto de quiebre' : tc >= tm ? 'cómputo' : 'memoria', computeMs: 1000 * tc, memoryMs: 1000 * tm };
  };
  const pathOf = (r, key) => r.totals.byPath[key] || { params: 0, macs: 0, other: 0 };
  const nodeOf = (r, id) => r.totals.byNode[id] || { params: 0, macs: 0, other: 0 };
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  // Una pila de capas Linear (+ ReLU entre capas). sizes = [d_in, h1, …, d_out]. lastAct: ReLU también después de la última
  // (bottom MLP de DLRM). o = {pre (prefijo de ids de op), tpre (de tensores), path, where, mod, outId, outSym, outMeta, label}
  function mlpStack(g, x, sizes, o) {
    let h = x;
    const n = sizes.length - 1;
    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const fcOut = last && !o.lastAct ? o.outId : o.tpre + 'h' + i;
      const sym = last ? o.outSym : String(sizes[i]);
      h = g.op(o.pre + 'fc' + i, A.linear(h, { dout: sizes[i], doutSym: sym, mod: o.mod }), {
        path: o.path.concat(['fc' + i]), out: fcOut, where: o.where, label: o.label + ': Linear ' + sizes[i - 1] + ' → ' + sizes[i], type: 'mlp', group: 'mlp',
        outMeta: last && !o.lastAct ? o.outMeta : { label: o.label + ' · capa ' + i + ' (antes de ReLU)', tex: 'W_' + i + 'h + b_' + i },
      });
      if (!last || o.lastAct) {
        h = g.op(o.pre + 'relu' + i, A.relu(h), {
          path: o.path.concat(['relu' + i]), out: last ? o.outId : o.tpre + 'a' + i, where: o.where, label: o.label + ': ReLU', type: 'act', group: 'mlp',
          outMeta: last ? o.outMeta : { label: o.label + ' · capa ' + i, tex: 'a_' + i },
        });
      }
    }
    return h;
  }

  // ==================================================================== modelo `two-tower`
  const USER_CATS = [{ id: 'country', label: 'país', rows: 250 }, { id: 'language', label: 'idioma', rows: 100 }, { id: 'device', label: 'dispositivo', rows: 8 }, { id: 'hour', label: 'hora del día', rows: 24 }];
  const ITEM_CATS = [{ id: 'category', label: 'categoría', rows: 1000 }, { id: 'language', label: 'idioma', rows: 100 }, { id: 'duration', label: 'duración (bucket)', rows: 32 }, { id: 'age', label: 'antigüedad (bucket)', rows: 64 }];
  const TT_SRC = 'Configuración de REFERENCIA de esta página (no hay un checkpoint oficial): torres como Yi et al., Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations, RecSys 2019 (doi:10.1145/3298689.3346996): ids + features → MLP → embedding normalizado, softmax in-batch con corrección log Q. Tamaños de tablas, MLP 256-128-64 y B elegidos aquí (verifica antes de citarlos como de un sistema real).';
  const TT_BASE = { idBuckets: 10000000, nItems: 2000000, idDim: 64, catDim: 16, hist: 50, dim: 64, mlp: [256, 128], B: 4096, k: 500, ids: 1, tau: 0.05,
    userCats: USER_CATS, itemCats: ITEM_CATS };
  const TT_CONFIGS = {
    'two-tower-base': Object.assign({}, TT_BASE, { label: 'Two-tower (ids + features, MLP 256-128-64, 64-d)', canonical: true,
      source: TT_SRC + ' user-id con hashing en 10M buckets, 2M ítems, historial de 50, B = 4,096.' }),
    'two-tower-small': Object.assign({}, TT_BASE, { label: 'Two-tower chico (1M buckets de usuario, 100k ítems)', idBuckets: 1000000, nItems: 100000,
      source: TT_SRC + ' Igual que two-tower-base con 1M buckets de usuario y 100k ítems: las tablas se achican, las torres no.' }),
    'two-tower-no-ids': Object.assign({}, TT_BASE, { label: 'Two-tower solo features (sin ids: arranque en frío)', ids: 0, hist: 0,
      source: TT_SRC + ' Sin user-id, sin item-id y sin historial: solo las 4 + 4 categóricas. Generaliza a usuarios e ítems nuevos; pierde la memoria por id.' }),
  };

  function ttApplyKnobs(c, ov) {
    Object.assign(c, ov);
    const ks = Object.keys(ov);
    if (ks.length) c._notes = ks.map((k) => k + ' = ' + ov[k] + ' (what-if)');
    if (!c.ids && (ov.idBuckets !== undefined || ov.idDim !== undefined || ov.hist)) (c._notes = c._notes || []).push('esta config no usa ids: idBuckets, idDim e hist no cambian nada');
    return c;
  }
  function ttResolve(c) {
    const W = 'Two-tower: ';
    if (!c.ids) c.hist = 0;
    if (c.k > c.nItems) throw new Error(W + 'k = ' + c.k + ' candidatos y solo hay N_items = ' + c.nItems + ' ítems.');
    if (c.dim > c.mlp[c.mlp.length - 1] * 4) throw new Error(W + 'dim = ' + c.dim + ' es mayor que 4 × la capa anterior del MLP (' + c.mlp[c.mlp.length - 1] + ').');
    c.userCatWidth = c.userCats.length * c.catDim;
    c.itemCatWidth = c.itemCats.length * c.catDim;
    c.dUser = (c.ids ? c.idDim + (c.hist ? c.idDim : 0) : 0) + c.userCatWidth;
    c.dItem = (c.ids ? c.idDim : 0) + c.itemCatWidth;
    return c;
  }

  function ttBuild(c) {
    const g = A.graph(c);
    const UT = ['user-tower'], IT = ['item-tower'], WU = ['Torre de usuario'], WI = ['Torre de ítem'];
    const uparts = [], vparts = [];
    // ---- torre de usuario
    if (c.ids) {
      const uid = g.input('user-id', shp(['1'], [1], 'qry', 'vec'), { label: 'Id del usuario (hashing a idBuckets)', tex: 'i' });
      uparts.push(g.op('user-id-embed', A.embedding_bag(uid, { rows: c.idBuckets, rowsSym: 'n_buckets', D: c.idDim, Dsym: 'd_id', mod: 'qry' }), {
        path: UT.concat(['id-embed']), out: 'u-id-emb', where: WU, label: 'Embedding del user-id (' + fint(c.idBuckets) + ' buckets × d_id)', type: 'embed', group: 'embed',
        outMeta: { label: 'Usuario · embedding de su id', tex: 'E_{\\mathrm{user}}[h(i)]' } }));
      if (c.hist) {
        const hid = g.input('hist-ids', shp(['n_hist'], [c.hist], 'qry', 'vec'), { label: 'Últimos n_hist ítems vistos (ids)', tex: 'j_1, …, j_{n}' });
        uparts.push(g.op('hist-embed', A.embedding_bag(hid, { rows: c.nItems, rowsSym: 'N_items', D: c.idDim, Dsym: 'd_id', mode: 'mean', mod: 'qry' }), {
          path: UT.concat(['hist-embed']), out: 'u-hist-emb', where: WU, paramRepeat: 0, label: 'Promedio de los embeddings del historial (tabla de ítems COMPARTIDA: sin parámetros nuevos)', type: 'embed', group: 'embed',
          outMeta: { label: 'Usuario · promedio de lo que vio', tex: '\\tfrac{1}{n}\\sum E_{\\mathrm{item}}[j_t]' } }));
      }
    }
    const ucat = g.input('user-cat-ids', shp([String(c.userCats.length)], [c.userCats.length], 'qry', 'vec'), { label: 'Ids de las categóricas del usuario (' + c.userCats.map((x) => x.label).join(', ') + ')', tex: 'c_i' });
    uparts.push(g.op('user-cat-embed', A.embedding_tables(ucat, { rows: c.userCats.map((x) => x.rows), D: c.catDim, Dsym: 'd_c', concat: true, outSym: c.userCats.length + '·d_c', mod: 'qry' }), {
      path: UT.concat(['cat-embed']), out: 'u-cat-emb', where: WU, label: 'Embeddings de las ' + c.userCats.length + ' categóricas del usuario (' + c.userCats.map((x) => x.label + ' ' + fint(x.rows)).join(', ') + '; × ' + c.catDim + ')', type: 'embed', group: 'embed',
      outMeta: { label: 'Usuario · categóricas concatenadas', tex: '[E_c(c_i)]' } }));
    // ---- torre de ítem: item-id-embed es el dueño de la tabla compartida (el historial de arriba la reusa con paramRepeat 0)
    if (c.ids) {
      const iid = g.input('item-id', shp(['1'], [1], 'txt', 'vec'), { label: 'Id del ítem', tex: 'j' });
      vparts.push(g.op('item-id-embed', A.embedding_bag(iid, { rows: c.nItems, rowsSym: 'N_items', D: c.idDim, Dsym: 'd_id', mod: 'txt' }), {
        path: IT.concat(['id-embed']), out: 'v-id-emb', where: WI, label: 'Embedding del item-id (tabla N_items × d_id, compartida con el historial)', type: 'embed', group: 'embed',
        outMeta: { label: 'Ítem · embedding de su id', tex: 'E_{\\mathrm{item}}[j]' } }));
    }
    const icat = g.input('item-cat-ids', shp([String(c.itemCats.length)], [c.itemCats.length], 'txt', 'vec'), { label: 'Ids de las categóricas del ítem (' + c.itemCats.map((x) => x.label).join(', ') + ')', tex: 'c_j' });
    vparts.push(g.op('item-cat-embed', A.embedding_tables(icat, { rows: c.itemCats.map((x) => x.rows), D: c.catDim, Dsym: 'd_c', concat: true, outSym: c.itemCats.length + '·d_c', mod: 'txt' }), {
      path: IT.concat(['cat-embed']), out: 'v-cat-emb', where: WI, label: 'Embeddings de las ' + c.itemCats.length + ' categóricas del ítem (' + c.itemCats.map((x) => x.label + ' ' + fint(x.rows)).join(', ') + '; × ' + c.catDim + ')', type: 'embed', group: 'embed',
      outMeta: { label: 'Ítem · categóricas concatenadas', tex: '[E_c(c_j)]' } }));
    const tower = (side, parts) => {
      const u = side === 'u', P = u ? UT : IT, W = u ? WU : WI, pre = u ? 'user-' : 'item-', tp = u ? 'u-' : 'v-';
      const inp = g.op(pre + 'concat', A.concat_features(parts, { sym: u ? 'd_user' : 'd_item', mod: u ? 'qry' : 'txt' }), {
        path: P.concat(['concat']), out: tp + 'in', where: W, label: 'Concatenar (' + parts.map((p) => p.num[0]).join(' + ') + ' = ' + sum(parts.map((p) => p.num[0])) + ')', type: 'tensorop', group: 'embed',
        outMeta: { label: (u ? 'Usuario' : 'Ítem') + ' · entrada del MLP', tex: u ? 'x_u' : 'x_v' } });
      const top = mlpStack(g, inp, [u ? c.dUser : c.dItem].concat(c.mlp, [c.dim]), { pre, tpre: tp, path: P.concat(['mlp']), where: W.concat(['MLP']), mod: u ? 'qry' : 'txt',
        outId: tp + 'h' + (c.mlp.length + 1), outSym: 'dim', label: (u ? 'Torre de usuario' : 'Torre de ítem'),
        outMeta: { label: (u ? 'Usuario' : 'Ítem') + ' · salida del MLP (sin normalizar)', tex: u ? 'f(x_u)' : 'g(x_v)' } });
      return g.op(pre + 'norm', A.l2_normalize(top), { path: P.concat(['normalize']), out: u ? 'u' : 'v', where: W, label: 'Normalizar (‖·‖ = 1: u·v = coseno)', type: 'norm', group: 'head',
        outMeta: { label: u ? 'Embedding del usuario u' : 'Embedding del ítem v', tex: u ? 'u' : 'v' } });
    };
    const u = tower('u', uparts);
    const v = tower('v', vparts);
    g.op('score', A.dot_score(u, v, { metric: 'cos' }), { path: ['score'], out: 'score', where: ['Puntaje'], label: 'Puntaje del par: u·v (coseno)', type: 'attn', group: 'head',
      outMeta: { label: 'Puntaje usuario–ítem', tex: 's(i, j) = u\\cdot v' } });
    // ---- entrenamiento: softmax in-batch (el lote de B pares; contado POR PAR: una fila de la matriz, como CLIP)
    const WB = ['Softmax in-batch (entrenamiento)'];
    const U = g.op('user-stack', A.stack_batch(u, { B: c.B }), { path: ['inbatch-softmax', 'stack-u'], out: 'U', where: WB, label: 'Lote de B usuarios', type: 'tensorop', group: 'head', batched: true,
      outMeta: { label: 'Embeddings de usuario del lote', tex: 'U \\in \\mathbb{R}^{B\\times dim}', batched: true } });
    const V = g.op('item-stack', A.stack_batch(v, { B: c.B }), { path: ['inbatch-softmax', 'stack-v'], out: 'V', where: WB, label: 'Lote de B ítems (los positivos de cada usuario)', type: 'tensorop', group: 'head', batched: true,
      outMeta: { label: 'Embeddings de ítem del lote', tex: 'V \\in \\mathbb{R}^{B\\times dim}', batched: true } });
    const lres = A.similarity_logits(U, V);
    const batchMacs = lres.macs;
    lres.macs = c.B * c.dim;
    lres.macArith = c.B + '·' + c.dim + ' = ' + fint(lres.macs);
    lres.detail = Object.assign({}, lres.detail, { batchMacs, perPair: true, note: 'B²·dim para el lote; B·dim por par (una fila de la matriz)' });
    const lg = g.op('inbatch-logits', lres, { path: ['inbatch-softmax', 'logits'], out: 'logits', where: WB, label: 'Logits UVᵀ (B×B): la diagonal son los positivos', type: 'fuse', group: 'head', batched: true,
      outMeta: { label: 'Logits del lote (fila = usuario, columna = ítem)', tex: 'UV^\\top', batched: true } });
    const lq = g.input('item-logq', shp(['B'], [c.B], 'txt', 'vec'), { label: 'log Q(j): log de la probabilidad de muestreo de cada ítem del lote (≈ su popularidad)', tex: '\\log Q(j)', batched: true });
    const lc = g.op('logq', A.logq_correct(lg, lq, { tau: c.tau }), {
      path: ['inbatch-softmax', 'logq'], out: 'logits-corrected', where: WB, label: 'Temperatura y corrección: s/τ − log Q(j)', type: 'head', group: 'head', batched: true,
      outMeta: { label: 'Logits corregidos', tex: 's_{ij}/\\tau - \\log Q(j)', batched: true } });
    const ce = A.cross_entropy(lc, lc, { rows: c.B });
    ce.inputs = [lc];
    g.op('inbatch-loss', ce, { path: ['inbatch-softmax', 'loss'], in: ['logits-corrected'], out: 'loss', where: WB, label: 'Softmax por fila + cross-entropy (etiqueta = la diagonal)', type: 'loss', group: 'head', batched: true,
      outMeta: { label: 'Pérdida in-batch del lote', tex: '-\\tfrac1B\\sum_i \\log \\mathrm{softmax}_i(\\cdot)_{ii}', batched: true } });
    // ---- servir: índice de ítems (offline) y búsqueda de una consulta (fuerza bruta)
    const idx = g.op('item-index', A.embed_index(v, { N: c.nItems, Nsym: 'N_items', bits: 32 }), { path: ['item-index'], out: 'index', where: ['Índice de ítems (offline)'],
      label: 'Guardar los N_items vectores v (offline; ANN en #ann)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Índice: un vector por ítem', tex: 'V_{\\mathrm{all}} \\in \\mathbb{R}^{N_{\\mathrm{items}}\\times dim}' } });
    const sc = g.op('retrieve-scan', A.dot_score(u, idx, { metric: 'cos' }), { path: ['retrieve', 'scan'], out: 'item-scores', where: ['Recuperación (online)'],
      label: 'u contra los N_items vectores (fuerza bruta; un índice ANN la hace sublineal)', type: 'attn', group: 'head',
      outMeta: { label: 'Puntaje de cada ítem para este usuario', tex: 'V_{\\mathrm{all}}\\,u' } });
    g.op('retrieve-topk', A.topk_scores(sc, { k: c.k }), { path: ['retrieve', 'topk'], out: 'topk-ids', where: ['Recuperación (online)'], label: 'Top-k candidatos para el ranking', type: 'tensorop', group: 'head',
      outMeta: { label: 'Los k candidatos (van al modelo de ranking)', tex: '\\mathrm{top}\\text{-}k' } });
    return g;
  }

  function ttParts(c, r) {
    const ops = r.ops;
    const embOps = ops.filter((o) => o.prim === 'embedding_bag' || o.prim === 'embedding_tables');
    const embParams = sum(embOps.map((o) => o.params * A.paramRep(o)));
    const lookups = sum(embOps.map((o) => o.detail.lookups));
    // Lo que lee UN request: solo la torre de usuario (user-id, historial, categóricas); fp32.
    const userOps = embOps.filter((o) => ['user-id-embed', 'hist-embed', 'user-cat-embed'].indexOf(o.id) >= 0);
    const userLookups = sum(userOps.map((o) => o.detail.lookups)), userLookupBytes = sum(userOps.map((o) => o.detail.lookups * o.detail.D * 4));
    const userTower = pathOf(r, 'user-tower'), itemTower = pathOf(r, 'item-tower');
    const mlpParams = pathOf(r, 'user-tower>mlp').params + pathOf(r, 'item-tower>mlp').params;
    return {
      embParams, mlpParams, lookups, userLookups, userLookupBytes,
      userTowerMacs: userTower.macs, itemTowerMacs: itemTower.macs, userTowerParams: userTower.params, itemTowerParams: itemTower.params,
      idTableParams: c.ids ? c.idBuckets * c.idDim + c.nItems * c.idDim : 0,
      userIdParams: c.ids ? c.idBuckets * c.idDim : 0, itemIdParams: c.ids ? c.nItems * c.idDim : 0,
      catParams: sum(c.userCats.map((x) => x.rows)) * c.catDim + sum(c.itemCats.map((x) => x.rows)) * c.catDim,
    };
  }

  function ttQuantities(c, r) {
    const p = ttParts(c, r);
    return {
      B: c.B, dim: c.dim, nItems: c.nItems, hist: c.hist, idBuckets: c.ids ? c.idBuckets : 0, idDim: c.ids ? c.idDim : 0, k: c.k, catDim: c.catDim,
      dUser: c.dUser, dItem: c.dItem, embeddingParams: p.embParams, mlpParams: p.mlpParams, userTowerMacs: p.userTowerMacs, itemTowerMacs: p.itemTowerMacs,
      userTowerParams: p.userTowerParams, itemTowerParams: p.itemTowerParams, lookupsPerExample: p.lookups, embeddingParamsShare: p.embParams / r.totals.params,
      inBatchLogitsMacs: c.B * c.B * c.dim, bruteForceMacs: c.nItems * c.dim, indexBytes: c.nItems * c.dim * 4,
    };
  }

  function ttMetrics(c, r, o) {
    const p = ttParts(c, r), t = r.totals;
    const B = c.B;
    // Lookups por ejemplo: filas leídas (user-id 1 + historial n_hist + 4 categóricas por lado + item-id 1), cada una con su ancho; fp32.
    const rowsBytes = r.ops.filter((x) => x.prim === 'embedding_bag' || x.prim === 'embedding_tables').reduce((s, x) => s + x.detail.lookups * x.detail.D * 4, 0);
    const towersMacs = p.userTowerMacs + p.itemTowerMacs;
    const inBatch = B * B * c.dim;
    // Paso de entrenamiento ≈ 3 × forward (backward = 2 × forward) del lote: B pares por las torres + la matriz B×B.
    const trainStepMacs = 3 * (B * towersMacs + inBatch);
    const step = roof(2 * trainStepMacs, B * rowsBytes * 3 + 2 * 2 * p.mlpParams, H100);
    // Catálogo offline: los pesos del MLP de ítem una vez (bf16) + leer TODA la tabla de ítems y sus categóricas una vez (fp32).
    const itemMlp = pathOf(r, 'item-tower>mlp').params;
    const corpus = roof(2 * c.nItems * p.itemTowerMacs, 2 * itemMlp + 4 * (p.itemTowerParams - itemMlp), H100);
    const scan = roof(2 * c.nItems * c.dim, c.nItems * c.dim * 4, H100);
    // Un request: las filas de la torre de USUARIO (no las del ítem) + los pesos de su MLP en bf16.
    const userQ = roof(2 * p.userTowerMacs, p.userLookups ? p.userLookupBytes + 2 * pathOf(r, 'user-tower>mlp').params : 2 * pathOf(r, 'user-tower>mlp').params, H100);
    const out = {
      B, dim: c.dim, nItems: c.nItems, hist: c.hist, k: c.k, idBuckets: c.ids ? c.idBuckets : 0, idDim: c.ids ? c.idDim : 0,
      embeddingParams: p.embParams, mlpParams: p.mlpParams, otherParams: t.params - p.embParams - p.mlpParams, embeddingParamsShare: p.embParams / t.params, mlpParamsShare: p.mlpParams / t.params,
      userIdParams: p.userIdParams, itemIdParams: p.itemIdParams, categoricalParams: p.catParams,
      embeddingBytes: p.embParams * 4, embeddingBytes16: p.embParams * 2, mlpBytes: p.mlpParams * 4,
      userTowerMacs: p.userTowerMacs, itemTowerMacs: p.itemTowerMacs, userTowerParams: p.userTowerParams, itemTowerParams: p.itemTowerParams,
      towersMacsPerPair: towersMacs, scoreMacs: c.dim,
      inBatchLogitsMacs: inBatch, inBatchLogitsMacsPerPair: B * c.dim, inBatchNegatives: B - 1, inBatchLogitsShare: inBatch / (B * towersMacs + inBatch),
      lookupsPerExample: p.lookups, lookupBytesPerExample: rowsBytes,
      userLookupsPerRequest: p.userLookups, userLookupBytesPerRequest: p.userLookupBytes,
      userTowerParamsWithShared: p.userTowerParams + (c.hist ? p.itemIdParams : 0),
      topkOps: Math.round(c.nItems * Math.log2(c.k)),
      trainStepMacs, trainStepMsH100: step.ms, trainStepBound: step.bound,
      indexBytes: c.nItems * c.dim * 4, indexBytes16: c.nItems * c.dim * 2, itemCorpusMacs: c.nItems * p.itemTowerMacs, itemCorpusMsH100: corpus.ms,
      bruteForceMacs: c.nItems * c.dim, bruteForceMsH100: scan.ms, bruteForceBound: scan.bound,
      userEncodeMsH100: userQ.ms, servingMacsPerRequest: p.userTowerMacs + c.nItems * c.dim, servingMsH100: userQ.ms + scan.ms,
      bruteForceShareServing: (c.nItems * c.dim) / (p.userTowerMacs + c.nItems * c.dim),
      bandwidth: H100.bandwidth, peakFlops: H100.peakFlops, hardwareSource: H100.source,
      units: TT_UNITS,
    };
    const arch = {};
    Object.keys(r.overrides || {}).forEach((x) => { if (x in A.model('two-tower').knobs) arch[x] = r.overrides[x]; });
    out.bScaling = [256, 1024, 4096, 16384].map((b) => ({ B: b, inBatchLogitsMacs: b * b * c.dim, towersMacs: b * towersMacs, inBatchLogitsShare: b * b * c.dim / (b * towersMacs + b * b * c.dim) }));
    out.nItemsScaling = [100000, 1000000, 10000000, 100000000].map((n) => ({ nItems: n, indexBytes: n * c.dim * 4, bruteForceMacs: n * c.dim, itemTableBytes: c.ids ? n * c.idDim * 4 : 0 }));
    return out;
  }
  const TT_UNITS = {
    B: 'count', dim: 'count', nItems: 'count', hist: 'count', k: 'count', idBuckets: 'count', idDim: 'count',
    embeddingParams: 'params', mlpParams: 'params', otherParams: 'params', embeddingParamsShare: 'pct', mlpParamsShare: 'pct', userIdParams: 'params', itemIdParams: 'params', categoricalParams: 'params',
    embeddingBytes: 'bytes', embeddingBytes16: 'bytes', mlpBytes: 'bytes', userTowerMacs: 'macs', itemTowerMacs: 'macs', userTowerParams: 'params', itemTowerParams: 'params',
    towersMacsPerPair: 'macs', scoreMacs: 'macs', inBatchLogitsMacs: 'macs', inBatchLogitsMacsPerPair: 'macs', inBatchNegatives: 'count', inBatchLogitsShare: 'pct',
    lookupsPerExample: 'count', lookupBytesPerExample: 'bytes', userLookupsPerRequest: 'count', userLookupBytesPerRequest: 'bytes', userTowerParamsWithShared: 'params', topkOps: 'count', trainStepMacs: 'macs', trainStepMsH100: 'ms', indexBytes: 'bytes', indexBytes16: 'bytes',
    itemCorpusMacs: 'macs', itemCorpusMsH100: 'ms', bruteForceMacs: 'macs', bruteForceMsH100: 'ms', userEncodeMsH100: 'ms', servingMacsPerRequest: 'macs', servingMsH100: 'ms',
    bruteForceShareServing: 'pct', bandwidth: 'count', peakFlops: 'count',
  };

  A.defineModel({
    id: 'two-tower',
    label: 'Two-tower (torre de usuario × torre de ítem, softmax in-batch)',
    paper: { title: 'Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations', authors: 'Yi, Yang, Hong, Cheng, Heldt, Kumthekar, Zhao, Wei y Chi', venue: 'RecSys 2019', year: 2019,
      url: 'https://doi.org/10.1145/3298689.3346996',
      note: 'Covington, Adams y Sargin, Deep Neural Networks for YouTube Recommendations, RecSys 2016 (doi:10.1145/2959100.2959190). DSSM: Huang et al., CIKM 2013. In-batch negatives: ver #retrieval (DPR) y #clip.' },
    configs: TT_CONFIGS,
    knobs: { B: [256, 1024, 4096, 16384], dim: [16, 32, 64, 128, 256], nItems: [100000, 1000000, 2000000, 10000000, 100000000], hist: [0, 10, 20, 50, 100],
      idBuckets: [100000, 1000000, 10000000, 100000000], idDim: [16, 32, 64, 128], k: [100, 500, 1000] },
    zeroKnobs: ['hist'],
    hardware: Object.assign({}, H100),
    applyKnobs: ttApplyKnobs,
    resolve: ttResolve,
    build: ttBuild,
    quantities: ttQuantities,
    metrics: ttMetrics,
  });

  // ==================================================================== modelo `dlrm`
  // Lo medido citable (ENTRENAMIENTO, arquitectura de dlrm-mlperf pero con las tablas de Criteo 1TB SIN tope).
  const MEASURED = { trainRecordsPerSec: 1671168, gpus: 8, gpu: 'A100 40GB', globalBatch: 16384, perGpu: 1671168 / 8, tablesGiB: 91.10,
    source: 'mlcommons/training, recommendation_v2/torchrec_dlrm/README (Preliminary Training Results: 8 GPUs, lote 2048 × 8, lr 15). Entrenamiento en A100 (no H100), con las tablas de Criteo 1TB SIN tope (91.10 GiB en total), no las de 40M filas de dlrm-mlperf (97.4 GiB).' };
  // Criteo Kaggle (Display Advertising Challenge) procesado por facebookresearch/dlrm (sin filtrar ids raros): filas por feature
  // C1 … C26 (Desai et al., ROBE, arXiv:2108.02191, §7.5). Suma 33,762,577.
  const KAGGLE_ROWS = [1460, 583, 10131227, 2202608, 305, 24, 12517, 633, 3, 93145, 5683, 8351593, 3194, 27, 14992, 5461306, 10, 5652, 2173, 4, 7046547, 18, 15, 286181, 105, 142572];
  // Criteo 1TB con el tope de 40M filas (max-ind-range = 40,000,000): --num_embeddings_per_feature del README de torchrec_dlrm
  // (MLPerf training, recommendation_v2). Suma 204,184,588.
  const TB_ROWS = [40000000, 39060, 17295, 7424, 20265, 3, 7122, 1543, 63, 40000000, 3067956, 405282, 10, 2209, 11938, 155, 4, 976, 14, 40000000, 40000000, 40000000, 590152, 12973, 108, 36];
  // Multi-hot sintético de MLPerf v3.0+ (--multi_hot_sizes): ids por feature y muestra; suma 214.
  const DCN_HOTS = [3, 2, 1, 2, 6, 1, 1, 1, 1, 7, 3, 8, 1, 6, 9, 5, 1, 1, 1, 12, 100, 27, 10, 3, 1, 1];
  const DLRM_REPO = 'Naumov et al., Deep Learning Recommendation Model for Personalization and Recommendation Systems, arXiv:1906.00091; código facebookresearch/dlrm (dlrm_s_pytorch.py). ';
  const DLRM_CONFIGS = {
    'dlrm-criteo-kaggle': { label: 'DLRM · Criteo Kaggle (d = 16, bottom 13-512-256-64-16, top 512-256-1)', canonical: true, arch: 'dot',
      nDense: 13, rows: KAGGLE_ROWS, dim: 16, bottom: [512, 256, 64], top: [512, 256], bits: 32, B: 128, k: 500, maxRows: 0,
      source: DLRM_REPO + 'bench/dlrm_s_criteo_kaggle.sh: --arch-sparse-feature-size=16 --arch-mlp-bot="13-512-256-64-16" --arch-mlp-top="512-256-1" --mini-batch-size=128; interacción dot (default), top MLP con entrada derivada n(n−1)/2 + d = 367. Tablas: cuentas del Criteo Kaggle procesado por el repo (33,762,577 filas; Desai et al., arXiv:2108.02191, §7.5).' },
    'dlrm-mlperf': { label: 'DLRM · MLPerf (Criteo 1TB, d = 128, tablas ≤ 40M filas)', arch: 'dot',
      nDense: 13, rows: TB_ROWS, dim: 128, bottom: [512, 256], top: [1024, 1024, 512, 256], bits: 32, B: 2048, k: 500, maxRows: 0,
      source: DLRM_REPO + 'bench/run_and_time.sh (referencia de MLPerf v0.7–v2.1): --arch-sparse-feature-size=128 --arch-mlp-bot="13-512-256-128" --arch-mlp-top="1024-1024-512-256-1" --max-ind-range=40000000 --mini-batch-size=2048. Cuentas de Criteo 1TB con el tope de 40M: README de torchrec_dlrm de MLPerf (recommendation_v2).' },
    'dlrm-dcnv2': { label: 'DLRM-DCNv2 · MLPerf v3.0+ (multi-hot, 3 capas de cruce de rango 512)', arch: 'dcn',
      nDense: 13, rows: TB_ROWS, hots: DCN_HOTS, dim: 128, bottom: [512, 256], top: [1024, 1024, 512, 256], crossLayers: 3, rank: 512, bits: 32, B: 65536, k: 500, maxRows: 0,
      source: 'MLPerf Training v3.0+ (mlcommons/training, recommendation_v2/torchrec_dlrm, README): DLRM_DCN de torchrec con --embedding_dim 128 --dense_arch_layer_sizes 512,256,128 --over_arch_layer_sizes 1024,1024,512,256,1 --interaction_type=dcn --dcn_num_layers=3 --dcn_low_rank_dim=512 --multi_hot_sizes 3,2,1,2,6,…,1 (214 por muestra), lote global 65,536. LowRankCrossNet: x_{l+1} = x_0 ⊙ (W_l(V_l x_l) + b_l) + x_l. DCN v2: Wang et al., WWW 2021, arXiv:2008.13535.' },
    'wide-and-deep': { label: 'Wide & Deep (referencia sobre Criteo Kaggle: wide lineal + deep 1024-512-256)', arch: 'wd',
      nDense: 13, rows: KAGGLE_ROWS, dim: 32, bottom: [], top: [1024, 512, 256], bits: 32, B: 128, k: 500, maxRows: 0,
      source: 'Cheng et al., Wide & Deep Learning for Recommender Systems, DLRS 2016, arXiv:1606.07792 (§3, Fig. 4: embeddings de 32 por categórica concatenados con las densas → ReLU 1024-512-256 → unidad logística; logit = wide + deep). REFERENCIA de esta página sobre las tablas de Criteo Kaggle: la parte wide es un peso por valor categórico (sin los productos cruzados que el paper arma a mano).' },
  };

  function dlrmApplyKnobs(c, ov) {
    Object.assign(c, ov);
    const ks = Object.keys(ov);
    if (ks.length) c._notes = ks.map((k) => k + ' = ' + ov[k] + ' (what-if)');
    return c;
  }
  function dlrmResolve(c) {
    const W = 'DLRM: ';
    if ([32, 16, 8, 4].indexOf(c.bits) < 0) throw new Error(W + 'bits = ' + c.bits + ' (precisión guardada de las tablas: 32, 16, 8 o 4).');
    c.rowsEff = c.rows.map((n) => (c.maxRows ? Math.min(n, c.maxRows) : n));
    c.nSparse = c.rows.length;
    c.nVec = c.nSparse + 1;
    c.pairs = c.nVec * (c.nVec - 1) / 2;
    c.lookups = c.hots ? sum(c.hots) : c.nSparse;
    c.bottomSizes = [c.nDense].concat(c.bottom, c.arch === 'wd' ? [] : [c.dim]);
    c.topIn = c.arch === 'dot' ? c.dim + c.pairs : c.arch === 'dcn' ? c.nVec * c.dim : c.nSparse * c.dim + c.nDense;
    c.topSizes = [c.topIn].concat(c.top, [1]);
    c.totalRows = sum(c.rowsEff);
    // DCN v2 de bajo rango: 2·D·r + D parámetros por capa contra D² + D llena; con 2r ≥ D (d chico) ya no ahorra nada.
    if (c.arch === 'dcn' && c.rank && 2 * c.rank >= c.topIn)
      (c._notes = c._notes || []).push('r = ' + c.rank + ' y (n_s + 1)·d = ' + c.topIn + ': con 2r ≥ D el "bajo rango" (2·D·r) ya no ahorra frente a la matriz llena (D²)');
    if (c.maxRows) (c._notes = c._notes || []).push('tablas recortadas a ' + fint(c.maxRows) + ' filas (hashing: ids distintos comparten fila)');
    return c;
  }

  function dlrmBuild(c) {
    const g = A.graph(c);
    const ids = g.input('sparse-ids', shp([c.hots ? 'L_hot' : 'n_s'], [c.lookups], 'txt', 'vec'), {
      label: c.hots ? 'Ids categóricos multi-hot (' + c.lookups + ' por muestra en las ' + c.nSparse + ' features)' : 'Ids de las ' + c.nSparse + ' features categóricas (uno por feature)', tex: 's' });
    const dense = g.input('dense', shp(['n_d'], [c.nDense], 'lat', 'vec'), { label: 'Las ' + c.nDense + ' features densas (conteos, log-transformadas)', tex: 'x_{\\mathrm{dense}}' });
    const embRes = A.embedding_tables(ids, { rows: c.rowsEff, D: c.dim, Dsym: 'd', hots: c.hots, outSym: 'n_s', mod: 'txt' });
    const embLabel = 'Lookup en las ' + c.nSparse + ' tablas (' + fint(c.totalRows) + ' filas × d = ' + c.dim + (c.hots ? '; multi-hot, suma de ' + c.lookups + ' filas' : '') + ')';
    if (c.arch === 'wd') {
      // ---- Wide & Deep
      const WW = ['Parte wide (lineal)'];
      const wl = g.op('wide-lookup', A.embedding_tables(ids, { rows: c.rowsEff, D: 1, Dsym: '1', outSym: 'n_s', mod: 'txt' }), { path: ['wide', 'lookup'], out: 'w-emb', where: WW,
        label: 'Un peso por valor categórico (26 tablas × filas × 1)', type: 'embed', group: 'embed', outMeta: { label: 'Pesos wide de los valores presentes', tex: 'w_{s_i}' } });
      const wide = g.op('wide-sum', A.sum_reduce(wl), { path: ['wide', 'sum'], out: 'wide-logit', where: WW, label: 'Sumar los 26 pesos (regresión logística sobre el one-hot)', type: 'tensorop', group: 'head',
        outMeta: { label: 'Logit de la parte wide', tex: 'y_{\\mathrm{wide}} = \\textstyle\\sum_i w_{s_i}' } });
      const emb = g.op('emb-lookup', embRes, { path: ['embeddings', 'lookup'], out: 'emb', where: ['Embeddings (parte deep)'], label: embLabel, type: 'embed', group: 'embed',
        outMeta: { label: 'Un embedding por feature categórica', tex: 'E = [e_1; …; e_{n_s}]' } });
      const WD = ['Parte deep'];
      const ef = g.op('deep-flatten', A.flatten_vec(emb, { sym: 'n_s·d' }), { path: ['deep-in', 'flatten'], out: 'e-flat', where: WD, label: 'Concatenar los 26 embeddings', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Embeddings concatenados', tex: '\\mathrm{vec}(E)' } });
      const ti = g.op('deep-concat', A.concat_features([ef, dense], { sym: 'n_s·d+n_d', mod: 'lat' }), { path: ['deep-in', 'concat'], out: 'top-in', where: WD, label: '… y las ' + c.nDense + ' densas (' + c.topIn + ')', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Entrada del MLP deep', tex: '[\\mathrm{vec}(E);\\, x_{\\mathrm{dense}}]' } });
      const deep = mlpStack(g, ti, c.topSizes, { pre: 'top-', tpre: 't-', path: ['top-mlp'], where: WD.concat(['MLP']), mod: 'lat', outId: 'deep-logit', outSym: '1', label: 'MLP deep',
        outMeta: { label: 'Logit de la parte deep', tex: 'y_{\\mathrm{deep}}' } });
      const lo = g.op('combine', A.add(wide, deep), { path: ['combine'], out: 'logit', where: ['Salida'], label: 'Sumar wide + deep', type: 'tensorop', group: 'head',
        outMeta: { label: 'Logit', tex: 'y_{\\mathrm{wide}} + y_{\\mathrm{deep}}' } });
      g.op('ctr', A.sigmoid(lo), { path: ['ctr'], out: 'ctr', where: ['Salida'], label: 'Sigmoide → probabilidad de clic', type: 'act', group: 'head', outMeta: { label: 'CTR predicho', tex: '\\hat p = \\sigma(\\cdot)' } });
      return g;
    }
    // ---- DLRM: bottom MLP (densas → d) y embeddings (26 × d)
    const bot = mlpStack(g, dense, c.bottomSizes, { pre: 'bot-', tpre: 'b-', path: ['bottom-mlp'], where: ['Bottom MLP'], mod: 'lat', lastAct: true, outId: 'bot-out', outSym: 'd', label: 'Bottom MLP',
      outMeta: { label: 'Densas proyectadas a d (un vector más, como un embedding)', tex: 'z_0' } });
    const emb = g.op('emb-lookup', embRes, { path: ['embeddings', 'lookup'], out: 'emb', where: ['Embeddings'], label: embLabel, type: 'embed', group: 'embed',
      outMeta: { label: 'Un embedding por feature categórica', tex: 'E = [e_1; …; e_{n_s}]' } });
    const WI = ['Interacción'];
    const feats = g.op('interact-stack', A.stack_rows([bot, emb], { sym: 'n_s+1', mod: 'txt' }), { path: ['interaction', 'stack'], out: 'feats', where: WI, label: 'Apilar el vector denso y los ' + c.nSparse + ' embeddings (' + c.nVec + ' × d)', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Los ' + c.nVec + ' vectores que interactúan', tex: 'T = [z_0; e_1; …; e_{n_s}]' } });
    let topIn;
    if (c.arch === 'dot') {
      const gram = g.op('interact-dot', A.pairwise_dot(feats, { mod: null }), { path: ['interaction', 'dot'], out: 'gram', where: WI, label: 'Productos punto de todos los pares: TTᵀ (bmm)', type: 'attn', group: 'attn',
        outMeta: { label: 'Matriz de productos punto (' + c.nVec + ' × ' + c.nVec + ')', tex: 'Z = TT^\\top' } });
      const pr = g.op('interact-tril', A.tril_select(gram, { sym: 'n_pairs' }), { path: ['interaction', 'tril'], out: 'pairs', where: WI, label: 'Triángulo inferior estricto: cada par una vez (' + c.pairs + ')', type: 'tensorop', group: 'attn',
        outMeta: { label: 'Las ' + c.pairs + ' interacciones de segundo orden', tex: '\\{\\langle t_i, t_j\\rangle\\}_{i>j}' } });
      topIn = g.op('interact-concat', A.concat_features([bot, pr], { sym: 'd+n_pairs', mod: 'lat' }), { path: ['interaction', 'concat'], out: 'top-in', where: WI, label: 'Concatenar el vector denso con los pares (' + c.dim + ' + ' + c.pairs + ' = ' + c.topIn + ')', type: 'tensorop', group: 'attn',
        outMeta: { label: 'Entrada del top MLP', tex: '[z_0;\\, \\mathrm{tril}(Z)]' } });
    } else {
      const x0 = g.op('interact-flatten', A.flatten_vec(feats, { sym: '(n_s+1)·d' }), { path: ['interaction', 'flatten'], out: 'x0', where: WI, label: 'Aplanar (' + c.nVec + ' × ' + c.dim + ' = ' + c.topIn + ')', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Entrada de la red de cruce x₀', tex: 'x_0 = \\mathrm{vec}(T)' } });
      // Las 3 capas de cruce se dibujan una vez (repeat = crossLayers): x_l entra y sale con la misma forma; la mezcla usa x₀.
      const WC = WI.concat(['capa de cruce (×' + c.crossLayers + ')']);
      const xl = g.input('x-l', shp(['(n_s+1)·d'], [c.topIn], 'txt', 'vec'), { label: 'x_l: entrada de la capa de cruce l (x₀ en la primera)', tex: 'x_l', perLayer: true });
      const lo = g.op('cross-v', A.linear(xl, { dout: c.rank, doutSym: 'r', bias: false }), { path: ['interaction', 'cross', 'v'], out: 'c-low', where: WC, repeat: c.crossLayers, label: 'V_l: Linear ' + c.topIn + ' → r = ' + c.rank + ' (sin sesgo)', type: 'mlp', group: 'attn',
        outMeta: { label: 'Proyección de bajo rango', tex: 'V_l x_l', perLayer: true } });
      const up = g.op('cross-w', A.linear(lo, { dout: c.topIn, doutSym: '(n_s+1)·d', bias: false }), { path: ['interaction', 'cross', 'w'], out: 'c-up', where: WC, repeat: c.crossLayers, label: 'W_l: Linear r → ' + c.topIn + ' (sin sesgo)', type: 'mlp', group: 'attn',
        outMeta: { label: 'De vuelta al ancho completo', tex: 'W_l(V_l x_l)', perLayer: true } });
      topIn = g.op('cross-mix', A.cross_mix(x0, up, xl), { path: ['interaction', 'cross', 'mix'], out: 'top-in', where: WC, repeat: c.crossLayers, label: 'x₀ ⊙ (W_l V_l x_l + b_l) + x_l', type: 'attn', group: 'attn',
        outMeta: { label: 'Salida de la capa de cruce (tras la última: entrada del top MLP)', tex: 'x_{l+1} = x_0 \\odot (W_l V_l x_l + b_l) + x_l' } });
    }
    const logit = mlpStack(g, topIn, c.topSizes, { pre: 'top-', tpre: 't-', path: ['top-mlp'], where: ['Top MLP'], mod: 'lat', outId: 'logit', outSym: '1', label: 'Top MLP',
      outMeta: { label: 'Logit', tex: 'y' } });
    g.op('ctr', A.sigmoid(logit), { path: ['ctr'], out: 'ctr', where: ['Salida'], label: 'Sigmoide → probabilidad de clic (CTR)', type: 'act', group: 'head', outMeta: { label: 'CTR predicho', tex: '\\hat p = \\sigma(y)' } });
    return g;
  }

  function dlrmParts(c, r) {
    const embOps = r.ops.filter((o) => o.prim === 'embedding_tables');
    const embParams = sum(embOps.map((o) => o.params));
    const deepEmbParams = (r.ops.find((o) => o.id === 'emb-lookup') || { params: 0 }).params;
    const wideParams = (r.ops.find((o) => o.id === 'wide-lookup') || { params: 0 }).params;
    const bottom = pathOf(r, 'bottom-mlp'), top = pathOf(r, 'top-mlp'), inter = pathOf(r, 'interaction');
    const rowBytes = (bits) => sum(embOps.map((o) => o.detail.lookups * o.detail.D)) * bits / 8;
    return { embParams, deepEmbParams, wideParams, bottom, top, inter, mlpParams: bottom.params + top.params, interactionParams: inter.params, rowBytes,
      lookups: sum(embOps.map((o) => o.detail.lookups)) };
  }

  function dlrmQuantities(c, r) {
    const p = dlrmParts(c, r), t = r.totals;
    return {
      nDense: c.nDense, nSparse: c.nSparse, dim: c.dim, tables: c.nSparse, totalRows: c.totalRows, largestTableRows: Math.max.apply(null, c.rowsEff),
      lookupsPerSample: p.lookups, pairs: c.pairs, nVec: c.nVec, topIn: c.topIn, bits: c.bits, B: c.B, k: c.k,
      embeddingParams: p.embParams, mlpParams: p.mlpParams, interactionParams: p.interactionParams, embeddingParamsShare: p.embParams / t.params,
      bottomMlpMacs: p.bottom.macs, topMlpMacs: p.top.macs, interactionMacs: p.inter.macs, macsPerSample: t.macs,
      embeddingBytes: Math.ceil(p.embParams * c.bits / 8), lookupBytesPerSample: p.rowBytes(c.bits),
    };
  }

  function dlrmMetrics(c, r, o) {
    const p = dlrmParts(c, r), t = r.totals;
    const B = o.B;
    const lookupBytes = p.rowBytes(c.bits);
    // Roofline por muestra (≈, inferencia con lote B): bytes = las filas de embedding leídas (acceso aleatorio, no reusables entre
    // muestras); los pesos de los MLPs (< 25 MB incluso en MLPerf) se leen una vez por lote y viven en la caché L2 / SRAM: no se
    // cuentan por muestra. FLOPs = 2·MACs (MLPs + interacción). Las tablas en sí hacen ≈ 1 suma por número leído (0.25 op/B en fp32).
    // embeddingMs / mlpMs: los dos tiempos por separado (si no se solapan, se suman: embeddingMsShare).
    const bytesPerSample = lookupBytes;
    const flopsPerSample = 2 * t.macs;
    const batch = roof(B * flopsPerSample, B * bytesPerSample, H100);
    const embMs = 1000 * B * lookupBytes / H100.bandwidth, mlpMs = 1000 * B * flopsPerSample / H100.peakFlops;
    const rank = roof(c.k * flopsPerSample, c.k * lookupBytes, H100);
    // Entrenamiento ≈: forward + backward (2×) en MLPs e interacción; en las tablas, leer la fila y escribir su actualización (≈ 3×).
    const train = roof(3 * B * flopsPerSample, 3 * B * lookupBytes, H100);
    const trainA100 = roof(3 * B * flopsPerSample, 3 * B * lookupBytes, A100);
    // Con 4 bits y d = 1 (parte wide) una fila ocupa medio byte: se redondea hacia arriba (bytes enteros).
    const bytesAt = (bits) => Math.ceil(p.embParams * bits / 8);
    const embBytes = bytesAt(c.bits);
    const largest = Math.max.apply(null, c.rowsEff);
    const out = {
      B, k: c.k, bits: c.bits, dim: c.dim, tables: c.nSparse, totalRows: c.totalRows, largestTableRows: largest, largestTableBytes: largest * c.dim * c.bits / 8,
      embeddingParams: p.embParams, mlpParams: p.mlpParams, interactionParams: p.interactionParams, wideParams: p.wideParams, deepEmbeddingParams: p.deepEmbParams,
      embeddingParamsShare: p.embParams / t.params, mlpParamsShare: p.mlpParams / t.params,
      embeddingBytes: embBytes, embeddingBytes32: p.embParams * 4, embeddingBytes16: p.embParams * 2, embeddingBytes8: p.embParams, mlpBytes: (p.mlpParams + p.interactionParams) * 4,
      gpusToHoldTables: Math.ceil(embBytes / H100.hbmBytes),
      lookupsPerSample: p.lookups, lookupBytesPerSample: lookupBytes, lookupBytesPerSample32: p.rowBytes(32),
      bottomMlpMacs: p.bottom.macs, topMlpMacs: p.top.macs, interactionMacs: p.inter.macs, mlpMacsPerSample: p.bottom.macs + p.top.macs, macsPerSample: t.macs, flopsPerSample,
      interactionMacsShare: p.inter.macs / Math.max(1, t.macs),
      embeddingIntensity: 1 / (c.bits / 8),   // ≈ 1 suma por número leído
      arithmeticIntensity: flopsPerSample / bytesPerSample, bytesPerSample, ridgePoint: H100.peakFlops / H100.bandwidth,
      samplesPerSecH100: 1000 * B / batch.ms, batchMsH100: batch.ms, bound: batch.bound, embeddingMsBatch: embMs, mlpMsBatch: mlpMs, embeddingMsShare: embMs / (embMs + mlpMs),
      trainStepMsH100: train.ms, trainSamplesPerSecH100: 1000 * B / train.ms, trainBound: train.bound,
      trainSamplesPerSecA100: 1000 * B / trainA100.ms, trainBoundA100: trainA100.bound,
      rankingMacsPerRequest: c.k * t.macs, rankingLookupBytesPerRequest: c.k * lookupBytes, rankingMsH100: rank.ms, rankingBound: rank.bound,
      bandwidth: H100.bandwidth, peakFlops: H100.peakFlops, hbmBytes: H100.hbmBytes, hardwareSource: H100.source,
      units: DLRM_UNITS,
    };
    if (c.arch === 'dot') out.interactionMacsUseful = c.pairs * c.dim;
    if (c.arch === 'dcn') { out.crossRank = c.rank; out.crossParamsFullRank = c.crossLayers * (c.topIn * c.topIn + c.topIn); }
    // La corrida medida de MLPerf (A.recsys.measured) es la arquitectura de dlrm-mlperf ENTRENANDO en A100: solo ahí (y sin knobs que
    // cambien el modelo o la precisión) se compara con su cota de entrenamiento, por GPU.
    const archKnobs = ['dim', 'maxRows', 'bits'].some((x) => r.overrides && r.overrides[x] !== undefined);
    if (r.id === 'dlrm-mlperf' && !archKnobs) {
      const perGpu = MEASURED.trainRecordsPerSec / MEASURED.gpus;
      out.measuredTrainPerGpu = perGpu;
      out.trainCeilingVsMeasuredH100 = out.trainSamplesPerSecH100 / perGpu;
      out.trainCeilingVsMeasuredA100 = out.trainSamplesPerSecA100 / perGpu;
    }
    out.bitsScaling = [32, 16, 8, 4].map((b) => ({ bits: b, embeddingBytes: bytesAt(b), lookupBytesPerSample: p.rowBytes(b), gpusToHoldTables: Math.ceil(bytesAt(b) / H100.hbmBytes) }));
    out.maxRowsScaling = [100000, 1000000, 10000000, 40000000].map((m) => {
      const rows = sum(c.rows.map((n) => Math.min(n, m)));
      return { maxRows: m, totalRows: rows, embeddingBytes: Math.ceil(rows * (c.arch === 'wd' ? c.dim + 1 : c.dim) * c.bits / 8) };
    });
    out.kScaling = [50, 100, 500, 1000, 5000].map((k) => ({ k, rankingMacsPerRequest: k * t.macs, rankingMsH100: roof(k * flopsPerSample, k * lookupBytes, H100).ms }));
    return out;
  }
  const DLRM_UNITS = {
    B: 'count', k: 'count', bits: 'count', dim: 'count', tables: 'count', totalRows: 'count', largestTableRows: 'count', largestTableBytes: 'bytes',
    embeddingParams: 'params', mlpParams: 'params', interactionParams: 'params', wideParams: 'params', deepEmbeddingParams: 'params', embeddingParamsShare: 'pct', mlpParamsShare: 'pct',
    embeddingBytes: 'bytes', embeddingBytes32: 'bytes', embeddingBytes16: 'bytes', embeddingBytes8: 'bytes', mlpBytes: 'bytes', gpusToHoldTables: 'count',
    lookupsPerSample: 'count', lookupBytesPerSample: 'bytes', lookupBytesPerSample32: 'bytes', bottomMlpMacs: 'macs', topMlpMacs: 'macs', interactionMacs: 'macs', interactionMacsUseful: 'macs',
    mlpMacsPerSample: 'macs', macsPerSample: 'macs', flopsPerSample: 'count', interactionMacsShare: 'pct', embeddingIntensity: 'ratio', arithmeticIntensity: 'ratio', bytesPerSample: 'bytes',
    ridgePoint: 'ratio', samplesPerSecH100: 'count', batchMsH100: 'ms', embeddingMsBatch: 'ms', mlpMsBatch: 'ms', embeddingMsShare: 'pct', trainStepMsH100: 'ms', trainSamplesPerSecH100: 'count',
    trainSamplesPerSecA100: 'count', measuredTrainPerGpu: 'count', trainCeilingVsMeasuredH100: 'ratio', trainCeilingVsMeasuredA100: 'ratio', crossRank: 'count', crossParamsFullRank: 'params',
    rankingMacsPerRequest: 'macs', rankingLookupBytesPerRequest: 'bytes', rankingMsH100: 'ms', bandwidth: 'count', peakFlops: 'count', hbmBytes: 'bytes',
  };

  A.defineModel({
    id: 'dlrm',
    label: 'Ranking: DLRM / DCN v2 / Wide & Deep (tablas de embeddings + MLPs + interacciones)',
    paper: { title: 'Deep Learning Recommendation Model for Personalization and Recommendation Systems', authors: 'Naumov et al.', venue: 'arXiv 2019', year: 2019, arxiv: '1906.00091',
      note: 'Código: github.com/facebookresearch/dlrm. Wide & Deep: Cheng et al., DLRS 2016, arXiv:1606.07792. DCN v2: Wang et al., WWW 2021, arXiv:2008.13535. MLPerf Training (DLRM-DCNv2 desde v3.0): mlcommons/training.' },
    configs: DLRM_CONFIGS,
    knobs: { B: [1, 128, 2048, 65536], dim: [8, 16, 32, 64, 128], maxRows: [100000, 1000000, 10000000, 40000000], bits: [32, 16, 8, 4], k: [50, 100, 500, 1000, 5000] },
    hardware: Object.assign({}, H100),
    applyKnobs: dlrmApplyKnobs,
    resolve: dlrmResolve,
    build: dlrmBuild,
    quantities: dlrmQuantities,
    metrics: dlrmMetrics,
  });

  // Ayudas para la UI / pruebas (no son parte del contrato de run()).
  A.recsys = { h100: Object.assign({}, H100), a100: Object.assign({}, A100),
    measured: Object.assign({}, MEASURED), KAGGLE_ROWS: KAGGLE_ROWS.slice(), TB_ROWS: TB_ROWS.slice(), DCN_HOTS: DCN_HOTS.slice(),
    userCats: USER_CATS.map((x) => Object.assign({}, x)), itemCats: ITEM_CATS.map((x) => Object.assign({}, x)) };
})(typeof window !== 'undefined' ? window : globalThis);
