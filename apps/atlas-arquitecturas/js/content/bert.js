/* =============================================================================
   Atlas de Arquitecturas — js/content/bert.js
   Página de modelo: BERT (Devlin et al., NAACL 2019, arXiv:1810.04805) y la corrección de RoBERTa
   (Liu et al., arXiv:1907.11692). Canónica bert-base. Plantilla fija de 11 secciones (SPEC §5.3, §23.1).
   Tesis de la fase (SPEC §23): la búsqueda es "codificar una vez, comparar rápido"; BERT da los vectores
   contextuales por token sobre los que se construyen el bi-encoder y el cross-encoder (retrieval.js).
   Regla: ningún número de la arquitectura se escribe a mano: formas, parámetros y MACs salen del calculador
   (js/arch/retrieval.js: bloques op/trace/params/flops/scaling/compare y cantidades {{config.ruta}}, SPEC §6.6).
   Resultados de papers citan sección o tabla; estimaciones con est(). Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  // Configuraciones del calculador (js/arch/retrieval.js, SPEC §23.1).
  const C = 'bert-base';
  const LG = 'bert-large';

  // Claves de metrics() y quantities del calculador: un solo lugar para adaptarlas.
  const MK = {
    emb: 'embedParams', enc: 'encoderParams', pool: 'poolerParams', mlm: 'mlmHeadParams', nsp: 'nspParams',
    embShare: 'embedParamsShare', body: 'bodyParams', layer: 'layerParams',
    macs: 'macsPerSequence', encMacs: 'encoderMacs', mlmMacs: 'mlmHeadMacs', mlmShare: 'mlmHeadMacsShare', gathered: 'mlmHeadMacsGathered',
    attn: 'attnScoreShareEncoder', cross: 'crossoverT',
    masked: 'mlmPredictions', toMask: 'mlmMaskTokens', toRand: 'mlmRandomTokens', keep: 'mlmKeptTokens',
  };
  // Ids de tensores del calculador (contrato con el diagrama bert-overview y el trace).
  const T = {
    raw: 'raw-ids', ids: 'ids', labels: 'mlm-labels', tokE: 'e-tok', emb: 'e-sum', x0: 'x0', h: 'x-out',
    cls: 'h-cls', pooled: 'pooled', mlmH: 'mlm-n', mlm: 'mlm-logits', nsp: 'nsp-logits',
  };

  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const sh = (id, cfg) => qn('tensor.' + (T[id] || id) + '.shape', cfg);
  const sy = (id, cfg) => qn('tensor.' + (T[id] || id) + '.sym', cfg);

  const PAPER = 'Devlin et al., <i>BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding</i>, NAACL 2019, arXiv:1810.04805';
  const ROBERTA = 'Liu et al., <i>RoBERTa: A Robustly Optimized BERT Pretraining Approach</i>, arXiv:1907.11692 (2019)';
  const SBERT = 'Reimers y Gurevych, <i>Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks</i>, EMNLP 2019, arXiv:1908.10084';
  const DISTIL = 'Sanh et al., <i>DistilBERT, a distilled version of BERT: smaller, faster, cheaper and lighter</i>, NeurIPS 2019 EMC² Workshop, arXiv:1910.01108';
  const ALBERT = 'Lan et al., <i>ALBERT: A Lite BERT for Self-supervised Learning of Language Representations</i>, ICLR 2020, arXiv:1909.11942';
  const ELECTRA = 'Clark et al., <i>ELECTRA: Pre-training Text Encoders as Discriminators Rather Than Generators</i>, ICLR 2020, arXiv:2003.10555';
  const DEBERTA = 'He et al., <i>DeBERTa: Decoding-enhanced BERT with Disentangled Attention</i>, ICLR 2021, arXiv:2006.03654';
  const MODERN = 'Warner et al., <i>Smarter, Better, Faster, Longer: A Modern Bidirectional Encoder for Fast, Memory Efficient, and Long Context Finetuning and Inference</i> (ModernBERT), arXiv:2412.13663 (2024)';
  const PRELN = 'Xiong et al., <i>On Layer Normalization in the Transformer Architecture</i>, ICML 2020, arXiv:2002.04745';
  const MINILM = 'Wang et al., <i>MiniLM: Deep Self-Attention Distillation for Task-Agnostic Compression of Pre-Trained Transformers</i>, NeurIPS 2020, arXiv:2002.10957';
  const XLMR = 'Conneau et al., <i>Unsupervised Cross-lingual Representation Learning at Scale</i> (XLM-R), ACL 2020, arXiv:1911.02116';
  const HANS = 'McCoy, Pavlick y Linzen, <i>Right for the Wrong Reasons: Diagnosing Syntactic Heuristics in Natural Language Inference</i>, ACL 2019, arXiv:1902.01007';
  const ANISO = 'Ethayarajh, <i>How Contextual are Contextualized Word Representations?</i>, EMNLP 2019, arXiv:1909.00512';

  ATLAS.register({
    id: 'bert',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> BERT recibe un texto de hasta ${cf('posMax')} tokens WordPiece (o dos textos pegados con un separador) y devuelve <b>un vector de ${cf('D')} números por token</b>, cada uno calculado mirando la frase entera, a la izquierda y a la derecha. No genera texto: entiende texto. Encima de esos vectores se pone una cabeza chica y se ajusta todo a la tarea (clasificar, etiquetar tokens, encontrar una respuesta en un párrafo).` },
          { t: 'p', html: R`Es un transformer <b>encoder-only</b>: el mismo bloque que ya viste en <a href="#vit">ViT</a> (de hecho, ViT copió de BERT el token [CLS] y las posiciones aprendidas), sin máscara causal. BERT-base tiene ${qn('params.total')} parámetros con las cabezas de preentrenamiento, y el paper (${PAPER}) lo hizo famoso por una receta que hoy parece obvia: <b>preentrenar una vez</b> con texto sin etiquetas (rellenar palabras tapadas) y <b>ajustar en horas</b> para cada tarea. Es lo que ImageNet + fine-tuning ya era en visión.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿BERT (o un descendiente)?', 'Por qué'], rows: [
            ['Clasificar textos (sentimiento, intención, spam, tópico) con miles de ejemplos etiquetados', 'Sí', 'Fine-tuning de un encoder de 100–400M parámetros: barato de entrenar y de servir, latencia de milisegundos.'],
            ['Etiquetar tokens: NER, extracción de campos de un documento', 'Sí', 'Da un vector por token con contexto de los dos lados: justo lo que pide una cabeza por token.'],
            ['QA extractiva: encontrar el tramo de un párrafo que responde', 'Sí', 'Dos vectores aprendidos puntúan el inicio y el fin del tramo (SQuAD en el paper).'],
            ['Reordenar candidatos de búsqueda (reranker)', 'Sí, como cross-encoder', R`Query y documento entran juntos y la atención los cruza: preciso, pero un forward por par (ver <a href="#retrieval">retrieval</a>).`],
            ['Embeddings de frases para búsqueda semántica, tal cual sale del preentrenamiento', 'No', R`El [CLS] sin ajustar es un mal embedding de frase (peor que promediar GloVe, ${SBERT}, Tabla 1). Usa un bi-encoder entrenado con pares: SBERT, E5, BGE (<a href="#retrieval">retrieval</a>).`],
            ['Generar texto (resumir, chatear, traducir)', 'No', R`No tiene objetivo ni máscara causal para generar token a token. Usa un decoder (<a href="#llm-decoder">LLM</a>) o un encoder-decoder (<a href="#t5">T5</a>).`],
            [R`Documentos de más de ${cf('posMax')} tokens`, 'Con cuidado', R`Las posiciones aprendidas se acaban en ${cf('posMax')}: hay que trocear. ModernBERT llega a 8,192 tokens con RoPE.`],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"BERT is a transformer encoder with bidirectional self-attention, pretrained on unlabeled text with masked language modeling: fifteen percent of the tokens are selected, the model sees the corrupted sentence and predicts the original tokens from both sides of context. The original recipe also had next-sentence prediction, which RoBERTa later showed is unnecessary. You fine-tune the whole model with a small head: classification on the CLS token, a linear layer per token for NER, or start and end vectors for span QA. It cannot generate text autoregressively, and its CLS vector is not a good sentence embedding without contrastive fine-tuning."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Como el encoder de ViT, pero sobre palabras; como el decoder de un LLM, pero sin máscara causal.</b> Ya tienes las dos mitades. De <a href="#vit">ViT</a>: una secuencia de vectores de ancho D, un token [CLS] al principio, posiciones aprendidas sumadas, L bloques de atención + MLP con residuales. Del <a href="#llm-decoder">decoder de un LLM</a>: el texto entra como ids de un vocabulario y sale como logits sobre ese vocabulario. BERT junta las dos cosas con una diferencia que lo define todo: <b>cada token atiende a todos los demás</b>, incluidos los de su derecha.` },
          { t: 'table', caption: 'Lo que ya sabes, en el idioma de BERT', head: ['Concepto', 'Donde ya lo viste', 'En BERT', '¿Nuevo?'], rows: [
            ['Tokens de entrada', 'ViT: 196 patches de 16×16 proyectados', R`Ids de WordPiece (vocabulario de ${cf('V')}) → tabla de embeddings`, 'Equivale'],
            ['[CLS]', 'ViT: token aprendido cuya salida va a la cabeza', 'El primer token de toda entrada; su salida pasa por el pooler a la cabeza de clasificación', 'Igual'],
            ['Posiciones', 'ViT: tabla aprendida de N + 1 filas', R`Tabla aprendida de ${cf('posMax')} filas + una tabla de <b>segmento</b> (A o B) de ${cf('typeVocab')} filas`, 'Segmento: <b>nuevo</b>'],
            ['Máscara de atención', 'Decoder: causal (j ≤ i)', 'Ninguna (bidireccional); solo la de padding', 'Igual que ViT'],
            ['Objetivo de preentrenamiento', 'Decoder: predecir el siguiente token', 'Predecir los tokens <b>tapados</b> (MLM) mirando los dos lados', '<b>Nuevo</b>'],
            ['LayerNorm', 'ViT, Llama: pre-LN (antes de cada sub-bloque)', '<b>Post-LN</b>: después de cada suma residual, como el Transformer original', '<b>Nuevo</b> (y es un detalle que se pregunta)'],
            ['Preentrenar y ajustar', 'ResNet de ImageNet → fine-tuning en tu dataset', 'MLM sobre libros y Wikipedia → fine-tuning en GLUE, SQuAD, NER', 'Igual'],
          ] },
          { t: 'h3', text: 'Los tres sabores de transformer' },
          { t: 'p', html: R`Lo que distingue a BERT de GPT no es el bloque (es el mismo: atención + MLP + residuales + LayerNorm) sino la <b>máscara</b> y el <b>objetivo</b>. La versión larga, con las tres máscaras dibujadas, está en el <a href="#repaso-atencion.tres-sabores">repaso de atención</a>.` },
          { t: 'table', caption: 'Encoder-only, decoder-only y encoder-decoder', head: ['Sabor', 'Máscara', 'Objetivo de preentrenamiento', 'Qué entrega', 'Ejemplos'], rows: [
            ['Encoder-only', 'Bidireccional: todos a todos', 'MLM (rellenar tokens tapados); ELECTRA: detectar tokens reemplazados', 'Un vector por token: entender, clasificar, buscar', 'BERT, RoBERTa, DeBERTa, ModernBERT; <a href="#vit">ViT</a> en visión'],
            ['Decoder-only', 'Causal: i ve solo j ≤ i', 'Siguiente token', 'Una distribución sobre el siguiente token: generar', 'GPT, <a href="#llm-decoder">Llama</a>'],
            ['Encoder-decoder', 'Bidireccional en el encoder; causal + cross-attention en el decoder', 'Seq2seq; T5: span corruption', 'Una secuencia nueva condicionada a la entrada', '<a href="#t5">T5</a>, Whisper, el Transformer original'],
          ] },
          { t: 'callout', kind: 'trap', title: '"BERT no genera porque es chico"', html: R`<p>No es el tamaño: es el objetivo y la máscara. Un decoder aprende p(x<sub>t</sub> | x<sub>&lt;t</sub>), que es justo lo que se necesita para muestrear token a token. BERT aprende p(x<sub>i</sub> | todo lo demás), con los dos lados visibles: en generación no hay "lado derecho" todavía, y cada token nuevo cambiaría las representaciones de todos los anteriores (no hay KV cache posible). Se puede forzar una generación iterativa rellenando [MASK]s, pero es lenta y peor. Al revés también vale: un decoder solo ve la izquierda, y por eso su vector de un token es una peor representación de la frase entera que el de un encoder del mismo tamaño.</p>` },
          { t: 'h3', text: 'Por qué tapar palabras y no predecir la siguiente' },
          { t: 'p', html: R`Si entrenas un modelo bidireccional para predecir el token i y le dejas ver el token i, la tarea es trivial: copiarlo. El modelo de lenguaje clásico evita eso con la máscara causal, pero entonces cada token solo usa contexto izquierdo. La idea de BERT: <b>tapar el token en la entrada</b> (reemplazarlo por [MASK]) y pedirle que lo reconstruya con el contexto de los dos lados. Es un "cloze test", el ejercicio de completar huecos. El precio: solo las posiciones tapadas (15 %) dan pérdida en cada secuencia, y [MASK] no aparece nunca en el fine-tuning. Las dos cosas tienen consecuencias que vas a ver en <a href="#bert.entrenamiento">entrenamiento</a> y en <a href="#bert.variantes">variantes</a> (ELECTRA).` },
          { t: 'callout', kind: 'connect', html: R`<p>Dónde vas a volver a ver a BERT en el Atlas: como <b>text encoder de <a href="#grounding-dino">Grounding DINO</a></b> (BERT-base con una máscara entre frases, un vector por token para puntuar cada palabra del prompt contra cada caja), como base de los <b>bi-encoders y cross-encoders</b> de <a href="#retrieval">retrieval</a>, y como el encoder de <a href="#t5">T5</a> (encoder-decoder).</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`De arriba hacia abajo: los tokens ([CLS] … [SEP] … [SEP]) se convierten en la suma de tres embeddings (token, posición y segmento) y una LayerNorm; pasan por ${cf('L')} capas de encoder idénticas (ábrelas para ver la capa post-LN); y abajo hay tres salidas que se usan en momentos distintos: la cabeza de MLM (preentrenamiento, una distribución sobre el vocabulario por posición), el pooler + la cabeza de NSP (preentrenamiento) y, en fine-tuning, la cabeza de tu tarea sobre el [CLS] o sobre cada token. Abre la cabeza de MLM o la de NSP para ver el preentrenamiento completo, con las dos pérdidas. "Recorrido" sigue una entrada de ${cf('T')} tokens con números.` },
          { t: 'archdiagram', diagram: 'bert-overview', walk: 'forward', wide: true, caption: R`BERT-base: ${cf('L')} capas, D = ${cf('D')}, ${cf('h')} cabezas, D<sub>mlp</sub> = ${cf('Dmlp')}, vocabulario de ${cf('V')}. Formas del calculador para T = ${cf('T')}.` },
          { t: 'p', html: R`<b>Qué se tapa y qué se predice.</b> Una oración de ejemplo: el 15 % de los tokens se elige; de esos, el 80 % se cambia por [MASK], el 10 % por un token al azar y el 10 % queda igual. El modelo predice el token original <b>solo en las posiciones elegidas</b>, aunque en la entrada no sepa cuáles son las que quedaron iguales.` },
          { t: 'viz', kind: 'mlm-masking', params: { pair: 'isnext', seed: 3 }, caption: 'MLM y NSP sobre el par del paper (App. A.1; ilustrativo: el sorteo cambia con la semilla). Las posiciones elegidas llevan etiqueta; las demás, −100 (no cuentan en la pérdida).' },
          { t: 'callout', kind: 'note', html: R`<p>Tres detalles del diagrama: (1) la matriz de la cabeza de MLM que proyecta a ${cf('V')} logits es <b>la misma</b> tabla de embeddings de entrada, transpuesta (weight tying): por eso esa cabeza casi no suma parámetros; (2) el pooler (una lineal D → D con tanh sobre el [CLS]) existe para NSP; muchas implementaciones de fine-tuning lo usan y otras toman el [CLS] directo; (3) en la capa post-LN la LayerNorm va <b>después</b> de cada suma residual, no antes del sub-bloque como en ViT.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación, con el ejemplo del paper (Fig. 2): el par "my dog is cute" / "he likes playing" se tokeniza como <code>[CLS] my dog is cute [SEP] he likes play ##ing [SEP]</code>: 11 tokens; "playing" se partió en dos piezas (WordPiece). Cada token se convierte en un vector de ${cf('D')} números sumando tres filas de tres tablas: la de su id (qué palabra), la de su posición (0 … 10) y la de su segmento (A para todo hasta el primer [SEP], B después). Esos 11 vectores pasan por ${cf('L')} capas; en cada una, cada vector se mezcla con los otros 10 (atención) y se transforma solo (MLP). Salen 11 vectores contextuales: el de "dog" ya "sabe" que hay un "cute" y un "he" cerca. La canónica del calculador usa T = ${cf('T')} tokens.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'BERT-base'], rows: [
            ['T', 'tokens de la secuencia (incluye [CLS] y los [SEP]; el Atlas usa T para texto)', cf('T')],
            ['D', 'ancho del modelo (H en el paper)', cf('D')],
            ['h, d<sub>h</sub>', 'cabezas (A en el paper) y ancho por cabeza D/h', R`${cf('h')}, ${cf('dh')}`],
            ['D<sub>mlp</sub>', 'ancho de la FFN (4D)', cf('Dmlp')],
            ['L', 'capas', cf('L')],
            ['V', 'vocabulario WordPiece (bert-base-uncased)', cf('V')],
            ['P<sub>max</sub>', 'posiciones aprendidas (largo máximo)', cf('posMax')],
          ] },

          { t: 'h3', text: 'WordPiece: de texto a ids' },
          { t: 'p', html: R`WordPiece parte cada palabra en las piezas más largas que estén en el vocabulario, de izquierda a derecha (greedy longest-match-first); las piezas que continúan una palabra llevan el prefijo <code>##</code>: "playing" → <code>play ##ing</code>, "embeddings" → <code>em ##bed ##ding ##s</code>. Una palabra sin ninguna pieza conocida se vuelve <code>[UNK]</code>, cosa rara con un vocabulario de ${cf('V')} piezas (el paper dice "30,000"; el archivo de <code>bert-base-uncased</code> tiene ${cf('V')}, con ≈ 1,000 entradas <code>[unused]</code> de reserva). La versión <i>uncased</i> pasa todo a minúsculas y quita acentos antes de partir ("Canción" → "cancion"): en español eso pierde información, y el vocabulario, armado sobre inglés, parte las palabras españolas en muchas más piezas.` },
          { t: 'callout', kind: 'trap', title: '"WordPiece y BPE son lo mismo"', html: R`<p>Parecidos, no iguales. Los dos arman un vocabulario de subpalabras uniendo piezas frecuentes; BPE (GPT-2, RoBERTa con 50K piezas a nivel de byte, ${ROBERTA}, §4.4) une el par más frecuente y tokeniza aplicando esas uniones; WordPiece elige uniones por la mejora de verosimilitud y tokeniza con el match más largo. Lo que sí importa en una entrevista: (1) BPE a nivel de byte nunca produce [UNK]; WordPiece sí puede; (2) el largo en tokens de un texto depende del tokenizador: el límite de ${cf('posMax')} es en tokens, no en palabras; (3) un modelo solo funciona con <b>su</b> tokenizador.</p>` },

          { t: 'h3', text: 'Embeddings: token + posición + segmento' },
          { t: 'op', block: 'embed', model: 'bert', diagram: 'bert-overview', title: 'Suma de tres embeddings y LayerNorm',
            tex: R`X_0 = \mathrm{LN}\big(E_\text{tok}[\text{ids}] + E_\text{pos}[0{:}T] + E_\text{seg}[\text{seg}]\big),\quad E_\text{tok}\in\mathbb{R}^{V\times D},\ E_\text{pos}\in\mathbb{R}^{P_\text{max}\times D},\ E_\text{seg}\in\mathbb{R}^{2\times D}`,
            in: [T.ids], out: [T.x0], params: true, flops: true,
            what: R`Tres búsquedas en tablas (sin MACs) y una suma: ${sh('ids')} ids → ${sh('x0')}. Después, LayerNorm y dropout. La tabla de tokens es la mayor parte de los parámetros de esta etapa.`,
            why: R`La atención no sabe de orden (es una operación sobre conjuntos): la posición tiene que entrar en el vector. El segmento le dice a cada token si pertenece al primer o al segundo texto de un par, lo que hace falta para NSP y para tareas de pares (inferencia, QA, reranking). La LayerNorm de entrada existe porque el bloque es post-LN: sin ella, la primera suma residual recibiría vectores sin normalizar.` },

          { t: 'h3', text: 'La capa de encoder (post-LN)' },
          { t: 'op', block: 'encoder', model: 'bert', diagram: 'bert-overview', title: 'Self-attention bidireccional + FFN, LayerNorm después del residual',
            tex: R`\begin{aligned} H &= \mathrm{LN}\big(X + \mathrm{MHSA}(X)\big),\qquad \mathrm{MHSA}(X) = \mathrm{concat}_k\Big[\mathrm{softmax}\Big(\tfrac{Q_kK_k^\top}{\sqrt{d_h}} + M_\text{pad}\Big)V_k\Big]W_O \\ X' &= \mathrm{LN}\big(H + W_2\,\mathrm{GELU}(W_1 H + b_1) + b_2\big)\end{aligned}`,
            in: [T.x0], out: [T.h], params: true, flops: true,
            what: R`Una capa: ${sh('x0')} → ${sh('h')}, repetida ${cf('L')} veces con pesos distintos. M<sub>pad</sub> pone −∞ solo en las columnas de padding: no hay máscara causal. La FFN sube a D<sub>mlp</sub> = ${cf('Dmlp')} y baja a ${cf('D')}.`,
            why: R`<b>Post-LN</b> (la del Transformer original): la LayerNorm va sobre la suma, x ← LN(x + F(x)). Normaliza la salida de cada capa, pero el gradiente que vuelve por el residual atraviesa una LayerNorm en cada capa, y al inicio los gradientes de las capas de arriba son grandes: por eso BERT necesita <b>warmup</b> del learning rate y se vuelve difícil de entrenar con muchas capas. Pre-LN (x ← x + F(LN(x)), la de ViT y Llama) deja un camino residual limpio y entrena sin warmup (${PRELN}). Las variantes modernas (ModernBERT) son pre-LN.` },
          { t: 'callout', kind: 'trap', title: '"BERT es pre-LN como ViT"', html: R`<p>No: BERT es post-LN (la LayerNorm después de cada suma residual) y por eso tiene una LayerNorm extra sobre los embeddings y ninguna al final del encoder. ViT, GPT-2 y Llama son pre-LN, con una LayerNorm final. Si cargas pesos de BERT en un bloque pre-LN, la red da basura sin ningún error de forma.</p>` },

          { t: 'h3', text: 'Las salidas del preentrenamiento' },
          { t: 'op', block: 'mlm-head', model: 'bert', diagram: 'bert-overview', title: 'Cabeza de MLM con la tabla de embeddings atada',
            tex: R`\mathbf{z}_i = \mathrm{LN}\big(\mathrm{GELU}(W_t\,\mathbf{h}_i + \mathbf{b}_t)\big)\,E_\text{tok}^{\top} + \mathbf{b}_V \in \mathbb{R}^{V},\qquad p(x_i \mid \tilde{x}) = \mathrm{softmax}(\mathbf{z}_i)`,
            in: [T.h], out: [T.mlm], params: true, flops: true,
            what: R`Para cada posición: una lineal D → D con GELU y LayerNorm, y después el producto con la tabla de embeddings transpuesta: ${sh('h')} → ${sh('mlm')}. En el preentrenamiento se calcula solo en las posiciones elegidas (≈ 15 %); el calculador muestra todas.`,
            why: R`Atar la proyección de salida a la tabla de entrada (weight tying) ahorra ${cf('V')} × ${cf('D')} parámetros y obliga a que el vector de salida "apunte" al embedding del token correcto. Solo quedan propios la lineal, la LayerNorm y un bias por token del vocabulario.` },
          { t: 'op', block: 'pooler', model: 'bert', diagram: 'bert-overview', title: 'Pooler: tanh sobre el [CLS]',
            tex: R`\mathbf{c} = \tanh\big(W_p\,\mathbf{h}_\text{[CLS]} + \mathbf{b}_p\big)\in\mathbb{R}^{D}`,
            in: [T.cls], out: [T.pooled], params: true, flops: true,
            what: R`Toma solo la salida del [CLS] (${sh('cls')}) y la pasa por una lineal D → D con tanh: ${sh('pooled')}.`,
            why: R`Se entrenó con NSP: el [CLS] aprende a resumir "¿estas dos frases van juntas?". El paper lo advierte: el vector C "no es una representación significativa de la frase sin fine-tuning, porque se entrenó con NSP" (§3.1, nota 6). Para clasificación sirve como punto de partida que el fine-tuning re-entrena; para búsqueda, no (ver <a href="#retrieval.puente">retrieval</a>).` },
          { t: 'op', block: 'nsp-head', model: 'bert', diagram: 'bert-overview', title: 'Cabeza de NSP: ¿B sigue a A?',
            tex: R`p(\text{IsNext}\mid A, B) = \mathrm{softmax}\big(W_\text{nsp}\,\mathbf{c} + \mathbf{b}_\text{nsp}\big)\in\mathbb{R}^{2}`,
            in: [T.pooled], out: [T.nsp], params: true, flops: true,
            what: R`Una lineal D → 2 sobre el pooler: ${sh('pooled')} → ${sh('nsp')}.`,
            why: R`El 50 % de los pares es la oración siguiente real y el 50 % una oración al azar de otro documento (§3.1). El modelo llega a 97–98 % de accuracy: la tarea es fácil, porque se puede resolver por <b>tema</b> (una oración al azar suele hablar de otra cosa) sin entender coherencia. Es una de las razones por las que RoBERTa la quitó y ALBERT la cambió por el orden de las oraciones.` },

          { t: 'h3', text: 'Las cabezas de fine-tuning' },
          { t: 'table', caption: 'Qué se pone arriba según la tarea (§4 del paper)', head: ['Tarea', 'Entrada', 'Cabeza', 'Parámetros nuevos', 'Pérdida'], rows: [
            ['Clasificación de una frase o de un par (sentimiento, NLI, paráfrasis)', '[CLS] A [SEP] (B [SEP])', R`Lineal sobre el pooler: c → K logits`, 'D·K + K', 'Entropía cruzada'],
            ['Etiquetado de tokens (NER, POS)', '[CLS] texto [SEP]', R`Lineal sobre cada h<sub>i</sub>: K logits por token (la etiqueta va en la primera pieza de cada palabra)`, 'D·K + K', 'Entropía cruzada por token'],
            ['QA extractiva (SQuAD)', '[CLS] pregunta [SEP] párrafo [SEP]', R`Dos vectores S, E ∈ ℝ<sup>D</sup>: P<sub>inicio</sub>(i) = softmax<sub>i</sub>(S·h<sub>i</sub>), igual para el fin`, '2·D (+ biases)', 'Log-verosimilitud del inicio y del fin correctos'],
            ['Reranking (cross-encoder)', '[CLS] query [SEP] documento [SEP]', 'Lineal sobre el [CLS] → un score', 'D + 1', R`Binaria o listwise (<a href="#retrieval.operaciones">retrieval</a>)`],
          ], note: 'Todas las cabezas son chicas: en fine-tuning se ajustan todos los pesos de BERT, no solo la cabeza (a diferencia de un linear probe). El span de QA se elige con el par (i, j) de mayor S·h_i + E·h_j con j ≥ i.' },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de la canónica (T = ${cf('T')}). Toca una fila para resaltarla en el diagrama.` },
          { t: 'trace', model: 'bert' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`BERT-base con las cabezas de preentrenamiento (MLM + NSP) tiene ${qn('params.total')} parámetros; el "110M" del paper redondea eso. El cuerpo (embeddings + ${cf('L')} capas, sin pooler ni cabezas) son ${met('body')}; <code>BertModel</code> le suma el pooler (${met('pool')}). Despliega <i>encoder</i> para ver una capa.` },
          { t: 'params', model: 'bert', group: 'block' },
          { t: 'calc', title: 'De dónde salen los parámetros de BERT-base (calculador)', rows: [
            { label: 'Embeddings', expr: R`V·D + P<sub>max</sub>·D + 2·D + LN = ${cf('V')}·${cf('D')} + ${cf('posMax')}·${cf('D')} + 2·${cf('D')} + 2·${cf('D')}`, value: met('emb'), note: R`${met('embShare')} del total` },
            { label: 'Una capa', expr: R`atención 4D² + 4D · FFN 2·D·D<sub>mlp</sub> + D<sub>mlp</sub> + D · 2 LN 4D`, value: met('layer') },
            { label: R`× ${cf('L')} capas`, expr: '≈ 12·D² por capa', value: met('enc') },
            { label: 'Pooler', expr: 'D² + D', value: met('pool') },
            { label: 'Cabeza de MLM', expr: R`D² + D (lineal) + 2D (LN) + V (bias); la matriz V×D es la de embeddings, atada`, value: met('mlm') },
            { label: 'Cabeza de NSP', expr: '2D + 2', value: met('nsp') },
          ], result: R`Más de un quinto de BERT-base es la tabla de embeddings: ${met('emb')} de ${qn('params.total')} (${met('embShare')}). Por eso los modelos "chicos" no se achican en proporción a las capas: DistilBERT quita la mitad de las capas y queda en 66M (${DISTIL}, Tabla 3), no en 55M; y ALBERT factoriza la tabla en V×128 · 128×D para atacar justo ese término.` },
          { t: 'callout', kind: 'trap', title: '"BERT-base tiene 110M parámetros en sus capas de atención"', html: R`<p>Las ${cf('L')} capas son ${met('enc')}; el resto es la tabla de embeddings (${met('emb')}) y las cabezas. Esto importa al comparar: un BERT multilingüe con un vocabulario de ≈ 120K piezas tiene muchos más parámetros con el mismo encoder y casi el mismo costo por token, porque buscar una fila en una tabla no cuesta MACs.</p>` },
          { t: 'p', html: R`Los MACs de una secuencia de T = ${cf('T')} tokens, por bloque: ${met('macs')} en total, de los que ${met('encMacs')} son el encoder. La tabla de embeddings no cuenta: es una búsqueda, no un matmul. La cabeza de MLM sí, y es grande (T × D × V): el calculador la aplica a las ${cf('T')} posiciones, como <code>BertForPreTraining</code> de HF (${met('mlmMacs')}, ${met('mlmShare')} del total); la implementación original solo la calcula en las ${met('masked')} posiciones elegidas (${met('gathered')}). En fine-tuning y en inferencia no existe: lo que pagas es el encoder. (La contabilidad de la cabeza de MLM, todas las posiciones contra las elegidas, es un detalle: sáltalo si vas corto.)` },
          { t: 'flops', model: 'bert' },
          { t: 'h3', text: 'Cómo escala con el largo T' },
          { t: 'p', html: R`Por capa, las lineales cuestan T·(4D² + 2·D·D<sub>mlp</sub>) MACs (crecen con T) y los dos productos de la atención, QKᵀ y A·V, cuestan 2·T²·D (crecen con T²). A T = ${cf('T')}, la parte cuadrática es ${met('attn')} de los MACs del encoder (a 512, ${est('≈ 10 %')}: muévelo en el explorador). Se igualan cuando 2T²D = T·(4D² + 2·D·D<sub>mlp</sub>), o sea T = 2D + D<sub>mlp</sub> = 6D = ${met('cross')} tokens en BERT-base: muy por encima de ${cf('posMax')}. Para BERT, <b>la atención casi nunca es el cuello en cómputo</b>; sí lo es en memoria si materializas los h×T×T scores sin FlashAttention.` },
          { t: 'scaling', model: 'bert', knobs: [{ key: 'T', values: [32, 64, 128, 256, 512] }], show: ['macsPerSequence', 'encoderMacs', 'attnScoreShareEncoder', 'mlmHeadMacs'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 T → ×2 MACs de las lineales y ×4 en QKᵀ y A·V; a los largos de BERT, eso da ≈ ×2 en total. Los parámetros no cambian con T (salvo que quieras más de ${cf('posMax')} posiciones: hay que agrandar la tabla y entrenar esas filas). ×2 B → ×2 todo, con los mismos pesos.` },
          { t: 'compare', models: [C, LG], rows: ['params', 'L', 'D', 'h', 'Dmlp', 'V', 'embedParams', 'encoderMacs', 'macs'], caption: R`BERT-base y BERT-large (${cf('L', LG)} capas, D = ${cf('D', LG)}, ${cf('h', LG)} cabezas): "340M" en el paper, ${qn('params.total', LG)} en el calculador con las cabezas de preentrenamiento. MACs por secuencia de T = ${cf('T')} (el total incluye la cabeza de MLM en todas las posiciones).` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota: "BERT-base is about a hundred ten million parameters, about a fifth of them in the thirty-thousand-by-seven-hundred-sixty-eight embedding table, which costs no FLOPs. A forward pass is roughly one multiply-accumulate, two FLOPs, per non-embedding parameter per token, about eleven billion multiply-accumulates or twenty-two gigaFLOPs for a hundred-twenty-eight-token sequence, and at BERT lengths the quadratic attention term is a few percent of the compute; it only dominates beyond several thousand tokens."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Dos pérdidas sumadas: MLM sobre las posiciones elegidas y NSP sobre el par. Ninguna necesita etiquetas humanas: las dos se fabrican a partir de texto corrido.` },
          { t: 'math', display: true, tex: R`\mathcal{L} = \underbrace{-\frac{1}{|\mathcal{M}|}\sum_{i\in\mathcal{M}} \log p_\theta\big(x_i \mid \tilde{x}\big)}_{\text{MLM: solo posiciones elegidas}}\ \ \underbrace{-\ \log p_\theta\big(\text{IsNext}=y \mid A, B\big)}_{\text{NSP}},\qquad |\mathcal{M}| \approx 0.15\,T`, caption: 'x̃ es la secuencia corrompida (con [MASK], tokens al azar o sin cambio en las posiciones de 𝓜). En código, las posiciones fuera de 𝓜 llevan etiqueta −100 y la entropía cruzada las ignora.' },
          { t: 'h3', text: 'El 15 % y el 80/10/10' },
          { t: 'steps', items: [
            { title: 'Elegir el 15 %', html: R`<p>De cada secuencia se elige al azar el 15 % de los tokens WordPiece (nunca [CLS], [SEP] ni padding). Solo esas posiciones tienen etiqueta. Con T = ${cf('T')}, el calculador usa ⌈0.15·T⌉ = ${met('masked')} (el script original elige round(0.15·128) = 19 y reserva max_predictions_per_seq = 20 lugares): ${met('toMask')} [MASK], ${met('toRand')} al azar y ${met('keep')} sin cambio.</p>` },
            { title: '80 %: [MASK]', html: R`<p>La mayoría se reemplaza por [MASK]: es la tarea de rellenar.</p>` },
            { title: '10 %: un token al azar', html: R`<p>El modelo no puede confiar en que lo que ve es el token correcto en ninguna posición: tiene que mantener una buena representación de <b>cada</b> token, no solo de los [MASK].</p>` },
            { title: '10 %: el mismo token', html: R`<p>"Sesga la representación hacia la palabra observada" (§3.1, App. A.1): en fine-tuning no hay [MASK], y el modelo tiene que haber aprendido a usar el token que ve.</p>` },
          ] },
          { t: 'callout', kind: 'why', title: 'Por qué no 100 % [MASK]', html: R`<p>El paper lo dice explícito: [MASK] no aparece nunca en el fine-tuning, así que entrenar solo con [MASK] crea una <b>discrepancia</b> entre preentrenamiento y ajuste (§3.1). Si todas las posiciones a predecir fueran [MASK], el modelo aprendería que los tokens visibles son siempre correctos y podría "dejar de mirar" a fondo los no tapados. Lo interesante es cuánto importa: en la ablación (App. C.2, Tabla 8), con fine-tuning el resultado casi no cambia (MNLI 84.2 con 80/10/10 contra 84.3 con 100 % [MASK]); donde sí se nota es usando BERT como extractor de features fijo (NER 94.9 contra 94.0). El paper mismo dice que el fine-tuning es "sorprendentemente robusto" a estas elecciones.</p>` },
          { t: 'callout', kind: 'trap', title: '"BERT enmascara el 15 % con [MASK]"', html: R`<p>Elige el 15 %, y de esos solo el 80 % lleva [MASK]: ≈ 12 % de los tokens de la entrada son [MASK], ≈ 1.5 % son un token al azar y ≈ 1.5 % quedan iguales, y la pérdida se calcula en los tres grupos. Y otro detalle de implementación: el script original elige exactamente round(0.15·n) posiciones por secuencia (con un tope de 20 a T = 128); <code>DataCollatorForLanguageModeling</code> de Hugging Face sortea cada token con probabilidad 0.15, así que el número por secuencia varía (en el ejercicio de práctica: media 14.7, desvío 3.5, entre 3 y 29 sobre 98 tokens).</p>` },
          { t: 'h3', text: 'Datos y receta del paper' },
          { t: 'table', caption: 'BERT (§3.1, App. A.2)', head: ['Qué', 'Valor', 'Dónde'], rows: [
            ['Corpus', 'BooksCorpus (800M palabras) + Wikipedia en inglés (2,500M palabras; solo texto, sin listas ni tablas)', '§3.1'],
            ['Batch', '256 secuencias por paso: × 512 tokens = 131,072 tokens (el paper redondea a 128,000) en el 10 % final; × 128 = 32,768 en el 90 % a T = 128', 'App. A.2'],
            ['Pasos', R`1,000,000 (≈ 40 épocas sobre 3.3B palabras; la cuenta del paper supone 512 tokens por secuencia: con el 90 % de los pasos a 128 son ${est('≈ 43B tokens')}, del orden de un tercio)`, 'App. A.2'],
            ['Largo de secuencia', '128 tokens el 90 % de los pasos; 512 el 10 % final, para aprender las posiciones altas (la atención con T² es cara)', 'App. A.2'],
            ['Optimizador', 'Adam, LR 1e-4, β₁ = 0.9, β₂ = 0.999, weight decay 0.01, warmup de 10,000 pasos y decaimiento lineal', 'App. A.2'],
            ['Regularización y activación', 'Dropout 0.1 en todas las capas; GELU (no ReLU)', 'App. A.2'],
            ['Hardware', 'Base: 4 Cloud TPUs (16 chips); large: 16 Cloud TPUs (64 chips); 4 días cada uno', 'App. A.2'],
            ['NSP', '50 % IsNext / 50 % NotNext; 97–98 % de accuracy al final', '§3.1, nota 5'],
          ] },
          { t: 'h3', text: 'Lo que RoBERTa corrigió' },
          { t: 'p', html: R`RoBERTa (${ROBERTA}) no cambia la arquitectura: cambia la receta, y con eso BERT-large pasa a superar a modelos posteriores. Cada hallazgo es una pregunta de entrevista:` },
          { t: 'table', head: ['Cambio', 'Qué midieron', 'Dónde'], rows: [
            ['Masking dinámico', 'BERT enmascaraba una vez en el preprocesamiento (10 copias); RoBERTa sortea en cada pasada. Igual o algo mejor.', 'Tabla 1'],
            ['Sin NSP', 'Con oraciones completas hasta 512 tokens y sin NSP: SQuAD 2.0 F1 79.1 y MNLI-m 84.7, contra 78.7 y 84.0 con NSP: quitar NSP iguala o mejora, contra la ablación de BERT (Tabla 5 del paper original, donde quitarla bajaba QNLI de 88.4 a 84.9).', 'Tabla 2'],
            ['Batches grandes', 'A igual cómputo: 2K secuencias × 125K pasos mejor que 256 × 1M (perplejidad 3.68 vs 3.99). Usan 8K secuencias y β₂ = 0.98 para estabilidad.', 'Tabla 3, Tabla 9'],
            ['Más datos y más tiempo', '160 GB de texto (BERT: 16 GB), 500K pasos con batch de 8K.', '§3.2, §5'],
            ['Tokenizador', 'BPE a nivel de byte con 50K piezas (≈ +15M parámetros en base, por la tabla).', '§4.4'],
          ] },
          { t: 'callout', kind: 'trap', title: '"NSP es necesaria: la ablación de BERT lo prueba"', html: R`<p>La ablación de BERT quitaba NSP pero seguía entrenando con pares de segmentos cortos. RoBERTa muestra que la caída venía del formato de entrada, no de la pérdida: con secuencias de oraciones contiguas hasta 512 tokens y sin NSP, el resultado iguala o mejora. Por eso ningún encoder moderno usa NSP (ModernBERT tampoco).</p>` },
          { t: 'h3', text: 'Fine-tuning' },
          { t: 'kv', items: [
            ['Hiperparámetros', 'Batch 16 o 32; LR 5e-5, 3e-5 o 2e-5; 2–4 épocas; dropout 0.1. Todos los resultados del paper se reproducen "en a lo sumo 1 hora en una Cloud TPU, o unas horas en una GPU" (§3.2).', 'App. A.3'],
            ['Inestabilidad', 'BERT-large "a veces era inestable en datasets chicos": corrieron varios reinicios aleatorios y eligieron el mejor en dev.', '§4.1'],
            ['Feature-based vs fine-tuning', 'Concatenar las 4 últimas capas sin ajustar BERT da NER dev F1 96.1, a 0.3 del fine-tuning completo (96.4).', 'Tabla 7'],
            ['Resultados', 'GLUE (test): 79.6 base, 82.1 large. SQuAD v1.1 (dev F1, un modelo): 88.5 base, 90.9 large. SQuAD v2.0 (test F1): 83.1 large.', 'Tablas 1–3'],
          ] },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: las cifras de GLUE y SQuAD y el detalle de la Tabla 8. Lo que no te puedes saltar: 15 % con 80/10/10 y por qué, NSP y por qué se quitó (RoBERTa), post-LN con warmup, y la receta de fine-tuning (LR ≈ 2e-5 a 5e-5, 2–4 épocas).</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Un solo forward en paralelo sobre los T tokens: no hay decodificación token a token ni KV cache. La latencia es la de un prefill de un LLM chico. Con T = ${cf('T')}, el encoder cuesta ${met('encMacs')} por secuencia (la cabeza de MLM no se usa fuera del preentrenamiento).` },
          { t: 'steps', items: [
            { title: 'Tokenizar', html: '<p>WordPiece en CPU (los tokenizadores en Rust de HF son rápidos); truncar a P<sub>max</sub> y agregar [CLS]/[SEP]. En servicios con mucho tráfico, la tokenización y el pre/post-proceso pueden pesar tanto como el modelo: mídelos.</p>' },
            { title: 'Armar el batch', html: '<p>Padding al más largo del batch, no a 512: agrupa por largo (bucketing) o elimina el padding (unpadding / secuencias empaquetadas con FlashAttention varlen).</p>' },
            { title: 'Forward', html: R`<p>Las lineales dominan los MACs (QKᵀ y A·V son ${met('attn')} del encoder a T = ${cf('T')}). En GPU, con batch chico, el forward está limitado por memoria (cargar ${est('≈ 220 MB')} de pesos en fp16) más que por cómputo.</p>` },
            { title: 'Cabeza', html: '<p>Una lineal sobre el [CLS] o sobre cada token: despreciable.</p>' },
          ] },
          { t: 'table', caption: 'Trucos de inferencia y qué ganan', head: ['Truco', 'Qué hace', 'Cuándo'], rows: [
            ['Padding dinámico / bucketing', 'No pagar MACs por tokens de relleno: a T medio 40 con padding a 512, más de 10× de cómputo desperdiciado', 'Siempre'],
            ['Destilar a un encoder chico', R`DistilBERT (6 capas, 97 % de GLUE, 60 % más rápido) o MiniLM (${MINILM})`, 'Latencia o costo por request'],
            ['Cuantizar a int8', 'Pesos y activaciones en 8 bits (ONNX Runtime, TensorRT); en CPU suele ser la ganancia más grande', 'CPU o edge; medir la caída de accuracy'],
            ['FlashAttention / SDPA', 'No materializa los h×T×T scores: menos memoria y algo más rápido a T largo', 'T ≥ 512 o batch grande'],
            ['Cachear embeddings', 'Si el mismo texto se procesa muchas veces (documentos de un índice), calcularlo una vez', R`Búsqueda: el principio del bi-encoder (<a href="#retrieval">retrieval</a>)`],
          ] },
          { t: 'callout', kind: 'senior', html: R`<p>Una cuenta de servilleta que sorprende: el encoder de BERT-base hace ${met('encMacs')} por secuencia de ${cf('T')} tokens. Una A100 hace ${est('≈ 312 TFLOPs')} en fp16 denso (≈ 156 TMACs/s): el límite teórico son ${est('≈ 14,000 secuencias por segundo')}; en la práctica, con batch grande y TensorRT, se ven ${est('miles por segundo')}; con batch 1 en PyTorch, un forward tarda ${est('algunos ms')} dominado por overhead de kernels. Por eso el batching dinámico (juntar requests durante unos ms) es la palanca más grande en un servicio de BERT. Mide con tu hardware antes de prometer números.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>El [CLS] como embedding de frase.</b> Sin entrenar con pares, el [CLS] da un 29.19 promedio de Spearman en tareas STS, contra 54.81 del promedio de los tokens de BERT y 61.32 del promedio de GloVe (${SBERT}, Tabla 1). Los vectores contextuales de BERT son además <b>anisótropos</b>: ocupan un cono estrecho y casi cualquier par tiene coseno alto (${ANISO}). Arreglo: entrenar un bi-encoder con una pérdida contrastiva (<a href="#retrieval">retrieval</a>).`,
            R`<b>El límite de ${cf('posMax')} tokens.</b> No hay posiciones aprendidas más allá: un documento largo se trunca (en silencio, con <code>truncation=True</code>) o hay que partirlo en ventanas con solapamiento y agregar las predicciones. Si la información está en el final, se pierde.`,
            R`<b>Atajos en lugar de comprensión.</b> En NLI, BERT ajustado en MNLI se apoya en heurísticas sintácticas como "si todas las palabras de la hipótesis están en la premisa, es entailment" y falla en la mayoría de los contraejemplos de HANS, construidos para romper esas heurísticas (${HANS}). Lo mismo con la negación: "no es bueno" y "es bueno" comparten casi todos los tokens. Mitigación: datos adversariales y evaluación fuera de distribución.`,
            R`<b>Inestabilidad del fine-tuning con pocos datos.</b> Con unos cientos o miles de ejemplos, distintas semillas dan resultados muy distintos (el paper ya lo reporta para BERT-large, §4.1). Mitigación: LR chico con warmup, más épocas, varias semillas y elegir en un dev limpio.`,
            R`<b>Dominio e idioma.</b> El vocabulario y el corpus son de inglés general: en español, código o texto médico, las palabras se parten en muchas piezas y el modelo rinde menos. Usa un encoder del dominio o multilingüe (mBERT, ${XLMR}), o sigue el preentrenamiento MLM en tu corpus antes del fine-tuning.`,
          ] },
          { t: 'table', caption: 'BERT frente a sus alternativas (filas = criterios)', head: ['Criterio', 'BERT-base', 'DistilBERT / MiniLM', 'ModernBERT-base', 'LLM decoder (7B) como clasificador'], rows: [
            ['Parámetros', qn('params.total'), '≈ 22–66M', '149M', '≈ 7,000M'],
            ['Contexto', cf('posMax'), '512', '8,192', '8K–128K'],
            ['Costo por texto', 'Bajo (un forward)', 'Muy bajo', 'Bajo', 'Alto (≈ 60× los parámetros)'],
            ['Con pocos datos etiquetados', 'Fine-tuning con cientos a miles', 'Igual, algo peor', 'Igual', 'Zero/few-shot con prompts; sin entrenar'],
            ['Calidad en clasificación con datos', 'Buena base', 'Algo menor (97 % de GLUE en DistilBERT)', 'Mejor que BERT en GLUE y en retrieval (según su paper)', 'Comparable o mejor, a mucho más costo'],
            ['Cuándo', 'Baseline, latencia baja, mucho volumen', 'CPU, edge, millones de textos', 'Documentos largos, código', 'Sin datos, tareas abiertas, prototipo'],
          ], note: R`Fuentes: ${DISTIL}; ${MODERN}. Parámetros de BERT-base del calculador; el resto, de los papers.` },
          { t: 'callout', kind: 'senior', html: R`<p>Cómo decidir en una entrevista de diseño: "para clasificar millones de tickets por día con miles de ejemplos etiquetados, empiezo por un encoder ajustado (DeBERTa-v3 o ModernBERT; DistilBERT si la latencia en CPU manda), porque cuesta centavos por millón y responde en milisegundos. Uso un LLM para etiquetar o aumentar datos, y como baseline zero-shot si no tengo etiquetas. Solo sirvo el LLM si la tarea es abierta o los datos no alcanzan."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Cuándo lo mencionas'], rows: [
            [R`RoBERTa (${ROBERTA})`, 'La misma arquitectura con mejor receta: sin NSP, masking dinámico, batches de 8K, 160 GB de texto, BPE de bytes de 50K.', 'Cuando te pregunten si NSP sirve'],
            [R`DistilBERT (${DISTIL})`, 'Mitad de capas, inicializado con capas de BERT y destilado (soft targets + MLM + coseno de los estados ocultos); sin token-type ni pooler. 40 % menos parámetros, 60 % más rápido, 97 % de GLUE.', 'Latencia y costo'],
            [R`ALBERT (${ALBERT})`, 'Tabla de embeddings factorizada (V×128 · 128×D) y pesos compartidos entre capas: ALBERT-base 12M parámetros contra 108M; cambia NSP por SOP (orden de dos segmentos). Menos parámetros no es menos cómputo: los FLOPs por token son los de un BERT con las mismas capas.', 'Trampa de "parámetros vs FLOPs"'],
            [R`ELECTRA (${ELECTRA})`, 'Un generador chico rellena tokens enmascarados y un discriminador clasifica <b>cada</b> token como original o reemplazado: aprende de todos los tokens, no del 15 %. ELECTRA-Small en una GPU 4 días supera a GPT en GLUE dev (79.9 vs 78.8); limitar la pérdida al 15 % baja de 85.0 a 82.4.', 'Eficiencia del preentrenamiento'],
            [R`DeBERTa (${DEBERTA})`, 'Atención desacoplada: contenido y posición relativa en vectores separados (términos contenido→posición y posición→contenido); las posiciones absolutas entran recién antes de la cabeza de MLM. Su versión de 1.5B fue el primer modelo individual por encima de la línea humana de SuperGLUE (89.9 vs 89.8).', 'Encoder fuerte para clasificar'],
            [R`ModernBERT (${MODERN})`, 'Encoder de 2024: pre-LN, RoPE, GeGLU, sin biases, atención local de 128 tokens con una capa global cada tres, unpadding y FlashAttention; 8,192 tokens, 2T tokens de entrenamiento, 30 % de masking, sin NSP; 149M (base) y 395M (large).', 'Contexto largo, el reemplazo directo de BERT'],
            [R`MiniLM (${MINILM})`, 'Destila la atención (las distribuciones de la última capa y la relación valor-valor) del maestro al alumno; base de all-MiniLM-L6-v2 y de los cross-encoders de MS MARCO.', R`<a href="#retrieval">Retrieval</a>`],
            [R`mBERT / XLM-R (${XLMR})`, 'El mismo encoder entrenado en ≈ 100 idiomas con un vocabulario compartido (XLM-R: 250K piezas de SentencePiece, 2.5 TB de CommonCrawl).', 'Texto en español u otros idiomas'],
            [R`Sentence-BERT (${SBERT})`, 'BERT en una red siamesa con mean pooling, ajustado con pares (NLI) para producir embeddings de frase comparables por coseno.', R`<a href="#retrieval">Retrieval</a>`],
            ['Grounding DINO', 'Usa BERT-base como text encoder con una máscara entre frases y posiciones que reinician por frase.', R`<a href="#grounding-dino.operaciones">Grounding DINO</a>`],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`BERT aparece en casi toda entrevista de ML/AI Engineer con texto: como pregunta conceptual ("encoder vs decoder"), como cuenta ("¿cuántos parámetros y dónde?") y como decisión de diseño ("¿clasificador ajustado o LLM?"). Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Explain BERT\'s pretraining objective. Why can\'t you just train a bidirectional model to predict the next token?',
              junior: 'Predice palabras enmascaradas en vez de la siguiente.',
              senior: R`Si cada posición ve toda la secuencia, predecir el token i es trivial: el token i está en la entrada (y en un modelo de varias capas, la información "se filtra" a todas las posiciones). El decoder evita eso con la máscara causal, a costa de usar solo el contexto izquierdo. BERT tapa el token en la <b>entrada</b>: elige el 15 % de las posiciones, las corrompe (80 % [MASK], 10 % un token al azar, 10 % igual) y predice el original solo en esas, con contexto de los dos lados. La pérdida es entropía cruzada sobre el vocabulario en esas posiciones (etiqueta −100 en el resto). Se suma NSP, que RoBERTa mostró innecesaria.`,
              say: 'In a bidirectional model every position can see the token it is supposed to predict, so next-token prediction is trivial. BERT instead corrupts fifteen percent of the input positions, mostly with a mask token, and predicts the originals at those positions using context from both sides. The loss is only computed on the selected positions.',
              why: 'La de entrada. Se anota por qué no next-token con atención bidireccional, el 15 % y que la pérdida es solo sobre las posiciones elegidas.' },
            { q: 'Why 80/10/10? What happens if you always use [MASK]?',
              junior: 'Para que sea más difícil.',
              senior: R`Por la discrepancia entre preentrenamiento y fine-tuning: [MASK] nunca aparece al ajustar. Con 100 % [MASK], el modelo aprende que todo token visible es correcto y que solo hay que trabajar en los [MASK]. El 10 % al azar lo obliga a desconfiar de cualquier posición (mantener una buena representación de todos los tokens) y el 10 % igual lo sesga hacia usar el token observado. Lo que dice la ablación (App. C.2, Tabla 8) es más matizado: con fine-tuning casi da igual (MNLI 84.2 vs 84.3 con 100 % [MASK]); la diferencia aparece usando BERT como extractor de features congelado (NER 94.9 vs 94.0). Y ojo: la pérdida se calcula en las tres variantes, también en las que quedaron iguales.`,
              say: 'The mask token never appears during fine-tuning, so always masking creates a train-test mismatch and lets the model assume every visible token is correct. Random replacement forces it to keep good representations of every token, and keeping some unchanged biases it toward the observed word. In the ablation it barely matters for fine-tuning but helps the feature-based setting.',
              why: 'Trampa: decir que es crítico. Se anota la discrepancia, la función del 10 % al azar y lo que muestra la Tabla 8.', trap: true },
            { q: 'Count the parameters of BERT-base. Where are they?',
              junior: 'Unos 110 millones, en las capas de atención.',
              senior: R`Embeddings: V·D = ${cf('V')}·${cf('D')} de tokens, ${cf('posMax')}·${cf('D')} de posiciones, 2·${cf('D')} de segmento y una LayerNorm: ${met('emb')}, ${met('embShare')} del total. Cada capa ≈ 12·D²: atención 4D² + 4D, FFN 2·D·D<sub>mlp</sub> + D<sub>mlp</sub> + D, dos LayerNorm: ${met('layer')}; por ${cf('L')}: ${met('enc')}. Pooler D² + D. Cabeza de MLM D² + D + 2D + V, con la matriz de salida atada a la tabla de embeddings; NSP 2D + 2. Total ${qn('params.total')} con las cabezas; el cuerpo sin pooler ni cabezas, ${met('body')}. El punto: más de un quinto es una tabla que no cuesta FLOPs.`,
              say: 'About twenty-four million are the token, position and segment embeddings, about eighty-five million are the twelve encoder layers at roughly twelve d-squared each, plus a small pooler and the pretraining heads, whose output matrix is tied to the embedding table. So about a fifth of BERT-base is a lookup table that costs no FLOPs.',
              why: 'Se anota la cuenta por bloque, 12D² por capa, el weight tying y la proporción de embeddings.' },
            { q: 'What are the CLS token and the pooler, and what do you feed to a classification head?',
              junior: 'El [CLS] es el resumen de la frase y sirve para todo.',
              senior: R`El [CLS] es un token aprendido que va primero; como atiende a todos, su salida puede resumir la secuencia. El pooler (lineal D → D con tanh) se entrenó con NSP sobre ese vector. Para clasificar con fine-tuning hay tres opciones que rinden parecido: la salida del pooler (lo que hace <code>BertForSequenceClassification</code>), el [CLS] directo o el promedio de los tokens con la attention mask. Las tres sirven porque el fine-tuning re-entrena todo el encoder. Lo que <b>no</b> sirve es usar ese vector sin entrenar como embedding de frase: el paper lo advierte (§3.1, nota 6), y la cuenta y el arreglo están en <a href="#retrieval.entrevista">retrieval</a>.`,
              say: 'CLS is a learned first token whose output summarizes the sequence; the pooler is a tanh layer on top of it that was trained for next-sentence prediction. For fine-tuned classification, the pooled output, the raw CLS vector or a masked mean all work because the whole encoder is retrained. Untrained, the CLS vector is not a usable sentence embedding.',
              why: 'Se anota qué es el pooler, las tres opciones de vector para clasificar, por qué funcionan con fine-tuning y el límite sin entrenar.' },
            { q: 'BERT vs GPT: architecture differences and when you would use each.',
              junior: 'BERT es de Google y GPT de OpenAI; GPT es más grande.',
              senior: R`El bloque es el mismo; cambian la máscara (bidireccional vs causal), el objetivo (MLM vs siguiente token) y la LayerNorm (BERT post-LN; GPT-2 en adelante pre-LN). Consecuencias: BERT da un vector por token con contexto de los dos lados, ideal para clasificar, etiquetar, extraer spans y como encoder de búsqueda o reranking; no genera. GPT genera y con escala hace tareas zero/few-shot, pero cada vector solo ve la izquierda y cuesta mucho más por texto. Uso un encoder cuando tengo datos etiquetados, mucho volumen y latencia baja; un decoder cuando la tarea es abierta, no tengo etiquetas o necesito generar.`,
              say: 'Same transformer block, different mask and objective: BERT is bidirectional and trained with masked language modeling, GPT is causal and trained on next-token prediction. BERT gives contextual vectors for understanding tasks and cannot generate; GPT generates and does few-shot tasks but is far more expensive per input.',
              why: 'Se anota máscara, objetivo, LN y la decisión de producto con costo.' },
            { q: 'Post-LN vs pre-LN: which does BERT use and why does it matter?',
              junior: 'No importa dónde va la LayerNorm.',
              senior: R`BERT es post-LN: x ← LN(x + F(x)). El gradiente que baja por el residual atraviesa una LayerNorm por capa, y al inicio del entrenamiento los gradientes cerca de la salida son grandes: con un LR alto desde el paso 1 diverge. Por eso BERT usa warmup (10,000 pasos) y los post-LN profundos son difíciles de entrenar. Pre-LN, x ← x + F(LN(x)), deja una autopista residual sin normalizar y entrena estable sin warmup (Xiong et al., ICML 2020); es lo que usan GPT-2, ViT, Llama y ModernBERT, con una LayerNorm final. Post-LN, cuando entrena bien, a veces da algo mejor resultado final; en la práctica, pre-LN gana por robustez.`,
              say: 'BERT uses post-layer-norm, normalizing after each residual addition, which makes gradients near the output large at initialization, so it needs learning-rate warmup and is harder to train deep. Pre-layer-norm keeps a clean residual path and trains stably, which is why modern models use it.',
              why: 'Detalle que separa a quien leyó el código. Se anota la fórmula de cada uno, el warmup y quién usa cuál.' },
            { q: 'Why did RoBERTa remove NSP? What else changed?',
              junior: 'Porque NSP era muy difícil.',
              senior: R`Al contrario: NSP es demasiado fácil (97–98 % en BERT), porque una oración al azar suele ser de otro tema y el modelo la detecta por tema, no por coherencia. RoBERTa (Tabla 2) comparó formatos de entrada: con oraciones contiguas hasta 512 tokens y sin NSP, iguala o mejora a BERT con NSP (SQuAD 2.0 79.1 vs 78.7, MNLI 84.7 vs 84.0); la caída que veía BERT al quitarla venía de seguir usando segmentos cortos. Además: masking dinámico, batches de 8K con β₂ = 0.98, 10× más datos (160 GB), más pasos y BPE de bytes de 50K. Ninguno toca la arquitectura: la lección es que BERT estaba sub-entrenado.`,
              say: 'NSP is too easy because random sentences usually differ in topic, so it teaches topic detection rather than coherence. RoBERTa showed that training on full contiguous sentences without NSP matches or beats it, and that BERT was undertrained: dynamic masking, much larger batches, ten times more data and longer training.',
              why: 'Se anota por qué NSP es fácil, el experimento de formatos y la lista de cambios de receta.' },
            { q: 'How do you fine-tune BERT for extractive QA? What are the outputs and the loss?',
              junior: 'Le paso la pregunta y genera la respuesta.',
              senior: R`No genera: extrae un tramo. Entrada: [CLS] pregunta [SEP] párrafo [SEP], con segmento A para la pregunta y B para el párrafo. Se aprenden dos vectores S y E de dimensión D: la probabilidad de que el token i sea el inicio es softmax<sub>i</sub>(S·h<sub>i</sub>) sobre los tokens del párrafo, igual para el fin con E. La pérdida es la suma de las log-verosimilitudes del inicio y del fin correctos. En inferencia, el tramo (i, j) con j ≥ i que maximiza S·h<sub>i</sub> + E·h<sub>j</sub>, con un largo máximo. Si el párrafo pasa de 512 tokens, ventanas con solapamiento (stride). Para SQuAD 2.0 (preguntas sin respuesta), el tramo "nulo" es apuntar al [CLS] y se compara su score con el mejor tramo y un umbral.`,
              say: 'Question and passage are packed with a separator, and two learned vectors score every passage token as the start or the end of the answer span via a softmax over positions. Training maximizes the log-likelihood of the gold start and end; at inference I pick the best valid span. Long passages use overlapping windows, and unanswerable questions point to the CLS token.',
              why: 'Trampa: "genera". Se anota S y E, el softmax sobre posiciones, el tramo válido, las ventanas y SQuAD 2.0.', trap: true },
            { q: 'Your documents are 3,000 tokens long. How do you classify them with BERT?',
              junior: 'Pongo max_length = 3000.',
              senior: R`No se puede: la tabla de posiciones tiene ${cf('posMax')} filas y con max_length mayor falla o, con <code>truncation=True</code>, corta en silencio. Opciones: (1) truncar con criterio (las primeras ${cf('posMax')} y, si sirve, las últimas: en muchos documentos el comienzo y el final concentran la información); (2) ventanas de ${cf('posMax')} con solapamiento, clasificar cada una y agregar (max, promedio, o un pequeño modelo encima de los [CLS] de cada ventana); (3) un encoder de contexto largo: ModernBERT (8,192, RoPE, atención local + global) o Longformer/BigBird; (4) si el costo importa, un modelo de embeddings + un clasificador liviano sobre los embeddings de los trozos. Elijo midiendo en un set de validación con documentos largos de verdad.`,
              say: 'BERT has learned positions only up to five hundred twelve, so I either truncate deliberately, keeping head and tail, slide overlapping windows and aggregate their predictions, or switch to a long-context encoder like ModernBERT with eight thousand tokens. I validate on genuinely long documents.',
              why: 'Trampa: max_length. Se anota el límite por la tabla de posiciones, las ventanas, la agregación y ModernBERT.', trap: true },
            { q: 'How does compute scale with sequence length in BERT? At 512 tokens, is attention the bottleneck?',
              junior: 'Es cuadrático en el largo, así que la atención siempre domina.',
              senior: R`Por capa: lineales T·(4D² + 2·D·D<sub>mlp</sub>) = T·12D² MACs; QKᵀ y A·V, 2·T²·D. Se igualan en T = 2D + D<sub>mlp</sub> = 6D = ${met('cross')} tokens. A T = ${cf('T')}, la parte cuadrática es ${met('attn')} de los MACs del encoder; a 512, ${est('≈ 10 %')} (el explorador de <a href="#bert.costo">costo</a>). Así que a largos de BERT los <b>FLOPs</b> son lineales en la práctica. Lo cuadrático pega en <b>memoria</b>: los scores h×T×T por capa, que FlashAttention no materializa. Y a T de miles (ModernBERT a 8K), la atención sí domina: por eso usa ventanas locales de 128 en dos de cada tres capas.`,
              say: 'Per layer the linear layers cost about twelve d-squared per token and the score and value products cost two T-squared d, so they only cross around six times d, about four and a half thousand tokens for BERT-base. At BERT lengths compute is dominated by the linear layers; the quadratic cost shows up in memory for the attention scores.',
              why: 'Trampa: "la atención domina". Se anota la cuenta, el cruce en T = 6D y memoria vs cómputo.', trap: true },
            { q: 'You have 2,000 labeled support tickets and 20 classes. Fine-tune BERT or use an LLM?',
              junior: 'Un LLM, que es mejor en todo.',
              senior: R`Depende de volumen, latencia y cuánto cambian las clases, pero mi primer experimento sería barato y comparable: (1) baseline zero/few-shot con un LLM sobre el set de validación (sin entrenar nada, me dice el techo fácil); (2) fine-tuning de un encoder (DeBERTa-v3-base o ModernBERT) con 2,000 ejemplos: unos minutos en una GPU, con 3–5 semillas por la inestabilidad con pocos datos; (3) si las clases cambian seguido o hay muy pocos ejemplos por clase, un modelo de embeddings + un clasificador lineal (o kNN) que se reentrena en segundos. Para producción, con millones de tickets: el encoder cuesta ${est('órdenes de magnitud menos')} por ticket y responde en ms. Uso el LLM para etiquetar más datos o para la cola de casos de baja confianza.`,
              say: 'I would run a few-shot LLM baseline and fine-tune a small encoder in parallel, with several seeds because two thousand examples is small. At production volume the encoder is orders of magnitude cheaper and faster, so I would serve it and use the LLM to label more data or to handle low-confidence cases.',
              why: 'Se anota que se mide, el costo por request, las semillas y el rol del LLM como etiquetador.' },
            { q: 'Your BERT-base classifier must serve 2,000 requests per second at p99 under 20 ms. What do you do?',
              junior: 'Pongo más réplicas.',
              senior: R`Primero la cuenta: el encoder hace ${met('encMacs')} por secuencia de ${cf('T')} tokens; 2,000 req/s son ${est('≈ 2.2·10¹³ MACs/s')}, ${est('≈ 45 TFLOPs')} sostenidos: una GPU moderna lo hace con batch, una CPU no. Palancas, en orden de ganancia por esfuerzo: (1) <b>batching dinámico</b> en el servidor (Triton, TorchServe): juntar requests durante 2–5 ms y correr un batch. Es la palanca más grande, y esa espera entra en el p99. (2) <b>Padding</b>: bucketing por largo; si el texto medio tiene 40 tokens, no pagues ${cf('T')}. (3) <b>Runtime</b>: ONNX Runtime o TensorRT en fp16 (int8 dinámico en CPU), con fusión de kernels y SDPA: ${est('2–4×')} sin tocar el modelo. (4) <b>Destilar</b> a DistilBERT o MiniLM y medir la caída en el set de validación. (5) <b>Cache</b> por hash del texto si hay repetidos. (6) Recién después, réplicas para el pico y autoscaling. Mido el p99 bajo carga real, con la cola incluida, no la latencia de un forward aislado.`,
              say: 'Two thousand requests per second of a hundred-twenty-eight-token BERT-base is about forty-five teraFLOPs sustained, so I batch dynamically on a GPU server, bucket by length to avoid padding, export to ONNX or TensorRT in fp16 or int8, distill to a smaller encoder if needed, cache repeated inputs, and only then add replicas, measuring p99 under real load including queueing.',
              why: 'Se anota la cuenta de FLOPs, el batching dinámico (y lo que cuesta en el p99), el padding, el runtime, la destilación y medir bajo carga.' },
            { q: 'What does fine-tuning actually update, and how is it different from using BERT as a feature extractor?',
              junior: 'Solo se entrena la cabeza.',
              senior: R`En el fine-tuning estándar se actualizan <b>todos</b> los pesos de BERT más la cabeza, con LR chico (2e-5 a 5e-5) y pocas épocas: el encoder entero se adapta. Feature-based (linear probe) congela BERT y entrena solo lo de arriba: más barato, permite precalcular, y el paper muestra que con las 4 últimas capas concatenadas se queda a 0.3 F1 del fine-tuning en NER (Tabla 7). Intermedio: congelar las primeras capas, o LoRA/adapters (<a href="#lora">LoRA</a>) cuando sirves muchas tareas sobre una base. Riesgo del fine-tuning completo: olvido y sobreajuste con pocos datos.`,
              say: 'Standard fine-tuning updates every BERT weight plus the head with a small learning rate for a few epochs. A feature-based approach freezes BERT and trains only a head on its outputs, which the paper shows is within a fraction of a point on NER when concatenating the last four layers.',
              why: 'Trampa: "solo la cabeza". Se anota todo vs congelado, la Tabla 7 y LoRA como intermedio.', trap: true },
            { q: 'Why is ALBERT so much smaller than BERT, and is it faster?',
              junior: 'Es más chico, así que es más rápido.',
              senior: R`Dos trucos de parámetros, no de cómputo: (1) factoriza la tabla de embeddings en V×E · E×D con E = 128 (ataca el término V·D, más de un quinto de BERT-base); (2) comparte los pesos entre todas las capas. ALBERT-base tiene 12M parámetros contra 108M, pero hace las mismas ${cf('L')} capas de atención + FFN por token: los FLOPs son los de BERT-base. ALBERT-xxlarge, con D grande, es ≈ 3× <b>más lento</b> de entrenar que BERT-large aunque tenga menos parámetros. Lección: parámetros ≠ FLOPs ≠ latencia.`,
              say: 'ALBERT factorizes the embedding matrix and shares weights across layers, so it has far fewer parameters, but every token still goes through the same number of layer computations, so the FLOPs are those of a BERT with the same depth and width. Fewer parameters is not faster inference.',
              why: 'Trampa: parámetros vs FLOPs. Se anota la factorización, el weight sharing y que el cómputo no baja.', trap: true },
            { q: 'How does ELECTRA improve on MLM, and why is it more sample-efficient?',
              junior: 'Enmascara más tokens.',
              senior: R`MLM aprende solo del 15 % de las posiciones por secuencia. ELECTRA usa un generador MLM chico (≈ 1/4 a 1/2 del ancho del discriminador) para reemplazar los tokens enmascarados por candidatos plausibles, y entrena al discriminador a clasificar <b>cada</b> token como original o reemplazado: la pérdida cubre el 100 % de las posiciones, y el discriminador nunca ve [MASK] (no hay discrepancia con el fine-tuning). En la ablación, limitar su pérdida al 15 % baja GLUE de 85.0 a 82.4; ELECTRA-Small entrenado 4 días en una GPU supera a GPT. Detalle: no es una GAN, el generador se entrena por máxima verosimilitud, no para engañar.`,
              say: 'Masked language modeling only learns from the fifteen percent of masked positions. ELECTRA lets a small generator fill in masked tokens and trains the discriminator to detect, at every position, whether the token was replaced, so the loss covers all tokens and the mask token never reaches the main model.',
              why: 'Se anota "aprende de todos los tokens", el generador chico, la ablación y que no es GAN.' },
            { q: 'Implement MLM masking for a batch. What do the inputs and labels look like?',
              junior: 'Reemplazo el 15 % por [MASK] y las labels son los ids.',
              senior: R`Para un batch de ids (B, T): (1) probabilidad 0.15 en cada posición, 0 en especiales y padding; sorteo Bernoulli → posiciones elegidas; (2) labels = ids originales en las elegidas y −100 en el resto (la entropía cruzada de PyTorch ignora −100 por defecto); (3) un segundo sorteo uniforme por posición: &lt; 0.8 → [MASK], entre 0.8 y 0.9 → un id al azar, el resto queda igual; (4) devolver inputs corrompidos y labels. Bugs típicos: enmascarar [CLS]/[SEP]/padding, poner −100 en las que quedaron iguales (entonces no aprende a "desconfiar"), usar dos sorteos independientes con probabilidades sin re-escalar (la del token al azar debe ser 0.1/0.2 = 0.5 del resto, como en HF), y el masking estático (sortear una vez en el preprocesamiento). El ejercicio está en <a href="#bert.practica">práctica</a>, verificado contra <code>DataCollatorForLanguageModeling</code>.`,
              say: 'I sample a Bernoulli mask with probability fifteen percent over non-special tokens, set labels to the original ids at selected positions and minus one hundred elsewhere, then replace eighty percent of the selected positions with the mask id, ten percent with a random id and leave ten percent unchanged. I re-sample every batch, which is dynamic masking.',
              why: 'Se anota la forma de inputs y labels, el −100, los especiales y los bugs.' },
            { q: 'How would you adapt BERT to Spanish legal documents with little labeled data?',
              junior: 'Fine-tuning directo con lo que tengo.',
              senior: R`Primero el encoder de partida: uno multilingüe (XLM-R, mDeBERTa) o uno en español (BETO, MarIA) antes que bert-base-uncased, cuyo vocabulario inglés y sin acentos parte el español en demasiadas piezas (mido la fertilidad: tokens por palabra). Si tengo mucho texto legal sin etiquetas: <b>preentrenamiento continuado</b> con MLM en ese corpus (domain-adaptive pretraining) unas decenas de miles de pasos, con LR bajo, y recién después el fine-tuning con mis pocas etiquetas. Con pocos datos: varias semillas, early stopping, y comparar contra un baseline de embeddings + clasificador lineal y uno few-shot con LLM. Si los documentos son largos, ventanas o un encoder de contexto largo.`,
              say: 'I would start from a multilingual or Spanish encoder rather than English uncased BERT, check the tokenizer fertility, continue masked-language-model pretraining on the unlabeled legal corpus, and only then fine-tune on the few labels with several seeds, comparing against an embedding-plus-linear baseline and a few-shot LLM.',
              why: 'Se anota tokenizador y fertilidad, preentrenamiento continuado con MLM y los baselines.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cuánto ocupan los pesos de BERT-base en fp16, y cuánta memoria pide su fine-tuning con AdamW?',
              a: R`${qn('params.total')} × 2 bytes ${est('≈ 220 MB')} en fp16. Fine-tuning con AdamW en precisión mixta: ≈ 16 bytes por parámetro ${est('≈ 1.8 GB')} antes de activaciones (la cuenta está en <a href="#lora.puente">LoRA</a>); con batch 32 × 128 tokens las activaciones son del mismo orden. Cabe holgado en cualquier GPU moderna: por eso nadie hace LoRA sobre BERT-base por memoria (sí para servir muchas tareas).` },
            { q: 'Cargas un checkpoint de BERT y la accuracy es de azar, sin errores. ¿Qué revisas?',
              a: 'Que el tokenizador sea el del checkpoint (cased vs uncased, vocabulario), que los token_type_ids y la attention_mask lleguen (sin máscara de padding, el modelo atiende al relleno), que la cabeza nueva se haya inicializado y entrenado (el warning de "weights not initialized" es normal para la cabeza, no para el encoder), que el pooler exista si tu cabeza lo usa, y que el LR no sea de 1e-3 (con post-LN y sin warmup, el fine-tuning diverge).' },
            { q: 'Con T = 128, ¿qué fracción de los tokens de entrada es [MASK] en el preentrenamiento?',
              a: R`≈ 0.15 × 0.8 = 12 % de los tokens no especiales (${met('toMask')} de ${met('masked')} elegidos en el calculador); otros ≈ 1.5 % son un token al azar y ≈ 1.5 % quedan iguales pero igual tienen etiqueta.` },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (los calcula el calculador) y al final el ejercicio de código que más se pide sobre BERT: la función de masking de MLM.` },
          { t: 'h3', text: 'Diagrama en blanco' },
          { t: 'blankdiagram', diagram: 'bert-overview', slots: [
            { node: 'embed', ask: 'label', hint: 'token + posición + segmento' },
            { node: 'embed', tensor: T.x0, ask: 'shape' },
            { node: 'mlm-head', ask: 'label', hint: 'una distribución sobre el vocabulario por posición' },
            { node: 'mlm-head', tensor: T.mlm, ask: 'shape' },
            { node: 'pooler', ask: 'label', hint: 'tanh sobre el [CLS]' },
            { node: 'nsp-head', tensor: T.nsp, ask: 'shape' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'bert', pool: 'all', configs: [C, LG] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Duplicas T de ${cf('T')} a 256 tokens. ¿Por qué factor cambian los MACs del encoder?`, change: { T: 256 }, ask: 'encoderMacs',
              explain: 'Un poco más de ×2: las lineales crecen ×2 (lineales en T) y QKᵀ y A·V ×4, pero a estos largos son una parte chica.' },
            { q: 'Mismo cambio, T = 256. ¿Qué pasa con los parámetros?', change: { T: 256 }, ask: 'params',
              explain: 'Nada: T no toca ningún peso mientras no pases de las posiciones aprendidas.' },
            { q: 'T = 512, el máximo. ¿Qué parte de los MACs del encoder es QKᵀ y A·V?', change: { T: 512 }, ask: 'attnScoreShareEncoder',
              explain: 'Sube, pero sigue siendo minoría: la parte cuadrática iguala a las lineales recién en T = 2D + D_mlp = 4,608.' },
            { q: 'T = 512. ¿Por qué factor cambian los MACs de QKᵀ y A·V respecto de T = 128?', change: { T: 512 }, ask: 'scoreMacs',
              explain: '×16: son 2·T²·D por capa. En memoria, los h×T×T scores también crecen ×16: es lo que FlashAttention evita materializar.' },
            { q: 'T = 512. ¿Y los MACs de la cabeza de MLM sobre todas las posiciones?', change: { T: 512 }, ask: 'mlmHeadMacs',
              explain: '×4: es una lineal por posición (T × D × V). Por eso la implementación original la aplica solo a las posiciones elegidas.' },
            { q: R`Con T = 512, ¿cuántas posiciones elige el MLM por secuencia?`, change: { T: 512 }, ask: 'mlmPredictions',
              explain: '⌈0.15·T⌉ = 77: ≈ ×4 respecto de T = 128. El README original pide fijar max_predictions_per_seq en ≈ T·0.15 (solo da el ejemplo de 20 a T = 128); las recetas públicas a T = 512 usan 76–80, p. ej. 80 en la de NVIDIA.' },
          ] },

          { t: 'h3', text: 'Escríbelo: el masking de MLM, contra Hugging Face' },
          { t: 'p', html: R`Sin mirar: una función <code>mlm_mask(input_ids, special_mask, mask_id, vocab_size)</code> que (1) elija cada token no especial con probabilidad 0.15, (2) ponga −100 en las etiquetas de las posiciones no elegidas, (3) reemplace el 80 % de las elegidas por [MASK], el 10 % por un id al azar y deje el 10 % igual, y (4) devuelva <code>(inputs, labels)</code>. Después, compara las estadísticas con <code>DataCollatorForLanguageModeling</code>. Verificado en el venv del Atlas (PyTorch 2.14, transformers 5.19) con un vocabulario WordPiece de juguete de 1,000 piezas y 16,384 secuencias de 128 tokens: elegidos 14.98 % de los no especiales; de los elegidos, [MASK] 79.9 %, otro token 10.1 %, igual 10.0 % (el collator de HF da lo mismo dentro del ruido de muestreo: 15.0 %, 80.0 %, 9.9 %, 10.1 %, con variaciones en la tercera cifra entre corridas); ningún especial elegido, ningún cambio fuera de los elegidos, y las etiquetas son los ids originales. Por secuencia, el número de elegidos varía (media 14.7, desvío 3.5).` },
          { t: 'code', title: 'Solución de referencia (PyTorch)', files: [
            { name: 'mlm_mask.py', lang: 'python', code: [
              'import torch',
              '',
              '',
              'def mlm_mask(input_ids, special_mask, mask_id, vocab_size, p=0.15, p_mask=0.8, p_rand=0.1, generator=None):',
              '    """input_ids: (B, T) long; special_mask: (B, T) bool ([CLS], [SEP], [PAD] = True).',
              '    Devuelve (inputs, labels): labels = id original en las posiciones elegidas y -100 en el resto."""',
              '    labels = input_ids.clone()',
              '    prob = torch.full(input_ids.shape, p)',
              '    prob.masked_fill_(special_mask, 0.0)                       # nunca se eligen tokens especiales ni padding',
              '    selected = torch.bernoulli(prob, generator=generator).bool()',
              '    labels[~selected] = -100                                   # la pérdida solo mira las posiciones elegidas',
              '',
              '    inputs = input_ids.clone()',
              '    u = torch.rand(input_ids.shape, generator=generator)       # un solo sorteo decide 80 / 10 / 10',
              '    to_mask = selected & (u < p_mask)',
              '    to_rand = selected & (u >= p_mask) & (u < p_mask + p_rand)',
              '    inputs[to_mask] = mask_id                                  # 80 %: [MASK]',
              '    rand_ids = torch.randint(vocab_size, input_ids.shape, generator=generator)',
              '    inputs[to_rand] = rand_ids[to_rand]                        # 10 %: un token al azar',
              '    return inputs, labels                                      # 10 % restante: el token queda igual',
            ] },
            { name: 'check_vs_hf.py', lang: 'python', code: [
              'import torch',
              'from transformers import BertTokenizer, DataCollatorForLanguageModeling',
              'from mlm_mask import mlm_mask',
              '',
              '# Vocabulario WordPiece de juguete (sin descargar nada): 5 especiales + 995 piezas',
              "words = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]'] + [f'w{i}' for i in range(995)]",
              'tok = BertTokenizer(vocab={w: i for i, w in enumerate(words)})',
              'V, MASK = len(tok), tok.mask_token_id',
              '',
              'g = torch.Generator().manual_seed(0)',
              'ids = torch.randint(5, V, (16384, 128), generator=g)',
              'ids[:, 0] = tok.cls_token_id; ids[:, 63] = tok.sep_token_id; ids[:, -1] = tok.sep_token_id',
              'ids[:, 100:127] = tok.pad_token_id                             # padding: tampoco se elige',
              'special = (ids == tok.cls_token_id) | (ids == tok.sep_token_id) | (ids == tok.pad_token_id)',
              '',
              'def stats(inp, lab):',
              '    sel = lab != -100; s = sel.sum().item()',
              "    return {'elegidos': s / (~special).sum().item(),",
              "            'mask': (sel & (inp == MASK)).sum().item() / s,",
              "            'azar': (sel & (inp != MASK) & (inp != ids)).sum().item() / s,",
              "            'igual': (sel & (inp == ids)).sum().item() / s,",
              "            'especiales elegidos': (sel & special).sum().item(),",
              "            'cambios fuera': ((~sel) & (inp != ids)).sum().item()}",
              '',
              'mine = mlm_mask(ids, special, MASK, V, generator=torch.Generator().manual_seed(1))',
              'hf = DataCollatorForLanguageModeling(tok, mlm_probability=0.15).torch_mask_tokens(',
              '    ids.clone(), special_tokens_mask=special.clone())',
              "print('mío', stats(*mine))   # elegidos 0.1498 · mask 0.7993 · azar 0.1006 · igual 0.1001 · 0 · 0",
              "print('HF ', stats(*hf))     # ≈ 0.150 · ≈ 0.800 · ≈ 0.099 · ≈ 0.101 · 0 · 0 (varía entre corridas)",
              'sel = mine[1] != -100',
              "print(bool((mine[1][sel] == ids[sel]).all()))                   # True: las labels son los ids originales",
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los bugs que este ejercicio atrapa', html: R`<p>(1) Elegir [CLS], [SEP] o padding: el modelo aprende a predecir especiales triviales. (2) Poner −100 también en las posiciones que quedaron iguales: el 10 % "igual" deja de enseñar algo. (3) Dos sorteos independientes con 0.8 y 0.1 sin re-escalar: el token al azar sale en 0.2 × 0.1 = 2 % de los elegidos y no en 10 % (HF re-escala a 0.1/0.2 = 0.5 del resto; aquí lo resuelve un solo sorteo uniforme). (4) Enmascarar una sola vez en el preprocesamiento (masking estático): cada época ve las mismas posiciones; RoBERTa sortea en cada batch. (5) El id al azar puede caer en un especial (HF también lo permite: sortea entre todos los ids); el script original sorteaba entre todo el vocabulario.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. Lo siguiente: <a href="#retrieval">embeddings y retrieval</a>, donde BERT se vuelve un bi-encoder (dos textos por separado, un vector cada uno) o un cross-encoder (los dos juntos, un score).</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'bert-01', kind: 'concepto', q: '¿Qué es BERT en una línea?', a: 'Un transformer encoder-only con atención bidireccional, preentrenado con masked language modeling (y NSP) y ajustado por tarea con una cabeza chica.' },
      { id: 'bert-02', kind: 'concepto', q: 'MLM: ¿qué fracción se elige y qué se hace con ella?', a: '15 % de los tokens (no especiales): 80 % → [MASK], 10 % → token al azar, 10 % → igual. La pérdida solo en esas posiciones.' },
      { id: 'bert-03', kind: 'concepto', q: '¿Por qué 80/10/10 y no 100 % [MASK]?', a: '[MASK] no aparece en el fine-tuning (discrepancia); el 10 % al azar obliga a representar bien todos los tokens; el 10 % igual sesga hacia la palabra observada. En la Tabla 8, con fine-tuning casi da igual; con features congeladas, sí importa.' },
      { id: 'bert-04', kind: 'trampa', q: '"BERT reemplaza el 15 % de los tokens por [MASK]."', a: 'Elige el 15 %; solo el 80 % de esos lleva [MASK] (≈ 12 % de la entrada). La pérdida cubre también los que quedaron iguales o al azar.' },
      { id: 'bert-05', kind: 'concepto', q: 'NSP: qué es y qué pasó con ella.', a: '¿B sigue a A? 50/50 con oraciones al azar; 97–98 % de accuracy porque se resuelve por tema. RoBERTa mostró que quitarla iguala o mejora; ningún encoder moderno la usa.' },
      { id: 'bert-06', kind: 'formula', q: 'Embedding de entrada de BERT.', a: R`\(X_0 = \mathrm{LN}(E_\text{tok}[\text{ids}] + E_\text{pos} + E_\text{seg})\): token + posición aprendida + segmento (A/B), y LayerNorm.` },
      { id: 'bert-07', kind: 'formula', q: 'Una capa post-LN de BERT.', a: R`\(H = \mathrm{LN}(X + \mathrm{MHSA}(X))\), \(X' = \mathrm{LN}(H + \mathrm{FFN}(H))\): la LayerNorm después de cada suma residual.` },
      { id: 'bert-08', kind: 'trampa', q: '"BERT es pre-LN como ViT."', a: 'Post-LN: LN(x + F(x)). Necesita warmup; pre-LN (ViT, GPT-2, Llama, ModernBERT) entrena estable sin warmup.' },
      { id: 'bert-09', kind: 'conteo', q: 'Parámetros de BERT-base con las cabezas de preentrenamiento.', a: R`${qn('params.total')} (el "110M" del paper); el cuerpo sin pooler ni cabezas, ${met('body')}.` },
      { id: 'bert-10', kind: 'conteo', q: 'Parámetros de los embeddings de BERT-base y su proporción.', a: R`${met('emb')}: ${met('embShare')} del total. Más de un quinto es una tabla que no cuesta FLOPs.` },
      { id: 'bert-11', kind: 'conteo', q: 'Parámetros de una capa de BERT-base.', a: R`${met('layer')} ≈ 12·D² (atención 4D² + FFN 8D², más biases y dos LayerNorm).` },
      { id: 'bert-12', kind: 'forma', q: 'Salida del encoder de BERT-base para T = 128.', a: R`${sh('h')}: un vector de ${cf('D')} por token.` },
      { id: 'bert-13', kind: 'forma', q: 'Logits de la cabeza de MLM para T = 128.', a: R`${sh('mlm')}: una distribución sobre el vocabulario por posición (la pérdida usa solo las elegidas).` },
      { id: 'bert-14', kind: 'concepto', q: '¿Qué es el weight tying de la cabeza de MLM?', a: 'La matriz que proyecta a V logits es la tabla de embeddings de entrada transpuesta: ahorra V·D parámetros.' },
      { id: 'bert-15', kind: 'concepto', q: '¿Qué es el pooler?', a: 'Una lineal D → D con tanh sobre la salida del [CLS]; se entrenó para NSP y alimenta la cabeza de clasificación.' },
      { id: 'bert-16', kind: 'trampa', q: '"Uso bert-base-uncased para texto en español."', a: 'Pasa todo a minúsculas y quita acentos ("Canción" → "cancion"), y su vocabulario inglés parte el español en muchas más piezas: usa un encoder multilingüe o en español (XLM-R, BETO) y mide la fertilidad (tokens por palabra).' },
      { id: 'bert-17', kind: 'concepto', q: 'Las cabezas de fine-tuning del paper.', a: 'Clasificación de pares y de una frase (lineal sobre el [CLS]/pooler), etiquetado de tokens (lineal por token) y QA extractiva (vectores S y E de inicio y fin). Los pares entran como A [SEP] B con segmentos.' },
      { id: 'bert-18', kind: 'formula', q: 'QA extractiva: probabilidad de inicio del token i.', a: R`\(P_\text{inicio}(i) = \mathrm{softmax}_i(S\cdot h_i)\); igual para el fin con E; el tramo maximiza S·h_i + E·h_j con j ≥ i.` },
      { id: 'bert-19', kind: 'concepto', q: 'WordPiece en una línea.', a: 'Subpalabras por match más largo de izquierda a derecha; las continuaciones llevan ##; puede dar [UNK]. BERT-base: vocabulario de ≈ 30K (uncased: minúsculas sin acentos).' },
      { id: 'bert-20', kind: 'concepto', q: 'Segment (token-type) embeddings: ¿para qué?', a: 'Distinguir el texto A del B en una entrada de pares (NSP, NLI, QA, reranking). Dos filas aprendidas.' },
      { id: 'bert-21', kind: 'conteo', q: 'Batch y pasos del preentrenamiento de BERT.', a: '256 secuencias por paso; 1M pasos (≈ 40 épocas sobre 3.3B palabras, contando 512 tokens por secuencia); el 90 % de los pasos a T = 128 (32,768 tokens por paso) y el 10 % final a 512 (131,072, que el paper redondea a 128,000).' },
      { id: 'bert-22', kind: 'conteo', q: 'Hiperparámetros de fine-tuning de BERT.', a: 'Batch 16 o 32, LR 5e-5 / 3e-5 / 2e-5, 2–4 épocas, dropout 0.1.' },
      { id: 'bert-23', kind: 'concepto', q: 'RoBERTa: qué cambió.', a: 'Solo la receta: sin NSP, masking dinámico, batches de 8K (β₂ = 0.98), 160 GB de texto, más pasos, BPE de bytes de 50K.' },
      { id: 'bert-24', kind: 'concepto', q: 'Masking estático vs dinámico.', a: 'Estático: se sortea una vez en el preprocesamiento (BERT, con 10 copias). Dinámico: en cada batch (RoBERTa, el collator de HF).' },
      { id: 'bert-25', kind: 'concepto', q: 'ELECTRA en una línea.', a: 'Un generador MLM chico reemplaza tokens; el discriminador clasifica cada token como original o reemplazado: aprende de todos los tokens, no del 15 %.' },
      { id: 'bert-26', kind: 'trampa', q: '"ALBERT tiene 12M parámetros, así que es 9× más rápido que BERT-base."', a: 'No: comparte pesos entre capas y factoriza la tabla, pero cada token pasa por las mismas capas. Mismos FLOPs que BERT-base.' },
      { id: 'bert-27', kind: 'concepto', q: 'DistilBERT en una línea.', a: 'Mitad de capas, destilado de BERT (soft targets + MLM + coseno); 66M parámetros, 60 % más rápido, 97 % de GLUE.' },
      { id: 'bert-28', kind: 'concepto', q: 'DeBERTa en una línea.', a: 'Atención desacoplada (contenido y posición relativa en vectores separados) y posiciones absolutas recién antes de la cabeza de MLM.' },
      { id: 'bert-29', kind: 'concepto', q: 'ModernBERT en una línea.', a: 'Encoder de 2024: pre-LN, RoPE, GeGLU, atención local + global, 8,192 tokens, 2T tokens, 30 % de masking, sin NSP.' },
      { id: 'bert-30', kind: 'tradeoff', q: 'Encoder ajustado vs LLM para clasificar tickets.', a: 'Con datos y volumen: encoder (barato, ms). Sin datos o tarea abierta: LLM zero/few-shot. El LLM sirve también para etiquetar datos para el encoder.' },
      { id: 'bert-31', kind: 'concepto', q: '¿Por qué BERT no puede generar texto token a token?', a: 'Aprende p(x_i | todo lo demás) con atención bidireccional: no hay factorización izquierda→derecha ni KV cache; cada token nuevo cambiaría a todos los anteriores.' },
      { id: 'bert-32', kind: 'concepto', q: '¿En qué largo la atención cuadrática iguala a las lineales en BERT?', a: '2T²D = 12TD² → T = 6D ≈ 4,600 tokens en BERT-base: muy por encima de 512. A largos de BERT mandan las lineales.' },
      { id: 'bert-33', kind: 'trampa', q: '"Para documentos de 3,000 tokens pongo max_length = 3000."', a: 'Las posiciones aprendidas llegan a 512: falla o trunca en silencio. Ventanas con solapamiento + agregación, o un encoder largo (ModernBERT).' },
      { id: 'bert-34', kind: 'concepto', q: 'Fine-tuning vs feature-based en BERT.', a: 'Fine-tuning ajusta todos los pesos; feature-based congela BERT. Con las 4 últimas capas concatenadas, NER queda a 0.3 F1 del fine-tuning (Tabla 7).' },
      { id: 'bert-35', kind: 'concepto', q: '¿Dónde usa BERT Grounding DINO?', a: 'Como text encoder (BERT-base): un vector por token del prompt, con máscara entre frases, para puntuar cada token contra cada caja.' },
      { id: 'bert-36', kind: 'concepto', q: 'El collator de HF vs el script original de BERT al elegir posiciones.', a: 'HF: Bernoulli(0.15) por token (el número por secuencia varía). Original: exactamente round(0.15·n) posiciones, con un tope por secuencia.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'masked language modeling (MLM)', es: 'modelado de lenguaje enmascarado', def: 'Corromper una fracción de los tokens de entrada y predecir los originales con contexto de los dos lados.', say: 'BERT is pretrained with masked language modeling.' },
      { en: 'next sentence prediction (NSP)', es: 'predicción de la oración siguiente', def: 'Clasificar si el segmento B sigue al A; parte del preentrenamiento original de BERT, eliminada por RoBERTa.', say: 'RoBERTa showed next sentence prediction is unnecessary.' },
      { en: 'encoder-only', es: 'solo encoder', def: 'Transformer con atención bidireccional que produce un vector contextual por token; no genera.', say: 'For classification we use an encoder-only model.' },
      { en: 'WordPiece', es: 'WordPiece', def: 'Tokenizador de subpalabras de BERT: match más largo de izquierda a derecha, continuaciones con ##.', say: 'The WordPiece tokenizer splits playing into play and hash-hash ing.' },
      { en: 'segment embedding (token type)', es: 'embedding de segmento', def: 'Vector aprendido que marca si un token pertenece al primer o al segundo texto de un par.', say: 'Segment embeddings tell the model which sentence a token belongs to.' },
      { en: 'pooler', es: 'pooler', def: 'Lineal con tanh sobre la salida del [CLS], entrenada con NSP.', say: 'The classifier sits on top of the pooled CLS output.' },
      { en: 'post-LN', es: 'LayerNorm después del residual', def: 'Bloque con LN(x + F(x)); el de BERT y el Transformer original. Requiere warmup.', say: 'BERT is a post-layer-norm transformer.' },
      { en: 'weight tying', es: 'pesos atados', def: 'Usar la tabla de embeddings de entrada (transpuesta) como proyección de salida al vocabulario.', say: 'The MLM decoder is tied to the input embeddings.' },
      { en: 'dynamic masking', es: 'masking dinámico', def: 'Sortear las posiciones enmascaradas en cada batch en lugar de una vez en el preprocesamiento.', say: 'We use dynamic masking, as RoBERTa does.' },
      { en: 'replaced token detection', es: 'detección de tokens reemplazados', def: 'Objetivo de ELECTRA: clasificar cada token como original o reemplazado por un generador.', say: 'ELECTRA learns from every token with replaced token detection.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
