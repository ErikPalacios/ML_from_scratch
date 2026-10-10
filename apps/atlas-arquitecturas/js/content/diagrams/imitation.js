/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/imitation.js
   Diagramas de imitation learning (SPEC §7.2, ids de §27.2), modelo `imitation` (js/arch/robotlearn.js):
     act-overview      ACT (config act-aloha, inferencia): 4 cámaras → el MISMO ResNet-18 (× cámaras) → conv 1×1 → tokens de imagen
                       (+ PE seno 2-D); articulaciones → Linear; estilo z (= 0 al inferir) → Linear; todo en una secuencia →
                       encoder (× L_e) → memoria → decoder con k queries (× L_d; el código oficial usa solo la salida de la 1.ª
                       capa) → Linear D → 14 → chunk k × 14 → temporal ensembling → una acción por paso → robot (↻ 50 Hz).
                       Abajo, los MACs por inferencia: la visión domina.
       act-cvae        (desde el nodo latent; config act-aloha-train) entrenamiento: el encoder CVAE lee [CLS] + articulaciones + la
                       secuencia de k acciones de la demo → μ, log σ² → z = μ + σ·ε → la política → L1 con la demo + β·KL. Al
                       inferir, z = 0 (la media del prior) y el encoder CVAE no corre.
     diffusion-policy  Diffusion Policy CNN (config diffusion-policy-cnn): cámaras × T_o → ResNet-18 (GroupNorm) + spatial softmax
                       (uno por cámara) → condición global; acciones ruidosas T_p × d_a + el paso k → U-Net 1-D temporal con FiLM →
                       ε̂ → paso DDIM (↻ × K) → chunk T_p × d_a → se ejecutan T_a → receding horizon. Abajo, MACs: × K pasos.
   Notas, captions y recorridos con claves SIN prefijo ({{metrics.x}}, {{cfg.x}}): siguen la config dibujada.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas, parámetros y MACs: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'act-aloha', CT = 'act-aloha-train', CD = 'diffusion-policy-cnn';
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 'imitation', section: 'diagrama' };
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-zθφ0-9]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };
  const ENC_MINI = { items: [{ label: 'self', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }, { label: 'LN', op: 'norm' }], res: [[0, 1], [3, 4]] };
  const DEC_MINI = { items: [{ label: 'self', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'cross', op: 'attn' }, { sym: 'add' }, { label: 'LN', op: 'norm' }, { label: 'FFN', op: 'mlp' }, { sym: 'add' }, { label: 'LN', op: 'norm' }], res: [[0, 1], [3, 4], [6, 7]] };

  // ------------------------------------------------------------------ (a) ACT — vista general (inferencia)
  register(Object.assign({
    id: 'act-overview', model: 'imitation', config: C, configs: [C], configsNote: 'es la arquitectura de ACT', kind: 'arch', title: 'ACT — vista general',
    caption: 'ACT (Action Chunking with Transformers) es un DETR que predice acciones. Cada cámara pasa por el MISMO ResNet-18 y una conv 1×1 lleva sus 512 canales al ancho D: cada posición del mapa es un token. Se suman las articulaciones del robot (un token) y el "estilo" z del CVAE (otro token; al inferir, z = 0). El encoder mezcla todo; el decoder tiene k queries aprendidas, una por acción futura, que leen la memoria (K, V) y salen como un chunk de k acciones de 14 números (las dos manos de ALOHA). Cada paso de control llega un chunk nuevo que se solapa con los anteriores: temporal ensembling promedia las predicciones para el paso actual. Más de la mitad del cómputo es la visión ({{metrics.visionMacsShare}}): {{cfg.cams}} cámaras de {{cfg.H}}×{{cfg.W}}.',
    grid: { w: 192, h: 94 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['input-proj', 'tokens', 'encoder'], mobileFocusPad: 2, blankCrop: true,
    edgeLegend: { cross: 'Cross-attention: las queries leen la memoria (K, V)', query: 'Queries aprendidas (una por acción del chunk)', control: 'Bucle de control (cada paso, 50 Hz)' },
    legendText: { runs: 'Veces que corre por inferencia', runsOnce: 'Veces que corre por inferencia', loop: 'Bucle: cada paso de control', costSplit: 'MACs por inferencia: ancho proporcional (del calculador)' },
    groups: [
      { id: 'enc-stack', label: 'Encoder (post-LN)', x: 110, y: 21, w: 34, h: 22, repeat: { sym: 'L_e', from: 'Lenc', totalOf: 'encoder' }, modality: 'img' },
      { id: 'dec-stack', label: 'Decoder (post-LN)', x: 152, y: 21, w: 38, h: 22, repeat: { sym: 'L_d', from: 'Ldec', totalOf: 'decoder' }, modality: 'qry' },
    ],
    nodes: [
      { id: 'cameras', op: 'io', image: true, imageGrid: 0, parallel: 'cfg.cams', label: 'Cámaras', x: 2, y: 3, w: 16, h: 17,
        note: '{{cfg.cams}} cámaras de {{cfg.H}}×{{cfg.W}} (ALOHA: una arriba, una de frente y una en cada muñeca), una imagen por paso de control.' },
      { id: 'backbone', op: 'conv', style: 'block', costOf: 'backbone', label: 'ResNet-18', sub: 'por cámara · BN congelada', subNum: 'por cámara → {{tensor.c5.shape}}', runs: '× {{cfg.cams}} cámaras', runsTone: 'once', x: 31, y: 4.5, w: 30, h: 14,
        xref: [{ href: '#detr.diagrama~backbone', label: 'El backbone de DETR (la misma idea, con ResNet-50)' }],
        costNote: 'Parámetros: los de UNA red (todas las cámaras la comparten). MACs: × {{cfg.cams}} (una pasada por cámara).',
        note: 'Un ResNet-18 de ImageNet sin avgpool ni fc, con BatchNorm congelada (FrozenBatchNorm2d); en el código oficial es UNO solo, compartido por las cámaras (backbones[0]). Stride 32: cada imagen sale como un mapa de {{tensor.c5.shape}}. Corre {{cfg.cams}} veces por inferencia: es el grueso del cómputo ({{metrics.visionMacsShare}} de los MACs).' },
      { id: 'input-proj', op: 'conv', costOf: 'input-proj', label: 'Conv 1×1', sub: '512 → D', subNum: '512 → {{cfg.D}}', x: 64, y: 6.5, w: 18, h: 10,
        note: 'Una conv 1×1 lleva los 512 canales al ancho D = {{cfg.D}} del transformer (la misma para todas las cámaras).' },
      { id: 'pos-enc', op: 'embed', ops: ['pos-enc'], opsExact: true, label: 'Posición 2-D', sub: 'seno, fija', x: 64, y: 21, w: 18, h: 7,
        note: 'La codificación posicional de DETR (seno 2-D, D/2 canales por eje, sin parámetros), una por posición de cada mapa. Como en DETR, se suma a Q y K dentro de cada capa (nunca a V).' },
      { id: 'cam-concat', op: 'tensorop', shape: 'concat', ops: ['cam-concat'], opsExact: true, label: 'Tokens de imagen', labelPos: 'right', x: 96, y: 9, w: 5, h: 5,
        note: 'Los mapas de las {{cfg.cams}} cámaras, aplanados y puestos uno al lado del otro: {{tensor.img-tokens.shape}} tokens de imagen. Sin parámetros.' },
      { id: 'joints', op: 'io', modality: 'act', label: 'Articulaciones', sub: 'q_t (posiciones)', subNum: 'q_t: {{tensor.qpos.shape}}', x: 2, y: 30, w: 16, h: 9,
        note: 'Las posiciones articulares actuales de los dos brazos: 14 números (6 articulaciones + pinza, por brazo).' },
      { id: 'proprio-proj', op: 'embed', costOf: 'proprio-proj', label: 'Linear 14 → D', sub: 'un token', x: 31, y: 30.5, w: 30, h: 8,
        note: 'Las articulaciones en un solo token de ancho D (más su posición aprendida: <code>additional_pos_embed</code>).' },
      { id: 'latent', op: 'io', modality: 'lat', ops: ['latent-z'], opsExact: true, label: 'Estilo z', sub: 'cero al inferir', expand: 'act-cvae', x: 2, y: 43, w: 16, h: 10,
        note: 'El latente del CVAE ({{metrics.latentDim}} números): en el entrenamiento lo da un encoder que mira la secuencia de acciones de la demo (el "estilo" con que la persona hizo la tarea); al inferir se usa z = 0, la media del prior. Ábrelo para ver el entrenamiento.' },
      { id: 'latent-proj', op: 'embed', costOf: 'latent-proj', label: 'Linear 32 → D', sub: 'un token', x: 31, y: 44, w: 30, h: 8,
        note: 'z en un token de ancho D (con su posición aprendida).' },
      { id: 'tokens', op: 'tensorop', shape: 'concat', ops: ['tokens'], opsExact: true, label: 'Secuencia', labelPos: 'below', x: 96, y: 29.5, w: 5, h: 5,
        note: '[z, articulaciones, tokens de imagen]: {{tensor.src.shape}}. Sin parámetros.' },
      { id: 'encoder', op: 'attn', style: 'block', costOf: 'encoder', label: 'Capa del encoder', mini: ENC_MINI, x: 113, y: 27, w: 28, h: 12,
        tex: "x' = \\mathrm{LN}(x + \\mathrm{SA}(x{+}P)),\\ \\ x'' = \\mathrm{LN}(x' + \\mathrm{FFN}(x'))",
        note: 'Una capa post-LN como la de DETR: self-attention entre los {{metrics.tokens}} tokens (D = {{cfg.D}}, {{cfg.h}} cabezas) y una FFN de {{cfg.Dmlp}} con ReLU. {{cfg.Lenc}} capas.' },
      { id: 'queries', op: 'embed', modality: 'qry', ops: ['query-embed'], opsExact: true, label: 'k queries', sub: 'k × D, aprendidas', subNum: '{{cfg.chunk}} × {{cfg.D}}, aprendidas', x: 157, y: 6, w: 28, h: 9,
        note: 'Una query aprendida por acción futura del chunk (k = {{cfg.chunk}}). Como en DETR, el contenido del decoder arranca en cero y las queries se suman como posición en cada capa.' },
      { id: 'decoder', op: 'attn', style: 'block', costOf: 'decoder', label: 'Capa del decoder', mini: DEC_MINI, runs: 'se usa la 1.ª de {{cfg.Ldec}}', runsTone: 'once', x: 155, y: 27, w: 32, h: 12,
        tex: "t' = \\mathrm{LN}(t + \\mathrm{SA}),\\ t'' = \\mathrm{LN}(t' + \\mathrm{CA}(t', m)),\\ t''' = \\mathrm{LN}(t'' + \\mathrm{FFN})",
        note: 'Self-attention entre las k queries, cross-attention a la memoria del encoder y FFN, post-LN. Detalle del código oficial: el transformer devuelve la salida de cada capa (<code>return_intermediate</code>) y <code>detr_vae.py</code> toma <code>hs[0]</code>, la de la PRIMERA: las otras capas (de {{metrics.decoderLayers}}) se calculan y se tiran ({{metrics.deadDecoderMacs}}, {{metrics.deadDecoderShare}} de la inferencia). LeRobot usa 1 capa de decoder por eso.' },
      { id: 'action-head', op: 'head', costOf: 'action-head', label: 'Linear D → 14', sub: '(+ relleno: D → 1)', x: 157, y: 51, w: 28, h: 8,
        tex: '\\hat{\\mathbf A}_t = \\mathrm{LN}\\big(Y^{(1)}\\big)\\,W_a + \\mathbf b_a \\in \\mathbb R^{k \\times 14}',
        note: 'Una lineal por query: 14 números por acción (posiciones objetivo de las articulaciones), sobre la salida de la PRIMERA capa del decoder (<code>hs[0]</code>, con la LayerNorm final del decoder), no de la última. Otra lineal D → 1 predice si la acción es relleno (fin del episodio).' },
      { id: 'ensemble', op: 'tensorop', shape: 'rect', ops: ['ensemble'], opsExact: true, label: 'Temporal ensembling', sub: 'Σ_i w_i·â_t⁽ⁱ⁾ / Σ_i w_i', x: 157, y: 66, w: 28, h: 10,
        tex: 'a_t = \\frac{\\sum_i w_i\\, \\hat a_t^{(i)}}{\\sum_i w_i},\\ \\ w_i = e^{-m\\, i}', note: 'Con un chunk nuevo en CADA paso, el paso t tiene hasta k predicciones (de las últimas k inferencias). Se promedian con pesos exponenciales w_i = exp(−m·i), m = 0.01, con i = 0 la predicción MÁS VIEJA (así la más vieja pesa más): movimiento suave, sin saltos entre chunks. Sin ensembling se ejecutan las k acciones y se infiere cada k pasos.' },
      { id: 'robot', op: 'io', modality: 'act', label: 'Robot', sub: 'una acción por paso', subNum: '{{metrics.controlHz}} Hz', x: 114, y: 66.5, w: 24, h: 9,
        note: 'Se ejecuta una acción por paso de control ({{metrics.controlHz}} Hz). Con temporal ensembling hay que inferir en cada paso: {{metrics.inferenceHz}} inferencias por segundo; sin él (ejecutar el chunk entero), {{metrics.inferenceHzNoTE}}.' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'MACs por inferencia', x: 2, y: 79.5, w: 106, h: 14,
        costSplit: { segs: [
          { op: 'conv', n: 'metrics.visionMacs', label: 'Visión: ResNet-18 × {{cfg.cams}}' },
          { op: 'attn', n: 'metrics.encoderMacs', label: 'Encoder ({{metrics.tokens}} tokens)' },
          { op: 'fuse', n: 'metrics.decoderMacs', label: 'Decoder (todas las capas)' },
        ], legendSegs: true, caption: 'total {{metrics.macsPerInference}} por chunk de {{cfg.chunk}} acciones · la visión es {{metrics.visionMacsShare}}' },
        note: 'MACs de una inferencia, del calculador. El ResNet-18 corre una vez por cámara sobre imágenes de {{cfg.H}}×{{cfg.W}}: más de la mitad del costo ({{metrics.visionMacsShare}}). El decoder cuenta sus {{cfg.Ldec}} capas, aunque solo se usa la salida de la primera.' },
    ],
    edges: [
      { from: 'cameras', to: 'backbone', kind: 'data', tensor: 'img', toAt: 0.5, labelSide: 'above', labelT: 0.66 },
      { from: 'backbone', to: 'input-proj', kind: 'data', tensor: 'c5', label: false },
      { from: 'input-proj', to: 'cam-concat', kind: 'data', tensor: 'feat', fromAt: 0.5, labelSide: 'above', labelT: 0.5 },
      { from: 'pos-enc', to: 'cam-concat', kind: 'data', tensor: 'pos-cam', toSide: 'bottom', fromAt: 0.5, label: false, tag: 'P', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 },
      { from: 'cam-concat', to: 'tokens', kind: 'data', tensor: 'img-tokens', fromSide: 'bottom', toSide: 'top', labelSide: 'right', labelT: 0.6 },
      { from: 'joints', to: 'proprio-proj', kind: 'data', tensor: 'qpos', label: false },
      { from: 'proprio-proj', to: 'tokens', kind: 'data', tensor: 'proprio-tok', toAt: 0.5, labelSide: 'above', labelT: 0.6 },
      { from: 'latent', to: 'latent-proj', kind: 'data', tensor: 'z', label: false },
      { from: 'latent-proj', to: 'tokens', kind: 'data', tensor: 'latent-tok', toSide: 'left', toAt: 0.85, labelSide: 'below', labelSeg: 0, labelT: 0.6 },
      { from: 'tokens', to: 'encoder', kind: 'data', tensor: 'src', labelSide: 'above', labelT: 0.6 },
      { from: 'encoder', to: 'decoder', kind: 'cross', tensor: 'memory', label: false, tag: 'K, V', tagSide: 'above', tagT: 0.5 },
      { from: 'queries', to: 'decoder', kind: 'query', tensor: 'query-pos', label: false },
      { from: 'decoder', to: 'action-head', kind: 'data', tensor: 'hs', fromSide: 'bottom', toSide: 'top', labelSide: 'right', labelT: 0.75 },
      { from: 'action-head', to: 'ensemble', kind: 'data', tensor: 'actions', fromSide: 'bottom', toSide: 'top', labelSide: 'right', labelT: 0.5, tag: 'chunk', tagStyle: 'plain', tagSide: 'left', tagT: 0.5 },
      { from: 'ensemble', to: 'robot', kind: 'data', tensor: 'action', labelSide: 'above', labelT: 0.5 },
      { from: 'robot', to: 'joints', kind: 'control', fromSide: 'bottom', toSide: 'left', fromAt: 0.5, toAt: 0.5, via: [[126, 77.8], [0.6, 77.8], [0.6, 34.5]], loop: true, tag: 'paso siguiente: observaciones nuevas', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.82 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (ACT, una inferencia)', steps: [
        { nodes: ['cameras', 'backbone', 'input-proj'], edges: ['cameras>backbone', 'backbone>input-proj', 'input-proj>cam-concat'], tensors: ['img', 'c5', 'feat'],
          text: 'Cada cámara (<b>' + q('tensor.img.shape') + '</b>) pasa por el mismo ResNet-18: <b>' + q('tensor.c5.shape') + '</b>; la conv 1×1 la lleva a <b>' + q('tensor.feat.shape') + '</b>. Son ' + q('metrics.visionMacs') + ' con las ' + q('cfg.cams') + ' cámaras.' },
        { nodes: ['cam-concat', 'pos-enc'], edges: ['pos-enc>cam-concat', 'cam-concat>tokens'], tensors: ['img-tokens'],
          text: 'Las ' + q('cfg.cams') + ' rejillas aplanadas y juntas: <b>' + q('tensor.img-tokens.shape') + '</b> tokens de imagen, cada uno con su posición 2-D.' },
        { nodes: ['joints', 'proprio-proj', 'latent', 'latent-proj', 'tokens'], edges: ['joints>proprio-proj', 'proprio-proj>tokens', 'latent>latent-proj', 'latent-proj>tokens'], tensors: ['qpos', 'z', 'proprio-tok', 'latent-tok'],
          text: 'Dos tokens más: las articulaciones (<b>' + q('tensor.qpos.shape') + '</b>) y el estilo z (ceros al inferir). La secuencia: <b>' + q('tensor.src.shape') + '</b>.' },
        { nodes: ['encoder'], edges: ['tokens>encoder'], tensors: ['src'],
          text: q('cfg.Lenc') + ' capas de encoder sobre los ' + q('metrics.tokens') + ' tokens: ' + q('metrics.encoderMacs') + '. La memoria sale con la misma forma.' },
        { nodes: ['queries', 'decoder'], edges: ['queries>decoder', 'encoder>decoder'], tensors: ['memory', 'query-pos'],
          text: q('cfg.chunk') + ' queries (una por acción futura) leen la memoria por cross-attention. Se calculan ' + q('cfg.Ldec') + ' capas, pero el código usa la salida de la primera.' },
        { nodes: ['action-head', 'ensemble', 'robot'], edges: ['decoder>action-head', 'action-head>ensemble', 'ensemble>robot', 'robot>joints'], tensors: ['hs', 'actions', 'action'],
          text: 'Una lineal da el chunk <b>' + q('tensor.actions.shape') + '</b>; temporal ensembling promedia las predicciones solapadas para el paso actual y el robot ejecuta <b>' + q('tensor.action.shape') + '</b>. Con ensembling, una inferencia por paso: ' + q('metrics.inferenceHz') + ' por segundo.' },
        { nodes: ['cost'], edges: [], tensors: [],
          text: 'Una inferencia: ' + q('metrics.macsPerInference') + '. La visión es ' + q('metrics.visionMacsShare') + ': achicar las imágenes o compartir cámaras ahorra más que tocar el transformer.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) ACT — el CVAE (entrenamiento vs inferencia)
  register(Object.assign({
    id: 'act-cvae', model: 'imitation', config: CT, configs: [CT], configsNote: 'es el entrenamiento: config act-aloha-train', kind: 'arch', title: 'ACT — el CVAE: z al entrenar y al inferir',
    parent: 'act-overview', parentNode: 'latent',
    caption: 'Las demostraciones humanas no son todas iguales: la misma tarea se hace con distintos "estilos". ACT lo modela como un VAE condicional. Al entrenar, un encoder transformer aparte lee un token [CLS], las articulaciones y la secuencia de k acciones de la demo, y del [CLS] salen μ y log σ² de una gaussiana; z = μ + σ·ε entra a la política, que reconstruye las acciones (pérdida L1) mientras un KL empuja q(z) hacia N(0, I) (peso β). Al inferir no hay demo: z = 0 (la media del prior) y el encoder CVAE no corre.',
    grid: { w: 170, h: 66 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['cv-encoder', 'cv-head', 'cv-reparam'], mobileFocusPad: 2, blankCrop: true,
    edgeLegend: { control: 'Objetivo, KL o z = 0 (sin tensor propio)' },
    legendText: { ghost: 'Contorno punteado: no corre al desplegar' },
    groups: [
      { id: 'cv-train', style: 'lane', tone: 'warn', label: 'Entrenamiento: con la secuencia de acciones de la demo', legend: 'Marco ámbar: solo al entrenar', x: 0.5, y: 0.5, w: 169, h: 45, hideInBlank: true },
      { id: 'cv-infer', style: 'lane', tone: 'accent', label: 'Inferencia', legend: 'Marco azul: al inferir', labelPos: 'bottom', x: 0.5, y: 48, w: 169, h: 17.5, hideInBlank: true },
      { id: 'cv-enc-stack', label: 'Capas del encoder CVAE', x: 62, y: 9, w: 32, h: 20, repeat: { sym: 'L_e', from: 'Lenc', totalOf: 'cv-encoder' } },
    ],
    nodes: [
      { id: 'cv-actions', op: 'io', modality: 'act', label: 'Acciones de la demo', sub: 'k × 14', x: 3, y: 5, w: 22, h: 9,
        note: 'La secuencia de las próximas k = {{cfg.chunk}} acciones grabadas en la demostración: es lo que la política tiene que reproducir y, al entrenar, también lo que mira el encoder CVAE.' },
      { id: 'cv-joints', op: 'io', modality: 'act', label: 'Articulaciones', sub: 'q_t (14)', x: 3, y: 19, w: 22, h: 8, note: 'Las articulaciones actuales (sin imágenes: el encoder CVAE no ve las cámaras).' },
      { id: 'cv-in', op: 'tensorop', shape: 'concat', costOf: 'cvae-in', label: '[CLS] + q + a', labelPos: 'left', x: 39, y: 14, w: 5, h: 5,
        note: 'Un token [CLS] aprendido, las articulaciones y las k acciones, cada una proyectada a D con su lineal, más una posición seno fija: (1 + 1 + k) tokens. El [CLS] y las dos lineales suman {{node.cvae-in.params}} parámetros (el círculo no lleva insignia).' },
      { id: 'cv-encoder', op: 'attn', style: 'block', costOf: 'cvae-encoder', label: 'Capa del encoder', mini: ENC_MINI, x: 64, y: 15, w: 28, h: 11,
        note: 'Un transformer encoder aparte (las mismas dimensiones que el de la política, {{cfg.Lenc}} capas: {{node.cvae-encoder.params}} parámetros). Con las proyecciones de entrada, el [CLS] y la cabeza de μ, log σ², el CVAE suma {{metrics.cvaeParams}} parámetros que solo existen al entrenar.' },
      { id: 'cv-head', op: 'head', costOf: 'latent-head', label: 'Linear D → 2·32', sub: 'μ, log σ² (del [CLS])', x: 101, y: 14, w: 24, h: 9,
        note: 'De la salida del token [CLS] sale la media y el log de la varianza de q(z | acciones, q_t): {{metrics.latentDim}} cada una.' },
      { id: 'cv-reparam', op: 'tensorop', shape: 'rect', ops: ['reparam'], opsExact: true, label: 'z = μ + σ·ε', sub: 'ε ~ N(0, I)', x: 133, y: 14, w: 20, h: 9,
        tex: 'z = \\mu + \\sigma \\odot \\varepsilon,\\ \\ \\varepsilon \\sim \\mathcal{N}(0, I)', note: 'El truco de reparametrización: el sorteo queda en ε y el gradiente pasa por μ y σ.' },
      { id: 'cv-policy', op: 'attn', style: 'block', costOf: 'cv-policy-none', label: 'Política ACT', sub: 'la vista general (z → token)', x: 133, y: 31, w: 34, h: 11,
        note: 'La red de la vista general: cámaras, articulaciones y el token de z → encoder → decoder → chunk de k acciones.' },
      { id: 'cv-loss', op: 'head', costOf: 'loss', label: 'L1 + β·KL', sub: '‖â − a‖₁ + β·KL(q ‖ N(0, I))', x: 92, y: 32, w: 32, h: 9,
        tex: '\\mathcal{L} = \\tfrac{1}{k}\\textstyle\\sum \\lVert \\hat a - a \\rVert_1 + \\beta\\, D_{KL}\\big(\\mathcal{N}(\\mu, \\sigma^2) \\,\\Vert\\, \\mathcal{N}(0, I)\\big)',
        note: 'Reconstrucción L1 de las k acciones (ignorando las de relleno) y el KL hacia el prior, con β = {{metrics.klWeight}} (el <code>--kl_weight</code> del README). Un β grande obliga a que z lleve poca información: la política no puede "copiar" la respuesta desde z.' },
      { id: 'cv-off', op: 'attn', style: 'block', ghost: true, costOf: 'cv-policy-none', label: 'Encoder CVAE: no corre', sub: 'sus parámetros quedan sin usar', subNum: '{{metrics.cvaeParams}} parámetros sin usar', x: 60, y: 52, w: 36, h: 9,
        note: 'Al desplegar, el encoder CVAE (las proyecciones, el [CLS], sus {{cfg.Lenc}} capas y la cabeza de μ, log σ²) no se ejecuta: {{metrics.cvaeParams}} parámetros que el checkpoint trae pero la inferencia no usa.' },
      { id: 'cv-zero', op: 'io', modality: 'lat', label: 'z = 0', sub: 'la media del prior', x: 101, y: 52, w: 22, h: 9, note: 'Al desplegar no hay acciones de la demo: se usa z = 0. El encoder CVAE no corre.' },
      { id: 'cv-policy-inf', op: 'attn', style: 'block', costOf: 'cv-policy-none', label: 'Política ACT', sub: 'solo esta red al desplegar', x: 133, y: 51, w: 34, h: 11,
        note: 'La misma red, con el token de z en cero. Lo que se despliega: la política sin el encoder CVAE.' },
    ],
    edges: [
      { from: 'cv-actions', to: 'cv-in', kind: 'data', tensor: 'action-seq', toSide: 'top', labelSide: 'above', labelSeg: 0, labelT: 0.5 },
      { from: 'cv-joints', to: 'cv-in', kind: 'data', tensor: 'qpos', toSide: 'bottom', label: false },
      { from: 'cv-in', to: 'cv-encoder', kind: 'data', tensor: 'cvae-in', labelSide: 'above', labelT: 0.5 },
      { from: 'cv-encoder', to: 'cv-head', kind: 'data', tensor: 'cvae-cls-out', label: false },
      { from: 'cv-head', to: 'cv-reparam', kind: 'data', tensor: 'mu', label: false },
      { from: 'cv-reparam', to: 'cv-policy', kind: 'data', tensor: 'z', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.588, labelSide: 'right', labelT: 0.5 },
      { from: 'cv-policy', to: 'cv-loss', kind: 'data', tensor: 'actions', labelSide: 'above', labelT: 0.5, tag: 'â', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'cv-actions', to: 'cv-loss', kind: 'control', fromSide: 'left', toSide: 'left', fromAt: 0.5, toAt: 0.5, via: [[1.6, 9.5], [1.6, 36.5]], tag: 'a (objetivo)', tagStyle: 'plain', tagSide: 'on', tagSeg: 2, tagT: 0.5 },
      { from: 'cv-head', to: 'cv-loss', kind: 'control', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.69, tag: 'KL', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'cv-zero', to: 'cv-policy-inf', kind: 'control', tag: 'z = 0', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido: z al entrenar y al inferir', steps: [
        { nodes: ['cv-actions', 'cv-joints', 'cv-in'], edges: ['cv-actions>cv-in', 'cv-joints>cv-in'], tensors: ['action-seq', 'qpos'],
          text: 'Al entrenar, el encoder CVAE ve la respuesta: las próximas <b>' + q('tensor.action-seq.shape') + '</b> acciones de la demo, más las articulaciones y un [CLS].' },
        { nodes: ['cv-encoder', 'cv-head', 'cv-reparam'], edges: ['cv-in>cv-encoder', 'cv-encoder>cv-head', 'cv-head>cv-reparam'], tensors: ['cvae-in', 'mu', 'z'],
          text: 'Del [CLS] salen μ y log σ² (' + q('metrics.latentDim') + ' cada uno) y se sortea z = μ + σ·ε.' },
        { nodes: ['cv-policy', 'cv-loss'], edges: ['cv-reparam>cv-policy', 'cv-policy>cv-loss', 'cv-actions>cv-loss', 'cv-head>cv-loss'], tensors: ['z', 'actions'],
          text: 'La política reconstruye las acciones con L1; el KL (β = ' + q('metrics.klWeight') + ') mantiene z cerca de N(0, I).' },
        { nodes: ['cv-zero', 'cv-policy-inf'], edges: ['cv-zero>cv-policy-inf'], tensors: [],
          text: 'Al desplegar: z = 0, sin encoder CVAE. Se ahorran sus ' + q('metrics.cvaeParams') + ' parámetros.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (c) Diffusion Policy (CNN)
  register(Object.assign({
    id: 'diffusion-policy', model: 'imitation', config: CD, configs: [CD], configsNote: 'es la versión CNN (U-Net 1-D)', kind: 'arch', title: 'Diffusion Policy — vista general',
    caption: 'Diffusion Policy genera el chunk de acciones como Stable Diffusion genera una imagen: parte de ruido y lo limpia en K pasos. Las observaciones (T_o imágenes por cámara y la pose del efector) se codifican UNA vez por inferencia: un ResNet-18 con GroupNorm y spatial softmax por cámara → un vector de condición. En el bucle, un U-Net 1-D sobre el eje del tiempo del chunk (T_p acciones) recibe las acciones ruidosas y, por FiLM, la condición y el paso k; predice el ruido ε̂ y un paso DDIM lo resta. Tras K pasos quedan T_p acciones: se ejecutan T_a, desde la que corresponde al paso actual (índice T_o − 1), y se vuelve a inferir con observaciones nuevas (receding horizon). Cada paso de denoising es otra pasada del U-Net.',
    grid: { w: 182, h: 92 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['dp-noise', 'dp-cond', 'dp-unet', 'dp-ddim'], mobileFocusPad: 2, blankCrop: true,
    edgeLegend: { control: 'Bucle: el chunk vuelve a entrar (× K) / receding horizon' },
    legendText: { runs: 'Veces que corre por inferencia (en el bucle)', runsOnce: 'Veces que corre por inferencia (fuera del bucle)', loop: 'Bucle de denoising (× K) o de control', costSplit: 'MACs por inferencia: ancho proporcional (del calculador)' },
    groups: [
      { id: 'dp-loop', style: 'lane', tone: 'accent', label: 'Bucle de denoising: × K = {{metrics.steps}} pasos', legend: 'Marco azul: corre en cada paso de denoising', labelPos: 'bottom', x: 1, y: 34, w: 150, h: 34, hideInBlank: true },
    ],
    nodes: [
      { id: 'dp-cams', op: 'io', image: true, imageGrid: 0, parallel: 'cfg.cams', label: 'Cámaras × T_o', x: 2, y: 3, w: 16, h: 17,
        note: '{{cfg.cams}} cámaras, y de cada una las últimas T_o = {{metrics.obsSteps}} imágenes ({{cfg.H}}×{{cfg.W}} tras el recorte).' },
      { id: 'dp-encoder', op: 'conv', style: 'block', costOf: 'obs-encoder', label: 'ResNet-18 + spatial softmax', sub: 'GroupNorm · uno por cámara', runs: '× {{cfg.cams}} cám. × T_o', runsTone: 'once', x: 31, y: 4, w: 34, h: 14,
        costNote: 'Parámetros: un encoder por cámara ({{cfg.cams}}, sin compartir pesos). MACs: × cámaras × Tₒ (pasos de observación).',
        note: 'Un ResNet-18 sin avgpool ni fc, con GroupNorm en vez de BatchNorm (BN se lleva mal con el EMA de los pesos que usa la difusión), y spatial softmax: 32 "keypoints" (x, y) esperados de 32 mapas de activación, en vez de un pooling global; una lineal los lleva a 64. Corre una vez por inferencia, fuera del bucle.' },
      { id: 'dp-eef', op: 'io', modality: 'act', label: 'Pose del efector', sub: 'T_o × 2', x: 2, y: 23, w: 16, h: 8, note: 'La posición del efector (x, y) en las T_o observaciones: lo "propioceptivo" en Push-T.' },
      { id: 'dp-obs', op: 'tensorop', shape: 'concat', ops: ['obs-concat'], opsExact: true, label: 'Condición de la obs.', labelPos: 'right', x: 72, y: 22.5, w: 5, h: 5,
        note: 'Las features de cada cámara (64) y la pose (2) de los T_o pasos, en un vector: {{tensor.obs-cond.shape}} (<code>global_cond</code>). Se calcula UNA vez por inferencia.' },
      { id: 'dp-noise', op: 'io', modality: 'lat', label: 'Acciones ruidosas', sub: 'x_k: T_p × d_a', subNum: 'x_k: {{tensor.noisy-actions.shape}}', x: 4, y: 51, w: 22, h: 10,
        note: 'El chunk de T_p = {{cfg.chunk}} acciones de d_a números. Al empezar es ruido puro N(0, I); cada paso DDIM lo reemplaza por uno más limpio.' },
      { id: 'dp-time', op: 'embed', costOf: 'time-embed', perPass: true, label: 'Paso k', sub: 'sinusoidal → MLP', x: 4, y: 38.5, w: 22, h: 9,
        costNote: 'Por pasada; corre {{metrics.steps}} veces por inferencia. Es parte del U-Net (diffusion_step_encoder): sus parámetros ya están en la insignia del U-Net.',
        note: 'El índice del paso de difusión, en senos y cosenos y un MLP (Mish), como el timestep de Stable Diffusion: {{tensor.t-emb.shape}}.' },
      { id: 'dp-cond', op: 'tensorop', shape: 'concat', costOf: 'cond', label: 'Condición', labelPos: 'below', x: 46, y: 40.5, w: 5, h: 5,
        note: 'El paso k y la condición de la observación, juntos: {{tensor.cond.shape}}. Entra a cada bloque del U-Net por FiLM.' },
      { id: 'dp-unet', op: 'conv', style: 'block', costOf: 'unet', perPass: true, label: 'U-Net 1-D temporal', sub: 'conv 1-D sobre el eje del chunk\nFiLM: γ(c)·h + β(c)', runs: '× K = {{metrics.steps}} pasos', x: 62, y: 38, w: 40, h: 22,
        costNote: 'Por pasada; corre {{metrics.steps}} veces por inferencia (una por paso de denoising), con los mismos pesos.',
        tex: '\\hat\\varepsilon = \\varepsilon_\\theta(x_k,\\ k,\\ o),\\ \\ \\mathrm{FiLM}(h) = \\gamma(c) \\odot h + \\beta(c)',
        note: 'Un U-Net de convoluciones 1-D sobre el eje del tiempo del chunk (T_p = {{cfg.chunk}} → 8 → 4 posiciones, con 256 / 512 / 1024 canales y skips), con bloques residuales (conv, GroupNorm, Mish). La condición no entra como tokens: cada bloque la convierte en una escala γ y un sesgo β por canal (FiLM). Predice el ruido ε̂ con la forma del chunk. Una pasada cuesta {{metrics.stepMacs}} y corre una vez por paso: × {{metrics.steps}} = {{metrics.denoiseMacs}}. Con estos pocos pasos DDIM pesa menos que el encoder (que corre {{cfg.cams}} cámaras × T_o imágenes); con los {{metrics.trainSteps}} pasos del entrenamiento, el bucle dominaría.' },
      { id: 'dp-ddim', op: 'tensorop', shape: 'rect', ops: ['ddim-step'], opsExact: true, label: 'Paso DDIM', sub: 'x_{k−1} = f(x_k, ε̂)', x: 112, y: 44, w: 22, h: 10,
        tex: 'x_{k-1} = \\sqrt{\\bar\\alpha_{k-1}}\\,\\hat x_0 + \\sqrt{1-\\bar\\alpha_{k-1}}\\,\\hat\\varepsilon,\\ \\ \\hat x_0 = \\tfrac{x_k - \\sqrt{1-\\bar\\alpha_k}\\,\\hat\\varepsilon}{\\sqrt{\\bar\\alpha_k}}',
        note: 'Sin parámetros: estima las acciones limpias x̂₀ y vuelve a mezclar un poco de ruido para el paso siguiente (DDIM determinista). {{metrics.trainSteps}} pasos al entrenar (agenda coseno), {{metrics.steps}} al inferir (el YAML del repo; el paper usa 16 en la Tabla 7 y 10 en el §3.4).' },
      { id: 'dp-actions', op: 'io', modality: 'act', label: 'Chunk T_p × d_a', sub: 'tras K pasos', x: 158, y: 44, w: 22, h: 10,
        note: 'Las T_p = {{cfg.chunk}} acciones limpias (posiciones objetivo del efector).' },
      { id: 'dp-exec', op: 'tensorop', shape: 'rect', ops: ['execute'], opsExact: true, label: 'Ejecutar T_a', sub: 'desde el paso actual', subNum: '{{metrics.executed}} desde el paso actual', x: 158, y: 24, w: 22, h: 9,
        note: 'De las T_p predichas se ejecutan T_a = {{metrics.executed}}, desde la posición T_o − 1 (la del presente: el chunk también "predice" los T_o − 1 pasos ya observados), y se vuelve a inferir con observaciones nuevas: receding horizon (como el control predictivo). Planear más lejos de lo que se ejecuta da coherencia temporal; re-planear corrige errores.' },
      { id: 'dp-robot', op: 'io', modality: 'act', label: 'Robot', sub: 'T_a pasos de control', subNum: '{{metrics.controlHz}} Hz', x: 158, y: 4, w: 22, h: 9,
        note: 'El robot ejecuta las T_a acciones a {{metrics.controlHz}} Hz: hace falta una inferencia cada T_a pasos ({{metrics.inferenceHz}} por segundo).' },
      { id: 'dp-cost', op: 'io', hideInBlank: true, label: 'MACs por inferencia', x: 1, y: 74, w: 150, h: 13,
        costSplit: { segs: [
          { op: 'conv', n: 'metrics.visionMacs', label: 'Encoder de obs. (× cámaras × T_o, una vez)' },
          { tone: 'loop', n: 'metrics.denoiseMacs', label: 'U-Net × {{metrics.steps}} pasos de denoising' },
        ], legendSegs: true, caption: 'total {{metrics.macsPerInference}} por chunk · {{metrics.steps}} × {{metrics.stepMacs}} en el bucle · con {{metrics.trainSteps}} pasos, el bucle dominaría' },
        note: 'MACs de una inferencia, del calculador: el encoder corre una vez y el U-Net una vez por paso de denoising. Con los {{metrics.trainSteps}} pasos del entrenamiento serían {{metrics.trainSteps}} pasadas de {{metrics.stepMacs}} en vez de {{metrics.steps}}: el bucle pasaría a dominar el costo. Por eso DDIM con pocos pasos.' },
    ],
    edges: [
      { from: 'dp-cams', to: 'dp-encoder', kind: 'data', tensor: 'img', labelSide: 'above', labelT: 0.8 },
      { from: 'dp-encoder', to: 'dp-obs', kind: 'data', tensor: 'cam-feat', toSide: 'top', labelSide: 'above', labelSeg: 0, labelT: 0.5 },
      { from: 'dp-eef', to: 'dp-obs', kind: 'data', tensor: 'eef-pose', label: false },
      { from: 'dp-obs', to: 'dp-cond', kind: 'data', tensor: 'obs-cond', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.5, via: [[74.5, 31], [48.5, 31]], labelSide: 'above', labelSeg: 1, labelT: 0.5 },
      { from: 'dp-time', to: 'dp-cond', kind: 'data', tensor: 't-emb', label: false },
      { from: 'dp-cond', to: 'dp-unet', kind: 'data', tensor: 'cond', toAt: 0.2273, labelSide: 'above', labelT: 0.5, tag: 'FiLM', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'dp-noise', to: 'dp-unet', kind: 'data', tensor: 'noisy-actions', toAt: 0.7727, labelSide: 'above', labelT: 0.5 },
      { from: 'dp-unet', to: 'dp-ddim', kind: 'data', tensor: 'eps', toAt: 0.5, fromAt: 0.5, labelSide: 'above', labelT: 0.5, tag: 'ε̂', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'dp-ddim', to: 'dp-noise', kind: 'control', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[123, 65], [15, 65]], loop: true, tag: 'x_{k−1} y k − 1 vuelven · × K = {{metrics.steps}} pasos', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.6 },
      { from: 'dp-ddim', to: 'dp-actions', kind: 'data', tensor: 'denoised', labelSide: 'above', labelT: 0.5, tag: 'al final', tagStyle: 'plain', tagSide: 'below', tagT: 0.5 },
      { from: 'dp-actions', to: 'dp-exec', kind: 'data', tensor: 'denoised', fromSide: 'top', toSide: 'bottom', label: false },
      { from: 'dp-exec', to: 'dp-robot', kind: 'data', tensor: 'action-exec', fromSide: 'top', toSide: 'bottom', labelSide: 'left', labelT: 0.5 },
      { from: 'dp-robot', to: 'dp-cams', kind: 'control', fromSide: 'top', toSide: 'top', fromAt: 0.5, toAt: 0.5, via: [[169, 1.4], [10, 1.4]], loop: true, tag: 'tras T_a pasos: obs nuevas, otra inferencia (receding horizon)', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (Diffusion Policy, una inferencia)', steps: [
        { nodes: ['dp-cams', 'dp-encoder', 'dp-eef', 'dp-obs'], edges: ['dp-cams>dp-encoder', 'dp-encoder>dp-obs', 'dp-eef>dp-obs'], tensors: ['img', 'cam-feat', 'obs-cond'],
          text: 'Cada imagen (<b>' + q('tensor.img.shape') + '</b>) → ResNet-18 + spatial softmax → <b>' + q('tensor.cam-feat.shape') + '</b>. Con las ' + q('cfg.cams') + ' cámaras, T_o = ' + q('metrics.obsSteps') + ' y la pose: la condición <b>' + q('tensor.obs-cond.shape') + '</b>. Una vez por inferencia: ' + q('metrics.visionMacs') + '.' },
        { nodes: ['dp-noise', 'dp-time', 'dp-cond'], edges: ['dp-time>dp-cond', 'dp-obs>dp-cond'], tensors: ['noisy-actions', 't-emb', 'cond'],
          text: 'El bucle arranca con ruido: <b>' + q('tensor.noisy-actions.shape') + '</b>. El paso k y la condición forman <b>' + q('tensor.cond.shape') + '</b>.' },
        { nodes: ['dp-unet', 'dp-ddim'], edges: ['dp-noise>dp-unet', 'dp-cond>dp-unet', 'dp-unet>dp-ddim', 'dp-ddim>dp-noise'], tensors: ['eps'],
          text: 'El U-Net predice el ruido ε̂ (<b>' + q('tensor.eps.shape') + '</b>, ' + q('metrics.stepMacs') + ') y el paso DDIM lo resta. Se repite ' + q('metrics.steps') + ' veces: ' + q('metrics.denoiseMacs') + ' en el bucle.' },
        { nodes: ['dp-actions', 'dp-exec', 'dp-robot'], edges: ['dp-ddim>dp-actions', 'dp-actions>dp-exec', 'dp-exec>dp-robot', 'dp-robot>dp-cams'], tensors: ['denoised', 'action-exec'],
          text: 'Quedan ' + q('cfg.chunk') + ' acciones; se ejecutan ' + q('metrics.executed') + ', desde la del paso actual (índice T_o − 1, con T_o = ' + q('metrics.obsSteps') + ') (<b>' + q('tensor.action-exec.shape') + '</b>) y se vuelve a inferir con observaciones nuevas.' },
        { nodes: ['dp-cost'], edges: [], tensors: [],
          text: 'Una inferencia: ' + q('metrics.macsPerInference') + '. El denoising multiplica: el U-Net corre ' + q('metrics.steps') + ' veces, el encoder una.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
