/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/bytetrack.js
   Diagramas del tracking (SPEC §7.2, ids de §26.1), modelo `bytetrack` (js/arch/perception.js):
     bytetrack-overview  un frame: detector → split por score (altas / bajas) → Kalman predict de todos los tracks → 1ª asociación
                         (altas, 1 − IoU·s, húngaro con umbral) → 2ª asociación (bajas con los tracks que quedaron) → Kalman update
                         → gestión (nuevos / perdidos / borrados) → tracks con id; el estado vuelve en el frame siguiente. Abajo, la
                         barra del costo por frame: detector contra tracker (≪ 1 %). Con SORT no hay 2ª asociación (bloque fantasma).
       kalman            predict (x⁻ = F x, P⁻ = F P Fᵀ + Q) y update (S, K, innovación, x, P) con los tamaños de las matrices.
       association       una asociación por dentro: IoU de cada par → costo → asignación con umbral → parejas / sin pareja.
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Formas y costos: ATLAS.Arch.run / metrics. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'bytetrack-mot17', ALL = ['bytetrack-mot17', 'sort', 'bytetrack-ultralytics'];
  const q = (k) => '{{' + k + '}}';
  const PAGE = { page: 'bytetrack', section: 'diagrama' };
  // SORT (abewley/sort): sin segunda pasada; el calculador lo distingue por su filtro (filterpy, forma de Joseph)
  const IS_SORT = { key: 'metrics.kalmanImpl', eq: 'filterpy-joseph' }, NOT_SORT = { key: 'metrics.kalmanImpl', ne: 'filterpy-joseph' };
  // Subíndices estilo TeX en el html de notas y pasos ("x_t", "m_1") → <sub>; no toca <code> ni las claves {{…}}
  const subHtml = (s) => String(s).split(/(<code>[\s\S]*?<\/code>|\{\{[^}]*\}\})/).map((p, i) => (i % 2 ? p : p.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>').replace(/_([A-Za-z0-9θ]+)/g, '<sub>$1</sub>'))).join('');
  const register = (spec) => {
    for (const n of spec.nodes || []) if (n.note) n.note = subHtml(n.note);
    for (const w of spec.walks || []) for (const st of w.steps) st.text = subHtml(st.text);
    ATLAS.registerDiagram(spec);
  };
  const OPLEG = { conv: 'Detector (CNN, con parámetros)', head: 'Filtro de Kalman (predict / update)', fuse: 'Asociación: IoU, costo y asignación húngara' };

  // ------------------------------------------------------------------ (a) vista general: un frame
  register(Object.assign({
    id: 'bytetrack-overview', model: 'bytetrack', config: C, configs: ALL, kind: 'arch',
    title: 'ByteTrack — un frame',
    caption: 'Tracking por detección: en cada frame el detector da cajas con score; el tracker las une a los tracks del frame anterior sin aprender nada. El filtro de Kalman predice dónde estará cada track; la 1ª asociación empareja las detecciones de score alto por IoU con el algoritmo húngaro; la 2ª (la idea de ByteTrack) usa las de score bajo, que suelen ser objetos tapados, para los tracks que quedaron sin pareja. Las parejas corrigen su Kalman; las altas sin pareja abren tracks nuevos y los tracks sin pareja quedan perdidos hasta que se borran. Abajo: el detector es casi todo el costo del frame.',
    grid: { w: 160, h: 80 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['predict', 'assoc-1', 'assoc-2'], mobileFocusPad: 1,
    opLegend: OPLEG,
    modLegend: { img: 'Tensor: el frame', qry: 'Tensor: cajas y estados de los tracks' },
    edgeLegend: { control: 'Sin tensor: tracks que pasan de etapa / el estado al frame siguiente' },
    legendText: { costSplit: 'Costo por frame: ancho proporcional a los FLOPs (del calculador; el tracker es ≈)', ghost: 'Contorno punteado: no existe en esta config (SORT)', loop: 'Bucle: el estado vuelve en el frame siguiente' },
    groups: [
      { id: 'det-lane', style: 'lane', tone: 'warn', label: 'Detector: una red por frame', legend: 'Marco ámbar: el detector (casi todo el costo)', x: 0.5, y: 0.5, w: 159, h: 17 },
      { id: 'trk-lane', style: 'lane', tone: 'accent', label: 'Tracker: 0 parámetros, solo cuentas', legend: 'Marco azul: el tracker (Kalman + asociación)', labelPos: 'bottom', x: 0.5, y: 20.5, w: 159, h: 42 },
    ],
    nodes: [
      { id: 'frame', op: 'io', label: 'Frame t', image: true, x: 3, y: 4.5, w: 12, h: 12,
        note: 'Un frame del video (sin batch). El tracker corre una vez por frame, en orden: el estado de cada track viene del frame anterior.' },
      { id: 'detector', op: 'conv', costOf: 'detector', label: 'Detector', sub: 'YOLOX-X · 800×1440', x: 21, y: 5.5, w: 22, h: 10,
        when: { if: { key: 'metrics.detectorConfig', eq: 'yolov8l-640' }, set: { sub: 'YOLOv8-L · 640' } },
        xref: [{ href: '#yolo-world', label: 'Ver YOLOv8 (en YOLO-World)' }, { href: '#detr', label: 'Ver DETR' }],
        note: 'Cualquier detector que dé cajas con score: ByteTrack usa YOLOX-X a 800×1440 en MOT17; Ultralytics, su YOLOv8. Es casi todo el costo del frame y todos los parámetros (el tracker no aprende nada). Su salida: n_det cajas con score > 0.1 (x₁, y₁, x₂, y₂, s).' },
      { id: 'split', op: 'tensorop', shape: 'split', costOf: 'split', label: 'Separar por score', labelPos: 'above', x: 50, y: 8.5, w: 4, h: 4,
        tex: '\\text{altas: } s > \\tau_{alto},\\quad \\text{bajas: } \\tau_{bajo} < s < \\tau_{alto}',
        note: 'Altas: score > {{metrics.trackHigh}}. Bajas: entre {{metrics.trackLow}} y {{metrics.trackHigh}}; las de menos de {{metrics.trackLow}} se tiran. SORT y casi todos los trackers anteriores tiraban también las bajas: ByteTrack las guarda para la 2ª asociación.' },
      { id: 'tracks-prev', op: 'io', style: 'store', label: 'Tracks (t−1)', sub: 'x, P, id', x: 2, y: 25, w: 13, h: 13,
        note: 'El estado de cada track: la media x del filtro de Kalman (caja + velocidades) y su covarianza P, más id, score y en qué frame se lo vio por última vez. Incluye los tracks perdidos (sin detección hace poco): también se predicen y pueden recuperar su id.' },
      { id: 'predict', op: 'head', costOf: 'predict', label: 'Kalman: predict', sub: 'x⁻ = Fx · P⁻ = FPFᵀ + Q', expand: 'kalman', x: 25.5, y: 26.5, w: 23.5, h: 10,
        tex: 'x^- = F x,\\qquad P^- = F P F^\\top + Q',
        note: 'Mueve cada track con velocidad constante: dónde debería estar en este frame y con cuánta incertidumbre. Todos los tracks a la vez (<code>multi_predict</code>). Sin parámetros aprendidos: F es fija y Q depende de la altura de la caja (en SORT, Q también es fija). Ábrelo para ver las matrices.' },
      { id: 'assoc-1', op: 'fuse', costOf: 'assoc-1', label: '1ª asociación', sub: 'altas · 1 − IoU·s · húngaro', subNum: 'altas · θ = {{metrics.matchThresh}} · húngaro', expand: 'association', x: 56, y: 26.5, w: 26, h: 10,
        when: { if: IS_SORT, set: { sub: 'altas · IoU ≥ 0.3 · húngaro', subNum: 'altas · IoU ≥ 0.3 · húngaro' } },
        tex: 'C_{ij} = 1 - \\mathrm{IoU}(\\hat b_i, d_j)\\, s_j,\\quad \\text{pareja si } C_{ij} < \\theta',
        note: 'Todos los tracks (activos y perdidos) contra las detecciones altas: IoU de cada par entre la caja predicha y la detectada, costo 1 − IoU·s (el score pondera; en MOT20 no) y la asignación de costo mínimo con el algoritmo húngaro; una pareja con costo ≥ θ = {{metrics.matchThresh}} no se acepta. SORT: costo 1 − IoU y se rechaza IoU &lt; 0.3. Ábrelo para verlo por dentro.' },
      { id: 'assoc-2', op: 'fuse', costOf: 'assoc-2', label: '2ª asociación', sub: 'bajas · 1 − IoU · húngaro', subNum: 'bajas · θ = {{metrics.matchThresh2}} · húngaro', x: 92, y: 26.5, w: 24, h: 10,
        when: { if: IS_SORT, set: { ghost: true, label: 'Sin 2ª asociación', sub: 'SORT tira las bajas', subNum: 'SORT tira las bajas', expand: null } },
        tex: 'C_{ij} = 1 - \\mathrm{IoU}(\\hat b_i, d^{bajo}_j),\\quad \\text{pareja si } C_{ij} < 0.5',
        note: 'La idea de ByteTrack: los tracks activos que quedaron sin pareja contra las detecciones de score bajo, con IoU solo (sin score) y umbral 0.5. Una persona tapada sale con score bajo pero justo donde el Kalman predijo su track: se empareja y conserva su id. Las bajas que no caen sobre ningún track son casi siempre fondo y se tiran. SORT no tiene esta pasada.' },
      { id: 'update', op: 'head', costOf: 'update', label: 'Kalman: update', sub: 'x = x⁻ + K (z − Hx⁻)', expand: 'kalman', x: 122, y: 26.5, w: 22, h: 10,
        tex: 'K = P^- H^\\top (H P^- H^\\top + R)^{-1},\\quad x = x^- + K (z - H x^-)',
        note: 'Cada track con pareja corrige su predicción con la caja detectada z: la ganancia K decide cuánto creerle a la detección y cuánto a la predicción. Solo corre en los tracks emparejados (m₁ + m₂).' },
      { id: 'manage', op: 'tensorop', shape: 'rect', costOf: 'manage', label: 'Gestión de tracks', sub: 'nuevos, perdidos, borrados', x: 121, y: 44, w: 24, h: 10,
        note: 'Las detecciones altas sin pareja con score ≥ {{metrics.newTrackThresh}} abren tracks nuevos (id nuevo). Los tracks sin pareja pasan a perdidos: se siguen prediciendo y se borran cuando los frames seguidos sin detección superan {{metrics.framesLost}} (<code>track_buffer</code> = {{metrics.trackBuffer}} a {{metrics.fps}} fps ≈ {{metrics.secondsLost}} s; en SORT, <code>max_age</code>). Un track recién creado se confirma en el frame siguiente.' },
      { id: 'tracks-out', op: 'io', label: 'Tracks + id', sub: 'salida', x: 148, y: 44, w: 11, h: 10,
        note: 'La salida del frame: los tracks activos con su caja y su id. Lo que mide MOTA / IDF1 / HOTA: que el mismo objeto conserve el mismo id.' },
      { id: 'cost', op: 'io', hideInBlank: true, label: 'Costo por frame', x: 3, y: 65, w: 154, h: 14,
        costSplit: { unit: 'flops', pctSig: true, segs: [{ op: 'conv', n: 'metrics.detectorFlops', label: 'detector' }, { op: 'head', n: 'metrics.trackerOps', label: 'tracker: Kalman + IoU + asignación (≈)' }],
          caption: 'con {{cfg.nDet}} detecciones y {{cfg.nTracks}} tracks por frame: tracker = {{metrics.trackerShare}} del frame' },
        note: 'FLOPs por frame del calculador: el detector ({{metrics.detectorMacs}}, el doble en FLOPs) contra el tracker (≈ {{metrics.trackerOps}} operaciones: Kalman exacto, IoU y asignación húngara estimados en el peor caso). El tracker es {{metrics.trackerShare}} del costo: optimizar un tracker es cuidar sus decisiones (ids), no su velocidad.' },
    ],
    edges: [
      { from: 'frame', to: 'detector', kind: 'data', tensor: 'frame', label: false },
      { from: 'detector', to: 'split', kind: 'data', tensor: 'dets', labelSide: 'below', labelT: 0.5 },
      // altas: por abajo del split hasta la 1ª asociación; bajas: por arriba hasta la 2ª (no se cruzan)
      { from: 'split', to: 'assoc-1', kind: 'data', tensor: 'dets-high', fromSide: 'bottom', toSide: 'top', toAt: 0.5, via: [[52, 18.5], [69, 18.5]], labelSide: 'right', labelSeg: 2, labelT: 0.5 },
      { from: 'split', to: 'assoc-2', kind: 'data', tensor: 'dets-low', fromSide: 'right', toSide: 'top', toAt: 0.5, via: [[104, 10.5]], labelSide: 'above', labelT: 0.55, when: NOT_SORT },
      { from: 'tracks-prev', to: 'predict', kind: 'data', tensor: 'track-mean', fromAt: 0.35, toAt: 0.3, labelSide: 'above', labelT: 0.5 },
      { from: 'tracks-prev', to: 'predict', kind: 'data', tensor: 'track-cov', fromAt: 0.7, toAt: 0.75, labelSide: 'below', labelT: 0.5 },
      { from: 'predict', to: 'assoc-1', kind: 'data', tensor: 'pred-mean', labelSide: 'above', labelT: 0.5 },
      { from: 'assoc-1', to: 'assoc-2', kind: 'control', tag: 'sin pareja', tagStyle: 'plain', tagSide: 'on', tagT: 0.5, when: NOT_SORT },
      { from: 'assoc-2', to: 'update', kind: 'data', tensor: 'matches-2', labelSide: 'above', labelT: 0.5, when: NOT_SORT },
      // las parejas de la 1ª pasan por debajo de la 2ª asociación
      { from: 'assoc-1', to: 'update', kind: 'data', tensor: 'matches-1', fromSide: 'bottom', toSide: 'left', fromAt: 0.5, toAt: 0.85, via: [[69, 40.5], [119, 40.5], [119, 35]], labelSide: 'below', labelSeg: 1, labelT: 0.5 },
      { from: 'update', to: 'manage', kind: 'data', tensor: 'track-mean-new', labelSide: 'right', labelT: 0.5 },
      { from: 'manage', to: 'tracks-out', kind: 'data', tensor: 'tracks-out', label: false },
      // el estado vuelve: el frame siguiente parte de estos tracks
      { from: 'manage', to: 'tracks-prev', kind: 'control', fromSide: 'bottom', toSide: 'bottom', fromAt: 0.5, toAt: 0.5, via: [[133, 58], [8.5, 58]], loop: true, tag: 'frame t + 1', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (un frame)', steps: [
        { nodes: ['frame', 'detector'], edges: ['frame>detector', 'detector>split'], tensors: ['frame', 'dets'],
          text: 'El frame de <b>' + q('tensor.frame.shape') + '</b> pasa por el detector: ' + q('metrics.detectorMacs') + ' para dar <b>' + q('tensor.dets.shape') + '</b> cajas con score. Es la única parte con parámetros (' + q('metrics.detectorParams') + ').' },
        { nodes: ['split'], edges: ['split>assoc-1', 'split>assoc-2'], tensors: ['dets-high', 'dets-low'],
          text: 'Se separan por score: <b>' + q('tensor.dets-high.shape') + '</b> altas (s &gt; ' + q('metrics.trackHigh') + ') y, en ByteTrack, <b>' + q(C + '.tensor.dets-low.shape') + '</b> bajas (' + q('metrics.trackLow') + ' &lt; s &lt; ' + q('metrics.trackHigh') + '). Un tracker clásico como SORT tira las bajas.' },
        { nodes: ['tracks-prev', 'predict'], edges: ['tracks-prev>predict', 'predict>assoc-1'], tensors: ['track-mean', 'track-cov', 'pred-mean'],
          text: 'Los ' + q('cfg.nTracks') + ' tracks del frame anterior (media <b>' + q('tensor.track-mean.shape') + '</b>, covarianza <b>' + q('tensor.track-cov.shape') + '</b>) se predicen con velocidad constante: ' + q('metrics.kalmanPredictMacs') + ' por track.' },
        { expand: 'kalman', nodes: ['kf-Fx', 'kf-FPF'], edges: ['kf-x>kf-Fx', 'kf-P>kf-FPF'], tensors: ['track-mean', 'track-cov'],
          text: 'Por dentro: x⁻ = F x con F de ' + q('metrics.stateDim') + '×' + q('metrics.stateDim') + ' (posición + velocidad · 1 frame) y P⁻ = F P Fᵀ + Q: la incertidumbre crece en cada predicción.' },
        { nodes: ['assoc-1'], edges: ['split>assoc-1', 'predict>assoc-1'], tensors: ['dets-high', 'pred-mean'],
          text: '1ª asociación: el IoU de cada track contra cada detección alta (<b>' + q('tensor.iou-1.shape') + '</b>), costo 1 − IoU·s (SORT: 1 − IoU, sin score) y el algoritmo húngaro con umbral θ = ' + q('metrics.matchThresh') + ' en el costo: ' + q('metrics.matches1') + ' parejas.' },
        { expand: 'association', nodes: ['as-iou', 'as-cost', 'as-assign'], edges: ['as-iou>as-cost', 'as-cost>as-assign'], tensors: ['iou-1', 'cost-1'],
          text: 'Por dentro: la matriz de IoU, el costo y la asignación. En ByteTrack, con umbral, la matriz se extiende a (T + D)² y una pareja solo conviene si su costo es menor que θ: si no, track y detección quedan sin pareja. SORT asigna todo (máx(T, D)²) y después descarta los pares con IoU &lt; 0.3.' },
        { nodes: ['assoc-2'], edges: ['assoc-1>assoc-2', 'split>assoc-2', 'assoc-2>update'], tensors: ['dets-low', 'matches-2'],
          text: '2ª asociación (solo ByteTrack; SORT no la tiene): los tracks activos sin pareja contra las ' + q(C + '.metrics.nLow') + ' bajas, solo con IoU y umbral ' + q(C + '.metrics.matchThresh2') + ': ' + q(C + '.metrics.matches2') + ' parejas más. Son los objetos tapados que no pierden su id.' },
        { nodes: ['update'], edges: ['assoc-1>update', 'assoc-2>update', 'update>manage'], tensors: ['matches-1', 'matches-2', 'track-mean-new'],
          text: 'Los ' + q('metrics.updates') + ' tracks emparejados corrigen su Kalman con la caja detectada (' + q('metrics.kalmanUpdateMacs') + ' por track): <b>' + q('tensor.track-mean-new.shape') + '</b>.' },
        { expand: 'kalman', nodes: ['kf-S', 'kf-K', 'kf-xn'], edges: ['kf-S>kf-K', 'kf-K>kf-xn'], tensors: [],
          text: 'Por dentro: S = H P⁻ Hᵀ + R (' + q('metrics.measDim') + '×' + q('metrics.measDim') + '), la ganancia K = P⁻ Hᵀ S⁻¹ (' + q('metrics.stateDim') + '×' + q('metrics.measDim') + '; el ByteTrack oficial no invierte S: usa Cholesky) y x = x⁻ + K (z − H x⁻).' },
        { nodes: ['manage', 'tracks-out'], edges: ['manage>tracks-out', 'manage>tracks-prev'], tensors: ['tracks-out'],
          text: 'Altas sin pareja con s ≥ ' + q('metrics.newTrackThresh') + ' → tracks nuevos; tracks sin pareja → perdidos (se borran si los frames seguidos sin detección superan ' + q('metrics.framesLost') + '). Sale <b>' + q('tensor.tracks-out.shape') + '</b> y el estado pasa al frame siguiente.' },
        { nodes: ['cost'], edges: [], tensors: [],
          text: 'El costo del frame: detector ' + q('metrics.detectorMacs') + ' (el doble en FLOPs), tracker ≈ ' + q('metrics.trackerOps') + ' operaciones = <b>' + q('metrics.trackerShare') + '</b>. El tracker no es el cuello de botella; sus errores (ID switches) sí son el problema.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) el filtro de Kalman por dentro
  register(Object.assign({
    id: 'kalman', model: 'bytetrack', config: C, configs: ALL, kind: 'arch',
    title: 'Filtro de Kalman: predict y update', parent: 'bytetrack-overview', parentNode: 'predict',
    caption: 'El filtro de Kalman de cada track, con velocidad constante. Predict: la media avanza un frame (x⁻ = F x) y la covarianza crece con el ruido de proceso Q. Update (solo si el track tuvo pareja): S es la incertidumbre de la innovación, K la ganancia (cuánto creerle a la detección), y la media y la covarianza se corrigen. n = dimensión del estado (8 en ByteTrack: x, y, a, h y sus velocidades; 7 en SORT), m = la de la medición (4: la caja). Todas las matrices son chicas: el costo es despreciable al lado del detector.',
    grid: { w: 142, h: 49 }, direction: 'lr', maxCrossings: 0,
    mobileFocus: ['kf-FPF', 'kf-K'], mobileFocusPad: 1,
    opLegend: { head: 'Ecuación del filtro (matrices chicas, sin parámetros aprendidos)' },
    modLegend: { qry: 'Tensor: estados de los tracks (T tracks a la vez)' },
    edgeLegend: { control: 'Matriz o vector intermedio (su tamaño en la etiqueta)' },
    groups: [
      { id: 'kf-pred', label: 'Predict · todos los tracks', label2: q('metrics.kalmanPredictMacs') + ' por track', labelPos: 'bottom', x: 0.5, y: 6, w: 47, h: 42 },
      { id: 'kf-upd', label: 'Update · solo los tracks con pareja', label2: q('metrics.kalmanUpdateMacs') + ' por track', labelPos: 'bottom', x: 56.5, y: 6, w: 67.5, h: 42 },
    ],
    nodes: [
      { id: 'kf-x', op: 'io', label: 'Media x', sub: 'caja y velocidad', x: 2, y: 14, w: 16, h: 9, note: 'El estado de cada track: posición de la caja (centro x, y; aspecto a = w/h; altura h en ByteTrack) y sus velocidades. SORT usa (u, v, s, r) con área s y aspecto r constante: 7 números.' },
      { id: 'kf-P', op: 'io', label: 'Covarianza P', sub: 'incertidumbre', x: 2, y: 32, w: 16, h: 9, note: 'Qué tan seguro está el filtro de cada componente del estado y cómo se relacionan (posición con velocidad).' },
      { id: 'kf-Fx', op: 'head', label: 'x⁻ = F x', sub: 'F: n×n', subNum: 'F: {{metrics.stateDim}}×{{metrics.stateDim}}', x: 24, y: 14, w: 22, h: 9,
        tex: 'F = \\begin{bmatrix} I & \\Delta t\\, I \\\\ 0 & I \\end{bmatrix},\\ \\Delta t = 1 \\text{ frame}', note: 'Velocidad constante: cada coordenada suma su velocidad (Δt = 1 frame). Un track perdido se predice igual, pero ByteTrack pone en 0 la velocidad de la altura.' },
      { id: 'kf-FPF', op: 'head', label: 'P⁻ = F P Fᵀ + Q', sub: 'Q: ruido de proceso', subNum: 'Q: {{metrics.stateDim}}×{{metrics.stateDim}}, ∝ altura', x: 24, y: 32, w: 22, h: 9,
        when: { if: IS_SORT, set: { subNum: 'Q: {{metrics.stateDim}}×{{metrics.stateDim}}, fija' } },
        tex: 'P^- = F P F^\\top + Q', note: 'La incertidumbre crece en cada predicción: lo que el modelo de velocidad constante no explica (aceleraciones, giros) entra por Q. En ByteTrack, los desvíos de Q son proporcionales a la altura de la caja (1/20 para posición, 1/160 para velocidad): un objeto grande se mueve más píxeles. En SORT (filterpy), Q y R son constantes.' },
      { id: 'kf-z', op: 'io', label: 'Detección z', sub: 'la caja de su pareja', subNum: 'z: {{metrics.measDim}} números', x: 58, y: 14, w: 18, h: 9, note: 'La caja de la detección emparejada en la asociación, en el mismo formato que la parte de posición del estado.' },
      { id: 'kf-y', op: 'tensorop', shape: 'rect', label: 'y = z − H x⁻', sub: 'innovación', x: 82, y: 14, w: 16, h: 9,
        tex: 'y = z - H x^-,\\quad H = [\\,I_m \\;\\; 0\\,]', note: 'Cuánto se equivocó la predicción. H elige la parte de posición del estado: m × n con una identidad y ceros.' },
      { id: 'kf-S', op: 'head', label: 'S = H P⁻ Hᵀ + R', sub: 'm×m', subNum: '{{metrics.measDim}}×{{metrics.measDim}}', x: 58, y: 32, w: 18, h: 9,
        tex: 'S = H P^- H^\\top + R', note: 'La incertidumbre de la innovación: la de la predicción proyectada a la caja más el ruido de la detección R (en ByteTrack, también proporcional a la altura).' },
      { id: 'kf-K', op: 'head', label: 'K = P⁻ Hᵀ S⁻¹', sub: 'ganancia n×m', subNum: 'ganancia {{metrics.stateDim}}×{{metrics.measDim}}', x: 82, y: 32, w: 16, h: 9,
        tex: 'K = P^- H^\\top S^{-1}', note: 'Cuánto creerle a la detección: si la predicción es incierta (P⁻ grande) K se acerca a copiar z; si la detección es ruidosa (R grande), a quedarse con x⁻. ByteTrack no invierte S: la resuelve con Cholesky (S es simétrica definida positiva).' },
      { id: 'kf-xn', op: 'head', label: 'x = x⁻ + K y', sub: 'P = P⁻ − K S Kᵀ', x: 103, y: 23, w: 19, h: 10,
        when: { if: IS_SORT, set: { sub: 'P: forma de Joseph' } },
        tex: 'x = x^- + K y,\\qquad P = P^- - K S K^\\top', note: 'La media corregida y la covarianza achicada: después de ver la detección, el filtro está más seguro. P⁻ − K S Kᵀ es la forma que usa ByteTrack; SORT (filterpy) usa la forma de Joseph, P = (I − KH) P⁻ (I − KH)ᵀ + K R Kᵀ, más estable numéricamente.' },
      { id: 'kf-out', op: 'io', label: 'Track corregido', sub: 'al frame t + 1', x: 127, y: 23, w: 14.5, h: 10, note: 'Media y covarianza nuevas del track: el punto de partida del predict del frame siguiente.' },
    ],
    edges: [
      { from: 'kf-x', to: 'kf-Fx', kind: 'data', tensor: 'track-mean', labelSide: 'above', labelT: 0.5 },
      { from: 'kf-P', to: 'kf-FPF', kind: 'data', tensor: 'track-cov', labelSide: 'above', labelT: 0.5 },
      // al update entran solo las filas de los U tracks con pareja (el tensor del calculador es el de los T): rótulo propio
      { from: 'kf-Fx', to: 'kf-y', kind: 'data', tensor: 'pred-mean', fromSide: 'top', toSide: 'top', fromAt: 0.5, toAt: 0.5, via: [[35, 3], [90, 3]], label: false, tag: 'x⁻ de los U = {{metrics.updates}} con pareja', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      // x⁻ también entra a x = x⁻ + K y: sigue por la misma línea de arriba (una rama) y baja a la corrección
      { from: 'kf-Fx', to: 'kf-xn', kind: 'control', fromSide: 'top', toSide: 'top', fromAt: 0.5, toAt: 0.4737, via: [[35, 3], [112, 3]], tag: 'x⁻', tagStyle: 'plain', tagSide: 'on', tagSeg: 2, tagT: 0.45 },
      { from: 'kf-FPF', to: 'kf-S', kind: 'data', tensor: 'pred-cov', label: false, tag: 'P⁻ (U)', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      // P⁻ también entra a la ganancia K = P⁻ Hᵀ S⁻¹: por el hueco entre las dos filas
      { from: 'kf-FPF', to: 'kf-K', kind: 'control', fromSide: 'top', toSide: 'top', fromAt: 0.8, toAt: 0.5, via: [[41.6, 27.5], [90, 27.5]], tag: 'P⁻', tagStyle: 'plain', tagSide: 'on', tagSeg: 1, tagT: 0.5 },
      { from: 'kf-z', to: 'kf-y', kind: 'control', tag: 'z', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'kf-S', to: 'kf-K', kind: 'control', tag: 'S', tagStyle: 'plain', tagSide: 'above', tagT: 0.5 },
      { from: 'kf-y', to: 'kf-xn', kind: 'control', fromSide: 'right', toSide: 'top', toAt: 0.3, tag: 'y: {{metrics.measDim}}', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'kf-K', to: 'kf-xn', kind: 'control', fromSide: 'right', toSide: 'bottom', toAt: 0.3, tag: 'K', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'kf-xn', to: 'kf-out', kind: 'data', tensor: 'track-mean-new', label: false },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) una asociación por dentro
  register(Object.assign({
    id: 'association', model: 'bytetrack', config: C, configs: ALL, kind: 'arch',
    title: 'Asociación: IoU, costo y húngaro', parent: 'bytetrack-overview', parentNode: 'assoc-1',
    caption: 'La 1ª asociación por dentro. Cada track predicho se compara con cada detección alta por IoU (cuánto se solapan sus cajas): una matriz T × D. El costo es 1 − IoU (ByteTrack lo pondera por el score: 1 − IoU·s). El algoritmo húngaro elige las parejas, una por track y una por detección, que minimizan el costo total; con umbral θ una pareja con costo ≥ θ no se acepta. Lo que sobra sigue: tracks sin pareja a la 2ª asociación (en SORT, a perdidos), detecciones altas sin pareja a tracks nuevos. La tabla es ilustrativa; sus tamaños, del calculador.',
    grid: { w: 108, h: 80 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['as-iou', 'as-assign'], mobileFocusPad: 1,
    opLegend: { fuse: 'Asociación (sin parámetros)' },
    modLegend: { qry: 'Tensor: cajas, IoU y parejas' },
    edgeLegend: { control: 'Lo que queda sin pareja (sin tensor propio)' },
    legendText: { cells: 'Tabla de IoU (tono ilustrativo: más oscuro = más solapamiento)', cellsAssign: 'Matriz (tono = IoU, ilustrativo): recuadro = la pareja elegida, una por fila y por columna, con el menor costo total (el mayor IoU); ∅ = sin pareja: su fila no se solapa con nada (costo ≥ θ)' },
    nodes: [
      { id: 'as-tracks', op: 'io', label: 'Tracks predichos', sub: 'T cajas (Kalman)', x: 6, y: 1, w: 36, h: 7, note: 'Las cajas de todos los tracks (activos y perdidos) donde el Kalman predice que están en este frame.' },
      { id: 'as-dets', op: 'io', label: 'Detecciones altas', sub: 'D cajas con score', x: 66, y: 1, w: 36, h: 7, note: 'Las detecciones con score > {{metrics.trackHigh}}.' },
      { id: 'as-iou', op: 'fuse', ops: ['iou-1'], opsExact: true, label: 'IoU de cada par', sub: 'intersección / unión', x: 14, y: 12, w: 80, h: 24,
        cells: { rows: 'tensor.iou-1.0', cols: 'tensor.iou-1.1', maxR: 8, maxC: 14, cell: 12, mark: 'none', pale: [4], label: '{{tensor.iou-1.shape}} IoU', seed: 14 },
        tex: '\\mathrm{IoU}(a, b) = \\frac{|a \\cap b|}{|a \\cup b|}', note: 'Un número por par (track, detección): ' + q('metrics.iouPairs') + ' pares en las dos asociaciones de este frame, ≈ 12 operaciones cada uno. Es la medida de distancia de SORT y ByteTrack; DeepSORT y BoT-SORT le suman la distancia entre embeddings de apariencia (re-ID).' },
      { id: 'as-cost', op: 'fuse', ops: ['cost-1'], opsExact: true, label: 'Costo', sub: '1 − IoU · s', x: 30, y: 40, w: 48, h: 7,
        when: { if: IS_SORT, set: { sub: '1 − IoU' } },
        tex: 'C_{ij} = 1 - \\mathrm{IoU}_{ij} \\cdot s_j', note: 'ByteTrack (fuera de MOT20) pondera por el score: una detección floja necesita más solapamiento. En la 2ª asociación el costo es 1 − IoU, sin score.' },
      { id: 'as-assign', op: 'fuse', ops: ['assign-1'], opsExact: true, label: 'Húngaro con umbral', sub: 'mín Σ C con C < θ', subNum: 'θ = {{metrics.matchThresh}} · lapjv (T + D)²', x: 14, y: 51, w: 80, h: 17,
        when: { if: IS_SORT, set: { sub: 'mín Σ C, después IoU ≥ 0.3', subNum: 'IoU ≥ 0.3 · lapjv max(T, D)²' } },
        cells: { rows: 'tensor.iou-1.0', cols: 'tensor.iou-1.1', maxR: 5, maxC: 14, cell: 10, mark: 'assign', match: 'max', unmatched: 1, seed: 14 },
        tex: '\\min_{\\pi} \\sum_{(i,j) \\in \\pi} C_{ij}\\quad \\text{s.a. } C_{ij} < \\theta', note: 'La asignación 1 a 1 de costo total mínimo (Kuhn, 1955). El código usa <code>lap.lapjv</code> (Jonker-Volgenant, O(n³)) con <code>cost_limit</code> = θ: la matriz se extiende a (T + D) × (T + D) con θ/2 fuera del bloque de costos, así que dejar un track y una detección sin pareja cuesta θ y una pareja solo conviene si su costo es menor. SORT asigna sin umbral (lapjv con <code>extend_cost</code>, lado máx(T, D)) y después descarta las parejas con IoU &lt; 0.3. ≈ ' + q('metrics.assignOps') + ' operaciones en el peor caso: n³ por pasada, con n = T + D (filas + columnas de la matriz extendida; SORT: n = máx(T, D)).' },
      { id: 'as-matched', op: 'io', label: 'Parejas', sub: '→ Kalman update', x: 2, y: 72.5, w: 32, h: 6.5, note: 'Track ↔ detección: cada track corrige su Kalman con la caja de su pareja.' },
      { id: 'as-utrack', op: 'io', label: 'Tracks sin pareja', sub: '→ 2ª asociación', x: 38, y: 72.5, w: 32, h: 6.5,
        when: { if: IS_SORT, set: { sub: '→ perdidos (SORT)' } },
        note: 'Los activos van a la 2ª asociación con las detecciones bajas; los que ya estaban perdidos siguen perdidos. SORT no tiene 2ª asociación: pasan directo a perdidos (y se borran según <code>max_age</code>).' },
      { id: 'as-udet', op: 'io', label: 'Altas sin pareja', sub: '→ tracks nuevos', x: 74, y: 72.5, w: 32, h: 6.5, note: 'Con score ≥ {{metrics.newTrackThresh}} abren un track nuevo (sin confirmar hasta el frame siguiente).' },
    ],
    edges: [
      { from: 'as-tracks', to: 'as-iou', kind: 'data', tensor: 'pred-mean', toAt: 0.3, labelSide: 'left', labelT: 0.5 },
      { from: 'as-dets', to: 'as-iou', kind: 'data', tensor: 'dets-high', toAt: 0.7, labelSide: 'right', labelT: 0.5 },
      { from: 'as-iou', to: 'as-cost', kind: 'data', tensor: 'iou-1', label: false },
      { from: 'as-cost', to: 'as-assign', kind: 'data', tensor: 'cost-1', labelSide: 'right', labelT: 0.5 },
      { from: 'as-assign', to: 'as-matched', kind: 'data', tensor: 'matches-1', fromAt: 0.2, labelSide: 'left', labelT: 0.5 },
      { from: 'as-assign', to: 'as-utrack', kind: 'control', fromAt: 0.5, tag: 'filas ∅', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
      { from: 'as-assign', to: 'as-udet', kind: 'control', fromAt: 0.8, tag: 'columnas sin pareja', tagStyle: 'plain', tagSide: 'on', tagT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
