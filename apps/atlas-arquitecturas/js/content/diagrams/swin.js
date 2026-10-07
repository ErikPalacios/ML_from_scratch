/* =============================================================================
   Atlas de Arquitecturas — js/content/diagrams/swin.js
   Diagramas de Swin (SPEC §7.2, ids de §14.1), config canónica swin-t-224:
     swin-overview      la jerarquía: 4 etapas con sus mapas dibujados a escala (lado lineal,
                        profundidad log C, rejilla de ventanas M×M), patch merging, strides 4…32
                        y, alineada, la tira C2…C5 de ResNet-50 (refTensors de resnet50-224)
     swin-block-pair    el par de bloques del stage 1: W-MSA → SW-MSA, con sus residuales
     swin-wmsa          la atención en ventanas por dentro (bloque 1 del stage 1)
     swin-swmsa         la versión desplazada: roll, máscara y roll inverso (bloque 2)
     swin-patch-merging merge1: concatenar 2×2 → LN(4C) → Linear 4C→2C
   Solo datos: posiciones en unidades de grilla (1 u = 8 px). Las formas y los costos los pone el
   motor desde ATLAS.Arch.run('swin-t-224'); aquí solo se nombran tensores y ops. No toca el DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const C = 'swin-t-224';
  const q = (k) => '{{' + C + '.' + k + '}}';
  const PAGE = { page: 'swin', section: 'diagrama' };

  // ------------------------------------------------------------------ (a) vista general
  // Columna principal (x 2…38) de arriba abajo; a la derecha, la salida de cada etapa a escala y la
  // tira de ResNet-50 con los mismos strides (el puente con la página anterior).
  const STAGE_Y = [27, 55, 83, 111];               // y de cada grupo (h = 13)
  const MERGE_Y = [46, 74, 102];
  const stageNode = (k) => ({
    id: 'stage' + k, op: 'attn', style: 'block', badgeTotal: true, badgeUnit: 'por par',
    label: 'Stage ' + k + ': W-MSA + SW-MSA', x: 4, y: STAGE_Y[k - 1] + 4.5, w: 32, h: 7.5,
    expand: k === 1 ? 'swin-block-pair' : undefined,
    flag: k === 4 ? 'shift ' + q('s4Shift') : undefined,
    mini: { items: [{ label: 'W-MSA', op: 'attn' }, { sym: 'add' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' },
      { label: 'SW-MSA', op: 'attn' }, { sym: 'add' }, { label: 'MLP', op: 'mlp' }, { sym: 'add' }], res: [[0, 1], [2, 3], [4, 5], [6, 7]] },
    tex: "\\begin{aligned} \\hat z^{\\ell} &= \\text{W-MSA}(\\mathrm{LN}(z^{\\ell-1})) + z^{\\ell-1} \\\\ z^{\\ell} &= \\mathrm{MLP}(\\mathrm{LN}(\\hat z^{\\ell})) + \\hat z^{\\ell} \\\\ \\hat z^{\\ell+1} &= \\text{SW-MSA}(\\mathrm{LN}(z^{\\ell})) + z^{\\ell} \\\\ z^{\\ell+1} &= \\mathrm{MLP}(\\mathrm{LN}(\\hat z^{\\ell+1})) + \\hat z^{\\ell+1} \\end{aligned}",
    note: k === 1
      ? 'Un par de bloques pre-LN: el primero con atención en ventanas regulares (W-MSA), el segundo con ventanas desplazadas (SW-MSA). La LayerNorm antes de cada sub-bloque se omite en el resumen. La forma no cambia dentro de la etapa: ' + q('tensor.x-embed.shape') + '. Ábrelo para ver el par por dentro.'
      : k === 4
        ? 'Último stage: el mapa de ' + q('s4Res') + '×' + q('s4Res') + ' cabe en una sola ventana de ' + q('s4Window') + '×' + q('s4Window') + ', así que el segundo bloque NO desplaza (shift ' + q('s4Shift') + ', como timm): es un W-MSA más. Cada token ya ve a todos los demás.'
        : 'Igual que el par del stage 1 (ábrelo allí), con ' + q('s' + k + 'C') + ' canales, h = ' + q('s' + k + 'Heads') + ' cabezas de d_h = ' + q('dh') + ' y ' + q('s' + k + 'Windows') + ' ventanas de ' + q('s' + k + 'Window') + '×' + q('s' + k + 'Window') + '.',
  });
  const mergeNode = (k) => ({
    id: 'merge' + k, op: 'embed', label: 'Patch merging', sub: '2×2 vecinos → 4C → LN → 2C', x: 8, y: MERGE_Y[k - 1], w: 24, h: 5,
    expand: k === 1 ? 'swin-patch-merging' : undefined,
    tex: '\\begin{aligned} z\' &= [z_{00};z_{10};z_{01};z_{11}] \\in \\mathbb{R}^{\\frac{H}{2}\\times\\frac{W}{2}\\times 4C} \\\\ z\'\' &= \\mathrm{LN}(z\')\\,W,\\; W \\in \\mathbb{R}^{4C\\times 2C} \\end{aligned}',
    note: 'Baja la resolución a la mitad y duplica los canales, como una conv de stride 2 en una CNN: junta cada 2×2 tokens vecinos (4C canales), normaliza y proyecta a 2C con una Linear sin sesgo.' + (k === 1 ? ' Ábrelo para ver las formas.' : ''),
  });
  const stageGroup = (k) => ({
    id: 'g-stage' + k, x: 2, y: STAGE_Y[k - 1], w: 36, h: 13, modality: 'img',
    repeat: { from: 'depths', index: k - 1, div: 2, tag: '× {v} par{pl}', totalOf: 'stage' + k, totalLabel: '= {t} total', crumb: false },
  });
  // Salida de cada etapa a escala (lado lineal: 2 px por token; profundidad log C) con la rejilla de ventanas.
  const STAGE_GLYPH = [[1, 40.9], [2, 65.7], [3, 92.2], [4, 119.6]];
  const RESNET_GLYPH = [['c2', 41.3], ['c3', 66.1], ['c4', 92.6], ['c5', 120.0]];

  ATLAS.registerDiagram(Object.assign({
    id: 'swin-overview', model: 'swin', config: C, kind: 'arch',
    title: 'Swin — vista general (jerarquía)',
    caption: 'Imagen → tokens de 4×4 px → 4 stages; entre stages, patch merging (resolución ÷2, canales ×2). A la derecha, la salida de cada stage a escala con su rejilla de ventanas M×M, y la de ResNet-50 con los mismos strides: Swin entrega la misma pirámide C2…C5. Toca un bloque para ver su costo; abre el stage 1 o el primer patch merging para ver su interior.',
    grid: { w: 96, h: 136 }, direction: 'tb', maxCrossings: 0,
    mobileFocus: ['patch-embed', 'stage1', 'merge1'],
    groups: [1, 2, 3, 4].map(stageGroup),
    nodes: [
      { id: 'input', op: 'io', label: 'Imagen', image: true, imageGrid: 0, x: 13, y: 1, w: 14, h: 11,
        note: 'La imagen de entrada, H×W×3 (canales al final en el texto; PyTorch usa C×H×W).' },
      { id: 'patch-embed', op: 'conv', label: 'Patch embedding', sub: 'conv P×P, stride P + LN', subNum: 'conv {{cfg.P}}×{{cfg.P}}, stride {{cfg.P}} + LN', x: 6, y: 17, w: 28, h: 5,
        tex: 'z_0 = \\mathrm{LN}(\\mathrm{Conv}_{P\\times P,\\,s=P}(x)) \\in \\mathbb{R}^{\\frac{H}{P}\\times\\frac{W}{P}\\times C}',
        note: '"Patch partition + linear embedding" del paper: una conv de kernel y stride P = ' + q('cfg.P') + ' (parches de 4×4 píxeles, cuatro veces más finos por lado que los de ViT-B/16) a C = ' + q('cfg.C') + ' canales, y una LayerNorm. Sin token CLS ni position embedding absoluta: la posición entra como sesgo dentro de la atención.' },
      stageNode(1), mergeNode(1), stageNode(2), mergeNode(2), stageNode(3), mergeNode(3), stageNode(4),
      { id: 'final-ln', op: 'norm', label: 'LayerNorm final', x: 12, y: 129, w: 16, h: 4,
        tex: '\\mathrm{LN}(z_4)', note: 'Una LayerNorm sobre todos los tokens del último stage.' },
      { id: 'pool', op: 'tensorop', shape: 'pool', label: 'Promedio global', labelPos: 'below', x: 44, y: 129, w: 4, h: 4,
        tex: '\\bar z = \\frac{1}{HW}\\sum_{i,j} z_{ij}', note: 'Global average pooling sobre los tokens del mapa final (como en ResNet; no hay token CLS).' },
      { id: 'head', op: 'head', label: 'Clasificador', sub: 'Linear 8C → K', x: 56, y: 128.5, w: 16, h: 5,
        tex: '\\text{logits} = W_{head}\\,\\bar z + b', note: 'Una capa lineal a K clases (aquí K es el número de clases, no las keys de la atención).' },
      { id: 'output', op: 'io', label: 'Logits → clase', x: 80, y: 129, w: 14, h: 4, note: 'Un logit por clase. Softmax para probabilidades; argmax para la predicción.' },
    ],
    tensors: [
      { id: 'x-img', at: { edge: 'input>patch-embed' }, show: 'both' },
    ].concat(STAGE_GLYPH.map(([k, y]) => ({ id: 's' + k + '-out', at: { x: 50, y }, glyph: 'fmap', px: 2, win: 'M', labelSide: 'below',
      note: q('s' + k + 'Windows') + (k === 4 ? ' ventana' : ' ventanas') + ' · shift ' + q('s' + k + 'Shift') }))),
    refTensors: RESNET_GLYPH.map(([id, y]) => ({ config: 'resnet50-224', id, at: { x: 84, y }, glyph: 'fmap', px: 2, labelSide: 'below', note: id.toUpperCase() })),
    notes: [
      { x: 50, y: 2.6, text: q('label') + ' · salida de cada stage', cls: 'title', anchor: 'middle' },
      { x: 84, y: 2.6, text: '{{resnet50-224.label}}', cls: 'title', anchor: 'middle' },
      { x: 67, y: 5.2, text: 'a escala: lado ∝ resolución · profundidad ∝ log C', anchor: 'middle' },
    ].concat([1, 2, 3, 4].map((k, i) => ({ x: 67, y: [34, 62, 90, 118][i], text: '← stride ' + q('s' + k + 'Stride') + ' →', cls: 'ink', anchor: 'middle' }))),
    edges: [
      { from: 'input', to: 'patch-embed', kind: 'data', tensor: 'x-img' },
      { from: 'patch-embed', to: 'stage1', kind: 'data', tensor: 'x-embed', labelT: 0.3 },
      { from: 'stage1', to: 'merge1', kind: 'data', tensor: 's1-out', labelT: 0.65 },
      { from: 'merge1', to: 'stage2', kind: 'data', tensor: 'm1-out', labelT: 0.25 },
      { from: 'stage2', to: 'merge2', kind: 'data', tensor: 's2-out', labelT: 0.65 },
      { from: 'merge2', to: 'stage3', kind: 'data', tensor: 'm2-out', labelT: 0.25 },
      { from: 'stage3', to: 'merge3', kind: 'data', tensor: 's3-out', labelT: 0.65 },
      { from: 'merge3', to: 'stage4', kind: 'data', tensor: 'm3-out', labelT: 0.25 },
      { from: 'stage4', to: 'final-ln', kind: 'data', tensor: 's4-out', labelT: 0.7 },
      { from: 'final-ln', to: 'pool', kind: 'data', tensor: 'x-ln' },
      { from: 'pool', to: 'head', kind: 'data', tensor: 'pooled' },
      { from: 'head', to: 'output', kind: 'data', tensor: 'logits' },
    ],
    walks: [
      { id: 'forward', label: 'Recorrido con números (' + 'Swin-T @ 224)', steps: [
        { nodes: ['input'], edges: ['input>patch-embed'], tensors: ['x-img'],
          text: 'Entra una imagen RGB de <b>' + q('tensor.x-img.shape') + '</b> (H×W×C, sin batch).' },
        { nodes: ['patch-embed'], edges: ['input>patch-embed', 'patch-embed>stage1'], tensors: ['x-img', 'x-embed'],
          text: 'Una conv de ' + q('cfg.P') + '×' + q('cfg.P') + ' con stride ' + q('cfg.P') + ' y una LayerNorm convierten cada parche de 4×4 píxeles en un token de C = ' + q('cfg.C') + ': <b>' + q('tensor.x-embed.shape') + '</b> = ' + q('tokens') + ' tokens (16 veces más que los 196 de ViT-B/16). Parámetros: ' + q('op.patch-embed.paramArith') + '.' },
        { expand: 'swin-block-pair', nodes: ['w-ln1', 'w-msa'], edges: ['in>w-ln1', 'w-ln1>w-msa'], tensors: ['x-embed', 's1-b1-ln1'],
          text: 'Stage 1, bloque 1 (W-MSA). Pre-LN como en ViT: LayerNorm por token y luego la atención, ahora <b>dentro de ventanas</b>. La forma del mapa no cambia: <b>' + q('tensor.s1-b1-ln1.shape') + '</b>.' },
        { expand: 'swin-wmsa', nodes: ['partition'], edges: ['in>partition', 'partition>qkv'], tensors: ['s1-b1-ln1', 's1-b1-win'],
          text: 'Partición: el mapa de ' + q('s1Res') + '×' + q('s1Res') + ' se corta en ' + q('s1Windows') + ' ventanas de ' + q('s1Window') + '×' + q('s1Window') + ' = ' + q('s1WindowTokens') + ' tokens: <b>' + q('tensor.s1-b1-win.shape') + '</b>. Las ventanas se apilan como un lote: cada una es una secuencia corta.' },
        { expand: 'swin-wmsa', nodes: ['qkv', 'split'], edges: ['partition>qkv', 'qkv>split', 'split>scores', 'split>weighted-sum'], tensors: ['s1-b1-qkv', 's1-b1-q', 's1-b1-k', 's1-b1-v'],
          text: 'La misma proyección Q, K, V para todas las ventanas (C → 3C, <b>' + q('tensor.s1-b1-qkv.shape') + '</b>; ' + q('op.s1-b1-qkv.paramArith') + ' parámetros) y se separa en h = ' + q('s1Heads') + ' cabezas de d_h = ' + q('dh') + ': <b>' + q('tensor.s1-b1-q.shape') + '</b>.' },
        { expand: 'swin-wmsa', nodes: ['scores', 'scale'], edges: ['split>scores', 'scores>scale', 'scale>bias'], tensors: ['s1-b1-scores', 's1-b1-scaled'],
          text: 'QKᵀ solo dentro de cada ventana: <b>' + q('tensor.s1-b1-scores.shape') + '</b>, una matriz ' + q('s1WindowTokens') + '×' + q('s1WindowTokens') + ' por ventana y cabeza. MACs de QKᵀ: ' + q('op.s1-b1-scores.macArith') + '. Con atención global serían ' + q('s1GlobalToWindow') + ' veces más (= número de ventanas): por eso el costo es lineal en los tokens.' },
        { expand: 'swin-wmsa', nodes: ['bias'], edges: ['scale>bias', 'bias>softmax'], tensors: ['s1-b1-biased'],
          text: 'Se suma el <b>sesgo de posición relativa</b> B: una tabla aprendida de (2M−1)² × h = ' + q('biasParamsS1Block') + ' parámetros, indexada por el desplazamiento entre cada par de tokens de la ventana. Es la única información de posición del modelo.' },
        { expand: 'swin-wmsa', nodes: ['softmax', 'weighted-sum', 'merge', 'proj'], edges: ['bias>softmax', 'softmax>weighted-sum', 'split>weighted-sum', 'weighted-sum>merge', 'merge>proj'], tensors: ['s1-b1-attn', 's1-b1-z-heads', 's1-b1-z', 's1-b1-proj'],
          text: 'Softmax por fila, A·V (<b>' + q('tensor.s1-b1-z-heads.shape') + '</b>), se concatenan las cabezas y W_O mezcla: <b>' + q('tensor.s1-b1-proj.shape') + '</b>. Igual que en ViT, pero con secuencias de ' + q('s1WindowTokens') + ' tokens.' },
        { expand: 'swin-wmsa', nodes: ['reverse', 'out'], edges: ['proj>reverse', 'reverse>out'], tensors: ['s1-b1-unwin'],
          text: 'Se deshace la partición: las ventanas vuelven a su lugar en el mapa, <b>' + q('tensor.s1-b1-unwin.shape') + '</b>.' },
        { expand: 'swin-block-pair', nodes: ['w-res1', 'w-ln2', 'w-mlp', 'w-res2'], edges: ['w-msa>w-res1', 'in>w-res1', 'w-res1>w-ln2', 'w-ln2>w-mlp', 'w-mlp>w-res2', 'w-res1>w-res2'], tensors: ['s1-b1-r1', 's1-b1-f', 's1-b1-out'],
          text: 'Residual, LayerNorm 2 y el MLP por token (C → 4C → C, ' + q('node.w-mlp.params') + ' parámetros) con su residual: sale <b>' + q('tensor.s1-b1-out.shape') + '</b>.' },
        { expand: 'swin-swmsa', nodes: ['shift', 'partition'], edges: ['in>shift', 'shift>partition', 'partition>qkv'], tensors: ['s1-b2-shift', 's1-b2-win'],
          text: 'Bloque 2 (SW-MSA): antes de partir, el mapa se <b>desplaza cíclicamente</b> ' + q('s1Shift') + ' = ⌊M/2⌋ tokens (torch.roll). Así cada ventana nueva cruza los bordes de cuatro ventanas viejas, y sigue habiendo ' + q('s1Windows') + ' ventanas: <b>' + q('tensor.s1-b2-win.shape') + '</b>.' },
        { expand: 'swin-swmsa', nodes: ['bias', 'mask', 'softmax'], edges: ['bias>mask', 'mask>softmax'], tensors: ['s1-b2-masked'],
          text: 'El roll junta en algunas ventanas tokens de lados opuestos de la imagen. La <b>máscara</b> suma −100 a los pares de regiones distintas antes de la softmax (peso ≈ 0): <b>' + q('tensor.s1-b2-masked.shape') + '</b>. Sin parámetros.' },
        { expand: 'swin-swmsa', nodes: ['reverse', 'unshift'], edges: ['proj>reverse', 'reverse>unshift', 'unshift>out'], tensors: ['s1-b2-unwin', 's1-b2-unshift'],
          text: 'Se revierte la partición y luego el desplazamiento (roll +' + q('s1Shift') + '): <b>' + q('tensor.s1-b2-unshift.shape') + '</b>, cada token en su posición original.' },
        { expand: 'swin-block-pair', nodes: ['sw-res1', 'sw-ln2', 'sw-mlp', 'sw-res2', 'out'], edges: ['sw-msa>sw-res1', 'w-res2>sw-res1', 'sw-res1>sw-ln2', 'sw-ln2>sw-mlp', 'sw-mlp>sw-res2', 'sw-res2>out'], tensors: ['s1-b2-r1', 's1-out'],
          text: 'Residual, MLP y residual cierran el par: <b>' + q('tensor.s1-out.shape') + '</b>. Stage 1 = ' + q('s1Pairs') + ' par, ' + q('s1Params') + ' parámetros.' },
        { expand: 'swin-patch-merging', nodes: ['concat', 'ln', 'reduce'], edges: ['in>concat', 'concat>ln', 'ln>reduce', 'reduce>out'], tensors: ['s1-out', 'm1-concat', 'm1-out'],
          text: 'Patch merging: cada 2×2 tokens vecinos se concatenan (<b>' + q('tensor.m1-concat.shape') + '</b>), LayerNorm(4C) y una Linear 4C → 2C sin sesgo (' + q('op.m1-reduce.paramArith') + '): <b>' + q('tensor.m1-out.shape') + '</b>. Tokens ÷4, canales ×2.' },
        { nodes: ['stage2', 'merge2', 'stage3', 'merge3'], edges: ['merge1>stage2', 'stage2>merge2', 'merge2>stage3', 'stage3>merge3'], tensors: ['s2-out', 's3-out'],
          text: 'Stages 2 y 3, iguales con el doble de canales cada vez: <b>' + q('tensor.s2-out.shape') + '</b> (' + q('s2Windows') + ' ventanas) → <b>' + q('tensor.s3-out.shape') + '</b> (' + q('s3Windows') + ' ventanas, ' + q('s3Pairs') + ' pares: el stage más profundo). Strides ' + q('s2Stride') + ' y ' + q('s3Stride') + ', como C3 y C4 de ResNet.' },
        { nodes: ['stage4'], edges: ['merge3>stage4', 'stage4>final-ln'], tensors: ['m3-out', 's4-out'],
          text: 'Stage 4: <b>' + q('tensor.s4-out.shape') + '</b> a stride ' + q('s4Stride') + '. El mapa de ' + q('s4Res') + '×' + q('s4Res') + ' es <b>una sola ventana</b>: el segundo bloque no desplaza (shift ' + q('s4Shift') + ').' },
        { nodes: ['final-ln', 'pool', 'head', 'output'], edges: ['stage4>final-ln', 'final-ln>pool', 'pool>head', 'head>output'], tensors: ['x-ln', 'pooled', 'logits'],
          text: 'LayerNorm final, promedio global (<b>' + q('tensor.pooled.shape') + '</b>) y el clasificador: <b>' + q('tensor.logits.shape') + '</b> logits. Total: ' + q('params.total') + ' parámetros, ' + q('macs.totalG') + ' MACs.' },
      ] },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) par de bloques del stage 1
  // Dos columnas lado a lado (como la Fig. 3b del paper): bloque 1 (W-MSA) y bloque 2 (SW-MSA).
  // La salida del bloque 1 sube por el pasillo central hasta la entrada del bloque 2; la residual del
  // bloque 2 va por su propio carril (línea discontinua) y entra por la derecha.
  const col = (pfx, cx, sw) => colNodes(pfx, cx, sw).map((n) => (pfx === 'sw' ? Object.assign({ badgePos: 'right' }, n) : n));
  const colNodes = (pfx, cx, sw) => [
    { id: pfx + '-ln1', op: 'norm', label: 'LayerNorm 1', x: cx - 11, y: 14, w: 22, h: 4, ops: [sw + 'ln1'], opsExact: true,
      tex: '\\mathrm{LN}(z)', note: 'Normaliza cada token sobre sus C canales; γ y β aprendidos (2·C parámetros).' },
    { id: pfx + '-msa', op: 'attn', label: pfx === 'w' ? 'W-MSA' : 'SW-MSA', sub: pfx === 'w' ? 'ventanas M×M' : 'ventanas desplazadas', heads: 'heads.0', headsSym: 'h',
      x: cx - 13, y: 24, w: 26, h: 6, expand: pfx === 'w' ? 'swin-wmsa' : 'swin-swmsa',
      tex: pfx === 'w' ? '\\mathrm{rev}(\\mathrm{MSA}_{B}(\\mathrm{part}(z)))' : '\\begin{aligned} &\\mathrm{roll}^{-1}\\big(\\mathrm{rev}(\\mathrm{MSA}_{B,\\,mask}(\\cdot))\\big) \\\\ &\\cdot = \\mathrm{part}(\\mathrm{roll}(z)) \\end{aligned}',
      note: pfx === 'w'
        ? 'Multi-head self-attention dentro de ventanas de M×M tokens que no se solapan, con sesgo de posición relativa. Ábrela para ver cada paso.'
        : 'Lo mismo, pero sobre el mapa desplazado ⌊M/2⌋ tokens (roll cíclico) y con una máscara entre regiones; al final se deshace el desplazamiento. Así las ventanas de este bloque cruzan los bordes de las del bloque anterior.' },
    { id: pfx + '-res1', op: 'tensorop', shape: 'add', label: 'Residual 1', labelPos: pfx === 'w' ? 'right' : 'left', x: cx - 2, y: 35, w: 4, h: 4, ops: [sw + 'res1'], opsExact: true,
      tex: "\\hat z = \\text{" + (pfx === 'w' ? 'W' : 'SW') + "-MSA}(\\mathrm{LN}(z)) + z", note: 'Suma la entrada del bloque a la salida de la atención.' },
    { id: pfx + '-ln2', op: 'norm', label: 'LayerNorm 2', x: cx - 11, y: 45, w: 22, h: 4, ops: [sw + 'ln2'], opsExact: true, tex: '\\mathrm{LN}(\\hat z)', note: 'Segunda LayerNorm, antes del MLP.' },
    { id: pfx + '-mlp', op: 'mlp', label: 'MLP', sub: 'C → 4C → C · GELU', x: cx - 11, y: 54, w: 22, h: 6,
      tex: '\\mathrm{MLP}(x) = W_2\\,\\mathrm{GELU}(W_1 x + b_1) + b_2', note: 'Dos lineales por token con GELU en medio; la capa oculta es 4× más ancha (MLP ratio 4), como en ViT.' },
    { id: pfx + '-res2', op: 'tensorop', shape: 'add', label: 'Residual 2', labelPos: pfx === 'w' ? 'none' : 'left', x: cx - 2, y: 65, w: 4, h: 4, ops: [sw + 'res2'], opsExact: true,
      tex: 'z\' = \\mathrm{MLP}(\\mathrm{LN}(\\hat z)) + \\hat z', note: 'Segunda residual: cierra el bloque.' },
  ];
  ATLAS.registerDiagram(Object.assign({
    id: 'swin-block-pair', model: 'swin', config: C, kind: 'arch',
    title: 'Par de bloques Swin (stage 1)', parent: 'swin-overview', parentNode: 'stage1',
    caption: 'Dos bloques pre-LN seguidos: el primero con ventanas regulares (W-MSA), el segundo con ventanas desplazadas (SW-MSA). La salida del bloque 1 sube por el centro hasta el bloque 2. Las líneas discontinuas son las residuales. Entra y sale la misma forma: por eso los bloques van de a pares.',
    grid: { w: 91, h: 88 }, direction: 'tb', maxCrossings: 0,
    groups: [
      { id: 'pair', x: 3, y: 7, w: 84, h: 69, modality: 'img',
        repeat: { from: 'depths', index: 0, div: 2, tag: '× {v} par{pl} (stage 1)', crumb: false } },
    ],
    nodes: [
      { id: 'in', op: 'io', label: 'Entrada al stage 1', x: 14, y: 1, w: 16, h: 4, note: 'Los tokens del patch embedding (o, en los stages 2–4, la salida del patch merging).' },
    ].concat(col('w', 22, 's1-b1-'), col('sw', 64, 's1-b2-'), [
      { id: 'out', op: 'io', label: 'Salida del par', x: 56, y: 82, w: 16, h: 4, note: 'Misma forma que la entrada. Va al par siguiente o, tras el último, al patch merging.' },
    ]),
    // ops de los nodos MLP de cada bloque: las del bloque correcto (los ids fc1/gelu/fc2 se comparten)
    notes: [
      { x: 10, y: 74, text: 'Bloque 1 · W-MSA', cls: 'title' },
      { x: 67, y: 74, text: 'Bloque 2 · SW-MSA', cls: 'title' },
    ],
    edges: [
      { from: 'in', to: 'w-ln1', kind: 'data', tensor: 'x-embed', labelT: 0.62 },
      { from: 'in', to: 'w-res1', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[22, 8.5], [8, 8.5], [8, 37]], dot: true },
      { from: 'w-ln1', to: 'w-msa', kind: 'data', tensor: 's1-b1-ln1' },
      { from: 'w-msa', to: 'w-res1', kind: 'data', tensor: 's1-b1-unwin' },
      { from: 'w-res1', to: 'w-ln2', kind: 'data', tensor: 's1-b1-r1' },
      { from: 'w-res1', to: 'w-res2', kind: 'residual', fromSide: 'bottom', toSide: 'left', via: [[22, 42], [8, 42], [8, 67]], dot: true },
      { from: 'w-ln2', to: 'w-mlp', kind: 'data', tensor: 's1-b1-ln2' },
      { from: 'w-mlp', to: 'w-res2', kind: 'data', tensor: 's1-b1-f' },
      // la salida del bloque 1 sube por el pasillo central (x = 45) hasta el bloque 2
      { from: 'w-res2', to: 'sw-ln1', kind: 'data', tensor: 's1-b1-out', fromSide: 'bottom', toSide: 'top', via: [[22, 72], [45, 72], [45, 11.5], [64, 11.5]], labelSide: 'below', labelSeg: 1 },
      { from: 'w-res2', to: 'sw-res1', kind: 'residual', fromSide: 'right', toSide: 'right', via: [[41, 67], [41, 10], [84, 10], [84, 37]], dot: true },
      // columna derecha: las residuales van por la derecha, así que las formas van a la izquierda
      { from: 'sw-ln1', to: 'sw-msa', kind: 'data', tensor: 's1-b2-ln1', labelSide: 'left' },
      { from: 'sw-msa', to: 'sw-res1', kind: 'data', tensor: 's1-b2-unshift', labelSide: 'left' },
      { from: 'sw-res1', to: 'sw-ln2', kind: 'data', tensor: 's1-b2-r1', labelSide: 'left' },
      { from: 'sw-res1', to: 'sw-res2', kind: 'residual', fromSide: 'bottom', toSide: 'right', via: [[64, 42], [80, 42], [80, 67]], dot: true },
      { from: 'sw-ln2', to: 'sw-mlp', kind: 'data', tensor: 's1-b2-ln2', labelSide: 'left' },
      { from: 'sw-mlp', to: 'sw-res2', kind: 'data', tensor: 's1-b2-f', labelSide: 'left' },
      { from: 'sw-res2', to: 'out', kind: 'data', tensor: 's1-out', labelT: 0.82 },
    ],
    legend: 'auto',
  }, PAGE));

  // ------------------------------------------------------------------ (b) W-MSA / SW-MSA por dentro
  // Tres columnas que se leen de arriba abajo y de izquierda a derecha:
  //   1 · preparar (in, [shift], partition, qkv, split) · 2 · las nW × h cabezas (scores … A·V) ·
  //   3 · volver (merge, proj, reverse, [unshift], out).
  // Q y K suben por el pasillo 1 hasta QKᵀ; V baja y entra en A·V; la salida de A·V sube por el pasillo 2.
  function msaSpec(shifted) {
    const b = shifted ? 's1-b2-' : 's1-b1-';
    const ops = (id) => ({ ops: [b + id], opsExact: true });
    const stack = (items, y0, gap) => { let y = y0; return items.map((it) => { const o = Object.assign({}, it, { y }); y += it.h + gap; return o; }); };
    const c1 = stack([
      { id: 'in', op: 'io', label: 'Entrada (tras LN 1)', x: 7, w: 18, h: 4, note: 'El mapa normalizado por la LayerNorm 1 del bloque.' },
    ].concat(shifted ? [
      Object.assign({ id: 'shift', op: 'tensorop', shape: 'pill', symbol: 'roll', label: 'Roll −⌊M/2⌋', x: 4, w: 24, h: 4,
        tex: '\\mathrm{roll}(z,\\ (-\\lfloor M/2\\rfloor, -\\lfloor M/2\\rfloor))', note: 'Desplazamiento cíclico del mapa ⌊M/2⌋ = ' + q('s1Shift') + ' tokens hacia arriba y a la izquierda (torch.roll): lo que sale por un borde entra por el otro. Así la partición regular siguiente equivale a ventanas corridas, sin rellenar y con el mismo número de ventanas.' }, ops('shift')),
    ] : []).concat([
      Object.assign({ id: 'partition', op: 'tensorop', shape: 'pill', symbol: 'window', label: 'Partir en ventanas', x: 4, w: 24, h: 4,
        tex: '\\tfrac{H}{4}\\times\\tfrac{W}{4}\\times C \\to n_W\\times M^2\\times C', note: 'Corta el mapa en nW = ' + q('s1Windows') + ' ventanas de M×M = ' + q('s1Window') + '×' + q('s1Window') + ' tokens que no se solapan y las apila como un lote. Es un reshape/permute: sin parámetros.' }, ops('partition')),
      Object.assign({ id: 'qkv', op: 'embed', label: 'Proyección Q, K, V', sub: 'Linear C → 3C', x: 4, w: 24, h: 5,
        tex: '[Q\\;K\\;V] = z_{win} W_{QKV} + b', note: 'Los mismos pesos para todas las ventanas (y todas las posiciones): C·3C + 3C parámetros.' }, ops('qkv')),
      Object.assign({ id: 'split', op: 'tensorop', shape: 'pill', symbol: 'split', label: 'Dividir: Q, K, V · h', x: 4, w: 24, h: 4,
        tex: 'n_W\\times M^2\\times 3C \\to 3\\times n_W\\times h\\times M^2\\times d_h', note: 'Separa Q, K y V y corta C en h cabezas de d_h = C/h = ' + q('dh') + '. Reshape, sin parámetros.' }, ops('split')),
    ]), 1, 5);
    const c2 = stack([
      Object.assign({ id: 'scores', op: 'attn', label: 'Q · Kᵀ', sub: 'dentro de cada ventana', x: 50, w: 30, h: 5,
        tex: 'S = QK^\\top \\in \\mathbb{R}^{n_W\\times h\\times M^2\\times M^2}', note: 'Cada query solo se compara con las M² keys de su ventana: M²·d_h MACs por query, en vez de N·d_h con atención global. Por eso el costo crece lineal con N.' }, ops('scores')),
      Object.assign({ id: 'scale', op: 'attn', shape: 'pill', label: '÷ √d_h', x: 56, w: 18, h: 4, tex: 'S/\\sqrt{d_h}', note: 'La misma escala que en ViT.' }, ops('scale')),
      Object.assign({ id: 'bias', op: 'attn', label: '+ sesgo relativo B', sub: 'tabla (2M−1)²×h', x: 50, w: 30, h: 5,
        tex: 'S/\\sqrt{d_h} + B,\\quad B_{ij} = \\hat B[\\,\\Delta r_{ij},\\ \\Delta c_{ij}\\,]', note: 'Un escalar aprendido por cabeza y por desplazamiento relativo (Δfila, Δcolumna) dentro de la ventana: (2M−1)² = ' + q('biasTableS1') + ' valores por cabeza. Se expande a M²×M² con un índice fijo (buffer). Reemplaza a la position embedding absoluta de ViT.' }, ops('bias')),
    ].concat(shifted ? [
      Object.assign({ id: 'mask', op: 'attn', shape: 'pill', symbol: 'mask', label: '+ máscara (−100)', x: 53, w: 24, h: 4,
        tex: 'S + M_{shift},\\quad (M_{shift})_{ij} \\in \\{0, -100\\}', note: 'Tras el roll, una ventana del borde junta tokens de hasta 4 regiones que no son vecinas en la imagen. La máscara suma −100 a los pares de regiones distintas (peso ≈ 0 tras la softmax). Se calcula una vez por resolución; sin parámetros.' }, ops('mask')),
    ] : []).concat([
      Object.assign({ id: 'softmax', op: 'attn', label: 'softmax', sub: 'por fila', x: 55, w: 20, h: 5, tex: 'A = \\mathrm{softmax}(\\cdot)', note: 'Cada fila (una query) se vuelve una distribución sobre las M² keys de su ventana.' }, ops('softmax')),
      Object.assign({ id: 'weighted-sum', op: 'attn', label: 'A · V', sub: 'promedio ponderado', x: 50, w: 30, h: 5,
        tex: '\\mathrm{head}_i = A_i V_i', note: 'Mezcla los values de la ventana con los pesos de atención. Mismo costo que QKᵀ.' }, ops('weighted-sum')),
    ]), 5, shifted ? 4 : 4.5);
    const wsY = c2[c2.length - 1].y;
    const c3 = stack([
      Object.assign({ id: 'merge', op: 'tensorop', shape: 'concat', label: 'Concatenar', labelPos: 'right', x: 104, w: 4, h: 4,
        tex: 'n_W\\times h\\times M^2\\times d_h \\to n_W\\times M^2\\times C', note: 'Pone las h cabezas una al lado de otra (h·d_h = C).' }, ops('merge')),
      Object.assign({ id: 'proj', op: 'embed', label: 'Proyección W_O', sub: 'Linear C → C', x: 93, w: 26, h: 5, tex: 'O = Z W_O + b', note: 'Mezcla las cabezas; C·C + C parámetros, compartidos por todas las ventanas.' }, ops('proj')),
      Object.assign({ id: 'reverse', op: 'tensorop', shape: 'pill', symbol: 'window', label: 'Revertir ventanas', x: 93, w: 26, h: 4,
        tex: 'n_W\\times M^2\\times C \\to \\tfrac{H}{4}\\times\\tfrac{W}{4}\\times C', note: 'Devuelve cada ventana a su lugar en el mapa. Reshape, sin parámetros.' }, ops('reverse')),
    ].concat(shifted ? [
      Object.assign({ id: 'unshift', op: 'tensorop', shape: 'pill', symbol: 'roll', label: 'Roll +⌊M/2⌋', x: 93, w: 26, h: 4,
        tex: '\\mathrm{roll}(z,\\ (\\lfloor M/2\\rfloor, \\lfloor M/2\\rfloor))', note: 'Deshace el desplazamiento: cada token vuelve a su posición original antes de la residual.' }, ops('unshift')),
    ] : []).concat([
      { id: 'out', op: 'io', label: 'Hacia la residual 1', x: 96, w: 20, h: 4, note: 'Vuelve al bloque, donde se suma con su entrada.' },
    ]), 5, 4.5);
    const nodes = c1.concat(c2, c3);
    const by = (id) => nodes.find((n) => n.id === id);
    const split = by('split'), scores = by('scores'), ws = by('weighted-sum');
    const sy = (n, t) => n.y + n.h * t;
    const lastC1 = shifted ? ['in', 'shift', 'partition', 'qkv', 'split'] : ['in', 'partition', 'qkv', 'split'];
    const edges = [];
    for (let i = 1; i < lastC1.length; i++) {
      const tid = { shift: b + 'ln1', partition: shifted ? b + 'shift' : b + 'ln1', qkv: b + 'win', split: b + 'qkv' }[lastC1[i]];
      edges.push({ from: lastC1[i - 1], to: lastC1[i], kind: 'data', tensor: tid });
    }
    edges.push(
      // Q y K: salen por la derecha de "Dividir", suben por el pasillo 1 y entran por la izquierda de QKᵀ
      { from: 'split', to: 'scores', kind: 'data', tensor: b + 'q', fromSide: 'right', fromAt: 0.3, toSide: 'left', toAt: 0.3, midX: 32,
        labelSeg: -1, labelSide: 'above', tag: 'Q', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 },
      { from: 'split', to: 'scores', kind: 'data', tensor: b + 'k', fromSide: 'right', fromAt: 0.7, toSide: 'left', toAt: 0.7, midX: 35,
        labelSeg: -1, labelSide: 'below', tag: 'K', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.5 },
      // V baja y entra por la izquierda de A·V
      { from: 'split', to: 'weighted-sum', kind: 'data', tensor: b + 'v', fromSide: 'bottom', toSide: 'left', via: [[16, sy(ws, 0.5)]],
        tag: 'V', tagStyle: 'plain', tagSide: 'on', tagSeg: 0, tagT: 0.45 },
    );
    const c2ids = c2.map((n) => n.id);
    const t2 = { scale: b + 'scores', bias: b + 'scaled', mask: b + 'biased', softmax: shifted ? b + 'masked' : b + 'biased', 'weighted-sum': b + 'attn' };
    for (let i = 1; i < c2ids.length; i++) edges.push({ from: c2ids[i - 1], to: c2ids[i], kind: 'data', tensor: t2[c2ids[i]] });
    // salida de A·V: sube por el pasillo 2 hasta "Concatenar"
    edges.push({ from: 'weighted-sum', to: 'merge', kind: 'data', tensor: b + 'z-heads', fromSide: 'right', toSide: 'left', via: [[89, sy(ws, 0.5)], [89, 7]], labelSeg: -1, labelSide: 'above' });
    const c3ids = c3.map((n) => n.id);
    const t3 = { proj: b + 'z', reverse: b + 'proj', unshift: b + 'unwin', out: shifted ? b + 'unshift' : b + 'unwin' };
    for (let i = 1; i < c3ids.length; i++) edges.push({ from: c3ids[i - 1], to: c3ids[i], kind: 'data', tensor: t3[c3ids[i]] });
    const h = Math.max(wsY + 5, c3[c3.length - 1].y + 4) + 6;
    return Object.assign({
      id: shifted ? 'swin-swmsa' : 'swin-wmsa', model: 'swin', config: C, kind: 'arch',
      title: shifted ? 'SW-MSA: ventanas desplazadas (stage 1, bloque 2)' : 'W-MSA: atención en ventanas (stage 1, bloque 1)',
      parent: 'swin-block-pair', parentNode: shifted ? 'sw-msa' : 'w-msa',
      caption: shifted
        ? 'Igual que W-MSA con tres pasos más: roll del mapa antes de partir, máscara entre regiones antes de la softmax y roll inverso al final. Se lee por columnas: preparar → las nW × h cabezas → volver al mapa.'
        : 'Se lee por columnas: partir el mapa en nW ventanas de M×M y proyectar Q, K, V → en cada ventana y cabeza, QKᵀ/√d_h + sesgo relativo, softmax y A·V → concatenar, W_O y devolver las ventanas a su lugar.',
      grid: { w: 125, h }, direction: 'tb', maxCrossings: 0,
      groups: [
        { id: 'heads', label: q('s1Windows') + ' ventanas × h cabezas', labelPos: 'bottom-right', heads: 'heads.0', headsSym: 'h', x: 46, y: 2, w: 38, h: wsY + 5 + 4 - 2 + 1 },
      ],
      nodes,
      tensors: [
        { id: b + 'win', at: { edge: 'partition>qkv' }, show: 'both' },
      ],
      edges,
      legend: 'auto',
    }, PAGE);
  }
  ATLAS.registerDiagram(msaSpec(false));
  ATLAS.registerDiagram(msaSpec(true));

  // ------------------------------------------------------------------ (b) patch merging (merge1)
  ATLAS.registerDiagram(Object.assign({
    id: 'swin-patch-merging', model: 'swin', config: C, kind: 'arch',
    title: 'Patch merging (entre stage 1 y 2)', parent: 'swin-overview', parentNode: 'merge1',
    caption: 'De izquierda a derecha, a escala: cada 2×2 tokens vecinos se concatenan (la cara se achica a la mitad, la profundidad ×4), LayerNorm y una Linear 4C → 2C sin sesgo (la profundidad queda ×2). Es el "downsampling" de Swin, como una conv de stride 2.',
    grid: { w: 124, h: 25 }, direction: 'lr', maxCrossings: 0,
    nodes: [
      { id: 'in', op: 'io', label: 'Salida\nstage 1', x: 1, y: 16, w: 11, h: 6, note: 'El mapa de salida del stage 1.' },
      Object.assign({ id: 'concat', op: 'tensorop', shape: 'pill', symbol: 'merge', label: 'Concatenar 2×2', x: 27, y: 17, w: 19, h: 4,
        tex: 'z\' = [\\,z_{0::2,\\,0::2};\\ z_{1::2,\\,0::2};\\ z_{0::2,\\,1::2};\\ z_{1::2,\\,1::2}\\,]', note: 'Toma los tokens de cada bloque 2×2 y los concatena en canales: la resolución baja a la mitad por lado y los canales se multiplican por 4. Sin parámetros.' }, { ops: ['m1-concat'], opsExact: true }),
      Object.assign({ id: 'ln', op: 'norm', label: 'LayerNorm(4C)', x: 61, y: 17, w: 15, h: 4, tex: '\\mathrm{LN}_{4C}(z\')', note: 'LayerNorm sobre los 4C canales concatenados: 2·4C parámetros.' }, { ops: ['m1-ln'], opsExact: true }),
      Object.assign({ id: 'reduce', op: 'embed', label: 'Linear 4C → 2C', sub: 'sin sesgo', x: 87, y: 16.5, w: 16, h: 5, tex: 'z\'\' = \\mathrm{LN}(z\')\\,W,\\; W\\in\\mathbb{R}^{4C\\times 2C}', note: 'Reduce los canales a la mitad: 4C·2C parámetros (sin sesgo, como timm).' }, { ops: ['m1-reduce'], opsExact: true }),
      { id: 'out', op: 'io', label: 'Entrada\nstage 2', x: 112, y: 16, w: 11, h: 6, note: 'El mapa de entrada del stage 2: la mitad de resolución, el doble de canales.' },
    ],
    tensors: [
      { id: 's1-out', at: { edge: 'in>concat' }, show: 'both', glyph: 'fmap', px: 1.5 },
      { id: 'm1-concat', at: { edge: 'concat>ln' }, show: 'both', glyph: 'fmap', px: 1.5 },
      { id: 'm1-ln', at: { edge: 'ln>reduce' }, show: 'both', glyph: 'fmap', px: 1.5 },
      { id: 'm1-out', at: { edge: 'reduce>out' }, show: 'both', glyph: 'fmap', px: 1.5 },
    ],
    edges: [
      { from: 'in', to: 'concat', kind: 'data', tensor: 's1-out' },
      { from: 'concat', to: 'ln', kind: 'data', tensor: 'm1-concat' },
      { from: 'ln', to: 'reduce', kind: 'data', tensor: 'm1-ln' },
      { from: 'reduce', to: 'out', kind: 'data', tensor: 'm1-out' },
    ],
    legend: 'auto',
  }, PAGE));
})(typeof window !== 'undefined' ? window : globalThis);
