/* =============================================================================
   Atlas de Arquitecturas — js/content/t5.js
   Página de modelo: T5 (Raffel et al., JMLR 2020, arXiv:1910.10683), con T5 v1.1 y Flan-T5 (Chung et al.,
   arXiv:2210.11416; JMLR 2024) en breve. Canónica t5-base. Plantilla fija de 11 secciones (SPEC §5.3, §24.1).
   Tesis de la fase (SPEC §24): el tercer sabor de transformer. Un encoder lee la entrada entera, bidireccional,
   UNA vez; un decoder causal genera token a token y la consulta por cross-attention, con las K y V de la
   cross-attention calculadas una sola vez por entrada.
   Regla: ningún número de la arquitectura se escribe a mano: formas, parámetros y MACs salen del calculador
   (js/arch/encdec.js: bloques op/trace/params/flops/scaling/compare y cantidades {{config.ruta}}, SPEC §6.6).
   Resultados de papers citan sección o tabla; estimaciones con est(). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/encdec.js, SPEC §24.1).
  const C = 't5-base';
  const CS = 't5-small';
  const CL = 't5-large';
  const CF = 'flan-t5-base';

  // Campos de la config del calculador: un solo lugar para adaptarlos.
  const CK = {
    D: 'D', h: 'h', dkv: 'dh', Dff: 'Dmlp', L: 'L', Ld: 'Ld', V: 'V', nb: 'buckets', md: 'maxDistance',
    Tin: 'Tin', Tout: 'Tout', B: 'B',
  };
  // Claves de metrics() del calculador.
  const MK = {
    emb: 'sharedEmbedParams', enc: 'encoderParams', dec: 'decoderParams', head: 'lmHeadParams', cross: 'crossAttnParams',
    rel: 'relBiasParams', encLayer: 'encoderLayerParams', decLayer: 'decoderLayerParams',
    embShare: 'sharedEmbedParamsShare', encShare: 'encoderParamsShare', decShare: 'decoderParamsShare', crossShare: 'crossAttnParamsShare',
    encMacs: 'encoderMacs', crossKvMacs: 'crossKvMacs', decTok: 'decoderMacsPerToken', decSelf: 'decoderSelfMacsPerToken',
    decCross: 'decoderCrossMacsPerToken', decFfn: 'decoderFfnMacsPerToken', headTok: 'lmHeadMacsPerToken',
    gen: 'totalGenerationMacs', genDec: 'generationDecoderMacs', encGenShare: 'encoderShare', decGenShare: 'decoderShare', encVsTok: 'encoderVsToken',
    crossKv: 'crossKvBytes', selfKv: 'selfKvCacheBytes', kvTok: 'selfKvBytesPerToken', w: 'weightBytes',
    encMs: 'encoderMs', decMs: 'decoderMs', genMs: 'generationMs', stepMs: 'decoderStepMs',
    spRaw: 'spanRawTokens', spIn: 'spanInputTokens', spTg: 'spanTargetTokens', spNoise: 'spanNoiseTokens', spSpans: 'spanNoiseSpans', spKeep: 'spanNonNoiseTokens',
  };
  // Ids de tensores del calculador (contrato con el diagrama t5-overview y el trace).
  const T = {
    ids: 'ids', x0: 'e-x0', encOut: 'enc-out', yIds: 'dec-ids', y0: 'd-x0', dh1: 'd-h1', selfScores: 'd-scores', r1: 'd-r1',
    ch: 'c-h', crossK: 'c-k-heads', crossScores: 'c-scores', r2: 'd-r2', ffnOut: 'd-x-out', decOut: 'dec-out', logits: 'logits',
  };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const cf = (k, cfg) => qn('cfg.' + (CK[k] || k), cfg);
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const sh = (id, cfg) => qn('tensor.' + (T[id] || id) + '.shape', cfg);

  const PAPER = 'Raffel et al., <i>Exploring the Limits of Transfer Learning with a Unified Text-to-Text Transformer</i>, JMLR 21(140), 2020, arXiv:1910.10683';
  const FLAN = 'Chung et al., <i>Scaling Instruction-Finetuned Language Models</i>, arXiv:2210.11416 (2022; JMLR 25, 2024)';
  const V11 = 'notas de los checkpoints T5.1.1 en el repositorio google-research/text-to-text-transfer-transformer (released_checkpoints.md)';
  const VASWANI = 'Vaswani et al., <i>Attention Is All You Need</i>, NeurIPS 2017, arXiv:1706.03762';
  const SHAW = 'Shaw, Uszkoreit y Vaswani, <i>Self-Attention with Relative Position Representations</i>, NAACL 2018, arXiv:1803.02155';
  const GLU = 'Shazeer, <i>GLU Variants Improve Transformer</i>, arXiv:2002.05202 (2020)';
  const ADAF = 'Shazeer y Stern, <i>Adafactor: Adaptive Learning Rates with Sublinear Memory Cost</i>, ICML 2018, arXiv:1804.04235';
  const BART = 'Lewis et al., <i>BART: Denoising Sequence-to-Sequence Pre-training for Natural Language Generation, Translation, and Comprehension</i>, ACL 2020, arXiv:1910.13461';
  const MT5 = 'Xue et al., <i>mT5: A Massively Multilingual Pre-trained Text-to-Text Transformer</i>, NAACL 2021, arXiv:2010.11934';
  const BYT5 = 'Xue et al., <i>ByT5: Towards a Token-Free Future with Pre-trained Byte-to-Byte Models</i>, TACL 2022, arXiv:2105.13626';
  const UL2 = 'Tay et al., <i>UL2: Unifying Language Learning Paradigms</i>, ICLR 2023, arXiv:2205.05131';
  const SWITCH = 'Fedus, Zoph y Shazeer, <i>Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity</i>, JMLR 2022, arXiv:2101.03961';
  const WANG = 'Wang et al., <i>What Language Model Architecture and Pretraining Objective Work Best for Zero-Shot Generalization?</i>, ICML 2022, arXiv:2204.05832';
  const IMAGEN = 'Saharia et al., <i>Photorealistic Text-to-Image Diffusion Models with Deep Language Understanding</i> (Imagen), NeurIPS 2022, arXiv:2205.11487';
  const ST5 = 'Ni et al., <i>Sentence-T5: Scalable Sentence Encoders from Pre-trained Text-to-Text Models</i>, Findings of ACL 2022, arXiv:2108.08877';
  const LONGT5 = 'Guo et al., <i>LongT5: Efficient Text-To-Text Transformer for Long Sequences</i>, Findings of NAACL 2022, arXiv:2112.07916';

  ATLAS.register({
    id: 't5',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> T5 recibe <b>texto</b> (la tarea escrita como prefijo: "translate English to German: That is good.") y devuelve <b>texto</b> ("Das ist gut."). Por dentro son dos transformers pegados: un <b>encoder</b> que lee la entrada entera, con atención bidireccional, <b>una sola vez</b>; y un <b>decoder</b> causal que escribe la salida token a token y, en cada capa, consulta la salida del encoder por <b>cross-attention</b>. Es el tercer sabor de transformer, después de <a href="#bert">BERT</a> (solo encoder) y del <a href="#llm-decoder">LLM</a> (solo decoder).` },
          { t: 'p', html: R`El paper (${PAPER}) no propuso una arquitectura nueva: tomó el encoder-decoder del Transformer original (${VASWANI}) con pocos cambios y lo usó como banco de pruebas para comparar, con el mismo presupuesto, arquitecturas, objetivos de preentrenamiento, datos y estrategias de transfer. La idea que lo hizo famoso es el formato <b>text-to-text</b>: clasificar, traducir, resumir, responder preguntas y hasta regresión son "texto de entrada → texto de salida", con el mismo modelo, la misma pérdida y el mismo decodificado. T5-base tiene ${qn('params.total')} parámetros (el "220M" del paper).` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿T5 (o un encoder-decoder)?', 'Por qué'], rows: [
            ['Traducción, resumen, reescritura: entrada larga y fija, salida más corta', 'Sí', R`La entrada pasa por el encoder una vez; cada token generado cuesta solo el decoder. Es el caso para el que se diseñó el seq2seq.`],
            ['Extracción estructurada (texto → JSON, texto → SQL) con datos etiquetados y mucho volumen', 'Sí, ajustado', R`Un T5-base o Flan-T5 ajustado cuesta una fracción de un LLM y no "conversa": devuelve el formato que aprendió.`],
            ['Text encoder para un modelo de difusión o de embeddings', 'Sí, solo el encoder', R`Imagen y SD3 usan el encoder de T5-XXL congelado (${IMAGEN}); Sentence-T5 hace embeddings con el encoder (${ST5}).`],
            ['Clasificar textos con miles de etiquetas de ejemplo', 'Funciona, pero no es lo más barato', R`T5 genera la etiqueta como texto ("positive"). Un encoder (<a href="#bert">BERT</a>, DeBERTa) con una cabeza lineal hace lo mismo con la mitad de parámetros y sin decodificar.`],
            ['Chat, tareas abiertas, few-shot con instrucciones largas, agentes', 'No: un LLM decoder-only', R`El ecosistema (instruction tuning, RLHF, serving con KV cache paginado) y el escalado se hicieron sobre decoders (<a href="#llm-decoder">LLM</a>). Un T5 sin instruction tuning no sigue instrucciones nuevas: aprendió a rellenar tramos (y el original, además, las tareas del paper con sus prefijos).`],
            ['Entradas de miles de tokens', 'Con cuidado', R`Se preentrenó con 512 tokens; las posiciones relativas no tienen un límite duro, pero la atención del encoder es cuadrática y la calidad más allá de lo entrenado no está garantizada. Para eso existe LongT5 (${LONGT5}).`],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"T5 is an encoder-decoder transformer that casts every NLP task as text-to-text, with a task prefix in the input. The encoder reads the whole input bidirectionally once; the decoder is causal and attends to the encoder output through cross-attention in every layer, so the cross-attention keys and values are computed once per input while the decoder runs once per generated token. It was pretrained with span corruption on C4: fifteen percent of tokens, in spans of mean length three, are replaced by sentinel tokens in the input, and the decoder outputs the missing spans. It uses relative position buckets and a simplified layer norm, and Flan-T5 is the instruction-tuned version you would actually start from today."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>El encoder de T5 es un BERT; el decoder es un LLM chico; los une una cross-attention como la de DETR o Stable Diffusion.</b> Casi todo lo que hay en esta página ya lo viste en otra: la atención bidireccional en <a href="#bert">BERT</a>, la causal y el KV cache en el <a href="#llm-decoder">LLM</a>, la cross-attention en el decoder de <a href="#detr">DETR</a> (queries que leen la memoria del encoder) y en la U-Net de <a href="#stable-diffusion">Stable Diffusion</a> (el latente que lee el texto). T5 solo junta las tres piezas.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de T5', head: ['Concepto', 'Donde ya lo viste', 'En T5', '¿Nuevo?'], rows: [
            ['Encoder bidireccional', 'BERT: todos a todos, un vector por token', R`${cf('L')} capas sobre la entrada, sin máscara causal: ${sh('encOut')} para T<sub>in</sub> = ${cf('Tin')}`, 'Igual'],
            ['Decoder causal + KV cache', 'LLM: cada token ve solo los anteriores; se guardan K y V', R`${cf('Ld')} capas sobre la salida generada; KV cache de la self-attention que crece con cada token`, 'Igual'],
            ['Cross-attention', 'DETR (queries → imagen), SD (latente → texto)', R`En cada capa del decoder: Q de los tokens de salida, K y V de la salida del encoder. K y V se calculan <b>una vez</b> por entrada`, 'Igual en la mecánica; <b>nuevo</b> el cache que no crece'],
            ['Objetivo de preentrenamiento', 'BERT: tapar 15 % de tokens sueltos y predecirlos en su lugar', R`<b>Span corruption</b>: tapar tramos con un sentinel cada uno y que el decoder escriba solo los tramos`, '<b>Nuevo</b>'],
            ['Posiciones', 'BERT: tabla absoluta; Swin: relative position bias; Llama: RoPE', R`Un escalar aprendido por cabeza sumado a los scores, según un <b>bucket</b> de la distancia (${cf('nb')} buckets, logarítmicos hasta ${cf('md')})`, 'Pariente del de Swin'],
            ['Normalización', 'Llama: RMSNorm pre-norm', 'La misma idea: escala sin bias ni media, antes de cada sub-bloque (el paper la llama "simplified layer normalization")', 'Igual'],
            ['Tareas', 'BERT: una cabeza distinta por tarea', R`Ninguna cabeza nueva: la tarea es un prefijo de texto y la respuesta, texto`, '<b>Nuevo</b>'],
          ] },
          { t: 'h3', text: 'El formato text-to-text' },
          { t: 'p', html: R`Todo entra y sale como texto. Ejemplos del paper (Figura 1 y §2.4):` },
          { t: 'table', head: ['Tarea', 'Entrada', 'Salida'], rows: [
            ['Traducción (WMT)', '<code>translate English to German: That is good.</code>', '<code>Das ist gut.</code>'],
            ['Aceptabilidad (CoLA)', '<code>cola sentence: The course is jumping well.</code>', '<code>not acceptable</code>'],
            ['Similitud (STS-B), una regresión', '<code>stsb sentence1: The rhino grazed on the grass. sentence2: A rhino is grazing in a field.</code>', '<code>3.8</code>'],
            ['Resumen (CNN/DM)', '<code>summarize: state authorities dispatched emergency crews tuesday …</code>', '<code>six people hospitalized after a storm in attala county.</code>'],
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué todo como texto', html: R`<p>Porque así <b>una sola configuración</b> sirve para todas las tareas: la misma pérdida (entropía cruzada sobre los tokens de salida), el mismo decodificado (greedy en los experimentos), los mismos hiperparámetros. Eso es lo que permitió comparar objetivos, datos y arquitecturas de forma justa en un mismo estudio, y entrenar multitarea mezclando datasets sin cabezas distintas. Detalles que se preguntan: la regresión de STS-B se convierte en una clasificación sobre valores discretos (el puntaje se redondea al múltiplo de 0.2 más cercano y se escribe como texto: 2.57 → "2.6"); si el modelo genera algo que no es ninguna etiqueta, cuenta como error, y el paper dice que nunca lo observó en modelos entrenados (§2.4).</p>` },
          { t: 'callout', kind: 'trap', title: '"T5 es un modelo nuevo de arquitectura"', html: R`<p>La arquitectura es casi la del Transformer original. Los cambios son tres y chicos: normalización sin bias (la escala RMS) aplicada antes de cada sub-bloque (pre-norm), posiciones relativas por buckets en vez de senoidales, y la tabla de embeddings compartida entre encoder, decoder y la proyección de salida. Lo que aporta el paper es el <b>estudio sistemático</b> (Tabla 2: arquitecturas; Tablas 4–7: objetivos; §3.4: datos; §3.5: estrategias de transfer) y el dataset C4.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Los tres sabores, con las tres máscaras dibujadas, están en el <a href="#repaso-atencion.tres-sabores">repaso de atención</a>. Esta página es la del tercero; <a href="#whisper">Whisper</a> es su hermano para audio (el mismo esqueleto con un encoder de espectrograma), y la decisión "encoder-decoder o decoder-only" está en la <a href="#t5.entrevista">entrevista</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`A la izquierda, el encoder: los ids de la entrada pasan por la tabla de embeddings compartida y por ${cf('L')} capas bidireccionales; su salida (<a href="#t5.diagrama~enc-out">enc-out</a>) se calcula una vez. A la derecha, el decoder: arranca con un token de inicio (en T5 es el id del padding), pasa por ${cf('Ld')} capas que tienen <b>tres</b> sub-bloques en vez de dos (self-attention causal, cross-attention al encoder, FFN) y termina en la proyección al vocabulario. Abre <a href="#t5.diagrama~decoder">decoder</a> para ver la capa; "Recorrido" sigue una entrada de T<sub>in</sub> = ${cf('Tin')} tokens y T<sub>out</sub> = ${cf('Tout')} tokens de salida.` },
          { t: 'archdiagram', diagram: 't5-overview', walk: 'forward', wide: true, caption: R`T5-base: ${cf('L')} + ${cf('Ld')} capas, D = ${cf('D')}, ${cf('h')} cabezas de d<sub>kv</sub> = ${cf('dkv')}, D<sub>ff</sub> = ${cf('Dff')} (ReLU), vocabulario de ${cf('V')}. Formas del calculador para T<sub>in</sub> = ${cf('Tin')}, T<sub>out</sub> = ${cf('Tout')}.` },
          { t: 'p', html: R`<b>Qué se tapa y qué se predice.</b> El objetivo de preentrenamiento sobre la oración de la Figura 2 del paper: los tramos "for inviting" y "last" se reemplazan en la entrada por un sentinel cada uno, y el decoder tiene que escribir solo lo que falta, cada tramo detrás de su sentinel.` },
          { t: 'viz', kind: 'span-corruption', params: { mode: 'paper', density: 0.15, span: 3, seed: 1 }, caption: 'Span corruption (Raffel et al., Figura 2 y §3.3.4). Cambia a "random" para ver el muestreo real de T5 con densidad y largo medio de tramo; el texto es ilustrativo.' },
          { t: 'p', html: R`<b>Qué mira cada token generado.</b> En la cross-attention, cada fila es un token de la salida y cada columna una posición de la entrada: una matriz T<sub>out</sub>×T<sub>in</sub> por cabeza, rectangular y sin máscara causal (el decoder puede mirar toda la entrada). En traducción suele parecerse a un alineamiento palabra a palabra.` },
          { t: 'viz', kind: 'cross-attention-map', params: { model: 't5' }, caption: 'Cross-attention ilustrativa (pesos sintéticos de una cabeza, no de un T5 entrenado) para "I have eaten the apple ." → "Ich habe den Apfel gegessen .": filas = tokens generados, columnas = posiciones del encoder. La fila de "gegessen" mira a "eaten", fuera de la diagonal, porque el alemán pone el verbo al final.' },
          { t: 'callout', kind: 'note', html: R`<p>Tres detalles del diagrama: (1) <b>una sola tabla</b> de ${cf('V')} × ${cf('D')} sirve de embedding del encoder, del decoder y, transpuesta, de proyección de salida (en T5 original; en v1.1 y Flan-T5 la salida tiene su propia matriz); (2) el sesgo de posición relativa se calcula en la <b>primera</b> capa de cada pila y se reutiliza en todas las demás, y la cross-attention <b>no</b> lleva sesgo de posición; (3) cada pila termina con una normalización final antes de entregar su salida.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación, con el ejemplo del paper. La entrada corrompida "Thank you &lt;X&gt; me to your party &lt;Y&gt; week ." se tokeniza con SentencePiece (≈ 11 piezas más el fin de secuencia &lt;/s&gt;); cada pieza busca su fila en la tabla de ${cf('D')} números. El encoder mezcla esos vectores ${cf('L')} veces, cada uno mirando a todos, y entrega un vector contextual por pieza: esa es la "memoria". El decoder empieza con un solo token (el de inicio) y produce, de a uno, "&lt;X&gt;", "for", "inviting", "&lt;Y&gt;", "last", "&lt;Z&gt;", "&lt;/s&gt;". En cada paso, el token nuevo mira a los anteriores de la salida (self-attention causal) y a toda la memoria del encoder (cross-attention). La canónica del calculador usa T<sub>in</sub> = ${cf('Tin')} y T<sub>out</sub> = ${cf('Tout')}.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'T5-base'], rows: [
            ['T<sub>in</sub>', 'tokens de la entrada (encoder)', cf('Tin')],
            ['T<sub>out</sub>', 'tokens de la salida (decoder)', cf('Tout')],
            ['D', 'ancho del modelo (d_model)', cf('D')],
            ['h, d<sub>kv</sub>', 'cabezas y ancho por cabeza (en T5, h·d<sub>kv</sub> = D en base; en 3B y 11B no)', R`${cf('h')}, ${cf('dkv')}`],
            ['D<sub>ff</sub>', 'ancho de la FFN (d_ff)', cf('Dff')],
            ['L', 'capas por pila (encoder y decoder)', R`${cf('L')} + ${cf('Ld')}`],
            ['V', 'vocabulario de la tabla (32,000 piezas + 100 sentinels, relleno a múltiplo de 128)', cf('V')],
            ['n<sub>b</sub>, d<sub>max</sub>', 'buckets de posición relativa y distancia donde se saturan', R`${cf('nb')}, ${cf('md')}`],
          ] },

          { t: 'h3', text: 'Embedding compartido' },
          { t: 'op', block: 'embed', model: 't5', diagram: 't5-overview', title: 'Búsqueda en la tabla compartida, sin posiciones',
            tex: R`X_0 = E[\text{ids}_\text{in}],\qquad Y_0 = E[\text{ids}_\text{out}],\qquad E\in\mathbb{R}^{V\times D}`,
            in: [T.ids], out: [T.x0], params: true, flops: true,
            what: R`Una búsqueda en la tabla (sin MACs): ${sh('ids')} ids → ${sh('x0')}. La misma tabla sirve a la entrada del decoder. <b>No</b> se suma ninguna posición: la posición entra en cada atención como sesgo.`,
            why: R`Compartir la tabla entre encoder y decoder tiene sentido porque los dos hablan el mismo idioma (texto a texto) y ahorra ${cf('V')} × ${cf('D')} parámetros. No sumar posiciones absolutas a los embeddings es lo que permite usar el modelo, al menos en principio, con largos distintos de los del preentrenamiento.` },

          { t: 'h3', text: 'La capa de encoder' },
          { t: 'op', block: 'encoder', model: 't5', diagram: 't5-overview', title: 'Pre-norm RMS, self-attention bidireccional con sesgo relativo, FFN ReLU',
            tex: R`\begin{aligned} H &= X + \mathrm{MHA}\big(\mathrm{RMS}(X)\big),\qquad \mathrm{MHA}:\ \mathrm{softmax}\big(Q_kK_k^\top + B\big)V_k \\ X' &= H + W_o\,\mathrm{ReLU}\big(W_i\,\mathrm{RMS}(H)\big),\qquad \mathrm{RMS}(x) = \gamma\odot\frac{x}{\sqrt{\tfrac1D\sum_j x_j^2+\varepsilon}}\end{aligned}`,
            in: [T.x0], out: [T.encOut], params: true, flops: true,
            what: R`Una capa, repetida ${cf('L')} veces: ${sh('x0')} → ${sh('encOut')}. Sin máscara causal (solo la de padding). B es el sesgo de posición relativa, una matriz T<sub>in</sub>×T<sub>in</sub> por cabeza. Ninguna lineal lleva bias. Al final de la pila, una RMSNorm más.`,
            why: R`Pre-norm (normalizar la entrada de cada sub-bloque y dejar el residual limpio) entrena estable sin trucos, como en ViT y Llama, a diferencia del post-LN de <a href="#bert">BERT</a>. La "simplified layer normalization" del paper solo re-escala, sin restar la media ni sumar bias: es lo que después se llamó RMSNorm.` },
          { t: 'callout', kind: 'trap', title: '"La atención de T5 divide por √d_kv"', html: R`<p>No la divide: los scores son QKᵀ + B, sin el 1/√d<sub>kv</sub>. El factor está "plegado" en la inicialización de W<sub>Q</sub> (Mesh TensorFlow inicializa la proyección de queries con una desviación estándar que ya incluye ese factor). En Hugging Face, <code>T5Attention</code> usa <code>scaling = 1.0</code>. Si reimplementas T5 y agregas el 1/√d<sub>kv</sub> por costumbre, cargas los pesos sin error de forma y el modelo da basura: los logits de atención quedan divididos por √${cf('dkv')} = 8 y las distribuciones, mucho más planas de lo que el modelo aprendió.</p>` },

          { t: 'h3', text: 'Sesgo de posición relativa por buckets' },
          { t: 'p', html: R`Cada cabeza aprende ${cf('nb')} números, uno por bucket. Para un par (query i, key j) se mira la distancia j − i, se elige su bucket y se suma ese número al score antes del softmax. Los buckets son exactos para distancias cortas y logarítmicos para las largas, y toda distancia ≥ ${cf('md')} comparte el último. En el encoder (bidireccional) hay 16 buckets por dirección: 8 exactos (distancias 0 … 7) y 8 en escala log hasta ${cf('md')}. En el decoder (causal) los ${cf('nb')} son para la izquierda: 16 exactos (0 … 15) y 16 logarítmicos.` },
          { t: 'table', caption: 'Bucket según la distancia j − i (salida de _relative_position_bucket de HF con 32 buckets y distancia máxima 128; verificado)', head: ['j − i', '0', '−1', '−7', '−8', '−12', '−20', '−32', '−64', '−100', '≤ −128', '+1', '+8', '+32', '≥ +100'], rows: [
            ['Encoder (bidireccional)', '0', '1', '7', '8', '9', '10', '12', '14', '15', '15', '17', '24', '28', '31'],
            ['Decoder (causal)', '0', '1', '7', '8', '12', '17', '21', '26', '30', '31', '0', '0', '0', '0'],
          ], note: 'En el decoder causal, las distancias positivas (keys a la derecha) caen en el bucket 0, pero la máscara causal las anula igual. En el encoder, el bucket 16 queda sin usar: el bucket de distancia 0 es el 0 de la mitad izquierda.' },
          { t: 'math', display: true, tex: R`\text{score}_{ij} = \mathbf{q}_i^\top\mathbf{k}_j + b_{\text{bucket}(j-i)}^{(c)},\qquad b^{(c)}\in\mathbb{R}^{n_b}\ \text{por cabeza } c,\ \text{compartido por todas las capas de la pila}`, caption: 'Por pila: n_b × h parámetros (una tabla en el encoder, otra en el decoder). La cross-attention no lleva sesgo: las posiciones de la entrada y de la salida no se comparan.' },
          { t: 'callout', kind: 'why', title: 'Por qué buckets logarítmicos y compartidos', html: R`<p>Distinguir "la palabra de al lado" de "dos palabras atrás" importa; distinguir 97 de 98 casi nunca. Los buckets gastan resolución donde sirve. Compartir la tabla entre capas (el paper lo dice explícito, §2.1: "for efficiency") cuesta casi nada en calidad y deja el sesgo calculado una vez por pila. Frente al de <a href="#swin">Swin</a>: allí la tabla es por desplazamiento 2D exacto dentro de una ventana fija; aquí es 1D, sin ventana, con buckets. Frente a RoPE (<a href="#llm-decoder">LLM</a>): RoPE rota q y k y hace que el producto dependa de j − i; T5 suma un escalar por bucket; ALiBi siguió después la misma idea con una penalización lineal fija por cabeza en vez de una tabla aprendida (el antecedente, con vectores relativos, es ${SHAW}).</p>` },

          { t: 'h3', text: 'La capa de decoder: tres sub-bloques' },
          { t: 'p', html: R`Ábrela en el diagrama (<a href="#t5.diagrama~decoder">decoder</a>): self-attention causal, cross-attention, FFN; cada uno con su RMSNorm de entrada y su residual. Las formas son para teacher forcing (las T<sub>out</sub> posiciones a la vez, como en el entrenamiento).` },
          { t: 'op', block: 'self-attn', model: 't5', diagram: 't5-decoder-layer', title: 'Self-attention causal con sesgo relativo',
            tex: R`\mathrm{softmax}\big(Q_kK_k^\top + B_\text{dec} + M_\text{causal}\big)V_k,\qquad (M_\text{causal})_{ij} = -\infty\ \text{si } j > i`,
            in: [T.dh1], out: [T.selfScores, T.r1], params: true, flops: true,
            what: R`Igual que la del <a href="#llm-decoder">LLM</a>: cada token de la salida mira solo a los anteriores. Scores: ${sh('selfScores')}. En generación, con KV cache, un paso es 1 query contra los t tokens ya generados.`,
            why: R`Es la que permite generar de izquierda a derecha: p(y<sub>t</sub> | y<sub>&lt;t</sub>, x). Con la máscara causal, un token nuevo no cambia las K y V de los anteriores, y por eso se pueden cachear.` },
          { t: 'op', block: 'cross-attn', model: 't5', diagram: 't5-decoder-layer', title: 'Cross-attention: Q del decoder, K y V del encoder',
            tex: R`\mathrm{softmax}\big(Q_kK_k^\top\big)V_k,\qquad Q = \mathrm{RMS}(Y)W_Q\in\mathbb{R}^{T_\text{out}\times D},\quad K = \mathrm{enc}W_K,\ V = \mathrm{enc}W_V\in\mathbb{R}^{T_\text{in}\times D}`,
            in: [T.ch, T.encOut], out: [T.crossScores, T.r2], params: true, flops: true,
            what: R`Las queries salen del decoder; las keys y values, de la salida del encoder (${sh('encOut')}), con proyecciones propias de cada capa. Scores: ${sh('crossScores')}: rectangulares, sin máscara causal y sin sesgo de posición.`,
            why: R`Es el canal por el que la entrada condiciona la salida. Como enc-out no cambia mientras se genera, K = enc·W<sub>K</sub> y V = enc·W<sub>V</sub> de las ${cf('Ld')} capas se calculan <b>una vez</b> por entrada (${met('crossKvMacs')}) y se guardan: es el "cross KV cache", de tamaño fijo. En cada paso de decode solo se proyecta la query del token nuevo.` },
          { t: 'op', block: 'ffn', model: 't5', diagram: 't5-decoder-layer', title: 'FFN ReLU sin bias',
            tex: R`\mathrm{FFN}(x) = W_o\,\mathrm{ReLU}(W_i\,x),\qquad W_i\in\mathbb{R}^{D_\text{ff}\times D},\ W_o\in\mathbb{R}^{D\times D_\text{ff}}`,
            in: [T.r2], out: [T.ffnOut], params: true, flops: true,
            what: R`Por token: sube a D<sub>ff</sub> = ${cf('Dff')} y baja a ${cf('D')}. La misma FFN que en el encoder, con pesos propios.`,
            why: R`Como en todo transformer, la mayor parte de los parámetros y de los MACs por token de la capa están aquí. En v1.1 y Flan-T5 se cambia por GEGLU (dos matrices de entrada, una con GELU como compuerta) con D<sub>ff</sub> = ${cf('Dff', CF)}: 3·D·${cf('Dff', CF)} = 2·D·${cf('Dff')}, los mismos parámetros (${GLU}).` },

          { t: 'h3', text: 'Proyección al vocabulario' },
          { t: 'op', block: 'lm-head', model: 't5', diagram: 't5-overview', title: 'Logits con la tabla atada y el reescalado D^−½',
            tex: R`\mathbf{z}_t = \big(D^{-1/2}\,\mathrm{RMS}(\mathbf{h}_t)\big)\,E^\top\in\mathbb{R}^{V},\qquad p(y_t\mid y_{\lt t}, x) = \mathrm{softmax}(\mathbf{z}_t)`,
            in: [T.decOut], out: [T.logits], params: true, flops: true,
            what: R`Una lineal D → V por token de salida, con la tabla de embeddings transpuesta: ${sh('decOut')} → ${sh('logits')}. Antes se multiplica por D<sup>−½</sup>.`,
            why: R`Atar la salida a la tabla de entrada ahorra ${cf('V')} × ${cf('D')} parámetros. El factor D<sup>−½</sup> compensa la escala: la tabla está inicializada para que los embeddings de entrada tengan una norma razonable, y sin el factor los logits saldrían ≈ √D veces más grandes. En v1.1 y Flan-T5 (salida sin atar) no hay reescalado: la matriz de salida aprende su propia escala.` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de la canónica (T<sub>in</sub> = ${cf('Tin')}, T<sub>out</sub> = ${cf('Tout')}). Toca una fila para resaltarla en el diagrama.` },
          { t: 'trace', model: 't5' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`T5-base tiene ${qn('params.total')} parámetros: la tabla compartida (${met('emb')}, ${met('embShare')}), el encoder (${met('enc')}, ${met('encShare')}) y el decoder (${met('dec')}, ${met('decShare')}), que es más grande porque cada capa tiene además una cross-attention (${met('cross')} en total con sus RMSNorm, ${met('crossShare')}). La proyección de salida no suma nada: está atada a la tabla.` },
          { t: 'params', model: 't5', group: 'block' },
          { t: 'calc', title: 'De dónde salen los parámetros de T5-base (calculador)', rows: [
            { label: 'Tabla compartida', expr: R`V·D = ${cf('V')}·${cf('D')}`, value: met('emb'), note: R`${met('embShare')} del total` },
            { label: 'Una capa de encoder', expr: R`atención 4·D·(h·d<sub>kv</sub>) · FFN 2·D·D<sub>ff</sub> · 2 RMSNorm de D (sin biases)`, value: met('encLayer') },
            { label: R`Encoder (× ${cf('L')} + sesgo relativo + norma final)`, expr: R`L · capa + n<sub>b</sub>·h + D`, value: met('enc') },
            { label: 'Una capa de decoder', expr: R`self 4·D² + cross 4·D² + FFN 2·D·D<sub>ff</sub> + 3 RMSNorm`, value: met('decLayer') },
            { label: R`Decoder (× ${cf('Ld')} + sesgo relativo + norma final)`, expr: R`L · capa + n<sub>b</sub>·h + D`, value: met('dec') },
            { label: 'Sesgo de posición relativa', expr: R`2 pilas · n<sub>b</sub> · h = 2·${cf('nb')}·${cf('h')}`, value: met('rel') },
            { label: 'Proyección de salida', expr: 'atada a la tabla (T5 original)', value: met('head') },
          ], result: R`Un encoder-decoder L + L tiene ≈ el doble de parámetros que un encoder solo de L capas: T5-base es "dos BERT-base" (más las cross-attention), por eso el "220M" frente al "110M" de BERT. El paper lo usa a su favor: <b>parámetros 2P, costo M</b> (Tabla 2), porque cada token pasa por una sola de las dos pilas.` },
          { t: 'callout', kind: 'trap', title: '"T5-base y BERT-base son del mismo tamaño porque tienen D = 768 y 12 capas"', html: R`<p>T5-base tiene 12 capas <b>en cada pila</b>: ${qn('params.total')} contra los ≈ 110M de BERT-base. Y la comparación justa con un decoder-only no es por número de capas: el paper compara a igual cómputo (un decoder de L capas cuesta lo mismo por ejemplo que el encoder-decoder L + L, con la mitad de los parámetros) y a igual parámetros (un encoder-decoder L/2 + L/2 cuesta la mitad).</p>` },
          { t: 'h3', text: 'La asimetría de costo: el encoder una vez, el decoder por token' },
          { t: 'p', html: R`La canónica usa los largos del preentrenamiento: T<sub>in</sub> = ${cf('Tin')} y T<sub>out</sub> = ${cf('Tout')} (el target de span corruption). El encoder hace ${met('encMacs')} <b>una vez</b>; las K y V de la cross-attention, ${met('crossKvMacs')} más, también una vez. Después, cada token generado cuesta ${met('decTok')} en el decoder: self-attention ${met('decSelf')}, cross-attention ${met('decCross')}, FFN ${met('decFfn')} y la proyección al vocabulario ${met('headTok')} (con V = ${cf('V')}, casi un quinto del paso). Generar los ${cf('Tout')} tokens con KV cache cuesta en total ${met('gen')}, y el encoder es ${met('encGenShare')} de eso: el encoder cuesta lo mismo que ${met('encVsTok')} pasos de decoder.` },
          { t: 'callout', kind: 'trap', title: '"Si el encoder es la mayoría de los MACs, es la mayoría de la latencia"', html: R`<p>Al revés. El encoder procesa los ${cf('Tin')} tokens en paralelo: es un matmul grande, limitado por cómputo. Cada paso del decoder procesa <b>un</b> token y tiene que leer de memoria todos los pesos del decoder, la tabla y los dos caches: intensidad aritmética ≈ 1 FLOP por byte, limitado por memoria. Con la cota de roofline del calculador en una H100 (sin overheads), el encoder tarda ${est(met('encMs') + ' ms')} y los ${cf('Tout')} pasos del decoder ${est(met('decMs') + ' ms')}: ${met('encGenShare')} de los MACs, una fracción mínima del tiempo. La latencia de un encoder-decoder la manda el decoder; el costo en cómputo (y en batch grande, el throughput), la entrada.</p>` },
          { t: 'flops', model: 't5' },
          { t: 'viz', kind: 'encdec-cost', params: { model: 't5' }, caption: 'Costo acumulado al generar: el encoder y las K, V de la cross-attention son un escalón al inicio; cada token suma un paso del decoder. La línea punteada es lo que costaría recalcular las K, V cruzadas en cada token. Cambia a tiempo para ver que, en latencia, manda el decoder. Números del calculador.' },
          { t: 'h3', text: 'Cómo escala con T_in y T_out' },
          { t: 'scaling', model: 't5', knobs: [{ key: 'Tin', values: [64, 128, 512, 1024, 2048] }, { key: 'Tout', values: [16, 64, 114, 256, 512] }], show: ['encoderMacs', 'decoderMacsPerToken', 'totalGenerationMacs', 'encoderShare', 'crossKvBytes', 'selfKvCacheBytes'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 T<sub>in</sub> → ×2 en las lineales del encoder y ×4 en su QKᵀ y A·V (una vez); ×2 en el cross KV cache y en la parte de cross-attention de <b>cada</b> paso del decoder (cada query mira el doble de posiciones), pero las lineales del decoder por token no cambian. ×2 T<sub>out</sub> → ×2 pasos de decoder (y su self-attention crece con el largo ya generado); el encoder no cambia. Los parámetros no dependen de ninguno de los dos.` },
          { t: 'compare', models: [CS, C, CL, CF], rows: ['params', 'L', 'D', 'h', 'Dmlp', 'V', 'sharedEmbedParams', 'encoderParams', 'decoderParams', 'crossAttnParams', 'lmHeadParams', 'encoderMacs', 'crossKvMacs', 'decoderMacsPerToken', 'totalGenerationMacs', 'encoderShare', 'crossKvBytes', 'selfKvCacheBytes', 'generationMs'], caption: R`T5-small ("60M"), T5-base ("220M"), T5-large ("770M") y Flan-T5-base (v1.1: GEGLU con D<sub>ff</sub> = ${cf('Dff', CF)} y salida sin atar: ${qn('params.total', CF)}). MACs y bytes (bf16, batch 1) a T<sub>in</sub> = ${cf('Tin')}, T<sub>out</sub> = ${cf('Tout')}; el tiempo de generación es la cota ≈ de roofline del calculador en una H100, sin overheads.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota: "T5-base is about two hundred twenty million parameters: an eleven percent shared embedding table, a BERT-sized encoder and a slightly bigger decoder because every layer adds cross-attention. Cost is asymmetric: the encoder runs once over the input and the cross-attention keys and values are projected once, while the decoder runs once per output token. So for summarization, a long input and a short output, an encoder-decoder pays the input through half the layers a decoder-only model of the same size would use, and the per-token decode step is smaller too."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Una sola pérdida para todo: entropía cruzada sobre los tokens del <b>target</b>, con teacher forcing (el decoder recibe el target desplazado una posición a la derecha, empezando por el token de inicio). En preentrenamiento, el target es la lista de tramos con sus sentinels; en fine-tuning, la respuesta de la tarea.` },
          { t: 'math', display: true, tex: R`\mathcal{L} = -\sum_{t=1}^{T_\text{out}} \log p_\theta\big(y_t \mid y_{\lt t},\ \mathrm{enc}(\tilde{x})\big),\qquad \tilde{x} = \text{entrada corrompida},\ \ y = \text{tramos con sus sentinels} + \langle/s\rangle`, caption: 'A diferencia del MLM de BERT, la pérdida no se calcula en las posiciones de la entrada: el decoder escribe una secuencia nueva, más corta.' },
          { t: 'h3', text: 'Span corruption, paso a paso' },
          { t: 'steps', items: [
            { title: 'Cuántos tokens y cuántos tramos', html: R`<p>De una secuencia de n tokens se corrompen round(0.15·n), en round(n<sub>ruido</sub> / 3) tramos (largo medio 3). Los largos de los tramos se sortean, pero el total es fijo.</p>` },
            { title: 'Entrada', html: R`<p>Cada tramo corrompido se reemplaza por <b>un</b> sentinel único: &lt;extra_id_0&gt;, &lt;extra_id_1&gt;, … (en la figura, &lt;X&gt;, &lt;Y&gt;). Los sentinels son 100 tokens especiales agregados al vocabulario, sin pieza de texto asociada.</p>` },
            { title: 'Target', html: R`<p>La concatenación de los tramos, cada uno precedido por su sentinel, y &lt;/s&gt;. En el código de T5, el target pone un sentinel por cada tramo <b>limpio</b> de la entrada: si el texto termina con un tramo limpio (la Figura 2), aparece un sentinel final (&lt;Z&gt;) que marca "no hay más".</p>` },
            { title: 'Largos', html: R`<p>Para llenar exactamente ${met('spIn')} tokens de entrada se toman ${met('spRaw')} tokens de texto: ${met('spNoise')} de ruido en ${met('spSpans')} tramos; entrada ${met('spKeep')} + ${met('spSpans')} sentinels + &lt;/s&gt; = ${met('spIn')}; target ${met('spNoise')} + ${met('spSpans')} + &lt;/s&gt; = ${met('spTg')} (la cuenta de <code>random_spans_helper</code> del código de T5 y de <code>compute_input_and_target_lengths</code> de HF; verificada en la práctica). Por eso la canónica usa T<sub>out</sub> = ${cf('Tout')}. Las mismas cuentas están en la vista de span corruption del diagrama (<a href="#t5.diagrama~sc-target">objetivo del decoder</a>).</p>` },
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué tramos y sentinels, y no el MLM de BERT', html: R`<p>Tres razones medidas en el paper. (1) <b>Targets cortos</b>: el decoder escribe ≈ 114 tokens en vez de reconstruir los 512 (como haría un denoising que copia toda la entrada, el estilo BERT de la Tabla 4): es más barato de entrenar. (2) <b>Calidad</b>: entre las variantes del objetivo estilo BERT (reconstruir todo, estilo MASS, reemplazar tramos por sentinels, borrar los tokens corrompidos) "todas rinden parecido" (Tabla 5: GLUE 82.96, 82.32, 83.28 y 84.44; la última gana en GLUE por CoLA pero pierde en SuperGLUE), así que eligen una que acorta el target; y los tramos de largo medio 3 superan "ligera pero significativamente" al ruido i.i.d. en la mayoría de los benchmarks que no son de traducción (§3.3.4, Tabla 7). (3) <b>Corrupción</b>: 15 % es el punto dulce; 50 % baja claro (GLUE 81.27 contra 83.28, Tabla 6), 10 % y 25 % casi empatan.</p>` },
          { t: 'table', caption: 'Lo que midió el paper sobre el objetivo (GLUE promedio del baseline; más alto es mejor)', head: ['Ablación', 'Valores', 'Dónde'], rows: [
            ['Tasa de corrupción', '10 %: 82.82 · <b>15 %: 83.28</b> · 25 %: 83.00 · 50 %: 81.27', 'Tabla 6'],
            ['Largo medio de tramo', 'i.i.d.: 83.28 · 2: 83.54 · <b>3: 83.49</b> · 5: 83.40 · 10: 82.85', 'Tabla 7 (eligen 3 mirando todos los benchmarks, no solo GLUE)'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Span corruption es MLM con tramos"', html: R`<p>Se parecen en qué se tapa, no en qué se predice. En BERT, la salida está alineada con la entrada (una predicción por posición tapada, en su lugar) y el modelo es solo encoder. En T5, la salida es una <b>secuencia nueva</b> que escribe un decoder: los tramos, con sentinels que indican a qué hueco va cada uno. Por eso un tramo de largo variable no es problema (el decoder decide cuántos tokens escribe) y por eso el mismo modelo, sin cambiar nada, después genera traducciones o resúmenes.</p>` },
          { t: 'h3', text: 'Datos y receta' },
          { t: 'table', caption: 'T5 (§2.2, §3.1, §3.7)', head: ['Qué', 'Valor', 'Dónde'], rows: [
            ['Corpus', R`<b>C4</b> (Colossal Clean Crawled Corpus): Common Crawl de abril de 2019 filtrado a ≈ 750 GB de inglés. Filtros: líneas que terminan en puntuación, páginas de al menos 3 oraciones, sin palabras de una lista de malas palabras, sin "Javascript" ni el relleno «lorem» de las plantillas, sin llaves { } (para sacar código), deduplicado de tramos de 3 oraciones, y langdetect inglés ≥ 0.99`, '§2.2'],
            ['Vocabulario', 'SentencePiece de 32,000 piezas, entrenado sobre C4 mezclado con alemán, francés y rumano (10 partes de inglés por 1 de cada uno) para poder traducir', '§3.1'],
            ['Baseline de los experimentos', R`Batch de 128 secuencias × 512 tokens = 2<sup>16</sup> tokens; 2<sup>19</sup> pasos ≈ 2<sup>35</sup> ≈ 34B tokens. Adafactor (${ADAF}), learning rate 1/√max(n, k) con k = 10<sup>4</sup> (constante 0.01 los primeros 10<sup>4</sup> pasos)`, '§3.1'],
            ['Fine-tuning del baseline', '2<sup>18</sup> pasos, batch de 128, learning rate constante 0.001; dropout 0.1', '§3.1'],
            ['Modelos finales', R`1 millón de pasos con batch de 2<sup>11</sup> secuencias de 512: ≈ 1 billón (10<sup>12</sup>) de tokens de preentrenamiento, con preentrenamiento <b>multitarea</b> (span corruption mezclado con las tareas supervisadas) y fine-tuning por tarea`, '§3.7'],
            ['Decodificado', 'Greedy en los experimentos; beam search de ancho 4 con length penalty α = 0.6 en los resultados finales de WMT y CNN/DM', '§3.7'],
            ['Tamaños', 'Small ≈ 60M (6 + 6 capas, D = 512, 8 cabezas), Base ≈ 220M, Large ≈ 770M (24 + 24, D = 1,024, 16 cabezas), 3B (D<sub>ff</sub> = 16,384, 32 cabezas de d<sub>kv</sub> = 128) y 11B (D<sub>ff</sub> = 65,536, 128 cabezas). 3B y 11B mantienen D = 1,024 y escalan D<sub>ff</sub> y las cabezas, porque los TPU rinden mejor con matmuls densos grandes', '§3.7'],
          ] },
          { t: 'callout', kind: 'note', html: R`<p>Resultados del paper para T5-11B (Tabla 14, test salvo SQuAD): GLUE 90.3, SuperGLUE 88.9, SQuAD (validación) EM 91.26 y F1 96.22; estado del arte en 18 de 24 tareas al publicarse. Son números de 2019: sirven para fechar el modelo, no para compararlo con un LLM actual.</p>` },
          { t: 'h3', text: 'T5 v1.1 y Flan-T5: lo que vas a descargar' },
          { t: 'table', head: ['Cambio', 'T5 (2019)', 'T5 v1.1', 'Flan-T5 (2022)'], rows: [
            ['FFN', 'ReLU, D<sub>ff</sub> = 4D en base', R`GEGLU; en base D<sub>ff</sub> = ${cf('Dff', CF)} (mismos parámetros)`, 'Igual que v1.1'],
            ['Salida', 'Atada a la tabla, con D<sup>−½</sup>', 'Matriz propia, sin reescalado', 'Igual que v1.1'],
            ['Datos de preentrenamiento', 'C4 + tareas supervisadas mezcladas (multitarea)', 'Solo C4, sin tareas', 'Parte de T5 v1.1 (sus filas de comparación son T5 adaptado a LM: +100B tokens de C4 con objetivo de LM)'],
            ['Dropout en preentrenamiento', '0.1', 'Apagado ("quality win"); se vuelve a prender para el fine-tuning', '—'],
            ['Tamaños grandes', '3B, 11B', '"xl" y "xxl", con D más grande y menos cabezas y D<sub>ff</sub>', '80M, 250M, 780M, 3B, 11B'],
            ['Ajuste por instrucciones', 'No', 'No', R`Sí: 1,836 tareas (Muffin, T0-SF, NIV2 y 9 datasets de chain-of-thought)`],
          ], note: R`Fuentes: ${V11}; ${FLAN}, Tabla 5 y §5.` },
          { t: 'p', html: R`El efecto del instruction tuning en el mismo modelo (${FLAN}, Tabla 5, MMLU directo 5-shot): T5-base adaptado a LM 25.7 → Flan-T5-base 35.9; T5-XXL 25.9 → Flan-T5-XXL 55.1. Es decir, el T5 crudo está en el azar de 4 opciones (25 %) en MMLU: sabe rellenar tramos, no responder preguntas. Por eso, hoy, el punto de partida de un proyecto con T5 es Flan-T5.` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los números de GLUE/SuperGLUE, los filtros exactos de C4 y la mezcla de Flan. Lo que no te puedes saltar: text-to-text con prefijos, span corruption (15 %, largo medio 3, sentinels, targets cortos), la Tabla 2 (encoder-decoder vs decoder-only a igual costo), y que Flan-T5 es T5 v1.1 con instruction tuning.</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Dos fases, como el prefill y el decode de un <a href="#llm-inferencia">LLM</a>, pero con una diferencia: el "prefill" es el <b>encoder</b> y no deja un KV cache que crece, sino un <b>cross KV cache fijo</b> por capa del decoder.` },
          { t: 'steps', items: [
            { title: 'Encoder (una vez)', html: R`<p>La entrada entera en paralelo: ${met('encMacs')} a T<sub>in</sub> = ${cf('Tin')}. Limitado por cómputo con batch razonable, como cualquier prefill.</p>` },
            { title: 'Cross K y V (una vez)', html: R`<p>Cada capa del decoder proyecta enc-out a K y V: ${met('crossKvMacs')} y ${met('crossKv')} de memoria en bf16 por secuencia. No cambian durante la generación.</p>` },
            { title: 'Decode (por token)', html: R`<p>Un token por paso: self-attention contra el KV cache de la salida (crece ${met('kvTok')} por token), cross-attention contra el cross KV cache fijo, FFN y proyección al vocabulario: ${met('decTok')} por token. Como en un LLM, con batch chico este paso está limitado por memoria (leer los pesos del decoder y los caches), no por cómputo.</p>` },
            { title: 'Parar', html: R`<p>Hasta &lt;/s&gt; o el largo máximo. Greedy, beam search (el paper usó ancho 4 y α = 0.6 en traducción y resumen) o muestreo.</p>` },
          ] },
          { t: 'table', caption: 'Qué ocupa memoria al servir T5-base (por secuencia, bf16; calculador)', head: ['Qué', 'Tamaño', 'Crece con'], rows: [
            ['Pesos', R`${qn('params.total')} parámetros × 2 bytes = ${met('w')}`, 'Nada'],
            ['Cross KV cache', met('crossKv'), 'T<sub>in</sub> (fijo durante la generación)'],
            ['Self KV cache al terminar', met('selfKv'), 'T<sub>out</sub> (crece token a token)'],
          ] },
          { t: 'table', caption: 'Trucos de inferencia y qué ganan', head: ['Truco', 'Qué hace', 'Cuándo'], rows: [
            ['Cachear el cross KV', 'Proyectar K y V del encoder una vez, no en cada paso (HF lo hace con <code>EncoderDecoderCache</code>)', 'Siempre; recalcularlo es el bug clásico de una implementación propia'],
            ['Batching de entradas de largo distinto', 'Padding en el encoder con máscara; en el decoder, continuous batching como en un LLM', 'Servicios con mucho tráfico'],
            ['Beam search vs greedy', 'Beam (4) mejora BLEU/ROUGE en traducción y resumen a ≈ 4× el costo del decode', 'Tareas de una respuesta correcta; greedy para extracción'],
            ['bf16, no fp16', 'T5 se entrenó en bf16 en TPU: en fp16 algunas activaciones desbordan (inf/NaN)', 'Siempre que corras T5 original o v1.1 en GPU'],
            ['Destilar o usar uno más chico', 'Flan-T5-base o -large ajustado a tu tarea suele alcanzar', 'Latencia o costo por request'],
            ['Speculative decoding', R`T5-small como borrador de T5-XXL: 2.6–3.4× en el paper de Leviathan et al. (detalle en <a href="#llm-inferencia">LLM: inferencia</a>)`, 'Decoder grande, salidas largas'],
          ] },
          { t: 'callout', kind: 'senior', html: R`<p>Una cuenta de servilleta (cota de roofline del calculador en una H100, batch 1, sin overheads): el encoder sobre ${cf('Tin')} tokens, ${est(met('encMs') + ' ms')}, limitado por cómputo; un paso de decoder, ${est(met('stepMs') + ' ms')}, limitado por memoria (lee ≈ 0.25 GB de pesos del decoder y de la tabla en bf16, más los caches); los ${cf('Tout')} pasos, ${est(met('decMs') + ' ms')}. En la práctica, el overhead de lanzar kernels con batch 1 en PyTorch lleva cada paso a ${est('varios ms')}. Conclusión: la palanca es el decoder (batch, salidas cortas, menos pasos con beam chico o speculative decoding), no acelerar el encoder. Mide con tu hardware.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>El checkpoint sin instruction tuning no sigue instrucciones.</b> T5 v1.1 (que no vio ninguna tarea) solo aprendió a rellenar tramos: pídele "summarize:" sin fine-tuning y puede devolver sentinels o texto sin sentido. El T5 original vio las tareas del paper mezcladas en el preentrenamiento y responde a <b>esos</b> prefijos, pero no a instrucciones nuevas. En MMLU, T5 está en el azar (25.7 en base, ${FLAN}, Tabla 5). Arreglo: Flan-T5 o fine-tuning.`,
            R`<b>Desborde en fp16.</b> Las activaciones de la FFN crecen mucho en algunas capas; en fp16 (máximo ≈ 65,504) aparecen inf y NaN, sobre todo en los modelos grandes y en v1.1. T5 se entrenó en bf16 (mismo rango que fp32). Arreglo: bf16 o fp32; HF agrega un clamp en fp16 como parche.`,
            R`<b>Largo del preentrenamiento.</b> Entrenado con 512 tokens de entrada (y targets de 114): las posiciones relativas no imponen un límite duro, pero más allá de lo visto la calidad cae y la atención del encoder es cuadrática. Para documentos largos: trocear y resumir por partes, o LongT5 (${LONGT5}).`,
            R`<b>Vocabulario y datos sesgados.</b> El vocabulario de 32,000 piezas se entrenó sobre inglés con algo de alemán, francés y rumano; C4 quitó las páginas con llaves { } (código). Español, código y texto con caracteres raros se tokenizan peor (más piezas, a veces &lt;unk&gt;): mide la fertilidad o usa mT5/ByT5.`,
            R`<b>Alucinación en resumen.</b> Como todo generador, puede escribir hechos que no están en la entrada aunque la cross-attention la "vea". Mitigación: beam search conservador, restricciones de decodificado, verificación de consistencia contra la entrada.`,
          ] },
          { t: 'table', caption: 'T5 frente a sus alternativas (filas = criterios)', head: ['Criterio', 'T5-base / Flan-T5-base', 'BERT-base', 'Decoder-only del mismo tamaño (GPT-2 medium ≈ 355M)', 'LLM decoder 7–8B'], rows: [
            ['Parámetros', R`${qn('params.total')} / ${qn('params.total', CF)}`, '≈ 110M', '≈ 355M', '≈ 7,000–8,000M'],
            ['Entrada → salida', 'Texto → texto', 'Texto → un vector por token (+ cabeza)', 'Texto → continuación', 'Texto → continuación (chat)'],
            ['Costo de leer la entrada', 'Una pasada por el encoder (L capas)', 'Una pasada (L capas)', 'Prefill por todas las capas', 'Prefill por todas las capas'],
            ['Costo por token generado', 'Decoder (L capas + cross)', 'No genera', 'Todas las capas', 'Todas las capas'],
            ['KV cache', 'Self (crece) + cross (fijo)', '—', 'Crece con entrada + salida', 'Crece con entrada + salida'],
            ['Seguir instrucciones sin ajustar', 'Flan-T5 sí, T5 no', 'No', 'Pobre', 'Sí (si es instruct)'],
            ['Cuándo', 'Seq2seq con datos: traducir, resumir, extraer; encoder de texto', 'Clasificar, etiquetar, buscar', 'Rara vez hoy', 'Tareas abiertas, chat, pocos datos'],
          ], note: R`Parámetros de T5 del calculador; el resto, de sus papers o model cards (aproximados).` },
          { t: 'callout', kind: 'senior', html: R`<p>Cómo decidirlo en una entrevista: "If I have a fixed seq2seq task with labeled data and real volume, like summarizing support tickets or extracting fields to JSON, I fine-tune Flan-T5 base or large: the input goes through the encoder once, the decoder is half the model, and it costs a fraction of serving a seven-billion LLM. If the task is open-ended, needs long instructions or few-shot prompting, or I have no data, I use a decoder-only LLM, and I may use it to label data for the smaller model."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Cuándo lo mencionas'], rows: [
            [R`Transformer original (${VASWANI})`, 'El encoder-decoder de partida: posiciones senoidales, post-LN, ReLU. T5 cambia la norma, las posiciones y comparte la tabla.', 'Para decir de dónde viene T5'],
            [R`BART (${BART})`, 'Encoder-decoder contemporáneo: corrompe con varios ruidos (text infilling con un [MASK] por tramo, permutar oraciones) y reconstruye el texto <b>entero</b>; posiciones aprendidas, GELU, post-LN.', 'La alternativa a T5 para resumir'],
            [R`T5 v1.1 (${V11})`, 'GEGLU, sin dropout en preentrenamiento, solo C4, salida sin atar, tamaños "xl" y "xxl".', 'Si descargas T5 hoy, es esto'],
            [R`mT5 (${MT5})`, 'T5 v1.1 multilingüe: 101 idiomas (mC4) y un vocabulario de 250,000 piezas.', 'Texto en español'],
            [R`ByT5 (${BYT5})`, 'Sin tokenizador: bytes UTF-8 como tokens; encoder 3× más profundo que el decoder. Más robusto a errores de tipeo, secuencias más largas.', 'Ruido, idiomas raros'],
            [R`Flan-T5 (${FLAN})`, 'T5 v1.1 ajustado con 1,836 tareas con instrucciones (y chain-of-thought).', 'El punto de partida práctico'],
            [R`UL2 (${UL2})`, 'Mezcla de denoisers (spans cortos, spans largos o corrupción fuerte, y prefix LM) con un token de "modo"; 20B encoder-decoder.', 'Objetivos de preentrenamiento'],
            [R`Switch Transformer (${SWITCH})`, 'T5 con FFN de mixture of experts (un experto por token); entrenado sobre la base de T5.', R`MoE (<a href="#llm-inferencia">LLM: inferencia</a>)`],
            [R`LongT5 (${LONGT5})`, 'Atención local + "transient global" en el encoder para entradas de miles de tokens; objetivo estilo PEGASUS.', 'Documentos largos'],
            [R`Sentence-T5 (${ST5})`, 'Solo el encoder de T5 con mean pooling, ajustado con pares contrastivos: embeddings de frase (GTR, del mismo grupo, lo escala para retrieval).', R`<a href="#retrieval">Retrieval</a>`],
            [R`Encoder de T5-XXL en difusión (${IMAGEN})`, 'Imagen condiciona con el encoder congelado de T5-XXL y encontró que escalar el text encoder mejora más que escalar la U-Net; SD3 y Flux también lo usan.', R`<a href="#stable-diffusion">Stable Diffusion</a>, <a href="#dit">DiT</a>`],
            [R`<a href="#whisper">Whisper</a>`, 'El mismo esqueleto encoder-decoder con un encoder de espectrograma; hermano, no descendiente (ni span corruption ni posiciones relativas).', 'Audio → texto'],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`T5 aparece como pregunta de arquitectura ("¿qué es la cross-attention y qué se cachea?"), como pregunta de diseño ("¿encoder-decoder o decoder-only para este producto?") y como pregunta de objetivos ("¿span corruption o MLM?"). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Walk me through the T5 architecture. How is it different from BERT and from GPT?',
              junior: 'Es un transformer grande de Google que hace muchas tareas.',
              senior: R`Encoder-decoder. El encoder es un BERT pre-norm: ${cf('L')} capas bidireccionales sobre la entrada. El decoder es un GPT de ${cf('Ld')} capas con una cross-attention extra por capa: Q de la salida, K y V de la salida del encoder. Diferencias de detalle: RMSNorm sin bias antes de cada sub-bloque, sesgo de posición relativa por buckets (${cf('nb')} buckets, compartido entre capas, sin posiciones absolutas), tabla de embeddings compartida por las dos pilas y la salida, sin biases en las lineales. Frente a BERT: genera. Frente a GPT: la entrada se procesa con atención bidireccional y una sola vez, y el decoder solo procesa la salida.`,
              say: 'T5 is an encoder-decoder transformer: a bidirectional pre-norm encoder over the input and a causal decoder over the output, with cross-attention in every decoder layer where queries come from the decoder and keys and values from the encoder output. It uses relative position buckets shared across layers, RMS-style layer norm without bias, and one shared embedding table.',
              why: 'La de entrada. Se anota de dónde salen Q, K y V en la cross-attention y los detalles (norma, posiciones, tabla compartida).' },
            { q: 'Explain span corruption. Why not just use BERT-style masked language modeling?',
              junior: 'Tapa palabras como BERT.',
              senior: R`Se corrompe el 15 % de los tokens en tramos de largo medio 3; cada tramo se reemplaza en la entrada por un sentinel único, y el target del decoder es solo la lista de tramos, cada uno detrás de su sentinel. Ventajas medidas: targets cortos (para 512 tokens de entrada, 114 de target) y por eso entrenar es más barato que reconstruir todo, con calidad equivalente a las otras variantes de denoising (Tabla 5: "all of these variants perform similarly") y algo mejor que el ruido i.i.d. con tramos de largo medio 3 (Tabla 7). Y encaja con text-to-text: es una tarea de generación, así que el mismo decoder después traduce o resume. La corrupción de 50 % baja la calidad; 10–25 % casi empatan (Tabla 6).`,
              say: 'Fifteen percent of the tokens are corrupted in spans of mean length three; each span becomes a single sentinel token in the input, and the decoder outputs only the dropped spans, each after its sentinel. Targets are short, so pretraining is cheaper than reconstructing the whole input, quality matches or beats per-token masking, and it is already a generation task.',
              why: 'Se anota "un sentinel por tramo", que el target es solo lo que falta y por qué es más barato.' },
            { q: 'In cross-attention, where do Q, K and V come from, what are the shapes, and what do you cache during generation?',
              junior: 'Q, K y V salen del decoder, como en la self-attention.',
              senior: R`Q de los estados del decoder (T<sub>out</sub>×D, o 1×D por paso en generación); K y V de la salida del encoder, con proyecciones propias de cada capa (T<sub>in</sub>×D). Scores por cabeza: T<sub>out</sub>×T<sub>in</sub> (${sh('crossScores')} en la canónica), sin máscara causal ni sesgo de posición. Se cachean dos cosas: (1) el self KV cache del decoder, que crece un token por paso (${met('kvTok')} por token); (2) el cross KV cache: K y V del encoder por capa, calculados <b>una vez</b> antes del primer paso (${met('crossKv')} a T<sub>in</sub> = ${cf('Tin')}) y fijos. Recalcularlos en cada paso es el bug clásico: multiplica por T<sub>out</sub> un costo de ${met('crossKvMacs')}.`,
              say: 'Queries come from the decoder states, keys and values from the encoder output through each layer\'s own projections, so the score matrix is output length by input length, with no causal mask. During generation I cache the decoder self-attention keys and values, which grow by one token per step, and the cross-attention keys and values, which are computed once from the encoder output and never change.',
              why: 'Trampa: "Q, K, V del decoder" o recalcular el cross KV en cada paso. Se anota la forma rectangular y los dos caches.', trap: true },
            { q: 'Count the parameters of T5-base. Why is it twice BERT-base with the same width?',
              junior: 'Unos 220M, porque es más grande.',
              senior: R`Tabla compartida V·D = ${met('emb')} (${met('embShare')}). Encoder: ${cf('L')} capas de ≈ 12·D² (atención 4D², FFN 8D², sin biases): ${met('enc')}. Decoder: ${cf('Ld')} capas de ≈ 16·D² porque suman la cross-attention (4D²): ${met('dec')}; las cross-attention son ${met('cross')} en total. Sesgo relativo: ${met('rel')}. Salida atada: 0. Total ${qn('params.total')}. Es ≈ 2× BERT-base porque son dos pilas de 12 capas; pero cada token pasa por una sola pila, así que el cómputo por token es el de un modelo de 12 capas: el paper lo resume como "2P parámetros, costo M" (Tabla 2).`,
              say: 'About twenty-five million in the shared embedding table, about eighty-five million in the twelve encoder layers at roughly twelve d-squared each, and about one hundred thirteen million in the decoder, whose layers also carry cross-attention. The output projection is tied. It is twice BERT-base in parameters, but each token only goes through one of the two stacks.',
              why: 'Se anota 12D² vs 16D² por capa, la tabla compartida y la distinción parámetros vs cómputo.' },
            { q: 'Encoder-decoder or decoder-only: which would you choose today, and why did the field converge on decoder-only?',
              junior: 'Decoder-only, porque es lo que usa GPT.',
              senior: R`Depende del problema. A igual cómputo, T5 midió que el encoder-decoder con denoising gana a un decoder-only (GLUE 83.28 vs 74.70; con prefix LM 81.82, Tabla 2), y ${WANG} encontró que, tras ajuste multitarea, un modelo no causal con MLM es lo mejor en zero-shot, mientras que sin ajuste gana el decoder causal con LM. El decoder-only ganó por otras razones: una sola pila que escala simple, el mismo objetivo (siguiente token) para preentrenar, ajustar y hacer in-context learning, un solo KV cache con prompt y respuesta mezclados (chat de varios turnos, prefix caching), y un ecosistema de serving construido para él. Elijo encoder-decoder para seq2seq fijo con datos y entradas largas con salidas cortas (traducción, resumen, ASR con <a href="#whisper">Whisper</a>, extracción), o como text encoder; decoder-only para tareas abiertas, chat, agentes y pocos datos.`,
              say: 'At equal compute, T5 found the encoder-decoder with a denoising objective beats a decoder-only language model, and it remains a great choice for fixed sequence-to-sequence tasks with long inputs and short outputs. Decoder-only won for general models because a single stack with a single objective scales simply, supports in-context learning and multi-turn chat with one KV cache, and the serving ecosystem is built for it.',
              why: 'Trampa: responder por moda. Se anota la Tabla 2, el resultado de Wang et al. y las razones de producto e infraestructura.', trap: true },
            { q: 'Compare the cost of summarizing a 512-token document into 64 tokens with T5-base versus a decoder-only model of the same parameter count.',
              junior: 'Cuestan lo mismo porque tienen los mismos parámetros.',
              senior: R`Con los mismos parámetros, un decoder-only de D = ${cf('D')} tendría ${est('≈ 28 capas')} (los ≈ 198M que no son tabla divididos por 12·D²). T5-base: la entrada pasa por ${cf('L')} capas (encoder) y cada token generado por ${cf('Ld')} capas de decoder (más anchas, ≈ 16·D², por la cross-attention). Decoder-only: los 512 tokens pasan por las 28 capas (prefill) y cada token generado también. O sea, ${est('≈ 2.3×')} el costo de leer la entrada y ${est('≈ 1.75×')} por token generado (28·12D² frente a 12·16D², sin contar atención ni la proyección al vocabulario), y un KV cache con 28 capas por cada token de entrada y de salida, frente a 12 capas de cross (entrada) + 12 de self (salida). Con el calculador: encoder ${met('encMacs')}, ${met('decTok')} por token generado. El costo de T5 es asimétrico a favor de entradas largas y salidas cortas.`,
              say: 'With equal parameters the decoder-only model has more than twice the layers, so every input token goes through twice as many layers during prefill and every output token goes through all of them; T5 sends the input through the encoder only and each output token through the decoder only. For long inputs and short outputs that is roughly half the prefill cost and a smaller per-token step.',
              why: 'Trampa: igualar parámetros con cómputo. Se anota el conteo de capas por token y el KV cache.', trap: true },
            { q: 'How do T5\'s relative position buckets work, and how do they compare with RoPE and learned absolute positions?',
              junior: 'Es como el positional encoding del Transformer.',
              senior: R`Cada cabeza aprende un escalar por bucket (${cf('nb')} buckets) que se suma al score q·k según el bucket de j − i. La mitad de los buckets son distancias exactas cortas y la otra mitad crece en escala log hasta ${cf('md')}; más lejos, todo comparte el último. En el encoder se separan izquierda y derecha; en el decoder solo izquierda. La tabla se comparte entre todas las capas de una pila (n<sub>b</sub>·h = ${cf('nb')}·${cf('h')} parámetros por pila) y la cross-attention no lleva. Frente a posiciones absolutas: no hay límite duro de largo y la señal es de distancia, no de índice. Frente a RoPE: RoPE codifica la distancia en la rotación de q y k (con resolución fina en todas las distancias); T5 suma un sesgo escalar con resolución gruesa lejos. Costo práctico de T5: el sesgo T×T no es compatible con todos los kernels de FlashAttention.`,
              say: 'Each head learns one scalar per bucket of the relative distance, added to the attention logits; buckets are exact for small distances and logarithmic up to one hundred twenty-eight, the table is shared across layers, and there is no absolute position embedding. Unlike RoPE, it adds a bias rather than rotating queries and keys.',
              why: 'Se anota escalar por bucket y cabeza, log, compartido entre capas, sin bias en la cross-attention.' },
            { q: 'Why does T5 attention not divide by the square root of d_kv, and what breaks if you add it?',
              junior: 'Seguro sí divide, todas lo hacen.',
              senior: R`Mesh TensorFlow plegó el factor en la inicialización de W<sub>Q</sub> (desviación estándar escalada por (D·d<sub>kv</sub>)<sup>−½</sup>), así que los pesos entrenados ya producen scores en la escala correcta. HF lo refleja con <code>scaling = 1.0</code>. Si reimplementas y divides por √${cf('dkv')} = 8, cargas los pesos sin error y el softmax queda 8× más plano en los logits: la atención pierde nitidez y el modelo degrada mucho. Es un ejemplo de por qué un port se valida comparando salidas contra la referencia, no solo formas.`,
              say: 'The scaling factor was folded into the query weight initialization in Mesh TensorFlow, so the pretrained weights expect unscaled dot products. Adding the usual one over square root of d_kv makes every attention distribution much flatter and silently breaks the model.',
              why: 'Trampa de quien reimplementó. Se anota que está en la inicialización y que se valida con salidas.', trap: true },
            { q: 'You need to serve Flan-T5-large for summarization at high throughput. How do you design it?',
              junior: 'Lo pongo en una GPU con HF generate.',
              senior: R`Separar las dos fases. (1) Encoder: batch grande y padding por bucket de largo; es compute-bound. (2) Cross KV: calcularlo una vez por request y guardarlo junto al self KV cache; su tamaño depende de T<sub>in</sub> y no crece, lo que hace la reserva de memoria predecible. (3) Decode: continuous batching (TensorRT-LLM tiene soporte encoder-decoder para T5 y BART; verifica el de tu servidor), bf16 (no fp16: T5 desborda), beam 4 solo si la métrica lo justifica (≈ 4× el decode) y límite de T<sub>out</sub>. (4) Cuantizar pesos a int8 si el decode está limitado por memoria. (5) Métricas: p50/p99 de latencia total y por token, tokens/s por GPU, y ROUGE o una evaluación de consistencia en un set fijo. Antes de todo: verificar si Flan-T5-base ajustado alcanza la calidad; es 3× más barato.`,
              say: 'I separate encode and decode: batch the encoder by length, compute the cross-attention keys and values once per request and keep them with the self-attention cache, run decode with continuous batching in bf16, use beam search only if quality needs it, and quantize weights if decode is memory-bound. I measure latency per token and end to end, and first check whether a fine-tuned smaller model is good enough.',
              why: 'Se anota el cross KV, bf16, continuous batching, el costo del beam y medir.' },
            { q: 'What changed in T5 v1.1 and Flan-T5, and which checkpoint would you fine-tune?',
              junior: 'Son versiones más nuevas, mejores.',
              senior: R`v1.1: FFN GEGLU (en base, D<sub>ff</sub> ${cf('Dff', CF)} en vez de ${cf('Dff')}, con los mismos parámetros porque 3·D·${cf('Dff', CF)} = 2·D·${cf('Dff')}), salida sin atar (${qn('params.total', CF)} en base), sin dropout en preentrenamiento, solo C4 (sin tareas mezcladas). Flan-T5: v1.1 ajustado con 1,836 tareas con instrucciones y chain-of-thought; MMLU de base pasa de 25.7 a 35.9 y de XXL de 25.9 a 55.1 (${FLAN}, Tabla 5). Ajusto Flan-T5: parte de un modelo que ya entiende instrucciones, converge más rápido y rinde mejor con pocos datos. Ojo con el dropout: v1.1 lo trae apagado; para fine-tuning conviene prenderlo.`,
              say: 'T5 version one point one switched to a gated-GELU feed-forward, untied the output projection, turned off dropout in pretraining and trained only on C4. Flan-T5 instruction-tunes that model on about eighteen hundred tasks, which lifts MMLU from chance level to over fifty percent at the largest size. I would fine-tune Flan-T5.',
              why: 'Se anota GEGLU con los mismos parámetros, salida sin atar, Flan y la Tabla 5.' },
            { q: 'Your fine-tuned T5 gives NaN losses in fp16 mixed precision. What is going on?',
              junior: 'El learning rate es muy alto.',
              senior: R`Probablemente desborde: T5 se preentrenó en bf16 en TPU, y algunas activaciones (salida de la FFN en ciertas capas) superan el máximo de fp16 (≈ 65,504) → inf → NaN. Pasa sobre todo en T5 grandes y v1.1/Flan. Arreglos: entrenar en bf16 (A100/H100) o fp32; si estás en una GPU sin bf16, mantener la FFN en fp32 o usar el clamp de HF. Diagnóstico: hooks que registren el máximo absoluto de las activaciones por capa; si una se acerca a 6·10⁴, es esto. Antes de culpar al LR, confirma que el mismo batch en fp32 da una pérdida finita.`,
              say: 'T5 was trained in bfloat16 and some feed-forward activations exceed the float16 range, so they overflow to infinity and the loss becomes NaN. I would switch to bfloat16 or float32, keep the feed-forward in float32, and confirm by logging per-layer activation maxima.',
              why: 'Trampa: culpar al learning rate. Se anota bf16 vs fp16 y cómo diagnosticarlo.', trap: true },
            { q: 'How does text-to-text handle classification and regression, and what can go wrong?',
              junior: 'Le agrega una cabeza de clasificación.',
              senior: R`Sin cabezas: la etiqueta es texto ("entailment", "not acceptable") y la regresión se discretiza (STS-B: múltiplos de 0.2 escritos como texto). Pros: un solo modelo y una sola pérdida para todo, multitarea trivial, etiquetas con nombre que el modelo ya "entiende". Contras: (1) puede generar algo fuera del conjunto de etiquetas (el paper lo cuenta como error; con modelos entrenados no lo vio, pero con pocos datos pasa): se arregla con decodificado restringido o puntuando cada etiqueta por log-verosimilitud; (2) las probabilidades de clase no salen directas: hay que puntuar cada etiqueta; (3) cuesta un decode por ejemplo, frente a una lineal en BERT. Para producción de alto volumen de clasificación pura, un encoder con cabeza suele ser más barato.`,
              say: 'Labels are generated as text, and regression is discretized, for example STS-B scores rounded to multiples of zero point two. It unifies training, but the model can emit an invalid label, class probabilities require scoring each label, and decoding costs more than a linear head, so I constrain decoding or rank labels by likelihood.',
              why: 'Se anota la discretización, las etiquetas inválidas y cómo obtener probabilidades.' },
            { q: 'Why do text-to-image models use the T5 encoder instead of a CLIP text encoder or a decoder LLM?',
              junior: 'Porque T5 es mejor.',
              senior: R`Necesitan un vector por token con contexto de los dos lados (para la cross-attention de la U-Net o del DiT), y un encoder bidireccional entrenado sobre mucho texto los da. Imagen (${IMAGEN}) congeló el encoder de T5-XXL y encontró que escalar el text encoder mejoraba fidelidad y alineamiento con el texto más que escalar la U-Net. CLIP entiende mejor lo visual pero su text encoder es chico, causal y con 77 tokens; por eso SD3 combina CLIP y T5-XXL. Un decoder-only también sirve (hay modelos que usan sus estados ocultos), pero cada token solo ve la izquierda. Solo se usa el encoder: el decoder de T5 se descarta.`,
              say: 'Diffusion models need contextual per-token embeddings for cross-attention, and the T5 encoder gives bidirectional ones trained on lots of text; Imagen showed that scaling the frozen T5 text encoder helps more than scaling the U-Net. CLIP\'s text encoder is small and limited to seventy-seven tokens, so models like SD3 combine both.',
              why: 'Se anota bidireccional, el hallazgo de Imagen y que solo se usa el encoder.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuánto ocupa el cross KV cache de un batch de 32 entradas de 512 tokens en T5-base, en bf16?',
              a: R`Por token de entrada: 2 (K y V) × ${cf('Ld')} capas × ${cf('D')} × 2 bytes. Por secuencia de T<sub>in</sub> = ${cf('Tin')} el calculador da ${met('crossKv')}; para 32 secuencias, ×32: ${est('≈ 604 MB')}. Es fijo durante toda la generación: se reserva una vez al empezar.` },
            { q: 'Generas con T5 en tu propio código y el costo por token crece con el largo de la entrada mucho más de lo esperado. ¿Qué revisas?',
              a: R`Que el cross KV se calcule una vez y se reutilice: si cada paso vuelve a proyectar enc-out con W<sub>K</sub> y W<sub>V</sub>, pagas ${met('crossKvMacs')} por token generado en vez de una vez. Lo esperable es que solo la parte de atención de la cross-attention (1 query contra T<sub>in</sub> keys) crezca con T<sub>in</sub>. También: que el encoder no se vuelva a correr en cada paso (bug común al llamar <code>model(...)</code> en un loop sin pasar <code>encoder_outputs</code>).` },
            { q: 'Un T5 v1.1 base (google/t5-v1_1-base) sin fine-tuning devuelve "&lt;extra_id_0&gt; the &lt;extra_id_1&gt;" cuando le pides "summarize: …". ¿Está roto?',
              a: 'No: hace lo único que aprendió en el preentrenamiento de v1.1 (solo span corruption sobre C4): rellenar tramos. El T5 original vio tareas mezcladas y responde algo mejor a los prefijos del paper, pero sin fine-tuning ninguno es un modelo de instrucciones. Usa Flan-T5 o ajusta.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (los calcula el calculador) y al final tres ejercicios verificados: span corruption a mano, las formas de la cross-attention con su cache, y el reparto de parámetros.` },
          { t: 'h3', text: 'Diagrama en blanco' },
          { t: 'blankdiagram', diagram: 't5-overview', slots: [
            { node: 'encoder', ask: 'label', hint: 'bidireccional, una vez' },
            { node: 'enc-out', ask: 'shape', tensor: T.encOut },
            { node: 'decoder', ask: 'label', hint: 'causal + cross-attention, por token' },
            { node: 'lm-head', ask: 'label', hint: 'atada a la tabla compartida' },
            { node: 'lm-head', ask: 'shape', tensor: T.logits },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 't5', pool: 'all', configs: [C, CS, CL] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Duplicas T<sub>in</sub> (${cf('Tin')} → el doble). ¿Por qué factor cambian los MACs del encoder?`, change: { Tin: 1024 }, ask: 'encoderMacs',
              explain: 'Algo más de ×2: las lineales crecen ×2 y QKᵀ y A·V ×4, que a estos largos son una parte chica.' },
            { q: 'Mismo cambio. ¿Y los MACs del decoder por token generado?', change: { Tin: 1024 }, ask: 'decoderMacsPerToken',
              explain: 'Casi nada: solo crece la parte de atención de la cross-attention (1 query contra el doble de keys); las lineales del decoder no dependen de T_in.' },
            { q: 'Mismo cambio. ¿Y el cross KV cache?', change: { Tin: 1024 }, ask: 'crossKvBytes',
              explain: '×2: guarda K y V de cada posición de la entrada en cada capa del decoder.' },
            { q: R`Duplicas T<sub>out</sub>. ¿Qué pasa con los MACs del encoder?`, change: { Tout: 228 }, ask: 'encoderMacs',
              explain: 'Nada: el encoder no ve la salida. Es la asimetría de costo.' },
            { q: R`Duplicas T<sub>out</sub>. ¿Y el self KV cache al final de la generación?`, change: { Tout: 228 }, ask: 'selfKvCacheBytes',
              explain: '×2: crece un token por paso.' },
            { q: R`Duplicas T<sub>in</sub>. ¿Qué pasa con los parámetros?`, change: { Tin: 1024 }, ask: 'params',
              explain: 'Nada: con posiciones relativas por buckets no hay tabla de posiciones que agrandar.' },
          ] },

          { t: 'h3', text: 'Ejercicio 1: span corruption a mano' },
          { t: 'p', html: R`Sin mirar la solución: (a) con la máscara de la Figura 2 ("for inviting" y "last" corrompidos), escribe la entrada y el target de "Thank you for inviting me to your party last week ."; (b) para que la entrada corrompida mida exactamente 512 tokens con densidad 0.15 y largo medio 3, ¿cuántos tokens de texto hay que tomar y cuánto mide el target? (c) escribe la función. Verificado en el venv del Atlas (Python con NumPy): (a) <code>Thank you &lt;extra_id_0&gt; me to your party &lt;extra_id_1&gt; week . &lt;/s&gt;</code> y <code>&lt;extra_id_0&gt; for inviting &lt;extra_id_1&gt; last &lt;extra_id_2&gt; &lt;/s&gt;</code>; (b) 568 tokens de texto → entrada 512, target 114 (85 tokens de ruido en 28 tramos), los mismos números que <code>compute_input_and_target_lengths</code> del ejemplo de HF; con una máscara aleatoria sobre 568 tokens, la función da exactamente 512 y 114.` },
          { t: 'code', title: 'Solución de referencia (Python)', files: [
            { name: 'span_corrupt.py', lang: 'python', code: [
              'def lengths(raw_len, noise_density=0.15, mean_span=3.0):',
              '    """Largo de inputs y targets tras corromper raw_len tokens (+1 por el </s> de cada uno)."""',
              '    n_noise = min(max(int(round(raw_len * noise_density)), 1), raw_len - 1)',
              '    n_spans = max(int(round(n_noise / mean_span)), 1)',
              '    return raw_len - n_noise + n_spans + 1, n_noise + n_spans + 1',
              '',
              '',
              'def raw_length_for(inputs_length, **kw):',
              '    """Cuantos tokens de texto tomar para que la entrada corrompida mida inputs_length."""',
              '    n = inputs_length',
              '    while lengths(n + 1, **kw)[0] <= inputs_length:',
              '        n += 1',
              '    return n, lengths(n, **kw)[1]',
              '',
              '',
              "def span_corrupt(tokens, noise_mask, sentinel=lambda k: f'<extra_id_{k}>'):",
              '    """Entrada: cada tramo de ruido -> UN sentinel. Target: cada tramo limpio -> un sentinel,',
              '    seguido del ruido que viene despues (como nonnoise_span_to_unique_sentinel de T5)."""',
              "    assert not noise_mask[0], 'T5 empieza siempre con un tramo limpio'",
              '    inp, tgt, k_in, k_tg = [], [], 0, 0',
              '    for i, (t, m) in enumerate(zip(tokens, noise_mask)):',
              '        starts = i == 0 or noise_mask[i - 1] != m',
              '        if m:',
              '            if starts:',
              '                inp.append(sentinel(k_in)); k_in += 1',
              '            tgt.append(t)',
              '        else:',
              '            if starts:',
              '                tgt.append(sentinel(k_tg)); k_tg += 1',
              '            inp.append(t)',
              "    return inp + ['</s>'], tgt + ['</s>']",
              '',
              '',
              "toks = 'Thank you for inviting me to your party last week .'.split()",
              "mask = [w in ('for', 'inviting', 'last') for w in toks]",
              'print(*map(" ".join, span_corrupt(toks, mask)), sep="\\n")',
              '# Thank you <extra_id_0> me to your party <extra_id_1> week . </s>',
              '# <extra_id_0> for inviting <extra_id_1> last <extra_id_2> </s>',
              'print(raw_length_for(512))   # (568, 114)',
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los bugs que este ejercicio atrapa', html: R`<p>(1) Un sentinel por <b>token</b> corrompido en vez de por tramo: la entrada no se acorta y el target no sabe dónde termina cada tramo. (2) Reusar el mismo sentinel para todos los tramos: el decoder no puede decir a qué hueco va cada uno. (3) Olvidar que el target pone sentinels por los tramos limpios: con una máscara que termina en ruido (la de T5) no hay sentinel final; con una que termina limpia (la Figura 2), sí. (4) Calcular la pérdida sobre la entrada como en BERT: en T5 la pérdida es sobre el target, que escribe el decoder.</p>` },

          { t: 'h3', text: 'Ejercicio 2: las formas de la cross-attention y su cache' },
          { t: 'p', html: R`Para T5-base con una entrada de 40 tokens y batch 1: (a) forma de enc-out; (b) forma de K y V de la cross-attention de una capa, por cabezas; (c) forma de K y V de la self-attention del decoder después del primer y del segundo paso de generación; (d) ¿cambian las de (b) entre pasos? Verificado con <code>T5ForConditionalGeneration</code> de HF (transformers 5.19, pesos al azar, config de t5-base): (a) 1×40×768; (b) 1×12×40×64 (B × h × T<sub>in</sub> × d<sub>kv</sub>); (c) 1×12×1×64 y 1×12×2×64; (d) no: el <code>EncoderDecoderCache</code> devuelve la cross cache de 1×12×40×64 en los dos pasos, mientras la self cache crece. Los scores de la cross-attention de un paso son, por cabeza, 1×40 (una query contra 40 keys); en el grafo de decode del calculador, con T<sub>in</sub> = ${cf('Tin')}: ${sh('crossScores', 't5-base-decode')}.` },

          { t: 'h3', text: 'Ejercicio 3: reparte los parámetros' },
          { t: 'p', html: R`Sin calculadora: tabla compartida, una capa de encoder, una de decoder, el sesgo relativo y las normas finales de T5-base (sin biases). Después compara con Flan-T5-base. Verificado contra <code>T5ForConditionalGeneration</code> en el meta device: capa de encoder 4·768² + 2·768·3,072 + 2·768 = ${met('encLayer')}; capa de decoder 8·768² + 2·768·3,072 + 3·768 = ${met('decLayer')}; sesgo 32 × 12 por pila; total ${qn('params.total')}, igual a HF. Flan-T5-base: la FFN GEGLU (3·768·2,048) tiene los mismos parámetros que la ReLU (2·768·3,072), así que Flan-T5-base (${qn('params.total', CF)}) se diferencia de T5-base exactamente en la matriz de salida sin atar, V·D.` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. Lo siguiente: <a href="#whisper">Whisper</a>, el mismo encoder-decoder con audio de entrada, donde la asimetría de costo es todavía más marcada (30 s de audio en un forward, el texto token a token).</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 't5-01', kind: 'concepto', q: '¿Qué es T5 en una línea?', a: 'Un transformer encoder-decoder que resuelve todas las tareas como texto → texto (con un prefijo de tarea), preentrenado con span corruption sobre C4.' },
      { id: 't5-02', kind: 'concepto', q: 'Span corruption: qué se tapa y qué predice el decoder.', a: '15 % de los tokens en tramos de largo medio 3; cada tramo → un sentinel único en la entrada; el target es la lista de tramos, cada uno detrás de su sentinel, y &lt;/s&gt;.' },
      { id: 't5-03', kind: 'concepto', q: '¿Por qué span corruption y no reconstruir toda la entrada?', a: 'Targets cortos (114 tokens para 512 de entrada): más barato de entrenar, con calidad equivalente a reconstruir todo (Tabla 5) y algo mejor que el ruido i.i.d. con tramos de largo medio 3 (Tabla 7).' },
      { id: 't5-04', kind: 'conteo', q: 'Largo del texto, de la entrada y del target de span corruption para 512 tokens de entrada (15 %, largo medio 3).', a: R`${met('spRaw')} tokens de texto → ${met('spNoise')} de ruido en ${met('spSpans')} tramos → entrada ${met('spIn')}, target ${met('spTg')}.` },
      { id: 't5-05', kind: 'trampa', q: '"Span corruption pone un sentinel por cada token tapado."', a: 'Uno por <b>tramo</b>: así la entrada se acorta y el decoder sabe a qué hueco va cada tramo.' },
      { id: 't5-06', kind: 'formula', q: 'Cross-attention del decoder de T5: de dónde salen Q, K y V.', a: R`\(Q = \mathrm{RMS}(Y)W_Q\) (decoder, T_out×D); \(K = \mathrm{enc}\,W_K\), \(V = \mathrm{enc}\,W_V\) (salida del encoder, T_in×D). Sin máscara causal ni sesgo de posición.` },
      { id: 't5-07', kind: 'forma', q: 'Scores de la cross-attention de T5-base en la canónica.', a: R`${sh('crossScores')}: T_out × T_in por cabeza, rectangular.` },
      { id: 't5-08', kind: 'concepto', q: '¿Qué dos caches tiene el decoder de T5 al generar?', a: 'Self KV cache (crece un token por paso) y cross KV cache (K y V del encoder por capa, calculados una vez por entrada y fijos).' },
      { id: 't5-09', kind: 'trampa', q: '"En cada paso de decode se proyecta la salida del encoder a K y V."', a: 'No: se proyecta una vez antes del primer paso y se cachea. Recalcularlo multiplica ese costo por T_out.' },
      { id: 't5-10', kind: 'conteo', q: 'Parámetros de T5-base y su reparto.', a: R`${qn('params.total')}: tabla compartida ${met('emb')}, encoder ${met('enc')}, decoder ${met('dec')} (con ${met('cross')} de cross-attention); salida atada.` },
      { id: 't5-11', kind: 'conteo', q: 'Parámetros por capa de T5-base: encoder vs decoder.', a: R`Encoder ${met('encLayer')} (≈ 12·D²); decoder ${met('decLayer')} (≈ 16·D², por la cross-attention).` },
      { id: 't5-12', kind: 'tradeoff', q: 'Encoder-decoder L + L vs decoder-only: parámetros y costo (Tabla 2 de T5).', a: 'L + L tiene ≈ los parámetros de un decoder de 2L capas (2P) pero el costo de uno de L (M): cada token pasa por una sola pila.' },
      { id: 't5-13', kind: 'conteo', q: 'Tabla 2 de T5: GLUE con denoising de encoder-decoder, prefix LM y decoder-only (igual costo).', a: '83.28, 81.82 y 74.70.' },
      { id: 't5-14', kind: 'concepto', q: 'Relative position bias de T5 en una línea.', a: 'Un escalar aprendido por cabeza y por bucket de j − i, sumado al score; 32 buckets (exactos cerca, log hasta 128), compartido entre capas; la cross-attention no lleva.' },
      { id: 't5-15', kind: 'concepto', q: 'Buckets de T5: encoder vs decoder.', a: 'Encoder (bidireccional): 16 por dirección, 8 exactos (0 … 7) y 8 logarítmicos hasta 128. Decoder (causal): los 32 a la izquierda, 16 exactos (0 … 15) y 16 logarítmicos.' },
      { id: 't5-16', kind: 'trampa', q: '"La atención de T5 escala los scores por 1/√d_kv."', a: 'No: el factor está plegado en la inicialización de W_Q (Mesh TF); HF usa scaling = 1.0. Agregarlo rompe los pesos preentrenados sin error.' },
      { id: 't5-17', kind: 'concepto', q: 'La normalización de T5.', a: 'Sin bias ni resta de la media (lo que hoy se llama RMSNorm), en la entrada de cada sub-bloque (pre-norm), más una norma final por pila.' },
      { id: 't5-18', kind: 'concepto', q: '¿Por qué T5 multiplica por D^−½ antes de la proyección de salida?', a: 'Porque la salida usa la tabla de embeddings atada: el factor corrige la escala de los logits. v1.1 y Flan-T5 (salida sin atar) no lo hacen.' },
      { id: 't5-19', kind: 'concepto', q: 'Text-to-text: cómo hace T5 una regresión (STS-B).', a: 'Redondea el puntaje al múltiplo de 0.2 más cercano y lo genera como texto (2.57 → "2.6").' },
      { id: 't5-20', kind: 'concepto', q: 'C4 en una línea.', a: 'Common Crawl (abril 2019) filtrado a ≈ 750 GB de inglés: líneas con puntuación final, ≥ 3 oraciones, sin malas palabras, sin código (llaves), deduplicado, langdetect ≥ 0.99.' },
      { id: 't5-21', kind: 'conteo', q: 'Receta del baseline de T5.', a: 'Batch 128 × 512 tokens, 2^19 pasos (≈ 34B tokens), Adafactor, LR 1/√max(n, 10^4); fine-tuning 2^18 pasos a LR 0.001; dropout 0.1.' },
      { id: 't5-22', kind: 'conteo', q: 'Tokens de preentrenamiento de los T5 finales.', a: '1M pasos × 2^11 secuencias × 512 ≈ 1 billón (10^12) de tokens, con preentrenamiento multitarea.' },
      { id: 't5-23', kind: 'concepto', q: 'T5 v1.1: qué cambió.', a: 'GEGLU, salida sin atar, sin dropout en preentrenamiento, solo C4, tamaños xl/xxl.' },
      { id: 't5-24', kind: 'conteo', q: '¿Por qué Flan-T5-base tiene D_ff = 2,048 y no 3,072?', a: 'GEGLU tiene tres matrices: 3·D·2,048 = 2·D·3,072, los mismos parámetros que la FFN ReLU de T5.' },
      { id: 't5-25', kind: 'conteo', q: 'MMLU (5-shot directo) de T5 vs Flan-T5 en base y XXL.', a: 'Base: 25.7 → 35.9. XXL: 25.9 → 55.1 (Chung et al., Tabla 5). Sin instruction tuning, T5 está en el azar (25 %).' },
      { id: 't5-26', kind: 'trampa', q: '"Un T5 sin ajustar sigue instrucciones como un LLM."', a: 'No: v1.1 solo aprendió a rellenar tramos (puede devolver sentinels); el original, además, las tareas del paper con sus prefijos. Ninguno sigue instrucciones nuevas: usa Flan-T5 o ajústalo.' },
      { id: 't5-27', kind: 'trampa', q: '"Para ahorrar memoria corro T5 en fp16."', a: 'T5 se entrenó en bf16: en fp16 algunas activaciones de la FFN desbordan (inf/NaN). Usa bf16 o fp32.' },
      { id: 't5-28', kind: 'tradeoff', q: 'Cuándo encoder-decoder y cuándo decoder-only hoy.', a: 'Enc-dec: seq2seq fijo con datos, entrada larga y salida corta (traducir, resumir, ASR, extraer), o como text encoder. Decoder-only: chat, tareas abiertas, in-context learning, pocos datos.' },
      { id: 't5-29', kind: 'concepto', q: '¿Qué crece y qué no al duplicar T_in en T5?', a: 'Crecen el encoder (≈ ×2, más en la atención), el cross KV cache (×2) y la atención de cada paso de cross-attention. No cambian las lineales del decoder por token ni los parámetros.' },
      { id: 't5-30', kind: 'concepto', q: 'Decodificado de T5 en el paper.', a: 'Greedy en los experimentos; beam 4 con length penalty 0.6 en los resultados finales de traducción (WMT) y resumen (CNN/DM).' },
      { id: 't5-31', kind: 'concepto', q: '¿Por qué los modelos de difusión usan el encoder de T5-XXL?', a: 'Dan un vector bidireccional por token para la cross-attention; Imagen mostró que escalar el text encoder congelado ayuda más que escalar la U-Net. Solo se usa el encoder.' },
      { id: 't5-32', kind: 'concepto', q: 'T5 vs BART en una línea.', a: 'Los dos son encoder-decoder de 2019. T5: span corruption con sentinels, targets cortos, posiciones relativas. BART: varios ruidos y reconstruye el texto entero, posiciones aprendidas.' },
      { id: 't5-33', kind: 'formula', q: 'Pérdida de T5.', a: R`\(-\sum_t \log p(y_t \mid y_{\lt t}, \mathrm{enc}(\tilde{x}))\): entropía cruzada sobre los tokens del target con teacher forcing; la misma en preentrenamiento y fine-tuning.` },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'text-to-text', es: 'texto a texto', def: 'Formular toda tarea como generar un texto de salida a partir de un texto de entrada con un prefijo de tarea (T5).', say: 'T5 casts every task as text-to-text.' },
      { en: 'span corruption', es: 'corrupción de tramos', def: 'Objetivo de T5: reemplazar tramos de la entrada por sentinels y que el decoder escriba solo los tramos faltantes.', say: 'T5 is pretrained with span corruption.' },
      { en: 'sentinel token', es: 'token centinela', def: 'Token especial único (&lt;extra_id_k&gt;) que marca un tramo corrompido en la entrada y su contenido en el target.', say: 'Each dropped span is replaced by a unique sentinel token.' },
      { en: 'relative position buckets', es: 'buckets de posición relativa', def: 'Agrupación de las distancias j − i en pocos buckets (exactos cerca, logarítmicos lejos), cada uno con un sesgo escalar aprendido por cabeza.', say: 'T5 uses thirty-two relative position buckets shared across layers.' },
      { en: 'cross-attention KV cache', es: 'caché de K y V de la cross-attention', def: 'Las keys y values que cada capa del decoder proyecta desde la salida del encoder: se calculan una vez por entrada y no crecen.', say: 'The cross-attention cache is computed once per input.' },
      { en: 'GEGLU', es: 'GEGLU', def: 'FFN con compuerta: GELU(xW) ⊙ xV, y luego W_o; la de T5 v1.1 y Flan-T5.', say: 'T5 version one point one uses a GEGLU feed-forward.' },
      { en: 'C4 (Colossal Clean Crawled Corpus)', es: 'C4', def: 'El corpus de T5: ≈ 750 GB de inglés de Common Crawl filtrado con heurísticas y deduplicado.', say: 'T5 was pretrained on C4.' },
      { en: 'instruction tuning', es: 'ajuste con instrucciones', def: 'Fine-tuning multitarea con tareas escritas como instrucciones, para que el modelo siga instrucciones nuevas (Flan-T5).', say: 'Flan-T5 is the instruction-tuned T5.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
