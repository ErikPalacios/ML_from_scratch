/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/bert.js
   Diagramas de BERT (SPEC §7.2, ids de §23.1), modelo `bert` (js/arch/retrieval.js), configs bert-base (canónica) y bert-large:
     bert-overview     [CLS] A [SEP] B [SEP] (tokens de ejemplo del paper, §A.1) → embeddings (token + posición + segmento → LN)
                       → L capas post-LN → dos cabezas: la MLM sobre las T posiciones (decoder ATADO a la tabla de palabras: la
                       arista de pesos atados) y [CLS] → pooler (tanh) → NSP (IsNext / NotNext).
       bert-embeddings las tres tablas (V × D, 512 × D, 2 × D), la suma y la LayerNorm.
       bert-layer      la capa POST-LN (como el Transformer original): MHSA → ⊕ → LN → FFN → ⊕ → LN; la residual entra ANTES de
                       la LayerNorm. (La de ViT, #vit, es pre-LN.)
       bert-pretraining  las dos pérdidas: enmascarar el 15 % (80 / 10 / 10) → BERT → cabeza MLM → cross-entropy solo en las
                       posiciones elegidas; [CLS] → pooler → NSP → cross-entropy; L = L_MLM + L_NSP.
   Notas, captions y recorridos con claves SIN prefijo ({{cfg.x}}, {{metrics.x}}, {{node.x.params}}): siguen la config dibujada.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'bert-base', CFGS = ['bert-base', 'bert-large'];
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 'bert', section: 'diagrama' };
  // el ejemplo del paper (§A.1, par IsNext): "[CLS] the man went to [MASK] store [SEP] he bought a gallon [MASK] milk [SEP]"
  const WORDS = ['[CLS]', 'the', 'man', 'went', 'to', 'the', 'store', '[SEP]', 'he', 'bought', 'a', 'gallon', 'of', 'milk', '[SEP]'];
  const MASKED = { 5: 1, 12: 1 };
  const toks = (masked) => WORDS.map((t, i) => ({ t, seg: i > 7 ? 1 : 0, special: t === '[CLS]' || t === '[SEP]', mask: !!(masked && MASKED[i]) }));
  const LT = { tokens: 'Tokens de ejemplo (el par del paper; la config usa T tokens); la barra de abajo es el segmento: A o B', tie: 'Pesos atados: el decoder del MLM usa la MISMA matriz de word embeddings (se cuenta una vez)' };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'bert-overview', model: 'bert', config: C, configs: CFGS, kind: 'arch', title: 'BERT — vista general',
    caption: 'Un encoder bidireccional (sin máscara causal: cada token ve a todos). Entra un par de oraciones [CLS] A [SEP] B [SEP]; a cada token se le suman tres embeddings (palabra, posición y segmento) y pasa por L capas post-LN. Salen T vectores contextuales, uno por token. En el pre-entrenamiento hay dos cabezas: la MLM predice el token original en las posiciones enmascaradas, con el decoder atado a la tabla de palabras (línea azul con puntos), y la NSP lee solo [CLS] (pooler con tanh) para decir si B sigue a A. Para recuperación (#retrieval) se usa el cuerpo y se descartan las cabezas.',
    grid: { w: 78, h: 104 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['embed', 'encoder'], mobileFocusPad: 1,
    legendText: LT,
    groups: [
      { id: 'enc-group', label: 'Encoder (post-LN)', x: 8, y: 34, w: 62, h: 17, repeat: { sym: 'L', from: 'L', totalOf: 'encoder' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'tokens', op: 'io', modality: 'txt', label: 'Par de oraciones', x: 3, y: 1, w: 72, h: 10, ops: ['mask-tokens'], opsExact: true,
        tokens: { items: toks(true) },
        note: 'La entrada de BERT: un par de oraciones con [CLS] al principio y [SEP] al final de cada una, en WordPiece (vocabulario de {{cfg.V}} piezas; "##s" sería una sub-palabra). En el pre-entrenamiento el 15 % de los tokens se elige para predecir y el 80 % de esos pasa a [MASK]. Los tokens dibujados son el ejemplo del paper (§A.1); la config usa secuencias de T = {{cfg.T}} tokens.' },
      { id: 'embed', op: 'embed', style: 'block', label: 'Embeddings', x: 14, y: 17, w: 50, h: 9, expand: 'bert-embeddings',
        mini: { items: [{ label: 'palabra', op: 'embed' }, { label: 'posición', op: 'embed' }, { label: 'segmento', op: 'embed' }, { sym: 'add' }, { label: 'LN', op: 'norm' }] },
        tex: 'x_0 = \\mathrm{LN}\\big(E_{\\mathrm{tok}}[t] + E_{\\mathrm{pos}}[i] + E_{\\mathrm{seg}}[s]\\big)',
        note: 'Tres tablas aprendidas que se suman: la de palabras (V × D, casi todos los parámetros de este bloque), la de posiciones absolutas (512 × D: por eso BERT no lee más de 512 tokens) y la de segmento (2 × D: A o B). Después una LayerNorm. Ábrelo para ver cada tabla.' },
      { id: 'encoder', op: 'attn', style: 'block', badgeTotal: true, label: 'Capa del encoder (post-LN)', x: 14, y: 39, w: 50, h: 9, expand: 'bert-layer',
        mini: { items: [{ label: 'MHSA', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }, { label: 'LN', op: 'norm' }], res: [[0, 1], [3, 4]] },
        tex: "\\begin{aligned} x' &= \\mathrm{LN}(x + \\mathrm{MHSA}(x)) \\\\ y &= \\mathrm{LN}(x' + \\mathrm{FFN}(x')) \\end{aligned}",
        note: 'Una capa del Transformer encoder, en la variante post-LN del paper original: la LayerNorm va DESPUÉS de cada suma residual. La atención es bidireccional (sin máscara causal). La forma T×D no cambia, por eso se apilan L = {{cfg.L}} capas. Ábrela para ver el orden.' },
      { id: 'mlm-head', op: 'head', label: 'Cabeza MLM', sub: 'dense · GELU · LN → decoder', x: 3, y: 62, w: 34, h: 9, expand: 'bert-pretraining',
        tex: '\\mathrm{logits} = \\mathrm{LN}(\\mathrm{GELU}(H W_t + b_t))\\, E_{\\mathrm{tok}}^{\\top} + b',
        note: 'Una Linear D → D con GELU y LayerNorm, y un decoder D → V que REUSA la matriz de word embeddings (pesos atados: solo su sesgo de V = {{cfg.V}} es nuevo). HF la aplica a las T posiciones; la pérdida solo mira las elegidas (el código original de Google aplicaba la cabeza solo a esas: ≈ {{metrics.mlmPredictions}} por secuencia).' },
      { id: 'pick-cls', op: 'tensorop', shape: 'pill', symbol: 'pick', label: 'Tomar [CLS]', ops: ['pool-cls'], opsExact: true, x: 45, y: 57, w: 26, h: 4,
        tex: 'h_{[\\mathrm{CLS}]} = H_0', note: 'Solo la fila 0 (el token [CLS]) sigue hacia el pooler: es el resumen de todo el par. Sin parámetros.' },
      { id: 'pooler', op: 'embed', label: 'Pooler', sub: 'Linear D → D · tanh', ops: ['pooler-dense', 'pooler-tanh'], opsExact: true, x: 45, y: 66, w: 26, h: 8,
        tex: 'p = \\tanh(W_p\\, h_{[\\mathrm{CLS}]} + b_p)', note: 'Una Linear D → D con tanh sobre el vector de [CLS] (D² + D parámetros). Lo entrena la NSP; los modelos de recuperación con mean pooling no lo usan.' },
      { id: 'nsp-head', op: 'head', label: 'Cabeza NSP', sub: 'Linear D → 2', blankSub: 'Linear', x: 45, y: 79, w: 26, h: 7, expand: 'bert-pretraining',
        tex: '\\mathrm{logits}_{\\mathrm{NSP}} = W_{\\mathrm{nsp}}\\, p + b', note: 'Clasificador de 2 clases: IsNext (B sigue a A en el texto) o NotNext (B es una oración al azar), 50 % y 50 %. RoBERTa mostró que se puede quitar sin perder (y ganando) en las tareas de evaluación.' },
      { id: 'mlm-out', op: 'io', label: 'Logits MLM', sub: 'T × V · pérdida: solo las elegidas', blankSub: 'pérdida: solo las elegidas', x: 3, y: 92, w: 34, h: 8, note: 'Un logit por palabra del vocabulario en cada posición. La cross-entropy solo cuenta las posiciones elegidas (las demás llevan la etiqueta −100 en HF).' },
      { id: 'nsp-out', op: 'io', label: 'IsNext / NotNext', blankLabel: 'Salida NSP', x: 45, y: 92, w: 26, h: 6, note: 'Dos logits: ¿la oración B sigue a la A?' },
    ],
    tensors: [
      { id: 'x0', at: { edge: 'embed>encoder' }, show: 'both' },
      { id: 'mlm-logits', at: { edge: 'mlm-head>mlm-out' }, show: 'both' },
    ],
    edges: [
      { from: 'tokens', to: 'embed', kind: 'data', tensor: 'ids', labelT: 0.5 },
      { from: 'embed', to: 'encoder', kind: 'data', tensor: 'x0', labelT: 0.45 },
      { from: 'encoder', to: 'mlm-head', kind: 'data', tensor: 'x-out', fromSide: 'bottom', toSide: 'top', fromAt: 0.16, toAt: 0.5, labelT: 0.55 },
      { from: 'encoder', to: 'pick-cls', kind: 'data', tensor: 'x-out', fromSide: 'bottom', toSide: 'top', fromAt: 0.86, toAt: 0.5, label: false, tag: 'fila 0', tagStyle: 'plain', tagSide: 'on', tagSeg: -1, tagT: 0.45 },
      { from: 'pick-cls', to: 'pooler', kind: 'data', tensor: 'h-cls', labelT: 0.5 },
      { from: 'pooler', to: 'nsp-head', kind: 'data', tensor: 'pooled', labelT: 0.5 },
      { from: 'nsp-head', to: 'nsp-out', kind: 'data', tensor: 'nsp-logits', labelT: 0.5 },
      { from: 'mlm-head', to: 'mlm-out', kind: 'data', tensor: 'mlm-logits', labelSide: 'right', labelT: 0.5 },
      // pesos atados: la tabla de palabras (en Embeddings) es la matriz del decoder del MLM
      { from: 'embed', to: 'mlm-head', kind: 'control', tie: true, fromSide: 'left', toSide: 'left', fromAt: 0.5, toAt: 0.5, via: [[1, 21.5], [1, 66.5]], tag: 'E_tok atada', tagBlank: 'pesos atados', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (pre-entrenamiento)', steps: [
        { nodes: ['tokens'], edges: ['tokens>embed'], tensors: ['ids'],
          text: 'Entra un par de oraciones como <b>' + q('tensor.ids.shape') + '</b> ids de WordPiece (T = ' + q('cfg.T') + ' en el pre-entrenamiento): [CLS] A [SEP] B [SEP]. Ya enmascarado: ≈ ' + q('metrics.mlmPredictions') + ' posiciones elegidas (15 %).' },
        { expand: 'bert-embeddings', nodes: ['tok', 'pos', 'type'], edges: ['ids-in>tok', 'pos-in>pos', 'types-in>type'], tensors: ['e-tok', 'e-pos', 'e-type'],
          text: 'Tres tablas: palabras (' + q('node.tok.params') + ' parámetros), posiciones (' + q('node.pos.params') + ') y segmento (' + q('node.type.params') + '). Cada una da <b>' + q('tensor.e-tok.shape') + '</b>.' },
        { expand: 'bert-embeddings', nodes: ['add', 'ln'], edges: ['tok>add', 'pos>add', 'type>add', 'add>ln', 'ln>emb-out'], tensors: ['e-sum', 'x0'],
          text: 'Se suman y pasan por una LayerNorm: x₀ = <b>' + q('tensor.x0.shape') + '</b>. Embeddings en total: ' + q('metrics.embedParams') + ' parámetros (' + q('metrics.embedParamsShare') + ' del modelo).' },
        { expand: 'bert-layer', nodes: ['mhsa', 'res1', 'ln1'], edges: ['layer-in>mhsa', 'mhsa>res1', 'res1>ln1'], tensors: ['o', 'r1', 'h-ln1'],
          text: 'Capa 1: self-attention bidireccional con h = ' + q('cfg.h') + ' cabezas (' + q('node.mhsa.params') + ' parámetros en las ' + q('cfg.L') + ' capas); se suma la entrada y DESPUÉS la LayerNorm (post-LN): <b>' + q('tensor.h-ln1.shape') + '</b>.' },
        { expand: 'bert-layer', nodes: ['mlp', 'res2', 'ln2'], edges: ['ln1>mlp', 'mlp>res2', 'res2>ln2', 'ln2>layer-out'], tensors: ['u', 'f', 'r2', 'x-out'],
          text: 'FFN: D → D_mlp = ' + q('cfg.Dmlp') + ' (<b>' + q('tensor.u.shape') + '</b>) → GELU → D, suma y LayerNorm. Sale <b>' + q('tensor.x-out.shape') + '</b>, la misma forma: se repite L = ' + q('cfg.L') + ' veces.' },
        { nodes: ['encoder'], edges: ['embed>encoder', 'encoder>mlm-head', 'encoder>pick-cls'], tensors: ['x0', 'x-out'],
          text: 'Las ' + q('cfg.L') + ' capas: ' + q('metrics.encoderParams') + ' parámetros (' + q('metrics.encoderParamsShare') + ') y ' + q('metrics.encoderMacs') + ' por secuencia. QKᵀ y A·V son ' + q('metrics.attnScoreShareEncoder') + ' del encoder con T = ' + q('cfg.T') + ' (crecen con T²).' },
        { nodes: ['mlm-head', 'embed'], edges: ['encoder>mlm-head', 'mlm-head>mlm-out', 'embed>mlm-head'], tensors: ['x-out', 'mlm-logits'],
          text: 'Cabeza MLM: logits <b>' + q('tensor.mlm-logits.shape') + '</b> con la tabla de palabras como decoder (atada: solo ' + q('metrics.mlmHeadParams') + ' parámetros propios). Es ' + q('metrics.mlmHeadMacsShare') + ' de los MACs: la matmul con V = ' + q('cfg.V') + ' es cara.' },
        { nodes: ['pick-cls', 'pooler', 'nsp-head', 'nsp-out'], edges: ['encoder>pick-cls', 'pick-cls>pooler', 'pooler>nsp-head', 'nsp-head>nsp-out'], tensors: ['h-cls', 'pooled', 'nsp-logits'],
          text: '[CLS] → pooler (' + q('metrics.poolerParams') + ' parámetros, tanh) → NSP: <b>' + q('tensor.nsp-logits.shape') + '</b> logits. Total del modelo: ' + q('params.total') + ' parámetros, ' + q('metrics.macsPerSequence') + ' por secuencia de ' + q('cfg.T') + ' tokens.' },
        { expand: 'bert-pretraining', nodes: ['pt-mlm-loss', 'pt-nsp-loss', 'pt-loss'], edges: ['pt-mlm-loss>pt-loss', 'pt-nsp-loss>pt-loss'], tensors: ['loss-mlm', 'loss-nsp'],
          text: 'Pre-entrenamiento: L = L_MLM + L_NSP. Lotes de ' + q('cfg.B') + ' secuencias durante ' + q('cfg.steps') + ' pasos (90 % con 128 tokens, 10 % con 512): ≈ ' + q('metrics.pretrainMacs') + ' en total.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) embeddings
  ATLAS.registerDiagram(Object.assign({
    id: 'bert-embeddings', model: 'bert', config: C, configs: CFGS, kind: 'arch', title: 'Embeddings de BERT',
    parent: 'bert-overview', parentNode: 'embed',
    caption: 'Tres búsquedas en tablas, una por cada tipo de id: palabra (V × D), posición absoluta aprendida (512 × D) y segmento A / B (2 × D). Se suman elemento a elemento y se normalizan. La tabla de palabras tiene casi todos los parámetros del bloque, y es la misma matriz que usa el decoder del MLM.',
    grid: { w: 110, h: 45 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['tok', 'pos', 'type', 'add'],
    nodes: [
      { id: 'ids-in', op: 'io', modality: 'txt', label: 'ids de palabra', sub: 'WordPiece', x: 1, y: 7, w: 17, h: 7, note: 'Un id de WordPiece por token (con [MASK] en el pre-entrenamiento).' },
      { id: 'pos-in', op: 'io', modality: 'txt', label: 'posiciones', sub: '0 … T − 1', x: 1, y: 21, w: 17, h: 7, note: 'Los índices 0, 1, …, T − 1 (un buffer fijo, sin parámetros).' },
      { id: 'types-in', op: 'io', modality: 'txt', label: 'segmento', sub: 'A = 0 · B = 1', x: 1, y: 35, w: 17, h: 7, note: 'token_type_ids: 0 para [CLS], la oración A y su [SEP]; 1 para B y su [SEP].' },
      { id: 'tok', op: 'embed', label: 'Tabla de palabras', sub: 'V × D', subNum: '{{cfg.V}} × {{cfg.D}}', x: 30, y: 6.5, w: 26, h: 8,
        tex: 'E_{\\mathrm{tok}} \\in \\mathbb{R}^{V \\times D}', note: 'Una fila por pieza de WordPiece. Es el grueso de los embeddings y se reusa (atada) como decoder del MLM.' },
      { id: 'pos', op: 'embed', label: 'Tabla de posiciones', sub: '512 × D (aprendida)', subNum: '{{cfg.posMax}} × {{cfg.D}} (aprendida)', x: 30, y: 20.5, w: 26, h: 8,
        tex: 'E_{\\mathrm{pos}} \\in \\mathbb{R}^{512 \\times D}', note: 'Posiciones absolutas aprendidas: por eso el máximo es 512 tokens (no hay fila para la 513). Sin RoPE ni senos.' },
      { id: 'type', op: 'embed', label: 'Tabla de segmento', sub: '2 × D', subNum: '{{cfg.typeVocab}} × {{cfg.D}}', x: 30, y: 34.5, w: 26, h: 8,
        tex: 'E_{\\mathrm{seg}} \\in \\mathbb{R}^{2 \\times D}', note: 'Dos filas: una para los tokens de la oración A y otra para los de B.' },
      { id: 'add', op: 'tensorop', shape: 'add', label: 'Sumar', labelPos: 'none', x: 70, y: 22.5, w: 4, h: 4,
        tex: 'E_{\\mathrm{tok}}[t] + E_{\\mathrm{pos}}[i] + E_{\\mathrm{seg}}[s]', note: 'Suma elemento a elemento de los tres vectores de cada token. Sin parámetros.' },
      { id: 'ln', op: 'norm', label: 'LayerNorm', x: 80, y: 22, w: 12, h: 5, tex: '\\mathrm{LN}(\\cdot)', note: 'LayerNorm por token (ε = 10⁻¹²), 2·D parámetros.' },
      { id: 'emb-out', op: 'io', label: 'x₀', sub: 'capa 1', x: 96, y: 21.5, w: 12, h: 6, note: 'La entrada de la primera capa del encoder.' },
    ],
    tensors: [
      { id: 'e-tok', at: { edge: 'tok>add' }, show: 'both' },
    ],
    edges: [
      { from: 'ids-in', to: 'tok', kind: 'data', tensor: 'ids', label: false },
      { from: 'pos-in', to: 'pos', kind: 'data', tensor: 'pos-ids', label: false },
      { from: 'types-in', to: 'type', kind: 'data', tensor: 'type-ids', label: false },
      { from: 'tok', to: 'add', kind: 'data', tensor: 'e-tok', toSide: 'top', labelSide: 'above', labelT: 0.4 },
      { from: 'pos', to: 'add', kind: 'data', tensor: 'e-pos', labelSide: 'above', labelT: 0.45 },
      { from: 'type', to: 'add', kind: 'data', tensor: 'e-type', toSide: 'bottom', labelSide: 'below', labelT: 0.4 },
      { from: 'add', to: 'ln', kind: 'data', tensor: 'e-sum', label: false },
      { from: 'ln', to: 'emb-out', kind: 'data', tensor: 'x0', label: false },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) capa post-LN
  ATLAS.registerDiagram(Object.assign({
    id: 'bert-layer', model: 'bert', config: C, configs: CFGS, kind: 'arch', title: 'Capa del encoder de BERT (post-LN)',
    parent: 'bert-overview', parentNode: 'encoder',
    caption: 'Post-LN (BERT y el Transformer original): la residual suma la entrada del sub-bloque y la LayerNorm va DESPUÉS de la suma, sobre el camino principal. En pre-LN (ViT, GPT-2 y los LLM modernos, #vit) la LN va antes del sub-bloque y el camino residual queda limpio: entrena más estable sin warm-up largo. Entra y sale T×D.',
    grid: { w: 64, h: 88 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa ℓ (pesos propios)', labelPos: 'bottom', x: 8, y: 6, w: 50, h: 71, repeat: { sym: 'L', from: 'L', tagPos: 'bottom' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'layer-in', op: 'io', label: 'Entrada x_{ℓ−1}', x: 23, y: 1, w: 16, h: 4, note: 'La salida de la capa anterior (en la capa 1, x₀ de los embeddings).' },
      { id: 'mhsa', op: 'attn', label: 'Multi-head self-attention', sub: 'bidireccional (sin causal)', heads: 'h', x: 16, y: 15, w: 30, h: 7,
        xref: [{ href: '#vit.diagrama~vit-mhsa.scores', label: 'Ver la atención por dentro (ViT)' }],
        tex: '\\mathrm{MHSA}(X) = [\\,\\mathrm{head}_1;\\dots;\\mathrm{head}_h\\,]\\,W_O', note: 'Cada token mira a todos los demás, a izquierda y derecha (solo se enmascara el relleno). W_Q, W_K y W_V separadas en HF; el conteo es el mismo que con una qkv fusionada. Por dentro es la misma atención de ViT.' },
      { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 29, y: 27, w: 4, h: 4, tex: 'x + \\mathrm{MHSA}(x)', note: 'Suma la entrada de la capa con la salida de la atención.' },
      { id: 'ln1', op: 'norm', label: 'LayerNorm 1', sub: 'después de la suma', x: 20, y: 35, w: 22, h: 6, tex: "x' = \\mathrm{LN}_1(x + \\mathrm{MHSA}(x))", note: 'Post-LN: normaliza la suma (el camino principal), no la entrada del sub-bloque. 2·D parámetros.' },
      { id: 'mlp', op: 'mlp', label: 'FFN', sub: 'D → D_mlp → D · GELU', x: 20, y: 46, w: 22, h: 6, tex: 'W_2\\,\\mathrm{GELU}(W_1 x\' + b_1) + b_2', note: 'Dos lineales por token con GELU en medio (D_mlp = 4D): dos tercios de los parámetros de la capa.' },
      { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 29, y: 57, w: 4, h: 4, tex: "x' + \\mathrm{FFN}(x')", note: 'Suma la salida de la LayerNorm 1 con la de la FFN.' },
      { id: 'ln2', op: 'norm', label: 'LayerNorm 2', sub: 'después de la suma', x: 20, y: 65, w: 22, h: 6, tex: "y = \\mathrm{LN}_2(x' + \\mathrm{FFN}(x'))", note: 'La salida de la capa ya sale normalizada.' },
      { id: 'layer-out', op: 'io', label: 'Salida x_ℓ', x: 23, y: 83, w: 16, h: 4, note: 'Misma forma que la entrada; tras la última capa, H (un vector por token).' },
    ],
    tensors: [
      { id: 'x0', at: { edge: 'layer-in>mhsa' }, show: 'label' },
      { id: 'u', at: { x: 52, y: 51 }, show: 'both', labelSide: 'below', note: 'oculta de la FFN' },
    ],
    edges: [
      { from: 'layer-in', to: 'mhsa', kind: 'data', tensor: 'x0', labelT: 0.42 },
      { from: 'layer-in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[31, 7.5], [12, 7.5], [12, 29]], dot: true },
      { from: 'mhsa', to: 'res1', kind: 'data', tensor: 'o', labelT: 0.4 },
      { from: 'res1', to: 'ln1', kind: 'data', tensor: 'r1', labelT: 0.5 },
      { from: 'ln1', to: 'mlp', kind: 'data', tensor: 'h-ln1', labelT: 0.5 },
      { from: 'ln1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', fromAt: 0.5, via: [[31, 43.5], [12, 43.5], [12, 59]], dot: true },
      { from: 'mlp', to: 'res2', kind: 'data', tensor: 'f', labelT: 0.4 },
      { from: 'res2', to: 'ln2', kind: 'data', tensor: 'r2', labelT: 0.5 },
      { from: 'ln2', to: 'layer-out', kind: 'data', tensor: 'x-out', labelT: 0.78 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) pre-entrenamiento: MLM + NSP
  ATLAS.registerDiagram(Object.assign({
    id: 'bert-pretraining', model: 'bert', config: C, configs: CFGS, kind: 'arch', title: 'Pre-entrenamiento de BERT: MLM + NSP',
    parent: 'bert-overview', parentNode: 'mlm-head',
    caption: 'Dos tareas a la vez, sin etiquetas humanas. MLM: se elige el 15 % de los tokens (80 % pasa a [MASK], 10 % a una palabra al azar, 10 % queda igual) y la cross-entropy mide si el modelo recupera el original SOLO en esas posiciones (la flecha de la izquierda: las etiquetas salen del mismo texto). NSP: con el 50 % de los pares B sigue a A; [CLS] → pooler → 2 clases. La pérdida es la suma.',
    grid: { w: 94, h: 104 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['pt-raw', 'pt-mask'],
    legendText: LT,
    nodes: [
      { id: 'pt-raw', op: 'io', modality: 'txt', label: 'Texto original', x: 3, y: 1, w: 72, h: 10,
        tokens: { items: toks(false) }, note: 'Dos oraciones del corpus (BooksCorpus + Wikipedia en inglés). La mitad de las veces B es la oración siguiente; la otra mitad, una al azar.' },
      { id: 'pt-mask', op: 'tensorop', shape: 'rect', label: 'Enmascarar el 15 %', sub: '80 % [MASK] · 10 % al azar · 10 % igual', ops: ['mask-tokens'], opsExact: true, x: 3, y: 16, w: 72, h: 11,
        tokens: { items: toks(true) },
        tex: '\\tilde t = \\mathrm{mask}(t),\\ \\ y_{\\mathrm{MLM}} = t \\text{ en las elegidas}', note: 'Se eligen ≈ {{metrics.mlmPredictions}} posiciones de {{cfg.T}} (nunca [CLS] ni [SEP]). De ellas, el 80 % pasa a [MASK], el 10 % a una palabra al azar y el 10 % queda igual: [MASK] no aparece en el fine-tuning y el modelo no puede confiar en que solo [MASK] importa. Las palabras originales son las etiquetas.' },
      { id: 'pt-bert', op: 'attn', style: 'block', label: 'BERT (cuerpo)', sub: 'embeddings + L capas post-LN, bidireccional', ops: [], opsExact: true, x: 15, y: 33, w: 48, h: 8,
        note: 'El modelo entero de la vista general ({{params.total}} parámetros con las cabezas). Sale un vector por token: H = T×D.' },
      { id: 'pt-mlm', op: 'head', costOf: 'mlm-head', label: 'Cabeza MLM', sub: 'decoder atado a E_tok', x: 3, y: 48, w: 30, h: 8,
        note: 'Dense + GELU + LN y el decoder atado a la tabla de palabras: un logit por palabra del vocabulario en cada posición.' },
      { id: 'pt-pooler', op: 'embed', label: '[CLS] → pooler', sub: 'tanh(W_p h + b_p)', ops: ['pool-cls', 'pooler-dense', 'pooler-tanh'], opsExact: true, x: 45, y: 48, w: 30, h: 8,
        note: 'El vector de [CLS] por una Linear D → D y tanh.' },
      { id: 'pt-nsp', op: 'head', costOf: 'nsp-head', label: 'NSP', sub: 'Linear D → 2', x: 45, y: 62, w: 30, h: 7, note: 'Dos logits: IsNext / NotNext.' },
      { id: 'pt-mlm-loss', op: 'head', label: 'Cross-entropy MLM', sub: 'solo las posiciones elegidas', ops: ['mlm-loss'], opsExact: true, x: 3, y: 74, w: 30, h: 8,
        tex: '\\mathcal{L}_{\\mathrm{MLM}} = -\\tfrac{1}{|M|}\\textstyle\\sum_{i \\in M} \\log p(t_i \\mid \\tilde t)', note: 'Promedio sobre las posiciones elegidas M (≈ {{metrics.mlmPredictions}} por secuencia); las demás no aportan gradiente.' },
      { id: 'pt-nsp-label', op: 'io', label: 'IsNext / NotNext', sub: '50 % / 50 %', x: 78, y: 74.5, w: 15, h: 7, note: 'La etiqueta del par, gratis: se sabe si B era la oración siguiente.' },
      { id: 'pt-nsp-loss', op: 'head', label: 'Cross-entropy NSP', sub: '2 clases', ops: ['nsp-loss'], opsExact: true, x: 45, y: 74, w: 30, h: 8,
        tex: '\\mathcal{L}_{\\mathrm{NSP}} = -\\log p(y_{\\mathrm{NSP}} \\mid p)', note: 'Una clasificación binaria por par.' },
      { id: 'pt-loss', op: 'tensorop', shape: 'add', label: 'L = L_MLM + L_NSP', labelPos: 'below', ops: ['loss-sum'], opsExact: true, x: 37, y: 92, w: 4, h: 4,
        tex: '\\mathcal{L} = \\mathcal{L}_{\\mathrm{MLM}} + \\mathcal{L}_{\\mathrm{NSP}}', note: 'Las dos pérdidas se suman con el mismo peso.' },
    ],
    edges: [
      { from: 'pt-raw', to: 'pt-mask', kind: 'data', tensor: 'raw-ids', label: false },
      { from: 'pt-mask', to: 'pt-bert', kind: 'data', tensor: 'ids', labelT: 0.5 },
      { from: 'pt-mask', to: 'pt-mlm-loss', kind: 'data', tensor: 'mlm-labels', fromSide: 'left', toSide: 'left', fromAt: 0.5, toAt: 0.5, via: [[1, 21.5], [1, 78]], label: false, tag: 'etiquetas', tagBlank: false, tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.25 },
      { from: 'pt-bert', to: 'pt-mlm', kind: 'data', tensor: 'x-out', fromSide: 'bottom', toSide: 'top', fromAt: 0.12, toAt: 0.5, labelT: 0.5, labelSide: 'left' },
      { from: 'pt-bert', to: 'pt-pooler', kind: 'data', tensor: 'x-out', fromSide: 'bottom', toSide: 'top', fromAt: 0.88, toAt: 0.5, label: false },
      { from: 'pt-pooler', to: 'pt-nsp', kind: 'data', tensor: 'pooled', labelT: 0.5 },
      { from: 'pt-mlm', to: 'pt-mlm-loss', kind: 'data', tensor: 'mlm-logits', labelT: 0.5 },
      { from: 'pt-nsp', to: 'pt-nsp-loss', kind: 'data', tensor: 'nsp-logits', label: false },
      { from: 'pt-nsp-label', to: 'pt-nsp-loss', kind: 'data', tensor: 'nsp-label', label: false },
      { from: 'pt-mlm-loss', to: 'pt-loss', kind: 'data', tensor: 'loss-mlm', fromSide: 'bottom', toSide: 'left', label: false },
      { from: 'pt-nsp-loss', to: 'pt-loss', kind: 'data', tensor: 'loss-nsp', fromSide: 'bottom', toSide: 'right', label: false },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
