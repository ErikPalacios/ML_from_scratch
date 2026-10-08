/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/sam.js
   Diagramas de SAM (SPEC §7.2, ids de §17.1), config canónica sam-vit-h-1024:
     sam-overview       dos carriles: arriba lo que corre UNA vez por imagen (imagen → encoder ViT-H → neck →
                        embedding 64×64×256, que se guarda); abajo lo que corre en CADA prompt (prompt encoder →
                        mask decoder liviano → 3 máscaras + IoU predicho). La máscara de un clic puede volver como
                        prompt denso del siguiente (arista punteada).
       sam-encoder      patch embedding → + posición → 4 etapas de [bloques con ventanas 14×14, un bloque global]
                        → neck. Los dos glifos 64×64 muestran la rejilla de ventanas y la atención global.
       sam-mask-decoder tokens (salida + prompt) → two-way transformer ×2 (con el embedding de imagen) → atención
                        final → hiperredes por token de máscara · upscaling ×4 de la imagen → producto punto →
                        máscaras; el token de IoU → cabeza de IoU.
         sam-two-way    una capa: self-attn de tokens → tokens ← imagen → MLP → imagen ← tokens (la flecha apunta
                        al flujo que se actualiza; el paper las llama token-to-image e image-to-token).
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas las pone el motor desde ATLAS.Arch.run;
   aquí solo se nombran tensores. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'sam-vit-h-1024';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const PAGE = { page: 'sam', section: 'diagrama' };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'sam-overview', model: 'sam', config: C, kind: 'arch', title: 'SAM — vista general',
    caption: 'Segmentación como respuesta a un prompt. Arriba (ámbar), lo caro corre UNA vez por imagen: el encoder ViT-H y el neck dejan un embedding de 64×64×256 que se guarda. Abajo (azul), lo que corre en CADA clic o caja: el prompt encoder y un mask decoder liviano que leen ese embedding y devuelven 3 máscaras (subparte, parte, objeto: un punto es ambiguo) con su IoU predicho. La máscara elegida puede volver como prompt denso del clic siguiente.',
    grid: { w: 124, h: 74 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['image', 'img-encoder', 'neck'], mobileFocusPad: 4,
    groups: [
      { id: 'once', style: 'lane', tone: 'warn', label: 'Una vez por imagen', legend: 'Marco ámbar: corre una vez por imagen (el embedding se guarda)', label2: 'encoder + neck: ' + q('node.img-encoder.macsG') + ' MACs (' + q('metrics.encoderMacsShare') + ' del total)', x: 0.5, y: 0.5, w: 123, h: 24 },
      { id: 'per', style: 'lane', tone: 'accent', label: 'Por cada prompt (clic o caja)', legend: 'Marco azul: corre en cada prompt, con el embedding ya calculado', label2: 'prompt encoder + decoder: ' + q('node.mask-decoder.macsG') + ' MACs por prompt (1/' + q('quantities.breakEvenPrompts') + ' del encoder)', x: 0.5, y: 28.5, w: 123, h: 45 },
    ],
    nodes: [
      { id: 'image', op: 'io', label: 'Imagen', image: true, imageGrid: 0, x: 4, y: 6.5, w: 13, h: 13,
        note: 'La imagen se redimensiona con el lado largo a 1024 y se rellena hasta 1024×1024 (sin batch: 1024×1024×3).' },
      { id: 'img-encoder', op: 'attn', modality: 'img', label: 'Encoder de imagen', sub: 'ViT-H/16 · MAE', flag: 'una vez', expand: 'sam-encoder', costExclude: ['neck'], x: 29, y: 8, w: 24, h: 10,
        tex: 'F = \\mathrm{ViT}_{H/16}(x) \\in \\mathbb{R}^{64\\times 64\\times 1280}',
        note: 'Un ViT-H/16 preentrenado con MAE (32 bloques, D = 1280), adaptado a 1024×1024: casi todos los bloques atienden dentro de ventanas de 14×14 tokens y 4 son globales. Es casi todo el costo del modelo, y corre una sola vez por imagen. Ábrelo para ver las ventanas.' },
      { id: 'neck', op: 'conv', label: 'Neck', sub: 'conv 1×1 → 3×3', x: 67, y: 9, w: 14, h: 8,
        tex: 'E = \\mathrm{LN}(\\mathrm{Conv}_{3\\times 3}(\\mathrm{LN}(\\mathrm{Conv}_{1\\times 1}(F))))',
        note: 'Baja los canales de 1280 a 256: conv 1×1 → LayerNorm → conv 3×3 → LayerNorm (sin sesgos en las convs). Lo que sale es el embedding de imagen que usan todos los prompts.' },
      { id: 'img-emb', op: 'io', label: 'Embedding de imagen', sub: 'se guarda (caché)', x: 89, y: 9, w: 22, h: 8,
        note: 'El embedding de 64×64×256 queda en memoria: cada clic, caja o máscara nueva sobre la MISMA imagen lo reutiliza sin volver a correr el encoder. Por eso la interacción es en tiempo real.' },
      { id: 'mask-in', op: 'io', label: 'Máscara previa', sub: 'opcional', x: 4, y: 34, w: 18, h: 6,
        note: 'Prompt denso opcional: los logits de baja resolución (256×256) de una predicción anterior. Así un clic de corrección refina la máscara que ya había. Sin ella, se usa un embedding aprendido de "sin máscara".' },
      { id: 'prompts', op: 'io', label: 'Prompts', sub: 'puntos ± · caja', x: 4, y: 44, w: 18, h: 9,
        note: 'Prompts dispersos: puntos (x, y) con su etiqueta (positivo: "esto sí"; negativo: "esto no") y/o una caja (2 esquinas). Las coordenadas se escalan a la imagen de 1024.' },
      { id: 'prompt-enc', op: 'embed', label: 'Prompt encoder', sub: 'Fourier + tipo · conv ↓4', x: 38, y: 34, w: 22, h: 22,
        tex: 's_i = \\mathrm{PE}(p_i) + e_{\\text{tipo}},\\quad d = \\mathrm{Conv}{\\downarrow}4(m)',
        note: 'Cada punto o esquina se codifica con una codificación posicional de Fourier aleatoria (fija) más un embedding aprendido de su tipo (positivo, negativo, esquina superior izquierda, inferior derecha): un token de 256 por punto. La máscara previa pasa por convs que la bajan 4× hasta 64×64×256 y se suma al embedding de imagen.' },
      { id: 'dense-add', op: 'tensorop', shape: 'add', ops: ['md-add-dense'], opsExact: true, label: '+ prompt denso', labelPos: 'right', x: 98, y: 35, w: 4, h: 4,
        tex: 'E + d', note: 'El prompt denso (la máscara previa codificada, o el embedding de "sin máscara") se suma elemento a elemento al embedding de imagen.' },
      { id: 'mask-decoder', op: 'head', style: 'block', label: 'Mask decoder', flag: 'por prompt', expand: 'sam-mask-decoder', x: 84, y: 42, w: 32, h: 14,
        mini: { items: [{ label: 'two-way ×2', op: 'attn' }, { label: 'final', op: 'attn' }, { label: '↑×4', op: 'conv' }, { label: 'dot', op: 'head' }, { label: 'IoU', op: 'head' }] },
        tex: '\\hat M_k = h_k \\cdot \\mathrm{Up}(E\'),\\quad k = 1..4',
        note: 'Liviano: dos capas de un transformer "two-way" (los tokens leen la imagen y la imagen lee los tokens), una atención final, un upscaling ×4 y, para cada token de máscara, una hiperred que da los pesos de un producto punto con cada píxel. Ábrelo para verlo por dentro.' },
      { id: 'masks', op: 'io', label: 'Máscaras', sub: '→ a la imagen', x: 86, y: 64, w: 16, h: 6,
        note: 'Tres máscaras de 256×256 (logits) para un prompt ambiguo: subparte, parte y objeto. Se suben a 1024×1024, se recorta el relleno y se umbraliza en 0. Con varios prompts se usa una sola (el cuarto token).' },
      { id: 'iou', op: 'io', label: 'IoU predicho', sub: '1 por máscara', x: 105, y: 64, w: 14, h: 6,
        note: 'La cabeza de IoU estima qué tan buena es cada máscara (su IoU con la verdadera). Si hace falta una sola máscara, se elige la de mayor IoU predicho.' },
    ],
    tensors: [
      { id: 'img-emb', at: { edge: 'img-emb>dense-add' }, show: 'both' },
    ],
    edges: [
      { from: 'image', to: 'img-encoder', kind: 'data', tensor: 'x-img' },
      { from: 'img-encoder', to: 'neck', kind: 'data', tensor: 'enc-out' },
      { from: 'neck', to: 'img-emb', kind: 'data', tensor: 'img-emb', label: false },
      // el embedding guardado baja al carril "por prompt": lo leen todos los prompts de esta imagen
      { from: 'img-emb', to: 'dense-add', kind: 'data', tensor: 'img-emb', fromAt: 0.5, labelSide: 'right', labelT: 0.8 },
      { from: 'mask-in', to: 'prompt-enc', kind: 'control', toAt: 0.1364, tag: 'logits', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'prompts', to: 'prompt-enc', kind: 'data', tensor: 'pts', toAt: 0.659 },
      { from: 'prompt-enc', to: 'dense-add', kind: 'data', tensor: 'dense', fromAt: 0.1364 },
      { from: 'prompt-enc', to: 'mask-decoder', kind: 'data', tensor: 'sparse', fromAt: 0.659, toAt: 0.4643 },
      { from: 'dense-add', to: 'mask-decoder', kind: 'data', tensor: 'src', label: false },
      { from: 'mask-decoder', to: 'masks', kind: 'data', tensor: 'masks', fromAt: 0.3125, labelSide: 'left' },
      { from: 'mask-decoder', to: 'iou', kind: 'data', tensor: 'iou', fromAt: 0.875, label: false },
      // refinamiento: la máscara del clic anterior vuelve como prompt denso
      { from: 'masks', to: 'mask-in', kind: 'control', fromSide: 'left', toSide: 'left', via: [[2, 67], [2, 37]], tag: 'siguiente clic', tagStyle: 'plain', tagSeg: 0, tagT: 0.5, tagSide: 'on' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números: un clic → 3 máscaras (SAM ViT-H)', steps: [
        { nodes: ['image', 'img-encoder'], edges: ['image>img-encoder'], tensors: ['x-img'],
          text: 'Entra la imagen ya redimensionada: <b>' + q('tensor.x-img.shape') + '</b>. Todo lo del carril ámbar corre <b>una vez</b> por imagen, antes de cualquier clic.' },
        { expand: 'sam-encoder', nodes: ['x-in', 'patch-embed', 'pos-embed', 'add-pos'], edges: ['x-in>patch-embed', 'patch-embed>add-pos', 'pos-embed>add-pos'], tensors: ['x-img', 'patches', 'e-pos'],
          text: 'Patch embedding (conv 16×16, stride 16): <b>' + q('tensor.patches.shape') + '</b>, una rejilla de ' + q('tokens') + ' tokens que se mantiene 2-D. Se suma la posición absoluta aprendida (' + q('node.pos-embed.params') + ' parámetros).' },
        { expand: 'sam-encoder', nodes: ['win-blocks', 'global-blocks'], edges: ['add-pos>win-blocks', 'win-blocks>global-blocks'], tensors: ['w-out', 'g-grid'],
          text: q('cfg.Lw') + ' bloques atienden dentro de ventanas de ' + q('cfg.M') + '×' + q('cfg.M') + ' (la rejilla se rellena a ' + q('quantities.padSide') + '×' + q('quantities.padSide') + ': ' + q('cfg.nW') + ' ventanas) y ' + q('cfg.Lg') + ' son globales (índices ' + q('quantities.globals') + ', desde 0). Un bloque global cuesta ' + q('metrics.globalToWinScoreMacs') + '× más en QKᵀ y A·V que uno con ventanas, y su matriz de scores ocupa ' + q('metrics.globalAttnMem') + ' (bf16) frente a ' + q('metrics.winAttnMem') + '.' },
        { nodes: ['neck', 'img-emb'], edges: ['img-encoder>neck', 'neck>img-emb'], tensors: ['enc-out', 'img-emb'],
          text: 'El neck baja de <b>' + q('tensor.enc-out.shape') + '</b> a <b>' + q('tensor.img-emb.shape') + '</b>. Encoder + neck: ' + q('node.img-encoder.params') + ' parámetros y ' + q('node.img-encoder.macsG') + ' MACs, ' + q('metrics.encoderMacsShare') + ' del modelo. El embedding (' + q('metrics.imgEmbMem') + ' en bf16) se guarda.' },
        { nodes: ['prompts', 'prompt-enc', 'dense-add'], edges: ['prompts>prompt-enc', 'prompt-enc>mask-decoder', 'prompt-enc>dense-add', 'img-emb>dense-add'], tensors: ['pts', 'sparse', 'dense', 'img-emb'],
          text: 'Ahora, el carril azul: un clic (<b>' + q('tensor.pts.shape') + '</b>) se vuelve <b>' + q('tensor.sparse.shape') + '</b> tokens (el punto + uno de relleno, porque no hay caja). Sin máscara previa, el prompt denso es el embedding aprendido de "sin máscara" (<b>' + q('tensor.dense.shape') + '</b>), sumado al embedding guardado.' },
        { expand: 'sam-mask-decoder', nodes: ['out-tok', 'sparse-in', 'tokens'], edges: ['out-tok>tokens', 'sparse-in>tokens', 'tokens>two-way'], tensors: ['out-tokens', 'sparse', 'tokens'],
          text: 'En el decoder, los <b>' + q('tensor.out-tokens.shape') + '</b> tokens de salida aprendidos (1 de IoU + 4 de máscara) se concatenan con los del prompt: <b>' + q('tensor.tokens.shape') + '</b>.' },
        { expand: 'sam-two-way', nodes: ['tok-self', 'tok2img', 'mlp', 'img2tok'], edges: ['tok-self>tok2img', 'tok2img>mlp', 'img-in>tok2img', 'mlp>img2tok'], tensors: ['tw-t2i-scores', 'src-seq', 'tw-n3'],
          text: 'Cada una de las ' + q('cfg.Ldec') + ' capas: los tokens se miran entre sí, después leen la imagen (scores <b>' + q('tensor.tw-t2i-scores.shape') + '</b>, a ' + q('cfg.innerDec') + ' canales), pasan por un MLP y, al final, los ' + q('tokens') + ' píxeles leen a los tokens. Una capa: ' + q('quantities.twoWayLayerParams') + ' parámetros.' },
        { expand: 'sam-mask-decoder', nodes: ['final-attn', 'upscale', 'hypernet', 'dot', 'iou-head'], edges: ['two-way>upscale', 'final-attn>hypernet', 'final-attn>iou-head', 'upscale>dot', 'hypernet>dot'], tensors: ['up-emb', 'hyper-in', 'masks-all'],
          text: 'La imagen se sube ×4 a <b>' + q('tensor.up-emb.shape') + '</b>; cada token de máscara, por su hiperred, da 32 pesos (<b>' + q('tensor.hyper-in.shape') + '</b>) y el producto punto con cada píxel da <b>' + q('tensor.masks-all.shape') + '</b> logits. La cabeza de IoU predice la calidad de cada una.' },
        { nodes: ['mask-decoder', 'masks', 'iou'], edges: ['mask-decoder>masks', 'mask-decoder>iou'], tensors: ['masks', 'iou'],
          text: 'Un clic es ambiguo: se devuelven <b>' + q('tensor.masks.shape') + '</b> (subparte, parte, objeto) con <b>' + q('tensor.iou.shape') + '</b> IoU predichos. Todo el clic costó ' + q('node.mask-decoder.macsG') + ' MACs: hacen falta ' + q('quantities.breakEvenPrompts') + ' clics para igualar UNA pasada del encoder.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) encoder de imagen
  ATLAS.registerDiagram(Object.assign({
    id: 'sam-encoder', model: 'sam', config: C, kind: 'arch', title: 'Encoder de imagen (ViT-H/16 con ventanas)',
    parent: 'sam-overview', parentNode: 'img-encoder',
    caption: 'Un ViT-H/16 adaptado a 1024×1024: patch embedding (64×64 tokens de 1280), posición absoluta aprendida y 32 bloques en 4 etapas; en cada etapa, 7 bloques atienden dentro de ventanas de 14×14 tokens (la rejilla de 64 se rellena a 70: 5×5 ventanas) y el último es global (los 4096 tokens entre sí). Las ventanas hacen barato lo que sería 4096² por bloque; los 4 globales mueven la información entre ventanas. Al final, el neck baja a 256 canales.',
    grid: { w: 152, h: 50 }, direction: 'lr', maxCrossings: 0,
    groups: [
      { id: 'stage', label: 'Etapa: bloques con ventanas, al final uno global', x: 56, y: 6, w: 66, h: 40, repeat: { sym: 'etapas', from: 'globals', len: true, tag: '× {v} etapas', crumb: false } },
    ],
    nodes: [
      { id: 'x-in', op: 'io', label: 'Imagen', sub: '1024²', x: 1, y: 13, w: 9, h: 8, note: 'La imagen redimensionada y rellenada a 1024×1024×3.' },
      { id: 'patch-embed', op: 'conv', label: 'Patch embedding', sub: 'conv 16×16, s=16', x: 22, y: 13, w: 17, h: 8,
        tex: 'X = \\mathrm{Conv}_{16\\times 16,\\,s=16}(x)', note: 'Una conv de kernel y stride 16: cada parche de 16×16×3 pasa a un vector de 1280. Sale una rejilla de 64×64 tokens (se mantiene como rejilla: las ventanas necesitan la forma 2-D).' },
      { id: 'pos-embed', op: 'embed', label: 'Posición', sub: 'absoluta, aprendida', x: 34, y: 0.5, w: 20, h: 6,
        tex: 'E_{pos} \\in \\mathbb{R}^{64\\times 64\\times 1280}', note: 'Una tabla aprendida de 64×64×1280 (la del MAE a 224, interpolada a 1024/16 = 64). Además, cada bloque suma posiciones RELATIVAS a los scores de atención.' },
      { id: 'add-pos', op: 'tensorop', shape: 'add', label: 'Suma de posición', labelPos: 'none', x: 48, y: 15, w: 4, h: 4, tex: 'X + E_{pos}', note: 'Suma la posición absoluta a cada token.' },
      { id: 'win-blocks', op: 'attn', label: 'Bloque con ventanas', sub: 'ventanas 14×14', badgeUnit: 'por bloque', heads: 'h', x: 60, y: 13, w: 22, h: 8,
        tex: '\\mathrm{softmax}\\!\\big(\\tfrac{Q_w K_w^\\top}{\\sqrt{d_h}} + B_{rel}\\big) V_w', note: 'Un bloque pre-LN de ViT (atención + MLP 4×) donde la atención se calcula dentro de cada ventana de 14×14 tokens: se rellena la rejilla 64×64 a 70×70, se parte en 25 ventanas de 196 tokens, se atiende en lote y se vuelve a armar. Suma posiciones relativas (aprendidas) a los scores. Sin desplazamiento de ventanas (eso es Swin). Hay 7 seguidos en cada etapa.' },
      { id: 'global-blocks', op: 'attn', label: 'Bloque global', sub: 'los 4096 tokens', badgeUnit: 'por bloque', heads: 'h', x: 89, y: 13, w: 22, h: 8,
        tex: '\\mathrm{softmax}\\!\\big(\\tfrac{QK^\\top}{\\sqrt{d_h}} + B_{rel}\\big) V', note: 'El mismo bloque, pero la atención es entre los 4096 tokens: una matriz de 4096×4096 por cabeza. Uno al final de cada etapa (bloques 8, 16, 24 y 32): lo justo para que la información cruce entre ventanas.' },
      { id: 'neck', op: 'conv', label: 'Neck', sub: '1280 → 256', x: 127, y: 13, w: 12, h: 8,
        tex: '\\mathrm{LN}(\\mathrm{Conv}_{3\\times 3}(\\mathrm{LN}(\\mathrm{Conv}_{1\\times 1}(F))))', note: 'conv 1×1 (1280 → 256) → LayerNorm → conv 3×3 (256 → 256) → LayerNorm, sin sesgos.' },
      { id: 'out', op: 'io', label: 'Embedding', sub: '→ decoder', x: 141.5, y: 13, w: 10.5, h: 8, note: 'El embedding de imagen que usan todos los prompts.' },
    ],
    tensors: [
      { id: 'w-out', at: { x: 71, y: 39 }, glyph: 'fmap', px: 0.75, win: 'M', show: 'both', labelSide: 'below', note: 'ventanas 14×14 (+ relleno a 70)', leader: { node: 'win-blocks', side: 'bottom', at: 0.5 } },
      { id: 'g-grid', at: { x: 100, y: 39 }, glyph: 'fmap', px: 0.75, show: 'glyph', note: 'global: los 64×64 juntos', leader: { node: 'global-blocks', side: 'bottom', at: 0.5 } },
    ],
    edges: [
      { from: 'x-in', to: 'patch-embed', kind: 'data', tensor: 'x-img' },
      { from: 'patch-embed', to: 'add-pos', kind: 'data', tensor: 'patches', label: false },
      { from: 'pos-embed', to: 'add-pos', kind: 'data', tensor: 'e-pos', fromSide: 'bottom', toSide: 'top', fromAt: 0.8, label: false },
      { from: 'add-pos', to: 'win-blocks', kind: 'data', tensor: 'x0', label: false },
      { from: 'win-blocks', to: 'global-blocks', kind: 'data', tensor: 'w-out', label: false },
      { from: 'global-blocks', to: 'neck', kind: 'data', tensor: 'enc-out', label: false },
      { from: 'neck', to: 'out', kind: 'data', tensor: 'img-emb', label: false },
    ],
    legend: 'auto',
  }, PAGE));
  // ------------------------------------------------------------------ (b) mask decoder
  // Dos filas: arriba los tokens (salida + prompt), abajo la imagen (embedding + prompt denso, 64×64×256).
  // El two-way transformer los mezcla en las dos direcciones; después, los tokens leen la imagen una vez más
  // (atención final), la imagen se sube ×4 y cada token de máscara da, con su hiperred, los pesos de un
  // producto punto con cada píxel.
  ATLAS.registerDiagram(Object.assign({
    id: 'sam-mask-decoder', model: 'sam', config: C, kind: 'arch', title: 'Mask decoder de SAM',
    parent: 'sam-overview', parentNode: 'mask-decoder',
    caption: 'Arriba, los tokens: 5 aprendidos (1 de IoU + 4 de máscara) concatenados con los del prompt; abajo, la imagen (embedding + prompt denso) con su codificación posicional. El two-way transformer (×2) los mezcla en las dos direcciones; la atención final deja que los tokens lean la imagen otra vez. La imagen se sube ×4 (256×256×32) y cada token de máscara, por su hiperred (un MLP), da 32 pesos: el producto punto con cada píxel es su máscara. El token de IoU, por otro MLP, predice la calidad de cada máscara.',
    grid: { w: 134, h: 58 }, direction: 'lr', maxCrossings: 0,
    groups: [
      { id: 'tw', label: '', x: 39, y: 1, w: 26, h: 56, repeat: { sym: 'capas', from: 'Ldec', tag: '× {v} capas', totalOf: 'two-way', crumb: false } },
    ],
    nodes: [
      { id: 'out-tok', op: 'embed', ops: ['md-out-tokens'], opsExact: true, label: 'Tokens de salida', sub: '1 IoU + 4 máscara', x: 1, y: 2, w: 20, h: 7,
        tex: 'T_{out} \\in \\mathbb{R}^{5\\times 256}', note: 'Cinco vectores aprendidos, iguales para toda imagen y todo prompt: uno se convierte en el IoU predicho y cuatro en máscaras (el primero para prompts sin ambigüedad, los otros tres para las 3 hipótesis de un punto ambiguo). Hacen de "queries" (como las de DETR).' },
      { id: 'sparse-in', op: 'io', label: 'Tokens del prompt', sub: 'del prompt encoder', x: 1, y: 12, w: 20, h: 7,
        note: 'Un token de 256 por punto o esquina de caja (con un punto de relleno si no hay caja).' },
      { id: 'tokens', op: 'tensorop', shape: 'concat', ops: ['md-concat'], opsExact: true, label: 'Concatenar', labelPos: 'none', x: 30, y: 8.5, w: 4, h: 4,
        tex: '[T_{out};\\, S]', note: 'Los 5 tokens de salida y los del prompt forman una sola secuencia: el decoder la procesa entera.' },
      { id: 'img-in', op: 'io', modality: 'img', label: 'Embedding + denso', sub: 'por prompt', x: 1, y: 36, w: 20, h: 7,
        note: 'El embedding de imagen guardado más el prompt denso (máscara previa codificada o "sin máscara").' },
      { id: 'pe-in', op: 'io', label: 'PE de la imagen', sub: 'Fourier (fija)', x: 1, y: 47, w: 20, h: 7,
        note: 'La codificación posicional de Fourier de la rejilla 64×64 (la misma que la de los puntos, así puntos y píxeles se comparan en el mismo espacio). Se suma a la imagen cada vez que hace de Q o de K.' },
      { id: 'two-way', op: 'attn', style: 'block', label: 'Two-way\ntransformer', sub: 'tokens ↔ imagen', badgeUnit: 'por capa', expand: 'sam-two-way', x: 42, y: 7, w: 20, h: 47,
        tex: 'T, E \\leftarrow \\mathrm{TwoWay}(T, E)', note: 'Cada capa: self-attention de los tokens, los tokens leen la imagen (cross-attention), MLP de los tokens y la imagen lee los tokens (otra cross-attention). Así los tokens "miran" la imagen y la imagen se ajusta al prompt. Ábrelo.' },
      { id: 'final-attn', op: 'attn', label: 'Atención final', sub: 'tokens ← imagen', x: 72, y: 4, w: 20, h: 12,
        tex: 'T \\leftarrow \\mathrm{LN}(T + \\mathrm{Attn}(Q{=}T,\\, K{=}E{+}PE,\\, V{=}E))', note: 'Una cross-attention más de los tokens a la imagen (ya actualizada), con su LayerNorm. Después se separan: el token 0 es el de IoU; los 1–4, los de máscara.' },
      { id: 'iou-head', op: 'head', label: 'Cabeza de IoU', sub: 'MLP de 3 capas', x: 98, y: 1, w: 22, h: 7,
        tex: '\\widehat{\\mathrm{IoU}} = \\mathrm{MLP}(t_{iou}) \\in \\mathbb{R}^{4}', note: 'Del token de IoU, un MLP (256 → 256 → 256 → 4) predice el IoU de cada una de las 4 máscaras con la verdadera. Se entrena con MSE contra el IoU real.' },
      { id: 'hypernet', op: 'mlp', label: 'Hiperredes', sub: 'un MLP por token', parallel: 4, x: 98, y: 11.5, w: 22, h: 7,
        tex: 'h_k = \\mathrm{MLP}_k(t_k) \\in \\mathbb{R}^{32},\\ k = 1..4', note: 'Cada token de máscara pasa por SU MLP (256 → 256 → 256 → 32): sale un vector de 32 que funciona como los pesos de un clasificador lineal por píxel. Por eso se llaman hiperredes: una red que produce los pesos de otra.' },
      { id: 'upscale', op: 'conv', label: 'Upscaling ×4', sub: '2 conv transp.', x: 74, y: 38, w: 16, h: 8,
        tex: 'U = \\mathrm{ConvT}_{2\\times 2}(\\mathrm{ConvT}_{2\\times 2}(E\'))', note: 'Dos convoluciones transpuestas de stride 2 (con LayerNorm y GELU en medio) suben la imagen de 64×64×256 a 256×256×32.' },
      { id: 'dot', op: 'tensorop', shape: 'mul', label: 'Producto punto', labelPos: 'right', x: 107, y: 40, w: 4, h: 4,
        tex: '\\hat M_k[i,j] = h_k \\cdot U[i,j]', note: 'Para cada token de máscara y cada píxel: el producto punto de sus 32 pesos con los 32 canales del píxel. Salen 4 máscaras de 256×256 (logits).' },
      { id: 'masks', op: 'io', label: 'Máscaras', sub: 'se eligen 3 (o la 1.ª)', x: 98, y: 50, w: 22, h: 6,
        note: 'Con multimask (un punto ambiguo) se devuelven las máscaras 2–4; con varios prompts, solo la 1.ª.' },
      { id: 'iou', op: 'io', label: 'IoU', sub: 'pred.', x: 125, y: 1.5, w: 8, h: 6, note: 'Un IoU predicho por máscara devuelta.' },
    ],
    edges: [
      { from: 'out-tok', to: 'tokens', kind: 'data', tensor: 'out-tokens', fromSide: 'right', toSide: 'top' },
      { from: 'sparse-in', to: 'tokens', kind: 'data', tensor: 'sparse', fromSide: 'right', toSide: 'bottom', labelSide: 'below' },
      { from: 'tokens', to: 'two-way', kind: 'data', tensor: 'tokens', toAt: 0.0745 },
      { from: 'img-in', to: 'two-way', kind: 'data', tensor: 'src-seq', toAt: 0.6915 },
      { from: 'pe-in', to: 'two-way', kind: 'data', tensor: 'pe-seq', toAt: 0.9255, label: false, tag: 'PE', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'two-way', to: 'final-attn', kind: 'data', tensor: 'tw-n3', fromAt: 0.0638, toAt: 0.5, label: false },
      { from: 'two-way', to: 'upscale', kind: 'data', tensor: 'tw-keys', fromAt: 0.7447, labelSide: 'below' },
      { from: 'two-way', to: 'final-attn', kind: 'cross', tensor: 'tw-keys', fromPt: [69, 42], toSide: 'left', toAt: 0.85, via: [[69, 14.2]], label: false, tag: 'K,V', tagSeg: 0, tagT: 0.5, tagSide: 'on' },
      { from: 'final-attn', to: 'iou-head', kind: 'data', tensor: 'iou-tok', fromAt: 0.0417, label: false },
      { from: 'final-attn', to: 'hypernet', kind: 'data', tensor: 'mask-toks', fromAt: 0.9167, labelSide: 'below' },
      { from: 'iou-head', to: 'iou', kind: 'data', tensor: 'iou-all', label: false },
      { from: 'hypernet', to: 'dot', kind: 'data', tensor: 'hyper-in', fromAt: 0.5, labelSide: 'right' },
      { from: 'upscale', to: 'dot', kind: 'data', tensor: 'up-emb' },
      { from: 'dot', to: 'masks', kind: 'data', tensor: 'masks-all', labelSide: 'right' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) una capa del two-way transformer
  // Dos columnas: tokens (izquierda) e imagen (derecha). Las cross-attentions toman K y V de la otra columna;
  // su nombre dice hacia dónde va la información (la flecha apunta al flujo que se actualiza).
  ATLAS.registerDiagram(Object.assign({
    id: 'sam-two-way', model: 'sam', config: C, kind: 'arch', title: 'Una capa del two-way transformer',
    parent: 'sam-mask-decoder', parentNode: 'two-way',
    caption: 'Una capa (hay 2). Columna izquierda, los tokens: self-attention, luego "tokens ← imagen" (Q: tokens; K y V: la imagen) y un MLP. Columna derecha, la imagen: "imagen ← tokens" (Q: la imagen; K y V: los tokens). La flecha del nombre apunta al flujo que se actualiza; el paper las llama token-to-image e image-to-token. Las cross-attentions trabajan a la mitad del ancho (256 → 128) y cada sub-bloque termina en ⊕ y LayerNorm (post-LN). La posición (PE de la imagen y el embedding original de los tokens) se suma a Q y K, nunca a V.',
    grid: { w: 100, h: 76 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa', x: 2, y: 11, w: 96, h: 54, repeat: { sym: 'capas', from: 'Ldec', tag: '× {v} capas', crumb: false } },
    ],
    nodes: [
      { id: 'tok-in', op: 'io', modality: 'qry', label: 'Tokens', sub: 'salida + prompt', x: 6, y: 1, w: 26, h: 5, note: 'Los 5 tokens de salida y los del prompt.' },
      { id: 'img-in', op: 'io', modality: 'img', label: 'Imagen', sub: '64×64 → 4096 tokens', x: 62, y: 1, w: 30, h: 5, note: 'El embedding (+ prompt denso) aplanado: 4096 tokens de 256.' },
      { id: 'tok-self', op: 'attn', label: 'Self-attention', sub: 'entre tokens · ⊕ + LN', heads: 'hDec', headsSym: 'h', x: 6, y: 16, w: 26, h: 7,
        tex: 'T \\leftarrow \\mathrm{LN}(T + \\mathrm{SA}(T{+}P_T))', note: 'Los tokens se miran entre sí (en la 1.ª capa, sin sumar su posición). Así un token de máscara sabe qué puntos y qué otros tokens hay.' },
      { id: 'tok2img', op: 'attn', label: 'Tokens ← imagen', sub: 'Q: tokens · K, V: imagen', heads: 'hDec', headsSym: 'h', x: 6, y: 29, w: 26, h: 7,
        tex: 'T \\leftarrow \\mathrm{LN}(T + \\mathrm{Attn}(Q{=}T{+}P_T,\\, K{=}E{+}PE,\\, V{=}E))', note: 'Cross-attention: cada token consulta los 4096 píxeles (el paper la llama token-to-image: el token es la query). Proyecta a 128 (la mitad) para abaratarla.' },
      { id: 'mlp', op: 'mlp', label: 'MLP de los tokens', sub: '256 → 2048 → 256', x: 6, y: 42, w: 26, h: 7,
        tex: 'T \\leftarrow \\mathrm{LN}(T + \\mathrm{MLP}(T))', note: 'Un MLP (ReLU) por token. Solo a los tokens: aplicarlo a los 4096 píxeles costaría mucho más.' },
      { id: 'img2tok', op: 'attn', label: 'Imagen ← tokens', sub: 'Q: imagen · K,V: tokens', heads: 'hDec', headsSym: 'h', x: 64, y: 53, w: 26, h: 7,
        tex: 'E \\leftarrow \\mathrm{LN}(E + \\mathrm{Attn}(Q{=}E{+}PE,\\, K{=}T{+}P_T,\\, V{=}T))', note: 'La dirección inversa (el paper: image-to-token): cada píxel consulta los pocos tokens y se actualiza con lo que dicen del prompt. Es lo que hace "two-way" a este transformer.' },
      { id: 'tok-out', op: 'io', modality: 'qry', label: 'Tokens', sub: '→ capa siguiente', x: 6, y: 69, w: 26, h: 5, note: 'Los tokens actualizados.' },
      { id: 'img-out', op: 'io', modality: 'img', label: 'Imagen', sub: '→ capa siguiente', x: 62, y: 69, w: 30, h: 5, note: 'La imagen actualizada.' },
    ],
    tensors: [
      { id: 'tw-t2i-scores', at: { x: 48, y: 27 }, glyph: 'amat', axes: { rows: 'qry', cols: 'img' }, show: 'both', labelSide: 'below', note: 'token × píxel', leader: { node: 'tok2img', side: 'right', at: 0.2 } },
    ],
    edges: [
      { from: 'tok-in', to: 'tok-self', kind: 'data', tensor: 'tokens', labelT: 0.2 },
      { from: 'tok-self', to: 'tok2img', kind: 'data', tensor: 'tw-n1', label: false },
      { from: 'tok2img', to: 'mlp', kind: 'data', tensor: 'tw-n2', label: false },
      { from: 'mlp', to: 'tok-out', kind: 'data', tensor: 'tw-n3', labelT: 0.8 },
      { from: 'img-in', to: 'img2tok', kind: 'data', tensor: 'src-seq', labelT: 0.3 },
      { from: 'img2tok', to: 'img-out', kind: 'data', tensor: 'tw-keys', label: false },
      { from: 'img-in', to: 'tok2img', kind: 'cross', tensor: 'src-seq', fromPt: [77, 32.5], toSide: 'right', label: false, tag: 'K,V: imagen', tagT: 0.3 },
      { from: 'mlp', to: 'img2tok', kind: 'cross', tensor: 'tw-n3', fromPt: [19, 56.5], toSide: 'left', label: false, tag: 'K,V: tokens', tagT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
