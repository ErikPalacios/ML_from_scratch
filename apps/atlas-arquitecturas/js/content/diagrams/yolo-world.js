/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/yolo-world.js
   Diagramas de YOLO-World (SPEC §7.2, ids de §16.2), config canónica yolo-world-l-640:
     yolo-world-overview  arriba, el carril OFFLINE (marco ámbar): V nombres de clase → encoder de texto de CLIP
                          → V×512 embeddings normalizados que quedan como pesos ("prompt-then-detect"); abajo, lo
                          que corre en cada imagen: backbone YOLOv8-L (pirámide C3, C4, C5 dibujada a escala) →
                          RepVL-PAN (el texto guía a la imagen) → cabezas por nivel: cajas (DFL) y región-texto
                          (α·cos + β contra el vocabulario) → A celdas × V puntajes → NMS.
       yw-repvl-pan       el neck por dentro, una columna por stride (8, 16, 32): top-down (↑ ×2, concatenar,
                          T-CSPLayer con max-sigmoid guiada por el texto), image-pooling attention (el texto se
                          actualiza con 27 tokens de imagen) y bottom-up (conv s2, concatenar, T-CSPLayer con el
                          texto actualizado) → P3, P4, P5
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas las pone el motor desde ATLAS.Arch.run;
   aquí solo se nombran tensores. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'yolo-world-l-640';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const qr = (k) => '{{' + k + '}}';             // relativa a la config con la que se dibuja (solo texto dibujado)
  const PAGE = { page: 'yolo-world', section: 'diagrama' };

  // ------------------------------------------------------------------ (a) vista general
  ATLAS.registerDiagram(Object.assign({
    id: 'yolo-world-overview', model: 'yolo-world', config: C, kind: 'arch', title: 'YOLO-World — vista general',
    caption: 'Prompt-then-detect: el vocabulario (V nombres de clase) pasa UNA vez por el encoder de texto de CLIP (carril offline, arriba) y sus V×512 embeddings quedan como pesos. En cada imagen solo corre el detector: un YOLOv8-L cuyo neck (RepVL-PAN) se deja guiar por el texto y cuya cabeza de clase es un coseno contra el vocabulario, no una capa de K clases fijas. La salida sigue siendo densa (A celdas × V): hay NMS.',
    grid: { w: 120, h: 116 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['prompts', 'input', 'backbone'],   // a 375 px: el inicio del carril offline y el backbone, legibles
    groups: [
      { id: 'offline', style: 'offline', label: 'Offline · una vez por vocabulario', labelPos: 'bottom', x: 2, y: 1, w: 116, h: 16 },
      { id: 'heads', label: 'Por nivel · P3', x: 2, y: 76, w: 92, h: 16, repeat: { sym: 'niveles', from: 'levelShapes', len: true, tag: '× {v} niveles', crumb: false } },
    ],
    nodes: [
      { id: 'prompts', op: 'io', modality: 'txt', label: 'Vocabulario: V nombres', sub: '"person", "dog", "cat", …', x: 6, y: 6, w: 28, h: 8,
        note: 'La lista de clases que el usuario quiere detectar, una frase por clase (V = ' + q('cfg.V') + ' por defecto, las de COCO). Se tokeniza con el BPE de CLIP. Ultralytics (y el calculador) rellenan cada prompt a 77 tokens; el repo oficial rellena solo hasta el prompt más largo del lote (unos pocos tokens con nombres de clase), así que el costo offline real es bastante menor.' },
      { id: 'txt-encoder', op: 'attn', modality: 'txt', label: 'Encoder de texto CLIP', sub: 'ViT-B/32 · offline', x: 44, y: 6, w: 30, h: 8,
        costRef: { config: 'clip-vit-b32', nodes: ['txt-encoder', 'txt-proj'] },
        costNote: 'Costo por prompt (torre de texto de CLIP ViT-B/32). Corre offline: × V prompts = ' + q('vocabTextMacs') + ' MACs, una sola vez; 0 en el costo por imagen.',
        tex: 't_v = f_T(\\text{prompt}_v) \\in \\mathbb{R}^{512}',
        note: 'La torre de texto de CLIP ViT-B/32 (la de la página de CLIP), congelada durante el entrenamiento de YOLO-World. Se corre una vez por vocabulario, no por imagen: por eso el costo por imagen no la incluye. Con V = ' + q('cfg.V') + ', esa pasada única cuesta ' + q('metrics.vocabTextToOnline') + ' veces los MACs de UNA imagen con el relleno a 77 de Ultralytics (el peor caso: el repo oficial rellena al nombre más largo, varias veces menos). Se amortiza en pocas imágenes.' },
      { id: 'vocab', op: 'embed', modality: 'txt', label: 'Vocabulario de texto', sub: 'L2 → pesos de cabeza y neck', x: 84, y: 6, w: 30, h: 8,
        tex: 'W_{voc} = [\\hat t_1; \\dots; \\hat t_V] \\in \\mathbb{R}^{V\\times 512}',
        note: 'Los V embeddings normalizados. "Re-parametrizados": se guardan como pesos (de la cabeza y de la guía de texto del neck), así en la inferencia no hace falta CLIP. Cambiar el vocabulario = recalcular esta matriz, sin re-entrenar. Matiz: en la v1, la image-pooling attention ajusta el texto con la imagen antes del bottom-up, así que esa parte depende de la imagen; la v2 la quita.' },
      { id: 'input', op: 'io', label: 'Imagen', image: true, imageGrid: 0, x: 14, y: 21, w: 14, h: 12, note: 'La imagen de entrada, 640×640×3 (letterbox a cuadrado, como YOLOv8).' },
      { id: 'backbone', op: 'conv', label: 'Backbone YOLOv8-L', sub: 'CSPDarknet · C2f · SPPF', x: 4, y: 38, w: 46, h: 8,
        tex: 'C_3, C_4, C_5 = \\mathrm{CSPDarknet}(x)',
        note: 'El mismo backbone de YOLOv8-L: convs de stride 2 y bloques C2f (CSP con atajos), y un SPPF al final. Entrega la pirámide C3, C4, C5 (strides 8, 16, 32).' },
      { id: 'neck', op: 'fuse', style: 'block', badgePos: 'right', label: 'RepVL-PAN (neck)', x: 4, y: 58, w: 84, h: 11, expand: 'yw-repvl-pan',
        mini: { items: [{ label: 'top-down: T-CSP ×2', op: 'fuse' }, { label: 'image-pooling attn', op: 'fuse' }, { label: 'bottom-up: T-CSP ×2', op: 'fuse' }] },
        tex: 'P_3, P_4, P_5 = \\mathrm{RepVL\\text{-}PAN}(C_3, C_4, C_5;\\ W_{voc})',
        note: 'El PAN-FPN de YOLOv8 con dos agregados: cada C2f pasa a ser un T-CSPLayer (una max-sigmoid attention: cada píxel se compara con las V clases y su máximo, por una sigmoide, pondera la rama), y entre el top-down y el bottom-up una image-pooling attention actualiza los embeddings de texto con la imagen. Ábrelo para verlo por stride.' },
      { id: 'head-box', op: 'head', label: 'Cabeza de cajas', sub: 'conv ×3 → 4·R (DFL)', scope: 'p3', x: 6, y: 81, w: 30, h: 7,
        tex: '\\hat d = \\mathrm{DFL}\\big(\\mathrm{softmax}_R(z)\\big) \\in \\mathbb{R}^{4}',
        note: 'Igual que en YOLOv8: por celda, una distribución de R = 16 valores para cada lado de la caja (l, t, r, b); la DFL toma su esperanza. Sin anclas: cada celda predice distancias desde su centro. La insignia es la cabeza de P3 (cada nivel tiene la suya; la DFL no tiene pesos aprendidos).' },
      { id: 'head-text', op: 'head', label: 'Cabeza región–texto', sub: 'α · cos(e, t) + β', scope: 'p3', x: 44, y: 81, w: 40, h: 7,
        tex: 's_{k,v} = \\alpha\\, \\frac{e_k}{\\lVert e_k\\rVert} \\cdot \\frac{t_v}{\\lVert t_v\\rVert} + \\beta',
        note: 'En vez de una conv 1×1 a K clases, la rama de clase produce un embedding de objeto de 512 por celda, y el logit de cada clase es el coseno con su embedding de texto, escalado y desplazado (α, β aprendidos). Una clase nueva = una fila nueva del vocabulario. La insignia es la cabeza de P3 (cada nivel tiene la suya).' },
      { id: 'output', op: 'io', label: 'Cajas + nombres de clase', sub: 'A celdas × V puntajes → umbral + NMS', x: 8, y: 106, w: 72, h: 8,
        note: 'Las A = ' + q('anchors') + ' celdas de los 3 niveles, cada una con una caja y V puntajes (sigmoide). Como en YOLOv8, varias celdas ven el mismo objeto: umbral de confianza y NMS (fuera del modelo).' },
    ],
    tensors: [
      { id: 'c3', at: { x: 62, y: 49 }, glyph: 'fmap', px: 1, show: 'glyph', note: 'C3 · stride 8' },
      { id: 'c4', at: { x: 77, y: 49 }, glyph: 'fmap', px: 1, show: 'glyph', note: 'C4 · stride 16' },
      { id: 'c5', at: { x: 90, y: 49 }, glyph: 'fmap', px: 1, show: 'glyph', note: 'C5 · stride 32' },
      { id: 'logits-p3', at: { edge: 'head-text>output' }, show: 'both', glyph: 'matrix', diag: false, axes: { rows: 'img', cols: 'txt' } },
    ],
    notes: [
      { x: 4, y: 20.4, text: 'EN LÍNEA · por imagen', cls: 'ink' },
      { x: 76, y: 32.4, text: 'la pirámide a escala (1 px por celda)', anchor: 'middle' },
      { x: 84, y: 108.6, text: 'P3: ' + qr('p3Cells') + ' celdas', cls: 'ink' },
      { x: 84, y: 110.4, text: '+ P4: ' + qr('p4Cells') + ' + P5: ' + qr('p5Cells') },
      { x: 84, y: 112.2, text: '= A = ' + qr('anchors') + ' celdas' },
      { x: 42.5, y: 90.8, text: 'las 3 cabezas: ' + qr('headParams') + ' parámetros', anchor: 'middle' },
    ],
    edges: [
      { from: 'prompts', to: 'txt-encoder', kind: 'data', tensor: 'prompts' },
      { from: 'txt-encoder', to: 'vocab', kind: 'data', tensor: 'txt-emb' },
      { from: 'input', to: 'backbone', kind: 'data', tensor: 'x-img', toAt: 0.3696 },
      // la pirámide: tres salidas del backbone (strides 8, 16, 32) hacia el neck
      { from: 'backbone', to: 'neck', kind: 'data', tensor: 'c3', fromAt: 0.1, toAt: 0.0548 },
      { from: 'backbone', to: 'neck', kind: 'data', tensor: 'c4', fromAt: 0.45, toAt: 0.2464 },
      { from: 'backbone', to: 'neck', kind: 'data', tensor: 'c5', fromAt: 0.8, toAt: 0.4381 },
      // el texto (offline) entra al neck (guía) y a la cabeza (pesos)
      { from: 'vocab', to: 'neck', kind: 'data', tensor: 'vocab', fromAt: 0.5, toSide: 'right', labelSeg: 0, labelT: 0.36, tag: 'guía', tagStyle: 'plain', tagSeg: 0, tagT: 0.75, tagSide: 'on' },
      { from: 'vocab', to: 'head-text', kind: 'data', tensor: 'vocab', fromAt: 0.85, toSide: 'right', label: false, tag: 'pesos', tagStyle: 'plain', tagSeg: 0, tagT: 0.86, tagSide: 'on' },
      { from: 'neck', to: 'head-box', kind: 'data', tensor: 'p3', fromAt: 0.2024, toAt: 0.5, labelT: 0.25 },
      { from: 'neck', to: 'head-text', kind: 'data', tensor: 'p3', fromAt: 0.7143, toAt: 0.5, label: false },
      { from: 'head-box', to: 'output', kind: 'data', tensor: 'boxes-p3', toAt: 0.1806, labelT: 0.72 },
      { from: 'head-text', to: 'output', kind: 'data', tensor: 'logits-p3', toAt: 0.7778, labelSide: 'right', labelT: 0.6 },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (YOLO-World-L @ 640, V = 80)', steps: [
        { nodes: ['prompts', 'txt-encoder', 'vocab'], edges: ['prompts>txt-encoder', 'txt-encoder>vocab'], tensors: ['prompts', 'txt-emb', 'vocab'],
          text: '<b>Offline, una vez</b>: los V = ' + q('cfg.V') + ' nombres (<b>' + q('tensor.prompts.shape') + '</b> ids) pasan por el encoder de texto de CLIP (' + q('textEncoderParams') + ' parámetros, ' + q('promptTextMacs') + ' MACs por prompt) y quedan <b>' + q('tensor.vocab.shape') + '</b> embeddings normalizados: los "pesos" del vocabulario.' },
        { nodes: ['input', 'backbone'], edges: ['input>backbone', 'backbone>neck'], tensors: ['x-img', 'c3', 'c4', 'c5'],
          text: 'En cada imagen (<b>' + q('tensor.x-img.shape') + '</b>), el backbone de YOLOv8-L (' + q('node.backbone.params') + ' parámetros) da la pirámide <b>' + q('tensor.c3.shape') + '</b>, <b>' + q('tensor.c4.shape') + '</b> y <b>' + q('tensor.c5.shape') + '</b>.' },
        { expand: 'yw-repvl-pan', nodes: ['up4', 'cat4', 't-csp', 'tcsp-td3'], edges: ['c5-in>up4', 'up4>cat4', 'c4-in>cat4', 'cat4>t-csp', 'txt-td4>t-csp', 't-csp>up3', 'up3>cat3', 'cat3>tcsp-td3'], tensors: ['td4-cat', 'td4-tg-scores', 'p4-td', 'p3'],
          text: 'Top-down: C5 se sube ×2 y se concatena con C4 (<b>' + q('tensor.td4-cat.shape') + '</b>). El T-CSPLayer compara cada píxel con cada clase (<b>' + q('tensor.td4-tg-scores.shape') + '</b> similitudes, con cabezas), toma el máximo y lo pasa por una sigmoide: los píxeles parecidos a alguna clase pesan más. Lo mismo hacia P3: <b>' + q('tensor.p3.shape') + '</b>.' },
        { expand: 'yw-repvl-pan', nodes: ['pool', 'img-pool-attn', 'txt-ipa'], edges: ['pool>img-pool-attn', 'txt-ipa>img-pool-attn', 'img-pool-attn>tcsp-bu4', 'img-pool-attn>tcsp-bu5'], tensors: ['ipa-tokens', 'vocab-upd'],
          text: 'Image-pooling attention: P3, P4 y C5 se reducen a 3×3 cada uno (<b>' + q('tensor.ipa-tokens.shape') + '</b> tokens) y cada clase los consulta (<b>' + q('tensor.ipa-scores.shape') + '</b>): el texto se ajusta a esta imagen (<b>' + q('tensor.vocab-upd.shape') + '</b>) para guiar el bottom-up.' },
        { expand: 'yw-repvl-pan', nodes: ['down4', 'catb4', 'tcsp-bu4', 'down5', 'catb5', 'tcsp-bu5'], edges: ['tcsp-td3>down4', 'down4>catb4', 'catb4>tcsp-bu4', 'tcsp-bu4>down5', 'down5>catb5', 'c5-b>catb5', 'catb5>tcsp-bu5', 'img-pool-attn>tcsp-bu4', 'img-pool-attn>tcsp-bu5'], tensors: ['p4', 'p5'],
          text: 'Bottom-up: conv de stride 2, concatenar (con P4 del top-down y con C5) y T-CSPLayer guiado por el texto actualizado: <b>' + q('tensor.p4.shape') + '</b> y <b>' + q('tensor.p5.shape') + '</b>. Todo el neck: ' + q('node.neck.params') + ' parámetros, ' + q('node.neck.macsPct') + ' de los MACs.' },
        { nodes: ['head-box', 'head-text'], edges: ['neck>head-box', 'neck>head-text', 'vocab>head-text'], tensors: ['p3', 'logits-p3', 'boxes-p3'],
          text: 'Cabezas, por nivel (P3): cajas como distribuciones DFL (<b>' + q('tensor.boxes-p3.shape') + '</b>) y un embedding de objeto por celda que se compara (coseno) con las V filas del vocabulario: <b>' + q('tensor.logits-p3.shape') + '</b> logits. Sin capa de K clases.' },
        { nodes: ['output'], edges: ['head-box>output', 'head-text>output'], tensors: ['boxes-p3', 'logits-p3'],
          text: 'Los 3 niveles juntos: A = ' + q('anchors') + ' celdas → <b>' + q('tensor.boxes.shape') + '</b> cajas y <b>' + q('tensor.scores.shape') + '</b> puntajes. Umbral y NMS, como cualquier YOLO. Por imagen: ' + q('macs.totalG') + ' MACs, sin el encoder de texto.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) RepVL-PAN por dentro
  // Una columna por stride: P3 (8) a la izquierda, P4 (16) al centro, P5 (32) a la derecha. El top-down baja
  // de derecha a izquierda (arriba), el bottom-up sube de izquierda a derecha (abajo). El texto entra a cada
  // T-CSPLayer como guía (arista "control": la max-sigmoid usa el texto solo como claves de una compuerta): el
  // vocabulario en el top-down (chips "texto") y, en el bottom-up, el texto que sale de la image-pooling attention
  // (dos aristas desde ese bloque). C5 se dibuja otra vez junto a la última concatenación: un riel largo desde
  // arriba encerraría la image-pooling attention y obligaría a cruzar aristas.
  const tcspNote = 'T-CSPLayer = un C2f con una max-sigmoid attention: el texto se proyecta (una fila por clase), cada píxel se compara con cada clase (por cabeza), el máximo pasa por una sigmoide y escala la rama. Así el texto decide qué zonas del mapa se refuerzan; el texto entra solo como claves (no aporta valores). La fórmula es la ec. 2 del paper, simplificada: el código además pasa la rama por una conv 3×3 + BN, divide por √d, suma un sesgo por cabeza antes de la sigmoide y proyecta el texto con una lineal.';
  ATLAS.registerDiagram(Object.assign({
    id: 'yw-repvl-pan', model: 'yolo-world', config: C, kind: 'arch', title: 'RepVL-PAN (neck de YOLO-World)',
    parent: 'yolo-world-overview', parentNode: 'neck',
    caption: 'Una columna por stride (8, 16, 32). Top-down: subir ×2, concatenar con el nivel del backbone y un T-CSPLayer guiado por el texto. En medio, la image-pooling attention: 27 tokens de imagen (3×3 de P3, P4 y C5) actualizan el texto. Bottom-up: conv de stride 2, concatenar y otro T-CSPLayer, guiado ahora por el texto actualizado (las dos aristas punteadas que salen de la image-pooling attention; la max-sigmoid usa el texto solo como claves de una compuerta). C5 aparece dos veces para no cruzar aristas. Salen P3, P4 y P5 para las cabezas.',
    grid: { w: 124, h: 103 }, direction: 'tb', maxCrossings: 0,
    nodes: [
      { id: 'c3-in', op: 'io', modality: 'img', label: 'C3 (stride 8)', x: 13, y: 1, w: 18, h: 5, note: 'Salida del stage 3 del backbone.' },
      { id: 'c4-in', op: 'io', modality: 'img', label: 'C4 (stride 16)', x: 53, y: 1, w: 18, h: 5, note: 'Salida del stage 4 del backbone.' },
      { id: 'c5-in', op: 'io', modality: 'img', label: 'C5 (stride 32)', x: 95, y: 1, w: 18, h: 5, note: 'Salida del SPPF.' },
      { id: 'up4', op: 'tensorop', shape: 'pill', label: '↑ ×2', costOf: 'upsample', scope: 'td-p4', x: 95, y: 12, w: 10, h: 4, tex: '\\mathrm{nearest}(\\times 2)', note: 'Sube la resolución ×2 (vecino más cercano). Sin parámetros.' },
      { id: 'cat4', op: 'tensorop', shape: 'concat', label: 'Concatenar', labelPos: 'left', costOf: 'concat', scope: 'td-p4', x: 60, y: 12, w: 4, h: 4, tex: '[\\uparrow C_5;\\, C_4]', note: 'Une los canales del nivel de arriba (subido) con los del backbone.' },
      { id: 'txt-td4', op: 'io', modality: 'txt', label: 'texto', x: 38, y: 21, w: 10, h: 4.5, note: 'Los V embeddings del vocabulario (los mismos para toda imagen).' },
      { id: 't-csp', op: 'fuse', label: 'T-CSPLayer', sub: 'top-down · P4', scope: 'td-p4', badgePos: 'right', x: 52, y: 22, w: 20, h: 7,
        tex: 'X\' = X \\cdot \\sigma\\big(\\max_{v} (X W_x)(t_v W_t)^{\\top}\\big)', note: tcspNote },
      { id: 'up3', op: 'tensorop', shape: 'pill', label: '↑ ×2', costOf: 'upsample', scope: 'td-p3', x: 37, y: 33, w: 12, h: 4, tex: '\\mathrm{nearest}(\\times 2)', note: 'Sube P4 (top-down) al tamaño de C3.' },
      { id: 'cat3', op: 'tensorop', shape: 'concat', label: 'Concatenar', labelPos: 'left', costOf: 'concat', scope: 'td-p3', x: 20, y: 33, w: 4, h: 4, tex: '[\\uparrow P_4;\\, C_3]', note: 'Une P4 subido con C3.' },
      { id: 'txt-td3', op: 'io', modality: 'txt', label: 'texto', x: 1, y: 44, w: 9, h: 5, note: 'El mismo vocabulario.' },
      { id: 'tcsp-td3', op: 'fuse', label: 'T-CSPLayer', sub: 'top-down · P3', costOf: 't-csp', scope: 'td-p3', x: 12, y: 43, w: 20, h: 7, tex: 'X\' = X \\cdot \\sigma(\\max_v \\dots)', note: tcspNote + ' Su salida es P3, la del nivel más fino.' },
      { id: 'txt-ipa', op: 'io', modality: 'txt', label: 'texto', x: 88, y: 25.5, w: 12, h: 4.5, note: 'El vocabulario entra como queries (una por clase).' },
      { id: 'img-pool-attn', op: 'fuse', label: 'Image-pooling attn', sub: 'texto ← 27 tokens', heads: 'ipa.nh', headsSym: 'h', x: 82, y: 35, w: 24, h: 7,
        tex: "t' = t + \\mathrm{MHA}(t,\\ \\mathrm{pool}_{3\\times 3}(P_3, P_4, C_5))",
        note: 'Cada clase (query) atiende a 27 tokens de imagen: un max-pool 3×3 de P3, P4 (top-down) y C5, proyectados. El resultado se suma al embedding: el texto actualizado (las dos aristas que salen hacia abajo) guía a los dos T-CSPLayers del bottom-up; la cabeza sigue usando el vocabulario original. La v2 de YOLO-World la quita (así el vocabulario re-parametrizado es exacto).' },
      { id: 'pool', op: 'tensorop', shape: 'pool', label: '3×3 de P3, P4, C5', labelPos: 'below', costOf: 'pool', scope: 'img-pool-attn', x: 92, y: 48, w: 4, h: 4, tex: '\\mathrm{maxpool}_{3\\times 3}', note: 'Cada mapa se proyecta a 256 canales y se reduce a 3×3 con un max-pool adaptativo: 3 niveles × 9 = 27 tokens.' },
      { id: 'down4', op: 'conv', label: 'conv 3×3 s2', costOf: 'downsample', scope: 'bu-p4', x: 55, y: 44.5, w: 14, h: 4, tex: '\\mathrm{Conv}_{3\\times 3,\\,s=2}', note: 'Baja P3 a la resolución de P4.' },
      { id: 'catb4', op: 'tensorop', shape: 'concat', label: 'Concatenar', labelPos: 'left', costOf: 'concat', scope: 'bu-p4', x: 60, y: 54, w: 4, h: 4, tex: '[\\downarrow P_3;\\, P_4^{td}]', note: 'Une P3 bajado con el P4 del top-down.' },
      { id: 'tcsp-bu4', op: 'fuse', label: 'T-CSPLayer', sub: 'bottom-up · P4', costOf: 't-csp', scope: 'bu-p4', x: 52, y: 64, w: 20, h: 7, tex: 'X\' = X \\cdot \\sigma(\\max_v \\dots)', note: tcspNote + ' Usa el texto actualizado.' },
      { id: 'down5', op: 'conv', label: 'conv 3×3 s2', costOf: 'downsample', scope: 'bu-p5', x: 87, y: 65.5, w: 14, h: 4, tex: '\\mathrm{Conv}_{3\\times 3,\\,s=2}', note: 'Baja P4 a la resolución de P5.' },
      { id: 'catb5', op: 'tensorop', shape: 'concat', label: 'Concatenar', labelPos: 'left', costOf: 'concat', scope: 'bu-p5', x: 92, y: 74, w: 4, h: 4, tex: '[\\downarrow P_4;\\, C_5]', note: 'Une P4 bajado con C5.' },
      { id: 'c5-b', op: 'io', modality: 'img', label: 'C5', x: 100, y: 73.5, w: 8, h: 5, note: 'El mismo C5 (salida del SPPF) de arriba, dibujado otra vez aquí para no cruzar aristas.' },
      { id: 'tcsp-bu5', op: 'fuse', label: 'T-CSPLayer', sub: 'bottom-up · P5', costOf: 't-csp', scope: 'bu-p5', x: 84, y: 84, w: 20, h: 7, tex: 'X\' = X \\cdot \\sigma(\\max_v \\dots)', note: tcspNote + ' Usa el texto actualizado.' },
      { id: 'p3-out', op: 'io', modality: 'img', label: 'P3 → cabezas', x: 13, y: 97, w: 18, h: 5, note: 'Stride 8: objetos chicos.' },
      { id: 'p4-out', op: 'io', modality: 'img', label: 'P4 → cabezas', x: 53, y: 97, w: 18, h: 5, note: 'Stride 16.' },
      { id: 'p5-out', op: 'io', modality: 'img', label: 'P5 → cabezas', x: 85, y: 97, w: 18, h: 5, note: 'Stride 32: objetos grandes.' },
    ],
    tensors: [
      // los scores píxel × clase del T-CSPLayer top-down (P4), pegados a su bloque con una línea guía
      { id: 'td4-tg-scores', at: { x: 44, y: 19.5 }, show: 'both', labelSide: 'left', glyph: 'amat', axes: { rows: 'img', cols: 'txt' }, note: 'píxel × clase', leader: { node: 't-csp', side: 'top', at: 0.12 } },
    ],
    notes: [
      { x: 1, y: 74.6, text: '← top-down (P5 → P3)' },
      { x: 1, y: 76.6, text: '→ bottom-up (P3 → P5)' },
    ],
    edges: [
      { from: 'c5-in', to: 'up4', kind: 'data', tensor: 'c5', fromAt: 0.2778, toAt: 0.5, labelSide: 'left' },
      { from: 'up4', to: 'cat4', kind: 'data', tensor: 'td4-up', fromSide: 'left', toSide: 'right', labelSide: 'below', labelT: 0.3 },
      { from: 'c4-in', to: 'cat4', kind: 'data', tensor: 'c4', labelSide: 'right' },
      { from: 'cat4', to: 't-csp', kind: 'data', tensor: 'td4-cat', labelT: 0.35 },
      { from: 'txt-td4', to: 't-csp', kind: 'control', tensor: 'vocab', fromSide: 'right', toSide: 'left', toAt: 0.2 },
      { from: 't-csp', to: 'up3', kind: 'data', tensor: 'p4-td', fromSide: 'left', toSide: 'top', fromAt: 0.8, labelSeg: 1, labelSide: 'left' },
      { from: 'up3', to: 'cat3', kind: 'data', tensor: 'td3-up', fromSide: 'left', toSide: 'right', labelSide: 'below' },
      { from: 'c3-in', to: 'cat3', kind: 'data', tensor: 'c3', labelSide: 'left' },
      { from: 'cat3', to: 'tcsp-td3', kind: 'data', tensor: 'td3-cat', labelSide: 'left' },
      { from: 'txt-td3', to: 'tcsp-td3', kind: 'control', tensor: 'vocab', fromSide: 'right', toSide: 'left' },
      { from: 'tcsp-td3', to: 'p3-out', kind: 'data', tensor: 'p3', labelT: 0.6 },
      { from: 'tcsp-td3', to: 'down4', kind: 'data', tensor: 'p3', fromSide: 'right', toSide: 'left', label: false, tag: false },
      { from: 'txt-ipa', to: 'img-pool-attn', kind: 'data', tensor: 'vocab', fromAt: 0.5, toAt: 0.5, label: false },
      { from: 'pool', to: 'img-pool-attn', kind: 'data', tensor: 'ipa-tokens', labelSide: 'right', labelT: 0.5 },
      { from: 'down4', to: 'catb4', kind: 'data', tensor: 'bu4-down', labelSide: 'right' },
      { from: 't-csp', to: 'catb4', kind: 'data', tensor: 'p4-td', fromSide: 'right', toSide: 'right', via: [[78, 25.5], [78, 56]], label: false },
      { from: 'catb4', to: 'tcsp-bu4', kind: 'data', tensor: 'bu4-cat', labelSide: 'left' },
      // el texto actualizado por la image-pooling attention guía a los dos T-CSPLayers del bottom-up
      { from: 'img-pool-attn', to: 'tcsp-bu4', kind: 'control', tensor: 'vocab-upd', fromSide: 'bottom', fromAt: 0.0833, via: [[84, 60], [70, 60]], toSide: 'top', toAt: 0.9, tag: 'texto act.', tagStyle: 'plain', tagSeg: 0, tagT: 0.85, tagSide: 'on' },
      { from: 'img-pool-attn', to: 'tcsp-bu5', kind: 'control', tensor: 'vocab-upd', fromSide: 'bottom', fromAt: 0.875, via: [[103, 45], [112, 45], [112, 87.5]], toSide: 'right', toAt: 0.5, tag: 'texto act.', tagStyle: 'plain', tagSeg: 2, tagT: 0.55, tagSide: 'on' },
      { from: 'tcsp-bu4', to: 'p4-out', kind: 'data', tensor: 'p4', labelT: 0.55, labelSide: 'left' },
      { from: 'tcsp-bu4', to: 'down5', kind: 'data', tensor: 'p4', fromSide: 'right', toSide: 'left', label: false, tag: false },
      { from: 'down5', to: 'catb5', kind: 'data', tensor: 'bu5-down', labelSide: 'right' },
      { from: 'c5-b', to: 'catb5', kind: 'data', tensor: 'c5', fromSide: 'left', toSide: 'right', label: false },
      { from: 'catb5', to: 'tcsp-bu5', kind: 'data', tensor: 'bu5-cat' },
      { from: 'tcsp-bu5', to: 'p5-out', kind: 'data', tensor: 'p5', labelT: 0.5 },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
