/* =============================================================================
   Atlas de Arquitecturas — js/arch/retrieval.js
   Modelos `bert` (página `bert`), `retrieval` (página `retrieval`) y `ann` (página `ann`); contrato SPEC §23. Tesis: buscar es
   "codificar una vez, comparar rápido". Cargar DESPUÉS de llm.js (usa su hardware H100 para las cotas ≈).
   Cross-check: crosscheck/retrieval.py (+ crosscheck/faiss_ann.py en un proceso aparte): HF BertForPreTraining / DPRQuestionEncoder /
   DPRContextEncoder / BertModel / BertForSequenceClassification en el dispositivo META + FAISS 1.15.1 (faiss-cpu). Parámetros y
   FLOPs EXACTOS (diferencia 0) en las 10 configs; bytes de índice y distancias contra índices FAISS reales chicos.

   ---------------------------------------------------------------- convenciones
   Formas sin batch. Símbolos: T (tokens de BERT), T_q / T_d (tokens de la query / del documento, CON [CLS] y [SEP]),
   T_q+T_d-1 (el par del cross-encoder: [CLS] q [SEP] d [SEP]; sobra el [CLS] del documento), D, h, d_h, D_mlp, V (30,522), N
   (documentos del corpus en `retrieval`; vectores del índice en `ann`), k (candidatos / vecinos), dim (dimensión guardada), d
   (dimensión del índice en `ann`), M (enlaces de HNSW: 2M en el nivel 0), ef (efSearch), n_list, n_probe, m (sub-cuantizadores),
   k_s = 2^nbits (centroides por sub-espacio). cfg: T, Tq, Td, N, k, dim, d, M, efSearch, efConstruction, nlist, nprobe, m, nbits,
   bits (precisión GUARDADA: 32 / 16 / 8 / 1 en `retrieval`, 32 / 16 / 8 en `ann`), B (solo `bert`).
   MACs = matmuls (FLOPs = 2·MACs = FlopCounterMode). Elementwise, normas, softmax, top-k, máximo y lecturas de tabla: "otros" (≈).
   Bytes decimales (fmt.bytes). Hardware de las cotas ≈ (roofline: máx(FLOPs/pico, bytes/ancho de banda), SIN overheads):
   H100 SXM (llm.js: 3.35 TB/s, 989 TFLOPS bf16) para los encoders; CPU AMD EPYC 9654 de 1 socket (ficha de AMD: 460.8 GB/s,
   96 núcleos a 2.4 GHz; pico fp32 ≈ 7.37 TFLOPS DERIVADO: 96 × 2.4 GHz × 32 FLOPs/ciclo) para FAISS. Las cotas son INFERIORES:
   HNSW está limitado por la latencia de accesos aleatorios, no por el ancho de banda (metrics.latencyKind lo dice).

   Cuerpo de BERT compartido (bertBody, en este archivo) por los tres modelos: embeddings (tok-embed, pos-embed, type-embed →
   add-pos, add-type → emb-ln) + L capas POST-LN (A.postLnLayer, nuevo en primitives.js). HF tiene W_Q, W_K, W_V separadas; el
   calculador las fusiona en `qkv` (mismo conteo). Sin máscara de atención (una secuencia sin relleno). NO reutiliza el BERT de
   grounding-dino.js: allí es una función local con ids t-… y MHSA / FFN compuestas (sin los nodos internos que pide la vista de
   capa); se compone aquí con los ids de capa de siempre (los de preLnLayer, en orden post-LN).
   Ops de una capa (repeat L; path <prefijo> › encoder › enc-layer › …): mhsa › {qkv, split, scores, scale, softmax, weighted-sum,
   merge, proj} · res1 · ln1 · mlp › {fc1, gelu, fc2} · res2 · ln2. Tensores: x0 qkv q k v scores scores-scaled attn z-heads z o r1
   h-ln1 (= LN₁(x + O), entrada del MLP) u g f r2 x-out (= LN₂(r2)). Embeddings: path <prefijo> › embed › {tok, pos, type, add, ln};
   tensores ids type-ids pos-ids (entradas) e-tok e-pos e-type e-tok-pos e-sum x0.
   En `retrieval` y `ann` todos los ids de la torre llevan prefijo: q- (query), d- (documento), r- (el cross-encoder del rerank).

   ---------------------------------------------------------------- modelo `bert` (configs bert-base [canónica], bert-large)
   BertForPreTraining: 12 / 24 capas, 768 / 1024, 12 / 16 cabezas, FFN 3,072 / 4,096, vocab 30,522, 512 posiciones, 2 segmentos.
   T = 128 (90 % de los pasos del paper), B = 256. Knobs: T [32 … 512], B [1, 32, 256].
   bert-base = 110,106,428 parámetros (embeddings 23,837,184 · encoder 85,054,464 = 12 × (12D² + 13D) · pooler 590,592 · cabeza MLM
   622,650 = D² + 3D + V (el decoder está ATADO a los word embeddings: solo su sesgo es nuevo) · NSP 1,538); 14,250,149,376 MACs con
   T = 128. bert-large = 336,226,108; 43,595,859,968 MACs.
   Vista `bert-overview` — nodos: tokens (› mask), embed, encoder (grupo ×L) › enc-layer, pooler (› cls, dense, tanh), mlm-head
   (› dense, gelu, ln, decoder), nsp-head, loss (› mlm, nsp, sum). Vista `bert-pretraining`: tokens › mask → … → mlm-head → loss.
   Ops: mask-tokens (tokens › mask: raw-ids → ids, mlm-labels; 15 %: 80 / 10 / 10) · embeddings y capa (arriba) · mlm-dense,
   mlm-gelu, mlm-ln, mlm-decoder (→ mlm-h, mlm-g, mlm-n, mlm-logits T×V) · pool-cls, pooler-dense, pooler-tanh (→ h-cls, pooler-pre,
   pooled) · nsp (→ nsp-logits, 2) · mlm-loss, nsp-loss, loss-sum (→ loss-mlm, loss-nsp, loss; entrada nsp-label).
   Tensores (orden): raw-ids ids mlm-labels type-ids pos-ids e-tok e-pos e-type e-tok-pos e-sum x0 qkv q k v scores scores-scaled
   attn z-heads z o r1 h-ln1 u g f r2 x-out mlm-h mlm-g mlm-n mlm-logits h-cls pooler-pre pooled nsp-logits nsp-label loss-mlm
   loss-nsp loss.
   MACs como HF: la cabeza MLM corre sobre las T posiciones (prediction_logits T×V); el código original de TF (gather_indexes) solo
   sobre las max_predictions_per_seq elegidas: quantities.mlmHeadMacsGathered. predicciones = ⌈0.15·T⌉ (README: 20 con T = 128).
   metrics (units en metrics.units): params — embedParams, encoderParams, layerParams, poolerParams, mlmHeadParams, nspParams,
   mlmTiedParams (V·D, ya contados en embed), bodyParams, headsParams (+ …Share pct); macs — macsPerSequence, macsPerToken,
   encoderMacs, layerMacs, mlmHeadMacs, mlmDecoderMacs, mlmHeadMacsGathered, poolerMacs, nspMacs, scoreMacs, stepMacs (≈ 3·B·forward),
   pretrainMacs (≈ 1M pasos, 90 % a 128 / 10 % a 512); pct — mlmHeadMacsShare, attnScoreShare (QKᵀ + A·V del total),
   attnScoreShareEncoder (del encoder; ∝ T), maskRate, maskShare, randomShare, keepShare, nspPositiveShare; count — mlmPredictions,
   mlmMaskTokens, mlmRandomTokens, mlmKeptTokens, tokensPerBatch, crossoverT (= 2D + D_mlp); ms — forwardBatchMsH100 (≈);
   forwardBatchBound; lista tScaling [{T, macs, encoderMacs, scoreMacs, attnScoreShareEncoder, mlmHeadMacs}].

   ---------------------------------------------------------------- modelo `retrieval`
   Configs: dpr-bert-base (canónica: dos BERT-base INDEPENDIENTES sin pooler, [CLS], 768-d, producto punto; T_q 32, T_d 256 =
   sequence_length del repo de DPR; N = 21,015,324 pasajes de Wikipedia; + rerank de k = 100 pares con el cross-encoder MiniLM —
   DPR no rerankea: el pipeline es ilustrativo y rerank = 0 lo quita) · sbert-minilm (all-MiniLM-L6-v2: 6 × 384, 12 cabezas,
   FFN 1,536; SIAMÉS: la torre de documentos tiene paramRepeat 0; mean pooling + normalizar; T_d 180, N = 8,841,823 de MS MARCO;
   + rerank) · cross-encoder-minilm (ms-marco-MiniLM-L-6-v2: BertForSequenceClassification num_labels 1; par de T_q + T_d − 1 = 211)
   · colbert-v2 (BERT-base COMPARTIDO + Linear 768 → 128 sin sesgo + normalizar por token; T_q 32, T_d 180 (artifact.metadata);
   bits 16 = ColBERT v1; MaxSim). Sentence-BERT y ColBERT usan BertModel CON pooler: el forward lo calcula y lo descarta (nodo
   <torre> › pooler, label "se calcula y se descarta"): así los parámetros y FLOPs son los del modelo real.
   Knobs: Tq [8 … 64], Td [64 … 512], N, k [10, 20, 100, 1000], dim (bi-encoders: truncar a dim ≤ D, Matryoshka — ops q-truncate /
   d-truncate; ColBERT: salida del Linear), bits [32, 16, 8, 1], rerank [0, 1] (zeroKnob).
   Vistas: `retrieval-overview` — query-encoder, q-pool, doc-encoder, d-pool, index, ann-search (› scan, topk), rerank (› pairs,
   joint-encoder, pooler, score-head, collect), results. `bi-vs-cross`: query-encoder / doc-encoder + q-pool / d-pool + ann-search
   (bi) frente a joint-encoder + pooler + score-head (cross-encoder-minilm, o rerank › … en las configs con rerank).
   `colbert-maxsim`: query-encoder (› linear, normalize), doc-encoder, index, maxsim (› sim, max, sum).
   Ops (fuera de las torres): q-pool / d-pool (q-pool › cls | mean) · q-truncate / d-truncate (› truncate, solo dim < D) ·
   q-normalize / d-normalize (› normalize, Sentence-BERT) · q-linear / d-linear y q-normalize / d-normalize (ColBERT, path
   <encoder> › linear / normalize) · q-pool-cls, q-pooler-dense, q-pooler-tanh (y d-…: pooler descartado) · index (index:
   embed_index → doc-index N×dim; ColBERT N×T_d×dim) · search (ann-search › scan: dot_score → doc-scores N) · topk (ann-search ›
   topk → topk-ids k) · make-pairs (rerank › pairs: pair_tokens(q-ids, topk-ids) → r-ids, ×k) · r-… (el grafo de
   cross-encoder-minilm importado con A.importGraph, cada op × k pares; paths rerank › joint-encoder | pooler | score-head) ·
   rerank-collect (rerank › collect → rerank-scores k×1) · results (results → results k). ColBERT: sim, max, sum (maxsim › … →
   sim T_q×T_d, sim-max T_q, score 1). Cross-encoder: ids type-ids pos-ids → … → h-cls pooler-pre pooled → score-head → score.
   Tensores nuevos: q-emb / d-emb (embedding final; ColBERT T×dim), q-cls-vec / q-mean / q-trunc (intermedios del pooling),
   q-lin / d-lin (ColBERT), q-h-cls q-pooler-pre q-pooled (pooler descartado), doc-index, doc-scores, topk-ids, r-ids, r-…,
   rerank-scores, results, sim, sim-max, score.
   totals = lo dibujado: UNA query + UN documento (la codificación del corpus es offline: metrics × N) + búsqueda + rerank.
   metrics: macs — queryEncodeMacs, docEncodeMacs, corpusEncodeMacs (× N, offline), crossEncoderMacsPerPair, rerankMacs (k pares),
   crossEncoderFullScanMacs (N pares: por qué no se rerankea todo), bruteForceMacs (N·dim; ColBERT: N·T_q·T_d·dim exhaustivo),
   onlineMacsPerQuery, maxsimMacsPerDoc / colbertRerankMacs (ColBERT); bytes — embeddingIndexBytes (N·dim·bits/8),
   embeddingIndexBytes32, bruteForceBytes, colbertIndexBytes (N·T_d·dim·bits/8, pasajes COMPLETOS de T_d: el paper reporta 154 GiB
   con la longitud real), colbertV1IndexBytes (16 bits), colbertV2IndexBytes (N·T_d·(dim·2/8 + 4): 36 B por vector, §3.3),
   colbertV2BytesPerVector; params — towerParams, docTowerParams (0 si siamés), biEncoderParams, rerankerParams,
   crossEncoderParams; ms (≈) — queryEncodeMs, corpusEncodeMs, rerankMs, bruteForceMsH100, bruteForceMsCpu, onlineMsH100,
   crossEncoderFullScanMs; duración (s / min / h con la unidad en el texto) — corpusEncodeTime; pct — rerankShareOnline,
   bruteForceShareOnline; ratio — queryVsDocEncode, crossVsBiPerQuery,
   singleVectorRatio; count — Tq, Td, N, k, dim, bits, pairTokens (el par, truncado a 512), tokenVectors, pairsPerSecH100; textos queryEncodeBound, rerankBound,
   bruteForceBoundCpu; listas bitsScaling, dimScaling, nScaling.

   ---------------------------------------------------------------- modelo `ann`
   Grafo de CONTABILIDAD de costo por query (no hay red neuronal en la búsqueda): encode (el encoder de queries de DPR, BERT-base,
   [CLS], T_q = 32; + encode-proj Linear 768 → d si d ≠ 768, el projection_dim de DPR; knob encode = 0 lo quita) → búsqueda → top-k.
   Configs: hnsw-1m-768 (canónica: IndexHNSWFlat, M 32, efConstruction 200, efSearch 64 — elegidos aquí; defaults de FAISS 40 / 16
   y de hnswlib M 16 / 200 / 10) · ivfpq-1m-768 (n_list 4,096, n_probe 16, m 96 × 8 bits, tabla precalculada) · flat-1m-768
   (IndexFlatIP) · ivfpq-1b-768 (n_list 2²⁰ con cuantizador HNSW32, como IVF1048576_HNSW32 del wiki; sin tabla precalculada: no
   cabe en los 2 GiB de FAISS). N = 1M (1B), d = 768, fp32, k = 10.
   Knobs: N, d, M, efSearch, nlist, nprobe, m, nbits [4, 8], bits [32, 16, 8], k, Tq, encode [0, 1] (zeroKnob).
   Nodos y ops: encode (› embed, encoder, pool; encode › proj) · flat: scan (flat_scan → dists N) · HNSW: graph-walk › upper
   (hnsw_descent → entry 1) y › layer0 (hnsw_beam → cands ef; entradas xb N×d, links N×2M) · IVF-PQ: coarse › dists (ivf_coarse
   → coarse-dists n_list, o ef con el cuantizador HNSW; sus parámetros = los centroides de k-means) y › probe (→ probe-ids n_probe), list-scan › residual
   (→ residuals n_probe×d), › lut (pq_lut → lut n_probe×m×k_s; parámetros = codebooks k_s·d) y › adc (pq_scan → adc-dists
   n_probe·N/n_list; entradas codes N×m, list-ids N) · rerank (topk → ids k: el top-k / re-rank final de cada índice).
   Tensores: q-… (encoder), q-cls (si d ≠ 768), query, xb, links, entry, cands, coarse-dists, probe-ids, residuals, lut, codes,
   list-ids, adc-dists, dists, ids.
   Distancias por query: flat N (exacto); IVF n_list (o ≈ las del HNSW grueso) + n_probe·N/n_list; HNSW ≈ ⌊log_M N⌋·M (descenso)
   + efSearch·2M (nivel 0) — una ESTIMACIÓN (≈), no una cota: la búsqueda puede expandir más de ef nodos; medido con FAISS en datos
   sintéticos da 0.44–1.02× (crosscheck range_checks; ≈ 0.66× con M = 32 y efSearch = 64).
   Bytes (verificados con FAISS: primitives.flat_bytes / hnsw_bytes / ivfpq_bytes): flat N·d·bits/8; HNSW N·d·bits/8 + 4·N·(2M +
   M/(M−1)) enlaces (esperanza) + 4N levels + 8(N+1) offsets (la regla del wiki, (d·4 + M·2·4) B por vector, en wikiRuleBytes);
   IVF-PQ N·m·nbits/8 códigos + 8N ids + n_list·d·4 centroides + k_s·d·4 codebooks + 8·n_list (+ enlaces del HNSW grueso).
   metrics: bytes — indexBytes, vectorBytes, linkBytes (= layer0LinkBytes 4·N·2M + upperLinkBytes ≈ 4·N·M/(M−1)), levelBytes,
   wikiRuleBytes, codeBytes, idBytes, centroidBytes, codebookBytes, listSizeBytes, coarseLinkBytes, precomputedTableBytes (RAM, no
   se serializa), bytesPerVector, flatBytes, bytesTouchedPerQuery (vectores / códigos / centroides / tablas leídos, ≈),
   centroidBytesTouched (IVF: coarse·d·4) + centroidBytesShare (pct); count — distanceComputations (≈ en HNSW; = upperDistances
   ⌊log_M N⌋·M + layer0Distances ef·2M), distanceComputationsFlat, coarseDistances, scannedVectors, levels, qpsUpperBound; macs — searchMacs, encodeMacs, flatMacs,
   buildMacs (≈: HNSW = N inserciones con ef = efConstruction; IVF-PQ = k-means grueso (10 iteraciones, ≤ 256 puntos por centroide)
   + k-means de PQ (25 iteraciones) + asignar y codificar); ratio — distanceRatioVsFlat, macsVsFlat, bytesTouchedVsFlat,
   memoryVsFlat, compression, linksPerVector, listSize; params — encodeParams, searchParams; pct — searchMacsShare; ms (≈, CPU) —
   latencyMs, latencyMsCachedCentroids (IVF-PQ: la misma cota con los centroides en caché), buildMsCpu (a pico: el build real es
   mucho más lento; DPR reporta 8.5 h para su HNSW de 21M), encodeMsH100; duración (unidad en el texto: '16.3 min') — buildTimeCpu;
   textos latencyBound, latencyKind; booleano estimate; listas nScaling, efScaling, mScaling (HNSW), nprobeScaling, mScaling (IVF).
   recall@k / nDCG NO se calculan: solo como números citados (ann-benchmarks, wiki de FAISS, papers) en las páginas.

   ---------------------------------------------------------------- desviaciones respecto de SPEC §23 (añadidos; nada renombrado)
   - HNSW: la SPEC sugiere ≈ efSearch·M·log N distancias; medido con FAISS eso sobreestima ×8–15. Se usa ⌊log_M N⌋·M + efSearch·2M.
   - ANN incluye "encode query" (el encoder de DPR) como pide la lista de ops de §23.3: totals = encode + búsqueda (metrics separa
     encodeMacs y searchMacs). Los centroides y codebooks (aprendidos con k-means) cuentan como parámetros.
   - `dim` en bi-encoders = truncar (Matryoshka), en ColBERT = salida del Linear; `bits` 4 también vale en `retrieval`.
   - Par del cross-encoder > 512 tokens (T_q + T_d − 1 con T_d = 512): se TRUNCA el documento a 512 − T_q + 1 tokens, como HF
     (truncation = 'only_second') y CrossEncoder(max_length = 512); el par queda en 512 (símbolo '512') y la etiqueta lo dice.
     Antes el knob T_d = 512 tiraba error en las cuatro configs. cfg.pairT / cfg.TdPair / cfg.pairTrunc; quantities.pairTokens.
   - Métricas del reranker (rerankMacs, rerankMs, crossEncoderMacsPerPair, …) solo donde corre un cross-encoder (rerank = 1 o la
     config cross-encoder); en ColBERT no existen (antes daban el par de MiniLM). En la config cross-encoder no hay
     queryEncodeMacs / docEncodeMacs (no hay torres) y rerankMacs = k × el par.
   - IVF-PQ con cuantizador HNSW (escala de mil millones): coarse-dists son los ef centroides candidatos que devuelve el HNSW
     (forma ef, ef = máx(coarseEf, n_probe) como FAISS), no n_list distancias.
   - ANN: el vector de la query se llama d (la dimensión del índice) aunque salga de [CLS] sin proyección (d = D).
   - Knobs añadidos: rerank (retrieval); k, Tq, encode (ann). La CPU (EPYC 9654) es una entrada nueva con su ficha citada; su pico
     de cómputo es derivado (≈).
   - Nodos añadidos: tokens › mask y loss (bert); q-pool / d-pool, ann-search › scan / topk, rerank › pairs / collect, results,
     <torre> › pooler / linear / normalize (retrieval); encode, graph-walk › upper / layer0, coarse › dists / probe, list-scan ›
     residual / lut / adc y rerank (= top-k) en ann.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel || !A.postLnLayer) throw new Error('retrieval.js necesita js/arch/primitives.js (fase 11) antes.');
  if (!A.hasConfig || !A.hasConfig('llama3-8b')) throw new Error('retrieval.js necesita js/arch/llm.js antes (hardware H100 de las cotas ≈).');
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);

  // ------------------------------------------------------------------ hardware (≈, entradas de las cotas de roofline)
  const H100 = Object.assign({ id: 'h100', label: 'H100 SXM' }, A.model('llm').hardware);   // 3.35 TB/s, 989 TFLOPS bf16 denso
  // CPU (FAISS en CPU: HNSW, IVF-PQ, flat). AMD EPYC 9654 (Genoa, 1 socket): ficha de AMD — 96 núcleos, 2.4 GHz base, 12 canales
  // DDR5-4800 = 460.8 GB/s por socket. Cómputo ≈ DERIVADO (no está en la ficha): 96 núcleos × 2.4 GHz × 32 FLOPs fp32 por ciclo
  // (Zen 4: 2 FMA de 256 bits = 16 FMA fp32) = 7.37 TFLOPS fp32 (≈).
  const CPU = { id: 'epyc9654', label: 'AMD EPYC 9654 (1 socket)', bandwidth: 460.8e9, peakFlops: 96 * 2.4e9 * 32, estimate: true,
    source: 'AMD EPYC 9654 (ficha de AMD): 96 núcleos, 2.4 GHz base, 12 canales DDR5-4800, 460.8 GB/s por socket. Cómputo ≈ 96 × 2.4 GHz × 32 FLOPs fp32/ciclo (Zen 4: 2 FMA de 256 bits) = 7.37 TFLOPS (derivado, no de la ficha)' };
  const roof = (flops, bytes, hw) => {
    const tc = flops / hw.peakFlops, tm = bytes / hw.bandwidth;
    return { ms: 1000 * Math.max(tc, tm), bound: tc >= tm ? 'cómputo' : 'memoria', computeMs: 1000 * tc, memoryMs: 1000 * tm };
  };

  // ------------------------------------------------------------------ dimensiones de los encoders (HF BertConfig)
  const ENC = {
    // bert-base-uncased / bert-large-uncased (Devlin et al. 2019, §3: L 12 / 24, H 768 / 1024, A 12 / 16; FFN 4H; WordPiece 30,522;
    // 512 posiciones aprendidas; 2 tipos de token; GELU; LayerNorm ε 1e-12; post-LN).
    base: { L: 12, D: 768, h: 12, Dmlp: 3072, V: 30522, posMax: 512, typeVocab: 2, eps: 1e-12, encLabel: 'BERT-base' },
    large: { L: 24, D: 1024, h: 16, Dmlp: 4096, V: 30522, posMax: 512, typeVocab: 2, eps: 1e-12, encLabel: 'BERT-large' },
    // MiniLM-L6-H384 (nreimers/MiniLM-L6-H384-uncased): config.json de sentence-transformers/all-MiniLM-L6-v2 y de
    // cross-encoder/ms-marco-MiniLM-L-6-v2: 6 capas, 384, 12 cabezas (d_h 32), FFN 1,536, vocab 30,522, 512 posiciones, 2 tipos.
    minilm: { L: 6, D: 384, h: 12, Dmlp: 1536, V: 30522, posMax: 512, typeVocab: 2, eps: 1e-12, encLabel: 'MiniLM-L6-H384' },
  };

  // ------------------------------------------------------------------ cuerpo de BERT (compartido por los tres modelos)
  // Embeddings (token + posición + tipo → LayerNorm) y L capas post-LN (A.postLnLayer). o = {tid, oid, path (prefijo de nodos),
  // where, labelPrefix, T, Tsym, paramL (0 = pesos compartidos con otra torre), idsLabel}. Las entradas ids / type-ids / pos-ids
  // (<tid>ids…) se crean si no existen (el modelo `bert` produce `ids` con el enmascarado). → handle de <tid>x-out (T×D).
  function bertBody(g, c, o) {
    const tid = o.tid || '', oid = o.oid || '', P = o.path || [], W = o.where || ['BERT'], pre = o.labelPrefix || '';
    const T = o.T, Ts = o.Tsym || 'T';
    const shared = o.paramL === 0;
    const inp = (id, label, tex) => (g.has(id) ? g.tensor(id) : g.input(id, shp([Ts], [T], 'txt', 'vec'), { label: pre + label, tex }));
    const ids = inp(tid + 'ids', o.idsLabel || 'ids de WordPiece ([CLS] … [SEP])', 't');
    const types = inp(tid + 'type-ids', 'token type ids (segmento A = 0, B = 1)', 's');
    const pos = inp(tid + 'pos-ids', 'posiciones 0 … T − 1 (buffer position_ids)', '\\mathrm{pos}');
    const E = P.concat(['embed']);
    const op = (id, res, node, extra) => g.op(oid + id, res, Object.assign({ path: E.concat([node]), where: W.concat(['embeddings']) }, shared ? { paramRepeat: 0 } : {}, extra));
    const tok = op('tok-embed', A.embedding_lookup(ids, { V: c.V, D: c.D }), 'tok', {
      out: tid + 'e-tok', label: 'Word embeddings (V × D: ' + fint(c.V) + ' × ' + c.D + ')' + (shared ? ' · pesos compartidos' : ''), type: 'embed', group: 'embed',
      outMeta: { label: pre + 'embeddings de tokens', tex: 'E_{\\mathrm{tok}}[t]' } });
    const pe = op('pos-embed', A.embedding_lookup(pos, { V: c.posMax, Vsym: String(c.posMax), D: c.D }), 'pos', {
      out: tid + 'e-pos', label: 'Position embeddings aprendidos (' + c.posMax + ' × D)', type: 'embed', group: 'embed',
      outMeta: { label: pre + 'embeddings de posición', tex: 'E_{\\mathrm{pos}}[\\mathrm{pos}]' } });
    const te = op('type-embed', A.embedding_lookup(types, { V: c.typeVocab, Vsym: String(c.typeVocab), D: c.D }), 'type', {
      out: tid + 'e-type', label: 'Token type (segmento) embeddings (' + c.typeVocab + ' × D)', type: 'embed', group: 'embed',
      outMeta: { label: pre + 'embeddings de segmento', tex: 'E_{\\mathrm{seg}}[s]' } });
    const x1 = op('add-pos', A.add(tok, pe), 'add', { out: tid + 'e-tok-pos', label: 'Suma de la posición', type: 'tensorop', group: 'embed',
      outMeta: { label: pre + 'tokens + posición', tex: 'E_{\\mathrm{tok}} + E_{\\mathrm{pos}}' } });
    const x2 = op('add-type', A.add(x1, te), 'add', { out: tid + 'e-sum', label: 'Suma del segmento', type: 'tensorop', group: 'embed',
      outMeta: { label: pre + 'suma de los tres embeddings', tex: 'E_{\\mathrm{tok}} + E_{\\mathrm{pos}} + E_{\\mathrm{seg}}' } });
    const x0 = op('emb-ln', A.layernorm(x2), 'ln', { out: tid + 'x0', label: 'LayerNorm de los embeddings', type: 'norm', group: 'norm',
      outMeta: { label: pre + 'entrada de la capa 1', tex: 'x_0' } });
    return A.postLnLayer(g, x0, {
      prefix: P.concat(['encoder', 'enc-layer']), L: c.L, h: c.h, Dmlp: c.Dmlp, tid, oid, where: W.concat(['capa del encoder']),
      labelPrefix: pre + 'capa · ', paramL: shared ? 0 : undefined,
      outMeta: { label: pre + 'salida del encoder (tras las L capas)', tex: 'H = x_L', perLayer: false, note: 'Un vector contextual por token: T×D. Salida de cada capa; tras la capa L es la del encoder.' },
    });
  }

  // Pooler de BERT (BertPooler): [CLS] → dense D → D → tanh. o = {tid, oid, path, where, labelPrefix}
  function addPooler(g, c, x, o) {
    const tid = o.tid || '', oid = o.oid || '', P = o.path || ['pooler'], pre = o.labelPrefix || '';
    const sh = o.paramRepeat === 0 ? { paramRepeat: 0 } : {};
    const dis = o.discarded ? ' (se calcula y se descarta)' : '';
    const op = (id, res, node, extra) => g.op(oid + id, res, Object.assign({ path: P.concat([node]), where: o.where }, sh, extra));
    const cls = op('pool-cls', A.pool_cls(x), 'cls', { out: tid + 'h-cls', label: 'Tomar el vector de [CLS] (fila 0)', type: 'tensorop', group: 'head',
      outMeta: { label: pre + 'vector de [CLS]', tex: 'h_{[\\mathrm{CLS}]}' } });
    const dn = op('pooler-dense', A.linear(cls, { dout: c.D, doutSym: 'D' }), 'dense', { out: tid + 'pooler-pre', label: 'Pooler: Linear D → D' + dis + (o.paramRepeat === 0 ? ' · pesos compartidos' : ''), type: 'head', group: 'head',
      outMeta: { label: pre + 'pooler antes de tanh', tex: 'W_p h_{[\\mathrm{CLS}]} + b_p' } });
    return op('pooler-tanh', A.tanh(dn), 'tanh', { out: tid + 'pooled', label: 'Pooler: tanh' + dis, type: 'act', group: 'head',
      outMeta: { label: pre + 'salida del pooler' + dis, tex: 'p = \\tanh(W_p h_{[\\mathrm{CLS}]} + b_p)' } });
  }
  // ==================================================================== modelo `bert`
  const BERT_SRC = 'Devlin et al., BERT, NAACL 2019, arXiv:1810.04805 (§3; Apéndice A.2); HF BertForPreTraining(BertConfig(...)) ';
  const BERT_BASE = { T: 128, B: 256, maskRate: 0.15, steps: 1000000, longShare: 0.1, Tlong: 512, Tshort: 128 };
  const BERT_CONFIGS = {
    'bert-base': Object.assign({}, ENC.base, BERT_BASE, { label: 'BERT-base (preentrenamiento: MLM + NSP)', canonical: true, hf: 'bert-base-uncased',
      source: BERT_SRC + '= bert-base-uncased: 12 capas, 768, 12 cabezas, FFN 3,072, vocab 30,522, 512 posiciones, 2 segmentos; pooler, cabeza MLM atada a los word embeddings y NSP. «110M» del paper.' }),
    'bert-large': Object.assign({}, ENC.large, BERT_BASE, { label: 'BERT-large (preentrenamiento: MLM + NSP)', hf: 'bert-large-uncased',
      source: BERT_SRC + '= bert-large-uncased: 24 capas, 1,024, 16 cabezas, FFN 4,096. «340M» del paper.' }),
  };

  function bertResolve(c) {
    if (c.D % c.h !== 0) throw new Error('BERT: D = ' + c.D + ' no es divisible por h = ' + c.h + '.');
    if (c.T < 4 || c.T > c.posMax) throw new Error('BERT: T = ' + c.T + ' tokens; debe estar entre 4 ([CLS] A [SEP] B [SEP]) y ' + c.posMax + ' (posiciones aprendidas).');
    c.dh = c.D / c.h;
    c.tokens = c.T;
    c.predictions = Math.ceil(c.maskRate * c.T);   // ≈ max_predictions_per_seq (README: 20 con T = 128)
    return c;
  }

  function bertBuild(c) {
    const g = A.graph(c);
    const raw = g.input('raw-ids', shp(['T'], [c.T], 'txt', 'vec'), { label: 'Ids originales: [CLS] oración A [SEP] oración B [SEP]', tex: 't' });
    g.op('mask-tokens', A.mlm_mask(raw, { rate: c.maskRate, predictions: c.predictions }), {
      path: ['tokens', 'mask'], out: ['ids', 'mlm-labels'], where: ['Entrada (preentrenamiento)'], label: 'Enmascarar 15 % (80 % [MASK] · 10 % al azar · 10 % igual)', type: 'tensorop', group: 'embed',
      outMeta: [{ label: 'Ids de entrada (con [MASK])', tex: '\\tilde t' }, { label: 'Etiquetas del MLM (id original en las posiciones elegidas)', tex: 'y_{\\mathrm{MLM}}' }],
    });
    const x = bertBody(g, c, { path: [], where: [c.encLabel], T: c.T, Tsym: 'T', idsLabel: 'ids de WordPiece con [MASK]' });
    // MLM (BertLMPredictionHead): dense → GELU → LN → decoder atado (todas las T filas, como HF).
    const M = ['mlm-head'], WM = ['Cabeza MLM'];
    const mop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: M.concat([node]), where: WM }, extra));
    const h = mop('mlm-dense', A.linear(x, { dout: c.D, doutSym: 'D' }), 'dense', { out: 'mlm-h', label: 'MLM: Linear D → D', type: 'head', group: 'head', outMeta: { label: 'MLM · transformación densa', tex: 'H W_t + b_t' } });
    const gl = mop('mlm-gelu', A.gelu(h), 'gelu', { out: 'mlm-g', label: 'MLM: GELU', type: 'act', group: 'head', outMeta: { label: 'MLM · activación', tex: '\\mathrm{GELU}(\\cdot)' } });
    const ln = mop('mlm-ln', A.layernorm(gl), 'ln', { out: 'mlm-n', label: 'MLM: LayerNorm', type: 'norm', group: 'head', outMeta: { label: 'MLM · normalizado', tex: '\\mathrm{LN}(\\cdot)' } });
    const lg = mop('mlm-decoder', A.tied_decoder(ln, { V: c.V, tiedWith: 'tok-embed' }), 'decoder', {
      out: 'mlm-logits', label: 'MLM: decoder atado a los word embeddings (D → V, solo el sesgo es nuevo)', type: 'head', group: 'head',
      outMeta: { label: 'Logits del MLM (las T posiciones; la pérdida usa las enmascaradas)', tex: 'H\'E_{\\mathrm{tok}}^{\\top} + b' } });
    // Pooler + NSP
    const pooled = addPooler(g, c, x, { path: ['pooler'], where: ['Pooler'], labelPrefix: '' });
    const nsp = g.op('nsp', A.nsp_head(pooled), { path: ['nsp-head'], out: 'nsp-logits', where: ['Cabeza NSP'], label: 'NSP: Linear D → 2 (IsNext / NotNext)', type: 'head', group: 'head',
      outMeta: { label: 'Logits de NSP', tex: 'W_{\\mathrm{nsp}}\\,p' } });
    // Pérdidas (preentrenamiento: L = L_MLM + L_NSP)
    const lab = g.tensor('mlm-labels');
    const nl = g.input('nsp-label', shp(['1'], [1], 'txt', 'vec'), { label: 'Etiqueta de NSP (1 = B sigue a A, 50 %)', tex: 'y_{\\mathrm{NSP}}' });
    const l1 = g.op('mlm-loss', A.cross_entropy(lg, lab, { rows: c.predictions }), { path: ['loss', 'mlm'], out: 'loss-mlm', where: ['Pérdida'], label: 'Cross-entropy del MLM (solo las posiciones elegidas)', type: 'loss', group: 'head',
      outMeta: { label: 'Pérdida del MLM', tex: '\\mathcal{L}_{\\mathrm{MLM}}' } });
    const l2 = g.op('nsp-loss', A.cross_entropy(nsp, nl, { rows: 1 }), { path: ['loss', 'nsp'], out: 'loss-nsp', where: ['Pérdida'], label: 'Cross-entropy de NSP', type: 'loss', group: 'head',
      outMeta: { label: 'Pérdida de NSP', tex: '\\mathcal{L}_{\\mathrm{NSP}}' } });
    g.op('loss-sum', A.add(l1, l2), { path: ['loss', 'sum'], out: 'loss', where: ['Pérdida'], label: 'Suma de las dos pérdidas', type: 'loss', group: 'head',
      outMeta: { label: 'Pérdida de preentrenamiento', tex: '\\mathcal{L} = \\mathcal{L}_{\\mathrm{MLM}} + \\mathcal{L}_{\\mathrm{NSP}}' } });
    return g;
  }

  const isScore = (o) => o.prim === 'attention_scores' || o.prim === 'attention_weighted_sum';
  const sumOps = (r, f) => r.ops.filter(f).reduce((s, o) => s + o.macs * o.repeat, 0);
  const node = (r, id) => r.totals.byNode[id] || { params: 0, macs: 0, other: 0 };
  const pathOf = (r, key) => r.totals.byPath[key] || { params: 0, macs: 0, other: 0 };

  function bertQuantities(c, r) {
    const t = r.totals, L = c.L;
    const emb = node(r, 'embed'), enc = node(r, 'encoder'), pool = node(r, 'pooler'), mlm = node(r, 'mlm-head'), nsp = node(r, 'nsp-head');
    const score = sumOps(r, isScore);
    const dec = r.ops.find((o) => o.id === 'mlm-decoder');
    return {
      T: c.T, B: c.B, L, D: c.D, h: c.h, dh: c.dh, Dmlp: c.Dmlp, V: c.V,
      embedParams: emb.params, encoderParams: enc.params, layerParams: enc.params / L, poolerParams: pool.params, mlmHeadParams: mlm.params,
      nspParams: nsp.params, mlmTiedParams: c.V * c.D, bodyParams: emb.params + enc.params, headsParams: pool.params + mlm.params + nsp.params,
      tokEmbedParams: node(r, 'tok').params, posEmbedParams: node(r, 'pos').params, typeEmbedParams: node(r, 'type').params,
      embedMacs: emb.macs, encoderMacs: enc.macs, layerMacs: enc.macs / L, mlmHeadMacs: mlm.macs, mlmDecoderMacs: dec.macs, poolerMacs: pool.macs, nspMacs: nsp.macs,
      scoreMacs: score, scoreMacsLayer: score / L, attnMacs: node(r, 'mhsa').macs, mlpMacs: node(r, 'mlp').macs,
      // La implementación original (TF, run_pretraining.py: gather_indexes) aplica la cabeza MLM solo a las posiciones elegidas.
      mlmHeadMacsGathered: c.predictions * (c.D * c.D + c.D * c.V),
      maskRate: c.maskRate, mlmPredictions: c.predictions, mlmMaskTokens: 0.8 * c.predictions, mlmRandomTokens: 0.1 * c.predictions, mlmKeptTokens: 0.1 * c.predictions,
      maskShare: 0.8, randomShare: 0.1, keepShare: 0.1, nspPositiveShare: 0.5,
      crossoverT: 2 * c.D + c.Dmlp,
    };
  }

  function bertMetrics(c, r, o) {
    const q = r.quantities, t = r.totals;
    const arch = {};
    ['T'].forEach((k) => { if (r.overrides[k] !== undefined) arch[k] = r.overrides[k]; });
    const at = (T) => A.run(r.id, Object.assign({}, arch, { T }));
    const short = at(c.Tshort), long = at(c.Tlong);
    // Preentrenamiento (≈, regla backward = 2 × forward → 3 × forward por secuencia): 1M pasos de B = 256, 90 % con 128 y 10 % con 512.
    // pretrainMacs es el de BERT (B = 256 del paper) aunque el knob B cambie; stepMacs usa el B del knob.
    const stepMacs = (rr, B) => 3 * B * rr.totals.macs;
    const pretrainMacs = c.steps * ((1 - c.longShare) * stepMacs(short, BERT_BASE.B) + c.longShare * stepMacs(long, BERT_BASE.B));
    const fwd = roof(2 * c.B * t.macs, 2 * t.params, H100);
    return {
      embedParams: q.embedParams, encoderParams: q.encoderParams, layerParams: q.layerParams, poolerParams: q.poolerParams, mlmHeadParams: q.mlmHeadParams,
      nspParams: q.nspParams, mlmTiedParams: q.mlmTiedParams, bodyParams: q.bodyParams, headsParams: q.headsParams,
      embedParamsShare: q.embedParams / t.params, encoderParamsShare: q.encoderParams / t.params, headsParamsShare: q.headsParams / t.params,
      macsPerSequence: t.macs, macsPerToken: t.macs / c.T, encoderMacs: q.encoderMacs, layerMacs: q.layerMacs, mlmHeadMacs: q.mlmHeadMacs,
      mlmDecoderMacs: q.mlmDecoderMacs, mlmHeadMacsGathered: q.mlmHeadMacsGathered, poolerMacs: q.poolerMacs, nspMacs: q.nspMacs,
      mlmHeadMacsShare: q.mlmHeadMacs / t.macs,
      scoreMacs: q.scoreMacs, attnScoreShare: q.scoreMacs / t.macs, attnScoreShareEncoder: q.scoreMacs / q.encoderMacs,
      maskRate: c.maskRate, mlmPredictions: q.mlmPredictions, mlmMaskTokens: q.mlmMaskTokens, mlmRandomTokens: q.mlmRandomTokens, mlmKeptTokens: q.mlmKeptTokens,
      maskShare: 0.8, randomShare: 0.1, keepShare: 0.1, nspPositiveShare: 0.5,
      tokensPerBatch: c.B * c.T, stepMacs: stepMacs(r, c.B), pretrainMacs,
      forwardBatchMsH100: fwd.ms, forwardBatchBound: fwd.bound, bandwidth: H100.bandwidth, peakFlops: H100.peakFlops, hardwareSource: H100.source,
      crossoverT: q.crossoverT,
      tScaling: [32, 64, 128, 256, 512].filter((T) => T <= c.posMax).map((T) => {
        const rr = at(T), sc = sumOps(rr, isScore), enc = node(rr, 'encoder').macs;
        return { T, macs: rr.totals.macs, encoderMacs: enc, scoreMacs: sc, attnScoreShareEncoder: sc / enc, mlmHeadMacs: node(rr, 'mlm-head').macs };
      }),
      units: BERT_UNITS,
    };
  }
  const BERT_UNITS = {
    embedParams: 'params', encoderParams: 'params', layerParams: 'params', poolerParams: 'params', mlmHeadParams: 'params', nspParams: 'params', mlmTiedParams: 'params',
    bodyParams: 'params', headsParams: 'params', embedParamsShare: 'pct', encoderParamsShare: 'pct', headsParamsShare: 'pct',
    macsPerSequence: 'macs', macsPerToken: 'macs', encoderMacs: 'macs', layerMacs: 'macs', mlmHeadMacs: 'macs', mlmDecoderMacs: 'macs', mlmHeadMacsGathered: 'macs',
    poolerMacs: 'macs', nspMacs: 'macs', mlmHeadMacsShare: 'pct', scoreMacs: 'macs', attnScoreShare: 'pct', attnScoreShareEncoder: 'pct',
    maskRate: 'pct', mlmPredictions: 'count', mlmMaskTokens: 'count', mlmRandomTokens: 'count', mlmKeptTokens: 'count', maskShare: 'pct', randomShare: 'pct', keepShare: 'pct',
    nspPositiveShare: 'pct', tokensPerBatch: 'count', stepMacs: 'macs', pretrainMacs: 'macs',
    forwardBatchMsH100: 'ms', bandwidth: 'count', peakFlops: 'count', crossoverT: 'count',
  };

  A.defineModel({
    id: 'bert',
    label: 'BERT (encoder bidireccional, MLM + NSP)',
    paper: { title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', authors: 'Devlin, Chang, Lee y Toutanova', venue: 'NAACL 2019', year: 2019, arxiv: '1810.04805',
      note: 'RoBERTa (Liu et al. 2019, arXiv:1907.11692): sin NSP, más datos y enmascarado dinámico.' },
    configs: BERT_CONFIGS,
    knobs: { T: [32, 64, 128, 256, 512], B: [1, 32, 256] },
    hardware: Object.assign({}, H100),
    resolve: bertResolve,
    build: bertBuild,
    quantities: bertQuantities,
    metrics: bertMetrics,
  });

  // ==================================================================== modelo `retrieval`
  // Corpus: Wikipedia de DPR = 21,015,324 pasajes de 100 palabras (Karpukhin et al. 2020, §4.1); MS MARCO passage = 8,841,823.
  const N_WIKI = 21015324, N_MSMARCO = 8841823;
  const RET_BASE = { Tq: 32, Td: 180, k: 100, bits: 32, rerank: 1, residualBits: 2, reranker: 'cross-encoder-minilm' };
  const RET_CONFIGS = {
    'dpr-bert-base': Object.assign({}, ENC.base, RET_BASE, { label: 'DPR (2 torres BERT-base, [CLS], 768-d) + rerank cross-encoder', kind: 'bi', shared: 0, pool: 'cls', normalize: 0,
      pooler: 'none', dim: 768, Td: 256, N: N_WIKI, canonical: true, hf: 'facebook/dpr-question_encoder-single-nq-base + facebook/dpr-ctx_encoder-single-nq-base',
      source: 'Karpukhin et al., DPR, EMNLP 2020, arXiv:2004.04906 (§3.1: dos BERT-base independientes, [CLS], d = 768, producto punto; §4.1: 21,015,324 pasajes; §5.4: índice FAISS). HF DPRQuestionEncoder / DPRContextEncoder (BertModel sin pooler, projection_dim = 0). T_d = 256 = sequence_length del repo oficial (conf/encoder/hf_bert.yaml). El rerank (k = 100 pares) usa cross-encoder-minilm: DPR no rerankea (alimenta a un lector); el pipeline es ilustrativo.' }),
    'sbert-minilm': Object.assign({}, ENC.minilm, RET_BASE, { label: 'Sentence-BERT all-MiniLM-L6-v2 (siamés, mean pooling, 384-d) + rerank', kind: 'bi', shared: 1, pool: 'mean', normalize: 1,
      pooler: 'discarded', dim: 384, N: N_MSMARCO, hf: 'sentence-transformers/all-MiniLM-L6-v2',
      source: 'Reimers & Gurevych, Sentence-BERT, EMNLP 2019, arXiv:1908.10084 (red siamesa: los mismos pesos para query y documento). all-MiniLM-L6-v2: config.json (BertModel 6 × 384, 12 cabezas, FFN 1,536), modules.json (Transformer → Pooling → Normalize), 1_Pooling (mean), max_seq_length 256. AutoModel crea BertModel con pooler: el forward lo calcula (pooler_output) y mean pooling lo descarta. T_d = 180 y N = MS MARCO para comparar con ColBERT.' }),
    'cross-encoder-minilm': Object.assign({}, ENC.minilm, RET_BASE, { label: 'Cross-encoder ms-marco-MiniLM-L-6-v2 (query + documento juntos → puntaje)', kind: 'cross', shared: 0,
      pooler: 'used', dim: 384, rerank: 0, N: N_MSMARCO, hf: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
      source: 'Nogueira & Cho 2019 (BERT como re-ranker de pasajes, arXiv:1901.04085); cross-encoder/ms-marco-MiniLM-L-6-v2: config.json (BertForSequenceClassification, 6 × 384, 12 cabezas, FFN 1,536, num_labels 1). Entrada [CLS] query [SEP] documento [SEP] = T_q + T_d − 1 tokens; puntaje = Linear(pooler) → 1.' }),
    'colbert-v2': Object.assign({}, ENC.base, RET_BASE, { label: 'ColBERTv2 (BERT-base + Linear 768 → 128 por token, MaxSim)', kind: 'late', shared: 1, pooler: 'discarded', dim: 128, bits: 16,
      rerank: 0, k: 1000, N: N_MSMARCO, hf: 'colbert-ir/colbertv2.0',
      source: 'Khattab & Zaharia, ColBERT, SIGIR 2020, arXiv:2004.12832 (un BERT para query y documento con marcadores [Q] / [D]; Linear sin sesgo a 128; normalizar por token; MaxSim; re-rank de 1,000); Santhanam et al., ColBERTv2, NAACL 2022, arXiv:2112.01488 (§3.3: compresión residual, 20 / 36 bytes por vector con 1 / 2 bits; §5.3: 154 GiB ColBERT vs 16 / 25 GiB). colbert-ir/colbertv2.0 artifact.metadata: dim 128, query_maxlen 32, doc_maxlen 180. HF_ColBERT: BertModel(config) (con pooler: se calcula y se descarta, el modelo lee last_hidden_state) + Linear(768, 128, bias = False). bits = 16: ColBERT v1 guarda fp16.' }),
  };

  function retApplyKnobs(c, ov) {
    Object.assign(c, ov);
    const changed = Object.keys(ov);
    if (changed.length) c._notes = changed.map((k) => k + ' = ' + ov[k] + ' (what-if)');
    return c;
  }
  function retResolve(c) {
    const W = 'Recuperación: ';
    if (c.D % c.h !== 0) throw new Error(W + 'D = ' + c.D + ' no es divisible por h = ' + c.h + '.');
    if (c.Tq < 3 || c.Td < 3) throw new Error(W + 'T_q y T_d deben ser ≥ 3 ([CLS] … [SEP]); recibí ' + c.Tq + ' y ' + c.Td + '.');
    const maxT = c.kind === 'cross' ? c.Tq + 2 : Math.max(c.Tq, c.Td);
    if (maxT > c.posMax) throw new Error(W + (c.kind === 'cross' ? 'T_q = ' + c.Tq + ' no deja lugar al documento en ' + c.posMax : 'T = ' + maxT + ' tokens; el máximo es ' + c.posMax) + ' (posiciones aprendidas).');
    if ([32, 16, 8, 4, 1].indexOf(c.bits) < 0) throw new Error(W + 'bits = ' + c.bits + '; usa 32, 16, 8, 4 o 1.');
    if (c.kind === 'bi' && c.dim > c.D) throw new Error(W + 'dim = ' + c.dim + ' es mayor que D = ' + c.D + ' (dim trunca el embedding: Matryoshka).');
    if (c.k > c.N) throw new Error(W + 'k = ' + c.k + ' candidatos y el corpus tiene N = ' + c.N + '.');
    if (c.rerank !== 0 && c.rerank !== 1) throw new Error(W + 'rerank es 0 o 1.');
    if (c.kind === 'cross') c.rerank = 0;
    // Par del cross-encoder ([CLS] q [SEP] d [SEP] = T_q + T_d − 1): si pasa de las posiciones del cross-encoder (512), se recorta
    // el DOCUMENTO (truncation = 'only_second' de HF; CrossEncoder con max_length 512). En la config cross-encoder es su entrada;
    // en las demás, la del reranker (si rerank = 1).
    const rc = c.kind === 'cross' ? c : RET_CONFIGS[c.reranker];
    const rMax = (rc && rc.posMax) || 512;
    c.pairT = Math.min(c.Tq + c.Td - 1, rMax);
    c.pairTrunc = c.Tq + c.Td - 1 > rMax ? 1 : 0;
    c.TdPair = c.pairT - c.Tq + 1;
    if (c.pairTrunc && (c.kind === 'cross' || c.rerank)) {
      (c._notes = c._notes || []).push('par del cross-encoder truncado a ' + rMax + ' tokens: el documento entra con ' + c.TdPair + ' de sus ' + c.Td + ' tokens (truncation = only_second)');
    }
    c.dh = c.D / c.h;
    c.T = c.kind === 'cross' ? c.pairT : c.Tq;
    c.tokens = c.T;
    return c;
  }

  // Una torre (query o documento) de un bi-encoder / ColBERT. → handle del embedding final (<p>emb).
  function tower(g, c, side) {
    const q = side === 'q';
    const p = q ? 'q-' : 'd-';
    const P = [q ? 'query-encoder' : 'doc-encoder'];
    const W = [(q ? 'Encoder de queries (' : 'Encoder de documentos (') + c.encLabel + ')'];
    const pre = q ? 'Query · ' : 'Documento · ';
    const T = q ? c.Tq : c.Td, Ts = q ? 'T_q' : 'T_d';
    const shared = !q && !!c.shared;
    const x = bertBody(g, c, { tid: p, oid: p, path: P, where: W, labelPrefix: pre, T, Tsym: Ts, paramL: shared ? 0 : undefined,
      idsLabel: q ? (c.kind === 'late' ? 'ids de la query ([CLS] [Q] … [MASK]… relleno a T_q)' : 'ids de la query ([CLS] … [SEP])') : (c.kind === 'late' ? 'ids del documento ([CLS] [D] … [SEP])' : 'ids del documento ([CLS] título [SEP] texto [SEP])') });
    // BertModel con pooler (Sentence-BERT, ColBERT): el forward lo CALCULA (pooler_output) aunque el modelo no lo lea.
    if (c.pooler === 'discarded') addPooler(g, c, x, { tid: p, oid: p, path: P.concat(['pooler']), where: W.concat(['pooler']), labelPrefix: pre, paramRepeat: shared ? 0 : undefined, discarded: true });
    const sh = shared ? { paramRepeat: 0 } : {};
    if (c.kind === 'late') {
      const pj = g.op(p + 'linear', A.linear(x, { dout: c.dim, doutSym: 'dim', bias: false }), Object.assign({ path: P.concat(['linear']), out: p + 'lin', where: W,
        label: 'Linear D → dim sin sesgo (por token)' + (shared ? ' · pesos compartidos' : ''), type: 'embed', group: 'head',
        outMeta: { label: pre + 'vectores de token proyectados', tex: 'HW' } }, sh));
      return g.op(p + 'normalize', A.l2_normalize(pj), { path: P.concat(['normalize']), out: p + 'emb', where: W, label: 'Normalizar cada vector (‖·‖ = 1)', type: 'norm', group: 'head',
        outMeta: { label: pre + 'un vector de dim por token (normalizado)', tex: q ? 'E_q' : 'E_d' } });
    }
    const PP = [q ? 'q-pool' : 'd-pool'];
    const steps = [];
    const mean = c.pool === 'mean';
    // Sin truncar, el vector del pooling ya es el embedding guardado: se llama dim (= D), como N × dim del índice.
    const po = c.dim < c.D ? null : { sym: 'dim' };
    steps.push({ id: 'pool', tid: mean ? 'mean' : 'cls-vec', res: (h) => (mean ? A.mean_pool(h, po) : A.pool_cls(h, po)), node: mean ? 'mean' : 'cls', label: mean ? 'Mean pooling (promedio de los T vectores)' : 'Tomar [CLS] (fila 0)',
      meta: { label: pre + (mean ? 'promedio de los vectores de token' : 'vector de [CLS]'), tex: mean ? '\\bar h' : 'h_{[\\mathrm{CLS}]}' }, type: 'tensorop' });
    if (c.dim < c.D) steps.push({ id: 'truncate', tid: 'trunc', res: (h) => A.truncate_dim(h, { dim: c.dim }), node: 'truncate', label: 'Truncar a dim (Matryoshka, what-if)', meta: { label: pre + 'primeras dim coordenadas', tex: 'h_{1:dim}' }, type: 'tensorop' });
    if (c.normalize) steps.push({ id: 'normalize', tid: 'normed', res: (h) => A.l2_normalize(h), node: 'normalize', label: 'Normalizar (‖·‖ = 1: producto punto = coseno)', meta: { label: pre + 'vector normalizado', tex: 'h/\\lVert h\\rVert' }, type: 'norm' });
    let h = x;
    steps.forEach((s, i) => {
      const last = i === steps.length - 1;
      h = g.op(p + s.id, s.res(h), { path: PP.concat([s.node]), out: last ? p + 'emb' : p + s.tid, where: W.concat(['pooling']), label: s.label, type: s.type, group: 'head',
        outMeta: last ? { label: pre + 'embedding (un vector por texto)', tex: q ? 'e_q' : 'e_d' } : s.meta });
    });
    return h;
  }

  // Grafo del cross-encoder (también lo importa el rerank de los bi-encoders): ids del par → BERT → pooler → Linear D → 1.
  function crossGraph(g, c) {
    const W = ['Cross-encoder (' + c.encLabel + ')'];
    const x = bertBody(g, c, { path: ['joint-encoder'], where: W, labelPrefix: 'Par · ', T: c.pairT, Tsym: c.pairTrunc ? String(c.pairT) : 'T_q+T_d-1',
      idsLabel: 'ids del par: [CLS] query [SEP] documento [SEP]' + (c.pairTrunc ? ' (truncado a ' + c.pairT + ': el documento entra con ' + c.TdPair + ' tokens)' : '') });
    const pooled = addPooler(g, c, x, { path: ['pooler'], where: W.concat(['pooler']), labelPrefix: 'Par · ' });
    return g.op('score-head', A.score_head(pooled), { path: ['score-head'], out: 'score', where: W.concat(['cabeza']), label: 'Puntaje: Linear D → 1 (con sesgo)', type: 'head', group: 'head',
      outMeta: { label: 'Puntaje de relevancia del par', tex: 's(q, d)' } });
  }
  const crossMemo = {};
  // El cross-encoder del rerank con los T_q y T_d de la config (su resolve trunca el par a 512 si hace falta).
  function crossData(c) {
    const key = c.reranker + '|' + c.Tq + '|' + c.Td;
    if (!crossMemo[key]) {
      const rc = A.run(c.reranker, { Tq: c.Tq, Td: c.Td });
      crossMemo[key] = { r: rc, data: { ops: rc.ops, tensors: rc.tensors } };
    }
    return crossMemo[key];
  }

  function retBuild(c) {
    const g = A.graph(c);
    if (c.kind === 'cross') { crossGraph(g, c); return g; }
    const qe = tower(g, c, 'q');
    const de = tower(g, c, 'd');
    const late = c.kind === 'late';
    // Índice offline: los N embeddings de documento.
    const idx = g.op('index', A.embed_index(de, { N: c.N, bits: c.bits }), { path: ['index'], out: 'doc-index', where: ['Índice (offline)'],
      label: 'Guardar los N embeddings de documento (offline, ' + c.bits + ' bits por número)', type: 'tensorop', group: 'embed',
      outMeta: { label: late ? 'Índice: T_d vectores por documento × N documentos' : 'Índice: un vector por documento × N documentos', tex: late ? '\\{E_d\\}' : 'E = [e_{d_1}; …; e_{d_N}]' } });
    if (late) {
      // MaxSim de UN par (query, documento): token_sim → máximo por token de la query → suma.
      const W = ['MaxSim (interacción tardía)'];
      const s = g.op('sim', A.token_sim(qe, de), { path: ['maxsim', 'sim'], out: 'sim', where: W, label: 'Similitud de cada token de la query con cada token del documento', type: 'attn', group: 'head',
        outMeta: { label: 'MaxSim · similitudes token a token', tex: 'E_q E_d^{\\top}' } });
      const m = g.op('max', A.max_reduce(s), { path: ['maxsim', 'max'], out: 'sim-max', where: W, label: 'Máximo por token de la query (sobre los T_d del documento)', type: 'tensorop', group: 'head',
        outMeta: { label: 'MaxSim · mejor token del documento para cada token de la query', tex: '\\max_j\\, q_i\\cdot d_j' } });
      g.op('sum', A.sum_reduce(m), { path: ['maxsim', 'sum'], out: 'score', where: W, label: 'Suma sobre los tokens de la query', type: 'tensorop', group: 'head',
        outMeta: { label: 'Puntaje ColBERT del par', tex: 's(q, d) = \\textstyle\\sum_i \\max_j q_i\\cdot d_j' } });
      return g;
    }
    // Búsqueda exacta (flat) contra el índice → top-k → (rerank) → resultados.
    const sc = g.op('search', A.dot_score(qe, idx, { metric: c.normalize ? 'cos' : 'ip' }), { path: ['ann-search', 'scan'], out: 'doc-scores', where: ['Búsqueda'],
      label: 'Búsqueda exacta (flat): e_q · e_d para los N documentos (un índice ANN la hace sublineal)', type: 'attn', group: 'head',
      outMeta: { label: 'Puntaje de cada documento del corpus', tex: 'E\\,e_q' } });
    const top = g.op('topk', A.topk_scores(sc, { k: c.k }), { path: ['ann-search', 'topk'], out: 'topk-ids', where: ['Búsqueda'], label: 'Top-k candidatos', type: 'tensorop', group: 'head',
      outMeta: { label: 'Ids de los k mejores documentos', tex: '\\mathrm{top}\\text{-}k' } });
    let final = top;
    if (c.rerank) {
      const cd = crossData(c), rc = cd.r.config;
      const WR = ['Reranker (cross-encoder ' + rc.encLabel + ')'];
      const pair = g.op('make-pairs', A.pair_tokens(g.tensor('q-ids'), top, { Td: c.Td, T: rc.pairT, sym: rc.pairTrunc ? String(rc.pairT) : undefined }), { path: ['rerank', 'pairs'], out: 'r-ids', where: WR, repeat: c.k,
        label: 'Armar cada par [CLS] query [SEP] documento [SEP] (× k)' + (rc.pairTrunc ? ' — truncado a ' + rc.pairT + ' tokens: el documento entra con ' + rc.TdPair + ' de sus ' + c.Td + ' (only_second)' : ''), type: 'tensorop', group: 'embed',
        outMeta: { label: 'Rerank · ids de un par (query + candidato)', tex: '[q; d]' } });
      // El grafo del cross-encoder (modelo `retrieval`, config del reranker con los mismos T_q y T_d), con cada op × k pares.
      const src = { tensors: cd.data.tensors, ops: cd.data.ops.map((op) => Object.assign({}, op, { repeat: op.repeat * c.k, paramRepeat: A.paramRep(op) })) };
      const hs = A.importGraph(g, src, {
        inputs: { ids: pair.id }, tensorId: (id) => 'r-' + id, opId: (id) => 'r-' + id,
        // El reranker (MiniLM) tiene otro ancho que el bi-encoder (BERT-base): sus símbolos llevan _r para no chocar con D, h, d_h, D_mlp.
        sym: { D: 'D_r', h: 'h_r', d_h: 'd_r', D_mlp: 'D_mlp,r', V: 'V_r' },
        path: (pp) => ['rerank'].concat(pp), where: (w) => WR.concat(w.slice(1)), label: (l) => 'Rerank · ' + l,
      });
      const st = g.op('rerank-collect', A.stack_batch(hs.score, { B: c.k, Bsym: 'k' }), { path: ['rerank', 'collect'], out: 'rerank-scores', where: WR, label: 'Juntar los k puntajes', type: 'tensorop', group: 'head',
        outMeta: { label: 'Puntajes del reranker (uno por candidato)', tex: 's(q, d_{1..k})' } });
      final = st;
    }
    g.op('results', A.topk_scores(final, { k: c.k }), { path: ['results'], out: 'results', where: ['Resultados'], label: c.rerank ? 'Ordenar por el puntaje del reranker' : 'Ordenar los k candidatos', type: 'tensorop', group: 'head',
      outMeta: { label: 'Resultados ordenados', tex: 'd_{(1)}, …, d_{(k)}' } });
    return g;
  }

  // Costos por partes (exactos del grafo) para quantities / metrics.
  function retParts(c, r) {
    const P = (k) => pathOf(r, k);
    // Cross-encoder: no hay torres (queryEncodeMacs / docEncodeMacs quedan sin definir → "—" en las tablas); su rerank es k pares.
    if (c.kind === 'cross') {
      const t = r.totals;
      return { pairMacs: t.macs, pairParams: t.params, crossParams: t.params, rerankMacs: c.k * t.macs, rerankerParams: 0, searchMacs: 0, maxsimMacs: 0, hasCross: true };
    }
    const qMacs = P('query-encoder').macs + P('q-pool').macs, dMacs = P('doc-encoder').macs + P('d-pool').macs;
    const qPar = P('query-encoder').params + P('q-pool').params, dPar = P('doc-encoder').params + P('d-pool').params;
    // ColBERT no usa cross-encoder: sin par ni rerank de MiniLM. Un bi-encoder sí lo compara (el reranker de su pipeline) aunque
    // rerank = 0 (crossVsBiPerQuery: por qué no se rerankea todo).
    const cd = c.kind === 'bi' ? crossData(c) : null;
    return {
      queryEncodeMacs: qMacs, docEncodeMacs: dMacs, towerParams: qPar, docTowerParams: dPar,
      searchMacs: P('ann-search').macs, rerankMacs: P('rerank').macs, rerankerParams: P('rerank').params,
      pairMacs: cd ? cd.r.totals.macs : 0, crossParams: cd ? cd.r.totals.params : 0, maxsimMacs: P('maxsim').macs, hasCross: !!cd,
    };
  }

  function retQuantities(c, r) {
    const p = retParts(c, r), t = r.totals;
    const q = {
      Tq: c.Tq, Td: c.Td, T: c.T, N: c.N, k: c.k, dim: c.dim, bits: c.bits, L: c.L, D: c.D, h: c.h, dh: c.dh, Dmlp: c.Dmlp, V: c.V,
      pairTokens: c.pairT, shared: c.shared ? 1 : 0, rerank: c.rerank, searchMacs: p.searchMacs,
    };
    // Solo lo que existe en cada config (el bloque compare lee quantities primero: lo que falta sale "—").
    if (c.kind !== 'cross') Object.assign(q, { queryEncodeMacs: p.queryEncodeMacs, docEncodeMacs: p.docEncodeMacs, towerParams: p.towerParams, docTowerParams: p.docTowerParams,
      biEncoderParams: t.params - p.rerankerParams, rerankerParams: p.rerankerParams });
    if (p.hasCross) Object.assign(q, { crossEncoderParams: p.crossParams, crossEncoderMacsPerPair: p.pairMacs });
    if (c.kind === 'cross' || c.rerank) q.rerankMacs = p.rerankMacs;
    if (c.kind === 'late') q.maxsimMacsPerDoc = p.maxsimMacs;
    return q;
  }

  function retMetrics(c, r, o) {
    const p = retParts(c, r), t = r.totals, by = c.bits / 8;
    const late = c.kind === 'late', cross = c.kind === 'cross';
    const pairMacs = p.pairMacs, runsRerank = cross || !!c.rerank;
    const out = {
      Tq: c.Tq, Td: c.Td, N: c.N, k: c.k, dim: c.dim, bits: c.bits, pairTokens: c.pairT,
      bandwidth: H100.bandwidth, peakFlops: H100.peakFlops, hardwareSource: H100.source, cpuBandwidth: CPU.bandwidth, cpuPeakFlops: CPU.peakFlops, cpuSource: CPU.source,
    };
    // El cross-encoder (el de la config o el reranker de un bi-encoder): costo por par y sobre todo el corpus (lo que NO se hace).
    if (p.hasCross) Object.assign(out, { crossEncoderMacsPerPair: pairMacs, crossEncoderFullScanMacs: c.N * pairMacs, crossEncoderParams: p.crossParams });
    // El rerank (k pares) solo donde corre: rerank = 1 o la config cross-encoder.
    const rr = roof(2 * c.k * pairMacs, 2 * p.crossParams, H100);
    if (runsRerank) Object.assign(out, { rerankMacs: c.k * pairMacs, rerankMs: rr.ms, rerankBound: rr.bound });
    if (cross) {
      out.pairsPerSecH100 = 1000 * c.k / rr.ms;
      out.crossEncoderFullScanMs = roof(2 * c.N * pairMacs, 2 * p.crossParams, H100).ms;
      out.units = RET_UNITS;
      return out;
    }
    const qr = roof(2 * p.queryEncodeMacs, 2 * p.towerParams, H100);
    const corpus = roof(2 * c.N * p.docEncodeMacs, 2 * (p.docTowerParams || p.towerParams), H100);
    Object.assign(out, {
      queryEncodeMacs: p.queryEncodeMacs, docEncodeMacs: p.docEncodeMacs, corpusEncodeMacs: c.N * p.docEncodeMacs,
      towerParams: p.towerParams, docTowerParams: p.docTowerParams, biEncoderParams: t.params - p.rerankerParams, rerankerParams: p.rerankerParams,
      // corpusEncodeTime = corpusEncodeMs con unidad 'duration' (s / min / h, la unidad va en el texto: '16.3 min').
      queryEncodeMs: qr.ms, queryEncodeBound: qr.bound, corpusEncodeMs: corpus.ms, corpusEncodeTime: corpus.ms,
    });
    if (late) {
      const vecs = c.N * c.Td;
      Object.assign(out, {
        maxsimMacsPerDoc: p.maxsimMacs, colbertRerankMacs: c.k * p.maxsimMacs, bruteForceMacs: c.N * p.maxsimMacs,
        colbertIndexBytes: vecs * c.dim * by, colbertV1IndexBytes: vecs * c.dim * 2,
        // ColBERTv2 (§3.3): por vector, el id del centroide (4 bytes) + el residuo a residualBits por dimensión (2 bits → 32 + 4 = 36 B).
        colbertV2IndexBytes: vecs * (c.dim * c.residualBits / 8 + 4), colbertV2BytesPerVector: c.dim * c.residualBits / 8 + 4,
        tokenVectors: vecs, embeddingIndexBytes: c.N * c.dim * by,
        singleVectorRatio: c.Td,
      });
      out.bruteForceBytes = out.colbertIndexBytes;
    } else {
      out.bruteForceMacs = c.N * c.dim;
      out.embeddingIndexBytes = c.N * c.dim * by;
      out.bruteForceBytes = out.embeddingIndexBytes;
      out.embeddingIndexBytes32 = c.N * c.dim * 4;
      out.colbertIndexBytes = c.N * c.Td * 128 * by;   // what-if: el mismo corpus como ColBERT (128-d por token)
    }
    const bfH = roof(2 * out.bruteForceMacs, out.bruteForceBytes, H100), bfC = roof(2 * out.bruteForceMacs, out.bruteForceBytes, CPU);
    Object.assign(out, {
      bruteForceMsH100: bfH.ms, bruteForceMsCpu: bfC.ms, bruteForceBoundCpu: bfC.bound,
      onlineMacsPerQuery: p.queryEncodeMacs + out.bruteForceMacs + (c.rerank ? c.k * pairMacs : 0),
      onlineMsH100: qr.ms + bfH.ms + (c.rerank ? rr.ms : 0),
      rerankShareOnline: c.rerank ? (c.k * pairMacs) / (p.queryEncodeMacs + out.bruteForceMacs + c.k * pairMacs) : 0,
      bruteForceShareOnline: out.bruteForceMacs / (p.queryEncodeMacs + out.bruteForceMacs + (c.rerank ? c.k * pairMacs : 0)),
      queryVsDocEncode: p.docEncodeMacs / p.queryEncodeMacs,
    });
    if (p.hasCross) out.crossVsBiPerQuery = (c.N * pairMacs) / (p.queryEncodeMacs + out.bruteForceMacs);
    if (!late) {
      out.bitsScaling = [32, 16, 8, 1].map((b) => ({ bits: b, embeddingIndexBytes: c.N * c.dim * b / 8, bruteForceMsCpu: roof(2 * c.N * c.dim, c.N * c.dim * b / 8, CPU).ms }));
      out.dimScaling = [64, 128, 256, 384, 512, 768].filter((d) => d <= c.D).map((d) => ({ dim: d, embeddingIndexBytes: c.N * d * by, bruteForceMacs: c.N * d }));
    }
    out.nScaling = [1e5, 1e6, 1e7, 1e8, 1e9].map((N) => Object.assign({ N, corpusEncodeMacs: N * p.docEncodeMacs,
      indexBytes: late ? N * c.Td * c.dim * by : N * c.dim * by, bruteForceMacs: late ? N * p.maxsimMacs : N * c.dim }, p.hasCross ? { crossEncoderFullScanMacs: N * pairMacs } : {}));
    out.units = RET_UNITS;
    return out;
  }
  const RET_UNITS = {
    Tq: 'count', Td: 'count', N: 'count', k: 'count', dim: 'count', bits: 'count',
    crossEncoderMacsPerPair: 'macs', rerankMacs: 'macs', crossEncoderFullScanMacs: 'macs', crossEncoderParams: 'params', rerankMs: 'ms', pairsPerSecH100: 'count',
    crossEncoderFullScanMs: 'ms', pairTokens: 'count', corpusEncodeTime: 'duration', queryEncodeMacs: 'macs', docEncodeMacs: 'macs', corpusEncodeMacs: 'macs', towerParams: 'params', docTowerParams: 'params',
    biEncoderParams: 'params', rerankerParams: 'params', queryEncodeMs: 'ms', corpusEncodeMs: 'ms', maxsimMacsPerDoc: 'macs', colbertRerankMacs: 'macs',
    bruteForceMacs: 'macs', colbertIndexBytes: 'bytes', colbertV1IndexBytes: 'bytes', colbertV2IndexBytes: 'bytes', colbertV2BytesPerVector: 'bytes', tokenVectors: 'count',
    embeddingIndexBytes: 'bytes', embeddingIndexBytes32: 'bytes', singleVectorRatio: 'ratio', bruteForceBytes: 'bytes', bruteForceMsH100: 'ms', bruteForceMsCpu: 'ms',
    onlineMacsPerQuery: 'macs', onlineMsH100: 'ms', rerankShareOnline: 'pct', bruteForceShareOnline: 'pct', queryVsDocEncode: 'ratio', crossVsBiPerQuery: 'ratio',
    bandwidth: 'count', peakFlops: 'count', cpuBandwidth: 'count', cpuPeakFlops: 'count',
  };

  A.defineModel({
    id: 'retrieval',
    label: 'Recuperación densa (bi-encoder, cross-encoder, ColBERT)',
    paper: { title: 'Dense Passage Retrieval for Open-Domain Question Answering', authors: 'Karpukhin et al.', venue: 'EMNLP 2020', year: 2020, arxiv: '2004.04906',
      note: 'Sentence-BERT: Reimers & Gurevych, EMNLP 2019, arXiv:1908.10084. ColBERT: Khattab & Zaharia, SIGIR 2020, arXiv:2004.12832; ColBERTv2: Santhanam et al., NAACL 2022, arXiv:2112.01488. BERT re-ranker: Nogueira & Cho 2019, arXiv:1901.04085.' },
    configs: RET_CONFIGS,
    knobs: { Tq: [8, 16, 32, 64], Td: [64, 128, 180, 256, 512], N: [100000, 1000000, 8841823, 21015324, 100000000, 1000000000], k: [10, 20, 100, 1000],
      dim: [64, 128, 256, 384, 512, 768], bits: [32, 16, 8, 1], rerank: [0, 1] },
    zeroKnobs: ['rerank'],
    hardware: Object.assign({}, H100),
    applyKnobs: retApplyKnobs,
    resolve: retResolve,
    build: retBuild,
    quantities: retQuantities,
    metrics: retMetrics,
  });

  // ==================================================================== modelo `ann`
  // Encode = el encoder de queries de DPR (BERT-base, [CLS], T_q = 32); si d ≠ 768, + Linear 768 → d (projection_dim de DPR).
  const ANN_BASE = Object.assign({}, ENC.base, { N: 1000000, d: 768, bits: 32, k: 10, Tq: 32, encode: 1, metric: 'ip',
    M: 32, efConstruction: 200, efSearch: 64, nlist: 4096, nprobe: 16, m: 96, nbits: 8, coarseM: 0, coarseEf: 64 });
  const ANN_SRC = 'FAISS 1.15.1 (Douze et al., The Faiss library, arXiv:2401.08281); ';
  const ANN_CONFIGS = {
    'hnsw-1m-768': Object.assign({}, ANN_BASE, { label: 'HNSW (M = 32) · 1M vectores de 768 fp32', kind: 'hnsw', canonical: true,
      source: ANN_SRC + 'IndexHNSWFlat(d, M = 32); efConstruction 200 y efSearch 64 los fija esta config (defaults: FAISS 40 / 16; hnswlib M 16, ef_construction 200, ef 10). Malkov & Yashunin, TPAMI 2020, arXiv:1603.09320.' }),
    'ivfpq-1m-768': Object.assign({}, ANN_BASE, { label: 'IVF-PQ (n_list 4,096, n_probe 16, m 96 × 8 bits) · 1M × 768', kind: 'ivfpq',
      source: ANN_SRC + 'IndexIVFPQ(IndexFlatL2, d, 4096, 96, 8), by_residual, tabla precalculada. n_list en [4√N, 16√N] (wiki de FAISS, Guidelines to choose an index). PQ: Jégou et al., TPAMI 2011.' }),
    'flat-1m-768': Object.assign({}, ANN_BASE, { label: 'Flat (fuerza bruta) · 1M × 768 fp32', kind: 'flat',
      source: ANN_SRC + 'IndexFlatIP(d): N productos punto exactos por query (lo que usa DPR para el índice exacto).' }),
    'ivfpq-1b-768': Object.assign({}, ANN_BASE, { label: 'IVF-PQ a escala de mil millones (n_list 2²⁰ con cuantizador HNSW32) · 1B × 768', kind: 'ivfpq', N: 1000000000,
      nlist: 1048576, coarseM: 32, coarseEf: 64,
      source: ANN_SRC + 'wiki de FAISS (Guidelines to choose an index): de 100M a 1B vectores, IVF1048576_HNSW32 (cuantizador grueso HNSW sobre los centroides); PQ 96 × 8 bits como la de 1M para comparar. n_probe 16 y efSearch 64 del cuantizador: elección de esta config.' }),
  };

  function annResolve(c) {
    const W = 'ANN: ';
    if ([32, 16, 8].indexOf(c.bits) < 0) throw new Error(W + 'bits = ' + c.bits + ' (precisión de los vectores guardados: 32, 16 u 8).');
    if (c.k > c.N) throw new Error(W + 'k = ' + c.k + ' es mayor que N = ' + c.N + '.');
    if (c.kind === 'hnsw') {
      if (c.M < 2) throw new Error(W + 'M = ' + c.M + '; HNSW necesita M ≥ 2 (el wiki de FAISS sugiere 4 ≤ M ≤ 64).');
      if (c.efSearch < c.k) throw new Error(W + 'efSearch = ' + c.efSearch + ' debe ser ≥ k = ' + c.k + ' (FAISS usa máx(efSearch, k)).');
      if (c.efSearch > c.N) throw new Error(W + 'efSearch = ' + c.efSearch + ' es mayor que N.');
    }
    if (c.kind === 'ivfpq') {
      if (c.d % c.m !== 0) throw new Error(W + 'd = ' + c.d + ' no es divisible por m = ' + c.m + ' (sub-vectores de d/m).');
      if (c.nprobe > c.nlist) throw new Error(W + 'n_probe = ' + c.nprobe + ' es mayor que n_list = ' + c.nlist + '.');
      if (c.nlist > c.N) throw new Error(W + 'n_list = ' + c.nlist + ' es mayor que N = ' + c.N + '.');
      if (c.nbits < 1 || c.nbits > 16) throw new Error(W + 'nbits = ' + c.nbits + ' (1 a 16; FAISS usa 8 por defecto).');
      c.ksub = Math.pow(2, c.nbits);
      c.scanned = Math.max(1, Math.round(c.nprobe * c.N / c.nlist));
      if (c.k > c.scanned) throw new Error(W + 'k = ' + c.k + ' y solo se recorren ≈ ' + c.scanned + ' vectores (n_probe·N/n_list).');
      const pt = c.nlist * c.m * c.ksub * 4;
      c.precomputed = pt <= 2147483648 ? 1 : 0;   // precomputed_table_max_bytes de FAISS = 2 GiB
    }
    c.dh = c.D / c.h;
    c.T = c.Tq;
    c.tokens = c.Tq;
    return c;
  }

  function annBuild(c) {
    const g = A.graph(c);
    let qv;
    if (c.encode) {
      const W = ['Codificar la query (DPR, ' + c.encLabel + ')'];
      const x = bertBody(g, c, { tid: 'q-', oid: 'q-', path: ['encode'], where: W, labelPrefix: 'Query · ', T: c.Tq, Tsym: 'T_q', idsLabel: 'ids de la query ([CLS] … [SEP])' });
      const proj = c.d !== c.D;
      // Sin proyección, el [CLS] ES el vector del índice: se llama d (= D), como en el resto de la página.
      qv = g.op('q-pool', A.pool_cls(x, proj ? null : { sym: 'd' }), { path: ['encode', 'pool'], out: proj ? 'q-cls' : 'query', where: W, label: 'Tomar [CLS] (fila 0)', type: 'tensorop', group: 'head',
        outMeta: proj ? { label: 'Query · vector de [CLS]', tex: 'h_{[\\mathrm{CLS}]}' } : { label: 'Vector de la query', tex: 'q' } });
      if (proj) {
        qv = g.op('encode-proj', A.linear(qv, { dout: c.d, doutSym: 'd' }), { path: ['encode', 'proj'], out: 'query', where: W, label: 'Linear D → d (projection_dim de DPR)', type: 'embed', group: 'head',
          outMeta: { label: 'Vector de la query', tex: 'q' } });
      }
    } else {
      qv = g.input('query', shp(['d'], [c.d], 'txt', 'vec'), { label: 'Vector de la query', tex: 'q' });
    }
    const vecLabel = 'Base: los N vectores (' + c.bits + ' bits por número)';
    if (c.kind === 'flat') {
      const xb = g.input('xb', shp(['N', 'd'], [c.N, c.d], 'txt', 'seq'), { label: vecLabel, tex: 'X' });
      const ds = g.op('scan', A.flat_scan(qv, xb, { metric: c.metric }), { path: ['scan'], out: 'dists', where: ['Búsqueda flat'], label: 'Fuerza bruta: q contra los N vectores', type: 'attn', group: 'head',
        outMeta: { label: 'Puntaje exacto de cada vector', tex: 'Xq' } });
      g.op('topk', A.topk_scores(ds, { k: c.k }), { path: ['rerank'], out: 'ids', where: ['Top-k'], label: 'Top-k (exacto)', type: 'tensorop', group: 'head',
        outMeta: { label: 'Ids de los k vecinos más cercanos', tex: '\\mathrm{top}\\text{-}k' } });
      return g;
    }
    if (c.kind === 'hnsw') {
      const xb = g.input('xb', shp(['N', 'd'], [c.N, c.d], 'txt', 'seq'), { label: vecLabel, tex: 'X' });
      const links = g.input('links', shp(['N', '2M'], [c.N, 2 * c.M], 'txt', 'seq'), { label: 'Grafo del nivel 0: 2M vecinos por nodo (int32)', tex: 'G_0' });
      const W = ['HNSW'];
      const e = g.op('upper', A.hnsw_descent(qv, xb, { N: c.N, M: c.M }), { path: ['graph-walk', 'upper'], out: 'entry', where: W.concat(['niveles superiores']),
        label: 'Descenso voraz por los niveles superiores (≈)', type: 'attn', group: 'head', outMeta: { label: 'Punto de entrada al nivel 0', tex: 'e_0' } });
      const cand = g.op('layer0', A.hnsw_beam(qv, e, xb, links, { ef: c.efSearch, M: c.M }), { path: ['graph-walk', 'layer0'], out: 'cands', where: W.concat(['nivel 0']),
        label: 'Búsqueda en el nivel 0 con ef candidatos (≈)', type: 'attn', group: 'head', outMeta: { label: 'Los ef mejores candidatos (distancias exactas)', tex: 'C_{ef}' } });
      g.op('topk', A.topk_scores(cand, { k: c.k }), { path: ['rerank'], out: 'ids', where: ['Top-k'], label: 'Quedarse con los k mejores de los ef', type: 'tensorop', group: 'head',
        outMeta: { label: 'Ids de los k vecinos (aproximados)', tex: '\\mathrm{top}\\text{-}k' } });
      return g;
    }
    // IVF-PQ
    const W = ['IVF-PQ'];
    // Con cuantizador HNSW (IVF…_HNSW32) la búsqueda gruesa devuelve los ef centroides candidatos (FAISS: ef = máx(efSearch, n_probe)),
    // no las n_list distancias: solo calcula ≈ ⌊log_M n_list⌋·M + ef·2M.
    const cres = A.ivf_coarse(qv, { nlist: c.nlist, hnsw: c.coarseM ? { M: c.coarseM, ef: Math.max(c.coarseEf, c.nprobe) } : null });
    const cd = g.op('coarse', cres, { path: ['coarse', 'dists'], out: 'coarse-dists', where: W.concat(['cuantizador grueso']),
      label: c.coarseM ? 'HNSW' + c.coarseM + ' sobre los n_list centroides: ≈ ' + fint(cres.detail.distances) + ' distancias, no ' + fint(c.nlist) + ' (≈)' : 'q contra los n_list centroides (k-means)', type: 'attn', group: 'head',
      outMeta: c.coarseM ? { label: 'Los ef centroides candidatos del HNSW (con su distancia)', tex: '\\lVert q - c_i\\rVert^2,\\ i \\in C_{ef}' } : { label: 'Distancia a cada centroide', tex: '\\lVert q - c_i\\rVert^2' } });
    const pr = g.op('probe', A.topk_scores(cd, { k: c.nprobe, kSym: 'n_probe' }), { path: ['coarse', 'probe'], out: 'probe-ids', where: W.concat(['cuantizador grueso']), label: 'Elegir las n_probe listas más cercanas', type: 'tensorop', group: 'head',
      outMeta: { label: 'Listas invertidas a recorrer', tex: 'i_1, …, i_{n_{\\mathrm{probe}}}' } });
    const rs = g.op('residual', A.ivf_residual(qv, pr, { nprobe: c.nprobe }), { path: ['list-scan', 'residual'], out: 'residuals', where: W.concat(['listas']), label: 'Residuo q − c_i por lista', type: 'tensorop', group: 'head',
      outMeta: { label: 'Residuo de la query en cada lista', tex: 'q - c_i' } });
    const lut = g.op('lut', A.pq_lut(rs, { m: c.m, nbits: c.nbits, nprobe: c.nprobe, precomputed: !!c.precomputed }), { path: ['list-scan', 'lut'], out: 'lut', where: W.concat(['cuantización de producto']),
      label: 'Tablas ADC: distancia de cada sub-vector a los k_s centroides de su sub-espacio', type: 'attn', group: 'head', outMeta: { label: 'Tablas de distancias (una por lista)', tex: 'T_{i,j,c}' } });
    const codes = g.input('codes', shp(['N', 'm'], [c.N, c.m], 'txt', 'seq'), { label: 'Códigos PQ: m sub-códigos de ' + c.nbits + ' bits por vector', tex: 'C' });
    const lids = g.input('list-ids', shp(['N'], [c.N], 'txt', 'vec'), { label: 'Ids en las listas invertidas (int64)', tex: '\\mathrm{id}' });
    const adc = g.op('adc', A.pq_scan(lut, codes, { scanned: c.scanned }), { path: ['list-scan', 'adc'], out: 'adc-dists', where: W.concat(['cuantización de producto']), label: 'Recorrer los códigos de las n_probe listas (ADC: m lecturas de tabla por código)', type: 'tensorop', group: 'head',
      outMeta: { label: 'Distancia aproximada de cada vector recorrido', tex: '\\textstyle\\sum_j T_{j, c_j}' } });
    g.op('topk', A.topk_scores(adc, { k: c.k }), { path: ['rerank'], in: ['adc-dists', lids.id], out: 'ids', where: ['Top-k'], label: 'Top-k por distancia aproximada (ids de las listas)', type: 'tensorop', group: 'head',
      outMeta: { label: 'Ids de los k vecinos (aproximados)', tex: '\\mathrm{top}\\text{-}k' } });
    return g;
  }

  // Contabilidad de índice y de búsqueda (≈ donde lo dice). Todo con los knobs de c.
  function annCost(c, r) {
    const by = c.bits / 8, d = c.d;
    const encodeMacs = pathOf(r, 'encode').macs, encodeParams = pathOf(r, 'encode').params;
    const searchMacs = r.totals.macs - encodeMacs;
    const out = { encodeMacs, encodeParams, searchMacs, flatBytes: c.N * d * 4, flatMacs: c.N * d };
    if (c.kind === 'flat') {
      const b = A.flat_bytes({ N: c.N, d, bits: c.bits });
      Object.assign(out, { indexBytes: b.total, vectorBytes: b.vectors, bytesPerVector: b.perVector, distances: c.N, bytesTouched: b.vectors,
        buildMacs: 0, searchParams: 0 });
    } else if (c.kind === 'hnsw') {
      const b = A.hnsw_bytes({ N: c.N, d, M: c.M, bits: c.bits });
      const lv = Math.max(0, Math.floor(Math.log(c.N) / Math.log(c.M)));
      const dist = lv * c.M + c.efSearch * 2 * c.M;
      // Enlaces: nivel 0 = 2M por nodo; niveles de arriba = M/(M − 1) por nodo en esperanza → ≈ 1/(2(M − 1)) de los del nivel 0.
      const l0 = 4 * c.N * 2 * c.M;
      Object.assign(out, { indexBytes: b.total, vectorBytes: b.vectors, linkBytes: b.links, layer0LinkBytes: l0, upperLinkBytes: b.links - l0, levelBytes: b.levels + b.offsets, wikiRuleBytes: b.wiki,
        bytesPerVector: b.total / c.N, linksPerVector: b.linksPerVector, levels: lv, distances: dist, upperDistances: lv * c.M, layer0Distances: c.efSearch * 2 * c.M,
        // vectores leídos + listas de vecinos leídas (≈ ef + niveles expansiones de 2M ids int32)
        bytesTouched: dist * d * by + (c.efSearch + lv) * 2 * c.M * 4,
        buildMacs: c.N * (lv * c.M + c.efConstruction * 2 * c.M) * d, searchParams: 0 });
    } else {
      const b = A.ivfpq_bytes({ N: c.N, d, nlist: c.nlist, m: c.m, nbits: c.nbits, coarseM: c.coarseM || 0 });
      const coarse = r.ops.find((o) => o.id === 'coarse').detail.distances;
      const lutBytes = c.nprobe * c.m * c.ksub * 4;
      const nTrainCoarse = Math.min(c.N, 256 * c.nlist), nTrainPQ = Math.min(c.N, 256 * c.ksub);
      const assign = c.coarseM ? coarse : c.nlist;
      Object.assign(out, { indexBytes: b.total, codeBytes: b.codes, idBytes: b.ids, centroidBytes: b.centroids, codebookBytes: b.codebooks, listSizeBytes: b.listSizes,
        coarseLinkBytes: b.coarseLinks, precomputedTableBytes: b.precomputedTable, bytesPerVector: b.perVector, compression: (d * 4) / (c.m * c.nbits / 8),
        distances: coarse + c.scanned, coarseDistances: coarse, scannedVectors: c.scanned, listSize: c.N / c.nlist,
        // Leídos por query: centroides comparados (coarse·d·4: con n_list chico son casi todo y caben en la caché L3) + códigos e ids
        // recorridos + las tablas ADC.
        bytesTouched: coarse * d * 4 + c.scanned * (c.m * c.nbits / 8 + 8) + lutBytes, centroidBytesTouched: coarse * d * 4,
        // k-means del cuantizador grueso (FAISS IndexIVF: cp.niter = 10, hasta 256 puntos por centroide) + k-means de cada sub-espacio de PQ
        // (25 iteraciones, 256·k_s puntos) + asignar y codificar los N vectores (≈).
        buildMacs: 10 * nTrainCoarse * c.nlist * d + 25 * nTrainPQ * c.ksub * d + c.N * (assign * d + c.ksub * d),
        searchParams: node(r, 'coarse').params + node(r, 'list-scan').params });
    }
    return out;
  }

  function annQuantities(c, r) {
    const k = annCost(c, r);
    const q = { N: c.N, d: c.d, bits: c.bits, k: c.k, Tq: c.Tq, encodeMacs: k.encodeMacs, encodeParams: k.encodeParams, searchMacs: k.searchMacs, searchParams: k.searchParams,
      indexBytes: k.indexBytes, distanceComputations: k.distances, bytesPerVector: k.bytesPerVector };
    if (c.kind === 'hnsw') Object.assign(q, { M: c.M, efSearch: c.efSearch, efConstruction: c.efConstruction, hnswLevels: k.levels, links0: 2 * c.M });
    if (c.kind === 'ivfpq') Object.assign(q, { nlist: c.nlist, nprobe: c.nprobe, m: c.m, nbits: c.nbits, ksub: c.ksub, dsub: c.d / c.m, scannedVectors: k.scannedVectors, listSize: k.listSize });
    return q;
  }

  function annMetrics(c, r, o) {
    const k = annCost(c, r);
    const lat = roof(2 * k.searchMacs, k.bytesTouched, CPU), enc = roof(2 * k.encodeMacs, 2 * k.encodeParams, H100);
    const ivf = c.kind === 'ivfpq';
    const centShare = ivf ? k.centroidBytesTouched / k.bytesTouched : 0;
    const out = Object.assign({}, k, {
      indexBytes: k.indexBytes, distanceComputations: k.distances, distanceComputationsFlat: c.N, distanceRatioVsFlat: c.N / k.distances,
      searchMacs: k.searchMacs, encodeMacs: k.encodeMacs, searchMacsShare: r.totals.macs ? k.searchMacs / r.totals.macs : 0, macsVsFlat: k.flatMacs / Math.max(1, k.searchMacs),
      bytesTouchedPerQuery: k.bytesTouched, bytesTouchedVsFlat: k.flatBytes / k.bytesTouched, memoryVsFlat: k.indexBytes / k.flatBytes,
      buildMacs: k.buildMacs, buildMsCpu: 1000 * 2 * k.buildMacs / CPU.peakFlops, buildTimeCpu: 1000 * 2 * k.buildMacs / CPU.peakFlops,
      latencyMs: lat.ms, latencyBound: lat.bound, qpsUpperBound: 1000 / lat.ms, encodeMsH100: enc.ms,
      bandwidth: CPU.bandwidth, peakFlops: CPU.peakFlops, hardwareSource: CPU.source, h100Bandwidth: H100.bandwidth,
      latencyKind: c.kind === 'hnsw' ? 'cota inferior (roofline; HNSW está limitado por la latencia de accesos aleatorios)'
        : ivf ? 'cota inferior (roofline; ' + Math.round(100 * centShare) + ' % de los bytes son los centroides comparados' + (c.coarseM ? ')' : ', que con n_list chico viven en la caché L3)') : 'cota inferior (roofline)',
      estimate: c.kind !== 'flat',
      units: ANN_UNITS,
    });
    // actMem (genérica) cuenta las entradas del grafo; la base de vectores, el grafo y los códigos son el ÍNDICE, no activaciones.
    const dbElems = ['xb', 'links', 'codes', 'list-ids'].filter((id) => r.tensors[id]).reduce((s, id) => s + r.tensors[id].elements, 0);
    // IVF-PQ: la misma cota sin leer los centroides de DRAM (con n_list chico caben en la caché: 4,096 × 768 × 4 = 12.6 MB) y su parte.
    if (ivf) Object.assign(out, { centroidBytesShare: centShare, latencyMsCachedCentroids: roof(2 * k.searchMacs, k.bytesTouched - k.centroidBytesTouched, CPU).ms });
    out.actMem = o.actMemBatch - dbElems * o.by * o.B;
    out.actMemPerSample = o.actMemPerSample - dbElems * o.by;
    delete out.distances; delete out.bytesTouched;
    const arch = {};
    Object.keys(r.overrides || {}).forEach((x) => { if (x in A.model('ann').knobs) arch[x] = r.overrides[x]; });
    const row = (ov) => { const rr = A.run(r.id, Object.assign({}, arch, ov)), kk = annCost(rr.config, rr); return { indexBytes: kk.indexBytes, distanceComputations: kk.distances, searchMacs: kk.searchMacs,
      bytesTouchedPerQuery: kk.bytesTouched, latencyMs: roof(2 * kk.searchMacs, kk.bytesTouched, CPU).ms }; };
    out.nScaling = [1e5, 1e6, 1e7, 1e8, 1e9].filter((N) => c.kind !== 'ivfpq' || N >= c.nlist).map((N) => Object.assign({ N }, row({ N })));
    if (c.kind === 'hnsw') out.efScaling = [16, 32, 64, 128, 256, 512].filter((ef) => ef >= c.k).map((ef) => Object.assign({ efSearch: ef }, row({ efSearch: ef })));
    if (c.kind === 'hnsw') out.mScaling = [8, 16, 32, 48, 64].map((M) => Object.assign({ M }, row({ M })));
    if (c.kind === 'ivfpq') out.nprobeScaling = [1, 4, 16, 64, 256].filter((p) => p <= c.nlist).map((p) => Object.assign({ nprobe: p }, row({ nprobe: p })));
    if (c.kind === 'ivfpq') out.mScaling = [16, 32, 48, 64, 96, 192].filter((m) => c.d % m === 0).map((m) => Object.assign({ m }, row({ m })));
    return out;
  }
  const ANN_UNITS = {
    indexBytes: 'bytes', vectorBytes: 'bytes', linkBytes: 'bytes', layer0LinkBytes: 'bytes', upperLinkBytes: 'bytes', upperDistances: 'count', layer0Distances: 'count',
    centroidBytesTouched: 'bytes', centroidBytesShare: 'pct', latencyMsCachedCentroids: 'ms', buildTimeCpu: 'duration', levelBytes: 'bytes', wikiRuleBytes: 'bytes', bytesPerVector: 'bytes', linksPerVector: 'ratio', levels: 'count',
    codeBytes: 'bytes', idBytes: 'bytes', centroidBytes: 'bytes', codebookBytes: 'bytes', listSizeBytes: 'bytes', coarseLinkBytes: 'bytes', precomputedTableBytes: 'bytes',
    compression: 'ratio', coarseDistances: 'count', scannedVectors: 'count', listSize: 'ratio', flatBytes: 'bytes', flatMacs: 'macs',
    encodeMacs: 'macs', encodeParams: 'params', searchMacs: 'macs', searchParams: 'params', distanceComputations: 'count', distanceComputationsFlat: 'count',
    distanceRatioVsFlat: 'ratio', searchMacsShare: 'pct', macsVsFlat: 'ratio', bytesTouchedPerQuery: 'bytes', bytesTouchedVsFlat: 'ratio', memoryVsFlat: 'ratio',
    buildMacs: 'macs', buildMsCpu: 'ms', latencyMs: 'ms', qpsUpperBound: 'count', encodeMsH100: 'ms', bandwidth: 'count', peakFlops: 'count', h100Bandwidth: 'count',
  };

  A.defineModel({
    id: 'ann',
    label: 'Búsqueda de vecinos aproximada (flat, HNSW, IVF-PQ)',
    paper: { title: 'Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs', authors: 'Malkov y Yashunin', venue: 'IEEE TPAMI 2020', year: 2020, arxiv: '1603.09320',
      note: 'PQ: Jégou, Douze y Schmid, Product Quantization for Nearest Neighbor Search, IEEE TPAMI 2011. FAISS: Johnson, Douze y Jégou, arXiv:1702.08734; Douze et al., The Faiss library, arXiv:2401.08281. ann-benchmarks: Aumüller et al., arXiv:1807.05614.' },
    configs: ANN_CONFIGS,
    knobs: { N: [100000, 1000000, 10000000, 100000000, 1000000000], d: [128, 256, 384, 768, 1024], M: [8, 16, 32, 48, 64], efSearch: [16, 32, 64, 128, 256, 512],
      nlist: [1024, 4096, 16384, 65536, 262144, 1048576], nprobe: [1, 4, 16, 64, 256], m: [16, 32, 48, 64, 96, 192], nbits: [4, 8], bits: [32, 16, 8], k: [1, 10, 100],
      Tq: [16, 32, 64], encode: [0, 1] },
    zeroKnobs: ['encode'],
    hardware: Object.assign({}, CPU),
    resolve: annResolve,
    build: annBuild,
    quantities: annQuantities,
    metrics: annMetrics,
  });

  // Ayudas para la UI / pruebas (no son parte del contrato de run()).
  A.retrieval = { hardware: () => [Object.assign({}, H100), Object.assign({}, CPU)], cpu: Object.assign({}, CPU), h100: Object.assign({}, H100), N_WIKI, N_MSMARCO };
})(typeof window !== 'undefined' ? window : globalThis);
