/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/depth.js
   Diagramas de profundidad monocular (SPEC §7.2, ids de §26.2), modelo `depth` (js/arch/perception.js):
     depth-overview  imagen → patch embedding → [CLS] + posición → encoder ViT (L capas; 4 taps resaltados) → reassemble ×4
                     (×4, ×2, ×1, ×½ de la rejilla) → fusión de grueso a fino (RefineNet) → cabeza → profundidad relativa.
                     Abajo, del calculador: MACs del encoder contra la cabeza DPT en cada config.
       reassemble    un tap por dentro: (LayerNorm del backbone, DA) → Read (CLS) → Concatenate (rejilla) → conv 1×1 → resample →
                     conv 3×3 a F canales; y las 4 escalas.
       scale-shift   (calc:false) relativa vs métrica: la predicción se alinea con la verdad por imagen (s, t) antes de la pérdida;
                     para metros hace falta una cabeza métrica, los intrínsecos o medidas externas.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas y costos: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'depth-anything-v2-small', ALL = ['depth-anything-v2-small', 'depth-anything-v2-base', 'depth-anything-v2-large', 'dpt-large'];
  const q = (k) => '{{' + k + '}}';
  const k2 = (key) => '{{' + C + '.' + key + '}}';
  const PAGE = { page: 'depth', section: 'diagrama' };
  // Depth Anything (DINOv2, patch 14): taps con la LayerNorm del backbone y el CLS descartado; DPT-Large (patch 16): readout "project"
  const IS_DA = { key: 'metrics.P', eq: 14 }, IS_DPT = { key: 'metrics.P', ne: 14 };
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9θ]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };
  // x de cada tap en el encoder (u): tramos iguales, tap al final de cada uno (layers.taps del motor) → fromAt fijo
  const ENC = { x: 50, w: 92 }, TAP_AT = [0.2296, 0.4715, 0.7133, 0.9552];
  const TAP_X = TAP_AT.map((f) => ENC.x + f * ENC.w);
  const COL = TAP_X.map((x) => Math.round((x - 9) * 10) / 10);            // columnas de 18 u centradas en cada tap
  const SCALE = ['×4', '×2', '×1', '×½'];
  const ROWS = [
    { config: 'depth-anything-v2-small', label: 'Depth Anything V2 Small' },
    { config: 'depth-anything-v2-base', label: 'Depth Anything V2 Base' },
    { config: 'depth-anything-v2-large', label: 'Depth Anything V2 Large' },
    { config: 'dpt-large', label: 'DPT-Large (ViT-L/16)' },
  ];

  // ------------------------------------------------------------------ (a) vista general
  register(Object.assign({
    id: 'depth-overview', model: 'depth', config: C, configs: ALL, kind: 'arch',
    title: 'Depth Anything V2 / DPT — vista general',
    caption: 'Profundidad desde una sola imagen: un encoder ViT (DINOv2 en Depth Anything) y una cabeza densa DPT. De cuatro capas del encoder (los taps) se toman los tokens, se vuelven a armar como mapas 2-D a cuatro escalas (×4, ×2, ×1 y ×½ de la rejilla de parches) y se fusionan de la más gruesa a la más fina, como RefineNet; la cabeza sube a la resolución de entrada y da un número por píxel: profundidad relativa (disparidad, correcta salvo escala y desplazamiento). Abajo, del calculador: el encoder es casi todos los parámetros, pero la cabeza no es despreciable en MACs.',
    grid: { w: 150, h: 84 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['encoder', 'reassemble-1', 'fusion-1'], mobileFocusPad: 1,
    opLegend: { conv: 'Convolución (patch embedding, reassemble, cabeza)', attn: 'Encoder ViT (atención)', fuse: 'Fusión de escalas (RefineNet)', head: 'Cabeza: un número por píxel' },
    legendText: { bars: 'Barras: MACs por imagen, ancho proporcional (lineal, del calculador); fila resaltada = la config dibujada', layersTaps: 'Capas del encoder: resaltadas = los 4 taps que van a la cabeza DPT' },
    nodes: [
      { id: 'image', op: 'io', label: 'Imagen', image: true, x: 2, y: 3.5, w: 11, h: 11, note: 'La imagen, redimensionada a un múltiplo del patch (518×518 en Depth Anything: 37×37 parches de 14; 384×384 en DPT-Large: 24×24 de 16).' },
      { id: 'patch-embed', op: 'conv', costOf: 'patch-embed', ops: ['cls', 'pos-embed', 'add-pos'], label: 'Patch embedding', sub: '+ [CLS] + posición', subNum: 'conv {{metrics.P}}×{{metrics.P}} · + [CLS] + pos.', x: 17, y: 4, w: 29, h: 10,
        tex: 'z_0 = [\\,x_{cls};\\, \\mathrm{flatten}(\\mathrm{Conv}_{P\\times P,\\,s=P}(x))\\,] + E_{pos}',
        note: 'Igual que en ViT: cada parche de P×P se proyecta a D (con DINOv2 el patch es 14, no 16), se antepone el token [CLS] y se suma la posición aprendida. La tabla guardada es la del preentrenamiento y se interpola en el forward si la resolución cambia (en DINOv2, de 37×37 a lo que pida la imagen).' },
      { id: 'encoder', op: 'attn', costOf: 'encoder', label: 'Encoder ViT', sub: 'L capas pre-LN · 4 taps', badgeTotal: true, x: ENC.x, y: 2, w: ENC.w, h: 14,
        layers: { L: 'cfg.L', taps: 'metrics.taps' },
        xref: [{ href: '#vit.diagrama~vit-overview.enc-layer', label: 'Ver la capa de ViT' }],
        tex: "z'_\\ell = \\mathrm{MSA}(\\mathrm{LN}(z_{\\ell-1})) + z_{\\ell-1},\\quad z_\\ell = \\mathrm{MLP}(\\mathrm{LN}(z'_\\ell)) + z'_\\ell",
        note: 'Un ViT sin cabeza de clasificación: DINOv2 (S/B/L) en Depth Anything, con LayerScale en cada sub-bloque; ViT-L/16 en DPT-Large. La cabeza DPT lee la salida de cuatro capas (resaltadas): las tempranas tienen detalle local, las profundas contexto global. Casi todos los parámetros del modelo están aquí.' },
      ...[0, 1, 2, 3].map((k) => ({ id: 'reassemble-' + (k + 1), op: 'conv', costOf: 'reassemble-' + (k + 1), label: 'Reassemble ' + SCALE[k], sub: 'tokens → mapa 2-D', subNum: '→ {{tensor.feat-' + (k + 1) + '.shape}}', expand: 'reassemble', x: COL[k], y: 24, w: 18, h: 10,
        note: 'Tap ' + (k + 1) + ': se descarta (Depth Anything) o se proyecta (DPT) el [CLS], los N tokens vuelven a su rejilla h × w, una conv 1×1 cambia los canales y un re-muestreo ' + ['sube ×4 (conv transpuesta k = s = 4)', 'sube ×2 (conv transpuesta k = s = 2)', 'deja la rejilla igual (identidad)', 'baja ×½ (conv 3×3 con stride 2)'][k] + '. Después, una conv 3×3 a F canales. Ábrelo para verlo paso a paso.' })),
      ...[0, 1, 2, 3].map((k) => ({ id: 'fusion-' + (k + 1), op: 'fuse', costOf: 'fusion-' + (k + 1), label: 'Fusión ' + (k + 1), sub: k === 3 ? 'RCU, ↑' : 'RCU + g, RCU, ↑', x: COL[k], y: 42, w: 18, h: 10,
        tex: k === 3 ? '\\mathrm{Up}(\\mathrm{RCU}(f_4))' : '\\mathrm{Up}\\big(\\mathrm{RCU}_2(\\mathrm{RCU}_1(f_' + (k + 1) + ') + g_' + (k + 2) + ')\\big)',
        note: k === 3 ? 'La escala más gruesa (×½) empieza la cadena: una unidad residual (dos convs 3×3 con ReLU y un atajo), un upsample bilineal hasta la escala siguiente y una proyección 1×1. Su primera unidad residual existe en los pesos pero no recibe entrada (no se usa en el forward).'
          : 'Bloque RefineNet: la escala ' + SCALE[k] + ' pasa por una unidad residual, se le suma lo que viene de la escala más gruesa, otra unidad residual, upsample bilineal (×2, o al tamaño exacto de la escala siguiente) y proyección 1×1. De grueso a fino: el contexto global baja y se corrige con el detalle.' })),
      { id: 'head', op: 'head', costOf: 'head', label: 'Cabeza', sub: 'conv, ↑ H×W, conv, ReLU', x: 30, y: 42, w: 24, h: 10,
        tex: 'd = \\mathrm{ReLU}(\\mathrm{Conv}_{1\\times1}(\\mathrm{ReLU}(\\mathrm{Conv}_{3\\times3}(\\mathrm{Up}(\\mathrm{Conv}_{3\\times3}(g_1))))))',
        note: 'conv 3×3 (F → F/2), upsample bilineal a la resolución de entrada, conv 3×3 (→ 32), ReLU, conv 1×1 (→ 1) y ReLU: disparidad relativa ≥ 0 (el cielo, 0). Las convs a resolución completa hacen que la cabeza pese en MACs y en memoria de activaciones aunque tenga pocos parámetros. La versión métrica termina en sigmoide × profundidad máxima.' },
      { id: 'depth', op: 'io', label: 'Profundidad relativa', sub: 'disparidad, H×W', subNum: 'disparidad, {{tensor.depth.shape}}', expand: 'scale-shift', x: 2, y: 42, w: 24, h: 10,
        note: 'Un número por píxel: disparidad (1/profundidad) relativa, correcta salvo una escala y un desplazamiento por imagen. Ábrelo para ver cómo se entrena con eso y qué hace falta para tener metros.' },
      { id: 'macs-bars', op: 'io', hideInBlank: true, label: 'MACs: encoder vs cabeza', x: 2, y: 57, w: 146, h: 24,
        bars: { unit: 'macs', labelW: 24, totalW: 12, rows: ROWS, segs: [{ op: 'attn', n: 'metrics.encoderMacs', label: 'encoder ViT' }, { op: 'conv', n: 'metrics.decoderMacs', label: 'cabeza DPT (reassemble + fusión + cabeza)' }],
          caption: 'cabeza DPT = {{metrics.decoderMacsShare}} de los MACs a {{metrics.res}}×{{metrics.res}} en la config dibujada' },
        note: 'MACs por imagen de cada config, del calculador: el encoder crece con el tamaño del ViT y con los tokens (atención ∝ N²); la cabeza crece con la cantidad de píxeles y con F. En Depth Anything V2 Small la cabeza es {{metrics.decoderMacsShare}} del cómputo con ' + k2('metrics.decoderParams') + ' de parámetros.' },
    ],
    edges: [
      { from: 'image', to: 'patch-embed', kind: 'data', tensor: 'x-img', label: false },
      { from: 'patch-embed', to: 'encoder', kind: 'data', tensor: 'x0', label: false },
      ...[0, 1, 2, 3].map((k) => ({ from: 'encoder', to: 'reassemble-' + (k + 1), kind: 'data', tensor: 'tap-' + (k + 1), fromSide: 'bottom', toSide: 'top', fromAt: TAP_AT[k], toAt: 0.5, labelSide: 'left', labelT: 0.5 })),
      // rótulos a la izquierda de cada columna: a la derecha, el de la rama ×½ ((⌈H/2P⌉)×(⌈W/2P⌉)×F) se salía del dibujo
      ...[0, 1, 2, 3].map((k) => ({ from: 'reassemble-' + (k + 1), to: 'fusion-' + (k + 1), kind: 'data', tensor: 'feat-' + (k + 1), labelSide: 'left', labelT: 0.5 })),
      { from: 'fusion-4', to: 'fusion-3', kind: 'data', tensor: 'fused-4', label: false },
      { from: 'fusion-3', to: 'fusion-2', kind: 'data', tensor: 'fused-3', label: false },
      { from: 'fusion-2', to: 'fusion-1', kind: 'data', tensor: 'fused-2', label: false },
      { from: 'fusion-1', to: 'head', kind: 'data', tensor: 'fused-1', label: false },
      { from: 'head', to: 'depth', kind: 'data', tensor: 'depth', label: false },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (la config dibujada)', steps: [
        { nodes: ['image', 'patch-embed'], edges: ['image>patch-embed', 'patch-embed>encoder'], tensors: ['x-img', 'x0'],
          text: 'La imagen de <b>' + q('tensor.x-img.shape') + '</b> se corta en parches de ' + q('metrics.P') + ': <b>' + q('tensor.x-patches.shape') + '</b>; con [CLS] y posición, <b>' + q('tensor.x0.shape') + '</b> tokens.' },
        { nodes: ['encoder'], edges: ['patch-embed>encoder'], tensors: ['x0'],
          text: 'El encoder ViT corre sus ' + q('cfg.L') + ' capas sobre ' + q('metrics.tokens') + ' tokens: ' + q('metrics.encoderParams') + ' parámetros y ' + q('metrics.encoderMacs') + '. La forma no cambia de capa a capa.' },
        { nodes: ['encoder', 'reassemble-1', 'reassemble-2', 'reassemble-3', 'reassemble-4'], edges: ['encoder>reassemble-1', 'encoder>reassemble-2', 'encoder>reassemble-3', 'encoder>reassemble-4'], tensors: ['tap-1', 'tap-2', 'tap-3', 'tap-4'],
          text: 'Cuatro taps (las capas resaltadas: un cuarto, la mitad, tres cuartos y la última en S y B) dan cuatro copias de <b>' + q('tensor.tap-1.shape') + '</b>: detalle local en las tempranas, contexto en las profundas.' },
        { expand: 'reassemble', nodes: ['rs-read', 'rs-grid', 'rs-proj', 'rs-resample'], edges: ['rs-read>rs-grid', 'rs-grid>rs-proj', 'rs-proj>rs-resample'], tensors: ['tok-1', 'grid-1', 'proj-1', 'rs-1'],
          text: 'Reassemble del tap 1: sin el [CLS] (Depth Anything lo descarta; DPT-Large lo concatena a cada token y proyecta: <b>' + q('tensor.tok-1.shape') + '</b>), a la rejilla (<b>' + q('tensor.grid-1.shape') + '</b>), conv 1×1 a <b>' + q('tensor.proj-1.shape') + '</b> y conv transpuesta ×4: <b>' + q('tensor.rs-1.shape') + '</b>.' },
        { nodes: ['reassemble-1', 'reassemble-2', 'reassemble-3', 'reassemble-4'], edges: ['reassemble-1>fusion-1', 'reassemble-2>fusion-2', 'reassemble-3>fusion-3', 'reassemble-4>fusion-4'], tensors: ['feat-1', 'feat-2', 'feat-3', 'feat-4'],
          text: 'Las cuatro escalas, todas con F canales: <b>' + q('tensor.feat-1.shape') + '</b>, <b>' + q('tensor.feat-2.shape') + '</b>, <b>' + q('tensor.feat-3.shape') + '</b> y <b>' + q('tensor.feat-4.shape') + '</b> (×4, ×2, ×1 y ×½ de la rejilla). Reassemble entero: ' + q('metrics.reassembleMacs') + '.' },
        { nodes: ['fusion-4', 'fusion-3', 'fusion-2', 'fusion-1'], edges: ['fusion-4>fusion-3', 'fusion-3>fusion-2', 'fusion-2>fusion-1'], tensors: ['fused-4', 'fused-3', 'fused-2', 'fused-1'],
          text: 'Fusión de grueso a fino: cada bloque suma la escala más gruesa ya procesada con la suya y sube a la escala siguiente (×2, o al tamaño exacto: 19 → 37 en Depth Anything), hasta <b>' + q('tensor.fused-1.shape') + '</b>. Fusión: ' + q('metrics.fusionMacs') + '.' },
        { nodes: ['head', 'depth'], edges: ['fusion-1>head', 'head>depth'], tensors: ['depth'],
          text: 'La cabeza sube a la resolución de entrada y da <b>' + q('tensor.depth.shape') + '</b>: un número por píxel (' + q('metrics.headMacs') + ': convs a resolución completa).' },
        { nodes: ['macs-bars'], edges: [], tensors: [],
          text: 'En total, la cabeza DPT (reassemble + fusión + cabeza) tiene ' + q('metrics.decoderParams') + ' parámetros y ' + q('metrics.decoderMacs') + ': <b>' + q('metrics.decoderMacsShare') + '</b> del cómputo. Compara las configs en las barras.' },
        { expand: 'scale-shift', nodes: ['ss-align', 'ss-loss'], edges: ['ss-pred>ss-align', 'ss-gt>ss-align', 'ss-align>ss-loss'], tensors: [],
          text: 'La salida es relativa: al entrenar se alinea con la verdad por imagen (escala s y desplazamiento t) antes de medir el error. Para metros hace falta algo más que esta red.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) reassemble de un tap
  register(Object.assign({
    id: 'reassemble', model: 'depth', config: C, configs: ALL, kind: 'arch',
    title: 'Reassemble: de tokens a un mapa 2-D', parent: 'depth-overview', parentNode: 'reassemble-1',
    caption: 'Lo que hace DPT con los tokens de un tap (ecuaciones 1–6 del paper): Read decide qué hacer con el [CLS] (Depth Anything lo descarta; DPT-Large lo concatena a cada token y proyecta), Concatenate pone los N tokens de vuelta en su rejilla h × w como un mapa de D canales, una conv 1×1 cambia los canales y Resample lleva el mapa a su escala. Aquí, el tap 1 (×4: conv transpuesta k = s = 4); los otros tres solo cambian los canales y el re-muestreo (a la derecha). Al final, una conv 3×3 lleva todo a F canales para la fusión.',
    grid: { w: 104, h: 86 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['rs-grid', 'rs-resample'], mobileFocusPad: 1,
    opLegend: { norm: 'LayerNorm del backbone (Depth Anything)', tensorop: 'Reordenar tokens (sin parámetros)', conv: 'Convolución' },
    legendText: { ghost: 'Contorno punteado: no existe en esta config' },
    nodes: [
      { id: 'rs-in', op: 'io', label: 'Tokens del tap 1', sub: 'salida de la capa del tap', x: 22, y: 1, w: 40, h: 7, note: 'La salida de la capa del tap 1, con el [CLS] adelante: (N + 1) × D.' },
      { id: 'rs-ln', op: 'norm', ops: ['tap-ln-1'], opsExact: true, label: 'LayerNorm del backbone', sub: 'la misma de la salida del ViT', x: 24, y: 12, w: 36, h: 7,
        when: { if: IS_DPT, set: { ghost: true, sub: 'DPT-Large: no' } },
        note: 'En Depth Anything cada tap pasa por la LayerNorm final del DINOv2 (la misma para los cuatro: sus parámetros se cuentan una vez). DPT-Large toma la salida de la capa tal cual.' },
      { id: 'rs-read', op: 'tensorop', shape: 'rect', ops: ['readout-1'], opsExact: true, label: 'Read: descartar [CLS]', sub: 'readout "ignore"', x: 24, y: 23, w: 36, h: 7,
        when: { if: IS_DPT, set: { label: 'Read: proyectar [CLS]', sub: 'readout "project": Linear 2D → D' } },
        tex: '\\mathrm{Read}_{ign}(t) = \\{t_1, \\dots, t_N\\}', note: 'Qué hacer con el token de clase. "ignore" (Depth Anything): se tira. "project" (DPT-Large): se concatena a cada token y una Linear 2D → D con GELU lo mezcla (parámetros por tap). "add": se suma.' },
      { id: 'rs-grid', op: 'tensorop', shape: 'rect', ops: ['to-grid-1'], opsExact: true, label: 'Concatenate: a la rejilla', sub: 'N tokens → h × w × D', x: 24, y: 34, w: 36, h: 7,
        tex: '\\mathbb{R}^{N\\times D} \\to \\mathbb{R}^{\\frac{H}{p}\\times\\frac{W}{p}\\times D}', note: 'Un reshape: cada token vuelve al lugar de su parche. Sin parámetros: es lo que permite tratar la salida de un ViT como el feature map de una CNN.' },
      { id: 'rs-proj', op: 'conv', ops: ['project-1'], opsExact: true, label: 'Conv 1×1', sub: 'D → C₁', subNum: '{{tensor.grid-1.shape}} → {{tensor.proj-1.shape}}', x: 24, y: 45, w: 36, h: 7, note: 'Cambia los canales: menos en las escalas finas (que serán grandes) y más en las gruesas.' },
      { id: 'rs-resample', op: 'conv', ops: ['resample-1'], opsExact: true, label: 'Resample ×4', sub: 'conv transpuesta k = s = 4', x: 24, y: 56, w: 36, h: 7,
        tex: '\\mathrm{ConvT}_{4\\times4,\\, s=4}', note: 'Tap 1: sube ×4 con una conv transpuesta de kernel y stride 4 (sin solapar). Tap 2: ×2 (kernel y stride 2). Tap 3: identidad. Tap 4: baja ×½ con una conv 3×3 de stride 2 (con 37 de rejilla, ⌈37/2⌉ = 19).' },
      { id: 'rs-neck', op: 'conv', ops: ['neck-conv-1'], opsExact: true, label: 'Conv 3×3 → F', sub: 'sin sesgo', x: 24, y: 67, w: 36, h: 7, note: 'Lleva cada escala a los mismos F canales, para poder sumarlas en la fusión.' },
      { id: 'rs-out', op: 'io', label: 'A la fusión 1', x: 30, y: 78, w: 24, h: 6, note: 'Entra al bloque de fusión de la escala más fina.' },
      { id: 'rs-scales', op: 'io', hideInBlank: true, label: 'Las 4 escalas', sub: 'después del resample', subNum: '×4: {{tensor.rs-1.shape}}\n×2: {{tensor.rs-2.shape}}\n×1: {{tensor.rs-3.shape}}\n×½: {{tensor.rs-4.shape}}', x: 70, y: 38, w: 32, h: 15,
        note: 'Las cuatro ramas tienen la misma estructura: cambian los canales de la conv 1×1 y el re-muestreo (×4, ×2, ×1, ×½ de la rejilla de parches). Con patch 16 (DPT-Large) son 1/4, 1/8, 1/16 y 1/32 de la imagen; con patch 14 (Depth Anything) los strides en píxeles son 3.5, 7, 14 y ≈ 27 (518/19; nominal 28).' },
    ],
    edges: [
      { from: 'rs-in', to: 'rs-ln', kind: 'data', tensor: 'tap-1', labelSide: 'right', labelT: 0.5, when: IS_DA },
      { from: 'rs-ln', to: 'rs-read', kind: 'data', tensor: 'tap-n-1', labelSide: 'right', labelT: 0.5, when: IS_DA },
      // DPT-Large: sin LayerNorm, el tap va directo al readout (por fuera, a la izquierda)
      { from: 'rs-in', to: 'rs-read', kind: 'data', tensor: 'tap-1', fromSide: 'left', toSide: 'left', via: [[18, 4.5], [18, 26.5]], labelSide: 'left', labelSeg: 1, labelT: 0.5, when: IS_DPT },
      { from: 'rs-read', to: 'rs-grid', kind: 'data', tensor: 'tok-1', labelSide: 'right', labelT: 0.5 },
      { from: 'rs-grid', to: 'rs-proj', kind: 'data', tensor: 'grid-1', labelSide: 'right', labelT: 0.5 },
      { from: 'rs-proj', to: 'rs-resample', kind: 'data', tensor: 'proj-1', labelSide: 'right', labelT: 0.5 },
      { from: 'rs-resample', to: 'rs-neck', kind: 'data', tensor: 'rs-1', labelSide: 'right', labelT: 0.5 },
      { from: 'rs-neck', to: 'rs-out', kind: 'data', tensor: 'feat-1', labelSide: 'right', labelT: 0.5, blankHide: 'rs-1' },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) relativa vs métrica (sin calculador)
  register(Object.assign({
    id: 'scale-shift', model: 'depth', calc: false, calcNote: 'Vista conceptual de la pérdida y de la salida: no agrega cómputo a la red (la alineación son unas sumas por imagen). La visualización de la página hace las cuentas.',
    kind: 'arch', title: 'Relativa vs métrica', parent: 'depth-overview', parentNode: 'depth',
    caption: 'La red relativa predice disparidad correcta salvo una escala y un desplazamiento por imagen: con una sola imagen no se puede saber si la escena es chica y cercana o grande y lejana, y los datasets de entrenamiento usan unidades distintas. Al entrenar (arriba), la predicción se alinea con la verdad por imagen, (s, t) por mínimos cuadrados o mediana y escala, y recién entonces se mide el error (ℒ<sub>ssi</sub> de MiDaS). Para metros (abajo) hace falta otra información: una cabeza métrica afinada en un dominio, los intrínsecos de la cámara o medidas externas (LiDAR, ToF, SLAM) para fijar s y t.',
    grid: { w: 130, h: 52 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['ss-align', 'ss-metric'], mobileFocusPad: 1,
    opLegend: { attn: 'La red (encoder ViT + DPT)', fuse: 'Alineación por imagen (2 números)', head: 'Pérdida / cabeza métrica' },
    edgeLegend: { data: 'Lo que pasa (sin forma: vista sin calculador)' },
    groups: [
      { id: 'ss-train', style: 'lane', tone: 'warn', label: 'Entrenamiento relativo (MiDaS, Depth Anything)', legend: 'Marco ámbar: entrenamiento', x: 0.5, y: 0.5, w: 129, h: 30 },
      { id: 'ss-met', style: 'lane', tone: 'accent', label: 'Para metros', legend: 'Marco azul: inferencia métrica', labelPos: 'bottom', x: 0.5, y: 32.5, w: 129, h: 19 },
    ],
    nodes: [
      { id: 'ss-img', op: 'io', label: 'Imagen', image: true, x: 2, y: 4, w: 11, h: 11, note: 'Una imagen RGB; ningún dato de la cámara.' },
      { id: 'ss-net', op: 'attn', label: 'Red relativa', sub: 'ViT + cabeza DPT', x: 21, y: 5, w: 16, h: 10, note: 'La red de la vista general: termina en ReLU (disparidad ≥ 0).' },
      { id: 'ss-pred', op: 'io', label: 'Predicción d̂', sub: 'disparidad relativa', x: 43, y: 5, w: 19, h: 10, note: 'Correcta salvo s y t: d̂ ≈ (d* − t)/s. Ordena bien lo que está más cerca y más lejos.' },
      { id: 'ss-gt', op: 'io', label: 'Verdad d*', sub: 'disparidad del dataset', x: 68, y: 19, w: 26, h: 9, note: 'De estéreo, LiDAR, SfM o sintética, cada dataset con su escala (y a veces su desplazamiento). En Depth Anything V2, pseudo-etiquetas del maestro.' },
      { id: 'ss-align', op: 'fuse', label: '(s, t) por imagen', sub: 'mín Σ (s·d̂ + t − d*)²', x: 68, y: 4, w: 26, h: 11,
        tex: '(s, t) = \\arg\\min_{s,t} \\sum_i (s\\,\\hat d_i + t - d^*_i)^2', note: 'Mínimos cuadrados con forma cerrada (ecuaciones normales de 2×2), o la versión robusta: t = mediana, s = desviación media absoluta, en la predicción y en la verdad por separado (Depth Anything).' },
      { id: 'ss-loss', op: 'head', label: 'Pérdida ℒ_ssi', sub: '1/2M Σ ρ(s·d̂ + t − d*)', x: 104, y: 4, w: 24, h: 11,
        tex: '\\mathcal{L}_{ssi} = \\frac{1}{2M} \\sum_{i=1}^{M} \\rho\\big(s\\,\\hat d_i + t - d^*_i\\big)', note: 'MiDaS (Ranftl et al., TPAMI 2022): ρ = cuadrado (ssimse) o valor absoluto con el 20 % de residuos más grandes recortado (ssitrim). Invariante a escala y desplazamiento: permite mezclar datasets con unidades distintas. Se suma un término de gradiente multi-escala para bordes nítidos.' },
      { id: 'ss-intr', op: 'io', label: 'Intrínsecos / sensor', sub: 'focal f, LiDAR, ToF', x: 19, y: 37, w: 20, h: 10, note: 'Lo que fija la escala: la focal de la cámara (Metric3D normaliza a una cámara canónica; Depth Pro la estima) o unas pocas medidas métricas de otro sensor.' },
      { id: 'ss-metric', op: 'head', label: 'Cabeza métrica', sub: 'o alinear con medidas', x: 68, y: 37, w: 26, h: 10, note: 'Tres caminos: afinar una cabeza métrica en un dominio (Depth Anything V2 metric, que termina en sigmoide × profundidad máxima; ZoeDepth, con "metric bins"), condicionar en la cámara, o estimar s y t con medidas externas (dos incógnitas: hacen falta al menos dos medidas).' },
      { id: 'ss-m', op: 'io', label: 'Profundidad en metros', sub: 'z = 1/(s·d̂ + t)', x: 104, y: 37, w: 24, h: 10, note: 'Un ajuste afín en disparidad no es una escala en profundidad: z = 1/(s·d̂ + t).' },
    ],
    edges: [
      { from: 'ss-img', to: 'ss-net', kind: 'data', tag: 'RGB', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ss-net', to: 'ss-pred', kind: 'data', tag: 'd̂', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ss-pred', to: 'ss-align', kind: 'data', tag: 'd̂', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ss-gt', to: 'ss-align', kind: 'data', tag: 'd*', tagStyle: 'plain', tagSide: 'right', tagT: 0.5 },
      { from: 'ss-align', to: 'ss-loss', kind: 'data', tag: 's·d̂ + t', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ss-pred', to: 'ss-metric', kind: 'data', fromSide: 'bottom', toSide: 'top', fromAt: 0.5, toAt: 0.3, via: [[52.5, 33.5], [75.8, 33.5]], tag: 'd̂', tagStyle: 'plain', tagSide: 'left', tagSeg: 0, tagT: 0.6 },
      { from: 'ss-intr', to: 'ss-metric', kind: 'data', tag: 'f o medidas', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'ss-metric', to: 'ss-m', kind: 'data', tag: 'metros', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
