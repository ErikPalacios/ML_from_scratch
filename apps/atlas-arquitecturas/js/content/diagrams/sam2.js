/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/sam2.js
   Diagramas de SAM 2 (SPEC §7.2, ids de §17.2), config canónica sam2-hiera-l:
     sam2-overview      UN frame t del video. Arriba, el camino del frame: Hiera → FPN → memory attention ×4
                        (condiciona el frame con la memoria) → mask decoder (+ skips de alta resolución desde la
                        FPN, prompts opcionales) → máscara y cabeza de oclusión. Abajo, el lazo de memoria: el
                        memory encoder funde la máscara con las features del frame y lo guarda en el banco (FIFO de
                        N_r frames recientes + los N_p frames con prompt); el decoder deja además un puntero de objeto.
                        La arista punteada (control) hacia "frame t+1" es el tiempo: lo que se guarda en t lo lee t+1.
       sam2-memory-attn una capa: self-attention del frame (RoPE) → frame ← memoria (cross-attention: K, V de las
                        memorias espaciales y los punteros) → MLP.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas las pone el motor desde ATLAS.Arch.run;
   aquí solo se nombran tensores. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'sam2-hiera-l';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const PAGE = { page: 'sam2', section: 'diagrama' };

  // ------------------------------------------------------------------ (a) vista general: un frame + el lazo de memoria
  // Arriba, el camino del frame (Frame → Hiera → FPN → memory attention → decoder); abajo, en el carril violeta,
  // lo que pasa de un frame al siguiente: el memory encoder ESCRIBE (arista de datos, 64×64×64) en el banco (un
  // almacén: cilindro) y la memory attention LEE el banco y los punteros de frames anteriores (K,V: frames < t).
  // "t → t+1" es una arista de control (el tiempo), no un skip. La oclusión controla la máscara y la memoria.
  ATLAS.registerDiagram(Object.assign({
    id: 'sam2-overview', model: 'sam2', config: C, kind: 'arch', title: 'SAM 2 — un frame y su memoria',
    caption: 'Un frame t del video. El camino de SAM (encoder → decoder) con dos cambios: el encoder es Hiera (jerárquico: sus mapas de stride 4 y 8 llegan al decoder como skips de alta resolución) y, antes del decoder, la memory attention condiciona el frame con lo que se recuerda de frames anteriores (K y V solo de frames anteriores a t). Abajo, el lazo de memoria: el memory encoder funde la máscara predicha con las features del frame y escribe una memoria de 64×64×64 en el banco (una cola FIFO de N_r frames recientes + los N_p frames con prompt, que se quedan fijos); el decoder deja además un puntero de objeto. Lo que se guarda en t lo lee el frame t+1 (arista punteada: el tiempo). Si la cabeza de oclusión dice que el objeto no está, la máscara sale vacía y la memoria y el puntero se marcan «sin objeto». Los prompts son opcionales: con un clic en un frame basta para seguir al objeto en todo el video. La memory attention cuesta lo mismo en los cuatro tamaños: pesa poco en Hiera-L y mucho en Hiera-T.',
    grid: { w: 150, h: 66 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['memory-attn', 'memory-bank', 'memory-encoder'],
    groups: [
      { id: 'mem-stack', label: '', x: 61, y: 10.7, w: 25, h: 16.3, repeat: { sym: 'L_m', from: 'Lmem', tag: '× {v} capas', totalOf: 'memory-attn', crumb: false } },
      { id: 'mem-lane', style: 'lane', tone: 'fuse', hideInBlank: true, label: 'Memoria entre frames', labelPos: 'bottom-right', legend: 'Marco violeta: lo que pasa de un frame al siguiente', x: 51, y: 34.5, w: 49.5, h: 24 },
    ],
    nodes: [
      { id: 'frame', op: 'io', label: 'Frame t', image: true, imageGrid: 0, x: 7, y: 0.5, w: 10, h: 10,
        note: 'Un frame del video, redimensionado a 1024×1024 (sin batch). SAM 2 procesa el video en orden, un frame a la vez (streaming).' },
      { id: 'img-encoder', op: 'attn', modality: 'img', label: 'Encoder Hiera', sub: 'jerárquico · MAE', flag: 'cada frame', x: 1, y: 16.5, w: 22, h: 9,
        tex: '\\{F_4, F_8, F_{16}, F_{32}\\} = \\mathrm{Hiera}(x_t)', note: 'Un ViT jerárquico (Hiera, preentrenado con MAE): 4 etapas con strides 4, 8, 16 y 32 y cada vez más canales; atención por ventanas en todas las etapas y unos pocos bloques globales en la etapa 3. A diferencia del ViT plano de SAM, deja mapas de varias resoluciones (la flecha a la FPN muestra el de stride 16; los cuatro van a la FPN). Corre una vez por frame.' },
      { id: 'fpn', op: 'conv', label: 'FPN', sub: '→ 256', x: 37, y: 17, w: 11, h: 8,
        tex: 'P_s = \\mathrm{Conv}_{1\\times 1}(F_s)\\ \\big(+\\,{\\uparrow}P_{2s}\\ \\text{solo en } s = 16\\big)', note: 'Un neck tipo FPN lleva las etapas a 256 canales. Solo los niveles de stride 16 y 32 se mezclan de arriba hacia abajo (fpn_top_down_levels = [2, 3]); los de stride 4 y 8 son laterales, sin top-down. El mapa de stride 16 (64×64) va a la memory attention y al memory encoder; los de stride 4 y 8 van directo al decoder como skips de alta resolución (reducidos a 32 y 64 canales).' },
      { id: 'memory-attn', op: 'attn', style: 'block', label: 'Memory attention', badgeUnit: 'por capa', costExclude: ['in', 'out-norm', 'no-mem'], expand: 'sam2-memory-attn', x: 62, y: 17, w: 22, h: 8,
        mini: { items: [{ label: 'self', op: 'attn' }, { label: '← memoria', op: 'attn' }, { label: 'MLP', op: 'mlp' }] },
        tex: 'X_t \\leftarrow \\mathrm{MemAttn}(X_t;\\ \\mathcal{M}_{<t})', note: 'Transformer de 4 capas: los 4096 tokens del frame se miran entre sí y después consultan la memoria (cross-attention: memorias espaciales de frames anteriores y punteros de objeto). Así el frame "sabe" qué objeto se está siguiendo antes de llegar al decoder. En el primer frame no hay memoria: se suma un embedding aprendido de "sin memoria". Es igual en los cuatro tamaños (Hiera-T, S, B+ y L comparten memory attention de 256 canales): ' + q('node.memory-attn.macsG') + ' MACs por frame con el banco lleno, que son ' + q('metrics.memAttnMacsShare') + ' de un frame en L pero {{sam2-hiera-t.metrics.memAttnMacsShare}} en T.' },
      { id: 'prompts', op: 'io', label: 'Prompts (opcional)', sub: 'clic · caja · máscara', x: 84, y: 0.5, w: 20, h: 6,
        note: 'Opcionales en cada frame: un clic, una caja o una máscara. Normalmente se da uno en el primer frame y alguno de corrección donde el seguimiento falla.' },
      { id: 'prompt-enc', op: 'embed', label: 'Prompt encoder', sub: 'como en SAM', x: 114, y: 0.5, w: 18, h: 6,
        tex: 's_i = \\mathrm{PE}(p_i) + e_{\\text{tipo}}', note: 'El mismo de SAM: Fourier + embedding de tipo para puntos y cajas; convs para una máscara.' },
      { id: 'mask-decoder', op: 'head', style: 'block', label: 'Mask decoder', x: 100, y: 13.5, w: 26, h: 15,
        mini: { items: [{ label: 'two-way', op: 'attn' }, { label: '↑ + skips', op: 'conv' }, { label: 'dot', op: 'head' }] },
        tex: '\\hat M_t,\\ \\widehat{\\mathrm{IoU}},\\ s_t = \\mathrm{Dec}(X_t,\\, S_t,\\, F_4, F_8)', note: 'El decoder de SAM con dos agregados: en el upscaling suma los mapas de stride 4 y 8 del encoder (más detalle en los bordes) y tiene un token extra para la oclusión (su puntaje s<sub>t</sub>). El token de la máscara elegida, por un MLP de 3 capas, es el puntero de objeto que se guarda.' },
      { id: 'masks', op: 'io', label: 'Máscara del frame t', sub: '→ imagen', x: 131, y: 12.5, w: 18, h: 6,
        note: 'La máscara del objeto en este frame: el decoder predice 3 y se queda con la de mayor IoU estimado (también en frames sin prompt); con una caja o varios clics, una sola. Si la cabeza de oclusión dice que el objeto no está, sale vacía.' },
      { id: 'occlusion', op: 'head', label: 'Oclusión', sub: '¿está el objeto?', x: 131, y: 24.5, w: 18, h: 6,
        tex: 's_t = \\mathrm{MLP}(t_{obj}),\\quad \\text{visible} \\iff s_t > 0', note: 'Predice si el objeto aparece en este frame. Si dice que no (tapado o fuera de cuadro), la máscara sale vacía (aristas punteadas: controla, no lleva un tensor) y la memoria y el puntero de este frame se marcan como "sin objeto" (SAM 2.1: con embeddings aprendidos). Así un objeto que se oculta no contamina la memoria y se recupera cuando reaparece.' },
      { id: 'obj-ptrs', op: 'embed', label: 'Punteros', sub: '1 / frame', badgePos: 'right', x: 80, y: 37.5, w: 16, h: 5.2,
        tex: 'p_t = \\mathrm{MLP}_3\\big(t^{k^\\star}_{\\mathrm{mask}}\\big) \\in \\mathbb{R}^{256}', note: 'Puntero de objeto: el token de salida de la máscara elegida (k*), pasado por un MLP de 3 capas: un vector de 256 por frame que resume "qué objeto es" en ese frame. Si la oclusión dice que el objeto no está, se mezcla con un puntero aprendido de "sin objeto". Se leen los de todos los frames anteriores con prompt y los de hasta 15 frames recientes; la memory attention los lee como 4 tokens de 64 cada uno.' },
      { id: 'memory-bank', op: 'embed', style: 'store', badgePos: 'right', label: 'Banco de memoria', sub: 'FIFO: N_r recientes\n+ N_p con prompt (fijos)', x: 54, y: 37.5, w: 24, h: 10,
        note: 'Un almacén, no una operación. Las memorias espaciales de los frames t−1 … t−N<sub>r</sub> (N<sub>r</sub> = ' + q('cfg.memFrames') + '; una cola FIFO que avanza con t: al entrar la de t sale la más vieja; si uno de esos frames tuvo prompt, no se repite aquí) más las de los N<sub>p</sub> frames que recibieron un prompt (esas se quedan fijas; al propagar un video ya anotado incluyen también frames con prompt posteriores a t). Cada memoria es un mapa de 64×64 con 64 canales, más una codificación temporal aprendida según su distancia a t: sus únicos parámetros, una tabla de 7×64 (de ahí la insignia). El resto es un buffer.' },
      { id: 'memory-encoder', op: 'conv', label: 'Memory encoder', sub: 'máscara + features', x: 102, y: 41, w: 22, h: 8,
        tex: 'm_t = \\mathrm{Conv}\\big(F_{16} + \\mathrm{Down}(\\sigma(\\hat M_t))\\big) \\in \\mathbb{R}^{64\\times 64\\times 64}', note: 'Baja la máscara predicha (convs) a la rejilla 64×64, la suma a las features del frame (las de la FPN, SIN la memoria) y la pasa por unas convs livianas: sale una memoria de 64×64 con 64 canales. Es lo que se escribe en el banco.' },
      { id: 'next', op: 'io', label: 'Frame t+1', sub: 'lee lo guardado', x: 57, y: 50.5, w: 18, h: 5.5,
        note: 'El tiempo: el frame siguiente hace el mismo camino, y su memory attention lee el banco que acaba de recibir la memoria de t.' },
    ],
    notes: [
      { x: 46, y: 2.4, text: 'skips de alta resolución (strides 4 y 8):' },
      { x: 46, y: 4.6, text: q('tensor.fpn-s4.shape') + ' · ' + q('tensor.fpn-s8.shape'), cls: 'ink' },
    ],
    edges: [
      { from: 'frame', to: 'img-encoder', kind: 'data', tensor: 'x-img', fromSide: 'bottom', toSide: 'top', labelT: 0.4 },
      { from: 'img-encoder', to: 'fpn', kind: 'data', tensor: 'h3-out', tag: '4 mapas', tagStyle: 'plain' },
      { from: 'fpn', to: 'memory-attn', kind: 'data', tensor: 'fpn-s16', labelT: 0.48 },
      { from: 'memory-attn', to: 'mask-decoder', kind: 'data', tensor: 'pix-mem', toAt: 0.5, labelT: 0.6 },
      // skips de alta resolución (strides 4 y 8) por encima de la memory attention
      { from: 'fpn', to: 'mask-decoder', kind: 'skip', tensor: 'fpn-s4', fromSide: 'top', toSide: 'top', fromAt: 0.75, toAt: 0.35, midY: 7.5, label: false },
      { from: 'fpn', to: 'mask-decoder', kind: 'skip', tensor: 'fpn-s8', fromSide: 'top', toSide: 'top', fromAt: 0.92, toAt: 0.45, midY: 9.1, label: false },
      { from: 'prompts', to: 'prompt-enc', kind: 'data', tensor: 'pts', label: false },
      { from: 'prompt-enc', to: 'mask-decoder', kind: 'data', tensor: 'sparse', fromAt: 0.4444, toAt: 0.8462, labelSide: 'right' },
      { from: 'mask-decoder', to: 'masks', kind: 'data', tensor: 'best-mask', fromAt: 0.1333, toAt: 0.5, label: false },
      { from: 'mask-decoder', to: 'occlusion', kind: 'data', tensor: 'obj-tok', fromAt: 0.9333, toAt: 0.5, label: false },
      // la oclusión controla: vacía la máscara y marca la memoria (y el puntero) "sin objeto"
      { from: 'occlusion', to: 'masks', kind: 'control', fromSide: 'top', toSide: 'bottom', tag: 'vacía si no está', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'occlusion', to: 'memory-encoder', kind: 'control', fromSide: 'bottom', toSide: 'right', fromAt: 0.3, via: [[136.4, 45]], tag: 'sin objeto', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      // el lazo de memoria: escribir en t…
      { from: 'mask-decoder', to: 'memory-encoder', kind: 'data', tensor: 'best-mask', fromSide: 'bottom', toSide: 'top', fromAt: 0.4615, toAt: 0.4545, labelSide: 'right' },
      { from: 'fpn', to: 'memory-encoder', kind: 'data', tensor: 'fpn-s16', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[42.5, 61], [113, 61]], labelSeg: 1, labelT: 0.78, labelSide: 'below', tag: 'features del frame (sin memoria)', tagStyle: 'plain', tagSeg: 1, tagT: 0.3, tagSide: 'on' },
      { from: 'mask-decoder', to: 'obj-ptrs', kind: 'data', tensor: 'best-tok', fromSide: 'bottom', toSide: 'right', fromAt: 0.0385, toAt: 0.5, label: false },
      { from: 'memory-encoder', to: 'memory-bank', kind: 'data', tensor: 'mem-out', toAt: 0.75, labelSide: 'below', labelT: 0.4, tag: 'escribe', tagStyle: 'plain', tagSide: 'on', tagT: 0.82 },
      // …y leer lo guardado en frames anteriores
      { from: 'memory-bank', to: 'memory-attn', kind: 'cross', tensor: 'bank-feats', fromSide: 'top', toSide: 'bottom', fromAt: 0.5833, toAt: 0.2727, labelSide: 'left', labelT: 0.4, tag: 'K,V: frames < t', tagT: 0.65, tagSide: 'on' },
      { from: 'obj-ptrs', to: 'memory-attn', kind: 'cross', tensor: 'ptr-tokens', fromSide: 'top', toSide: 'bottom', fromAt: 0.125, toAt: 0.9091, labelSide: 'right', labelT: 0.65, tag: 'K,V: punteros', tagT: 0.35, tagSide: 'on' },
      // el tiempo (control, sin tensor): lo guardado en t lo lee la memory attention de t+1
      { from: 'memory-bank', to: 'next', kind: 'control', fromSide: 'bottom', toSide: 'top', tag: 't → t+1', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números: dos frames (SAM 2 Hiera-L)', steps: [
        { nodes: ['frame', 'img-encoder', 'fpn'], edges: ['frame>img-encoder', 'img-encoder>fpn'], tensors: ['x-img', 'h3-out', 'fpn-s16'],
          text: '<b>Frame 0</b> (<b>' + q('tensor.x-img.shape') + '</b>). Hiera (' + q('node.img-encoder.params') + ' parámetros, ' + q('node.img-encoder.macsG') + ' MACs) deja 4 mapas; su etapa de stride 16 es <b>' + q('tensor.h3-out.shape') + '</b> y la FPN la lleva a <b>' + q('tensor.fpn-s16.shape') + '</b>.' },
        { nodes: ['memory-attn'], edges: ['fpn>memory-attn'], tensors: ['fpn-s16'],
          text: 'En el frame 0 el banco está vacío: en vez de la memory attention se suma un embedding aprendido de "sin memoria". Por eso el primer frame cuesta menos: ' + q('metrics.firstFrameMacs') + ' frente a ' + q('metrics.frameMacs') + ' con el banco lleno.' },
        { nodes: ['prompts', 'prompt-enc', 'mask-decoder'], edges: ['prompts>prompt-enc', 'prompt-enc>mask-decoder', 'memory-attn>mask-decoder', 'fpn>mask-decoder'], tensors: ['pts', 'sparse', 'pix-mem', 'fpn-s4', 'fpn-s8'],
          text: 'El usuario hace un clic en el frame 0: el prompt encoder (el de SAM) da <b>' + q('tensor.sparse.shape') + '</b> tokens. El decoder recibe las features <b>' + q('tensor.pix-mem.shape') + '</b> y, en el upscaling, los skips de alta resolución <b>' + q('tensor.fpn-s8.shape') + '</b> y <b>' + q('tensor.fpn-s4.shape') + '</b> (reducidos a 64 y 32 canales).' },
        { nodes: ['masks', 'occlusion'], edges: ['mask-decoder>masks', 'mask-decoder>occlusion', 'occlusion>masks', 'occlusion>memory-encoder'], tensors: ['best-mask', 'obj-tok'],
          text: 'Sale la máscara del objeto (<b>' + q('tensor.best-mask.shape') + '</b>: de las 3 que predice, la de mayor IoU estimado; se sube a la imagen) y la cabeza de oclusión (' + q('node.occlusion.params') + ' parámetros) dice si el objeto está en el frame. Si dice que no, la máscara sale vacía y la memoria y el puntero de este frame se marcan «sin objeto» (las aristas punteadas).' },
        { nodes: ['memory-encoder', 'obj-ptrs', 'memory-bank'], edges: ['mask-decoder>memory-encoder', 'fpn>memory-encoder', 'memory-encoder>memory-bank', 'mask-decoder>obj-ptrs'], tensors: ['best-mask', 'fpn-s16', 'mem-out', 'best-tok'],
          text: 'Se escribe la memoria: el memory encoder funde la máscara con las features del frame (las de la FPN, sin memoria) y escribe <b>' + q('tensor.mem-out.shape') + '</b> (' + q('metrics.memPerFrameMem') + ' en bf16) en el banco. El token de la máscara elegida, por un MLP de 3 capas, deja el puntero de objeto (<b>' + q('tensor.best-tok.shape') + '</b> → 256).' },
        { nodes: ['memory-bank', 'next', 'frame', 'img-encoder', 'obj-ptrs'], edges: ['memory-bank>next', 'memory-bank>memory-attn', 'obj-ptrs>memory-attn'], tensors: ['bank-feats', 'ptr-tokens'],
          text: '<b>Frame 1</b>: el mismo encoder corre otra vez (es por frame). Lo nuevo: ahora el banco tiene algo que leer, aunque por ahora solo lo del frame 0 (' + q('tokens') + ' + ' + q('cfg.ptrSplit') + ' tokens). Lleno (en régimen), guarda ' + q('cfg.nMem') + ' memorias espaciales y ' + q('cfg.ptrs') + ' punteros: ' + q('cfg.Nm') + ' tokens de ' + q('cfg.memDim') + ' canales (<b>' + q('tensor.memory.shape') + '</b>, ' + q('metrics.memoryBankMem') + ', con sus posiciones).' },
        { expand: 'sam2-memory-attn', nodes: ['self-attn', 'cross-mem', 'mlp'], edges: ['x-in>self-attn', 'self-attn>cross-mem', 'mem-in>cross-mem', 'cross-mem>mlp'], tensors: ['ma-x0', 'memory'],
          text: 'En cada una de las ' + q('cfg.Lmem') + ' capas, los <b>' + q('tensor.ma-x0.shape') + '</b> tokens del frame se miran entre sí y después consultan la memoria (en el frame 1, solo la del frame 0; en régimen, con el banco lleno, K y V de <b>' + q('tensor.memory.shape') + '</b>, proyectados de 64 a 256). Esa cross-attention es lo que crece con N<sub>r</sub> y N<sub>p</sub>: con el banco lleno, la memory attention entera es ' + q('metrics.memAttnMacsShare') + ' de los MACs del frame.' },
        { nodes: ['mask-decoder', 'masks', 'occlusion', 'memory-encoder'], edges: ['memory-attn>mask-decoder', 'mask-decoder>masks', 'mask-decoder>memory-encoder', 'memory-encoder>memory-bank'], tensors: ['pix-mem', 'best-mask', 'mem-out'],
          text: 'Sin clic en el frame 1, el decoder igual encuentra el objeto: las features ya vienen condicionadas por la memoria. Su memoria entra a la cola (sale la más vieja si ya hay ' + q('cfg.memFrames') + ' recientes). Un frame con el banco lleno: ' + q('metrics.frameMacs') + '.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) una capa de la memory attention
  ATLAS.registerDiagram(Object.assign({
    id: 'sam2-memory-attn', model: 'sam2', config: C, kind: 'arch', title: 'Memory attention (una capa)',
    parent: 'sam2-overview', parentNode: 'memory-attn',
    caption: 'Una capa (hay 4), pre-LN. Los 4096 tokens del frame (64×64) se miran entre sí (self-attention con RoPE 2-D) y después consultan la memoria: "frame ← memoria" es una cross-attention con Q del frame y K, V de las memorias espaciales (N_r + N_p mapas de 64×64×64) y de los punteros de objeto (4 tokens de 64 por puntero). La flecha apunta al flujo que se actualiza: la memoria no cambia. Al final, un MLP.',
    grid: { w: 92, h: 62 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'layer', label: 'Capa', x: 2, y: 10, w: 88, h: 40, repeat: { sym: 'L_m', from: 'Lmem', tag: '× {v} capas', crumb: false } },
    ],
    nodes: [
      { id: 'x-in', op: 'io', modality: 'img', label: 'Frame t', sub: '64×64 → 4096 tokens', x: 6, y: 1, w: 30, h: 5, note: 'Las features de stride 16 del frame (de la FPN), aplanadas.' },
      { id: 'mem-in', op: 'io', label: 'Memoria', sub: 'mapas + punteros', x: 56, y: 1, w: 30, h: 5, note: 'Las memorias espaciales del banco (cada una 64×64×64, con su codificación temporal) y los punteros de objeto, concatenados como una sola secuencia de keys/values de 64 canales.' },
      { id: 'self-attn', scope: 'memory-attn', op: 'attn', label: 'Self-attention', sub: '1 cabeza · RoPE 2-D · pre-LN', x: 6, y: 14, w: 30, h: 7,
        tex: 'X \\leftarrow X + \\mathrm{SA}(\\mathrm{LN}(X))', note: 'Atención entre los 4096 tokens del frame, con posiciones rotatorias (RoPE) en 2-D.' },
      { id: 'cross-mem', scope: 'memory-attn', op: 'attn', label: 'Frame ← memoria', sub: '1 cabeza · K,V: memoria', x: 6, y: 27, w: 30, h: 7,
        tex: 'X \\leftarrow X + \\mathrm{Attn}(Q{=}\\mathrm{LN}(X),\\, K, V{=}\\mathcal{M})', note: 'Cross-attention: cada token del frame consulta todas las memorias. K y V se proyectan de 64 a 256 canales. RoPE se aplica a las memorias espaciales, no a los punteros. Su costo crece con el número de memorias: es la parte de SAM 2 que depende de N<sub>r</sub> y N<sub>p</sub>.' },
      { id: 'mlp', scope: 'memory-attn', op: 'mlp', label: 'MLP', sub: '256 → 2048 → 256', x: 6, y: 40, w: 30, h: 7,
        tex: 'X \\leftarrow X + \\mathrm{MLP}(\\mathrm{LN}(X))', note: 'Un MLP por token, como en cualquier bloque de transformer.' },
      { id: 'out', op: 'io', modality: 'img', label: 'Frame condicionado', sub: '→ mask decoder', x: 6, y: 55, w: 30, h: 5, note: 'Las features del frame ya "informadas" por la memoria: entran al decoder en lugar del embedding de SAM.' },
    ],
    edges: [
      { from: 'x-in', to: 'self-attn', kind: 'data', tensor: 'ma-x0', labelT: 0.3 },
      { from: 'self-attn', to: 'cross-mem', kind: 'data', tensor: 'ma-r1', label: false },
      { from: 'cross-mem', to: 'mlp', kind: 'data', tensor: 'ma-r2', label: false },
      { from: 'mlp', to: 'out', kind: 'data', tensor: 'pix-mem', labelT: 0.75 },
      { from: 'mem-in', to: 'cross-mem', kind: 'cross', tensor: 'memory', fromSide: 'bottom', toSide: 'right', fromAt: 0.5, labelSeg: 0, labelSide: 'left', labelT: 0.55, tag: 'K,V: memoria', tagSeg: 1, tagT: 0.5, tagSide: 'on' },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
