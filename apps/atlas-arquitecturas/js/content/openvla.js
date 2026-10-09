/* =============================================================================
   Atlas de Arquitecturas — js/content/openvla.js
   Página de modelo: OpenVLA (Kim et al., CoRL 2024, arXiv:2406.09246), sobre Prismatic VLMs (Karamcheti et al.,
   ICML 2024, arXiv:2402.07865). Canónica openvla-7b. Plantilla fija de 11 secciones (SPEC §5.3, §21.2).
   Tesis de la fase (SPEC §21): un VLA = un VLM cuya salida son acciones; lo interesante es cómo se representan
   (tokens discretos vs chunks continuos), cómo se decodifican (autoregresivo vs flow matching) y cuánto cuesta en Hz.
   Esta página es la de los tokens discretos con números del calculador; la receta del VLM vive en llava.js, el
   decode y el roofline en llm-inferencia.js, y las acciones continuas con flow matching en pi0.js (solo se enlazan).
   Regla: ningún número de la arquitectura se escribe a mano: formas, parámetros, MACs, bytes y Hz de roofline salen del
   calculador (bloques op/trace/params/flops/scaling/compare y cantidades {{config.ruta}}, SPEC §6.6). Datos,
   hiperparámetros y resultados citan sección o tabla del paper o el archivo del repo oficial; estimaciones con est().
   Sin DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const R = String.raw;
  const est = (s) => '<span class="est">' + s + '</span>';

  const C = 'openvla-7b';
  const LL = 'llava15-7b';
  const PI = 'pi0';
  const L2 = 'llama2-7b';

  // Claves de metrics() del calculador (js/arch/vla.js, SPEC §21.2). Un solo lugar para adaptarlas.
  const MK = {
    vis: 'visualTokens', act: 'actionTokensPerStep', prompt: 'promptTokens',
    pDino: 'dinoParams', pSig: 'siglipParams', pVis: 'visionParams', pProj: 'projectorParams', pLlm: 'llmParams',
    mVis: 'visionMacs', mProj: 'projectorMacs', prefill: 'prefillMacs', decTok: 'decodeMacsPerToken', perAct: 'macsPerAction',
    wBytes: 'weightBytes', kvTok: 'kvBytesPerToken',
    hz4090: 'hzRtx4090', hzH100: 'hzH100', hzOrin: 'hzOrin',
    ms4090: 'actionMsRtx4090', dec4090: 'decodeMsRtx4090', pre4090: 'prefillMsRtx4090', vis4090: 'visionMsRtx4090',
    ds: 'decodeSteps', preShare: 'prefillShare',
  };
  // Ids de tensores del calculador (js/arch/vla.js).
  const T = {
    pixels: 'pixels', dino: 'd-feats', sig: 's-feats', fused: 'vis-feats', vis: 'vis-tokens',
    textIds: 'text-ids', textEmb: 'text-emb', prompt: 'prompt', hid: 'x-norm', logits: 'logits', next: 'next-token', actIds: 'action-tokens', action: 'action',
  };
  const qn = (path, cfg) => '{{' + (cfg || C) + '.' + path + '}}';
  const met = (k, cfg) => qn('metrics.' + (MK[k] || k), cfg);
  const cf = (k, cfg) => qn('cfg.' + k, cfg);
  const sh = (id, cfg) => qn('tensor.' + (T[id] || id) + '.shape', cfg);
  const sy = (id, cfg) => qn('tensor.' + (T[id] || id) + '.sym', cfg);
  const np = (id, cfg) => qn('node.' + id + '.params', cfg);
  const NV = () => met('vis');                 // tokens visuales (256)
  const NA = () => met('act');                 // tokens de acción por paso (7)
  const DS = () => met('ds');                  // pasos de decode por acción (6: el 1.er token sale del prefill)

  const P = 'Kim et al., <i>OpenVLA: An Open-Source Vision-Language-Action Model</i>, CoRL 2024, arXiv:2406.09246';
  const PRISM = 'Karamcheti et al., <i>Prismatic VLMs: Investigating the Design Space of Visually-Conditioned Language Models</i>, ICML 2024, arXiv:2402.07865';
  const OFT = 'Kim, Finn y Liang, <i>Fine-Tuning Vision-Language-Action Models: Optimizing Speed and Success</i> (OpenVLA-OFT), arXiv:2502.19645 (2025)';
  const RT2 = 'Brohan et al., <i>RT-2</i>, CoRL 2023, arXiv:2307.15818';
  const OXE = 'Open X-Embodiment Collaboration, ICRA 2024, arXiv:2310.08864';
  const OCTO = 'Octo Model Team, <i>Octo: An Open-Source Generalist Robot Policy</i>, RSS 2024, arXiv:2405.12213';
  const FAST = 'Pertsch et al., <i>FAST: Efficient Action Tokenization for Vision-Language-Action Models</i>, arXiv:2501.09747 (2025)';
  const MINI = 'Belkhale y Sadigh, <i>MiniVLA</i>, blog de Stanford AI Lab, diciembre de 2024';
  const DP = 'Chi et al., <i>Diffusion Policy</i>, RSS 2023, arXiv:2303.04137';
  const ACT = 'Zhao et al., <i>Learning Fine-Grained Bimanual Manipulation with Low-Cost Hardware</i> (ACT), RSS 2023, arXiv:2304.13705';
  const REPO = 'repo oficial openvla/openvla';
  const HW4090 = 'RTX 4090: ≈ 1,008 GB/s de GDDR6X y ≈ 165 TFLOPS bf16 densos con acumulación en FP32 (whitepaper de NVIDIA Ada)';

  ATLAS.register({
    id: 'openvla',
    kind: 'model',
    sections: [
      // ======================================================== 1
      {
        id: 'para-que',
        titleEn: 'What it is for',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>En una frase:</b> OpenVLA recibe una imagen de ${sh('pixels')} de una cámara fija y una instrucción ("put the eggplant into the pot"), la convierte en ${NV()} tokens visuales que un Llama 2 7B lee como palabras, y genera <b>${NA()} tokens de acción</b> uno tras otro: Δx, Δy, Δz, Δroll, Δpitch, Δyaw y la pinza, cada uno un bin de 256. Des-tokenizados y des-normalizados con las estadísticas del dataset, son la acción del próximo paso del robot. ≈ 6 Hz en una RTX 4090 en bf16 (${P}, §3.5).` },
          { t: 'p', html: R`Es la versión abierta de la idea de <a href="#rt2">RT-2</a> (pesos, código y datos públicos) y, por dentro, es <a href="#llava">LLaVA</a> con dos cambios: un encoder de visión doble (DINOv2 + SigLIP, concatenados por canal) y una salida de acciones. Se entrenó con 970K demostraciones de robots reales de Open X-Embodiment; con ${qn('params.total')} parámetros supera a RT-2-X (55B) por 16.5 puntos absolutos de éxito en 29 tareas (abstract). Es el baseline abierto de VLA que más se cita, y el que vas a ajustar si te piden "una VLA para nuestro robot".` },
          { t: 'table', caption: 'Cuándo sí y cuándo no', head: ['Situación', '¿OpenVLA?', 'Por qué'], rows: [
            ['Brazo con una cámara fija, tareas de manipulación con lenguaje, muchos objetos', 'Sí', 'Es su caso de entrenamiento (un brazo, una cámara de tercera persona, control del efector).'],
            ['Tu robot, con ≈ 100 demostraciones propias', 'Sí, con fine-tuning', R`El README dice que fuera de los dominios de entrenamiento casi siempre hace falta; LoRA en una GPU iguala al fine-tuning completo (Tabla 1).`],
            ['Varias tareas con distractores e instrucciones distintas', 'Sí', 'Gana a Diffusion Policy cuando hay varios objetos y lenguaje; pierde en tareas estrechas de una sola instrucción (§5.2).'],
            ['Control a 25–50 Hz, dos brazos, contacto fino', 'No tal cual', R`Una acción por inferencia a ≈ 6 Hz. Con el recipe OFT (chunks en paralelo + acciones continuas) sí: ${OFT}. O <a href="#pi0">π0</a>.`],
            ['Varias cámaras, muñeca, estado propioceptivo, historia', 'No tal cual', 'Solo una imagen, sin estado ni historia (§6); OFT agrega cámara de muñeca y estado.'],
            ['Una sola tarea fija con precisión de décimas de mm', 'No', 'Un pipeline clásico o una política chica dedicada es más precisa, rápida y verificable.'],
          ] },
          { t: 'callout', kind: 'interview', html: R`<p>"OpenVLA is Prismatic-7B fine-tuned for robot control: a fused DINOv2 plus SigLIP encoder at 224 pixels gives 256 patch tokens, a small MLP projects them into Llama 2 7B, and the model autoregressively predicts seven action tokens, one per dimension of the end-effector delta and the gripper. Each dimension is normalized with the dataset's 1st and 99th percentiles and discretized into 256 bins mapped to the 256 least-used Llama tokens. It was trained on 970 thousand Open X-Embodiment demonstrations and runs at about six hertz on a 4090."</p>` },
        ],
      },

      // ======================================================== 2
      {
        id: 'puente',
        titleEn: 'Bridge from what you know',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`<b>Es LLaVA con otra entrada y otra salida.</b> En <a href="#llava">LLaVA</a> viste encoder → projector → tokens visuales empalmados en el prompt → el decoder genera texto, con la pérdida solo sobre la respuesta. OpenVLA hace exactamente eso; la "respuesta" son ${NA()} tokens que significan bins de acción. Y de <a href="#rt2">RT-2</a> toma la representación de acciones, con dos arreglos: cuantiles en vez de mínimo–máximo y los últimos 256 ids de Llama como tokens de acción.` },
          { t: 'table', caption: 'LLaVA-1.5 → OpenVLA: qué se mantiene y qué cambia', head: ['Concepto', 'LLaVA-1.5-7B', 'OpenVLA-7B', '¿Nuevo?'], rows: [
            ['Encoder de imagen', R`CLIP ViT-L/14 @ 336 (${qn('metrics.visualTokens', LL)} tokens), congelado`, R`DINOv2 ViT-L/14 + SigLIP So400m/14 @ 224, features concatenadas por canal: ${sh('fused')}; <b>se entrena</b>`, '<b>Nuevo</b>'],
            ['Projector', 'MLP de 2 capas (GELU)', R`MLP sobre las features fusionadas (${np('projector')} parámetros); el paper dice "2-layer", el código tiene 3 lineales (ver <a href="#openvla.operaciones">operaciones</a>)`, 'Equivale'],
            ['LLM', 'Vicuna-7B v1.5 (Llama 2 ajustado para chat)', 'Llama 2 7B base (vía Prismatic-7B)', 'Igual'],
            ['Salida', 'Texto libre', R`${NA()} tokens de acción, uno por dimensión`, '<b>Nuevo</b>'],
            ['Vocabulario', 'El de Llama + &lt;image&gt;', 'Los últimos 256 ids de Llama (los menos usados) se reinterpretan como bins', '<b>Nuevo</b>'],
            ['Pérdida', 'Next-token solo sobre la respuesta', 'Next-token solo sobre los tokens de acción = behavior cloning', 'Igual'],
            ['Entrenamiento', 'Dos etapas, ≈ 1.2M ejemplos, 1 época', 'VLM ya entrenado + 970K episodios de robot, 27 épocas, todo el modelo', '<b>Cambia</b>'],
          ] },
          { t: 'h3', text: 'Por qué dos encoders: semántica + espacio' },
          { t: 'p', html: R`SigLIP aprendió con pares imagen-texto: sabe <b>qué</b> hay ("berenjena", "olla"), pero un objetivo contrastivo global no le exige saber con precisión <b>dónde</b>. DINOv2 aprendió solo con imágenes (auto-supervisado, con objetivos a nivel de parche): sus features conservan estructura espacial fina, bordes y partes, pero no están alineadas con lenguaje. Para manipular necesitas las dos cosas: entender la instrucción y ubicar la pinza a milímetros. Prismatic encontró que concatenar DINOv2 + SigLIP fue la mejor representación que probó, con ganancias sobre todo en localización (${PRISM}, §4.2); en OpenVLA, quitar DINOv2 baja ≈ 5 puntos en Bridge, mucho menos que quitar los datos de Open X (≈ 30 puntos) (${P}, Apéndices D.1–D.2).` },
          { t: 'table', caption: 'Lo que ya sabes de robótica, en el idioma de OpenVLA', head: ['Robótica clásica', 'OpenVLA'], rows: [
            ['Política \(\pi(a\mid o)\) aprendida por imitación', 'El VLA entero; la pérdida de next-token sobre los tokens de acción es behavior cloning'],
            ['Espacio de acción del efector (delta de pose + pinza)', R`Los ${NA()} números de cada paso; el controlador del robot hace IK y sigue la referencia`],
            ['Normalización de la acción por eje', 'Por dataset: [q01, q99] → [−1, 1]; las estadísticas viajan con el modelo (una entrada por dataset, se elige con unnorm_key)'],
            ['Frecuencia del controlador', 'Una inferencia por paso: los datos de entrenamiento se grabaron a ≈ 5–15 Hz; el README recomienda grabar a 5–10 Hz'],
            ['Percepción + planificación + control', 'Todo junto, de píxeles a delta de pose, sin modelo explícito del mundo'],
          ] },
          { t: 'callout', kind: 'connect', html: R`<p>Si te preguntan "¿por qué ajustar el encoder si en LLaVA se congela?": está en la <a href="#llava.entrevista">entrevista de LLaVA</a> y aquí abajo, con el número (80.0 % contra 46.7 %).</p>` },
        ],
      },

      // ======================================================== 3
      {
        id: 'diagrama',
        titleEn: 'Block diagram',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Arriba, la <b>imagen</b>: la misma foto pasa por dos ViT en paralelo (ábrelos), cada uno da ${NV()} tokens de parche; se concatenan por canal (${sh('fused')}) y el projector los lleva al ancho de Llama (${sh('vis')}). Abajo, la <b>instrucción</b>: "In: What action should the robot take to …?\nOut:" → tokens → embeddings. En <b>merge</b> se forma el prompt de ${sh('prompt')}. Después, el decoder de la <a href="#llm-decoder">página del LLM</a>, y la novedad al final: ${NA()} tokens de acción (el primero sale del prefill, los otros ${DS()} son pasos de decode), la tira de tokens y la des-tokenización. "Recorrido" sigue un paso de control completo.` },
          { t: 'archdiagram', diagram: 'openvla-overview', walk: 'forward', wide: true, caption: R`OpenVLA-7B: DINOv2 ViT-L/14 + SigLIP So400m/14 @ 224 → concat por canal → MLP → ${NV()} tokens visuales + instrucción → Llama 2 7B → ${NA()} tokens de acción (autoregresivo) → bins → des-normalizar con q01/q99 → acción. Formas del calculador.` },
          { t: 'p', html: R`<b>Acción → tokens → acción.</b> Cada dimensión se normaliza a [−1, 1] con los cuantiles 1 % y 99 % del dataset, cae en uno de los bins y se escribe como uno de los últimos 256 ids del vocabulario. Mueve los bins y compara cuantiles con mínimo–máximo: un solo valor atípico ensancha todos los bins.` },
          { t: 'viz', kind: 'action-tokenizer', params: { model: 'openvla', bins: 256, bounds: 'quantile' }, caption: 'Episodio sintético (rotulado). Lo real: 256 bins por dimensión, límites q01/q99, id = {{openvla-7b.Vtok}} − d (d = 1…256), reconstrucción en el centro del bin, error máximo de medio bin.' },
          { t: 'p', html: R`<b>Dónde se va el tiempo.</b> Un paso de control es un prefill (imagen + instrucción), que ya da el primer token de acción, y ${DS()} pasos de decode, cada uno leyendo los pesos completos. Compara con π0, que hace un prefill y 10 pasos de flujo para 50 acciones:` },
          { t: 'viz', kind: 'vla-latency', params: { hw: 'rtx4090' }, caption: 'Barras apiladas por modelo: visión, prefill y decode (OpenVLA) o pasos de flujo (π0), y Hz por hardware. Cotas de roofline del calculador con el hardware citado (≈): no son latencias medidas.' },
          { t: 'callout', kind: 'note', html: R`<p>Tres detalles del diagrama: (1) la imagen se <b>redimensiona</b> a 224 sin recortar (<code>resize-naive</code> en la config de HF) y cada ViT recibe su propia normalización (DINOv2 la de ImageNet, SigLIP la suya); (2) a diferencia de LLaVA, los dos ViT tienen marca de entrenamiento: OpenVLA los ajusta; (3) la caja del LLM corre ${NA()} veces por acción, una por token, reusando el KV cache del prompt.</p>` },
        ],
      },

      // ======================================================== 4
      {
        id: 'operaciones',
        titleEn: 'Operations per block',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero sin notación. Una foto de la cámara del WidowX y la instrucción "put the eggplant into the pot". La foto se aplasta a 224×224 (sin recortar) y se corta en 16 × 16 parches de 14 px. DINOv2 y SigLIP miran los mismos parches: uno devuelve ${cf('Dd')} números por parche, el otro ${cf('Ds')}; se pegan uno al lado del otro y quedan ${NV()} vectores de ${cf('Dv')}. El projector los lleva a ${cf('D')}, el ancho de las palabras de Llama. El prompt "In: What action should the robot take to put the eggplant into the pot?\nOut:" se tokeniza y va después de la imagen. Llama genera un token: 31,872 (bin 127 de Δx, "casi cero"); después otro, y otro, hasta ${NA()}. Con las estadísticas de Bridge, esos bins son Δx ≈ 0 mm, …, pinza abierta.` },
          { t: 'table', caption: 'Símbolos de esta página', head: ['Símbolo', 'Qué es', 'OpenVLA-7B'], rows: [
            ['N', 'tokens visuales (parches de una imagen, sin CLS ni registros)', NV()],
            [R`D<sub>d</sub>, D<sub>s</sub>`, 'ancho de DINOv2 ViT-L/14 y de SigLIP So400m/14', R`${cf('Dd')}, ${cf('Ds')}`],
            [R`D<sub>v</sub>`, 'ancho de las features fusionadas (D<sub>d</sub> + D<sub>s</sub>)', cf('Dv')],
            ['D', 'ancho del LLM', cf('D')],
            ['L', 'capas del LLM', cf('L')],
            ['T', 'tokens de texto del prompt, con &lt;BOS&gt; y el 29871 final (el prompt sin la imagen)', cf('T')],
            ['A', 'dimensiones de la acción = tokens de acción por paso', NA()],
            ['V', 'vocabulario del LLM (relleno a múltiplo de 64)', cf('V')],
          ] },

          { t: 'h3', text: 'Imagen → dos encoders → features fusionadas' },
          { t: 'op', block: 'dinov2', model: 'openvla', title: 'DINOv2 ViT-L/14 (con registros), entrenado',
            tex: R`\mathbf{Z}_d = \mathrm{ViT}^{\text{DINOv2}}_{L/14}\big(\mathbf{x}\big)_{\text{parches}} \in \mathbb{R}^{N\times D_d}`,
            in: [T.pixels], out: [T.dino], params: true, flops: true,
            what: R`La foto de ${sh('pixels')} → ${sh('dino')}: un token por parche de 14×14. Del ViT se usan los tokens de parche de la <b>penúltima</b> capa (sin CLS ni los tokens de registro), como en LLaVA: Prismatic fija <code>get_intermediate_layers</code> en la anteúltima.`,
            why: R`Aporta estructura espacial: DINOv2 se entrenó sin texto, con objetivos auto-supervisados que piden features locales consistentes (bordes, partes, correspondencias). Es lo que un controlador necesita para saber <b>dónde</b> está el asa de la olla.` },
          { t: 'op', block: 'siglip', model: 'openvla', title: 'SigLIP So400m/14 @ 224, entrenado',
            tex: R`\mathbf{Z}_s = \mathrm{ViT}^{\text{SigLIP}}_{\text{So400m}/14}\big(\mathbf{x}\big) \in \mathbb{R}^{N\times D_s}`,
            in: [T.pixels], out: [T.sig], params: true, flops: true,
            what: R`La misma imagen → ${sh('sig')}, también de la penúltima capa. SigLIP no tiene CLS: ya son tokens de parche.`,
            why: R`Aporta semántica alineada con lenguaje: SigLIP se entrenó con pares imagen-texto (pérdida sigmoide, ver <a href="#clip">CLIP</a>), así que "berenjena" en la instrucción y la berenjena en la imagen ya viven cerca. Es lo que hace que la política siga la instrucción correcta entre distractores.` },
          { t: 'op', block: 'concat', model: 'openvla', title: 'Fusión: concatenar por canal',
            tex: R`\mathbf{Z}_v = \big[\,\mathbf{Z}_d \;\Vert\; \mathbf{Z}_s\,\big] \in \mathbb{R}^{N\times (D_d + D_s)}`,
            in: [T.dino, T.sig], out: [T.fused],
            what: R`Parche a parche: ${sh('dino')} y ${sh('sig')} → ${sh('fused')}. Funciona porque los dos ViT usan parche 14 a 224 px: la grilla es la misma, el token i de uno y del otro miran el mismo cuadrado de la imagen.`,
            why: R`No agrega tokens (el LLM sigue viendo ${NV()}), solo ancho. Concatenar por canal en vez de por secuencia mantiene el prefill igual de largo: dos encoders sin pagar el doble de tokens en las ${cf('L')} capas del LLM.` },
          { t: 'callout', kind: 'trap', title: '"Dos encoders = el doble de tokens visuales"', html: R`<p>No: la fusión es por <b>canal</b>. El LLM recibe ${NV()} tokens, los mismos que con un solo encoder; lo que se duplica es el cómputo de visión (dos ViT) y el ancho de entrada del projector. Concatenar por secuencia (2 × ${NV()} tokens) sí duplicaría el prefill.</p>` },

          { t: 'h3', text: 'El projector' },
          { t: 'op', block: 'projector', model: 'openvla', title: 'Projector MLP (fused GELU MLP)',
            tex: R`\mathbf{H}_v = \mathrm{MLP}(\mathbf{Z}_v) \in \mathbb{R}^{N\times D}`,
            in: [T.fused], out: [T.vis], params: true, flops: true,
            what: R`Por token: ${sh('fused')} → ${sh('vis')}, ${np('projector')} parámetros. El paper lo llama "a small 2-layer MLP projector" (§3.1, citando a Prismatic); el código (<code>FusedMLPProjector</code> de Prismatic, <code>arch_specifier = "no-align+fused-gelu-mlp"</code>) tiene tres lineales con GELU: D<sub>v</sub> → 4·D<sub>v</sub> → D → D. Los conteos de esta página siguen el código.`,
            why: R`Igual que en LLaVA: traducir al espacio de embeddings de Llama. "no-align" significa que Prismatic se entrenó en una sola etapa, sin la etapa de alineación de solo-projector de LLaVA (Prismatic mostró que no hace falta).` },

          { t: 'h3', text: 'El prompt y el empalme' },
          { t: 'op', block: 'embed', model: 'openvla', title: 'Instrucción → embeddings',
            tex: R`\mathbf{x}_k = \mathbf{W}_\text{tok}[\,\text{id}_k\,],\qquad \mathbf{W}_\text{tok}\in\mathbb{R}^{V\times D}`,
            in: [T.textIds], out: [T.textEmb], params: true,
            what: R`"In: What action should the robot take to {instrucción}?\nOut:" (formato del README) → ${sh('textIds')} → ${sh('textEmb')}. La tabla tiene ${cf('V')} filas: las {{openvla-7b.Vtok}} de Llama más relleno hasta múltiplo de 64.`,
            why: R`El formato importa: el modelo se entrenó con ese template exacto. <code>predict_action</code> además agrega el token 29871 (un espacio vacío) después de "Out:" si no está, porque así lo vio en entrenamiento; olvidarlo con un generate propio da acciones peores sin ningún error.` },
          { t: 'op', block: 'merge', model: 'openvla', title: 'Empalme: imagen primero, después la instrucción',
            tex: R`\mathbf{X} = \big[\,\mathbf{x}_1\ ;\ \mathbf{H}_v\ ;\ \mathbf{x}_{2..T}\,\big] \in \mathbb{R}^{(N + T)\times D}\qquad(\mathbf{x}_1 = \langle\text{BOS}\rangle)`,
            in: [T.textEmb, T.vis], out: [T.prompt],
            what: R`Prismatic inserta los ${NV()} tokens visuales justo después de BOS y antes del texto: ${sh('prompt')}. Sin marcador &lt;image&gt;: la posición es fija.`,
            why: R`Con la imagen al principio, todo el texto atiende a la imagen con la máscara causal. Las posiciones de RoPE son 1D consecutivas, como en LLaVA.` },

          { t: 'h3', text: 'El LLM y los tokens de acción' },
          { t: 'op', block: 'llm', model: 'openvla', title: 'Llama 2 7B: L bloques decoder',
            tex: R`\mathbf{h}_\ell = \mathrm{Block}_\ell(\mathbf{h}_{\ell-1}),\quad \mathbf{h}_0 = \mathbf{X},\qquad \ell = 1..L`,
            in: [T.prompt], out: [T.hid], params: true, flops: true,
            what: R`El bloque de <a href="#llm-decoder.operaciones">Llama</a>, ${cf('L')} veces, MHA (${cf('h')} cabezas), D<sub>mlp</sub> = ${cf('Dmlp')}. El prefill procesa ${sh('prompt')} en una pasada y guarda el KV cache.`,
            why: R`Es todo el modelo en parámetros: ${met('pLlm')} de ${qn('params.total')}. Y es lo que fija la frecuencia: cada token de acción es un paso de decode que lee estos pesos completos.` },
          { t: 'op', block: 'lm-head', model: 'openvla', title: 'LM head: logits sobre todo el vocabulario',
            tex: R`\boldsymbol{\ell} = \mathrm{RMSNorm}(\mathbf{h}_L)\,W_\text{head} \in \mathbb{R}^{V}`,
            in: [T.hid], out: [T.logits], params: true, flops: true,
            what: R`La última fila → ${sh('logits')}. No hay una cabeza de acción nueva: es el LM head de Llama.`,
            why: R`Los 256 bins son filas del head que ya existían (las de los últimos ids). El fine-tuning les cambia el significado. En inferencia se usa greedy (<code>do_sample=False</code>) y <code>predict_action</code> toma los últimos ${NA()} ids generados sin restringir el vocabulario: un id fuera de los 256 cae, por el <code>clip</code> de la des-tokenización, en uno de los bins extremos: una acción saturada sin ningún error.` },
          { t: 'op', block: 'action-tokens', model: 'openvla', title: 'Decode autoregresivo: un token por dimensión',
            tex: R`y_k = \arg\max_{v}\ p_\theta\big(v \mid \mathbf{X},\ y_{\lt k}\big),\qquad k = 1..A,\qquad y_k \in \{V_0-256,\ \dots,\ V_0-1\},\ \ V_0 = 32{,}000`,
            in: [T.logits], out: [T.actIds],
            what: R`El primer token sale de los logits del prefill (${sh('next')}); los otros ${DS()}, de pasos de decode con KV cache → ${sh('actIds')}: ids entre {{openvla-7b.actionTokenFirst}} y {{openvla-7b.actionTokenLast}}. La dimensión k se predice condicionada a las anteriores (Δy sabe qué Δx eligió el modelo).`,
            why: R`El orden fijo (x, y, z, roll, pitch, yaw, pinza) da coherencia entre dimensiones; el precio es secuencial: el prefill y ${DS()} pasos de decode, cada uno una lectura completa de los pesos, por acción. OpenVLA-OFT reemplaza esto por una sola pasada bidireccional (ver <a href="#openvla.variantes">variantes</a>).` },
          { t: 'math', display: true, tex: R`d = V_0 - y,\qquad b = \mathrm{clip}(d-1,\ 0,\ 254),\qquad \tilde a = c_b = \tfrac{e_b + e_{b+1}}{2},\quad e_i = -1 + \tfrac{2i}{255},\ \ i = 0..255`, caption: 'Del id al valor normalizado, como en el código (ActionTokenizer / predict_action): los 256 bins se implementan con np.linspace(−1, 1, 256) como BORDES, o sea 255 intervalos y 255 centros c_b; el último índice se junta con el anterior. Paso 2/255, error máximo 1/255 en unidades normalizadas.' },
          { t: 'op', block: 'detokenize', model: 'openvla', title: 'Des-tokenizar y des-normalizar',
            tex: R`a_j = \begin{cases} \tfrac12(\tilde a_j + 1)\,\big(q^{99}_j - q^{01}_j\big) + q^{01}_j & \text{si } m_j\\ \tilde a_j & \text{si no (pinza)}\end{cases}`,
            in: [T.actIds], out: [T.action],
            what: R`Ids → bins → centros en [−1, 1] → unidades del robot con los cuantiles del dataset elegido (<code>unnorm_key</code>, p. ej. <code>"bridge_orig"</code>). La máscara m deja la pinza sin des-normalizar (en Bridge vale 0 o 1; el bin más alto reconstruye 0.996, no 1, y los scripts de evaluación la binarizan y, según el robot, invierten la convención).`,
            why: R`Los cuantiles 1 % y 99 % (en vez de mínimo–máximo como RT-1/RT-2) ignoran los atípicos: en Bridge el máximo de Δx es 0.417 m y el q99 es 0.028 m, así que con mínimo–máximo cada bin sería ≈ 14× más ancho. A cambio, lo que está fuera de [q01, q99] se recorta: el 2 % más extremo de los datos se aprende saturado.` },
          { t: 'callout', kind: 'trap', title: '"Son 256 bins con 256 valores"', html: R`<p>En el código son 256 <b>bordes</b> (<code>np.linspace(-1, 1, 256)</code>) y 255 centros: <code>np.digitize</code> devuelve 1…256 y el índice 256 (solo el valor exactamente 1.0) se junta con el 255. Se usan 256 ids de token, pero solo hay 255 valores distintos de reconstrucción. Paso normalizado 2/255 ≈ 0.0078 y error máximo 1/255 ≈ 0.0039. En Bridge, para Δx: (q99 − q01)/255 ≈ 0.22 mm de paso y ≈ 0.11 mm de error máximo por paso (verificado en la práctica con las estadísticas reales de la config).</p>` },

          { t: 'h3', text: 'La pérdida' },
          { t: 'math', display: true, tex: R`\mathcal{L}(\theta) = -\frac{1}{A}\sum_{k=1}^{A} \log p_\theta\big(y_k \mid \mathbf{x}_\text{img},\ \ell,\ y_{\lt k}\big)`, caption: 'Entropía cruzada solo sobre los A tokens de acción (labels = −100 en la imagen y en la instrucción, como la máscara de la respuesta en LLaVA). θ = todo: los dos ViT, el projector y el LLM.' },

          { t: 'h3', text: 'El recorrido completo con números' },
          { t: 'p', html: R`Cada fila es un tensor en orden forward: los dos ViT (su primera capa completa), la fusión, el projector, el prompt, el LLM (primera capa completa), el head y la acción. Toca una fila para resaltarla en el diagrama.` },
          { t: 'trace', model: 'openvla' },
        ],
      },

      // ======================================================== 5
      {
        id: 'costo',
        titleEn: 'Parameters and cost',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`OpenVLA-7B tiene ${qn('params.total')} parámetros: ${met('pDino')} en DINOv2, ${met('pSig')} en SigLIP (${met('pVis')} de visión entre los dos; el paper dice "600M": los checkpoints de timm que carga el modelo suman más, incluidos ${qn('metrics.idleParams')} de normas finales y del pooling de SigLIP que existen pero no se usan), ${met('pProj')} en el projector y ${met('pLlm')} en Llama 2 7B. El LLM es casi todo. El cómputo de un paso de control: prefill de ${met('prompt')} tokens = ${met('prefill')}, que ya da el primer token de acción, más ${DS()} pasos de decode de ${met('decTok')} cada uno: ${met('perAct')} por acción.` },
          { t: 'params', model: 'openvla', group: 'block' },
          { t: 'flops', model: 'openvla' },
          { t: 'callout', kind: 'trap', title: 'MACs no son tiempo', html: R`<p>En MACs, el prefill es ${met('preShare')} del paso: procesa ${met('prompt')} tokens, y cada token de decode, uno. En <b>tiempo</b> es al revés: a batch 1, el prefill es compute-bound y el decode memory-bound, y cada uno de los ${DS()} pasos de decode lee los pesos del LLM (${met('pLlm')} parámetros, ${est('≈ 13 GB')} en bf16). En una RTX 4090 la cota del calculador da ${est('≈ ' + met('pre4090') + ' ms')} de prefill del LLM y ${est('≈ ' + met('dec4090') + ' ms')} por paso de decode: ${est('≈ 80 ms')} de los ${est('≈ ' + met('ms4090') + ' ms')} del paso son decode. La palanca para ir más rápido está ahí.</p>` },
          { t: 'h3', text: 'Por qué ≈ 6 Hz (cuenta de roofline)' },
          { t: 'calc', title: 'Un paso de control en una RTX 4090, bf16, batch 1', rows: [
            { label: 'Pesos', expr: 'calculador, bf16', value: met('wBytes') },
            { label: 'Visión + projector', expr: '2 × MACs ÷ ≈ 165 TFLOPS', value: est('≈ ' + met('vis4090') + ' ms'), note: 'compute-bound' },
            { label: 'Prefill del LLM', expr: R`2 × MACs de ${met('prompt')} tokens ÷ ≈ 165 TFLOPS`, value: est('≈ ' + met('pre4090') + ' ms'), note: 'compute-bound; ya da el primer token de acción' },
            { label: 'Un paso de decode', expr: 'pesos (+ KV) ÷ ≈ 1,008 GB/s', value: est('≈ ' + met('dec4090') + ' ms'), note: 'memory-bound' },
            { label: R`${DS()} pasos de decode`, expr: R`${DS()} × un paso`, value: est('≈ 80 ms'), note: 'domina el paso' },
            { label: 'Paso completo (cota)', expr: 'visión + prefill + decode', value: est('≈ ' + met('ms4090') + ' ms → ≈ ' + met('hz4090') + ' Hz'), note: 'sin overheads de kernels, Python ni preproceso' },
            { label: 'Medido (paper)', expr: 'RTX 4090, bf16, sin compilar ni speculative decoding', value: '≈ 6 Hz', note: R`${P}, §3.5` },
          ], result: R`La cota y la medición están en el mismo orden: el paso lo domina leer los pesos en cada uno de los ${DS()} pasos de decode. Cuantizar a int4 (÷4 bytes), decodificar todas las dimensiones en una pasada (sin los ${DS()} pasos de decode) o emitir un chunk por pasada son las tres palancas. Hardware: ${HW4090}; otras GPUs en la barra de Hz de la sección 3.` },
          { t: 'h3', text: 'Cómo escala' },
          { t: 'scaling', model: 'openvla', knobs: [{ key: 'T', values: [8, 22, 64, 256] }], show: ['promptTokens', 'prefillMacs', 'macsPerAction', 'prefillShare', 'actionMsRtx4090', 'hzRtx4090'] },
          { t: 'p', html: R`El calculador mueve el largo de la instrucción (T): de ${cf('T')} a 256 tokens el prefill crece, pero la cota de Hz casi no se mueve, porque el decode manda. Los otros knobs (resolución, cámaras, dimensiones de la acción) no están en la config de OpenVLA; sus efectos, con la cuenta a mano, en la <a href="#openvla.practica">práctica</a>. <b>La ley en palabras:</b> ×2 lado de la imagen (224 → 448) → ×4 tokens visuales → ≈ ×4 prefill (el paper probó 384: sin mejora y 3× más tiempo de entrenamiento, §3.4). Una cámara más (muñeca) → +${NV()} tokens → ≈ ×2 prefill, el decode casi igual. ×2 dimensiones de acción (dos brazos: 14) → ×2 pasos de decode → ≈ ÷2 en Hz. Un chunk de H acciones decodificado token por token → ×H decode → ÷H en Hz de inferencia: por eso OFT decodifica en paralelo.` },
          { t: 'compare', models: [C, LL, PI], rows: ['params', 'tokens', 'macs', 'D', 'L'], caption: R`OpenVLA-7B vs LLaVA-1.5-7B (mismo LLM base, otro encoder y ${qn('metrics.visualTokens', LL)} tokens visuales a 336 px) vs π0 (PaliGemma 3B + action expert, 3 cámaras). "Tokens" es el prompt entero (en π0, el prefijo: 3 cámaras + texto). Ojo con los MACs: OpenVLA, por <b>una</b> acción; π0, por un chunk de 50. Ver <a href="#pi0">π0</a>.` },
          { t: 'callout', kind: 'senior', html: R`<p>Lo que un entrevistador anota: "most of the seven point something billion parameters are the Llama backbone; the two vision towers are about seven hundred million. Per control step, prefill is a few hundred tokens and compute-bound, but the six remaining decode steps each re-read fifteen gigabytes of bf16 weights, so on a 4090 the decode dominates and caps you near ten hertz in theory and six in practice."</p>` },
        ],
      },

      // ======================================================== 6
      {
        id: 'entrenamiento',
        titleEn: 'Training',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Se parte de <b>Prismatic-7B</b> (DINOv2 + SigLIP + Llama 2, entrenado en una sola etapa con la mezcla de LLaVA-1.5, ≈ 1M ejemplos) y se afina <b>todo</b> con demostraciones de robots, con la pérdida de next-token solo sobre los ${NA()} tokens de acción (sección 4). Sin co-entrenamiento con datos web (a diferencia de RT-2).` },
          { t: 'math', display: true, tex: R`\begin{gathered}\theta^\star = \arg\min_\theta\ \mathbb{E}_{(o,\ell,a)\sim\mathcal{D}}\Big[-\sum_{k=1}^{A}\log p_\theta\big(\mathrm{tok}(\bar a)_k\mid o,\ \ell,\ \mathrm{tok}(\bar a)_{\lt k}\big)\Big]\\[4pt] \bar a = \mathrm{clip}\Big(2\,\frac{a - q^{01}}{q^{99}-q^{01}} - 1,\ -1,\ 1\Big)\end{gathered}`, caption: 'Behavior cloning con la acción normalizada por dataset (cuantiles 1 % y 99 % de cada dimensión, salvo la pinza) y tokenizada. 𝒟 = la mezcla de Open X-Embodiment. Normalización: data_utils.py del repo (bounds_q99).' },
          { t: 'table', caption: 'Receta (§3.2–3.5)', head: ['', 'Valor', 'Nota'], rows: [
            ['Datos', '970K trayectorias de Open X-Embodiment', 'De más de 70 datasets y más de 2M trayectorias, se filtra a manipulación con al menos una cámara de tercera persona y control del efector de un solo brazo (§3.3)'],
            ['Pesos de la mezcla', 'Los de Octo, con algunos datasets agregados', 'Octo baja los datasets poco diversos y sube los diversos; DROID entró con 10 % y se quitó en el último tercio (su token accuracy no subía)'],
            ['Cómputo', '64 A100 × 14 días ≈ {{openvla-7b.paperA100Hours}} A100-horas', 'Batch 2048'],
            ['Learning rate', '2e-5 fijo, sin warmup', 'El mismo del preentrenamiento del VLM; el warmup no ayudó'],
            ['Épocas', '27', 'Siguieron hasta que la token accuracy de entrenamiento pasó 95 %: el rendimiento real seguía mejorando'],
            ['Resolución', '224 px', '384 px no mejoró y entrenaba 3× más lento'],
            ['Encoder de visión', 'Se entrena', '"Crucial": congelado, 46.7 % contra 80.0 % ajustado en tareas de Bridge (Apéndice D.3)'],
          ] },
          { t: 'table', caption: 'Los datasets con más peso en la mezcla (Apéndice A, Tabla 3)', head: ['Dataset', 'Peso', 'Qué es'], rows: [
            ['Bridge (BridgeData V2)', '13.3 %', 'WidowX en cocinas de juguete, muchas tareas'],
            ['Fractal', '12.7 %', 'Los datos de RT-1 (robot de Google)'],
            ['Kuka', '12.7 %', 'Agarre con un brazo Kuka'],
            ['DROID', '10.0 %', 'Franka en muchos entornos; se quitó en el último tercio y su peso se repartió'],
            ['BC-Z', '7.5 %', 'Robot de Google, tareas con lenguaje'],
            ['FMB', '7.1 %', 'Ensamblado con un Franka'],
            ['Otros 21 datasets', 'el resto', 'Cada uno entre &lt; 0.1 % y 4.4 %'],
          ] },
          { t: 'h3', text: 'Por qué el VLM base importa (y cuál probaron)' },
          { t: 'p', html: R`En experimentos chicos con Bridge (§3.4): LLaVA superó a IDEFICS-1 por 35 puntos en tareas de grounding con varios objetos, y Prismatic superó a LLaVA por ≈ 10 puntos en tareas simples y de grounding. La atribución del paper: la fusión SigLIP + DINOv2 da mejor razonamiento espacial. Y los datos de robot pesan más que la arquitectura: entrenar el mismo modelo solo con Bridge baja 30 puntos frente a la mezcla de Open X (Apéndice D.1).` },
          { t: 'callout', kind: 'trap', title: '"27 épocas es sobreajustar"', html: R`<p>En LLMs se entrena 1–2 épocas. Aquí siguió mejorando el éxito real con el robot hasta superar 95 % de token accuracy en entrenamiento (§3.4). Behavior cloning sobre un espacio de salida pequeño (256 bins × ${NA()}) con datos ruidosos se comporta distinto que modelar lenguaje; lo que manda es la evaluación con el robot, no la pérdida de validación.</p>` },
          { t: 'h3', text: 'Fine-tuning a tu robot: lo que dicen el paper y el README' },
          { t: 'table', caption: 'Estrategias de fine-tuning (§5.3, Tabla 1; Franka-Tabletop, 33 ensayos por estrategia)', head: ['Estrategia', 'Éxito', 'Parámetros entrenados', 'VRAM (batch 16)'], rows: [
            ['Fine-tuning completo', '69.7 ± 7.2 %', '7,188.1M', '163.3 GB (2 GPUs, FSDP)'],
            ['Solo la última capa (+ embeddings)', '30.3 ± 6.1 %', '465.1M', '51.4 GB'],
            ['Visión congelada', '47.0 ± 6.9 %', '6,760.4M', '156.2 GB (2 GPUs)'],
            ['Sandwich (visión + embeddings + última capa)', '62.1 ± 7.9 %', '914.2M', '64.0 GB'],
            ['LoRA, r = 32', '68.2 ± 7.5 %', '97.6M (1.4 %)', '59.7 GB'],
            ['LoRA, r = 64', '68.2 ± 7.8 %', '195.2M', '60.5 GB'],
          ], note: 'Ojo (nota al pie 4 del paper): las Tablas 1 y 2 usan una versión más chica de OpenVLA, solo con SigLIP y la mezcla de Octo; sus parámetros no son los de openvla-7b. LoRA va en todas las lineales del modelo, incluidos los ViT: por eso adapta la visión. Con LoRA, 10–15 h en una A100 por tarea, 8× menos cómputo que el completo (5–15 h en 8 A100).' },
          { t: 'list', items: [
            R`<b>Cuántos datos</b>: 10–150 demostraciones por tarea en los experimentos (§5.2); "≈ 100 demos" de tu dominio según el README.`,
            R`<b>A qué frecuencia</b>: grabar a 5–10 Hz; si tu controlador va a 50 Hz, sub-muestrear a 5 Hz y verificar que la tarea se resuelve así (README).`,
            R`<b>Sin pausas</b>: sin chunking, el modelo copia los pasos quietos y "se queda pegado"; en LIBERO, filtrar las acciones casi nulas fue crucial (Apéndice E).`,
            R`<b>Estrategia consistente</b>: acercarse siempre por el mismo lado; menos multimodalidad, problema más fácil (README).`,
            R`<b>Estadísticas nuevas</b>: el fine-tuning calcula q01/q99 de tu dataset y las guarda con el modelo; en inferencia, <code>unnorm_key</code> elige cuáles usar.`,
            R`<b>Hiperparámetros por defecto del script</b> (<code>vla-scripts/finetune.py</code>): LoRA r = 32, α = min(r, 16) = 16, dropout 0, todas las lineales, LR 5e-4, batch 16 (≈ 72 GB); con menos memoria, batch menor y acumulación de gradientes (mínimo ≈ 27 GB).`,
          ] },
        ],
      },

      // ======================================================== 7
      {
        id: 'inferencia',
        titleEn: 'Inference',
        priority: 'core',
        blocks: [
          { t: 'steps', items: [
            { title: 'Preproceso', html: R`<p>Imagen RGB → redimensionar a 224×224 sin recortar → dos normalizaciones (DINOv2 y SigLIP) → dos tensores ${sh('pixels')}. Si el checkpoint se ajustó con random crop (90 % del área en cada ejemplo), en inferencia va el center crop del 90 %: el README lo marca como "important" para los checkpoints de LIBERO.</p>` },
            { title: 'Visión + projector', html: R`<p>Dos ViT en paralelo y el MLP: ${met('mVis')} y ${met('mProj')}. Corre una vez por paso de control.</p>` },
            { title: 'Prefill', html: R`<p>${sh('prompt')} por las ${cf('L')} capas: ${met('prefill')}, compute-bound; escribe el KV cache.</p>` },
            { title: 'Decode de la acción', html: R`<p>El prefill ya dio el primer token; faltan ${DS()} pasos greedy, cada uno ${met('decTok')} y una lectura completa de los pesos del LLM (${est('≈ 13 GB')} en bf16; en total el modelo pesa ${met('wBytes')}): memory-bound. Aquí se va la mayor parte del tiempo.</p>` },
            { title: 'Des-tokenizar y enviar', html: R`<p>Ids → bins → [−1, 1] → unidades del robot con q01/q99 → el controlador del robot (no bloqueante en los experimentos, a 5 Hz en Bridge). El repo trae un servidor de inferencia remoto para que la GPU no tenga que estar en el robot.</p>` },
          ] },
          { t: 'h3', text: 'Cuantización: memoria, velocidad y éxito (§5.4, Tabla 2)' },
          { t: 'table', head: ['Precisión', 'Éxito en Bridge (8 tareas, 80 ensayos)', 'VRAM', 'Velocidad'], rows: [
            ['bf16', '71.3 ± 4.8 %', '16.8 GB', '≈ 6 Hz en RTX 4090 (§3.5)'],
            ['int8', '58.1 ± 5.1 %', '10.2 GB', 'Más lenta que bf16 en casi todas las GPUs: 1.2 Hz en la A5000 de la evaluación'],
            ['int4', '71.9 ± 4.7 %', '7.0 GB', 'Más rápida que int8; 3 Hz en la A5000'],
          ], note: 'Misma versión chica (solo SigLIP) que la Tabla 1. Con control bloqueante (cada acción se ejecuta completa antes de pedir la siguiente), las tres precisiones dan éxito comparable (Apéndice D.4, Tabla 11).' },
          { t: 'callout', kind: 'trap', title: '"int8 es peor que int4 porque pierde precisión"', html: R`<p>No es la precisión numérica: con control bloqueante, int8 rinde como bf16. Lo que pasa es que int8 (con los kernels de bitsandbytes) es <b>más lento</b> por el overhead de cuantizar y des-cuantizar, y a 1.2 Hz con un controlador no bloqueante entrenado a 5 Hz, la dinámica del robot cambia respecto de los datos. int4 lee ¼ de los bytes y compensa el overhead. Lección de sistemas: en un lazo de control, la latencia es parte de la distribución de entrada.</p>` },
          { t: 'h3', text: 'Cómo llegar de ≈ 6 Hz a 50 Hz' },
          { t: 'table', head: ['Palanca', 'Qué ataca', 'Cuánto (fuente)', 'Costo'], rows: [
            ['int4 weight-only', 'Bytes por paso de decode (÷4)', 'Mismo éxito que bf16 (Tabla 2); más rápido que int8', 'Kernels int4; medir calidad en tu tarea'],
            ['Compilar, CUDA graphs, runtime de LLM (TensorRT-LLM, vLLM)', 'Overhead por token de Python y kernels', 'El paper mide sin compilación ni speculative decoding (§3.5)', 'Ingeniería'],
            ['Speculative decoding', 'Pasos secuenciales', 'Propuesto en §6, no medido', 'Un draft; aceptación incierta con tokens de acción'],
            ['Decodificación en paralelo (OFT)', R`Las ${NA()} pasadas → 1, con atención bidireccional sobre "embeddings vacíos" de acción`, R`4.2 → 15.9 Hz en una A100 (Tabla II de ${OFT})`, 'Fine-tuning con el nuevo esquema'],
            ['Chunks en paralelo (OFT)', 'K acciones por pasada', 'K = 8: 108.8 Hz de throughput, 73 ms de latencia (A100); 26× el original', 'Ejecución en lazo abierto durante el chunk'],
            ['Menos tokens por acción', 'Comprimir chunks (DCT + BPE)', R`FAST (${FAST})`, 'Sigue siendo autoregresivo'],
            ['Modelo más chico', 'Bytes por token', R`MiniVLA ≈ 1B: 12.5 Hz vs 5 Hz de OpenVLA en una L40S (${MINI})`, 'Menos capacidad'],
            ['Cabeza continua de flujo', 'Chunk de 50 con 10 pasos de un experto chico', R`<a href="#pi0">π0</a>: ≈ 73 ms por chunk en una RTX 4090`, 'Otra arquitectura y entrenamiento'],
          ] },
          { t: 'callout', kind: 'senior', title: 'Throughput no es latencia', html: R`<p>Con chunks, "Hz" puede significar dos cosas. OFT con K = 8 entrega 108.8 acciones por segundo (throughput), pero cada inferencia tarda 73 ms y las 8 acciones se ejecutan en lazo abierto: el robot reacciona a algo nuevo recién en el próximo chunk. Con K = 25 a 25 Hz (ALOHA), un chunk dura 1 s. Para tareas reactivas importan la latencia y cada cuánto se re-planifica; para tareas lentas, el throughput. Di siempre cuál de los dos estás reportando.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Todo lo del decode memory-bound, el roofline y la cuantización está en <a href="#llm-inferencia">inferencia de LLMs</a>; el caso "LLM en el Jetson de un robot" tiene su propia pregunta en esa <a href="#llm-inferencia.entrevista">entrevista</a>. Aquí solo cambia que la salida son ${NA()} tokens por paso de control.</p>` },
        ],
      },

      // ======================================================== 8
      {
        id: 'fallas',
        titleEn: 'Failure modes and trade-offs',
        priority: 'core',
        blocks: [
          { t: 'list', ordered: true, items: [
            R`<b>Una sola imagen, sin estado ni historia</b> (§6). No ve la muñeca ni sabe su configuración articular; estados que solo se distinguen con el pasado ("¿ya agarré el objeto?") quedan ambiguos.`,
            R`<b>Baja frecuencia, una acción por inferencia</b>. ≈ 6 Hz y sin chunking ni suavizado: movimientos menos suaves y precisos que Diffusion Policy en tareas diestras (§5.2); inaplicable a ALOHA a 50 Hz sin cambios (§6).`,
            R`<b>Se queda pegado</b>. Sin chunking, copia los pasos quietos de las demostraciones y puede congelarse en un estado (README; filtrar acciones nulas fue crucial en LIBERO).`,
            R`<b>224 px y una cámara lejana</b>: objetos chicos y el contacto fino casi no se ven.`,
            R`<b>Cambio de distribución</b>. Fuera de los dominios de entrenamiento casi siempre hace falta fine-tuning (README). Y la confiabilidad aun dentro: típicamente menos de 90 % de éxito (§6).`,
            R`<b>Errores silenciosos de normalización</b>. <code>unnorm_key</code> equivocado → acciones con la escala de otro robot, sin ningún error; estadísticas de un dataset con otras unidades → lo mismo.`,
            R`<b>Promedia modos con L1, colapsa con poca diversidad</b>. Los tokens discretos sí pueden representar varios modos por dimensión, pero dimensión por dimensión; OFT con L1 aprende "la mediana" y lo marca como limitación (${OFT}, §VIII).`,
          ] },
          { t: 'p', html: R`La decisión de fondo de esta fase, en una tabla. Esta es la tabla de referencia del atlas para "cómo sale una acción de un VLA" (<a href="#rt2">RT-2</a> y <a href="#pi0">π0</a> enlazan aquí):` },
          { t: 'table', caption: 'Tokens discretos autoregresivos vs chunks continuos en paralelo vs cabezas de difusión / flujo (filas = criterios)', head: ['Criterio', 'Tokens discretos, autoregresivo (RT-2, OpenVLA)', 'Chunk continuo en paralelo, L1 (OpenVLA-OFT)', 'Difusión / flow matching sobre chunks (Diffusion Policy, π0)'], rows: [
            ['Qué predice', 'Un bin por dimensión, una acción por inferencia', 'K acciones × dimensiones en una pasada, valores continuos', 'Un chunk de H acciones continuas, refinado en varios pasos'],
            ['Cambios al VLM', 'Ninguno: el LM head y la entropía cruzada', 'Atención bidireccional, "embeddings vacíos" de acción, MLP de salida', 'Una red de acción (o un experto) y una pérdida de denoising/flujo'],
            ['Pasadas secuenciales por acción', R`${NA()} (una por token)`, '1 por chunk', 'Pasos de muestreo por chunk (π0: 10 de flujo; Diffusion Policy: 10 de DDIM, entrenada con 100)'],
            ['Precisión', 'Cuantizada: medio bin', 'Continua', 'Continua'],
            ['Multimodalidad', 'Sí, por dimensión (softmax); entre dimensiones, vía el orden autoregresivo', 'Débil: L1 tiende a la mediana', 'Sí, sobre el chunk completo'],
            ['Suavidad temporal', 'Ninguna (sin chunks)', 'Dentro del chunk', 'Dentro del chunk'],
            ['Velocidad reportada', '≈ 6 Hz (RTX 4090); 4.2 Hz (A100, Tabla II de OFT)', '108.8 Hz de throughput, 73 ms (A100, K = 8)', R`π0: ≈ 73 ms por chunk de 50 (RTX 4090); ver <a href="#pi0">π0</a>`],
            ['LIBERO (promedio, 4 suites)', '76.5 %', '95.3 % (una cámara); 97.1 % con muñeca + estado', 'π0: 94.2 % (citado en la Tabla I de OFT)'],
            ['Entrenamiento', 'Simple; el mismo stack de LLM', 'Simple; converge rápido', 'Más lento de entrenar; varios pasos en inferencia'],
          ], note: R`Fuentes: ${P}; ${OFT}, Tablas I–III; ${DP}. La fila de LIBERO mezcla protocolos que la Tabla I de OFT separa (entradas y datos filtrados): compárala dentro de cada grupo.` },
          { t: 'callout', kind: 'senior', html: R`<p>Cómo decidir en una entrevista: tokens discretos si quieres reusar un VLM sin tocarlo y co-entrenar con lenguaje, y la tarea tolera pocos Hz; chunk en paralelo con L1 si las demostraciones son consistentes (unimodales) y necesitas Hz altos con el VLM que ya tienes; difusión o flujo si las demostraciones tienen varios modos reales (dos formas de agarrar) y necesitas chunks largos y suaves. Y en los tres, la pregunta es la misma: cuántas pasadas secuenciales por segundo de robot te cuesta.</p>` },
        ],
      },

      // ======================================================== 9
      {
        id: 'variantes',
        titleEn: 'Variants and descendants',
        priority: 'extra',
        blocks: [
          { t: 'table', head: ['Modelo', 'Qué cambia (una línea)', 'Dónde lo ves'], rows: [
            [R`OpenVLA-OFT (${OFT})`, 'Receta de fine-tuning: decodificación en paralelo + chunks + acciones continuas con L1 (MLP de 4 capas) + cámara de muñeca y estado; LIBERO 76.5 % → 97.1 %, 26× más throughput.', R`<a href="#openvla.inferencia">Inferencia</a>`],
            ['OpenVLA-OFT+', 'OFT + FiLM: el promedio de los embeddings de la instrucción modula las features de los dos ViT; sin FiLM, seguir la instrucción en ALOHA cae a 33 % (azar). Supera a π0, RDT-1B, Diffusion Policy y ACT hasta en 15 puntos en ALOHA a 25 Hz.', R`<a href="#openvla.entrevista">Entrevista</a>`],
            [R`MiniVLA (${MINI})`, 'Qwen 2.5 0.5B en vez de Llama 2 7B (≈ 1B en total) y chunks de acción con cuantización vectorial; LIBERO-90 62 % → 82 %, 2.5× más rápido.', '—'],
            [R`FAST (${FAST})`, 'Tokenizador de chunks con la DCT + BPE: muchas menos fichas que un bin por dimensión y paso; con π0 (π0-FAST).', R`<a href="#pi0">π0</a>`],
            [R`Octo (${OCTO})`, 'Transformer de 27M / 93M desde cero con 800K episodios de 25 datasets y cabeza de difusión; los mismos pesos de mezcla que usa OpenVLA.', '—'],
            ['π0 (Black et al., arXiv:2410.24164)', 'PaliGemma 3B + un action expert que genera chunks de 50 acciones continuas con flow matching; varias cámaras y estado.', '<a href="#pi0">π0</a>'],
            [R`RT-2 / RT-2-X (${RT2}; ${OXE})`, 'El antecesor cerrado: 55B, co-fine-tuning con web; RT-2-X con datos de muchos robots (≈ 350K trayectorias).', '<a href="#rt2">RT-2</a>'],
            [R`Prismatic VLMs (${PRISM})`, 'El VLM base: DINOv2 + SigLIP fusionados, una sola etapa, resize sin recortar.', '<a href="#llava.variantes">LLaVA</a>'],
            [R`Diffusion Policy (${DP}) y ACT (${ACT})`, 'Políticas chicas desde cero con chunks (difusión o CVAE + L1); los baselines de fine-tuning.', R`<a href="#dit">DiT / flow matching</a>`],
          ] },
        ],
      },

      // ======================================================== 10
      {
        id: 'entrevista',
        titleEn: 'Interview questions',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`OpenVLA es el VLA abierto de referencia: si la entrevista es de robot learning, te van a pedir que lo expliques con formas, que justifiques las decisiones (dos encoders, 256 bins, tokens reusados) y, sobre todo, que digas cómo lo harías andar en tu robot y más rápido. Preguntas en inglés, respuestas en español, con la frase senior para decirla tal cual.` },
          { t: 'followups', items: [
            { q: 'Walk me through OpenVLA from pixels to a robot action, with shapes.',
              junior: 'La imagen entra a un LLM que devuelve la acción.',
              senior: R`Imagen redimensionada a 224 sin recortar: ${sh('pixels')}. Dos ViT con parche 14 sobre los mismos 16 × 16 parches: DINOv2 → ${sh('dino')}, SigLIP → ${sh('sig')}; concateno por canal: ${sh('fused')}. Projector MLP → ${sh('vis')}. Prompt: BOS + los ${NV()} tokens visuales + "In: What action should the robot take to …?\nOut:" → ${sh('prompt')}. Llama 2 7B (${cf('L')} capas, MHA) hace el prefill (que ya da el primer token) y luego ${DS()} pasos de decode greedy: ${NA()} ids entre {{openvla-7b.actionTokenFirst}} y {{openvla-7b.actionTokenLast}}, uno por dimensión (Δx, Δy, Δz, Δroll, Δpitch, Δyaw, pinza). Cada id → bin → centro en [−1, 1] → unidades del robot con los q01/q99 del dataset (<code>unnorm_key</code>). Total: ${qn('params.total')} parámetros, ≈ 6 Hz en una 4090.`,
              say: 'The image is resized to 224, encoded by DINOv2 and SigLIP on the same 16 by 16 patch grid, and the two feature sets are concatenated channel-wise into 256 tokens, projected into Llama 2. After the prompt prefill, the model greedily decodes seven tokens, one per action dimension, from the last 256 ids of the vocabulary; each id maps to a bin center in minus one to one, which is unnormalized with the dataset\'s first and ninety-ninth percentiles.',
              why: 'Es la pregunta de entrada. Se anota: dos encoders y fusión por canal, 256 tokens, prompt, 7 pasos de decode, ids, des-normalización por dataset.' },
            { q: 'Why fuse DINOv2 and SigLIP instead of using one encoder?',
              junior: 'Porque dos encoders son mejores que uno.',
              senior: R`Porque aportan cosas distintas. SigLIP (contrastivo con texto) da semántica alineada con lenguaje: qué objeto es el que pide la instrucción. DINOv2 (auto-supervisado, sin texto) da estructura espacial fina: dónde está, bordes, partes. Prismatic encontró que la fusión DINOv2 + SigLIP fue la mejor representación que probó, sobre todo en localización, y que DINOv2 + CLIP no ayudaba. En OpenVLA, quitar DINOv2 baja ≈ 5 puntos en Bridge (Apéndice D.2): ayuda, pero mucho menos que los datos (quitar Open X: −30). La fusión es por canal, así que el LLM sigue viendo ${NV()} tokens: el costo extra está en la visión (${met('pVis')} parámetros entre los dos), no en el prefill.`,
              say: 'SigLIP gives language-aligned semantics and DINOv2 gives fine spatial structure, which matters for manipulation. Prismatic found the fused pair was its best visual representation, especially for localization. In OpenVLA, dropping DINOv2 costs about five points, far less than dropping the diverse robot data. The fusion is channel-wise, so the LLM still sees two hundred fifty-six tokens.',
              why: 'Trampa: "más es mejor". Se anota semántica vs espacio, la evidencia de Prismatic, el −5 vs −30 y que la fusión no alarga el prompt.', trap: true },
            { q: 'Why discretize actions into 256 bins, and what is the quantization error?',
              junior: 'Porque el LLM solo genera tokens; el error es despreciable.',
              senior: R`Discretizar deja reusar todo el VLM: LM head, entropía cruzada, tokenizer, generate; y el softmax puede poner masa en varios bins (multimodal por dimensión), cosa que una MSE no hace. 256 viene de RT-1/RT-2. El error, con números: cada dimensión se normaliza con [q01, q99] → [−1, 1]; en el código los 256 bins son 256 <b>bordes</b> de <code>linspace(−1, 1, 256)</code>, o sea 255 intervalos: paso 2/255, error máximo 1/255 normalizado = (q99 − q01)/510 en unidades reales. En Bridge, Δx: ≈ 0.11 mm por paso; yaw: ≈ 0.8 mrad. Despreciable frente al ruido de las demostraciones. Lo que no es despreciable: lo que queda <b>fuera</b> de [q01, q99] se recorta, el 2 % más extremo de cada dimensión se aprende saturado; y con mínimo–máximo (RT-2) los bins de Δx en Bridge serían ≈ 14× más anchos por un solo atípico.`,
              say: 'Discretizing reuses the language head and loss and allows multimodal per-dimension distributions. Each dimension is normalized with the first and ninety-ninth percentiles, and the code uses two hundred fifty-six bin edges, so the maximum error is one over two hundred fifty-five in normalized units, about a tenth of a millimeter per step for Bridge. The real cost is clipping the tails, not the bin width.',
              why: 'Trampa: "despreciable" sin número, o no saber que son 255 intervalos. Se anota la cuenta, cuantiles vs min-max y el recorte de las colas.', trap: true },
            { q: 'Why overwrite the 256 least-used tokens instead of adding new action tokens?',
              junior: 'Para no cambiar el modelo.',
              senior: R`El tokenizer de Llama solo reserva 100 tokens especiales, menos que los 256 necesarios (§3.2). Agregar 256 filas nuevas a la tabla de embeddings y al LM head es posible, pero esas filas empiezan aleatorias, cambian el tamaño de los tensores y obligan a tocar el tokenizer. Los últimos 256 ids de un BPE como el de Llama son los que menos aparecen en texto: reinterpretarlos casi no daña nada que el modelo use (es "symbol tuning", como en RT-2 con PaLM-E). Riesgos: si tu instrucción tokeniza a alguno de esos ids, el modelo lo leería como acción; y como el embedding de entrada de esos ids también se entrena con los valores de acción, el modelo pierde esos tokens para texto. En la práctica: id = {{openvla-7b.Vtok}} − d, d ∈ 1…256 (la tabla real tiene ${cf('V')} filas por relleno a múltiplo de 64, que no se usan).`,
              say: 'Llama reserves only a hundred special tokens, and adding new rows means randomly initialized embeddings and head rows plus tokenizer changes. The last two hundred fifty-six BPE ids are the rarest in text, so repurposing them costs almost nothing, a form of symbol tuning. The ids are thirty-two thousand minus the bin index.',
              why: 'Se anota: 100 especiales, filas nuevas aleatorias, los menos usados, el riesgo y la fórmula del id.' },
            { q: 'OpenVLA runs at about 6 Hz. Why, and how would you get to 50 Hz?',
              junior: 'Con una GPU más rápida o batch más grande.',
              senior: R`Por el decode: cada paso de control es un prefill y ${DS()} pasos de decode a batch 1, y cada paso de decode lee los pesos del LLM (${est('≈ 13 GB')} en bf16); en una 4090 (≈ 1 TB/s) cada paso es ${est('≈ ' + met('dec4090') + ' ms')}, ${est('≈ 80 ms')} los ${DS()}, más un prefill compute-bound de ${est('≈ ' + met('pre4090') + ' ms')}: la cota da ${est('≈ ' + met('hz4090') + ' Hz')} y se miden ≈ 6. Batch más grande no sirve (es un robot, batch 1) y "una GPU más rápida" solo mueve el ancho de banda. 50 Hz = 20 ms por acción. Palancas, de menos a más invasiva: (1) int4 (÷4 bytes; mismo éxito en la Tabla 2) + compilación / CUDA graphs: ${est('del orden de 10–20 Hz')}; (2) <b>decodificar en paralelo</b> todas las dimensiones (OFT: 4.2 → 15.9 Hz en A100) y <b>emitir chunks</b> (K = 8: 108.8 acciones/s, 73 ms por chunk); (3) cabeza continua de flujo con un experto chico (π0: chunk de 50 en ≈ 73 ms en una 4090); (4) modelo más chico (MiniVLA ≈ 1B); (5) jerarquía: el VLA a pocos Hz da sub-objetivos y una política rápida o un controlador cierra el lazo a 50 Hz. Y medir en el robot: throughput (acciones/s) y latencia (cuándo reacciona) son distintos.`,
              say: 'Each control step is a prefill plus six batch-one decode steps, each reading all fifteen gigabytes of bf16 weights, so a 4090 is bandwidth-bound at roughly ten hertz in theory and six in practice. To reach fifty hertz I would quantize to four bits and compile, then switch to parallel decoding with action chunks as in OpenVLA-OFT, or a continuous flow-matching head like pi-zero, or a smaller backbone, or put a fast low-level policy under a slow VLA. And I would report throughput and latency separately.',
              why: 'La pregunta de sistemas. Trampa: batch o GPU. Se anota el decode memory-bound con número, el presupuesto de 20 ms, las palancas con números y throughput ≠ latencia.', trap: true },
            { q: 'You have 100 demonstrations of a new task on your robot. How do you fine-tune OpenVLA, and how do you evaluate it?',
              junior: 'Fine-tuning completo con las 100 demos y miro la pérdida.',
              senior: R`<b>Antes de entrenar</b>: (1) reproducir 2–3 demos grabadas en el robot (si la repetición abierta falla, el problema son los datos o el controlador); (2) grabar a 5–10 Hz o sub-muestrear, sin pausas, con estrategia consistente, cámara fija de tercera persona como en el entrenamiento, y variación de posiciones iniciales que cubra lo que voy a evaluar. <b>Formato</b>: RLDS con la acción como delta del efector + pinza en el mismo convenio que Bridge (o el que elija), y las q01/q99 de <b>mis</b> datos. <b>Qué entreno</b>: LoRA r = 32 en todas las lineales (incluye los dos ViT: la visión tiene que adaptarse; congelarla cae a 47 % en la Tabla 1), LR 5e-4, batch 16, augmentation de random crop y color; una A100 (≈ 10–15 h) o ≈ 27 GB con acumulación. Selecciono checkpoint por evaluación en el robot, no por la pérdida; la token accuracy y el L1 de acción en un set de validación separado por episodio sirven de sanity check. <b>Pipeline de inferencia</b>: con imágenes del dataset de fine-tuning, el modelo cargado en el pipeline del robot tiene que reproducir la token accuracy del entrenamiento (si no, hay un bug de preproceso o de unnorm_key). <b>Evaluación</b>: 20–30 ensayos por condición, A/B con condiciones iniciales registradas, separando posiciones vistas, nuevas y distractores; éxito, intervenciones y tiempo; comparo con Diffusion Policy desde cero como baseline (gana en tareas estrechas de una instrucción). Si necesito más Hz o suavidad, la receta OFT (chunks + L1) sobre el mismo checkpoint.`,
              say: 'First I replay a few demos open-loop to validate the data and controller, record at five to ten hertz without idle pauses, and compute normalization statistics from my data. I fine-tune with LoRA rank thirty-two on all linear layers, including the vision towers, which must adapt. I check that my inference pipeline reproduces the training token accuracy on dataset images, then evaluate on the robot with fixed initial conditions, separate generalization axes and enough trials, against a Diffusion Policy baseline.',
              why: 'La de proyecto. Se anota: validar datos y controlador, frecuencia y pausas, estadísticas propias, LoRA con la visión incluida, chequeo del pipeline, evaluación A/B y baseline.', trap: true },
            { q: 'LLaVA and Prismatic freeze the vision encoder. Why does OpenVLA fine-tune it?',
              junior: 'Para que aprenda más.',
              senior: R`Porque la tarea pide otra cosa. Para chat, congelar conserva lo aprendido en la web y Prismatic mostró que ajustarlo empeora. Para control, el encoder preentrenado no captura el detalle espacial fino de las partes que importan de la escena (dónde está el borde de la olla respecto de la pinza), y además la distribución de imágenes (cámaras de robot, cocinas de juguete) está lejos de la web. Evidencia: en tareas de Bridge, ajustado 80.0 % contra congelado 46.7 % (Apéndice D.3), y en fine-tuning, "visión congelada" cae a 47.0 % contra 69.7 % (Tabla 1). Con LoRA se adapta con pocos parámetros porque LoRA va también en los ViT.`,
              say: 'For chat, a frozen encoder preserves web features, but robot control needs fine spatial detail from robot-camera images that the pretrained features do not capture. OpenVLA measured eighty versus forty-seven percent, and LoRA adapts the vision towers too.',
              why: 'Se anota el contraste con LLaVA, la causa y los dos números.' },
            { q: 'Why did int8 quantization hurt success while int4 did not?',
              junior: 'Porque int8 pierde precisión y int4 está mejor calibrado.',
              senior: R`No fue precisión: con control bloqueante (cada acción se ejecuta completa antes de la siguiente) las tres precisiones rinden parecido (Apéndice D.4). int8 con esos kernels es más lento que bf16 por el overhead de cuantizar/des-cuantizar: en la A5000 de la evaluación, 1.2 Hz, contra un controlador no bloqueante y datos a 5 Hz. El robot entonces ejecuta cada acción durante más tiempo del que vio en los datos y la dinámica cambia. int4 lee ¼ de los bytes, compensa el overhead y corre a 3 Hz: 71.9 % contra 71.3 % de bf16 (Tabla 2), con 7.0 GB. Moraleja: en un lazo de control, la latencia es parte de la entrada; evalúa cuantización con el reloj real.`,
              say: 'It was speed, not precision: with blocking control all three precisions perform similarly. The int8 kernels were slower, running at about one hertz against a five-hertz non-blocking controller, which changed the closed-loop dynamics; int4 reads a quarter of the bytes and kept bf16-level success.',
              why: 'Trampa elegante. Se anota el control bloqueante como experimento que separa calidad de velocidad, y la lección de sistemas.', trap: true },
            { q: 'For a pick-and-place cell, would you use a VLA or a classical pipeline (perception, grasp planner, motion planner, controller)?',
              junior: 'Un VLA, porque es end-to-end y generaliza.',
              senior: R`Depende de tres cosas: variedad, ciclo y certificación. <b>Clásico</b> si las piezas son conocidas o tienen CAD, las posiciones están acotadas y el ciclo es de segundos: detección o pose 6-D (o un detector abierto como <a href="#grounding-dino">Grounding DINO</a> + <a href="#sam">SAM</a>), un planificador de agarre, MoveIt o equivalente, control de posición/fuerza. Ventajas: precisión sub-milimétrica con calibración, 100+ Hz, cada falla tiene un módulo culpable, se puede verificar y certificar, y no necesita demostraciones. <b>VLA</b> si la variedad es abierta (SKUs nuevos cada semana, desorden, instrucciones en lenguaje, objetos deformables) y programar cada caso cuesta más que grabar ≈ 100 demos por tarea; acepta ≈ 6 Hz (o OFT/π0 si no) y típicamente menos de 90 % de éxito sin ajuste. <b>Lo que haría</b> en la mayoría de las celdas reales: híbrido. Percepción abierta (detector o VLM) para decidir qué y dónde, planificador y controlador clásicos para ejecutar con garantías, y una política aprendida solo para el tramo que el clásico no resuelve (agarres difíciles, deformables). Métricas de la decisión: éxito en cientos de ciclos, tiempo de ciclo p95, intervenciones por hora, tiempo de puesta en marcha de una pieza nueva.`,
              say: 'A classical pipeline wins when parts are known and cycle times are tight: it is precise, fast, debuggable and certifiable, and needs no demonstrations. A VLA pays off when variety is open-ended and collecting a hundred demonstrations beats programming every case, accepting a few hertz and sub-ninety-percent success out of the box. In practice I would go hybrid: open-vocabulary perception to decide what and where, classical planning and control to execute safely, and a learned policy only for the hard segment.',
              why: 'Pregunta de criterio. Se anota decidir por variedad, ciclo y certificación, lo que gana cada uno, el híbrido y las métricas de la decisión.', trap: true },
            { q: 'How do actions get normalized, and what breaks if you pick the wrong unnorm_key?',
              junior: 'Se normalizan a [−1, 1] y ya.',
              senior: R`Por dataset y por dimensión: \(\bar a = \mathrm{clip}(2(a - q^{01})/(q^{99} - q^{01}) - 1, -1, 1)\), con máscara para la pinza (que queda tal cual) y ceros para dimensiones constantes. Cada dataset de la mezcla tiene sus estadísticas, y viajan en la config del modelo (25 entradas en openvla-7b). En inferencia, <code>predict_action(…, unnorm_key="bridge_orig")</code> elige cuáles usar para volver a unidades del robot. Con la clave equivocada no hay error: las acciones salen con la escala de otro robot (los deltas de Bridge son ±3 cm por paso; los de otro dataset pueden ser 10× mayores o estar en otras unidades) y el robot se mueve de más o de menos. Lo mismo si tu fine-tuning calcula estadísticas con unidades distintas a las del controlador. Chequeo: re-normalizar una demo grabada y des-normalizarla debe devolver la demo (salvo el recorte de las colas).`,
              say: 'Each dataset gets per-dimension first and ninety-ninth percentile statistics that map to minus one to one, with the gripper masked out. They ship with the model, and the unnorm key picks which statistics to invert at inference. A wrong key fails silently, producing actions at another robot\'s scale, so I round-trip a recorded demonstration as a check.',
              why: 'Se anota la fórmula, la máscara, que las estadísticas viajan con el modelo y que el error es silencioso.', trap: true },
            { q: 'How can a 7B open model beat RT-2-X (55B)?',
              junior: 'Porque Llama es mejor que PaLI-X.',
              senior: R`No es el LLM. El paper lo atribuye a tres cosas: (1) <b>más y más diversos datos de robot</b>: 970K trayectorias contra ≈ 350K de RT-2-X; (2) <b>limpieza</b>: por ejemplo, filtrar las acciones todo-cero de Bridge; (3) el <b>encoder fusionado</b> con features espaciales. La evidencia de que los datos pesan más que la arquitectura: quitar Open X baja 30 puntos y quitar DINOv2, 5. Y donde no gana: generalización semántica (conceptos de internet), porque RT-2-X es más grande, tiene más preentrenamiento web y se co-entrena con datos web, mientras OpenVLA solo ve robot en el fine-tuning (§5.1). +16.5 puntos de promedio en 29 tareas, pero no en todas las categorías.`,
              say: 'The paper attributes it to more and more diverse robot data, nine hundred seventy thousand versus three hundred fifty thousand trajectories, careful data cleaning, and the fused encoder. RT-2-X still wins on semantic generalization because of its larger web pretraining and co-training, which OpenVLA does not do.',
              why: 'Trampa: atribuirlo al LLM. Se anota datos > arquitectura con los números y dónde pierde.', trap: true },
            { q: 'Discrete action tokens, parallel continuous chunks with L1, or a diffusion / flow head: how do you choose?',
              junior: 'Difusión siempre, es el estado del arte.',
              senior: R`Por tres preguntas. (1) <b>¿Cuántas pasadas secuenciales puedo pagar?</b> Tokens autoregresivos: ${NA()} por acción. Chunk en paralelo: 1 por chunk. Difusión/flujo: pasos de muestreo por chunk (π0: 10). (2) <b>¿Mis demostraciones tienen varios modos?</b> L1 tiende a la mediana (OFT lo lista como limitación); difusión/flujo muestrea un modo del chunk completo; los tokens capturan modos por dimensión, coordinados por el orden autoregresivo. (3) <b>¿Quiero tocar el VLM?</b> Tokens: nada, y se puede co-entrenar con lenguaje. OFT: atención bidireccional, una cabeza MLP, entradas nuevas. Flujo: un experto de acción y otra pérdida. Evidencia en LIBERO (Tabla I de OFT): 76.5 % autoregresivo, 90.2 % con chunks en paralelo (aún discretos), 95.3 % con L1 y 95.4 % con difusión: L1 alcanza a la difusión con datos consistentes y entrena e infiere más rápido. Elegiría L1 con chunks para demos consistentes y Hz altos, flujo para demos multimodales y chunks largos y suaves, tokens si la prioridad es reusar el VLM tal cual.`,
              say: 'I ask how many sequential passes I can afford, whether my demonstrations are multimodal, and whether I can change the model. In the OFT study, parallel chunks alone took LIBERO from seventy-six to ninety percent, and L1 regression matched diffusion at about ninety-five while being faster, so for consistent demonstrations I would use parallel L1 chunks, for genuinely multimodal ones a flow head like pi-zero, and discrete tokens only when reusing the VLM unchanged matters most.',
              why: 'Se anota: pasadas secuenciales, multimodalidad, invasividad, los números de la ablación y una decisión.' },
            { q: 'OpenVLA takes a single third-person image with no robot state. Why is that a limitation, and how do you add more inputs?',
              junior: 'No es un problema, la imagen tiene todo.',
              senior: R`Sin estado, la política no sabe su configuración ni la apertura real de la pinza; sin cámara de muñeca, el contacto fino queda ocluido; sin historia, estados con la misma imagen pero distinta fase ("ya agarré" vs "voy a agarrar") son ambiguos. Cómo agregarlo (lo que hace OFT): cada cámara pasa por el mismo encoder fusionado y el projector compartido (+${NV()} tokens por vista: 512 con muñeca); el estado propioceptivo entra por un MLP de 2 capas como <b>un</b> token más; todo se concatena en la secuencia. Costo: el prefill crece con cada vista; con decode en paralelo eso se paga (OFT con muñeca + estado: 71.4 Hz de throughput y 112 ms de latencia en A100). Y un efecto lateral medido: con varias vistas, el modelo se aferra a correlaciones visuales espurias y deja de seguir la instrucción; OFT+ lo arregla con FiLM (sin FiLM, 33 % = azar en ALOHA).`,
              say: 'Without proprioception and a wrist camera the policy misses its own configuration and the contact region, and without history some phases are ambiguous. OFT adds each camera through the shared encoder and projector, two hundred fifty-six tokens per view, and the robot state as one extra token through a small MLP. More views make language grounding harder, which FiLM conditioning fixes.',
              why: 'Se anota qué falta y por qué importa, cómo se agrega con el costo en tokens y el efecto lateral sobre el lenguaje.' },
            { q: 'Your fine-tuned OpenVLA reaches the object and then freezes in place. What is going on?',
              junior: 'Le falta entrenamiento.',
              senior: R`El síntoma clásico de una política de un solo paso sin chunks entrenada con pausas: las demostraciones tienen pasos casi nulos (el teleoperador dudó), el modelo aprende que en ese estado la acción es "nada", la imagen no cambia, y vuelve a predecir "nada". En LIBERO filtrar las acciones casi nulas fue "crucial" para OpenVLA (Apéndice E), y el README pide grabar sin pausas. Arreglos: filtrar no-ops (traslación y rotación casi cero y pinza sin cambio), volver a grabar con movimiento continuo, o pasar a chunks (OFT), que rompen el punto fijo porque ejecutan varias acciones antes de volver a mirar. Revisa también que la convención de la pinza (abrir/cerrar) sea la de tu robot y que el <code>unnorm_key</code> sea el de tu dataset: deltas demasiado chicos parecen "congelado".`,
              say: 'That is the classic fixed point of a single-step policy trained on demonstrations with idle pauses: it learns zero motion in that state, the image does not change, so it predicts zero again. I filter no-op actions, re-record with continuous motion, or switch to action chunks, and I check the gripper convention and the unnormalization key.',
              why: 'Se anota el punto fijo, el filtro de no-ops con la cita, chunks como arreglo y los chequeos de pinza y escala.' },
            { q: 'Why did OpenVLA train for 27 epochs when LLMs train for one or two?',
              junior: 'Porque había pocos datos.',
              senior: R`Porque el éxito real en el robot siguió subiendo hasta que la token accuracy de entrenamiento pasó 95 % (§3.4). Behavior cloning con 970K trayectorias (pocas decenas de millones de pasos) y un espacio de salida de 256 bins por dimensión no es modelar lenguaje: la "respuesta correcta" es casi determinística dada la imagen, y la precisión de cada bin importa. Lo que uno vigila no es la pérdida de validación sino la evaluación con el robot (o en simulación). Costo: 64 A100 × 14 días. Matiz: más épocas memorizan también el ruido de las demostraciones; por eso la mezcla y la limpieza de datos pesan tanto.`,
              say: 'Because real-robot success kept improving until training action-token accuracy passed ninety-five percent. Behavior cloning over a small, nearly deterministic output space behaves differently from language modeling, so the stopping criterion is robot evaluation, not validation loss.',
              why: 'Se anota el criterio de >95 %, por qué BC es distinto y qué se vigila.' },
            { q: 'What does the OpenVLA-OFT recipe change, and what does each piece buy?',
              junior: 'Lo hace más rápido.',
              senior: R`Cuatro cambios en el fine-tuning, sin re-preentrenar. (1) <b>Decodificación en paralelo</b>: en vez de ${NA()} pasos causales, el decoder recibe embeddings "vacíos" de acción (solo difieren en la posición) con atención bidireccional y predice todo en una pasada: 4.2 → 15.9 Hz (A100). (2) <b>Chunks</b>: K embeddings vacíos por paso de tiempo (K = 8 en LIBERO, 25 en ALOHA), 108.8 acciones/s con 73 ms de latencia, y además <b>sube</b> el éxito (76.5 → 90.2 % en LIBERO). (3) <b>Acciones continuas con L1</b>: el LM head se reemplaza por un MLP de 4 capas (ReLU) que regresa los valores: 95.3 %, igual que difusión (95.4 %) pero sin 50 pasos de muestreo. (4) <b>Entradas extra</b> (muñeca + estado): 97.1 %. Para ALOHA, OFT+ suma FiLM para que siga la instrucción. Entrenables en LIBERO: ≈ 279M (LoRA 111M + cabeza 151M + projector de estado 17M).`,
              say: 'OFT replaces seven causal decoding steps with one bidirectional pass over empty action embeddings, extends it to action chunks, swaps the token head for an L1 regression MLP, and adds wrist camera and proprioception. Parallel decoding and chunking raise throughput by twenty-six times and also success, from seventy-six to ninety percent on LIBERO; L1 matches diffusion at ninety-five, and extra inputs reach ninety-seven.',
              why: 'Se anota cada pieza con su número, y que el chunking mejora también el éxito.' },
          ] },
          { t: 'h3', text: 'Estima y depura' },
          { t: 'qa', items: [
            { q: '¿Cabe OpenVLA en un Jetson AGX Orin de 64 GB, y a cuántos Hz?',
              a: R`Cabe: ${met('wBytes')} en bf16 (memoria compartida con la CPU). Velocidad: el decode a batch 1 lee los pesos ${NA()} veces por acción con ≈ 204.8 GB/s: la cota del calculador da ${est('≈ ' + met('hzOrin') + ' Hz')} en bf16, antes de overheads; en int4, ${est('≈ 3–4×')} más. Para control, el Orin pide un modelo más chico, OFT con chunks, o el VLA como planificador lento. Ver la pregunta del Jetson en <a href="#llm-inferencia.entrevista">inferencia de LLMs</a>.` },
            { q: 'Llamas a generate con tu propio prompt y las acciones salen peores que con predict_action, sin errores. ¿Qué miras?',
              a: 'El template exacto ("In: What action should the robot take to {instrucción}?\nOut:") y el token 29871 que predict_action agrega después de "Out:" si falta; max_new_tokens = dimensiones de la acción; greedy (do_sample=False); y que tomas los últimos 7 ids. Cualquier diferencia con el entrenamiento cambia la distribución sin dar error.' },
            { q: 'La pinza nunca se cierra del todo: el valor reconstruido es 0.996 y no 1. ¿Bug?',
              a: 'No: el bin más alto reconstruye el centro del último intervalo, 1 − 1/255 ≈ 0.996, y la pinza no se des-normaliza (máscara). Los scripts de evaluación binarizan y, según el robot, invierten la convención. Revisa ese post-proceso, no el modelo.' },
            { q: 'Pasas de una cámara a dos (tercera persona + muñeca) con la receta OFT. ¿Qué pasa con el prompt?',
              a: R`+${NV()} tokens visuales (512 en total) y +1 token de estado: el prefill casi se duplica. Con decode en paralelo, OFT reporta 71.4 Hz de throughput y 112 ms de latencia en una A100 con chunks de 8, contra 108.8 Hz y 73 ms con una cámara (Tabla II).` },
            { q: 'Tu robot va a 20 Hz y grabaste las demos a 20 Hz. ¿Qué haces antes de ajustar OpenVLA?',
              a: 'Sub-muestrear a 5–10 Hz (sumando los deltas de los pasos que juntas, no tomando uno de cada cuatro) y verificar con la repetición abierta que la tarea sigue saliendo a esa frecuencia (README). OpenVLA sin chunks no sigue datos de alta frecuencia: los deltas por paso son minúsculos y casi todo es "ruido de bin".' },
          ] },
          { t: 'callout', kind: 'note', html: R`<p>Fuentes de esta sección además del paper: README y <code>vla-scripts/finetune.py</code> del ${REPO}; <code>modeling_prismatic.py</code> (predict_action) y <code>config.json</code> de openvla/openvla-7b en Hugging Face; ${OFT}; ${MINI}.</p>` },
        ],
      },

      // ======================================================== 11
      {
        id: 'practica',
        titleEn: 'Active practice',
        priority: 'core',
        blocks: [
          { t: 'p', html: R`Primero el diagrama sin mirar; después las formas; luego los "¿qué pasa si…?" (los calcula el calculador) y al final el ejercicio de código que más se pide de OpenVLA: normalizar con las estadísticas del dataset, llevar la acción a los últimos 256 ids de Llama y volver.` },
          { t: 'h3', text: 'Diagrama en blanco: de la imagen a la acción' },
          { t: 'blankdiagram', diagram: 'openvla-overview', slots: [
            { node: 'concat', ask: 'label', hint: 'cómo se juntan los dos encoders' },
            { node: 'concat', tensor: T.fused, ask: 'shape' },
            { node: 'projector', tensor: T.vis, ask: 'shape' },
            { node: 'action-tokens', ask: 'label', hint: 'qué genera el LLM y cuántos' },
            { node: 'detokenize', ask: 'label', hint: 'de id a unidades del robot' },
          ] },
          { t: 'h3', text: '¿Qué forma tiene este tensor?' },
          { t: 'shapedrill', model: 'openvla', pool: ['pixels', 'd-patch-grid', 'd-scores', 'd-feats', 's-qkv', 's-feats', 'vis-feats', 'proj-h1', 'vis-tokens', 'text-emb', 'prompt', 'q-heads', 'scores', 'logits', 'action-tokens'], configs: [C] },
          { t: 'h3', text: '¿Qué pasa si…?' },
          { t: 'whatif', items: [
            { q: R`La instrucción pasa de ${cf('T')} a 64 tokens (una orden larga con contexto). ¿Qué pasa con los tokens del prompt?`, change: { T: 64 }, ask: 'promptTokens',
              explain: R`Suben de ${met('prompt')} a 256 + 64: la imagen sigue siendo la mayor parte del prompt.` },
            { q: 'Instrucción de 256 tokens. ¿Por qué factor cambian los MACs del prefill?', change: { T: 256 }, ask: 'prefillMacs',
              explain: 'Casi ×2: el prompt pasa de 278 a 512 tokens y el prefill es lineal en tokens (con la atención, un poco más). La visión no cambia.' },
            { q: 'Misma instrucción de 256 tokens. ¿Qué pasa con la cota de Hz en una RTX 4090?', change: { T: 256 }, ask: 'hzRtx4090',
              explain: 'Baja menos de lo que sube el prefill: el paso lo dominan los pasos de decode, que leen los pesos y casi no dependen del largo del prompt (el KV que leen crece, pero es chico frente a los pesos).' },
            { q: 'Instrucción de 256 tokens. ¿Qué parte de los MACs del paso es el prefill?', change: { T: 256 }, ask: 'prefillShare', expect: 'value',
              explain: 'Casi todo, ya con T por defecto. Los MACs del decode son pocos; su costo es de memoria, no de cómputo. Por eso los MACs no predicen la latencia de un VLA a batch 1.' },
            { q: 'Llevas OpenVLA en bf16 a un Jetson AGX Orin (≈ 204.8 GB/s, ≈ 42.5 TFLOPS FP16 densos derivados). ¿A cuántos Hz llega la cota?', change: { bandwidth: 204.8e9, peakFlops: 42.5e12 }, ask: 'hz', expect: 'value',
              explain: R`≈ ${met('hzOrin')} Hz: cada paso de decode lee los pesos a un quinto del ancho de banda de una 4090. Con int4, ≈ 3–4× más; para control de verdad, un modelo más chico, chunks en paralelo o el VLA como planificador.` },
            { q: 'Mismo Orin. ¿Cuánto tarda un solo paso de decode?', change: { bandwidth: 204.8e9, peakFlops: 42.5e12 }, ask: 'decodeMs', expect: 'value',
              explain: R`Los pesos del LLM (${est('≈ 13 GB')} en bf16; la visión no corre en el decode) ÷ 204.8 GB/s: memory-bound puro. Multiplica por ${DS()} y súmale el prefill para el paso completo.` },
          ] },
          { t: 'h3', text: '¿Qué pasa si…? (cuentas a mano: knobs que la config no tiene)' },
          { t: 'qa', items: [
            { q: 'Subes la imagen de 224 a 384 px (el experimento de §3.4), con encoders de parche 14. ¿Qué pasa con los tokens visuales y el prefill?',
              a: R`384/14 no es entero: los encoders de 384 px de SigLIP usan una grilla de 27 × 27 = 729 parches (contra 16 × 16 = ${NV()}). ${est('≈ ×2.8 tokens')} y el prefill crece casi igual; el decode casi no cambia. El paper no vio mejora en éxito y entrenaba 3× más lento.` },
            { q: 'Agregas una cámara de muñeca (dos imágenes por paso, como OFT). ¿Qué pasa con el prompt, el prefill y la cota de Hz?',
              a: R`+${NV()} tokens visuales (512) y el doble de visión: ${est('el prefill ≈ ×1.9')}. La cota de Hz baja ${est('≈ 20 %')} (el prefill era ≈ ¼ del paso en la 4090); con decode en paralelo pesa más, porque el decode deja de dominar. OFT con muñeca + estado: 71.4 Hz de throughput y 112 ms de latencia en A100, contra 108.8 Hz y 73 ms con una cámara.` },
            { q: 'Pasas a un robot de dos brazos: 14 dimensiones, todavía token por token. ¿Qué pasa con la cota de Hz?',
              a: R`De ${DS()} a 13 pasos de decode: ${est('≈ 80 → ≈ 172 ms')} de decode en la 4090 y ${est('≈ 105 → ≈ 197 ms')} por paso: la cota cae de ${est('≈ ' + met('hz4090') + ' a ≈ 5 Hz')}. En MACs casi no cambia (el prefill domina el cómputo): otra vez, el tiempo lo fija el número de pasadas secuenciales.` },
            { q: 'Un chunk de 8 acciones de 7 dimensiones decodificado token por token. ¿Ganas frecuencia?',
              a: R`Son 56 tokens: 55 pasos de decode, ${est('≈ 0.75 s')} por inferencia en la 4090 para 8 acciones, ${est('≈ 11 acciones/s')}: casi lo mismo que una por inferencia, con peor reacción. El chunk solo acelera si sale en una pasada (OFT: 108.8 acciones/s en A100).` },
          ] },

          { t: 'h3', text: 'Escríbelo: normalizar, a tokens de Llama y de vuelta' },
          { t: 'p', html: R`Sin mirar: (1) <code>normalize</code>: cada dimensión a [−1, 1] con los cuantiles q01/q99 del dataset, recortando, sin tocar las dimensiones con máscara False (la pinza); (2) <code>to_token_ids</code>: 256 bordes de <code>linspace(−1, 1, 256)</code>, <code>digitize</code> y id = {{openvla-7b.Vtok}} − d; (3) <code>from_token_ids</code>: id → bin → centro (juntando el índice 256 con el 255); (4) <code>unnormalize</code>. Anota la forma en cada línea. Verificado en el venv del Atlas (NumPy 2.5) contra el <code>ActionTokenizer</code> oficial (<code>prismatic/vla/action_tokenizer.py</code>) y la fórmula de <code>predict_action</code>, con las estadísticas reales de <code>bridge_orig</code> de la config de openvla-7b y 20,000 acciones: ids idénticos ({{openvla-7b.actionTokenFirst}}–{{openvla-7b.actionTokenLast}}), decodificación idéntica, des-normalización idéntica; 255 valores distintos de reconstrucción; error máximo 1/255 normalizado y (q99 − q01)/510 en unidades reales dentro de [q01, q99] (Δx: 0.11 mm). Con mínimo–máximo en vez de cuantiles, el paso de Δx en Bridge sería 3.2 mm en vez de 0.22 mm.` },
          { t: 'code', title: 'Solución de referencia (NumPy)', files: [
            { name: 'openvla_actions.py', lang: 'python', code: [
              'import numpy as np',
              '',
              'N_BINS = 256',
              'VOCAB = 32000                                  # tokenizer de Llama 2 (el embedding se rellena a 32,064; aquí no importa)',
              '',
              'EDGES = np.linspace(-1.0, 1.0, N_BINS)         # 256 BORDES -> 255 intervalos',
              'CENTERS = (EDGES[:-1] + EDGES[1:]) / 2         # 255 valores de reconstrucción',
              '',
              '',
              'def normalize(a, q01, q99, mask):',
              '    # a: (T, 7) acciones crudas · q01, q99: (7,) del dataset · mask: (7,) bool (False = no normalizar, p. ej. la pinza)',
              '    x = np.clip(2 * (a - q01) / (q99 - q01 + 1e-8) - 1, -1, 1)',
              '    return np.where(mask, x, a)                                 # (T, 7) en [-1, 1]',
              '',
              '',
              'def to_token_ids(x):',
              '    # x: (T, 7) normalizadas',
              '    d = np.digitize(np.clip(x, -1, 1), EDGES)                  # (T, 7) enteros en 1..256',
              '    return VOCAB - d                                            # (T, 7) ids en 31744..31999 (los últimos 256)',
              '',
              '',
              'def from_token_ids(ids):',
              '    # ids: (T, 7) -> (T, 7) normalizadas',
              '    idx = np.clip((VOCAB - ids) - 1, 0, len(CENTERS) - 1)       # el borde 256 cae en el último intervalo',
              '    return CENTERS[idx]',
              '',
              '',
              'def unnormalize(x, q01, q99, mask):',
              '    return np.where(mask, 0.5 * (x + 1) * (q99 - q01) + q01, x) # (T, 7) en unidades del robot',
            ] },
            { name: 'check_vs_official.py', lang: 'python', code: [
              'import json',
              'import numpy as np',
              'from action_tokenizer import ActionTokenizer          # prismatic/vla/action_tokenizer.py del repo openvla/openvla',
              'from openvla_actions import CENTERS, normalize, to_token_ids, from_token_ids, unnormalize',
              '',
              '',
              'class StubTok:                                          # lo único que usa ActionTokenizer: vocab_size y decode',
              '    vocab_size = 32000',
              '    def decode(self, ids): return list(ids)',
              '    def batch_decode(self, ids): return [list(r) for r in ids]',
              '',
              '',
              'official = ActionTokenizer(StubTok())',
              'st = json.load(open("config.json"))["norm_stats"]["bridge_orig"]["action"]   # config de openvla/openvla-7b',
              'q01, q99, mask = np.array(st["q01"]), np.array(st["q99"]), np.array(st["mask"])',
              '',
              'rng = np.random.default_rng(0)',
              'a = rng.normal(st["mean"], st["std"], size=(20000, 7))',
              'a[:, 6] = rng.integers(0, 2, 20000)                     # pinza 0/1',
              'x = normalize(a, q01, q99, mask)',
              'ids = to_token_ids(x)',
              'print(np.array_equal(ids, np.array(official(x))), ids.min(), ids.max())        # True 31744 31999',
              'xn = from_token_ids(ids)',
              'print(np.array_equal(xn, official.decode_token_ids_to_actions(ids)))           # True',
              'ref = np.where(mask, 0.5 * (xn + 1) * (q99 - q01) + q01, xn)                   # predict_action',
              'print(np.array_equal(unnormalize(xn, q01, q99, mask), ref))                   # True',
              '',
              'inside = np.all((a >= q01) & (a <= q99), axis=1)',
              'err = np.abs(unnormalize(xn, q01, q99, mask) - a)[inside, :6].max(0)',
              'print(len(CENTERS), err <= (q99 - q01)[:6] / 510 + 1e-12)                      # 255, todo True',
              'print((q99 - q01)[0] / 510 * 1000, "mm")                                       # 0.11 mm de error máximo en Δx',
            ] },
          ] },
          { t: 'callout', kind: 'trap', title: 'Los cuatro bugs que este ejercicio atrapa', html: R`<p>(1) Suponer 256 centros: con <code>linspace</code> como bordes hay 255, y sin el <code>clip</code> el índice 256 se sale del arreglo. (2) Mapear el bin b al id {{openvla-7b.Vtok}} − b (sin el +1 de <code>digitize</code>): todo corrido un bin. (3) Des-normalizar la pinza: la máscara la deja en [−1, 1] / {0, 1}. (4) Usar las estadísticas de otro dataset (<code>unnorm_key</code>): ningún error, acciones con la escala equivocada.</p>` },
          { t: 'callout', kind: 'connect', html: R`<p>Repasa con las <a href="#flashcards">flashcards</a> de esta página y sigue con más ejercicios en <a href="#practica">Práctica</a>. Lo siguiente: <a href="#pi0">π0</a>, donde la salida deja de ser tokens y pasa a ser un chunk continuo con flow matching.</p>` },
        ],
      },
    ],

    // ---------------------------------------------------------- flashcards
    flashcards: [
      { id: 'openvla-01', kind: 'forma', q: 'OpenVLA: forma de las features de DINOv2 y de SigLIP para una imagen.', a: R`${sh('dino')} y ${sh('sig')}: un token por parche de 14 px a 224 px.` },
      { id: 'openvla-02', kind: 'forma', q: 'OpenVLA: forma de las features fusionadas antes del projector.', a: R`${sh('fused')}: concatenación por canal (no por secuencia).` },
      { id: 'openvla-03', kind: 'forma', q: 'OpenVLA: forma de los tokens visuales después del projector.', a: R`${sh('vis')}: los mismos ${NV()} tokens, al ancho de Llama.` },
      { id: 'openvla-04', kind: 'forma', q: 'OpenVLA: forma del prompt que entra al LLM.', a: R`${sy('prompt')} = ${sh('prompt')} (BOS + imagen + instrucción).` },
      { id: 'openvla-05', kind: 'forma', q: 'OpenVLA: ¿cuántos tokens genera por paso de control y qué significa cada uno?', a: R`${NA()}: Δx, Δy, Δz, Δroll, Δpitch, Δyaw y la pinza; sin token de terminar (RT-2 tiene 8).` },
      { id: 'openvla-06', kind: 'formula', q: 'Normalización de la acción en OpenVLA.', a: R`\(\bar a = \mathrm{clip}(2(a-q^{01})/(q^{99}-q^{01}) - 1, -1, 1)\), por dimensión y por dataset; la pinza no (máscara).` },
      { id: 'openvla-07', kind: 'formula', q: 'OpenVLA: id del token de acción a partir del bin.', a: R`id = {{openvla-7b.Vtok}} − d, con d = digitize(x, linspace(−1, 1, 256)) ∈ 1…256: ids {{openvla-7b.actionTokenFirst}}…{{openvla-7b.actionTokenLast}}.` },
      { id: 'openvla-08', kind: 'formula', q: 'Error máximo de cuantización de OpenVLA en unidades reales.', a: R`(q99 − q01)/510 por dimensión (1/255 normalizado). En Bridge, Δx ≈ 0.11 mm por paso.` },
      { id: 'openvla-09', kind: 'conteo', q: 'Parámetros de OpenVLA-7B por parte.', a: R`DINOv2 ${met('pDino')} · SigLIP ${met('pSig')} · projector ${met('pProj')} · Llama 2 ${met('pLlm')} · total ${qn('params.total')}.` },
      { id: 'openvla-10', kind: 'conteo', q: 'Datos de entrenamiento de OpenVLA.', a: '970K trayectorias de Open X-Embodiment (manipulación, un brazo, cámara de tercera persona), con los pesos de mezcla de Octo.' },
      { id: 'openvla-11', kind: 'conteo', q: 'Cómputo de entrenamiento de OpenVLA.', a: '64 A100 × 14 días ≈ {{openvla-7b.paperA100Hours}} A100-horas, batch 2048, 27 épocas, LR 2e-5 fijo.' },
      { id: 'openvla-12', kind: 'conteo', q: 'Velocidad y memoria de inferencia de OpenVLA (paper).', a: '≈ 6 Hz en una RTX 4090 en bf16, sin compilar ni speculative decoding; 15 GB de GPU (§3.5).' },
      { id: 'openvla-13', kind: 'conteo', q: 'OpenVLA vs RT-2-X en 29 tareas.', a: '+16.5 puntos absolutos de éxito con 7× menos parámetros; RT-2-X sigue ganando en generalización semántica.' },
      { id: 'openvla-14', kind: 'conteo', q: 'LoRA vs fine-tuning completo en OpenVLA (Tabla 1).', a: 'LoRA r = 32: 68.2 % con 97.6M parámetros (1.4 %) y 59.7 GB; completo: 69.7 % con 163.3 GB en 2 GPUs. (Versión chica, solo SigLIP.)' },
      { id: 'openvla-15', kind: 'conteo', q: 'Cuantización de OpenVLA (Tabla 2): éxito y VRAM.', a: 'bf16 71.3 % / 16.8 GB; int8 58.1 % / 10.2 GB; int4 71.9 % / 7.0 GB.' },
      { id: 'openvla-16', kind: 'conteo', q: 'OpenVLA-OFT en LIBERO.', a: '76.5 % → 97.1 % de promedio (con muñeca + estado; 95.3 % con una cámara) y 26× más throughput (108.8 vs 4.2 Hz en A100, K = 8).' },
      { id: 'openvla-17', kind: 'concepto', q: '¿Por qué DINOv2 + SigLIP?', a: 'SigLIP: semántica alineada con lenguaje (qué). DINOv2: estructura espacial fina (dónde). Prismatic: la mejor combinación; en OpenVLA quitar DINOv2 cuesta ≈ 5 puntos.' },
      { id: 'openvla-18', kind: 'concepto', q: '¿Por qué cuantiles 1–99 % y no mínimo–máximo?', a: 'Un atípico ensancha todos los bins con mínimo–máximo (Bridge Δx: 3.2 mm vs 0.22 mm por bin). Costo: el 2 % más extremo se recorta.' },
      { id: 'openvla-19', kind: 'concepto', q: '¿Por qué pisar los 256 tokens menos usados de Llama?', a: 'Llama solo reserva 100 tokens especiales; agregar filas nuevas las inicializa al azar. Los últimos ids del BPE casi no aparecen en texto.' },
      { id: 'openvla-20', kind: 'concepto', q: '¿Qué es unnorm_key?', a: 'El nombre del dataset cuyas q01/q99 se usan para des-normalizar la acción (las estadísticas viajan en la config del modelo). Equivocarlo falla en silencio.' },
      { id: 'openvla-21', kind: 'concepto', q: 'Formato del prompt de OpenVLA.', a: '"In: What action should the robot take to {instrucción}?\nOut:" (+ el token 29871 que predict_action agrega si falta).' },
      { id: 'openvla-22', kind: 'concepto', q: '¿Qué entrena OpenVLA y qué no?', a: 'Todo: los dos ViT, el projector y el LLM. Ajustar la visión es "crucial" (80.0 % vs 46.7 % congelada, Apéndice D.3).' },
      { id: 'openvla-23', kind: 'concepto', q: 'OpenVLA: ¿por qué 27 épocas?', a: 'El éxito real siguió subiendo hasta > 95 % de token accuracy de entrenamiento; el criterio es la evaluación en el robot.' },
      { id: 'openvla-24', kind: 'concepto', q: 'Consejos del README para grabar demos de fine-tuning.', a: '≈ 100 demos; 5–10 Hz; sin pausas ni pasos quietos; estrategia consistente; cubrir las variaciones que se van a evaluar.' },
      { id: 'openvla-25', kind: 'concepto', q: '¿Qué es la decodificación en paralelo de OpenVLA-OFT?', a: 'Embeddings "vacíos" de acción (solo cambia la posición) + atención bidireccional: todas las dimensiones (y K pasos) en una sola pasada del decoder.' },
      { id: 'openvla-26', kind: 'concepto', q: '¿Qué agrega OFT+ y por qué?', a: 'FiLM: el promedio de los embeddings de la instrucción modula las features de los ViT. Con varias cámaras, sin FiLM el modelo ignora el lenguaje (33 % = azar en ALOHA).' },
      { id: 'openvla-27', kind: 'tradeoff', q: 'Tokens discretos vs chunk continuo L1 vs difusión/flujo.', a: `Pasadas secuenciales: prefill + 6 decodes por acción / 1 por chunk / pasos de muestreo por chunk. Multimodalidad: por dimensión / débil (mediana) / sí. LIBERO: 76.5 / 95.3 / 95.4 % (OFT).` },
      { id: 'openvla-28', kind: 'tradeoff', q: 'VLA vs pipeline clásico en una celda de pick-and-place.', a: 'Clásico: piezas conocidas, ciclo corto, precisión y certificación. VLA: variedad abierta y lenguaje. En la práctica, híbrido.' },
      { id: 'openvla-29', kind: 'tradeoff', q: 'Throughput vs latencia con chunks.', a: 'OFT K = 8: 108.8 acciones/s pero 73 ms por inferencia y 8 acciones en lazo abierto. Reactividad = latencia y re-planificación; tareas lentas = throughput.' },
      { id: 'openvla-30', kind: 'trampa', q: '"Dos encoders duplican los tokens visuales."', a: R`No: la fusión es por canal; el LLM ve ${NV()} tokens. Se duplica el cómputo de visión, no el prefill.` },
      { id: 'openvla-31', kind: 'trampa', q: '"OpenVLA discretiza en 256 bins, así que hay 256 valores posibles por dimensión."', a: 'Hay 255: linspace(−1, 1, 256) son bordes, digitize da 1…256 y el 256 se junta con el 255. 256 ids, 255 centros.' },
      { id: 'openvla-32', kind: 'trampa', q: '"int8 baja el éxito de OpenVLA por perder precisión."', a: 'Por velocidad: int8 era más lento (1.2 Hz en A5000) y cambia la dinámica con control no bloqueante. Con control bloqueante, rinde como bf16.' },
      { id: 'openvla-33', kind: 'trampa', q: '"OpenVLA va a ≈ 6 Hz por la imagen."', a: R`Por el decode: ${NA()} pasos a batch 1, cada uno lee los pesos completos (memory-bound). El prefill es una sola pasada.` },
      { id: 'openvla-34', kind: 'trampa', q: '"El projector de OpenVLA es un MLP de 2 capas."', a: 'Así lo dice el paper; el código (fused-gelu-mlp de Prismatic) tiene 3 lineales: D_v → 4·D_v → D → D. Los conteos del atlas siguen el código.' },
      { id: 'openvla-35', kind: 'trampa', q: '"Las Tablas 1 y 2 de OpenVLA (LoRA, cuantización) son del modelo openvla-7b."', a: 'No: son de una versión más chica, solo con SigLIP y la mezcla de Octo (nota al pie 4).' },
      { id: 'openvla-36', kind: 'trampa', q: '"Predecir chunks token por token acelera la política."', a: 'No: ×K tokens secuenciales. El chunking acelera con decodificación en paralelo (OFT) o una cabeza continua (π0).' },
      { id: 'openvla-37', kind: 'concepto', q: 'Tu OpenVLA ajustado se congela a mitad de la tarea. Causa típica.', a: 'Pausas en las demos: aprende "no moverse" en ese estado y la imagen no cambia (punto fijo). Filtrar no-ops, re-grabar o usar chunks.' },
      { id: 'openvla-38', kind: 'concepto', q: 'Fine-tuning de OpenVLA: hiperparámetros por defecto de finetune.py.', a: 'LoRA r = 32, α = 16, dropout 0, todas las lineales, LR 5e-4, batch 16 (≈ 72 GB; mínimo ≈ 27 GB con acumulación).' },
    ],

    // ---------------------------------------------------------- glosario
    glossary: [
      { en: 'Open X-Embodiment (OpenX)', es: 'Open X-Embodiment', def: 'Colección comunitaria de más de 70 datasets de robots reales en un formato común (RLDS); OpenVLA usa 970K trayectorias filtradas.', say: 'OpenVLA was trained on nine hundred seventy thousand Open X-Embodiment trajectories.' },
      { en: 'fused vision encoder', es: 'encoder de visión fusionado', def: 'Dos ViT sobre la misma imagen (DINOv2 y SigLIP) cuyas features por parche se concatenan por canal.', say: 'The fused encoder concatenates DINOv2 and SigLIP features channel-wise.' },
      { en: 'action normalization (q01/q99)', es: 'normalización de acciones por cuantiles', def: 'Llevar cada dimensión de la acción a [−1, 1] con los cuantiles 1 % y 99 % del dataset, recortando las colas.', say: 'Actions are normalized per dataset with the first and ninety-ninth percentiles.' },
      { en: 'parallel decoding', es: 'decodificación en paralelo', def: 'Predecir todas las dimensiones (y varios pasos) de la acción en una sola pasada con atención bidireccional, en vez de token por token.', say: 'Parallel decoding replaces seven sequential steps with one forward pass.' },
      { en: 'action chunking', es: 'chunks de acciones', def: 'Predecir una secuencia de K acciones futuras por inferencia y ejecutarlas antes de volver a decidir.', say: 'With action chunking the policy predicts several future actions per inference.' },
      { en: 'FiLM (feature-wise linear modulation)', es: 'modulación lineal por canal', def: 'Escalar y desplazar cada canal de unas features con vectores calculados a partir de una condición (en OFT+, la instrucción).', say: 'FiLM conditions the vision features on the instruction.' },
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
