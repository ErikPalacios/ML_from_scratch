/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/pi0.js
   Diagramas de π0 (SPEC §7.2, ids de §21.3), config canónica pi0 (3 cámaras; también pi0-1cam), modelo `pi0` (js/arch/vla.js):
     pi0-overview        dos bandas:
                         1) UNA vez por chunk: hasta 3 imágenes → SigLIP (por cámara) + la instrucción → embedding → prefijo
                            → Gemma 2B (× L) → la KV del prefijo, guardada (cilindro)
                         2) el BUCLE de flujo (× pasos, solo el sufijo): estado + acciones ruidosas + τ → proyecciones → sufijo
                            → experto de acciones (× L, pesos propios) que LEE la KV del prefijo (atención conjunta) → velocidad →
                            paso de Euler → vuelve (↻); al final, el chunk H_a × d_a. Abajo, el costo por chunk: MACs y tiempo ≈
       pi0-layer         una capa durante un paso de flujo: las K, V del prefijo salen de los pesos de GEMMA (calculadas en el
                         prefill, del caché); Q, K, V del sufijo, de los pesos del EXPERTO; una sola atención sobre las dos
                         (separate weights, shared attention) con máscara por bloques; W_O y la FFN, del experto
         pi0-attention-mask   la máscara por bloques (prefijo / estado / acciones) como una grilla chica
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'pi0';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const CONFIGS = ['pi0', 'pi0-1cam'];
  const PAGE = { page: 'pi0', section: 'diagrama', configs: CONFIGS };
  const GEMMA_MINI = { items: [{ label: 'RMSNorm', op: 'norm' }, { label: 'Atención', op: 'attn' }, { sym: 'add' }, { label: 'RMSNorm', op: 'norm' }, { label: 'GeGLU', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] };
  const EXPERT_MINI = { items: [{ label: 'RMSNorm', op: 'norm' }, { label: 'Atención conjunta', op: 'attn' }, { sym: 'add' }, { label: 'RMSNorm', op: 'norm' }, { label: 'GeGLU', op: 'mlp' }, { sym: 'add' }], res: [[0, 2], [3, 5]] };
  const LEGEND = { runs: 'Veces que corre por chunk (en el bucle de flujo)', runsOnce: 'Veces que corre por chunk (fuera del bucle)', loop: 'Bucle: se repite en cada paso de flujo', costSplit: 'Costo por chunk: ancho proporcional (del calculador)' };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'pi0-overview', model: 'pi0', config: C, kind: 'arch', title: 'π0 — vista general',
    caption: 'Un VLM (PaliGemma: SigLIP + Gemma 2B) más un "experto de acciones" chico con pesos propios. Arriba, UNA vez por chunk: las imágenes de las cámaras y la instrucción forman el prefijo, Gemma lo procesa y guarda sus K y V (el cilindro). Abajo, el bucle de flow matching: el estado del robot y un chunk de acciones ruidosas (más el tiempo τ) pasan por el experto, que en cada capa atiende a sus propios tokens y a la K, V del prefijo (atención conjunta, doble línea); sale una velocidad y un paso de Euler acerca las acciones a las limpias. Tras los pasos, el chunk entero va al robot. Gemma no corre en el bucle: por eso el flujo es barato.',
    grid: { w: 176, h: 117 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['action-expert', 'euler'], mobileFocusPad: 2,
    edgeLegend: { cross: 'Atención conjunta: el experto lee la K, V del prefijo', control: 'Bucle: el chunk vuelve a entrar (control)' },
    legendText: LEGEND,
    groups: [
      { id: 'gemma-layers', label: 'Gemma 2B: el prefijo, 1 vez por chunk', x: 74, y: 1, w: 56, h: 31, repeat: { sym: 'L', from: 'L', totalOf: 'gemma', totalLabel: '= {t} en los bloques' }, modality: 'txt' },
      { id: 'flow-loop', style: 'lane', tone: 'accent', label: 'Bucle de flujo: × {{cfg.steps}} pasos (solo el sufijo)', legend: 'Marco azul: corre en cada paso de flujo', labelPos: 'top-left', x: 1, y: 39, w: 140, h: 59, hideInBlank: true },
      { id: 'expert-layers', label: 'Experto de acciones: el sufijo', x: 76, y: 45, w: 58, h: 29, repeat: { sym: 'L', from: 'L', totalOf: 'action-expert', totalLabel: '= {t} en el experto' }, modality: 'act' },
    ],
    nodes: [
      { id: 'images', op: 'io', image: true, imageGrid: 0, parallel: 'cfg.cams', label: 'Cámaras', x: 1, y: 3, w: 15, h: 16,
        note: 'Hasta ' + q('cfg.cams') + ' imágenes por paso (la cámara de la base y las de las muñecas), cada una de ' + q('cfg.H') + '×' + q('cfg.W') + '. Las cartas de atrás son las otras cámaras: las procesa el MISMO SigLIP.' },
      { id: 'siglip', op: 'attn', style: 'block', modality: 'img', label: 'SigLIP So400m/14', sub: 'L_s capas → proyección a D', subNum: '{{cfg.Ls}} capas · → D = {{cfg.D}}', runs: '× {{cfg.cams}} (una por cámara)', runsTone: 'once', x: 29, y: 3, w: 29, h: 13,
        xref: [{ href: '#clip.diagrama~clip-image-encoder.enc-layer', label: 'Ver una capa de ViT por dentro (CLIP)' }],
        costNote: 'Parámetros: los de UNA torre (las cámaras comparten pesos). MACs: las {{' + C + '.cfg.cams}} cámaras.',
        tex: 'V_c = \\mathrm{SigLIP}(x_c)\\,W_{\\text{img}} \\in \\mathbb{R}^{N_p\\times D}',
        note: 'El encoder de PaliGemma: ' + q('cfg.Ls') + ' capas de ancho ' + q('cfg.Ds') + ', sin CLS; ' + q('cfg.Np') + ' tokens por imagen, y una lineal los lleva al ancho de Gemma (' + q('cfg.D') + '). Corre una vez por cámara y por chunk: ' + q('metrics.visualTokens') + ' tokens de imagen en total.' },
      { id: 'prompt', op: 'io', modality: 'txt', label: 'Instrucción', sub: 'T tokens', subNum: 'T = {{cfg.T}} tokens', x: 1, y: 25, w: 17, h: 8,
        note: 'La instrucción tokenizada, rellenada a un largo fijo de ' + q('cfg.T') + ' tokens (el relleno se calcula y se enmascara).' },
      { id: 'language', op: 'embed', label: 'Embedding de Gemma', sub: 'tabla V × D', subNum: 'tabla {{cfg.V}} × {{cfg.D}}', x: 29, y: 25, w: 29, h: 8,
        tex: 'E(t)\\cdot\\sqrt{D} \\in \\mathbb{R}^{T\\times D}', note: 'La tabla de embedding de Gemma (' + q('cfg.V') + ' filas; el LM head comparte esta matriz y NO corre: π0 no genera texto).' },
      { id: 'prefix-concat', op: 'tensorop', shape: 'concat', label: 'Prefijo', labelPos: 'left', ops: ['prefix-concat'], opsExact: true, x: 63, y: 15, w: 5, h: 5,
        note: 'Imágenes y texto, uno detrás del otro: el prefijo de ' + q('metrics.prefixTokens') + ' tokens. Sin parámetros.' },
      { id: 'gemma', op: 'attn', style: 'block', costOf: 'block', scope: 'gemma', badgeTotal: true, label: 'Bloque de Gemma (pre-norm)', mini: GEMMA_MINI, runs: '× 1 por chunk', runsTone: 'once', x: 78, y: 11, w: 48, h: 13,
        tex: '\\begin{aligned} r &= x + \\mathrm{Attn}(\\mathrm{RMSNorm}(x)) \\\\ y &= r + \\mathrm{GeGLU}(\\mathrm{RMSNorm}(r)) \\end{aligned}',
        note: 'Gemma 2B: ' + q('cfg.L') + ' capas de ancho ' + q('cfg.D') + ', ' + q('cfg.h') + ' cabezas de query y UNA de K, V (MQA), d_h = ' + q('cfg.dh') + ', FFN GeGLU de ' + q('cfg.Dmlp') + '. El prefijo es bidireccional (imágenes y texto se ven entre sí). Corre una sola vez por chunk; su producto útil es la K y la V de cada capa.' },
      { id: 'prefix-kv', op: 'attn', style: 'store', label: 'KV del prefijo', sub: 'K y V de cada capa\nse calcula 1 vez por chunk', subNum: 'por capa: {{tensor.k-rope.shape}} (K y V)\n{{metrics.prefixKvBytes}} en las {{cfg.L}} capas', x: 139, y: 5, w: 36, h: 21,
        note: 'Un almacén, no una operación: la K (rotada) y la V de los ' + q('metrics.prefixTokens') + ' tokens del prefijo en cada capa de Gemma (con MQA, una sola cabeza de K, V: ' + q('metrics.prefixKvBytes') + ' en total). Como el prefijo no atiende al sufijo (máscara por bloques), estas K y V no cambian entre pasos de flujo: se calculan una vez y las lee el experto en cada paso. Es la idea de sistemas de π0.' },
      { id: 'state', perPass: true, costNote: 'Por paso de flow; corre {{' + C + '.cfg.steps}} veces por chunk.', op: 'embed', modality: 'act', label: 'Estado q_t', sub: 'Linear d_a → D_a', x: 5, y: 47, w: 22, h: 9,
        tex: 's = q_t W_s + b_s', note: 'El estado propioceptivo del robot (posiciones de las articulaciones, rellenado a d_a = ' + q('cfg.da') + '), proyectado al ancho del experto (' + q('cfg.Da') + '): un token.' },
      { id: 'noisy-actions', perPass: true, costNote: 'Por paso de flow; corre {{' + C + '.cfg.steps}} veces por chunk.', op: 'embed', modality: 'act', label: 'Acciones A_τ', sub: 'ruido en τ = 1 · Linear', x: 5, y: 63, w: 22, h: 11,
        tex: 'A_\\tau = \\tau\\,\\varepsilon + (1-\\tau)\\,A \\;\\;(\\text{openpi})', note: 'El chunk de ' + q('cfg.Ha') + ' acciones de ' + q('cfg.da') + ' números (rellenadas), con ruido: al empezar es ruido puro (τ = 1 en la convención de openpi, que integra de 1 a 0; el paper usa τ = 0 para el ruido). Cada paso de Euler lo reemplaza por uno un poco más limpio.' },
      { id: 't-embed', perPass: true, costNote: 'Por paso de flow; corre {{' + C + '.cfg.steps}} veces por chunk.', op: 'embed', label: 'Tiempo τ + MLP', sub: 'sincos(τ) ‖ acción → MLP', x: 34, y: 63, w: 25, h: 11,
        tex: 'a_i = W_{out}\\,\\mathrm{swish}\\big(W_{in}\\,[\\,W_a A_{\\tau,i} \\,\\Vert\\, \\phi(\\tau)\\,]\\big)', note: 'El tiempo τ del flujo, en senos y cosenos (como el timestep de DiT), se pega a cada acción proyectada y un MLP de 2 capas los mezcla: así cada token de acción sabe cuánto ruido tiene.' },
      { id: 'suffix-concat', perPass: true, costNote: 'Por paso de flow; corre {{' + C + '.cfg.steps}} veces por chunk.', op: 'tensorop', shape: 'concat', label: 'Sufijo', labelPos: 'left', ops: ['suffix-concat'], opsExact: true, x: 64, y: 58, w: 5, h: 5,
        note: 'Estado + acciones: el sufijo de ' + q('metrics.suffixTokens') + ' tokens de ancho ' + q('cfg.Da') + '. Sin parámetros.' },
      { id: 'action-expert', op: 'attn', style: 'block', costOf: 'block', scope: 'action-expert', perPass: true, badgeTotal: true, label: 'Bloque del experto', mini: EXPERT_MINI, runs: '× {{cfg.steps}} pasos', expand: 'pi0-layer', x: 80, y: 54, w: 50, h: 13,
        costNote: 'Por capa y por pasada; corre {{' + C + '.cfg.steps}} veces por chunk (una por paso de flujo), con los mismos pesos.',
        note: 'Un transformer chico (' + q('metrics.expertParams') + ' parámetros: ancho ' + q('cfg.Da') + ', FFN ' + q('cfg.Dmlpa') + ') con la MISMA profundidad (' + q('cfg.L') + ' capas) y las mismas cabezas que Gemma (' + q('cfg.h') + ' de query, 1 de K, V, d_h = ' + q('cfg.dh') + '). Pesos propios, atención compartida: en cada capa sus queries atienden a sus tokens Y a la K, V del prefijo de esa capa de Gemma (doble línea). Ábrelo para ver una capa.' },
      { id: 'velocity', perPass: true, costNote: 'Por paso de flow; corre {{' + C + '.cfg.steps}} veces por chunk.', op: 'head', label: 'Velocidad v_θ', sub: 'últimas H_a filas · D_a → d_a', x: 92, y: 79, w: 26, h: 9,
        tex: 'v_\\theta(A_\\tau, o) = W_{out}\\, h_{-H_a:}', note: 'Se toman las ' + q('cfg.Ha') + ' filas de las acciones (no la del estado) y una lineal da la velocidad del flujo: hacia dónde mover cada acción.' },
      { id: 'euler', perPass: true, costNote: 'Por paso de flow; corre {{' + C + '.cfg.steps}} veces por chunk.', op: 'tensorop', shape: 'rect', label: 'Paso de Euler', sub: 'A ← A + δ·v', x: 122, y: 79, w: 16, h: 9,
        tex: 'A_{\\tau+\\delta} = A_\\tau + \\delta\\, v_\\theta,\\quad \\delta = -1/\\text{pasos}', note: 'Un paso de Euler del ODE del flujo, sin parámetros: ' + q('cfg.steps') + ' pasos iguales de τ = 1 (ruido) a 0 (acciones). Las acciones nuevas vuelven a entrar al experto (bucle punteado).' },
      { id: 'action-chunk', op: 'io', modality: 'act', label: 'Chunk de acciones', sub: '→ robot', x: 148, y: 78, w: 27, h: 11,
        note: 'Tras los ' + q('cfg.steps') + ' pasos: ' + q('cfg.Ha') + ' acciones seguidas (≈ 1 s a 50 Hz), que el robot ejecuta (en el paper, parte del chunk antes de volver a inferir).' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Cómputo por chunk (MACs)', x: 1, y: 102, w: 86, h: 14,
        costSplit: {
          segs: [
            { op: 'attn', n: 'metrics.visionMacs', label: 'SigLIP × {{cfg.cams}}' },
            { tone: 'once', n: 'metrics.gemmaPrefixMacs', label: 'Gemma: prefijo ({{metrics.prefixTokens}} tokens)' },
            { tone: 'loop', n: 'metrics.flowMacs', label: 'Experto × {{cfg.steps}} pasos ({{metrics.suffixTokens}} tokens)' },
          ],
          caption: 'total {{metrics.macsPerChunk}} por chunk de {{cfg.Ha}} acciones',
        },
        note: 'MACs de un chunk, del calculador. El prefijo (' + q('metrics.prefixShare') + ') pesa mucho más que los ' + q('cfg.steps') + ' pasos de flujo juntos: el experto es chico y procesa ' + q('metrics.suffixTokens') + ' tokens; repetir Gemma en cada paso costaría ' + q('cfg.steps') + ' veces el prefijo.' },
      { id: 'cost-ms', op: 'io', hideInBlank: true, label: 'Tiempo por chunk (≈ 4090)', x: 89, y: 102, w: 86, h: 14,
        costSplit: {
          unit: 'ms',
          segs: [
            { op: 'attn', n: 'metrics.imageMsRtx4090', label: 'Imágenes' },
            { tone: 'once', n: 'metrics.prefixMsRtx4090', label: 'Prefijo (Gemma)' },
            { tone: 'loop', n: 'metrics.flowMsRtx4090', label: '{{cfg.steps}} pasos de flujo' },
          ],
          caption: '≈ {{metrics.chunkMsRtx4090}} ms por chunk (cota de roofline); el paper mide {{pi0.metrics.paperOnboardMs}} ms con 3 cámaras',
        },
        note: 'Tiempo estimado con el roofline del calculador en una RTX 4090 (165.2 TFLOPS BF16, 1,008 GB/s). Es una cota optimista: el paper mide en la misma GPU 14 ms de imágenes + 32 ms de prefijo + 27 ms de los 10 pasos = 73 ms (Tabla I). Los pasos de flujo son chicos y limitados por memoria (releen los pesos del experto y la KV del prefijo).' },
    ],
    tensors: [
      { id: 'img-tokens', at: { edge: 'siglip>prefix-concat' }, show: 'label' },
      { id: 'x-t', at: { x: 34, y: 86 }, show: 'both', note: 'ruido', leader: { node: 'noisy-actions', side: 'bottom', at: 0.8 } },
    ],
    edges: [
      { from: 'images', to: 'siglip', kind: 'data', tensor: 'pixels', fromAt: 0.4, toAt: 0.4923, labelSide: 'above', labelT: 0.55 },
      { from: 'siglip', to: 'prefix-concat', kind: 'data', tensor: 'img-tokens', toSide: 'top', fromAt: 0.5, labelSide: 'above', labelSeg: 0, labelT: 0.5, tag: '× {{cfg.cams}}', tagStyle: 'plain', tagSide: 'below', tagSeg: 0, tagT: 0.5 },
      { from: 'prompt', to: 'language', kind: 'data', tensor: 'lang-ids', labelSide: 'below' },
      { from: 'language', to: 'prefix-concat', kind: 'data', tensor: 'lang-emb', toSide: 'bottom', labelSide: 'below', labelSeg: 0, labelT: 0.5 },
      { from: 'prefix-concat', to: 'gemma', kind: 'data', tensor: 'prefix', toAt: 0.5, labelSide: 'below', labelT: 0.5 },
      { from: 'gemma', to: 'prefix-kv', kind: 'data', tensor: 'k-rope', fromAt: 0.5, toAt: 0.5952, labelSide: 'below', tag: 'K, V', tagStyle: 'plain', tagSide: 'on', tagT: 0.5, label: false },
      { from: 'prefix-kv', to: 'action-expert', kind: 'cross', tensor: 'k-rope', fromSide: 'bottom', toSide: 'right', fromAt: 0.4444, toAt: 0.5, tag: 'K, V del prefijo', tagSide: 'on', tagSeg: 0, tagT: 0.45, labelSide: 'right', labelSeg: 0, labelT: 0.75,
        crossNote: 'La K y la V del prefijo de esa capa de Gemma, leídas del caché', blankHide: true },
      { from: 'state', to: 'suffix-concat', kind: 'data', tensor: 'state-tok', toSide: 'top', labelSide: 'above', labelSeg: 0, labelT: 0.5 },
      { from: 'noisy-actions', to: 't-embed', kind: 'data', tensor: 'act-emb', label: false },
      { from: 't-embed', to: 'suffix-concat', kind: 'data', tensor: 'act-tokens', toSide: 'bottom', labelSide: 'below', labelSeg: 0, labelT: 0.45 },
      { from: 'suffix-concat', to: 'action-expert', kind: 'data', tensor: 'suffix', toAt: 0.5, labelSide: 'below', labelT: 0.5 },
      { from: 'action-expert', to: 'velocity', kind: 'data', tensor: 'a-x-norm', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.5, labelSide: 'left', labelT: 0.5 },
      { from: 'velocity', to: 'euler', kind: 'data', tensor: 'velocity', label: false },
      { from: 'euler', to: 'action-chunk', kind: 'data', tensor: 'action-chunk', labelSide: 'above', labelT: 0.5 },
      { from: 'euler', to: 'noisy-actions', kind: 'control', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[130, 94], [16, 94]], tag: 'A_{τ+δ} vuelve · × {{cfg.steps}} pasos', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.62, loop: true },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (π0, 3 cámaras, un chunk)', steps: [
        { nodes: ['images', 'siglip'], edges: ['images>siglip', 'siglip>prefix-concat'], tensors: ['pixels', 'img-tokens'],
          text: 'Cada cámara (<b>' + q('tensor.pixels.shape') + '</b>) pasa por el mismo SigLIP y una lineal: <b>' + q('tensor.img-tokens.shape') + '</b> por imagen, ' + q('metrics.visualTokens') + ' tokens con las ' + q('cfg.cams') + ' cámaras.' },
        { nodes: ['prompt', 'language', 'prefix-concat'], edges: ['prompt>language', 'language>prefix-concat', 'prefix-concat>gemma'], tensors: ['lang-ids', 'lang-emb', 'prefix'],
          text: 'La instrucción (' + q('cfg.T') + ' tokens con relleno) se embebe y se pega a las imágenes: el prefijo es <b>' + q('tensor.prefix.shape') + '</b>.' },
        { nodes: ['gemma', 'prefix-kv'], edges: ['prefix-concat>gemma', 'gemma>prefix-kv'], tensors: ['prefix', 'k-rope'],
          text: 'Gemma 2B procesa el prefijo UNA vez (' + q('metrics.gemmaPrefixMacs') + ') y deja en cada capa su K y su V: <b>' + q('tensor.k-rope.shape') + '</b> cada una (MQA: una sola cabeza de K, V), ' + q('metrics.prefixKvBytes') + ' en total.' },
        { nodes: ['state', 'noisy-actions', 't-embed', 'suffix-concat'], edges: ['state>suffix-concat', 'noisy-actions>t-embed', 't-embed>suffix-concat', 'suffix-concat>action-expert'], tensors: ['x-t', 'state-tok', 'act-tokens', 'suffix'],
          text: 'El sufijo: el estado (1 token) y el chunk ruidoso (<b>' + q('tensor.x-t.shape') + '</b>) mezclado con el tiempo τ, todo al ancho del experto: <b>' + q('tensor.suffix.shape') + '</b>.' },
        { expand: 'pi0-layer', nodes: ['g-kv', 's-qkv', 'kv-cat', 'joint-attn'], edges: ['g-kv>kv-cat', 's-qkv>kv-cat', 's-qkv>joint-attn', 'kv-cat>joint-attn'], tensors: ['k-rope', 'a-k-rope', 'a-q-rope', 'a-k-all'],
          text: 'En cada capa del experto, sus queries (<b>' + q('tensor.a-q-rope.shape') + '</b>, pesos del experto) atienden a las K de Gemma del prefijo más las suyas: <b>' + q('tensor.a-k-all.shape') + '</b>. Una sola atención, dos juegos de pesos: <b>' + q('tensor.a-scores.shape') + '</b> puntuaciones.' },
        { nodes: ['action-expert', 'velocity', 'euler'], edges: ['action-expert>velocity', 'velocity>euler', 'euler>noisy-actions'], tensors: ['a-x-norm', 'velocity'],
          text: 'Del experto salen las filas de las acciones → la velocidad <b>' + q('tensor.velocity.shape') + '</b> → un paso de Euler. El chunk vuelve a entrar: ' + q('cfg.steps') + ' pasos de ' + q('metrics.flowStepMacs') + ' cada uno. Gemma no vuelve a correr.' },
        { nodes: ['action-chunk', 'cost', 'cost-ms'], edges: ['euler>action-chunk'], tensors: ['action-chunk'],
          text: 'Tras los ' + q('cfg.steps') + ' pasos: <b>' + q('tensor.action-chunk.shape') + '</b>, ' + q('cfg.Ha') + ' acciones para el robot. Un chunk cuesta ' + q('metrics.macsPerChunk') + ' (' + q('metrics.prefixShare') + ' en el prefijo) y ≈ ' + q('metrics.chunkMsRtx4090') + ' ms en una RTX 4090 como cota (el paper mide ' + q('metrics.paperOnboardMs') + ' ms).' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) una capa: atención conjunta
  ATLAS.registerDiagram(Object.assign({
    id: 'pi0-layer', model: 'pi0', config: C, kind: 'arch', title: 'Una capa de π0 en un paso de flujo: atención conjunta',
    parent: 'pi0-overview', parentNode: 'action-expert',
    caption: 'Pesos separados, atención compartida. Arriba, el prefijo con los pesos de GEMMA: sus K y V se calcularon en el prefill y salen del caché. Abajo, el sufijo con los pesos del EXPERTO: sus Q, K y V. Las K y V de los dos se juntan y las queries del sufijo atienden a todas (máscara por bloques: ábrela). Después, W_O y la FFN son del experto. Funciona porque los dos tienen las mismas cabezas y la misma d_h, aunque sus anchos difieran.',
    grid: { w: 150, h: 78 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['kv-cat', 'joint-attn'], mobileFocusPad: 2,
    nodes: [
      { id: 'g-in', op: 'io', modality: 'txt', label: 'Prefijo', sub: 'imágenes + texto', x: 1, y: 4, w: 18, h: 9, note: 'El prefijo que procesó Gemma en el prefill (aquí, su entrada a esta capa).' },
      { id: 'g-norm', op: 'norm', label: 'RMSNorm', sub: 'de Gemma', ops: ['norm1'], opsExact: true, x: 28, y: 5, w: 15, h: 7, note: 'La norma de Gemma de esta capa.' },
      { id: 'g-kv', op: 'embed', label: 'W_K, W_V de Gemma', sub: 'D → G·d_h · en el prefill', ops: ['k-proj', 'v-proj'], opsExact: true, x: 51, y: 4, w: 28, h: 9,
        tex: 'K_p = h_p W_K^{\\text{Gemma}},\\; V_p = h_p W_V^{\\text{Gemma}}', note: 'Las K y V del prefijo, con los pesos de Gemma (' + q('cfg.D') + ' → 1 cabeza de ' + q('cfg.dh') + ', MQA) y RoPE. Se calculan UNA vez, en el prefill, y se guardan: en un paso de flujo solo se leen del caché.' },
      { id: 's-in', op: 'io', modality: 'act', label: 'Sufijo', sub: 'estado + acciones', x: 1, y: 33, w: 18, h: 9, note: 'El sufijo (estado + acciones ruidosas) que entra a esta capa del experto.' },
      { id: 's-norm', op: 'norm', label: 'RMSNorm', sub: 'del experto', ops: ['ae-norm1'], opsExact: true, perPass: true, x: 28, y: 34, w: 15, h: 7, note: 'La norma del experto (pesos propios).' },
      { id: 's-qkv', op: 'embed', label: 'W_Q, W_K, W_V del experto', sub: 'D_a → h·d_h, G·d_h', ops: ['ae-q-proj', 'ae-k-proj', 'ae-v-proj'], opsExact: true, perPass: true, x: 51, y: 33, w: 28, h: 9,
        tex: 'Q_s = h_s W_Q^{\\text{exp}},\\; K_s = h_s W_K^{\\text{exp}},\\; V_s = h_s W_V^{\\text{exp}}', note: 'Del ancho del experto (' + q('cfg.Da') + ') a las MISMAS cabezas que Gemma: ' + q('cfg.h') + ' de query y 1 de K, V de ' + q('cfg.dh') + '. Por eso h·d_h = ' + q('cfg.Dq') + ' ≠ D_a: la atención se puede compartir aunque los anchos difieran.' },
      { id: 'kv-cat', perPass: true, op: 'tensorop', shape: 'concat', label: 'K, V juntas', labelPos: 'below', ops: ['ae-kv-k', 'ae-kv-v'], opsExact: true, x: 90, y: 17, w: 5, h: 5,
        tex: 'K = [\\,K_p ; K_s\\,],\\; V = [\\,V_p ; V_s\\,]', note: 'Las K (y las V) del prefijo, del caché, seguidas de las del sufijo: ' + q('tensor.a-k-all.shape') + '. Sin parámetros.' },
      { id: 'joint-attn', perPass: true, costNote: 'Por capa y por paso de flow (× {{' + C + '.cfg.L}} capas × {{' + C + '.cfg.steps}} pasos por chunk).', op: 'attn', heads: 'h', label: 'Atención conjunta', sub: 'softmax(Q_s Kᵀ/√d_h + M) V', ops: ['ae-scores', 'ae-scale', 'ae-mask', 'ae-softmax', 'ae-weighted-sum', 'ae-merge'], opsExact: true, expand: 'pi0-attention-mask', x: 102, y: 30, w: 30, h: 13,
        tex: '\\mathrm{softmax}\\!\\Big(\\frac{Q_s K^\\top}{\\sqrt{d_h}} + M\\Big) V', note: 'Una sola atención: las ' + q('metrics.suffixTokens') + ' queries del sufijo contra las ' + q('cfg.ctx') + ' keys (prefijo + sufijo), con la máscara por bloques M (las acciones ven todo; el estado no ve las acciones). En el entrenamiento corre con el prefijo también (y el prefijo no ve el sufijo): el resultado para el prefijo no depende de las acciones. Ábrela para ver la máscara.' },
      { id: 's-rest', op: 'mlp', style: 'block', label: 'Resto de la capa (experto)', sub: 'W_O · ⊕ · RMSNorm · GeGLU · ⊕', ops: ['ae-o-proj', 'ae-res1', 'ae-norm2', 'ae-gate-proj', 'ae-up-proj', 'ae-gelu', 'ae-mul', 'ae-down-proj', 'ae-res2'], opsExact: true, perPass: true, x: 99, y: 52, w: 36, h: 9,
        note: 'W_O (de h·d_h a ' + q('cfg.Da') + '), la residual, la norma y la FFN GeGLU de ' + q('cfg.Dmlpa') + ': todo con pesos del experto. Gemma tiene los suyos para las filas del prefijo (en el prefill).' },
      { id: 's-out', op: 'io', modality: 'act', label: 'Sufijo', sub: '→ capa siguiente', x: 107, y: 68, w: 20, h: 8, note: 'La salida de la capa para el sufijo, que entra a la capa siguiente del experto (con la K, V del prefijo de la capa siguiente de Gemma).' },
    ],
    edges: [
      { from: 'g-in', to: 'g-norm', kind: 'data', tensor: 'prefix', labelSide: 'above' },
      { from: 'g-norm', to: 'g-kv', kind: 'data', tensor: 'h-norm1', label: false },
      { from: 'g-kv', to: 'kv-cat', kind: 'data', tensor: 'k-rope', toSide: 'top', labelSide: 'above', labelSeg: 0, labelT: 0.5, tag: 'del caché', tagStyle: 'plain', tagSide: 'below', tagSeg: 0, tagT: 0.5 },
      { from: 's-in', to: 's-norm', kind: 'data', tensor: 'suffix', labelSide: 'below' },
      { from: 's-norm', to: 's-qkv', kind: 'data', tensor: 'a-h-norm1', label: false },
      { from: 's-qkv', to: 'kv-cat', kind: 'data', tensor: 'a-k-rope', fromSide: 'top', toSide: 'left', fromAt: 0.85, labelSide: 'left', labelSeg: 0, labelT: 0.5, tag: 'K, V', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 's-qkv', to: 'joint-attn', kind: 'data', tensor: 'a-q-rope', toAt: 0.5769, labelSide: 'below', labelT: 0.5, tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagT: 0.2 },
      { from: 'kv-cat', to: 'joint-attn', kind: 'data', tensor: 'a-k-all', toSide: 'top', toAt: 0.2333, labelSide: 'right', labelSeg: 1, labelT: 0.4 },
      { from: 'joint-attn', to: 's-rest', kind: 'data', tensor: 'a-z', fromSide: 'bottom', toSide: 'top', fromAt: 0.4, toAt: 0.5, labelSide: 'left', labelT: 0.5 },
      { from: 's-rest', to: 's-out', kind: 'data', tensor: 'a-x-out', fromSide: 'bottom', toSide: 'top', labelSide: 'left', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) la máscara por bloques
  ATLAS.registerDiagram(Object.assign({
    id: 'pi0-attention-mask', model: 'pi0', config: C, kind: 'arch', title: 'Máscara por bloques de π0',
    parent: 'pi0-layer', parentNode: 'joint-attn',
    caption: 'Fila = query, columna = key (pocas celdas por grupo: ilustrativo). Tres bloques en orden: prefijo (imágenes + texto), estado, acciones. Cada bloque ve el suyo y los anteriores: el prefijo no ve al robot (por eso su K, V no cambia y se guarda), el estado no ve las acciones, y las acciones se ven todas entre sí (el chunk se predice entero, no token a token).',
    grid: { w: 96, h: 28 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['mask'],
    nodes: [
      { id: 'mask', op: 'tensorop', shape: 'rect', label: 'Máscara M', x: 1, y: 1, w: 44, h: 26,
        maskGrid: { cell: 13, labelW: 66, groups: [
          { label: 'imágenes', short: 'img', cells: 3, block: 0, mod: 'img' },
          { label: 'texto', short: 'txt', cells: 2, block: 0, mod: 'txt' },
          { label: 'estado', short: 's', cells: 1, block: 1, mod: 'lat' },
          { label: 'acciones', short: 'acc', cells: 4, block: 2, mod: 'act' },
        ] },
        tex: 'M_{ij} = \\begin{cases} 0 & \\text{bloque}(j) \\le \\text{bloque}(i) \\\\ -\\infty & \\text{si no} \\end{cases}',
        note: 'La máscara de openpi (make_attn_mask): 0 donde se permite, −∞ donde no. Imágenes y texto forman un bloque bidireccional; el estado, otro; las acciones, otro. Cuentas reales: prefijo ' + q('metrics.prefixTokens') + ' tokens, estado 1, acciones ' + q('cfg.Ha') + '.' },
    ],
    notes: [
      { x: 49, y: 5, text: 'prefijo: {{metrics.prefixTokens}} tokens', keepInBlank: true },
      { x: 49, y: 8, text: '({{metrics.visualTokens}} de imagen + {{cfg.T}} de texto)', keepInBlank: true },
      { x: 49, y: 12, text: 'estado: 1 token' },
      { x: 49, y: 15, text: 'acciones: {{cfg.Ha}} tokens' },
      { x: 49, y: 20, text: 'en un paso de flujo solo corren', cls: 'ink' },
      { x: 49, y: 23, text: 'las filas del estado y las acciones', cls: 'ink' },
    ],
    edges: [],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
