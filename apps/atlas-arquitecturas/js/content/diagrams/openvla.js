/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/openvla.js
   Diagramas de OpenVLA (SPEC §7.2, ids de §21.2), config canónica openvla-7b (modelo `openvla`, js/arch/vla.js):
     openvla-overview   cuatro bandas:
                        1) la imagen (224) → DINOv2 y SigLIP EN PARALELO (fila de capas: se toma la penúltima) → concatenar
                           por canales (N_p × D_v) → proyector MLP
                        2) la instrucción → embedding → empalme (tira del prompt: <BOS> | parches | texto)
                        3) Llama 2 7B (× L; el bloque de la fase 6, con enlace a llm-block con la config llama2-7b) → RMSNorm final
                           → LM head → los 7 tokens de acción (tira), generados token a token (bucle × 6 pasos de decode)
                        4) detokenizar → acción; y dos barras del costo POR ACCIÓN (del calculador): MACs (casi todo es el
                           prefill) y tiempo ≈ en una RTX 4090 (los 6 decodes, limitados por memoria, pesan tanto como el prefill)
       openvla-projector  fc1 → GELU → fc2 → GELU → fc3 (el checkpoint tiene TRES lineales; el paper dice "MLP de 2 capas")
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'openvla-7b';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const PAGE = { page: 'openvla', section: 'diagrama', configs: [C] };
  const BLOCK_MINI = { items: [{ label: 'RMSNorm', op: 'norm' }, { label: 'Atención', op: 'attn' }, { sym: 'add' }, { label: 'RMSNorm', op: 'norm' }, { label: 'SwiGLU', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] };
  // el prompt de OpenVLA: <BOS>, los parches de la imagen y el resto del texto (T incluye el <BOS>: la cuenta exacta, en el caption)
  const STRIP = {
    segs: [{ mod: 'txt', n: 1, count: false, label: 'BOS' }, { mod: 'img', n: 'metrics.visualTokens', label: 'parches' }, { mod: 'txt', n: 'cfg.T', count: false, label: 'instrucción' }],
    caption: 'imagen {{metrics.visualTokens}} + texto {{cfg.T}} = {{metrics.promptTokens}} tokens (los parches van tras el BOS)',
  };
  const ACT_LABELS = ['Δx', 'Δy', 'Δz', 'roll', 'pitch', 'yaw', 'pinza'];
  const ACT_STRIP = { segs: ACT_LABELS.map((l) => ({ mod: 'act', n: 1, count: false, label: l })), caption: 'ids {{metrics.actionTokenFirst}}…{{metrics.actionTokenLast}}: los 256 últimos de Llama' };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'openvla-overview', model: 'openvla', config: C, kind: 'arch', title: 'OpenVLA 7B — vista general',
    caption: 'La receta de LLaVA con salida de acciones. Arriba, la imagen pasa por DOS encoders en paralelo (DINOv2: forma y geometría; SigLIP: semántica alineada con texto); sus features de la penúltima capa se concatenan por canales y un MLP las lleva al ancho de Llama 2. En el medio, esos 256 tokens visuales se empalman con la instrucción. Abajo, Llama 2 7B genera la acción como 7 tokens, uno por paso (bucle punteado): cada token es un bin de 256 de una dimensión. Las barras: casi todo el CÓMPUTO es el prefill, pero los 6 pasos de decode, limitados por memoria, se llevan una buena parte del TIEMPO.',
    grid: { w: 160, h: 112 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['action-tokens', 'detokenize'], mobileFocusPad: 2,
    edgeLegend: { control: 'Bucle: cada token de acción vuelve a entrar al LLM' },
    legendText: { runs: 'Veces que corre el LLM por acción (1 prefill + 6 decodes)', loop: 'Bucle: se repite por cada token de acción', costSplit: 'Costo por acción: ancho proporcional (del calculador)' },
    groups: [
      { id: 'llm', label: 'LLM decoder ({{cfg.llmLabel}})', labelPos: 'bottom', x: 3, y: 58, w: 62, h: 26, repeat: { sym: 'L', from: 'L', totalOf: 'block', totalLabel: '= {t} en los bloques' }, modality: 'txt' },
    ],
    nodes: [
      { id: 'image', op: 'io', image: true, imageGrid: 0, label: 'Imagen', x: 1, y: 7, w: 15, h: 17,
        note: 'Una imagen RGB de la cámara del robot (una sola vista, la de tercera persona), redimensionada a ' + q('cfg.H') + '×' + q('cfg.W') + ' (alto × ancho). Cada encoder la normaliza a su manera (medias de ImageNet para DINOv2, 0.5 para SigLIP).' },
      { id: 'dinov2', op: 'attn', style: 'block', modality: 'img', label: 'DINOv2 ViT-L/14', sub: 'L_d capas, D_d', subNum: '{{cfg.Ld}} capas · D_d = {{cfg.Dd}}',
        layers: { L: 'cfg.Ld', tap: -2, tapLabel: '↑ se toma' }, x: 26, y: 1, w: 36, h: 13,
        xref: [{ href: '#clip.diagrama~clip-image-encoder.enc-layer', label: 'Ver una capa de ViT por dentro (CLIP)' }],
        costNote: 'Incluye la última capa: timm la corre y su salida se descarta (como en LLaVA).',
        tex: 'Z_d = \\mathrm{DINOv2}(x)^{(L_d-1)}[5{:}] \\in \\mathbb{R}^{N_p\\times D_d}',
        note: 'Un ViT-L/14 autosupervisado (DINOv2, con 4 registros y LayerScale): sus features capturan forma, profundidad y partes, lo espacial que a CLIP le falta. ' + q('cfg.Ld') + ' capas de ancho ' + q('cfg.Dd') + '; se toma la salida de la penúltima y se descartan los 5 tokens prefijo (CLS + 4 registros): ' + q('tensor.d-feats.shape') + '.' },
      { id: 'siglip', op: 'attn', style: 'block', modality: 'img', label: 'SigLIP So400m/14', sub: 'L_s capas, D_s', subNum: '{{cfg.Ls}} capas · D_s = {{cfg.Ds}}',
        layers: { L: 'cfg.Ls', tap: -2, tapLabel: '↑ se toma' }, x: 26, y: 17, w: 36, h: 13,
        xref: [{ href: '#clip.diagrama~clip-image-encoder.enc-layer', label: 'Ver una capa de ViT por dentro (CLIP)' }],
        costNote: 'Incluye la última capa (calculada y descartada); la norma final y el pooling MAP existen en el checkpoint pero no corren.',
        tex: 'Z_s = \\mathrm{SigLIP}(x)^{(L_s-1)} \\in \\mathbb{R}^{N_p\\times D_s}',
        note: 'El encoder de imagen de SigLIP (So400m: ancho ' + q('cfg.Ds') + ', MLP ' + q('cfg.Ms') + ', sin CLS), entrenado contra texto con pérdida sigmoide: features semánticas, alineadas con el lenguaje. Corre EN PARALELO con DINOv2 sobre la misma imagen; también se toma la penúltima capa: ' + q('tensor.s-feats.shape') + '.' },
      { id: 'concat', op: 'tensorop', shape: 'concat', label: 'Concatenar canales', labelPos: 'left', ops: ['concat'], opsExact: true, x: 68, y: 13, w: 5, h: 5,
        tex: 'Z = [\\,Z_d \\;\\Vert\\; Z_s\\,] \\in \\mathbb{R}^{N_p\\times (D_d + D_s)}',
        note: 'Las dos torres dan el mismo número de parches (' + q('cfg.Np') + ', ambas con parche de ' + q('cfg.P') + ' a ' + q('cfg.H') + ' px), así que se pegan por CANALES, parche a parche: ' + q('cfg.Dd') + ' + ' + q('cfg.Ds') + ' = ' + q('cfg.Dv') + '. No suma tokens: el LLM sigue viendo ' + q('cfg.Np') + '. Sin parámetros.' },
      { id: 'projector', op: 'embed', label: 'Proyector MLP', sub: 'D_v → 4D_v → D → D · GELU', expand: 'openvla-projector', x: 90, y: 11, w: 32, h: 9,
        tex: 'V = W_3\\,\\mathrm{GELU}(W_2\\,\\mathrm{GELU}(W_1 Z))', note: 'Lleva cada parche fusionado (' + q('cfg.Dv') + ') al ancho de Llama 2 (' + q('cfg.D') + '). El paper lo llama "MLP de 2 capas", pero el checkpoint tiene TRES lineales con GELU entre medio (' + q('cfg.Dv') + ' → ' + q('cfg.Dproj') + ' → ' + q('cfg.D') + ' → ' + q('cfg.D') + '): ' + q('metrics.projectorParams') + ' parámetros. Ábrelo.' },
      { id: 'instruction', op: 'io', modality: 'txt', label: 'Instrucción', sub: 'T tokens', subNum: 'T = {{cfg.T}} tokens', x: 1, y: 37, w: 17, h: 8,
        note: 'El prompt fijo de OpenVLA: "In: What action should the robot take to &lt;instrucción&gt;?\\nOut:", tokenizado por Llama (' + q('cfg.T') + ' tokens con el &lt;BOS&gt; para "' + q('cfg.instruction') + '").' },
      { id: 'embed', op: 'embed', label: 'Embedding de tokens', sub: 'tabla V × D', subNum: 'tabla {{cfg.V}} × {{cfg.D}}', x: 26, y: 37, w: 28, h: 8,
        tex: 'E(t) \\in \\mathbb{R}^{T\\times D}', note: 'La tabla de embedding de Llama 2 (con el relleno a ' + q('cfg.V') + ' filas del checkpoint).' },
      { id: 'merge', op: 'fuse', label: 'Empalmar tras el BOS', sub: 'los parches van después del primer token', strip: STRIP, ops: ['splice'], opsExact: true, x: 64, y: 32, w: 70, h: 20,
        tex: 'X = [\\,E(t_0)\\;;\\; V \\;;\\; E(t_{1:})\\,] \\in \\mathbb{R}^{(N+T)\\times D}', note: 'Como en LLaVA, una concatenación sin parámetros: los ' + q('metrics.visualTokens') + ' tokens visuales entran después del &lt;BOS&gt; y antes de la instrucción. Para Llama, son más tokens: ' + q('tensor.prompt.shape') + '.' },
      { id: 'block', op: 'attn', style: 'block', badgeTotal: true, label: 'Bloque decoder (pre-norm)', runs: '× {{metrics.actionTokensPerStep}} por acción', x: 7, y: 68, w: 54, h: 10, mini: BLOCK_MINI,
        xref: [{ href: '#llm-decoder.diagrama~llm-block.attn', label: 'Ver el bloque por dentro (fase 6, con Llama 2 7B)', cfg: 'llama2-7b', cfgWhy: 'la misma arquitectura que el LLM de OpenVLA' }],
        tex: '\\begin{aligned} r &= x + \\mathrm{Attn}(\\mathrm{RMSNorm}(x)) \\\\ y &= r + \\mathrm{FFN}(\\mathrm{RMSNorm}(r)) \\end{aligned}',
        costNote: 'Por pasada del prefill (las N + T filas). Por acción corre {{' + C + '.metrics.actionTokensPerStep}} veces: el prefill y {{' + C + '.metrics.decodeSteps}} decodes de 1 token con la KV cache.',
        note: 'Llama 2 7B tal cual (atención multi-cabeza con RoPE y máscara causal, SwiGLU, RMSNorm): el bloque de la fase 6. Todo el VLM (visión, proyector y LLM) se ajusta con las trayectorias del robot. Por acción el LLM corre ' + q('metrics.actionTokensPerStep') + ' veces: el prefill de ' + q('metrics.promptTokens') + ' tokens da el primer token y ' + q('metrics.decodeSteps') + ' pasos de decode, de 1 token cada uno, dan los demás.' },
      { id: 'final-norm', op: 'norm', label: 'RMSNorm final', x: 70, y: 69.5, w: 15, h: 7, note: 'La norma final del LLM.' },
      { id: 'lm-head', op: 'head', label: 'LM head', sub: 'D → V', x: 89, y: 69, w: 14, h: 8,
        tex: '\\text{logits} = x\\,W_{\\text{head}}', note: 'La capa lineal de Llama: un logit por token del vocabulario. De la última fila sale el token siguiente (greedy: el de mayor logit), que en OpenVLA es uno de los 256 ids de acción.' },
      { id: 'action-tokens', op: 'io', modality: 'act', label: 'Tokens de acción', strip: ACT_STRIP, x: 113, y: 63, w: 42, h: 16,
        note: 'La acción como ' + q('metrics.actionTokensPerStep') + ' tokens: Δx, Δy, Δz, Δroll, Δpitch, Δyaw y la pinza. Cada dimensión (normalizada con sus cuantiles 1 % y 99 %) se discretizó en ' + q('metrics.actionBins') + ' bins, y cada bin pisa uno de los 256 ÚLTIMOS ids del tokenizer de Llama (' + q('metrics.actionTokenFirst') + '…' + q('metrics.actionTokenLast') + ', los menos usados). Salen uno por paso: el primero del prefill, los otros ' + q('metrics.decodeSteps') + ' de decodes de 1 token.' },
      { id: 'detokenize', op: 'tensorop', shape: 'rect', label: 'Detokenizar', sub: 'id → bin → valor', x: 126, y: 85, w: 20, h: 8,
        note: 'id → bin → centro del bin → se des-normaliza con los cuantiles 1 % y 99 % de esa dimensión en el dataset. Sin parámetros. El error de discretizar es a lo sumo medio bin.' },
      { id: 'action', op: 'io', modality: 'act', label: 'Acción', sub: '→ robot', x: 149, y: 84, w: 10, h: 10,
        note: 'Siete números continuos para el controlador del robot: una acción por inferencia (sin chunks; OpenVLA-OFT los agregó después). El paper reporta ≈ ' + q('metrics.paperHz') + ' Hz en una RTX 4090 en bf16.' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Cómputo por acción (MACs)', x: 1, y: 97, w: 78, h: 14,
        costSplit: {
          segs: [
            { op: 'attn', n: 'metrics.visionMacs', label: 'DINOv2 + SigLIP' },
            { op: 'embed', n: 'metrics.projectorMacs', label: 'Proyector' },
            { tone: 'once', n: 'metrics.llmPrefillMacs', label: 'LLM: prefill ({{metrics.promptTokens}} tokens)' },
            { tone: 'loop', n: 'metrics.decodeMacsTotal', label: 'LLM: {{metrics.decodeSteps}} decodes de 1 token' },
          ],
          caption: 'total {{metrics.macsPerAction}} por acción',
        },
        note: 'MACs de una acción, del calculador: casi todo es el prefill (' + q('metrics.prefillShare') + '), porque procesa ' + q('metrics.promptTokens') + ' tokens a la vez; cada decode procesa uno.' },
      { id: 'cost-ms', op: 'io', hideInBlank: true, label: 'Tiempo por acción (≈ 4090)', x: 81, y: 97, w: 78, h: 14,
        costSplit: {
          unit: 'ms',
          segs: [
            { op: 'attn', n: 'metrics.visionMsRtx4090', label: 'Visión' },
            { tone: 'once', n: 'metrics.prefillMsRtx4090', label: 'Prefill del LLM' },
            { tone: 'loop', n: 'metrics.decodeMsRtx4090', times: 'metrics.decodeSteps', label: '{{metrics.decodeSteps}} decodes (limitados por memoria)' },
          ],
          caption: '≈ {{metrics.actionMsRtx4090}} ms por acción = {{metrics.hzRtx4090}} Hz (cota de roofline; el paper mide ≈ {{metrics.paperHz}} Hz)',
        },
        note: 'Tiempo estimado con el roofline del calculador en una RTX 4090 (165.2 TFLOPS BF16, 1,008 GB/s): cada segmento tarda lo que más tarde entre calcular sus FLOPs y leer sus bytes. Cada decode relee los pesos (' + q('metrics.weightBytes') + ' en bf16) para UN token: limitado por memoria. Es una cota optimista (sin overheads de kernels ni del Python de generate).' },
    ],
    tensors: [
      { id: 'vis-feats', at: { edge: 'concat>projector' }, show: 'both' },
      { id: 'vis-tokens', at: { edge: 'projector>merge' }, show: 'both' },
    ],
    edges: [
      { from: 'image', to: 'dinov2', kind: 'data', tensor: 'pixels', fromAt: 0.25, toAt: 0.7885, labelSide: 'above' },
      { from: 'image', to: 'siglip', kind: 'data', tensor: 'pixels', fromAt: 0.75, toAt: 0.2115, label: false },
      { from: 'dinov2', to: 'concat', kind: 'data', tensor: 'd-feats', toSide: 'top', fromAt: 0.4, labelSide: 'above', labelSeg: 0, labelT: 0.5 },
      { from: 'siglip', to: 'concat', kind: 'data', tensor: 's-feats', toSide: 'bottom', fromAt: 0.4, labelSide: 'below', labelSeg: 0, labelT: 0.5 },
      { from: 'concat', to: 'projector', kind: 'data', tensor: 'vis-feats', toAt: 0.5, labelSide: 'above', labelT: 0.65 },
      { from: 'projector', to: 'merge', kind: 'data', tensor: 'vis-tokens', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.6, labelSide: 'right', labelT: 0.45 },
      { from: 'instruction', to: 'embed', kind: 'data', tensor: 'text-ids', labelSide: 'below' },
      { from: 'embed', to: 'merge', kind: 'data', tensor: 'text-emb', toAt: 0.45, labelSide: 'below', blankHide: ['vis-tokens'] },
      { from: 'merge', to: 'block', kind: 'data', tensor: 'prompt', fromSide: 'bottom', toSide: 'top', fromAt: 0.08, toAt: 0.5, midY: 56, labelSeg: 1, labelSide: 'above', blankHide: ['vis-tokens'] },
      { from: 'block', to: 'final-norm', kind: 'data', tensor: 'x-out', label: false },
      { from: 'final-norm', to: 'lm-head', kind: 'data', tensor: 'x-norm', label: false },
      { from: 'lm-head', to: 'action-tokens', kind: 'data', tensor: 'next-token', toAt: 0.625, labelSide: 'above' },
      { from: 'action-tokens', to: 'block', kind: 'control', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.1, toAt: 0.85, via: [[117.2, 89], [53, 89]], tag: 'vuelve a entrar · × {{metrics.decodeSteps}} decodes', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5, loop: true },
      { from: 'action-tokens', to: 'detokenize', kind: 'data', tensor: 'action-tokens', fromSide: 'bottom', toSide: 'top', fromAt: 0.5476, toAt: 0.5, labelSide: 'left', labelT: 0.5 },
      { from: 'detokenize', to: 'action', kind: 'data', tensor: 'action', label: false },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (OpenVLA 7B, una acción)', steps: [
        { nodes: ['image', 'dinov2', 'siglip'], edges: ['image>dinov2', 'image>siglip'], tensors: ['pixels'],
          text: 'La imagen de <b>' + q('tensor.pixels.shape') + '</b> entra a DOS encoders a la vez: DINOv2 (' + q('metrics.dinoParams') + ' parámetros) y SigLIP (' + q('metrics.siglipParams') + '). Juntos cuestan ' + q('metrics.visionMacs') + '.' },
        { nodes: ['dinov2', 'siglip', 'concat'], edges: ['dinov2>concat', 'siglip>concat', 'concat>projector'], tensors: ['d-feats', 's-feats', 'vis-feats'],
          text: 'De cada uno se toma la penúltima capa: <b>' + q('tensor.d-feats.shape') + '</b> y <b>' + q('tensor.s-feats.shape') + '</b>. Mismo número de parches, así que se concatenan por canales: <b>' + q('tensor.vis-feats.shape') + '</b>.' },
        { expand: 'openvla-projector', nodes: ['fc1', 'gelu1', 'fc2', 'gelu2', 'fc3'], edges: ['in>fc1', 'fc1>gelu1', 'gelu1>fc2', 'fc2>gelu2', 'gelu2>fc3', 'fc3>out'], tensors: ['proj-h1', 'vis-tokens'],
          text: 'El proyector: tres lineales con GELU (' + q('cfg.Dv') + ' → ' + q('cfg.Dproj') + ' → ' + q('cfg.D') + ' → ' + q('cfg.D') + '), por parche: <b>' + q('tensor.vis-tokens.shape') + '</b>, ' + q('metrics.projectorParams') + ' parámetros.' },
        { nodes: ['instruction', 'embed', 'merge'], edges: ['instruction>embed', 'embed>merge', 'projector>merge', 'merge>block'], tensors: ['text-ids', 'text-emb', 'prompt'],
          text: 'La instrucción (T = ' + q('cfg.T') + ' tokens) se embebe y los parches entran tras el &lt;BOS&gt;: el prompt de Llama es <b>' + q('tensor.prompt.shape') + '</b>.' },
        { nodes: ['block', 'final-norm', 'lm-head', 'action-tokens'], edges: ['merge>block', 'block>final-norm', 'final-norm>lm-head', 'lm-head>action-tokens'], tensors: ['prompt', 'next-token'],
          text: 'Prefill: Llama 2 7B procesa los ' + q('metrics.promptTokens') + ' tokens (' + q('metrics.prefillMacs') + ' en todo el modelo) y de la última fila de logits sale el primer token de acción (un id entre ' + q('metrics.actionTokenFirst') + ' y ' + q('metrics.actionTokenLast') + ').' },
        { nodes: ['action-tokens', 'block'], edges: ['action-tokens>block'], tensors: [],
          text: 'Faltan ' + q('metrics.decodeSteps') + ' tokens: ' + q('metrics.decodeSteps') + ' pasos de decode, de 1 token cada uno, con la KV cache (' + q('metrics.decodeMacsPerToken') + ' por paso). Poco cómputo, pero cada paso relee los pesos: en una RTX 4090 ≈ ' + q('metrics.decodeMsRtx4090') + ' ms por paso contra ≈ ' + q('metrics.prefillMsRtx4090') + ' ms del prefill entero.' },
        { nodes: ['detokenize', 'action', 'cost', 'cost-ms'], edges: ['action-tokens>detokenize', 'detokenize>action'], tensors: ['action-tokens', 'action'],
          text: 'Los ' + q('metrics.actionTokensPerStep') + ' ids → bins → valores continuos: <b>' + q('tensor.action.shape') + '</b> números para el robot. Una acción cuesta ' + q('metrics.macsPerAction') + ' y ≈ ' + q('metrics.actionMsRtx4090') + ' ms en una RTX 4090 (≈ ' + q('metrics.hzRtx4090') + ' Hz como cota; el paper mide ≈ ' + q('metrics.paperHz') + ' Hz).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) el proyector (3 lineales)
  ATLAS.registerDiagram(Object.assign({
    id: 'openvla-projector', model: 'openvla', config: C, kind: 'arch', title: 'Proyector de OpenVLA (fused-gelu-mlp)',
    parent: 'openvla-overview', parentNode: 'projector',
    caption: 'Por parche: tres lineales con GELU entre medio, del ancho fusionado de los dos encoders (D_v) al de Llama 2 (D). Es lo que tiene el checkpoint (Prismatic "fused-gelu-mlp"); el paper lo describe como "MLP de 2 capas".',
    grid: { w: 162, h: 22 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['fc1', 'gelu1', 'fc2'],
    nodes: [
      { id: 'in', op: 'io', modality: 'img', label: 'Features', sub: 'DINOv2 ‖ SigLIP', x: 1, y: 6.5, w: 16, h: 9, note: 'Los parches con las features de las dos torres concatenadas.' },
      { id: 'fc1', op: 'embed', label: 'fc1', sub: 'D_v → 4D_v', ops: ['proj-fc1'], opsExact: true, x: 25, y: 7, w: 16, h: 8,
        tex: 'h_1 = Z W_1 + b_1', note: 'Del ancho fusionado (' + q('cfg.Dv') + ') a 4 veces ese ancho (' + q('cfg.Dproj') + ').' },
      { id: 'gelu1', op: 'mlp', shape: 'pill', label: 'GELU', ops: ['proj-gelu1'], opsExact: true, x: 51, y: 8.5, w: 12, h: 5, note: 'No linealidad.' },
      { id: 'fc2', op: 'embed', label: 'fc2', sub: '4D_v → D', ops: ['proj-fc2'], opsExact: true, x: 71, y: 7, w: 16, h: 8,
        tex: 'h_2 = \\mathrm{GELU}(h_1) W_2 + b_2', note: 'Al ancho de Llama 2 (' + q('cfg.D') + ').' },
      { id: 'gelu2', op: 'mlp', shape: 'pill', label: 'GELU', ops: ['proj-gelu2'], opsExact: true, x: 97, y: 8.5, w: 12, h: 5, note: 'No linealidad.' },
      { id: 'fc3', op: 'embed', label: 'fc3', sub: 'D → D', ops: ['proj-fc3'], opsExact: true, x: 117, y: 7, w: 16, h: 8,
        tex: 'V = \\mathrm{GELU}(h_2) W_3 + b_3', note: 'Se queda en ' + q('cfg.D') + ': la salida son los tokens visuales.' },
      { id: 'out', op: 'io', modality: 'img', label: 'Tokens visuales', sub: '→ empalme', x: 144, y: 6.5, w: 17, h: 9, note: 'Van al empalme, tras el &lt;BOS&gt;.' },
    ],
    tensors: [{ id: 'proj-h1', at: { edge: 'fc1>gelu1' }, show: 'label' }],
    edges: [
      { from: 'in', to: 'fc1', kind: 'data', tensor: 'vis-feats', labelSide: 'above' },
      { from: 'fc1', to: 'gelu1', kind: 'data', tensor: 'proj-h1', labelSide: 'above' },
      { from: 'gelu1', to: 'fc2', kind: 'data', tensor: 'proj-a1', label: false },
      { from: 'fc2', to: 'gelu2', kind: 'data', tensor: 'proj-h2', labelSide: 'above' },
      { from: 'gelu2', to: 'fc3', kind: 'data', tensor: 'proj-a2', label: false },
      { from: 'fc3', to: 'out', kind: 'data', tensor: 'vis-tokens', labelSide: 'above' },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
