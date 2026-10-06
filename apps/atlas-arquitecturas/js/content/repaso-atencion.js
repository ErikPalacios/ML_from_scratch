/* =============================================================================
   Atlas de Arquitecturas — js/content/repaso-atencion.js
   Repaso de atención (SPEC §13.2): la notación del atlas, la atención con el ejemplo de juguete
   del Laboratorio (N = 5, D = 8, h = 2), √d_h, multi-head, las tres máscaras, pre-LN vs post-LN,
   el costo O(N²·D) vs O(N·D²) y los tres sabores de transformer. Compacto (≤ 25 min).
   Todos los números salen del calculador: modelo `transformer`, configs `toy-n5-d8` y
   `toy-n5-d8-causal` (js/arch/transformer.js), más `vit-b16-224` como referencia.
   Los enlaces lab:paso-<n> se verificaron contra la traza por defecto del Laboratorio
   (1 capa, 2 cabezas, frase «el gato come pescado .», 91 pasos). Sin DOM.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const R = String.raw;   // LaTeX: las barras invertidas pasan tal cual
  const T = 'toy-n5-d8';
  const q = (path) => '{{' + T + '.' + path + '}}';
  const qc = (path) => '{{toy-n5-d8-causal.' + path + '}}';
  const qv = (path) => '{{vit-b16-224.' + path + '}}';

  ATLAS.register({
    id: 'repaso-atencion',
    kind: 'recap',
    sections: [
      // ======================================================== 1
      {
        id: 'notacion', title: 'La notación del atlas', titleEn: 'Notation', priority: 'core',
        blocks: [
          { t: 'p', html: `Este repaso usa el mismo ejemplo que el <a href="lab:paso">Laboratorio Transformer</a>: una frase de ${q('N')} tokens, cada uno un vector de ${q('D')} números, con ${q('h')} cabezas. La única diferencia es el nombre de las letras: el Laboratorio habla de texto (T tokens de ancho d); el atlas habla de imágenes y texto a la vez, y en visión los tokens son parches (<i>patches</i>), así que se llaman N y el ancho del modelo D, como en los papers de ViT.` },
          { t: 'table', caption: 'Símbolos: atlas ↔ Laboratorio, con los números del juguete y de ViT-B/16',
            head: ['Atlas', 'Laboratorio', 'Qué es', 'Juguete', 'ViT-B/16 @ 224'],
            rows: [
              ['N', 'T', 'longitud de la secuencia (tokens). En la página de ViT, N son los parches y la secuencia tiene N+1 tokens (con el CLS)', q('N'), qv('tokens') + ' (= ' + qv('patches') + ' parches + CLS)'],
              ['D', 'd', 'ancho del modelo (dimensión de cada token)', q('D'), qv('D')],
              ['h', 'h', 'número de cabezas', q('h'), qv('h')],
              ['d<sub>h</sub> = D/h', 'd<sub>k</sub>', 'dimensión de cada cabeza (de q, k y v)', q('dh'), qv('dh')],
              ['D<sub>mlp</sub>', 'd<sub>ff</sub>', 'ancho oculto del MLP (FFN)', q('Dmlp'), qv('Dmlp')],
              ['L', 'capas', 'número de bloques apilados', q('L'), qv('L')],
            ] },
          { t: 'callout', kind: 'trap', html: `<p>Las formas del atlas van <b>sin batch</b> y en orden "tokens × canales": ${q('tensor.x0.sym')} = ${q('tensor.x0.shape')}. En PyTorch el mismo tensor es <code>(B, N, D)</code> y una imagen es <code>(B, C, H, W)</code>; aquí la imagen se escribe H×W×C. Cuando un entrevistador te pide "la forma", di primero los símbolos y luego los números, y aclara si incluyes B.</p><p><b>Ojo con N:</b> aquí N es la longitud de la secuencia (T en el Laboratorio). En la página de <a href="#vit">ViT</a>, N son los parches y la secuencia que entra al encoder tiene N+1 tokens (los parches más el CLS).</p>` },
          { t: 'callout', kind: 'note', title: 'El bloque de juguete no es idéntico al del Laboratorio', html: R`<p>El calculador modela un bloque pre-LN como <code>torch.nn.TransformerEncoderLayer(8, 2, 32, activation='gelu', norm_first=True)</code> (ojo: el default de PyTorch es <code>activation='relu'</code>): <b>con</b> bias en W<sub>Q</sub>, W<sub>K</sub>, W<sub>V</sub>, W<sub>O</sub> y activación GELU, sin embeddings ni cabeza (la entrada es directamente \(x_0\)). El Laboratorio no pone bias en las cuatro proyecciones de la atención y usa ReLU. Por eso aquí el bloque tiene ${q('params.total')} parámetros y en el Laboratorio 4·D menos. Las formas y los MACs son los mismos.</p>` },
        ],
      },
      // ======================================================== 2
      {
        id: 'atencion', title: 'Scaled dot-product attention, con números', titleEn: 'Scaled dot-product attention', priority: 'core',
        blocks: [
          { t: 'p', html: `Sigue los números antes que las letras. Entran ${q('N')} tokens de ${q('D')} dimensiones (${q('tensor.x0.shape')}). Una sola multiplicación por una matriz de D×3D (${q('op.qkv.paramArith')} parámetros) los convierte en queries, keys y values pegados (${q('tensor.qkv.shape')}). Eso se corta en ${q('h')} cabezas de ${q('dh')} columnas (${q('tensor.q.shape')} para Q, igual para K y V). Cada cabeza compara cada query con cada key: una matriz de scores de ${q('tensor.scores.shape')}. El softmax por filas la vuelve pesos que suman 1, y esos pesos promedian los values (${q('tensor.z-heads.shape')}). Se pegan las cabezas (${q('tensor.z.shape')}) y una última proyección W<sub>O</sub> mezcla la información de las dos (${q('tensor.o.shape')}).` },
          { t: 'math', display: true, tex: R`\mathrm{Attention}(Q,K,V)=\mathrm{softmax}\!\left(\frac{QK^\top}{\sqrt{d_h}}\right)V,\qquad Q=XW_Q,\;K=XW_K,\;V=XW_V`, caption: 'Por cabeza: Q, K, V ∈ ℝ^{N×d_h}; scores ∈ ℝ^{N×N}; salida ∈ ℝ^{N×d_h}.' },
          { t: 'archdiagram', diagram: 'repaso-block', caption: 'Un bloque pre-LN del juguete. Abre la MHSA para ver Q, K, V, la división en cabezas, QKᵀ/√d_h, softmax, A·V y W_O; las formas de las aristas salen del calculador.' },
          { t: 'op', block: 'qkv', model: 'transformer', title: 'Proyección Q, K, V', tex: R`[Q\;K\;V] = \mathrm{LN}_1(x)\,W_{QKV} + b_{QKV},\quad W_{QKV}\in\mathbb{R}^{D\times 3D}`,
            in: ['h-ln1'], out: ['qkv'],
            what: `Cada token se proyecta tres veces: qué busca (query), cómo se anuncia (key) y qué entrega si lo eligen (value). Las tres matrices D×D se guardan pegadas en una sola de D×3D.`,
            why: `Separar "con qué me comparo" (K) de "qué aporto" (V) es lo que deja que un token sea relevante sin que su contenido tenga que parecerse a la pregunta. Una sola matmul de D×3D en vez de tres de D×D es la misma cuenta, más eficiente en GPU. El Laboratorio las hace por separado (<a href="lab:paso-5">pasos 5–7</a>).` },
          { t: 'op', block: 'split', model: 'transformer', title: 'División en cabezas', tex: R`Q\in\mathbb{R}^{N\times D}\;\to\;Q\in\mathbb{R}^{h\times N\times d_h},\quad d_h=D/h`,
            in: ['qkv'], out: ['q', 'k', 'v'],
            what: `Un reshape sin parámetros ni MACs: las ${q('D')} columnas de Q se reparten en ${q('h')} grupos de ${q('dh')}. Lo mismo para K y V.`,
            why: `Cada cabeza trabaja en su propio subespacio y hace su propio softmax: puede fijarse en tokens distintos que otra cabeza (<a href="lab:paso-8">paso 8 del Laboratorio</a>).` },
          { t: 'op', block: 'scores', model: 'transformer', title: 'Scores QKᵀ / √d_h', tex: R`S = \frac{QK^\top}{\sqrt{d_h}}\in\mathbb{R}^{h\times N\times N}`,
            in: ['q', 'k'], out: ['scores'],
            what: `Producto punto de cada query con cada key, por cabeza: ${q('tensor.scores.shape')}. Cuesta ${q('op.scores.macArith')} MACs. Luego se divide entre √d<sub>h</sub> (el paso <code>scale</code>, sin MACs).`,
            why: `Es la única operación que mezcla tokens entre sí, y la que crece como N². Por qué se divide entre √d<sub>h</sub> está en la sección siguiente. En el Laboratorio: <a href="lab:paso-9">paso 9</a> (scores) y <a href="lab:paso-10">paso 10</a> (escala).` },
          { t: 'op', block: 'softmax', model: 'transformer', title: 'Softmax por filas', tex: R`A_{ij}=\frac{e^{S_{ij}}}{\sum_{j'} e^{S_{ij'}}}`,
            in: ['scores-scaled'], out: ['attn'],
            what: `Cada fila (una query) se vuelve una distribución sobre las ${q('N')} keys: pesos positivos que suman 1.`,
            why: `Convierte similitudes en un promedio ponderado diferenciable. Si una máscara puso −∞ en una posición, su peso queda exactamente en 0 (<a href="lab:paso-12">paso 12</a>).` },
          { t: 'op', block: 'weighted-sum', model: 'transformer', title: 'Promedio de values A·V', tex: R`Z_{\text{cabeza}} = A\,V\in\mathbb{R}^{h\times N\times d_h}`,
            in: ['attn', 'v'], out: ['z-heads'],
            what: `Cada token recibe el promedio de los values de todos, pesado por su fila de A. Cuesta lo mismo que los scores: ${q('op.weighted-sum.macArith')} MACs.`,
            why: `Aquí la información viaja entre posiciones. Todo lo demás del bloque (LN, proyecciones, MLP) trabaja token por token (<a href="lab:paso-13">paso 13</a>).` },
          { t: 'op', block: 'merge', model: 'transformer', title: 'Concatenar las cabezas', tex: R`\mathbb{R}^{h\times N\times d_h}\to\mathbb{R}^{N\times D}`,
            in: ['z-heads'], out: ['z'],
            what: `El reshape inverso del split: las ${q('h')} salidas de ${q('dh')} columnas vuelven a formar ${q('tensor.z.shape')}.`,
            why: `Deja todo listo para que una sola matriz mezcle lo que encontró cada cabeza (<a href="lab:paso-19">paso 19</a>).` },
          { t: 'op', block: 'proj', model: 'transformer', title: 'Proyección de salida W_O', tex: R`O = Z\,W_O + b_O,\quad W_O\in\mathbb{R}^{D\times D}`,
            in: ['z'], out: ['o'],
            what: `Una lineal D→D: ${q('op.proj.paramArith')} parámetros.`,
            why: `Sin W<sub>O</sub>, cada cabeza escribiría solo en "sus" columnas del residual; W<sub>O</sub> deja que cualquier cabeza escriba en cualquier dimensión (<a href="lab:paso-20">paso 20</a>).` },
          { t: 'trace', model: 'transformer', from: 'x0', to: 'x-out' },
        ],
      },
      // ======================================================== 3
      {
        id: 'raiz-dh', title: 'Por qué se divide entre √d_h', titleEn: 'Why scale by √d_h', priority: 'core',
        blocks: [
          { t: 'p', html: R`Supón que, al inicializar, cada componente de q y de k es independiente con media 0 y varianza 1. El score \(q\cdot k=\sum_{i=1}^{d_h} q_i k_i\) es una suma de d<sub>h</sub> términos de varianza 1: su varianza es d<sub>h</sub>. En el juguete d<sub>h</sub> = ${q('dh')} y la desviación estándar es 2; en ViT-B/16 d<sub>h</sub> = ${qv('dh')} y la desviación estándar es 8. Scores de ±16 dentro de un softmax dan una fila casi one-hot: e<sup>16</sup> ≈ 9 millones contra e<sup>0</sup> = 1.` },
          { t: 'math', display: true, tex: R`\operatorname{Var}(q\cdot k)=d_h\quad\Rightarrow\quad\operatorname{Var}\!\left(\frac{q\cdot k}{\sqrt{d_h}}\right)=1`, caption: 'Con componentes independientes, media 0 y varianza 1.' },
          { t: 'p', html: R`Un softmax saturado tiene gradiente casi nulo: su jacobiano es \(\operatorname{diag}(a)-aa^\top\), y si a es casi one-hot, todas sus entradas son casi 0. Dividir entre √d<sub>h</sub> deja los scores con varianza ≈ 1 sin importar el ancho de la cabeza, así que el entrenamiento arranca con atención "blanda" y gradientes útiles.` },
          { t: 'callout', kind: 'trap', html: `<p><b>"¿Por qué no dividir entre d<sub>h</sub>?"</b> Porque la varianza quedaría en 1/d<sub>h</sub>: scores casi iguales y atención casi uniforme al inicio. Y <b>no</b> es para evitar overflow: el softmax se calcula restando el máximo de la fila, así que es estable con o sin escala. El problema es la saturación, no la aritmética.</p>` },
          { t: 'callout', kind: 'senior', html: `<p>La escala es un supuesto de inicialización. A gran escala los logits de atención igual crecen durante el entrenamiento; por eso algunos modelos normalizan q y k antes del producto (QK-norm, usado en ViT-22B) en vez de confiar solo en 1/√d<sub>h</sub>.</p>` },
        ],
      },
      // ======================================================== 4
      {
        id: 'multi-head', title: 'Multi-head: h subespacios en paralelo', titleEn: 'Multi-head attention', priority: 'core',
        blocks: [
          { t: 'p', html: `Con D = ${q('D')} y h = ${q('h')}, cada cabeza ve ${q('dh')} dimensiones. Lo importante: <b>W<sub>Q</sub> sigue siendo de D×D</b>. Partir en cabezas no agrega parámetros, solo decide qué columnas se comparan juntas. La proyección QKV tiene ${q('op.qkv.params')} parámetros con 1, 2 u 8 cabezas.` },
          { t: 'table', caption: 'Qué cambia y qué no cuando cambias h (D fijo)',
            head: ['Magnitud', 'Fórmula', '¿Depende de h?', 'Juguete (h = 2)'],
            rows: [
              ['Parámetros de la atención', R`\(4D^2+4D\)`, 'no', q('attnParamsLayer')],
              ['MACs de QKᵀ', R`\(h\cdot N^2\cdot d_h = N^2 D\)`, 'no', q('op.scores.macs')],
              ['Entradas de la matriz de scores', R`\(h\cdot N^2\)`, '<b>sí</b>: más cabezas, más memoria', q('scoreEntries')],
              ['Distribuciones de atención por token', 'h', '<b>sí</b>: una por cabeza', q('h')],
            ] },
          { t: 'p', html: `La ganancia de tener varias cabezas es expresiva: cada una hace su propio softmax, así que un token puede atender a la vez a su vecino (una cabeza) y a un token lejano relacionado (otra). Con una sola cabeza de ancho D, un único promedio tendría que servir para todo.` },
          { t: 'callout', kind: 'trap', html: `<p>"Más cabezas = más parámetros" es falso con D fijo. Lo que sí crece es la matriz de scores (h×N×N), que es la que se lleva la memoria en secuencias largas. Y d<sub>h</sub> no puede bajar sin límite: con d<sub>h</sub> muy chico, cada producto punto es demasiado pobre para comparar bien.</p>` },
          { t: 'callout', kind: 'connect', html: `<p>Los LLMs modernos comparten K y V entre grupos de cabezas de Q (GQA/MQA) para achicar el KV cache: lo verás en <a href="#llm-decoder">LLM decoder por dentro</a>.</p>` },
        ],
      },
      // ======================================================== 5
      {
        id: 'mascaras', title: 'Las tres máscaras', titleEn: 'Attention masks', priority: 'core',
        blocks: [
          { t: 'p', html: `La máscara decide quién puede mirar a quién. Se suma a los scores antes del softmax: 0 donde se permite, −∞ donde no, y el softmax vuelve exactamente 0 esos pesos. Las tres que aparecen en casi toda entrevista:` },
          { t: 'viz', kind: 'attention-masks', params: { config: T, source: 7 }, caption: 'Bidireccional, causal y cross-attention lado a lado, con las 5 posiciones del juguete; en cross-attention, 5 queries del decoder contra 7 keys de un encoder, así que la matriz es rectangular. Ilustrativo: las celdas muestran qué está permitido, no pesos entrenados.' },
          { t: 'table', caption: 'Bidireccional, causal y cross',
            head: ['Máscara', 'Quién ve a quién', 'Forma de los scores', 'Dónde aparece'],
            rows: [
              ['Bidireccional (ninguna)', 'todos a todos', 'N×N, completa', 'ViT, BERT, el encoder de T5 y de Whisper, el encoder de imagen de CLIP'],
              ['Causal', 'la posición i ve solo j ≤ i', 'N×N, triángulo superior en −∞', 'GPT, Llama, todo decoder-only; el decoder de T5'],
              ['Cross-attention', 'queries de un flujo; keys y values de otro', 'N<sub>q</sub>×N<sub>kv</sub>, rectangular', 'decoder de T5/Whisper (texto → encoder), DETR (queries → imagen), Stable Diffusion (imagen → texto)'],
            ] },
          { t: 'math', display: true, tex: R`A=\mathrm{softmax}\!\left(\frac{QK^\top}{\sqrt{d_h}}+M\right),\qquad M_{ij}=\begin{cases}0 & j\le i\\ -\infty & j>i\end{cases}\;\;\text{(causal)}`, caption: 'En cross-attention no hay "futuro" que tapar: Q sale de un flujo y K, V de otro.' },
          { t: 'p', html: `En el juguete causal hay ${qc('scoreEntries')} scores (h·N²), de los que se usan ${qc('usedScores')} y se tapan ${qc('maskedScores')}. Los MACs del calculador son los mismos que sin máscara (${qc('op.scores.macs')}): una implementación ingenua calcula todos los scores y después tapa los del futuro. FlashAttention, en cambio, se salta los bloques que quedan enteros bajo la máscara. En el Laboratorio la máscara causal es el <a href="lab:paso-11">paso 11</a>.` },
          { t: 'callout', kind: 'trap', html: `<p>No confundas la <b>máscara causal</b> con la <b>padding mask</b>. La de padding tapa las keys que son relleno en un batch con secuencias de distinto largo, y existe también en encoders bidireccionales. Un modelo puede usar las dos a la vez.</p>` },
        ],
      },
      // ======================================================== 6
      {
        id: 'pre-post-ln', title: 'Pre-LN vs post-LN', titleEn: 'Pre-LN vs post-LN', priority: 'core',
        blocks: [
          { t: 'math', display: true, tex: R`\text{post-LN: } x' = \mathrm{LN}\big(x+\mathrm{Attn}(x)\big)\qquad\qquad \text{pre-LN: } x' = x+\mathrm{Attn}\big(\mathrm{LN}(x)\big)`, caption: 'Igual para el MLP. El juguete, ViT y el Laboratorio son pre-LN.' },
          { t: 'p', html: R`La diferencia es dónde queda la normalización respecto de la suma residual. En pre-LN, el camino residual va de la entrada a la salida sin pasar por ninguna LayerNorm: \(x_L = x_0 + \sum_\ell F_\ell(\cdot)\). El gradiente llega a las primeras capas por ese camino identidad, sin atenuarse. En post-LN cada suma pasa por una LN y, con muchas capas, el gradiente cerca de la salida es grande y en las primeras capas pequeño: sin learning-rate warmup el entrenamiento suele divergir (Xiong et al., <i>On Layer Normalization in the Transformer Architecture</i>, ICML 2020, <a href="https://arxiv.org/abs/2002.04745" target="_blank" rel="noopener">arXiv:2002.04745</a>).` },
          { t: 'table', caption: 'Post-LN vs pre-LN',
            head: ['', 'Post-LN', 'Pre-LN'],
            rows: [
              ['Dónde va la LN', 'después de la suma residual', 'antes de la atención y del MLP, dentro de la rama'],
              ['Camino residual', 'pasa por una LN en cada bloque', 'identidad de punta a punta'],
              ['¿LN final antes de la cabeza?', 'no hace falta (la salida ya está normalizada)', '<b>sí</b>: la salida del último bloque no está normalizada'],
              ['Warmup', 'crítico', 'ayuda, pero entrena estable sin él con más facilidad'],
              ['Ejemplos', 'Transformer original, BERT', 'GPT-2 en adelante, ViT, Llama (con RMSNorm)'],
            ] },
          { t: 'callout', kind: 'interview', html: `<p>"Pre-LN deja el camino residual como identidad, así que el gradiente llega a las primeras capas sin pasar por ninguna normalización; por eso entrena estable con muchas capas y por eso necesita una LayerNorm final antes de la cabeza". Esa LN final es el bloque <code>final-ln</code> del diagrama de <a href="#vit">ViT</a>. En el Laboratorio: <a href="lab:paso-4">paso 4</a> (LN 1) y <a href="lab:paso-21">paso 21</a> (residual).</p>` },
        ],
      },
      // ======================================================== 7
      {
        id: 'costo', title: 'Costo: O(N²·D) vs O(N·D²)', titleEn: 'Attention cost', priority: 'core',
        blocks: [
          { t: 'p', html: `En un bloque hay dos tipos de MACs. Las <b>lineales</b> (QKV, W<sub>O</sub> y las dos capas del MLP) trabajan token por token: crecen como N·D². Los <b>scores y A·V</b> comparan tokens entre sí: crecen como N²·D. En el juguete, las lineales suman ${q('metrics.linearMacs')} MACs y la parte cuadrática ${q('scoreMacsLayer')}: con 5 tokens, lo cuadrático es una fracción chica (${q('metrics.scoreMacsShare')} del total).` },
          { t: 'math', display: true, tex: R`\text{MACs}_{\text{capa}} = \underbrace{N\,(4D^2 + 2D\,D_{\mathrm{mlp}})}_{\text{lineales}} + \underbrace{2N^2D}_{QK^\top \text{ y } AV}\;\overset{D_{\mathrm{mlp}}=4D}{=}\;12ND^2 + 2N^2D`, caption: 'Sin contar softmax, normalizaciones ni activaciones (van aparte como "otros").' },
          { t: 'p', html: R`Las dos partes se igualan cuando \(2N^2D = N(4D^2+2D\,D_{\mathrm{mlp}})\), es decir en \(N^* = 2D + D_{\mathrm{mlp}}\), que con D<sub>mlp</sub> = 4D es <b>N = 6D</b>. En el juguete N* = ${q('crossoverN')}; en ViT-B/16, N* = ${qv('crossoverN')} contra ${qv('tokens')} tokens reales, por eso en ViT a 224 la parte cuadrática es solo ${qv('metrics.scoreMacsShare')} de los MACs. Mueve N abajo y mira cómo se cruzan.` },
          { t: 'scaling', model: 'transformer', knobs: [{ key: 'N', values: [5, 16, 48, 96, 256] }], show: ['tokens', 'macs', 'scoreMacsShare', 'attnMem'] },
          { t: 'callout', kind: 'trap', html: `<p><b>MACs no es memoria.</b> Aunque en MACs dominen las lineales, la matriz de scores ocupa h·N² valores por capa y por imagen: en ViT-B/16 @ 224 son ${qv('metrics.attnMem')} en bf16 por capa, y crece ≈ ×16 si duplicas la resolución (×4 tokens). FlashAttention evita guardarla completa (la calcula por bloques), pero no cambia los MACs.</p>` },
          { t: 'callout', kind: 'trap', html: `<p>"La atención domina cuando N > D" es la versión sin constantes: compara N²D (QKᵀ) con ND² (una sola proyección D×D). Con constantes, contra solo las proyecciones de la atención (4ND²) el cruce es 2N²D = 4ND², o sea N = 2D (${q('metrics.crossoverNProj')} en el juguete); contra todo el bloque, N = 6D. Di siempre qué estás comparando.</p>` },
          { t: 'params', model: 'transformer', group: 'op' },
          { t: 'flops', model: 'transformer' },
          { t: 'callout', kind: 'connect', html: `<p>La regla de los 12·D² parámetros por capa y el resto de las reglas prácticas (verificadas por el calculador, más la de entrenamiento: 6·params·tokens) están en <a href="#ref-formas">Formas y fórmulas</a>.</p>` },
        ],
      },
      // ======================================================== 8
      {
        id: 'tres-sabores', title: 'Encoder-only, decoder-only y encoder-decoder', titleEn: 'The three transformer flavors', priority: 'core',
        blocks: [
          { t: 'p', html: `Es la pregunta de entrada de casi cualquier entrevista de LLMs, y se responde con la máscara y el objetivo, no con el número de capas.` },
          { t: 'table', caption: 'Los tres sabores de transformer',
            head: ['Sabor', 'Máscara', 'Objetivo típico', 'Salida', 'Ejemplos'],
            rows: [
              ['Encoder-only', 'bidireccional', 'masked language modeling; clasificación; contrastivo', 'un vector por token (o CLS)', '<a href="#bert">BERT</a>, <a href="#vit">ViT</a>, el encoder de imagen de <a href="#clip">CLIP</a>'],
              ['Decoder-only', 'causal', 'next-token prediction', 'distribución del siguiente token', 'GPT, <a href="#llm-decoder">Llama</a>; los VLMs como <a href="#llava">LLaVA</a>'],
              ['Encoder-decoder', 'bidireccional en el encoder; causal + cross-attention en el decoder', 'seq2seq: traducir, resumir, transcribir', 'secuencia nueva, token a token', '<a href="#t5">T5</a>, <a href="#whisper">Whisper</a>, el Transformer original; <a href="#detr">DETR</a> usa la misma forma con queries aprendidas y <b>sin</b> máscara causal (decodifica todas en paralelo)'],
            ] },
          { t: 'callout', kind: 'interview', html: `<p><b>"¿Por qué casi todos los LLMs grandes son decoder-only?"</b> Un solo objetivo (next-token) sirve para preentrenar con cualquier texto sin etiquetar y para generar, con una sola pila y un KV cache simple. Además, cada token de entrenamiento aporta pérdida (en MLM, solo el ≈ 15 % enmascarado), y el mismo modelo hace zero-shot y few-shot con prompts. El encoder-decoder sigue ganando cuando la entrada es larga y fija y la salida corta (traducción, ASR), porque el encoder procesa la entrada una vez y en paralelo.</p>` },
        ],
      },
      // ======================================================== 9
      {
        id: 'laboratorio', title: 'Qué cubre el Laboratorio y qué agrega el atlas', titleEn: 'Lab vs atlas', priority: 'extra',
        blocks: [
          { t: 'p', html: `El Laboratorio Transformer es nivel 3: un decoder diminuto que entrena de verdad en tu navegador y te muestra cada número. El atlas es nivel 2: no vuelve a enseñar eso, lo aplica a modelos reales con sus formas, parámetros y costos exactos.` },
          { t: 'table', caption: 'Dónde ver cada cosa',
            head: ['Tema', 'En el Laboratorio', 'En el atlas'],
            rows: [
              ['Embeddings y codificación posicional', '<a href="lab:paso-2">paso 2</a> (embedding) y <a href="lab:paso-3">paso 3</a> (sinusoidal)', 'patch embedding y position embeddings aprendidas en <a href="#vit">ViT</a>'],
              ['Q, K, V, cabezas, softmax, A·V', '<a href="lab:paso-5">pasos 5–20</a>, celda por celda', `las mismas ops a escala real: ViT-B/16 con ${qv('tokens')} tokens`],
              ['Máscara causal', '<a href="lab:paso-11">paso 11</a>', 'las tres máscaras lado a lado (arriba)'],
              ['Backward y gradientes', '<a href="lab:paso-31">pasos 31–74</a>', 'no se repite: solo lo que importa para elegir arquitectura'],
              ['Entrenamiento y pérdida', '<a href="lab:entrenamiento">Entrenamiento</a>', 'recetas de los papers (datos, warmup, resolución)'],
              ['Generación autoregresiva', '<a href="lab:generacion">Generación</a>', 'KV cache, prefill vs decode (fase 6)'],
              ['Tokenizer y corpus', '<a href="lab:datos">Datos y modelo</a>', 'tokens de imagen, de texto y de acción'],
              ['Formas de visión, conteos exactos, FLOPs, diagramas de modelos reales', '—', 'cada página de modelo'],
            ] },
          { t: 'callout', kind: 'note', html: `<p>Los números de paso corresponden a la configuración por defecto del Laboratorio (1 capa, 2 cabezas, la frase «el gato come pescado .», 91 pasos). Si cambias capas o cabezas allá, los pasos se corren.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'repaso-atencion-01', kind: 'formula', q: 'Escribe la scaled dot-product attention.', a: R`\(\mathrm{softmax}(QK^\top/\sqrt{d_h})\,V\), con Q, K, V de N×d<sub>h</sub> por cabeza.` },
      { id: 'repaso-atencion-02', kind: 'forma', q: 'Juguete N = 5, D = 8, h = 2: formas de qkv, de Q por cabeza y de los scores.', a: `${q('tensor.qkv.shape')} → ${q('tensor.q.shape')} → ${q('tensor.scores.shape')}.` },
      { id: 'repaso-atencion-03', kind: 'concepto', q: '¿Por qué se divide entre √d_h?', a: 'Con componentes de varianza 1, q·k tiene varianza d<sub>h</sub>. Sin escala, los scores son grandes, el softmax se satura (casi one-hot) y su gradiente se anula. Con 1/√d<sub>h</sub> la varianza vuelve a ≈ 1.' },
      { id: 'repaso-atencion-04', kind: 'trampa', q: '¿Agregar cabezas (con D fijo) agrega parámetros a la atención?', a: `No: W<sub>Q</sub>, W<sub>K</sub>, W<sub>V</sub>, W<sub>O</sub> siguen siendo D×D (${q('attnParamsLayer')} parámetros en el juguete). Lo que crece es la matriz de scores h×N×N.` },
      { id: 'repaso-atencion-05', kind: 'conteo', q: 'MACs de QKᵀ y de A·V en una capa, en función de N y D.', a: R`\(h\cdot N^2\cdot d_h = N^2 D\) cada uno; juntos \(2N^2D\). En el juguete: ` + q('scoreMacsLayer') + '.' },
      { id: 'repaso-atencion-06', kind: 'formula', q: '¿En qué N se igualan los MACs cuadráticos con los lineales de un bloque?', a: R`\(2N^2D = N(4D^2+2D\,D_{\mathrm{mlp}})\Rightarrow N^*=2D+D_{\mathrm{mlp}}\), que con D<sub>mlp</sub> = 4D es N = 6D. ViT-B/16: ` + qv('crossoverN') + ' contra ' + qv('tokens') + ' tokens.' },
      { id: 'repaso-atencion-07', kind: 'concepto', q: 'Las tres máscaras y dónde aparece cada una.', a: 'Bidireccional (encoders: BERT, ViT); causal, j ≤ i (decoders: GPT, Llama); cross-attention, Q de un flujo y K, V de otro (decoder de T5/Whisper, DETR, Stable Diffusion).' },
      { id: 'repaso-atencion-08', kind: 'forma', q: 'En cross-attention con N_q queries y N_kv keys, ¿qué forma tiene la matriz de scores por cabeza?', a: 'N<sub>q</sub>×N<sub>kv</sub>: rectangular. No es cuadrada ni lleva máscara causal.' },
      { id: 'repaso-atencion-09', kind: 'tradeoff', q: 'Pre-LN vs post-LN: ¿qué cambia y qué implica?', a: 'Pre-LN normaliza dentro de la rama y deja el residual como identidad: entrena estable con muchas capas y necesita una LN final. Post-LN normaliza después de la suma: necesita warmup y es más inestable en profundidad.' },
      { id: 'repaso-atencion-10', kind: 'trampa', q: '¿La escala 1/√d_h es para evitar overflow en el softmax?', a: 'No. El softmax se calcula restando el máximo de la fila y es estable igual. La escala evita la saturación (gradientes ≈ 0) al inicio del entrenamiento.' },
      { id: 'repaso-atencion-11', kind: 'trampa', q: 'Con máscara causal, ¿se ahorran la mitad de los MACs de QKᵀ?', a: `En una implementación ingenua, no: se calculan todos los scores y luego se tapan (${qc('maskedScores')} de ${qc('scoreEntries')} en el juguete). FlashAttention sí se salta los bloques completamente enmascarados.` },
      { id: 'repaso-atencion-12', kind: 'trampa', q: 'Si en MACs dominan las capas lineales, ¿la atención deja de ser un problema de memoria?', a: `No. La matriz de scores ocupa h·N² valores por capa (${qv('metrics.attnMem')} en bf16 por capa en ViT-B/16 @ 224) y crece con N². FlashAttention evita materializarla.` },
      { id: 'repaso-atencion-13', kind: 'concepto', q: 'Encoder-only, decoder-only, encoder-decoder: máscara y objetivo de cada uno.', a: 'Encoder-only: bidireccional, MLM o clasificación (BERT, ViT). Decoder-only: causal, next-token (GPT, Llama). Encoder-decoder: bidireccional + causal con cross-attention, seq2seq (T5, Whisper).' },
      { id: 'repaso-atencion-14', kind: 'concepto', q: 'Equivalencia de símbolos Laboratorio → atlas.', a: 'T → N (longitud de la secuencia; en la página de ViT, N son los parches y la secuencia es N+1 con el CLS), d → D, d<sub>k</sub> → d<sub>h</sub>, d<sub>ff</sub> → D<sub>mlp</sub>; h es igual.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'scaled dot-product attention', es: 'atención de producto punto escalado', def: R`\(\mathrm{softmax}(QK^\top/\sqrt{d_h})V\): cada query se compara con todas las keys, el softmax da pesos y esos pesos promedian los values.`, say: 'Scaled dot-product attention divides the scores by the square root of the head dimension to keep the softmax from saturating.' },
      { en: 'query, key, value', es: 'consulta, clave, valor', def: 'Las tres proyecciones de cada token: la query es lo que busca, la key cómo se anuncia y el value lo que entrega si lo eligen.', say: 'Keys decide who gets attended to; values decide what information is passed along.' },
      { en: 'head dimension', es: 'dimensión por cabeza', def: 'd<sub>h</sub> = D/h: el ancho de q, k y v dentro de cada cabeza (d<sub>k</sub> en el Laboratorio y en el paper original).', say: 'With a width of 768 and 12 heads, the head dimension is 64.' },
      { en: 'causal mask', es: 'máscara causal', def: 'Máscara que impide que la posición i atienda a posiciones j > i (−∞ antes del softmax). Es lo que hace autoregresivo a un decoder.', say: 'The causal mask makes sure each token only attends to itself and the past.' },
      { en: 'bidirectional attention', es: 'atención bidireccional', def: 'Atención sin máscara: cada token ve a todos los demás. La usan los encoders (BERT, ViT).', say: 'BERT uses bidirectional attention, so it cannot generate text left to right.' },
      { en: 'cross-attention', es: 'atención cruzada', def: 'Atención en la que las queries vienen de un flujo y las keys y values de otro (decoder → encoder, queries de DETR → imagen, imagen → texto). La matriz de scores es rectangular.', say: 'In the decoder, cross-attention takes queries from the text and keys and values from the encoder output.' },
      { en: 'padding mask', es: 'máscara de relleno', def: 'Máscara que tapa las keys de relleno cuando un batch tiene secuencias de distinto largo. Independiente de la máscara causal.', say: 'We apply a padding mask so the model never attends to pad tokens.' },
      { en: 'post-LN', es: 'post-LN (normalización después del residual)', def: R`Bloque en el que la LayerNorm va después de la suma residual: \(\mathrm{LN}(x+F(x))\). Transformer original y BERT; necesita warmup.`, say: 'The original Transformer was post-LN, which is why it needed a learning-rate warmup.' },
      { en: 'encoder-only', es: 'solo encoder', def: 'Transformer con atención bidireccional que produce un vector por token; se entrena con MLM, clasificación o contraste (BERT, ViT).', say: 'An encoder-only model like BERT is great for classification and embeddings, not for generation.' },
      { en: 'decoder-only', es: 'solo decoder', def: 'Transformer con máscara causal entrenado con next-token prediction (GPT, Llama). Es la forma de casi todos los LLMs actuales.', say: 'Most modern LLMs are decoder-only: one stack, one objective, a simple KV cache.' },
      { en: 'encoder-decoder', es: 'codificador-decodificador', def: 'Un encoder bidireccional sobre la entrada y un decoder causal que la consulta con cross-attention (T5, Whisper).', say: 'Whisper is an encoder-decoder: the encoder reads the spectrogram once and the decoder writes the transcript.' },
      { en: 'FlashAttention', es: 'FlashAttention', def: 'Implementación exacta de la atención que la calcula por bloques en la memoria rápida de la GPU sin materializar la matriz N×N: menos memoria y menos tráfico, los mismos MACs.', say: 'FlashAttention does not change the FLOPs; it avoids writing the attention matrix to HBM.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
