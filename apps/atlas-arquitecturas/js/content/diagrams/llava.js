/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/llava.js
   Diagramas de LLaVA-1.5 (SPEC §7.2, ids de §19.1), config canónica llava15-7b (modelo `llava`, js/arch/vlm.js):
     llava-overview     tres bandas:
                        1) la imagen → encoder CLIP ViT-L/14 (compacto: una fila de capas marca la penúltima, de la que se
                           toman las features; enlace a la vista del encoder en la página de CLIP) → penúltima capa sin
                           el CLS → proyector MLP
                        2) el texto → embedding → EMPALME en <image>: la tira del prompt (texto | tokens de la imagen |
                           texto) con ancho ∝ tokens: la imagen domina el prompt
                        3) el LLM decoder (× L; el bloque de la fase 6, con enlace a llm-block) → RMSNorm final → LM head →
                           respuesta
       llava-projector  fc1 → GELU → fc2 (el MLP de 2 capas)
     llava-training     (sección entrenamiento) etapa 1: solo entrena el proyector; etapa 2: proyector + LLM; el encoder,
                        congelado en las dos
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas las pone el motor desde ATLAS.Arch.run; aquí solo se
   nombran tensores (ids de vlm.js). Los nodos del proyector usan ops exactas (fc1/gelu/fc2 existen también dentro del ViT) y
   el empalme la op `splice` (path merge). No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'llava15-7b';
  const q = (k) => '{{' + C + '.' + k + '}}';
  // todas las vistas valen para las dos configs del modelo (7B y 13B: mismo encoder y proyector, otro LLM)
  const CONFIGS = ['llava15-7b', 'llava15-13b'];
  const PAGE = { page: 'llava', section: 'diagrama', configs: CONFIGS };
  const BLOCK_MINI = { items: [{ label: 'RMSNorm', op: 'norm' }, { label: 'Atención', op: 'attn' }, { sym: 'add' }, { label: 'RMSNorm', op: 'norm' }, { label: 'SwiGLU', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] };
  // La tira del prompt: el calculador da el total de texto T (no cuánto va antes y después de <image>): los dos tramos de
  // texto son mitades sin cuenta; las cuentas exactas van en el caption.
  const STRIP = {
    segs: [{ mod: 'txt', n: 'cfg.T', frac: 0.5, count: false, label: 'texto' }, { mod: 'img', n: 'metrics.visualTokens', label: 'tokens de la imagen' }, { mod: 'txt', n: 'cfg.T', frac: 0.5, count: false, label: 'texto' }],
    caption: 'imagen {{metrics.visualTokens}} + texto {{cfg.T}} = {{metrics.promptTokens}} tokens: {{metrics.visualShare}} es imagen',
  };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'llava-overview', model: 'llava', config: C, kind: 'arch', title: 'LLaVA-1.5 — vista general',
    caption: 'Un VLM = encoder de visión + proyector + el decoder de la fase 6. Arriba, la imagen pasa por el encoder de CLIP (congelado): se toman las features de la penúltima capa, se tira el CLS y un MLP de 2 capas lleva cada parche al ancho del LLM. En el medio, esos tokens visuales ocupan el lugar del marcador &lt;image&gt; del prompt: para el LLM son "más tokens", y son la mayoría (la tira tiene el ancho proporcional al número de tokens). Abajo, el mismo decoder de siempre genera la respuesta token a token.',
    grid: { w: 140, h: 83 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['merge'],
    groups: [
      { id: 'llm', label: 'LLM decoder ({{cfg.llmLabel}})', labelPos: 'bottom', x: 3, y: 60, w: 62, h: 21, repeat: { sym: 'L', from: 'L', totalOf: 'block', totalLabel: '= {t} en los bloques' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'image', op: 'io', image: true, imageGrid: 0, label: 'Imagen', x: 1, y: 1, w: 15, h: 17,
        note: 'Una imagen RGB. LLaVA-1.5 la rellena hasta un cuadrado (con el color de la media de normalización de CLIP, ≈ gris RGB 122, 116, 104; no el promedio de la imagen) y la redimensiona a ' + q('cfg.H') + '×' + q('cfg.W') + ' (alto × ancho), la resolución del encoder: el número de tokens visuales no depende del tamaño original.' },
      { id: 'vision-encoder', op: 'attn', style: 'block', modality: 'img', label: 'Encoder CLIP ViT-L/14', sub: 'L_v capas, D_v', subNum: '{{cfg.Lv}} capas · D_v = {{cfg.Dv}}',
        layers: { L: 'cfg.Lv', tap: 'cfg.featureLayer', tapLabel: '↑ se toma' }, train: 'frozen', x: 25, y: 1, w: 36, h: 17,
        xref: [{ href: '#clip.diagrama~clip-image-encoder.enc-layer', label: 'Ver el encoder por dentro (CLIP)' }],
        costNote: 'Incluye la última capa y ln_post: existen y HF las corre, pero su salida no se usa ({{' + C + '.metrics.visionMacsDiscarded}} descartados).',
        tex: 'H^{(\\ell)} = \\mathrm{Capa}_\\ell(H^{(\\ell-1)}),\\; H^{(0)} = [x_{cls}; x_p E] + E_{pos}',
        note: 'El encoder de imagen de CLIP ViT-L/14 a 336 px, tal cual (congelado en todo el entrenamiento). Es un ViT: parches de ' + q('cfg.P') + '×' + q('cfg.P') + ' → ' + q('cfg.Np') + ' tokens + CLS → ' + q('cfg.Lv') + ' capas pre-LN de ancho ' + q('cfg.Dv') + '. No se redibuja: su estructura está en la página de CLIP (allí con ViT-B/16; aquí cambian el ancho, las capas y el parche). LLaVA no usa la salida final ni la proyección de CLIP: toma la salida de la penúltima capa (la fila de abajo).' },
      { id: 'select-layer', op: 'tensorop', blankDesc: 'Qué capa del encoder se usa y qué token se descarta', shape: 'pill', symbol: 'pick', label: 'Penúltima capa, sin CLS', x: 71, y: 6, w: 23, h: 7,
        tex: 'Z = H^{(L_v-1)}[1{:}] \\in \\mathbb{R}^{N_p\\times D_v}', note: 'Se toma hidden states [−2] (en HF, vision feature layer = ' + q('cfg.featureLayer') + ': la salida de la penúltima capa) y se descarta el token CLS (estrategia "default"): quedan los ' + q('cfg.Np') + ' tokens de parche. Según la hipótesis de LLaVA-1 (§5.2), la penúltima capa conserva más detalle local que la última, más global y abstracta; la ablación da ≈ 1 punto en ScienceQA (90.92 vs 89.96 %). Sin parámetros.' },
      { id: 'projector', op: 'embed', blankDesc: 'El bloque que lleva las features del ancho de CLIP al del LLM', label: 'Proyector MLP', sub: 'D_v → D → D · GELU', x: 106, y: 5, w: 32, h: 9, expand: 'llava-projector',
        tex: 'V = W_2\\,\\mathrm{GELU}(W_1 Z + b_1) + b_2', note: 'Un MLP de 2 capas con sesgo (LLaVA-1.5; el LLaVA original usaba una sola matriz) lleva cada token de parche del ancho de CLIP (' + q('cfg.Dv') + ') al del LLM (' + q('cfg.D') + '). Es lo único que aprende la etapa 1. Ábrelo para ver sus dos capas.' },
      { id: 'text', op: 'io', modality: 'txt', label: 'Texto (ids)', sub: 'prompt con <image>', x: 1, y: 36, w: 17, h: 8,
        note: 'El prompt tokenizado con un marcador &lt;image&gt; donde va la imagen (al principio del primer mensaje del usuario en el formato de conversación de LLaVA-1.5). T = tokens de texto, sin los visuales.' },
      { id: 'embed', op: 'embed', label: 'Embedding de tokens', sub: 'tabla V × D', subNum: 'tabla {{cfg.V}} × {{cfg.D}}', x: 25, y: 36, w: 28, h: 8,
        tex: 'E(t) \\in \\mathbb{R}^{T\\times D}', note: 'La tabla de embedding del LLM (la de cualquier decoder). El marcador &lt;image&gt; no se busca en la tabla: su lugar lo ocupan los tokens visuales.' },
      { id: 'merge', op: 'fuse', blankDesc: 'Dónde entran los tokens visuales al prompt de texto', label: 'Empalmar en <image>', sub: 'los tokens visuales ocupan el lugar del marcador', strip: STRIP, ops: ['splice'], opsExact: true, x: 72, y: 29, w: 66, h: 20,
        tex: 'X = [\\,E(t_{<k})\\;;\\; V \\;;\\; E(t_{>k})\\,] \\in \\mathbb{R}^{(N+T)\\times D}', note: 'Una concatenación sin parámetros: los N tokens visuales se insertan en la posición k del marcador, entre los embeddings del texto de antes y de después. Desde aquí el LLM no distingue la imagen del texto: son filas de D números. La tira es el prompt con ancho proporcional al número de tokens: con una pregunta corta, la imagen es casi todo (' + q('metrics.visualShare') + ').' },
      { id: 'block', op: 'attn', style: 'block', badgeTotal: true, label: 'Bloque decoder (pre-norm)', x: 7, y: 65, w: 54, h: 10, mini: BLOCK_MINI,
        xref: [{ href: '#llm-decoder.diagrama~llm-block.attn', label: 'Ver el bloque por dentro (fase 6, con Llama 2 7B)', cfg: 'llama2-7b', cfgWhy: 'la arquitectura de Vicuna-7B: atención multi-cabeza, sin GQA' }],
        tex: '\\begin{aligned} r &= x + \\mathrm{Attn}(\\mathrm{RMSNorm}(x)) \\\\ y &= r + \\mathrm{FFN}(\\mathrm{RMSNorm}(r)) \\end{aligned}',
        note: 'El bloque de un decoder tipo Llama: Vicuna v1.5 tiene la arquitectura de Llama 2 (7B: la misma config que llama2-7b de la fase 6) (atención multi-cabeza con RoPE y máscara causal, FFN SwiGLU, RMSNorm). Nada cambia por la imagen: los tokens visuales se atienden como cualquier otro, con posiciones 1-D consecutivas. Su interior está en la página del decoder.' },
      { id: 'final-norm', op: 'norm', label: 'RMSNorm final', x: 70, y: 66.5, w: 16, h: 7, note: 'La norma final del LLM, como en cualquier decoder.' },
      { id: 'lm-head', op: 'head', label: 'LM head', sub: 'D → V', x: 93, y: 66, w: 16, h: 8,
        tex: '\\text{logits} = x\\,W_{\\text{head}}', note: 'La capa lineal de cualquier LLM: un logit por token del vocabulario (' + q('cfg.V') + ': los de Vicuna + &lt;image&gt; y relleno). En el entrenamiento solo cuentan las posiciones de la respuesta.' },
      { id: 'answer', op: 'io', modality: 'txt', label: 'Respuesta', sub: 'token a token', x: 120, y: 66, w: 18, h: 8,
        note: 'Se genera de forma autorregresiva, como en cualquier LLM. El KV cache guarda también las K y V de los tokens de la imagen: ' + q('metrics.kvBytesPerImage') + ' por imagen a 16 bits.' },
    ],
    tensors: [
      { id: 'v-x-out', at: { edge: 'vision-encoder>select-layer' }, show: 'label' },
      { id: 'vis-feats', at: { edge: 'select-layer>projector' }, show: 'both', mark: 'dropfirst' },
      { id: 'vis-tokens', at: { edge: 'projector>merge' }, show: 'both' },
    ],
    edges: [
      { from: 'image', to: 'vision-encoder', kind: 'data', tensor: 'pixels', labelSide: 'below', labelT: 0.5 },
      { from: 'vision-encoder', to: 'select-layer', kind: 'data', tensor: 'v-x-out', labelSide: 'below' },
      { from: 'select-layer', to: 'projector', kind: 'data', tensor: 'vis-feats', labelSide: 'below', labelT: 0.6 },
      { from: 'projector', to: 'merge', kind: 'data', tensor: 'vis-tokens', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.7576, labelSide: 'left', labelT: 0.45 },
      { from: 'text', to: 'embed', kind: 'data', tensor: 'text-ids', labelSide: 'below' },
      { from: 'embed', to: 'merge', kind: 'data', tensor: 'text-emb', toAt: 0.55, labelSide: 'below' },
      { from: 'merge', to: 'block', kind: 'data', tensor: 'prompt', fromSide: 'bottom', toSide: 'top', fromAt: 0.09, toAt: 0.5, midY: 56, labelSeg: 1, labelSide: 'above' },
      { from: 'block', to: 'final-norm', kind: 'data', tensor: 'x-out', label: false },   // misma forma que el prompt; la etiqueta cruzaría el marco × L
      { from: 'final-norm', to: 'lm-head', kind: 'data', tensor: 'x-norm', label: false },
      { from: 'lm-head', to: 'answer', kind: 'data', tensor: 'logits', labelSide: 'below' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (LLaVA-1.5 7B, una imagen y una pregunta corta)', steps: [
        { nodes: ['image', 'vision-encoder'], edges: ['image>vision-encoder'], tensors: ['pixels'],
          text: 'La imagen se rellena a cuadrado (con el gris de la media de CLIP) y se redimensiona: <b>' + q('tensor.pixels.shape') + '</b>. El encoder de CLIP la parte en parches de ' + q('cfg.P') + ' → ' + q('cfg.Np') + ' tokens + CLS, y la pasa por sus capas: ' + q('metrics.visionParams') + ' parámetros, congelados.' },
        { nodes: ['vision-encoder', 'select-layer'], edges: ['vision-encoder>select-layer', 'select-layer>projector'], tensors: ['v-x-out', 'vis-feats'],
          text: 'No se usa la salida final: se toma la de la penúltima capa (<b>' + q('tensor.v-x-out.shape') + '</b>, con el CLS) y se tira el CLS: <b>' + q('tensor.vis-feats.shape') + '</b>. La última capa igual se calcula en HF (' + q('metrics.visionMacsDiscarded') + ' descartados).' },
        { expand: 'llava-projector', nodes: ['fc1', 'gelu', 'fc2'], edges: ['in>fc1', 'fc1>gelu', 'gelu>fc2', 'fc2>out'], tensors: ['proj-h', 'vis-tokens'],
          text: 'El proyector: fc1 (' + q('cfg.Dv') + ' → ' + q('cfg.D') + ') → GELU → fc2 (' + q('cfg.D') + ' → ' + q('cfg.D') + '), por token: <b>' + q('tensor.vis-tokens.shape') + '</b>. Son ' + q('metrics.projectorParams') + ' parámetros: lo único que entrena la etapa 1.' },
        { nodes: ['text', 'embed'], edges: ['text>embed', 'embed>merge'], tensors: ['text-ids', 'text-emb'],
          text: 'El texto: T = ' + q('cfg.T') + ' ids → la tabla de embedding del LLM: <b>' + q('tensor.text-emb.shape') + '</b>.' },
        { nodes: ['merge'], edges: ['projector>merge', 'embed>merge', 'merge>block'], tensors: ['vis-tokens', 'text-emb', 'prompt'],
          text: 'Empalme: los ' + q('metrics.visualTokens') + ' tokens visuales ocupan el lugar de &lt;image&gt;. El prompt del LLM es <b>' + q('tensor.prompt.shape') + '</b>: ' + q('metrics.visualShare') + ' son de la imagen. Para el LLM, la imagen son "más tokens".' },
        { nodes: ['block'], edges: ['merge>block', 'block>final-norm'], tensors: ['prompt', 'x-out'],
          text: 'El decoder de siempre, × ' + q('cfg.L') + ' (' + q('metrics.llmParams') + ' parámetros en el LLM). El prefill cuesta ' + q('metrics.prefillMacs') + ' en todo el modelo, y ' + q('metrics.prefillShareFromImage') + ' se debe a la imagen (el encoder más sus tokens dentro del LLM).' },
        { nodes: ['final-norm', 'lm-head', 'answer'], edges: ['final-norm>lm-head', 'lm-head>answer'], tensors: ['logits'],
          text: 'RMSNorm final y LM head: <b>' + q('tensor.logits.shape') + '</b> logits; de la última fila sale el primer token de la respuesta y se sigue token a token. El KV cache ya tiene la imagen: ' + q('metrics.kvBytesPerImage') + ' por imagen.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) el proyector
  ATLAS.registerDiagram(Object.assign({
    id: 'llava-projector', model: 'llava', config: C, kind: 'arch', title: 'Proyector MLP (2 capas)',
    parent: 'llava-overview', parentNode: 'projector',
    caption: 'Por token de parche: fc1 lleva del ancho de CLIP (D_v) al del LLM (D), GELU, y fc2 se queda en D. Dos matrices con sesgo; las mismas para todos los tokens (como la FFN de un transformer, pero sin residual).',
    grid: { w: 116, h: 22 }, direction: 'lr', maxCrossings: 0,
    nodes: [
      { id: 'in', op: 'io', modality: 'img', label: 'Features', sub: 'penúltima capa', x: 1, y: 6.5, w: 14, h: 9, note: 'Las features de la penúltima capa del encoder, sin el CLS.' },
      { id: 'fc1', op: 'embed', blankDesc: 'Primera capa del proyector (del ancho de CLIP al del LLM)', label: 'fc1', sub: 'Linear D_v → D', ops: ['proj-fc1'], opsExact: true, x: 25, y: 7, w: 18, h: 8,
        tex: 'h = Z W_1 + b_1,\\; W_1 \\in \\mathbb{R}^{D_v\\times D}', note: 'Del ancho del encoder (' + q('cfg.Dv') + ') al del LLM (' + q('cfg.D') + '), con sesgo.' },
      { id: 'gelu', op: 'mlp', shape: 'pill', label: 'GELU', ops: ['proj-gelu'], opsExact: true, x: 52, y: 8.5, w: 14, h: 5,
        tex: '\\mathrm{GELU}(h)', note: 'La no linealidad: con una sola matriz (el LLaVA original) el puente es lineal; con el MLP de 2 capas (LLaVA-1.5) mejora en los benchmarks del paper.' },
      { id: 'fc2', op: 'embed', blankDesc: 'Segunda capa del proyector (se queda en el ancho del LLM)', label: 'fc2', sub: 'Linear D → D', ops: ['proj-fc2'], opsExact: true, x: 75, y: 7, w: 18, h: 8,
        tex: 'V = \\mathrm{GELU}(h) W_2 + b_2', note: 'Se queda en el ancho del LLM: la salida son los tokens visuales.' },
      { id: 'out', op: 'io', modality: 'img', label: 'Tokens visuales', sub: '→ empalme', x: 102, y: 6.5, w: 14, h: 9, note: 'Van al empalme, en el lugar de &lt;image&gt;.' },
    ],
    tensors: [
      { id: 'proj-h', at: { edge: 'fc1>gelu' }, show: 'label' },
    ],
    edges: [
      { from: 'in', to: 'fc1', kind: 'data', tensor: 'vis-feats', labelSide: 'above' },
      { from: 'fc1', to: 'gelu', kind: 'data', tensor: 'proj-h', labelSide: 'above' },
      { from: 'gelu', to: 'fc2', kind: 'data', tensor: 'proj-act', labelSide: 'above' },
      { from: 'fc2', to: 'out', kind: 'data', tensor: 'vis-tokens', labelSide: 'above' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ entrenamiento: qué se congela en cada etapa
  const lane = (k, y, trainLLM) => ({
    nodes: [
      { id: 'image-' + k, op: 'io', image: true, imageGrid: 0, label: 'Imagen', x: 2, y: y + 4, w: 11, h: 11, note: 'La imagen de cada ejemplo.' },
      { id: 'vision-' + k, op: 'attn', style: 'block', modality: 'img', train: 'frozen', costOf: 'vision-encoder', label: 'Encoder CLIP', sub: 'ViT-L/14', x: 22, y: y + 5, w: 26, h: 9,
        note: 'Congelado en las dos etapas: LLaVA-1.5 nunca toca el encoder de CLIP (sus features ya son buenas y así se ahorra memoria y cómputo de gradientes).' },
      { id: 'projector-' + k, op: 'embed', train: 'trained', costOf: 'projector', label: 'Proyector', sub: 'MLP 2 capas', x: 57, y: y + 5, w: 20, h: 9,
        note: k === 1 ? 'En la etapa 1 es lo ÚNICO que entrena: aprende a llevar las features de CLIP al espacio de embeddings del LLM (alinear las dos "lenguas") sin romper al LLM.' : 'Sigue entrenando en la etapa 2, junto con el LLM.' },
      { id: 'llm-' + k, op: 'attn', style: 'block', modality: 'txt', train: trainLLM ? 'trained' : 'frozen', costOf: 'llm', ops: ['embed', 'lm-head'], label: 'LLM (Vicuna)', sub: 'L capas\n+ embedding y LM head', subNum: '{{cfg.L}} capas\n+ embedding y LM head', x: 86, y: y + 5, w: 26, h: 9,
        note: trainLLM ? 'En la etapa 2 el LLM entero entrena (fine-tuning completo) con instrucciones visuales: aprende a seguir conversaciones sobre la imagen.' : 'Congelado en la etapa 1: solo recibe los tokens visuales y predice la leyenda; el gradiente lo atraviesa hasta el proyector, pero sus pesos no cambian.' },
      { id: 'text-' + k, op: 'io', modality: 'txt', label: 'Texto', sub: k === 1 ? '<image> + leyenda' : 'conversación', x: 55, y: y + 16.5, w: 24, h: 6,
        note: k === 1 ? 'Plantilla "plain" de LLaVA-1.5: solo &lt;image&gt; y la leyenda como respuesta, sin instrucción (LLaVA-1 anteponía una instrucción corta al azar).' : 'Conversaciones, VQA, OCR y regiones (con instrucciones de formato de respuesta); la pérdida solo cuenta los turnos del asistente.' },
      { id: 'loss-' + k, op: 'head', label: 'Pérdida', sub: 'NLL de la respuesta', x: 121, y: y + 5, w: 19, h: 9,
        tex: '\\mathcal{L} = -\\tfrac{1}{|\\mathcal{A}|}\\sum_{i\\in\\mathcal{A}} \\log p(x_i \\mid V, x_{<i})', note: 'Next-token solo sobre las posiciones de la respuesta (𝒜): la leyenda en la etapa 1, los turnos del asistente en la etapa 2. La imagen y la pregunta no se predicen.' },
    ],
    edges: [
      { from: 'image-' + k, to: 'vision-' + k, kind: 'data', tensor: 'pixels', label: false },
      { from: 'vision-' + k, to: 'projector-' + k, kind: 'data', tensor: 'vis-feats', labelSide: 'above' },
      { from: 'projector-' + k, to: 'llm-' + k, kind: 'data', tensor: 'vis-tokens', labelSide: 'above' },
      { from: 'text-' + k, to: 'llm-' + k, kind: 'data', tensor: 'text-ids', fromSide: 'right', toSide: 'bottom', toAt: 0.25, labelSide: 'right', labelSeg: 0, labelT: 0.35 },
      { from: 'llm-' + k, to: 'loss-' + k, kind: 'data', tensor: 'logits', labelSide: 'above' },
    ],
  });
  const L1 = lane(1, 1, false), L2 = lane(2, 31, true);
  ATLAS.registerDiagram({
    id: 'llava-training', model: 'llava', config: C, kind: 'arch', title: 'LLaVA-1.5 — qué entrena en cada etapa',
    page: 'llava', section: 'entrenamiento', configs: CONFIGS,
    caption: 'Las dos etapas usan la misma red y la misma pérdida (next-token sobre la respuesta); cambia qué recibe gradiente. Etapa 1 (alineación de features): solo el proyector, con el encoder y el LLM congelados (rayados), sobre pares imagen–leyenda (solo &lt;image&gt; + la leyenda, sin instrucción). Etapa 2 (instrucciones visuales): proyector + LLM entero; el encoder sigue congelado.',
    grid: { w: 142, h: 60 }, direction: 'lr', maxCrossings: 0,
    // teléfono: encoder → LLM de las dos etapas (lo que se congela y lo que entrena), con los títulos de los carriles
    // (labelDx los pone encima del encoder)
    mobileFocus: ['vision-1', 'llm-1', 'vision-2', 'llm-2'], mobileFocusPad: 4.5,
    groups: [
      { id: 'stage-1', style: 'lane', tone: 'accent', label: 'Etapa 1 · alineación de features', legend: 'Marco azul: etapa 1 (pre-entrenamiento del proyector)', labelPos: 'top-left', labelDx: 20.5, label2Pos: 'bottom-left',
        label2: '≈558K pares imagen–leyenda (LCS-558K) · entrena solo el proyector: {{metrics.projectorParams}} parámetros', x: 1, y: 1, w: 140, h: 28 },
      { id: 'stage-2', style: 'lane', tone: 'head', label: 'Etapa 2 · instrucciones visuales', legend: 'Marco verde azulado: etapa 2 (fine-tuning con instrucciones)', labelPos: 'top-left', labelDx: 20.5, label2Pos: 'bottom-left',
        label2: '≈665K ejemplos (mezcla de instrucciones) · entrenan proyector + LLM: {{metrics.projectorParams}} + {{metrics.llmParams}}', x: 1, y: 31, w: 140, h: 28 },
    ],
    nodes: L1.nodes.concat(L2.nodes),
    edges: L1.edges.concat(L2.edges),
    legend: 'auto',
  });
})(typeof window !== 'undefined' ? window : globalThis);
