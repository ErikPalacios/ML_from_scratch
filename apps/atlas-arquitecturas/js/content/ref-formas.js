/* =============================================================================
   Atlas de Arquitecturas — js/content/ref-formas.js
   Hoja de referencia `ref-formas` (SPEC §5.6): convenciones, tabla de primitivas (generada por
   ATLAS.Arch.primitives), comparación de las configs de ViT (generada), MACs vs FLOPs y reglas de
   dedo. Cada regla de dedo está verificada por una aserción del calculador en tests/arch.test.cjs:
   parámetros por capa = 12D² + 13D, MACs por token ≈ pesos de las lineales (FLOPs ≈ 2·params por
   token) y el cruce del término de atención en N = 6D. Sin DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const R = String.raw;
  const v = (path) => '{{vit-b16-224.' + path + '}}';
  const t = (path) => '{{toy-n5-d8.' + path + '}}';
  const VIT_CONFIGS = ['vit-s16-224', 'vit-b16-224', 'vit-l16-224', 'vit-h14-224', 'vit-b32-224', 'vit-b16-384'];

  ATLAS.register({
    id: 'ref-formas',
    kind: 'special',
    sections: [
      // ======================================================== 1
      {
        id: 'convenciones', title: 'Convenciones', titleEn: 'Conventions', priority: 'core',
        blocks: [
          { t: 'list', items: [
            `<b>Formas sin batch</b>, en orden "tokens × canales": ${v('tensor.x0.sym')} = ${v('tensor.x0.shape')}. Las imágenes se escriben H×W×C (PyTorch usa C×H×W). B aparece solo en memoria y throughput.`,
            `<b>Símbolos</b>: N tokens, D ancho, h cabezas, d<sub>h</sub> = D/h, L capas, D<sub>mlp</sub> ancho del MLP, P patch, H×W×C imagen, K clases. La tabla atlas ↔ Laboratorio está en el <a href="#repaso-atencion.notacion">repaso de atención</a>.`,
            `<b>Parámetros</b>: enteros exactos, con los bias que tiene la implementación de referencia. Los buffers fijos (codificación sinusoidal, índices de posición relativa) no cuentan; las tablas aprendidas sí.`,
            `<b>MACs</b>: multiply-accumulates de matmuls y convoluciones. Un producto de m×k por k×n son m·n·k MACs. <b>FLOPs = 2 × MACs.</b> Softmax, normalizaciones, activaciones y sumas van aparte como "otros (≈)" y no entran en el número principal.`,
            `<b>Procedencia</b>: todo número de esta hoja lo calcula el calculador. Los números de papers aparecen solo citados con su tabla; las estimaciones van marcadas como tales.`,
          ] },
        ],
      },
      // ======================================================== 2
      {
        id: 'primitivas', title: 'Primitivas: parámetros, MACs y forma de salida', titleEn: 'Primitives', priority: 'core',
        blocks: [
          { t: 'p', html: `Cada bloque de cada diagrama se arma con estas piezas. La tabla sale directamente del calculador, que tiene una prueba unitaria por primitiva con un caso chico calculado a mano.` },
          { t: 'formulas' },
          { t: 'callout', kind: 'trap', html: R`<p>El patch embedding de ViT es una <code>conv2d</code> con kernel = stride = P, y es exactamente un <code>linear</code> de \(P^2C\) a D aplicado a cada patch aplanado: mismos parámetros (${v('patchEmbedParams')} en ViT-B/16) y mismos MACs. Si en la entrevista dices "es una convolución", agrega "sin solapamiento, o sea una proyección lineal por patch".</p>` },
        ],
      },
      // ======================================================== 3
      {
        id: 'modelos', title: 'Los modelos listos, lado a lado', titleEn: 'Model comparison', priority: 'core',
        blocks: [
          { t: 'p', html: `Las seis configuraciones de ViT del calculador. Mira cómo se mueven los MACs cuando cambia el número de tokens (P o la resolución) frente a cuando cambia el ancho D.` },
          { t: 'compare', models: VIT_CONFIGS, rows: ['res', 'P', 'tokens', 'D', 'L', 'h', 'Dmlp', 'params', 'macs', 'flops'], caption: 'ViT: configuraciones del calculador (cabeza de 1000 clases)' },
          { t: 'callout', kind: 'note', html: `<p>Las demás familias se agregan a esta tabla en su fase, cuando su calculador y su cross-check en PyTorch estén listos.</p>` },
        ],
      },
      // ======================================================== 4
      {
        id: 'macs-flops', title: 'MACs vs FLOPs', titleEn: 'MACs vs FLOPs', priority: 'core',
        blocks: [
          { t: 'p', html: `Una multiplicación seguida de una suma es un MAC y son dos FLOPs. ViT-B/16 @ 224 hace ${v('macs.total')} MACs de matmuls y convoluciones (${v('macs.totalG')}), es decir ${v('flops.totalG')}FLOPs. Las operaciones elementales (softmax, LayerNorm, GELU, sumas residuales) suman ≈ ${v('other.totalG')} operaciones más y se reportan aparte.` },
          { t: 'math', display: true, tex: R`A\in\mathbb{R}^{m\times k},\;B\in\mathbb{R}^{k\times n}:\quad \text{MACs}(AB)=m\,n\,k,\qquad \text{FLOPs}=2\,m\,n\,k` },
          { t: 'callout', kind: 'trap', html: `<p>Muchas tablas de papers y herramientas reportan <b>MACs con el nombre "FLOPs"</b>. fvcore, por ejemplo, cuenta un multiply-add fusionado como un solo "flop"; <code>torch.utils.flop_counter.FlopCounterMode</code> cuenta dos. Por eso el número de "GFLOPs" que suelen dar las tablas de DeiT y Swin para ViT-B/16 @ 224 coincide con los ${v('macs.totalG')}MACs del calculador, no con sus ${v('flops.totalG')}FLOPs. Antes de comparar dos números, pregunta en qué convención está cada uno.</p>` },
          { t: 'callout', kind: 'interview', html: `<p>"ViT-B/16 a 224 son unos ${v('macs.totalG')}MACs por imagen, o el doble en FLOPs; el número que ves en las tablas casi siempre son MACs". Decirlo así evita la discusión de un factor 2 y es una señal de que mediste en serio.</p>` },
        ],
      },
      // ======================================================== 5
      {
        id: 'reglas', title: 'Reglas de dedo (verificadas por el calculador)', titleEn: 'Rules of thumb', priority: 'core',
        blocks: [
          { t: 'p', html: `Tres reglas que sirven para estimar en voz alta cualquier transformer con D<sub>mlp</sub> = 4D. Las tres están comprobadas por aserciones del calculador: si un modelo nuevo no las cumple, la prueba avisa.` },
          { t: 'h3', text: '1 · Parámetros por capa ≈ 12·D²' },
          { t: 'math', display: true, tex: R`\underbrace{4D^2+4D}_{W_{QKV},\,W_O}\;+\;\underbrace{8D^2+5D}_{W_1,\,W_2}\;+\;\underbrace{4D}_{2\times\mathrm{LN}}\;=\;12D^2+13D` },
          { t: 'p', html: `Con los bias de la implementación de referencia y dos LayerNorm. ViT-B/16: 12·${v('D')}² + 13·${v('D')} = ${v('layerParams')} por capa; las L = ${v('L')} capas suman ${v('encoderParams')} de los ${v('params.total')} del modelo (el resto es patch embedding, posiciones, CLS, LN final y cabeza). En el juguete del repaso: ${t('layerParams')} = 12·8² + 13·8.` },
          { t: 'callout', kind: 'estimate', html: `<p>Para estimar un modelo entero de memoria: 12·L·D². Con ViT-B: 12 · 12 · 768² ≈ 85 M, contra los ${v('params.totalM')} exactos. El error lo ponen los embeddings y la cabeza, que en LLMs (vocabularios grandes) dejan de ser despreciables.</p>` },
          { t: 'h3', text: '2 · MACs por token ≈ pesos de las capas lineales (FLOPs ≈ 2·params por token)' },
          { t: 'math', display: true, tex: R`\frac{\text{MACs}_{\text{capa}}}{N}=\underbrace{12D^2}_{\text{pesos lineales}}+\underbrace{2ND}_{QK^\top,\;AV}\quad\Rightarrow\quad\text{FLOPs por token}\approx 2\cdot\text{params}\;\;(N\ll 6D)` },
          { t: 'p', html: `Cada peso de una lineal se usa exactamente una vez por token (un MAC). Mientras el término de atención sea chico, los MACs por token de un forward ≈ número de parámetros y los FLOPs ≈ el doble. ViT-B/16: una capa hace ${v('layerMacs')} MACs para ${v('tokens')} tokens; la parte cuadrática es solo ${v('metrics.scoreMacsShare')} del total del modelo.` },
          { t: 'h3', text: '3 · El término de atención cruza en N = 6D' },
          { t: 'math', display: true, tex: R`2N^2D = N\,(4D^2+2D\,D_{\mathrm{mlp}})\;\Rightarrow\;N^*=2D+D_{\mathrm{mlp}}\;\overset{D_{\mathrm{mlp}}=4D}{=}\;6D` },
          { t: 'p', html: `Por debajo de N* dominan las lineales (O(N·D²)); por encima, los scores y A·V (O(N²·D)). ViT-B/16: N* = ${v('crossoverN')} contra ${v('tokens')} tokens, así que a 224 casi todo el costo son lineales. El juguete: N* = ${t('crossoverN')}. El explorador de escalado del <a href="#repaso-atencion.costo">repaso</a> te deja cruzar la línea.` },
          { t: 'callout', kind: 'trap', html: `<p>Las tres reglas hablan de <b>MACs y parámetros</b>, no de memoria ni de latencia. La matriz de scores (h·N² por capa) puede dominar la memoria mucho antes de N = 6D, y en inferencia de LLMs el cuello de botella suele ser leer pesos y KV cache, no los MACs.</p>` },
        ],
      },
    ],

    glossary: [
      { en: 'FLOPs', es: 'operaciones de punto flotante', def: 'Floating-point operations. En el atlas, FLOPs = 2 × MACs (una multiplicación + una suma). Ojo: muchas tablas llaman "FLOPs" a lo que en realidad son MACs.', say: 'That table reports MACs under the name FLOPs, so the real FLOP count is twice that.' },
      { en: 'rule of thumb', es: 'regla de dedo', def: 'Aproximación que sirve para estimar en voz alta (p. ej. 12·D² parámetros por capa de transformer). En el atlas, cada una tiene una prueba del calculador que la respalda.', say: 'As a rule of thumb, a transformer layer has about twelve D squared parameters.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
