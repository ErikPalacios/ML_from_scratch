/* =============================================================================
   Atlas de Arquitecturas — js/content/qwen2-vl.js
   Página de modelo: Qwen2-VL (Wang et al., arXiv:2409.12191, 2024), canónico Qwen2-VL-7B.
   Plantilla fija de 11 secciones (SPEC §5.3). La receta VLM básica (encoder + proyector + LLM, empalme
   en <image>, etapas de entrenamiento, pérdida solo en la respuesta, alucinación) la explica la página de
   LLaVA (js/content/llava.js): aquí se enlaza y se cuenta lo nuevo — cómo una imagen de cualquier tamaño
   se vuelve tokens (resolución dinámica, RoPE 2-D en el ViT, merger 2×2) y qué posición reciben en el LLM
   (M-RoPE), más video.
   Regla: ningún número de la arquitectura se escribe a mano. Formas, parámetros y MACs salen del
   calculador (js/arch/vlm.js, modelo qwen2-vl; bloques op/trace/params/flops/scaling/compare y
   cantidades {{config.ruta}}, SPEC §6.6). Los datos del paper citan sección o tabla; los detalles de
   implementación, el archivo de HF transformers (models/qwen2_vl) o la config del checkpoint.
   Los dos ejercicios de código se verificaron en el venv del Atlas (transformers 5.19, PyTorch 2.14):
   scratchpad f7-qwen2-vl/check_tokens.py y check_mrope.py.
   Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';
  // Configuraciones del calculador (js/arch/vlm.js).
  const C = 'qwen2-vl-7b';
  const C2 = 'qwen2-vl-2b';
  const C72 = 'qwen2-vl-72b';
  const LV = 'llava15-7b';
  // Tensores: nombre corto de la página → id del calculador.
  const TN = {
    img: 'pixels', patches: 'v-patches', vit: 'vis-feats', merged: 'vis-tokens', text: 'text-emb',
    prompt: 'prompt', logits: 'logits',
  };
  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const sh = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.shape', cfg);
  const sy = (id, cfg) => qn('tensor.' + (TN[id] || id) + '.sym', cfg);
  const np = (id, cfg) => qn('node.' + id + '.params', cfg);
  const npp = (id, cfg) => qn('node.' + id + '.paramsPct', cfg);
  const nm = (id, cfg) => qn('node.' + id + '.macsG', cfg);
  const npc = (id, cfg) => qn('node.' + id + '.macsPct', cfg);
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const mt = (k, cfg) => qn('metrics.' + k, cfg);
  // Atajos de la página.
  const VT = (cfg) => mt('visualTokens', cfg);          // tokens visuales que entran al LLM
  const NV = (cfg) => cf('Np', cfg);                    // parches que procesa el ViT (4× los anteriores)

  const PAPER = 'Wang et al., <i>Qwen2-VL: Enhancing Vision-Language Model\'s Perception of the World at Any Resolution</i>, arXiv:2409.12191 (2024)';
  const QWENVL = 'Bai et al., <i>Qwen-VL: A Versatile Vision-Language Model for Understanding, Localization, Text Reading, and Beyond</i>, arXiv:2308.12966 (2023)';
  const QWEN25 = 'Bai et al. (Qwen Team), <i>Qwen2.5-VL Technical Report</i>, arXiv:2502.13923 (2025)';
  const NAVIT = 'Dehghani et al., <i>Patch n\' Pack: NaViT, a Vision Transformer for any Aspect Ratio and Resolution</i>, NeurIPS 2023, arXiv:2307.06304';
  const PIXTRAL = 'Agrawal et al., <i>Pixtral 12B</i>, arXiv:2410.07073 (2024)';
  const INTERNVL15 = 'Chen et al., <i>How Far Are We to GPT-4V? Closing the Gap to Commercial Multimodal Models with Open-Source Suites</i> (InternVL 1.5), arXiv:2404.16821 (2024)';
  const IDEFICS3 = 'Laurençon et al., <i>Building and better understanding vision-language models: insights and future directions</i> (Idefics3), arXiv:2408.12637 (2024)';
  const VIDEOROPE = 'Wei et al., <i>VideoRoPE: What Makes for Good Video Rotary Position Embedding?</i>, arXiv:2502.05173 (2025)';
  const DFN = 'Fang et al., <i>Data Filtering Networks</i>, ICLR 2024, arXiv:2309.17425';
  const NEXT = 'Liu et al., <i>LLaVA-NeXT: Improved reasoning, OCR, and world knowledge</i> (blog, enero 2024)';
  const HFQ = 'HF transformers, <code>models/qwen2_vl</code>';

  ATLAS.register({
    id: 'qwen2-vl',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> Qwen2-VL recibe texto más una o varias imágenes <b>de cualquier tamaño y proporción</b>, o un video, y devuelve texto: respuestas, descripciones, lo que dice un documento, o cajas escritas como coordenadas. Es un VLM como <a href="#llava">LLaVA</a> (encoder de visión → proyector → LLM), con una diferencia que lo cambia todo en documentos y video: <b>no redimensiona la imagen a un cuadrado fijo</b>. La lleva al múltiplo de 28 píxeles más cercano y la convierte en un número de tokens proporcional a su área: (H/28)·(W/28). A ${cf('H')}×${cf('W')}, ${VT()} tokens visuales; a la mitad de lado, la cuarta parte.` },
          { t: 'p', html: R`Tres piezas lo hacen posible (${PAPER}, §2.1): un ViT de ≈ 675M parámetros con <b>RoPE 2-D</b> en lugar de una tabla de posiciones fija (acepta cualquier rejilla), un <b>merger</b> que funde cada bloque de 2×2 parches vecinos en un token (4× menos tokens para el LLM), y <b>M-RoPE</b> en el LLM: cada token lleva tres posiciones (tiempo, alto, ancho) en vez de una. Un video es lo mismo con más frames: se muestrean 2 por segundo y cada par de frames consecutivos se funde en un solo "tubo" de parches.` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿Qwen2-VL?', 'Por qué'], rows: [
            ['Documentos, facturas, planos, capturas de pantalla (texto chico)', 'Sí, es donde más gana', R`El texto chico sobrevive porque la imagen no se encoge a 336 px. En la ablación del paper, la resolución dinámica supera a 64 tokens fijos por mucho y empata con 3,136 fijos usando menos tokens (Tabla 7, ver <a href="#qwen2-vl.entrenamiento">entrenamiento</a>).`],
            ['Varias imágenes por prompt (multi-vista de un robot, antes/después)', 'Sí, con presupuesto', 'Cada imagen trae sus propios tokens y sus propias posiciones (h, w); los tokens se suman, así que fija min/max pixels por imagen.'],
            ['Video de minutos (resumir, preguntar qué pasó, encontrar un evento)', 'Sí, con presupuesto', 'El paper reporta comprensión de videos de más de 20 minutos (README y §1), con 2 frames por segundo y un tope de 16,384 tokens por video en entrenamiento (§2.1).'],
            ['Respuesta en tiempo real en un Jetson con imágenes grandes', 'Con cuidado', R`El ViT hace atención <b>global</b> sobre todos los parches de la imagen: su costo crece con el cuadrado del área. Baja max_pixels o usa una variante con ventanas (<a href="#qwen2-vl.variantes">Qwen2.5-VL</a>).`],
            ['Detectar o segmentar con precisión muchos objetos', 'No (solo)', R`Da cajas como <b>texto</b> (coordenadas normalizadas a [0, 1000), §2.2.1), un token a la vez y sin máscaras. Para eso, un detector (<a href="#grounding-dino">Grounding DINO</a>) o <a href="#sam">SAM</a>; el VLM decide <i>qué</i> buscar.`],
            ['Contar objetos en escenas llenas, relaciones espaciales en 3D', 'Con cuidado', 'La model card las lista como limitaciones ("insufficient counting accuracy", "weak spatial reasoning"): verifica con un detector o con geometría.'],
            ['Clasificar o buscar imágenes por similitud', 'No', R`Para eso, un modelo contrastivo (<a href="#clip">CLIP</a>): un embedding por imagen, sin generar texto.`],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Qwen2-VL is a LLaVA-style VLM whose vision side works at native resolution: the image is resized to multiples of twenty-eight, a ViT with 2-D RoPE encodes all fourteen-pixel patches, a merger fuses each two-by-two block into one token, so the LLM gets height over twenty-eight times width over twenty-eight visual tokens. In the LLM, multimodal RoPE gives each token temporal, height and width positions. Video is the same with frames sampled at two fps and pairs of frames merged."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Lo que ya viste en LLaVA, con otra forma de producir los tokens.</b> En <a href="#llava">LLaVA</a> la receta es encoder de visión → proyector → tokens empalmados en el prompt del LLM, con la pérdida solo sobre la respuesta. Qwen2-VL conserva la receta entera; cambia <b>cuántos</b> tokens produce una imagen, <b>con qué resolución</b> la mira el encoder y <b>qué posición</b> recibe cada token visual dentro del LLM.` },
          { t: 'table', caption: 'LLaVA-1.5 vs Qwen2-VL, pieza por pieza', head: ['Pieza', 'LLaVA-1.5-7B', 'Qwen2-VL-7B', '¿Nuevo?'], rows: [
            ['Entrada', R`Imagen redimensionada (y rellenada) a ${cf('H', LV)}×${cf('W', LV)}`, R`Imagen llevada al múltiplo de 28 más cercano, dentro de [min_pixels, max_pixels], con su proporción`, '<b>Cambia</b>'],
            ['Encoder de visión', 'CLIP ViT-L/14 congelado, posiciones absolutas aprendidas para una rejilla fija', R`ViT de ${cf('Lv')} capas, D = ${cf('Dv')}, parches de ${cf('P')} px, <b>RoPE 2-D</b> y sin tabla de posiciones (inicializado de DFN, §2.2); se entrena`, '<b>Cambia</b>'],
            ['Tokens por imagen', R`${VT(LV)} siempre (1 token por parche)`, R`(H/28)·(W/28): ${VT()} a ${cf('H')}×${cf('W')} (1 token por cada 2×2 parches)`, '<b>Nuevo</b>'],
            ['Proyector', 'MLP de 2 capas por token (1024 → 4096 → 4096)', R`<b>Merger</b>: LayerNorm, concatena 2×2 parches (4·${cf('Dv')}) y MLP de 2 capas a ${cf('D')}`, 'Cambia'],
            ['Posición en el LLM', 'RoPE 1-D: los 576 tokens ocupan 576 posiciones seguidas', R`<b>M-RoPE</b>: (t, h, w) por token; una imagen de g<sub>h</sub>×g<sub>w</sub> tokens avanza max(g<sub>h</sub>, g<sub>w</sub>) posiciones`, '<b>Nuevo</b>'],
            ['LLM', 'Vicuna-7B (Llama 2, MHA)', R`Qwen2-7B: ${cf('L')} capas, GQA con ${cf('G')} cabezas de KV, biases en Q/K/V`, 'Mismo esquema (<a href="#llm-decoder">decoder</a>)'],
            ['Video', '—', '2 frames por segundo; cada par de frames → un tubo de 2×14×14 (conv 3-D)', '<b>Nuevo</b>'],
            ['Entrenamiento', 'Etapa 1 solo el proyector; etapa 2 proyector + LLM; el ViT nunca', 'Etapa 1 el ViT (y el merger); etapa 2 todo; etapa 3 el LLM con instrucciones', 'Cambia'],
          ] },

          { t: 'h3', text: 'El problema: 576 tokens para todo' },
          { t: 'p', html: R`Piensa en una factura escaneada de 2480×3508 píxeles (A4 a 300 dpi). LLaVA-1.5 la reduce a ${cf('H', LV)}×${cf('W', LV)}: cada lado ≈ 10 veces más chico, el área ≈ 77 veces más chica. Un carácter de 30 píxeles de alto queda en 3: ilegible, sin importar lo bueno que sea el LLM. Y la proporción se pierde: un ticket largo y angosto, o un panorama de 16:9, se rellenan o se deforman al cuadrado. Al revés, una miniatura de 100×100 se infla a 336 y paga ${VT(LV)} tokens que no tienen información. Los tokens no siguen al contenido.` },
          { t: 'table', caption: 'Tres formas de convertir una imagen en tokens', head: ['', 'Resolución fija (LLaVA-1.5)', 'Recortes / tiling (LLaVA-NeXT AnyRes, InternVL 1.5)', 'Resolución nativa (Qwen2-VL, Pixtral)'], rows: [
            ['Qué hace', 'Redimensiona a un cuadrado fijo', 'Rejilla de recortes de 336 o 448 según la proporción + la imagen reducida', 'La imagen entera, a múltiplos de 28, en una pasada'],
            ['Tokens', R`Fijos (${VT(LV)})`, '(recortes + 1) × tokens por recorte: hasta ≈ 2,880 en LLaVA-NeXT', '∝ área: (H/28)·(W/28), con tope'],
            ['Encoder', 'Cualquier ViT preentrenado', 'Cualquier ViT, a su resolución en cada recorte', 'Uno que acepte rejillas variables (RoPE 2-D), entrenado'],
            ['Costuras', '—', 'Objetos cortados entre recortes', 'No hay: una sola rejilla'],
            ['Costo del encoder', 'Fijo', 'Lineal en recortes', 'Cuadrático en el área (atención global)'],
          ], note: R`LLaVA-NeXT: ${NEXT}. InternVL 1.5: ${INTERNVL15}. Pixtral: ${PIXTRAL}. Idefics3 (${IDEFICS3}) usa recortes de 364 px con <i>pixel shuffle</i> (169 tokens por recorte) y nombra la resolución nativa (NaViT) como el paso siguiente.` },
          { t: 'p', html: R`Con resolución nativa, el número de tokens sigue al tamaño. Mueve el tamaño de la imagen y compara las tres estrategias (conteos del calculador):` },
          { t: 'viz', kind: 'visual-tokens', params: { W: 1540, H: 2184 }, caption: 'Tokens visuales según el tamaño de la imagen: LLaVA-1.5 fijo, AnyRes escalonado y Qwen2-VL proporcional al área. Conteos del calculador.' },

          { t: 'p', html: R`Tres casos típicos, ya pasados por <code>smart_resize</code> con el default del checkpoint (hasta 16,384 tokens; alto × ancho): una foto de celular de 1280×720 queda en 728×1288; un frame 4K de 3840×2160, en 2156×3836; una página A4 escaneada a 300 dpi (2480×3508), en 3500×2492. Elige alto y ancho y mira cuántos tokens recibe el LLM, cuánto cuesta el ViT y cuánto KV cache ocupa la imagen (todo del calculador):` },
          { t: 'scaling', model: 'qwen2-vl', knobs: [{ key: 'H', values: [728, 2156, 3500] }, { key: 'W', values: [1288, 2492, 3836] }], show: ['visualTokens', 'visionMacs', 'llmPrefillMacs', 'kvBytesPerImage'] },
          { t: 'p', html: R`Con 728×1288 son 1,196 tokens; con el frame 4K o la página entera, más de 10,000, y el ViT ya cuesta más que todo el prefill del LLM: un solo prompt con una página escaneada cuesta lo que una conversación larga. Por eso el presupuesto de píxeles (min/max pixels) es parte del diseño, no un detalle (ver <a href="#qwen2-vl.inferencia">inferencia</a>).` },
          { t: 'h3', text: 'Por qué la RoPE 2-D en el ViT es lo que lo permite' },
          { t: 'p', html: R`Un ViT clásico suma a cada parche un vector aprendido de una tabla de posiciones con una entrada por casilla de su rejilla de entrenamiento (24×24 para CLIP ViT-L/14 @ 336). Con otra rejilla, la tabla no alcanza o sobra, y hay que <a href="#vit.entrenamiento">interpolarla</a>: funciona para pasar de 224 a 384, pero no para recibir en el mismo batch un ticket de 10×90 parches y una foto de 52×92. Qwen2-VL quita la tabla (§2.1) y rota q y k como en el <a href="#llm-decoder.puente">decoder de LLM</a>, pero en 2-D: la mitad de las frecuencias de cada cabeza gira con la <b>fila</b> del parche y la otra mitad con la <b>columna</b>. El producto q·k entre dos parches depende solo de su desplazamiento (Δfila, Δcolumna), y esa regla vale igual para cualquier tamaño de rejilla. No hay nada que interpolar: una rejilla más grande solo usa ángulos más grandes.` },
          { t: 'callout', kind: 'trap', title: '"RoPE 2-D extrapola gratis a cualquier resolución"', html: R`<p>Acepta cualquier rejilla, pero el modelo solo es bueno en los desplazamientos que vio entrenando. Por eso el entrenamiento ya usa resolución dinámica (imágenes de muchos tamaños, empaquetadas, §2.1) y la inferencia acota el área con max_pixels. Lo mismo que en el LLM: "soporta" no es "usa bien" (ver la extensión de contexto en <a href="#llm-decoder.entrenamiento">el decoder</a>).</p>` },

          { t: 'h3', text: 'El merger 2×2: 4 veces menos tokens para el LLM' },
          { t: 'p', html: R`El ViT trabaja a parches de ${cf('P')} px: a ${cf('H')}×${cf('W')} son ${NV()} parches. Mandarlos todos al LLM costaría 4 veces más prefill y 4 veces más KV cache. El merger toma cada bloque de 2×2 parches vecinos, concatena sus 4 vectores (4·${cf('Dv')}) y un MLP los baja a ${cf('D')}: ${VT()} tokens. Es la misma idea que el <i>patch merging</i> de <a href="#swin">Swin</a> o el <i>pixel shuffle</i> de InternVL e Idefics3: cambiar resolución espacial por canales. Por eso el "parche efectivo" que ve el LLM es de 28×28 px, y por eso la imagen se redondea a múltiplos de 28 y no de 14.` },

          { t: 'h3', text: 'M-RoPE: tres posiciones por token' },
          { t: 'p', html: R`En LLaVA, los 576 tokens visuales ocupan 576 posiciones seguidas: para el LLM, el parche de abajo a la izquierda está "576 tokens después" del de arriba a la izquierda, y dos parches vecinos en vertical están a 24 posiciones. La geometría 2-D se aplana. Qwen2-VL le da a cada token un id por eje (§2.1):` },
          { t: 'list', items: [
            R`<b>Texto</b>: el mismo id en los tres ejes (t = h = w = m). M-RoPE se reduce a la RoPE 1-D de siempre.`,
            R`<b>Imagen</b>: todos sus tokens comparten t; h es la fila y w la columna, ambos contados desde el id de inicio. Una imagen de 2×3 tokens que empieza en 3 recibe t = 3 en los seis, h ∈ {3, 4} y w ∈ {3, 4, 5}.`,
            R`<b>Video</b>: igual, y t avanza uno por cada grupo de 2 frames.`,
            R`<b>Lo que sigue a una imagen</b> arranca en max(id) + 1. Tras una imagen de g<sub>h</sub>×g<sub>w</sub> tokens, la posición avanza max(g<sub>h</sub>, g<sub>w</sub>), no g<sub>h</sub>·g<sub>w</sub>: una imagen de 1,196 tokens (26×46) consume 46 posiciones. Las posiciones crecen mucho más despacio que la secuencia.`,
          ] },
          { t: 'viz', kind: 'mrope', params: { config: C, grid: '2x3', video: false }, caption: 'Prompt ilustrativo: texto, una imagen de pocos tokens y más texto. Los ids siguen la regla de get_rope_index de HF; el reparto de frecuencias (mrope_section) y d_h salen del calculador.' },
          { t: 'callout', kind: 'trap', title: 'Qwen-VL (2023) ≠ Qwen2-VL (2024) ≠ Qwen2.5-VL (2025)', html: R`<p><b>Qwen-VL</b> (${QWENVL}): ViT-bigG de OpenCLIP (1.9B), imagen fija a 448 en la etapa 2, y un adaptador de <b>una capa de cross-attention con 256 queries aprendidas</b> (tipo Q-Former) que deja siempre 256 tokens por imagen; LLM Qwen-7B. Sin resolución dinámica ni M-RoPE. <b>Qwen2-VL</b> (esta página): resolución nativa, ViT con RoPE 2-D y atención global, merger 2×2, M-RoPE, video. <b>Qwen2.5-VL</b> (${QWEN25}): el mismo esquema con un ViT rediseñado (atención por <b>ventanas</b> de 112×112 px en casi todas las capas, RMSNorm y SwiGLU), M-RoPE con el eje t <b>alineado al tiempo absoluto</b> del video y cajas en <b>píxeles absolutos</b> en vez de normalizadas. Si en una entrevista dices "Qwen-VL usa M-RoPE", te corrigen.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Lo que ya sabes y reaparece: la receta VLM y el empalme de tokens, de <a href="#llava">LLaVA</a>; el ViT y sus parches, de <a href="#vit">ViT</a>; RoPE, GQA y SwiGLU, del <a href="#llm-decoder">decoder de LLM</a>; KV cache y prefill vs decode, de <a href="#llm-inferencia">inferencia de LLMs</a>; fundir 2×2 vecinos, del patch merging de <a href="#swin">Swin</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`De izquierda a derecha: la imagen (ya llevada a ${cf('H')}×${cf('W')}) se corta en ${NV()} parches de ${cf('P')}×${cf('P')} (duplicada en el tiempo: un tubo de 2 frames), el ViT de ${cf('Lv')} bloques con RoPE 2-D los codifica, el merger funde cada 2×2 en un token del ancho del LLM (${sh('merged')}), y esos tokens reemplazan los marcadores <code>&lt;|image_pad|&gt;</code> del prompt, entre <code>&lt;|vision_start|&gt;</code> y <code>&lt;|vision_end|&gt;</code>. El LLM (${cf('L')} capas) corre con M-RoPE y la LM head da el siguiente token. Expande el bloque del ViT y el merger; "Recorrido" sigue la imagen con números.` },
          { t: 'archdiagram', diagram: 'qwen2vl-overview', walk: 'forward', wide: true, caption: R`Qwen2-VL-7B con una imagen de ${cf('H')}×${cf('W')} y ${cf('T')} tokens de texto: ${sh('img')} → ${sh('patches')} parches → ViT → merger → ${sh('merged')} → prompt ${sh('prompt')} → LLM. Formas del calculador.` },
          { t: 'callout', kind: 'note', html: R`<p>Tres detalles del diagrama: (1) el ViT no ve el texto: la imagen se codifica una vez, sin importar la pregunta (como en LLaVA); (2) dentro del ViT, la atención es <b>global sobre los parches de una misma imagen</b> (o de un mismo par de frames): con varias imágenes, se concatenan en una secuencia y una máscara por bloques (<code>cu_seqlens</code>) impide que se mezclen; (3) la posición entra dos veces y de dos formas: RoPE 2-D (fila, columna en parches) dentro del ViT, y M-RoPE (t, h, w en tokens del LLM) dentro del LLM.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el ejemplo, sin notación, con la imagen de la configuración canónica, ${cf('H')}×${cf('W')}. (1) <b>Redimensionar</b>: el lado ya es múltiplo de 28 y el área está dentro del rango por defecto, así que se queda. (Una foto de celular de 1280×720, ancho × alto, no lo es: cada lado va al múltiplo de 28 más cercano y queda en 1288×728; las formas del calculador van alto × ancho.) (2) <b>Parches</b>: ${cf('H')}/${cf('P')} filas por ${cf('W')}/${cf('P')} columnas, ${NV()} parches; la imagen se duplica en el tiempo (${sh('v-frames')}), así que cada parche es un tubo de 2 frames × ${cf('P')}×${cf('P')} píxeles × 3 canales. (3) <b>ViT</b>: ${cf('Lv')} bloques de atención global entre los ${NV()} parches: una matriz de puntuaciones de ${sh('v-scores')} por capa. (4) <b>Merger</b>: bloques de 2×2 → ${VT()} tokens del ancho del LLM, ${sh('merged')}. (5) <b>Prompt</b>: esos tokens se empalman entre <code>&lt;|vision_start|&gt;</code> y <code>&lt;|vision_end|&gt;</code> junto a ${cf('T')} tokens de texto (${sh('prompt')}); con M-RoPE la imagen avanza solo ${cf('imagePosSpan')} posiciones (el lado de su rejilla), no ${VT()}. Ahora la notación.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'Qwen2-VL-7B'], rows: [
            ['H × W', 'imagen ya redimensionada (múltiplos de 28)', R`${cf('H')} × ${cf('W')} en el ejemplo`],
            ['P', 'lado del parche del ViT', cf('P')],
            [R`N<sub>v</sub>`, 'parches que procesa el ViT: (H/P)·(W/P)', NV()],
            [R`D<sub>v</sub>, L<sub>v</sub>, h<sub>v</sub>`, 'ancho, capas y cabezas del ViT', R`${cf('Dv')}, ${cf('Lv')}, ${cf('hv')}`],
            ['N', 'tokens visuales que entran al LLM: N<sub>v</sub>/4 = (H/28)·(W/28)', VT()],
            ['T', 'tokens de texto del prompt', cf('T')],
            ['D, L', 'ancho y capas del LLM', R`${cf('D')}, ${cf('L')}`],
            [R`(p<sup>t</sup>, p<sup>h</sup>, p<sup>w</sup>)`, 'ids de posición de M-RoPE de un token', 'texto: iguales'],
          ], note: R`El paper y HF llaman <code>grid_thw</code> a (t, H/P, W/P): la rejilla en parches del ViT. El LLM ve (t, H/28, W/28).` },

          { t: 'h3', text: 'Redimensionar: smart_resize' },
          { t: 'p', html: R`La regla exacta del image processor de HF (<code>smart_resize</code>, ${HFQ}/image_processing_qwen2_vl.py), con f = 28 = P·2:` },
          { t: 'math', display: true, tex: R`\begin{aligned}\bar h &= f\,\mathrm{round}(h/f),\qquad \bar w = f\,\mathrm{round}(w/f)\\ \text{si } \bar h\bar w > P_{\max}:&\quad \beta=\sqrt{hw/P_{\max}},\quad \bar h = \max\big(f,\ f\lfloor h/(\beta f)\rfloor\big)\ \ (\text{igual } \bar w)\\ \text{si } \bar h\bar w < P_{\min}:&\quad \beta=\sqrt{P_{\min}/(hw)},\quad \bar h = f\lceil h\beta/f\rceil\ \ (\text{igual } \bar w)\\ N &= \tfrac{\bar h}{f}\cdot\tfrac{\bar w}{f},\qquad N_v = 4N\end{aligned}`, caption: 'P_min y P_max son min_pixels y max_pixels. Redondea cada lado al múltiplo de 28 más cercano; si el área se pasa, escala por β y redondea hacia abajo (nunca supera P_max); si no llega, escala y redondea hacia arriba. Rechaza proporciones mayores a 200:1.' },
          { t: 'kv', items: [
            ['Default del checkpoint', 'min_pixels = 3,136 (4·28²) y max_pixels = 16,384·28² (≈ 12.8M píxeles): de 4 a 16,384 tokens por imagen', 'preprocessor_config.json de Qwen2-VL-7B-Instruct; README'],
            ['Presupuesto sugerido', '256·28² a 1280·28²: de 256 a 1,280 tokens por imagen, "to balance speed and memory usage"', 'README del checkpoint'],
            ['Ablación del paper', 'min_pixels = 100·28², max_pixels = 16,384·28²', '§3.3.1'],
          ] },
          { t: 'callout', kind: 'trap', title: '"Se redondea hacia arriba al múltiplo de 28"', html: R`<p>Al más <b>cercano</b> (round), así que la imagen puede achicarse unos píxeles (720 → 728 sube, 1080 → 1092 sube, 3508 → 3500 baja). Y si se pasa del área máxima, hacia <b>abajo</b> (floor) después de escalar. Por eso el número de tokens no es exactamente área/784: hay que pasar por la regla.</p>` },

          { t: 'h3', text: 'Parches: tubos de 2×14×14' },
          { t: 'op', block: 'patchify', model: 'qwen2-vl', title: 'Patch embedding 3-D (imagen = 2 frames iguales)',
            tex: R`[\mathbf x;\mathbf x]\in\mathbb R^{2\times H\times W\times 3}\ \xrightarrow{\ \mathrm{Conv3d}\ 2\times P\times P\ }\ \mathbf z_0\in\mathbb R^{N_v\times D_v},\qquad N_v=\tfrac{H}{P}\cdot\tfrac{W}{P}`,
            in: [TN.img], out: [TN.patches], params: true, flops: true,
            what: R`Cada parche es un tubo de 2 frames × ${cf('P')}×${cf('P')} píxeles × 3 canales = 1,176 números (lo que HF guarda en <code>pixel_values</code>, una fila por parche), proyectado a ${cf('Dv')} con una conv 3-D sin bias (en la práctica, una lineal de 1,176 → ${cf('Dv')}). Para una imagen, los dos frames son la misma imagen (§2.1); para un video, dos frames consecutivos. El processor ya ordena los parches por bloques de 2×2 (los 4 parches que el merger fundirá quedan consecutivos).`,
            why: R`Un solo encoder para imágenes y video: la conv 3-D de profundidad 2 hace que un token del video cubra dos frames (la mitad de tokens) y que una imagen pase por exactamente los mismos pesos. Duplicar la imagen no agrega tokens; solo hace que la mitad de los pesos de la conv vea el mismo frame.` },

          { t: 'h3', text: 'Encoder de visión: un bloque con RoPE 2-D (se repite L_v veces)' },
          { t: 'op', block: 'vit-block', model: 'qwen2-vl', title: 'ViT pre-LN con RoPE 2-D y atención global por imagen',
            tex: R`\begin{aligned}\mathbf z &\leftarrow \mathbf z + \mathrm{Attn}\big(\mathrm{R}_{2D}(\mathbf q),\ \mathrm{R}_{2D}(\mathbf k),\ \mathbf v\big),\qquad [\mathbf q,\mathbf k,\mathbf v]=\mathrm{LN}(\mathbf z)\,W_{qkv}+\mathbf b\\ \mathbf z &\leftarrow \mathbf z + \mathrm{MLP}_{\text{QuickGELU}}\big(\mathrm{LN}(\mathbf z)\big)\end{aligned}`,
            in: [TN.patches], out: [TN.vit], params: true, flops: true,
            what: R`${cf('Lv')} bloques iguales: LayerNorm → atención de ${cf('hv')} cabezas (d<sub>v</sub> = ${cf('Dv')}/${cf('hv')} = ${cf('dv')}) con Q, K, V con bias → residual → LayerNorm → MLP ${cf('Dv')} → 4·${cf('Dv')} → ${cf('Dv')} con QuickGELU (la activación de CLIP) → residual. La atención es <b>global</b> entre los N<sub>v</sub> parches de la imagen: puntuaciones de h<sub>v</sub>×N<sub>v</sub>×N<sub>v</sub> por capa. No hay CLS ni tabla de posiciones.`,
            why: R`Es un ViT de libro (<a href="#vit.operaciones">ViT</a>) salvo por la posición. Atención global porque así fue preentrenado (DFN, ${DFN}) y porque mezcla toda la imagen desde la primera capa; el precio es que su costo crece con N<sub>v</sub>²: el doble de lado da 4 veces más parches y 16 veces más puntuaciones. Qwen2.5-VL lo cambió por ventanas justamente por eso.` },
          { t: 'math', display: true, tex: R`\begin{aligned}(q_j,\ q_{j+d_v/2}) &\mapsto \big(q_j\cos\varphi_j - q_{j+d_v/2}\sin\varphi_j,\ \ q_j\sin\varphi_j + q_{j+d_v/2}\cos\varphi_j\big)\\ \varphi_j &= r\cdot\theta_v^{-4j/d_v}\quad \big(0\le j<\tfrac{d_v}{4}\big),\qquad \varphi_j = c\cdot\theta_v^{-4(j-d_v/4)/d_v}\quad \big(\tfrac{d_v}{4}\le j<\tfrac{d_v}{2}\big)\end{aligned}`, caption: R`RoPE axial 2-D de Qwen2-VL (convención de HF: rotar mitades), en q y en k. r y c son la fila y la columna del parche; θ<sub>v</sub> = ${cf('visionTheta')}. Con d<sub>v</sub> = ${cf('dv')}, 20 frecuencias giran con la fila y las mismas 20 con la columna (<code>Qwen2VLVisionRotaryEmbedding</code>). El producto de dos vectores rotados depende de (r − r', c − c').` },

          { t: 'h3', text: 'Merger: 2×2 parches → un token del LLM' },
          { t: 'op', block: 'merger', model: 'qwen2-vl', title: 'PatchMerger: LN, concatenar 2×2, MLP con GELU',
            tex: R`\mathbf u = \mathrm{group}_{2\times2}\big(\mathrm{LN}(\mathbf z)\big)\in\mathbb R^{\frac{N_v}{4}\times 4D_v},\qquad \mathbf v = \mathrm{GELU}(\mathbf u W_1+\mathbf b_1)\,W_2+\mathbf b_2\in\mathbb R^{N\times D}`,
            in: [TN.vit], out: [TN.merged], params: true, flops: true,
            what: R`Una LayerNorm por parche, después un <code>view</code> que junta los 4 parches de cada bloque 2×2 (ya vienen consecutivos) en un vector de 4·${cf('Dv')}, y un MLP de 2 capas: 4·${cf('Dv')} → 4·${cf('Dv')} → ${cf('D')}. Salida: ${sh('merged')}, un token por cada 28×28 píxeles.`,
            why: R`Hace dos cosas a la vez: el proyector de LLaVA (llevar al espacio del LLM) y una reducción de 4× en tokens. El LLM es la parte cara por token (≈ 7B parámetros contra ≈ 0.7B del ViT), así que reducir aquí ahorra 4× en prefill y en KV cache sin perder información: los 4 vectores enteros entran al MLP, no se promedian.` },

          { t: 'h3', text: 'M-RoPE en el LLM' },
          { t: 'op', block: 'mrope', model: 'qwen2-vl', title: 'M-RoPE: las frecuencias de cada cabeza se reparten entre t, h y w',
            tex: R`\varphi_j(p)=p^{\,a(j)}\cdot\theta^{-2j/d_h},\qquad a(j)=\begin{cases}t & j<16\\ h & 16\le j<40\\ w & 40\le j<64\end{cases}`,
            in: [TN.prompt], out: ['pos-ids'],
            what: R`La rotación es la de RoPE (pares (j, j + d<sub>h</sub>/2), convención de HF), pero el ángulo del par j usa la posición de <b>un</b> eje: las 16 frecuencias más rápidas, con p<sup>t</sup>; las 24 siguientes, con p<sup>h</sup>; las 24 más lentas, con p<sup>w</sup> (${HFQ}, <code>Qwen2VLRotaryEmbedding</code>). Para texto p<sup>t</sup> = p<sup>h</sup> = p<sup>w</sup>, así que es RoPE 1-D exacta. Para un token de imagen, p = (s, s + fila, s + columna), con s el id de inicio de la imagen.`,
            why: R`Con tres ejes, el producto q·k entre dos tokens de imagen depende de su desplazamiento (Δt, Δfila, Δcolumna) y no de cuántos tokens hay entre ellos en la secuencia aplanada. Y el texto sigue igual que en el LLM preentrenado. Ablación (§3.3.2, Tabla 8): frente a RoPE 1-D, M-RoPE sube MathVista de 39.2 a 43.4, MMBench de 58.6 a 60.6, NextQA de 43.9 a 46.0 y STAR de 55.5 a 57.9; RealWorldQA baja un poco (54.5 → 53.7).` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: qué eje recibe qué frecuencias. Con el reparto [16, 24, 24], el tiempo recibe las frecuencias <b>altas</b> (giran rápido) y el ancho las más bajas. VideoRoPE (${VIDEOROPE}) argumenta que el tiempo debería recibir las <b>bajas</b> para no oscilar en videos largos. Lo que sí se pregunta: texto = RoPE 1-D, imagen = (t fijo, h, w), y que la posición siguiente es max + 1.</p>` },
          { t: 'p', html: R`<b>El LLM</b> es el decoder de Qwen2-7B: el mismo esquema que en el <a href="#llm-decoder">decoder de LLM</a> (RMSNorm, GQA con ${cf('h')} cabezas de query y ${cf('G')} de KV, SwiGLU con ${cf('Dmlp')} de ancho oculto), con dos diferencias de detalle: Q, K y V llevan <b>bias</b> (Llama no) y el vocabulario es de ${cf('V')} entradas. Los tokens visuales entran como embeddings ya calculados; la LM head solo predice texto.` },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor de la configuración canónica (una imagen de ${cf('H')}×${cf('W')} y ${cf('T')} tokens de texto), en orden: parches, ViT (una capa), merger, empalme, LLM (una capa) y logits. Toca una fila para resaltar el tensor en el diagrama.` },
          { t: 'trace', model: 'qwen2-vl' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Qwen2-VL-7B tiene ${qn('params.total')} parámetros: el ViT con el merger (el módulo <code>visual</code> de HF), ${mt('visualModuleParams')} (el paper dice ≈ 675M, Tabla 1), y el LLM, ${mt('llmParams')} (el paper: 7.6B). El merger solo, ${np('merger')}; el ViT sin el merger, ${mt('visionParams')}, es ${mt('visionParamsShare')} de los parámetros. En pesos la visión es poca cosa; en cómputo, depende del tamaño de la imagen.` },
          { t: 'params', model: 'qwen2-vl', group: 'block' },
          { t: 'p', html: R`Con una imagen de ${cf('H')}×${cf('W')} y ${cf('T')} tokens de texto, el prefill cuesta ${qn('macs.text')}: el ViT ${mt('visionMacs')}, el merger ${mt('projectorMacs')} y el LLM ${mt('llmPrefillMacs')}. La parte del prefill que se debe a la imagen (ViT + merger + los tokens visuales dentro del LLM) es ${mt('prefillShareFromImage')}.` },
          { t: 'flops', model: 'qwen2-vl' },
          { t: 'callout', kind: 'trap', title: '"El ViT es barato porque tiene 10 veces menos parámetros que el LLM"', html: R`<p>En parámetros sí; en cómputo no necesariamente. El ViT procesa N<sub>v</sub> = 4N parches (4 veces más filas que el LLM) y su atención es global: sus puntuaciones crecen con N<sub>v</sub>². A resolución alta, el ViT puede costar tanto como el prefill del LLM, o más. Mira el explorador de abajo.</p>` },
          { t: 'h3', text: 'El tamaño de la imagen: dónde explota el costo' },
          { t: 'scaling', model: 'qwen2-vl', knobs: [{ key: 'H', values: [448, 812, 1092, 1652] }, { key: 'W', values: [448, 812, 1288, 1932] }], show: ['visualTokens', 'visionMacs', 'llmPrefillMacs', 'prefillShareFromImage', 'kvBytesPerImage'] },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 de lado → ×4 parches y ×4 tokens visuales. En el ViT, las lineales (QKV, proyección, MLP) crecen ×4 y QKᵀ y A·V ×16; a resolución alta manda la parte cuadrática. En el LLM, el prefill crece ≈ ×4 en lo visual (más la parte T² de la atención) y el KV cache de la imagen ×4. Los parámetros no cambian: RoPE 2-D no tiene tabla. Por eso max_pixels es la perilla de costo más importante del modelo.` },
          { t: 'h3', text: 'Video: frames' },
          { t: 'scaling', model: 'qwen2-vl', knobs: [{ key: 'frames', values: [2, 8, 32, 128] }], show: ['visualTokens', 'visionMacs', 'llmPrefillMacs', 'kvBytesPerImage'] },
          { t: 'p', html: R`Ojo con frames = 1 y 2: dan lo mismo, porque una imagen ya es un par de frames (duplicado). Desde ahí, todo crece <b>lineal</b> en el ViT: la atención del ViT es por par de frames (cada grupo temporal es su propia secuencia en <code>cu_seqlens</code>), así que duplicar los frames duplica su costo. En el LLM, los tokens también se duplican, pero la atención entre ellos es cuadrática en el total: un video largo se vuelve un prompt largo. Por eso el entrenamiento limita a 16,384 tokens por video (§2.1) y la inferencia baja la resolución por frame cuando hay muchos frames.` },
          { t: 'h3', text: '2B, 7B y 72B frente a LLaVA-1.5' },
          { t: 'compare', models: [C2, C, C72, LV], rows: ['params', 'visualTokens', 'visionMacs', 'llmPrefillMacs', 'macs', 'kvBytesPerImage'], caption: R`Misma imagen y mismo texto en las tres Qwen2-VL (el ViT de ≈ 675M es el mismo en los tres tamaños; solo cambia el ancho de salida del merger) y LLaVA-1.5-7B con su imagen fija.` },
          { t: 'p', html: R`Lectura: el ViT es <b>idéntico</b> en 2B, 7B y 72B (Tabla 1 del paper), así que en el 2B pesa mucho más en proporción: con la imagen canónica, el ViT es ${mt('visionMacsShare', C2)} de los MACs del prefill en el 2B, ${mt('visionMacsShare')} en el 7B y ${mt('visionMacsShare', C72)} en el 72B. Achicar el LLM no achica el costo de la visión. Y mira el KV cache por imagen: Qwen2-VL-7B guarda ${mt('kvBytesPerToken')} por token (GQA con ${cf('G')} cabezas de KV) contra ${mt('kvBytesPerToken', LV)} de LLaVA-1.5-7B (MHA, ${cf('h', LV)} cabezas): con más tokens por imagen (${VT()} contra ${VT(LV)}), su imagen ocupa ${mt('kvBytesPerImage')} contra ${mt('kvBytesPerImage', LV)}. El LLM importa tanto como el número de tokens. Frente a LLaVA-1.5, Qwen2-VL paga más tokens con imágenes grandes y menos con imágenes chicas: la comparación justa siempre dice el tamaño de la imagen.` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`La pérdida es la de <a href="#llava.entrenamiento">LLaVA</a>: entropía cruzada del siguiente token, solo sobre los tokens de texto (el paper: "only the text tokens receive supervision" en la cuenta de tokens, §2.2). Lo que cambia es <b>qué</b> se entrena en cada etapa y la escala del dato. Tres etapas, siguiendo a Qwen-VL (§2.2):` },
          { t: 'math', display: true, tex: R`\mathcal L = -\frac{1}{|\mathcal A|}\sum_{i\in\mathcal A}\log p_\theta\big(x_i \mid \mathbf v_{1..N},\ x_{<i}\big),\qquad \mathcal A = \text{posiciones de texto supervisadas}`, caption: 'La misma entropía cruzada del siguiente token que en LLaVA; los tokens visuales v condicionan pero no se predicen. En el instruction tuning, A son las respuestas del asistente (en el preentrenamiento, el texto de los pares y documentos).' },
          { t: 'table', caption: 'Etapas de entrenamiento de Qwen2-VL (§2.2)', head: ['Etapa', 'Qué se entrena', 'Datos', 'Para qué'], rows: [
            ['1. Preentrenamiento del ViT', 'El ViT (el paper: "exclusively on training the ViT"; en el código, el merger es parte del módulo visual); el LLM no se toca', '≈ 600B tokens de pares imagen–texto (y OCR, clasificación)', 'Alinear el ViT (inicializado de DFN, con la tabla de posiciones reemplazada por RoPE 2-D) con el espacio del LLM'],
            ['2. Preentrenamiento completo', 'Todo', '≈ 800B tokens más de datos con imágenes: texto e imagen intercalados, VQA, OCR, video, más texto puro', 'Comprensión multimodal amplia; el LLM aprende a usar M-RoPE'],
            ['3. Instruction tuning', 'El LLM (ViT congelado)', 'Conversaciones en formato ChatML: QA de imágenes, parsing de documentos, comparación de varias imágenes, video, agentes', 'Seguir instrucciones'],
          ], note: 'Total acumulado del preentrenamiento: 1.4T tokens (texto + tokens de imagen). Dato hasta junio de 2023. LLM inicializado de Qwen2; ViT de DFN (Fang et al., ICLR 2024, arXiv:2309.17425).' },
          { t: 'callout', kind: 'trap', title: '"Como en LLaVA, el encoder de visión queda congelado"', html: R`<p>Al revés: en Qwen2-VL el ViT es lo <b>primero</b> que se entrena (etapa 1) y se sigue entrenando en la etapa 2. Tiene que ser así: el checkpoint de DFN tenía posiciones absolutas para una rejilla fija; con RoPE 2-D y rejillas de cualquier tamaño, el encoder necesita aprender a usarlas. LLaVA-1.5 nunca toca su CLIP, porque lo usa a la resolución con la que fue entrenado.</p>` },
          { t: 'h3', text: 'Resolución dinámica también al entrenar' },
          { t: 'p', html: R`Cada imagen entra con su tamaño, y las secuencias de parches de varias imágenes se <b>empaquetan</b> en una sola, con un largo máximo para controlar la memoria de la GPU (§2.1). La idea viene de NaViT (${NAVIT}): en vez de rellenar todo al tamaño más grande del batch, concatenar secuencias de largo variable y usar una máscara de atención por bloques. En el código, la máscara son los <code>cu_seqlens</code> (largos acumulados) que FlashAttention acepta directo (<code>flash_attn_varlen</code>): sin relleno y sin atención cruzada entre imágenes.` },
          { t: 'h3', text: 'Lo que dicen las ablaciones' },
          { t: 'table', caption: 'Tokens fijos vs dinámicos (Tabla 7, §3.3.1)', head: ['Tokens por imagen', 'InfoVQA', 'RealWorldQA', 'OCRBench', 'MMMU'], rows: [
            ['64 fijos', '28.85', '56.47', '572', '53.33'],
            ['3,136 fijos', '77.27', '70.59', '786', '53.44'],
            ['Dinámico (≈ 1,924 en promedio)', '75.89', '70.07', '866', '53.44'],
          ], note: 'Lectura: con pocos tokens fijos, los documentos (InfoVQA, OCRBench) se caen; el dinámico iguala a 3,136 fijos con ≈ 40 % menos tokens y gana en OCRBench. MMMU (razonamiento) casi no depende de la resolución.' },
          { t: 'list', items: [
            R`<b>min_pixels</b> (Fig. 4, §3.3.1): agrandar las imágenes chicas hasta un mínimo ayuda en InfoVQA, HallusionBench y OCRBench, pero un mínimo demasiado alto empeora OCRBench. Agrandar no inventa detalle; solo da más tokens para mirar lo que hay.`,
            R`<b>M-RoPE</b> (Tabla 8): mejora sobre RoPE 1-D en imágenes y sobre todo en video (NextQA, STAR); ver la tarjeta de M-RoPE arriba.`,
            R`<b>Extrapolación de largo</b> (Fig. 5): entrenado con hasta 16K tokens por video, el modelo sigue rindiendo con 80K tokens en inferencia. El paper lo atribuye a M-RoPE: los ids de posición crecen más despacio que la secuencia.`,
          ] },
          { t: 'h3', text: 'Grounding: las cajas son texto' },
          { t: 'p', html: R`Para que el modelo localice, las cajas se escriben como texto con coordenadas <b>normalizadas a [0, 1000)</b>, esquina superior izquierda y esquina inferior derecha, entre tokens especiales: <code>&lt;|object_ref_start|&gt;</code>la taza<code>&lt;|object_ref_end|&gt;&lt;|box_start|&gt;(176,106),(232,160)&lt;|box_end|&gt;</code> (§2.2.1, el mismo formato de Qwen-VL). El modelo genera esos números token por token, con la misma pérdida que el resto del texto: no hay cabeza de regresión ni matching húngaro como en <a href="#detr">DETR</a>.` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: la lista de fuentes de datos y los benchmarks de la sección 3. En entrevista basta: "three stages — ViT first on about 600B tokens, then everything on 800B more, then instruction tuning with the ViT frozen — trained at native resolution with packed sequences, loss only on text".</p>` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Preproceso', html: R`<p>Por imagen: <code>smart_resize</code> dentro de [min_pixels, max_pixels], normalización con la media y desviación estándar de CLIP, parches de 14×14 duplicados en el tiempo y ordenados por bloques 2×2 → <code>pixel_values</code> de N<sub>v</sub>×1,176 y <code>image_grid_thw</code> = (1, H/14, W/14). El chat template escribe <code>&lt;|vision_start|&gt;&lt;|image_pad|&gt;&lt;|vision_end|&gt;</code> y el processor repite <code>&lt;|image_pad|&gt;</code> N veces.</p>` },
            { title: 'Encoder', html: R`<p>Todas las imágenes del prompt se concatenan en una secuencia de parches; el ViT corre una vez con la máscara por bloques (<code>cu_seqlens</code>), y el merger da N tokens por imagen.</p>` },
            { title: 'Empalme y posiciones', html: R`<p>Los embeddings visuales reemplazan a los <code>&lt;|image_pad|&gt;</code>. <code>get_rope_index</code> calcula los ids (t, h, w) de todo el prompt y guarda <code>rope_deltas</code> = (max id + 1) − largo de la secuencia, un número negativo: cuántas posiciones "ahorró" la imagen.</p>` },
            { title: 'Prefill y decode', html: R`<p>Prefill del prompt entero, como en un LLM. En decode, cada token nuevo es texto: sus tres ids son iguales y valen índice + <code>rope_deltas</code>. El KV cache guarda K y V de los tokens visuales como de cualquier otro: ${mt('kvBytesPerImage')} por imagen de ${cf('H')}×${cf('W')} en bf16.</p>` },
          ] },
          { t: 'h3', text: 'Qué domina la latencia y la memoria' },
          { t: 'p', html: R`El primer token (TTFT) paga preproceso + ViT + prefill. Con la imagen canónica, el ViT cuesta ${mt('visionMacs')} y el prefill del LLM ${mt('llmPrefillMacs')}; ${mt('prefillShareFromImage')} del cómputo del prefill se debe a la imagen. Después del primer token, la imagen solo cuesta lo que ocupa en el KV cache: cada paso de decode lee sus ${VT()} tokens de K y V, como lee los del texto. Con imágenes grandes o muchas imágenes, el KV de la visión domina la memoria de cada petición.` },
          { t: 'viz', kind: 'vlm-token-cost', params: { model: 'qwen2-vl', side: 812, images: 1 }, caption: 'Prefill y KV cache: parte de la imagen vs del texto al crecer la imagen o el número de imágenes. Números del calculador.' },
          { t: 'h3', text: 'Controlar el presupuesto de tokens' },
          { t: 'table', head: ['Palanca', 'Qué hace', 'Cuándo'], rows: [
            ['max_pixels', 'Tope de área por imagen → tope de tokens (máx_pixels / 784)', 'Siempre en producción: el default (16,384 tokens) deja pasar una captura 4K entera'],
            ['min_pixels', 'Agranda imágenes chicas', 'Miniaturas, recortes de detecciones; no exageres (Fig. 4)'],
            ['resized_height / resized_width', 'Tamaño exacto por imagen (se redondea a múltiplos de 28)', 'Cámaras fijas de un robot: tokens y latencia constantes'],
            ['fps / nframes y píxeles por frame (video)', 'Menos frames o frames más chicos', R`La utilidad oficial (<code>qwen-vl-utils</code>) muestrea a 2 fps, entre 4 y 768 frames, y achica cada frame para que el video quepa en ≈ 90 % del largo de secuencia configurado`],
            ['Recortar antes', 'Mandar solo la región de interés (de un detector)', 'Texto chico en una imagen grande: más píxeles útiles con menos tokens'],
          ] },
          { t: 'callout', kind: 'senior', title: 'Batching de imágenes de tamaños distintos', html: R`<p>En el ViT no hay padding: las imágenes del batch se concatenan en una sola secuencia de parches y <code>cu_seqlens</code> marca dónde empieza cada una; FlashAttention varlen calcula la atención por bloques (lo mismo que hace un servidor con prompts de largo distinto). En el LLM, las secuencias de distinto largo se rellenan (o se empaquetan con ids de posición propios). Lo que no puedes hacer: apilar <code>pixel_values</code> como un tensor B×C×H×W; el formato es N<sub>v</sub> total × 1,176 más <code>image_grid_thw</code> por imagen. Y con un servidor tipo vLLM, el costo del encoder también hay que presupuestarlo: una petición con una imagen 4K puede bloquear el batch durante su encoder.</p>` },
          { t: 'callout', kind: 'interview', title: 'Robot con tres cámaras', html: R`<p>Tres vistas de 640×480 por paso de control. smart_resize las lleva a 644×476 (o al tamaño que fijes): ${est('≈ 390 tokens por vista, ≈ 1,170 por paso')}, más el texto. Con un 7B en una GPU de servidor, ${est('el ViT y el prefill entran en decenas a pocos cientos de ms')}; en un Jetson, no. Opciones: fijar <code>resized_height/width</code> bajos y constantes (latencia predecible), recortar la región del gripper en alta resolución y la vista global en baja, cachear el KV del system prompt, y medir p99 en el dispositivo. Y si el modelo debe emitir una acción, decodificación con restricciones (<a href="#llm-decoder.operaciones">decoder</a>).</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Explosión de tokens con imágenes enormes.</b> Con el default del checkpoint (hasta 16,384 tokens por imagen), un frame 4K entra casi entero: 2156×3836, 10,549 tokens visuales y 42,196 parches en el ViT, con atención global sobre todos ellos en cada una de las ${cf('Lv')} capas (el explorador de la sección 2 da el costo: el ViT por sí solo cuesta más que el prefill del LLM). Si la atención se materializara, la matriz de puntuaciones de <b>una</b> capa del ViT ocuparía ${est('≈ 57 GB en bf16')} (16 × 42,196² × 2 bytes): sin FlashAttention no corre. Defensa: max_pixels siempre, y recortar antes.`,
            R`<b>Texto chico con presupuesto bajo.</b> Si bajas max_pixels para ahorrar, una página A4 escaneada a 300 dpi queda a 840×1176 con el presupuesto sugerido (1,280 tokens) y a 364×532 con 256 tokens: el texto de pie de página vuelve a ser ilegible y el modelo <b>inventa</b> en vez de decir que no lee (alucinación, ver <a href="#llava.fallas">LLaVA</a>). Defensa: recortar la región, o tiles de la página con un presupuesto por tile.`,
            R`<b>Videos largos.</b> A 2 fps, un video de 10 minutos son 1,200 frames, 600 pares: con el tope de 16,384 tokens del entrenamiento, ≈ 27 tokens por par de frames (≈ 145×145 px por frame). Los eventos cortos (un objeto que cae en medio segundo) se pierden entre frames, y el detalle espacial también. El paper evalúa Video-MME con hasta 768 frames (§3.2.6). Defensa: muestrear más denso solo donde importa (un detector de eventos), o un modelo con tiempo absoluto (Qwen2.5-VL).`,
            R`<b>Formato de coordenadas.</b> Qwen2-VL escribe cajas normalizadas a [0, 1000); Qwen2.5-VL, en píxeles absolutos de la imagen <b>redimensionada</b> (después de smart_resize). Mezclar los dos, o desnormalizar con el tamaño original en vez del redimensionado, da cajas corridas sin ningún error. Y como son tokens de texto, la caja puede salir malformada: valida con un parser (o decodificación con restricciones).`,
            R`<b>Contar y relaciones espaciales.</b> La model card lo dice: conteo poco preciso en escenas complejas y razonamiento espacial 3D débil. Para un robot: el VLM decide qué y por qué; la geometría (profundidad, detector, pose) la pone otro módulo.`,
          ] },
          { t: 'table', caption: 'Cómo convertir imágenes en tokens: trade-offs (filas = criterios)', head: ['Criterio', 'Fija (LLaVA-1.5)', 'Tiling (LLaVA-NeXT, InternVL)', 'Nativa (Qwen2-VL)', 'Nativa con ventanas (Qwen2.5-VL)'], rows: [
            ['Texto chico / documentos', 'Malo', 'Bueno (más recortes, más tokens)', 'Bueno', 'Bueno'],
            ['Proporciones extremas', 'Deforma o rellena', 'Rejilla de recortes según la proporción', 'Natural (hasta 200:1)', 'Natural'],
            ['Tokens', 'Constantes, predecibles', 'Escalonados por recorte', '∝ área, acotados por min/max', '∝ área'],
            ['Costo del encoder', 'Fijo', 'Lineal en recortes', 'Cuadrático en el área (atención global)', '≈ lineal (4 capas globales de 32)'],
            ['Encoder preentrenado reutilizable', 'Sí, congelado', 'Sí, congelado o no', 'No: hay que entrenar el ViT con RoPE 2-D', 'No'],
            ['Batching', 'Trivial (tensores iguales)', 'Número variable de recortes', 'Secuencias empaquetadas (cu_seqlens)', 'Igual + índices de ventanas'],
            ['Video', '—', 'Caro (recortes × frames)', '2 fps, pares de frames, t en M-RoPE', 'FPS dinámico, t = tiempo absoluto'],
          ] },
          { t: 'table', caption: 'Presupuesto de tokens vs precisión', head: ['Presupuesto', 'Gana', 'Pierde'], rows: [
            ['Bajo (≤ 256 tokens)', 'Latencia, memoria, más imágenes o frames por prompt', 'Documentos y texto chico (Tabla 7: 64 tokens fijos hunde InfoVQA a 28.85)'],
            ['Medio (256–1,280, el sugerido)', 'Equilibrio para fotos y pantallas', 'Páginas densas a resolución completa'],
            ['Alto (hasta 16,384)', 'OCR de páginas enteras, planos', 'Latencia del ViT (cuadrática), KV cache, costo por petición'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"Native resolution fixes the small-text and aspect-ratio problems of fixed-size VLMs and makes tokens follow content, but it moves the problem to cost: tokens grow with area and the encoder's global attention grows with its square. In production I always cap max_pixels, crop regions of interest, and validate coordinate outputs, which are normalized to a thousand in Qwen2-VL and absolute pixels in Qwen2.5-VL."</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Dónde lo ves'], rows: [
            ['NaViT (Google, 2023)', 'El origen de la idea: un ViT que procesa imágenes de cualquier tamaño y proporción empaquetando varias en una secuencia con máscara por bloques (Patch n\' Pack).', '—'],
            ['Qwen-VL (2023)', 'El antecesor: ViT-bigG (1.9B) a 448 fijo + un cross-attention con 256 queries (tipo Q-Former); 256 tokens por imagen. Mismo formato de cajas [0, 1000).', 'Esta página (trampa de fechas)'],
            ['LLaVA-NeXT (2024)', 'AnyRes: rejilla de recortes de 336 + imagen reducida; más resolución con el mismo CLIP.', R`<a href="#llava.variantes">LLaVA</a>`],
            ['InternVL 1.5 / 2 / 2.5 (2024)', 'Tiling dinámico: 1 a 40 recortes de 448 según la proporción (hasta 4K) + miniatura; pixel shuffle → 256 tokens por recorte; ViT de 6B (InternViT).', '—'],
            ['Idefics3 (2024)', 'SigLIP + Llama 3.1; recortes de 364 + imagen global, pixel shuffle ×4 → 169 tokens por recorte, con tokens de fila/columna.', '—'],
            ['Pixtral 12B (2024)', 'Resolución nativa como Qwen2-VL: ViT de 400M entrenado desde cero, parches de 16, RoPE 2-D, tokens [IMG_BREAK] al final de cada fila y [IMG_END]; máscara por bloques al empaquetar.', '—'],
            ['Qwen2.5-VL (2025)', 'ViT con ventanas de 112×112 px (8×8 parches) y solo 4 capas globales (7, 15, 23, 31), RMSNorm y SwiGLU; M-RoPE con t alineado al tiempo absoluto y FPS dinámico; cajas en píxeles absolutos; videos de horas; 4.1T tokens de preentrenamiento.', '—'],
            ['VideoRoPE (2025)', 'Revisa M-RoPE para video: frecuencias bajas para el eje temporal y otros ajustes.', '—'],
          ], note: R`NaViT: ${NAVIT}. Qwen-VL: ${QWENVL}. LLaVA-NeXT: ${NEXT}. InternVL 1.5: ${INTERNVL15}; InternVL 2.5: Chen et al., arXiv:2412.05271 (2024). Idefics3: ${IDEFICS3}. Pixtral: ${PIXTRAL}. Qwen2.5-VL: ${QWEN25}. VideoRoPE: ${VIDEOROPE}.` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los números de cada variante. Lo que se pregunta: fija vs tiling vs nativa (con sus costos), que Qwen2.5-VL puso ventanas en el ViT porque la atención global no escalaba, y que el tiempo absoluto en M-RoPE es lo que permite responder "¿en qué segundo pasó?".</p>` },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Qwen2-VL sale en entrevistas de VLMs, documentos y video, y en robótica cuando la pregunta es "¿qué VLM pones y cuánto cuesta?". Preguntas en inglés como las hace el entrevistador; respuestas en español, con la frase senior en inglés.` },
          { t: 'followups', items: [
            { q: 'How many visual tokens does a 1280×720 image produce in Qwen2-VL, and in LLaVA-1.5?',
              junior: '(1280/14)·(720/14) ≈ 4,700 en Qwen2-VL y 576 en LLaVA.',
              senior: R`En Qwen2-VL, primero smart_resize: cada lado al múltiplo de 28 más cercano, 1288×728 (el área está dentro del default). El ViT ve (1288/14)·(728/14) = 92·52 = 4,784 parches; el merger 2×2 deja 46·26 = <b>1,196</b> tokens para el LLM, más <code>&lt;|vision_start|&gt;</code> y <code>&lt;|vision_end|&gt;</code>. En LLaVA-1.5, siempre ${VT(LV)}, a costa de reducir la imagen a ${cf('H', LV)}×${cf('W', LV)}. Con el presupuesto sugerido (máx. 1,280 tokens) Qwen2-VL no cambia esta imagen; una 1080p sí se achica: a 1316×728, 1,222 tokens.`,
              say: 'Resize each side to the nearest multiple of twenty-eight, giving twelve eighty-eight by seven twenty-eight; the ViT sees about four thousand eight hundred fourteen-pixel patches, and the two-by-two merger leaves about twelve hundred tokens for the LLM, versus a fixed five seventy-six in LLaVA-1.5.',
              why: 'Trampa: olvidar el merger (dividir por 14 y no por 28) o el redondeo. Se anota: smart_resize, ViT vs LLM, y el tope.', trap: true },
            { q: 'Why does Qwen2-VL use 2-D RoPE in its ViT instead of learned position embeddings?',
              junior: 'Porque RoPE es mejor.',
              senior: R`Porque quiere rejillas de cualquier tamaño en el mismo batch. Una tabla aprendida tiene una entrada por casilla de la rejilla de entrenamiento: para otro tamaño hay que interpolarla (lo que hace un ViT al pasar de 224 a 384), y eso no escala a un batch con un ticket de 10×90 parches y una foto de 52×92. Con RoPE 2-D, la mitad de las frecuencias de cada cabeza rota con la fila y la otra mitad con la columna: el score entre dos parches depende de (Δfila, Δcolumna), una regla que no depende del tamaño. Además no agrega parámetros. Lo que no resuelve sola: el modelo tiene que haber visto esos desplazamientos, por eso se entrena con resolución dinámica y se limita max_pixels.`,
              say: 'Learned absolute embeddings are tied to one grid and must be interpolated for others; 2-D RoPE rotates half the frequencies by the row and half by the column, so attention depends only on relative offsets and works for any grid size, with no extra parameters. It still needs training at varied resolutions.',
              why: 'Se anota: tabla atada a una rejilla, interpolación, desplazamiento relativo y el límite.' },
            { q: 'Explain M-RoPE. What position ids does a text–image–text prompt get?',
              junior: 'Cada token tiene su posición, como siempre.',
              senior: R`Cada token lleva tres ids (t, h, w) y las frecuencias de cada cabeza se reparten entre los ejes (HF <code>mrope_section</code> = [16, 24, 24] de las 64 de d<sub>h</sub> = 128). Texto: t = h = w = m, que es RoPE 1-D. Imagen que empieza en s con g<sub>h</sub>×g<sub>w</sub> tokens: t = s en todos, h = s + fila, w = s + columna. El texto que sigue arranca en max + 1 = s + max(g<sub>h</sub>, g<sub>w</sub>). Ejemplo: 3 tokens de texto (0, 1, 2), una imagen de 2×3 tokens (t = 3; h = 3–4; w = 3–5) y el texto sigue en 6, aunque la secuencia va por el índice 9. En decode, id = índice + <code>rope_deltas</code> (aquí −3). Por qué: el score entre tokens visuales depende de su desplazamiento 2-D (o 3-D en video), no de la distancia en la secuencia aplanada, y el texto no cambia respecto del LLM preentrenado.`,
              say: 'Each token gets temporal, height and width ids, and the rotary frequencies are split across the three axes. Text uses the same id on all three, which is plain 1-D RoPE; image tokens share the temporal id and take row and column offsets from the start position; the next text resumes at the maximum id plus one, so an image advances positions by its larger side, not its token count.',
              why: 'Trampa: decir que la posición avanza N tokens tras la imagen. Se anota: texto = 1-D, (t fijo, h, w), max + 1 y rope_deltas.', trap: true },
            { q: 'How do you cap the cost of huge images?',
              junior: 'Bajo la resolución de todas las imágenes.',
              senior: R`Primero entender qué crece: tokens ∝ área (prefill y KV del LLM) y la atención global del ViT ∝ área². Palancas: (1) <b>max_pixels</b> por imagen (el default de 16,384 tokens es demasiado para producción; el README sugiere 256–1,280); (2) <b>recortar</b> antes, con un detector o con el layout de la página, y mandar la región en alta resolución más la imagen entera en baja; (3) tamaño fijo por cámara (<code>resized_height/width</code>) para latencia predecible; (4) en el servidor, presupuesto de tokens visuales por petición y por batch, porque el encoder de una imagen 4K bloquea a las demás; (5) cachear el KV de prefijos repetidos (system prompt); (6) si el costo del encoder sigue mandando, un modelo con ventanas en el ViT (Qwen2.5-VL). Y medir qué pierdes: en documentos, bajar el presupuesto cuesta precisión (Tabla 7).`,
              say: 'Tokens grow with image area and the ViT\'s global attention with its square, so I cap max_pixels per image, crop regions of interest and send them at high resolution with a low-resolution global view, fix the resolution per camera for predictable latency, budget visual tokens per request in the server, and if the encoder still dominates, use a windowed-attention ViT like Qwen2.5-VL.',
              why: 'Se anota: qué escala con qué, max_pixels, recorte y presupuesto en el servidor.' },
            { q: 'Video: how are frames turned into tokens?',
              junior: 'Cada frame es una imagen.',
              senior: R`Se muestrea a 2 fps (§2.1), cada frame se redimensiona con la misma regla (con menos píxeles por frame si hay muchos), y la conv 3-D de profundidad 2 funde cada <b>par</b> de frames consecutivos en un tubo de 2×14×14: la mitad de tokens que tratarlos por separado. Una imagen es el caso de un frame duplicado. En el ViT, la atención es por grupo temporal (cada par de frames es su propia secuencia en <code>cu_seqlens</code>): el costo del ViT es lineal en frames. El merger 2×2 deja (H/28)(W/28) tokens por par. En el LLM, M-RoPE da t = s + k al grupo k, con h y w como en una imagen. El entrenamiento limita a 16,384 tokens por video. Consecuencia: un video de minutos tiene pocos tokens por frame; el detalle fino y los eventos de menos de un segundo se pierden.`,
              say: 'Frames are sampled at two fps, resized like images, and a depth-two 3-D convolution fuses each pair of consecutive frames into one tube of patches, so an image is just a duplicated frame. The ViT attends within each frame pair, the merger reduces two-by-two, and in the LLM the temporal M-RoPE id increases by one per frame pair; training caps a video at sixteen thousand tokens.',
              why: 'Se anota: 2 fps, pares de frames, atención por par en el ViT, t en M-RoPE y el tope de tokens.' },
            { q: 'How do you batch images of different sizes in the vision encoder?',
              junior: 'Con padding al tamaño más grande.',
              senior: R`Sin padding: se concatenan los parches de todas las imágenes en una secuencia (N<sub>v</sub> total × 1,176) y se pasa <code>cu_seqlens</code>, los largos acumulados, p. ej. [0, 4784, 5808, …]. Las lineales y el MLP no necesitan saber nada (son por token); la atención usa FlashAttention varlen, que calcula un bloque por imagen, o equivalentemente una máscara de atención diagonal por bloques. La RoPE 2-D usa las coordenadas de cada parche dentro de su propia imagen. Es la idea de NaViT (Patch n' Pack). Lo que se rompe si te equivocas: una máscara mal armada deja que los parches de una imagen atiendan a otra (corre sin error y degrada la salida). En el LLM, los prompts se rellenan o se empaquetan como en cualquier servidor, con sus ids de M-RoPE por secuencia.`,
              say: 'No padding: I concatenate all patches into one sequence and pass cumulative sequence lengths, so variable-length FlashAttention computes block-diagonal attention per image, while linear layers are per token anyway. Each patch keeps its 2-D RoPE coordinates within its own image. That is NaViT-style packing.',
              why: 'Trampa: padding al tamaño mayor (desperdicia cómputo cuadrático). Se anota: cu_seqlens, varlen, máscara por bloques.', trap: true },
            { q: 'OCR-heavy documents on an industrial system: which VLM design do you pick, and why?',
              junior: 'El VLM más grande que entre en la GPU.',
              senior: R`Uno de resolución nativa o de tiling, no uno fijo a 336: el texto chico tiene que llegar al encoder con suficientes píxeles por carácter. Diseño: (1) presupuesto por página fijo (min/max pixels) medido contra la precisión en mis documentos, no el default; (2) para páginas densas, dividir en regiones (layout o tiles) con presupuesto por región en vez de una página gigante: más tokens útiles y latencia acotada, porque la atención del ViT de Qwen2-VL es cuadrática en el área; (3) salida estructurada (JSON con esquema, decodificación con restricciones) y validación con reglas de negocio; (4) si el texto es todo, comparar contra OCR clásico + LLM, que suele ser más barato y auditable; (5) evaluación por campo (exact match, CER) y detección de alucinación: el VLM inventa un número antes de decir "ilegible". Para edge, el 2B con presupuesto fijo; el ViT es el mismo que en el 7B, así que la visión no se achica.`,
              say: 'A native-resolution or tiling VLM, never a fixed low-resolution one, with a per-page pixel budget tuned on my documents, region crops for dense pages, constrained structured output validated by business rules, and per-field evaluation including hallucinated values. I would also benchmark classic OCR plus an LLM, and note that the 2B model keeps the same ViT, so vision cost does not shrink.',
              why: 'Se anota: resolución, presupuesto medido, regiones, salida estructurada, evaluación y alternativa OCR.', trap: true },
            { q: 'What changed from Qwen-VL to Qwen2-VL to Qwen2.5-VL?',
              junior: 'Más datos y modelos más grandes.',
              senior: R`<b>Qwen-VL</b> (2023): ViT-bigG a 448 fijo + un resampler de una capa de cross-attention con 256 queries: 256 tokens por imagen, sin importar el contenido. <b>Qwen2-VL</b> (2024): resolución nativa (ViT de 675M con RoPE 2-D, merger 2×2), M-RoPE, video a 2 fps, tres etapas con el ViT entrenado. <b>Qwen2.5-VL</b> (2025): ViT con atención por ventanas (8×8 parches) salvo 4 capas globales, RMSNorm y SwiGLU en el ViT (para que el costo del encoder sea ≈ lineal en el área), M-RoPE con t en tiempo absoluto (FPS dinámico, eventos con segundos), cajas en píxeles absolutos y 4.1T tokens de preentrenamiento.`,
              say: 'Qwen-VL used a fixed 448 input and a 256-query cross-attention resampler; Qwen2-VL moved to native resolution with a 2-D RoPE ViT, a two-by-two merger and multimodal RoPE, plus video; Qwen2.5-VL made the ViT windowed so encoder cost scales almost linearly, aligned the temporal RoPE axis to absolute time and switched boxes to absolute pixel coordinates.',
              why: 'Trampa de fechas y nombres. Se anota: resampler → nativa → ventanas + tiempo absoluto.', trap: true },
            { q: 'Why merge 2×2 patches instead of using 28-pixel patches in the ViT?',
              junior: 'Es lo mismo.',
              senior: R`No es lo mismo. Con parches de 28 el ViT vería 4 veces menos tokens desde la primera capa: más barato, pero cada token mezcla un área 4 veces mayor desde el principio y el ViT preentrenado (DFN, parches de 14) no se podría reutilizar. Con parches de 14 + merger, el ViT trabaja a resolución fina en sus ${cf('Lv')} capas (la atención ve detalle de 14 px) y la reducción ocurre <b>al final</b>, con un MLP que recibe los 4 vectores enteros (concatenados, no promediados). El LLM, que es la parte cara por token, ve 4 veces menos tokens. Es el mismo trade-off que patch merging en Swin o pixel shuffle en InternVL: resolución espacial por canales, después de procesar.`,
              say: 'Fourteen-pixel patches let the pretrained ViT work at fine resolution through all its layers, and the merger reduces tokens only at the end, concatenating the four vectors rather than averaging them, so the expensive LLM sees four times fewer tokens without losing the encoder\'s detail.',
              why: 'Se anota: dónde se reduce, reutilizar el ViT y que el MLP ve los 4 vectores.' },
            { q: 'Where does the compute go when a 7B VLM answers about a high-resolution image?',
              junior: 'En el LLM, que es el modelo grande.',
              senior: R`Depende del tamaño. En el prefill: ViT (lineales ∝ N<sub>v</sub>, atención ∝ N<sub>v</sub>²) + merger + LLM sobre N + T tokens. Con la imagen canónica (${cf('H')}×${cf('W')}), el ViT cuesta ${mt('visionMacs')} y el prefill del LLM ${mt('llmPrefillMacs')}; ${mt('prefillShareFromImage')} del prefill se debe a la imagen. Al subir la resolución, la parte cuadrática del ViT crece más rápido que todo lo demás (explorador de costo). En el decode, la imagen ya no cuesta cómputo, pero sí bytes: su KV (${mt('kvBytesPerImage')}) se lee en cada paso. Así que TTFT lo domina la imagen; TPOT, los pesos y el KV.`,
              say: 'In prefill, the ViT\'s quadratic attention over all patches can rival or exceed the LLM\'s prefill at high resolution, so time to first token is dominated by the image; during decode the image costs only its KV-cache reads, so per-token latency is weights plus KV.',
              why: 'Trampa: "el LLM siempre domina". Se anota: separar TTFT y TPOT, y la parte cuadrática del ViT.', trap: true },
            { q: 'How does Qwen2-VL output bounding boxes, and what can go wrong?',
              junior: 'Tiene una cabeza de detección.',
              senior: R`No tiene cabeza: escribe la caja como texto, <code>&lt;|box_start|&gt;(x1,y1),(x2,y2)&lt;|box_end|&gt;</code>, con coordenadas normalizadas a [0, 1000) (§2.2.1), aprendidas con la misma entropía cruzada del texto. Qué sale mal: (1) desnormalizar mal (Qwen2-VL normaliza; Qwen2.5-VL usa píxeles absolutos de la imagen redimensionada); (2) precisión limitada (cuantización a 1/1000 y error de un modelo de lenguaje); (3) formato inválido o cajas fuera de rango; (4) un objeto a la vez, sin NMS ni puntuación calibrada. Para un robot, el VLM elige el objeto ("la llave de 10 mm") y un detector o SAM refina la caja o la máscara.`,
              say: 'Boxes are generated as text between special tokens, with coordinates normalized to a thousand in Qwen2-VL and absolute pixels of the resized image in Qwen2.5-VL, trained with the ordinary language-model loss. So I validate the format, convert coordinates with the right image size, and refine with a detector or SAM when precision matters.',
              why: 'Trampa: "tiene una cabeza de detección". Se anota: texto, normalización, y el refinamiento con un detector.', trap: true },
            { q: 'What is rope_deltas and why does generation need it?',
              junior: 'Un detalle de implementación.',
              senior: R`Con M-RoPE, los ids de posición ya no son el índice del token: una imagen de N tokens solo avanza max(g<sub>h</sub>, g<sub>w</sub>) posiciones. <code>rope_deltas</code> = (max id + 1) − largo del prompt, un número ≤ 0 por secuencia. En decode, cada token nuevo es texto y su id (igual en los tres ejes) es su índice + delta. Si generas con posiciones = índice (el default de un LLM), el primer token generado queda "lejos" del prompt: el modelo sigue funcionando pero degrada. Es un bug clásico al portar el modelo a otro motor de inferencia.`,
              say: 'Because an image advances positions by its larger side rather than its token count, position ids lag behind sequence indices; rope_deltas stores that offset per sequence so every generated token gets index plus delta, and forgetting it silently shifts positions.',
              why: 'Se anota: por qué existe y el bug que evita.' },
            { q: 'Why is the vision encoder trained in Qwen2-VL but frozen in LLaVA-1.5?',
              junior: 'Porque Qwen tiene más GPUs.',
              senior: R`LLaVA-1.5 usa CLIP a la resolución y con las posiciones con las que fue preentrenado: congelarlo es seguro y barato, y la etapa 1 solo entrena el proyector. Qwen2-VL cambia el encoder: le quita la tabla de posiciones absolutas, le pone RoPE 2-D y lo alimenta con rejillas de cualquier tamaño y con video. Eso es un modelo nuevo que tiene que aprender; por eso la etapa 1 entrena el ViT (≈ 600B tokens) con el LLM congelado, y la etapa 2 todo. En la etapa 3 (instrucciones) el ViT se congela: lo visual ya está, y se protege de un ajuste chico y ruidoso.`,
              say: 'LLaVA uses CLIP exactly as pretrained, so freezing it is safe; Qwen2-VL replaces the position embeddings with 2-D RoPE and feeds arbitrary grids and video, so the ViT must be trained first, then jointly, and frozen only during instruction tuning.',
              why: 'Se anota: qué cambió del encoder y el orden de las etapas.' },
            { q: 'Qwen2-VL on a robot: three cameras at 5 Hz. Design the vision–language pipeline.',
              junior: 'Mando las tres imágenes a 1080p al modelo en cada paso.',
              senior: R`Presupuesto primero: 200 ms por paso. (1) Tokens: tres vistas con <code>resized_height/width</code> fijos (p. ej. ≈ 640×480 → ${est('≈ 390 tokens por vista')}) para latencia constante; la vista del gripper en más resolución si importa el detalle. (2) No re-procesar lo que no cambió: el system prompt e instrucciones en KV cache de prefijo; si una cámara es estática, cachear su encoder. (3) Modelo: el 2B o el 7B cuantizado según el hardware; recuerda que el ViT es el mismo de 675M en los dos. (4) Salida: una acción o un JSON con decodificación con restricciones; nada de cajas libres sin validar. (5) Frecuencias: el VLM a 1–5 Hz decide qué hacer; el control rápido (seguimiento, servo) lo hace un modelo chico o un tracker (SAM 2) a la frecuencia de la cámara. (6) Medir TTFT y p99 en el dispositivo, con las tres vistas, no con una. ${est('En un AGX Orin, un 7B con ≈ 1,200 tokens visuales difícilmente baja de varios cientos de ms de TTFT')}: mídelo.`,
              say: 'I fix the per-camera resolution for a constant token budget, cache the prompt prefix, pick a model size that meets the time-to-first-token budget knowing the ViT does not shrink with the LLM, constrain the output to valid actions, and run the VLM at a few hertz for decisions while a lightweight tracker handles fast control.',
              why: 'Trampa: 1080p × 3 cada paso. Se anota: presupuesto, resolución fija, caché, salida restringida y frecuencias separadas.', trap: true },
            { q: 'How does Qwen2-VL handle long videos, and where does it break?',
              junior: 'Mete todos los frames.',
              senior: R`2 fps, pares de frames fundidos y un tope de tokens (16,384 por video en entrenamiento; en evaluación, hasta 768 frames en Video-MME). Para caber, cada frame recibe pocos píxeles: un video de 10 minutos a 2 fps son 600 pares de frames, ≈ 27 tokens por par con 16K tokens. M-RoPE ayuda a extrapolar (Fig. 5: rinde con 80K tokens habiendo entrenado con 16K) porque los ids crecen más despacio que la secuencia. Se rompe en: eventos cortos entre frames muestreados, detalle espacial fino, preguntas de "¿en qué segundo?" (el id t cuenta pares de frames, no segundos: si cambias el fps, el mismo t significa otro tiempo; Qwen2.5-VL lo alinea al tiempo absoluto), y costo de prefill cuadrático en los tokens totales. En sistemas reales: muestreo adaptativo (más denso donde hay movimiento), resumen por segmentos y recuperación de clips.`,
              say: 'It samples two fps, fuses frame pairs and caps tokens, so long videos get very few tokens per frame; M-RoPE helps extrapolate to longer inputs, but short events, fine detail and absolute timing break, because the temporal id counts frame pairs rather than seconds, which Qwen2.5-VL fixes by aligning it to absolute time.',
              why: 'Se anota: tope de tokens, tokens por frame, t ≠ segundos y estrategias de sistema.', trap: true },
            { q: 'Why does a 224×224 image become 66 tokens, not 64?',
              junior: 'Error del paper.',
              senior: R`(224/28)² = 8·8 = 64 tokens visuales tras el merger, más <code>&lt;|vision_start|&gt;</code> y <code>&lt;|vision_end|&gt;</code>: 66 tokens que entran al LLM (§2.1). Y ojo: con el default de min_pixels del checkpoint, 224×224 no se agranda (50,176 > 3,136); con min_pixels = 256·28², sí: a 448×448 y 256 tokens.`,
              say: 'Sixty-four visual tokens after the two-by-two merger, plus the vision start and end tokens; and with a larger min_pixels setting the image would be upscaled first.',
              why: 'Detalle del paper que separa a quien lo leyó.' },
          ] },
          { t: 'qa', items: [
            { q: '¿Cuántos parámetros tiene el encoder de visión de Qwen2-VL-7B y cuántos el de 72B?', a: R`El mismo ViT de ≈ 675M en los tres tamaños (Tabla 1); solo cambia la última capa del merger (al ancho de cada LLM). Calculador: ViT ${mt('visionParams')} en los tres; ViT + merger ${mt('visualModuleParams')} (7B), ${mt('visualModuleParams', C2)} (2B) y ${mt('visualModuleParams', C72)} (72B).` },
            { q: '¿Qué forma tiene pixel_values para una imagen de 1280×720?', a: '4,784 × 1,176: un parche por fila (52·92 parches de la imagen redimensionada a 728×1288), cada uno con 3 canales × 2 frames × 14 × 14.' },
            { q: '¿Por qué la imagen se duplica en el tiempo?', a: 'Porque el patch embedding es una conv 3-D de profundidad 2 compartida con el video: una imagen es un video de un frame repetido (§2.1). No agrega tokens.' },
            { q: '¿Qué tokens especiales rodean a una imagen en el prompt?', a: '&lt;|vision_start|&gt;, N veces &lt;|image_pad|&gt; (que el modelo reemplaza por los embeddings visuales) y &lt;|vision_end|&gt;. Para video, &lt;|video_pad|&gt;.' },
          ] },
          { t: 'callout', kind: 'interview', title: 'Dilo así (en inglés)', html: R`<p><b>One-liner:</b> "Qwen2-VL is a LLaVA-style VLM at native resolution: a 2-D RoPE ViT, a two-by-two merger and multimodal RoPE, so tokens grow with image area."</p><p><b>Why it works:</b> "Tokens follow content: documents keep their small text and aspect ratio, and the same machinery handles video as pairs of frames."</p><p><b>Limits:</b> "Cost grows with area and the ViT's global attention with its square; long videos get few tokens per frame; boxes are text."</p><p><b>In practice:</b> "Cap max_pixels, crop regions, fix per-camera resolution, validate structured outputs."</p>` },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero rellena el diagrama sin mirar la página; después, las formas; al final, los "¿qué pasa si…?" y los dos ejercicios de código, que son las dos cuentas que se piden en una entrevista de VLMs: cuántos tokens produce una imagen y qué posición recibe cada uno.` },
          { t: 'h3', text: 'Diagrama en blanco: Qwen2-VL' },
          { t: 'blankdiagram', diagram: 'qwen2vl-overview', slots: [
            { node: 'patchify', ask: 'label', hint: 'corta la imagen en tubos de 2×14×14' },
            { node: 'merger', ask: 'label', hint: 'funde 2×2 parches vecinos en un token del LLM' },
            { node: 'merge', ask: 'label', hint: 'pone los tokens visuales en lugar de los marcadores del prompt' },
            { node: 'merger', tensor: TN.merged, ask: 'shape' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'qwen2-vl', pool: 'all', configs: [C, C2] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`Duplicas el lado de la imagen (${cf('H')}×${cf('W')} → el doble de alto y de ancho). ¿Por qué factor cambian los tokens visuales?`, change: { H: 1624, W: 1624 }, ask: 'visualTokens',
              explain: '×4: tokens = (H/28)·(W/28), proporcional al área.' },
            { q: 'Mismo cambio, el doble de lado. ¿Por qué factor cambian los MACs del ViT?', change: { H: 1624, W: 1624 }, ask: 'visionMacs',
              explain: 'Entre ×4 y ×16: las lineales del ViT crecen ×4 (∝ N_v) y QKᵀ y A·V ×16 (∝ N_v²). Cuanto más grande la imagen, más cerca de ×16.' },
            { q: 'Mismo cambio. ¿Por qué factor cambian los parámetros?', change: { H: 1624, W: 1624 }, ask: 'params',
              explain: 'Nada: RoPE 2-D no tiene tabla de posiciones y el merger es por token.' },
            { q: 'Mismo cambio. ¿Por qué factor cambia el KV cache de la imagen?', change: { H: 1624, W: 1624 }, ask: 'kvBytesPerImage',
              explain: '×4: el KV es por token y la imagen tiene 4 veces más tokens.' },
            { q: 'Pasas de la imagen (equivale a 2 frames iguales) a un video de 32 frames (×16). ¿Por qué factor cambian los MACs del ViT?', change: { frames: 32 }, ask: 'visionMacs',
              explain: '×16: la atención del ViT es por par de frames, así que su costo es lineal en frames (no ×256).' },
          ] },

          { t: 'h3', text: 'Escríbelo (1): smart_resize y el número de tokens' },
          { t: 'p', html: R`Sin mirar: (1) implementa <code>smart_resize(h, w, factor=28, min_pixels, max_pixels)</code> con la regla de la sección de operaciones (redondeo al más cercano; si se pasa del máximo, escalar y redondear hacia abajo; si no llega al mínimo, escalar y hacia arriba; error si la proporción supera 200); (2) a partir del tamaño redimensionado, devuelve la rejilla (t, h, w) en parches de 14, los parches del ViT y los tokens del LLM. Anota la forma en cada línea. Verificada en el venv del Atlas (transformers 5.19): coincide con <code>smart_resize</code> de HF en 40,000 tamaños aleatorios con dos presupuestos, y con <code>image_grid_thw</code> y la forma de <code>pixel_values</code> de <code>Qwen2VLImageProcessor</code>.` },
          { t: 'code', title: 'Solución de referencia (Python)', files: [
            { name: 'visual_tokens.py', lang: 'python', code: [
              'import math',
              '',
              '',
              'def smart_resize(h, w, factor=28, min_pixels=4 * 28 * 28, max_pixels=16384 * 28 * 28):',
              '    """Lados múltiplos de factor (28 = parche 14 × merge 2), área en [min, max], proporción ≈ igual."""',
              '    if max(h, w) / min(h, w) > 200:',
              '        raise ValueError("aspect ratio > 200")',
              '    hb = round(h / factor) * factor             # 1) al múltiplo de 28 más cercano (round de Python: al par en .5)',
              '    wb = round(w / factor) * factor',
              '    if hb * wb > max_pixels:                    # 2) demasiado grande: escala por beta y redondea HACIA ABAJO',
              '        beta = math.sqrt(h * w / max_pixels)',
              '        hb = max(factor, math.floor(h / beta / factor) * factor)',
              '        wb = max(factor, math.floor(w / beta / factor) * factor)',
              '    elif hb * wb < min_pixels:                  # 3) demasiado chica: escala y redondea HACIA ARRIBA',
              '        beta = math.sqrt(min_pixels / (h * w))',
              '        hb = math.ceil(h * beta / factor) * factor',
              '        wb = math.ceil(w * beta / factor) * factor',
              '    return hb, wb',
              '',
              '',
              'def visual_tokens(h, w, patch=14, merge=2, **kw):',
              '    hb, wb = smart_resize(h, w, factor=patch * merge, **kw)',
              '    grid = (1, hb // patch, wb // patch)        # (t, h, w) en parches de 14: lo que ve el ViT (image_grid_thw)',
              '    n_vit = grid[1] * grid[2]                   # filas de pixel_values: (n_vit, 3·2·14·14 = 1176)',
              '    n_llm = n_vit // merge**2                   # tokens que entran al LLM tras el merger 2×2',
              '    return (hb, wb), grid, n_vit, n_llm',
              '',
              '',
              'if __name__ == "__main__":',
              '    for (h, w) in [(720, 1280), (1080, 1920), (2160, 3840), (3508, 2480), (224, 224), (100, 30)]:',
              '        print((h, w), visual_tokens(h, w))',
              '    # presupuesto del README: 256–1280 tokens',
              '    print(visual_tokens(2160, 3840, min_pixels=256 * 28 * 28, max_pixels=1280 * 28 * 28))',
            ].join('\n') },
            { name: 'check_tokens.py', lang: 'python', code: [
              'import random',
              'import numpy as np',
              'from transformers import Qwen2VLImageProcessor',
              'from transformers.models.qwen2_vl.image_processing_qwen2_vl import smart_resize as hf_smart_resize',
              'from visual_tokens import smart_resize, visual_tokens',
              '',
              'random.seed(0)',
              'F = 28',
              'for (mn, mx) in [(4 * F * F, 16384 * F * F), (256 * F * F, 1280 * F * F)]:',
              '    for _ in range(20000):',
              '        h, w = random.randint(10, 8000), random.randint(10, 8000)',
              '        if max(h, w) / min(h, w) > 200:',
              '            continue',
              '        assert smart_resize(h, w, F, mn, mx) == hf_smart_resize(h, w, F, mn, mx), (h, w)',
              '',
              'proc = Qwen2VLImageProcessor(min_pixels=256 * F * F, max_pixels=1280 * F * F)',
              'for (h, w) in [(720, 1280), (1080, 1920), (3508, 2480), (224, 224), (100, 30)]:',
              '    img = (np.random.rand(h, w, 3) * 255).astype(np.uint8)',
              '    out = proc(images=[img], return_tensors="pt")',
              '    _, grid, n_vit, n_llm = visual_tokens(h, w, min_pixels=256 * F * F, max_pixels=1280 * F * F)',
              '    assert out["image_grid_thw"].tolist() == [list(grid)]',
              '    assert out["pixel_values"].shape == (n_vit, 3 * 2 * 14 * 14)',
              'print("ok")',
            ].join('\n'), note: 'Sin descargas: el image processor se construye con su config por defecto. Salida de visual_tokens.py: 1280×720 → 1288×728, 4,784 parches, 1,196 tokens; 1920×1080 → 1932×1092, 2,691 tokens; 3840×2160 → 3836×2156, 10,549 tokens (con el default de 16,384) o 1316×728, 1,222 tokens con el presupuesto 256–1280; 224×224 → 64 tokens; 30×100 → 28×112, 4 tokens.' },
          ] },
          { t: 'list', items: [
            R`Dividir por 14 y olvidar el merger: cuentas 4 veces los tokens del LLM (son los parches del ViT).`,
            R`Redondear siempre hacia arriba (ceil) en el paso 1: con 3508 da 3528 en vez de 3500, y otra rejilla.`,
            R`Redondear al más cercano después de escalar por β: el área puede quedar por encima de max_pixels. Ahí es floor.`,
            R`Usar <code>int()</code> en vez de <code>round()</code> en el paso 1: trunca (720/28 = 25.7 → 25 → 700 px).`,
            R`Olvidar el <code>max(factor, …)</code>: una imagen muy alargada puede quedar con un lado de 0 px.`,
          ] },

          { t: 'h3', text: 'Escríbelo (2): los ids de M-RoPE de un prompt texto + imagen + texto' },
          { t: 'p', html: R`Sin mirar: dada una lista de segmentos <code>('text', n)</code> o <code>('image', (t, h, w))</code> (la rejilla en parches de 14, como <code>image_grid_thw</code>), devuelve un tensor <code>(3, S)</code> con los ids (t, h, w) de cada token y el <code>rope_deltas</code> para el decode. Regla: texto, el mismo id en los tres ejes; imagen, rejilla del LLM (h/2, w/2) recorrida fila por fila con t fijo; el segmento siguiente arranca en max + 1. Verificada en el venv del Atlas: coincide con <code>Qwen2VLModel.get_rope_index</code> de HF (config chica en el meta device) en 200 prompts aleatorios con 1 a 3 imágenes, ids y deltas.` },
          { t: 'code', title: 'Solución de referencia (PyTorch)', files: [
            { name: 'mrope_ids.py', lang: 'python', code: [
              'import torch',
              '',
              '',
              'def mrope_position_ids(segments, merge=2):',
              '    """segments: lista de ("text", n) o ("image", (t, h, w)) con la rejilla en parches de 14 (image_grid_thw).',
              '    Devuelve (3, S): fila 0 = t, fila 1 = h, fila 2 = w, y el delta para seguir en decode."""',
              '    cols, pos = [], 0                                    # pos = próximo id libre',
              '    for kind, val in segments:',
              '        if kind == "text":',
              '            ids = torch.arange(pos, pos + val)',
              '            cols.append(ids.expand(3, -1))               # texto: el mismo id en los tres ejes (= RoPE 1-D)',
              '            pos += val',
              '        else:',
              '            t, h, w = val[0], val[1] // merge, val[2] // merge     # rejilla que ve el LLM (tras el merge 2×2)',
              '            tt, hh, ww = torch.meshgrid(torch.arange(t), torch.arange(h), torch.arange(w), indexing="ij")',
              '            ids = torch.stack([tt, hh, ww]).reshape(3, -1) + pos   # (3, t·h·w), fila por fila como los tokens',
              '            cols.append(ids)',
              '            pos = int(ids.max()) + 1                     # el siguiente texto arranca en max + 1 (no en pos + t·h·w)',
              '    ids = torch.cat(cols, dim=1)                         # (3, S)',
              '    delta = int(ids.max()) + 1 - ids.shape[1]            # decode: id del token nuevo = índice + delta',
              '    return ids, delta',
              '',
              '',
              'if __name__ == "__main__":',
              '    # "<|im_start|>user\\n<|vision_start|>" (3 tokens) + imagen de 56×84 px (rejilla 4×6 parches → 2×3 tokens)',
              '    # + "<|vision_end|>¿qué hay?" (4 tokens)',
              '    ids, delta = mrope_position_ids([("text", 3), ("image", (1, 4, 6)), ("text", 4)])',
              '    print(ids)       # t: 0 1 2 | 3 3 3 3 3 3 | 6 7 8 9',
              '    print(delta)     # h: 0 1 2 | 3 3 3 4 4 4 | 6 7 8 9    w: 0 1 2 | 3 4 5 3 4 5 | 6 7 8 9    delta = -3',
            ].join('\n') },
            { name: 'check_mrope.py', lang: 'python', code: [
              'import random',
              'import torch',
              'from transformers import Qwen2VLConfig',
              'from transformers.models.qwen2_vl.modeling_qwen2_vl import Qwen2VLModel',
              'from mrope_ids import mrope_position_ids',
              '',
              'IMG, VSTART, VEND = 151655, 151652, 151653',
              'cfg = Qwen2VLConfig(',
              '    text_config=dict(hidden_size=64, intermediate_size=128, num_hidden_layers=1, num_attention_heads=4,',
              '                     num_key_value_heads=2, rope_scaling={"type": "mrope", "mrope_section": [2, 3, 3]}),',
              '    vision_config=dict(depth=1, embed_dim=32, hidden_size=64, num_heads=2))',
              'with torch.device("meta"):',
              '    model = Qwen2VLModel(cfg)                     # get_rope_index solo usa la config',
              '',
              'random.seed(1)',
              'for _ in range(200):',
              '    segs, ids, types, grids = [], [], [], []',
              '    for _ in range(random.randint(1, 3)):',
              '        nt = random.randint(1, 6)',
              '        segs.append(("text", nt)); ids += [VSTART] * nt; types += [0] * nt',
              '        g = (1, 2 * random.randint(1, 6), 2 * random.randint(1, 6))',
              '        n = g[1] * g[2] // 4',
              '        segs.append(("image", g)); ids += [IMG] * n; types += [1] * n; grids.append(g)',
              '    nt = random.randint(1, 6)',
              '    segs.append(("text", nt)); ids += [VEND] * nt; types += [0] * nt',
              '    mine, delta = mrope_position_ids(segs)',
              '    hf, hf_delta = model.get_rope_index(torch.tensor([ids]), mm_token_type_ids=torch.tensor([types]),',
              '                                        image_grid_thw=torch.tensor(grids))',
              '    assert torch.equal(mine, hf[:, 0]) and delta == int(hf_delta)',
              'print("ok")',
            ].join('\n'), note: 'Sin descargas ni pesos: el modelo se construye en el meta device. Con video, el paper y el código original de HF (v4.45) arrancan el texto siguiente en max(t, h, w) + 1; transformers 5.x avanza max(h, w) aunque el video tenga más grupos temporales que filas o columnas (lo verificamos en 5.19). Para imágenes (t = 1) las dos reglas coinciden.' },
          ] },
          { t: 'list', items: [
            R`Avanzar la posición en el número de tokens de la imagen (pos += h·w): es RoPE 1-D con otro nombre y ya no coincide con el modelo entrenado.`,
            R`Usar la rejilla del ViT (h, w en parches de 14) en vez de la del LLM (h/2, w/2): ids el doble de grandes.`,
            R`Recorrer la imagen columna por columna: los tokens del merger vienen fila por fila, y h y w quedan cruzados.`,
            R`Olvidar el delta en decode: el primer token generado recibe id = índice (mucho mayor que max + 1) y queda "lejos" del prompt; corre sin error y degrada.`,
            R`Darle al texto ids distintos en los tres ejes: el texto deja de ser RoPE 1-D y el LLM preentrenado ya no lo reconoce.`,
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: 'Tu servicio de documentos con Qwen2-VL pasa de 1.2 s a 9 s de latencia con algunos PDFs escaneados. ¿Qué miras primero?', a: 'El tamaño en píxeles de esas páginas y el max_pixels configurado: con el default (hasta 16,384 tokens), un escaneo a 600 dpi entra con ≈ 10–16K tokens y ≈ 4× más parches en el ViT, cuya atención global es cuadrática. Fija max_pixels (o divide la página en regiones) y registra los tokens visuales por petición.' },
            { q: 'Las cajas que devuelve el modelo están corridas y escaladas. El modelo es Qwen2.5-VL y tu código viene de Qwen2-VL. ¿Por qué?', a: 'Qwen2-VL normaliza las coordenadas a [0, 1000); Qwen2.5-VL usa píxeles absolutos de la imagen redimensionada por smart_resize. Tu código divide por 1000 y multiplica por el tamaño original: hay que usar las coordenadas tal cual y reescalar del tamaño redimensionado al original.' },
            { q: 'Portaste Qwen2-VL a tu motor de inferencia y las respuestas sobre la imagen son peores que en HF, aunque el prefill coincide. ¿Sospechoso?', a: 'Las posiciones en decode: si el motor usa id = índice del token en vez de índice + rope_deltas, cada token generado queda corrido respecto del prompt. El prefill coincide porque ahí sí usas get_rope_index.' },
            { q: 'Bajaste max_pixels a 256·28² para ahorrar y el modelo empezó a inventar números de factura. ¿Qué pasó?', a: 'Una página A4 (2480×3508) quedó a 364×532 px: el texto es ilegible y el LLM completa con lo plausible (alucinación). Más presupuesto, o recortar la región de la tabla y mandarla con su propio presupuesto.' },
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página. La receta VLM sigue en los modelos de visión–lenguaje–acción (OpenVLA, RT-2), donde el mismo LLM emite acciones en vez de texto; RoPE y el KV cache, en el <a href="#llm-decoder">decoder</a> y en <a href="#llm-inferencia">inferencia de LLMs</a>.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'qwen2-vl-01', kind: 'formula', q: 'Tokens visuales de Qwen2-VL para una imagen ya redimensionada a H×W.', a: '(H/28)·(W/28): parches de 14 en el ViT, (H/14)·(W/14), y el merger 2×2 los divide por 4.' },
      { id: 'qwen2-vl-02', kind: 'conteo', q: 'Una foto de 1280×720 en Qwen2-VL: tamaño redimensionado, parches del ViT y tokens del LLM.', a: '1288×728; 92·52 = 4,784 parches; 46·26 = 1,196 tokens (+ vision_start y vision_end).' },
      { id: 'qwen2-vl-03', kind: 'formula', q: 'smart_resize: la regla.', a: 'Cada lado al múltiplo de 28 más cercano; si el área &gt; max_pixels, escalar por β = √(hw/max) y redondear hacia abajo; si &lt; min_pixels, escalar por β = √(min/(hw)) y hacia arriba. Proporción máxima 200:1.' },
      { id: 'qwen2-vl-04', kind: 'conteo', q: 'min_pixels y max_pixels por defecto del checkpoint de Qwen2-VL-7B-Instruct.', a: '3,136 (4·28²) y 16,384·28² (≈ 12.8M píxeles): de 4 a 16,384 tokens por imagen. El README sugiere 256·28² a 1280·28².' },
      { id: 'qwen2-vl-05', kind: 'forma', q: 'Forma de pixel_values para una imagen con grid_thw = (1, 52, 92).', a: '4,784 × 1,176: un parche por fila; 1,176 = 3 canales × 2 frames × 14 × 14.' },
      { id: 'qwen2-vl-06', kind: 'forma', q: 'Salida del merger de Qwen2-VL-7B en la config canónica.', a: R`${sh('merged')}: un token del ancho del LLM por cada 2×2 parches.` },
      { id: 'qwen2-vl-07', kind: 'formula', q: 'El merger de Qwen2-VL.', a: R`LayerNorm por parche → concatenar 2×2 parches (4·${cf('Dv')} = ${cf('Dmlpv')}) → Linear ${cf('Dmlpv')} → ${cf('Dmlpv')} → GELU → Linear ${cf('Dmlpv')} → ${cf('D')} (el ancho del LLM).` },
      { id: 'qwen2-vl-08', kind: 'concepto', q: '¿Por qué RoPE 2-D en el ViT y no una tabla de posiciones?', a: 'Una tabla está atada a una rejilla y hay que interpolarla; con RoPE 2-D (la mitad de las frecuencias con la fila, la otra con la columna) el score depende del desplazamiento y vale para cualquier rejilla, sin parámetros.' },
      { id: 'qwen2-vl-09', kind: 'formula', q: 'M-RoPE: ids de texto, imagen y video.', a: 'Texto: t = h = w = m (RoPE 1-D). Imagen desde s: t = s, h = s + fila, w = s + columna. Video: t = s + k por grupo de 2 frames. Lo siguiente arranca en max + 1.' },
      { id: 'qwen2-vl-10', kind: 'conteo', q: 'mrope_section de Qwen2-VL y qué significa.', a: R`[16, 24, 24]: de las 64 frecuencias de d_h = ${cf('dh')}, las 16 primeras (más rápidas) rotan con t, 24 con h y las 24 más lentas con w.` },
      { id: 'qwen2-vl-11', kind: 'concepto', q: 'Prompt: 3 tokens de texto, imagen de 2×3 tokens, 4 de texto. Ids de M-RoPE y rope_deltas.', a: 't: 0 1 2 | 3×6 | 6 7 8 9; h: 0 1 2 | 3 3 3 4 4 4 | 6…; w: 0 1 2 | 3 4 5 3 4 5 | 6…; delta = 10 − 13 = −3.' },
      { id: 'qwen2-vl-12', kind: 'trampa', q: '"Tras una imagen de N tokens, la posición avanza N."', a: 'Avanza max(g_h, g_w) (el lado mayor de la rejilla del LLM): una imagen de 26×46 = 1,196 tokens consume 46 posiciones.' },
      { id: 'qwen2-vl-13', kind: 'concepto', q: '¿Qué es rope_deltas?', a: '(max id + 1) − largo del prompt, ≤ 0. En decode, id del token nuevo = índice + delta (igual en los tres ejes). Olvidarlo corre las posiciones sin error.' },
      { id: 'qwen2-vl-14', kind: 'concepto', q: '¿Cómo procesa Qwen2-VL un video?', a: '2 fps; frames redimensionados; una conv 3-D de profundidad 2 funde cada par de frames en un tubo 2×14×14; ViT por par de frames; merger 2×2; t de M-RoPE +1 por par. Tope de 16,384 tokens por video al entrenar.' },
      { id: 'qwen2-vl-15', kind: 'concepto', q: '¿Por qué una imagen se duplica en el tiempo?', a: 'El patch embedding es una conv 3-D de profundidad 2 compartida con el video: una imagen = dos frames iguales (§2.1). No agrega tokens.' },
      { id: 'qwen2-vl-16', kind: 'conteo', q: '¿Por qué 224×224 son 66 tokens en el paper?', a: '(224/28)² = 64 tokens visuales + &lt;|vision_start|&gt; + &lt;|vision_end|&gt; (§2.1).' },
      { id: 'qwen2-vl-17', kind: 'conteo', q: 'Parámetros del ViT de Qwen2-VL en 2B, 7B y 72B.', a: 'El mismo ≈ 675M en los tres (Tabla 1); solo cambia la salida del merger. En el 2B, la visión pesa mucho más en proporción.' },
      { id: 'qwen2-vl-18', kind: 'concepto', q: 'Tres etapas de entrenamiento de Qwen2-VL.', a: '1) Solo el ViT (LLM congelado), ≈ 600B tokens imagen–texto; 2) todo, ≈ 800B tokens más; 3) instrucciones con el ViT congelado. 1.4T tokens acumulados (§2.2).' },
      { id: 'qwen2-vl-19', kind: 'trampa', q: '"En Qwen2-VL el encoder de visión queda congelado, como en LLaVA."', a: 'Es lo primero que se entrena: se le quitó la tabla de posiciones (RoPE 2-D) y recibe rejillas de cualquier tamaño. Solo se congela en el instruction tuning.' },
      { id: 'qwen2-vl-20', kind: 'concepto', q: 'Tabla 7 del paper: 64 fijos vs 3,136 fijos vs dinámico.', a: 'InfoVQA 28.85 / 77.27 / 75.89; OCRBench 572 / 786 / 866. El dinámico (≈ 1,924 tokens en promedio) iguala a 3,136 fijos con menos tokens.' },
      { id: 'qwen2-vl-21', kind: 'concepto', q: 'Formato de cajas de Qwen2-VL.', a: '&lt;|box_start|&gt;(x1,y1),(x2,y2)&lt;|box_end|&gt; con coordenadas normalizadas a [0, 1000), y &lt;|object_ref_start|&gt;…&lt;|object_ref_end|&gt; para la frase. Generadas como texto.' },
      { id: 'qwen2-vl-22', kind: 'trampa', q: '"Las cajas de Qwen2.5-VL se desnormalizan dividiendo por 1000."', a: 'No: Qwen2.5-VL usa píxeles absolutos de la imagen redimensionada (smart_resize). Dividir por 1000 es la regla de Qwen2-VL (y Qwen-VL).' },
      { id: 'qwen2-vl-23', kind: 'trampa', q: '"Qwen-VL (2023) ya tenía resolución dinámica y M-RoPE."', a: 'No: Qwen-VL usa 448 fijo y un resampler de una capa de cross-attention con 256 queries (256 tokens por imagen). La resolución nativa y M-RoPE llegan con Qwen2-VL (2024).' },
      { id: 'qwen2-vl-24', kind: 'concepto', q: 'Qwen2.5-VL: qué cambia en el ViT y por qué.', a: 'Ventanas de 112×112 px (8×8 parches) con solo 4 capas globales (7, 15, 23, 31), RMSNorm y SwiGLU: el costo del encoder pasa de cuadrático a ≈ lineal en el área.' },
      { id: 'qwen2-vl-25', kind: 'concepto', q: 'Qwen2.5-VL: qué cambia en M-RoPE.', a: 'El id temporal se alinea al tiempo absoluto (los intervalos entre ids reflejan segundos) y se entrena con FPS dinámico: permite localizar eventos en segundos.' },
      { id: 'qwen2-vl-26', kind: 'tradeoff', q: 'Resolución fija vs tiling vs nativa.', a: 'Fija: barata y predecible, pierde texto chico y proporción. Tiling: reutiliza el encoder, tokens escalonados, costuras. Nativa: tokens ∝ área sin costuras, pero hay que entrenar el ViT y su atención global es cuadrática.' },
      { id: 'qwen2-vl-27', kind: 'tradeoff', q: 'Presupuesto de tokens visuales bajo vs alto.', a: 'Bajo: latencia, KV, más imágenes por prompt; pierde documentos (64 tokens: InfoVQA 28.85). Alto: OCR de páginas; latencia cuadrática del ViT y KV grande.' },
      { id: 'qwen2-vl-28', kind: 'concepto', q: '¿Cómo se agrupan en un batch imágenes de distinto tamaño en el ViT?', a: 'Sin padding: se concatenan los parches y cu_seqlens marca los límites; FlashAttention varlen hace atención por bloques (Patch n\' Pack, NaViT).' },
      { id: 'qwen2-vl-29', kind: 'concepto', q: 'Atención del ViT de Qwen2-VL en un video: ¿entre qué parches?', a: 'Solo dentro de cada par de frames (cada grupo temporal es su propia secuencia en cu_seqlens): el costo del ViT es lineal en frames. El tiempo se mezcla en la conv 3-D y en el LLM.' },
      { id: 'qwen2-vl-30', kind: 'trampa', q: '"El ViT es barato: tiene 10 veces menos parámetros que el LLM."', a: 'Procesa 4× más filas que el LLM (antes del merger) con atención global ∝ N_v²: a resolución alta puede costar tanto como el prefill del LLM, o más.' },
      { id: 'qwen2-vl-31', kind: 'conteo', q: 'Ablación de M-RoPE vs RoPE 1-D (Tabla 8).', a: 'MathVista 39.2 → 43.4, MMBench 58.6 → 60.6, NextQA 43.9 → 46.0, STAR 55.5 → 57.9; RealWorldQA 54.5 → 53.7.' },
      { id: 'qwen2-vl-32', kind: 'concepto', q: 'Diferencias del LLM de Qwen2-VL-7B con Llama 3 8B.', a: R`Mismo esquema (RMSNorm, GQA, SwiGLU, RoPE), pero Q/K/V con bias, ${cf('G')} cabezas de KV, θ = 10⁶, vocabulario de ${cf('V')} y M-RoPE.` },
      { id: 'qwen2-vl-33', kind: 'trampa', q: '"Un 2B es la opción de edge para documentos: la visión se achica con el modelo."', a: 'El ViT de ≈ 675M es el mismo en 2B, 7B y 72B: el costo del encoder no baja. Baja max_pixels o recorta.' },
      { id: 'qwen2-vl-34', kind: 'concepto', q: 'Video largo: ¿por qué se pierden los eventos cortos?', a: 'Con 2 fps y un tope de tokens (16K), un video de 10 min deja ≈ 27 tokens por par de frames; lo que pasa entre frames muestreados o en pocos píxeles no llega al modelo. Y en Qwen2-VL el id t cuenta pares de frames, no segundos.' },
      { id: 'qwen2-vl-35', kind: 'concepto', q: 'Extrapolación de largo en video (Fig. 5).', a: 'Entrenado con hasta 16K tokens por video, rinde con 80K en inferencia; el paper lo atribuye a M-RoPE (los ids crecen más despacio que la secuencia).' },
      { id: 'qwen2-vl-36', kind: 'tradeoff', q: 'Merger 2×2 vs parches de 28 en el ViT.', a: 'Parches de 14 + merger: el ViT preentrenado trabaja fino en todas sus capas y la reducción ocurre al final, con los 4 vectores enteros en el MLP. Parches de 28: más barato pero más grueso desde la primera capa.' },
      { id: 'qwen2-vl-37', kind: 'forma', q: 'ViT de Qwen2-VL: ancho, capas, cabezas, d_h de la RoPE 2-D.', a: R`D_v = ${cf('Dv')}, ${cf('Lv')} capas, ${cf('hv')} cabezas: d_v = ${cf('dv')}, con 20 frecuencias para la fila y 20 para la columna (θ = 10⁴).` },
      { id: 'qwen2-vl-38', kind: 'concepto', q: 'Tokens especiales alrededor de una imagen en el prompt de Qwen2-VL.', a: '&lt;|vision_start|&gt;, N × &lt;|image_pad|&gt; (reemplazados por los embeddings visuales), &lt;|vision_end|&gt;. Video: &lt;|video_pad|&gt;.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'naive dynamic resolution', es: 'resolución dinámica (nativa)', def: 'Procesar cada imagen con su tamaño (redondeado a múltiplos de 28) en vez de redimensionarla a un cuadrado fijo: los tokens crecen con el área.', say: 'Naive dynamic resolution maps each image to a number of tokens proportional to its area.' },
      { en: 'smart_resize', es: 'smart_resize', def: 'La regla del processor de Qwen2-VL: lados múltiplos de 28, área dentro de [min_pixels, max_pixels], proporción casi igual.', say: 'smart_resize rounds both sides to multiples of twenty-eight within a pixel budget.' },
      { en: 'min_pixels / max_pixels', es: 'presupuesto de píxeles', def: 'Área mínima y máxima de una imagen tras el redimensionado; fijan el rango de tokens visuales (área / 784).', say: 'max_pixels is the main cost knob of Qwen2-VL.' },
      { en: '2-D RoPE', es: 'RoPE 2-D (axial)', def: 'RoPE en la que la mitad de las frecuencias rota con la fila y la otra mitad con la columna del parche: atención que depende del desplazamiento 2-D.', say: '2-D RoPE makes the ViT work on any grid without position-embedding interpolation.' },
      { en: 'patch merger', es: 'merger de parches', def: 'LayerNorm + concatenar 2×2 parches vecinos + MLP al ancho del LLM: 4× menos tokens.', say: 'The merger fuses each two-by-two block of patches into one LLM token.' },
      { en: 'M-RoPE (multimodal RoPE)', es: 'RoPE multimodal', def: 'RoPE con tres ids por token (tiempo, alto, ancho) y las frecuencias repartidas entre ellos; en texto se reduce a RoPE 1-D.', say: 'Multimodal RoPE gives each token temporal, height and width positions.' },
      { en: 'mrope_section', es: 'reparto de frecuencias', def: 'Cuántas frecuencias de cada cabeza usa cada eje de M-RoPE: [16, 24, 24] en Qwen2-VL.', say: 'mrope_section splits the rotary frequencies across time, height and width.' },
      { en: 'rope_deltas', es: 'desfase de posiciones', def: 'Diferencia entre el máximo id de M-RoPE + 1 y el largo del prompt; se suma al índice de cada token generado.', say: 'rope_deltas keeps decode positions consistent after an image.' },
      { en: 'temporal patch', es: 'parche temporal', def: 'Profundidad 2 de la conv 3-D del patch embedding: cada token cubre dos frames; una imagen se duplica.', say: 'A temporal patch of two fuses consecutive frames into one token.' },
      { en: 'grid_thw', es: 'rejilla (t, h, w)', def: 'Tamaño de la rejilla de una imagen o video en parches de 14 (t en pares de frames) que el processor pasa al modelo.', say: 'grid_thw tells the model the patch grid of each image.' },
      { en: 'sequence packing (Patch n\' Pack)', es: 'empaquetado de secuencias', def: 'Concatenar las secuencias de varias imágenes sin padding y separar la atención con una máscara por bloques (cu_seqlens).', say: 'Packing avoids padding images of different sizes.' },
      { en: 'cu_seqlens', es: 'largos acumulados', def: 'Vector con los inicios de cada secuencia en un batch empaquetado; lo usa FlashAttention varlen para atender por bloques.', say: 'cu_seqlens marks where each packed image starts.' },
      { en: 'AnyRes / dynamic tiling', es: 'recortes dinámicos', def: 'Cubrir una imagen con recortes del tamaño del encoder (más una versión reducida) según su proporción: LLaVA-NeXT, InternVL.', say: 'Tiling reuses a fixed-resolution encoder on crops.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
