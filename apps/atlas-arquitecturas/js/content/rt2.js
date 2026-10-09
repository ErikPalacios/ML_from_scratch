/* =============================================================================
   Atlas de Arquitecturas — js/content/rt2.js
   Página de modelo: RT-2 (Brohan et al., CoRL 2023, arXiv:2307.15818). Plantilla fija de 11 secciones (SPEC §5.3),
   versión "nivel 2 parcial" (SPEC §21.1): los pesos y la arquitectura exacta del modelo afinado NO son públicos, así
   que esta página no tiene configuración del calculador. Las secciones que en otras páginas son tablas generadas
   (op, trace, params, flops, scaling, shapedrill, whatif) aquí son hechos citados, cuentas a mano con la fuente al
   lado y estimaciones marcadas con est(); los números calculados de la réplica abierta viven en js/content/openvla.js
   (se enlazan, no se duplican). Las acciones continuas con flow matching son de js/content/pi0.js (solo se enlazan).
   Regla: todo número cita sección o tabla del paper; lo estimado va en est() con la cuenta al lado. Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  const OV = 'openvla-7b';
  const qn = (path, cfg) => '{{' + (cfg || OV) + '.' + path + '}}';

  const P = 'Brohan et al., <i>RT-2: Vision-Language-Action Models Transfer Web Knowledge to Robotic Control</i>, CoRL 2023, arXiv:2307.15818';
  const RT1 = 'Brohan et al., <i>RT-1: Robotics Transformer for Real-World Control at Scale</i>, RSS 2023, arXiv:2212.06817';
  const OXE = 'Open X-Embodiment Collaboration, <i>Open X-Embodiment: Robotic Learning Datasets and RT-X Models</i>, ICRA 2024, arXiv:2310.08864';
  const OVLA = 'Kim et al., <i>OpenVLA: An Open-Source Vision-Language-Action Model</i>, CoRL 2024, arXiv:2406.09246';
  const PALIX = 'Chen et al., <i>PaLI-X: On Scaling up a Multilingual Vision and Language Model</i>, arXiv:2305.18565 (2023)';
  const PALME = 'Driess et al., <i>PaLM-E: An Embodied Multimodal Language Model</i>, ICML 2023, arXiv:2303.03378';
  const FAST = 'Pertsch et al., <i>FAST: Efficient Action Tokenization for Vision-Language-Action Models</i>, arXiv:2501.09747 (2025)';
  const RT1CODE = 'el tokenizador abierto de RT-1 (<code>robotics_transformer/tokenizers/action_tokenizer.py</code>, repo google-research/robotics_transformer)';

  ATLAS.register({
    id: 'rt2',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> RT-2 recibe una foto de la cámara del robot y una instrucción ("pick up the bag about to fall off the table") y responde con <b>8 números enteros escritos como texto</b>: si terminar el episodio, cuánto mover la pinza en x, y, z, cuánto rotarla en los tres ejes y cuánto abrirla, cada número un bin de 0 a 255. Un controlador convierte esos números en un movimiento, el robot lo ejecuta, la cámara toma otra foto y el ciclo se repite, 1 a 3 veces por segundo con el modelo de 55B (${P}, §3.3).` },
          { t: 'p', html: R`La idea es la de <a href="#llava">LLaVA</a> llevada al robot: un VLM ya entrenado con miles de millones de pares imagen-texto, al que se le enseña que hay una pregunta más, "¿qué acción debe tomar el robot para…?", cuya respuesta es una acción. Por eso se llama <b>VLA</b> (vision-language-action model). El resultado que se cita en entrevistas: el robot entiende objetos, símbolos y relaciones que <b>nunca</b> aparecieron en sus datos de robot ("move apple to 3", "move the coke can to the person with glasses"), porque los aprendió de la web. Lo que <b>no</b> gana: movimientos nuevos.` },
          { t: 'callout', kind: 'note', title: 'Qué es público y qué no', html: R`<p>RT-2 es de Google DeepMind y sus pesos <b>no se publicaron</b>. Esta página es "nivel 2 parcial": no hay tablas de parámetros ni de MACs generadas por el calculador, porque la arquitectura exacta del modelo afinado no está disponible para reproducirla. Lo que sí es público y está citado: el formato de las acciones, la receta de entrenamiento (mezcla, learning rate, batch, pasos), los tamaños de los VLMs base, las frecuencias de control y todas las evaluaciones. Para los números calculados (tokens, parámetros, MACs, Hz por GPU) de un VLA con la misma idea, la página de <a href="#openvla">OpenVLA</a> tiene la réplica abierta completa.</p>` },
          { t: 'table', caption: 'Lo público y lo cerrado de RT-2', head: ['Aspecto', '¿Público?', 'Qué se sabe'], rows: [
            ['Representación de las acciones', 'Sí', 'Terminar + Δpos (3) + Δrot (3) + pinza; cada continua en 256 bins uniformes; texto con espacios (§3.2)'],
            ['VLMs base', 'Sí (descripción)', R`PaLI-X 5B y 55B (ViT-22B + encoder-decoder de 32B en el de 55B) y PaLM-E 12B (ViT-4B + un LLM) (§4, Apéndice D; ${PALIX}; ${PALME})`],
            ['Receta', 'Sí', 'Co-fine-tuning con los datos web originales; robot ≈ 50 % (PaLI-X) o ≈ 66 % (PaLM-E) de la mezcla; LR, batch y pasos (Apéndices B y E)'],
            ['Datos de robot', 'En parte', R`Los de RT-1 (13 robots, 17 meses, una cocina de oficina, ${RT1}); hoy están en Open X-Embodiment como <code>fractal20220817_data</code> (${OXE})`],
            ['Pesos, código de entrenamiento', 'No', 'Ni los modelos afinados ni el código; los VLMs base de 55B y 12B tampoco son abiertos'],
            ['Resolución y tokens de imagen en el robot', 'No', 'El paper no los da para el robot; cualquier cuenta de prefill es una estimación'],
            ['Evaluaciones', 'Sí', '≈ 6,000 trayectorias: tareas vistas, objetos/fondos/entornos nuevos, capacidades emergentes, ablaciones (§4, Apéndice H)'],
          ] },
          { t: 'table', caption: 'Cuándo sí y cuándo no (la idea de RT-2, hoy con un VLA abierto)', head: ['Situación', '¿Un VLA tipo RT-2?', 'Por qué'], rows: [
            ['Manipulación con instrucciones en lenguaje abierto, objetos que cambian, muchas tareas', 'Sí', 'Es donde gana: generalización semántica que viene de la web (objetos nuevos ≈ 2× RT-1, Tabla 6).'],
            ['Una sola tarea fija, con precisión fina (insertar una pieza a ±0.5 mm)', 'No', 'Un controlador clásico o una política chica entrenada para esa tarea es más precisa, más rápida y verificable.'],
            ['Control a 50 Hz, manos o brazos dobles con contacto rápido', 'No tal cual', R`1–3 Hz y una acción por inferencia no alcanzan; hacen falta chunks de acciones (ver <a href="#pi0">π0</a> y OpenVLA-OFT en <a href="#openvla.variantes">OpenVLA</a>).`],
            ['Movimientos que no están en tus demostraciones', 'No', 'RT-2 no aprende habilidades motoras nuevas de la web: solo despliega las que ya vio de otras formas (§5).'],
            ['Quieres reproducirlo o ajustarlo', 'Usa OpenVLA', R`RT-2 está cerrado; <a href="#openvla">OpenVLA</a> es la versión abierta de la misma idea (7B, 970K demostraciones).`],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"RT-2 turns a large vision-language model into a robot policy by writing actions as text. Each continuous action dimension, the end-effector position and rotation deltas and the gripper, is discretized into 256 bins, and the bin indices become tokens, plus a terminate flag. The model is co-fine-tuned on robot demonstrations together with the original web data, so it keeps its semantic knowledge and generalizes to unseen objects and instructions. The cost is size: the 55-billion-parameter model runs at one to three hertz on a cloud TPU service."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Desde LLaVA.</b> Ya viste que un VLM es encoder de imagen + conector + LLM, y que la respuesta es una secuencia de tokens con next-token prediction. RT-2 no cambia nada de eso: cambia la <b>respuesta</b>. En vez de "Sobre la mesa hay una manzana", la respuesta es algo como "0 158 128 107 130 126 127 255" (ilustrativo: lo armamos en <a href="#rt2.operaciones">operaciones</a>). La pérdida es la misma entropía cruzada sobre esos tokens; en robótica eso se llama <b>behavior cloning</b>: imitar la acción del demostrador dado lo que se ve.` },
          { t: 'p', html: R`<b>Desde control.</b> Si vienes de robótica clásica, piensa en una política \(\pi(a_t \mid o_t, \ell)\): observación (imagen) + objetivo (la instrucción ℓ) → acción. La acción no son torques ni ángulos de articulación: es un <b>delta de la pose del efector final</b> (cuánto moverse en el espacio cartesiano en este paso) más la pinza. Un controlador de bajo nivel (IK + control de posición del robot) convierte ese delta en movimiento de articulaciones. RT-2 vive arriba de ese controlador, a 1–3 Hz; el lazo de servo sigue corriendo a su frecuencia.` },
          { t: 'table', caption: 'Qué equivale a lo que ya sabes y qué es nuevo', head: ['Concepto', 'Lo que sabes', 'RT-2', '¿Nuevo?'], rows: [
            ['Modelo base', R`VLM (<a href="#llava">LLaVA</a>): encoder + conector + LLM`, 'PaLI-X (ViT-22B + encoder-decoder de 32B) o PaLM-E (ViT-4B + LLM decoder-only)', 'Igual'],
            ['Entrada', 'Imagen + pregunta', R`Imagen de la cámara + "Q: what action should the robot take to [instrucción]? A:" (§3.2)`, 'Igual (formato VQA)'],
            ['Salida', 'Texto libre', '8 enteros: terminar, Δx, Δy, Δz, Δroll, Δpitch, Δyaw, pinza', '<b>Nuevo</b>'],
            ['Vocabulario', 'Tokens de texto', 'PaLI-X: los tokens de los enteros 0–255; PaLM-E: se pisan los 256 tokens menos usados', '<b>Nuevo</b>'],
            ['Pérdida', 'Next-token sobre la respuesta', 'La misma = behavior cloning sobre los tokens de acción', 'Igual'],
            ['Datos', 'Imagen-texto de la web', 'Web + demostraciones de robot en el mismo batch (co-fine-tuning)', '<b>Nuevo</b>'],
            ['Decodificación', 'Sampling libre', 'Restringida a tokens de acción válidos cuando la tarea es de robot (§3.2)', 'Cambia'],
            ['Lazo', 'Una respuesta y listo', 'Lazo cerrado: acción → robot → nueva imagen → acción, a 1–3 Hz', '<b>Nuevo</b>'],
          ] },
          { t: 'h3', text: 'El antecesor: RT-1' },
          { t: 'p', html: R`RT-1 (${RT1}) es un transformer de 35M parámetros entrenado desde cero con ≈ 130K episodios de 700+ tareas recolectados por 13 robots en 17 meses; corre a 3 Hz en el robot y ya discretizaba cada dimensión de la acción en 256 bins. RT-2 conserva los datos y la discretización y reemplaza el modelo por un VLM preentrenado en la web. Con los <b>mismos</b> datos de robot, en tareas vistas quedan casi iguales (91–93 % contra 92 %), pero en escenarios nuevos RT-2 promedia 62 % contra 32 % (${P}, Apéndice H, Tabla 6). Toda la diferencia viene de lo que el VLM ya sabía.` },
          { t: 'callout', kind: 'connect', html: R`<p>Las tres páginas de esta fase son tres respuestas a "¿cómo sale una acción de un VLM?": RT-2 (tokens discretos, modelo cerrado y enorme), <a href="#openvla">OpenVLA</a> (la misma idea, abierta, 7B, con números del calculador) y <a href="#pi0">π0</a> (acciones continuas en chunks con flow matching). La comparación completa está en <a href="#openvla.fallas">OpenVLA → trade-offs</a>.</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`El VLM es una caja cerrada: no se puede abrir porque su arquitectura afinada no es pública (por eso el diagrama no tiene formas del calculador en las aristas: cada arista dice qué pasa, no su tamaño). Lo interesante está a la salida: la tira de 8 tokens y la des-tokenización a una acción continua. "Recorrido" sigue un paso del lazo.` },
          { t: 'archdiagram', diagram: 'rt2-overview', walk: 'forward', wide: true, caption: R`RT-2: imagen + instrucción → VLM (PaLI-X o PaLM-E, cerrado) → 8 tokens (terminar + 7 bins) → des-tokenizar → delta de pose + pinza → robot → nueva imagen. Sin números del calculador: pesos cerrados.` },
          { t: 'p', html: R`<b>Cómo se ve una acción como tokens.</b> Abajo, una trayectoria sintética de 7 grados de libertad pasa por los 256 bins: la curva continua, la escalera que queda después de cuantizar, y la tira de tokens que el modelo escribe en un paso. Cambia los bins para ver crecer el error.` },
          { t: 'viz', kind: 'action-tokenizer', params: { model: 'rt2', bins: 256, bounds: 'minmax' }, caption: 'Episodio sintético (rotulado), 256 bins uniformes por dimensión como en RT-1/RT-2. El error máximo es medio bin si se reconstruye en el centro. La regla de tokens de RT-2 (enteros como texto en PaLI-X) es la del paper.' },
          { t: 'archdiagram', diagram: 'rt2-action-tokens', caption: 'Una dimensión de la acción: valor continuo → bin b (de 256) → token, y de vuelta al centro del bin. En PaLI-X el token es el entero b como texto; en PaLM-E, uno de los 256 tokens menos usados. La tira completa de un paso (terminar + 7) está en la vista general.' },
          { t: 'callout', kind: 'trap', title: 'El ejemplo del paper tiene 7 números', html: R`<p>El texto de §3.2 dice "8 integer numbers" y da como ejemplo "1 128 91 241 5 101 127": son <b>siete</b>. El ejemplo de chain-of-thought de §4.4 sí tiene ocho ("1 128 124 136 121 158 111 255"). La respuesta correcta es la del texto: terminar + 6 de pose + 1 de pinza = 8. Si en una entrevista dices "siete tokens", estás describiendo <a href="#openvla">OpenVLA</a>, que no tiene el token de terminar.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero con números. La pinza está a 4 cm de una lata. El demostrador, en ese paso, movió el efector 1.2 cm hacia adelante, nada en y, 0.8 cm hacia abajo, giró 2° y mantuvo la pinza abierta. Con un rango de ±5 cm por eje en 256 bins, cada bin mide 100 mm / 256 ≈ 0.39 mm; +1.2 cm cae en el bin ⌊(12 + 50)/100 · 256⌋ = 158. Así con cada dimensión: el paso se escribe "0 158 128 107 …", el modelo aprende a predecir ese texto dada la imagen, y en el robot se lee al revés: bin 158 → centro del bin → +1.19 cm, a 0.09 mm del valor original: menos de medio bin (rango ilustrativo, no el del paper).` },
          { t: 'callout', kind: 'note', html: R`<p>En otras páginas esta sección tiene tarjetas por bloque con formas y MACs del calculador. Aquí el VLM es cerrado: las operaciones que se pueden escribir con exactitud son las de <b>entrada y salida</b> (formato del prompt, discretización, mapeo a tokens, restricción de la decodificación, des-tokenización). Las del VLM por dentro son las de <a href="#llava.operaciones">LLaVA</a> y del <a href="#llm-decoder.operaciones">decoder</a>, con otro tamaño.</p>` },
          { t: 'h3', text: '1. El prompt' },
          { t: 'p', html: R`La observación es la imagen de la cámara del robot; el texto usa el formato VQA estándar de los VLMs base: <code>Q: what action should the robot take to [task instruction]? A:</code> (§3.2). Las instrucciones de los datos de RT-1 son verbo + objetos ("pick 7up can", "open top drawer", "place … into …"), con siete habilidades (Apéndice B). No hay historia de imágenes ni estado propioceptivo en la entrada: cada paso decide con la foto actual.` },
          { t: 'h3', text: '2. Discretizar cada dimensión en 256 bins' },
          { t: 'math', display: true, tex: R`b_j = \min\!\Big(\Big\lfloor \frac{\mathrm{clip}(a_j,\ \ell_j,\ h_j)-\ell_j}{h_j-\ell_j}\cdot 256 \Big\rfloor,\ 255\Big),\qquad j = 1..7,\qquad \Delta_j = \frac{h_j-\ell_j}{256}`, caption: 'a_j: valor continuo de la dimensión j (Δx, Δy, Δz, Δroll, Δpitch, Δyaw, pinza); [ℓ_j, h_j]: límites fijos de esa dimensión; b_j ∈ {0..255}; Δ_j: ancho del bin. "Uniformly" (§3.2): bins iguales entre los límites. Los límites de RT-1/RT-2 son los del espacio de acción (min–max), no cuantiles.' },
          { t: 'p', html: R`<b>Por qué 256.</b> Un byte por dimensión: suficiente resolución para deltas por paso de unos centímetros (con ±5 cm, 0.39 mm por bin) y pocos tokens nuevos que aprender. Más bins = más precisión, pero cada bin se ve menos veces en los datos y el softmax se reparte entre más clases. 256 es la elección de RT-1, heredada sin ablación en RT-2.` },
          { t: 'h3', text: '3. Del bin al token: depende del tokenizador' },
          { t: 'table', head: ['Backbone', 'Cómo se elige el token del bin b', 'Por qué'], rows: [
            ['PaLI-X (5B, 55B)', 'El token del entero b: "0", "1", …, "255"', 'Su tokenizador tiene un token único para cada entero hasta 1000 (§3.2): el número ya es un token, no hay que inventar nada.'],
            ['PaLM-E (12B)', 'Se pisan los 256 tokens menos frecuentes del vocabulario', 'Su tokenizador no tiene esa representación de los números; reusar tokens raros evita agrandar la tabla de embeddings y el LM head.'],
          ], note: R`El paper llama a esto una forma de <i>symbol tuning</i>: enseñarle al modelo un significado nuevo para tokens existentes. OpenVLA usa la segunda opción con Llama: los últimos 256 ids (ver <a href="#openvla.operaciones">OpenVLA</a>).` },
          { t: 'math', display: true, tex: R`\text{respuesta} = \texttt{"}\,t\ \ b_{\Delta x}\ \ b_{\Delta y}\ \ b_{\Delta z}\ \ b_{\Delta\text{roll}}\ \ b_{\Delta\text{pitch}}\ \ b_{\Delta\text{yaw}}\ \ b_\text{pinza}\,\texttt{"},\qquad t\in\{0,1\}`, caption: 'Los 8 enteros separados por espacios (§3.2). t = terminar: la política misma decide cuándo terminó la tarea. En PaLI-X, cada entero es un token; los espacios los maneja el tokenizador.' },
          { t: 'h3', text: '4. La pérdida: behavior cloning como next-token' },
          { t: 'math', display: true, tex: R`\mathcal{L}(\theta) = -\sum_{k=1}^{8} \log p_\theta\big(y_k \mid \text{imagen},\ \text{instrucción},\ y_{\lt k}\big)\quad\text{(robot)}\qquad+\qquad \mathcal{L}_\text{VLM}\quad\text{(web, en el mismo batch)}`, caption: 'y_k: el k-ésimo token de la acción del demostrador. Es la entropía cruzada de siempre: maximizar la probabilidad de la acción del demostrador = behavior cloning (Apéndice E: "corresponds to the behavior cloning loss"). La parte web es la pérdida original de PaLI-X o PaLM-E sobre VQA y captions.' },
          { t: 'h3', text: '5. Decodificar solo acciones válidas' },
          { t: 'p', html: R`Cuando la pregunta es de robot, el muestreo se restringe a los tokens de acción válidos (§3.2, "Output Constraint"); en las tareas de VQA el modelo sigue pudiendo escribir cualquier texto. Es decodificación con restricciones (la misma máscara sobre los logits de <a href="#llm-inferencia.entrevista">inferencia de LLMs</a>): garantiza que la salida <b>parsea</b> como 8 enteros en rango, no que la acción sea buena.` },
          { t: 'h3', text: '6. De vuelta a una acción continua' },
          { t: 'math', display: true, tex: R`\hat a_j = \ell_j + \big(b_j + \tfrac12\big)\,\Delta_j,\qquad |\hat a_j - a_j| \le \tfrac{\Delta_j}{2}\quad\text{si } a_j\in[\ell_j, h_j]`, caption: 'Reconstruir en el centro del bin da error máximo de medio bin. El tokenizador abierto de RT-1 hace otra cosa: trunca u·255 y reconstruye en el borde izquierdo, con error de hasta un bin entero y sesgo de −½ bin (lo verás en la práctica). El paper de RT-2 no dice cuál usa.' },
          { t: 'p', html: R`El controlador recibe Δpos, Δrot y la pinza, los suma a la pose actual del efector, y el lazo de bajo nivel del robot los ejecuta. Cuando t = 1, el episodio termina. Después la cámara toma otra imagen y vuelve a empezar: <b>una inferencia completa del VLM por cada paso de control</b>, sin reusar nada del paso anterior.` },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los detalles de PaLI-X por dentro (ViT-22B, un encoder-decoder de 50 capas tipo UL2) y de PaLM-E (un ViT-4B que proyecta al espacio de tokens de un LLM decoder-only). En entrevista basta: "two VLM backbones, an encoder-decoder and a decoder-only; the action head is the same LM head".</p>` },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Sin pesos públicos no hay tabla de parámetros por bloque ni de MACs. Lo que sí hay: los tamaños totales de los VLMs base y una cuenta de presupuesto de tokens que explica por qué 55B dan 1–3 Hz. Para el desglose exacto de un VLA de 7B (visión, projector, LLM, prefill, decode) mira <a href="#openvla.costo">OpenVLA → costo</a>: ${qn('params.total')} parámetros, calculados.` },
          { t: 'table', caption: 'Tamaños públicos (Apéndice D y §3.3)', head: ['Modelo', 'Parámetros', 'Partes', 'Frecuencia de control'], rows: [
            ['RT-1 (antecesor)', '35M', 'EfficientNet + TokenLearner + transformer, desde cero', '3 Hz en el robot'],
            ['RT-2-PaLI-X-5B', '5B', 'PaLI-X chico (ViT + encoder-decoder)', '≈ 5 Hz (servicio en la nube)'],
            ['RT-2-PaLM-E-12B', '12B', 'ViT-4B + LLM decoder-only', 'No reportada por separado'],
            ['RT-2-PaLI-X-55B', '55B', 'ViT-22B + encoder-decoder de 32B y 50 capas', '1–3 Hz (servicio multi-TPU en la nube)'],
            [R`OpenVLA-7B (réplica abierta)`, qn('params.total'), 'DINOv2 + SigLIP + MLP + Llama 2 7B', R`≈ 6 Hz en una RTX 4090, bf16 (${OVLA}, §3.5)`],
          ] },
          { t: 'h3', text: 'Presupuesto de tokens: por qué 1–3 Hz' },
          { t: 'p', html: R`Cada paso de control es un prefill (imagen + instrucción) que ya da el primer token, seguido de 7 pasos de decode, uno por token de acción restante. El decode a batch 1 está limitado por memoria: cada paso lee los pesos que participan en generar un token (<a href="#llm-inferencia.diagrama">inferencia de LLMs</a>). Ojo con PaLI-X: es encoder-decoder, así que el ViT-22B y el encoder corren una vez por paso de control y cada token de decode lee solo los pesos del <b>decoder</b>; cómo se reparten los 32B entre encoder y decoder no está en el paper de RT-2. La cuenta, con ese supuesto explícito:` },
          { t: 'calc', title: 'Tokens por paso × pasos por segundo (cuenta a mano)', rows: [
            { label: 'Tokens de acción por paso', expr: 'terminar + 6 de pose + pinza', value: '8', note: 'paper, §3.2' },
            { label: 'Frecuencia del 55B', expr: 'medida en el servicio de la nube', value: '1–3 Hz', note: 'paper, §3.3' },
            { label: 'Tokens de acción por segundo', expr: '8 × (1–3 Hz)', value: '8–24 tok/s' },
            { label: 'Pesos que lee un token de decode', expr: 'decoder del encoder-decoder de 32B (supuesto: ≈ la mitad)', value: est('≈ 16B parámetros ≈ 32 GB en bf16'), note: 'estimación: ni el reparto encoder/decoder ni la precisión de inferencia de RT-2 son públicos' },
            { label: 'Un token de decode en una H100', expr: '32 GB ÷ 3.35 TB/s', value: est('≈ 10 ms'), note: 'cota por ancho de banda; el modelo real está repartido en varios TPU, que suman ancho de banda pero agregan comunicación' },
            { label: 'Decode de un paso', expr: '7 × 10 ms', value: est('≈ 70 ms'), note: 'más el prefill (ViT-22B + encoder), la red ida y vuelta, el overhead del servicio y el robot: el paper no da el desglose, solo el total de 1–3 Hz' },
            { label: 'Para 50 Hz con 8 tokens por paso', expr: '1 / (50 × 8)', value: est('≤ 2.5 ms por token'), note: '≈ 4× más rápido que la cota del decode, sin contar nada más: no hay forma con este diseño' },
          ], result: R`Con un modelo de decenas de miles de millones de parámetros, cada pasada secuencial cuesta milisegundos, y el diseño pide 8 por acción (el prefill + 7 decodes), además de la red. Las salidas: un modelo más chico (OpenVLA: ${qn('params.total')} parámetros, ≈ 6 Hz en una RTX 4090), menos tokens por acción (FAST comprime chunks con la DCT: ${FAST}), o decodificar muchas acciones en una pasada (chunks en paralelo: OpenVLA-OFT; flow matching: <a href="#pi0">π0</a>).` },
          { t: 'callout', kind: 'trap', title: '"El cuello de botella es la imagen"', html: R`<p>En un VLM de chat con una pregunta corta, el prefill de la imagen domina el <b>cómputo</b> (ver <a href="#llava.costo">LLaVA</a>). En un VLA a batch 1 el reloj lo suele dominar el <b>decode</b>: 7 pasadas secuenciales que leen los pesos del decoder, contra un solo prefill. Lo verás con números del calculador (en OpenVLA, ≈ ¾ del tiempo de un paso) en <a href="#openvla.inferencia">OpenVLA → inferencia</a>. Por eso la palanca más grande no es achicar la imagen sino emitir menos pasadas secuenciales por acción.</p>` },
          { t: 'p', html: R`<b>La ley en palabras:</b> ×2 parámetros → ≈ ×2 tiempo por token de decode (se leen el doble de bytes) → ≈ ÷2 en Hz. ×2 dimensiones de acción (un robot de dos brazos: 14) → ×2 tokens por paso → ≈ ÷2 en Hz. ×H acciones por paso (chunk de H, decodificado token por token) → ×H tokens → la frecuencia de inferencia cae H veces, aunque las acciones por segundo no cambian: por eso el chunking solo ayuda si las H acciones salen en paralelo.` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`No hay preentrenamiento nuevo: se parte de un VLM ya entrenado y se hace <b>co-fine-tuning</b>, fine-tuning con una mezcla de datos de robot y de los datos web originales del VLM en cada batch. La pérdida es la de siempre:` },
          { t: 'math', display: true, tex: R`\mathcal{L} = \mathbb{E}_{(x,y)\sim \mathcal{D}_\text{robot}}\big[-\log p_\theta(y\mid x)\big]\cdot w_\text{robot} \;+\; \mathbb{E}_{(x,y)\sim \mathcal{D}_\text{web}}\big[-\log p_\theta(y\mid x)\big]\cdot (1 - w_\text{robot})`, caption: 'Next-token prediction en los dos casos: y = los 8 tokens de acción (robot) o la respuesta / caption (web). w_robot es la proporción de ejemplos de robot en el batch: ≈ 0.5 en RT-2-PaLI-X y ≈ 0.66 en RT-2-PaLM-E (Apéndice B).' },
          { t: 'callout', kind: 'skip', html: R`<p><b>Sáltate esto</b> si vas corto: los hiperparámetros de la tabla (LR, batch, pasos). Lo que se pregunta: co-fine-tuning con ≈ 50 % de datos de robot y la ablación 52 % → 63 % de más abajo.</p>` },
          { t: 'table', caption: 'Receta (Apéndices B y E)', head: ['', 'RT-2-PaLI-X-55B', 'RT-2-PaLI-X-5B', 'RT-2-PaLM-E-12B'], rows: [
            ['Learning rate', '1e-3', '1e-3', '4e-4'],
            ['Batch', '2048', '2048', '512'],
            ['Pasos de co-fine-tuning', '80K', '270K', '1M'],
            ['Robot en la mezcla', '≈ 50 %', '≈ 50 %', '≈ 66 %'],
            ['Datos web', 'Mezcla de PaLI-X (sin Episodic WebLI); la mayor parte es WebLI: ≈ 10B pares en 109 idiomas, filtrados al 10 % mejor → ≈ 1B', 'Igual', 'Mezcla de PaLM-E'],
            ['Datos de robot', R`Los de RT-1: robot manipulador móvil, 13 robots, 17 meses, cocina de oficina; instrucciones de 7 habilidades (${RT1})`, 'Igual', 'Igual'],
          ], note: 'El resto de los hiperparámetros (schedules, regularización) son los de los papers de PaLI-X y PaLM-E (§4). El paper no publica la resolución de imagen usada en el robot.' },
          { t: 'h3', text: 'Por qué co-fine-tuning y no fine-tuning solo con robot' },
          { t: 'p', html: R`Si afinas un VLM solo con demostraciones de robot (≈ 130K episodios de unas pocas cocinas), el modelo olvida: sus conceptos web se sobrescriben con "lata, cajón, servilleta". Mezclar los datos originales en cada batch es replay: el modelo sigue resolviendo VQA mientras aprende a actuar, y conserva lo que necesita para entender "la fruta que combina con el resto". La ablación (Apéndice H, Tabla 8, promedio en escenarios nuevos):` },
          { t: 'table', head: ['Modelo', 'Entrenamiento', 'Promedio en escenarios nuevos'], rows: [
            ['RT-2-PaLI-X-5B', 'desde cero (sin pesos del VLM)', '9 %'],
            ['RT-2-PaLI-X-5B', 'fine-tuning solo con robot', '42 %'],
            ['RT-2-PaLI-X-5B', 'co-fine-tuning', '44 %'],
            ['RT-2-PaLI-X-55B', 'fine-tuning solo con robot', '52 %'],
            ['RT-2-PaLI-X-55B', 'co-fine-tuning', '63 %'],
          ], note: 'Lectura honesta: el preentrenamiento es lo que más pesa (9 % → 42 %); el co-fine-tuning suma poco en el 5B (+2) y bastante en el 55B (+11); el tamaño también ayuda (44 % → 63 %). La Tabla 6 da 62 % para el mismo 55B con co-fine-tuning (redondeos de la misma evaluación).' },
          { t: 'h3', text: 'Cómo se evaluó (y por qué los números son creíbles)' },
          { t: 'list', items: [
            R`≈ 6,000 trayectorias de evaluación en robots reales (§4), con pruebas A/B: los modelos se evalúan uno tras otro en las mismas condiciones.`,
            R`Tareas <b>vistas</b>: 200+ instrucciones de RT-1 (recoger, volcar, poner de pie, mover cerca, abrir/cerrar cajones, meter/sacar de cajones). Escenarios <b>nuevos</b>: 280+ tareas con objetos, fondos y entornos no vistos, en versiones fácil y difícil (§4.1).`,
            R`<b>Emergentes</b> (§4.2, Apéndice H, Tabla 7): entender símbolos ("move apple to 3"), razonar (matemática, colores, varios idiomas: "mueve la manzana al vaso verde") y reconocer personas. Promedio: RT-2-PaLI-X-55B 60 %, RT-2-PaLM-E-12B 40 %, RT-1 17 %, VC-1 11 %.`,
            R`Simulación abierta (Language-Table, §4.1): un RT-2 con PaLI de 3B saca 90 % contra 74 % de RT-1 y 77 % de LAVA, con acciones 2-D codificadas como dos enteros de −10 a +10.`,
          ] },
          { t: 'callout', kind: 'trap', title: '"Emergente" no significa "habilidades nuevas"', html: R`<p>El paper es explícito (§4.2 y §5): no espera ni encuentra movimientos nuevos. "Emergente" aquí es <b>semántico</b>: hacer con las habilidades de los datos (recoger, mover, poner) algo que pide un concepto que solo existe en la web (un número, un logo, una persona famosa). Si el robot nunca vio "limpiar con una esponja", RT-2 no lo aprende por haber visto fotos de esponjas.</p>` },
          { t: 'h3', text: 'Variante con chain-of-thought' },
          { t: 'p', html: R`Con unos cientos de pasos extra de fine-tuning sobre RT-2-PaLM-E, los datos se aumentan con un paso "Plan" en lenguaje antes de la acción: <i>"Instruction: I'm hungry. Plan: pick rxbar chocolate. Action: 1 128 124 136 121 158 111 255."</i> (§4.4). Solo hay resultados cualitativos. Costo: más tokens de decode por paso → más latencia, que es justo lo escaso.` },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Captura', html: R`<p>La cámara del robot toma una imagen; el cliente la manda por red, con la instrucción, al servicio de inferencia. El modelo de 55B no cabe en una GPU de escritorio ni en una a bordo: corre en un <b>servicio multi-TPU en la nube</b>, que además atiende a varios robots (§3.3).</p>` },
            { title: 'Prefill', html: R`<p>Imagen + "Q: what action should the robot take to …? A:" en una pasada. Compute-bound. El número de tokens de imagen no se publicó para el robot.</p>` },
            { title: 'Decode restringido', html: R`<p>8 tokens, uno por paso, con la máscara que solo deja tokens de acción válidos. Memory-bound: cada token lee los pesos.</p>` },
            { title: 'Des-tokenizar y ejecutar', html: R`<p>Bins → valores continuos → el controlador del robot aplica el delta de pose y la pinza. Si el token de terminar vale 1, el episodio termina.</p>` },
            { title: 'Repetir', html: R`<p>Nueva imagen, nueva inferencia completa. 1–3 Hz con el 55B; ≈ 5 Hz con el 5B (§3.3).</p>` },
          ] },
          { t: 'viz', kind: 'vla-latency', params: { hw: 'rtx4090' }, caption: 'RT-2 no tiene barra: con pesos cerrados no hay cota del calculador, solo lo que reporta el paper (1–3 Hz con 55B en TPUs en la nube). Las barras de OpenVLA y π0 son cotas de roofline con hardware citado (≈), junto a lo medido en sus papers.' },
          { t: 'h3', text: 'Qué domina la latencia (estimación: el paper no da el desglose)' },
          { t: 'list', items: [
            R`<b>Decode secuencial</b> de 7 tokens después del prefill, cada uno leyendo los pesos del decoder de un modelo de decenas de miles de millones de parámetros (la cuenta de <a href="#rt2.costo">costo</a>).`,
            R`<b>Red</b>: ida y vuelta al servicio en cada paso. Con 1–3 Hz pesa poco; a 50 Hz sería la mitad del presupuesto.`,
            R`<b>Prefill</b> de la imagen: una vez por paso, compute-bound; con un ViT-22B no es gratis, pero es una sola pasada en paralelo.`,
          ] },
          { t: 'callout', kind: 'senior', title: 'Lo que implica 1–3 Hz para el control', html: R`<p>Entre dos decisiones pasan 0.3–1 s. Funciona porque las tareas son <b>cuasi estáticas</b> (recoger y mover objetos sobre una mesa, sin contacto dinámico) y porque el controlador de bajo nivel sigue cerrando su propio lazo a alta frecuencia: la VLA da referencias de pose, no torques. Lo que no funciona: atrapar algo que se mueve, corregir un deslizamiento a tiempo, tareas de contacto rápido. Y un detalle que se olvida: la política se entrenó con demostraciones a la frecuencia del robot de datos; si la inferencia es más lenta que esa frecuencia, el robot se mueve distinto que en el entrenamiento (OpenVLA lo mide con su versión int8: más lenta → peor éxito, ver <a href="#openvla.inferencia">OpenVLA</a>).</p>` },
          { t: 'table', caption: 'Trucos para bajar la latencia de un VLA tipo RT-2', head: ['Truco', 'Qué hace', 'Dónde lo ves'], rows: [
            ['Modelo más chico', 'Menos bytes por token de decode', 'RT-2-PaLI-X-5B ≈ 5 Hz; OpenVLA 7B ≈ 6 Hz en una RTX 4090; MiniVLA ≈ 1B'],
            ['Cuantizar', 'int4 lee ¼ de los bytes de bf16 en el decode', R`<a href="#openvla.inferencia">OpenVLA</a>: int4 conserva el éxito; int8 (más lento por overhead) lo baja`],
            ['Menos tokens por acción', 'Comprimir la acción (o un chunk) en menos tokens', R`FAST: DCT + BPE sobre chunks (${FAST})`],
            ['Decodificar en paralelo', 'Todas las dimensiones (y varios pasos) en una sola pasada', 'OpenVLA-OFT (parallel decoding + chunks)'],
            ['Cabeza continua', 'Generar un chunk continuo con difusión o flow matching', R`<a href="#pi0">π0</a>: 50 acciones por inferencia`],
            ['Jerarquía', 'El VLM planifica lento; una política rápida ejecuta', 'Patrón común: VLM a ≈ 1 Hz + controlador o política chica a decenas de Hz'],
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
            R`<b>Sin habilidades motoras nuevas.</b> La web enseña qué es una cosa, no cómo moverse para manipularla. Las habilidades físicas quedan limitadas a la distribución de los datos de robot (§5, Apéndice G). Los autores proponen como dirección futura aprender de videos de personas.`,
            R`<b>Latencia y costo.</b> 55B de parámetros, 1–3 Hz, un servicio de TPU en la nube; inaplicable a control de alta frecuencia sin cuantización o destilación (§5).`,
            R`<b>Cerrado.</b> Pocos VLMs disponibles para construirlo, y el resultado no se puede ajustar a otro robot fuera de Google (§5; RT-2-X tampoco: OpenVLA no pudo afinarlo porque solo hay una API de inferencia, ${OVLA}, §5.2).`,
            R`<b>Una acción por inferencia, sin historia.</b> Cada paso decide con una sola imagen y sin memoria; no hay chunking ni suavizado temporal. Oclusiones o estados que solo se distinguen con el pasado ("¿ya abrí el cajón?") quedan ambiguos.`,
            R`<b>Discretización con límites fijos.</b> 256 bins uniformes entre el mínimo y el máximo: un valor atípico en los datos ensancha el rango y vuelve más gruesos todos los bins de esa dimensión. OpenVLA lo corrige con cuantiles 1 % / 99 %.`,
            R`<b>Válido ≠ seguro.</b> La restricción de la decodificación garantiza 8 enteros en rango, no una acción sin colisiones. La seguridad va en el controlador (límites de espacio de trabajo, de velocidad, paro de emergencia); las capas completas, en la <a href="#openvla.entrevista">entrevista de OpenVLA</a>.`,
            R`<b>Errores que se acumulan (covariate shift).</b> Behavior cloning entrena con los estados que visitó el demostrador; en el robot, un error chico lleva a un estado que nunca vio, ahí se equivoca más, y el error crece con el largo de la tarea (en el análisis clásico, cuadrático en el horizonte para BC contra lineal con DAgger: Ross, Gordon y Bagnell, AISTATS 2011). RT-2 no hace nada específico contra esto: confía en la diversidad de los datos de RT-1 y en el lazo cerrado con la cámara.`,
          ] },
          { t: 'table', caption: 'RT-1 vs RT-2 vs OpenVLA (filas = criterios)', head: ['Criterio', 'RT-1', 'RT-2', 'OpenVLA'], rows: [
            ['Modelo', 'Transformer de 35M desde cero', 'VLM de 5B / 12B / 55B, co-fine-tuning', R`VLM de 7B (Prismatic), fine-tuning solo con robot (${qn('params.total')} parámetros)`],
            ['Datos de robot', '≈ 130K episodios, un robot (Google)', 'Los mismos de RT-1', '970K episodios de Open X-Embodiment, muchos robots'],
            ['Acción', '256 bins por dimensión (brazo, base y modo)', '8 tokens: terminar + 6 de pose + pinza', '7 tokens (sin terminar), bins entre cuantiles 1–99 %'],
            ['Generalización semántica', 'Baja (32 % en escenarios nuevos)', 'Alta (62 %); conceptos web', 'Alta; mejor que RT-2-X salvo en lo semántico'],
            ['Frecuencia', '3 Hz en el robot', '1–3 Hz (55B) en la nube', '≈ 6 Hz en una RTX 4090'],
            ['Pesos', 'Código y datos abiertos', 'Cerrados', 'Abiertos (pesos, código, datos)'],
            ['Ajustar a tu robot', 'Reentrenar', 'No disponible', 'LoRA en una GPU'],
          ], note: R`Números: RT-2 Apéndice H, Tabla 6; ${RT1}; ${OVLA}, §3.5 y §5.1. "Mejor que RT-2-X": +16.5 puntos absolutos en 29 tareas (abstract de OpenVLA); RT-2-X gana en generalización semántica (Fig. 3 de OpenVLA).` },
          { t: 'callout', kind: 'connect', html: R`<p>La tabla grande de trade-offs de representación de acciones (tokens discretos autoregresivos vs chunks continuos en paralelo vs cabezas de difusión o flujo) está en <a href="#openvla.fallas">OpenVLA → fallas</a>, con los números de OpenVLA-OFT y π0.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Dónde lo ves'], rows: [
            [R`RT-1 (${RT1})`, 'El antecesor: transformer de 35M desde cero con 130K episodios; ya usaba 256 bins por dimensión.', R`<a href="#rt2.puente">Puente</a>`],
            ['RT-2-PaLM-E-12B', 'Mismo método con un VLM decoder-only; mejor en matemática y en las versiones difíciles de generalización, peor en las fáciles (§4.1–4.2).', 'Esta página'],
            [R`RT-2-X (${OXE})`, 'RT-2-PaLI-X-55B entrenado con datos de muchos robots (Open X-Embodiment, ≈ 350K trayectorias según OpenVLA); también cerrado.', R`<a href="#openvla.entrevista">OpenVLA</a>`],
            [R`OpenVLA (${OVLA})`, 'La réplica abierta: Prismatic-7B (DINOv2 + SigLIP + Llama 2), 970K episodios, bins entre cuantiles, 256 tokens de Llama pisados.', '<a href="#openvla">OpenVLA</a>'],
            [R`FAST (${FAST})`, 'Tokenizador de chunks de acción con la transformada discreta del coseno + BPE: muchos menos tokens que un bin por dimensión y paso.', R`<a href="#openvla.variantes">OpenVLA</a>`],
            ['π0 (Black et al., arXiv:2410.24164)', 'Cambia la salida: chunks de 50 acciones continuas con flow matching en vez de tokens.', '<a href="#pi0">π0</a>'],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`RT-2 es la pregunta de entrada a VLAs en cualquier entrevista de robot learning: qué es, cómo se escriben las acciones y por qué la web ayuda. Preguntas en inglés, respuestas en español; cada senior trae la frase para decirla tal cual. Lo que separa a un senior aquí es <b>no inventar</b>: el modelo es cerrado, y decir qué se sabe y qué no es parte de la respuesta.` },
          { t: 'followups', items: [
            { q: 'What is RT-2, and what makes it a vision-language-action model?',
              junior: 'Es un modelo de Google que controla robots con lenguaje.',
              senior: R`Un VLM preentrenado en la web (PaLI-X de 5B o 55B, o PaLM-E de 12B) afinado para que, además de responder preguntas, responda "¿qué acción debe tomar el robot para X?" con una acción escrita como texto: 8 enteros (terminar, Δx, Δy, Δz, Δroll, Δpitch, Δyaw, pinza), cada uno un bin de 0 a 255. Eso es un VLA: la misma red y el mismo LM head producen lenguaje o acciones. Se entrena con co-fine-tuning (datos de robot + los datos web originales) con la pérdida de next-token, que para la acción es behavior cloning. Corre en lazo cerrado, una inferencia por paso, a 1–3 Hz el de 55B. Resultado: en tareas vistas queda como RT-1 (91 % contra 92 %), pero en escenarios nuevos duplica (62 % contra 32 %, Tabla 6).`,
              say: 'RT-2 fine-tunes a web-scale vision-language model so that, given a camera image and an instruction, it answers with an action written as tokens: a terminate flag plus seven discretized dimensions of end-effector motion and gripper. Because it is co-fine-tuned with the original web data, the same model keeps its visual and semantic knowledge, which roughly doubles success on unseen objects and scenes compared with RT-1.',
              why: 'Se anota: VLM base, acción como texto con sus 8 partes, co-fine-tuning, lazo cerrado, frecuencia y el resultado con número.' },
            { q: 'How exactly are actions represented as tokens?',
              junior: 'Cada acción es una palabra del vocabulario.',
              senior: R`Cada dimensión continua (6 de pose del efector final + la pinza) se discretiza en <b>256 bins uniformes</b> entre límites fijos; el comando de terminar es discreto. Eso da 8 enteros por paso, escritos como texto separado por espacios. Qué token representa cada bin depende del tokenizador: PaLI-X tiene un token propio para cada entero hasta 1000, así que el bin b es el token "b"; PaLM-E no, así que se pisan sus 256 tokens menos frecuentes. Las acciones son <b>deltas</b> de la pose del efector (no posiciones absolutas ni ángulos de articulación) y el controlador del robot las ejecuta. Error de cuantización: con reconstrucción en el centro del bin, a lo sumo medio bin; con ±5 cm por eje, ≈ 0.2 mm por paso. Y un detalle para no caer: el ejemplo del paper tiene 7 números, pero son 8 (el ejemplo de chain-of-thought sí tiene 8).`,
              say: 'Each continuous dimension, six for the end-effector position and rotation deltas and one for the gripper, is discretized into two hundred fifty-six uniform bins, plus a discrete terminate flag, so one step is eight integers written as text. With PaLI-X, integers already have their own tokens; with PaLM-E, they overwrite the two hundred fifty-six least frequent tokens.',
              why: 'Trampa: decir 7 tokens (eso es OpenVLA) o "una palabra por acción". Se anota 256 bins por dimensión, el token de terminar, deltas del efector y el mapeo por tokenizador.', trap: true },
            { q: 'Why discretize actions at all? Why not regress continuous values with an MSE head?',
              junior: 'Porque el LLM solo puede generar texto.',
              senior: R`En RT-2 la razón decisiva es el <b>co-fine-tuning</b>: si la acción es "una respuesta más" en texto, el mismo LM head y la misma entropía cruzada sirven para VQA y para el robot en el mismo batch, sin una cabeza ni una pérdida nuevas; y el softmax sobre bins además puede representar varios modos, que una MSE promedia. El precio: medio bin de error y 8 pasadas secuenciales por acción (el prefill + 7 decodes). La respuesta completa (los costos con números, por qué no MSE y la cuenta del error con cuantiles) está en la <a href="#openvla.entrevista">entrevista de OpenVLA</a>; la comparación con flow matching, en la de <a href="#pi0.entrevista">π0</a>.`,
              say: 'In RT-2 the deciding reason is co-fine-tuning: if actions are just another text answer, the same head and cross-entropy loss train on web and robot data in one batch, and a softmax over bins can also hold several modes that a mean-squared-error head would average. The price is half a bin of error and eight sequential passes per action.',
              why: 'Trampa: "solo puede generar texto". Se anota el co-entrenamiento con el mismo head y la misma pérdida, la multimodalidad y el costo en pasadas.', trap: true },
            { q: 'Why co-fine-tune with web data instead of fine-tuning only on robot data?',
              junior: 'Para tener más datos.',
              senior: R`Para no olvidar. Los datos de robot son ≈ 130K episodios de unas pocas cocinas con un vocabulario chico de objetos; afinar solo con eso sobrescribe los conceptos web que justamente queremos transferir. Mezclar los datos originales del VLM en cada batch (≈ 50 % robot en PaLI-X, ≈ 66 % en PaLM-E) es replay: el modelo sigue respondiendo VQA mientras aprende a actuar. Ablación (Tabla 8, promedio en escenarios nuevos): 55B, fine-tuning solo con robot 52 % contra co-fine-tuning 63 %; 5B, 42 % contra 44 %; y desde cero, 9 %. Lectura senior: lo que más pesa es partir del VLM; el co-fine-tuning suma, más en el modelo grande. OpenVLA, sin co-training, pierde justamente en generalización semántica contra RT-2-X.`,
              say: 'Fine-tuning only on a small robot dataset overwrites the web concepts we want to transfer. Keeping the original vision-language data in every batch acts as replay. In the ablation it matters most for the large model, fifty-two versus sixty-three percent on unseen scenarios, while training from scratch gets nine percent, so pretraining is the biggest factor.',
              why: 'Se anota: olvido, replay, la proporción de la mezcla y la ablación leída con matiz.' },
            { q: 'RT-2 shows "emergent capabilities". What exactly emerges, and what does not?',
              junior: 'El robot aprende habilidades nuevas de internet.',
              senior: R`Emerge comprensión <b>semántica</b> aplicada a habilidades que ya tenía: entender símbolos ("move apple to 3"), razonar (sumas, colores, varios idiomas), reconocer personas, elegir "la bolsa que está por caerse". Se mide (Tabla 7): RT-2-PaLI-X-55B 60 % de promedio contra 17 % de RT-1. <b>No</b> emergen movimientos nuevos: el paper dice que las habilidades físicas siguen limitadas a la distribución de los datos de robot (§5). Si las demostraciones solo tienen recoger, mover y abrir, RT-2 recoge, mueve y abre cosas nuevas por razones nuevas, pero no aprende a limpiar ni a atornillar.`,
              say: 'What emerges is semantic: symbols, simple math, multilingual instructions and recognizing people, applied to skills already in the robot data, about sixty percent versus seventeen for RT-1. What does not emerge is new motor skills; the paper is explicit that physical skills stay within the robot data distribution.',
              why: 'Trampa clásica. Se anota semántico vs motor, el número y la cita a la limitación.', trap: true },
            { q: 'RT-2 runs at 1 to 3 Hz. Why, and is that a problem?',
              junior: 'Porque la red es lenta; con una GPU mejor se arregla.',
              senior: R`Por el tamaño y por la forma de decodificar: un prefill con un ViT-22B y un encoder grande, y después 7 pasos de decode secuenciales, cada uno leyendo los pesos del decoder (PaLI-X es encoder-decoder; el reparto exacto no es público). Cuenta de servilleta con un supuesto explícito (decoder ≈ 16B): ${est('≈ 32 GB en bf16 ÷ 3.35 TB/s ≈ 10 ms por token, ≈ 70 ms de decode por paso')}, más el prefill, la red ida y vuelta al servicio de TPU en la nube y el overhead; el paper solo da el total. ¿Es un problema? Para recoger y mover objetos cuasi estáticos, no tanto: el controlador del robot cierra su lazo a alta frecuencia y la VLA da referencias de pose. Para contacto rápido, objetos en movimiento o dos brazos a 50 Hz, sí. Además la política se entrenó con la dinámica de los datos; si la inferencia es más lenta, el robot se mueve distinto que en el entrenamiento. Salidas: modelo más chico o cuantizado, menos tokens por acción (FAST), decodificación en paralelo con chunks (OpenVLA-OFT) o una cabeza continua (π0).`,
              say: 'A fifty-five-billion-parameter model pays a large prefill plus seven sequential, memory-bound decode steps per action, plus the network round trip to a cloud TPU service, which lands at one to three hertz. For quasi-static pick-and-place that is acceptable because the low-level controller closes its own loop, but not for fast contact-rich or bimanual control; the fixes are smaller or quantized models, fewer tokens per action, parallel decoding of action chunks, or a continuous action head.',
              why: 'Trampa: "una GPU mejor". Se anota que el decode es memory-bound, la cuenta con número, cuándo importa y las cuatro salidas.', trap: true },
            { q: 'How do you guarantee the model outputs a valid action and not text?',
              junior: 'Le digo en el prompt que responda solo con números.',
              senior: R`Con decodificación restringida: cuando la tarea es de robot, en cada paso se enmascaran los logits para que solo queden los 256 tokens de acción válidos (y 0/1 para terminar); en VQA el modelo sigue libre (§3.2). Es la misma técnica que para JSON válido (ver <a href="#llm-inferencia.entrevista">inferencia de LLMs</a>). Garantiza la <b>forma</b>, no el contenido: una acción válida puede chocar. Por eso del lado del robot van límites de espacio de trabajo y de velocidad, filtros de saltos grandes entre pasos y un paro de emergencia; y en evaluación se registra la tasa de intervenciones, no solo el éxito.`,
              say: 'With constrained decoding: for robot prompts the sampler only sees the valid action tokens, so the output always parses. That guarantees form, not safety, so the controller still enforces workspace and velocity limits and an emergency stop.',
              why: 'Se anota la máscara sobre los logits, forma ≠ contenido y la seguridad del lado del controlador.' },
            { q: 'Why does RT-2 output end-effector deltas rather than joint angles or torques?',
              junior: 'Porque es más fácil.',
              senior: R`Porque es la representación de los datos de RT-1 y la que mejor se lleva con un VLM a pocos Hz: un delta cartesiano del efector es casi independiente de la cinemática del brazo (el IK y el control de posición del robot hacen el resto), está alineado con lo que se ve en la imagen ("acércate a la lata") y tolera una frecuencia baja, porque el controlador interpola. Torques o ángulos exigirían alta frecuencia y conocer la dinámica de ese robot; serían menos transferibles. El costo: la precisión final depende del controlador y de la calibración cámara-robot, y los deltas acumulan error (no hay una posición objetivo absoluta que corrija la deriva; la corrección viene del lazo con la imagen).`,
              say: 'Cartesian end-effector deltas are mostly independent of the arm\'s kinematics, align with what the camera sees, and tolerate a low decision rate because the low-level controller interpolates. Torques or joint targets would need high frequency and embodiment-specific dynamics.',
              why: 'Se anota el reparto VLA arriba / controlador abajo, la transferibilidad y la deriva de los deltas.' },
            { q: 'How was RT-2 evaluated, and why are its numbers credible?',
              junior: 'Con la tasa de éxito en un benchmark.',
              senior: R`≈ 6,000 trayectorias en robots reales, en pruebas A/B: todos los modelos en las mismas condiciones, uno tras otro. Separando tres cosas: tareas vistas (200+ instrucciones de RT-1), escenarios nuevos (objetos, fondos y entornos no vistos, en versiones fácil y difícil; 280+ tareas) y capacidades emergentes (símbolos, razonamiento, personas). Es creíble porque compara contra RT-1 con los <b>mismos</b> datos de robot (la diferencia viene del VLM), reporta los ejes por separado en vez de un promedio y tiene ablaciones (desde cero, solo robot, co-fine-tuning). Lo que no tiene: intervalos de confianza por categoría. Con 20 ensayos por condición, el error estándar de una tasa de 50 % es ${est('≈ 11 puntos')}: lee las diferencias chicas entre categorías con cuidado. Cómo evaluarías tu propio robot (cuántos ensayos hacen falta, intervalos y diseño pareado) está en la <a href="#pi0.entrevista">entrevista de π0</a>.`,
              say: 'RT-2 ran about six thousand real-robot trials in A/B fashion, all models under the same conditions, split into seen tasks, unseen objects, backgrounds and environments, and emergent reasoning tasks. It is credible because RT-1 is trained on the same robot data, the axes are reported separately and there are ablations, though small per-category differences are within noise.',
              why: 'Se anota A/B con condiciones fijas, los tres ejes, la comparación con los mismos datos y la lectura honesta del ruido.' },
            { q: 'RT-2 is closed. In an interview, what can you claim about its architecture and cost?',
              junior: 'Que tiene 55B parámetros y usa un transformer como GPT.',
              senior: R`Lo que está en el paper, y decir qué no está. Se sabe: los VLMs base (PaLI-X 5B y 55B, con un ViT-22B y un encoder-decoder de 32B en el grande; PaLM-E 12B), el formato de la acción, la mezcla y los hiperparámetros, y las frecuencias (1–3 Hz y ≈ 5 Hz). No se sabe: la resolución de imagen en el robot, el número de tokens visuales, la precisión de inferencia, la topología del servicio de TPU. Cualquier cuenta de latencia es una estimación que hay que marcar como tal (la de decode por ancho de banda, por ejemplo). Si piden números exactos de un VLA, el ejemplo abierto es OpenVLA: con el calculador del atlas sale ${qn('params.total')} parámetros y su desglose.`,
              say: 'I would separate what the paper states, the backbones, the action format, the data mixture, the hyperparameters and the control rates, from what is not public, like the image resolution on the robot or the serving setup, and label any latency number as a back-of-the-envelope estimate. For exact numbers I would switch to OpenVLA, which is fully open.',
              why: 'Señal senior: separar lo citado de lo estimado. Se anota qué no está publicado.', trap: true },
            { q: 'Behavior cloning has a famous failure mode. What is it, and how do VLAs mitigate it?',
              junior: 'Que necesita muchos datos.',
              senior: R`Errores que se acumulan por cambio de distribución (<b>covariate shift</b>): la política se entrena con los estados que visitó el demostrador; en el robot comete un error chico, llega a un estado que nunca vio, ahí se equivoca más, y el error crece con el horizonte. En el análisis clásico, el costo esperado de BC crece como T²·ε (T pasos, ε el error por paso en la distribución del demostrador), contra T·ε con DAgger, que recolecta etiquetas en los estados que visita la propia política (Ross, Gordon y Bagnell, AISTATS 2011). Mitigaciones en la práctica: (1) datos diversos que incluyen errores y correcciones (π0 lo dice explícito: el preentrenamiento con datos de calidad dispar enseña a recuperarse, ver <a href="#pi0.entrenamiento">π0</a>); (2) demos de recuperación grabadas a propósito, empezando desde un agarre fallido o un objeto corrido; (3) chunks de acciones: menos decisiones encadenadas, horizonte efectivo más corto (el argumento de ACT); (4) intervenciones humanas tipo DAgger: el operador corrige en el robot y esas correcciones vuelven al dataset; (5) lazo cerrado con la cámara a la mayor frecuencia posible. RT-2 no usa ninguna de forma específica: confía en la diversidad de los datos y en el lazo cerrado. Nombrarlo y dar dos mitigaciones concretas ya separa a un senior.`,
              say: 'Compounding errors from covariate shift: the policy is trained on the demonstrator\'s states, a small mistake takes it somewhere it never saw, and errors grow with the horizon, quadratically for behavior cloning versus linearly with DAgger, as Ross and colleagues showed. VLAs mitigate it with diverse data that includes mistakes and recoveries, deliberate recovery demos, action chunking that shortens the effective horizon, and human interventions fed back into the dataset.',
              why: 'Trampa: confundirlo con "faltan datos". Se anota el nombre, el mecanismo, el orden cuadrático contra lineal con la cita y al menos dos mitigaciones concretas.', trap: true },
            { q: 'What does the chain-of-thought variant of RT-2 do, and what does it cost?',
              junior: 'Hace que el robot piense mejor.',
              senior: R`Con unos cientos de pasos extra sobre RT-2-PaLM-E, los ejemplos llevan un "Plan" en lenguaje antes de la acción ("Plan: pick rxbar chocolate. Action: 1 128 …"). Así el modelo puede resolver instrucciones indirectas ("I'm hungry") escribiendo primero qué subtarea elige: une el planificador en lenguaje y la política en un solo modelo. Solo hay resultados cualitativos (§4.4). Costo: decenas de tokens más por paso de control en un modelo que ya está limitado por el decode; en la práctica se planifica una vez por subtarea, no en cada paso.`,
              say: 'It adds a short natural-language plan before the action tokens, so the same model can map an indirect instruction to a concrete subtask and then act. The results are qualitative, and the extra tokens add latency, so in practice you would plan once per subtask rather than every control step.',
              why: 'Se anota el formato, que es cualitativo y el costo en latencia.' },
          ] },
          { t: 'h3', text: 'Estima y depura (cuentas sin calculador)' },
          { t: 'qa', items: [
            { q: 'Un eje de Δx tiene límites ±5 cm y 256 bins. ¿Cuál es el error máximo de cuantización por paso, y cuánto se acumula en 50 pasos?',
              a: R`Bin = 100 mm / 256 ≈ 0.39 mm; con el centro del bin, error máximo ≈ 0.2 mm por paso. En 50 pasos, si los errores fueran independientes y uniformes (desviación ≈ 0.39/√12 ≈ 0.11 mm), la deriva típica sería ${est('≈ 0.11 × √50 ≈ 0.8 mm')}; si son sesgados (truncar en vez de redondear), el peor caso es lineal: ${est('50 × 0.39 ≈ 20 mm')}. En la práctica el lazo con la cámara corrige la deriva, pero el sesgo es real: reconstruye en el centro.` },
            { q: 'Pasas de un brazo (7 dimensiones + terminar) a dos brazos (14 + terminar) con el mismo modelo. ¿Qué pasa con la frecuencia?',
              a: R`Los tokens por paso pasan de 8 a 15: ${est('≈ ×2')} pasos de decode (de 7 a 14). Si el decode es la mayor parte del paso, la frecuencia cae casi a la mitad (el prefill de la imagen no cambia): con 1–3 Hz quedarías en ${est('≈ 0.5–1.5 Hz')} en el peor caso (todo el paso es decode: 7 → 14 pasadas, ÷2). Por eso los VLAs de dos brazos usan chunks decodificados en paralelo o cabezas continuas.` },
            { q: 'Quieres que tu VLA tipo RT-2 prediga un chunk de 10 acciones por inferencia, token por token. ¿Ganas frecuencia de control?',
              a: R`No en acciones por segundo: son 10 × 8 = 80 tokens secuenciales por inferencia, ${est('≈ 10×')} el tiempo de una, para 10 acciones. Ganas suavidad y menos llamadas al servidor, pero el tiempo de reacción empeora (cada inferencia tarda 10× más). El chunking solo acelera si las acciones salen en paralelo (OpenVLA-OFT) o con una cabeza continua (π0).` },
            { q: 'El modelo devuelve "0 255 255 255 0 0 0 255" en casi todos los pasos de una tarea nueva. ¿Qué miras?',
              a: 'Bins en los extremos = acciones saturadas: o la normalización de entrenamiento no coincide con la de inferencia (límites distintos, unidades cm vs m), o la imagen está fuera de distribución y el modelo colapsa a un borde. Revisa primero los límites y las unidades con una demostración grabada (re-tokenizarla debe dar los mismos bins), después el preproceso de la imagen.' },
            { q: 'Tu VLA corre a 2 Hz y los datos de entrenamiento se grabaron a 3 Hz con un controlador no bloqueante. ¿Qué esperas?',
              a: 'Que cada acción se aplique durante más tiempo que en los datos: con deltas por paso, el robot se pasa (overshoot) o se mueve a otra velocidad que la demostrada. OpenVLA vio exactamente esto con int8: más lento → peor éxito, aunque las predicciones fueran igual de buenas con control bloqueante (§5.4 y Apéndice D.4). Mide la frecuencia real en el robot y, si no la alcanzas, re-graba o re-muestrea los datos a esa frecuencia, o usa control bloqueante.' },
          ] },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las cuentas de presupuesto (sin calculador: RT-2 no tiene configuración); al final el ejercicio de código que más se pide sobre RT-2: discretizar una acción en 256 bins, escribirla como texto y volver, midiendo el error.` },
          { t: 'h3', text: 'Diagrama en blanco: el lazo de RT-2' },
          { t: 'blankdiagram', diagram: 'rt2-overview', slots: [
            { node: 'vlm', ask: 'label', hint: 'qué modelo hay dentro' },
            { node: 'action-tokens', ask: 'label', hint: 'qué escribe el modelo en cada paso' },
            { node: 'detokenize', ask: 'label', hint: 'de bins a valores continuos' },
            { node: 'robot', ask: 'label', hint: 'quién ejecuta el delta de pose' },
          ] },
          { t: 'h3', text: '¿Qué pasa si…? (cuentas a mano)' },
          { t: 'qa', items: [
            { q: '¿Qué pasa con el ancho del bin si duplicas el rango de Δx (de ±5 cm a ±10 cm) con 256 bins?',
              a: 'Se duplica: de ≈ 0.39 mm a ≈ 0.78 mm, y el error máximo de medio bin pasa de ≈ 0.2 a ≈ 0.4 mm. Por eso un valor atípico que ensancha los límites empeora toda la dimensión (OpenVLA usa cuantiles 1–99 %).' },
            { q: '¿Qué pasa con el error si pasas de 256 a 64 bins con el mismo rango?',
              a: 'El bin es 4× más ancho (100/64 ≈ 1.56 mm) y el error máximo, ≈ 0.78 mm. A cambio, cada bin aparece 4× más en los datos y el softmax tiene menos clases. Pruébalo en el visualizador de la sección 3.' },
            { q: '¿Qué pasa con los tokens por segundo si el 55B corre a 3 Hz y cambias al 5B a ≈ 5 Hz?',
              a: '8 × 3 = 24 → 8 × 5 = 40 tokens de acción por segundo (§3.3): ≈ ×1.7 con 11× menos parámetros. No escala lineal: a 5B pesan más el prefill, la red y el overhead fijo por paso.' },
            { q: '¿Qué pasa con el presupuesto por token si quieres 10 Hz con 8 tokens por paso?',
              a: R`1 / (10 × 8) = 12.5 ms por token, sin contar prefill ni red. Con lectura de pesos a 3.35 TB/s eso alcanza para ${est('≈ 42 GB')} de pesos: ${est('≈ 20B parámetros en bf16')} como techo teórico. Un 7B (OpenVLA) cabe; un 55B, no.` },
          ] },
          { t: 'h3', text: 'Escríbelo: discretizar en 256 bins, a texto y de vuelta' },
          { t: 'p', html: R`Sin mirar: (1) <code>discretize</code>: cada una de las 7 dimensiones a un entero 0–255 con bins uniformes entre límites fijos; (2) <code>to_text</code> y <code>parse</code>: el paso como 8 enteros separados por espacios (terminar primero) y su validación; (3) <code>undiscretize</code>: de vuelta al <b>centro</b> del bin. Después compara con la variante de ${RT1CODE}, que trunca y reconstruye en el borde izquierdo. Verificado en el venv del Atlas (NumPy 2.5) con 100,000 acciones uniformes: con centros, error máximo = 0.500 bins y medio = 0.25; con la variante de RT-1, error máximo = 1.0 bin y sesgo medio de −0.5 bins; ida y vuelta por texto exacta; <code>parse</code> rechaza un bin 300 (también con <code>python -O</code>). Con límites ±5 cm, el bin de Δx es 0.39 mm.` },
          { t: 'code', title: 'Solución de referencia (NumPy)', files: [
            { name: 'rt2_actions.py', lang: 'python', code: [
              'import numpy as np',
              '',
              'N = 256                                           # bins por dimensión continua',
              '',
              '',
              'def discretize(a, low, high, n=N):',
              '    # a: (7,) Δx Δy Δz Δroll Δpitch Δyaw pinza · low, high: (7,) límites fijos por dimensión',
              '    u = (np.clip(a, low, high) - low) / (high - low)          # (7,) en [0, 1]',
              '    return np.minimum((u * n).astype(int), n - 1)             # (7,) enteros 0..255: n intervalos iguales',
              '',
              '',
              'def undiscretize(b, low, high, n=N):',
              '    return low + (b + 0.5) / n * (high - low)                 # (7,) el CENTRO de cada bin',
              '',
              '',
              'def to_text(terminate, b):',
              '    return " ".join(str(int(v)) for v in [terminate, *b])     # "0 158 128 107 …": 8 enteros',
              '',
              '',
              'def parse(text):',
              '    v = [int(t) for t in text.split()]',
              '    if not (len(v) == 8 and v[0] in (0, 1) and all(0 <= x < N for x in v[1:])):',
              '        raise ValueError("acción inválida")                   # no assert: python -O lo borra',
              '    return v[0], np.array(v[1:])',
              '',
              '',
              '# Variante "como RT-1" (código abierto de robotics_transformer): trunca u·(n−1) y reconstruye en el borde izquierdo.',
              'def discretize_rt1(a, low, high, n=N):',
              '    u = (np.clip(a, low, high) - low) / (high - low)',
              '    return (u * (n - 1)).astype(int)',
              '',
              '',
              'def undiscretize_rt1(b, low, high, n=N):',
              '    return low + b / (n - 1) * (high - low)',
            ] },
            { name: 'check_errors.py', lang: 'python', code: [
              'import numpy as np',
              'from rt2_actions import N, discretize, undiscretize, to_text, parse, discretize_rt1, undiscretize_rt1',
              '',
              'low = np.array([-0.05, -0.05, -0.05, -0.25, -0.25, -0.25, 0.0])   # límites ilustrativos (m, rad, apertura)',
              'high = np.array([0.05, 0.05, 0.05, 0.25, 0.25, 0.25, 1.0])',
              'rng = np.random.default_rng(0)',
              'A = rng.uniform(low, high, size=(100000, 7))',
              '',
              'B = np.stack([discretize(a, low, high) for a in A])',
              'R = np.stack([undiscretize(b, low, high) for b in B])',
              'step = (high - low) / N',
              'print(np.abs((R - A) / step).max(0))            # 0.5 bins en cada dimensión',
              '',
              'Br = np.stack([discretize_rt1(a, low, high) for a in A])',
              'Rr = np.stack([undiscretize_rt1(b, low, high) for b in Br])',
              'stepr = (high - low) / (N - 1)',
              'print(np.abs((Rr - A) / stepr).max(0))          # 1.0 bin: hasta un bin entero',
              'print(((Rr - A) / stepr).mean(0))               # -0.5: sesgo sistemático hacia abajo',
              '',
              't = to_text(0, B[0])',
              'term, b = parse(t)',
              'print(t, len(t.split()), np.array_equal(b, B[0]))   # 8 enteros; ida y vuelta exacta',
              'try:',
              '    parse("0 300 128 128 128 128 128 128")',
              'except ValueError as e:',
              '    print("rechazada:", e)                          # rechazada: acción inválida',
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los tres bugs que este ejercicio atrapa', html: R`<p>(1) Truncar y reconstruir en el borde: error de hasta un bin y sesgo de −½ bin, que con deltas por paso se acumula como deriva. (2) Olvidar el <code>min(…, 255)</code>: el valor exactamente igual al límite superior cae en un bin 256 que no existe. (3) Confiar en el texto sin validarlo: sin decodificación restringida, el modelo puede escribir "300" o 7 números; <code>parse</code> tiene que rechazarlo (con una excepción, no con un <code>assert</code>, que <code>python -O</code> borra). En el robot, una acción que no parsea = mantener la posición, nunca repetir a ciegas "la última acción válida" (con deltas, eso sigue moviendo el brazo).</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con <a href="#openvla">OpenVLA</a>: la misma idea con números del calculador, tokens de Llama, cuantiles 1–99 % y el ejercicio de normalización por dataset. Después, <a href="#pi0">π0</a> (acciones continuas en chunks).</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'rt2-01', kind: 'concepto', q: 'RT-2 en una frase.', a: 'Un VLM preentrenado en la web (PaLI-X o PaLM-E) co-afinado con demostraciones de robot para que responda con una acción escrita como tokens; corre en lazo cerrado.' },
      { id: 'rt2-02', kind: 'concepto', q: '¿Qué es un VLA?', a: 'Vision-language-action model: un modelo de visión y lenguaje cuya salida (además de texto) son acciones de robot, con el mismo modelo y el mismo head.' },
      { id: 'rt2-03', kind: 'forma', q: 'RT-2: ¿cuántos tokens tiene una acción y qué es cada uno?', a: '8: terminar (0/1), Δx, Δy, Δz, Δroll, Δpitch, Δyaw (deltas de la pose del efector) y la pinza.' },
      { id: 'rt2-04', kind: 'conteo', q: 'RT-2: bins por dimensión continua.', a: '256, uniformes entre los límites de cada dimensión (como RT-1).' },
      { id: 'rt2-05', kind: 'concepto', q: 'RT-2: ¿qué token representa el bin b en PaLI-X y en PaLM-E?', a: 'PaLI-X: el token del entero b (tiene un token por entero hasta 1000). PaLM-E: uno de los 256 tokens menos frecuentes del vocabulario, sobrescrito.' },
      { id: 'rt2-06', kind: 'formula', q: 'Discretización uniforme de una dimensión en 256 bins.', a: R`\(b = \min(\lfloor (\mathrm{clip}(a,\ell,h)-\ell)/(h-\ell)\cdot 256\rfloor, 255)\); reconstrucción en el centro \(\hat a = \ell + (b+\tfrac12)(h-\ell)/256\).` },
      { id: 'rt2-07', kind: 'formula', q: 'Error máximo de cuantización con reconstrucción en el centro del bin.', a: R`Medio bin: \((h-\ell)/512\). Con ±5 cm, ≈ 0.2 mm.` },
      { id: 'rt2-08', kind: 'concepto', q: 'Formato del prompt de RT-2.', a: '"Q: what action should the robot take to [instrucción]? A:" (formato VQA de los VLMs base), con la imagen actual de la cámara.' },
      { id: 'rt2-09', kind: 'concepto', q: '¿Qué es co-fine-tuning?', a: 'Afinar con datos de robot y con los datos web originales del VLM en el mismo batch (replay), para no olvidar los conceptos web.' },
      { id: 'rt2-10', kind: 'conteo', q: 'Proporción de datos de robot en la mezcla de RT-2.', a: '≈ 50 % en RT-2-PaLI-X y ≈ 66 % en RT-2-PaLM-E (Apéndice B).' },
      { id: 'rt2-12', kind: 'conteo', q: 'Ablación de RT-2-PaLI-X-55B en escenarios nuevos: fine-tuning solo robot vs co-fine-tuning.', a: '52 % vs 63 % (Tabla 8). El 5B desde cero: 9 %.' },
      { id: 'rt2-13', kind: 'conteo', q: 'RT-2-PaLI-X-55B vs RT-1 en escenarios nuevos (promedio, Tabla 6).', a: '62 % vs 32 %, con los mismos datos de robot (en tareas vistas quedan casi iguales).' },
      { id: 'rt2-14', kind: 'conteo', q: 'RT-2-PaLI-X-55B vs RT-1 en capacidades emergentes (promedio, Tabla 7).', a: '60 % vs 17 %.' },
      { id: 'rt2-15', kind: 'conteo', q: 'Frecuencias de control de RT-2.', a: '55B: 1–3 Hz; 5B: ≈ 5 Hz; en un servicio multi-TPU en la nube (§3.3). RT-1: 3 Hz en el robot.' },
      { id: 'rt2-16', kind: 'conteo', q: 'Datos de robot de RT-1/RT-2.', a: '≈ 130K episodios, 700+ tareas, 13 robots, 17 meses, una cocina de oficina.' },
      { id: 'rt2-17', kind: 'concepto', q: 'La pérdida de RT-2 en el lenguaje de robótica.', a: 'Next-token prediction sobre los tokens de acción = behavior cloning (imitar la acción del demostrador).' },
      { id: 'rt2-18', kind: 'concepto', q: '¿Qué es el "output constraint" de RT-2?', a: 'En prompts de robot, el muestreo solo puede elegir tokens de acción válidos; en VQA, texto libre. Garantiza que la acción parsee, no que sea segura.' },
      { id: 'rt2-19', kind: 'trampa', q: '"Las capacidades emergentes de RT-2 incluyen habilidades motoras nuevas."', a: 'No: lo que emerge es semántico (símbolos, razonamiento, personas) aplicado a habilidades ya vistas. Las habilidades físicas quedan en la distribución de los datos de robot (§5).' },
      { id: 'rt2-20', kind: 'trampa', q: '"Una acción de RT-2 son 7 tokens."', a: 'Son 8 (terminar + 6 de pose + pinza). El ejemplo de §3.2 muestra 7 números por error; OpenVLA sí usa 7 (no tiene terminar).' },
      { id: 'rt2-21', kind: 'trampa', q: '"RT-2 va a 1–3 Hz porque el prefill de la imagen es caro."', a: 'No solo: es el tamaño en todo el camino (ViT-22B, encoder, decoder), 7 pasos de decode secuenciales memory-bound a batch 1 y la red hasta la nube. El paper no da el desglose.' },
      { id: 'rt2-24', kind: 'concepto', q: '¿Por qué RT-2 predice deltas de la pose del efector y no torques?', a: 'Son casi independientes de la cinemática del brazo, se alinean con la imagen y toleran pocos Hz: el controlador de bajo nivel interpola y cierra su lazo.' },
      { id: 'rt2-25', kind: 'tradeoff', q: 'RT-1 vs RT-2.', a: 'RT-1: 35M desde cero, 3 Hz a bordo, poca generalización semántica. RT-2: VLM de 5–55B co-afinado, 1–3 Hz en la nube, ≈ 2× en escenarios nuevos. Mismos datos y discretización.' },
      { id: 'rt2-26', kind: 'tradeoff', q: 'RT-2 vs OpenVLA.', a: 'RT-2: cerrado, 55B, co-fine-tuning, mejor en lo semántico. OpenVLA: abierto, 7B, 970K episodios de muchos robots, solo robot en el fine-tuning, ≈ 6 Hz en una RTX 4090, ajustable con LoRA.' },
      { id: 'rt2-27', kind: 'concepto', q: 'Truncar vs centro del bin al des-tokenizar.', a: 'Truncar (tokenizador abierto de RT-1) reconstruye en el borde izquierdo: error de hasta 1 bin y sesgo de −½ bin. El centro: error de ½ bin y sin sesgo.' },
      { id: 'rt2-28', kind: 'concepto', q: 'Chain-of-thought en RT-2.', a: 'Un "Plan" en lenguaje antes de los tokens de acción (unos cientos de pasos extra sobre RT-2-PaLM-E); resultados cualitativos; cuesta tokens de decode.' },
      { id: 'rt2-30', kind: 'concepto', q: '¿Cuál es la falla típica de behavior cloning?', a: 'Errores que se acumulan por covariate shift: un error chico lleva a estados que el demostrador nunca visitó, y ahí la política se equivoca más.' },
      { id: 'rt2-31', kind: 'formula', q: 'Behavior cloning vs DAgger: cómo crece el error con el horizonte T (Ross et al., 2011).', a: R`BC: \(O(T^2\varepsilon)\). DAgger: \(O(T\varepsilon)\), porque etiqueta los estados que visita la propia política.` },
      { id: 'rt2-32', kind: 'concepto', q: 'Dos mitigaciones prácticas del covariate shift en VLAs.', a: 'Demos de recuperación (empezar desde un error) e intervenciones humanas tipo DAgger que vuelven al dataset. También: chunks de acciones y datos diversos con errores.' },
      { id: 'rt2-29', kind: 'concepto', q: '¿Qué no es público de RT-2?', a: 'Los pesos, el código, la resolución y los tokens de imagen en el robot, la precisión de inferencia y la topología del servicio. Público: formato de acción, receta, tamaños, frecuencias y evaluaciones.' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'vision-language-action model (VLA)', es: 'modelo de visión, lenguaje y acción', def: 'Un VLM cuya salida incluye acciones de robot (como tokens o con una cabeza continua), entrenado con demostraciones.', say: 'RT-2 is a VLA: the same vision-language model outputs robot actions as tokens.' },
      { en: 'co-fine-tuning', es: 'co-ajuste fino', def: 'Afinar un modelo preentrenado con una mezcla de los datos nuevos (robot) y los originales (web) en cada batch, para no olvidar.', say: 'Co-fine-tuning with web data keeps the semantic knowledge while learning to act.' },
      { en: 'action tokenization', es: 'tokenización de acciones', def: 'Convertir una acción continua en tokens discretos (p. ej., 256 bins por dimensión) para que un modelo de lenguaje la prediga con su head y su pérdida.', say: 'RT-2 tokenizes each action dimension into two hundred fifty-six bins.' },
      { en: 'behavior cloning', es: 'clonación de comportamiento', def: 'Aprendizaje por imitación supervisado: maximizar la probabilidad de la acción del demostrador dada la observación.', say: 'Next-token prediction on action tokens is behavior cloning.' },
      { en: 'end-effector delta', es: 'delta del efector final', def: 'Cambio de posición y orientación de la herramienta del robot en un paso, en coordenadas cartesianas; el controlador lo convierte en movimiento de articulaciones.', say: 'The policy outputs end-effector deltas and the low-level controller tracks them.' },
      { en: 'symbol tuning', es: 'ajuste de símbolos', def: 'Enseñarle a un modelo un significado nuevo para tokens existentes; RT-2 lo hace al reusar tokens como bins de acción.', say: 'Overwriting rare tokens with action bins is a form of symbol tuning.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
