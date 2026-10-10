/* =============================================================================
   Atlas de Arquitecturas — js/content/bytetrack.js
   Página de modelo: multi-object tracking por detección — SORT, DeepSORT, ByteTrack (BoT-SORT / OC-SORT breves).
   Canónica bytetrack-mot17 (repo oficial ifzhang/ByteTrack para MOT17: YOLOX-X a 1440×800, track_thresh 0.6, caja baja
   > 0.1, nuevo track ≥ track_thresh + 0.1, track_buffer 30, Kalman de 8 estados con velocidad constante). Plantilla fija
   de 11 secciones (SPEC §5.3, §26.1). Un tracker no es una red: no tiene pesos aprendidos; "arquitectura" = el bucle por
   frame (predecir, asociar, actualizar, ciclo de vida), "costo" = FLOPs del filtro de Kalman, de la matriz de IoU y de la
   asignación, comparados con los MACs del detector.
   Tesis de la fase (SPEC §26): percepción para un robot = detección + tiempo + geometría.
   Papers: Bewley et al., SORT, ICIP 2016 (arXiv:1602.00763); Wojke, Bewley y Paulus, DeepSORT, ICIP 2017
   (arXiv:1703.07402); Zhang et al., ByteTrack, ECCV 2022 (arXiv:2110.06864); Aharon, Orfaig y Bobrovsky, BoT-SORT
   (arXiv:2206.14651); Cao et al., OC-SORT, CVPR 2023 (arXiv:2203.14360); Bernardin y Stiefelhagen, CLEAR MOT, EURASIP
   JIVP 2008; Ristani et al., IDF1, ECCV 2016 Workshops (arXiv:1609.01775); Luiten et al., HOTA, IJCV 129, 2021
   (arXiv:2009.07736).
   Verificado contra el código: ifzhang/ByteTrack (yolox/tracker/byte_tracker.py, kalman_filter.py, matching.py,
   tools/track.py, tools/demo_track.py, yolox/evaluators/mot_evaluator.py, exps/example/mot/yolox_x_mix_det.py),
   abewley/sort (sort.py), nwojke/deep_sort (tracker.py, track.py, deep_sort_app.py) y ultralytics 8.4.174
   (trackers/byte_tracker.py, trackers/utils/kalman_filter.py, cfg/trackers/bytetrack.yaml). Los ejercicios a mano se
   verificaron con KalmanFilterXYAH de ultralytics y con el KalmanFilter oficial (idénticos), y con
   scipy.optimize.linear_sum_assignment (scratchpad build14/tracking-ex: kalman_ex.py, assign_ex.py, bytetrack_assoc.py).
   Regla: ningún número del tracker ni del detector (FLOPs, MACs, bytes, frames, umbrales de la config) se escribe a mano:
   sale del calculador (js/arch/perception.js, modelo bytetrack; bloques op/trace/params/scaling/compare y cantidades
   {{config.ruta}}, SPEC §6.6). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/perception.js, SPEC §26.1).
  const C = 'bytetrack-mot17';          // canónica: repo oficial, MOT17, YOLOX-X 1440×800
  const S = 'sort';                     // Kalman + húngaro sobre IoU, solo cajas altas, sin segunda pasada
  const U = 'bytetrack-ultralytics';    // defaults de ultralytics bytetrack.yaml, detector YOLOv8

  // Claves de metrics() del calculador (arch-ids.md, fase 14). Un solo lugar para adaptarlas.
  const MK = {
    kfPredict: 'kalmanPredictMacs', kfUpdate: 'kalmanUpdateMacs', kfTrack: 'kalmanFlopsPerTrack',
    iou: 'iouOps', assign: 'assignOps', tracker: 'trackerOps', trackerFlops: 'trackerFlops', det: 'detectorMacs',
    detF: 'detectorFlops', share: 'trackerShare', lostFrames: 'framesLost', lostSec: 'secondsLost',
    trackBytes: 'kalmanBytesPerTrack', trackerMem: 'trackMemBytes', nx: 'stateDim', nz: 'measDim', nTracks: 'nTracks',
    high: 'trackHigh', low: 'trackLow', newT: 'newTrackThresh', match: 'matchThresh', match2: 'matchThresh2',
    unconf: 'unconfirmedThresh', buffer: 'trackBuffer', fps: 'fps',
  };
  // Knobs de la config (cfg.*): detecciones y tracks de la carga de referencia, fps, % de cajas bajas.
  const CF = { nDet: 'nDet', nTracks: 'nTracks', fps: 'fps', lowPct: 'lowPct' };
  // Ids de tensores del calculador (arch-ids.md).
  const T = { frame: 'frame', dets: 'dets', high: 'dets-high', low: 'dets-low', mean: 'track-mean', cov: 'track-cov',
    pmean: 'pred-mean', pcov: 'pred-cov', iou1: 'iou-1', cost1: 'cost-1', m1: 'matches-1', iou2: 'iou-2', cost2: 'cost-2',
    m2: 'matches-2', upd: 'track-mean-new', out: 'tracks-out' };
  // Nodos (último elemento del path de las ops; assoc-1 y assoc-2 repiten iou / cost / assign → scope).
  const N = { detector: 'detector', split: 'split', predict: 'predict', assoc1: 'assoc-1', assoc2: 'assoc-2',
    iou: 'iou', cost: 'cost', assign: 'assign', update: 'update', manage: 'manage' };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const cf = (k, cfg) => qn('cfg.' + (CF[k] || k), cfg);
  const th = (k, cfg) => met(k, cfg);   // umbrales, buffer, dimensiones del estado: metrics del calculador

  const SORT = 'Bewley, Ge, Ott, Ramos y Upcroft, <i>Simple Online and Realtime Tracking</i>, ICIP 2016, arXiv:1602.00763';
  const DSORT = 'Wojke, Bewley y Paulus, <i>Simple Online and Realtime Tracking with a Deep Association Metric</i>, ICIP 2017, arXiv:1703.07402';
  const BYTE = 'Zhang et al., <i>ByteTrack: Multi-Object Tracking by Associating Every Detection Box</i>, ECCV 2022, arXiv:2110.06864';
  const BOT = 'Aharon, Orfaig y Bobrovsky, <i>BoT-SORT: Robust Associations Multi-Pedestrian Tracking</i>, arXiv:2206.14651, 2022';
  const OCS = 'Cao et al., <i>Observation-Centric SORT: Rethinking SORT for Robust Multi-Object Tracking</i>, CVPR 2023, arXiv:2203.14360';
  const CLEAR = 'Bernardin y Stiefelhagen, <i>Evaluating Multiple Object Tracking Performance: The CLEAR MOT Metrics</i>, EURASIP Journal on Image and Video Processing, 2008';
  const IDF = 'Ristani et al., <i>Performance Measures and a Data Set for Multi-Target, Multi-Camera Tracking</i>, ECCV 2016 Workshops, arXiv:1609.01775';
  const HOTA = 'Luiten et al., <i>HOTA: A Higher Order Metric for Evaluating Multi-Object Tracking</i>, IJCV 129, 2021, arXiv:2009.07736';
  const MOT16 = 'Milan et al., <i>MOT16: A Benchmark for Multi-Object Tracking</i>, arXiv:1603.00831, 2016 (MOT17 usa las mismas secuencias con tres detectores públicos)';
  const MOT20 = 'Dendorfer et al., <i>MOT20: A benchmark for multi object tracking in crowded scenes</i>, arXiv:2003.09003, 2020';
  const YOLOX = 'Ge et al., <i>YOLOX: Exceeding YOLO Series in 2021</i>, arXiv:2107.08430';
  const STRONG = 'Du et al., <i>StrongSORT: Make DeepSORT Great Again</i>, arXiv:2202.13514 (IEEE TMM 2023)';
  const DANCE = 'Sun et al., <i>DanceTrack: Multi-Object Tracking in Uniform Appearance and Diverse Motion</i>, CVPR 2022, arXiv:2111.14690';
  const MOTR = 'Zeng et al., <i>MOTR: End-to-End Multiple-Object Tracking with Transformer</i>, ECCV 2022, arXiv:2105.03247';
  const AB3D = 'Weng, Wang, Held y Kitani, <i>3D Multi-Object Tracking: A Baseline and New Evaluation Metrics</i> (AB3DMOT), IROS 2020, arXiv:1907.03961';
  const CPOINT = 'Yin, Zhou y Krähenbühl, <i>Center-based 3D Object Detection and Tracking</i> (CenterPoint), CVPR 2021, arXiv:2006.11275';
  const BYTE2 = 'Zhang et al., <i>ByteTrackV2: 2D and 3D Multi-Object Tracking by Associating Every Detection Box</i>, arXiv:2303.15334';

  ATLAS.register({
    id: 'bytetrack',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> dado un video y, en cada frame, las cajas que devuelve un detector (YOLO, DETR), devolver las mismas cajas con un <b>id persistente</b>: "la persona 7 es la misma persona 7 que hace 40 frames". Es <b>tracking por detección</b>: el detector dice <i>qué hay</i> en cada imagen; el tracker dice <i>quién es quién</i> a lo largo del tiempo. Por cada frame hace cuatro cosas: predecir dónde estará cada track (un filtro de Kalman con velocidad constante), comparar esas predicciones con las detecciones nuevas (una matriz de IoU), resolver quién va con quién (una asignación uno a uno: el algoritmo húngaro o LAPJV) y actualizar, crear o borrar tracks.` },
          { t: 'p', html: R`Lo que agrega <b>ByteTrack</b> sobre SORT es una idea de una línea: <b>no tirar las detecciones de baja confianza</b>. Una persona que queda medio tapada sigue apareciendo en la salida del detector, pero con score 0.3 en vez de 0.9; SORT la descarta con el umbral y el track se pierde (y vuelve con otro id). ByteTrack primero asocia las cajas altas (score &gt; ${th('high')}) y después intenta asociar las cajas bajas (entre ${th('low')} y ${th('high')}) <b>solo con los tracks que quedaron sin pareja</b>. Con eso recupera oclusiones sin aceptar el ruido de fondo, porque una caja baja que no se superpone con ningún track nunca crea uno nuevo. Todo el tracker cuesta ${est('≈ ' + met('tracker'))} operaciones por frame en la canónica (${cf('nDet')} detecciones, ${cf('nTracks')} tracks), contra ${met('det')} del detector: ${est('≈ ' + met('share'))} del cómputo.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Tracking por detección (SORT / ByteTrack)?', 'Por qué'], rows: [
            ['Contar personas o vehículos que cruzan una línea, tiempo de permanencia, trayectorias en cámaras fijas', '<b>Sí, empieza aquí</b>', 'Barato (corre en CPU al lado del detector), sin entrenamiento propio, y el id persistente es justo lo que necesitas para no contar dos veces.'],
            ['Robot móvil que sigue o esquiva personas en un almacén', 'Sí, con compensación del movimiento de la cámara', 'Con la cámara en movimiento, la velocidad constante en píxeles deja de valer: hay que restar el ego-movimiento (odometría, IMU o flujo óptico global, como BoT-SORT) o trackear en 3-D.'],
            ['Oclusiones largas (segundos) y personas que vuelven a entrar a la escena', 'Con ReID (DeepSORT, BoT-SORT)', R`Solo con movimiento, un track perdido más de ${th('buffer')} frames se borra y vuelve con id nuevo. Para re-identificar hace falta apariencia (un embedding por caja).`],
            ['Varias cámaras que se solapan o se pasan a las personas (tienda, estación)', 'Es otro problema: multi-camera tracking (MTMC)', 'El IoU no existe entre cámaras distintas: se asocia por apariencia y por geometría (calibración, plano del piso). IDF1 nació para evaluar esto.'],
            ['Objetos que se mueven de forma muy no lineal y se parecen entre sí (danza, deportes)', 'Con cuidado', R`IoU + Kalman con velocidad constante falla cuando la trayectoria gira bruscamente y la apariencia no distingue; es la motivación de DanceTrack (${DANCE}) y de OC-SORT.`],
            ['Puedes reentrenar de punta a punta y tienes datos de video anotados con ids', 'Compara con trackers end-to-end (MOTR)', 'Aprenden detección y asociación juntas con queries que persisten entre frames; más caros y más difíciles de ajustar a un dominio nuevo que "detector + ByteTrack".'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Tracking by detection splits the problem in two: a detector gives boxes per frame, and a lightweight tracker links them over time. Each track has a constant-velocity Kalman filter over box center, aspect ratio and height. Every frame I predict all tracks, compute an IoU cost matrix against the new detections, solve a one-to-one assignment with the Hungarian algorithm, update matched tracks, start new tracks from unmatched confident detections, and delete tracks that stay lost for longer than a buffer. ByteTrack adds a second association with the low-confidence detections, only against the tracks left unmatched, which recovers occluded objects without creating tracks from background noise. The tracker is a tiny fraction of the compute; the detector dominates."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como YOLO, pero con memoria.</b> YOLO procesa cada imagen sola: devuelve cajas con score, aplica un umbral de confianza y NMS, y olvida todo. El tracker es el post-proceso que <b>recuerda</b>: guarda un estado por objeto y lo empareja con las cajas del frame siguiente. Las herramientas son las que ya usas. IoU, que en NMS compara cajas del <i>mismo</i> frame para borrar duplicados, aquí compara la caja <i>predicha</i> de cada track con las detecciones <i>nuevas</i>. El matching húngaro es el de <a href="#detr.operaciones">DETR</a>: allí empareja queries con objetos para la pérdida; aquí, tracks con detecciones. Y el filtro de Kalman es el de control y estimación de estado que viste en mecatrónica, con el modelo más simple posible: velocidad constante.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma del tracking', head: ['Concepto', 'Donde lo viste', 'En SORT / ByteTrack', '¿Nuevo?'], rows: [
            ['IoU entre cajas', 'NMS y mAP en YOLO (umbral 0.5 para un TP)', R`Costo de asociación: c = 1 − IoU(caja predicha del track, detección); un par con IoU por debajo del umbral no se acepta`, 'Igual'],
            ['Asignación uno a uno de costo mínimo', 'Matching húngaro de DETR (queries ↔ objetos)', 'Tracks ↔ detecciones de este frame, resuelto en cada frame (LAPJV en el código oficial)', 'Igual'],
            ['Filtro de Kalman', 'Estimación de estado en control / robótica (posición, velocidad, IMU + GPS)', R`Estado de ${th('nx')} dimensiones por track (x, y, a, h y sus velocidades), medición de ${th('nz')} (la caja), modelo de velocidad constante con dt = 1 frame`, 'Igual'],
            ['Umbral de confianza', 'conf_thres de YOLO antes de NMS', R`Dos umbrales: alto (${th('high')}) para la primera asociación y para crear tracks, bajo (${th('low')}) para la segunda`, 'Cambia'],
            ['Asociación de datos en el tiempo y ciclo de vida del track', '—', 'Tracks nuevos, confirmados, perdidos y borrados; un buffer de frames antes de borrar', '<b>Nuevo</b>'],
            ['Usar las detecciones de baja confianza', '— (en YOLO se tiran)', 'Segunda pasada solo contra los tracks sin pareja: recupera oclusiones', '<b>Nuevo</b>'],
          ] },
          { t: 'callout', kind: 'trap', title: '"El tracker mejora al detector"', html: R`<p>Solo en parte. Un tracker puede rellenar huecos cortos (la segunda pasada de ByteTrack, la interpolación offline) y suavizar cajas, pero no inventa objetos que el detector nunca vio ni arregla cajas sistemáticamente malas. SORT ya lo decía: la calidad de la detección es un factor clave del desempeño del tracking (${SORT}, §4). En el propio repo se ve: con la misma asociación BYTE, el model zoo da 90.0 MOTA con YOLOX-X y 79.2 con YOLOX-S (evaluados sobre MOT17 train, así que inflados), mientras que pasar de SORT a BYTE con el mismo detector mueve 2 puntos en validación (Tabla 2 del paper). Por eso los papers de tracking comparan asociaciones con el mismo detector.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>El detector de la canónica es YOLOX-X (anchor-free, de la familia YOLO); en ultralytics, el mismo tracker va detrás de YOLOv8 (<a href="#yolo-world">YOLO-World</a> tiene el puente con YOLOv8). Lo que entra al tracker es lo que sale de la cabeza después de NMS; lo que sale del tracker es lo que consume la aplicación (conteo, planeación de trayectorias del robot).</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`El bucle de un frame. El detector da N<sub>det</sub> = ${cf('nDet')} cajas con score; se separan en altas (score &gt; ${th('high')}) y bajas (entre ${th('low')} y ${th('high')}). Los N<sub>trk</sub> = ${cf('nTracks')} tracks del pool (activos y perdidos recientes) se <b>predicen</b> con Kalman. <b>Primera asociación</b>: IoU entre tracks predichos y cajas altas, asignación uno a uno con umbral. <b>Segunda asociación</b>: los tracks que quedaron solos contra las cajas bajas. Los emparejados se <b>actualizan</b> con su caja; las cajas altas sin pareja abren tracks nuevos; los tracks sin pareja pasan a perdidos y, si siguen así más de ${met('lostFrames')} frames, se borran. Las flechas son listas de cajas y matrices chicas, no tensores de features.` },
          { t: 'archdiagram', diagram: 'bytetrack-overview', walk: 'forward', wide: true, caption: R`ByteTrack, canónica ${C}: detector YOLOX-X a 1440×800, ${cf('nDet')} detecciones y ${cf('nTracks')} tracks por frame (carga de referencia del calculador). Abre "Kalman: predict" para ver el filtro de Kalman y "1ª asociación" para ver la matriz de IoU.` },
          { t: 'p', html: R`<b>El filtro de Kalman de un track.</b> Mueve el ruido del proceso q y el de la medición r, y cambia la oclusión: durante la oclusión solo hay predicción, la elipse de incertidumbre crece y la caja sigue en línea recta. Si la oclusión dura más que el buffer del track, el objeto vuelve con un id nuevo.` },
          { t: 'viz', kind: 'kalman-track', params: { config: C, q: 0.5, r: 6, occ: 'short' }, caption: 'Trayectoria y detecciones sintéticas (rotuladas): un filtro 2-D de 4 estados, la misma estructura que el de 8 estados de ByteTrack. track_buffer y fps salen de la config.' },
          { t: 'archdiagram', diagram: 'kalman', caption: 'Predict y update de un track: x′ = F x, P′ = F P Fᵀ + Q; S = H P′ Hᵀ + R, K = P′ Hᵀ S⁻¹, x = x′ + K (z − H x′). Tamaños del calculador.' },
          { t: 'p', html: R`<b>La asociación.</b> Cajas de tracks predichos y de detecciones, la matriz de IoU, el costo 1 − IoU, el umbral y la asignación. Después, la segunda pasada de ByteTrack con las cajas bajas contra los tracks que sobraron.` },
          { t: 'viz', kind: 'hungarian-iou', params: { config: C, method: 'byte', pass: 1, view: 'cost' }, caption: 'Cajas y scores sintéticos (rotulados). Cambia a la segunda pasada y compara con SORT, que no la tiene. Umbrales de la config canónica.' },
          { t: 'archdiagram', diagram: 'association', caption: 'Matriz de IoU (tracks × detecciones), costo = 1 − IoU, umbral y asignación uno a uno.' },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación, con un solo track. Una persona estaba en el frame anterior con centro (100, 200), altura 100 px y ancho 50 px (aspecto a = w/h = 0.5), recién creada: velocidad 0. <b>Predecir</b>: con velocidad 0, la caja predicha queda donde estaba, pero la incertidumbre crece. <b>Asociar</b>: el detector ve una caja con centro (104, 202) y la misma altura; el IoU con la predicha es alto y la asignación la empareja. <b>Actualizar</b>: el centro nuevo no es ni 100 ni 104: es 103.47, porque el filtro confía ≈ 87 % en la detección y ≈ 13 % en su predicción; y la velocidad pasa de 0 a 0.83 px por frame, porque una parte de la sorpresa se atribuye a que la persona se está moviendo. En el frame siguiente la predicción ya avanza: 104.30. El ejercicio completo está en <a href="#bytetrack.practica">práctica</a>.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Canónica'], rows: [
            ['x ∈ ℝ⁸', R`Estado de un track: (x, y, a, h, ẋ, ẏ, ȧ, ḣ): centro, aspecto w/h, altura y sus velocidades en píxeles por frame`, R`${th('nx')} dimensiones`],
            ['z ∈ ℝ⁴', 'Medición: la caja detectada en el mismo formato (x, y, a, h)', R`${th('nz')} dimensiones`],
            ['P, Q, R', 'Covarianza del estado (8×8), ruido del proceso (8×8) y de la medición (4×4)', 'Diagonales, proporcionales a h² (abajo)'],
            ['F, H', 'Transición (8×8, velocidad constante con dt = 1) y observación (4×8, toma las primeras 4 componentes)', '—'],
            ['N<sub>det</sub>, N<sub>trk</sub>', 'Detecciones del frame (score &gt; 0.1) y tracks del pool (activos + perdidos)', R`${cf('nDet')}, ${cf('nTracks')}`],
            ['τ<sub>high</sub>, τ<sub>low</sub>', 'Umbral de score para la primera asociación y piso de las cajas bajas', R`${th('high')}, ${th('low')}`],
            ['τ<sub>new</sub>', 'Score mínimo para abrir un track nuevo (en el código oficial, track_thresh + 0.1)', th('newT')],
            ['match_thresh', 'Costo máximo aceptado en la primera asociación (costo = 1 − IoU·score en el código oficial de MOT17)', th('match')],
            ['track_buffer', 'Frames que un track perdido espera antes de borrarse (a 30 fps)', th('buffer')],
          ] },

          { t: 'h3', text: '1. Detectar y separar por score' },
          { t: 'op', block: N.detector, model: 'bytetrack', title: 'Detector (YOLOX-X) + NMS',
            tex: R`\{(b_j, s_j)\}_{j=1}^{N_\text{det}} = \mathrm{NMS}\big(\mathrm{Det}(I_t)\big),\qquad b_j = (x_1, y_1, x_2, y_2)`,
            in: [T.frame], out: [T.dets],
            what: R`El detector corre sobre el frame a 1440×800 (la config de MOT17 del repo: <code>test_size = (800, 1440)</code>, una clase, persona) y devuelve cajas con score después de NMS (IoU 0.7). Es el 99.x % del cómputo: los MACs salen del calculador. El umbral de confianza del detector es muy bajo (0.01 en <code>tools/track.py</code>): el filtrado lo hace el tracker.`,
            why: R`El tracker necesita <b>todas</b> las cajas, también las de score 0.1–0.6, porque ahí están los objetos ocluidos. Un detector con umbral 0.5 delante de ByteTrack lo convierte en SORT. ${YOLOX}.` },
          { t: 'op', block: N.split, model: 'bytetrack', title: 'Separar cajas altas y bajas',
            tex: R`\mathcal D_\text{high} = \{ j : s_j > \tau_\text{high} \},\qquad \mathcal D_\text{low} = \{ j : \tau_\text{low} < s_j \le \tau_\text{high} \}`,
            in: [T.dets], out: [T.high, T.low],
            what: R`Dos listas: altas (score &gt; ${th('high')}) y bajas (entre ${th('low')} y ${th('high')}). Lo que queda debajo de ${th('low')} se descarta: es casi todo fondo. En la carga de referencia del calculador, el ${cf('lowPct')} % de las ${cf('nDet')} detecciones es baja.`,
            why: R`El paper lo dice así: los objetos ocluidos o borrosos bajan de score; tirarlos fragmenta las trayectorias. Pero tampoco se pueden tratar como altas: entre las bajas hay mucho fondo. La separación permite usar cada grupo para lo que sirve (§3 de ${BYTE}).` },

          { t: 'h3', text: '2. Predecir: el filtro de Kalman con velocidad constante' },
          { t: 'p', html: R`En el diagrama es el bloque <a href="#bytetrack.diagrama~predict">Kalman: predict</a> (ábrelo para ver las matrices). El modelo: entre un frame y el siguiente, cada componente de la caja avanza con su velocidad (dt = 1 frame) y la velocidad no cambia, salvo por ruido. Con ocho estados y cuatro mediciones, las matrices son bloques de identidades de 4×4:` },
          { t: 'math', display: true, tex: R`\mathbf x = \begin{bmatrix} x & y & a & h & \dot x & \dot y & \dot a & \dot h \end{bmatrix}^\top,\qquad F = \begin{bmatrix} I_4 & I_4 \\ 0 & I_4 \end{bmatrix}\in\mathbb R^{8\times 8},\qquad H = \begin{bmatrix} I_4 & 0 \end{bmatrix}\in\mathbb R^{4\times 8}`, caption: 'F suma la velocidad a la posición (x_t = x_{t−1} + ẋ_{t−1}); H lee la caja del estado. Es el modelo de DeepSORT, que ByteTrack copia sin cambios (kalman_filter.py).' },
          { t: 'op', block: N.predict, model: 'bytetrack', title: 'Predict: x′ = F x, P′ = F P Fᵀ + Q',
            tex: R`\mathbf x_{t\mid t-1} = F\,\mathbf x_{t-1},\qquad P_{t\mid t-1} = F\,P_{t-1}\,F^\top + Q_t`,
            in: [T.mean, T.cov], out: [T.pmean, T.pcov],
            what: R`Para cada track activo o perdido: la media avanza un paso y la covarianza crece en Q. El código lo hace vectorizado para todos los tracks a la vez (<code>multi_predict</code>). Cuesta ${met('kfPredict')} por track en el calculador (los productos F x y F P Fᵀ con matrices 8×8).`,
            why: R`Es la caja con la que se va a comparar cada detección: comparar contra la posición del frame anterior falla en cuanto el objeto se mueve más que una fracción de su ancho. Detalle del código (oficial y ultralytics): si el track está perdido, se pone ḣ = 0 antes de predecir, para que una caja que nadie ve no siga creciendo o encogiendo frame tras frame.` },
          { t: 'math', display: true, tex: R`Q_t = \mathrm{diag}\big(\sigma_p^2 h^2,\ \sigma_p^2 h^2,\ 10^{-4},\ \sigma_p^2 h^2,\ \sigma_v^2 h^2,\ \sigma_v^2 h^2,\ 10^{-10},\ \sigma_v^2 h^2\big),\qquad \sigma_p = \tfrac{1}{20},\ \ \sigma_v = \tfrac{1}{160}`, caption: 'Ruido del proceso en el código de DeepSORT / ByteTrack / ultralytics (_std_weight_position = 1/20, _std_weight_velocity = 1/160): desviaciones de 5 % de la altura para la posición y 0.625 % por frame para la velocidad; el aspecto a usa constantes (1e-2 y 1e-5 de desviación) porque no tiene unidades. h es la altura ESTIMADA del track en ese momento.' },
          { t: 'callout', kind: 'why', title: '¿Por qué el ruido escala con la altura de la caja?', html: R`<p>Porque el error de un detector en píxeles es proporcional al tamaño del objeto: una persona lejana de 50 px de alto se detecta con un error de un par de píxeles; una cercana de 400 px, con un error de 20. Un ruido fijo en píxeles sería demasiado confiado con las cajas grandes y demasiado permisivo con las chicas. Con <b>todas</b> las varianzas (Q, R y la P inicial) proporcionales a h², el filtro es <b>invariante a escala</b>: la ganancia de Kalman K no depende de h, y una persona el doble de grande con un desplazamiento el doble de grande recibe exactamente la misma corrección relativa (verificado: con h = 100 y 4 px de innovación el centro se mueve 3.47 px; con h = 200 y 8 px, 6.94 px). No es una derivación del paper: es una heurística del código de DeepSORT que ByteTrack hereda. BoT-SORT la cambia a un estado (x, y, w, h) con ruidos proporcionales al ancho y a la altura por separado (${BOT}, §3.1).</p><p>SORT, en cambio, usa un estado de 7 (x, y, s = área, r = aspecto, ẋ, ẏ, ṡ), supone r constante y ruidos fijos en el código (<code>R[2:,2:] *= 10</code>, <code>P[4:,4:] *= 1000</code> para las velocidades iniciales, que no se observan).</p>` },

          { t: 'h3', text: '3. Asociar: matriz de IoU y asignación uno a uno' },
          { t: 'op', block: N.iou, scope: N.assoc1, model: 'bytetrack', title: 'Matriz de IoU y costo: 1 − IoU (× score)',
            tex: R`C_{ij} = 1 - \mathrm{IoU}\big(H\mathbf x_{i,\,t\mid t-1},\ b_j\big)\cdot s_j,\qquad \mathrm{IoU}(A,B) = \frac{|A\cap B|}{|A| + |B| - |A\cap B|}`,
            in: [T.pmean, T.high], out: [T.iou1, T.cost1],
            what: R`Una matriz N<sub>trk</sub> × N<sub>high</sub>: el IoU de cada caja predicha con cada caja alta. El código oficial para MOT17 multiplica el IoU por el score de la detección (<code>fuse_score</code>; en MOT20, con <code>--mot20</code>, no); ultralytics lo hace por defecto (<code>fuse_score: True</code>). Cada par cuesta un puñado de mínimos, máximos y productos: ${met('iou')} FLOPs para la matriz entera en el calculador.`,
            why: R`IoU es barato, no necesita ningún modelo de apariencia y funciona cuando el movimiento entre frames es chico comparado con el tamaño de la caja (30 fps, personas caminando). Multiplicar por el score hace que, entre dos cajas con IoU parecido, gane la más confiable. El costo no usa la covarianza P: dos tracks con la misma media cuestan lo mismo aunque uno sea muy incierto. DeepSORT sí la usa, para descartar pares imposibles con la distancia de Mahalanobis.` },
          { t: 'op', block: N.assign, scope: N.assoc1, model: 'bytetrack', title: 'Asignación de costo mínimo con umbral',
            tex: R`\min_{\pi}\ \sum_{(i,j)\in\pi} C_{ij}\quad \text{s.a. cada track y cada detección en a lo sumo un par},\qquad (i,j)\ \text{válido} \iff C_{ij}\le \text{match\_thresh}`,
            in: [T.cost1], out: [T.m1],
            what: R`Se resuelve el problema de asignación lineal: el emparejamiento uno a uno que minimiza el costo total. El código oficial y ultralytics usan <code>lap.lapjv(cost, extend_cost=True, cost_limit=thresh)</code> (Jonker-Volgenant), que resuelve directamente "emparejar o dejar solo": un par más caro que el límite nunca se elige. SORT usa el húngaro de scipy (<code>linear_sum_assignment</code> sobre −IoU) y después descarta los pares con IoU &lt; 0.3. Peor caso O(n³) con n = max(N<sub>trk</sub>, N<sub>det</sub>): ${est(met('assign') + ' operaciones')} en el calculador, una cota.`,
            why: R`Uno a uno porque una persona no puede ser dos tracks ni un track dos personas. Global (y no voraz) porque, con gente cerca, el mejor par aislado puede dejar a otro track sin pareja: en el ejercicio de práctica, el voraz pierde un track y crea uno nuevo (un cambio de id) donde la asignación óptima explica todo con un solo desplazamiento de la escena. El umbral es parte del modelo: sin él, scipy empareja también pares con IoU = 0.` },
          { t: 'callout', kind: 'trap', title: 'match_thresh: el paper dice IoU 0.2, el script de MOT17 usa 0.9 sobre el costo fusionado', html: R`<p>El paper (§4.1) rechaza la asignación si el IoU es menor que 0.2, o sea costo 1 − IoU &gt; 0.8. En el repo, <code>tools/demo_track.py</code> usa <code>match_thresh = 0.8</code>, pero <code>tools/track.py</code> (el que reproduce MOT17) usa <code>0.9</code> por defecto, y sobre el costo <b>fusionado</b> 1 − IoU·score: acepta pares con IoU·score ≥ 0.1. Para MOT20 el README pide <code>--match_thresh 0.7</code> y <code>--mot20</code> (sin fusión). ultralytics usa 0.8 con fusión. "Los defaults de ByteTrack" dependen del script: escríbelos explícitos.</p>` },
          { t: 'op', block: N.assoc2, model: 'bytetrack', title: 'Segunda asociación: tracks sin pareja × cajas bajas',
            tex: R`C^{(2)}_{ij} = 1 - \mathrm{IoU}\big(H\mathbf x_{i,\,t\mid t-1},\ b_j\big),\qquad i \in \mathcal T_\text{unmatched}\ (\text{estado: tracked}),\ \ j \in \mathcal D_\text{low},\qquad C^{(2)}_{ij}\le 0.5`,
            in: [T.pmean, T.low], out: [T.iou2, T.cost2, T.m2],
            what: R`Solo los tracks que estaban siendo seguidos en el frame anterior y quedaron sin pareja (los perdidos no entran) contra las cajas bajas, con IoU puro (sin score) y un umbral más estricto: IoU ≥ 0.5. Las cajas bajas que no se emparejan se <b>descartan</b>: nunca abren un track.`,
            why: R`Es todo ByteTrack (en el diagrama, <a href="#bytetrack.diagrama~assoc-2">2ª asociación</a>). Una caja baja que coincide con la predicción de un track que se acaba de quedar sin detección alta es casi seguro el mismo objeto, ocluido. Una caja baja aislada es casi seguro fondo. El IoU (y no la apariencia) porque las cajas bajas son justo las ocluidas o borrosas, donde un embedding de ReID es poco confiable: en la Tabla 1 del paper, IoU en la segunda asociación da 76.6 MOTA en MOT17 val contra 75.8 con ReID (con IoU en la primera).` },
          { t: 'op', block: N.update, model: 'bytetrack', title: 'Update: corregir con la caja emparejada',
            tex: R`S = H P' H^\top + R,\quad K = P' H^\top S^{-1},\quad \mathbf x = \mathbf x' + K\,(\mathbf z - H\mathbf x'),\quad P = P' - K S K^\top`,
            in: [T.pmean, T.pcov, T.m1, T.m2], out: [T.upd],
            what: R`Para cada par emparejado: la innovación z − Hx′ (cuánto se equivocó la predicción), su covarianza S (4×4), la ganancia K (8×4) y la corrección. El código resuelve el sistema lineal con S en vez de invertirla. ${met('kfUpdate')} por track emparejado en el calculador. R = diag((h/20)², (h/20)², 0.1², (h/20)²): la medición también escala con la altura.`,
            why: R`K reparte la sorpresa entre "me equivoqué de posición" y "me equivoqué de velocidad" según las incertidumbres: con P′ grande (track nuevo o que volvió de una oclusión) la caja nueva manda; con P′ chica, la predicción suaviza el ruido del detector. La forma P − K S Kᵀ es la misma que (I − KH)P′ con la K óptima. Misma matemática, distinta cuenta: el código oficial multiplica con H densa (4×8) y factoriza S con Cholesky; ultralytics toma las primeras filas por slicing y resuelve con LU: ${met('kfUpdate')} contra ${met('kfUpdate', U)} por update en el calculador.` },
          { t: 'math', display: true, tex: R`K = P' H^\top S^{-1}\ \Rightarrow\ K S K^\top = P' H^\top S^{-1} H P' = K H P'\ \Rightarrow\ P' - K S K^\top = (I - K H)\,P'`, caption: 'Las dos formas del update de la covarianza son iguales con la ganancia óptima. La forma de Joseph, (I − KH)P′(I − KH)ᵀ + K R Kᵀ, es la que se usa si K no es la óptima o si preocupa la simetría numérica.' },

          { t: 'h3', text: '4. Ciclo de vida del track' },
          { t: 'op', block: N.manage, model: 'bytetrack', title: 'Crear, confirmar, perder, borrar',
            tex: R`\text{nuevo si } s_j \ge \tau_\text{new};\qquad \text{borrar si } t - t_\text{última detección} > \Big\lfloor \tfrac{\text{fps}}{30}\cdot \text{track\_buffer} \Big\rfloor`,
            in: [T.upd], out: [T.out],
            what: R`<b>Nuevo</b>: una caja alta sin pareja con score ≥ ${th('newT')} abre un track <i>sin confirmar</i> (salvo en el primer frame del video, donde se confirma de inmediato). <b>Confirmado</b>: si en el frame siguiente se vuelve a emparejar con una caja alta (umbral de costo ${th('unconf')}); si no, se borra. <b>Perdido</b>: un track confirmado sin pareja en las dos asociaciones; sigue prediciendo y puede volver (con el mismo id) en la primera asociación de un frame posterior. <b>Borrado</b>: después de ${met('lostFrames')} frames perdido (${met('lostSec')} s a ${cf('fps')} fps). Solo se publican los tracks confirmados que fueron emparejados en este frame.`,
            why: R`El periodo sin confirmar filtra falsos positivos de un solo frame. El buffer da tiempo a que un objeto ocluido reaparezca con el mismo id, pero cuanto más largo, más chance de que la predicción en línea recta (cada vez más lejos de la verdad) robe una detección ajena. Detalle de implementación que se pregunta: el oficial escala el buffer con los fps (<code>int(frame_rate / 30 · track_buffer)</code>); ultralytics 8.4 no (<code>max_frames_lost = track_buffer</code>): a 60 fps, 30 frames son medio segundo.` },
          { t: 'p', html: R`El recorrido completo de un frame con los números del calculador (y en el diagrama, el bloque <a href="#bytetrack.diagrama~manage">gestión de tracks</a>):` },
          { t: 'trace', model: 'bytetrack' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Un tracker como ByteTrack no tiene parámetros aprendidos: F, H, Q y R son constantes escritas a mano, y los umbrales son hiperparámetros. Lo que se aprende está en el detector (y, en DeepSORT, en la red de ReID). La tabla de parámetros lo muestra: los del detector y ninguno en el tracker.` },
          { t: 'params', model: 'bytetrack', group: 'block' },
          { t: 'p', html: R`Y la de MACs: el detector es casi todo. El tracker aparece en "otros": comparaciones, mínimos y máximos del IoU, y las multiplicaciones de matrices 8×8 del filtro, que son tan chicas que se cuentan como FLOPs aparte.` },
          { t: 'flops', model: 'bytetrack' },

          { t: 'h3', text: 'Tracker vs detector, por frame' },
          { t: 'calc', title: R`Un frame de la canónica (N<sub>det</sub> = ${cf('nDet')}, N<sub>trk</sub> = ${cf('nTracks')}; calculador)`, rows: [
            { label: 'Kalman predict (un track, MACs)', expr: R`F x y F P Fᵀ con matrices 8×8 (+ Q, una suma)`, value: met('kfPredict') },
            { label: 'Kalman update (un track, MACs)', expr: R`S = H P′ Hᵀ + R (4×4), resolver S para K (8×4), x + K y, P − K S Kᵀ`, value: met('kfUpdate') },
            { label: 'Matrices de IoU', expr: R`Σ tracks × detecciones de las dos asociaciones, ≈ 12 operaciones por par`, value: est(met('iou')) },
            { label: 'Asignación', expr: R`cota O(n³) del húngaro / LAPJV`, value: est(met('assign')) },
            { label: 'Tracker por frame (operaciones)', expr: 'FLOPs del Kalman (predict de todos, update de los emparejados) + IoU + asignación', value: est(met('tracker')) },
            { label: 'Detector por frame', expr: 'YOLOX-X a 1440×800 (MACs)', value: met('det') },
            { label: 'Fracción del tracker', expr: R`operaciones del tracker / FLOPs del detector (${met('detF')})`, value: est(met('share')) },
          ], result: R`En aritmética, el tracker es ruido al lado del detector. En <b>tiempo</b>, no tanto: el paper mide 29.6 ms de detector y 4.2 ms de asociación por frame a 800×1440 en una V100 (Tabla 9), o sea ≈ 12 % del tiempo, para una fracción despreciable de las operaciones. La diferencia es Python: listas de objetos, bucles por track, copias a CPU. Si el tracker pesa en tu perfil, vectoriza el predict y el IoU (ya lo hacen el oficial y ultralytics) antes de pensar en el algoritmo.` },

          { t: 'h3', text: 'Cómo escala' },
          { t: 'scaling', model: 'bytetrack', knobs: [{ key: 'nDet', values: [10, 30, 100, 300] }, { key: 'nTracks', values: [10, 30, 100, 300] }, { key: 'fps', values: [10, 15, 30, 60] }, { key: 'lowPct', values: [10, 20, 40] }], show: [MK.tracker, MK.iou, MK.assign, MK.share, MK.lostFrames, MK.lostSec] },
          { t: 'p', html: R`<b>La ley en palabras:</b> el predict y el update escalan <b>lineal</b> con los tracks (un filtro 8×8 cada uno); la matriz de IoU con el <b>producto</b> tracks × detecciones (×2 personas en escena → ×4 pares); la asignación, en el peor caso, con el <b>cubo</b> (×2 → ×8), aunque con matrices dispersas (casi todos los IoU son 0) los solvers reales están lejos de esa cota. Con decenas de objetos todo sigue siendo despreciable; con cientos (MOT20, una estación llena) la asignación y el Python empiezan a contar. Los fps no cambian el costo por frame del tracker, pero sí cuántos segundos dura el buffer y cuánto se mueve cada objeto entre frames: a menos fps, IoU más bajos y más cambios de id.` },
          { t: 'compare', models: [C, S, U], rows: ['nDet', MK.nTracks, MK.kfTrack, MK.iou, MK.tracker, MK.det, MK.share, MK.lostFrames, MK.trackBytes], caption: R`ByteTrack oficial en MOT17 (YOLOX-X), SORT (sin segunda pasada) y ByteTrack de ultralytics (YOLOv8). Mismo número de detecciones y tracks de referencia; el detector cambia el costo total por completo.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota en "how expensive is the tracker": "per track, a Kalman predict is a couple of eight by eight matrix products, a few hundred flops; the IoU matrix is tracks times detections; the assignment is cubic in the worst case but on tens of objects it is microseconds. The detector is billions of operations, so the tracker is far below one percent of the compute, but in the paper's measurement association still took about four milliseconds per frame because of Python overhead, so I would profile before assuming it is free."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`El tracker no se entrena: se <b>ajusta</b> (umbrales, buffer) sobre un set de validación con las métricas de tracking. Lo que se entrena es el detector, y en DeepSORT / BoT-SORT, además, la red de ReID. Por eso esta sección tiene dos mitades: cómo se entrenó el detector de ByteTrack y cómo se mide un tracker (lo que de verdad preguntan).` },

          { t: 'h3', text: 'El detector de ByteTrack' },
          { t: 'kv', items: [
            ['Modelo', R`YOLOX-X preentrenado en COCO, una clase (persona), entrada 1440×800; en entrenamiento, multi-escala con el lado corto entre 576 y 1024 (§4.1).`, BYTE],
            ['Datos MOT17', R`MOT17 + CrowdHuman + Cityperson + ETHZ, 80 épocas (§4.1). Para MOT20: CrowdHuman + MOT20. En el README: 8 GPUs, batch 48, fp16.`, BYTE],
            ['Pérdida', R`La de YOLOX (detección anchor-free: clasificación, objectness y regresión de cajas con IoU). Ninguna pérdida de tracking: la asociación no tiene gradiente.`, YOLOX],
            ['Ablación (MOT17 val, mitad del train)', R`Mismo detector, distintas asociaciones (Tabla 2): SORT 74.6 MOTA / 76.9 IDF1 / 291 IDs; BYTE 76.6 / 79.3 / 159; DeepSORT 75.4 / 77.2 / 239. BYTE a 29.6 FPS contra 30.1 de SORT.`, BYTE],
          ] },
          { t: 'callout', kind: 'trap', title: 'Los números del test de MOT17 no son "ByteTrack en tiempo real tal cual"', html: R`<p>El 80.3 MOTA / 77.3 IDF1 / 63.1 HOTA de MOT17 test (Tabla 4) incluye dos cosas que no son online: <b>interpolación lineal</b> de los huecos de hasta 20 frames, que necesita ver el frame donde el track reaparece (Apéndice D: en val sube MOTA de 76.6 a 78.3 e IDF1 de 79.3 a 80.2, Tabla 11), y <b>umbrales por secuencia</b>: el evaluador del repo cambia track_thresh y track_buffer según el nombre de la secuencia de MOT17 (por ejemplo 0.65 en MOT17-01 y buffer 14 en MOT17-05), y el README avisa que para pasar de 80 MOTA hay que ajustar el tamaño de entrada y el umbral alto por secuencia. En producción tienes un solo juego de umbrales y no ves el futuro.</p>` },

          { t: 'h3', text: 'Las métricas: MOTA, IDF1, HOTA' },
          { t: 'p', html: R`Primero el ejemplo. Un video con 1,000 cajas de verdad (GT). Tu tracker tiene 100 falsos negativos (personas no detectadas), 50 falsos positivos y 10 cambios de id. MOTA = 1 − (100 + 50 + 10)/1,000 = 0.84. Si el tracker intercambia los ids de dos personas a mitad del video, MOTA casi no se entera (dos cambios de id); IDF1 baja mucho, porque la mitad de cada trayectoria quedó con el id "equivocado".` },
          { t: 'math', display: true, tex: R`\text{MOTA} = 1 - \frac{\sum_t \big(\text{FN}_t + \text{FP}_t + \text{IDSW}_t\big)}{\sum_t \text{GT}_t}`, caption: 'CLEAR MOT (Bernardin y Stiefelhagen, 2008). En cada frame se emparejan GT e hipótesis (IoU ≥ 0.5 en MOTChallenge), manteniendo las parejas del frame anterior si siguen siendo válidas; IDSW cuenta cuando un objeto GT cambia de hipótesis. Puede ser negativo. Premia sobre todo la DETECCIÓN: FP y FN son decenas de veces más que los IDSW.' },
          { t: 'math', display: true, tex: R`\text{IDF1} = \frac{2\,\text{IDTP}}{2\,\text{IDTP} + \text{IDFP} + \text{IDFN}}`, caption: 'Ristani et al. (2016). Un solo emparejamiento uno a uno entre trayectorias GT y trayectorias predichas para todo el video (bipartito, maximiza las detecciones bien identificadas); IDTP / IDFP / IDFN se cuentan con ese emparejamiento fijo. Premia mantener la MISMA identidad durante toda la trayectoria.' },
          { t: 'math', display: true, tex: R`\text{HOTA}_\alpha = \sqrt{\frac{\sum_{c\in\text{TP}_\alpha}\mathcal A(c)}{|\text{TP}_\alpha| + |\text{FN}_\alpha| + |\text{FP}_\alpha|}} = \sqrt{\text{DetA}_\alpha\cdot\text{AssA}_\alpha},\quad \mathcal A(c) = \frac{|\text{TPA}(c)|}{|\text{TPA}(c)| + |\text{FNA}(c)| + |\text{FPA}(c)|},\quad \text{HOTA} = \frac{1}{19}\sum_{\alpha\in\{0.05,\,0.1,\,\dots,\,0.95\}}\text{HOTA}_\alpha`, caption: 'Luiten et al. (IJCV 2021). DetA = |TP|/(|TP| + |FN| + |FP|) mide detección; AssA = promedio de 𝒜(c) sobre los TP mide asociación (para cada par emparejado, qué fracción de las trayectorias GT y predicha coinciden). La media geométrica balancea las dos, y promediar sobre 19 umbrales de IoU α incluye la localización.' },
          { t: 'table', caption: 'Qué premia cada métrica', head: ['Métrica', 'Domina', 'Ciega a', 'Cuándo mirarla'], rows: [
            ['MOTA', 'Detección (FP + FN)', 'Intercambios de id largos: un swap a mitad del video son 2 IDSW', 'Comparar detectores con el mismo tracker; la métrica histórica de MOTChallenge'],
            ['IDF1', 'Asociación (identidad sostenida)', 'Calidad de localización; un track bueno pero fragmentado se castiga mucho', 'Conteo de personas, re-identificación, multi-cámara: donde importa no confundir quién es quién'],
            ['HOTA', 'Balance detección × asociación × localización', 'Más difícil de interpretar como un solo número: mira DetA y AssA por separado', 'Comparar trackers en general (la métrica principal de MOTChallenge y de KITTI tracking hoy)'],
            ['IDSW (IDs)', 'Cambios de id', 'Escala con el número de objetos y la longitud del video', 'Debug: el contador directo del problema que te reportan'],
          ] },
          { t: 'callout', kind: 'senior', html: R`<p>El ejemplo de la propia ByteTrack lo muestra: en MOT17 test tiene 25,491 FP + 83,721 FN + 2,196 IDs (Tabla 4). Los cambios de id son ≈ 2 % de los errores que cuenta MOTA: dos trackers con el doble de IDs casi empatan en MOTA. Por eso un entrevistador senior pregunta por IDF1 o HOTA cuando el problema es de identidad (contar personas únicas).</p>` },
          { t: 'h3', text: 'La red de ReID (DeepSORT)' },
          { t: 'p', html: R`DeepSORT entrena aparte una CNN residual ancha (≈ 2.8 M parámetros) que mapea cada recorte de persona a un vector de 128 dimensiones con norma 1, sobre MARS (más de 1,100,000 imágenes de 1,261 peatones; ${DSORT}). Se entrena como re-identificación (que dos recortes de la misma persona queden cerca); en el tracking, el costo de un par es la menor distancia coseno entre la detección y los últimos 100 embeddings del track.` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Detectar', html: R`<p>El detector sobre el frame (GPU), umbral de confianza bajo, NMS. Es lo que define la latencia: ${met('det')} en la canónica.</p>` },
            { title: 'Predecir todos los tracks', html: R`<p>Kalman predict vectorizado sobre los ${cf('nTracks')} tracks activos y perdidos (CPU). Si hay compensación de movimiento de cámara, aquí se aplica la transformación global a la media y la covarianza (BoT-SORT).</p>` },
            { title: 'Asociar dos veces', html: R`<p>IoU + asignación con las cajas altas; IoU + asignación de los tracks sobrantes con las cajas bajas; los tracks sin confirmar contra las cajas altas que sobraron.</p>` },
            { title: 'Actualizar y gestionar', html: R`<p>Update de los emparejados, tracks nuevos desde las cajas altas sin pareja (score ≥ ${th('newT')}), tracks perdidos, borrado después del buffer, y una limpieza de duplicados (un track activo y uno perdido con IoU &gt; 0.85: se queda el más antiguo).</p>` },
            { title: 'Publicar', html: R`<p>Los tracks confirmados que se emparejaron en este frame: caja (de la media del Kalman), id, score, clase. El evaluador de MOT17 del repo además descarta cajas de área ≤ 100 px² o con w/h &gt; 1.6 (un peatón no es más ancho que alto): un prior del dominio, no del tracker. La aplicación (conteo por cruce de línea, planeador) consume esto.</p>` },
          ] },
          { t: 'h3', text: 'Trucos y detalles de producción' },
          { t: 'list', items: [
            R`<b>Frames perdidos.</b> El modelo asume dt = 1 frame entre llamadas. Si el pipeline salta frames (el detector no da abasto en un Jetson), cada llamada es en realidad un paso de 2 o 3 frames: la predicción se queda corta y el IoU cae. Opciones: predecir k veces (o escalar F con el dt real usando los timestamps) y bajar los fps del detector de forma <b>controlada</b> en vez de dejar que se caigan frames al azar.`,
            R`<b>Detector a menos fps que la cámara.</b> Se puede correr el detector cada k frames y en los intermedios publicar solo la predicción del Kalman; funciona si los objetos se mueven poco por frame, y empeora con aceleraciones.`,
            R`<b>Varias clases.</b> El ByteTrack oficial es de una clase; ultralytics trackea todas las clases del detector en el mismo pool y guarda la clase de la última detección. Si no quieres que un "carrito" robe el track de una "persona", separa la asociación por clase (o agrega un costo infinito entre clases distintas).`,
            R`<b>Umbrales y detector van juntos.</b> Los defaults de ultralytics (${th('high', U)} / ${th('low', U)} / nuevo track ${th('newT', U)}) no son los de MOT17 (${th('high')} / ${th('low')} / ${th('newT')}) porque los scores de un YOLOv8 de COCO no están en la misma escala que los de un YOLOX entrenado solo con personas de MOT17. Calibra τ<sub>high</sub> con la distribución de scores de tu detector en tus videos.`,
            R`<b>Solver.</b> <code>lap.lapjv</code> con <code>cost_limit</code> resuelve la asignación con la opción de no emparejar; <code>scipy.optimize.linear_sum_assignment</code> siempre empareja min(filas, columnas) pares y hay que filtrar por umbral después. No son equivalentes: en el problema extendido de lapjv, dejar un track y una detección sin pareja cuesta cost_limit/2 + cost_limit/2, así que un par solo entra si conviene frente a esa opción. Con costos [[0.1, 0.5], [0.5, 0.95]] y límite 0.8, scipy elige el cruce (0.5 + 0.5 = 1.0) y los dos pares pasan el filtro; lapjv prefiere el par de 0.1 y dejar los otros dos solos (0.1 + 0.4 + 0.4 = 0.9): una pareja menos y un track nuevo más.`,
          ] },
          { t: 'h3', text: 'En un robot' },
          { t: 'list', items: [
            R`<b>Cámara en movimiento.</b> Si el robot gira 10° entre dos frames, todas las cajas se desplazan decenas de píxeles a la vez y el IoU con las predicciones cae a 0: cambios de id en masa. BoT-SORT estima una transformación afín global entre frames (puntos de Shi-Tomasi, flujo óptico de Lucas-Kanade, RANSAC; ${BOT}, §3.2) y la aplica al estado y a la covarianza de todos los tracks antes de asociar; en ultralytics es <code>gmc_method: sparseOptFlow</code> en botsort.yaml. En un robot tienes algo mejor que adivinar el movimiento desde la imagen: la odometría o la IMU (rotación de la cámara entre frames → homografía de rotación pura con la matriz intrínseca).`,
            R`<b>Tracking en 3-D.</b> Con profundidad (estéreo, RGB-D, <a href="#depth">depth monocular</a> o LiDAR) cada caja se proyecta a un punto en el mundo y el Kalman corre en metros, en el marco del mapa: la velocidad constante es mucho más cierta en 3-D que en píxeles (la perspectiva no la deforma) y el ego-movimiento se resta con la pose del robot. AB3DMOT es exactamente SORT en 3-D (Kalman + IoU 3-D + húngaro; ${AB3D}); CenterPoint asocia por distancia entre centros con la velocidad predicha (${CPOINT}); ByteTrackV2 extiende la idea de las cajas bajas a 3-D (${BYTE2}).`,
            R`<b>Varias cámaras.</b> Cada cámara corre su tracker local; un nivel superior une tracks entre cámaras por apariencia (ReID) y geometría (calibración, posición en el plano del piso, tiempos de tránsito plausibles). Las métricas por identidad (IDF1) son las que importan aquí.`,
            R`<b>Presupuesto en el borde.</b> En un Jetson, el detector va en TensorRT (FP16 / INT8) en la GPU y el tracker en un núcleo de CPU; el cuello de botella es el detector. ${est('Mide')} el tiempo por frame de punta a punta (captura, preproceso, detector, NMS, tracker) con <code>trtexec</code> y con el pipeline real: no estimes la latencia del tracker con sus FLOPs.`,
          ] },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Oclusión más larga que el buffer.</b> El track se borra después de ${met('lostFrames')} frames sin detección y la persona vuelve con un id nuevo. Subir el buffer ayuda solo si la predicción en línea recta sigue cerca de la verdad: después de 30 frames sin medición, el ejercicio de práctica tiene una desviación estándar de ≈ 180 px en x para una caja de 50 px de ancho, y la media sigue avanzando con la última velocidad. Sin apariencia, un buffer largo cambia "id nuevo" por "id robado".`,
            R`<b>Movimiento no lineal o rápido.</b> Giros bruscos, aceleraciones, baja tasa de frames: la caja predicha no se superpone con la detección (IoU = 0) y el par no se puede emparejar aunque sea obvio para un humano. DanceTrack se diseñó para esto (${DANCE}); OC-SORT ataca la acumulación de error del Kalman durante las oclusiones.`,
            R`<b>Cámara en movimiento.</b> El modelo de velocidad constante está en píxeles: el movimiento de la cámara se suma a todos los objetos. Compensación de movimiento (BoT-SORT) o tracking en el marco del mundo.`,
            R`<b>Multitudes de objetos parecidos.</b> Dos personas que se cruzan con IoU alto entre sí: la asignación puede intercambiar los ids en el cruce (un ID switch que MOTA casi no ve y que IDF1 castiga). Más fps, ReID (si la ropa difiere) o pistas de movimiento (OC-SORT) ayudan; con uniformes iguales, ni el ReID.`,
            R`<b>Falsos positivos del detector que se vuelven tracks.</b> Un reflejo o un póster con score alto durante varios frames se confirma y se cuenta. Se mitiga con τ<sub>new</sub> más alto que τ<sub>high</sub> (el oficial usa +0.1), con un mínimo de frames antes de publicar y con zonas de exclusión.`,
          ] },
          { t: 'callout', kind: 'trap', title: '"Subo track_buffer y se acaban los cambios de id"', html: R`<p>Cambias un error por otro. Un track perdido sigue prediciendo en línea recta con incertidumbre creciente; en una escena con gente, después de un segundo su caja predicha puede superponerse con otra persona y robarle la detección: ahora tienes un intercambio de identidades, peor para IDF1 que un id nuevo. El buffer se ajusta en <b>segundos</b> (buffer / fps) mirando la distribución de duraciones de oclusión en tus videos, junto con un umbral de asociación para tracks perdidos, o con ReID si las oclusiones largas son el caso normal.</p>` },

          { t: 'h3', text: 'Trade-offs: familias de trackers' },
          { t: 'table', head: ['Criterio', 'SORT', 'DeepSORT', 'ByteTrack', 'BoT-SORT', 'OC-SORT', 'End-to-end (MOTR)'], rows: [
            ['Señal de asociación', 'IoU', 'Apariencia (coseno) + compuerta de Mahalanobis, luego IoU', 'IoU (× score), dos pasadas por score', 'IoU + ReID fusionados, con compensación de cámara', 'IoU + consistencia de la dirección de movimiento', 'Queries que persisten entre frames'],
            ['Cajas de baja confianza', 'Descartadas', 'Descartadas', '<b>Segunda pasada</b>', 'Segunda pasada', 'Descartadas (recuperación por última observación)', 'Implícito'],
            ['Oclusión larga', 'No (T_lost = 1 en el paper)', 'Sí, con ReID (cascada hasta 30 frames)', 'Hasta el buffer, solo por movimiento', 'Sí, con ReID', 'Mejor que SORT: re-actualiza el Kalman con una trayectoria virtual al reaparecer', 'Depende del entrenamiento'],
            ['Cámara en movimiento', 'No', 'No', 'No', '<b>Sí (GMC)</b>', 'No (sin CMC en el paper)', 'Aprendido'],
            ['Costo extra sobre el detector', 'Despreciable', 'Una CNN de ReID por caja', 'Despreciable', 'GMC + ReID opcional', 'Despreciable', 'Todo el modelo es el tracker'],
            ['Entrenamiento propio', 'Ninguno', 'ReID', 'Ninguno', 'ReID (opcional)', 'Ninguno', 'Video anotado con ids'],
            ['Paper', 'ICIP 2016', 'ICIP 2017', 'ECCV 2022', 'arXiv 2022', 'CVPR 2023', 'ECCV 2022'],
          ] },
          { t: 'kv', items: [
            ['ByteTrack, MOT17 test (Tabla 4)', '80.3 MOTA, 77.3 IDF1, 63.1 HOTA, 2,196 IDs, 29.6 FPS (V100, detector incluido; con interpolación y umbrales por secuencia).', BYTE],
            ['ByteTrack, MOT20 test (Tabla 5)', '77.8 MOTA, 75.2 IDF1, 61.3 HOTA, 1,223 IDs.', BYTE],
            ['BoT-SORT-ReID, MOT17 test (Tabla 3)', '80.5 MOTA, 80.2 IDF1, 65.0 HOTA; sin ReID 80.6 / 79.5 / 64.6.', BOT],
            ['OC-SORT, MOT17 test (Tabla 1)', '78.0 MOTA, 77.5 IDF1, 63.2 HOTA, con los pesos de YOLOX publicados por ByteTrack; DanceTrack test (Tabla 3): 54.6 HOTA. El tracker solo, 700+ FPS en una CPU.', OCS],
            ['DeepSORT, MOT16 test (Tabla 2)', '61.4 MOTA, 781 IDs contra 1,423 de SORT con las mismas detecciones (≈ 45 % menos cambios de id).', DSORT],
          ] },
          { t: 'callout', kind: 'note', html: R`<p>Las tablas de MOTChallenge comparan trackers con detectores distintos ("private detection"): dos filas con 2 puntos de diferencia pueden ser dos detectores, no dos asociaciones. Para comparar asociaciones mira ablaciones con el mismo detector (Tabla 2 y Tabla 3 de ByteTrack, que aplica BYTE a 9 trackers y mejora IDF1 entre 1 y 10 puntos).</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'list', items: [
            R`<b>SORT</b> (${SORT}): Kalman de 7 estados (centro, área, aspecto) + húngaro sobre IoU; borra un track en cuanto pierde una detección (T<sub>lost</sub> = 1) y no re-identifica. 260 Hz en un núcleo de CPU (el tracker solo). En el código: <code>max_age = 1</code>, <code>min_hits = 3</code>, <code>iou_threshold = 0.3</code>.`,
            R`<b>DeepSORT</b> (${DSORT}): estado de 8 (x, y, γ = aspecto, h y velocidades), el filtro que hereda ByteTrack; costo de apariencia (distancia coseno mínima a los últimos 100 embeddings de 128 dimensiones del track), compuerta de Mahalanobis con el cuantil 95 % de χ² con 4 grados de libertad (9.4877), <b>cascada</b>: primero se asocian los tracks vistos más recientemente (edad 1, 2, …, hasta 30), y al final IoU para los tracks sin confirmar y los de edad 1. Un track es tentativo durante sus 3 primeros frames.`,
            R`<b>ByteTrack</b> (${BYTE}): la asociación BYTE con cajas bajas; detector fuerte (YOLOX-X) entrenado con varias bases de personas. Aplicar BYTE a otros 9 trackers (Tabla 3) mejora IDF1 de forma consistente.`,
            R`<b>BoT-SORT</b> (${BOT}): estado (x, y, w, h), compensación de movimiento de cámara y fusión IoU-ReID (la distancia de apariencia cuenta solo si el IoU es razonable y el embedding parecido; el costo es el mínimo de las dos). Es el otro tracker de ultralytics (<code>botsort.yaml</code>).`,
            R`<b>StrongSORT</b> (${STRONG}): DeepSORT modernizado (ReID más fuerte, ECC para la cámara, NSA Kalman: el ruido de la medición escala con (1 − score), opción que ultralytics 8.4 expone en su filtro).`,
            R`<b>OC-SORT</b> (${OCS}): "centrado en observaciones": al reaparecer un track, re-actualiza el Kalman a lo largo de una trayectoria virtual entre la última observación y la nueva (ORU), agrega al costo la consistencia de la dirección de movimiento (OCM) y una pasada de recuperación con la última observación (OCR). Ataca la acumulación de error del Kalman durante las oclusiones.`,
            R`<b>Trackers end-to-end</b>: MOTR (${MOTR}) extiende <a href="#detr">DETR</a> con "track queries" que pasan de un frame al siguiente; la asociación sale de la atención, sin húngaro en inferencia. SAM 2 (<a href="#sam2">SAM 2</a>) hace tracking de máscaras con un memory bank, pero de objetos señalados con un prompt, no multi-objeto por detección.`,
            R`<b>3-D</b>: AB3DMOT (${AB3D}), CenterPoint (${CPOINT}), ByteTrackV2 (${BYTE2}).`,
          ] },
          { t: 'h3', text: 'Referencias' },
          { t: 'list', items: [
            SORT + '.', DSORT + '.', BYTE + '.', BOT + '.', OCS + '.', STRONG + '.', CLEAR + '.', IDF + '.', HOTA + '.', MOT16 + '.', MOT20 + '.', DANCE + '.', YOLOX + '.', MOTR + '.', AB3D + '.', CPOINT + '.', BYTE2 + '.',
            'Código: ifzhang/ByteTrack (yolox/tracker, tools/track.py, tools/interpolation.py), abewley/sort, nwojke/deep_sort, ultralytics (trackers/, cfg/trackers/bytetrack.yaml y botsort.yaml), TrackEval (implementación de referencia de HOTA, CLEAR e Identity).',
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Tracking aparece en entrevistas de visión y de robótica de tres formas: como mecanismo ("explica SORT / ByteTrack"), como depuración ("tenemos muchos cambios de id") y como diseño de sistema ("contar personas", "un robot que sigue a una persona"). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Walk me through how ByteTrack associates detections across frames. Why does it use low-confidence detections?',
              junior: 'Usa un filtro de Kalman y el algoritmo húngaro para emparejar las cajas, con todas las detecciones.',
              senior: R`Por frame: separar las detecciones en altas (score &gt; τ<sub>high</sub>, ${th('high')} en MOT17) y bajas (entre ${th('low')} y τ<sub>high</sub>). Predecir todos los tracks con un Kalman de velocidad constante sobre (x, y, a, h). <b>Primera asociación</b>: tracks activos y perdidos contra las altas, costo 1 − IoU (× score en el código de MOT17), asignación uno a uno con umbral (LAPJV). <b>Segunda</b>: solo los tracks activos que quedaron sin pareja contra las bajas, con IoU puro y umbral 0.5. Las altas sin pareja abren tracks (score ≥ τ<sub>high</sub> + 0.1), las bajas sin pareja se tiran, los tracks sin pareja pasan a perdidos y se borran después de ${th('buffer')} frames. Por qué las bajas: un objeto ocluido o borroso baja de score; si lo tiras, la trayectoria se corta y vuelve con otro id. Pero entre las bajas hay mucho fondo, por eso solo se aceptan si coinciden con la predicción de un track existente: la IoU con el track actúa como filtro. Con el mismo detector, en MOT17 val, eso lleva de 74.6 a 76.6 MOTA y de 291 a 159 cambios de id frente a SORT (Tabla 2).`,
              say: 'ByteTrack splits detections by score. It predicts every track with a constant-velocity Kalman filter, then matches tracks to high-score boxes with an IoU cost and a thresholded linear assignment. The tracks left unmatched get a second chance against the low-score boxes, using plain IoU and a stricter threshold. Unmatched high boxes start new tracks, unmatched low boxes are discarded, and unmatched tracks become lost and are deleted after a buffer. Low-score boxes matter because occluded or blurred objects lose confidence; matching them only against existing tracks recovers those objects while the background false positives, which overlap no track, are filtered out.',
              why: 'Se anotan las dos pasadas con quién entra en cada una, que las bajas nunca crean tracks, el umbral más estricto en la segunda y por qué IoU funciona como filtro del fondo.' },
            { q: 'Derive the Kalman filter used in SORT and ByteTrack. What are the state, F, H, Q and R, and why does the noise depend on the box height?',
              junior: 'El estado es la caja y el filtro la suaviza; Q y R se tunean.',
              senior: R`Estado de 8: (x, y, a, h) y sus velocidades; F = [[I, I], [0, I]] (velocidad constante, dt = 1 frame); H = [I 0] (se mide la caja). Predict: x′ = Fx, P′ = FPFᵀ + Q. Update: innovación y = z − Hx′, S = HP′Hᵀ + R, K = P′HᵀS⁻¹, x = x′ + Ky, P = P′ − KSKᵀ = (I − KH)P′. Q y R son diagonales con desviaciones proporcionales a la altura estimada h: posición 5 % de h, velocidad 0.625 % de h por frame, medición 5 % de h; el aspecto, constantes porque no tiene unidades. Razón: el error de un detector en píxeles crece con el tamaño de la caja, y con todas las varianzas ∝ h² la ganancia K no depende de la escala: el filtro se comporta igual con una persona lejos que cerca. Es una heurística del código de DeepSORT, no del paper. SORT usaba (x, y, área, aspecto) con ruidos fijos. Repregunta típica: "¿y si la cámara se mueve?": la velocidad constante en píxeles deja de valer; compensas con una transformación global (BoT-SORT) o trackeas en 3-D.`,
              say: 'The state is box center, aspect ratio and height plus their velocities, with a constant velocity transition where F adds the velocity to the position once per frame, and H reads the box out of the state. Predict propagates the mean and adds process noise to the covariance; update computes the innovation, its covariance S, the gain P H transpose S inverse, and corrects both. The noise standard deviations are fractions of the box height, so all variances scale with height squared and the gain becomes scale invariant: a far and a near person get the same relative correction, which matches detector errors that grow with object size.',
              why: 'Se anota escribir las matrices con sus tamaños, la derivación de K y P, y la invariancia a escala como razón del ruido proporcional a h.' },
            { q: 'Design a people counting and tracking system for retail cameras, or for a warehouse robot that must not run into people. Latency, fps, edge hardware, failure modes.',
              junior: 'YOLO con ByteTrack de ultralytics en cada cámara, y cuento los ids distintos.',
              senior: R`<b>Requisito y métrica</b>: contar entradas por puerta (retail) o mantener la posición y velocidad de cada persona cerca del robot (almacén). Para conteo, la métrica de negocio es el error del conteo por hora contra un conteo manual; para tracking, IDF1 / HOTA sobre clips propios anotados. "Contar ids distintos" sobre-cuenta: cada cambio de id es una persona más; se cuenta por <b>cruce de una línea</b> con histéresis y un mínimo de frames del track. <b>Presupuesto</b>: cámara a 15–30 fps; en el borde (Jetson Orin) el detector en TensorRT FP16 o INT8 es casi todo el tiempo; el tracker, un núcleo de CPU. Elijo el detector más chico que mantenga el recall de personas a la distancia que importa, ${est('medido en mis videos')}, y que deje holgura para no saltar frames (si se saltan, el Kalman tiene que usar el dt real). <b>Tracker</b>: ByteTrack, con τ<sub>high</sub> calibrado con la distribución de scores de mi detector (no el 0.6 de MOT17), track_buffer en segundos según la duración típica de las oclusiones. <b>Robot</b>: la cámara se mueve: compensación con la odometría / IMU o, mejor, tracking en el marco del mapa con profundidad (RGB-D o estéreo), Kalman en metros, y el planeador consume posición y velocidad con su incertidumbre; la seguridad no depende del id (un obstáculo sin id sigue siendo un obstáculo). <b>Oclusión y multitudes</b>: segunda pasada de ByteTrack; ReID solo si las oclusiones largas son frecuentes, porque cuesta una red por caja. <b>Privacidad</b>: procesar en el borde y no guardar imágenes ni embeddings biométricos. <b>Monitoreo</b>: tracks cortos (duran menos de N frames), tasa de tracks creados por minuto, fracción de detecciones sin asociar y fps efectivos; alertan de cambios de id y de caída del detector sin etiquetas.`,
              say: 'For counting I would count line crossings with hysteresis and a minimum track length, never distinct IDs, because every ID switch adds a person. On a Jetson the detector in TensorRT dominates the frame time, so I pick the smallest detector that keeps recall at the needed distance and leaves headroom so frames are not dropped, and the tracker runs on one CPU core. I calibrate the high threshold on my detector score distribution and set the track buffer in seconds from measured occlusion lengths. On a moving robot I compensate ego-motion with odometry or track in the map frame with depth, and the planner uses position and velocity with uncertainty, not the ID. I evaluate with IDF1 or HOTA on labeled clips and monitor short-track rate and new tracks per minute as proxies for ID switches.',
              why: 'Trampa: contar ids únicos. Se anota cruce de línea con histéresis, presupuesto del detector en el borde, umbrales calibrados, buffer en segundos, compensación de ego-movimiento, métricas de identidad y monitoreo sin etiquetas.', trap: true },
            { q: 'Your tracker produces many ID switches in production. How do you debug it?',
              junior: 'Subo track_buffer y bajo match_thresh.',
              senior: R`Primero medir y clasificar, después tocar perillas. (1) Anotar unos minutos de video con ids y correr TrackEval: IDF1, HOTA con DetA y AssA por separado, IDSW y fragmentaciones. Si DetA es bajo, el problema es el <b>detector</b> (recall en oclusión, NMS que suprime personas pegadas). (2) Ver cada cambio de id en video y clasificarlo: <b>oclusión larga</b> (el track se borró: buffer en segundos o ReID), <b>salto de posición</b> (IoU = 0 entre predicción y detección: fps bajos o frames saltados, cámara en movimiento sin compensar, objetos rápidos; arreglo: dt real, CMC, más fps, o costo por distancia entre centros), <b>cruce de personas</b> (intercambio: ReID si la apariencia distingue, OC-SORT para la dirección), <b>track nacido de un FP</b> (τ<sub>new</sub>). (3) Revisar la configuración: τ<sub>high</sub> calibrado para el detector actual (si actualizaron el modelo, los scores cambiaron de escala y la segunda pasada deja de ver los ocluidos), buffer que no escala con los fps (ultralytics), fusión con score. (4) Cambiar una cosa a la vez y medir IDF1 en el mismo set.`,
              say: 'I would first label a few minutes of video with identities and run TrackEval, looking at IDF1, HOTA split into detection and association accuracy, and ID switch counts. Low detection accuracy means the detector, not the tracker. Then I would watch every switch and bucket it: long occlusions that exceed the buffer, position jumps where the predicted box no longer overlaps because of dropped frames or camera motion, crossings between similar people, and tracks born from false positives. Each bucket has its own fix: buffer in seconds or ReID, real time steps and motion compensation, appearance or motion direction cues, and a higher new-track threshold. I would also check that the score thresholds still match the current detector.',
              why: 'Trampa: tocar umbrales sin medir. Se anota separar detección de asociación con DetA / AssA, clasificar los switches por causa y revisar que los umbrales correspondan al detector actual.', trap: true },
            { q: 'MOTA, IDF1 and HOTA: what does each one measure, and which would you report for a counting product?',
              junior: 'MOTA es la exactitud del tracking; las otras son parecidas.',
              senior: R`MOTA = 1 − (FN + FP + IDSW)/GT por frame: casi todo detección, porque los cambios de id son una fracción chica de los errores (≈ 2 % en ByteTrack MOT17 test), y un intercambio de ids a mitad del video cuesta solo 2. IDF1 = 2IDTP/(2IDTP + IDFP + IDFN) con un emparejamiento global de trayectorias: mide cuánto tiempo cada persona conserva su id. HOTA = media geométrica de DetA y AssA, promediada sobre 19 umbrales de IoU: balancea detección, asociación y localización, y se puede descomponer. Para conteo reporto el error de conteo (lo que paga el negocio) e IDF1 o AssA como diagnóstico de identidad; MOTA solo si quiero comparar detectores.`,
              say: 'MOTA sums misses, false positives and ID switches over ground truth per frame, so it is dominated by detection quality and barely notices a long identity swap. IDF1 matches whole trajectories once over the video and measures how long identities are preserved. HOTA is the geometric mean of detection and association accuracy averaged over IoU thresholds, so it balances both and can be decomposed. For counting I would report the count error itself plus IDF1 or association accuracy as a diagnostic.',
              why: 'Se anotan las fórmulas, el "MOTA es detección" con el número y la elección por producto.' },
            { q: 'When would you use DeepSORT or BoT-SORT with ReID instead of ByteTrack?',
              junior: 'Siempre que se pueda, porque ReID es más preciso.',
              senior: R`Cuando el problema dominante son oclusiones largas o reentradas (alguien sale de cuadro y vuelve), o el multi-cámara, y la apariencia distingue a las personas (ropa distinta). Costo: una red de ReID por caja y por frame (en DeepSORT, ≈ la mitad del tiempo del tracker según el paper) y un modelo más que entrenar y mantener en el dominio (uniformes, iluminación de almacén). No ayuda si todos visten igual (DanceTrack, trabajadores con chaleco) ni en las cajas bajas ocluidas: por eso ByteTrack usa IoU en la segunda pasada. En la ablación de ByteTrack (Tabla 2), agregar ReID sube IDF1 de 79.3 a 80.5 pero baja de 29.6 a 11.8 FPS. Decisión: empiezo con ByteTrack; agrego ReID si el análisis de cambios de id muestra que la mayoría son oclusiones largas y la apariencia es informativa.`,
              say: 'I would add appearance when most identity errors come from long occlusions, re-entries or multiple cameras and people look different. It costs a ReID network per box and a domain model to maintain, and it does not help when everyone wears the same uniform or on heavily occluded low-score boxes. In ByteTrack ablations ReID added about one point of IDF1 but cut the speed by more than half, so I start with motion only and add ReID when the switch analysis justifies it.',
              why: 'Se anota cuándo la apariencia ayuda y cuándo no, el costo medido y la decisión basada en el análisis de errores.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuánto cuesta el tracker por frame en la canónica y qué fracción del cómputo es?',
              a: R`${est(met('tracker'))} operaciones contra ${met('det')} del detector: ${est(met('share'))}. Lineal en tracks para el Kalman, producto tracks × detecciones para el IoU, cúbico en el peor caso para la asignación.` },
            { q: '¿Cuántos segundos espera un track perdido antes de borrarse, a 30 y a 15 fps, en el oficial y en ultralytics?',
              a: R`Oficial: ⌊fps/30 · 30⌋ frames = 30 frames a 30 fps y 15 frames a 15 fps: 1 s en los dos casos. ultralytics 8.4: 30 frames siempre, 1 s a 30 fps y 2 s a 15 fps. En la canónica del calculador: ${met('lostFrames')} frames, ${met('lostSec')} s.` },
            { q: 'Una caja de 50 px de ancho se mueve 20 px por frame. ¿Qué IoU tiene con la posición del frame anterior, y con la predicción de un Kalman que ya conoce la velocidad?',
              a: R`Sin predicción: (50 − 20)/(50 + 20) = 0.43 si se mueve en el eje del ancho (alturas iguales), por encima del umbral 0.2 pero lejos del 0.5 de la segunda pasada. Con la velocidad estimada, la predicción cae encima: IoU ≈ 1. A 10 fps el mismo objeto se mueve 60 px: IoU 0 sin predicción. Por eso el Kalman importa más cuanto menos fps.` },
            { q: '¿Por qué una caja baja sin pareja no puede abrir un track en ByteTrack?',
              a: 'Porque la mayoría de las cajas bajas aisladas son fondo; solo son confiables cuando coinciden con la predicción de un track existente. Abrir tracks desde ellas llenaría la escena de tracks falsos.' },
            { q: 'Tu tracker funciona en el video de prueba a 30 fps y falla en el robot a 12 fps efectivos. ¿Qué cambió?',
              a: 'Los objetos se mueven 2.5× más por llamada (menos IoU, más pares imposibles), el buffer en frames dura más segundos (ultralytics) y, si el detector salta frames de forma irregular, el Kalman predice con dt = 1 cuando pasaron 2 o 3. Arreglos: dt real desde los timestamps, buffer en segundos, compensación del movimiento del robot, o un detector más rápido.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el bucle sin mirar; después las cuentas del calculador ("¿qué pasa si…?") y al final dos ejercicios que se piden en entrevistas: un predict / update de Kalman a mano y una matriz de IoU con su asignación, más el paso de asociación de ByteTrack en NumPy.` },
          { t: 'h3', text: 'Diagrama en blanco: el bucle de ByteTrack' },
          { t: 'blankdiagram', diagram: 'bytetrack-overview', slots: [
            { node: N.split, ask: 'label', hint: 'altas y bajas' },
            { node: N.predict, ask: 'label', hint: 'x′ = F x' },
            { node: N.assoc2, ask: 'label', hint: 'tracks sin pareja × cajas bajas' },
            { node: N.manage, ask: 'label', hint: 'nuevo, perdido, borrado' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'bytetrack', pool: 'all', configs: [C, S] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Duplicas los tracks del pool de ${cf('nTracks')} a 100. ¿Por qué factor cambian las operaciones de las matrices de IoU?`, change: { nTracks: 100 }, ask: MK.iou,
              explain: '≈ ×2.2, no ×2: la primera matriz (tracks × altas) crece ×2 exacto, pero con 40 cajas altas ahora sobran 60 tracks en vez de 10 para la segunda pasada contra las bajas, que crece ×6. Lineal en tracks por pasada; el reparto entre pasadas depende de cuántos se emparejan en la primera.' },
            { q: 'Duplicas a la vez tracks y detecciones. ¿Y la matriz de IoU?', change: { nTracks: 100, nDet: 100 }, ask: MK.iou,
              explain: '×4: el producto de las dos dimensiones.' },
            { q: 'Mismo cambio, tracks y detecciones × 2. ¿Y la cota de la asignación?', change: { nTracks: 100, nDet: 100 }, ask: MK.assign,
              explain: '×8: O(n³) con n = max(tracks, detecciones). Es una cota; los solvers reales sobre matrices dispersas están lejos de ella.' },
            { q: R`Bajas la cámara de ${cf('fps')} a 15 fps. ¿Cuántos frames espera un track perdido (oficial)?`, change: { fps: 15 }, ask: MK.lostFrames,
              explain: 'La mitad: el oficial escala el buffer con fps/30, así que el tiempo de espera en segundos queda igual.' },
            { q: 'Mismo cambio, 15 fps. ¿Y la fracción del cómputo que es tracker?', change: { fps: 15 }, ask: MK.share,
              explain: 'Igual: por frame, ni el detector ni el tracker cambian. Lo que cambia es cuánto se mueve cada objeto entre frames (IoU más bajos).' },
          ] },
          { t: 'whatif', config: U, items: [
            { q: R`Ahora con ultralytics: subes la cámara de ${cf('fps', U)} a 60 fps. ¿Cuántos frames espera un track perdido?`, change: { fps: 60 }, ask: MK.lostFrames,
              explain: 'Los mismos 30: ultralytics 8.4 no escala track_buffer con los fps, así que a 60 fps un track perdido dura medio segundo (el oficial, 60 frames = 1 s).' },
          ] },

          { t: 'h3', text: 'A mano (1): un predict y un update de Kalman' },
          { t: 'p', html: R`Un track nuevo con caja medida z<sub>0</sub> = (x, y, a, h) = (100, 200, 0.5, 100). Con las constantes de ByteTrack (σ<sub>p</sub> = 1/20, σ<sub>v</sub> = 1/160): (a) la covarianza inicial usa desviaciones 2σ<sub>p</sub>h para posición y altura y 10σ<sub>v</sub>h para sus velocidades: ¿cuánto valen las varianzas de x y de ẋ? (b) Predice un frame: ¿cuál es la media y el bloque 2×2 de P′ para (x, ẋ)? (c) Llega la detección z<sub>1</sub> = (104, 202, 0.5, 100). Calcula S, la ganancia de x y de ẋ y el estado actualizado. (d) ¿Dónde predice el filtro la caja en el frame siguiente? (e) Repite con h = 200 y una innovación de 8 px en x: ¿qué cambia?` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con KalmanFilterXYAH de ultralytics 8.4.174 y con el KalmanFilter oficial de ByteTrack)',
              a: R`(a) σ<sub>x</sub> = 2·(1/20)·100 = 10 → 100; σ<sub>ẋ</sub> = 10·(1/160)·100 = 6.25 → 39.0625. (b) Con velocidad 0, la media no se mueve: (100, 200, 0.5, 100, 0, 0, 0, 0). El bloque de (x, ẋ): F P Fᵀ da [[P<sub>xx</sub> + P<sub>ẋẋ</sub>, P<sub>ẋẋ</sub>], [P<sub>ẋẋ</sub>, P<sub>ẋẋ</sub>]] = [[139.0625, 39.0625], [39.0625, 39.0625]], y Q suma (h/20)² = 25 en x y (h/160)² = 0.390625 en ẋ: P′ = [[164.0625, 39.0625], [39.0625, 39.453125]]. (c) R<sub>x</sub> = (h/20)² = 25 → S<sub>x</sub> = 164.0625 + 25 = 189.0625. Ganancias: K<sub>x</sub> = 164.0625/189.0625 = 105/121 ≈ 0.8678; K<sub>ẋ</sub> = 39.0625/189.0625 = 25/121 ≈ 0.2066 (multiplica todo por 16: 2625/3025 y 625/3025). Innovación en x: 4 → x = 100 + 4·105/121 ≈ 103.471, ẋ = 4·25/121 ≈ 0.826; en y (innovación 2): y ≈ 201.736, ẏ ≈ 0.413; a y h no cambian. La varianza de x baja a 164.0625·25/189.0625 ≈ 21.69. (d) x = 103.471 + 0.826 ≈ 104.298, y ≈ 202.149. (e) Todas las varianzas se multiplican por 4 (∝ h²), así que K es la misma: x = 100 + 8·105/121 ≈ 106.942 y ẋ ≈ 1.653, exactamente el doble. La corrección relativa al tamaño de la caja no cambia: invariancia a escala.` },
          ] },

          { t: 'h3', text: 'A mano (2): matriz de IoU, asignación y segunda pasada' },
          { t: 'p', html: R`Cajas de 10×10 en la misma fila (y de 0 a 10), escritas por su x<sub>1</sub>. Tracks predichos: T1 en 0, T2 en 4, T3 en 30. Detecciones altas: D1 en 1 (score 0.9), D2 en −3 (0.8), D3 en 60 (0.85). Detecciones bajas: L1 en 31 (0.3), L2 en 80 (0.2). Usa costo 1 − IoU (sin fusión con el score), umbral 0.8 en la primera pasada y 0.5 en la segunda. Con cajas del mismo tamaño desplazadas d, IoU = (10 − d)/(10 + d). (a) Arma la matriz de IoU 3×3 de la primera pasada. (b) Resuelve con un voraz (el par de menor costo primero) y con la asignación óptima. (c) ¿Qué hace la segunda pasada? (d) ¿Qué tracks quedan, y cuáles nacen?` },
          { t: 'qa', items: [
            { q: 'Solución (verificada con scipy.optimize.linear_sum_assignment y el IoU de ultralytics)',
              a: R`(a) Filas T1, T2, T3; columnas D1, D2, D3: T1: 9/11 ≈ 0.818 (d = 1), 7/13 ≈ 0.538 (d = 3), 0. T2: 7/13 ≈ 0.538 (d = 3), 3/17 ≈ 0.176 (d = 7), 0. T3: 0, 0, 0. Costos: [[0.182, 0.462, 1], [0.462, 0.824, 1], [1, 1, 1]]. (b) <b>Voraz</b>: T1–D1 (0.182); lo siguiente es T2–D2 con 0.824 &gt; 0.8: rechazado. T2 queda sin pareja y D2 abriría un track nuevo: un cambio de id. <b>Óptima</b>: T1–D2 y T2–D1, costo 0.462 + 0.462 = 0.923 contra 0.182 + 0.824 = 1.006 del cruce voraz: las dos cajas se explican con el mismo desplazamiento de −3 px (por ejemplo, la cámara giró). scipy además devuelve T3–D3 con costo 1 (IoU 0): hay que filtrarlo por el umbral; LAPJV con <code>cost_limit</code> no lo elige. (c) T3 quedó sin pareja y estaba siendo seguido: contra L1 y L2, IoU 9/11 ≈ 0.818 y 0 → T3–L1 con costo 0.182 ≤ 0.5. T3 sigue vivo gracias a una caja de score 0.3 (SORT lo habría perdido). L2 se descarta: es baja y no coincide con nada. (d) Siguen T1, T2 y T3; D3 abre un track nuevo (si su score 0.85 ≥ τ<sub>new</sub>), sin confirmar hasta el frame siguiente. Con el costo fusionado del código de MOT17 (1 − IoU·score) la matriz cambia ([[0.264, 0.569, 1], [0.515, 0.859, 1], …]) pero la asignación óptima es la misma.` },
          ] },

          { t: 'h3', text: 'Escríbelo: la asociación de ByteTrack en NumPy' },
          { t: 'p', html: R`Sin mirar: (1) <code>iou_matrix(a, b)</code> vectorizado para cajas (x<sub>1</sub>, y<sub>1</sub>, x<sub>2</sub>, y<sub>2</sub>); (2) <code>assign(cost, thresh)</code> con <code>linear_sum_assignment</code> y el filtro por umbral; (3) <code>byte_associate</code>: primera pasada con las altas, segunda con las bajas solo para los tracks sin pareja, y la lista de altas sin pareja como candidatas a track nuevo. Verificado sobre el ejercicio anterior (mismo resultado que a mano).` },
          { t: 'code', title: 'Solución de referencia (NumPy + SciPy)', files: [
            { name: 'byte_associate.py', lang: 'python', code: R`import numpy as np
from scipy.optimize import linear_sum_assignment


def iou_matrix(a, b):
    """IoU entre cajas a (N×4) y b (M×4) en formato x1, y1, x2, y2 → N×M."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area = lambda c: (c[:, 2] - c[:, 0]) * (c[:, 3] - c[:, 1])
    return inter / (area(a)[:, None] + area(b)[None, :] - inter)


def assign(cost, thresh):
    """Asignación de costo mínimo; descarta pares con costo > thresh (scipy siempre empareja min(N, M))."""
    if cost.size == 0:
        return [], list(range(cost.shape[0])), list(range(cost.shape[1]))
    r, c = linear_sum_assignment(cost)
    pairs = [(i, j) for i, j in zip(r, c) if cost[i, j] <= thresh]
    mi = {i for i, _ in pairs}
    mj = {j for _, j in pairs}
    return pairs, [i for i in range(cost.shape[0]) if i not in mi], [j for j in range(cost.shape[1]) if j not in mj]


def byte_associate(tracks, dets, scores, t_high=0.6, t_low=0.1, thr1=0.8, thr2=0.5):
    """tracks: K×4 cajas predichas; dets: N×4; scores: N. Devuelve parejas (track, det) y altas sin pareja."""
    hi = np.where(scores > t_high)[0]
    lo = np.where((scores > t_low) & (scores <= t_high))[0]
    m1, u_trk, u_hi = assign(1 - iou_matrix(tracks, dets[hi]), thr1)     # 1.ª pasada: altas
    pairs = [(i, hi[j]) for i, j in m1]
    cost2 = 1 - iou_matrix(tracks[u_trk], dets[lo])                       # 2.ª: sobrantes × bajas
    m2, u_trk2, _ = assign(cost2, thr2)
    pairs += [(u_trk[i], lo[j]) for i, j in m2]
    lost = [u_trk[i] for i in u_trk2]                                     # sin pareja: pasan a perdidos
    new = [hi[j] for j in u_hi]                                           # candidatas a track nuevo (score ≥ τ_new)
    return sorted(pairs), lost, new                                       # las bajas sin pareja se descartan


if __name__ == '__main__':
    box = lambda x: [x, 0, x + 10, 10]
    tracks = np.array([box(0), box(4), box(30)], float)
    dets = np.array([box(1), box(-3), box(60), box(31), box(80)], float)
    scores = np.array([0.9, 0.8, 0.85, 0.3, 0.2])
    print(byte_associate(tracks, dets, scores))
    # parejas [(0, 1), (1, 0), (2, 3)]: T1–D2, T2–D1, T3–L1; perdidos []; nuevas [2] (D3)
` },
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. El matching húngaro en entrenamiento está en <a href="#detr">DETR</a>; la profundidad para trackear en 3-D, en <a href="#depth">depth</a>.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'bytetrack-01', kind: 'concepto', q: 'Tracking por detección en una línea.', a: 'Un detector da cajas por frame; un tracker liviano (Kalman + asignación por IoU) las enlaza en el tiempo con ids persistentes.' },
      { id: 'bytetrack-02', kind: 'concepto', q: 'La idea de ByteTrack en una línea.', a: 'Asociar también las cajas de baja confianza, pero solo en una segunda pasada contra los tracks que quedaron sin pareja: recupera objetos ocluidos sin crear tracks desde el fondo.' },
      { id: 'bytetrack-03', kind: 'forma', q: 'Estado y medición del Kalman de DeepSORT / ByteTrack.', a: 'Estado 8: (x, y, a, h, ẋ, ẏ, ȧ, ḣ), con a = w/h. Medición 4: (x, y, a, h). F es 8×8, H es 4×8.' },
      { id: 'bytetrack-04', kind: 'formula', q: 'Predict de Kalman.', a: R`\(\mathbf x' = F\mathbf x,\ \ P' = F P F^\top + Q\).` },
      { id: 'bytetrack-05', kind: 'formula', q: 'Update de Kalman.', a: R`\(S = HP'H^\top + R,\ K = P'H^\top S^{-1},\ \mathbf x = \mathbf x' + K(\mathbf z - H\mathbf x'),\ P = P' - KSK^\top\).` },
      { id: 'bytetrack-06', kind: 'concepto', q: '¿Por qué Q y R escalan con la altura de la caja en DeepSORT / ByteTrack?', a: 'El error del detector en píxeles crece con el tamaño del objeto; con todas las varianzas ∝ h², la ganancia K no depende de la escala (filtro invariante a escala). Heurística del código, no del paper.' },
      { id: 'bytetrack-07', kind: 'forma', q: 'Estado del Kalman de SORT (paper).', a: '7: (u, v, s, r, u̇, v̇, ṡ), con s = área y r = aspecto supuesto constante (sin velocidad).' },
      { id: 'bytetrack-08', kind: 'concepto', q: 'Las dos asociaciones de ByteTrack: quién contra quién.', a: '1.ª: tracks activos y perdidos × cajas altas (1 − IoU, × score en MOT17). 2.ª: tracks activos sin pareja × cajas bajas (IoU puro, IoU ≥ 0.5).' },
      { id: 'bytetrack-09', kind: 'concepto', q: 'Umbrales del ByteTrack oficial para MOT17.', a: 'track_thresh 0.6 (altas), 0.1 (piso de las bajas, fijo en el código), nuevo track ≥ 0.7 (track_thresh + 0.1), track_buffer 30 a 30 fps.' },
      { id: 'bytetrack-10', kind: 'trampa', q: '"Una caja baja sin pareja abre un track nuevo, por si acaso."', a: 'No: se descarta. Solo las altas sin pareja (score ≥ τ_new) abren tracks; las bajas aisladas son casi siempre fondo.' },
      { id: 'bytetrack-11', kind: 'concepto', q: '¿Por qué ByteTrack usa IoU y no ReID en la segunda asociación?', a: 'Las cajas bajas son las ocluidas o borrosas: el embedding de apariencia es poco confiable ahí. Tabla 1: IoU 76.6 MOTA vs ReID 75.8 (MOT17 val).' },
      { id: 'bytetrack-12', kind: 'trampa', q: '"match_thresh = 0.8 significa IoU ≥ 0.8."', a: 'Es un umbral de COSTO: 1 − IoU ≤ 0.8 → IoU ≥ 0.2 (y con fuse_score, IoU·score ≥ 0.2). El script oficial de MOT17 usa 0.9.' },
      { id: 'bytetrack-13', kind: 'concepto', q: 'Diferencia entre lap.lapjv con cost_limit y linear_sum_assignment.', a: 'scipy siempre empareja min(N, M) pares y hay que filtrar por umbral después. lapjv con cost_limit resuelve "emparejar o dejar solo" (cada lado sin pareja cuesta límite/2): nunca elige un par más caro que el límite y puede dejar sin pareja dos objetos que scipy + filtro habría emparejado.' },
      { id: 'bytetrack-14', kind: 'concepto', q: 'Ciclo de vida de un track en ByteTrack.', a: 'Nuevo (sin confirmar) → confirmado si se empareja en el frame siguiente (si no, se borra) → perdido si se queda sin pareja → borrado después del buffer; un perdido puede volver con el mismo id.' },
      { id: 'bytetrack-15', kind: 'trampa', q: '"track_buffer = 30 son 30 frames en cualquier implementación."', a: 'El oficial lo escala con fps/30 (1 s a cualquier fps); ultralytics 8.4 no: 30 frames siempre (2 s a 15 fps).' },
      { id: 'bytetrack-16', kind: 'formula', q: 'MOTA.', a: R`\(1 - \sum_t(\mathrm{FN}_t + \mathrm{FP}_t + \mathrm{IDSW}_t)/\sum_t \mathrm{GT}_t\): dominada por la detección; puede ser negativa.` },
      { id: 'bytetrack-17', kind: 'formula', q: 'IDF1.', a: R`\(2\,\mathrm{IDTP}/(2\,\mathrm{IDTP} + \mathrm{IDFP} + \mathrm{IDFN})\) con un emparejamiento global de trayectorias: mide cuánto se conserva la identidad.` },
      { id: 'bytetrack-18', kind: 'formula', q: 'HOTA.', a: R`\(\mathrm{HOTA}_\alpha = \sqrt{\mathrm{DetA}_\alpha\cdot\mathrm{AssA}_\alpha}\), promediado sobre 19 umbrales α = 0.05 … 0.95.` },
      { id: 'bytetrack-19', kind: 'trampa', q: '"Mi tracker tiene buen MOTA, así que no tiene problemas de identidad."', a: 'MOTA casi no ve los cambios de id (≈ 2 % de los errores en ByteTrack MOT17 test) y un intercambio a mitad del video cuesta 2. Mira IDF1 o AssA.' },
      { id: 'bytetrack-20', kind: 'conteo', q: 'ByteTrack en MOT17 test (Tabla 4).', a: '80.3 MOTA, 77.3 IDF1, 63.1 HOTA, 2,196 IDs, 29.6 FPS en V100 (con interpolación y umbrales por secuencia).' },
      { id: 'bytetrack-21', kind: 'conteo', q: 'Costo del tracker frente al detector en la canónica.', a: R`≈ ${met('tracker')} operaciones del tracker por frame contra ${met('det')} del detector: ≈ ${met('share')}.` },
      { id: 'bytetrack-22', kind: 'trampa', q: '"El tracker cuesta ≈ 0 % de los FLOPs, así que no aparece en la latencia."', a: 'En el paper, la asociación toma ≈ 4 ms de ≈ 34 ms por frame (Tabla 9): Python y bucles por track. Perfila.' },
      { id: 'bytetrack-23', kind: 'concepto', q: 'DeepSORT: la cascada de asociación.', a: 'Los tracks se asocian por apariencia en orden de edad (frames desde su última detección): primero los vistos hace 1 frame, hasta 30; al final, IoU para los sin confirmar y los de edad 1.' },
      { id: 'bytetrack-24', kind: 'concepto', q: 'DeepSORT: compuerta de Mahalanobis.', a: 'Descarta pares con distancia de Mahalanobis² > 9.4877 (cuantil 95 % de χ² con 4 grados de libertad) usando la covarianza proyectada del Kalman.' },
      { id: 'bytetrack-25', kind: 'concepto', q: 'Qué agrega BoT-SORT sobre ByteTrack.', a: 'Estado (x, y, w, h), compensación de movimiento de cámara (afín global con flujo óptico + RANSAC) y fusión IoU-ReID.' },
      { id: 'bytetrack-26', kind: 'concepto', q: 'Qué ataca OC-SORT.', a: 'La acumulación de error del Kalman durante oclusiones y el movimiento no lineal: re-actualiza con una trayectoria virtual al reaparecer (ORU), usa la dirección del movimiento en el costo (OCM) y recupera con la última observación (OCR).' },
      { id: 'bytetrack-27', kind: 'trampa', q: '"Para contar personas cuento los ids distintos."', a: 'Cada cambio de id suma una persona. Cuenta cruces de línea con histéresis y un mínimo de frames por track.' },
      { id: 'bytetrack-28', kind: 'concepto', q: 'Cámara en movimiento: qué se rompe y cómo se arregla.', a: 'La velocidad constante en píxeles: todo se desplaza a la vez y el IoU cae. Compensación global (BoT-SORT GMC), odometría / IMU del robot, o tracking en el marco del mundo con profundidad.' },
      { id: 'bytetrack-29', kind: 'tradeoff', q: 'ByteTrack vs DeepSORT / BoT-SORT con ReID.', a: 'ByteTrack: sin red extra, rápido, falla en oclusiones largas. ReID: re-identifica tras oclusiones y entre cámaras, cuesta una red por caja (Tabla 2 de ByteTrack: IDF1 79.3 → 80.5, 29.6 → 11.8 FPS) y no sirve con uniformes.' },
      { id: 'bytetrack-30', kind: 'tradeoff', q: 'track_buffer largo vs corto.', a: 'Largo: sobrevive oclusiones más largas, pero el track perdido predice en línea recta con incertidumbre creciente y puede robar otra detección (intercambio de id). Ajústalo en segundos con datos.' },
      { id: 'bytetrack-31', kind: 'trampa', q: '"El Kalman siempre asume un frame entre llamadas, aunque el detector salte frames."', a: 'Ese es el problema: si se saltan frames, la predicción se queda corta. Usa el dt real (timestamps) o predice k pasos.' },
      { id: 'bytetrack-32', kind: 'concepto', q: 'Por qué SORT borraba los tracks al perder una sola detección.', a: 'T_lost = 1: el modelo de velocidad constante predice mal a largo plazo y el paper deja la re-identificación fuera de alcance; un objeto que reaparece vuelve con id nuevo.' },
      { id: 'bytetrack-33', kind: 'concepto', q: 'Tracking en 3-D para un robot.', a: 'Proyectar cada caja a 3-D con profundidad (RGB-D, estéreo, LiDAR) y correr el Kalman en metros en el marco del mapa: velocidad constante más realista y ego-movimiento restado con la pose (AB3DMOT, CenterPoint).' },
      { id: 'bytetrack-34', kind: 'trampa', q: '"Los 80.3 MOTA de ByteTrack son lo que obtendré online con el repo."', a: 'Incluyen interpolación offline (usa el frame donde el track reaparece) y umbrales ajustados por secuencia de MOT17.' },
      { id: 'bytetrack-35', kind: 'concepto', q: 'Qué es fuse_score.', a: 'Costo = 1 − IoU·score de la detección en la primera asociación (MOT17 oficial y ultralytics por defecto; no en MOT20): entre IoU parecidos gana la caja más confiable.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'multi-object tracking (MOT)', es: 'seguimiento de múltiples objetos', def: 'Estimar las cajas de todos los objetos de un video y mantener una identidad por objeto a lo largo del tiempo.', say: 'Multi-object tracking adds persistent identities to per-frame detections.' },
      { en: 'data association', es: 'asociación de datos', def: 'Decidir qué detección corresponde a qué track en cada frame; en SORT / ByteTrack, una asignación uno a uno sobre un costo de IoU.', say: 'Most identity errors come from data association in crowded scenes.' },
      { en: 'Kalman filter', es: 'filtro de Kalman', def: 'Estimador recursivo de estado para sistemas lineales con ruido gaussiano: predice con el modelo y corrige con la medición según sus incertidumbres.', say: 'Each track has a constant-velocity Kalman filter over the box.' },
      { en: 'linear assignment problem', es: 'problema de asignación lineal', def: 'Emparejamiento uno a uno de costo total mínimo entre dos conjuntos; se resuelve con el algoritmo húngaro o con Jonker-Volgenant (LAPJV).', say: 'We solve a thresholded linear assignment on one minus IoU.' },
      { en: 'ID switch', es: 'cambio de identidad', def: 'Evento en que el id asignado a un objeto real cambia (o dos objetos intercambian ids).', say: 'Lowering the frame rate doubled our ID switches.' },
      { en: 'track buffer', es: 'buffer de tracks perdidos', def: 'Número de frames que un track sin detecciones se mantiene (prediciendo) antes de borrarse.', say: 'The track buffer should be set in seconds, not frames.' },
      { en: 'MOTA', es: 'MOTA', def: 'Multi-Object Tracking Accuracy: 1 menos la suma de falsos negativos, falsos positivos y cambios de id sobre el número de objetos reales; dominada por la detección.', say: 'MOTA mostly reflects detection quality.' },
      { en: 'IDF1', es: 'IDF1', def: 'F1 de detecciones correctamente identificadas con un emparejamiento global de trayectorias; mide la preservación de identidad.', say: 'For counting we track IDF1, not MOTA.' },
      { en: 'HOTA', es: 'HOTA', def: 'Higher Order Tracking Accuracy: media geométrica de la exactitud de detección y de asociación, promediada sobre umbrales de IoU.', say: 'HOTA lets us split detection and association errors.' },
      { en: 'camera motion compensation (CMC)', es: 'compensación del movimiento de cámara', def: 'Estimar el movimiento global entre frames (o tomarlo de la odometría) y aplicarlo a los tracks antes de asociar.', say: 'On the robot we compensate camera motion with the IMU.' },
      { en: 're-identification (ReID)', es: 're-identificación', def: 'Embedding de apariencia por recorte que permite reconocer a la misma persona tras una oclusión o en otra cámara.', say: 'ReID helps with long occlusions but costs a network per box.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
