/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/clip.js
   Diagramas de CLIP (SPEC §7.2, ids de §14.3), config canónica clip-vit-b16:
     clip-overview       las dos torres en paralelo (imagen izquierda, franja --mod-img; texto
                         derecha, franja --mod-txt) → proyecciones → L2 → lote B → matriz B×B →
                         × e^t → pérdida contrastiva simétrica
     clip-image-encoder  el ViT de CLIP y sus diferencias con timm (conv sin sesgo, ln_pre, ln_post
                         solo sobre el CLS)       → clip-img-layer → clip-img-mhsa
     clip-text-encoder   token + posición, capas causales, LN final, tomar el EOT
                                                  → clip-text-layer → clip-text-mhsa (con la máscara)
   Las dos torres comparten ids de nodo (enc-layer, ln1, qkv, …) y de path: cada nodo lleva
   scope:'img-encoder' o 'txt-encoder' para que su costo sea el de su torre. Solo datos; no toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'clip-vit-b16';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const PAGE = { page: 'clip', section: 'diagrama' };
  const scoped = (scope, nodes) => nodes.map((n) => (n.op === 'io' ? n : Object.assign({ scope }, n)));

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'clip-overview', model: 'clip', config: C, kind: 'arch',
    title: 'CLIP — vista general',
    caption: 'Dos torres que no se tocan hasta el final: la imagen (izquierda) y el texto (derecha) se codifican por separado, se proyectan al mismo espacio de E dimensiones y se normalizan. Recién ahí se apila el lote de B pares y se comparan todos contra todos: una matriz B×B cuya diagonal son los pares correctos. Las formas de las torres son por muestra; las del final, del lote.',
    grid: { w: 86, h: 100 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['img-encoder', 'txt-encoder', 'similarity'],
    nodes: [
      { id: 'img-input', op: 'io', label: 'Imagen', image: true, x: 13, y: 1, w: 14, h: 13,
        note: 'Una imagen RGB, H×W×3. Cada imagen del lote viene con su texto (el par).' },
      { id: 'txt-input', op: 'io', label: 'Texto', sub: 'T ids BPE', subNum: '{{cfg.T}} ids BPE', x: 51, y: 3, w: 22, h: 8,
        note: 'El texto del par, p. ej. "a photo of a dog", tokenizado con BPE (vocabulario de ' + q('cfg.V') + ') entre [SOT] y [EOT] y rellenado hasta T = ' + q('cfg.T') + '.' },
      { id: 'img-encoder', op: 'attn', style: 'block', modality: 'img', label: 'Encoder de imagen', sub: 'ViT (L capas)', subNum: 'ViT, P = {{cfg.P}}, {{cfg.L}} capas',
        x: 6, y: 21, w: 28, h: 9, expand: 'clip-image-encoder',
        tex: 'f_I(x) = \\mathrm{LN}_{post}(\\mathrm{ViT}(x)_{[CLS]}) \\in \\mathbb{R}^{D}',
        note: 'Un ViT casi igual al de la página anterior (conv de parches sin sesgo, una LayerNorm antes del encoder y otra solo sobre el [CLS] al final). Devuelve un vector de D por imagen. Ábrelo para ver las diferencias.' },
      { id: 'txt-encoder', op: 'attn', style: 'block', modality: 'txt', label: 'Encoder de texto', sub: 'transformer causal', subNum: 'causal, {{cfg.Lt}} capas',
        x: 48, y: 21, w: 28, h: 9, expand: 'clip-text-encoder',
        tex: 'f_T(t) = \\mathrm{LN}(\\mathrm{TF}_{causal}(t))_{[EOT]}',
        note: 'Un transformer de ' + q('cfg.Lt') + ' capas de ancho D_t = ' + q('cfg.Dt') + ' con máscara causal (como un decoder de lenguaje, sin generar nada). El vector del token [EOT] resume la frase. Ábrelo para verlo.' },
      { id: 'img-proj', op: 'embed', label: 'Proyección W_i', sub: 'Linear D → E', x: 10, y: 38, w: 20, h: 5,
        tex: 'I_e = W_i\\, f_I(x),\\; W_i \\in \\mathbb{R}^{E\\times D}', note: 'Lleva el vector de la imagen al espacio conjunto de E = ' + q('cfg.E') + ' dimensiones. Sin sesgo.' },
      { id: 'txt-proj', op: 'embed', label: 'Proyección W_t', sub: 'Linear D_t → E', x: 52, y: 38, w: 20, h: 5,
        tex: 'T_e = W_t\\, f_T(t),\\; W_t \\in \\mathbb{R}^{E\\times D_t}', note: 'Lleva el vector del texto al mismo espacio de E dimensiones. Sin sesgo.' },
      { id: 'img-norm', op: 'norm', symbol: 'sphere', label: 'Normalizar (L2)', x: 9, y: 50, w: 22, h: 4.5,
        tex: '\\hat I = I_e / \\lVert I_e \\rVert_2', note: 'Divide por la norma: todos los embeddings quedan en la esfera unidad, así el producto punto es el coseno. Sin parámetros. Aquí se apilan las B imágenes del lote.' },
      { id: 'txt-norm', op: 'norm', symbol: 'sphere', label: 'Normalizar (L2)', x: 51, y: 50, w: 22, h: 4.5,
        tex: '\\hat T = T_e / \\lVert T_e \\rVert_2', note: 'Igual para el texto. Aquí se apilan los B textos del lote.' },
      { id: 'similarity', op: 'fuse', label: 'Similitud coseno', sub: 'todas contra todas', x: 27, y: 66, w: 28, h: 6,
        tex: 'S = \\hat I\\, \\hat T^{\\top} \\in \\mathbb{R}^{B\\times B}', note: 'Una sola matmul compara cada imagen con cada texto del lote: B×B similitudes. La diagonal son los pares correctos; el resto, B − 1 negativos por fila. Es el único lugar donde las dos modalidades se encuentran.' },
      { id: 'temperature', op: 'head', label: 'Escala eᵗ', sub: '= 1/τ, aprendida', x: 31, y: 78, w: 20, h: 5,
        tex: '\\text{logits} = S\\cdot e^{t},\\; e^{t_0} = 1/0.07,\\; e^{t} \\le 100', note: 'Un único escalar aprendido (la inversa de la temperatura τ) multiplica todas las similitudes: controla qué tan "afilada" es la softmax. Empieza en 1/0.07 y se recorta a 100.' },
      { id: 'loss', op: 'head', label: 'Pérdida contrastiva', sub: 'CE simétrica', x: 29, y: 92, w: 24, h: 6,
        tex: '\\begin{aligned} L &= \\tfrac12\\big[\\mathrm{CE}(\\text{logits}, y) + \\mathrm{CE}(\\text{logits}^{\\top}, y)\\big] \\\\ y &= (0, 1, \\dots, B{-}1) \\end{aligned}',
        note: 'Cross-entropy por filas (cada imagen debe elegir su texto entre los B) y por columnas (cada texto su imagen), promediadas. Las etiquetas son la diagonal: no hace falta anotar clases.' },
    ],
    tensors: [
      { id: 'i-img', at: { edge: 'img-input>img-encoder' }, show: 'both' },
      { id: 'img-batch', at: { edge: 'img-norm>similarity' }, show: 'both' },
      { id: 'txt-batch', at: { edge: 'txt-norm>similarity' }, show: 'both' },
      { id: 'logits', at: { edge: 'temperature>loss' }, show: 'both' },
    ],
    notes: [
      { x: 41, y: 25.2, text: 'torres', anchor: 'middle' },
      { x: 41, y: 27.0, text: 'independientes', anchor: 'middle' },
    ],
    edges: [
      { from: 'img-input', to: 'img-encoder', kind: 'data', tensor: 'i-img' },
      { from: 'txt-input', to: 'txt-encoder', kind: 'data', tensor: 't-ids', labelT: 0.45 },
      { from: 'img-encoder', to: 'img-proj', kind: 'data', tensor: 'i-cls-ln' },
      { from: 'txt-encoder', to: 'txt-proj', kind: 'data', tensor: 't-eot' },
      { from: 'img-proj', to: 'img-norm', kind: 'data', tensor: 'i-emb' },
      { from: 'txt-proj', to: 'txt-norm', kind: 'data', tensor: 't-emb' },
      { from: 'img-norm', to: 'similarity', kind: 'data', tensor: 'img-batch', fromSide: 'bottom', toSide: 'top', toAt: 0.3, midY: 62, labelSeg: 0 },
      { from: 'txt-norm', to: 'similarity', kind: 'data', tensor: 'txt-batch', fromSide: 'bottom', toSide: 'top', toAt: 0.7, midY: 62, labelSeg: 0 },
      { from: 'similarity', to: 'temperature', kind: 'data', tensor: 'sims' },
      { from: 'temperature', to: 'loss', kind: 'data', tensor: 'logits' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (CLIP ViT-B/16)', steps: [
        { nodes: ['img-input'], edges: ['img-input>img-encoder'], tensors: ['i-img'],
          text: 'Un par del lote: una imagen de <b>' + q('tensor.i-img.shape') + '</b> y su texto. Las torres trabajan con una muestra a la vez (formas sin batch).' },
        { expand: 'clip-image-encoder', nodes: ['patch-embed'], edges: ['in>patch-embed', 'patch-embed>cls'], tensors: ['i-img', 'i-patches'],
          text: 'Torre de imagen. Parches de ' + q('cfg.P') + '×' + q('cfg.P') + ' con una conv <b>sin sesgo</b> (' + q('op.i-patch-embed.paramArith') + ' parámetros): <b>' + q('tensor.i-patches.shape') + '</b>.' },
        { expand: 'clip-image-encoder', nodes: ['cls', 'pos-embed', 'add-pos', 'ln-pre'], edges: ['patch-embed>cls', 'cls>add-pos', 'pos-embed>add-pos', 'add-pos>ln-pre', 'ln-pre>enc-layer'], tensors: ['i-cls-cat', 'i-x0', 'i-ln-pre'],
          text: '[CLS] + posiciones como en ViT (<b>' + q('tensor.i-x0.shape') + '</b>) y una LayerNorm <b>antes</b> del encoder (<code>ln_pre</code>), que el ViT de timm no tiene.' },
        { expand: 'clip-image-encoder', nodes: ['enc-layer'], edges: ['ln-pre>enc-layer', 'enc-layer>pool-cls'], tensors: ['i-ln-pre', 'i-x-out'],
          text: 'L = ' + q('cfg.L') + ' capas pre-LN idénticas a las de ViT (' + q('layerParamsImg') + ' parámetros cada una): <b>' + q('tensor.i-x-out.shape') + '</b>.' },
        { expand: 'clip-image-encoder', nodes: ['pool-cls', 'ln-post'], edges: ['enc-layer>pool-cls', 'pool-cls>ln-post', 'ln-post>out'], tensors: ['i-cls', 'i-cls-ln'],
          text: 'Se toma el [CLS] y <b>después</b> se normaliza (<code>ln_post</code>, solo sobre ese vector): <b>' + q('tensor.i-cls-ln.shape') + '</b>.' },
        { nodes: ['img-proj', 'img-norm'], edges: ['img-encoder>img-proj', 'img-proj>img-norm'], tensors: ['i-cls-ln', 'i-emb'],
          text: 'W_i proyecta D → E sin sesgo (' + q('op.img-proj.paramArith') + '): <b>' + q('tensor.i-emb.shape') + '</b>, y se normaliza a norma 1.' },
        { nodes: ['txt-input'], edges: ['txt-input>txt-encoder'], tensors: ['t-ids'],
          text: 'Torre de texto. El texto se tokeniza con BPE y se rellena a T = ' + q('cfg.T') + ': <b>' + q('tensor.t-ids.shape') + '</b> ids.' },
        { expand: 'clip-text-encoder', nodes: ['tok-embed', 'pos-embed', 'add-pos'], edges: ['tokens>tok-embed', 'tok-embed>add-pos', 'pos-embed>add-pos', 'add-pos>enc-layer'], tensors: ['t-tok', 't-x0'],
          text: 'Tabla de tokens (' + q('cfg.V') + ' × ' + q('cfg.Dt') + ' = ' + q('tokEmbedParams') + ' parámetros) + posiciones aprendidas: <b>' + q('tensor.t-x0.shape') + '</b>.' },
        { expand: 'clip-text-mhsa', nodes: ['scores', 'scale', 'mask', 'softmax'], edges: ['scores>scale', 'scale>mask', 'mask>softmax'], tensors: ['t-scores', 't-masked'],
          text: 'Dentro de cada capa, la atención es <b>causal</b>: antes de la softmax, la máscara pone −∞ sobre el futuro (<b>' + q('tensor.t-masked.shape') + '</b>). Cada token solo ve a los anteriores.' },
        { expand: 'clip-text-encoder', nodes: ['enc-layer', 'ln-final', 'pick-eot'], edges: ['add-pos>enc-layer', 'enc-layer>ln-final', 'ln-final>pick-eot', 'pick-eot>out'], tensors: ['t-x-out', 't-ln-final', 't-eot'],
          text: 'Tras ' + q('cfg.Lt') + ' capas, LayerNorm final y se toma el vector del token <b>[EOT]</b>: por la máscara causal es el único que vio toda la frase. <b>' + q('tensor.t-eot.shape') + '</b>.' },
        { nodes: ['txt-proj', 'txt-norm'], edges: ['txt-encoder>txt-proj', 'txt-proj>txt-norm'], tensors: ['t-eot', 't-emb'],
          text: 'W_t proyecta D_t → E (' + q('op.txt-proj.paramArith') + '): <b>' + q('tensor.t-emb.shape') + '</b>, norma 1. Imagen y texto viven ahora en el mismo espacio.' },
        { nodes: ['similarity'], edges: ['img-norm>similarity', 'txt-norm>similarity', 'similarity>temperature'], tensors: ['img-batch', 'txt-batch', 'sims'],
          text: 'Se apilan los B = ' + q('cfg.B') + ' pares: <b>' + q('tensor.img-batch.shape') + '</b> y <b>' + q('tensor.txt-batch.shape') + '</b>. Una matmul da <b>' + q('tensor.sims.shape') + '</b> cosenos. Nuestra imagen es una fila: su texto (la diagonal) contra ' + q('negatives') + ' negativos.' },
        { nodes: ['temperature', 'loss'], edges: ['similarity>temperature', 'temperature>loss'], tensors: ['logits'],
          text: 'Todo se multiplica por e^t (1 parámetro) y la pérdida hace softmax por filas (imagen → texto) y por columnas (texto → imagen), con la diagonal como etiqueta. La matriz de logits del lote ocupa ' + q('metrics.logitsMem') + ' en bf16.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) encoder de imagen
  ATLAS.registerDiagram(Object.assign({
    id: 'clip-image-encoder', model: 'clip', config: C, kind: 'arch',
    title: 'Encoder de imagen de CLIP', parent: 'clip-overview', parentNode: 'img-encoder',
    caption: 'El mismo ViT de la página anterior con tres cambios (marcados "≠ timm"): la conv de parches sin sesgo, una LayerNorm antes del encoder (<code>ln_pre</code>) y, al final, primero se toma el [CLS] y después se normaliza solo ese vector (ln_post).',
    grid: { w: 62, h: 112 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'encoder', label: 'Transformer encoder', x: 10, y: 62, w: 42, h: 16, repeat: { sym: 'L', from: 'L', totalOf: 'enc-layer' }, modality: 'img' },
    ],
    nodes: scoped('img-encoder', [
      { id: 'in', op: 'io', label: 'Imagen', image: true, x: 24, y: 1, w: 14, h: 12, note: 'La imagen de entrada con la cuadrícula de parches.' },
      { id: 'patch-embed', op: 'conv', label: 'Patch embedding', sub: 'conv P×P, sin sesgo', subNum: 'conv {{cfg.P}}×{{cfg.P}}, s {{cfg.P}}, sin sesgo', flag: '≠ timm', x: 16, y: 19, w: 30, h: 6,
        tex: 'X_p = \\mathrm{flatten}(\\mathrm{Conv}_{P\\times P,\\,s=P}(x)),\\ \\text{sin } b', note: 'Igual que en ViT, pero la conv no tiene sesgo (P²·3·D parámetros en vez de P²·3·D + D).' },
      { id: 'cls', op: 'embed', label: 'Anteponer [CLS]', sub: 'token aprendido: D', x: 20, y: 32, w: 22, h: 5, tex: '[\\,x_{cls};\\, X_p\\,]', note: 'El token de clase aprendido, como en ViT.' },
      { id: 'pos-embed', op: 'embed', label: 'Posición E_pos', sub: 'aprendida', x: 1, y: 42, w: 17, h: 6, tex: 'E_{pos} \\in \\mathbb{R}^{(N+1)\\times D}', note: 'Tabla de posiciones aprendida, una fila por token (incluido el [CLS]).' },
      { id: 'add-pos', op: 'tensorop', shape: 'add', label: 'Sumar', labelPos: 'none', x: 29, y: 43, w: 4, h: 4, tex: 'z_0 = [\\,x_{cls};\\, X_p\\,] + E_{pos}', note: 'Suma elemento a elemento.' },
      { id: 'ln-pre', op: 'norm', label: 'LayerNorm previa', flag: '≠ timm', x: 19, y: 53, w: 24, h: 4, tex: '\\mathrm{LN}_{pre}(z_0)', note: 'Una LayerNorm antes de la primera capa (<code>ln_pre</code>). El ViT de timm (<code>vit_base_patch16_224</code>) no la tiene; los ViT de CLIP en timm la activan con <code>pre_norm=True</code>.' },
      { id: 'enc-layer', op: 'attn', style: 'block', badgeTotal: true, label: 'Capa del encoder (pre-LN)', x: 15, y: 67, w: 32, h: 9, expand: 'clip-img-layer',
        mini: { items: [{ label: 'LN', op: 'norm' }, { label: 'MHSA', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] },
        tex: "\\begin{aligned} z'_\\ell &= \\mathrm{MSA}(\\mathrm{LN}(z_{\\ell-1})) + z_{\\ell-1} \\\\ z_\\ell &= \\mathrm{MLP}(\\mathrm{LN}(z'_\\ell)) + z'_\\ell \\end{aligned}",
        note: 'La misma capa pre-LN de ViT (con QuickGELU en los pesos originales: mismos conteos). Ábrela.' },
      { id: 'pool-cls', op: 'tensorop', shape: 'pool', label: 'Tomar [CLS]', labelPos: 'left', x: 29, y: 85, w: 4, h: 4, tex: 'y = z_L^{0}', note: 'Se queda con el token 0. En CLIP esto pasa ANTES de la LayerNorm final.' },
      { id: 'ln-post', op: 'norm', label: 'LayerNorm del [CLS]', flag: '≠ timm', x: 19, y: 95, w: 24, h: 4, tex: '\\mathrm{LN}_{post}(y)', note: 'La LayerNorm final (<code>ln_post</code>) se aplica solo al vector del [CLS] (en timm ViT: LayerNorm sobre todos los tokens y después tomar el [CLS]). Como LN es por token, el resultado es el mismo; el orden cambia qué se calcula.' },
      { id: 'out', op: 'io', label: 'Hacia W_i', x: 23, y: 106, w: 16, h: 4, note: 'El vector de la imagen va a la proyección W_i (D → E).' },
    ]),
    tensors: [
      { id: 'i-img', at: { edge: 'in>patch-embed' }, show: 'both' },
      { id: 'i-x0', at: { edge: 'add-pos>ln-pre' }, show: 'label' },
      { id: 'i-cls', at: { edge: 'pool-cls>ln-post' }, show: 'both' },
    ],
    edges: [
      { from: 'in', to: 'patch-embed', kind: 'data', tensor: 'i-img' },
      { from: 'patch-embed', to: 'cls', kind: 'data', tensor: 'i-patches' },
      { from: 'cls', to: 'add-pos', kind: 'data', tensor: 'i-cls-cat' },
      { from: 'pos-embed', to: 'add-pos', kind: 'data', tensor: 'i-e-pos', fromSide: 'right', toSide: 'left', labelSide: 'above' },
      { from: 'add-pos', to: 'ln-pre', kind: 'data', tensor: 'i-x0' },
      { from: 'ln-pre', to: 'enc-layer', kind: 'data', tensor: 'i-ln-pre', labelT: 0.3 },
      { from: 'enc-layer', to: 'pool-cls', kind: 'data', tensor: 'i-x-out', labelT: 0.72 },
      { from: 'pool-cls', to: 'ln-post', kind: 'data', tensor: 'i-cls' },
      { from: 'ln-post', to: 'out', kind: 'data', tensor: 'i-cls-ln' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) encoder de texto
  ATLAS.registerDiagram(Object.assign({
    id: 'clip-text-encoder', model: 'clip', config: C, kind: 'arch',
    title: 'Encoder de texto de CLIP', parent: 'clip-overview', parentNode: 'txt-encoder',
    caption: 'Tokens BPE → tabla de embeddings + posiciones → capas pre-LN con máscara causal → LayerNorm final → el vector del token [EOT] (el último: por la máscara, el único que vio toda la frase).',
    grid: { w: 62, h: 88 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'encoder', label: 'Transformer (causal)', x: 10, y: 36, w: 42, h: 16, repeat: { sym: 'L_t', from: 'Lt', totalOf: 'enc-layer' }, modality: 'txt' },
    ],
    nodes: scoped('txt-encoder', [
      { id: 'tokens', op: 'io', label: 'Texto → ids BPE', sub: '[SOT] … [EOT], relleno a T', subNum: '[SOT] … [EOT], relleno a {{cfg.T}}', x: 15, y: 1, w: 32, h: 6,
        note: 'El texto tokenizado con BPE (vocabulario de ' + q('cfg.V') + '), con los tokens especiales de inicio y fin, rellenado hasta T = ' + q('cfg.T') + ' posiciones.' },
      { id: 'tok-embed', op: 'embed', label: 'Token embedding', sub: 'tabla V × D_t', subNum: 'tabla {{cfg.V}} × {{cfg.Dt}}', x: 17, y: 14, w: 28, h: 6,
        tex: 'X = E_{tok}[\\,\\text{ids}\\,],\\; E_{tok} \\in \\mathbb{R}^{V\\times D_t}', note: 'Una fila de la tabla por id: es un lookup, sin MACs. Es el bloque con más parámetros de la torre de texto.' },
      { id: 'pos-embed', op: 'embed', label: 'Posición E_pos', sub: 'aprendida', x: 1, y: 25, w: 17, h: 6, tex: 'E_{pos} \\in \\mathbb{R}^{T\\times D_t}', note: 'Una fila aprendida por posición (T = ' + q('cfg.T') + ').' },
      { id: 'add-pos', op: 'tensorop', shape: 'add', label: 'Sumar', labelPos: 'none', x: 29, y: 26, w: 4, h: 4, tex: 'x_0 = X + E_{pos}', note: 'Suma elemento a elemento.' },
      { id: 'enc-layer', op: 'attn', style: 'block', badgeTotal: true, label: 'Capa causal (pre-LN)', x: 15, y: 41, w: 32, h: 9, expand: 'clip-text-layer',
        mini: { items: [{ label: 'LN', op: 'norm' }, { label: 'MHSA causal', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] },
        tex: "\\begin{aligned} z'_\\ell &= \\mathrm{MSA}_{causal}(\\mathrm{LN}(z_{\\ell-1})) + z_{\\ell-1} \\\\ z_\\ell &= \\mathrm{MLP}(\\mathrm{LN}(z'_\\ell)) + z'_\\ell \\end{aligned}",
        note: 'Igual que una capa de ViT, pero la atención lleva máscara causal: el token i solo atiende a 0…i. Ábrela.' },
      { id: 'ln-final', op: 'norm', label: 'LayerNorm final', x: 19, y: 59, w: 24, h: 4, tex: '\\mathrm{LN}(z_{L_t})', note: 'Sobre todos los tokens.' },
      { id: 'pick-eot', op: 'tensorop', shape: 'pill', symbol: 'pick', label: 'Tomar el token [EOT]', x: 17, y: 70, w: 28, h: 4, tex: 'y = z_{L_t}[\\,\\arg\\max(\\text{ids})\\,]', note: 'Se queda con el vector del [EOT] (en el código: la posición del id más alto, que es el [EOT]). Por la máscara causal, es el único token que vio la frase entera; hace de [CLS] del texto.' },
      { id: 'out', op: 'io', label: 'Hacia W_t', x: 23, y: 81, w: 16, h: 4, note: 'El vector del texto va a la proyección W_t (D_t → E).' },
    ]),
    tensors: [
      { id: 't-eot', at: { edge: 'pick-eot>out' }, show: 'both' },
    ],
    edges: [
      { from: 'tokens', to: 'tok-embed', kind: 'data', tensor: 't-ids' },
      { from: 'tok-embed', to: 'add-pos', kind: 'data', tensor: 't-tok' },
      { from: 'pos-embed', to: 'add-pos', kind: 'data', tensor: 't-e-pos', fromSide: 'right', toSide: 'left', labelSide: 'above' },
      { from: 'add-pos', to: 'enc-layer', kind: 'data', tensor: 't-x0', labelT: 0.3 },
      { from: 'enc-layer', to: 'ln-final', kind: 'data', tensor: 't-x-out', labelT: 0.72 },
      { from: 'ln-final', to: 'pick-eot', kind: 'data', tensor: 't-ln-final' },
      { from: 'pick-eot', to: 'out', kind: 'data', tensor: 't-eot' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) capa y MHSA de cada torre
  // Misma geometría que vit-enc-layer / vit-mhsa (para comparar 1:1); la de texto agrega la máscara causal.
  function layerSpec(tw) {
    const img = tw === 'img', p = img ? 'i-' : 't-', scope = img ? 'img-encoder' : 'txt-encoder';
    return Object.assign({
      id: img ? 'clip-img-layer' : 'clip-text-layer', model: 'clip', config: C, kind: 'arch',
      title: img ? 'Capa del encoder de imagen' : 'Capa del encoder de texto (causal)',
      parent: img ? 'clip-image-encoder' : 'clip-text-encoder', parentNode: 'enc-layer',
      caption: img
        ? 'La capa pre-LN de ViT, idéntica: LayerNorm → MHSA → residual → LayerNorm → MLP → residual.'
        : 'La misma capa pre-LN, con una diferencia: la atención es causal (la máscara entra por la izquierda). Entra y sale la misma forma.',
      grid: { w: 62, h: 86 }, direction: 'tb', maxCrossings: 0,
      groups: [
        { id: 'layer', label: img ? 'Capa ℓ (pesos propios)' : 'Capa ℓ (causal)', labelPos: 'bottom', x: 8, y: 6, w: 48, h: 68, repeat: img ? { sym: 'L', from: 'L' } : { sym: 'L_t', from: 'Lt' }, modality: tw === 'img' ? 'img' : 'txt' },
      ],
      nodes: scoped(scope, [
        { id: 'in', op: 'io', label: 'Entrada z_{ℓ−1}', x: 22, y: 1, w: 16, h: 4, note: 'La salida de la capa anterior.' },
        { id: 'ln1', op: 'norm', label: 'LayerNorm 1', x: 19, y: 14, w: 22, h: 4, tex: '\\mathrm{LN}(x)', note: 'Por token; 2·D parámetros.' },
        { id: 'mhsa', op: 'attn', label: img ? 'Multi-head self-attention' : 'MHSA con máscara causal', sub: img ? 'Q, K, V del mismo flujo' : 'cada token ve 0…i', heads: img ? 'h' : 'ht', headsSym: 'h',
          x: 17, y: 25, w: 26, h: 6, expand: img ? 'clip-img-mhsa' : 'clip-text-mhsa', flag: img ? undefined : 'causal',
          tex: img ? '\\mathrm{MSA}(X)' : '\\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_h}} + M_{causal}\\right)V', note: img ? 'Como en ViT. Ábrela.' : 'La máscara pone −∞ sobre las posiciones futuras antes de la softmax. Ábrela para ver dónde entra.' },
        { id: 'res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: 'right', x: 28, y: 36, w: 4, h: 4, tex: "z' = \\mathrm{MSA}(\\mathrm{LN}(z)) + z", note: 'Suma la entrada de la capa.' },
        { id: 'ln2', op: 'norm', label: 'LayerNorm 2', x: 19, y: 46, w: 22, h: 4, tex: "\\mathrm{LN}(z')", note: 'Antes del MLP.' },
        { id: 'mlp', op: 'mlp', label: 'MLP', sub: img ? 'D → D_mlp → D · QuickGELU' : 'D_t → 4D_t → D_t · QuickGELU', x: 15, y: 55, w: 30, h: 6, tex: '\\begin{aligned} \\mathrm{MLP}(x) &= W_2\\,\\mathrm{QG}(W_1 x + b_1) + b_2 \\\\ \\mathrm{QG}(u) &= u\\,\\sigma(1.702\\,u) \\end{aligned}', note: 'Dos lineales con QuickGELU, x·σ(1.702x) (los conteos son los de GELU).' },
        { id: 'res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: 'right', x: 28, y: 66, w: 4, h: 4, tex: "z = \\mathrm{MLP}(\\mathrm{LN}(z')) + z'", note: 'Cierra la capa.' },
        { id: 'out', op: 'io', label: 'Salida z_ℓ', x: 22, y: 81, w: 16, h: 4, note: 'Misma forma que la entrada.' },
      ]),
      edges: [
        { from: 'in', to: 'ln1', kind: 'data', tensor: img ? 'i-ln-pre' : 't-x0', labelT: 0.66 },
        { from: 'in', to: 'res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[30, 7.5], [12, 7.5], [12, 38]], dot: true },
        { from: 'ln1', to: 'mhsa', kind: 'data', tensor: p + 'h-ln1', labelT: 0.28 },
        { from: 'mhsa', to: 'res1', kind: 'data', tensor: p + 'o' },
        { from: 'res1', to: 'ln2', kind: 'data', tensor: p + 'r1' },
        { from: 'res1', to: 'res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[30, 42], [12, 42], [12, 68]], dot: true },
        { from: 'ln2', to: 'mlp', kind: 'data', tensor: p + 'h-ln2' },
        { from: 'mlp', to: 'res2', kind: 'data', tensor: p + 'f' },
        { from: 'res2', to: 'out', kind: 'data', tensor: p + 'x-out', labelT: 0.74 },
      ],
      tensors: [
        { id: p + 'attn', at: { x: 50, y: 42 }, show: 'both', labelSide: 'below', note: 'A (en la MHSA)' },
      ],
      legend: 'auto',
    }, PAGE);
  }

  function mhsaSpec(tw) {
    const img = tw === 'img', p = img ? 'i-' : 't-', scope = img ? 'img-encoder' : 'txt-encoder';
    const d = img ? 0 : 9;                          // la máscara (solo texto) empuja todo 9 u hacia abajo
    const D = img ? 'D' : 'D_t';
    const nodes = [
      { id: 'in', op: 'io', label: 'Entrada (tras LN 1)', x: 21, y: 1, w: 18, h: 4, note: 'Los tokens normalizados por la LayerNorm 1.' },
      { id: 'qkv', op: 'embed', label: 'Proyección Q, K, V', sub: 'Linear ' + D + ' → 3' + D, x: 16, y: 9, w: 28, h: 5, tex: '[\\,Q\\;K\\;V\\,] = X\\,W_{QKV} + b', note: 'Una matmul fusionada D → 3D, con sesgo.' },
      { id: 'split', op: 'tensorop', shape: 'pill', symbol: 'split', label: 'Dividir: Q, K, V · h cabezas', x: 14, y: 19, w: 32, h: 4, tex: '\\to 3\\times h\\times n\\times d_h', note: 'Reshape: separa Q, K, V y las h cabezas.' },
      { id: 'scores', op: 'attn', label: 'Q · Kᵀ', sub: 'producto punto entre todos los pares', x: 12, y: 35, w: 36, h: 5, tex: 'S = QK^\\top', note: img ? 'Cada token contra todos: (N+1)² por cabeza.' : 'Se calcula la matriz T×T completa; la máscara anula después el triángulo superior.' },
      { id: 'scale', op: 'attn', label: '÷ √d_h', shape: 'pill', x: 20, y: 49, w: 20, h: 4, tex: 'S/\\sqrt{d_h}', note: 'Escala estándar.' },
    ].concat(img ? [] : [
      { id: 'mask', op: 'attn', shape: 'pill', symbol: 'mask', label: '+ máscara causal', x: 17, y: 57, w: 26, h: 4,
        tex: 'S_{ij} \\leftarrow -\\infty \\;\\text{si}\\; j > i', note: 'Pone −∞ en las posiciones futuras (j > i): tras la softmax pesan 0. Sin parámetros ni MACs; con T = ' + q('cfg.T') + ' se usan T(T+1)/2 de los T² pares.' },
    ]).concat([
      { id: 'softmax', op: 'attn', label: 'softmax', sub: 'por fila', x: 20, y: 57 + d, w: 20, h: 5, tex: 'A = \\mathrm{softmax}(\\cdot)', note: 'Cada fila suma 1.' },
      { id: 'weighted-sum', op: 'attn', label: 'A · V', sub: 'promedio ponderado de los values', x: 12, y: 72 + d, w: 36, h: 5, tex: '\\mathrm{head}_i = A_i V_i', note: 'Mezcla los values con los pesos.' },
      { id: 'merge', op: 'tensorop', shape: 'concat', label: 'Concatenar cabezas', labelPos: 'right', x: 28, y: 86 + d, w: 4, h: 4, tex: '\\to n\\times D', note: 'h·d_h = D.' },
      { id: 'proj', op: 'embed', label: 'Proyección de salida W_O', sub: 'Linear ' + D + ' → ' + D, x: 16, y: 95 + d, w: 28, h: 5, tex: 'O = Z W_O + b', note: 'Mezcla las cabezas.' },
      { id: 'out', op: 'io', label: 'Hacia la residual 1', x: 21, y: 106 + d, w: 18, h: 4, note: 'Vuelve a la capa.' },
    ]);
    const edges = [
      { from: 'in', to: 'qkv', kind: 'data', tensor: p + 'h-ln1' },
      { from: 'qkv', to: 'split', kind: 'data', tensor: p + 'qkv' },
      { from: 'split', to: 'scores', kind: 'data', tensor: p + 'q', fromSide: 'bottom', fromAt: 0.0625, toSide: 'top', toAt: 0.1111, labelSide: 'left', labelT: 0.3, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.78 },
      { from: 'split', to: 'scores', kind: 'data', tensor: p + 'k', fromSide: 'bottom', toSide: 'top', labelT: 0.3, tag: 'K', tagStyle: 'plain', tagSide: 'on', tagT: 0.78 },
      { from: 'split', to: 'weighted-sum', kind: 'data', tensor: p + 'v', fromSide: 'right', toSide: 'right', via: [[54, 21], [54, 74.5 + d]], labelT: 0.62, tag: 'V', tagStyle: 'plain', tagSide: 'on', tagT: 0.1 },
      { from: 'scores', to: 'scale', kind: 'data', tensor: p + 'scores' },
    ].concat(img ? [
      { from: 'scale', to: 'softmax', kind: 'data', tensor: p + 'scores-scaled' },
    ] : [
      { from: 'scale', to: 'mask', kind: 'data', tensor: p + 'scores-scaled' },
      { from: 'mask', to: 'softmax', kind: 'data', tensor: p + 'masked' },
    ]).concat([
      { from: 'softmax', to: 'weighted-sum', kind: 'data', tensor: p + 'attn' },
      { from: 'weighted-sum', to: 'merge', kind: 'data', tensor: p + 'z-heads', labelT: 0.62 },
      { from: 'merge', to: 'proj', kind: 'data', tensor: p + 'z' },
      { from: 'proj', to: 'out', kind: 'data', tensor: p + 'o' },
    ]);
    return Object.assign({
      id: img ? 'clip-img-mhsa' : 'clip-text-mhsa', model: 'clip', config: C, kind: 'arch',
      title: img ? 'MHSA (imagen)' : 'MHSA causal (texto)', parent: img ? 'clip-img-layer' : 'clip-text-layer', parentNode: 'mhsa',
      caption: img
        ? 'La MHSA de ViT con los números de CLIP: Q, K, V → h cabezas → QKᵀ/√d_h → softmax → A·V → concatenar → W_O.'
        : 'La misma MHSA con un paso más entre la escala y la softmax: la máscara causal (−∞ sobre el futuro). La matriz T×T se calcula entera; la máscara solo anula pesos.',
      grid: { w: 72, h: 111 + d }, direction: 'tb', maxCrossings: 0,
      groups: [
        { id: 'heads', label: 'Las h cabezas, en paralelo', labelPos: 'bottom-right', heads: img ? 'h' : 'ht', headsSym: 'h', x: 8, y: 31, w: 58, h: 49 + d },
      ],
      nodes: scoped(scope, nodes),
      tensors: [
        { id: p + 'qkv', at: { edge: 'qkv>split' }, show: 'both' },
        { id: p + 'v', at: { edge: 'split>weighted-sum' }, show: 'both' },
        { id: p + 'scores', at: { edge: 'scores>scale' }, show: 'both' },
        { id: p + 'attn', at: { edge: 'softmax>weighted-sum' }, show: 'both' },
        { id: p + 'z-heads', at: { edge: 'weighted-sum>merge' }, show: 'both' },
        { id: p + 'z', at: { edge: 'merge>proj' }, show: 'both' },
      ],
      edges,
      legend: 'auto',
    }, PAGE);
  }

  ATLAS.registerDiagram(layerSpec('img'));
  ATLAS.registerDiagram(layerSpec('txt'));
  ATLAS.registerDiagram(mhsaSpec('img'));
  ATLAS.registerDiagram(mhsaSpec('txt'));
})(typeof window !== 'undefined' ? window : globalThis);
